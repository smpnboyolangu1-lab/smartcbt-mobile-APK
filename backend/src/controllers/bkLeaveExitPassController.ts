import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyGatepassByBkScan } from './gatepassController';

const prisma = new PrismaClient();

// ========================================================
// SISTEM IZIN KELUAR / SAKIT / DISPENSASI SISWA VIA BK
// TWO-STEP VERIFICATION & DIGITAL EXIT PASS GATE SATPAM
// ========================================================

/**
 * Pastikan stiker QR Meja BK default tersedia
 */
export const ensureDefaultBkStations = async () => {
    try {
        const count = await (prisma as any).bkStation.count();
        if (count === 0) {
            await (prisma as any).bkStation.create({
                data: {
                    stationName: 'Meja Konseling BK 1 (Ruang Utama)',
                    qrSecretToken: 'BK-STATION-ROOM1-9A8B7C6D',
                    isActive: true
                }
            });
            await (prisma as any).bkStation.create({
                data: {
                    stationName: 'Meja Konseling BK 2 (Koordinator BK)',
                    qrSecretToken: 'BK-STATION-ROOM2-4E3F2A1B',
                    isActive: true
                }
            });
            console.log('✅ Default BK Stations initialized successfully');
        }
    } catch (e: any) {
        console.warn('Init default BK stations note:', e.message);
    }
};

/**
 * 1. Pengajuan Mandiri oleh Siswa (APK Siswa)
 * POST /api/v1/student/leaves/apply
 * Body: { leaveType, reason, eventName, pickupPerson }
 * Status awal: 'submitted', tombol scan QR di HP Siswa LOCKED
 */
export const applyStudentLeave = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        const { leaveType, reason, eventName, pickupPerson } = req.body;

        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi siswa diperlukan.' });
        }

        const validTypes = ['SAKIT_PULANG', 'IZIN_PULANG_MENDESAK', 'DISPENSASI_LOMBA'];
        if (!leaveType || !validTypes.includes(leaveType)) {
            return res.status(400).json({
                success: false,
                message: 'Tipe izin tidak valid. Pilih: Sakit Pulang, Izin Pulang Mendesak, atau Dispensasi Lomba.'
            });
        }

        if (!reason || reason.trim().length < 5) {
            return res.status(400).json({
                success: false,
                message: 'Alasan atau deskripsi izin wajib diisi minimal 5 karakter.'
            });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true, nisn: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        // Cek apakah ada pengajuan aktif hari ini yang belum selesai
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const existingLeave = await (prisma as any).studentLeave.findFirst({
            where: {
                studentId,
                appliedAt: { gte: todayStart, lte: todayEnd },
                status: { in: ['submitted', 'approved_by_bk'] }
            }
        });

        if (existingLeave) {
            // Update pengajuan yang sedang berjalan
            const updated = await (prisma as any).studentLeave.update({
                where: { id: existingLeave.id },
                data: {
                    leaveType,
                    reason: reason.trim(),
                    eventName: eventName?.trim() || null,
                    pickupPerson: pickupPerson?.trim() || null,
                    status: 'submitted', // Reset ke submitted jika diubah
                    appliedAt: new Date()
                }
            });

            return res.json({
                success: true,
                message: 'Perubahan data pengajuan izin berhasil disimpan. Menunggu verifikasi Guru BK.',
                data: updated
            });
        }

        // Temukan Guru BK pembina untuk kelas siswa ini
        let counselorId: string | null = null;
        let counselorName: string | null = null;
        if (student.className) {
            const classObj = await prisma.class.findFirst({
                where: { name: student.className }
            });
            if (classObj?.counselorId) {
                counselorId = classObj.counselorId;
                counselorName = classObj.counselorName || null;
            } else if (classObj?.counselorName) {
                const bkUser = await prisma.user.findFirst({
                    where: { name: classObj.counselorName, role: 'COUNSELOR' }
                });
                if (bkUser) {
                    counselorId = bkUser.id;
                    counselorName = bkUser.name;
                }
            }
        }

        const newLeave = await (prisma as any).studentLeave.create({
            data: {
                studentId,
                counselorId,
                leaveType,
                reason: reason.trim(),
                eventName: eventName?.trim() || null,
                pickupPerson: pickupPerson?.trim() || null,
                status: 'submitted'
            }
        });

        // Buat notifikasi langsung ke Guru BK pengampu kelas tersebut
        try {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'COUNSELOR',
                    recipientId: counselorId || null,
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className || '-',
                    title: `📋 Pengajuan Izin Keluar/Dispensasi (${student.className}): ${student.name}`,
                    message: `Siswa ${student.name} (${student.className || '-'}) mengajukan ${leaveType} dengan alasan: "${reason}". Masuk ke Guru BK pengampu kelas ${student.className || ''} ${counselorName ? '(' + counselorName + ')' : ''} untuk verifikasi.`,
                    category: 'STUDENT_LEAVE'
                }
            });
        } catch (e) {}

        const counselorInfo = counselorName ? ` (Guru BK Pengampu: ${counselorName})` : '';
        return res.status(201).json({
            success: true,
            message: `Pengajuan izin berhasil diajukan${counselorInfo}. Menunggu verifikasi Guru BK kelas Anda.`,
            data: newLeave
        });
    } catch (error: any) {
        console.error('Error applyStudentLeave:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal mengajukan izin siswa' });
    }
};

