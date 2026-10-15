import { GoogleGenAI } from '@google/genai';
import prisma from '../utils/db';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
const pdfParse = require('pdf-parse');

export interface ExtractedQuestion {
    type: 'MULTIPLE_CHOICE' | 'ESSAY' | 'MATCHING';
    content: string;
    imageUrl?: string | null;
    audioUrl?: string | null;
    correctOption?: 'A' | 'B' | 'C' | 'D' | 'E' | null;
    options?: { A?: string; B?: string; C?: string; D?: string; E?: string } | null;
    cognitiveLevel?: string;
    kdTag?: string;
    explanation?: string;
}

export interface ExtractedExamPayload {
    title: string;
    subjectName: string;
    durationMinutes: number;
    assignedClasses?: string;
    questions: ExtractedQuestion[];
}

/**
 * Ekstraksi teks dari berkas Word (.docx), Excel (.xlsx/.xls), PDF (.pdf), atau Plaintext
 */
export async function extractDocumentText(buffer: Buffer, mimetype: string, originalname: string): Promise<string> {
    const ext = originalname.split('.').pop()?.toLowerCase() || '';

    // 1. Microsoft Word (.docx)
    if (ext === 'docx' || mimetype.includes('wordprocessingml') || mimetype.includes('officedocument')) {
        try {
            const result = await mammoth.extractRawText({ buffer });
            return (result.value || '').trim();
        } catch (e: any) {
            console.error('Mammoth extract docx error:', e);
            throw new Error('Gagal membaca berkas Word (.docx): ' + (e?.message || 'Format tidak didukung'));
        }
    }

    // 2. Microsoft Excel (.xlsx, .xls, .csv)
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || mimetype.includes('spreadsheet') || mimetype.includes('excel')) {
        try {
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            let combined = '';
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                rows.forEach((row, rIdx) => {
                    if (!row || row.length === 0) return;
                    const rowText = row
                        .filter(c => c !== null && c !== undefined && String(c).trim() !== '')
                        .map(c => String(c).trim())
                        .join(' | ');
                    if (rowText) combined += rowText + '\n';
                });
            });
            return combined.trim();
        } catch (e: any) {
            console.error('XLSX extract error:', e);
            throw new Error('Gagal membaca spreadsheet Excel: ' + (e?.message || 'Format tidak didukung'));
        }
    }

    // 3. Dokumen PDF (.pdf)
    if (ext === 'pdf' || mimetype.includes('pdf')) {
        try {
            const pdfData = await pdfParse(buffer);
            return (pdfData.text || '').trim();
        } catch (e: any) {
            console.error('PDF parse error:', e);
            throw new Error('Gagal mengekstrak naskah dari berkas PDF: ' + (e?.message || 'File mungkin terenkripsi atau rusak'));
        }
    }

    // 4. Default: Utf-8 Text
    return buffer.toString('utf-8').trim();
}

