import { Request, Response } from 'express';
import prisma from '../utils/db';
import { getSchoolSignaturesForClass } from '../utils/schoolSignatures';
import { formatTimeWib } from '../utils/dateUtils';

/**
 * Helper untuk menentukan kelas binaan (homeroom class) dari guru yang sedang login
 */
export async function resolveHomeroomClass(user: any): Promise<string | null> {
    if (!user) return null;

    // 1. Cek langsung dari user.className
    if (user.className && user.className.trim() !== '' && user.className.trim() !== '-' && user.className.trim() !== 'null') {
        return user.className.trim();
    }

    // 2. Cek dari user.tugasTambahan (e.g. "WALI_KELAS:VII-A" atau "WALI:VII-A")
    if (user.tugasTambahan) {
        const match = user.tugasTambahan.match(/WALI(?:_KELAS)?[:\s-]*([VII|VIII|IX|X|XI|XII0-9A-Za-z-]+)/i);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    // 3. Cek apakah guru ini terdaftar sebagai homeroomTeacher pada data siswa di database
    try {
        const sampleStudent = await prisma.user.findFirst({
            where: {
                role: 'STUDENT',
                OR: [
                    { homeroomTeacher: { contains: user.name } },
                    { homeroomTeacher: { contains: user.username } }
                ]
            },
            select: { className: true }
        });
        if (sampleStudent?.className) {
            return sampleStudent.className.trim();
        }
    } catch (err) {
        console.warn('[resolveHomeroomClass] Error finding student homeroomTeacher:', err);
    }

    // 4. Cek dari teachingClasses jika ada tanda wali
    if (user.teachingClasses && (user.tugasTambahan?.includes('WALI') || user.role?.includes('WALI'))) {
        const firstCls = user.teachingClasses.split(',')[0]?.trim();
        if (firstCls) return firstCls;
    }

    return null;
}

/**
 * 1. GET /api/teacher/wali-kelas/dashboard
 * Ringkasan data kelas binaan untuk dashboard Wali Kelas di APK & Portal Web
 */
export const getWaliKelasDashboard = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const requestedClass = (req.query.className as string)?.trim();
        let homeroomClass = requestedClass || await resolveHomeroomClass(user) || 'VII-A';

        // Ambil seluruh siswa di kelas binaan
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className: homeroomClass },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                nis: true,
                gender: true,
                classRole: true,
                points: true,
                parentPhone: true
            }
        });

        const totalStudents = students.length;

        // Ambil log presensi hari ini
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const studentIds = students.map(s => s.id);
        const todayAttendances = await prisma.attendance.findMany({
            where: {
                userId: { in: studentIds },
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        // Ambil pengaturan gate untuk cek status pulang
        const gateSetting = await (prisma as any).gateSetting.findFirst() || {
            gateInMaxTime: '07:15',
            gateOutStartTime: '14:00',
            gateOutEndTime: '17:00'
        };

        const currTimeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
        const isPastGateOutEnd = currTimeStr > (gateSetting.gateOutEndTime || '17:00');

        let presentCount = 0;
        let lateCount = 0;
        let unconfirmedOutCount = 0;
        let sickCount = 0;
        let permissionCount = 0;
        let absentCount = 0;
        let notYetCount = 0;

        for (const s of students) {
            const logs = todayAttendances.filter(a => a.userId === s.id);
            const inRecord = logs.find(a => a.type === 'GATE_IN');
            const outRecord = logs.find(a => a.type === 'GATE_OUT');

            if (logs.length > 0) {
                if (inRecord && !outRecord && isPastGateOutEnd) {
                    unconfirmedOutCount++;
                } else if (logs.some(l => l.status === 'SICK')) {
                    sickCount++;
                } else if (logs.some(l => l.status === 'PERMISSION')) {
                    permissionCount++;
                } else if (logs.some(l => l.status === 'LATE')) {
                    lateCount++;
                } else if (outRecord) {
                    presentCount++;
                } else if (inRecord) {
                    presentCount++;
                }
            } else {
                const isPastGateInMax = currTimeStr > (gateSetting.gateInMaxTime || '07:15');
                if (isPastGateInMax) {
                    absentCount++;
                } else {
                    notYetCount++;
                }
            }
        }

        const totalHadirFisik = presentCount + lateCount + unconfirmedOutCount;
        const attendanceRate = totalStudents > 0 ? Number(((totalHadirFisik / totalStudents) * 100).toFixed(1)) : 0;

        // Ambil permohonan izin siswa yang pending
        let pendingLeavesCount = 0;
        try {
            pendingLeavesCount = await (prisma as any).studentLeaveRequest.count({
                where: {
                    className: homeroomClass,
                    status: 'PENDING'
                }
            });
        } catch {
            pendingLeavesCount = 0;
        }

        // Ambil data pengurus kelas (murni tanpa dummy)
        let officers: any = {
            ketua: null,
            wakil: null,
            sekretaris: null,
            bendahara: null
        };

        const classObj = await prisma.class.findFirst({
            where: { name: homeroomClass }
        });

        if (classObj?.officers) {
            try {
                const parsed = JSON.parse(classObj.officers);
                officers = {
                    ketua: parsed.ketua || null,
                    wakil: parsed.wakil || null,
                    sekretaris: parsed.sekretaris || null,
                    bendahara: parsed.bendahara || null
                };
            } catch {
                // Ignore parse error
            }
        }

        // Lengkapi dari User.classRole jika belum ada di class.officers
        for (const s of students) {
            if (s.classRole) {
                const roleLower = s.classRole.toLowerCase();
                if (roleLower.includes('ketua') && !roleLower.includes('wakil') && !officers.ketua) {
                    officers.ketua = { id: s.id, name: s.name, nisn: s.nisn || s.username };
                } else if (roleLower.includes('wakil') && !officers.wakil) {
                    officers.wakil = { id: s.id, name: s.name, nisn: s.nisn || s.username };
                } else if (roleLower.includes('sekretaris') && !officers.sekretaris) {
                    officers.sekretaris = { id: s.id, name: s.name, nisn: s.nisn || s.username };
                } else if (roleLower.includes('bendahara') && !officers.bendahara) {
                    officers.bendahara = { id: s.id, name: s.name, nisn: s.nisn || s.username };
                }
            }
        }

        // Informasi Guru BK pengampu kelas ini
        const bkName = classObj?.counselorName || 'Belum Ditugaskan';
        let bkNip = '-';
        if (classObj?.counselorId) {
            const counselorUser = await prisma.user.findUnique({ where: { id: classObj.counselorId } });
            if (counselorUser) bkNip = (counselorUser as any).nip || counselorUser.username || '-';
        }

        res.json({
            success: true,
            isHomeroom: true,
            homeroomClass,
            teacherName: user.name,
            teacherNip: (user as any).nip || user.username || '-',
            counselorName: bkName,
            counselorNip: bkNip,
            todayStats: {
                total: totalStudents,
                present: presentCount,
                unconfirmedOut: unconfirmedOutCount, // Tdk scan pulang [?]
                late: lateCount,
                sick: sickCount,
                permission: permissionCount,
                absent: absentCount,
                notYet: notYetCount,
                attendanceRate
            },
            pendingLeavesCount,
            officers
        });
    } catch (error) {
        console.error('Error in getWaliKelasDashboard:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat dashboard wali kelas' });
    }
};

/**
 * 2. GET /api/teacher/wali-kelas/students
 * Daftar siswa lengkap kelas binaan dengan status presensi hari ini
 */
