import { Request, Response } from 'express';
import prisma from '../utils/db';
import { logAudit } from '../services/auditLogger';

/**
 * 1. Ruang Ujian (Exam Rooms) CRUD
 */
export const getExamRooms = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        const rooms = await (prisma as any).examRoom.findMany({
            where: { examId },
            include: {
                _count: { select: { participants: true } }
            },
            orderBy: { roomName: 'asc' }
        });
        res.json({ success: true, count: rooms.length, data: rooms });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const createExamRoom = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        const { roomName, capacity, proctorId, proctorName, backupProctorId, backupProctorName } = req.body;

        if (!roomName) {
            return res.status(400).json({ success: false, message: 'Nama ruang ujian wajib diisi.' });
        }

        const room = await (prisma as any).examRoom.create({
            data: {
                examId,
                roomName: roomName.trim(),
                capacity: Number(capacity) || 30,
                proctorId: proctorId || null,
                proctorName: proctorName || null,
                backupProctorId: backupProctorId || null,
                backupProctorName: backupProctorName || null
            }
        });

        await logAudit(req, 'CREATE_EXAM_ROOM', `ExamId: ${examId}, Room: ${roomName}`, { capacity });
        res.json({ success: true, message: `Ruang ${roomName} berhasil ditambahkan.`, data: room });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const deleteExamRoom = async (req: Request, res: Response) => {
    try {
        const roomId = String(req.params.roomId);
        await (prisma as any).examRoom.delete({ where: { id: roomId } });
        res.json({ success: true, message: 'Ruang ujian berhasil dihapus.' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 2. Distribusi Peserta Ujian Otomatis & Pembuatan Nomor Peserta
 * Mode: "AUTO_RANDOM" (acak silang kelas) atau "AUTO_BY_CLASS" (per rombel)
 */
export const distributeExamParticipants = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        const { mode = 'AUTO_BY_CLASS', academicYear = '2026' } = req.body;

        const exam = await prisma.exam.findUnique({
            where: { id: examId },
            include: { subject: true }
        });

        if (!exam) {
            return res.status(404).json({ success: false, message: 'Ujian tidak ditemukan.' });
        }

        const rooms = await (prisma as any).examRoom.findMany({
            where: { examId },
            orderBy: { roomName: 'asc' }
        });

        if (rooms.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Belum ada ruang ujian terdaftar. Buat minimal 1 ruang ujian terlebih dahulu.'
            });
        }

        // Tentukan kelas target
        const assigned = (exam.assignedClasses || 'ALL').trim();
        let classFilter: any = {};
        if (assigned !== 'ALL' && assigned !== 'Semua Kelas' && assigned) {
            const classList = assigned.split(',').map(c => c.trim()).filter(Boolean);
            classFilter.name = { in: classList };
        }

        // Ambil siswa terdaftar di kelas-kelas target
        const classes = await prisma.class.findMany({
            where: classFilter,
            include: {
                users: {
                    where: { role: 'STUDENT', isActive: true },
                    select: { id: true, name: true, className: true, nisn: true }
                }
            }
        });

        let allStudents: Array<{ id: string; name: string; className: string | null; nisn: string | null }> = [];
        for (const cls of classes) {
            allStudents.push(...cls.users);
        }

        if (allStudents.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ditemukan siswa aktif pada kelas target ujian ini.' });
        }

        // Urutkan atau acak sesuai mode
        if (mode === 'AUTO_RANDOM') {
            // Fisher-Yates Shuffle
            for (let i = allStudents.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allStudents[i], allStudents[j]] = [allStudents[j], allStudents[i]];
            }
        } else {
            // Urutkan berdasarkan Kelas kemudian Nama
            allStudents.sort((a, b) => {
                const cComp = (a.className || '').localeCompare(b.className || '');
                if (cComp !== 0) return cComp;
                return a.name.localeCompare(b.name);
            });
        }

        // Bersihkan distribusi sebelumnya untuk idempotency
        await (prisma as any).examParticipant.deleteMany({ where: { examId } });

        // Distribusikan ke ruang-ruang yang tersedia
        const participantsData: any[] = [];
        let studentIdx = 0;
        let globalNumber = 1;

        for (const room of rooms) {
            const capacity = room.capacity || 30;
            let seat = 1;

            while (seat <= capacity && studentIdx < allStudents.length) {
                const s = allStudents[studentIdx];
                const cleanClass = (s.className || 'XX').replace(/[^A-Za-z0-9]/g, '');
                const numPadded = String(globalNumber).padStart(3, '0');
                const participantNo = `${academicYear}-${cleanClass}-${numPadded}`;

                participantsData.push({
                    examId,
                    roomId: room.id,
                    userId: s.id,
                    participantNo,
                    seatNumber: seat
                });

                seat++;
                studentIdx++;
                globalNumber++;
            }
        }

        // Simpan dalam batch transaksi
        for (const p of participantsData) {
            await (prisma as any).examParticipant.create({ data: p });
        }

        await logAudit(req, 'DISTRIBUTE_EXAM_PARTICIPANTS', `Exam: ${exam.title}`, {
            totalDistributed: participantsData.length,
            totalStudents: allStudents.length,
            mode
        });

        res.json({
            success: true,
            message: `Berhasil mendistribusikan ${participantsData.length} siswa ke dalam ${rooms.length} ruang ujian.`,
            mode,
            totalParticipants: participantsData.length,
            unallocatedCount: Math.max(0, allStudents.length - participantsData.length)
        });
    } catch (e: any) {
        console.error('Error distributing participants:', e);
        res.status(500).json({ success: false, message: 'Gagal mendistribusikan peserta: ' + e.message });
    }
};

