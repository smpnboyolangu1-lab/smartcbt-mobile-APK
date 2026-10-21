import { Request, Response } from 'express';
import prisma from '../utils/db';
import path from 'path';
import fs from 'fs';

// Helper: Log BK Access (Audit Trail)
export const recordBkAuditLog = async (
    actorId: string,
    actorName: string,
    actorRole: string,
    action: string,
    targetStudentId?: string,
    targetCaseId?: string,
    req?: Request
) => {
    try {
        const ipAddress = req ? (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1') : '127.0.0.1';
        const userAgent = req ? (req.headers['user-agent'] || 'App/Portal') : 'App/Portal';
        await (prisma as any).bkAuditLog.create({
            data: {
                actorId,
                actorName,
                actorRole,
                action,
                targetStudentId: targetStudentId || null,
                targetCaseId: targetCaseId || null,
                ipAddress,
                userAgent
            }
        });
    } catch (err) {
        console.error('Failed to write BK audit log:', err);
    }
};

// ========================================================
// 1. MODUL DETEKSI DINI & KESEHATAN MENTAL (SCREENING)
// ========================================================

/**
 * SDQ (Strengths and Difficulties Questionnaire) Usia 11-17 Tahun
 * 5 Skala: Emosional, Perilaku, Hiperaktivitas, Teman Sebaya, Prososial
 */
export const submitSdqAssessment = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            studentId,
            answers, // Array / Map of 25 question scores: 0 (Tidak Benar), 1 (Agak Benar), 2 (Benar)
            scoreEmotional,
            scoreConduct,
            scoreHyperactivity,
            scorePeer,
            scoreProsocial,
            recommendations
        } = req.body;

        const targetStudentId = studentId || user.id;
        const student = await prisma.user.findUnique({
            where: { id: targetStudentId },
            select: { id: true, name: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan' });
        }

        const emo = parseInt(scoreEmotional) || 0;
        const con = parseInt(scoreConduct) || 0;
        const hyp = parseInt(scoreHyperactivity) || 0;
        const peer = parseInt(scorePeer) || 0;
        const pro = parseInt(scoreProsocial) || 0;

        // Total Difficulties Score = Emotional + Conduct + Hyperactivity + Peer (Rentang 0 - 40)
        const totalScore = emo + con + hyp + peer;

        // Standar Cut-off SDQ Usia 11-17 Tahun (Pedoman Kemenkes / WHO):
        // 0-15: NORMAL, 16-19: BORDERLINE (Ambang Batas), 20-40: ABNORMAL (Perlu Pendampingan Khusus)
        let interpretation = 'NORMAL';
        if (totalScore >= 20) {
            interpretation = 'ABNORMAL';
        } else if (totalScore >= 16) {
            interpretation = 'BORDERLINE';
        }

        const sdqRecord = await (prisma as any).bkSdqAssessment.create({
            data: {
                studentId: student.id,
                studentName: student.name,
                className: student.className || '-',
                counselorId: user.role === 'COUNSELOR' || user.isBk ? user.id : null,
                counselorName: user.role === 'COUNSELOR' || user.isBk ? user.name : null,
                scoreEmotional: emo,
                scoreConduct: con,
                scoreHyperactivity: hyp,
                scorePeer: peer,
                scoreProsocial: pro,
                totalDifficultiesScore: totalScore,
                interpretation,
                answersJson: typeof answers === 'string' ? answers : JSON.stringify(answers || {}),
                recommendations: recommendations || (interpretation === 'ABNORMAL' ? 'Disarankan konseling individual & monitoring teman sebaya.' : 'Perilaku dan emosi dalam batas adaptif normal.')
            }
        });

        await recordBkAuditLog(user.id, user.name, user.role, 'SUBMIT_SDQ', student.id, sdqRecord.id, req);

        res.json({
            success: true,
            message: 'Hasil skrining SDQ berhasil disimpan',
            data: sdqRecord
        });
    } catch (error: any) {
        console.error('Error submitSdqAssessment:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan hasil SDQ: ' + error.message });
    }
};

export const getSdqAssessments = async (req: Request, res: Response) => {
    try {
        const { className, studentId } = req.query;
        const where: any = {};
        if (className && className !== 'ALL' && className !== 'Semua') where.className = className as string;
        if (studentId) where.studentId = studentId as string;

        const records = await (prisma as any).bkSdqAssessment.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 100
        });

        res.json({ success: true, total: records.length, data: records });
    } catch (error: any) {
        console.error('Error getSdqAssessments:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat data SDQ' });
    }
};

