import { Request, Response } from 'express';
import prisma from '../utils/db';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { extractWebToken } from '../middlewares/authMiddleware';
import { sendFcmToUser } from '../services/fcmService';
const getJwtSecret = () => process.env.JWT_SECRET || 'cbt_prod_secret_f9a83b27c64e10d592a8174fec01849a62bc38102d7e481b9201948271039841';

const DYNAMIC_QR_SECRET_SALT = process.env.GATEPASS_QR_SECRET || 'SMARTCBT_BK_GATEPASS_HMAC_SECRET_2026';
const ROTATION_WINDOW_MS = 45 * 1000; // 45 Detik rotasi anti-fraud
const GATEPASS_VALIDITY_MINUTES = 30; // 30 Menit batas waktu keluar gerbang satpam

/**
 * Helper: Hitung HMAC-SHA256 untuk Dynamic Rotating QR Ruang BK
 */
export function computeBkDynamicHmac(roomId: string, bkUserId: string, windowIndex: number): string {
    return crypto
        .createHmac('sha256', DYNAMIC_QR_SECRET_SALT)
        .update(`${roomId}:${bkUserId}:${windowIndex}`)
        .digest('hex')
        .substring(0, 32)
        .toUpperCase();
}

/**
 * Helper: Hitung HMAC-SHA256 untuk Dynamic Single-Use QR Gatepass Siswa (Anti-Screenshot)
 */
export function computeGatepassDynamicHmac(gatepassId: string, checkoutToken: string, windowIndex: number): string {
    return crypto
        .createHmac('sha256', DYNAMIC_QR_SECRET_SALT)
        .update(`GATEPASS:${gatepassId}:${checkoutToken}:${windowIndex}`)
        .digest('hex')
        .substring(0, 32)
        .toUpperCase();
}

/**
 * Helper: Konversi kategori antara format Gatepass (sick/urgent_family/dispensation)
 * dan format StudentLeave (SAKIT_PULANG/IZIN_PULANG_MENDESAK/DISPENSASI_LOMBA)
 */
function normalizeCategory(rawCategory?: string, rawLeaveType?: string): {
    leaveCategory: 'sick' | 'urgent_family' | 'dispensation';
    leaveType: 'SAKIT_PULANG' | 'IZIN_PULANG_MENDESAK' | 'DISPENSASI_LOMBA';
    attendanceStatus: 'SICK' | 'PERMISSION';
    label: string;
} {
    const val = (rawCategory || rawLeaveType || '').toUpperCase().trim();
    if (val === 'SICK' || val === 'SAKIT_PULANG' || val === 'SAKIT') {
        return {
            leaveCategory: 'sick',
            leaveType: 'SAKIT_PULANG',
            attendanceStatus: 'SICK',
            label: 'Sakit Pulang'
        };
    }
    if (val === 'DISPENSATION' || val === 'DISPENSASI_LOMBA' || val === 'DISPENSASI') {
        return {
            leaveCategory: 'dispensation',
            leaveType: 'DISPENSASI_LOMBA',
            attendanceStatus: 'PERMISSION',
            label: 'Dispensasi Organisasi / Lomba'
        };
    }
    return {
        leaveCategory: 'urgent_family',
        leaveType: 'IZIN_PULANG_MENDESAK',
        attendanceStatus: 'PERMISSION',
        label: 'Kepentingan Keluarga Mendesak'
    };
}

/**
 * 1. PENGAJUAN TIKET GATEPASS OLEH SISWA (APK SISWA)
 * POST /api/v1/gatepass/request
 */
export const createGatepassRequest = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Autentikasi siswa diperlukan.' });
        }
        if (user.role === 'PARENT') {
            return res.status(403).json({
                success: false,
                message: 'Digital Gatepass tidak berlaku untuk akun Orang Tua. Orang Tua mengajukan perizinan melalui menu Permohonan Izin / Sakit.'
            });
        }
        const studentId = user.id;

        const { leaveCategory, leaveType, reason, pickupBy, pickupPerson, eventName, academicYear } = req.body;
        if (!reason || String(reason).trim().length < 5) {
            return res.status(400).json({
                success: false,
                message: 'Alasan permohonan pulang wajib diisi minimal 5 karakter.'
            });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true, nisn: true, username: true, profilePicUrl: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        const norm = normalizeCategory(leaveCategory, leaveType);
        const finalPickup = (pickupBy || pickupPerson || 'Mandiri').trim();
        const finalReason = eventName ? `${reason.trim()} (Kegiatan: ${eventName.trim()})` : reason.trim();

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        // Cek apakah sudah ada gatepass aktif hari ini
        const existingGatepass = await prisma.gatepassRequest.findFirst({
            where: {
                studentId,
                createdAt: { gte: todayStart, lte: todayEnd },
                status: { in: ['PENDING', 'WAITING_BK_SCAN'] }
            }
        });

        // Cari Guru BK pengampu kelas
        let counselorId: string | null = null;
        let counselorName: string | null = null;
        if (student.className) {
            const classObj = await prisma.class.findFirst({ where: { name: student.className } });
            if (classObj?.counselorId) {
                counselorId = classObj.counselorId;
                counselorName = classObj.counselorName || null;
            } else if (classObj?.counselorName) {
                const bkUser = await prisma.user.findFirst({
                    where: { name: classObj.counselorName, OR: [{ role: 'COUNSELOR' }, { isBk: true }] }
                });
                if (bkUser) {
                    counselorId = bkUser.id;
                    counselorName = bkUser.name;
                }
            }
        }

        let gatepass;
        if (existingGatepass) {
            gatepass = await prisma.gatepassRequest.update({
                where: { id: existingGatepass.id },
                data: {
                    leaveCategory: norm.leaveCategory,
                    reason: finalReason,
                    pickupBy: finalPickup,
                    status: 'PENDING'
                }
            });
        } else {
            gatepass = await prisma.gatepassRequest.create({
                data: {
                    studentId,
                    academicYear: academicYear || '2026/2027',
                    leaveCategory: norm.leaveCategory,
                    reason: finalReason,
                    pickupBy: finalPickup,
                    status: 'PENDING',
                    approvedByBkId: counselorId
                }
            });
        }

        // Sinkronisasi ke tabel StudentLeave agar kompatibel dua arah
        try {
            const existingLeave = await (prisma as any).studentLeave.findFirst({
                where: {
                    studentId,
                    appliedAt: { gte: todayStart, lte: todayEnd },
                    status: { in: ['submitted', 'approved_by_bk'] }
                }
            });
            if (existingLeave) {
                await (prisma as any).studentLeave.update({
                    where: { id: existingLeave.id },
                    data: {
                        leaveType: norm.leaveType,
                        reason: reason.trim(),
                        eventName: eventName?.trim() || null,
                        pickupPerson: finalPickup,
                        status: 'submitted'
                    }
                });
            } else {
                await (prisma as any).studentLeave.create({
                    data: {
                        id: gatepass.id, // Gunakan ID yang sama bila memungkinkan
                        studentId,
                        counselorId,
                        leaveType: norm.leaveType,
                        reason: reason.trim(),
                        eventName: eventName?.trim() || null,
                        pickupPerson: finalPickup,
                        status: 'submitted'
                    }
                });
            }
        } catch (syncErr) {}

        // Notifikasi ke Guru BK
        try {
            await prisma.notificationMessage.create({
                data: {
                    recipientRole: 'COUNSELOR',
                    recipientId: counselorId || null,
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className || '-',
                    title: `📋 Permohonan Gatepass (${norm.label}): ${student.name}`,
                    message: `Siswa ${student.name} (${student.className || '-'}) mengajukan Gatepass [${norm.label}] dengan alasan: "${finalReason}". Penjemput: ${finalPickup}.`,
                    category: 'STUDENT_LEAVE'
                }
            });
        } catch (e) {}

        return res.status(201).json({
            success: true,
            message: 'Permohonan Gatepass berhasil dikirim. Silakan menuju Ruang BK untuk verifikasi tatap muka.',
            data: gatepass
        });
    } catch (error: any) {
        console.error('Error createGatepassRequest:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal membuat permohonan gatepass.' });
    }
};

/**
 * 2. GENERATE DYNAMIC ROTATING QR TOKEN (LAYAR GURU BK)
 * GET /api/v1/bk/dynamic-qr
 * Token berputar otomatis setiap 45 detik menggunakan HMAC-SHA256
 */
