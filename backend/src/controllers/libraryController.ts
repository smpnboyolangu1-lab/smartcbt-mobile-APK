import { Request, Response } from 'express';
import prisma from '../utils/db';
import path from 'path';
import fs from 'fs';

// 1. Ambil Katalog Buku & E-Book (dengan filter Kelas & Mapel)
export const getBooks = async (req: Request, res: Response) => {
    try {
        const { gradeClass, subject, category, search } = req.query;

        const whereClause: any = {};
        if (gradeClass && gradeClass !== 'ALL') {
            whereClause.OR = [
                { gradeClass: String(gradeClass) },
                { gradeClass: 'UMUM' },
                { gradeClass: null }
            ];
        }
        if (subject && subject !== 'ALL') {
            whereClause.subject = String(subject);
        }
        if (category && category !== 'ALL') {
            whereClause.category = String(category);
        }
        if (search && typeof search === 'string') {
            whereClause.OR = [
                { title: { contains: search } },
                { author: { contains: search } },
                { barcodeCode: { contains: search } }
            ];
        }

        const books = await prisma.libraryBook.findMany({
            where: whereClause,
            include: {
                copies: true,
                borrowings: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                className: true
                            }
                        }
                    },
                    orderBy: { borrowDate: 'desc' }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const totalTitles = books.length;
        const totalStock = books.reduce((acc, b) => acc + (b.copies.length > 0 ? b.copies.length : b.stock), 0);
        const totalBorrowed = books.reduce((acc, b) => acc + b.copies.filter(c => c.status === 'BORROWED').length, 0);
        const totalEbooks = books.filter(b => !!b.ebookUrl).length;

        res.json({
            success: true,
            summary: {
                totalTitles,
                totalStock,
                activeBorrowings: totalBorrowed,
                availableEbooks: totalEbooks
            },
            books: books.map(b => ({
                id: b.id,
                title: b.title,
                author: b.author,
                publisher: b.publisher || 'Kemendikbudristek',
                yearPublished: b.yearPublished || '2025',
                isbn: b.isbn || '-',
                barcodeCode: b.barcodeCode,
                subject: b.subject || 'Umum',
                gradeClass: b.gradeClass || 'Semua Kelas',
                category: b.category,
                semester: b.semester || '1 Tahun',
                stock: b.copies.length > 0 ? b.copies.length : b.stock,
                coverUrl: b.coverUrl || ('/api/library/cover/' + b.id),
                ebookUrl: b.ebookUrl || null,
                hasEbook: !!b.ebookUrl,
                copiesCount: b.copies.length,
                availableCopiesCount: b.copies.filter(c => c.status === 'AVAILABLE').length,
                borrowedCopiesCount: b.copies.filter(c => c.status === 'BORROWED').length,
                recentBorrowers: b.copies.filter(c => c.status === 'BORROWED').slice(0, 5).map(c => ({
                    barcode: c.barcodeCode,
                    studentName: c.currentBorrowerName || '-',
                    className: c.currentBorrowerClass || '-',
                    borrowDate: c.borrowedAt ? c.borrowedAt.toISOString().split('T')[0] : '-'
                }))
            }))
        });
    } catch (error) {
        console.error('Error fetching library books:', error);
        res.status(500).json({ message: 'Gagal mengambil data perpustakaan.' });
    }
};

// 2. Tambah Judul Buku Baru + Upload Berkas PDF Asli + Generator Barcode Eksemplar
export const createBook = async (req: Request, res: Response) => {
    try {
        const {
            title,
            author,
            publisher,
            yearPublished,
            isbn,
            barcodeCode,
            stock,
            subject,
            gradeClass,
            category,
            semester,
            ebookUrl,
            fileBase64,
            fileName
        } = req.body;

        if (!title || !author) {
            return res.status(400).json({ message: 'Judul dan pengarang buku wajib diisi.' });
        }

        const resolvedBarcode = barcodeCode ? barcodeCode.toUpperCase().trim() : 'BKP-' + Math.floor(1000 + Math.random() * 9000);
        const resolvedStock = parseInt(stock) || 5;

        let finalEbookUrl = ebookUrl || null;

        // Jika ada unggahan file PDF asli via Base64 dari Portal Web
        if (fileBase64) {
            try {
                const uploadDir = path.resolve(process.cwd(), 'uploads/ebooks');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                const ext = path.extname(fileName || '.pdf') || '.pdf';
                const safeName = `book_${Date.now()}_${title.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30)}${ext}`;
                const targetPath = path.join(uploadDir, safeName);
                const cleanBase64 = String(fileBase64).replace(/^data:.*?;base64,/, '');
                fs.writeFileSync(targetPath, Buffer.from(cleanBase64, 'base64'));
                finalEbookUrl = `/uploads/ebooks/${safeName}`;
            } catch (fileErr) {
                console.error('Error saving ebook PDF file:', fileErr);
            }
        }

        const newBook = await prisma.libraryBook.create({
            data: {
                title,
                author,
                publisher: publisher || 'Kemendikbudristek',
                yearPublished: yearPublished || String(new Date().getFullYear()),
                isbn: isbn || null,
                barcodeCode: resolvedBarcode,
                stock: resolvedStock,
                subject: subject || 'Matematika',
                gradeClass: gradeClass || 'VII',
                category: category || 'BUKU_PAKET',
                semester: semester || '1 Tahun',
                coverUrl: null,
                ebookUrl: finalEbookUrl
            }
        });

        // Otomatis Buat Eksemplar Fisik & Barcode Statis (Contoh: BKP-MAT7-001 s/d BKP-MAT7-030)
        const copiesData = [];
        for (let i = 1; i <= resolvedStock; i++) {
            const padNum = String(i).padStart(3, '0');
            copiesData.push({
                bookId: newBook.id,
                barcodeCode: `${resolvedBarcode}-${padNum}`,
                copyNumber: i,
                condition: 'BAIK',
                status: 'AVAILABLE'
            });
        }

        for (const copy of copiesData) {
            await (prisma as any).bookCopy.create({
                data: copy
            });
        }

        res.json({
            success: true,
            message: `Buku "${title}" berhasil ditambahkan bersama ${copiesData.length} eksemplar barcode statis!`,
            book: newBook
        });
    } catch (error: any) {
        console.error('Error adding library book:', error);
        res.status(500).json({ message: 'Gagal menambahkan buku: ' + error.message });
    }
};

