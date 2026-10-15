import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ========================================================
// 1. CHAT BK ↔ ORANG TUA 1-ON-1 TERIKAT KASUS (MODUL 6-A & 6-B)
// ========================================================
export const getOrCreateChatThread = async (req: Request, res: Response) => {
    try {
        const { kasusId, siswaId, orangTuaId, bkId } = req.body;
        const currentUser = (req as any).user;

        // Validasi Kerahasiaan Server: Orang tua hanya bisa akses chat anaknya sendiri!
        if (currentUser && currentUser.role === 'PARENT') {
            const relation = await prisma.parentStudentLink.findFirst({
                where: { orangTua: { userId: currentUser.id }, siswaId }
            });
            if (!relation) {
                return res.status(403).json({
                    success: false,
                    message: 'Akses Ditolak: Anda hanya memiliki izin untuk mengakses data anak Anda sendiri.'
                });
            }
        }

        let thread = await prisma.bkParentChatThread.findFirst({
            where: {
                siswaId,
                orangTuaId
            },
            include: {
                messages: {
                    orderBy: { waktuKirim: 'asc' },
                    take: 50
                },
                kasus: true
            }
        });

        if (!thread) {
            thread = await prisma.bkParentChatThread.create({
                data: {
                    kasusId,
                    siswaId,
                    orangTuaId,
                    bkId: bkId || 'DEFAULT_BK',
                    status: 'BARU'
                },
                include: {
                    messages: true,
                    kasus: true
                }
            });
        }

        return res.json({ success: true, data: thread });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const sendChatMessage = async (req: Request, res: Response) => {
    try {
        const { percakapanId, pengirimId, senderRole, isi, tipeMedia, mediaUrl } = req.body;

        if (!percakapanId || !isi) {
            return res.status(400).json({ success: false, message: 'percakapanId dan isi pesan wajib diisi' });
        }

        const message = await prisma.bkParentChatMessage.create({
            data: {
                percakapanId,
                pengirimId,
                senderRole, // 'COUNSELOR' | 'PARENT'
                isi,
                tipeMedia: tipeMedia || 'TEXT',
                mediaUrl,
                statusBaca: false
            }
        });

        // Update timestamp aktivitas terakhir percakapan
        await prisma.bkParentChatThread.update({
            where: { id: percakapanId },
            data: { lastMessageAt: new Date() }
        });

        // Socket.io Realtime Broadcast ke Room Thread
        const io = (req as any).app?.get('io');
        if (io) {
            io.to(`thread_${percakapanId}`).emit('chat_message', message);
            io.to(`user_${pengirimId}`).emit('chat_sent', message);
            io.emit('chat_notification', {
                threadId: percakapanId,
                senderRole,
                pengirimId,
                preview: isi.substring(0, 60),
                waktuKirim: message.waktuKirim
            });
        }

        return res.json({ success: true, message: 'Pesan berhasil dikirim', data: message });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getChatThreads = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const role = user?.role;
        const userId = user?.id;

        let whereCondition: any = {};
        if (role === 'PARENT') {
            whereCondition.orangTuaId = userId;
        } else if (role === 'COUNSELOR' || role === 'BK') {
            whereCondition.bkId = userId;
        }

        const threads = await prisma.bkParentChatThread.findMany({
            where: whereCondition,
            include: {
                messages: {
                    orderBy: { waktuKirim: 'desc' },
                    take: 1
                },
                kasus: true
            },
            orderBy: { lastMessageAt: 'desc' }
        });

        return res.json({ success: true, count: threads.length, data: threads });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
};

export const getThreadMessages = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { threadId } = req.params;

        const thread = await prisma.bkParentChatThread.findUnique({
            where: { id: String(threadId) }
        });

        if (!thread) {
            return res.status(404).json({ success: false, message: 'Thread percakapan tidak ditemukan' });
        }

        // Access Control: Admin/Operator/Counselor or Thread's Parent or Student
        if (user.role === 'PARENT') {
            if (thread.orangTuaId !== user.id) {
                return res.status(403).json({ success: false, message: 'Akses ditolak: Anda bukan peserta dalam percakapan ini.' });
            }
        } else if (user.role === 'STUDENT') {
            if (thread.siswaId !== user.id) {
                return res.status(403).json({ success: false, message: 'Akses ditolak: Siswa tidak diizinkan membuka thread ini.' });
            }
        } else if (!['ADMIN', 'OPERATOR', 'COUNSELOR', 'BK'].includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Akses ditolak.' });
        }

        const messages = await prisma.bkParentChatMessage.findMany({
            where: { percakapanId: String(threadId) },
            orderBy: { waktuKirim: 'asc' },
            take: 100
        });

        return res.json({ success: true, count: messages.length, data: messages });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
};

export const reassignCaseCounselor = async (req: Request, res: Response) => {
    try {
        const { threadId, newCounselorId } = req.body;

        const updated = await prisma.bkParentChatThread.update({
            where: { id: threadId },
            data: { bkId: newCounselorId }
        });

        return res.json({
            success: true,
            message: 'Kasus dan percakapan berhasil dialihkan ke konselor baru tanpa menghapus riwayat pesan.',
            data: updated
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 2. DASHBOARD LINTAS MODUL KHUSUS ORANG TUA (MODUL 12-A)
// ========================================================
export const getParentUnifiedDashboard = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { siswaId } = req.params;
        const targetSiswaId = String(siswaId);

        // Access Control: Validasi Kerahasiaan Data Anak
        if (user.role === 'STUDENT') {
            if (user.id !== targetSiswaId) {
                return res.status(403).json({ success: false, message: 'Akses ditolak: Siswa hanya dapat melihat dashboard sendiri.' });
            }
        } else if (user.role === 'PARENT') {
            const relation = await prisma.parentStudentLink.findFirst({
                where: {
                    orangTua: { userId: user.id },
                    siswaId: targetSiswaId
                }
            });
            if (!relation) {
                const targetStudent = await prisma.user.findUnique({ where: { id: targetSiswaId } });
                const isMatched = targetStudent && (user.nisn === targetStudent.nisn || user.username === 'P' + targetStudent.nisn || user.username === 'p' + targetStudent.nisn);
                if (!isMatched) {
                    return res.status(403).json({ success: false, message: 'Akses ditolak: Anda bukan orang tua resmi siswa ini.' });
                }
            }
        } else if (!['ADMIN', 'OPERATOR', 'TEACHER', 'COUNSELOR', 'BK'].includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Akses ditolak.' });
        }

        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        // 1. Status Kehadiran Hari Ini (Geofencing / Gate)
        const todayAttendance = await prisma.studentGeofenceAttendance.findFirst({
            where: {
                siswaId: targetSiswaId,
                waktuTabServer: { gte: startOfDay }
            },
            include: { jadwal: true },
            orderBy: { waktuTabServer: 'desc' }
        });

        // 2. Status UKS Aktif / Kunjungan Hari Ini
        const activeUks = await prisma.uksVisitEvent.findFirst({
            where: {
                siswaId: targetSiswaId,
                status: { in: ['SEDANG_DIRAWAT', 'PERLU_DIJEMPUT'] }
            },
            orderBy: { tanggal: 'desc' }
        });

        // 3. Kasus BK yang Sedang Berjalan
        const activeBkCases = await prisma.bkCaseRecord.findMany({
            where: {
                siswaId: targetSiswaId,
                status: { in: ['BARU', 'DITINDAKLANJUTI'] }
            },
            take: 3
        });

        // 4. Pengumuman Sekolah Terbaru
        const announcements = await prisma.broadcastAnnouncement.findMany({
            where: { isPublished: true },
            orderBy: { waktuPublish: 'desc' },
            take: 3
        });

        return res.json({
            success: true,
            dashboard: {
                studentId: targetSiswaId,
                attendanceToday: todayAttendance ? {
                    status: todayAttendance.status,
                    time: todayAttendance.waktuTabServer,
                    subject: (todayAttendance as any).jadwal?.roomName || 'Kelas'
                } : { status: 'BELUM_TAB', time: null },
                uksStatus: activeUks ? {
                    isActive: true,
                    status: activeUks.status,
                    keluhan: activeUks.keluhan,
                    needsPickup: activeUks.status === 'PERLU_DIJEMPUT' && !activeUks.isKonfirmasiJemput
                } : { isActive: false },
                activeBkCasesCount: activeBkCases.length,
                recentAnnouncements: announcements
            }
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 3. KOMUNIKASI RINGAN GURU ↔ ORTU (MODUL 12-E)
// ========================================================
export const sendDirectTeacherParentMessage = async (req: Request, res: Response) => {
    try {
        const { guruId, orangTuaId, siswaId, isi } = req.body;

        const msg = await prisma.teacherParentDirectMsg.create({
            data: {
                guruId,
                orangTuaId,
                siswaId,
                isi
            }
        });

        return res.json({ success: true, message: 'Pesan terkirim ke orang tua', data: msg });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
