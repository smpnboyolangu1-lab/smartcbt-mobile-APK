import prisma from '../utils/db';
import { getWibDayBounds } from '../utils/dateUtils';
import { broadcastMonitoringEvent, resetExamTokenTimer, setClassExamToken } from '../controllers/cbtController';
import { autoNotifyUnscannedGateOutStudents } from '../controllers/attendanceController';
import { sendFcmToUser } from './fcmService';
import { sendSingleWhatsApp, WHATSAPP_NOTIFICATION_POLICY } from './whatsappBlastService';
import { runDatabaseBackup } from './backupService';

let schedulerInterval: NodeJS.Timeout | null = null;
let lastRotateMinute = -1;

/**
 * Inisialisasi Master System Scheduler SIBOY 2026
 * Mengatur siklus hidup ujian CBT, auto-publish tugas, auto-close tugas, dan rekap poin BK
 */
export function initMasterSchedulers() {
    if (schedulerInterval) return;

    console.log('⏰ [Master Scheduler] Memulai Daemon Scheduler CBT & Tugas...');

    // Jalankan pemeriksaan setiap 60 detik
    schedulerInterval = setInterval(async () => {
        const now = new Date();
        const currentMinute = now.getMinutes();

        try {
            // 1. ROTASI TOKEN CBT SETIAP 15 MENIT UNTUK UJIAN AKTIF
            if (currentMinute % 15 === 0 && currentMinute !== lastRotateMinute) {
                lastRotateMinute = currentMinute;
                await processTokenRotation();
            }

            // 2. AUTO-PUBLISH TUGAS YANG JADWALNYA SUDAH TIBA
            await processHomeworkPublishing(now);

            // 3. AUTO-CLOSE TUGAS YANG MELEWATI BATAS TOLERANSI
            await processHomeworkClosing(now);

            // 4. MONITORING KELAS KOSONG SETIAP 5 MENIT (SIBOY A4 & A5)
            if (currentMinute % 5 === 0) {
                await processEmptyClassMonitoring(now);
            }

            // 5. PENGINGAT JADWAL SHOLAT BERJAMAAH (H-1 Pukul 19.00 WIB & Hari H 2 Jam Sebelumnya)
            await processPrayerReminders(now);

            // 6. REKAP KETERLAMBATAN MINGGUAN KE ORANG TUA (Setiap Sabtu Pukul 13:00 WIB)
            await processWeeklyLateReportToParents(now);

            // 7. NOTIFIKASI OTOMATIS SISWA ALPA KE ORANG TUA PUKUL 15:00 WIB (PUSH NOTIFICATION - D14)
            await processDailyAlpaNotification(now);

            // 8. NOTIFIKASI OTOMATIS SISWA BELUM SCAN PULANG KE ORANG TUA (Setiap Hari Sekolah Pukul 16:15 WIB)
            await processGateOutUnscannedNotification(now);

            // 8. PEMELIHARAAN LOG & BACKUP DATABASE BERKALA (Setiap Hari Pukul 02:00 & 02:30 WIB)
            if (now.getHours() === 2 && currentMinute === 0) {
                await processLogRetentionCleanup();
                await processRefreshTokenPrune();
            }
            if (now.getHours() === 2 && currentMinute === 30) {
                await runDatabaseBackup();
            }

            // 9. AUTO-RESET KEPULANGAN DARURAT / PULANG LEBIH AWAL 1X (PERGANTIAN HARI)
            await processGateSettingsDailyReset();

            // 10. AUTO-FINALIZE & AUTO-CLEANUP SESI CBT KEDALUWARSA / GENTAYANGAN (LOCKED / ONGOING DARI HARI KEMARIN)
            if (currentMinute % 10 === 0) {
                await processExpiredStudentExams(now);
            }

            // 11. AUTO-CLEANUP PASIEN UKS GENTAYANGAN & PELEPASAN KASUR (> 3 JAM)
            if (currentMinute % 15 === 0) {
                await processUksZombieVisitsCleanup(now);
            }

        } catch (err: any) {
            console.error('[Master Scheduler Error]', err.message);
        }
    }, 60000);

    // Jalankan pemeriksaan awal saat server boot
    setTimeout(() => {
        const now = new Date();
        processHomeworkPublishing(now).catch(() => {});
        processHomeworkClosing(now).catch(() => {});
        processEmptyClassMonitoring(now).catch(() => {});
        processPrayerReminders(now).catch(() => {});
        processExpiredStudentExams(now).catch(() => {});
        processUksZombieVisitsCleanup(now).catch(() => {});
        processRefreshTokenPrune().catch(() => {});
    }, 5000);
}

/**
 * Rotasi Token CBT Otomatis
 */
async function processTokenRotation() {
    const activeExams = await prisma.exam.findMany({
        where: { isTokenActive: true }
    });

    if (activeExams.length === 0) return;

    for (const exam of activeExams) {
        const classes = await prisma.class.findMany({ select: { name: true } });
        const assigned = (exam.assignedClasses || 'ALL').trim();
        let targetClasses: string[] = [];

        if (assigned === 'ALL' || assigned === 'Semua Kelas' || !assigned) {
            targetClasses = classes.map(c => c.name);
        } else {
            targetClasses = assigned.split(',').map(c => c.trim()).filter(Boolean);
        }

        for (const cls of targetClasses) {
            const newToken = setClassExamToken(exam.id, cls);
            broadcastMonitoringEvent({
                type: 'TOKEN_UPDATED',
                examId: exam.id,
                className: cls,
                token: newToken,
                isActive: true,
                remainingSeconds: 900,
                tokenLifetimeSeconds: 900,
                proctorName: 'Sistem Scheduler Otomatis'
            });
        }
        resetExamTokenTimer(exam.id);
        console.log(`🔐 [Scheduler] Token CBT dirotasi otomatis untuk ujian: ${exam.title} (${targetClasses.length} kelas)`);
    }
}

/**
 * Auto-publish tugas yang sudah dijadwalkan
 */
async function processHomeworkPublishing(now: Date) {
    try {
        const toPublish = await (prisma as any).homework.findMany({
            where: {
                status: 'SCHEDULED',
                publishAt: { lte: now }
            }
        });

        if (toPublish.length > 0) {
            for (const hw of toPublish) {
                await (prisma as any).homework.update({
                    where: { id: hw.id },
                    data: { status: 'PUBLISHED' }
                });
                console.log(`📚 [Scheduler] Tugas "${hw.title}" otomatis dipublikasikan.`);
            }
        }
    } catch (e) {}
}

/**
 * Auto-close tugas yang melewati autoCloseAt
 */
async function processHomeworkClosing(now: Date) {
    try {
        const toClose = await (prisma as any).homework.findMany({
            where: {
                status: 'PUBLISHED',
                autoCloseAt: { lte: now }
            }
        });

        if (toClose.length > 0) {
            for (const hw of toClose) {
                await (prisma as any).homework.update({
                    where: { id: hw.id },
                    data: { status: 'CLOSED' }
                });
                console.log(`🔒 [Scheduler] Tugas "${hw.title}" otomatis ditutup (telah melewati batas akhir + toleransi).`);
            }
        }
    } catch (e) {}
}

/**
 * 4. MONITORING KELAS KOSONG SETIAP 5 MENIT (SIBOY FRESH A4)
 * Mengecek apakah ada jadwal KBM yang sedang berlangsung dan telah melewati toleransi 5 menit
 * tanpa adanya check-in guru pengampu di ruang kelas.
 * Jika terdeteksi kosong, buat laporan otomatis dan kirim notifikasi ke seluruh Guru Piket hari ini.
 */
