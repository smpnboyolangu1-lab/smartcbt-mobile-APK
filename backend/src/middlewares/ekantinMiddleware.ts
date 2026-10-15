import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/db';

/**
 * Middleware untuk memastikan fitur E-Kantin aktif di server.
 * Jika dinonaktifkan di pengaturan sistem, server langsung merespon 403 FEATURE_DISABLED.
 * Juga mendukung rollout bertahap per kelas jika dikonfigurasi.
 */
export async function ensureEkantinEnabled(req: Request, res: Response, next: NextFunction) {
    try {
        // Abaikan webhook Midtrans dari pengecekan agar konfirmasi pembayaran yang tertunda tetap selesai
        if (req.path.includes('/webhook')) {
            return next();
        }

        const IS_CANTEEN_LOCKED: boolean = true;
        if (IS_CANTEEN_LOCKED) {
            return res.status(403).json({
                success: false,
                code: 'CANTEEN_LOCKED',
                message: '⛔ Layanan E-Kantin dan seluruh transaksi pembayaran digital sementara DIKUNCI TOTAL oleh pihak sekolah.'
            });
        }

        // Cek rollout bertahap per kelas (opsional)
        const pilotClassSetting = await prisma.systemSetting.findFirst({
            where: {
                OR: [
                    { key: 'ekantin.pilot_classes' },
                    { key: 'ekantinEnabledClassIds' }
                ]
            }
        });

        if (pilotClassSetting && pilotClassSetting.value && pilotClassSetting.value.trim() !== 'ALL') {
            const allowedClasses = pilotClassSetting.value.split(',').map(c => c.trim().toUpperCase());
            const user = (req as any).user;
            if (user && user.role === 'STUDENT' && user.className) {
                const normClass = user.className.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                const isAllowed = allowedClasses.some(c => c.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === normClass);
                if (!isAllowed) {
                    return res.status(403).json({
                        success: false,
                        code: 'CLASS_NOT_IN_PILOT',
                        message: `Fitur E-Kantin saat ini baru dibuka untuk kelas percontohan (${pilotClassSetting.value}). Kelas Anda belum diaktifkan.`
                    });
                }
            }
        }

        return next();
    } catch (err: any) {
        console.error('[EkantinMiddleware] Error:', err);
        return next();
    }
}