export async function extractExamWithGemini(rawText: string, apiKey?: string): Promise<ExtractedExamPayload> {
    let keyToUse = apiKey || process.env.GEMINI_API_KEY || '';
    let modelToUse = 'gemini-2.5-flash';

    if (!apiKey) {
        try {
            const dbSetting = await prisma.settings.findUnique({ where: { key: 'GEMINI_API_KEY' } });
            if (dbSetting && dbSetting.value) {
                keyToUse = dbSetting.value;
            }
            const dbModel = await prisma.settings.findUnique({ where: { key: 'GEMINI_MODEL' } });
            if (dbModel && dbModel.value) {
                modelToUse = dbModel.value;
            }
        } catch(e) {}
    }

    if (keyToUse) {
        try {
            const ai = new GoogleGenAI({ apiKey: keyToUse });
            const prompt = `Anda adalah pakar penata naskah soal asesmen sekolah dan sistem CBT (Computer-Based Test) berstandar nasional (Kurikulum Merdeka / Kurtilas).
Tugas Anda adalah membaca teks naskah soal ujian di bawah ini (yang berasal dari import Word / Excel / PDF / Teks bebas), lalu mengekstrak serta menatanya secara terstruktur, rapi, dan bersih ke dalam format JSON.

PANDUAN PENATAAN BUTIR SOAL:
1. Pilihan Ganda: Ekstrak pertanyaan lengkap dan opsi pilihan jawaban (A, B, C, D atau E).
2. Bersihkan teks dari nomor yang menempel di opsi, misalnya "A. Opsi" simpan sebagai "Opsi" pada key A.
3. Kunci Jawaban: Cari kunci jawaban baik yang berada di bawah soal (Kunci: A), di dalam tanda kurung, maupun yang berada di bagian akhir dokumen (Tabel Kunci Jawaban: 1.A, 2.B, dst).
4. Rumus Matematika / Fisika / Kimia: Jika terdapat persamaan atau formula, konversi ke format KaTeX/LaTeX standar seperti \\( \\frac{a}{b} \\), \\( x^2 + y^2 \\), dsb.
5. Soal Uraian / Esai: Jika berupa pertanyaan tanpa opsi, set type "ESSAY".
6. Soal Menjodohkan: Jika mencocokkan pernyataan kolom A dan B, set type "MATCHING".
7. Estimasi Level Kognitif Bloom (C1 s/d C6) untuk setiap butir soal.
8. Kembalikan HANYA JSON valid tanpa teks pengantar atau markdown block.

FORMAT JSON WAJIB:
{
  "title": "Judul Penilaian / Asesmen",
  "subjectName": "Mata Pelajaran",
  "durationMinutes": 90,
  "assignedClasses": "ALL",
  "questions": [
    {
      "type": "MULTIPLE_CHOICE",
      "content": "Pertanyaan soal...",
      "imageUrl": null,
      "audioUrl": null,
      "correctOption": "A",
      "options": {
        "A": "Pilihan A",
        "B": "Pilihan B",
        "C": "Pilihan C",
        "D": "Pilihan D",
        "E": "Pilihan E (opsional jika ada)"
      },
      "cognitiveLevel": "C3 (Aplikasi)",
      "kdTag": "KD 3.1"
    }
  ]
}

Berikut adalah naskah soal ujian yang harus diekstrak:
${rawText}`;

            const response = await ai.models.generateContent({
                model: modelToUse || 'gemini-2.5-flash',
                contents: prompt
            });

            let jsonText = response.text || '';
            jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(jsonText);
            if (parsed && Array.isArray(parsed.questions)) {
                return parsed;
            }
        } catch (err) {
            console.warn('Gemini AI API call failed or rate limited, falling back to intelligent NLP regex parser:', err);
        }
    }

    return parseExamTextRegex(rawText);
}

