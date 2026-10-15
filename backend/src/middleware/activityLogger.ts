import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/db';
import { triggerRealtimeAnomalyCheck } from '../utils/anomalyDetector';

export interface ActivityLogItem {
    source: 'SERVER' | 'APK';
    module: 'ATTENDANCE' | 'CBT' | 'HOMEWORK' | 'EKANTIN' | 'AUTH' | 'EXTRACURRICULAR' | 'APP_CLIENT';
    action: string;
    outcome: 'SUCCESS' | 'REJECTED' | 'ERROR';
    httpStatus: number;
    message?: string | null;
    userId?: string | null;
    username?: string | null;
    name?: string | null;
    className?: string | null;
    role?: string | null;
    deviceId?: string | null;
    appVersion?: string | null;
    ip?: string | null;
    durationMs?: number;
    payload?: string | null;
    anomalyFlag?: boolean;
}

// Queue in-memory dengan buffer penulisan micro-batch ke SQLite setiap 2 detik
const logQueue: ActivityLogItem[] = [];
let isFlushing = false;

async function flushLogQueue() {
    if (isFlushing || logQueue.length === 0) return;
    isFlushing = true;

    // Ambil maksimal 50 item per batch agar transaksi SQLite cepat
    const batch = logQueue.splice(0, 50);

    try {
        await prisma.$transaction(
            batch.map(b => prisma.activityEventLog.create({
                data: {
                    source: b.source || 'SERVER',
                    module: b.module,
                    action: b.action,
                    outcome: b.outcome,
                    httpStatus: b.httpStatus,
                    message: b.message ? String(b.message).substring(0, 500) : null,
                    userId: b.userId || null,
                    username: b.username || null,
                    name: b.name || null,
                    className: b.className || null,
                    role: b.role || null,
                    deviceId: b.deviceId || null,
                    appVersion: b.appVersion || null,
                    ip: b.ip || null,
                    durationMs: b.durationMs || 0,
                    payload: b.payload || null,
                    anomalyFlag: Boolean(b.anomalyFlag)
                }
            }))
        );
    } catch (err) {
        console.error('Failed to flush ActivityEventLog batch:', err);
        // Jika gagal, kembalikan ke antrean depan (maks 200 items safeguard)
        if (logQueue.length < 200) {
            logQueue.unshift(...batch);
        }
    } finally {
        isFlushing = false;
        // Jika masih ada sisa di antrean, flush lagi segera
        if (logQueue.length > 0) {
            setTimeout(flushLogQueue, 500);
        }
    }
}

// Interval flush reguler setiap 2 detik
setInterval(flushLogQueue, 2000);

export function enqueueActivityLog(item: ActivityLogItem) {
    logQueue.push(item);
    if (logQueue.length >= 40) {
        setImmediate(flushLogQueue);
    }
}

export function logApkEvent(item: Omit<ActivityLogItem, 'source'>) {
    enqueueActivityLog({
        ...item,
        source: 'APK'
    });
}

// Sensor Sanitizer: Buang informasi sensitif
function sanitizePayload(obj: any): string {
    if (!obj || typeof obj !== 'object') return '';
    try {
        const clone = { ...obj };
        const sensitiveKeys = ['password', 'token', 'pin', 'secret', 'auth', 'jwt', 'refreshToken', 'pinKantin'];
        for (const k of Object.keys(clone)) {
            if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk.toLowerCase()))) {
                clone[k] = '[REDACTED]';
            }
        }
        const json = JSON.stringify(clone);
        return json.length > 2000 ? json.substring(0, 2000) + '...[TRUNCATED]' : json;
    } catch {
        return '';
    }
}

