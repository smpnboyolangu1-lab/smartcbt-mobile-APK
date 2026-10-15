import { Request, Response } from 'express';
import prisma from '../utils/db';
import { getClassExamToken, getClassProctors, setClassProctor, generate5CharToken } from './cbtController';

export const getTeacherExams = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const isOfficialAdmin = user && ['ADMIN', 'OPERATOR', 'KURIKULUM', 'KEPSEK'].includes(String(user.role).toUpperCase());
        
        const whereClause: any = {};
        if (!isOfficialAdmin && user) {
            // Guru biasa: HANYA tampilkan Ulangan Harian (UH/FORMATIF) miliknya sendiri atau buatannya
            // Ujian Resmi (SAS/STS/ASAT/US) dikelola oleh Kurikulum & Operator, disembunyikan dari guru
            whereClause.OR = [
                { teacherId: user.id },
                { authorTeacherIds: { contains: user.id } },
                { authorTeacherIds: { contains: user.name } }
            ];
            whereClause.examType = { in: ['UH', 'FORMATIF', 'HARIAN', 'ULANGAN_HARIAN', 'REMEDIAL'] };
        }

        const [exams, classes] = await Promise.all([
            prisma.exam.findMany({
                where: whereClause,
                include: {
                    subject: true,
                    proctorAssignments: true,
                    _count: { select: { questions: true, studentExams: true } }
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.class.findMany({ orderBy: { name: 'asc' } })
        ]);

        const enrichedExams = exams.map(exam => {
            const classTokensMap: Record<string, string> = {};
            const assigned = (exam.assignedClasses || 'ALL').trim();
            
            let targetClasses: string[] = [];
            if (assigned === 'ALL' || assigned === 'Semua Kelas' || !assigned) {
                targetClasses = classes.map(c => c.name);
            } else {
                targetClasses = assigned.split(',').map(c => c.trim()).filter(Boolean);
            }

            for (const cls of targetClasses) {
                classTokensMap[cls] = getClassExamToken(exam.id, cls, exam.token);
            }

            const classProctorsMap: Record<string, any> = { ...getClassProctors(exam.id) };
            if ((exam as any).proctorAssignments && Array.isArray((exam as any).proctorAssignments)) {
                for (const pa of (exam as any).proctorAssignments) {
                    classProctorsMap[pa.className] = {
                        proctorId: pa.proctorId,
                        proctorName: pa.proctorName,
                        roomName: pa.roomName
                    };
                }
            }

            return {
                ...exam,
                classTokens: classTokensMap,
                classProctors: classProctorsMap,
                targetClassesList: targetClasses
            };
        });

        res.json(enrichedExams);
    } catch (error) {
        console.error('Error fetching exams:', error);
        res.status(500).json({ message: 'Error fetching exams' });
    }
};

export const createExam = async (req: Request, res: Response) => {
    const {
        title, subjectName, durationMinutes, minDurationMinutes, assignedClasses,
        sessionName, executionDate, startTimeStr, endTimeStr, randomizeQuestions,
        randomizeOptions, showScoreToStudent, maxStrikes, examType, roomName,
        proctorName, passingGrade, level, packageCode, status, authorTeacherIds,
        isOptionDOnly, isSpecialExam, autoActiveOnSchedule
    } = req.body;
    const user = (req as any).user;

    try {
        const subName = (subjectName || 'Umum').trim();
        let subject = await prisma.subject.findUnique({ where: { name: subName } });
        if (!subject) {
            subject = await prisma.subject.create({ data: { name: subName } });
        }

        const tokenStr = generate5CharToken();

        const exam = await prisma.exam.create({
            data: {
                title: title || 'Paket Ujian Baru',
                packageCode: packageCode || `PKG-${tokenStr}`,
                subjectId: subject.id,
                durationMinutes: Number(durationMinutes) || 90,
                minDurationMinutes: Number(minDurationMinutes) || 30,
                token: tokenStr,
                isTokenActive: false,
                status: status || 'DRAFT',
                assignedClasses: Array.isArray(assignedClasses) ? assignedClasses.join(',') : (assignedClasses || 'ALL'),
                sessionName: sessionName || 'Sesi 1 (Pagi)',
                roomName: roomName || 'Lab Komputer 1',
                proctorName: proctorName || 'Proktor Utama',
                passingGrade: Number(passingGrade) || 75,
                level: level || 'ALL',
                examType: examType || 'SAS',
                executionDate: executionDate || new Date().toISOString().split('T')[0],
                startTimeStr: startTimeStr || '07:30',
                endTimeStr: endTimeStr || '09:30',
                randomizeQuestions: randomizeQuestions !== undefined ? Boolean(randomizeQuestions) : true,
                randomizeOptions: randomizeOptions !== undefined ? Boolean(randomizeOptions) : true,
                isOptionDOnly: isOptionDOnly !== undefined ? Boolean(isOptionDOnly) : true,
                isSpecialExam: isSpecialExam !== undefined ? Boolean(isSpecialExam) : false,
                autoActiveOnSchedule: autoActiveOnSchedule !== undefined ? Boolean(autoActiveOnSchedule) : true,
                showScoreToStudent: Boolean(showScoreToStudent),
                maxStrikes: Number(maxStrikes) || 3,
                authorTeacherIds: authorTeacherIds ? (typeof authorTeacherIds === 'string' ? authorTeacherIds : JSON.stringify(authorTeacherIds)) : (user?.id ? JSON.stringify([user.id]) : null),
                teacherId: user ? user.id : null
            },
            include: { subject: true }
        });
        res.json({
            success: true,
            message: 'Ulangan CBT berhasil dibuat!',
            ...exam
        });
    } catch (error) {
        console.error('Error creating exam:', error);
        res.status(500).json({ success: false, message: 'Error creating exam' });
    }
};

export const scheduleNationalExam = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const {
        title, subjectName, durationMinutes, minDurationMinutes, assignedClasses,
        sessionName, executionDate, startTimeStr, endTimeStr, isTokenActive,
        randomizeQuestions, randomizeOptions, showScoreToStudent, maxStrikes,
        resetToken, examType, roomName, proctorName, passingGrade, level,
        packageCode, status, isOptionDOnly, isSpecialExam, autoActiveOnSchedule
    } = req.body;
    try {
        const updateData: any = {};
        if (title) updateData.title = title;
        if (packageCode) updateData.packageCode = packageCode;
        if (status) updateData.status = status;
        if (durationMinutes) updateData.durationMinutes = Number(durationMinutes);
        if (minDurationMinutes !== undefined) updateData.minDurationMinutes = Number(minDurationMinutes);
        if (assignedClasses !== undefined) updateData.assignedClasses = Array.isArray(assignedClasses) ? assignedClasses.join(',') : assignedClasses;
        if (sessionName !== undefined) updateData.sessionName = sessionName;
        if (roomName !== undefined) updateData.roomName = roomName;
        if (proctorName !== undefined) updateData.proctorName = proctorName;
        if (passingGrade !== undefined) updateData.passingGrade = Number(passingGrade);
        if (level !== undefined) updateData.level = level;
        if (examType !== undefined) updateData.examType = examType;
        if (executionDate !== undefined) updateData.executionDate = executionDate;
        if (startTimeStr !== undefined) updateData.startTimeStr = startTimeStr;
        if (endTimeStr !== undefined) updateData.endTimeStr = endTimeStr;
        if (isTokenActive !== undefined) updateData.isTokenActive = Boolean(isTokenActive);
        if (randomizeQuestions !== undefined) updateData.randomizeQuestions = Boolean(randomizeQuestions);
        if (randomizeOptions !== undefined) updateData.randomizeOptions = Boolean(randomizeOptions);
        if (isOptionDOnly !== undefined) updateData.isOptionDOnly = Boolean(isOptionDOnly);
        if (isSpecialExam !== undefined) updateData.isSpecialExam = Boolean(isSpecialExam);
        if (autoActiveOnSchedule !== undefined) updateData.autoActiveOnSchedule = Boolean(autoActiveOnSchedule);
        if (showScoreToStudent !== undefined) updateData.showScoreToStudent = Boolean(showScoreToStudent);
        if (maxStrikes !== undefined) updateData.maxStrikes = Number(maxStrikes);
        if (resetToken) updateData.token = Math.random().toString(36).substring(2, 8).toUpperCase();

        if (subjectName) {
            let subject = await prisma.subject.findUnique({ where: { name: subjectName.trim() } });
            if (!subject) {
                subject = await prisma.subject.create({ data: { name: subjectName.trim() } });
            }
            updateData.subjectId = subject.id;
        }

        const updated = await prisma.exam.update({
            where: { id },
            data: updateData,
            include: { subject: true }
        });

        const { proctorAssignments } = req.body;
        if (Array.isArray(proctorAssignments) && proctorAssignments.length > 0) {
            for (const p of proctorAssignments) {
                if (p.className && p.proctorId) {
                    await (prisma as any).examProctorAssignment.upsert({
                        where: { examId_className: { examId: id, className: p.className } },
                        create: { examId: id, className: p.className, proctorId: p.proctorId, proctorName: p.proctorName || '', roomName: p.roomName || '' },
                        update: { proctorId: p.proctorId, proctorName: p.proctorName || '', roomName: p.roomName || '' }
                    }).catch(() => null);
                    setClassProctor(id, p.className, p.proctorName || '', p.roomName, p.proctorId);
                }
            }
        }

        res.json({ message: 'Penjadwalan dan konfigurasi Ujian berhasil disimpan', exam: updated });
    } catch (error) {
        console.error('Error scheduling exam:', error);
        res.status(500).json({ message: 'Gagal memperbarui jadwal ujian' });
    }
};