/**
 * Sosiometri Digital: Memetakan Hubungan Sosial & Deteksi Siswa Terisolasi / Potensi Bullying
 */
export const saveSociometryAnalysis = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { className, criteria, choices } = req.body;
        // choices: array of { studentId: string, studentName: string, chosenStudentIds: string[] }

        if (!className) {
            return res.status(400).json({ success: false, message: 'Kelas harus ditentukan' });
        }

        const choiceList = Array.isArray(choices) ? choices : [];
        const incomingVotes: { [id: string]: number } = {};
        const studentNameMap: { [id: string]: string } = {};

        // Inisialisasi daftar siswa di kelas tersebut
        const classStudents = await prisma.user.findMany({
            where: { className, role: 'STUDENT', isActive: true },
            select: { id: true, name: true }
        });

        classStudents.forEach(s => {
            incomingVotes[s.id] = 0;
            studentNameMap[s.id] = s.name;
        });

        // Hitung skor pemilihan
        choiceList.forEach((c: any) => {
            studentNameMap[c.studentId] = c.studentName || studentNameMap[c.studentId];
            const targets = Array.isArray(c.chosenStudentIds) ? c.chosenStudentIds : [];
            targets.forEach((tid: string) => {
                incomingVotes[tid] = (incomingVotes[tid] || 0) + 1;
            });
        });

        // Identifikasi:
        // 1. Siswa Bintang (Star): Mendapat pilihan terbanyak (>= 4 pilihan)
        // 2. Siswa Terisolasi (Isolated): Mendapat 0 atau 1 pilihan
        // 3. Potensi Klik/Geng: Pasangan saling memilih (mutual pairs)
        const stars: string[] = [];
        const isolated: string[] = [];
        const mutualPairs: any[] = [];

        Object.entries(incomingVotes).forEach(([id, count]) => {
            const name = studentNameMap[id] || id;
            if (count >= 4) stars.push(name);
            if (count <= 1) isolated.push(name);
        });

        // Deteksi pasangan saling memilih
        const choiceMap: { [id: string]: Set<string> } = {};
        choiceList.forEach((c: any) => {
            choiceMap[c.studentId] = new Set(c.chosenStudentIds || []);
        });

        const checkedPairs = new Set<string>();
        choiceList.forEach((c: any) => {
            const uid = c.studentId;
            const chosen = choiceMap[uid] || new Set();
            chosen.forEach(targetId => {
                if (choiceMap[targetId]?.has(uid)) {
                    const pairKey = [uid, targetId].sort().join('_');
                    if (!checkedPairs.has(pairKey)) {
                        checkedPairs.add(pairKey);
                        mutualPairs.push({
                            student1: studentNameMap[uid] || uid,
                            student2: studentNameMap[targetId] || targetId
                        });
                    }
                }
            });
        });

        const sociometry = await (prisma as any).bkSociometry.create({
            data: {
                className,
                criteria: criteria || 'BELAJAR_KELOMPOK',
                matrixJson: JSON.stringify(choiceList),
                isolatedStudents: JSON.stringify(isolated),
                starStudents: JSON.stringify(stars),
                cliquesJson: JSON.stringify(mutualPairs),
                totalResponses: choiceList.length,
                status: 'SELESAI'
            }
        });

        await recordBkAuditLog(user.id, user.name, user.role, 'CALCULATE_SOCIOMETRY', undefined, sociometry.id, req);

        res.json({
            success: true,
            message: 'Analisis sosiometri digital berhasil dipetakan',
            data: {
                id: sociometry.id,
                className,
                criteria: sociometry.criteria,
                starStudents: stars,
                isolatedStudents: isolated,
                cliques: mutualPairs,
                totalStudents: classStudents.length,
                totalResponses: choiceList.length
            }
        });
    } catch (error: any) {
        console.error('Error saveSociometryAnalysis:', error);
        res.status(500).json({ success: false, message: 'Gagal memproses sosiometri: ' + error.message });
    }
};

