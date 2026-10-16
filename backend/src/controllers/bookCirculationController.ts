import { Request, Response } from 'express';
import prisma from '../utils/db';

// ========================================================
// 2. ALUR SIRKULASI BUKU PAKET FISIK & CROWDSOURCING
// ========================================================

/**
 * Helper: Ambil tingkat kelas dari string nama kelas (misal: "VII-B" -> "VII")
 */
function extractGrade(className?: string | null): string {
    if (!className) return 'VII';
    if (className.startsWith('VII-') || className.startsWith('7')) return 'VII';
    if (className.startsWith('VIII-') || className.startsWith('8')) return 'VIII';
    if (className.startsWith('IX-') || className.startsWith('9')) return 'IX';
    return 'VII';
}

/**
 * 1. POST /api/v1/student/books/claim
 * Self-Scan Siswa: Siswa memilih slot mapel -> scan barcode fisik di sampul buku -> PENDING_APPROVAL
 */
export const studentClaimPackageBook = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        const { barcodeCode, packageBookId } = req.body;

        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi siswa diperlukan.' });
        }
        if (!barcodeCode) {
            return res.status(400).json({ success: false, message: 'Kode barcode buku wajib dipindai.' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        const studentGrade = extractGrade(student.className);

        // 1. Cari eksemplar buku berdasarkan barcodeCode
        const copy = await (prisma as any).packageBookCopy.findUnique({
            where: { barcodeCode: barcodeCode.trim() },
            include: { packageBook: true }
        });

        if (!copy) {
            return res.status(404).json({
                success: false,
                message: `Barcode "${barcodeCode}" tidak terdaftar dalam master eksemplar buku paket sekolah.`
            });
        }

        // 2. Validasi kesesuaian jenjang kelas
        if (copy.packageBook.tingkatKelas !== studentGrade) {
            return res.status(400).json({
                success: false,
                message: `Buku ini untuk Kelas ${copy.packageBook.tingkatKelas}, sedangkan Anda terdaftar di Kelas ${studentGrade}.`
            });
        }

        // 3. Validasi kesesuaian target mapel (jika siswa memilih slot tertentu)
        if (packageBookId && copy.packageBookId !== packageBookId) {
            return res.status(400).json({
                success: false,
                message: `Barcode yang dipindai adalah buku "${copy.packageBook.judul}", tidak sesuai dengan slot mapel yang Anda pilih.`
            });
        }

        // 4. Validasi apakah eksemplar ini sudah diklaim oleh siswa lain
        if (copy.status === 'DIPINJAM') {
            return res.status(409).json({
                success: false,
                message: `Buku dengan barcode ini sudah sah terdaftar atas nama siswa lain.`
            });
        }

        // 5. Eksekusi Atomic Database Transaction
        const currentYear = '2026/2027';
        const assignment = await prisma.$transaction(async (tx: any) => {
            // Cek apakah siswa sudah memiliki klaim untuk judul buku paket ini di tahun ajaran yang sama
            const existingAssignment = await tx.studentBookAssignment.findUnique({
                where: {
                    studentId_packageBookId_academicYear: {
                        studentId: student.id,
                        packageBookId: copy.packageBookId,
                        academicYear: currentYear
                    }
                }
            });

            if (existingAssignment && existingAssignment.status === 'APPROVED') {
                throw new Error(`Anda sudah memiliki buku paket "${copy.packageBook.judul}" yang terverifikasi.`);
            }

            // Update status eksemplar
            await tx.packageBookCopy.update({
                where: { id: copy.id },
                data: { status: 'PENDING_APPROVAL' }
            });

            // Buat atau perbarui assignment
            const record = await tx.studentBookAssignment.upsert({
                where: {
                    studentId_packageBookId_academicYear: {
                        studentId: student.id,
                        packageBookId: copy.packageBookId,
                        academicYear: currentYear
                    }
                },
                update: {
                    packageBookCopyId: copy.id,
                    barcodeScanned: copy.barcodeCode,
                    status: 'PENDING_APPROVAL',
                    claimedAt: new Date()
                },
                create: {
                    studentId: student.id,
                    packageBookId: copy.packageBookId,
                    packageBookCopyId: copy.id,
                    barcodeScanned: copy.barcodeCode,
                    status: 'PENDING_APPROVAL',
                    academicYear: currentYear
                },
                include: {
                    packageBook: true,
                    packageBookCopy: true
                }
            });

            return record;
        });

        return res.json({
            success: true,
            message: `Berhasil memindai buku "${copy.packageBook.judul}". Status: Menunggu Approval Wali Kelas.`,
            data: assignment
        });
    } catch (error: any) {
        console.error('Error studentClaimPackageBook:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memproses klaim buku' });
    }
};

