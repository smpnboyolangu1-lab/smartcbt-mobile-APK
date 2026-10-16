import { Request, Response } from 'express';
import prisma from '../utils/db';
import { logAudit } from '../services/auditLogger';
import { sendFcmToUser, sendFcmToRole } from '../services/fcmService';

// 1. Ambil Riwayat Kunjungan & Rekam Medis UKS
export const getUksVisits = async (req: Request, res: Response) => {
    try {
        const { className, search } = req.query;

        const whereClause: any = {};
        if (className && className !== 'ALL') {
            whereClause.user = { className: String(className) };
        }
        if (search && typeof search === 'string') {
            whereClause.OR = [
                { complaint: { contains: search } },
                { medicine: { contains: search } },
                { user: { name: { contains: search } } },
                { user: { username: { contains: search } } }
            ];
        }

        const visits = await prisma.uksVisit.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        className: true,
                        gender: true,
                        bloodType: true,
                        allergies: true,
                        parentPhone: true
                    }
                }
            },
            orderBy: { checkInTime: 'desc' }
        });

        res.json(visits);
    } catch (error) {
        console.error('Error fetching UKS visits:', error);
        res.status(500).json({ message: 'Gagal memuat rekam medis UKS' });
    }
};

// 2. Catat Kunjungan & Rekam Medis Siswa di UKS
export const createUksVisit = async (req: Request, res: Response) => {
    try {
        const {
            studentId,
            complaint,
            treatment,
            medicine,
            disposition,
            category,
            isFainting,
            incidentLocation,
            temperature,
            bloodPressure,
            bedNumber,
            officerName
        } = req.body;

        if (!studentId || !complaint) {
            return res.status(400).json({ message: 'Siswa dan Keluhan/Gejala wajib diisi' });
        }

        const isFaint = (category === 'PINGSAN') ||
            (complaint && complaint.toLowerCase().includes('pingsan')) ||
            !!isFainting;

        // Hitung akumulasi pingsan siswa ini
        const prevFaintCount = await prisma.uksVisit.count({
            where: { userId: studentId, isFainting: true }
        });
        const currentFaintSnapshot = isFaint ? prevFaintCount + 1 : prevFaintCount;

        const isAlertCounselor = isFaint || currentFaintSnapshot >= 2;

        const visit = await prisma.uksVisit.create({
            data: {
                userId: studentId,
                category: category || (isFaint ? 'PINGSAN' : 'LAINNYA'),
                isFainting: isFaint,
                faintCountSnapshot: currentFaintSnapshot,
                incidentLocation: incidentLocation || 'Ruang Kelas',
                temperature: temperature ? parseFloat(temperature) : null,
                bloodPressure: bloodPressure || null,
                bedNumber: bedNumber || (disposition === 'REST_AT_UKS' ? 'Bed 01' : null),
                disposition: disposition || 'REST_AT_UKS',
                complaint,
                treatment: treatment || (isFaint ? 'Posisi kaki ditinggikan, minyak kayu putih, istirahat tenang' : 'Istirahat di ruang UKS'),
                medicine: medicine || null,
                officerName: officerName || 'Petugas UKS',
                parentNotified: true,
                counselorAlerted: isAlertCounselor,
                checkInTime: new Date()
            },
            include: {
                user: true
            }
        });

        // Kirim Notifikasi Darurat Otomatis ke Orang Tua & Wali Kelas
        try {
            const tempStr = visit.temperature ? ` (Suhu: ${visit.temperature}°C)` : '';
            const bedStr = visit.bedNumber ? ` di ${visit.bedNumber}` : '';
            const faintStr = isFaint ? ` [Peringatan Pingsan ke-${currentFaintSnapshot}]` : '';
            const notifTitle = `🏥 UKS SEKOLAH: Ananda ${visit.user.name} Dirawat`;
            const notifMsg = `Ananda sedang ditangani di Ruang UKS${bedStr}.${faintStr} Keluhan: ${visit.complaint}${tempStr}. Lokasi: ${visit.incidentLocation}. Penanganan: ${visit.treatment}.`;

            await prisma.notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: visit.user.id,
                    studentName: visit.user.name,
                    className: visit.user.className || 'VII-A',
                    title: notifTitle,
                    message: notifMsg,
                    category: 'UKS_HEALTH'
                }
            });

            // Push FCM ke Akun Orang Tua (P[NISN])
            if (visit.user.nisn) {
                const parentUser = await prisma.user.findFirst({
                    where: {
                        role: 'PARENT',
                        OR: [
                            { username: 'P' + visit.user.nisn },
                            { nisn: visit.user.nisn }
                        ]
                    }
                });
                if (parentUser) {
                    await sendFcmToUser(
                        parentUser.id,
                        notifTitle,
                        notifMsg,
                        {
                            type: 'UKS_CHECKIN',
                            studentId: visit.user.id,
                            visitId: visit.id,
                            category: visit.category || 'UKS'
                        }
                    );
                }
            }

            // Push FCM ke Wali Kelas
            if (visit.user.className) {
                const homeroomTeacher = await prisma.user.findFirst({
                    where: {
                        role: 'TEACHER',
                        OR: [
                            { tugasTambahan: { contains: 'WALI_KELAS' }, teachingClasses: { contains: visit.user.className } },
                            { rolesTambahan: { contains: 'wali_kelas' }, teachingClasses: { contains: visit.user.className } }
                        ]
                    }
                });
                if (homeroomTeacher) {
                    await sendFcmToUser(
                        homeroomTeacher.id,
                        `🏥 Info UKS: Siswa Kelas ${visit.user.className}`,
                        `Siswa ${visit.user.name} sedang dirawat di UKS. Keluhan: ${visit.complaint}.`,
                        {
                            type: 'UKS_CHECKIN',
                            studentId: visit.user.id,
                            visitId: visit.id,
                            className: visit.user.className
                        }
                    );
                }
            }

            // Jika ada indikasi pingsan berulang, kirim push ke Guru BK
            if (isAlertCounselor) {
                await sendFcmToRole(
                    'COUNSELOR',
                    `⚠️ Perhatian Medis: ${visit.user.name} (${visit.user.className}) Pingsan`,
                    `Siswa tercatat pingsan (${currentFaintSnapshot}x). Mohon koordinasi dengan pihak UKS dan Orang Tua.`,
                    {
                        type: 'UKS_ALERT_BK',
                        studentId: visit.user.id,
                        visitId: visit.id
                    }
                );
            }
        } catch (notifErr) {
            console.error('Error sending parent & teacher UKS notification:', notifErr);
        }

        if (disposition === 'SENT_HOME' || disposition === 'REST_AT_UKS') {
            await prisma.attendance.create({
                data: {
                    userId: studentId,
                    type: 'GATE_IN',
                    method: 'MANUAL',
                    status: 'SICK',
                    note: `Kunjungan UKS (${category || 'Sakit'}): ${complaint}`
                }
            });
        }

        res.json({
            success: true,
            message: `🩺 Rekam medis UKS berhasil dicatat untuk ${visit.user.name}. ${isFaint ? `(Peringatan: Siswa telah ${currentFaintSnapshot}x pingsan!)` : ''}`,
            visit
        });
    } catch (error) {
        console.error('Error creating UKS visit:', error);
        res.status(500).json({ message: 'Gagal mencatat kunjungan UKS' });
    }
};

// 3. Update Profil Kesehatan Siswa (Golongan Darah & Alergi)
export const updateStudentHealth = async (req: Request, res: Response) => {
    try {
        const studentId = req.params.id as string;
        const { bloodType, allergies } = req.body;

        const updated = await prisma.user.update({
            where: { id: studentId },
            data: {
                bloodType: bloodType || null,
                allergies: allergies || null
            }
        });

        res.json({ message: 'Data kesehatan ' + updated.name + ' berhasil diperbarui', user: updated });
    } catch (error) {
        console.error('Error updating student health:', error);
        res.status(500).json({ message: 'Gagal memperbarui data kesehatan siswa' });
    }
};