export const generateBkDynamicQr = async (req: Request, res: Response) => {
    try {
        const bkUser = (req as any).user;
        if (!bkUser?.id) {
            return res.status(401).json({ success: false, message: 'Autentikasi Guru BK diperlukan.' });
        }

        const roomId = (req.query.roomId as string) || 'RUANG_BK_UTAMA';
        const nowMs = Date.now();
        const windowIndex = Math.floor(nowMs / ROTATION_WINDOW_MS);
        const nextWindowMs = (windowIndex + 1) * ROTATION_WINDOW_MS;
        const expiresAt = new Date(nextWindowMs);
        const ttlSeconds = Math.max(1, Math.ceil((nextWindowMs - nowMs) / 1000));

        const hmacHash = computeBkDynamicHmac(roomId, bkUser.id, windowIndex);
        const tokenPayload = `SMARTCBT-BK-DYN:${roomId}:${bkUser.id}:${windowIndex}:${hmacHash}`;

        // Simpan ke tabel bk_active_tokens (bersihkan token kedaluwarsa milik BK ini)
        await prisma.$transaction([
            prisma.bkActiveToken.deleteMany({
                where: {
                    OR: [
                        { bkUserId: bkUser.id },
                        { expiresAt: { lt: new Date(nowMs - ROTATION_WINDOW_MS) } }
                    ]
                }
            }),
            prisma.bkActiveToken.create({
                data: {
                    bkUserId: bkUser.id,
                    currentTokenHash: hmacHash,
                    expiresAt
                }
            })
        ]);

        const dbUser = await prisma.user.findUnique({
            where: { id: bkUser.id },
            select: { name: true, role: true, isBk: true }
        });

        return res.json({
            success: true,
            data: {
                tokenPayload,
                currentTokenHash: hmacHash,
                roomId,
                bkUserId: bkUser.id,
                bkName: dbUser?.name || bkUser.name || 'Guru BK',
                windowIndex,
                expiresAt: expiresAt.toISOString(),
                ttlSeconds,
                rotationIntervalSeconds: 45
            }
        });
    } catch (error: any) {
        console.error('Error generateBkDynamicQr:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal membuat Dynamic QR BK.' });
    }
};

/**
 * 3. VERIFIKASI PRA-SCAN OLEH GURU BK (OPSIONAL: UBAH KE WAITING_BK_SCAN ATAU REJECT)
 * PATCH /api/v1/bk/gatepass/:id/status
 */
