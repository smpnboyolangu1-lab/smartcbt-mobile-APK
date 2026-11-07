import { Request, Response } from 'express';
import prisma from '../utils/db';
import { formatTimeWib } from '../utils/dateUtils';
import { generateQuestionsWithGemini } from '../services/aiExamService';

// Helper untuk token acak 6 karakter
function generateUhToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  for (let i = 0; i < 6; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Helper shuffle array dengan seed
function shuffleArray<T>(array: T[], seed?: string): T[] {
  const arr = [...array];
  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    for (let i = arr.length - 1; i > 0; i--) {
      hash = (hash * 9301 + 49297) % 233280;
      const j = Math.abs(hash) % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Auto-close ulangan harian yang waktu berakhirnya (waktuSelesai) sudah lewat
 * Hitung skor akhir untuk siswa yang masih berstatus 'MENGERJAKAN'
 */
export const autoCloseExpiredUlanganHarian = async () => {
  try {
    const now = new Date();
    const expiredList = await (prisma as any).ulanganHarian.findMany({
      where: {
        status: 'AKTIF',
        waktuSelesai: {
          lte: now
        }
      },
      include: {
        submissions: {
          where: {
            status: 'MENGERJAKAN'
          }
        }
      }
    });

    for (const uh of expiredList) {
      let parsedSoal: any[] = [];
      try {
        parsedSoal = uh.soalJson ? JSON.parse(uh.soalJson) : [];
      } catch (e) {}

      if (Array.isArray(uh.submissions)) {
        for (const sub of uh.submissions) {
          let jawaban = {};
          try {
            jawaban = sub.jawabanJson ? JSON.parse(sub.jawabanJson) : {};
          } catch (e) {}

          let benar = 0;
          let salah = 0;
          parsedSoal.forEach((soal) => {
            const jwb = (jawaban as any)[soal.id];
            if (jwb && String(jwb).trim().toUpperCase() === String(soal.correctOption).trim().toUpperCase()) {
              benar++;
            } else {
              salah++;
            }
          });

          const bobotPerSoal = parsedSoal.length > 0 ? 100 / parsedSoal.length : 0;
          const skor = Math.round(benar * bobotPerSoal);

          await (prisma as any).ulanganHarianSubmission.update({
            where: { id: sub.id },
            data: {
              status: 'SELESAI',
              waktuSelesai: sub.waktuSelesai || now,
              totalBenar: benar,
              totalSalah: salah,
              nilai: skor
            }
          }).catch(() => {});
        }
      }

      await (prisma as any).ulanganHarian.update({
        where: { id: uh.id },
        data: {
          status: 'SELESAI'
        }
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Error auto-closing expired Ulangan Harian:', err);
  }
};

// -------------------------------------------------------------
// GURU CONTROLLERS
// -------------------------------------------------------------

/**
 * Guru memulai Ulangan Harian baru (Mode: KILAT, STANDAR, CBT_MINI)
 */
export const mulaiUlanganHarian = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      kelasId,
      mapelId,
      topik,
      mode = 'KILAT',
      durasiMenit = 15,
      totalSoal = 10,
      bobotNilai = 100,
      sumberSoal = 'BANK_SOAL',
      soalList = [],
      waktuMulai: customWaktuMulai,
      waktuSelesai: customWaktuSelesai,
      jadwalMulai,
      jadwalSelesai
    } = req.body;

    if (!kelasId || !mapelId || !topik) {
      return res.status(400).json({
        success: false,
        message: 'Parameter kelasId, mapelId, dan topik wajib diisi'
      });
    }

    // Validasi ketat kelas ampu guru (Mendukung multi-kelas terpisah koma e.g. "VII-A,VII-B")
    if (user && user.role === 'TEACHER' && user.teachingClasses) {
      let allowed: string[] = [];
      try {
        allowed = user.teachingClasses.startsWith('[')
          ? JSON.parse(user.teachingClasses)
          : user.teachingClasses.split(',').map((c: string) => c.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } catch (e) {
        allowed = user.teachingClasses.split(',').map((c: string) => c.trim());
      }
      const requestedClasses = String(kelasId).split(',').map((c: string) => c.trim()).filter(Boolean);
      const allowedUpper = allowed.map(a => a.toUpperCase());
      const invalidClasses = requestedClasses.filter(rc => !allowedUpper.includes(rc.toUpperCase()) && rc.toUpperCase() !== 'ALL');
      if (allowed.length > 0 && invalidClasses.length > 0) {
        return res.status(403).json({
          success: false,
          message: `Akses ditolak! Kelas (${invalidClasses.join(', ')}) bukan kelas ampu Anda (${allowed.join(', ')})`
        });
      }
    }

    let finalSoalList: any[] = [];
    const targetCount = Number(totalSoal) || (mode === 'KILAT' ? 5 : mode === 'CBT_MINI' ? 20 : 10);

    if (sumberSoal === 'MANUAL' && Array.isArray(soalList) && soalList.length > 0) {
      finalSoalList = soalList;
    } else if (sumberSoal === 'AI_GEMINI') {
      try {
        const aiQuestions = await generateQuestionsWithGemini({
          subject: String(mapelId),
          topic: String(topik),
          grade: kelasId ? (String(kelasId).startsWith('VIII') ? 'Kelas VIII' : String(kelasId).startsWith('IX') ? 'Kelas IX' : 'Kelas VII') : 'Kelas VII',
          count: targetCount,
          difficulty: mode === 'KILAT' ? 'Mudah' : 'Sedang',
          type: 'MULTIPLE_CHOICE'
        });
        if (Array.isArray(aiQuestions) && aiQuestions.length > 0) {
          finalSoalList = aiQuestions.map((q, idx) => {
            const opts = q.options ? [q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || ''].filter(Boolean) : [];
            return {
              id: `ai_${idx + 1}`,
              number: idx + 1,
              type: q.type || 'PG',
              content: q.content,
              options: opts.length > 0 ? opts : ['A', 'B', 'C', 'D'],
              correctOption: q.correctOption || 'A',
              explanation: q.explanation || 'Pembahasan terstruktur AI Kurikulum Merdeka.',
              points: Math.round((Number(bobotNilai) || 100) / aiQuestions.length)
            };
          });
        }
      } catch (aiErr) {
        console.warn('AI question generation fallback:', aiErr);
      }
    } else if (sumberSoal === 'BANK_SOAL') {
      // 1. Cek BankSoal Terpadu
      const bankSoalDb = await prisma.bankSoal.findMany({
        where: {
          subjectName: { contains: String(mapelId), mode: 'insensitive' as any }
        },
        take: targetCount
      });

      if (bankSoalDb.length > 0) {
        finalSoalList = bankSoalDb.map((b: any, idx: number) => {
          let opts: any[] = [];
          try {
            const parsed = b.options ? JSON.parse(b.options) : ['A', 'B', 'C', 'D'];
            if (Array.isArray(parsed)) opts = parsed;
            else if (typeof parsed === 'object' && parsed !== null) {
              opts = [parsed.A || parsed.a || '', parsed.B || parsed.b || '', parsed.C || parsed.c || '', parsed.D || parsed.d || ''].filter(Boolean);
            }
          } catch (e) {
            opts = ['A', 'B', 'C', 'D'];
          }
          return {
            id: b.id || `soal_${idx + 1}`,
            number: idx + 1,
            type: b.type || 'PG',
            content: b.content,
            options: opts.length > 0 ? opts : ['A', 'B', 'C', 'D'],
            correctOption: b.correctOption || 'A',
            explanation: b.explanation || 'Pembahasan soal materi terkait.',
            points: Math.round((Number(bobotNilai) || 100) / bankSoalDb.length)
          };
        });
      }

      // 2. Jika masih kurang dari targetCount, ambil dari Question paket Exam CBT mata pelajaran terkait
      if (finalSoalList.length < targetCount) {
        try {
          const examQuestions = await prisma.question.findMany({
            where: {
              exam: {
                subject: {
                  name: { contains: String(mapelId), mode: 'insensitive' as any }
                }
              }
            },
            orderBy: { id: 'desc' },
            take: targetCount - finalSoalList.length
          });
          for (const eq of examQuestions) {
            let opts: string[] = [];
            try {
              const parsed = eq.options ? JSON.parse(eq.options) : [];
              if (Array.isArray(parsed)) opts = parsed.map(String);
              else if (typeof parsed === 'object' && parsed !== null) {
                opts = [parsed.A || parsed.a || '', parsed.B || parsed.b || '', parsed.C || parsed.c || '', parsed.D || parsed.d || ''].filter(Boolean);
              }
            } catch {}
            finalSoalList.push({
              id: eq.id || `soal_${finalSoalList.length + 1}`,
              number: finalSoalList.length + 1,
              type: eq.type === 'ESSAY' ? 'URAIAN' : 'PG',
              content: eq.content,
              options: opts.length > 0 ? opts : ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'],
              correctOption: eq.correctOption || 'A',
              explanation: eq.explanation || `Pembahasan materi ${topik} (${mapelId}).`,
              imageUrl: eq.imageUrl || null,
              audioUrl: eq.audioUrl || null,
              points: 10
            });
          }
        } catch (eqErr) {
          console.warn('Exam Question fallback error:', eqErr);
        }
      }

      // 3. Jika masih kurang, cek riwayat UlanganHarian sebelumnya pada mapel yang sama
      if (finalSoalList.length < targetCount) {
        try {
          const prevUhs = await (prisma as any).ulanganHarian.findMany({
            where: {
              mapelId: { contains: String(mapelId), mode: 'insensitive' as any }
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          });
          for (const puh of prevUhs) {
            if (finalSoalList.length >= targetCount) break;
            try {
              const pList = puh.soalJson ? JSON.parse(puh.soalJson) : [];
              if (Array.isArray(pList)) {
                for (const pq of pList) {
                  if (finalSoalList.length >= targetCount) break;
                  if (pq && pq.content && !String(pq.content).startsWith('Pertanyaan butir ')) {
                    finalSoalList.push({
                      ...pq,
                      id: `soal_${finalSoalList.length + 1}`,
                      number: finalSoalList.length + 1
                    });
                  }
                }
              }
            } catch {}
          }
        } catch {}
      }

      // 4. Jika masih kosong juga, coba generate dengan AI Gemini otomatis
      if (finalSoalList.length === 0) {
        try {
          const aiFallback = await generateQuestionsWithGemini({
            subject: String(mapelId),
            topic: String(topik),
            grade: String(kelasId).startsWith('VIII') ? 'Kelas VIII' : String(kelasId).startsWith('IX') ? 'Kelas IX' : 'Kelas VII',
            count: targetCount,
            difficulty: 'Sedang',
            type: 'MULTIPLE_CHOICE'
          });
          if (Array.isArray(aiFallback) && aiFallback.length > 0) {
            finalSoalList = aiFallback.map((q, idx) => {
              const opts = q.options ? [q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || ''].filter(Boolean) : [];
              return {
                id: `ai_${idx + 1}`,
                number: idx + 1,
                type: q.type || 'PG',
                content: q.content,
                options: opts.length > 0 ? opts : ['A', 'B', 'C', 'D'],
                correctOption: q.correctOption || 'A',
                explanation: q.explanation || `Pembahasan materi ${topik}.`,
                points: Math.round((Number(bobotNilai) || 100) / aiFallback.length)
              };
            });
          }
        } catch {}
      }

      // Re-index points merata
      if (finalSoalList.length > 0) {
        const ptsPerItem = Math.round((Number(bobotNilai) || 100) / finalSoalList.length);
        finalSoalList = finalSoalList.map((item, i) => ({
          ...item,
          id: item.id || `soal_${i + 1}`,
          number: i + 1,
          points: ptsPerItem
        }));
      }
    }

    // Template soal jika bank soal belum diisi
    if (finalSoalList.length === 0) {
      const jumlah = Number(totalSoal) || (mode === 'KILAT' ? 5 : mode === 'CBT_MINI' ? 20 : 10);
      for (let i = 1; i <= jumlah; i++) {
        finalSoalList.push({
          id: `soal_${i}`,
          number: i,
          type: 'PG',
          content: `Pertanyaan butir ${i} tentang ${topik} (${mapelId}). Perhatikan konsep dasar yang dipelajari pada materi ini.`,
          options: [
            `A. Konsep utama ${topik} bagian I`,
            `B. Konsep pendukung ${topik} bagian II`,
            `C. Penerapan praktis ${topik} dalam kehidupan nyata`,
            `D. Kesimpulan komprehensif materi ${topik}`
          ],
          correctOption: 'A',
          explanation: `Jawaban A benar karena sesuai dengan prinsip dasar materi ${topik}.`,
          points: Math.round((Number(bobotNilai) || 100) / jumlah)
        });
      }
    }

    // Token generator untuk mode CBT_MINI
    let tokenAktif: string | null = null;
    let tokenExpiresAt: Date | null = null;
    if (mode === 'CBT_MINI') {
      tokenAktif = generateUhToken();
      tokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 menit rotasi
    }

    const durasi = Number(durasiMenit) || 15;
    let waktuMulai = new Date();
    const rawMulai = customWaktuMulai || jadwalMulai;
    if (rawMulai) {
      const parsedMulai = new Date(rawMulai);
      if (!isNaN(parsedMulai.getTime())) {
        waktuMulai = parsedMulai;
      }
    }
    let waktuSelesai = new Date(waktuMulai.getTime() + durasi * 60 * 1000);
    const rawSelesai = customWaktuSelesai || jadwalSelesai;
    if (rawSelesai) {
      const parsedSelesai = new Date(rawSelesai);
      if (!isNaN(parsedSelesai.getTime())) {
        waktuSelesai = parsedSelesai;
      }
    }

    const uh = await (prisma as any).ulanganHarian.create({
      data: {
        guruId: user?.id || 'GURU_SYS',
        guruName: user?.name || 'Guru Pengampu',
        mapelId: String(mapelId),
        kelasId: String(kelasId),
        topik: String(topik),
        mode: String(mode),
        durasiMenit: durasi,
        totalSoal: finalSoalList.length,
        bobotNilai: Number(bobotNilai) || 100,
        waktuMulai,
        waktuSelesai,
        status: 'AKTIF',
        tokenAktif,
        tokenExpiresAt,
        soalJson: JSON.stringify(finalSoalList)
      }
    });

    // SINKRONISASI DUA ARAH (APK -> PORTAL CBT): Buat Exam & Question resmi agar langsung bisa diedit di Portal Web!
    try {
      const subName = String(mapelId).trim();
      let subject = await prisma.subject.findFirst({
        where: { name: { contains: subName, mode: 'insensitive' } }
      });
      if (!subject) {
        subject = await prisma.subject.create({
          data: { name: subName }
        });
      }

      const syncToken = tokenAktif || (Math.random().toString(36).substring(2, 7).toUpperCase());
      const classStr = Array.isArray(kelasId) ? kelasId.join(',') : String(kelasId);

      await prisma.exam.upsert({
        where: { id: uh.id },
        create: {
          id: uh.id,
          title: `[UH] ${subName} — ${topik}`,
          packageCode: `UH-${mode || 'CBT'}`,
          subjectId: subject.id,
          durationMinutes: durasi,
          minDurationMinutes: Math.min(15, durasi),
          token: syncToken,
          isTokenActive: Boolean(tokenAktif),
          status: 'PUBLISHED',
          assignedClasses: classStr,
          sessionName: `Sesi UH Mode ${mode}`,
          roomName: 'Ruang Kelas',
          proctorName: user?.name || 'Guru Mapel',
          passingGrade: 75,
          level: classStr.startsWith('VIII') ? 'VIII' : classStr.startsWith('IX') ? 'IX' : 'VII',
          examType: 'UH',
          executionDate: waktuMulai.toISOString().split('T')[0],
          startTimeStr: String(waktuMulai.getHours()).padStart(2, '0') + ':' + String(waktuMulai.getMinutes()).padStart(2, '0'),
          endTimeStr: String(waktuSelesai.getHours()).padStart(2, '0') + ':' + String(waktuSelesai.getMinutes()).padStart(2, '0'),
          teacherId: user?.id || null,
          authorTeacherIds: user?.id ? JSON.stringify([user.id]) : null,
          randomizeQuestions: true,
          randomizeOptions: true,
          showScoreToStudent: true
        },
        update: {
          title: `[UH] ${subName} — ${topik}`,
          assignedClasses: classStr,
          durationMinutes: durasi,
          status: 'PUBLISHED'
        }
      });

      await prisma.question.deleteMany({ where: { examId: uh.id } }).catch(() => null);
      for (let i = 0; i < finalSoalList.length; i++) {
        const q = finalSoalList[i];
        let optsStr: string | null = null;
        if (q.options) {
          if (Array.isArray(q.options)) {
            const obj: Record<string, string> = {};
            const labels = ['A', 'B', 'C', 'D', 'E'];
            q.options.slice(0, 4).forEach((optVal: any, optIdx: number) => {
              const cleanedText = String(typeof optVal === 'object' && optVal !== null ? (optVal.text || optVal.content || JSON.stringify(optVal)) : optVal)
                .replace(/^[A-Ea-e][\.\)]\s*/, '')
                .trim();
              obj[labels[optIdx]] = cleanedText;
            });
            optsStr = JSON.stringify(obj);
          } else if (typeof q.options === 'object' && q.options !== null) {
            optsStr = JSON.stringify(q.options);
          } else {
            optsStr = String(q.options);
          }
        }
        await prisma.question.create({
          data: {
            examId: uh.id,
            type: (q.type === 'URAIAN' || q.type === 'ESSAY') ? 'ESSAY' : 'MULTIPLE_CHOICE',
            content: q.content || q.questionText || '',
            options: optsStr,
            correctOption: String(q.correctOption || q.correctAnswer || 'A').toUpperCase().trim(),
            explanation: q.explanation || '',
            imageUrl: q.imageUrl || null,
            audioUrl: q.audioUrl || null,
            orderNum: q.number || (i + 1)
          }
        }).catch(() => null);
      }
    } catch (syncErr) {
      console.warn('Error two-way syncing UH to Exam/Question:', syncErr);
    }

    return res.status(201).json({
      success: true,
      message: `Ulangan Harian Mode ${mode} berhasil dimulai untuk kelas ${kelasId}`,
      data: {
        id: uh.id,
        topik: uh.topik,
        mode: uh.mode,
        kelasId: uh.kelasId,
        durasiMenit: uh.durasiMenit,
        totalSoal: uh.totalSoal,
        tokenAktif: uh.tokenAktif,
        tokenExpiresAt: uh.tokenExpiresAt,
        waktuMulai: uh.waktuMulai,
        waktuSelesai: uh.waktuSelesai
      }
    });
  } catch (error: any) {
    console.error('Error mulaiUlanganHarian:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memulai ulangan harian: ' + error.message
    });
  }
};

/**
 * Daftar seluruh Ulangan Harian yang dibuat oleh Guru
 */
export const getDaftarUhGuru = async (req: Request, res: Response) => {
  try {
    await autoCloseExpiredUlanganHarian();
    const user = (req as any).user;
    const uhList = await (prisma as any).ulanganHarian.findMany({
      where: {
        ...(user.role === 'TEACHER' ? { guruId: user.id } : {})
      },
      include: {
        submissions: {
          select: {
            id: true,
            status: true,
            nilai: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      success: true,
      data: uhList
    });
  } catch (error: any) {
    console.error('Error getDaftarUhGuru:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil daftar ulangan harian: ' + error.message
    });
  }
};

/**
 * Monitoring status real-time Ulangan Harian untuk Guru
 */
export const getMonitoringUhGuru = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const uh = await (prisma as any).ulanganHarian.findUnique({
      where: { id },
      include: {
        submissions: true
      }
    });

    if (!uh) {
      return res.status(404).json({
        success: false,
        message: 'Ulangan harian tidak ditemukan'
      });
    }

    const classList = uh.kelasId ? uh.kelasId.split(',').map((c: string) => c.trim()) : [];
    const siswaKelas = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        OR: [
          { className: { in: classList } },
          { classId: { in: classList } },
          { className: uh.kelasId },
          { classId: uh.kelasId }
        ]
      },
      select: {
        id: true,
        name: true,
        username: true,
        nisn: true,
        className: true
      },
      orderBy: { name: 'asc' }
    });

    const submissionMap = new Map();
    if (Array.isArray(uh.submissions)) {
      uh.submissions.forEach((sub: any) => {
        submissionMap.set(sub.siswaId, sub);
      });
    }

    let countSelesai = 0;
    let countMengerjakan = 0;
    let countBelumMulai = 0;
    let countInsidenCurang = 0;
    let totalNilai = 0;

    const siswaStatusList = siswaKelas.map((s) => {
      const sub = submissionMap.get(s.id);
      if (!sub) {
        countBelumMulai++;
        return {
          siswaId: s.id,
          nama: s.name,
          username: s.username,
          nisn: s.nisn || s.username,
          className: s.className || uh.kelasId,
          status: 'BELUM_MULAI',
          progress: '0/' + uh.totalSoal,
          dijawabCount: 0,
          totalSoal: uh.totalSoal,
          kurangCount: uh.totalSoal,
          posisiSoal: 1,
          nilai: null,
          insidenCount: 0,
          waktuMulai: null,
          waktuSelesai: null,
          jawabanJson: null
        };
      }

      let parsedJawab: any = {};
      try {
        parsedJawab = sub.jawabanJson ? JSON.parse(sub.jawabanJson) : {};
      } catch (e) {}

      let dijawabCount = 0;
      let lastNo = 0;
      if (typeof parsedJawab === 'object' && parsedJawab !== null) {
        Object.keys(parsedJawab).forEach(k => {
          const v = (parsedJawab as any)[k];
          if (v !== null && v !== undefined && String(v).trim() !== '') {
            dijawabCount++;
            const num = parseInt(k.replace(/\D/g, ''), 10);
            if (!isNaN(num) && num > lastNo) lastNo = num;
          }
        });
      }

      const totalSoal = uh.totalSoal || 0;
      const kurangCount = Math.max(0, totalSoal - dijawabCount);
      const posisiSoal = lastNo > 0 ? (dijawabCount < totalSoal ? lastNo + 1 : lastNo) : (dijawabCount > 0 ? dijawabCount : 1);

      if (sub.status === 'SELESAI') {
        countSelesai++;
        totalNilai += sub.nilai || 0;
      } else if (sub.status === 'TERKUNCI_CURANG') {
        countInsidenCurang++;
      } else {
        countMengerjakan++;
      }

      return {
        submissionId: sub.id,
        siswaId: s.id,
        nama: s.name,
        username: s.username,
        nisn: s.nisn || s.username,
        className: s.className || sub.kelasId || uh.kelasId,
        status: sub.status,
        progress: `${dijawabCount}/${uh.totalSoal}`,
        dijawabCount,
        totalSoal: uh.totalSoal,
        kurangCount,
        posisiSoal,
        nilai: sub.nilai,
        totalBenar: sub.totalBenar,
        totalSalah: sub.totalSalah,
        insidenCount: sub.insidenCount,
        waktuMulai: sub.waktuMulai,
        waktuSelesai: sub.waktuSelesai,
        jawabanJson: sub.jawabanJson
      };
    });

    const rataRata = countSelesai > 0 ? Math.round((totalNilai / countSelesai) * 10) / 10 : 0;
    let parsedSoalList: any[] = [];
    try {
      parsedSoalList = uh.soalJson ? JSON.parse(uh.soalJson) : [];
    } catch {}

    const hadirCount = countSelesai + countMengerjakan;
    const persentaseHadir = siswaKelas.length > 0 ? Math.round((hadirCount / siswaKelas.length) * 1000) / 10 : 0;

    return res.json({
      success: true,
      data: {
        uh: {
          id: uh.id,
          topik: uh.topik,
          mapel: uh.mapelId,
          kelas: uh.kelasId,
          mode: uh.mode,
          status: uh.status,
          durasiMenit: uh.durasiMenit,
          totalSoal: uh.totalSoal,
          tokenAktif: uh.tokenAktif,
          tokenExpiresAt: uh.tokenExpiresAt,
          waktuMulai: uh.waktuMulai,
          waktuSelesai: uh.waktuSelesai,
          soalList: parsedSoalList
        },
        stats: {
          totalSiswa: siswaKelas.length,
          selesai: countSelesai,
          sedangMengerjakan: countMengerjakan,
          belumMulai: countBelumMulai,
          hadirCount,
          persentaseHadir,
          insidenCurang: countInsidenCurang,
          rataRata
        },
        siswa: siswaStatusList
      }
    });
  } catch (error: any) {
    console.error('Error getMonitoringUhGuru:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat monitoring ulangan: ' + error.message
    });
  }
};