export async function processEmptyClassMonitoring(now: Date) {
    try {
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const currentDay = days[now.getDay()];
        if (currentDay === 'Minggu') return;

        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTotalMinutes = currentHour * 60 + currentMinute;

        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        // Ambil jadwal KBM hari ini
        const schedules = await (prisma as any).classPeriodSchedule.findMany({
            where: {
                day: currentDay,
                isBreak: false
            }
        });

        if (schedules.length === 0) return;

        // Ambil sesi KBM yang sedang aktif hari ini
        const activeSessions = await (prisma as any).classPeriodSession.findMany({
            where: {
                status: 'ACTIVE',
                inTime: { gte: todayStart }
            }
        });

        // Ambil sesi room handover aktif
        const activeRoomSessions = await (prisma as any).teachingSession.findMany({
            where: {
                status: 'IN_PROGRESS',
                checkInTime: { gte: todayStart }
            }
        });

        // Ambil laporan kelas kosong hari ini
        const existingReports = await (prisma as any).emptyClassReport.findMany({
            where: {
                createdAt: { gte: todayStart }
            }
        });

        // Cari guru piket aktif hari ini
        const piketTeachers = await (prisma as any).piketSchedule.findMany({
            where: {
                dayOfWeek: now.getDay(),
                isActive: true
            },
            include: { teacher: true }
        });

        for (const sch of schedules) {
            if (!sch.startTime || !sch.endTime || !sch.startTime.includes(':')) continue;
            const [sH, sM] = sch.startTime.split(':').map(Number);
            const [eH, eM] = sch.endTime.split(':').map(Number);
            const startTotal = sH * 60 + sM;
            const endTotal = eH * 60 + eM;

            // Jika saat ini KBM sudah berjalan minimal 10 menit (melewati toleransi wajar) dan belum selesai
            if (currentTotalMinutes >= startTotal + 10 && currentTotalMinutes <= endTotal) {
                const clsName = sch.className;
                
                // Cek apakah guru sudah check-in di kelas ini
                const hasActiveSession = activeSessions.some((s: any) => s.className?.toUpperCase() === clsName?.toUpperCase()) ||
                    activeRoomSessions.some((s: any) => s.className?.toUpperCase() === clsName?.toUpperCase());

                if (hasActiveSession) continue;

                // Cek apakah sudah pernah dilaporkan / tercatat di emptyClassReport untuk jam ini
                const periodLabel = `Jam ke-${sch.periodIndex || 1} (${sch.startTime} - ${sch.endTime})`;
                const alreadyReported = existingReports.some((r: any) => 
                    r.className?.toUpperCase() === clsName?.toUpperCase() && 
                    (r.periodLesson === periodLabel || r.periodLesson?.includes(sch.startTime))
                );

                if (!alreadyReported) {
                    const elapsed = currentTotalMinutes - startTotal;
                    const newReport = await (prisma as any).emptyClassReport.create({
                        data: {
                            className: clsName,
                            periodLesson: periodLabel,
                            subjectName: sch.subjectName || 'Mata Pelajaran',
                            scheduledTeacher: sch.teacherName || 'Guru Pengampu',
                            teacherStatus: 'BELUM_TERKONFIRMASI',
                            hasAssignment: false,
                            status: 'BELUM_TERKONFIRMASI',
                            reporterName: 'Scheduler 10 Menit SIBOY'
                        }
                    });

                    // Notifikasi ke setiap Guru Piket dan Tim Kurikulum yang bertugas
                    for (const piket of piketTeachers) {
                        await (prisma as any).notificationMessage.create({
                            data: {
                                recipientId: piket.teacherId,
                                recipientRole: 'TEACHER',
                                title: `⚠️ KBM BELUM DIBUKA: ${clsName} (>10 Menit)`,
                                message: `Kelas ${clsName} pada ${periodLabel} (Mapel: ${sch.subjectName}) belum dibuka sesi KBM oleh ${sch.teacherName} (Waktu berlalu: ${elapsed} menit). Harap pastikan kehadiran guru di kelas atau koordinasikan ke Tim Kurikulum.`,
                                category: 'EMPTY_CLASS'
                            }
                        });
                    }

                    // Broadcast ke TV Display dan WebSocket jika fungsi global terpasang
                    if (typeof (global as any).emitEmptyClassUpdate === 'function') {
                        (global as any).emitEmptyClassUpdate({
                            type: 'EMPTY_CLASS_AUTO_DETECTED',
                            report: newReport
                        });
                    }
                    console.log(`⏰ [Scheduler] Sesi KBM BELUM TERKONFIRMASI: ${clsName} pada ${periodLabel} (>10 Menit). Notifikasi dikirim ke ${piketTeachers.length} Guru Piket & Kurikulum.`);
                }
            }
        }
    } catch (err: any) {
        console.error('[Empty Class Scheduler Error]', err.message);
    }
}

/**
 * 5. REKAP OTOMATIS HARIAN SCHEDULER
 * Menghitung akumulasi presensi siswa, status kelas kosong, dan memperbarui skor EWS SAW.
 */
export async function processDailyAutoRecap(now: Date = new Date()) {
    try {
        console.log('📊 [Scheduler] Menjalankan Rekap Otomatis Harian SIBOY...');
        const { startOfDay: todayStart, endOfDay: todayEnd } = getWibDayBounds(now);

        // 1. Agregasi Presensi Siswa Hari Ini
        const attendancesToday = await prisma.attendance.findMany({
            where: { scanTime: { gte: todayStart, lte: todayEnd } }
        });

        const presentCount = attendancesToday.filter(a => a.status === 'PRESENT').length;
        const lateCount = attendancesToday.filter(a => a.status === 'LATE').length;
        const sickCount = attendancesToday.filter(a => a.status === 'SICK').length;
        const permissionCount = attendancesToday.filter(a => a.status === 'PERMISSION').length;
        const absentCount = attendancesToday.filter(a => a.status === 'ABSENT' || a.status === 'TRUANT').length;

        // 2. Kalkulasi Ulang EWS SAW Siswa
        const { calculateSawForAllStudents } = await import('./sawCalculatorService');
        const totalSawCalculated = await calculateSawForAllStudents();

        // 3. Rekap Kelas Kosong Hari Ini
        const emptyReports = await prisma.emptyClassReport.findMany({
            where: { createdAt: { gte: todayStart, lte: todayEnd } }
        });

        const recapSummary = {
            tanggal: todayStart.toISOString().substring(0, 10),
            presensi: {
                totalScan: attendancesToday.length,
                hadirTepatWaktu: presentCount,
                terlambat: lateCount,
                sakit: sickCount,
                izin: permissionCount,
                alpa: absentCount
            },
            sawEwsUpdated: totalSawCalculated,
            kelasKosongTotal: emptyReports.length,
            kelasKosongResolved: emptyReports.filter(r => r.status === 'RESOLVED' || r.status === 'GURU_INVAL_ASSIGNED').length,
            completedAt: new Date()
        };

        // Simpan log ke AuditLog
        await prisma.auditLog.create({
            data: {
                action: 'AUTO_REKAP_DAILY_SCHEDULER',
                details: JSON.stringify(recapSummary),
                ipAddress: '127.0.0.1 (Scheduler Daemon)'
            }
        });

        console.log('✅ [Scheduler] Rekap Otomatis Harian Selesai Diproses:', recapSummary);
        return recapSummary;
    } catch (e: any) {
        console.error('[Daily Auto Recap Error]', e.message);
        throw e;
    }
}

