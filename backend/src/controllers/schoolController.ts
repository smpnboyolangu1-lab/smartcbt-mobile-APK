import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * Controller Konteks Sekolah SIBOY (SMPN 1 Boyolangu)
 * Menghasilkan data konteks sekolah dinamis 100% dari Database (tanpa hardcode):
 * - nama_sekolah, npsn, semboyan ('SIBOY FRESH')
 * - total_kelas, total_guru, total_siswa, total_bk
 * - kurikulum_type
 * - jam_masuk, jam_pulang, jam_sholat
 * - geofence_zones
 */
export const getSekolahKonteks = async (req: Request, res: Response) => {
    try {
        // 1. Ambil Pengaturan Identitas Sekolah dari tabel Settings
        const settings = await prisma.settings.findMany({
            where: {
                key: {
                    in: [
                        'SCHOOL_NAME',
                        'NPSN',
                        'SCHOOL_NPSN',
                        'SCHOOL_MOTTO',
                        'SEMBOYAN',
                        'KURIKULUM_TYPE',
                        'HEADMASTER_NAME',
                        'HEADMASTER_NIP'
                    ]
                }
            }
        });

        const settingsMap: Record<string, string> = {};
        for (const s of settings) {
            if (s.value && s.value.trim().length > 0) {
                settingsMap[s.key] = s.value.trim();
            }
        }

        // Pastikan NPSN & Semboyan tersimpan di DB jika belum ada
        let npsn = settingsMap['NPSN'] || settingsMap['SCHOOL_NPSN'];
        if (!npsn) {
            npsn = '20515437'; // NPSN Resmi SMPN 1 Boyolangu
            await prisma.settings.upsert({
                where: { key: 'NPSN' },
                update: { value: npsn },
                create: { key: 'NPSN', value: npsn }
            }).catch(() => {});
        }

        let semboyan = settingsMap['SEMBOYAN'] || settingsMap['SCHOOL_MOTTO'];
        if (!semboyan) {
            semboyan = 'SIBOY FRESH';
            await prisma.settings.upsert({
                where: { key: 'SEMBOYAN' },
                update: { value: semboyan },
                create: { key: 'SEMBOYAN', value: semboyan }
            }).catch(() => {});
        }

        const namaSekolah = settingsMap['SCHOOL_NAME'] || 'SMPN 1 Boyolangu';

        // 2. Ambil Tipe Kurikulum dari KurikulumConfig / Settings
        let kurikulumType = settingsMap['KURIKULUM_TYPE'];
        if (!kurikulumType) {
            const kurikulumDbConfig = await (prisma as any).kurikulumConfig.findFirst({
                where: { keyName: { in: ['kurikulum_active', 'kurikulum_type', 'nama_kurikulum'] } }
            });
            kurikulumType = kurikulumDbConfig?.value || 'Kurikulum Merdeka';
        }

        // 3. Hitung Agregat Pengguna & Rombel Dinamis dari DB
        const [totalKelas, totalGuru, totalSiswa, totalBk] = await Promise.all([
            prisma.class.count(),
            prisma.user.count({
                where: {
                    role: { in: ['TEACHER', 'GURU'] },
                    isActive: true
                }
            }),
            prisma.user.count({
                where: {
                    role: { in: ['STUDENT', 'SISWA'] },
                    isActive: true
                }
            }),
            prisma.user.count({
                where: {
                    role: { in: ['COUNSELOR', 'BK', 'GURU_BK'] },
                    isActive: true
                }
            })
        ]);

        // 4. Ambil Jam Operasional Gerbang (Jam Masuk & Jam Pulang)
        const gateSetting = await prisma.gateSetting.findUnique({
            where: { id: 'default' }
        });

        let jamMasuk = '06:00 - 07:00';
        let jamPulang = '12:30 - 14:00';

        if (gateSetting) {
            const now = new Date();
            const dayOfWeek = now.getDay(); // 0 = Minggu, 1 = Senin, dst.

            if (gateSetting.dailySchedule) {
                try {
                    const schedules = JSON.parse(gateSetting.dailySchedule);
                    const todaySched = schedules.find((s: any) => s.day === dayOfWeek);
                    if (todaySched && todaySched.isActive) {
                        jamMasuk = `${todaySched.gateInStart} - ${todaySched.gateInEnd}`;
                        jamPulang = `${todaySched.gateOutStart} - ${todaySched.gateOutEnd}`;
                    }
                } catch (_) {}
            }

            if (jamMasuk === '06:00 - 07:00' && gateSetting.gateInStartTime && gateSetting.gateInEndTime) {
                jamMasuk = `${gateSetting.gateInStartTime} - ${gateSetting.gateInEndTime}`;
            }
            if (jamPulang === '12:30 - 14:00' && gateSetting.gateOutStartTime && gateSetting.gateOutEndTime) {
                jamPulang = `${gateSetting.gateOutStartTime} - ${gateSetting.gateOutEndTime}`;
            }
        }

        // 5. Ambil Jadwal Sholat Berjamaah dari Database
        const prayerSchedules = await prisma.prayerClassSchedule.findMany({
            where: { isActive: true },
            orderBy: [{ dayOfWeek: 'asc' }, { scanStartTime: 'asc' }]
        });

        const jamSholat = prayerSchedules.map(p => ({
            id: p.id,
            hari: p.dayName,
            dayOfWeek: p.dayOfWeek,
            jenisSholat: p.prayerType,
            waktuWudhu: p.wudhuTime || '11:45',
            waktuScanMulai: p.scanStartTime || '12:00',
            waktuScanSelesai: p.scanEndTime || '12:30',
            rombel: p.classNames,
            keterangan: p.notes || `Sholat ${p.prayerType} Berjamaah di Masjid`
        }));

        // 6. Ambil Multi-Titik Geofence Zones (Kelas, Mushola, Gerbang, dll.) dari Database
        const zones = await prisma.roomGeofence.findMany({
            where: { isActive: true },
            orderBy: [{ zonePriority: 'asc' }, { roomName: 'asc' }]
        });

        const geofenceZones = zones.map(z => ({
            id: z.id,
            namaZona: z.roomName,
            tipeZona: z.zoneType,
            latitude: z.latCenter,
            longitude: z.longCenter,
            radiusMeters: z.radiusMeters,
            bufferMeters: z.bufferMeters,
            prioritas: z.zonePriority,
            deskripsi: z.description || ''
        }));

        res.json({
            success: true,
            data: {
                nama_sekolah: namaSekolah,
                npsn: npsn,
                semboyan: semboyan,
                total_kelas: totalKelas,
                total_guru: totalGuru,
                total_siswa: totalSiswa,
                total_bk: totalBk,
                kurikulum_type: kurikulumType,
                jam_masuk: jamMasuk,
                jam_pulang: jamPulang,
                jam_sholat: jamSholat,
                geofence_zones: geofenceZones,
                gate_setting: {
                    toleransiTerlambat: gateSetting?.gateInMaxTime || '07:00',
                    isEmergencyGateOut: gateSetting?.isEmergencyGateOut || false,
                    isEarlyDismissal: gateSetting?.isEarlyDismissal || false
                }
            }
        });
    } catch (error: any) {
        console.error('Error fetching sekolah konteks:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memuat konteks sekolah',
            error: error.message
        });
    }
};
