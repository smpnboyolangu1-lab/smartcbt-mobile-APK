import { Request, Response } from 'express';
import prisma from '../utils/db';
import { formatTimeWib } from '../utils/dateUtils';
import jwt from 'jsonwebtoken';
import { extractWebToken, getSecretKey } from '../middlewares/authMiddleware';
import { getWibDayName, getWibTimeStr, mergeConsecutivePeriods } from './scheduleEngineController';

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

export const normalizeClassName = (raw: string | null | undefined): string => {
    if (!raw) return '';
    let s = raw.trim().toUpperCase().replace(/[\s_]+/g, '-');
    while (s.match(/^(ROOM|RUANG|KELAS)-+/)) {
        s = s.replace(/^(ROOM|RUANG|KELAS)-+/, '');
    }
    s = s.replace(/^7-?/, 'VII-');
    s = s.replace(/^8-?/, 'VIII-');
    s = s.replace(/^9-?/, 'IX-');
    s = s.replace(/^(VII|VIII|IX)([A-K])$/, '$1-$2');
    return s;
};

export const timeStrToMinutes = (timeStr: string): number => {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return (h * 60) + m;
};

export const minutesToTimeStr = (min: number): string => {
    const clamped = Math.max(0, Math.min(min, 1439));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export interface ScheduleValidationResult {
    isAllowed: boolean;
    errorType?: 'NO_SCHEDULE_TODAY' | 'TOO_EARLY' | 'SCHEDULE_EXPIRED';
    message: string;
    activeSlot?: any;
    targetClassName: string;
    windowOpenTime?: string;
    scheduleStartTime?: string;
    scheduleEndTime?: string;
    subjectName?: string;
}

export const validateTeacherClassSchedule = async (
    teacher: any,
    targetClass: string | null | undefined,
    currentDate = new Date()
): Promise<ScheduleValidationResult> => {
    if (!targetClass) {
        return {
            isAllowed: true,
            targetClassName: 'UMUM',
            message: 'Ruangan umum / non-kelas.'
        };
    }

    const normTarget = normalizeClassName(targetClass);

    // Role ADMIN dan OPERATOR memiliki hak bypass untuk kebutuhan monitoring & pemeliharaan teknis
    if (teacher.role === 'ADMIN' || teacher.role === 'OPERATOR') {
        return {
            isAllowed: true,
            targetClassName: normTarget,
            message: 'Akses administrator / operator sistem.'
        };
    }

    const currentWibDay = getWibDayName(currentDate);
    const currentWibTime = getWibTimeStr(currentDate);
    const nowMinutes = timeStrToMinutes(currentWibTime);

    // 1. Ambil jadwal hari ini di ClassPeriodSchedule
    const schedules = await (prisma as any).classPeriodSchedule.findMany({
        where: {
            day: { equals: currentWibDay, mode: 'insensitive' },
            isBreak: false,
            OR: [
                { teacherId: teacher.id },
                ...(teacher.name ? [{ teacherName: { contains: teacher.name, mode: 'insensitive' } }] : [])
            ]
        },
        orderBy: { periodIndex: 'asc' }
    });

    const mergedSchedules = mergeConsecutivePeriods(schedules);
    let targetSlots = mergedSchedules.filter((s: any) => normalizeClassName(s.className) === normTarget);

    // 2. Fallback: Cek TeachingSchedule jika di ClassPeriodSchedule kosong
    if (targetSlots.length === 0) {
        try {
            const tsRows = await (prisma as any).teachingSchedule.findMany({
                where: {
                    guruId: teacher.id,
                    hari: { equals: currentWibDay, mode: 'insensitive' }
                }
            });
            for (const ts of tsRows) {
                const classObj = await prisma.class.findFirst({
                    where: { id: ts.kelasId }
                }).catch(() => null);
                const tsClassName = classObj?.name || ts.kelasId;
                if (normalizeClassName(tsClassName) === normTarget) {
                    targetSlots.push({
                        id: ts.id,
                        day: ts.hari,
                        startTime: ts.jamMulai,
                        endTime: ts.jamSelesai,
                        className: tsClassName,
                        subjectName: teacher.teachingSubject || 'Mata Pelajaran'
                    });
                }
            }
        } catch (e) {}
    }

    // 3. Fallback: Cek penugasan guru piket / inval (substitute teacher) hari ini
    if (targetSlots.length === 0) {
        try {
            const hasInval = await (prisma as any).leaveRequest?.findFirst({
                where: {
                    substituteTeacherId: teacher.id,
                    status: 'APPROVED'
                }
            });
            if (hasInval) {
                const origSchedules = await (prisma as any).classPeriodSchedule.findMany({
                    where: {
                        teacherId: hasInval.teacherId,
                        day: { equals: currentWibDay, mode: 'insensitive' },
                        isBreak: false
                    },
                    orderBy: { periodIndex: 'asc' }
                });
                const origMerged = mergeConsecutivePeriods(origSchedules);
                const invalSlots = origMerged.filter((s: any) => normalizeClassName(s.className) === normTarget);
                if (invalSlots.length > 0) {
                    targetSlots = invalSlots;
                }
            }
        } catch (e) {}
    }

    // Jika tidak ada jadwal sama sekali di kelas ini hari ini
    if (targetSlots.length === 0) {
        return {
            isAllowed: false,
            errorType: 'NO_SCHEDULE_TODAY',
            message: `⛔ Presensi Ditolak!\n\nAnda tidak memiliki jadwal mengajar di kelas ${targetClass} pada hari ${currentWibDay}.\n\nPresensi masuk kelas hanya diperbolehkan pada kelas dan jam pelajaran yang sesuai dengan jadwal mengajar Anda.`,
            targetClassName: normTarget
        };
    }

    // 4. Periksa jendela waktu: 30 Menit sebelum jam mengajar sampai jam pelajaran selesai
    let activeSlot: any = null;
    let upcomingSlot: any = null;
    let expiredSlot: any = null;

    for (const slot of targetSlots) {
        const startMin = timeStrToMinutes(slot.startTime);
        const endMin = timeStrToMinutes(slot.endTime);
        const windowOpenMin = startMin - 30; // Tepat 30 menit sebelum jam KBM dimulai
        const windowCloseMin = endMin + 15; // Sampai jam KBM selesai (+15 menit toleransi penyelesaian)

        if (nowMinutes >= windowOpenMin && nowMinutes <= windowCloseMin) {
            activeSlot = slot;
            break;
        } else if (nowMinutes < windowOpenMin) {
            if (!upcomingSlot || timeStrToMinutes(slot.startTime) < timeStrToMinutes(upcomingSlot.startTime)) {
                upcomingSlot = slot;
            }
        } else {
            expiredSlot = slot;
        }
    }

    if (activeSlot) {
        const windowOpenTime = minutesToTimeStr(timeStrToMinutes(activeSlot.startTime) - 30);
        return {
            isAllowed: true,
            activeSlot,
            targetClassName: normTarget,
            windowOpenTime,
            scheduleStartTime: activeSlot.startTime,
            scheduleEndTime: activeSlot.endTime,
            subjectName: activeSlot.subjectName,
            message: `✅ Sesi KBM Diizinkan (${activeSlot.startTime} - ${activeSlot.endTime} WIB).`
        };
    }

    if (upcomingSlot) {
        const startMin = timeStrToMinutes(upcomingSlot.startTime);
        const windowOpenMin = startMin - 30;
        const windowOpenTime = minutesToTimeStr(windowOpenMin);
        return {
            isAllowed: false,
            errorType: 'TOO_EARLY',
            message: `⏳ Presensi Belum Dibuka!\n\nJadwal mengajar Anda di kelas ${targetClass} (${upcomingSlot.subjectName}) adalah pukul ${upcomingSlot.startTime} - ${upcomingSlot.endTime} WIB.\n\nTombol presensi masuk baru dapat diakses pukul ${windowOpenTime} WIB (30 menit sebelum jam mengajar).`,
            targetClassName: normTarget,
            windowOpenTime,
            scheduleStartTime: upcomingSlot.startTime,
            scheduleEndTime: upcomingSlot.endTime,
            subjectName: upcomingSlot.subjectName
        };
    }

    const lastSlot = expiredSlot || targetSlots[targetSlots.length - 1];
    return {
        isAllowed: false,
        errorType: 'SCHEDULE_EXPIRED',
        message: `⏰ Jam Pelajaran Telah Berakhir!\n\nJadwal mengajar Anda di kelas ${targetClass} (${lastSlot.subjectName}) pukul ${lastSlot.startTime} - ${lastSlot.endTime} WIB telah selesai untuk hari ini.`,
        targetClassName: normTarget,
        scheduleStartTime: lastSlot.startTime,
        scheduleEndTime: lastSlot.endTime,
        subjectName: lastSlot.subjectName
    };
};

// ========================================================
// MODUL ESTAFET SESI MENGAJAR GURU (ROOM HANDOVER VIA NFC/QR)
// DAN PRESENSI MATA PELAJARAN SISWA TERINTEGRASI GERBANG PAGI
// ========================================================

/**
 * Inisialisasi daftar ruangan fisik default sekolah jika belum ada di database
 */
export const ensureDefaultPhysicalRooms = async () => {
    try {
        const count = await (prisma as any).physicalRoom.count();
        if (count === 0) {
            const classes = [
                'VII-A', 'VII-B', 'VII-C', 'VII-D', 'VII-E', 'VII-F', 'VII-G', 'VII-H', 'VII-I', 'VII-J', 'VII-K',
                'VIII-A', 'VIII-B', 'VIII-C', 'VIII-D', 'VIII-E', 'VIII-F', 'VIII-G', 'VIII-H', 'VIII-I', 'VIII-J', 'VIII-K',
                'IX-A', 'IX-B', 'IX-C', 'IX-D', 'IX-E', 'IX-F', 'IX-G', 'IX-H', 'IX-I', 'IX-J', 'IX-K'
            ];

            const roomData = classes.map((c, idx) => ({
                roomCode: `ROOM_${c.replace('-', '_')}`,
                roomName: `Ruang Kelas ${c}`,
                nfcTagUid: `NFC_TAG_${c.replace('-', '_')}`,
                qrSecretToken: `QR_ROOM_${c.replace('-', '_')}_SEC_2026`,
                className: c,
                building: idx < 11 ? 'Gedung A (Kelas VII)' : idx < 22 ? 'Gedung B (Kelas VIII)' : 'Gedung C (Kelas IX)',
                floor: (idx % 11) < 6 ? 1 : 2,
                isActive: true
            }));

            for (const item of roomData) {
                await (prisma as any).physicalRoom.create({ data: item });
            }
            console.log(`✅ Initialized ${roomData.length} physical classroom rooms for teacher room handover.`);
        }
    } catch (e: any) {
        console.warn('Init physical rooms notice:', e.message);
    }
};

/**
 * 1. Guru Check-In Sesi Mengajar via NFC Tap / Scan QR Ruang Kelas
 * POST /api/v1/teacher/session/checkin
 * Body: { roomCode?, nfcTagUid?, qrSecretToken?, forceHandover?: boolean, subjectName?: string }
 */
export const checkInTeachingSession = async (req: Request, res: Response) => {
    try {
        const teacherId = (req as any).user?.id;
        const { roomCode, nfcTagUid, qrSecretToken, forceHandover, subjectName, lat, lng, isFakeGps } = req.body;

        if (!teacherId) {
            return res.status(401).json({ success: false, message: 'Autentikasi guru diperlukan.' });
        }

        const teacher = await (prisma as any).user.findUnique({
            where: { id: teacherId }
        });

        if (!teacher) {
            return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan.' });
        }

        await ensureDefaultPhysicalRooms();

        // Cari ruangan berdasarkan salah satu identitas fisik
        let room = null;
        if (nfcTagUid) {
            room = await (prisma as any).physicalRoom.findFirst({
                where: { nfcTagUid: String(nfcTagUid).trim(), isActive: true }
            });
        }
        if (!room && qrSecretToken) {
            room = await (prisma as any).physicalRoom.findFirst({
                where: { qrSecretToken: String(qrSecretToken).trim(), isActive: true }
            });
        }
        if (!room && roomCode) {
            const rawRoom = String(roomCode).trim();
            const normalizedRoom = rawRoom.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
            const normalizedClass = rawRoom.toUpperCase().replace(/\s+/g, '-');
            const spaceClass = rawRoom.toUpperCase().replace(/-/g, ' ');
            room = await (prisma as any).physicalRoom.findFirst({
                where: {
                    OR: [
                        { roomCode: rawRoom },
                        { roomCode: `ROOM_${normalizedRoom}` },
                        { roomCode: normalizedRoom },
                        { className: rawRoom },
                        { className: normalizedClass },
                        { className: spaceClass },
                        { roomName: { contains: rawRoom } }
                    ],
                    isActive: true
                }
            });
        }

        // Fallback: pencarian berdasarkan pola nama kelas jika dikirimkan e.g. "VII-A"
        if (!room && (roomCode || qrSecretToken)) {
            const raw = (roomCode || qrSecretToken || '').toString().trim().toUpperCase();
            const rawClass = raw.replace(/\s+/g, '-');
            const spaceClass = raw.replace(/-/g, ' ');
            room = await (prisma as any).physicalRoom.findFirst({
                where: {
                    OR: [
                        { className: raw },
                        { className: rawClass },
                        { className: spaceClass },
                        { roomName: { contains: raw } },
                        { roomCode: { contains: raw.replace('-', '_') } }
                    ],
                    isActive: true
                }
            });
        }

        if (!room) {
            return res.status(404).json({
                success: false,
                message: 'Stiker NFC / QR Ruangan tidak dikenali di sistem. Pastikan memindai stiker ruangan resmi SMPN 1 Boyolangu.'
            });
        }

        if (!room.className) {
            return res.status(400).json({
                success: false,
                message: 'Presensi KBM wajib memilih ruang kelas rombel (contoh: VII-A, VIII-B). Presensi siswa dicatat berdasarkan rombel kelas.'
            });
        }

        // ========================================================
        // A0. VALIDASI GEOMAPPING RUANG KELAS (BUKAN LINGKUNGAN SEKOLAH UMUM)
        // ========================================================
        if (room.className && lat !== undefined && lng !== undefined && Number(lat) !== 0 && Number(lng) !== 0) {
            const classInfo = await prisma.class.findFirst({
                where: { name: room.className }
            });
            if (classInfo && classInfo.lat && classInfo.lng) {
                const distMeters = calculateDistanceMeters(Number(lat), Number(lng), classInfo.lat, classInfo.lng);
                const allowedRadius = (classInfo.radiusMeters || 15) + 20; // 35 meter batas toleransi ruang kelas
                if (distMeters > allowedRadius) {
                    return res.status(403).json({
                        success: false,
                        message: `📍 Presensi Kelas Ditolak!\n\nAnda terdeteksi berada di luar area ruang kelas ${room.className} (Jarak terdeteksi: ${Math.round(distMeters)} meter). Batas toleransi ruang kelas adalah ${allowedRadius} meter. Pastikan Anda sudah berada di dalam kelas saat presensi masuk.`
                    });
                }
            }
        }

        // ========================================================
        // A. VALIDASI JADWAL MENGAJAR & JENDELA WAKTU H-30 MENIT (KETAT)
        // ========================================================
        let assignedSubject = subjectName || teacher.teachingSubject;

        if (room.className && teacher.role === 'TEACHER') {
            const scheduleValidation = await validateTeacherClassSchedule(teacher, room.className);

            if (!scheduleValidation.isAllowed) {
                return res.status(422).json({
                    success: false,
                    error: scheduleValidation.errorType || 'INVALID_SCHEDULE',
                    message: scheduleValidation.message,
                    windowOpenTime: scheduleValidation.windowOpenTime,
                    scheduleStartTime: scheduleValidation.scheduleStartTime,
                    scheduleEndTime: scheduleValidation.scheduleEndTime,
                    targetClass: room.className
                });
            }

            if (scheduleValidation.activeSlot?.subjectName) {
                assignedSubject = scheduleValidation.activeSlot.subjectName;
            }
        }

        // ========================================================
        // B. SAFETY NET: PERIKSA SESI MENGAJAR AKTIF YANG MASIH GANTUNG
        // ========================================================
        const existingSession = await (prisma as any).teachingSession.findFirst({
            where: {
                teacherId: teacher.id,
                status: 'IN_PROGRESS'
            },
            include: {
                room: true
            }
        });

        if (existingSession) {
            // Jika guru tap ulang di ruangan yang SAMA persis -> kembalikan sesi yang sedang aktif
            if (existingSession.roomId === room.id) {
                const attendances = await (prisma as any).studentSubjectAttendance.findMany({
                    where: { sessionId: existingSession.id },
                    include: { student: { select: { id: true, name: true, nisn: true, profilePicUrl: true } } }
                });

                return res.json({
                    success: true,
                    message: `Sesi mengajar di ${room.roomName} sudah aktif.`,
                    session: existingSession,
                    room,
                    attendances
                });
            }

            // Jika guru tap di RUANGAN BARU tapi sesi di ruangan LAMA belum di-checkout
            if (!forceHandover) {
                const startTimeStr = formatTimeWib(existingSession.checkInTime);

                return res.status(409).json({
                    success: false,
                    error: 'LINGERING_SESSION',
                    message: `⚠️ Anda masih memiliki sesi mengajar aktif di ${existingSession.room?.roomName || 'Kelas Sebelumnya'} (dibuka pukul ${startTimeStr}).`,
                    activeSession: {
                        id: existingSession.id,
                        roomName: existingSession.room?.roomName,
                        className: existingSession.className,
                        subjectName: existingSession.subjectName,
                        checkInTime: existingSession.checkInTime,
                        startTimeStr
                    },
                    targetRoom: {
                        id: room.id,
                        roomName: room.roomName,
                        className: room.className
                    },
                    resolutionPrompt: 'Apakah Anda ingin menutup sesi sebelumnya otomatis (Auto-Handover) dan membuka sesi di kelas baru ini?'
                });
            } else {
                // Auto-close sesi lama dengan status 'CLOSED_BY_HANDOVER'
                await (prisma as any).teachingSession.update({
                    where: { id: existingSession.id },
                    data: {
                        status: 'CLOSED_BY_HANDOVER',
                        checkOutMethod: 'AUTO_HANDOVER',
                        checkOutTime: new Date(),
                        notes: `Ditutup otomatis oleh estafet ruangan baru ke ${room.roomName}`
                    }
                });
            }
        }

        // ========================================================
        // C. BUAT SESI MENGAJAR BARU DI RUANGAN
        // ========================================================
        const targetClassName = room.className || teacher.teachingClasses?.split(',')[0] || 'UMUM';
        if (!assignedSubject) {
            const normTarget = normalizeClassName(targetClassName);
            const sched = await (prisma as any).classPeriodSchedule.findFirst({
                where: {
                    OR: [
                        { teacherId: teacher.id },
                        ...(teacher.name ? [{ teacherName: { contains: teacher.name, mode: 'insensitive' } }] : [])
                    ]
                }
            });
            if (sched?.subjectName) assignedSubject = sched.subjectName;
        }
        if (!assignedSubject) assignedSubject = 'Mata Pelajaran';

        const newSession = await (prisma as any).teachingSession.create({
            data: {
                teacherId: teacher.id,
                roomId: room.id,
                className: targetClassName,
                subjectName: assignedSubject,
                checkInMethod: nfcTagUid ? 'NFC' : 'QR',
                status: 'IN_PROGRESS',
                academicYear: '2026/2027',
                semester: 'GANJIL'
            }
        });

        // ========================================================
        // D. SINKRONISASI DINAMIS DENGAN PRESENSI GERBANG PAGI SISWA
        // ========================================================
        // Ambil semua siswa di rombel kelas ini
        const studentsInClass = await (prisma as any).user.findMany({
            where: {
                className: targetClassName,
                role: 'STUDENT',
                isActive: true
            },
            select: { id: true, name: true, nisn: true, profilePicUrl: true }
        });

        // Sinkronisasi otomatis dengan ClassPeriodSession agar kartu di APK Siswa langsung aktif
        try {
            await (prisma as any).classPeriodSession.updateMany({
                where: {
                    OR: [
                        { teacherId: teacher.id, status: 'ACTIVE' },
                        { className: targetClassName, status: 'ACTIVE' }
                    ]
                },
                data: { status: 'CLOSED', endTime: new Date() }
            });

            const now = new Date();
            const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            await (prisma as any).classPeriodSession.create({
                data: {
                    teacherId: teacher.id,
                    teacherName: teacher.name,
                    className: targetClassName,
                    subjectName: assignedSubject,
                    periodIndex: 1,
                    timeRange: `${timeStr} - Selesai`,
                    startTimeStr: timeStr,
                    roomName: room.roomName,
                    inTime: now,
                    outWindowStart: now, // Langsung buka sesi presensi mandiri siswa
                    status: 'ACTIVE',
                    totalStudents: studentsInClass.length
                }
            });
        } catch (err: any) {
            console.warn('Sync classPeriodSession note:', err.message);
        }

        // Rekam presensi guru masuk kelas ke tabel riwayat kehadiran utama (Attendance)
        try {
            await (prisma as any).attendance.create({
                data: {
                    userId: teacher.id,
                    type: 'CLASS_IN',
                    method: nfcTagUid ? 'NFC' : (qrSecretToken ? 'QR' : 'MANUAL'),
                    status: 'PRESENT',
                    scanTime: new Date(),
                    note: `Presensi Guru Masuk Kelas: ${targetClassName} (${assignedSubject}) - ${room.roomName}`
                }
            });
        } catch (attErr: any) {
            console.warn('Sync teacher CLASS_IN attendance notice:', attErr.message);
        }

        // Ambil presensi gerbang masuk pagi hari ini untuk kelas ini
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Ambil presensi gerbang masuk pagi hari ini untuk kelas ini
        const morningAttendances = await (prisma as any).attendance.findMany({
            where: {
                userId: { in: studentsInClass.map((s: any) => s.id) },
                type: 'GATE_IN',
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        const morningMap = new Map<string, string>();
        for (const att of morningAttendances) {
            morningMap.set(att.userId, att.status); // PRESENT, LATE, SICK, PERMISSION, ABSENT
        }

        // Ambil permohonan izin orang tua yang disetujui Guru BK / Wali Kelas hari ini
        const approvedBkLeaves = await (prisma as any).studentLeaveRequest.findMany({
            where: {
                studentId: { in: studentsInClass.map((s: any) => s.id) },
                status: 'APPROVED',
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            }
        }).catch(() => []);
        const bkLeaveMap = new Map<string, any>();
        for (const bl of approvedBkLeaves) {
            bkLeaveMap.set(bl.studentId, bl);
        }

        // Ambil gatepass / dispensasi keluar UKS/BK hari ini
        const bkPasses = await (prisma as any).studentLeave.findMany({
            where: {
                studentId: { in: studentsInClass.map((s: any) => s.id) },
                status: { in: ['approved', 'checked_out'] },
                appliedAt: { gte: startOfDay }
            }
        }).catch(() => []);
        const bkPassMap = new Map<string, any>();
        for (const bp of bkPasses) {
            bkPassMap.set(bp.studentId, bp);
        }

        // Generate data kehadiran mata pelajaran
        const attendanceInserts = [];
        let initialSick = 0;
        let initialPermit = 0;

        for (const student of studentsInClass) {
            const morningStatus = morningMap.get(student.id) || 'NOT_ARRIVED';
            const bkLeave = bkLeaveMap.get(student.id);
            const bkPass = bkPassMap.get(student.id);

            let initialStatus = 'NOT_CHECKED_IN';
            let isLocked = false;
            let noteText: string | null = null;
            let gateStatusDisplay = morningStatus;

            if (bkLeave) {
                // Izin / Sakit dari counter orang tua disetujui Guru BK
                const cat = (bkLeave.category || '').toUpperCase();
                if (cat.includes('SAKIT')) {
                    initialStatus = 'SICK';
                    gateStatusDisplay = 'SAKIT (DISETUJUI BK)';
                    noteText = `Izin Sakit disetujui Guru BK: ${bkLeave.reason || 'Sakit'}`;
                    initialSick++;
                } else {
                    initialStatus = 'PERMISSION';
                    gateStatusDisplay = 'IZIN (DISETUJUI BK)';
                    noteText = `Izin resmi disetujui Guru BK: ${bkLeave.reason || 'Izin'}`;
                    initialPermit++;
                }
                isLocked = true;
            } else if (bkPass) {
                // Dispensasi keluar resmi dari Meja BK
                initialStatus = 'PERMISSION';
                gateStatusDisplay = 'DISPENSASI BK';
                noteText = `Dispensasi keluar/pulang disetujui Guru BK: ${bkPass.reason || 'Izin Keluar'}`;
                initialPermit++;
                isLocked = true;
            } else if (morningStatus === 'SICK' || morningStatus === 'PERMISSION') {
                initialStatus = morningStatus;
                isLocked = true; // Read-only flag: tidak boleh diabsen hadir secara sembarangan
                noteText = `Siswa tercatat ${morningStatus} di gerbang pagi`;
                if (morningStatus === 'SICK') initialSick++;
                if (morningStatus === 'PERMISSION') initialPermit++;
            }

            attendanceInserts.push({
                sessionId: newSession.id,
                studentId: student.id,
                status: initialStatus,
                morningGateStatus: gateStatusDisplay,
                isLockedByGate: isLocked,
                notes: noteText
            });
        }

        if (attendanceInserts.length > 0) {
            for (const att of attendanceInserts) {
                await (prisma as any).studentSubjectAttendance.create({ data: att });
            }
        }

        // Update jumlah awal di sesi mengajar
        await (prisma as any).teachingSession.update({
            where: { id: newSession.id },
            data: {
                studentCount: studentsInClass.length,
                sickCount: initialSick,
                permitCount: initialPermit
            }
        });

        const fullAttendances = await (prisma as any).studentSubjectAttendance.findMany({
            where: { sessionId: newSession.id },
            include: { student: { select: { id: true, name: true, nisn: true, profilePicUrl: true } } }
        });

        try {
            const io = req.app.get('io');
            if (io) {
                io.emit('room_handover_update', {
                    action: 'CHECK_IN',
                    sessionId: newSession.id,
                    roomId: room.id,
                    roomName: room.roomName,
                    className: targetClassName,
                    teacherId: teacher.id,
                    teacherName: teacher.name,
                    subjectName: assignedSubject,
                    status: 'IN_PROGRESS',
                    checkInTime: newSession.checkInTime
                });
            }
        } catch (sockErr) {}

        return res.json({
            success: true,
            message: `✅ Berhasil Check-in di ${room.roomName} (${targetClassName}) pukul ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}. Sesi presensi siswa kini terbuka!`,
            session: newSession,
            room,
            totalStudents: studentsInClass.length,
            attendances: fullAttendances
        });

    } catch (e: any) {
        console.error('Error in checkInTeachingSession:', e);
        return res.status(500).json({ success: false, message: 'Gagal melakukan check-in ruangan: ' + e.message });
    }
};

/**
 * 2. Guru Check-Out Sesi Mengajar & Simpan Ringkasan Jurnal KBM
 * POST /api/v1/teacher/session/checkout
 * Body: { sessionId?, teachingSummary?, notes? }
 */
export const checkOutTeachingSession = async (req: Request, res: Response) => {
    try {
        const teacherId = (req as any).user?.id;
        const { sessionId, teachingSummary, notes, lat, lng } = req.body;

        if (!teacherId) {
            return res.status(401).json({ success: false, message: 'Autentikasi guru diperlukan.' });
        }

        // Cari sesi aktif guru
        const session = await (prisma as any).teachingSession.findFirst({
            where: {
                id: sessionId || undefined,
                teacherId: teacherId,
                status: 'IN_PROGRESS'
            },
            include: { room: true }
        });

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Tidak ada sesi mengajar aktif yang dapat ditutup.'
            });
        }

        // Validasi Geomapping Ruang Kelas saat Presensi Keluar
        if (session.className && lat !== undefined && lng !== undefined && Number(lat) !== 0 && Number(lng) !== 0) {
            const classInfo = await prisma.class.findFirst({
                where: { name: session.className }
            });
            if (classInfo && classInfo.lat && classInfo.lng) {
                const distMeters = calculateDistanceMeters(Number(lat), Number(lng), classInfo.lat, classInfo.lng);
                const allowedRadius = (classInfo.radiusMeters || 15) + 30; // 45 meter toleransi radius kelas
                if (distMeters > allowedRadius) {
                    return res.status(403).json({
                        success: false,
                        message: `📍 Presensi Keluar Ditolak!\n\nAnda terdeteksi berada di luar area ruang kelas ${session.className} (Jarak terdeteksi: ${Math.round(distMeters)} meter). Presensi keluar kelas harus dilakukan saat Anda berada di dalam ruang kelas.`
                    });
                }
            }
        }

        // Hitung rekapitulasi kehadiran siswa
        const attendances = await (prisma as any).studentSubjectAttendance.findMany({
            where: { sessionId: session.id }
        });

        let present = 0;
        let truant = 0;
        let sick = 0;
        let permit = 0;
        let absent = 0;

        for (const a of attendances) {
            if (a.status === 'PRESENT') present++;
            else if (a.status === 'TRUANT' || a.status === 'BOLOS') truant++;
            else if (a.status === 'SICK' || a.status === 'SAKIT') sick++;
            else if (a.status === 'PERMISSION' || a.status === 'IZIN') permit++;
            else absent++;
        }

        const updatedSession = await (prisma as any).teachingSession.update({
            where: { id: session.id },
            data: {
                status: 'COMPLETED',
                checkOutTime: new Date(),
                checkOutMethod: 'MANUAL',
                teachingSummary: teachingSummary || 'KBM terlaksana dengan baik.',
                notes: notes || null,
                presentCount: present,
                truantCount: truant,
                sickCount: sick,
                permitCount: permit,
                absentCount: absent
            }
        });

        // Tutup ClassPeriodSession aktif kelas ini agar status di APK Siswa kembali ke idle
        try {
            await (prisma as any).classPeriodSession.updateMany({
                where: {
                    className: session.className,
                    teacherId: teacherId,
                    status: 'ACTIVE'
                },
                data: { status: 'CLOSED', endTime: new Date() }
            });
        } catch (err: any) {
            console.warn('Close classPeriodSession note:', err.message);
        }

        // Rekam presensi guru keluar kelas ke tabel riwayat kehadiran utama (Attendance)
        try {
            await (prisma as any).attendance.create({
                data: {
                    userId: teacherId,
                    type: 'CLASS_OUT',
                    method: 'MANUAL',
                    status: 'PRESENT',
                    scanTime: new Date(),
                    note: `Presensi Guru Keluar Kelas: ${session.className} (${session.subjectName}) - ${teachingSummary || 'Selesai KBM'}`
                }
            });
        } catch (attErr: any) {
            console.warn('Sync teacher CLASS_OUT attendance notice:', attErr.message);
        }

        try {
            const io = req.app.get('io');
            if (io) {
                io.emit('room_handover_update', {
                    action: 'CHECK_OUT',
                    sessionId: session.id,
                    className: session.className,
                    teacherId: teacherId,
                    status: 'COMPLETED',
                    checkOutTime: new Date()
                });
            }
        } catch (sockErr) {}

        return res.json({
            success: true,
            message: `✅ Sesi mengajar di ${session.room?.roomName || session.className} berhasil ditutup. Rekap presensi: ${present} Hadir, ${truant} Bolos, ${sick} Sakit, ${permit} Izin.`,
            session: updatedSession
        });

    } catch (e: any) {
        console.error('Error in checkOutTeachingSession:', e);
        return res.status(500).json({ success: false, message: 'Gagal menutup sesi mengajar: ' + e.message });
    }
};

/**
 * 3. Ambil Sesi Mengajar Guru yang Sedang Aktif
 * GET /api/v1/teacher/session/current
 */
export const getCurrentTeacherSession = async (req: Request, res: Response) => {
    try {
        const teacherId = (req as any).user?.id;
        if (!teacherId) {
            return res.status(401).json({ success: false, message: 'Autentikasi guru diperlukan.' });
        }

        const activeSession = await (prisma as any).teachingSession.findFirst({
            where: {
                teacherId: teacherId,
                status: 'IN_PROGRESS'
            },
            include: {
                room: true,
                studentAttendances: {
                    include: {
                        student: { select: { id: true, name: true, nisn: true, profilePicUrl: true } }
                    }
                }
            },
            orderBy: { checkInTime: 'desc' }
        });

        let formattedSession = null;
        if (activeSession) {
            const formattedAttendances = (activeSession.studentAttendances || []).map((att: any) => {
                const isSelfAttended = (att.notes && att.notes.includes('PRESENSI_MANDIRI')) ||
                                       (att.status === 'PRESENT' && att.markedAt && (att.notes?.includes('MANDIRI') || !att.isLockedByGate));
                const isApprovedByBk = Boolean(
                    att.isLockedByGate ||
                    (att.morningGateStatus && att.morningGateStatus.includes('BK')) ||
                    (att.notes && att.notes.includes('BK'))
                );

                return {
                    ...att,
                    isSelfAttended: Boolean(isSelfAttended),
                    isApprovedByBk: Boolean(isApprovedByBk),
                    canTeacherEdit: !isSelfAttended && !isApprovedByBk
                };
            });

            formattedSession = {
                ...activeSession,
                studentAttendances: formattedAttendances
            };
        }

        return res.json({
            success: true,
            hasActiveSession: !!formattedSession,
            session: formattedSession || null
        });

    } catch (e: any) {
        console.error('Error in getCurrentTeacherSession:', e);
        return res.status(500).json({ success: false, message: 'Gagal mengambil sesi aktif: ' + e.message });
    }
};

/**
 * 4. Guru Mengubah Status Presensi Siswa (e.g. Menandai Bolos / Hadir Manual)
 * POST /api/v1/teacher/session/:sessionId/attendances/update
 * Body: { studentId: string, status: string, notes?: string }
 */
export const updateStudentAttendanceByTeacher = async (req: Request, res: Response) => {
    try {
        const teacherId = (req as any).user?.id;
        const { sessionId } = req.params;
        const { studentId, status, notes } = req.body;

        if (!teacherId) {
            return res.status(401).json({ success: false, message: 'Autentikasi guru diperlukan.' });
        }

        const session = await (prisma as any).teachingSession.findFirst({
            where: { id: sessionId, teacherId }
        });

        if (!session) {
            return res.status(404).json({ success: false, message: 'Sesi mengajar tidak ditemukan atau bukan milik Anda.' });
        }

        const validStatuses = ['PRESENT', 'TRUANT', 'SICK', 'PERMISSION', 'ABSENT', 'NOT_CHECKED_IN'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Status presensi tidak valid.' });
        }

        const existingRecord = await (prisma as any).studentSubjectAttendance.findFirst({
            where: { sessionId, studentId }
        });

        if (!existingRecord) {
            return res.status(404).json({ success: false, message: 'Data presensi siswa di sesi ini tidak ditemukan.' });
        }

        // Peringatan jika siswa sudah tercatat Sakit/Izin di gerbang tapi diubah menjadi PRESENT
        if (existingRecord.isLockedByGate && status === 'PRESENT') {
            return res.status(400).json({
                success: false,
                message: 'Siswa ini telah tercatat SAKIT/IZIN pada gerbang masuk pagi ini. Status dikunci untuk menjaga integritas data.'
            });
        }

        const updated = await (prisma as any).studentSubjectAttendance.update({
            where: { id: existingRecord.id },
            data: {
                status,
                notes: notes || existingRecord.notes,
                markedAt: new Date()
            }
        });

        // Update counts di sesi
        const allAtt = await (prisma as any).studentSubjectAttendance.findMany({ where: { sessionId } });
        const presentCount = allAtt.filter((a: any) => a.status === 'PRESENT').length;
        const truantCount = allAtt.filter((a: any) => a.status === 'TRUANT').length;
        const sickCount = allAtt.filter((a: any) => a.status === 'SICK').length;
        const permitCount = allAtt.filter((a: any) => a.status === 'PERMISSION').length;
        const absentCount = allAtt.filter((a: any) => a.status === 'ABSENT').length;

        await (prisma as any).teachingSession.update({
            where: { id: sessionId },
            data: { presentCount, truantCount, sickCount, permitCount, absentCount }
        });

        return res.json({
            success: true,
            message: `Status kehadiran siswa berhasil diperbarui menjadi ${status}.`,
            data: updated
        });

    } catch (e: any) {
        console.error('Error in updateStudentAttendanceByTeacher:', e);
        return res.status(500).json({ success: false, message: 'Gagal memperbarui kehadiran siswa: ' + e.message });
    }
};

/**
 * 5. SISWA CEK STATUS SESI MENGAJAR AKTIF DI KELASNYA (APK SISWA)
 * GET /api/v1/student/active-teaching-session
 * Mengembalikan info apakah guru sudah tap kehadiran di kelas tersebut
 */
export const getActiveSessionForStudent = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi siswa diperlukan.' });
        }

        const student = await (prisma as any).user.findUnique({
            where: { id: studentId }
        });

        if (!student || !student.className) {
            return res.status(404).json({ success: false, message: 'Data kelas siswa tidak ditemukan.' });
        }

        // Cari sesi yang statusnya IN_PROGRESS untuk kelas siswa ini
        const activeSession = await (prisma as any).teachingSession.findFirst({
            where: {
                className: student.className,
                status: 'IN_PROGRESS'
            },
            include: {
                teacher: { select: { id: true, name: true, profilePicUrl: true } },
                room: true
            },
            orderBy: { checkInTime: 'desc' }
        });

        if (!activeSession) {
            return res.json({
                success: true,
                hasActiveSession: false,
                message: 'Belum ada sesi mengajar aktif di kelas Anda. Menunggu kehadiran guru di kelas.'
            });
        }

        // Ambil status presensi siswa ini di sesi tersebut
        const myAttendance = await (prisma as any).studentSubjectAttendance.findFirst({
            where: {
                sessionId: activeSession.id,
                studentId: student.id
            }
        });

        const checkInTimeStr = formatTimeWib(activeSession.checkInTime);

        const isAlreadyPresent = myAttendance?.status === 'PRESENT';
        const isLockedByGate = myAttendance?.isLockedByGate || false;
        const canSelfAttend = !isAlreadyPresent && !isLockedByGate;

        return res.json({
            success: true,
            hasActiveSession: true,
            session: {
                id: activeSession.id,
                teacherName: activeSession.teacher?.name || 'Guru Pengampu',
                subjectName: activeSession.subjectName,
                roomName: activeSession.room?.roomName || activeSession.className,
                checkInTimeStr: checkInTimeStr,
                checkInTime: activeSession.checkInTime,
                myStatus: myAttendance?.status || 'NOT_CHECKED_IN',
                isAlreadyPresent,
                isLockedByGate,
                canSelfAttend,
                gateStatus: myAttendance?.morningGateStatus || 'NOT_ARRIVED'
            }
        });

    } catch (e: any) {
        console.error('Error in getActiveSessionForStudent:', e);
        return res.status(500).json({ success: false, message: 'Gagal mengecek sesi aktif siswa: ' + e.message });
    }
};