export const getWaliKelasStudents = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const homeroomClass = await resolveHomeroomClass(user);

        if (!homeroomClass) {
            return res.status(403).json({ success: false, message: 'Hanya dapat diakses oleh Wali Kelas aktif.' });
        }

        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className: homeroomClass },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                nis: true,
                nik: true,
                gender: true,
                className: true,
                points: true,
                parentPhone: true,
                fatherName: true,
                motherName: true,
                address: true,
                pob: true,
                dob: true,
                religion: true,
                bloodType: true,
                classRole: true,
                profilePicUrl: true
            }
        });

        // Ambil dokumen resmi PDF (KK & Akta) dari submission biodata
        let submissions: any[] = [];
        try {
            submissions = await (prisma as any).studentBiodataSubmission.findMany({
                where: {
                    studentId: { in: students.map(s => s.id) }
                },
                select: {
                    studentId: true,
                    kkFileUrl: true,
                    aktaFileUrl: true
                }
            });
        } catch (e) {}
        const submissionMap = new Map<string, any>(submissions.map((sub: any) => [sub.studentId, sub]));

        // Ambil data siswa tanpa HP
        const noPhoneSetting = await prisma.settings.findUnique({ where: { key: 'NO_SMARTPHONE_STUDENT_IDS' } });
        let noPhoneIds: string[] = [];
        if (noPhoneSetting && noPhoneSetting.value) {
            try { noPhoneIds = JSON.parse(noPhoneSetting.value); } catch {}
        }

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const studentIds = students.map(s => s.id);
        const todayAttendances = await prisma.attendance.findMany({
            where: {
                userId: { in: studentIds },
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        // Ambil surat permohonan izin/sakit siswa hari ini
        const todayLeaves = await (prisma as any).studentLeaveRequest.findMany({
            where: {
                studentId: { in: studentIds },
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            },
            select: {
                id: true,
                studentId: true,
                category: true,
                reason: true,
                attachmentUrl: true,
                documentType: true,
                status: true
            }
        }).catch(() => []);
        const leaveMap = new Map<string, any>(todayLeaves.map((l: any) => [l.studentId, l]));

        const gateSetting = await (prisma as any).gateSetting.findFirst() || {
            gateInMaxTime: '07:15',
            gateOutStartTime: '14:00',
            gateOutEndTime: '17:00'
        };

        const currTimeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
        const isPastGateOutEnd = currTimeStr > (gateSetting.gateOutEndTime || '17:00');

        const studentListWithAttendance = students.map(s => {
            const logs = todayAttendances.filter(a => a.userId === s.id);
            const inRecord = logs.find(a => a.type === 'GATE_IN');
            const outRecord = logs.find(a => a.type === 'GATE_OUT');

            let status = 'NOT_YET';
            let statusCode = 'BELUM';
            let statusText = 'Belum Presensi';
            let note = 'Menunggu presensi';
            let gateInTime = inRecord ? formatTimeWib(inRecord.scanTime) : '-';
            let gateOutTime = outRecord ? formatTimeWib(outRecord.scanTime) : '-';

            if (logs.length > 0) {
                if (inRecord && !outRecord && isPastGateOutEnd) {
                    status = 'UNCONFIRMED_OUT';
                    statusCode = 'TP';
                    statusText = 'Masuk (Tanpa Tap Pulang)';
                    note = inRecord.note || 'Masuk tetapi tidak tercatat scan kepulangan';
                } else if (logs.some(l => l.status === 'SICK')) {
                    status = 'SICK';
                    statusCode = 'S';
                    statusText = 'Izin Sakit';
                    note = inRecord?.note || 'Sakit';
                } else if (logs.some(l => l.status === 'PERMISSION')) {
                    status = 'PERMISSION';
                    statusCode = 'I';
                    statusText = 'Izin Resmi';
                    note = inRecord?.note || 'Izin';
                } else if (logs.some(l => l.status === 'LATE')) {
                    status = 'LATE';
                    statusCode = 'T';
                    statusText = 'Terlambat';
                    note = inRecord?.note || 'Terlambat Masuk';
                } else if (outRecord || inRecord) {
                    status = 'PRESENT';
                    statusCode = 'H';
                    statusText = 'Hadir';
                    note = outRecord ? (outRecord.note || 'Hadir Tuntas') : (inRecord?.note || 'Sedang Belajar');
                }
            } else {
                const isPastGateInMax = currTimeStr > (gateSetting.gateInMaxTime || '07:15');
                if (isPastGateInMax) {
                    status = 'ABSENT';
                    statusCode = 'A';
                    statusText = 'Alfa';
                    note = 'Tidak ada presensi hingga batas waktu masuk';
                }
            }

            const sub = submissionMap.get(s.id);
            const isNoSmartphone = noPhoneIds.includes(s.id);
            const leaveReq = leaveMap.get(s.id);

            return {
                ...s,
                isNoSmartphone,
                kkFileUrl: sub?.kkFileUrl || null,
                aktaFileUrl: sub?.aktaFileUrl || null,
                attachmentUrl: leaveReq?.attachmentUrl || null,
                leaveRequest: leaveReq ? {
                    category: leaveReq.category,
                    reason: leaveReq.reason,
                    attachmentUrl: leaveReq.attachmentUrl,
                    status: leaveReq.status
                } : null,
                classRoleDisplay: s.classRole || '-',
                todayAttendance: {
                    status,
                    statusCode,
                    statusText,
                    gateInTime,
                    gateOutTime,
                    note
                }
            };
        });

        const countL = students.filter(s => s.gender === 'L' || s.gender === 'LAKI-LAKI').length;
        const countP = students.filter(s => s.gender === 'P' || s.gender === 'PEREMPUAN').length;

        res.json({
            success: true,
            homeroomClass,
            totalStudents: students.length,
            countL,
            countP,
            students: studentListWithAttendance
        });
    } catch (error) {
        console.error('Error in getWaliKelasStudents:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat daftar siswa kelas binaan' });
    }
};

/**
 * Endpoint Khusus Wali Kelas: Toggle Status Siswa Tanpa HP
 */