// Pemetaan endpoint ke modul & aksi
function matchEndpoint(path: string, method: string): { module: ActivityLogItem['module']; action: string } | null {
    const p = path.toLowerCase();

    // 1. PRESENSI
    if (p.includes('/attendance/scan-class-gate') || p.includes('/attendance/scan-gate') || p.includes('/attendance/scan')) {
        const isOut = p.includes('out') || p.includes('pulang');
        return { module: 'ATTENDANCE', action: isOut ? 'SCAN_GATE_OUT' : 'SCAN_GATE_IN' };
    }
    if (p.includes('/attendance/geofence') || p.includes('/attendance/checkin')) {
        return { module: 'ATTENDANCE', action: 'ATTENDANCE_GEOFENCE' };
    }
    if (p.includes('/attendance/mushola') || p.includes('/mushola')) {
        return { module: 'ATTENDANCE', action: 'ATTENDANCE_MUSHOLA' };
    }
    if (p.includes('/attendance/sync-offline') || p.includes('/attendance/bulk-sync')) {
        return { module: 'ATTENDANCE', action: 'ATTENDANCE_OFFLINE_SYNC' };
    }
    if (p.includes('/attendance/history') || p.includes('/attendance/student/history') || p.includes('/student/attendance-detail')) {
        return { module: 'ATTENDANCE', action: 'GET_ATTENDANCE_HISTORY' };
    }

    // 2. CBT
    if (p.includes('/cbt/verify-token')) return { module: 'CBT', action: 'VERIFY_TOKEN' };
    if (p.includes('/cbt/download-questions') || p.includes('/cbt/questions')) return { module: 'CBT', action: 'DOWNLOAD_QUESTIONS' };
    if (p.includes('/cbt/sync-exam') || p.includes('/cbt/save-answer') || p.includes('/cbt/autosave')) return { module: 'CBT', action: 'SYNC_EXAM_ANSWERS' };
    if (p.includes('/cbt/strike') || p.includes('/cbt/incident')) return { module: 'CBT', action: 'CBT_SECURITY_STRIKE' };
    if (p.includes('/cbt/submit') || p.includes('/cbt/finish') || p.includes('/cbt/student/submit')) return { module: 'CBT', action: 'SUBMIT_EXAM' };
    if (p.includes('/cbt/student/active-exams') || p.includes('/cbt/active-exams')) return { module: 'CBT', action: 'GET_ACTIVE_EXAMS' };
    if (p.includes('/cbt/proctor-tokens')) return { module: 'CBT', action: 'GET_PROCTOR_TOKENS' };
    if (p.includes('/cbt/proctor-class-students')) return { module: 'CBT', action: 'GET_PROCTOR_STUDENTS' };
    if (p.includes('/cbt/regenerate-token')) return { module: 'CBT', action: 'REGENERATE_TOKEN' };
    if (p.includes('/cbt/reset-class-token')) return { module: 'CBT', action: 'RESET_CLASS_TOKEN' };
    if (p.includes('/cbt/proctor/reset-student') || p.includes('/cbt/reset-student')) return { module: 'CBT', action: 'PROCTOR_RESET_STUDENT' };
    if (p.includes('/cbt/force-submit')) return { module: 'CBT', action: 'PROCTOR_FORCE_SUBMIT' };

    // 3. TUGAS / PR
    if ((p.includes('/homeworks/submit') || p.includes('/student/homeworks/submit'))) {
        return { module: 'HOMEWORK', action: 'SUBMIT_HOMEWORK' };
    }
    if (p.includes('/homeworks/grade') || p.includes('/homeworks/review')) {
        return { module: 'HOMEWORK', action: 'GRADE_HOMEWORK' };
    }
    if (p.includes('/homeworks') && method === 'GET') {
        return { module: 'HOMEWORK', action: 'LIST_HOMEWORKS' };
    }
    if (p.includes('/homeworks') && method === 'POST') {
        return { module: 'HOMEWORK', action: 'CREATE_HOMEWORK' };
    }

    // 4. EKSTRAKURIKULER
    if (p.includes('/extracurriculars/join') || p.includes('/extracurricular/join')) {
        return { module: 'EXTRACURRICULAR', action: 'JOIN_EXTRACURRICULAR' };
    }
    if (p.includes('/extracurriculars/cancel') || p.includes('/extracurricular/cancel')) {
        return { module: 'EXTRACURRICULAR', action: 'CANCEL_EXTRACURRICULAR' };
    }
    if (p.includes('/extracurriculars/attendance') || p.includes('/extracurricular/attendance')) {
        return { module: 'EXTRACURRICULAR', action: 'ATTENDANCE_EXTRACURRICULAR' };
    }
    if (p.includes('/extracurriculars') || p.includes('/extracurricular')) {
        return { module: 'EXTRACURRICULAR', action: method === 'GET' ? 'LIST_EXTRACURRICULARS' : 'UPDATE_EXTRACURRICULAR' };
    }

    // 5. E-KANTIN
    if (p.includes('/ekantin/topup') || p.includes('/kantin/topup')) return { module: 'EKANTIN', action: 'TOPUP_SALDO' };
    if (p.includes('/ekantin/pay') || p.includes('/ekantin/transaction') || p.includes('/kantin/pay')) return { module: 'EKANTIN', action: 'PAYMENT_TRANSACTION' };
    if (p.includes('/ekantin/balance') || p.includes('/kantin/balance')) return { module: 'EKANTIN', action: 'CHECK_BALANCE' };
    if (p.includes('/ekantin/refund') || p.includes('/kantin/refund')) return { module: 'EKANTIN', action: 'REFUND_TRANSACTION' };

    // 6. AUTH / LOGIN
    if (p.includes('/auth/login')) return { module: 'AUTH', action: 'USER_LOGIN' };
    if (p.includes('/auth/refresh')) return { module: 'AUTH', action: 'REFRESH_TOKEN' };
    if (p.includes('/auth/device-binding') || p.includes('/auth/bind-device')) return { module: 'AUTH', action: 'DEVICE_BINDING' };
    if (p.includes('/auth/logout')) return { module: 'AUTH', action: 'USER_LOGOUT' };

    // 7. CLIENT LOGS DARI APK
    if (p.includes('/app/client-logs')) return { module: 'APP_CLIENT', action: 'CLIENT_LOG_REPORT' };

    return null;
}

