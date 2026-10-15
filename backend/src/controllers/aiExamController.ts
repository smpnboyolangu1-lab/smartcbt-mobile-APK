import { Request, Response } from 'express';
import prisma from '../utils/db';
import { extractExamWithGemini, extractDocumentText, generateQuestionsWithGemini, analyzeExamItemStatistics, gradeEssayWithAi } from '../services/aiExamService';
import { logAudit } from '../services/auditLogger';
import * as xlsx from 'xlsx';

// 1. STEP 1 (Preview & Anti-Hallucination): Ekstraksi Soal Dokumen via AI Tanpa Langsung Simpan
export const extractExamAiPreview = async (req: Request, res: Response) => {
    try {
        let { rawText, apiKey, titleOverride, subjectOverride, targetClasses } = req.body;
        const user = (req as any).user;
        const uploadedFile = (req as any).file;

        // Jika user mengunggah berkas (Word .docx, Excel .xlsx, PDF .pdf, TXT)
        if (uploadedFile && uploadedFile.buffer) {
            try {
                const docText = await extractDocumentText(uploadedFile.buffer, uploadedFile.mimetype, uploadedFile.originalname);
                if (docText && docText.length > 5) {
                    rawText = docText;
                    if (!titleOverride) {
                        titleOverride = uploadedFile.originalname.replace(/\.[^/.]+$/, '');
                    }
                }
            } catch (err: any) {
                return res.status(400).json({ message: err.message || 'Gagal mengekstrak isi dokumen' });
            }
        }

        if (!rawText || typeof rawText !== 'string' || rawText.trim().length < 10) {
            return res.status(400).json({ message: 'Naskah soal ujian wajib berupa file (Word, Excel, PDF) atau teks minimal 10 karakter' });
        }

        // Ekstraksi AI terstruktur
        const extracted = await extractExamWithGemini(rawText, apiKey);

        const finalTitle = titleOverride || extracted.title || 'Ujian Terintegrasi AI';
        const finalSubject = subjectOverride || extracted.subjectName || 'Umum';
        const finalClasses = targetClasses || extracted.assignedClasses || 'ALL';

        await logAudit(req, 'AI_EXTRACT_PREVIEW', `Subject: ${finalSubject}`, {
            questionsExtracted: extracted.questions?.length || 0,
            title: finalTitle
        });

        // Kembalikan ke Frontend untuk verifikasi manual guru (Human-in-the-Loop)
        res.json({
            message: `Draft ekstraksi AI berhasil dibuat (${extracted.questions?.length || 0} butir soal terdeteksi). Silakan periksa dan koreksi sebelum disimpan ke Bank Soal.`,
            draft: {
                title: finalTitle,
                subjectName: finalSubject,
                durationMinutes: extracted.durationMinutes || 90,
                assignedClasses: finalClasses,
                questions: extracted.questions.map((q, idx) => ({
                    orderNum: idx + 1,
                    type: q.type || 'MULTIPLE_CHOICE',
                    content: q.content,
                    imageUrl: q.imageUrl || '',
                    audioUrl: q.audioUrl || '',
                    correctOption: q.correctOption || 'A',
                    options: q.options || { A: '', B: '', C: '', D: '' },
                    cognitiveLevel: q.cognitiveLevel || 'C3 (Aplikasi)',
                    kdTag: q.kdTag || ''
                }))
            }
        });
    } catch (error: any) {
        console.error('Error extracting exam preview with AI:', error);
        res.status(500).json({ message: 'Gagal mengekstrak soal dengan AI: ' + (error.message || 'Internal Server Error') });
    }
};

