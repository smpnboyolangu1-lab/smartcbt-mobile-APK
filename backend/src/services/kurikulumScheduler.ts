import prisma from '../utils/db';
import { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;
let notifiedEmptySchedules = new Set<string>(); // Set of `${jadwalId}_${dateStr}` to avoid duplicate alerts

export const setKurikulumSocketIO = (io: SocketIOServer) => {
    ioInstance = io;
};

/**
 * SCHEDULER MONITORING KELAS KOSONG REAL-TIME (Dijalankan setiap 1 menit)
 * Logic sesuai Dokumen SIBOY FRESH:
 * 1. Ambil jam sekarang WIB
 * 2. Cari jadwal yang SEDANG BERLANGSUNG
 * 3. Untuk setiap jadwal, cek apakah guru sudah tab absen
 * 4. Jika belum absen dan selisih > 5 menit:
 *    -> Catat KELAS KOSONG
 *    -> Notifikasi Guru Piket (HIGH Priority)
 *    -> Emit Socket.io ke Tim Kurikulum
 */
export const runKelasKosongScheduler = async () => {
    try {
        const now = new Date();
        const dateStr = now.toISOString().substring(0, 10);
        const dayOfWeek = now.getDay();
        const dayNames = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
        const todayDayName = dayNames[dayOfWeek];

        // Jangan proses di hari Minggu
        if (todayDayName === 'MINGGU') return;

        const currentHours = String(now.getHours()).padStart(2, '0');
        const currentMinutes = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${currentHours}:${currentMinutes}`;
        const currentTotalMinutes = Number(currentHours) * 60 + Number(currentMinutes);

        // 1. Ambil semua jadwal yang SEDANG BERLANGSUNG hari ini
        const ongoingSchedules = await prisma.teachingSchedule.findMany({
            where: {
                hari: todayDayName,
                jamMulai: { lte: currentTimeStr },
                jamSelesai: { gte: currentTimeStr }
            }
        });

        if (ongoingSchedules.length === 0) return;

        // 2. Ambil absensi guru hari ini
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        const [teacherAtts, teacherUsers, piketTeachers] = await Promise.all([
            (prisma as any).teacherGeofenceAttendance.findMany({
                where: { waktuTabMasukServer: { gte: todayStart, lte: todayEnd } }
            }).catch(() => []),
            prisma.user.findMany({
                where: { role: 'TEACHER' },
                select: { id: true, name: true }
            }),
            prisma.piketSchedule.findMany({
                where: { dayOfWeek, isActive: true },
                select: { teacherId: true }
            })
        ]);

        const userMap = new Map(teacherUsers.map(u => [u.id, u.name]));

        for (const schedule of ongoingSchedules) {
            // Cek apakah guru sudah melakukan absensi masuk
            const attended = teacherAtts.some((a: any) => a.guruId === schedule.guruId && a.jadwalId === schedule.id);
            if (attended) {
                // Guru hadir -> Skip
                continue;
            }

            // Hitung selisih menit dari jam mulai KBM
            const [startH, startM] = schedule.jamMulai.split(':').map(Number);
            const startTotalMinutes = startH * 60 + startM;
            const selisihMenit = Math.max(0, currentTotalMinutes - startTotalMinutes);

            // Ambang batas toleransi: > 5 menit tanpa kehadiran = KELAS KOSONG
            if (selisihMenit > 5) {
                const scheduleKey = `${schedule.id}_${dateStr}`;
                const teacherName = userMap.get(schedule.guruId) || 'Guru Pengampu';

                // Simpan atau update di kelas_kosong_log
                try {
                    const existingLog = await (prisma as any).kelasKosongLog.findFirst({
                        where: {
                            jadwalId: schedule.id,
                            tanggal: todayStart
                        }
                    });

                    if (!existingLog) {
                        await (prisma as any).kelasKosongLog.create({
                            data: {
                                jadwalId: schedule.id,
                                kelasId: schedule.kelasId,
                                kelasNama: schedule.kelasId,
                                guruId: schedule.guruId,
                                guruNama: teacherName,
                                mapelId: schedule.mapelId,
                                tanggal: todayStart,
                                jamMulai: schedule.jamMulai,
                                jamSelesai: schedule.jamSelesai,
                                menitKosong: selisihMenit,
                                status: 'KOSONG'
                            }
                        });
                    } else if (existingLog.status === 'KOSONG') {
                        await (prisma as any).kelasKosongLog.update({
                            where: { id: existingLog.id },
                            data: { menitKosong: selisihMenit }
                        });
                    }
                } catch (dbErr) {
                    console.warn('[KurikulumScheduler] Error log kelas kosong:', dbErr);
                }

                // Kirim notifikasi jika belum dinotifikasi pada sesi ini
                if (!notifiedEmptySchedules.has(scheduleKey)) {
                    notifiedEmptySchedules.add(scheduleKey);

                    const alertTitle = '🚨 PERINGATAN: KELAS KOSONG TERDETEKSI';
                    const alertMsg = `Kelas ${schedule.kelasId} (${schedule.mapelId}) kosong selama ${selisihMenit} menit. Guru pengampu (${teacherName}) belum melakukan presensi KBM. Dimohon Guru Piket segera mendampingi.`;

                    // Notifikasi ke seluruh Guru Piket hari ini
                    for (const piket of piketTeachers) {
                        await (prisma as any).notificationMessage.create({
                            data: {
                                recipientId: piket.teacherId,
                                recipientRole: 'TEACHER',
                                title: alertTitle,
                                message: alertMsg,
                                category: 'KELAS_KOSONG_ALERT'
                            }
                        }).catch(() => {});
                    }

                    // Sesuai kebijakan data riil: Laporan Posko Piket (emptyClassReport) hanya diisi oleh
                    // laporan riil Pengurus Kelas/Siswa/Guru secara otentik, bukan digenerate otomatis tanpa konfirmasi.

                    // Emit Socket.io ke room kurikulum & global broadcast jika ada socket aktif
                    if (ioInstance) {
                        ioInstance.to('kurikulum').emit('kelas_kosong_alert', {
                            jadwalId: schedule.id,
                            kelasId: schedule.kelasId,
                            mapelId: schedule.mapelId,
                            guruNama: teacherName,
                            jamMulai: schedule.jamMulai,
                            menitKosong: selisihMenit,
                            status: 'KOSONG'
                        });
                        ioInstance.emit('kelas_kosong_broadcast', {
                            kelasId: schedule.kelasId,
                            mapelId: schedule.mapelId,
                            menitKosong: selisihMenit
                        });
                    }
                }
            }
        }
    } catch (err: any) {
        console.error('[KurikulumScheduler] Error running monitoring scheduler:', err.message);
    }
};

/**
 * Inisialisasi Daemon Interval Kurikulum
 */
export const initKurikulumScheduler = (io?: SocketIOServer) => {
    if (io) ioInstance = io;
    console.log('⏰ [Kurikulum Scheduler] Memulai Daemon Monitoring Kelas Kosong (setiap 60s)...');
    
    // Jalankan pertama kali setelah 5 detik
    setTimeout(() => {
        runKelasKosongScheduler();
    }, 5000);

    // Jalankan interval per 60 detik (1 menit)
    setInterval(() => {
        runKelasKosongScheduler();
    }, 60000);
};