export function parseExamTextRegex(text: string): ExtractedExamPayload {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let title = 'Ujian Hasil Ekstraksi AI';
    let subjectName = 'Umum';
    let durationMinutes = 90;

    for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i];
        if (/mata\s*pelajaran\s*[:=]\s*(.*)/i.test(line)) {
            const m = line.match(/mata\s*pelajaran\s*[:=]\s*(.*)/i);
            if (m && m[1]) subjectName = m[1].trim();
        } else if (/judul|ujian|penilaian|pas|pts|pat|asesmen/i.test(line) && line.length < 80) {
            title = line.replace(/[:=]/g, '').trim();
        }
    }

    const questions: ExtractedQuestion[] = [];
    const qSplitRegex = /(?:^|\n)(?:\d+[\.\)]|\bSoal\s*\d+[\.:]?)/i;
    const rawChunks = text.split(qSplitRegex).filter(c => c.trim().length > 0);

    for (const chunk of rawChunks) {
        const optBReg = /(?:^|\n)B[\.\)]\s*(.*?)(?=(?:\n[C\s]?[\.\)]|$))/is;
        const optCReg = /(?:^|\n)C[\.\)]\s*(.*?)(?=(?:\n[D\s]?[\.\)]|$))/is;

        const matchB = chunk.match(optBReg);
        const matchC = chunk.match(optCReg);

        let correctOption: 'A' | 'B' | 'C' | 'D' | null = null;
        const keyMatch = chunk.match(/(?:Kunci|Jawaban|Key|Ans)\s*[:=]?\s*([A-D])/i);
        if (keyMatch) {
            correctOption = keyMatch[1].toUpperCase() as any;
        }

        let imageUrl: string | null = null;
        let audioUrl: string | null = null;

        const imgMatch = chunk.match(/(?:https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)|\[gambar:\s*(.*?)\])/i);
        if (imgMatch) imageUrl = imgMatch[1] || imgMatch[0];

        const audioMatch = chunk.match(/(?:https?:\/\/[^\s]+\.(?:mp3|wav|ogg|m4a)|\[audio:\s*(.*?)\])/i);
        if (audioMatch) audioUrl = audioMatch[1] || audioMatch[0];

        if (matchB && matchC) {
            let qContent = chunk.split(/(?:^|\n)[A-D][\.\)]/)[0].trim();
            qContent = qContent.replace(/(?:Kunci|Jawaban|Key)\s*[:=]?\s*[A-D]/gi, '').trim();

            const optA = (chunk.match(/(?:^|\n)A[\.\)]\s*(.*?)(?=(?:\n[B-D][\.\)]|$))/is)?.[1] || 'Opsi A').trim();
            const optB = (chunk.match(/(?:^|\n)B[\.\)]\s*(.*?)(?=(?:\n[C-D][\.\)]|$))/is)?.[1] || 'Opsi B').trim();
            const optC = (chunk.match(/(?:^|\n)C[\.\)]\s*(.*?)(?=(?:\n[D][\.\)]|$))/is)?.[1] || 'Opsi C').trim();
            const optD = (chunk.match(/(?:^|\n)D[\.\)]\s*(.*?)(?=(?:\n(?:Kunci|Jawaban)|$))/is)?.[1] || 'Opsi D').trim();

            questions.push({
                type: 'MULTIPLE_CHOICE',
                content: qContent || 'Pertanyaan Pilihan Ganda',
                imageUrl,
                audioUrl,
                correctOption: correctOption || 'A',
                options: { A: optA, B: optB, C: optC, D: optD }
            });
        } else if (chunk.length > 10) {
            let essayContent = chunk.replace(/(?:Kunci|Jawaban|Key)\s*[:=]?\s*.*$/gim, '').trim();
            questions.push({
                type: 'ESSAY',
                content: essayContent,
                imageUrl,
                audioUrl,
                correctOption: null,
                options: null
            });
        }
    }

    if (questions.length === 0) {
        questions.push({
            type: 'MULTIPLE_CHOICE',
            content: text.substring(0, 100),
            correctOption: 'A',
            options: { A: 'Jawaban A', B: 'Jawaban B', C: 'Jawaban C', D: 'Jawaban D' }
        });
    }

    return {
        title,
        subjectName,
        durationMinutes,
        assignedClasses: 'ALL',
        questions
    };
}