// 1.B UNDUH TEMPLATE BANK SOAL CBT (EXCEL STANDAR KEMDIKBUD / ASESMEN NASIONAL)
export const downloadCbtTemplateExcel = async (req: Request, res: Response) => {
    try {
        const wb = xlsx.utils.book_new();

        // Sheet 1: Petunjuk
        const guideData = [
            ['PANDUAN PENYUSUNAN BANK SOAL CBT (EXCEL)'],
            ['SMP NEGERI 1 BOYOLANGU - SMART SCHOOL CBT'],
            [''],
            ['1. Kolom NO diisi nomor urut 1, 2, 3, dst.'],
            ['2. Kolom JENIS_SOAL diisi: PILIHAN_GANDA, ESAI, atau MENJODOHKAN'],
            ['3. Kolom PERTANYAAN diisi teks soal. Jika ada rumus matematika gunakan format LaTeX misal: \\( x^2 + y^2 = r^2 \\)'],
            ['4. Kolom OPSI_A s/d OPSI_D (atau OPSI_E untuk SMA) diisi teks pilihan jawaban tanpa mengulang huruf A/B/C/D di awal teks.'],
            ['5. Kolom KUNCI_JAWABAN diisi huruf kapital: A, B, C, D, atau E.'],
            ['6. Kolom LEVEL_KOGNITIF diisi estimasi level Bloom: C1, C2, C3, C4, C5, atau C6.'],
            ['7. Kolom TAG_KD diisi tag materi / Kompetensi Dasar misal: KD 3.1, TP 1, dll.'],
            ['8. Simpan berkas sebagai file .xlsx lalu unggah ke menu "Import Dokumen Soal (AI)".']
        ];
        const wsGuide = xlsx.utils.aoa_to_sheet(guideData);
        xlsx.utils.book_append_sheet(wb, wsGuide, 'PETUNJUK_PENGISIAN');

        // Sheet 2: Template Soal
        const templateData = [
            ['NO', 'JENIS_SOAL', 'PERTANYAAN', 'OPSI_A', 'OPSI_B', 'OPSI_C', 'OPSI_D', 'OPSI_E', 'KUNCI_JAWABAN', 'LEVEL_KOGNITIF', 'TAG_KD', 'PEMBAHASAN'],
            [1, 'PILIHAN_GANDA', 'Hasil dari 15 x 12 - 50 adalah...', '120', '130', '140', '150', '', 'B', 'C3 (Aplikasi)', 'KD 3.1', '15 x 12 = 180, 180 - 50 = 130.'],
            [2, 'PILIHAN_GANDA', 'Sebuah persegi memiliki keliling 48 cm. Berapakah luas persegi tersebut?', '124 cm²', '144 cm²', '169 cm²', '196 cm²', '', 'B', 'C3 (Aplikasi)', 'KD 3.2', 'Sisi = 48/4 = 12 cm. Luas = 12 x 12 = 144 cm².'],
            [3, 'ESAI', 'Jelaskan tahapan siklus air (hidrologi) secara berurutan mulai dari evaporasi hingga presipitasi!', '', '', '', '', '', '', 'C4 (Analisis)', 'KD 3.5', 'Evaporasi/transpirasi, kondensasi, presipitasi, infiltrasi/limpasan.']
        ];
        const wsTemplate = xlsx.utils.aoa_to_sheet(templateData);
        xlsx.utils.book_append_sheet(wb, wsTemplate, 'TEMPLATE_SOAL');

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="Template_Bank_Soal_CBT.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('Error generating template:', error);
        res.status(500).json({ message: 'Gagal mengunduh template Excel' });
    }
};

// 1.C UNDUH PANDUAN FORMAT NASKAH SOAL WORD (.DOCX / FORMAT TEKS)
export const downloadCbtTemplateWord = async (req: Request, res: Response) => {
    try {
        const docContent = `PANDUAN FORMAT NASKAH SOAL UJIAN (MICROSOFT WORD / TEKS)
SMP NEGERI 1 BOYOLANGU - SMART SCHOOL CBT
========================================================================

Format penyusunan naskah soal di Word dapat berupa teks bertingkat atau tabel.
AI Gemini otomatis mendeteksi nomor urut, pertanyaan, opsi A-D/E, dan kunci jawaban.

CONTOH FORMAT PENULISAN SOAL:

1. Di antara pecahan berikut, manakah yang memiliki nilai paling besar?
A. 3/4
B. 5/8
C. 7/10
D. 2/3
Kunci: A
Level: C3 (Aplikasi)
KD: 3.1
Pembahasan: 3/4 = 0.75, 5/8 = 0.625, 7/10 = 0.7, 2/3 = 0.666. Nilai terbesar adalah 3/4.

2. Sebuah lingkaran memiliki jari-jari 14 cm. Berapakah luas lingkaran tersebut?
Rumus: \\( L = \\pi \\times r^2 \\)
A. 528 cm²
B. 616 cm²
C. 628 cm²
D. 716 cm²
Kunci: B

3. Jelaskan perbedaan antara mean, median, dan modus dalam analisis data statistika!
Kunci: Mean adalah nilai rata-rata hitung, median adalah nilai tengah data setelah diurutkan, dan modus adalah nilai yang paling sering muncul.

========================================================================
TIPS AGAR EKSTRAKSI 100% SUKSES:
1. Nomor soal diawali angka dan titik: "1. ", "2. ", dst.
2. Pilihan jawaban diawali huruf kapital dan titik: "A. ", "B. ", "C. ", "D. "
3. Kunci jawaban ditulis di bawah soal: "Kunci: A" atau di tabel kunci di akhir dokumen.
`;
        res.setHeader('Content-Disposition', 'attachment; filename="Panduan_Format_Soal_Word.txt"');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(docContent);
    } catch (e) {
        res.status(500).json({ message: 'Gagal mengunduh panduan Word' });
    }
};