/**
 * Guru melakukan rotate token (Mode CBT Mini)
 */
export const rotateTokenUh = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const newToken = generateUhToken();
    const tokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const updated = await (prisma as any).ulanganHarian.update({
      where: { id },
      data: {
        tokenAktif: newToken,
        tokenExpiresAt
      }
    });

    return res.json({
      success: true,
      message: 'Token berhasil di-refresh',
      data: {
        tokenAktif: updated.tokenAktif,
        tokenExpiresAt: updated.tokenExpiresAt
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Gagal refresh token: ' + error.message
    });
  }
};

/**
 * Guru mengakhiri ulangan harian
 */
export const akhiriUlanganHarian = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const uh = await (prisma as any).ulanganHarian.findUnique({
      where: { id },
      include: { submissions: true }
    });

    if (!uh) {
      return res.status(404).json({
        success: false,
        message: 'Ulangan harian tidak ditemukan'
      });
    }

    let parsedSoal: any[] = [];
    try {
      parsedSoal = uh.soalJson ? JSON.parse(uh.soalJson) : [];
    } catch (e) {}

    if (Array.isArray(uh.submissions)) {
      for (const sub of uh.submissions) {
        if (sub.status === 'MENGERJAKAN') {
          let jawaban = {};
          try {
            jawaban = sub.jawabanJson ? JSON.parse(sub.jawabanJson) : {};
          } catch (e) {}

          let benar = 0;
          let salah = 0;
          parsedSoal.forEach((soal) => {
            const jwb = (jawaban as any)[soal.id];
            if (jwb && String(jwb).trim().toUpperCase() === String(soal.correctOption).trim().toUpperCase()) {
              benar++;
            } else {
              salah++;
            }
          });

          const bobotPerSoal = parsedSoal.length > 0 ? 100 / parsedSoal.length : 0;
          const skor = Math.round(benar * bobotPerSoal);

          await (prisma as any).ulanganHarianSubmission.update({
            where: { id: sub.id },
            data: {
              status: 'SELESAI',
              waktuSelesai: new Date(),
              totalBenar: benar,
              totalSalah: salah,
              nilai: skor
            }
          });
        }
      }
    }

    const updated = await (prisma as any).ulanganHarian.update({
      where: { id },
      data: {
        status: 'SELESAI',
        waktuSelesai: new Date()
      }
    });

    return res.json({
      success: true,
      message: 'Ulangan harian telah berhasil diakhiri dan seluruh nilai siswa telah direkap.',
      data: updated
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Gagal mengakhiri ulangan harian: ' + error.message
    });
  }
};