// 3. Scan Cek Pemilik Buku Paket Tertukar (Digunakan Siswa / Guru di APK via Kamera)
export const checkBookOwnerByBarcode = async (req: Request, res: Response) => {
    try {
        const barcode = String(req.query.barcode || req.body.barcode || '').trim().toUpperCase();
        const user = (req as any).user;

        if (!barcode) {
            return res.status(400).json({ message: 'Barcode buku wajib disertakan.' });
        }

        // Cari eksemplar buku di BookCopy
        const copy = await prisma.bookCopy.findUnique({
            where: { barcodeCode: barcode },
            include: {
                book: true
            }
        });

        if (!copy) {
            // Cek di PackageBookCopy (Buku Paket Kurikulum)
            const pkgCopy = await (prisma as any).packageBookCopy.findUnique({
                where: { barcodeCode: barcode },
                include: {
                    packageBook: true,
                    assignments: {
                        where: { status: 'APPROVED' },
                        include: { student: true }
                    }
                }
            }).catch(() => null);

            if (pkgCopy) {
                const activeAssignment = pkgCopy.assignments?.[0];
                const borrowerStudent = activeAssignment?.student;
                const isMyBook = Boolean(user && borrowerStudent && borrowerStudent.id === user.id);

                return res.json({
                    success: true,
                    found: true,
                    isRegistered: true,
                    isCopy: true,
                    barcode: pkgCopy.barcodeCode,
                    copyNumber: pkgCopy.nomorEksemplar,
                    condition: pkgCopy.kondisi,
                    status: pkgCopy.status === 'DIPINJAM' ? 'BORROWED' : 'AVAILABLE',
                    isMyBook,
                    message: isMyBook
                        ? `Buku Paket "${pkgCopy.packageBook.judul}" adalah buku paket milik Anda.`
                        : (borrowerStudent
                            ? `Buku Paket "${pkgCopy.packageBook.judul}" sedang dipinjam oleh ${borrowerStudent.name} (Kelas ${borrowerStudent.className || '-'}).`
                            : `Buku Paket "${pkgCopy.packageBook.judul}" terdaftar resmi (Eksemplar #${pkgCopy.nomorEksemplar}).`),
                    book: {
                        id: pkgCopy.packageBook.id,
                        title: pkgCopy.packageBook.judul,
                        author: 'Kemendikbudristek',
                        subject: pkgCopy.packageBook.mataPelajaran,
                        publisher: 'Kemendikbudristek',
                        isTextbook: true,
                        targetClass: pkgCopy.packageBook.tingkatKelas,
                        gradeClass: pkgCopy.packageBook.tingkatKelas,
                        ebookUrl: pkgCopy.packageBook.filePdfUrl
                    },
                    copy: {
                        id: pkgCopy.id,
                        copyBarcode: pkgCopy.barcodeCode,
                        copyNumber: pkgCopy.nomorEksemplar,
                        status: pkgCopy.status === 'DIPINJAM' ? 'BORROWED' : 'AVAILABLE',
                        borrowedAt: activeAssignment?.approvedAt ? activeAssignment.approvedAt.toISOString() : null
                    },
                    borrower: borrowerStudent ? {
                        id: borrowerStudent.id,
                        name: borrowerStudent.name,
                        className: borrowerStudent.className,
                        nisn: borrowerStudent.nisn,
                        borrowedAt: activeAssignment?.approvedAt ? activeAssignment.approvedAt.toISOString().split('T')[0] : null
                    } : null,
                    currentViewer: user ? {
                        id: user.id,
                        name: user.name,
                        className: user.className,
                        nisn: user.nisn
                    } : null
                });
            }

            // Cek apakah barcode judul buku utama
            const parentBook = await prisma.libraryBook.findUnique({
                where: { barcodeCode: barcode }
            });
            if (parentBook) {
                return res.json({
                    success: true,
                    found: true,
                    isRegistered: true,
                    isCopy: false,
                    isMyBook: false,
                    message: `Judul Buku: ${parentBook.title}`,
                    book: {
                        id: parentBook.id,
                        title: parentBook.title,
                        author: parentBook.author,
                        subject: parentBook.subject,
                        publisher: (parentBook as any).publisher || null,
                        isTextbook: (parentBook as any).isTextbook ?? false,
                        targetClass: parentBook.gradeClass,
                        gradeClass: parentBook.gradeClass,
                        ebookUrl: parentBook.ebookUrl
                    },
                    copy: null,
                    borrower: null,
                    currentViewer: user ? {
                        id: user.id,
                        name: user.name,
                        className: user.className,
                        nisn: user.nisn
                    } : null
                });
            }

            return res.status(200).json({
                success: false,
                found: false,
                isRegistered: false,
                isMyBook: false,
                message: `Barcode "${barcode}" tidak terdaftar dalam sistem perpustakaan sekolah.`,
                book: null,
                copy: null,
                borrower: null,
                currentViewer: user ? { id: user.id, name: user.name, className: user.className } : null
            });
        }

        const isMyBook = Boolean(user && copy.currentBorrowerId === user.id);

        res.json({
            success: true,
            found: true,
            isRegistered: true,
            isCopy: true,
            barcode: copy.barcodeCode,
            copyNumber: copy.copyNumber,
            condition: copy.condition,
            status: copy.status, // AVAILABLE, BORROWED, LOST
            isMyBook,
            message: isMyBook
                ? `Buku "${copy.book.title}" adalah buku milik Anda.`
                : (copy.status === 'BORROWED' && copy.currentBorrowerName
                    ? `Buku "${copy.book.title}" sedang dipinjam oleh ${copy.currentBorrowerName} (Kelas ${copy.currentBorrowerClass || '-'}).`
                    : `Buku "${copy.book.title}" terdaftar resmi di perpustakaan (Status: ${copy.status}).`),
            book: {
                id: copy.book.id,
                title: copy.book.title,
                author: copy.book.author,
                subject: copy.book.subject,
                publisher: (copy.book as any).publisher || null,
                isTextbook: (copy.book as any).isTextbook ?? true,
                targetClass: copy.book.gradeClass,
                gradeClass: copy.book.gradeClass,
                ebookUrl: copy.book.ebookUrl
            },
            copy: {
                id: copy.id,
                copyBarcode: copy.barcodeCode,
                copyNumber: copy.copyNumber,
                status: copy.status,
                borrowedAt: copy.borrowedAt ? copy.borrowedAt.toISOString() : null
            },
            borrower: copy.status === 'BORROWED' && copy.currentBorrowerId ? {
                id: copy.currentBorrowerId,
                name: copy.currentBorrowerName,
                className: copy.currentBorrowerClass,
                nisn: copy.currentBorrowerNisn,
                borrowedAt: copy.borrowedAt ? copy.borrowedAt.toISOString().split('T')[0] : null
            } : null,
            currentViewer: user ? {
                id: user.id,
                name: user.name,
                className: user.className,
                nisn: user.nisn
            } : null
        });
    } catch (error) {
        console.error('Error checking book owner:', error);
        res.status(500).json({ message: 'Gagal memeriksa pemilik buku.' });
    }
};