export const getExamResults = async (req: Request, res: Response) => {
    try {
        const examId = (req.params.id || req.query.examId) as string;
        const className = (req.query.className || req.query.targetClass) as string;

        const whereClause: any = {};
        if (examId && examId !== 'ALL') {
            whereClause.examId = String(examId);
        }

        const studentExams = await prisma.studentExam.findMany({
            where: whereClause,
            include: {
                user: true,
                exam: { include: { subject: true, _count: { select: { questions: true } } } }
            },
            orderBy: [
                { score: 'desc' },
                { startTime: 'asc' }
            ]
        });

        let results = studentExams;
        if (className && className !== 'ALL') {
            results = results.filter(se => se.user.className === className);
        }

        res.json(results);
    } catch (error) {
        console.error('Error getting exam results:', error);
        res.status(500).json({ message: 'Gagal mengambil rekap hasil ujian' });
    }
};

export const deleteExam = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        await prisma.question.deleteMany({ where: { examId: id } });
        await prisma.studentExam.deleteMany({ where: { examId: id } });
        await prisma.exam.delete({ where: { id } });
        res.json({ message: 'Paket ujian berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus ujian' });
    }
};

import fs from 'fs';
import path from 'path';

export const deleteQuestion = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        await prisma.question.delete({ where: { id } });
        res.json({ message: 'Butir soal berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({ message: 'Gagal menghapus butir soal' });
    }
};