/**
 * Rekap Hasil Lengkap & Analisis Butir Soal untuk Portal/APK Guru
 */
export const getRekapHasilUh = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const uh = await (prisma as any).ulanganHarian.findUnique({
      where: { id },
      include: {
        submissions: {
          orderBy: { nilai: 'desc' }
        }
      }
    });

    if (!uh) {
      return res.status(404).json({
        success: false,
        message: 'Ulangan harian tidak ditemukan'
      });
    }

    let parsedSoal: any[] = [];
    try {
      parsedSoal = uh.soalJson ? JSON.parse(uh.soalJson) : [];
    } catch (e) {}

    const submissions: any[] = uh.submissions || [];
    const totalPeserta = submissions.length;

    let nilaiList: number[] = [];
    let tuntasCount = 0;
    const kkm = 75;

    const analisisSoal: { [soalId: string]: { id: string; number: number; content: string; benar: number; salah: number; persentaseBenar: number } } = {};
    parsedSoal.forEach((s) => {
      analisisSoal[s.id] = {
        id: s.id,
        number: s.number,
        content: s.content,
        benar: 0,
        salah: 0,
        persentaseBenar: 0
      };
    });

    submissions.forEach((sub) => {
      const n = sub.nilai || 0;
      nilaiList.push(n);
      if (n >= kkm) tuntasCount++;

      let jwb: any = {};
      try {
        jwb = sub.jawabanJson ? JSON.parse(sub.jawabanJson) : {};
      } catch (e) {}

      parsedSoal.forEach((s) => {
        if (analisisSoal[s.id]) {
          const userAns = jwb[s.id];
          if (userAns && String(userAns).trim().toUpperCase() === String(s.correctOption).trim().toUpperCase()) {
            analisisSoal[s.id].benar++;
          } else {
            analisisSoal[s.id].salah++;
          }
        }
      });
    });

    const itemAnalysis = Object.values(analisisSoal).map((item) => {
      const pct = totalPeserta > 0 ? Math.round((item.benar / totalPeserta) * 100) : 0;
      return {
        ...item,
        persentaseBenar: pct,
        kategori: pct < 40 ? 'SULIT' : pct > 75 ? 'MUDAH' : 'SEDANG'
      };
    });

    const soalTersulit = [...itemAnalysis].sort((a, b) => a.persentaseBenar - b.persentaseBenar);
    const nilaiTertinggi = nilaiList.length > 0 ? Math.max(...nilaiList) : 0;
    const nilaiTerendah = nilaiList.length > 0 ? Math.min(...nilaiList) : 0;
    const rataRata = nilaiList.length > 0 ? Math.round((nilaiList.reduce((a, b) => a + b, 0) / nilaiList.length) * 10) / 10 : 0;
    const persentaseKetuntasan = totalPeserta > 0 ? Math.round((tuntasCount / totalPeserta) * 100) : 0;

    const distribusi = {
      sangatKurang: nilaiList.filter((n) => n < 50).length,
      kurang: nilaiList.filter((n) => n >= 50 && n < 70).length,
      cukup: nilaiList.filter((n) => n >= 70 && n < 85).length,
      sangatBaik: nilaiList.filter((n) => n >= 85).length
    };

    return res.json({
      success: true,
      data: {
        uhInfo: {
          id: uh.id,
          topik: uh.topik,
          mapel: uh.mapelId,
          kelas: uh.kelasId,
          mode: uh.mode,
          durasiMenit: uh.durasiMenit,
          totalSoal: uh.totalSoal,
          status: uh.status,
          waktuMulai: uh.waktuMulai,
          waktuSelesai: uh.waktuSelesai
        },
        ringkasan: {
          totalPeserta,
          rataRata,
          nilaiTertinggi,
          nilaiTerendah,
          kkm,
          jumlahTuntas: tuntasCount,
          persentaseKetuntasan,
          distribusi
        },
        analisisButirSoal: itemAnalysis,
        soalTersulit: soalTersulit.slice(0, 3),
        daftarNilaiSiswa: submissions.map((sub: any, idx: number) => ({
          ranking: idx + 1,
          siswaId: sub.siswaId,
          nama: sub.siswaName,
          nilai: sub.nilai,
          totalBenar: sub.totalBenar,
          totalSalah: sub.totalSalah,
          insidenCount: sub.insidenCount,
          status: sub.status,
          waktuSelesai: sub.waktuSelesai
        }))
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat rekap hasil: ' + error.message
    });
  }
};

