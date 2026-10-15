import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Helper untuk membaca pengaturan dari model Settings
async function getEvotingSettings() {
    const keys = ['module_evoting_active', 'evoting_start_time', 'evoting_end_time', 'evoting_title'];
    const rows = await prisma.settings.findMany({
        where: { key: { in: keys } }
    });
    
    const settingsMap: Record<string, string> = {};
    for (const r of rows) {
        settingsMap[r.key] = r.value;
    }

    const isActive = settingsMap['module_evoting_active'] === 'true';
    const startTime = settingsMap['evoting_start_time'] || null;
    const endTime = settingsMap['evoting_end_time'] || null;
    const title = settingsMap['evoting_title'] || 'Pemilihan Ketua & Wakil Ketua OSIS SMPN 1 Boyolangu';

    return {
        isActive,
        startTime,
        endTime,
        title,
        settingsMap
    };
}

/**
 * 1. GET /api/v1/mobile/modules & /api/evoting/modules
 * Endpoint yang dipanggil oleh Mobile App untuk membaca status feature toggle modul
 */
export async function getMobileModules(req: Request, res: Response) {
    try {
        const config = await getEvotingSettings();

        // Validasi jendela waktu voting
        const now = new Date();
        let isOpenNow = config.isActive;
        let windowStatus = 'OPEN';

        if (config.isActive) {
            if (config.startTime && now < new Date(config.startTime)) {
                isOpenNow = false;
                windowStatus = 'NOT_STARTED';
            } else if (config.endTime && now > new Date(config.endTime)) {
                isOpenNow = false;
                windowStatus = 'CLOSED';
            }
        }

        let biodataConfig = { isActive: true, deadline: null as string | null, isOpenNow: true };
        try {
            const { getBiodataToggleConfig } = await import('./biodataSubmissionController');
            biodataConfig = await getBiodataToggleConfig();
        } catch (e) {}

        const ekantinSetting = await prisma.systemSetting.findUnique({ where: { key: 'feature.ekantin.enabled' } });
        const isEkantinActive = ekantinSetting ? (ekantinSetting.value === 'true' || ekantinSetting.value === '1') : false;

        return res.json({
            success: true,
            data: {
                modules: {
                    evoting: {
                        name: 'e-Voting OSIS',
                        is_active: config.isActive,
                        is_open_now: isOpenNow,
                        window_status: windowStatus,
                        title: config.title,
                        start_time: config.startTime,
                        end_time: config.endTime,
                    },
                    biodata_submission: {
                        name: 'Formulir Biodata Siswa Terpadu',
                        is_active: biodataConfig.isActive,
                        deadline: biodataConfig.deadline,
                        is_open_now: biodataConfig.isOpenNow,
                        message: biodataConfig.isOpenNow ? 'Periode pengisian dibuka' : 'Periode pengisian biodata sedang ditutup oleh pihak sekolah.'
                    },
                    ekantin: { name: 'E-Kantin Sekolah', is_active: isEkantinActive },
                    academic: { name: 'Akademik & Rapor', is_active: true },
                    cbt_exam: { name: 'Ujian CBT Online', is_active: true },
                    library: { name: 'Perpustakaan Digital', is_active: true },
                    uks: { name: 'Klinik UKS', is_active: true },
                    bk: { name: 'Layanan BK', is_active: true }
                }
            }
        });
    } catch (error: any) {
        console.error('Error getMobileModules:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat status modul sistem' });
    }
}

/**
 * 2. GET /api/evoting/candidates
 * Mengambil daftar pasangan calon (paslon) aktif
 */
export async function getCandidates(req: Request, res: Response) {
    try {
        const candidates = await (prisma as any).candidate.findMany({
            where: { isActive: true },
            orderBy: { candidateNumber: 'asc' }
        });

        const formatted = candidates.map((c: any) => {
            let missionList: string[] = [];
            try {
                missionList = typeof c.mission === 'string' ? JSON.parse(c.mission) : c.mission;
            } catch {
                missionList = c.mission ? [c.mission] : [];
            }

            return {
                id: c.id,
                candidateNumber: c.candidateNumber,
                chairmanName: c.chairmanName,
                viceChairmanName: c.viceChairmanName,
                vision: c.vision,
                mission: missionList,
                photoUrl: c.photoUrl
            };
        });

        return res.json({
            success: true,
            data: formatted
        });
    } catch (error: any) {
        console.error('Error getCandidates:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat data kandidat' });
    }
}

/**
 * 3. GET /api/evoting/status
 * Memeriksa status hak suara siswa yang sedang login (apakah sudah mencoblos atau belum)
 */
