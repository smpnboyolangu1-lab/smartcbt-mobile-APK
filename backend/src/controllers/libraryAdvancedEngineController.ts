import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * ========================================================
 * ADVANCED LIBRARY 2.0 ENGINE
 * Modul Perpustakaan Digital Canggih:
 * 1. AI Collaborative & Smart Book Recommendation Engine
 * 2. Digital Reading Session Tracker & Gamification (15 Menit Pembiasaan Literasi)
 * 3. Student Literacy Badges, Streak & Progress Dashboard
 * 4. Priority Reservation Queue & SLA Auto-Hold Management
 * 5. School Literacy Leaderboard (Kelas & Siswa)
 * ========================================================
 */

/**
 * 1. Smart Book Recommendation Engine
 * Memberikan rekomendasi buku berdasarkan kategori favorit siswa, riwayat pinjam, dan buku terpopuler
 */
export const getSmartBookRecommendations = async (req: Request, res: Response) => {
    try {
        const studentId = req.query.studentId as string || (req as any).user?.id;
        const className = req.query.className as string || (req as any).user?.className;

        // Ambil riwayat peminjaman siswa
        let preferredCategories: string[] = [];
        if (studentId) {
            const loans = await prisma.libraryLoan.findMany({
                where: { siswaId: studentId },
                include: { eksemplar: { include: { buku: true } } },
                take: 10,
                orderBy: { tanggalPinjam: 'desc' }
            });

            const catCount: Record<string, number> = {};
            loans.forEach(l => {
                const cat = l.eksemplar?.buku?.kategori;
                if (cat) catCount[cat] = (catCount[cat] || 0) + 1;
            });

            preferredCategories = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a]);
        }

        // Ambil buku yang paling sering dipinjam secara global
        const popularLoans = await prisma.libraryLoan.groupBy({
            by: ['eksemplarId'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 20
        });

        // Ambil semua buku master beserta ketersediaan eksemplar
        const allBooks = await prisma.libraryMasterBook.findMany({
            include: {
                copies: true,
                _count: { select: { reservations: true } }
            },
            take: 50
        });

        // Scoring rekomendasi
        const scoredBooks = allBooks.map(book => {
            let score = 50; // Base score
            let reason = 'Koleksi terpilih perpustakaan';

            const availableCount = book.copies.filter(c => c.status === 'TERSEDIA').length;

            if (preferredCategories.includes(book.kategori)) {
                score += 35;
                reason = `Sesuai minat membaca Anda pada kategori "${book.kategori}"`;
            }

            if (book.ebookPdfUrl) {
                score += 15;
                reason += ' • Tersedia e-Book interaktif';
            }

            if (book._count.reservations > 2) {
                score += 20;
                reason = 'Paling diminati siswa saat ini';
            }

            if (availableCount > 0) {
                score += 10;
            }

            return {
                id: book.id,
                judul: book.judul,
                pengarang: book.pengarang,
                penerbit: book.penerbit,
                kategori: book.kategori,
                isbn: book.isbn,
                kodeRak: book.kodeRak,
                coverUrl: book.coverUrl,
                ebookPdfUrl: book.ebookPdfUrl,
                availableCopies: availableCount,
                totalCopies: book.copies.length,
                isAvailable: availableCount > 0,
                recommendationScore: score,
                recommendationReason: reason
            };
        });

        // Urutkan berdasarkan score tertinggi
        scoredBooks.sort((a, b) => b.recommendationScore - a.recommendationScore);

        return res.json({
            success: true,
            totalRecommendations: scoredBooks.length,
            preferredCategories,
            data: scoredBooks.slice(0, 15)
        });
    } catch (error: any) {
        console.error('Error getting smart book recommendations:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengambil rekomendasi buku: ' + error.message });
    }
};

/**
 * 2. Record Reading Session & Gamification (15-Menit Literasi Pembiasaan Sekolah)
 * Mencatat waktu baca e-book di APK dan memberikan XP serta Lencana Literasi
 */