export const getSociometryData = async (req: Request, res: Response) => {
    try {
        const { className } = req.query;
        const where: any = {};
        if (className && className !== 'ALL') where.className = className as string;

        const records = await (prisma as any).bkSociometry.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 20
        });

        res.json({ success: true, data: records });
    } catch (error: any) {
        console.error('Error getSociometryData:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat sosiometri' });
    }
};

/**
 * Angket Kebutuhan Peserta Didik (AKPD)
 */
export const submitAkpdAssessment = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, scorePribadi, scoreSosial, scoreBelajar, scoreKarir, topProblemAreas, answers } = req.body;

        const targetId = studentId || user.id;
        const student = await prisma.user.findUnique({
            where: { id: targetId },
            select: { id: true, name: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const akpd = await (prisma as any).bkAkpdAssessment.create({
            data: {
                studentId: student.id,
                studentName: student.name,
                className: student.className || '-',
                scorePribadi: parseFloat(scorePribadi) || 0,
                scoreSosial: parseFloat(scoreSosial) || 0,
                scoreBelajar: parseFloat(scoreBelajar) || 0,
                scoreKarir: parseFloat(scoreKarir) || 0,
                topProblemAreasJson: typeof topProblemAreas === 'string' ? topProblemAreas : JSON.stringify(topProblemAreas || []),
                answersJson: typeof answers === 'string' ? answers : JSON.stringify(answers || {})
            }
        });

        await recordBkAuditLog(user.id, user.name, user.role, 'SUBMIT_AKPD', student.id, akpd.id, req);

        res.json({ success: true, message: 'Angket Kebutuhan Peserta Didik (AKPD) berhasil disimpan', data: akpd });
    } catch (error: any) {
        console.error('Error submitAkpdAssessment:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan AKPD: ' + error.message });
    }
};

// ========================================================
// 2. FITUR ANTI-BULLYING, CYBERBULLYING & BUKTI DIGITAL
// ========================================================

/**
 * Kotak Laporan Rahaja (Whistleblowing Anti-Bullying)
 */
export const submitWhistleblowReport = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            subject,
            message,
            category,
            bullySuspect,
            location,
            evidenceUrl,
            isAnonymous
        } = req.body;

        if (!subject || !message) {
            return res.status(400).json({ success: false, message: 'Subjek dan isi laporan perundungan wajib diisi' });
        }

        const consultation = await prisma.bkConsultation.create({
            data: {
                studentId: user.id,
                subject: `[KOTAK RAHAJA - ANTI BULLYING] ${subject}`,
                message,
                category: category || 'BULLYING',
                isAnonymous: isAnonymous !== false, // Default anonim untuk perlindungan korban/pelapor
                isWhistleblower: true,
                bullySuspect: bullySuspect || 'Tidak disebutkan',
                location: location || 'Lingkungan Sekolah / Siber',
                evidenceUrl: evidenceUrl || null,
                status: 'PENDING'
            }
        });

        // Catat audit tanpa membocorkan nama jika anonim
        await recordBkAuditLog(
            isAnonymous ? 'ANONIM_WHISTLEBLOWER' : user.id,
            isAnonymous ? 'Siswa Rahasia (Whistleblower Protection)' : user.name,
            'STUDENT',
            'WHISTLEBLOW_BULLYING',
            undefined,
            consultation.id,
            req
        );

        res.json({
            success: true,
            message: 'Laporan perundungan berhasil dikirim secara aman ke Satgas TPPK & Guru BK.',
            ticketId: consultation.id
        });
    } catch (error: any) {
        console.error('Error submitWhistleblowReport:', error);
        res.status(500).json({ success: false, message: 'Gagal mengirim laporan: ' + error.message });
    }
};

// ========================================================
// 3. E-RPL (RENCANA PELAKSANAAN LAYANAN) GENERATOR
// ========================================================