// 2. STEP 2 (Human-in-the-Loop): Guru Mengonfirmasi & Menyimpan Soal yang Telah Diverifikasi
export const confirmAndSaveExam = async (req: Request, res: Response) => {
    try {
        const { title, subjectName, durationMinutes, assignedClasses, questions } = req.body;
        const user = (req as any).user;

        if (!title || !subjectName || !Array.isArray(questions) || questions.length === 0) {
            return res.status(400).json({ message: 'Data naskah soal hasil verifikasi tidak lengkap' });
        }

        // 1. Temukan atau buat mata pelajaran
        let subject = await prisma.subject.findUnique({ where: { name: subjectName } });
        if (!subject) {
            subject = await prisma.subject.create({ data: { name: subjectName } });
        }

        // 2. Buat Paket Ujian Standar UNBK
        const tokenStr = Math.random().toString(36).substring(2, 8).toUpperCase();
        const exam = await prisma.exam.create({
            data: {
                title: title,
                subjectId: subject.id,
                durationMinutes: Number(durationMinutes) || 90,
                token: tokenStr,
                isTokenActive: false,
                assignedClasses: assignedClasses || 'ALL',
                sessionName: 'Sesi 1 (Pagi)',
                teacherId: user ? user.id : null,
                randomizeQuestions: true,
                randomizeOptions: true,
                showScoreToStudent: false
            }
        });

        // 3. Masukkan butir soal yang sudah dikonfirmasi guru secara manual
        const createdQuestions = [];
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const createdQ = await prisma.question.create({
                data: {
                    examId: exam.id,
                    type: q.type || 'MULTIPLE_CHOICE',
                    content: q.content,
                    imageUrl: q.imageUrl || null,
                    audioUrl: q.audioUrl || null,
                    mediaType: q.imageUrl && q.audioUrl ? 'BOTH' : (q.imageUrl ? 'IMAGE' : (q.audioUrl ? 'AUDIO' : 'NONE')),
                    correctOption: q.correctOption || 'A',
                    options: q.options ? JSON.stringify(q.options) : null,
                    orderNum: i + 1,
                    cognitiveLevel: q.cognitiveLevel || 'C3',
                    kdTag: q.kdTag || null,
                    explanation: q.explanation || null
                }
            });
            createdQuestions.push(createdQ);
        }

        await logAudit(req, 'CONFIRM_AI_EXAM', `ExamId: ${exam.id}`, {
            title,
            subjectName,
            questionsCount: createdQuestions.length
        });

        res.json({
            message: `🎉 Sukses! Paket Ujian "${title}" dengan ${createdQuestions.length} butir soal terverifikasi berhasil disimpan ke Bank Soal.`,
            exam: {
                ...exam,
                subject,
                questionsCount: createdQuestions.length,
                token: tokenStr
            },
            questions: createdQuestions
        });
    } catch (error) {
        console.error('Error confirming exam import:', error);
        res.status(500).json({ message: 'Gagal menyimpan naskah soal terverifikasi' });
    }
};

