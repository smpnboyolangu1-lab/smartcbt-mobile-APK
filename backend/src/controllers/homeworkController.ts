import { Request, Response } from 'express';
import prisma from '../utils/db';
import path from 'path';
import fs from 'fs';

// Helper untuk konversi string waktu ("07:00", "2026-11-03 23:59", ISO) ke Date yang valid
function parseSafeDate(val: any, fallbackDate: Date = new Date()): Date {
    if (!val) return fallbackDate;
    if (val instanceof Date && !isNaN(val.getTime())) return val;
    const str = String(val).trim();
    if (!str) return fallbackDate;

    // Jika format "HH:mm" atau "HH:mm:ss" saja (seperti "07:00" atau "23:59")
    const timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeOnlyMatch) {
        const d = new Date(fallbackDate.getTime());
        d.setHours(Number(timeOnlyMatch[1]), Number(timeOnlyMatch[2]), Number(timeOnlyMatch[3] || 0), 0);
        return d;
    }

    // Ganti spasi di antara tanggal dan jam menjadi 'T' bila format "YYYY-MM-DD HH:mm"
    const normalized = str.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/, '$1T$2');
    const parsed = new Date(normalized);
    if (!isNaN(parsed.getTime())) return parsed;

    const rawParsed = new Date(str);
    if (!isNaN(rawParsed.getTime())) return rawParsed;

    return fallbackDate;
}