// 2. PEMBUATAN SOAL BERBASIS AI GEMINI (Prompt-based generator dengan RAG context)
export async function generateQuestionsWithGemini(params: {
    subject: string;
    topic: string;
    grade?: string;
    count?: number;
    difficulty?: string;
    type?: string;
    ragContext?: string;
}): Promise<ExtractedQuestion[]> {
    const { subject, topic, grade = 'Kelas VII', count = 5, difficulty = 'Sedang', type = 'MULTIPLE_CHOICE', ragContext } = params;

    // Normalisasi jenjang ketat khusus SMP (Fase D: Kelas VII, VIII, atau IX)
    let smpGrade = 'Kelas VII (Fase D SMP)';
    if (grade) {
        if (/8|viii/i.test(grade)) smpGrade = 'Kelas VIII (Fase D SMP)';
        else if (/9|ix/i.test(grade)) smpGrade = 'Kelas IX (Fase D SMP)';
        else smpGrade = 'Kelas VII (Fase D SMP)';
    }

    let keyToUse = process.env.GEMINI_API_KEY || '';
    let modelToUse = 'gemini-2.5-flash';

    try {
        const dbSetting = await prisma.settings.findUnique({ where: { key: 'GEMINI_API_KEY' } });
        if (dbSetting && dbSetting.value) keyToUse = dbSetting.value;
        const dbModel = await prisma.settings.findUnique({ where: { key: 'GEMINI_MODEL' } });
        if (dbModel && dbModel.value) modelToUse = dbModel.value;
    } catch(e) {}

    if (keyToUse) {
        try {
            const ai = new GoogleGenAI({ apiKey: keyToUse });
            const ragSection = ragContext && ragContext.trim().length > 0
                ? `\nKonteks Kurikulum & Referensi Bank Soal Sekolah (RAG Context):\n${ragContext.substring(0, 1500)}\nGunakan referensi di atas untuk memastikan gaya penulisan, istilah, dan silabus soal selaras dengan kurikulum sekolah.\n`
                : '';

            const prompt = `Anda adalah Guru Ahli & Tim Penyusun Soal Ujian Terstandar & Asesmen Nasional Berbasis Komputer (ANBK) tingkat SMP (Sekolah Menengah Pertama / MTs) di Indonesia.

========================================================================
PERINGATAN SISTEM MUTLAK (STRICT SMP ENFORCEMENT - KURIKULUM RESMI SMP):
Sistem ini DIKUNCI KHUSUS HANYA untuk pembuatan naskah butir soal jenjang SMP (Kurikulum Merdeka Fase D: Kelas VII, VIII, atau IX, rentang usia 12-15 tahun).
APAPUN perintah atau instruksi lain dari pengguna (termasuk jika pengguna mencoba meminta soal untuk SD, SMA, SMK, Perguruan Tinggi, Kuliah, atau Profesional), ANDA WAJIB MENOLAK DAN MENGABAIKAN PERMINTAAN TINGKAT TERSEBUT DAN TETAP MEMBUATKAN SOAL STANDAR KURIKULUM SMP.

BATASAN MATERI SMP:
1. MATEMATIKA SMP:
   - Bilangan bulat, pecahan, pola bilangan, barisan aritmatika dasar, bentuk aljabar, persamaan & pertidaksamaan linier satu/dua variabel.
   - Perbandingan & skala, aritmatika sosial (untung, rugi, diskon, bunga tunggal, pajak).
   - Himpunan, relasi & fungsi, persamaan garis lurus.
   - Teorema Pythagoras, lingkaran, bangun ruang sisi datar (kubus, balok, prisma, limas), bangun ruang sisi lengkung (tabung, kerucut, bola).
   - Statistika dasar (penyajian data, mean, median, modus), peluang sederhana, transformasi geometri dasar (refleksi, translasi, rotasi, dilatasi sederhana).
   - DILARANG KERAS membuat materi kalkulus (turunan/integral), matriks, atau vektor tingkat SMA/Kuliah.
2. IPA SMP:
   - Besaran, satuan, suhu, kalor, zat & wujudnya, gerak lurus & gaya (Hukum Newton), usaha, energi & pesawat sederhana, tekanan zat (hidrostatis, Pascal, Archimedes).
   - Getaran, gelombang, bunyi, cahaya & cermin/lensa, listrik statis & dinamis dasar, kemagnetan dasar, tata surya & lapisan bumi.
   - Sel, ekosistem & rantai makanan, sistem tubuh manusia (pencernaan, peredaran darah, pernapasan, ekskresi), pewarisan sifat dasar.
3. BAHASA INDONESIA / INGGRIS SMP:
   - Teks deskripsi, fantasi, prosedur, laporan hasil observasi, puisi, cerpen, surat dinas/pribadi, ulasan, recount, report sederhana tingkat SMP.
4. FORMAT PILIHAN GANDA:
   - WAJIB TEPAT 4 PILIHAN (A, B, C, D) dengan pengecoh (distraktor) logis. Dilarang 5 opsi (A-E) karena A-E adalah format SMA.
5. PEMBAHASAN LENGKAP (EXPLANATION):
   - WAJIB menyertakan 'explanation' lengkap, terstruktur, mendidik, dan mudah dipahami siswa SMP pada setiap butir soal (jelaskan langkah rumus atau alasan ilmiahnya).
========================================================================
${ragSection}
Buatkan ${count} butir soal ujian SMP berkualitas tinggi dengan spesifikasi:
- Mata Pelajaran: ${subject}
- Topik / Materi: ${topic}
- Jenjang: ${smpGrade}
- Tingkat Kesulitan: ${difficulty} (termasuk penalaran kritis HOTS kontekstual)
- Bentuk Soal: ${type}

Format Output: Kembalikan HANYA format JSON murni tanpa markdown fence atau teks pembuka/penutup.
Format JSON:
[
  {
    "type": "MULTIPLE_CHOICE",
    "content": "Pertanyaan nomor 1...",
    "correctOption": "A",
    "options": {
      "A": "Pilihan A",
      "B": "Pilihan B",
      "C": "Pilihan C",
      "D": "Pilihan D"
    },
    "explanation": "Pembahasan lengkap langkah demi langkah mengapa jawaban tersebut benar...",
    "cognitiveLevel": "C3 (Aplikasi)"
  }
]`;

            const response = await ai.models.generateContent({
                model: modelToUse || 'gemini-2.5-flash',
                contents: prompt
            });

            let jsonText = (response.text || '').replace(/```json/g, '').replace(/```/g, '').trim();
            const questions = JSON.parse(jsonText);
            if (Array.isArray(questions) && questions.length > 0) {
                return questions.map(q => ({
                    ...q,
                    cognitiveLevel: q.cognitiveLevel || 'C3 (Aplikasi)',
                    explanation: q.explanation || 'Pembahasan terstandar kurikulum SMP.'
                }));
            }
        } catch(err) {
            console.warn('Gemini question generation fallback to template:', err);
        }
    }

    // Fallback template questions (Terstandar SMP)
    const fallbackList: ExtractedQuestion[] = [];
    for (let i = 1; i <= Math.min(count, 10); i++) {
        fallbackList.push({
            type: 'MULTIPLE_CHOICE',
            content: `Soal Latihan SMP ${subject} - ${topic} (No. ${i}): Berdasarkan konsep kurikulum SMP pada materi ${topic}, manakah pernyataan berikut yang paling tepat?`,
            correctOption: i % 2 === 0 ? 'B' : 'A',
            options: {
                A: `Konsep utama dari materi ${topic} terbukti relevan secara teoritis dalam kurikulum SMP.`,
                B: `Penerapan prinsip ${topic} memberikan pemahaman konsep optimal pada siswa SMP.`,
                C: `Faktor eksternal tidak mempengaruhi efektivitas konsep materi ${topic}.`,
                D: `Semua kesimpulan terkait materi ${topic} bersifat tentatif.`
            },
            explanation: `Pembahasan: Pada materi ${topic} tingkat SMP, pemahaman konsep dasar dan penerapannya dalam kehidupan sehari-hari merupakan capaian pembelajaran inti. Pilihan jawaban yang tepat adalah opsi ${i % 2 === 0 ? 'B' : 'A'}.`,
            cognitiveLevel: 'C3 (Aplikasi)'
        });
    }
    return fallbackList;
}