export const toggleNoPhoneStudent = async (req: Request, res: Response) => {
    try {
        const { studentId, isNoPhone, query } = req.body;
        let targetId = studentId;

        if (!targetId && query) {
            const cleanQuery = String(query).trim();
            const student = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { nisn: cleanQuery },
                        { nis: cleanQuery },
                        { username: cleanQuery },
                        { id: cleanQuery }
                    ]
                }
            });
            if (!student) {
                return res.status(404).json({ success: false, message: `Siswa dengan NISN/Username "${cleanQuery}" tidak ditemukan.` });
            }
            targetId = student.id;
        }

        if (!targetId) return res.status(400).json({ success: false, message: 'Student ID atau NISN wajib disertakan' });

        const setting = await prisma.settings.findUnique({ where: { key: 'NO_SMARTPHONE_STUDENT_IDS' } });
        let ids: string[] = [];
        if (setting && setting.value) {
            try { ids = JSON.parse(setting.value); } catch {}
        }

        const currentlyNoPhone = ids.includes(targetId);
        const shouldBeNoPhone = isNoPhone !== undefined ? !!isNoPhone : !currentlyNoPhone;

        if (shouldBeNoPhone) {
            if (!ids.includes(targetId)) ids.push(targetId);
        } else {
            ids = ids.filter(id => id !== targetId);
        }

        await prisma.settings.upsert({
            where: { key: 'NO_SMARTPHONE_STUDENT_IDS' },
            create: { key: 'NO_SMARTPHONE_STUDENT_IDS', value: JSON.stringify(ids) },
            update: { value: JSON.stringify(ids) }
        });

        const studentData = await prisma.user.findUnique({ where: { id: targetId }, select: { name: true, nisn: true } });
        const studentLabel = studentData ? `${studentData.name} (${studentData.nisn || ''})` : targetId;

        res.json({
            success: true,
            message: `Status siswa ${studentLabel} berhasil diubah: ${shouldBeNoPhone ? '📱 Tanpa Smartphone (Bebas Quota Bantuan Scan)' : '📶 Siswa Memiliki Smartphone Reguler'}`,
            isNoSmartphone: shouldBeNoPhone
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 3. POST /api/teacher/wali-kelas/manual-attendance
 * Presensi manual siswa oleh Wali Kelas (kasus siswa lupa/ketinggalan membawa HP)
 */
export const recordManualAttendanceByWali = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const homeroomClass = await resolveHomeroomClass(user);

        if (!homeroomClass) {
            return res.status(403).json({ success: false, message: 'Hanya Wali Kelas yang dapat mencatat presensi manual.' });
        }

        const { studentId, status = 'PRESENT', note = '', targetDate } = req.body;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'ID siswa wajib disertakan.' });
        }

        // Validasi: siswa harus terdaftar di kelas binaan wali kelas
        const student = await prisma.user.findUnique({
            where: { id: studentId }
        });

        if (!student || student.role !== 'STUDENT') {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        if (student.className !== homeroomClass) {
            return res.status(403).json({
                success: false,
                message: `Siswa ${student.name} terdaftar di kelas ${student.className}, bukan kelas binaan Anda (${homeroomClass}).`
            });
        }

        const baseDate = targetDate ? new Date(targetDate) : new Date();
        const startOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0);
        const endOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59);

        // SIBOY A10: Lock jika siswa telah disetujui SAKIT oleh Guru BK hari ini
        const approvedSickToday = await (prisma as any).studentLeaveRequest.findFirst({
            where: {
                studentId: student.id,
                status: 'APPROVED',
                category: { in: ['SICK', 'SAKIT'] },
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            }
        });

        if (approvedSickToday) {
            // [T-05] A10 Lock Sakit: Wali Kelas mencatat kehadiran fisik siswa
            await (prisma as any).studentLeaveRequest.update({
                where: { id: approvedSickToday.id },
                data: {
                    status: 'REVOKED',
                    rejectionNote: `Izin sakit dicabut otomatis karena Wali Kelas (${user.name}) mencatat kehadiran fisik siswa.`
                }
            }).catch(() => null);

            await prisma.attendance.deleteMany({
                where: {
                    studentId: student.id,
                    status: { in: ['SICK', 'SAKIT'] },
                    scanTime: { gte: startOfDay, lte: endOfDay }
                }
            }).catch(() => null);
        }

        const scanType = req.body.type === 'GATE_OUT' ? 'GATE_OUT' : 'GATE_IN';
        const fullNote = note ? `Presensi manual via Wali Kelas (${user.name}): ${note}` : `Presensi manual via Wali Kelas (${user.name}) - Siswa Tidak Membawa HP`;

        let record;

        if (scanType === 'GATE_OUT') {
            // Cek apakah sudah absen masuk hari ini
            const existingIn = await prisma.attendance.findFirst({
                where: {
                    userId: student.id,
                    type: 'GATE_IN',
                    scanTime: { gte: startOfDay, lte: endOfDay }
                }
            });

            if (!existingIn) {
                return res.status(400).json({
                    success: false,
                    message: `⚠️ Siswa ${student.name} belum tercatat melakukan presensi masuk (Gate-In) hari ini.`
                });
            }

            const existingOut = await prisma.attendance.findFirst({
                where: {
                    userId: student.id,
                    type: 'GATE_OUT',
                    scanTime: { gte: startOfDay, lte: endOfDay }
                }
            });

            if (existingOut) {
                record = await prisma.attendance.update({
                    where: { id: existingOut.id },
                    data: {
                        status: 'PRESENT',
                        method: 'MANUAL_WALI',
                        note: fullNote
                    }
                });
            } else {
                record = await prisma.attendance.create({
                    data: {
                        userId: student.id,
                        type: 'GATE_OUT',
                        method: 'MANUAL_WALI',
                        status: 'PRESENT',
                        scanTime: baseDate,
                        note: fullNote
                    }
                });
            }
        } else {
            // Cari rekaman presensi GATE_IN hari itu
            const existingIn = await prisma.attendance.findFirst({
                where: {
                    userId: student.id,
                    type: 'GATE_IN',
                    scanTime: { gte: startOfDay, lte: endOfDay }
                }
            });

            if (existingIn) {
                record = await prisma.attendance.update({
                    where: { id: existingIn.id },
                    data: {
                        status,
                        method: 'MANUAL_WALI',
                        note: fullNote
                    }
                });
            } else {
                record = await prisma.attendance.create({
                    data: {
                        userId: student.id,
                        type: 'GATE_IN',
                        method: 'MANUAL_WALI',
                        status,
                        scanTime: baseDate,
                        note: fullNote
                    }
                });
            }
        }

        res.json({
            success: true,
            message: `Presensi ${scanType === 'GATE_OUT' ? 'Kepulangan' : 'Masuk'} ${student.name} berhasil dicatat oleh Wali Kelas.`,
            record
        });
    } catch (error) {
        console.error('Error in recordManualAttendanceByWali:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat presensi manual' });
    }
};

/**
 * 4. GET /api/teacher/wali-kelas/rekap
 * Rekapitulasi kehadiran kelas binaan harian atau bulanan
 */
export const getWaliKelasRekap = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const homeroomClass = await resolveHomeroomClass(user);

        if (!homeroomClass) {
            return res.status(403).json({ success: false, message: 'Hanya dapat diakses oleh Wali Kelas.' });
        }

        const mode = (req.query.mode || 'MONTHLY').toString().toUpperCase(); // DAILY atau MONTHLY
        const dateParam = req.query.date ? String(req.query.date) : null;
        const monthParam = req.query.month ? Number(req.query.month) : (new Date().getMonth() + 1);
        const yearParam = req.query.year ? Number(req.query.year) : new Date().getFullYear();

        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className: homeroomClass },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, nisn: true, nis: true, gender: true }
        });

        let startDate: Date;
        let endDate: Date;

        if (mode === 'DAILY') {
            const d = dateParam ? new Date(dateParam) : new Date();
            startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
            endDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        } else {
            startDate = new Date(yearParam, monthParam - 1, 1, 0, 0, 0);
            endDate = new Date(yearParam, monthParam, 0, 23, 59, 59);
        }

        const studentIds = students.map(s => s.id);
        const logs = await prisma.attendance.findMany({
            where: {
                userId: { in: studentIds },
                scanTime: { gte: startDate, lte: endDate }
            },
            orderBy: { scanTime: 'asc' }
        });

        // Gate Settings untuk deteksi lupa scan pulang
        const gateSetting = await (prisma as any).gateSetting.findFirst() || {
            gateOutEndTime: '17:00'
        };

        const rekapPerStudent = students.map((s, idx) => {
            const studentLogs = logs.filter(l => l.userId === s.id);

            let countH = 0;
            let countT = 0;
            let countQuestion = 0; // Tidak scan pulang [?]
            let countS = 0;
            let countI = 0;
            let countA = 0;

            // Kelompokkan per tanggal
            const dateMap = new Map<string, any[]>();
            for (const log of studentLogs) {
                const dateKey = new Date(log.scanTime).toISOString().split('T')[0];
                if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
                dateMap.get(dateKey)!.push(log);
            }

            dateMap.forEach((dayLogs) => {
                const inRecord = dayLogs.find(l => l.type === 'GATE_IN');
                const outRecord = dayLogs.find(l => l.type === 'GATE_OUT');

                const hasSick = dayLogs.some(l => l.status === 'SICK' || l.status === 'SAKIT' || (l.note && /sakit/i.test(l.note)));
                const hasPerm = dayLogs.some(l => l.status === 'PERMISSION' || l.status === 'IZIN' || (l.note && /izin/i.test(l.note)));
                const hasLate = dayLogs.some(l => 
                    l.status === 'LATE' || 
                    l.status === 'TERLAMBAT' || 
                    (l.note && /terlambat/i.test(l.note)) ||
                    (l.morningGateStatus && /terlambat/i.test(l.morningGateStatus))
                );
                const hasAbsent = dayLogs.some(l => l.status === 'ABSENT' || l.status === 'ALPHA' || l.status === 'ALPA');

                if (hasSick) {
                    countS++;
                } else if (hasPerm) {
                    countI++;
                } else if (hasLate) {
                    countT++;
                } else if (inRecord && !outRecord) {
                    countQuestion++; // Tdk scan pulang
                } else if (outRecord || inRecord || dayLogs.some(l => l.status === 'PRESENT' || l.status === 'HADIR')) {
                    countH++;
                } else if (hasAbsent) {
                    countA++;
                }
            });

            const totalHadirFisik = countH + countT + countQuestion;
            const totalRecordedDays = dateMap.size;
            const rate = totalRecordedDays > 0 ? Number(((totalHadirFisik / totalRecordedDays) * 100).toFixed(1)) : 100;

            return {
                no: idx + 1,
                studentId: s.id,
                name: s.name,
                nisn: s.nisn || '-',
                nis: s.nis || '-',
                gender: s.gender || '-',
                H: countH,
                T: countT,
                questionMark: countQuestion, // [?]
                S: countS,
                I: countI,
                A: countA,
                totalRecordedDays,
                attendancePercentage: rate
            };
        });

        res.json({
            success: true,
            homeroomClass,
            mode,
            month: monthParam,
            year: yearParam,
            date: dateParam || new Date().toISOString().split('T')[0],
            totalStudents: students.length,
            records: rekapPerStudent
        });
    } catch (error) {
        console.error('Error in getWaliKelasRekap:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat rekap presensi kelas binaan' });
    }
};

