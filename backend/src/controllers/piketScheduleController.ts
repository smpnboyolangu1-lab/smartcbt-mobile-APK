import { Request, Response } from 'express';
import prisma from '../utils/db';
import { logAudit } from '../services/auditLogger';

const DAY_NAMES = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

// Helper mendapatkan nomor hari saat ini (1 = Senin ... 6 = Sabtu, 0 = Minggu)
export const getCurrentDayOfWeek = (): number => {
    // Waktu Indonesia Barat (WIB = UTC+7)
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const wibDate = new Date(utc + (3600000 * 7));
    return wibDate.getDay();
};

// 1. Ambil Seluruh Jadwal Piket Mingguan (Senin - Sabtu)
export const getWeeklyPiketSchedules = async (req: Request, res: Response) => {
    try {
        const schedules = await prisma.piketSchedule.findMany({
            include: {
                teacher: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        teachingSubject: true,
                        teachingClasses: true,
                        role: true
                    }
                }
            },
            orderBy: [
                { dayOfWeek: 'asc' },
                { startTime: 'asc' }
            ]
        });

        // Hitung statistik per hari
        const dayCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        schedules.forEach(s => {
            if (dayCounts[s.dayOfWeek] !== undefined) {
                dayCounts[s.dayOfWeek]++;
            }
        });

        res.json({
            success: true,
            total: schedules.length,
            dayCounts,
            schedules
        });
    } catch (error) {
        console.error('Error fetching piket schedules:', error);
        res.status(500).json({ message: 'Gagal memuat jadwal piket' });
    }
};

// 2. Operator Menambahkan Jadwal Guru Piket
export const createPiketSchedule = async (req: Request, res: Response) => {
    try {
        const { teacherId, dayOfWeek, startTime, endTime, notes } = req.body;
        const operatorUser = (req as any).user;

        if (!teacherId || dayOfWeek === undefined) {
            return res.status(400).json({ message: 'Guru dan Hari Piket wajib diisi' });
        }

        const parsedDay = parseInt(dayOfWeek);
        const resolvedDayName = DAY_NAMES[parsedDay] || 'SENIN';

        // Validasi guru ada
        const teacher = await prisma.user.findUnique({ where: { id: teacherId } });
        if (!teacher) {
            return res.status(404).json({ message: 'Data guru tidak ditemukan' });
        }

        const newSchedule = await prisma.piketSchedule.create({
            data: {
                teacherId,
                dayOfWeek: parsedDay,
                dayName: resolvedDayName,
                startTime: startTime || '06:30',
                endTime: endTime || '15:00',
                notes: notes || null,
                isActive: true,
                createdBy: operatorUser ? operatorUser.name : 'Operator'
            },
            include: {
                teacher: {
                    select: { id: true, name: true, username: true }
                }
            }
        });

        await logAudit(req, 'CREATE_PIKET_SCHEDULE', `Teacher: ${teacher.name}, Day: ${resolvedDayName}`, {
            dayOfWeek: parsedDay,
            notes
        });

        res.json({
            success: true,
            message: `Jadwal piket hari ${resolvedDayName} berhasil ditambahkan untuk ${teacher.name}`,
            schedule: newSchedule
        });
    } catch (error: any) {
        console.error('Error creating piket schedule:', error);
        res.status(500).json({ message: 'Gagal menambahkan jadwal piket: ' + error.message });
    }
};

