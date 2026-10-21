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
        const defaultClassNames = ['VII-A', 'VII-B', 'VII-C', 'VII-D', 'VII-E', 'VII-F', 'VII-G', 'VII-H', 'VII-I', 'VII-J', 'VII-K'];
        const classNames = dbClasses.length > 0 ? dbClasses.map(c => c.name) : defaultClassNames;

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

                        if (elapsedMinutes >= 10) {
                            // LEBIH DARI 10 MENIT GURU BELUM HADIR -> OTOMATIS MERAH!
                            return {
                                className: clsName,
                                cam: `CAM ${camNumber}`,
                                status: 'RED',
                                badge: 'KELAS KOSONG! (GURU BELUM HADIR > 10 MENIT)',
                                isAlarm: true,
                                alarmReason: 'TIMEOUT_10_MINUTES',
                                elapsedMinutes,
                                teacherName: sch.teacherName || 'Belum Terisi',
                                subjectName: sch.subjectName || 'Mata Pelajaran',
                                periodIndex: `JP ${sch.periodIndex || 1}`,
                                timeRange: `${sch.startTime} - ${sch.endTime}`,
                                details: `Jadwal dimulai pukul ${sch.startTime} (${elapsedMinutes} menit lalu). Belum ada konfirmasi kehadiran guru di ruang kelas.`
                            };
                        } else {
                            // Menunggu Guru (Baru Dimulai < 10 Menit) -> KUNING / AMBER
                            return {
                                className: clsName,
                                cam: `CAM ${camNumber}`,
                                status: 'AMBER',
                                badge: 'MENUNGGU GURU MASUK KELAS',
                                isAlarm: false,
                                elapsedMinutes,
                                teacherName: sch.teacherName || 'Guru Pengampu',
                                subjectName: sch.subjectName || 'Mata Pelajaran',
                                periodIndex: `JP ${sch.periodIndex || 1}`,
                                timeRange: `${sch.startTime} - ${sch.endTime}`,
                                details: `Jam pelajaran baru dimulai ${elapsedMinutes} menit lalu. Menunggu guru klik IN Kelas.`
                            };
                        }
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
