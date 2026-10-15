import { Request, Response } from 'express';
import prisma from '../utils/db';
import { sendFcmToUser } from '../services/fcmService';
import { formatTimeWibWithSuffix } from '../utils/dateUtils';

// 1. Cek Status Sakelar Fitur Pengurus Kelas dari Portal
export const getPengurusKelasConfig = async (req: Request, res: Response) => {
    try {
        const setting = await prisma.settings.findUnique({
            where: { key: 'PENGURUS_KELAS_MENU_ENABLED' }
        });
        const isEnabled = setting ? setting.value === 'true' : true; // Default aktif
        res.json({ success: true, isEnabled });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

// 2. Ubah Sakelar Fitur Pengurus Kelas (Khusus Admin / Kurikulum)
export const togglePengurusKelasConfig = async (req: Request, res: Response) => {
    try {
        const { isEnabled } = req.body;
        const valStr = isEnabled ? 'true' : 'false';
        await prisma.settings.upsert({
            where: { key: 'PENGURUS_KELAS_MENU_ENABLED' },
            create: { key: 'PENGURUS_KELAS_MENU_ENABLED', value: valStr },
            update: { value: valStr }
        });
        res.json({
            success: true,
            message: `Menu Pengurus Kelas berhasil di-${isEnabled ? 'aktifkan' : 'nonaktifkan'}!`,
            isEnabled: !!isEnabled
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

// 3. Ambil Pantauan Real-Time Teman Sekelas Hari Ini
export const getClassmatesRealtimeStatus = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user || (user.role !== 'STUDENT' && user.role !== 'TEACHER' && user.role !== 'ADMIN' && user.role !== 'OPERATOR')) {
            return res.status(403).json({ success: false, message: 'Akses khusus civitas sekolah.' });
        }

        const studentUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (!studentUser || !studentUser.className) {
            return res.status(400).json({ success: false, message: 'Data kelas tidak ditemukan pada profil Anda.' });
        }

        const validRoles = ['Ketua Kelas', 'Wakil Ketua Kelas', 'Sekretaris', 'Bendahara'];
        const isOfficer = studentUser.classRole && validRoles.some(r => studentUser.classRole?.includes(r));

        // Rentang Hari Ini dalam Waktu Indonesia Barat (WIB / UTC+7)
        const now = new Date();
        const nowUtc = now.getTime();
        const wibOffset = 7 * 60 * 60 * 1000;
        const nowWib = new Date(nowUtc + wibOffset);
        const y = nowWib.getUTCFullYear();
        const m = nowWib.getUTCMonth();
        const d = nowWib.getUTCDate();
        const todayStart = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - wibOffset);
        const todayEnd = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - wibOffset);

        // Cek Siswa Tanpa HP Resmi dari Database
        const noPhoneSetting = await prisma.settings.findUnique({ where: { key: 'NO_SMARTPHONE_STUDENT_IDS' } });
        let noPhoneIds: string[] = [];
        if (noPhoneSetting && noPhoneSetting.value) {
            try { noPhoneIds = JSON.parse(noPhoneSetting.value); } catch {}
        }

        // Daftar semua siswa di kelas ini
        const classmates = await prisma.user.findMany({
            where: {
                className: studentUser.className,
                role: 'STUDENT',
                isActive: true
            },
            select: {
                id: true,
                name: true,
                nisn: true,
                nis: true,
                gender: true,
                profilePicUrl: true,
                classRole: true
            },
            orderBy: { name: 'asc' }
        });

        const classmateIds = classmates.map((c: any) => c.id);

        // 1. Log Presensi Gate-In & Gate-Out Hari Ini
        const todayAttendances = await prisma.attendance.findMany({
            where: {
                userId: { in: classmateIds },
                scanTime: { gte: todayStart, lte: todayEnd }
            },
            orderBy: { scanTime: 'asc' }
        });

        // 2. Izin & Sakit Resmi Disetujui BK Hari Ini
        const todayLeaves = await (prisma as any).studentLeaveRequest.findMany({
            where: {
                studentId: { in: classmateIds },
                status: 'APPROVED',
                startDate: { lte: todayEnd },
                endDate: { gte: todayStart }
            }
        });

        const list = classmates.map((c: any) => {
            const atts = todayAttendances.filter((a: any) => a.userId === c.id);
            const gateIn = atts.find((a: any) => a.type === 'GATE_IN');
            const gateOut = atts.find((a: any) => a.type === 'GATE_OUT');
            const leave = todayLeaves.find((l: any) => l.studentId === c.id);

            let status = 'BELUM_HADIR';
            let statusLabel = 'Belum Masuk';
            let timeStr = '-';
            let gateInTime: string | null = null;
            let gateOutTime: string | null = null;
            let isAssisted = false;

            if (gateIn) {
                gateInTime = formatTimeWibWithSuffix(gateIn.scanTime);
                isAssisted = gateIn.method === 'PENGURUS_ASSISTED' || gateIn.method === 'PENGURUS_ASSISTED_NO_PHONE';
            }
            if (gateOut) {
                gateOutTime = formatTimeWibWithSuffix(gateOut.scanTime);
            }

            if (leave) {
                const isSick = (leave.category || '').toUpperCase().includes('SICK') || (leave.category || '').toUpperCase().includes('SAKIT');
                status = isSick ? 'SICK' : 'PERMISSION';
                statusLabel = isSick ? 'Sakit (Disetujui BK)' : 'Izin Resmi (BK)';
                timeStr = leave.reason || (isSick ? 'Sakit' : 'Izin');
            } else if (gateOut) {
                status = 'PULANG';
                statusLabel = 'Sudah Pulang';
                timeStr = gateOutTime || '-';
            } else if (gateIn) {
                if (gateIn.status === 'LATE') {
                    status = 'LATE';
                    statusLabel = 'Terlambat';
                } else {
                    status = 'PRESENT';
                    statusLabel = 'Hadir Tepat';
                }
                timeStr = gateInTime || '-';
            }

            return {
                id: c.id,
                name: c.name,
                nisn: c.nisn || c.nis || '-',
                gender: c.gender || '-',
                profilePicUrl: c.profilePicUrl,
                classRole: c.classRole || 'Siswa',
                status,
                statusLabel,
                timeStr,
                gateInTime,
                gateOutTime,
                isGateIn: Boolean(gateIn),
                isGateOut: Boolean(gateOut),
                isAssisted,
                isNoSmartphone: noPhoneIds.includes(c.id)
            };
        });

        const presentCount = list.filter((s: any) => s.status === 'PRESENT' || s.status === 'PULANG').length;
        const lateCount = list.filter((s: any) => s.status === 'LATE').length;
        const pulangCount = list.filter((s: any) => s.status === 'PULANG').length;
        const sickCount = list.filter((s: any) => s.status === 'SICK').length;
        const permitCount = list.filter((s: any) => s.status === 'PERMISSION').length;
        const absentCount = list.filter((s: any) => s.status === 'BELUM_HADIR').length;
        const countL = classmates.filter((c: any) => c.gender === 'L' || c.gender === 'LAKI-LAKI').length;
        const countP = classmates.filter((c: any) => c.gender === 'P' || c.gender === 'PEREMPUAN').length;

        res.json({
            success: true,
            className: studentUser.className,
            officerRole: studentUser.classRole || (isOfficer ? 'Pengurus Kelas' : 'Siswa'),
            totalStudents: classmates.length,
            presentCount,
            pulangCount,
            lateCount,
            sickCount,
            permitCount,
            sickPermitCount: sickCount + permitCount,
            absentCount,
            countL,
            countP,
            students: list
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

// 4. Bantu Presensi Teman Sekelas (Scan Kartu Pelajar Beruntun)
export const submitAssistedScan = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { barcodeValue, lat, lng, accuracy, scanType } = req.body; // barcodeValue: NISN / studentId

        if (!user || user.role !== 'STUDENT') {
            return res.status(403).json({ success: false, message: 'Akses khusus pengurus kelas.' });
        }

        const pengurus = await prisma.user.findUnique({ where: { id: user.id } });
        if (!pengurus || !pengurus.className) {
            return res.status(400).json({ success: false, message: 'Data kelas pengurus tidak valid.' });
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const todayStart = new Date(`${todayStr}T00:00:00.000Z`);
        const todayEnd = new Date(`${todayStr}T23:59:59.999Z`);

        // Validasi Status Sakelar Fitur
        const config = await prisma.settings.findUnique({ where: { key: 'PENGURUS_KELAS_MENU_ENABLED' } });
        if (config && config.value === 'false') {
            return res.status(403).json({ success: false, message: 'Fitur bantuan presensi pengurus kelas sedang dinonaktifkan sekolah.' });
        }

        // Validasi Geofence GPS Pengurus (Wajib di lingkungan sekolah/kelas)
        const schoolLat = -8.125506;
        const schoolLng = 111.893526;
        const maxRadiusMeters = 150; // Radius toleransi lingkungan sekolah

        if (!lat || !lng) {
            return res.status(400).json({
                success: false,
                isGpsError: true,
                message: 'GPS Wajib Aktif! Presensi bantuan harus dilakukan secara fisik di lingkungan kelas.'
            });
        }

        // Haversine formula
        const R = 6371e3;
        const φ1 = (lat * Math.PI) / 180;
        const φ2 = (schoolLat * Math.PI) / 180;
        const Δφ = ((schoolLat - lat) * Math.PI) / 180;
        const Δλ = ((schoolLng - lng) * Math.PI) / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        if (distance > maxRadiusMeters + (accuracy || 20)) {
            return res.status(400).json({
                success: false,
                isGpsError: true,
                message: `Presensi Ditolak! Anda terdeteksi berada di luar area sekolah (Jarak: ${Math.round(distance)}m).`
            });
        }

        // Cari Siswa yang Di-scan
        const cleanCode = String(barcodeValue || '').trim();
        const targetStudent = await prisma.user.findFirst({
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

        if (!targetStudent) {
            return res.status(404).json({ success: false, message: 'Barcode kartu pelajar tidak terdaftar di sistem.' });
        }

        // Validasi Isolasi Rombel (Wajib Satu Kelas)
        if (targetStudent.className !== pengurus.className) {
            return res.status(400).json({
                success: false,
                isClassMismatch: true,
                message: `Ditolak! ${targetStudent.name} adalah siswa kelas ${targetStudent.className}, bukan anggota kelas Anda (${pengurus.className}).`
            });
        }
        // Cek Siswa Tanpa HP Resmi dari Database
        const noPhoneSetting = await prisma.settings.findUnique({ where: { key: 'NO_SMARTPHONE_STUDENT_IDS' } });
        let noPhoneIds: string[] = [];
        if (noPhoneSetting && noPhoneSetting.value) {
            try { noPhoneIds = JSON.parse(noPhoneSetting.value); } catch {}
        }
        const isTargetNoPhone = noPhoneIds.includes(targetStudent.id);

        // Batasan Keamanan: Maksimal 5 Bantuan per Pengurus per Hari (Kecuali Siswa Terdaftar Tanpa HP)
        const assistedCountToday = await prisma.attendance.count({
            where: {
                method: { in: ['PENGURUS_ASSISTED', 'PENGURUS_ASSISTED_NO_PHONE'] },
                scanTime: { gte: todayStart, lte: todayEnd },
                note: { contains: pengurus.name }
            }
        });

        if (!isTargetNoPhone && assistedCountToday >= 5) {
            return res.status(400).json({
                success: false,
                message: `Batas Maksimal Tercapai! Pengurus hanya dapat membantu maksimal 5 siswa reguler per hari. Untuk siswa tanpa HP, daftarkan ke Wali Kelas / BK.`
            });
        }

        // Cek Penandaan Siswa yang sering dibantu (≥ 3x seminggu) - Khusus Siswa Reguler
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const assistedPastWeek = await prisma.attendance.count({
            where: {
                userId: targetStudent.id,
                method: { in: ['PENGURUS_ASSISTED', 'PENGURUS_ASSISTED_NO_PHONE'] },
                scanTime: { gte: sevenDaysAgo }
            }
        });
        const isFlaggedFrequent = !isTargetNoPhone && assistedPastWeek >= 2;

        // Cek Jam Masuk / Terlambat
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const isLate = hours > 7 || (hours === 7 && minutes > 0);
        const attStatus = isLate ? 'LATE' : 'PRESENT';
        const typeToRecord = scanType === 'GATE_OUT' ? 'GATE_OUT' : 'GATE_IN';

        // Cek Duplikasi Hari Ini
        const existingAtt = await prisma.attendance.findFirst({
            where: {
                userId: targetStudent.id,
                type: typeToRecord,
                scanTime: { gte: todayStart, lte: todayEnd }
            }
        });

        if (existingAtt) {
            return res.status(400).json({
                success: false,
                isAlreadyScanned: true,
                studentName: targetStudent.name,
                message: `${targetStudent.name} sudah melakukan presensi ${typeToRecord === 'GATE_IN' ? 'masuk' : 'pulang'} sebelumnya pada pukul ${existingAtt.scanTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB.`
            });
        }

        // Simpan Presensi Baru
        const flagText = isFlaggedFrequent ? ' [⚠️ SISWA SERING TITIP KARTU]' : '';
        const methodRecord = isTargetNoPhone ? 'PENGURUS_ASSISTED_NO_PHONE' : 'PENGURUS_ASSISTED';
        const noteRecord = isTargetNoPhone
            ? `Presensi via Kartu Pelajar (Siswa Tanpa HP) dibantu oleh ${pengurus.name} (${pengurus.classRole || 'Pengurus'})`
            : `Dibantu Pengurus Kelas: ${pengurus.name} (${pengurus.classRole || 'Pengurus'})${flagText}`;
        const attRecord = await prisma.attendance.create({
            data: {
                userId: targetStudent.id,
                type: typeToRecord,
                method: methodRecord,
                status: typeToRecord === 'GATE_OUT' ? 'PRESENT' : attStatus,
                lat: lat,
                lng: lng,
                accuracyMeters: accuracy || 10,
                note: noteRecord
            }
        });

        // Notifikasi ke Orang Tua Siswa yang Dibantu
        const parentUser = await prisma.user.findFirst({
            where: {
                role: 'PARENT',
                OR: [{ username: 'P' + (targetStudent.nisn || targetStudent.username) }, { nisn: targetStudent.nisn }]
            }
        });
        const timeNowStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        const parentMsg = `Ananda ${targetStudent.name} telah presensi ${typeToRecord === 'GATE_IN' ? 'masuk' : 'pulang'} di sekolah pukul ${timeNowStr} WIB dibantu oleh Pengurus Kelas ${pengurus.name}.`;

        if (parentUser) {
            await prisma.notificationMessage.create({
                data: {
                    recipientId: parentUser.id,
                    recipientRole: 'PARENT',
                    studentId: targetStudent.id,
                    studentName: targetStudent.name,
                    className: targetStudent.className,
                    title: `🤝 Presensi Bantuan Pengurus: ${targetStudent.name}`,
                    message: parentMsg,
                    category: 'ATTENDANCE'
                }
            });
            sendFcmToUser(parentUser.id, `🤝 Presensi ${targetStudent.name}`, parentMsg);
        }

        // Laporan ke Wali Kelas jika siswa sering dibantu
        if (isFlaggedFrequent) {
            const wali = await prisma.user.findFirst({
                where: {
                    role: 'TEACHER',
                    teachingClasses: { contains: targetStudent.className },
                    rolesTambahan: { contains: 'wali_kelas' }
                }
            });
            if (wali) {
                sendFcmToUser(wali.id, `⚠️ Perhatian Wali Kelas: ${targetStudent.name}`, `${targetStudent.name} telah dibantu presensi ≥ 3 kali minggu ini.`);
            }
        }

        res.json({
            success: true,
            isNoSmartphone: isTargetNoPhone,
            message: `Presensi ${typeToRecord === 'GATE_IN' ? 'masuk' : 'pulang'} berhasil dicatat untuk ${targetStudent.name}!`,
            student: {
                id: targetStudent.id,
                name: targetStudent.name,
                nisn: targetStudent.nisn || targetStudent.nis,
                className: targetStudent.className,
                profilePicUrl: targetStudent.profilePicUrl,
                status: attStatus,
                timeStr: timeNowStr,
                isLate: isLate && typeToRecord === 'GATE_IN',
                isNoSmartphone: isTargetNoPhone,
                isFlaggedFrequent
            }
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};
