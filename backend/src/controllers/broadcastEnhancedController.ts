import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ========================================================
// 1. PREVIEW PENERIMA & BUAT PENGUMUMAN (MODUL 5-A & 5-B)
// ========================================================
export const previewBroadcastAudience = async (req: Request, res: Response) => {
    try {
        const { targetLevel, targetId, targetRole } = req.body;
        // targetLevel: 'SEKOLAH' | 'TINGKAT' | 'KELAS' | 'ROLE' | 'INDIVIDUAL'

        let studentCount = 0;
        let parentCount = 0;
        let teacherCount = 0; // Guru tidak perlu menerima broadcast siswa/orang tua sesuai instruksi

        const tLvl = String(targetLevel || '').toUpperCase();

        if (tLvl === 'STUDENT_ONLY' || (tLvl === 'ROLE' && String(targetRole || targetId).toUpperCase() === 'STUDENT')) {
            studentCount = await prisma.user.count({ where: { role: 'STUDENT', isActive: true } });
            parentCount = 0;
        } else if (tLvl === 'PARENT_ONLY' || (tLvl === 'ROLE' && String(targetRole || targetId).toUpperCase() === 'PARENT')) {
            parentCount = await prisma.user.count({ where: { role: 'PARENT', isActive: true } });
            studentCount = 0;
        } else if (tLvl === 'STUDENT_PARENT' || tLvl === 'SEKOLAH' || !targetLevel) {
            studentCount = await prisma.user.count({ where: { role: 'STUDENT', isActive: true } });
            parentCount = await prisma.user.count({ where: { role: 'PARENT', isActive: true } });
        } else if (tLvl === 'TINGKAT') {
            const rawTingkat = String(targetId || '').toUpperCase();
            let prefix = 'VII';
            if (rawTingkat.includes('8') || rawTingkat === 'VIII') prefix = 'VIII';
            else if (rawTingkat.includes('9') || rawTingkat === 'IX') prefix = 'IX';
            else if (rawTingkat.includes('7') || rawTingkat === 'VII') prefix = 'VII';

            studentCount = await prisma.user.count({
                where: {
                    role: 'STUDENT',
                    isActive: true,
                    className: { startsWith: prefix }
                }
            });
            parentCount = studentCount;
        } else if (tLvl === 'KELAS') {
            studentCount = await prisma.user.count({
                where: { role: 'STUDENT', className: String(targetId), isActive: true }
            });
            parentCount = studentCount;
        }

        const totalEstimated = studentCount + parentCount;

        let breakdownText = '';
        if (studentCount > 0 && parentCount > 0) breakdownText = `${studentCount} siswa & ${parentCount} orang tua`;
        else if (studentCount > 0) breakdownText = `${studentCount} siswa saja`;
        else if (parentCount > 0) breakdownText = `${parentCount} orang tua saja`;
        else breakdownText = `0 penerima`;

        return res.json({
            success: true,
            preview: {
                studentCount,
                parentCount,
                teacherCount,
                totalEstimated,
                summaryMessage: `Siaran ini akan menjangkau sekitar ${totalEstimated} penerima (${breakdownText}).`
            }
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const createBroadcastAnnouncement = async (req: Request, res: Response) => {
    try {
        const {
            judul,
            isi,
            lampiranUrl,
            prioritas, // 'BIASA' | 'PENTING' | 'MENDESAK'
            targetLevel, // 'SEKOLAH' | 'TINGKAT' | 'KELAS' | 'ROLE' | 'INDIVIDUAL'
            targetId,
            waktuPublish,
            dibuatOlehId
        } = req.body;

        if (!judul || !isi) {
            return res.status(400).json({ success: false, message: 'Judul dan isi pengumuman wajib diisi' });
        }

        const publishDate = waktuPublish ? new Date(waktuPublish) : new Date();

        const announcement = await prisma.broadcastAnnouncement.create({
            data: {
                judul,
                isi,
                lampiranUrl: lampiranUrl || null,
                prioritas: prioritas || 'BIASA',
                targetLevel: targetLevel || 'SEKOLAH',
                targetId: targetId || null,
                dibuatOlehId: dibuatOlehId || (req as any).user?.name || (req as any).user?.username || 'ADMIN',
                waktuPublish: publishDate,
                isPublished: publishDate <= new Date()
            }
        });

        // Audit Log
        try {
            await prisma.operatorActivityLog.create({
                data: {
                    operatorId: dibuatOlehId || (req as any).user?.id || 'ADMIN',
                    jenisAksi: 'BUAT_PENGUMUMAN',
                    modulTerkait: 'PENGUMUMAN',
                    detail: `Broadcast "${judul}" prioritas ${prioritas || 'BIASA'} ke target ${targetLevel || 'SEKOLAH'}${targetId ? ' (' + targetId + ')' : ''}`
                }
            });
        } catch (auditErr) {
            console.warn('[AuditLog] Notice:', auditErr);
        }

        // Distribusikan NotificationMessage agar APK siswa/orangtua langsung menerima popup & notifikasi
        try {
            const shortContent = isi.length > 140 ? isi.substring(0, 137) + '...' : isi;
            const notifTitle = `📢 ${prioritas === 'MENDESAK' ? '🚨 [MENDESAK] ' : (prioritas === 'PENTING' ? '⚠️ [PENTING] ' : '')}${judul}`;
            const tLvl = String(targetLevel || 'SEKOLAH').toUpperCase();

            // Notifikasi Siswa
            if (tLvl === 'SEKOLAH' || tLvl === 'STUDENT_ONLY' || tLvl === 'STUDENT_PARENT' || (tLvl === 'ROLE' && (targetId === 'STUDENT' || targetId === 'STUDENT_PARENT'))) {
                await (prisma as any).notificationMessage.create({
                    data: {
                        recipientRole: 'STUDENT',
                        title: notifTitle,
                        message: shortContent,
                        category: 'ANNOUNCEMENT'
                    }
                });
            } else if (tLvl === 'KELAS' && targetId) {
                await (prisma as any).notificationMessage.create({
                    data: {
                        recipientRole: 'STUDENT',
                        className: String(targetId).trim(),
                        title: notifTitle,
                        message: shortContent,
                        category: 'ANNOUNCEMENT'
                    }
                });
            }

            // Notifikasi Orang Tua
            if (tLvl === 'SEKOLAH' || tLvl === 'PARENT_ONLY' || tLvl === 'STUDENT_PARENT' || (tLvl === 'ROLE' && (targetId === 'PARENT' || targetId === 'STUDENT_PARENT'))) {
                await (prisma as any).notificationMessage.create({
                    data: {
                        recipientRole: 'PARENT',
                        title: notifTitle,
                        message: shortContent,
                        category: 'ANNOUNCEMENT'
                    }
                });
            }
        } catch (notifErr) {
            console.warn('[Broadcast] Notif creation notice:', notifErr);
        }

        return res.json({
            success: true,
            message: 'Pengumuman broadcast berhasil disiarkan',
            data: announcement
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 2. LIST PENGUMUMAN BROADCAST LENGKAP (MODUL 5)
// ========================================================
export const getBroadcastAnnouncements = async (req: Request, res: Response) => {
    try {
        const { targetLevel, prioritas, limit } = req.query;

        const where: any = { isPublished: true };
        if (targetLevel) where.targetLevel = String(targetLevel);
        if (prioritas) where.prioritas = String(prioritas);

        const take = limit ? Math.min(Number(limit), 100) : 50;

        const announcements = await prisma.broadcastAnnouncement.findMany({
            where,
            include: {
                receipts: {
                    select: {
                        userId: true,
                        statusBaca: true,
                        quickResponse: true,
                        waktuBaca: true,
                        waktuRespon: true
                    }
                }
            },
            orderBy: [
                { createdAt: 'desc' }
            ],
            take
        });

        // Priority sort: MENDESAK first, then PENTING, then BIASA
        const priorityOrder: Record<string, number> = { 'MENDESAK': 0, 'PENTING': 1, 'BIASA': 2 };
        const sorted = [...announcements].sort((a, b) => {
            const pA = priorityOrder[a.prioritas] ?? 3;
            const pB = priorityOrder[b.prioritas] ?? 3;
            if (pA !== pB) return pA - pB;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        const requestingUserId = (req as any).user?.id || null;

        const mapped = sorted.map(a => {
            const totalReceipts = a.receipts.length;
            const readCount = a.receipts.filter(r => r.statusBaca).length;
            const yesCount = a.receipts.filter(r => r.quickResponse === 'YA').length;
            const noCount = a.receipts.filter(r => r.quickResponse === 'TIDAK').length;
            const uncertainCount = a.receipts.filter(r => r.quickResponse === 'BELUM_PASTI').length;

            let myReceipt = null;
            if (requestingUserId) {
                myReceipt = a.receipts.find(r => r.userId === requestingUserId) || null;
            }

            return {
                id: a.id,
                judul: a.judul,
                isi: a.isi,
                lampiranUrl: a.lampiranUrl,
                prioritas: a.prioritas, // 'BIASA', 'PENTING', 'MENDESAK'
                targetLevel: a.targetLevel, // 'SEKOLAH', 'TINGKAT', 'KELAS', 'ROLE', 'INDIVIDUAL'
                targetId: a.targetId,
                dibuatOlehId: a.dibuatOlehId,
                waktuPublish: a.waktuPublish,
                createdAt: a.createdAt,
                stats: {
                    totalReceipts,
                    readCount,
                    yesCount,
                    noCount,
                    uncertainCount
                },
                userReceipt: myReceipt ? {
                    statusBaca: myReceipt.statusBaca,
                    quickResponse: myReceipt.quickResponse,
                    waktuBaca: myReceipt.waktuBaca,
                    waktuRespon: myReceipt.waktuRespon
                } : null
            };
        });

        return res.json({
            success: true,
            total: mapped.length,
            data: mapped
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 3. DELETE PENGUMUMAN BROADCAST
// ========================================================
export const deleteBroadcastAnnouncement = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await prisma.broadcastAnnouncement.delete({
            where: { id: String(id) }
        });

        try {
            await prisma.operatorActivityLog.create({
                data: {
                    operatorId: (req as any).user?.id || 'ADMIN',
                    jenisAksi: 'HAPUS_PENGUMUMAN',
                    modulTerkait: 'PENGUMUMAN',
                    detail: `Menghapus broadcast announcement ID: ${id}`
                }
            });
        } catch (e) {}

        return res.json({
            success: true,
            message: 'Pengumuman broadcast berhasil dihapus'
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 4. READ RECEIPT & QUICK RESPONSE CONFIRMATION (MODUL 5-C)
// ========================================================
export const recordAnnouncementResponse = async (req: Request, res: Response) => {
    try {
        const { pengumumanId, quickResponse } = req.body; // quickResponse: 'YA' | 'TIDAK' | 'BELUM_PASTI'
        const userId = req.body.userId || (req as any).user?.id;

        if (!pengumumanId || !userId) {
            return res.status(400).json({ success: false, message: 'pengumumanId dan userId wajib disertakan' });
        }

        const receipt = await prisma.announcementReadReceipt.upsert({
            where: {
                pengumumanId_userId: { pengumumanId, userId }
            },
            create: {
                pengumumanId,
                userId,
                statusBaca: true,
                waktuBaca: new Date(),
                quickResponse: quickResponse || null,
                waktuRespon: quickResponse ? new Date() : null
            },
            update: {
                statusBaca: true,
                waktuBaca: new Date(),
                quickResponse: quickResponse ? quickResponse : undefined,
                waktuRespon: quickResponse ? new Date() : undefined
            }
        });

        return res.json({
            success: true,
            message: 'Respon pengumuman berhasil disimpan',
            data: receipt
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getBroadcastReceiptStats = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const receipts = await prisma.announcementReadReceipt.findMany({
            where: { pengumumanId: String(id) }
        });

        const readCount = receipts.filter(r => r.statusBaca).length;
        const yesCount = receipts.filter(r => r.quickResponse === 'YA').length;
        const noCount = receipts.filter(r => r.quickResponse === 'TIDAK').length;
        const uncertainCount = receipts.filter(r => r.quickResponse === 'BELUM_PASTI').length;

        return res.json({
            success: true,
            stats: {
                totalReceipts: receipts.length,
                readCount,
                responses: {
                    yes: yesCount,
                    no: noCount,
                    uncertain: uncertainCount
                }
            }
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
