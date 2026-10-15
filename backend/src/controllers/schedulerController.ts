import { Request, Response } from 'express';
import { processDailyAutoRecap } from '../services/systemScheduler';

/**
 * Controller Rekap Otomatis Scheduler
 * Mengizinkan eksekusi manual dan monitoring status rekap harian oleh Admin / Operator
 */
export const triggerDailyAutoRecap = async (req: Request, res: Response) => {
    try {
        const recap = await processDailyAutoRecap();
        res.json({
            success: true,
            message: '✅ Rekap otomatis harian berhasil dijalankan.',
            recap
        });
    } catch (error: any) {
        console.error('Error triggering daily auto recap:', error);
        res.status(500).json({ success: false, message: 'Gagal menjalankan rekap otomatis: ' + error.message });
    }
};
