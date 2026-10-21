import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/db';
import { sendFcmToUser } from '../services/fcmService';
import { sendSingleWhatsApp, WHATSAPP_NOTIFICATION_POLICY } from '../services/whatsappBlastService';

// Format date in WIB (Asia/Jakarta, UTC+7)
export function getWibDateKey(date: Date = new Date()): string {
    const wibOffsetMs = 7 * 60 * 60 * 1000;
    const wibDate = new Date(date.getTime() + wibOffsetMs);
    return wibDate.toISOString().split('T')[0];
}

export function getWibHourMinute(date: Date = new Date()): { hour: number; minute: number; timeStr: string } {
    const wibOffsetMs = 7 * 60 * 60 * 1000;
    const wibDate = new Date(date.getTime() + wibOffsetMs);
    const hour = wibDate.getUTCHours();
    const minute = wibDate.getUTCMinutes();
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return { hour, minute, timeStr };
}

// Normalisasi perbandingan kelas (e.g. "VII-A" vs "VII A" vs "7A")
export function normalizeClassName(name: string): string {
    return (name || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * 1. POST /api/attendance/class-session/open
 * Pengurus Kelas / Wali Kelas / Guru / Operator membuka sesi presensi kelas
 */
export async function openClassAttendanceSession(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        let { classId, className, type } = req.body;

        // Jika user adalah siswa (Pengurus Kelas), pastikan HANYA membuka kelasnya sendiri (jangan terima className dari klien)
        if (user.role === 'STUDENT') {
            if (!user.className) {
                return res.status(403).json({ success: false, message: 'Akun Anda tidak terdaftar dalam rombel kelas manapun' });
            }
            className = user.className;
            classId = undefined;
        }

        if (!className && !classId) {
            return res.status(400).json({ success: false, message: 'Nama kelas atau classId wajib disertakan' });
        }

        // Resolusi ID Kelas
        const targetClass = await prisma.class.findFirst({
            where: {
                OR: [
                    ...(classId ? [{ id: classId }] : []),
                    ...(className ? [{ name: className }] : [])
                ]
            }
        });

        const resolvedClassId = targetClass ? targetClass.id : (classId || className);
        const resolvedClassName = targetClass ? targetClass.name : (className || classId);

        const dateKey = getWibDateKey();
        const { hour, timeStr } = getWibHourMinute();

        // Tipe sesi: MASUK atau PULANG
        let sessionType = (type || '').toUpperCase();
        if (!['MASUK', 'PULANG'].includes(sessionType)) {
            sessionType = hour < 11 ? 'MASUK' : 'PULANG';
        }

        // Batas waktu: Sesi masuk di kelas hanya dapat dibuka pukul 06:00 - 07:05 WIB
        if (sessionType === 'MASUK') {
            if (timeStr < '06:00') {
                return res.status(400).json({
                    success: false,
                    message: 'Sesi presensi masuk di kelas baru dapat dibuka mulai pukul 06:00 WIB.'
                });
            }
            if (timeStr > '07:05') {
                return res.status(400).json({
                    success: false,
                    message: 'Sesi presensi masuk di kelas ditutup pukul 07:05 WIB. Siswa yang terlambat diarahkan scan di Ruang BK (07:05 - 08:00 WIB).'
                });
            }
        }

        // Cek apakah sesi untuk hari ini sudah pernah dibuat
        let session = await (prisma as any).classAttendanceSession.findUnique({
            where: {
                classId_dateKey_type: {
                    classId: resolvedClassId,
                    dateKey,
                    type: sessionType
                }
            }
        });

        const tokenPayload = `SESSION-${resolvedClassName}-${sessionType}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

        if (session) {
            // Sesi yang sudah CLOSED TIDAK BOLEH dibuka ulang
            if (session.status === 'CLOSED') {
                return res.status(409).json({
                    success: false,
                    message: `Sesi presensi ${sessionType} Kelas ${resolvedClassName} sudah DITUTUP resmi hari ini dan tidak dapat dibuka kembali.`
                });
            }
        } else {
            // Buat sesi baru
            session = await (prisma as any).classAttendanceSession.create({
                data: {
                    classId: resolvedClassId,
                    dateKey,
                    type: sessionType,
                    openedBy: user.id,
                    opensAt: new Date(),
                    status: 'OPEN',
                    qrToken: tokenPayload
                }
            });
        }

        return res.json({
            success: true,
            message: `Sesi presensi ${sessionType} Kelas ${resolvedClassName} berhasil dibuka`,
            session: {
                id: session.id,
                classId: session.classId,
                className: resolvedClassName,
                dateKey: session.dateKey,
                type: session.type,
                status: session.status,
                qrToken: session.qrToken || tokenPayload,
                opensAt: session.opensAt
            }
        });
    } catch (error: any) {
        console.error('[ClassSession] Error open session:', error);
        return res.status(500).json({ success: false, message: 'Gagal membuka sesi kelas: ' + error.message });
    }
}

/**
 * 2. POST /api/attendance/class-session/scan
 * Siswa memindai QR Sesi Kelas dari HP masing-masing
 */
export async function scanClassAttendanceSession(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const studentId = user.id;
        const { sessionId, token, deviceId, bssid, lat, lng, isOfflineSync } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, message: 'ID Sesi presensi wajib disertakan' });
        }

        // 1. Ambil Sesi Presensi Kelas
        const session = await (prisma as any).classAttendanceSession.findUnique({
            where: { id: sessionId }
        });

        if (!session || session.status !== 'OPEN') {
            return res.status(409).json({ success: false, message: 'Sesi presensi kelas sedang tidak aktif atau sudah ditutup' });
        }

        // 2. Ambil Profil Siswa & Kelas
        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, nisn: true, className: true, deviceId: true, parentPhone: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        // Cek kesesuaian kelas
        const classObj = await prisma.class.findUnique({ where: { id: session.classId } });
        const sessionClassName = classObj ? classObj.name : session.classId;

        if (normalizeClassName(student.className || '') !== normalizeClassName(sessionClassName)) {
            return res.status(403).json({
                success: false,
                message: `Presensi ditolak! Sesi ini khusus untuk Kelas ${sessionClassName}, bukan kelas Anda (${student.className || '-'}).`
            });
        }

        // 3. Cek Status Izin / Sakit Terkunci
        const dateKey = session.dateKey;
        const startOfDay = new Date(`${dateKey}T00:00:00.000+07:00`);
        const endOfDay = new Date(`${dateKey}T23:59:59.999+07:00`);
        const existingAttendance = await prisma.attendance.findFirst({
            where: {
                userId: studentId,
                scanTime: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });

        if (existingAttendance && ['SICK', 'SAKIT', 'PERMISSION', 'IZIN'].includes(existingAttendance.status.toUpperCase())) {
            return res.status(403).json({
                success: false,
                message: `Presensi terkunci! Anda sudah tercatat ${existingAttendance.status.toUpperCase()} hari ini berdasarkan verifikasi surat izin.`
            });
        }

        // 4. Idempotensi Scan (Cek apakah sudah pernah scan di sesi ini)
        const existingRecord = await (prisma as any).classAttendanceRecord.findUnique({
            where: {
                sessionId_studentId: {
                    sessionId: session.id,
                    studentId
                }
            }
        });

        if (existingRecord) {
            return res.json({
                success: true,
                alreadyScanned: true,
                message: `Anda sudah memindai presensi ${session.type} sebelumnya`,
                record: existingRecord
            });
        }

        // 5. Aturan Waktu (WIB): Cutoff Masuk = 07:00
        const { hour, minute, timeStr } = getWibHourMinute();
        let recordStatus = 'PRESENT';
        let flags: string[] = [];

        if (isOfflineSync) {
            flags.push('OFFLINE_SYNC');
        }

        if (session.type === 'MASUK') {
            if (timeStr < '06:00') {
                return res.status(400).json({
                    success: false,
                    message: 'Presensi masuk di kelas belum dibuka. Dibuka mulai pukul 06:00 WIB.'
                });
            }
            if (timeStr > '07:05') {
                return res.status(400).json({
                    success: false,
                    isClassGateClosedToBk: true,
                    message: 'Presensi masuk di kelas telah ditutup pukul 07:05 WIB. Silakan lakukan scan di Ruang BK.'
                });
            }
            if (hour > 7 || (hour === 7 && minute > 0)) {
                recordStatus = 'LATE';
            } else {
                recordStatus = 'PRESENT';
            }
        } else if (session.type === 'PULANG') {
            recordStatus = 'PULANG';

            // Cek apakah ada Gatepass Izin Pulang Lebih Awal yang COMPLETED
            const completedGatepass = await (prisma as any).gatepassRequest.findFirst({
                where: {
                    studentId,
                    status: 'COMPLETED',
                    createdAt: {
                        gte: new Date(`${dateKey}T00:00:00.000+07:00`)
                    }
                }
            });

            if (completedGatepass) {
                recordStatus = 'PULANG_AWAL';
                flags.push('GATEPASS_COMPLETED');
            }

            // Cek apakah ada scan MASUK pagi ini
            const masukSession = await (prisma as any).classAttendanceSession.findFirst({
                where: {
                    classId: session.classId,
                    dateKey,
                    type: 'MASUK'
                }
            });

            if (masukSession) {
                const masukRecord = await (prisma as any).classAttendanceRecord.findUnique({
                    where: {
                        sessionId_studentId: {
                            sessionId: masukSession.id,
                            studentId
                        }
                    }
                });
                if (!masukRecord) {
                    flags.push('PULANG_TANPA_MASUK');
                }
            }
        }

        // 6 & 7. Simpan Catatan Presensi Kelas & Sinkronkan ke Attendance Legacy dalam SATU Transaksi Atomik
        const now = new Date();
        const legacyStatus = recordStatus === 'PULANG' || recordStatus === 'PULANG_AWAL' ? 'PULANG' : recordStatus;

        const record = await prisma.$transaction(async (tx) => {
            const rec = await (tx as any).classAttendanceRecord.create({
                data: {
                    sessionId: session.id,
                    studentId,
                    status: recordStatus,
                    source: isOfflineSync ? 'OFFLINE_SYNC' : 'STUDENT_SELF_QR',
                    deviceId: deviceId || student.deviceId || null,
                    bssid: bssid || null,
                    lat: lat ? parseFloat(lat) : null,
                    lng: lng ? parseFloat(lng) : null,
                    flags: flags.length > 0 ? JSON.stringify(flags) : null,
                    scannedAt: now
                }
            });

            if (existingAttendance) {
                await tx.attendance.update({
                    where: { id: existingAttendance.id },
                    data: {
                        status: legacyStatus,
                        type: session.type === 'PULANG' ? 'GATE_OUT' : 'GATE_IN',
                        method: isOfflineSync ? 'OFFLINE_SYNC' : 'QR_CLASS_SESSION'
                    }
                });
            } else {
                await tx.attendance.create({
                    data: {
                        userId: studentId,
                        type: session.type === 'PULANG' ? 'GATE_OUT' : 'GATE_IN',
                        status: legacyStatus,
                        scanTime: now,
                        method: isOfflineSync ? 'OFFLINE_SYNC' : 'QR_CLASS_SESSION',
                        statusVerifikasi: 'AUTO'
                    }
                });
            }

            return rec;
        });

        // 8. Kirim Push Notification FCM ke Orang Tua Siswa
        const cleanParentNisn = student.nisn;
        if (cleanParentNisn) {
            const parentUser = await prisma.user.findFirst({
                where: {
                    role: 'PARENT',
                    OR: [
                        { nisn: cleanParentNisn },
                        { username: `p${cleanParentNisn}` },
                        { username: `P${cleanParentNisn}` }
                    ]
                }
            });

            if (parentUser) {
                const statusLabel = recordStatus === 'PRESENT' ? 'Tepat Waktu' :
                    (recordStatus === 'LATE' ? 'Terlambat' : 'Sudah Pulang');
                const title = session.type === 'MASUK' ? 'Presensi Masuk Kelas' : 'Presensi Pulang Sekolah';
                const body = `${student.name} (${student.className}) telah presensi ${title.toLowerCase()} pukul ${timeStr} WIB (${statusLabel}).`;
                
                sendFcmToUser(parentUser.id, title, body, {
                    type: 'CLASS_ATTENDANCE',
                    studentId,
                    status: recordStatus,
                    time: timeStr
                }).catch(() => {});
            }
        }

        // ============================================================
        // KEBIJAKAN RESMI WHATSAPP: HANYA SISWA TERLAMBAT ATAU ALPA (FLAG AKTIF)
        // ============================================================
        if (WHATSAPP_NOTIFICATION_POLICY.isDispatchAllowed(recordStatus) && recordStatus === 'LATE' && student.parentPhone) {
            const [currH, currM] = timeStr.split(':').map(Number);
            const lateMinutes = Math.max(1, (currH * 60 + currM) - (7 * 60));
            const waLateNotice = `*PEMBERITAHUAN KETERLAMBATAN SISWA*\n` +
                `*SMP NEGERI 1 BOYOLANGU*\n\n` +
                `Yth. Bapak/Ibu Orang Tua / Wali Murid dari ananda *${student.name}* (Kelas ${student.className || '-'}),\n\n` +
                `Kami menginformasikan bahwa ananda telah tiba di sekolah dengan catatan keterlambatan:\n` +
                `• *Waktu Tiba*: ${timeStr} WIB\n` +
                `• *Keterlambatan*: *${lateMinutes} Menit* (Batas Tepat Waktu: 07:00 WIB)\n` +
                `• *Jalur Presensi*: Scan QR Sesi Kelas (${student.className || '-'})\n` +
                `• *Lokasi*: Ruang Kelas ${student.className || '-'}\n` +
                `• *Tindak Lanjut*: Diarahkan oleh Tim Ketertiban / Pengurus Kelas sebelum pembelajaran dimulai.\n\n` +
                `Laporan kedisiplinan ini dikirimkan secara otomatis oleh Sistem Presensi Cerdas SMPN 1 Boyolangu. Mohon dukungan Bapak/Ibu untuk membimbing ananda agar dapat berangkat lebih awal demi kelancaran proses pembelajaran. Terima kasih atas kerja samanya.`;

            sendSingleWhatsApp(student.parentPhone, waLateNotice).catch(waErr => {
                console.warn(`[WA ClassSession Late Alert] Gagal kirim WA ke ${student.parentPhone}:`, waErr.message);
            });
        }

        return res.json({
            success: true,
            message: `Presensi ${session.type} berhasil dicatat (${recordStatus})`,
            record: {
                id: record.id,
                studentId: record.studentId,
                status: record.status,
                timeStr,
                flags
            }
        });

    } catch (error: any) {
        if (error.code === 'P2002' || error.message?.includes('Unique constraint') || error.message?.includes('P2002')) {
            return res.json({
                success: true,
                alreadyScanned: true,
                message: 'Presensi sudah tercatat sebelumnya'
            });
        }
        console.error('[ClassSession] Error scan session:', error);
        return res.status(500).json({ success: false, message: 'Gagal memproses presensi: ' + error.message });
    }
}

/**
 * 3. POST /api/attendance/class-session/proxy-mark
 * Pengurus Kelas / Wali Kelas mencatat siswa yang tidak membawa smartphone
 */
export async function proxyMarkClassAttendance(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const { sessionId, studentId, status, reason } = req.body;

        if (!sessionId || !studentId) {
            return res.status(400).json({ success: false, message: 'SessionId dan studentId wajib disertakan' });
        }

        // Pembatasan: Pengurus kelas TIDAK BOLEH menandai dirinya sendiri via proxy!
        if (user.role === 'STUDENT' && user.id === studentId) {
            return res.status(403).json({
                success: false,
                message: 'Pengurus kelas tidak boleh menandai presensi dirinya sendiri secara proxy. Gunakan pemindaian mandiri.'
            });
        }

        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Alasan presensi proxy wajib diisi (misal: "Siswa tidak membawa smartphone")'
            });
        }

        const session = await (prisma as any).classAttendanceSession.findUnique({
            where: { id: sessionId }
        });

        if (!session || session.status !== 'OPEN') {
            return res.status(409).json({ success: false, message: 'Sesi presensi kelas sedang tidak aktif' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, nisn: true, className: true, profilePicUrl: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const { timeStr } = getWibHourMinute();
        const markStatus = status === 'LATE' ? 'LATE' : 'PRESENT';

        // Upsert record & sync attendance in an atomic transaction
        const now = new Date();
        const startOfDay = new Date(`${session.dateKey}T00:00:00.000+07:00`);
        const endOfDay = new Date(`${session.dateKey}T23:59:59.999+07:00`);

        const record = await prisma.$transaction(async (tx) => {
            const rec = await (tx as any).classAttendanceRecord.upsert({
                where: {
                    sessionId_studentId: {
                        sessionId: session.id,
                        studentId
                    }
                },
                update: {
                    status: markStatus,
                    source: 'OFFICER_PROXY',
                    scannedBy: user.id,
                    reason: reason.trim(),
                    flags: JSON.stringify(['OFFICER_PROXY_MARKED'])
                },
                create: {
                    sessionId: session.id,
                    studentId,
                    status: markStatus,
                    source: 'OFFICER_PROXY',
                    scannedBy: user.id,
                    reason: reason.trim(),
                    flags: JSON.stringify(['OFFICER_PROXY_MARKED']),
                    scannedAt: new Date()
                }
            });

            const existingAttendance = await tx.attendance.findFirst({
                where: {
                    userId: studentId,
                    scanTime: {
                        gte: startOfDay,
                        lte: endOfDay
                    }
                }
            });

            if (existingAttendance) {
                await tx.attendance.update({
                    where: { id: existingAttendance.id },
                    data: {
                        status: markStatus,
                        method: 'OFFICER_PROXY',
                        statusVerifikasi: 'VERIFIED',
                        verifiedBy: user.id
                    }
                });
            } else {
                await tx.attendance.create({
                    data: {
                        userId: studentId,
                        type: session.type === 'PULANG' ? 'GATE_OUT' : 'GATE_IN',
                        status: markStatus,
                        scanTime: now,
                        method: 'OFFICER_PROXY',
                        statusVerifikasi: 'VERIFIED',
                        verifiedBy: user.id
                    }
                });
            }

            return rec;
        });

        return res.json({
            success: true,
            message: `Presensi ${student.name} berhasil dicatat oleh pengurus kelas`,
            student: {
                id: student.id,
                name: student.name,
                nisn: student.nisn,
                className: student.className,
                profilePicUrl: student.profilePicUrl,
                status: markStatus,
                timeStr
            },
            record
        });

    } catch (error: any) {
        console.error('[ClassSession] Error proxy mark:', error);
        return res.status(500).json({ success: false, message: 'Gagal mencatat proxy: ' + error.message });
    }
}

/**
 * 4. POST /api/attendance/class-session/close
 * Tutup sesi presensi kelas
 */
export async function closeClassAttendanceSession(req: Request, res: Response) {
    try {
        const { sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ success: false, message: 'ID Sesi wajib disertakan' });
        }

        const session = await (prisma as any).classAttendanceSession.update({
            where: { id: sessionId },
            data: {
                status: 'CLOSED',
                closesAt: new Date()
            }
        });

        return res.json({
            success: true,
            message: 'Sesi presensi kelas berhasil ditutup',
            session
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: 'Gagal menutup sesi: ' + error.message });
    }
}

/**
 * 5. GET /api/attendance/class-session/today
 * Mengambil ringkasan sesi kelas hari ini dan daftar siswa
 */
export async function getTodayClassAttendanceSession(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        let className = (req.query.className as string) || user.className;

        if (!className && user.role !== 'ADMIN' && user.role !== 'OPERATOR') {
            return res.status(400).json({ success: false, message: 'Kelas tidak ditemukan' });
        }

        const targetClass = await prisma.class.findFirst({
            where: { name: className }
        });

        if (!targetClass) {
            return res.status(404).json({ success: false, message: `Kelas ${className} tidak ditemukan` });
        }

        const dateKey = getWibDateKey();

        // Ambil sesi MASUK dan PULANG hari ini
        const sessions = await (prisma as any).classAttendanceSession.findMany({
            where: {
                classId: targetClass.id,
                dateKey
            },
            include: {
                records: true
            }
        });

        // Ambil seluruh siswa di kelas tersebut
        const students = await prisma.user.findMany({
            where: {
                className: targetClass.name,
                role: 'STUDENT'
            },
            select: {
                id: true,
                name: true,
                nisn: true,
                profilePic: true,
                classRole: true
            },
            orderBy: { name: 'asc' }
        });

        const activeMasukSession = sessions.find((s: any) => s.type === 'MASUK');
        const activePulangSession = sessions.find((s: any) => s.type === 'PULANG');

        const masukRecordsMap = new Map();
        if (activeMasukSession) {
            for (const r of activeMasukSession.records) {
                masukRecordsMap.set(r.studentId, r);
            }
        }

        const pulangRecordsMap = new Map();
        if (activePulangSession) {
            for (const r of activePulangSession.records) {
                pulangRecordsMap.set(r.studentId, r);
            }
        }

        // Petakan status per siswa
        let presentCount = 0;
        let lateCount = 0;
        let absentCount = 0;

        const studentItems = students.map(s => {
            const mRecord = masukRecordsMap.get(s.id);
            const pRecord = pulangRecordsMap.get(s.id);

            let displayStatus = 'BELUM_HADIR';
            if (mRecord) {
                displayStatus = mRecord.status; // PRESENT or LATE
                if (mRecord.status === 'PRESENT') presentCount++;
                if (mRecord.status === 'LATE') lateCount++;
            } else {
                absentCount++;
            }

            return {
                id: s.id,
                name: s.name,
                nisn: s.nisn,
                classRole: s.classRole,
                status: displayStatus,
                isMasuk: !!mRecord,
                masukTime: mRecord ? mRecord.scannedAt : null,
                isPulang: !!pRecord,
                pulangTime: pRecord ? pRecord.scannedAt : null,
                source: mRecord?.source || null,
                reason: mRecord?.reason || null
            };
        });

        return res.json({
            success: true,
            className: targetClass.name,
            classId: targetClass.id,
            dateKey,
            sessions: {
                masuk: activeMasukSession || null,
                pulang: activePulangSession || null
            },
            summary: {
                totalStudents: students.length,
                presentCount,
                lateCount,
                absentCount
            },
            students: studentItems
        });

    } catch (error: any) {
        console.error('[ClassSession] Error get today session:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat sesi: ' + error.message });
    }
}

/**
 * 6. POST /api/attendance/class-session/end-of-day-job
 * Job akhir hari (Cron / Operator trigger):
 * Siswa tanpa presensi kelas:
 * - Jika hadir di sesi guru KBM -> tandai HADIR_TANPA_SCAN
 * - Jika tidak ada di KBM juga -> tandai ALPA
 */
let isEndOfDayJobRunning = false;

export async function runEndOfDayAttendanceEvaluation(req: Request, res: Response) {
    if (isEndOfDayJobRunning) {
        return res.status(409).json({
            success: false,
            message: 'Job evaluasi akhir hari sedang berjalan. Harap tunggu hingga proses selesai.'
        });
    }

    isEndOfDayJobRunning = true;
    try {
        const dateKey = getWibDateKey();
        const startOfDay = new Date(`${dateKey}T00:00:00.000+07:00`);
        const endOfDay = new Date(`${dateKey}T23:59:59.999+07:00`);

        // Ambil semua siswa aktif
        const allStudents = await prisma.user.findMany({
            where: { role: 'STUDENT' },
            select: { id: true, name: true, className: true }
        });

        // Ambil presensi hari ini
        const todayAttendances = await prisma.attendance.findMany({
            where: {
                scanTime: { gte: startOfDay, lte: endOfDay }
            }
        });

        const attendanceMap = new Map();
        for (const att of todayAttendances) {
            attendanceMap.set(att.userId, att);
        }

        // Ambil kehadiran di sesi guru KBM hari ini
        const subjectAttendances = await (prisma as any).studentSubjectAttendance.findMany({
            where: {
                markedAt: { gte: startOfDay, lte: endOfDay },
                status: 'PRESENT'
            }
        });

        const kbmPresentSet = new Set(subjectAttendances.map((sa: any) => sa.studentId));

        let markedHadirTanpaScan = 0;
        let markedAlpa = 0;

        for (const s of allStudents) {
            const existing = attendanceMap.get(s.id);
            if (!existing) {
                // Tidak ada presensi pagi
                if (kbmPresentSet.has(s.id)) {
                    // Guru mencatat hadir di KBM
                    await prisma.attendance.create({
                        data: {
                            userId: s.id,
                            type: 'GATE_IN',
                            scanTime: new Date(),
                            status: 'HADIR_TANPA_SCAN',
                            method: 'SYSTEM_KBM_FALLBACK',
                            statusVerifikasi: 'AUTO'
                        }
                    });
                    markedHadirTanpaScan++;
                } else {
                    // Benar-benar tidak hadir sama sekali
                    await prisma.attendance.create({
                        data: {
                            userId: s.id,
                            type: 'GATE_IN',
                            scanTime: new Date(),
                            status: 'ALPA',
                            method: 'SYSTEM_END_OF_DAY',
                            statusVerifikasi: 'AUTO'
                        }
                    });
                    markedAlpa++;
                }
            }
        }

        return res.json({
            success: true,
            message: `Evaluasi akhir hari selesai: ${markedHadirTanpaScan} ditandai HADIR_TANPA_SCAN, ${markedAlpa} ditandai ALPA`,
            markedHadirTanpaScan,
            markedAlpa
        });

    } catch (error: any) {
        console.error('[ClassSession] Error end of day evaluation:', error);
        return res.status(500).json({ success: false, message: 'Evaluasi akhir hari gagal: ' + error.message });
    } finally {
        isEndOfDayJobRunning = false;
    }
}