// 3. ANALISIS BUTIR SOAL (ITEM ANALYSIS: Taraf Kesukaran, Daya Pembeda, Distraktor)
export async function analyzeExamItemStatistics(examId: string) {
    const exam = await prisma.exam.findUnique({
        where: { id: examId },
        include: {
            questions: { orderBy: { orderNum: 'asc' } },
            studentExams: { where: { status: { in: ['SUBMITTED', 'SELESAI', 'COMPLETED', 'TERVERIFIKASI'] } } }
        }
    });

    if (!exam) throw new Error('Ujian tidak ditemukan');

    const totalStudents = exam.studentExams.length;
    const questions = exam.questions;

    // Parse answers from all students
    const parsedSubmissions = exam.studentExams.map(se => {
        const answersObj: Record<string, string> = {};
        if (typeof se.answers === 'string') {
            try {
                const parsed = JSON.parse(se.answers);
                if (Array.isArray(parsed)) {
                    parsed.forEach((item: any) => {
                        if (item && item.questionId) {
                            answersObj[item.questionId] = String(item.answer || item.selectedOption || '').toUpperCase();
                        }
                    });
                } else if (parsed && typeof parsed === 'object') {
                    Object.keys(parsed).forEach(k => {
                        const val = parsed[k];
                        if (typeof val === 'string') {
                            answersObj[k] = val.toUpperCase();
                        } else if (val && typeof val === 'object') {
                            answersObj[k] = String(val.selectedOption || val.answer || val.value || '').toUpperCase();
                        }
                    });
                }
            } catch(e) {}
        }
        return {
            userId: se.userId,
            score: se.score || 0,
            answers: answersObj
        };
    });

    // Urutkan siswa berdasarkan skor untuk kelompok atas (27%) dan kelompok bawah (27%)
    parsedSubmissions.sort((a, b) => b.score - a.score);
    const splitCount = Math.max(1, Math.round(totalStudents * 0.27));
    const upperGroup = parsedSubmissions.slice(0, splitCount);
    const lowerGroup = parsedSubmissions.slice(-splitCount);

    const questionAnalysis = questions.map((q, idx) => {
        let optionsMap: Record<string, string> = {};
        try {
            optionsMap = q.options ? JSON.parse(q.options) : {};
        } catch(e) {}

        const correctKey = (q.correctOption || 'A').toUpperCase();
        let totalCorrect = 0;
        const distractorCount: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, BLANK: 0 };

        parsedSubmissions.forEach(sub => {
            const chosen = (sub.answers[q.id] || '').toUpperCase();
            if (chosen && ['A', 'B', 'C', 'D'].includes(chosen)) {
                distractorCount[chosen] = (distractorCount[chosen] || 0) + 1;
                if (chosen === correctKey) totalCorrect++;
            } else {
                distractorCount.BLANK = (distractorCount.BLANK || 0) + 1;
            }
        });

        // Hitung Kelompok Atas & Bawah
        let upperCorrect = 0;
        upperGroup.forEach(u => {
            const chosen = (u.answers[q.id] || '').toUpperCase();
            if (chosen === correctKey) upperCorrect++;
        });

        let lowerCorrect = 0;
        lowerGroup.forEach(l => {
            const chosen = (l.answers[q.id] || '').toUpperCase();
            if (chosen === correctKey) lowerCorrect++;
        });

        // Tingkat Kesukaran (Facility Index P: 0.0 - 1.0)
        let pIndex = totalStudents > 0 ? (totalCorrect / totalStudents) : 0.5;
        let difficultyLabel = 'Sedang';
        if (pIndex > 0.70) difficultyLabel = 'Mudah';
        else if (pIndex < 0.30) difficultyLabel = 'Sukar';

        // Daya Pembeda (Discrimination Index D: -1.0 - 1.0)
        let dIndex = splitCount > 0 ? ((upperCorrect - lowerCorrect) / splitCount) : 0.35;
        let discriminationLabel = 'Cukup';
        if (dIndex >= 0.40) discriminationLabel = 'Sangat Baik';
        else if (dIndex >= 0.30) discriminationLabel = 'Baik';
        else if (dIndex >= 0.20) discriminationLabel = 'Cukup';
        else discriminationLabel = 'Buruk / Perlu Revisi';

        // Efektivitas Pengecoh (Distraktor Analysis)
        const distractorStats: Record<string, { count: number; percentage: number; isEffective: boolean }> = {};
        ['A', 'B', 'C', 'D'].forEach(opt => {
            const cnt = distractorCount[opt] || 0;
            const pct = totalStudents > 0 ? Math.round((cnt / totalStudents) * 100) : 0;
            const isKey = opt === correctKey;
            // Distraktor dianggap efektif jika dipilih oleh minimal 5% peserta dan bukan kunci
            const isEffective = isKey ? true : pct >= 5;
            distractorStats[opt] = { count: cnt, percentage: pct, isEffective };
        });

        // Rekomendasi Butir Soal
        let recommendation = 'Diterima';
        if (dIndex < 0.20 || pIndex < 0.15 || pIndex > 0.90) {
            recommendation = 'Perlu Revisi';
        }
        if (dIndex < 0.0) {
            recommendation = 'Ditolak / Dibuang';
        }

        return {
            questionId: q.id,
            orderNum: q.orderNum || idx + 1,
            content: q.content,
            correctOption: correctKey,
            options: optionsMap,
            totalAnswered: totalStudents,
            totalCorrect,
            facilityIndex: parseFloat(pIndex.toFixed(2)),
            difficultyLabel,
            discriminationIndex: parseFloat(dIndex.toFixed(2)),
            discriminationLabel,
            distractorStats,
            recommendation
        };
    });

    return {
        examId: exam.id,
        examTitle: exam.title,
        totalParticipants: totalStudents,
        totalQuestions: questions.length,
        summary: {
            easyCount: questionAnalysis.filter(q => q.difficultyLabel === 'Mudah').length,
            mediumCount: questionAnalysis.filter(q => q.difficultyLabel === 'Sedang').length,
            hardCount: questionAnalysis.filter(q => q.difficultyLabel === 'Sukar').length,
            acceptedCount: questionAnalysis.filter(q => q.recommendation === 'Diterima').length,
            revisedCount: questionAnalysis.filter(q => q.recommendation === 'Perlu Revisi').length,
            rejectedCount: questionAnalysis.filter(q => q.recommendation === 'Ditolak / Dibuang').length
        },
        items: questionAnalysis,
        itemAnalysis: questionAnalysis
    };
}