// 3. Operator Mengubah Jadwal Piket
export const updatePiketSchedule = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { teacherId, dayOfWeek, startTime, endTime, notes, isActive } = req.body;

        const existing = await prisma.piketSchedule.findUnique({ where: { id: id as string } });
        if (!existing) {
            return res.status(404).json({ message: 'Jadwal piket tidak ditemukan' });
        }

        const parsedDay = dayOfWeek !== undefined ? parseInt(dayOfWeek) : existing.dayOfWeek;
        const resolvedDayName = DAY_NAMES[parsedDay] || existing.dayName;

        const updated = await prisma.piketSchedule.update({
            where: { id: id as string },
            data: {
                teacherId: teacherId || existing.teacherId,
                dayOfWeek: parsedDay,
                dayName: resolvedDayName,
                startTime: startTime !== undefined ? startTime : existing.startTime,
                endTime: endTime !== undefined ? endTime : existing.endTime,
                notes: notes !== undefined ? notes : existing.notes,
                isActive: isActive !== undefined ? isActive : existing.isActive
            },
            include: {
                teacher: {
                    select: { id: true, name: true, username: true }
                }
            }
        });

        res.json({
            success: true,
            message: 'Jadwal piket berhasil diperbarui',
            schedule: updated
        });
    } catch (error) {
        console.error('Error updating piket schedule:', error);
        res.status(500).json({ message: 'Gagal memperbarui jadwal piket' });
    }
};

// 4. Operator Menghapus Jadwal Piket
export const deletePiketSchedule = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await prisma.piketSchedule.delete({ where: { id: id as string } });
        res.json({ success: true, message: 'Jadwal piket berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting piket schedule:', error);
        res.status(500).json({ message: 'Gagal menghapus jadwal piket' });
    }
};

// 5. Mengambil Guru Piket Aktif Hari Ini (Bisa diakses Guru & Operator)
export const getTodayOnDutyTeachers = async (req: Request, res: Response) => {
    try {
        const currentDay = getCurrentDayOfWeek();
        const dayName = DAY_NAMES[currentDay] || 'SENIN';

        const onDuty = await prisma.piketSchedule.findMany({
            where: {
                dayOfWeek: currentDay,
                isActive: true
            },
            include: {
                teacher: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        teachingSubject: true,
                        teachingClasses: true
                    }
                }
            }
        });

        res.json({
            success: true,
            currentDay,
            dayName,
            totalOnDuty: onDuty.length,
            teachers: onDuty.map(s => ({
                scheduleId: s.id,
                teacherId: s.teacher.id,
                name: s.teacher.name,
                nip: s.teacher.username,
                subject: s.teacher.teachingSubject || '-',
                classes: s.teacher.teachingClasses || '-',
                startTime: s.startTime,
                endTime: s.endTime,
                notes: s.notes
            }))
        });
    } catch (error) {
        console.error('Error fetching today piket teachers:', error);
        res.status(500).json({ message: 'Gagal memuat guru piket hari ini' });
    }
};

// 6. Cek Status Piket Guru yang Sedang Login (Dipanggil oleh APK Guru)
export const checkTeacherPiketStatus = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ message: 'Unauthorized' });

        const currentDay = getCurrentDayOfWeek();
        const dayName = DAY_NAMES[currentDay] || 'SENIN';

        // Cek apakah user ada di jadwal piket hari ini
        const schedule = await prisma.piketSchedule.findFirst({
            where: {
                teacherId: user.id,
                dayOfWeek: currentDay,
                isActive: true
            }
        });

        // Hitung laporan kelas kosong hari ini yang PENDING
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const pendingCount = await prisma.emptyClassReport.count({
            where: {
                createdAt: { gte: todayStart },
                status: 'PENDING'
            }
        });

        // Ambil juga rekan guru piket hari ini
        const onDuty = await prisma.piketSchedule.findMany({
            where: { dayOfWeek: currentDay, isActive: true },
            include: { teacher: { select: { id: true, name: true, username: true } } }
        });

        res.json({
            success: true,
            isPiketToday: !!schedule,
            isOnDutyToday: !!schedule,
            dayOfWeek: dayName,
            dayName,
            notes: schedule?.notes || null,
            scheduleDetails: schedule ? {
                startTime: schedule.startTime,
                endTime: schedule.endTime,
                notes: schedule.notes
            } : null,
            pendingEmptyClassesCount: pendingCount,
            pendingReportsCount: pendingCount,
            onDutyTeachers: onDuty.map(d => ({
                id: d.teacher.id,
                name: d.teacher.name,
                username: d.teacher.username,
                notes: d.notes
            }))
        });
    } catch (error) {
        console.error('Error checking teacher piket status:', error);
        res.status(500).json({ message: 'Gagal memeriksa status piket' });
    }
};