export function activityLogger(req: Request, res: Response, next: NextFunction) {
    const matched = matchEndpoint(req.path || req.originalUrl, req.method);
    if (!matched) {
        return next();
    }

    const startTime = Date.now();
    const originalJson = res.json;
    const originalSend = res.send;

    let responseCaptured = false;
    let responseBody: any = null;

    // Intercept res.json
    res.json = function (body: any) {
        responseBody = body;
        return originalJson.apply(this, arguments as any);
    };

    // Intercept res.send
    res.send = function (body: any) {
        if (!responseCaptured) {
            try {
                responseBody = typeof body === 'string' ? JSON.parse(body) : body;
            } catch {
                responseBody = body;
            }
        }
        return originalSend.apply(this, arguments as any);
    };

    res.on('finish', () => {
        responseCaptured = true;
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode;

        // Tentukan Outcome
        let outcome: ActivityLogItem['outcome'] = 'SUCCESS';
        let isAnomaly = false;

        if (statusCode >= 500) {
            outcome = 'ERROR';
            isAnomaly = true;
        } else if (statusCode >= 400) {
            outcome = 'REJECTED';
            // Jika ada indikasi scan pulang ditolak atau error kritis
            if (matched.module === 'ATTENDANCE' || matched.module === 'CBT' || matched.module === 'EKANTIN') {
                isAnomaly = true;
            }
        } else if (responseBody && responseBody.success === false) {
            outcome = 'REJECTED';
            isAnomaly = true;
        }

        // Ambil pesan/alasan dari responseBody
        let message = '';
        if (responseBody) {
            if (typeof responseBody === 'string') {
                message = responseBody;
            } else {
                message = responseBody.message || responseBody.error || responseBody.msg || '';
            }
        }

        // Identitas User (dari req.user, body, atau decode header Authorization)
        let user = (req as any).user;
        if (!user) {
            const authHeader = req.headers['authorization'];
            if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
                try {
                    const decoded = jwt.decode(authHeader.substring(7)) as any;
                    if (decoded && typeof decoded === 'object') {
                        user = decoded;
                    }
                } catch {}
            }
        }

        const userId = user?.id || user?.userId || req.body?.userId || req.body?.studentId || null;
        const username = user?.username || req.body?.username || req.body?.studentIdentifier || req.body?.nisn || null;
        const name = user?.name || req.body?.name || req.body?.studentName || null;
        const className = user?.className || req.body?.className || null;
        const role = user?.role || req.body?.role || null;

        const deviceId = (req.headers['x-device-id'] as string) || req.body?.deviceId || req.body?.deviceAndroidId || null;
        const appVersion = (req.headers['x-app-version'] as string) || req.body?.appVersion || null;
        const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;

        // Ambil payload request tanpa password/pin
        const sanitizedReqBody = sanitizePayload(req.body);

        // Jika aksi presensi, periksa detail aksi dari body
        let action = matched.action;
        if (matched.module === 'ATTENDANCE' && req.body?.type) {
            action = req.body.type === 'GATE_OUT' ? 'SCAN_GATE_OUT' : 'SCAN_GATE_IN';
        }

        const logItem: ActivityLogItem = {
            source: 'SERVER',
            module: matched.module,
            action,
            outcome,
            httpStatus: statusCode,
            message,
            userId,
            username,
            name,
            className,
            role,
            deviceId,
            appVersion,
            ip: typeof ip === 'string' ? ip.split(',')[0].trim() : ip,
            durationMs,
            payload: sanitizedReqBody,
            anomalyFlag: isAnomaly
        };

        // Enqueue log
        enqueueActivityLog(logItem);

        // Jika kasus kritis/anomali, trigger pengecekan anomali langsung (non-blocking)
        if (isAnomaly || outcome === 'REJECTED' || outcome === 'ERROR') {
            setImmediate(() => {
                triggerRealtimeAnomalyCheck(logItem).catch(() => {});
            });
        }
    });

    next();
}
