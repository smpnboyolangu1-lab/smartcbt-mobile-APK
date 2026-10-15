import { Request, Response } from 'express';
import prisma from '../utils/db';

export function normalizeClassVariations(clsName: string): string[] {
    if (!clsName) return [];
    const clean = clsName.trim().toUpperCase().replace(/\s+/g, '');
    const v = new Set<string>([clsName.trim(), clean]);

    const rToA: Record<string, string> = {
        'XII': '12', 'XI': '11', 'X': '10', 'IX': '9', 'VIII': '8', 'VII': '7'
    };
    const aToR: Record<string, string> = {
        '12': 'XII', '11': 'XI', '10': 'X', '9': 'IX', '8': 'VIII', '7': 'VII'
    };

    for (const [r, a] of Object.entries(rToA)) {
        if (clean.startsWith(r)) {
            const suf = clean.slice(r.length).replace(/^-/, '');
            v.add(r + suf);
            v.add(r + '-' + suf);
            v.add(r + ' ' + suf);
            v.add(a + suf);
            v.add(a + '-' + suf);
            v.add(a + ' ' + suf);
        }
    }

    for (const [a, r] of Object.entries(aToR)) {
        if (clean.startsWith(a)) {
            const suf = clean.slice(a.length).replace(/^-/, '');
            v.add(r + suf);
            v.add(r + '-' + suf);
            v.add(r + ' ' + suf);
            v.add(a + suf);
            v.add(a + '-' + suf);
            v.add(a + ' ' + suf);
        }
    }

    return Array.from(v);
}

/**
 * 1. Guru Tap "IN KELAS" (1 Tap per JP)
 * Membuka sesi JP otomatis, menutup sesi sebelumnya, menghitung jendela waktu OUT (5 menit terakhir)
 */
export const teacherInClassSession = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            scheduleId,
            className,
            subjectName,
            periodIndex,
            timeRange,
            startTimeStr,
            endTimeStr,
            roomName,
            lat,
            lng,
            isFakeGps
        } = req.body;

        if (!className || !subjectName) {
            return res.status(400).json({ message: 'Kelas dan Mata Pelajaran wajib disertakan' });
        }

        if (isFakeGps === true) {
            return res.status(403).json({
                success: false,
                message: '🚨 Presensi Kelas Ditolak! Terdeteksi penggunaan Fake GPS / Mock Location pada perangkat Anda.'
            });
        }

        // Validasi Geofence Koordinat Ruang Kelas & Lingkungan Sekolah Resmi
        const classInfo = await prisma.class.findFirst({
            where: { name: className }
        });
        const targetLat = classInfo?.lat ?? -8.125157;
        const targetLng = classInfo?.lng ?? 111.893912;
        const baseRadius = classInfo?.radiusMeters ?? 65;
        const maxRadius = Math.max(baseRadius + 20, 85); // Toleransi lingkungan sekolah & kelas (85m)

        if (lat === undefined || lng === undefined || lat === null || lng === null || String(lat).trim() === '' || String(lng).trim() === '' || Number(lat) === 0 || Number(lng) === 0) {
            return res.status(403).json({
                success: false,
                message: `📍 Presensi Kelas Ditolak! Koordinat GPS tidak terdeteksi. Aktifkan GPS lokasi HP Anda dan pastikan berada di dalam ruang kelas ${className}.`
            });
        }

        const distanceMeters = calculateDistanceMeters(Number(lat), Number(lng), targetLat, targetLng);
        if (distanceMeters > maxRadius) {
            return res.status(403).json({
                success: false,
                message: `📍 Presensi Kelas Ditolak! Anda terdeteksi berada di luar area kelas / lingkungan sekolah ${className} (Jarak: ${distanceMeters} meter). Batas toleransi maksimal ${maxRadius} meter untuk konfirmasi kehadiran guru.`
            });
        }

        const now = new Date();
        const teacherId = user.id;
        const teacherName = user.name || 'Guru Pengampu';
        const classVariations = normalizeClassVariations(className);

        // Validasi Waktu Jadwal: Sesi JP HANYA boleh dibuka maksimal 10 menit sebelum jam mulai
        let scheduleStart: Date | null = null;
        if (startTimeStr && startTimeStr.includes(':')) {
            const [sH, sM] = startTimeStr.split(':').map(Number);
            scheduleStart = new Date(now);
            scheduleStart.setHours(sH, sM, 0, 0);
        } else if (scheduleId) {
            try {
                const sched = await (prisma as any).classPeriodSchedule.findUnique({ where: { id: scheduleId } });
                if (sched && sched.startTime && sched.startTime.includes(':')) {
                    const [sH, sM] = sched.startTime.split(':').map(Number);
                    scheduleStart = new Date(now);
                    scheduleStart.setHours(sH, sM, 0, 0);
                }
            } catch (e) {}
        }

        if (scheduleStart) {
            const earliestAllowed = new Date(scheduleStart.getTime() - 10 * 60 * 1000);
            if (now < earliestAllowed) {
                const waitMinutes = Math.ceil((scheduleStart.getTime() - now.getTime()) / (60 * 1000));
                const startFormatted = scheduleStart.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                return res.status(400).json({
                    success: false,
                    message: `Sesi kelas ${className} belum dapat dibuka. Jam pelajaran ${subjectName} baru dimulai ${waitMinutes} menit lagi (pukul ${startFormatted} WIB). Buka sesi saat mendekati jam pelajaran.`
                });
            }
        }

        // 1. Tutup otomatis sesi aktif guru atau kelas sebelumnya jika masih terbuka
        await (prisma as any).classPeriodSession.updateMany({
            where: {
                OR: [
                    { teacherId, status: 'ACTIVE' },
                    { className: { in: classVariations }, status: 'ACTIVE' }
                ]
            },
            data: {
                status: 'CLOSED',
                updatedAt: now
            }
        });

        // 2. Hitung estimasi waktu selesai & jendela OUT
        // Default 45 menit per JP jika tidak spesifik
        let endDt: Date;
        if (endTimeStr && endTimeStr.includes(':')) {
            const [endH, endM] = endTimeStr.split(':').map(Number);
            endDt = new Date(now);
            endDt.setHours(endH, endM, 0, 0);
            if (endDt <= now) {
                // Jika jam berakhir terlewat, set 45 menit dari sekarang
                endDt = new Date(now.getTime() + 45 * 60 * 1000);
            }
        } else {
            endDt = new Date(now.getTime() + 45 * 60 * 1000);
        }

        // Jendela OUT aktif pada 5 menit terakhir JP
        const outWindowStart = new Date(endDt.getTime() - 5 * 60 * 1000);

        // 3. Hitung jumlah total siswa di kelas tersebut
        const totalStudents = await prisma.user.count({
            where: { role: 'STUDENT', className: { in: classVariations } }
        });

        // 4. Buka sesi JP baru
        const newSession = await (prisma as any).classPeriodSession.create({
            data: {
                scheduleId: scheduleId || null,
                teacherId,
                teacherName,
                className,
                subjectName,
                periodIndex: Number(periodIndex) || 1,
                timeRange: timeRange || null,
                startTimeStr: startTimeStr || now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }),
                endTimeStr: endTimeStr || endDt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }),
                roomName: roomName || `Ruang Kelas ${className}`,
                inTime: now,
                outWindowStart,
                endTime: endDt,
                status: 'ACTIVE',
                totalStudents: Math.max(totalStudents, 1),
                studentOutCount: 0
            }
        });

        const inTimeFormatted = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        // Broadcast ke TV Monitoring / Command Center agar status kelas seketika HIJAU
        if ((global as any).emitEmptyClassUpdate) {
            (global as any).emitEmptyClassUpdate({
                type: 'TEACHER_IN_CLASS',
                className,
                teacherName,
                subjectName,
                periodIndex: newSession.periodIndex,
                status: 'ACTIVE',
                sessionId: newSession.id,
                inTime: now
            });
        }

        return res.json({
            success: true,
            message: `✔ Berhasil IN KELAS ${className} (${inTimeFormatted} WIB). Sesi JP otomatis aktif.`,
            session: newSession,
            inTimeStr: inTimeFormatted
        });
    } catch (error: any) {
        console.error('Error in teacherInClassSession:', error);
        return res.status(500).json({ message: 'Gagal membuka sesi kelas: ' + error.message });
    }
};

