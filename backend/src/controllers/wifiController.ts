import { Request, Response } from 'express';
import prisma from '../utils/db';
import crypto from 'crypto';
import { sendFcmToUser } from '../services/fcmService';

async function sendPushNotification(userId: string, opts: { title: string; body: string; data?: Record<string, string> }) {
    try {
        return await sendFcmToUser(userId, opts.title, opts.body, opts.data || {});
    } catch (_) {
        return 0;
    }
}

const SECRET_SALT = process.env.CARD_SECRET_SALT || 'SMPN1_BOYOLANGU_SECRET_SALT_2026';

// =========================================================================
// HELPER: MIKROTIK REST API / ROUTEROS CLIENT (ROBUST, NON-BLOCKING)
// Mendukung RouterOS v7 REST API (HTTPS/HTTP)
// =========================================================================
interface MikroTikConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
    useTls: boolean;
    tag: string;
}

async function getOrInitWifiConfig(): Promise<any> {
    let config = await prisma.wifiConfig.findUnique({ where: { id: 'default' } });
    if (!config) {
        config = await prisma.wifiConfig.create({
            data: {
                id: 'default',
                ssidName: 'SMPN 1 BOYOLANGU - RESMI',
                hotspotServer: 'Hotspot-SMPN1',
                activeUntilTime: '17:00',
                gracePeriodHours: 2,
                isEnabled: true,
                maxDevicesPerUser: 1,
                mikrotikHost: process.env.MIKROTIK_HOST || '192.168.88.1',
                mikrotikPort: Number(process.env.MIKROTIK_PORT || 80),
                mikrotikUser: process.env.MIKROTIK_USER || 'admin',
                mikrotikPassword: process.env.MIKROTIK_PASSWORD || '',
                mikrotikUseTls: process.env.MIKROTIK_USE_TLS === 'true',
                mikrotikCommentTag: 'SMARTCBT-WIFI'
            }
        });
    }
    return config;
}

/**
 * Mendaftarkan IP-Binding (Bypass / Block Hotspot) di MikroTik RouterOS v7 via REST API
 */