export const generateRpl = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            jenisLayanan, // BIMBINGAN_KLASIKAL, BIMBINGAN_KELOMPOK, KONSELING_INDIVIDUAL
            topik,
            bidangBimbingan, // PRIBADI, SOSIAL, BELAJAR, KARIR
            kelasTarget,
            alokasiWaktu,
            tujuanLayanan,
            metodeDanTeknik,
            mediaAlat,
            langkahKegiatan,
            evaluasiProsesDanHasil
        } = req.body;

        if (!topik || !jenisLayanan || !kelasTarget) {
            return res.status(400).json({ success: false, message: 'Topik, jenis layanan, dan kelas target wajib diisi.' });
        }

        // Template Standar Kemendikbud Kurikulum Merdeka jika langkah tidak diisi lengkap
        const defaultSteps = {
            tahapAwal: '1. Guru BK menyapa dan mengondisikan kelas.\n2. Ice breaking dan menyampaikan tujuan materi.\n3. Menjelaskan langkah-langkah kegiatan.',
            tahapInti: '1. Pemaparan materi interaktif dan penayangan kasus/video.\n2. Diskusi kelompok terarah dan refleksi diri siswa.\n3. Presentasi gagasan dan solusi dari perwakilan siswa.',
            tahapPenutup: '1. Guru BK bersama siswa merangkum poin-poin inti bimbingan.\n2. Siswa mengisi lembar evaluasi hasil (Laiseg).\n3. Doa penutup dan tindak lanjut pendampingan.'
        };

        const rpl = await (prisma as any).bkRplRecord.create({
            data: {
                guruBkId: user.id,
                guruBkName: user.name,
                jenisLayanan,
                topik,
                bidangBimbingan: bidangBimbingan || 'PRIBADI',
                kelasTarget,
                alokasiWaktu: alokasiWaktu || '1 x 40 Menit',
                tujuanLayanan: tujuanLayanan || `Siswa mampu memahami, menganalisis, dan menerapkan pemahaman terkait ${topik} dalam kehidupan sehari-hari.`,
                metodeDanTeknik: metodeDanTeknik || 'Diskusi Terarah, Ceramah Interaktif, & Experiential Learning',
                mediaAlat: mediaAlat || 'LCD Proyektor, Lembar Kerja Siswa (LKS), & Video Studi Kasus',
                langkahKegiatanJson: typeof langkahKegiatan === 'string' ? langkahKegiatan : JSON.stringify(langkahKegiatan || defaultSteps),
                evaluasiProsesDanHasil: evaluasiProsesDanHasil || 'Evaluasi Proses: Antusiasme siswa dan keterlibatan aktif.\nEvaluasi Hasil: Penilaian Segera (Laiseg) pemahaman materi.'
            }
        });

        await recordBkAuditLog(user.id, user.name, user.role, 'GENERATE_E_RPL', undefined, rpl.id, req);

        res.json({
            success: true,
            message: 'E-RPL BK Standar Kemendikbud berhasil disusun!',
            data: rpl
        });
    } catch (error: any) {
        console.error('Error generateRpl:', error);
        res.status(500).json({ success: false, message: 'Gagal membuat E-RPL: ' + error.message });
    }
};

export const getRplList = async (req: Request, res: Response) => {
    try {
        const records = await (prisma as any).bkRplRecord.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json({ success: true, data: records });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat daftar RPL' });
    }
};

export const printRplHtml = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const rpl = await (prisma as any).bkRplRecord.findUnique({ where: { id } });
        if (!rpl) return res.status(404).send('Dokumen RPL tidak ditemukan');

        let steps: any = {};
        try { steps = JSON.parse(rpl.langkahKegiatanJson || '{}'); } catch (e) {}

        const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>E-RPL BK - ${rpl.topik}</title>