export const uploadQuestionImage = async (req: Request, res: Response) => {
    try {
        const { imageBase64, fileName } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ message: 'Data gambar (base64) wajib dikirim' });
        }

        const uploadDir = path.join(process.cwd(), 'uploads', 'questions');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        let ext = 'png';
        let base64Data = imageBase64;
        const allowedImageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
        const matches = imageBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches) {
            const rawExt = matches[1] === 'jpeg' ? 'jpg' : matches[1].toLowerCase();
            ext = allowedImageExts.includes(rawExt) ? rawExt : 'png';
            base64Data = matches[2];
        }

        const safeFileName = `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
        const targetPath = path.join(uploadDir, safeFileName);

        fs.writeFileSync(targetPath, Buffer.from(base64Data, 'base64'));

        const publicUrl = `/uploads/questions/${safeFileName}`;
        res.json({
            message: 'Gambar soal berhasil diunggah',
            imageUrl: publicUrl,
            location: publicUrl // TinyMCE image upload compatibility
        });
    } catch (error) {
        console.error('Error uploading question image:', error);
        res.status(500).json({ message: 'Gagal mengunggah gambar soal' });
    }
};

export const uploadQuestionAudio = async (req: Request, res: Response) => {
    try {
        const { audioBase64, fileName } = req.body;
        if (!audioBase64) {
            return res.status(400).json({ message: 'Data audio (base64) wajib dikirim' });
        }

        const uploadDir = path.join(process.cwd(), 'uploads', 'questions', 'audio');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        let ext = 'mp3';
        let base64Data = audioBase64;
        const allowedAudioExts = ['mp3', 'wav', 'ogg', 'm4a', 'aac'];
        const matches = audioBase64.match(/^data:audio\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches) {
            const rawExt = matches[1].toLowerCase();
            ext = allowedAudioExts.includes(rawExt) ? rawExt : 'mp3';
            base64Data = matches[2];
        }

        const safeFileName = `audio_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
        const targetPath = path.join(uploadDir, safeFileName);

        fs.writeFileSync(targetPath, Buffer.from(base64Data, 'base64'));

        const publicUrl = `/uploads/questions/audio/${safeFileName}`;
        res.json({
            success: true,
            message: 'Audio soal listening berhasil diunggah',
            audioUrl: publicUrl
        });
    } catch (error: any) {
        console.error('Error uploading question audio:', error);
        res.status(500).json({ message: 'Gagal mengunggah audio listening' });
    }
};