/**
 * 1. Import Soal Ulangan Harian dari Spreadsheet Excel (.xlsx / .xls / .csv)
 */
export const importSoalExcelUh = async (req: Request, res: Response) => {
  try {
    const xlsx = await import('xlsx');
    let buffer: Buffer | null = null;

    if ((req as any).file && (req as any).file.buffer) {
      buffer = (req as any).file.buffer;
    } else if (req.body.fileBase64) {
      buffer = Buffer.from(req.body.fileBase64.replace(/^data:.*;base64,/, ''), 'base64');
    }

    if (!buffer && (!req.body.rows || !Array.isArray(req.body.rows))) {
      return res.status(400).json({
        success: false,
        message: 'Berkas Excel (.xlsx / .xls) atau data baris tabel wajib diunggah.'
      });
    }

    let rawRows: any[] = [];
    if (buffer) {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      rawRows = xlsx.utils.sheet_to_json(sheet);
    } else {
      rawRows = req.body.rows;
    }

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'Lembar spreadsheet kosong atau tidak terbaca.' });
    }

    const parsedSoalList: any[] = [];
    rawRows.forEach((row: any, idx: number) => {
      // Normalisasi nama kolom yang fleksibel dan aman (mencegah salah deteksi opsi karena partial includes)
      const keys = Object.keys(row);
      const findVal = (exactList: string[], partialList: string[] = []) => {
        const normalizedKeys = keys.map(k => ({ raw: k, norm: k.trim().toLowerCase() }));
        // 1. Coba exact match terlebih dahulu
        for (const target of exactList) {
          const match = normalizedKeys.find(nk => nk.norm === target.toLowerCase());
          if (match && row[match.raw] !== undefined && row[match.raw] !== null && String(row[match.raw]).trim() !== '') {
            return String(row[match.raw]).trim();
          }
        }
        // 2. Coba partial match yang aman
        for (const target of partialList) {
          const match = normalizedKeys.find(nk => nk.norm.includes(target.toLowerCase()));
          if (match && row[match.raw] !== undefined && row[match.raw] !== null && String(row[match.raw]).trim() !== '') {
            return String(row[match.raw]).trim();
          }
        }
        return '';
      };

      const content = findVal(
        ['soal', 'pertanyaan', 'naskah', 'teks', 'question', 'content', 'isi'],
        ['soal', 'pertanyaan', 'naskah', 'question']
      );
      if (!content) return;

      const optA = findVal(['a', 'opsi a', 'pilihan a', 'opt_a', 'option a', 'opt a'], ['opsi a', 'pilihan a', 'option a']);
      const optB = findVal(['b', 'opsi b', 'pilihan b', 'opt_b', 'option b', 'opt b'], ['opsi b', 'pilihan b', 'option b']);
      const optC = findVal(['c', 'opsi c', 'pilihan c', 'opt_c', 'option c', 'opt c'], ['opsi c', 'pilihan c', 'option c']);
      const optD = findVal(['d', 'opsi d', 'pilihan d', 'opt_d', 'option d', 'opt d'], ['opsi d', 'pilihan d', 'option d']);
      const optE = findVal(['e', 'opsi e', 'pilihan e', 'opt_e', 'option e', 'opt e'], ['opsi e', 'pilihan e', 'option e']);

      let rawKey = findVal(
        ['kunci', 'jawaban', 'kunci jawaban', 'correct', 'key', 'jawaban benar', 'kunci_jawaban'],
        ['kunci', 'jawaban benar', 'correct', 'key']
      ).toUpperCase();

      let correctOpt = 'A';
      const matchOptLetter = rawKey.match(/[A-E]/);
      if (matchOptLetter) {
        correctOpt = matchOptLetter[0];
      }

      const rawType = findVal(['tipe', 'bentuk', 'type'], ['tipe', 'bentuk']).toUpperCase();
      let type = 'PG';
      if (rawType.includes('URAIAN') || rawType.includes('ESSAY')) type = 'ESSAY';
      else if (rawType.includes('ISIAN') || rawType.includes('SINGKAT')) type = 'ISIAN';
      else if (rawType.includes('BENAR') || rawType.includes('SALAH') || rawType === 'BS') type = 'BENAR_SALAH';

      const explanation = findVal(
        ['pembahasan', 'penjelasan', 'alasan', 'explanation'],
        ['pembahasan', 'penjelasan']
      ) || 'Pembahasan terstandar.';

      const rawPoints = findVal(['bobot', 'poin', 'points', 'nilai'], ['bobot', 'poin']);
      const points = rawPoints ? Number(rawPoints) : 10;

      let options: string[] = [];
      if (type === 'BENAR_SALAH') {
        options = ['A. Benar', 'B. Salah'];
      } else {
        options = [
          optA ? (optA.match(/^[A-E]\./i) ? optA : `A. ${optA}`) : 'A. Pilihan A',
          optB ? (optB.match(/^[A-E]\./i) ? optB : `B. ${optB}`) : 'B. Pilihan B',
          optC ? (optC.match(/^[A-E]\./i) ? optC : `C. ${optC}`) : 'C. Pilihan C',
          optD ? (optD.match(/^[A-E]\./i) ? optD : `D. ${optD}`) : 'D. Pilihan D'
        ];
        if (optE) {
          options.push(optE.match(/^[A-E]\./i) ? optE : `E. ${optE}`);
        }
      }

      parsedSoalList.push({
        id: `soal_excel_${idx + 1}_${Date.now()}`,
        number: idx + 1,
        type,
        content,
        options,
        correctOption: correctOpt,
        explanation,
        points: points || 10
      });
    });

    if (parsedSoalList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada butir soal yang valid. Pastikan kolom memuat "Pertanyaan" dan opsi pilihan A-D.'
      });
    }

    return res.json({
      success: true,
      message: `Berhasil mengimpor ${parsedSoalList.length} butir soal dari spreadsheet!`,
      count: parsedSoalList.length,
      soalList: parsedSoalList
    });
  } catch (error: any) {
    console.error('Error importSoalExcelUh:', error);
    return res.status(500).json({ success: false, message: 'Gagal mengimpor Excel: ' + error.message });
  }
};

/**
 * 2. Asisten Analisis AI: Pola Kesalahan, Rekomendasi Materi & Butir Soal Latihan Remedial
 */
export const getAiAnalysisUh = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const uh = await (prisma as any).ulanganHarian.findUnique({
      where: { id },
      include: { submissions: true }
    });

    if (!uh) return res.status(404).json({ success: false, message: 'Ulangan harian tidak ditemukan' });

    let parsedSoal: any[] = [];
    try {
      parsedSoal = uh.soalJson ? JSON.parse(uh.soalJson) : [];
    } catch (_) {}

    const submissions: any[] = uh.submissions || [];
    const totalSub = submissions.length;

    // Hitung statistik jawaban salah per butir
    const missedStats: any[] = [];
    parsedSoal.forEach((s, idx) => {
      let salahCount = 0;
      let benarCount = 0;
      submissions.forEach(sub => {
        let jwb: any = {};
        try { jwb = sub.jawabanJson ? JSON.parse(sub.jawabanJson) : {}; } catch (_) {}
        const userAns = String(jwb[s.id] || '').trim().toUpperCase();
        if (userAns === String(s.correctOption).trim().toUpperCase()) {
          benarCount++;
        } else {
          salahCount++;
        }
      });
      const errorRate = totalSub > 0 ? Math.round((salahCount / totalSub) * 100) : 0;
      missedStats.push({
        number: idx + 1,
        questionId: s.id,
        content: s.content,
        correctOption: s.correctOption,
        salahCount,
        benarCount,
        errorRate
      });
    });

    missedStats.sort((a, b) => b.errorRate - a.errorRate);
    const mostMissed = missedStats.slice(0, 3);

    // AI Analysis Prompt via Gemini
    let aiPatternAnalysis = '';
    let reinforcementTopics: string[] = [];
    let remedialExercises: any[] = [];

    try {
      const { GoogleGenAI } = await import('@google/genai');
      let keyToUse = process.env.GEMINI_API_KEY || '';
      const dbSetting = await prisma.settings.findUnique({ where: { key: 'GEMINI_API_KEY' } });
      if (dbSetting?.value) keyToUse = dbSetting.value;

      if (keyToUse) {
        const ai = new GoogleGenAI({ apiKey: keyToUse });
        const prompt = `Anda adalah asisten pedagogik AI cerdas untuk Guru SMP SMPN 1 Boyolangu.
Analisis data Ulangan Harian berikut:
- Mata Pelajaran: ${uh.mapelId}
- Topik: ${uh.topik}
- Total Siswa: ${totalSub}
- Butir Soal Paling Banyak Salah:
${mostMissed.map(m => `No. ${m.number}: "${m.content.substring(0, 150)}" (Tingkat Kesalahan: ${m.errorRate}%)`).join('\n')}

Tugas Anda:
1. Temukan pola kesalahan konsep (misconception) utama yang dialami siswa.
2. Rekomendasikan 2-3 materi penguatan spesifik yang perlu diajarkan kembali oleh guru di kelas.
3. Buatkan 3 butir soal latihan remedial singkat terfokus (Pilihan Ganda A-D) dengan pembahasan mendidik.

Kembalikan HANYA format JSON valid berikut:
{
  "polaKesalahan": "Analisis pola kesalahan...",
  "materiPenguatan": ["Materi 1...", "Materi 2..."],
  "soalRemedial": [
    {
      "number": 1,
      "content": "Pertanyaan remedial...",
      "options": ["A. Opsi A", "B. Opsi B", "C. Opsi C", "D. Opsi D"],
      "correctOption": "A",
      "explanation": "Pembahasan..."
    }
  ]
}`;

        const resp = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt
        });

        const cleanJson = (resp.text || '').replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        aiPatternAnalysis = parsed.polaKesalahan || '';
        reinforcementTopics = parsed.materiPenguatan || [];
        remedialExercises = parsed.soalRemedial || [];
      }
    } catch (e: any) {
      console.warn('AI analysis fallback:', e.message);
    }

    if (!aiPatternAnalysis) {
      aiPatternAnalysis = `Sebagian besar siswa (${mostMissed[0]?.errorRate || 65}%) mengalami kendala pada pemahaman konsep inti butir soal nomor ${mostMissed.map(m => m.number).join(', ')}. Pola kesalahan menunjukkan siswa terkecoh pada tahap analisis penerapan konsep dasar materi ${uh.topik}.`;
      reinforcementTopics = [
        `Penguatan pemahaman konsep dasar materi ${uh.topik}`,
        `Latihan variasi studi kasus pemecahan masalah bertahap`,
        `Identifikasi kata kunci pada butir soal kontekstual`
      ];
      remedialExercises = [
        {
          number: 1,
          content: `Latihan Penguatan ${uh.topik} (No. 1): Berdasarkan konsep dasar yang dipelajari, langkah awal yang benar dalam menyelesaikan permasalahan terkait ${uh.topik} adalah...`,
          options: [
            `A. Mengidentifikasi data yang diketahui dan menerapkan prinsip dasar ${uh.topik}`,
            `B. Langsung menyimpulkan tanpa memeriksa variabel pendukung`,
            `C. Mengabaikan aturan dasar dan memilih opsi acak`,
            `D. Mengubah seluruh format data tanpa verifikasi`
          ],
          correctOption: 'A',
          explanation: `Pembahasan: Pemecahan masalah pada ${uh.topik} selalu diawali dengan identifikasi data yang valid.`
        }
      ];
    }

    return res.json({
      success: true,
      uhId: uh.id,
      topik: uh.topik,
      mapel: uh.mapelId,
      totalPeserta: totalSub,
      soalTersulit: mostMissed,
      analisisAI: {
        polaKesalahan: aiPatternAnalysis,
        materiPenguatan: reinforcementTopics,
        soalRemedial: remedialExercises
      }
    });
  } catch (error: any) {
    console.error('Error getAiAnalysisUh:', error);
    return res.status(500).json({ success: false, message: 'Gagal melakukan analisis AI: ' + error.message });
  }
};