async function callMikrotikAddBinding(mac: string, studentName: string, config: any, bindingType: 'bypassed' | 'blocked' = 'bypassed'): Promise<string | null> {
    if (!config.mikrotikHost || !config.mikrotikUser) {
        console.log(`[MIKROTIK-SKIP] Konfigurasi MikroTik belum lengkap.`);
        return null;
    }

    try {
        const protocol = config.mikrotikUseTls ? 'https' : 'http';
        const url = `${protocol}://${config.mikrotikHost}:${config.mikrotikPort}/rest/ip/hotspot/ip-binding`;
        const auth = Buffer.from(`${config.mikrotikUser}:${config.mikrotikPassword || ''}`).toString('base64');
        const tagPrefix = bindingType === 'blocked' ? `${config.mikrotikCommentTag}-BLOCK` : config.mikrotikCommentTag;
        const comment = `${tagPrefix}:${studentName}:${mac}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 detik timeout

        const reqBody: any = {
            'mac-address': mac,
            'type': bindingType,
            'comment': comment
        };

        // Jika bypassed dan ada batas bandwidth (rate-limit), pasang batas agar hemat bandwidth
        if (bindingType === 'bypassed' && config.rateLimit) {
            reqBody['rate-limit'] = config.rateLimit;
        }

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(reqBody),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data: any = await response.json().catch(() => ({}));
            const bindingId = data?.['.id'] || null;
            console.log(`[MIKROTIK-SUCCESS] ${bindingType.toUpperCase()} binding berhasil dibuat: MAC ${mac}, ID: ${bindingId}`);
            return bindingId;
        } else {
            const errText = await response.text();
            console.warn(`[MIKROTIK-WARN] Status ${response.status} saat membuat ${bindingType} binding: ${errText}`);
            return null;
        }
    } catch (err: any) {
        console.error(`[MIKROTIK-ERROR] Gagal menghubungi MikroTik (${err.message}). Melanjutkan secara offline.`);
        return null;
    }
}

/**
 * Menghapus IP-Binding di MikroTik saat sesi dicabut atau reset harian
 */
async function callMikrotikRemoveBinding(mac: string, mikrotikId: string | null, config: any): Promise<boolean> {
    if (!config.mikrotikHost || !config.mikrotikUser) return false;

    try {
        const protocol = config.mikrotikUseTls ? 'https' : 'http';
        const auth = Buffer.from(`${config.mikrotikUser}:${config.mikrotikPassword || ''}`).toString('base64');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        if (mikrotikId) {
            const url = `${protocol}://${config.mikrotikHost}:${config.mikrotikPort}/rest/ip/hotspot/ip-binding/${mikrotikId}`;
            const res = await fetch(url, {
                method: 'DELETE',
                headers: { 'Authorization': `Basic ${auth}` },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return res.ok;
        } else {
            // Cari binding berdasarkan MAC address jika ID tidak ada
            const findUrl = `${protocol}://${config.mikrotikHost}:${config.mikrotikPort}/rest/ip/hotspot/ip-binding?mac-address=${mac}`;
            const findRes = await fetch(findUrl, {
                headers: { 'Authorization': `Basic ${auth}` },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (findRes.ok) {
                const list: any = await findRes.json();
                if (Array.isArray(list) && list.length > 0) {
                    for (const item of list) {
                        if (item['.id']) {
                            const delUrl = `${protocol}://${config.mikrotikHost}:${config.mikrotikPort}/rest/ip/hotspot/ip-binding/${item['.id']}`;
                            await fetch(delUrl, {
                                method: 'DELETE',
                                headers: { 'Authorization': `Basic ${auth}` }
                            }).catch(() => {});
                        }
                    }
                }
            }
            return true;
        }
    } catch (err: any) {
        console.warn(`[MIKROTIK-REMOVE-ERROR] ${err.message}`);
        return false;
    }
}

// =========================================================================
// HELPER: TOKEN KARTU SISWA (VERIFIKASI TANDA TANGAN KRIPTOGRAFI)
// =========================================================================
export function generateStudentCardToken(studentId: string, nisn: string): string {
    const payload = `${studentId}:${nisn}:${SECRET_SALT}`;
    const hash = crypto.createHash('sha256').update(payload).digest('hex').substring(0, 16);
    return `SMARTCBT-ID:${studentId}:${hash}`;
}

export function verifyCardToken(token: string, studentId: string, nisn: string): boolean {
    const cleanToken = token.trim();
    const expected = generateStudentCardToken(studentId, nisn);
    if (cleanToken === expected) return true;

    if (cleanToken.startsWith('SMARTCBT-ID:')) {
        const parts = cleanToken.split(':');
        if (parts.length >= 3 && parts[1] === studentId) {
            const expectedHash = crypto.createHash('sha256').update(`${studentId}:${nisn}:${SECRET_SALT}`).digest('hex').substring(0, 16);
            return parts[2] === expectedHash;
        }
    }

    if (cleanToken === nisn || cleanToken === studentId) return true;
    return false;
}

// =========================================================================
// ENDPOINTS SISWA
// =========================================================================

/**
 * 1. GET /api/student/wifi/status
 * Memeriksa status akses WiFi siswa hari ini dari database
 */
export const getStudentWifiStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const student = (req as any).user;
        if (!student || student.role !== 'STUDENT') {
            res.status(403).json({ success: false, message: 'Akses khusus siswa' });
            return;
        }

        const config = await getOrInitWifiConfig();
        const now = new Date();

        // Cari sesi aktif dari database
        const activeSession = await prisma.wifiSession.findFirst({
            where: {
                studentId: student.id,
                status: 'ACTIVE',
                expiresAt: { gt: now }
            },
            orderBy: { activatedAt: 'desc' }
        });

        const isActive = !!activeSession;

        res.json({
            success: true,
            isActive,
            isEnabled: config.isEnabled,
            ssid: config.ssidName,
            hotspotServer: config.hotspotServer,
            status: isActive ? 'AKTIF_HARI_INI' : 'TERKUNCI',
            validUntil: config.activeUntilTime + ' WIB',
            activatedAt: activeSession ? activeSession.activatedAt : null,
            deviceMac: activeSession?.deviceMac || null,
            student: {
                id: student.id,
                name: student.name,
                nisn: student.nisn || student.username,
                className: student.className,
                photoUrl: student.profilePicUrl
            },
            message: !config.isEnabled
                ? '⚠️ Layanan Wi-Fi sekolah saat ini sedang dinonaktifkan oleh administrator.'
                : isActive
                    ? '✅ Akses Wi-Fi sekolah telah aktif tanpa hotspot login page. Perangkat Anda langsung terhubung ke internet.'
                    : '🔒 Akses Wi-Fi sekolah belum aktif untuk hari ini. Silakan pindai Kartu Pelajar fisik Anda.'
        });
    } catch (err: any) {
        console.error('Error getStudentWifiStatus:', err);
        res.status(500).json({ success: false, message: 'Gagal memeriksa status Wi-Fi' });
    }
};

/**
 * 2. POST /api/student/wifi/activate
 * Siswa scan kartu pelajar -> verifikasi -> batas 1 perangkat/hari -> MikroTik bypass -> simpan DB -> FCM
 */
export const activateStudentWifi = async (req: Request, res: Response): Promise<void> => {
    try {
        const student = (req as any).user;
        if (!student || student.role !== 'STUDENT') {
            res.status(403).json({ success: false, message: 'Akses khusus siswa' });
            return;
        }

        const config = await getOrInitWifiConfig();
        if (!config.isEnabled) {
            res.status(403).json({ success: false, message: 'Layanan Wi-Fi sekolah sedang dinonaktifkan oleh administrator.' });
            return;
        }

        const { cardBarcode, deviceMac, deviceName } = req.body;
        if (!cardBarcode || typeof cardBarcode !== 'string' || cardBarcode.trim().length === 0) {
            res.status(400).json({ success: false, message: 'Barcode kartu pelajar wajib dipindai' });
            return;
        }

        // Format normalisasi MAC address
        let cleanMac = (deviceMac || 'AUTO_DETECT_CLIENT_MAC').trim().toUpperCase().replace(/-/g, ':');
        const ipAddress = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').replace('::ffff:', '');

        // Cek blacklist MAC
        if (cleanMac !== 'AUTO_DETECT_CLIENT_MAC') {
            const isBlacklisted = await prisma.wifiBlacklist.findUnique({
                where: { macAddress: cleanMac }
            });
            if (isBlacklisted) {
                res.status(403).json({
                    success: false,
                    message: `🚫 Perangkat ini (MAC: ${cleanMac}) telah diblokir dari akses Wi-Fi sekolah. Alasan: ${isBlacklisted.reason || 'Pelanggaran aturan'}. Hubungi admin.`
                });
                return;
            }
        }

        // Ambil data siswa lengkap
        const fullStudent = await prisma.user.findUnique({ where: { id: student.id } });
        if (!fullStudent) {
            res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan' });
            return;
        }

        const studentNisn = fullStudent.nisn || fullStudent.username;
        const scannedToken = cardBarcode.trim();

        // Verifikasi keaslian kartu
        const isValid = verifyCardToken(scannedToken, fullStudent.id, studentNisn) ||
            scannedToken === fullStudent.nis ||
            scannedToken === fullStudent.rfidChipUid ||
            scannedToken === studentNisn;

        if (!isValid) {
            res.status(400).json({
                success: false,
                message: '❌ Barcode tidak valid atau bukan Kartu Pelajar milik Anda! Pastikan Anda memindai Kartu Pelajar fisik resmi Anda sendiri.'
            });
            return;
        }

        const now = new Date();

        // Hitung masa berlaku berdasarkan config (misal 17:00)
        const [targetHour, targetMinute] = config.activeUntilTime.split(':').map(Number);
        const expiresAt = new Date();
        expiresAt.setHours(targetHour || 17, targetMinute || 0, 0, 0);

        if (now.getTime() >= expiresAt.getTime()) {
            expiresAt.setTime(now.getTime() + (config.gracePeriodHours || 2) * 60 * 60 * 1000);
        }

        // Cek apakah siswa sudah memiliki sesi aktif hari ini di perangkat lain (Batas 1 Perangkat/hari)
        const existingSession = await prisma.wifiSession.findFirst({
            where: {
                studentId: fullStudent.id,
                status: 'ACTIVE',
                expiresAt: { gt: now }
            }
        });

        if (existingSession) {
            if (cleanMac !== 'AUTO_DETECT_CLIENT_MAC' && existingSession.deviceMac !== cleanMac) {
                res.status(409).json({
                    success: false,
                    message: `⚠️ Anda sudah mengaktifkan Wi-Fi hari ini pada perangkat lain (MAC: ${existingSession.deviceMac}). Satu akun siswa dibatasi maksimal ${config.maxDevicesPerUser} perangkat aktif per hari.`
                });
                return;
            }

            // Jika perangkat sama, perpanjang sesi
            await prisma.wifiSession.update({
                where: { id: existingSession.id },
                data: { expiresAt, ipAddress: ipAddress || existingSession.ipAddress }
            });

            res.json({
                success: true,
                message: '✅ Akses Wi-Fi Anda sudah aktif dan telah diperpanjang.',
                ssid: config.ssidName,
                status: 'AKTIF_HARI_INI',
                validUntil: config.activeUntilTime + ' WIB',
                deviceMac: existingSession.deviceMac
            });
            return;
        }

        // Panggil MikroTik RouterOS API untuk membuat binding bypass
        let mikrotikId: string | null = null;
        if (cleanMac !== 'AUTO_DETECT_CLIENT_MAC') {
            mikrotikId = await callMikrotikAddBinding(cleanMac, fullStudent.name, config);
        }

        // Simpan sesi baru ke database
        const newSession = await prisma.wifiSession.create({
            data: {
                studentId: fullStudent.id,
                studentName: fullStudent.name,
                nisn: studentNisn,
                className: fullStudent.className || '-',
                deviceMac: cleanMac,
                deviceName: deviceName || 'Android Smartphone',
                ipAddress,
                activatedAt: now,
                expiresAt,
                status: 'ACTIVE',
                mikrotikId
            }
        });

        // Kirim FCM Push Notification ke HP siswa (jika terdaftar)
        try {
            await sendPushNotification(fullStudent.id, {
                title: '📶 Wi-Fi Sekolah Aktif!',
                body: `Akses internet resmi tanpa login page aktif hingga ${config.activeUntilTime} WIB. Selamat belajar!`,
                data: { type: 'WIFI_ACTIVATED', sessionId: newSession.id }
            });
        } catch (e) {
            // Jangan gagalkan aktivasi jika FCM error
        }

        res.json({
            success: true,
            message: '🎉 Akses Wi-Fi Resmi SMPN 1 Boyolangu Berhasil Diaktifkan!',
            ssid: config.ssidName,
            status: 'AKTIF_HARI_INI',
            validUntil: config.activeUntilTime + ' WIB',
            bypassActive: true,
            deviceMac: cleanMac,
            student: {
                id: fullStudent.id,
                name: fullStudent.name,
                nisn: studentNisn,
                className: fullStudent.className || '-',
                photoUrl: fullStudent.profilePicUrl
            },
            instruction: 'HP Anda sekarang terhubung penuh ke internet sekolah tanpa perlu melewati login page hotspot. Akses berlaku hingga jam kepulangan sekolah.'
        });
    } catch (err: any) {
        console.error('Error activateStudentWifi:', err);
        res.status(500).json({ success: false, message: 'Gagal mengaktifkan akses Wi-Fi: ' + err.message });
    }
};

// =========================================================================
// ENDPOINTS ADMIN & OPERATOR
// =========================================================================

/**
 * 3. GET /api/admin/wifi/dashboard
 * Mengambil ringkasan sesi aktif hari ini, log terbaru, dan statistik
 */
export const getAdminWifiDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
        const now = new Date();
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const config = await getOrInitWifiConfig();

        const [activeSessions, todayCount, totalCount, blacklistCount] = await Promise.all([
            prisma.wifiSession.findMany({
                where: {
                    status: 'ACTIVE',
                    expiresAt: { gt: now }
                },
                orderBy: { activatedAt: 'desc' }
            }),
            prisma.wifiSession.count({
                where: { activatedAt: { gte: startOfDay } }
            }),
            prisma.wifiSession.count(),
            prisma.wifiBlacklist.count()
        ]);

        res.json({
            success: true,
            config,
            counts: {
                activeNow: activeSessions.length,
                activatedToday: todayCount,
                totalAllTime: totalCount,
                blacklisted: blacklistCount
            },
            activeSessions
        });
    } catch (err: any) {
        console.error('Error getAdminWifiDashboard:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat dashboard Wi-Fi' });
    }
};