export const getHomeworks = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const requestedClassName = (req.query.className as string | undefined)?.trim();
        const whereClause: any = {};

        if (requestedClassName) {
            const cls = await prisma.class.findFirst({
                where: {
                    OR: [
                        { name: requestedClassName },
                        { name: { equals: requestedClassName, mode: 'insensitive' as any } },
                        { id: requestedClassName }
                    ]
                }
            });
            if (cls) {
                whereClause.OR = [
                    { classId: cls.id },
                    { class: { name: { equals: requestedClassName, mode: 'insensitive' as any } } }
                ];
            } else {
                whereClause.class = { name: { equals: requestedClassName, mode: 'insensitive' as any } };
            }
        } else if (user && user.role === 'TEACHER') {
            whereClause.OR = [
                { teacherId: user.id },
                { teacherId: null }
            ];
        } else if (user && user.role === 'STUDENT') {
            const studentClass = (user.className || '').trim();
            const studentClassId = user.classId;
            const targetClassIds: string[] = [];
            const targetClassNames: string[] = [];
            if (studentClassId) targetClassIds.push(studentClassId);
            if (studentClass) targetClassNames.push(studentClass);

            if (studentClass) {
                const cls = await prisma.class.findFirst({
                    where: {
                        OR: [
                            { name: studentClass },
                            { name: { equals: studentClass, mode: 'insensitive' } },
                            { id: studentClass }
                        ]
                    }
                });
                if (cls) {
                    if (!targetClassIds.includes(cls.id)) targetClassIds.push(cls.id);
                    if (!targetClassNames.includes(cls.name)) targetClassNames.push(cls.name);
                }
            }

            if (targetClassIds.length > 0 || targetClassNames.length > 0) {
                whereClause.OR = [
                    ...(targetClassIds.length > 0 ? [{ classId: { in: targetClassIds } }] : []),
                    ...(targetClassNames.length > 0 ? [{ class: { name: { in: targetClassNames } } }] : [])
                ];
            } else {
                whereClause.id = '__NONE__';
            }
        }

        let homeworks = await prisma.homework.findMany({
            where: whereClause,
            include: {
                subject: true,
                class: true,
                _count: { select: { submissions: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Hanya tampilkan tugas resmi sesuai kelas siswa (tanpa fallback dummy antar-kelas)

        let studentSubmissions: any[] = [];
        if (user && user.role === 'STUDENT') {
            studentSubmissions = await prisma.homeworkSubmission.findMany({
                where: { userId: user.id }
            });
        }
        const subMap = new Map();
        studentSubmissions.forEach(s => subMap.set(s.homeworkId, s));

        const mappedHomeworks = homeworks.map(h => {
            const sub = subMap.get(h.id);
            const hasScore = sub && sub.score !== null && sub.score !== undefined;
            return {
                ...h,
                isSubmitted: !!sub,
                submissionStatus: sub ? (hasScore ? 'GRADED' : 'SUBMITTED') : 'PENDING',
                score: sub ? sub.score : null,
                feedback: sub ? sub.teacherNote : null,
                submission: sub ? {
                    id: sub.id,
                    fileUrl: sub.fileUrl,
                    notes: sub.answers || sub.teacherNote,
                    answers: sub.answers,
                    score: sub.score,
                    autoScore: sub.autoScore,
                    teacherNote: sub.teacherNote,
                    submittedAt: sub.submittedAt
                } : null
            };
        });

        // Jembatani Ujian CBT Portal & Ulangan Harian (UH) Guru agar langsung muncul di Tab Tugas & Ujian Siswa
        if (user && user.role === 'STUDENT') {
            const studentClass = (user.className || '').trim().toUpperCase();
            const studentLevel = studentClass.startsWith('VII-') ? 'VII' : (studentClass.startsWith('VIII-') ? 'VIII' : (studentClass.startsWith('IX-') ? 'IX' : ''));

            try {
                // 1. Ambil Ujian CBT dari Portal
                const cbtExams = await prisma.exam.findMany({
                    where: {
                        status: { notIn: ['ARCHIVED', 'ARSIP', 'NONAKTIF'] }
                    },
                    include: {
                        subject: true,
                        _count: { select: { questions: true } },
                        studentExams: {
                            where: { userId: user.id }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 25
                });

                for (const ex of cbtExams) {
                    const assignedList = (ex.assignedClasses || 'ALL').toUpperCase().split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
                    const isClassMatch = assignedList.length === 0 || assignedList.includes('ALL') || assignedList.includes('SEMUA KELAS') ||
                        assignedList.includes(studentClass) || (studentLevel && assignedList.includes(studentLevel));

                    if (!isClassMatch) continue;

                    const myExamSub = ex.studentExams && ex.studentExams.length > 0 ? ex.studentExams[0] : null;
                    const isDone = myExamSub && (myExamSub.status === 'SUBMITTED' || myExamSub.status === 'FINISHED' || myExamSub.status === 'COMPLETED');
                    const examDeadline = ex.executionDate
                        ? `${ex.executionDate}T${ex.endTimeStr || '23:59'}:00`
                        : new Date(Date.now() + 24 * 3600 * 1000).toISOString();

                    mappedHomeworks.push({
                        id: ex.id,
                        title: `[CBT] ${ex.title}`,
                        description: `Asesmen CBT: ${ex.subject?.name || 'Mata Pelajaran'} (${ex._count?.questions || 0} Butir Soal • ${ex.durationMinutes} Menit). Token: ${ex.isTokenActive ? (ex.token || 'UNBK26') : 'Terkunci / Hubungi Guru'}`,
                        deadline: examDeadline,
                        subjectId: ex.subjectId || '',
                        classId: ex.assignedClasses || studentClass,
                        teacherId: ex.teacherId || null,
                        type: 'CBT_EXAM',
                        subject: ex.subject ? { id: ex.subject.id, name: ex.subject.name } : { id: '', name: 'CBT' },
                        class: { id: studentClass, name: studentClass },
                        isSubmitted: isDone,
                        submissionStatus: isDone ? (myExamSub?.score !== null ? 'GRADED' : 'SUBMITTED') : 'PENDING',
                        score: myExamSub?.score ?? null,
                        feedback: isDone ? 'Ujian telah diselesaikan di Server CBT.' : null,
                        submission: myExamSub ? {
                            id: myExamSub.id,
                            fileUrl: null,
                            notes: 'Selesai di ExamBrowser Kiosk Mode',
                            answers: null,
                            score: myExamSub.score,
                            autoScore: myExamSub.score,
                            teacherNote: null,
                            submittedAt: myExamSub.endTime || myExamSub.startTime || new Date()
                        } : null
                    } as any);
                }

                // 2. Ambil Ulangan Harian (UH) Guru
                const listAllUh = await (prisma as any).ulanganHarian.findMany({
                    include: {
                        submissions: {
                            where: { siswaId: user.id }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 25
                });

                for (const uh of listAllUh) {
                    const assignedList = (uh.kelasId || '').toUpperCase().split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
                    const isClassMatch = assignedList.length === 0 || assignedList.includes('ALL') || assignedList.includes('SEMUA KELAS') ||
                        assignedList.includes(studentClass) || (studentLevel && assignedList.includes(studentLevel));

                    if (!isClassMatch) continue;

                    const myUhSub = uh.submissions && uh.submissions.length > 0 ? uh.submissions[0] : null;
                    const isDone = myUhSub && (myUhSub.status === 'SELESAI' || myUhSub.status === 'SUBMITTED');

                    mappedHomeworks.push({
                        id: uh.id,
                        title: `[UH] ${uh.mapelId} — ${uh.topik || 'Ulangan Harian'}`,
                        description: `Ulangan Harian oleh ${uh.guruName || 'Guru Mapel'} (${uh.totalSoal || 0} Soal • Durasi ${uh.durasiMenit || 60} Menit).`,
                        deadline: uh.waktuSelesai ? new Date(uh.waktuSelesai).toISOString() : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                        subjectId: uh.mapelId || '',
                        classId: uh.kelasId || studentClass,
                        teacherId: uh.guruId || null,
                        type: 'ULANGAN_HARIAN',
                        subject: { id: uh.mapelId || '', name: uh.mapelId || 'UH' },
                        class: { id: studentClass, name: studentClass },
                        isSubmitted: isDone,
                        submissionStatus: isDone ? (myUhSub?.nilai !== null ? 'GRADED' : 'SUBMITTED') : 'PENDING',
                        score: myUhSub?.nilai ?? null,
                        feedback: myUhSub?.catatanGuru ?? null,
                        submission: myUhSub ? {
                            id: myUhSub.id,
                            fileUrl: null,
                            notes: 'Selesai Ulangan Harian',
                            answers: null,
                            score: myUhSub.nilai,
                            autoScore: myUhSub.nilai,
                            teacherNote: myUhSub.catatanGuru,
                            submittedAt: myUhSub.updatedAt || myUhSub.createdAt
                        } : null
                    } as any);
                }
            } catch (err) {
                console.warn('Error bridging CBT/UH to homework list:', err);
            }
        }

        res.json(mappedHomeworks);
    } catch (error) {
        console.error('Error fetching homeworks:', error);
        res.status(500).json({ message: 'Gagal mengambil daftar tugas' });
    }
};

export const createHomework = async (req: Request, res: Response) => {
    try {
        const {
            title, description, subjectName, subject: subjectAlias,
            className, deadline, dueDate, startTime, endTime, type,
            questions, fileUrl, audioUrl, weight, category, allowUpload, uploadInstructions
        } = req.body;
        const user = (req as any).user;

        const resolvedSubjectName = (subjectName || subjectAlias || 'Umum').trim();
        const resolvedDeadline = deadline || dueDate;
        const rawClassName = (className || 'ALL').trim();

        let subject = await prisma.subject.findUnique({ where: { name: resolvedSubjectName } });
        if (!subject) {
            subject = await prisma.subject.create({ data: { name: resolvedSubjectName } });
        }

        const defaultEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const safeDeadlineDate = parseSafeDate(resolvedDeadline || endTime, defaultEndDate);
        const safeStartDate = parseSafeDate(startTime, new Date());
        const safeEndDate = parseSafeDate(endTime || resolvedDeadline, safeDeadlineDate);

        const targetClassNames = rawClassName
            .split(',')
            .map((c: string) => c.trim())
            .filter(Boolean);
        if (targetClassNames.length === 0) targetClassNames.push('ALL');

        const createdHomeworks: any[] = [];
        for (const cName of targetClassNames) {
            let cls = await prisma.class.findUnique({ where: { name: cName } });
            if (!cls) {
                cls = await prisma.class.create({ data: { name: cName } });
            }

            const hw = await prisma.homework.create({
                data: {
                    title: title || 'Tugas Baru',
                    description: description || '',
                    subjectId: subject.id,
                    classId: cls.id,
                    startTime: safeStartDate,
                    endTime: safeEndDate,
                    deadline: safeDeadlineDate,
                    type: type || 'ESSAY',
                    questions: typeof questions === 'string' ? questions : (questions ? JSON.stringify(questions) : null),
                    fileUrl: fileUrl || null,
                    audioUrl: audioUrl || null,
                    weight: Number(weight) || 100,
                    category: category || 'PR',
                    teacherId: user ? user.id : null,
                    allowUpload: allowUpload !== undefined ? Boolean(allowUpload) : true,
                    uploadInstructions: uploadInstructions || null
                },
                include: { subject: true, class: true }
            });
            createdHomeworks.push(hw);
        }

        const primaryHomework = createdHomeworks[0];
        res.json({
            success: true,
            message: `Tugas berhasil diterbitkan untuk Kelas ${targetClassNames.join(', ')}`,
            homework: primaryHomework,
            homeworks: createdHomeworks,
            ...primaryHomework
        });
    } catch (error) {
        console.error('Error creating homework:', error);
        res.status(500).json({ message: 'Gagal membuat tugas' });
    }
};

export const updateHomework = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const {
            title, description, subjectName, subject: subjectAlias,
            className, deadline, dueDate, startTime, endTime, type,
            questions, fileUrl, audioUrl, weight, category, allowUpload, uploadInstructions
        } = req.body;
        const user = (req as any).user;

        const existing = await prisma.homework.findUnique({ where: { id }, include: { class: true } });
        if (!existing) {
            return res.status(404).json({ message: 'Tugas tidak ditemukan' });
        }

        // Cek otorisasi guru
        if (user && user.role === 'TEACHER' && existing.teacherId && existing.teacherId !== user.id) {
            return res.status(403).json({ message: 'Akses ditolak: Anda hanya dapat mengubah tugas yang Anda buat sendiri.' });
        }

        const resolvedSubjectName = subjectName || subjectAlias;
        const resolvedDeadline = deadline !== undefined ? deadline : dueDate;

        const updateData: any = {};
        if (title !== undefined) updateData.title = title;
        if (description !== undefined) updateData.description = description;
        if (resolvedDeadline !== undefined) updateData.deadline = parseSafeDate(resolvedDeadline, existing.deadline || new Date());
        if (startTime !== undefined) updateData.startTime = parseSafeDate(startTime, existing.startTime || new Date());
        if (endTime !== undefined) updateData.endTime = parseSafeDate(endTime, existing.endTime || new Date());
        if (type !== undefined) updateData.type = type;
        if (questions !== undefined) updateData.questions = typeof questions === 'string' ? questions : JSON.stringify(questions);
        if (fileUrl !== undefined) updateData.fileUrl = fileUrl;
        if (audioUrl !== undefined) updateData.audioUrl = audioUrl;
        if (weight !== undefined) updateData.weight = Number(weight);
        if (category !== undefined) updateData.category = category;
        if (allowUpload !== undefined) updateData.allowUpload = Boolean(allowUpload);
        if (uploadInstructions !== undefined) updateData.uploadInstructions = uploadInstructions;

        if (resolvedSubjectName) {
            let subject = await prisma.subject.findUnique({ where: { name: resolvedSubjectName.trim() } });
            if (!subject) subject = await prisma.subject.create({ data: { name: resolvedSubjectName.trim() } });
            updateData.subjectId = subject.id;
        }

        if (className) {
            const firstClass = String(className).split(',')[0].trim();
            if (firstClass) {
                let cls = await prisma.class.findUnique({ where: { name: firstClass } });
                if (!cls) cls = await prisma.class.create({ data: { name: firstClass } });
                updateData.classId = cls.id;
            }
        }

        const updated = await prisma.homework.update({
            where: { id },
            data: updateData,
            include: { subject: true, class: true }
        });

        res.json({ success: true, message: 'Tugas berhasil diperbarui!', homework: updated });
    } catch (error) {
        console.error('Error updating homework:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui tugas' });
    }
};

export const deleteHomework = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        await prisma.homeworkSubmission.deleteMany({ where: { homeworkId: id } });
        await prisma.homework.delete({ where: { id } });
        res.json({ message: 'Tugas berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting homework:', error);
        res.status(500).json({ message: 'Gagal menghapus tugas' });
    }
};

// Ambil Seluruh Submisi / Pengumpulan Tugas Siswa
export const getHomeworkSubmissions = async (req: Request, res: Response) => {
    try {
        const homeworkId = req.params.id as string;
        const hw = await prisma.homework.findUnique({
            where: { id: homeworkId },
            include: {
                subject: true,
                class: true
            }
        });

        if (!hw) {
            return res.status(404).json({ message: 'Tugas tidak ditemukan' });
        }

        const classStudents = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                isActive: true,
                OR: [
                    { classId: hw.classId },
                    ...(hw.class?.name ? [{ className: { equals: hw.class.name, mode: 'insensitive' as any } }] : [])
                ]
            },
            orderBy: { name: 'asc' }
        });

        const submissions = await prisma.homeworkSubmission.findMany({
            where: { homeworkId },
            include: { user: true }
        });

        const subMap = new Map();
        submissions.forEach(s => subMap.set(s.userId, s));

        // Pastikan siswa yang sudah submit tetap muncul meskipun berbeda rombel/relasi
        const studentMap = new Map<string, any>();
        classStudents.forEach(st => studentMap.set(st.id, st));
        submissions.forEach(s => {
            if (s.user && !studentMap.has(s.userId)) {
                studentMap.set(s.userId, s.user);
            }
        });

        const allStudents = Array.from(studentMap.values());

        let totalQuestions = 0;
        try {
            if (hw.questions) {
                const qList = JSON.parse(hw.questions);
                if (Array.isArray(qList)) totalQuestions = qList.length;
            }
        } catch {}

        const studentList = allStudents.map(st => {
            const sub = subMap.get(st.id);
            const hasScore = sub && sub.score !== null && sub.score !== undefined;
            let answeredCount = 0;
            let lastAnsweredNo = 0;
            if (sub && sub.answers) {
                try {
                    const parsed = typeof sub.answers === 'string' ? JSON.parse(sub.answers) : sub.answers;
                    if (Array.isArray(parsed)) {
                        parsed.forEach((val, idx) => {
                            if (val !== null && val !== undefined && String(val).trim() !== '') {
                                answeredCount++;
                                lastAnsweredNo = idx + 1;
                            }
                        });
                    } else if (typeof parsed === 'object' && parsed !== null) {
                        Object.keys(parsed).forEach(k => {
                            const val = (parsed as any)[k];
                            if (val !== null && val !== undefined && String(val).trim() !== '') {
                                answeredCount++;
                                const num = parseInt(k.replace(/\D/g, ''), 10);
                                if (!isNaN(num) && num > lastAnsweredNo) lastAnsweredNo = num;
                            }
                        });
                    }
                } catch {}
            }
            const kurangCount = totalQuestions > 0 ? Math.max(0, totalQuestions - answeredCount) : 0;
            const posisiSoal = lastAnsweredNo > 0 ? (answeredCount < totalQuestions ? lastAnsweredNo + 1 : lastAnsweredNo) : (answeredCount > 0 ? answeredCount : 1);

            return {
                id: sub ? sub.id : null,
                submissionId: sub ? sub.id : null,
                studentId: st.id,
                studentName: st.name,
                nisn: st.nisn || st.username,
                submitted: !!sub,
                status: sub ? (hasScore ? 'GRADED' : 'SUBMITTED') : 'PENDING',
                submittedAt: sub ? sub.submittedAt : null,
                isLate: sub ? sub.isLate : false,
                fileUrl: sub ? sub.fileUrl : null,
                notes: sub ? (sub.answers || sub.teacherNote) : null,
                answers: sub ? sub.answers : null,
                autoScore: sub ? sub.autoScore : null,
                score: sub ? sub.score : null,
                teacherNote: sub ? sub.teacherNote : null,
                totalQuestions: totalQuestions > 0 ? totalQuestions : null,
                answeredCount: totalQuestions > 0 ? answeredCount : null,
                kurangCount: totalQuestions > 0 ? kurangCount : null,
                lastAnsweredNo: totalQuestions > 0 ? lastAnsweredNo : null,
                posisiSoal: totalQuestions > 0 ? posisiSoal : null
            };
        });

        res.json({
            homework: hw,
            submissions: studentList,
            stats: {
                totalStudents: allStudents.length,
                submittedCount: submissions.length,
                unsubmittedCount: Math.max(0, allStudents.length - submissions.length)
            }
        });
    } catch (error) {
        console.error('Error getting homework submissions:', error);
        res.status(500).json({ message: 'Gagal memuat submisi tugas' });
    }
};

