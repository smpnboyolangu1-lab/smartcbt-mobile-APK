import { Request, Response } from 'express';
import prisma from '../utils/db';
import { getSchoolSignatures } from '../utils/schoolSignatures';
import { sendFcmToUser } from '../services/fcmService';
import { formatTimeWib, formatTimeWibWithSuffix, getWibDayBounds, getWibDayOfWeek, getWibTimeColon } from '../utils/dateUtils';
import { sendPrayerH1NotificationForDate } from '../services/systemScheduler';

// 1. Ambil Jadwal Rombel Sholat Hari Ini (Dinamis: Mendukung Sholat Dhuha, Dhuhur, Jumat)
export const getTodayPrayerSchedule = async (req: Request, res: Response) => {
    try {
        const todayDay = getWibDayOfWeek(); // 0 = Minggu, 1 = Senin, dst (WIB)
        const dayNames = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
        const currentDayName = dayNames[todayDay];
        const requestedType = (req.query.prayerType as string)?.toUpperCase();

        // Deteksi jendela waktu otomatis menggunakan zona waktu resmi WIB (Asia/Jakarta)
        const { hour: currentHourWIB } = getWibDayBounds(new Date());
        const isMorningDhuhaWindow = currentHourWIB < 10; // Sebelum jam 10 pagi WIB adalah sesi Sholat Dhuha

        let whereCondition: any = {
            dayOfWeek: todayDay,
            isActive: true
        };

        if (requestedType) {
            whereCondition.prayerType = requestedType;
        } else if (isMorningDhuhaWindow) {
            // Cek apakah ada jadwal Dhuha aktif hari ini
            const dhuhaSchedule = await (prisma as any).prayerClassSchedule.findFirst({
                where: { dayOfWeek: todayDay, prayerType: 'DHUHA', isActive: true }
            });
            if (dhuhaSchedule) {
                whereCondition.prayerType = 'DHUHA';
            }
        }

        let schedule = await (prisma as any).prayerClassSchedule.findFirst({
            where: whereCondition,
            orderBy: { scanStartTime: 'asc' }
        });

        // Ambil semua opsi sholat yang tersedia untuk hari ini (Dhuha & Dhuhur/Jumat)
        const allTodaySchedules = await (prisma as any).prayerClassSchedule.findMany({
            where: { dayOfWeek: todayDay, isActive: true },
            orderBy: { scanStartTime: 'asc' }
        });

        // Default schedules jika belum diatur di database
        if (!schedule) {
            const isDhuhaReq = requestedType === 'DHUHA' || (isMorningDhuhaWindow && requestedType !== 'DHUHUR' && requestedType !== 'JUMAT');
            let defaultClasses = "VII-F,VII-G,VIII-A,IX-A,IX-B";
            if (todayDay === 2) defaultClasses = "VII-B,VII-C,VIII-B,VIII-C,IX-C,IX-D";
            else if (todayDay === 3) defaultClasses = "VII-D,VII-E,VII-H,IX-E,IX-H";
            else if (todayDay === 4) defaultClasses = "VII-A,VIII-F,VIII-G,IX-I";
            else if (todayDay === 5) defaultClasses = isDhuhaReq ? "VII-I,VIII-H,VIII-I,IX-F,IX-J" : "ALL_MALE";
            else if (todayDay === 6) defaultClasses = isDhuhaReq ? "IX-K" : "VII-J,VII-K,VIII-J,VIII-K,IX-G";
            
            schedule = {
                id: `default-${todayDay}-${isDhuhaReq ? 'dhuha' : 'dhuhur'}`,
                dayOfWeek: todayDay,
                dayName: currentDayName,
                prayerType: isDhuhaReq ? 'DHUHA' : (todayDay === 5 ? 'JUMAT' : 'DHUHUR'),
                classNames: defaultClasses,
                barcodeKey: isDhuhaReq ? 'BARCODE_SHOLAT_DHUHA_MASJID' : (todayDay === 5 ? 'BARCODE_SHOLAT_JUMAT_MASJID' : 'BARCODE_SHOLAT_DHUHUR_MASJID'),
                wudhuTime: isDhuhaReq ? '06:45' : '11:45',
                scanStartTime: isDhuhaReq ? '07:00' : '12:00',
                scanEndTime: isDhuhaReq ? '07:45' : '12:30',
                notes: `Jadwal Sholat ${isDhuhaReq ? 'Dhuha' : (todayDay === 5 ? 'Jumat' : 'Dhuhur')} Berjamaah di Masjid Sekolah`
            };
        } else {
            schedule = {
                ...schedule,
                wudhuTime: schedule.wudhuTime || (schedule.prayerType === 'DHUHA' ? '06:45' : '11:45'),
                scanStartTime: schedule.scanStartTime || (schedule.prayerType === 'DHUHA' ? '07:00' : '12:00'),
                scanEndTime: schedule.scanEndTime || (schedule.prayerType === 'DHUHA' ? '07:45' : '12:30')
            };
        }

        res.json({
            success: true,
            dayName: currentDayName,
            schedule,
            availablePrayers: allTodaySchedules
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat jadwal sholat: ' + error.message });
    }
};

// 1b. Ambil Seluruh Jadwal Sholat Sepanjang Pekan (Senin - Jumat) - Mendukung multi-sholat per hari (Dhuha & Dhuhur)
export const getAllPrayerSchedules = async (req: Request, res: Response) => {
    try {
        const schedules = await (prisma as any).prayerClassSchedule.findMany({
            where: { isActive: true },
            orderBy: [{ dayOfWeek: 'asc' }, { scanStartTime: 'asc' }]
        });

        const dayNames = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
        const fullWeekSchedules: any[] = [];

        for (let d = 1; d <= 6; d++) {
            const daySchedules = schedules.filter((s: any) => s.dayOfWeek === d);
            if (daySchedules.length > 0) {
                daySchedules.forEach((s: any) => {
                    fullWeekSchedules.push({
                        ...s,
                        wudhuTime: s.wudhuTime || (s.prayerType === 'DHUHA' ? '06:45' : '11:45'),
                        scanStartTime: s.scanStartTime || (s.prayerType === 'DHUHA' ? '07:00' : '12:00'),
                        scanEndTime: s.scanEndTime || (s.prayerType === 'DHUHA' ? '07:45' : '12:30')
                    });
                });
            } else {
                if (d === 1) {
                    fullWeekSchedules.push({
                        id: `default-${d}-dhuhur`,
                        dayOfWeek: d,
                        dayName: dayNames[d],
                        prayerType: 'DHUHUR',
                        classNames: 'VII-F,VII-G,VIII-A,IX-A,IX-B',
                        barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID',
                        wudhuTime: '11:45',
                        scanStartTime: '12:00',
                        scanEndTime: '12:30',
                        notes: 'Jadwal Sholat Dhuhur Berjamaah di Masjid Sekolah',
                        isActive: true
                    });
                } else if (d === 2) {
                    fullWeekSchedules.push({
                        id: `default-${d}-dhuhur`,
                        dayOfWeek: d,
                        dayName: dayNames[d],
                        prayerType: 'DHUHUR',
                        classNames: 'VII-B,VII-C,VIII-B,VIII-C,IX-C,IX-D',
                        barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID',
                        wudhuTime: '11:45',
                        scanStartTime: '12:00',
                        scanEndTime: '12:30',
                        notes: 'Jadwal Sholat Dhuhur Berjamaah di Masjid Sekolah',
                        isActive: true
                    });
                } else if (d === 3) {
                    fullWeekSchedules.push({
                        id: `default-${d}-dhuhur`,
                        dayOfWeek: d,
                        dayName: dayNames[d],
                        prayerType: 'DHUHUR',
                        classNames: 'VII-D,VII-E,VII-H,IX-E,IX-H',
                        barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID',
                        wudhuTime: '11:45',
                        scanStartTime: '12:00',
                        scanEndTime: '12:30',
                        notes: 'Jadwal Sholat Dhuhur Berjamaah di Masjid Sekolah',
                        isActive: true
                    });
                } else if (d === 4) {
                    fullWeekSchedules.push({
                        id: `default-${d}-dhuhur`,
                        dayOfWeek: d,
                        dayName: dayNames[d],
                        prayerType: 'DHUHUR',
                        classNames: 'VII-A,VIII-F,VIII-G,IX-I',
                        barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID',
                        wudhuTime: '11:45',
                        scanStartTime: '12:00',
                        scanEndTime: '12:30',
                        notes: 'Jadwal Sholat Dhuhur Berjamaah di Masjid Sekolah',
                        isActive: true
                    });
                } else if (d === 5) {
                    fullWeekSchedules.push({
                        id: `default-${d}-dhuha`,
                        dayOfWeek: d,
                        dayName: dayNames[d],
                        prayerType: 'DHUHA',
                        classNames: 'VII-I,VIII-H,VIII-I,IX-F,IX-J',
                        barcodeKey: 'BARCODE_SHOLAT_DHUHA_MASJID',
                        wudhuTime: '06:45',
                        scanStartTime: '07:00',
                        scanEndTime: '07:45',
                        notes: 'Jadwal Sholat Dhuha Berjamaah di Masjid Sekolah',
                        isActive: true
                    });
                    fullWeekSchedules.push({
                        id: `default-${d}-jumat`,
                        dayOfWeek: d,
                        dayName: dayNames[d],
                        prayerType: 'JUMAT',
                        classNames: 'ALL_MALE',
                        barcodeKey: 'BARCODE_SHOLAT_JUMAT_MASJID',
                        wudhuTime: '11:30',
                        scanStartTime: '11:45',
                        scanEndTime: '12:45',
                        notes: 'Jadwal Sholat Jumat Berjamaah di Masjid Sekolah',
                        isActive: true
                    });
                } else if (d === 6) {
                    fullWeekSchedules.push({
                        id: `default-${d}-dhuha`,
                        dayOfWeek: d,
                        dayName: dayNames[d],
                        prayerType: 'DHUHA',
                        classNames: 'IX-K',
                        barcodeKey: 'BARCODE_SHOLAT_DHUHA_MASJID',
                        wudhuTime: '06:45',
                        scanStartTime: '07:00',
                        scanEndTime: '07:45',
                        notes: 'Jadwal Sholat Dhuha Berjamaah di Masjid Sekolah',
                        isActive: true
                    });
                    fullWeekSchedules.push({
                        id: `default-${d}-dhuhur`,
                        dayOfWeek: d,
                        dayName: dayNames[d],
                        prayerType: 'DHUHUR',
                        classNames: 'VII-J,VII-K,VIII-J,VIII-K,IX-G',
                        barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID',
                        wudhuTime: '11:45',
                        scanStartTime: '12:00',
                        scanEndTime: '12:30',
                        notes: 'Jadwal Sholat Dhuhur Berjamaah di Masjid Sekolah',
                        isActive: true
                    });
                }
            }
        }

        res.json({
            success: true,
            schedules: fullWeekSchedules
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat daftar jadwal sholat: ' + error.message });
    }
};

// 2. Simpan / Perbarui Jadwal Rombel Sholat (Operator & Guru PAI)
export const setPrayerClassSchedule = async (req: Request, res: Response) => {
    try {
        const { id, dayOfWeek, dayName, prayerType, classNames, barcodeKey, notes, wudhuTime, scanStartTime, scanEndTime } = req.body;
        if (dayOfWeek === undefined || !classNames) {
            return res.status(400).json({ success: false, message: 'Hari dan daftar kelas wajib diisi.' });
        }

        const cleanDay = Number(dayOfWeek);
        const dayNames = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
        const resolvedDayName = dayName || dayNames[cleanDay] || 'HARI';
        const pType = String(prayerType || (cleanDay === 5 ? 'JUMAT' : 'DHUHUR')).toUpperCase();

        const defaultBarcodeKey = pType === 'DHUHA'
            ? 'BARCODE_SHOLAT_DHUHA_MASJID'
            : (pType === 'JUMAT' ? 'BARCODE_SHOLAT_JUMAT_MASJID' : 'BARCODE_SHOLAT_DHUHUR_MASJID');
        const defaultWudhuTime = pType === 'DHUHA' ? '06:45' : (pType === 'JUMAT' ? '11:30' : '11:45');
        const defaultScanStart = pType === 'DHUHA' ? '07:00' : (pType === 'JUMAT' ? '11:45' : '12:00');
        const defaultScanEnd = pType === 'DHUHA' ? '07:45' : (pType === 'JUMAT' ? '12:45' : '12:30');

        let existing: any = null;
        if (id) {
            existing = await (prisma as any).prayerClassSchedule.findUnique({ where: { id } });
        }
        if (!existing) {
            existing = await (prisma as any).prayerClassSchedule.findFirst({
                where: { dayOfWeek: cleanDay, prayerType: pType }
            });
        }

        const dataPayload = {
            dayName: resolvedDayName,
            prayerType: pType,
            classNames: typeof classNames === 'object' ? classNames.join(',') : String(classNames).trim(),
            barcodeKey: barcodeKey || defaultBarcodeKey,
            wudhuTime: wudhuTime || defaultWudhuTime,
            scanStartTime: scanStartTime || defaultScanStart,
            scanEndTime: scanEndTime || defaultScanEnd,
            notes: notes ? String(notes).trim() : null,
            isActive: true
        };

        let saved;
        if (existing) {
            saved = await (prisma as any).prayerClassSchedule.update({
                where: { id: existing.id },
                data: dataPayload
            });
        } else {
            saved = await (prisma as any).prayerClassSchedule.create({
                data: {
                    dayOfWeek: cleanDay,
                    ...dataPayload
                }
            });
        }

        res.json({ success: true, message: `Jadwal Sholat ${pType} hari ${resolvedDayName} berhasil disimpan dan disinkronkan ke seluruh sistem.`, schedule: saved });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal menyimpan jadwal sholat: ' + error.message });
    }
};

// 2b. Hapus Jadwal Sholat Tertentu (Operator & Guru PAI)
export const deletePrayerClassSchedule = async (req: Request, res: Response) => {
    try {
        const { id, dayOfWeek, prayerType } = req.body;
        let existing: any = null;
        if (id) {
            existing = await (prisma as any).prayerClassSchedule.findUnique({ where: { id } });
        } else if (dayOfWeek !== undefined && prayerType) {
            existing = await (prisma as any).prayerClassSchedule.findFirst({
                where: { dayOfWeek: Number(dayOfWeek), prayerType: String(prayerType).toUpperCase() }
            });
        }

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Jadwal sholat tidak ditemukan.' });
        }

        await (prisma as any).prayerClassSchedule.delete({ where: { id: existing.id } });
        res.json({ success: true, message: `Jadwal Sholat ${existing.prayerType} hari ${existing.dayName} berhasil dihapus.` });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal menghapus jadwal sholat: ' + error.message });
    }
};

// 3. Siswa Memindai Barcode Statik Masjid Sekolah (Self-Scan Barcode Statik)
export const studentScanStaticBarcode = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const rawBar = req.body.barcodeValue || req.body.barcodeData || req.body.barcodeKey || req.body.barcode;
        const { prayerType, lat, lng, isFakeGps } = req.body;
        const cleanBar = String(rawBar || '').trim().toUpperCase();

        // Validasi Barcode Statik Masjid, Dhuha & Keputrian
        const validStaticBarcodes = [
            'BARCODE_SHOLAT_DHUHA_MASJID',
            'BARCODE_SHOLAT_DHUHUR_MASJID',
            'BARCODE_SHOLAT_JUMAT_MASJID',
            'BARCODE_SHOLAT_PULANG_MASJID',
            'MASJID_DHUHA_S1BOY',
            'MASJID_DHUHUR_S1BOY',
            'MASJID_JUMAT_S1BOY',
            'MASJID_PULANG_S1BOY',
            'SHOLAT_DHUHA',
            'SHOLAT_DHUHA_MASJID',
            'DHUHA_MASJID',
            'PULANG_MUSHOLA',
            'SHOLAT_PULANG',
            'SHOLAT_MASJID_SMPN1',
            'SHOLAT_DHUHUR_MASJID',
            'BARCODE_KEPUTRIAN_MASUK',
            'BARCODE_KEPUTRIAN_PULANG',
            'KEPUTRIAN_S1BOY',
            'KEPUTRIAN_MASJID_S1BOY',
            'SHOLAT_JUMAT_KEPUTRIAN'
        ];

        const isMatch = validStaticBarcodes.some(b => cleanBar.includes(b)) || 
            cleanBar.includes('MASJID') || 
            cleanBar.includes('SHOLAT') || 
            cleanBar.includes('MUSHOLA') || 
            cleanBar.includes('DHUHA') || 
            cleanBar.includes('KEPUTRIAN');

        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: '❌ Barcode tidak valid! Pastikan Anda memindai Barcode Statik resmi yang tertempel di Mushola / Pos Pembinaan Keputrian SMPN 1 Boyolangu.'
            });
        }

        const isPulangScan = cleanBar.includes('PULANG') || 
            cleanBar.includes('OUT') || 
            req.body.isPulang === true || 
            req.body.scanType === 'GATE_OUT' || 
            String(req.body.type || '').toUpperCase() === 'GATE_OUT';

        const isKeputrianScan = cleanBar.includes('KEPUTRIAN');

        const todayDay = getWibDayOfWeek();
        const now = new Date();
        const { startOfDay, endOfDay, ymd: todayStr, hour: currentHourWIB } = getWibDayBounds(now);
        const isMorningDhuhaWindow = currentHourWIB < 10 || cleanBar.includes('DHUHA');

        let pType = String(prayerType || '').toUpperCase();
        if (!pType) {
            if (isMorningDhuhaWindow) {
                const dhuhaSched = await (prisma as any).prayerClassSchedule.findFirst({
                    where: { dayOfWeek: todayDay, prayerType: 'DHUHA', isActive: true }
                });
                if (dhuhaSched || cleanBar.includes('DHUHA')) {
                    pType = 'DHUHA';
                }
            }
            if (!pType) {
                pType = todayDay === 5 ? 'JUMAT' : 'DHUHUR';
            }
        }

        // Cek Jadwal & Status Keaktifan Barcode Mushola Hari Ini
        const sched = await (prisma as any).prayerClassSchedule.findFirst({
            where: { dayOfWeek: todayDay, prayerType: pType, isActive: true }
        });

        const currentHourMinute = getWibTimeColon(now);
        const timeWithSec = getWibTimeColon(now, true);

        const defaultStartTime = pType === 'DHUHA' ? '06:45' : (todayDay === 5 ? '11:15' : '11:30');
        const defaultEndTime = pType === 'DHUHA' ? '09:00' : '14:30';
        const defaultWudhu = pType === 'DHUHA' ? '06:45' : (todayDay === 5 ? '11:30' : '11:45');

        const startTime = sched?.scanStartTime || defaultStartTime;
        const endTime = sched?.scanEndTime || defaultEndTime;
        const wudhuTime = sched?.wudhuTime || defaultWudhu;

        if (sched && sched.isScanActive === false) {
            return res.status(400).json({
                success: false,
                message: '❌ Barcode mushola non-aktif! Sesi scan sholat telah dinonaktifkan oleh Guru PAI / Pengurus Mushola.'
            });
        }

        const student = await prisma.user.findUnique({ where: { id: user.id } });
        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        const rawStatus = (req.body.status || 'SHOLAT_BERJAMAAH').toString().toUpperCase();
        const studentGender = ((student.gender || 'L').toString().toUpperCase().startsWith('P') || (student.gender || '').toLowerCase().includes('perempuan')) ? 'P' : 'L';
        const isBerhalangan = (rawStatus.includes('BERHALANGAN') || rawStatus.includes('HAID') || isKeputrianScan) && studentGender === 'P';
        const finalStatus = isBerhalangan ? 'BERHALANGAN_HAID' : 'SHOLAT_BERJAMAAH';

        // -------------------------------------------------------------
        // KASUS 1: SCAN BARCODE PULANG DI MUSHOLA
        // -------------------------------------------------------------
        if (isPulangScan) {
            // Cek apakah siswa sudah pernah scan pulang hari ini
            const existingOut = await prisma.attendance.findFirst({
                where: {
                    userId: student.id,
                    type: 'GATE_OUT',
                    scanTime: {
                        gte: startOfDay,
                        lte: endOfDay
                    }
                }
            });

            if (existingOut) {
                const outTimeStr = formatTimeWib(existingOut.scanTime);
                return res.json({
                    success: true,
                    alreadyRecorded: true,
                    message: `✅ Anda sudah melakukan scan kepulangan mushola hari ini pukul ${outTimeStr} WIB.`,
                    record: existingOut
                });
            }

            // Catat Kepulangan Resmi di tabel Attendance
            const outRecord = await prisma.attendance.create({
                data: {
                    userId: student.id,
                    type: 'GATE_OUT',
                    method: 'BARCODE',
                    status: 'PRESENT',
                    lat: lat ? Number(lat) : null,
                    lng: lng ? Number(lng) : null,
                    isFakeGps: Boolean(isFakeGps),
                    note: `Scan Pulang di Mushola setelah Sholat ${pType} Berjamaah (${timeWithSec} WIB)`
                }
            });

            // Perbarui catatan di tabel studentPrayerAttendance jika ada
            await (prisma as any).studentPrayerAttendance.updateMany({
                where: {
                    studentId: student.id,
                    date: todayStr,
                    prayerType: pType
                },
                data: {
                    notes: `Selesai Sholat & Scan Pulang Mushola pukul ${timeWithSec} WIB`
                }
            }).catch(() => {});

            // Kirim Notifikasi Real-time ke Orang Tua
            try {
                const notifTitle = `🕌 Scan Pulang Mushola: ${student.name} Selesai Sholat`;
                const notifMsg = `Alhamdulillah, ananda ${student.name} (Kelas ${student.className || '-'}) telah melaksanakan Sholat ${pType} Berjamaah dan melakukan scan kepulangan di Mushola SMPN 1 Boyolangu pada pukul ${timeWithSec} WIB. Ananda bersiap dalam perjalanan pulang ke rumah.`;

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

                const parentUsername = `P${student.nisn || student.username}`;
                const parentUser = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { username: parentUsername },
                            { nisn: student.nisn || student.username, role: 'PARENT' }
                        ]
                    }
                });
                if (parentUser) {
                    await sendFcmToUser(parentUser.id, notifTitle, notifMsg, {
                        type: 'PRAYER_GATE_OUT',
                        studentId: student.id,
                        studentName: student.name
                    }).catch(e => console.warn('[FCM Prayer Parent]', e.message));
                }
            } catch (nErr) {}

            return res.json({
                success: true,
                isGateOut: true,
                message: `✅ Alhamdulillah! Presensi kepulangan di Mushola berhasil dicatat pukul ${timeWithSec} WIB. Notifikasi telah terkirim ke Orang Tua.`,
                record: outRecord
            });
        }

        // -------------------------------------------------------------
        // KASUS 2: SCAN MASUK SHOLAT / KEPUTRIAN DI MUSHOLA
        // -------------------------------------------------------------
        const existing = await (prisma as any).studentPrayerAttendance.findFirst({
            where: {
                studentId: student.id,
                prayerType: pType,
                date: todayStr
            }
        });

        if (existing) {
            const isPrevBerhalangan = existing.status === 'BERHALANGAN_HAID';
            return res.json({
                success: true,
                alreadyRecorded: true,
                message: isPrevBerhalangan
                    ? `🌸 Anda sudah tercatat hadir berhalangan sholat (haid/uzur keputrian) hari ini pukul ${new Date(existing.createdAt).toTimeString().substring(0, 5)} WIB.`
                    : `✅ Anda sudah tercatat melaksanakan Sholat ${pType} Berjamaah hari ini pukul ${new Date(existing.createdAt).toTimeString().substring(0, 5)} WIB.`,
                record: existing
            });
        }

        const coordText = (lat && lng) ? ` • GPS: ${lat}, ${lng}` : '';
        const notesText = isBerhalangan 
            ? `Presensi mandiri siswi berhalangan (uzur syar'i/keputrian) scan barcode${coordText}`
            : `Presensi mandiri scan barcode masuk sholat${coordText}`;

        const newRecord = await (prisma as any).studentPrayerAttendance.create({
            data: {
                studentId: student.id,
                studentName: student.name,
                className: student.className || '-',
                gender: studentGender,
                prayerType: pType,
                date: todayStr,
                status: finalStatus,
                method: isKeputrianScan ? 'BARCODE_KEPUTRIAN' : 'STATIC_BARCODE',
                recordedById: student.id,
                recordedByName: student.name,
                notes: notesText
            }
        });

        // Simpan koordinat GPS ke rekaman Attendance utama jika tersedia
        if (lat && lng && Number(lat) !== 0 && Number(lng) !== 0) {
            try {
                const { startOfDay, endOfDay } = getWibDayBounds(now);

                const existingAtt = await prisma.attendance.findFirst({
                    where: {
                        userId: student.id,
                        scanTime: { gte: startOfDay, lte: endOfDay }
                    },
                    orderBy: { scanTime: 'desc' }
                });

                if (existingAtt) {
                    await prisma.attendance.update({
                        where: { id: existingAtt.id },
                        data: {
                            lat: Number(lat),
                            lng: Number(lng),
                            isFakeGps: Boolean(isFakeGps),
                            note: (existingAtt.note || '') + ` • Mushola (${finalStatus}) GPS: ${lat}, ${lng}`
                        }
                    });
                } else {
                    await prisma.attendance.create({
                        data: {
                            userId: student.id,
                            type: 'PRAYER',
                            method: 'BARCODE',
                            status: isBerhalangan ? 'PERMISSION' : 'PRESENT',
                            lat: Number(lat),
                            lng: Number(lng),
                            isFakeGps: Boolean(isFakeGps),
                            note: `Presensi Mushola (${finalStatus}) • GPS: ${lat}, ${lng}`
                        }
                    });
                }
            } catch (attErr) {}
        }

        // Kirim notifikasi real-time ke Orang Tua (Bukan sekadar rekap absen)
        try {
            let notifTitle = `🕌 Laporan Ibadah: Sholat ${pType} Berjamaah`;
            let notifMsg = `Alhamdulillah, ananda ${student.name} (Kelas ${student.className || '-'}) telah melaksanakan scan masuk Sholat ${pType} Berjamaah di Mushola SMPN 1 Boyolangu hari ini pukul ${timeWithSec} WIB.`;

            if (isKeputrianScan || isBerhalangan) {
                notifTitle = `🌸 Laporan Ibadah Keputrian: ${student.name}`;
                notifMsg = `Informasi: Ananda ${student.name} (Kelas ${student.className || '-'}) hari ini mengikuti kegiatan pembinaan keputrian bersama Guru PAI Putri (status berhalangan sholat / uzur syar'i) pada pukul ${timeWithSec} WIB.`;
            }

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

            const parentUsername = `P${student.nisn || student.username}`;
            const parentUser = await prisma.user.findFirst({
                where: {
                    OR: [
                        { username: parentUsername },
                        { nisn: student.nisn || student.username, role: 'PARENT' }
                    ]
                }
            });
            if (parentUser) {
                await sendFcmToUser(parentUser.id, notifTitle, notifMsg, {
                    type: 'PRAYER_CHECK_IN',
                    studentId: student.id,
                    studentName: student.name
                }).catch(e => console.warn('[FCM Prayer In Parent]', e.message));
            }
        } catch (nErr) {}

        const successMessage = isBerhalangan
            ? `🌸 Presensi Berhasil! Kehadiran Anda tercatat resmi sebagai BERHALANGAN / KEPUTRIAN (Uzur Syar'i). Notifikasi telah terkirim ke Orang Tua.`
            : `Alhamdulillah! Presensi masuk Sholat ${pType} Berjamaah berhasil dicatat pukul ${timeWithSec} WIB. Notifikasi telah terkirim ke Orang Tua.`;

        res.json({
            success: true,
            message: successMessage,
            record: newRecord
        });
    } catch (error: any) {
        console.error('Error studentScanStaticBarcode:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat presensi sholat: ' + error.message });
    }
};