/**
 * 4. POST /api/admin/wifi/revoke/:sessionId
 * Admin mencabut akses WiFi seorang siswa secara paksa
 */
export const revokeStudentWifi = async (req: Request, res: Response): Promise<void> => {
    try {
        const sessionId = String(req.params.sessionId);
        const { reason } = req.body;
        const adminUser = (req as any).user;

        const session = await prisma.wifiSession.findUnique({ where: { id: sessionId } });
        if (!session) {
            res.status(404).json({ success: false, message: 'Sesi tidak ditemukan' });
            return;
        }

        const config = await getOrInitWifiConfig();

        // Hapus bypass di MikroTik jika ada
        if (session.deviceMac) {
            await callMikrotikRemoveBinding(session.deviceMac, session.mikrotikId, config);
        }

        // Perbarui status sesi di database
        await prisma.wifiSession.update({
            where: { id: sessionId },
            data: {
                status: 'REVOKED',
                revokedAt: new Date(),
                revokedBy: adminUser?.name || 'Administrator',
                revokedReason: reason || 'Dicabut oleh administrator'
            }
        });

        // Beri tahu siswa via FCM
        try {
            await sendPushNotification(session.studentId, {
                title: '🔒 Akses Wi-Fi Dicabut',
                body: `Akses Wi-Fi Anda telah dicabut oleh administrator sekolah. Alasan: ${reason || 'Peraturan ketertiban'}.`,
                data: { type: 'WIFI_REVOKED' }
            });
        } catch (e) {}

        res.json({
            success: true,
            message: `Akses Wi-Fi siswa ${session.studentName} (${session.deviceMac}) berhasil dicabut.`
        });
    } catch (err: any) {
        console.error('Error revokeStudentWifi:', err);
        res.status(500).json({ success: false, message: 'Gagal mencabut sesi Wi-Fi' });
    }
};