// 4. Operator / Petugas Mutasi Peminjam Buku Paket (Ganti Nama Peminjam)
export const reassignBookBorrower = async (req: Request, res: Response) => {
    try {
        const { barcodeCode, newStudentId, notes } = req.body;
        const officer = (req as any).user;

        if (!barcodeCode || !newStudentId) {
            return res.status(400).json({ message: 'Barcode buku dan Siswa Peminjam Baru wajib diisi.' });
        }

        const copy = await prisma.bookCopy.findUnique({
            where: { barcodeCode: barcodeCode.trim().toUpperCase() },
            include: { book: true }
        });

        if (!copy) {
            return res.status(404).json({ message: 'Eksemplar buku tidak ditemukan.' });
        }

        const newStudent = await prisma.user.findUnique({
            where: { id: newStudentId }
        });

        if (!newStudent) {
            return res.status(404).json({ message: 'Data siswa penerima tidak ditemukan.' });
        }

        const oldBorrower = copy.currentBorrowerName || 'Stok Bebas';
        const now = new Date();
        const due = new Date();
        due.setDate(now.getDate() + 180); // 1 semester pinjaman buku paket

        // Tutup riwayat peminjaman siswa sebelumnya jika sedang aktif dipinjam
        if (copy.status === 'BORROWED' || copy.currentBorrowerId) {
            await prisma.libraryBorrowing.updateMany({
                where: { bookCopyId: copy.id, status: 'BORROWED' },
                data: {
                    status: 'RETURNED',
                    returnDate: now,
                    notes: `Buku dialihkan/dimutasi ke [${newStudent.name}] oleh ${officer ? officer.name : 'Operator'}.`
                }
            });
        }

        // Update status kepemilikan di BookCopy
        const updatedCopy = await prisma.bookCopy.update({
            where: { id: copy.id },
            data: {
                currentBorrowerId: newStudent.id,
                currentBorrowerName: newStudent.name,
                currentBorrowerClass: newStudent.className || 'VII-A',
                currentBorrowerNisn: newStudent.username,
                borrowedAt: now,
                dueDate: due,
                status: 'BORROWED'
            }
        });

        // Catat di riwayat transaksi sirkulasi
        await prisma.libraryBorrowing.create({
            data: {
                userId: newStudent.id,
                bookId: copy.bookId,
                bookCopyId: copy.id,
                barcodeCode: copy.barcodeCode,
                borrowDate: now,
                dueDate: due,
                status: 'BORROWED',
                notes: `Mutasi kepemilikan dari [${oldBorrower}] ke [${newStudent.name}] oleh ${officer ? officer.name : 'Operator'}. Catatan: ${notes || '-'}`
            }
        });

        res.json({
            success: true,
            message: `✅ Buku ${copy.book.title} (Barcode: ${copy.barcodeCode}) berhasil dimutasi ke ${newStudent.name} (${newStudent.className})!`,
            copy: updatedCopy
        });
    } catch (error) {
        console.error('Error reassigning book borrower:', error);
        res.status(500).json({ message: 'Gagal memproses mutasi peminjam buku.' });
    }
};

// 5. Mengambil Buku Paket yang Sedang Dipinjam Siswa Login (Untuk Tampilan APK Siswa)
export const getMyBorrowedBooks = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ message: 'Unauthorized' });

        const myCopies = await prisma.bookCopy.findMany({
            where: {
                currentBorrowerId: user.id,
                status: 'BORROWED'
            },
            include: {
                book: true
            },
            orderBy: { borrowedAt: 'desc' }
        });

        res.json({
            success: true,
            count: myCopies.length,
            books: myCopies.map(c => ({
                copyId: c.id,
                barcodeCode: c.barcodeCode,
                copyNumber: c.copyNumber,
                condition: c.condition,
                borrowedAt: c.borrowedAt ? c.borrowedAt.toISOString().split('T')[0] : null,
                dueDate: c.dueDate ? c.dueDate.toISOString().split('T')[0] : null,
                title: c.book.title,
                author: c.book.author,
                subject: c.book.subject,
                gradeClass: c.book.gradeClass,
                ebookUrl: c.book.ebookUrl
            }))
        });
    } catch (error) {
        console.error('Error fetching my borrowed books:', error);
        res.status(500).json({ message: 'Gagal memuat daftar buku pinjaman.' });
    }
};

// 6. Ambil Seluruh Eksemplar Buku untuk Cetak Stiker Barcode (Operator)
export const getAllBookCopies = async (req: Request, res: Response) => {
    try {
        const { bookId, gradeClass } = req.query;
        const whereClause: any = {};
        if (bookId) whereClause.bookId = String(bookId);
        if (gradeClass && gradeClass !== 'ALL') {
            whereClause.book = { gradeClass: String(gradeClass) };
        }

        const copies = await prisma.bookCopy.findMany({
            where: whereClause,
            include: {
                book: {
                    select: { id: true, title: true, subject: true, gradeClass: true }
                }
            },
            orderBy: [
                { bookId: 'asc' },
                { copyNumber: 'asc' }
            ]
        });

        res.json({
            success: true,
            count: copies.length,
            copies
        });
    } catch (error) {
        console.error('Error fetching all book copies:', error);
        res.status(500).json({ message: 'Gagal memuat eksemplar buku.' });
    }
};

// 7. Kembalikan Buku Eksemplar
export const returnBookCopy = async (req: Request, res: Response) => {
    try {
        const { barcodeCode } = req.body;
        const copy = await prisma.bookCopy.findUnique({
            where: { barcodeCode: String(barcodeCode).trim().toUpperCase() }
        });

        if (!copy) return res.status(404).json({ message: 'Barcode buku tidak ditemukan.' });

        await prisma.bookCopy.update({
            where: { id: copy.id },
            data: {
                currentBorrowerId: null,
                currentBorrowerName: null,
                currentBorrowerClass: null,
                currentBorrowerNisn: null,
                status: 'AVAILABLE'
            }
        });

        await prisma.libraryBorrowing.updateMany({
            where: { bookCopyId: copy.id, status: 'BORROWED' },
            data: { status: 'RETURNED', returnDate: new Date() }
        });

        res.json({ success: true, message: `Buku dengan barcode ${copy.barcodeCode} berhasil dikembalikan ke rak.` });
    } catch (error) {
        console.error('Error returning book copy:', error);
        res.status(500).json({ message: 'Gagal memproses pengembalian buku.' });
    }
};

export const deleteBook = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        await prisma.bookCopy.deleteMany({ where: { bookId: id } });
        await prisma.libraryBorrowing.deleteMany({ where: { bookId: id } });
        await prisma.libraryBook.delete({ where: { id } });
        res.json({ success: true, message: 'Buku berhasil dihapus dari katalog E-Library.' });
    } catch (error) {
        console.error('Error deleting book:', error);
        res.status(500).json({ message: 'Gagal menghapus buku.' });
    }
};

