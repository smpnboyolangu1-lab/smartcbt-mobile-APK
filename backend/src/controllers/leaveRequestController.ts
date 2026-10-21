import { Request, Response } from 'express';
import prisma from '../utils/db';
import { logAudit } from '../services/auditLogger';
import { analyzeAndProcessLeaveWithAi } from '../services/aiLeaveService';
import { sendFcmToUser } from '../services/fcmService';
import fs from 'fs';
import path from 'path';

function calculateInclusiveDays(start: Date, end: Date): number {
    const s = new Date(start);
    s.setHours(0, 0, 0, 0);
    const e = new Date(end);
    e.setHours(0, 0, 0, 0);
    const diffMillis = Math.max(0, e.getTime() - s.getTime());
    return Math.floor(diffMillis / (1000 * 60 * 60 * 24)) + 1;
}

function detectDoctorNote(reason: string | null | undefined, docType?: string | null): boolean {
    if (docType && String(docType).toUpperCase() === 'DOCTOR_NOTE') return true;
    const r = String(reason || '').toUpperCase();
    return r.includes('[SURAT DOKTER') || r.includes('SURAT DOKTER RESMI');
}

function enrichLeaveRequestItem(item: any) {
    const start = item.startDate ? new Date(item.startDate) : new Date();
    const end = item.endDate ? new Date(item.endDate) : start;
    const durationDays = calculateInclusiveDays(start, end);
    const isSick = item.category === 'SICK' || item.category === 'SAKIT';
    const isDoctorNote = detectDoctorNote(item.reason);
    const isExtension = String(item.reason || '').toUpperCase().includes('[PERPANJANGAN');
    const approvedDays = item.status === 'APPROVED'
        ? (isSick && !isDoctorNote ? Math.min(durationDays, 2) : durationDays)
        : (isSick && !isDoctorNote ? Math.min(durationDays, 2) : durationDays);
    const documentLabel = isSick
        ? (isDoctorNote ? `🏥 Surat Keterangan Dokter (${durationDays} Hari)` : `🏠 Izin Orang Tua (Maks 2 Hari • Diajukan ${durationDays} Hari)`)
        : `📝 Surat Izin Orang Tua (Maks 2 Hari • Diajukan ${durationDays} Hari)`;

    return {
        ...item,
        durationDays,
        approvedDays,
        isDoctorNote,
        isExtension,
        documentType: isDoctorNote ? 'DOCTOR_NOTE' : 'PARENT_NOTE',
        documentLabel
    };
}

// Helper untuk mencari userId Orang Tua dari data siswa
async function findParentUserIdForStudent(student: { id: string; nisn?: string | null; username?: string | null; parentPhone?: string | null; fatherName?: string | null; motherName?: string | null }): Promise<string | undefined> {
    try {
        const parentUser = await prisma.user.findFirst({
            where: {
                role: 'PARENT',
                OR: [
                    ...(student.nisn ? [{ username: `P${student.nisn}` }, { username: student.nisn }, { nisn: student.nisn }] : []),
                    ...(student.parentPhone ? [{ username: student.parentPhone }] : []),
                    ...(student.fatherName ? [{ name: student.fatherName }] : []),
                    ...(student.motherName ? [{ name: student.motherName }] : [])
                ]
            },
            select: { id: true }
        });
        return parentUser?.id;
    } catch {
        return undefined;
    }
}