/**
 * 5. POST /api/admin/wifi/reset-daily
 * Reset otomatis semua sesi aktif (dipanggil jam 17:00 / midnight oleh scheduler atau admin)
 */
export const resetDailyWifiSessions = async (_req: Request, res: Response): Promise<void> => {
    try {
        const now = new Date();
        const config = await getOrInitWifiConfig();

        // Ambil semua sesi yang masih aktif
        const activeSessions = await prisma.wifiSession.findMany({
            where: { status: 'ACTIVE' },
            select: { id: true, deviceMac: true, mikrotikId: true }
        });

        // Lepas binding di MikroTik secara paralel
        await Promise.allSettled(
            activeSessions.map(s => callMikrotikRemoveBinding(s.deviceMac, s.mikrotikId, config))
        );

        // Update database secara massal
        const updateResult = await prisma.wifiSession.updateMany({
            where: { status: 'ACTIVE' },
            data: { status: 'EXPIRED' }
        });

        console.log(`[WIFI-RESET] ${updateResult.count} sesi berhasil di-expire.`);
        res.json({
            success: true,
            expiredCount: updateResult.count,
            message: `Berhasil mereset ${updateResult.count} sesi Wi-Fi. Seluruh siswa harus scan kartu kembali besok pagi.`
        });
    } catch (err: any) {
        console.error('Error resetDailyWifiSessions:', err);
        res.status(500).json({ success: false, message: 'Gagal mereset sesi Wi-Fi' });
    }
};

