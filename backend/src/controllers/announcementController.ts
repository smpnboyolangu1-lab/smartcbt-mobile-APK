import { Request, Response } from 'express';
import prisma from '../utils/db';

import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'smart-cbt-secret-key-boyolangu-2024';

export const getAnnouncements = async (req: Request, res: Response) => {
    try {
        // Deteksi identitas pengguna jika ada Authorization header
        let student: any = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded: any = jwt.verify(token, JWT_SECRET);
                if (decoded && decoded.id) {
                    student = await prisma.user.findUnique({
                        where: { id: decoded.id },
                        select: { id: true, name: true, className: true, nisn: true, username: true, role: true }
                    });
                }
            } catch (jwtErr) {}
        }

        // Fallback pencarian siswa via query params jika ada
        if (!student && (req.query.className || req.query.studentId || req.query.nisn)) {
            const qCls = String(req.query.className || '');
            const qId = String(req.query.studentId || req.query.nisn || '');
            student = {
                id: qId,
                className: qCls,
                nisn: qId,
                username: qId,
                name: ''
            };
        }

        const className = (student?.className || '').toUpperCase();
        let gradeNumber = '';
        if (className.includes('VII') || className.startsWith('7')) gradeNumber = '7';
        else if (className.includes('VIII') || className.startsWith('8')) gradeNumber = '8';
        else if (className.includes('IX') || className.startsWith('9')) gradeNumber = '9';

        // 1. Ambil Pengumuman Umum
        const rawAnnouncements = await prisma.announcement.findMany({
            orderBy: [
                { isPinned: 'desc' },
                { createdAt: 'desc' }
            ]
        });

        // 2. Ambil Surat Edaran Resmi Terbitan Sekolah
        const allLetters = await (prisma as any).officialLetter.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        const userRole = (student?.role || '').toUpperCase();
        const isAdminOrOperator = userRole === 'ADMIN' || userRole === 'OPERATOR';
        const isTeacher = userRole === 'TEACHER' || userRole === 'GURU';

        const relevantLetters = allLetters.filter((letter: any) => {
            // Admin dan Operator dapat melihat semua surat
            if (isAdminOrOperator) return true;

            // Target ALL selalu tampil untuk semua pengguna
            if (letter.targetType === 'ALL') return true;

            // Guru dapat melihat surat untuk ALL, GRADE, dan CLASS
            if (isTeacher) {
                return letter.targetType === 'ALL' || letter.targetType === 'GRADE' || letter.targetType === 'CLASS';
            }

            // Jika identitas siswa tidak diketahui (akses publik/web umum/belum login)
            if (!student) return letter.targetType === 'ALL' || letter.targetType === 'GRADE';

            // Filter Per Tingkat (GRADE)
            if (letter.targetType === 'GRADE') {
                const targetGrade = String(letter.targetValue || '').trim().toUpperCase();
                if (!gradeNumber) return true;
                return targetGrade === gradeNumber || 
                       targetGrade === `KELAS ${gradeNumber}` || 
                       targetGrade === (gradeNumber === '7' ? 'VII' : (gradeNumber === '8' ? 'VIII' : 'IX')) ||
                       className.includes(targetGrade);
            }

            // Filter Per Kelas (CLASS)
            if (letter.targetType === 'CLASS') {
                const targetCls = String(letter.targetValue || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                const cleanCls = className.replace(/[^A-Z0-9]/g, '');
                return cleanCls && (targetCls === cleanCls || targetCls === `KELAS${cleanCls}`);
            }

            // Filter Per Siswa (STUDENT)
            if (letter.targetType === 'STUDENT') {
                const targetVal = String(letter.targetValue || '').trim().toLowerCase();
                return targetVal === (student.id || '').toLowerCase() ||
                       targetVal === (student.nisn || '').toLowerCase() ||
                       targetVal === (student.username || '').toLowerCase() ||
                       (student.name && student.name.toLowerCase().includes(targetVal));
            }

            return false;
        });

        // Format surat resmi agar kompatibel dengan model AnnouncementItemDto di APK
        const mappedLetters = relevantLetters.map((l: any) => {
            let catBadge = 'SURAT EDARAN RESMI';
            if (l.targetType === 'ALL') catBadge = 'SURAT EDARAN (SEMUA)';
            else if (l.targetType === 'GRADE') catBadge = `SURAT EDARAN (TINGKAT ${l.targetValue || ''})`;
            else if (l.targetType === 'CLASS') catBadge = `SURAT EDARAN (KELAS ${l.targetValue || ''})`;
            else if (l.targetType === 'STUDENT') catBadge = 'SURAT RESMI (PERSONAL)';

            return {
                id: l.id,
                title: l.title || 'Surat Edaran Resmi',
                content: l.content || '',
                category: catBadge,
                author: l.senderName || 'Pihak Sekolah',
                isPinned: true,
                fileUrl: l.fileUrl || null,
                fileSize: l.fileSize || (l.fileUrl ? 'Dokumen PDF' : null),
                letterNo: l.letterNo || null,
                targetType: l.targetType,
                targetValue: l.targetValue,
                createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : new Date().toISOString()
            };
        });

        // 3. Ambil Broadcast Announcement (Modul 5)
        let broadcastItems: any[] = [];
        try {
            const rawBroadcasts = await prisma.broadcastAnnouncement.findMany({
                where: { isPublished: true },
                include: { receipts: true },
                orderBy: { createdAt: 'desc' },
                take: 50
            });

            broadcastItems = rawBroadcasts.filter(b => {
                // Admin dan Operator dapat memantau seluruh siaran broadcast
                if (isAdminOrOperator) return true;

                // Guru dapat memantau seluruh broadcast sekolah, tingkat, dan siswa
                if (isTeacher) return true;

                const bLvl = (b.targetLevel || '').toUpperCase();
                if (bLvl === 'SEKOLAH') return true;

                // Jika pengguna belum terautentikasi (tampilan publik), tampilkan siaran siswa & sekolah umum
                if (!student || !userRole) {
                    return bLvl === 'STUDENT_ONLY' || bLvl === 'STUDENT_PARENT' || bLvl === 'SEKOLAH';
                }

                if (bLvl === 'STUDENT_ONLY') return userRole === 'STUDENT';
                if (bLvl === 'PARENT_ONLY') return userRole === 'PARENT';
                if (bLvl === 'STUDENT_PARENT') return userRole === 'STUDENT' || userRole === 'PARENT';
                if (bLvl === 'ROLE') {
                    const r = (b.targetId || '').toUpperCase();
                    if (r === 'STUDENT_PARENT') return userRole === 'STUDENT' || userRole === 'PARENT';
                    return r === userRole;
                }
                if (bLvl === 'TINGKAT') {
                    if (!gradeNumber) return true;
                    const t = (b.targetId || '').toUpperCase();
                    return t === gradeNumber || t.includes(gradeNumber) || (gradeNumber === '7' && t === 'VII') || (gradeNumber === '8' && t === 'VIII') || (gradeNumber === '9' && t === 'IX');
                }
                if (bLvl === 'KELAS') {
                    if (!className) return true;
                    const targetCls = (b.targetId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                    const cleanCls = className.replace(/[^A-Z0-9]/g, '');
                    return targetCls === cleanCls || targetCls === `KELAS${cleanCls}`;
                }
                return true;
            }).map(b => {
                let badge = '📢 BROADCAST';
                if (b.prioritas === 'MENDESAK') badge = '🚨 MENDESAK';
                else if (b.prioritas === 'PENTING') badge = '⚠️ PENTING';

                const readCount = b.receipts.filter(r => r.statusBaca).length;
                const yesCount = b.receipts.filter(r => r.quickResponse === 'YA').length;
                const noCount = b.receipts.filter(r => r.quickResponse === 'TIDAK').length;

                return {
                    id: b.id,
                    title: b.judul || 'Pengumuman Broadcast',
                    content: b.isi || '',
                    category: badge,
                    prioritas: b.prioritas,
                    targetLevel: b.targetLevel,
                    targetId: b.targetId,
                    author: b.dibuatOlehId || 'Admin Sekolah',
                    isPinned: b.prioritas === 'MENDESAK' || b.prioritas === 'PENTING',
                    fileUrl: b.lampiranUrl || null,
                    fileSize: b.lampiranUrl ? 'Lampiran Berkas' : null,
                    lampiranUrl: b.lampiranUrl || null,
                    letterNo: null,
                    targetType: b.targetLevel,
                    targetValue: b.targetId,
                    stats: {
                        totalReceipts: b.receipts.length,
                        readCount,
                        yesCount,
                        noCount
                    },
                    createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString()
                };
            });
        } catch (bErr) {
            console.warn('[Announcements] Broadcast fetch error:', bErr);
        }

        // Format raw announcements (Pengumuman Umum)
        const mappedRawAnnouncements = rawAnnouncements.map((a: any) => ({
            id: a.id,
            title: a.title || 'Pengumuman',
            content: a.content || '',
            category: a.category || 'UMUM',
            author: a.author || 'Admin Sekolah',
            isPinned: !!a.isPinned,
            fileUrl: null,
            fileSize: null,
            letterNo: null,
            targetType: 'ALL',
            targetValue: null,
            createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString()
        }));

        const combined = [...broadcastItems, ...mappedLetters, ...mappedRawAnnouncements].sort((a: any, b: any) => {
            // Urutkan prioritas MENDESAK paling atas
            if (a.prioritas === 'MENDESAK' && b.prioritas !== 'MENDESAK') return -1;
            if (b.prioritas === 'MENDESAK' && a.prioritas !== 'MENDESAK') return 1;
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        res.json(combined);
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({ message: 'Gagal mengambil pengumuman' });
    }
};

export const createAnnouncement = async (req: Request, res: Response) => {
    try {
        const { title, content, category, author, isPinned } = req.body;
        if (!title || !content) {
            return res.status(400).json({ message: 'Judul dan isi pengumuman wajib diisi' });
        }

        const announcement = await prisma.announcement.create({
            data: {
                title,
                content,
                category: category || 'UMUM',
                author: author || 'Admin Sekolah',
                isPinned: !!isPinned
            }
        });

        // Buat notifikasi instan ke seluruh pengguna (Siswa, Orang Tua, dan Guru)
        try {
            const notifCategory = 'ANNOUNCEMENT';
            const catPrefix = category ? `[${category}] ` : '';
            const notifTitle = `📢 Pengumuman Baru: ${catPrefix}${title}`;
            const shortContent = content.length > 140 ? content.substring(0, 137) + '...' : content;

            // Notifikasi untuk Siswa
            await prisma.notificationMessage.create({
                data: {
                    recipientRole: 'STUDENT',
                    title: notifTitle,
                    message: shortContent,
                    category: notifCategory
                }
            });

            // Notifikasi untuk Orang Tua
            await prisma.notificationMessage.create({
                data: {
                    recipientRole: 'PARENT',
                    title: notifTitle,
                    message: shortContent,
                    category: notifCategory
                }
            });

            // Notifikasi untuk Guru
            await prisma.notificationMessage.create({
                data: {
                    recipientRole: 'TEACHER',
                    title: notifTitle,
                    message: shortContent,
                    category: notifCategory
                }
            });
        } catch (notifErr) {
            console.warn('[Announcements] Failed to create broadcast notificationMessage:', notifErr);
        }

        res.json({ message: 'Pengumuman berhasil disiarkan', announcement });
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).json({ message: 'Gagal membuat pengumuman' });
    }
};

export const deleteAnnouncement = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        await prisma.announcement.delete({ where: { id } });
        res.json({ message: 'Pengumuman berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({ message: 'Gagal menghapus pengumuman' });
    }
};
