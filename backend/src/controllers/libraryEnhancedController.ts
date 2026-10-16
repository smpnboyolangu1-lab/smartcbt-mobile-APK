import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ========================================================
// 1. DASHBOARD & SIRKULASI OPERATOR (MODUL 3-A)
// ========================================================
export const getLibraryOperatorDashboard = async (req: Request, res: Response) => {
    try {
        const totalBooks = await prisma.libraryMasterBook.count();
        const activeLoans = await prisma.libraryLoan.count({
            where: { statusPinjam: 'AKTIF' }
        });

        const now = new Date();
        const overdueLoans = await prisma.libraryLoan.findMany({
            where: {
                statusPinjam: 'AKTIF',
                jatuhTempo: { lt: now }
            },
            include: {
                eksemplar: { include: { buku: true } }
            }
        });

        const pendingReservations = await prisma.libraryBookReservation.count({
            where: { status: 'MENUNGGU' }
        });

        return res.json({
            success: true,
            stats: {
                totalBooks,
                activeLoans,
                overdueLoansCount: overdueLoans.length,
                pendingReservations
            },
            overdueLoans
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const quickCirculationScan = async (req: Request, res: Response) => {
    try {
        const { barcodeCode, siswaId, actionType, operatorId, loanDays } = req.body;
        // actionType: 'BORROW' | 'RETURN'

        if (!barcodeCode) {
            return res.status(400).json({ success: false, message: 'barcodeCode eksemplar buku wajib diisi' });
        }

        // Cari eksemplar buku berdasarkan barcode fisik
        const copy = await prisma.libraryBookCopy.findUnique({
            where: { barcodeCode },
            include: { buku: true }
        });

        if (!copy) {
            return res.status(404).json({ success: false, message: 'Eksemplar buku tidak ditemukan dengan barcode tersebut' });
        }

        if (actionType === 'BORROW') {
            if (!siswaId) {
                return res.status(400).json({ success: false, message: 'siswaId wajib disertakan saat meminjam buku' });
            }

            // 1. Validasi Kategori: Buku Referensi Hanya Baca di Tempat
            const kategoriUpper = (copy.buku.kategori || '').toUpperCase();
            if (kategoriUpper === 'REFERENSI' || kategoriUpper === 'KAMUS' || kategoriUpper === 'ENSIKLOPEDIA') {
                return res.status(400).json({
                    success: false,
                    message: `Buku kategori "${copy.buku.kategori}" hanya dapat dibaca di tempat (ruang perpustakaan) dan tidak dapat dipinjam bawa pulang.`
                });
            }

            // 2. Batas Pinjam Maksimal 3 Buku Umum per Siswa
            const activeLoansCount = await prisma.libraryLoan.count({
                where: {
                    siswaId,
                    statusPinjam: 'AKTIF'
                }
            });
            if (activeLoansCount >= 3) {
                return res.status(400).json({
                    success: false,
                    message: 'Batas maksimum peminjaman tercapai (maksimal 3 buku). Silakan kembalikan buku sebelumnya terlebih dahulu.'
                });
            }

            if (copy.status !== 'TERSEDIA') {
                return res.status(400).json({ success: false, message: `Buku sedang berstatus ${copy.status}` });
            }

            // 3. Hitung Jatuh Tempo Konsisten Asia/Jakarta
            const borrowDuration = loanDays || 7;
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + borrowDuration);
            // Standarisasi jam akhir operasional perpus: 15:00 WIB (08:00 UTC)
            dueDate.setUTCHours(8, 0, 0, 0);

            // Buat transaksi peminjaman baru (bebas biaya/denda)
            const loan = await prisma.libraryLoan.create({
                data: {
                    siswaId,
                    eksemplarId: copy.id,
                    jatuhTempo: dueDate,
                    statusPinjam: 'AKTIF',
                    denda: 0.0,
                    statusDenda: 'LUNAS',
                    operatorId
                }
            });

            // Update status eksemplar jadi DIPINJAM
            await prisma.libraryBookCopy.update({
                where: { id: copy.id },
                data: { status: 'DIPINJAM' }
            });

            return res.json({
                success: true,
                message: `Buku "${copy.buku.judul}" berhasil dipinjam hingga ${dueDate.toLocaleDateString('id-ID')}. Bebas denda keterlambatan.`,
                data: loan
            });
        } else if (actionType === 'RETURN') {
            // Cari peminjaman aktif
            const activeLoan = await prisma.libraryLoan.findFirst({
                where: {
                    eksemplarId: copy.id,
                    statusPinjam: 'AKTIF'
                },
                orderBy: { tanggalPinjam: 'desc' }
            });

            if (!activeLoan) {
                return res.status(404).json({ success: false, message: 'Tidak ditemukan transaksi peminjaman aktif untuk eksemplar ini' });
            }

            const now = new Date();
            // KEBIJAKAN SEKOLAH HUMANIS: Bebas denda finansial 100%
            const fine = 0;

            const updatedLoan = await prisma.libraryLoan.update({
                where: { id: activeLoan.id },
                data: {
                    tanggalKembali: now,
                    statusPinjam: 'SELESAI',
                    denda: 0.0,
                    statusDenda: 'LUNAS'
                }
            });

            // Kembalikan status eksemplar jadi TERSEDIA
            await prisma.libraryBookCopy.update({
                where: { id: copy.id },
                data: { status: 'TERSEDIA' }
            });

            // Cek apakah ada reservasi menunggu untuk buku ini -> notifikasi otomatis
            const reservation = await prisma.libraryBookReservation.findFirst({
                where: { bukuId: copy.bukuId, status: 'MENUNGGU' },
                orderBy: { tanggalReservasi: 'asc' }
            });
            if (reservation) {
                await prisma.libraryBookReservation.update({
                    where: { id: reservation.id },
                    data: { status: 'TERSEDIA' }
                });
            }

            return res.json({
                success: true,
                message: `Pengembalian buku "${copy.buku.judul}" berhasil dicatat. Terima kasih telah menjaga dan mengembalikan buku sekolah tepat waktu.`,
                data: updatedLoan,
                denda: 0
            });
        }

        return res.status(400).json({ success: false, message: 'actionType harus BORROW atau RETURN' });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 2. KATALOG & PEMINJAMAN SISWA ALA E-COMMERCE (MODUL 3-B)
// ========================================================
export const getStudentBookCatalog = async (req: Request, res: Response) => {
    try {
        const { search, kategori, availableOnly } = req.query;

        const whereClause: any = {};
        if (search) {
            whereClause.OR = [
                { judul: { contains: String(search) } },
                { pengarang: { contains: String(search) } },
                { isbn: { contains: String(search) } }
            ];
        }
        if (kategori) {
            whereClause.kategori = String(kategori);
        }

        const books = await prisma.libraryMasterBook.findMany({
            where: whereClause,
            include: {
                copies: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // Format ala e-commerce dengan stock ketersediaan
        const formattedBooks = books.map(b => {
            const availableCopies = b.copies.filter(c => c.status === 'TERSEDIA').length;
            return {
                id: b.id,
                judul: b.judul,
                pengarang: b.pengarang,
                penerbit: b.penerbit,
                kategori: b.kategori,
                coverUrl: b.coverUrl,
                sinopsis: b.sinopsis,
                kodeRak: b.kodeRak,
                hasEbook: !!b.ebookPdfUrl,
                ebookPdfUrl: b.ebookPdfUrl,
                totalCopies: b.copies.length,
                availableCopies,
                isAvailable: availableCopies > 0
            };
        });

        const result = availableOnly === 'true' ? formattedBooks.filter(b => b.isAvailable) : formattedBooks;

        return res.json({ success: true, count: result.length, data: result });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const reserveBookStudent = async (req: Request, res: Response) => {
    try {
        const { siswaId, bukuId } = req.body;

        if (!siswaId || !bukuId) {
            return res.status(400).json({ success: false, message: 'siswaId dan bukuId wajib diisi' });
        }

        const reservation = await prisma.libraryBookReservation.create({
            data: {
                siswaId,
                bukuId,
                status: 'MENUNGGU'
            }
        });

        return res.json({
            success: true,
            message: 'Reservasi buku berhasil. Anda akan menerima notifikasi saat buku tersedia untuk diambil fisik di perpustakaan.',
            data: reservation
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
