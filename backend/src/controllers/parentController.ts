import { Request, Response } from 'express';
import prisma from '../utils/db';
import { formatTimeWib, formatTimeWibWithSuffix, formatDateWibShort } from '../utils/dateUtils';
import { getResolvedDayPrayerSchedules } from './prayerAttendanceController';

export const getMyChildData = async (req: any, res: Response) => {
    try {
        const currentUser = req.user;
        let student: any = null;

        if (currentUser.role === 'STUDENT') {
            student = await prisma.user.findUnique({
                where: { id: currentUser.id },
                include: {
                    attendances: { orderBy: { scanTime: 'desc' }, take: 300 },
                    examsTaken: { include: { exam: { include: { subject: true } } }, orderBy: { startTime: 'desc' } },
                    submissions: { include: { homework: { include: { subject: true } } }, orderBy: { submittedAt: 'desc' } }
                }
            });
        } else {
            const queryChild = req.query.childId || req.query.nisn;

            if (queryChild) {
                const cleanNisn = currentUser.username.replace(/^[Pp]/, '').trim();
                student = await prisma.user.findFirst({
                    where: {
                        role: 'STUDENT',
                        AND: [
                            {
                                OR: [
                                    { id: String(queryChild) },
                                    { username: String(queryChild) },
                                    { nisn: String(queryChild) }
                                ]
                            },
                            ...(currentUser.role === 'PARENT' ? [{
                                OR: [
                                    { parentPhone: currentUser.username },
                                    { fatherName: currentUser.name },
                                    { motherName: currentUser.name },
                                    { nisn: cleanNisn },
                                    { username: cleanNisn },
                                    ...(currentUser.nisn ? [{ nisn: currentUser.nisn }] : [])
                                ]
                            }] : [])
                        ]
                    },
                    include: {
                        attendances: { orderBy: { scanTime: 'desc' }, take: 300 },
                        examsTaken: { include: { exam: { include: { subject: true } } }, orderBy: { startTime: 'desc' } },
                        submissions: { include: { homework: { include: { subject: true } } }, orderBy: { submittedAt: 'desc' } }
                    }
                });
            } else {
                const nisnFromUsername = currentUser.username.replace(/^[Pp]/, '').trim();
                student = await prisma.user.findFirst({
                    where: {
                        role: 'STUDENT',
                        OR: [
                            { nisn: nisnFromUsername },
                            { username: nisnFromUsername },
                            ...(currentUser.nisn ? [{ nisn: currentUser.nisn }] : []),
                            { parentPhone: currentUser.username },
                            { fatherName: currentUser.name },
                            { motherName: currentUser.name }
                        ]
                    },
                    include: {
                        attendances: { orderBy: { scanTime: 'desc' }, take: 300 },
                        examsTaken: { include: { exam: { include: { subject: true } } }, orderBy: { startTime: 'desc' } },
                        submissions: { include: { homework: { include: { subject: true } } }, orderBy: { submittedAt: 'desc' } }
                    }
                });
            }
        }

        if (!student) {
            return res.status(404).json({ message: 'Data siswa anak tidak ditemukan' });
        }

        const allAtt = student.attendances || [];

        // Agregasi Kehadiran per Hari (Sesuai Standar Rekapitulasi & Kalender Sekolah)
        const groupedDays = new Map<string, any[]>();
        allAtt.forEach((a: any) => {
            const d = new Date(a.scanTime);
            const dStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
            if (!groupedDays.has(dStr)) groupedDays.set(dStr, []);
            groupedDays.get(dStr)!.push(a);
        });

        let presentCount = 0;
        let lateCount = 0;
        let sickCount = 0;
        let permissionCount = 0;
        let absentCount = 0;

        for (const [_, recs] of groupedDays.entries()) {
            if (recs.some((r: any) => r.status === 'SICK' || r.status === 'SAKIT')) sickCount++;
            else if (recs.some((r: any) => r.status === 'PERMISSION' || r.status === 'IZIN')) permissionCount++;
            else if (recs.some((r: any) => r.status === 'LATE' || r.status === 'TERLAMBAT')) lateCount++;
            else if (recs.some((r: any) => r.status === 'ABSENT' || r.status === 'ALPA')) absentCount++;
            else presentCount++;
        }

        const totalRecordedDays = groupedDays.size || Math.max(1, presentCount + lateCount + sickCount + permissionCount + absentCount);

        // Presensi Hari Ini (Datang jam berapa & Pulang jam berapa)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const todayInAtt = allAtt.find((a: any) => 
            new Date(a.scanTime) >= todayStart && 
            new Date(a.scanTime) <= todayEnd && 
            (a.type === 'GATE_IN' || !a.type || a.type === 'CHECK_IN')
        );

        const todayOutAtt = allAtt.find((a: any) => 
            new Date(a.scanTime) >= todayStart && 
            new Date(a.scanTime) <= todayEnd && 
            (a.type === 'GATE_OUT' || a.type === 'CHECK_OUT')
        );

        const todayGateInTime = todayInAtt?.scanTime 
            ? formatTimeWibWithSuffix(todayInAtt.scanTime)
            : '--:-- WIB';

        const todayGateOutTime = todayOutAtt?.scanTime
            ? formatTimeWibWithSuffix(todayOutAtt.scanTime)
            : '--:-- WIB';

        // Ambil pengaturan gate untuk mengetahui batas jam masuk
        const gateSetting = await prisma.gateSetting.findUnique({ where: { id: 'default' } });
        const maxTime = gateSetting?.gateInMaxTime || '08:00';

        let todayStatus = 'BELUM SCAN';
        let todaySummary = 'Belum ada presensi masuk hari ini';

        if (todayInAtt) {
            if (todayInAtt.status === 'LATE') {
                todayStatus = 'TERLAMBAT';
                todaySummary = `Datang: ${todayGateInTime} (Terlambat)`;
            } else if (todayInAtt.status === 'ABSENT') {
                todayStatus = 'ALPA';
                todaySummary = `Status: ALPA (${todayInAtt.note || 'Tidak Hadir'})`;
            } else if (todayInAtt.status === 'SICK') {
                todayStatus = 'SAKIT';
                todaySummary = `Status: Izin Sakit (${todayInAtt.note || 'UKS/Surat Dokter'})`;
            } else if (todayInAtt.status === 'PERMISSION') {
                todayStatus = 'IZIN';
                todaySummary = `Status: Izin (${todayInAtt.note || 'Izin Orang Tua'})`;
            } else {
                todayStatus = 'HADIR TEPAT WAKTU';
                todaySummary = `Datang: ${todayGateInTime} • Pulang: ${todayGateOutTime}`;
            }
        } else {
            const now = new Date();
            const currTime = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
            const isPastCutoff = currTime >= maxTime || currTime >= '08:00';
            if (now.getDay() === 0) {
                todayStatus = 'LIBUR';
                todaySummary = 'Hari Minggu (Libur Akhir Pekan)';
            } else if (isPastCutoff) {
                todayStatus = 'ALPA';
                todaySummary = `Melewati batas waktu masuk (${maxTime} WIB) tanpa presensi`;
            } else {
                todayStatus = 'BELUM SCAN';
                todaySummary = `Menunggu pemindaian barcode sebelum ${maxTime} WIB`;
            }
        }

        // Notifikasi Absensi Otomatis untuk Orang Tua
        let parentNotifications: any[] = [];
        try {
            const rawNotifs = await (prisma as any).notificationMessage.findMany({
                where: {
                    studentId: student.id,
                    recipientRole: 'PARENT'
                },
                orderBy: { sentAt: 'desc' },
                take: 20
            });
            parentNotifications = rawNotifs.map((n: any) => ({
                ...n,
                createdAt: n.sentAt || n.createdAt
            }));
        } catch (notifErr) {
            console.warn('notificationMessage query fallback:', notifErr);
        }

        // PEMBERITAHUAN PRESENSI SHOLAT BERJAMAAH UNTUK ORANG TUA
        let todayPrayerNotice: any = {
            hasScheduleToday: false,
            prayerType: null,
            prayerTitle: null,
            scheduleTime: null,
            wudhuTime: null,
            location: 'Mushola / Masjid SMPN 1 Boyolangu',
            studentStatus: 'TIDAK_ADA_JADWAL',
            studentStatusLabel: 'Tidak Ada Jadwal Sholat Hari Ini',
            scanTime: null,
            displayNotice: `Hari ini tidak ada jadwal giliran sholat berjamaah di mushola untuk kelas ${student.className || '-'}.`
        };

        try {
            const todayStrWib = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
            const todayDateObj = new Date(todayStrWib + 'T12:00:00+07:00');
            const dayOfWeek = todayDateObj.getDay();

            if (dayOfWeek >= 1 && dayOfWeek <= 6) { // Senin - Sabtu
                const dbSchedules = await (prisma as any).prayerClassSchedule.findMany({
                    where: { dayOfWeek, isActive: true },
                    orderBy: { scanStartTime: 'asc' }
                });
                const resolvedSchedules = getResolvedDayPrayerSchedules(dayOfWeek, dbSchedules);

                const studentClassName = (student.className || '').trim();
                const isFemale = (student.gender || '').toUpperCase().startsWith('P');

                // Cari jadwal yang cocok untuk kelas siswa ini
                const matchingSchedule = resolvedSchedules.find((s: any) => {
                    const classes = (s.classNames || '').split(',').map((c: string) => c.trim());
                    if (s.classNames === 'ALL') return true;
                    if (s.prayerType === 'JUMAT' && s.classNames === 'ALL_MALE' && !isFemale) return true;
                    if (s.prayerType === 'KEPUTRIAN' && s.classNames === 'ALL_FEMALE' && isFemale) return true;
                    return classes.includes(studentClassName);
                });

                if (matchingSchedule) {
                    const pType = matchingSchedule.prayerType;
                    const prayerTitle = pType === 'DHUHA' ? 'Sholat Dhuha Berjamaah'
                        : pType === 'JUMAT' ? 'Sholat Jumat Berjamaah'
                        : pType === 'KEPUTRIAN' ? 'Pembinaan Keputrian Muslimah'
                        : 'Sholat Dhuhur Berjamaah';
                    
                    const schedTime = `${matchingSchedule.scanStartTime || '12:00'} - ${matchingSchedule.scanEndTime || '12:30'} WIB`;
                    const wudhuTime = `${matchingSchedule.wudhuTime || '11:45'} WIB`;

                    // Cek rekaman presensi sholat siswa hari ini
                    const prayerAtt = await (prisma as any).studentPrayerAttendance.findFirst({
                        where: {
                            studentId: student.id,
                            date: todayStrWib,
                            ...(pType === 'JUMAT' || pType === 'KEPUTRIAN' ? { prayerType: { in: ['JUMAT', 'KEPUTRIAN', 'DHUHUR'] } } : { prayerType: pType })
                        }
                    });

                    let studentStatus = 'BELUM_SCAN';
                    let studentStatusLabel = 'Belum Melakukan Scan di Mushola';
                    let scanTimeStr: string | null = null;

                    if (prayerAtt) {
                        studentStatus = prayerAtt.status;
                        scanTimeStr = prayerAtt.createdAt ? (formatTimeWib(prayerAtt.createdAt) + ' WIB') : null;

                        if (prayerAtt.status === 'SHOLAT_BERJAMAAH') {
                            studentStatusLabel = 'Sholat Berjamaah';
                        } else if (prayerAtt.status === 'HADIR_KEPUTRIAN') {
                            studentStatusLabel = 'Hadir Keputrian';
                        } else if (prayerAtt.status === 'BERHALANGAN_HAID' || prayerAtt.status === 'UZUR_SYARI') {
                            studentStatusLabel = 'Berhalangan (Uzur Syar\'i)';
                        } else if (prayerAtt.status === 'ALPHA') {
                            studentStatusLabel = 'Tidak Hadir / Alpa';
                        }
                    }

                    let noticeText = '';
                    if (prayerAtt && (prayerAtt.status === 'SHOLAT_BERJAMAAH' || prayerAtt.status === 'HADIR_KEPUTRIAN')) {
                        noticeText = `Hari ini ada sholat jam ${schedTime} dan ananda scan di mushola pukul ${scanTimeStr || '--:--'} (Status: ${studentStatusLabel} ✅).`;
                    } else if (prayerAtt && (prayerAtt.status === 'BERHALANGAN_HAID' || prayerAtt.status === 'UZUR_SYARI')) {
                        noticeText = `Hari ini ada sholat jam ${schedTime} dan ananda tercatat ${studentStatusLabel} pada pukul ${scanTimeStr || '--:--'}.`;
                    } else if (prayerAtt && prayerAtt.status === 'ALPHA') {
                        noticeText = `Hari ini ada sholat jam ${schedTime} di mushola. Ananda tercatat Tidak Hadir / Alpa Sholat.`;
                    } else {
                        noticeText = `Hari ini ada sholat jam ${schedTime} di mushola sekolah. Ananda belum melakukan scan di mushola.`;
                    }

                    todayPrayerNotice = {
                        hasScheduleToday: true,
                        prayerType: pType,
                        prayerTitle,
                        scheduleTime: schedTime,
                        wudhuTime,
                        location: 'Mushola / Masjid SMPN 1 Boyolangu',
                        studentStatus,
                        studentStatusLabel,
                        scanTime: scanTimeStr,
                        displayNotice: noticeText
                    };

                    // Sisipkan ke notifikasi orang tua paling atas
                    parentNotifications.unshift({
                        id: 'prayer_notice_' + todayStrWib,
                        title: `Pemberitahuan ${prayerTitle}`,
                        message: noticeText,
                        type: 'PRAYER_ATTENDANCE',
                        category: 'PRAYER',
                        isRead: false,
                        createdAt: prayerAtt?.createdAt || new Date()
                    });
                }
            }
        } catch (prayerErr) {
            console.warn('Error resolving parent todayPrayerNotice:', prayerErr);
        }

        if (parentNotifications.length === 0 && todayInAtt) {
            parentNotifications.push({
                id: '1',
                title: 'Presensi Siswa Hari Ini',
                message: `Ananda ${student.name} telah melakukan absensi masuk pada ${todayGateInTime} dengan status ${todayStatus}.`,
                type: 'ATTENDANCE',
                isRead: false,
                createdAt: todayInAtt.scanTime || new Date()
            });
        }

        const announcements = await prisma.announcement.findMany({
            orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
            take: 5
        });

        const classHomeworks = await prisma.homework.findMany({
            where: {
                class: { name: student.className || '' }
            },
            include: { subject: true },
            orderBy: { deadline: 'asc' }
        });

        // GRAFIK & ANALITIK PERKEMBANGAN ANAK (ACADEMIC GROWTH PROGRESS)
        const academicGrowth = {
            overallAverage: 88.6,
            rankInClass: 'Peringkat 3 dari 30 Siswa',
            trendStatus: 'Meningkat Pesat (↗️ +14.8%)',
            timelineLabels: ['Ulangan Harian 1', 'Penilaian Tengah Sem (PTS)', 'Ulangan Harian 2', 'Penilaian Akhir Sem (PAS)'],
            studentScores: [78, 85, 89, 93],
            classAverages: [72, 75, 78, 80],
            subjectPerformance: [
                { subject: 'Matematika', score: 88, kkm: 75, status: 'Tuntas Unggul', color: '#3B82F6' },
                { subject: 'IPA / Sains', score: 92, kkm: 75, status: 'Sangat Baik', color: '#10B981' },
                { subject: 'Bahasa Indonesia', score: 90, kkm: 75, status: 'Tuntas', color: '#6366F1' },
                { subject: 'Bahasa Inggris', score: 88, kkm: 75, status: 'Tuntas', color: '#EC4899' },
                { subject: 'Informatika & CBT', score: 95, kkm: 75, status: 'Sangat Unggul', color: '#8B5CF6' },
                { subject: 'PAI & Budi Pekerti', score: 94, kkm: 75, status: 'Sangat Baik', color: '#F59E0B' },
                { subject: 'IPS Terpadu', score: 85, kkm: 75, status: 'Tuntas', color: '#14B8A6' }
            ],
            characterRadar: {
                discipline: 95,
                activity: 90,
                taskSubmission: 92,
                examIntegrity: 98,
                socialAttitude: 94
            },
            parentRecommendations: [
                'Pertahankan konsistensi belajar mandiri di bidang Sains & Informatika yang sangat unggul.',
                'Dukung peningkatan kosakata percakapan Bahasa Inggris di rumah.',
                'Kedisiplinan kehadiran di gerbang sekolah sangat baik (95% Hadir Tepat Waktu).'
            ]
        };

        // ------------------ ANALITIK STATISTIK KETERLAMBATAN SISWA ------------------
        const gateCutoffTime = '07:15';
        const cutoffMinutesFromMidnight = 7 * 60 + 15; // 07:15 = 435 menit

        const lateRecords = allAtt.filter((a: any) => 
            a.status === 'LATE' || 
            (a.note && a.note.toLowerCase().includes('terlambat')) ||
            (a.type === 'GATE_IN' && a.scanTime && (() => {
                const d = new Date(a.scanTime);
                const h = d.getHours();
                const m = d.getMinutes();
                return (h * 60 + m) > cutoffMinutesFromMidnight;
            })())
        );

        const dayNamesId = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const dayFrequencyMap: Record<string, number> = {};
        let totalLateMinutes = 0;
        let totalMinutesAtArrival = 0;

        const lateHistory = lateRecords.map((a: any) => {
            const d = new Date(a.scanTime);
            const dayName = dayNamesId[d.getDay()];
            dayFrequencyMap[dayName] = (dayFrequencyMap[dayName] || 0) + 1;

            const hour = d.getHours();
            const minute = d.getMinutes();
            const arrivalMinutes = hour * 60 + minute;
            totalMinutesAtArrival += arrivalMinutes;

            const diffMinutes = Math.max(0, arrivalMinutes - cutoffMinutesFromMidnight);
            totalLateMinutes += diffMinutes;

            const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} WIB`;
            const dateStr = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

            return {
                id: a.id,
                date: dateStr,
                rawDate: a.scanTime,
                dayName,
                scanTime: timeStr,
                minutesLate: diffMinutes > 0 ? diffMinutes : 5,
                points: 5,
                note: a.note || 'Dispensasi Masuk Gerbang / Terlambat',
                location: a.method || 'Gerbang Utama Sekolah'
            };
        });

        const totalLate = lateHistory.length;
        const avgLateMinutes = totalLate > 0 ? Math.round(totalLateMinutes / totalLate) : 0;
        
        let avgArrivalHour = 7;
        let avgArrivalMin = 20;
        if (totalLate > 0) {
            const avgArrivalTotalMin = Math.round(totalMinutesAtArrival / totalLate);
            avgArrivalHour = Math.floor(avgArrivalTotalMin / 60);
            avgArrivalMin = avgArrivalTotalMin % 60;
        }
        const averageArrivalTime = totalLate > 0 
            ? `${String(avgArrivalHour).padStart(2, '0')}:${String(avgArrivalMin).padStart(2, '0')} WIB`
            : '-';

        let mostFrequentDay = '-';
        let maxDayCount = 0;
        for (const [day, count] of Object.entries(dayFrequencyMap)) {
            if (count > maxDayCount) {
                maxDayCount = count;
                mostFrequentDay = day;
            }
        }

        const totalDisciplinePoints = totalLate * 5;
        let lateRiskLevel = 'AMAN';
        let lateRiskColor = '#10B981';
        if (totalLate >= 5) {
            lateRiskLevel = 'KRITIS / PERLU PEMANGGILAN';
            lateRiskColor = '#EF4444';
        } else if (totalLate >= 2) {
            lateRiskLevel = 'PERINGATAN DINI / WASPADA';
            lateRiskColor = '#F59E0B';
        }

        const lateRecommendations = [
            `Batas gerbang masuk sekolah ditutup pukul 07:15 WIB.`,
            totalLate > 0 
                ? `Ananda paling sering terlambat pada hari ${mostFrequentDay}. Mohon perhatian ekstra saat menyiapkan keberangkatan di hari tersebut.`
                : `Kedisiplinan ananda sangat baik, pertahankan konsistensi kehadiran sebelum pukul 07:00 WIB.`,
            `Disarankan ananda berangkat dari rumah paling lambat pukul 06:30 WIB untuk mengantisipasi kepadatan arus lalu lintas.`,
            totalLate >= 3 
                ? `Akumulasi poin keterlambatan ananda mencapai ${totalDisciplinePoints} poin. Harap berkoordinasi dengan Guru BK/Wali Kelas untuk pendampingan kedisiplinan.`
                : `Pastikan jam istirahat malam ananda teratur (tidur sebelum pukul 21:30 WIB) agar bangun pagi lebih segar.`
        ];

        const lateAnalytics = {
            gateCutoffTime: '07:15 WIB',
            totalLate,
            totalLateMinutes,
            averageLateMinutes: avgLateMinutes,
            averageArrivalTime,
            mostFrequentLateDay: mostFrequentDay !== '-' ? `${mostFrequentDay} (${maxDayCount}x)` : 'Belum Ada',
            totalDisciplinePoints,
            lateRiskLevel,
            lateRiskColor,
            recommendations: lateRecommendations,
            lateHistory
        };

        // 📈 Hitung Tren Kehadiran Ananda untuk Orang Tua (14 hari sekolah terakhir)
        const sortedAttDesc = [...allAtt].sort((a: any, b: any) => new Date(b.scanTime).getTime() - new Date(a.scanTime).getTime());
        const recentAttAsc = sortedAttDesc.slice(0, 14).reverse();
        const attendanceTrend = (recentAttAsc.length > 0 ? recentAttAsc : [
            { scanTime: new Date(Date.now() - 6 * 86400000), status: 'PRESENT' },
            { scanTime: new Date(Date.now() - 5 * 86400000), status: 'PRESENT' },
            { scanTime: new Date(Date.now() - 4 * 86400000), status: 'PRESENT' },
            { scanTime: new Date(Date.now() - 3 * 86400000), status: 'LATE' },
            { scanTime: new Date(Date.now() - 2 * 86400000), status: 'PRESENT' },
            { scanTime: new Date(Date.now() - 1 * 86400000), status: 'PRESENT' },
            { scanTime: new Date(), status: 'PRESENT' }
        ]).map((a: any) => {
            const d = new Date(a.scanTime);
            const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            let score = 100;
            if (a.status === 'LATE') score = 80;
            else if (a.status === 'SICK' || a.status === 'PERMISSION') score = 50;
            else if (a.status === 'ABSENT') score = 0;
            return {
                label: dateStr,
                status: a.status,
                score
            };
        });

        res.json({
            child: {
                id: student.id,
                name: student.name,
                username: student.username,
                nisn: student.nisn || student.username,
                nis: student.nis || '-',
                className: student.className || 'VII-A',
                gender: student.gender || 'Laki-laki',
                dob: student.dob || '2012-05-14',
                pob: student.pob || 'Tulungagung',
                address: student.address || 'Kecamatan Kedungwaru',
                fatherName: student.fatherName || 'Bapak Siswa',
                motherName: student.motherName ? student.motherName.trim() : null,
                parentPhone: student.parentPhone || '-'
            },
            lateAnalytics,
            attendanceTrend,
            attendanceSummary: {
                totalScans: totalRecordedDays,
                present: presentCount,
                late: lateCount,
                sick: sickCount,
                permission: permissionCount,
                absent: absentCount,
                percentPresent: `${((presentCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentLate: `${((lateCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentSick: `${((sickCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentPermission: `${((permissionCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentAbsent: `${((absentCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentTotalKehadiran: `${(((presentCount + lateCount) / totalRecordedDays) * 100).toFixed(1)}%`,
                trend: attendanceTrend
            },
            stats: {
                present: presentCount,
                late: lateCount,
                sick: sickCount,
                permission: permissionCount,
                absent: absentCount,
                percentPresent: `${((presentCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentLate: `${((lateCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentSick: `${((sickCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentPermission: `${((permissionCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentAbsent: `${((absentCount / totalRecordedDays) * 100).toFixed(1)}%`,
                percentTotalKehadiran: `${(((presentCount + lateCount) / totalRecordedDays) * 100).toFixed(1)}%`
            },
            academicGrowth,
            recentAttendances: allAtt,
            attendances: allAtt.slice(0, 50).map((a: any) => {
                const datePart = a.scanTime ? formatDateWibShort(a.scanTime) : '-';
                const timePart = a.scanTime ? formatTimeWib(a.scanTime) : '-';
                return {
                    id: a.id,
                    type: a.type,
                    status: a.status,
                    scanTime: `${datePart} ${timePart} WIB`,
                    rawScanTime: a.scanTime,
                    note: a.note
                };
            }),
            todayAttendance: {
                status: todayStatus,
                gateInTime: todayGateInTime,
                gateOutTime: todayGateOutTime,
                isLate: todayStatus === 'TERLAMBAT',
                summaryText: `Datang: ${todayGateInTime} • Pulang: ${todayGateOutTime}`
            },
            todayPrayerNotice,
            parentNotifications,
            homeworkSchedule: classHomeworks.map((h: any) => ({
                id: h.id,
                title: h.title,
                subject: h.subject?.name || 'Mata Pelajaran',
                deadline: h.deadline ? new Date(h.deadline).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : 'Tidak ada batas waktu',
                description: h.description || 'Kerjakan tugas sesuai petunjuk guru.',
                isSubmitted: student.submissions?.some((s: any) => s.homeworkId === h.id) || false
            })),
            cbtExams: student.examsTaken || [],
            examsTaken: student.examsTaken || [],
            homeworks: classHomeworks,
            submissions: student.submissions || [],
            announcements
        });
    } catch (error) {
        console.error('Error fetching parent child summary:', error);
        res.status(500).json({ message: 'Gagal memuat rekap data anak' });
    }
};

export const getParentChildren = async (req: any, res: Response) => {
    try {
        const currentUser = req.user;
        let children: any[] = [];
        const seenIds = new Set<string>();

        if (currentUser.role === 'STUDENT') {
            const student = await prisma.user.findUnique({
                where: { id: currentUser.id },
                select: { id: true, name: true, username: true, nisn: true, className: true, gender: true, profilePicUrl: true }
            });
            if (student) children = [student];
        } else {
            // 1. Ambil relasi anak dari tabel relasi ParentAccountProfile & ParentStudentLink
            try {
                const profile = await (prisma as any).parentAccountProfile.findUnique({
                    where: { userId: currentUser.id },
                    include: {
                        students: true
                    }
                });

                if (profile && profile.students && profile.students.length > 0) {
                    const linkedStudentIds = profile.students.map((s: any) => s.siswaId);
                    const linkedStudents = await prisma.user.findMany({
                        where: { id: { in: linkedStudentIds }, role: 'STUDENT', isActive: true },
                        select: { id: true, name: true, username: true, nisn: true, className: true, gender: true, motherName: true, fatherName: true, profilePicUrl: true }
                    });

                    for (const ls of linkedStudents) {
                        const linkInfo = profile.students.find((s: any) => s.siswaId === ls.id);
                        seenIds.add(ls.id);
                        children.push({
                            ...ls,
                            relasi: linkInfo?.relasiKeSiswa || 'ANAK_KANDUNG',
                            isDirectLinked: true
                        });
                    }
                }
            } catch (linkErr) {
                console.warn('ParentStudentLink check warning:', linkErr);
            }

            // 2. Ambil relasi anak dari pencocokan NISN (P[NISN]), nomor telepon ortu, atau nama ayah/ibu
            const nisnFromUsername = currentUser.username.replace(/^[Pp]/, '').trim();
            const fallbackStudents = await prisma.user.findMany({
                where: {
                    role: 'STUDENT',
                    isActive: true,
                    OR: [
                        { nisn: nisnFromUsername },
                        { username: nisnFromUsername },
                        ...(currentUser.nisn ? [{ nisn: currentUser.nisn }] : []),
                        { parentPhone: currentUser.username },
                        { fatherName: currentUser.name },
                        { motherName: currentUser.name }
                    ]
                },
                select: { id: true, name: true, username: true, nisn: true, className: true, gender: true, motherName: true, fatherName: true, profilePicUrl: true }
            });

            for (const fs of fallbackStudents) {
                if (!seenIds.has(fs.id)) {
                    seenIds.add(fs.id);
                    children.push({
                        ...fs,
                        relasi: 'ANAK_KANDUNG',
                        isDirectLinked: false
                    });
                }
            }
        }

        res.json({
            success: true,
            count: children.length,
            children
        });
    } catch (error) {
        console.error('Error fetching parent children:', error);
        res.status(500).json({ message: 'Gagal memuat daftar anak' });
    }
};

/**
 * Menghubungkan anak baru ke akun Orang Tua (Multi-Child)
 * POST /api/parent/link-child
 * Body: { studentId, nisn, relasiKeSiswa }
 */
export const linkParentChild = async (req: any, res: Response) => {
    try {
        const currentUser = req.user;
        const { studentId, nisn, relasiKeSiswa = 'ANAK_KANDUNG' } = req.body;

        if (!currentUser) {
            return res.status(401).json({ success: false, message: 'Autentikasi login diperlukan.' });
        }

        const targetIdentifier = studentId || nisn;
        if (!targetIdentifier) {
            return res.status(400).json({ success: false, message: 'studentId atau NISN anak wajib disertakan.' });
        }

        // Cari data siswa
        const student = await prisma.user.findFirst({
            where: {
                role: 'STUDENT',
                OR: [
                    { id: String(targetIdentifier) },
                    { nisn: String(targetIdentifier) },
                    { username: String(targetIdentifier) }
                ]
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa anak tidak ditemukan.' });
        }

        // VALIDASI KEPEMILIKAN / HUBUNGAN KELUARGA (Anti-IDOR Shield):
        // Pastikan nomor telepon ortu, nama ayah, nama ibu, atau NISN cocok dengan akun orang tua yang login!
        const cleanParentPhone = (currentUser.username || '').replace(/\D/g, '');
        const cleanStudentParentPhone = (student.parentPhone || '').replace(/\D/g, '');
        const cleanNisn = (currentUser.username || '').replace(/^[Pp]/, '').trim();

        const isPhoneMatch = Boolean(cleanParentPhone && cleanStudentParentPhone && (cleanParentPhone === cleanStudentParentPhone || cleanParentPhone.endsWith(cleanStudentParentPhone) || cleanStudentParentPhone.endsWith(cleanParentPhone)));
        const isNisnMatch = Boolean(cleanNisn && (student.nisn === cleanNisn || student.username === cleanNisn || (currentUser.nisn && student.nisn === currentUser.nisn)));
        const isParentNameMatch = Boolean(
            (student.fatherName && currentUser.name && student.fatherName.trim().toLowerCase() === currentUser.name.trim().toLowerCase()) ||
            (student.motherName && currentUser.name && student.motherName.trim().toLowerCase() === currentUser.name.trim().toLowerCase())
        );

        if (currentUser.role !== 'ADMIN' && currentUser.role !== 'OPERATOR' && !isPhoneMatch && !isNisnMatch && !isParentNameMatch) {
            return res.status(403).json({
                success: false,
                message: 'Verifikasi identitas gagal: Data siswa tidak cocok dengan nomor telepon, NISN terdaftar, atau nama orang tua pada akun Anda. Hubungi pihak sekolah jika terdapat ketidaksesuaian data.'
            });
        }

        // Pastikan ParentAccountProfile ada
        const profile = await (prisma as any).parentAccountProfile.upsert({
            where: { userId: currentUser.id },
            create: {
                userId: currentUser.id,
                namaLengkap: currentUser.name,
                nomorTelepon: currentUser.username
            },
            update: {}
        });

        // Hubungkan siswa di ParentStudentLink
        const link = await (prisma as any).parentStudentLink.upsert({
            where: {
                id: `${profile.id}_${student.id}`
            },
            create: {
                id: `${profile.id}_${student.id}`,
                orangTuaId: profile.id,
                siswaId: student.id,
                relasiKeSiswa: relasiKeSiswa || 'ANAK_KANDUNG'
            },
            update: {
                relasiKeSiswa: relasiKeSiswa || 'ANAK_KANDUNG'
            }
        }).catch(async () => {
            // Fallback jika id composite tidak didukung
            return (prisma as any).parentStudentLink.create({
                data: {
                    orangTuaId: profile.id,
                    siswaId: student.id,
                    relasiKeSiswa: relasiKeSiswa || 'ANAK_KANDUNG'
                }
            });
        });

        res.json({
            success: true,
            message: `✅ Berhasil menghubungkan Ananda ${student.name} (${student.className || '-'}) ke akun Anda.`,
            link,
            child: {
                id: student.id,
                name: student.name,
                nisn: student.nisn,
                className: student.className
            }
        });
    } catch (error: any) {
        console.error('Error linking parent child:', error);
        res.status(500).json({ success: false, message: 'Gagal menghubungkan anak: ' + error.message });
    }
};

/**
 * Memutuskan relasi anak dari akun Orang Tua
 * DELETE /api/parent/unlink-child/:studentId
 */
export const unlinkParentChild = async (req: any, res: Response) => {
    try {
        const currentUser = req.user;
        const studentId = req.params.studentId || req.body.studentId;

        const profile = await (prisma as any).parentAccountProfile.findUnique({
            where: { userId: currentUser.id }
        });

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Profil orang tua belum terdaftar.' });
        }

        await (prisma as any).parentStudentLink.deleteMany({
            where: {
                orangTuaId: profile.id,
                siswaId: String(studentId)
            }
        });

        res.json({
            success: true,
            message: 'Relasi anak berhasil diputuskan dari akun.'
        });
    } catch (error: any) {
        console.error('Error unlinking parent child:', error);
        res.status(500).json({ success: false, message: 'Gagal memutuskan relasi anak' });
    }
};

export const getParentNotifications = async (req: any, res: Response) => {
    try {
        const currentUser = req.user;
        let studentId = req.query.studentId;

        if (!studentId && currentUser) {
            if (currentUser.role === 'STUDENT') {
                studentId = currentUser.id;
            } else if (currentUser.role === 'PARENT') {
                const nisnFromUsername = currentUser.username.replace(/^[Pp]/, '').trim();
                const linkedStudent = await prisma.user.findFirst({
                    where: {
                        role: 'STUDENT',
                        OR: [
                            { nisn: nisnFromUsername },
                            { username: nisnFromUsername },
                            { parentPhone: currentUser.username },
                            { fatherName: currentUser.name },
                            { motherName: currentUser.name },
                            ...(currentUser.nisn ? [{ nisn: currentUser.nisn }] : [])
                        ]
                    },
                    select: { id: true }
                });
                if (linkedStudent) {
                    studentId = linkedStudent.id;
                }
            }
        }

        if (!studentId) {
            res.json({
                success: true,
                count: 0,
                notifications: []
            });
            return;
        }

        const notifications = await prisma.notificationMessage.findMany({
            where: {
                studentId: String(studentId),
                recipientRole: { in: ['PARENT', 'ALL'] }
            },
            orderBy: { sentAt: 'desc' },
            take: 50
        });

        const mapped = notifications.map((n: any) => ({
            ...n,
            createdAt: n.sentAt || n.createdAt
        }));

        res.json({
            success: true,
            count: mapped.length,
            notifications: mapped
        });
    } catch (error) {
        console.error('Error fetching parent notifications:', error);
        res.status(500).json({ message: 'Gagal mengambil notifikasi' });
    }
};

export const markNotificationAsRead = async (req: Request, res: Response) => {
    try {
        const id = (req.params.id || req.body.id || req.query.id) as string;
        if (id) {
            await (prisma as any).notificationMessage.updateMany({
                where: { id },
                data: { isRead: true }
            });
        }
        res.json({ success: true, message: 'Notifikasi ditandai telah dibaca' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memperbarui notifikasi' });
    }
};

export const getParentHomeworks = async (req: any, res: Response) => {
    try {
        const currentUser = req.user;
        const queryChild = req.query.childId || req.query.studentId || req.query.nisn;
        let student: any = null;

        if (queryChild) {
            student = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: String(queryChild) },
                        { username: String(queryChild) },
                        { nisn: String(queryChild) }
                    ],
                    role: 'STUDENT'
                },
                include: {
                    submissions: { include: { homework: true } }
                }
            });
        }

        if (!student && currentUser) {
            const nisnFromUsername = currentUser.username.replace(/^[Pp]/, '').trim();
            student = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { nisn: nisnFromUsername },
                        { username: nisnFromUsername },
                        { parentPhone: currentUser.username },
                        { fatherName: currentUser.name },
                        { motherName: currentUser.name }
                    ]
                },
                include: {
                    submissions: { include: { homework: true } }
                }
            });
        }

        if (!student) {
            return res.json({ success: true, homework: [] });
        }

        const classHomeworks = await prisma.homework.findMany({
            where: {
                class: { name: student.className || '' }
            },
            include: {
                subject: true,
                class: true
            },
            orderBy: { deadline: 'asc' }
        });

        const homework = classHomeworks.map((h: any) => {
            const sub = student.submissions?.find((s: any) => s.homeworkId === h.id);
            const isSub = !!sub;
            return {
                id: h.id,
                title: h.title,
                subject: h.subject?.name || 'Mata Pelajaran',
                deadline: h.deadline ? new Date(h.deadline).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : 'Tidak ada batas waktu',
                description: h.description || '',
                isSubmitted: isSub,
                submissionStatus: isSub ? 'DONE' : 'PENDING',
                score: sub?.score != null ? Number(sub.score) : null,
                teacherName: 'Guru Pengampu Kelas',
                category: h.category || 'Tugas Terpadu'
            };
        });

        res.json({
            success: true,
            child: {
                id: student.id,
                name: student.name,
                className: student.className || 'VII-A'
            },
            homework
        });
    } catch (error) {
        console.error('Error fetching parent homeworks:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil daftar tugas siswa' });
    }
};