// 4. Ambil Daftar Seluruh Konseling / Pengaduan Siswa (Untuk Portal BK)
export const getBkConsultations = async (req: Request, res: Response) => {
    try {
        const { category, status } = req.query;
        const whereClause: any = {};

        if (category && category !== 'ALL') whereClause.category = String(category);
        if (status && status !== 'ALL') whereClause.status = String(status);

        const consultations = await prisma.bkConsultation.findMany({
            where: whereClause,
            include: {
                student: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        className: true,
                        nisn: true,
                        nis: true,
                        gender: true,
                        religion: true,
                        pob: true,
                        dob: true,
                        address: true,
                        fatherName: true,
                        motherName: true,
                        parentPhone: true,
                        bloodType: true,
                        allergies: true,
                        points: true,
                        homeroomTeacher: true,
                        counselorTeacher: true,
                        classRole: true,
                        latestHeightCm: true,
                        latestWeightKg: true,
                        latestBmi: true,
                        nutritionalStatus: true
                    }
                },
                counselor: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Masking data rahasia untuk pelapor anonim (Whistleblower Protection)
        const sanitized = consultations.map((c: any) => {
            if (c.isAnonymous) {
                return {
                    ...c,
                    studentId: 'ANONYMOUS',
                    student: {
                        id: 'ANONYMOUS',
                        name: 'Anonim (Dirahasiakan / Whistleblower)',
                        username: 'anonim',
                        className: '-',
                        nisn: null,
                        nis: null,
                        gender: null,
                        religion: null,
                        pob: null,
                        dob: null,
                        address: null,
                        fatherName: null,
                        motherName: null,
                        parentPhone: null,
                        bloodType: null,
                        allergies: null,
                        points: null,
                        homeroomTeacher: null,
                        counselorTeacher: null,
                        classRole: null,
                        latestHeightCm: null,
                        latestWeightKg: null,
                        latestBmi: null,
                        nutritionalStatus: null
                    }
                };
            }
            return c;
        });

        res.json(sanitized);
    } catch (error) {
        console.error('Error fetching consultations:', error);
        res.status(500).json({ message: 'Gagal memuat daftar konseling' });
    }
};

// 5. Endpoint Siswa Melihat Riwayat Pengaduan & Pesan Pribadinya
export const getStudentMyConsultations = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ message: 'Unauthorized' });

        const queryId = (req.query.childId || req.query.studentId) as string;
        let targetStudentId: string | null = null;

        let whereCondition: any = {};

        if (user.role === 'STUDENT') {
            // SISWA: HANYA boleh melihat sesi curhat/konseling miliknya sendiri.
            // Privasi Total: Pesan dari Orang Tua (WALI_MURID) DIKECUALIKAN agar siswa tidak mengetahui.
            targetStudentId = user.id;
            whereCondition = {
                studentId: targetStudentId,
                category: { not: 'WALI_MURID' },
                NOT: [
                    { subject: { startsWith: '[KONSULTASI WALI MURID]' } },
                    { subject: { startsWith: '[WALI MURID]' } },
                    { subject: { startsWith: '[Janji Temu Wali Murid]' } }
                ]
            };
        } else if (user.role === 'PARENT') {
            // ORANG TUA: HANYA boleh melihat konsultasi kategori WALI_MURID.
            // Privasi Total: Curhat rahasia siswa / whistleblower bullying TIDAK BOLEH dibaca orang tua.
            const cleanNisn = (user.username || '').replace(/^[Pp]/, '').trim();
            if (queryId) {
                targetStudentId = String(queryId);
            } else {
                const child = await prisma.user.findFirst({
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
                    }
                });
                targetStudentId = child ? child.id : null;
            }

            if (!targetStudentId) {
                return res.json([]);
            }

            whereCondition = {
                studentId: targetStudentId,
                OR: [
                    { category: 'WALI_MURID' },
                    { category: 'KONSULTASI_WALI_MURID' },
                    { category: { contains: 'WALI_MURID' } },
                    { category: { contains: 'Wali' } },
                    { subject: { startsWith: '[KONSULTASI WALI MURID]' } },
                    { subject: { startsWith: '[WALI MURID]' } },
                    { subject: { startsWith: '[Janji Temu Wali Murid]' } },
                    { subject: { contains: 'WALI MURID' } },
                    { message: { contains: 'Wali Murid' } }
                ]
            };
        } else {
            // Guru BK / Counselor / Admin
            targetStudentId = queryId || user.id;
            whereCondition = { studentId: targetStudentId };
        }

        const consultations = await prisma.bkConsultation.findMany({
            where: whereCondition,
            include: {
                counselor: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(consultations);
    } catch (error) {
        console.error('Error fetching student consultations:', error);
        res.status(500).json({ message: 'Gagal memuat riwayat konsultasi' });
    }
};

// 6. Endpoint Siswa / Orang Tua Mengirim Pengaduan / Curhat / Konseling ke BK
export const createStudentReport = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { category, subject, message, isAnonymous, studentId } = req.body;

        if (!subject || !message) {
            return res.status(400).json({ message: 'Subjek dan Isi Pesan Pengaduan wajib diisi' });
        }

        let targetStudentId = studentId;
        if (!targetStudentId) {
            if (user.role === 'STUDENT') {
                targetStudentId = user.id;
            } else if (user.role === 'PARENT') {
                const cleanNisn = (user.username || '').replace(/^[Pp]/, '').trim();
                const child = await prisma.user.findFirst({
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
                    }
                });
                targetStudentId = child ? child.id : user.id;
            } else {
                targetStudentId = user.id;
            }
        }

        const consultation = await prisma.bkConsultation.create({
            data: {
                studentId: targetStudentId,
                category: category || (user.role === 'PARENT' ? 'WALI_MURID' : 'BULLYING'),
                subject,
                message,
                isAnonymous: Boolean(isAnonymous),
                status: 'PENDING'
            }
        });

        const successText = user.role === 'PARENT'
            ? '💬 Pesan konsultasi wali murid telah berhasil dikirim ke Guru BK.'
            : '🕊️ Pesan / Laporan Pengaduan Anda telah terkirim dengan aman ke Guru BK. Kami akan menjaga kerahasiaan Anda.';

        const sanitizedConsultation = consultation.isAnonymous
            ? { ...consultation, studentId: 'ANONYMOUS' }
            : consultation;

        res.json({
            success: true,
            message: successText,
            consultation: sanitizedConsultation
        });
    } catch (error) {
        console.error('Error submitting student report:', error);
        res.status(500).json({ success: false, message: 'Gagal mengirim pesan pengaduan ke BK' });
    }
};

// 7. Guru BK Memberi Tanggapan / Balasan Pesan ke Siswa
export const replyBkConsultation = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const user = (req as any).user;
        let replyText = req.body.replyMessage || req.body.response || req.body.reply || '';
        const status = req.body.status || 'REPLIED';
        const { scheduleDate, scheduleTime, scheduleLocation, scheduleNotes, notes, date, time, location } = req.body;

        const meetingDate = scheduleDate || date;
        const meetingTime = scheduleTime || time;
        const meetingLocation = scheduleLocation || location || 'Ruang Bimbingan Konseling (BK)';
        const meetingNotes = scheduleNotes || notes || '';

        let validCounselorId: string | null = null;
        if (user && user.id) {
            const counselorUser = await prisma.user.findUnique({ where: { id: user.id } });
            if (counselorUser) validCounselorId = user.id;
        }

        // Penanganan jika dipilih penjadwalan tatap muka di Ruang BK (Hanya jika status SCHEDULED dan ada tanggal pertemuan)
        const isScheduled = status === 'SCHEDULED' && Boolean(meetingDate);
        let scheduleInfoStr = '';
        if (isScheduled) {
            const loc = meetingLocation || 'Ruang Bimbingan Konseling (BK)';
            const formattedDate = meetingDate ? new Date(meetingDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Hari yang ditentukan';
            const timeInfo = meetingTime ? `Pukul ${meetingTime} WIB` : 'Waktu istirahat / jam pelajaran BK';
            const notesInfo = meetingNotes ? `\n• Catatan / Agenda: ${meetingNotes}` : '';
            scheduleInfoStr = `\n\n📌 JADWAL PERTEMUAN TATAP MUKA DI RUANG BK:\n• Hari/Tanggal: ${formattedDate}\n• Waktu: ${timeInfo}\n• Tempat: ${loc}${notesInfo}`;
            
            if (!replyText.includes(loc)) {
                replyText = (replyText ? replyText.trim() + '\n' : '') + scheduleInfoStr;
            }
        }

        const isResolved = status === 'RESOLVED' || status === 'COMPLETED' || status === 'SELESAI';
        const finalStatus = isScheduled ? 'SCHEDULED' : (isResolved ? 'RESOLVED' : (status || 'REPLIED'));

        const updated = await prisma.bkConsultation.update({
            where: { id },
            data: {
                replyMessage: replyText,
                replyDate: new Date(),
                counselorId: validCounselorId,
                status: finalStatus
            },
            include: { student: true }
        });

        // Kirim notifikasi balasan / jadwal BK ke Siswa dan Orang Tua
        try {
            const studentObj = updated.student || { name: 'Siswa', className: '-', parentPhone: null };
            const studentName = studentObj.name || 'Siswa';
            const studentClass = studentObj.className || '-';
            const parentPhone = studentObj.parentPhone || null;

            const studentNotifTitle = isScheduled 
                ? '📅 Undangan Konseling di Ruang BK' 
                : (isResolved ? '✅ Konseling BK Selesai Ditangani' : '💬 Balasan Bimbingan Konseling (BK)');
            const studentNotifMsg = isScheduled
                ? `Guru BK mengundang ananda ${studentName} untuk konseling tatap muka di ${meetingLocation}.${meetingNotes ? ` Catatan: ${meetingNotes}.` : ''} Silakan buka menu Layanan BK di aplikasi Smart School untuk melihat detail jadwal dan arahan guru.`
                : (isResolved 
                    ? `Guru BK telah memberikan solusi dan menandai konsultasi Anda perihal: "${updated.subject}" sebagai SELESAI. Buka menu Layanan BK untuk membaca rangkuman solusi tuntas.`
                    : `Guru BK telah menanggapi pesan Anda perihal: "${updated.subject}". Silakan buka menu Layanan BK untuk membaca respon lengkap.`);

            await prisma.notificationMessage.create({
                data: {
                    recipientId: updated.studentId,
                    recipientRole: 'STUDENT',
                    studentId: updated.studentId,
                    studentName: studentName,
                    className: studentClass || undefined,
                    category: isScheduled ? 'BK_SCHEDULE' : (isResolved ? 'BK_RESOLVED' : 'BK_REPLY'),
                    title: studentNotifTitle,
                    message: studentNotifMsg
                }
            });

            if (parentPhone || isScheduled) {
                const parentNotifTitle = isScheduled
                    ? '📅 Jadwal Konseling Siswa di Ruang BK'
                    : '💬 Tanggapan Konseling BK Ananda';
                const parentNotifMsg = isScheduled
                    ? `Pemberitahuan Orang Tua: Ananda ${studentName} (${studentClass}) telah dijadwalkan sesi bimbingan konseling tatap muka di ${meetingLocation}.${meetingNotes ? ` Catatan: ${meetingNotes}.` : ''} Silakan buka aplikasi Smart School untuk detail arahan guru konselor.`
                    : `Guru BK telah menanggapi pesan bimbingan konseling ananda ${studentName}. Silakan buka menu BK di aplikasi Smart School.`;

                await prisma.notificationMessage.create({
                    data: {
                        recipientPhone: parentPhone || undefined,
                        recipientRole: 'PARENT',
                        studentId: updated.studentId,
                        studentName: studentName,
                        className: studentClass || undefined,
                        category: isScheduled ? 'BK_SCHEDULE' : 'BK_REPLY',
                        title: parentNotifTitle,
                        message: parentNotifMsg
                    }
                });
            }
        } catch (notifErr) {
            console.warn('Notification for BK reply non-fatal:', notifErr);
        }

        const safeStudentName = updated.student?.name || 'Siswa';
        const sanitizedUpdated = updated.isAnonymous
            ? {
                ...updated,
                studentId: 'ANONYMOUS',
                student: { id: 'ANONYMOUS', name: 'Anonim (Dirahasiakan / Whistleblower)', className: '-' }
            }
            : updated;

        res.json({
            success: true,
            message: isScheduled 
                ? '📅 Jadwal tatap muka di Ruang BK berhasil dikirimkan ke siswa & orang tua!'
                : 'Balasan dan tindak lanjut berhasil dikirim ke ' + (updated.isAnonymous ? 'Siswa (Privat)' : safeStudentName),
            consultation: sanitizedUpdated
        });
    } catch (error) {
        console.error('Error replying consultation:', error);
        res.status(500).json({ success: false, message: 'Gagal membalas pesan konseling' });
    }
};