/**
 * 5. GET /api/teacher/wali-kelas/student-rekap/:studentId
 * Riwayat kehadiran per anak (individual) untuk dilihat oleh Wali Kelas atau Guru BK
 */
export const getStudentDetailRekap = async (req: Request, res: Response) => {
    try {
        const studentId = String(req.params.studentId || req.query.studentId || '');
        if (!studentId) {
            return res.status(400).json({ success: false, message: 'ID siswa wajib disertakan' });
        }
        const monthParam = req.query.month ? Number(req.query.month) : (new Date().getMonth() + 1);
        const yearParam = req.query.year ? Number(req.query.year) : new Date().getFullYear();

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                nis: true,
                className: true,
                gender: true,
                parentPhone: true,
                points: true,
                homeroomTeacher: true
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const startDate = new Date(yearParam, monthParam - 1, 1, 0, 0, 0);
        const endDate = new Date(yearParam, monthParam, 0, 23, 59, 59);

        const logs = await prisma.attendance.findMany({
            where: {
                userId: student.id,
                scanTime: { gte: startDate, lte: endDate }
            },
            orderBy: { scanTime: 'asc' }
        });

        // Group per hari dalam bulan tersebut
        const daysInMonth = new Date(yearParam, monthParam, 0).getDate();
        const dailyHistory = [];

        let countH = 0;
        let countT = 0;
        let countQuestion = 0;
        let countS = 0;
        let countI = 0;
        let countA = 0;

        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

        for (let day = 1; day <= daysInMonth; day++) {
            const curDate = new Date(yearParam, monthParam - 1, day);
            const dateStr = curDate.toISOString().split('T')[0];
            const dayOfWeek = curDate.getDay();
            const dayName = dayNames[dayOfWeek];

            if (dayOfWeek === 0) {
                // Hari Minggu libur
                dailyHistory.push({
                    day,
                    date: dateStr,
                    dayName,
                    status: 'HOLIDAY',
                    statusCode: 'LBR',
                    statusText: 'Hari Minggu',
                    gateInTime: '-',
                    gateOutTime: '-',
                    note: 'Libur Akhir Pekan'
                });
                continue;
            }

            const dayLogs = logs.filter(l => {
                const lDate = new Date(l.scanTime);
                return lDate.getDate() === day && (lDate.getMonth() + 1) === monthParam && lDate.getFullYear() === yearParam;
            });

            const inRecord = dayLogs.find(l => l.type === 'GATE_IN');
            const outRecord = dayLogs.find(l => l.type === 'GATE_OUT');

            let status = '-';
            let statusCode = '-';
            let statusText = '-';
            let note = '-';
            let gateInTime = inRecord ? formatTimeWib(inRecord.scanTime) : '-';
            let gateOutTime = outRecord ? formatTimeWib(outRecord.scanTime) : '-';

            if (dayLogs.length > 0) {
                if (dayLogs.some(l => l.status === 'SICK')) {
                    status = 'SICK';
                    statusCode = 'S';
                    statusText = 'Sakit';
                    note = inRecord?.note || 'Izin Sakit';
                    countS++;
                } else if (dayLogs.some(l => l.status === 'PERMISSION')) {
                    status = 'PERMISSION';
                    statusCode = 'I';
                    statusText = 'Izin';
                    note = inRecord?.note || 'Izin Resmi';
                    countI++;
                } else if (dayLogs.some(l => l.status === 'LATE')) {
                    status = 'LATE';
                    statusCode = 'T';
                    statusText = 'Terlambat';
                    note = inRecord?.note || 'Terlambat Hadir';
                    countT++;
                } else if (inRecord && !outRecord) {
                    status = 'UNCONFIRMED_OUT';
                    statusCode = 'TP';
                    statusText = 'Tanpa Tap Pulang';
                    note = inRecord.note || 'Masuk tetapi tidak scan kepulangan';
                    countQuestion++;
                } else if (outRecord || inRecord) {
                    status = 'PRESENT';
                    statusCode = 'H';
                    statusText = 'Hadir';
                    note = outRecord?.note || inRecord?.note || 'Hadir Normal';
                    countH++;
                } else if (dayLogs.some(l => l.status === 'ABSENT')) {
                    status = 'ABSENT';
                    statusCode = 'A';
                    statusText = 'Alfa';
                    note = 'Tanpa Keterangan';
                    countA++;
                }
            } else if (curDate < new Date()) {
                // Hari yang sudah lewat dan tidak ada presensi
                status = 'ABSENT';
                statusCode = 'A';
                statusText = 'Alfa';
                note = 'Tidak Melakukan Presensi';
                countA++;
            }

            dailyHistory.push({
                day,
                date: dateStr,
                dayName,
                status,
                statusCode,
                statusText,
                gateInTime,
                gateOutTime,
                note
            });
        }

        const effectiveDays = countH + countT + countQuestion + countS + countI + countA;
        const totalHadirFisik = countH + countT + countQuestion;
        const rate = effectiveDays > 0 ? Number(((totalHadirFisik / effectiveDays) * 100).toFixed(1)) : 100;

        // Ambil catatan pelanggaran & kedisiplinan BK (SIBOY A6 & A9)
        const bkRecords = await prisma.disciplineRecord.findMany({
            where: { userId: student.id },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        // Ambil riwayat presensi mata pelajaran
        const subjectLogs = await (prisma as any).studentSubjectAttendance.findMany({
            where: { studentId: student.id },
            include: { session: { select: { subjectName: true, checkInTime: true, className: true } } },
            orderBy: { createdAt: 'desc' },
            take: 15
        });

        // Ambil riwayat catatan wali kelas
        const waliNotes = await (prisma as any).notificationMessage.findMany({
            where: {
                studentId: student.id,
                category: 'WALI_NOTE'
            },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        res.json({
            success: true,
            student,
            month: monthParam,
            year: yearParam,
            summary: {
                totalHadir: countH,
                totalTerlambat: countT,
                totalTdkScanPulang: countQuestion, // [?]
                totalSakit: countS,
                totalIzin: countI,
                totalAlfa: countA,
                effectiveDays,
                attendancePercentage: rate
            },
            history: dailyHistory,
            bkRecords,
            subjectAttendances: subjectLogs.map((sl: any) => ({
                id: sl.id,
                subjectName: sl.session?.subjectName || 'Mata Pelajaran',
                className: sl.session?.className || student.className,
                status: sl.status,
                notes: sl.notes,
                date: sl.session?.checkInTime || sl.createdAt
            })),
            waliNotes
        });
    } catch (error) {
        console.error('Error in getStudentDetailRekap:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat rekap detail siswa' });
    }
};

/**
 * 5.B Simpan Catatan Wali Kelas untuk Siswa (SIBOY A6)
 * Catatan tersimpan dan otomatis terkirim/visible ke Orang Tua & Guru BK
 */
export const saveWaliKelasStudentNote = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, note, isUrgent } = req.body;

        if (!studentId || !note) {
            return res.status(400).json({ success: false, message: 'ID Siswa dan Catatan wajib diisi.' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true, parentPhone: true, nisn: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
        }

        const noteTitle = isUrgent ? `🚨 Catatan Penting Wali Kelas: ${student.name}` : `📝 Catatan Wali Kelas: ${student.name}`;
        const noteMessage = `Wali Kelas (${user.name}) memberikan catatan untuk ananda ${student.name} (${student.className}):\n\n"${note}"`;

        // 1. Simpan catatan notifikasi untuk Siswa
        await (prisma as any).notificationMessage.create({
            data: {
                recipientId: student.id,
                recipientRole: 'STUDENT',
                studentId: student.id,
                studentName: student.name,
                className: student.className || '-',
                title: noteTitle,
                message: noteMessage,
                category: 'WALI_NOTE'
            }
        });

        // 2. Kirim ke Orang Tua
        await (prisma as any).notificationMessage.create({
            data: {
                recipientRole: 'PARENT',
                recipientPhone: student.parentPhone,
                studentId: student.id,
                studentName: student.name,
                className: student.className || '-',
                title: noteTitle,
                message: noteMessage,
                category: 'WALI_NOTE'
            }
        });

        // 3. Tembusan ke Guru BK pengampu kelas
        const bkPlot = await (prisma as any).bkKelasPlot.findFirst({
            where: { className: student.className || '-' }
        });
        if (bkPlot?.guruBkId) {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientId: bkPlot.guruBkId,
                    recipientRole: 'COUNSELOR',
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className || '-',
                    title: `📋 Tembusan BK - ${noteTitle}`,
                    message: noteMessage,
                    category: 'WALI_NOTE'
                }
            });
        }

        res.json({
            success: true,
            message: 'Catatan wali kelas berhasil disimpan dan diteruskan ke Orang Tua & BK.'
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal menyimpan catatan: ' + error.message });
    }
};

/**
 * 6. GET & PUT /api/teacher/wali-kelas/officers
 * Pengurus Kelas (Ketua, Wakil, Sekretaris, Bendahara) — TANPA DATA DUMMY
 */
export const getWaliKelasOfficers = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const homeroomClass = await resolveHomeroomClass(user) || (req.query.className ? String(req.query.className) : null);

        if (!homeroomClass) {
            return res.status(400).json({ success: false, message: 'Kelas tidak ditemukan' });
        }

        const classObj = await prisma.class.findFirst({
            where: { name: homeroomClass }
        });

        let officers: any = {
            ketua: null,
            wakil: null,
            sekretaris: null,
            bendahara: null
        };

        if (classObj?.officers) {
            try {
                const parsed = JSON.parse(classObj.officers);
                officers = {
                    ketua: parsed.ketua || null,
                    wakil: parsed.wakil || null,
                    sekretaris: parsed.sekretaris || null,
                    bendahara: parsed.bendahara || null
                };
            } catch {
                // Ignore parse error
            }
        }

        // Ambil kandidat siswa dari kelas ini untuk pilihan dropdown
        const candidateStudents = await prisma.user.findMany({
            where: { role: 'STUDENT', className: homeroomClass },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, nisn: true, nis: true, classRole: true }
        });

        // Sinkronisasi User.classRole jika ada siswa yang memiliki jabatan
        for (const s of candidateStudents) {
            if (s.classRole) {
                const roleLower = s.classRole.toLowerCase();
                if (roleLower.includes('ketua') && !roleLower.includes('wakil') && !officers.ketua) {
                    officers.ketua = { id: s.id, name: s.name, nisn: s.nisn || '-' };
                } else if (roleLower.includes('wakil') && !officers.wakil) {
                    officers.wakil = { id: s.id, name: s.name, nisn: s.nisn || '-' };
                } else if (roleLower.includes('sekretaris') && !officers.sekretaris) {
                    officers.sekretaris = { id: s.id, name: s.name, nisn: s.nisn || '-' };
                } else if (roleLower.includes('bendahara') && !officers.bendahara) {
                    officers.bendahara = { id: s.id, name: s.name, nisn: s.nisn || '-' };
                }
            }
        }

        res.json({
            success: true,
            homeroomClass,
            officers, // Pastikan jika kosong nilainya null/empty, bukan dummy!
            candidates: candidateStudents
        });
    } catch (error) {
        console.error('Error in getWaliKelasOfficers:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat struktur pengurus kelas' });
    }
};