// Nilai Submisi Siswa oleh Guru / Admin
export const gradeHomeworkSubmission = async (req: Request, res: Response) => {
    try {
        const { submissionId, homeworkId, studentId, score, teacherNote, feedback } = req.body;
        const resolvedNote = teacherNote !== undefined ? teacherNote : feedback;

        let submission = null;
        if (submissionId) {
            submission = await prisma.homeworkSubmission.findUnique({
                where: { id: String(submissionId) }
            });
        }
        if (!submission && homeworkId && studentId) {
            submission = await prisma.homeworkSubmission.findFirst({
                where: { homeworkId: String(homeworkId), userId: String(studentId) }
            });
        }

        if (submission) {
            submission = await prisma.homeworkSubmission.update({
                where: { id: submission.id },
                data: {
                    score: Number(score),
                    teacherNote: resolvedNote !== undefined ? resolvedNote : submission.teacherNote
                }
            });
        } else if (homeworkId && studentId) {
            submission = await prisma.homeworkSubmission.create({
                data: {
                    homeworkId: String(homeworkId),
                    userId: String(studentId),
                    score: Number(score),
                    teacherNote: resolvedNote || '',
                    fileUrl: 'Dinilai oleh guru'
                }
            });
        } else {
            return res.status(404).json({ message: 'Data pengumpulan tugas tidak ditemukan.' });
        }

        res.json({ success: true, message: 'Nilai tugas berhasil disimpan!', submission });
    } catch (error) {
        console.error('Error grading homework:', error);
        res.status(500).json({ message: 'Gagal menyimpan nilai tugas' });
    }
};