// 1. Orang Tua Mengajukan Izin / Sakit Anak
export const createParentLeaveRequest = async (req: Request, res: Response) => {
    try {
        const { studentId, category, startDate, endDate, reason, attachmentUrl, documentType } = req.body;
        const user = (req as any).user;

        if (!studentId || !category || !startDate || !reason) {
            return res.status(400).json({ message: 'Siswa, Kategori Izin, Tanggal, dan Alasan wajib diisi' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId }
        });

        if (!student) {
            return res.status(404).json({ message: 'Data siswa tidak ditemukan' });
        }

        // Validasi BOLA/IDOR: Orang tua hanya bisa mengajukan izin untuk anak kandungnya sendiri
        if (user && user.role === 'PARENT') {
            const cleanNisn = (user.username || '').replace(/^[Pp]/, '').trim();
            const isChild = await prisma.user.findFirst({
                where: {
                    id: studentId,
                    role: 'STUDENT',
                    OR: [
                        { nisn: cleanNisn },
                        { username: cleanNisn },
                        ...(user.nisn ? [{ nisn: user.nisn }] : []),
                        { parentPhone: user.username },
                        { fatherName: user.name },
                        { motherName: user.name }
                    ]
                }
            });
            if (!isChild) {
                return res.status(403).json({ message: 'Akses Ditolak: Anda hanya dapat mengajukan permohonan izin untuk ananda sendiri.' });
            }
        }

        const parentName = user ? user.name : (student.fatherName || student.motherName || 'Orang Tua / Wali');
        const parentPhone = student.parentPhone || '';

        const start = new Date(startDate);
        let end = endDate ? new Date(endDate) : new Date(startDate);
        if (end < start) end = new Date(start);

        let diffDays = calculateInclusiveDays(start, end);
        const isSickCategory = category === 'SICK' || category === 'SAKIT';
        const isDoctorNote = detectDoctorNote(reason, documentType);

        // Cek apakah ada izin sakit sebelumnya dalam 7 hari terakhir (atau berkesinambungan dengan startDate) -> PERPANJANGAN SAKIT
        const sevenDaysBeforeStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
        const recentSick = isSickCategory ? await (prisma as any).studentLeaveRequest.findFirst({
            where: {
                studentId: student.id,
                category: { in: ['SICK', 'SAKIT'] },
                status: { not: 'REJECTED' },
                OR: [
                    { endDate: { gte: sevenDaysBeforeStart } },
                    { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
                ]
            },
            orderBy: { createdAt: 'desc' }
        }) : null;

        const isExtension = Boolean(recentSick);

        // ATURAN 1: Jika Perpanjangan Izin Sakit (Belum Sembuh), WAJIB SURAT DOKTER RESMI (Bukan surat orang tua / tulisan tangan)
        if (isSickCategory && isExtension) {
            if (!isDoctorNote || !attachmentUrl) {
                const parentUserId = await findParentUserIdForStudent(student);
                const warnTitle = '⚠️ Perpanjangan Sakit Wajib Surat Dokter Resmi';
                const warnMsg = `Permohonan perpanjangan izin sakit ananda ${student.name} (${student.className || '-'}) belum dapat diproses. Karena ananda belum sembuh setelah izin sakit sebelumnya, perpanjangan WAJIB melampirkan foto SURAT KETERANGAN DOKTER RESMI (bukan surat buatan orang tua atau tulisan tangan).`;

                try {
                    await prisma.notificationMessage.create({
                        data: {
                            recipientId: parentUserId || student.id,
                            recipientPhone: parentPhone,
                            recipientRole: 'PARENT',
                            studentId: student.id,
                            studentName: student.name,
                            className: student.className || 'VII-A',
                            category: 'LEAVE_VERIFICATION',
                            title: warnTitle,
                            message: warnMsg
                        }
                    });
                    await prisma.notificationMessage.create({
                        data: {
                            recipientId: student.id,
                            recipientRole: 'STUDENT',
                            studentId: student.id,
                            studentName: student.name,
                            className: student.className || 'VII-A',
                            category: 'LEAVE_VERIFICATION',
                            title: warnTitle,
                            message: warnMsg
                        }
                    });
                } catch {}

                return res.status(400).json({
                    requiresDoctorNote: true,
                    isExtension: true,
                    message: '⚠️ Perpanjangan Izin Sakit Wajib Surat Dokter: Karena ananda belum sembuh dari izin sakit sebelumnya, perpanjangan WAJIB memilih opsi "Surat Keterangan Dokter Resmi" dan melampirkan foto Surat Dokter asli (bukan surat buatan orang tua / tulisan tangan).'
                });
            }
        }

        // ATURAN 2: Jika Izin Orang Tua (Bukan Surat Dokter) -> Maksimal 2 Hari!
        // Apabila lebih dari 2 hari tanpa Surat Dokter / RT, tolak / minta perpanjangan resmi
        if (!isDoctorNote && diffDays > 2) {
            return res.status(400).json({
                requiresDoctorNote: true,
                maxParentDays: 2,
                message: `Izin dari Orang Tua otomatis dikunci maksimal 2 hari. Untuk perpanjangan lebih dari 2 hari, wajib melampirkan Surat Pengantar berstempel RT setempat atau Surat Keterangan Dokter/Faskes resmi.`
            });
        }

        // ATURAN 3: Jika memilih Surat Keterangan Dokter Resmi, wajib melampirkan foto surat dokter
        if (isSickCategory && isDoctorNote && !attachmentUrl) {
            return res.status(400).json({
                requiresDoctorNote: true,
                message: 'Anda memilih kategori Surat Keterangan Dokter Resmi. Mohon lampirkan foto fisik Surat Keterangan Dokter beserta jumlah hari istirahat yang direkomendasikan dokter.'
            });
        }

        let finalAttachmentUrl = attachmentUrl || null;
        if (finalAttachmentUrl && (finalAttachmentUrl.startsWith('data:image/') || finalAttachmentUrl.startsWith('data:application/pdf'))) {
            try {
                const uploadDir = path.join(process.cwd(), 'uploads', 'leaves');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }

                const matches = finalAttachmentUrl.match(/^data:(image\/[a-zA-Z0-9+]+|application\/pdf);base64,(.+)$/);
                if (matches) {
                    const mime = matches[1];
                    let ext = 'jpg';
                    if (mime === 'image/png') ext = 'png';
                    else if (mime === 'application/pdf') ext = 'pdf';
                    else if (mime === 'image/webp') ext = 'webp';

                    const buffer = Buffer.from(matches[2], 'base64');
                    const fileName = `leave_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
                    const filePath = path.join(uploadDir, fileName);
                    fs.writeFileSync(filePath, buffer);
                    finalAttachmentUrl = `/uploads/leaves/${fileName}`;
                }
            } catch (err) {
                console.error('Error saving leave request attachment:', err);
            }
        }

        // Tag alasan secara rapi agar jenis dokumen & status perpanjangan tercatat jelas di semua tampilan
        let cleanReason = String(reason || '').trim()
            .replace(/^\[(SURAT DOKTER RESMI|IZIN ORANG TUA|PERPANJANGAN[^\]]*)\]\s*/gi, '');
        const prefixTags: string[] = [];
        if (isSickCategory) {
            if (isDoctorNote) prefixTags.push(`[SURAT DOKTER RESMI - ${diffDays} HARI]`);
            else prefixTags.push(`[IZIN ORANG TUA - MAKS 3 HARI]`);
            if (isExtension) prefixTags.push(`[PERPANJANGAN SAKIT]`);
        }
        const taggedReason = prefixTags.length > 0 ? `${prefixTags.join(' ')} ${cleanReason}` : cleanReason;

        const leaveReq = await (prisma as any).studentLeaveRequest.create({
            data: {
                studentId: student.id,
                studentName: student.name,
                className: student.className || 'VII-A',
                parentName,
                parentPhone,
                category: category || 'SICK',
                startDate: start,
                endDate: end,
                reason: taggedReason,
                attachmentUrl: finalAttachmentUrl,
                status: 'PENDING'
            }
        });

        // Trigger Analisis AI Otomatis (Cek Stempel RT / Surat Dokter & Auto-Approve)
        analyzeAndProcessLeaveWithAi(leaveReq.id).catch(err => {
            console.warn('[AI Leave Trigger] Non-fatal background error:', err.message);
        });

        // SIBOY A7 & A11: Routing otomatis ke Guru BK pengampu kelas siswa (BkKelasPlot)
        try {
            const studentClass = student.className || 'VII-A';
            const bkPlot = await (prisma as any).bkKelasPlot.findFirst({
                where: {
                    OR: [
                        { className: studentClass },
                        ...(student.classId ? [{ classId: student.classId }] : [])
                    ]
                },
                include: { guruBk: true }
            });

            const bkRecipientId = bkPlot?.guruBkId;
            const notifTitle = `📩 Permohonan Izin Siswa: ${student.name} (${studentClass})`;
            const notifBody = `Orang tua ananda ${student.name} mengajukan izin (${category}) selama ${diffDays} hari (${startDate}). Alasan: "${cleanReason}". Menunggu verifikasi Guru BK.`;

            if (bkRecipientId) {
                await (prisma as any).notificationMessage.create({
                    data: {
                        recipientId: bkRecipientId,
                        recipientRole: 'COUNSELOR',
                        studentId: student.id,
                        studentName: student.name,
                        className: studentClass,
                        category: 'STUDENT_LEAVE',
                        title: notifTitle,
                        message: notifBody
                    }
                });
            } else {
                // Fallback: Kirim ke seluruh Guru BK
                const allBk = await prisma.user.findMany({
                    where: {
                        OR: [
                            { role: 'COUNSELOR' },
                            { isBk: true },
                            { tugasTambahan: { contains: 'BK' } }
                        ]
                    },
                    select: { id: true }
                });
                for (const bk of allBk) {
                    await (prisma as any).notificationMessage.create({
                        data: {
                            recipientId: bk.id,
                            recipientRole: 'COUNSELOR',
                            studentId: student.id,
                            studentName: student.name,
                            className: studentClass,
                            category: 'STUDENT_LEAVE',
                            title: notifTitle,
                            message: notifBody
                        }
                    });
                }
            }

            // Permohonan izin siswa/ortu hanya diarahkan dan diverifikasi oleh Guru BK (bukan Wali Kelas)
        } catch (routeErr) {
            console.warn('Error routing leave notification to BK:', routeErr);
        }

        await logAudit(req, 'PARENT_LEAVE_REQUEST', `Student: ${student.name}`, {
            category,
            startDate,
            endDate,
            diffDays,
            isDoctorNote,
            isExtension,
            parentName
        });

        res.json({
            success: true,
            message: isSickCategory
                ? (isDoctorNote
                    ? `Permohonan Sakit dengan Surat Dokter (${diffDays} hari istirahat) untuk ${student.name} berhasil diajukan ke Guru BK.`
                    : `Permohonan Sakit Izin Orang Tua (${diffDays} hari, maks. 3 hari) untuk ${student.name} berhasil diajukan ke Guru BK. Jika diperpanjang karena belum sembuh, wajib melampirkan Surat Dokter.`)
                : `Permohonan Izin (${diffDays} hari) untuk ${student.name} berhasil diajukan dan sedang menunggu verifikasi Guru BK.`,
            leaveRequest: enrichLeaveRequestItem(leaveReq)
        });
    } catch (error) {
        console.error('Error creating leave request:', error);
        res.status(500).json({ message: 'Gagal mengajukan permohonan izin' });
    }
};

// 2. Mengambil Riwayat Izin untuk Orang Tua / Siswa / Pengurus Kelas
export const getParentLeaveRequests = async (req: Request, res: Response) => {
    try {
        const { studentId, className, status } = req.query;
        const user = (req as any).user;

        const whereCondition: any = {};
        if (className && (user?.role === 'STUDENT' || user?.role === 'TEACHER' || user?.role === 'COUNSELOR' || user?.role === 'ADMIN' || user?.role === 'OPERATOR')) {
            // Pengurus Kelas / Guru melihat izin kelasnya
            whereCondition.className = String(className);
            if (status && status !== 'ALL') {
                whereCondition.status = String(status);
            }
        } else if (user && user.role === 'STUDENT') {
            whereCondition.studentId = user.id;
        } else if (user && user.role === 'PARENT') {
            const cleanNisn = (user.username || '').replace(/^[Pp]/, '').trim();
            const children = await prisma.user.findMany({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { nisn: cleanNisn },
                        { username: cleanNisn },
                        ...(user.nisn ? [{ nisn: user.nisn }] : []),
                        { parentPhone: user.username },
                        { fatherName: user.name },
                        { motherName: user.name }
                    ]
                },
                select: { id: true }
            });
            const allowedStudentIds = children.map(c => c.id);

            if (studentId) {
                if (!allowedStudentIds.includes(String(studentId))) {
                    return res.status(403).json({ message: 'Akses ditolak untuk data siswa ini' });
                }
                whereCondition.studentId = String(studentId);
            } else {
                whereCondition.studentId = { in: allowedStudentIds };
            }
        } else if (studentId) {
            whereCondition.studentId = String(studentId);
        }

        const list = await (prisma as any).studentLeaveRequest.findMany({
            where: whereCondition,
            orderBy: { createdAt: 'desc' }
        });

        res.json(list.map(enrichLeaveRequestItem));
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat riwayat permohonan izin' });
    }
};

// 3. Mengambil Antrean & Rekap Izin untuk Guru / Wali Kelas / Guru BK / Pengurus Kelas
export const getTeacherLeaveRequests = async (req: Request, res: Response) => {
    try {
        const { className, status } = req.query;
        const whereCondition: any = {};

        if (className && className !== 'ALL') {
            whereCondition.className = String(className);
        }
        if (status && status !== 'ALL') {
            whereCondition.status = String(status);
        }

        const list = await (prisma as any).studentLeaveRequest.findMany({
            where: whereCondition,
            orderBy: { createdAt: 'desc' }
        });

        res.json(list.map(enrichLeaveRequestItem));
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat daftar verifikasi izin' });
    }
};

// 4. Verifikasi Permohonan Izin oleh Wali Kelas / Guru BK (Approve / Reject)
export const verifyLeaveRequest = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status, rejectionNote, approvedDaysOverride } = req.body; // 'APPROVED' or 'REJECTED'
        const user = (req as any).user;
        const role = String(user?.role || '').toUpperCase();
        const isHomeroom = Boolean(user?.homeroomClass || (user?.rolesTambahan && user.rolesTambahan.includes('wali_kelas')));
        if (role !== 'BK' && role !== 'COUNSELOR' && role !== 'ADMIN' && role !== 'OPERATOR' && !isHomeroom) {
            return res.status(403).json({ message: 'Wewenang verifikasi surat izin resmi dipegang khusus oleh Guru BK / Wali Kelas / Admin Sekolah.' });
        }

        if (!status || (status !== 'APPROVED' && status !== 'REJECTED')) {
            return res.status(400).json({ message: 'Status verifikasi harus APPROVED atau REJECTED' });
        }

        const leaveReq = await (prisma as any).studentLeaveRequest.findUnique({
            where: { id }
        });

        if (!leaveReq) {
            const studentLeave = await (prisma as any).studentLeave.findUnique({
                where: { id },
                include: { student: true }
            });
            if (studentLeave) {
                const singleToken = `GP-${studentLeave.id.substring(0, 8).toUpperCase()}`;
                const validUntil = new Date(Date.now() + 45 * 60 * 1000); // 45 Menit
                const approvedStatus = status === 'APPROVED' ? 'approved_by_bk' : 'rejected';

                await (prisma as any).studentLeave.update({
                    where: { id },
                    data: {
                        status: approvedStatus,
                        counselorId: user?.id || null,
                        counselorNotes: rejectionNote || (status === 'APPROVED' ? 'Disetujui Guru BK. Tunjukkan QR Gatepass ke Satpam di gerbang.' : 'Ditolak Guru BK'),
                        approvedAt: new Date()
                    }
                });

                if (status === 'APPROVED') {
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    const todayEnd = new Date();
                    todayEnd.setHours(23, 59, 59, 999);

                    const existingGp = await prisma.gatepassRequest.findFirst({
                        where: { studentId: studentLeave.studentId, createdAt: { gte: todayStart, lte: todayEnd } }
                    });

                    const leaveCat = studentLeave.leaveType === 'SAKIT_PULANG' ? 'sick' : studentLeave.leaveType === 'DISPENSASI_LOMBA' ? 'dispensation' : 'urgent_family';

                    if (existingGp) {
                        await prisma.gatepassRequest.update({
                            where: { id: existingGp.id },
                            data: {
                                status: 'ACTIVE_APPROVED',
                                singleUseCheckoutToken: singleToken,
                                validUntil,
                                verifiedAt: new Date(),
                                approvedByBkId: user?.id || null,
                                leaveCategory: leaveCat,
                                reason: studentLeave.reason,
                                pickupBy: studentLeave.pickupPerson || 'Mandiri'
                            }
                        });
                    } else {
                        await prisma.gatepassRequest.create({
                            data: {
                                studentId: studentLeave.studentId,
                                status: 'ACTIVE_APPROVED',
                                singleUseCheckoutToken: singleToken,
                                validUntil,
                                verifiedAt: new Date(),
                                approvedByBkId: user?.id || null,
                                leaveCategory: leaveCat,
                                reason: studentLeave.reason,
                                pickupBy: studentLeave.pickupPerson || 'Mandiri'
                            }
                        });
                    }

                    // Notifikasi ke Siswa
                    try {
                        const notifTitle = '✅ Izin Keluar/Dispensasi Disetujui Guru BK!';
                        const notifBody = `Izin Anda telah disetujui Guru BK (${user?.name || 'BK'}). Tunjukkan QR Gatepass di HP Anda kepada Satpam di gerbang untuk checkout keluar sekolah.`;
                        await (prisma as any).notificationMessage.create({
                            data: {
                                recipientRole: 'STUDENT',
                                studentId: studentLeave.studentId,
                                studentName: studentLeave.student?.name || 'Siswa',
                                className: studentLeave.student?.className || '-',
                                title: notifTitle,
                                message: notifBody,
                                category: 'STUDENT_LEAVE'
                            }
                        });
                        await sendFcmToUser(
                            studentLeave.studentId,
                            notifTitle,
                            notifBody,
                            {
                                type: 'GATEPASS_APPROVED',
                                studentId: studentLeave.studentId,
                                leaveId: studentLeave.id
                            }
                        );
                    } catch (e) {}
                }

                return res.json({
                    success: true,
                    message: `Izin ${studentLeave.student?.name || 'siswa'} berhasil ${status === 'APPROVED' ? 'disetujui' : 'ditolak'}!`,
                    isGatepass: true
                });
            }

            return res.status(404).json({ message: 'Permohonan izin tidak ditemukan' });
        }

        const verifiedBy = user ? `${user.name} (${user.role})` : 'Wali Kelas / BK';
        const isSick = leaveReq.category === 'SICK' || leaveReq.category === 'SAKIT';
        const isDoctorNote = detectDoctorNote(leaveReq.reason);

        const start = new Date(leaveReq.startDate);
        start.setHours(0, 0, 0, 0);
        let end = new Date(leaveReq.endDate || leaveReq.startDate);
        end.setHours(0, 0, 0, 0);

        let requestedDays = calculateInclusiveDays(start, end);
        let approvedDays = requestedDays;

        // ATURAN UTAMA:
        // Jika Sakit dari Izin Orang Tua (Bukan Surat Dokter), jika di-ACC otomatis maksimal hanya 3 hari!
        // Jika memakai Surat Dokter, mengikuti kebutuhan istirahat dari dokter (seluruh hari di-ACC).
        if (status === 'APPROVED') {
            if (approvedDaysOverride && Number(approvedDaysOverride) > 0) {
                approvedDays = Number(approvedDaysOverride);
            } else if (isSick && !isDoctorNote && requestedDays > 3) {
                approvedDays = 3;
            }
            // Sesuaikan endDate dengan approvedDays
            end = new Date(start);
            end.setDate(start.getDate() + (approvedDays - 1));
            end.setHours(23, 59, 59, 999);
        }

        const updated = await (prisma as any).studentLeaveRequest.update({
            where: { id },
            data: {
                status,
                endDate: status === 'APPROVED' ? end : leaveReq.endDate,
                verifiedBy,
                verifiedAt: new Date(),
                rejectionNote: status === 'REJECTED' ? (rejectionNote || 'Dokumen surat tidak lengkap / wajib Surat Dokter') : null
            }
        });

        const startDateFormatted = start.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        const endDateFormatted = end.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        const dateSpanStr = startDateFormatted === endDateFormatted ? startDateFormatted : `${startDateFormatted} s/d ${endDateFormatted}`;
        const docTypeStr = isSick
            ? (isDoctorNote ? `Surat Keterangan Dokter (${approvedDays} Hari Istirahat)` : `Izin Sakit Orang Tua (${approvedDays} Hari • Maks 3 Hari)`)
            : `Izin Resmi Orang Tua (${approvedDays} Hari)`;

        // JIKA DISETUJUI (APPROVED): Otomatis Masukkan ke Rekap Presensi Sekolah & Kelas selama beberapa hari tersebut!
        let recordedEffectiveDays = 0;
        if (status === 'APPROVED') {
            const attStatus = isSick ? 'SICK' : 'PERMISSION';
            const noteText = `${docTypeStr} [${dateSpanStr}] disetujui ${verifiedBy}: ${leaveReq.reason}`;

            const curDate = new Date(start);
            const endLoop = new Date(end);
            endLoop.setHours(23, 59, 59, 999);

            while (curDate <= endLoop) {
                // Jangan menimpa hari Minggu sebagai hari sakit/izin agar rekap hari efektif akurat
                if (curDate.getDay() !== 0) {
                    recordedEffectiveDays++;
                    const dayStart = new Date(curDate);
                    dayStart.setHours(0, 0, 0, 0);
                    const dayEnd = new Date(curDate);
                    dayEnd.setHours(23, 59, 59, 999);

                    await prisma.attendance.deleteMany({
                        where: {
                            userId: leaveReq.studentId,
                            scanTime: { gte: dayStart, lte: dayEnd }
                        }
                    });

                    const inTime = new Date(curDate);
                    inTime.setHours(7, 0, 0, 0);
                    await prisma.attendance.create({
                        data: {
                            userId: leaveReq.studentId,
                            type: 'GATE_IN',
                            method: isDoctorNote ? 'DOCTOR_CERTIFICATE' : 'PARENT_PERMISSION',
                            status: attStatus,
                            scanTime: inTime,
                            note: noteText
                        }
                    });

                    const outTime = new Date(curDate);
                    outTime.setHours(14, 30, 0, 0);
                    await prisma.attendance.create({
                        data: {
                            userId: leaveReq.studentId,
                            type: 'GATE_OUT',
                            method: isDoctorNote ? 'DOCTOR_CERTIFICATE' : 'PARENT_PERMISSION',
                            status: attStatus,
                            scanTime: outTime,
                            note: noteText
                        }
                    });
                }

                curDate.setDate(curDate.getDate() + 1);
            }

            // Sinkronisasi otomatis ke seluruh sesi jam pelajaran (ClassPeriodSession) pada rentang tanggal izin
            try {
                const rangeSessions = await (prisma as any).classPeriodSession.findMany({
                    where: {
                        className: leaveReq.className,
                        inTime: { gte: start, lte: end }
                    }
                });
                for (const sess of rangeSessions) {
                    await (prisma as any).classPeriodAttendance.upsert({
                        where: {
                            sessionId_studentId: {
                                sessionId: sess.id,
                                studentId: leaveReq.studentId
                            }
                        },
                        update: {
                            status: attStatus,
                            method: isDoctorNote ? 'DOCTOR_CERTIFICATE' : 'PARENT_PERMISSION'
                        },
                        create: {
                            sessionId: sess.id,
                            studentId: leaveReq.studentId,
                            studentName: leaveReq.studentName,
                            className: leaveReq.className,
                            status: attStatus,
                            method: isDoctorNote ? 'DOCTOR_CERTIFICATE' : 'PARENT_PERMISSION'
                        }
                    });
                }
            } catch (sessErr) {
                console.warn('Sync to period sessions non-fatal:', sessErr);
            }
        }

        const extensionRuleWarning = isSick
            ? ` ⚠️ PENTING: Apabila setelah ${endDateFormatted} ananda belum sembuh dan izin diperpanjang, WAJIB melampirkan foto Surat Keterangan Dokter resmi terbaru (bukan surat buatan orang tua atau tulisan tangan).`
            : '';

        // 1. Kirim Notifikasi Balik Langsung ke SISWA di Aplikasi Mobile
        try {
            const studentTitle = status === 'APPROVED'
                ? `✅ Izin ${isSick ? 'Sakit' : 'Resmi'} Disetujui (${approvedDays} Hari)`
                : '⚠️ Permohonan Izin Belum Disetujui';
            const studentMsg = status === 'APPROVED'
                ? `Permohonan ${docTypeStr} Anda pada ${dateSpanStr} (${approvedDays} hari) telah DISETUJUI oleh ${verifiedBy} dan otomatis masuk ke Rekap Presensi sekolah serta laporan Wali Kelas & Pengurus Kelas.${extensionRuleWarning}`
                : `Mohon maaf, permohonan izin Anda belum disetujui oleh ${verifiedBy}. Catatan: ${rejectionNote || 'Dokumen surat tidak lengkap / wajib Surat Dokter resmi'}.`;

            await prisma.notificationMessage.create({
                data: {
                    recipientId: leaveReq.studentId,
                    recipientRole: 'STUDENT',
                    studentId: leaveReq.studentId,
                    studentName: leaveReq.studentName,
                    className: leaveReq.className,
                    category: 'LEAVE_VERIFICATION',
                    title: studentTitle,
                    message: studentMsg
                }
            });

            await sendFcmToUser(
                leaveReq.studentId,
                studentTitle,
                studentMsg,
                {
                    type: 'LEAVE_VERIFICATION',
                    status,
                    studentId: leaveReq.studentId,
                    leaveId: leaveReq.id
                }
            );
        } catch (stErr) {
            console.warn('Student notif non-fatal:', stErr);
        }

        // 2. Temukan akun user Parent yang terdaftar untuk dikirimi notifikasi
        const studentUser = await prisma.user.findUnique({
            where: { id: leaveReq.studentId },
            select: { id: true, nisn: true, username: true, parentPhone: true, fatherName: true, motherName: true }
        });
        const parentUserId = studentUser ? await findParentUserIdForStudent(studentUser) : undefined;

        // Kirim Notifikasi Balik ke ORANG TUA / WALI MURID di Aplikasi Mobile
        try {
            const parentTitle = status === 'APPROVED'
                ? `✅ Izin Ananda Disetujui (${approvedDays} Hari: ${dateSpanStr})`
                : '❌ Permohonan Izin Ananda Ditolak';
            const parentMsg = status === 'APPROVED'
                ? `Alhamdulillah, ${docTypeStr} ananda ${leaveReq.studentName} (${leaveReq.className}) untuk periode ${dateSpanStr} (${approvedDays} hari) telah DISETUJUI oleh ${verifiedBy}. Data otomatis tercatat di Rekap Presensi APK, Wali Kelas, dan Pengurus Kelas.${extensionRuleWarning}`
                : `Mohon maaf, permohonan izin ananda ${leaveReq.studentName} belum dapat disetujui oleh sekolah. Catatan: ${rejectionNote || 'Wajib melampirkan Surat Keterangan Dokter resmi (bukan surat buatan tangan orang tua)'}.`;

            await prisma.notificationMessage.create({
                data: {
                    recipientId: parentUserId || leaveReq.studentId,
                    recipientPhone: leaveReq.parentPhone,
                    recipientRole: 'PARENT',
                    studentId: leaveReq.studentId,
                    studentName: leaveReq.studentName,
                    className: leaveReq.className,
                    category: 'LEAVE_VERIFICATION',
                    title: parentTitle,
                    message: parentMsg
                }
            });

            if (parentUserId) {
                await sendFcmToUser(
                    parentUserId,
                    parentTitle,
                    parentMsg,
                    {
                        type: 'LEAVE_VERIFICATION',
                        status,
                        studentId: leaveReq.studentId,
                        leaveId: leaveReq.id
                    }
                );
            }
        } catch (parErr) {
            console.warn('Parent notif non-fatal:', parErr);
        }

        // 3. Kirim Notifikasi ke Ketua Kelas & Pengurus Kelas (Beserta Jumlah Hari Di-Approve & Jenis Surat)
        if (status === 'APPROVED') {
            try {
                await prisma.notificationMessage.create({
                    data: {
                        recipientRole: 'STUDENT',
                        className: leaveReq.className,
                        studentId: leaveReq.studentId,
                        studentName: leaveReq.studentName,
                        category: 'ATTENDANCE_MANUAL_RECAP',
                        title: `📋 Rekap Pengurus Kelas: ${leaveReq.studentName} (${approvedDays} Hari)`,
                        message: `Teman sekelas Anda, ${leaveReq.studentName} (${leaveReq.className}), resmi DISETUJUI ${isSick ? 'SAKIT' : 'IZIN'} selama ${approvedDays} HARI (${dateSpanStr}) berdasarkan ${isDoctorNote ? 'Surat Keterangan Dokter Resmi' : 'Izin Orang Tua (Maks 3 Hari)'} oleh ${verifiedBy}. Otomatis tercatat di rekap presensi selama ${approvedDays} hari.`
                    }
                });
            } catch (rkErr) {}
        }

        // 4. Kirim Notifikasi ke Wali Kelas yang membina rombel ini (Beserta Jumlah Hari Di-Approve)
        try {
            const waliKelas = await prisma.user.findFirst({
                where: {
                    role: 'TEACHER',
                    OR: [
                        { className: leaveReq.className },
                        { teachingClasses: { contains: leaveReq.className } }
                    ]
                }
            });
            if (waliKelas) {
                await prisma.notificationMessage.create({
                    data: {
                        recipientId: waliKelas.id,
                        recipientRole: 'TEACHER',
                        className: leaveReq.className,
                        studentId: leaveReq.studentId,
                        studentName: leaveReq.studentName,
                        category: 'ATTENDANCE',
                        title: `📋 Rekap Wali Kelas: ${leaveReq.studentName} (${approvedDays} Hari)`,
                        message: `${docTypeStr} ananda ${leaveReq.studentName} (${leaveReq.className}) periode ${dateSpanStr} (${approvedDays} hari) telah ${status === 'APPROVED' ? 'DISETUJUI' : 'DITOLAK'} oleh ${verifiedBy}. Rekap presensi kelas otomatis terisi selama ${approvedDays} hari.`
                    }
                });
            }
        } catch (wkErr) {
            console.warn('Wali kelas notif non-fatal:', wkErr);
        }

        // 5. SMART NOTIFIKASI KE SEMUA GURU MENGAJAR DI KELAS TERSEBUT PADA RENTANG HARI IZIN SAKIT
        if (status === 'APPROVED') {
            try {
                const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                const cur = new Date(start);
                const affectedDaysSet = new Set<string>();

                while (cur <= end) {
                    const dName = dayNames[cur.getDay()];
                    if (dName && dName !== 'Minggu') {
                        affectedDaysSet.add(dName);
                    }
                    cur.setDate(cur.getDate() + 1);
                }

                const affectedDays = Array.from(affectedDaysSet);

                const schedules = await prisma.classPeriodSchedule.findMany({
                    where: {
                        className: leaveReq.className,
                        day: { in: affectedDays }
                    }
                });

                const notifiedTeacherIds = new Set<string>();
                for (const sch of schedules) {
                    if (sch.teacherId && !notifiedTeacherIds.has(sch.teacherId)) {
                        notifiedTeacherIds.add(sch.teacherId);
                    }
                }

                const subjectTeachers = await prisma.user.findMany({
                    where: {
                        role: 'TEACHER',
                        teachingClasses: { contains: leaveReq.className }
                    },
                    select: { id: true, name: true, teachingSubject: true }
                });

                for (const t of subjectTeachers) {
                    notifiedTeacherIds.add(t.id);
                }

                for (const teacherId of notifiedTeacherIds) {
                    await prisma.notificationMessage.create({
                        data: {
                            recipientId: teacherId,
                            recipientRole: 'TEACHER',
                            className: leaveReq.className,
                            studentId: leaveReq.studentId,
                            studentName: leaveReq.studentName,
                            category: 'ATTENDANCE_LEAVE',
                            title: `🏥 Siswa ${isSick ? 'Sakit' : 'Izin'} (${approvedDays} Hari): ${leaveReq.studentName}`,
                            message: `Pemberitahuan KBM: Ananda ${leaveReq.studentName} (${leaveReq.className}) disetujui ${docTypeStr} selama ${approvedDays} hari pada ${dateSpanStr} oleh ${verifiedBy}. Rekap presensi kelas otomatis tercatat.`
                        }
                    });
                }
            } catch (tNotifErr) {
                console.warn('Teacher period schedule notif non-fatal:', tNotifErr);
            }
        }

        await logAudit(req, 'VERIFY_LEAVE_REQUEST', `Student: ${leaveReq.studentName}`, {
            status,
            verifiedBy,
            approvedDays,
            isDoctorNote,
            requestId: id
        });

        res.json({
            success: true,
            message: status === 'APPROVED'
                ? `✅ Izin ${leaveReq.studentName} berhasil DISETUJUI selama ${approvedDays} hari (${dateSpanStr}) dan otomatis masuk ke rekap absensi kelas, Wali Kelas & Pengurus Kelas.`
                : `❌ Izin ${leaveReq.studentName} DITOLAK. Alasan: ${rejectionNote || 'Dokumen tidak valid'}.`,
            leaveRequest: enrichLeaveRequestItem(updated)
        });
    } catch (error) {
        console.error('Error verifying leave request:', error);
        res.status(500).json({ message: 'Gagal memverifikasi permohonan izin' });
    }
};

// 5. Guru BK / Wali Kelas / Admin Menghapus Histori Permohonan Izin / Sakit
export const deleteLeaveRequest = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const user = (req as any).user;

        const leaveReq = await prisma.studentLeaveRequest.findUnique({
            where: { id }
        });

        if (!leaveReq) {
            return res.status(404).json({ message: 'Data surat izin/sakit tidak ditemukan' });
        }

        if (leaveReq.attachmentUrl && leaveReq.attachmentUrl.startsWith('/uploads/leaves/')) {
            try {
                const filePath = path.join(process.cwd(), leaveReq.attachmentUrl);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (fileErr) {
                console.warn('Gagal menghapus file lampiran izin:', fileErr);
            }
        }

        await prisma.studentLeaveRequest.delete({
            where: { id }
        });

        await logAudit(req, 'DELETE_LEAVE_REQUEST', `Student: ${leaveReq.studentName}`, {
            requestId: id,
            category: leaveReq.category,
            deletedBy: user?.name || 'Guru BK/Admin'
        });

        res.json({
            success: true,
            message: `✅ Histori permohonan izin ananda ${leaveReq.studentName} berhasil dihapus dari sistem.`
        });
    } catch (error) {
        console.error('Error deleting leave request:', error);
        res.status(500).json({ message: 'Gagal menghapus histori surat izin' });
    }
};

// [T-05] 6. Revoke Status Izin / Sakit Beralasan (BK / Admin)
// Membatalkan status APPROVED menjadi REVOKED dan membersihkan attendance placeholder agar siswa tidak tertahan
export const revokeStudentLeaveRequest = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const user = (req as any).user;
        const { reason } = req.body;

        if (!reason || !String(reason).trim()) {
            return res.status(400).json({
                success: false,
                message: 'Alasan pencabutan status izin/sakit wajib diisi (misal: Siswa hadir fisik / salah input).'
            });
        }

        const leaveReq = await (prisma as any).studentLeaveRequest.findUnique({
            where: { id }
        });

        if (!leaveReq) {
            return res.status(404).json({ success: false, message: 'Data izin/sakit tidak ditemukan.' });
        }

        const start = new Date(leaveReq.startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(leaveReq.endDate || leaveReq.startDate);
        end.setHours(23, 59, 59, 999);

        const updated = await (prisma as any).studentLeaveRequest.update({
            where: { id },
            data: {
                status: 'REVOKED',
                rejectionNote: `Dicabut oleh ${user?.name || 'BK'}: ${String(reason).trim()}`,
                verifiedBy: user?.name || 'Guru BK',
                verifiedAt: new Date()
            }
        });

        // Hapus presensi SICK/PERMISSION yang otomatis terbuat untuk rentang tanggal tersebut
        await prisma.attendance.deleteMany({
            where: {
                userId: leaveReq.studentId,
                status: { in: ['SICK', 'SAKIT', 'PERMISSION', 'IZIN'] },
                scanTime: { gte: start, lte: end }
            }
        }).catch(() => null);

        await logAudit(req, 'REVOKE_LEAVE_REQUEST', `Izin ${id} (${leaveReq.studentName}) dicabut oleh ${user?.name}`, {
            requestId: id,
            reason: String(reason).trim(),
            revokedBy: user?.name
        });

        res.json({
            success: true,
            message: `✅ Izin ${leaveReq.studentName} berhasil dicabut. Siswa kini dapat melakukan presensi scan secara normal.`,
            leave: updated
        });
    } catch (error: any) {
        console.error('Error in revokeStudentLeaveRequest:', error);
        res.status(500).json({ success: false, message: 'Gagal mencabut status izin: ' + error.message });
    }
};