export const updateWaliKelasOfficers = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const homeroomClass = await resolveHomeroomClass(user) || (req.body.className ? String(req.body.className) : null);

        if (!homeroomClass) {
            return res.status(400).json({ success: false, message: 'Kelas tidak ditemukan' });
        }

        const { ketuaId, wakilId, sekretarisId, bendaharaId } = req.body;

        // Ambil data siswa terpilih
        const selectedIds = [ketuaId, wakilId, sekretarisId, bendaharaId].filter(Boolean);
        const selectedUsers = await prisma.user.findMany({
            where: { id: { in: selectedIds } },
            select: { id: true, name: true, nisn: true }
        });

        const ketua = selectedUsers.find(u => u.id === ketuaId) || null;
        const wakil = selectedUsers.find(u => u.id === wakilId) || null;
        const sekretaris = selectedUsers.find(u => u.id === sekretarisId) || null;
        const bendahara = selectedUsers.find(u => u.id === bendaharaId) || null;

        const officersJson = JSON.stringify({
            ketua: ketua ? { id: ketua.id, name: ketua.name, nisn: ketua.nisn } : null,
            wakil: wakil ? { id: wakil.id, name: wakil.name, nisn: wakil.nisn } : null,
            sekretaris: sekretaris ? { id: sekretaris.id, name: sekretaris.name, nisn: sekretaris.nisn } : null,
            bendahara: bendahara ? { id: bendahara.id, name: bendahara.name, nisn: bendahara.nisn } : null
        });

        // 1. Update di tabel Class
        await prisma.class.updateMany({
            where: { name: homeroomClass },
            data: { officers: officersJson }
        });

        // 2. Reset classRole lama untuk siswa di kelas ini
        await prisma.user.updateMany({
            where: { role: 'STUDENT', className: homeroomClass },
            data: { classRole: null }
        });

        // 3. Pasang classRole baru
        if (ketuaId) await prisma.user.update({ where: { id: ketuaId }, data: { classRole: 'Ketua Kelas' } });
        if (wakilId) await prisma.user.update({ where: { id: wakilId }, data: { classRole: 'Wakil Ketua' } });
        if (sekretarisId) await prisma.user.update({ where: { id: sekretarisId }, data: { classRole: 'Sekretaris' } });
        if (bendaharaId) await prisma.user.update({ where: { id: bendaharaId }, data: { classRole: 'Bendahara' } });

        res.json({
            success: true,
            message: `Struktur Pengurus Kelas ${homeroomClass} berhasil diperbarui.`,
            officers: JSON.parse(officersJson)
        });
    } catch (error) {
        console.error('Error in updateWaliKelasOfficers:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan struktur pengurus kelas' });
    }
};

/**
 * 7. GET /api/teacher/wali-kelas/rekap-pdf
 * Download / Cetak Laporan PDF resmi per kelas atau per anak untuk Wali Kelas & Guru BK
 */
