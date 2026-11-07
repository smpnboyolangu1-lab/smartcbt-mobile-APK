import { Request, Response } from 'express';
import prisma from '../utils/db';
import { logAudit } from '../services/auditLogger';
import { sendFcmToUser } from '../services/fcmService';
import { checkStudentCommitteeRole } from '../utils/classCommittee';
import { formatTimeWibWithSuffix } from '../utils/dateUtils';

// 1. Pengurus Kelas Melaporkan Jam Kosong via APK (Terhubung Otomatis ke Guru Piket & Tim Kurikulum)
export const reportEmptyClass = async (req: Request, res: Response) => {
    try {
        const { className, periodLesson, subjectName, scheduledTeacher, teacherStatus, hasAssignment, assignmentDetails } = req.body;
        const user = (req as any).user;
        const reporterDisplay = `Pengurus Kelas ${className || user?.className || ''}`.trim();

        if (!className || !periodLesson || !subjectName || !scheduledTeacher) {
            return res.status(400).json({ message: 'Data laporan tidak lengkap' });
        }

        // Validasi Otorisasi: Hanya Pengurus Kelas (Ketua, Wakil, Sekretaris, Bendahara) yang berhak melapor
        if (user && user.role === 'STUDENT') {
            const committeeStatus = await checkStudentCommitteeRole(user.id, user.name || '', user.className || className);
            if (!committeeStatus.isCommittee && !user.classRole) {
                return res.status(403).json({
                    success: false,
                    message: '🚨 Akses Khusus: Pelaporan jam kosong guru ke posko piket hanya dapat diajukan oleh Pengurus Kelas (Ketua, Wakil, Sekretaris, Bendahara).'
                });
            }
        }

        // Batasi: Maksimal 1 Laporan per Kelas per Jam Pelajaran (Hari Ini)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existingReport = await prisma.emptyClassReport.findFirst({
            where: {
                className,
                periodLesson,
                createdAt: { gte: today },
                status: { in: ['PENDING', 'GURU_INVAL_ASSIGNED', 'TUGAS_MANDIRI'] }
            }
        });

        if (existingReport) {
            return res.status(400).json({
                success: false,
                alreadyReported: true,
                message: `⚠️ Laporan Dibatasi: Kelas ${className} pada jam ini (${periodLesson}) sudah dilaporkan dan sedang dalam penanganan terpadu Guru Piket & Kurikulum.`
            });
        }

        const report = await (prisma as any).emptyClassReport.create({
            data: {
                className,
                periodLesson,
                subjectName,
                scheduledTeacher,
                teacherStatus: (teacherStatus as any) || 'BELUM_HADIR',
                hasAssignment: hasAssignment || false,
                assignmentDetails: (assignmentDetails as any) || null,
                reporterName: reporterDisplay,
                status: 'PENDING'
            }
        });

        (report as any).reporterName = reporterDisplay;

        // Catat ke log monitoring kelas kosong Kurikulum
        try {
            await (prisma as any).kelasKosongLog.create({
                data: {
                    kelasNama: className,
                    guruNama: scheduledTeacher || 'Guru Terjadwal',
                    mapelId: subjectName || 'KBM',
                    jamMulai: periodLesson,
                    tanggal: new Date(),
                    status: 'KOSONG',
                    menitKosong: 10
                }
            });
        } catch (_) {}

        await logAudit(req, 'REPORT_EMPTY_CLASS', `Class: ${className}, Subject: ${subjectName}`, {
            periodLesson, scheduledTeacher, teacherStatus, hasAssignment
        });

        // Broadcast to TV Display via SSE
        global.emitEmptyClassUpdate && global.emitEmptyClassUpdate({
            type: 'EMPTY_CLASS_REPORTED',
            report
        });

        // Cari guru piket yang bertugas hari ini untuk dikirimkan notifikasi langsung ke HP mereka (In-App & FCM Push)
        try {
            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const wibDate = new Date(utc + (3600000 * 7));
            const currentDay = wibDate.getDay();

            const onDutyTeachers = await prisma.piketSchedule.findMany({
                where: {
                    dayOfWeek: currentDay,
                    isActive: true
                },
                include: { teacher: true }
            });

            for (const duty of onDutyTeachers) {
                const notifTitle = `⚠️ KELAS KOSONG: ${className}`;
                const notifMsg = `Pengurus Kelas melaporkan Jam ${periodLesson} (${subjectName}) - Guru: ${scheduledTeacher} (${teacherStatus}). Segera buka APK untuk tindakan Inval / Tugas.`;
                
                await prisma.notificationMessage.create({
                    data: {
                        recipientId: duty.teacherId,
                        recipientRole: 'TEACHER',
                        title: notifTitle,
                        message: notifMsg,
                        category: 'EMPTY_CLASS'
                    }
                });

                sendFcmToUser(duty.teacherId, notifTitle, notifMsg, {
                    type: 'EMPTY_CLASS',
                    className,
                    reportId: report.id
                }).catch(() => null);
            }

            // Kirim notifikasi otomatis terhubung langsung ke Tim Kurikulum & Manajemen
            const kurikulumUsers = await (prisma as any).user.findMany({
                where: {
                    OR: [
                        { role: 'KURIKULUM' },
                        { role: 'ADMIN' },
                        { tugasTambahan: { contains: 'KURIKULUM' } }
                    ]
                },
                select: { id: true }
            });

            for (const kur of kurikulumUsers) {
                const kurTitle = `🏛️ LAPORAN KURIKULUM: Kelas Kosong ${className}`;
                const kurMsg = `Pengurus kelas melaporkan jam ${periodLesson} (${subjectName}) - Guru: ${scheduledTeacher} (${teacherStatus}). Laporan terhubung otomatis ke Posko Piket & Kurikulum.`;
                
                await prisma.notificationMessage.create({
                    data: {
                        recipientId: kur.id,
                        recipientRole: 'TEACHER',
                        title: kurTitle,
                        message: kurMsg,
                        category: 'KURIKULUM_EMPTY_CLASS'
                    }
                });

                sendFcmToUser(kur.id, kurTitle, kurMsg, {
                    type: 'KURIKULUM_EMPTY_CLASS',
                    className,
                    reportId: report.id
                }).catch(() => null);
            }
        } catch (notifErr) {
            console.error('Failed sending empty class notif:', notifErr);
        }

        res.json({
            success: true,
            message: 'Laporan jam kosong berhasil dikirim ke Guru Piket & Tim Kurikulum.',
            report
        });
    } catch (error) {
        console.error('Error reporting empty class:', error);
        res.status(500).json({ message: 'Gagal mengirim laporan kelas kosong' });
    }
};