/**
 * 1.B Guru Tap [ SELESAI MENGAJAR ]
 * Menutup sesi aktif guru, mencatat waktu selesai server, dan menghitung durasi mengajar nyata
 */
export const teacherEndClassSession = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const sessionId = req.params.id || req.body.sessionId;
        const now = new Date();

        const session = await (prisma as any).classPeriodSession.findFirst({
            where: {
                ...(sessionId ? { id: sessionId } : { teacherId: user.id, status: 'ACTIVE' }),
                ...(user.role === 'TEACHER' ? { teacherId: user.id } : {})
            }
        });

        if (!session) {
            return res.status(404).json({ success: false, message: 'Sesi pembelajaran aktif tidak ditemukan.' });
        }

        const durationMinutes = Math.max(1, Math.round((now.getTime() - new Date(session.inTime).getTime()) / (60 * 1000)));

        const updated = await (prisma as any).classPeriodSession.update({
            where: { id: session.id },
            data: {
                status: 'CLOSED',
                endTime: now,
                updatedAt: now
            }
        });

        // Broadcast ke TV Monitoring / Command Center agar status kelas tercatat selesai KBM
        if ((global as any).emitEmptyClassUpdate) {
            (global as any).emitEmptyClassUpdate({
                type: 'TEACHER_OUT_CLASS',
                className: session.className,
                teacherName: session.teacherName,
                subjectName: session.subjectName,
                periodIndex: session.periodIndex,
                status: 'CLOSED',
                sessionId: session.id,
                outTime: now,
                message: `Kelas ${session.className} guru ${session.teacherName} mata pelajaran ${session.subjectName} telah selesai KBM pukul ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
            });
        }

        return res.json({
            success: true,
            message: `✔ SELESAI MENGAJAR! Sesi kelas ${session.className} mata pelajaran ${session.subjectName} resmi ditutup. Durasi: ${durationMinutes} menit.`,
            session: updated,
            durationMinutes
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: 'Gagal menutup sesi pembelajaran: ' + error.message });
    }
};

/**
 * 2. Get Sesi JP Aktif (Untuk Layar Guru & Siswa)
 */
export const getActiveClassSession = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const now = new Date();

        // Jalankan auto-close pada sesi yang sudah lewat batas
        await performAutoCloseExpiredSessions();

        if (user.role === 'TEACHER') {
            // Cek sesi aktif yang dibuka guru ini
            const activeSession = await (prisma as any).classPeriodSession.findFirst({
                where: {
                    teacherId: user.id,
                    status: 'ACTIVE'
                },
                orderBy: { inTime: 'desc' }
            });

            return res.json({
                role: 'TEACHER',
                hasActiveSession: !!activeSession,
                session: activeSession
            });
        } else {
            // Role Siswa: Cari sesi aktif untuk kelas siswa
            const userClass = user.className || '';
            const classVariations = normalizeClassVariations(userClass);
            const activeSession = await (prisma as any).classPeriodSession.findFirst({
                where: {
                    className: { in: classVariations.length > 0 ? classVariations : [userClass] },
                    status: 'ACTIVE'
                },
                orderBy: { inTime: 'desc' }
            });

            if (!activeSession) {
                return res.json({
                    role: 'STUDENT',
                    hasActiveSession: false,
                    className: userClass,
                    message: 'Tidak ada sesi pelajaran yang sedang aktif di kelas Anda.'
                });
            }

            // Cek status Gate In siswa hari ini
            const startOfDay = new Date(now);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(now);
            endOfDay.setHours(23, 59, 59, 999);

            const gateInToday = await prisma.attendance.findFirst({
                where: {
                    userId: user.id,
                    type: 'GATE_IN',
                    scanTime: { gte: startOfDay, lte: endOfDay }
                }
            });

            // Cek status kepulangan via BK/UKS
            const uksHomeEvent = await (prisma as any).uksVisitEvent?.findFirst({
                where: {
                    siswaId: user.id,
                    tanggal: { gte: startOfDay, lte: endOfDay },
                    status: { in: ['PULANG', 'PERLU_DIJEMPUT', 'DIRUJUK_RS'] }
                }
            });
            const bkGatepassToday = await prisma.gatepassRequest.findFirst({
                where: {
                    studentId: user.id,
                    status: { in: ['APPROVED', 'COMPLETED'] },
                    verifiedAt: { gte: startOfDay, lte: endOfDay }
                }
            });
            const leaveApproved = await prisma.studentLeaveRequest.findFirst({
                where: {
                    studentId: user.id,
                    status: 'APPROVED',
                    startDate: { lte: endOfDay },
                    endDate: { gte: startOfDay }
                }
            });
            const isHomeViaBk = !!(uksHomeEvent || bkGatepassToday || (!gateInToday && leaveApproved));
            const homeBkReason = uksHomeEvent ? `UKS: ${uksHomeEvent.keluhan}` :
                (bkGatepassToday ? `Gatepass BK: ${bkGatepassToday.reason}` : (leaveApproved?.reason || null));

            // Cek kehadiran guru pengampu di sekolah hari ini
            let teacherPresenceStatus = 'UNKNOWN';
            let isTeacherAbsent = false;
            let teacherAttendanceNote = '';

            if (activeSession.teacherId) {
                const teacherIn = await prisma.attendance.findFirst({
                    where: {
                        userId: activeSession.teacherId,
                        type: 'GATE_IN',
                        scanTime: { gte: startOfDay, lte: endOfDay }
                    }
                });
                const teacherLeave = await (prisma as any).teacherLeaveRequest?.findFirst({
                    where: {
                        teacherId: activeSession.teacherId,
                        status: 'APPROVED',
                        startDate: { lte: now },
                        endDate: { gte: startOfDay }
                    }
                });
                if (teacherLeave) {
                    teacherPresenceStatus = teacherLeave.category || 'IZIN';
                    isTeacherAbsent = true;
                    teacherAttendanceNote = `Guru berstatus ${teacherPresenceStatus} (${teacherLeave.reason || '-'})`;
                } else if (teacherIn) {
                    teacherPresenceStatus = 'HADIR_DI_SEKOLAH';
                    teacherAttendanceNote = `Guru telah hadir di sekolah pukul ${new Date(teacherIn.scanTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
                } else {
                    teacherPresenceStatus = 'BELUM_HADIR_DI_SEKOLAH';
                    isTeacherAbsent = true;
                    teacherAttendanceNote = 'Guru belum presensi datang di sekolah hari ini';
                }
            }

            // Cek apakah siswa ini sudah melakukan OUT di sesi ini
            const studentAttendance = await (prisma as any).classPeriodAttendance.findUnique({
                where: {
                    sessionId_studentId: {
                        sessionId: activeSession.id,
                        studentId: user.id
                    }
                }
            });

            const isWindowOutActive = activeSession.outWindowStart && now >= new Date(activeSession.outWindowStart);
            const isSessionExpired = activeSession.endTime && now > new Date(new Date(activeSession.endTime).getTime() + 10 * 60 * 1000);

            // Hitung sisa waktu mundur jendela OUT
            let remainingSeconds = 0;
            if (activeSession.endTime) {
                const diffMs = new Date(activeSession.endTime).getTime() - now.getTime();
                remainingSeconds = Math.max(0, Math.floor(diffMs / 1000));
            }

            return res.json({
                role: 'STUDENT',
                hasActiveSession: true,
                session: activeSession,
                isGateIn: !!gateInToday,
                isHomeViaBk,
                homeBkReason,
                teacherPresenceStatus,
                isTeacherAbsent,
                teacherAttendanceNote,
                isStudentOut: !!studentAttendance,
                outTimeStr: studentAttendance?.outTime ? new Date(studentAttendance.outTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null,
                isWindowOutActive: isWindowOutActive && !isSessionExpired,
                remainingSeconds,
                currentTimeStr: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                studentStatus: studentAttendance?.status || (isHomeViaBk ? 'PULANG_BK' : (gateInToday ? 'IN_CLASS' : 'UNENTERED'))
            });
        }
    } catch (error: any) {
        console.error('Error in getActiveClassSession:', error);
        return res.status(500).json({ message: 'Gagal memuat status sesi kelas: ' + error.message });
    }
};

/**
 * 3. Siswa Tap "ABSEN OUT" (1 Tap per JP pada jendela 5 menit terakhir)
 */
export const studentOutClassSession = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { lat, lng, isFakeGps, deviceId } = req.body;
        const now = new Date();

        if (user.role !== 'STUDENT') {
            return res.status(403).json({ message: 'Hanya siswa yang dapat melakukan Absen OUT' });
        }

        const userClass = user.className;
        if (!userClass) {
            return res.status(400).json({ message: 'Akun Anda belum terdaftar dalam kelas' });
        }

        // 1. Cari sesi aktif kelas
        const classVariations = normalizeClassVariations(userClass);
        const activeSession = await (prisma as any).classPeriodSession.findFirst({
            where: {
                className: { in: classVariations.length > 0 ? classVariations : [userClass] },
                status: 'ACTIVE'
            },
            orderBy: { inTime: 'desc' }
        });

        if (!activeSession) {
            return res.status(400).json({ message: '❌ Tidak ada sesi pelajaran aktif di kelas Anda saat ini' });
        }

        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        // 1.A VALIDASI GATE IN (Presensi Masuk Gerbang)
        const gateInToday = await prisma.attendance.findFirst({
            where: {
                userId: user.id,
                type: 'GATE_IN',
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        if (!gateInToday) {
            return res.status(403).json({
                success: false,
                notGateIn: true,
                message: '🚨 Presensi Jam Pelajaran Ditolak!\n\nAnda belum melakukan presensi masuk di SMP Negeri 1 Boyolangu hari ini. Presensi mata pelajaran hanya berlaku bagi siswa yang telah tercatat hadir di kelas.'
            });
        }

        // 1.B VALIDASI PULANG LEBIH AWAL VIA BK / UKS
        const uksHome = await (prisma as any).uksVisitEvent?.findFirst({
            where: {
                siswaId: user.id,
                tanggal: { gte: startOfDay, lte: endOfDay },
                status: { in: ['PULANG', 'PERLU_DIJEMPUT', 'DIRUJUK_RS'] }
            }
        });

        const bkGatepassToday = await prisma.gatepassRequest.findFirst({
            where: {
                studentId: user.id,
                status: { in: ['APPROVED', 'COMPLETED'] },
                verifiedAt: { gte: startOfDay, lte: endOfDay }
            }
        });

        const leaveApproved = await prisma.studentLeaveRequest.findFirst({
            where: {
                studentId: user.id,
                status: 'APPROVED',
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            }
        });

        const permitApproved = await (prisma as any).studentLeavePermit?.findFirst({
            where: {
                siswaId: user.id,
                status: 'APPROVED',
                tanggal: { gte: startOfDay, lte: endOfDay }
            }
        });

        // Hanya kecualikan jika siswa benar-benar dipulangkan via UKS/BK hari ini ATAU belum pernah Gate-In masuk hari ini
        if (uksHome || bkGatepassToday || (!gateInToday && (leaveApproved || permitApproved))) {
            const reason = uksHome ? `Rujukan Pulang UKS (${uksHome.keluhan})` :
                           (bkGatepassToday ? `Gatepass Pulang BK (${bkGatepassToday.reason})` :
                           (leaveApproved ? `Izin BK/Sekolah (${leaveApproved.reason})` : 'Izin Pulang Resmi via BK'));
            return res.status(403).json({
                success: false,
                isHomeViaBk: true,
                message: `ℹ️ Presensi Dikecualikan!\n\nAnda telah tercatat Izin Pulang Lebih Awal resmi via BK/UKS (${reason}). Status kehadiran mata pelajaran otomatis diakui sebagai Izin Resmi BK.`
            });
        }

        // 2. Cek apakah sudah pernah OUT
        const existing = await (prisma as any).classPeriodAttendance.findUnique({
            where: {
                sessionId_studentId: {
                    sessionId: activeSession.id,
                    studentId: user.id
                }
            }
        });

        if (existing) {
            const formatted = new Date(existing.outTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            return res.json({
                success: true,
                message: `✔ Anda sudah Absen OUT pada pukul ${formatted} WIB`,
                alreadyOut: true
            });
        }

        // 3. Verifikasi Geofence Lokasi Kelas jika koordinat disertakan
        let isLocationValid = true;
        const classRoom = await prisma.class.findUnique({ where: { name: userClass } });
        if (classRoom && classRoom.lat && classRoom.lng && lat && lng) {
            const distance = calculateDistanceMeters(Number(lat), Number(lng), classRoom.lat, classRoom.lng);
            if (distance > (classRoom.radiusMeters || 20) + 15) { // Toleransi 15 meter
                isLocationValid = false;
            }
        }

        // Jika terdeteksi Fake GPS / MOCK
        if (isFakeGps) {
            isLocationValid = false;
        }

        // 4. Verifikasi Device Binding
        let isDeviceValid = true;
        if (deviceId && user.deviceBindingId) {
            if (deviceId !== user.deviceBindingId) {
                isDeviceValid = false;
            }
        } else if (deviceId && !user.deviceBindingId) {
            // Auto bind jika belum ada
            await prisma.user.update({
                where: { id: user.id },
                data: { deviceBindingId: deviceId }
            });
        }

        const finalStatus = (isLocationValid && isDeviceValid) ? 'PRESENT' : 'TRUANT';
        const noteMsg = !isLocationValid 
            ? 'Terindikasi di luar kelas saat Absen OUT' 
            : (!isDeviceValid ? 'Device tidak cocok' : 'Absen OUT Tepat Waktu');

        // 5. Catat Absen OUT siswa
        await (prisma as any).classPeriodAttendance.create({
            data: {
                sessionId: activeSession.id,
                studentId: user.id,
                studentName: user.name,
                className: userClass,
                outTime: now,
                status: finalStatus,
                method: '1_TAP_OUT',
                lat: lat ? Number(lat) : null,
                lng: lng ? Number(lng) : null,
                isFakeGps: Boolean(isFakeGps),
                deviceId: deviceId || null
            }
        });

        // 6. Update studentOutCount di sesi kelas
        await (prisma as any).classPeriodSession.update({
            where: { id: activeSession.id },
            data: {
                studentOutCount: { increment: 1 }
            }
        });

        // 7. Notifikasi ke orang tua untuk presensi matpel ditiadakan sesuai kebijakan sekolah (tidak spamming setiap JP)
        // Notifikasi orang tua hanya untuk presensi gerbang pagi/sore, keterlambatan, atau dispensasi keluar BK.

        const outTimeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        return res.json({
            success: true,
            message: `✔ ABSEN OUT Berhasil (${outTimeStr} WIB)! Status Kehadiran: ${finalStatus === 'PRESENT' ? 'HADIR' : 'TERINDIKASI BOLOS'}.`,
            status: finalStatus,
            outTimeStr
        });
    } catch (error: any) {
        console.error('Error in studentOutClassSession:', error);
        return res.status(500).json({ message: 'Gagal mencatat Absen OUT: ' + error.message });
    }
};

/**
 * 4. Rutinitas Auto-Close & Auto-OUT Siswa
 * Jika JP selesai + 10 menit dan siswa tidak klik tapi berada di kelas -> Auto-OUT (Hadir).
 */
export const performAutoCloseExpiredSessions = async () => {
    try {
        const now = new Date();
        const expiredSessions = await (prisma as any).classPeriodSession.findMany({
            where: {
                status: 'ACTIVE',
                endTime: {
                    lt: new Date(now.getTime() - 10 * 60 * 1000) // Selesai lebih dari 10 menit lalu
                }
            }
        });

        for (const sess of expiredSessions) {
            // Ambil seluruh siswa di kelas tersebut
            const classVariations = normalizeClassVariations(sess.className);
            const students = await prisma.user.findMany({
                where: { role: 'STUDENT', className: { in: classVariations.length > 0 ? classVariations : [sess.className] } }
            });

            // Ambil rekaman yang sudah OUT
            const attendedList = await (prisma as any).classPeriodAttendance.findMany({
                where: { sessionId: sess.id }
            });
            const attendedStudentIds = new Set(attendedList.map((a: any) => a.studentId));

            // Ambil data Gate-In siswa hari ini
            const startOfDay = new Date(sess.inTime);
            startOfDay.setHours(0, 0, 0, 0);
            const gateInsToday = await prisma.attendance.findMany({
                where: {
                    type: 'GATE_IN',
                    scanTime: { gte: startOfDay }
                }
            });
            const gateInUserIds = new Set(gateInsToday.map(g => g.userId));

            // Ambil siswa yang izin pulang via UKS / BK hari ini
            const uksHomesToday = await (prisma as any).uksVisitEvent?.findMany({
                where: {
                    tanggal: { gte: startOfDay },
                    status: { in: ['PULANG', 'PERLU_DIJEMPUT', 'DIRUJUK_RS'] }
                }
            }) || [];
            const uksHomeUserIds = new Set(uksHomesToday.map((u: any) => u.siswaId));

            const leavesToday = await prisma.studentLeaveRequest.findMany({
                where: {
                    status: 'APPROVED',
                    startDate: { lte: sess.endTime || now },
                    endDate: { gte: startOfDay }
                }
            });
            const leaveUserIds = new Set(leavesToday.map(l => l.studentId));

            // Ambil siswa yang sah checkout dari meja BK hari ini
            const checkedOutBkLeaves = await (prisma as any).studentLeave.findMany({
                where: {
                    status: 'checked_out',
                    appliedAt: { gte: startOfDay }
                }
            }).catch(() => []);
            const bkCheckedOutUserIds = new Set((checkedOutBkLeaves || []).map((l: any) => l.studentId));

            for (const st of students) {
                if (!attendedStudentIds.has(st.id)) {
                    const isUksOrBkLeave = uksHomeUserIds.has(st.id) || leaveUserIds.has(st.id) || bkCheckedOutUserIds.has(st.id);
                    const isPresentAtSchool = gateInUserIds.has(st.id);

                    if (isUksOrBkLeave) {
                        // Siswa izin pulang resmi via BK/UKS
                        await (prisma as any).classPeriodAttendance.create({
                            data: {
                                sessionId: sess.id,
                                studentId: st.id,
                                studentName: st.name,
                                className: sess.className,
                                outTime: null,
                                status: 'PULANG_BK',
                                method: 'AUTO_BK_PERMIT'
                            }
                        });
                    } else if (isPresentAtSchool) {
                        // Siswa hadir di sekolah pagi hari tapi tidak masuk kelas -> Divonis BOLOS
                        await (prisma as any).classPeriodAttendance.create({
                            data: {
                                sessionId: sess.id,
                                studentId: st.id,
                                studentName: st.name,
                                className: sess.className,
                                outTime: null,
                                status: 'TRUANT',
                                method: 'AUTO_TRUANT'
                            }
                        });

                        // Panggil Hook Anti-Bolos: Potong poin pelanggaran & kirim notif darurat WA ortu
                        try {
                            const { antiTruantCheckHook } = await import('./bkLeaveExitPassController');
                            await antiTruantCheckHook(st.id, sess.teacherId, {
                                className: sess.className,
                                subjectName: sess.subjectName
                            });
                        } catch (hookErr) {
                            console.warn('Anti-truant hook invocation:', hookErr);
                        }
                    } else {
                        // Siswa tidak hadir di sekolah sejak pagi -> Tidak Masuk Sekolah
                        await (prisma as any).classPeriodAttendance.create({
                            data: {
                                sessionId: sess.id,
                                studentId: st.id,
                                studentName: st.name,
                                className: sess.className,
                                outTime: null,
                                status: 'ABSENT',
                                method: 'AUTO_ABSENT'
                            }
                        });
                    }
                }
            }

            // Update sesi menjadi CLOSED
            await (prisma as any).classPeriodSession.update({
                where: { id: sess.id },
                data: { status: 'CLOSED' }
            });
        }
    } catch (e) {
        console.error('Error in performAutoCloseExpiredSessions:', e);
    }
};

/**
 * 5. CRUD Master Jam Pelajaran (Role OPERATOR)
 */
export const getOperatorSchedules = async (req: Request, res: Response) => {
    try {
        const { day, className, teacherName } = req.query;
        const whereClause: any = {};
        if (day && day !== 'ALL') whereClause.day = String(day);
        if (className && className !== 'ALL') whereClause.className = String(className);
        if (teacherName && teacherName !== 'ALL') whereClause.teacherName = { contains: String(teacherName) };

        const schedules = await (prisma as any).classPeriodSchedule.findMany({
            where: whereClause,
            orderBy: [{ day: 'asc' }, { periodIndex: 'asc' }]
        });

        res.json({ success: true, schedules });
    } catch (error: any) {
        res.status(500).json({ message: 'Gagal memuat jadwal pelajaran: ' + error.message });
    }
};

export const createOperatorSchedule = async (req: Request, res: Response) => {
    try {
        const { day, periodIndex, startTime, endTime, className, subjectName, teacherName, roomName, isBreak } = req.body;

        if (!day || !startTime || !endTime) {
            return res.status(400).json({ message: 'Hari, Jam Mulai, dan Jam Selesai wajib diisi' });
        }

        const schedule = await (prisma as any).classPeriodSchedule.create({
            data: {
                day,
                periodIndex: Number(periodIndex) || 1,
                startTime,
                endTime,
                className: className || '-',
                subjectName: subjectName || (isBreak ? 'Istirahat' : 'Mata Pelajaran'),
                teacherName: teacherName || '-',
                roomName: roomName || `Ruang ${className || 'Kelas'}`,
                isBreak: Boolean(isBreak)
            }
        });

        try {
            const io = req.app.get('io');
            if (io) {
                io.emit('schedule_updated', { action: 'create', schedule });
            }
        } catch (sockErr) {}

        res.json({ success: true, message: 'Jadwal pelajaran berhasil ditambahkan', schedule });
    } catch (error: any) {
        res.status(500).json({ message: 'Gagal membuat jadwal pelajaran: ' + error.message });
    }
};

export const updateOperatorSchedule = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const updated = await (prisma as any).classPeriodSchedule.update({
            where: { id },
            data: {
                day: data.day,
                periodIndex: Number(data.periodIndex),
                startTime: data.startTime,
                endTime: data.endTime,
                className: data.className,
                subjectName: data.subjectName,
                teacherName: data.teacherName,
                roomName: data.roomName,
                isBreak: Boolean(data.isBreak)
            }
        });

        try {
            const io = req.app.get('io');
            if (io) {
                io.emit('schedule_updated', { action: 'update', schedule: updated });
            }
        } catch (sockErr) {}

        res.json({ success: true, message: 'Jadwal berhasil diperbarui', schedule: updated });
    } catch (error: any) {
        res.status(500).json({ message: 'Gagal memperbarui jadwal: ' + error.message });
    }
};

export const deleteOperatorSchedule = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await (prisma as any).classPeriodSchedule.delete({ where: { id } });

        try {
            const io = req.app.get('io');
            if (io) {
                io.emit('schedule_updated', { action: 'delete', id });
            }
        } catch (sockErr) {}

        res.json({ success: true, message: 'Jadwal berhasil dihapus' });
    } catch (error: any) {
        res.status(500).json({ message: 'Gagal menghapus jadwal: ' + error.message });
    }
};

