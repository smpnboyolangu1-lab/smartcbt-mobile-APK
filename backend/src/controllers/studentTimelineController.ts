import { Request, Response } from 'express';
import prisma from '../utils/db';
import { formatTimeWibWithSuffix } from '../utils/dateUtils';

export interface TimelineItem {
    id: string;
    type: 'ATTENDANCE' | 'EXAM' | 'HOMEWORK' | 'UKS' | 'BK' | 'LEAVE' | 'LIBRARY' | 'PRAYER';
    title: string;
    category: string;
    timestamp: Date;
    timeFormatted: string;
    dateFormatted: string;
    badgeColor: 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'teal';
    icon: string;
    description: string;
    metadata?: any;
}

/**
 * Controller Timeline Siswa
 * Menggabungkan seluruh rekam jejak aktivitas siswa secara kronologis:
 * 1. Presensi (Gate In, Gate Out, Sholat, KBM)
 * 2. Asesmen CBT (Ujian diambil, nilai)
 * 3. Tugas & PR (Submission, status tuntas)
 * 4. Kunjungan UKS (Pemeriksaan & perawatan)
 * 5. Bimbingan Konseling / Poin Pelanggaran / Prestasi
 * 6. Izin Keluar & Dispensasi (Gatepass)
 * 7. Peminjaman Buku Perpustakaan
 */