// 8. Catat Poin Pelanggaran / Prestasi Siswa & Terbitkan BAP / SP
export const createDisciplineRecord = async (req: Request, res: Response) => {
    try {
        const {
            studentId,
            type,
            category,
            description,
            chronology,
            sanction,
            sanctionLevel,
            bapNumber,
            reportedBy,
            points
        } = req.body;

        const numPoints = Number(points) || 0;
        const resolvedType = type || 'PELANGGARAN';
        const resolvedCategory = category || 'RINGAN';
        const resolvedLevel = sanctionLevel || (numPoints >= 50 ? 'SP3_SKORSING' : numPoints >= 30 ? 'SP2' : numPoints >= 15 ? 'SP1' : 'PENDING');
        const resolvedBapNo = bapNumber || (resolvedLevel.startsWith('SP') ? `421.3/BAP-${Math.floor(1000 + Math.random() * 9000)}/SMP1/${new Date().getFullYear()}` : null);

        const record = await (prisma as any).disciplineRecord.create({
            data: {
                userId: studentId,
                type: resolvedType,
                category: resolvedCategory,
                description,
                chronology: chronology || null,
                sanction: sanction || null,
                sanctionLevel: resolvedLevel,
                bapNumber: resolvedBapNo,
                reportedBy: reportedBy || 'Guru BK / Wali Kelas',
                points: numPoints
            },
            include: {
                user: {
                    select: { id: true, name: true, className: true, username: true }
                }
            }
        });

        await prisma.user.update({
            where: { id: studentId },
            data: {
                points: { increment: resolvedType === 'PELANGGARAN' ? numPoints : -numPoints }
            }
        });

        // Jika sanksi berupa Surat Peringatan (SP 1, SP 2, SP 3), otomatis buat entri DisciplineWarningLetter
        if (resolvedLevel && (resolvedLevel.startsWith('SP') || resolvedLevel.includes('SP'))) {
            try {
                const spClean = resolvedLevel.replace('_', '').substring(0, 3); // 'SP1', 'SP2', 'SP3'
                const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
                const curDate = new Date();
                const curMonth = romanMonths[curDate.getMonth()];
                const curYear = curDate.getFullYear();
                const randNum = Math.floor(100 + Math.random() * 900);
                const letterNo = `421.3/${spClean}-BK/${randNum}/${curMonth}/${curYear}`;

                await prisma.disciplineWarningLetter.create({
                    data: {
                        userId: studentId,
                        spLevel: spClean,
                        totalPoints: ((record.user as any)?.points || 0) + numPoints,
                        letterNo
                    }
                });
            } catch (errLetter) {
                console.warn('Surat peringatan sudah ada atau lewati pembuatan otomatis:', errLetter);
            }
        }

        res.json({
            success: true,
            message: `Catatan kedisiplinan ${record.user.name} berhasil disimpan! Status: ${resolvedLevel} ${resolvedBapNo ? `(Nomor BAP: ${resolvedBapNo})` : ''}`,
            record
        });
    } catch (error) {
        console.error('Error creating discipline record:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat poin kedisiplinan' });
    }
};

// 8.A Hapus Catatan Kedisiplinan & Batalkan SP Terkait
export const deleteDisciplineRecord = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const record = await (prisma as any).disciplineRecord.findUnique({
            where: { id },
            include: { user: true }
        });

        if (!record) {
            return res.status(404).json({ success: false, message: 'Catatan kedisiplinan tidak ditemukan' });
        }

        // Sesuaikan kembali akumulasi poin siswa
        if (record.user) {
            let pointDelta = 0;
            if (record.type === 'PELANGGARAN') {
                pointDelta = -record.points;
            } else if (record.type === 'PRESTASI') {
                pointDelta = record.points;
            }
            const currentPoints = record.user.points || 0;
            const newPoints = Math.max(0, currentPoints + pointDelta);
            await prisma.user.update({
                where: { id: record.userId },
                data: { points: newPoints }
            });
        }

        // Jika catatan memiliki sanksi SP (SP_1, SP_2, SP_3), bersihkan juga surat peringatan aktif terkait jika ada
        if (record.sanctionLevel && (record.sanctionLevel.startsWith('SP') || record.sanctionLevel.includes('SP'))) {
            try {
                const spClean = record.sanctionLevel.replace('_', '');
                await (prisma as any).disciplineWarningLetter.deleteMany({
                    where: {
                        userId: record.userId,
                        spLevel: { in: [record.sanctionLevel, spClean, 'SP1', 'SP2', 'SP3'] }
                    }
                });
            } catch (errClean) {
                console.warn('Peringatan saat membersihkan SP terkait:', errClean);
            }
        }

        await (prisma as any).disciplineRecord.delete({ where: { id } });

        res.json({
            success: true,
            message: `✅ Catatan kedisiplinan "${record.description}" dan sanksi SP siswa berhasil dihapus!`
        });
    } catch (error: any) {
        console.error('Error in deleteDisciplineRecord:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus catatan kedisiplinan: ' + error.message });
    }
};

// 8.B Dokumentasi Sesi Konseling Siswa (Individu, Kelompok, Karir, Akademik, Perilaku)
export const getCounselingSessions = async (req: Request, res: Response) => {
    try {
        const { studentId, type, status } = req.query;
        const whereClause: any = {};
        if (studentId && studentId !== 'ALL') whereClause.studentId = String(studentId);
        if (type && type !== 'ALL') whereClause.type = String(type);
        if (status && status !== 'ALL') whereClause.status = String(status);

        const sessions = await (prisma as any).counselingSession.findMany({
            where: whereClause,
            include: {
                student: {
                    select: { id: true, name: true, className: true, username: true }
                }
            },
            orderBy: { sessionDate: 'desc' }
        });

        res.json({ success: true, sessions });
    } catch (error: any) {
        console.error('Error fetching counseling sessions:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data sesi konseling: ' + error.message });
    }
};

export const createCounselingSession = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            studentId,
            type,
            topic,
            problemDescription,
            solutionPlan,
            followUpAction,
            status,
            sessionDate
        } = req.body;

        if (!studentId || !topic || !problemDescription) {
            return res.status(400).json({ success: false, message: 'Siswa, Topik, dan Uraian Masalah wajib diisi' });
        }

        const session = await (prisma as any).counselingSession.create({
            data: {
                studentId,
                counselorId: user?.id || null,
                counselorName: user?.name || 'Guru BK',
                type: type || 'INDIVIDU',
                topic,
                problemDescription,
                solutionPlan: solutionPlan || null,
                followUpAction: followUpAction || null,
                status: status || 'OPEN',
                sessionDate: sessionDate ? new Date(sessionDate) : new Date()
            },
            include: {
                student: {
                    select: { id: true, name: true, className: true, username: true }
                }
            }
        });

        res.json({
            success: true,
            message: `Dokumentasi sesi konseling ${session.student.name} (${session.type}) berhasil dicatat!`,
            session
        });
    } catch (error: any) {
        console.error('Error creating counseling session:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat sesi konseling: ' + error.message });
    }
};

// 8.C Asesmen Minat Bakat Siswa & Rekomendasi Karir
export const getCareerAssessments = async (req: Request, res: Response) => {
    try {
        const { studentId, academicYear } = req.query;
        const whereClause: any = {};
        if (studentId && studentId !== 'ALL') whereClause.studentId = String(studentId);
        if (academicYear && academicYear !== 'ALL') whereClause.academicYear = String(academicYear);

        const assessments = await (prisma as any).careerAssessment.findMany({
            where: whereClause,
            include: {
                student: {
                    select: { id: true, name: true, className: true, username: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ success: true, assessments });
    } catch (error: any) {
        console.error('Error fetching career assessments:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat asesmen karir: ' + error.message });
    }
};

export const saveCareerAssessment = async (req: Request, res: Response) => {
    try {
        const {
            studentId,
            academicYear,
            interestFields,
            recommendedMajors,
            psychologicalNotes
        } = req.body;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'ID Siswa wajib disertakan' });
        }

        const assessment = await (prisma as any).careerAssessment.create({
            data: {
                studentId,
                academicYear: academicYear || '2025/2026',
                interestFields: typeof interestFields === 'string' ? interestFields : JSON.stringify(interestFields || []),
                recommendedMajors: typeof recommendedMajors === 'string' ? recommendedMajors : JSON.stringify(recommendedMajors || []),
                psychologicalNotes: psychologicalNotes || null
            },
            include: {
                student: {
                    select: { id: true, name: true, className: true }
                }
            }
        });

        res.json({
            success: true,
            message: `Asesmen pemetaan minat bakat & karir ${assessment.student.name} berhasil disimpan!`,
            assessment
        });
    } catch (error: any) {
        console.error('Error saving career assessment:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan asesmen karir: ' + error.message });
    }
};


// 8. Endpoint Orang Tua Mengirim Konsultasi ke Guru BK
export const createParentConsultation = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { subject, message, category, studentId } = req.body;

        if (!subject || !message) {
            return res.status(400).json({ success: false, message: 'Subjek dan Isi Pesan Konsultasi wajib diisi' });
        }

        const cleanNisn = (user.username || '').replace(/^[Pp]/, '').trim();
        let targetStudentId = studentId;

        if (targetStudentId) {
            // Validasi kepemilikan siswa
            const isChild = await prisma.user.findFirst({
                where: {
                    id: String(targetStudentId),
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
                return res.status(403).json({ success: false, message: 'Akses ditolak: Anda hanya dapat berkonsultasi untuk ananda sendiri.' });
            }
        } else {
            const child = await prisma.user.findFirst({
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
                }
            });
            targetStudentId = child ? child.id : null;
        }

        if (!targetStudentId) {
            return res.status(404).json({ success: false, message: 'Data anak tidak ditemukan' });
        }

        const consultation = await prisma.bkConsultation.create({
            data: {
                studentId: targetStudentId,
                category: category || 'WALI_MURID',
                subject: '[WALI MURID] ' + subject,
                message: message + ' (Pengirim: ' + (user.name || 'Wali Murid') + ')',
                isAnonymous: false,
                status: 'PENDING'
            },
            include: {
                student: { select: { id: true, name: true, className: true } }
            }
        });

        res.json({
            success: true,
            message: '💬 Pesan konsultasi berhasil dikirim ke Guru BK. Guru BK akan segera merespons melalui portal ini.',
            consultation
        });
    } catch (error) {
        console.error('Error creating parent consultation:', error);
        res.status(500).json({ success: false, message: 'Gagal mengirim pesan konsultasi' });
    }
};

// 7.B Hapus Pesan Konsultasi / Konseling (Wali Murid & Siswa)
export const deleteBkConsultation = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const existing = await prisma.bkConsultation.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Pesan konsultasi tidak ditemukan' });
        }
        await prisma.bkConsultation.delete({ where: { id } });
        await logAudit(req, 'DELETE_BK_CONSULTATION', `Consultation ID: ${id}`, { subject: existing.subject });
        res.json({ success: true, message: 'Pesan konsultasi berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting BK consultation:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus pesan konsultasi' });
    }
};