/**
 * 6. SISWA KLIK PRESENSI MATA PELAJARAN MANDIRI (SETELAH GURU TAP KELAS)
 * POST /api/v1/student/session/attend
 * Body: { sessionId?: string }
 */
export const studentSelfAttendSession = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        const { sessionId } = req.body;

        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi siswa diperlukan.' });
        }

        const student = await (prisma as any).user.findUnique({
            where: { id: studentId }
        });

        if (!student || !student.className) {
            return res.status(404).json({ success: false, message: 'Data kelas siswa tidak valid.' });
        }

        // Cari sesi aktif kelas siswa
        let session = null;
        if (sessionId) {
            session = await (prisma as any).teachingSession.findFirst({
                where: { id: sessionId, className: student.className, status: 'IN_PROGRESS' },
                include: { teacher: true }
            });
        } else {
            session = await (prisma as any).teachingSession.findFirst({
                where: { className: student.className, status: 'IN_PROGRESS' },
                include: { teacher: true },
                orderBy: { checkInTime: 'desc' }
            });
        }

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Tidak ada sesi mengajar aktif di kelas Anda saat ini. Pastikan guru mata pelajaran sudah melakukan tap kehadiran di kelas.'
            });
        }

        // Cek apakah ada record di studentSubjectAttendance
        let myRecord = await (prisma as any).studentSubjectAttendance.findFirst({
            where: {
                sessionId: session.id,
                studentId: student.id
            }
        });

        if (myRecord && myRecord.isLockedByGate) {
            return res.status(403).json({
                success: false,
                message: `Presensi terkunci. Anda tercatat ${myRecord.morningGateStatus} di gerbang pagi ini.`
            });
        }

        const now = new Date();

        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        if (myRecord) {
            await (prisma as any).studentSubjectAttendance.update({
                where: { id: myRecord.id },
                data: {
                    status: 'PRESENT',
                    notes: `PRESENSI_MANDIRI_SISWA (${timeStr} WIB)`,
                    markedAt: now
                }
            });
        } else {
            await (prisma as any).studentSubjectAttendance.create({
                data: {
                    sessionId: session.id,
                    studentId: student.id,
                    status: 'PRESENT',
                    morningGateStatus: 'PRESENT',
                    notes: `PRESENSI_MANDIRI_SISWA (${timeStr} WIB)`,
                    markedAt: now
                }
            });
        }

        // Perbarui jumlah siswa yang hadir pada sesi mengajar
        const allAtt = await (prisma as any).studentSubjectAttendance.findMany({
            where: { sessionId: session.id }
        });
        const presentCount = allAtt.filter((a: any) => a.status === 'PRESENT').length;

        await (prisma as any).teachingSession.update({
            where: { id: session.id },
            data: { presentCount }
        });

        return res.json({
            success: true,
            message: `🎉 Kehadiran Anda pada mata pelajaran ${session.subjectName} oleh Bapak/Ibu ${session.teacher?.name || 'Guru'} berhasil dicatat pada pukul ${timeStr}!`,
            markedAt: now,
            timeStr
        });

    } catch (e: any) {
        console.error('Error in studentSelfAttendSession:', e);
        return res.status(500).json({ success: false, message: 'Gagal mencatat presensi mandiri: ' + e.message });
    }
};