export const getStudentTimeline = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const requestedId = req.params.id || req.query.studentId || user?.id;

        if (!requestedId) {
            return res.status(400).json({ success: false, message: 'ID siswa wajib disertakan.' });
        }

        // Cari data siswa
        const student = await prisma.user.findFirst({
            where: {
                role: 'STUDENT',
                OR: [
                    { id: String(requestedId) },
                    { nisn: String(requestedId) },
                    { username: String(requestedId) }
                ]
            },
            select: { id: true, name: true, nisn: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        const studentId = student.id;

        // Ambil data dari berbagai modul secara paralel
        const [
            attendances,
            exams,
            homeworkSubmissions,
            uksVisits,
            bkViolations,
            gatepasses,
            libraryLoans,
            prayerAttendances
        ] = await Promise.all([
            prisma.attendance.findMany({
                where: { userId: studentId },
                orderBy: { scanTime: 'desc' },
                take: 40
            }),
            prisma.studentExam.findMany({
                where: { userId: studentId },
                include: { exam: { select: { title: true, examType: true } } },
                orderBy: { startTime: 'desc' },
                take: 20
            }),
            prisma.homeworkSubmission.findMany({
                where: { userId: studentId },
                include: { homework: { select: { title: true } } },
                orderBy: { submittedAt: 'desc' },
                take: 20
            }),
            prisma.uksVisit.findMany({
                where: { userId: studentId },
                orderBy: { checkInTime: 'desc' },
                take: 15
            }),
            prisma.bkViolationPointRecord.findMany({
                where: { siswaId: studentId },
                orderBy: { tanggal: 'desc' },
                take: 15
            }),
            prisma.gatepassRequest.findMany({
                where: { studentId },
                orderBy: { createdAt: 'desc' },
                take: 15
            }),
            prisma.libraryBorrowing.findMany({
                where: { userId: studentId },
                include: { book: { select: { title: true } } },
                orderBy: { borrowDate: 'desc' },
                take: 15
            }).catch(() => []),
            prisma.studentPrayerAttendance.findMany({
                where: { studentId },
                orderBy: { createdAt: 'desc' },
                take: 20
            }).catch(() => [])
        ]);

        const items: TimelineItem[] = [];

        // 1. Presensi Gerbang
        for (const a of attendances) {
            const time = new Date(a.scanTime);
            const isLate = a.status === 'LATE';
            const isPresent = a.status === 'PRESENT';
            items.push({
                id: `att_${a.id}`,
                type: 'ATTENDANCE',
                title: a.type === 'GATE_IN' ? 'Presensi Masuk Gerbang' : (a.type === 'GATE_OUT' ? 'Presensi Pulang Gerbang' : 'Presensi Kehadiran'),
                category: 'Presensi',
                timestamp: time,
                timeFormatted: formatTimeWibWithSuffix(a.scanTime),
                dateFormatted: time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
                badgeColor: isLate ? 'amber' : (isPresent ? 'green' : 'red'),
                icon: a.type === 'GATE_IN' ? 'log-in' : 'log-out',
                description: `Status: ${a.status} ${a.note ? '(' + a.note + ')' : ''}`,
                metadata: { status: a.status, type: a.type }
            });
        }

        // 1b. Presensi Sholat Berjamaah / Dhuha / Dhuhur / Jumat
        for (const p of (prayerAttendances || [])) {
            const time = new Date(p.createdAt);
            const isBerjamaah = p.status === 'SHOLAT_BERJAMAAH';
            items.push({
                id: `pray_${p.id}`,
                type: 'PRAYER',
                title: `Presensi Ibadah: Sholat ${p.prayerType}`,
                category: 'Ibadah / Sholat',
                timestamp: time,
                timeFormatted: formatTimeWibWithSuffix(p.createdAt),
                dateFormatted: time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
                badgeColor: isBerjamaah ? 'green' : 'amber',
                icon: 'check-circle',
                description: `Status: ${p.status} ${p.notes ? '(' + p.notes + ')' : ''}`,
                metadata: { prayerType: p.prayerType, status: p.status, date: p.date }
            });
        }

        // 2. Ujian CBT
        for (const e of exams) {
            const time = new Date(e.startTime);
            items.push({
                id: `exam_${e.id}`,
                type: 'EXAM',
                title: `Asesmen CBT: ${e.exam?.title || 'Ujian'}`,
                category: 'Akademik / Ujian',
                timestamp: time,
                timeFormatted: formatTimeWibWithSuffix(e.startTime),
                dateFormatted: time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
                badgeColor: 'blue',
                icon: 'file-text',
                description: `Nilai: ${e.score !== null ? e.score : 'Sedang dikoreksi'} • Status: ${e.status}`,
                metadata: { score: e.score, status: e.status }
            });
        }

        // 3. Tugas / PR
        for (const h of homeworkSubmissions) {
            const time = new Date(h.submittedAt);
            items.push({
                id: `hw_${h.id}`,
                type: 'HOMEWORK',
                title: `Pengumpulan Tugas: ${h.homework?.title || 'Tugas'}`,
                category: 'Tugas Siswa',
                timestamp: time,
                timeFormatted: formatTimeWibWithSuffix(h.submittedAt),
                dateFormatted: time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
                badgeColor: 'teal',
                icon: 'check-circle',
                description: `Nilai: ${h.score !== null && h.score !== undefined ? h.score : 'Terkirim'} • Catatan: ${h.teacherNote || 'Sudah diserahkan'}`,
                metadata: { score: h.score }
            });
        }

        // 4. Kunjungan UKS
        for (const u of uksVisits) {
            const time = new Date(u.checkInTime);
            items.push({
                id: `uks_${u.id}`,
                type: 'UKS',
                title: 'Pelayanan Kesehatan UKS',
                category: 'Kesehatan UKS',
                timestamp: time,
                timeFormatted: formatTimeWibWithSuffix(u.checkInTime),
                dateFormatted: time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
                badgeColor: 'purple',
                icon: 'activity',
                description: `Keluhan: ${u.complaint || '-'} • Penanganan: ${u.treatment || '-'}`,
                metadata: { disposition: u.disposition }
            });
        }

        // 5. BK & Pelanggaran
        for (const b of bkViolations) {
            const time = new Date(b.tanggal || b.createdAt);
            items.push({
                id: `bk_${b.id}`,
                type: 'BK',
                title: `Catatan Kedisiplinan: ${b.jenis || 'Pelanggaran'}`,
                category: 'Bimbingan Konseling',
                timestamp: time,
                timeFormatted: formatTimeWibWithSuffix(b.tanggal || b.createdAt),
                dateFormatted: time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
                badgeColor: 'red',
                icon: 'alert-triangle',
                description: `Poin: +${b.bobotPoin || 5} • Pelanggaran: ${b.jenis || '-'}`,
                metadata: { poin: b.bobotPoin }
            });
        }

        // 6. Gatepass & Dispensasi
        for (const g of gatepasses) {
            const time = new Date(g.createdAt);
            items.push({
                id: `gp_${g.id}`,
                type: 'LEAVE',
                title: `Izin Keluar / Dispensasi: ${g.leaveCategory || 'Izin'}`,
                category: 'Dispensasi',
                timestamp: time,
                timeFormatted: formatTimeWibWithSuffix(g.createdAt),
                dateFormatted: time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
                badgeColor: g.status === 'COMPLETED' ? 'green' : 'amber',
                icon: 'external-link',
                description: `Alasan: ${g.reason} • Status: ${g.status}`,
                metadata: { status: g.status, checkoutTime: g.exitTimestamp }
            });
        }

        // 7. Perpustakaan
        for (const l of libraryLoans) {
            const time = new Date(l.borrowDate);
            items.push({
                id: `lib_${l.id}`,
                type: 'LIBRARY',
                title: `Peminjaman Buku: ${l.book?.title || 'Buku Perpustakaan'}`,
                category: 'Perpustakaan',
                timestamp: time,
                timeFormatted: formatTimeWibWithSuffix(l.borrowDate),
                dateFormatted: time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
                badgeColor: 'teal',
                icon: 'book',
                description: `Status: ${l.status || 'DIPINJAM'} • Batas Kembali: ${new Date(l.dueDate).toLocaleDateString('id-ID')}`,
                metadata: { status: l.status }
            });
        }

        // Urutkan kronologis dari paling baru ke paling lama
        items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        res.json({
            success: true,
            student: {
                id: student.id,
                name: student.name,
                nisn: student.nisn,
                className: student.className
            },
            totalActivities: items.length,
            timeline: items
        });
    } catch (error: any) {
        console.error('Error in getStudentTimeline:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat timeline siswa' });
    }
};