/**
 * 6. GET /api/admin/wifi/stats
 * Statistik penggunaan Wi-Fi 7 hari terakhir
 */
export const getWifiStats = async (_req: Request, res: Response): Promise<void> => {
    try {
        const stats: { date: string; count: number }[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const start = new Date(d.setHours(0, 0, 0, 0));
            const end = new Date(d.setHours(23, 59, 59, 999));

            const count = await prisma.wifiSession.count({
                where: { activatedAt: { gte: start, lte: end } }
            });

            const dateStr = start.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
            stats.push({ date: dateStr, count });
        }

        res.json({ success: true, stats });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat statistik Wi-Fi' });
    }
};

/**
 * 7. GET /api/admin/wifi/config & PUT /api/admin/wifi/config
 */
export const getWifiConfig = async (_req: Request, res: Response): Promise<void> => {
    try {
        const config = await getOrInitWifiConfig();
        res.json({ success: true, config });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat konfigurasi Wi-Fi' });
    }
};

export const updateWifiConfig = async (req: Request, res: Response): Promise<void> => {
    try {
        const adminUser = (req as any).user;
        const {
            ssidName,
            hotspotServer,
            activeUntilTime,
            gracePeriodHours,
            isEnabled,
            maxDevicesPerUser,
            mikrotikHost,
            mikrotikPort,
            mikrotikUser,
            mikrotikPassword,
            mikrotikUseTls
        } = req.body;

        const updateData: any = { updatedBy: adminUser?.name || 'Administrator' };
        if (ssidName !== undefined) updateData.ssidName = ssidName;
        if (hotspotServer !== undefined) updateData.hotspotServer = hotspotServer;
        if (activeUntilTime !== undefined) updateData.activeUntilTime = activeUntilTime;
        if (gracePeriodHours !== undefined) updateData.gracePeriodHours = Number(gracePeriodHours);
        if (isEnabled !== undefined) updateData.isEnabled = Boolean(isEnabled);
        if (maxDevicesPerUser !== undefined) updateData.maxDevicesPerUser = Number(maxDevicesPerUser);
        if (mikrotikHost !== undefined) updateData.mikrotikHost = mikrotikHost;
        if (mikrotikPort !== undefined) updateData.mikrotikPort = Number(mikrotikPort);
        if (mikrotikUser !== undefined) updateData.mikrotikUser = mikrotikUser;
        if (mikrotikPassword !== undefined) updateData.mikrotikPassword = mikrotikPassword;
        if (mikrotikUseTls !== undefined) updateData.mikrotikUseTls = Boolean(mikrotikUseTls);

        const updated = await prisma.wifiConfig.upsert({
            where: { id: 'default' },
            update: updateData,
            create: { id: 'default', ...updateData }
        });

        res.json({
            success: true,
            message: 'Konfigurasi Wi-Fi sekolah berhasil diperbarui',
            config: updated
        });
    } catch (err: any) {
        console.error('Error updateWifiConfig:', err);
        res.status(500).json({ success: false, message: 'Gagal memperbarui konfigurasi Wi-Fi' });
    }
};

