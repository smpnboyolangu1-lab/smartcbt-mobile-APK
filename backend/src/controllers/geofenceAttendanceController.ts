import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getWibDayBounds } from '../utils/dateUtils';

const prisma = new PrismaClient();

/**
 * Formula Haversine untuk kalkulasi jarak radius meter secara akurat
 */
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Radius bumi dalam meter
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Parsing jam "HH:mm" menjadi menit dari tengah malam (WIB)
 */
function timeToMinutes(timeStr: string): number {
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// ========================================================
// 1. GURU: TAB MASUK & SELESAI MENGAJAR
// ========================================================
export const teacherTabAttendance = async (req: Request, res: Response) => {
    try {
        const {
            guruId,
            jadwalId,
            requestId,
            waktuTabMasukDevice,
            lat,
            long,
            deviceId,
            wifiSsid,
            fotoVerifikasiUrl,
            isMockGps,
            isDevModeActive,
            isRooted,
            type // 'MASUK' atau 'SELESAI'
        } = req.body;

        if (!guruId || !jadwalId || !requestId) {
            return res.status(400).json({ success: false, message: 'guruId, jadwalId, dan requestId wajib diisi' });
        }

        // 1. Idempotency Check: Cegah duplikasi aksi tab yang sama
        const existingTab = await prisma.teacherGeofenceAttendance.findUnique({
            where: { requestId }
        });
        if (existingTab) {
            return res.json({
                success: true,
                message: 'Aksi tab sudah tercatat sebelumnya (Idempotent)',
                data: existingTab
            });
        }

        // 2. Ambil detail Jadwal Mengajar & Ruangan Geofence
        const schedule = await prisma.teachingSchedule.findUnique({
            where: { id: jadwalId }
        });

        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Jadwal mengajar tidak ditemukan' });
        }

        // Cek apakah guru sudah di-izin-kan oleh Operator
        const activeLeave = await prisma.teacherLeavePermit.findFirst({
            where: { jadwalId, status: 'APPROVED' }
        });
        if (activeLeave) {
            return res.status(403).json({
                success: false,
                message: `Jadwal ini telah dialihkan status Izin (${activeLeave.kategoriIzin}) oleh operator. Tab dinonaktifkan.`
            });
        }

        // 3. Lapisan Anti-Fraud: Device-Binding Verification
        if (deviceId) {
            const registeredDevice = await prisma.registeredDevice.findFirst({
                where: { userId: guruId, statusAktif: true }
            });

            if (registeredDevice && registeredDevice.deviceId !== deviceId) {
                // Catat anomali device mismatch
                await prisma.attendanceAnomalyLog.create({
                    data: {
                        userId: guruId,
                        jenisAnomali: 'DEVICE_MISMATCH',
                        detail: JSON.stringify({
                            registered: registeredDevice.deviceId,
                            attempted: deviceId,
                            scheduleId: jadwalId
                        })
                    }
                });
                return res.status(403).json({
                    success: false,
                    message: 'Perangkat ini tidak terdaftar untuk akun Anda. Harap ajukan pergantian perangkat ke Admin/Operator.'
                });
            } else if (!registeredDevice) {
                // Auto-register first device if none exists
                await prisma.registeredDevice.create({
                    data: {
                        userId: guruId,
                        deviceId,
                        statusAktif: true,
                        notes: 'Pendaftaran otomatis device pertama'
                    }
                });
            }
        }

        // 4. Lapisan Anti-Fraud: Deteksi Mock GPS, Root, & Dev Mode
        if (isMockGps) {
            await prisma.attendanceAnomalyLog.create({
                data: {
                    userId: guruId,
                    jenisAnomali: 'MOCK_LOCATION',
                    detail: JSON.stringify({ lat, long, wifiSsid, scheduleId: jadwalId })
                }
            });
            return res.status(403).json({
                success: false,
                message: 'Deteksi Fake GPS / Mock Location aktif. Presensi ditolak!'
            });
        }

        if (isRooted || isDevModeActive) {
            await prisma.attendanceAnomalyLog.create({
                data: {
                    userId: guruId,
                    jenisAnomali: isRooted ? 'ROOT_DETECTED' : 'DEV_MODE',
                    detail: JSON.stringify({ isRooted, isDevModeActive, scheduleId: jadwalId })
                }
            });
        }

        // 5. Validasi Geofencing & Jendela Waktu Server (WIB)
        const nowServer = new Date();
        const { hour: wibHour, minute: wibMinute } = getWibDayBounds(nowServer);
        const serverMinutes = wibHour * 60 + wibMinute;
        const startMinutes = timeToMinutes(schedule.jamMulai);
        const endMinutes = timeToMinutes(schedule.jamSelesai);

        // Ambil data geofence ruangan kelas
        const roomGeofence = await prisma.roomGeofence.findFirst({
            where: {
                OR: [
                    { classId: schedule.kelasId },
                    { roomName: schedule.roomName || '' }
                ],
                isActive: true
            }
        });

        let finalStatus = 'TEPAT_WAKTU';
        let isGpsWeak = false;

        // Validasi Geofence jika koordinat tersedia
        if (roomGeofence && lat != null && long != null) {
            const distance = calculateDistanceMeters(lat, long, roomGeofence.latCenter, roomGeofence.longCenter);
            const maxRadius = roomGeofence.radiusMeters || 35.0;

            if (distance > maxRadius) {
                // Jika di luar radius, cek lapisan kedua: WiFi SSID sekolah
                if (roomGeofence.validWifiSsid && wifiSsid && wifiSsid === roomGeofence.validWifiSsid) {
                    finalStatus = 'PERLU_VERIFIKASI_MANUAL';
                    isGpsWeak = true;
                } else {
                    await prisma.attendanceAnomalyLog.create({
                        data: {
                            userId: guruId,
                            jenisAnomali: 'GEOFENCE_VIOLATION',
                            detail: JSON.stringify({
                                distanceMeters: Math.round(distance),
                                maxRadius,
                                userCoords: { lat, long },
                                centerCoords: { lat: roomGeofence.latCenter, long: roomGeofence.longCenter }
                            })
                        }
                    });
                    finalStatus = 'PERLU_VERIFIKASI_MANUAL'; // Jangan langsung alpa, masukkan antrian verifikasi manual kurikulum
                }
            }
        } else if (lat == null || long == null) {
            // Kasus GPS gagal di dalam gedung beton
            finalStatus = 'PERLU_VERIFIKASI_MANUAL';
            isGpsWeak = true;
        }

        // Validasi Toleransi Waktu Masuk:
        // Default: 10 menit sebelum jam_mulai s.d 15 menit setelah jam_mulai
        const earlyToleranceMinutes = 10;
        const lateToleranceMinutes = 15;

        if (type === 'SELESAI') {
            // Handle Tab Selesai Mengajar
            const existingIn = await prisma.teacherGeofenceAttendance.findFirst({
                where: {
                    guruId,
                    jadwalId,
                    waktuTabSelesaiServer: null
                },
                orderBy: { waktuTabMasukServer: 'desc' }
            });

            if (!existingIn) {
                return res.status(400).json({
                    success: false,
                    message: 'Anda belum melakukan tab masuk untuk sesi mengajar ini.'
                });
            }

            const updated = await prisma.teacherGeofenceAttendance.update({
                where: { id: existingIn.id },
                data: {
                    waktuTabSelesaiServer: nowServer
                }
            });

            return res.json({
                success: true,
                message: 'Tab selesai mengajar berhasil dicatat',
                data: updated
            });
        }

        // Tentukan Status Masuk Tepat Waktu / Terlambat
        if (finalStatus !== 'PERLU_VERIFIKASI_MANUAL') {
            if (serverMinutes > startMinutes + lateToleranceMinutes) {
                finalStatus = 'TERLAMBAT';
            } else {
                finalStatus = 'TEPAT_WAKTU';
            }
        }

        // 6. Simpan Tab Masuk ke Database
        const newRecord = await prisma.teacherGeofenceAttendance.create({
            data: {
                guruId,
                jadwalId,
                requestId,
                waktuTabMasukDevice: waktuTabMasukDevice ? new Date(waktuTabMasukDevice) : null,
                waktuTabMasukServer: nowServer,
                lat: lat ? parseFloat(lat) : null,
                long: long ? parseFloat(long) : null,
                deviceId,
                wifiSsid,
                status: finalStatus,
                fotoVerifikasiUrl,
                statusSinkronisasi: 'SYNCED',
                isMockGps: !!isMockGps,
                isDevModeActive: !!isDevModeActive,
                isRooted: !!isRooted,
                notes: isGpsWeak ? 'GPS Lemah/Dalam Ruangan - Verifikasi Manual' : null
            }
        });

        // 7. Evaluasi Disiplin Kurikulum: Deteksi 3x Terlambat/Tidak Tab Berturut-turut
        checkTeacherTardinessStreak(guruId);

        return res.json({
            success: true,
            message: finalStatus === 'PERLU_VERIFIKASI_MANUAL'
                ? 'Tab tercatat (Menunggu verifikasi manual kurikulum karena sinyal GPS)'
                : `Presensi Berhasil: Status ${finalStatus}`,
            data: newRecord
        });
    } catch (error: any) {
        console.error('Error in teacherTabAttendance:', error);
        return res.status(500).json({ success: false, message: error.message || 'Terjadi kesalahan server' });
    }
};