/**
 * 2. Cek Status Pengajuan Izin Aktif Siswa (Untuk Realtime Polling / Tampilan APK Siswa)
 * GET /api/v1/student/leaves/active
 */
export const getActiveStudentLeave = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const leave = await (prisma as any).studentLeave.findFirst({
            where: {
                studentId,
                appliedAt: { gte: todayStart, lte: todayEnd }
            },
            include: {
                station: true,
                student: {
                    select: {
                        id: true,
                        name: true,
                        className: true,
                        nisn: true,
                        profilePicUrl: true
                    }
                }
            },
            orderBy: { appliedAt: 'desc' }
        });

        const gatepass = await prisma.gatepassRequest.findFirst({
            where: {
                studentId,
                createdAt: { gte: todayStart, lte: todayEnd }
            },
            include: { approvedByBk: true },
            orderBy: { createdAt: 'desc' }
        });

        if (!leave && !gatepass) {
            return res.json({
                success: true,
                hasActiveLeave: false,
                data: null
            });
        }

        const now = new Date();
        const validUntil = gatepass?.validUntil || (leave?.approvedAt ? new Date(new Date(leave.approvedAt).getTime() + 45 * 60 * 1000) : null);
        const remainingSeconds = validUntil
            ? Math.max(0, Math.floor((new Date(validUntil).getTime() - now.getTime()) / 1000))
            : 0;

        // Saat disetujui BK, tiket digital izin sah langsung AKTIF untuk ditunjukkan ke Satpam gerbang!
        const isCheckedOut = leave?.status === 'checked_out' || 
            leave?.status === 'approved_by_bk' || 
            leave?.status === 'APPROVED' ||
            gatepass?.status === 'ACTIVE_APPROVED' || 
            gatepass?.status === 'COMPLETED' ||
            gatepass?.status === 'APPROVED';

        const isReadyForScan = false;
        const isScanLocked = false;

        const singleUseToken = gatepass?.singleUseCheckoutToken || `GP-${(gatepass?.id || leave?.id || 'RESMI').substring(0, 8).toUpperCase()}`;
        const qrVerificationPayload = `SMARTCBT-GATEPASS:${singleUseToken}:${gatepass?.id || leave?.id}`;

        return res.json({
            success: true,
            hasActiveLeave: true,
            isScanLocked,
            isReadyForScan,
            isCheckedOut,
            data: {
                id: gatepass?.id || leave?.id,
                leaveId: gatepass?.id || leave?.id,
                leaveType: leave?.leaveType || (gatepass?.leaveCategory === 'sick' ? 'SAKIT_PULANG' : 'IZIN_PULANG_MENDESAK'),
                leaveCategory: gatepass?.leaveCategory || (leave?.leaveType === 'SAKIT_PULANG' ? 'sick' : 'urgent_family'),
                reason: gatepass?.reason || leave?.reason,
                eventName: leave?.eventName || null,
                pickupPerson: gatepass?.pickupBy || leave?.pickupPerson || 'Mandiri',
                pickupBy: gatepass?.pickupBy || leave?.pickupPerson || 'Mandiri',
                status: isCheckedOut ? 'ACTIVE_APPROVED' : (gatepass?.status || leave?.status),
                appliedAt: gatepass?.createdAt || leave?.appliedAt,
                approvedAt: gatepass?.verifiedAt || leave?.approvedAt || now,
                checkedOutAt: gatepass?.verifiedAt || leave?.checkedOutAt || now,
                validUntil,
                remainingSeconds: remainingSeconds > 0 ? remainingSeconds : (45 * 60),
                singleUseCheckoutToken: singleUseToken,
                qrVerificationPayload,
                statusText: isCheckedOut ? 'SAH KELUAR GERBANG (IZIN RESMI BK - TUNJUKKAN KE SATPAM)' : 'MENUNGGU PERSETUJUAN GURU BK',
                counselorNotes: gatepass?.rejectionReason || leave?.counselorNotes || 'Telah disetujui Guru BK. Tunjukkan QR ini ke Satpam pos gerbang.',
                stationName: leave?.station?.stationName || 'Ruang Konseling BK',
                approvedByBkName: gatepass?.approvedByBk?.name || 'Guru BK',
                student: leave?.student || (gatepass ? { id: gatepass.studentId } : null)
            }
        });
    } catch (error: any) {
        console.error('Error getActiveStudentLeave:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal mengambil status izin' });
    }
};