// 4. Guru PAI Menandai Presensi Sholat Siswa (Termasuk Siswi Berhalangan Haid & Siswa Tanpa HP)
export const paiMarkStudentPrayer = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, prayerType, status, notes } = req.body;
        // status: 'SHOLAT_BERJAMAAH', 'BERHALANGAN_HAID', 'UZUR_SAKIT', 'NON_MUSLIM', 'ALPHA'

        if (!studentId || !status) {
            return res.status(400).json({ success: false, message: 'Siswa dan status sholat wajib ditentukan.' });
        }

        const student = await prisma.user.findUnique({ where: { id: studentId } });
        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
        }

        const gender = (student.gender || 'L').toUpperCase();

        // ATURAN KRUSIAL: Status 'BERHALANGAN_HAID' HANYA BOLEH UNTUK SISWI PEREMPUAN
        if (status.toUpperCase() === 'BERHALANGAN_HAID' && gender !== 'P' && gender !== 'PEREMPUAN') {
            return res.status(400).json({
                success: false,
                message: '⛔ Opsi Berhalangan (Haid / Keputrian) HANYA berlaku untuk siswi perempuan.'
            });
        }

        const todayStr = getWibDayBounds(new Date()).ymd;
        const pType = prayerType || (getWibDayOfWeek() === 5 ? 'JUMAT' : 'DHUHUR');

        const existing = await (prisma as any).studentPrayerAttendance.findFirst({
            where: {
                studentId: student.id,
                prayerType: pType,
                date: todayStr
            }
        });

        let resultRecord;
        if (existing) {
            resultRecord = await (prisma as any).studentPrayerAttendance.update({
                where: { id: existing.id },
                data: {
                    status: status.toUpperCase(),
                    method: 'MANUAL_PAI',
                    recordedById: user.id,
                    recordedByName: user.name || 'Guru PAI',
                    notes: notes || (status === 'BERHALANGAN_HAID' ? 'Izin keputrian / berhalangan syar’i' : 'Diverifikasi Guru PAI')
                }
            });
        } else {
            resultRecord = await (prisma as any).studentPrayerAttendance.create({
                data: {
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className || '-',
                    gender,
                    prayerType: pType,
                    date: todayStr,
                    status: status.toUpperCase(),
                    method: 'MANUAL_PAI',
                    recordedById: user.id,
                    recordedByName: user.name || 'Guru PAI',
                    notes: notes || (status === 'BERHALANGAN_HAID' ? 'Izin keputrian / berhalangan syar’i' : 'Diverifikasi Guru PAI')
                }
            });
        }

        // Notifikasi ke Orang Tua
        try {
            const isHaid = status.toUpperCase() === 'BERHALANGAN_HAID';
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className,
                    title: isHaid ? `🌸 Informasi Keputrian: ${student.name}` : `🕌 Laporan Ibadah Sholat`,
                    message: isHaid 
                        ? `Ananda ${student.name} hari ini tercatat izin berhalangan syar'i (haid/keputrian) dan mengikuti pembinaan di ruang keputrian.`
                        : `Ananda ${student.name} tercatat melaksanakan Sholat ${pType} Berjamaah (Diverifikasi oleh Guru PAI Bpk/Ibu ${user.name}).`,
                    category: 'ATTENDANCE'
                }
            });
        } catch (nErr) {}

        res.json({
            success: true,
            message: `Status presensi sholat siswa berhasil diperbarui: ${status}`,
            record: resultRecord
        });
    } catch (error: any) {
        console.error('Error paiMarkStudentPrayer:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat status sholat: ' + error.message });
    }
};

