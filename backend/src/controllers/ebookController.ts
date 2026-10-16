import { Request, Response } from 'express';
import prisma from '../utils/db';
import fs from 'fs';
import path from 'path';

// ========================================================
// 1. MANAJEMEN CRUD E-BOOK MULTI-PLATFORM (MODUL PERPUSTAKAAN)
// ========================================================

/**
 * POST /api/v1/operator/ebooks
 * Operator/Guru mengunggah E-Book atau Modul Ajar baru (Multipart/form-data)
 */
export const createEbook = async (req: Request, res: Response) => {
    try {
        const { judul, pengarang, mataPelajaran, targetKelas, isPublished } = req.body;

        if (!judul || !pengarang || !mataPelajaran) {
            return res.status(400).json({
                success: false,
                message: 'Judul, pengarang, dan mata pelajaran wajib diisi.'
            });
        }

        // Ambil berkas dari multer
        const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        let coverUrl = '/uploads/ebooks/covers/default_cover.png';
        let filePdfUrl = '';
        let fileSizeMb = 0;

        if (files?.cover && files.cover.length > 0) {
            coverUrl = `/uploads/ebooks/covers/${files.cover[0].filename}`;
        } else if (req.body.coverUrl) {
            coverUrl = req.body.coverUrl;
        }

        if (files?.pdf && files.pdf.length > 0) {
            filePdfUrl = `/uploads/ebooks/pdfs/${files.pdf[0].filename}`;
            fileSizeMb = parseFloat((files.pdf[0].size / (1024 * 1024)).toFixed(2));
        } else if (req.body.filePdfUrl) {
            filePdfUrl = req.body.filePdfUrl;
        }

        if (!filePdfUrl) {
            return res.status(400).json({
                success: false,
                message: 'Berkas dokumen E-Book (PDF) wajib diunggah.'
            });
        }

        const validTargetKelas = ['VII', 'VIII', 'IX', 'SEMUA'].includes(targetKelas) ? targetKelas : 'SEMUA';
        const publishState = isPublished === 'true' || isPublished === true;

        const ebook = await (prisma as any).ebook.create({
            data: {
                judul,
                pengarang,
                mataPelajaran,
                targetKelas: validTargetKelas,
                coverUrl,
                filePdfUrl,
                fileSizeMb,
                isPublished: publishState
            }
        });

        return res.status(201).json({
            success: true,
            message: 'E-Book / Modul Ajar berhasil diterbitkan ke katalog.',
            data: ebook
        });
    } catch (error: any) {
        console.error('Error createEbook:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal menyimpan E-Book' });
    }
};

/**
 * PUT/PATCH /api/v1/operator/ebooks/:id
 * Memperbarui data koleksi E-Book atau mengganti cover/file
 */
export const updateEbook = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { judul, pengarang, mataPelajaran, targetKelas, isPublished } = req.body;

        const existing = await (prisma as any).ebook.findUnique({
            where: { id }
        });

        if (!existing || existing.isDeleted) {
            return res.status(404).json({ success: false, message: 'Koleksi E-Book tidak ditemukan.' });
        }

        const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        let coverUrl = existing.coverUrl;
        let filePdfUrl = existing.filePdfUrl;
        let fileSizeMb = existing.fileSizeMb;

        if (files?.cover && files.cover.length > 0) {
            coverUrl = `/uploads/ebooks/covers/${files.cover[0].filename}`;
        } else if (req.body.coverUrl) {
            coverUrl = req.body.coverUrl;
        }

        if (files?.pdf && files.pdf.length > 0) {
            filePdfUrl = `/uploads/ebooks/pdfs/${files.pdf[0].filename}`;
            fileSizeMb = parseFloat((files.pdf[0].size / (1024 * 1024)).toFixed(2));
        }

        const updated = await (prisma as any).ebook.update({
            where: { id },
            data: {
                judul: judul || existing.judul,
                pengarang: pengarang || existing.pengarang,
                mataPelajaran: mataPelajaran || existing.mataPelajaran,
                targetKelas: targetKelas !== undefined ? targetKelas : existing.targetKelas,
                coverUrl,
                filePdfUrl,
                fileSizeMb,
                isPublished: isPublished !== undefined ? (isPublished === 'true' || isPublished === true) : existing.isPublished
            }
        });

        return res.json({
            success: true,
            message: 'Data E-Book berhasil diperbarui.',
            data: updated
        });
    } catch (error: any) {
        console.error('Error updateEbook:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memperbarui E-Book' });
    }
};