export const adjustBookCopiesStock = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const { delta } = req.body;
        const numDelta = parseInt(delta, 10);
        if (isNaN(numDelta) || numDelta === 0) {
            return res.status(400).json({ success: false, message: 'Nilai perubahan stok (delta) tidak valid.' });
        }

        const book = await prisma.libraryBook.findUnique({
            where: { id },
            include: { copies: true }
        });

        if (!book) {
            return res.status(404).json({ success: false, message: 'Buku tidak ditemukan.' });
        }

        if (numDelta > 0) {
            const currentHighestCopy = book.copies.reduce((max, c) => Math.max(max, c.copyNumber || 0), 0);
            const newCopies = [];
            for (let i = 1; i <= numDelta; i++) {
                const nextNum = currentHighestCopy + i;
                const copyCode = `${book.barcodeCode}-${String(nextNum).padStart(3, '0')}`;
                newCopies.push({
                    bookId: book.id,
                    barcodeCode: copyCode,
                    copyNumber: nextNum,
                    condition: 'BAIK',
                    status: 'AVAILABLE'
                });
            }
            for (const copy of newCopies) {
                await prisma.bookCopy.create({ data: copy });
            }
            const newStock = book.stock + numDelta;
            await prisma.libraryBook.update({
                where: { id: book.id },
                data: { stock: newStock }
            });

            return res.json({
                success: true,
                message: `Berhasil menambahkan ${numDelta} eksemplar baru. Total stok sekarang: ${newStock} eksemplar.`,
                stock: newStock
            });
        } else {
            const countToRemove = Math.abs(numDelta);
            const availableCopies = book.copies.filter(c => c.status === 'AVAILABLE');

            if (availableCopies.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Tidak ada eksemplar yang tersedia (AVAILABLE) untuk dikurangi. Seluruh buku mungkin sedang dipinjam.'
                });
            }

            const actualRemove = Math.min(countToRemove, availableCopies.length);
            const idsToDelete = availableCopies.slice(-actualRemove).map(c => c.id);

            await prisma.bookCopy.deleteMany({
                where: { id: { in: idsToDelete } }
            });

            const newStock = Math.max(0, book.stock - actualRemove);
            await prisma.libraryBook.update({
                where: { id: book.id },
                data: { stock: newStock }
            });

            return res.json({
                success: true,
                message: `Berhasil mengurangi ${actualRemove} eksemplar. Total stok sekarang: ${newStock} eksemplar.`,
                stock: newStock
            });
        }
    } catch (error: any) {
        console.error('Error adjusting book copies:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengubah jumlah eksemplar: ' + error.message });
    }
};

export const updateBookCover = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        let coverUrl = req.body?.coverUrl;

        if ((req as any).file) {
            coverUrl = `/uploads/covers/${(req as any).file.filename}`;
        }

        if (!coverUrl) {
            return res.status(400).json({ success: false, message: 'File gambar sampul atau URL sampul wajib disertakan.' });
        }

        const updated = await prisma.libraryBook.update({
            where: { id },
            data: { coverUrl }
        });

        return res.json({
            success: true,
            message: 'Sampul buku berhasil diperbarui!',
            coverUrl: updated.coverUrl
        });
    } catch (error: any) {
        console.error('Error updating book cover:', error);
        return res.status(500).json({ success: false, message: 'Gagal memperbarui sampul buku: ' + error.message });
    }
};