// 9. Endpoint Orang Tua Melihat Riwayat Konsultasi dengan Guru BK
export const getParentConsultations = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const queryStudentId = (req.query.studentId || req.query.childId) as string;
        let whereCondition: any = {
            OR: [
                { category: 'WALI_MURID' },
                { category: 'KONSULTASI_WALI_MURID' },
                { category: { contains: 'WALI_MURID' } },
                { category: { contains: 'Wali' } },
                { subject: { startsWith: '[KONSULTASI WALI MURID]' } },
                { subject: { startsWith: '[WALI MURID]' } },
                { subject: { startsWith: '[Janji Temu Wali Murid]' } },
                { subject: { contains: 'WALI MURID' } },
                { message: { contains: 'Wali Murid' } }
            ]
        };

        if (queryStudentId) {
            if (user && user.role === 'PARENT') {
                const cleanNisn = (user.username || '').replace(/^[Pp]/, '').trim();
                const isChild = await prisma.user.findFirst({
                    where: {
                        id: String(queryStudentId),
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
                    return res.status(403).json({ message: 'Akses ditolak' });
                }
            }
            whereCondition.studentId = String(queryStudentId);
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
            if (children.length === 0) {
                return res.json([]);
            }
            whereCondition.studentId = { in: children.map(c => c.id) };
        }

        const consultations = await prisma.bkConsultation.findMany({
            where: whereCondition,
            include: {
                student: { select: { id: true, name: true, className: true } },
                counselor: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const sanitized = consultations.map((c: any) => {
            if (c.isAnonymous) {
                return {
                    ...c,
                    studentId: 'ANONYMOUS',
                    student: { id: 'ANONYMOUS', name: 'Anonim (Dirahasiakan / Whistleblower)', className: '-' }
                };
            }
            return c;
        });

        res.json(sanitized);
    } catch (error) {
        console.error('Error fetching parent consultations:', error);
        res.status(500).json({ message: 'Gagal memuat konsultasi orang tua' });
    }
};

// 10. Ambil Rekap Poin Kedisiplinan & Pelanggaran / Prestasi Siswa
export const getDisciplineRecords = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { type, className, search, studentId, userId, childId } = req.query;
        const whereClause: any = {};

        let targetStudentId: string | null = (studentId || userId || childId) ? String(studentId || userId || childId) : null;

        if (user && user.role === 'STUDENT') {
            targetStudentId = user.id;
        } else if (user && user.role === 'PARENT' && !targetStudentId) {
            const cleanNisn = (user.username || '').replace(/^[Pp]/, '').trim();
            const child = await prisma.user.findFirst({
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
            if (child) targetStudentId = child.id;
        }

        if (targetStudentId && targetStudentId !== 'ALL') {
            whereClause.userId = targetStudentId;
        }
        if (type && type !== 'ALL') whereClause.type = String(type);
        if (className && className !== 'ALL') whereClause.user = { className: String(className) };
        if (search && typeof search === 'string') {
            whereClause.OR = [
                { description: { contains: search } },
                { user: { name: { contains: search } } },
                { user: { username: { contains: search } } }
            ];
        }

        const records = await prisma.disciplineRecord.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        nisn: true,
                        className: true,
                        points: true,
                        parentPhone: true,
                        counselorTeacher: true,
                        homeroomTeacher: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Jika dipanggil untuk 1 siswa spesifik (atau oleh Siswa/Orang Tua), sertakan ringkasan poin & SP siswa tersebut
        let studentSummary: any = null;
        if (targetStudentId && targetStudentId !== 'ALL') {
            const st = await prisma.user.findUnique({
                where: { id: targetStudentId },
                select: {
                    id: true,
                    name: true,
                    username: true,
                    nisn: true,
                    className: true,
                    points: true,
                    counselorTeacher: true,
                    homeroomTeacher: true,
                    warningLetters: {
                        orderBy: { issuedAt: 'desc' }
                    }
                }
            });
            if (st) {
                const pts = st.points || 0;
                const spStatus = st.warningLetters && st.warningLetters.length > 0
                    ? st.warningLetters[0].spLevel
                    : (pts >= 50 ? 'SP3' : pts >= 30 ? 'SP2' : pts >= 15 ? 'SP1' : 'AMAN');
                studentSummary = {
                    ...st,
                    points: pts,
                    spStatus,
                    nextThreshold: pts < 15 ? 15 : pts < 30 ? 30 : pts < 50 ? 50 : 100,
                    nextSpLabel: pts < 15 ? 'SP-1 (15 Poin)' : pts < 30 ? 'SP-2 (30 Poin)' : pts < 50 ? 'SP-3 (50 Poin)' : 'Batas Maksimum'
                };
            }
        }

        // Top siswa dengan akumulasi poin terbanyak untuk deteksi dini SP1, SP2, SP3 (Hanya untuk Staf/Guru/BK/Admin)
        const isStaff = !user || !['STUDENT', 'PARENT'].includes(user.role);
        const topStudents = isStaff ? await prisma.user.findMany({
            where: { role: 'STUDENT', points: { gt: 0 } },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                className: true,
                points: true,
                parentPhone: true,
                warningLetters: {
                    select: { id: true, spLevel: true, letterNo: true, issuedAt: true },
                    orderBy: { issuedAt: 'desc' }
                }
            },
            orderBy: { points: 'desc' },
            take: 30
        }) : [];

        res.json({
            success: true,
            records,
            topStudents,
            studentSummary
        });
    } catch (error) {
        console.error('Error fetching discipline records:', error);
        res.status(500).json({ message: 'Gagal memuat rekam kedisiplinan' });
    }
};

// 11. Checkout Kunjungan UKS (Siswa Selesai Istirahat & Kembali ke Kelas / Dipulangkan)
export const checkoutUksVisit = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { note, disposition } = req.body;

        const visit = await prisma.uksVisit.findUnique({ where: { id } });
        if (!visit) return res.status(404).json({ message: 'Data kunjungan UKS tidak ditemukan' });

        const updated = await prisma.uksVisit.update({
            where: { id },
            data: {
                checkOutTime: new Date(),
                treatment: note ? `${visit.treatment || ''} [Selesai: ${note}]` : visit.treatment
            },
            include: { user: true }
        });

        // Jika disposisi dipulangkan sakit, catat status SICK di absensi gate
        if (disposition === 'SENT_HOME') {
            await prisma.attendance.create({
                data: {
                    userId: visit.userId,
                    type: 'GATE_OUT',
                    method: 'MANUAL',
                    status: 'SICK',
                    note: 'Checkout UKS - Dipulangkan sakit: ' + (note || visit.complaint)
                }
            });
        }

        res.json({
            success: true,
            message: `Siswa ${updated.user.name} telah selesai periksa/istirahat di UKS.`,
            visit: updated
        });
    } catch (error) {
        console.error('Error checking out UKS visit:', error);
        res.status(500).json({ message: 'Gagal memproses checkout kunjungan UKS' });
    }
};

// 12. Statistik Langsung & Status Kasur UKS
export const getUksStatsAndBeds = async (req: Request, res: Response) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todayVisits = await prisma.uksVisit.findMany({
            where: { checkInTime: { gte: todayStart } },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        className: true,
                        bloodType: true,
                        allergies: true,
                        parentPhone: true
                    }
                }
            },
            orderBy: { checkInTime: 'desc' }
        });

        // Pasien yang sedang istirahat di kasur UKS (belum checkout)
        const restingPatients = todayVisits.filter(v => !v.checkOutTime);

        // Kapasitas kasur UKS sekolah (default 4 kasur)
        const totalBeds = 4;
        const occupiedBeds = restingPatients.length;
        const availableBeds = Math.max(0, totalBeds - occupiedBeds);

        // Pasien dipulangkan sakit hari ini
        const sentHomeCount = todayVisits.filter(v => (v.treatment || '').includes('Dipulangkan') || (v.treatment || '').includes('Pulang')).length;

        res.json({
            success: true,
            totalVisitsToday: todayVisits.length,
            occupiedBeds,
            availableBeds,
            totalBeds,
            sentHomeCount,
            restingPatients,
            todayVisits
        });
    } catch (error) {
        console.error('Error fetching UKS stats:', error);
        res.status(500).json({ message: 'Gagal memuat statistik UKS' });
    }
};

