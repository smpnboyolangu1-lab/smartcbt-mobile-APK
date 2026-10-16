import { Request, Response } from 'express';
import prisma from '../utils/db';
import { getSchoolSignatures } from '../utils/schoolSignatures';
import { sendFcmToUser } from '../services/fcmService';
import { sendSingleWhatsApp } from '../services/whatsappBlastService';
import { formatTimeWib, formatTimeWibWithSuffix, getWibDayBounds, getWibDayOfWeek, getWibTimeColon } from '../utils/dateUtils';
import { sendPrayerH1NotificationForDate } from '../services/systemScheduler';

export const DEFAULT_PRAYER_SCHEDULES_MAP: Record<number, any[]> = {
    1: [
        { id: 'default-1-dhuhur', dayOfWeek: 1, dayName: 'SENIN', prayerType: 'DHUHUR', classNames: 'VII-F,VII-G,VIII-A,IX-A,IX-B', barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID', wudhuTime: '11:45', scanStartTime: '12:00', scanEndTime: '12:30', notes: 'Jadwal Sholat Dhuhur Berjamaah: VII-F, VII-G, VIII-A, IX-A, IX-B (Pembina GPAI: B. Eny Astuti [9A, 9B], P. Arsyad Muh. Brian [7F, 7G], P. Munawir [8A])', isActive: true }
    ],
    2: [
        { id: 'default-2-dhuhur', dayOfWeek: 2, dayName: 'SELASA', prayerType: 'DHUHUR', classNames: 'VII-B,VII-C,VIII-B,VIII-C,IX-C,IX-D', barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID', wudhuTime: '11:45', scanStartTime: '12:00', scanEndTime: '12:30', notes: 'Jadwal Sholat Dhuhur Berjamaah: VII-B, VII-C, VIII-B, VIII-C, IX-C, IX-D (Pembina GPAI: B. Eny Astuti [9C, 9D], B. Mavrik [7B, 7C], P. Munawir [8B, 8C])', isActive: true }
    ],
    3: [
        { id: 'default-3-dhuhur', dayOfWeek: 3, dayName: 'RABU', prayerType: 'DHUHUR', classNames: 'VII-D,VII-E,VII-H,IX-E,IX-H', barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID', wudhuTime: '11:45', scanStartTime: '12:00', scanEndTime: '12:30', notes: 'Jadwal Sholat Dhuhur Berjamaah: VII-D, VII-E, VII-H, IX-E, IX-H (Pembina GPAI: B. Mavrik [7D, 7E, 9H], P. Arsyad Muh. Brian [7H, 9E])', isActive: true }
    ],
    4: [
        { id: 'default-4-dhuhur', dayOfWeek: 4, dayName: 'KAMIS', prayerType: 'DHUHUR', classNames: 'VII-A,VIII-F,VIII-G,IX-I', barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID', wudhuTime: '11:45', scanStartTime: '12:00', scanEndTime: '12:30', notes: 'Jadwal Sholat Dhuhur Berjamaah: VII-A, VIII-F, VIII-G, IX-I (Pembina GPAI: B. Mavrik [7A, 9I], P. Munawir [8F, 8G])', isActive: true }
    ],
    5: [
        { id: 'default-5-dhuha', dayOfWeek: 5, dayName: 'JUMAT', prayerType: 'DHUHA', classNames: 'VII-I,VIII-H,VIII-I,IX-F,IX-J', barcodeKey: 'BARCODE_SHOLAT_DHUHA_MASJID', wudhuTime: '06:45', scanStartTime: '07:00', scanEndTime: '07:45', notes: 'Jadwal Sholat Dhuha Berjamaah: VII-I, VIII-H, VIII-I, IX-F, IX-J (Pembina GPAI: B. Eny Astuti [8H, 8I], B. Mavrik [9J], P. Arsyad Muh. Brian [7I, 9F])', isActive: true },
        { id: 'default-5-jumat', dayOfWeek: 5, dayName: 'JUMAT', prayerType: 'JUMAT', classNames: 'ALL_MALE', barcodeKey: 'BARCODE_SHOLAT_JUMAT_MASJID', wudhuTime: '11:30', scanStartTime: '11:45', scanEndTime: '12:45', notes: 'Sholat Jumat Berjamaah Seluruh Siswa Putra di Masjid Sekolah', isActive: true },
        { id: 'default-5-keputrian', dayOfWeek: 5, dayName: 'JUMAT', prayerType: 'KEPUTRIAN', classNames: 'ALL_FEMALE', barcodeKey: 'BARCODE_KEPUTRIAN_MASUK', wudhuTime: '11:30', scanStartTime: '11:45', scanEndTime: '12:45', notes: 'Kegiatan Pembinaan Keputrian Seluruh Siswi Putri Muslimah (Pembina GPAI: B. Eny Astuti & B. Mavrik)', isActive: true }
    ],
    6: [
        { id: 'default-6-dhuha', dayOfWeek: 6, dayName: 'SABTU', prayerType: 'DHUHA', classNames: 'IX-K', barcodeKey: 'BARCODE_SHOLAT_DHUHA_MASJID', wudhuTime: '06:45', scanStartTime: '07:00', scanEndTime: '07:45', notes: 'Jadwal Sholat Dhuha Berjamaah: IX-K (Pembina GPAI: B. Mavrik [9K])', isActive: true },
        { id: 'default-6-dhuhur', dayOfWeek: 6, dayName: 'SABTU', prayerType: 'DHUHUR', classNames: 'VII-J,VII-K,VIII-J,VIII-K,IX-G', barcodeKey: 'BARCODE_SHOLAT_DHUHUR_MASJID', wudhuTime: '11:45', scanStartTime: '12:00', scanEndTime: '12:30', notes: 'Jadwal Sholat Dhuhur Berjamaah: VII-J, VII-K, VIII-J, VIII-K, IX-G (Pembina GPAI: B. Eny Astuti [8J, 8K], P. Arsyad Muh. Brian [7J, 7K, 9G])', isActive: true }
    ]
};

export const getResolvedDayPrayerSchedules = (dayOfWeek: number, dbSchedules: any[]) => {
    const list: any[] = [];
    const handledTypes = new Set<string>();
    (dbSchedules || []).filter((s: any) => Number(s.dayOfWeek) === dayOfWeek).forEach((s: any) => {
        handledTypes.add(s.prayerType);
        list.push({
            ...s,
            wudhuTime: s.wudhuTime || (s.prayerType === 'DHUHA' ? '06:45' : (s.prayerType === 'JUMAT' || s.prayerType === 'KEPUTRIAN' ? '11:30' : '11:45')),
            scanStartTime: s.scanStartTime || (s.prayerType === 'DHUHA' ? '07:00' : (s.prayerType === 'JUMAT' || s.prayerType === 'KEPUTRIAN' ? '11:45' : '12:00')),
            scanEndTime: s.scanEndTime || (s.prayerType === 'DHUHA' ? '07:45' : (s.prayerType === 'JUMAT' || s.prayerType === 'KEPUTRIAN' ? '12:45' : '12:30'))
        });
    });
    const defs = DEFAULT_PRAYER_SCHEDULES_MAP[dayOfWeek] || [];
    defs.forEach((def: any) => {
        if (!handledTypes.has(def.prayerType)) {
            list.push(def);
        }
    });
    return list;
};

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
        const dbTodaySchedules = await (prisma as any).prayerClassSchedule.findMany({
            where: { dayOfWeek: todayDay, isActive: true },
            orderBy: { scanStartTime: 'asc' }
        });
        const allTodaySchedules = getResolvedDayPrayerSchedules(todayDay, dbTodaySchedules);

        // Fallback jika belum diatur di database
        if (!schedule) {
            if (requestedType) {
                schedule = allTodaySchedules.find((s: any) => s.prayerType === requestedType) || null;
            } else {
                schedule = (isMorningDhuhaWindow ? allTodaySchedules.find((s: any) => s.prayerType === 'DHUHA') : null)
                        || allTodaySchedules[0]
                        || null;
            }
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

        const fullWeekSchedules: any[] = [];
        for (let d = 1; d <= 6; d++) {
            const dayResolved = getResolvedDayPrayerSchedules(d, schedules);
            fullWeekSchedules.push(...dayResolved);
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
        const isFriday = todayDay === 5;

        // Penentuan Status Ibadah: Membedakan Sholat Jumat (Putra) vs Kegiatan Keputrian (Putri)
        let finalStatus = 'SHOLAT_BERJAMAAH';
        let isKeputrianEvent = false;

        if (studentGender === 'P') {
            if (rawStatus.includes('HAID') || rawStatus.includes('BERHALANGAN')) {
                finalStatus = 'BERHALANGAN_HAID';
                isKeputrianEvent = true;
            } else if (isFriday || isKeputrianScan || cleanBar.includes('KEPUTRIAN') || rawStatus.includes('KEPUTRIAN') || rawStatus === 'HADIR') {
                finalStatus = 'HADIR_KEPUTRIAN';
                isKeputrianEvent = true;
            }
        }

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
                prayerType: pType,
                ttsMessage: `Alhamdulillah ${student.name}, presensi kepulangan di mushola berhasil dicatat. Hati-hati di perjalanan pulang.`,
                message: `✅ Alhamdulillah! Presensi kepulangan di Mushola berhasil dicatat pukul ${timeWithSec} WIB. Notifikasi telah terkirim ke Orang Tua.`,
                record: outRecord
            });
        }

        // -------------------------------------------------------------
        // KASUS 2: SCAN MASUK SHOLAT / KEPUTRIAN DI MUSHOLA
        // -------------------------------------------------------------
        // VALIDASI ALUR: Siswa WAJIB presensi masuk di ruang kelas terlebih dahulu sebelum Sholat Dhuha di Mushola
        if (pType === 'DHUHA') {
            const classCheckIn = await prisma.attendance.findFirst({
                where: {
                    userId: student.id,
                    type: 'GATE_IN',
                    scanTime: { gte: startOfDay, lte: endOfDay }
                }
            });

            if (!classCheckIn) {
                return res.status(400).json({
                    success: false,
                    requireClassroomFirst: true,
                    message: `⚠️ Presensi Sholat Dhuha Ditolak! Anda belum melakukan presensi masuk di ruang kelas pagi ini. Silakan pindai presensi di ruang kelas ${student.className || ''} terlebih dahulu sebelum presensi Sholat Dhuha di Mushola.`
                });
            }
        }

        const existing = await (prisma as any).studentPrayerAttendance.findFirst({
            where: {
                studentId: student.id,
                prayerType: pType,
                date: todayStr
            }
        });

        if (existing) {
            const isPrevBerhalangan = existing.status === 'BERHALANGAN_HAID';
            const isPrevKeputrian = existing.status === 'HADIR_KEPUTRIAN';
            return res.json({
                success: true,
                alreadyRecorded: true,
                message: isPrevKeputrian
                    ? `🌸 Anda sudah tercatat hadir dalam Kegiatan Keputrian hari ini pukul ${new Date(existing.createdAt).toTimeString().substring(0, 5)} WIB.`
                    : isPrevBerhalangan
                    ? `🌸 Anda sudah tercatat hadir berhalangan sholat (haid/uzur keputrian) hari ini pukul ${new Date(existing.createdAt).toTimeString().substring(0, 5)} WIB.`
                    : `✅ Anda sudah tercatat melaksanakan Sholat ${pType} Berjamaah hari ini pukul ${new Date(existing.createdAt).toTimeString().substring(0, 5)} WIB.`,
                record: existing
            });
        }

        const coordText = (lat && lng) ? ` • GPS: ${lat}, ${lng}` : '';
        const notesText = finalStatus === 'HADIR_KEPUTRIAN'
            ? `Presensi mandiri Kegiatan Keputrian siswi putri muslimah scan barcode${coordText}`
            : finalStatus === 'BERHALANGAN_HAID'
            ? `Presensi mandiri siswi berhalangan (uzur syar'i/keputrian) scan barcode${coordText}`
            : `Presensi mandiri scan barcode masuk sholat${coordText}`;

        const newRecord = await (prisma as any).studentPrayerAttendance.create({
            data: {
                studentId: student.id,
                studentName: student.name,
                className: student.className || '-',
                gender: studentGender,
                prayerType: isKeputrianEvent ? 'KEPUTRIAN' : pType,
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
                            note: (existingAtt.note || '') + ` • Mushola/Keputrian (${finalStatus}) GPS: ${lat}, ${lng}`
                        }
                    });
                } else {
                    await prisma.attendance.create({
                        data: {
                            userId: student.id,
                            type: 'PRAYER',
                            method: 'BARCODE',
                            status: finalStatus === 'BERHALANGAN_HAID' ? 'PERMISSION' : 'PRESENT',
                            lat: Number(lat),
                            lng: Number(lng),
                            isFakeGps: Boolean(isFakeGps),
                            note: `Presensi Mushola/Keputrian (${finalStatus}) • GPS: ${lat}, ${lng}`
                        }
                    });
                }
            } catch (attErr) {}
        }

        // Kirim notifikasi real-time ke Orang Tua (Bukan sekadar rekap absen)
        try {
            let notifTitle = `🕌 Laporan Ibadah: Sholat ${pType} Berjamaah`;
            let notifMsg = `Alhamdulillah, ananda ${student.name} (Kelas ${student.className || '-'}) telah melaksanakan scan masuk Sholat ${pType} Berjamaah di Mushola SMPN 1 Boyolangu hari ini pukul ${timeWithSec} WIB.`;

            if (finalStatus === 'HADIR_KEPUTRIAN') {
                notifTitle = `🌸 Laporan Ibadah: Kegiatan Keputrian Siswi`;
                notifMsg = `Alhamdulillah, ananda ${student.name} (Kelas ${student.className || '-'}) telah hadir dan scan masuk mengikuti kegiatan Pembinaan Keputrian Putri Muslimah bersama Guru PAI Putri (B. Eny Astuti & B. Mavrik) pada pukul ${timeWithSec} WIB.`;
            } else if (finalStatus === 'BERHALANGAN_HAID') {
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

        let ttsMessage = '';
        let prayerKind = pType;
        if (finalStatus === 'HADIR_KEPUTRIAN') {
            prayerKind = 'KEPUTRIAN';
            ttsMessage = `Presensi kegiatan keputrian berhasil dicatat untuk ${student.name}. Selamat mengikuti pembinaan keputrian muslimah.`;
        } else if (finalStatus === 'BERHALANGAN_HAID') {
            prayerKind = 'KEPUTRIAN';
            ttsMessage = `Presensi kegiatan keputrian berhalangan sholat berhasil dicatat untuk ${student.name}. Selamat mengikuti bimbingan keputrian.`;
        } else if (pType === 'DHUHA') {
            ttsMessage = `Alhamdulillah ${student.name}, presensi sholat dhuha di mushola berhasil dicatat. Selamat menunaikan ibadah sholat dhuha.`;
        } else {
            ttsMessage = `Alhamdulillah ${student.name}, presensi sholat dhuhur berjamaah di mushola berhasil dicatat. Selamat menunaikan sholat dhuhur.`;
        }

        const successMessage = finalStatus === 'HADIR_KEPUTRIAN'
            ? `🌸 Presensi Berhasil! Kehadiran Anda tercatat resmi dalam KEGIATAN KEPUTRIAN (Putri Muslimah). Notifikasi telah terkirim ke Orang Tua.`
            : finalStatus === 'BERHALANGAN_HAID'
            ? `🌸 Presensi Berhasil! Kehadiran Anda tercatat resmi sebagai BERHALANGAN / KEPUTRIAN (Uzur Syar'i). Notifikasi telah terkirim ke Orang Tua.`
            : `Alhamdulillah! Presensi masuk Sholat ${pType} Berjamaah berhasil dicatat pukul ${timeWithSec} WIB. Notifikasi telah terkirim ke Orang Tua.`;

        res.json({
            success: true,
            message: successMessage,
            ttsMessage,
            prayerType: prayerKind,
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
        const isFemale = gender === 'P' || gender === 'PEREMPUAN';
        const rawStatus = status.toUpperCase();

        // ATURAN KRUSIAL: Status 'BERHALANGAN_HAID' & 'HADIR_KEPUTRIAN' HANYA BOLEH UNTUK SISWI PEREMPUAN
        if ((rawStatus === 'BERHALANGAN_HAID' || rawStatus === 'HADIR_KEPUTRIAN') && !isFemale) {
            return res.status(400).json({
                success: false,
                message: '⛔ Opsi Kegiatan Keputrian / Berhalangan Haid HANYA berlaku untuk siswi perempuan.'
            });
        }

        const todayStr = (req.body.date as string) || getWibDayBounds(new Date()).ymd;
        let pType = prayerType || (getWibDayOfWeek() === 5 ? (isFemale ? 'KEPUTRIAN' : 'JUMAT') : 'DHUHUR');
        if (rawStatus === 'HADIR_KEPUTRIAN' || (isFemale && getWibDayOfWeek() === 5 && pType === 'JUMAT')) {
            pType = 'KEPUTRIAN';
        }

        const existing = await (prisma as any).studentPrayerAttendance.findFirst({
            where: {
                studentId: student.id,
                prayerType: { in: [pType, 'JUMAT', 'KEPUTRIAN', 'DHUHUR'] },
                date: todayStr
            }
        });

        let resultRecord;
        const noteDetail = notes || (rawStatus === 'HADIR_KEPUTRIAN' 
            ? 'Hadir Kegiatan Pembinaan Keputrian Putri Muslimah (Diverifikasi Guru PAI)' 
            : rawStatus === 'BERHALANGAN_HAID' 
            ? 'Izin keputrian / berhalangan syar’i (haid)' 
            : 'Diverifikasi Guru PAI');

        if (existing) {
            resultRecord = await (prisma as any).studentPrayerAttendance.update({
                where: { id: existing.id },
                data: {
                    status: rawStatus,
                    prayerType: pType,
                    method: 'MANUAL_PAI',
                    recordedById: user.id,
                    recordedByName: user.name || 'Guru PAI',
                    notes: noteDetail
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
                    status: rawStatus,
                    method: 'MANUAL_PAI',
                    recordedById: user.id,
                    recordedByName: user.name || 'Guru PAI',
                    notes: noteDetail
                }
            });
        }

        // Notifikasi ke Orang Tua
        try {
            const isHaid = rawStatus === 'BERHALANGAN_HAID';
            const isKeputrian = rawStatus === 'HADIR_KEPUTRIAN';
            let notifTitle = `🕌 Laporan Ibadah Sholat`;
            let notifMsg = `Ananda ${student.name} tercatat melaksanakan Sholat ${pType} Berjamaah (Diverifikasi oleh Guru PAI Bpk/Ibu ${user.name}).`;

            if (isKeputrian) {
                notifTitle = `🌸 Laporan Ibadah: Kegiatan Keputrian Siswi`;
                notifMsg = `Alhamdulillah, ananda ${student.name} (Kelas ${student.className || '-'}) telah hadir mengikuti kegiatan Pembinaan Keputrian Putri Muslimah bersama Guru PAI Putri (Diverifikasi oleh ${user.name}).`;
            } else if (isHaid) {
                notifTitle = `🌸 Informasi Keputrian: ${student.name}`;
                notifMsg = `Ananda ${student.name} hari ini tercatat izin berhalangan syar'i (haid/uzur) dan mengikuti bimbingan di ruang keputrian.`;
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
        } catch (nErr) {}

        res.json({
            success: true,
            message: `Status presensi sholat siswa berhasil diperbarui: ${rawStatus}`,
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

        const todayDay = getWibDayOfWeek();
        const isFriday = todayDay === 5;
        const todayStr = getWibDayBounds(new Date()).ymd;
        const pType = prayerType || (isFriday ? 'JUMAT' : 'DHUHUR');

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

            // Penentuan Status Otomatis untuk Siswi pada Hari Jumat
            let studentTargetStatus = targetStatus;
            let studentPrayerType = pType;

            if (isFriday && isFemale) {
                studentPrayerType = 'KEPUTRIAN';
                if (targetStatus === 'SHOLAT_BERJAMAAH') {
                    // Semua siswi muslimah pada hari Jumat otomatis berstatus HADIR_KEPUTRIAN
                    studentTargetStatus = 'HADIR_KEPUTRIAN';
                }
            }

            // Validasi filter gender
            if ((studentTargetStatus === 'BERHALANGAN_HAID' || studentTargetStatus === 'HADIR_KEPUTRIAN') && !isFemale) {
                continue;
            }

            const existing = await (prisma as any).studentPrayerAttendance.findFirst({
                where: {
                    studentId: student.id,
                    prayerType: { in: [studentPrayerType, 'JUMAT', 'KEPUTRIAN', 'DHUHUR'] },
                    date: todayStr
                }
            });

            // Jangan timpa jika siswi sudah tercatat berhalangan haid atau hadir keputrian
            if (existing && (existing.status === 'BERHALANGAN_HAID' || existing.status === 'HADIR_KEPUTRIAN') && targetStatus === 'SHOLAT_BERJAMAAH') {
                continue;
            }

            const noteDetail = notes || (studentTargetStatus === 'HADIR_KEPUTRIAN'
                ? 'Presensi massal Kegiatan Keputrian Putri Muslimah diverifikasi Guru PAI'
                : 'Presensi massal diverifikasi Guru PAI');

            if (existing) {
                await (prisma as any).studentPrayerAttendance.update({
                    where: { id: existing.id },
                    data: {
                        status: studentTargetStatus,
                        prayerType: studentPrayerType,
                        method: 'MANUAL_PAI',
                        recordedById: user.id,
                        recordedByName: user.name || 'Guru PAI',
                        notes: noteDetail
                    }
                });
            } else {
                await (prisma as any).studentPrayerAttendance.create({
                    data: {
                        studentId: student.id,
                        studentName: student.name,
                        className: student.className || className,
                        gender,
                        prayerType: studentPrayerType,
                        date: todayStr,
                        status: studentTargetStatus,
                        method: 'MANUAL_PAI',
                        recordedById: user.id,
                        recordedByName: user.name || 'Guru PAI',
                        notes: noteDetail
                    }
                });
            }
            updatedCount++;
        }

        res.json({
            success: true,
            updatedCount,
            message: `Berhasil mencatat presensi untuk ${updatedCount} siswa kelas ${className}.`
        });
    } catch (error: any) {
        console.error('Error batchPaiMarkStudentPrayer:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat presensi massal: ' + error.message });
    }
};

// 4c. Siswi Melaporkan Kehadiran Keputrian atau Uzur Syar'i (Haid) 1-Tap Hari Ini
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
                message: '⛔ Konfirmasi kegiatan keputrian / uzur syar’i hanya berlaku untuk siswi perempuan.'
            });
        }

        const todayDay = getWibDayOfWeek();
        const isFriday = todayDay === 5;
        const todayStr = getWibDayBounds(new Date()).ymd;

        const reqStatus = String(req.body.status || 'BERHALANGAN_HAID').toUpperCase();
        const targetStatus = reqStatus.includes('KEPUTRIAN') ? 'HADIR_KEPUTRIAN' : 'BERHALANGAN_HAID';
        const pType = isFriday ? 'KEPUTRIAN' : 'DHUHUR';

        const existing = await (prisma as any).studentPrayerAttendance.findFirst({
            where: {
                studentId: student.id,
                date: todayStr
            }
        });

        const notesText = targetStatus === 'HADIR_KEPUTRIAN'
            ? 'Konfirmasi mandiri kehadiran Kegiatan Keputrian Putri Muslimah via aplikasi APK'
            : "Konfirmasi mandiri siswi berhalangan (uzur syar'i/haid) via aplikasi APK";

        if (existing) {
            if (existing.status === targetStatus) {
                return res.json({
                    success: true,
                    alreadyRecorded: true,
                    message: targetStatus === 'HADIR_KEPUTRIAN'
                        ? `🌸 Kehadiran Kegiatan Keputrian hari ini sudah tercatat pada pukul ${new Date(existing.createdAt).toTimeString().substring(0, 5)} WIB.`
                        : `🌸 Status berhalangan (uzur syar'i) hari ini sudah tercatat pada pukul ${new Date(existing.createdAt).toTimeString().substring(0, 5)} WIB.`
                });
            }
            await (prisma as any).studentPrayerAttendance.update({
                where: { id: existing.id },
                data: {
                    status: targetStatus,
                    prayerType: pType,
                    method: 'STUDENT_APP_UZUR',
                    notes: notesText
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
                    status: targetStatus,
                    method: 'STUDENT_APP_UZUR',
                    recordedById: student.id,
                    recordedByName: student.name,
                    notes: notesText
                }
            });
        }

        // Kirim Notifikasi ke Orang Tua
        try {
            const notifTitle = targetStatus === 'HADIR_KEPUTRIAN'
                ? `🌸 Laporan Ibadah: Kegiatan Keputrian Siswi`
                : `🌸 Konfirmasi Keputrian: ${student.name}`;
            const notifMsg = targetStatus === 'HADIR_KEPUTRIAN'
                ? `Alhamdulillah, ananda ${student.name} telah mengonfirmasi kehadiran dalam Kegiatan Keputrian Putri Muslimah hari ini (${todayStr}).`
                : `Ananda ${student.name} mengonfirmasi sedang berhalangan syar'i (haid) pada hari ini (${todayStr}). Tercatat resmi di rekap Guru PAI.`;

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
        } catch (nErr) {}

        return res.json({
            success: true,
            status: targetStatus,
            message: targetStatus === 'HADIR_KEPUTRIAN'
                ? `🌸 Konfirmasi kehadiran Kegiatan Keputrian hari ini berhasil dicatat. Orang tua dan Guru PAI telah dinotifikasi.`
                : `🌸 Konfirmasi berhalangan (uzur syar'i) hari ini berhasil dicatat. Orang tua dan Guru PAI telah dinotifikasi.`
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

        // Ambil seluruh jadwal aktif untuk hari tersebut (misal Dhuha & Dhuhur/Jumat/Keputrian)
        const dbTodaySchedules = await (prisma as any).prayerClassSchedule.findMany({
            where: { dayOfWeek, isActive: true },
            orderBy: { scanStartTime: 'asc' }
        });
        const allTodaySchedules = getResolvedDayPrayerSchedules(dayOfWeek, dbTodaySchedules);

        let pType = String(prayerType || '').toUpperCase();
        if (!pType) {
            const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
            const isMorning = nowWIB.getHours() < 10;
            const hasDhuha = allTodaySchedules.some((s: any) => s.prayerType === 'DHUHA');
            if (isMorning && hasDhuha) {
                pType = 'DHUHA';
            } else {
                pType = dayOfWeek === 5 ? 'JUMAT' : (allTodaySchedules.some((s: any) => s.prayerType === 'DHUHUR') ? 'DHUHUR' : (allTodaySchedules[0]?.prayerType || 'DHUHUR'));
            }
        }

        // Ambil info jadwal yang sesuai dengan jenis sholat yang dipilih
        const schedule = allTodaySchedules.find((s: any) => s.prayerType === pType) || (prayerType ? null : allTodaySchedules[0]) || null;

        let targetClass = String(className || '').trim();
        if (!targetClass) {
            if (schedule?.classNames && schedule.classNames !== 'ALL_MALE' && schedule.classNames !== 'ALL_FEMALE' && schedule.classNames !== 'ALL') {
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
        // Jika hari Jumat pada sesi siang (Jumat / Keputrian), ambil rekaman baik JUMAT maupun KEPUTRIAN agar Putra & Putri tampil serentak
        const isFridayNoon = dayOfWeek === 5 && (pType === 'JUMAT' || pType === 'KEPUTRIAN' || pType === 'DHUHUR');
        const prayerFilter = isFridayNoon 
            ? { in: ['JUMAT', 'KEPUTRIAN', 'DHUHUR'] } 
            : pType;

        const attendances = await (prisma as any).studentPrayerAttendance.findMany({
            where: {
                className: targetClass,
                date: targetDate,
                prayerType: prayerFilter
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
        const keputrianCount = enriched.filter(e => e.prayerStatus === 'HADIR_KEPUTRIAN').length;
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
                keputrianCount,
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
            const isFridayNoonAll = dayOfWeek === 5 && (pType === 'JUMAT' || pType === 'KEPUTRIAN' || pType === 'DHUHUR');
            const prayerFilterAll = isFridayNoonAll 
                ? { in: ['JUMAT', 'KEPUTRIAN', 'DHUHUR'] } 
                : pType;

            const attendances = await (prisma as any).studentPrayerAttendance.findMany({
                where: {
                    date: targetDate,
                    prayerType: prayerFilterAll
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
                    if (status === 'SHOLAT_BERJAMAAH' || status === 'HADIR_KEPUTRIAN') cSholat++;
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
                    const method = att?.method === 'BARCODE_KEPUTRIAN' ? 'Barcode Keputrian' : (att?.method === 'STATIC_BARCODE' ? 'Scan Barcode' : (att?.method === 'MANUAL_PAI' ? 'Guru PAI' : '-'));

                    let badgeHtml = '';
                    if (status === 'SHOLAT_BERJAMAAH') {
                        badgeHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-weight:700; font-size:9.5px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">🕌 SHOLAT</span>';
                    } else if (status === 'HADIR_KEPUTRIAN') {
                        badgeHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-weight:700; font-size:9.5px; background:#fce7f3; color:#be185d; border:1px solid #fbcfe8;">🌸 KEPUTRIAN</span>';
                    } else if (status === 'BERHALANGAN_HAID') {
                        badgeHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-weight:700; font-size:9.5px; background:#fce7f3; color:#be185d; border:1px solid #fbcfe8;">🩸 HAID</span>';
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
                        prayerType: { in: [pType, 'JUMAT', 'KEPUTRIAN', 'DHUHUR'] }
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
                    <th style="width: 45px; background: #065f46;">Hadir</th>
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
                        } else if (st === 'HADIR_KEPUTRIAN') {
                            sSholat++;
                            return '<td style="padding: 5px; text-align: center; color: #db2777; font-weight: bold; background: #fdf2f8;">🌸 K</td>';
                        } else if (st === 'BERHALANGAN_HAID') {
                            sHaid++;
                            return '<td style="padding: 5px; text-align: center; color: #be185d; font-weight: bold; background: #fdf2f8;">🩸 Haid</td>';
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
                const isFridayNoonSingle = dayOfWeek === 5 && (pType === 'JUMAT' || pType === 'KEPUTRIAN' || pType === 'DHUHUR');
                const prayerFilterSingle = isFridayNoonSingle 
                    ? { in: ['JUMAT', 'KEPUTRIAN', 'DHUHUR'] } 
                    : pType;

                const attendances = await (prisma as any).studentPrayerAttendance.findMany({
                    where: {
                        className: cleanClass,
                        date: targetDate,
                        prayerType: prayerFilterSingle
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
                    const method = att?.method === 'BARCODE_KEPUTRIAN' ? 'Barcode Keputrian' : (att?.method === 'STATIC_BARCODE' ? 'Scan Barcode Masjid' : (att?.method === 'MANUAL_PAI' ? 'Verifikasi Guru PAI' : '-'));

                    let badgeHtml = '';
                    if (status === 'SHOLAT_BERJAMAAH') {
                        sholatCount++;
                        badgeHtml = '<span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-weight:700; font-size:10px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">🕌 HADIR BERJAMAAH</span>';
                    } else if (status === 'HADIR_KEPUTRIAN') {
                        sholatCount++;
                        badgeHtml = '<span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-weight:700; font-size:10px; background:#fce7f3; color:#be185d; border:1px solid #fbcfe8;">🌸 HADIR KEPUTRIAN</span>';
                    } else if (status === 'BERHALANGAN_HAID') {
                        haidCount++;
                        badgeHtml = '<span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-weight:700; font-size:10px; background:#fce7f3; color:#be185d; border:1px solid #fbcfe8;">🩸 BERHALANGAN (HAID)</span>';
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
        // Cari siswa berdasarkan nisn, nis, username, atau id
        const student = await prisma.user.findFirst({
            where: {
                role: 'STUDENT',
                OR: [
                    { nisn: cleanCode },
                    { nis: cleanCode },
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

/**
 * 15. Otomatis Mengirim WhatsApp ke Orang Tua jika Siswa yang Ada Jadwal Sholat Ternyata Tidak Presensi Sholat
 * ATURAN KETAT: HANYA siswa yang benar-benar HADIR di sekolah hari ini (ada log GATE_IN / MANUAL_BK)
 * namun TIDAK melakukan scan sholat / keputrian (dan tidak berhalangan/izin resmi) yang dikirimi WhatsApp.
 */
export async function dispatchAbsentPrayerStudentsBlast(prayerType?: string, targetDate?: Date): Promise<{ sentCount: number; failedCount: number; details: any[] }> {
    const now = targetDate || new Date();
    const todayDay = getWibDayOfWeek(now);
    const { startOfDay, endOfDay, ymd: todayStr } = getWibDayBounds(now);
    const dateFormatted = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    const dbSchedules = await (prisma as any).prayerClassSchedule.findMany({
        where: {
            dayOfWeek: todayDay,
            isActive: true,
            ...(prayerType ? { prayerType: prayerType.toUpperCase() } : {})
        }
    });

    const activeSchedules = (dbSchedules && dbSchedules.length > 0)
        ? dbSchedules
        : (DEFAULT_PRAYER_SCHEDULES_MAP[todayDay] || []).filter((s: any) => !prayerType || s.prayerType === prayerType.toUpperCase());

    if (!activeSchedules || activeSchedules.length === 0) {
        return { sentCount: 0, failedCount: 0, details: [] };
    }

    // 1. Ambil daftar siswa yang terbukti HADIR FISIK di sekolah hari ini (GATE_IN / MANUAL_BK)
    const attendanceInToday = await prisma.attendance.findMany({
        where: {
            type: { in: ['GATE_IN', 'MANUAL_BK'] },
            status: { in: ['PRESENT', 'LATE'] },
            scanTime: { gte: startOfDay, lte: endOfDay }
        },
        select: { userId: true, scanTime: true },
        distinct: ['userId']
    });
    const presentStudentIds = new Set(attendanceInToday.map((a: any) => a.userId));

    // Jika tidak ada siswa yang hadir di sekolah hari ini (misal hari libur/dini hari), langsung hentikan
    if (presentStudentIds.size === 0) {
        return { sentCount: 0, failedCount: 0, details: [] };
    }

    // 2. Ambil siswa yang sudah checkout / GATE_OUT hari ini (misal pulang lebih awal karena sakit)
    const gateOutsToday = await prisma.attendance.findMany({
        where: {
            type: 'GATE_OUT',
            scanTime: { gte: startOfDay, lte: endOfDay }
        },
        select: { userId: true, scanTime: true }
    });
    const gateOutMap = new Map<string, Date>();
    gateOutsToday.forEach((g: any) => gateOutMap.set(g.userId, g.scanTime));

    // 3. Ambil siswa dengan izin darurat BK (Gatepass resmi) hari ini
    let excusedGatepassIds = new Set<string>();
    try {
        const gatepassesToday = await (prisma as any).gatepassRequest.findMany({
            where: {
                createdAt: { gte: startOfDay, lte: endOfDay },
                status: { in: ['ACTIVE_APPROVED', 'COMPLETED', 'APPROVED', 'WAITING_SATPA_SCAN'] }
            },
            select: { studentId: true }
        });
        excusedGatepassIds = new Set(gatepassesToday.map((g: any) => g.studentId));
    } catch (e) {}

    // 4. Ambil siswa yang sedang dirawat / istirahat di UKS hari ini
    let uksActiveIds = new Set<string>();
    try {
        const uksVisitsToday = await (prisma as any).uksVisit.findMany({
            where: {
                entryTime: { gte: startOfDay, lte: endOfDay },
                OR: [
                    { isDischarged: false },
                    { status: { in: ['RESTING', 'OBSERVATION', 'TREATED'] } }
                ]
            },
            select: { studentId: true }
        });
        uksActiveIds = new Set(uksVisitsToday.map((u: any) => u.studentId));
    } catch (e) {}

    // 5. Ambil siswa dengan izin/dispensasi resmi disetujui (StudentLeaveRequest) hari ini
    let leaveApprovedIds = new Set<string>();
    try {
        const leavesToday = await (prisma as any).studentLeaveRequest.findMany({
            where: {
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay },
                status: 'APPROVED'
            },
            select: { studentId: true }
        });
        leaveApprovedIds = new Set(leavesToday.map((l: any) => l.studentId));
    } catch (e) {}

    let sentCount = 0;
    let failedCount = 0;
    const details: any[] = [];

    for (const sched of activeSchedules) {
        const pType = (sched.prayerType || 'DHUHUR').toUpperCase();
        const rawClassNames = (sched.classNames || '').trim();
        const isAll = rawClassNames.toUpperCase() === 'ALL';
        const isAllMale = rawClassNames.toUpperCase() === 'ALL_MALE';
        const isAllFemale = rawClassNames.toUpperCase() === 'ALL_FEMALE';

        const scheduledClasses = rawClassNames
            .split(',')
            .map((c: string) => c.trim().toUpperCase())
            .filter((c: string) => c.length > 0 && !c.startsWith('ALL'));

        // Jika tidak diset ALL dan tidak ada kelas yang terdaftar, lewati untuk mencegah salah blast
        if (!isAll && !isAllMale && !isAllFemale && scheduledClasses.length === 0) {
            continue;
        }

        const whereClause: any = {
            role: 'STUDENT',
            isActive: true
        };

        if (isAllMale) {
            whereClause.gender = { in: ['L', 'LAKI-LAKI', 'Laki-laki', 'MALE', 'Male'] };
        } else if (isAllFemale) {
            whereClause.gender = { in: ['P', 'PEREMPUAN', 'Perempuan', 'FEMALE', 'Female'] };
        } else if (!isAll && scheduledClasses.length > 0) {
            whereClause.className = { in: scheduledClasses };
        }

        const scheduledStudents = await prisma.user.findMany({
            where: whereClause,
            select: {
                id: true,
                name: true,
                className: true,
                gender: true,
                parentPhone: true,
                religion: true,
                nisn: true,
                username: true
            }
        });

        // 6. Ambil seluruh presensi sholat hari ini yang relevan
        // Sholat Dhuha: mencakup status SHOLAT_BERJAMAAH, HADIR_KEPUTRIAN, BERHALANGAN_HAID
        // Sholat Dhuhur/Jumat: mencakup DHUHUR, JUMAT, dan KEPUTRIAN (bagi siswi yang ikut keputrian/uzur)
        const prayerTypesToMatch = pType === 'DHUHA'
            ? ['DHUHA', 'KEPUTRIAN']
            : ['DHUHUR', 'JUMAT', 'KEPUTRIAN'];

        const recordedPrayers = await (prisma as any).studentPrayerAttendance.findMany({
            where: {
                prayerType: { in: prayerTypesToMatch },
                date: todayStr,
                status: { in: ['SHOLAT_BERJAMAAH', 'HADIR_KEPUTRIAN', 'BERHALANGAN_HAID', 'HADIR'] }
            },
            select: { studentId: true, status: true }
        });
        const prayedStudentIds = new Set(recordedPrayers.map((p: any) => p.studentId));

        for (const student of scheduledStudents) {
            // A. Filter Agama: Hanya siswa Muslim
            const religion = (student.religion || 'ISLAM').toUpperCase();
            if (religion.includes('KRISTEN') || religion.includes('KATOLIK') || religion.includes('HINDU') || religion.includes('BUDDHA') || religion.includes('KONGHUCU')) {
                continue;
            }

            // B. Filter Gender untuk Sholat Jumat (putra) vs Keputrian
            const studentGender = ((student.gender || 'L').toString().toUpperCase().startsWith('P') || (student.gender || '').toLowerCase().includes('perempuan')) ? 'P' : 'L';
            if (pType === 'JUMAT' && studentGender === 'P') {
                continue;
            }
            if (isAllMale && studentGender !== 'L') {
                continue;
            }
            if (isAllFemale && studentGender !== 'P') {
                continue;
            }

            // C. Filter Validasi Kelas: Pastikan kelas siswa benar-benar cocok jika bukan ALL
            if (!isAll && !isAllMale && !isAllFemale && scheduledClasses.length > 0) {
                const sClass = (student.className || '').trim().toUpperCase();
                if (!sClass || !scheduledClasses.includes(sClass)) {
                    continue;
                }
            }

            // D. SYARAT MUTLAK 1: Siswa WAJIB tercatat HADIR di sekolah hari ini
            const isPresentInSchool = presentStudentIds.has(student.id);
            if (!isPresentInSchool) {
                // Siswa tidak hadir di sekolah (alpa/sakit/izin dari pagi di rumah), JANGAN dikirim WA bolos sholat!
                continue;
            }

            // E. SYARAT MUTLAK 2: Siswa TIDAK sedang izin resmi pulang (Gatepass), tidak di UKS, tidak dispensasi
            if (excusedGatepassIds.has(student.id) || uksActiveIds.has(student.id) || leaveApprovedIds.has(student.id)) {
                continue;
            }

            // Jika siswa sudah checkout sebelum waktu sholat dimulai, lewati
            const checkoutTime = gateOutMap.get(student.id);
            if (checkoutTime) {
                const [startH, startM] = (sched.scanStartTime || '11:45').split(':').map(Number);
                const prayerStartMin = (startH || 11) * 60 + (startM || 45);
                const outDate = new Date(checkoutTime);
                const outMin = (outDate.getUTCHours() + 7) * 60 + outDate.getUTCMinutes();
                if (outMin <= prayerStartMin) {
                    continue; // Sudah pulang sebelum waktu sholat
                }
            }

            // F. SYARAT MUTLAK 3: Siswa BELUM / TIDAK presensi sholat atau keputrian (artinya BOLOS TIDAK SCAN)
            const hasDonePrayer = prayedStudentIds.has(student.id);
            if (hasDonePrayer) {
                // Siswa sudah scan sholat atau keputrian/haid, JANGAN dikirim WA!
                continue;
            }

            // G. Cegah spam / duplikasi: Cek apakah notifikasi untuk siswa ini sudah pernah dikirim hari ini
            const alreadyNotified = await (prisma as any).notificationMessage.findFirst({
                where: {
                    studentId: student.id,
                    category: `PRAYER_ABSENT_${pType}`,
                    createdAt: { gte: startOfDay, lte: endOfDay }
                }
            });

            if (alreadyNotified) {
                continue;
            }

            // Ambil nomor HP Orang Tua: Cek user.parentPhone, jika kosong cari di BiodataSiswa
            let targetPhone = (student.parentPhone || '').trim();
            if (!targetPhone || targetPhone.length < 8) {
                try {
                    const bio = await (prisma as any).biodataSiswa?.findUnique({
                        where: { siswaId: student.id },
                        select: { teleponOrangTua: true, noHpIbu: true, noHpAyah: true, noHpWali: true }
                    });
                    targetPhone = (bio?.teleponOrangTua || bio?.noHpIbu || bio?.noHpAyah || bio?.noHpWali || '').trim();
                } catch (e) {}
            }

            const waMessage = `*PEMBERITAHUAN PRESENSI IBADAH SEKOLAH - SMPN 1 BOYOLANGU*
Yth. Bapak/Ibu Orang Tua/Wali dari:
Nama: *${student.name}*
Kelas: *${student.className || '-'}*
Hari/Tanggal: *${dateFormatted}*

Diberitahukan bahwa ananda hari ini tercatat *HADIR di sekolah*, namun *BELUM / TIDAK MELAKUKAN PRESENSI SHOLAT ${pType} BERJAMAAH* di Mushola SMPN 1 Boyolangu.

_Catatan untuk siswi putri: Apabila ananda sedang berhalangan (uzur syar'i/haid), ananda wajib melapor ke Pos Pembinaan Keputrian Mushola untuk pencatatan presensi keputrian._

Mohon kerja sama Bapak/Ibu untuk memberikan motivasi dan pembiasaan sholat berjamaah kepada ananda demi ketakwaan dan pembentukan karakter mulia.

_Pesan resmi otomatis Sistem Informasi Akademik & Keagamaan SMPN 1 Boyolangu_`;

            let sendSuccess = false;
            if (targetPhone && targetPhone.length >= 8) {
                try {
                    const waRes = await sendSingleWhatsApp(targetPhone, waMessage);
                    sendSuccess = waRes.success;
                    if (sendSuccess) sentCount++;
                    else failedCount++;
                } catch (e) {
                    failedCount++;
                }
            } else {
                failedCount++;
            }

            // Catat ke NotificationMessage agar tercatat di aplikasi orang tua & mencegah blast berulang
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className,
                    title: `⚠️ Laporan Ibadah: Ananda Tidak Presensi Sholat ${pType}`,
                    message: `Ananda ${student.name} (Kelas ${student.className}) hadir di sekolah namun tidak tercatat presensi Sholat ${pType} di Mushola pada ${dateFormatted}.`,
                    category: `PRAYER_ABSENT_${pType}`
                }
            }).catch(() => {});

            // Kirim Push Notification FCM ke akun Orang Tua
            try {
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
                    await sendFcmToUser(
                        parentUser.id,
                        `⚠️ Laporan Ibadah: Sholat ${pType}`,
                        `Ananda ${student.name} hadir di sekolah namun tidak tercatat presensi Sholat ${pType} di Mushola hari ini.`,
                        { type: 'PRAYER_ABSENT_ALERT', studentId: student.id }
                    ).catch(() => {});
                }
            } catch (e) {}

            details.push({
                studentId: student.id,
                studentName: student.name,
                className: student.className,
                prayerType: pType,
                parentPhone: targetPhone || '-',
                waSent: sendSuccess
            });

            await new Promise((r) => setTimeout(r, 400));
        }
    }

    return { sentCount, failedCount, details };
}

/**
 * 16. API Route untuk Memicu Otomatis WhatsApp ke Orang Tua jika Siswa Tidak Presensi Sholat
 */
export const notifyAbsentPrayerStudentsApi = async (req: Request, res: Response) => {
    try {
        const { prayerType, targetDate } = req.body;
        const result = await dispatchAbsentPrayerStudentsBlast(
            prayerType ? String(prayerType) : undefined,
            targetDate ? new Date(targetDate) : undefined
        );
        res.json({
            success: true,
            message: `Notifikasi WhatsApp siswa tidak presensi sholat berhasil diproses. Terkirim: ${result.sentCount}, Gagal/Tanpa No: ${result.failedCount}`,
            result
        });
    } catch (error: any) {
        console.error('Error in notifyAbsentPrayerStudentsApi:', error);
        res.status(500).json({ success: false, message: 'Gagal memproses notifikasi sholat: ' + error.message });
    }
};