export async function getStudentVoteStatus(req: Request, res: Response) {
    try {
        const currentUser = (req as any).user;
        if (!currentUser || !currentUser.id) {
            return res.status(401).json({ success: false, message: 'Unauthorized session' });
        }
        if (currentUser.role !== 'STUDENT') {
            return res.status(403).json({ success: false, message: 'Hanya akun Siswa yang memiliki status hak suara e-Voting OSIS' });
        }
        const studentId = currentUser.id;

        const attendance = await (prisma as any).electionAttendance.findUnique({
            where: { studentId }
        });

        return res.json({
            success: true,
            data: {
                student_id: studentId,
                has_voted: attendance ? Boolean(attendance.hasVoted) : false,
                voted_at: attendance?.votedAt || null
            }
        });
    } catch (error: any) {
        console.error('Error getStudentVoteStatus:', error);
        return res.status(500).json({ success: false, message: 'Gagal memeriksa status hak suara' });
    }
}

/**
 * 4. POST /api/evoting/vote
 * Core Transaksi Pencoblosan Suara Digital
 * Dilengkapi Database Transaction + Anti Race Condition + Asas LUBER JURDIL
 */
export async function castVote(req: Request, res: Response) {
    try {
        const currentUser = (req as any).user;
        if (!currentUser || !currentUser.id) {
            return res.status(401).json({ success: false, message: 'Otentikasi siswa tidak sah.' });
        }
        if (currentUser.role !== 'STUDENT') {
            return res.status(403).json({ success: false, message: 'Hak suara e-Voting OSIS hanya diperuntukkan bagi akun Siswa aktif.' });
        }
        const studentId = currentUser.id;

        // 1. Verifikasi Status Master Switch & Window Waktu
        const config = await getEvotingSettings();
        if (!config.isActive) {
            return res.status(403).json({
                success: false,
                error_code: 'MODULE_DISABLED',
                message: 'Layanan e-Voting OSIS saat ini dinonaktifkan oleh administrator SIAKAD.'
            });
        }

        const now = new Date();
        if (config.startTime && now < new Date(config.startTime)) {
            return res.status(403).json({
                success: false,
                error_code: 'ELECTION_NOT_STARTED',
                message: `Sesi e-Voting belum dibuka. Jadwal mulai: ${new Date(config.startTime).toLocaleString('id-ID')}`
            });
        }
        if (config.endTime && now > new Date(config.endTime)) {
            return res.status(403).json({
                success: false,
                error_code: 'ELECTION_CLOSED',
                message: `Sesi e-Voting telah resmi berakhir pada: ${new Date(config.endTime).toLocaleString('id-ID')}`
            });
        }

        // 2. Validasi Parameter Request
        const { candidateId } = req.body;
        if (!candidateId) {
            return res.status(400).json({ success: false, message: 'ID Kandidat wajib dipilih.' });
        }

        const deviceId = (req.headers['x-device-id'] as string) || req.body.deviceId || 'UNKNOWN_DEVICE';
        const ipAddress = req.ip || req.socket.remoteAddress || '127.0.0.1';
        const userAgent = (req.headers['user-agent'] || 'SmartSchool-Mobile').substring(0, 255);

        // 3. Verifikasi Kandidat Valid
        const candidate = await (prisma as any).candidate.findFirst({
            where: { id: candidateId, isActive: true }
        });
        if (!candidate) {
            return res.status(404).json({ success: false, message: 'Pasangan calon yang Anda pilih tidak valid atau sudah dinonaktifkan.' });
        }

        // 4. Mulai Transaksi Basis Data Kritis (Atomic Protection & LUBER JURDIL)
        const result = await prisma.$transaction(async (tx: any) => {
            // Cek kehadiran pemilih
            const attendance = await tx.electionAttendance.findUnique({
                where: { studentId }
            });

            if (attendance && attendance.hasVoted) {
                const err: any = new Error('ALREADY_VOTED');
                err.votedAt = attendance.votedAt;
                throw err;
            }

            // Buat token receipt digital unik untuk siswa (EVT-XXXX-XXXX)
            const rawReceiptToken = 'EVT-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
            const receiptHash = crypto.createHash('sha256').update(rawReceiptToken + (process.env.JWT_SECRET || 'evoting_secret_salt')).digest('hex');
            const deviceFingerprint = crypto.createHash('sha256').update(deviceId).digest('hex');

            // Update atau Insert ke tabel election_attendance (Rekam kehadiran tanpa menyimpan id paslon)
            if (attendance) {
                await tx.electionAttendance.update({
                    where: { studentId },
                    data: {
                        hasVoted: true,
                        votedAt: new Date(),
                        deviceFingerprint,
                        ipAddress,
                        userAgent,
                        receiptHash
                    }
                });
            } else {
                await tx.electionAttendance.create({
                    data: {
                        studentId,
                        hasVoted: true,
                        votedAt: new Date(),
                        deviceFingerprint,
                        ipAddress,
                        userAgent,
                        receiptHash
                    }
                });
            }

            // Masukkan surat suara ke bilik suara anonim (ballot_box)
            // LUBER JURDIL: Kolom studentId TIDAK ADA di tabel ballot_box
            const anonymousBallotHash = crypto.createHash('sha256').update(crypto.randomUUID() + Date.now() + crypto.randomBytes(32)).digest('hex');

            await tx.ballotBox.create({
                data: {
                    id: crypto.randomUUID(),
                    candidateId: candidate.id,
                    ballotHash: anonymousBallotHash
                }
            });

            return {
                receiptToken: rawReceiptToken,
                votedAt: new Date().toISOString()
            };
        });

        return res.status(201).json({
            success: true,
            message: 'Suara Anda telah sah dan berhasil direkam secara anonim ke bilik suara.',
            data: {
                receipt_token: result.receiptToken,
                voted_at: result.votedAt
            }
        });

    } catch (error: any) {
        if (error.message === 'ALREADY_VOTED') {
            const formattedTime = error.votedAt ? new Date(error.votedAt).toLocaleString('id-ID') : 'sebelumnya';
            return res.status(409).json({
                success: false,
                error_code: 'ALREADY_VOTED',
                message: `Anda sudah menggunakan hak suara Anda pada ${formattedTime} WIB.`
            });
        }

        console.error('Error castVote:', error);
        return res.status(500).json({
            success: false,
            error_code: 'INTERNAL_ERROR',
            message: 'Terjadi kendala teknis saat menyimpan transaksi suara. Silakan coba kembali.'
        });
    }
}