// 13. Ambil Rekam Medis & Riwayat Kesehatan Siswa (Integrasi UKS - BK - APK)
export const getStudentHealthHistory = async (req: Request, res: Response) => {
    try {
        const studentId = req.params.id as string;
        if (!studentId) {
            return res.status(400).json({ message: 'ID Siswa wajib diisi' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: {
                id: true,
                name: true,
                username: true,
                className: true,
                gender: true,
                bloodType: true,
                allergies: true,
                parentPhone: true
            }
        });

        if (!student) {
            return res.status(404).json({ message: 'Data siswa tidak ditemukan' });
        }

        const visits = await prisma.uksVisit.findMany({
            where: { userId: studentId },
            orderBy: { checkInTime: 'desc' }
        });

        const totalSickDays = await prisma.attendance.count({
            where: {
                userId: studentId,
                status: 'SICK'
            }
        });

        res.json({
            success: true,
            student: {
                ...student,
                totalSickDays
            },
            visits
        });
    } catch (error) {
        console.error('Error fetching student health history:', error);
        res.status(500).json({ message: 'Gagal memuat riwayat kesehatan siswa' });
    }
};

// 14. Endpoint Siswa Melihat Riwayat Kesehatan Pribadi di Mobile APK
export const getStudentMyHealthHistory = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const queryId = (req.query.childId || req.query.studentId || req.query.id || req.query.nisn || req.query.username) as string;

        let student = null;
        if (queryId) {
            student = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: queryId },
                        { username: queryId },
                        { nisn: queryId }
                    ]
                }
            });
        }

        if (!student && user) {
            student = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: user.id },
                        { username: user.username }
                    ]
                }
            });
        }

        if (!student) {
            // Graceful fallback to first student if called by admin/teacher testing
            student = await prisma.user.findFirst({
                where: { role: 'STUDENT' },
                orderBy: { name: 'asc' }
            });
        }

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data profil siswa tidak ditemukan' });
        }

        // Gunakan atribut antropometri riil, jangan menimpa data medis siswa dengan dummy
        const studentTargetId = student.id;
        let height = student.latestHeightCm || null;
        let weight = student.latestWeightKg || null;
        let bmi = (height && weight) ? Number((weight / Math.pow(height / 100, 2)).toFixed(1)) : (student.latestBmi || null);
        let nutStatus = student.nutritionalStatus || (bmi ? 'NORMAL' : 'BELUM DIUKUR');
        let bType = student.bloodType || 'Belum Terdata';
        let alg = student.allergies || 'Tidak ada catatan alergi khusus';

        const [visits, measurements, faintCount, totalSickDays, activeBed, occupiedBeds] = await Promise.all([
            prisma.uksVisit.findMany({
                where: { userId: studentTargetId },
                orderBy: { checkInTime: 'desc' }
            }),
            prisma.studentHealthMeasurement.findMany({
                where: { studentId: studentTargetId },
                orderBy: { createdAt: 'desc' },
                take: 10
            }),
            prisma.uksVisit.count({
                where: { userId: studentTargetId, isFainting: true }
            }),
            prisma.attendance.count({
                where: { userId: studentTargetId, status: 'SICK' }
            }),
            prisma.uksVisit.findFirst({
                where: { userId: studentTargetId, checkOutTime: null, disposition: 'REST_AT_UKS' }
            }),
            prisma.uksVisit.findMany({
                where: { checkOutTime: null, bedNumber: { not: null } },
                select: { bedNumber: true }
            })
        ]);

        const occupiedBedNumbers = new Set(occupiedBeds.map(b => b.bedNumber));
        const beds = [
            { bedNumber: 'Bed 01', isOccupied: occupiedBedNumbers.has('Bed 01'), isSelf: activeBed?.bedNumber === 'Bed 01' },
            { bedNumber: 'Bed 02', isOccupied: occupiedBedNumbers.has('Bed 02'), isSelf: activeBed?.bedNumber === 'Bed 02' },
            { bedNumber: 'Bed 03', isOccupied: occupiedBedNumbers.has('Bed 03'), isSelf: activeBed?.bedNumber === 'Bed 03' },
            { bedNumber: 'Bed 04', isOccupied: occupiedBedNumbers.has('Bed 04'), isSelf: activeBed?.bedNumber === 'Bed 04' }
        ];

        res.json({
            success: true,
            student: {
                id: student.id,
                name: student.name,
                username: student.username,
                className: student.className,
                bloodType: bType,
                allergies: alg,
                height: height,
                weight: weight,
                bmi: bmi,
                bmiStatus: nutStatus,
                totalSickDays: Math.max(totalSickDays, 1),
                faintCount,
                faintingCount: faintCount,
                isRestingAtUks: !!activeBed,
                currentBedNumber: activeBed?.bedNumber || null
            },
            visits,
            measurements,
            beds
        });
    } catch (error) {
        console.error('Error fetching student own health history:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat rekam medis siswa' });
    }
};

// 14b. Endpoint Siswa Mengirimkan Laporan Keluhan Sakit Mandiri ke UKS / Guru Piket
export const createStudentUksReport = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user || !user.id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { complaint, category, incidentLocation } = req.body;
        if (!complaint) {
            return res.status(400).json({ message: 'Keluhan atau gejala sakit wajib diisi' });
        }

        const isFaint = (category === 'PINGSAN') ||
            (complaint && complaint.toLowerCase().includes('pingsan'));

        const prevFaintCount = await prisma.uksVisit.count({
            where: { userId: user.id, isFainting: true }
        });
        const currentFaintSnapshot = isFaint ? prevFaintCount + 1 : prevFaintCount;

        // Alokasikan kasur UKS yang masih kosong secara otomatis
        const activeOccupied = await prisma.uksVisit.findMany({
            where: { checkOutTime: null, bedNumber: { not: null } },
            select: { bedNumber: true }
        });
        const occupiedSet = new Set(activeOccupied.map(o => o.bedNumber));
        const allBeds = ['Bed 01', 'Bed 02', 'Bed 03', 'Bed 04'];
        const allocatedBed = allBeds.find(b => !occupiedSet.has(b)) || 'Bed 01';

        const visit = await prisma.uksVisit.create({
            data: {
                userId: user.id,
                category: category || (isFaint ? 'PINGSAN' : 'LAINNYA'),
                isFainting: isFaint,
                faintCountSnapshot: currentFaintSnapshot,
                incidentLocation: incidentLocation || 'Ruang Kelas',
                disposition: 'REST_AT_UKS',
                bedNumber: allocatedBed,
                complaint,
                treatment: 'Laporan mandiri siswa (Menunggu pemeriksaan petugas UKS / Guru Piket)',
                officerName: 'Laporan Mandiri Siswa',
                parentNotified: true,
                counselorAlerted: isFaint || currentFaintSnapshot >= 2,
                checkInTime: new Date()
            }
        });

        // Sinkronisasi otomatis ke status presensi hari ini (Tercatat SAKIT / UKS, bukan ALPA)
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            const existingAtt = await prisma.attendance.findFirst({
                where: {
                    userId: user.id,
                    scanTime: { gte: todayStart, lte: todayEnd }
                }
            });

            if (existingAtt) {
                await prisma.attendance.update({
                    where: { id: existingAtt.id },
                    data: {
                        status: 'SICK',
                        note: `Dirawat di UKS: ${complaint} (${allocatedBed})`
                    }
                });
            } else {
                await prisma.attendance.create({
                    data: {
                        userId: user.id,
                        type: 'GATE_IN',
                        method: 'UKS_REPORT',
                        status: 'SICK',
                        scanTime: new Date(),
                        note: `Dirawat di UKS: ${complaint} (${allocatedBed})`
                    }
                });
            }
        } catch (attErr) {
            console.warn('Sync UKS attendance non-fatal:', attErr);
        }

        // Kirim notifikasi darurat ke orang tua
        try {
            await prisma.notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: user.id,
                    studentName: user.name || 'Siswa',
                    className: user.className || 'Siswa',
                    title: `🏥 UKS SEKOLAH: Laporan Sakit Mandiri`,
                    message: `Siswa ${user.name} melaporkan keluhan sakit: ${complaint}. Siswa diarahkan istirahat di UKS (${allocatedBed}).`,
                    category: 'UKS_HEALTH'
                }
            });
        } catch (notifErr) {
            console.warn('Failed to send auto notification:', notifErr);
        }

        res.json({
            success: true,
            message: `🚨 Laporan sakit Anda berhasil diterima! Silakan beristirahat di ${allocatedBed}. Petugas UKS & Guru Piket telah disiagakan.`,
            visit
        });
    } catch (error) {
        console.error('Error reporting student UKS condition:', error);
        res.status(500).json({ message: 'Gagal mengirim laporan UKS' });
    }
};

// 15. Endpoint Orang Tua Melihat Riwayat Kesehatan Anaknya di Mobile APK
export const getParentChildHealth = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const queryChildId = (req.query.childId || req.query.studentId || req.query.id) as string;

        let child = null;
        if (queryChildId) {
            child = await prisma.user.findFirst({
                where: {
                    id: queryChildId,
                    role: 'STUDENT'
                },
                select: {
                    id: true,
                    name: true,
                    username: true,
                    className: true,
                    gender: true,
                    bloodType: true,
                    allergies: true,
                    parentPhone: true,
                    latestHeightCm: true,
                    latestWeightKg: true,
                    latestBmi: true,
                    nutritionalStatus: true
                }
            });
        }

        if (!child) {
            child = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { parentPhone: user ? user.username : '' },
                        { fatherName: user ? user.name : '' },
                        { motherName: user ? user.name : '' }
                    ]
                },
                select: {
                    id: true,
                    name: true,
                    username: true,
                    className: true,
                    gender: true,
                    bloodType: true,
                    allergies: true,
                    parentPhone: true,
                    latestHeightCm: true,
                    latestWeightKg: true,
                    latestBmi: true,
                    nutritionalStatus: true
                }
            });
        }

        if (!child) {
            child = await prisma.user.findFirst({
                where: { role: 'STUDENT' },
                select: {
                    id: true,
                    name: true,
                    username: true,
                    className: true,
                    gender: true,
                    bloodType: true,
                    allergies: true,
                    parentPhone: true,
                    latestHeightCm: true,
                    latestWeightKg: true,
                    latestBmi: true,
                    nutritionalStatus: true
                }
            });
        }

        if (!child) {
            return res.status(404).json({ message: 'Data anak tidak ditemukan' });
        }

        const [visits, measurements, faintCount, totalSickDays, activeBed] = await Promise.all([
            prisma.uksVisit.findMany({
                where: { userId: child.id },
                orderBy: { checkInTime: 'desc' }
            }),
            prisma.studentHealthMeasurement.findMany({
                where: { studentId: child.id },
                orderBy: { createdAt: 'desc' },
                take: 10
            }),
            prisma.uksVisit.count({
                where: { userId: child.id, isFainting: true }
            }),
            prisma.attendance.count({
                where: { userId: child.id, status: 'SICK' }
            }),
            prisma.uksVisit.findFirst({
                where: {
                    userId: child.id,
                    disposition: 'REST_AT_UKS',
                    checkOutTime: null
                }
            })
        ]);

        res.json({
            success: true,
            student: {
                ...child,
                totalSickDays,
                faintCount,
                isRestingAtUks: !!activeBed,
                currentBedNumber: activeBed?.bedNumber || null
            },
            visits,
            measurements
        });
    } catch (error) {
        console.error('Error fetching parent child health history:', error);
        res.status(500).json({ message: 'Gagal memuat data kesehatan anak' });
    }
};

// 16. Input Pengukuran Antropometri Berkala (BB & TB Siswa)
export const recordHealthMeasurement = async (req: Request, res: Response) => {
    try {
        const { studentId, heightCm, weightKg, academicPeriod, notes } = req.body;
        const officer = (req as any).user;

        if (!studentId || !heightCm || !weightKg) {
            return res.status(400).json({ message: 'Siswa, Tinggi Badan (cm), dan Berat Badan (kg) wajib diisi' });
        }

        const h = parseFloat(heightCm);
        const w = parseFloat(weightKg);
        const heightM = h / 100;
        const bmi = Math.round((w / (heightM * heightM)) * 10) / 10;

        let status = 'NORMAL';
        if (bmi < 17.0) status = 'SANGAT_KURUS';
        else if (bmi < 18.5) status = 'KURUS';
        else if (bmi <= 25.0) status = 'NORMAL';
        else if (bmi <= 27.0) status = 'GEMUK';
        else status = 'OBESITAS';

        const measurement = await prisma.studentHealthMeasurement.create({
            data: {
                studentId,
                heightCm: h,
                weightKg: w,
                bmiValue: bmi,
                nutritionalStatus: status,
                academicPeriod: academicPeriod || 'Semester Berjalan',
                notes: notes || null,
                measuredBy: officer ? officer.name : 'Petugas UKS'
            }
        });

        // Update snapshot di user
        await prisma.user.update({
            where: { id: studentId },
            data: {
                latestHeightCm: h,
                latestWeightKg: w,
                latestBmi: bmi,
                nutritionalStatus: status
            }
        });

        res.json({
            success: true,
            message: `Pengukuran berhasil dicatat: TB ${h} cm, BB ${w} kg, IMT ${bmi} (${status})`,
            measurement
        });
    } catch (error) {
        console.error('Error recording health measurement:', error);
        res.status(500).json({ message: 'Gagal mencatat pengukuran kesehatan' });
    }
};