/**
 * 6. PENGINGAT JADWAL SHOLAT BERJAMAAH (H-1 MULAI PUKUL 19.00 WIB & HARI-H SEBELUM PELAKSANAAN)
 * Otomatis mengecek hari Minggu dan Hari Libur Sekolah agar tidak mengganggu istirahat.
 */
let lastPrayerH1Date = '';
const sentPrayerDayOfMap = new Set<string>();
const sentPrayerPostBlastMap = new Set<string>();
let lastPrayerMissedDate = '';

/**
 * Fungsi pembantu ekstraksi waktu resmi WIB
 */
function getWibInfo(date: Date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;

    const ymd = `${map.year}-${map.month}-${map.day}`;
    const hour = parseInt(map.hour || '0', 10);
    const minute = parseInt(map.minute || '0', 10);

    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', weekday: 'short' });
    const weekdayStr = dayFormatter.format(date);
    const dayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const dayOfWeek = dayMap[weekdayStr] ?? date.getDay();

    return { ymd, hour, minute, dayOfWeek };
}

/**
 * Fungsi core pengiriman notifikasi pengingat sholat H-1 (Mulai Pukul 19:00 WIB)
 * Mengirim notifikasi In-App Database, Push Notification FCM (Siswa & Orang Tua), dan WhatsApp Resmi ke Wali Murid
 */
export async function sendPrayerH1NotificationForDate(
    targetTomorrowWib: Date,
    force: boolean = false,
    triggerType: 'AUTO' | 'MANUAL' = 'AUTO'
): Promise<{ sentStudents: number; sentParents: number; sentWa: number; schedulesCount: number; targetDayName: string; targetDateStr: string }> {
    const targetInfo = getWibInfo(targetTomorrowWib);
    const tomorrowDay = targetInfo.dayOfWeek;
    const tomorrowYmd = targetInfo.ymd;
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const tomorrowDayName = dayNames[tomorrowDay];

    if (tomorrowDay === 0 && !force) {
        console.log(`🕌 [Prayer Scheduler] Besok hari Minggu (libur sekolah). Tidak ada jadwal sholat berjamaah.`);
        return { sentStudents: 0, sentParents: 0, sentWa: 0, schedulesCount: 0, targetDayName: tomorrowDayName, targetDateStr: tomorrowYmd };
    }

    const holiday = await prisma.schoolHoliday.findUnique({ where: { date: tomorrowYmd } });
    if (holiday && !force) {
        console.log(`🕌 [Prayer Scheduler] Besok hari libur (${holiday.name}). Notifikasi sholat dilewati.`);
        return { sentStudents: 0, sentParents: 0, sentWa: 0, schedulesCount: 0, targetDayName: tomorrowDayName, targetDateStr: tomorrowYmd };
    }

    // Cegah duplikasi pengiriman otomatis di hari yang sama kecuali dipicu manual (force=true)
    if (!force && triggerType === 'AUTO') {
        const alreadyLogged = await prisma.auditLog.findFirst({
            where: {
                action: 'AUTO_PRAYER_H1_REMINDER',
                details: { contains: tomorrowYmd }
            }
        });
        if (alreadyLogged) {
            console.log(`🕌 [Prayer Scheduler] Pengingat Sholat H-1 otomatis untuk tanggal ${tomorrowYmd} sudah pernah dikirim.`);
            return { sentStudents: 0, sentParents: 0, sentWa: 0, schedulesCount: 0, targetDayName: tomorrowDayName, targetDateStr: tomorrowYmd };
        }
    }

    // Ambil seluruh jadwal sholat aktif untuk besok (Mendukung multi-sholat: Dhuha, Dhuhur, Jumat)
    let schedules = await (prisma as any).prayerClassSchedule.findMany({
        where: { dayOfWeek: tomorrowDay, isActive: true },
        orderBy: { scanStartTime: 'asc' }
    });

    // Fallback jadwal default GPAI resmi jika database kosong
    if (schedules.length === 0) {
        if (tomorrowDay === 1) {
            schedules = [{ dayOfWeek: 1, dayName: 'SENIN', prayerType: 'DHUHUR', classNames: 'VII-F,VII-G,VIII-A,IX-A,IX-B', scanStartTime: '12:00', notes: 'Jadwal Sholat Dhuhur Berjamaah', isActive: true }];
        } else if (tomorrowDay === 2) {
            schedules = [{ dayOfWeek: 2, dayName: 'SELASA', prayerType: 'DHUHUR', classNames: 'VII-B,VII-C,VIII-B,VIII-C,IX-C,IX-D', scanStartTime: '12:00', notes: 'Jadwal Sholat Dhuhur Berjamaah', isActive: true }];
        } else if (tomorrowDay === 3) {
            schedules = [{ dayOfWeek: 3, dayName: 'RABU', prayerType: 'DHUHUR', classNames: 'VII-D,VII-E,VII-H,IX-E,IX-H', scanStartTime: '12:00', notes: 'Jadwal Sholat Dhuhur Berjamaah', isActive: true }];
        } else if (tomorrowDay === 4) {
            schedules = [{ dayOfWeek: 4, dayName: 'KAMIS', prayerType: 'DHUHUR', classNames: 'VII-A,VIII-F,VIII-G,IX-I', scanStartTime: '12:00', notes: 'Jadwal Sholat Dhuhur Berjamaah', isActive: true }];
        } else if (tomorrowDay === 5) {
            schedules = [
                { dayOfWeek: 5, dayName: 'JUMAT', prayerType: 'DHUHA', classNames: 'VII-I,VIII-H,VIII-I,IX-F,IX-J', scanStartTime: '07:00', notes: 'Jadwal Sholat Dhuha Berjamaah (Pagi)', isActive: true },
                { dayOfWeek: 5, dayName: 'JUMAT', prayerType: 'JUMAT', classNames: 'ALL_MALE', scanStartTime: '11:45', notes: 'Sholat Jumat Berjamaah Seluruh Siswa Putra di Masjid', isActive: true }
            ];
        } else if (tomorrowDay === 6) {
            schedules = [
                { dayOfWeek: 6, dayName: 'SABTU', prayerType: 'DHUHA', classNames: 'IX-K', scanStartTime: '07:00', notes: 'Jadwal Sholat Dhuha Berjamaah (Pagi)', isActive: true },
                { dayOfWeek: 6, dayName: 'SABTU', prayerType: 'DHUHUR', classNames: 'VII-J,VII-K,VIII-J,VIII-K,IX-G', scanStartTime: '12:00', notes: 'Jadwal Sholat Dhuhur Berjamaah', isActive: true }
            ];
        }
    }

    let totalStudentsNotified = 0;
    let totalParentsNotified = 0;
    let totalWaNotified = 0;

    for (const schedule of schedules) {
        const pType = schedule.prayerType || 'DHUHUR';
        const scanStartTime = schedule.scanStartTime || (pType === 'DHUHA' ? '07:00' : '12:00');
        const targetClasses = (schedule.classNames || '').split(',').map((c: string) => c.trim()).filter(Boolean);

        const studentQuery: any = {
            role: 'STUDENT',
            isActive: true,
            OR: [
                { religion: { in: ['Islam', 'ISLAM'] } },
                { religion: null },
                { religion: '' }
            ]
        };

        if (schedule.classNames === 'ALL_MALE') {
            studentQuery.gender = { in: ['L', 'LAKI-LAKI', 'Laki-laki', 'MALE', 'Male'] };
        } else if (!targetClasses.includes('ALL') && !targetClasses.includes('SEMUA')) {
            studentQuery.className = { in: targetClasses };
        }

        const students = await prisma.user.findMany({
            where: studentQuery,
            select: { id: true, name: true, className: true, gender: true, parentPhone: true }
        });

        for (const st of students) {
            totalStudentsNotified++;
            const titleSiswa = `🕌 Pengingat: Besok (${tomorrowDayName}) Jadwal Sholat ${pType} Berjamaah`;
            const msgSiswa = `Hai ${st.name}, besok (${tomorrowDayName}) kelas ${st.className || '-'} terjadwal Sholat ${pType} Berjamaah (Pukul ${scanStartTime} WIB) di Masjid/Mushola Sekolah. ⚠️ PENTING: Harap membawa perlengkapan & alat sholat lengkap dari rumah (sarung/peci bagi putra, mukena bersih bagi putri, serta sajadah pribadi). Bagi siswi yang berhalangan/uzur syar'i tetap hadir di ruang keputrian.`;

            // 1. In-App Notification Siswa
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientId: st.id,
                    recipientRole: 'STUDENT',
                    studentId: st.id,
                    studentName: st.name,
                    className: st.className,
                    title: titleSiswa,
                    message: msgSiswa,
                    category: 'ATTENDANCE'
                }
            }).catch(() => {});

            // 2. FCM Push Notification ke Perangkat Siswa
            sendFcmToUser(st.id, titleSiswa, msgSiswa, {
                type: 'PRAYER_H1_REMINDER',
                prayerType: pType,
                targetDate: tomorrowYmd
            }).catch(() => {});

            // 3. In-App Notification & FCM Orang Tua
            const titleOrtu = `🕌 Jadwal Sholat Berjamaah Besok: ${st.name} (Kelas ${st.className || '-'})`;
            const msgOrtu = `Bapak/Ibu Orang Tua/Wali, besok (${tomorrowDayName}, ${tomorrowYmd}) ananda ${st.name} memiliki jadwal Sholat ${pType} Berjamaah di Mushola/Masjid SMPN 1 Boyolangu pukul ${scanStartTime} WIB. ⚠️ MOHON DIPERHATIKAN: Mohon memastikan ananda membawa alat/perlengkapan sholat dari rumah (mukena untuk putri / sarung & peci untuk putra, serta sajadah). Terima kasih.`;

            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: st.id,
                    studentName: st.name,
                    className: st.className,
                    title: titleOrtu,
                    message: msgOrtu,
                    category: 'ATTENDANCE'
                }
            }).catch(() => {});

            // Cari akun orang tua terhubung untuk kirim FCM Push ke wali murid
            const parentLinks = await (prisma as any).parentStudentLink.findMany({
                where: { siswaId: st.id },
                include: { orangTua: true }
            }).catch(() => []);

            if (Array.isArray(parentLinks) && parentLinks.length > 0) {
                for (const link of parentLinks) {
                    if (link.orangTua?.userId) {
                        totalParentsNotified++;
                        sendFcmToUser(link.orangTua.userId, titleOrtu, msgOrtu, {
                            type: 'PRAYER_H1_REMINDER',
                            studentId: st.id,
                            prayerType: pType
                        }).catch(() => {});
                    }
                }
            } else {
                totalParentsNotified++;
            }

            // 4. WhatsApp ke orang tua jika ada nomor HP dan dipicu manual atau force
            if (st.parentPhone && (triggerType === 'MANUAL' || force)) {
                try {
                    const waText = `*PENGINGAT JADWAL SHOLAT BERJAMAAH & MEMBAWA ALAT SHOLAT*\nSMP NEGERI 1 BOYOLANGU\n\n${msgOrtu}`;
                    const waRes = await sendSingleWhatsApp(st.parentPhone, waText);
                    if (waRes?.success) totalWaNotified++;
                } catch (waErr) {}
            }
        }
    }

    // Simpan riwayat pengiriman ke AuditLog
    const auditAction = triggerType === 'MANUAL' ? 'MANUAL_PRAYER_H1_REMINDER' : 'AUTO_PRAYER_H1_REMINDER';
    await prisma.auditLog.create({
        data: {
            action: auditAction,
            details: JSON.stringify({
                targetDate: tomorrowYmd,
                targetDayName: tomorrowDayName,
                schedulesCount: schedules.length,
                sentStudents: totalStudentsNotified,
                sentParents: totalParentsNotified,
                sentWa: totalWaNotified,
                triggerType,
                executedAt: new Date()
            }),
            ipAddress: '127.0.0.1 (Scheduler Daemon)'
        }
    }).catch(() => {});

    console.log(`🕌 [Prayer Scheduler] Pengingat Sholat H-1 (${triggerType}) sukses diproses. Jadwal: ${schedules.length}, Siswa: ${totalStudentsNotified}, Ortu: ${totalParentsNotified}, WA: ${totalWaNotified}.`);
    return { sentStudents: totalStudentsNotified, sentParents: totalParentsNotified, sentWa: totalWaNotified, schedulesCount: schedules.length, targetDayName: tomorrowDayName, targetDateStr: tomorrowYmd };
}

