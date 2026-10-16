import { Request, Response } from 'express';
import prisma from '../utils/db';
import { sendFcmToUser } from '../services/fcmService';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

function formatQueryForEngine(sql: string): string {
  const isPg = (process.env.DATABASE_URL || '').includes('postgres');
  if (!isPg) return sql;
  let index = 1;
  return sql.replace(/\?/g, () => '$' + (index++));
}

async function safeRawQuery(sql: string, ...params: any[]): Promise<any[]> {
  const formattedSql = formatQueryForEngine(sql);
  return await prisma.$queryRawUnsafe(formattedSql, ...params);
}

async function safeRawExecute(sql: string, ...params: any[]): Promise<any> {
  const formattedSql = formatQueryForEngine(sql);
  return await prisma.$executeRawUnsafe(formattedSql, ...params);
}

/**
 * 1. Ambil Master 37 Surat Juz 30 (An-Naba s.d. An-Nas) beserta Status Siswa
 */
export const getTahfizSurahList = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const targetStudentId = (req.query.studentId as string) || (user?.role === 'STUDENT' ? user.id : null);

    const surahs: any[] = await safeRawQuery(`
      SELECT * FROM tahfiz_surah_master ORDER BY number ASC
    `);

    let studentStatusMap = new Map<number, any>();
    if (targetStudentId) {
      const records: any[] = await safeRawQuery(`
        SELECT * FROM tahfiz_penilaian 
        WHERE student_id = ? 
        ORDER BY created_at DESC
      `, targetStudentId);

      for (const r of records) {
        if (!studentStatusMap.has(r.surah_number)) {
          studentStatusMap.set(r.surah_number, r);
        }
      }

      // Check pending setoran
      const pendingSetoran: any[] = await safeRawQuery(`
        SELECT * FROM tahfiz_setoran
        WHERE student_id = ? AND status = 'MENUNGGU'
      `, targetStudentId);

      for (const p of pendingSetoran) {
        if (!studentStatusMap.has(p.surah_number) || studentStatusMap.get(p.surah_number)?.status_hafalan === 'BELUM_DIPELAJARI') {
          studentStatusMap.set(p.surah_number, {
            status_hafalan: 'SIAP_DISETORKAN',
            setoran_status: 'MENUNGGU',
            setoran_id: p.id
          });
        }
      }
    }

    const enriched = surahs.map(s => {
      const st = studentStatusMap.get(s.number);
      return {
        number: s.number,
        nameLatin: s.name_latin,
        nameArabic: s.name_arabic,
        meaning: s.meaning,
        ayatCount: s.ayat_count,
        place: s.place,
        audioUrl: s.audio_url,
        statusHafalan: st ? st.status_hafalan : 'BELUM_DIPELAJARI',
        nilaiAkhir: st ? st.nilai_akhir : null,
        catatanGuru: st ? st.catatan_guru : null,
        tanggalPenilaian: st ? st.tanggal_penilaian : null
      };
    });

    res.json({
      success: true,
      surahs: enriched
    });
  } catch (error: any) {
    console.error('Error getTahfizSurahList:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar surat: ' + error.message });
  }
};

/**
 * 2. Dashboard Monitoring Hafalan (Portal Sekolah & APK Guru PAI)
 */