// 3. Mengambil Profil Kelas & Mapel yang Diampu Guru
export const getMyTeachingClasses = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const teacher = await prisma.user.findUnique({
            where: { id: user.id },
            include: { class: true }
        });

        if (!teacher) {
            return res.status(404).json({ message: 'Guru tidak ditemukan' });
        }

        const allClasses = await prisma.class.findMany({ orderBy: { name: 'asc' } });
        let assignedClassList: string[] = [];
        if (teacher.teachingClasses) {
            assignedClassList = teacher.teachingClasses.split(',').map((c: string) => c.trim()).filter(Boolean);
        } else if (teacher.className) {
            assignedClassList = [teacher.className];
        } else {
            assignedClassList = allClasses.map((c: any) => c.name);
        }

        res.json({
            teacher: {
                id: teacher.id,
                name: teacher.name,
                nip: teacher.username,
                subject: teacher.teachingSubject || 'Semua Mata Pelajaran',
                assignedClasses: assignedClassList
            },
            allClasses
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat profil kelas guru' });
    }
};

// 4. PEMBUATAN SOAL OTOMATIS BERBASIS AI GEMINI (Gemini + RAG + Kuota Guru)
export const generateQuestionsAiHandler = async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
        const user = (req as any).user;
        const userId = user?.id || 'ANONYMOUS_TEACHER';
        const { subject, topic, grade, count, difficulty, type, examId } = req.body;

        if (!subject || !topic) {
            return res.status(400).json({ message: 'Mata pelajaran dan topik materi wajib diisi' });
        }

        // A. Cek Kuota Harian Guru (Maksimal 15 sesi / hari per guru)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const usedToday = await (prisma as any).aiGenerationLog.count({
            where: {
                userId,
                feature: 'QUESTION_GENERATE',
                createdAt: { gte: todayStart }
            }
        });

        const DAILY_LIMIT = 15;
        if (usedToday >= DAILY_LIMIT) {
            return res.status(429).json({
                success: false,
                message: `⚠️ Kuota Harian Terpenuhi: Anda telah mencapai batas kuota pembuatan soal AI hari ini (${usedToday}/${DAILY_LIMIT} kali). Kuota otomatis diperbarui besok pukul 00:00 WIB.`,
                usedToday,
                dailyLimit: DAILY_LIMIT
            });
        }

        // B. RAG Context: Ambil referensi butir soal / materi dari Bank Soal SMPN 1 Boyolangu
        let ragContext = '';
        try {
            const bankSoalRefs = await prisma.bankSoal.findMany({
                where: {
                    OR: [
                        { subjectName: { contains: subject } },
                        { content: { contains: topic } }
                    ]
                },
                take: 3,
                select: { subjectName: true, content: true }
            });
            if (bankSoalRefs.length > 0) {
                ragContext = bankSoalRefs.map(b => b.content || b.subjectName).filter(Boolean).join('\n---\n');
            }
        } catch (_) {}

        // C. Eksekusi Pembuatan Soal via Gemini AI
        const questions = await generateQuestionsWithGemini({
            subject,
            topic,
            grade: grade || 'Kelas VII',
            count: Number(count) || 5,
            difficulty: difficulty || 'Sedang',
            type: type || 'MULTIPLE_CHOICE',
            ragContext
        });

        // Jika examId disertakan, otomatis tambahkan langsung ke butir soal ulangan tersebut
        if (examId) {
            const curCount = await prisma.question.count({ where: { examId: String(examId) } });
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                await prisma.question.create({
                    data: {
                        examId: String(examId),
                        type: q.type || 'MULTIPLE_CHOICE',
                        content: q.content,
                        imageUrl: q.imageUrl || null,
                        audioUrl: q.audioUrl || null,
                        mediaType: q.imageUrl && q.audioUrl ? 'BOTH' : (q.imageUrl ? 'IMAGE' : (q.audioUrl ? 'AUDIO' : 'NONE')),
                        correctOption: q.correctOption || 'A',
                        options: q.options ? (typeof q.options === 'string' ? q.options : JSON.stringify(q.options)) : null,
                        orderNum: curCount + i + 1,
                        cognitiveLevel: q.cognitiveLevel || 'C3',
                        kdTag: q.kdTag || null,
                        explanation: q.explanation || null
                    }
                }).catch(e => console.error('Error inserting generated question:', e));
            }
        }

        // D. Catat Pemakaian Kuota ke ai_generation_logs
        await (prisma as any).aiGenerationLog.create({
            data: {
                userId,
                feature: 'QUESTION_GENERATE',
                modelUsed: 'gemini-2.5-flash',
                durationMs: Date.now() - startTime,
                status: 'SUCCESS'
            }
        });

        await logAudit(req, 'AI_GENERATE_QUESTIONS', `Subject: ${subject}, Topic: ${topic}`, {
            count: questions.length,
            durationMs: Date.now() - startTime
        });

        res.json({
            success: true,
            message: `✨ Berhasil men-generate ${questions.length} butir soal berkualitas tinggi dengan AI Gemini (RAG terintegrasi).`,
            quota: {
                usedToday: usedToday + 1,
                dailyLimit: DAILY_LIMIT,
                remaining: Math.max(0, DAILY_LIMIT - (usedToday + 1))
            },
            questions
        });
    } catch (error: any) {
        console.error('Error generating questions with AI:', error);
        res.status(500).json({ message: 'Gagal membuat soal dengan AI', error: error.message });
    }
};

