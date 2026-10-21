import { Request, Response } from 'express';
import prisma from '../utils/db';
import { formatTimeWib } from '../utils/dateUtils';

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
                'VII-A', 'VII-B', 'VII-C', 'VII-D', 'VII-E', 'VII-F', 'VII-G', 'VII-H', 'VII-I', 'VII-J',
                'VIII-A', 'VIII-B', 'VIII-C', 'VIII-D', 'VIII-E', 'VIII-F', 'VIII-G', 'VIII-H', 'VIII-I', 'VIII-J',
                'IX-A', 'IX-B', 'IX-C', 'IX-D', 'IX-E', 'IX-F', 'IX-G', 'IX-H', 'IX-I', 'IX-J'
            ];

            const roomData = classes.map((c, idx) => ({
                roomCode: `ROOM_${c.replace('-', '_')}`,
                roomName: `Ruang Kelas ${c}`,
                nfcTagUid: `NFC_TAG_${c.replace('-', '_')}`,
                qrSecretToken: `QR_ROOM_${c.replace('-', '_')}_SEC_2026`,
                className: c,
                building: idx < 10 ? 'Gedung A (Kelas VII)' : idx < 20 ? 'Gedung B (Kelas VIII)' : 'Gedung C (Kelas IX)',
                floor: (idx % 10) < 5 ? 1 : 2,
                isActive: true
            }));

            // Ruang khusus
            roomData.push({
                roomCode: 'ROOM_LAB_KOMP_1',
                roomName: 'Laboratorium Komputer 1',
                nfcTagUid: 'NFC_TAG_LAB_KOMP_1',
                qrSecretToken: 'QR_ROOM_LAB_KOMP_1_SEC_2026',
                className: null as any,
                building: 'Gedung TI Lt. 2',
                floor: 2,
                isActive: true
            });
            roomData.push({
                roomCode: 'ROOM_MUSHOLA',
                roomName: 'Mushola Sekolah Al-Ikhlas',
                nfcTagUid: 'NFC_TAG_MUSHOLA',
                qrSecretToken: 'QR_ROOM_MUSHOLA_SEC_2026',
                className: null as any,
                building: 'Area Ibadah Utama',
                floor: 1,
                isActive: true
            });
            roomData.push({
                roomCode: 'ROOM_BK',
                roomName: 'Ruang Bimbingan Konseling (BK)',
                nfcTagUid: 'NFC_TAG_RUANG_BK',
                qrSecretToken: 'QR_ROOM_RUANG_BK_SEC_2026',
                className: null as any,
                building: 'Gedung Layanan Siswa Lt. 1',
                floor: 1,
                isActive: true
            });

            for (const item of roomData) {
                await (prisma as any).physicalRoom.create({ data: item });
            }
            console.log(`✅ Initialized ${roomData.length} physical rooms for teacher room handover.`);
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
        // A. VALIDASI ANTI-SALAH KAMAR DENGAN SMART RESOLVER
        // ========================================================
        // Periksa apakah kelas ruangan ini sesuai dengan jadwal rombel yang diampu guru
        if (room.className && teacher.role === 'TEACHER') {
            const targetClass = room.className.trim().toUpperCase();
            let isAllowed = false;

            // 1. Cek dari teachingClasses guru
            if (teacher.teachingClasses) {
                const allowedClasses = teacher.teachingClasses
                    .split(',')
                    .map((c: string) => c.trim().toUpperCase().replace(/\s+/g, '-'));
                const targetNormalized = targetClass.replace(/\s+/g, '-');
                if (allowedClasses.includes(targetNormalized) || allowedClasses.includes(targetClass)) {
                    isAllowed = true;
                }
            }

            // 2. Cek apakah ada jadwal mengajar guru di kelas ini pada database
            if (!isAllowed) {
                const hasSchedule = await (prisma as any).schedule.findFirst({
                    where: {
                        teacherId: teacher.id,
                        className: { in: [targetClass, targetClass.replace('-', ' '), targetClass.replace(/\s+/g, '-')] }
                    }
                });
                if (hasSchedule) isAllowed = true;
            }

            // 3. Cek apakah guru adalah wali kelas dari kelas ini
            if (!isAllowed && teacher.homeroomClass) {
                const homeroomNorm = teacher.homeroomClass.toUpperCase().replace(/\s+/g, '-');
                const targetNorm = targetClass.replace(/\s+/g, '-');
                if (homeroomNorm === targetNorm) isAllowed = true;
            }

            // 4. Jika teachingClasses tidak diset, izinkan agar guru tidak terblokir
            if (!teacher.teachingClasses) {
                isAllowed = true;
            }

            // 5. Cek apakah ada penugasan guru piket / inval
            if (!isAllowed) {
                const hasInval = await (prisma as any).leaveRequest?.findFirst({
                    where: {
                        substituteTeacherId: teacher.id,
                        status: 'APPROVED'
                    }
                }).catch(() => null);

                if (hasInval) isAllowed = true;
            }

            if (!isAllowed) {
                console.log(`[Handover] Guru ${teacher.name} membuka sesi fleksibel di ruangan ${room.roomName} (${room.className})`);
                isAllowed = true;
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
        let assignedSubject = subjectName || teacher.teachingSubject;
        if (!assignedSubject) {
            const sched = await (prisma as any).schedule.findFirst({
                where: {
                    teacherId: teacher.id,
                    className: { in: [targetClassName, targetClassName.replace('-', ' '), targetClassName.replace(/\s+/g, '-')] }
                }
            });
            if (sched?.subject) assignedSubject = sched.subject;
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
export const getPhysicalRoomsList = async (_req: Request, res: Response) => {
    try {
        await ensureDefaultPhysicalRooms();
        const rooms = await (prisma as any).physicalRoom.findMany({
            where: { isActive: true },
            orderBy: [{ building: 'asc' }, { roomName: 'asc' }]
        });
        return res.json({ success: true, data: rooms });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
};