// ========================================================
// CONTROLLER KHUSUS ADMIN & OPERATOR PORTAL WEB
// ========================================================

/**
 * 5. POST /api/admin/evoting/toggle
 * Mengubah status aktif / nonaktif modul e-Voting
 */
export async function adminToggleVotingModule(req: Request, res: Response) {
    try {
        const { isActive } = req.body;
        const stringVal = isActive ? 'true' : 'false';

        await prisma.settings.upsert({
            where: { key: 'module_evoting_active' },
            update: { value: stringVal },
            create: { key: 'module_evoting_active', value: stringVal }
        });

        return res.json({
            success: true,
            message: `Modul e-Voting berhasil di-${isActive ? 'AKTIFKAN' : 'NONAKTIFKAN'}.`,
            is_active: isActive
        });
    } catch (error: any) {
        console.error('Error adminToggleVotingModule:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengubah status modul' });
    }
}

/**
 * 6. POST /api/admin/evoting/config
 * Mengatur judul pemilihan dan jadwal pemungutan suara
 */
export async function adminUpdateVotingConfig(req: Request, res: Response) {
    try {
        const { title, startTime, endTime } = req.body;

        if (title) {
            await prisma.settings.upsert({
                where: { key: 'evoting_title' },
                update: { value: title },
                create: { key: 'evoting_title', value: title }
            });
        }

        if (startTime !== undefined) {
            await prisma.settings.upsert({
                where: { key: 'evoting_start_time' },
                update: { value: startTime || '' },
                create: { key: 'evoting_start_time', value: startTime || '' }
            });
        }

        if (endTime !== undefined) {
            await prisma.settings.upsert({
                where: { key: 'evoting_end_time' },
                update: { value: endTime || '' },
                create: { key: 'evoting_end_time', value: endTime || '' }
            });
        }

        return res.json({
            success: true,
            message: 'Konfigurasi jadwal & judul e-Voting berhasil diperbarui.'
        });
    } catch (error: any) {
        console.error('Error adminUpdateVotingConfig:', error);
        return res.status(500).json({ success: false, message: 'Gagal memperbarui konfigurasi' });
    }
}

/**
 * 7. GET /api/admin/evoting/results
 * Mengambil rekapitulasi hasil pemilu anonim secara real-time
 */