/**
 * Cek Sisa Kuota Pembuatan Soal AI untuk Guru
 * GET /api/soal/ai-quota
 */
export const getTeacherAiQuota = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const userId = user?.id || 'ANONYMOUS_TEACHER';
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const usedToday = await (prisma as any).aiGenerationLog.count({
            where: {
                userId,
                feature: 'QUESTION_GENERATE',
                createdAt: { gte: todayStart }
            }
        });

        const dailyLimit = 15;
        res.json({
            success: true,
            usedToday,
            dailyLimit,
            remainingQuota: Math.max(0, dailyLimit - usedToday),
            resetTime: '00:00 WIB'
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

// 5. ANALISIS BUTIR SOAL (ITEM ANALYSIS: Kesukaran, Pembeda, Pengecoh)
export const getItemAnalysisHandler = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ message: 'ID Ujian diperlukan' });
        }

        const examId = String(id);
        const analysis = await analyzeExamItemStatistics(examId);
        res.json(analysis);
    } catch (error: any) {
        console.error('Error in item analysis:', error);
        res.status(500).json({ message: error.message || 'Gagal menghitung analisis butir soal' });
    }
};

// 6. KOREKSI JAWABAN ESAI BERBASIS AI GEMINI
export const gradeEssayAiHandler = async (req: Request, res: Response) => {
    try {
        const { questionText, rubric, studentAnswer, maxScore } = req.body;
        if (!studentAnswer) {
            return res.status(400).json({ message: 'Jawaban siswa wajib diisi' });
        }

        const result = await gradeEssayWithAi({
            questionText: questionText || 'Uraian Esai',
            rubric: rubric || '',
            studentAnswer,
            maxScore: Number(maxScore) || 100
        });

        res.json(result);
    } catch (error: any) {
        console.error('Error in grading essay with AI:', error);
        res.status(500).json({ message: 'Gagal mengoreksi esai dengan AI' });
    }
};

// 7. EKSPOR BANK SOAL UJIAN KE FILE EXCEL (.xlsx)
export const exportExamToExcel = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const exam = await prisma.exam.findUnique({
            where: { id: String(id) },
            include: {
                subject: true,
                questions: {
                    orderBy: { orderNum: 'asc' }
                }
            }
        });

        if (!exam) {
            return res.status(404).json({ message: 'Ujian tidak ditemukan' });
        }

        const wb = xlsx.utils.book_new();

        // Sheet 1: Metadata
        const metaData = [
            ['DATA INFORMASI UJIAN (CBT)'],
            ['Judul Ujian', exam.title],
            ['Mata Pelajaran', exam.subject?.name || '-'],
            ['Durasi', `${exam.durationMinutes} Menit`],
            ['Token Ujian', exam.token],
            ['Target Kelas', exam.assignedClasses || 'ALL'],
            ['Total Soal', exam.questions.length],
            ['Tanggal Ekspor', new Date().toLocaleString('id-ID')]
        ];
        const wsMeta = xlsx.utils.aoa_to_sheet(metaData);
        xlsx.utils.book_append_sheet(wb, wsMeta, 'INFO_UJIAN');

        // Sheet 2: Butir Soal
        const headers = ['NO', 'JENIS_SOAL', 'PERTANYAAN', 'OPSI_A', 'OPSI_B', 'OPSI_C', 'OPSI_D', 'KUNCI_JAWABAN', 'LEVEL_KOGNITIF', 'TAG_KD'];
        const rows: any[] = [headers];

        exam.questions.forEach((q, idx) => {
            let optA = '', optB = '', optC = '', optD = '';
            if (q.options) {
                try {
                    const parsed = JSON.parse(q.options);
                    if (Array.isArray(parsed)) {
                        optA = parsed[0] || '';
                        optB = parsed[1] || '';
                        optC = parsed[2] || '';
                        optD = parsed[3] || '';
                    } else if (typeof parsed === 'object') {
                        optA = parsed.A || '';
                        optB = parsed.B || '';
                        optC = parsed.C || '';
                        optD = parsed.D || '';
                    }
                } catch (e) {}
            }

            const qType = q.type === 'ESSAY' ? 'ESAI' : 'PILIHAN_GANDA';
            rows.push([
                idx + 1,
                qType,
                q.content,
                optA,
                optB,
                optC,
                optD,
                q.correctOption || '',
                q.cognitiveLevel || 'C3 (Aplikasi)',
                q.kdTag || ''
            ]);
        });

        const wsQuestions = xlsx.utils.aoa_to_sheet(rows);
        xlsx.utils.book_append_sheet(wb, wsQuestions, 'BANK_SOAL');

        const safeTitle = exam.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', `attachment; filename="Bank_Soal_${safeTitle}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error: any) {
        console.error('Error exporting exam to Excel:', error);
        res.status(500).json({ message: 'Gagal mengekspor bank soal ke Excel: ' + error.message });
    }
};

