import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import path from 'path';
import fs from 'fs';
import prisma from '../utils/db';

let fcmInitialized = false;

export function initFirebaseAdmin(): boolean {
    if (fcmInitialized) return true;

    try {
        const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json');
        if (!fs.existsSync(serviceAccountPath)) {
            console.warn('[FCM] firebase-service-account.json not found at:', serviceAccountPath);
            return false;
        }

        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

        if (!getApps().length) {
            initializeApp({
                credential: cert(serviceAccount)
            });
        }

        fcmInitialized = true;
        console.log('[FCM] Firebase Admin SDK successfully initialized for project:', serviceAccount.project_id);

        // Ensure UserFcmToken table exists
        prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "UserFcmToken" (
                "id" TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "token" TEXT NOT NULL UNIQUE,
                "deviceAndroidId" TEXT,
                "role" TEXT,
                "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `).catch((err: any) => console.warn('[FCM] Table ensure non-fatal:', err.message));

        return true;
    } catch (error: any) {
        console.error('[FCM] Failed to initialize Firebase Admin SDK:', error.message);
        return false;
    }
}

// Save or update user FCM token
export async function saveUserFcmToken(userId: string, token: string, deviceAndroidId?: string, role?: string): Promise<boolean> {
    try {
        initFirebaseAdmin();
        const id = 'fcm_' + Math.random().toString(36).substring(2, 10);
        await prisma.$executeRawUnsafe(`
            INSERT INTO "UserFcmToken" ("id", "userId", "token", "deviceAndroidId", "role", "updatedAt")
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT("token") DO UPDATE SET
                "userId" = excluded."userId",
                "deviceAndroidId" = excluded."deviceAndroidId",
                "role" = excluded."role",
                "updatedAt" = CURRENT_TIMESTAMP;
        `, id, userId, token, deviceAndroidId || null, role || null);
        return true;
    } catch (e: any) {
        console.warn('[FCM] saveUserFcmToken error:', e.message);
        return false;
    }
}

// Send push notification to a specific user
export async function sendFcmToUser(userId: string, title: string, body: string, dataPayload: Record<string, string> = {}): Promise<number> {
    if (!initFirebaseAdmin()) return 0;

    try {
        // Mute notifikasi ke BK & Wali Kelas sesuai instruksi pengguna
        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, tugasTambahan: true }
        });
        const uRole = (targetUser?.role || '').toUpperCase();
        const uTugas = (targetUser?.tugasTambahan || '').toUpperCase();
        if (uRole === 'COUNSELOR' || uRole === 'BK' || uTugas.includes('BK') || uTugas.includes('WALI')) {
            return 0;
        }

        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT "token" FROM "UserFcmToken" WHERE "userId" = ?`,
            userId
        );

        if (!rows || rows.length === 0) return 0;
        const tokens = rows.map((r: any) => r.token).filter(Boolean);
        return await sendFcmToTokens(tokens, title, body, dataPayload);
    } catch (err: any) {
        console.warn('[FCM] sendFcmToUser error:', err.message);
        return 0;
    }
}

// Send push notification to a role (e.g. 'BK', 'PARENT', 'STUDENT', 'TEACHER')
export async function sendFcmToRole(role: string, title: string, body: string, dataPayload: Record<string, string> = {}): Promise<number> {
    // Sesuai instruksi: Notifikasi ke BK dan Wali Kelas dinonaktifkan total
    const roleUpper = (role || '').toUpperCase();
    if (roleUpper === 'BK' || roleUpper === 'COUNSELOR' || roleUpper === 'WALI_KELAS' || roleUpper === 'WALI' || roleUpper === 'HOMEROOM') {
        return 0;
    }

    if (!initFirebaseAdmin()) return 0;

    try {
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT "token" FROM "UserFcmToken" WHERE "role" = ?`,
            role
        );

        if (!rows || rows.length === 0) return 0;
        const tokens = rows.map((r: any) => r.token).filter(Boolean);
        return await sendFcmToTokens(tokens, title, body, dataPayload);
    } catch (err: any) {
        console.warn('[FCM] sendFcmToRole error:', err.message);
        return 0;
    }
}

// Send push notification to raw tokens
export async function sendFcmToTokens(tokens: string[], title: string, body: string, dataPayload: Record<string, string> = {}): Promise<number> {
    if (!initFirebaseAdmin() || !tokens.length) return 0;

    const uniqueTokens = Array.from(new Set(tokens));
    let successCount = 0;

    const message: any = {
        tokens: uniqueTokens,
        notification: {
            title: title,
            body: body
        },
        android: {
            priority: 'high',
            notification: {
                sound: 'default',
                priority: 'high',
                channelId: 'smartcbt_urgent_alerts'
            }
        },
        data: {
            ...dataPayload,
            timestamp: new Date().toISOString()
        }
    };

    try {
        const messaging = getMessaging();
        const response = await messaging.sendEachForMulticast(message);
        successCount = response.successCount;

        // Clean up invalid tokens
        if (response.failureCount > 0) {
            const badTokens: string[] = [];
            response.responses.forEach((resp: any, idx: number) => {
                if (!resp.success) {
                    const errCode = resp.error?.code;
                    if (errCode === 'messaging/invalid-registration-token' ||
                        errCode === 'messaging/registration-token-not-registered') {
                        badTokens.push(uniqueTokens[idx]);
                    }
                }
            });

            if (badTokens.length > 0) {
                const placeholders = badTokens.map(() => '?').join(',');
                await prisma.$executeRawUnsafe(
                    `DELETE FROM "UserFcmToken" WHERE "token" IN (${placeholders})`,
                    ...badTokens
                ).catch(() => {});
            }
        }
    } catch (err: any) {
        console.error('[FCM] sendEachForMulticast error:', err.message);
    }

    return successCount;
}