export const getQuestions = async (req: Request, res: Response) => {
    try {
        const examId = req.params.examId as string;
        const questions = await prisma.question.findMany({
            where: { examId },
            orderBy: { orderNum: 'asc' }
        });
        res.json(questions);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching questions' });
    }
};

function normalizeCorrectOption(raw: any): string {
    if (!raw) return 'A';
    const s = String(raw).trim();
    if (s.includes(',')) {
        return s.split(',').map(x => x.trim().toUpperCase()).filter(Boolean).sort().join(',');
    }
    return s.toUpperCase();
}

export const createQuestion = async (req: Request, res: Response) => {
    const examId = req.params.examId as string;
    const { content, type, correctOption, options, imageUrl, audioUrl, cognitiveLevel, kdTag, explanation } = req.body;
    try {
        const count = await prisma.question.count({ where: { examId } });
        const mediaType = imageUrl && audioUrl ? 'BOTH' : (imageUrl ? 'IMAGE' : (audioUrl ? 'AUDIO' : 'NONE'));

        const question = await prisma.question.create({
            data: {
                examId,
                content,
                type: type || 'MULTIPLE_CHOICE',
                imageUrl: imageUrl || null,
                audioUrl: audioUrl || null,
                mediaType,
                correctOption: normalizeCorrectOption(correctOption),
                options: typeof options === 'object' ? JSON.stringify(options) : options,
                cognitiveLevel: cognitiveLevel || 'C3',
                kdTag: kdTag || null,
                explanation: explanation || null,
                orderNum: count + 1
            }
        });
        res.json(question);
    } catch (error) {
        console.error('Error creating question:', error);
        res.status(500).json({ message: 'Error creating question' });
    }
};