// 17. Ambil Riwayat Pengukuran BB/TB
export const getHealthMeasurements = async (req: Request, res: Response) => {
    try {
        const { studentId, className } = req.query;

        const whereClause: any = {};
        if (studentId) whereClause.studentId = String(studentId);
        if (className && className !== 'ALL') {
            whereClause.student = { className: String(className) };
        }

        const measurements = await prisma.studentHealthMeasurement.findMany({
            where: whereClause,
            include: {
                student: {
                    select: { id: true, name: true, username: true, className: true, gender: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            count: measurements.length,
            measurements
        });
    } catch (error) {
        console.error('Error fetching measurements:', error);
        res.status(500).json({ message: 'Gagal memuat riwayat pengukuran' });
    }
};

// 18. Radar Kesehatan Siswa untuk Portal BK (Sering Pingsan, Sakit Berulang, Masalah Gizi)
export const getBkHealthRadar = async (req: Request, res: Response) => {
    try {
        // Cari siswa dengan riwayat pingsan >= 1
        const faintRecords = await prisma.uksVisit.findMany({
            where: { isFainting: true },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        className: true,
                        parentPhone: true,
                        latestBmi: true,
                        nutritionalStatus: true
                    }
                }
            },
            orderBy: { checkInTime: 'desc' }
        });

        // Group by student
        const studentMap = new Map<string, any>();
        faintRecords.forEach(f => {
            if (!studentMap.has(f.userId)) {
                studentMap.set(f.userId, {
                    student: f.user,
                    faintCount: 0,
                    lastFaintDate: f.checkInTime,
                    lastLocation: f.incidentLocation,
                    lastComplaint: f.complaint
                });
            }
            const item = studentMap.get(f.userId);
            item.faintCount++;
        });

        const radarStudents = Array.from(studentMap.values()).sort((a, b) => b.faintCount - a.faintCount);

        res.json({
            success: true,
            totalCases: faintRecords.length,
            students: radarStudents
        });
    } catch (error) {
        console.error('Error fetching BK health radar:', error);
        res.status(500).json({ message: 'Gagal memuat radar kesehatan BK' });
    }
};

// 19. Manajemen Inventaris Obat & Alkes UKS
export const getMedicines = async (req: Request, res: Response) => {
    try {
        const { search } = req.query;
        const whereClause: any = {};
        if (search && typeof search === 'string') {
            whereClause.OR = [
                { name: { contains: search } },
                { type: { contains: search } }
            ];
        }

        const medicines = await prisma.medicine.findMany({
            where: whereClause,
            orderBy: { name: 'asc' }
        });

        // Tandai status kadaluarsa / stok menipis
        const now = new Date();
        const enriched = medicines.map(m => {
            const isLow = m.stock <= m.minStockAlert;
            const isExpiringSoon = m.expiryDate ? (new Date(m.expiryDate).getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000) : false;
            const isExpired = m.expiryDate ? (new Date(m.expiryDate).getTime() < now.getTime()) : false;
            return {
                ...m,
                isLowStock: isLow,
                isExpiringSoon,
                isExpired
            };
        });

        res.json({ success: true, count: enriched.length, medicines: enriched });
    } catch (error: any) {
        console.error('Error fetching medicines:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat daftar obat UKS' });
    }
};

export const createMedicine = async (req: Request, res: Response) => {
    try {
        const { name, type, dose, stock, unit, expiryDate, minStockAlert } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Nama obat wajib diisi' });
        }

        const med = await prisma.medicine.create({
            data: {
                name: name.trim(),
                type: type || 'TABLET',
                dose: dose ? dose.trim() : null,
                stock: stock ? parseInt(stock) : 0,
                unit: unit || 'tablet',
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                minStockAlert: minStockAlert ? parseInt(minStockAlert) : 10
            }
        });

        res.json({ success: true, message: 'Obat/Alkes berhasil ditambahkan ke inventaris UKS', medicine: med });
    } catch (error: any) {
        console.error('Error creating medicine:', error);
        res.status(500).json({ success: false, message: 'Gagal menambah obat: ' + error.message });
    }
};

export const updateMedicineStock = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const medicineId = Array.isArray(id) ? id[0] : id;
        const { stock, deltaStock, notes } = req.body;

        const existing = await prisma.medicine.findUnique({ where: { id: medicineId } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Obat tidak ditemukan' });
        }

        let newStock = existing.stock;
        if (stock !== undefined) {
            newStock = Math.max(0, parseInt(stock));
        } else if (deltaStock !== undefined) {
            newStock = Math.max(0, existing.stock + parseInt(deltaStock));
        }

        const updated = await prisma.medicine.update({
            where: { id: medicineId },
            data: { stock: newStock }
        });

        res.json({ success: true, message: 'Stok obat berhasil diperbarui', medicine: updated });
    } catch (error: any) {
        console.error('Error updating medicine stock:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui stok obat' });
    }
};

export const deleteMedicine = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const medicineId = Array.isArray(id) ? id[0] : id;
        await prisma.medicine.delete({ where: { id: medicineId } });
        res.json({ success: true, message: 'Obat/Alkes berhasil dihapus dari inventaris' });
    } catch (error: any) {
        console.error('Error deleting medicine:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus obat' });
    }
};

// 20. Scan QR Identitas Siswa untuk UKS (Gol Darah, Alergi, Riwayat Sakit Cepat)
export const scanStudentUksQr = async (req: Request, res: Response) => {
    try {
        const { qrPayload, nisnOrId } = req.body;
        let query = (qrPayload || nisnOrId || '').trim();

        if (!query) {
            return res.status(400).json({ success: false, message: 'Data QR atau NISN wajib disertakan' });
        }

        // Jika QR format STUDENT_MEMBER:id:nisn:name:class
        let studentId = '';
        let nisn = '';
        if (query.startsWith('STUDENT_MEMBER:')) {
            const parts = query.split(':');
            studentId = parts[1] || '';
            nisn = parts[2] || '';
        } else {
            studentId = query;
            nisn = query;
        }

        const student = await prisma.user.findFirst({
            where: {
                role: 'STUDENT',
                OR: [
                    { id: studentId },
                    { nisn: nisn },
                    { username: nisn }
                ]
            },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                className: true,
                gender: true,
                bloodType: true,
                allergies: true,
                parentPhone: true,
                fatherName: true,
                motherName: true,
                latestBmi: true,
                nutritionalStatus: true
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan untuk QR ini' });
        }

        // Ambil riwayat kunjungan terakhir
        const recentVisits = await prisma.uksVisit.findMany({
            where: { userId: student.id },
            orderBy: { checkInTime: 'desc' },
            take: 5
        });

        res.json({
            success: true,
            student,
            recentVisits,
            allergiesAlert: student.allergies ? `PERINGATAN ALERGI: ${student.allergies}` : null,
            bloodTypeBadge: student.bloodType || 'Belum Tercatat'
        });
    } catch (error: any) {
        console.error('Error in scanStudentUksQr:', error);
        res.status(500).json({ success: false, message: 'Gagal memindai QR siswa untuk UKS' });
    }
};

// 21. Kategori & Skor Pelanggaran Disiplin Standar BK
export const getDisciplineCategories = async (req: Request, res: Response) => {
    try {
        const categories = await prisma.disciplineCategory.findMany({
            orderBy: [{ category: 'asc' }, { points: 'asc' }]
        });
        res.json({ success: true, categories });
    } catch (error: any) {
        console.error('Error fetching discipline categories:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat kategori disiplin' });
    }
};

export const createDisciplineCategory = async (req: Request, res: Response) => {
    try {
        const { name, points, category } = req.body;
        if (!name || points === undefined) {
            return res.status(400).json({ success: false, message: 'Nama pelanggaran dan poin wajib diisi' });
        }

        const item = await prisma.disciplineCategory.create({
            data: {
                name: name.trim(),
                points: parseInt(points),
                category: category || 'RINGAN'
            }
        });

        res.json({ success: true, message: 'Kategori pelanggaran berhasil ditambahkan', category: item });
    } catch (error: any) {
        console.error('Error creating discipline category:', error);
        res.status(500).json({ success: false, message: 'Gagal menambah kategori disiplin: ' + error.message });
    }
};

// 22. Surat Peringatan (SP 1, SP 2, SP 3) Otomatis Berdasarkan Akumulasi Poin
export const getWarningLetters = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { className, spLevel, studentId, userId, childId } = req.query;
        const whereClause: any = {};

        let targetStudentId: string | null = (studentId || userId || childId) ? String(studentId || userId || childId) : null;
        if (user && user.role === 'STUDENT') {
            targetStudentId = user.id;
        } else if (user && user.role === 'PARENT' && !targetStudentId) {
            const cleanNisn = (user.username || '').replace(/^[Pp]/, '').trim();
            const child = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { nisn: cleanNisn },
                        { username: cleanNisn },
                        ...(user.nisn ? [{ nisn: user.nisn }] : []),
                        { parentPhone: user.username }
                    ]
                },
                select: { id: true }
            });
            if (child) targetStudentId = child.id;
        }

        if (targetStudentId && targetStudentId !== 'ALL') {
            whereClause.userId = targetStudentId;
        }
        if (spLevel && spLevel !== 'ALL') {
            whereClause.spLevel = String(spLevel);
        }
        if (className && className !== 'ALL') {
            whereClause.user = { className: String(className) };
        }

        const letters = await prisma.disciplineWarningLetter.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        nisn: true,
                        className: true,
                        points: true,
                        parentPhone: true,
                        fatherName: true,
                        motherName: true
                    }
                }
            },
            orderBy: { issuedAt: 'desc' }
        });

        res.json({ success: true, count: letters.length, letters });
    } catch (error: any) {
        console.error('Error fetching warning letters:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat daftar Surat Peringatan' });
    }
};