// 4b. Guru PAI Menandai Presensi Sholat Secara Massal (Satu Kelas Sekaligus)
export const batchPaiMarkStudentPrayer = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { className, prayerType, status, studentIds, notes } = req.body;
        const targetStatus = (status || 'SHOLAT_BERJAMAAH').toUpperCase();

        if (!className) {
            return res.status(400).json({ success: false, message: 'Kelas wajib ditentukan.' });
        }

        const todayStr = getWibDayBounds(new Date()).ymd;
        const pType = prayerType || (getWibDayOfWeek() === 5 ? 'JUMAT' : 'DHUHUR');

        let students: any[] = [];
        if (Array.isArray(studentIds) && studentIds.length > 0) {
            students = await prisma.user.findMany({
                where: { id: { in: studentIds }, role: 'STUDENT' }
            });
        } else {
            students = await prisma.user.findMany({
                where: { className: String(className).trim(), role: 'STUDENT' }
            });
        }

        if (students.length === 0) {
            return res.status(404).json({ success: false, message: 'Tidak ada siswa pada kelas ini.' });
        }

        let updatedCount = 0;
        for (const student of students) {
            const gender = (student.gender || 'L').toUpperCase();
            const isFemale = gender === 'P' || gender === 'PEREMPUAN';

            const existing = await (prisma as any).studentPrayerAttendance.findFirst({
                where: {
                    studentId: student.id,
                    prayerType: pType,
                    date: todayStr
                }
            });

            // Jangan timpa jika siswi sudah berhalangan haid saat aksi 'Tandai Semua Hadir'
            if (existing && existing.status === 'BERHALANGAN_HAID' && targetStatus === 'SHOLAT_BERJAMAAH') {
                continue;
            }

            if (targetStatus === 'BERHALANGAN_HAID' && !isFemale) {
                continue;
            }

            if (existing) {
                await (prisma as any).studentPrayerAttendance.update({
                    where: { id: existing.id },
                    data: {
                        status: targetStatus,
                        method: 'MANUAL_PAI',
                        recordedById: user.id,
                        recordedByName: user.name || 'Guru PAI',
                        notes: notes || 'Presensi massal diverifikasi Guru PAI'
                    }
                });
            } else {
                await (prisma as any).studentPrayerAttendance.create({
                    data: {
                        studentId: student.id,
                        studentName: student.name,
                        className: student.className || className,
                        gender,
                        prayerType: pType,
                        date: todayStr,
                        status: targetStatus,
                        method: 'MANUAL_PAI',
                        recordedById: user.id,
                        recordedByName: user.name || 'Guru PAI',
                        notes: notes || 'Presensi massal diverifikasi Guru PAI'
                    }
                });
            }
            updatedCount++;
        }

        res.json({
            success: true,
            updatedCount,
            message: `Berhasil mencatat ${updatedCount} siswa sebagai ${targetStatus}.`
        });
    } catch (error: any) {
        console.error('Error batchPaiMarkStudentPrayer:', error);
    }
};