export const updateQuestion = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { content, type, correctOption, options, imageUrl, audioUrl, cognitiveLevel, kdTag, orderNum, explanation } = req.body;
    try {
        const mediaType = imageUrl && audioUrl ? 'BOTH' : (imageUrl ? 'IMAGE' : (audioUrl ? 'AUDIO' : 'NONE'));
        const updateData: any = {
            content,
            correctOption: normalizeCorrectOption(correctOption),
            options: typeof options === 'object' ? JSON.stringify(options) : options,
            imageUrl: imageUrl || null,
            audioUrl: audioUrl || null,
            mediaType
        };
        if (type !== undefined) updateData.type = type;
        if (cognitiveLevel !== undefined) updateData.cognitiveLevel = cognitiveLevel;
        if (kdTag !== undefined) updateData.kdTag = kdTag;
        if (orderNum !== undefined) updateData.orderNum = Number(orderNum);
        if (explanation !== undefined) updateData.explanation = explanation;

        const question = await prisma.question.update({
            where: { id },
            data: updateData
        });
        res.json(question);
    } catch (error) {
        console.error('Error updating question:', error);
        res.status(500).json({ message: 'Error updating question' });
    }
};

// ==========================================
// FITUR BEESMART CBT: LEMBAR JAWABAN SISWA (LJS DIGITAL)
// ==========================================
export const getStudentExamLjs = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const studentExam = await prisma.studentExam.findUnique({
            where: { id: String(id) },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        className: true,
                        nisn: true
                    }
                },
                exam: {
                    include: {
                        subject: true,
                        questions: {
                            orderBy: { orderNum: 'asc' }
                        }
                    }
                }
            }
        });

        if (!studentExam) {
            return res.status(404).json({ message: 'Lembar Ujian Siswa tidak ditemukan' });
        }

        const authUser = (req as any).user;
        if (authUser && authUser.role === 'STUDENT') {
            if (studentExam.userId !== authUser.id) {
                return res.status(403).json({ message: 'Akses ditolak: Lembar ujian ini bukan milik Anda.' });
            }
        }

        // Parse student answers
        let answersObj: Record<string, string> = {};
        if (studentExam.answers) {
            try {
                const parsed = JSON.parse(studentExam.answers);
                if (Array.isArray(parsed)) {
                    parsed.forEach((item: any) => {
                        if (item.questionId) {
                            answersObj[item.questionId] = String(item.answer || '').toUpperCase().trim();
                        }
                    });
                } else if (typeof parsed === 'object') {
                    Object.keys(parsed).forEach(k => {
                        answersObj[k] = String(parsed[k] || '').toUpperCase().trim();
                    });
                }
            } catch (e) {
                console.warn('Error parsing student answers for LJS:', e);
            }
        }

        let totalCorrect = 0;
        let totalWrong = 0;
        let totalUnattempted = 0;
        const questions = studentExam.exam?.questions || [];

        const items = questions.map(q => {
            const studentAnswer = answersObj[q.id] || answersObj[String(q.orderNum)] || '';
            const correctOption = (q.correctOption || '').toUpperCase().trim();
            const hasAnswer = studentAnswer.length > 0;
            const isCorrect = hasAnswer && (correctOption === studentAnswer);

            if (!hasAnswer) {
                totalUnattempted++;
            } else if (isCorrect) {
                totalCorrect++;
            } else {
                totalWrong++;
            }

            const isStudentRole = Boolean(authUser && authUser.role === 'STUDENT');

            return {
                id: q.id,
                orderNum: q.orderNum,
                content: q.content,
                type: q.type,
                options: q.options,
                imageUrl: q.imageUrl,
                correctOption: isStudentRole ? null : correctOption,
                studentAnswer,
                explanation: isStudentRole ? '' : ((q as any).explanation || ''),
                isCorrect: isStudentRole ? null : (q.type === 'ESSAY' ? null : isCorrect),
                status: isStudentRole ? (!hasAnswer ? 'KOSONG' : 'DIJAWAB') : (!hasAnswer ? 'KOSONG' : (isCorrect ? 'BENAR' : 'SALAH'))
            };
        });

        const totalQuestions = questions.length;
        const passingGrade = studentExam.exam?.passingGrade || 75;
        const isPassed = (studentExam.score ?? 0) >= passingGrade;

        res.json({
            studentExam: {
                id: studentExam.id,
                status: studentExam.status,
                score: studentExam.score,
                strikeCount: studentExam.strikeCount || 0,
                startTime: studentExam.startTime,
                endTime: studentExam.endTime,
                user: studentExam.user,
                exam: {
                    id: studentExam.exam.id,
                    title: studentExam.exam.title,
                    examType: studentExam.exam.examType || 'SAS',
                    subjectName: studentExam.exam.subject?.name || '-',
                    durationMinutes: studentExam.exam.durationMinutes,
                    passingGrade,
                    roomName: studentExam.exam.roomName || 'Lab Komputer 1',
                    proctorName: studentExam.exam.proctorName || 'Proktor Utama',
                    isPassed
                }
            },
            summary: {
                totalQuestions,
                totalAttempted: totalCorrect + totalWrong,
                totalCorrect,
                totalWrong,
                totalUnattempted,
                passingGrade,
                isPassed,
                finalScore: studentExam.score ?? 0
            },
            items
        });
    } catch (error) {
        console.error('Error fetching student exam LJS:', error);
        res.status(500).json({ message: 'Gagal memuat Lembar Jawaban Siswa (LJS)' });
    }
};