export const getTahfizDashboardSummary = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { className } = req.query;

    const studentWhere: any = { role: 'STUDENT' };
    if (className && className !== 'ALL') {
      studentWhere.className = String(className).trim();
    }

    const students = await prisma.user.findMany({
      where: studentWhere,
      select: { id: true, name: true, username: true, nisn: true, className: true, gender: true },
      orderBy: { name: 'asc' }
    });

    const totalStudents = students.length;
    const studentIds = students.map(s => `'${s.id}'`).join(',');

    let pendingCount = 0;
    let completedCount = 0;
    let murojaahCount = 0;
    let recentSetoran: any[] = [];

    if (totalStudents > 0 && studentIds) {
      const pendingRes: any[] = await safeRawQuery(`
        SELECT COUNT(*) as cnt FROM tahfiz_setoran WHERE student_id IN (${studentIds}) AND status = 'MENUNGGU'
      `);
      pendingCount = Number(pendingRes[0]?.cnt || 0);

      const completedRes: any[] = await safeRawQuery(`
        SELECT COUNT(DISTINCT student_id) as cnt FROM tahfiz_penilaian 
        WHERE student_id IN (${studentIds}) AND status_hafalan IN ('TUNTAS_SESUAI_TARGET', 'LULUS_SETORAN')
      `);
      completedCount = Number(completedRes[0]?.cnt || 0);

      const murojaahRes: any[] = await safeRawQuery(`
        SELECT COUNT(*) as cnt FROM tahfiz_murojaah 
        WHERE student_id IN (${studentIds}) AND status = 'TERJADWAL'
      `);
      murojaahCount = Number(murojaahRes[0]?.cnt || 0);

      recentSetoran = (await safeRawQuery(`
        SELECT * FROM tahfiz_setoran 
        WHERE student_id IN (${studentIds}) 
        ORDER BY created_at DESC LIMIT 25
      `)).map(r => ({
        ...r,
        audio_url: r.audio_record_url,
        audioRecordUrl: r.audio_record_url,
        scheduledDate: r.scheduled_date,
        scheduledSession: r.scheduled_session,
        targetGuruId: r.target_guru_id,
        targetGuruName: r.target_guru_name,
        meetingLocation: r.meeting_location,
        studentNotes: r.student_notes
      }));
    }

    // Ambil target aktif kelas / sekolah
    const targets: any[] = await safeRawQuery(`
      SELECT * FROM tahfiz_target WHERE status = 'AKTIF' ORDER BY surah_number ASC
    `);

    const kpiData = {
      totalStudents,
      targetTuntas: completedCount,
      pendingSetoran: pendingCount,
      needMurojaah: murojaahCount,
      setoranMenunggu: pendingCount,
      murojaahPerlu: murojaahCount,
      setoranHariIni: pendingCount,
      perluMurojaah: murojaahCount,
      butuhBimbingan: murojaahCount
    };

    res.json({
      success: true,
      summary: kpiData,
      kpi: kpiData,
      targets,
      recentSetoran,
      recentSubmissions: recentSetoran, // Alias for Teacher APK
      submissions: recentSetoran,
      studentsCount: totalStudents
    });
  } catch (error: any) {
    console.error('Error getTahfizDashboardSummary:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat dashboard tahfiz: ' + error.message });
  }
};

/**
 * 3. Atur Target Hafalan (Guru PAI / Portal)
 */