// 4c. Siswi Melaporkan Uzur Syar'i (Haid/Berhalangan) 1-Tap Hari Ini
export const studentReportUzur = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const student = await prisma.user.findUnique({ where: { id: user.id } });
        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        const gender = (student.gender || 'L').toUpperCase();
        if (gender !== 'P' && !gender.includes('PEREMPUAN')) {
            return res.status(400).json({
                success: false,
                message: '⛔ Konfirmasi berhalangan sholat (haid/uzur) hanya berlaku untuk siswi perempuan.'
            });
        }

        const todayStr = getWibDayBounds(new Date()).ymd;
        const pType = getWibDayOfWeek() === 5 ? 'JUMAT' : 'DHUHUR';

        const existing = await (prisma as any).studentPrayerAttendance.findFirst({
            where: {
                studentId: student.id,
                date: todayStr
            }
        });

        if (existing) {
            if (existing.status === 'BERHALANGAN_HAID') {
                return res.json({
                    success: true,
                    alreadyRecorded: true,
                    message: `🌸 Status berhalangan (uzur syar'i) hari ini sudah tercatat pada pukul ${new Date(existing.createdAt).toTimeString().substring(0, 5)} WIB.`
                });
            }
            await (prisma as any).studentPrayerAttendance.update({
                where: { id: existing.id },
                data: {
                    status: 'BERHALANGAN_HAID',
                    method: 'STUDENT_APP_UZUR',
                    notes: "Konfirmasi mandiri siswi berhalangan (uzur syar'i/haid) via aplikasi APK"
                }
            });
        } else {
            await (prisma as any).studentPrayerAttendance.create({
                data: {
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className || '-',
                    gender: 'P',
                    prayerType: pType,
                    date: todayStr,
                    status: 'BERHALANGAN_HAID',
                    method: 'STUDENT_APP_UZUR',
                    recordedById: student.id,
                    recordedByName: student.name,
                    notes: "Konfirmasi mandiri siswi berhalangan (uzur syar'i/haid) via aplikasi APK"
                }
            });
        }

        // Kirim Notifikasi ke Orang Tua
        try {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className,
                    title: `🌸 Konfirmasi Keputrian: ${student.name}`,
                    message: `Ananda ${student.name} mengonfirmasi sedang berhalangan syar'i (haid) pada hari ini (${todayStr}). Tercatat resmi di rekap Guru PAI.`,
                    category: 'ATTENDANCE'
                }
            });
        } catch (nErr) {}

        return res.json({
            success: true,
            message: `🌸 Konfirmasi berhalangan (uzur syar'i) hari ini berhasil dicatat. Orang tua dan Guru PAI telah dinotifikasi.`
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: 'Gagal mencatat konfirmasi uzur: ' + error.message });
    }
};

// 5. Guru PAI Memantau Daftar Siswa Rombel yang Terjadwal Hari Ini (Live Monitor)
export const getPaiMonitoringByClass = async (req: Request, res: Response) => {
    try {
        const { className, date, prayerType } = req.query;
        const targetDate = String(date || new Date().toISOString().substring(0, 10));
        const targetDateObj = new Date(targetDate + 'T12:00:00+07:00');
        const dayOfWeek = targetDateObj.getDay();

        // Ambil seluruh jadwal aktif untuk hari tersebut (misal Dhuha & Dhuhur)
        const allTodaySchedules = await (prisma as any).prayerClassSchedule.findMany({
            where: { dayOfWeek, isActive: true },
            orderBy: { scanStartTime: 'asc' }
        });

        let pType = String(prayerType || '').toUpperCase();
        if (!pType) {
            const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
            const isMorning = nowWIB.getHours() < 10;
            const hasDhuha = allTodaySchedules.some((s: any) => s.prayerType === 'DHUHA');
            if (isMorning && hasDhuha) {
                pType = 'DHUHA';
            } else {
                pType = dayOfWeek === 5 ? 'JUMAT' : 'DHUHUR';
            }
        }

        // Ambil info jadwal yang sesuai dengan jenis sholat yang dipilih
        const schedule = allTodaySchedules.find((s: any) => s.prayerType === pType) || allTodaySchedules[0] || null;

        let targetClass = String(className || '').trim();
        if (!targetClass) {
            if (schedule?.classNames && schedule.classNames !== 'ALL_MALE' && schedule.classNames !== 'ALL') {
                targetClass = schedule.classNames.split(',')[0].trim();
            } else {
                targetClass = 'VII-A';
            }
        }

        // Ambil seluruh siswa di kelas tersebut
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className: targetClass },
            select: {
                id: true,
                name: true,
                nisn: true,
                gender: true,
                className: true,
                religion: true,
                profilePicUrl: true
            },
            orderBy: { name: 'asc' }
        });

        // Ambil catatan presensi sholat hari tersebut
        const attendances = await (prisma as any).studentPrayerAttendance.findMany({
            where: {
                className: targetClass,
                date: targetDate,
                prayerType: pType
            }
        });

        const attMap = new Map();
        attendances.forEach((a: any) => attMap.set(a.studentId, a));

        const enriched = students.map(s => {
            const att = attMap.get(s.id);
            const isFemale = (s.gender || '').toUpperCase().startsWith('P');
            let gpsStr: string | null = null;
            let latVal: number | null = null;
            let lngVal: number | null = null;
            if (att?.notes && att.notes.includes('GPS:')) {
                const match = att.notes.match(/GPS:\s*([-0-9.]+),\s*([-0-9.]+)/);
                if (match) {
                    gpsStr = `${match[1]}, ${match[2]}`;
                    latVal = parseFloat(match[1]);
                    lngVal = parseFloat(match[2]);
                }
            }
            return {
                ...s,
                isFemale,
                prayerStatus: att ? att.status : 'BELUM_PRESENSI',
                method: att?.method || null,
                recordedAt: att?.createdAt || null,
                notes: att?.notes || null,
                gps: gpsStr,
                lat: latVal,
                lng: lngVal
            };
        });

        const totalStudents = enriched.length;
        const sholatCount = enriched.filter(e => e.prayerStatus === 'SHOLAT_BERJAMAAH').length;
        const haidCount = enriched.filter(e => e.prayerStatus === 'BERHALANGAN_HAID').length;
        const belumCount = enriched.filter(e => e.prayerStatus === 'BELUM_PRESENSI' || e.prayerStatus === 'ALPHA').length;

        res.json({
            success: true,
            className: targetClass,
            date: targetDate,
            prayerType: pType,
            availablePrayers: allTodaySchedules,
            schedule: schedule ? {
                ...schedule,
                wudhuTime: schedule.wudhuTime || (pType === 'DHUHA' ? '06:45' : (pType === 'JUMAT' ? '11:30' : '11:45')),
                scanStartTime: schedule.scanStartTime || (pType === 'DHUHA' ? '07:00' : (pType === 'JUMAT' ? '11:45' : '12:00')),
                scanEndTime: schedule.scanEndTime || (pType === 'DHUHA' ? '07:45' : (pType === 'JUMAT' ? '12:45' : '12:30'))
            } : null,
            summary: {
                totalStudents,
                sholatCount,
                haidCount,
                belumCount
            },
            students: enriched
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat monitoring sholat: ' + error.message });
    }
};