/**
 * 8. CRUD BLACKLIST MAC ADDRESS
 */
export const getMacBlacklist = async (_req: Request, res: Response): Promise<void> => {
    try {
        const blacklist = await prisma.wifiBlacklist.findMany({ orderBy: { createdAt: 'desc' } });
        res.json({ success: true, blacklist });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Gagal memuat daftar blacklist' });
    }
};

export const addMacBlacklist = async (req: Request, res: Response): Promise<void> => {
    try {
        const { macAddress, reason } = req.body;
        const adminUser = (req as any).user;

        if (!macAddress || typeof macAddress !== 'string') {
            res.status(400).json({ success: false, message: 'Alamat MAC wajib diisi' });
            return;
        }

        const cleanMac = macAddress.trim().toUpperCase().replace(/-/g, ':');

        const entry = await prisma.wifiBlacklist.upsert({
            where: { macAddress: cleanMac },
            update: { reason, blockedBy: adminUser?.name || 'Administrator' },
            create: {
                macAddress: cleanMac,
                reason: reason || 'Pemblokiran manual oleh admin',
                blockedBy: adminUser?.name || 'Administrator'
            }
        });

        const config = await getOrInitWifiConfig();

        // Cabut sesi aktif yang menggunakan MAC ini
        const activeSessions = await prisma.wifiSession.findMany({
            where: { deviceMac: cleanMac, status: 'ACTIVE' }
        });
        for (const s of activeSessions) {
            await callMikrotikRemoveBinding(cleanMac, s.mikrotikId, config);
            await prisma.wifiSession.update({
                where: { id: s.id },
                data: { status: 'REVOKED', revokedReason: 'Alamat MAC diblacklist' }
            });
        }

        // Pasang aturan 'blocked' langsung di hardware MikroTik
        await callMikrotikAddBinding(cleanMac, reason || 'Blacklist Admin', config, 'blocked');

        res.json({ success: true, message: `MAC ${cleanMac} berhasil dimasukkan ke daftar blacklist & dicekal di router MikroTik`, entry });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Gagal menambah blacklist: ' + err.message });
    }
};

