import { Request, Response } from 'express';
import prisma from '../utils/db';
import { enqueueActivityLog } from '../middleware/activityLogger';
import { triggerRealtimeAnomalyCheck } from '../utils/anomalyDetector';

export const getActivityLogs = async (req: Request, res: Response) => {
    try {
        const {
            date,
            module,
            outcome,
            className,
            userId,
            search,
            source,
            page = 1,
            limit = 50
        } = req.query;

        const where: any = {};

        // Filter Tanggal
        if (date && typeof date === 'string') {
            const start = new Date(`${date}T00:00:00.000Z`);
            const end = new Date(`${date}T23:59:59.999Z`);
            where.createdAt = { gte: start, lte: end };
        }

        // Filter Modul
        if (module && module !== 'ALL') {
            where.module = String(module);
        }

        // Filter Outcome
        if (outcome && outcome !== 'ALL') {
            where.outcome = String(outcome);
        }

        // Filter Source
        if (source && source !== 'ALL') {
            where.source = String(source);
        }

        // Filter Kelas
        if (className && className !== 'ALL') {
            where.className = String(className);
        }

        // Filter Siswa / User
        if (userId) {
            where.userId = String(userId);
        }

        // Filter Search (Nama, NISN/Username, Action, Message)
        if (search && typeof search === 'string' && search.trim().length > 0) {
            const s = search.trim();
            where.OR = [
                { name: { contains: s } },
                { username: { contains: s } },
                { action: { contains: s } },
                { message: { contains: s } },
                { deviceId: { contains: s } }
            ];
        }

        const pageNum = Math.max(1, Number(page));
        const limitNum = Math.min(200, Math.max(10, Number(limit)));
        const skip = (pageNum - 1) * limitNum;

        const [total, logs] = await Promise.all([
            prisma.activityEventLog.count({ where }),
            prisma.activityEventLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum
            })
        ]);

        return res.json({
            success: true,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum),
            data: logs
        });
    } catch (err: any) {
        console.error('Error fetching activity logs:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat log aktivitas: ' + err.message });
    }
};

export const getActivityLogsSummary = async (req: Request, res: Response) => {
    try {
        const { date } = req.query;
        const targetDate = date ? new Date(`${date}T00:00:00.000Z`) : new Date();
        targetDate.setHours(0, 0, 0, 0);

        const endTargetDate = new Date(targetDate);
        endTargetDate.setHours(23, 59, 59, 999);

        const whereDate = {
            createdAt: { gte: targetDate, lte: endTargetDate }
        };

        // Ringkasan per modul & outcome
        const rawGrouped = await prisma.activityEventLog.groupBy({
            by: ['module', 'outcome'],
            where: whereDate,
            _count: { id: true }
        });

        const modules = ['ATTENDANCE', 'CBT', 'HOMEWORK', 'EKANTIN', 'AUTH'];
        const summaryByModule: Record<string, { SUCCESS: number; REJECTED: number; ERROR: number; TOTAL: number }> = {};
        for (const m of modules) {
            summaryByModule[m] = { SUCCESS: 0, REJECTED: 0, ERROR: 0, TOTAL: 0 };
        }

        rawGrouped.forEach(g => {
            if (summaryByModule[g.module]) {
                const count = g._count.id;
                if (g.outcome === 'SUCCESS') summaryByModule[g.module].SUCCESS += count;
                else if (g.outcome === 'REJECTED') summaryByModule[g.module].REJECTED += count;
                else if (g.outcome === 'ERROR') summaryByModule[g.module].ERROR += count;
                summaryByModule[g.module].TOTAL += count;
            }
        });

        // Top 10 Alasan Penolakan
        const topRejectionsRaw = await prisma.activityEventLog.groupBy({
            by: ['module', 'message'],
            where: {
                ...whereDate,
                outcome: { in: ['REJECTED', 'ERROR'] },
                message: { not: null }
            },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 10
        });

        const topRejections = topRejectionsRaw
            .filter(r => r.message && r.message.trim().length > 0)
            .map(r => ({
                module: r.module,
                reason: r.message,
                count: r._count.id
            }));

        // Anomali aktif (OPEN)
        const openAnomaliesCount = await prisma.activityAnomaly.count({
            where: { status: 'OPEN' }
        });

        return res.json({
            success: true,
            date: targetDate.toISOString().substring(0, 10),
            summaryByModule,
            topRejections,
            openAnomaliesCount
        });
    } catch (err: any) {
        console.error('Error fetching activity log summary:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat ringkasan log: ' + err.message });
    }
};