export const issueWarningLetter = async (req: Request, res: Response) => {
    try {
        const { userId, spLevel, customNotes } = req.body;
        if (!userId || !spLevel) {
            return res.status(400).json({ success: false, message: 'Siswa dan Level SP (SP1, SP2, SP3) wajib diisi' });
        }

        const student = await prisma.user.findUnique({ where: { id: userId } });
        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
        const curDate = new Date();
        const curMonth = romanMonths[curDate.getMonth()];
        const curYear = curDate.getFullYear();
        const randNum = Math.floor(100 + Math.random() * 900);
        const letterNo = `421.3/${spLevel}-BK/${randNum}/${curMonth}/${curYear}`;

        const letter = await prisma.disciplineWarningLetter.create({
            data: {
                userId,
                spLevel,
                totalPoints: student.points || 0,
                letterNo
            },
            include: { user: true }
        });

        // Buat pesan notifikasi resmi ke Orang Tua & Siswa
        await prisma.notificationMessage.create({
            data: {
                recipientId: student.id,
                recipientPhone: student.parentPhone || null,
                recipientRole: 'PARENT',
                studentId: student.id,
                studentName: student.name,
                className: student.className,
                title: `SURAT PERINGATAN (${spLevel}) - ${student.name}`,
                message: `Diberitahukan kepada Bapak/Ibu Wali dari ${student.name} (${student.className}), telah diterbitkan Surat Peringatan ${spLevel} (No: ${letterNo}) dengan akumulasi ${student.points} poin pelanggaran. Mohon kehadirannya ke ruang BK.`,
                category: 'DISCIPLINE'
            }
        });

        res.json({ success: true, message: `Surat Peringatan ${spLevel} berhasil diterbitkan dengan nomor ${letterNo}`, letter });
    } catch (error: any) {
        console.error('Error issuing warning letter:', error);
        res.status(500).json({ success: false, message: 'Gagal menerbitkan Surat Peringatan: ' + error.message });
    }
};

// 22.A Hapus Surat Peringatan (SP 1, SP 2, SP 3)
export const deleteWarningLetter = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const letter = await (prisma as any).disciplineWarningLetter.findUnique({
            where: { id },
            include: { user: true }
        });

        if (!letter) {
            return res.status(404).json({ success: false, message: 'Surat Peringatan (SP) tidak ditemukan' });
        }

        // Kembalikan status sanksi pada catatan kedisiplinan siswa terkait menjadi RESOLVED
        await (prisma as any).disciplineRecord.updateMany({
            where: {
                userId: letter.userId,
                sanctionLevel: { in: [letter.spLevel, letter.spLevel.replace('SP', 'SP_'), 'SP_1', 'SP_2', 'SP_3'] }
            },
            data: {
                sanctionLevel: 'RESOLVED'
            }
        });

        await (prisma as any).disciplineWarningLetter.delete({ where: { id } });

        res.json({
            success: true,
            message: `✅ Surat Peringatan ${letter.spLevel} (${letter.letterNo}) atas nama ${letter.user?.name || 'siswa'} berhasil dihapus / dibatalkan!`
        });
    } catch (error: any) {
        console.error('Error in deleteWarningLetter:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus Surat Peringatan: ' + error.message });
    }
};

// 22.B Batalkan / Hapus Seluruh SP Siswa Tertentu
export const cancelStudentSP = async (req: Request, res: Response) => {
    try {
        const userId = String(req.params.userId);
        const { spLevel } = req.body || {};

        const whereClause: any = { userId };
        if (spLevel && spLevel !== 'ALL') {
            whereClause.spLevel = spLevel;
        }

        const deleted = await (prisma as any).disciplineWarningLetter.deleteMany({ where: whereClause });

        await (prisma as any).disciplineRecord.updateMany({
            where: {
                userId,
                sanctionLevel: { startsWith: 'SP' }
            },
            data: { sanctionLevel: 'RESOLVED' }
        });

        res.json({
            success: true,
            message: `✅ Berhasil menghapus ${deleted.count} Surat Peringatan (SP) untuk siswa tersebut!`
        });
    } catch (error: any) {
        console.error('Error in cancelStudentSP:', error);
        res.status(500).json({ success: false, message: 'Gagal membatalkan SP siswa: ' + error.message });
    }
};

// 23. Early Warning Ranking Poin Siswa (Deteksi Cepat Potensi SP1/SP2/SP3)
export const getDisciplineEarlyWarning = async (req: Request, res: Response) => {
    try {
        const students = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                points: { gt: 0 }
            },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                className: true,
                points: true,
                parentPhone: true,
                warningLetters: {
                    select: { spLevel: true, letterNo: true, issuedAt: true }
                }
            },
            orderBy: { points: 'desc' }
        });

        const classified = students.map(s => {
            let suggestedSp = 'Pembinaan Dini (Waspada)';
            let alertColor = 'blue';
            if (s.points >= 50) {
                suggestedSp = 'SP3 (Skorsing / Panggilan Akhir)';
                alertColor = 'red';
            } else if (s.points >= 30) {
                suggestedSp = 'SP2 (Panggilan Orang Tua)';
                alertColor = 'orange';
            } else if (s.points >= 15) {
                suggestedSp = 'SP1 (Peringatan Tertulis I)';
                alertColor = 'yellow';
            }

            return {
                ...s,
                suggestedSp,
                alertColor,
                hasIssuedLetter: s.warningLetters && s.warningLetters.length > 0
            };
        });

        res.json({ success: true, count: classified.length, students: classified });
    } catch (error: any) {
        console.error('Error in getDisciplineEarlyWarning:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat early warning ranking BK' });
    }
};

// 18. Endpoint Rekap Kelas Asuh BK (Daftar Siswa, Kehadiran, Poin Pelanggaran, Status SP)
export const getBkClassRecap = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const requestedClass = req.query.className as string;

        // Ambil kelas yang diampu guru BK ini
        const teacher = await prisma.user.findUnique({
            where: { id: user.id },
            select: { teachingClasses: true, role: true, className: true }
        });

        // 1. Ambil kelas yang diampu guru BK ini dari BkKelasPlot dan User teachingClasses / className
        const plots = await (prisma as any).bkKelasPlot.findMany({
            where: { guruBkId: user.id, isActive: true },
            include: { kelas: true },
            orderBy: { kelas: { name: 'asc' } }
        });
        const plotClassNames = plots.map((p: any) => p.kelas?.name).filter(Boolean);

        let allowedClasses: string[] = [];
        if (plotClassNames.length > 0) {
            allowedClasses = plotClassNames;
        } else if (teacher?.teachingClasses) {
            try {
                if (teacher.teachingClasses.startsWith('[')) {
                    allowedClasses = JSON.parse(teacher.teachingClasses);
                } else {
                    allowedClasses = teacher.teachingClasses.split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
                }
            } catch {
                allowedClasses = teacher.teachingClasses.split(',').map((s: string) => s.trim().replace(/^["'\[\]]|["'\[\]]$/g, '')).filter(Boolean);
            }
        }

        if (allowedClasses.length === 0 && teacher?.className) {
            allowedClasses = [teacher.className];
        }

        // HANYA Admin / Operator yang default ke semua kelas jika belum diplot
        if (allowedClasses.length === 0 && (user.role === 'ADMIN' || user.role === 'OPERATOR')) {
            const allClasses = await prisma.class.findMany({ orderBy: { name: 'asc' } });
            allowedClasses = allClasses.map(c => c.name);
        }

        // Kelompokkan kelas berdasarkan Tingkat (VII, VIII, IX)
        const tingkatGroups: { [key: string]: string[] } = {};
        allowedClasses.forEach(c => {
            const m = c.match(/^(VII|VIII|IX|X|XI|XII|7|8|9|10|11|12)/i);
            const tingkat = m ? (m[1].toUpperCase().startsWith('7') ? 'Kelas VII' : m[1].toUpperCase().startsWith('8') ? 'Kelas VIII' : m[1].toUpperCase().startsWith('9') ? 'Kelas IX' : `Kelas ${m[1].toUpperCase()}`) : 'Kelas Lainnya';
            if (!tingkatGroups[tingkat]) tingkatGroups[tingkat] = [];
            tingkatGroups[tingkat].push(c);
        });
        const tingkats = Object.keys(tingkatGroups);

        // Tentukan target kelas
        let targetClass = requestedClass;
        if (!targetClass && allowedClasses.length > 0) {
            targetClass = allowedClasses[0];
        }

        // Ambil daftar siswa di kelas tersebut
        const whereStudent: any = { role: 'STUDENT', isActive: true };
        if (targetClass && targetClass !== 'ALL') {
            whereStudent.className = targetClass;
        } else if (allowedClasses.length > 0) {
            whereStudent.className = { in: allowedClasses };
        }

        const students = await prisma.user.findMany({
            where: whereStudent,
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                className: true,
                gender: true,
                points: true,
                parentPhone: true,
                attendances: {
                    select: {
                        type: true,
                        status: true,
                        scanTime: true,
                        note: true
                    },
                    orderBy: { scanTime: 'desc' }
                },
                disciplineRecords: {
                    select: {
                        id: true,
                        type: true,
                        description: true,
                        points: true,
                        createdAt: true
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5
                },
                warningLetters: {
                    select: {
                        id: true,
                        spLevel: true,
                        issuedAt: true,
                        letterNo: true
                    },
                    orderBy: { issuedAt: 'desc' }
                }
            },
            orderBy: [{ className: 'asc' }, { name: 'asc' }]
        });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        // Hitung statistik per siswa & status presensi hari ini
        const recap = (students as any[]).map(s => {
            const atts: any[] = s.attendances || [];
            const gateIns = atts.filter(a => a.type === 'GATE_IN');
            const totalHadir = gateIns.filter(a => a.status === 'PRESENT').length;
            const totalTerlambat = gateIns.filter(a => a.status === 'LATE').length;
            const totalSakit = atts.filter(a => a.status === 'SICK').length;
            const totalIzin = atts.filter(a => a.status === 'PERMIT').length;
            const totalAlpa = atts.filter(a => a.status === 'ABSENT').length;
            const spLevel = s.warningLetters && s.warningLetters.length > 0 ? s.warningLetters[0].spLevel : (s.points >= 50 ? 'SP-3' : s.points >= 30 ? 'SP-2' : s.points >= 15 ? 'SP-1' : 'Aman');

            // Cek presensi hari ini (Gate In & Gate Out)
            const todayAtts = atts.filter(a => {
                const t = new Date(a.scanTime);
                return t >= todayStart && t <= todayEnd;
            });
            const todayGateIn = todayAtts.find(a => a.type === 'GATE_IN');
            const todayGateOut = todayAtts.find(a => a.type === 'GATE_OUT');

            return {
                id: s.id,
                name: s.name,
                username: s.username,
                nisn: s.nisn || '-',
                className: s.className || '-',
                gender: s.gender || '-',
                points: s.points || 0,
                parentPhone: s.parentPhone || '-',
                spLevel,
                todayGateIn: todayGateIn ? {
                    time: new Date(todayGateIn.scanTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
                    status: todayGateIn.status,
                    note: todayGateIn.note
                } : null,
                todayGateOut: todayGateOut ? {
                    time: new Date(todayGateOut.scanTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
                    status: todayGateOut.status,
                    note: todayGateOut.note
                } : null,
                canAbsenMasuk: !todayGateIn,
                canAbsenPulang: !todayGateOut,
                stats: {
                    hadir: totalHadir,
                    terlambat: totalTerlambat,
                    sakit: totalSakit,
                    izin: totalIzin,
                    alpa: totalAlpa
                },
                recentViolations: s.disciplineRecords || []
            };
        });

        res.json({
            success: true,
            allowedClasses,
            tingkats,
            tingkatGroups,
            selectedClass: targetClass || 'ALL',
            totalStudents: recap.length,
            students: recap
        });
    } catch (error) {
        console.error('Error fetching BK class recap:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat rekap kelas BK' });
    }
};

// 19. Endpoint Aktivitas Keterlambatan & Izin Pulang BK Hari Ini
export const getBkTodayActivity = async (req: Request, res: Response) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        // Keterlambatan hari ini di BK
        const lateArrivals = await prisma.attendance.findMany({
            where: {
                type: 'GATE_IN',
                status: 'LATE',
                scanTime: { gte: todayStart, lte: todayEnd }
            },
            include: {
                user: {
                    select: { id: true, name: true, className: true, nisn: true, parentPhone: true }
                }
            },
            orderBy: { scanTime: 'desc' }
        });

        // Izin pulang cepat hari ini di BK
        const earlyLeaves = await prisma.attendance.findMany({
            where: {
                type: 'GATE_OUT',
                status: 'EARLY_LEAVE',
                scanTime: { gte: todayStart, lte: todayEnd }
            },
            include: {
                user: {
                    select: { id: true, name: true, className: true, nisn: true, parentPhone: true }
                }
            },
            orderBy: { scanTime: 'desc' }
        });

        res.json({
            success: true,
            lateArrivals: lateArrivals.map(a => ({
                id: a.id,
                studentId: a.user?.id,
                studentName: a.user?.name,
                className: a.user?.className,
                nisn: a.user?.nisn,
                scanTime: a.scanTime,
                note: a.note
            })),
            earlyLeaves: earlyLeaves.map(a => ({
                id: a.id,
                studentId: a.user?.id,
                studentName: a.user?.name,
                className: a.user?.className,
                nisn: a.user?.nisn,
                scanTime: a.scanTime,
                note: a.note
            }))
        });
    } catch (error) {
        console.error('Error fetching today BK activity:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat aktivitas BK hari ini' });
    }
};