export const generateDefaultSchedules = async (req: Request, res: Response) => {
    try {
        const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
        const allDbClasses = await prisma.class.findMany({ select: { id: true, name: true } });
        const sampleClasses = allDbClasses.length > 0
            ? allDbClasses.map(c => c.name)
            : ['VII-A', 'VII-B', 'VII-C', 'VII-D', 'VII-E', 'VII-F', 'VII-G', 'VII-H', 'VII-I', 'VII-J', 'VII-K',
               'VIII-A', 'VIII-B', 'VIII-C', 'VIII-D', 'VIII-E', 'VIII-F', 'VIII-G', 'VIII-H', 'VIII-I', 'VIII-J', 'VIII-K',
               'IX-A', 'IX-B', 'IX-C', 'IX-D', 'IX-E', 'IX-F', 'IX-G', 'IX-H', 'IX-I', 'IX-J', 'IX-K'];

        // Ambil daftar guru riil dari database
        const realTeachers = await prisma.user.findMany({
            where: { role: 'TEACHER' },
            select: { id: true, name: true, teachingSubject: true, teachingClasses: true, className: true }
        });

        // Ambil mapel riil dari database
        const dbSubjects = await prisma.subject.findMany({ select: { id: true, name: true } });
        const subjectNames = dbSubjects.length > 0
            ? dbSubjects.map(s => s.name)
            : ['Matematika', 'Bahasa Indonesia', 'Ilmu Pengetahuan Alam (IPA)', 'Bahasa Inggris', 'Pendidikan Agama Islam (PAI)', 'Informatika', 'PPKn', 'Seni Budaya', 'PJOK'];

        const periods = [
            { idx: 1, start: '07:00', end: '07:45', name: 'Matematika' },
            { idx: 2, start: '07:45', end: '08:30', name: 'Matematika' },
            { idx: 3, start: '08:30', end: '09:15', name: 'Bahasa Indonesia' },
            { idx: 4, start: '09:15', end: '10:00', name: 'Bahasa Indonesia' },
            { idx: 5, start: '10:00', end: '10:30', name: 'Istirahat Pertama', isBreak: true },
            { idx: 6, start: '10:30', end: '11:15', name: 'Ilmu Pengetahuan Alam (IPA)' },
            { idx: 7, start: '11:15', end: '12:00', name: 'Ilmu Pengetahuan Alam (IPA)' },
            { idx: 8, start: '12:00', end: '12:45', name: 'Istirahat & Sholat', isBreak: true },
            { idx: 9, start: '12:45', end: '13:30', name: 'Bahasa Inggris' },
            { idx: 10, start: '13:30', end: '14:15', name: 'Bahasa Inggris' }
        ];

        let createdCount = 0;
        let teacherCursor = 0;

        for (const day of days) {
            for (let cIdx = 0; cIdx < sampleClasses.length; cIdx++) {
                const cls = sampleClasses[cIdx];
                for (const p of periods) {
                    const exists = await (prisma as any).classPeriodSchedule.findFirst({
                        where: { day, className: cls, periodIndex: p.idx }
                    });

                    if (!exists) {
                        let assignedTeacherId: string | null = null;
                        let assignedTeacherName = '-';

                        if (!p.isBreak) {
                            if (realTeachers.length > 0) {
                                const getSubjectKey = (s: string) => {
                                    if (!s) return '';
                                    const lower = s.toLowerCase();
                                    if (lower.includes('matematika')) return 'matematika';
                                    if (lower.includes('indonesia')) return 'indonesia';
                                    if (lower.includes('inggris')) return 'inggris';
                                    if (lower.includes('ipa') || lower.includes('alam')) return 'ipa';
                                    if (lower.includes('ips') || lower.includes('sosial')) return 'ips';
                                    if (lower.includes('pai') || lower.includes('agama islam') || lower.includes('islam')) return 'pai';
                                    if (lower.includes('kristen')) return 'kristen';
                                    if (lower.includes('pjok') || lower.includes('penjas') || lower.includes('olahraga')) return 'pjok';
                                    if (lower.includes('seni') || lower.includes('budaya')) return 'seni';
                                    if (lower.includes('prakarya') || lower.includes('kewirausahaan')) return 'prakarya';
                                    if (lower.includes('jawa')) return 'jawa';
                                    if (lower.includes('informatika') || lower.includes('tik') || lower.includes('komputer')) return 'informatika';
                                    if (lower.includes('ppkn') || lower.includes('pancasila') || lower.includes('pkn')) return 'ppkn';
                                    if (lower.includes('bk') || lower.includes('konseling') || lower.includes('bimbingan')) return 'bk';
                                    return lower.replace(/[^a-z0-9]/g, '');
                                };
                                const sKey = getSubjectKey(p.name);
                                const matchedTeacher = realTeachers.find(t => {
                                    const tKey = getSubjectKey(t.teachingSubject || '');
                                    if (tKey !== sKey) return false;
                                    if (!t.teachingClasses) return false;
                                    return t.teachingClasses.split(',').map((c: string) => c.trim()).includes(cls);
                                }) || realTeachers.find(t => getSubjectKey(t.teachingSubject || '') === sKey) || realTeachers[teacherCursor % realTeachers.length];

                                assignedTeacherId = matchedTeacher.id;
                                assignedTeacherName = matchedTeacher.name;
                                teacherCursor++;
                            } else {
                                assignedTeacherName = 'Bpk. Guru Pengampu';
                            }
                        }

                        await (prisma as any).classPeriodSchedule.create({
                            data: {
                                day,
                                periodIndex: p.idx,
                                startTime: p.start,
                                endTime: p.end,
                                className: cls,
                                subjectName: p.name,
                                teacherId: assignedTeacherId,
                                teacherName: assignedTeacherName,
                                roomName: `Ruang Kelas ${cls}`,
                                isBreak: Boolean(p.isBreak)
                            }
                        });
                        createdCount++;
                    }
                }
            }
        }

        res.json({
            success: true,
            message: `Berhasil meng-generate ${createdCount} data jadwal standar dengan pemetaan guru riil SMPN 1 Boyolangu`,
            createdCount
        });
    } catch (error: any) {
        console.error('Error generateDefaultSchedules:', error);
        res.status(500).json({ message: 'Gagal generate jadwal: ' + error.message });
    }
};