// 6. Riwayat Ibadah untuk Siswa & Orang Tua
export const getStudentPrayerHistory = async (req: Request, res: Response) => {
    try {
        const { studentId } = req.params;
        const history = await (prisma as any).studentPrayerAttendance.findMany({
            where: { studentId },
            orderBy: { createdAt: 'desc' },
            take: 30
        });

        res.json({ success: true, history });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat riwayat ibadah: ' + error.message });
    }
};

// 7. Cetak / Unduh Rekap Presensi Sholat Format PDF Resmi A4
export const exportPrayerAttendancePdf = async (req: Request, res: Response) => {
    try {
        const { className, date, prayerType, autoprint, download, period, range } = req.query;
        const cleanClass = className ? String(className).trim() : 'ALL';
        const isAllClasses = !className || cleanClass.toUpperCase() === 'ALL' || cleanClass.toUpperCase() === 'SEMUA' || cleanClass.toUpperCase() === 'SEMUA KELAS';
        const isWeekly = String(period || range || '').toUpperCase() === 'WEEKLY' || String(period || range || '').toUpperCase() === 'MINGGUAN' || String(period || range || '').toUpperCase() === '1_MINGGU';

        const targetDate = String(date || new Date().toISOString().substring(0, 10));
        const targetDateObj = new Date(targetDate + 'T12:00:00+07:00');
        const dayOfWeek = targetDateObj.getDay();
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const dayName = dayNames[dayOfWeek];

        const pType = String(prayerType || (dayOfWeek === 5 ? 'JUMAT' : 'DHUHUR')).toUpperCase();

        const sigs = await getSchoolSignatures();

        // Ambil jadwal sholat hari itu sesuai jenis sholat yang diekspor
        const schedule = await (prisma as any).prayerClassSchedule.findFirst({
            where: { dayOfWeek, prayerType: pType, isActive: true }
        });

        const defaultWudhu = pType === 'DHUHA' ? '06:45' : (pType === 'JUMAT' ? '11:30' : '11:45');
        const defaultStart = pType === 'DHUHA' ? '07:00' : (pType === 'JUMAT' ? '11:45' : '12:00');
        const defaultEnd = pType === 'DHUHA' ? '07:45' : (pType === 'JUMAT' ? '12:45' : '12:30');

        const wudhuTime = schedule?.wudhuTime || defaultWudhu;
        const scanStartTime = schedule?.scanStartTime || defaultStart;
        const scanEndTime = schedule?.scanEndTime || defaultEnd;

        const formattedDate = targetDateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

        const teacherName = (req as any).user?.name || 'Guru Pembina PAI';
        const teacherNip = (req as any).user?.nip || '-';

        let html = '';

        if (isAllClasses) {
            // Ambil seluruh rombel kelas
            const allClasses = await prisma.class.findMany({
                orderBy: { name: 'asc' }
            });

            // Ambil semua siswa aktif
            const allStudents = await prisma.user.findMany({
                where: { role: 'STUDENT', isActive: true },
                select: { id: true, name: true, nisn: true, gender: true, className: true },
                orderBy: [{ className: 'asc' }, { name: 'asc' }]
            });

            // Ambil seluruh rekaman presensi sholat hari tersebut
            const attendances = await (prisma as any).studentPrayerAttendance.findMany({
                where: {
                    date: targetDate,
                    prayerType: pType
                }
            });

            const attMap = new Map<string, any>();
            attendances.forEach((a: any) => attMap.set(a.studentId, a));

            // Map siswa berdasarkan rombel kelas
            const studentsByClass = new Map<string, any[]>();
            allStudents.forEach(s => {
                const cName = s.className || 'Tanpa Kelas';
                if (!studentsByClass.has(cName)) studentsByClass.set(cName, []);
                studentsByClass.get(cName)!.push(s);
            });

            let grandTotalStudents = 0;
            let grandTotalSholat = 0;
            let grandTotalHaid = 0;
            let grandTotalAlpha = 0;

            const classList = allClasses.length > 0
                ? allClasses.map(c => ({ name: c.name, homeroomTeacher: (c as any).homeroomTeacher || (c as any).homeroom || '-' }))
                : Array.from(studentsByClass.keys()).sort().map(k => ({ name: k, homeroomTeacher: '-' }));

            const classSummaries: any[] = [];

            classList.forEach((clsObj, idx) => {
                const cStudents = studentsByClass.get(clsObj.name) || [];
                let cSholat = 0;
                let cHaid = 0;
                let cAlpha = 0;

                cStudents.forEach(s => {
                    const att = attMap.get(s.id);
                    const status = att ? att.status : 'ALPHA';
                    if (status === 'SHOLAT_BERJAMAAH') cSholat++;
                    else if (status === 'BERHALANGAN_HAID') cHaid++;
                    else cAlpha++;
                });

                const totalInClass = cStudents.length;
                grandTotalStudents += totalInClass;
                grandTotalSholat += cSholat;
                grandTotalHaid += cHaid;
                grandTotalAlpha += cAlpha;

                const percent = totalInClass > 0 ? ((cSholat / totalInClass) * 100).toFixed(1) : '0';

                classSummaries.push({
                    no: idx + 1,
                    className: clsObj.name,
                    homeroom: clsObj.homeroomTeacher || '-',
                    total: totalInClass,
                    sholat: cSholat,
                    haid: cHaid,
                    alpha: cAlpha,
                    percent: percent + '%'
                });
            });

            const grandPercent = grandTotalStudents > 0 ? ((grandTotalSholat / grandTotalStudents) * 100).toFixed(1) + '%' : '0%';

            const summaryRowsHtml = classSummaries.map(cs => `
                <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
                    <td style="padding: 5px 8px; text-align: center; color: #64748b;">${cs.no}</td>
                    <td style="padding: 5px 8px; font-weight: bold; text-align: center; color: #1e293b;">${cs.className}</td>
                    <td style="padding: 5px 8px; color: #334155;">${cs.homeroom}</td>
                    <td style="padding: 5px 8px; text-align: center; font-weight: bold;">${cs.total}</td>
                    <td style="padding: 5px 8px; text-align: center; font-weight: bold; color: #15803d; background: #f0fdf4;">${cs.sholat}</td>
                    <td style="padding: 5px 8px; text-align: center; font-weight: bold; color: #be185d; background: #fdf2f8;">${cs.haid}</td>
                    <td style="padding: 5px 8px; text-align: center; font-weight: bold; color: #b91c1c; background: #fef2f2;">${cs.alpha}</td>
                    <td style="padding: 5px 8px; text-align: center; font-weight: bold; color: #0369a1;">${cs.percent}</td>
                </tr>
            `).join('');

            let detailTablesHtml = '';
            classList.forEach(clsObj => {
                const cStudents = studentsByClass.get(clsObj.name) || [];
                if (cStudents.length === 0) return;

                const studentRows = cStudents.map((s, sIdx) => {
                    const att = attMap.get(s.id);
                    const genderStr = (s.gender || 'L').toUpperCase().startsWith('P') ? 'P' : 'L';
                    const status = att ? att.status : 'ALPHA';
                    const recTime = att?.createdAt ? formatTimeWibWithSuffix(att.createdAt) : '-';
                    const method = att?.method === 'STATIC_BARCODE' ? 'Scan Barcode' : (att?.method === 'MANUAL_PAI' ? 'Guru PAI' : '-');

                    let badgeHtml = '';
                    if (status === 'SHOLAT_BERJAMAAH') {
                        badgeHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-weight:700; font-size:9.5px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">🕌 SHOLAT</span>';
                    } else if (status === 'BERHALANGAN_HAID') {
                        badgeHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-weight:700; font-size:9.5px; background:#fce7f3; color:#be185d; border:1px solid #fbcfe8;">🌸 HAID</span>';
                    } else {
                        badgeHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-weight:700; font-size:9.5px; background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;">❌ ALPHA</span>';
                    }

                    return `
                        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 10px;">
                            <td style="padding: 4px 6px; text-align: center; color: #64748b;">${sIdx + 1}</td>
                            <td style="padding: 4px 6px; font-family: monospace; text-align: center;">${s.nisn || '-'}</td>
                            <td style="padding: 4px 6px; font-weight: 600; color: #1e293b;">${s.name}</td>
                            <td style="padding: 4px 6px; text-align: center; font-weight: bold; color: ${genderStr === 'P' ? '#db2777' : '#0284c7'};">${genderStr}</td>
                            <td style="padding: 4px 6px; text-align: center;">${badgeHtml}</td>
                            <td style="padding: 4px 6px; text-align: center; font-family: monospace;">${recTime}</td>
                            <td style="padding: 4px 6px; font-size: 9.5px; color: #475569;">${method}</td>
                            <td style="padding: 4px 6px; font-size: 9.5px; color: #64748b;">${att?.notes || '-'}</td>
                        </tr>
                    `;
                }).join('');

                detailTablesHtml += `
                    <div style="margin-top: 18px; page-break-inside: avoid;">
                        <div style="background: #f1f5f9; padding: 6px 10px; border-left: 4px solid #4f46e5; font-weight: bold; font-size: 11px; margin-bottom: 4px; display: flex; justify-content: space-between;">
                            <span>🏢 Rombel: <b>${clsObj.name}</b> (Wali: ${clsObj.homeroomTeacher})</span>
                            <span style="color: #475569; font-weight: 600;">Total: ${cStudents.length} Siswa</span>
                        </div>
                        <table class="data-table" style="margin-top: 0; margin-bottom: 8px;">
                            <thead>
                                <tr>
                                    <th style="width: 25px;">No</th>
                                    <th style="width: 85px;">NISN</th>
                                    <th>Nama Siswa</th>
                                    <th style="width: 30px;">L/P</th>
                                    <th style="width: 100px;">Status</th>
                                    <th style="width: 65px;">Waktu</th>
                                    <th style="width: 90px;">Metode</th>
                                    <th style="width: 100px;">Catatan</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${studentRows}
                            </tbody>
                        </table>
                    </div>
                `;
            });

            html = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Rekap Presensi Sholat ${pType} - Seluruh Rombel Kelas - ${targetDate}</title>
    <style>
        @page { size: A4 portrait; margin: 12mm 12mm 12mm 12mm; }
        body { font-family: 'Times New Roman', Times, serif; color: #000; margin: 0; padding: 0; line-height: 1.25; font-size: 11px; }
        .kop-table { width: 100%; border-bottom: 3px double #000; padding-bottom: 6px; margin-bottom: 10px; }
        .kop-logo { width: 70px; height: 70px; object-fit: contain; }
        .kop-text { text-align: center; }
        .kop-instansi { font-size: 12px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; margin: 0; }
        .kop-school { font-size: 16px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin: 2px 0; }
        .kop-address { font-size: 9.5px; font-style: italic; margin: 0; color: #111; }
        .doc-title { text-align: center; font-size: 13px; font-weight: bold; text-decoration: underline; margin-top: 8px; text-transform: uppercase; }
        .doc-subtitle { text-align: center; font-size: 10.5px; margin-top: 2px; margin-bottom: 12px; font-weight: bold; }
        .meta-table { width: 100%; margin-bottom: 10px; font-size: 11px; }
        .meta-table td { padding: 2px 4px; vertical-align: top; }
        .stat-grid { display: flex; gap: 8px; margin-bottom: 12px; }
        .stat-box { flex: 1; border: 1px solid #94a3b8; border-radius: 6px; padding: 6px 8px; text-align: center; background: #f8fafc; font-size: 10.5px; }
        .stat-box b { font-size: 13.5px; display: block; margin-top: 2px; }
        table.data-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-family: Arial, Helvetica, sans-serif; }
        table.data-table th { background: #0f172a; color: #fff; border: 1px solid #334155; padding: 5px 6px; font-size: 10px; text-align: center; }
        table.data-table td { border: 1px solid #cbd5e1; vertical-align: middle; }
        .sig-table { width: 100%; margin-top: 24px; page-break-inside: avoid; }
        .sig-table td { width: 50%; text-align: center; vertical-align: top; font-size: 11px; }
        .no-print { margin-bottom: 14px; padding: 8px 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; text-align: center; font-family: Arial, sans-serif; }
        @media print {
            .no-print { display: none !important; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
</head>
<body>
    <div class="no-print">
        <button onclick="window.print()" style="background:#0284c7; color:#fff; font-weight:bold; padding:8px 20px; border:none; border-radius:6px; cursor:pointer; font-size:13px;">🖨️ Cetak / Simpan PDF</button>
        <span style="margin-left: 12px; font-size: 12px; color: #475569;">Rekap Seluruh Rombel Kelas (${classList.length} Kelas • ${grandTotalStudents} Siswa)</span>
    </div>

    <!-- Kop Surat Resmi -->
    <table class="kop-table">
        <tr>
            <td style="width: 75px; text-align: center;">
                <img src="/images/logo-smpn1.png" onerror="this.src='/images/kemdikbud.png'" class="kop-logo" alt="Logo">
            </td>
            <td class="kop-text">
                <p class="kop-instansi">PEMERINTAH KABUPATEN TULUNGAGUNG<br>DINAS PENDIDIKAN</p>
                <h1 class="kop-school">${sigs.schoolName.toUpperCase()}</h1>
                <p class="kop-address">Jalan Raya Boyolangu, Kec. Boyolangu, Kab. Tulungagung 66271 | Telp. 0355324146<br>Website: www.smpn1boyolangu.sch.id • Surel: info@smpn1boyolangu.sch.id</p>
            </td>
            <td style="width: 75px; text-align: center;">
                <img src="/images/kemdikbud.png" class="kop-logo" alt="Logo Kemdikbud">
            </td>
        </tr>
    </table>

    <div class="doc-title">REKAPITULASI PRESENSI SHOLAT ${pType} BERJAMAAH ${pType === 'JUMAT' ? '&amp; KEPUTRIAN' : ''}</div>
    <div class="doc-subtitle">SELURUH ROMBEL KELAS • TAHUN AJARAN 2025/2026 • MASJID ${sigs.schoolName.toUpperCase()}</div>

    <table class="meta-table">
        <tr>
            <td style="width: 15%; font-weight: bold;">Cakupan Rombel</td>
            <td style="width: 35%;">: <b>Seluruh Rombel (${classList.length} Rombel Kelas)</b></td>
            <td style="width: 18%; font-weight: bold;">Hari / Tanggal</td>
            <td style="width: 32%;">: ${dayName}, ${formattedDate}</td>
        </tr>
        <tr>
            <td style="font-weight: bold;">Jenis Ibadah</td>
            <td>: Sholat ${pType === 'JUMAT' ? 'Jumat Berjamaah (Putra) / Keputrian (Putri)' : (pType === 'DHUHA' ? 'Dhuha Berjamaah (Pagi)' : 'Dhuhur Berjamaah')}</td>
            <td style="font-weight: bold;">Jadwal Ibadah</td>
            <td>: Wudhu: <b>${wudhuTime} WIB</b> • Scan: <b>${scanStartTime} - ${scanEndTime} WIB</b></td>
        </tr>
    </table>

    <div class="stat-grid">
        <div class="stat-box">
            Total Seluruh Siswa
            <b style="color: #0f172a;">${grandTotalStudents}</b>
        </div>
        <div class="stat-box" style="background:#f0fdf4; border-color:#86efac;">
            Hadir Berjamaah
            <b style="color: #15803d;">${grandTotalSholat} (${grandPercent})</b>
        </div>
        <div class="stat-box" style="background:#fdf2f8; border-color:#fbcfe8;">
            Berhalangan (Haid)
            <b style="color: #be185d;">${grandTotalHaid}</b>
        </div>
        <div class="stat-box" style="background:#fef2f2; border-color:#fca5a5;">
            Alpha / Belum
            <b style="color: #b91c1c;">${grandTotalAlpha}</b>
        </div>
    </div>

    <!-- Bagian 1: Ringkasan Rekapitulasi Per Rombel -->
    <h4 style="margin: 10px 0 4px 0; font-size: 11.5px; font-weight: bold; text-transform: uppercase;">I. Rekapitulasi Kehadiran Sholat Per Rombel Kelas</h4>
    <table class="data-table">
        <thead>
            <tr>
                <th style="width: 30px;">No</th>
                <th style="width: 90px;">Rombel</th>
                <th>Wali Kelas</th>
                <th style="width: 65px;">Total Siswa</th>
                <th style="width: 75px;">Hadir Sholat</th>
                <th style="width: 75px;">Haid</th>
                <th style="width: 75px;">Alpha</th>
                <th style="width: 70px;">% Hadir</th>
            </tr>
        </thead>
        <tbody>
            ${summaryRowsHtml}
        </tbody>
        <tfoot>
            <tr style="background: #0f172a; color: #fff; font-weight: bold; font-size: 11px; text-align: center;">
                <td colspan="3" style="padding: 6px 8px; text-align: right;">TOTAL KESELURUHAN:</td>
                <td style="padding: 6px 8px;">${grandTotalStudents}</td>
                <td style="padding: 6px 8px; color: #86efac;">${grandTotalSholat}</td>
                <td style="padding: 6px 8px; color: #fbcfe8;">${grandTotalHaid}</td>
                <td style="padding: 6px 8px; color: #fca5a5;">${grandTotalAlpha}</td>
                <td style="padding: 6px 8px; color: #7dd3fc;">${grandPercent}</td>
            </tr>
        </tfoot>
    </table>

    <!-- Bagian 2: Rincian Presensi Seluruh Siswa Per Kelas -->
    <h4 style="margin: 18px 0 4px 0; font-size: 11.5px; font-weight: bold; text-transform: uppercase;">II. Rincian Presensi Siswa Masing-Masing Kelas</h4>
    ${detailTablesHtml}

    <!-- Tanda Tangan Resmi Dinamis Sesuai Pengaturan Sistem -->
    <table class="sig-table">
        <tr>
            <td>
                Mengetahui,<br>
                ${sigs.headmasterTitle}
                <div style="height: 65px;"></div>
                <b><u>${sigs.headmasterName}</u></b><br>
                NIP. ${sigs.headmasterNip}
            </td>
            <td>
                Tulungagung, ${formattedDate}<br>
                Guru Pembina PAI &amp; Budi Pekerti
                <div style="height: 65px;"></div>
                <b><u>${teacherName}</u></b><br>
                NIP. ${teacherNip}
            </td>
        </tr>
    </table>

    ${autoprint === '1' ? '<script>window.addEventListener("load", () => { setTimeout(() => window.print(), 500); });</script>' : ''}
</body>
</html>
            `;
        } else {
            // SINGLE CLASS RECAP
            const students = await prisma.user.findMany({
                where: { role: 'STUDENT', className: cleanClass },
                select: { id: true, name: true, nisn: true, gender: true, className: true },
                orderBy: { name: 'asc' }
            });

            let thColumnsHtml = '';
            let rowsHtml = '';
            let periodSubtitle = '';
            let sholatCount = 0;
            let haidCount = 0;
            let alphaCount = 0;

            if (isWeekly) {
                // Tentukan tanggal Senin sampai Sabtu pekan ini (6 hari operasional sekolah)
                const refDate = new Date(targetDate + 'T12:00:00+07:00');
                const day = refDate.getDay();
                const diffToMonday = day === 0 ? -6 : 1 - day;
                const mondayDate = new Date(refDate);
                mondayDate.setDate(refDate.getDate() + diffToMonday);

                const weekDays: { dateStr: string; dayName: string }[] = [];
                const dayLabels = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                for (let i = 0; i < 6; i++) {
                    const d = new Date(mondayDate);
                    d.setDate(mondayDate.getDate() + i);
                    weekDays.push({
                        dateStr: d.toISOString().substring(0, 10),
                        dayName: dayLabels[i]
                    });
                }

                const weekDates = weekDays.map(w => w.dateStr);
                const attendances = await (prisma as any).studentPrayerAttendance.findMany({
                    where: {
                        className: cleanClass,
                        date: { in: weekDates },
                        prayerType: pType
                    }
                });

                const attWeekMap = new Map<string, Map<string, string>>();
                attendances.forEach((a: any) => {
                    if (!attWeekMap.has(a.studentId)) attWeekMap.set(a.studentId, new Map());
                    attWeekMap.get(a.studentId)!.set(a.date, a.status);
                });

                thColumnsHtml = `
                    <th style="width: 25px;">No</th>
                    <th style="width: 85px;">NISN</th>
                    <th>Nama Siswa</th>
                    <th style="width: 30px;">L/P</th>
                    ${weekDays.map(w => `<th style="width: 55px;">${w.dayName}<br><span style="font-size:8px; font-weight:normal;">${w.dateStr.substring(5)}</span></th>`).join('')}
                    <th style="width: 45px; background: #065f46;">Sholat</th>
                    <th style="width: 45px; background: #9d174d;">Haid</th>
                    <th style="width: 45px; background: #991b1b;">Alpha</th>
                    <th style="width: 45px; background: #1e40af;">%</th>
                `;

                rowsHtml = students.map((s, idx) => {
                    const sAtts = attWeekMap.get(s.id) || new Map();
                    let sSholat = 0;
                    let sHaid = 0;
                    let sAlpha = 0;

                    const dayCells = weekDays.map(w => {
                        const st = sAtts.get(w.dateStr);
                        if (st === 'SHOLAT_BERJAMAAH') {
                            sSholat++;
                            return '<td style="padding: 5px; text-align: center; color: #15803d; font-weight: bold; background: #f0fdf4;">🕌 H</td>';
                        } else if (st === 'BERHALANGAN_HAID') {
                            sHaid++;
                            return '<td style="padding: 5px; text-align: center; color: #be185d; font-weight: bold; background: #fdf2f8;">🌸 Haid</td>';
                        } else {
                            sAlpha++;
                            return '<td style="padding: 5px; text-align: center; color: #b91c1c; font-weight: bold; background: #fef2f2;">-</td>';
                        }
                    }).join('');

                    sholatCount += sSholat;
                    haidCount += sHaid;
                    alphaCount += sAlpha;

                    const percent = ((sSholat / weekDays.length) * 100).toFixed(0);
                    const genderStr = (s.gender || 'L').toUpperCase().startsWith('P') ? 'P' : 'L';

                    return `
                        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
                            <td style="padding: 5px 6px; text-align: center; color: #64748b;">${idx + 1}</td>
                            <td style="padding: 5px 6px; font-family: monospace; font-size: 10.5px; text-align: center;">${s.nisn || '-'}</td>
                            <td style="padding: 5px 6px; font-weight: 600; color: #1e293b;">${s.name}</td>
                            <td style="padding: 5px 6px; text-align: center; font-weight: bold; color: ${genderStr === 'P' ? '#db2777' : '#0284c7'};">${genderStr}</td>
                            ${dayCells}
                            <td style="padding: 5px 6px; text-align: center; font-weight: bold; color: #15803d;">${sSholat}</td>
                            <td style="padding: 5px 6px; text-align: center; font-weight: bold; color: #be185d;">${sHaid}</td>
                            <td style="padding: 5px 6px; text-align: center; font-weight: bold; color: #b91c1c;">${sAlpha}</td>
                            <td style="padding: 5px 6px; text-align: center; font-weight: bold; color: #0284c7;">${percent}%</td>
                        </tr>
                    `;
                }).join('');

                periodSubtitle = `PERIODE 1 MINGGU PENUH (${weekDays[0].dateStr} s.d. ${weekDays[weekDays.length - 1].dateStr})`;
            } else {
                // DAILY RECAP
                const attendances = await (prisma as any).studentPrayerAttendance.findMany({
                    where: {
                        className: cleanClass,
                        date: targetDate,
                        prayerType: pType
                    }
                });

                const attMap = new Map();
                attendances.forEach((a: any) => attMap.set(a.studentId, a));

                thColumnsHtml = `
                    <th style="width: 25px;">No</th>
                    <th style="width: 85px;">NISN</th>
                    <th>Nama Siswa</th>
                    <th style="width: 30px;">L/P</th>
                    <th style="width: 140px;">Status</th>
                    <th style="width: 75px;">Waktu</th>
                    <th style="width: 110px;">Metode</th>
                    <th>Catatan</th>
                `;

                rowsHtml = students.map((s, idx) => {
                    const att = attMap.get(s.id);
                    const genderStr = (s.gender || 'L').toUpperCase().startsWith('P') ? 'P' : 'L';
                    const status = att ? att.status : 'ALPHA';
                    const recTime = att?.createdAt ? formatTimeWibWithSuffix(att.createdAt) : '-';
                    const method = att?.method === 'STATIC_BARCODE' ? 'Scan Barcode Masjid' : (att?.method === 'MANUAL_PAI' ? 'Verifikasi Guru PAI' : '-');

                    let badgeHtml = '';
                    if (status === 'SHOLAT_BERJAMAAH') {
                        sholatCount++;
                        badgeHtml = '<span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-weight:700; font-size:10px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">🕌 HADIR BERJAMAAH</span>';
                    } else if (status === 'BERHALANGAN_HAID') {
                        haidCount++;
                        badgeHtml = '<span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-weight:700; font-size:10px; background:#fce7f3; color:#be185d; border:1px solid #fbcfe8;">🌸 BERHALANGAN (HAID)</span>';
                    } else {
                        alphaCount++;
                        badgeHtml = '<span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-weight:700; font-size:10px; background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;">❌ BELUM PRESENSI / ALPHA</span>';
                    }

                    return `
                        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
                            <td style="padding: 6px 8px; text-align: center; color: #64748b;">${idx + 1}</td>
                            <td style="padding: 6px 8px; font-family: monospace; font-size: 11px; text-align: center;">${s.nisn || '-'}</td>
                            <td style="padding: 6px 8px; font-weight: 600; color: #1e293b;">${s.name}</td>
                            <td style="padding: 6px 8px; text-align: center; font-weight: 700; color: ${genderStr === 'P' ? '#db2777' : '#0284c7'};">${genderStr}</td>
                            <td style="padding: 6px 8px; text-align: center;">${badgeHtml}</td>
                            <td style="padding: 6px 8px; text-align: center; font-family: monospace; font-size: 10px;">${recTime}</td>
                            <td style="padding: 6px 8px; font-size: 10px; color: #475569;">${method}</td>
                            <td style="padding: 6px 8px; font-size: 10px; color: #64748b;">${att?.notes || '-'}</td>
                        </tr>
                    `;
                }).join('');

                periodSubtitle = `HARIAN • ${dayName}, ${formattedDate}`;
            }

            html = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Rekap Presensi Sholat ${pType} - Kelas ${cleanClass} - ${targetDate}</title>
    <style>
        @page { size: A4 portrait; margin: 15mm 15mm 15mm 15mm; }
        body { font-family: 'Times New Roman', Times, serif; color: #000; margin: 0; padding: 0; line-height: 1.3; font-size: 12px; }
        .kop-table { width: 100%; border-bottom: 3px double #000; padding-bottom: 8px; margin-bottom: 14px; }
        .kop-logo { width: 75px; height: 75px; object-fit: contain; }
        .kop-text { text-align: center; }
        .kop-instansi { font-size: 13px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; margin: 0; }
        .kop-school { font-size: 17px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin: 2px 0; }
        .kop-address { font-size: 10px; font-style: italic; margin: 0; color: #111; }
        .doc-title { text-align: center; font-size: 13.5px; font-weight: bold; text-decoration: underline; margin-top: 10px; text-transform: uppercase; }
        .doc-subtitle { text-align: center; font-size: 11px; margin-top: 2px; margin-bottom: 14px; font-weight: bold; }
        .meta-table { width: 100%; margin-bottom: 12px; font-size: 11.5px; }
        .meta-table td { padding: 2px 4px; vertical-align: top; }
        .stat-grid { display: flex; gap: 10px; margin-bottom: 12px; }
        .stat-box { flex: 1; border: 1px solid #94a3b8; border-radius: 6px; padding: 6px 8px; text-align: center; background: #f8fafc; font-size: 11px; }
        .stat-box b { font-size: 14px; display: block; margin-top: 2px; }
        table.data-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-family: Arial, Helvetica, sans-serif; }
        table.data-table th { background: #0f172a; color: #fff; border: 1px solid #334155; padding: 6px 6px; font-size: 10.5px; text-align: center; }
        table.data-table td { border: 1px solid #cbd5e1; vertical-align: middle; }
        .sig-table { width: 100%; margin-top: 28px; page-break-inside: avoid; }
        .sig-table td { width: 50%; text-align: center; vertical-align: top; font-size: 11.5px; }
        .no-print { margin-bottom: 16px; padding: 10px 16px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; text-align: center; font-family: Arial, sans-serif; }
        @media print {
            .no-print { display: none !important; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
</head>
<body>
    <div class="no-print">
        <button onclick="window.print()" style="background:#0284c7; color:#fff; font-weight:bold; padding:8px 20px; border:none; border-radius:6px; cursor:pointer; font-size:13px;">🖨️ Cetak / Simpan PDF</button>
        <span style="margin-left: 12px; font-size: 12px; color: #475569;">Gunakan menu "Save as PDF" di dialog cetak browser Anda.</span>
    </div>

    <!-- Kop Surat Resmi -->
    <table class="kop-table">
        <tr>
            <td style="width: 80px; text-align: center;">
                <img src="/images/logo-smpn1.png" onerror="this.src='/images/kemdikbud.png'" class="kop-logo" alt="Logo">
            </td>
            <td class="kop-text">
                <p class="kop-instansi">PEMERINTAH KABUPATEN TULUNGAGUNG<br>DINAS PENDIDIKAN</p>
                <h1 class="kop-school">${sigs.schoolName.toUpperCase()}</h1>
                <p class="kop-address">Jalan Raya Boyolangu, Kec. Boyolangu, Kab. Tulungagung 66271 | Telp. 0355324146<br>Website: www.smpn1boyolangu.sch.id • Surel: info@smpn1boyolangu.sch.id</p>
            </td>
            <td style="width: 80px; text-align: center;">
                <img src="/images/kemdikbud.png" class="kop-logo" alt="Logo Kemdikbud">
            </td>
        </tr>
    </table>

    <div class="doc-title">REKAPITULASI PRESENSI SHOLAT ${pType} BERJAMAAH ${pType === 'JUMAT' ? '&amp; KEPUTRIAN' : ''}</div>
    <div class="doc-subtitle">${periodSubtitle} • TAHUN AJARAN 2025/2026 • MASJID ${sigs.schoolName.toUpperCase()}</div>

    <table class="meta-table">
        <tr>
            <td style="width: 15%; font-weight: bold;">Rombel / Kelas</td>
            <td style="width: 35%;">: <b>${cleanClass}</b></td>
            <td style="width: 18%; font-weight: bold;">Periode Rekap</td>
            <td style="width: 32%;">: <b>${isWeekly ? '1 Minggu Penuh' : `${dayName}, ${formattedDate}`}</b></td>
        </tr>
        <tr>
            <td style="font-weight: bold;">Jenis Ibadah</td>
            <td>: Sholat ${pType === 'JUMAT' ? 'Jumat Berjamaah (Putra) / Keputrian (Putri)' : (pType === 'DHUHA' ? 'Dhuha Berjamaah (Pagi)' : 'Dhuhur Berjamaah')}</td>
            <td style="font-weight: bold;">Jadwal Ibadah</td>
            <td>: Wudhu: <b>${wudhuTime} WIB</b> • Scan: <b>${scanStartTime} - ${scanEndTime} WIB</b></td>
        </tr>
    </table>

    <div class="stat-grid">
        <div class="stat-box">
            Total Siswa
            <b style="color: #0f172a;">${students.length}</b>
        </div>
        <div class="stat-box" style="background:#f0fdf4; border-color:#86efac;">
            ${isWeekly ? 'Akumulasi Hadir' : 'Hadir Berjamaah'}
            <b style="color: #15803d;">${sholatCount}</b>
        </div>
        <div class="stat-box" style="background:#fdf2f8; border-color:#fbcfe8;">
            ${isWeekly ? 'Akumulasi Haid' : 'Berhalangan (Haid)'}
            <b style="color: #be185d;">${haidCount}</b>
        </div>
        <div class="stat-box" style="background:#fef2f2; border-color:#fca5a5;">
            ${isWeekly ? 'Akumulasi Alpha' : 'Alpha / Belum'}
            <b style="color: #b91c1c;">${alphaCount}</b>
        </div>
    </div>

    <table class="data-table">
        <thead>
            <tr>
                ${thColumnsHtml}
            </tr>
        </thead>
        <tbody>
            ${rowsHtml || `<tr><td colspan="${isWeekly ? 9 : 8}" style="text-align:center; padding:12px; color:#64748b;">Tidak ada data siswa pada rombel ini</td></tr>`}
        </tbody>
    </table>

    <!-- Tanda Tangan Resmi Dinamis Sesuai Pengaturan Sistem -->
    <table class="sig-table">
        <tr>
            <td>
                Mengetahui,<br>
                ${sigs.headmasterTitle}
                <div style="height: 65px;"></div>
                <b><u>${sigs.headmasterName}</u></b><br>
                NIP. ${sigs.headmasterNip}
            </td>
            <td>
                Tulungagung, ${formattedDate}<br>
                Guru Pembina PAI &amp; Budi Pekerti
                <div style="height: 65px;"></div>
                <b><u>${teacherName}</u></b><br>
                NIP. ${teacherNip}
            </td>
        </tr>
    </table>

    ${autoprint === '1' ? '<script>window.addEventListener("load", () => { setTimeout(() => window.print(), 500); });</script>' : ''}
</body>
</html>
            `;
        }

        if (download === '1') {
            res.setHeader('Content-Disposition', `attachment; filename="Rekap_Sholat_${cleanClass}_${targetDate}.html"`);
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error: any) {
        console.error('Error in exportPrayerAttendancePdf:', error);
        res.status(500).send('Gagal mengekspor laporan presensi sholat: ' + error.message);
    }
};

/**
 * Guru PAI scan barcode/kartu pelajar siswa yang tidak membawa/mempunyai HP.
 * Otomatis mencatat Sholat Mushola DAN otomatis Gate In / Gate Out sekolah!
 * POST /api/prayer/pai-scan-student-card
 */
export const paiScanStudentCard = async (req: Request, res: Response) => {
    try {
        const teacher = (req as any).user;
        const { barcode, prayerType, status } = req.body;

        if (!barcode) {
            return res.status(400).json({ success: false, message: 'Barcode / ID kartu pelajar wajib diisi' });
        }

        const cleanCode = String(barcode).trim();
        // Cari siswa berdasarkan nisn, nis, rfidChipUid, username, atau id
        const student = await prisma.user.findFirst({
            where: {
                role: 'STUDENT',
                OR: [
                    { nisn: cleanCode },
                    { nis: cleanCode },
                    { rfidChipUid: cleanCode },
                    { username: cleanCode },
                    { id: cleanCode }
                ]
            }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: `Siswa dengan barcode/kartu "${cleanCode}" tidak ditemukan di database sekolah.`
            });
        }

        const today = new Date();
        const { startOfDay, endOfDay, ymd: todayStr, hour: hourNow, minute: minuteNow } = getWibDayBounds(today);
        const nowTimeStr = getWibTimeColon(today);
        const pType = prayerType || 'DHUHUR';
        const pStatus = status || 'SHOLAT_BERJAMAAH';

        // 1. Simpan Presensi Sholat Siswa
        const existingPrayer = await (prisma as any).prayerAttendance.findFirst({
            where: {
                userId: student.id,
                date: {
                    gte: startOfDay,
                    lte: endOfDay
                },
                prayerType: pType
            }
        });

        if (existingPrayer) {
            await (prisma as any).prayerAttendance.update({
                where: { id: existingPrayer.id },
                data: {
                    status: pStatus,
                    verifiedBy: teacher?.name || 'Guru PAI',
                    method: 'PAI_ASSISTED_CARD_SCAN',
                    note: `Discan langsung oleh Guru PAI (${teacher?.name || 'PAI'}) via Kartu Pelajar Fisik`
                }
            });
        } else {
            await (prisma as any).prayerAttendance.create({
                data: {
                    userId: student.id,
                    userName: student.name,
                    className: student.className || '-',
                    prayerType: pType,
                    status: pStatus,
                    date: today,
                    verifiedBy: teacher?.name || 'Guru PAI',
                    method: 'PAI_ASSISTED_CARD_SCAN',
                    note: `Discan langsung oleh Guru PAI (${teacher?.name || 'PAI'}) via Kartu Pelajar Fisik`
                }
            });
        }

        // 2. Integrasi Otomatis Gate In & Gate Out Sekolah
        const existingGateIn = await prisma.attendance.findFirst({
            where: {
                userId: student.id,
                type: 'GATE_IN',
                scanTime: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });

        let gateInRecorded = false;
        if (!existingGateIn) {
            await prisma.attendance.create({
                data: {
                    userId: student.id,
                    type: 'GATE_IN',
                    status: 'PRESENT',
                    scanTime: today,
                    method: 'CARD_SCAN_PAI',
                    note: 'Hadir Sekolah & Mushola (Bantuan Scan Guru PAI)'
                }
            });
            gateInRecorded = true;
        }

        let gateOutRecorded = false;
        const totalMinutes = hourNow * 60 + minuteNow;

        // Jika jam 12:00 ke atas (720 menit WIB)
        if (totalMinutes >= 720) {
            const existingGateOut = await prisma.attendance.findFirst({
                where: {
                    userId: student.id,
                    type: 'GATE_OUT',
                    scanTime: {
                        gte: startOfDay,
                        lte: endOfDay
                    }
                }
            });

            if (!existingGateOut) {
                await prisma.attendance.create({
                    data: {
                        userId: student.id,
                        type: 'GATE_OUT',
                        status: 'PRESENT',
                        scanTime: today,
                        method: 'CARD_SCAN_PAI',
                        note: 'Kepulangan Otomatis Mushola (Bantuan Scan Guru PAI)'
                    }
                });
                gateOutRecorded = true;
            }
        }

        let summaryMsg = `Alhamdulillah! Presensi Sholat ${pType} untuk ${student.name} (Kelas ${student.className || '-'}) berhasil dicatat.`;
        if (gateInRecorded && gateOutRecorded) {
            summaryMsg += ` Sekaligus Gate-In masuk dan Gate-Out kepulangan sekolah telah otomatis terekam!`;
        } else if (gateInRecorded) {
            summaryMsg += ` Sekaligus Gate-In masuk sekolah telah otomatis terekam!`;
        } else if (gateOutRecorded) {
            summaryMsg += ` Sekaligus Gate-Out kepulangan sekolah telah otomatis terekam!`;
        }

        return res.json({
            success: true,
            message: summaryMsg,
            student: {
                id: student.id,
                name: student.name,
                nisn: student.nisn,
                className: student.className,
                prayerType: pType,
                time: nowTimeStr,
                gateInRecorded,
                gateOutRecorded
            }
        });
    } catch (error: any) {
        console.error('Error in paiScanStudentCard:', error);
        return res.status(500).json({ success: false, message: 'Gagal memproses scan kartu: ' + error.message });
    }
};

/**
 * 14. Trigger Manual / Test Notifikasi Pengingat Sholat H-1 (Pukul 19:00 WIB)
 * Dapat dipanggil oleh Admin / Operator / Guru PAI untuk verifikasi notifikasi siswa & orang tua
 */
export const triggerPrayerH1Reminder = async (req: Request, res: Response) => {
    try {
        const { targetDate, force = true } = req.body;
        // Hitung target date besok jika tidak diberikan
        const nowWibStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
        const nowWIB = new Date(nowWibStr);
        const targetWib = targetDate ? new Date(targetDate) : new Date(nowWIB.getTime() + 24 * 3600 * 1000);
        
        const result = await sendPrayerH1NotificationForDate(targetWib, Boolean(force));
        return res.json({
            success: true,
            message: `Pengingat Sholat H-1 berhasil diproses untuk hari ${result.targetDayName} (${(result as any).targetDateStr || ''})`,
            data: result
        });
    } catch (error: any) {
        console.error('Error in triggerPrayerH1Reminder:', error);
        return res.status(500).json({
            success: false,
            message: 'Gagal memproses pengingat sholat H-1: ' + error.message
        });
    }
};