// 26. Ambil Daftar Guru BK beserta Pembagian Kelas & Seluruh Guru Sekolah untuk Fitur Tagging
export const getBkCounselors = async (req: Request, res: Response) => {
    try {
        // Ambil seluruh guru dan counselor aktif dari tabel User
        const allTeachers = await prisma.user.findMany({
            where: { role: { in: ['TEACHER', 'COUNSELOR'] }, isActive: true },
            select: {
                id: true,
                name: true,
                username: true,
                role: true,
                isBk: true,
                tugasTambahan: true,
                profilePicUrl: true,
                teachingClasses: true,
                teachingSubject: true
            },
            orderBy: { name: 'asc' }
        });

        const allClasses = await prisma.class.findMany({
            orderBy: { name: 'asc' }
        });

        // Hitung jumlah siswa per kelas
        const studentCounts = await prisma.user.groupBy({
            by: ['className'],
            where: { role: 'STUDENT', isActive: true },
            _count: { id: true }
        });
        const countMap = new Map<string, number>();
        studentCounts.forEach(sc => {
            if (sc.className) countMap.set(sc.className, sc._count.id);
        });

        // Guru BK adalah yang memiliki role COUNSELOR, isBk: true, tugasTambahan BK, atau yang sudah di-assign kelas bimbingan
        const counselorTeachers = allTeachers.filter(t => 
            t.role === 'COUNSELOR' || 
            (t as any).isBk === true ||
            ((t as any).tugasTambahan && (t as any).tugasTambahan.toUpperCase().includes('BK')) ||
            allClasses.some(cls => cls.counselorId === t.id || cls.counselorName === t.name)
        );

        const result = counselorTeachers.map(c => {
            const assigned = allClasses.filter(cls => cls.counselorId === c.id || cls.counselorName === c.name);
            const assignedNames = assigned.map(cls => cls.name);
            const totalStudents = assignedNames.reduce((acc, name) => acc + (countMap.get(name) || 0), 0);

            return {
                id: c.id,
                name: c.name,
                username: c.username,
                nip: c.username,
                role: c.role,
                profilePicUrl: c.profilePicUrl,
                teachingSubject: c.teachingSubject || 'Bimbingan Konseling (BK)',
                teachingClasses: c.teachingClasses || null,
                assignedClasses: assignedNames,
                totalClasses: assignedNames.length,
                totalStudents
            };
        });

        // Seluruh guru untuk modal penandaan (tagging) Guru BK
        const availableTeachers = allTeachers.map(t => ({
            id: t.id,
            name: t.name,
            nip: t.username,
            username: t.username,
            role: t.role,
            isBk: t.role === 'COUNSELOR' || (t as any).isBk === true || ((t as any).tugasTambahan && (t as any).tugasTambahan.toUpperCase().includes('BK')) || counselorTeachers.some(c => c.id === t.id),
            teachingSubject: t.teachingSubject || '-'
        }));

        res.json({
            success: true,
            counselors: result,
            availableTeachers,
            allClasses: allClasses.map(cls => ({
                id: cls.id,
                name: cls.name,
                counselorId: cls.counselorId,
                counselorName: cls.counselorName,
                isGpsLocked: cls.isGpsLocked,
                radiusMeters: cls.radiusMeters
            }))
        });
    } catch (error) {
        console.error('Error fetching BK counselors:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data Guru BK' });
    }
};

// 26.B Tag / Tetapkan Guru sebagai Guru BK dari Tabel Guru
export const tagTeacherAsBk = async (req: Request, res: Response) => {
    try {
        const { teacherId, isBk } = req.body;
        if (!teacherId) {
            return res.status(400).json({ success: false, message: 'ID Guru wajib disertakan' });
        }

        const teacher = await prisma.user.findUnique({ where: { id: teacherId } });
        if (!teacher) {
            return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan di sistem' });
        }

        if (isBk) {
            await prisma.user.update({
                where: { id: teacherId },
                data: { role: 'COUNSELOR' }
            });
            await logAudit(req, 'TAG_TEACHER_AS_BK', `Teacher: ${teacher.name} (${teacher.username}) tagged as COUNSELOR`, { teacherId });
            return res.json({
                success: true,
                message: `✅ Berhasil menetapkan ${teacher.name} sebagai Guru BK.`
            });
        } else {
            await prisma.user.update({
                where: { id: teacherId },
                data: { role: 'TEACHER' }
            });
            // Lepas kelas jika ada
            await prisma.class.updateMany({
                where: { counselorId: teacherId },
                data: { counselorId: null, counselorName: null }
            });
            await prisma.user.updateMany({
                where: { counselorTeacher: teacher.name },
                data: { counselorTeacher: null }
            });
            await logAudit(req, 'UNTAG_TEACHER_AS_BK', `Teacher: ${teacher.name} untagged from COUNSELOR`, { teacherId });
            return res.json({
                success: true,
                message: `✅ Status Guru BK untuk ${teacher.name} berhasil dinonaktifkan.`
            });
        }
    } catch (error) {
        console.error('Error tagging teacher as BK:', error);
        res.status(500).json({ success: false, message: 'Gagal mengubah status Guru BK' });
    }
};

// 27. Atur Kelas Guru BK (Massal / Multi-Kelas)
export const assignCounselorClasses = async (req: Request, res: Response) => {
    try {
        const { counselorId, classNames } = req.body;
        if (!counselorId) {
            return res.status(400).json({ success: false, message: 'ID Guru BK wajib diisi' });
        }

        const counselor = await prisma.user.findFirst({
            where: { id: String(counselorId), role: { in: ['COUNSELOR', 'TEACHER'] } }
        });
        if (!counselor) {
            return res.status(404).json({ success: false, message: 'Data Guru BK tidak ditemukan' });
        }

        const targetClassNames: string[] = Array.isArray(classNames) ? classNames : [];

        // 1. Lepas kelas lama yang sebelumnya dibina oleh counselor ini tapi tidak ada di targetClassNames
        await prisma.class.updateMany({
            where: {
                counselorId: counselor.id,
                name: { notIn: targetClassNames }
            },
            data: {
                counselorId: null,
                counselorName: null
            }
        });

        // Lepas juga counselorTeacher pada siswa di kelas yang dilepas
        await prisma.user.updateMany({
            where: {
                role: 'STUDENT',
                className: { notIn: targetClassNames },
                counselorTeacher: counselor.name
            },
            data: {
                counselorTeacher: null
            }
        });

        // 2. Pasang counselor ke targetClassNames
        if (targetClassNames.length > 0) {
            await prisma.class.updateMany({
                where: { name: { in: targetClassNames } },
                data: {
                    counselorId: counselor.id,
                    counselorName: counselor.name
                }
            });

            // Sinkronkan ke siswa
            await prisma.user.updateMany({
                where: {
                    role: 'STUDENT',
                    className: { in: targetClassNames }
                },
                data: {
                    counselorTeacher: counselor.name
                }
            });
        }

        // 3. Pastikan user role menjadi COUNSELOR dan update field teachingClasses
        await prisma.user.update({
            where: { id: counselor.id },
            data: {
                role: 'COUNSELOR',
                teachingClasses: JSON.stringify(targetClassNames)
            }
        });

        res.json({
            success: true,
            message: `✅ Berhasil mengatur ${targetClassNames.length} kelas untuk ${counselor.name}!`,
            counselor: {
                id: counselor.id,
                name: counselor.name,
                assignedClasses: targetClassNames
            }
        });
    } catch (error) {
        console.error('Error assigning counselor classes:', error);
        res.status(500).json({ success: false, message: 'Gagal mengatur kelas Guru BK' });
    }
};