/**
 * 6. Get Jadwal Mengajar Hari Ini untuk Guru (Menampilkan Status IN & Jumlah Siswa OUT)
 */
export const getTeacherTodayClassPeriods = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const now = new Date();
        const currentDay = days[now.getDay()];
        const reqDay = req.query.day ? String(req.query.day).trim() : null;
        const targetDay = reqDay || (currentDay === 'Minggu' ? 'Senin' : currentDay);
        const currentTimeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        // Cari jadwal hari ini / hari target di database
        let schedules = await (prisma as any).classPeriodSchedule.findMany({
            where: {
                day: targetDay,
                isBreak: false
            },
            orderBy: { periodIndex: 'asc' }
        });

        // Filter jika guru memiliki nama terdaftar
        if (user.name) {
            const filtered = schedules.filter((s: any) => s.teacherName && (s.teacherName.includes(user.name) || user.name.includes(s.teacherName) || (s.teacherId && s.teacherId === user.id)));
            if (filtered.length > 0) {
                schedules = filtered;
            } else {
                schedules = [];
            }
        }

        // Fallback: Ambil dari tabel master Schedule kurikulum
        if (schedules.length === 0) {
            const legacySchedules = await (prisma as any).schedule.findMany({
                where: {
                    OR: [
                        { teacherId: user.id },
                        { teacher: { name: { contains: user.name } } }
                    ],
                    day: targetDay
                },
                orderBy: { startTime: 'asc' }
            });
            if (legacySchedules.length > 0) {
                schedules = legacySchedules.map((ls: any, idx: number) => ({
                    id: ls.id,
                    day: ls.day,
                    periodIndex: idx + 1,
                    startTime: ls.startTime || '07:00',
                    endTime: ls.endTime || '08:20',
                    className: ls.className,
                    subjectName: ls.subject || user.teachingSubject || 'Mata Pelajaran',
                    teacherId: user.id,
                    teacherName: user.name,
                    roomName: `Ruang Kelas ${ls.className}`,
                    isBreak: false
                }));
            }
        }

        // Cek sesi aktif / sudah IN hari ini
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const sessionsToday = await (prisma as any).classPeriodSession.findMany({
            where: {
                inTime: { gte: startOfDay }
            }
        });

        const items = schedules.map((s: any) => {
            const sClassNorm = normalizeClassVariations(s.className);
            const matchSession = sessionsToday.find((sess: any) => 
                (sess.scheduleId === s.id) || 
                (sClassNorm.includes(sess.className) && sess.periodIndex === s.periodIndex)
            );

            const isAlreadyIn = !!matchSession;
            const inTimeFormatted = matchSession?.inTime ? new Date(matchSession.inTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;
            const studentOutCount = matchSession?.studentOutCount || 0;
            const totalStudents = matchSession?.totalStudents || 30;

            // Hitung status jendela waktu
            let canInNow = true;
            let timeStatus = 'ACTIVE_WINDOW';
            let statusMessage = 'Jam pelajaran aktif';

            if (s.startTime && s.startTime.includes(':') && s.endTime && s.endTime.includes(':')) {
                const [sH, sM] = s.startTime.split(':').map(Number);
                const [eH, eM] = s.endTime.split(':').map(Number);
                const scheduleStart = new Date(now);
                scheduleStart.setHours(sH, sM, 0, 0);
                const scheduleEnd = new Date(now);
                scheduleEnd.setHours(eH, eM, 0, 0);

                // Boleh IN maksimal 10 menit sebelum jam mulai
                const earliestIn = new Date(scheduleStart.getTime() - 10 * 60 * 1000);

                if (now < earliestIn) {
                    canInNow = false;
                    timeStatus = 'UPCOMING';
                    const startFormatted = s.startTime;
                    statusMessage = `Belum waktunya. Dibuka mulai ${earliestIn.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} (Mulai ${startFormatted} WIB)`;
                } else if (now > scheduleEnd) {
                    canInNow = false;
                    timeStatus = 'PAST';
                    statusMessage = `Jam pelajaran telah berakhir (${s.endTime} WIB)`;
                } else {
                    canInNow = !isAlreadyIn;
                    timeStatus = 'ACTIVE_WINDOW';
                    statusMessage = isAlreadyIn ? 'Sesi sedang berlangsung' : 'Jam pelajaran aktif, siap IN';
                }
            }

            return {
                id: s.id,
                periodIndex: s.periodIndex,
                startTime: s.startTime,
                endTime: s.endTime,
                timeRange: `${s.startTime} - ${s.endTime}`,
                className: s.className,
                subjectName: s.subjectName,
                roomName: s.roomName,
                isAlreadyIn,
                canInNow,
                timeStatus,
                statusMessage,
                inTimeFormatted,
                studentOutCount,
                totalStudents,
                sessionId: matchSession?.id || null,
                sessionStatus: matchSession?.status || 'PENDING'
            };
        });

        res.json({
            teacherName: user.name,
            day: currentDay,
            currentTime: currentTimeStr,
            schedules: items
        });
    } catch (error: any) {
        console.error('Error fetching teacher today class periods:', error);
        res.status(500).json({ message: 'Gagal memuat jadwal guru: ' + error.message });
    }
};