export async function processPrayerReminders(now: Date = new Date()) {
    try {
        const wibInfo = getWibInfo(now);
        const hour = wibInfo.hour;
        const minute = wibInfo.minute;
        const currentTotalMinutes = hour * 60 + minute;
        const todayYmd = wibInfo.ymd;
        const todayDay = wibInfo.dayOfWeek;

        // 1. PENGINGAT H-1 (Setiap Hari Mulai Pukul 19:00 WIB s/d 23:59 WIB Otomatis)
        if (hour >= 19 && hour <= 23 && lastPrayerH1Date !== todayYmd) {
            const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const tomorrowInfo = getWibInfo(tomorrowDate);
            const tomorrowYmd = tomorrowInfo.ymd;

            // Pastikan belum pernah dieksekusi otomatis hari ini
            const alreadyLogged = await prisma.auditLog.findFirst({
                where: {
                    action: 'AUTO_PRAYER_H1_REMINDER',
                    details: { contains: tomorrowYmd }
                }
            });

            if (!alreadyLogged) {
                lastPrayerH1Date = todayYmd;
                await sendPrayerH1NotificationForDate(tomorrowDate, false, 'AUTO');
            } else {
                lastPrayerH1Date = todayYmd;
            }
        }

        // 2. PENGINGAT HARI H 1 JAM SEBELUM PELAKSANAAN SHOLAT (Mendukung Multi-Sholat: Dhuha, Dhuhur, Jumat)
        if (todayDay !== 0) {
            const todaySchedules = await (prisma as any).prayerClassSchedule.findMany({
                where: { dayOfWeek: todayDay, isActive: true },
                orderBy: { scanStartTime: 'asc' }
            });

            for (const schedule of todaySchedules) {
                const pType = schedule.prayerType || 'DHUHUR';
                const prayerTimeStr = schedule.scanStartTime || schedule.wudhuTime || (pType === 'DHUHA' ? '07:00' : (todayDay === 5 ? '11:45' : '12:00'));
                const [pH, pM] = prayerTimeStr.split(':').map(Number);
                const prayerMinutes = (pH || 12) * 60 + (pM || 0);
                const oneHourBeforeMinutes = prayerMinutes - 60; // 1 Jam sebelumnya

                const reminderKey = `${todayYmd}_${schedule.id || pType}_${pType}`;
                if (currentTotalMinutes >= oneHourBeforeMinutes && currentTotalMinutes <= oneHourBeforeMinutes + 15 && !sentPrayerDayOfMap.has(reminderKey)) {
                    sentPrayerDayOfMap.add(reminderKey);

                    const holiday = await prisma.schoolHoliday.findUnique({ where: { date: todayYmd } });
                    if (!holiday) {
                        const targetClasses = (schedule.classNames || '').split(',').map((c: string) => c.trim()).filter(Boolean);
                        const studentQuery: any = {
                            role: 'STUDENT',
                            isActive: true,
                            OR: [
                                { religion: { in: ['Islam', 'ISLAM'] } },
                                { religion: null },
                                { religion: '' }
                            ]
                        };
                        if (schedule.classNames === 'ALL_MALE') {
                            studentQuery.gender = { in: ['L', 'LAKI-LAKI', 'Laki-laki', 'MALE', 'Male'] };
                        } else if (!targetClasses.includes('ALL') && !targetClasses.includes('SEMUA')) {
                            studentQuery.className = { in: targetClasses };
                        }

                        const students = await prisma.user.findMany({
                            where: studentQuery,
                            select: { id: true, name: true, className: true }
                        });

                        for (const st of students) {
                            await (prisma as any).notificationMessage.create({
                                data: {
                                    recipientId: st.id,
                                    recipientRole: 'STUDENT',
                                    studentId: st.id,
                                    studentName: st.name,
                                    className: st.className,
                                    title: `🕌 Persiapan Sholat ${pType} (1 Jam Menuju Waktu Sholat)`,
                                    message: `Hai ${st.name}, 1 jam lagi (pukul ${prayerTimeStr} WIB) kelas ${st.className || '-'} terjadwal Sholat ${pType} Berjamaah di Masjid/Mushola. Mohon segera bersiap, mengambil wudhu, dan membawa peralatan sholat.`,
                                    category: 'ATTENDANCE'
                                }
                            }).catch(() => {});
                        }
                        console.log(`🕌 [Scheduler] Notifikasi Persiapan Sholat ${pType} (1 Jam Sebelumnya) terkirim ke ${students.length} siswa.`);
                    }
                }
            }
        }

        // 3. NOTIFIKASI OTOMATIS WHATSAPP KE ORANG TUA BEGITU WAKTU SHOLAT BERJAMAAH BERAKHIR
        // Memeriksa seluruh siswa yang berstatus hadir di sekolah (GATE_IN), tetapi tidak presensi sholat / keputrian
        if (todayDay !== 0) {
            const holiday = await prisma.schoolHoliday.findUnique({ where: { date: todayYmd } });
            const gateSettings = await prisma.gateSetting.findUnique({ where: { id: 'default' } });
            const isEarlyDismissalToday = Boolean(gateSettings?.isEmergencyGateOut || gateSettings?.isEarlyDismissal);

            if (!holiday && !isEarlyDismissalToday) {
                const todaySchedules = await (prisma as any).prayerClassSchedule.findMany({
                    where: { dayOfWeek: todayDay, isActive: true },
                    orderBy: { scanEndTime: 'asc' }
                });

                for (const schedule of todaySchedules) {
                    const pType = (schedule.prayerType || 'DHUHUR').toUpperCase();
                    const endTimeStr = schedule.scanEndTime || (pType === 'DHUHA' ? '07:45' : (todayDay === 5 ? '12:45' : '12:30'));
                    const [eH, eM] = endTimeStr.split(':').map(Number);
                    const endMinutes = (eH || 12) * 60 + (eM || 30);

                    // Sesi berakhir: dieksekusi begitu waktu sholat berakhir (rentang 0 s.d. 15 menit setelah scanEndTime)
                    const blastKey = `${todayYmd}_${schedule.id || pType}_${pType}_POST_BLAST`;
                    if (currentTotalMinutes >= endMinutes && currentTotalMinutes <= endMinutes + 15 && !sentPrayerPostBlastMap.has(blastKey)) {
                        sentPrayerPostBlastMap.add(blastKey);

                        console.log(`🕌 [Scheduler] Waktu Sholat ${pType} hari ini telah berakhir (${endTimeStr} WIB). Menjalankan deteksi otomatis & WhatsApp blast siswa bolos sholat...`);
                        try {
                            const { dispatchAbsentPrayerStudentsBlast } = require('../controllers/prayerAttendanceController');
                            const blastRes = await dispatchAbsentPrayerStudentsBlast(pType, now);
                            console.log(`🕌 [Scheduler] Hasil Blast Sholat ${pType}: Terkirim WA: ${blastRes.sentCount}, Gagal/Tanpa No: ${blastRes.failedCount}, Total Terdeteksi Bolos: ${blastRes.details.length}.`);

                            await prisma.auditLog.create({
                                data: {
                                    action: 'AUTO_PRAYER_ABSENT_BLAST',
                                    details: JSON.stringify({
                                        prayerType: pType,
                                        date: todayYmd,
                                        endTime: endTimeStr,
                                        sentCount: blastRes.sentCount,
                                        failedCount: blastRes.failedCount,
                                        detectedCount: blastRes.details.length
                                    }),
                                    ipAddress: '127.0.0.1 (SystemScheduler)'
                                }
                            }).catch(() => {});
                        } catch (blastErr: any) {
                            console.error(`[Scheduler Error] Gagal menjalankan dispatchAbsentPrayerStudentsBlast untuk ${pType}:`, blastErr.message);
                        }
                    }
                }

                // 4. SAFETY SWEEP AKHIR JAM KBM (Pukul 14:45 WIB)
                // Memastikan tidak ada siswa sholat Dhuhur yang terlewat jika jadwal disesuaikan saat KBM
                if (hour === 14 && minute >= 45 && minute <= 59 && lastPrayerMissedDate !== todayYmd) {
                    lastPrayerMissedDate = todayYmd;
                    try {
                        const { dispatchAbsentPrayerStudentsBlast } = require('../controllers/prayerAttendanceController');
                        await dispatchAbsentPrayerStudentsBlast('DHUHUR', now);
                    } catch (e) {}
                }
            }
        }
    } catch (err: any) {
        console.error('[Prayer Reminder Scheduler Error]', err.message);
    }
}

