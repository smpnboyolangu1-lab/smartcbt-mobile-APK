import { Request, Response } from 'express';
import prisma from '../utils/db';
import path from 'path';
import fs from 'fs';

// 1. Operator Membuat & Mengirim Pengumuman / Surat Resmi dengan Lampiran PDF via APK & Portal
export const sendOperatorBroadcast = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const title = (req.body.title || '').trim();
        const content = (req.body.content || req.body.message || '').trim();
        const rawTargetType = (req.body.targetType || 'ALL').toUpperCase();
        const validTarget = ['ALL', 'GRADE', 'CLASS', 'STUDENT'].includes(rawTargetType) ? rawTargetType : 'ALL';
        const targetValue = (req.body.targetValue || req.body.targetGrade || req.body.targetClass || '').toString().trim();
        const pdfBase64 = req.body.pdfBase64;
        const category = req.body.category || 'PENTING';

        if (!title || !content) {
            return res.status(400).json({ success: false, message: 'Judul dan isi pengumuman wajib diisi.' });
        }

        let fileUrl: string | null = null;
        let fileSize: string = '0 KB';

        if (pdfBase64 && (pdfBase64.startsWith('data:application/pdf') || pdfBase64.startsWith('data:image/'))) {
            try {
                const uploadDir = path.join(process.cwd(), 'uploads', 'letters');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }

                const matches = pdfBase64.match(/^data:([a-zA-Z0-9/+-]+);base64,(.+)$/);
                if (matches) {
                    const mime = matches[1];
                    let ext = 'pdf';
                    if (mime.includes('image/png')) ext = 'png';
                    else if (mime.includes('image/jpeg')) ext = 'jpg';

                    const buffer = Buffer.from(matches[2], 'base64');
                    const fileName = `Surat_Resmi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
                    const fullPath = path.join(uploadDir, fileName);
                    fs.writeFileSync(fullPath, buffer);
                    fileUrl = `/uploads/letters/${fileName}`;

                    const sizeInKb = Math.round(buffer.length / 1024);
                    fileSize = sizeInKb > 1024 ? (sizeInKb / 1024).toFixed(1) + ' MB' : sizeInKb + ' KB';
                }
            } catch (err) {
                console.error('Error saving broadcast PDF:', err);
            }
        }

        const letterNo = `421.3/${Math.floor(100 + Math.random() * 900)}/SMPN.1-BYL/${new Date().getFullYear()}`;
        const senderName = `${user.name || 'Operator'} (Operator Sekolah)`;

        // 1. Buat OfficialLetter
        const officialLetter = await (prisma as any).officialLetter.create({
            data: {
                letterNo,
                title,
                content,
                targetType: validTarget,
                targetValue: validTarget === 'ALL' ? null : String(targetValue || '').trim(),
                fileUrl: fileUrl || '',
                fileSize,
                senderRole: 'OPERATOR',
                senderName
            }
        });

        // 2. Buat Announcement untuk Web Portal
        const announcement = await (prisma as any).announcement.create({
            data: {
                title,
                content: `${content}${fileUrl ? `\n\n📄 Lampiran Dokumen: ${fileUrl}` : ''}`,
                category: category || 'PENTING',
                author: senderName,
                isPinned: true
            }
        });

        // 3. Distribusikan NotificationMessage ke target siswa / orang tua
        let studentFilter: any = { role: 'STUDENT' };
        if (validTarget === 'CLASS' && targetValue) {
            studentFilter.className = String(targetValue).trim();
        } else if (validTarget === 'GRADE' && targetValue) {
            const gr = String(targetValue).trim(); // "7", "8", "9", "VII", "VIII", "IX"
            studentFilter.OR = [
                { className: { startsWith: gr } },
                { className: { startsWith: gr === '7' ? 'VII' : gr === '8' ? 'VIII' : 'IX' } }
            ];
        }

        const targetStudents = await prisma.user.findMany({
            where: studentFilter,
            select: { id: true, name: true, className: true }
        });

        // Simpan notifikasi ke target
        const notifData = targetStudents.slice(0, 100).map(s => ({
            recipientId: s.id,
            recipientRole: 'STUDENT',
            studentId: s.id,
            studentName: s.name,
            className: s.className,
            title: `📢 ${title}`,
            message: `${content} (Buka aplikasi untuk melihat dokumen PDF resmi)`,
            category: 'ANNOUNCEMENT'
        }));

        if (notifData.length > 0) {
            try {
                await (prisma as any).notificationMessage.createMany({
                    data: notifData
                });
            } catch (nErr) {}
        }

        res.json({
            success: true,
            message: `Pengumuman & Surat resmi berhasil disiarkan ke ${targetStudents.length} siswa dan portal sekolah.`,
            letter: officialLetter,
            announcement
        });
    } catch (error: any) {
        console.error('Error sendOperatorBroadcast:', error);
        res.status(500).json({ success: false, message: 'Gagal mengirim pengumuman: ' + error.message });
    }
};

// 2. Ambil Daftar Pengumuman Operator
export const getOperatorBroadcasts = async (req: Request, res: Response) => {
    try {
        const letters = await (prisma as any).officialLetter.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json({ success: true, letters });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat pengumuman: ' + error.message });
    }
};

// 3. Reset Device Binding Siswa (Buka Kunci HP Siswa)
export const resetDeviceBinding = async (req: Request, res: Response) => {
    try {
        const { studentId, nisn, username, query } = req.body;
        const target = (studentId || nisn || username || query || '').trim();

        if (!target) {
            return res.status(400).json({ success: false, message: 'Harap masukkan ID Siswa, NISN, atau Username yang ingin direset kunci HP-nya.' });
        }

        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { id: target },
                    { username: target },
                    { nisn: target }
                ]
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: `Siswa dengan identitas '${target}' tidak ditemukan di sistem.` });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                deviceBindingId: null
            }
        });

        return res.json({
            success: true,
            message: `Kunci perangkat (Device Binding) untuk siswa ${user.name} (${user.nisn || user.username}) berhasil direset! Siswa kini dapat login kembali di perangkat baru.`
        });
    } catch (error: any) {
        console.error('Error resetDeviceBinding:', error);
        return res.status(500).json({ success: false, message: 'Gagal mereset kunci perangkat: ' + error.message });
    }
};