export const updateGatepassStatusByBk = async (req: Request, res: Response) => {
    try {
        const bkUser = (req as any).user;
        const gatepassId = String(req.params.id);
        const { status, rejectionReason, counselorNotes } = req.body;

        const gatepass: any = await prisma.gatepassRequest.findUnique({
            where: { id: gatepassId },
            include: { student: true }
        });

        if (!gatepass) {
            return res.status(404).json({ success: false, message: 'Data permohonan gatepass tidak ditemukan.' });
        }

        const studentName = gatepass.student?.name || 'Siswa';
        const studentClass = gatepass.student?.className || '-';

        if (status === 'REJECTED') {
            const updated = await prisma.gatepassRequest.update({
                where: { id: gatepassId },
                data: {
                    status: 'REJECTED',
                    rejectionReason: rejectionReason || counselorNotes || 'Ditolak oleh Guru BK.',
                    approvedByBkId: bkUser?.id || null
                },
                include: { student: true }
            });

            try {
                await (prisma as any).studentLeave.updateMany({
                    where: { studentId: gatepass.studentId, status: { in: ['submitted', 'approved_by_bk'] } },
                    data: { status: 'rejected', counselorNotes: rejectionReason || 'Ditolak oleh Guru BK' }
                });
            } catch (e) {}

            return res.json({
                success: true,
                message: `Permohonan gatepass ${studentName} telah ditolak.`,
                data: updated
            });
        }

        // BK MENYETUJUI: Langsung ACTIVE_APPROVED + terbitkan token QR checkout siswa (Valid 30 Menit)
        const verifiedAt = new Date();
        const validUntil = new Date(verifiedAt.getTime() + GATEPASS_VALIDITY_MINUTES * 60 * 1000);
        const singleUseToken = `GP-CHK-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
        const norm = normalizeCategory(gatepass.leaveCategory);

        const updated = await prisma.$transaction(async (tx: any) => {
            const up = await tx.gatepassRequest.update({
                where: { id: gatepassId },
                data: {
                    status: 'ACTIVE_APPROVED',
                    approvedByBkId: bkUser?.id || null,
                    verifiedAt,
                    validUntil,
                    singleUseCheckoutToken: singleUseToken
                },
                include: { student: true, approvedByBk: true }
            });

            try {
                await tx.studentLeave.updateMany({
                    where: { studentId: gatepass.studentId, status: { in: ['submitted', 'approved_by_bk'] } },
                    data: {
                        status: 'approved_by_bk',
                        counselorId: bkUser?.id || null,
                        counselorNotes: counselorNotes || 'Disetujui Guru BK. Tunjukkan QR ke Satpam gerbang.',
                        approvedAt: verifiedAt
                    }
                });
            } catch (e) {}

            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'STUDENT',
                    studentId: gatepass.studentId,
                    studentName: studentName,
                    className: studentClass,
                    title: '✅ Dispensasi / Izin Disetujui Guru BK!',
                    message: `Permohonan Gatepass Anda telah disetujui Guru BK (${bkUser?.name || 'Guru BK'}). Buka aplikasi Smart CBT dan tunjukkan QR Code Anda kepada Petugas Keamanan (Satpam) di gerbang keluar sekolah.`,
                    category: 'STUDENT_LEAVE'
                }
            });

            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: gatepass.studentId,
                    studentName: studentName,
                    className: studentClass,
                    title: '🚨 Notifikasi Dispensasi Keluar Sekolah Disetujui',
                    message: `Pemberitahuan resmi: Permohonan izin keluar darurat ananda ${studentName} (${studentClass}) untuk alasan "${gatepass.reason}" telah disetujui oleh Guru BK (${bkUser?.name || 'BK'}) pada pukul ${verifiedAt.toLocaleTimeString('id-ID')} WIB. Penjemput: ${gatepass.pickupBy || 'Mandiri'}.`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'TEACHER',
                    studentId: gatepass.studentId,
                    studentName: studentName,
                    className: studentClass,
                    title: `📋 Izin Siswa Disetujui BK: ${studentName} (${studentClass})`,
                    message: `Pemberitahuan Wali Kelas: Permohonan izin keluar ${norm.label} untuk ananda ${studentName} (${studentClass}) telah diverifikasi & disetujui oleh Guru BK (${bkUser?.name || 'BK'}). Menunggu pemeriksaan keluar di Pos Satpam.`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            sendFcmToUser(
                gatepass.studentId,
                '✅ Dispensasi / Izin Disetujui Guru BK!',
                `Izin Anda (${norm.label}) telah disetujui. Tunjukkan QR Code Gatepass di HP kepada Satpam di pos gerbang sekolah.`,
                { type: 'GATEPASS_APPROVED', studentId: gatepass.studentId, gatepassId: gatepass.id }
            ).catch(() => null);

            return up;
        });

        return res.json({
            success: true,
            message: `Dispensasi siswa ${studentName} disetujui! Siswa kini memegang QR Code Dinamis untuk di-scan Satpam gerbang.`,
            data: updated
        });
    } catch (error: any) {
        console.error('Error updateGatepassStatusByBk:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memperbarui status gatepass.' });
    }
};

/**
 * 4. TRANSAKSI INTI: VERIFIKASI SCAN QR DINAMIS BK OLEH SISWA (ACTIVE_APPROVED)
 * POST /api/v1/gatepass/verify-by-scan
 * Mengubah status -> ACTIVE_APPROVED + 3 Trigger Otomatis dalam 1 Atomic Database Transaction:
 *   - Trigger 1: Auto-Sync Presensi Sisa Mata Pelajaran (SIAKAD) -> SICK / PERMISSION (Locked)
 *   - Trigger 2: Instant Push Notification ke Orang Tua (dengan Jam Keluar & Nama Guru BK)
 *   - Trigger 3: Penerbitan Digital Gatepass Card (#10B981) + Single-Use Checkout Token (Valid 30 Menit)
 */
export const verifyGatepassByBkScan = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        const { dynamicToken, qrSecretToken, gatepassId, leaveId } = req.body;
        const rawToken = String(dynamicToken || qrSecretToken || '').trim();

        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi siswa diperlukan.' });
        }

        if (!rawToken) {
            return res.status(400).json({ success: false, message: 'Token QR Ruang BK wajib dipindai.' });
        }

        // 1. Validasi Anti-Fraud Dynamic Rotating QR Token (Toleransi maks 45 detik)
        let verifiedBkUserId: string | null = null;
        let verifiedBkName = 'Guru BK';
        let verifiedRoomName = 'Ruang Konseling BK';

        if (rawToken.startsWith('SMARTCBT-BK-DYN:')) {
            const parts = rawToken.split(':');
            // Format: SMARTCBT-BK-DYN:<roomId>:<bkUserId>:<windowIndex>:<hmacHash>
            if (parts.length < 5) {
                return res.status(400).json({ success: false, message: 'Format Dynamic QR Token BK tidak valid.' });
            }
            const [, roomId, bkUserId, windowStr, providedHmac] = parts;
            const scannedWindow = parseInt(windowStr, 10);
            const currentWindow = Math.floor(Date.now() / ROTATION_WINDOW_MS);

            // Toleransi maksimum 1 window (45 detik) untuk mengatasi latensi jaringan
            if (isNaN(scannedWindow) || Math.abs(currentWindow - scannedWindow) > 1) {
                return res.status(403).json({
                    success: false,
                    code: 'QR_TOKEN_EXPIRED',
                    message: '⏳ Dynamic QR Token BK telah kedaluwarsa (> 45 detik). Silakan pindai ulang QR terbaru di layar Guru BK!'
                });
            }

            const expectedHmac = computeBkDynamicHmac(roomId, bkUserId, scannedWindow);
            if (providedHmac !== expectedHmac) {
                return res.status(403).json({
                    success: false,
                    code: 'QR_SIGNATURE_INVALID',
                    message: '⛔ Tanda tangan kriptografi QR BK tidak sah (Anti-Fraud Protection).'
                });
            }

            verifiedBkUserId = bkUserId;
            verifiedRoomName = roomId.replace(/_/g, ' ');
            const bkUserObj = await prisma.user.findUnique({ where: { id: bkUserId }, select: { name: true } });
            if (bkUserObj?.name) verifiedBkName = bkUserObj.name;
        } else {
            // Cek di tabel bk_active_tokens (jika memindai hash langsung) atau fallback ke bkStation
            const activeTokenRecord = await prisma.bkActiveToken.findFirst({
                where: {
                    currentTokenHash: rawToken,
                    expiresAt: { gte: new Date(Date.now() - 15000) } // 15s grace
                },
                include: { bkUser: { select: { id: true, name: true } } }
            });

            if (activeTokenRecord) {
                verifiedBkUserId = activeTokenRecord.bkUserId;
                verifiedBkName = activeTokenRecord.bkUser?.name || 'Guru BK';
            } else {
                const station = await (prisma as any).bkStation.findUnique({
                    where: { qrSecretToken: rawToken }
                });
                if (!station || !station.isActive) {
                    return res.status(403).json({
                        success: false,
                        message: 'QR Code Ruang BK tidak valid atau telah kedaluwarsa. Pastikan memindai Dynamic QR di layar Guru BK.'
                    });
                }
                verifiedRoomName = station.stationName;
            }
        }

        // 2. Cari permohonan Gatepass / StudentLeave aktif milik siswa hari ini
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        let gatepass = await prisma.gatepassRequest.findFirst({
            where: {
                studentId,
                ...(gatepassId ? { id: gatepassId } : {}),
                createdAt: { gte: todayStart, lte: todayEnd }
            },
            include: { student: true },
            orderBy: { createdAt: 'desc' }
        });

        // Jika siswa mengajukan lewat endpoint lama (studentLeave), otomatis buatkan/migrasi ke GatepassRequest
        if (!gatepass) {
            const legacyLeave = await (prisma as any).studentLeave.findFirst({
                where: {
                    studentId,
                    ...(leaveId ? { id: leaveId } : {}),
                    appliedAt: { gte: todayStart, lte: todayEnd }
                },
                include: { student: true },
                orderBy: { appliedAt: 'desc' }
            });

            if (!legacyLeave) {
                return res.status(404).json({
                    success: false,
                    message: 'Tidak ditemukan permohonan izin keluar yang aktif hari ini. Silakan isi formulir permohonan terlebih dahulu.'
                });
            }

            const norm = normalizeCategory(undefined, legacyLeave.leaveType);
            gatepass = await prisma.gatepassRequest.create({
                data: {
                    studentId,
                    leaveCategory: norm.leaveCategory,
                    reason: legacyLeave.reason,
                    pickupBy: legacyLeave.pickupPerson || 'Mandiri',
                    status: legacyLeave.status === 'approved_by_bk' ? 'WAITING_BK_SCAN' : 'PENDING',
                    approvedByBkId: legacyLeave.counselorId || verifiedBkUserId
                },
                include: { student: true }
            });
        }

        if (gatepass.status === 'REJECTED' || gatepass.status === 'EXPIRED') {
            return res.status(400).json({
                success: false,
                message: `Tiket Gatepass ini berstatus ${gatepass.status}. Silakan ajukan permohonan baru.`
            });
        }

        // Jika sudah ACTIVE_APPROVED dan belum expired, kembalikan data kartu aktif
        if (gatepass.status === 'ACTIVE_APPROVED' && gatepass.validUntil && gatepass.validUntil > new Date()) {
            const remainingSeconds = Math.max(0, Math.floor((gatepass.validUntil.getTime() - Date.now()) / 1000));
            return res.json({
                success: true,
                message: 'Digital Gatepass Anda sudah aktif.',
                data: formatGatepassResponse(gatepass, verifiedBkName, verifiedRoomName, remainingSeconds)
            });
        }

        const verifiedAt = new Date();
        const validUntil = new Date(verifiedAt.getTime() + GATEPASS_VALIDITY_MINUTES * 60 * 1000);
        const singleUseToken = `GP-CHK-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
        const norm = normalizeCategory(gatepass.leaveCategory);

        // 3. EKSEKUSI ATOMIC DATABASE TRANSACTION
        const updatedGatepass = await prisma.$transaction(async (tx: any) => {
            // A. Update GatepassRequest -> ACTIVE_APPROVED
            const updated = await tx.gatepassRequest.update({
                where: { id: gatepass!.id },
                data: {
                    status: 'ACTIVE_APPROVED',
                    approvedByBkId: verifiedBkUserId || gatepass!.approvedByBkId,
                    verifiedAt,
                    validUntil,
                    singleUseCheckoutToken: singleUseToken
                },
                include: {
                    student: true,
                    approvedByBk: { select: { id: true, name: true } }
                }
            });

            // Sinkronisasi ke tabel StudentLeave
            await tx.studentLeave.updateMany({
                where: {
                    studentId,
                    appliedAt: { gte: todayStart, lte: todayEnd }
                },
                data: {
                    status: 'checked_out',
                    checkedOutAt: verifiedAt,
                    counselorId: verifiedBkUserId || gatepass!.approvedByBkId
                }
            });

            // B. TRIGGER 1: Auto-Update Presensi Sisa Mata Pelajaran Hari Itu (SIAKAD Sync)
            if (gatepass!.student.className) {
                // 1) Tabel ClassPeriodAttendance
                const classSessions = await tx.classPeriodSession.findMany({
                    where: { className: gatepass!.student.className }
                });
                for (const sess of classSessions) {
                    await tx.classPeriodAttendance.upsert({
                        where: {
                            sessionId_studentId: {
                                sessionId: sess.id,
                                studentId
                            }
                        },
                        update: {
                            status: norm.attendanceStatus,
                            method: 'BK_GATEPASS'
                        },
                        create: {
                            sessionId: sess.id,
                            studentId,
                            studentName: gatepass!.student.name,
                            className: gatepass!.student.className,
                            status: norm.attendanceStatus,
                            method: 'BK_GATEPASS'
                        }
                    });
                }

                // 2) Tabel StudentSubjectAttendance (Sesi mengajar hari ini)
                const activeTeachingSessions = await tx.teachingSession.findMany({
                    where: {
                        className: gatepass!.student.className,
                        startedAt: { gte: todayStart, lte: todayEnd }
                    }
                });
                for (const tSess of activeTeachingSessions) {
                    await tx.studentSubjectAttendance.upsert({
                        where: {
                            sessionId_studentId: {
                                sessionId: tSess.id,
                                studentId
                            }
                        },
                        update: {
                            status: norm.attendanceStatus,
                            isLockedByGate: true,
                            notes: `[Gatepass BK: ${norm.label}] Diverifikasi oleh ${verifiedBkName} (${verifiedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB)`
                        },
                        create: {
                            sessionId: tSess.id,
                            studentId,
                            status: norm.attendanceStatus,
                            morningGateStatus: norm.attendanceStatus,
                            isLockedByGate: true,
                            notes: `[Gatepass BK: ${norm.label}] Diverifikasi oleh ${verifiedBkName}`
                        }
                    });
                }
            }

            // C. Status Keluar Gerbang (GATE_OUT) dicatat secara resmi oleh Satpam saat checkout di gerbang sekolah
            // Mencegah duplikasi catatan GATE_OUT ganda antara Ruang BK dan Pos Satpam.

            // D. TRIGGER 2: Instant Push Notification ke Orang Tua Siswa
            const timeFormatted = verifiedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId,
                    studentName: gatepass!.student.name,
                    className: gatepass!.student.className || '-',
                    title: `🕊️ [SIBOY IZIN RESMI] Ananda Diizinkan Pulang Lebih Awal via BK`,
                    message: `Yth. Bapak/Ibu Wali Murid dari ananda ${gatepass!.student.name} (Kelas ${gatepass!.student.className || '-'}):\n\n` +
                             `Kami menginformasikan bahwa ananda telah diverifikasi secara sah di Ruang Konseling BK untuk meninggalkan sekolah lebih awal:\n` +
                             `• Waktu Persetujuan: ${timeFormatted} WIB\n` +
                             `• Kategori Izin: ${norm.label}\n` +
                             `• Alasan / Keterangan: ${gatepass!.reason}\n` +
                             `• Guru BK Pemverifikasi: ${verifiedBkName}\n` +
                             `• Penjemput: ${gatepass!.pickupBy || 'Mandiri'}\n\n` +
                             `Ananda memegang Tiket Digital Gatepass untuk pemeriksaan akhir di Pos Keamanan SMP Negeri 1 Boyolangu. Mohon pantau kepulangan ananda hingga tiba di rumah. Terima kasih.`,
                    category: 'STUDENT_LEAVE'
                }
            });

            return updated;
        });

        const remainingSeconds = GATEPASS_VALIDITY_MINUTES * 60;
        const formatted = formatGatepassResponse(
            updatedGatepass,
            updatedGatepass.approvedByBk?.name || verifiedBkName,
            verifiedRoomName,
            remainingSeconds
        );

        return res.json({
            success: true,
            message: '🎉 Verifikasi QR Ruang BK Berhasil! Kartu Digital Gatepass Hijau (#10B981) telah aktif selama 30 menit.',
            data: formatted,
            exitPass: formatted
        });
    } catch (error: any) {
        console.error('Error verifyGatepassByBkScan:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Gagal memverifikasi scan QR Ruang BK.'
        });
    }
};