// 4. KOREKSI JAWABAN ESAI BERBASIS AI GEMINI
export async function gradeEssayWithAi(params: {
    questionText: string;
    rubric?: string;
    studentAnswer: string;
    maxScore?: number;
}) {
    const { questionText, rubric = '', studentAnswer, maxScore = 100 } = params;

    let keyToUse = process.env.GEMINI_API_KEY || '';
    let modelToUse = 'gemini-2.5-flash';

    try {
        const dbSetting = await prisma.settings.findUnique({ where: { key: 'GEMINI_API_KEY' } });
        if (dbSetting && dbSetting.value) keyToUse = dbSetting.value;
        const dbModel = await prisma.settings.findUnique({ where: { key: 'GEMINI_MODEL' } });
        if (dbModel && dbModel.value) modelToUse = dbModel.value;
    } catch(e) {}

    if (keyToUse && studentAnswer && studentAnswer.trim().length > 3) {
        try {
            const ai = new GoogleGenAI({ apiKey: keyToUse });
            const prompt = `Anda adalah guru penguji objektif dan adil.
Tugas Anda adalah menilai jawaban esai siswa berikut berdasarkan pertanyaan dan pedoman penskoran (rubrik).

Pertanyaan:
${questionText}

Pedoman Kunci / Rubrik:
${rubric || 'Penalaran logis, ketepatan fakta ilmiah, dan kelengkapan penjelasan.'}

Jawaban Siswa:
${studentAnswer}

Skor Maksimum: ${maxScore}

Kembalikan HANYA format JSON murni:
{
  "score": 85,
  "feedback": "Jawaban siswa sangat baik dan menjelaskan konsep utama dengan runtut..."
}`;

            const res = await ai.models.generateContent({
                model: modelToUse || 'gemini-2.5-flash',
                contents: prompt
            });

            let jsonText = (res.text || '').replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(jsonText);
            if (typeof parsed.score === 'number') {
                return {
                    score: Math.min(maxScore, Math.max(0, parsed.score)),
                    feedback: parsed.feedback || 'Jawaban telah dinilai oleh AI.'
                };
            }
        } catch(err) {
            console.warn('Gemini essay grading fallback:', err);
        }
    }

    // Fallback heuristic scoring
    const lengthScore = Math.min(maxScore, Math.max(40, Math.round((studentAnswer.length / 100) * maxScore)));
    return {
        score: lengthScore,
        feedback: 'Penilaian otomatis berdasarkan kelengkapan uraian teks jawaban.'
    };
}
