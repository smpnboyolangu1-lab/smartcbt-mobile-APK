import { Request, Response } from 'express';
import prisma from '../utils/db';

// 1. Presensi Manual Siswa Tanpa HP oleh Guru BK
export const submitBkManualAttendance = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, type, status, reasonNoPhone, notes, lateMinutes } = req.body;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Siswa wajib dipilih.' });
        }

        const student = await prisma.user.findUnique({ where: { id: studentId } });
        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
        }

        const attType = (type || 'GATE_IN').toUpperCase();
        const attStatus = (status || 'PRESENT').toUpperCase();

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const existingAtt = await prisma.attendance.findFirst({
            where: {
                userId: student.id,
                type: attType,
                scanTime: { gte: todayStart, lte: todayEnd }
            }
        });

        if (existingAtt) {
            const timeStr = new Date(existingAtt.scanTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            return res.status(400).json({
                success: false,
                message: `⚠️ Siswa ${student.name} sudah tercatat ${attType === 'GATE_IN' ? 'Masuk' : 'Pulang'} hari ini pada pukul ${timeStr} WIB (${existingAtt.method || 'QR'}). Presensi tidak dapat diduplikasi.`
            });
        }

        let scanTime = new Date();
        if (req.body.clockTime) {
            const parts = String(req.body.clockTime).split(':');
            const h = parseInt(parts[0]);
            const m = parseInt(parts[1] || '0');
            if (!isNaN(h) && !isNaN(m)) {
                scanTime.setHours(h, m, 0, 0);
            }
        }
        let finalStatus = attStatus;
        if (attType === 'GATE_IN' && finalStatus === 'PRESENT') {
            const h = scanTime.getHours();
            const m = scanTime.getMinutes();
            if (h > 7 || (h === 7 && m > 0)) {
                finalStatus = 'LATE';
            }
        }

        const noteDetail = `[Manual BK: ${user.name}] Alasan: ${reasonNoPhone || 'Presensi Verifikasi Guru BK'}. Jam: ${scanTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB. ${notes || ''}`.trim();

        const attendance = await prisma.attendance.create({
            data: {
                userId: student.id,
                type: attType,
                method: 'MANUAL_BK',
                status: finalStatus,
                scanTime: scanTime,
                note: noteDetail
            }
        });

        // Kirim notifikasi realtime ke akun Orang Tua
        try {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className,
                    title: `📱 Presensi Khusus (Tanpa HP): ${student.name}`,
                    message: `Ananda ${student.name} telah dicatat kehadirannya secara resmi oleh Guru BK (${user.name}) dengan keterangan: ${reasonNoPhone || 'Tidak membawa HP'}. Status: ${attStatus === 'PRESENT' ? 'Hadir' : attStatus}.`,
                    category: 'ATTENDANCE'
                }
            });
        } catch (nErr) {}

        res.json({
            success: true,
            message: `Presensi manual ananda ${student.name} berhasil dicatat oleh Guru BK.`,
            attendance
        });
    } catch (error: any) {
        console.error('Error submitBkManualAttendance:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat presensi manual: ' + error.message });
    }
};

// 2. Riwayat Presensi Manual Guru BK Hari Ini
export const getBkManualTodayLog = async (req: Request, res: Response) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const logs = await prisma.attendance.findMany({
            where: {
                method: 'MANUAL_BK',
                scanTime: { gte: todayStart }
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        nisn: true,
                        className: true,
                        profilePicUrl: true
                    }
                }
            },
            orderBy: { scanTime: 'desc' }
        });

        res.json({ success: true, count: logs.length, logs });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat log presensi BK: ' + error.message });
    }
};