export const getActivityAnomalies = async (req: Request, res: Response) => {
    try {
        const { status = 'OPEN', module } = req.query;
        const where: any = {};
        if (status && status !== 'ALL') {
            where.status = String(status);
        }
        if (module && module !== 'ALL') {
            where.module = String(module);
        }

        const anomalies = await prisma.activityAnomaly.findMany({
            where,
            orderBy: [
                { status: 'asc' }, // OPEN first
                { createdAt: 'desc' }
            ],
            take: 100
        });

        return res.json({ success: true, data: anomalies });
    } catch (err: any) {
        console.error('Error fetching anomalies:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat anomali: ' + err.message });
    }
};

export const resolveActivityAnomaly = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        const adminUser = (req as any).user;

        const updated = await prisma.activityAnomaly.update({
            where: { id: String(id) },
            data: {
                status: 'RESOLVED',
                resolvedAt: new Date(),
                resolvedBy: adminUser?.name || adminUser?.username || 'Petugas Sekolah',
                notes: notes ? String(notes) : undefined
            }
        });

        return res.json({ success: true, message: 'Anomali berhasil diselesaikan.', data: updated });
    } catch (err: any) {
        console.error('Error resolving anomaly:', err);
        return res.status(500).json({ success: false, message: 'Gagal menyelesaikan anomali: ' + err.message });
    }
};

export const getStudentActivityTimeline = async (req: Request, res: Response) => {
    try {
        const { studentId } = req.params;
        const { date } = req.query;

        const where: any = { userId: studentId };
        if (date && typeof date === 'string') {
            const start = new Date(`${date}T00:00:00.000Z`);
            const end = new Date(`${date}T23:59:59.999Z`);
            where.createdAt = { gte: start, lte: end };
        }

        const logs = await prisma.activityEventLog.findMany({
            where,
            orderBy: { createdAt: 'asc' },
            take: 200
        });

        return res.json({ success: true, studentId, data: logs });
    } catch (err: any) {
        console.error('Error fetching student timeline:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat linimasa siswa: ' + err.message });
    }
};

/**
 * 2.1 Endpoint Penerima Log APK (Kumpulan hingga 100 kejadian per kiriman)
 */
export const receiveApkActivityLogs = async (req: Request, res: Response) => {
    try {
        const logs = req.body?.logs || req.body?.events || (Array.isArray(req.body) ? req.body : null);
        if (!Array.isArray(logs) || logs.length === 0) {
            return res.status(400).json({ success: false, message: 'Format data log tidak valid (harus berupa array logs).' });
        }

        const rawDeviceId = req.headers['x-device-id'];
        const clientDeviceId = (Array.isArray(rawDeviceId) ? rawDeviceId[0] : rawDeviceId) || req.body?.deviceId;
        const rawAppVersion = req.headers['x-app-version'];
        const clientAppVersion = (Array.isArray(rawAppVersion) ? rawAppVersion[0] : rawAppVersion) || req.body?.appVersion;
        const rawFwdIp = req.headers['x-forwarded-for'];
        const ip = (Array.isArray(rawFwdIp) ? rawFwdIp[0] : rawFwdIp) || req.socket.remoteAddress;

        const itemsToEnqueue = logs.slice(0, 100).map((l: any) => {
            const item = {
                source: 'APK' as const,
                module: (l.module || 'ATTENDANCE') as any,
                action: String(l.action || 'APK_EVENT'),
                outcome: (l.outcome || (l.status === 'SUCCESS' ? 'SUCCESS' : (l.status === 'ERROR' ? 'ERROR' : 'REJECTED'))) as any,
                httpStatus: Number(l.httpStatus || 200),
                message: l.message ? String(l.message).substring(0, 500) : null,
                userId: l.userId || null,
                username: l.username || null,
                name: l.name || null,
                className: l.className || null,
                role: l.role || 'STUDENT',
                deviceId: l.deviceId || clientDeviceId || null,
                appVersion: l.appVersion || clientAppVersion || null,
                ip: typeof ip === 'string' ? ip.split(',')[0].trim() : null,
                durationMs: Number(l.durationMs || 0),
                payload: typeof l.payload === 'object' ? JSON.stringify(l.payload) : (l.payload || null),
                anomalyFlag: Boolean(l.anomalyFlag || l.outcome === 'REJECTED' || l.outcome === 'ERROR')
            };

            enqueueActivityLog(item);

            if (item.anomalyFlag) {
                setImmediate(() => {
                    triggerRealtimeAnomalyCheck(item).catch(() => {});
                });
            }

            return item;
        });

        return res.json({
            success: true,
            receivedCount: itemsToEnqueue.length,
            message: `Berhasil menerima ${itemsToEnqueue.length} log dari APK.`
        });
    } catch (err: any) {
        console.error('Error processing APK activity logs:', err);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan log APK: ' + err.message });
    }
};