// ==========================================
// FITUR BEESMART CBT: EKSPOR REKAP NILAI KE CSV / EXCEL
// ==========================================
export const exportExamResultsCsv = async (req: Request, res: Response) => {
    try {
        const { examId, className } = req.query;

        const whereClause: any = {};
        if (examId && examId !== 'ALL') {
            whereClause.examId = String(examId);
        }

        const studentExams = await prisma.studentExam.findMany({
            where: whereClause,
            include: {
                user: true,
                exam: {
                    include: {
                        subject: true,
                        questions: { select: { id: true, correctOption: true, orderNum: true } }
                    }
                }
            },
            orderBy: [
                { score: 'desc' },
                { startTime: 'asc' }
            ]
        });

        let results = studentExams;
        if (className && className !== 'ALL') {
            results = results.filter(se => se.user.className === className);
        }

        // Generate CSV rows with BOM for Excel compatibility in Indonesia
        const escapeCsv = (str: any) => {
            if (str === null || str === undefined) return '""';
            const s = String(str).replace(/"/g, '""');
            return `"${s}"`;
        };

        const headers = [
            'No',
            'NISN',
            'Nama Siswa',
            'Kelas',
            'Mata Pelajaran',
            'Paket Ujian',
            'Jenis Asesmen',
            'Status',
            'Benar',
            'Salah',
            'Nilai Akhir',
            'KKM',
            'Ketuntasan',
            'Pelanggaran (Strike)',
            'Waktu Mulai',
            'Waktu Selesai'
        ];

        const csvRows: string[] = [headers.join(',')];

        results.forEach((se, idx) => {
            // Count correct / wrong answers
            let correctCount = 0;
            let wrongCount = 0;
            if (se.answers && se.exam?.questions) {
                try {
                    let answersObj: Record<string, string> = {};
                    const parsed = JSON.parse(se.answers);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((item: any) => {
                            if (item.questionId) answersObj[item.questionId] = String(item.answer || '').toUpperCase().trim();
                        });
                    } else if (typeof parsed === 'object') {
                        Object.keys(parsed).forEach(k => {
                            answersObj[k] = String(parsed[k] || '').toUpperCase().trim();
                        });
                    }
                    se.exam.questions.forEach(q => {
                        const ans = answersObj[q.id] || answersObj[String(q.orderNum)] || '';
                        if (ans) {
                            if (q.correctOption && ans === q.correctOption.toUpperCase().trim()) {
                                correctCount++;
                            } else {
                                wrongCount++;
                            }
                        }
                    });
                } catch (e) {}
            }

            const kkm = se.exam?.passingGrade || 75;
            const score = se.score ?? 0;
            const ketuntasan = score >= kkm ? 'TUNTAS' : 'BELUM TUNTAS';
            const startTimeStr = se.startTime ? new Date(se.startTime).toLocaleString('id-ID') : '-';
            const endTimeStr = se.endTime ? new Date(se.endTime).toLocaleString('id-ID') : '-';

            const row = [
                idx + 1,
                escapeCsv(se.user.nisn || '-'),
                escapeCsv(se.user.name),
                escapeCsv(se.user.className || '-'),
                escapeCsv(se.exam?.subject?.name || '-'),
                escapeCsv(se.exam?.title || '-'),
                escapeCsv(se.exam?.examType || 'SAS'),
                escapeCsv(se.status),
                correctCount,
                wrongCount,
                score,
                kkm,
                escapeCsv(ketuntasan),
                se.strikeCount || 0,
                escapeCsv(startTimeStr),
                escapeCsv(endTimeStr)
            ];

            csvRows.push(row.join(','));
        });

        // Add UTF-8 BOM (\uFEFF) so Excel opens Indonesian characters perfectly
        const csvContent = '\uFEFF' + csvRows.join('\r\n');
        const filename = `rekap_nilai_cbt_${new Date().toISOString().split('T')[0]}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.status(200).send(csvContent);
    } catch (error) {
        console.error('Error exporting exam results CSV:', error);
        res.status(500).json({ message: 'Gagal mengekspor rekap nilai ujian' });
    }
};

export const duplicateExam = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const sourceExam = await prisma.exam.findUnique({
            where: { id },
            include: { questions: true }
        });

        if (!sourceExam) {
            return res.status(404).json({ success: false, message: 'Paket soal sumber tidak ditemukan' });
        }

        let tokenStr = Math.random().toString(36).substring(2, 8).toUpperCase();
        while (await prisma.exam.findUnique({ where: { token: tokenStr } })) {
            tokenStr = Math.random().toString(36).substring(2, 8).toUpperCase();
        }

        const newExam = await prisma.exam.create({
            data: {
                title: `Salinan - ${sourceExam.title}`,
                subjectId: sourceExam.subjectId,
                durationMinutes: sourceExam.durationMinutes,
                minDurationMinutes: sourceExam.minDurationMinutes,
                token: tokenStr,
                isTokenActive: false,
                assignedClasses: sourceExam.assignedClasses,
                sessionName: sourceExam.sessionName,
                roomName: sourceExam.roomName,
                proctorName: sourceExam.proctorName,
                passingGrade: sourceExam.passingGrade,
                level: sourceExam.level,
                examType: sourceExam.examType,
                executionDate: sourceExam.executionDate,
                startTimeStr: sourceExam.startTimeStr,
                endTimeStr: sourceExam.endTimeStr,
                randomizeQuestions: sourceExam.randomizeQuestions,
                randomizeOptions: sourceExam.randomizeOptions,
                showScoreToStudent: sourceExam.showScoreToStudent,
                maxStrikes: sourceExam.maxStrikes,
                teacherId: sourceExam.teacherId,
                questions: {
                    create: sourceExam.questions.map(q => ({
                        type: q.type,
                        content: q.content,
                        imageUrl: q.imageUrl,
                        audioUrl: q.audioUrl,
                        mediaType: q.mediaType,
                        correctOption: q.correctOption,
                        options: q.options,
                        orderNum: q.orderNum,
                        cognitiveLevel: q.cognitiveLevel,
                        kdTag: q.kdTag,
                        explanation: q.explanation
                    }))
                }
            },
            include: {
                subject: true,
                _count: { select: { questions: true } }
            }
        });

        res.json({
            success: true,
            message: `Paket soal berhasil diduplikasi menjadi "${newExam.title}" (${newExam._count.questions} soal)`,
            exam: newExam
        });
    } catch (error: any) {
        console.error('Error duplicating exam:', error);
        res.status(500).json({ success: false, message: 'Gagal menduplikasi paket soal: ' + error.message });
    }
};


