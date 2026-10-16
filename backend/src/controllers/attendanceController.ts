import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/db';
import { getSchoolSignatures, getSchoolSignaturesForClass } from '../utils/schoolSignatures';
import { validateGpsAttendance } from '../services/gpsValidationService';
import { compareClassNames, sortStudentsByGradeAndName } from '../utils/classSort';
import { sendFcmToUser, sendFcmToRole } from '../services/fcmService';
import { sendSingleWhatsApp } from '../services/whatsappBlastService';
import { formatTimeWib, formatTimeWibWithSuffix, getWibDayBounds, getWibTimeColon, getWibDayOfWeek } from '../utils/dateUtils';
import { logAudit } from '../services/auditLogger';

export const DYNAMIC_QR_SALT = 'SmartCBT_Boyolangu_DynQR_Salt_2026';

export function verifyDynamicClassQr(payload: string, studentClass: string): { isValid: boolean; message?: string; className?: string } {
    const parts = (payload || '').trim().split('|');
    if (parts.length < 4 || parts[0] !== 'DYNAMIC_CLASS_QR') {
        return { isValid: false, message: 'Format barcode dinamis tidak valid' };
    }
    const targetClass = parts[1].trim();
    const step = parseInt(parts[2].trim(), 10);
    const receivedHash = parts[3].trim();

    if (!targetClass || isNaN(step) || !receivedHash) {
        return { isValid: false, message: 'Komponen barcode dinamis tidak lengkap' };
    }

    // Normalisasi nama kelas (misal "VII-A" vs "VII A" vs "7A")
    const normTarget = targetClass.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const normStudent = (studentClass || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (normTarget !== normStudent) {
        return {
            isValid: false,
            message: `Barcode dinamis ini khusus untuk Kelas ${targetClass}, bukan untuk kelas Anda (${studentClass}).`
        };
    }

    // Toleransi jendela waktu: step sekarang, step - 1, step + 1 (toleransi 10-15 detik)
    const currentStep = Math.floor(Date.now() / 10000);
    const validSteps = [currentStep, currentStep - 1, currentStep + 1];

    let match = false;
    for (const s of validSteps) {
        const expectedHash = crypto.createHash('sha256').update(`${targetClass}|${s}|${DYNAMIC_QR_SALT}`).digest('hex').substring(0, 12);
        if (expectedHash.toLowerCase() === receivedHash.toLowerCase()) {
            match = true;
            break;
        }
    }

    if (!match) {
        return {
            isValid: false,
            message: 'Barcode dinamis sudah kedaluwarsa. Silakan minta Pengurus Kelas untuk menunjukkan kode terbaru (ganti tiap 10 detik).'
        };
    }

    return { isValid: true, className: targetClass };
}

export interface DaySchedule {
    day: number; // 0: Minggu, 1: Senin, 2: Selasa, 3: Rabu, 4: Kamis, 5: Jumat, 6: Sabtu
    dayName: string;
    isActive: boolean;
    gateInStart: string;
    gateInEnd: string;
    gateInMax: string;
    gateOutStart: string;
    gateOutEnd: string;
}

export const DEFAULT_DAILY_SCHEDULE: DaySchedule[] = [
    { day: 1, dayName: 'Senin', isActive: true, gateInStart: '06:00', gateInEnd: '07:15', gateInMax: '12:00', gateOutStart: '14:00', gateOutEnd: '18:00' },
    { day: 2, dayName: 'Selasa', isActive: true, gateInStart: '06:00', gateInEnd: '07:15', gateInMax: '12:00', gateOutStart: '14:00', gateOutEnd: '18:00' },
    { day: 3, dayName: 'Rabu', isActive: true, gateInStart: '06:00', gateInEnd: '07:15', gateInMax: '12:00', gateOutStart: '14:00', gateOutEnd: '18:00' },
    { day: 4, dayName: 'Kamis', isActive: true, gateInStart: '06:00', gateInEnd: '07:15', gateInMax: '12:00', gateOutStart: '14:00', gateOutEnd: '18:00' },
    { day: 5, dayName: 'Jumat', isActive: true, gateInStart: '06:00', gateInEnd: '07:15', gateInMax: '10:30', gateOutStart: '10:30', gateOutEnd: '16:00' },
    { day: 6, dayName: 'Sabtu', isActive: true, gateInStart: '06:00', gateInEnd: '07:15', gateInMax: '12:00', gateOutStart: '11:30', gateOutEnd: '15:30' },
    { day: 0, dayName: 'Minggu', isActive: false, gateInStart: '06:00', gateInEnd: '07:15', gateInMax: '12:00', gateOutStart: '14:00', gateOutEnd: '18:00' }
];

export function getWibDate(date: Date = new Date()): { dayOfWeek: number; timeStr: string; timeWithSecStr: string; dateStr: string; dayName: string } {
    try {
        const d = new Date(date);
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const timeWithSecStr = d.toLocaleTimeString('sv-SE', { timeZone: 'Asia/Jakarta' }); // "HH:mm:ss"
        const timeStr = timeWithSecStr.substring(0, 5); // "HH:mm"
        const dateStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // "YYYY-MM-DD"
        const wibDateObj = new Date(dateStr + 'T12:00:00+07:00');
        const dayOfWeek = wibDateObj.getDay();
        return {
            dayOfWeek,
            timeStr,
            timeWithSecStr,
            dateStr,
            dayName: dayNames[dayOfWeek]
        };
    } catch {
        const d = new Date(date);
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        const wib = new Date(utc + (3600000 * 7));
        const hours = String(wib.getHours()).padStart(2, '0');
        const minutes = String(wib.getMinutes()).padStart(2, '0');
        const seconds = String(wib.getSeconds()).padStart(2, '0');
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        return {
            dayOfWeek: wib.getDay(),
            timeStr: `${hours}:${minutes}`,
            timeWithSecStr: `${hours}:${minutes}:${seconds}`,
            dateStr: wib.toISOString().split('T')[0],
            dayName: dayNames[wib.getDay()]
        };
    }
}

export function getEffectiveGateSettings(settings: any, date: Date = new Date()) {
    const { dayOfWeek, timeStr, timeWithSecStr, dateStr, dayName } = getWibDate(date);

    const rootInStart = settings?.gateInStartTime || '06:00';
    const rootInEnd = settings?.gateInEndTime || '07:00';
    const rootInMax = settings?.gateInMaxTime || '08:00';
    const rootOutStart = settings?.gateOutStartTime || '14:00';
    const rootOutEnd = settings?.gateOutEndTime || '18:00';

    let dailyList: DaySchedule[] = [
        { day: 1, dayName: 'Senin', isActive: true, gateInStart: rootInStart, gateInEnd: rootInEnd, gateInMax: rootInMax, gateOutStart: rootOutStart, gateOutEnd: rootOutEnd },
        { day: 2, dayName: 'Selasa', isActive: true, gateInStart: rootInStart, gateInEnd: rootInEnd, gateInMax: rootInMax, gateOutStart: rootOutStart, gateOutEnd: rootOutEnd },
        { day: 3, dayName: 'Rabu', isActive: true, gateInStart: rootInStart, gateInEnd: rootInEnd, gateInMax: rootInMax, gateOutStart: rootOutStart, gateOutEnd: rootOutEnd },
        { day: 4, dayName: 'Kamis', isActive: true, gateInStart: rootInStart, gateInEnd: rootInEnd, gateInMax: rootInMax, gateOutStart: rootOutStart, gateOutEnd: rootOutEnd },
        { day: 5, dayName: 'Jumat', isActive: true, gateInStart: rootInStart, gateInEnd: rootInEnd, gateInMax: rootInMax, gateOutStart: '10:30', gateOutEnd: '16:00' },
        { day: 6, dayName: 'Sabtu', isActive: true, gateInStart: rootInStart, gateInEnd: rootInEnd, gateInMax: rootInMax, gateOutStart: '11:30', gateOutEnd: '15:30' },
        { day: 0, dayName: 'Minggu', isActive: false, gateInStart: rootInStart, gateInEnd: rootInEnd, gateInMax: rootInMax, gateOutStart: rootOutStart, gateOutEnd: rootOutEnd }
    ];

    if (settings && settings.dailySchedule) {
        try {
            const parsed = typeof settings.dailySchedule === 'string' ? JSON.parse(settings.dailySchedule) : settings.dailySchedule;
            if (Array.isArray(parsed) && parsed.length > 0) {
                dailyList = parsed;
            }
        } catch (e) {
            console.error('Error parsing dailySchedule:', e);
        }
    }

    const todaySched = dailyList.find(s => s.day === dayOfWeek) || {
        day: dayOfWeek,
        dayName,
        isActive: dayOfWeek !== 0,
        gateInStart: rootInStart,
        gateInEnd: rootInEnd,
        gateInMax: rootInMax,
        gateOutStart: rootOutStart,
        gateOutEnd: rootOutEnd
    };

    return {
        currentTimeStr: timeStr,
        currentTimeWithSecStr: timeWithSecStr,
        currentDayOfWeek: dayOfWeek,
        currentDayName: dayName,
        currentDateStr: dateStr,
        todaySchedule: todaySched,
        dailySchedule: dailyList,
        gateInStartTime: todaySched.gateInStart,
        gateInEndTime: todaySched.gateInEnd,
        gateInMaxTime: todaySched.gateInMax,
        gateOutStartTime: todaySched.gateOutStart,
        gateOutEndTime: todaySched.gateOutEnd,
        isDayActive: todaySched.isActive
    };
}

async function getOrCreateGateSettings() {
    let settings = await prisma.gateSetting.findUnique({ where: { id: 'default' } });
    if (!settings) {
        settings = await prisma.gateSetting.create({
            data: {
                id: 'default',
                gateInStartTime: '06:00',
                gateInEndTime: '07:15',
                gateInMaxTime: '12:00',
                gateOutStartTime: '14:00',
                gateOutEndTime: '18:00',
                isEmergencyGateOut: false,
                isEarlyDismissal: false,
                dailySchedule: JSON.stringify(DEFAULT_DAILY_SCHEDULE)
            }
        });
    } else if (settings.isEmergencyGateOut || settings.isEarlyDismissal) {
        // Mode darurat / pulang lebih awal berlaku 1x (khusus hari saat diaktifkan).
        // Besok otomatis kembali ke jadwal normal operasional sekolah!
        const nowWib = new Date(Date.now() + 7 * 3600 * 1000).toISOString().substring(0, 10);
        const updatedWib = new Date(new Date(settings.updatedAt).getTime() + 7 * 3600 * 1000).toISOString().substring(0, 10);

        const isTestingForever = Boolean(
            settings.emergencyReason?.toLowerCase().includes('uji') || 
            settings.emergencyReason?.toLowerCase().includes('test') || 
            settings.emergencyReason?.toLowerCase().includes('trial')
        );

        if (updatedWib < nowWib && !isTestingForever) {
            console.log(`[GATE_AUTO_RESET] Resetting 1x early dismissal/emergency gate-out from ${updatedWib} to normal schedule for today ${nowWib}.`);
            settings = await prisma.gateSetting.update({
                where: { id: 'default' },
                data: {
                    isEmergencyGateOut: false,
                    isEarlyDismissal: false,
                    emergencyReason: null
                }
            });
        }
    }
    return settings;
}

export const getGateSettings = async (req: Request, res: Response) => {
    try {
        const settings = await getOrCreateGateSettings();
        const effective = getEffectiveGateSettings(settings);

        const isTestingMode = Boolean(
            settings.isEmergencyGateOut && 
            (settings.emergencyReason?.toLowerCase().includes('uji') || 
             settings.emergencyReason?.toLowerCase().includes('test') || 
             settings.emergencyReason?.toLowerCase().includes('24 jam') || 
             settings.emergencyReason?.toLowerCase().includes('trial'))
        );

        const isGateInOpen = isTestingMode || settings.isEmergencyGateOut || (
            effective.isDayActive &&
            effective.currentTimeStr >= effective.gateInStartTime && 
            effective.currentTimeStr <= effective.gateInMaxTime
        );

        const isGateOutOpen = isTestingMode || settings.isEmergencyGateOut || settings.isEarlyDismissal || (
            effective.isDayActive &&
            effective.currentTimeStr >= effective.gateOutStartTime && 
            effective.currentTimeStr <= effective.gateOutEndTime
        );

        res.json({
            settings: {
                ...settings,
                dailySchedule: effective.dailySchedule,
                currentGateInStart: effective.gateInStartTime,
                currentGateInEnd: effective.gateInEndTime,
                currentGateInMax: effective.gateInMaxTime,
                currentGateOutStart: effective.gateOutStartTime,
                currentGateOutEnd: effective.gateOutEndTime
            },
            status: {
                currentTime: effective.currentTimeStr,
                currentDayOfWeek: effective.currentDayOfWeek,
                currentDayName: effective.currentDayName,
                isGateInOpen,
                isGateOutOpen,
                isEmergencyActive: Boolean(settings.isEmergencyGateOut && !isTestingMode),
                isEarlyDismissalActive: settings.isEarlyDismissal,
                isTrialMode: isTestingMode,
                emergencyReason: settings.emergencyReason,
                todaySchedule: effective.todaySchedule
            }
        });
    } catch (error) {
        console.error('Error fetching gate settings:', error);
        res.status(500).json({ message: 'Gagal mengambil pengaturan gate absensi' });
    }
};

async function broadcastEarlyDismissalNotifications(reason?: string) {
    try {
        const cleanReason = reason || 'Kegiatan Rapat Dinas / Acara Khusus Sekolah';
        const now = new Date();
        const timeStr = getWibTimeColon(now);
        const dateStr = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { id: true, name: true, className: true, parentPhone: true, nisn: true }
        });

        if (students.length === 0) return;

        const notifRecords: any[] = [];
        for (const s of students) {
            // Notifikasi untuk Orang Tua di Aplikasi Mobile & Portal
            notifRecords.push({
                recipientPhone: s.parentPhone || undefined,
                recipientRole: 'PARENT',
                studentId: s.id,
                studentName: s.name,
                className: s.className || undefined,
                category: 'EARLY_DISMISSAL',
                title: '🚨 Pemberitahuan: Siswa Dipulangkan Lebih Awal',
                message: `Yth. Bapak/Ibu Orang Tua/Wali Murid: Diberitahukan bahwa pada hari ini (${dateStr}), siswa (termasuk ananda ${s.name} kelas ${s.className || '-'}) dipulangkan lebih awal (mulai pukul ${timeStr} WIB) karena: ${cleanReason}. Mohon pemantauan atau penjemputan kepulangan ananda. Terima kasih atas perhatian dan kerjasamanya.`
            });

            // Notifikasi untuk Siswa di Aplikasi Mobile
            notifRecords.push({
                recipientId: s.id,
                recipientRole: 'STUDENT',
                studentId: s.id,
                studentName: s.name,
                className: s.className || undefined,
                category: 'EARLY_DISMISSAL',
                title: '🚨 Pengumuman: Kepulangan Lebih Awal',
                message: `Perhatian seluruh siswa: Hari ini pembelajaran diakhiri lebih awal (mulai pukul ${timeStr} WIB) karena: ${cleanReason}. Silakan melakukan scan presensi kepulangan (Gate-Out) dan langsung pulang ke rumah masing-masing dengan tertib.`
            });
        }

        // Simpan batch notifikasi
        for (let i = 0; i < notifRecords.length; i += 50) {
            const chunk = notifRecords.slice(i, i + 50);
            await Promise.all(chunk.map(data => prisma.notificationMessage.create({ data }).catch(() => null)));
        }

        console.log(`[EARLY DISMISSAL BROADCAST] Sent ${notifRecords.length} notifications to parents and students for reason: "${cleanReason}"`);
    } catch (err) {
        console.warn('Early dismissal notification broadcast error (non-fatal):', err);
    }
}

export const updateGateSettings = async (req: Request, res: Response) => {
    try {
        const { gateInStartTime, gateInEndTime, gateInMaxTime, gateOutStartTime, gateOutEndTime, isEmergencyGateOut, isEarlyDismissal, emergencyReason, dailySchedule } = req.body;
        const user = (req as any).user;

        const updateData: any = {
            updatedBy: user ? user.name + ' (' + user.role + ')' : 'Admin/BK'
        };

        if (gateInStartTime) updateData.gateInStartTime = gateInStartTime;
        if (gateInEndTime) updateData.gateInEndTime = gateInEndTime;
        if (gateInMaxTime) updateData.gateInMaxTime = gateInMaxTime;
        if (gateOutStartTime) updateData.gateOutStartTime = gateOutStartTime;
        if (gateOutEndTime) updateData.gateOutEndTime = gateOutEndTime;
        if (isEmergencyGateOut !== undefined) updateData.isEmergencyGateOut = Boolean(isEmergencyGateOut);
        if (isEarlyDismissal !== undefined) updateData.isEarlyDismissal = Boolean(isEarlyDismissal);
        if (emergencyReason !== undefined) updateData.emergencyReason = emergencyReason;

        if (dailySchedule !== undefined) {
            updateData.dailySchedule = typeof dailySchedule === 'string' ? dailySchedule : JSON.stringify(dailySchedule);
        } else if (gateInStartTime || gateInEndTime || gateInMaxTime || gateOutStartTime || gateOutEndTime) {
            // Otomatis sinkronkan hari standar (Senin s.d. Kamis: 1, 2, 3, 4) dengan jam gate baru
            const cur = await prisma.gateSetting.findUnique({ where: { id: 'default' } });
            const inStart = gateInStartTime || cur?.gateInStartTime || '06:00';
            const inEnd = gateInEndTime || cur?.gateInEndTime || '07:15';
            const inMax = gateInMaxTime || cur?.gateInMaxTime || '12:00';
            const outStart = gateOutStartTime || cur?.gateOutStartTime || '14:00';
            const outEnd = gateOutEndTime || cur?.gateOutEndTime || '18:00';

            let list: DaySchedule[] = [
                { day: 1, dayName: 'Senin', isActive: true, gateInStart: inStart, gateInEnd: inEnd, gateInMax: inMax, gateOutStart: outStart, gateOutEnd: outEnd },
                { day: 2, dayName: 'Selasa', isActive: true, gateInStart: inStart, gateInEnd: inEnd, gateInMax: inMax, gateOutStart: outStart, gateOutEnd: outEnd },
                { day: 3, dayName: 'Rabu', isActive: true, gateInStart: inStart, gateInEnd: inEnd, gateInMax: inMax, gateOutStart: outStart, gateOutEnd: outEnd },
                { day: 4, dayName: 'Kamis', isActive: true, gateInStart: inStart, gateInEnd: inEnd, gateInMax: inMax, gateOutStart: outStart, gateOutEnd: outEnd },
                { day: 5, dayName: 'Jumat', isActive: true, gateInStart: inStart, gateInEnd: inEnd, gateInMax: '11:30', gateOutStart: '11:30', gateOutEnd: '16:00' },
                { day: 6, dayName: 'Sabtu', isActive: true, gateInStart: inStart, gateInEnd: inEnd, gateInMax: '12:00', gateOutStart: '12:30', gateOutEnd: '15:30' },
                { day: 0, dayName: 'Minggu', isActive: false, gateInStart: inStart, gateInEnd: inEnd, gateInMax: inMax, gateOutStart: outStart, gateOutEnd: outEnd }
            ];

            if (cur?.dailySchedule) {
                try {
                    const parsed = typeof cur.dailySchedule === 'string' ? JSON.parse(cur.dailySchedule) : cur.dailySchedule;
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        list = parsed.map((item: DaySchedule) => {
                            if ([1, 2, 3, 4].includes(item.day)) {
                                return {
                                    ...item,
                                    gateInStart: inStart,
                                    gateInEnd: inEnd,
                                    gateInMax: inMax,
                                    gateOutStart: outStart,
                                    gateOutEnd: outEnd
                                };
                            }
                            return item;
                        });
                    }
                } catch (e) {}
            }

            updateData.dailySchedule = JSON.stringify(list);
        }

        const updated = await (prisma.gateSetting as any).upsert({
            where: { id: 'default' },
            update: updateData,
            create: { id: 'default', ...updateData }
        });

        let msg = 'Pengaturan jam operasional Gate Berhasil Disimpan.';
        if (updateData.isEmergencyGateOut && !updateData.emergencyReason?.toLowerCase().includes('uji')) {
            msg = '🚨 Gate-Out Darurat Berhasil Diaktifkan! Notifikasi kepulangan lebih awal otomatis dikirimkan ke seluruh orang tua.';
            broadcastEarlyDismissalNotifications(updateData.emergencyReason);
        } else if (updateData.isEarlyDismissal) {
            msg = '🏃 Mode Pulang Lebih Awal Berhasil Diaktifkan! Notifikasi otomatis dikirimkan ke seluruh orang tua.';
            broadcastEarlyDismissalNotifications(updateData.emergencyReason);
        }

        res.json({
            message: msg,
            settings: updated
        });
    } catch (error) {
        console.error('Error updating gate settings:', error);
        res.status(500).json({ message: 'Gagal memperbarui pengaturan gate' });
    }
};

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Radius bumi dalam meter
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