/**
 * 2. GET /api/v1/student/books/my-packages
 * Mengambil daftar slot buku paket siswa sesuai jenjang kelasnya beserta status visual
 */
export const getStudentPackageBooks = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi siswa diperlukan.' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
        }

        const studentGrade = extractGrade(student.className);
        const currentYear = '2026/2027';

        // Ambil semua master buku paket untuk jenjang kelas siswa
        const packageBooks = await (prisma as any).packageBook.findMany({
            where: { tingkatKelas: studentGrade },
            orderBy: { mataPelajaran: 'asc' }
        });

        // Ambil klaim siswa yang ada
        const assignments = await (prisma as any).studentBookAssignment.findMany({
            where: { studentId: student.id, academicYear: currentYear },
            include: { packageBookCopy: true }
        });

        const assignmentMap = new Map();
        for (const a of assignments) {
            assignmentMap.set(a.packageBookId, a);
        }

        const slots = packageBooks.map((b: any) => {
            const assign = assignmentMap.get(b.id);
            let visualStatus = 'BELUM_SCAN'; // Abu-abu
            let statusLabel = 'Belum Di-scan';
            let statusCode = 'UNSCANNED';

            if (assign) {
                if (assign.status === 'PENDING_APPROVAL') {
                    visualStatus = 'PENDING_APPROVAL'; // Oranye / Kuning
                    statusLabel = 'Menunggu Approval Wali Kelas';
                    statusCode = 'PENDING';
                } else if (assign.status === 'APPROVED') {
                    visualStatus = 'TERVERIFIKASI'; // Hijau Bercahaya
                    statusLabel = 'Terverifikasi / Sah Dipinjam';
                    statusCode = 'APPROVED';
                } else if (assign.status === 'RETURNED') {
                    visualStatus = 'SUDAH_KEMBALI';
                    statusLabel = 'Sudah Dikembalikan';
                    statusCode = 'RETURNED';
                }
            }

            return {
                id: b.id,
                judul: b.judul,
                mataPelajaran: b.mataPelajaran,
                tingkatKelas: b.tingkatKelas,
                kurikulum: b.kurikulum,
                coverUrl: b.coverUrl || '/uploads/ebooks/covers/default_package.png',
                filePdfUrl: b.filePdfUrl || null,
                visualStatus,
                statusLabel,
                statusCode,
                barcodeScanned: assign?.barcodeScanned || null,
                claimedAt: assign?.claimedAt || null,
                approvedAt: assign?.approvedAt || null
            };
        });

        const totalSlots = slots.length;
        const verifiedCount = slots.filter((s: any) => s.visualStatus === 'TERVERIFIKASI').length;
        const pendingCount = slots.filter((s: any) => s.visualStatus === 'PENDING_APPROVAL').length;
        const unassignedCount = totalSlots - verifiedCount - pendingCount;

        return res.json({
            success: true,
            data: {
                studentGrade,
                className: student.className,
                stats: {
                    totalSlots,
                    verifiedCount,
                    pendingCount,
                    unassignedCount,
                    progressPercentage: totalSlots > 0 ? Math.round((verifiedCount / totalSlots) * 100) : 0
                },
                slots
            }
        });
    } catch (error: any) {
        console.error('Error getStudentPackageBooks:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memuat rak buku paket' });
    }
};

/**
 * 3. POST /api/v1/operator/books/batch-approve
 * Batch Approval (Wali Kelas / Operator): Approve 1 kelas sekaligus dengan DB Transaction
 */