/**
 * 3. Perpanjang Waktu Ulangan Harian Secara Real-Time (+5, +10, +15 Menit)
 */
export const extendWaktuUh = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { tambahMenit = 10, siswaId } = req.body;

    const uh = await (prisma as any).ulanganHarian.findUnique({ where: { id } });
    if (!uh) return res.status(404).json({ success: false, message: 'Ulangan harian tidak ditemukan' });

    const currentSelesai = uh.waktuSelesai ? new Date(uh.waktuSelesai) : new Date(Date.now() + 15 * 60000);
    const newSelesai = new Date(currentSelesai.getTime() + Number(tambahMenit) * 60000);

    await (prisma as any).ulanganHarian.update({
      where: { id },
      data: {
        waktuSelesai: newSelesai,
        durasiMenit: uh.durasiMenit + Number(tambahMenit)
      }
    });

    return res.json({
      success: true,
      message: `Waktu ulangan berhasil diperpanjang +${tambahMenit} menit (sampai ${formatTimeWib(newSelesai)} WIB)!`,
      waktuSelesai: newSelesai
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Gagal memperpanjang waktu: ' + error.message });
  }
};

/**
 * 4. Koreksi Manual Jawaban Uraian & Penyesuaian Nilai dengan Rubrik dan Audit Log
 */
export const gradeManualUraianUh = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const uhId = String(req.params.id);
    const { submissionId, siswaId, nilaiBaru, skor, catatanGuru, alasanRevisi, alasan } = req.body;

    const resolvedNilai = nilaiBaru !== undefined ? nilaiBaru : skor;
    const resolvedAlasan = alasanRevisi || catatanGuru || alasan || 'Koreksi manual oleh guru';

    if (resolvedNilai === undefined || (!submissionId && !siswaId)) {
      return res.status(400).json({ success: false, message: 'ID submisi/siswa dan nilai baru wajib diisi' });
    }

    const nilaiFinal = Math.min(100, Math.max(0, Number(resolvedNilai)));
    let sub: any = null;

    if (submissionId) {
      sub = await (prisma as any).ulanganHarianSubmission.findUnique({
        where: { id: String(submissionId) }
      });
    }
    if (!sub && siswaId && uhId) {
      sub = await (prisma as any).ulanganHarianSubmission.findFirst({
        where: { ulanganId: uhId, siswaId: String(siswaId) }
      });
    }

    let nilaiLama = 0;
    if (sub) {
      nilaiLama = sub.nilai || 0;
      sub = await (prisma as any).ulanganHarianSubmission.update({
        where: { id: sub.id },
        data: {
          nilai: nilaiFinal,
          status: 'SELESAI',
          waktuSelesai: sub.waktuSelesai || new Date(),
          updatedAt: new Date()
        }
      });
    } else if (siswaId && uhId) {
      const uh = await (prisma as any).ulanganHarian.findUnique({ where: { id: uhId } });
      const st = await prisma.user.findUnique({ where: { id: String(siswaId) } });
      sub = await (prisma as any).ulanganHarianSubmission.create({
        data: {
          ulanganId: uhId,
          siswaId: String(siswaId),
          siswaName: st?.name || 'Siswa',
          kelasId: st?.className || uh?.kelasId || '-',
          status: 'SELESAI',
          nilai: nilaiFinal,
          jawabanJson: JSON.stringify({}),
          raguRaguJson: JSON.stringify([]),
          waktuMulai: new Date(),
          waktuSelesai: new Date()
        }
      });
    } else {
      return res.status(404).json({ success: false, message: 'Submisi siswa tidak ditemukan' });
    }

    // Catat ke AuditLog demi keamanan dan transparansi
    try {
      await prisma.auditLog.create({
        data: {
          action: 'REVISI_NILAI_ULANGAN_HARIAN',
          performedBy: user?.name || 'Guru Pengampu',
          details: `Revisi nilai siswa ${sub.siswaName} (${sub.kelasId}) dari ${nilaiLama} menjadi ${nilaiFinal}. Alasan: ${resolvedAlasan}`
        }
      });
    } catch (_) {}

    return res.json({
      success: true,
      message: `Nilai siswa ${sub.siswaName} berhasil diperbarui menjadi ${nilaiFinal}!`,
      nilaiLama,
      nilaiBaru: nilaiFinal
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Gagal menyimpan nilai manual: ' + error.message });
  }
};

/**
 * 4b. Reset / Buka Kunci / Paksa Selesai Sesi Ulangan Harian Siswa oleh Guru
 */