export const saveTahfizTarget = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      targetType = 'KELAS',
      className,
      studentId,
      studentName,
      surahNumber,
      surahName,
      ayatStart = 1,
      ayatEnd,
      semester = 'Ganjil',
      academicYear = '2026/2027',
      deadlineDate
    } = req.body;

    let resolvedSurahName = surahName;
    if (!resolvedSurahName || resolvedSurahName === 'undefined') {
      try {
        const sMaster: any[] = await safeRawQuery(`SELECT name_latin FROM tahfiz_surah_master WHERE number = ?`, Number(surahNumber));
        if (sMaster && sMaster.length > 0 && sMaster[0].name_latin) {
          resolvedSurahName = sMaster[0].name_latin;
        } else {
          resolvedSurahName = `Surat ke-${surahNumber}`;
        }
      } catch (e) {
        resolvedSurahName = `Surat ke-${surahNumber}`;
      }
    }

    const id = 'tgt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    await safeRawExecute(`
      INSERT INTO tahfiz_target (
        id, guru_id, guru_name, target_type, class_name, student_id, student_name,
        surah_number, surah_name, ayat_start, ayat_end, semester, academic_year, deadline_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF')
    `, 
      id,
      user?.id || 'GURU_PAI',
      user?.name || 'Guru PAI',
      targetType,
      className || null,
      studentId || null,
      studentName || null,
      Number(surahNumber),
      String(resolvedSurahName),
      Number(ayatStart),
      Number(ayatEnd),
      semester,
      academicYear,
      deadlineDate || null
    );

    res.json({
      success: true,
      message: `Target hafalan Surat ${surahName} (Ayat ${ayatStart}-${ayatEnd}) berhasil disimpan!`
    });
  } catch (error: any) {
    console.error('Error saveTahfizTarget:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan target: ' + error.message });
  }
};

/**
 * 4. Pengajuan Setoran Hafalan Siswa (APK Siswa / Guru PAI)
 */
/**
 * 4. Pengajuan Setoran Hafalan Siswa (APK Siswa / Guru PAI)
 * Mendukung:
 * - Setoran Langsung (Penjadwalan Temu Guru PAI di Sekolah)
 * - Rekaman Audio Langsung (Upload File / Base64 Audio)
 */
export const submitTahfizSetoran = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      studentId,
      surahNumber,
      surahName,
      ayatStart = 1,
      ayatEnd,
      metode = 'LANGSUNG',
      audioRecordUrl,
      audioBase64,
      submissionDate,
      scheduledDate,
      scheduledSession,
      targetGuruId,
      targetGuruName,
      meetingLocation,
      notes,
      studentNotes
    } = req.body;

    const sId = studentId || user?.id;
    const student = await prisma.user.findUnique({ where: { id: sId } });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
    }

    const id = 'str_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const subDate = submissionDate || new Date().toISOString().substring(0, 10);
    const resolvedNotes = notes || studentNotes || null;

    let finalAudioUrl = audioRecordUrl || null;
    if ((req as any).file && (req as any).file.filename) {
      finalAudioUrl = `/uploads/tahfiz_audio/${(req as any).file.filename}`;
    } else if (audioBase64 && typeof audioBase64 === 'string') {
      try {
        const audioDir = path.join(process.cwd(), 'uploads', 'tahfiz_audio');
        if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

        const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        const filename = `setoran_${id}_${Date.now()}.m4a`;
        const filePath = path.join(audioDir, filename);
        fs.writeFileSync(filePath, buffer);
        finalAudioUrl = `/uploads/tahfiz_audio/${filename}`;
      } catch (err: any) {
        console.warn('Gagal menyimpan base64 audio setoran:', err.message);
      }
    }

    const targetDate = scheduledDate || (metode === 'LANGSUNG' ? subDate : null);
    const targetSession = scheduledSession || (metode === 'LANGSUNG' ? 'Istirahat 1 (09:30 - 10:00 WIB)' : null);
    const targetLocation = meetingLocation || (metode === 'LANGSUNG' ? 'Mushola / Masjid SMPN 1 Boyolangu' : null);

    await safeRawExecute(`
      INSERT INTO tahfiz_setoran (
        id, student_id, student_name, class_name, surah_number, surah_name,
        ayat_start, ayat_end, metode, audio_record_url, scheduled_date, scheduled_session,
        target_guru_id, target_guru_name, meeting_location, student_notes, submission_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MENUNGGU')
    `,
      id,
      student.id,
      student.name,
      student.className || '-',
      Number(surahNumber),
      String(surahName),
      Number(ayatStart),
      Number(ayatEnd),
      metode,
      finalAudioUrl,
      targetDate,
      targetSession,
      targetGuruId || null,
      targetGuruName || null,
      targetLocation,
      resolvedNotes,
      subDate
    );

    // Update status penilaian sementara menjadi SIAP_DISETORKAN (Menunggu Penilaian Guru PAI)
    const existingPenilaian: any[] = await safeRawQuery(`
      SELECT id FROM tahfiz_penilaian WHERE student_id = ? AND surah_number = ?
    `, student.id, Number(surahNumber));

    if (existingPenilaian.length === 0) {
      const pId = 'pen_' + Date.now();
      await safeRawExecute(`
        INSERT INTO tahfiz_penilaian (
          id, setoran_id, student_id, student_name, class_name, guru_id, guru_name,
          surah_number, surah_name, ayat_start, ayat_end, status_hafalan, tanggal_penilaian
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SIAP_DISETORKAN', ?)
      `, pId, id, student.id, student.name, student.className || '-', targetGuruId || 'GURU_PAI', targetGuruName || 'Menunggu Penilaian Guru PAI', Number(surahNumber), String(surahName), Number(ayatStart), Number(ayatEnd), subDate);
    }

    // Kirim notifikasi In-App & FCM ke Guru PAI
    try {
      const guruMsg = metode === 'LANGSUNG'
        ? `Santri ${student.name} (Kelas ${student.className || '-'}) mengajukan Setoran Langsung Surat ${surahName} (Ayat ${ayatStart}-${ayatEnd}) pada tanggal ${targetDate} (${targetSession}). Mohon verifikasi di portal / APK Guru PAI.`
        : `Santri ${student.name} (Kelas ${student.className || '-'}) mengirim rekaman audio hafalan Surat ${surahName} (Ayat ${ayatStart}-${ayatEnd}). Dengarkan dan nilai di portal / APK Guru PAI.`;

      if (targetGuruId) {
        await (prisma as any).notificationMessage.create({
          data: {
            recipientId: targetGuruId,
            recipientRole: 'TEACHER',
            title: `📖 Setoran Hafalan Baru: ${student.name}`,
            message: guruMsg,
            category: 'ACADEMIC'
          }
        }).catch(() => {});
        sendFcmToUser(targetGuruId, `📖 Setoran Baru: ${student.name}`, guruMsg, { type: 'TAHFIZ_SETORAN', setoranId: id }).catch(() => {});
      }
    } catch (e) {}

    const successMessage = metode === 'LANGSUNG'
      ? `Jadwal setoran tatap muka Surat ${surahName} berhasil diajukan untuk tanggal ${targetDate} (${targetSession})! Guru PAI telah dinotifikasi.`
      : `Rekaman audio hafalan Surat ${surahName} berhasil dikirim! Menunggu penilaian Guru PAI.`;

    res.json({
      success: true,
      message: successMessage,
      setoranId: id,
      audioUrl: finalAudioUrl
    });
  } catch (error: any) {
    console.error('Error submitTahfizSetoran:', error);
    res.status(500).json({ success: false, message: 'Gagal mengajukan setoran: ' + error.message });
  }
};

/**
 * 4b. Ambil Daftar Antrean / Riwayat Setoran Hafalan (Untuk Guru PAI & Siswa)
 */
export const getTahfizSetoranList = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, className, studentId, limit = 50, page = 1 } = req.query;

    let whereConditions: string[] = [];
    if (status && status !== 'ALL') {
      whereConditions.push(`status = '${String(status).trim()}'`);
    }
    if (className && className !== 'ALL') {
      whereConditions.push(`class_name = '${String(className).trim()}'`);
    }
    if (studentId) {
      whereConditions.push(`student_id = '${String(studentId).trim()}'`);
    } else if (user?.role === 'STUDENT') {
      whereConditions.push(`student_id = '${user.id}'`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);

    const list: any[] = await safeRawQuery(`
      SELECT * FROM tahfiz_setoran
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${Number(limit)} OFFSET ${offset}
    `);

    const enriched = list.map(item => ({
      ...item,
      audio_url: item.audio_record_url,
      audioRecordUrl: item.audio_record_url,
      scheduledDate: item.scheduled_date,
      scheduledSession: item.scheduled_session,
      targetGuruId: item.target_guru_id,
      targetGuruName: item.target_guru_name,
      meetingLocation: item.meeting_location,
      studentNotes: item.student_notes,
      notes: item.student_notes
    }));

    res.json({
      success: true,
      setoran: enriched,
      submissions: enriched,
      recentSubmissions: enriched,
      recentSetoran: enriched,
      list: enriched
    });
  } catch (error: any) {
    console.error('Error getTahfizSetoranList:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar setoran: ' + error.message });
  }
};

/**
 * 4c. Upload Berkas Audio Setoran Siswa (Multipart)
 */
export const uploadTahfizAudio = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Berkas audio tidak ditemukan.' });
    }
    const audioUrl = `/uploads/tahfiz_audio/${req.file.filename}`;
    res.json({
      success: true,
      message: 'Audio rekaman setoran berhasil diunggah.',
      audioUrl
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengunggah audio: ' + error.message });
  }
};

/**
 * 4d. Ambil Daftar Guru PAI untuk Pilihan Jadwal Temu Santri
 */
export const getPaiTeachersList = async (req: Request, res: Response) => {
  try {
    const teachers = await prisma.user.findMany({
      where: {
        role: 'TEACHER',
        isActive: true,
        OR: [
          { teachingSubject: { contains: 'PAI', mode: 'insensitive' } },
          { teachingSubject: { contains: 'Agama', mode: 'insensitive' } },
          { name: { contains: 'Munawir', mode: 'insensitive' } },
          { name: { contains: 'Brian', mode: 'insensitive' } },
          { name: { contains: 'Eny Astuti', mode: 'insensitive' } },
          { name: { contains: 'Maurik', mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        name: true,
        teachingSubject: true,
        username: true
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      success: true,
      teachers
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memuat daftar Guru PAI: ' + error.message });
  }
};

/**
 * 5. Penilaian Setoran oleh Guru PAI (Rubrik 5 Aspek & Hitung Nilai Otomatis)
 * Aspek:
 * 1. Kelancaran (25%)
 * 2. Ketepatan Ayat (25%)
 * 3. Tajwid (20%)
 * 4. Makharijul Huruf (20%)
 * 5. Kemandirian (10%)
 */
export const saveTahfizPenilaian = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !['TEACHER', 'ADMIN', 'OPERATOR'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Akses Ditolak: Hanya Guru PAI / Penguji yang berwenang memberikan penilaian Tahfiz. Siswa tidak diizinkan memilih atau mengisi penilaian sendiri.'
      });
    }

    const {
      setoranId,
      studentId,
      surahNumber,
      surahName,
      ayatStart = 1,
      ayatEnd,
      nilaiKelancaran = 85,
      nilaiKetepatanAyat = 85,
      nilaiTajwid = 80,
      nilaiMakharijulHuruf = 80,
      nilaiKemandirian = 90,
      catatanGuru,
      statusHafalan // 'LULUS_SETORAN', 'PERLU_MUROJAAH', 'TUNTAS_SESUAI_TARGET', 'SEDANG_DIHAFAL'
    } = req.body;

    if (!studentId || !surahNumber) {
      return res.status(400).json({ success: false, message: 'Data siswa dan nomor surat wajib disertakan.' });
    }

    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });

    // Ambil konfigurasi bobot rubrik
    const configRes: any[] = await safeRawQuery(`SELECT * FROM tahfiz_rubrik_config WHERE id = 'default'`);
    const cfg = configRes[0] || {
      bobot_kelancaran: 25,
      bobot_ketepatan_ayat: 25,
      bobot_tajwid: 20,
      bobot_makharijul_huruf: 20,
      bobot_kemandirian: 10,
      min_lulus_score: 75
    };

    const bK = Number(cfg.bobot_kelancaran || 25);
    const bKa = Number(cfg.bobot_ketepatan_ayat || 25);
    const bT = Number(cfg.bobot_tajwid || 20);
    const bMh = Number(cfg.bobot_makharijul_huruf || 20);
    const bKm = Number(cfg.bobot_kemandirian || 10);
    const totalBobot = bK + bKa + bT + bMh + bKm;

    const nK = Number(nilaiKelancaran);
    const nKa = Number(nilaiKetepatanAyat);
    const nT = Number(nilaiTajwid);
    const nMh = Number(nilaiMakharijulHuruf);
    const nKm = Number(nilaiKemandirian);

    // Hitung Nilai Akhir Otomatis
    const nilaiAkhir = Math.round(((nK * bK) + (nKa * bKa) + (nT * bT) + (nMh * bMh) + (nKm * bKm)) / (totalBobot || 100));

    // Tentukan status hafalan default jika tidak ditentukan manual
    let finalStatus = statusHafalan;
    if (!finalStatus) {
      if (nilaiAkhir >= Number(cfg.min_lulus_score || 75)) {
        finalStatus = 'LULUS_SETORAN';
      } else {
        finalStatus = 'PERLU_MUROJAAH';
      }
    }

    const todayStr = new Date().toISOString().substring(0, 10);
    const id = 'pen_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    // Simpan penilaian
    await safeRawExecute(`
      INSERT INTO tahfiz_penilaian (
        id, setoran_id, student_id, student_name, class_name, guru_id, guru_name,
        surah_number, surah_name, ayat_start, ayat_end,
        nilai_kelancaran, bobot_kelancaran,
        nilai_ketepatan_ayat, bobot_ketepatan_ayat,
        nilai_tajwid, bobot_tajwid,
        nilai_makharijul_huruf, bobot_makharijul_huruf,
        nilai_kemandirian, bobot_kemandirian,
        nilai_akhir, status_hafalan, catatan_guru, tanggal_penilaian
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      setoranId || null,
      student.id,
      student.name,
      student.className || '-',
      user?.id || 'GURU_PAI',
      user?.name || 'Guru PAI',
      Number(surahNumber),
      String(surahName),
      Number(ayatStart),
      Number(ayatEnd || 10),
      nK, bK,
      nKa, bKa,
      nT, bT,
      nMh, bMh,
      nKm, bKm,
      nilaiAkhir,
      finalStatus,
      catatanGuru || 'Alhamdulillah, setoran telah dinilai oleh Guru PAI.',
      todayStr
    );

    // Update status setoran jika ada
    if (setoranId) {
      await safeRawExecute(`
        UPDATE tahfiz_setoran 
        SET status = 'DINILAI', teacher_notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, catatanGuru || null, setoranId);
    }

    // Jika lulus setoran, jadwalkan Murojaah 2 minggu ke depan
    if (finalStatus === 'LULUS_SETORAN' || finalStatus === 'TUNTAS_SESUAI_TARGET') {
      const murojaahDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
      const mId = 'mur_' + Date.now();
      await safeRawExecute(`
        INSERT INTO tahfiz_murojaah (
          id, student_id, student_name, class_name, guru_id, surah_number, surah_name, jadwal_murojaah, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TERJADWAL')
      `, mId, student.id, student.name, student.className || '-', user?.id || 'GURU_PAI', Number(surahNumber), String(surahName), murojaahDate);
    }

    // Evaluasi Badge Prestasi Belajar Mandiri
    const totalLulusRes: any[] = await safeRawQuery(`
      SELECT COUNT(DISTINCT surah_number) as cnt FROM tahfiz_penilaian 
      WHERE student_id = ? AND status_hafalan IN ('LULUS_SETORAN', 'TUNTAS_SESUAI_TARGET')
    `, student.id);
    const totalLulus = Number(totalLulusRes[0]?.cnt || 0);

    if (totalLulus >= 5) {
      await awardBadgeIfNotExists(student.id, 'BADGE_5_SURAH', 'Bintang Tahfiz Pemula', '⭐', 'Telah menuntaskan hafalan 5 Surah Juz 30');
    }
    if (totalLulus >= 10) {
      await awardBadgeIfNotExists(student.id, 'BADGE_10_SURAH', 'Penghafal Tekun', '🌟', 'Telah menuntaskan hafalan 10 Surah Juz 30');
    }
    if (totalLulus >= 20) {
      await awardBadgeIfNotExists(student.id, 'BADGE_20_SURAH', 'Pejuang Juz 30', '🎖️', 'Telah menuntaskan separuh lebih Juz 30 (20 Surah)');
    }
    if (totalLulus >= 37) {
      await awardBadgeIfNotExists(student.id, 'BADGE_JUZ_30_COMPLETE', 'Hafiz Juz 30 Mutqin', '👑', 'Maa Syaa Allah! Telah menuntaskan seluruh 37 Surah Juz 30');
    }

    // Kirim notifikasi hasil setoran ke siswa & orang tua
    try {
      const notifTitle = `📖 Hasil Penilaian Tahfiz: Surat ${surahName}`;
      const notifMsg = `Alhamdulillah, ananda ${student.name} telah dinilai untuk hafalan Surat ${surahName}. Nilai Akhir: ${nilaiAkhir} (${finalStatus.replace(/_/g, ' ')}). Catatan: ${catatanGuru || '-'}`;
      await (prisma as any).notificationMessage.create({
        data: {
          recipientRole: 'STUDENT',
          studentId: student.id,
          studentName: student.name,
          className: student.className,
          title: notifTitle,
          message: notifMsg,
          category: 'EXAM'
        }
      });
      await sendFcmToUser(student.id, notifTitle, notifMsg, { type: 'TAHFIZ_SCORE', surah: surahName }).catch(() => {});
    } catch (_) {}

    res.json({
      success: true,
      message: `Penilaian hafalan Surat ${surahName} berhasil disimpan dengan Nilai Akhir: ${nilaiAkhir}!`,
      nilaiAkhir,
      statusHafalan: finalStatus
    });
  } catch (error: any) {
    console.error('Error saveTahfizPenilaian:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan penilaian: ' + error.message });
  }
};

async function awardBadgeIfNotExists(studentId: string, code: string, name: string, icon: string, desc: string) {
  try {
    const exists: any[] = await safeRawQuery(`
      SELECT id FROM tahfiz_prestasi WHERE student_id = ? AND badge_code = ?
    `, studentId, code);
    if (exists.length === 0) {
      const bId = 'bdg_' + Date.now();
      await safeRawExecute(`
        INSERT INTO tahfiz_prestasi (id, student_id, badge_code, badge_name, badge_icon, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `, bId, studentId, code, name, icon, desc);
    }
  } catch (_) {}
}

/**
 * 6. Murojaah & Uji Ulang (Jadwalkan & Catat Hasil Pengulangan)
 */
export const getMurojaahList = async (req: Request, res: Response) => {
  try {
    const { className, status = 'TERJADWAL' } = req.query;
    let whereSql = `WHERE status = '${String(status)}'`;
    if (className && className !== 'ALL') {
      whereSql += ` AND class_name = '${String(className)}'`;
    }

    const list: any[] = await safeRawQuery(`
      SELECT * FROM tahfiz_murojaah ${whereSql} ORDER BY jadwal_murojaah ASC
    `);

    res.json({ success: true, list });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memuat jadwal murojaah: ' + error.message });
  }
};

export const evaluateMurojaah = async (req: Request, res: Response) => {
  try {
    const { id, hasilUjiUlang, nilaiUjiUlang, catatanTindakLanjut } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'ID murojaah wajib diisi.' });

    await safeRawExecute(`
      UPDATE tahfiz_murojaah
      SET hasil_uji_ulang = ?, nilai_uji_ulang = ?, catatan_tindak_lanjut = ?, status = 'SELESAI', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, hasilUjiUlang || 'LANCAR', Number(nilaiUjiUlang) || 85, catatanTindakLanjut || null, id);

    res.json({ success: true, message: 'Hasil uji ulang murojaah berhasil dicatat!' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mencatat uji ulang: ' + error.message });
  }
};

/**
 * 7. Peta Progres Hafalan Kelas (Visual Grid 37 Surah per Siswa)
 */
export const getClassTahfizProgressMap = async (req: Request, res: Response) => {
  try {
    const className = String(req.query.className || 'VII-A').trim();

    const students = await prisma.user.findMany({
      where: { role: 'STUDENT', className },
      select: { id: true, name: true, nisn: true, className: true },
      orderBy: { name: 'asc' }
    });

    const surahs: any[] = await safeRawQuery(`SELECT number, name_latin FROM tahfiz_surah_master ORDER BY number ASC`);

    const studentIds = students.map(s => `'${s.id}'`).join(',');
    let penilaianMap = new Map<string, any>();
    const progressMap: Record<string, Record<number, any>> = {};

    if (studentIds) {
      const allPenilaian: any[] = await safeRawQuery(`
        SELECT student_id, surah_number, status_hafalan, nilai_akhir, tanggal_penilaian
        FROM tahfiz_penilaian
        WHERE student_id IN (${studentIds})
      `);

      allPenilaian.forEach(p => {
        const key = `${p.student_id}_${p.surah_number}`;
        if (!penilaianMap.has(key) || p.status_hafalan === 'LULUS_SETORAN' || p.status_hafalan === 'TUNTAS_SESUAI_TARGET') {
          penilaianMap.set(key, p);
        }
        if (!progressMap[p.student_id]) {
          progressMap[p.student_id] = {};
        }
        progressMap[p.student_id][p.surah_number] = p;
      });
    }

    const matrix = students.map(st => {
      let totalLulus = 0;
      const surahStatuses = surahs.map(s => {
        const p = penilaianMap.get(`${st.id}_${s.number}`);
        const stHafalan = p ? p.status_hafalan : 'BELUM_DIPELAJARI';
        if (stHafalan === 'LULUS_SETORAN' || stHafalan === 'TUNTAS_SESUAI_TARGET') totalLulus++;
        return {
          number: s.number,
          name: s.name_latin,
          status: stHafalan,
          score: p ? p.nilai_akhir : null
        };
      });

      return {
        studentId: st.id,
        studentName: st.name,
        nisn: st.nisn,
        totalLulus,
        percentage: Math.round((totalLulus / 37) * 100),
        surahs: surahStatuses
      };
    });

    res.json({
      success: true,
      className,
      totalStudents: students.length,
      students,
      progressMap,
      matrix
    });
  } catch (error: any) {
    console.error('Error getClassTahfizProgressMap:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat peta progres: ' + error.message });
  }
};

/**
 * 8. Riwayat dan Prestasi Siswa (Badge & Rekap Hafalanku)
 */
export const getStudentTahfizDetail = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const studentId = String(req.params.studentId || user?.id);

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, nisn: true, className: true }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });

    const evaluations: any[] = await safeRawQuery(`
      SELECT * FROM tahfiz_penilaian WHERE student_id = ? ORDER BY created_at DESC
    `, student.id);

    const badges: any[] = await safeRawQuery(`
      SELECT * FROM tahfiz_prestasi WHERE student_id = ? ORDER BY awarded_at DESC
    `, student.id);

    const murojaahs: any[] = await safeRawQuery(`
      SELECT * FROM tahfiz_murojaah WHERE student_id = ? ORDER BY jadwal_murojaah DESC
    `, student.id);

    const targets: any[] = await safeRawQuery(`
      SELECT * FROM tahfiz_target WHERE (class_name = ? OR student_id = ? OR target_type = 'SEKOLAH') AND status = 'AKTIF'
    `, student.className || '-', student.id);

    const setorans: any[] = (await safeRawQuery(`
      SELECT * FROM tahfiz_setoran WHERE student_id = ? ORDER BY created_at DESC
    `, student.id)).map(r => ({
      ...r,
      audio_url: r.audio_record_url,
      audioRecordUrl: r.audio_record_url,
      scheduledDate: r.scheduled_date,
      scheduledSession: r.scheduled_session,
      targetGuruId: r.target_guru_id,
      targetGuruName: r.target_guru_name,
      meetingLocation: r.meeting_location,
      studentNotes: r.student_notes
    }));

    res.json({
      success: true,
      student,
      evaluations,
      setorans,
      submissions: setorans,
      badges,
      murojaahs,
      targets
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memuat detail tahfiz siswa: ' + error.message });
  }
};

/**
 * 9. Ekspor Laporan Tahfiz ke Excel
 */
export const exportTahfizExcel = async (req: Request, res: Response) => {
  try {
    const className = String(req.query.className || 'ALL');
    const studentWhere: any = { role: 'STUDENT' };
    if (className !== 'ALL') studentWhere.className = className;

    const students = await prisma.user.findMany({
      where: studentWhere,
      select: { id: true, name: true, nisn: true, className: true },
      orderBy: { name: 'asc' }
    });

    const excelRows: any[] = [];
    for (let idx = 0; idx < students.length; idx++) {
      const s = students[idx];
      const countRes: any[] = await safeRawQuery(`
        SELECT COUNT(DISTINCT surah_number) as cnt, AVG(nilai_akhir) as avgScore 
        FROM tahfiz_penilaian 
        WHERE student_id = ? AND status_hafalan IN ('LULUS_SETORAN', 'TUNTAS_SESUAI_TARGET')
      `, s.id);

      const totalLulus = Number(countRes[0]?.cnt || 0);
      const avgScore = countRes[0]?.avgScore ? Math.round(Number(countRes[0].avgScore)) : 0;

      excelRows.push({
        'No': idx + 1,
        'NISN': s.nisn || '-',
        'Nama Lengkap Siswa': s.name,
        'Kelas': s.className || '-',
        'Surat Tuntas (Juz 30)': `${totalLulus} / 37 Surah`,
        'Persentase Ketuntasan': `${Math.round((totalLulus / 37) * 100)}%`,
        'Rata-rata Nilai Rubrik': avgScore,
        'Status Target Semester': totalLulus >= 10 ? 'TERCAPAI' : 'BELUM TERCAPAI'
      });
    }

    const ws = xlsx.utils.json_to_sheet(excelRows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Rekap_Tahfiz_Juz30');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Rekap_Tahfiz_Juz30_${className}_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).send('Gagal mengekspor data tahfiz: ' + error.message);
  }
};