// 8. IMPOR LANGSUNG BANK SOAL DARI EXCEL (.xlsx) KE UJIAN
export const importExamDirectFromExcel = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const uploadedFile = (req as any).file;

        if (!uploadedFile || !uploadedFile.buffer) {
            return res.status(400).json({ message: 'Berkas Excel (.xlsx / .xls) wajib diunggah' });
        }

        const exam = await prisma.exam.findUnique({
            where: { id: String(id) }
        });

        if (!exam) {
            return res.status(404).json({ message: 'Ujian tidak ditemukan' });
        }

        const wb = xlsx.read(uploadedFile.buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames.find(s => s.toUpperCase().includes('SOAL')) || wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];

        if (!sheet) {
            return res.status(400).json({ message: 'Lembar soal tidak ditemukan di dalam berkas Excel' });
        }

        const rawRows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        if (rawRows.length < 2) {
            return res.status(400).json({ message: 'Berkas Excel kosong atau tidak memiliki baris soal' });
        }

        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(5, rawRows.length); i++) {
            const rowStr = (rawRows[i] || []).join(' ').toUpperCase();
            if (rowStr.includes('PERTANYAAN') || rowStr.includes('SOAL')) {
                headerRowIndex = i;
                break;
            }
        }

        const headers = rawRows[headerRowIndex].map((h: any) => String(h || '').trim().toUpperCase());
        const qIdx = headers.findIndex((h: string) => h.includes('PERTANYAAN') || h.includes('SOAL'));
        const typeIdx = headers.findIndex((h: string) => h.includes('JENIS') || h.includes('TIPE'));
        const aIdx = headers.findIndex((h: string) => h.includes('OPSI_A') || h === 'A');
        const bIdx = headers.findIndex((h: string) => h.includes('OPSI_B') || h === 'B');
        const cIdx = headers.findIndex((h: string) => h.includes('OPSI_C') || h === 'C');
        const dIdx = headers.findIndex((h: string) => h.includes('OPSI_D') || h === 'D');
        const keyIdx = headers.findIndex((h: string) => h.includes('KUNCI'));
        const levelIdx = headers.findIndex((h: string) => h.includes('LEVEL') || h.includes('KOGNITIF'));
        const kdIdx = headers.findIndex((h: string) => h.includes('KD') || h.includes('TAG'));

        if (qIdx === -1) {
            return res.status(400).json({ message: 'Kolom PERTANYAAN tidak ditemukan di berkas Excel' });
        }

        const existingCount = await prisma.question.count({ where: { examId: exam.id } });
        let order = existingCount + 1;
        let createdCount = 0;

        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
            const row = rawRows[i];
            if (!row || !row[qIdx] || String(row[qIdx]).trim().length < 2) continue;

            const content = String(row[qIdx]).trim();
            const rawType = typeIdx !== -1 && row[typeIdx] ? String(row[typeIdx]).toUpperCase() : 'PILIHAN_GANDA';
            const isEssay = rawType.includes('ESAI') || rawType.includes('ESSAY') || rawType.includes('URAIAN');

            let optionsStr: string | null = null;
            let correctOption: string | null = null;

            if (!isEssay) {
                const optA = aIdx !== -1 && row[aIdx] != null ? String(row[aIdx]).trim() : '';
                const optB = bIdx !== -1 && row[bIdx] != null ? String(row[bIdx]).trim() : '';
                const optC = cIdx !== -1 && row[cIdx] != null ? String(row[cIdx]).trim() : '';
                const optD = dIdx !== -1 && row[dIdx] != null ? String(row[dIdx]).trim() : '';

                optionsStr = JSON.stringify({ A: optA, B: optB, C: optC, D: optD });
                correctOption = keyIdx !== -1 && row[keyIdx] ? String(row[keyIdx]).trim().toUpperCase() : 'A';
            } else {
                correctOption = keyIdx !== -1 && row[keyIdx] ? String(row[keyIdx]).trim() : null;
            }

            const cognitiveLevel = levelIdx !== -1 && row[levelIdx] ? String(row[levelIdx]).trim() : 'C3 (Aplikasi)';
            const kdTag = kdIdx !== -1 && row[kdIdx] ? String(row[kdIdx]).trim() : 'KD 3.1';

            await prisma.question.create({
                data: {
                    examId: exam.id,
                    type: isEssay ? 'ESSAY' : 'MULTIPLE_CHOICE',
                    content,
                    options: optionsStr,
                    correctOption,
                    orderNum: order++,
                    cognitiveLevel,
                    kdTag
                }
            });
            createdCount++;
        }

        res.json({
            success: true,
            message: `Berhasil mengimpor ${createdCount} butir soal dari berkas Excel ke ujian "${exam.title}"!`,
            importedCount: createdCount
        });
    } catch (error: any) {
        console.error('Error importing exam from Excel:', error);
        res.status(500).json({ message: 'Gagal mengimpor dari Excel: ' + error.message });
    }
};