export const resetSiswaUh = async (req: Request, res: Response) => {
  try {
    const uhId = String(req.params.id);
    const { siswaId, submissionId, action = 'UNLOCK' } = req.body;

    let sub: any = null;
    if (submissionId) {
      sub = await (prisma as any).ulanganHarianSubmission.findUnique({ where: { id: String(submissionId) } });
    }
    if (!sub && siswaId) {
      sub = await (prisma as any).ulanganHarianSubmission.findFirst({
        where: { ulanganId: uhId, siswaId: String(siswaId) }
      });
    }

    if (!sub) {
      return res.status(404).json({ success: false, message: 'Data pengerjaan siswa belum ada / tidak ditemukan' });
    }

    if (action === 'DELETE_RESET') {
      await (prisma as any).ulanganHarianSubmission.delete({ where: { id: sub.id } });
      return res.json({
        success: true,
        message: `Sesi pengerjaan ${sub.siswaName} berhasil di-reset penuh (mulai dari awal).`
      });
    } else if (action === 'FORCE_FINISH') {
      const uh = await (prisma as any).ulanganHarian.findUnique({ where: { id: uhId } });
      let parsedSoal: any[] = [];
      let parsedJawab: any = {};
      try { parsedSoal = uh?.soalJson ? JSON.parse(uh.soalJson) : []; } catch {}
      try { parsedJawab = sub.jawabanJson ? JSON.parse(sub.jawabanJson) : {}; } catch {}

      let totalBenar = 0;
      let totalSalah = 0;
      parsedSoal.forEach((soal: any) => {
        const ans = parsedJawab[soal.id];
        if (ans && String(ans).trim().toUpperCase() === String(soal.correctOption).trim().toUpperCase()) {
          totalBenar++;
        } else {
          totalSalah++;
        }
      });
      const bobotPerSoal = parsedSoal.length > 0 ? ((uh?.bobotNilai || 100) / parsedSoal.length) : 0;
      const nilaiFinal = Math.round(totalBenar * bobotPerSoal);

      await (prisma as any).ulanganHarianSubmission.update({
        where: { id: sub.id },
        data: {
          status: 'SELESAI',
          waktuSelesai: new Date(),
          totalBenar,
          totalSalah,
          nilai: nilaiFinal
        }
      });
      return res.json({
        success: true,
        message: `Ulangan ${sub.siswaName} berhasil diselesaikan paksa (Nilai: ${nilaiFinal}).`
      });
    } else {
      // Default: UNLOCK (Buka kunci anti-cheat / kembalikan ke status MENGERJAKAN)
      await (prisma as any).ulanganHarianSubmission.update({
        where: { id: sub.id },
        data: {
          status: 'MENGERJAKAN',
          insidenCount: 0,
          waktuSelesai: null
        }
      });
      return res.json({
        success: true,
        message: `Kunci sesi ${sub.siswaName} berhasil dibuka! Siswa dapat melanjutkan pengerjaan.`
      });
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Gagal mereset sesi siswa: ' + error.message });
  }
};

/**
 * 4c. Preview / Ambil Soal untuk Ulangan Harian (dari Bank Soal, Paket Ujian CBT, Riwayat UH, atau AI Gemini)
 */
export const previewSoalUh = async (req: Request, res: Response) => {
  try {
    const mapelId = String(req.query.mapelId || req.body?.mapelId || 'Matematika').trim();
    const topik = String(req.query.topik || req.body?.topik || 'Materi Pokok').trim();
    const kelasId = String(req.query.kelasId || req.body?.kelasId || 'VII-A').trim();
    const sumber = String(req.query.sumber || req.body?.sumber || 'BANK_SOAL').toUpperCase();
    const examId = String(req.query.examId || req.body?.examId || '').trim();
    const count = Math.min(50, Math.max(1, Number(req.query.count || req.body?.count || 10)));
    const difficulty = String(req.query.difficulty || req.body?.difficulty || 'Sedang');

    const resultSoal: any[] = [];

    // Jika guru memilih paket Exam CBT tertentu (examId)
    if (examId) {
      const eqs = await prisma.question.findMany({
        where: { examId },
        orderBy: { orderNum: 'asc' },
        take: count
      });
      for (const eq of eqs) {
        let opts: string[] = [];
        try {
          const parsed = eq.options ? JSON.parse(eq.options) : [];
          if (Array.isArray(parsed)) opts = parsed.map(String);
          else if (typeof parsed === 'object' && parsed !== null) {
            opts = [parsed.A || parsed.a || '', parsed.B || parsed.b || '', parsed.C || parsed.c || '', parsed.D || parsed.d || ''].filter(Boolean);
          }
        } catch {}
        resultSoal.push({
          id: `soal_${resultSoal.length + 1}`,
          number: resultSoal.length + 1,
          type: eq.type === 'ESSAY' ? 'URAIAN' : 'PG',
          content: eq.content,
          options: opts.length >= 2 ? opts : ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'],
          correctOption: eq.correctOption || 'A',
          explanation: eq.explanation || '',
          imageUrl: eq.imageUrl || null,
          audioUrl: eq.audioUrl || null,
          points: Math.round(100 / Math.max(1, eqs.length))
        });
      }
      return res.json({ success: true, total: resultSoal.length, data: resultSoal });
    }

    if (sumber === 'AI_GEMINI') {
      const aiQuestions = await generateQuestionsWithGemini({
        subject: mapelId,
        topic: topik,
        grade: kelasId.startsWith('VIII') ? 'Kelas VIII' : kelasId.startsWith('IX') ? 'Kelas IX' : 'Kelas VII',
        count,
        difficulty,
        type: 'MULTIPLE_CHOICE'
      });
      if (Array.isArray(aiQuestions)) {
        aiQuestions.forEach((q: any, idx: number) => {
          const opts = q.options
            ? [q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || ''].filter(Boolean)
            : ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'];
          resultSoal.push({
            id: `soal_${idx + 1}`,
            number: idx + 1,
            type: 'PG',
            content: q.content || '',
            options: opts.length >= 2 ? opts : ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'],
            correctOption: q.correctOption || 'A',
            explanation: q.explanation || '',
            points: Math.round(100 / Math.max(1, aiQuestions.length))
          });
        });
      }
      return res.json({ success: true, total: resultSoal.length, data: resultSoal });
    }

    // Default: BANK_SOAL (Gabungan BankSoal + Question Paket CBT + Riwayat UH)
    const bankSoalDb = await prisma.bankSoal.findMany({
      where: { subjectName: { contains: mapelId, mode: 'insensitive' as any } },
      take: count
    });
    for (const b of bankSoalDb) {
      let opts: string[] = [];
      try {
        const parsed = b.options ? JSON.parse(b.options) : [];
        if (Array.isArray(parsed)) opts = parsed.map(String);
        else if (typeof parsed === 'object' && parsed !== null) {
          opts = [parsed.A || parsed.a || '', parsed.B || parsed.b || '', parsed.C || parsed.c || '', parsed.D || parsed.d || ''].filter(Boolean);
        }
      } catch {}
      resultSoal.push({
        id: `soal_${resultSoal.length + 1}`,
        number: resultSoal.length + 1,
        type: b.type === 'ESSAY' || b.type === 'URAIAN' ? 'URAIAN' : 'PG',
        content: b.content,
        options: opts.length >= 2 ? opts : ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'],
        correctOption: b.correctOption || 'A',
        explanation: b.explanation || '',
        points: 10
      });
    }

    if (resultSoal.length < count) {
      const examQs = await prisma.question.findMany({
        where: {
          exam: {
            subject: { name: { contains: mapelId, mode: 'insensitive' as any } }
          }
        },
        orderBy: { id: 'desc' },
        take: count - resultSoal.length
      });
      for (const eq of examQs) {
        let opts: string[] = [];
        try {
          const parsed = eq.options ? JSON.parse(eq.options) : [];
          if (Array.isArray(parsed)) opts = parsed.map(String);
          else if (typeof parsed === 'object' && parsed !== null) {
            opts = [parsed.A || parsed.a || '', parsed.B || parsed.b || '', parsed.C || parsed.c || '', parsed.D || parsed.d || ''].filter(Boolean);
          }
        } catch {}
        resultSoal.push({
          id: `soal_${resultSoal.length + 1}`,
          number: resultSoal.length + 1,
          type: eq.type === 'ESSAY' ? 'URAIAN' : 'PG',
          content: eq.content,
          options: opts.length >= 2 ? opts : ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'],
          correctOption: eq.correctOption || 'A',
          explanation: eq.explanation || '',
          imageUrl: eq.imageUrl || null,
          audioUrl: eq.audioUrl || null,
          points: 10
        });
      }
    }

    // Jika BankSoal & Question masih kosong untuk mapel ini, generate cerdas via AI / Kurikulum
    if (resultSoal.length === 0) {
      const aiQuestions = await generateQuestionsWithGemini({
        subject: mapelId,
        topic: topik,
        grade: kelasId.startsWith('VIII') ? 'Kelas VIII' : kelasId.startsWith('IX') ? 'Kelas IX' : 'Kelas VII',
        count,
        difficulty,
        type: 'MULTIPLE_CHOICE'
      });
      if (Array.isArray(aiQuestions)) {
        aiQuestions.forEach((q: any, idx: number) => {
          const opts = q.options
            ? [q.options.A || '', q.options.B || '', q.options.C || '', q.options.D || ''].filter(Boolean)
            : ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'];
          resultSoal.push({
            id: `soal_${idx + 1}`,
            number: idx + 1,
            type: 'PG',
            content: q.content || '',
            options: opts.length >= 2 ? opts : ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'],
            correctOption: q.correctOption || 'A',
            explanation: q.explanation || '',
            points: Math.round(100 / Math.max(1, aiQuestions.length))
          });
        });
      }
    }

    const pts = Math.round(100 / Math.max(1, resultSoal.length));
    const normalized = resultSoal.map((s, i) => ({
      ...s,
      id: `soal_${i + 1}`,
      number: i + 1,
      points: pts
    }));

    return res.json({ success: true, total: normalized.length, data: normalized });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Gagal memuat soal preview: ' + error.message });
  }
};

/**
 * 5. Rekap Remedial & Pengayaan: Siswa Belum Tuntas (< KKM 75)
 */
export const getRemedialSummaryUh = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const uh = await (prisma as any).ulanganHarian.findUnique({
      where: { id },
      include: { submissions: { orderBy: { nilai: 'asc' } } }
    });

    if (!uh) return res.status(404).json({ success: false, message: 'Ulangan harian tidak ditemukan' });

    // BUG-KUR-20 Fix: Kebijakan remedial terkonfigurasi (CAP_AT_KKTP | REPLACE | BEST_OF) dan KKTP dinamis
    const policy = (req.query.policy as string) || 'CAP_AT_KKTP';
    const kkm = Number(req.query.kktp || req.query.kkm) || 75;
    const submissions: any[] = uh.submissions || [];

    const remedialList = submissions
      .filter(s => (s.nilai || 0) < kkm)
      .map(s => {
        const rawScore = s.nilai || 0;
        let maxRemedialScore = kkm;
        if (policy === 'CAP_AT_KKTP') maxRemedialScore = kkm;
        else if (policy === 'BEST_OF') maxRemedialScore = Math.max(kkm, rawScore);
        else if (policy === 'REPLACE') maxRemedialScore = 100;

        return {
          submissionId: s.id,
          siswaId: s.siswaId,
          nama: s.siswaName,
          kelasId: s.kelasId,
          nilaiAwal: rawScore,
          kktp: kkm,
          status: 'BELUM_TUNTAS',
          selisih: kkm - rawScore,
          remedialPolicy: policy,
          maxRemedialScore
        };
      });

    const pengayaanList = submissions
      .filter(s => (s.nilai || 0) >= kkm)
      .map(s => ({
        submissionId: s.id,
        siswaId: s.siswaId,
        nama: s.siswaName,
        kelasId: s.kelasId,
        nilai: s.nilai || 0,
        status: 'TUNTAS'
      }));

    return res.json({
      success: true,
      kktp: kkm,
      remedialPolicy: policy,
      totalPeserta: submissions.length,
      jumlahRemedial: remedialList.length,
      jumlahPengayaan: pengayaanList.length,
      remedialList,
      pengayaanList
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Gagal memuat rekap remedial: ' + error.message });
  }
};

/**
 * 6. Ekspor Rekap Nilai Ulangan Harian ke Excel
 */
export const exportUhExcel = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const xlsx = await import('xlsx');
    const uh = await (prisma as any).ulanganHarian.findUnique({
      where: { id },
      include: { submissions: { orderBy: { nilai: 'desc' } } }
    });

    if (!uh) return res.status(404).send('Ulangan harian tidak ditemukan');

    const rows = (uh.submissions || []).map((s: any, idx: number) => ({
      'Ranking': idx + 1,
      'Nama Siswa': s.siswaName,
      'Kelas': s.kelasId,
      'Nilai Total': s.nilai || 0,
      'Status Ketuntasan': (s.nilai || 0) >= 75 ? 'TUNTAS' : 'REMEDIAL',
      'Benar': s.totalBenar,
      'Salah': s.totalSalah,
      'Status Ujian': s.status,
      'Waktu Mulai': s.waktuMulai ? formatTimeWib(s.waktuMulai) : '-',
      'Waktu Selesai': s.waktuSelesai ? formatTimeWib(s.waktuSelesai) : '-'
    }));

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Nilai_UH');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Rekap_UH_${uh.mapelId}_${uh.topik}_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).send('Gagal mengekspor Excel: ' + error.message);
  }
};

// -------------------------------------------------------------
// SISWA CONTROLLERS
// -------------------------------------------------------------

/**
 * UNIFIED INBOX: Satu endpoint menyatukan Tugas (PR) dan Ulangan Harian (UH)
 */