// 3. Daftar Permohonan Izin Siswa (dari Orang Tua) yang Menunggu Verifikasi BK
export const getPendingStudentLeavesForBk = async (req: Request, res: Response) => {
    try {
        const { className, status } = req.query;
        const whereClause: any = {};

        if (status && status !== 'ALL') {
            whereClause.status = String(status).toUpperCase();
        } else if (!status) {
            whereClause.status = 'PENDING';
        }

        if (className && className !== 'ALL') {
            whereClause.className = String(className).trim();
        }

        const leaves = await (prisma as any).studentLeaveRequest.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' }
        });

        // Juga sertakan pengajuan izin darurat/dispensasi siswa di sekolah (StudentLeave / Gatepass)
        const inSchoolLeaves = await (prisma as any).studentLeave.findMany({
            where: {
                ...(className && className !== 'ALL' ? { student: { className: String(className).trim() } } : {})
            },
            include: {
                student: {
                    select: { id: true, name: true, className: true, nisn: true, profilePicUrl: true }
                }
            },
            orderBy: { appliedAt: 'desc' },
            take: 50
        });

        const mappedInSchool = inSchoolLeaves.map((l: any) => ({
            id: l.id,
            studentId: l.studentId,
            studentName: l.student?.name || 'Siswa',
            className: l.student?.className || '-',
            category: l.leaveType === 'SAKIT_PULANG' ? 'SAKIT (DI SEKOLAH)' : l.leaveType === 'DISPENSASI_LOMBA' ? 'DISPENSASI LOMBA' : 'IZIN PULANG MENDESAK',
            reason: l.eventName ? `${l.reason} [Acara: ${l.eventName}] (Penjemput: ${l.pickupPerson || 'Mandiri'})` : `${l.reason} (Penjemput: ${l.pickupPerson || 'Mandiri'})`,
            startDate: l.appliedAt,
            endDate: l.appliedAt,
            attachmentUrl: null,
            status: l.status === 'submitted' ? 'PENDING' : l.status === 'approved_by_bk' ? 'APPROVED' : l.status.toUpperCase(),
            verifiedBy: l.counselorNotes || null,
            verifiedAt: l.approvedAt || null,
            createdAt: l.appliedAt
        })).filter((l: any) => {
            if (status && status !== 'ALL') {
                return l.status === String(status).toUpperCase();
            }
            return l.status === 'PENDING';
        });

        const allCombinedLeaves = [...mappedInSchool, ...leaves];

        const pendingParentCount = await (prisma as any).studentLeaveRequest.count({
            where: { status: 'PENDING' }
        });
        const pendingSchoolCount = await (prisma as any).studentLeave.count({
            where: { status: 'submitted' }
        });

        res.json({
            success: true,
            pendingCount: pendingParentCount + pendingSchoolCount,
            leaves: allCombinedLeaves
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat izin siswa: ' + error.message });
    }
};