export const getExamParticipants = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        const { roomId, search } = req.query;

        const where: any = { examId };
        if (roomId) where.roomId = String(roomId);

        const participants = await (prisma as any).examParticipant.findMany({
            where,
            include: {
                user: { select: { id: true, name: true, nisn: true, className: true } },
                room: { select: { id: true, roomName: true } }
            },
            orderBy: [{ roomId: 'asc' }, { seatNumber: 'asc' }]
        });

        let filtered = participants;
        if (search) {
            const q = String(search).toLowerCase();
            filtered = participants.filter((p: any) =>
                p.participantNo.toLowerCase().includes(q) ||
                p.user.name.toLowerCase().includes(q) ||
                (p.user.nisn && p.user.nisn.includes(q))
            );
        }

        res.json({ success: true, count: filtered.length, data: filtered });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const resetExamDistribution = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        await (prisma as any).examParticipant.deleteMany({ where: { examId } });
        await logAudit(req, 'RESET_EXAM_DISTRIBUTION', `ExamId: ${examId}`);
        res.json({ success: true, message: 'Distribusi peserta ujian berhasil di-reset.' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 3. Log Insiden Ujian Real-Time
 */
export const logExamIncident = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        const { studentId, studentName, roomName, incidentType, severity = 'MEDIUM', description } = req.body;

        if (!incidentType || !description) {
            return res.status(400).json({ success: false, message: 'Tipe insiden dan deskripsi wajib diisi.' });
        }

        const incident = await (prisma as any).examIncidentLog.create({
            data: {
                examId,
                studentId: studentId || null,
                studentName: studentName || null,
                roomName: roomName || null,
                incidentType,
                severity,
                description: description.trim()
            }
        });

        await logAudit(req, 'EXAM_INCIDENT_REPORTED', `ExamId: ${examId}`, { incidentType, severity });
        res.json({ success: true, message: 'Insiden berhasil dicatat.', data: incident });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getExamIncidentLogs = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        const logs = await (prisma as any).examIncidentLog.findMany({
            where: { examId },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, count: logs.length, data: logs });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 4. Approval Workflow Kurikulum ↔ Admin
 */
export const submitExamForApproval = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        const user = (req as any).user;

        const workflow = await (prisma as any).examApprovalWorkflow.upsert({
            where: { examId },
            create: {
                examId,
                status: 'PENDING_REVIEW',
                submittedBy: user?.name || 'Admin Pengaju'
            },
            update: {
                status: 'PENDING_REVIEW',
                submittedBy: user?.name || 'Admin Pengaju',
                reviewNotes: null
            }
        });

        await logAudit(req, 'SUBMIT_EXAM_APPROVAL', `ExamId: ${examId}`);
        res.json({ success: true, message: 'Jadwal ujian berhasil diajukan ke Kurikulum untuk verifikasi.', data: workflow });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const reviewExamApproval = async (req: Request, res: Response) => {
    try {
        const examId = String(req.params.examId);
        const { status, reviewNotes } = req.body;
        const user = (req as any).user;

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Status review harus APPROVED atau REJECTED.' });
        }

        const workflow = await (prisma as any).examApprovalWorkflow.update({
            where: { examId },
            data: {
                status,
                reviewedBy: user?.name || 'Waka Kurikulum',
                reviewNotes: reviewNotes || null
            }
        });

        await logAudit(req, `REVIEW_EXAM_${status}`, `ExamId: ${examId}`, { reviewNotes });
        res.json({
            success: true,
            message: status === 'APPROVED' ? 'Jadwal ujian berhasil disetujui Kurikulum.' : 'Jadwal ujian ditolak dengan catatan.',
            data: workflow
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};