// 3. Daftar Pengajuan Izin untuk Guru BK (GET /api/v1/counselor/leaves)
export const getCounselorLeaves = async (req: Request, res: Response) => {
    try {
        const { status, className } = req.query;
        const whereClause: any = {};

        if (status && status !== 'ALL') {
            whereClause.status = String(status);
        }

        const currentUserId = (req as any).user?.id;
        const currentUserRole = (req as any).user?.role;
        const currentUserName = (req as any).user?.name;

        // Jika login sebagai Guru BK: pastikan hanya melihat pengajuan dari rombel binaan kelasnya masing-masing
        if (currentUserRole === 'COUNSELOR' && currentUserId) {
            const myClasses = await prisma.class.findMany({
                where: {
                    OR: [
                        { counselorId: currentUserId },
                        { counselorName: currentUserName }
                    ]
                },
                select: { name: true }
            });

            const myClassNames = myClasses.map(c => c.name);
            if (myClassNames.length > 0) {
                whereClause.OR = [
                    { counselorId: currentUserId },
                    { student: { className: { in: myClassNames } } }
                ];
            }
        }

        const leaves = await (prisma as any).studentLeave.findMany({
            where: whereClause,
            include: {
                station: true,
                student: {
                    select: {
                        id: true,
                        name: true,
                        className: true,
                        nisn: true,
                        profilePicUrl: true,
                        parentPhone: true
                    }
                }
            },
            orderBy: { appliedAt: 'desc' },
            take: 100
        });

        const filtered = className && className !== 'ALL'
            ? leaves.filter((l: any) => l.student?.className === className)
            : leaves;

        return res.json({
            success: true,
            count: filtered.length,
            data: filtered
        });
    } catch (error: any) {
        console.error('Error getCounselorLeaves:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal mengambil daftar izin BK' });
    }
};