export const getSiswaUnifiedInbox = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const siswaId = user?.id;

    if (!siswaId) {
      return res.status(401).json({
        success: false,
        message: 'Pengguna tidak terautentikasi'
      });
    }

    // Auto-tutup ulangan harian yang telah lewat batas waktu selesai agar tidak menumpuk di siswa
    await autoCloseExpiredUlanganHarian();

    const now = new Date();

    // Resolusi nama & UUID kelas siswa secara menyeluruh
    const studentClass = ((user?.className || user?.kelasId || '') as string).trim().toUpperCase();
    const studentClassId = (user?.classId || '').trim();
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
        if (!targetClassNames.includes(cls.name.toUpperCase())) targetClassNames.push(cls.name.toUpperCase());
      }
    }

    // 1. Ambil Ulangan Harian (Mendukung multi-centang rombel / kelas)
    const listAllUh = await (prisma as any).ulanganHarian.findMany({
      include: {
        submissions: {
          where: { siswaId }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 60
    });

    const listUh = listAllUh.filter((uh: any) => {
      const assignedList = (uh.kelasId || '').toUpperCase().split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
      if (assignedList.length === 0 || assignedList.includes('ALL') || assignedList.includes('SEMUA KELAS')) return true;
      for (const cName of targetClassNames) {
        if (assignedList.includes(cName)) return true;
      }
      for (const cId of targetClassIds) {
        if (assignedList.includes(cId.toUpperCase())) return true;
      }
      return false;
    });

    // 2. Ambil Homework (Cocokkan Class UUID dan Class Name)
    const homeworkWhere: any = {};
    if (targetClassIds.length > 0 || targetClassNames.length > 0) {
      homeworkWhere.OR = [
        ...(targetClassIds.length > 0 ? [{ classId: { in: targetClassIds } }] : []),
        ...(targetClassNames.length > 0 ? [{ class: { name: { in: targetClassNames } } }] : [])
      ];
    } else {
      homeworkWhere.id = '__NONE__';
    }

    const listHomework = await prisma.homework.findMany({
      where: homeworkWhere,
      include: {
        submissions: {
          where: { userId: siswaId }
        },
        subject: {
          select: { name: true }
        }
      },
      orderBy: { deadline: 'asc' }
    });

    const ongoingList: any[] = [];
    const activeList: any[] = [];
    const upcomingList: any[] = [];
    const completedList: any[] = [];

    for (const uh of listUh) {
      const sub = Array.isArray(uh.submissions) ? uh.submissions[0] : null;
      const isExpired = uh.waktuSelesai ? new Date(uh.waktuSelesai) <= now : false;
      const sisaWaktuMs = uh.waktuSelesai ? Math.max(0, new Date(uh.waktuSelesai).getTime() - now.getTime()) : 0;
      const sisaMenit = Math.ceil(sisaWaktuMs / (60 * 1000));

      const itemUh = {
        id: uh.id,
        tipe: 'ULANGAN_HARIAN',
        mode: uh.mode,
        judul: `UH ${uh.mapelId} — ${uh.topik}`,
        mapel: uh.mapelId,
        guru: uh.guruName,
        durasiMenit: uh.durasiMenit,
        totalSoal: uh.totalSoal,
        bobot: uh.bobotNilai,
        waktuMulai: uh.waktuMulai,
        waktuSelesai: uh.waktuSelesai,
        sisaMenit,
        statusSub: sub ? sub.status : (isExpired ? 'WAKTU_HABIS' : 'BELUM_MULAI'),
        nilai: sub?.nilai ?? null,
        insidenCount: sub?.insidenCount ?? 0,
        badge: uh.status === 'AKTIF' && !isExpired && (!sub || sub.status === 'MENGERJAKAN') ? 'URGENT' : 'NORMAL'
      };

      if (sub && sub.status === 'SELESAI') {
        completedList.push({
          ...itemUh,
          badgeColor: 'GREY',
          actionText: 'Lihat Hasil'
        });
      } else if (isExpired) {
        // Waktu ulangan telah selesai
        if (sub && sub.status === 'MENGERJAKAN') {
          completedList.push({
            ...itemUh,
            badgeColor: 'GREY',
            actionText: 'Waktu Habis'
          });
        }
        // Jika belum pernah dikerjakan dan sudah kadaluarsa, abaikan agar tidak menumpuk di list aktif
      } else if (uh.status === 'AKTIF') {
        if (sub && sub.status === 'MENGERJAKAN') {
          ongoingList.push({
            ...itemUh,
            badgeColor: 'RED',
            actionText: 'Lanjutkan Mengerjakan'
          });
        } else {
          activeList.push({
            ...itemUh,
            badgeColor: 'GREEN',
            actionText: 'Mulai Ulangan'
          });
        }
      } else if (uh.status === 'DRAFT' || (uh.waktuMulai && new Date(uh.waktuMulai) > now)) {
        upcomingList.push({
          ...itemUh,
          badgeColor: 'BLUE',
          actionText: 'Belum Dimulai'
        });
      }
    }

    for (const hw of listHomework) {
      const sub = Array.isArray(hw.submissions) ? hw.submissions[0] : null;
      const deadline = new Date(hw.deadline);
      const isExpired = now >= deadline;
      const sisaJamMs = deadline.getTime() - now.getTime();
      const sisaJam = Math.round(sisaJamMs / (60 * 60 * 1000));
      const isUrgent = sisaJamMs > 0 && sisaJam <= 24;

      let parseQuestions: any[] = [];
      try {
        parseQuestions = hw.questions ? JSON.parse(hw.questions) : [];
      } catch (e) {}

      const itemHw = {
        id: hw.id,
        tipe: 'TUGAS_PR',
        mode: hw.category || 'PR',
        judul: hw.title,
        mapel: hw.subject?.name || 'Mata Pelajaran',
        guru: 'Guru Pengampu',
        deadline: hw.deadline,
        sisaJam,
        totalSoal: parseQuestions.length,
        bobot: hw.weight || 100,
        statusSub: sub ? (sub.score !== null ? 'DINILAI' : 'DISUBMIT') : (isExpired ? 'TERLEWAT' : 'BELUM_SUBMIT'),
        nilai: sub ? (sub.score ?? sub.autoScore ?? null) : null,
        badge: isUrgent ? 'WARNING' : 'NORMAL'
      };

      if (sub) {
        completedList.push({
          ...itemHw,
          badgeColor: 'GREY',
          actionText: 'Lihat Tugas'
        });
      } else if (!isExpired) {
        activeList.push({
          ...itemHw,
          badgeColor: isUrgent ? 'YELLOW' : 'GREEN',
          actionText: 'Kerjakan'
        });
      }
      // Tugas/PR yang tenggatnya sudah lewat dan tidak disubmit otomatis dihilangkan dari tab Aktif
    }

    return res.json({
      success: true,
      data: {
        ongoing: ongoingList,
        active: activeList,
        upcoming: upcomingList,
        completed: completedList,
        counts: {
          ongoing: ongoingList.length,
          active: activeList.length,
          upcoming: upcomingList.length,
          completed: completedList.length,
          totalAktif: ongoingList.length + activeList.length
        }
      }
    });
  } catch (error: any) {
    console.error('Error getSiswaUnifiedInbox:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat inbox tugas dan ulangan: ' + error.message
    });
  }
};

/**
 * Siswa membuka detail & mulai mengerjakan Ulangan Harian
 */
export const mulaiKerjakanUhSiswa = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const id = String(req.params.id);
    const { token } = req.body;

    const uh = await (prisma as any).ulanganHarian.findUnique({
      where: { id }
    });

    if (!uh) {
      return res.status(404).json({
        success: false,
        message: 'Ulangan harian tidak ditemukan'
      });
    }

    if (uh.status !== 'AKTIF') {
      return res.status(400).json({
        success: false,
        message: 'Ulangan harian ini sudah tidak aktif atau telah ditutup oleh guru.'
      });
    }

    if (uh.waktuSelesai && new Date(uh.waktuSelesai) <= new Date()) {
      await (prisma as any).ulanganHarian.update({
        where: { id },
        data: { status: 'SELESAI' }
      }).catch(() => {});
      return res.status(400).json({
        success: false,
        message: 'Waktu pelaksanaan ulangan harian ini sudah berakhir.'
      });
    }

    // Validasi token untuk mode CBT_MINI
    if (uh.mode === 'CBT_MINI') {
      if (!token) {
        return res.status(400).json({
          success: false,
          needsToken: true,
          message: 'Mode CBT Mini membutuhkan Token Ujian dari guru!'
        });
      }
      if (token.trim().toUpperCase() !== (uh.tokenAktif || '').trim().toUpperCase()) {
        return res.status(400).json({
          success: false,
          needsToken: true,
          message: 'Token Ujian salah atau sudah kadaluarsa! Silakan minta token aktif terbaru ke guru pengawas.'
        });
      }
    }

    // Validasi kelas siswa (Mendukung UUID dan Nama Rombel)
    const studentClass = ((user?.className || user?.kelasId || '') as string).trim().toUpperCase();
    const studentClassId = (user?.classId || '').trim().toUpperCase();
    if ((studentClass || studentClassId) && uh.kelasId && uh.kelasId !== 'ALL' && uh.kelasId !== 'Semua Kelas') {
      const assignedList = (uh.kelasId || '').toUpperCase().split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
      const isAllowed = assignedList.length === 0 ||
        assignedList.includes('ALL') ||
        assignedList.includes('SEMUA KELAS') ||
        (studentClass && assignedList.includes(studentClass)) ||
        (studentClassId && assignedList.includes(studentClassId));
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          message: `Ulangan Harian ini khusus untuk kelas: ${uh.kelasId}. Kelas Anda (${studentClass || studentClassId}) tidak terdaftar.`
        });
      }
    }

    const siswaId = user?.id || 'SISWA_UNKNOWN';
    let submission = await (prisma as any).ulanganHarianSubmission.findUnique({
      where: {
        uniq_ulangan_siswa: {
          ulanganId: id,
          siswaId
        }
      }
    });

    if (!submission) {
      submission = await (prisma as any).ulanganHarianSubmission.create({
        data: {
          ulanganId: id,
          siswaId,
          siswaName: user?.name || 'Siswa',
          kelasId: uh.kelasId,
          status: 'MENGERJAKAN',
          jawabanJson: JSON.stringify({}),
          raguRaguJson: JSON.stringify([]),
          waktuMulai: new Date()
        }
      });
    } else if (submission.status === 'SELESAI') {
      return res.status(400).json({
        success: false,
        message: 'Anda sudah menyelesaikan ulangan harian ini.'
      });
    } else if (submission.status === 'TERKUNCI_CURANG') {
      return res.status(403).json({
        success: false,
        message: 'Ulangan Anda terkunci otomatis oleh sistem Anti-Cheat karena melanggar batas keluar aplikasi!'
      });
    }

    let rawSoalList: any[] = [];
    try {
      rawSoalList = uh.soalJson ? JSON.parse(uh.soalJson) : [];
    } catch (e) {}

    if (uh.mode === 'CBT_MINI') {
      rawSoalList = shuffleArray(rawSoalList, siswaId);
    }

    // Sanitasi: hilangkan correctOption & explanation
    const sanitizedSoalList = rawSoalList.map((s: any, idx: number) => ({
      id: s.id,
      number: idx + 1,
      type: s.type || 'PG',
      content: s.content,
      options: s.options,
      points: s.points,
      imageUrl: s.imageUrl || null,
      audioUrl: s.audioUrl || null
    }));

    const now = new Date();
    const deadlineUjian = uh.waktuSelesai ? new Date(uh.waktuSelesai) : new Date(now.getTime() + uh.durasiMenit * 60 * 1000);
    const sisaDetik = Math.max(0, Math.floor((deadlineUjian.getTime() - now.getTime()) / 1000));

    let savedAnswers = {};
    let savedRaguRagu: string[] = [];
    try {
      savedAnswers = submission.jawabanJson ? JSON.parse(submission.jawabanJson) : {};
      savedRaguRagu = submission.raguRaguJson ? JSON.parse(submission.raguRaguJson) : [];
    } catch (e) {}

    return res.json({
      success: true,
      data: {
        uh: {
          id: uh.id,
          topik: uh.topik,
          mapel: uh.mapelId,
          guru: uh.guruName,
          mode: uh.mode,
          durasiMenit: uh.durasiMenit,
          sisaDetik,
          totalSoal: sanitizedSoalList.length,
          bobotNilai: uh.bobotNilai
        },
        submission: {
          id: submission.id,
          savedAnswers,
          savedRaguRagu,
          insidenCount: submission.insidenCount
        },
        soalList: sanitizedSoalList
      }
    });
  } catch (error: any) {
    console.error('Error mulaiKerjakanUhSiswa:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memulai pengerjaan: ' + error.message
    });
  }
};