/**
 * 6. REKAP KETERLAMBATAN MINGGUAN KE ORANG TUA (Setiap Sabtu Pukul 13:00 WIB)
 * Menghitung rekap akumulasi berapa menit siswa terlambat selama 1 minggu dan mengirim notifikasi ke orang tua.
 */
let lastWeeklyLateDate = '';

export async function processWeeklyLateReportToParents(now: Date = new Date()) {
    try {
        const hour = now.getHours();
        const minute = now.getMinutes();
        const todayDay = now.getDay();
        const todayYmd = now.toISOString().substring(0, 10);

        // Jalankan setiap Sabtu pukul 13:00 WIB
        if (todayDay === 6 && hour === 13 && minute === 0 && lastWeeklyLateDate !== todayYmd) {
            lastWeeklyLateDate = todayYmd;
            await sendWeeklyLateReportInternal(now);
        }
    } catch (err: any) {
        console.error('[Weekly Late Report Scheduler Error]', err.message);
    }
}

export async function sendWeeklyLateReportInternal(referenceDate: Date = new Date()) {
    try {
        const endDate = getWibDayBounds(referenceDate).endOfDay;
        const past6Days = new Date(referenceDate);
        past6Days.setDate(past6Days.getDate() - 6);
        const startDate = getWibDayBounds(past6Days).startOfDay;

        // Ambil seluruh siswa aktif
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { id: true, name: true, className: true }
        });

        // Ambil seluruh presensi LATE dalam 6 hari terakhir
        const lateLogs = await prisma.attendance.findMany({
            where: {
                scanTime: { gte: startDate, lte: endDate },
                type: { in: ['GATE_IN', 'MANUAL_BK'] },
                status: 'LATE'
            },
            select: { userId: true, lateMinutes: true, scanTime: true }
        });

        // Petakan per studentId
        const studentLateMap = new Map<string, { count: number; totalMinutes: number }>();
        for (const log of lateLogs) {
            if (!studentLateMap.has(log.userId)) {
                studentLateMap.set(log.userId, { count: 0, totalMinutes: 0 });
            }
            const current = studentLateMap.get(log.userId)!;
            current.count += 1;
            current.totalMinutes += (log.lateMinutes || 0);
        }

        let sentCount = 0;
        for (const st of students) {
            const stats = studentLateMap.get(st.id);
            if (stats && stats.count > 0) {
                sentCount++;
                const lateMinutes = stats.totalMinutes > 0 ? stats.totalMinutes : (stats.count * 10);
                await (prisma as any).notificationMessage.create({
                    data: {
                        recipientRole: 'PARENT',
                        studentId: st.id,
                        studentName: st.name,
                        className: st.className,
                        title: `📊 Rekap Mingguan: Keterlambatan Ananda ${st.name}`,
                        message: `Bapak/Ibu Orang Tua/Wali dari ${st.name} (Kelas ${st.className || '-'}), evaluasi kehadiran sepekan ini: ananda tercatat terlambat ${stats.count}x dengan akumulasi ${lateMinutes} menit. Mohon bantuan Bapak/Ibu untuk memotivasi ananda hadir sebelum pukul 07:00:00 WIB.`,
                        category: 'ATTENDANCE'
                    }
                }).catch(() => {});
            }
        }
        console.log(`📊 [Scheduler] Rekap keterlambatan mingguan terkirim ke ${sentCount} orang tua.`);
        return { success: true, count: sentCount };
    } catch (err: any) {
        console.error('[sendWeeklyLateReportInternal Error]', err);
        return { success: false, error: err.message };
    }
}