// 4. Rekap Presensi 360 Derajat untuk Halaman BK & Portal (Gerbang, Mapel, & Sholat)
export const getBkUnifiedAttendanceRecap = async (req: Request, res: Response) => {
    try {
        const { className, date } = req.query;
        const targetDateStr = String(date || new Date().toISOString().substring(0, 10));

        const startOfDay = new Date(`${targetDateStr}T00:00:00.000Z`);
        const endOfDay = new Date(`${targetDateStr}T23:59:59.999Z`);

        let studentFilter: any = { role: 'STUDENT' };
        if (className && className !== 'ALL') {
            studentFilter.className = String(className).trim();
        }

        const students = await prisma.user.findMany({
            where: studentFilter,
            select: {
                id: true,
                name: true,
                nisn: true,
                gender: true,
                className: true,
                profilePicUrl: true
            },
            orderBy: [{ className: 'asc' }, { name: 'asc' }]
        });

        const studentIds = students.map(s => s.id);

        // 1. Data Presensi Gerbang (Gate In / Gate Out)
        const gateAttendances = await prisma.attendance.findMany({
            where: {
                userId: { in: studentIds },
                scanTime: { gte: startOfDay, lte: endOfDay }
            },
            orderBy: { scanTime: 'asc' }
        });

        // 2. Data Presensi Jam Pelajaran (Mapel)
        const mapelAttendances = await (prisma as any).classPeriodAttendance.findMany({
            where: {
                studentId: { in: studentIds },
                createdAt: { gte: startOfDay, lte: endOfDay }
            },
            include: {
                session: {
                    select: { subjectName: true, periodIndex: true, timeRange: true }
                }
            }
        });

        // 3. Data Presensi Sholat Berjamaah & Keputrian
        const prayerAttendances = await (prisma as any).studentPrayerAttendance.findMany({
            where: {
                studentId: { in: studentIds },
                date: targetDateStr
            }
        });

        const gateMap = new Map<string, any[]>();
        gateAttendances.forEach(g => {
            const list = gateMap.get(g.userId) || [];
            list.push(g);
            gateMap.set(g.userId, list);
        });

        const mapelMap = new Map<string, any[]>();
        mapelAttendances.forEach((m: any) => {
            const list = mapelMap.get(m.studentId) || [];
            list.push(m);
            mapelMap.set(m.studentId, list);
        });

        const prayerMap = new Map<string, any>();
        prayerAttendances.forEach((p: any) => prayerMap.set(p.studentId, p));

        let totalHadirGerbang = 0;
        let totalTerlambatGerbang = 0;
        let totalSakitIzin = 0;
        let totalAlpa = 0;

        let totalSholat = 0;
        let totalHaid = 0;
        let totalBelumSholat = 0;

        const unifiedList = students.map(s => {
            const gates = gateMap.get(s.id) || [];
            const gateIn = gates.find(g => g.type === 'GATE_IN');
            const gateOut = gates.find(g => g.type === 'GATE_OUT');

            let gateStatus = 'BELUM_MASUK';
            if (gateIn) {
                gateStatus = gateIn.status;
                if (gateIn.status === 'PRESENT') totalHadirGerbang++;
                else if (gateIn.status === 'LATE') totalTerlambatGerbang++;
                else if (gateIn.status === 'SICK' || gateIn.status === 'PERMISSION') totalSakitIzin++;
            } else {
                totalAlpa++;
            }

            const mapels = mapelMap.get(s.id) || [];
            const prayer = prayerMap.get(s.id);
            const prayerStatus = prayer ? prayer.status : 'BELUM_PRESENSI';

            if (prayerStatus === 'SHOLAT_BERJAMAAH') totalSholat++;
            else if (prayerStatus === 'BERHALANGAN_HAID') totalHaid++;
            else totalBelumSholat++;

            return {
                id: s.id,
                name: s.name,
                nisn: s.nisn,
                gender: (s.gender || 'L').toUpperCase(),
                className: s.className,
                profilePicUrl: s.profilePicUrl,
                // Pilar 1: Gerbang
                gateStatus,
                gateInTime: gateIn?.scanTime || null,
                gateOutTime: gateOut?.scanTime || null,
                gateMethod: gateIn?.method || null,
                // Pilar 2: Mapel
                mapelCount: mapels.length,
                mapels: mapels.map((m: any) => ({
                    subject: m.session?.subjectName || 'Mapel',
                    period: m.session?.periodIndex || 1,
                    status: m.status
                })),
                // Pilar 3: Sholat
                prayerType: prayer?.prayerType || (new Date().getDay() === 5 ? 'JUMAT' : 'DHUHUR'),
                prayerStatus,
                prayerRecordedAt: prayer?.createdAt || null,
                prayerMethod: prayer?.method || null
            };
        });

        res.json({
            success: true,
            date: targetDateStr,
            className: className || 'ALL',
            summary: {
                totalStudents: students.length,
                gate: {
                    hadir: totalHadirGerbang,
                    terlambat: totalTerlambatGerbang,
                    sakitIzin: totalSakitIzin,
                    belumMasuk: totalAlpa
                },
                sholat: {
                    sholatBerjamaah: totalSholat,
                    berhalanganHaid: totalHaid,
                    belumSholat: totalBelumSholat
                }
            },
            students: unifiedList
        });
    } catch (error: any) {
        console.error('Error getBkUnifiedAttendanceRecap:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat rekap presensi BK: ' + error.message });
    }
};