<style>
  @page { size: A4; margin: 15mm 20mm 15mm 20mm; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.4; color: #000; }
  .kop { text-align: center; border-bottom: 3px double #000; padding-bottom: 8px; margin-bottom: 16px; }
  .kop h3, .kop h2, .kop p { margin: 2px 0; }
  .kop h2 { font-size: 13pt; text-transform: uppercase; }
  .kop h3 { font-size: 12pt; text-transform: uppercase; font-weight: normal; }
  .kop p { font-size: 9pt; font-style: italic; }
  .title { text-align: center; font-weight: bold; font-size: 12pt; text-decoration: underline; margin-bottom: 12px; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 10.5pt; }
  table.meta td { padding: 3px 6px; vertical-align: top; }
  .section-title { font-weight: bold; margin-top: 10px; margin-bottom: 4px; text-transform: uppercase; font-size: 11pt; }
  .content-box { border: 1px solid #000; padding: 10px; margin-bottom: 10px; }
  .footer { margin-top: 30px; display: flex; justify-content: space-between; font-size: 10.5pt; }
  .sig-box { width: 220px; text-align: center; }
  .sig-space { height: 60px; }
</style>
</head>
<body onload="if(new URLSearchParams(window.location.search).get('autoprint')!=='false')window.print()">
  <div class="kop">
    <h3>PEMERINTAH KABUPATEN TULUNGAGUNG<br>DINAS PENDIDIKAN</h3>
    <h2>SMP NEGERI 1 BOYOLANGU</h2>
    <p>Jl. Ki Mangunsarkoro, Boyolangu, Tulungagung, Jawa Timur 66235 | Telp: (0355) 321789</p>
  </div>

  <div class="title">RENCANA PELAKSANAAN LAYANAN BIMBINGAN DAN KONSELING (RPL-BK)</div>
  <table class="meta">
    <tr><td width="25%">Satuan Pendidikan</td><td width="2%">:</td><td>SMP Negeri 1 Boyolangu</td></tr>
    <tr><td>Tahun Ajaran / Sem.</td><td>:</td><td>${rpl.tahunAjaran} / ${rpl.semester}</td></tr>
    <tr><td>Jenis Layanan</td><td>:</td><td><strong>${rpl.jenisLayanan.replace(/_/g, ' ')}</strong></td></tr>
    <tr><td>Sasaran / Kelas</td><td>:</td><td>${rpl.kelasTarget}</td></tr>
    <tr><td>Bidang Bimbingan</td><td>:</td><td>${rpl.bidangBimbingan}</td></tr>
    <tr><td>Topik / Tema</td><td>:</td><td><strong>${rpl.topik}</strong></td></tr>
    <tr><td>Alokasi Waktu</td><td>:</td><td>${rpl.alokasiWaktu}</td></tr>
  </table>

  <div class="section-title">A. TUJUAN LAYANAN</div>
  <div class="content-box">${rpl.tujuanLayanan.replace(/\n/g, '<br>')}</div>

  <div class="section-title">B. METODE, MEDIA & ALAT</div>
  <div class="content-box">
    <strong>Metode & Teknik:</strong> ${rpl.metodeDanTeknik}<br>
    <strong>Media & Alat:</strong> ${rpl.mediaAlat}
  </div>

  <div class="section-title">C. LANGKAH-LANGKAH KEGIATAN</div>
  <div class="content-box">
    <strong>1. Tahap Awal / Pendahuluan:</strong><br>${(steps.tahapAwal || 'Pengondisian kelas, ice breaking, presensi, dan apersepsi.').replace(/\n/g, '<br>')}<br><br>
    <strong>2. Tahap Inti / Eksplorasi:</strong><br>${(steps.tahapInti || 'Pemaparan materi bimbingan dan diskusi kelompok terarah.').replace(/\n/g, '<br>')}<br><br>
    <strong>3. Tahap Penutup / Terminasi:</strong><br>${(steps.tahapPenutup || 'Refleksi pengalaman, evaluasi hasil, dan penguatan positif.').replace(/\n/g, '<br>')}
  </div>

  <div class="section-title">D. EVALUASI DAN TINDAK LANJUT</div>
  <div class="content-box">${rpl.evaluasiProsesDanHasil.replace(/\n/g, '<br>')}</div>

  <table style="width:100%; margin-top:30px;">
    <tr>
      <td width="50%" align="center">
        Mengetahui,<br>Kepala SMP Negeri 1 Boyolangu<br><br><br><br>
        <strong>MOHAMAD SUPRIYONO, S.Pd., M.M.</strong><br>
        NIP. 196803151998021004
      </td>
      <td width="50%" align="center">
        Boyolangu, ${new Date(rpl.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}<br>
        Guru Bimbingan Konseling<br><br><br><br>
        <strong>${rpl.guruBkName.toUpperCase()}</strong><br>
        NIP. -
      </td>
    </tr>
  </table>
</body>
</html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err: any) {
        res.status(500).send('Error rendering RPL: ' + err.message);
    }
};

// ========================================================
// 4. KONTRAK PERILAKU & POIN REWARD (POSITIVE REINFORCEMENT)
// ========================================================

/**
 * Kontrak Perilaku Siswa (Behavior Contract) Sebelum SP Diterbitkan
 */
export const createBehaviorContract = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, targetBehaviors, rewards, consequences, startDate, endDate, notes } = req.body;

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const contract = await (prisma as any).bkBehaviorContract.create({
            data: {
                studentId: student.id,
                studentName: student.name,
                className: student.className || '-',
                guruBkId: user.id,
                guruBkName: user.name,
                targetBehaviorsJson: typeof targetBehaviors === 'string' ? targetBehaviors : JSON.stringify(targetBehaviors || []),
                rewardsJson: typeof rewards === 'string' ? rewards : JSON.stringify(rewards || []),
                consequencesJson: typeof consequences === 'string' ? consequences : JSON.stringify(consequences || []),
                startDate: new Date(startDate || Date.now()),
                endDate: new Date(endDate || (Date.now() + 30 * 24 * 60 * 60 * 1000)), // Default 30 hari kontrak
                status: 'AKTIF',
                notes: notes || 'Kesepakatan perubahan sikap positif disaksikan oleh Guru BK & Orang Tua.'
            }
        });

        await recordBkAuditLog(user.id, user.name, user.role, 'CREATE_BEHAVIOR_CONTRACT', student.id, contract.id, req);

        res.json({
            success: true,
            message: 'Kontrak perilaku resmi berhasil diterbitkan.',
            data: contract
        });
    } catch (error: any) {
        console.error('Error createBehaviorContract:', error);
        res.status(500).json({ success: false, message: 'Gagal membuat kontrak perilaku: ' + error.message });
    }
};