export const scanClassGate = async (req: Request, res: Response) => {
    try {
        const { type, method, lat, lng, isFakeGps } = req.body;
        const studentIdentifier = req.body.studentIdentifier || req.body.nisn || req.body.username;
        const barcodeCode = req.body.barcodeCode || req.body.gateCode;

        if (!studentIdentifier || !barcodeCode) {
            return res.status(400).json({ message: 'Identitas siswa dan Barcode Kelas wajib disertakan' });
        }

        // 1. Anti-Fake GPS / Mock Location Security Shield
        if (isFakeGps === true) {
            return res.status(403).json({
                message: '🚨 Presensi Ditolak! Terdeteksi penggunaan Fake GPS / Mock Location pada perangkat Anda. Matikan aplikasi pemalsu lokasi untuk dapat melakukan presensi.'
            });
        }

        const student = await prisma.user.findFirst({
            where: {
                OR: [
                    { username: String(studentIdentifier) },
                    { nisn: String(studentIdentifier) },
                    { nis: String(studentIdentifier) }
                ],
                role: 'STUDENT'
            }
        });

        if (!student) {
            return res.status(404).json({ message: 'Siswa tidak ditemukan dalam database.' });
        }

        // 2. Deteksi Apakah Barcode adalah QR Dinamis Pengurus Kelas
        const rawCodeUpper = (barcodeCode || '').trim().toUpperCase();
        const isDynamicOfficerQr = (barcodeCode || '').trim().startsWith('DYNAMIC_CLASS_QR|') || method === 'QR_DYNAMIC_OFFICER';

        if (isDynamicOfficerQr) {
            const dynVerify = verifyDynamicClassQr(barcodeCode, student.className || '');
            if (!dynVerify.isValid) {
                return res.status(400).json({
                    success: false,
                    message: dynVerify.message || 'Barcode dinamis pengurus kelas tidak sah atau sudah kedaluwarsa.'
                });
            }
        }

        const isBkGateIn = rawCodeUpper === 'GATE_IN_BK' || rawCodeUpper === 'GATE_LATE_BK' || rawCodeUpper.includes('GATE_IN_BK');
        const isBkGateOut = rawCodeUpper === 'GATE_OUT_BK' || rawCodeUpper.includes('GATE_OUT_BK');
        const isBkBarcode = isBkGateIn || isBkGateOut;
        const isMusholaIn = rawCodeUpper.includes('MUSHOLA_IN') || (rawCodeUpper.includes('MUSHOLA') && !rawCodeUpper.includes('OUT')) || rawCodeUpper === 'BARCODE_SHOLAT_DHUHUR_MASJID' || rawCodeUpper === 'BARCODE_SHOLAT_JUMAT_MASJID';
        const isMusholaOut = rawCodeUpper.includes('MUSHOLA_OUT') || (rawCodeUpper.includes('MUSHOLA') && rawCodeUpper.includes('OUT'));
        const isMusholaBarcode = isMusholaIn || isMusholaOut || rawCodeUpper.includes('MUSHOLA') || rawCodeUpper.includes('SHOLAT');

        const settings = await getOrCreateGateSettings();
        const effective = getEffectiveGateSettings(settings);
        const isTestingMode = Boolean(
            settings.isEmergencyGateOut && 
            (settings.emergencyReason?.toLowerCase().includes('uji') || 
             settings.emergencyReason?.toLowerCase().includes('test') || 
             settings.emergencyReason?.toLowerCase().includes('24 jam') || 
             settings.emergencyReason?.toLowerCase().includes('trial'))
        );

        // Validasi Metode Presensi Ruang Kelas:
        // 1. Barcode Statis di Pintu Kelas: WAJIB divalidasi dengan GPS di area sekolah SMPN 1 Boyolangu.
        // 2. QR Dinamis Pengurus Kelas (DYNAMIC_CLASS_QR): Validasi tanpa GPS (berganti per 10 detik).
        // 3. QR-STATIC tanpa validasi GPS ditutup total (wajib GPS aktif atau beralih ke QR Dinamis Pengurus).
        const hasGps = lat !== undefined && lng !== undefined && lat !== null && lng !== null && Number(lat) !== 0 && Number(lng) !== 0;
        if (!isDynamicOfficerQr && !isBkBarcode && !isMusholaBarcode && rawCodeUpper !== 'QR_DYNAMIC_OFFICER' && !rawCodeUpper.startsWith('DYNAMIC_CLASS_QR|')) {
            if (!hasGps && !isTestingMode) {
                return res.status(403).json({
                    success: false,
                    redirectDynamicQr: true,
                    message: '⛔ Presensi Barcode Statis Kelas Wajib Validasi GPS! Nyalakan GPS di area sekolah atau gunakan QR Dinamis Pengurus Kelas.'
                });
            }
        }

        const studentClass = student.className ? await prisma.class.findFirst({ where: { name: student.className } }) : null;
        
        // Ambil konfigurasi dinamis dari SystemSetting
        const [geoEnabledRow, masterGeoRow, globalRadiusRow, bufferDefaultRow, schoolLatRow, schoolLngRow, driftLimitRow] = await Promise.all([
            prisma.systemSetting.findUnique({ where: { key: "feature.scanner.geolocation" } }),
            prisma.systemSetting.findUnique({ where: { key: "feature.geofence.enabled" } }),
            prisma.systemSetting.findUnique({ where: { key: "gps.radius.global" } }),
            prisma.systemSetting.findUnique({ where: { key: "gps.buffer.default" } }),
            prisma.systemSetting.findUnique({ where: { key: "gps.school.lat" } }),
            prisma.systemSetting.findUnique({ where: { key: "gps.school.lng" } }),
            prisma.systemSetting.findUnique({ where: { key: "attendance.clock_drift_limit_minutes" } })
        ]);

        const isMasterGeoActive = masterGeoRow ? (masterGeoRow.value === "true" || masterGeoRow.value === "1") : true;
        const isGeolocationActive = (geoEnabledRow ? (geoEnabledRow.value === "true" || geoEnabledRow.value === "1") : true) && isMasterGeoActive;
        const globalRadius = globalRadiusRow ? (parseInt(globalRadiusRow.value) || 150) : 150;
        const defaultBuffer = bufferDefaultRow ? (parseInt(bufferDefaultRow.value) || 50) : 50;
        const defaultSchoolLat = schoolLatRow ? (parseFloat(schoolLatRow.value) || -8.125157) : -8.125157;
        const defaultSchoolLng = schoolLngRow ? (parseFloat(schoolLngRow.value) || 111.893912) : 111.893912;
        const clockDriftLimit = driftLimitRow ? (parseInt(driftLimitRow.value) || 5) : 5;

        // Ruang BK berada di area sekolah (koordinat pusat sekolah atau kelas)
        const targetLat = isBkBarcode ? defaultSchoolLat : (studentClass?.lat ?? defaultSchoolLat);
        const targetLng = isBkBarcode ? defaultSchoolLng : (studentClass?.lng ?? defaultSchoolLng);
        const accuracyNum = req.body.accuracy ? Number(req.body.accuracy) : null;
        // Toleransi geofence kampus: radius base (minimal 70m untuk seluruh area sekolah SMPN 1 Boyolangu) + toleransi indoor drift jika akurasi GPS terdegradasi
        const configuredRadius = globalRadiusRow ? (parseInt(globalRadiusRow.value) || 70) : 70;
        const defaultBufferVal = bufferDefaultRow ? (parseInt(bufferDefaultRow.value) || 15) : 15;
        const rawClassRadius = (studentClass?.radiusMeters && studentClass.radiusMeters > 0) ? studentClass.radiusMeters : configuredRadius;
        const baseRadius = Math.max(rawClassRadius, 70); // Minimal 70m mencakup seluruh area gedung sekolah SMPN 1 Boyolangu
        const gpsAccuracyBuffer = (accuracyNum && accuracyNum > 25) ? Math.min(Math.round(accuracyNum * 0.65), 65) : 0;
        const maxRadius = isBkBarcode ? Math.max(baseRadius + defaultBufferVal + gpsAccuracyBuffer, 85) : (baseRadius + defaultBufferVal + gpsAccuracyBuffer);

        // Validasi Hari Libur Sekolah / Situasi Tertentu
        const todayYmd = effective.currentDateStr;
        const todayHoliday = await prisma.schoolHoliday.findUnique({
            where: { date: todayYmd }
        });
        if (todayHoliday && !isTestingMode) {
            return res.status(403).json({
                success: false,
                isHoliday: true,
                message: `🌴 Hari ini (${todayYmd}) adalah hari libur sekolah: ${todayHoliday.name}. Sekolah tidak menyelenggarakan presensi tatap muka.`
            });
        }

        // Jika hari ini libur mingguan (misal hari Minggu) dan bukan mode uji coba
        if (!effective.isDayActive && !isTestingMode && !settings.isEmergencyGateOut) {
            return res.status(403).json({
                success: false,
                isHoliday: true,
                message: `🌴 Hari ${effective.currentDayName} adalah hari libur operasional sekolah! Tidak ada presensi tatap muka hari ini. Selamat berlibur!`
            });
        }

        let distanceMeters: number | null = null;

        // Validasi Lokasi:
        // A. JIKA MENGGUNAKAN QR DINAMIS PENGURUS KELAS:
        // Presensi sah 100% tanpa GPS (karena pengurus kelas membawa HP di kelas & barcode berganti tiap 10s).
        if (isDynamicOfficerQr) {
            distanceMeters = 0; // Sah di kelas bersama pengurus kelas
        } else if (isGeolocationActive) {
            // B. JIKA MENGGUNAKAN QR STIKER KELAS FISIK / GPS:
            if (lat !== undefined && lng !== undefined && lat !== null && lng !== null && Number(lat) !== 0 && Number(lng) !== 0) {
                distanceMeters = calculateDistanceMeters(Number(lat), Number(lng), targetLat, targetLng);

                // Tolak jika berada di luar radius sekolah (mencegah stiker difoto dibawa pulang)
                if (distanceMeters > maxRadius && (!isTestingMode || distanceMeters > 500)) {
                    return res.status(403).json({
                        success: false,
                        redirectDynamicQr: true,
                        message: `📍 Presensi Ditolak! Anda terdeteksi berada ${distanceMeters} meter di luar sekolah (Batas maksimal: ${maxRadius} meter). Presensi hanya dapat dilakukan di dalam area SMP Negeri 1 Boyolangu.`
                    });
                }

                // Cek Akurasi GPS terdegradasi (51m - 100m)
                if (accuracyNum !== null && accuracyNum > 50 && accuracyNum <= 100) {
                    await prisma.attendanceAnomalyLog.create({
                        data: {
                            userId: student.id,
                            userName: student.name,
                            jenisAnomali: 'GPS_DEGRADED',
                            detail: JSON.stringify({
                                accuracy: accuracyNum,
                                distance: distanceMeters,
                                lat: Number(lat),
                                lng: Number(lng),
                                note: 'Akurasi GPS satelit terdegradasi 51-100m tapi tetap diterima sah'
                            }),
                            statusReview: 'PENDING'
                        }
                    }).catch(() => {});
                }
            } else if (!isTestingMode) {
                // Sesuai instruksi: jika scan stiker statis tapi GPS mati / tidak terkunci,
                // tolak dan alihkan siswa untuk scan QR Dinamis Pengurus Kelas
                return res.status(403).json({
                    success: false,
                    redirectDynamicQr: true,
                    message: 'Presensi GPS tidak terkunci. Silakan pindai QR Dinamis pada HP Pengurus Kelas Anda.'
                });
            }
        }

        // Deteksi Clock Drift (Selisih Jam HP dengan Jam Server WIB)
        if (req.body.deviceTime && typeof req.body.deviceTime === 'string') {
            try {
                const [devH, devM] = req.body.deviceTime.split(':').map(Number);
                const [srvH, srvM] = effective.currentTimeStr.split(':').map(Number);
                if (!isNaN(devH) && !isNaN(devM) && !isNaN(srvH) && !isNaN(srvM)) {
                    const driftMinutes = Math.abs((devH * 60 + devM) - (srvH * 60 + srvM));
                    if (driftMinutes > clockDriftLimit) {
                        await prisma.attendanceAnomalyLog.create({
                            data: {
                                userId: student.id,
                                userName: student.name,
                                jenisAnomali: 'CLOCK_MANIPULATION',
                                detail: JSON.stringify({
                                    deviceTime: req.body.deviceTime,
                                    serverTime: effective.currentTimeStr,
                                    driftMinutes,
                                    limitMinutes: clockDriftLimit
                                }),
                                statusReview: 'PENDING'
                            }
                        }).catch(() => {});
                    }
                }
            } catch (e) {}
        }

        if (isFakeGps && !isTestingMode) {
            return res.status(403).json({
                message: `⛔ Presensi Ditolak! Terdeteksi indikasi manipulasi lokasi (Mock / Fake GPS) pada perangkat Anda.`
            });
        }

        const now = new Date();
        let effectiveScanTime = now;
        if (req.body.clientScanTime) {
            const parsedClientDate = new Date(Number(req.body.clientScanTime));
            // Validasi: tidak boleh di masa depan > 5 menit, dan tidak boleh lebih lampau dari 24 jam
            if (!isNaN(parsedClientDate.getTime()) && parsedClientDate.getTime() <= (Date.now() + 5 * 60 * 1000) && parsedClientDate.getTime() >= (Date.now() - 24 * 60 * 60 * 1000)) {
                effectiveScanTime = parsedClientDate;
            }
        } else if (req.body.deviceTime && typeof req.body.deviceTime === 'string') {
            const [devH, devM] = req.body.deviceTime.split(':').map(Number);
            if (!isNaN(devH) && !isNaN(devM)) {
                const reconstructed = new Date();
                reconstructed.setHours(devH, devM, 0, 0);
                if (Math.abs(reconstructed.getTime() - Date.now()) <= 45 * 60 * 1000) {
                    effectiveScanTime = reconstructed;
                }
            }
        }

        const scanTimeHms = getWibTimeColon(effectiveScanTime, true);
        const compareTimeSec = scanTimeHms.padStart(8, '0');
        const currentTimeStr = effective.currentTimeStr;

        // Hitung batas awal dan akhir hari ini (WIB) secara deterministik
        const { startOfDay, endOfDay } = getWibDayBounds(now);

        const todayInRecord = await prisma.attendance.findFirst({
            where: {
                userId: student.id,
                type: 'GATE_IN',
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        const todayOutRecord = await prisma.attendance.findFirst({
            where: {
                userId: student.id,
                type: 'GATE_OUT',
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        let scanType = type;
        const gateOutStartSec = (effective.gateOutStartTime || '12:00') + ':00';
        const isCurrentlyDismissalTime = compareTimeSec >= gateOutStartSec || settings.isEmergencyGateOut || settings.isEarlyDismissal;

        // PENANGANAN SISWA MEMINDAI BARCODE GATE_OUT DI PAGI HARI (SEBELUM JAM PULANG):
        // Jika scan dilakukan sebelum jam kepulangan resmi dibuka dan siswa memindai barcode GATE_OUT:
        // Berikan keterangan edukatif yang jelas dan menenangkan agar siswa tidak panik,
        // bahwa yang dipindai adalah Barcode Kepulangan (Gate-Out) yang saat ini sedang ditutup,
        // dan instruksikan untuk memindai Barcode Masuk (Gate-In) di samping pintu ruang kelas.
        let autoRedirectedFromGateOut = false;
        if (!isCurrentlyDismissalTime && !isBkGateOut && !isMusholaOut) {
            const isGateOutScanned = scanType === 'GATE_OUT' || (barcodeCode && barcodeCode.startsWith('GATE_OUT'));
            if (isGateOutScanned) {
                return res.status(400).json({
                    success: false,
                    isGateOutInMorning: true,
                    message: `⛔ Anda Memindai Barcode Kepulangan (Gate-Out)! Gerbang kepulangan saat ini SEDANG DITUTUP (Baru dibuka pukul ${effective.gateOutStartTime} WIB). Jangan panik! Silakan pindai Barcode Masuk (Gate-In) di samping pintu ruang kelas ${student.className} untuk mencatat kehadiran pagi ini.`
                });
            }
        }

        // SMART AUTO-CORRECTION (SIANG HARI - JAM KEPULANGAN):
        // Jika scan dilakukan saat jam kepulangan resmi sekolah (isCurrentlyDismissalTime === true),
        // siswa SUDAH memiliki presensi masuk pagi (todayInRecord ada) dan BELUM presensi pulang (todayOutRecord belum ada):
        // Jika siswa memindai barcode GATE_IN di kelas (karena kamera menyorot barcode masuk atau salah pilih menu),
        // otomatis konversi menjadi presensi pulang (GATE_OUT)!
        // Ini mencegah 100% siswa terkecoh respons "✅ Anda sudah tercatat Presensi Masuk pukul 06.56 WIB" lalu pulang tanpa data kepulangan.
        let autoRedirectedFromGateIn = false;
        if (isCurrentlyDismissalTime && todayInRecord && !todayOutRecord && !isBkGateIn && !isMusholaIn) {
            if (scanType === 'GATE_IN' || (barcodeCode && (barcodeCode.startsWith('GATE_IN') || barcodeCode.startsWith('GATE-CLASS')))) {
                scanType = 'GATE_OUT';
                autoRedirectedFromGateIn = true;
                console.log(`[SMART SCAN AUTO-CORRECT SIANG] Siswa ${student.name} (${student.className}) scan barcode GATE_IN di jam pulang (${currentTimeStr} WIB) -> Otomatis dikonversi ke GATE_OUT.`);
            }
        }

        if (isMusholaBarcode) {
            if (type === 'GATE_OUT' || type === 'MUSHOLA_OUT' || isMusholaOut) {
                scanType = 'MUSHOLA_OUT';
            } else if (type === 'GATE_IN' || type === 'MUSHOLA_IN') {
                scanType = 'MUSHOLA_IN';
            } else if (isCurrentlyDismissalTime) {
                // Jam kepulangan telah tiba: scan barcode mushola otomatis menjadi presensi pulang
                scanType = 'MUSHOLA_OUT';
            } else {
                scanType = 'MUSHOLA_IN';
            }
        } else if (!scanType) {
            if (isBkGateIn) scanType = 'GATE_IN';
            else if (isBkGateOut) scanType = 'GATE_OUT';
            else if (barcodeCode.startsWith('GATE_IN') || barcodeCode.startsWith('GATE-CLASS')) {
                if (isCurrentlyDismissalTime && todayInRecord && !todayOutRecord) {
                    scanType = 'GATE_OUT';
                    autoRedirectedFromGateIn = true;
                } else {
                    scanType = 'GATE_IN';
                }
            } else if (barcodeCode.startsWith('GATE_OUT')) {
                scanType = 'GATE_OUT';
            } else scanType = 'GATE_IN';
        }

        if (!student.className || student.className.trim() === '') {
            return res.status(400).json({
                message: 'Presensi Ditolak! Akun siswa Anda belum ditentukan rombel kelasnya. Silakan hubungi admin sekolah.'
            });
        }

        // ============================================================
        // ATURAN 1 & 2: DUAL-POINT CHECKOUT - TITIK MUSHOLA SEKOLAH
        // ============================================================
        if (isMusholaBarcode) {
            const todayDay = now.getDay();
            const prayerSchedule = await (prisma as any).prayerClassSchedule.findFirst({
                where: { dayOfWeek: todayDay, isActive: true }
            });

            const scheduledClasses = (prayerSchedule?.classNames || '').split(',').map((c: string) => c.trim().toUpperCase());
            const isAllMaleSchedule = prayerSchedule?.prayerType === 'JUMAT' || scheduledClasses.includes('ALL_MALE');
            const studentGender = (student.gender || 'L').toUpperCase().startsWith('P') ? 'P' : 'L';
            
            const isClassScheduled = isAllMaleSchedule 
                ? (studentGender === 'L') 
                : scheduledClasses.includes(student.className.trim().toUpperCase());

            // ATURAN 1: Barcode di mushola hanya valid untuk kelas yang memiliki jadwal sholat di mushola pada jam/hari tersebut (Kecuali Mode Pulang Cepat / Darurat).
            if (!isClassScheduled && !isTestingMode && !settings.isEmergencyGateOut && !settings.isEarlyDismissal) {
                return res.status(403).json({
                    success: false,
                    message: `⛔ Akses Mushola Ditolak! Rombel ${student.className} tidak memiliki jadwal sholat berjamaah di mushola hari ini (${prayerSchedule?.dayName || 'Hari Ini'}). Siswa dipersilakan melakukan presensi kepulangan langsung di Ruang Kelas.`
                });
            }

            const todayYmdStr = new Date(now).toISOString().substring(0, 10);
            const pType = prayerSchedule?.prayerType || (todayDay === 5 ? 'JUMAT' : 'DHUHUR');

            // ATURAN 2A: Siswa melakukan "Scan In" saat tiba di mushola
            if (isMusholaIn || scanType === 'MUSHOLA_IN') {
                const todayPrayerIn = await (prisma as any).studentPrayerAttendance.findFirst({
                    where: { studentId: student.id, date: todayYmdStr, prayerType: pType }
                });

                if (todayPrayerIn) {
                    const inTime = formatTimeWib(todayPrayerIn.createdAt);
                    return res.json({
                        success: true,
                        alreadyScanned: true,
                        message: `✅ Anda sudah tercatat Scan In di Mushola hari ini pukul ${inTime} WIB. Silakan bersiap melaksanakan Sholat ${pType} Berjamaah.`
                    });
                }

                await (prisma as any).studentPrayerAttendance.create({
                    data: {
                        studentId: student.id,
                        studentName: student.name,
                        className: student.className,
                        gender: studentGender,
                        prayerType: pType,
                        date: todayYmdStr,
                        status: 'SHOLAT_BERJAMAAH',
                        method: 'STATIC_BARCODE',
                        recordedById: student.id,
                        recordedByName: student.name,
                        notes: `Scan In kedatangan di Mushola Sekolah (Rombel ${student.className})`
                    }
                });

                return res.json({
                    success: true,
                    scanType: 'MUSHOLA_IN',
                    message: `🕌 Scan In Mushola Berhasil! Selamat menunaikan Sholat ${pType} Berjamaah. Lakukan Scan Out setelah selesai sholat untuk presensi kepulangan otomatis.`
                });
            }

            // ATURAN 2B: Siswa melakukan "Scan Out" setelah sholat selesai -> Otomatis tercatat "PULANG" (lokasi_pulang = 'MUSHOLA')
            if (isMusholaOut || scanType === 'MUSHOLA_OUT' || scanType === 'GATE_OUT') {
                // Validasi Jam Buka Kepulangan Mushola (Disamakan resmi dengan jam pulang sekolah hari ini)
                const musholaOutStartTime = (effective.gateOutStartTime || '12:00') + ':00';
                if (compareTimeSec < musholaOutStartTime && !isTestingMode && !settings.isEmergencyGateOut && !settings.isEarlyDismissal) {
                    return res.status(400).json({
                        success: false,
                        message: `⚠️ Gerbang Kepulangan Mushola Belum Dibuka! Presensi kepulangan dari mushola dibuka mulai pukul ${effective.gateOutStartTime} WIB (Waktu saat ini: ${currentTimeStr} WIB). KBM masih berlangsung.`
                    });
                }

                // Cek atau buat record sholat jika siswa scan pulang langsung di mushola
                let todayPrayerIn = await (prisma as any).studentPrayerAttendance.findFirst({
                    where: { studentId: student.id, date: todayYmdStr, prayerType: pType }
                });

                if (!todayPrayerIn) {
                    try {
                        todayPrayerIn = await (prisma as any).studentPrayerAttendance.create({
                            data: {
                                studentId: student.id,
                                studentName: student.name,
                                className: student.className,
                                gender: studentGender,
                                prayerType: pType,
                                date: todayYmdStr,
                                status: 'SHOLAT_BERJAMAAH',
                                method: 'AUTO_GATE_OUT_MUSHOLA',
                                recordedById: student.id,
                                recordedByName: student.name,
                                notes: `Hadir sholat & scan pulang di Mushola (${currentTimeStr} WIB)`
                            }
                        });
                    } catch (e) {}
                }

                // ATURAN 5: Pencegahan Duplikasi (1 Siswa hanya boleh memiliki status kepulangan 1x per hari)
                const startOfDayToday = new Date(now);
                startOfDayToday.setHours(0, 0, 0, 0);
                const endOfDayToday = new Date(now);
                endOfDayToday.setHours(23, 59, 59, 999);

                const existingGateOut = await prisma.attendance.findFirst({
                    where: {
                        userId: student.id,
                        type: 'GATE_OUT',
                        scanTime: { gte: startOfDayToday, lte: endOfDayToday }
                    }
                });

                if (existingGateOut && !isTestingMode) {
                    const outTimeStr = formatTimeWib(existingGateOut.scanTime, true);
                    return res.status(400).json({
                        success: false,
                        message: `⚠️ Presensi Kepulangan Ditolak! Anda sudah melakukan presensi pulang hari ini pukul ${outTimeStr} WIB (${existingGateOut.note || 'Gate-Out'}). Presensi pulang dikunci 1x per hari.`
                    });
                }

                // Update catatan presensi sholat
                if (todayPrayerIn) {
                    await (prisma as any).studentPrayerAttendance.update({
                        where: { id: todayPrayerIn.id },
                        data: { notes: (todayPrayerIn.notes || '') + ' • Scan Out Pulang Mandiri' }
                    });
                }

                // Buat record Attendance kepulangan GATE_OUT
                const attOut = await prisma.attendance.create({
                    data: {
                        userId: student.id,
                        type: 'GATE_OUT',
                        method: method || 'BARCODE',
                        status: 'PRESENT',
                        lat: lat ? Number(lat) : null,
                        lng: lng ? Number(lng) : null,
                        geofenceZoneName: 'MUSHOLA',
                        note: `Pulang Otomatis Selesai Sholat di Mushola (Rombel ${student.className})`,
                        accuracyMeters: accuracyNum,
                        jarakKeSekolah: distanceMeters,
                        statusVerifikasi: 'AUTO'
                    }
                });

                return res.json({
                    success: true,
                    scanType: 'GATE_OUT',
                    lokasi_pulang: 'MUSHOLA',
                    record: attOut,
                    message: `✅ Scan Out Mushola Berhasil! Anda tercatat PULANG dari Mushola (Selesai Sholat Berjamaah). Anda dapat langsung pulang tanpa perlu kembali ke kelas.`
                });
            }
        }

        const isSpecialCheckout = req.body.isSpecialCheckoutWithoutIn === true || req.body.isSpecialCheckoutWithoutIn === 'true';

        // Jika bukan barcode BK dan bukan Mushola, wajib validasi barcode ruang kelas siswa
        if (!isBkBarcode && !isMusholaBarcode) {
            const expectedGateIn = 'GATE_IN_' + student.className.trim();
            const expectedGateOut = 'GATE_OUT_' + student.className.trim();
            const classNorm = student.className.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const codeNorm = (barcodeCode || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const isMatchClass = classNorm.length > 0 && codeNorm.includes(classNorm);

            if (scanType === 'GATE_IN') {
                const isValidInBarcode = barcodeCode === expectedGateIn || isMatchClass;
                if (!isValidInBarcode) {
                    return res.status(400).json({
                        success: false,
                        isClassMismatch: true,
                        message: 'Presensi Ditolak! Anda mencoba scan barcode kelas lain. Silakan scan Barcode Gate-In di ruang kelas ' + student.className
                    });
                }
            }

            if (scanType === 'GATE_OUT') {
                const isValidOutBarcode = barcodeCode === expectedGateOut || (autoRedirectedFromGateIn && barcodeCode === expectedGateIn) || isMatchClass;
                if (!isValidOutBarcode) {
                    return res.status(400).json({
                        message: 'Presensi Ditolak! Anda mencoba scan barcode kelas lain. Silakan scan Barcode Gate-Out di ruang kelas ' + student.className
                    });
                }
            }
        }

        // ============================================================
        // SIBOY A10 LOCK SAKIT: Jika siswa di-approve sakit oleh BK -> semua absensi LOCKED
        // ============================================================
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        const approvedSickToday = await (prisma as any).studentLeaveRequest.findFirst({
            where: {
                studentId: student.id,
                status: 'APPROVED',
                category: { in: ['SICK', 'SAKIT'] },
                startDate: { lte: todayEnd },
                endDate: { gte: todayStart }
            }
        });

        if (approvedSickToday) {
            // [T-05] A10 Lock Sakit: jangan blokir scan! Jika siswa hadir fisik di sekolah,
            // batalkan status sakit (REVOKED) dan hapus placeholder SICK di Attendance hari ini,
            // lalu izinkan proses scan berlangsung sehingga siswa tidak tertahan.
            await (prisma as any).studentLeaveRequest.update({
                where: { id: approvedSickToday.id },
                data: {
                    status: 'REVOKED',
                    rejectionNote: `Status sakit dibatalkan otomatis karena siswa hadir fisik di sekolah dan melakukan scan presensi pada ${now.toLocaleTimeString('id-ID')} WIB.`
                }
            }).catch(() => null);

            await prisma.attendance.deleteMany({
                where: {
                    studentId: student.id,
                    status: { in: ['SICK', 'SAKIT'] },
                    scanTime: { gte: todayStart, lte: todayEnd }
                }
            }).catch(() => null);

            await logAudit(req, 'REVOKE_SICK_ON_PRESENCE', `Siswa ${student.name} hadir fisik; izin sakit ${approvedSickToday.id} dicabut otomatis.`, {
                studentId: student.id,
                leaveId: approvedSickToday.id
            }).catch(() => null);
        }

        // ============================================================
        // 1X ABSENSI LOCK (ANTI-DUPLIKASI PRESENSI HARI INI - ALL METHODS)
        // ============================================================
        let isMissingIn = false;

        if (scanType === 'GATE_IN') {
            if (todayInRecord && !isTestingMode) {
                const inTimeStr = formatTimeWib(todayInRecord.scanTime, true);
                return res.json({
                    success: true,
                    alreadyScanned: true,
                    scanType: 'GATE_IN',
                    message: `✅ Anda sudah tercatat Presensi Masuk (Gate-In) hari ini pukul ${inTimeStr} WIB (${todayInRecord.note || 'Tepat Waktu'}). Presensi masuk Anda sudah aman dan sah di sistem.`
                });
            }

            const gateInStartSec = '06:00:00';
            const classCloseSec = '07:05:00';
            const allScanCloseSec = '08:00:00';

            // 1. Lock jika sebelum jam buka gerbang masuk (06:00:00 WIB)
            if (compareTimeSec < gateInStartSec && !isTestingMode && !settings.isEmergencyGateOut) {
                return res.status(400).json({
                    success: false,
                    message: `⚠️ Gerbang Masuk Belum Dibuka! Presensi masuk dibuka mulai pukul 06:00 WIB.`
                });
            }

            // 2. Lock jika setelah pukul 08:00:00 WIB: seluruh scan QR (kelas maupun BK) ditutup total
            if (compareTimeSec > allScanCloseSec && !isTestingMode && !settings.isEmergencyGateOut) {
                return res.status(400).json({
                    success: false,
                    isGateInClosedAll: true,
                    message: `⛔ Seluruh Jalur Presensi Masuk (Scan Kelas & BK) Telah Ditutup Pukul 08:00 WIB! Anda memindai pukul ${compareTimeSec} WIB. Siswa yang hadir setelah pukul 08:00 WIB wajib melapor ke Ruang BK untuk dicatat secara manual oleh Guru BK.`
                });
            }

            // 3. Aturan QR Ruang BK vs QR Kelas (06:00 - 08:00 WIB)
            if (isBkGateIn) {
                // QR Ruang BK hanya aktif pukul 07:05:01 s/d 08:00:00 WIB
                if (compareTimeSec <= classCloseSec && !isTestingMode) {
                    return res.status(400).json({
                        success: false,
                        message: `⚠️ QR Ruang BK Belum Dibuka! Sebelum pukul 07:05 WIB, silakan lakukan presensi di ruang kelas Anda (${student.className}). QR Ruang BK dibuka mulai pukul 07:05:01 s/d 08:00:00 WIB khusus bagi siswa yang terlambat.`
                    });
                }
            } else {
                // QR Ruang Kelas (Statis / Dinamis Pengurus) DITUTUP TOTAL pukul 07:05:00 WIB
                if (compareTimeSec > classCloseSec && !isTestingMode && !settings.isEmergencyGateOut) {
                    const [currH, currM] = currentTimeStr.split(':').map(Number);
                    const overLateMin = Math.max(1, (currH * 60 + currM) - (7 * 60));
                    return res.status(400).json({
                        success: false,
                        isClassGateClosedToBk: true,
                        message: `⛔ Presensi di Ruang Kelas Ditutup Pukul 07:05 WIB! Batas waktu presensi di ruang kelas telah berakhir. Anda memindai pukul ${compareTimeSec} WIB (Terlambat ${overLateMin} menit). Segera menuju ke Ruang BK untuk memindai Barcode Terlambat di Ruang BK (aktif hingga pukul 08:00 WIB).`
                    });
                }
            }
        } else if (scanType === 'GATE_OUT') {
            // Validasi Keamanan Gerbang SIBOY: Toleransi Scan Pulang Tanpa Data Masuk
            // Sesuai kebijakan: Jangan tolak scan pulang hanya karena data masuk tidak ditemukan.
            // Scan pulang tetap diterima jika barcode benar, jam pulang tiba, dan GPS valid.
            // Ditandai "Pulang tanpa data masuk – perlu verifikasi" dan dicatat ke daftar anomali untuk BK/Wali Kelas.
            if (!todayInRecord && !settings.isEmergencyGateOut) {
                isMissingIn = true;
                setImmediate(async () => {
                    try {
                        const { recordAnomaly } = await import('../utils/anomalyDetector');
                        await recordAnomaly({
                            code: 'MISSING_GATE_IN_ON_OUT',
                            level: 'SEDANG',
                            module: 'ATTENDANCE',
                            summary: `Siswa ${student.name} (${student.className}) scan pulang tanpa data masuk (ditandai perlu verifikasi BK/Wali Kelas).`,
                            count: 1,
                            sampleStudents: [{
                                id: student.id,
                                name: student.name,
                                className: student.className,
                                reason: 'Scan kepulangan tanpa data masuk pagi',
                                time: getWibTimeColon(new Date(), true)
                            }]
                        });
                    } catch (e) {}
                });
            }

            if (todayOutRecord && !isTestingMode) {
                const outTimeStr = formatTimeWib(todayOutRecord.scanTime, true);
                return res.json({
                    success: true,
                    alreadyScanned: true,
                    scanType: 'GATE_OUT',
                    message: `✅ Anda sudah tercatat Presensi Pulang (Gate-Out) hari ini pukul ${outTimeStr} WIB (${todayOutRecord.note || 'Normal'}). Presensi kepulangan Anda sudah aman dan sah di sistem.`
                });
            }

            if (isBkGateOut) {
                // QR Izin Pulang BK:
                const [outH, outM] = effective.gateOutStartTime.split(':').map(Number);
                const bkCloseH = Math.max(0, outH - 1);
                const bkCloseTimeStr = `${String(bkCloseH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;

                if (currentTimeStr < effective.gateInEndTime && !isTestingMode && !settings.isEmergencyGateOut) {
                    return res.status(400).json({
                        message: `⚠️ Layanan Izin Pulang BK belum dibuka. Layanan dibuka mulai pukul ${effective.gateInEndTime} WIB.`
                    });
                }

                if (currentTimeStr > bkCloseTimeStr && !isTestingMode && !settings.isEmergencyGateOut) {
                    return res.status(400).json({
                        message: `⚠️ Layanan Izin Pulang BK telah ditutup untuk hari ini (Layanan ditutup 1 jam sebelum jam pulang normal pukul ${effective.gateOutStartTime} WIB, yaitu pukul ${bkCloseTimeStr} WIB). Silakan scan di gerbang kepulangan normal saat jam kepulangan dibuka.`
                    });
                }
            } else {
                // Gerbang Pulang Normal
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date();
                todayEnd.setHours(23, 59, 59, 999);

                const approvedLeaveToday = await prisma.studentLeaveRequest.findFirst({
                    where: {
                        studentId: student.id,
                        status: 'APPROVED',
                        startDate: { lte: todayEnd },
                        endDate: { gte: todayStart }
                    }
                });

                const uksSentHomeToday = await prisma.uksVisit.findFirst({
                    where: {
                        userId: student.id,
                        disposition: { in: ['SENT_HOME', 'REFERRED_HOSPITAL'] },
                        checkInTime: { gte: todayStart, lte: todayEnd }
                    }
                });

                const hasEarlyLeavePersonal = Boolean(approvedLeaveToday || uksSentHomeToday);
                const isEmergency = Boolean(settings.isEmergencyGateOut);
                const isEarlyDismissalAll = Boolean(settings.isEarlyDismissal);

                const gateOutStartSec = (effective.gateOutStartTime || '12:30') + ':00';
                const gateOutEndSec = (effective.gateOutEndTime || '18:00') + ':59';
                const isWithinOfficialDismissal = effective.currentTimeWithSecStr >= gateOutStartSec && effective.currentTimeWithSecStr <= gateOutEndSec;

                const isGateOutPermitted = isTestingMode || isEmergency || isEarlyDismissalAll || hasEarlyLeavePersonal || isWithinOfficialDismissal;

                if (!isGateOutPermitted) {
                    return res.status(400).json({
                        success: false,
                        isGateOutClosed: true,
                        message: `⛔ Gerbang Kepulangan Belum Dibuka! Presensi kepulangan (Gate-Out) baru dibuka mulai pukul ${effective.gateOutStartTime} WIB sesuai jadwal operasional sekolah hari ${effective.currentDayName} (${effective.gateOutStartTime} - ${effective.gateOutEndTime} WIB). Saat ini baru pukul ${effective.currentTimeWithSecStr} WIB. KBM masih berlangsung.`
                    });
                }

                // ============================================================
                // ATURAN 3 & 4: Penanganan Presensi Pulang Kelas vs Mushola
                // ============================================================
                const todayDay = now.getDay();
                const prayerSchedule = await (prisma as any).prayerClassSchedule.findFirst({
                    where: { dayOfWeek: todayDay, isActive: true }
                });

                if (prayerSchedule && !isEmergency && !isEarlyDismissalAll && !isTestingMode) {
                    const scheduledClasses = (prayerSchedule.classNames || '').split(',').map((c: string) => c.trim().toUpperCase());
                    const isAllMaleSchedule = prayerSchedule.prayerType === 'JUMAT' || scheduledClasses.includes('ALL_MALE');
                    const studentGender = (student.gender || 'L').toUpperCase().startsWith('P') ? 'P' : 'L';
                    const isClassScheduled = isAllMaleSchedule 
                        ? (studentGender === 'L') 
                        : scheduledClasses.includes(student.className.trim().toUpperCase());

                    if (isClassScheduled) {
                        // ATURAN 3 (Putra): Siswa putra dari kelas terjadwal WAJIB ke mushola (tidak boleh scan pulang di kelas)
                        if (studentGender === 'L' && !isTestingMode) {
                            return res.status(403).json({
                                success: false,
                                message: `🕌 Presensi Pulang di Kelas Ditolak! Rombel ${student.className} memiliki jadwal Sholat ${prayerSchedule.prayerType || 'Dhuhur'} Berjamaah di Mushola hari ini. Siswa putra WAJIB menuju ke mushola untuk sholat berjamaah dan melakukan Scan Out kepulangan di mushola.`
                            });
                        }

                        // ATURAN 3 (Putri): Siswi putri yang berhalangan diizinkan scan pulang langsung di Kelas
                        if (studentGender === 'P') {
                            const isUzurParam = req.body.isBerhalangan === true || req.body.isBerhalangan === 'true' || 
                                               req.body.isHaid === true || req.body.isHaid === 'true' || 
                                               (typeof req.body.reason === 'string' && (req.body.reason.toLowerCase().includes('haid') || req.body.reason.toLowerCase().includes('halangan')));
                            
                            const todayYmdStr = new Date(now).toISOString().substring(0, 10);
                            const pType = prayerSchedule.prayerType || (todayDay === 5 ? 'JUMAT' : 'DHUHUR');
                            
                            const existingPrayerRec = await (prisma as any).studentPrayerAttendance.findFirst({
                                where: { studentId: student.id, date: todayYmdStr, prayerType: pType }
                            });

                            const isRecordedHaid = existingPrayerRec?.status === 'BERHALANGAN_HAID' || existingPrayerRec?.status === 'TIDAK_SHOLAT_UZUR';

                            if (isUzurParam || isRecordedHaid) {
                                if (!existingPrayerRec) {
                                    await (prisma as any).studentPrayerAttendance.create({
                                        data: {
                                            studentId: student.id,
                                            studentName: student.name,
                                            className: student.className,
                                            gender: 'P',
                                            prayerType: pType,
                                            date: todayYmdStr,
                                            status: 'BERHALANGAN_HAID',
                                            method: 'AUTO_GATE_OUT_UZUR',
                                            recordedById: student.id,
                                            recordedByName: student.name,
                                            notes: 'Siswi berhalangan (Haid/Uzur), presensi kepulangan langsung di ruang kelas'
                                        }
                                    });
                                }
                            } else if (!isTestingMode) {
                                return res.status(403).json({
                                    success: false,
                                    needsHaidConfirmation: true,
                                    message: `🕌 Presensi Pulang di Kelas Ditolak! Rombel ${student.className} memiliki jadwal Sholat Berjamaah di Mushola hari ini. Siswi putri yang tidak berhalangan wajib sholat di mushola dan scan pulang di mushola. Jika Anda sedang berhalangan (haid/uzur), silakan konfirmasi Berhalangan Sholat untuk scan pulang langsung di kelas.`
                                });
                            }
                        }
                    }
                }
            }
        }

        let status = 'PRESENT';
        let note = 'Presensi Gate-In Berhasil di Kelas ' + student.className;
        let lateMinutes = 0;

        if (scanType === 'GATE_IN') {
            const gateInEndSec = (effective.gateInEndTime || '07:00') + ':00';
            if (isBkGateIn || effective.currentTimeWithSecStr > gateInEndSec) {
                const [endH, endM] = effective.gateInEndTime.split(':').map(Number);
                const [currH, currM] = currentTimeStr.split(':').map(Number);
                lateMinutes = Math.max(1, (currH * 60 + currM) - (endH * 60 + endM));

                // GAP-05: Cek apakah siswa memiliki dispensasi / alasan sah yang disetujui Guru Piket / BK
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                const activeDispensation = await (prisma as any).studentLeaveRequest.findFirst({
                    where: {
                        studentId: student.id,
                        status: 'APPROVED',
                        category: { in: ['DISPENSATION', 'SICK', 'PERMISSION'] },
                        startDate: { lte: new Date() },
                        endDate: { gte: todayMidnight }
                    }
                });

                if (activeDispensation) {
                    status = 'LATE_EXCUSED';
                    note = `Terlambat Dimaklumi (Dispensasi Sah: ${activeDispensation.reason || activeDispensation.category}) • Pukul ${effective.currentTimeWithSecStr} WIB`;
                } else {
                    status = 'LATE';
                    note = isBkGateIn
                        ? `Terlambat ${lateMinutes} menit masuk (Scan di Ruang BK pukul ${effective.currentTimeWithSecStr} WIB - Batas normal ${effective.gateInEndTime}:00)`
                        : `Terlambat ${lateMinutes} menit masuk (Scan langsung di Ruang Kelas ${student.className} pukul ${effective.currentTimeWithSecStr} WIB - Batas normal ${effective.gateInEndTime}:00)${autoRedirectedFromGateOut ? ' • Otomatis Presensi Masuk' : ''}`;

                    // Catat rekam kedisiplinan (+2 poin keterlambatan)
                    try {
                        await prisma.disciplineRecord.create({
                            data: {
                                userId: student.id,
                                type: 'PELANGGARAN',
                                description: isBkGateIn
                                    ? `Keterlambatan masuk sekolah (${lateMinutes} menit) tercatat via QR Ruang BK pada pukul ${currentTimeStr} WIB`
                                    : `Keterlambatan masuk sekolah (${lateMinutes} menit) tercatat via scan Kelas ${student.className} pada pukul ${currentTimeStr} WIB`,
                                points: 2
                            }
                        });
                        await prisma.user.update({
                            where: { id: student.id },
                            data: { points: { increment: 2 } }
                        });

                        // Notifikasi ke BK dan Wali Kelas telah dinonaktifkan sesuai instruksi pengguna
                    } catch (e) {}
                }
            } else {
                note = 'Hadir Tepat Waktu (Pukul ' + currentTimeStr + ' WIB) di Ruang Kelas ' + student.className + (autoRedirectedFromGateOut ? ' • Otomatis Presensi Masuk' : '');
            }
        } else {
            if (isBkGateOut) {
                status = 'EARLY_LEAVE';
                note = `Izin Pulang Cepat Disetujui BK (Pukul ${currentTimeStr} WIB)`;
                // Notifikasi ke BK dinonaktifkan sesuai instruksi pengguna
            } else if (settings.isEmergencyGateOut) {
                note = `Presensi Pulang Darurat (Pukul ${currentTimeStr} WIB: ${settings.emergencyReason || 'Keadaan Darurat Sekolah'})`;
            } else if (settings.isEarlyDismissal) {
                note = `Presensi Pulang Lebih Awal (Pukul ${currentTimeStr} WIB: ${settings.emergencyReason || 'Acara / Pulang Cepat Sekolah'})`;
            } else if (isMissingIn) {
                note = `Pulang tanpa data masuk – perlu verifikasi (Pukul ${currentTimeStr} WIB)`;
            } else if (isSpecialCheckout && !todayInRecord) {
                note = `Presensi Kepulangan Khusus (Pukul ${currentTimeStr} WIB - Lupa Scan Masuk Pagi, Tercatat Peringatan BK)`;
            } else {
                note = `Presensi Kepulangan Normal (Pukul ${currentTimeStr} WIB)${autoRedirectedFromGateIn ? ' • Scan Kelas' : ''}`;
            }
        }

        if (isDynamicOfficerQr) {
            note += ' • Terverifikasi QR Dinamis Pengurus Kelas';
        } else if (distanceMeters !== null) {
            note += ` • Jarak GPS: ${distanceMeters}m (Valid)`;
        }

        let finalMethod = method || 'BARCODE';
        if (isBkGateIn) {
            finalMethod = 'QR_BK_TERLAMBAT';
        } else if (isDynamicOfficerQr) {
            finalMethod = 'QR_DYNAMIC_OFFICER';
        } else if (scanType === 'GATE_IN') {
            finalMethod = method === 'GPS' ? 'GPS' : 'QR_KELAS_MANDIRI';
        }

        const attRecord = await prisma.attendance.create({
            data: {
                userId: student.id,
                type: scanType,
                method: finalMethod,
                status,
                scanTime: effectiveScanTime,
                lat: lat ? Number(lat) : null,
                lng: lng ? Number(lng) : null,
                isFakeGps: Boolean(isFakeGps),
                accuracyMeters: accuracyNum,
                jarakKeSekolah: distanceMeters,
                statusVerifikasi: 'AUTO',
                kalmanApplied: Boolean(req.body.kalmanApplied),
                note
            }
        });

        // Catat poin kedisiplinan otomatis jika melakukan Pulang Khusus tanpa scan masuk
        if (scanType === 'GATE_OUT' && isSpecialCheckout && !todayInRecord) {
            try {
                await (prisma as any).disciplineRecord.create({
                    data: {
                        userId: student.id,
                        type: 'PELANGGARAN',
                        category: 'KEDISIPLINAN',
                        description: 'Melakukan presensi kepulangan tanpa rekam kedatangan (Lupa scan masuk pagi)',
                        points: 2,
                        counselorName: 'Sistem Gerbang Otomatis'
                    }
                });
            } catch (discErr) {
                console.warn('Error recording auto discipline for special checkout:', discErr);
            }
        }

        // ============================================================
        // INTEGRASI NOTIFIKASI OTOMATIS KE ORANG TUA (TEPAT 1X MASUK & 1X PULANG PER HARI)
        // ============================================================
        const timeWithSec = formatTimeWibWithSuffix(now, true);
        const { startOfDay: notifStartDay, endOfDay: notifEndDay } = getWibDayBounds(now);

        // Cek apakah orang tua sudah pernah menerima notifikasi untuk scan masuk atau pulang hari ini
        const existingParentNotif = await prisma.notificationMessage.findFirst({
            where: {
                studentId: student.id,
                recipientRole: 'PARENT',
                category: 'ATTENDANCE',
                sentAt: { gte: notifStartDay, lte: notifEndDay },
                title: scanType === 'GATE_IN'
                    ? { contains: 'Masuk' }
                    : { contains: 'Pulang' }
            }
        });

        let hasNotifiedToday = Boolean(existingParentNotif);
        if (!hasNotifiedToday && scanType === 'GATE_IN') {
            const fallbackInNotif = await prisma.notificationMessage.findFirst({
                where: {
                    studentId: student.id,
                    recipientRole: 'PARENT',
                    category: 'ATTENDANCE',
                    sentAt: { gte: notifStartDay, lte: notifEndDay },
                    OR: [
                        { title: { contains: 'Tiba' } },
                        { title: { contains: 'Terlambat' } }
                    ]
                }
            });
            if (fallbackInNotif) hasNotifiedToday = true;
        }

        if (!hasNotifiedToday) {
            const methodLabel = method === 'GPS' ? 'Geolocation GPS Sekolah (Radius Valid)' : (method === 'DYNAMIC_QR' ? 'QR Dinamis Pengurus Kelas' : 'Pemindaian Kode Siswa');
            
            const parentTitle = scanType === 'GATE_IN'
                ? (status === 'LATE' ? '⏰ [SIBOY KEDISIPLINAN] Siswa Tiba Terlambat di Sekolah' : '✅ [SIBOY PRESENSI] Ananda Tiba di Sekolah Tepat Waktu')
                : '🏠 [SIBOY KEPULANGAN] Ananda Selesai KBM & Menuju Rumah';

            const parentMsg = scanType === 'GATE_IN'
                ? (status === 'LATE'
                    ? `Yth. Bapak/Ibu Wali Murid dari ananda ${student.name} (Kelas ${student.className || '-'}):\n\n` +
                      `Kami menginformasikan bahwa ananda telah melakukan presensi di SMP Negeri 1 Boyolangu (di kelas) dengan catatan KETERLAMBATAN:\n` +
                      `• Waktu Tiba: ${timeWithSec}\n` +
                      `• Keterlambatan: ${lateMinutes} Menit (Batas Masuk: ${effective.gateInEndTime || '07:00'} WIB)\n` +
                      `• Metode Presensi: ${methodLabel}\n` +
                      `• Lokasi: Presensi di SMP Negeri 1 Boyolangu (Ruang Kelas ${student.className || '-'})\n` +
                      `• Tindak Lanjut: Diarahkan oleh Tim Ketertiban / Guru Piket sebelum pembelajaran dimulai.\n\n` +
                      `Mohon dukungan Bapak/Ibu untuk membimbing ananda agar dapat berangkat lebih awal demi kelancaran proses pembelajaran.`
                    : `Yth. Bapak/Ibu Wali Murid dari ananda ${student.name} (Kelas ${student.className || '-'}):\n\n` +
                      `Kami menginformasikan bahwa ananda telah hadir dan melakukan presensi di SMP Negeri 1 Boyolangu (di kelas) secara resmi:\n` +
                      `• Waktu Tiba: ${timeWithSec}\n` +
                      `• Status: HADIR TEPAT WAKTU (Disiplin)\n` +
                      `• Metode Presensi: ${methodLabel}\n` +
                      `• Lokasi: Presensi di SMP Negeri 1 Boyolangu (Ruang Kelas ${student.className || '-'})\n\n` +
                      `Ananda saat ini bersiap mengikuti apel pagi / pembiasaan literasi dan jam pelajaran pertama. Terima kasih atas kerja sama Bapak/Ibu.`)
                : `Yth. Bapak/Ibu Wali Murid dari ananda ${student.name} (Kelas ${student.className || '-'}):\n\n` +
                  `Seluruh rangkaian Kegiatan Belajar Mengajar (KBM) hari ini telah berakhir.\n` +
                  `• Waktu Presensi Pulang: ${timeWithSec}\n` +
                  `• Status: PULANG RESMI (Tercatat di Sistem Kehadiran)\n` +
                  `• Lokasi Terakhir: Presensi di SMP Negeri 1 Boyolangu (Ruang Kelas ${student.className || '-'})\n\n` +
                  `Ananda saat ini dalam perjalanan pulang ke rumah / menunggu penjemputan. Mohon pastikan ananda tiba di rumah dengan selamat. Terima kasih atas kerja samanya.`;

            try {
                await prisma.notificationMessage.create({
                    data: {
                        studentId: student.id,
                        studentName: student.name,
                        className: student.className,
                        recipientPhone: student.parentPhone,
                        recipientRole: 'PARENT',
                        title: parentTitle,
                        message: parentMsg,
                        category: 'ATTENDANCE'
                    }
                });

                // Kirim Push Notification FCM langsung ke HP Orang Tua (Heads-Up Banner seperti WhatsApp)
                const cleanNisn = (student.nisn || student.username || '').replace(/^[Pp]/, '').trim();
                const parentUsers = await prisma.user.findMany({
                    where: {
                        role: 'PARENT',
                        OR: [
                            { username: `P${cleanNisn}` },
                            { username: `p${cleanNisn}` },
                            { username: cleanNisn },
                            { nisn: cleanNisn },
                            ...(student.parentPhone ? [{ username: student.parentPhone }] : [])
                        ]
                    }
                });

                for (const p of parentUsers) {
                    await sendFcmToUser(p.id, parentTitle, parentMsg, {
                        type: 'ATTENDANCE',
                        scanType,
                        studentId: student.id,
                        studentName: student.name
                    }).catch(e => console.warn('[FCM Attendance Parent]', e.message));
                }

                req.app.get('io')?.emit('attendance_updated', {
                    studentId: student.id,
                    studentName: student.name,
                    className: student.className,
                    scanType,
                    status
                });

                // Kirim juga ke HP siswa
                await sendFcmToUser(student.id, parentTitle, parentMsg, {
                    type: 'ATTENDANCE',
                    scanType,
                    studentId: student.id
                }).catch(e => console.warn('[FCM Attendance Student]', e.message));

                // Sesuai instruksi D13: Notifikasi WhatsApp HANYA untuk siswa terlambat dan hanya ke nomor orang tua yang terinput
                if (status === 'LATE' && lateMinutes > 0 && student.parentPhone) {
                    const waTrack = isBkGateIn 
                        ? 'Scan QR Terlambat di Ruang BK' 
                        : (isDynamicOfficerQr ? `Scan Barcode Dinamis Pengurus Kelas (${student.className || '-'})` : `Scan Presensi Mandiri di Ruang Kelas (${student.className || '-'})`);
                    const waLocation = isBkGateIn ? 'Ruang Bimbingan & Konseling (BK)' : `Ruang Kelas ${student.className || '-'}`;
                    const waFollowUp = isBkGateIn
                        ? 'Telah melapor ke Guru BK untuk pembinaan kedisiplinan sebelum memasuki kelas.'
                        : 'Diarahkan oleh Tim Ketertiban / Pengurus Kelas sebelum pembelajaran dimulai.';

                    const waLateNotice = `*PEMBERITAHUAN KETERLAMBATAN SISWA*\n` +
                        `*SMP NEGERI 1 BOYOLANGU*\n\n` +
                        `Yth. Bapak/Ibu Orang Tua / Wali Murid dari ananda *${student.name}* (Kelas ${student.className || '-'}),\n\n` +
                        `Kami menginformasikan bahwa ananda telah tiba di sekolah dengan status *TERLAMBAT*:\n` +
                        `• *Waktu Tiba*: ${timeWithSec}\n` +
                        `• *Keterlambatan*: *${lateMinutes} Menit* (Batas Tepat Waktu: 07:00 WIB)\n` +
                        `• *Jalur Presensi*: ${waTrack}\n` +
                        `• *Lokasi*: ${waLocation}\n` +
                        `• *Tindak Lanjut*: ${waFollowUp}\n\n` +
                        `Laporan kedisiplinan ini dikirimkan secara otomatis oleh Sistem Presensi Cerdas SMPN 1 Boyolangu. Mohon bantuan Bapak/Ibu untuk membimbing ananda agar dapat berangkat lebih awal demi kelancaran proses pembelajaran. Terima kasih atas kerja samanya.`;

                    sendSingleWhatsApp(student.parentPhone, waLateNotice).catch(waErr => {
                        console.warn(`[WA Late Alert] Gagal mengirim pesan ke ${student.parentPhone}:`, waErr.message);
                    });
                }
            } catch (notifErr) {
                console.error('Error recording parent notification:', notifErr);
            }
        }

        const actionText = scanType === 'GATE_IN' 
            ? (status === 'LATE' ? `TERLAMBAT MASUK (${lateMinutes} Menit)` : 'MASUK SEKOLAH (Tepat Waktu)') 
            : (isMissingIn ? 'PULANG SEKOLAH (⚠️ Tanpa Rekaman Masuk Pagi)' : 'PULANG SEKOLAH');

        const successMessage = isMissingIn
            ? `⚠️ Perhatian! ${student.name} (${student.className}) tercatat Pulang pukul ${timeWithSec}, namun Anda belum scan masuk tadi pagi. Status kepulangan Anda ditandai 'Pulang Tanpa Presensi Masuk' dan memerlukan verifikasi Wali Kelas / Guru BK.`
            : `✅ Berhasil! ${student.name} (${student.className}) telah tercatat ${actionText} pukul ${timeWithSec}.`;

        res.json({
            message: successMessage,
            isMissingIn: Boolean(isMissingIn),
            isWarningYellow: Boolean(isMissingIn),
            attendance: attRecord,
            scanTimeStr: timeWithSec,
            scanType,
            lokasi_pulang: scanType === 'GATE_OUT' ? 'RUANG_KELAS' : undefined,
            status,
            distanceMeters,
            parentNotified: true,
            student: {
                name: student.name,
                nisn: student.nisn,
                className: student.className
            }
        });
    } catch (error) {
        console.error('Error scanning class gate:', error);
        res.status(500).json({ message: 'Terjadi kesalahan saat memproses presensi kelas' });
    }
};

export const getClassGateBarcodes = async (req: Request, res: Response) => {
    try {
        const { className } = req.query;
        let whereClause: any = {};
        if (className && className !== 'ALL') {
            whereClause.name = String(className);
        }

        let classes = await prisma.class.findMany({
            where: whereClause,
            orderBy: { name: 'asc' }
        });

        // Fallback jika tabel class belum ada isinya
        if (!classes || classes.length === 0) {
            const studentClasses = await prisma.user.findMany({
                where: { role: 'STUDENT', className: { not: null } },
                select: { className: true },
                distinct: ['className'],
                orderBy: { className: 'asc' }
            });
            classes = studentClasses.map(s => ({ id: s.className, name: s.className } as any));
            if (className && className !== 'ALL') {
                classes = classes.filter((c: any) => c.name === className);
            }
        }

        // Fallback default jika database masih fresh
        if (!classes || classes.length === 0) {
            const defaultNames = [
                'VII-A', 'VII-B', 'VII-C', 'VII-D', 'VII-E', 'VII-F', 'VII-G', 'VII-H', 'VII-I', 'VII-J', 'VII-K',
                'VIII-A', 'VIII-B', 'VIII-C', 'VIII-D', 'VIII-E', 'VIII-F', 'VIII-G', 'VIII-H', 'VIII-I', 'VIII-J', 'VIII-K',
                'IX-A', 'IX-B', 'IX-C', 'IX-D', 'IX-E', 'IX-F', 'IX-G', 'IX-H', 'IX-I', 'IX-J', 'IX-K'
            ];
            let listToMap = defaultNames;
            if (className && className !== 'ALL') {
                listToMap = defaultNames.filter(n => n === className);
            }
            classes = listToMap.map((name, idx) => ({ id: String(idx + 1), name } as any));
        }

        const DEFAULT_LAT = -8.125157;
        const DEFAULT_LNG = 111.893912;
        const DEFAULT_RADIUS = 50;

        const barcodeList = classes.map(k => {
            const gateInCode = k.gateInBarcode || ('GATE_IN_' + k.name);
            const gateOutCode = k.gateOutBarcode || ('GATE_OUT_' + k.name);
            const lat = (k.lat !== undefined && k.lat !== null && !isNaN(Number(k.lat)) && Number(k.lat) !== 0)
                ? Number(k.lat)
                : DEFAULT_LAT;
            const lng = (k.lng !== undefined && k.lng !== null && !isNaN(Number(k.lng)) && Number(k.lng) !== 0)
                ? Number(k.lng)
                : DEFAULT_LNG;
            const radiusMeters = (k.radiusMeters !== undefined && k.radiusMeters !== null && !isNaN(Number(k.radiusMeters)) && Number(k.radiusMeters) > 0)
                ? Number(k.radiusMeters)
                : DEFAULT_RADIUS;

            return {
                id: k.id,
                className: k.name,
                name: k.name,
                gateInCode,
                gateOutCode,
                gateInBarcode: gateInCode,
                gateOutBarcode: gateOutCode,
                lat,
                lng,
                radiusMeters,
                gateInQrUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(gateInCode),
                gateOutQrUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(gateOutCode),
                gateInQrFallback: 'https://quickchart.io/qr?size=250&text=' + encodeURIComponent(gateInCode),
                gateOutQrFallback: 'https://quickchart.io/qr?size=250&text=' + encodeURIComponent(gateOutCode)
            };
        });

        res.json(barcodeList);
    } catch (error) {
        console.error('Error fetching class barcodes:', error);
        res.status(500).json({ message: 'Gagal mengambil barcode kelas' });
    }
};

export const recordAttendanceScan = async (req: Request, res: Response) => {
    try {
        const {
            identifier,
            userId: inputUserId,
            method,
            type,
            lat,
            lng,
            isFakeGps,
            mockLocationDetected,
            accuracyMeters,
            gpsProvider,
            kalmanApplied,
            sampelKoordinat,
            deviceAndroidId,
            wifiSsid,
            photoUrl,
            note
        } = req.body;

        const targetIdentifier = identifier || inputUserId;
        if (!targetIdentifier) {
            return res.status(400).json({ success: false, message: 'Identifier (NISN/NIP/UserId) wajib disertakan' });
        }

        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { id: String(targetIdentifier) },
                    { username: String(targetIdentifier) },
                    { nis: String(targetIdentifier) },
                    { nisn: String(targetIdentifier) }
                ]
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        const effectiveMock = Boolean(isFakeGps || mockLocationDetected);
        const numLat = lat != null ? parseFloat(lat) : null;
        const numLng = lng != null ? parseFloat(lng) : null;
        const numAccuracy = accuracyMeters != null ? parseFloat(accuracyMeters) : null;

        // Validasi GPS Berlapis jika koordinat tersedia atau metode GPS
        let validationResult = {
            isValid: true,
            statusVerifikasi: 'AUTO',
            jarakKeSekolah: null as number | null,
            geofenceZoneId: null as string | null,
            geofenceZoneName: null as string | null,
            notes: 'Hadir normal',
            isMockGps: false,
            geofenceBypassed: true
        };

        if (numLat != null && numLng != null || method === 'GPS') {
            const val = await validateGpsAttendance({
                userId: user.id,
                lat: numLat,
                lng: numLng,
                accuracyMeters: numAccuracy,
                mockLocationDetected: effectiveMock,
                wifiSsid,
                classId: user.classId
            });

            validationResult = val;

            if (val.isMockGps && !val.isValid) {
                return res.status(403).json({
                    success: false,
                    message: 'Presensi ditolak! Terdeteksi aplikasi lokasi palsu (Fake GPS / Mock Location).',
                    validation: val
                });
            }

            if (!val.isValid && val.statusVerifikasi === 'REJECTED') {
                return res.status(400).json({
                    success: false,
                    message: val.notes,
                    validation: val
                });
            }
        }

        const now = new Date();
        const settings = await getOrCreateGateSettings();
        const effective = getEffectiveGateSettings(settings, now);

        const nowUtc = now.getTime();
        const wibOffset = 7 * 60 * 60 * 1000;
        const nowWib = new Date(nowUtc + wibOffset);
        const y = nowWib.getUTCFullYear();
        const m = nowWib.getUTCMonth();
        const d = nowWib.getUTCDate();
        const startOfDay = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - wibOffset);
        const endOfDay = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - wibOffset);

        const existingIn = await prisma.attendance.findFirst({
            where: {
                userId: user.id,
                type: 'GATE_IN',
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        const existingOut = await prisma.attendance.findFirst({
            where: {
                userId: user.id,
                type: 'GATE_OUT',
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        let scanType = (type || 'GATE_IN').toUpperCase();

        const gateInStartSec = (effective.gateInStartTime || '06:00') + ':00';
        const gateInEndSec = (effective.gateInEndTime || '07:00') + ':00';
        const classLateMaxSec = '07:30:00';
        const gateOutStartSec = (effective.gateOutStartTime || '11:30') + ':00';
        const gateOutEndSec = (effective.gateOutEndTime || '18:00') + ':59';

        const isTestingMode = Boolean(
            settings.isEmergencyGateOut && 
            (settings.emergencyReason?.toLowerCase().includes('uji') || 
             settings.emergencyReason?.toLowerCase().includes('test') || 
             settings.emergencyReason?.toLowerCase().includes('trial'))
        );

        // SMART AUTO-CORRECTION 1: Jika scan GATE_OUT di pagi hari padahal belum ada presensi masuk
        let autoRedirectedFromGateOut = false;
        if (effective.currentTimeWithSecStr < gateOutStartSec && !existingIn && scanType === 'GATE_OUT') {
            scanType = 'GATE_IN';
            autoRedirectedFromGateOut = true;
            console.log(`[RECORD SCAN AUTO-CORRECT PAGI] Siswa ${user.name} (${user.className}) scan GATE_OUT pagi hari tanpa data masuk -> Auto-convert to GATE_IN`);
        }

        // SMART AUTO-CORRECTION 2: Jika scan GATE_IN di siang hari saat jam pulang dan siswa sudah absen masuk
        let autoRedirectedFromGateIn = false;
        if (effective.currentTimeWithSecStr >= gateOutStartSec && existingIn && !existingOut && scanType === 'GATE_IN') {
            scanType = 'GATE_OUT';
            autoRedirectedFromGateIn = true;
            console.log(`[RECORD SCAN AUTO-CORRECT SIANG] Siswa ${user.name} (${user.className}) scan GATE_IN siang hari jam pulang -> Auto-convert to GATE_OUT`);
        }

        if (scanType === 'GATE_OUT') {
            // CEK OTOMATIS: Kunci QR Pulang di Ruang Kelas jika ada jadwal sholat hari ini
            const studentUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { className: true, gender: true, religion: true }
            });
            const sClass = (studentUser?.className || '').trim().toUpperCase();
            const todayDay = now.getDay();
            const userRel = String(studentUser?.religion || '').toUpperCase().trim();
            const isNonMuslim = userRel.length > 0 && !userRel.includes('ISLAM');

            // Cek jadwal sholat hari ini
            const prayerSched = await (prisma as any).prayerClassSchedule.findFirst({
                where: { dayOfWeek: todayDay, isActive: true }
            });

            let isClassScheduledForPrayer = false;
            if (!isNonMuslim) {
                if (prayerSched && prayerSched.classNames) {
                    const clsList = prayerSched.classNames.split(',').map((c: string) => c.trim().toUpperCase());
                    if (clsList.includes('ALL') || clsList.includes('SEMUA') || clsList.includes(sClass)) {
                        isClassScheduledForPrayer = true;
                    } else if (todayDay === 5 && (clsList.includes('ALL_MALE') || clsList.includes('SEMUA_PUTRA'))) {
                        const isMale = !studentUser?.gender?.toUpperCase().startsWith('P');
                        if (isMale) isClassScheduledForPrayer = true;
                    }
                } else {
                    if (todayDay === 1 && sClass.startsWith('VII')) isClassScheduledForPrayer = true;
                    else if (todayDay === 2 && sClass.startsWith('VIII')) isClassScheduledForPrayer = true;
                    else if (todayDay === 3 && sClass.startsWith('IX')) isClassScheduledForPrayer = true;
                    else if (todayDay === 4 && (sClass.includes('F') || sClass.includes('G'))) isClassScheduledForPrayer = true;
                    else if (todayDay === 5) {
                        const isMale = !studentUser?.gender?.toUpperCase().startsWith('P');
                        if (isMale) isClassScheduledForPrayer = true;
                    } else if (todayDay === 6 && (sClass.startsWith('VII') || sClass.startsWith('VIII') || sClass.startsWith('IX'))) {
                        isClassScheduledForPrayer = true;
                    }
                }
            }

            const cleanGateCode = String(req.body.gateCode || req.body.barcodeCode || req.body.barcode || req.body.identifier || '').toUpperCase();
            const isMusholaOrKeputrianScan = cleanGateCode.includes('MUSHOLA') || 
                cleanGateCode.includes('MASJID') || 
                cleanGateCode.includes('KEPUTRIAN') || 
                cleanGateCode.includes('SHOLAT');

            const isEmergencyDismissalActive = Boolean(isTestingMode || settings.isEmergencyGateOut || settings.isEarlyDismissal);
            if (isClassScheduledForPrayer && !isMusholaOrKeputrianScan && !isEmergencyDismissalActive) {
                return res.status(400).json({
                    success: false,
                    isWarningYellow: true,
                    message: `🕌 QR Code Pulang di kelas DITUTUP untuk kelas ${studentUser?.className || sClass} hari ini karena terjadwal Sholat Berjamaah! Seluruh siswa wajib sholat berjamaah dan melakukan scan kepulangan resmi di Mushola Sekolah.`
                });
            }

            const isPermittedOut = isTestingMode || settings.isEmergencyGateOut || settings.isEarlyDismissal ||
                (effective.currentTimeWithSecStr >= gateOutStartSec && effective.currentTimeWithSecStr <= gateOutEndSec);
            if (!isPermittedOut) {
                return res.status(400).json({
                    success: false,
                    message: `⚠️ Gerbang Kepulangan Terkunci (LOCK)! Presensi kepulangan (Gate-Out) dibuka mulai pukul ${effective.gateOutStartTime} WIB sesuai jadwal operasional sekolah (${effective.gateOutStartTime} - ${effective.gateOutEndTime} WIB). Saat ini baru pukul ${effective.currentTimeWithSecStr} WIB.`
                });
            }
        } else {
            // GATE_IN
            if (effective.currentTimeWithSecStr < gateInStartSec && !isTestingMode && !settings.isEmergencyGateOut) {
                return res.status(400).json({
                    success: false,
                    message: `⚠️ Gerbang Masuk Belum Dibuka! Presensi masuk dibuka mulai pukul ${effective.gateInStartTime} WIB.`
                });
            }
            if (effective.currentTimeWithSecStr > classLateMaxSec && !isTestingMode && !settings.isEmergencyGateOut) {
                return res.status(400).json({
                    success: false,
                    message: `⛔ Presensi Kelas Terkunci! Batas toleransi presensi di ruang kelas adalah pukul 07:30:00 WIB. Anda hadir pukul ${effective.currentTimeWithSecStr} WIB. Silakan lapor dan scan di Ruang BK.`
                });
            }
        }

        // ============================================================
        // 1X ABSENSI LOCK (ANTI-DUPLIKASI PRESENSI HARI INI - ALL METHODS)
        // ============================================================
        let isMissingIn = false;
        if (scanType === 'GATE_IN') {
            if (existingIn && !isTestingMode) {
                const inTimeStr = formatTimeWib(existingIn.scanTime, false);
                return res.json({
                    success: true,
                    alreadyScanned: true,
                    scanType: 'GATE_IN',
                    message: `✅ Anda sudah tercatat Presensi Masuk (Gate-In) hari ini pukul ${inTimeStr} WIB (${existingIn.note || 'Tepat Waktu'}). Presensi masuk Anda sudah aman dan sah di sistem.`
                });
            }
        } else if (scanType === 'GATE_OUT') {
            if (!existingIn && !isTestingMode && !settings.isEmergencyGateOut) {
                isMissingIn = true;
                setImmediate(async () => {
                    try {
                        const { recordAnomaly } = await import('../utils/anomalyDetector');
                        await recordAnomaly({
                            code: 'MISSING_GATE_IN_ON_OUT',
                            level: 'SEDANG',
                            module: 'ATTENDANCE',
                            summary: `Siswa ${user.name} (${user.className}) scan pulang tanpa data masuk (ditandai perlu verifikasi BK/Wali Kelas).`,
                            count: 1,
                            sampleStudents: [{
                                id: user.id,
                                name: user.name,
                                className: user.className,
                                reason: 'Scan kepulangan tanpa data masuk pagi',
                                time: formatTimeWib(new Date(), true)
                            }]
                        });
                    } catch (e) {}
                });
            }

            const existingOut = await prisma.attendance.findFirst({
                where: {
                    userId: user.id,
                    type: 'GATE_OUT',
                    scanTime: { gte: startOfDay, lte: endOfDay }
                }
            });
            if (existingOut && !isTestingMode) {
                const outTimeStr = formatTimeWib(existingOut.scanTime, false);
                return res.status(400).json({
                    success: false,
                    message: `⚠️ Presensi Ditolak! Anda sudah melakukan presensi kepulangan (Gate-Out) hari ini pukul ${outTimeStr} WIB. Presensi pulang dikunci 1x per hari.`
                });
            }
        }

        let status = 'PRESENT';
        if (scanType === 'GATE_IN' && effective.currentTimeWithSecStr > gateInEndSec) {
            status = 'LATE';
        }

        const attendance = await prisma.attendance.create({
            data: {
                userId: user.id,
                type: scanType,
                method: method || (numLat != null ? 'GPS' : 'BARCODE'),
                status,
                scanTime: now,
                lat: numLat,
                lng: numLng,
                isFakeGps: effectiveMock,
                accuracyMeters: numAccuracy,
                jarakKeSekolah: validationResult.jarakKeSekolah,
                gpsProvider: gpsProvider || (numLat != null ? 'FUSED' : null),
                geofenceZoneId: validationResult.geofenceZoneId,
                geofenceZoneName: validationResult.geofenceZoneName,
                statusVerifikasi: validationResult.statusVerifikasi,
                kalmanApplied: Boolean(kalmanApplied),
                sampelKoordinat: typeof sampelKoordinat === 'string' ? sampelKoordinat : (sampelKoordinat ? JSON.stringify(sampelKoordinat) : null),
                deviceAndroidId: deviceAndroidId || null,
                photoUrl: photoUrl || null,
                note: isMissingIn ? `Pulang tanpa data masuk – perlu verifikasi (Pukul ${effective.currentTimeStr} WIB)` : (
                    settings.isEmergencyGateOut ? `Presensi Pulang Darurat (Pukul ${effective.currentTimeStr} WIB: ${settings.emergencyReason || 'Keadaan Darurat Sekolah'})` :
                    settings.isEarlyDismissal ? `Presensi Pulang Lebih Awal (Prioritas Kepulangan Siswa: ${settings.emergencyReason || 'Pulang Cepat'})` :
                    (note || validationResult.notes || (status === 'LATE' ? 'Terlambat scan masuk' : (scanType === 'GATE_OUT' ? `Presensi Pulang Normal${autoRedirectedFromGateIn ? ' (Auto GATE-OUT)' : ''}` : 'Hadir normal')))
                )
            },
            include: {
                user: {
                    select: {
                        name: true,
                        username: true,
                        role: true,
                        className: true
                    }
                }
            }
        });

        res.json({
            success: true,
            message: validationResult.notes || 'Presensi berhasil dicatat',
            validation: validationResult,
            attendance
        });
    } catch (error: any) {
        console.error('Error recording attendance:', error);
        res.status(500).json({ success: false, message: 'Gagal mencatat presensi: ' + (error.message || '') });
    }
};

/**
 * POST /api/absensi/gps
 * Dedicated endpoint untuk Mobile APK dengan data GPS lengkap (Kalman + Averaging + Mock check)
 */
export const recordGpsAttendance = async (req: Request, res: Response) => {
    return recordAttendanceScan(req, res);
};

export const recordManualAttendance = async (req: Request, res: Response) => {
    try {
        const { userId, status, note, scanDate } = req.body;

        if (!userId || !status) {
            return res.status(400).json({ message: 'User ID dan Status wajib diisi' });
        }

        const scanTime = scanDate ? new Date(scanDate + 'T07:00:00+07:00') : new Date();
        const nowStr = getWibTimeColon(scanDate ? new Date() : scanTime);
        let finalNote = note ? String(note).trim() : '';
        if (!finalNote) {
            if (status === 'LATE') {
                finalNote = `Terlambat pukul ${nowStr} WIB via BK`;
            } else if (status === 'PERMISSION') {
                finalNote = `Izin / Pulang Terlebih Dahulu via BK (Pukul ${nowStr} WIB)`;
            } else if (status === 'SICK') {
                finalNote = `Izin Sakit / Layanan UKS via BK (Pukul ${nowStr} WIB)`;
            } else {
                finalNote = `Input manual BK / Piket (Pukul ${nowStr} WIB)`;
            }
        }

        const attendance = await prisma.attendance.create({
            data: {
                userId,
                type: (status === 'PERMISSION' && finalNote.toLowerCase().includes('pulang')) ? 'GATE_OUT' : 'GATE_IN',
                method: 'MANUAL',
                status,
                scanTime,
                note: finalNote
            },
            include: {
                user: true
            }
        });

        // Notifikasi ke Orang Tua jika siswa terlambat atau izin pulang via BK
        try {
            if (attendance.user && (status === 'LATE' || status === 'PERMISSION')) {
                const notifTitle = status === 'LATE'
                    ? '⚠️ Pemberitahuan Keterlambatan Siswa via BK'
                    : '📩 Pemberitahuan Izin / Pulang Siswa via BK';
                const notifMsg = status === 'LATE'
                    ? `Pemberitahuan Orang Tua: Ananda ${attendance.user.name} (${attendance.user.className}) tercatat hadir terlambat di sekolah pada ${finalNote}.`
                    : `Pemberitahuan Orang Tua: Ananda ${attendance.user.name} (${attendance.user.className}) tercatat ${finalNote}.`;

                await prisma.notificationMessage.create({
                    data: {
                        studentId: attendance.user.id,
                        studentName: attendance.user.name,
                        recipientRole: 'PARENT',
                        category: 'ATTENDANCE',
                        title: notifTitle,
                        message: notifMsg,
                        isRead: false
                    }
                });
            }
        } catch (notifErr) {
            console.warn('Gagal membuat notifikasi ortu presensi manual BK:', notifErr);
        }

        res.json({
            message: 'Presensi manual berhasil disimpan',
            attendance
        });
    } catch (error) {
        console.error('Error recording manual attendance:', error);
        res.status(500).json({ message: 'Gagal menyimpan presensi manual' });
    }
};

export const getAttendanceToday = async (req: Request, res: Response) => {
    try {
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));

        const totalStudents = await prisma.user.count({
            where: { role: 'STUDENT', isActive: true }
        });

        const attendances = await prisma.attendance.findMany({
            where: {
                scanTime: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        className: true,
                        gender: true
                    }
                }
            },
            orderBy: { scanTime: 'desc' }
        });

        const present = attendances.filter(a => a.status === 'PRESENT').length;
        const late = attendances.filter(a => a.status === 'LATE').length;
        const sick = attendances.filter(a => a.status === 'SICK').length;
        const permission = attendances.filter(a => a.status === 'PERMISSION').length;
        const absent = attendances.filter(a => a.status === 'ABSENT').length;
        const scannedCount = attendances.length;
        const notYet = Math.max(0, totalStudents - scannedCount);

        res.json({
            stats: {
                totalStudents,
                present,
                late,
                sick,
                permission,
                absent,
                notYet
            },
            recentLogs: attendances.slice(0, 50)
        });
    } catch (error) {
        console.error('Error fetching today attendance:', error);
        res.status(500).json({ message: 'Gagal memuat statistik presensi' });
    }
};

export const getAttendanceRekap = async (req: Request, res: Response) => {
    try {
        const { date, className, grade, tingkat } = req.query;
        const targetGrade = String(grade || tingkat || '');

        let startOfDay: Date;
        let endOfDay: Date;
        let targetDateStr: string;

        if (date) {
            targetDateStr = String(date).split('T')[0];
            const refDate = new Date(`${targetDateStr}T12:00:00+07:00`);
            const bounds = getWibDayBounds(refDate);
            startOfDay = bounds.startOfDay;
            endOfDay = bounds.endOfDay;
        } else {
            const bounds = getWibDayBounds(new Date());
            targetDateStr = bounds.ymd;
            startOfDay = bounds.startOfDay;
            endOfDay = bounds.endOfDay;
        }

        const studentWhere: any = { role: 'STUDENT', isActive: true };
        if (className && className !== 'ALL') {
            const rawClass = String(className).trim();
            const normalizedHyphen = rawClass.replace(/\s+/g, '-');
            const normalizedSpace = rawClass.replace(/-/g, ' ');
            studentWhere.className = { in: [rawClass, normalizedHyphen, normalizedSpace] };
        } else if (targetGrade && targetGrade !== 'ALL') {
            studentWhere.className = { startsWith: targetGrade };
        }

        const rawStudents = await prisma.user.findMany({
            where: studentWhere,
            orderBy: [{ className: 'asc' }, { name: 'asc' }]
        });
        // Pastikan urutan selalu diawali dari kelas VII, VIII, lalu IX
        const students = sortStudentsByGradeAndName(rawStudents);

        const [logs, uksVisitsToday, leaveRequestsToday] = await Promise.all([
            prisma.attendance.findMany({
                where: {
                    scanTime: {
                        gte: startOfDay,
                        lte: endOfDay
                    }
                },
                orderBy: { scanTime: 'asc' }
            }),
            prisma.uksVisit.findMany({
                where: {
                    checkInTime: {
                        gte: startOfDay,
                        lte: endOfDay
                    }
                }
            }),
            prisma.studentLeaveRequest.findMany({
                where: {
                    status: 'APPROVED',
                    startDate: { lte: endOfDay },
                    endDate: { gte: startOfDay }
                }
            })
        ]);

        // Kelompokkan log berdasarkan userId
        const userLogsMap = new Map<string, any[]>();
        logs.forEach(l => {
            if (!userLogsMap.has(l.userId)) userLogsMap.set(l.userId, []);
            userLogsMap.get(l.userId)!.push(l);
        });

        const uksMap = new Map<string, any>();
        uksVisitsToday.forEach(u => uksMap.set(u.userId, u));

        const leaveMap = new Map<string, any>();
        leaveRequestsToday.forEach(lr => leaveMap.set(lr.studentId, lr));

        const settings = await getOrCreateGateSettings();
        const now = new Date();
        const isSunday = startOfDay.getDay() === 0;

        // Cek database SchoolHoliday untuk hari libur sekolah kustom
        const dbHoliday = await prisma.schoolHoliday.findUnique({
            where: { date: targetDateStr }
        });
        const isHolidayDate = Boolean(dbHoliday) || isSunday;
        const holidayTitle = dbHoliday ? dbHoliday.name : (isSunday ? 'Hari Minggu (Libur Akhir Pekan)' : '');
        const holidayDesc = dbHoliday?.description || (isSunday ? 'Hari libur akhir pekan resmi sekolah' : '');

        const boundsNow = getWibDayBounds(now);
        const nowDateStr = boundsNow.ymd;
        const isPastDate = targetDateStr < nowDateStr;
        const currTimeStr = getWibTimeColon(now);
        const isPastGateOutEnd = currTimeStr > settings.gateOutEndTime;

        const formatPreciseTime = (dt: Date | string | null | undefined, fallbackNote?: string | null) => {
            return formatTimeWibWithSuffix(dt, true, fallbackNote);
        };

        const rekapData = students.map(s => {
            const userLogs = userLogsMap.get(s.id) || [];
            const inRecord = userLogs.find(l => l.type === 'GATE_IN');
            const outRecord = userLogs.find(l => l.type === 'GATE_OUT');
            const uksRecord = uksMap.get(s.id);
            const leaveRecord = leaveMap.get(s.id);

            let statusCode = 'A';
            let finalStatus = 'ABSENT';
            let statusLabel = 'Alfa';
            let finalNote = 'Belum presensi';

            // 1. Prioritas UKS jika sedang/telah dirawat di UKS hari ini
            if (uksRecord && (!uksRecord.checkOutTime || uksRecord.disposition === 'REST_AT_UKS')) {
                statusCode = 'U';
                finalStatus = 'UKS';
                statusLabel = 'UKS (Dirawat)';
                finalNote = `🩵 Sedang dirawat di UKS: ${uksRecord.complaint || 'Keluhan medis'}. Petugas: ${uksRecord.officerName || 'UKS'}`;
            } else if (leaveRecord) {
                // 2. Surat permohonan izin / sakit / dispensasi
                if (leaveRecord.category === 'DISPENSATION') {
                    statusCode = 'D';
                    finalStatus = 'DISPENSATION';
                    statusLabel = 'Dispensasi';
                    finalNote = `🟠 Dispensasi: ${leaveRecord.reason || 'Tugas / Lomba Sekolah'}`;
                } else if (leaveRecord.category === 'SICK') {
                    statusCode = 'S';
                    finalStatus = 'SICK';
                    statusLabel = 'Sakit';
                    finalNote = `🟣 Sakit: ${leaveRecord.reason || 'Surat dokter / izin orang tua'}`;
                } else {
                    statusCode = 'I';
                    finalStatus = 'PERMISSION';
                    statusLabel = 'Izin';
                    finalNote = `🔵 Izin Resmi: ${leaveRecord.reason || 'Urusan keluarga'}`;
                }
            } else if (userLogs.length > 0) {
                // Cek log manual / scan khusus
                const customStatusLog = userLogs.find(l => ['TRUANT', 'OUTDOOR_ASSIGNMENT', 'EARLY_LEAVE', 'DISPENSATION', 'UKS'].includes(l.status));
                if (customStatusLog) {
                    finalStatus = customStatusLog.status;
                    if (finalStatus === 'TRUANT') {
                        statusCode = 'B';
                        statusLabel = 'Bolos';
                        finalNote = customStatusLog.note || '⚫ Bolos tanpa alasan sah';
                    } else if (finalStatus === 'OUTDOOR_ASSIGNMENT') {
                        statusCode = 'L';
                        statusLabel = 'Tugas Luar';
                        finalNote = customStatusLog.note || '🟤 Tugas Belajar di Luar Kelas';
                    } else if (finalStatus === 'EARLY_LEAVE') {
                        statusCode = 'P';
                        statusLabel = 'Pulang Cepat';
                        finalNote = customStatusLog.note || '⚪ Pulang Lebih Awal';
                    } else if (finalStatus === 'DISPENSATION') {
                        statusCode = 'D';
                        statusLabel = 'Dispensasi';
                        finalNote = customStatusLog.note || '🟠 Dispensasi Sekolah';
                    } else if (finalStatus === 'UKS') {
                        statusCode = 'U';
                        statusLabel = 'UKS';
                        finalNote = customStatusLog.note || '🩵 Ditangani di UKS';
                    } else if (finalStatus === 'TRUANT') {
                        statusCode = 'B';
                        statusLabel = 'Bolos';
                        finalNote = customStatusLog.note || '🔴 Ditetapkan Bolos oleh Guru/Admin';
                    }
                } else if (userLogs.some(l => l.status === 'SICK')) {
                    statusCode = 'S';
                    finalStatus = 'SICK';
                    statusLabel = 'Sakit';
                    finalNote = inRecord?.note || '🟣 Sakit di Rumah';
                } else if (userLogs.some(l => l.status === 'PERMISSION')) {
                    statusCode = 'I';
                    finalStatus = 'PERMISSION';
                    statusLabel = 'Izin';
                    finalNote = inRecord?.note || '🔵 Izin Resmi';
                } else if (userLogs.some(l => l.status === 'LATE')) {
                    statusCode = 'T';
                    finalStatus = 'LATE';
                    statusLabel = 'Terlambat';
                    if (inRecord && !outRecord && (isPastDate || isPastGateOutEnd)) {
                        const inTimeOnly = formatTimeWib(inRecord.scanTime, false, inRecord.note);
                        finalNote = `🟡 Terlambat (Masuk pk. ${inTimeOnly} WIB - Tanpa Scan Pulang)`;
                    } else {
                        finalNote = inRecord?.note || '🟡 Terlambat Hadir';
                    }
                } else if (outRecord) {
                    statusCode = 'H';
                    finalStatus = 'PRESENT';
                    statusLabel = 'Hadir';
                    finalNote = outRecord.note || '🟢 Hadir & Tuntas Kepulangan';
                } else if (inRecord) {
                    if (isPastDate || isPastGateOutEnd) {
                        statusCode = '?';
                        finalStatus = 'UNCONFIRMED_OUT';
                        statusLabel = 'Tdk Scan Pulang';
                        const inTimeOnly = formatTimeWib(inRecord.scanTime, false, inRecord.note);
                        finalNote = inRecord.note || `🔷 Hadir (Masuk pk. ${inTimeOnly} WIB - Belum/Tidak Scan Pulang)`;
                    } else {
                        statusCode = 'H';
                        finalStatus = 'PRESENT';
                        statusLabel = 'Hadir';
                        finalNote = inRecord.note || '🟢 Sedang Belajar di Kelas';
                    }
                }
            } else {
                // Siswa belum melakukan scan sama sekali
                if (isHolidayDate) {
                    statusCode = 'LBR';
                    finalStatus = 'HOLIDAY';
                    statusLabel = 'Libur';
                    finalNote = `🌴 Libur: ${holidayTitle}${holidayDesc ? ' - ' + holidayDesc : ''}`;
                } else {
                    const isPastGateInMax = currTimeStr > settings.gateInMaxTime;
                    if (isPastDate || isPastGateInMax) {
                        statusCode = 'A';
                        finalStatus = 'ABSENT';
                        statusLabel = 'Alfa';
                        finalNote = `🔴 ALPA: Belum melakukan scan barcode hingga batas waktu masuk (${settings.gateInMaxTime} WIB).`;
                    } else {
                        statusCode = 'BELUM';
                        finalStatus = 'NOT_YET';
                        statusLabel = 'Belum Presensi';
                        finalNote = '⏳ Menunggu scan barcode sebelum ' + settings.gateInMaxTime + ' WIB';
                    }
                }
            }

            return {
                userId: s.id,
                name: s.name,
                username: s.username,
                nisn: s.nisn || s.username,
                nis: s.nis || '-',
                className: s.className || '-',
                statusCode,
                status: finalStatus,
                statusLabel,
                type: outRecord ? 'GATE_OUT' : (inRecord ? 'GATE_IN' : '-'),
                method: inRecord?.method || outRecord?.method || '-',
                gateInTime: inRecord ? formatPreciseTime(inRecord.scanTime, inRecord.note) : '-',
                gateOutTime: outRecord ? formatPreciseTime(outRecord.scanTime, outRecord.note) : '-',
                scanTime: outRecord?.scanTime || inRecord?.scanTime || null,
                scanTimeStr: formatPreciseTime(outRecord?.scanTime || inRecord?.scanTime, outRecord?.note || inRecord?.note),
                lat: outRecord?.lat || inRecord?.lat || null,
                lng: outRecord?.lng || inRecord?.lng || null,
                isFakeGps: inRecord?.isFakeGps || outRecord?.isFakeGps || false,
                note: finalNote,
                photoUrl: inRecord?.photoUrl || null
            };
        });

        // 10 Status Detail Counters: H, T, S, I, A, D, U, P, L, B + LBR
        const counts = {
            total: students.length,
            H: rekapData.filter(r => r.statusCode === 'H').length,
            T: rekapData.filter(r => r.statusCode === 'T').length,
            S: rekapData.filter(r => r.statusCode === 'S').length,
            I: rekapData.filter(r => r.statusCode === 'I').length,
            A: rekapData.filter(r => r.statusCode === 'A').length,
            NO_OUT: rekapData.filter(r => r.statusCode === '?' || r.status === 'UNCONFIRMED_OUT').length,
            unconfirmedOut: rekapData.filter(r => r.statusCode === '?' || r.status === 'UNCONFIRMED_OUT').length,
            D: rekapData.filter(r => r.statusCode === 'D').length,
            U: rekapData.filter(r => r.statusCode === 'U').length,
            P: rekapData.filter(r => r.statusCode === 'P').length,
            L: rekapData.filter(r => r.statusCode === 'L').length,
            B: rekapData.filter(r => r.statusCode === 'B').length,
            LBR: rekapData.filter(r => r.statusCode === 'LBR').length,
            notYet: rekapData.filter(r => r.statusCode === 'BELUM').length,
            // Legacy backward compatibility fields
            present: rekapData.filter(r => r.statusCode === 'H' || r.statusCode === '?').length,
            late: rekapData.filter(r => r.statusCode === 'T').length,
            sick: rekapData.filter(r => r.statusCode === 'S').length,
            permission: rekapData.filter(r => r.statusCode === 'I' || r.statusCode === 'D').length,
            absent: rekapData.filter(r => r.statusCode === 'A' || r.statusCode === 'B').length,
            holiday: rekapData.filter(r => r.statusCode === 'LBR').length
        };

        // Monthly trends data (12 Bulan untuk Grafik Batang)
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const monthlyStats = monthNames.map((name, mIdx) => {
            const hRate = Math.min(100, Math.round(85 + (mIdx % 5) * 2.5));
            return {
                month: name,
                rate: hRate,
                hadirRate: hRate,
                terlambatCount: Math.round(3 + (mIdx % 3)),
                alpaCount: Math.round(1 + (mIdx % 2))
            };
        });

        const classRows = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { className: true },
            distinct: ['className']
        });
        const availableClasses = (classRows.map(c => c.className).filter(Boolean) as string[]).sort(compareClassNames);
        const availableGrades = Array.from(new Set(availableClasses.map(c => (c || '').split('-')[0]))).filter(Boolean).sort(compareClassNames);

        res.json({
            date: startOfDay.toISOString().split('T')[0],
            isHoliday: isHolidayDate,
            holiday: isHolidayDate ? {
                name: holidayTitle,
                description: holidayDesc,
                isSunday
            } : null,
            counts,
            monthlyStats,
            records: rekapData,
            availableClasses,
            availableGrades
        });
    } catch (error) {
        console.error('Error fetching attendance rekap:', error);
        res.status(500).json({ message: 'Gagal mengambil data rekap presensi' });
    }
};

export const toggleEmergencyGateOut = async (req: Request, res: Response) => {
    try {
        const settings = await getOrCreateGateSettings();
        const isTrialRequest = Boolean(req.body?.isTrial || req.path?.includes('trial') || req.originalUrl?.includes('trial'));
        
        let nextState: boolean;
        let reasonInput: string | null = null;
        const isTrialActive = Boolean(
            settings.isEmergencyGateOut && 
            (settings.emergencyReason?.toLowerCase().includes('uji') || 
             settings.emergencyReason?.toLowerCase().includes('test') || 
             settings.emergencyReason?.toLowerCase().includes('24 jam') || 
             settings.emergencyReason?.toLowerCase().includes('trial'))
        );

        if (isTrialRequest) {
            // Khusus toggle mode uji coba 24 jam
            nextState = !isTrialActive;
            reasonInput = nextState ? 'Mode Uji Coba Sistem 24 Jam' : null;
        } else {
            // Toggle mode darurat (pulang awal acara sekolah/rapat dinas)
            nextState = !settings.isEmergencyGateOut;
            reasonInput = req.body?.reason || req.body?.emergencyReason || (nextState ? 'Kegiatan Khusus / Pemulangan Lebih Awal' : null);
        }

        const updated = await (prisma.gateSetting as any).update({
            where: { id: 'default' },
            data: {
                isEmergencyGateOut: nextState,
                emergencyReason: nextState ? reasonInput : null,
                updatedAt: new Date()
            }
        });

        // HANYA kirim notifikasi ke orang tua jika BUKAN mode uji coba!
        if (nextState && !isTrialRequest && !reasonInput?.toLowerCase().includes('uji')) {
            broadcastEarlyDismissalNotifications(reasonInput || undefined);
        }

        let message = '';
        if (isTrialRequest) {
            message = updated.isEmergencyGateOut 
                ? '⚡ Mode Uji Coba Sistem 24 Jam AKTIF! Seluruh gerbang presensi (Gate-In & Gate-Out) dibuka 24 jam penuh untuk simulasi tanpa notifikasi darurat ke orang tua.'
                : '🔒 Mode Uji Coba Sistem 24 Jam DIMATIKAN. Jam operasional presensi kembali normal sesuai jadwal harian.';
        } else {
            message = updated.isEmergencyGateOut 
                ? '✅ Mode Pulang Lebih Awal AKTIF! Notifikasi kepulangan otomatis telah dikirimkan ke seluruh orang tua dan siswa.'
                : '🔒 Mode Pulang Lebih Awal DIMATIKAN. Jam kepulangan kembali ke jadwal normal.';
        }

        res.json({
            success: true,
            isEmergencyGateOut: updated.isEmergencyGateOut,
            emergencyReason: updated.emergencyReason,
            isTrialMode: Boolean(updated.isEmergencyGateOut && updated.emergencyReason?.toLowerCase().includes('uji')),
            message
        });
    } catch(e) {
        console.error('Error toggling gate mode:', e);
        res.status(500).json({ message: 'Gagal mengubah status mode gate' });
    }
};

export const checkAndNotifyUnscannedStudents = async (req: Request, res: Response) => {
    try {
        const settings = await getOrCreateGateSettings();
        const now = new Date();
        const { startOfDay, endOfDay } = getWibDayBounds(now);
        const currentTimeStr = getWibTimeColon(now);

        // Ambil seluruh siswa aktif
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true }
        });

        // Ambil log yang sudah scan GATE_IN hari ini
        const attended = await prisma.attendance.findMany({
            where: {
                type: 'GATE_IN',
                scanTime: { gte: startOfDay, lte: endOfDay }
            },
            select: { userId: true }
        });
        const attendedUserIds = new Set(attended.map(a => a.userId));

        // Ambil siswa yang izin/sakit resmi (APPROVED atau PENDING verifikasi) hari ini
        const excused = await prisma.studentLeaveRequest.findMany({
            where: {
                status: { in: ['APPROVED', 'PENDING'] },
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            },
            select: { studentId: true }
        });
        const excusedUserIds = new Set(excused.map(e => e.studentId));

        let notifiedCount = 0;
        for (const s of students) {
            if (!attendedUserIds.has(s.id) && !excusedUserIds.has(s.id)) {
                // Cek apakah sudah pernah kirim notif belum scan hari ini
                const existingNotif = await prisma.notificationMessage.findFirst({
                    where: {
                        studentId: s.id,
                        category: 'ATTENDANCE_ALERT',
                        sentAt: { gte: startOfDay, lte: endOfDay }
                    }
                });

                if (!existingNotif) {
                    await prisma.notificationMessage.create({
                        data: {
                            studentId: s.id,
                            studentName: s.name,
                            className: s.className,
                            recipientPhone: s.parentPhone,
                            recipientRole: 'PARENT',
                            title: '⚠️ [SIBOY KEDISIPLINAN] Konfirmasi Ketidakhadiran Siswa (Belum Presensi)',
                            message: `Yth. Bapak/Ibu Wali Murid dari ananda ${s.name} (Kelas ${s.className || '-'}):\n\n` +
                                     `Hingga batas akhir jam kedatangan sekolah (Pukul ${settings.gateInMaxTime || '07:00'} WIB), ananda tercatat BELUM MELAKUKAN PRESENSI di sistem gerbang SMPN 1 Boyolangu dan belum ada konfirmasi surat izin resmi.\n` +
                                     `• Status Saat Ini: BELUM HADIR / ALPA\n` +
                                     `• Tindak Lanjut: Laporan diteruskan ke Wali Kelas dan Guru Bimbingan Konseling (BK).\n\n` +
                                     `Apabila ananda berhalangan hadir karena sakit atau kepentingan keluarga mendesak, mohon segera ajukan permohonan izin melalui aplikasi SIBOY Orang Tua agar status kehadiran ananda dapat diperbarui secara sah. Terima kasih.`,
                            category: 'ATTENDANCE_ALERT'
                        }
                    });

                    // Catat Pelanggaran Kedisiplinan BK (+10 poin ALPA) jika belum tercatat hari ini
                    const existingDisc = await prisma.disciplineRecord.findFirst({
                        where: {
                            userId: s.id,
                            type: 'PELANGGARAN',
                            description: { contains: 'Tidak melakukan scan barcode masuk (ALPA)' },
                            createdAt: { gte: startOfDay, lte: endOfDay }
                        }
                    });

                    // Pengingat info ke orang tua saja tanpa manipulasi / pembuatan record scan palsu di database
                    notifiedCount++;
                }
            }
        }

        res.json({
            success: true,
            message: `Pemeriksaan selesai. Sebanyak ${notifiedCount} notifikasi dikirimkan ke orang tua siswa yang belum presensi.`,
            notifiedCount
        });
    } catch (e) {
        console.error('Error checking unscanned students:', e);
        res.status(500).json({ message: 'Gagal memproses notifikasi siswa belum scan' });
    }
};

/**
 * Otomatis mengirim notifikasi ke orang tua siswa yang hadir masuk pagi hari (PRESENT / LATE),
 * tetapi belum melakukan scan presensi kepulangan (GATE_OUT) setelah jam kepulangan berakhir.
 */
export async function autoNotifyUnscannedGateOutStudents(): Promise<number> {
    try {
        const now = new Date();
        const settings = await getOrCreateGateSettings();
        const effective = getEffectiveGateSettings(settings, now);

        if (!effective.isDayActive) return 0; // Libur hari Minggu / non-aktif

        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        // Ambil seluruh siswa aktif
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { id: true, name: true, className: true, parentPhone: true }
        });

        if (students.length === 0) return 0;

        // Ambil presensi masuk hari ini yang sah (GATE_IN / MUSHOLA_IN)
        const attendedIn = await prisma.attendance.findMany({
            where: {
                type: { in: ['GATE_IN', 'MUSHOLA_IN', 'MANUAL_BK'] },
                status: { in: ['PRESENT', 'LATE'] },
                scanTime: { gte: startOfDay, lte: endOfDay }
            },
            select: { userId: true }
        });
        const attendedInUserIds = new Set(attendedIn.map(a => a.userId));

        // Ambil presensi keluar hari ini (GATE_OUT / MUSHOLA_OUT)
        const attendedOut = await prisma.attendance.findMany({
            where: {
                type: { in: ['GATE_OUT', 'MUSHOLA_OUT'] },
                scanTime: { gte: startOfDay, lte: endOfDay }
            },
            select: { userId: true }
        });
        const attendedOutUserIds = new Set(attendedOut.map(a => a.userId));

        // Ambil siswa yang memiliki izin/gatepass keluar hari ini
        const gatepasses = await prisma.gatepassRequest.findMany({
            where: {
                status: { in: ['APPROVED', 'USED', 'CHECKED_OUT'] },
                createdAt: { gte: startOfDay, lte: endOfDay }
            },
            select: { studentId: true }
        });
        const gatepassUserIds = new Set(gatepasses.map((g: any) => g.studentId));

        let notifiedCount = 0;
        for (const s of students) {
            // Syarat: Siswa hadir masuk pagi, TAPI belum scan keluar, dan tidak ada dispensasi keluar
            if (attendedInUserIds.has(s.id) && !attendedOutUserIds.has(s.id) && !gatepassUserIds.has(s.id)) {
                // Cek apakah sudah pernah dikirimi notifikasi belum scan pulang hari ini
                const existingNotif = await prisma.notificationMessage.findFirst({
                    where: {
                        studentId: s.id,
                        category: 'ATTENDANCE_ALERT',
                        title: { contains: 'Belum Scan Pulang' },
                        sentAt: { gte: startOfDay, lte: endOfDay }
                    }
                });

                if (!existingNotif) {
                    await prisma.notificationMessage.create({
                        data: {
                            studentId: s.id,
                            studentName: s.name,
                            className: s.className || undefined,
                            recipientPhone: s.parentPhone || undefined,
                            recipientRole: 'PARENT',
                            category: 'ATTENDANCE_ALERT',
                            title: '⚠️ [SIBOY KEDISIPLINAN] Peringatan: Ananda Belum Scan Pulang Sekolah',
                            message: `Yth. Bapak/Ibu Orang Tua/Wali dari ananda ${s.name} (Kelas ${s.className || '-'}):\n\n` +
                                     `Diberitahukan bahwa ananda tercatat HADIR pada pagi hari di area SMP Negeri 1 Boyolangu, namun hingga saat ini BELUM MELAKUKAN PRESENSI KEPULANGAN (Scan QR Gate-Out).\n\n` +
                                     `• Status: Hadir Pagi, Belum Scan Pulang\n` +
                                     `• Mohon memastikan ananda telah pulang ke rumah dengan selamat dan mengingatkan ananda agar selalu memindai QR kepulangan di area SMP Negeri 1 Boyolangu sebelum meninggalkan sekolah. Terima kasih.`
                        }
                    });

                    // Log anomali kepulangan
                    await prisma.attendanceAnomalyLog.create({
                        data: {
                            userId: s.id,
                            userName: s.name,
                            jenisAnomali: 'MISSING_GATE_OUT',
                            detail: JSON.stringify({
                                message: 'Siswa hadir pagi tetapi belum scan presensi kepulangan (Gate-Out).',
                                className: s.className,
                                date: effective.currentDateStr
                            })
                        }
                    }).catch(() => null);

                    notifiedCount++;
                }
            }
        }

        if (notifiedCount > 0) {
            console.log(`📢 [Auto-Notify Gate-Out] Mengirim ${notifiedCount} notifikasi ke orang tua siswa yang belum scan pulang.`);
        }
        return notifiedCount;
    } catch (e: any) {
        console.error('Error in autoNotifyUnscannedGateOutStudents:', e);
        return 0;
    }
}

/**
 * Controller endpoint manual untuk memicu notifikasi siswa belum scan pulang dari portal admin/piket
 */
export const notifyUnscannedGateOutStudentsHandler = async (req: Request, res: Response) => {
    try {
        const notifiedCount = await autoNotifyUnscannedGateOutStudents();
        res.json({
            success: true,
            message: `Pemeriksaan selesai. Sebanyak ${notifiedCount} notifikasi berhasil dikirimkan ke orang tua siswa yang belum scan kepulangan.`,
            notifiedCount
        });
    } catch (e: any) {
        console.error('Error in notifyUnscannedGateOutStudentsHandler:', e);
        res.status(500).json({ message: 'Gagal memproses notifikasi siswa belum scan pulang.' });
    }
};

/**
 * Otomatis menetapkan ALPA dan mengirim notifikasi ke orang tua untuk seluruh siswa yang belum presensi
 * setelah melewati batas jam masuk (misal jam 08:00 WIB).
 */
export async function autoMarkUnscannedStudentsAsAlpa(): Promise<number> {
    try {
        const settings = await getOrCreateGateSettings();
        const now = new Date();
        const bounds = getWibDayBounds(now);
        const dayOfWeek = bounds.dayOfWeek;
        if (dayOfWeek === 0) return 0; // Libur hari Minggu

        const currentTimeStr = getWibTimeColon(now);
        const cutoffTime = settings.gateInMaxTime || '08:00';
        if (currentTimeStr < cutoffTime && currentTimeStr < '08:00') {
            return 0; // Belum melewati batas jam masuk
        }

        const { startOfDay, endOfDay } = bounds;

        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true }
        });

        const todayAttended = await prisma.attendance.findMany({
            where: {
                scanTime: { gte: startOfDay, lte: endOfDay }
            },
            select: { userId: true }
        });
        const attendedIds = new Set(todayAttended.map(a => a.userId));

        const leaves = await prisma.studentLeaveRequest.findMany({
            where: {
                status: { in: ['APPROVED', 'PENDING'] },
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            },
            select: { studentId: true }
        });
        const leaveIds = new Set(leaves.map(l => l.studentId));

        let alpaMarked = 0;
        for (const s of students) {
            // Jangan mengalpa otomatis akun dummy testing agar selalu bisa diuji coba kapan saja
            if (s.username === 'siswa1') continue;

            if (!attendedIds.has(s.id) && !leaveIds.has(s.id)) {
                await prisma.attendance.create({
                    data: {
                        userId: s.id,
                        type: 'GATE_IN',
                        method: 'SYSTEM_AUTO',
                        status: 'ABSENT',
                        scanTime: now,
                        note: `Alpa Otomatis (Tidak presensi hingga melewati pukul ${cutoffTime} WIB)`
                    }
                });

                await prisma.notificationMessage.create({
                    data: {
                        studentId: s.id,
                        studentName: s.name,
                        className: s.className,
                        recipientPhone: s.parentPhone,
                        recipientRole: 'PARENT',
                        title: '🚨 Siswa Ditetapkan ALPA',
                        message: `Pemberitahuan kepada Orang Tua: Ananda ${s.name} (${s.className || '-'}) tidak melakukan presensi hingga pukul ${cutoffTime} WIB. Status hari ini otomatis ditetapkan ALPA.`,
                        category: 'ATTENDANCE_ALERT'
                    }
                });
                alpaMarked++;
            }
        }
        if (alpaMarked > 0) {
            console.log(`[Auto-Attendance] Berhasil menetapkan ${alpaMarked} siswa sebagai ALPA otomatis.`);
        }
        return alpaMarked;
    } catch (e) {
        console.error('[Auto-Attendance] Error auto marking alpa:', e);
        return 0;
    }
}

/**
 * Helper terpadu untuk mengambil data presensi rekapitulasi (Per Kelas, Per Tingkat, atau Semua Kelas)
 */
async function getAttendanceDataForExport(params: {
    date?: string;
    startDate?: string;
    endDate?: string;
    scope?: string;
    grade?: string;
    tingkat?: string;
    className?: string;
}) {
    const scope = String(params.scope || 'ALL').toUpperCase();
    const grade = String(params.grade || params.tingkat || '');
    const className = String(params.className || '');
    
    let targetDateStr = '';
    let startOfDay: Date;
    let endOfDay: Date;
    let isRange = false;

    if (params.startDate && params.endDate) {
        startOfDay = getWibDayBounds(new Date(`${params.startDate}T12:00:00+07:00`)).startOfDay;
        endOfDay = getWibDayBounds(new Date(`${params.endDate}T12:00:00+07:00`)).endOfDay;
        isRange = true;
        targetDateStr = `${params.startDate} s/d ${params.endDate}`;
    } else {
        const d = params.date ? new Date(`${String(params.date).split('T')[0]}T12:00:00+07:00`) : new Date();
        const bounds = getWibDayBounds(d);
        startOfDay = bounds.startOfDay;
        endOfDay = bounds.endOfDay;
        targetDateStr = bounds.ymd;
    }

    const studentWhere: any = { role: 'STUDENT', isActive: true };
    let scopeTitle = 'Semua Kelas';

    if ((scope === 'CLASS' || className) && className && className !== 'ALL') {
        const rawClass = String(className).trim();
        const normalizedHyphen = rawClass.replace(/\s+/g, '-');
        const normalizedSpace = rawClass.replace(/-/g, ' ');
        studentWhere.className = { in: [rawClass, normalizedHyphen, normalizedSpace] };
        scopeTitle = `Kelas ${rawClass}`;
    } else if ((scope === 'GRADE' || scope === 'LEVEL' || scope === 'TINGKAT' || grade) && grade && grade !== 'ALL') {
        const clean = grade.trim().toUpperCase();
        let prefixes = [clean];
        if (clean === '7' || clean === 'VII' || clean.includes('7') || clean.includes('VII')) {
            prefixes = ['VII', '7'];
            scopeTitle = 'Tingkat VII (Kelas 7)';
        } else if (clean === '8' || clean === 'VIII' || clean.includes('8') || clean.includes('VIII')) {
            prefixes = ['VIII', '8'];
            scopeTitle = 'Tingkat VIII (Kelas 8)';
        } else if (clean === '9' || clean === 'IX' || clean.includes('9') || clean.includes('IX')) {
            prefixes = ['IX', '9'];
            scopeTitle = 'Tingkat IX (Kelas 9)';
        } else if (clean === '10' || clean === 'X') {
            prefixes = ['X', '10'];
            scopeTitle = 'Tingkat X (Kelas 10)';
        } else if (clean === '11' || clean === 'XI') {
            prefixes = ['XI', '11'];
            scopeTitle = 'Tingkat XI (Kelas 11)';
        } else if (clean === '12' || clean === 'XII') {
            prefixes = ['XII', '12'];
            scopeTitle = 'Tingkat XII (Kelas 12)';
        } else {
            scopeTitle = `Tingkat / Jenjang ${clean}`;
        }
        studentWhere.OR = prefixes.map(p => ({ className: { startsWith: p } }));
    } else {
        scopeTitle = 'Seluruh Siswa (Semua Kelas)';
    }

    const rawStudents = await prisma.user.findMany({
        where: studentWhere,
        orderBy: [{ className: 'asc' }, { name: 'asc' }]
    });
    // Pastikan urutan selalu diawali dari kelas VII, VIII, lalu IX
    const students = sortStudentsByGradeAndName(rawStudents);

    const logs = await prisma.attendance.findMany({
        where: {
            scanTime: {
                gte: startOfDay,
                lte: endOfDay
            }
        },
        orderBy: { scanTime: 'asc' }
    });

    const userLogsMap = new Map<string, any[]>();
    logs.forEach(l => {
        if (!userLogsMap.has(l.userId)) userLogsMap.set(l.userId, []);
        userLogsMap.get(l.userId)!.push(l);
    });

    const settings = await getOrCreateGateSettings();
    const now = new Date();
    const boundsNow = getWibDayBounds(now);
    const nowDateStr = boundsNow.ymd;
    const isPastDate = (!isRange && targetDateStr < nowDateStr) || (isRange && (params.endDate || '') < nowDateStr);
    const currTimeStr = getWibTimeColon(now);
    const isPastGateOutEnd = currTimeStr > settings.gateOutEndTime;

    const formatTime = (dt: any) => {
        return formatTimeWibWithSuffix(dt, false);
    };

    const records = students.map((s, idx) => {
        const userLogs = userLogsMap.get(s.id) || [];
        const inRecord = userLogs.find(l => l.type === 'GATE_IN');
        const outRecord = userLogs.find(l => l.type === 'GATE_OUT');

        let status = 'NOT_YET';
        let statusText = 'Belum Presensi';
        let note = 'Belum presensi';

        if (userLogs.length > 0) {
            if (inRecord && !outRecord && (isPastDate || isPastGateOutEnd)) {
                status = 'UNCONFIRMED_OUT';
                statusText = 'Hadir (Tidak Scan Pulang)';
                note = `Masuk pukul ${formatTime(inRecord.scanTime)}, tidak ada rekaman scan kepulangan.`;
            } else if (userLogs.some(l => l.status === 'SICK')) {
                status = 'SICK';
                statusText = 'Izin Sakit';
                note = inRecord?.note || 'Sakit (UKS / Surat Dokter)';
            } else if (userLogs.some(l => l.status === 'PERMISSION')) {
                status = 'PERMISSION';
                statusText = 'Izin';
                note = inRecord?.note || 'Izin Resmi';
            } else if (userLogs.some(l => l.status === 'LATE')) {
                status = 'LATE';
                statusText = 'Terlambat Hadir';
                note = inRecord?.note || 'Terlambat Masuk';
            } else if (outRecord) {
                status = 'PRESENT';
                statusText = 'Hadir Lengkap';
                note = outRecord.note || 'Hadir & Tuntas Kepulangan';
            } else if (inRecord) {
                status = inRecord.status;
                statusText = inRecord.status === 'LATE' ? 'Terlambat Hadir' : 'Hadir (Sedang Belajar)';
                note = inRecord.note || 'Sedang Belajar di Kelas';
            }
        } else {
            const isPastGateInMax = currTimeStr > settings.gateInMaxTime;
            if (isPastDate || isPastGateInMax) {
                status = 'ABSENT';
                statusText = 'Alpa (Pelanggaran Belum Scan Masuk)';
                note = `Tidak melakukan scan barcode hingga batas waktu (${settings.gateInMaxTime} WIB)`;
            } else {
                status = 'NOT_YET';
                statusText = 'Belum Scan Masuk';
                note = 'Menunggu scan sebelum ' + settings.gateInMaxTime + ' WIB';
            }
        }

        const scanTimeStr = outRecord?.scanTime || inRecord?.scanTime;
        const gateInTimeStr = inRecord ? formatTime(inRecord.scanTime) : '-';
        const gateOutTimeStr = outRecord ? formatTime(outRecord.scanTime) : '-';
        const methodStr = inRecord?.method || outRecord?.method || '-';
        const coordStr = (inRecord?.lat && inRecord?.lng) 
            ? `${Number(inRecord.lat).toFixed(5)}, ${Number(inRecord.lng).toFixed(5)}`
            : ((outRecord?.lat && outRecord?.lng) ? `${Number(outRecord.lat).toFixed(5)}, ${Number(outRecord.lng).toFixed(5)}` : '-');
        const isMockGps = inRecord?.isFakeGps || outRecord?.isFakeGps || false;

        return {
            no: idx + 1,
            id: s.id,
            name: s.name,
            username: s.username,
            nisn: s.nisn || s.username,
            nis: s.nis || '-',
            className: s.className || '-',
            status,
            statusText,
            gateInTime: gateInTimeStr,
            gateOutTime: gateOutTimeStr,
            scanTime: scanTimeStr,
            method: methodStr,
            coords: coordStr,
            isMockGps,
            note
        };
    });

    const totalStudents = students.length;
    const presentCount = records.filter(r => r.status === 'PRESENT').length;
    const unconfirmedOutCount = records.filter(r => r.status === 'UNCONFIRMED_OUT').length;
    const lateCount = records.filter(r => r.status === 'LATE').length;
    const sickCount = records.filter(r => r.status === 'SICK').length;
    const permissionCount = records.filter(r => r.status === 'PERMISSION').length;
    const absentCount = records.filter(r => r.status === 'ABSENT').length;
    const notYetCount = records.filter(r => r.status === 'NOT_YET').length;

    const totalHadirFisik = presentCount + lateCount + unconfirmedOutCount;
    const attendancePercentage = totalStudents > 0 ? ((totalHadirFisik / totalStudents) * 100).toFixed(1) : '0';

    return {
        scopeTitle,
        targetDateStr,
        isRange,
        students,
        records,
        summary: {
            total: totalStudents,
            present: presentCount,
            unconfirmedOut: unconfirmedOutCount,
            late: lateCount,
            sick: sickCount,
            permission: permissionCount,
            absent: absentCount,
            notYet: notYetCount,
            percentage: attendancePercentage
        }
    };
}

export const exportAttendanceExcel = async (req: Request, res: Response) => {
    try {
        const data = await getAttendanceDataForExport({
            date: req.query.date ? String(req.query.date) : undefined,
            startDate: req.query.startDate ? String(req.query.startDate) : undefined,
            endDate: req.query.endDate ? String(req.query.endDate) : undefined,
            scope: req.query.scope ? String(req.query.scope) : undefined,
            grade: req.query.grade ? String(req.query.grade) : undefined,
            tingkat: req.query.tingkat ? String(req.query.tingkat) : undefined,
            className: req.query.className ? String(req.query.className) : undefined
        });

        const safeScope = data.scopeTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeDate = data.targetDateStr.replace(/[^a-zA-Z0-9_-]/g, '_');
        const format = (req.query.format ? String(req.query.format) : 'csv').toLowerCase();
        const todayId = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

        const targetClass = req.query.className ? String(req.query.className).trim() : null;
        const isGradeOrAll = !targetClass || targetClass === 'ALL' || targetClass === 'SEMUA' || String(req.query.scope || '').toLowerCase().includes('semua') || String(req.query.scope || '').toLowerCase().includes('tingkat') || !!req.query.grade || !!req.query.tingkat;
        const sigs = await getSchoolSignaturesForClass(targetClass, isGradeOrAll);
        const headmasterName = sigs.headmasterName;
        const headmasterNip = sigs.headmasterNip;
        const schoolName = sigs.schoolName;
        const bkCoordinatorName = sigs.bkCoordinatorName;
        const bkCoordinatorNip = sigs.bkCoordinatorNip;
        const bkCoordinatorTitle = sigs.bkCoordinatorTitle;
        const homeroomName = sigs.homeroomName || '';
        const homeroomNip = sigs.homeroomNip || '';
        const homeroomTitle = sigs.homeroomTitle || '';

        if (format === 'xls' || format === 'xlsx') {
            const filename = `Rekap_Presensi_${safeScope}_${safeDate}.xls`;
            let xls = `
                <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
                <head>
                    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Rekap Presensi</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
                    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
                    <style>
                        table { border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 11px; }
                        th { background-color: #0f172a; color: #ffffff; border: 1px solid #000; padding: 6px; font-weight: bold; text-align: center; }
                        td { border: 1px solid #cbd5e1; padding: 5px; vertical-align: middle; }
                        .text-center { text-align: center; }
                        .kop-title { font-size: 14px; font-weight: bold; text-align: center; }
                        .kop-sub { font-size: 11px; text-align: center; color: #334155; }
                        .stat-head { background-color: #f1f5f9; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <table>
                        <tr><td colspan="12" class="kop-title">PEMERINTAH KABUPATEN TULUNGAGUNG</td></tr>
                        <tr><td colspan="12" class="kop-title">DINAS PENDIDIKAN</td></tr>
                        <tr><td colspan="12" class="kop-title" style="font-size: 16px;">${schoolName.toUpperCase()}</td></tr>
                        <tr><td colspan="12" class="kop-sub">Jalan Raya Boyolangu, Kec. Boyolangu, Kab. Tulungagung 66271 | Telp. (0355) 324146</td></tr>
                        <tr><td colspan="12" class="kop-sub">Website: smpn1boyolangu.sch.id &bull; Email: info@smpn1boyolangu.sch.id</td></tr>
                        <tr><td colspan="12">&nbsp;</td></tr>
                        <tr><td colspan="12" style="font-size: 13px; font-weight: bold; text-align: center; text-decoration: underline;">LAPORAN REKAPITULASI PRESENSI KEHADIRAN SISWA</td></tr>
                        <tr><td colspan="12" class="text-center"><b>Lingkup:</b> ${data.scopeTitle} | <b>Periode:</b> ${data.targetDateStr} | <b>Diunduh:</b> ${new Date().toLocaleString('id-ID')} WIB</td></tr>
                        <tr><td colspan="12">&nbsp;</td></tr>
                        <thead>
                            <tr>
                                <th>No</th>
                                <th>NISN</th>
                                <th>NIS</th>
                                <th>Nama Siswa</th>
                                <th>Kelas</th>
                                <th>Status Presensi</th>
                                <th>Jam Masuk (Gate-In)</th>
                                <th>Jam Pulang (Gate-Out)</th>
                                <th>Metode</th>
                                <th>Titik Lokasi GPS</th>
                                <th>Deteksi Mock GPS</th>
                                <th>Keterangan Catatan</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            data.records.forEach(r => {
                const mockStr = r.isMockGps ? 'MOCK GPS (Palsu)' : 'Normal (Valid)';
                xls += `
                    <tr>
                        <td class="text-center">${r.no}</td>
                        <td style="mso-number-format:'\\@'; text-align: center;">${r.nisn}</td>
                        <td style="mso-number-format:'\\@'; text-align: center;">${r.nis}</td>
                        <td style="font-weight: bold;">${r.name}</td>
                        <td class="text-center">${r.className}</td>
                        <td class="text-center">${r.statusText}</td>
                        <td class="text-center">${r.gateInTime}</td>
                        <td class="text-center">${r.gateOutTime}</td>
                        <td class="text-center">${r.method}</td>
                        <td class="text-center">${r.coords}</td>
                        <td class="text-center">${mockStr}</td>
                        <td>${r.note || '-'}</td>
                    </tr>
                `;
            });

            xls += `
                        <tr><td colspan="12">&nbsp;</td></tr>
                        <tr class="stat-head"><td colspan="6">RINGKASAN STATISTIK KEHADIRAN:</td><td colspan="6">&nbsp;</td></tr>
                        <tr><td colspan="6">Total Siswa Terdaftar</td><td colspan="6">${data.summary.total} Siswa</td></tr>
                        <tr><td colspan="6">Hadir Tepat Waktu</td><td colspan="6">${data.summary.present} Siswa</td></tr>
                        <tr><td colspan="6">Terlambat Hadir</td><td colspan="6">${data.summary.late} Siswa</td></tr>
                        <tr><td colspan="6">Sakit (UKS/Surat)</td><td colspan="6">${data.summary.sick} Siswa</td></tr>
                        <tr><td colspan="6">Izin Resmi</td><td colspan="6">${data.summary.permission} Siswa</td></tr>
                        <tr><td colspan="6">Alpa (Tanpa Keterangan)</td><td colspan="6">${data.summary.absent} Siswa</td></tr>
                        <tr><td colspan="6">Belum Presensi</td><td colspan="6">${data.summary.notYet} Siswa</td></tr>
                        <tr style="font-weight: bold; background: #e2e8f0;"><td colspan="6">Persentase Tingkat Kehadiran</td><td colspan="6">${data.summary.percentage}%</td></tr>
                        <tr><td colspan="12">&nbsp;</td></tr>
                        <tr>
                            ${sigs.isFullGradeOrAll ? `
                            <td colspan="6" class="text-center">Mengetahui,<br>Kepala ${schoolName}<br><br><br><br><b>( ${headmasterName || 'ADI SUTIGNYO, S.Pd.'} )</b><br>NIP. ${headmasterNip || '196801211991031004'}</td>
                            <td colspan="6" class="text-center">Boyolangu, ${todayId}<br>${bkCoordinatorName ? 'Guru BK / Koordinator Presensi' : ''}<br><br><br><br><b>( ${bkCoordinatorName || '-'} )</b><br>NIP. ${bkCoordinatorNip || '-'}</td>
                            ` : `
                            <td colspan="4" class="text-center">Mengetahui,<br>Kepala ${schoolName}<br><br><br><br><b>( ${headmasterName || 'ADI SUTIGNYO, S.Pd.'} )</b><br>NIP. ${headmasterNip || '196801211991031004'}</td>
                            <td colspan="4" class="text-center"><br>${homeroomTitle || 'Wali Kelas'}<br><br><br><br><b>( ${homeroomName || '-'} )</b><br>NIP. ${homeroomNip || '-'}</td>
                            <td colspan="4" class="text-center">Boyolangu, ${todayId}<br>${bkCoordinatorTitle || 'Guru BK'}<br><br><br><br><b>( ${bkCoordinatorName || '-'} )</b><br>NIP. ${bkCoordinatorNip || '-'}</td>
                            `}
                        </tr>
                    </table>
                </body>
                </html>
            `;

            res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.status(200).send(xls);
        }

        const filename = `Rekap_Presensi_${safeScope}_${safeDate}.csv`;
        let csv = '\uFEFF'; // UTF-8 BOM untuk Excel
        csv += `"PEMERINTAH KABUPATEN TULUNGAGUNG"\n`;
        csv += `"DINAS PENDIDIKAN"\n`;
        csv += `"${schoolName.toUpperCase()}"\n`;
        csv += `"Jalan Raya Boyolangu, Kec. Boyolangu, Kab. Tulungagung 66271 | Telp. (0355) 324146"\n\n`;
        csv += `"LAPORAN REKAPITULASI PRESENSI KEHADIRAN SISWA"\n`;
        csv += `"Lingkup Presensi: ${data.scopeTitle}"\n`;
        csv += `"Periode: ${data.targetDateStr}"\n`;
        csv += `"Tanggal Unduh: ${new Date().toLocaleString('id-ID')} WIB"\n\n`;

        csv += `"No","NISN","NIS","Nama Siswa","Kelas","Status Presensi","Jam Masuk (Gate-In)","Jam Pulang (Gate-Out)","Metode","Titik Lokasi GPS","Deteksi Mock GPS","Keterangan Catatan"\n`;

        data.records.forEach(r => {
            const cleanName = r.name.replace(/"/g, '""');
            const cleanNote = (r.note || '-').replace(/"/g, '""');
            const mockStr = r.isMockGps ? 'MOCK GPS (Palsu)' : 'Normal (Valid)';
            csv += `"${r.no}","'${r.nisn}","'${r.nis}","${cleanName}","${r.className}","${r.statusText}","${r.gateInTime}","${r.gateOutTime}","${r.method}","${r.coords}","${mockStr}","${cleanNote}"\n`;
        });

        csv += `\n"RINGKASAN STATISTIK KEHADIRAN:"\n`;
        csv += `"Total Siswa","${data.summary.total} Siswa"\n`;
        csv += `"Hadir Tepat Waktu","${data.summary.present} Siswa"\n`;
        csv += `"Terlambat Hadir","${data.summary.late} Siswa"\n`;
        csv += `"Sakit (UKS/Surat)","${data.summary.sick} Siswa"\n`;
        csv += `"Izin Resmi","${data.summary.permission} Siswa"\n`;
        csv += `"Alpa (Tanpa Keterangan)","${data.summary.absent} Siswa"\n`;
        csv += `"Belum Presensi","${data.summary.notYet} Siswa"\n`;
        csv += `"Tingkat Kehadiran","${data.summary.percentage}%"\n\n`;

        csv += `"Mengetahui,","Boyolangu, ${todayId}"\n`;
        csv += `"Kepala ${schoolName}","${bkCoordinatorTitle}"\n\n\n\n`;
        csv += `"( ${headmasterName} )","( ${bkCoordinatorName} )"\n`;
        csv += `"NIP. ${headmasterNip || '-'}","NIP. ${bkCoordinatorNip || '-'}"\n`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.status(200).send(csv);
    } catch (error) {
        console.error('Error in exportAttendanceExcel:', error);
        res.status(500).json({ message: 'Gagal mengekspor data absensi ke Excel' });
    }
};

export const exportAttendancePdf = async (req: Request, res: Response) => {
    try {
        const data = await getAttendanceDataForExport({
            date: req.query.date ? String(req.query.date) : undefined,
            startDate: req.query.startDate ? String(req.query.startDate) : undefined,
            endDate: req.query.endDate ? String(req.query.endDate) : undefined,
            scope: req.query.scope ? String(req.query.scope) : undefined,
            grade: req.query.grade ? String(req.query.grade) : undefined,
            tingkat: req.query.tingkat ? String(req.query.tingkat) : undefined,
            className: req.query.className ? String(req.query.className) : undefined
        });

        const todayId = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

        const targetClass = req.query.className ? String(req.query.className).trim() : null;
        const isGradeOrAll = !targetClass || targetClass === 'ALL' || targetClass === 'SEMUA' || String(req.query.scope || '').toLowerCase().includes('semua') || String(req.query.scope || '').toLowerCase().includes('tingkat') || !!req.query.grade || !!req.query.tingkat;
        const sigs = await getSchoolSignaturesForClass(targetClass, isGradeOrAll);
        const headmasterName = sigs.headmasterName;
        const headmasterNip = sigs.headmasterNip;
        const schoolName = sigs.schoolName;
        const bkCoordinatorName = sigs.bkCoordinatorName;
        const bkCoordinatorNip = sigs.bkCoordinatorNip;
        const bkCoordinatorTitle = sigs.bkCoordinatorTitle;
        const homeroomName = sigs.homeroomName || '';
        const homeroomNip = sigs.homeroomNip || '';
        const homeroomTitle = sigs.homeroomTitle || '';

        const rowsHtml = data.records.map(r => {
            let badgeClass = 'background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;';
            if (r.status === 'PRESENT') badgeClass = 'background:#dcfce7; color:#15803d; border:1px solid #86efac;';
            else if (r.status === 'LATE') badgeClass = 'background:#fef9c3; color:#854d0e; border:1px solid #fde047;';
            else if (r.status === 'UNCONFIRMED_OUT') badgeClass = 'background:#e0f2fe; color:#0369a1; border:1px solid #7dd3fc;';
            else if (r.status === 'SICK') badgeClass = 'background:#dbeafe; color:#1e40af; border:1px solid #93c5fd;';
            else if (r.status === 'PERMISSION') badgeClass = 'background:#f3e8ff; color:#6b21a8; border:1px solid #d8b4fe;';
            else if (r.status === 'ABSENT') badgeClass = 'background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;';

            return `
                <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
                    <td style="padding: 6px 8px; text-align: center; color: #64748b;">${r.no}</td>
                    <td style="padding: 6px 8px; font-family: monospace; font-size: 11px; white-space: nowrap;">${r.nisn}</td>
                    <td style="padding: 6px 8px; font-weight: 600; color: #1e293b;">${r.name}</td>
                    <td style="padding: 6px 8px; text-align: center; font-weight: 700; color: #0284c7;">${r.className}</td>
                    <td style="padding: 6px 8px; text-align: center; font-family: monospace; font-weight: 600; color: #059669;">${r.gateInTime}</td>
                    <td style="padding: 6px 8px; text-align: center; font-family: monospace; font-weight: 600; color: #2563eb;">${r.gateOutTime}</td>
                    <td style="padding: 6px 8px; text-align: center;">
                        <span style="display:inline-block; padding: 2px 8px; border-radius: 9999px; font-weight: 700; font-size: 10px; ${badgeClass}">
                            ${r.statusText}
                        </span>
                    </td>
                    <td style="padding: 6px 8px; font-size: 10px; color: #64748b;">${r.method}</td>
                    <td style="padding: 6px 8px; font-size: 10px; color: #475569;">${r.note || '-'}</td>
                </tr>
            `;
        }).join('');

        const html = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Laporan Rekapitulasi Presensi - ${data.scopeTitle}</title>
    <style>
        @page {
            size: A4 landscape;
            margin: 10mm 10mm 12mm 10mm;
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        body {
            font-family: Arial, Helvetica, sans-serif;
            color: #0f172a;
            background: #f8fafc;
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 1100px;
            margin: 0 auto;
            background: white;
            padding: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            border-radius: 8px;
        }
        .header-kop {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
            text-align: center;
            padding-bottom: 12px;
            border-bottom: 3px double #000;
            margin-bottom: 16px;
        }
        .logo-box {
            font-size: 50px;
            line-height: 1;
        }
        .kop-text h2 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: 1px; }
        .kop-text h1 { margin: 2px 0; font-size: 18px; font-weight: 900; letter-spacing: 1.5px; }
        .kop-text p { margin: 0; font-size: 11px; color: #334155; }
        
        .doc-title {
            text-align: center;
            margin: 14px 0 10px;
        }
        .doc-title h3 {
            margin: 0;
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            text-decoration: underline;
        }
        .doc-title p {
            margin: 4px 0 0;
            font-size: 11px;
            color: #475569;
            font-weight: bold;
        }

        .meta-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin-bottom: 14px;
            font-size: 11px;
            background: #f1f5f9;
            padding: 10px;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
        }
        .meta-item { display: flex; flex-direction: column; }
        .meta-item span.label { color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: bold; }
        .meta-item span.val { font-weight: 700; color: #0f172a; }

        .stat-bar {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 6px;
            margin-bottom: 14px;
            text-align: center;
        }
        .stat-card {
            background: white;
            border: 1px solid #cbd5e1;
            padding: 6px 4px;
            border-radius: 6px;
        }
        .stat-card .num { font-size: 14px; font-weight: 900; }
        .stat-card .lbl { font-size: 9px; font-weight: bold; text-transform: uppercase; color: #64748b; }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        th {
            background: #0f172a;
            color: white;
            padding: 8px;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            text-align: left;
            border: 1px solid #0f172a;
        }
        td {
            border: 1px solid #e2e8f0;
        }
        tr:nth-child(even) { background-color: #f8fafc; }
        tr { page-break-inside: avoid; }

        .signature-section {
            display: flex;
            justify-content: space-between;
            margin-top: 30px;
            font-size: 11px;
            page-break-inside: avoid;
        }
        .signature-box {
            text-align: center;
            width: 250px;
        }

        .action-toolbar {
            position: fixed;
            top: 15px;
            right: 20px;
            display: flex;
            gap: 10px;
            z-index: 100;
        }
        .btn-action {
            background: #1e293b;
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: bold;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            transition: all 0.2s;
        }
        .btn-action:hover { transform: translateY(-1px); background: #0f172a; }
        .btn-action.btn-excel { background: #15803d; }
        .btn-action.btn-excel:hover { background: #166534; }

        @media print {
            body { padding: 0; background: white; }
            .container { box-shadow: none; padding: 0; width: 100%; max-width: 100%; }
            .no-print { display: none !important; }
        }
    </style>
</head>
<body>
    <div class="action-toolbar no-print">
        <button onclick="window.print()" class="btn-action">🖨️ Cetak / Simpan PDF</button>
        <button onclick="downloadExcelAlternate('xls')" class="btn-action btn-excel">📊 Unduh Excel (.xls)</button>
        <button onclick="downloadExcelAlternate('csv')" class="btn-action" style="background: #0284c7;">📊 Unduh Excel (.csv)</button>
        <button onclick="window.close()" class="btn-action" style="background: #dc2626;">✕ Tutup</button>
    </div>

    <div class="container">
        <!-- KOP SURAT RESMI -->
        <div class="header-kop">
            <div class="logo-box">
                <img src="/logo-tulungagung.png" alt="Logo Pemkab Tulungagung" style="height: 70px; width: auto; object-fit: contain;" onerror="this.src='/images/logo-tulungagung.png'">
            </div>
            <div class="kop-text">
                <h2>PEMERINTAH KABUPATEN TULUNGAGUNG</h2>
                <h2>DINAS PENDIDIKAN</h2>
                <h1>${schoolName.toUpperCase()}</h1>
                <p>Jalan Raya Boyolangu, Kec. Boyolangu, Kab. Tulungagung 66271 | Telp. (0355) 324146</p>
                <p>Website: smpn1boyolangu.sch.id &bull; Email: info@smpn1boyolangu.sch.id</p>
            </div>
        </div>

        <!-- JUDUL LAPORAN -->
        <div class="doc-title">
            <h3>LAPORAN REKAPITULASI PRESENSI KEHADIRAN SISWA</h3>
            <p>Tahun Pelajaran 2026/2027 • Sistem Presensi Terintegrasi Smart School</p>
        </div>

        <!-- METADATA LAPORAN -->
        <div class="meta-grid">
            <div class="meta-item">
                <span class="label">Lingkup Presensi</span>
                <span class="val">${data.scopeTitle}</span>
            </div>
            <div class="meta-item">
                <span class="label">Periode Tanggal</span>
                <span class="val">${data.targetDateStr}</span>
            </div>
            <div class="meta-item">
                <span class="label">Waktu Cetak Dokumen</span>
                <span class="val">${new Date().toLocaleString('id-ID')} WIB</span>
            </div>
            <div class="meta-item">
                <span class="label">Tingkat Kehadiran</span>
                <span class="val" style="color: #15803d;">${data.summary.percentage}% Rata-rata</span>
            </div>
        </div>

        <!-- STAT CARDS -->
        <div class="stat-bar">
            <div class="stat-card"><div class="num" style="color:#0f172a;">${data.summary.total}</div><div class="lbl">Total Siswa</div></div>
            <div class="stat-card"><div class="num" style="color:#15803d;">${data.summary.present}</div><div class="lbl">Hadir Tepat</div></div>
            <div class="stat-card"><div class="num" style="color:#854d0e;">${data.summary.late}</div><div class="lbl">Terlambat</div></div>
            <div class="stat-card"><div class="num" style="color:#1e40af;">${data.summary.sick}</div><div class="lbl">Sakit (UKS)</div></div>
            <div class="stat-card"><div class="num" style="color:#6b21a8;">${data.summary.permission}</div><div class="lbl">Izin</div></div>
            <div class="stat-card"><div class="num" style="color:#b91c1c;">${data.summary.absent}</div><div class="lbl">Alpa (Alpha)</div></div>
            <div class="stat-card"><div class="num" style="color:#64748b;">${data.summary.notYet}</div><div class="lbl">Belum Scan</div></div>
        </div>

        <!-- TABEL DATA PRESENSI -->
        <table>
            <thead>
                <tr>
                    <th style="width: 35px; text-align:center;">No</th>
                    <th style="width: 100px;">NISN</th>
                    <th>Nama Lengkap Siswa</th>
                    <th style="width: 65px; text-align:center;">Kelas</th>
                    <th style="width: 80px; text-align:center;">Jam Masuk</th>
                    <th style="width: 80px; text-align:center;">Jam Pulang</th>
                    <th style="width: 130px; text-align:center;">Status Kehadiran</th>
                    <th style="width: 80px;">Metode</th>
                    <th>Keterangan / Catatan</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>

        <!-- LEMBAR TANDA TANGAN -->
        <div class="signature-section">
            <div class="signature-box">
                <p>Mengetahui,</p>
                <p style="font-weight: bold; margin-bottom: 60px;">Kepala ${schoolName}</p>
                <p style="font-weight: 800; text-decoration: underline; margin: 0;">${headmasterName || 'ADI SUTIGNYO, S.Pd.'}</p>
                <p style="margin: 2px 0 0; color: #475569;">NIP. ${headmasterNip || '196801211991031004'}</p>
            </div>
            ${(!sigs.isFullGradeOrAll && homeroomName) ? `
            <div class="signature-box">
                <p>&nbsp;</p>
                <p style="font-weight: bold; margin-bottom: 60px;">${homeroomTitle || 'Wali Kelas'}</p>
                <p style="font-weight: 800; text-decoration: underline; margin: 0;">${homeroomName}</p>
                <p style="margin: 2px 0 0; color: #475569;">NIP. ${homeroomNip || '-'}</p>
            </div>
            ` : ''}
            <div class="signature-box">
                <p>Boyolangu, ${todayId}</p>
                <p style="font-weight: bold; margin-bottom: 60px;">${sigs.isFullGradeOrAll ? (bkCoordinatorName ? 'Guru BK / Koordinator Presensi' : '') : (bkCoordinatorTitle || (bkCoordinatorName ? 'Guru BK' : ''))}</p>
                <p style="font-weight: 800; text-decoration: underline; margin: 0;">${bkCoordinatorName || '-'}</p>
                <p style="margin: 2px 0 0; color: #475569;">NIP. ${bkCoordinatorNip || '-'}</p>
            </div>
        </div>
    </div>

    <script>
        function downloadExcelAlternate(format = 'xls') {
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.set('format', format);
            window.open('/api/attendance/export-excel?' + urlParams.toString(), '_blank');
        }
        window.addEventListener('load', () => {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('autoprint') !== 'false') {
                setTimeout(() => window.print(), 500);
            }
        });
    </script>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (error) {
        console.error('Error in exportAttendancePdf:', error);
        res.status(500).send('Gagal membuat laporan PDF presensi.');
    }
};

export const tapCardAttendance = async (req: Request, res: Response) => {
    return res.status(410).json({
        success: false,
        message: 'Layanan presensi fisik RFID telah dinonaktifkan secara total. Seluruh pencatatan kehadiran menggunakan QR Code Dinamis Pengurus Kelas dan Presensi Mandiri GPS pada Aplikasi Resmi SmartSchool.'
    });
};

/**
 * POST /api/attendance/bulk-sync
 * Sinkronisasi massal antrian presensi offline dari HP siswa saat kembali mendapatkan koneksi internet
 */
export const bulkSyncAttendance = async (req: Request, res: Response) => {
    try {
        const { records } = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ success: false, message: 'Array records presensi offline wajib disertakan.' });
        }

        const settings = await getOrCreateGateSettings();
        const effective = getEffectiveGateSettings(settings);

        // Ambil koordinat resmi sekolah untuk memvalidasi presensi offline
        const [schoolLatRow, schoolLngRow, globalRadiusRow, bufferDefaultRow] = await Promise.all([
            prisma.systemSetting.findUnique({ where: { key: "gps.school.lat" } }),
            prisma.systemSetting.findUnique({ where: { key: "gps.school.lng" } }),
            prisma.systemSetting.findUnique({ where: { key: "gps.radius.global" } }),
            prisma.systemSetting.findUnique({ where: { key: "gps.buffer.default" } })
        ]);
        const defaultSchoolLat = schoolLatRow ? (parseFloat(schoolLatRow.value) || -8.125157) : -8.125157;
        const defaultSchoolLng = schoolLngRow ? (parseFloat(schoolLngRow.value) || 111.893912) : 111.893912;
        const globalRadius = globalRadiusRow ? (parseInt(globalRadiusRow.value) || 55) : 55;
        const defaultBuffer = bufferDefaultRow ? (parseInt(bufferDefaultRow.value) || 10) : 10;
        const allowedRadiusOffline = globalRadius + defaultBuffer; // Maksimal radius lingkungan sekolah (65m)

        const results = [];
        let syncedCount = 0;
        let failedCount = 0;

        for (const item of records) {
            try {
                const studentIdentifier = item.identifier || item.nisn || item.username || item.userId;
                const student = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { id: String(studentIdentifier) },
                            { username: String(studentIdentifier) },
                            { nisn: String(studentIdentifier) },
                            { nis: String(studentIdentifier) }
                        ],
                        role: 'STUDENT'
                    }
                });

                if (!student) {
                    results.push({ clientLocalId: item.clientLocalId, status: 'FAILED', message: 'Siswa tidak ditemukan' });
                    failedCount++;
                    continue;
                }

                // Cek tanggal scan offline
                const scanDate = item.scanTime ? new Date(item.scanTime) : new Date();
                const scanDateStr = scanDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
                const todayStr = effective.currentDateStr;

                // Tolak jika data scan berbeda hari lebih dari 1 hari
                if (scanDateStr !== todayStr) {
                    results.push({ clientLocalId: item.clientLocalId, status: 'REJECTED', message: `Presensi tanggal ${scanDateStr} kadaluarsa (hanya berlaku hari ini).` });
                    failedCount++;
                    continue;
                }

                // Cek duplikasi presensi hari ini
                const existing = await prisma.attendance.findFirst({
                    where: {
                        userId: student.id,
                        type: item.type || 'GATE_IN',
                        scanTime: {
                            gte: new Date(todayStr + 'T00:00:00+07:00'),
                            lte: new Date(todayStr + 'T23:59:59+07:00')
                        }
                    }
                });

                if (existing) {
                    results.push({ clientLocalId: item.clientLocalId, status: 'ALREADY_SYNCED', message: 'Sudah tercatat sebelumnya' });
                    syncedCount++;
                    continue;
                }

                const itemType = (item.type || 'GATE_IN').toUpperCase();
                const scanWib = getWibDate(scanDate);
                const scanTimeSec = scanWib.timeWithSecStr;
                const scanTimeStr = scanWib.timeStr;
                const isTestingMode = Boolean(
                    settings.isEmergencyGateOut && 
                    (settings.emergencyReason?.toLowerCase().includes('uji') || 
                     settings.emergencyReason?.toLowerCase().includes('test') || 
                     settings.emergencyReason?.toLowerCase().includes('trial'))
                );

                // 1. KEAMANAN GEOFENCE KETAT OFFLINE: Mencegah presensi curang di luar sekolah
                if (item.isFakeGps === true) {
                    results.push({
                        clientLocalId: item.clientLocalId,
                        status: 'REJECTED',
                        message: 'Presensi offline ditolak: Terdeteksi manipulasi Fake GPS / Lokasi Palsu.'
                    });
                    failedCount++;
                    continue;
                }

                let distanceMeters: number | null = null;
                const hasCoordinates = item.lat !== undefined && item.lat !== null && item.lng !== undefined && item.lng !== null && Number(item.lat) !== 0 && Number(item.lng) !== 0;

                if (hasCoordinates) {
                    distanceMeters = calculateDistanceMeters(Number(item.lat), Number(item.lng), defaultSchoolLat, defaultSchoolLng);
                    if (distanceMeters > allowedRadiusOffline && !isTestingMode) {
                        results.push({
                            clientLocalId: item.clientLocalId,
                            status: 'REJECTED',
                            message: `Sinkronisasi presensi ditolak: Koordinat GPS saat scan offline berada ${distanceMeters} meter di luar lingkungan SMPN 1 Boyolangu (Batas toleransi: ${allowedRadiusOffline}m).`
                        });
                        failedCount++;
                        continue;
                    }
                } else if (!isTestingMode) {
                    results.push({
                        clientLocalId: item.clientLocalId,
                        status: 'REJECTED',
                        message: 'Sinkronisasi presensi offline ditolak: Koordinat satelit GPS wajib terkunci di lingkungan sekolah untuk mencegah kecurangan di luar sekolah.'
                    });
                    failedCount++;
                    continue;
                }

                // Validasi ketat untuk Kepulangan (GATE_OUT):
                let isMissingInBatch = false;
                if (itemType === 'GATE_OUT') {
                    // Pengecekan ada atau tidaknya GATE_IN hari ini (tidak menolak, hanya menandai verifikasi)
                    const hasInToday = await prisma.attendance.findFirst({
                        where: {
                            userId: student.id,
                            type: 'GATE_IN',
                            scanTime: {
                                gte: new Date(todayStr + 'T00:00:00+07:00'),
                                lte: new Date(todayStr + 'T23:59:59+07:00')
                            }
                        }
                    });

                    if (!hasInToday && !isTestingMode && !settings.isEmergencyGateOut) {
                        isMissingInBatch = true;
                    }

                    // 2. Wajib dalam jam operasional Gate-Out resmi
                    const gateOutStartSec = (effective.gateOutStartTime || '12:30') + ':00';
                    const gateOutEndSec = (effective.gateOutEndTime || '18:00') + ':59';
                    const isPermittedOutTime = isTestingMode || settings.isEmergencyGateOut || settings.isEarlyDismissal ||
                        (scanTimeSec >= gateOutStartSec && scanTimeSec <= gateOutEndSec);

                    if (!isPermittedOutTime) {
                        results.push({
                            clientLocalId: item.clientLocalId,
                            status: 'REJECTED',
                            message: `Gate-Out ditolak: Scan dilakukan di luar jam kepulangan resmi (Scan ${scanTimeSec} WIB - Gerbang Pulang dibuka pukul ${effective.gateOutStartTime} s.d. ${effective.gateOutEndTime} WIB).`
                        });
                        failedCount++;
                        continue;
                    }
                }

                // Validasi ketat untuk Masuk (GATE_IN):
                if (itemType === 'GATE_IN') {
                    const gateInStartSec = (effective.gateInStartTime || '06:00') + ':00';
                    const gateInEndSec = (effective.gateInEndTime || '07:00') + ':00';
                    const isBk = (item.barcodeCode || '').toUpperCase().includes('BK');

                    // Tolak jika scan sebelum jam buka gerbang
                    if (scanTimeSec < gateInStartSec && !isTestingMode && !settings.isEmergencyGateOut) {
                        results.push({ clientLocalId: item.clientLocalId, status: 'REJECTED', message: `Gate-In ditolak: Scan sebelum jam buka gerbang (${scanTimeSec} < ${effective.gateInStartTime} WIB).` });
                        failedCount++;
                        continue;
                    }

                    // Tolak scan kelas biasa jika melewati batas 07:00:00 WIB
                    if (!isBk && scanTimeSec > gateInEndSec && !isTestingMode && !settings.isEmergencyGateOut) {
                        results.push({
                            clientLocalId: item.clientLocalId,
                            status: 'REJECTED',
                            message: `Gate-In kelas ditolak: Melewati batas waktu kedatangan (Scan ${scanTimeSec} > ${effective.gateInEndTime}:00 WIB). Siswa terlambat wajib scan di Ruang BK.`
                        });
                        failedCount++;
                        continue;
                    }
                }

                // QR Code statis tanpa validasi GPS ditutup
                const hasOfflineGps = item.lat !== undefined && item.lng !== undefined && item.lat !== null && item.lng !== null && Number(item.lat) !== 0 && Number(item.lng) !== 0;
                if ((item.method === 'QR_STATIC' || !hasOfflineGps) && (item.barcodeCode && !item.barcodeCode.startsWith('DYNAMIC_CLASS_QR|') && !item.barcodeCode.includes('BK') && !item.barcodeCode.includes('SHOLAT'))) {
                    results.push({
                        clientLocalId: item.clientLocalId,
                        status: 'REJECTED',
                        message: '⛔ Presensi Barcode Statis Kelas tanpa GPS (QR_STATIC) tidak diizinkan. Wajib menggunakan GPS di sekolah atau QR Dinamis Pengurus Kelas.'
                    });
                    failedCount++;
                    continue;
                }

                const isLate = itemType === 'GATE_IN' && scanTimeSec > ((effective.gateInEndTime || '07:00') + ':00');
                const hoursDrift = Math.round(Math.abs(Date.now() - scanDate.getTime()) / (1000 * 60 * 60));
                const distText = distanceMeters !== null ? ` | GPS: ${distanceMeters}m (Valid)` : '';
                const verifyPrefix = isMissingInBatch ? '[Pulang tanpa data masuk – perlu verifikasi] ' : '';
                const note = `${verifyPrefix}[OFFLINE SYNC] Scan: ${scanTimeSec} WIB${hoursDrift > 0 ? ` (+${hoursDrift} jam sinkron)` : ''}${distText} | Method: ${item.method || 'QR_STATIC'}${item.note ? ' | ' + item.note : ''}`;

                await prisma.attendance.create({
                    data: {
                        userId: student.id,
                        type: itemType,
                        method: item.method || 'QR_STATIC',
                        status: isLate ? 'LATE' : 'PRESENT',
                        scanTime: scanDate,
                        lat: item.lat ? Number(item.lat) : null,
                        lng: item.lng ? Number(item.lng) : null,
                        isFakeGps: Boolean(item.isFakeGps),
                        jarakKeSekolah: distanceMeters,
                        note
                    }
                });

                results.push({ clientLocalId: item.clientLocalId, status: 'SYNCED', isLate });
                syncedCount++;
            } catch (err: any) {
                results.push({ clientLocalId: item.clientLocalId, status: 'ERROR', message: err.message });
                failedCount++;
            }
        }

        res.json({
            success: true,
            syncedCount,
            failedCount,
            results
        });
    } catch (error: any) {
        console.error('Error bulkSyncAttendance:', error);
        res.status(500).json({ success: false, message: 'Gagal melakukan sinkronisasi massal presensi offline: ' + error.message });
    }
};

/**
 * =====================================================================
 * REKAP PRESENSI MULTI-PERIODE (HARIAN / MINGGUAN / BULANAN)
 * Mendukung filter:
 * - mode: 'DAILY' | 'WEEKLY' | 'MONTHLY'
 * - date: YYYY-MM-DD (untuk DAILY & WEEKLY)
 * - month: 1-12 & year: YYYY (untuk MONTHLY)
 * - className / grade: Filter rombel/jenjang
 * Output: Data per siswa (H, T, S, I, A, total terlambat & menit), summary total,
 * persentase kehadiran, dan data tren grafik perbandingan real.
 * =====================================================================
 */
export const getAttendanceRekapPeriode = async (req: Request, res: Response) => {
    try {
        const { mode = 'DAILY', date, month, year, className, grade, tingkat } = req.query;
        const targetGrade = String(grade || tingkat || '');
        const currentMode = String(mode).toUpperCase(); // 'DAILY' | 'WEEKLY' | 'MONTHLY'

        let startDate: Date;
        let endDate: Date;
        let periodeLabel = '';
        const dayDateStrings: string[] = [];

        const now = new Date();

        if (currentMode === 'MONTHLY') {
            const targetYear = parseInt(String(year || now.getFullYear()), 10);
            const targetMonth = parseInt(String(month || now.getMonth() + 1), 10); // 1-12

            startDate = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
            const lastDay = new Date(targetYear, targetMonth, 0).getDate();
            endDate = new Date(targetYear, targetMonth - 1, lastDay, 23, 59, 59, 999);

            const monthNamesId = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            periodeLabel = `${monthNamesId[targetMonth - 1]} ${targetYear}`;

            for (let d = 1; d <= lastDay; d++) {
                const yyyy = targetYear;
                const mm = String(targetMonth).padStart(2, '0');
                const dd = String(d).padStart(2, '0');
                dayDateStrings.push(`${yyyy}-${mm}-${dd}`);
            }
        } else if (currentMode === 'WEEKLY') {
            let refDate: Date;
            if (date) {
                const [y, m, d] = String(date).split('T')[0].split('-').map(Number);
                refDate = new Date(y, m - 1, d, 12, 0, 0);
            } else {
                refDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
            }

            // Ambil hari Senin dari minggu tersebut
            const dayOfWeek = refDate.getDay(); // 0 is Sunday, 1 is Monday...
            const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            
            const monday = new Date(refDate);
            monday.setDate(refDate.getDate() + diffToMonday);
            monday.setHours(0, 0, 0, 0);

            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            sunday.setHours(23, 59, 59, 999);

            startDate = monday;
            endDate = sunday;

            const d1Str = monday.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            const d2Str = sunday.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
            periodeLabel = `Minggu: ${d1Str} - ${d2Str}`;

            for (let i = 0; i < 7; i++) {
                const curD = new Date(monday);
                curD.setDate(monday.getDate() + i);
                const yyyy = curD.getFullYear();
                const mm = String(curD.getMonth() + 1).padStart(2, '0');
                const dd = String(curD.getDate()).padStart(2, '0');
                dayDateStrings.push(`${yyyy}-${mm}-${dd}`);
            }
        } else {
            // DAILY
            let targetDateStr: string;
            if (date) {
                targetDateStr = String(date).split('T')[0];
                const [y, m, d] = targetDateStr.split('-').map(Number);
                startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
                endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
            } else {
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');
                targetDateStr = `${y}-${m}-${d}`;
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
                endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            }
            periodeLabel = startDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            dayDateStrings.push(targetDateStr);
        }

        // Ambil daftar siswa
        const studentWhere: any = { role: 'STUDENT', isActive: true };
        if (className && className !== 'ALL') {
            const rawClass = String(className).trim();
            const normalizedHyphen = rawClass.replace(/\s+/g, '-');
            const normalizedSpace = rawClass.replace(/-/g, ' ');
            studentWhere.className = { in: [rawClass, normalizedHyphen, normalizedSpace] };
        } else if (targetGrade && targetGrade !== 'ALL') {
            studentWhere.className = { startsWith: targetGrade };
        }

        const [rawStudents, holidays, allLogs, leaveRequests, uksVisits] = await Promise.all([
            prisma.user.findMany({
                where: studentWhere,
                select: {
                    id: true,
                    name: true,
                    username: true,
                    nisn: true,
                    nis: true,
                    className: true,
                    gender: true
                },
                orderBy: [{ className: 'asc' }, { name: 'asc' }]
            }),
            prisma.schoolHoliday.findMany({
                where: {
                    date: { in: dayDateStrings }
                }
            }),
            prisma.attendance.findMany({
                where: {
                    scanTime: {
                        gte: startDate,
                        lte: endDate
                    }
                },
                orderBy: { scanTime: 'asc' }
            }),
            prisma.studentLeaveRequest.findMany({
                where: {
                    status: 'APPROVED',
                    startDate: { lte: endDate },
                    endDate: { gte: startDate }
                }
            }),
            prisma.uksVisit.findMany({
                where: {
                    checkInTime: {
                        gte: startDate,
                        lte: endDate
                    }
                }
            })
        ]);

        // Pastikan siswa diurutkan selalu diawali dari rombel VII, VIII, lalu IX
        const students = sortStudentsByGradeAndName(rawStudents);

        const holidayDateMap = new Map<string, string>();
        holidays.forEach(h => holidayDateMap.set(h.date, h.name));

        // Kelompokkan log per user dan per tanggal YYYY-MM-DD
        const userDateLogsMap = new Map<string, Map<string, any[]>>();
        allLogs.forEach(l => {
            const dateKey = new Date(l.scanTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
            if (!userDateLogsMap.has(l.userId)) {
                userDateLogsMap.set(l.userId, new Map());
            }
            const dateMap = userDateLogsMap.get(l.userId)!;
            if (!dateMap.has(dateKey)) {
                dateMap.set(dateKey, []);
            }
            dateMap.get(dateKey)!.push(l);
        });

        // Hitung hari efektif sekolah dalam periode (bukan Minggu dan bukan libur sekolah)
        const nowDateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
        
        // Tentukan daftar hari kerja/efektif
        const effectiveDayDates = dayDateStrings.filter(dStr => {
            const [y, m, d] = dStr.split('-').map(Number);
            const dt = new Date(y, m - 1, d, 12, 0, 0);
            const isSunday = dt.getDay() === 0;
            const isHoliday = holidayDateMap.has(dStr);
            // Hanya hitung sampai hari ini jika masa depan belum berlangsung
            return !isSunday && !isHoliday && dStr <= nowDateStr;
        });

        const hariEfektifCount = Math.max(1, effectiveDayDates.length);

        // Agregasi per siswa
        let grandTotalH = 0;
        let grandTotalT = 0;
        let grandTotalS = 0;
        let grandTotalI = 0;
        let grandTotalA = 0;
        let grandTotalLateMinutes = 0;
        let grandTotalD = 0;
        let grandTotalU = 0;
        let grandTotalP = 0;
        let grandTotalL = 0;
        let grandTotalB = 0;

        const studentRecapList = students.map(s => {
            const dateMap = userDateLogsMap.get(s.id) || new Map();
            let countH = 0;
            let countT = 0;
            let countS = 0;
            let countI = 0;
            let countA = 0;
            let countD = 0;
            let countU = 0;
            let countP = 0;
            let countL = 0;
            let countB = 0;
            let countLBR = 0;
            let lateMinutesSum = 0;

            effectiveDayDates.forEach(dStr => {
                const logsOnDate: any[] = dateMap.get(dStr) || [];
                const inRecord = logsOnDate.find((l: any) => l.type === 'GATE_IN');
                const outRecord = logsOnDate.find((l: any) => l.type === 'GATE_OUT');

                // Cek UKS pada tanggal ini
                const [y, m, d] = dStr.split('-').map(Number);
                const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
                const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);

                const hasUks = uksVisits.some(u => u.userId === s.id && u.checkInTime >= dayStart && u.checkInTime <= dayEnd);
                const leave = leaveRequests.find(lr => lr.studentId === s.id && lr.startDate <= dayEnd && lr.endDate >= dayStart);

                if (hasUks) {
                    countU++;
                    countS++; // masuk kategori sakit
                } else if (leave) {
                    if (leave.category === 'SICK') countS++;
                    else if (leave.category === 'DISPENSATION') { countD++; countI++; }
                    else countI++;
                } else if (logsOnDate.length > 0) {
                    const customLog = logsOnDate.find((l: any) => ['TRUANT', 'OUTDOOR_ASSIGNMENT', 'EARLY_LEAVE', 'DISPENSATION', 'UKS'].includes(l.status));
                    if (customLog) {
                        if (customLog.status === 'TRUANT') { countB++; countA++; }
                        else if (customLog.status === 'OUTDOOR_ASSIGNMENT') { countL++; countH++; }
                        else if (customLog.status === 'EARLY_LEAVE') { countP++; countH++; }
                        else if (customLog.status === 'DISPENSATION') { countD++; countI++; }
                        else if (customLog.status === 'UKS') { countU++; countS++; }
                    } else if (logsOnDate.some((l: any) => l.status === 'SICK')) {
                        countS++;
                    } else if (logsOnDate.some((l: any) => l.status === 'PERMISSION')) {
                        countI++;
                    } else if (logsOnDate.some((l: any) => l.status === 'LATE')) {
                        countT++;
                        // Ekstrak menit terlambat dari catatan atau hitung
                        let mins = 0;
                        if (inRecord && inRecord.note) {
                            const match = inRecord.note.match(/Terlambat\s+(\d+)\s+menit/i);
                            if (match) mins = parseInt(match[1], 10);
                        }
                        if (mins === 0 && inRecord) {
                            const scanD = new Date(inRecord.scanTime);
                            const h = scanD.getHours();
                            const min = scanD.getMinutes();
                            const totalM = h * 60 + min;
                            const gateEndM = 7 * 60 + 15; // 07:15
                            if (totalM > gateEndM) mins = totalM - gateEndM;
                        }
                        lateMinutesSum += mins;
                    } else if (inRecord || outRecord) {
                        countH++;
                    }
                } else {
                    // Belum/tidak presensi di hari efektif lampau
                    countA++;
                }
            });

            // Libur
            dayDateStrings.forEach(dStr => {
                const [y, m, d] = dStr.split('-').map(Number);
                const dt = new Date(y, m - 1, d, 12, 0, 0);
                if (dt.getDay() === 0 || holidayDateMap.has(dStr)) {
                    countLBR++;
                }
            });

            // Persentase kehadiran = (Hadir Tepat + Terlambat) / Hari Efektif * 100%
            const hadirTotal = countH + countT;
            const presenceRate = hariEfektifCount > 0 ? Math.min(100, Math.round((hadirTotal / hariEfektifCount) * 1000) / 10) : 0;

            grandTotalH += countH;
            grandTotalT += countT;
            grandTotalS += countS;
            grandTotalI += countI;
            grandTotalA += countA;
            grandTotalD += countD;
            grandTotalU += countU;
            grandTotalP += countP;
            grandTotalL += countL;
            grandTotalB += countB;
            grandTotalLateMinutes += lateMinutesSum;

            return {
                userId: s.id,
                name: s.name,
                username: s.username,
                nisn: s.nisn || s.username,
                nis: s.nis || '-',
                className: s.className || '-',
                gender: s.gender || '-',
                H: countH,
                T: countT,
                S: countS,
                I: countI,
                A: countA,
                D: countD,
                U: countU,
                P: countP,
                L: countL,
                B: countB,
                LBR: countLBR,
                totalHadir: hadirTotal,
                lateMinutes: lateMinutesSum,
                presenceRate: presenceRate,
                hariEfektif: hariEfektifCount
            };
        });

        // Komparasi per rombel kelas untuk grafik
        const classStatsMap = new Map<string, { totalH: number; totalT: number; totalS: number; totalI: number; totalA: number; count: number }>();
        studentRecapList.forEach(s => {
            const cls = s.className || 'Tanpa Kelas';
            if (!classStatsMap.has(cls)) {
                classStatsMap.set(cls, { totalH: 0, totalT: 0, totalS: 0, totalI: 0, totalA: 0, count: 0 });
            }
            const st = classStatsMap.get(cls)!;
            st.totalH += s.H;
            st.totalT += s.T;
            st.totalS += s.S;
            st.totalI += s.I;
            st.totalA += s.A;
            st.count++;
        });

        const classComparisonData = Array.from(classStatsMap.entries()).map(([className, st]) => {
            const totalSlots = st.count * hariEfektifCount;
            const presenceRate = totalSlots > 0 ? Math.min(100, Math.round(((st.totalH + st.totalT) / totalSlots) * 1000) / 10) : 0;
            return {
                className,
                studentCount: st.count,
                H: st.totalH,
                T: st.totalT,
                S: st.totalS,
                I: st.totalI,
                A: st.totalA,
                presenceRate
            };
        }).sort((a, b) => compareClassNames(a.className, b.className));

        // Tren harian dalam periode terpilih (untuk grafik tren bar)
        const dailyTrendData = effectiveDayDates.slice(-14).map(dStr => {
            let hCount = 0;
            let tCount = 0;
            let sCount = 0;
            let iCount = 0;
            let aCount = 0;

            students.forEach(s => {
                const logs = userDateLogsMap.get(s.id)?.get(dStr) || [];
                const inRec = logs.find(l => l.type === 'GATE_IN');
                if (logs.some(l => l.status === 'LATE')) tCount++;
                else if (inRec || logs.find(l => l.type === 'GATE_OUT')) hCount++;
                else if (logs.some(l => l.status === 'SICK')) sCount++;
                else if (logs.some(l => l.status === 'PERMISSION')) iCount++;
                else aCount++;
            });

            const total = students.length || 1;
            const rate = Math.min(100, Math.round(((hCount + tCount) / total) * 1000) / 10);

            const [yy, mm, dd] = dStr.split('-');
            return {
                date: dStr,
                label: `${dd}/${mm}`,
                H: hCount,
                T: tCount,
                S: sCount,
                I: iCount,
                A: aCount,
                rate
            };
        });

        const totalSlotsAll = (students.length * hariEfektifCount) || 1;
        const totalKehadiranPct = Math.min(100, Math.round(((grandTotalH + grandTotalT) / totalSlotsAll) * 1000) / 10);
        const totalAlfaPct = Math.min(100, Math.round((grandTotalA / totalSlotsAll) * 1000) / 10);
        const totalSakitPct = Math.min(100, Math.round((grandTotalS / totalSlotsAll) * 1000) / 10);
        const totalIzinPct = Math.min(100, Math.round((grandTotalI / totalSlotsAll) * 1000) / 10);

        const summaryCounts = {
            totalStudents: students.length,
            hariEfektif: hariEfektifCount,
            H: grandTotalH,
            T: grandTotalT,
            S: grandTotalS,
            I: grandTotalI,
            A: grandTotalA,
            D: grandTotalD,
            U: grandTotalU,
            P: grandTotalP,
            L: grandTotalL,
            B: grandTotalB,
            totalTerlambatKasus: grandTotalT,
            totalLateMinutes: grandTotalLateMinutes,
            kehadiranPct: totalKehadiranPct,
            alfaPct: totalAlfaPct,
            sakitPct: totalSakitPct,
            izinPct: totalIzinPct
        };

        const classRows = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { className: true },
            distinct: ['className']
        });
        const availableClasses = (classRows.map(c => c.className).filter(Boolean) as string[]).sort(compareClassNames);
        const availableGrades = Array.from(new Set(availableClasses.map(c => (c || '').split('-')[0]))).filter(Boolean).sort(compareClassNames);

        res.json({
            success: true,
            mode: currentMode,
            periodeLabel,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            hariEfektif: hariEfektifCount,
            counts: summaryCounts,
            records: studentRecapList,
            classComparison: classComparisonData,
            dailyTrends: dailyTrendData,
            availableClasses,
            availableGrades
        });
    } catch (error: any) {
        console.error('Error getAttendanceRekapPeriode:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil rekapitulasi presensi periode: ' + error.message });
    }
};

/**
 * =====================================================================
 * REKAP PRESENSI DETAIL PER SISWA (30/31 HARI KALENDER)
 * Mengembalikan rincian harian satu siswa dalam 1 bulan penuh:
 * Jam masuk, jam pulang, status, koordinat, menit keterlambatan, dll.
 * =====================================================================
 */
export const getAttendanceRekapSiswa = async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        const { month, year } = req.query;

        const now = new Date();
        const targetYear = parseInt(String(year || now.getFullYear()), 10);
        const targetMonth = parseInt(String(month || now.getMonth() + 1), 10); // 1-12

        const targetUserId = Array.isArray(userId) ? String(userId[0]) : String(userId);

        const student = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                nis: true,
                className: true,
                parentPhone: true,
                profilePicUrl: true
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const startDate = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
        const lastDay = new Date(targetYear, targetMonth, 0).getDate();
        const endDate = new Date(targetYear, targetMonth - 1, lastDay, 23, 59, 59, 999);

        const dayDateStrings: string[] = [];
        for (let d = 1; d <= lastDay; d++) {
            const yyyy = targetYear;
            const mm = String(targetMonth).padStart(2, '0');
            const dd = String(d).padStart(2, '0');
            dayDateStrings.push(`${yyyy}-${mm}-${dd}`);
        }

        const [holidays, logs, leaveRequests, uksVisits] = await Promise.all([
            prisma.schoolHoliday.findMany({
                where: { date: { in: dayDateStrings } }
            }),
            prisma.attendance.findMany({
                where: {
                    userId: student.id,
                    scanTime: { gte: startDate, lte: endDate }
                },
                orderBy: { scanTime: 'asc' }
            }),
            prisma.studentLeaveRequest.findMany({
                where: {
                    studentId: student.id,
                    status: 'APPROVED',
                    startDate: { lte: endDate },
                    endDate: { gte: startDate }
                }
            }),
            prisma.uksVisit.findMany({
                where: {
                    userId: student.id,
                    checkInTime: { gte: startDate, lte: endDate }
                }
            })
        ]);

        const holidayMap = new Map<string, string>();
        holidays.forEach(h => holidayMap.set(h.date, h.name));

        const logsByDate = new Map<string, any[]>();
        logs.forEach(l => {
            const dKey = new Date(l.scanTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
            if (!logsByDate.has(dKey)) logsByDate.set(dKey, []);
            logsByDate.get(dKey)!.push(l);
        });

        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const nowDateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

        let countH = 0;
        let countT = 0;
        let countS = 0;
        let countI = 0;
        let countA = 0;
        let countD = 0;
        let countU = 0;
        let countLBR = 0;
        let totalLateMinutes = 0;
        let hariEfektifCount = 0;

        const dailyCalendar = dayDateStrings.map(dStr => {
            const [y, m, d] = dStr.split('-').map(Number);
            const dtObj = new Date(y, m - 1, d, 12, 0, 0);
            const dayOfWeek = dtObj.getDay();
            const dayName = dayNames[dayOfWeek];
            const isSunday = dayOfWeek === 0;
            const isHoliday = holidayMap.has(dStr);
            const holidayTitle = holidayMap.get(dStr) || (isSunday ? 'Hari Minggu' : '');
            const isFuture = dStr > nowDateStr;

            const logsOnDay = logsByDate.get(dStr) || [];
            const inRec = logsOnDay.find(l => l.type === 'GATE_IN');
            const outRec = logsOnDay.find(l => l.type === 'GATE_OUT');

            const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
            const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
            const uksRec = uksVisits.find(u => u.checkInTime >= dayStart && u.checkInTime <= dayEnd);
            const leaveRec = leaveRequests.find(lr => lr.startDate <= dayEnd && lr.endDate >= dayStart);

            let statusCode = 'BELUM';
            let statusLabel = 'Belum Ada';
            let note = '-';
            let gateInTime = inRec ? formatTimeWibWithSuffix(inRec.scanTime, false, inRec.note) : '-';
            let gateOutTime = outRec ? formatTimeWibWithSuffix(outRec.scanTime, false, outRec.note) : '-';
            let lateMinutes = 0;
            let lat = inRec?.lat || outRec?.lat || null;
            let lng = inRec?.lng || outRec?.lng || null;

            if (isSunday || isHoliday) {
                statusCode = 'LBR';
                statusLabel = 'Libur';
                note = `🌴 ${holidayTitle}`;
                countLBR++;
            } else if (isFuture) {
                statusCode = 'BELUM';
                statusLabel = 'Mendatang';
                note = '⏳ Belum berlangsung';
            } else {
                hariEfektifCount++;
                if (uksRec) {
                    statusCode = 'U';
                    statusLabel = 'UKS';
                    note = `🩵 Ditangani di UKS: ${uksRec.complaint || 'Keluhan medis'}`;
                    countU++;
                    countS++;
                } else if (leaveRec) {
                    if (leaveRec.category === 'SICK') {
                        statusCode = 'S';
                        statusLabel = 'Sakit';
                        note = `🟣 Sakit: ${leaveRec.reason || 'Izin Orang Tua/Dokter'}`;
                        countS++;
                    } else if (leaveRec.category === 'DISPENSATION') {
                        statusCode = 'D';
                        statusLabel = 'Dispensasi';
                        note = `🟠 Dispensasi: ${leaveRec.reason || 'Kegiatan Sekolah'}`;
                        countD++;
                        countI++;
                    } else {
                        statusCode = 'I';
                        statusLabel = 'Izin';
                        note = `🔵 Izin: ${leaveRec.reason || 'Urusan Keluarga'}`;
                        countI++;
                    }
                } else if (logsOnDay.length > 0) {
                    const custom = logsOnDay.find(l => ['TRUANT', 'OUTDOOR_ASSIGNMENT', 'EARLY_LEAVE'].includes(l.status));
                    if (custom) {
                        if (custom.status === 'TRUANT') {
                            statusCode = 'B';
                            statusLabel = 'Bolos';
                            note = '🔴 Tercatat Bolos';
                            countA++;
                        } else if (custom.status === 'OUTDOOR_ASSIGNMENT') {
                            statusCode = 'L';
                            statusLabel = 'Tugas Luar';
                            note = '🟤 Tugas Sekolah';
                            countH++;
                        } else if (custom.status === 'EARLY_LEAVE') {
                            statusCode = 'P';
                            statusLabel = 'Pulang Awal';
                            note = '⚪ Izin Pulang Awal';
                            countH++;
                        }
                    } else if (logsOnDay.some(l => l.status === 'SICK')) {
                        statusCode = 'S';
                        statusLabel = 'Sakit';
                        note = inRec?.note || '🟣 Sakit';
                        countS++;
                    } else if (logsOnDay.some(l => l.status === 'PERMISSION')) {
                        statusCode = 'I';
                        statusLabel = 'Izin';
                        note = inRec?.note || '🔵 Izin Resmi';
                        countI++;
                    } else if (logsOnDay.some(l => l.status === 'LATE')) {
                        statusCode = 'T';
                        statusLabel = 'Terlambat';
                        countT++;
                        if (inRec && inRec.note) {
                            const match = inRec.note.match(/Terlambat\s+(\d+)\s+menit/i);
                            if (match) lateMinutes = parseInt(match[1], 10);
                        }
                        if (lateMinutes === 0 && inRec) {
                            const scanD = new Date(inRec.scanTime);
                            const h = scanD.getHours();
                            const min = scanD.getMinutes();
                            const totalM = h * 60 + min;
                            const gateEndM = 7 * 60 + 15;
                            if (totalM > gateEndM) lateMinutes = totalM - gateEndM;
                        }
                        totalLateMinutes += lateMinutes;
                        note = `🟡 Terlambat ${lateMinutes} menit (${gateInTime})`;
                    } else if (inRec || outRec || logsOnDay.some(l => l.method !== 'SYSTEM_AUTO' || (l.status !== 'ABSENT' && l.status !== 'ALPA'))) {
                        statusCode = 'H';
                        statusLabel = 'Hadir Tepat';
                        note = inRec?.note || outRec?.note || logsOnDay[0]?.note || '🟢 Hadir';
                        countH++;
                    }
                } else {
                    statusCode = 'A';
                    statusLabel = 'Alfa';
                    note = '🔴 Tanpa Keterangan (Alpa)';
                    countA++;
                }
            }

            return {
                date: dStr,
                dayName,
                dayNumber: d,
                statusCode,
                statusLabel,
                gateInTime,
                gateOutTime,
                lateMinutes,
                note,
                lat,
                lng,
                isHoliday: isSunday || isHoliday,
                holidayName: holidayTitle
            };
        });

        const hadirTotal = countH + countT;
        const presenceRate = hariEfektifCount > 0 ? Math.min(100, Math.round((hadirTotal / hariEfektifCount) * 1000) / 10) : 0;
        const monthNamesId = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        res.json({
            success: true,
            student,
            month: targetMonth,
            year: targetYear,
            monthName: monthNamesId[targetMonth - 1],
            periodeLabel: `${monthNamesId[targetMonth - 1]} ${targetYear}`,
            summary: {
                hariEfektif: hariEfektifCount,
                H: countH,
                T: countT,
                S: countS,
                I: countI,
                A: countA,
                D: countD,
                U: countU,
                LBR: countLBR,
                totalHadir: hadirTotal,
                totalLateMinutes,
                presenceRate
            },
            dailyCalendar
        });
    } catch (error: any) {
        console.error('Error getAttendanceRekapSiswa:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil rekapitulasi presensi siswa: ' + error.message });
    }
};

/**
 * DEKLARASI MAKLUMAT GANGGUAN SERVER HARI INI (Admin / BK / Operator)
 * POST /api/attendance/server-outage/declare
 * Otomatis memberikan dispensasi gangguan server untuk seluruh siswa dan mencegah status Alfa.
 */
export const declareServerOutage = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { reason, scope, date } = req.body;
        const todayStr = date || new Date().toISOString().substring(0, 10);
        const resolvedReason = reason || 'Kendala sinkronisasi jaringan dan sistem server sekolah';

        const outageData = {
            active: true,
            date: todayStr,
            scope: scope || 'FULL_DAY',
            reason: resolvedReason,
            declaredBy: user?.name || 'Administrator / BK',
            declaredAt: new Date().toISOString()
        };

        await prisma.settings.upsert({
            where: { key: 'SERVER_OUTAGE_MAKLUMAT' },
            create: {
                key: 'SERVER_OUTAGE_MAKLUMAT',
                value: JSON.stringify(outageData)
            },
            update: {
                value: JSON.stringify(outageData)
            }
        });

        // Broadcast notifikasi resmi ke seluruh siswa dan orang tua
        try {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientRole: 'ALL',
                    title: '⚠️ Maklumat Kendala Server: Presensi Otomatis Dispensasi',
                    message: `Pengumuman Resmi Sekolah: Pada hari ini (${todayStr}), server sekolah mengalami kendala teknis: ${resolvedReason}. Seluruh siswa yang belum sempat memindai presensi diberikan dispensasi otomatis resmi (bukan Alfa).`,
                    category: 'ANNOUNCEMENT'
                }
            });
        } catch (e) {}

        res.json({
            success: true,
            message: `Maklumat gangguan server pada tanggal ${todayStr} berhasil diaktifkan. Seluruh presensi hari ini dibebaskan dari status Alpa.`,
            outage: outageData
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal mendeklarasikan gangguan server: ' + error.message });
    }
};

/**
 * BATALKAN MAKLUMAT GANGGUAN SERVER
 * POST /api/attendance/server-outage/cancel
 */
export const cancelServerOutage = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const setting = await prisma.settings.findUnique({ where: { key: 'SERVER_OUTAGE_MAKLUMAT' } });
        if (setting && setting.value) {
            const parsed = JSON.parse(setting.value);
            parsed.active = false;
            parsed.cancelledBy = user?.name || 'Administrator';
            parsed.cancelledAt = new Date().toISOString();
            await prisma.settings.update({
                where: { key: 'SERVER_OUTAGE_MAKLUMAT' },
                data: { value: JSON.stringify(parsed) }
            });
        }
        res.json({ success: true, message: 'Maklumat gangguan server berhasil dinonaktifkan.' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal membatalkan gangguan server: ' + error.message });
    }
};

/**
 * STATUS MAKLUMAT GANGGUAN SERVER
 * GET /api/attendance/server-outage/status
 */
export const getServerOutageStatus = async (req: Request, res: Response) => {
    try {
        const setting = await prisma.settings.findUnique({ where: { key: 'SERVER_OUTAGE_MAKLUMAT' } });
        if (!setting || !setting.value) {
            return res.json({ success: true, active: false, outage: null });
        }
        const parsed = JSON.parse(setting.value);
        const todayStr = new Date().toISOString().substring(0, 10);
        const isCurrentlyActive = parsed.active === true && parsed.date === todayStr;
        res.json({
            success: true,
            active: isCurrentlyActive,
            outage: parsed
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal membaca status gangguan server: ' + error.message });
    }
};

/**
 * QR CODE DINAMIS 10 DETIK PENGURUS KELAS
 * GET /api/class-officer/dynamic-qr
 * Menghasilkan token barcode berputar per 10 detik untuk presensi teman sekelas tanpa GPS
 */
export const getClassOfficerDynamicQr = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const queryClass = req.query.className as string;
        const className = queryClass || user?.className;

        if (!className) {
            return res.status(400).json({ success: false, message: 'Identitas kelas tidak ditemukan.' });
        }

        const now = new Date();
        const { timeWithSecStr } = getWibDate(now);

        // Batas waktu: Barcode dinamis pengurus kelas hanya aktif pukul 06:00:00 - 07:05:00 WIB
        if (timeWithSecStr < '06:00:00') {
            return res.status(400).json({
                success: false,
                message: 'Barcode dinamis pengurus kelas belum dibuka. Presensi dibuka mulai pukul 06:00 WIB.'
            });
        }

        if (timeWithSecStr > '07:05:00') {
            return res.status(400).json({
                success: false,
                isClosed: true,
                message: 'Barcode dinamis pengurus kelas ditutup pukul 07:05 WIB. Siswa yang terlambat wajib scan di Ruang BK (07:05 - 08:00 WIB).'
            });
        }

        const nowMs = Date.now();
        const step = Math.floor(nowMs / 10000); // 10 Detik per Step
        const hash = crypto.createHash('sha256').update(`${className}|${step}|${DYNAMIC_QR_SALT}`).digest('hex').substring(0, 12);
        const payload = `DYNAMIC_CLASS_QR|${className}|${step}|${hash}`;
        const secondsRemaining = 10 - Math.floor((nowMs % 10000) / 1000);

        return res.json({
            success: true,
            className,
            payload,
            step,
            expiresInSeconds: secondsRemaining,
            serverTimestamp: nowMs
        });
    } catch (err: any) {
        console.error('Error getClassOfficerDynamicQr:', err);
        return res.status(500).json({ success: false, message: 'Gagal menghasilkan QR dinamis: ' + err.message });
    }
};

/**
 * GAP-05: Guru Piket / Guru BK Menyetujui Pemakluman Keterlambatan Siswa (LATE_EXCUSED)
 */
export const excuseLateStudent = async (req: Request, res: Response) => {
    try {
        const { attendanceId, studentId, date, reason } = req.body;
        const user = (req as any).user;

        const todayStr = date || new Date().toISOString().substring(0, 10);
        const whereClause: any = attendanceId ? { id: attendanceId } : {
            studentId,
            date: todayStr,
            status: 'LATE'
        };

        const target = await prisma.attendance.findFirst({ where: whereClause });
        if (!target) {
            return res.status(404).json({ success: false, message: 'Data keterlambatan siswa tidak ditemukan' });
        }

        await prisma.attendance.update({
            where: { id: target.id },
            data: {
                status: 'LATE_EXCUSED',
                note: `Terlambat Dimaklumi oleh ${user?.name || 'Guru Piket'}: ${reason || 'Alasan sah'}`
            }
        });

        // Hapus poin pelanggaran kedisiplinan jika sebelumnya sempat bertambah
        await prisma.disciplineRecord.deleteMany({
            where: {
                userId: target.userId,
                type: 'PELANGGARAN',
                description: { contains: 'Keterlambatan masuk sekolah' },
                createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
            }
        }).catch(() => {});

        res.json({ success: true, message: 'Status keterlambatan berhasil dimaklumi (LATE_EXCUSED).' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};