/**
 * 7. Get Daftar Siswa Kelas untuk Presensi Guru di Kelas (Dengan Deteksi Otomatis Siswa Sakit/Izin/UKS/Alpa Terkunci)
 */
export const getClassSessionStudentsStatus = async (req: Request, res: Response) => {
    try {
        const { className, sessionId } = req.query;
        if (!className) {
            return res.status(400).json({ success: false, message: 'Nama kelas wajib diisi' });
        }

        const classVariations = normalizeClassVariations(String(className));
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        // Ambil semua siswa di kelas ini
        const students = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                className: { in: classVariations.length > 0 ? classVariations : [String(className)] },
                isActive: true
            },
            select: {
                id: true,
                name: true,
                nisn: true,
                nis: true,
                gender: true,
                className: true
            },
            orderBy: { name: 'asc' }
        });

        // Ambil presensi gerbang hari ini
        const gateAttendances = await prisma.attendance.findMany({
            where: {
                userId: { in: students.map(s => s.id) },
                type: 'GATE_IN',
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });
        const gateMap = new Map<string, any>();
        gateAttendances.forEach(g => gateMap.set(g.userId, g));

        // Ambil izin resmi hari ini (Sakit / Izin)
        const leaves = await prisma.studentLeaveRequest.findMany({
            where: {
                studentId: { in: students.map(s => s.id) },
                status: 'APPROVED',
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            }
        });
        const leaveMap = new Map<string, any>();
        leaves.forEach(l => leaveMap.set(l.studentId, l));

        // Ambil UKS visit aktif hari ini
        const uksVisits = await (prisma as any).uksVisitEvent?.findMany({
            where: {
                siswaId: { in: students.map(s => s.id) },
                tanggal: { gte: startOfDay, lte: endOfDay }
            }
        }) || [];
        const uksMap = new Map<string, any>();
        uksVisits.forEach((u: any) => uksMap.set(u.siswaId, u));

        // Ambil data presensi sesi kelas jika sudah ada
        let sessionAttendanceMap = new Map<string, any>();
        if (sessionId) {
            const attendances = await (prisma as any).classPeriodAttendance.findMany({
                where: { sessionId: String(sessionId) }
            });
            attendances.forEach((a: any) => sessionAttendanceMap.set(a.studentId, a));
        }

        const studentStatusList = students.map(s => {
            const gate = gateMap.get(s.id);
            const leave = leaveMap.get(s.id);
            const uks = uksMap.get(s.id);
            const sessAtt = sessionAttendanceMap.get(s.id);

            let status = 'HADIR';
            let isLocked = false;
            let statusLabel = 'Hadir di Kelas';
            let lockReason = '';

            if (leave) {
                isLocked = true;
                const cat = (leave.category || 'IZIN').toUpperCase();
                if (cat.includes('SAKIT') || cat === 'SICK') {
                    status = 'SAKIT';
                    statusLabel = '🤒 Sakit (Surat Dokter)';
                    lockReason = `Siswa izin sakit: ${leave.reason || '-'}`;
                } else {
                    status = 'IZIN';
                    statusLabel = '📝 Izin Resmi';
                    lockReason = `Siswa izin resmi: ${leave.reason || '-'}`;
                }
            } else if (uks && ['PULANG', 'PERLU_DIJEMPUT', 'DIRUJUK_RS', 'SEDANG_DIRAWAT'].includes(uks.status)) {
                isLocked = true;
                status = 'UKS';
                statusLabel = '🩵 Sedang di Ruang UKS';
                lockReason = `Ditangani UKS: ${uks.keluhan || '-'}`;
            } else if (!gate && now.getHours() >= 8) {
                isLocked = true;
                status = 'ALPA';
                statusLabel = '❌ Tidak Hadir di Sekolah (Alpa)';
                lockReason = 'Tidak ada rekaman presensi gerbang (Alpa)';
            } else if (!gate) {
                isLocked = true;
                status = 'BELUM_HADIR';
                statusLabel = '⏳ Belum Scan Gerbang Masuk';
                lockReason = 'Siswa belum melakukan presensi masuk gerbang';
            }

            return {
                id: s.id,
                name: s.name,
                nisn: s.nisn || s.nis || '-',
                gender: s.gender || '-',
                className: s.className || className,
                isGateIn: !!gate,
                gateInTime: gate?.scanTime ? new Date(gate.scanTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null,
                status: sessAtt ? sessAtt.status : status,
                statusLabel,
                isLocked,
                lockReason,
                isConfirmedInClass: sessAtt ? (sessAtt.status === 'HADIR' || sessAtt.status === 'PRESENT') : !isLocked
            };
        });

        res.json({
            success: true,
            className,
            totalStudents: students.length,
            presentCount: studentStatusList.filter(s => !s.isLocked).length,
            absentLockedCount: studentStatusList.filter(s => s.isLocked).length,
            students: studentStatusList
        });
    } catch (err: any) {
        console.error('Error in getClassSessionStudentsStatus:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat status siswa kelas: ' + err.message });
    }
};