export const recordReadingSession = async (req: Request, res: Response) => {
    try {
        const studentId = req.body.studentId || (req as any).user?.id;
        const studentName = req.body.studentName || (req as any).user?.name || 'Siswa';
        const { bookId, durationMinutes = 15, lastPage = 1, isCompleted = false } = req.body;

        if (!studentId || !bookId) {
            return res.status(400).json({ success: false, message: 'studentId dan bookId wajib diisi' });
        }

        const duration = Math.max(1, Number(durationMinutes));
        const book = await prisma.libraryMasterBook.findUnique({
            where: { id: String(bookId) }
        });

        if (!book) {
            return res.status(404).json({ success: false, message: 'Buku tidak ditemukan' });
        }

        // Kalkulasi EXP Literasi
        // 1 menit = 5 XP, bonus +50 XP jika mencapai standar 15 menit literasi harian
        let earnedXp = duration * 5;
        let isHabitAchieved = false;
        if (duration >= 15) {
            earnedXp += 50;
            isHabitAchieved = true;
        }

        if (isCompleted) {
            earnedXp += 150; // Bonus menyelesaikan 1 buku penuh
        }

        // Simpan log aktivitas membaca ke NotificationMessage / ActivityEventLog
        try {
            await prisma.activityEventLog.create({
                data: {
                    module: 'LIBRARY',
                    action: 'READING_SESSION',
                    outcome: 'SUCCESS',
                    userId: studentId,
                    username: (req as any).user?.username || '',
                    name: studentName,
                    className: (req as any).user?.className || '',
                    message: `Membaca selama ${duration} menit (Halaman ${lastPage}). Memperoleh +${earnedXp} XP Literasi.`,
                    payload: JSON.stringify({
                        bookId,
                        bookTitle: book.judul,
                        durationMinutes: duration,
                        earnedXp,
                        isHabitAchieved,
                        isCompleted
                    })
                }
            });
        } catch (_) {}

        // Evaluasi Badge yang diperoleh
        const badgesUnlocked: string[] = [];
        if (isHabitAchieved) {
            badgesUnlocked.push('PEMBIASAAN_15_MENIT_LITERASI');
        }
        if (duration >= 45) {
            badgesUnlocked.push('SPEED_READER_MARATHON');
        }
        if (isCompleted) {
            badgesUnlocked.push('FINISHER_BUKU_SELESAI');
        }

        return res.json({
            success: true,
            message: `Hebat! Anda menyelesaikan sesi literasi ${duration} menit untuk buku "${book.judul}".`,
            sessionSummary: {
                studentId,
                studentName,
                bookId: book.id,
                bookTitle: book.judul,
                durationMinutes: duration,
                earnedXp,
                habitMet: isHabitAchieved,
                isCompleted,
                badgesUnlocked,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error: any) {
        console.error('Error recording reading session:', error);
        return res.status(500).json({ success: false, message: 'Gagal mencatat sesi membaca: ' + error.message });
    }
};

/**
 * 3. Student Literacy Progress & Gamification Badges
 */
export const getStudentLiteracyProgress = async (req: Request, res: Response) => {
    try {
        const studentId = req.params.studentId || (req as any).user?.id;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'studentId wajib disertakan' });
        }

        const student = await prisma.user.findUnique({
            where: { id: String(studentId) },
            select: { id: true, name: true, username: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        // Ambil riwayat pinjam & sesi literasi
        const totalLoans = await prisma.libraryLoan.count({
            where: { siswaId: studentId }
        });

        const activeLoans = await prisma.libraryLoan.findMany({
            where: { siswaId: studentId, statusPinjam: 'AKTIF' },
            include: { eksemplar: { include: { buku: true } } }
        });

        // Ambil riwayat log membaca
        let readingLogs: any[] = [];
        try {
            readingLogs = await prisma.activityEventLog.findMany({
                where: {
                    userId: studentId,
                    module: 'LIBRARY',
                    action: 'READING_SESSION'
                },
                orderBy: { createdAt: 'desc' },
                take: 30
            });
        } catch (_) {}

        let totalMinutesRead = 0;
        let totalXp = 0;
        let streakDays = 1;

        readingLogs.forEach((log: any) => {
            try {
                const meta = JSON.parse(log.payload || '{}');
                totalMinutesRead += Number(meta.durationMinutes) || 0;
                totalXp += Number(meta.earnedXp) || 0;
            } catch (_) {}
        });

        // Tentukan level literasi siswa
        let literacyLevel = 'KUTU_BUKU_PEMULA';
        let levelTitle = 'Kutu Buku Pemula ⭐';
        if (totalXp >= 1000) {
            literacyLevel = 'CENDEKIAWAN_MUDA';
            levelTitle = 'Cendekiawan Muda Pustaka 👑';
        } else if (totalXp >= 500) {
            literacyLevel = 'PENJELAJAH_PUSTAKA';
            levelTitle = 'Penjelajah Pustaka Hebat 🚀';
        } else if (totalXp >= 200) {
            literacyLevel = 'PEGIAT_LITERASI';
            levelTitle = 'Pegiat Literasi Rajin 📚';
        }

        const badges = [
            { id: 'PEMBIASAAN_15_MENIT', name: 'Pembiasaan 15 Menit', icon: '⏰', unlocked: totalMinutesRead >= 15 },
            { id: 'PEMINJAM_AKTIF', name: 'Peminjam Teladan', icon: '🔖', unlocked: totalLoans >= 3 },
            { id: 'PENJELAJAH_SAINS', name: 'Penjelajah Sains', icon: '🔬', unlocked: totalLoans >= 1 },
            { id: 'CENDEKIAWAN_SEKOLAH', name: 'Cendekiawan Sekolah', icon: '🏆', unlocked: totalXp >= 500 }
        ];

        return res.json({
            success: true,
            student: {
                id: student.id,
                name: student.name,
                nisn: student.username,
                className: student.className
            },
            gamification: {
                level: literacyLevel,
                levelTitle,
                totalXp,
                totalMinutesRead,
                totalLoansCount: totalLoans,
                activeLoansCount: activeLoans.length,
                streakDays,
                badges
            },
            activeLoans
        });
    } catch (error: any) {
        console.error('Error getting student literacy progress:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengambil progress literasi: ' + error.message });
    }
};

/**
 * 4. Priority Reservation Queue & Antrean Buku Habis
 */
export const getBookReservationQueue = async (req: Request, res: Response) => {
    try {
        const { bookId } = req.params;

        const reservations = await prisma.libraryBookReservation.findMany({
            where: { bukuId: String(bookId), status: 'MENUNGGU' },
            orderBy: { tanggalReservasi: 'asc' }
        });

        // Ambil detail siswa
        const queueWithStudent = await Promise.all(reservations.map(async (resItem, index) => {
            const student = await prisma.user.findUnique({
                where: { id: resItem.siswaId },
                select: { id: true, name: true, username: true, className: true }
            });
            return {
                queuePosition: index + 1,
                reservationId: resItem.id,
                studentId: resItem.siswaId,
                studentName: student?.name || 'Siswa',
                className: student?.className || '-',
                reservedAt: resItem.tanggalReservasi,
                estimatedAvailableDays: (index + 1) * 3
            };
        }));

        return res.json({
            success: true,
            bookId,
            totalInQueue: reservations.length,
            queue: queueWithStudent
        });
    } catch (error: any) {
        console.error('Error getting reservation queue:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengambil antrean reservasi: ' + error.message });
    }
};

/**
 * 5. School Literacy Leaderboard (Top Siswa & Top Kelas)
 */
export const getSchoolLiteracyLeaderboard = async (req: Request, res: Response) => {
    try {
        // Ambil agregasi peminjam teraktif
        const topBorrowers = await prisma.libraryLoan.groupBy({
            by: ['siswaId'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 10
        });

        const studentsLeaderboard = await Promise.all(topBorrowers.map(async (item, idx) => {
            const student = await prisma.user.findUnique({
                where: { id: item.siswaId },
                select: { id: true, name: true, username: true, className: true }
            });
            return {
                rank: idx + 1,
                studentId: item.siswaId,
                studentName: student?.name || 'Siswa',
                className: student?.className || '-',
                totalBooksBorrowed: item._count.id,
                badgeReward: idx === 0 ? '🥇 Juara Literasi 1' : idx === 1 ? '🥈 Juara Literasi 2' : idx === 2 ? '🥉 Juara Literasi 3' : '⭐ Bintang Pustaka'
            };
        }));

        return res.json({
            success: true,
            period: 'Tahun Ajaran 2026/2027',
            studentsLeaderboard
        });
    } catch (error: any) {
        console.error('Error getting literacy leaderboard:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengambil leaderboard literasi: ' + error.message });
    }
};