export const operatorBatchApprove = async (req: Request, res: Response) => {
    try {
        const { className, academicYear } = req.body;
        const operatorName = (req as any).user?.name || 'Wali Kelas';
        const year = academicYear || '2026/2027';

        if (!className) {
            return res.status(400).json({ success: false, message: 'Nama rombel/kelas wajib dipilih.' });
        }

        // Cari semua siswa di rombel ini
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className, isActive: true },
            select: { id: true, name: true }
        });

        const studentIds = students.map(s => s.id);

        // Eksekusi Batch Approval dalam DB Transaction
        const result = await prisma.$transaction(async (tx: any) => {
            // Cari semua assignment PENDING_APPROVAL untuk siswa rombel ini
            const pendingAssignments = await tx.studentBookAssignment.findMany({
                where: {
                    studentId: { in: studentIds },
                    academicYear: year,
                    status: 'PENDING_APPROVAL'
                },
                include: { packageBookCopy: true }
            });

            if (pendingAssignments.length === 0) {
                return { approvedCount: 0, message: 'Tidak ada klaim buku yang menunggu approval di kelas ini.' };
            }

            const copyIds = pendingAssignments.map((p: any) => p.packageBookCopyId).filter(Boolean);

            // 1. Update semua copy menjadi DIPINJAM
            if (copyIds.length > 0) {
                await tx.packageBookCopy.updateMany({
                    where: { id: { in: copyIds } },
                    data: { status: 'DIPINJAM' }
                });
            }

            // 2. Update status assignment menjadi APPROVED
            const assignmentIds = pendingAssignments.map((p: any) => p.id);
            await tx.studentBookAssignment.updateMany({
                where: { id: { in: assignmentIds } },
                data: {
                    status: 'APPROVED',
                    approvedAt: new Date(),
                    approvedBy: operatorName
                }
            });

            return {
                approvedCount: pendingAssignments.length,
                studentsCount: studentIds.length
            };
        });

        return res.json({
            success: true,
            message: `Berhasil menyetujui ${result.approvedCount} buku paket untuk kelas ${className}.`,
            data: result
        });
    } catch (error: any) {
        console.error('Error operatorBatchApprove:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal batch approve' });
    }
};

/**
 * 4. POST /api/v1/operator/books/continuous-return
 * Scanner Pintar Pengembalian Akhir Tahun: Continuous Scanner dengan deteksi buku tertukar
 */
export const operatorContinuousReturn = async (req: Request, res: Response) => {
    try {
        const { barcodeCode, currentStudentId } = req.body;
        const operatorName = (req as any).user?.name || 'Operator Perpustakaan';

        if (!barcodeCode) {
            return res.status(400).json({ success: false, message: 'Barcode eksemplar buku wajib dipindai.' });
        }

        // Cari eksemplar buku
        const copy = await (prisma as any).packageBookCopy.findUnique({
            where: { barcodeCode: barcodeCode.trim() },
            include: { packageBook: true }
        });

        if (!copy) {
            return res.status(404).json({
                success: false,
                status: 'NOT_FOUND',
                matched: false,
                message: `Barcode "${barcodeCode}" tidak ditemukan di database perpustakaan.`
            });
        }

        // Cari peminjam aktif untuk copy ini
        const activeAssignment = await (prisma as any).studentBookAssignment.findFirst({
            where: {
                packageBookCopyId: copy.id,
                status: 'APPROVED'
            },
            include: {
                student: { select: { id: true, name: true, className: true, nisn: true } },
                packageBook: true
            }
        });

        if (!activeAssignment) {
            return res.json({
                success: true,
                status: 'ALREADY_RETURNED',
                matched: false,
                message: `Buku "${copy.packageBook.judul}" (${copy.barcodeCode}) sudah berada dalam status TERSEDIA / Tidak sedang dipinjam.`
            });
        }

        const borrower = activeAssignment.student;

        // Cek apakah barcode sesuai dengan siswa yang sedang diproses di loket
        if (currentStudentId && currentStudentId !== borrower.id) {
            // DETEKSI BUKU TERTUKAR (MISMATCH)
            return res.json({
                success: true,
                matched: false,
                status: 'MISMATCH',
                soundAlert: 'WARNING_BEEP',
                bookTitle: copy.packageBook.judul,
                barcode: copy.barcodeCode,
                actualBorrower: {
                    id: borrower.id,
                    name: borrower.name,
                    className: borrower.className,
                    nisn: borrower.nisn
                },
                message: `PERINGATAN: Buku ini milik ${borrower.name} (${borrower.className})!`
            });
        }

        // BUKU SESUAI -> Lakukan pengembalian
        await prisma.$transaction(async (tx: any) => {
            await tx.packageBookCopy.update({
                where: { id: copy.id },
                data: { status: 'TERSEDIA' }
            });

            await tx.studentBookAssignment.update({
                where: { id: activeAssignment.id },
                data: {
                    status: 'RETURNED',
                    returnedAt: new Date(),
                    returnedToOperator: operatorName
                }
            });
        });

        // Cek Auto-Clearance Bebas Pustaka
        const remainingUnreturned = await (prisma as any).studentBookAssignment.count({
            where: {
                studentId: borrower.id,
                status: 'APPROVED'
            }
        });

        const isBebasPustaka = remainingUnreturned === 0;

        return res.json({
            success: true,
            matched: true,
            status: 'MATCH',
            soundAlert: 'SUCCESS_BEEP',
            bookTitle: copy.packageBook.judul,
            barcode: copy.barcodeCode,
            studentName: borrower.name,
            className: borrower.className,
            remainingBooks: remainingUnreturned,
            bebasPustaka: isBebasPustaka,
            message: `Buku Sesuai: "${copy.packageBook.judul}" berhasil dikembalikan oleh ${borrower.name}.`
        });
    } catch (error: any) {
        console.error('Error operatorContinuousReturn:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memproses pengembalian' });
    }
};