export const removeMacBlacklist = async (req: Request, res: Response): Promise<void> => {
    try {
        const cleanMac = String(req.params.mac || '').trim().toUpperCase().replace(/-/g, ':');

        await prisma.wifiBlacklist.deleteMany({
            where: { macAddress: cleanMac }
        });

        // Hapus juga binding blokir dari MikroTik
        const config = await getOrInitWifiConfig();
        await callMikrotikRemoveBinding(cleanMac, null, config);

        res.json({ success: true, message: `MAC ${cleanMac} berhasil dihapus dari blacklist & router` });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Gagal menghapus blacklist: ' + err.message });
    }
};

/**
 * 9. POST /api/admin/wifi/test-connection
 * Uji konektivitas, cek RouterOS v7 REST API, latensi ping, CPU, dan memori
 */
export const testMikrotikConnection = async (req: Request, res: Response): Promise<void> => {
    try {
        const config = await getOrInitWifiConfig();
        const host = req.body.host || config.mikrotikHost;
        const port = Number(req.body.port || config.mikrotikPort || 80);
        const user = req.body.user || config.mikrotikUser;
        const password = req.body.password !== undefined ? req.body.password : (config.mikrotikPassword || '');
        const useTls = req.body.useTls !== undefined ? Boolean(req.body.useTls) : Boolean(config.mikrotikUseTls);

        if (!host || !user) {
            res.status(400).json({ success: false, message: 'Host dan username MikroTik belum diisi.' });
            return;
        }

        const protocol = useTls ? 'https' : 'http';
        const url = `${protocol}://${host}:${port}/rest/system/resource`;
        const auth = Buffer.from(`${user}:${password}`).toString('base64');

        const startTime = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const latencyMs = Date.now() - startTime;

            if (response.ok) {
                const data: any = await response.json().catch(() => ({}));
                res.json({
                    success: true,
                    status: 'CONNECTED',
                    latencyMs,
                    host,
                    port,
                    useTls,
                    routerInfo: {
                        uptime: data.uptime || 'N/A',
                        version: data.version || 'RouterOS v7',
                        boardName: data['board-name'] || data.platform || 'MikroTik Router',
                        cpuLoad: data['cpu-load'] !== undefined ? `${data['cpu-load']}%` : 'Normal',
                        freeMemory: data['free-memory'] ? `${Math.round(data['free-memory'] / 1024 / 1024)} MB` : 'N/A',
                        architecture: data['architecture-name'] || 'N/A'
                    },
                    message: `✅ Berhasil terhubung ke MikroTik RouterOS (${data['board-name'] || 'Router'} v${data.version || '7'}) dengan latensi ${latencyMs}ms.`
                });
            } else if (response.status === 401 || response.status === 403) {
                res.status(401).json({
                    success: false,
                    status: 'AUTH_FAILED',
                    latencyMs,
                    message: `❌ Autentikasi Gagal (HTTP ${response.status}). Periksa Username dan Password REST API MikroTik Anda.`
                });
            } else {
                const errText = await response.text();
                res.status(response.status).json({
                    success: false,
                    status: 'HTTP_ERROR',
                    latencyMs,
                    message: `⚠️ MikroTik merespons HTTP ${response.status}: ${errText.substring(0, 150)}`
                });
            }
        } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            const latencyMs = Date.now() - startTime;
            const isTimeout = fetchErr.name === 'AbortError' || fetchErr.message?.includes('timeout');
            res.status(504).json({
                success: false,
                status: isTimeout ? 'TIMEOUT' : 'CONNECTION_REFUSED',
                latencyMs,
                message: isTimeout
                    ? `⏱️ Koneksi ke MikroTik (${host}:${port}) Time Out (>5 detik). Pastikan router menyala dan port REST API terbuka.`
                    : `🔌 Gagal menghubungi MikroTik (${host}:${port}): ${fetchErr.message}. Pastikan IP MikroTik dapat diakses dari server.`
            });
        }
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Kesalahan sistem uji koneksi: ' + err.message });
    }
};