// 1.B Cek Status Laporan Jam Kosong Kelas & Status Guru Netral
export const getEmptyClassStatus = async (req: Request, res: Response) => {
    try {
        const className = (req.query.className as string) || (req as any).user?.className;
        const periodLesson = req.query.periodLesson as string;

        if (!className) {
            return res.status(400).json({ message: 'className wajib disediakan' });
        }

        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const wib = new Date(utc + (3600000 * 7));
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const currentDay = days[wib.getDay()];
        const curHours = String(wib.getHours()).padStart(2, '0');
        const curMins = String(wib.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${curHours}:${curMins}`;

        const todayStart = new Date(wib);
        todayStart.setHours(0, 0, 0, 0);

        // 1. Cek sesi KBM aktif di kelas
        const activeSession = await (prisma as any).classPeriodSession.findFirst({
            where: {
                className: { equals: className },
                status: 'ACTIVE',
                inTime: { gte: todayStart }
            }
        }).catch(() => null);

        const activeTeaching = await (prisma as any).teachingSession.findFirst({
            where: {
                className: { equals: className },
                status: 'IN_PROGRESS',
                checkInTime: { gte: todayStart }
            },
            include: { teacher: { select: { id: true, name: true } } }
        }).catch(() => null);

        const isTeacherInClass = !!(activeSession || activeTeaching);
        const currentTeacherName = activeSession?.teacherName || activeTeaching?.teacher?.name || '';
        const currentSubject = activeSession?.subjectName || activeTeaching?.subjectName || '';

        // 2. Ambil jadwal hari ini untuk kelas ini jika tidak ada sesi aktif
        let scheduledTeacher = currentTeacherName;
        let scheduledSubject = currentSubject;
        let scheduledPeriod = periodLesson || '';

        if (!isTeacherInClass) {
            // Cari jadwal KBM yang sedang aktif saat ini (antara startTime dan endTime)
            let matchingSchedule = await (prisma as any).classPeriodSchedule.findFirst({
                where: {
                    className: { equals: className },
                    day: currentDay,
                    isBreak: false,
                    startTime: { lte: currentTimeStr },
                    endTime: { gte: currentTimeStr }
                }
            }).catch(() => null);

            // Jika belum ada yang persis saat ini, cari jadwal terdekat hari ini
            if (!matchingSchedule) {
                const todaySchedules = await (prisma as any).classPeriodSchedule.findMany({
                    where: {
                        className: { equals: className },
                        day: currentDay,
                        isBreak: false
                    },
                    orderBy: { startTime: 'asc' }
                }).catch(() => []);

                for (const sch of todaySchedules) {
                    if (sch.startTime <= currentTimeStr && sch.endTime >= currentTimeStr) {
                        matchingSchedule = sch;
                        break;
                    }
                }

                // Jika di jam KBM sekolah (07:00 - 15:00) dan belum lewat, ambil jadwal pertama yang belum selesai
                if (!matchingSchedule && todaySchedules.length > 0 && currentTimeStr >= '07:00' && currentTimeStr <= '15:30') {
                    matchingSchedule = todaySchedules.find((s: any) => s.endTime >= currentTimeStr) || null;
                }
            }

            if (matchingSchedule) {
                scheduledTeacher = matchingSchedule.teacherName || '';
                scheduledSubject = matchingSchedule.subjectName || '';
                scheduledPeriod = `Jam ke-${matchingSchedule.periodIndex} (${matchingSchedule.startTime} - ${matchingSchedule.endTime})`;
            } else {
                // Cek juga ke tabel TeachingSchedule
                const dayUpper = currentDay.toUpperCase();
                const teachingSched = await (prisma as any).teachingSchedule.findFirst({
                    where: {
                        kelasId: { equals: className },
                        hari: dayUpper,
                        jamMulai: { lte: currentTimeStr },
                        jamSelesai: { gte: currentTimeStr }
                    }
                }).catch(() => null);

                if (teachingSched) {
                    const guru = await (prisma as any).user.findUnique({
                        where: { id: teachingSched.guruId },
                        select: { name: true }
                    }).catch(() => null);

                    scheduledTeacher = guru?.name || '';
                    scheduledSubject = teachingSched.mapelId || '';
                    scheduledPeriod = `Jam KBM (${teachingSched.jamMulai} - ${teachingSched.jamSelesai})`;
                } else if (currentTimeStr >= '07:00' && currentTimeStr <= '15:30') {
                    // Cari jadwal KBM terdekat hari ini yang belum selesai
                    const nextTeaching = await (prisma as any).teachingSchedule.findFirst({
                        where: {
                            kelasId: { equals: className },
                            hari: dayUpper,
                            jamSelesai: { gte: currentTimeStr }
                        },
                        orderBy: { jamMulai: 'asc' }
                    }).catch(() => null);

                    if (nextTeaching) {
                        const guru = await (prisma as any).user.findUnique({
                            where: { id: nextTeaching.guruId },
                            select: { name: true }
                        }).catch(() => null);

                        scheduledTeacher = guru?.name || '';
                        scheduledSubject = nextTeaching.mapelId || '';
                        scheduledPeriod = `Jam KBM (${nextTeaching.jamMulai} - ${nextTeaching.jamSelesai})`;
                    } else {
                        // Sesuai instruksi: jika kosong belum ada jadwal kosongkan dahulu
                        scheduledTeacher = '';
                        scheduledSubject = '';
                        scheduledPeriod = '';
                    }
                } else {
                    // Di luar jam KBM atau hari libur: kosongkan dahulu
                    scheduledTeacher = '';
                    scheduledSubject = '';
                    scheduledPeriod = '';
                }
            }
        }

        // 3. Cek apakah ada laporan jam kosong pending hari ini
        const whereCondition: any = {
            className: { equals: className },
            createdAt: { gte: todayStart },
            status: { in: ['PENDING', 'GURU_INVAL_ASSIGNED', 'TUGAS_MANDIRI'] }
        };
        if (periodLesson) {
            whereCondition.periodLesson = periodLesson;
        }

        const report = await prisma.emptyClassReport.findFirst({
            where: whereCondition,
            orderBy: { createdAt: 'desc' }
        });

        const todayReports = await prisma.emptyClassReport.findMany({
            where: {
                className: { equals: className },
                createdAt: { gte: todayStart }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        res.json({
            success: true,
            className,
            isTeacherInClass,
            teacherStatusLabel: isTeacherInClass ? 'Sedang di Kelas' : 'Belum Masuk Kelas',
            teacherName: scheduledTeacher || '',
            subjectName: scheduledSubject || '',
            periodLesson: scheduledPeriod || '',
            isReported: !!report,
            report: report || null,
            recentReports: todayReports.map(r => ({
                id: r.id,
                periodLesson: r.periodLesson,
                subjectName: r.subjectName,
                scheduledTeacher: r.scheduledTeacher,
                status: r.status,
                reporterName: r.reporterName || `Pengurus Kelas ${r.className}`,
                substituteTeacher: r.substituteTeacher || null,
                assignmentDetails: r.assignmentDetails || null,
                handledBy: r.handledBy || null,
                createdAt: r.createdAt
            })),
            message: report
                ? `Laporan jam kosong untuk kelas ${className} sedang dalam penanganan Guru Piket.`
                : (isTeacherInClass ? `Guru mata pelajaran sedang berada di kelas.` : `Guru belum masuk kelas.`)
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memeriksa status laporan kelas' });
    }
};


// 1.C Monitoring Real-Time Status Seluruh Kelas (HIJAU jika Guru Hadir, MERAH jika Laporan Siswa / > 10 Menit Kosong)
export const getClassMonitoringStatus = async (req: Request, res: Response) => {
    try {
        const now = new Date();
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const currentDay = days[now.getDay()];
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        // Ambil semua daftar kelas aktif
        const dbClasses = await prisma.class.findMany({
            orderBy: { name: 'asc' }
        });
        const defaultClassNames = [
            'VII-A', 'VII-B', 'VII-C', 'VII-D', 'VII-E', 'VII-F', 'VII-G', 'VII-H', 'VII-I', 'VII-J', 'VII-K',
            'VIII-A', 'VIII-B', 'VIII-C', 'VIII-D', 'VIII-E', 'VIII-F', 'VIII-G', 'VIII-H', 'VIII-I', 'VIII-J', 'VIII-K',
            'IX-A', 'IX-B', 'IX-C', 'IX-D', 'IX-E', 'IX-F', 'IX-G', 'IX-H', 'IX-I', 'IX-J', 'IX-K'
        ];
        const classNames = dbClasses.length >= 33 ? dbClasses.map(c => c.name) : defaultClassNames;

        // Ambil sesi KBM aktif hari ini dari classPeriodSession
        const activeSessions = await (prisma as any).classPeriodSession.findMany({
            where: {
                status: 'ACTIVE',
                inTime: { gte: todayStart }
            }
        });

        // Ambil sesi KBM aktif hari ini dari teachingSession (Scan QR Ruangan / Manual Check-in)
        const activeTeachingSessions = await (prisma as any).teachingSession.findMany({
            where: {
                status: 'IN_PROGRESS',
                checkInTime: { gte: todayStart }
            },
            include: {
                teacher: { select: { id: true, name: true } },
                room: true
            }
        }).catch(() => []);

        // Ambil izin guru yang disetujui hari ini
        const approvedTeacherLeaves = await (prisma as any).teacherLeaveRequest.findMany({
            where: {
                status: 'APPROVED',
                startDate: { lte: now },
                endDate: { gte: todayStart }
            }
        }).catch(() => []);
        const leaveTeacherNames = new Set(approvedTeacherLeaves.map((l: any) => (l.teacherName || '').toLowerCase()));

        // Ambil laporan jam kosong hari ini
        const emptyReports = await prisma.emptyClassReport.findMany({
            where: {
                createdAt: { gte: todayStart }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Ambil jadwal pelajaran hari ini
        const [schedulesToday, homeroomTeachers, allSchedules] = await Promise.all([
            (prisma as any).classPeriodSchedule.findMany({
                where: {
                    day: currentDay,
                    isBreak: false
                }
            }),
            prisma.user.findMany({
                where: {
                    role: { in: ['TEACHER', 'GURU', 'WALI_KELAS'] },
                    className: { not: null }
                },
                select: { id: true, name: true, className: true }
            }),
            (prisma as any).classPeriodSchedule.findMany({
                where: { isBreak: false },
                orderBy: { periodIndex: 'asc' }
            })
        ]);
        const walasMap = new Map<string, string>(homeroomTeachers.map(t => [t.className!.toUpperCase(), t.name]));

        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTotalMinutes = currentHour * 60 + currentMinute;

        const results = classNames.map((clsName, idx) => {
            const camNumber = String(idx + 1).padStart(2, '0');

            // 1. Cek Sesi KBM Aktif (Guru Hadir di Kelas)
            const session = activeSessions.find((s: any) => s.className && s.className.toUpperCase() === clsName.toUpperCase());
            const teachingSess = activeTeachingSessions.find((ts: any) => 
                (ts.className && ts.className.toUpperCase() === clsName.toUpperCase()) ||
                (ts.room?.className && ts.room.className.toUpperCase() === clsName.toUpperCase())
            );

            if (session || teachingSess) {
                const teacherName = session?.teacherName || teachingSess?.teacher?.name || 'Guru Pengampu';
                const subjectName = session?.subjectName || teachingSess?.subjectName || 'Mata Pelajaran';
                const checkInDate = session ? session.inTime : teachingSess.checkInTime;
                const checkInTimeFormatted = formatTimeWibWithSuffix(checkInDate);

                return {
                    className: clsName,
                    cam: `CAM ${camNumber}`,
                    status: 'GREEN',
                    badge: 'NORMAL (TERISI & GURU HADIR)',
                    isAlarm: false,
                    teacherName,
                    subjectName,
                    periodIndex: session?.periodIndex || 1,
                    timeRange: session?.timeRange || `${session?.startTimeStr || ''} - ${session?.endTimeStr || ''}`,
                    inTime: checkInDate,
                    checkInTime: checkInTimeFormatted,
                    inTimeStr: checkInTimeFormatted,
                    details: `Guru Hadir pukul ${checkInTimeFormatted}`
                };
            }

            // 2. Cek Laporan Siswa Jam Kosong yang PENDING
            const pendingReport = emptyReports.find(r => r.className && r.className.toUpperCase() === clsName.toUpperCase() && r.status === 'PENDING');
            if (pendingReport) {
                const repBy = (pendingReport as any).reporterName || `Ketua Kelas ${clsName}`;
                return {
                    className: clsName,
                    cam: `CAM ${camNumber}`,
                    status: 'RED',
                    badge: 'KELAS KOSONG! (LAPORAN SISWA)',
                    isAlarm: true,
                    alarmReason: 'STUDENT_REPORTED',
                    teacherName: pendingReport.scheduledTeacher,
                    subjectName: pendingReport.subjectName,
                    periodIndex: pendingReport.periodLesson,
                    reportId: pendingReport.id,
                    reportedBy: repBy,
                    hasAssignment: pendingReport.hasAssignment,
                    assignmentDetails: pendingReport.assignmentDetails,
                    details: `Laporan oleh ${repBy}: Guru ${pendingReport.scheduledTeacher} (${pendingReport.teacherStatus})`
                };
            }

            // 3. Cek Laporan Siswa yang Sedang Ditangani (INVAL)
            const handledReport = emptyReports.find(r => r.className && r.className.toUpperCase() === clsName.toUpperCase() && r.status !== 'PENDING' && r.status !== 'RESOLVED');
            if (handledReport) {
                return {
                    className: clsName,
                    cam: `CAM ${camNumber}`,
                    status: 'BLUE',
                    badge: 'DITANGANI GURU INVAL',
                    isAlarm: false,
                    teacherName: handledReport.substituteTeacher || 'Guru Piket',
                    subjectName: handledReport.subjectName,
                    periodIndex: handledReport.periodLesson,
                    details: `Guru Inval ${handledReport.substituteTeacher} menggantikan ${handledReport.scheduledTeacher}`
                };
            }

            // 4. Cek Jadwal Hari Ini: Jika Jadwal Sedang Berjalan dan Lewat 10 Menit Tanpa Guru -> Otomatis MERAH!
            const classSchedules = schedulesToday.filter((s: any) => s.className && s.className.toUpperCase() === clsName.toUpperCase());
            for (const sch of classSchedules) {
                if (sch.startTime && sch.endTime && sch.startTime.includes(':') && sch.endTime.includes(':')) {
                    const [sH, sM] = sch.startTime.split(':').map(Number);
                    const [eH, eM] = sch.endTime.split(':').map(Number);
                    const startTotal = sH * 60 + sM;
                    const endTotal = eH * 60 + eM;

                    if (currentTotalMinutes >= startTotal && currentTotalMinutes <= endTotal) {
                        const elapsedMinutes = currentTotalMinutes - startTotal;
                        const isTeacherOnLeave = sch.teacherName && leaveTeacherNames.has(sch.teacherName.toLowerCase());
                        if (isTeacherOnLeave) {
                            return {
                                className: clsName,
                                cam: `CAM ${camNumber}`,
                                status: 'BLUE',
                                badge: 'GURU IZIN RESMI (DISPOSISI PIKET)',
                                isAlarm: false,
                                elapsedMinutes,
                                teacherName: sch.teacherName,
                                subjectName: sch.subjectName || 'Mata Pelajaran',
                                periodIndex: `JP ${sch.periodIndex || 1}`,
                                timeRange: `${sch.startTime} - ${sch.endTime}`,
                                details: `Guru ${sch.teacherName} tercatat izin resmi/sakit hari ini. Menunggu tindak lanjut Guru Piket/Inval.`
                            };
                        }

                        // Sesuai aturan sekolah: Begitu jam KBM berjalan dan guru belum ngetab presensi kelas -> Otomatis KELAS KOSONG (MERAH)!
                        return {
                            className: clsName,
                            cam: `CAM ${camNumber}`,
                            status: 'RED',
                            badge: 'KELAS KOSONG! (GURU BELUM NGETAP PRESENSI)',
                            isAlarm: true,
                            alarmReason: 'TEACHER_NOT_CHECKED_IN',
                            elapsedMinutes,
                            teacherName: sch.teacherName || 'Belum Terisi',
                            subjectName: sch.subjectName || 'Mata Pelajaran',
                            periodIndex: `JP ${sch.periodIndex || 1}`,
                            timeRange: `${sch.startTime} - ${sch.endTime}`,
                            details: `Jadwal KBM dimulai pukul ${sch.startTime} (${elapsedMinutes} menit lalu). Guru ${sch.teacherName || ''} belum melakukan presensi tap di kelas.`
                        };
                    }
                }
            }

            // 5. Default / Di Luar Jam KBM: Ambil jadwal hari ini untuk kelas ini agar data selalu terisi & dinamis
            const anyTodaySchedule = classSchedules[classSchedules.length - 1] || classSchedules[0];
            if (anyTodaySchedule) {
                return {
                    className: clsName,
                    cam: `CAM ${camNumber}`,
                    status: 'GREEN',
                    badge: 'KBM HARI INI TUNTAS',
                    isAlarm: false,
                    teacherName: anyTodaySchedule.teacherName || 'Guru Terjadwal',
                    subjectName: anyTodaySchedule.subjectName || 'Mata Pelajaran',
                    periodIndex: `JP ${anyTodaySchedule.periodIndex || 1}`,
                    timeRange: `${anyTodaySchedule.startTime || '07:00'} - ${anyTodaySchedule.endTime || '14:00'}`,
                    details: `Status KBM kelas tuntas & kondusif. Mapel: ${anyTodaySchedule.subjectName || 'Reguler'} (${anyTodaySchedule.teacherName || 'Guru Pengampu'}).`
                };
            }

            const walasName = walasMap.get(clsName.toUpperCase()) || `Wali Kelas ${clsName}`;
            const anySchedule = allSchedules.find((s: any) => s.className && s.className.toUpperCase() === clsName.toUpperCase());

            if (currentDay === 'Minggu' || currentDay === 'Sabtu') {
                return {
                    className: clsName,
                    cam: `CAM ${camNumber}`,
                    status: 'GREEN',
                    badge: 'HARI LIBUR (TIDAK ADA KBM)',
                    isAlarm: false,
                    teacherName: walasName,
                    subjectName: 'Libur Akhir Pekan',
                    periodIndex: 'Libur',
                    timeRange: '-',
                    details: `KBM ditiadakan (Hari Libur Akhir Pekan). Ruang kelas dalam pengawasan wali kelas (${walasName}).`
                };
            }

            if (anySchedule) {
                return {
                    className: clsName,
                    cam: `CAM ${camNumber}`,
                    status: 'GREEN',
                    badge: 'KBM KONDUSIF',
                    isAlarm: false,
                    teacherName: anySchedule.teacherName || walasName,
                    subjectName: anySchedule.subjectName || 'Bimbingan Akademik',
                    periodIndex: `JP ${anySchedule.periodIndex || 1}`,
                    timeRange: anySchedule.startTime && anySchedule.endTime ? `${anySchedule.startTime} - ${anySchedule.endTime}` : '07:00 - 14:00',
                    details: `Status KBM kelas ${clsName} tertib & kondusif. Mapel terdaftar: ${anySchedule.subjectName || 'Akademik'} (${anySchedule.teacherName || walasName}).`
                };
            }

            return {
                className: clsName,
                cam: `CAM ${camNumber}`,
                status: 'GREEN',
                badge: 'KBM TERKENDALI',
                isAlarm: false,
                teacherName: walasName,
                subjectName: 'Pembinaan Kelas',
                periodIndex: 'JP Reguler',
                timeRange: '07:00 - 14:00',
                details: `Ruang kelas tertib dalam pengawasan Wali Kelas (${walasName}).`
            };
        });

        res.json({
            success: true,
            currentTime: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            currentDay,
            totalClasses: results.length,
            classes: results
        });
    } catch (error) {
        console.error('Error fetching class monitoring status:', error);
        res.status(500).json({ message: 'Gagal memuat status monitoring kelas' });
    }
};

// 2. Mengambil Laporan Hari Ini (Untuk TV Display / Piket Dashboard)
export const getEmptyClassReports = async (req: Request, res: Response) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const reports = await prisma.emptyClassReport.findMany({
            where: {
                createdAt: {
                    gte: today
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(reports);
    } catch (error) {
        console.error('Error fetching empty class reports:', error);
        res.status(500).json({ message: 'Gagal memuat laporan' });
    }
};

// 3. Guru Piket / Kurikulum Mengambil Tindakan (Klaim Inval)
export const handleEmptyClass = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { substituteTeacher, actionType, substituteNotes } = req.body; // actionType = 'GURU_INVAL_ASSIGNED' or 'TUGAS_MANDIRI'
        const user = (req as any).user;

        const report = await prisma.emptyClassReport.findUnique({ where: { id: id as string } });
        if (!report) return res.status(404).json({ message: 'Laporan tidak ditemukan' });

        const updated = await prisma.emptyClassReport.update({
            where: { id: id as string },
            data: {
                status: (actionType as any) || 'GURU_INVAL_ASSIGNED',
                substituteTeacher: (substituteTeacher as any) || (user ? user.name : null),
                substituteNotes: (substituteNotes as any) || null,
                handledBy: user ? user.name : 'Tim Kurikulum',
                handledAt: new Date()
            }
        });

        // Catat ke Jurnal Guru Terjadwal secara otomatis (Opsional)
        // Disini kita bisa buat record di TeacherJournal

        await logAudit(req, 'HANDLE_EMPTY_CLASS', `Class: ${report.className}, Inval: ${updated.substituteTeacher}`, {
            actionType, substituteTeacher
        });

        // Broadcast to TV Display via SSE
        global.emitEmptyClassUpdate && global.emitEmptyClassUpdate(updated);

        res.json({
            success: true,
            message: `Kelas berhasil ditangani. Guru Inval: ${updated.substituteTeacher}`,
            report: updated
        });
    } catch (error) {
        console.error('Error handling empty class:', error);
        res.status(500).json({ message: 'Gagal menindaklanjuti laporan' });
    }
};

/**
 * 3.B Menyelesaikan Status Laporan Jam Kosong (RESOLVED)
 */
export const resolveEmptyClass = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { resolutionNotes } = req.body;
        const user = (req as any).user;

        const report = await prisma.emptyClassReport.findUnique({ where: { id: id as string } });
        if (!report) return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });

        const updated = await prisma.emptyClassReport.update({
            where: { id: id as string },
            data: {
                status: 'RESOLVED',
                substituteNotes: resolutionNotes || report.substituteNotes,
                handledBy: user ? user.name : 'Guru Piket / Kurikulum',
                handledAt: new Date()
            }
        });

        await logAudit(req, 'RESOLVE_EMPTY_CLASS', `Class: ${report.className} resolved`, { resolutionNotes });
        global.emitEmptyClassUpdate && global.emitEmptyClassUpdate(updated);

        res.json({
            success: true,
            message: `✅ Status laporan kelas ${report.className} berhasil diselesaikan (RESOLVED).`,
            report: updated
        });
    } catch (error: any) {
        console.error('Error resolving empty class:', error);
        res.status(500).json({ success: false, message: 'Gagal menyelesaikan laporan kelas' });
    }
};

// 4. SSE Stream untuk Display Monitor Ruang Guru
export const streamEmptyClassMonitor = (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const initialData = JSON.stringify({ type: 'CONNECTED' });
    res.write(`data: ${initialData}\n\n`);

    const listener = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (!global.emptyClassClients) global.emptyClassClients = [];
    global.emptyClassClients.push(listener);

    req.on('close', () => {
        global.emptyClassClients = global.emptyClassClients.filter(l => l !== listener);
    });
};

// Global emitter function
declare global {
    var emptyClassClients: ((data: any) => void)[];
    var emitEmptyClassUpdate: (report: any) => void;
}
if (!global.emitEmptyClassUpdate) {
    global.emitEmptyClassUpdate = (report: any) => {
        if (global.emptyClassClients) {
            global.emptyClassClients.forEach(client => client({ type: 'UPDATE', report }));
        }
    };
}

// 7. Guru Piket meneruskan laporan kelas kosong ke Tim Kurikulum
export const forwardEmptyClassToKurikulum = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        const user = (req as any).user;

        const report = await (prisma as any).emptyClassReport.findUnique({
            where: { id }
        });

        if (!report) {
            return res.status(404).json({ success: false, message: 'Laporan kelas tidak ditemukan' });
        }

        // Cari Tim Kurikulum
        const kurikulumUsers = await (prisma as any).user.findMany({
            where: {
                OR: [
                    { role: 'KURIKULUM' },
                    { role: 'ADMIN' },
                    { tugasTambahan: { contains: 'KURIKULUM' } }
                ]
            },
            select: { id: true }
        });

        const fwdNote = notes ? `Catatan Piket (${user?.name || 'Petugas'}): ${notes}` : `Diteruskan oleh Guru Piket (${user?.name || 'Petugas'}) untuk koordinasi inval/pengganti.`;

        for (const kur of kurikulumUsers) {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientId: kur.id,
                    recipientRole: 'TEACHER',
                    title: `🏛️ DISPOSISI KURIKULUM: Kelas Kosong ${report.className}`,
                    message: `Kelas ${report.className} - Jam ${report.periodLesson} (${report.subjectName}). Guru: ${report.scheduledTeacher}.\n${fwdNote}`,
                    category: 'KURIKULUM_EMPTY_CLASS'
                }
            });
        }

        const updated = await (prisma as any).emptyClassReport.update({
            where: { id },
            data: {
                status: 'FORWARDED_KURIKULUM',
                handledBy: user?.name ? `${user.name} (Guru Piket)` : 'Guru Piket',
                handledAt: new Date(),
                substituteNotes: fwdNote
            }
        });

        // Broadcast perubahan status ke monitor
        global.emitEmptyClassUpdate && global.emitEmptyClassUpdate(updated);

        res.json({
            success: true,
            message: `Laporan kelas ${report.className} berhasil diteruskan secara resmi ke Tim Kurikulum.`,
            report: updated
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal meneruskan ke kurikulum: ' + error.message });
    }
};


/**
 * 4. Rekomendasi Cerdas Guru Pengganti / Guru Badal (Smart Teacher Substitution)
 * Mengidentifikasi guru piket hari ini yang sedang bebas jam mengajar (standby)
 * dan memprioritaskan rumpun mata pelajaran yang relevan.
 */
export const getSmartSubstitutionCandidates = async (req: Request, res: Response) => {
    try {
        const { className, periodLesson, subjectName } = req.query;

        // Tentukan hari ini (WIB)
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const wib = new Date(utc + (3600000 * 7));
        const dayOfWeek = wib.getDay(); // 0: Minggu, 1: Senin, dst.
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const currentDayName = dayNames[dayOfWeek];

        // 1. Ambil guru piket aktif hari ini
        const piketDuties = await prisma.piketSchedule.findMany({
            where: {
                dayOfWeek,
                isActive: true
            },
            include: {
                teacher: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        teachingSubject: true,
                        teachingClasses: true
                    }
                }
            }
        });

        // 2. Ambil jadwal mengajar pada hari ini untuk memeriksa apakah guru sedang mengajar di kelas lain
        let periodIndices: number[] = [];
        if (typeof periodLesson === 'string') {
            const matches = periodLesson.match(/\d+/g);
            if (matches) {
                periodIndices = matches.map(n => parseInt(n, 10));
            }
        }

        const busySchedules = await prisma.classPeriodSchedule.findMany({
            where: {
                day: currentDayName,
                ...(periodIndices.length > 0 ? { periodIndex: { in: periodIndices } } : {})
            },
            select: {
                teacherId: true,
                teacherName: true,
                className: true,
                subjectName: true,
                periodIndex: true
            }
        });

        const busyTeacherIds = new Set(busySchedules.map(s => s.teacherId).filter(Boolean));
        const busyTeacherMap = new Map<string, any>();
        busySchedules.forEach(s => {
            if (s.teacherId) {
                busyTeacherMap.set(s.teacherId, s);
            }
        });

        // 3. Klasifikasi Rumpun Mata Pelajaran
        const subjectClusterMap: Record<string, string[]> = {
            'MIPA': ['Matematika', 'IPA', 'Ilmu Pengetahuan Alam', 'Fisika', 'Biologi', 'Informatika'],
            'BAHASA': ['Bahasa Indonesia', 'Bahasa Inggris', 'Bahasa Jawa'],
            'IPS_HUMANIORA': ['IPS', 'Ilmu Pengetahuan Sosial', 'PPKn', 'Pendidikan Pancasila', 'Sejarah', 'Pendidikan Agama Islam', 'PAI'],
            'SENI_OR': ['PJOK', 'Pendidikan Jasmani', 'Seni Budaya', 'Prakarya', 'BK']
        };

        const targetSubj = String(subjectName || '').toLowerCase();
        let targetCluster = 'UMUM';
        for (const [cluster, subjects] of Object.entries(subjectClusterMap)) {
            if (subjects.some(s => targetSubj.includes(s.toLowerCase()) || s.toLowerCase().includes(targetSubj))) {
                targetCluster = cluster;
                break;
            }
        }

        // 4. Analisis & Skoring Kandidat
        const candidates = piketDuties.map(duty => {
            const t = duty.teacher;
            const isBusy = busyTeacherIds.has(t.id);
            const busyInfo = isBusy ? busyTeacherMap.get(t.id) : null;
            const teacherSubj = (t.teachingSubject || '').toLowerCase();

            let matchLevel = 'UMUM';
            let priorityScore = 10;

            if (targetSubj && teacherSubj && (teacherSubj.includes(targetSubj) || targetSubj.includes(teacherSubj))) {
                matchLevel = 'SAMA';
                priorityScore += 40;
            } else if (targetCluster !== 'UMUM') {
                const clusterSubjects = subjectClusterMap[targetCluster] || [];
                if (clusterSubjects.some(s => teacherSubj.includes(s.toLowerCase()))) {
                    matchLevel = 'SERUMPUN';
                    priorityScore += 25;
                }
            }

            if (!isBusy) {
                priorityScore += 50;
            } else {
                priorityScore -= 30;
            }

            return {
                teacherId: t.id,
                name: t.name,
                nip: t.username,
                subject: t.teachingSubject || 'Guru Mata Pelajaran',
                classes: t.teachingClasses || '-',
                piketHours: `${duty.startTime || '07:00'} - ${duty.endTime || '14:00'}`,
                piketNotes: duty.notes,
                isStandby: !isBusy,
                conflict: isBusy ? `Sedang mengajar di ${busyInfo?.className || 'kelas lain'} (${busyInfo?.subjectName || 'KBM'}) Jam ke-${busyInfo?.periodIndex || ''}` : null,
                matchLevel,
                priorityScore,
                recommendation: !isBusy ? (matchLevel === 'SAMA' ? 'Sangat Direkomendasikan (Standby & Guru Sebidang)' : (matchLevel === 'SERUMPUN' ? 'Direkomendasikan (Standby & Rumpun Terkait)' : 'Siap Ditugaskan (Guru Piket Standby)')) : 'Kurang Disarankan (Sedang Mengajar)'
            };
        });

        candidates.sort((a, b) => b.priorityScore - a.priorityScore);

        res.json({
            success: true,
            currentDay: currentDayName,
            targetClass: className || '-',
            targetPeriod: periodLesson || '-',
            targetSubject: subjectName || '-',
            targetCluster,
            totalPiketOnDuty: piketDuties.length,
            availableStandbyCount: candidates.filter(c => c.isStandby).length,
            candidates
        });
    } catch (error: any) {
        console.error('Error getting smart substitution candidates:', error);
        res.status(500).json({ success: false, message: 'Gagal menganalisis kandidat guru pengganti: ' + error.message });
    }
};

/**
 * 5. Distribusi Tugas Mandiri Darurat Siswa (Emergency Assignment Delivery)
 * Membagikan instruksi tugas langsung ke seluruh siswa di kelas dan memutakhirkan TV monitor
 */
export const dispatchEmergencyAssignment = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            reportId,
            className,
            periodLesson,
            subjectName,
            assignmentTitle,
            instructions,
            dueDate,
            attachmentUrl
        } = req.body;

        if (!className || !instructions) {
            return res.status(400).json({ success: false, message: 'Nama kelas dan instruksi tugas mandiri wajib diisi' });
        }

        const resolvedTitle = assignmentTitle || `Tugas Mandiri ${subjectName || 'KBM'} (${periodLesson || 'Jam Pelajaran'})`;
        const senderName = user?.name ? `${user.name} (${user.role === 'TEACHER' ? 'Guru' : 'Piket/Kurikulum'})` : 'Posko Piket & Kurikulum';

        // 1. Perbarui EmptyClassReport jika reportId tersedia
        let report = null;
        if (reportId) {
            report = await (prisma as any).emptyClassReport.update({
                where: { id: reportId },
                data: {
                    status: 'TUGAS_MANDIRI',
                    hasAssignment: true,
                    assignmentDetails: `${resolvedTitle}: ${instructions}`,
                    substituteTeacher: `Tugas Mandiri Disupervisi oleh ${senderName}`,
                    substituteNotes: instructions,
                    handledBy: user?.name || 'Guru Piket',
                    handledAt: new Date()
                }
            });
        }

        // 2. Kirim pesan notifikasi darurat ke seluruh siswa di kelas tersebut
        const studentsInClass = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                className: { equals: className }
            },
            select: { id: true, name: true }
        });

        const notifTitle = `📝 TUGAS MANDIRI KELAS ${className}: ${resolvedTitle}`;
        const notifMsg = `Instruksi dari ${senderName}:\n"${instructions}"\nHarap dikerjakan dengan tertib di ruang kelas selama jam pelajaran berlangsung.`;

        for (const s of studentsInClass) {
            await prisma.notificationMessage.create({
                data: {
                    recipientId: s.id,
                    recipientRole: 'STUDENT',
                    studentId: s.id,
                    studentName: s.name,
                    className,
                    title: notifTitle,
                    message: notifMsg,
                    category: 'HOMEWORK'
                }
            });

            sendFcmToUser(s.id, notifTitle, notifMsg, {
                type: 'EMERGENCY_ASSIGNMENT',
                className,
                reportId: reportId || ''
            }).catch(() => null);
        }

        // 3. Broadcast ke display TV koridor via SSE
        if (report) {
            global.emitEmptyClassUpdate && global.emitEmptyClassUpdate(report);
        }

        res.json({
            success: true,
            message: `Tugas mandiri berhasil didistribusikan ke seluruh siswa Kelas ${className} (${studentsInClass.length} siswa).`,
            recipientsCount: studentsInClass.length,
            report
        });
    } catch (error: any) {
        console.error('Error dispatching emergency assignment:', error);
        res.status(500).json({ success: false, message: 'Gagal mendistribusikan tugas mandiri: ' + error.message });
    }
};