export const exportWaliKelasPdf = async (req: Request, res: Response) => {
    try {
        let user = (req as any).user;
        if (!user && req.query.token) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(String(req.query.token), process.env.JWT_SECRET || 'secret');
                user = decoded;
            } catch(e) {}
        }
        let homeroomClass = (req.query.className ? String(req.query.className) : null) || await resolveHomeroomClass(user);
        if (!homeroomClass && req.query.studentId) {
            const st = await prisma.user.findUnique({ where: { id: String(req.query.studentId) } });
            if (st && st.className) homeroomClass = st.className;
        }

        if (!homeroomClass) {
            return res.status(400).send('Kelas tidak ditemukan');
        }

        const rawType = (req.query.type || 'class_monthly').toString();
        const type = (rawType === 'student' || rawType === 'student_individual') ? 'student_individual' :
                     (rawType === 'daily' || rawType === 'class_daily') ? 'class_daily' : 'class_monthly';
        const month = req.query.month ? Number(req.query.month) : (new Date().getMonth() + 1);
        const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
        const date = req.query.date ? String(req.query.date) : new Date().toISOString().split('T')[0];
        const studentId = req.query.studentId ? String(req.query.studentId) : undefined;

        const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        const periodStr = type === 'class_daily' ? `Tanggal ${date}` : `${monthNames[month]} ${year}`;
        const todayId = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

        // Dapatkan tanda tangan spesifik untuk kelas ini (Guru BK kelas + Kepala Sekolah ADI SUTIGNYO, S.Pd. + Wali Kelas)
        const sigs = await getSchoolSignaturesForClass(homeroomClass, false);

        if (type === 'student_individual' && studentId) {
            // Rekap Individual Siswa
            const student = await prisma.user.findUnique({ where: { id: studentId } });
            if (!student) return res.status(404).send('Siswa tidak ditemukan');

            const startDate = new Date(year, month - 1, 1, 0, 0, 0);
            const endDate = new Date(year, month, 0, 23, 59, 59);
            const [logs, approvedLeaves] = await Promise.all([
                prisma.attendance.findMany({
                    where: { userId: student.id, scanTime: { gte: startDate, lte: endDate } },
                    orderBy: { scanTime: 'asc' }
                }),
                (prisma as any).studentLeaveRequest.findMany({
                    where: {
                        studentId: student.id,
                        status: 'APPROVED',
                        startDate: { lte: endDate },
                        endDate: { gte: startDate }
                    }
                }).catch(() => [])
            ]);

            const daysInMonth = new Date(year, month, 0).getDate();
            const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

            let rows = '';
            let hCount = 0, tCount = 0, qCount = 0, sCount = 0, iCount = 0, aCount = 0;

            for (let d = 1; d <= daysInMonth; d++) {
                const cur = new Date(year, month - 1, d);
                const dayName = dayNames[cur.getDay()];
                const isSunday = cur.getDay() === 0;

                if (isSunday) {
                    rows += `<tr><td class="text-center">${d}</td><td>${dayName}</td><td class="text-center" colspan="4" style="background:#f1f5f9; color:#94a3b8; font-weight:bold;">Libur Akhir Pekan</td></tr>`;
                    continue;
                }

                const dayLogs = logs.filter(l => new Date(l.scanTime).getDate() === d);
                const inR = dayLogs.find(l => l.type === 'GATE_IN');
                const outR = dayLogs.find(l => l.type === 'GATE_OUT');

                let st = '-', inT = inR ? formatTimeWib(inR.scanTime) : '-', outT = outR ? formatTimeWib(outR.scanTime) : '-';
                let note = '-';

                const curYmd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const matchedLeave = (approvedLeaves as any[]).find((lv: any) => {
                    const startStr = lv.startDate ? new Date(lv.startDate).toISOString().split('T')[0] : '';
                    const endStr = lv.endDate ? new Date(lv.endDate).toISOString().split('T')[0] : startStr;
                    return curYmd >= startStr && curYmd <= endStr;
                });

                const isLeaveSick = matchedLeave && (matchedLeave.type === 'SAKIT' || matchedLeave.type === 'SICK');
                const isLeavePerm = matchedLeave && (matchedLeave.type === 'IZIN' || matchedLeave.type === 'PERMISSION');

                const hasSick = dayLogs.some(l => l.status === 'SICK' || l.status === 'SAKIT') || isLeaveSick;
                const hasPerm = dayLogs.some(l => l.status === 'PERMISSION' || l.status === 'IZIN') || isLeavePerm;
                const hasLate = dayLogs.some(l => l.status === 'LATE' || l.status === 'TERLAMBAT' || (l.note && /terlambat/i.test(l.note)) || ((l as any).morningGateStatus && /terlambat/i.test((l as any).morningGateStatus)));

                if (hasSick) { st = 'Sakit [S]'; sCount++; note = inR?.note || matchedLeave?.reason || 'Izin Sakit (Disetujui BK)'; }
                else if (hasPerm) { st = 'Izin [I]'; iCount++; note = inR?.note || matchedLeave?.reason || 'Izin Resmi (Disetujui BK)'; }
                else if (hasLate) { st = 'Terlambat [T]'; tCount++; note = inR?.note || 'Terlambat Hadir'; }
                else if (inR && !outR) { st = 'Tdk Scan Pulang [?]'; qCount++; note = 'Hadir, tidak scan kepulangan'; }
                else if (outR || inR || dayLogs.some(l => l.status === 'PRESENT' || l.status === 'HADIR')) { st = 'Hadir [H]'; hCount++; note = 'Hadir Tuntas'; }
                else if (cur < new Date()) { st = 'Alfa [A]'; aCount++; note = 'Tanpa Keterangan'; }

                rows += `
                    <tr>
                        <td class="text-center">${d}</td>
                        <td>${dayName}</td>
                        <td class="text-center font-mono">${inT}</td>
                        <td class="text-center font-mono">${outT}</td>
                        <td class="text-center font-bold">${st}</td>
                        <td>${note}</td>
                    </tr>
                `;
            }

            const totalFisik = hCount + tCount + qCount;
            const totalHari = hCount + tCount + qCount + sCount + iCount + aCount;
            const pct = totalHari > 0 ? ((totalFisik / totalHari) * 100).toFixed(1) : '100';

            const html = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Rekap Presensi Individual - ${student.name}</title>
    <style>
        @page { size: A4 portrait; margin: 12mm 15mm; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 15px; }
        .kop { text-align: center; border-bottom: 3px double #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
        .kop h2 { margin: 0; font-size: 13px; font-weight: bold; }
        .kop h1 { margin: 2px 0; font-size: 15px; font-weight: 900; }
        .kop p { margin: 0; font-size: 9px; color: #475569; }
        .title { text-align: center; margin: 10px 0; }
        .title h3 { margin: 0; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .meta-table { width: 100%; margin-bottom: 10px; font-size: 11px; }
        .meta-table td { padding: 2px 4px; }
        table.data { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
        table.data th, table.data td { border: 1px solid #cbd5e1; padding: 4px 6px; font-size: 10px; }
        table.data th { background: #0f172a; color: white; text-align: center; }
        .text-center { text-align: center; }
        .font-mono { font-family: monospace; }
        .font-bold { font-weight: bold; }
        .summary-box { display: flex; gap: 8px; margin-bottom: 15px; }
        .stat-card { flex: 1; border: 1px solid #cbd5e1; padding: 6px; text-align: center; border-radius: 4px; }
        .stat-num { font-size: 14px; font-weight: bold; }
        .stat-lbl { font-size: 8px; text-transform: uppercase; color: #64748b; font-weight: bold; }
        .ttd-grid { display: flex; justify-content: space-between; margin-top: 25px; page-break-inside: avoid; }
        .ttd-box { text-align: center; width: 30%; }
        @media print { .no-print { display: none; } }
    </style>
</head>
<body>
    <div class="no-print" style="margin-bottom: 10px; text-align: right;">
        <button onclick="window.print()" style="padding: 6px 14px; background: #0284c7; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">🖨️ Cetak / Simpan PDF</button>
    </div>
    <div class="kop">
        <h2>PEMERINTAH KABUPATEN TULUNGAGUNG</h2>
        <h2>DINAS PENDIDIKAN</h2>
        <h1>${sigs.schoolName.toUpperCase()}</h1>
        <p>Jalan Raya Boyolangu, Kec. Boyolangu, Kab. Tulungagung 66271 | Telp. (0355) 324146</p>
    </div>
    <div class="title">
        <h3>REKAPITULASI PRESENSI INDIVIDUAL SISWA</h3>
        <p style="margin: 2px 0; font-size: 10px; color: #475569;">Periode: ${periodStr}</p>
    </div>
    <table class="meta-table">
        <tr>
            <td style="width: 15%; font-weight: bold;">Nama Siswa</td>
            <td style="width: 35%;">: <b>${student.name}</b></td>
            <td style="width: 15%; font-weight: bold;">Kelas</td>
            <td style="width: 35%;">: ${student.className}</td>
        </tr>
        <tr>
            <td style="font-weight: bold;">NISN / NIS</td>
            <td>: ${student.nisn || student.username} / ${student.nis || '-'}</td>
            <td style="font-weight: bold;">Wali Kelas</td>
            <td>: ${sigs.homeroomName || student.homeroomTeacher || '-'}</td>
        </tr>
    </table>
    <div class="summary-box">
        <div class="stat-card"><div class="stat-num" style="color:#15803d;">${hCount}</div><div class="stat-lbl">Hadir [H]</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0284c7;">${qCount}</div><div class="stat-lbl">Tdk Scan [?]</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#b45309;">${tCount}</div><div class="stat-lbl">Terlambat [T]</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#1d4ed8;">${sCount}</div><div class="stat-lbl">Sakit [S]</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#7e22ce;">${iCount}</div><div class="stat-lbl">Izin [I]</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#b91c1c;">${aCount}</div><div class="stat-lbl">Alfa [A]</div></div>
        <div class="stat-card" style="background:#f8fafc;"><div class="stat-num" style="color:#0f172a;">${pct}%</div><div class="stat-lbl">% Kehadiran</div></div>
    </div>
    <table class="data">
        <thead>
            <tr>
                <th style="width: 30px;">Tgl</th>
                <th style="width: 70px;">Hari</th>
                <th style="width: 80px;">Jam Masuk</th>
                <th style="width: 80px;">Jam Pulang</th>
                <th style="width: 120px;">Status Kehadiran</th>
                <th>Keterangan</th>
            </tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>
    <div class="ttd-grid">
        <div class="ttd-box">
            <p>Mengetahui,</p>
            <p style="font-weight: bold; margin-bottom: 55px;">Kepala ${sigs.schoolName}</p>
            <p style="font-weight: bold; text-decoration: underline; margin: 0;">${sigs.headmasterName || 'ADI SUTIGNYO, S.Pd.'}</p>
            <p style="margin: 2px 0 0; color: #475569;">NIP. ${sigs.headmasterNip || '196801211991031004'}</p>
        </div>
        <div class="ttd-box">
            <p>&nbsp;</p>
            <p style="font-weight: bold; margin-bottom: 55px;">${sigs.homeroomTitle || 'Wali Kelas'}</p>
            <p style="font-weight: bold; text-decoration: underline; margin: 0;">${sigs.homeroomName || '-'}</p>
            <p style="margin: 2px 0 0; color: #475569;">NIP. ${sigs.homeroomNip || '-'}</p>
        </div>
        <div class="ttd-box">
            <p>Boyolangu, ${todayId}</p>
            <p style="font-weight: bold; margin-bottom: 55px;">${sigs.bkCoordinatorTitle || 'Guru BK'}</p>
            <p style="font-weight: bold; text-decoration: underline; margin: 0;">${sigs.bkCoordinatorName || '-'}</p>
            <p style="margin: 2px 0 0; color: #475569;">NIP. ${sigs.bkCoordinatorNip || '-'}</p>
        </div>
    </div>
</body>
</html>
            `;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        }

        // Rekap Seluruh Kelas (Bulanan atau Harian)
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className: homeroomClass, isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, nisn: true, nis: true, gender: true }
        });

        let startDate: Date;
        let endDate: Date;
        if (type === 'class_daily') {
            const parts = date.split('-').map(Number);
            const y = parts[0] || new Date().getFullYear();
            const m = parts[1] || (new Date().getMonth() + 1);
            const d = parts[2] || new Date().getDate();
            startDate = new Date(y, m - 1, d, 0, 0, 0);
            endDate = new Date(y, m - 1, d, 23, 59, 59);
        } else {
            startDate = new Date(year, month - 1, 1, 0, 0, 0);
            endDate = new Date(year, month, 0, 23, 59, 59);
        }

        const [logs, classApprovedLeaves] = await Promise.all([
            prisma.attendance.findMany({
                where: {
                    userId: { in: students.map(s => s.id) },
                    scanTime: { gte: startDate, lte: endDate }
                }
            }),
            (prisma as any).studentLeaveRequest.findMany({
                where: {
                    studentId: { in: students.map(s => s.id) },
                    status: 'APPROVED',
                    startDate: { lte: endDate },
                    endDate: { gte: startDate }
                }
            }).catch(() => [])
        ]);

        let tableRows = '';
        let totH = 0, totT = 0, totQ = 0, totS = 0, totI = 0, totA = 0;

        students.forEach((s, idx) => {
            const sLogs = logs.filter(l => l.userId === s.id);
            const dateMap = new Map<string, any[]>();
            for (const l of sLogs) {
                const k = new Date(l.scanTime).toISOString().split('T')[0];
                if (!dateMap.has(k)) dateMap.set(k, []);
                dateMap.get(k)!.push(l);
            }

            // BUG-KUR-17 Fix: Sinkronkan izin sakit/keperluan yang disetujui BK ke dateMap siswa
            const studentLeaves = (classApprovedLeaves as any[]).filter(lv => lv.studentId === s.id);
            studentLeaves.forEach(lv => {
                const sYmd = lv.startDate ? new Date(lv.startDate).toISOString().split('T')[0] : '';
                const eYmd = lv.endDate ? new Date(lv.endDate).toISOString().split('T')[0] : sYmd;
                const leaveStatus = (lv.type === 'SAKIT' || lv.type === 'SICK') ? 'SAKIT' : 'IZIN';
                if (sYmd && !dateMap.has(sYmd)) {
                    dateMap.set(sYmd, [{ status: leaveStatus, type: 'LEAVE', note: lv.reason || 'Izin Disetujui BK' }]);
                }
            });

            let h = 0, t = 0, q = 0, sSick = 0, i = 0, a = 0;
            dateMap.forEach(dayLogs => {
                const inR = dayLogs.find(l => l.type === 'GATE_IN' || l.type === 'CLASS_IN');
                const outR = dayLogs.find(l => l.type === 'GATE_OUT' || l.type === 'CLASS_OUT');
                const hasSick = dayLogs.some(l => l.status === 'SICK' || l.status === 'SAKIT');
                const hasPerm = dayLogs.some(l => l.status === 'PERMISSION' || l.status === 'IZIN');
                const hasLate = dayLogs.some(l => l.status === 'LATE' || l.status === 'TERLAMBAT' || (l.note && /terlambat/i.test(l.note)) || ((l as any).morningGateStatus && /terlambat/i.test((l as any).morningGateStatus)));
                const hasAbsent = dayLogs.some(l => l.status === 'ABSENT' || l.status === 'ALPHA' || l.status === 'ALPA');

                if (hasSick) sSick++;
                else if (hasPerm) i++;
                else if (hasLate) t++;
                else if (inR && !outR) q++;
                else if (outR || inR || dayLogs.some(l => l.status === 'PRESENT' || l.status === 'HADIR')) h++;
                else if (hasAbsent) a++;
            });

            totH += h; totT += t; totQ += q; totS += sSick; totI += i; totA += a;
            const hadirFisik = h + t + q;
            const recorded = dateMap.size;
            const rate = recorded > 0 ? ((hadirFisik / recorded) * 100).toFixed(1) : '100';

            tableRows += `
                <tr>
                    <td class="text-center">${idx + 1}</td>
                    <td class="font-mono text-center">${s.nisn || '-'}</td>
                    <td style="font-weight: bold;">${s.name}</td>
                    <td class="text-center">${s.gender || '-'}</td>
                    <td class="text-center font-bold" style="color:#15803d;">${h}</td>
                    <td class="text-center font-bold" style="color:#0284c7;">${q}</td>
                    <td class="text-center font-bold" style="color:#b45309;">${t}</td>
                    <td class="text-center font-bold" style="color:#1d4ed8;">${sSick}</td>
                    <td class="text-center font-bold" style="color:#7e22ce;">${i}</td>
                    <td class="text-center font-bold" style="color:#b91c1c;">${a}</td>
                    <td class="text-center font-bold">${rate}%</td>
                </tr>
            `;
        });

        const html = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Rekap Presensi Kelas ${homeroomClass} - ${periodStr}</title>
    <style>
        @page { size: A4 portrait; margin: 12mm 15mm; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 15px; }
        .kop { text-align: center; border-bottom: 3px double #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
        .kop h2 { margin: 0; font-size: 13px; font-weight: bold; }
        .kop h1 { margin: 2px 0; font-size: 15px; font-weight: 900; }
        .kop p { margin: 0; font-size: 9px; color: #475569; }
        .title { text-align: center; margin: 10px 0; }
        .title h3 { margin: 0; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .meta-table { width: 100%; margin-bottom: 10px; font-size: 11px; }
        .meta-table td { padding: 2px 4px; }
        table.data { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
        table.data th, table.data td { border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 10px; }
        table.data th { background: #0f172a; color: white; text-align: center; }
        .text-center { text-align: center; }
        .font-mono { font-family: monospace; }
        .font-bold { font-weight: bold; }
        .ttd-grid { display: flex; justify-content: space-between; margin-top: 25px; page-break-inside: avoid; }
        .ttd-box { text-align: center; width: 30%; }
        @media print { .no-print { display: none; } }
    </style>
</head>
<body>
    <div class="no-print" style="margin-bottom: 10px; text-align: right;">
        <button onclick="window.print()" style="padding: 6px 14px; background: #0284c7; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">🖨️ Cetak / Simpan PDF</button>
    </div>
    <div class="kop">
        <h2>PEMERINTAH KABUPATEN TULUNGAGUNG</h2>
        <h2>DINAS PENDIDIKAN</h2>
        <h1>${sigs.schoolName.toUpperCase()}</h1>
        <p>Jalan Raya Boyolangu, Kec. Boyolangu, Kab. Tulungagung 66271 | Telp. (0355) 324146</p>
    </div>
    <div class="title">
        <h3>REKAPITULASI PRESENSI KELAS ${homeroomClass}</h3>
        <p style="margin: 2px 0; font-size: 10px; color: #475569;">Periode: ${periodStr}</p>
    </div>
    <table class="meta-table">
        <tr>
            <td style="width: 15%; font-weight: bold;">Rombel Kelas</td>
            <td style="width: 35%;">: <b>${homeroomClass}</b> (Total ${students.length} Siswa)</td>
            <td style="width: 15%; font-weight: bold;">Wali Kelas</td>
            <td style="width: 35%;">: ${sigs.homeroomName || '-'}</td>
        </tr>
        <tr>
            <td style="font-weight: bold;">Guru BK Pengampu</td>
            <td>: ${sigs.bkCoordinatorName}</td>
            <td style="font-weight: bold;">NIP Wali Kelas</td>
            <td>: ${sigs.homeroomNip || '-'}</td>
        </tr>
    </table>
    <table class="data">
        <thead>
            <tr>
                <th style="width: 25px;">No</th>
                <th style="width: 80px;">NISN</th>
                <th>Nama Lengkap Siswa</th>
                <th style="width: 30px;">L/P</th>
                <th style="width: 30px;">H</th>
                <th style="width: 30px;">?</th>
                <th style="width: 30px;">T</th>
                <th style="width: 30px;">S</th>
                <th style="width: 30px;">I</th>
                <th style="width: 30px;">A</th>
                <th style="width: 45px;">% Hadir</th>
            </tr>
        </thead>
        <tbody>
            ${tableRows}
            <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="4" class="text-center">TOTAL AKUMULASI KELAS</td>
                <td class="text-center" style="color:#15803d;">${totH}</td>
                <td class="text-center" style="color:#0284c7;">${totQ}</td>
                <td class="text-center" style="color:#b45309;">${totT}</td>
                <td class="text-center" style="color:#1d4ed8;">${totS}</td>
                <td class="text-center" style="color:#7e22ce;">${totI}</td>
                <td class="text-center" style="color:#b91c1c;">${totA}</td>
                <td class="text-center">-</td>
            </tr>
        </tbody>
    </table>
    <p style="font-size: 9px; color: #64748b; margin-top: 4px;">
        * Keterangan Simbol: <b>[H]</b> Hadir Tepat Waktu | <b>[?]</b> Hadir Tanpa Scan Pulang | <b>[T]</b> Terlambat | <b>[S]</b> Sakit | <b>[I]</b> Izin | <b>[A]</b> Alfa / Tanpa Keterangan
    </p>
    <div class="ttd-grid">
        <div class="ttd-box">
            <p>Mengetahui,</p>
            <p style="font-weight: bold; margin-bottom: 55px;">Kepala ${sigs.schoolName}</p>
            <p style="font-weight: bold; text-decoration: underline; margin: 0;">${sigs.headmasterName || 'ADI SUTIGNYO, S.Pd.'}</p>
            <p style="margin: 2px 0 0; color: #475569;">NIP. ${sigs.headmasterNip || '196801211991031004'}</p>
        </div>
        <div class="ttd-box">
            <p>&nbsp;</p>
            <p style="font-weight: bold; margin-bottom: 55px;">${sigs.homeroomTitle || 'Wali Kelas ' + homeroomClass}</p>
            <p style="font-weight: bold; text-decoration: underline; margin: 0;">${sigs.homeroomName || '-'}</p>
            <p style="margin: 2px 0 0; color: #475569;">NIP. ${sigs.homeroomNip || '-'}</p>
        </div>
        <div class="ttd-box">
            <p>Boyolangu, ${todayId}</p>
            <p style="font-weight: bold; margin-bottom: 55px;">${sigs.bkCoordinatorTitle || 'Guru BK'}</p>
            <p style="font-weight: bold; text-decoration: underline; margin: 0;">${sigs.bkCoordinatorName || '-'}</p>
            <p style="margin: 2px 0 0; color: #475569;">NIP. ${sigs.bkCoordinatorNip || '-'}</p>
        </div>
    </div>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (error) {
        console.error('Error in exportWaliKelasPdf:', error);
        res.status(500).send('Gagal mengekspor laporan PDF');
    }
};

/**
 * 8. GET /api/teacher/wali-kelas/leave-requests & PUT /api/teacher/wali-kelas/verify-leave/:id
 * Izin siswa kelas binaan yang perlu diverifikasi wali kelas
 */
export const getWaliKelasLeaveRequests = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const homeroomClass = await resolveHomeroomClass(user);

        if (!homeroomClass) {
            return res.status(403).json({ success: false, message: 'Hanya dapat diakses oleh Wali Kelas.' });
        }

        const requests = await (prisma as any).studentLeaveRequest.findMany({
            where: { className: homeroomClass },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            homeroomClass,
            total: requests.length,
            requests
        });
    } catch (error) {
        console.error('Error in getWaliKelasLeaveRequests:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat daftar permohonan izin siswa' });
    }
};

export const verifyWaliKelasLeave = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const homeroomClass = await resolveHomeroomClass(user);
        const { id } = req.params;
        const { status = 'APPROVED', notes = '' } = req.body;

        const request = await (prisma as any).studentLeaveRequest.findUnique({
            where: { id }
        });

        if (!request) {
            return res.status(404).json({ success: false, message: 'Permohonan izin tidak ditemukan' });
        }

        if (homeroomClass && request.className !== homeroomClass) {
            return res.status(403).json({ success: false, message: 'Anda bukan wali kelas dari siswa ini.' });
        }

        const updated = await (prisma as any).studentLeaveRequest.update({
            where: { id },
            data: {
                status,
                verifiedBy: user.name,
                approvalNotes: notes,
                verifiedAt: new Date()
            }
        });

        res.json({
            success: true,
            message: `Permohonan izin ${status === 'APPROVED' ? 'disetujui' : 'ditolak'} oleh Wali Kelas.`,
            request: updated
        });
    } catch (error) {
        console.error('Error in verifyWaliKelasLeave:', error);
        res.status(500).json({ success: false, message: 'Gagal memproses verifikasi izin' });
    }
};