/**
 * 5. CHECKOUT GERBANG SEKOLAH OLEH SATPAM (SINGLE-USE CHECKOUT QR)
 * POST /api/v1/satpam/gatepass/checkout
 * Memvalidasi bahwa status == ACTIVE_APPROVED dan valid_until > now(), lalu mengunci status -> COMPLETED
 */
export const checkoutGatepassBySatpam = async (req: Request, res: Response) => {
    try {
        const satpamUser = (req as any).user;
        const { checkoutToken, qrPayload } = req.body;
        let rawInput = String(checkoutToken || qrPayload || '').trim();

        if (!rawInput) {
            return res.status(400).json({
                success: false,
                message: 'Token QR Checkout Gatepass wajib dipindai oleh Satpam.'
            });
        }

        // Jika pindaian berupa Kartu Pelajar (STUDENT_MEMBER:<id>:<nisn>:...)
        if (rawInput.startsWith('STUDENT_MEMBER:')) {
            const sparts = rawInput.split(':');
            rawInput = sparts[2] || sparts[1] || rawInput;
        }

        // Ekstrak token jika berformat SMARTCBT-GATEPASS-DYN:... atau SMARTCBT-EXITPASS:... atau SMARTCBT-GATEPASS:...
        let lookupToken = rawInput;
        let lookupId: string | null = null;
        if (rawInput.startsWith('SMARTCBT-GATEPASS-DYN:')) {
            const parts = rawInput.split(':');
            lookupId = parts[1] || null;
            lookupToken = parts[2] || rawInput;
        } else if (rawInput.startsWith('SMARTCBT-GATEPASS:')) {
            const parts = rawInput.split(':');
            lookupToken = parts[1] || rawInput;
            lookupId = parts[2] || null;
        } else if (rawInput.startsWith('SMARTCBT-EXITPASS:')) {
            const parts = rawInput.split(':');
            lookupId = parts[1] || null;
            lookupToken = parts[2] || rawInput;
        }

        const gatepass = await prisma.gatepassRequest.findFirst({
            where: {
                OR: [
                    { singleUseCheckoutToken: lookupToken },
                    ...(lookupId ? [{ id: lookupId }] : []),
                    { id: rawInput }
                ]
            },
            include: {
                student: {
                    select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true, parentPhone: true }
                },
                approvedByBk: {
                    select: { id: true, name: true }
                }
            }
        });

        if (!gatepass) {
            return res.status(404).json({
                success: false,
                code: 'GATEPASS_NOT_FOUND',
                message: '⛔ Tiket Digital Gatepass tidak ditemukan di database! Dilarang mengizinkan siswa keluar.'
            });
        }

        if (gatepass.status === 'COMPLETED') {
            return res.status(400).json({
                success: false,
                code: 'GATEPASS_ALREADY_USED',
                message: `⚠️ Tiket Gatepass ini SUDAH DIGUNAKAN (Single-Use) pada pukul ${gatepass.exitTimestamp ? new Date(gatepass.exitTimestamp).toLocaleTimeString('id-ID') : '-'} WIB.`
            });
        }

        if (gatepass.status !== 'ACTIVE_APPROVED') {
            return res.status(403).json({
                success: false,
                code: 'GATEPASS_NOT_ACTIVE',
                message: `⛔ Status Gatepass siswa adalah [${gatepass.status}]. Siswa belum melakukan verifikasi scan di Ruang BK!`
            });
        }

        const now = new Date();
        if (gatepass.validUntil && gatepass.validUntil < now) {
            await prisma.gatepassRequest.update({
                where: { id: gatepass.id },
                data: { status: 'EXPIRED' }
            });
            return res.status(403).json({
                success: false,
                code: 'GATEPASS_EXPIRED',
                message: '⏳ Batas waktu 30 menit Digital Gatepass telah HABIS (EXPIRED)! Siswa wajib kembali ke Ruang BK untuk perpanjangan izin.'
            });
        }

        const norm = normalizeCategory(gatepass.leaveCategory);
        const satpamName = satpamUser?.name || 'Petugas Keamanan (Satpam)';

        const completedGatepass = await prisma.$transaction(async (tx: any) => {
            let satpamIdToSave: string | null = null;
            if (satpamUser?.id) {
                const satpamExists = await tx.user.findUnique({ where: { id: satpamUser.id }, select: { id: true } });
                if (satpamExists) satpamIdToSave = satpamExists.id;
            }

            // K-1 ATOMIC CONDITIONAL UPDATE: Mencegah race condition dari 2 scan checkout simultan
            const updateResult = await tx.gatepassRequest.updateMany({
                where: {
                    id: gatepass.id,
                    status: 'ACTIVE_APPROVED',
                    OR: [
                        { validUntil: null },
                        { validUntil: { gte: now } }
                    ]
                },
                data: {
                    status: 'COMPLETED',
                    exitTimestamp: now,
                    checkoutSatpamId: satpamIdToSave
                }
            });

            if (updateResult.count === 0) {
                const currentStatus = await tx.gatepassRequest.findUnique({
                    where: { id: gatepass.id },
                    select: { status: true, exitTimestamp: true, validUntil: true }
                });

                if (currentStatus?.status === 'COMPLETED') {
                    const err: any = new Error('GATEPASS_ALREADY_USED');
                    err.code = 'GATEPASS_ALREADY_USED';
                    err.exitTimestamp = currentStatus.exitTimestamp;
                    throw err;
                }
                if (currentStatus?.validUntil && currentStatus.validUntil < now) {
                    const err: any = new Error('GATEPASS_EXPIRED');
                    err.code = 'GATEPASS_EXPIRED';
                    throw err;
                }
                const err: any = new Error('GATEPASS_NOT_ACTIVE');
                err.code = 'GATEPASS_NOT_ACTIVE';
                throw err;
            }

            const updated = await tx.gatepassRequest.findUnique({
                where: { id: gatepass.id },
                include: {
                    student: { select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true, parentPhone: true } },
                    approvedByBk: { select: { id: true, name: true } },
                    checkoutSatpam: { select: { id: true, name: true } }
                }
            });

            // 1. Catat Presensi Gerbang Keluar (GATE_OUT) secara Idempoten (hanya 1 catatan per hari)
            const wibOffsetMs = 7 * 60 * 60 * 1000;
            const wibNow = new Date(now.getTime() + wibOffsetMs);
            const dateKey = wibNow.toISOString().split('T')[0];
            const todayStart = new Date(`${dateKey}T00:00:00.000+07:00`);
            const todayEnd = new Date(`${dateKey}T23:59:59.999+07:00`);

            const existingGateOut = await tx.attendance.findFirst({
                where: {
                    userId: gatepass.studentId,
                    type: 'GATE_OUT',
                    scanTime: { gte: todayStart, lte: todayEnd }
                }
            });

            if (!existingGateOut) {
                await tx.attendance.create({
                    data: {
                        userId: gatepass.studentId,
                        type: 'GATE_OUT',
                        method: 'SATPAM_QR_SCAN',
                        status: norm.attendanceStatus,
                        scanTime: now,
                        note: `[Checkout Gerbang Satpam: ${satpamName}] Gatepass Disetujui BK (${gatepass.approvedByBk?.name || 'Guru BK'}). Kategori: ${norm.label}. Alasan: ${gatepass.reason}. Penjemput: ${gatepass.pickupBy || 'Mandiri'}`
                    }
                });
            }

            try {
                const activeTeachingSessions = await tx.teachingSession.findMany({
                    where: {
                        className: gatepass.student.className,
                        startedAt: { gte: todayStart, lte: todayEnd }
                    }
                });
                for (const tSess of activeTeachingSessions) {
                    await tx.studentSubjectAttendance.upsert({
                        where: {
                            sessionId_studentId: {
                                sessionId: tSess.id,
                                studentId: gatepass.studentId
                            }
                        },
                        update: {
                            status: norm.attendanceStatus,
                            isLockedByGate: true,
                            notes: `[Gatepass BK: ${norm.label}] Checkout Satpam (${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB)`
                        },
                        create: {
                            sessionId: tSess.id,
                            studentId: gatepass.studentId,
                            status: norm.attendanceStatus,
                            morningGateStatus: norm.attendanceStatus,
                            isLockedByGate: true,
                            notes: `[Gatepass BK: ${norm.label}] Checkout Satpam`
                        }
                    });
                }
            } catch (sessErr) {}

            const exitTimeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

            // Lookup penerima spesifik
            const parentUser = await tx.user.findFirst({
                where: {
                    role: 'PARENT',
                    OR: [
                        ...(gatepass.student.nisn ? [{ nisn: gatepass.student.nisn }, { username: `P${gatepass.student.nisn}` }, { username: gatepass.student.nisn }] : []),
                        ...(gatepass.student.parentPhone ? [{ username: gatepass.student.parentPhone }] : [])
                    ]
                },
                select: { id: true }
            }).catch(() => null);

            let waliKelasUser: any = null;
            if (gatepass.student.className) {
                waliKelasUser = await tx.user.findFirst({
                    where: {
                        role: 'TEACHER',
                        OR: [
                            { teachingClasses: { contains: gatepass.student.className } },
                            { tugasTambahan: { contains: 'WALI_KELAS' } }
                        ]
                    },
                    select: { id: true }
                }).catch(() => null);
            }

            let counselorUserId = gatepass.approvedByBkId;
            if (!counselorUserId && gatepass.student.className) {
                const classRow = await tx.class.findUnique({
                    where: { name: gatepass.student.className },
                    select: { counselorId: true }
                }).catch(() => null);
                counselorUserId = classRow?.counselorId || null;
            }
            if (!counselorUserId) {
                const defaultBk = await tx.user.findFirst({
                    where: { role: 'COUNSELOR', isActive: true },
                    select: { id: true }
                }).catch(() => null);
                counselorUserId = defaultBk?.id || null;
            }
            
            // Notifikasi ke Orang Tua
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    recipientId: parentUser?.id || null,
                    studentId: gatepass.studentId,
                    studentName: gatepass.student.name,
                    className: gatepass.student.className || '-',
                    title: `🚪 Siswa Telah Melewati Pos Keamanan: ${gatepass.student.name}`,
                    message: `Konfirmasi Pos Keamanan: Ananda ${gatepass.student.name} (${gatepass.student.className || '-'}) telah melewati gerbang utama sekolah pada pukul ${exitTimeStr} WIB (Diverifikasi Satpam: ${satpamName}). Status Izin: ${norm.label}. Alasan: ${gatepass.reason}. Penjemput: ${gatepass.pickupBy || 'Mandiri'}.`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            // Notifikasi ke Siswa
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'STUDENT',
                    recipientId: gatepass.studentId,
                    studentId: gatepass.studentId,
                    studentName: gatepass.student.name,
                    className: gatepass.student.className || '-',
                    title: `🚪 Checkout Gerbang Berhasil (${norm.label})`,
                    message: `Tiket Gatepass Anda telah diverifikasi oleh Satpam (${satpamName}) pada pukul ${exitTimeStr} WIB. Anda resmi meninggalkan lingkungan sekolah. Hati-hati di jalan!`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            // Notifikasi ke Wali Kelas
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'TEACHER',
                    recipientId: waliKelasUser?.id || null,
                    studentId: gatepass.studentId,
                    studentName: gatepass.student.name,
                    className: gatepass.student.className || '-',
                    title: `🚪 Siswa Kelas Anda Keluar Gerbang: ${gatepass.student.name} (${gatepass.student.className || '-'})`,
                    message: `Laporan Pos Satpam: Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) telah meninggalkan sekolah melalui Pos Keamanan (Satpam: ${satpamName}) pada pukul ${exitTimeStr} WIB.\n• Status Izin: ${norm.label}\n• Alasan: ${gatepass.reason}\n• Penjemput: ${gatepass.pickupBy || 'Mandiri'}`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            // Notifikasi ke Guru BK
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'COUNSELOR',
                    recipientId: counselorUserId || null,
                    studentId: gatepass.studentId,
                    studentName: gatepass.student.name,
                    className: gatepass.student.className || '-',
                    title: `🚪 Siswa Bimbingan Telah Checkout Satpam: ${gatepass.student.name}`,
                    message: `Konfirmasi Satpam: Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) telah dipindai dan keluar melalui pos gerbang oleh Satpam (${satpamName}) pada pukul ${exitTimeStr} WIB. Kategori: ${norm.label}.`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            // Kirim Push Notification FCM ke Siswa
            sendFcmToUser(
                gatepass.studentId,
                `🚪 Checkout Gerbang Berhasil (${norm.label})`,
                `Tiket Gatepass diverifikasi Satpam (${satpamName}) pada ${exitTimeStr} WIB. Hati-hati di jalan!`,
                { type: 'GATEPASS_CHECKOUT', studentId: gatepass.studentId, gatepassId: gatepass.id }
            ).catch(() => null);

            // Kirim Push Notification FCM ke Orang Tua
            if (parentUser?.id) {
                sendFcmToUser(
                    parentUser.id,
                    `🚪 Siswa Telah Melewati Pos Keamanan: ${gatepass.student.name}`,
                    `Konfirmasi Satpam: Ananda ${gatepass.student.name} (${gatepass.student.className || '-'}) keluar gerbang pada ${exitTimeStr} WIB (${norm.label}).`,
                    { type: 'GATEPASS_CHECKOUT', studentId: gatepass.studentId, gatepassId: gatepass.id }
                ).catch(() => null);
            }

            // Kirim Push Notification FCM ke Wali Kelas
            if (waliKelasUser?.id) {
                sendFcmToUser(
                    waliKelasUser.id,
                    `🚪 Siswa Kelas Anda Keluar Gerbang: ${gatepass.student.name}`,
                    `Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) telah meninggalkan sekolah (${norm.label}).`,
                    { type: 'GATEPASS_CHECKOUT', studentId: gatepass.studentId, gatepassId: gatepass.id }
                ).catch(() => null);
            }

            // Kirim Push Notification FCM ke Guru BK
            if (counselorUserId) {
                sendFcmToUser(
                    counselorUserId,
                    `🚪 Siswa Bimbingan Telah Checkout Satpam: ${gatepass.student.name}`,
                    `Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) telah checkout satpam (${norm.label}).`,
                    { type: 'GATEPASS_CHECKOUT', studentId: gatepass.studentId, gatepassId: gatepass.id }
                ).catch(() => null);
            }

            return updated;
        });

        return res.json({
            success: true,
            message: `✅ Checkout Gerbang SAH! Siswa ${completedGatepass.student.name} (${completedGatepass.student.className || '-'}) diizinkan keluar area sekolah.`,
            data: completedGatepass
        });
    } catch (error: any) {
        console.error('Error checkoutGatepassBySatpam:', error);
        if (error.code === 'GATEPASS_ALREADY_USED') {
            return res.status(400).json({
                success: false,
                code: 'GATEPASS_ALREADY_USED',
                message: `⚠️ Tiket Gatepass ini SUDAH DIGUNAKAN (Single-Use) pada pukul ${error.exitTimestamp ? new Date(error.exitTimestamp).toLocaleTimeString('id-ID') : '-'} WIB.`
            });
        }
        if (error.code === 'GATEPASS_EXPIRED') {
            return res.status(403).json({
                success: false,
                code: 'GATEPASS_EXPIRED',
                message: '⏳ Batas waktu 30 menit Digital Gatepass telah HABIS (EXPIRED)! Siswa wajib kembali ke Ruang BK untuk perpanjangan izin.'
            });
        }
        if (error.code === 'GATEPASS_NOT_ACTIVE') {
            return res.status(403).json({
                success: false,
                code: 'GATEPASS_NOT_ACTIVE',
                message: '⛔ Status Gatepass siswa belum aktif atau belum diverifikasi di Ruang BK!'
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Gagal memproses checkout gerbang satpam.'
        });
    }
};