let lastDailyAlpaDate = '';

/**
 * 2.4 Notifikasi Siswa Alpa Pukul 15:00 WIB [D14 / T-12]
 * Pukul 15:00 WIB setiap hari aktif KBM (Senin - Sabtu):
 * Mengambil siswa aktif yang hari itu ALPA (tidak ada rekaman presensi masuk,
 * dan bukan sakit, izin, dispensasi yang approved).
 * Saluran: Push Notification di aplikasi orang tua (BUKAN via WhatsApp).
 */
export async function processDailyAlpaNotification(now: Date = new Date()) {
    try {
        const wibInfo = getWibInfo(now);
        const { ymd: todayYmd, hour, minute, dayOfWeek } = wibInfo;

        // Hanya jalan pada hari sekolah aktif (Senin s/d Sabtu)
        if (dayOfWeek === 0) return;

        // Pukul 15:00 WIB (jendela 15:00 s/d 15:05 agar tidak terlewat)
        if (hour === 15 && minute >= 0 && minute <= 5 && lastDailyAlpaDate !== todayYmd) {
            lastDailyAlpaDate = todayYmd;
            console.log(`⏰ [Scheduler] Memproses notifikasi harian siswa ALPA ke orang tua pukul 15:00 WIB (${todayYmd})...`);
            await sendDailyAlpaPushNotifications(now);
        }
    } catch (err: any) {
        console.error('[Daily Alpa Notification Scheduler Error]', err.message);
    }
}

export async function sendDailyAlpaPushNotifications(referenceDate: Date = new Date()) {
    try {
        const wibInfo = getWibInfo(referenceDate);
        const todayYmd = wibInfo.ymd;

        const holiday = await prisma.schoolHoliday.findUnique({ where: { date: todayYmd } });
        if (holiday) {
            console.log(`[Daily Alpa] Hari ini libur sekolah (${holiday.name}). Dilewati.`);
            return { success: true, count: 0 };
        }

        const startOfDay = new Date(`${todayYmd}T00:00:00.000+07:00`);
        const endOfDay = new Date(`${todayYmd}T23:59:59.999+07:00`);

        // Ambil seluruh siswa aktif
        const activeStudents = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { id: true, name: true, className: true, nisn: true, username: true, parentPhone: true }
        });

        // Ambil data kehadiran hari ini (GATE_IN, MANUAL_BK, dll)
        const todayAttendances = await prisma.attendance.findMany({
            where: {
                scanTime: { gte: startOfDay, lte: endOfDay }
            },
            select: { userId: true, status: true, type: true }
        });
        const attendedUserIds = new Set(todayAttendances.map(a => a.userId));

        // Ambil siswa yang memiliki izin/sakit/dispensasi sah yang APPROVED hari ini
        const approvedLeaves = await (prisma as any).studentLeaveRequest.findMany({
            where: {
                status: 'APPROVED',
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            },
            select: { studentId: true }
        });
        const leaveUserIds = new Set(approvedLeaves.map((l: any) => l.studentId));

        // Ambil siswa di UKS hari ini
        const uksVisits = await (prisma as any).uksVisit.findMany({
            where: {
                checkInTime: { gte: startOfDay, lte: endOfDay }
            },
            select: { userId: true }
        });
        const uksUserIds = new Set(uksVisits.map((u: any) => u.userId));

        // Filter siswa murni ALPA (tidak hadir, tidak izin/sakit/dispensasi/UKS)
        const alpaStudents = activeStudents.filter(st =>
            !attendedUserIds.has(st.id) &&
            !leaveUserIds.has(st.id) &&
            !uksUserIds.has(st.id)
        );

        let sentCount = 0;
        const notifTitle = '⚠️ [SIBOY KEDISIPLINAN] Pemberitahuan Ketidakhadiran Siswa (Alpa)';

        for (const st of alpaStudents) {
            // Cegah duplikasi notifikasi ke orang tua hari ini
            const existingNotif = await prisma.notificationMessage.findFirst({
                where: {
                    studentId: st.id,
                    recipientRole: 'PARENT',
                    category: 'ATTENDANCE_ALPA',
                    sentAt: { gte: startOfDay, lte: endOfDay }
                }
            });
            if (existingNotif) continue;

            const notifMsg = `Yth. Bapak/Ibu Wali Murid dari ananda ${st.name} (Kelas ${st.className || '-'}), ananda tidak tercatat hadir di sekolah hari ini tanpa keterangan (Alpa). Jika ananda berhalangan hadir karena sakit atau kepentingan keluarga, mohon segera mengirimkan surat permohonan izin melalui aplikasi SIBOY atau menghubungi Wali Kelas.`;

            await prisma.notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: st.id,
                    studentName: st.name,
                    className: st.className,
                    recipientPhone: st.parentPhone,
                    title: notifTitle,
                    message: notifMsg,
                    category: 'ATTENDANCE_ALPA'
                }
            });

            // Kirim Push Notification FCM ke akun Orang Tua (BUKAN via WhatsApp sesuai D13 & D14)
            const cleanNisn = (st.nisn || st.username || '').replace(/^[Pp]/, '').trim();
            const parentUsers = await prisma.user.findMany({
                where: {
                    role: 'PARENT',
                    OR: [
                        { username: `P${cleanNisn}` },
                        { username: `p${cleanNisn}` },
                        { username: cleanNisn },
                        { nisn: cleanNisn },
                        ...(st.parentPhone ? [{ username: st.parentPhone }] : [])
                    ]
                }
            });

            for (const p of parentUsers) {
                await sendFcmToUser(p.id, notifTitle, notifMsg, {
                    type: 'ATTENDANCE_ALPA',
                    studentId: st.id,
                    studentName: st.name
                }).catch(() => {});
            }

            // ============================================================
            // KEBIJAKAN RESMI WHATSAPP: HANYA SISWA TERLAMBAT ATAU ALPA (FLAG AKTIF)
            // Siswa ALPA dikirimkan notifikasi WhatsApp resmi ke nomor HP orang tua yang terdaftar.
            // ============================================================
            if (WHATSAPP_NOTIFICATION_POLICY.isDispatchAllowed('ALPA') && st.parentPhone) {
                const todayFormatted = new Date().toLocaleDateString('id-ID', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                });

                const waAlpaNotice = `*PEMBERITAHUAN KETIDAKHADIRAN SISWA (ALPA)*\n` +
                    `*SMP NEGERI 1 BOYOLANGU*\n\n` +
                    `Yth. Bapak/Ibu Orang Tua / Wali Murid dari ananda *${st.name}* (Kelas ${st.className || '-'}),\n\n` +
                    `Kami menginformasikan bahwa hingga pukul 15:00 WIB hari ini, *${todayFormatted}*, ananda tercatat *TIDAK HADIR di sekolah tanpa keterangan (Alpa)*.\n\n` +
                    `Apabila ananda berhalangan hadir dikarenakan sakit atau keperluan keluarga, mohon segera mengirimkan surat permohonan izin melalui aplikasi SIBOY atau menghubungi Wali Kelas.\n\n` +
                    `Laporan kedisiplinan ini dikirimkan secara otomatis oleh Sistem Informasi Akademik SMPN 1 Boyolangu. Terima kasih atas kerja samanya.`;

                sendSingleWhatsApp(st.parentPhone, waAlpaNotice).catch(waErr => {
                    console.warn(`[WA Alpa Alert] Gagal kirim pesan ke ${st.parentPhone}:`, waErr.message);
                });
            }

            sentCount++;
        }

        await prisma.auditLog.create({
            data: {
                action: 'DAILY_ALPA_NOTIFICATION_1500',
                details: JSON.stringify({
                    date: todayYmd,
                    totalAlpa: alpaStudents.length,
                    sentCount,
                    executedAt: new Date()
                }),
                ipAddress: '127.0.0.1 (Scheduler Daemon)'
            }
        }).catch(() => {});

        console.log(`⏰ [Scheduler] Notifikasi ALPA pukul 15:00 WIB sukses terkirim ke ${sentCount} orang tua siswa.`);
        return { success: true, count: sentCount, totalAlpa: alpaStudents.length };
    } catch (err: any) {
        console.error('[sendDailyAlpaPushNotifications Error]', err);
        return { success: false, error: err.message };
    }
}