// 9. PENILAIAN MANUAL ESSAY OLEH GURU
export const gradeStudentEssayManual = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { essayScores, teacherFeedback } = req.body;

        const studentExam = await prisma.studentExam.findUnique({
            where: { id: String(id) },
            include: {
                exam: {
                    include: { questions: true }
                },
                user: true
            }
        });

        if (!studentExam) {
            return res.status(404).json({ message: 'Data pengerjaan ujian siswa tidak ditemukan' });
        }

        let studentAnswers: Record<string, any> = {};
        if (studentExam.answers) {
            try {
                studentAnswers = JSON.parse(studentExam.answers);
            } catch (e) {}
        }

        let totalEssayScore = 0;
        let totalPgScore = 0;
        const questions = studentExam.exam.questions;
        const pgQuestions = questions.filter(q => q.type !== 'ESSAY');
        const essayQuestions = questions.filter(q => q.type === 'ESSAY');

        pgQuestions.forEach(q => {
            const ans = studentAnswers[q.id];
            if (ans && ans.toUpperCase() === (q.correctOption || '').toUpperCase()) {
                totalPgScore += 1;
            }
        });

        if (essayScores && typeof essayScores === 'object') {
            for (const qId of Object.keys(essayScores)) {
                const score = Number(essayScores[qId]) || 0;
                totalEssayScore += score;
                studentAnswers[`_score_${qId}`] = score;
            }
        }

        if (teacherFeedback) {
            studentAnswers['_teacher_feedback'] = String(teacherFeedback);
        }

        let finalScore = 0;
        if (questions.length > 0) {
            const pgWeight = pgQuestions.length > 0 ? (totalPgScore / pgQuestions.length) * 70 : 0;
            const essayWeight = essayQuestions.length > 0 ? (totalEssayScore / (essayQuestions.length * 100)) * 30 : 30;
            finalScore = parseFloat((pgWeight + essayWeight).toFixed(2));
        }

        const updated = await prisma.studentExam.update({
            where: { id: studentExam.id },
            data: {
                score: finalScore,
                answers: JSON.stringify(studentAnswers)
            }
        });

        res.json({
            success: true,
            message: `Nilai esai untuk ${studentExam.user.name} berhasil disimpan! Skor akhir: ${finalScore}`,
            studentExam: updated
        });
    } catch (error: any) {
        console.error('Error grading essay manually:', error);
        res.status(500).json({ message: 'Gagal menyimpan penilaian esai: ' + error.message });
    }
};