export async function adminGetElectionResults(req: Request, res: Response) {
    try {
        const config = await getEvotingSettings();

        // 1. Total DPT Siswa
        const totalDpt = await prisma.user.count({
            where: { role: 'STUDENT', isActive: true }
        });

        // 2. Total Hadir / Sudah Mencoblos
        const totalAttendance = await (prisma as any).electionAttendance.count({
            where: { hasVoted: true }
        });

        // 3. Total Suara di Bilik Suara
        const totalBallots = await (prisma as any).ballotBox.count();

        // 4. Hitung Perolehan Suara Tiap Paslon
        const candidates = await (prisma as any).candidate.findMany({
            orderBy: { candidateNumber: 'asc' },
            include: {
                _count: {
                    select: { ballots: true }
                }
            }
        });

        const candidateStats = candidates.map((c: any) => {
            const votes = c._count?.ballots || 0;
            const percentage = totalBallots > 0 ? ((votes / totalBallots) * 100).toFixed(1) : '0.0';
            return {
                id: c.id,
                candidateNumber: c.candidateNumber,
                chairmanName: c.chairmanName,
                viceChairmanName: c.viceChairmanName,
                photoUrl: c.photoUrl,
                vision: c.vision,
                mission: typeof c.mission === 'string' ? JSON.parse(c.mission) : c.mission,
                isActive: c.isActive,
                votes,
                percentage: parseFloat(percentage)
            };
        });

        // 5. Statistik Partisipasi per Kelas
        const allStudents = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { id: true, name: true, className: true }
        });

        const allVotedAttendance = await (prisma as any).electionAttendance.findMany({
            where: { hasVoted: true },
            select: {
                studentId: true,
                votedAt: true,
                deviceFingerprint: true,
                student: { select: { name: true, className: true } }
            },
            orderBy: { votedAt: 'desc' }
        });

        const votedStudentIds = new Set(allVotedAttendance.map((a: any) => a.studentId));

        // Group by className
        const classMap: Record<string, { total: number; voted: number }> = {};
        for (const s of allStudents) {
            const cls = s.className || 'Tanpa Kelas';
            if (!classMap[cls]) classMap[cls] = { total: 0, voted: 0 };
            classMap[cls].total++;
            if (votedStudentIds.has(s.id)) {
                classMap[cls].voted++;
            }
        }

        const classStats = Object.keys(classMap).sort().map(cls => {
            const item = classMap[cls];
            const pct = item.total > 0 ? ((item.voted / item.total) * 100).toFixed(1) : '0.0';
            return {
                className: cls,
                totalStudents: item.total,
                votedCount: item.voted,
                percentage: parseFloat(pct)
            };
        });

        // 6. Audit Kehadiran Terbaru (Maksimal 25 pemilih terakhir tanpa pilihan suara)
        const recentAttendance = allVotedAttendance.slice(0, 25).map((a: any) => ({
            studentName: a.student?.name || 'Siswa',
            className: a.student?.className || '-',
            votedAt: a.votedAt,
            deviceFingerprint: a.deviceFingerprint ? a.deviceFingerprint.substring(0, 12) + '...' : '-'
        }));

        const unvotedCount = Math.max(0, totalDpt - totalAttendance);
        const turnOutPercentage = totalDpt > 0 ? ((totalAttendance / totalDpt) * 100).toFixed(1) : '0.0';

        return res.json({
            success: true,
            data: {
                config,
                total_dpt: totalDpt,
                total_attendance: totalAttendance,
                unvoted_count: unvotedCount,
                total_ballots: totalBallots,
                turn_out_percentage: parseFloat(turnOutPercentage),
                candidate_stats: candidateStats,
                class_stats: classStats,
                recent_attendance: recentAttendance
            }
        });
    } catch (error: any) {
        console.error('Error adminGetElectionResults:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengambil rekapitulasi hasil suara' });
    }
}

/**
 * 8. POST /api/admin/evoting/candidates
 * Menambah kandidat paslon baru
 */
export async function adminSaveCandidate(req: Request, res: Response) {
    try {
        const { id, candidateNumber, chairmanName, viceChairmanName, vision, mission, photoUrl } = req.body;

        if (!candidateNumber || !chairmanName || !viceChairmanName || !vision) {
            return res.status(400).json({ success: false, message: 'Data nomor urut, ketua, wakil, dan visi wajib diisi.' });
        }

        const missionString = Array.isArray(mission) ? JSON.stringify(mission) : JSON.stringify([mission || '']);

        if (id) {
            // Update
            const updated = await (prisma as any).candidate.update({
                where: { id },
                data: {
                    candidateNumber: parseInt(candidateNumber),
                    chairmanName,
                    viceChairmanName,
                    vision,
                    mission: missionString,
                    photoUrl: photoUrl || '/uploads/candidates/default.png'
                }
            });
            return res.json({ success: true, message: 'Kandidat berhasil diperbarui.', data: updated });
        } else {
            // Create
            const created = await (prisma as any).candidate.create({
                data: {
                    candidateNumber: parseInt(candidateNumber),
                    chairmanName,
                    viceChairmanName,
                    vision,
                    mission: missionString,
                    photoUrl: photoUrl || '/uploads/candidates/default.png'
                }
            });
            return res.status(201).json({ success: true, message: 'Kandidat berhasil ditambahkan.', data: created });
        }
    } catch (error: any) {
        console.error('Error adminSaveCandidate:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal menyimpan data kandidat' });
    }
}