export const borrowBook = async (req: Request, res: Response) => {
    try {
        const { bookId, copyBarcode, durationDays } = req.body;
        const studentId = (req as any).user?.id;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan untuk meminjam buku' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId }
        });
        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa peminjam tidak ditemukan' });
        }

        let copy = null;
        if (copyBarcode) {
            copy = await prisma.bookCopy.findUnique({
                where: { barcodeCode: String(copyBarcode).trim().toUpperCase() },
                include: { book: true }
            });
        } else if (bookId) {
            copy = await prisma.bookCopy.findFirst({
                where: { bookId: String(bookId), status: 'AVAILABLE' },
                include: { book: true }
            });
        }

        if (!copy) {
            return res.status(404).json({ success: false, message: 'Tidak ada eksemplar buku yang tersedia untuk dipinjam' });
        }

        if (copy.status === 'BORROWED') {
            return res.status(400).json({
                success: false,
                message: `Buku ini sedang dipinjam oleh ${copy.currentBorrowerName || 'siswa lain'}.`
            });
        }

        // 1. Validasi Kategori: Buku Referensi Hanya Baca di Tempat
        const bookCat = (copy.book?.category || '').toUpperCase();
        if (bookCat === 'REFERENSI' || bookCat === 'KAMUS' || bookCat === 'ENSIKLOPEDIA') {
            return res.status(400).json({
                success: false,
                message: `Buku kategori "${copy.book?.category}" hanya dapat dibaca di tempat (ruang perpustakaan) dan tidak dapat dipinjam bawa pulang.`
            });
        }

        // 2. Batas Pinjam Maksimal 3 Buku Umum per Siswa
        if (bookCat !== 'BUKU_PAKET') {
            const activeLoansCount = await prisma.bookCopy.count({
                where: {
                    currentBorrowerId: student.id,
                    status: 'BORROWED',
                    book: { category: { not: 'BUKU_PAKET' } }
                }
            });
            if (activeLoansCount >= 3) {
                return res.status(400).json({
                    success: false,
                    message: 'Batas peminjaman buku umum telah mencapai kuota maksimum (3 buku). Harap kembalikan buku sebelumnya terlebih dahulu.'
                });
            }
        }

        const now = new Date();
        const days = parseInt(durationDays) || 7;
        const due = new Date();
        due.setDate(now.getDate() + days);
        due.setUTCHours(8, 0, 0, 0); // 15:00 WIB

        const updated = await prisma.bookCopy.update({
            where: { id: copy.id },
            data: {
                status: 'BORROWED',
                currentBorrowerId: student.id,
                currentBorrowerName: student.name,
                currentBorrowerClass: student.className || 'VII',
                currentBorrowerNisn: student.nisn || student.username,
                borrowedAt: now,
                dueDate: due
            },
            include: { book: true }
        });

        await prisma.libraryBorrowing.create({
            data: {
                userId: student.id,
                bookId: copy.bookId,
                bookCopyId: copy.id,
                barcodeCode: copy.barcodeCode,
                borrowDate: now,
                dueDate: due,
                status: 'BORROWED',
                notes: `Dipinjam mandiri via Smart CBT APK oleh ${student.name}`
            }
        });

        res.json({
            success: true,
            message: 'Buku berhasil dipinjam',
            copy: updated
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getBookCoverSvg = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const book = await prisma.libraryBook.findFirst({
            where: {
                OR: [
                    { id },
                    { barcodeCode: id }
                ]
            }
        });

        const title = book?.title || 'Buku Paket Pelajaran';
        const author = book?.author || 'Kemendikbudristek';
        const subject = book?.subject || (title.includes('Matematika') ? 'Matematika' : (title.includes('IPA') ? 'IPA' : (title.includes('Python') ? 'Informatika' : 'Buku Paket')));

        let bgStart = '#1E3A8A', bgEnd = '#0F172A', accent = '#60A5FA', badge = '#3B82F6', icon = '📘';
        if (subject.toLowerCase().includes('matematika')) {
            bgStart = '#1E40AF'; bgEnd = '#172554'; accent = '#93C5FD'; badge = '#2563EB'; icon = '📐';
        } else if (subject.toLowerCase().includes('ipa') || subject.toLowerCase().includes('sains')) {
            bgStart = '#065F46'; bgEnd = '#022C22'; accent = '#6EE7B7'; badge = '#059669'; icon = '🔬';
        } else if (subject.toLowerCase().includes('informatika') || subject.toLowerCase().includes('python') || subject.toLowerCase().includes('algoritma')) {
            bgStart = '#0F766E'; bgEnd = '#134E4A'; accent = '#5EEAD4'; badge = '#0D9488'; icon = '💻';
        } else if (subject.toLowerCase().includes('sejarah') || subject.toLowerCase().includes('budaya')) {
            bgStart = '#78350F'; bgEnd = '#451A03'; accent = '#FDE68A'; badge = '#B45309'; icon = '🏛️';
        } else if (subject.toLowerCase().includes('sastra') || subject.toLowerCase().includes('cerpen') || subject.toLowerCase().includes('indonesia')) {
            bgStart = '#831843'; bgEnd = '#500724'; accent = '#F472B6'; badge = '#BE185D'; icon = '📖';
        }

        const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeAuthor = author.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeSubject = subject.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const words = safeTitle.split(' ');
        let line1 = '', line2 = '', line3 = '';
        let cur = 1;
        for (const w of words) {
            if (cur === 1) {
                if ((line1 + ' ' + w).length > 20) { cur = 2; line2 = w; } else { line1 = (line1 + ' ' + w).trim(); }
            } else if (cur === 2) {
                if ((line2 + ' ' + w).length > 20) { cur = 3; line3 = w; } else { line2 = (line2 + ' ' + w).trim(); }
            } else {
                line3 = (line3 + ' ' + w).trim();
            }
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 440" width="300" height="440">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bgStart}"/>
      <stop offset="100%" stop-color="${bgEnd}"/>
    </linearGradient>
  </defs>

  <rect width="300" height="440" rx="16" fill="url(#bg)"/>
  <rect x="0" y="0" width="18" height="440" rx="4" fill="rgba(0,0,0,0.3)"/>
  <line x1="22" y1="0" x2="22" y2="440" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>

  <rect x="36" y="24" width="140" height="24" rx="12" fill="${badge}"/>
  <text x="106" y="40" fill="#ffffff" font-family="sans-serif" font-size="10.5" font-weight="bold" text-anchor="middle" letter-spacing="0.5">KURIKULUM MERDEKA</text>
  <rect x="184" y="24" width="80" height="24" rx="12" fill="rgba(255,255,255,0.15)"/>
  <text x="224" y="40" fill="#ffffff" font-family="sans-serif" font-size="10.5" font-weight="bold" text-anchor="middle">E-BOOK</text>

  <circle cx="155" cy="140" r="56" fill="rgba(255,255,255,0.06)" stroke="${accent}" stroke-width="1.5" stroke-dasharray="4,3"/>
  <circle cx="155" cy="140" r="44" fill="${accent}" fill-opacity="0.18"/>
  <text x="155" y="152" font-size="44" text-anchor="middle">${icon}</text>

  <text x="155" y="222" fill="${accent}" font-family="sans-serif" font-size="12" font-weight="900" text-anchor="middle" letter-spacing="1.5">${safeSubject.toUpperCase()}</text>

  <text x="155" y="260" fill="#ffffff" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">${line1}</text>
  <text x="155" y="286" fill="#ffffff" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">${line2}</text>
  <text x="155" y="312" fill="#ffffff" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">${line3}</text>

  <rect x="36" y="360" width="228" height="54" rx="12" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
  <text x="50" y="382" fill="rgba(255,255,255,0.6)" font-family="sans-serif" font-size="10">PENULIS / PENERBIT:</text>
  <text x="50" y="400" fill="#ffffff" font-family="sans-serif" font-size="12" font-weight="bold">${safeAuthor.length > 28 ? safeAuthor.substring(0, 26) + '...' : safeAuthor}</text>
  <text x="250" y="394" fill="${accent}" font-family="monospace" font-size="12" font-weight="bold" text-anchor="end">SMP 1</text>
</svg>`;

        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(svg);
    } catch (e: any) {
        res.status(500).send('Error generating cover');
    }
};

// 8. Sirkulasi Cepat: Peminjaman & Pengembalian via Scan Barcode & QR Code
export const quickCirculation = async (req: Request, res: Response) => {
    try {
        const { action, studentQuery, bookBarcode, durationDays } = req.body;
        const officer = (req as any).user;

        if (!bookBarcode) {
            return res.status(400).json({ success: false, message: 'Barcode buku wajib disertakan.' });
        }

        const cleanBarcode = String(bookBarcode).trim().toUpperCase();

        // Cari eksemplar buku
        let copy = await prisma.bookCopy.findUnique({
            where: { barcodeCode: cleanBarcode },
            include: { book: true }
        });

        if (!copy) {
            const parentBook = await prisma.libraryBook.findUnique({
                where: { barcodeCode: cleanBarcode },
                include: { copies: { where: { status: 'AVAILABLE' } } }
            });
            if (parentBook && parentBook.copies.length > 0) {
                copy = await prisma.bookCopy.findUnique({
                    where: { id: parentBook.copies[0].id },
                    include: { book: true }
                });
            }
        }

        if (!copy) {
            return res.status(404).json({
                success: false,
                message: `Buku dengan barcode "${cleanBarcode}" tidak ditemukan dalam katalog.`
            });
        }

        // AKSI 1: PEMINJAMAN BUKU
        if (action === 'BORROW') {
            if (!studentQuery) {
                return res.status(400).json({ success: false, message: 'Identitas / QR Code siswa peminjam wajib di-scan.' });
            }

            if (copy.status === 'BORROWED') {
                return res.status(400).json({
                    success: false,
                    message: `⚠️ Buku ini (${copy.barcodeCode}) sedang dipinjam oleh ${copy.currentBorrowerName || 'siswa lain'}. Harap selesaikan pengembalian terlebih dahulu.`
                });
            }

            // 1. Validasi Kategori: Buku Referensi Hanya Baca di Tempat
            const bookCat = (copy.book?.category || '').toUpperCase();
            if (bookCat === 'REFERENSI' || bookCat === 'KAMUS' || bookCat === 'ENSIKLOPEDIA') {
                return res.status(400).json({
                    success: false,
                    message: `Buku kategori "${copy.book?.category}" hanya dapat dibaca di tempat (ruang perpustakaan) dan tidak dapat dipinjam bawa pulang.`
                });
            }

            const cleanQuery = String(studentQuery).replace(/^STUDENT_MEMBER:/, '').split(':')[0].trim();
            const student = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { id: cleanQuery },
                        { nisn: cleanQuery },
                        { username: cleanQuery },
                        { nis: cleanQuery }
                    ]
                }
            });

            if (!student) {
                return res.status(404).json({
                    success: false,
                    message: `Data siswa "${studentQuery}" tidak ditemukan.`
                });
            }

            // 2. Batas Pinjam Maksimal 3 Buku Umum per Siswa
            if (bookCat !== 'BUKU_PAKET') {
                const activeLoansCount = await prisma.bookCopy.count({
                    where: {
                        currentBorrowerId: student.id,
                        status: 'BORROWED',
                        book: { category: { not: 'BUKU_PAKET' } }
                    }
                });
                if (activeLoansCount >= 3) {
                    return res.status(400).json({
                        success: false,
                        message: 'Batas peminjaman buku umum telah mencapai kuota maksimum (3 buku). Harap kembalikan buku sebelumnya terlebih dahulu.'
                    });
                }
            }

            const now = new Date();
            const days = parseInt(durationDays) || 7;
            const due = new Date();
            due.setDate(now.getDate() + days);
            // Standardisasi jam tutup operasional perpus 15:00 WIB (08:00 UTC)
            due.setUTCHours(8, 0, 0, 0);

            const updatedCopy = await prisma.bookCopy.update({
                where: { id: copy.id },
                data: {
                    status: 'BORROWED',
                    currentBorrowerId: student.id,
                    currentBorrowerName: student.name,
                    currentBorrowerClass: student.className || 'VII',
                    currentBorrowerNisn: student.nisn || student.username,
                    borrowedAt: now,
                    dueDate: due
                },
                include: { book: true }
            });

            await prisma.libraryBorrowing.create({
                data: {
                    userId: student.id,
                    bookId: copy.bookId,
                    bookCopyId: copy.id,
                    barcodeCode: copy.barcodeCode,
                    borrowDate: now,
                    dueDate: due,
                    status: 'BORROWED',
                    notes: `Dipinjam via Sirkulasi Cepat Barcode oleh ${officer ? officer.name : 'Pustakawan'}`
                }
            });

            try {
                await prisma.notificationMessage.create({
                    data: {
                        recipientRole: 'STUDENT',
                        recipientId: student.id,
                        studentId: student.id,
                        studentName: student.name,
                        className: student.className || '',
                        title: `📚 Peminjaman Buku: ${copy.book.title}`,
                        message: `Buku "${copy.book.title}" (Barcode: ${copy.barcodeCode}) berhasil dipinjam. Batas waktu pengembalian: ${due.toISOString().split('T')[0]}.`,
                        category: 'LIBRARY'
                    }
                });
            } catch (e) {}

            return res.json({
                success: true,
                type: 'BORROW_SUCCESS',
                message: `✅ Sukses! Buku "${copy.book.title}" dipinjamkan kepada ${student.name} (${student.className || '-'}).`,
                copy: updatedCopy,
                student: {
                    id: student.id,
                    name: student.name,
                    nisn: student.nisn || student.username,
                    className: student.className
                }
            });
        }

        // AKSI 2: PENGEMBALIAN BUKU
        if (action === 'RETURN') {
            const borrowerName = copy.currentBorrowerName;
            const borrowerClass = copy.currentBorrowerClass;
            const borrowerId = copy.currentBorrowerId;

            let isSwapped = false;
            let swappedWarning = '';

            if (studentQuery) {
                const cleanQuery = String(studentQuery).replace(/^STUDENT_MEMBER:/, '').split(':')[0].trim();
                const returner = await prisma.user.findFirst({
                    where: {
                        role: 'STUDENT',
                        OR: [
                            { id: cleanQuery },
                            { nisn: cleanQuery },
                            { username: cleanQuery }
                        ]
                    }
                });

                if (returner && borrowerId && returner.id !== borrowerId) {
                    isSwapped = true;
                    swappedWarning = `⚠️ PERINGATAN BUKU TERTUKAR! Buku ini tercatat dipinjam oleh [${borrowerName} - ${borrowerClass}], tetapi dikembalikan oleh [${returner.name} - ${returner.className}].`;
                }
            }

            const updatedCopy = await prisma.bookCopy.update({
                where: { id: copy.id },
                data: {
                    status: 'AVAILABLE',
                    currentBorrowerId: null,
                    currentBorrowerName: null,
                    currentBorrowerClass: null,
                    currentBorrowerNisn: null,
                    borrowedAt: null,
                    dueDate: null
                },
                include: { book: true }
            });

            await prisma.libraryBorrowing.updateMany({
                where: { bookCopyId: copy.id, status: 'BORROWED' },
                data: { status: 'RETURNED', returnDate: new Date() }
            });

            return res.json({
                success: true,
                type: 'RETURN_SUCCESS',
                isSwapped,
                swappedWarning,
                message: isSwapped 
                    ? `⚠️ Buku "${copy.book.title}" berhasil dikembalikan. ${swappedWarning}`
                    : `✅ Buku "${copy.book.title}" (Barcode: ${copy.barcodeCode}) berhasil dikembalikan ke rak perpustakaan.`,
                copy: updatedCopy,
                previousBorrower: borrowerName ? { name: borrowerName, className: borrowerClass } : null
            });
        }

        return res.status(400).json({ success: false, message: 'Aksi sirkulasi tidak valid. Gunakan BORROW atau RETURN.' });
    } catch (error: any) {
        console.error('Error in quickCirculation:', error);
        res.status(500).json({ success: false, message: 'Gagal memproses sirkulasi perpustakaan: ' + error.message });
    }
};

// 9. Kartu Anggota Digital Siswa (QR Code & Profil Anggota)
export const getDigitalMemberCard = async (req: Request, res: Response) => {
    try {
        const studentId = req.params.studentId || (req as any).user?.id;
        const student = await prisma.user.findFirst({
            where: { id: studentId, role: 'STUDENT' },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                nis: true,
                className: true,
                gender: true,
                bloodType: true,
                allergies: true,
                points: true,
                profilePicUrl: true
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Anggota siswa tidak ditemukan.' });
        }

        const activeBooks = await prisma.bookCopy.findMany({
            where: { currentBorrowerId: student.id, status: 'BORROWED' },
            include: { book: { select: { title: true, subject: true } } }
        });

        const qrPayload = `STUDENT_MEMBER:${student.id}:${student.nisn || student.username}:${student.name}:${student.className || '-'}`;

        res.json({
            success: true,
            member: {
                ...student,
                memberId: 'LIB-' + (student.nisn || student.username),
                qrPayload,
                activeBorrowingsCount: activeBooks.length,
                borrowedBooks: activeBooks.map(b => ({
                    barcode: b.barcodeCode,
                    title: b.book.title,
                    borrowedAt: b.borrowedAt ? b.borrowedAt.toISOString().split('T')[0] : '-',
                    dueDate: b.dueDate ? b.dueDate.toISOString().split('T')[0] : '-'
                }))
            }
        });
    } catch (error: any) {
        console.error('Error in getDigitalMemberCard:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil kartu anggota digital.' });
    }
};

// 10. Ambil Seluruh Anggota untuk Cetak Kartu Fisik
export const getAllMembers = async (req: Request, res: Response) => {
    try {
        const { className, search } = req.query;
        const whereClause: any = { role: 'STUDENT' };
        if (className && className !== 'ALL') {
            whereClause.className = String(className);
        }
        if (search && typeof search === 'string') {
            whereClause.OR = [
                { name: { contains: search } },
                { username: { contains: search } },
                { nisn: { contains: search } }
            ];
        }

        const members = await prisma.user.findMany({
            where: whereClause,
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                className: true,
                gender: true,
                points: true,
                bloodType: true
            },
            orderBy: [{ className: 'asc' }, { name: 'asc' }]
        });

        res.json({
            success: true,
            count: members.length,
            members: members.map(m => ({
                ...m,
                memberId: 'LIB-' + (m.nisn || m.username),
                qrPayload: `STUDENT_MEMBER:${m.id}:${m.nisn || m.username}:${m.name}:${m.className || '-'}`
            }))
        });
    } catch (error: any) {
        console.error('Error in getAllMembers:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat daftar anggota perpustakaan.' });
    }
};

// =========================================================================
// 10. PROSES AKHIR TAHUN MASAL: PENGEMBALIAN KOLEKTIF BUKU PAKET PER ROMBEL
// =========================================================================
export const bulkReturnByClass = async (req: Request, res: Response) => {
    try {
        const { className, academicYear = '2026/2027', notes } = req.body;
        const officer = (req as any).user;

        if (!className) {
            return res.status(400).json({ success: false, message: 'Parameter className (contoh: "VII-A") wajib diisi.' });
        }

        const now = new Date();

        // 1. Eksekusi pengembalian massal BookCopy & LibraryBorrowing
        const borrowedCopies = await prisma.bookCopy.findMany({
            where: {
                currentBorrowerClass: className,
                status: 'BORROWED'
            },
            include: { book: true }
        });

        const copyIds = borrowedCopies.map(c => c.id);

        if (copyIds.length > 0) {
            await prisma.bookCopy.updateMany({
                where: { id: { in: copyIds } },
                data: {
                    status: 'AVAILABLE',
                    currentBorrowerId: null,
                    currentBorrowerName: null,
                    currentBorrowerClass: null,
                    currentBorrowerNisn: null,
                    borrowedAt: null,
                    dueDate: null
                }
            });

            await prisma.libraryBorrowing.updateMany({
                where: {
                    bookCopyId: { in: copyIds },
                    status: 'BORROWED'
                },
                data: {
                    status: 'RETURNED',
                    returnDate: now,
                    notes: `Pengembalian Kolektif Akhir Tahun Rombel ${className} oleh ${officer ? officer.name : 'Pustakawan'}`
                }
            });
        }

        // 2. Eksekusi pengembalian massal PackageBookCopy & StudentBookAssignment jika ada
        let packageReturnedCount = 0;
        try {
            const packageAssignments = await (prisma as any).studentBookAssignment.findMany({
                where: {
                    academicYear,
                    status: 'APPROVED',
                    student: { className }
                },
                select: { id: true, packageBookCopyId: true }
            });

            if (packageAssignments.length > 0) {
                const pAssignIds = packageAssignments.map((a: any) => a.id);
                const pCopyIds = packageAssignments.map((a: any) => a.packageBookCopyId).filter(Boolean);

                await (prisma as any).studentBookAssignment.updateMany({
                    where: { id: { in: pAssignIds } },
                    data: {
                        status: 'RETURNED',
                        returnedAt: now,
                        returnedToOperator: officer ? officer.name : 'Pustakawan'
                    }
                });

                if (pCopyIds.length > 0) {
                    await (prisma as any).packageBookCopy.updateMany({
                        where: { id: { in: pCopyIds } },
                        data: { status: 'TERSEDIA' }
                    });
                }
                packageReturnedCount = packageAssignments.length;
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: `✅ Pengembalian massal akhir tahun untuk rombel ${className} berhasil diproses.`,
            summary: {
                className,
                academicYear,
                generalCopiesReturned: copyIds.length,
                packageBooksReturned: packageReturnedCount,
                totalBooksProcessed: copyIds.length + packageReturnedCount,
                processedAt: now.toISOString(),
                operator: officer ? officer.name : 'Pustakawan'
            }
        });
    } catch (error: any) {
        console.error('Error in bulkReturnByClass:', error);
        return res.status(500).json({ success: false, message: 'Gagal memproses pengembalian massal: ' + error.message });
    }
};

// =========================================================================
// 11. LAPORAN SISA BUKU BELUM KEMBALI (TERMASUK SISWA LULUS / ALUMNI)
// =========================================================================
export const getUnreturnedClassReport = async (req: Request, res: Response) => {
    try {
        const { className, academicYear = '2026/2027' } = req.query;

        // Ambil data peminjaman aktif umum
        const copyWhere: any = { status: 'BORROWED' };
        if (className && className !== 'ALL') {
            copyWhere.currentBorrowerClass = String(className);
        }

        const unreturnedCopies = await prisma.bookCopy.findMany({
            where: copyWhere,
            include: {
                book: {
                    select: { id: true, title: true, author: true, category: true, subject: true }
                }
            },
            orderBy: [{ currentBorrowerClass: 'asc' }, { currentBorrowerName: 'asc' }]
        });

        // Ambil data buku paket belum kembali
        let unreturnedPackages: any[] = [];
        try {
            const pWhere: any = {
                status: 'APPROVED',
                academicYear: String(academicYear)
            };
            if (className && className !== 'ALL') {
                pWhere.student = { className: String(className) };
            }

            unreturnedPackages = await (prisma as any).studentBookAssignment.findMany({
                where: pWhere,
                include: {
                    student: {
                        select: { id: true, name: true, username: true, nisn: true, className: true, parentPhone: true, role: true }
                    },
                    packageBook: {
                        select: { id: true, judul: true, mataPelajaran: true, tingkatKelas: true }
                    },
                    packageBookCopy: {
                        select: { id: true, barcodeCode: true, kondisi: true }
                    }
                },
                orderBy: { student: { name: 'asc' } }
            });
        } catch (_) {}

        // Susun grup per siswa
        const studentMap: Record<string, any> = {};

        // 1. Masukkan unreturnedCopies
        unreturnedCopies.forEach(c => {
            const sid = c.currentBorrowerId || c.currentBorrowerNisn || 'UNKNOWN';
            if (!studentMap[sid]) {
                studentMap[sid] = {
                    studentId: c.currentBorrowerId,
                    studentName: c.currentBorrowerName || '-',
                    className: c.currentBorrowerClass || '-',
                    nisn: c.currentBorrowerNisn || '-',
                    isAlumniOrInactive: c.currentBorrowerClass === 'ALUMNI' || c.currentBorrowerClass === 'LULUS',
                    books: []
                };
            }
            studentMap[sid].books.push({
                type: 'BUKU_UMUM',
                title: c.book.title,
                barcode: c.barcodeCode,
                borrowedAt: c.borrowedAt ? c.borrowedAt.toISOString().split('T')[0] : '-',
                dueDate: c.dueDate ? c.dueDate.toISOString().split('T')[0] : '-',
                isOverdue: c.dueDate ? new Date() > c.dueDate : false
            });
        });

        // 2. Masukkan unreturnedPackages
        unreturnedPackages.forEach(p => {
            const sid = p.studentId;
            if (!studentMap[sid]) {
                studentMap[sid] = {
                    studentId: p.student.id,
                    studentName: p.student.name,
                    className: p.student.className || '-',
                    nisn: p.student.nisn || p.student.username,
                    parentPhone: p.student.parentPhone,
                    isAlumniOrInactive: p.student.role === 'ALUMNI' || p.student.className === 'ALUMNI',
                    books: []
                };
            }
            studentMap[sid].books.push({
                type: 'BUKU_PAKET',
                title: p.packageBook.judul,
                barcode: p.packageBookCopy?.barcodeCode || p.barcodeScanned || '-',
                borrowedAt: p.claimedAt ? p.claimedAt.toISOString().split('T')[0] : '-',
                dueDate: 'Akhir Tahun Ajaran',
                isOverdue: false
            });
        });

        const studentsList = Object.values(studentMap);
        const totalPendingBooks = unreturnedCopies.length + unreturnedPackages.length;

        return res.json({
            success: true,
            summary: {
                targetClass: className || 'ALL',
                academicYear,
                totalStudentsWithObligations: studentsList.length,
                totalUnreturnedBooks: totalPendingBooks,
                unreturnedCopiesCount: unreturnedCopies.length,
                unreturnedPackagesCount: unreturnedPackages.length,
                notice: 'Sistem bebas biaya denda finansial. Seluruh penagihan berfokus pada pengembalian fisik buku aset sekolah.'
            },
            data: studentsList
        });
    } catch (error: any) {
        console.error('Error in getUnreturnedClassReport:', error);
        return res.status(500).json({ success: false, message: 'Gagal membuat laporan sisa buku: ' + error.message });
    }
};

// =========================================================================
// 12. ALUR PEMBALIKAN STATUS: BUKU HILANG DITEMUKAN KEMBALI (LOST-TO-FOUND)
// =========================================================================
export const revertLostBookStatus = async (req: Request, res: Response) => {
    try {
        const { barcodeCode, condition = 'BAIK', note = 'Buku ditemukan kembali' } = req.body;
        const officer = (req as any).user;

        if (!barcodeCode) {
            return res.status(400).json({ success: false, message: 'Barcode buku yang ditemukan wajib diisi.' });
        }

        const cleanBarcode = String(barcodeCode).trim().toUpperCase();

        // 1. Cari di BookCopy
        const copy = await prisma.bookCopy.findUnique({
            where: { barcodeCode: cleanBarcode },
            include: { book: true }
        });

        if (copy) {
            const previousStatus = copy.status;
            const updatedCopy = await prisma.bookCopy.update({
                where: { id: copy.id },
                data: {
                    status: 'AVAILABLE',
                    condition,
                    currentBorrowerId: null,
                    currentBorrowerName: null,
                    currentBorrowerClass: null,
                    currentBorrowerNisn: null,
                    borrowedAt: null,
                    dueDate: null
                },
                include: { book: true }
            });

            // Selesaikan transaksi peminjaman terkait tanpa denda
            await prisma.libraryBorrowing.updateMany({
                where: { bookCopyId: copy.id, status: { in: ['BORROWED', 'LOST', 'HILANG'] } },
                data: {
                    status: 'RETURNED',
                    returnDate: new Date(),
                    notes: `Buku ditemukan kembali (${note}) oleh ${officer ? officer.name : 'Pustakawan'}. Bebas biaya denda.`
                }
            });

            return res.json({
                success: true,
                message: `✅ Buku "${copy.book.title}" (Barcode: ${cleanBarcode}) berhasil dipulihkan dari status [${previousStatus}] menjadi [TERSEDIA].`,
                copy: updatedCopy
            });
        }

        // 2. Cari di PackageBookCopy
        try {
            const pCopy = await (prisma as any).packageBookCopy.findUnique({
                where: { barcodeCode: cleanBarcode },
                include: { packageBook: true }
            });

            if (pCopy) {
                const prev = pCopy.status;
                await (prisma as any).packageBookCopy.update({
                    where: { id: pCopy.id },
                    data: {
                        status: 'TERSEDIA',
                        kondisi: condition
                    }
                });

                await (prisma as any).studentBookAssignment.updateMany({
                    where: { packageBookCopyId: pCopy.id, status: 'APPROVED' },
                    data: {
                        status: 'RETURNED',
                        returnedAt: new Date(),
                        returnedToOperator: officer ? officer.name : 'Pustakawan'
                    }
                });

                return res.json({
                    success: true,
                    message: `✅ Buku Paket "${pCopy.packageBook.judul}" (Barcode: ${cleanBarcode}) berhasil dipulihkan dari status [${prev}] menjadi [TERSEDIA].`
                });
            }
        } catch (_) {}

        return res.status(404).json({
            success: false,
            message: `Buku dengan barcode "${cleanBarcode}" tidak ditemukan dalam master eksemplar.`
        });
    } catch (error: any) {
        console.error('Error in revertLostBookStatus:', error);
        return res.status(500).json({ success: false, message: 'Gagal memulihkan status buku: ' + error.message });
    }
};

/**
 * Stream berkas E-Book PDF dengan proteksi autentikasi & HTTP Range Streaming
 * Mencegah kebocoran URL file fisik langsung & mendukung pembacaan halaman demi halaman tanpa buffering penuh
 */
export const streamEbookPdf = async (req: Request, res: Response) => {
    try {
        const bookId = String(req.params.bookId || '');
        if (!bookId) {
            return res.status(400).json({ success: false, message: 'ID Buku diperlukan.' });
        }

        const book = await prisma.libraryBook.findUnique({
            where: { id: bookId },
            select: { id: true, title: true, ebookUrl: true }
        });

        if (!book || !book.ebookUrl) {
            return res.status(404).json({ success: false, message: 'E-Book tidak ditemukan untuk judul buku ini.' });
        }

        // Resolusi jalur file fisik di server
        let relativePath = book.ebookUrl;
        if (relativePath.startsWith('/')) {
            relativePath = relativePath.substring(1);
        }
        
        let filePath = path.resolve(process.cwd(), relativePath);

        // Fallback jika path tersimpan hanya nama file
        if (!fs.existsSync(filePath)) {
            const fallbackPath = path.resolve(process.cwd(), 'uploads/ebooks', path.basename(book.ebookUrl));
            if (fs.existsSync(fallbackPath)) {
                filePath = fallbackPath;
            } else {
                return res.status(404).json({ success: false, message: 'Berkas PDF fisik e-book tidak ditemukan di server.' });
            }
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        const safeFilename = encodeURIComponent(book.title.replace(/[^a-zA-Z0-9_\-]/g, '_')) + '.pdf';

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize || end >= fileSize) {
                res.status(416).set('Content-Range', `bytes */${fileSize}`);
                return res.end();
            }

            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${safeFilename}"`
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'application/pdf',
                'Accept-Ranges': 'bytes',
                'Content-Disposition': `inline; filename="${safeFilename}"`
            };
            res.writeHead(200, head);
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (err: any) {
        console.error('Error in streamEbookPdf:', err);
        return res.status(500).json({ success: false, message: 'Gagal melakukan streaming E-Book: ' + err.message });
    }
};