// ========================================================
// 2. SISWA: TAB KONFIRMASI HADIR DI KELAS
// ========================================================
export const studentTabAttendance = async (req: Request, res: Response) => {
    try {
        const {
            siswaId,
            jadwalId,
            requestId,
            waktuTabDevice,
            lat,
            long,
            deviceId,
            wifiSsid,
            isMockGps
        } = req.body;

        if (!siswaId || !jadwalId || !requestId) {
            return res.status(400).json({ success: false, message: 'siswaId, jadwalId, dan requestId wajib diisi' });
        }

        // Idempotency check
        const existingTab = await prisma.studentGeofenceAttendance.findUnique({
            where: { requestId }
        });
        if (existingTab) {
            return res.json({
                success: true,
                message: 'Aksi tab siswa sudah tercatat sebelumnya (Idempotent)',
                data: existingTab
            });
        }

        // Cek Syarat Mutlak: Tombol tab siswa terkunci sampai GURU sudah tab masuk lebih dulu
        const teacherTab = await prisma.teacherGeofenceAttendance.findFirst({
            where: {
                jadwalId,
                status: { in: ['TEPAT_WAKTU', 'TERLAMBAT', 'PERLU_VERIFIKASI_MANUAL'] }
            },
            orderBy: { waktuTabMasukServer: 'desc' }
        });

        if (!teacherTab) {
            return res.status(403).json({
                success: false,
                message: 'Presensi belum dibuka. Guru pengampu mata pelajaran belum melakukan tab masuk.'
            });
        }

        // Cek apakah siswa berstatus IZIN / SAKIT dari BK (Pemeriksaan Ganda: StudentLeavePermit & StudentLeaveRequest)
        const { startOfDay, endOfDay } = getWibDayBounds(new Date());
        const [studentLeave, studentLeaveReq] = await Promise.all([
            prisma.studentLeavePermit.findFirst({
                where: {
                    siswaId,
                    tanggal: { gte: startOfDay, lte: endOfDay },
                    status: 'APPROVED'
                }
            }),
            prisma.studentLeaveRequest.findFirst({
                where: {
                    studentId: siswaId,
                    status: 'APPROVED',
                    startDate: { lte: endOfDay },
                    endDate: { gte: startOfDay }
                }
            })
        ]);

        if (studentLeave || studentLeaveReq) {
            const izinType = studentLeave?.kategoriIzin || (studentLeaveReq?.category === 'SICK' ? 'SAKIT' : 'IZIN');
            return res.status(403).json({
                success: false,
                message: `Anda tercatat ${izinType} pada hari ini oleh Guru BK.`
            });
        }

        // Validasi Mock GPS
        if (isMockGps) {
            await prisma.attendanceAnomalyLog.create({
                data: {
                    userId: siswaId,
                    jenisAnomali: 'MOCK_LOCATION',
                    detail: JSON.stringify({ lat, long, jadwalId })
                }
            });
            return res.status(403).json({ success: false, message: 'Deteksi Fake GPS aktif. Presensi ditolak!' });
        }

        const nowServer = new Date();
        const newRecord = await prisma.studentGeofenceAttendance.create({
            data: {
                siswaId,
                jadwalId,
                requestId,
                waktuTabDevice: waktuTabDevice ? new Date(waktuTabDevice) : null,
                waktuTabServer: nowServer,
                lat: lat ? parseFloat(lat) : null,
                long: long ? parseFloat(long) : null,
                deviceId,
                wifiSsid,
                status: 'HADIR',
                statusSinkronisasi: 'SYNCED',
                isMockGps: !!isMockGps
            }
        });

        return res.json({
            success: true,
            message: 'Presensi kehadiran siswa di kelas berhasil tercatat.',
            data: newRecord
        });
    } catch (error: any) {
        console.error('Error in studentTabAttendance:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 3. SINKRONISASI OFFLINE CLIENT-FIRST (BULK SYNC)
// ========================================================
export const syncOfflineAttendance = async (req: Request, res: Response) => {
    try {
        const { items } = req.body; // Array of pending attendance objects

        if (!Array.isArray(items) || items.length === 0) {
            return res.json({ success: true, syncedCount: 0, message: 'Tidak ada data antrean untuk disinkronkan' });
        }

        const results = [];
        for (const item of items) {
            try {
                if (item.role === 'TEACHER') {
                    // Cek idempotency
                    const existing = await prisma.teacherGeofenceAttendance.findUnique({
                        where: { requestId: item.requestId }
                    });
                    if (!existing) {
                        const created = await prisma.teacherGeofenceAttendance.create({
                            data: {
                                guruId: item.guruId,
                                jadwalId: item.jadwalId,
                                requestId: item.requestId,
                                waktuTabMasukDevice: item.waktuTabDevice ? new Date(item.waktuTabDevice) : null,
                                waktuTabMasukServer: new Date(),
                                lat: item.lat ? parseFloat(item.lat) : null,
                                long: item.long ? parseFloat(item.long) : null,
                                deviceId: item.deviceId,
                                wifiSsid: item.wifiSsid,
                                status: item.status || 'TEPAT_WAKTU',
                                fotoVerifikasiUrl: item.fotoVerifikasiUrl,
                                statusSinkronisasi: 'SYNCED',
                                notes: 'Sinkronisasi offline terkirim'
                            }
                        });
                        results.push({ requestId: item.requestId, status: 'SUCCESS', id: created.id });
                    } else {
                        results.push({ requestId: item.requestId, status: 'ALREADY_SYNCED' });
                    }
                } else {
                    // Siswa
                    const existing = await prisma.studentGeofenceAttendance.findUnique({
                        where: { requestId: item.requestId }
                    });
                    if (!existing) {
                        const created = await prisma.studentGeofenceAttendance.create({
                            data: {
                                siswaId: item.siswaId,
                                jadwalId: item.jadwalId,
                                requestId: item.requestId,
                                waktuTabDevice: item.waktuTabDevice ? new Date(item.waktuTabDevice) : null,
                                waktuTabServer: new Date(),
                                lat: item.lat ? parseFloat(item.lat) : null,
                                long: item.long ? parseFloat(item.long) : null,
                                deviceId: item.deviceId,
                                wifiSsid: item.wifiSsid,
                                status: 'HADIR',
                                statusSinkronisasi: 'SYNCED'
                            }
                        });
                        results.push({ requestId: item.requestId, status: 'SUCCESS', id: created.id });
                    } else {
                        results.push({ requestId: item.requestId, status: 'ALREADY_SYNCED' });
                    }
                }
            } catch (err: any) {
                results.push({ requestId: item.requestId, status: 'ERROR', message: err.message });
            }
        }

        return res.json({
            success: true,
            syncedCount: results.filter(r => r.status === 'SUCCESS').length,
            results
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 4. OPERATOR: INPUT IZIN GURU (REAL-TIME DISPATCH KE PIKET)
// ========================================================
export const submitTeacherLeave = async (req: Request, res: Response) => {
    try {
        const { guruId, jadwalId, kategoriIzin, keterangan, operatorId, substituteTeacherId } = req.body;

        if (!guruId || !jadwalId || !kategoriIzin) {
            return res.status(400).json({ success: false, message: 'guruId, jadwalId, dan kategoriIzin wajib diisi' });
        }

        const leave = await prisma.teacherLeavePermit.create({
            data: {
                guruId,
                jadwalId,
                kategoriIzin, // IZIN, SAKIT, DINAS_LUAR, CUTI
                diinputOlehOperatorId: operatorId || 'OPERATOR',
                keterangan,
                substituteTeacherId,
                dispositionToPiket: true,
                status: 'APPROVED'
            },
            include: {
                jadwal: true
            }
        });

        // Audit Log Operator
        await prisma.operatorActivityLog.create({
            data: {
                operatorId: operatorId || 'OPERATOR',
                jenisAksi: 'APPROVE_IZIN_GURU',
                modulTerkait: 'ABSENSI',
                detail: `Izin guru ${guruId} kategori ${kategoriIzin} pada jadwal ${jadwalId}`
            }
        });

        return res.json({
            success: true,
            message: 'Izin guru berhasil disubmit. Jadwal dinonaktifkan dari alpa dan diteruskan ke Guru Piket.',
            data: leave
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 5. KURIKULUM: ANTRIAN VERIFIKASI MANUAL & REKAP KEDISIPLINAN
// ========================================================
export const getManualVerificationQueue = async (req: Request, res: Response) => {
    try {
        const queue = await prisma.teacherGeofenceAttendance.findMany({
            where: {
                status: 'PERLU_VERIFIKASI_MANUAL',
                manualVerifiedBy: null
            },
            include: {
                jadwal: true
            },
            orderBy: { waktuTabMasukServer: 'desc' }
        });

        return res.json({ success: true, count: queue.length, data: queue });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const verifyManualAttendance = async (req: Request, res: Response) => {
    try {
        const { attendanceId, action, reviewerId, note } = req.body; // action: 'APPROVE' | 'REJECT'

        const status = action === 'APPROVE' ? 'TEPAT_WAKTU' : 'TIDAK_HADIR';
        const updated = await prisma.teacherGeofenceAttendance.update({
            where: { id: attendanceId },
            data: {
                status,
                manualVerifiedBy: reviewerId || 'KURIKULUM',
                manualVerifiedAt: new Date(),
                notes: note || (action === 'APPROVE' ? 'Disetujui secara manual oleh Kurikulum' : 'Ditolak oleh Kurikulum')
            }
        });

        return res.json({ success: true, message: `Status berhasil diverifikasi menjadi ${status}`, data: updated });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getKurikulumRecap = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, guruId } = req.query;

        const whereClause: any = {};
        if (guruId) whereClause.guruId = String(guruId);
        if (startDate || endDate) {
            whereClause.waktuTabMasukServer = {};
            if (startDate) whereClause.waktuTabMasukServer.gte = getWibDayBounds(new Date(String(startDate) + 'T12:00:00+07:00')).startOfDay;
            if (endDate) whereClause.waktuTabMasukServer.lte = getWibDayBounds(new Date(String(endDate) + 'T12:00:00+07:00')).endOfDay;
        }

        const records = await prisma.teacherGeofenceAttendance.findMany({
            where: whereClause,
            include: { jadwal: true }
        });

        // Hitung statistik kedisiplinan
        const stats = {
            totalSessions: records.length,
            onTime: records.filter(r => r.status === 'TEPAT_WAKTU').length,
            late: records.filter(r => r.status === 'TERLAMBAT').length,
            absent: records.filter(r => r.status === 'TIDAK_HADIR').length,
            manualVerified: records.filter(r => r.status === 'PERLU_VERIFIKASI_MANUAL').length,
            disciplineScore: 100
        };

        if (stats.totalSessions > 0) {
            stats.disciplineScore = Math.max(0, Math.round(((stats.onTime * 1.0 + stats.late * 0.5) / stats.totalSessions) * 100));
        }

        return res.json({ success: true, stats, data: records });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// HELPER: DETEKSI 3X TERLAMBAT/TIDAK TAB BERTURUT-TURUT
// ========================================================
async function checkTeacherTardinessStreak(guruId: string) {
    try {
        const recentAttendances = await prisma.teacherGeofenceAttendance.findMany({
            where: { guruId },
            orderBy: { waktuTabMasukServer: 'desc' },
            take: 3
        });

        if (recentAttendances.length === 3) {
            const allProblematic = recentAttendances.every(a => a.status === 'TERLAMBAT' || a.status === 'TIDAK_HADIR');
            if (allProblematic) {
                // Catat ke Anomaly Log & beri peringatan kurikulum
                await prisma.attendanceAnomalyLog.create({
                    data: {
                        userId: guruId,
                        jenisAnomali: 'RATE_LIMIT',
                        detail: JSON.stringify({
                            alert: 'Guru telat atau tidak tab 3x berturut-turut dalam satu periode jadwal.',
                            streakDates: recentAttendances.map(a => a.waktuTabMasukServer)
                        })
                    }
                });
            }
        }
    } catch (err) {
        console.error('Streak detection error:', err);
    }
}