/**
 * 7. Ambil Daftar Ruangan Fisik Sekolah
 * GET /api/v1/teacher/rooms
 */
export const getPhysicalRoomsList = async (req: Request, res: Response) => {
    try {
        await ensureDefaultPhysicalRooms();
        const rooms = await (prisma as any).physicalRoom.findMany({
            where: {
                isActive: true,
                className: { not: null }
            },
            orderBy: [{ building: 'asc' }, { roomName: 'asc' }]
        });

        // Ekstraksi guru jika terotentikasi
        let teacher: any = (req as any).user;
        if (!teacher) {
            const token = extractWebToken(req);
            if (token) {
                try {
                    const decoded: any = jwt.verify(token, getSecretKey());
                    const uid = decoded?.id || decoded?.userId;
                    if (uid) {
                        teacher = await prisma.user.findUnique({ where: { id: uid } });
                    }
                } catch (e) {}
            }
        }

        if (!teacher || teacher.role !== 'TEACHER') {
            // Jika bukan guru, kembalikan daftar ruangan standar
            return res.json({ success: true, data: rooms });
        }

        const now = new Date();
        const currentWibDay = getWibDayName(now);
        const currentWibTime = getWibTimeStr(now);
        const nowMinutes = timeStrToMinutes(currentWibTime);

        // Ambil sesi KBM yang sedang aktif oleh guru ini jika ada
        const activeTeachingSession = await (prisma as any).teachingSession.findFirst({
            where: { teacherId: teacher.id, status: 'IN_PROGRESS' }
        });

        // Ambil seluruh jadwal hari ini milik guru
        const schedules = await (prisma as any).classPeriodSchedule.findMany({
            where: {
                day: { equals: currentWibDay, mode: 'insensitive' },
                isBreak: false,
                OR: [
                    { teacherId: teacher.id },
                    ...(teacher.name ? [{ teacherName: { contains: teacher.name, mode: 'insensitive' } }] : [])
                ]
            },
            orderBy: { periodIndex: 'asc' }
        });

        const mergedSchedules = mergeConsecutivePeriods(schedules);

        const enrichedRooms = rooms.map((room: any) => {
            const isAlreadyCheckedIn = activeTeachingSession?.roomId === room.id;

            // Jika ruangan fisik tidak memiliki rombel kelas (misal Lab, Mushola, BK)
            if (!room.className) {
                return {
                    ...room,
                    isScheduledToday: true,
                    canCheckIn: !isAlreadyCheckedIn,
                    isAlreadyCheckedIn,
                    statusReason: isAlreadyCheckedIn ? '🟢 Sedang Aktif di Ruangan Ini' : 'Ruang Fasilitas Umum'
                };
            }

            const roomClassNorm = normalizeClassName(room.className);
            const classSlots = mergedSchedules.filter((s: any) => normalizeClassName(s.className) === roomClassNorm);

            if (classSlots.length === 0) {
                return {
                    ...room,
                    isScheduledToday: false,
                    canCheckIn: false,
                    isAlreadyCheckedIn,
                    statusReason: isAlreadyCheckedIn ? '🟢 Sesi Sedang Berjalan' : '⛔ Tidak ada jadwal mengajar di kelas ini hari ini'
                };
            }

            // Ada jadwal hari ini di kelas ini
            let activeSlot = null;
            let upcomingSlot = null;
            let expiredSlot = null;

            for (const slot of classSlots) {
                const startMin = timeStrToMinutes(slot.startTime);
                const endMin = timeStrToMinutes(slot.endTime);
                const windowOpenMin = startMin - 30; // 30 Menit sebelum jam mengajar
                const windowCloseMin = endMin + 15;

                if (nowMinutes >= windowOpenMin && nowMinutes <= windowCloseMin) {
                    activeSlot = slot;
                    break;
                } else if (nowMinutes < windowOpenMin) {
                    if (!upcomingSlot || timeStrToMinutes(slot.startTime) < timeStrToMinutes(upcomingSlot.startTime)) {
                        upcomingSlot = slot;
                    }
                } else {
                    expiredSlot = slot;
                }
            }

            const chosenSlot = activeSlot || upcomingSlot || expiredSlot || classSlots[0];
            const startMin = timeStrToMinutes(chosenSlot.startTime);
            const windowOpenMin = startMin - 30;
            const windowOpenTime = minutesToTimeStr(windowOpenMin);

            let canCheckIn = false;
            let statusReason = '';

            if (isAlreadyCheckedIn) {
                canCheckIn = false;
                statusReason = `🟢 Sedang Aktif KBM (${chosenSlot.subjectName})`;
            } else if (activeSlot) {
                canCheckIn = true;
                statusReason = `🟢 Siap Presensi Masuk (Jadwal: ${activeSlot.startTime} - ${activeSlot.endTime} WIB)`;
            } else if (upcomingSlot) {
                canCheckIn = false;
                statusReason = `⏳ Presensi dibuka pukul ${windowOpenTime} WIB (30 menit sebelum KBM ${upcomingSlot.startTime})`;
            } else {
                canCheckIn = false;
                statusReason = `⏰ Jadwal KBM hari ini (${chosenSlot.startTime} - ${chosenSlot.endTime} WIB) telah selesai`;
            }

            return {
                ...room,
                isScheduledToday: true,
                canCheckIn,
                isAlreadyCheckedIn,
                scheduleSubject: chosenSlot.subjectName,
                scheduleStartTime: chosenSlot.startTime,
                scheduleEndTime: chosenSlot.endTime,
                windowOpenTime,
                statusReason
            };
        });

        return res.json({ success: true, data: enrichedRooms });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
};