/**
 * 5. GET /api/v1/books/lost-and-found/:barcode
 * Fitur Scan Deteksi Buku Tertinggal (Lost & Found):
 * Menampilkan kartu profil pemilik sah (Foto, Nama Lengkap, Kelas)
 */
export const lostAndFoundScan = async (req: Request, res: Response) => {
    try {
        const rawBarcode = req.params.barcode;
        const barcode = Array.isArray(rawBarcode) ? rawBarcode[0] : rawBarcode;
        if (!barcode || !String(barcode).trim()) {
            return res.status(400).json({ success: false, message: 'Barcode wajib disertakan' });
        }

        const copy = await (prisma as any).packageBookCopy.findUnique({
            where: { barcodeCode: String(barcode).trim() },
            include: { packageBook: true }
        });

        if (!copy) {
            return res.status(404).json({ success: false, message: 'Barcode tidak terdaftar dalam koleksi perpustakaan' });
        }

        const assignment = await (prisma as any).studentBookAssignment.findFirst({
            where: {
                packageBookCopyId: copy.id,
                status: { in: ['APPROVED', 'PENDING_APPROVAL'] }
            },
            include: {
                student: {
                    select: {
                        id: true,
                        name: true,
                        className: true,
                        nisn: true,
                        profilePicUrl: true
                    }
                },
                packageBook: true
            }
        });

        if (!assignment || !assignment.student) {
            return res.json({
                success: true,
                found: false,
                bookTitle: copy.packageBook.judul,
                barcode: copy.barcodeCode,
                message: 'Buku ini tidak sedang dipinjam oleh siswa manapun (Tersedia di Perpustakaan).'
            });
        }

        return res.json({
            success: true,
            found: true,
            bookTitle: copy.packageBook.judul,
            mataPelajaran: copy.packageBook.mataPelajaran,
            barcode: copy.barcodeCode,
            owner: {
                id: assignment.student.id,
                name: assignment.student.name,
                className: assignment.student.className,
                nisn: assignment.student.nisn,
                photoUrl: assignment.student.profilePicUrl || '/images/default_avatar.png'
            },
            statusPinjam: assignment.status,
            message: `Pemilik sah buku ini adalah ${assignment.student.name} (${assignment.student.className}).`
        });
    } catch (error: any) {
        console.error('Error lostAndFoundScan:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memindai buku' });
    }
};

/**
 * 6. GET /api/v1/student/library/active-loans-reminder
 * Kotak Pengingat: "1 Buku sedang dipinjam (Jatuh tempo: 3 hari lagi)"
 */
export const getActiveLoansReminder = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        if (!studentId) {
            return res.json({ success: true, hasReminder: false });
        }

        // Cek peminjaman aktif di modul peminjaman buku perpustakaan umum (LibraryLoan / LibraryBorrowing)
        const activeLoans = await (prisma as any).libraryLoan.findMany({
            where: {
                siswaId: studentId,
                statusPinjam: 'AKTIF'
            },
            include: {
                eksemplar: { include: { buku: true } }
            },
            orderBy: { jatuhTempo: 'asc' }
        });

        if (activeLoans.length === 0) {
            return res.json({
                success: true,
                hasReminder: false,
                activeCount: 0,
                reminderText: 'Tidak ada buku yang sedang dipinjam saat ini.'
            });
        }

        const now = new Date();
        const earliestLoan = activeLoans[0];
        const diffDays = Math.ceil((new Date(earliestLoan.jatuhTempo).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        let reminderText = '';
        let isOverdue = false;

        if (diffDays < 0) {
            isOverdue = true;
            reminderText = `⚠️ ${activeLoans.length} Buku terlambat dikembalikan (${Math.abs(diffDays)} hari lewat jatuh tempo)!`;
        } else if (diffDays === 0) {
            reminderText = `⏰ ${activeLoans.length} Buku jatuh tempo HARI INI! Segera kembalikan ke perpustakaan.`;
        } else {
            reminderText = `📖 ${activeLoans.length} Buku sedang dipinjam (Jatuh tempo: ${diffDays} hari lagi).`;
        }

        return res.json({
            success: true,
            hasReminder: true,
            activeCount: activeLoans.length,
            isOverdue,
            daysLeft: diffDays,
            reminderText,
            earliestDueDate: earliestLoan.jatuhTempo,
            bookTitle: earliestLoan.eksemplar?.buku?.judul || 'Buku Perpustakaan'
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