/**
 * Auto-Save jawaban & ragu-ragu
 */
export const autoSaveJawabanUhSiswa = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const id = String(req.params.id);
    const { jawabanJson, raguRaguJson } = req.body;
    const siswaId = user?.id || 'SISWA_UNKNOWN';

    const submission = await (prisma as any).ulanganHarianSubmission.findUnique({
      where: {
        uniq_ulangan_siswa: {
          ulanganId: id,
          siswaId
        }
      }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Sesi ulangan tidak ditemukan'
      });
    }

    if (submission.status !== 'MENGERJAKAN') {
      return res.status(400).json({
        success: false,
        message: 'Ulangan sudah diselesaikan atau terkunci.'
      });
    }

    // Hindari lost update: merge jawaban lama dengan jawaban baru
    let mergedJawaban: any = {};
    if (submission.jawabanJson) {
      try {
        mergedJawaban = JSON.parse(submission.jawabanJson);
      } catch (_) {}
    }
    if (jawabanJson) {
      const incoming = typeof jawabanJson === 'string' ? JSON.parse(jawabanJson || '{}') : (jawabanJson || {});
      mergedJawaban = { ...mergedJawaban, ...incoming };
    }

    const updated = await (prisma as any).ulanganHarianSubmission.update({
      where: { id: submission.id },
      data: {
        jawabanJson: JSON.stringify(mergedJawaban),
        raguRaguJson: typeof raguRaguJson === 'string' ? raguRaguJson : JSON.stringify(raguRaguJson || [])
      }
    });

    const now = new Date();
    const waktuSelesaiDate = submission.waktuSelesai ? new Date(submission.waktuSelesai) : null;
    const remainingSeconds = waktuSelesaiDate ? Math.max(0, Math.floor((waktuSelesaiDate.getTime() - now.getTime()) / 1000)) : null;

    return res.json({
      success: true,
      message: 'Auto-save tersimpan',
      savedAt: updated.updatedAt,
      serverNow: now.toISOString(),
      waktuSelesai: submission.waktuSelesai,
      remainingSeconds
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan jawaban: ' + error.message
    });
  }
};

/**
 * Log Anti-Cheat
 */
export const logInsidenAntiCheatUh = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const id = String(req.params.id);
    const siswaId = user?.id || 'SISWA_UNKNOWN';

    const uh = await (prisma as any).ulanganHarian.findUnique({ where: { id } });
    const submission = await (prisma as any).ulanganHarianSubmission.findUnique({
      where: {
        uniq_ulangan_siswa: {
          ulanganId: id,
          siswaId
        }
      }
    });

    if (!submission || submission.status !== 'MENGERJAKAN') {
      return res.status(400).json({ success: false, message: 'Sesi tidak aktif' });
    }

    const newInsidenCount = (submission.insidenCount || 0) + 1;
    const isModeCbtMini = uh?.mode === 'CBT_MINI';
    const isLocked = isModeCbtMini && newInsidenCount >= 3;

    await (prisma as any).ulanganHarianSubmission.update({
      where: { id: submission.id },
      data: {
        insidenCount: newInsidenCount,
        status: isLocked ? 'TERKUNCI_CURANG' : submission.status,
        waktuSelesai: isLocked ? new Date() : submission.waktuSelesai
      }
    });

    return res.json({
      success: true,
      insidenCount: newInsidenCount,
      isLocked,
      message: isLocked
        ? 'PERINGATAN: Anda telah keluar aplikasi sebanyak 3 kali! Ujian Anda dikunci otomatis demi integritas.'
        : `Peringatan Anti-Cheat (${newInsidenCount}/3): Dilarang keluar aplikasi selama ulangan berlangsung!`
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses insiden: ' + error.message
    });
  }
};

/**
 * Siswa melakukan Final Submit (Auto-Grading)
 */
export const submitFinalUhSiswa = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const id = String(req.params.id);
    const { jawabanJson, raguRaguJson } = req.body;
    const siswaId = user?.id || 'SISWA_UNKNOWN';

    const uh = await (prisma as any).ulanganHarian.findUnique({ where: { id } });
    if (!uh) {
      return res.status(404).json({ success: false, message: 'Ulangan harian tidak ditemukan' });
    }

    const submission = await (prisma as any).ulanganHarianSubmission.findUnique({
      where: {
        uniq_ulangan_siswa: {
          ulanganId: id,
          siswaId
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan' });
    }

    let parsedSoal: any[] = [];
    try {
      parsedSoal = uh.soalJson ? JSON.parse(uh.soalJson) : [];
    } catch (e) {}

    let finalJawaban: any = {};
    if (submission.jawabanJson) {
      try {
        finalJawaban = JSON.parse(submission.jawabanJson);
      } catch (_) {}
    }
    if (jawabanJson) {
      const incoming = typeof jawabanJson === 'string' ? JSON.parse(jawabanJson || '{}') : (jawabanJson || {});
      finalJawaban = { ...finalJawaban, ...incoming };
    }

    let totalBenar = 0;
    let totalSalah = 0;
    const detailReview: any[] = [];

    parsedSoal.forEach((soal: any, idx: number) => {
      const userAns = finalJawaban[soal.id];
      const isCorrect = userAns && String(userAns).trim().toUpperCase() === String(soal.correctOption).trim().toUpperCase();

      if (isCorrect) {
        totalBenar++;
      } else {
        totalSalah++;
      }

      detailReview.push({
        id: soal.id,
        number: idx + 1,
        content: soal.content,
        options: soal.options,
        jawabanSiswa: userAns || 'TIDAK_DIJAWAB',
        kunciJawaban: soal.correctOption,
        isCorrect: !!isCorrect,
        explanation: soal.explanation || 'Pembahasan materi pembelajaran terkait.'
      });
    });

    const bobotPerSoal = parsedSoal.length > 0 ? (uh.bobotNilai || 100) / parsedSoal.length : 0;
    const nilaiFinal = Math.round(totalBenar * bobotPerSoal);

    await (prisma as any).ulanganHarianSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'SELESAI',
        waktuSelesai: new Date(),
        jawabanJson: JSON.stringify(finalJawaban),
        raguRaguJson: raguRaguJson ? (typeof raguRaguJson === 'string' ? raguRaguJson : JSON.stringify(raguRaguJson)) : submission.raguRaguJson,
        totalBenar,
        totalSalah,
        nilai: nilaiFinal
      }
    });

    return res.json({
      success: true,
      message: 'Ulangan harian berhasil diselesaikan!',
      data: {
        nilai: nilaiFinal,
        totalBenar,
        totalSalah,
        totalSoal: parsedSoal.length,
        kkm: 75,
        isTuntas: nilaiFinal >= 75,
        review: detailReview
      }
    });
  } catch (error: any) {
    console.error('Error submitFinalUhSiswa:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal melakukan submit final: ' + error.message
    });
  }
};

/**
 * Siswa melihat hasil & review pembahasan
 */
export const getHasilUhSiswa = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const id = String(req.params.id);
    const siswaId = user?.id || 'SISWA_UNKNOWN';

    const uh = await (prisma as any).ulanganHarian.findUnique({ where: { id } });
    const submission = await (prisma as any).ulanganHarianSubmission.findUnique({
      where: {
        uniq_ulangan_siswa: {
          ulanganId: id,
          siswaId
        }
      }
    });

    if (!uh || !submission) {
      return res.status(404).json({ success: false, message: 'Data hasil tidak ditemukan' });
    }

    let parsedSoal: any[] = [];
    try {
      parsedSoal = uh.soalJson ? JSON.parse(uh.soalJson) : [];
    } catch (e) {}

    let jawabanSiswa: any = {};
    try {
      jawabanSiswa = submission.jawabanJson ? JSON.parse(submission.jawabanJson) : {};
    } catch (e) {}

    const review = parsedSoal.map((soal: any, idx: number) => {
      const userAns = jawabanSiswa[soal.id];
      const isCorrect = userAns && String(userAns).trim().toUpperCase() === String(soal.correctOption).trim().toUpperCase();
      return {
        id: soal.id,
        number: idx + 1,
        content: soal.content,
        options: soal.options,
        jawabanSiswa: userAns || 'TIDAK_DIJAWAB',
        kunciJawaban: soal.correctOption,
        isCorrect: !!isCorrect,
        explanation: soal.explanation
      };
    });

    return res.json({
      success: true,
      data: {
        uh: {
          topik: uh.topik,
          mapel: uh.mapelId,
          guru: uh.guruName,
          mode: uh.mode
        },
        nilai: submission.nilai,
        totalBenar: submission.totalBenar,
        totalSalah: submission.totalSalah,
        totalSoal: parsedSoal.length,
        isTuntas: (submission.nilai || 0) >= 75,
        waktuMulai: submission.waktuMulai,
        waktuSelesai: submission.waktuSelesai,
        insidenCount: submission.insidenCount,
        review
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat hasil ulangan: ' + error.message
    });
  }
};