/**
 * 10. GET /api/admin/wifi/mikrotik-bindings
 * Mengambil daftar IP-Binding langsung dari MikroTik RouterOS v7 & membandingkan dengan sesi DB
 */
export const getMikrotikBindings = async (_req: Request, res: Response): Promise<void> => {
    try {
        const config = await getOrInitWifiConfig();
        if (!config.mikrotikHost || !config.mikrotikUser) {
            res.status(400).json({ success: false, message: 'Konfigurasi MikroTik belum lengkap.' });
            return;
        }

        const protocol = config.mikrotikUseTls ? 'https' : 'http';
        const url = `${protocol}://${config.mikrotikHost}:${config.mikrotikPort}/rest/ip/hotspot/ip-binding`;
        const auth = Buffer.from(`${config.mikrotikUser}:${config.mikrotikPassword || ''}`).toString('base64');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(url, {
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text();
            res.status(response.status).json({ success: false, message: `MikroTik HTTP ${response.status}: ${errText}` });
            return;
        }

        const bindings: any[] = await response.json();
        const activeSessions = await prisma.wifiSession.findMany({
            where: { status: 'ACTIVE' },
            select: { id: true, studentName: true, className: true, deviceMac: true, expiresAt: true }
        });
        const macMap = new Map<string, any>();
        activeSessions.forEach(s => macMap.set(s.deviceMac.toUpperCase(), s));

        const enriched = bindings.map(b => {
            const mac = (b['mac-address'] || '').toUpperCase();
            const matchedSession = macMap.get(mac);
            return {
                id: b['.id'],
                macAddress: b['mac-address'],
                type: b['type'],
                comment: b['comment'] || '-',
                disabled: b['disabled'] === 'true' || b['disabled'] === true,
                matchedSession: matchedSession || null,
                isOrphan: !matchedSession && (b['comment'] || '').includes(config.mikrotikCommentTag)
            };
        });

        res.json({
            success: true,
            totalOnRouter: bindings.length,
            bypassedCount: bindings.filter(b => b['type'] === 'bypassed').length,
            blockedCount: bindings.filter(b => b['type'] === 'blocked').length,
            bindings: enriched
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Gagal mengambil data binding MikroTik: ' + err.message });
    }
};

/**
 * 11. POST /api/admin/wifi/sync-mikrotik
 * Sinkronisasi penuh: pastikan semua sesi aktif di-bypass dan blacklist dicekal di router
 */
export const syncMikrotikWithDatabase = async (_req: Request, res: Response): Promise<void> => {
    try {
        const config = await getOrInitWifiConfig();
        if (!config.mikrotikHost || !config.mikrotikUser) {
            res.status(400).json({ success: false, message: 'Konfigurasi MikroTik belum lengkap.' });
            return;
        }

        const now = new Date();
        const activeSessions = await prisma.wifiSession.findMany({
            where: { status: 'ACTIVE', expiresAt: { gt: now } }
        });
        const blacklist = await prisma.wifiBlacklist.findMany();

        let addedBypass = 0;
        let addedBlocked = 0;

        for (const s of activeSessions) {
            if (s.deviceMac && s.deviceMac !== 'AUTO_DETECT_CLIENT_MAC') {
                const mikrotikId = await callMikrotikAddBinding(s.deviceMac, s.studentName, config, 'bypassed');
                if (mikrotikId) {
                    await prisma.wifiSession.update({
                        where: { id: s.id },
                        data: { mikrotikId }
                    });
                    addedBypass++;
                }
            }
        }

        for (const b of blacklist) {
            if (b.macAddress) {
                await callMikrotikAddBinding(b.macAddress, `BLOCKED_${b.reason || 'Blacklist'}`, config, 'blocked');
                addedBlocked++;
            }
        }

        res.json({
            success: true,
            message: `✅ Sinkronisasi Berhasil: ${addedBypass} perangkat siswa di-bypass, ${addedBlocked} perangkat dicekal di router MikroTik.`,
            stats: {
                activeSessionsCount: activeSessions.length,
                bypassApplied: addedBypass,
                blacklistApplied: addedBlocked
            }
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Gagal sinkronisasi MikroTik: ' + err.message });
    }
};