/**
 * Poin Reward (Positive Reinforcement) Mengurangi Akumulasi Poin Pelanggaran
 */
export const issueDisciplineReward = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, achievementTitle, rewardPoints, notes } = req.body;

        const points = parseInt(rewardPoints) || 5;
        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, points: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        // Catat sebagai record prestasi yang mengurangi akumulasi poin
        await prisma.disciplineRecord.create({
            data: {
                userId: student.id,
                type: 'PRESTASI',
                category: 'REWARD_POSITIF',
                description: `[PENGHARGAAN POSITIF] ${achievementTitle || 'Perilaku Positif / Prestasi Terpuji'}`,
                points: -points, // Mengurangi poin pelanggaran
                sanction: 'Pengurangan Akumulasi Poin Pelanggaran',
                reportedBy: user.name
            }
        });

        // Update total poin siswa (minimal 0)
        const updatedPoints = Math.max(0, (student.points || 0) - points);
        await prisma.user.update({
            where: { id: student.id },
            data: { points: updatedPoints }
        });

        await recordBkAuditLog(user.id, user.name, user.role, 'AWARD_REWARD_POINTS', student.id, undefined, req);

        res.json({
            success: true,
            message: `Berhasil menambahkan poin reward ${points} poin. Sisa poin siswa: ${updatedPoints}`,
            currentPoints: updatedPoints
        });
    } catch (error: any) {
        console.error('Error issueDisciplineReward:', error);
        res.status(500).json({ success: false, message: 'Gagal menambahkan reward: ' + error.message });
    }
};

// ========================================================
// 5. EVALUASI HASIL LAYANAN (LAISEG, LAIJAPEN, LAIJAPANG)
// ========================================================

export const submitServiceEvaluation = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { serviceType, referenceId, evalType, studentId, understandingScore, comfortScore, actionPlanScore, notes } = req.body;

        const targetId = studentId || user.id;
        const student = await prisma.user.findUnique({
            where: { id: targetId },
            select: { id: true, name: true }
        });

        const ev = await (prisma as any).bkServiceEvaluation.create({
            data: {
                serviceType: serviceType || 'KONSELING_INDIVIDU',
                referenceId: referenceId || null,
                evalType: evalType || 'LAISEG',
                studentId: targetId,
                studentName: student?.name || 'Siswa',
                guruBkId: user.id,
                understandingScore: parseInt(understandingScore) || 5,
                comfortScore: parseInt(comfortScore) || 5,
                actionPlanScore: parseInt(actionPlanScore) || 5,
                notes: notes || 'Layanan konseling memberikan solusi dan kenyamanan emosional bagi siswa.'
            }
        });

        res.json({ success: true, message: `Evaluasi ${evalType || 'LAISEG'} berhasil disimpan`, data: ev });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal menyimpan evaluasi: ' + error.message });
    }
};

// ========================================================
// 6. LAPORAN BULANAN & SEMESTERAN RESMI OTOMATIS
// ========================================================