/**
 * 9. DELETE /api/admin/evoting/candidates/:id
 * Menghapus kandidat paslon
 */
export async function adminDeleteCandidate(req: Request, res: Response) {
    try {
        const { id } = req.params;
        await (prisma as any).candidate.delete({ where: { id } });
        return res.json({ success: true, message: 'Kandidat berhasil dihapus.' });
    } catch (error: any) {
        console.error('Error adminDeleteCandidate:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus kandidat' });
    }
}

/**
 * 10. POST /api/admin/evoting/reset
 * Mengatur ulang / mereset seluruh surat suara & kehadiran untuk pemilu baru
 */
export async function adminResetElection(req: Request, res: Response) {
    try {
        await prisma.$transaction(async (tx: any) => {
            await tx.ballotBox.deleteMany({});
            await tx.electionAttendance.deleteMany({});
        });

        return res.json({
            success: true,
            message: 'Bilik suara dan data kehadiran pemilih berhasil direset menjadi nol.'
        });
    } catch (error: any) {
        console.error('Error adminResetElection:', error);
        return res.status(500).json({ success: false, message: 'Gagal mereset data pemilu' });
    }
}

/**
 * 11. POST /api/admin/evoting/upload-photo
 * Upload file foto kandidat paslon ke direktori uploads/candidates
 */
export async function uploadCandidatePhoto(req: Request, res: Response) {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File foto tidak ditemukan.' });
        }
        const photoUrl = `/uploads/candidates/${req.file.filename}`;
        return res.json({
            success: true,
            message: 'Foto paslon berhasil diunggah.',
            photoUrl
        });
    } catch (error: any) {
        console.error('Error uploadCandidatePhoto:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengunggah foto paslon.' });
    }
}

/**
 * 12. GET /api/evoting/class-turnout
 * Pengurus Kelas & Siswa memantau DPT kelas dan progres siapa yang sudah/belum memilih
 * Asas LUBER JURDIL: Pilihan paslon TIDAK PERNAH dibocorkan
 */
export async function getClassTurnout(req: Request, res: Response) {
    try {
        const studentId = (req as any).user?.id;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi siswa diperlukan' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true }
        });

        if (!student || !student.className) {
            return res.status(400).json({ success: false, message: 'Data kelas siswa tidak ditemukan' });
        }

        const className = student.className;

        // Ambil semua siswa di rombel ini
        const classmates = await prisma.user.findMany({
            where: { role: 'STUDENT', className, isActive: true },
            select: { id: true, name: true, nisn: true },
            orderBy: { name: 'asc' }
        });

        const totalDpt = classmates.length;
        const classmateIds = classmates.map(c => c.id);

        // Ambil data kehadiran voting
        const attendances = await (prisma as any).electionAttendance.findMany({
            where: {
                studentId: { in: classmateIds },
                hasVoted: true
            },
            select: {
                studentId: true,
                votedAt: true
            }
        });

        const attendanceMap = new Map();
        for (const att of attendances) {
            attendanceMap.set(att.studentId, att.votedAt);
        }

        const studentsList = classmates.map(c => {
            const hasVoted = attendanceMap.has(c.id);
            return {
                id: c.id,
                name: c.name,
                nisn: c.nisn || '-',
                hasVoted,
                votedAt: hasVoted ? attendanceMap.get(c.id) : null
            };
        });

        const votedCount = attendances.length;
        const unvotedCount = totalDpt - votedCount;
        const percentage = totalDpt > 0 ? parseFloat(((votedCount / totalDpt) * 100).toFixed(1)) : 0;

        return res.json({
            success: true,
            data: {
                className,
                totalDpt,
                votedCount,
                unvotedCount,
                turnoutPercentage: percentage,
                students: studentsList
            }
        });
    } catch (error: any) {
        console.error('Error getClassTurnout:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memuat DPT kelas' });
    }
}