let lastGateOutNotifyDate = '';

/**
 * Otomatis mengirim notifikasi peringatan ke orang tua siswa yang hadir pagi tetapi belum scan pulang (Gate-Out).
 * Dijalankan pada sore hari pukul 16:15 WIB pada hari aktif sekolah.
 */
async function processGateOutUnscannedNotification(now: Date) {
    try {
        const todayDay = now.getDay();
        if (todayDay === 0) return; // Libur hari Minggu

        const hour = now.getHours();
        const minute = now.getMinutes();
        const todayYmd = now.toISOString().substring(0, 10);

        // Jalankan pada sore hari pukul 16:15 WIB (atau pemicu setelah jam kepulangan)
        if (hour === 16 && minute === 15 && lastGateOutNotifyDate !== todayYmd) {
            lastGateOutNotifyDate = todayYmd;
            console.log(`⏰ [Scheduler] Menjalankan auto-notify siswa belum scan pulang ke orang tua (${todayYmd})...`);
            await autoNotifyUnscannedGateOutStudents();
        }
    } catch (err: any) {
        console.error('[Gate-Out Unscanned Notification Scheduler Error]', err.message);
    }
}

/**
 * 1.6 Pemeliharaan Retensi Log Otomatis (Kebijakan Retensi 30 Hari SIBOY 2026):
 * Log otomatis dibersihkan setiap hari pukul 02:00 WIB:
 * 1. ActivityEventLog (createdAt < 30 hari)
 * 2. CopyRequest (requestedAt < 30 hari)
 * 3. AppClientErrorLog (createdAt < 30 hari)
 * 4. ActivityAnomaly terselesaikan (resolvedAt < 30 hari)
 */
