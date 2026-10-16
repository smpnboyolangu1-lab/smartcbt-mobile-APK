import prisma from '../utils/db';
import { broadcastMonitoringEvent, resetExamTokenTimer, setClassExamToken } from '../controllers/cbtController';
import { autoNotifyUnscannedGateOutStudents } from '../controllers/attendanceController';
import { sendFcmToUser } from './fcmService';
import { sendSingleWhatsApp } from './whatsappBlastService';

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

            // 7. NOTIFIKASI OTOMATIS SISWA BELUM SCAN PULANG KE ORANG TUA (Setiap Hari Sekolah Pukul 16:15 WIB)
            await processGateOutUnscannedNotification(now);

            // 8. PEMELIHARAAN LOG & ANOMALI BERKALA (Setiap Hari Pukul 02:00 WIB)
            if (now.getHours() === 2 && currentMinute === 0) {
                await processLogRetentionCleanup();
                await processRefreshTokenPrune();
            }

            // 9. AUTO-RESET KEPULANGAN DARURAT / PULANG LEBIH AWAL 1X (PERGANTIAN HARI)
            await processGateSettingsDailyReset();

            // 10. AUTO-FINALIZE & AUTO-CLEANUP SESI CBT KEDALUWARSA / GENTAYANGAN (LOCKED / ONGOING DARI HARI KEMARIN)
            if (currentMinute % 10 === 0) {
                await processExpiredStudentExams(now);
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
        processExpiredStudentExams(now).catch(() => {});
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

            // Jika saat ini KBM sudah berjalan minimal 5 menit dan belum selesai
            if (currentTotalMinutes >= startTotal + 5 && currentTotalMinutes <= endTotal) {
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
                            teacherStatus: 'BELUM_HADIR',
                            hasAssignment: false,
                            status: 'PENDING',
                            reporterName: 'Scheduler 5 Menit SIBOY'
                        }
                    });

                    // Notifikasi ke setiap Guru Piket yang bertugas hari ini
                    for (const piket of piketTeachers) {
                        await (prisma as any).notificationMessage.create({
                            data: {
                                recipientId: piket.teacherId,
                                recipientRole: 'TEACHER',
                                title: `⚠️ KELAS KOSONG: ${clsName} (>5 Menit)`,
                                message: `Kelas ${clsName} pada ${periodLabel} (Mapel: ${sch.subjectName}) belum dihadiri oleh ${sch.teacherName}. Waktu berlalu: ${elapsed} menit. Segera buka Posko Piket di APK untuk dampingi kelas.`,
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
                    console.log(`🚨 [Scheduler] Terdeteksi KELAS KOSONG: ${clsName} pada ${periodLabel}. Notifikasi dikirim ke ${piketTeachers.length} Guru Piket.`);
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
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

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
 * 6. PENGINGAT JADWAL SHOLAT BERJAMAAH (H-1 PUKUL 19.00 WIB & HARI-H 2 JAM SEBELUMNYA)
 * Otomatis mengecek hari Minggu dan Hari Libur Sekolah agar tidak mengganggu istirahat.
 */
let lastPrayerH1Date = '';
let lastPrayerDayOfDate = '';
let lastPrayerMissedDate = '';

/**
 * Fungsi core pengiriman notifikasi pengingat sholat H-1 (Pukul 19:00 WIB)
 * Mengirim notifikasi In-App Database, Push Notification FCM (Siswa & Orang Tua), dan WhatsApp Resmi ke Wali Murid
 */
export async function sendPrayerH1NotificationForDate(targetTomorrowWib: Date, force: boolean = false): Promise<{ sentStudents: number; sentParents: number; sentWa: number; schedulesCount: number; targetDayName: string; targetDateStr: string }> {
    const tomorrowDay = targetTomorrowWib.getDay();
    const tomorrowYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(targetTomorrowWib);
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

    // Cegah duplikasi pengiriman di hari yang sama kecuali dipicu manual (force=true)
    if (!force) {
        const alreadyLogged = await prisma.auditLog.findFirst({
            where: {
                action: 'AUTO_PRAYER_H1_REMINDER',
                details: { contains: tomorrowYmd }
            }
        });
        if (alreadyLogged) {
            console.log(`🕌 [Prayer Scheduler] Pengingat Sholat H-1 untuk tanggal ${tomorrowYmd} sudah pernah dikirim.`);
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
        let defaultClasses = "VII-F,VII-G,VIII-A,IX-A,IX-B";
        let defaultType = "DHUHUR";
        let defaultStartTime = "12:00";
        let defaultNotes = "Jadwal Sholat Dhuhur Berjamaah";

        if (tomorrowDay === 2) {
            defaultClasses = "VII-B,VII-C,VIII-B,VIII-C,IX-C,IX-D";
        } else if (tomorrowDay === 3) {
            defaultClasses = "VII-D,VII-E,VII-H,IX-E,IX-H";
        } else if (tomorrowDay === 4) {
            defaultClasses = "VII-A,VIII-F,VIII-G,IX-I";
        } else if (tomorrowDay === 5) {
            defaultClasses = "VII-I,VIII-H,VIII-I,IX-F,IX-J";
            defaultType = "DHUHA";
            defaultStartTime = "07:00";
            defaultNotes = "Jadwal Sholat Dhuha Berjamaah";
        } else if (tomorrowDay === 6) {
            defaultClasses = "VII-J,VII-K,VIII-J,VIII-K,IX-G";
        }

        schedules = [{
            dayOfWeek: tomorrowDay,
            dayName: tomorrowDayName.toUpperCase(),
            prayerType: defaultType,
            classNames: defaultClasses,
            scanStartTime: defaultStartTime,
            notes: defaultNotes,
            isActive: true
        }];
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
            const msgSiswa = `Hai ${st.name}, besok kelas ${st.className || '-'} terjadwal Sholat ${pType} Berjamaah (Pukul ${scanStartTime} WIB) di Mushola Sekolah. Harap membawa perlengkapan sholat pribadi (mukena / sarung / sajadah).`;

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
            const msgOrtu = `Bapak/Ibu Orang Tua/Wali, besok (${tomorrowDayName}, ${tomorrowYmd}) ananda ${st.name} memiliki jadwal Sholat ${pType} Berjamaah di Mushola SMPN 1 Boyolangu pukul ${scanStartTime} WIB. Mohon memastikan ananda membawa perlengkapan sholat dari rumah.`;

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

            // 4. WhatsApp Blast Otomatis ke Nomor Orang Tua
            const rawPhone = (st.parentPhone || '').trim().replace(/[^0-9]/g, '');
            if (rawPhone.length >= 9) {
                totalWaNotified++;
                const waText = `*PENGINGAT JADWAL SHOLAT BERJAMAAH SMPN 1 BOYOLANGU*\n\n` +
                    `Assalamu'alaikum Wr. Wb.\n` +
                    `Yth. Bapak/Ibu Orang Tua/Wali Murid dari:\n` +
                    `• *Nama Siswa:* ${st.name}\n` +
                    `• *Kelas:* ${st.className || '-'}\n\n` +
                    `Diberitahukan bahwa besok hari *${tomorrowDayName}, ${tomorrowYmd}*, ananda memiliki agenda ibadah:\n` +
                    `🕌 *Sholat ${pType} Berjamaah*\n` +
                    `⏰ *Waktu:* Pukul ${scanStartTime} WIB\n` +
                    `📍 *Tempat:* Mushola / Masjid SMP Negeri 1 Boyolangu\n\n` +
                    `Mohon bantuan Bapak/Ibu di rumah untuk:\n` +
                    `1. Memastikan ananda membawa perlengkapan sholat pribadi (mukena bagi siswi putri / sarung atau sajadah bagi siswa putra).\n` +
                    `2. Mengingatkan ananda untuk melakukan presensi sholat menggunakan scan barcode di mushola sekolah.\n\n` +
                    `Terima kasih atas perhatian dan kerja sama Bapak/Ibu.\nWassalamu'alaikum Wr. Wb.\n\n` +
                    `_Sistem Informasi Presensi Ibadah SMPN 1 Boyolangu_`;

                sendSingleWhatsApp(rawPhone, waText).catch((e: any) => {
                    console.warn(`[WA Prayer Reminder] Gagal kirim WA ke ${rawPhone}:`, e.message);
                });
            }
        }
    }

    // Simpan riwayat pengiriman ke AuditLog untuk mencegah duplikasi
    await prisma.auditLog.create({
        data: {
            action: 'AUTO_PRAYER_H1_REMINDER',
            details: JSON.stringify({
                targetDate: tomorrowYmd,
                targetDayName: tomorrowDayName,
                schedulesCount: schedules.length,
                sentStudents: totalStudentsNotified,
                sentParents: totalParentsNotified,
                sentWa: totalWaNotified,
                executedAt: new Date()
            }),
            ipAddress: '127.0.0.1 (Scheduler Daemon)'
        }
    }).catch(() => {});

    console.log(`🕌 [Prayer Scheduler] Pengingat Sholat H-1 Pukul 19:00 WIB sukses diproses. Jadwal: ${schedules.length}, Siswa: ${totalStudentsNotified}, Ortu: ${totalParentsNotified}, WA: ${totalWaNotified}.`);
    return { sentStudents: totalStudentsNotified, sentParents: totalParentsNotified, sentWa: totalWaNotified, schedulesCount: schedules.length, targetDayName: tomorrowDayName, targetDateStr: tomorrowYmd };
}

export async function processPrayerReminders(now: Date = new Date()) {
    try {
        // Gunakan zona waktu resmi WIB (Asia/Jakarta)
        const nowWibStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
        const nowWIB = new Date(nowWibStr);
        const hour = nowWIB.getHours();
        const minute = nowWIB.getMinutes();
        const currentTotalMinutes = hour * 60 + minute;
        const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
        const todayDay = nowWIB.getDay();

        // 1. PENGINGAT H-1 (Setiap Hari Pukul 19:00 WIB, dengan toleransi window 19:00 - 19:30)
        if (hour === 19 && minute >= 0 && minute <= 30 && lastPrayerH1Date !== todayYmd) {
            lastPrayerH1Date = todayYmd;
            const tomorrowWIB = new Date(nowWIB.getTime() + 24 * 60 * 60 * 1000);
            await sendPrayerH1NotificationForDate(tomorrowWIB, false);
        }

        // 2. PENGINGAT HARI H 1 JAM SEBELUM PELAKSANAAN SHOLAT
        if (todayDay !== 0) {
            const schedule = await (prisma as any).prayerClassSchedule.findFirst({
                where: { dayOfWeek: todayDay, isActive: true }
            });

            const prayerTimeStr = schedule?.scanStartTime || schedule?.wudhuTime || (todayDay === 5 ? '11:45' : '12:00');
            const [pH, pM] = prayerTimeStr.split(':').map(Number);
            const prayerMinutes = (pH || 12) * 60 + (pM || 0);
            const oneHourBeforeMinutes = prayerMinutes - 60; // 1 Jam sebelumnya

            if (currentTotalMinutes === oneHourBeforeMinutes && lastPrayerDayOfDate !== todayYmd) {
                lastPrayerDayOfDate = todayYmd;

                const holiday = await prisma.schoolHoliday.findUnique({ where: { date: todayYmd } });
                if (!holiday) {
                    let targetClasses: string[] = [];
                    if (schedule && schedule.classNames) {
                        targetClasses = schedule.classNames.split(',').map((c: string) => c.trim()).filter(Boolean);
                    } else {
                        if (todayDay === 1) targetClasses = ["VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K"];
                        else if (todayDay === 2) targetClasses = ["VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K"];
                        else if (todayDay === 3) targetClasses = ["IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K"];
                        else if (todayDay === 4) targetClasses = ["VII-F", "VII-G", "VIII-F", "VIII-G", "IX-F", "IX-G"];
                        else if (todayDay === 5) targetClasses = ["ALL"];
                        else if (todayDay === 6) targetClasses = ["ALL"];
                    }

                    const studentQuery: any = { 
                        role: 'STUDENT', 
                        isActive: true,
                        OR: [
                            { religion: { in: ['Islam', 'ISLAM'] } },
                            { religion: null },
                            { religion: '' }
                        ]
                    };
                    if (!targetClasses.includes('ALL') && !targetClasses.includes('ALL_MALE') && !targetClasses.includes('SEMUA')) {
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
                                title: `🕌 Persiapan Sholat Berjamaah (1 Jam Menuju Waktu Sholat)`,
                                message: `Hai ${st.name}, 1 jam lagi (pukul ${prayerTimeStr} WIB) kelas ${st.className || '-'} terjadwal Sholat Berjamaah di Mushola. Mohon segera bersiap, mengambil wudhu, dan membawa peralatan sholat.`,
                                category: 'ATTENDANCE'
                            }
                        }).catch(() => {});
                    }
                    console.log(`🕌 [Scheduler] Notifikasi Persiapan Sholat 1 Jam Sebelumnya terkirim ke ${students.length} siswa.`);
                }
            }
        }

        // 3. NOTIFIKASI KE ORANG TUA SETELAH JAM PULANG SELESAI (BAGI SISWA YANG TIDAK SCAN SHOLAT)
        // Dijalankan pukul 14:45 WIB saat jam kepulangan KBM selesai
        if (hour === 14 && minute === 45 && lastPrayerMissedDate !== todayYmd && todayDay !== 0) {
            lastPrayerMissedDate = todayYmd;

            const holiday = await prisma.schoolHoliday.findUnique({ where: { date: todayYmd } });
            const gateSettings = await prisma.gateSetting.findUnique({ where: { id: 'default' } });
            const isEarlyDismissalToday = Boolean(gateSettings?.isEmergencyGateOut || gateSettings?.isEarlyDismissal);

            if (isEarlyDismissalToday) {
                console.log(`🕌 [Scheduler] Hari ini diberlakukan kepulangan lebih awal / darurat. Notifikasi tidak sholat dibatalkan (prioritas dipulangkan ke rumah).`);
            }

            if (!holiday && !isEarlyDismissalToday) {
                const schedule = await (prisma as any).prayerClassSchedule.findFirst({
                    where: { dayOfWeek: todayDay, isActive: true }
                });

                let targetClasses: string[] = [];
                const pType = todayDay === 5 ? 'JUMAT' : (schedule?.prayerType || 'DHUHUR');

                if (schedule && schedule.classNames) {
                    targetClasses = schedule.classNames.split(',').map((c: string) => c.trim()).filter(Boolean);
                } else {
                    if (todayDay === 1) targetClasses = ["VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K"];
                    else if (todayDay === 2) targetClasses = ["VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K"];
                    else if (todayDay === 3) targetClasses = ["IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K"];
                    else if (todayDay === 4) targetClasses = ["VII-F", "VII-G", "VIII-F", "VIII-G", "IX-F", "IX-G"];
                    else if (todayDay === 5) targetClasses = ["ALL"];
                    else if (todayDay === 6) targetClasses = ["ALL"];
                }

                const studentQuery: any = { 
                    role: 'STUDENT', 
                    isActive: true,
                    OR: [
                        { religion: { in: ['Islam', 'ISLAM'] } },
                        { religion: null },
                        { religion: '' }
                    ]
                };
                if (!targetClasses.includes('ALL') && !targetClasses.includes('ALL_MALE') && !targetClasses.includes('SEMUA')) {
                    studentQuery.className = { in: targetClasses };
                }

                const scheduledStudents = await prisma.user.findMany({
                    where: studentQuery,
                    select: { id: true, name: true, className: true, gender: true }
                });

                // Ambil seluruh presensi sholat hari ini
                const prayerLogs = await (prisma as any).studentPrayerAttendance.findMany({
                    where: { date: todayYmd, prayerType: pType }
                });
                const attendedStudentIds = new Set(prayerLogs.map((p: any) => p.studentId));

                // Ambil presensi gerbang hari ini (untuk tidak menuduh siswa yang memang izin/sakit/tidak masuk)
                const todayStart = new Date(now);
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date(now);
                todayEnd.setHours(23, 59, 59, 999);

                const gateLogs = await prisma.attendance.findMany({
                    where: {
                        scanTime: { gte: todayStart, lte: todayEnd },
                        type: { in: ['GATE_IN', 'MANUAL_BK'] }
                    },
                    select: { userId: true, status: true }
                });
                const gatePresentIds = new Set(gateLogs.filter(g => g.status === 'PRESENT' || g.status === 'LATE').map(g => g.userId));

                let missedCount = 0;
                for (const st of scheduledStudents) {
                    // Hanya periksa siswa yang memang hadir di sekolah hari ini tapi tidak scan sholat dan tidak izin berhalangan
                    const isAttendedPrayer = attendedStudentIds.has(st.id);
                    const isPresentAtSchool = gatePresentIds.has(st.id);

                    if (isPresentAtSchool && !isAttendedPrayer) {
                        missedCount++;
                        await (prisma as any).notificationMessage.create({
                            data: {
                                recipientRole: 'PARENT',
                                studentId: st.id,
                                studentName: st.name,
                                className: st.className,
                                title: `⚠️ Laporan Ibadah: Ananda ${st.name} Tidak Melaksanakan Sholat`,
                                message: `Pemberitahuan Wali Murid: Ananda ${st.name} (Kelas ${st.className || '-'}) hari ini hadir di sekolah namun TIDAK tercatat melaksanakan Sholat ${pType} Berjamaah di Mushola SMPN 1 Boyolangu.`,
                                category: 'ATTENDANCE'
                            }
                        }).catch(() => {});
                    }
                }
                console.log(`🕌 [Scheduler] Laporan Tidak Sholat Pasca-KBM terkirim ke orang tua untuk ${missedCount} siswa.`);
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
        // Rentang 6 hari terakhir (Senin s/d Sabtu)
        const endDate = new Date(referenceDate);
        endDate.setHours(23, 59, 59, 999);
        const startDate = new Date(referenceDate);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);

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
 * 1.6 Pemeliharaan Retensi:
 * Log otomatis dibersihkan setelah 90 hari, anomali yang selesai dibersihkan setelah 180 hari.
 */
async function processLogRetentionCleanup() {
    try {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const deletedLogs = await prisma.activityEventLog.deleteMany({
            where: { createdAt: { lt: ninetyDaysAgo } }
        });

        const oneEightyDaysAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        const deletedAnomalies = await prisma.activityAnomaly.deleteMany({
            where: {
                status: 'RESOLVED',
                resolvedAt: { lt: oneEightyDaysAgo }
            }
        });

        if (deletedLogs.count > 0 || deletedAnomalies.count > 0) {
            console.log(`🧹 [Retention Maintenance] Dihapus ${deletedLogs.count} log aktivitas (>90 hari) dan ${deletedAnomalies.count} anomali terselesaikan (>180 hari).`);
        }
    } catch (e: any) {
        console.error('[Log Retention Cleanup Error]', e.message);
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