/**
 * GENERATE DYNAMIC SINGLE-USE QR CODE FOR STUDENT GATEPASS
 * GET /api/gatepass/dynamic-qr/:id
 * Dilengkapi rolling HMAC token anti-screenshot (rotasi setiap 30 detik)
 */
export const generateGatepassDynamicQr = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const user = (req as any).user;

        const gatepass = await prisma.gatepassRequest.findUnique({
            where: { id },
            include: {
                student: {
                    select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true }
                },
                approvedByBk: { select: { id: true, name: true } }
            }
        });

        if (!gatepass) {
            return res.status(404).json({ success: false, message: 'Data Gatepass tidak ditemukan.' });
        }

        // Otorisasi: Siswa hanya boleh meminta QR untuk tiketnya sendiri; Staff/Admin/Satpam/BK diizinkan
        const allowedStaffRoles = ['ADMIN', 'OPERATOR', 'COUNSELOR', 'SATPAM', 'SECURITY'];
        if (user && user.role === 'PARENT') {
            return res.status(403).json({
                success: false,
                message: 'Digital Gatepass tidak berlaku untuk akun Orang Tua.'
            });
        }
        if (user && !allowedStaffRoles.includes(user.role)) {
            if (user.role === 'STUDENT' && gatepass.studentId !== user.id) {
                return res.status(403).json({ success: false, message: 'Akses ditolak. Anda hanya dapat melihat QR tiket Anda sendiri.' });
            } else if (user.role !== 'STUDENT') {
                return res.status(403).json({ success: false, message: 'Akses ditolak.' });
            }
        }

        const now = new Date();
        const nowMs = now.getTime();

        if (gatepass.status === 'COMPLETED') {
            return res.status(400).json({
                success: false,
                code: 'GATEPASS_ALREADY_USED',
                message: 'Tiket Gatepass ini sudah digunakan (Siswa telah keluar area sekolah).'
            });
        }

        if (gatepass.status === 'REJECTED') {
            return res.status(400).json({
                success: false,
                code: 'GATEPASS_REJECTED',
                message: 'Permohonan Gatepass telah ditolak oleh Guru BK.'
            });
        }

        if (gatepass.status === 'PENDING' || gatepass.status === 'WAITING_BK_SCAN') {
            return res.status(400).json({
                success: false,
                code: 'GATEPASS_NOT_APPROVED',
                message: 'Permohonan Gatepass belum disetujui tatap muka di Ruang BK.'
            });
        }

        // Cek kedaluwarsa jika ACTIVE_APPROVED
        if (gatepass.validUntil && gatepass.validUntil < now) {
            await prisma.gatepassRequest.update({
                where: { id: gatepass.id },
                data: { status: 'EXPIRED' }
            });
            return res.status(403).json({
                success: false,
                code: 'GATEPASS_EXPIRED',
                message: 'Batas waktu berlaku Digital Gatepass telah habis (EXPIRED).'
            });
        }

        let checkoutToken = gatepass.singleUseCheckoutToken;
        if (!checkoutToken) {
            checkoutToken = `GP-CHK-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
            await prisma.gatepassRequest.update({
                where: { id: gatepass.id },
                data: { singleUseCheckoutToken: checkoutToken }
            });
        }

        const DYN_ROTATION_MS = 30 * 1000; // 30 detik rotasi anti-screenshot
        const windowIndex = Math.floor(nowMs / DYN_ROTATION_MS);
        const nextWindowMs = (windowIndex + 1) * DYN_ROTATION_MS;
        const ttlSeconds = Math.max(1, Math.ceil((nextWindowMs - nowMs) / 1000));
        const remainingSeconds = gatepass.validUntil
            ? Math.max(0, Math.floor((gatepass.validUntil.getTime() - nowMs) / 1000))
            : 0;

        const hmac = computeGatepassDynamicHmac(gatepass.id, checkoutToken, windowIndex);
        const qrPayload = `SMARTCBT-GATEPASS-DYN:${gatepass.id}:${checkoutToken}:${windowIndex}:${hmac}`;

        const norm = normalizeCategory(gatepass.leaveCategory);

        return res.json({
            success: true,
            message: 'Dynamic QR Gatepass berhasil digenerate.',
            data: {
                gatepassId: gatepass.id,
                leaveId: gatepass.id,
                studentId: gatepass.studentId,
                studentName: gatepass.student.name,
                className: gatepass.student.className || '-',
                nisn: gatepass.student.nisn || '-',
                profilePicUrl: gatepass.student.profilePicUrl,
                leaveCategory: gatepass.leaveCategory,
                categoryLabel: norm.label,
                reason: gatepass.reason,
                pickupBy: gatepass.pickupBy || 'Mandiri',
                qrPayload,
                checkoutToken,
                singleUseCheckoutToken: checkoutToken,
                windowIndex,
                timestamp: nowMs,
                ttlSeconds,
                rotationIntervalSeconds: 30,
                validUntil: gatepass.validUntil,
                remainingSeconds,
                approvedByBk: gatepass.approvedByBk?.name || 'Guru BK',
                verifiedAt: gatepass.verifiedAt,
                status: gatepass.status,
                antiScreenshotWatermark: {
                    studentName: gatepass.student.name,
                    serverTime: now.toISOString(),
                    windowIndex
                }
            }
        });
    } catch (error: any) {
        console.error('Error generateGatepassDynamicQr:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal generate Dynamic QR Gatepass.' });
    }
};

/**
 * VERIFIKASI & SCAN GATEPASS OLEH SATPAM / PETUGAS KEAMANAN
 * POST /api/gatepass/verify-scan
 * Mendukung scan Dynamic QR anti-screenshot maupun Single-Use QR standard
 * Mendukung aksi: CHECKOUT (keluar) dan RETURN (kembali ke sekolah)
 */
export const verifyGatepassScan = async (req: Request, res: Response) => {
    try {
        let satpamUser = (req as any).user;
        if (!satpamUser) {
            const tok = extractWebToken(req);
            if (tok) {
                try {
                    satpamUser = jwt.verify(tok, getJwtSecret());
                } catch (e) {}
            }
        }
        const { qrPayload, token, checkoutToken, gatepassId, action, satpamNotes } = req.body;
        let rawInput = String(qrPayload || checkoutToken || token || gatepassId || '').trim();
        const currentAction = (action || 'CHECKOUT').toUpperCase();

        if (!rawInput) {
            return res.status(400).json({
                success: false,
                message: 'QR Code, Token Gatepass, atau NISN Siswa wajib dikirim.'
            });
        }

        // Jika pindaian berupa Kartu Pelajar (STUDENT_MEMBER:<id>:<nisn>:...)
        if (rawInput.startsWith('STUDENT_MEMBER:')) {
            const sparts = rawInput.split(':');
            rawInput = sparts[2] || sparts[1] || rawInput;
        }

        let lookupToken = rawInput;
        let lookupId: string | null = null;

        // 1. Periksa apakah QR merupakan Dynamic QR anti-screenshot
        if (rawInput.startsWith('SMARTCBT-GATEPASS-DYN:')) {
            const parts = rawInput.split(':');
            // Format: SMARTCBT-GATEPASS-DYN:<id>:<checkoutToken>:<windowIndex>:<hmac>
            if (parts.length >= 5) {
                lookupId = parts[1];
                lookupToken = parts[2];
                const windowIndex = parseInt(parts[3], 10);
                const providedHmac = parts[4];

                const DYN_ROTATION_MS = 30 * 1000;
                const currentWindow = Math.floor(Date.now() / DYN_ROTATION_MS);

                // Toleransi +/- 1 window (30-60 detik) untuk mengatasi latensi jaringan
                if (isNaN(windowIndex) || Math.abs(currentWindow - windowIndex) > 1) {
                    return res.status(403).json({
                        success: false,
                        code: 'QR_TOKEN_EXPIRED',
                        message: '⏳ Dynamic QR Gatepass telah kedaluwarsa (> 30 detik). Mintalah siswa merefresh QR terbaru (Anti-Screenshot Protection).'
                    });
                }

                const expectedHmac = computeGatepassDynamicHmac(lookupId, lookupToken, windowIndex);
                if (providedHmac !== expectedHmac) {
                    return res.status(403).json({
                        success: false,
                        code: 'QR_SIGNATURE_INVALID',
                        message: '⛔ QR Code Tidak Sah! Tanda tangan kriptografi anti-screenshot tidak cocok.'
                    });
                }
            } else if (parts.length >= 3) {
                lookupId = parts[1];
                lookupToken = parts[2];
            }
        } else if (rawInput.startsWith('SMARTCBT-GATEPASS:')) {
            const parts = rawInput.split(':');
            lookupToken = parts[1] || rawInput;
            lookupId = parts[2] || null;
        } else if (rawInput.startsWith('SMARTCBT-EXITPASS:')) {
            const parts = rawInput.split(':');
            lookupId = parts[1] || null;
            lookupToken = parts[2] || rawInput;
        }

        let gatepass = await prisma.gatepassRequest.findFirst({
            where: {
                OR: [
                    { singleUseCheckoutToken: lookupToken },
                    ...(lookupId ? [{ id: lookupId }] : []),
                    { id: rawInput }
                ]
            },
            include: {
                student: {
                    select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true, parentPhone: true }
                },
                approvedByBk: {
                    select: { id: true, name: true }
                },
                checkoutSatpam: {
                    select: { id: true, name: true }
                }
            }
        });

        // Fallback: Jika tidak ditemukan via Token/ID, cari berdasarkan NISN / Username siswa hari ini
        if (!gatepass) {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            gatepass = await prisma.gatepassRequest.findFirst({
                where: {
                    createdAt: { gte: todayStart },
                    student: {
                        OR: [
                            { nisn: rawInput },
                            { username: rawInput },
                            { id: rawInput }
                        ]
                    }
                },
                include: {
                    student: {
                        select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true, parentPhone: true }
                    },
                    approvedByBk: {
                        select: { id: true, name: true }
                    },
                    checkoutSatpam: {
                        select: { id: true, name: true }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });
        }

        if (!gatepass) {
            return res.status(404).json({
                success: false,
                code: 'GATEPASS_NOT_FOUND',
                message: '⛔ Tiket Digital Gatepass tidak ditemukan di database! Dilarang mengizinkan siswa keluar.'
            });
        }

        const now = new Date();
        const norm = normalizeCategory(gatepass.leaveCategory);
        const satpamName = satpamUser?.name || 'Petugas Keamanan (Satpam)';
        const exitTimeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        // JIKA AKSI ADALAH SISWA KEMBALI KE SEKOLAH (RETURN)
        if (currentAction === 'RETURN') {
            await prisma.$transaction(async (tx: any) => {
                await tx.attendance.create({
                    data: {
                        userId: gatepass.studentId,
                        type: 'GATE_IN',
                        method: 'SATPAM_RETURN_SCAN',
                        status: 'PRESENT',
                        scanTime: now,
                        note: `[Kembali ke Sekolah - Satpam: ${satpamName}] Siswa telah kembali ke sekolah setelah Gatepass (${norm.label}). ${satpamNotes || ''}`
                    }
                });

                await tx.notificationMessage.create({
                    data: {
                        recipientRole: 'PARENT',
                        studentId: gatepass.studentId,
                        studentName: gatepass.student.name,
                        className: gatepass.student.className || '-',
                        title: `🏫 Siswa Telah Kembali ke Sekolah: ${gatepass.student.name}`,
                        message: `Pemberitahuan Pos Keamanan: Ananda ${gatepass.student.name} (${gatepass.student.className || '-'}) telah kembali ke area sekolah pada pukul ${exitTimeStr} WIB (Diverifikasi Satpam: ${satpamName}).`,
                        category: 'STUDENT_LEAVE'
                    }
                }).catch(() => null);

                await tx.notificationMessage.create({
                    data: {
                        recipientRole: 'STUDENT',
                        studentId: gatepass.studentId,
                        studentName: gatepass.student.name,
                        className: gatepass.student.className || '-',
                        title: `🏫 Selamat Datang Kembali di Sekolah`,
                        message: `Verifikasi Pos Keamanan berhasil. Anda telah tercatat kembali ke area sekolah pada pukul ${exitTimeStr} WIB oleh Satpam (${satpamName}). Silakan melanjutkan KBM.`,
                        category: 'STUDENT_LEAVE'
                    }
                }).catch(() => null);

                await tx.notificationMessage.create({
                    data: {
                        recipientRole: 'TEACHER',
                        studentId: gatepass.studentId,
                        studentName: gatepass.student.name,
                        className: gatepass.student.className || '-',
                        title: `🏫 Siswa Kelas Anda Telah Kembali: ${gatepass.student.name} (${gatepass.student.className || '-'})`,
                        message: `Laporan Pos Satpam: Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) yang sebelumnya izin ${norm.label} telah kembali ke lingkungan sekolah pada pukul ${exitTimeStr} WIB.`,
                        category: 'STUDENT_LEAVE'
                    }
                }).catch(() => null);

                await tx.notificationMessage.create({
                    data: {
                        recipientRole: 'COUNSELOR',
                        studentId: gatepass.studentId,
                        studentName: gatepass.student.name,
                        className: gatepass.student.className || '-',
                        title: `🏫 Siswa Bimbingan Telah Kembali: ${gatepass.student.name}`,
                        message: `Konfirmasi Satpam: Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) telah diverifikasi kembali ke sekolah pada pukul ${exitTimeStr} WIB.`,
                        category: 'STUDENT_LEAVE'
                    }
                }).catch(() => null);

                sendFcmToUser(
                    gatepass.studentId,
                    `🏫 Selamat Datang Kembali di Sekolah`,
                    `Verifikasi kedatangan kembali oleh Satpam (${satpamName}) pada ${exitTimeStr} WIB berhasil.`,
                    { type: 'GATEPASS_RETURN', studentId: gatepass.studentId, gatepassId: gatepass.id }
                ).catch(() => null);
            });

            return res.json({
                success: true,
                action: 'RETURN',
                message: `✅ Verifikasi Kembali SAH! Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) telah kembali ke area sekolah.`,
                data: {
                    ...gatepass,
                    returnTime: now,
                    returnVerifiedBy: satpamName
                }
            });
        }

        // AKSI CHECKOUT (SISWA KELUAR GERBANG)
        if (gatepass.status === 'COMPLETED') {
            return res.status(400).json({
                success: false,
                code: 'GATEPASS_ALREADY_USED',
                message: `⚠️ Tiket Gatepass ini SUDAH DIGUNAKAN pada pukul ${gatepass.exitTimestamp ? new Date(gatepass.exitTimestamp).toLocaleTimeString('id-ID') : '-'} WIB (Single-Use). Dilarang digunakan berulang!`,
                data: gatepass
            });
        }

        if (gatepass.status !== 'ACTIVE_APPROVED') {
            return res.status(403).json({
                success: false,
                code: 'GATEPASS_NOT_ACTIVE',
                message: `⛔ Status Gatepass siswa adalah [${gatepass.status}]. Siswa belum melakukan verifikasi scan tatap muka di Ruang BK!`,
                data: gatepass
            });
        }

        if (gatepass.validUntil && gatepass.validUntil < now) {
            await prisma.gatepassRequest.update({
                where: { id: gatepass.id },
                data: { status: 'EXPIRED' }
            });
            return res.status(403).json({
                success: false,
                code: 'GATEPASS_EXPIRED',
                message: '⏳ Batas waktu Digital Gatepass telah HABIS (EXPIRED). Siswa wajib melapor kembali ke Ruang BK!',
                data: gatepass
            });
        }

        const completedGatepass = await prisma.$transaction(async (tx: any) => {
            let satpamIdToSave: string | null = null;
            if (satpamUser?.id) {
                const satpamExists = await tx.user.findUnique({ where: { id: satpamUser.id }, select: { id: true } });
                if (satpamExists) satpamIdToSave = satpamExists.id;
            }

            const updated = await tx.gatepassRequest.update({
                where: { id: gatepass.id },
                data: {
                    status: 'COMPLETED',
                    exitTimestamp: now,
                    checkoutSatpamId: satpamIdToSave
                },
                include: {
                    student: { select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true, parentPhone: true } },
                    approvedByBk: { select: { id: true, name: true } },
                    checkoutSatpam: { select: { id: true, name: true } }
                }
            });

            // Catat presensi GATE_OUT
            await tx.attendance.create({
                data: {
                    userId: gatepass.studentId,
                    type: 'GATE_OUT',
                    method: 'SATPAM_QR_SCAN',
                    status: norm.attendanceStatus,
                    scanTime: now,
                    note: `[Verifikasi Gerbang Satpam: ${satpamName}] Izin: ${norm.label}. Alasan: ${gatepass.reason}. Penjemput: ${gatepass.pickupBy || 'Mandiri'}. ${satpamNotes || ''}`
                }
            });

            // Notifikasi ke Orang Tua
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: gatepass.studentId,
                    studentName: gatepass.student.name,
                    className: gatepass.student.className || '-',
                    title: `🚪 Siswa Telah Melewati Pos Keamanan: ${gatepass.student.name}`,
                    message: `Konfirmasi Pos Keamanan: Ananda ${gatepass.student.name} (${gatepass.student.className || '-'}) telah melewati gerbang utama sekolah pada pukul ${exitTimeStr} WIB (Diverifikasi Satpam: ${satpamName}). Status Izin: ${norm.label}. Alasan: ${gatepass.reason}. Penjemput: ${gatepass.pickupBy || 'Mandiri'}.`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            // Notifikasi ke Siswa
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'STUDENT',
                    studentId: gatepass.studentId,
                    studentName: gatepass.student.name,
                    className: gatepass.student.className || '-',
                    title: `🚪 Checkout Gerbang Berhasil (${norm.label})`,
                    message: `Tiket Gatepass Anda telah diverifikasi oleh Satpam (${satpamName}) pada pukul ${exitTimeStr} WIB. Anda resmi meninggalkan lingkungan sekolah. Hati-hati di jalan!`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            // Notifikasi ke Wali Kelas
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'TEACHER',
                    studentId: gatepass.studentId,
                    studentName: gatepass.student.name,
                    className: gatepass.student.className || '-',
                    title: `🚪 Siswa Kelas Anda Keluar Gerbang: ${gatepass.student.name} (${gatepass.student.className || '-'})`,
                    message: `Laporan Pos Satpam: Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) telah meninggalkan sekolah melalui Pos Keamanan (Satpam: ${satpamName}) pada pukul ${exitTimeStr} WIB.\n• Status Izin: ${norm.label}\n• Alasan: ${gatepass.reason}\n• Penjemput: ${gatepass.pickupBy || 'Mandiri'}`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            // Notifikasi ke Guru BK
            await tx.notificationMessage.create({
                data: {
                    recipientRole: 'COUNSELOR',
                    studentId: gatepass.studentId,
                    studentName: gatepass.student.name,
                    className: gatepass.student.className || '-',
                    title: `🚪 Siswa Bimbingan Telah Checkout Satpam: ${gatepass.student.name}`,
                    message: `Konfirmasi Satpam: Siswa ${gatepass.student.name} (${gatepass.student.className || '-'}) telah dipindai dan keluar melalui pos gerbang oleh Satpam (${satpamName}) pada pukul ${exitTimeStr} WIB. Kategori: ${norm.label}.`,
                    category: 'STUDENT_LEAVE'
                }
            }).catch(() => null);

            // Kirim Push Notification FCM ke Siswa
            sendFcmToUser(
                gatepass.studentId,
                `🚪 Checkout Gerbang Berhasil (${norm.label})`,
                `Tiket Gatepass diverifikasi Satpam (${satpamName}) pada ${exitTimeStr} WIB. Hati-hati di jalan!`,
                { type: 'GATEPASS_CHECKOUT', studentId: gatepass.studentId, gatepassId: gatepass.id }
            ).catch(() => null);

            return updated;
        });

        return res.json({
            success: true,
            action: 'CHECKOUT',
            message: `✅ Checkout Gerbang SAH! Siswa ${completedGatepass.student.name} (${completedGatepass.student.className || '-'}) diizinkan meninggalkan sekolah.`,
            categoryLabel: norm.label,
            data: {
                ...completedGatepass,
                categoryLabel: norm.label
            }
        });
    } catch (error: any) {
        console.error('Error verifyGatepassScan:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Gagal memproses verifikasi scan gatepass.'
        });
    }
};

/**
 * DAFTAR MONITORING GATEPASS UNTUK POS SATPAM
 * GET /api/satpam/gatepass/list
 */
export const getSatpamGatepassList = async (req: Request, res: Response) => {
    try {
        const { date, status, search } = req.query;
        const targetDate = date ? new Date(String(date)) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const whereClause: any = {
            createdAt: { gte: startOfDay, lte: endOfDay }
        };

        if (status && status !== 'ALL') {
            whereClause.status = String(status);
        }

        const gatepasses = await prisma.gatepassRequest.findMany({
            where: whereClause,
            include: {
                student: {
                    select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true, parentPhone: true }
                },
                approvedByBk: { select: { id: true, name: true } },
                checkoutSatpam: { select: { id: true, name: true } }
            },
            orderBy: { updatedAt: 'desc' },
            take: 100
        });

        const filtered = search
            ? gatepasses.filter(g =>
                g.student?.name.toLowerCase().includes(String(search).toLowerCase()) ||
                g.student?.nisn?.includes(String(search)) ||
                g.student?.className?.toLowerCase().includes(String(search).toLowerCase())
              )
            : gatepasses;

        const enrichedData = filtered.map(g => ({
            ...g,
            categoryLabel: normalizeCategory(g.leaveCategory).label
        }));

        const stats = {
            totalToday: gatepasses.length,
            waitingExit: gatepasses.filter(g => g.status === 'ACTIVE_APPROVED').length,
            currentlyOutside: gatepasses.filter(g => g.status === 'COMPLETED').length,
            completedExit: gatepasses.filter(g => g.status === 'COMPLETED').length,
            returnedToSchool: 0,
            activeApproved: gatepasses.filter(g => g.status === 'ACTIVE_APPROVED').length,
            completed: gatepasses.filter(g => g.status === 'COMPLETED').length,
            pending: gatepasses.filter(g => g.status === 'PENDING' || g.status === 'WAITING_BK_SCAN').length,
            expiredOrRejected: gatepasses.filter(g => g.status === 'EXPIRED' || g.status === 'REJECTED').length
        };

        return res.json({
            success: true,
            stats,
            count: enrichedData.length,
            data: enrichedData
        });
    } catch (error: any) {
        console.error('Error getSatpamGatepassList:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat log gatepass satpam.' });
    }
};

/**
 * 6. CEK STATUS GATEPASS AKTIF SISWA (UNTUK POLLING / TAMPILAN APK SISWA)
 * GET /api/v1/gatepass/active
 */
export const getActiveGatepass = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const studentId = user?.id;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        // Digital Gatepass tidak berlaku untuk Orang Tua
        if (user && user.role === 'PARENT') {
            return res.json({ success: true, activeGatepass: null });
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        let gatepass = await prisma.gatepassRequest.findFirst({
            where: {
                studentId,
                createdAt: { gte: todayStart, lte: todayEnd }
            },
            include: {
                student: { select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true } },
                approvedByBk: { select: { id: true, name: true } },
                checkoutSatpam: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!gatepass) {
            return res.json({
                success: true,
                hasActiveGatepass: false,
                hasActiveLeave: false,
                data: null
            });
        }

        // Auto-expire jika melewati validUntil
        const now = new Date();
        if (gatepass.status === 'ACTIVE_APPROVED' && gatepass.validUntil && gatepass.validUntil < now) {
            gatepass = await prisma.gatepassRequest.update({
                where: { id: gatepass.id },
                data: { status: 'EXPIRED' },
                include: {
                    student: { select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true } },
                    approvedByBk: { select: { id: true, name: true } },
                    checkoutSatpam: { select: { id: true, name: true } }
                }
            });
        }

        const remainingSeconds = gatepass.validUntil
            ? Math.max(0, Math.floor((new Date(gatepass.validUntil).getTime() - now.getTime()) / 1000))
            : 0;

        const formatted = formatGatepassResponse(
            gatepass,
            gatepass.approvedByBk?.name || 'Guru BK',
            'Ruang Konseling BK',
            remainingSeconds
        );

        return res.json({
            success: true,
            hasActiveGatepass: true,
            hasActiveLeave: true,
            isScanLocked: gatepass.status === 'PENDING',
            isReadyForScan: gatepass.status === 'WAITING_BK_SCAN' || gatepass.status === 'PENDING',
            isCheckedOut: gatepass.status === 'ACTIVE_APPROVED' || gatepass.status === 'COMPLETED',
            data: formatted
        });
    } catch (error: any) {
        console.error('Error getActiveGatepass:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal mengambil data gatepass aktif.' });
    }
};

/**
 * 7. DAFTAR GATEPASS UNTUK GURU BK & PORTAL SIAKAD
 * GET /api/v1/bk/gatepasses
 */
export const getBkGatepassList = async (req: Request, res: Response) => {
    try {
        const { status, className } = req.query;
        const whereClause: any = {};

        if (status && status !== 'ALL') {
            whereClause.status = String(status);
        }

        const list = await prisma.gatepassRequest.findMany({
            where: whereClause,
            include: {
                student: {
                    select: {
                        id: true,
                        name: true,
                        className: true,
                        nisn: true,
                        profilePicUrl: true,
                        parentPhone: true
                    }
                },
                approvedByBk: { select: { id: true, name: true } },
                checkoutSatpam: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });

        const filtered = className && className !== 'ALL'
            ? list.filter(g => g.student?.className === className)
            : list;

        return res.json({
            success: true,
            count: filtered.length,
            data: filtered
        });
    } catch (error: any) {
        console.error('Error getBkGatepassList:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memuat daftar gatepass.' });
    }
};

function formatGatepassResponse(gatepass: any, bkName: string, stationName: string, remainingSeconds: number) {
    const norm = normalizeCategory(gatepass.leaveCategory);
    const checkoutToken = gatepass.singleUseCheckoutToken || `GP-${gatepass.id}`;
    return {
        id: gatepass.id,
        leaveId: gatepass.id,
        studentId: gatepass.studentId,
        studentName: gatepass.student?.name || '-',
        className: gatepass.student?.className || '-',
        nisn: gatepass.student?.nisn || '-',
        profilePicUrl: gatepass.student?.profilePicUrl || null,
        leaveCategory: gatepass.leaveCategory,
        leaveType: norm.leaveType,
        categoryLabel: norm.label,
        reason: gatepass.reason,
        pickupBy: gatepass.pickupBy || 'Mandiri',
        pickupPerson: gatepass.pickupBy || 'Mandiri',
        status: gatepass.status,
        rejectionReason: gatepass.rejectionReason,
        approvedByBkId: gatepass.approvedByBkId,
        approvedByBkName: bkName,
        stationName,
        verifiedAt: gatepass.verifiedAt,
        checkedOutAt: gatepass.verifiedAt,
        validUntil: gatepass.validUntil,
        remainingSeconds,
        exitTimestamp: gatepass.exitTimestamp,
        singleUseCheckoutToken: checkoutToken,
        qrVerificationPayload: `SMARTCBT-GATEPASS:${checkoutToken}:${gatepass.id}`,
        statusText: gatepass.status === 'COMPLETED'
            ? 'SUDAH KELUAR GERBANG (TERVERIFIKASI SATPAM)'
            : 'SAH KELUAR GERBANG (IZIN RESMI BK - AKTIF 30 MENIT)',
        student: gatepass.student
    };
}

/**
 * 8. RIWAYAT PERIZINAN KELUAR SEKOLAH SISWA
 * GET /api/v1/gatepass/history
 */
export const getStudentLeaveHistory = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        const list = await prisma.gatepassRequest.findMany({
            where: { studentId },
            include: {
                approvedByBk: { select: { id: true, name: true } },
                checkoutSatpam: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        const formatted = list.map(g => {
            const norm = normalizeCategory(g.leaveCategory);
            return {
                id: g.id,
                leaveCategory: g.leaveCategory,
                categoryLabel: norm.label,
                leaveType: norm.leaveType,
                reason: g.reason,
                pickupBy: g.pickupBy || 'Mandiri',
                status: g.status,
                rejectionReason: g.rejectionReason,
                counselorNotes: (g as any).counselorNotes || g.rejectionReason || null,
                approvedByBk: g.approvedByBk?.name || null,
                checkoutSatpam: g.checkoutSatpam?.name || null,
                singleUseCheckoutToken: g.singleUseCheckoutToken || null,
                validUntil: g.validUntil || null,
                createdAt: g.createdAt,
                verifiedAt: g.verifiedAt,
                exitTimestamp: g.exitTimestamp
            };
        });

        return res.json({
            success: true,
            count: formatted.length,
            data: formatted
        });
    } catch (error: any) {
        console.error('Error getStudentLeaveHistory:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memuat riwayat perizinan.' });
    }
};