/**
 * 4. Verifikasi Online oleh Guru BK (Approval)
 * PATCH /api/v1/counselor/leaves/:id/approve
 * Body: { counselorNotes }
 * Status berubah menjadi 'approved_by_bk', tombol scan QR di HP siswa ACTIVE
 */
export const approveCounselorLeave = async (req: Request, res: Response) => {
    try {
        const counselorId = (req as any).user?.id;
        const counselorName = (req as any).user?.name || 'Guru BK';
        const { id } = req.params;
        const { counselorNotes } = req.body;

        const leave = await (prisma as any).studentLeave.findUnique({
            where: { id },
            include: { student: true }
        });

        if (!leave) {
            return res.status(404).json({ success: false, message: 'Data pengajuan izin tidak ditemukan.' });
        }

        if (leave.status === 'checked_out') {
            return res.status(400).json({ success: false, message: 'Izin ini sudah selesai checkout di meja BK.' });
        }

        const now = new Date();
        const validUntil = new Date(now.getTime() + 45 * 60 * 1000);
        const singleToken = `GP-${leave.id.substring(0, 8).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const updated = await (prisma as any).studentLeave.update({
            where: { id },
            data: {
                status: 'approved_by_bk',
                counselorId: counselorId || null,
                counselorNotes: counselorNotes?.trim() || 'Disetujui oleh Guru BK. Tiket izin resmi telah aktif. Tunjukkan QR ke Satpam di pos gerbang.',
                approvedAt: now,
                checkedOutAt: now
            },
            include: { student: true }
        });

        // Sinkronkan ke model gatepassRequest jika ada
        try {
            await (prisma as any).gatepassRequest.updateMany({
                where: { studentId: leave.studentId, status: { in: ['PENDING', 'WAITING_BK_SCAN'] } },
                data: {
                    status: 'ACTIVE_APPROVED',
                    approvedByBkId: counselorId || null,
                    singleUseCheckoutToken: singleToken,
                    validUntil: validUntil,
                    verifiedAt: now
                }
            });
        } catch (e) {}

        // Kirim notifikasi realtime ke HP Siswa (Hanya untuk siswa yang bersangkutan!)
        try {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'STUDENT',
                    studentId: leave.studentId,
                    studentName: leave.student.name,
                    className: leave.student.className || '-',
                    title: '✅ Izin Keluar Disetujui Guru BK!',
                    message: `Pengajuan izin ${leave.leaveType || 'keluar sekolah'} Anda telah disetujui oleh ${counselorName}. Tiket digital dan barcode izin resmi kini telah AKTIF. Tunjukkan kode QR di aplikasi Anda ke Satpam pos gerbang.`,
                    category: 'STUDENT_LEAVE'
                }
            });
        } catch (e) {}

        return res.json({
            success: true,
            message: `Izin ${leave.student.name} berhasil disetujui. Tiket QR keluar gerbang untuk Satpam telah aktif di aplikasi siswa.`,
            data: updated
        });
    } catch (error: any) {
        console.error('Error approveCounselorLeave:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memproses persetujuan izin' });
    }
};

/**
 * 5. Checkout Fisik di Meja BK (Two-Step Verification & Dynamic Rotating QR)
 * POST /api/v1/student/leaves/checkout-bk
 * Terintegrasi penuh dengan sistem Gatepass, dynamic rotating HMAC token, dan atomic database transaction.
 */
export const checkoutBkStation = async (req: Request, res: Response) => {
    return verifyGatepassByBkScan(req, res);
};

/**
 * 6. SERVICE / HOOK ANTI-BOLOS (Mitigasi Siswa Kabur Tanpa Izin BK)
 * Dipanggil saat Guru Mapel mengisi absen kelas atau saat sistem mendeteksi ketidakhadiran siswa di jam ke-N
 */
export const antiTruantCheckHook = async (
    studentId: string,
    teacherId?: string,
    periodSessionInfo?: { className: string; subjectName: string; periodNumber?: number }
) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        // 1. Cek apakah siswa tercatat absen pagi (hadir di gerbang)
        const gateInToday = await prisma.attendance.findFirst({
            where: {
                userId: studentId,
                type: 'GATE_IN',
                scanTime: { gte: todayStart, lte: todayEnd }
            }
        });

        if (!gateInToday) {
            // Siswa memang tidak hadir dari pagi (Alpa / Izin biasa dari rumah)
            return { isTruant: false, reason: 'Siswa tidak tercatat hadir di gerbang pagi' };
        }

        // 2. Periksa apakah siswa memiliki izin sah yang sudah checkout di meja BK
        const validLeave = await (prisma as any).studentLeave.findFirst({
            where: {
                studentId,
                status: 'checked_out',
                appliedAt: { gte: todayStart, lte: todayEnd }
            }
        });

        if (validLeave) {
            // Siswa punya izin resmi yang sudah checkout
            return {
                isTruant: false,
                reason: `Siswa memiliki izin sah (${validLeave.leaveType}) yang telah checkout di meja BK.`
            };
        }

        // 3. VONIS: SISWA BOLOS (Hadir di gerbang pagi, tapi hilang di jam mapel tanpa izin Meja BK)
        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true, parentPhone: true }
        });

        if (!student) return { isTruant: false };

        const violationReason = `Bolos Jam Pelajaran Efektif (${periodSessionInfo?.subjectName || 'KBM'} Kelas ${periodSessionInfo?.className || student.className || '-'}) tanpa izin Ruang BK`;
        const penaltyPoints = 15;

        // Potong poin kedisiplinan siswa (Catat ke BkViolationPointRecord)
        await (prisma as any).bkViolationPointRecord.create({
            data: {
                siswaId: student.id,
                jenis: violationReason,
                bobotPoin: penaltyPoints,
                tanggal: new Date(),
                pelaporId: teacherId || null,
                bapNumber: `BAP-BOLOS-${Date.now().toString().slice(-6)}`
            }
        });

        // Kurangi poin total siswa pada tabel User jika ada kolom points
        try {
            await prisma.user.update({
                where: { id: student.id },
                data: {
                    points: { increment: penaltyPoints } // Dalam sistem sekolah, penambahan poin pelanggaran menambah skor sanksi
                }
            });
        } catch (e) {}

        // Memicu push notification & WhatsApp darurat ke orang tua
        try {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className || '-',
                    title: `🚨 PERINGATAN DARURAT: Siswa Terdeteksi Bolos Pelajaran!`,
                    message: `PERHATIAN ORANG TUA: Ananda ${student.name} tercatat hadir di area SMP Negeri 1 Boyolangu pagi ini, namun terdeteksi TIDAK BERADA DI KELAS pada jam pelajaran ${periodSessionInfo?.subjectName || 'KBM'} tanpa izin resmi dari Ruang BK. Tindakan ini diklasifikasikan sebagai pelanggaran BOLOS dan telah dikenakan sanksi ${penaltyPoints} Poin Kedisiplinan.`,
                    category: 'DISCIPLINE_EMERGENCY'
                }
            });
        } catch (notifErr) {}

        return {
            isTruant: true,
            message: `Siswa ${student.name} divonis BOLOS. Penalti ${penaltyPoints} poin pelanggaran dicatat & peringatan darurat terkirim ke orang tua.`
        };
    } catch (error: any) {
        console.error('Error in antiTruantCheckHook:', error);
        return { isTruant: false, error: error.message };
    }
};

/**
 * 7. List Stiker QR Meja BK untuk Admin / Cetak Akrilik
 * GET /api/v1/counselor/stations
 */
export const getBkStationsList = async (req: Request, res: Response) => {
    try {
        await ensureDefaultBkStations();
        const stations = await (prisma as any).bkStation.findMany({
            orderBy: { createdAt: 'asc' }
        });
        return res.json({ success: true, data: stations });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