// 7. Mengambil Laporan Kelas Kosong Khusus untuk Guru Piket di APK
export const getTeacherPiketReports = async (req: Request, res: Response) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const reports = await prisma.emptyClassReport.findMany({
            where: {
                createdAt: { gte: todayStart }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            count: reports.length,
            reports
        });
    } catch (error) {
        console.error('Error fetching piket reports for teacher:', error);
        res.status(500).json({ message: 'Gagal memuat laporan piket' });
    }
};


/**
 * 8. Berita Acara Pelaksanaan (BAP) Piket Harian - Data Agregat
 */
export const getBapPiketReport = async (req: Request, res: Response) => {
    try {
        const { date } = req.query;
        let targetDate = new Date();
        if (date && typeof date === 'string') {
            const parsed = new Date(date);
            if (!isNaN(parsed.getTime())) targetDate = parsed;
        }

        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const dayOfWeek = targetDate.getDay();
        const dayName = DAY_NAMES[dayOfWeek] || 'SENIN';

        // 1. Guru Piket Bertugas
        const onDuty = await prisma.piketSchedule.findMany({
            where: { dayOfWeek, isActive: true },
            include: {
                teacher: {
                    select: { id: true, name: true, username: true, teachingSubject: true }
                }
            }
        });

        // 2. Laporan Jam Kosong & Penanganan
        const emptyReports = await prisma.emptyClassReport.findMany({
            where: { createdAt: { gte: startOfDay, lte: endOfDay } },
            orderBy: { createdAt: 'asc' }
        });

        // 3. Guru Berhalangan Hadir (Izin / Sakit / Dinas Luar)
        const teacherLeaves = await prisma.teacherLeaveRequest.findMany({
            where: {
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay },
                status: 'APPROVED'
            }
        });

        // 4. Keterlambatan Siswa
        const lateAttendances = await prisma.attendance.findMany({
            where: {
                scanTime: { gte: startOfDay, lte: endOfDay },
                type: 'GATE_IN',
                status: 'LATE'
            },
            include: { user: { select: { name: true, className: true } } }
        });

        // Statistik
        const totalEmpty = emptyReports.length;
        const resolvedEmpty = emptyReports.filter(r => r.status === 'RESOLVED' || r.status === 'GURU_INVAL_ASSIGNED' || r.status === 'TUGAS_MANDIRI').length;
        const handledPercentage = totalEmpty > 0 ? Math.round((resolvedEmpty / totalEmpty) * 100) : 100;

        res.json({
            success: true,
            date: startOfDay.toISOString().split('T')[0],
            dayName,
            summary: {
                totalPiketOnDuty: onDuty.length,
                totalEmptyClasses: totalEmpty,
                resolvedEmptyClasses: resolvedEmpty,
                handledPercentage,
                totalAbsentTeachers: teacherLeaves.length,
                totalLateStudents: lateAttendances.length
            },
            piketTeachers: onDuty.map(d => ({
                id: d.teacher.id,
                name: d.teacher.name,
                nip: d.teacher.username,
                subject: d.teacher.teachingSubject || '-',
                shift: `${d.startTime || '07:00'} - ${d.endTime || '14:00'}`,
                notes: d.notes
            })),
            emptyClasses: emptyReports,
            absentTeachers: teacherLeaves.map(l => ({
                name: l.teacherName,
                category: l.category,
                reason: l.reason,
                hasAssignment: !!l.assignmentDetails,
                assignmentDetails: l.assignmentDetails
            })),
            lateStudents: lateAttendances.map(a => ({
                name: a.user?.name || 'Siswa',
                className: a.user?.className || '-',
                time: a.scanTime ? a.scanTime.toISOString().substring(11, 16) : '-',
                note: a.note || 'Terlambat masuk sekolah'
            }))
        });
    } catch (error: any) {
        console.error('Error getting BAP Piket report:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat rekap BAP Piket: ' + error.message });
    }
};