export const getBkMonthlyReport = async (req: Request, res: Response) => {
    try {
        const { month, year } = req.query;
        const targetYear = parseInt(year as string) || new Date().getFullYear();
        const targetMonth = parseInt(month as string) || (new Date().getMonth() + 1);

        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

        // Agregasi Data
        const consultations = await prisma.bkConsultation.findMany({
            where: { createdAt: { gte: startDate, lte: endDate } }
        });

        const disciplines = await prisma.disciplineRecord.findMany({
            where: { createdAt: { gte: startDate, lte: endDate } }
        });

        const warnings = await prisma.disciplineWarningLetter.findMany({
            where: { issuedAt: { gte: startDate, lte: endDate } }
        });

        const rpls = await (prisma as any).bkRplRecord.findMany({
            where: { createdAt: { gte: startDate, lte: endDate } }
        });

        const totalKasus = consultations.length;
        const selesai = consultations.filter(c => c.status === 'RESOLVED').length;
        const terjadwal = consultations.filter(c => c.status === 'SCHEDULED').length;
        const pending = consultations.filter(c => c.status === 'PENDING').length;

        // Distribusi Kategori
        const kategoriCount: { [k: string]: number } = {};
        consultations.forEach(c => {
            const cat = c.category || 'LAINNYA';
            kategoriCount[cat] = (kategoriCount[cat] || 0) + 1;
        });

        res.json({
            success: true,
            period: `${targetMonth}/${targetYear}`,
            summary: {
                totalKasus,
                kasusSelesai: selesai,
                jadwalTatapMuka: terjadwal,
                kasusMenunggu: pending,
                totalPelanggaran: disciplines.filter(d => d.type === 'PELANGGARAN').length,
                totalRewardPrestasi: disciplines.filter(d => d.type === 'PRESTASI').length,
                totalSpDiterbitkan: warnings.length,
                totalRplTersusun: rpls.length,
                distribusiKategori: kategoriCount
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat rekap laporan: ' + error.message });
    }
};

export const printBkMonthlyReportHtml = async (req: Request, res: Response) => {
    try {
        const { month, year } = req.query;
        const targetYear = parseInt(year as string) || new Date().getFullYear();
        const targetMonth = parseInt(month as string) || (new Date().getMonth() + 1);

        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
        const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        const consultations = await prisma.bkConsultation.findMany({
            where: { createdAt: { gte: startDate, lte: endDate } },
            include: { student: { select: { name: true, className: true } } }
        });

        const disciplines = await prisma.disciplineRecord.findMany({
            where: { createdAt: { gte: startDate, lte: endDate } }
        });

        const warnings = await prisma.disciplineWarningLetter.findMany({
            where: { issuedAt: { gte: startDate, lte: endDate } }
        });

        const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Laporan Bulanan Layanan BK - ${monthNames[targetMonth]} ${targetYear}</title>
<style>
  @page { size: A4; margin: 15mm 20mm; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.4; color: #000; }
  .kop { text-align: center; border-bottom: 3px double #000; padding-bottom: 8px; margin-bottom: 16px; }
  .kop h3, .kop h2, .kop p { margin: 2px 0; }
  .title { text-align: center; font-weight: bold; font-size: 13pt; text-decoration: underline; margin-bottom: 4px; }
  .sub-title { text-align: center; font-size: 11pt; margin-bottom: 16px; }
  table.data-table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 16px; font-size: 10pt; }
  table.data-table th, table.data-table td { border: 1px solid #000; padding: 6px 8px; }
  table.data-table th { background-color: #F1F5F9; font-weight: bold; text-align: center; }
  .stat-grid { display: flex; gap: 10px; margin-bottom: 16px; }
  .stat-box { flex: 1; border: 1px solid #000; padding: 8px; text-align: center; }
  .stat-val { font-size: 16pt; font-weight: bold; }
  .stat-lbl { font-size: 9pt; text-transform: uppercase; }
</style>
</head>
<body onload="if(new URLSearchParams(window.location.search).get('autoprint')!=='false')window.print()">
  <div class="kop">
    <h3>PEMERINTAH KABUPATEN TULUNGAGUNG<br>DINAS PENDIDIKAN</h3>
    <h2>SMP NEGERI 1 BOYOLANGU</h2>
    <p>Jl. Ki Mangunsarkoro, Boyolangu, Tulungagung, Jawa Timur 66235 | Telp: (0355) 321789</p>
  </div>

  <div class="title">LAPORAN REKAPITULASI LAYANAN BIMBINGAN DAN KONSELING (BK)</div>
  <div class="sub-title">Periode: Bulan ${monthNames[targetMonth]} ${targetYear}</div>

  <table class="data-table">
    <thead>
      <tr>
        <th width="5%">No</th>
        <th width="25%">Indikator Layanan BK</th>
        <th width="15%">Jumlah</th>
        <th>Keterangan & Distribusi</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td align="center">1</td>
        <td>Total Kasus / Konseling Masuk</td>
        <td align="center"><strong>${consultations.length}</strong></td>
        <td>${consultations.filter(c => c.status === 'RESOLVED').length} Selesai, ${consultations.filter(c => c.status === 'SCHEDULED').length} Tatap Muka, ${consultations.filter(c => c.status === 'PENDING').length} Proses</td>
      </tr>
      <tr>
        <td align="center">2</td>
        <td>Kasus Perundungan (Bullying)</td>
        <td align="center"><strong>${consultations.filter(c => c.category === 'BULLYING' || (c as any).isWhistleblower).length}</strong></td>
        <td>Ditangani bersama Satgas TPPK SMPN 1 Boyolangu</td>
      </tr>
      <tr>
        <td align="center">3</td>
        <td>Catatan Pelanggaran Tata Tertib</td>
        <td align="center"><strong>${disciplines.filter(d => d.type === 'PELANGGARAN').length}</strong></td>
        <td>Dicatat buku poin kedisiplinan portal</td>
      </tr>
      <tr>
        <td align="center">4</td>
        <td>Penghargaan Prestasi (Reward)</td>
        <td align="center"><strong>${disciplines.filter(d => d.type === 'PRESTASI').length}</strong></td>
        <td>Positive reinforcement pengurangan poin pelanggaran</td>
      </tr>
      <tr>
        <td align="center">5</td>
        <td>Surat Peringatan (SP) Diterbitkan</td>
        <td align="center"><strong>${warnings.length}</strong></td>
        <td>Didahului kontrak perilaku & panggilan orang tua</td>
      </tr>
    </tbody>
  </table>

  <table style="width:100%; margin-top:35px;">
    <tr>
      <td width="50%" align="center">
        Mengetahui,<br>Kepala SMP Negeri 1 Boyolangu<br><br><br><br>
        <strong>MOHAMAD SUPRIYONO, S.Pd., M.M.</strong><br>
        NIP. 196803151998021004
      </td>
      <td width="50%" align="center">
        Boyolangu, ${new Date(endDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}<br>
        Koordinator Guru BK<br><br><br><br>
        <strong>ENDAH TRI WAHYUNI, S.Pd.</strong><br>
        NIP. 198008312022212019
      </td>
    </tr>
  </table>
</body>
</html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err: any) {
        res.status(500).send('Error rendering report: ' + err.message);
    }
};

// ========================================================
// 7. INFORMED CONSENT & AUDIT LOGS
// ========================================================

export const submitInformedConsent = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, serviceType, purpose, signatureDigital } = req.body;

        const student = await prisma.user.findUnique({
            where: { id: studentId || user.id },
            select: { id: true, name: true }
        });

        const consent = await (prisma as any).bkInformedConsent.create({
            data: {
                studentId: student?.id || user.id,
                studentName: student?.name || user.name,
                guruBkId: user.id,
                guruBkName: user.name,
                serviceType: serviceType || 'KONSELING_INDIVIDUAL_MENDALAM',
                purpose: purpose || 'Persetujuan pendampingan bimbingan konseling dan asesmen psikologis secara etis & rahasia.',
                isAgreedStudent: true,
                signedAtStudent: new Date(),
                signatureDigital: signatureDigital || 'DIGITALLY_SIGNED_IN_APP'
            }
        });

        await recordBkAuditLog(user.id, user.name, user.role, 'SIGN_INFORMED_CONSENT', student?.id, consent.id, req);

        res.json({ success: true, message: 'Informed Consent bimbingan konseling berhasil disetujui.', data: consent });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal menyimpan persetujuan: ' + error.message });
    }
};

export const getBkAuditLogs = async (req: Request, res: Response) => {
    try {
        const logs = await (prisma as any).bkAuditLog.findMany({
            orderBy: { timestamp: 'desc' },
            take: 100
        });
        res.json({ success: true, total: logs.length, data: logs });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat log audit BK' });
    }
};