// Siswa mengumpulkan tugas dari APK
export const submitHomework = async (req: Request, res: Response) => {
    try {
        const { homeworkId, fileUrl, notes, answerText, fileBase64, fileName, answers } = req.body;
        const resolvedNotes = notes !== undefined ? notes : answerText;
        const user = (req as any).user;
        if (!user) return res.status(401).json({ message: 'Unauthorized' });

        if (!homeworkId) {
            return res.status(400).json({ message: 'homeworkId wajib diisi.' });
        }

        const hw = await prisma.homework.findUnique({ where: { id: homeworkId } });
        if (!hw) {
            return res.status(404).json({ message: 'Data tugas tidak ditemukan.' });
        }

        const now = new Date();
        if (hw.startTime && now < new Date(hw.startTime)) {
            const startStr = new Date(hw.startTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            return res.status(403).json({
                message: `Tugas belum dibuka! Waktu mulai pengerjaan dibuka pada pukul ${startStr} WIB.`
            });
        }

        const isLate = hw.endTime ? now > new Date(hw.endTime) : (hw.deadline ? now > new Date(hw.deadline) : false);

        // Auto-scoring untuk Tugas Pilihan Ganda (CBT Sederhana)
        let autoScore: number | null = null;
        let parsedAnswers: any = null;
        if (answers) {
            try {
                parsedAnswers = typeof answers === 'string' ? JSON.parse(answers) : answers;
            } catch (e) {
                parsedAnswers = answers;
            }
        }

        if (hw.questions) {
            try {
                const questionList: any[] = typeof hw.questions === 'string' ? JSON.parse(hw.questions) : hw.questions;
                const mcQuestions = questionList.filter(q => (q.type === 'PG' || q.type === 'MULTIPLE_CHOICE' || q.type === 'BENAR_SALAH' || !q.type));
                if (mcQuestions.length > 0 && parsedAnswers) {
                    let correctCount = 0;
                    const answerMap: Record<string, string> = {};
                    if (Array.isArray(parsedAnswers)) {
                        parsedAnswers.forEach((ans: any) => {
                            const qId = String(ans.questionId ?? ans.id ?? ans.number);
                            const val = ans.selectedOptionLetter || 
                                (typeof ans.selectedOption === 'number' ? String.fromCharCode(65 + ans.selectedOption) : String(ans.selectedOption || ''));
                            answerMap[qId] = val.trim().toUpperCase();
                        });
                    } else if (typeof parsedAnswers === 'object' && parsedAnswers !== null) {
                        Object.keys(parsedAnswers).forEach(k => {
                            const val = parsedAnswers[k];
                            const letter = typeof val === 'number' ? String.fromCharCode(65 + val) : String(val || '');
                            answerMap[String(k)] = letter.trim().toUpperCase();
                        });
                    }

                    mcQuestions.forEach((q, idx) => {
                        const qNum = String(q.number ?? idx + 1);
                        const qId = String(q.id ?? qNum);
                        const studentAnswer = answerMap[qNum] || answerMap[qId] || answerMap[String(idx)];
                        const correct = String(q.correctOption || '').trim().toUpperCase();
                        if (studentAnswer && correct && (studentAnswer === correct || studentAnswer === correct.charAt(0))) {
                            correctCount++;
                        }
                    });
                    autoScore = Math.round((correctCount / mcQuestions.length) * 100);
                }
            } catch (calcErr) {
                console.warn('Auto score calculation error:', calcErr);
            }
        }

        let finalFileUrl = fileUrl || '';

        // Simpan file unggahan jika dikirimkan via Base64 dari APK
        if (fileBase64) {
            try {
                const ext = (path.extname(fileName || '.jpg') || '.jpg').toLowerCase();
                const cleanBase64 = String(fileBase64).replace(/^data:.*?;base64,/, '');
                const buffer = Buffer.from(cleanBase64, 'base64');

                // BUG-NEW-12 Fix: Validasi tipe berkas dan magic bytes keamanan
                const dangerousExts = ['.exe', '.apk', '.bat', '.cmd', '.sh', '.php', '.phtml', '.js', '.vbs', '.py', '.msi', '.com', '.scr', '.jar'];
                if (dangerousExts.includes(ext)) {
                    return res.status(400).json({ success: false, message: `Ekstensi berkas '${ext}' dilarang demi integritas dan keamanan sistem sekolah.` });
                }

                // Cek Magic Bytes PE / Executable binary (MZ header)
                if (buffer.length >= 2 && buffer[0] === 0x4D && buffer[1] === 0x5A) {
                    return res.status(400).json({ success: false, message: 'Berkas binary executable (PE/MZ) ditolak demi keamanan server.' });
                }
                // Cek Magic Bytes Linux ELF binary
                if (buffer.length >= 4 && buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
                    return res.status(400).json({ success: false, message: 'Berkas binary ELF Linux ditolak demi keamanan server.' });
                }

                const uploadDir = path.resolve(process.cwd(), 'uploads/homework-submissions');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                const safeFileName = `hw_${homeworkId}_${user.id}_${Date.now()}${ext}`;
                const targetPath = path.join(uploadDir, safeFileName);
                fs.writeFileSync(targetPath, buffer);
                finalFileUrl = `/uploads/homework-submissions/${safeFileName}`;
            } catch (fileErr) {
                console.error('Error saving homework file:', fileErr);
            }
        }

        let submission = await prisma.homeworkSubmission.findFirst({
            where: { homeworkId, userId: user.id }
        });

        const answersString = parsedAnswers
            ? (typeof parsedAnswers === 'string' ? parsedAnswers : JSON.stringify(parsedAnswers))
            : (resolvedNotes ? String(resolvedNotes) : null);

        if (submission) {
            submission = await prisma.homeworkSubmission.update({
                where: { id: submission.id },
                data: {
                    fileUrl: finalFileUrl || submission.fileUrl || (autoScore !== null ? 'Pilihan Ganda CBT' : 'Jawaban Terkirim'),
                    submittedAt: new Date(),
                    isLate,
                    answers: answersString || submission.answers,
                    autoScore: autoScore !== null ? autoScore : submission.autoScore,
                    score: autoScore !== null ? autoScore : submission.score
                }
            });
        } else {
            submission = await prisma.homeworkSubmission.create({
                data: {
                    homeworkId,
                    userId: user.id,
                    fileUrl: finalFileUrl || (autoScore !== null ? 'Pilihan Ganda CBT' : 'Jawaban Terkirim'),
                    submittedAt: new Date(),
                    isLate,
                    answers: answersString,
                    autoScore,
                    score: autoScore,
                    teacherNote: ''
                }
            });
        }

        res.json({ success: true, message: 'Tugas berhasil dikumpulkan ke server!', submission, fileUrl: finalFileUrl });
    } catch (error) {
        console.error('Error submitting homework:', error);
        res.status(500).json({ message: 'Gagal mengumpulkan tugas' });
    }
};

// Duplikasi Tugas / PR ke Kelas Lain
export const duplicateHomework = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { targetClassName, newDeadline } = req.body;
        const user = (req as any).user;

        const homeworkId = Array.isArray(id) ? id[0] : id;
        const source = await prisma.homework.findUnique({
            where: { id: homeworkId },
            include: { subject: true }
        });

        if (!source) {
            return res.status(404).json({ success: false, message: 'Tugas sumber tidak ditemukan' });
        }

        if (!targetClassName) {
            return res.status(400).json({ success: false, message: 'Kelas tujuan wajib dipilih' });
        }

        let targetClass = await prisma.class.findUnique({ where: { name: targetClassName } });
        if (!targetClass) {
            targetClass = await prisma.class.create({ data: { name: targetClassName } });
        }

        const duplicated = await prisma.homework.create({
            data: {
                title: `${source.title} (Salinan ${targetClassName})`,
                description: source.description,
                subjectId: source.subjectId,
                classId: targetClass.id,
                deadline: newDeadline ? new Date(newDeadline) : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                fileUrl: source.fileUrl,
                audioUrl: source.audioUrl,
                weight: source.weight,
                category: source.category,
                teacherId: user ? user.id : source.teacherId
            },
            include: { subject: true, class: true }
        });

        res.json({
            success: true,
            message: `Tugas berhasil diduplikasi ke kelas ${targetClassName}!`,
            homework: duplicated
        });
    } catch (error: any) {
        console.error('Error duplicating homework:', error);
        res.status(500).json({ success: false, message: 'Gagal menduplikasi tugas: ' + error.message });
    }
};