/**
 * 9. Cetak Dokumen Resmi BAP Piket Harian (Format Cetak A4 Standar Dinas)
 */
export const printBapPiketHtml = async (req: Request, res: Response) => {
    try {
        const { date } = req.query;
        let targetDate = new Date();
        if (date && typeof date === 'string') {
            const parsed = new Date(date);
            if (!isNaN(parsed.getTime())) targetDate = parsed;
        }

        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const dayOfWeek = targetDate.getDay();
        const dayName = DAY_NAMES[dayOfWeek] || 'SENIN';

        const [onDuty, emptyReports, teacherLeaves, lateAttendances] = await Promise.all([
            prisma.piketSchedule.findMany({
                where: { dayOfWeek, isActive: true },
                include: { teacher: true }
            }),
            prisma.emptyClassReport.findMany({
                where: { createdAt: { gte: startOfDay, lte: endOfDay } },
                orderBy: { createdAt: 'asc' }
            }),
            prisma.teacherLeaveRequest.findMany({
                where: {
                    startDate: { lte: endOfDay },
                    endDate: { gte: startOfDay },
                    status: 'APPROVED'
                }
            }),
            prisma.attendance.findMany({
                where: {
                    scanTime: { gte: startOfDay, lte: endOfDay },
                    type: 'GATE_IN',
                    status: 'LATE'
                },
                include: { user: true }
            })
        ]);

        const formattedDateStr = targetDate.toLocaleDateString('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        const piketNames = onDuty.map((d, idx) => `${idx + 1}. ${d.teacher.name}`).join('<br>') || 'Tidak ada guru piket terjadwal';
        const koordinatorPiket = onDuty[0]?.teacher?.name || 'Guru Piket Koordinator';

        const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>BAP Piket Harian - ${formattedDateStr}</title>
<style>
  @page { size: A4; margin: 15mm 20mm; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.35; color: #000; }
  .kop { text-align: center; border-bottom: 3px double #000; padding-bottom: 8px; margin-bottom: 14px; }
  .kop h3, .kop h2, .kop p { margin: 2px 0; }
  .kop h2 { font-size: 13pt; text-transform: uppercase; }
  .kop h3 { font-size: 11.5pt; text-transform: uppercase; font-weight: normal; }
  .kop p { font-size: 9pt; font-style: italic; }
  .title { text-align: center; font-weight: bold; font-size: 12.5pt; text-decoration: underline; margin-bottom: 4px; text-transform: uppercase; }
  .sub-title { text-align: center; font-size: 11pt; margin-bottom: 14px; }
  table.data-table { width: 100%; border-collapse: collapse; margin-top: 6px; margin-bottom: 12px; font-size: 10pt; }
  table.data-table th, table.data-table td { border: 1px solid #000; padding: 5px 7px; vertical-align: top; }
  table.data-table th { background-color: #f1f5f9; font-weight: bold; text-align: center; }
  .section-h { font-weight: bold; font-size: 11pt; margin-top: 10px; margin-bottom: 4px; text-transform: uppercase; }
  .sig-block { width: 100%; margin-top: 25px; font-size: 10.5pt; }
</style>
</head>
<body onload="if(new URLSearchParams(window.location.search).get('autoprint')!=='false')window.print()">
  <div class="kop">
    <h3>PEMERINTAH KABUPATEN TULUNGAGUNG<br>DINAS PENDIDIKAN</h3>
    <h2>SMP NEGERI 1 BOYOLANGU</h2>
    <p>Jl. Ki Mangunsarkoro, Boyolangu, Tulungagung, Jawa Timur 66235 | Telp: (0355) 321789</p>
  </div>

  <div class="title">BERITA ACARA PELAKSANAAN PIKET HARIAN</div>
  <div class="sub-title">Hari/Tanggal: <strong>${formattedDateStr}</strong></div>

  <div class="section-h">A. PETUGAS GURU PIKET HARI INI</div>
  <table class="data-table">
    <thead>
      <tr>
        <th width="5%">No</th>
        <th width="35%">Nama Guru Piket</th>
        <th width="25%">NIP / Username</th>
        <th width="20%">Mata Pelajaran</th>
        <th width="15%">Jam Piket</th>
      </tr>
    </thead>
    <tbody>
      ${onDuty.length > 0 ? onDuty.map((d, i) => `
        <tr>
          <td align="center">${i + 1}</td>
          <td>${d.teacher.name}</td>
          <td align="center">${d.teacher.username}</td>
          <td>${d.teacher.teachingSubject || '-'}</td>
          <td align="center">${d.startTime || '07:00'} - ${d.endTime || '14:00'}</td>
        </tr>
      `).join('') : '<tr><td colspan="5" align="center">Tidak ada jadwal piket resmi untuk hari ini.</td></tr>'}
    </tbody>
  </table>

  <div class="section-h">B. REKAPITULASI GURU BERHALANGAN HADIR & DISPOSISI KELAS</div>
  <table class="data-table">
    <thead>
      <tr>
        <th width="5%">No</th>
        <th width="30%">Nama Guru Pengajar</th>
        <th width="15%">Kategori</th>
        <th width="25%">Alasan / Surat Izin</th>
        <th width="25%">Tindak Lanjut Tugas Siswa</th>
      </tr>
    </thead>
    <tbody>
      ${teacherLeaves.length > 0 ? teacherLeaves.map((l, i) => `
        <tr>
          <td align="center">${i + 1}</td>
          <td>${l.teacherName}</td>
          <td align="center"><strong>${l.category}</strong></td>
          <td>${l.reason}</td>
          <td>${l.assignmentDetails ? `📝 ${l.assignmentDetails}` : 'Menunggu koordinasi Guru Piket'}</td>
        </tr>
      `).join('') : '<tr><td colspan="5" align="center">Seluruh guru hadir KBM (Nihil Izin/Sakit).</td></tr>'}
    </tbody>
  </table>

  <div class="section-h">C. LAPORAN KELAS KOSONG & PENANGANAN GURU INVAL / BADAL</div>
  <table class="data-table">
    <thead>
      <tr>
        <th width="5%">No</th>
        <th width="12%">Kelas</th>
        <th width="18%">Jam Pelajaran</th>
        <th width="20%">Mata Pelajaran</th>
        <th width="25%">Guru Inval / Pengganti</th>
        <th width="20%">Status Penanganan</th>
      </tr>
    </thead>
    <tbody>
      ${emptyReports.length > 0 ? emptyReports.map((r, i) => `
        <tr>
          <td align="center">${i + 1}</td>
          <td align="center"><strong>${r.className}</strong></td>
          <td>${r.periodLesson}</td>
          <td>${r.subjectName}</td>
          <td>${r.substituteTeacher || '-'}</td>
          <td align="center"><strong>${r.status}</strong></td>
        </tr>
      `).join('') : '<tr><td colspan="6" align="center">Tidak ada laporan kelas kosong (KBM berjalan 100% tertib).</td></tr>'}
    </tbody>
  </table>

  <div class="section-h">D. CATATAN KHUSUS & KETERTIBAN SISWA</div>
  <p style="margin: 4px 0 10px 0; font-size: 10pt;">
    Tercatat total <strong>${lateAttendances.length}</strong> siswa terlambat masuk gerbang pada jam pertama.<br>
    Kondisi umum proses belajar mengajar berjalan kondusif di bawah pengawasan posko guru piket.
  </p>
  <div style="margin-top: 25px; border-top: 1px dashed #64748b; padding-top: 8px; font-size: 9pt; color: #475569; text-align: right;">
    <em>Dokumen elektronik resmi Smart School SMP Negeri 1 Boyolangu - Digenerate otomatis pada ${new Date().toLocaleString('id-ID')}</em>
  </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err: any) {
        res.status(500).send('Error rendering BAP Piket report: ' + err.message);
    }
};