export async function processLogRetentionCleanup() {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // 1. Hapus ActivityEventLog umum > 30 hari (Kecuali log audit akademik CBT/EXAM/RAPORT/NILAI yang disimpan permanen untuk bukti sengketa nilai)
        const deletedLogs = await prisma.activityEventLog.deleteMany({
            where: {
                createdAt: { lt: thirtyDaysAgo },
                module: { notIn: ['CBT', 'EXAM', 'RAPORT', 'NILAI', 'ACADEMIC'] }
            }
        });

        // 2. Hapus CopyRequest > 30 hari
        const deletedCopyRequests = await (prisma as any).copyRequest.deleteMany({
            where: { requestedAt: { lt: thirtyDaysAgo } }
        });

        // 3. Hapus AppClientErrorLog > 30 hari
        const deletedClientErrors = await (prisma as any).appClientErrorLog.deleteMany({
            where: { createdAt: { lt: thirtyDaysAgo } }
        });

        // 4. Hapus Anomali yang selesai > 30 hari
        const deletedAnomalies = await prisma.activityAnomaly.deleteMany({
            where: {
                status: 'RESOLVED',
                resolvedAt: { lt: thirtyDaysAgo }
            }
        });

        const totalCleaned = deletedLogs.count + deletedCopyRequests.count + deletedClientErrors.count + deletedAnomalies.count;
        if (totalCleaned > 0) {
            console.log(`🧹 [Retention Maintenance 30-Hari] Pembersihan otomatis: ${deletedLogs.count} log aktivitas, ${deletedCopyRequests.count} copy request, ${deletedClientErrors.count} error log klien, ${deletedAnomalies.count} anomali terselesaikan (>30 hari).`);
        }
        return {
            success: true,
            deletedLogs: deletedLogs.count,
            deletedCopyRequests: deletedCopyRequests.count,
            deletedClientErrors: deletedClientErrors.count,
            deletedAnomalies: deletedAnomalies.count,
            totalCleaned
        };
    } catch (e: any) {
        console.error('[Log Retention Cleanup Error]', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * 1.6b Pembersihan Refresh Token Kedaluwarsa:
 * Membersihkan seluruh refresh token yang telah melewati waktu kedaluwarsa secara berkala
 * agar tidak menumpuk di basis data dan mengoptimalkan performa tabel.
 */
export async function processRefreshTokenPrune() {
    try {
        const deleted = await (prisma as any).refreshToken.deleteMany({
            where: { expiresAt: { lt: new Date() } }
        });
        if (deleted.count > 0) {
            console.log(`🧹 [Retention Maintenance] Dihapus ${deleted.count} refresh token kedaluwarsa secara otomatis.`);
        }
    } catch (e: any) {
        console.error('[RefreshToken Prune Error]', e.message);
    }
}

/**
 * 1.7 Auto-Reset Kepulangan Darurat / Pulang Lebih Awal 1X:
 * Memastikan status darurat/pulang cepat otomatis kembali normal keesokan harinya tanpa intervensi manual.
 */
async function processGateSettingsDailyReset() {
    try {
        const settings = await prisma.gateSetting.findUnique({ where: { id: 'default' } });
        if (settings && (settings.isEmergencyGateOut || settings.isEarlyDismissal)) {
            const nowWib = new Date(Date.now() + 7 * 3600 * 1000).toISOString().substring(0, 10);
            const updatedWib = new Date(new Date(settings.updatedAt).getTime() + 7 * 3600 * 1000).toISOString().substring(0, 10);

            const isTestingForever = Boolean(
                settings.emergencyReason?.toLowerCase().includes('uji') || 
                settings.emergencyReason?.toLowerCase().includes('test') || 
                settings.emergencyReason?.toLowerCase().includes('trial')
            );

            if (updatedWib < nowWib && !isTestingForever) {
                console.log(`⏰ [Master Scheduler] Status Pulang Lebih Awal / Darurat tanggal ${updatedWib} telah berakhir. Mereset ke jadwal normal untuk hari ini ${nowWib}.`);
                await prisma.gateSetting.update({
                    where: { id: 'default' },
                    data: {
                        isEmergencyGateOut: false,
                        isEarlyDismissal: false,
                        emergencyReason: null
                    }
                });
            }
        }
    } catch (e: any) {
        console.error('[Master Scheduler Gate Reset Error]', e.message);
    }
}

/**
 * 1.8 Auto-Finalize & Cleanup Sesi Ujian CBT yang Kedaluwarsa:
 * Menutup otomatis sesi ONGOING / LOCKED jika jadwal ujian telah berakhir atau hari telah berganti,
 * sehingga lembar jawaban tersimpan aman dan tidak ada status terkunci yang menggantung di hari berikutnya.
 */
async function processExpiredStudentExams(now: Date) {
    try {
        const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
        const currentHour = String(new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }).format(now)).padStart(2, '0');
        const currentMinute = String(now.getMinutes()).padStart(2, '0');
        const nowTimeStr = `${currentHour}:${currentMinute}`;

        const hangingSessions = await prisma.studentExam.findMany({
            where: {
                status: { in: ['ONGOING', 'LOCKED', 'IN_PROGRESS', 'TERPUTUS', 'MENGERJAKAN'] }
            },
            include: {
                exam: {
                    include: { questions: true }
                }
            }
        });

        let finalizedCount = 0;
        if (hangingSessions.length > 0) {
            for (const se of hangingSessions) {
                const exam = se.exam;
                if (!exam) continue;

                const isPastDate = Boolean(exam.executionDate && exam.executionDate < todayYmd);
                const isPastTimeToday = Boolean(exam.executionDate === todayYmd && exam.endTimeStr && nowTimeStr > exam.endTimeStr);
                const isOver24Hours = (now.getTime() - new Date(se.startTime).getTime()) > (24 * 60 * 60 * 1000);

                if (isPastDate || isPastTimeToday || isOver24Hours) {
                    // Hitung skor otomatis dari jawaban yang tersimpan
                    let calculatedScore = 0;
                    let parsedAnswers: Record<string, string> = {};
                    try {
                        parsedAnswers = se.answers ? JSON.parse(se.answers) : {};
                    } catch (_) {}

                    const questions = exam.questions || [];
                    if (questions.length > 0) {
                        let correctCount = 0;
                        questions.forEach(q => {
                            const studentAns = (parsedAnswers[q.id] || '').trim().toUpperCase();
                            const correctAns = (q.correctOption || (q as any).correctAnswer || '').trim().toUpperCase();
                            if (studentAns && correctAns && studentAns === correctAns) {
                                correctCount++;
                            }
                        });
                        calculatedScore = Math.round((correctCount / questions.length) * 100);
                    }

                    await prisma.studentExam.update({
                        where: { id: se.id },
                        data: {
                            status: 'SUBMITTED',
                            score: calculatedScore,
                            endTime: now
                        }
                    });

                    finalizedCount++;
                }
            }
        }

        if (finalizedCount > 0) {
            console.log(`🧹 [CBT Auto-Finalize] ${finalizedCount} sesi ujian kedaluwarsa/terkunci otomatis difinalisasi & disubmit.`);
        }

        // 2. Auto-Finalize Sesi Ulangan Harian (UlanganHarianSubmission) yang sudah lewat waktu selesai
        const hangingUhSubmissions = await prisma.ulanganHarianSubmission.findMany({
            where: {
                status: 'MENGERJAKAN'
            },
            include: {
                ulangan: true
            }
        });

        let finalizedUhCount = 0;
        for (const uhSub of hangingUhSubmissions) {
            const uh = uhSub.ulangan;
            if (!uh) continue;

            const hasEndTimePassed = Boolean(uh.waktuSelesai && (now.getTime() > new Date(uh.waktuSelesai).getTime() + 60000));
            const isCreatedOld = (now.getTime() - new Date(uhSub.createdAt).getTime()) > ((uh.durasiMenit || 15) * 60 * 1000 + 120000);

            if (hasEndTimePassed || isCreatedOld) {
                let score = 0;
                let totalBenar = 0;
                let totalSalah = 0;

                try {
                    let answers: Record<string, any> = {};
                    if (uhSub.jawabanJson) {
                        answers = JSON.parse(uhSub.jawabanJson);
                    }
                    let questions: any[] = [];
                    if (uh.soalJson) {
                        questions = JSON.parse(uh.soalJson);
                    }

                    if (questions.length > 0) {
                        questions.forEach((q: any) => {
                            const studentAns = String(answers[q.id] || answers[String(q.orderNum)] || '').trim().toUpperCase();
                            const correctAns = String(q.correctOption || q.correctAnswer || '').trim().toUpperCase();
                            if (studentAns && correctAns && studentAns === correctAns) {
                                totalBenar++;
                            } else {
                                totalSalah++;
                            }
                        });
                        score = Number(((totalBenar / questions.length) * 100).toFixed(1));
                    }
                } catch (calcErr) {}

                await prisma.ulanganHarianSubmission.update({
                    where: { id: uhSub.id },
                    data: {
                        status: 'SELESAI',
                        nilai: score,
                        totalBenar,
                        totalSalah,
                        waktuSelesai: now
                    }
                });
                finalizedUhCount++;
            }
        }

        if (finalizedUhCount > 0) {
            console.log(`🧹 [UH Auto-Finalize] ${finalizedUhCount} sesi ulangan harian menggantung otomatis difinalisasi & diselesaikan.`);
        }
    } catch (err: any) {
        console.error('[processExpiredStudentExams Error]', err.message);
    }
}

/**
 * Auto-cleanup Kunjungan UKS yang Menggantung / Terlantar (Zombie Visits)
 * Jika siswa ditinggal di status aktif lebih dari 3 jam atau melewati pergantian hari,
 * otomatis selesaikan kunjungan & kosongkan bed agar ketersediaan kasur live selalu akurat.
 */
async function processUksZombieVisitsCleanup(now: Date) {
    try {
        const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

        const zombieVisits = await prisma.uksVisit.findMany({
            where: {
                visitStatus: {
                    in: ['WAITING', 'HEADING', 'AT_UKS', 'IN_TREATMENT', 'RESTING', 'WAITING_PICKUP']
                },
                checkInTime: {
                    lt: threeHoursAgo
                }
            }
        });

        if (zombieVisits.length === 0) return;

        let autoResolvedCount = 0;
        for (const visit of zombieVisits) {
            await prisma.uksVisit.update({
                where: { id: visit.id },
                data: {
                    visitStatus: 'FINISHED',
                    checkOutTime: now,
                    bedNumber: null,
                    restNotes: visit.restNotes 
                        ? `${visit.restNotes} | [Otomatis Ditutup Sistem (Batas Waktu Istirahat Terlampaui)]`
                        : '[Otomatis Ditutup Sistem (Batas Waktu Istirahat Terlampaui)]'
                }
            });
            autoResolvedCount++;
        }

        if (autoResolvedCount > 0) {
            console.log(`🏥 [UKS Scheduler] Berhasil melepaskan ${autoResolvedCount} kunjungan UKS menggantung & mengosongkan bed.`);
        }
    } catch (err: any) {
        console.error('[processUksZombieVisitsCleanup Error]:', err.message);
    }
}

