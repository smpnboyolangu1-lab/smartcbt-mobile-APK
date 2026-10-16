import { Request, Response } from 'express';
import prisma from '../utils/db';

// ========================================================
// 1. COMMAND CENTER DASHBOARD (MODUL 8-A)
// ========================================================
export const getOperatorCommandCenter = async (req: Request, res: Response) => {
    try {
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        // 1. Izin guru hari ini
        const teacherLeavesToday = await prisma.teacherLeavePermit.count({
            where: { waktuDiajukan: { gte: startOfDay } }
        });

        // 2. Kunjungan UKS aktif "Sedang Dirawat" atau "Perlu Dijemput"
        const activeUksCount = await prisma.uksVisitEvent.count({
            where: { status: { in: ['SEDANG_DIRAWAT', 'PERLU_DIJEMPUT'] } }
        });

        // 3. Pengumuman terjadwal belum publish
        const scheduledAnnouncements = await prisma.broadcastAnnouncement.count({
            where: { isPublished: false, waktuPublish: { gt: new Date() } }
        });

        // 4. Peminjaman perpustakaan terlambat
        const overdueLoansCount = await prisma.libraryLoan.count({
            where: { statusPinjam: 'AKTIF', jatuhTempo: { lt: new Date() } }
        });

        // 5. Antrean Verifikasi Manual Kurikulum & Fake GPS Anomaly
        const pendingAnomalies = await prisma.attendanceAnomalyLog.count({
            where: { statusReview: 'PENDING' }
        });

        return res.json({
            success: true,
            commandCenter: {
                teacherLeavesToday,
                activeUksCount,
                scheduledAnnouncements,
                overdueLoansCount,
                pendingAnomalies
            },
            timestamp: new Date()
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 2. LOG AUDIT AKTIVITAS OPERATOR (MODUL 8-F)
// ========================================================
export const getOperatorAuditLogs = async (req: Request, res: Response) => {
    try {
        const { operatorId, modul } = req.query;

        const whereClause: any = {};
        if (operatorId) whereClause.operatorId = String(operatorId);
        if (modul) whereClause.modulTerkait = String(modul);

        const logs = await prisma.operatorActivityLog.findMany({
            where: whereClause,
            orderBy: { waktu: 'desc' },
            take: 100
        });

        return res.json({ success: true, count: logs.length, data: logs });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 3. PERMISSION RBAC OPERATOR (MATRIKS OPERATOR VS ADMIN)
// ========================================================
export const getOperatorPermissions = async (req: Request, res: Response) => {
    try {
        const { operatorId } = req.params;

        const permissions = await prisma.operatorModuleAccessRight.findMany({
            where: { operatorId: String(operatorId) }
        });

        return res.json({ success: true, data: permissions });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const updateOperatorPermission = async (req: Request, res: Response) => {
    try {
        const { operatorId, modul, canRead, canWrite, canApprove } = req.body;

        const perm = await prisma.operatorModuleAccessRight.upsert({
            where: {
                operatorId_modul: { operatorId, modul }
            },
            create: {
                operatorId,
                modul,
                canRead: canRead ?? true,
                canWrite: canWrite ?? true,
                canApprove: canApprove ?? false
            },
            update: {
                canRead: canRead ?? undefined,
                canWrite: canWrite ?? undefined,
                canApprove: canApprove ?? undefined
            }
        });

        return res.json({ success: true, message: 'Hak akses operator berhasil diperbarui', data: perm });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