// 5. Input Cepat Izin Siswa oleh Guru BK (Izin Sakit & Izin Keperluan Keluarga)
export const submitBkQuickStudentLeave = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, leaveType, startDate, endDate, reason, doctorNoteUrl } = req.body;

        if (!studentId || !leaveType) {
            return res.status(400).json({ success: false, message: 'Siswa dan jenis izin wajib dipilih.' });
        }

        const student = await prisma.user.findFirst({
            where: {
                OR: [
                    { id: studentId },
                    { nisn: studentId },
                    { nis: studentId },
                    { username: studentId }
                ]
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        const isSakit = String(leaveType).toUpperCase().includes('SAKIT') || String(leaveType).toUpperCase() === 'SICK';
        const finalCategory = isSakit ? 'SAKIT' : 'KEPERLUAN_KELUARGA';
        const attStatus = isSakit ? 'SICK' : 'PERMISSION';

        const todayStr = new Date().toISOString().substring(0, 10);
        const effectiveStart = startDate || todayStr;
        const effectiveEnd = endDate || effectiveStart;

        // Catat di tabel StudentLeave
        const leaveRecord = await (prisma as any).studentLeave.create({
            data: {
                studentId: student.id,
                counselorId: user?.id || null,
                leaveCategory: finalCategory,
                reason: reason || (isSakit ? 'Izin Sakit (Dicatat Guru BK)' : 'Izin Keperluan Keluarga (Dicatat Guru BK)'),
                startDate: new Date(effectiveStart + 'T00:00:00+07:00'),
                endDate: new Date(effectiveEnd + 'T23:59:59+07:00'),
                status: 'APPROVED',
                approvedBy: user?.name || 'Guru BK',
                approvedAt: new Date(),
                attachmentUrl: doctorNoteUrl || null
            }
        });

        // Buat/Update kehadiran di tabel Attendance untuk hari ini
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const existingAtt = await prisma.attendance.findFirst({
            where: {
                userId: student.id,
                scanTime: { gte: todayStart, lte: todayEnd }
            }
        });

        const leaveNote = `[Izin BK: ${user?.name || 'Guru BK'}] ${finalCategory === 'SAKIT' ? 'Izin Sakit' : 'Izin Keperluan Keluarga'}: ${reason || '-'}`;

        if (existingAtt) {
            await prisma.attendance.update({
                where: { id: existingAtt.id },
                data: {
                    status: attStatus,
                    note: leaveNote
                }
            });
        } else {
            await prisma.attendance.create({
                data: {
                    userId: student.id,
                    type: 'GATE_IN',
                    method: 'MANUAL_BK',
                    status: attStatus,
                    scanTime: new Date(),
                    note: leaveNote
                }
            });
        }

        // Notifikasi ke Orang Tua
        try {
            const notifTitle = isSakit
                ? `🩺 Konfirmasi Izin Sakit: ${student.name}`
                : `🏠 Konfirmasi Izin Keperluan Keluarga: ${student.name}`;
            const notifMsg = `Pemberitahuan: Ananda ${student.name} (Kelas ${student.className || '-'}) telah dicatat resmi izin (${isSakit ? 'Sakit' : 'Keperluan Keluarga'}) oleh Guru BK (${user?.name || 'Guru BK'}). Keterangan: ${reason || '-'}.`;

            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className,
                    title: notifTitle,
                    message: notifMsg,
                    category: 'ATTENDANCE'
                }
            });
        } catch (nErr) {}

        res.json({
            success: true,
            message: `✅ Izin ${finalCategory === 'SAKIT' ? 'Sakit' : 'Keperluan Keluarga'} ananda ${student.name} berhasil dicatat resmi. Notifikasi telah dikirim ke orang tua.`,
            leave: leaveRecord
        });
    } catch (error: any) {
        console.error('Error submitBkQuickStudentLeave:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat izin siswa: ' + error.message });
    }
};
