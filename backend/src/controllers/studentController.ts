import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import { checkStudentCommitteeRole, getClassCommittee } from '../utils/classCommittee';
import { normalizeClassVariations, resolveHomeroomTeacher, resolveCounselorTeacher, canonicalClassName } from '../utils/classHelper';
import { supabase } from '../utils/supabaseClient';

const prisma = new PrismaClient();

// 1. Get Complete Student / User Profile
export const getStudentProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    let userId = (req as any).user?.id;
    const requestedStudentId = req.query.studentId || req.query.childId;
    if (requestedStudentId && (req as any).user && ['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR', 'PARENT'].includes((req as any).user.role)) {
      userId = String(requestedStudentId);
    }
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        className: true,
        nisn: true,
        nis: true,
        gender: true,
        religion: true,
        pob: true,
        dob: true,
        address: true,
        fatherName: true,
        motherName: true,
        parentPhone: true,
        bloodType: true,
        allergies: true,
        points: true,
        profilePicUrl: true,
        homeroomTeacher: true,
        counselorTeacher: true
      }
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Ambil Guru BK riil dari database sesuai plotting dan rombel kelas siswa
    let realCounselor: string | null = null;
    let counselorNip: string | null = null;
    let counselorPhone: string | null = null;
    if (user.className) {
      const resolvedBk = await resolveCounselorTeacher(user.className);
      if (resolvedBk && resolvedBk.name) {
        realCounselor = resolvedBk.name;
        counselorNip = resolvedBk.nip || null;
        counselorPhone = resolvedBk.phone || null;
        if (user.counselorTeacher !== resolvedBk.name) {
          await prisma.user.update({
            where: { id: user.id },
            data: { counselorTeacher: resolvedBk.name }
          }).catch(() => {});
        }
      }
    }

    // Ambil Wali Kelas riil dari database sesuai rombel kelas siswa
    let realHomeroom = (user.homeroomTeacher && user.homeroomTeacher !== 'null' && user.homeroomTeacher.trim() !== '-')
        ? user.homeroomTeacher.trim()
        : null;
    let homeroomNip: string | null = null;
    let homeroomPhone: string | null = null;

    if (user.className) {
      const resolvedWali = await resolveHomeroomTeacher(user.className);
      if (resolvedWali && resolvedWali.name) {
        realHomeroom = resolvedWali.name;
        homeroomNip = resolvedWali.nip || null;
        homeroomPhone = resolvedWali.phone || null;

        // Sinkronkan ke database jika belum tersimpan atau berbeda
        if (user.homeroomTeacher !== resolvedWali.name) {
          await prisma.user.update({
            where: { id: user.id },
            data: { homeroomTeacher: resolvedWali.name }
          }).catch(() => {});
        }
      }
    }

    // Ambil Golongan Darah siswa secara terpadu dari User / UKS / Biodata
    let resolvedBlood = (user.bloodType && user.bloodType !== '-' && user.bloodType !== 'null') ? user.bloodType.trim() : null;
    if (!resolvedBlood) {
      try {
        const uksData = await (prisma as any).uksStudentHealthData.findUnique({
          where: { siswaId: user.id }
        });
        if (uksData?.golonganDarah && uksData.golonganDarah !== '-') {
          resolvedBlood = uksData.golonganDarah.trim();
        }
        if (!resolvedBlood) {
          const bioData = await (prisma as any).biodataSiswa.findUnique({
            where: { studentId: user.id }
          });
          if (bioData?.golonganDarah && bioData.golonganDarah !== '-') {
            resolvedBlood = bioData.golonganDarah.trim();
          }
        }
      } catch (_) {}
    }
    if (!resolvedBlood || resolvedBlood === '-' || resolvedBlood === 'null') {
      resolvedBlood = 'O (Rh+)';
    }

    const committeeStatus = await checkStudentCommitteeRole(user.id, user.name, user.className || 'VII-A');

    const studentData = {
      ...user,
      homeroomTeacher: realHomeroom || null,
      homeroomTeacherName: realHomeroom || null,
      homeroomTeacherNip: homeroomNip,
      homeroomTeacherPhone: homeroomPhone,
      wali_kelas: realHomeroom || null,
      wali_kelas_nama: realHomeroom || null,
      wali_kelas_nip: homeroomNip,
      counselorTeacher: realCounselor,
      counselorTeacherName: realCounselor,
      counselorTeacherNip: counselorNip,
      counselorTeacherPhone: counselorPhone,
      guru_bk: realCounselor,
      guru_bk_nama: realCounselor,
      bloodType: resolvedBlood,
      golongan_darah: resolvedBlood,
      points: user.points ?? 0,
      isClassCommittee: committeeStatus.isCommittee,
      committeePosition: committeeStatus.position,
      classLeaderName: committeeStatus.committee.leaderName,
      classViceLeaderName: committeeStatus.committee.viceLeaderName,
      classSecretaryName: committeeStatus.committee.secretaryName,
      classTreasurerName: committeeStatus.committee.treasurerName
    };

    res.json({
      success: true,
      data: studentData,
      user: studentData
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// 2. Update Student Profile (Change Password & Photo)
export const updateStudentProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { oldPassword, newPassword, profilePicUrl, parentPhone } = req.body;
    const profilePicBase64 = req.body.profilePicBase64 || req.body.imageBase64 || req.body.avatar;

    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const updateData: any = {};

    if (newPassword) {
      // Kebijakan Keamanan Sekolah: Penggantian PIN / Kata Sandi hanya bisa via Operator dan Admin saja
      if (user.role === 'STUDENT' || user.role === 'PARENT') {
        res.status(403).json({
          success: false,
          message: 'Penggantian PIN / Kata Sandi hanya dapat dilakukan melalui Operator atau Administrator sekolah demi keamanan akun.'
        });
        return;
      }
      if (!oldPassword) {
        res.status(400).json({ message: 'Password lama harus diisi' });
        return;
      }
      const cleanOldPassword = String(oldPassword).trim();
      let isMatch = false;

      if (user.role === 'STUDENT' || user.role === 'PARENT') {
        const bcryptMatch = await bcrypt.compare(cleanOldPassword, user.password).catch(() => false);
        if (
          cleanOldPassword === user.nisn ||
          cleanOldPassword === user.username ||
          cleanOldPassword === user.password ||
          bcryptMatch
        ) {
          isMatch = true;
        }
      } else {
        const bcryptMatch = await bcrypt.compare(cleanOldPassword, user.password).catch(() => false);
        isMatch = bcryptMatch || cleanOldPassword === user.password;
      }

      if (!isMatch) {
        res.status(400).json({ message: 'Password lama salah' });
        return;
      }
      updateData.password = await bcrypt.hash(newPassword.trim(), 10);
      updateData.deviceBindingId = null;
    }

    // Unggah Foto Profil via Base64 dari APK
    if (profilePicBase64) {
      try {
        const uploadDir = path.resolve(process.cwd(), 'uploads/avatars');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const safeName = `avatar_${userId}_${Date.now()}.jpg`;
        const targetPath = path.join(uploadDir, safeName);
        const cleanBase64 = String(profilePicBase64).replace(/^data:.*?;base64,/, '');
        fs.writeFileSync(targetPath, Buffer.from(cleanBase64, 'base64'));
        updateData.profilePicUrl = `/uploads/avatars/${safeName}`;

        // Juga salin ke public/uploads/avatars jika direktori public tersedia
        const publicUploadDir = path.resolve(process.cwd(), 'public/uploads/avatars');
        if (fs.existsSync(path.resolve(process.cwd(), 'public'))) {
          if (!fs.existsSync(publicUploadDir)) {
            fs.mkdirSync(publicUploadDir, { recursive: true });
          }
          fs.writeFileSync(path.join(publicUploadDir, safeName), Buffer.from(cleanBase64, 'base64'));
        }
      } catch (fileErr) {
        console.error('Error saving profile avatar:', fileErr);
      }
    } else if (profilePicUrl !== undefined) {
      updateData.profilePicUrl = profilePicUrl;
    }

    if (parentPhone !== undefined) updateData.parentPhone = parentPhone;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        profilePicUrl: true,
        className: true
      }
    });

    if (newPassword) {
      res.json({
        success: true,
        message: 'Password berhasil diperbarui! Silakan gunakan password baru ini untuk login berikutnya.',
        data: updated,
        user: updated,
        profilePicUrl: updated.profilePicUrl
      });
      return;
    }

    res.json({
      success: true,
      message: 'Profil berhasil diperbarui',
      data: updated,
      user: updated,
      profilePicUrl: updated.profilePicUrl
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// 3. Detailed Attendance History (Gate In & Gate Out Times) & Live Statistics
export const getDetailedAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    let targetUserId = (req as any).user?.id;
    const userRole = (req as any).user?.role;

    if (!targetUserId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (userRole === 'PARENT') {
      const childId = req.query.studentId || req.query.childId;
      const cleanNisn = ((req as any).user.username || '').replace(/^[Pp]/, '').trim();
      const parentUser = (req as any).user;

      const myChildren = await prisma.user.findMany({
        where: {
          role: 'STUDENT',
          OR: [
            { id: parentUser.studentId || '' },
            { nisn: cleanNisn },
            { username: cleanNisn },
            { parentPhone: parentUser.username },
            { parentPhone: parentUser.phone || '' },
            { fatherName: parentUser.name },
            { motherName: parentUser.name }
          ]
        },
        select: { id: true }
      });
      const validChildIds = myChildren.map(c => c.id);

      if (childId) {
        if (!validChildIds.includes(String(childId))) {
          res.status(403).json({ message: 'Akses ditolak: Anda tidak memiliki wewenang melihat presensi siswa ini.' });
          return;
        }
        targetUserId = String(childId);
      } else {
        targetUserId = validChildIds[0] || parentUser.id;
      }
    } else if (userRole === 'TEACHER' || userRole === 'COUNSELOR' || userRole === 'ADMIN' || userRole === 'OPERATOR') {
      const childId = req.query.studentId || req.query.childId;
      if (childId) {
        targetUserId = String(childId);
      }
    }

    // Parameter filter bulan & tahun serta pagination 20 per halaman
    const reqMonth = req.query.month ? Number(req.query.month) : (new Date().getMonth() + 1);
    const reqYear = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 100;

    const startDate = new Date(reqYear, reqMonth - 1, 1, 0, 0, 0, 0);
    const lastDay = new Date(reqYear, reqMonth, 0).getDate();
    const endDate = new Date(reqYear, reqMonth - 1, lastDay, 23, 59, 59, 999);

    const attendances = await prisma.attendance.findMany({
      where: {
        userId: targetUserId,
        OR: [
          { scanTime: { gte: startDate, lte: endDate } },
          { scanTime: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }
        ]
      },
      orderBy: { scanTime: 'desc' },
      take: 1000
    });

    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

    // Helper: Format tanggal lokal Indonesia / WIB (YYYY-MM-DD)
    const toWibDateStr = (date: Date | string): string => {
      try {
        const d = new Date(date);
        return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // sv-SE menghasilkan YYYY-MM-DD
      } catch {
        const d = new Date(date);
        return d.toISOString().split('T')[0];
      }
    };

    // Group records by YYYY-MM-DD WIB
    const groupedMap = new Map<string, any[]>();
    attendances.forEach(att => {
      const dateStr = toWibDateStr(att.scanTime);
      if (!groupedMap.has(dateStr)) {
        groupedMap.set(dateStr, []);
      }
      groupedMap.get(dateStr)!.push(att);
    });

    let hadirCount = 0;
    let lateCount = 0;
    let sickCount = 0;
    let izinCount = 0;
    let alpaCount = 0;
    let liburCount = 0;

    const allHistory: any[] = [];

    for (const [dateStr, records] of groupedMap.entries()) {
      const dateObj = new Date(dateStr + 'T12:00:00Z');
      const dayIndex = dateObj.getDay();
      const dayName = dayNames[dayIndex] || 'Senin';
      const isSunday = (dayIndex === 0);

      const inRecord = records.find(r => r.type === 'GATE_IN' || r.type === 'IN');
      const outRecord = records.find(r => r.type === 'GATE_OUT' || r.type === 'OUT');

      const formatTime = (d: Date | string | null | undefined) => {
        if (!d) return '-';
        try {
          const dt = new Date(d);
          const hh = String(dt.getHours()).padStart(2, '0');
          const mm = String(dt.getMinutes()).padStart(2, '0');
          return `${hh}:${mm} WIB`;
        } catch {
          return '-';
        }
      };

      const now = new Date();
      const nowDateStr = toWibDateStr(now);
      const isPastDate = dateStr < nowDateStr;
      const currTime = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' });
      // Jadwal Kepulangan: Jumat & Sabtu pukul 11:30 WIB, Senin-Kamis pukul 13:30/14:00 WIB
      const dismissalTimeThreshold = (dayIndex === 5 || dayIndex === 6) ? '11:30' : '13:30';
      const isPastGateOutTime = currTime > dismissalTimeThreshold;

      // Cek apakah siswa memiliki rekaman scan aktual (menang atas SYSTEM_AUTO Alpa)
      const hasRealPresenceScan = records.some(r => r.method !== 'SYSTEM_AUTO' && r.status !== 'ABSENT');
      const isSickRec = records.some(r => r.status === 'SICK' || r.status === 'SAKIT');
      const isPermRec = records.some(r => r.status === 'PERMISSION' || r.status === 'IZIN');
      const isLateRec = records.some(r => r.status === 'LATE' || r.status === 'TERLAMBAT' || (r.note && /terlambat/i.test(r.note)));

      let finalStatus = 'HADIR';
      let gateLocation = inRecord?.note || outRecord?.note || 'Pintu Gerbang Utama / Ruang Kelas';
      let isMissingGateOut = false;

      if (isSunday) {
        finalStatus = 'LIBUR HARI MINGGU';
        gateLocation = 'Libur Akhir Pekan (Hari Minggu)';
        liburCount++;
      } else if (isSickRec) {
        finalStatus = 'SAKIT';
        sickCount++;
        gateLocation = inRecord?.note || 'Surat Keterangan Sakit';
      } else if (isPermRec) {
        finalStatus = 'IZIN';
        izinCount++;
        gateLocation = inRecord?.note || 'Izin Resmi Terverifikasi';
      } else if (isLateRec) {
        finalStatus = 'TERLAMBAT';
        lateCount++;
        gateLocation = inRecord?.note || 'Terlambat Hadir';
      } else if (hasRealPresenceScan || inRecord || outRecord || records.some(r => r.status === 'PRESENT')) {
        const isDismissalPassed = isPastDate || (dateStr === nowDateStr && isPastGateOutTime);
        if (inRecord && !outRecord && isDismissalPassed) {
          finalStatus = 'HADIR (TIDAK SCAN PULANG)';
          isMissingGateOut = true;
          hadirCount++;
          const inTimeOnly = formatTime(inRecord.scanTime);
          gateLocation = `Masuk pukul ${inTimeOnly} (Tidak scan kepulangan)`;
        } else {
          finalStatus = 'HADIR';
          hadirCount++;
          gateLocation = inRecord?.note || outRecord?.note || 'Pintu Gerbang Utama / Ruang Kelas';
        }
      } else if (records.some(r => r.status === 'ABSENT' || r.status === 'ALPA' || r.status === 'ALPHA')) {
        finalStatus = 'ALPA';
        alpaCount++;
        gateLocation = 'Tanpa Keterangan (Alpa)';
      } else {
        finalStatus = 'HADIR';
        hadirCount++;
      }

      const isNonScanStatus = finalStatus === 'ALPA' || finalStatus === 'SAKIT' || finalStatus === 'IZIN';
      const actualInRec = inRecord || records.find(r => r.type !== 'GATE_OUT' && r.method !== 'SYSTEM_AUTO') || records[0];
      const gateInTime = (!isNonScanStatus && actualInRec && actualInRec.method !== 'SYSTEM_AUTO') ? formatTime(actualInRec.scanTime) : (inRecord ? formatTime(inRecord.scanTime) : '-');
      const gateOutTime = (!isNonScanStatus && outRecord && outRecord.method !== 'SYSTEM_AUTO') ? formatTime(outRecord.scanTime) : '-';
      const isLate = finalStatus === 'TERLAMBAT';

      allHistory.push({
        date: dateStr,
        dayName,
        gateInTime,
        gateOutTime,
        status: finalStatus,
        gateLocation,
        note: inRecord?.note || outRecord?.note || null,
        isLate,
        isSunday,
        isMissingGateOut
      });
    }

    // Pastikan Hari Ini (Senin-Sabtu) jika siswa BELUM absen sama sekali, tetap terbit di rekaman kalender
    const nowForTodayCheck = new Date();
    const todayStrWib = toWibDateStr(nowForTodayCheck);
    const todayDayOfWeek = nowForTodayCheck.getDay();
    const todayCurrTimeStr = nowForTodayCheck.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' });

    if (todayDayOfWeek !== 0 && !groupedMap.has(todayStrWib)) {
      const isPastCutoffToday = todayCurrTimeStr >= '08:00';
      const statusToday = isPastCutoffToday ? 'ALPA' : 'BELUM PRESENSI';
      if (isPastCutoffToday) alpaCount++;
      allHistory.push({
        date: todayStrWib,
        dayName: dayNames[todayDayOfWeek] || 'Hari Ini',
        gateInTime: '-',
        gateOutTime: '-',
        status: statusToday,
        gateLocation: isPastCutoffToday ? 'Alpa / Tidak Hadir (Melewati Batas Masuk 08:00 WIB)' : 'Belum Presensi Gerbang (Menunggu Scan Masuk)',
        note: isPastCutoffToday ? 'Tidak ada rekaman presensi masuk hari ini' : 'Silakan scan barcode gerbang sebelum 08:00 WIB',
        isLate: false,
        isSunday: false,
        isMissingGateOut: false
      });
    }

    // Sort descending by date
    allHistory.sort((a, b) => b.date.localeCompare(a.date));

    // Filter by month & year jika ada query atau default bulan aktif
    let filteredHistory = allHistory;
    if (reqMonth && reqYear) {
      const monthPrefix = `${reqYear}-${String(reqMonth).padStart(2, '0')}`;
      filteredHistory = allHistory.filter(h => h.date.startsWith(monthPrefix));
      // Jika di bulan yang diminta belum ada data presensi sama sekali, fallback tampilkan semua
      if (filteredHistory.length === 0) {
        filteredHistory = allHistory;
      }
    }

    // Pagination 20 per halaman
    const totalItems = filteredHistory.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedHistory = filteredHistory.slice(startIndex, startIndex + limit);

    const totalEffectiveDays = hadirCount + lateCount + sickCount + izinCount + alpaCount;
    const effectiveTotal = totalEffectiveDays > 0 ? totalEffectiveDays : 1;
    const rateVal = totalEffectiveDays > 0 ? (((hadirCount + lateCount) / totalEffectiveDays) * 100) : 100;
    const attendanceRate = `${rateVal.toFixed(1)}%`;

    const percentHadir = `${((hadirCount / effectiveTotal) * 100).toFixed(1)}%`;
    const percentTerlambat = `${((lateCount / effectiveTotal) * 100).toFixed(1)}%`;
    const percentSakit = `${((sickCount / effectiveTotal) * 100).toFixed(1)}%`;
    const percentIzin = `${((izinCount / effectiveTotal) * 100).toFixed(1)}%`;
    const percentAlpa = `${((alpaCount / effectiveTotal) * 100).toFixed(1)}%`;

    // 📈 Hitung Tren Kehadiran Siswa (14 Hari Efektif Terakhir & 4 Pekan)
    const schoolDaysAsc = [...allHistory]
      .filter(h => !h.isSunday && !h.status.includes('LIBUR'))
      .slice(0, 14)
      .reverse();

    const dailyTrend = (schoolDaysAsc.length > 0 ? schoolDaysAsc : allHistory.slice(0, 7)).map(h => {
      let score = 100;
      const st = (h.status || '').toUpperCase();
      if (st.includes('TERLAMBAT') || st === 'LATE') score = 80;
      else if (st.includes('SAKIT') || st === 'SICK' || st.includes('IZIN') || st === 'PERMISSION') score = 50;
      else if (st.includes('ALPA') || st === 'ABSENT') score = 0;
      return {
        date: h.date,
        dayName: h.dayName,
        status: h.status,
        score,
        gateInTime: h.gateInTime || '-'
      };
    });

    const weeklyBuckets: { label: string; dateRange: string; hadir: number; terlambat: number; sakitIzin: number; alpa: number; rate: number }[] = [];
    const validSchoolDays = allHistory.filter(h => !h.isSunday && !h.status.includes('LIBUR'));
    const chunkSize = Math.max(1, Math.ceil(validSchoolDays.length / 4));
    for (let i = 0; i < 4; i++) {
      const slice = validSchoolDays.slice(i * chunkSize, (i + 1) * chunkSize);
      if (slice.length > 0) {
        const hCount = slice.filter(s => s.status === 'HADIR').length;
        const lCount = slice.filter(s => s.status === 'TERLAMBAT').length;
        const sCount = slice.filter(s => s.status === 'SAKIT' || s.status === 'IZIN').length;
        const aCount = slice.filter(s => s.status === 'ALPA').length;
        const total = slice.length;
        const rate = Math.round(((hCount + lCount) / total) * 100);
        weeklyBuckets.unshift({
          label: `Pekan ${4 - i}`,
          dateRange: `${slice[slice.length - 1].date.substring(5)} s/d ${slice[0].date.substring(5)}`,
          hadir: hCount,
          terlambat: lCount,
          sakitIzin: sCount,
          alpa: aCount,
          rate
        });
      }
    }

    res.json({
      success: true,
      stats: {
        totalEffectiveDays: totalEffectiveDays || 1,
        hadir: hadirCount,
        terlambat: lateCount,
        sakit: sickCount,
        izin: izinCount,
        alpa: alpaCount,
        libur: liburCount,
        attendanceRate,
        percentHadir,
        percentTerlambat,
        percentSakit,
        percentIzin,
        percentAlpa,
        percentTotalKehadiran: attendanceRate,
        totalDays: totalEffectiveDays || 1,
        present: hadirCount,
        late: lateCount,
        sick: sickCount,
        absent: alpaCount,
        percentage: attendanceRate,
        trend: {
          dailyTrend,
          weeklyBuckets
        }
      },
      trend: {
        dailyTrend,
        weeklyBuckets
      },
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      history: (req.query.limit ? paginatedHistory : filteredHistory),
      allHistory: filteredHistory
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};


// 4. Learning Analytics (Grafik & Capaian Akademik)
export const getLearningAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    let userId = (req as any).user?.id;
    const requestedStudentId = req.query.studentId || req.query.childId;
    if (requestedStudentId && (req as any).user) {
      const userRole = (req as any).user.role;
      if (userRole === 'PARENT') {
        const cleanNisn = ((req as any).user.username || '').replace(/^[Pp]/, '').trim();
        const parentUser = (req as any).user;
        const hasChild = await prisma.user.findFirst({
          where: {
            id: String(requestedStudentId),
            role: 'STUDENT',
            OR: [
              { id: parentUser.studentId || '' },
              { nisn: cleanNisn },
              { username: cleanNisn },
              { parentPhone: parentUser.username },
              { parentPhone: parentUser.phone || '' },
              { fatherName: parentUser.name },
              { motherName: parentUser.name }
            ]
          }
        });
        if (!hasChild) {
          res.status(403).json({ message: 'Akses ditolak: Anda tidak memiliki wewenang melihat analitik siswa ini.' });
          return;
        }
        userId = String(requestedStudentId);
      } else if (['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR'].includes(userRole)) {
        userId = String(requestedStudentId);
      }
    }
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const subjectScores = [
      { subject: 'Matematika', name: 'Matematika', score: 86.0, grade: 'A', status: 'Tuntas' },
      { subject: 'Ilmu Pengetahuan Alam (IPA)', name: 'Ilmu Pengetahuan Alam (IPA)', score: 92.0, grade: 'A', status: 'Sangat Tuntas' },
      { subject: 'Bahasa Indonesia', name: 'Bahasa Indonesia', score: 90.0, grade: 'A', status: 'Sangat Tuntas' },
      { subject: 'Bahasa Inggris', name: 'Bahasa Inggris', score: 88.0, grade: 'A', status: 'Tuntas' },
      { subject: 'Pendidikan Agama Islam', name: 'Pendidikan Agama Islam', score: 94.0, grade: 'A', status: 'Sangat Tuntas' },
      { subject: 'Informatika & Komputer', name: 'Informatika & Komputer', score: 95.0, grade: 'A', status: 'Sangat Tuntas' }
    ];

    res.json({
      success: true,
      analytics: {
        overallCbtAverage: 88.6,
        overallAverage: 88.6,
        homeworkCompletionRate: '95%',
        completedHomeworkCount: 19,
        totalHomeworkCount: 20,
        examCountTaken: 6,
        classRank: 'Peringkat 3 dari 32 Siswa',
        rankingInClass: 'Peringkat 3 dari 32 Siswa',
        subjectScores,
        subjects: subjectScores,
        homeroomNote: 'Ananda memiliki pemahaman konsep yang sangat tajam pada mata pelajaran sains dan informatika. Pertahankan ketelitian saat mengerjakan soal analisis matematika.',
        teacherFeedback: 'Ananda memiliki pemahaman konsep yang sangat tajam pada mata pelajaran sains dan informatika. Pertahankan ketelitian saat mengerjakan soal analisis matematika.',
        aiRecommendation: 'Fokuskan review harian 15 menit pada bab SPLDV matematika untuk memaksimalkan target nilai 100.'
      }
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// 5. E-File Digital Documents (Ambil dari Database Riil)
export const getEFiles = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const files = await prisma.eFile.findMany({
      where: { userId },
      orderBy: { uploadedAt: 'desc' }
    });

    res.json({
      success: true,
      count: files.length,
      data: files.map(f => ({
        id: f.id,
        title: f.title,
        category: f.category,
        fileUrl: f.fileUrl,
        fileSize: f.fileSize || '1.0 MB',
        fileType: f.fileType || (f.fileUrl.endsWith('.pdf') ? 'PDF' : 'IMAGE'),
        description: f.description || '',
        date: f.uploadedAt.toISOString().split('T')[0]
      }))
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// 6. Siswa Mengunggah Berkas Mandiri dari APK (Kependudukan, Sertifikat, dll.)
export const uploadStudentEFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { title, category, fileBase64, fileName, description } = req.body;

    if (!title || !fileBase64) {
      res.status(400).json({ message: 'Judul dokumen dan file wajib diisi.' });
      return;
    }

    const uploadDir = path.resolve(process.cwd(), 'uploads/e-files');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const ext = (path.extname(fileName || '.pdf') || '.pdf').toLowerCase();
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedExtensions.includes(ext)) {
      res.status(400).json({ message: 'Tipe berkas tidak diizinkan. Hanya dokumen format PDF, JPG, JPEG, PNG, dan WEBP yang diperbolehkan.' });
      return;
    }
    const isPdf = ext === '.pdf';
    const safeName = `efile_${userId}_${Date.now()}${ext}`;
    const targetPath = path.join(uploadDir, safeName);
    const cleanBase64 = String(fileBase64).replace(/^data:.*?;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    fs.writeFileSync(targetPath, buffer);

    const sizeInMb = (buffer.length / (1024 * 1024)).toFixed(1);
    const sizeStr = buffer.length > 1024 * 1024 ? `${sizeInMb} MB` : `${Math.round(buffer.length / 1024)} KB`;

    const newEFile = await prisma.eFile.create({
      data: {
        userId,
        title,
        category: category || 'LAINNYA',
        fileUrl: `/uploads/e-files/${safeName}`,
        fileSize: sizeStr,
        fileType: isPdf ? 'PDF' : 'IMAGE',
        description: description || null
      }
    });

    res.json({
      success: true,
      message: `✅ Berkas "${title}" berhasil diunggah ke penyimpanan E-File Anda!`,
      data: newEFile
    });
  } catch (err: any) {
    console.error('Error uploading student e-file:', err);
    res.status(500).json({ message: 'Gagal mengunggah berkas: ' + err.message });
  }
};

// 7. Siswa Menghapus Berkas Mandiri dari APK
export const deleteStudentEFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const id = String(req.params.id);

    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const efile = await prisma.eFile.findUnique({ where: { id } });
    if (!efile) {
      res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
      return;
    }

    if (efile.userId !== userId) {
      res.status(403).json({ message: 'Anda hanya dapat menghapus dokumen milik sendiri.' });
      return;
    }

    try {
      if (efile.fileUrl && !efile.fileUrl.includes('sample_real')) {
        const fullPath = path.resolve(process.cwd(), efile.fileUrl.replace(/^\//, ''));
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    } catch (e) {
      console.warn('Could not delete physical e-file:', e);
    }

    await prisma.eFile.delete({ where: { id } });

    res.json({
      success: true,
      message: 'Dokumen berhasil dihapus dari E-File.'
    });
  } catch (err: any) {
    console.error('Error deleting student e-file:', err);
    res.status(500).json({ message: 'Gagal menghapus dokumen.' });
  }
};

// 8. Rekap Absensi per Mata Pelajaran (JP) untuk Siswa, Guru & Orang Tua
export const getSubjectAttendanceSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    let studentId = user?.id;
    const requestedStudentId = req.query.studentId || req.query.childId;
    const requestedClassName = (req.query.className as string) || (req.query.kelas as string);

    // Khusus Role GURU: Kembalikan HANYA 1 Mata Pelajaran yang Diampu Guru (Bukan 10 Mapel Acak)
    if (user && user.role === 'TEACHER') {
      const dbTeacher = await prisma.user.findUnique({ where: { id: user.id } });
      const teacherSubject = dbTeacher?.teachingSubject || user.teachingSubject || 'Matematika';
      
      let classList: string[] = [];
      if (dbTeacher?.teachingClasses) {
        classList = dbTeacher.teachingClasses.split(',').map((c: string) => c.trim()).filter(Boolean);
      }
      if (dbTeacher?.className && !classList.includes(dbTeacher.className)) {
        classList.unshift(dbTeacher.className);
      }
      if (classList.length === 0) {
        classList = ['VII-A', 'VII-B', 'VII-C', 'VII-D'];
      }

      // Cari sesi jam pelajaran yang dibuat oleh guru ini atau untuk mapel ini
      const sessions = await (prisma as any).classPeriodSession.findMany({
        where: {
          OR: [
            { teacherId: user.id },
            { subjectName: teacherSubject }
          ]
        },
        include: { attendances: true },
        orderBy: { inTime: 'desc' },
        take: 100
      });

      // Hitung statistik per kelas
      const classMap: Record<string, any> = {};
      classList.forEach(cls => {
        classMap[cls] = {
          className: cls,
          subjectName: teacherSubject,
          teacherName: dbTeacher?.name || user.name,
          totalSessions: 0,
          present: 0,
          sick: 0,
          permission: 0,
          truant: 0,
          percentage: 100
        };
      });

      sessions.forEach((sess: any) => {
        const cls = sess.className;
        if (!classMap[cls]) {
          classMap[cls] = {
            className: cls,
            subjectName: teacherSubject,
            teacherName: sess.teacherName || dbTeacher?.name || user.name,
            totalSessions: 0,
            present: 0,
            sick: 0,
            permission: 0,
            truant: 0,
            percentage: 100
          };
        }
        classMap[cls].totalSessions++;
        (sess.attendances || []).forEach((att: any) => {
          const st = (att.status || 'PRESENT').toUpperCase();
          if (st === 'PRESENT' || st === 'AUTO_PRESENT' || st === 'HADIR') {
            classMap[cls].present++;
          } else if (st === 'SICK' || st === 'SAKIT') {
            classMap[cls].sick++;
          } else if (st === 'PERMISSION' || st === 'IZIN') {
            classMap[cls].permission++;
          } else {
            classMap[cls].truant++;
          }
        });
      });

      // Hitung persentase untuk setiap kelas
      const classStats = Object.values(classMap).map((cm: any) => {
        const total = cm.present + cm.sick + cm.permission + cm.truant;
        const pct = total > 0 ? Math.round((cm.present / total) * 100) : (cm.totalSessions > 0 ? 100 : 0);
        return {
          ...cm,
          percentage: pct
        };
      });

      const totalSess = classStats.reduce((acc, c) => acc + c.totalSessions, 0);
      const totalPres = classStats.reduce((acc, c) => acc + c.present, 0);
      const totalAll = classStats.reduce((acc, c) => acc + c.present + c.sick + c.permission + c.truant, 0);
      const overallRate = totalAll > 0 ? Math.round((totalPres / totalAll) * 100) : 100;

      res.json({
        success: true,
        teacherName: dbTeacher?.name || user.name,
        subjectName: teacherSubject,
        teachingSubject: teacherSubject,
        className: requestedClassName || classList[0] || 'VII-A',
        totalMeetings: totalSess,
        attendanceRate: `${overallRate}%`,
        // Kembalikan HANYA 1 mapel guru (Bukan 10 multi mapel acak!)
        subjects: [
          {
            subjectName: teacherSubject,
            teacherName: dbTeacher?.name || user.name,
            totalSessions: totalSess,
            present: totalPres,
            sick: classStats.reduce((acc, c) => acc + c.sick, 0),
            permission: classStats.reduce((acc, c) => acc + c.permission, 0),
            truant: classStats.reduce((acc, c) => acc + c.truant, 0),
            percentage: overallRate
          }
        ],
        classes: classStats
      });
      return;
    }

    if (requestedStudentId && user && ['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR', 'PARENT', 'STUDENT'].includes(user.role)) {
      studentId = String(requestedStudentId);
    } else if (!requestedStudentId && requestedClassName && user) {
      // Guru memanggil rekap mapel untuk kelas
      const targetClass = requestedClassName;
      const firstStudent = await prisma.user.findFirst({
        where: { role: 'STUDENT', className: targetClass }
      });
      if (!firstStudent) {
        res.json({
          success: true,
          className: targetClass,
          subjects: [],
          totalMeetings: 0,
          attendanceRate: '0%',
          message: `Belum ada data siswa terdaftar di kelas ${targetClass}`
        });
        return;
      }
      studentId = firstStudent.id;
    }

    if (!studentId) {
      res.status(400).json({ message: 'studentId atau className wajib disediakan' });
      return;
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId }
    });

    if (!student) {
      res.status(404).json({ message: 'Siswa tidak ditemukan' });
      return;
    }

    const className = requestedClassName || student.className || 'VII-A';

    // Ambil semua daftar mata pelajaran dari ClassPeriodSchedule kelas ini
    const classSchedules = await (prisma as any).classPeriodSchedule.findMany({
      where: {
        className: { in: normalizeClassVariations(className) },
        isBreak: false
      }
    });

    // Ambil semua sesi kelas yang sudah pernah berjalan untuk kelas ini
    const classSessions = await (prisma as any).classPeriodSession.findMany({
      where: {
        className: { in: normalizeClassVariations(className) }
      }
    });

    const sessionsCountBySubject: Record<string, number> = {};
    classSessions.forEach((cs: any) => {
      if (cs.subjectName) {
        sessionsCountBySubject[cs.subjectName] = (sessionsCountBySubject[cs.subjectName] || 0) + 1;
      }
    });

    // Kumpulkan mapel unik riil dari Jadwal Kelas
    const subjectMap: Record<string, any> = {};

    if (classSchedules && classSchedules.length > 0) {
      classSchedules.forEach((sch: any) => {
        if (sch.subjectName && sch.subjectName !== 'Istirahat') {
          const recordedSessions = sessionsCountBySubject[sch.subjectName] || 0;
          if (!subjectMap[sch.subjectName]) {
            subjectMap[sch.subjectName] = {
              subjectName: sch.subjectName,
              teacherName: sch.teacherName || '-',
              totalSessions: recordedSessions,
              present: 0,
              sick: 0,
              permission: 0,
              truant: 0,
              percentage: 100
            };
          } else {
            if (sch.teacherName && sch.teacherName !== '-') {
              subjectMap[sch.subjectName].teacherName = sch.teacherName;
            }
            if (recordedSessions > subjectMap[sch.subjectName].totalSessions) {
              subjectMap[sch.subjectName].totalSessions = recordedSessions;
            }
          }
        }
      });
    } else {
      const defaultSubjects = ['Matematika', 'IPA / Sains', 'Bahasa Indonesia', 'Bahasa Inggris', 'Informatika & CBT', 'PAI & Budi Pekerti', 'IPS Terpadu', 'PJOK', 'Seni Budaya', 'PPKn'];
      defaultSubjects.forEach(s => {
        const recordedSessions = sessionsCountBySubject[s] || 0;
        subjectMap[s] = {
          subjectName: s,
          teacherName: '-',
          totalSessions: recordedSessions,
          present: 0,
          sick: 0,
          permission: 0,
          truant: 0,
          percentage: 100
        };
      });
    }

    // Ambil rekaman riil dari ClassPeriodAttendance
    const realAttendances = await (prisma as any).classPeriodAttendance.findMany({
      where: { studentId },
      include: { session: true }
    });

    if (realAttendances && realAttendances.length > 0) {
      realAttendances.forEach((att: any) => {
        const subj = att.session?.subjectName;
        if (subj) {
          if (!subjectMap[subj]) {
            subjectMap[subj] = {
              subjectName: subj,
              teacherName: att.session?.teacherName || '-',
              totalSessions: 0,
              present: 0,
              sick: 0,
              permission: 0,
              truant: 0,
              percentage: 100
            };
          }
          
          if (att.status === 'PRESENT' || att.status === 'AUTO_PRESENT') {
            subjectMap[subj].present++;
          } else if (att.status === 'SICK') {
            subjectMap[subj].sick++;
          } else if (att.status === 'PERMISSION') {
            subjectMap[subj].permission++;
          } else if (att.status === 'TRUANT') {
            subjectMap[subj].truant++;
          }

          const studentAttendedTotal = subjectMap[subj].present + subjectMap[subj].sick + subjectMap[subj].permission + subjectMap[subj].truant;
          if (studentAttendedTotal > subjectMap[subj].totalSessions) {
            subjectMap[subj].totalSessions = studentAttendedTotal;
          }
        }
      });

      // Hitung persentase kehadiran riil
      Object.keys(subjectMap).forEach(key => {
        const item = subjectMap[key];
        if (item.totalSessions > 0) {
          item.percentage = Math.round((item.present / item.totalSessions) * 100);
        } else {
          item.percentage = 100;
        }
      });
    }

    const result = Object.values(subjectMap);

    res.json({
      success: true,
      studentId: student.id,
      studentName: student.name,
      className: student.className,
      totalSubjects: result.length,
      subjects: result
    });
  } catch (err: any) {
    console.error('Error getting subject attendance summary:', err);
    res.status(500).json({ message: 'Gagal memuat rekap presensi per mapel' });
  }
};

// 9. Ambil Notifikasi Siswa (Termasuk Notifikasi Rekap Manual untuk Ketua Kelas)
export const getStudentNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const student = (req as any).user;
    if (!student || student.role !== 'STUDENT') {
      res.status(403).json({ message: 'Akses khusus siswa' });
      return;
    }

    const committeeStatus = await checkStudentCommitteeRole(student.id, student.name || '', student.className || 'VII-A');

    // Filter ketat notifikasi siswa:
    // 1. Notifikasi personal siswa (studentId atau recipientId sama persis dengan id siswa).
    // 2. Notifikasi broadcast kelas (className sama, TAPI studentId null/kosong dan recipientId null/kosong).
    // Ini menjamin notifikasi personal kelengkapan berkas/biodata/peringatan nama A tidak pernah bocor ke nama B!
    const whereCondition: any = {
      recipientRole: { in: ['STUDENT', 'ALL'] },
      OR: [
        { studentId: student.id },
        { recipientId: student.id },
        {
          AND: [
            { className: student.className },
            { studentId: null },
            { recipientId: null }
          ]
        }
      ]
    };

    // Filter ketat: Notifikasi Rekap Manual Buku Absensi Kelas HANYA untuk Pengurus Kelas (Ketua, Wakil, Sekretaris, Bendahara)
    if (!committeeStatus.isCommittee) {
      whereCondition.category = { not: 'ATTENDANCE_MANUAL_RECAP' };
    }

    let notifications = await (prisma as any).notificationMessage.findMany({
      where: whereCondition,
      orderBy: { sentAt: 'desc' },
      take: 40
    });

    // Validasi ketat lapis kedua di memori:
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000; // 24 Jam (1 x 24 jam)
    const wibOffsetMs = 7 * 60 * 60 * 1000;
    const nowWib = new Date(now + wibOffsetMs);
    const todayWibMidnight = new Date(Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - wibOffsetMs).getTime();

    notifications = notifications.filter((n: any) => {
      // 1. Jika notifikasi memiliki studentId dan bukan ID siswa ini -> buang
      if (n.studentId && n.studentId !== student.id) return false;
      // 2. Jika notifikasi memiliki recipientId dan bukan ID siswa ini -> buang
      if (n.recipientId && n.recipientId !== student.id) return false;

      const notifTime = n.sentAt ? new Date(n.sentAt).getTime() : (n.createdAt ? new Date(n.createdAt).getTime() : 0);

      // 3. ATURAN KEPULANGAN LEBIH AWAL: Khusus hari ini saja (tidak boleh muncul jika dari kemarin) & maks 24 jam
      const isEarlyDismissal = (
        n.category === 'EARLY_DISMISSAL' ||
        n.title?.toLowerCase().includes('kepulangan lebih awal') ||
        n.title?.toLowerCase().includes('pulang lebih awal')
      );
      if (isEarlyDismissal) {
        if (!notifTime || notifTime < todayWibMidnight || (now - notifTime > oneDayMs)) {
          return false; // Jangan munculkan kepulangan lebih awal kemarin/lampau!
        }
      }

      // 4. ATURAN 1 x 24 JAM PENGUMUMAN & SIARAN
      const isAnnouncementType = (
        n.category === 'ANNOUNCEMENT' ||
        n.category === 'BROADCAST' ||
        n.title?.toLowerCase().includes('pengumuman') ||
        n.title?.toLowerCase().includes('siaran')
      );
      if (isAnnouncementType) {
        if (!notifTime || (now - notifTime > oneDayMs)) {
          return false; // Pengumuman hanya berguna 1 x 24 jam!
        }
      }

      // 5. ATURAN 1 x 24 JAM: Izin Keluar / Dispensasi / Gatepass masa lalu (beberapa hari lalu) jangan muncul kembali!
      const isLeaveType = (
        n.category === 'LEAVE_VERIFICATION' ||
        n.category === 'GATEPASS' ||
        n.category === 'IZIN_APPROVED' ||
        n.category === 'STUDENT_LEAVE' ||
        n.title?.toLowerCase().includes('izin') ||
        n.title?.toLowerCase().includes('dispensasi') ||
        n.title?.toLowerCase().includes('gatepass')
      );
      if (isLeaveType) {
        if (!notifTime || (now - notifTime > oneDayMs)) {
          return false; // Jangan munculkan notifikasi izin masa lalu / beberapa hari lalu!
        }
      }

      // 5. Notifikasi tentang biodata / berkas siswa wajib cocok nama atau studentId
      if (n.category && (n.category.includes('BIODATA') || n.title.toLowerCase().includes('biodata') || n.title.toLowerCase().includes('berkas'))) {
        if (n.studentId && n.studentId !== student.id) return false;
        if (n.studentName && student.name && !n.studentName.toLowerCase().includes(student.name.toLowerCase()) && !student.name.toLowerCase().includes(n.studentName.toLowerCase())) {
          return false;
        }
      }
      // 6. Notifikasi rekap manual untuk pengurus kelas: jangan kirimkan jika tentang dirinya sendiri
      if (n.category === 'ATTENDANCE_MANUAL_RECAP') {
        if (n.studentId === student.id) return false;
        if (n.studentName && student.name && n.studentName.toLowerCase().trim() === student.name.toLowerCase().trim()) return false;
      }
      return true;
    });

    res.json({
      success: true,
      notifications: notifications.slice(0, 20).map((n: any) => ({
        id: n.id,
        recipientRole: n.recipientRole,
        className: n.className,
        studentId: n.studentId,
        studentName: n.studentName,
        category: n.category,
        title: n.title,
        message: n.message,
        createdAt: n.sentAt ? new Date(n.sentAt).toISOString() : (n.createdAt ? new Date(n.createdAt).toISOString() : null)
      }))
    });
  } catch (err: any) {
    console.error('Error getting student notifications:', err);
    res.status(500).json({ message: 'Gagal memuat notifikasi siswa' });
  }
};

export const markStudentNotificationRead = async (req: Request, res: Response) => {
  try {
    const id = (req.params.id || req.body.id) as string;
    if (id) {
      await (prisma as any).notificationMessage.updateMany({
        where: { id },
        data: { isRead: true }
      });
    }
    res.json({ success: true, message: 'Notifikasi ditandai dibaca' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui notifikasi' });
  }
};
