import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middlewares/authMiddleware';
import {
    createTopup,
    handleMidtransWebhook,
    checkTopupStatus,
    getTopupHistory,
    getPortalTopupSummary
} from '../controllers/canteenTopupController';

const router = Router();

// In-Memory Sliding Window Rate Limiter untuk Top-Up
const topupRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const topupRateLimit = (req: any, res: any, next: any) => {
    const key = req.user?.id || req.body?.studentId || req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 10 * 60 * 1000; // 10 Menit
    const maxRequests = 10;          // Maks 10 permintaan per 10 menit per akun

    const entry = topupRateLimitMap.get(String(key));
    if (!entry || now > entry.resetAt) {
        topupRateLimitMap.set(String(key), { count: 1, resetAt: now + windowMs });
        return next();
    }

    if (entry.count >= maxRequests) {
        return res.status(429).json({
            success: false,
            message: 'Terlalu banyak permintaan transaksi. Harap tunggu beberapa menit.'
        });
    }

    entry.count++;
    next();
};

// Webhook dari Midtrans — TIDAK pakai auth middleware (diverifikasi via signature key SHA-512)
router.post('/webhook', handleMidtransWebhook);

// Ringkasan untuk Dashboard Portal Admin / Bendahara Kantin
router.get('/portal-summary', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getPortalTopupSummary);

// Endpoint Orang Tua & Admin / Portal — Wajib JWT
router.post('/create', authenticateJWT, requireRole(['PARENT', 'ADMIN']), topupRateLimit, createTopup);
router.get('/status/:orderId', authenticateJWT, requireRole(['PARENT', 'ADMIN', 'OPERATOR', 'TEACHER']), checkTopupStatus);
router.get('/history', authenticateJWT, requireRole(['PARENT', 'ADMIN', 'OPERATOR', 'TEACHER']), getTopupHistory);

export default router;