/**
 * 8. Guru Submit Konfirmasi Presensi Siswa di Kelas
 */
export const confirmClassSessionStudents = async (req: Request, res: Response) => {
    try {
        const { sessionId, attendanceList } = req.body;
        if (!sessionId || !Array.isArray(attendanceList)) {
            return res.status(400).json({ success: false, message: 'Session ID dan daftar presensi wajib disertakan' });
        }

        const session = await (prisma as any).classPeriodSession.findUnique({
            where: { id: sessionId }
        });
        if (!session) {
            return res.status(404).json({ success: false, message: 'Sesi kelas tidak ditemukan' });
        }

        const now = new Date();
        let confirmedCount = 0;

        for (const item of attendanceList) {
            const studentId = item.studentId;
            const studentName = item.studentName || 'Siswa';
            const className = item.className || session.className;
            const status = item.status || 'HADIR'; // HADIR, SAKIT, IZIN, ALPA, UKS

            await (prisma as any).classPeriodAttendance.upsert({
                where: {
                    sessionId_studentId: {
                        sessionId,
                        studentId
                    }
                },
                update: {
                    status,
                    outTime: status === 'HADIR' ? now : null
                },
                create: {
                    sessionId,
                    studentId,
                    studentName,
                    className,
                    status,
                    method: 'TEACHER_VERIFIED',
                    outTime: status === 'HADIR' ? now : null,
                    createdAt: now
                }
            });
            if (status === 'HADIR') confirmedCount++;
        }

        // Update student count in session
        await (prisma as any).classPeriodSession.update({
            where: { id: sessionId },
            data: {
                studentOutCount: confirmedCount,
                updatedAt: now
            }
        });

        // Broadcast to monitoring
        if ((global as any).emitEmptyClassUpdate) {
            (global as any).emitEmptyClassUpdate({
                type: 'STUDENTS_ATTENDANCE_CONFIRMED',
                sessionId,
                className: session.className,
                confirmedCount,
                timestamp: now
            });
        }

        res.json({
            success: true,
            message: `✔ Presensi kelas ${session.className} berhasil disimpan (${confirmedCount} siswa hadir)`,
            confirmedCount
        });
    } catch (err: any) {
        console.error('Error in confirmClassSessionStudents:', err);
        res.status(500).json({ success: false, message: 'Gagal menyimpan presensi kelas: ' + err.message });
    }
};

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
}
