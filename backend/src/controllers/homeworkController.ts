import { Request, Response } from 'express';
import prisma from '../utils/db';
import path from 'path';
import fs from 'fs';

export const getHomeworks = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const whereClause: any = {};

        if (user && user.role === 'TEACHER') {
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
            return {
                ...h,
                isSubmitted: !!sub,
                submission: sub ? {
                    id: sub.id,
                    score: sub.score,
                    teacherNote: sub.teacherNote,
                    submittedAt: sub.submittedAt
                } : null
            };
        });

        res.json(mappedHomeworks);
    } catch (error) {
        console.error('Error fetching homeworks:', error);
        res.status(500).json({ message: 'Gagal mengambil daftar tugas' });
    }
};

export const createHomework = async (req: Request, res: Response) => {
    try {
        const { title, description, subjectName, className, deadline, startTime, endTime, type, questions, fileUrl, audioUrl, weight, category, allowUpload, uploadInstructions } = req.body;
        const user = (req as any).user;

        if (user && user.role === 'TEACHER' && user.teachingClasses) {
            const allowed = user.teachingClasses.split(',').map((c: string) => c.trim());
            if (!allowed.includes(className) && allowed.length > 0) {
                return res.status(403).json({
                    message: 'Akses Ditolak! Anda hanya diizinkan membuat tugas untuk kelas Anda: ' + user.teachingClasses
                });
            }
        }

        let subject = await prisma.subject.findUnique({ where: { name: subjectName } });
        if (!subject) {
            subject = await prisma.subject.create({ data: { name: subjectName } });
        }

        let cls = await prisma.class.findUnique({ where: { name: className } });
        if (!cls) {
            cls = await prisma.class.create({ data: { name: className } });
        }

        const homework = await prisma.homework.create({
            data: {
                title,
                description: description || '',
                subjectId: subject.id,
                classId: cls.id,
                startTime: startTime ? new Date(startTime) : new Date(),
                endTime: endTime ? new Date(endTime) : (deadline ? new Date(deadline) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
                deadline: deadline ? new Date(deadline) : (endTime ? new Date(endTime) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
                type: type || 'ESSAY',
                questions: typeof questions === 'string' ? questions : (questions ? JSON.stringify(questions) : null),
                fileUrl: fileUrl || null,
                audioUrl: audioUrl || null,
                weight: Number(weight) || 100,
                category: category || 'PR',
                teacherId: user ? user.id : null,
                allowUpload: allowUpload !== undefined ? Boolean(allowUpload) : true,
                uploadInstructions: uploadInstructions || null
            }
        });

        res.json({ message: 'Tugas berhasil dibuat untuk Kelas ' + cls.name, homework });
    } catch (error) {
        console.error('Error creating homework:', error);
        res.status(500).json({ message: 'Gagal membuat tugas' });
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
                class: {
                    include: {
                        users: {
                            where: { role: 'STUDENT', isActive: true },
                            orderBy: { name: 'asc' }
                        }
                    }
                }
            }
        });

        if (!hw) {
            return res.status(404).json({ message: 'Tugas tidak ditemukan' });
        }

        const submissions = await prisma.homeworkSubmission.findMany({
            where: { homeworkId },
            include: { user: true }
        });

        const subMap = new Map();
        submissions.forEach(s => subMap.set(s.userId, s));

        const studentList = hw.class.users.map(st => {
            const sub = subMap.get(st.id);
            return {
                studentId: st.id,
                studentName: st.name,
                nisn: st.nisn || st.username,
                submitted: !!sub,
                submittedAt: sub ? sub.submittedAt : null,
                isLate: sub ? sub.isLate : false,
                fileUrl: sub ? sub.fileUrl : null,
                notes: sub ? sub.teacherNote : null,
                answers: sub ? sub.answers : null,
                autoScore: sub ? sub.autoScore : null,
                score: sub ? sub.score : null,
                teacherNote: sub ? sub.teacherNote : null
            };
        });

        res.json({
            homework: hw,
            submissions: studentList,
            stats: {
                totalStudents: hw.class.users.length,
                submittedCount: submissions.length,
                unsubmittedCount: hw.class.users.length - submissions.length
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
        const { homeworkId, studentId, score, teacherNote } = req.body;

        let submission = await prisma.homeworkSubmission.findFirst({
            where: { homeworkId, userId: studentId }
        });

        if (submission) {
            submission = await prisma.homeworkSubmission.update({
                where: { id: submission.id },
                data: {
                    score: Number(score),
                    teacherNote: teacherNote || submission.teacherNote
                }
            });
        } else {
            submission = await prisma.homeworkSubmission.create({
                data: {
                    homeworkId,
                    userId: studentId,
                    score: Number(score),
                    teacherNote: teacherNote || '',
                    fileUrl: 'Dinilai oleh guru'
                }
            });
        }

        res.json({ message: 'Nilai tugas berhasil disimpan!', submission });
    } catch (error) {
        console.error('Error grading homework:', error);
        res.status(500).json({ message: 'Gagal menyimpan nilai tugas' });
    }
};

// Siswa mengumpulkan tugas dari APK
export const submitHomework = async (req: Request, res: Response) => {
    try {
        const { homeworkId, fileUrl, notes, fileBase64, fileName, answers } = req.body;
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
                if (mcQuestions.length > 0 && parsedAnswers && typeof parsedAnswers === 'object') {
                    let correctCount = 0;
                    mcQuestions.forEach((q, idx) => {
                        const qId = q.id || String(idx + 1);
                        const studentAnswer = parsedAnswers[qId] || parsedAnswers[idx] || parsedAnswers[String(idx)];
                        if (studentAnswer && q.correctOption && String(studentAnswer).trim().toUpperCase() === String(q.correctOption).trim().toUpperCase()) {
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

        const answersString = parsedAnswers ? (typeof parsedAnswers === 'string' ? parsedAnswers : JSON.stringify(parsedAnswers)) : null;

        if (submission) {
            submission = await prisma.homeworkSubmission.update({
                where: { id: submission.id },
                data: {
                    fileUrl: finalFileUrl || submission.fileUrl || (autoScore !== null ? 'Pilihan Ganda CBT' : 'Jawaban Terkirim'),
                    submittedAt: new Date(),
                    isLate,
                    answers: answersString || submission.answers,
                    autoScore: autoScore !== null ? autoScore : submission.autoScore,
                    score: autoScore !== null ? autoScore : submission.score,
                    teacherNote: notes || submission.teacherNote
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
                    teacherNote: notes || ''
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