/**
 * DELETE /api/v1/operator/ebooks/:id
 * Soft-delete koleksi E-Book dari katalog
 */
export const deleteEbook = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await (prisma as any).ebook.update({
            where: { id },
            data: { isDeleted: true }
        });

        return res.json({
            success: true,
            message: 'E-Book berhasil dihapus dari peredaran katalog.'
        });
    } catch (error: any) {
        console.error('Error deleteEbook:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal menghapus E-Book' });
    }
};

/**
 * GET /api/v1/student/ebooks
 * Mengembalikan daftar E-Book digital yang terbit sesuai jenjang kelas siswa yang login
 */
export const getStudentEbooks = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).user?.id;
        let studentGrade = 'SEMUA';

        if (studentId) {
            const student = await prisma.user.findUnique({
                where: { id: studentId },
                select: { className: true }
            });
            if (student?.className) {
                if (student.className.startsWith('VII-') || student.className.startsWith('7')) studentGrade = 'VII';
                else if (student.className.startsWith('VIII-') || student.className.startsWith('8')) studentGrade = 'VIII';
                else if (student.className.startsWith('IX-') || student.className.startsWith('9')) studentGrade = 'IX';
            }
        }

        const { search, subject } = req.query;
        const whereClause: any = {
            isDeleted: false,
            isPublished: true,
            targetKelas: { in: [studentGrade, 'SEMUA'] }
        };

        if (subject && subject !== 'ALL') {
            whereClause.mataPelajaran = String(subject);
        }

        if (search && typeof search === 'string' && search.trim()) {
            whereClause.OR = [
                { judul: { contains: search.trim() } },
                { pengarang: { contains: search.trim() } },
                { mataPelajaran: { contains: search.trim() } }
            ];
        }

        const ebooks = await (prisma as any).ebook.findMany({
            where: whereClause,
            orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }]
        });

        return res.json({
            success: true,
            studentGrade,
            count: ebooks.length,
            data: ebooks
        });
    } catch (error: any) {
        console.error('Error getStudentEbooks:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memuat E-Book siswa' });
    }
};

/**
 * GET /api/v1/operator/ebooks
 * Mengambil semua E-Book untuk manajemen Operator & Guru
 */
export const getAllEbooks = async (req: Request, res: Response) => {
    try {
        const { targetKelas, subject, search } = req.query;
        const whereClause: any = { isDeleted: false };

        if (targetKelas && targetKelas !== 'ALL') {
            whereClause.targetKelas = String(targetKelas);
        }
        if (subject && subject !== 'ALL') {
            whereClause.mataPelajaran = String(subject);
        }
        if (search && typeof search === 'string' && search.trim()) {
            whereClause.OR = [
                { judul: { contains: search.trim() } },
                { pengarang: { contains: search.trim() } }
            ];
        }

        const ebooks = await (prisma as any).ebook.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' }
        });

        return res.json({
            success: true,
            count: ebooks.length,
            data: ebooks
        });
    } catch (error: any) {
        console.error('Error getAllEbooks:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memuat koleksi E-Book' });
    }
};

/**
 * GET /api/v1/ebooks/popular
 * Banner buku terpopuler / rekomendasi minggu ini
 */
export const getPopularEbooks = async (req: Request, res: Response) => {
    try {
        const popular = await (prisma as any).ebook.findMany({
            where: { isDeleted: false, isPublished: true },
            orderBy: { viewCount: 'desc' },
            take: 6
        });

        return res.json({
            success: true,
            data: popular
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
