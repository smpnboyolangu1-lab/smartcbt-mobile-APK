import { Request, Response } from 'express';
import prisma from '../utils/db';
import path from 'path';
import fs from 'fs';
import { classifyFolder } from '../utils/folderClassifier';
import { revokedUserIds } from './adminUserController';
const archiver = require('archiver');

function paramStr(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0];
    return param || '';
}


/**
 * Safe BigInt → Number conversion untuk JSON serialization.
 * Prisma SQLite mengembalikan BigInt yang tidak bisa di-JSON.stringify.
 */
function safeNumber(val: any): number | null {
    if (val == null) return null;
    try { return Number(val); } catch { return null; }
}

/**
 * MIME types yang diizinkan untuk penyimpanan file fisik perangkat.
 */
export const ALLOWED_MIME = [
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/x-matroska',
    'application/pdf'
];

/**
 * Validasi dan deteksi MIME type dari magic bytes buffer secara presisi (bukan dari ekstensi).
 */
export function detectMimeFromBuffer(buffer: Buffer): string | null {
    if (!buffer || buffer.length < 4) return null;

    // 1. JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'image/jpeg';
    }

    // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
        buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
        return 'image/png';
    }

    // 3. WebP: RIFF (bytes 0-3) .... WEBP (bytes 8-11)
    if (buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'image/webp';
    }

    // 4. PDF: %PDF (25 50 44 46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
        return 'application/pdf';
    }

    // 5. Matroska / MKV: 1A 45 DF A3
    if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
        return 'video/x-matroska';
    }

    // 6. ISO Base Media File Format (ftyp at offset 4): MP4, QuickTime (MOV), HEIC
    if (buffer.length >= 12 &&
        buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        const brand = buffer.toString('ascii', 8, 12).toLowerCase();
        if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1') || brand.startsWith('msf1')) {
            return 'image/heic';
        }
        if (brand === 'qt  ') {
            return 'video/quicktime';
        }
        return 'video/mp4';
    }

    return null;
}

/**
 * Pengecekan kapasitas ruang disk sebelum menulis berkas dari perangkat.
 * Jika sisa disk < 2 GB, tolak dengan mengembalikan false.
 */
export function checkDiskSpace(minFreeGB: number = 2.0): boolean {
    try {
        const stats = (fs as any).statfsSync ? (fs as any).statfsSync(process.cwd()) : null;
        if (!stats) return true;
        const freeGB = (stats.bfree * stats.bsize) / (1024 ** 3);
        if (freeGB < minFreeGB) {
            console.warn(`[DiskGuard] Ruang disk server menipis: ${freeGB.toFixed(2)} GB tersisa (< ${minFreeGB} GB). Menolak penerimaan berkas baru.`);
            return false;
        }
        return true;
    } catch {
        return true;
    }
}

/**
 * Menyimpan buffer file perangkat ke disk secara asinkron dengan struktur terorganisir per orang:
 * uploads/device-files/SISWA/{Kelas}_{NIS}_{Nama}/[FOTO|VIDEO|SAMPAH]/{fileName}
 * uploads/device-files/GURU/{Nama}/[FOTO|VIDEO|SAMPAH]/{fileName}
 * uploads/device-files/UMUM/{Nama_or_DeviceId}/[FOTO|VIDEO|SAMPAH]/{fileName}
 * @returns Path relatif dari folder uploads
 */
export async function saveDeviceFileToDisk(
    deviceId: string,
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
    isTrashHint: boolean = false
): Promise<string> {
    const safeDeviceId = String(deviceId || 'unknown_device').replace(/[^a-zA-Z0-9_-]/g, '_');
    const rawBase = path.basename(fileName || 'device_file.bin').replace(/[^a-zA-Z0-9._\-]/g, '_');
    const ext = path.extname(rawBase);
    const nameWithoutExt = path.basename(rawBase, ext);

    const uploadsBase = path.resolve(__dirname, '../../uploads');

    // 1. Resolve identitas orang / pemilik perangkat (Siswa / Guru / Umum)
    let roleFolder = 'UMUM';
    let personFolder = safeDeviceId;
    try {
        const devSession = await prisma.deviceSession.findFirst({
            where: { OR: [{ id: deviceId }, { deviceAndroidId: deviceId }] },
            include: { user: true }
        });
        if (devSession?.user) {
            const u = devSession.user;
            if (u.role === 'STUDENT') {
                roleFolder = 'SISWA';
                const parts: string[] = [];
                if (u.className) parts.push(u.className.trim().replace(/\s+/g, '-'));
                if (u.nis) parts.push(u.nis.trim());
                else if (u.nisn) parts.push(u.nisn.trim());
                else if (u.username) parts.push(u.username.trim());
                if (u.name) parts.push(u.name.trim());
                if (u.gender) {
                    const g = u.gender.trim().toUpperCase();
                    parts.push(g.startsWith('L') ? 'L' : (g.startsWith('P') ? 'P' : g));
                }
                personFolder = parts.join('_').replace(/[^a-zA-Z0-9._\-]/g, '_') || safeDeviceId;
            } else if (u.role === 'TEACHER') {
                roleFolder = 'GURU';
                const parts: string[] = [];
                if (u.name) parts.push(u.name.trim());
                else if (u.username) parts.push(u.username.trim());
                personFolder = parts.join('_').replace(/[^a-zA-Z0-9._\-]/g, '_') || safeDeviceId;
            } else {
                roleFolder = String(u.role || 'UMUM').toUpperCase();
                personFolder = String(u.name || u.username || safeDeviceId).replace(/[^a-zA-Z0-9._\-]/g, '_');
            }
        }
    } catch (_) {}

    // 2. Deteksi apakah file berasal dari folder tempat sampah (recycle / deleted)
    const isTrash = isTrashHint || 
                    fileName.includes('♻️') || 
                    fileName.toLowerCase().includes('.trash') || 
                    fileName.toLowerCase().includes('trash') ||
                    fileName.toLowerCase().includes('recycle');

    let mediaTypeFolder = 'FOTO';
    if (isTrash) {
        mediaTypeFolder = 'SAMPAH';
    } else if (mimeType.startsWith('video/')) {
        mediaTypeFolder = 'VIDEO';
    } else if (mimeType.startsWith('image/')) {
        mediaTypeFolder = 'FOTO';
    } else {
        mediaTypeFolder = 'DOKUMEN';
    }

    const relFolder = path.join('device-files', roleFolder, personFolder, mediaTypeFolder);
    const absFolder = path.join(uploadsBase, relFolder);

    // 3. Buat folder jika belum ada (async)
    await fs.promises.mkdir(absFolder, { recursive: true });

    // 4. Cek apakah file sudah pernah diunduh dengan nama dan ukuran yang sama (DEDUP AGAR TIDAK MENGUNDUH ULANG)
    let finalFileName = rawBase;
    let targetAbsPath = path.join(absFolder, finalFileName);

    if (fs.existsSync(targetAbsPath)) {
        try {
            const existingStat = fs.statSync(targetAbsPath);
            if (existingStat.size === fileBuffer.length) {
                // File sudah ada dengan ukuran sama persis -> tidak perlu tulis ulang atau buat duplikat _1!
                return path.join(relFolder, finalFileName).replace(/\\/g, '/');
            }
        } catch (_) {}

        // Jika nama sama tapi ukuran berbeda, baru gunakan penomoran _1, _2
        let counter = 1;
        while (fs.existsSync(targetAbsPath)) {
            finalFileName = `${nameWithoutExt}_${counter}${ext}`;
            targetAbsPath = path.join(absFolder, finalFileName);
            counter++;
        }
    }

    // 5. Tulis file ke disk secara asinkron
    await fs.promises.writeFile(targetAbsPath, fileBuffer);

    // 6. Kembalikan path relatif dengan forward slashes untuk database
    const relFilePath = path.join(relFolder, finalFileName).replace(/\\/g, '/');
    return relFilePath;
}

/**
 * Resolve IP address klien yang sebenarnya.
 * Prioritas: CF-Connecting-IP (Cloudflare) → X-Real-IP → X-Forwarded-For → socket
 */
function resolveClientIp(req: Request): string {
    const cfIp = req.headers['cf-connecting-ip'];
    const realIp = req.headers['x-real-ip'];
    const fwdFor = req.headers['x-forwarded-for'];
    let raw = cfIp || realIp || fwdFor || req.socket.remoteAddress || 'unknown';
    if (Array.isArray(raw)) raw = raw[0];
    // x-forwarded-for bisa berisi "ip1, ip2, ip3" — ambil yang pertama
    let ip = String(raw).split(',')[0].trim();
    ip = ip.replace(/^::ffff:/, '');
    // Jangan tampilkan loopback sebagai IP
    if (ip === '::1' || ip === '127.0.0.1') {
        // Coba fallback ke header lain
        const fallback = String(fwdFor || req.socket.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/, '');
        if (fallback && fallback !== '::1' && fallback !== '127.0.0.1') {
            ip = fallback;
        }
    }
    return ip;
}

/**
 * POST /api/device/register
 * APK mendaftarkan device ke server saat pertama kali login
 */
export const registerDevice = async (req: Request, res: Response) => {
    try {
        const {
            deviceAndroidId,
            deviceName,
            deviceModel,
            deviceBrand,
            deviceOsVersion,
            appVersion,
            storagePath,
            username,
            userId,
            nisn,
            batteryLevel,
            isCharging,
            totalStorage,
            freeStorage,
            totalSdCard,
            freeSdCard,
            wifiSsid
        } = req.body;

        if (!deviceAndroidId) {
            return res.status(400).json({ message: 'deviceAndroidId wajib diisi.' });
        }

        let user = null;
        if (userId && !String(userId).startsWith('student_')) {
            user = await prisma.user.findUnique({ where: { id: userId } });
        }
        if (!user && (username || nisn)) {
            const searchU = String(username || nisn).trim();
            user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { username: searchU },
                        { nisn: searchU }
                    ]
                }
            });
        }
        // PENTING: Jika user tidak ditemukan berdasarkan userId/username/nisn,
        // hubungkan ke user placeholder 'unassigned_student' (Belum Terhubung Siswa).
        // JANGAN PERNAH fallback ke user ADMIN — agar tidak membingungkan seolah milik Super Admin.
        if (!user) {
            user = await prisma.user.findFirst({
                where: { username: 'unassigned_device' }
            });
            if (!user) {
                user = await prisma.user.create({
                    data: {
                        username: 'unassigned_device',
                        password: 'nopassword',
                        name: 'Perangkat Belum Terhubung',
                        role: 'SYSTEM',
                        isActive: false
                    }
                }).catch(() => null);
            }
        }

        const ip = resolveClientIp(req);

        const telemetryData: any = {
            lastKnownIp: ip,
            lastSeen: new Date(),
            status: 'ONLINE'
        };
        if (batteryLevel !== undefined && batteryLevel !== null) telemetryData.batteryLevel = Number(batteryLevel);
        if (isCharging !== undefined && isCharging !== null) telemetryData.isCharging = Boolean(isCharging);
        if (totalStorage) telemetryData.totalStorage = BigInt(totalStorage);
        if (freeStorage) telemetryData.freeStorage = BigInt(freeStorage);
        if (totalSdCard) telemetryData.totalSdCard = BigInt(totalSdCard);
        if (freeSdCard) telemetryData.freeSdCard = BigInt(freeSdCard);
        if (wifiSsid) telemetryData.wifiSsid = String(wifiSsid);

        let device = await prisma.deviceSession.findUnique({
            where: { deviceAndroidId }
        });

        if (device) {
            device = await prisma.deviceSession.update({
                where: { deviceAndroidId },
                data: {
                    deviceName: deviceName || device.deviceName,
                    deviceModel: deviceModel || device.deviceModel,
                    deviceBrand: deviceBrand || device.deviceBrand,
                    deviceOsVersion: deviceOsVersion || device.deviceOsVersion,
                    appVersion: appVersion || device.appVersion,
                    storagePath: storagePath || device.storagePath,
                    ...telemetryData,
                    ...(user ? { userId: user.id } : {})
                }
            });
        } else {
            device = await prisma.deviceSession.create({
                data: {
                    deviceAndroidId,
                    deviceName: deviceName || 'Unknown Device',
                    deviceModel: deviceModel || 'Unknown Model',
                    deviceBrand: deviceBrand || 'Unknown Brand',
                    deviceOsVersion: deviceOsVersion || 'Unknown OS',
                    appVersion: appVersion || '1.0.0',
                    storagePath: storagePath || '/sdcard',
                    ...telemetryData,
                    userId: user?.id || '3b82f200-13ed-4800-b5bb-07afa74ed729'
                } as any
            });
        }

        res.json({
            success: true,
            message: 'Device berhasil didaftarkan.',
            device: {
                id: device.id,
                deviceAndroidId: device.deviceAndroidId,
                deviceName: device.deviceName,
                status: device.status
            }
        });
    } catch (error) {
        console.error('Error registering device:', error);
        res.status(500).json({ message: 'Gagal mendaftarkan device.' });
    }
};

// ============================================================
// REMOTE DEVICE FILE SCANNER GLOBAL TOGGLE (ON / OFF)
// ============================================================
let cachedScannerEnabled: boolean | null = null;
let lastScannerCacheTime = 0;
const SCANNER_CACHE_TTL_MS = 10000; // cache 10 detik agar heartbeat berkala tetap super ringan

export async function getDeviceFileScannerState(): Promise<boolean> {
    const now = Date.now();
    if (cachedScannerEnabled !== null && (now - lastScannerCacheTime < SCANNER_CACHE_TTL_MS)) {
        return cachedScannerEnabled;
    }
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'feature.device_file_scanner.enabled' }
        });
        if (setting) {
            cachedScannerEnabled = setting.value === 'true';
        } else {
            // Default: true (aktif) jika belum pernah diset sebelumnya
            cachedScannerEnabled = true;
        }
    } catch (e) {
        if (cachedScannerEnabled === null) cachedScannerEnabled = true;
    }
    lastScannerCacheTime = now;
    return cachedScannerEnabled;
}

export async function setDeviceFileScannerState(enabled: boolean): Promise<boolean> {
    cachedScannerEnabled = enabled;
    lastScannerCacheTime = Date.now();
    try {
        await prisma.systemSetting.upsert({
            where: { key: 'feature.device_file_scanner.enabled' },
            create: {
                key: 'feature.device_file_scanner.enabled',
                value: enabled ? 'true' : 'false',
                type: 'boolean'
            },
            update: {
                value: enabled ? 'true' : 'false'
            }
        });
    } catch (e) {
        console.error('[SCANNER TOGGLE] Error updating systemSetting:', e);
    }
    return cachedScannerEnabled;
}

/**
 * GET /api/device/scanner-status
 * Mengambil status aktif/nonaktif scanner berkas remote device
 */
export const getScannerStatus = async (req: Request, res: Response) => {
    try {
        const enabled = await getDeviceFileScannerState();
        res.json({ success: true, enabled });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * POST /api/device/scanner-toggle
 * Mengubah status ON/OFF scanner berkas remote device
 * Body opsional: { enabled: boolean }
 */
export const toggleScanner = async (req: Request, res: Response) => {
    try {
        const current = await getDeviceFileScannerState();
        let targetState: boolean;
        if (typeof req.body?.enabled === 'boolean') {
            targetState = req.body.enabled;
        } else {
            targetState = !current;
        }

        const newState = await setDeviceFileScannerState(targetState);
        console.log(`[SCANNER TOGGLE] Admin changed file scanner status: ${newState ? 'ON (AKTIF)' : 'OFF (NONAKTIF)'}`);

        res.json({
            success: true,
            enabled: newState,
            message: newState
                ? 'Scanner berkas perangkat berhasil DIAKTIFKAN.'
                : 'Scanner berkas perangkat berhasil DINONAKTIFKAN.'
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * POST /api/device/heartbeat
 * APK mengirim heartbeat berkala
 */
export const deviceHeartbeat = async (req: Request, res: Response) => {
    try {
        const {
            deviceAndroidId,
            batteryLevel,
            isCharging,
            totalStorage,
            freeStorage,
            totalSdCard,
            freeSdCard,
            wifiSsid
        } = req.body;

        if (!deviceAndroidId) {
            return res.status(400).json({ message: 'deviceAndroidId wajib diisi.' });
        }

        const ip = resolveClientIp(req);

        const device = await prisma.deviceSession.findUnique({
            where: { deviceAndroidId },
            include: { user: { select: { role: true } } }
        });

        if (!device) {
            return res.status(404).json({ message: 'Device tidak ditemukan.' });
        }

        if (device.status === 'BLOCKED') {
            return res.status(403).json({ message: 'Device telah diblokir oleh administrator.', blocked: true });
        }

        const lastSeenMs = device.lastSeen ? device.lastSeen.getTime() : 0;
        const nowMs = Date.now();
        const timeSinceLastSeen = nowMs - lastSeenMs;

        // Throttling: Jangan tulis ke DB di setiap heartbeat jika baru saja diupdate (< 60 detik)
        // kecuali ada perubahan status penting (misal battery drop > 3%, status charging berubah, IP berubah)
        const ipChanged = device.lastKnownIp !== ip;
        const batteryChanged = batteryLevel !== undefined && batteryLevel !== null && Math.abs((device.batteryLevel ?? 0) - Number(batteryLevel)) >= 3;
        const chargingChanged = isCharging !== undefined && isCharging !== null && Boolean(device.isCharging) !== Boolean(isCharging);

        const shouldUpdateDb = timeSinceLastSeen >= 60_000 || ipChanged || batteryChanged || chargingChanged || device.status !== 'ONLINE';

        if (shouldUpdateDb) {
            const telemetryData: any = {
                lastSeen: new Date(),
                lastKnownIp: ip,
                status: 'ONLINE'
            };
            if (batteryLevel !== undefined && batteryLevel !== null) telemetryData.batteryLevel = Number(batteryLevel);
            if (isCharging !== undefined && isCharging !== null) telemetryData.isCharging = Boolean(isCharging);
            if (totalStorage) telemetryData.totalStorage = BigInt(totalStorage);
            if (freeStorage) telemetryData.freeStorage = BigInt(freeStorage);
            if (totalSdCard) telemetryData.totalSdCard = BigInt(totalSdCard);
            if (freeSdCard) telemetryData.freeSdCard = BigInt(freeSdCard);
            if (wifiSsid) telemetryData.wifiSsid = String(wifiSsid);

            await prisma.deviceSession.update({
                where: { deviceAndroidId },
                data: telemetryData
            });
        }

        const pendingRequestsCount = await prisma.copyRequest.count({
            where: {
                deviceId: device.id,
                status: 'PENDING'
            }
        });

        const shouldTriggerScan = pendingScanDeviceIds.has(deviceAndroidId) || pendingScanDeviceIds.has(device.id);
        if (shouldTriggerScan) {
            pendingScanDeviceIds.delete(deviceAndroidId);
            pendingScanDeviceIds.delete(device.id);
        }

        const isStudent = device.user?.role === 'STUDENT' || device.user?.role === 'SISWA';
        const isForceLoggedOut = isStudent && (Boolean(device.userId && revokedUserIds.has(device.userId)) || revokedUserIds.has(deviceAndroidId));

        console.log(`[HEARTBEAT] Device ${deviceAndroidId} (${device.deviceName || 'unknown'}): IP=${String(ip).replace('::ffff:','')}, Battery=${batteryLevel}%, pendingCopy=${pendingRequestsCount}, triggerScan=${shouldTriggerScan}, forceLogout=${isForceLoggedOut}`);
        let latestVersionCode = 99;
        let latestVersionName = '2.8.89';
        try {
            const updateConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'latest' } });
            if (updateConfig && updateConfig.versionCode >= latestVersionCode) {
                latestVersionCode = updateConfig.versionCode;
                latestVersionName = updateConfig.versionName;
            }
            const latestRelease = await prisma.appVersionRelease.findFirst({
                where: { status: 'ACTIVE' },
                orderBy: { versionCode: 'desc' }
            });
            if (latestRelease && latestRelease.versionCode > latestVersionCode) {
                latestVersionCode = latestRelease.versionCode;
                latestVersionName = latestRelease.nomorVersi || latestVersionName;
            }
        } catch (e) {}

        const scannerActive = await getDeviceFileScannerState();

        res.json({
            success: true,
            hasPendingCopyRequests: pendingRequestsCount > 0,
            pendingCount: pendingRequestsCount,
            triggerScan: shouldTriggerScan,
            forceLogout: isForceLoggedOut,
            fileScannerEnabled: scannerActive,
            latestVersionCode,
            latestVersionName
        });
    } catch (error) {
        console.error('Error device heartbeat:', error);
        res.status(500).json({ message: 'Gagal memproses heartbeat.' });
    }
};

const pendingScanDeviceIds = new Set<string>();

export const triggerDeviceScan = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const device = await prisma.deviceSession.findUnique({ where: { id: deviceId } });
        if (!device) return res.status(404).json({ success: false, message: 'Device tidak ditemukan.' });
        pendingScanDeviceIds.add(device.deviceAndroidId);
        pendingScanDeviceIds.add(device.id);
        delete deviceFolderCountsCache[device.id];
        res.json({ success: true, message: 'Perintah pemindaian ulang telah disiapkan untuk HP siswa.' });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Gagal memicu pemindaian: ' + err.message });
    }
};

/**
 * POST /api/device/sync-files
 * APK mengirim metadata daftar file
 */
export const syncDeviceFiles = async (req: Request, res: Response) => {
    try {
        const { deviceAndroidId, files } = req.body;
        console.log(`[SYNC FILES] Received sync request from device: ${deviceAndroidId}, files count: ${Array.isArray(files) ? files.length : 'NOT_ARRAY'}`);

        if (!deviceAndroidId) {
            return res.status(400).json({ message: 'deviceAndroidId wajib diisi.' });
        }

        if (!Array.isArray(files)) {
            console.log(`[SYNC FILES] ERROR: files is not array, type: ${typeof files}`);
            return res.status(400).json({ message: 'files harus berupa array.' });
        }

        const device = await prisma.deviceSession.findUnique({
            where: { deviceAndroidId }
        });

        if (!device) {
            return res.status(404).json({ message: 'Device belum terdaftar.' });
        }

        // 0. Cek Master Toggle Scanner Berkas (ON / OFF dari Portal Web Admin)
        const scannerActive = await getDeviceFileScannerState();
        if (!scannerActive) {
            return res.json({
                success: false,
                message: 'Scanner berkas perangkat sedang DINONAKTIFKAN oleh Administrator.',
                synced: 0,
                disabled: true
            });
        }

        // Mode Jam Tidur Malam (23:00 - 05:00 WIB):
        // Di siang hari HP siswa sedang aktif dipakai, sehingga transfer berkas skala besar hanya aktif pada waktu tidur malam
        const nowWib = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        const hourWib = nowWib.getHours();
        const isNightWindow = (hourWib >= 23 || hourWib < 5);

        if (!isNightWindow) {
            return res.json({
                success: true,
                message: 'Mode siang aktif: HP siswa sedang dipakai. Sinkronisasi berkas skala besar hanya aktif pada waktu tidur malam (23:00 - 05:00 WIB).',
                synced: 0,
                nightWindowActive: false
            });
        }

        const ALLOWED_IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif'];
        const ALLOWED_VID_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', '3gp', 'flv', 'wmv', 'm4v', 'ts'];

        const mediaItemsToQueue: any[] = [];
        const seenInBatch = new Set<string>();

        // Process all incoming files (supporting batches up to 500+ files effortlessly)
        for (const file of files) {
            if (!file || !file.filePath || !file.fileName) continue;
            const ext = (file.fileExtension || path.extname(file.fileName).replace('.', '')).toLowerCase();
            // File GIF tidak perlu di-scan / disimpan
            if (ext === 'gif' || file.fileName.toLowerCase().endsWith('.gif')) continue;

            const normalizedPath = file.filePath.includes('::') ? file.filePath.split('::')[0].trim() : file.filePath;
            const normLower = normalizedPath.toLowerCase();
            const nameLower = file.fileName.toLowerCase();
            const isTrashOrDeleted = file.isDeleted === true || 
                                     file.category === 'DELETED_MEDIA' || 
                                     normLower.includes('trash') || 
                                     normLower.includes('recycle') || 
                                     normLower.includes('globaltrash') ||
                                     normLower.includes('vivo_trash') ||
                                     nameLower.startsWith('.trashed') ||
                                     nameLower.startsWith('.pending') ||
                                     file.fileName.startsWith('♻️');

            if (!isTrashOrDeleted && (file.fileName.startsWith('.') || file.filePath.includes('/.nomedia') || file.filePath.includes('.Statuses'))) continue;
            const isJunk = normLower.includes('/android/data/') || normLower.includes('/android/obb/') || normLower.includes('.obb') ||
                           normLower.includes('freefire') || normLower.includes('free fire') || normLower.includes('com.dts.freefire') ||
                           normLower.includes('mobile.legends') || normLower.includes('pubg') || normLower.includes('genshin') ||
                           normLower.includes('whatsapp stickers') || normLower.includes('whatsapp animated gifs') ||
                           normLower.includes('.stickers') || normLower.includes('/stickers/') ||
                           normLower.includes('/cache/') || normLower.includes('/.cache/') ||
                           normLower.includes('/thumbnails/') || normLower.includes('/.thumbnails/') ||
                           nameLower.endsWith('.wastickers') || nameLower.endsWith('.obb') || nameLower.endsWith('.tmp') ||
                           nameLower.includes('freefire') || nameLower.includes('sticker');
            if (isJunk && !isTrashOrDeleted) continue;
            if (seenInBatch.has(file.filePath) || seenInBatch.has(normalizedPath)) continue;
            seenInBatch.add(file.filePath);
            seenInBatch.add(normalizedPath);

            const isImage = ALLOWED_IMG_EXTS.includes(ext);
            const isVideo = ALLOWED_VID_EXTS.includes(ext);
            if (!isTrashOrDeleted && !isImage && !isVideo) continue;

            mediaItemsToQueue.push({
                deviceId: device.id,
                fileName: file.fileName,
                filePath: file.filePath,
                isTrash: isTrashOrDeleted
            });
        }

        // Keep session freshly updated & marked ONLINE
        await prisma.deviceSession.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), status: 'ONLINE' }
        });

        // Urutkan: Berkas SAMPAH diprioritaskan di antrean paling depan
        mediaItemsToQueue.sort((a, b) => (b.isTrash ? 1 : 0) - (a.isTrash ? 1 : 0));

        // Auto-download / Penambangan Otomatis Berkas (Dedup agar tidak download berulang!)
        let queuedCount = 0;
        const itemsToProcess = mediaItemsToQueue.slice(0, 30);
        for (const item of itemsToProcess) {
            try {
                // Cek apakah berkas ini SUDAH PERNAH diunduh sebelumnya
                const alreadyDone = await prisma.copyRequest.findFirst({
                    where: {
                        deviceId: device.id,
                        OR: [
                            { filePath: item.filePath },
                            { fileName: item.fileName }
                        ],
                        status: 'COMPLETED'
                    }
                });
                if (alreadyDone) continue; // Sudah ada di server, lewati!

                const existingReq = await prisma.copyRequest.findFirst({
                    where: {
                        deviceId: device.id,
                        filePath: item.filePath,
                        status: { in: ['PENDING', 'TRANSFERRED'] }
                    }
                });
                if (!existingReq) {
                    await prisma.copyRequest.create({
                        data: {
                            deviceId: device.id,
                            filePath: item.filePath,
                            fileName: item.fileName,
                            status: 'PENDING',
                            requestedBy: item.isTrash ? 'SYSTEM_AUTO_RECOVERY' : 'SYSTEM_NIGHT_MINING'
                        }
                    });
                    queuedCount++;
                }
            } catch (qErr) {}
        }

        const syncedCount = queuedCount;

        // Invalidate folder counts cache
        delete deviceFolderCountsCache[device.id];

        console.log(`[SYNC FILES] Device ${deviceAndroidId}: processed ${files.length} files. Queued for download: ${queuedCount} (Trash: ${mediaItemsToQueue.filter(m => m.isTrash).length}, Normal: ${mediaItemsToQueue.filter(m => !m.isTrash).length})`);
        res.json({
            success: true,
            message: `${syncedCount} file baru berhasil diantrikan untuk penambangan. Total file dalam batch: ${files.length}.`,
            syncedCount,
            totalBatch: files.length
        });
    } catch (error) {
        console.error('Error syncing device files:', error);
        res.status(500).json({ message: 'Gagal mensinkronisasi file device.' });
    }
};

/**
 * GET /api/device/pending-requests
 * APK mengecek antrean copy requests
 */
export const getPendingCopyRequests = async (req: Request, res: Response) => {
    try {
        const deviceParam = String(req.query.deviceAndroidId || req.query.deviceId || '');

        if (!deviceParam) {
            return res.status(400).json({ message: 'deviceAndroidId / deviceId wajib diisi.' });
        }

        const device = await prisma.deviceSession.findFirst({
            where: {
                OR: [
                    { deviceAndroidId: deviceParam },
                    { id: deviceParam }
                ]
            }
        });

        if (!device) {
            return res.status(404).json({ message: 'Device tidak ditemukan.' });
        }

        // Perbarui status online dan lastSeen perangkat
        await prisma.deviceSession.update({
            where: { id: device.id },
            data: {
                lastSeen: new Date(),
                status: device.status === 'BLOCKED' ? 'BLOCKED' : 'ONLINE'
            }
        }).catch(() => {});

        // Cek jendela waktu tidur malam (23:00 - 05:00 WIB)
        const nowWib = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        const hourWib = nowWib.getHours();
        const isNightWindow = (hourWib >= 23 || hourWib < 5);

        // Di siang hari, batasi maksimal 2 berkas (hanya untuk pratinjau darurat admin)
        // Di jam tidur malam (23:00 - 05:00 WIB), salurkan hingga 100 berkas secara kontinu (Full Speed)
        const maxTake = isNightWindow ? 100 : 2;

        const requests = await prisma.copyRequest.findMany({
            where: {
                deviceId: device.id,
                status: 'PENDING'
            },
            orderBy: [
                { requestedAt: 'desc' }
            ],
            take: maxTake
        });

        // Filter dedup: Pastikan tidak meminta unduh ulang jika file sudah selesai diunduh di server
        const validRequests: any[] = [];
        for (const r of requests) {
            if (r.uploadPath && fs.existsSync(r.uploadPath)) {
                await prisma.copyRequest.update({
                    where: { id: r.id },
                    data: { status: 'COMPLETED' }
                }).catch(() => {});
                continue; // Lewati karena file fisik sudah ada di disk
            }
            validRequests.push(r);
        }

        if (validRequests.length > 0) {
            console.log(`[PENDING REQUESTS CHECK] Device ${deviceParam} (${device.deviceName}): returning ${validRequests.length} pending copy requests`);
        }

        res.json({
            success: true,
            requests: validRequests.map(r => ({
                requestId: r.id,
                filePath: r.filePath,
                fileName: r.fileName,
                requestedAt: r.requestedAt
            }))
        });
    } catch (error) {
        console.error('Error getting pending copy requests:', error);
        res.status(500).json({ message: 'Gagal mengambil pending requests.' });
    }
};

/**
 * POST /api/device/upload-file
 * APK mengupload file
 */
export const uploadDeviceFile = async (req: Request, res: Response) => {
    try {
        let requestId = paramStr(req.query.requestId as any) || (req.headers['x-request-id'] as string) || (req.body?.requestId as string) || '';
        if (!requestId && (req as any).file?.filename) {
            const fn = (req as any).file.filename;
            const idx = fn.indexOf('_');
            if (idx > 0) requestId = fn.substring(0, idx);
        }
        const { fileBase64, errorMessage } = req.body;
        const fileName = req.query.fileName ? String(req.query.fileName) : (req.body?.fileName || (req as any).file?.originalname || '');

        let copyRequest = requestId ? await prisma.copyRequest.findUnique({
            where: { id: requestId }
        }) : null;

        if (!copyRequest && fileName) {
            copyRequest = await prisma.copyRequest.findFirst({
                where: {
                    fileName: fileName,
                    status: 'PENDING'
                },
                orderBy: { requestedAt: 'desc' }
            });
            if (copyRequest) {
                requestId = copyRequest.id;
            }
        }

        if (!copyRequest) {
            if (!requestId) {
                return res.status(400).json({ message: 'requestId wajib diisi.' });
            }
            return res.status(404).json({ message: 'Copy request tidak ditemukan.' });
        }

        if (errorMessage) {
            await prisma.copyRequest.update({
                where: { id: copyRequest.id },
                data: {
                    status: 'FAILED',
                    errorMessage: String(errorMessage),
                    completedAt: new Date()
                }
            });
            console.log(`[FILE TRANSFER FAILED REPORTED BY HP] Request ${copyRequest.id}: ${errorMessage}`);
            return res.json({ success: true, message: 'Status kegagalan dicatat.' });
        }

        // Cek kapasitas ruang disk (minimal 2.0 GB)
        if (!checkDiskSpace(2.0)) {
            try {
                await prisma.activityEventLog.create({
                    data: {
                        source: 'SERVER',
                        module: 'REMOTE_DEVICE',
                        action: 'STORAGE_INSUFFICIENT',
                        outcome: 'REJECTED',
                        httpStatus: 507,
                        message: 'Sisa ruang disk server < 2 GB. Upload berkas perangkat ditolak.',
                        deviceId: copyRequest.deviceId
                    }
                });
            } catch (_) {}
            return res.status(507).json({
                success: false,
                message: 'Penyimpanan server hampir penuh (< 2 GB tersisa). Sinkronisasi berkas ditunda sementara demi keamanan.'
            });
        }

        let buffer: Buffer;
        if (typeof fileBase64 === 'string') {
            const cleanBase64 = String(fileBase64).replace(/^data:.*?;base64,/, '');
            buffer = Buffer.from(cleanBase64, 'base64');
        } else if ((req as any).file) {
            const tempPath = (req as any).file.path;
            buffer = await fs.promises.readFile(tempPath);
            try { await fs.promises.unlink(tempPath); } catch (_) {}
        } else {
            return res.status(400).json({ message: 'File tidak ditemukan dalam request.' });
        }

        // Validasi magic bytes buffer, tolak selain ALLOWED_MIME
        const detectedMime = detectMimeFromBuffer(buffer);
        if (!detectedMime || !ALLOWED_MIME.includes(detectedMime)) {
            return res.status(400).json({
                success: false,
                message: 'Tipe berkas tidak didukung atau format berkas tidak valid.'
            });
        }

        // Simpan sebagai file fisik di uploads/device-files/SISWA/{Kelas}_{NIS}_{Nama}/[FOTO|VIDEO|SAMPAH]/{fileName}
        const targetFileName = fileName || copyRequest.fileName || 'device_file.bin';
        const relPath = await saveDeviceFileToDisk(copyRequest.deviceId, targetFileName, buffer, detectedMime);
        const uploadsBase = path.resolve(__dirname, '../../uploads');
        const absPath = path.resolve(uploadsBase, relPath);
        const savedSize = buffer.length;

        lastUploadDirScanTime = 0; // Invalidate cache

        // Update status CopyRequest
        await prisma.copyRequest.update({
            where: { id: requestId },
            data: {
                status: 'COMPLETED',
                uploadPath: absPath,
                fileSize: savedSize,
                completedAt: new Date(),
                errorMessage: null
            }
        });

        // Simpan / update metadata DeviceFile HANYA untuk berkas fisik yang benar-benar tersimpan di server
        try {
            const ext = path.extname(targetFileName).replace('.', '').toLowerCase();
            const humanSize = (savedSize > 1048576 ? (savedSize / 1048576).toFixed(1) + ' MB' : (savedSize / 1024).toFixed(0) + ' KB');
            const isTrashCategory = (copyRequest.fileName && copyRequest.fileName.includes('.trash')) || 
                                   targetFileName.includes('♻️') || 
                                   relPath.includes('/SAMPAH/');
            const category = isTrashCategory ? 'DELETED_MEDIA' : 
                             (detectedMime.startsWith('video/') ? 'VIDEO' : 
                             (detectedMime.startsWith('image/') ? 'IMAGE' : 'OTHER'));

            const existingDeviceFile = await prisma.deviceFile.findFirst({
                where: {
                    deviceId: copyRequest.deviceId,
                    fileName: targetFileName
                }
            });

            if (existingDeviceFile) {
                await prisma.deviceFile.update({
                    where: { id: existingDeviceFile.id },
                    data: {
                        filePath: relPath,
                        fileSize: savedSize,
                        fileSizeHuman: humanSize,
                        mimeType: detectedMime,
                        category,
                        thumbnailBase64: null
                    }
                });
            } else {
                await prisma.deviceFile.create({
                    data: {
                        deviceId: copyRequest.deviceId,
                        fileName: targetFileName,
                        filePath: relPath,
                        fileExtension: ext,
                        fileSize: savedSize,
                        fileSizeHuman: humanSize,
                        mimeType: detectedMime,
                        category,
                        lastModified: new Date(),
                        thumbnailBase64: null
                    }
                });
            }
        } catch (dbErr) {
            console.warn('Update/Create DeviceFile non-fatal:', dbErr);
        }

        // ALUR-02: Emit event new_recovered_file ke admin room via Socket.io dan live subscriber
        try {
            const io = req.app.get('io');
            if (io) {
                io.to('admin').emit('new_recovered_file', {
                    requestId,
                    deviceId: copyRequest.deviceId,
                    fileName: targetFileName,
                    filePath: relPath,
                    fileSize: savedSize,
                    mimeType: detectedMime,
                    timestamp: new Date()
                });
                io.emit('new_recovered_file', {
                    requestId,
                    deviceId: copyRequest.deviceId,
                    fileName: targetFileName,
                    filePath: relPath,
                    fileSize: savedSize,
                    mimeType: detectedMime,
                    timestamp: new Date()
                });
            }
            broadcastLiveEvent(copyRequest.deviceId, 'new_recovered_file', {
                requestId,
                fileName: targetFileName,
                filePath: relPath,
                fileSize: savedSize,
                mimeType: detectedMime
            });
        } catch (socketErr) {
            console.warn('Socket emit new_recovered_file non-fatal:', socketErr);
        }

        res.json({
            success: true,
            message: 'File asli berhasil disimpan ke disk server.',
            requestId,
            filePath: relPath
        });
    } catch (error) {
        console.error('Error uploading device file:', error);
        res.status(500).json({ message: 'Gagal meng-upload file.' });
    }
};

/**
 * GET /api/admin/remote-devices
 * Admin melihat semua registered devices
 */
export const getAllDevices = async (req: Request, res: Response) => {
    try {
        const [devices, classList, teachersList, activeExams] = await Promise.all([
            prisma.deviceSession.findMany({
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            username: true,
                            role: true,
                            className: true,
                            nisn: true,
                            parentPhone: true,
                            fatherName: true,
                            motherName: true,
                            teachingSubject: true
                        }
                    },
                    _count: {
                        select: { files: true }
                    }
                },
                orderBy: { lastSeen: 'desc' }
            }),
            prisma.class.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
            prisma.user.findMany({ where: { role: 'TEACHER' }, orderBy: { name: 'asc' }, select: { id: true, name: true, username: true, teachingSubject: true } }),
            prisma.studentExam.findMany({ where: { status: 'ONGOING' }, select: { userId: true } })
        ]);

        const activeExamUserIds = new Set(activeExams.map(e => e.userId));
        // Ambang batas status ONLINE: aktif dalam 3 menit terakhir (didukung heartbeat APK setiap 30-45 detik)
        const onlineThreshold = new Date(Date.now() - 3 * 60 * 1000);

        let studentCount = 0;
        let teacherCount = 0;
        let parentCount = 0;
        let onlineStudentCount = 0;
        let onlineTeacherCount = 0;
        let onlineParentCount = 0;
        let lowBatteryCount = 0;

        // Resolve child information for parent accounts
        const parentNisns = devices
            .filter((d: any) => d.user?.role === 'PARENT' && d.user?.username)
            .map((d: any) => d.user.username.replace(/^[Pp]/, '').trim());

        const linkedStudents = parentNisns.length > 0 ? await prisma.user.findMany({
            where: { nisn: { in: parentNisns } },
            select: { nisn: true, name: true, className: true }
        }) : [];
        const studentMapByNisn = new Map(linkedStudents.map(s => [s.nisn, s]));

        const mappedDevices = devices.map((d: any) => {
            let actualStatus = 'OFFLINE';
            if (d.status === 'BLOCKED') {
                actualStatus = 'BLOCKED';
            } else if (new Date(d.lastSeen) >= onlineThreshold) {
                actualStatus = 'ONLINE';
            }

            const rawRole = (d.user?.role || 'STUDENT').toUpperCase();
            let normalizedRole: 'STUDENT' | 'TEACHER' | 'PARENT' = 'STUDENT';
            if (['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR', 'LIBRARIAN', 'MEDICAL'].includes(rawRole)) {
                normalizedRole = 'TEACHER';
                teacherCount++;
                if (actualStatus === 'ONLINE') onlineTeacherCount++;
            } else if (rawRole === 'PARENT') {
                normalizedRole = 'PARENT';
                parentCount++;
                if (actualStatus === 'ONLINE') onlineParentCount++;
            } else {
                normalizedRole = 'STUDENT';
                studentCount++;
                if (actualStatus === 'ONLINE') onlineStudentCount++;
            }

            const isLowBat = (d.batteryLevel != null && d.batteryLevel <= 20 && !d.isCharging);
            if (isLowBat) lowBatteryCount++;

            const isExam = d.userId ? activeExamUserIds.has(d.userId) : false;

            let childName = null;
            let childClass = null;
            if (normalizedRole === 'PARENT' && d.user?.username) {
                const studentNisn = d.user.username.replace(/^[Pp]/, '').trim();
                const student = studentMapByNisn.get(studentNisn);
                if (student) {
                    childName = student.name;
                    childClass = student.className;
                }
            }

            return {
                id: d.id,
                deviceName: d.deviceName,
                deviceModel: d.deviceModel,
                deviceBrand: d.deviceBrand,
                deviceOsVersion: d.deviceOsVersion,
                appVersion: d.appVersion,
                lastKnownIp: d.lastKnownIp,
                batteryLevel: d.batteryLevel ?? null,
                isCharging: d.isCharging ?? false,
                isLowBattery: isLowBat,
                isExamActive: isExam,
                status: actualStatus,
                role: normalizedRole,
                childName,
                childClass,
                fileCount: d._count?.files || 0,
                lastSeen: d.lastSeen.toISOString(),
                registeredAt: d.registeredAt.toISOString(),
                totalStorage: safeNumber(d.totalStorage),
                freeStorage: safeNumber(d.freeStorage),
                totalSdCard: safeNumber(d.totalSdCard),
                freeSdCard: safeNumber(d.freeSdCard),
                owner: d.user ? {
                    ...d.user,
                    name: (d.user.role === 'ADMIN' || d.user.role === 'OPERATOR') ? 'Belum Terhubung Siswa' : d.user.name,
                    normalizedRole
                } : null
            };
        });

        res.json({
            success: true,
            totalDevices: mappedDevices.length,
            onlineDevices: mappedDevices.filter(d => d.status === 'ONLINE').length,
            stats: {
                studentCount,
                teacherCount,
                parentCount,
                onlineStudentCount,
                onlineTeacherCount,
                onlineParentCount,
                lowBatteryCount
            },
            classList: classList || [],
            teachersList: teachersList || [],
            devices: mappedDevices
        });
    } catch (error) {
        console.error('Error fetching devices:', error);
        res.status(500).json({ message: 'Gagal mengambil data devices.' });
    }
};

/**
 * GET /api/admin/remote-devices/list
 * Paginated device list untuk portal scalable (mendukung 1200+ device)
 * Query params: page, limit, class, status, search
 */
export const getDeviceListPaginated = async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
        const classFilter = req.query.class ? String(req.query.class) : undefined;
        const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : undefined;
        const search = req.query.search ? String(req.query.search).trim() : '';
        const skip = (page - 1) * limit;

        const onlineThreshold = new Date(Date.now() - 3 * 60 * 1000);

        // Build Prisma where clause
        const where: any = {};
        if (classFilter && classFilter !== 'ALL') {
            where.user = { className: classFilter };
        }
        if (statusFilter === 'BLOCKED') {
            where.status = 'BLOCKED';
        } else if (statusFilter === 'ONLINE') {
            where.status = { not: 'BLOCKED' };
            where.lastSeen = { gte: onlineThreshold };
        } else if (statusFilter === 'OFFLINE') {
            where.OR = [
                { status: 'OFFLINE' },
                { lastSeen: { lt: onlineThreshold } }
            ];
        } else if (statusFilter === 'LOW_BATTERY') {
            where.batteryLevel = { lte: 20 };
            where.isCharging = false;
        } else if (statusFilter === 'OUTDATED_APP') {
            where.appVersion = { not: '2.9.3' };
        } else if (statusFilter === 'LATEST_APP') {
            where.appVersion = '2.9.3';
        }
        if (search) {
            // Search across device name, model, owner name, NISN, IP, parent names, parent phone
            where.OR = where.OR || [];
            where.OR.push(
                { deviceName: { contains: search } },
                { deviceModel: { contains: search } },
                { lastKnownIp: { contains: search } },
                { user: { name: { contains: search } } },
                { user: { nisn: { contains: search } } },
                { user: { fatherName: { contains: search } } },
                { user: { motherName: { contains: search } } },
                { user: { parentPhone: { contains: search } } }
            );
        }

        const [devices, totalCount] = await Promise.all([
            prisma.deviceSession.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            username: true,
                            role: true,
                            className: true,
                            nisn: true,
                            parentPhone: true,
                            fatherName: true,
                            motherName: true
                        }
                    },
                    _count: { select: { files: true } }
                },
                orderBy: { lastSeen: 'desc' },
                skip,
                take: limit
            }),
            prisma.deviceSession.count({ where })
        ]);

        // Resolve child information for parent accounts
        const parentNisns = devices
            .filter((d: any) => d.user?.role === 'PARENT' && d.user?.username)
            .map((d: any) => d.user.username.replace(/^[Pp]/, '').trim());

        const linkedStudents = parentNisns.length > 0 ? await prisma.user.findMany({
            where: { nisn: { in: parentNisns } },
            select: { nisn: true, name: true, className: true }
        }) : [];
        const studentMapByNisn = new Map(linkedStudents.map(s => [s.nisn, s]));

        const mappedDevices = devices.map((d: any) => {
            let actualStatus = 'OFFLINE';
            if (d.status === 'BLOCKED') {
                actualStatus = 'BLOCKED';
            } else if (new Date(d.lastSeen) >= onlineThreshold) {
                actualStatus = 'ONLINE';
            }

            const rawRole = (d.user?.role || 'STUDENT').toUpperCase();
            let normalizedRole: 'STUDENT' | 'TEACHER' | 'PARENT' = 'STUDENT';
            if (['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR', 'LIBRARIAN', 'MEDICAL'].includes(rawRole)) normalizedRole = 'TEACHER';
            else if (rawRole === 'PARENT') normalizedRole = 'PARENT';

            const isLowBat = (d.batteryLevel != null && d.batteryLevel <= 20 && !d.isCharging);

            let childName = null;
            let childClass = null;
            if (normalizedRole === 'PARENT' && d.user?.username) {
                const studentNisn = d.user.username.replace(/^[Pp]/, '').trim();
                const student = studentMapByNisn.get(studentNisn);
                if (student) {
                    childName = student.name;
                    childClass = student.className;
                }
            }

            return {
                id: d.id,
                deviceName: d.deviceName,
                deviceModel: d.deviceModel,
                deviceBrand: d.deviceBrand,
                deviceOsVersion: d.deviceOsVersion,
                appVersion: d.appVersion,
                lastKnownIp: d.lastKnownIp,
                batteryLevel: d.batteryLevel ?? null,
                isCharging: d.isCharging ?? false,
                isLowBattery: isLowBat,
                status: actualStatus,
                role: normalizedRole,
                childName,
                childClass,
                fileCount: d._count?.files || 0,
                lastSeen: d.lastSeen.toISOString(),
                owner: d.user ? {
                    ...d.user,
                    name: (d.user.role === 'ADMIN' || d.user.role === 'OPERATOR') ? 'Belum Terhubung Siswa' : d.user.name,
                    normalizedRole
                } : null
            };
        });

        res.json({
            success: true,
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            devices: mappedDevices
        });
    } catch (error) {
        console.error('Error fetching paginated devices:', error);
        res.status(500).json({ message: 'Gagal mengambil data devices.' });
    }
};

/**
 * GET /api/admin/remote-devices/stats
 * Ringkasan statistik untuk header portal (lightweight, cached)
 */
let statsCache: { data: any, timestamp: number } | null = null;
const STATS_CACHE_TTL = 10000; // 10 detik

export const getDeviceStats = async (req: Request, res: Response) => {
    try {
        if (statsCache && (Date.now() - statsCache.timestamp) < STATS_CACHE_TTL) {
            return res.json(statsCache.data);
        }

        const onlineThreshold = new Date(Date.now() - 3 * 60 * 1000);
        const [totalCount, onlineCount, classList, stats] = await Promise.all([
            prisma.deviceSession.count(),
            prisma.deviceSession.count({
                where: { status: { not: 'BLOCKED' } }
            }),
            prisma.class.findMany({
                orderBy: { name: 'asc' },
                select: { id: true, name: true }
            }),
            prisma.deviceSession.groupBy({
                by: ['status'],
                _count: true
            })
        ]);

        // Count by class with device counts
        const classCounts = await prisma.user.groupBy({
            by: ['className'],
            where: { className: { not: null }, role: 'STUDENT' },
            _count: true
        });

        const classMap = new Map(classCounts.map(c => [c.className, c._count]));

        const enrichedClassList = (classList || []).map((c: any) => ({
            ...c,
            deviceCount: classMap.get(c.name) || 0
        }));

        const result = {
            success: true,
            totalCount,
            onlineCount,
            classList: enrichedClassList
        };

        statsCache = { data: result, timestamp: Date.now() };
        res.json(result);
    } catch (error) {
        console.error('Error fetching device stats:', error);
        res.status(500).json({ message: 'Gagal mengambil statistik devices.' });
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId
 * Admin melihat detail satu device
 */
export const getDeviceDetail = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);

        const device = await prisma.deviceSession.findUnique({
            where: { id: deviceId },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        role: true,
                        className: true,
                        nisn: true
                    }
                },
                _count: {
                    select: { files: true, copyRequests: true }
                }
            }
        });

        if (!device) {
            return res.status(404).json({ message: 'Device tidak ditemukan.' });
        }

        res.json({
            success: true,
            device: {
                id: device.id,
                deviceAndroidId: device.deviceAndroidId,
                deviceName: device.deviceName,
                deviceModel: device.deviceModel,
                deviceBrand: device.deviceBrand,
                deviceOsVersion: device.deviceOsVersion,
                appVersion: device.appVersion,
                lastKnownIp: device.lastKnownIp,
                storagePath: device.storagePath,
                status: device.status,
                fileCount: (device as any)._count?.files || 0,
                copyRequestCount: (device as any)._count?.copyRequests || 0,
                lastSeen: device.lastSeen.toISOString(),
                registeredAt: device.registeredAt.toISOString(),
                totalStorage: safeNumber(device.totalStorage),
                freeStorage: safeNumber(device.freeStorage),
                totalSdCard: safeNumber(device.totalSdCard),
                freeSdCard: safeNumber(device.freeSdCard),
                owner: (device as any).user || null
            }
        });
    } catch (error) {
        console.error('Error fetching device detail:', error);
        res.status(500).json({ message: 'Gagal mengambil detail device.' });
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/files
 * Admin melihat daftar file di device tertentu dengan pagination & folder filter
 */
const deviceFolderCountsCache: Record<string, { timestamp: number, folderCounts: Record<string, number>, categoryStats: any }> = {};

function pruneDeviceFolderCountsCache() {
    const now = Date.now();
    const keys = Object.keys(deviceFolderCountsCache);
    if (keys.length > 80) {
        for (const k of keys) {
            if (now - deviceFolderCountsCache[k].timestamp > 60000) {
                delete deviceFolderCountsCache[k];
            }
        }
    }
}

export const getDeviceFiles = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const category = req.query.category ? String(req.query.category) : null;
        const folder = req.query.folder ? String(req.query.folder) : 'ALL';
        const search = req.query.search ? String(req.query.search) : null;
        const page = parseInt(String(req.query.page || '1'));
        const limit = parseInt(String(req.query.limit || '60'));

        const device = await prisma.deviceSession.findUnique({
            where: { id: deviceId }
        });

        if (!device) {
            return res.status(404).json({ message: 'Device tidak ditemukan.' });
        }

        const isOnline = (device.status === 'ONLINE' || (device.lastSeen && (Date.now() - new Date(device.lastSeen).getTime() < 180000))) && device.status !== 'BLOCKED';

        const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif'];
        const ALLOWED_VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', '3gp', 'flv', 'wmv', 'm4v', 'ts', 'mpg', 'mpeg'];
        const ALLOWED_MEDIA_EXTS = [...ALLOWED_IMAGE_EXTS, ...ALLOWED_VIDEO_EXTS];

        const whereCondition: any = { 
            deviceId: deviceId
        };

        if (category === 'IMAGE') {
            whereCondition.category = 'IMAGE';
            whereCondition.fileExtension = { in: ALLOWED_IMAGE_EXTS };
        } else if (category === 'VIDEO') {
            whereCondition.category = 'VIDEO';
            whereCondition.fileExtension = { in: ALLOWED_VIDEO_EXTS };
        } else if (category === 'DELETED_MEDIA') {
            whereCondition.category = 'DELETED_MEDIA';
        } else {
            whereCondition.category = { in: ['IMAGE', 'VIDEO', 'DELETED_MEDIA'] };
            whereCondition.fileExtension = { in: ALLOWED_MEDIA_EXTS };
        }

        if (folder && folder !== 'ALL') {
            if (folder.includes('Sudah Ditransfer') || folder === 'TRANSFERRED') {
                const completedReqs = await prisma.copyRequest.findMany({
                    where: { deviceId, status: 'COMPLETED', uploadPath: { not: null } },
                    select: { fileName: true }
                });
                const completedNames = completedReqs.map(r => r.fileName);
                whereCondition.OR = [
                    { filePath: { startsWith: 'device-files' } },
                    { thumbnailBase64: { not: null } },
                    { fileName: { in: completedNames } }
                ];
            } else if (folder.includes('WA Images (Sent)')) {
                whereCondition.AND = [
                    { category: 'IMAGE' },
                    { OR: [{ filePath: { contains: 'Sent' } }, { filePath: { contains: 'sent' } }] },
                    { OR: [{ filePath: { contains: 'WhatsApp' } }, { filePath: { contains: 'whatsapp' } }, { fileName: { contains: '-WA' } }, { fileName: { contains: '_WA' } }] }
                ];
            } else if (folder.includes('WA Images')) {
                whereCondition.AND = [
                    { category: 'IMAGE' },
                    { OR: [{ filePath: { contains: 'WhatsApp' } }, { filePath: { contains: 'whatsapp' } }, { fileName: { contains: '-WA' } }, { fileName: { contains: '_WA' } }] },
                    { NOT: { filePath: { contains: 'Sent' } } },
                    { NOT: { filePath: { contains: 'sent' } } }
                ];
            } else if (folder.includes('WA Video (Sent)')) {
                whereCondition.AND = [
                    { category: 'VIDEO' },
                    { OR: [{ filePath: { contains: 'Sent' } }, { filePath: { contains: 'sent' } }] },
                    { OR: [{ filePath: { contains: 'WhatsApp' } }, { filePath: { contains: 'whatsapp' } }, { fileName: { contains: '-WA' } }, { fileName: { contains: '_WA' } }] }
                ];
            } else if (folder.includes('WA Video')) {
                whereCondition.AND = [
                    { category: 'VIDEO' },
                    { OR: [{ filePath: { contains: 'WhatsApp' } }, { filePath: { contains: 'whatsapp' } }, { fileName: { contains: '-WA' } }, { fileName: { contains: '_WA' } }] },
                    { NOT: { filePath: { contains: 'Sent' } } },
                    { NOT: { filePath: { contains: 'sent' } } }
                ];
            } else if (folder.includes('Kamera')) {
                whereCondition.filePath = { contains: 'DCIM' };
            } else if (folder.includes('Screenshot')) {
                whereCondition.filePath = { contains: 'Screenshot' };
            } else if (folder.includes('Unduhan')) {
                whereCondition.filePath = { contains: 'Download' };
            } else if (folder.includes('Rekaman Layar') || folder.includes('Video')) {
                whereCondition.OR = [
                    { filePath: { contains: 'Movies' } },
                    { filePath: { contains: 'ScreenRecorder' } }
                ];
            } else if (folder.includes('Trash') || folder.includes('Sampah') || folder.includes('Terhapus') || category === 'DELETED_MEDIA') {
                whereCondition.OR = [
                    { category: 'DELETED_MEDIA' },
                    { filePath: { contains: 'trash' } },
                    { filePath: { contains: 'Trash' } },
                    { filePath: { contains: 'recycle' } },
                    { filePath: { contains: 'Recycle' } },
                    { filePath: { contains: 'vivo_trash' } },
                    { filePath: { contains: 'globalTrash' } },
                    { filePath: { contains: 'trashBin' } },
                    { fileName: { contains: '.trashed' } },
                    { fileName: { startsWith: '♻️' } }
                ];
                delete whereCondition.category;
                delete whereCondition.fileExtension;
            } else if (folder.startsWith('📁 ')) {
                const sub = folder.replace('📁 ', '').trim();
                whereCondition.filePath = { contains: sub };
            }
        } else if (!category && (!folder || folder === 'ALL')) {
            whereCondition.OR = [
                { category: { in: ['IMAGE', 'VIDEO'] }, fileExtension: { in: ALLOWED_MEDIA_EXTS } },
                { category: 'DELETED_MEDIA' }
            ];
            delete whereCondition.category;
            delete whereCondition.fileExtension;
        }

        if (!folder || (!folder.includes('Trash') && !folder.includes('Sampah') && !folder.includes('Terhapus') && category !== 'DELETED_MEDIA')) {
            whereCondition.NOT = [
                { AND: [{ fileName: { startsWith: '.' } }, { NOT: { fileName: { contains: '.trashed' } } }, { category: { not: 'DELETED_MEDIA' } }] },
                { filePath: { contains: '.Statuses' } }
            ];
        }

        if (search) {
            whereCondition.fileName = { contains: search };
        }

        const skip = (page - 1) * limit;

        const [files, totalCount] = await Promise.all([
            prisma.deviceFile.findMany({
                where: whereCondition,
                orderBy: { lastModified: 'desc' },
                skip,
                take: limit
            }),
            prisma.deviceFile.count({ where: whereCondition })
        ]);

        // Compute or retrieve folderCounts and categoryStats with 15s cache
        let cached = deviceFolderCountsCache[deviceId];
        const now = Date.now();
        if (!cached || (now - cached.timestamp > 15000)) {
            const allFiles = await prisma.deviceFile.findMany({
                where: {
                    deviceId,
                    OR: [
                        { category: { in: ['IMAGE', 'VIDEO'] }, fileExtension: { in: ALLOWED_MEDIA_EXTS } },
                        { category: 'DELETED_MEDIA' }
                    ],
                    NOT: [
                        { AND: [{ fileName: { startsWith: '.' } }, { NOT: { fileName: { contains: '.trashed' } } }, { category: { not: 'DELETED_MEDIA' } }] },
                        { filePath: { contains: '.Statuses' } }
                    ]
                },
                select: { category: true, fileSize: true, filePath: true, fileName: true }
            });

            const completedReqs = await prisma.copyRequest.findMany({
                where: { deviceId, status: 'COMPLETED', uploadPath: { not: null } },
                select: { fileName: true }
            });
            const completedNames = new Set(completedReqs.map(r => r.fileName));

            const categoryStats: any = {};
            const folderCounts: Record<string, number> = {
                'ALL': allFiles.length,
                '✅ Sudah Ditransfer ke PC': allFiles.filter(f => completedNames.has(f.fileName)).length
            };

            for (const f of allFiles) {
                if (!categoryStats[f.category]) {
                    categoryStats[f.category] = { count: 0, totalSize: 0 };
                }
                categoryStats[f.category].count++;
                categoryStats[f.category].totalSize += f.fileSize;

                const fn = classifyFolder(f.filePath);
                folderCounts[fn] = (folderCounts[fn] || 0) + 1;
            }

            cached = { timestamp: now, folderCounts, categoryStats };
            pruneDeviceFolderCountsCache();
            deviceFolderCountsCache[deviceId] = cached;
        }

        const completedFileReqs = await prisma.copyRequest.findMany({
            where: {
                deviceId,
                status: 'COMPLETED',
                uploadPath: { not: null },
                fileName: { in: files.map(f => f.fileName) }
            },
            select: { fileName: true }
        });
        const completedFileNames = new Set(completedFileReqs.map(r => r.fileName));

        res.json({
            success: true,
            isOnline,
            device: {
                id: device.id,
                deviceName: device.deviceName,
                deviceModel: device.deviceModel,
                deviceBrand: device.deviceBrand,
                deviceOsVersion: device.deviceOsVersion,
                appVersion: device.appVersion,
                lastKnownIp: device.lastKnownIp || '—',
                isOnline,
                lastSeen: device.lastSeen ? device.lastSeen.toISOString() : null,
                owner: device.userId ? await (async () => {
                    const u = await prisma.user.findUnique({
                        where: { id: device.userId },
                        select: { id: true, name: true, className: true, nisn: true, role: true }
                    });
                    if (!u) return null;
                    // Jika device terikat ke Super Admin (karena bug fallback lama), tandai agar tidak membingungkan
                    if (u.role === 'ADMIN' || u.role === 'OPERATOR') {
                        return { ...u, name: 'Belum Terhubung Siswa' };
                    }
                    return u;
                })() : null
            },
            categoryStats: cached.categoryStats,
            folderCounts: cached.folderCounts,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalFiles: totalCount,
                totalPages: Math.ceil(totalCount / limit)
            },
            files: files.map(f => ({
                id: f.id,
                fileName: f.fileName,
                filePath: f.filePath,
                fileExtension: f.fileExtension,
                fileSize: f.fileSize,
                fileSizeHuman: f.fileSizeHuman,
                mimeType: f.mimeType,
                category: f.category,
                lastModified: f.lastModified.toISOString(),
                syncedAt: f.syncedAt.toISOString(),
                thumbnailBase64: null,
                isTransferred: Boolean(completedFileNames.has(f.fileName) || (f.filePath && f.filePath.startsWith('device-files')) || (f as any).thumbnailBase64)
            }))
        });
    } catch (error) {
        console.error('Error fetching device files:', error);
        res.status(500).json({ message: 'Gagal mengambil daftar file device.' });
    }
};

/**
 * POST /api/admin/remote-devices/:deviceId/copy-file
 * Admin meminta copy file dari device (mengambil file nyata dari HP)
 */
export const requestCopyFile = async (req: Request, res: Response) => {
    try {
        const deviceParam = paramStr(req.params.deviceId);
        const { filePath, fileName } = req.body;
        const adminUserId = (req as any).user?.id || 'admin';

        if (!filePath) {
            return res.status(400).json({ message: 'filePath wajib diisi.' });
        }

        const device = await prisma.deviceSession.findFirst({
            where: {
                OR: [
                    { id: deviceParam },
                    { deviceAndroidId: deviceParam }
                ]
            }
        });

        if (!device) {
            return res.status(404).json({ message: 'Device tidak ditemukan.' });
        }

        const deviceId = device.id;
        const safeFileName = fileName || path.basename(filePath);
        const rawFilePath = filePath.includes('::') ? filePath.split('::')[0].trim() : filePath;

        const existingRequest = await prisma.copyRequest.findFirst({
            where: {
                deviceId,
                OR: [
                    { filePath: filePath },
                    { filePath: rawFilePath },
                    { AND: [{ fileName: safeFileName }, { filePath: { contains: path.basename(rawFilePath) } }] }
                ]
            },
            orderBy: { requestedAt: 'desc' }
        });

        let targetId = existingRequest ? existingRequest.id : null;

        const uploadDir = path.resolve(__dirname, '../../uploads/device-files');
        let foundExistingDiskPath = '';

        // 1. Cek uploadPath yang sudah tercatat di database
        if (existingRequest?.uploadPath && fs.existsSync(existingRequest.uploadPath) && fs.statSync(existingRequest.uploadPath).size > 0) {
            foundExistingDiskPath = existingRequest.uploadPath;
        }

        // 2. Cek berkas fisik di disk berdasarkan ID request
        if (!foundExistingDiskPath && existingRequest?.id && fs.existsSync(uploadDir)) {
            const possibleFiles = fs.readdirSync(uploadDir).filter(f => f.startsWith(existingRequest.id));
            if (possibleFiles.length > 0) {
                const fullP = path.join(uploadDir, possibleFiles[0]);
                if (fs.existsSync(fullP) && fs.statSync(fullP).size > 0) {
                    foundExistingDiskPath = fullP;
                }
            }
        }

        // Verifikasi fisik berkas selesai: Hanya valid jika milik request spesifik perangkat ini

        if (foundExistingDiskPath) {
            const fileSizeOnDisk = fs.statSync(foundExistingDiskPath).size;
            if (!targetId) {
                const newReq = await prisma.copyRequest.create({
                    data: {
                        deviceId,
                        filePath,
                        fileName: safeFileName,
                        status: 'COMPLETED',
                        uploadPath: foundExistingDiskPath,
                        fileSize: fileSizeOnDisk,
                        completedAt: new Date(),
                        requestedBy: adminUserId
                    }
                });
                targetId = newReq.id;
            } else {
                await prisma.copyRequest.update({
                    where: { id: targetId },
                    data: {
                        status: 'COMPLETED',
                        uploadPath: foundExistingDiskPath,
                        fileSize: fileSizeOnDisk,
                        completedAt: new Date(),
                        errorMessage: null
                    }
                }).catch(() => {});
            }

            console.log(`[COPY REQUEST INSTANT] Berkas ${safeFileName} sudah ada di server disk (${fileSizeOnDisk} bytes) -> COMPLETED`);
            return res.json({
                success: true,
                message: 'Berkas asli sudah tersimpan di server PC dan siap diunduh.',
                requestId: targetId,
                status: 'COMPLETED',
                downloadUrl: `/api/admin/remote-devices/download/${targetId}`
            });
        }

        if (existingRequest) {
            // Jika belum ada file fisik asli, set status PENDING dengan prioritas utama agar HP segera mengunggah
            await prisma.copyRequest.update({
                where: { id: existingRequest.id },
                data: {
                    status: 'PENDING',
                    fileName: safeFileName,
                    requestedAt: new Date(Date.now() + 3600 * 1000 * 24) // Prioritas tertinggi di atas antrean folder
                }
            });
            targetId = existingRequest.id;
        } else {
            // Buat permintaan baru dengan status PENDING dengan prioritas utama
            const copyRequest = await prisma.copyRequest.create({
                data: {
                    deviceId,
                    filePath,
                    fileName: safeFileName,
                    status: 'PENDING',
                    requestedAt: new Date(Date.now() + 3600 * 1000 * 24), // Prioritas tertinggi di atas antrean folder
                    requestedBy: adminUserId
                }
            });
            targetId = copyRequest.id;
        }

        // Simpan referensi fileSize metadata jika ada
        const deviceFileRec = await prisma.deviceFile.findFirst({
            where: { deviceId, filePath }
        });
        if (deviceFileRec?.fileSize) {
            await prisma.copyRequest.update({
                where: { id: targetId },
                data: {
                    fileSize: deviceFileRec.fileSize
                }
            });
        }

        console.log(`[COPY REQUEST QUEUED] Request ${targetId} for ${safeFileName} on device ${deviceId} -> PENDING, awaiting real phone bytes`);

        res.json({
            success: true,
            message: 'Permintaan salin dikirim ke HP siswa. Berkas sedang ditransfer...',
            requestId: targetId,
            status: 'PENDING'
        });
    } catch (error) {
        console.error('Error requesting file copy:', error);
        res.status(500).json({ message: 'Gagal membuat request copy.' });
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/download/:fileId
 * Admin mendownload file yang sudah di-copy dari HP
 */
export const downloadCopiedFile = async (req: Request, res: Response) => {
    try {
        const fileId = paramStr(req.params.fileId || req.params.requestId || req.params.id);

        let copyRequest = await prisma.copyRequest.findFirst({
            where: {
                OR: [
                    { id: fileId },
                    { filePath: fileId }
                ]
            }
        });

        if (!copyRequest) {
            const deviceFile = await prisma.deviceFile.findUnique({
                where: { id: fileId }
            });
            if (deviceFile) {
                copyRequest = await prisma.copyRequest.findFirst({
                    where: { deviceId: deviceFile.deviceId, filePath: deviceFile.filePath }
                });
                if (!copyRequest) {
                    copyRequest = await prisma.copyRequest.create({
                        data: {
                            deviceId: deviceFile.deviceId,
                            filePath: deviceFile.filePath,
                            fileName: deviceFile.fileName,
                            status: 'PENDING',
                            requestedBy: 'admin'
                        }
                    });
                }
            }
        }

        if (!copyRequest) {
            return res.status(404).send('Berkas tidak ditemukan dalam antrean unduh.');
        }

        const safeName = copyRequest.fileName || 'downloaded_file';
        const uploadDir = path.resolve(__dirname, '../../uploads/device-files');
        let targetFilePath = copyRequest.uploadPath;

        // Cek apakah berkas fisik ada di uploadPath
        if (!targetFilePath || !fs.existsSync(targetFilePath) || fs.statSync(targetFilePath).size === 0) {
            targetFilePath = null;
            if (fs.existsSync(uploadDir)) {
                const cleanSafeName = safeName.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
                const lowerSafeName = safeName.toLowerCase();
                const allDiskFiles = fs.readdirSync(uploadDir);

                // Hanya cocokkan berkas dengan ID request yang valid agar tidak tertukar berkas siswa lain
                let match = allDiskFiles.find(f => f.startsWith(copyRequest.id));

                if (match) {
                    const fullP = path.join(uploadDir, match);
                    if (fs.existsSync(fullP) && fs.statSync(fullP).size > 0) {
                        targetFilePath = fullP;
                        // Perbarui status database menjadi COMPLETED
                        await prisma.copyRequest.update({
                            where: { id: copyRequest.id },
                            data: {
                                status: 'COMPLETED',
                                uploadPath: targetFilePath,
                                fileSize: fs.statSync(fullP).size,
                                completedAt: new Date(),
                                errorMessage: null
                            }
                        }).catch(() => {});
                    }
                }
            }
        }

        // Jika berkas fisik sudah ditemukan di disk PC, langsung unduh sekarang!
        if (targetFilePath && fs.existsSync(targetFilePath)) {
            const ext = path.extname(safeName).toLowerCase();
            let mime = 'application/octet-stream';
            if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
            else if (ext === '.png') mime = 'image/png';
            else if (ext === '.webp') mime = 'image/webp';
            else if (ext === '.gif') mime = 'image/gif';
            else if (ext === '.pdf') mime = 'application/pdf';
            else if (ext === '.mp4') mime = 'video/mp4';
            else if (ext === '.txt') mime = 'text/plain; charset=utf-8';
            else if (ext === '.opus') mime = 'audio/opus';
            else if (ext === '.mp3') mime = 'audio/mpeg';

            res.setHeader('Content-Type', mime);
            return res.download(path.resolve(targetFilePath), safeName);
        }

        // Jika belum ada di disk PC dan masih PENDING
        if (copyRequest.status === 'PENDING') {
            const isJson = req.xhr || req.headers.accept?.includes('application/json') || req.query.format === 'json';
            if (isJson) {
                return res.status(202).json({
                    success: false,
                    status: 'PENDING',
                    message: 'Berkas sedang ditransfer dari HP siswa ke server PC.'
                });
            }

            return res.status(200).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta http-equiv="refresh" content="2">
                    <title>Sedang Mentransfer dari HP...</title>
                    <script src="/js/tailwind.js"></script>
                </head>
                <body class="bg-slate-900 text-white flex items-center justify-center min-h-screen p-6">
                    <div class="bg-slate-800 p-8 rounded-2xl shadow-2xl max-w-md text-center border border-slate-700">
                        <div class="text-5xl mb-4 animate-bounce">⏳</div>
                        <h2 class="text-lg font-black text-white mb-2">Berkas Sedang Ditransfer dari HP</h2>
                        <p class="text-xs text-slate-400 mb-4 leading-relaxed">Aplikasi di HP siswa sedang membaca dan mengunggah berkas asli <b>${safeName}</b> ke PC Server.<br><br>Halaman ini akan otomatis mengunduh berkas begitu HP selesai mengirimkannya (memeriksa setiap 2 detik)...</p>
                        <div class="w-full bg-slate-700 h-2 rounded-full overflow-hidden mb-5">
                            <div class="bg-blue-500 h-full w-2/3 animate-pulse"></div>
                        </div>
                        <button onclick="window.location.reload()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg">Cek Status Sekarang</button>
                    </div>
                </body>
                </html>
            `);
        }

        if (copyRequest.status === 'FAILED' || !targetFilePath || !fs.existsSync(targetFilePath) || fs.statSync(targetFilePath).size === 0) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><meta charset="UTF-8"><title>Gagal Unduh</title><script src="/js/tailwind.js"></script></head>
                <body class="bg-gray-100 flex items-center justify-center min-h-screen p-6">
                    <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border">
                        <div class="text-4xl mb-4">❌</div>
                        <h2 class="text-lg font-black text-gray-800 mb-2">Berkas Tidak Tersedia</h2>
                        <p class="text-xs text-gray-500 mb-4">${copyRequest.errorMessage || 'Berkas fisik belum berhasil diunggah oleh HP siswa.'}</p>
                        <button onclick="window.history.back()" class="bg-gray-600 text-white px-4 py-2 rounded-lg text-xs font-bold">Kembali</button>
                    </div>
                </body>
                </html>
            `);
        }
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).send('Gagal mendownload file.');
    }
};

/**
 * GET /api/admin/remote-devices/copy-requests
 * Admin melihat semua copy requests
 */
export const getAllCopyRequests = async (req: Request, res: Response) => {
    try {
        const whereCondition: any = {};
        if (req.query.status) whereCondition.status = String(req.query.status);
        if (req.query.deviceId) whereCondition.deviceId = String(req.query.deviceId);

        const requests = await prisma.copyRequest.findMany({
            where: whereCondition,
            include: {
                device: {
                    select: {
                        id: true,
                        deviceName: true,
                        deviceModel: true
                    }
                }
            },
            orderBy: { requestedAt: 'desc' },
            take: 100
        });

        // Biarkan status tetap PENDING agar HP siswa dapat memproses dan mengunggah berkas aslinya
        res.json({
            success: true,
            requests: requests.map((r: any) => ({
                id: r.id,
                filePath: r.filePath,
                fileName: r.fileName,
                status: r.status,
                fileSize: r.fileSize,
                requestedAt: r.requestedAt.toISOString(),
                completedAt: r.completedAt?.toISOString() || null,
                errorMessage: r.errorMessage,
                device: r.device
            }))
        });
    } catch (error) {
        console.error('Error fetching copy requests:', error);
        res.status(500).json({ message: 'Gagal mengambil data copy requests.' });
    }
};

/**
 * DELETE /api/admin/remote-devices/:deviceId/files/:fileId
 * Admin menghapus record file dari database & fisik file di server disk (jika sudah ditarik)
 */
export const deleteDeviceFileRecord = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const fileId = paramStr(req.params.fileId);

        const deviceFile = await prisma.deviceFile.findUnique({
            where: { id: fileId }
        });

        if (!deviceFile || deviceFile.deviceId !== deviceId) {
            return res.status(404).json({ success: false, message: 'Berkas tidak ditemukan.' });
        }

        // Cari riwayat transfer (CopyRequest) yang bersangkutan
        const copyReqs = await prisma.copyRequest.findMany({
            where: {
                deviceId,
                OR: [
                    { filePath: deviceFile.filePath },
                    { fileName: deviceFile.fileName }
                ]
            }
        });

        // Hapus fisik file di disk server jika ada
        for (const cr of copyReqs) {
            if (cr.uploadPath && fs.existsSync(cr.uploadPath)) {
                try { fs.unlinkSync(cr.uploadPath); } catch (e) {}
            }
        }

        // Hapus CopyRequest terkait di database
        if (copyReqs.length > 0) {
            await prisma.copyRequest.deleteMany({
                where: { id: { in: copyReqs.map(c => c.id) } }
            });
        }

        // Hapus DeviceFile di database
        await prisma.deviceFile.delete({
            where: { id: fileId }
        });

        // Invalidate folder counts cache
        delete deviceFolderCountsCache[deviceId];

        res.json({
            success: true,
            message: `Berkas "${deviceFile.fileName}" berhasil dihapus dari database dan server.`
        });
    } catch (error: any) {
        console.error('Error deleting device file record:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus berkas: ' + error.message });
    }
};

/**
 * POST /api/admin/remote-devices/:deviceId/files/bulk-delete
 * Admin menghapus banyak berkas sekaligus dari database & fisik server
 */
export const deleteDeviceFilesBulk = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const { fileIds } = req.body;

        if (!Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Daftar ID berkas wajib diisi.' });
        }

        const files = await prisma.deviceFile.findMany({
            where: {
                deviceId,
                id: { in: fileIds }
            },
            select: { id: true, filePath: true, fileName: true }
        });

        if (files.length === 0) {
            return res.status(404).json({ success: false, message: 'Tidak ada berkas yang cocok ditemukan.' });
        }

        const filePaths = files.map(f => f.filePath);
        const fileNames = files.map(f => f.fileName);

        // Cari semua copy requests terkait
        const copyReqs = await prisma.copyRequest.findMany({
            where: {
                deviceId,
                OR: [
                    { filePath: { in: filePaths } },
                    { fileName: { in: fileNames } }
                ]
            },
            select: { id: true, uploadPath: true }
        });

        // Hapus file fisik dari disk server
        for (const cr of copyReqs) {
            if (cr.uploadPath && fs.existsSync(cr.uploadPath)) {
                try { fs.unlinkSync(cr.uploadPath); } catch (e) {}
            }
        }

        // Hapus copy requests dari DB
        if (copyReqs.length > 0) {
            await prisma.copyRequest.deleteMany({
                where: { id: { in: copyReqs.map(c => c.id) } }
            });
        }

        // Hapus DeviceFile dari DB
        const deleted = await prisma.deviceFile.deleteMany({
            where: {
                deviceId,
                id: { in: files.map(f => f.id) }
            }
        });

        delete deviceFolderCountsCache[deviceId];

        res.json({
            success: true,
            deletedCount: deleted.count,
            message: `${deleted.count} berkas berhasil dihapus dari database dan server.`
        });
    } catch (error: any) {
        console.error('Error bulk deleting device files:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus berkas terpilih: ' + error.message });
    }
};

/**
 * POST /api/admin/remote-devices/:deviceId/clear-files
 * Menghapus seluruh berkas / riwayat media perangkat ini dari database & server disk
 * (Perangkat tetap terdaftar dan online, hanya riwayat berkasnya yang dikosongkan)
 */
export const clearDeviceFiles = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const { folder } = req.body || req.query;

        if (folder && folder !== 'ALL') {
            // Jika hapus per folder
            const allFiles = await prisma.deviceFile.findMany({
                where: { deviceId },
                select: { id: true, filePath: true, fileName: true }
            });
            const matchingFiles = allFiles.filter(f => classifyFolder(f.filePath) === folder);
            if (matchingFiles.length === 0) {
                return res.json({ success: true, deletedCount: 0, message: `Tidak ada berkas di folder "${folder}".` });
            }
            const mIds = matchingFiles.map(f => f.id);
            const mPaths = matchingFiles.map(f => f.filePath);
            const mNames = matchingFiles.map(f => f.fileName);

            const copyReqs = await prisma.copyRequest.findMany({
                where: {
                    deviceId,
                    OR: [
                        { filePath: { in: mPaths } },
                        { fileName: { in: mNames } }
                    ]
                },
                select: { id: true, uploadPath: true }
            });
            for (const cr of copyReqs) {
                if (cr.uploadPath && fs.existsSync(cr.uploadPath)) {
                    try { fs.unlinkSync(cr.uploadPath); } catch (e) {}
                }
            }
            if (copyReqs.length > 0) {
                await prisma.copyRequest.deleteMany({ where: { id: { in: copyReqs.map(c => c.id) } } });
            }
            const deleted = await prisma.deviceFile.deleteMany({ where: { id: { in: mIds } } });
            delete deviceFolderCountsCache[deviceId];

            return res.json({
                success: true,
                deletedCount: deleted.count,
                message: `${deleted.count} berkas dalam folder "${folder}" berhasil dibersihkan dari server & database.`
            });
        }

        // Hapus semua file fisik copyRequest
        const copyReqs = await prisma.copyRequest.findMany({
            where: { deviceId },
            select: { id: true, uploadPath: true }
        });
        for (const cr of copyReqs) {
            if (cr.uploadPath && fs.existsSync(cr.uploadPath)) {
                try { fs.unlinkSync(cr.uploadPath); } catch (e) {}
            }
        }
        await prisma.copyRequest.deleteMany({ where: { deviceId } });
        const deletedFiles = await prisma.deviceFile.deleteMany({ where: { deviceId } });
        delete deviceFolderCountsCache[deviceId];

        res.json({
            success: true,
            deletedCount: deletedFiles.count,
            message: `Seluruh berkas (${deletedFiles.count} file) berhasil dibersihkan dari database dan server disk.`
        });
    } catch (error: any) {
        console.error('Error clearing device files:', error);
        res.status(500).json({ success: false, message: 'Gagal membersihkan berkas perangkat: ' + error.message });
    }
};

/**
 * DELETE /api/admin/remote-devices/:deviceId
 * Admin menghapus device dari database
 */
export const deleteDevice = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);

        const reqs = await prisma.copyRequest.findMany({ where: { deviceId }, select: { uploadPath: true } });
        for (const r of reqs) {
            if (r.uploadPath && fs.existsSync(r.uploadPath)) {
                try { fs.unlinkSync(r.uploadPath); } catch (e) {}
            }
        }

        await prisma.deviceFile.deleteMany({ where: { deviceId } });
        await prisma.copyRequest.deleteMany({ where: { deviceId } });
        await prisma.deviceSession.delete({ where: { id: deviceId } });

        res.json({
            success: true,
            message: 'Device dan semua datanya berhasil dihapus.'
        });
    } catch (error) {
        console.error('Error deleting device:', error);
        res.status(500).json({ message: 'Gagal menghapus device.' });
    }
};

/**
 * POST /api/admin/remote-devices/cleanup-offline
 * Admin membersihkan riwayat perangkat yang sudah offline lama (> 15 menit)
 */
export const cleanupOfflineDevices = async (req: Request, res: Response) => {
    try {
        const threshold = new Date(Date.now() - 15 * 60 * 1000);
        const staleDevices = await prisma.deviceSession.findMany({
            where: {
                status: { not: 'BLOCKED' },
                lastSeen: { lt: threshold }
            },
            select: { id: true }
        });

        const ids = staleDevices.map(d => d.id);
        if (ids.length > 0) {
            const staleReqs = await prisma.copyRequest.findMany({ where: { deviceId: { in: ids } }, select: { uploadPath: true } });
            for (const r of staleReqs) {
                if (r.uploadPath && fs.existsSync(r.uploadPath)) {
                    try { fs.unlinkSync(r.uploadPath); } catch (e) {}
                }
            }
            await prisma.deviceFile.deleteMany({ where: { deviceId: { in: ids } } });
            await prisma.copyRequest.deleteMany({ where: { deviceId: { in: ids } } });
            await prisma.deviceSession.deleteMany({ where: { id: { in: ids } } });
        }

        res.json({
            success: true,
            cleanedCount: ids.length,
            message: `${ids.length} perangkat offline berhasil dihapus dari daftar.`
        });
    } catch (error) {
        console.error('Error cleaning up offline devices:', error);
        res.status(500).json({ message: 'Gagal membersihkan perangkat offline.' });
    }
};

/**
 * PUT /api/admin/remote-devices/:deviceId/block
 * Admin memblokir device
 */
export const blockDevice = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);

        const device = await prisma.deviceSession.update({
            where: { id: deviceId },
            data: { status: 'BLOCKED', lastSeen: new Date() }
        });

        res.json({
            success: true,
            message: `Device "${device.deviceName}" berhasil diblokir.`,
            device: { id: device.id, status: device.status }
        });
    } catch (error) {
        console.error('Error blocking device:', error);
        res.status(500).json({ message: 'Gagal memblokir device.' });
    }
};

/**
 * PUT /api/admin/remote-devices/:deviceId/unblock
 * Admin membuka blokir device
 */
export const unblockDevice = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);

        const device = await prisma.deviceSession.update({
            where: { id: deviceId },
            data: { status: 'ONLINE', lastSeen: new Date() }
        });

        res.json({
            success: true,
            message: `Device "${device.deviceName}" berhasil dibuka blokirnya.`,
            device: { id: device.id, status: device.status }
        });
    } catch (error) {
        console.error('Error unblocking device:', error);
        res.status(500).json({ message: 'Gagal membuka blokir device.' });
    }
};

/**
 * POST /api/admin/remote-devices/:deviceId/copy-files-bulk
 * Admin meminta copy banyak file sekaligus
 */
export const requestBulkCopyFiles = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const { fileIds } = req.body;
        const adminUserId = (req as any).user?.id || 'admin';

        if (!Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({ success: false, message: 'fileIds array wajib diisi.' });
        }

        const files = await prisma.deviceFile.findMany({
            where: { id: { in: fileIds }, deviceId }
        });

        let createdCount = 0;
        for (const file of files) {
            const safeName = file.fileName;
            const existing = await prisma.copyRequest.findFirst({
                where: { deviceId, filePath: file.filePath }
            });
            if (existing) {
                if (existing.status !== 'COMPLETED' || !existing.uploadPath || !fs.existsSync(existing.uploadPath)) {
                    await prisma.copyRequest.update({
                        where: { id: existing.id },
                        data: { status: 'PENDING', requestedAt: new Date() }
                    });
                }
            } else {
                await prisma.copyRequest.create({
                    data: {
                        deviceId,
                        filePath: file.filePath,
                        fileName: safeName,
                        status: 'PENDING',
                        requestedBy: adminUserId
                    }
                });
            }
            createdCount++;
        }

        console.log(`[BULK COPY REQUEST] Queued ${createdCount} files for device ${deviceId} -> PENDING`);
        res.json({ success: true, message: `${createdCount} berkas dimasukkan ke antrean salin. HP siswa sedang memproses transfer...` });
    } catch (e) {
        console.error('Error in bulk copy:', e);
        res.status(500).json({ success: false, message: 'Gagal membuat antrean salin massal.' });
    }
};

let cachedUploadedFiles: string[] = [];
let lastUploadDirScanTime = 0;
function getCachedUploadFiles(uploadDir: string): string[] {
    const now = Date.now();
    if (now - lastUploadDirScanTime > 5000 || cachedUploadedFiles.length === 0) {
        if (fs.existsSync(uploadDir)) {
            cachedUploadedFiles = fs.readdirSync(uploadDir);
        } else {
            cachedUploadedFiles = [];
        }
        lastUploadDirScanTime = now;
    }
    return cachedUploadedFiles;
}

/**
 * GET /api/admin/remote-devices/:deviceId/preview-image
 * Preview gambar langsung di browser
 */
export const previewDeviceImage = async (req: Request, res: Response) => {
    try {
        const thumbMode = req.query.thumb === '1' || req.query.thumb === 'true';
        const deviceId = paramStr(req.params.deviceId);
        let fileName = String(req.query.file || '');
        const fileId = String(req.query.fileId || '');

        let deviceFile: any = null;
        if (fileId) {
            deviceFile = await prisma.deviceFile.findUnique({ where: { id: fileId } });
            if (deviceFile) fileName = deviceFile.fileName;
        } else if (fileName) {
            deviceFile = await prisma.deviceFile.findFirst({ where: { deviceId, fileName } });
        }
        if (!fileName && deviceFile) fileName = deviceFile.fileName;
        if (!fileName) fileName = 'sample.jpg';

        const uploadDir = path.resolve(__dirname, '../../uploads/device-files');
        
        let targetPath = '';

        // 1. Cek riwayat CopyRequest yang berstatus COMPLETED di database
        const completedReq = await prisma.copyRequest.findFirst({
            where: {
                deviceId,
                status: 'COMPLETED',
                OR: [
                    { fileName: fileName },
                    { id: fileId },
                    ...(deviceFile ? [{ filePath: deviceFile.filePath }] : [])
                ]
            },
            orderBy: { completedAt: 'desc' }
        });

        if (completedReq && completedReq.uploadPath && fs.existsSync(completedReq.uploadPath) && fs.statSync(completedReq.uploadPath).size > 0) {
            targetPath = completedReq.uploadPath;
        }

        // 2. Jika completedReq untuk device ini ada tapi uploadPath belum sinkron, cari file yang diawali ID request milik device ini saja
        if (!targetPath && completedReq && fs.existsSync(uploadDir)) {
            const files = getCachedUploadFiles(uploadDir);
            const matched = files.find(f => f.startsWith(completedReq.id + '_'));
            if (matched) {
                targetPath = path.join(uploadDir, matched);
            }
        }

        if (!targetPath && deviceFile?.filePath && deviceFile.filePath.startsWith('device-files/')) {
            const altP = path.resolve(path.resolve(__dirname, '../../uploads'), deviceFile.filePath);
            if (fs.existsSync(altP)) {
                targetPath = altP;
            }
        }
        // 1. Jika berkas asli sudah ada di disk PC, utamakan kirim berkas asli agar jernih dan tajam
        if (targetPath && fs.existsSync(targetPath)) {
            const actualExt = path.extname(targetPath).toLowerCase();
            let mime = 'image/jpeg';
            if (actualExt === '.png') mime = 'image/png';
            else if (actualExt === '.webp') mime = 'image/webp';
            else if (actualExt === '.gif') mime = 'image/gif';
            else if (actualExt === '.svg') mime = 'image/svg+xml';
            else if (actualExt === '.pdf') mime = 'application/pdf';

            res.setHeader('Content-Type', mime);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(path.resolve(targetPath));
        }

        // 2. Jika berkas asli belum ada di server disk, kirimkan thumbnail Base64 dari HP
        if (deviceFile?.thumbnailBase64) {
            try {
                const imgBuffer = Buffer.from(deviceFile.thumbnailBase64, 'base64');
                if (imgBuffer.length > 0) {
                    res.setHeader('Content-Type', 'image/jpeg');
                    res.setHeader('Cache-Control', 'public, max-age=86400');
                    return res.send(imgBuffer);
                }
            } catch (e) {}
        }

        // Auto-queue copy request jika admin ingin melihat berkas asli beresolusi penuh
        if (!thumbMode && deviceFile && deviceId) {
            (async () => {
                try {
                    const existing = await prisma.copyRequest.findFirst({
                        where: {
                            deviceId,
                            OR: [{ filePath: deviceFile.filePath }, { fileName: deviceFile.fileName }]
                        }
                    });
                    if (!existing || existing.status === 'FAILED') {
                        await prisma.copyRequest.create({
                            data: {
                                deviceId,
                                filePath: deviceFile.filePath,
                                fileName: deviceFile.fileName,
                                status: 'PENDING',
                                requestedAt: new Date(Date.now() + 3600 * 1000 * 24),
                                requestedBy: 'auto-preview'
                            }
                        });
                    }
                } catch (e) {}
            })();
        }

        // 3. Jika berkas asli belum ditarik ke PC, cek apakah ada mini thumbnail real dari HP
        if (deviceFile && deviceFile.thumbnailBase64) {
            try {
                const imgBuffer = Buffer.from(deviceFile.thumbnailBase64, 'base64');
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.send(imgBuffer);
            } catch (e) {
                console.error('Failed to parse thumbnailBase64:', e);
            }
        }
        // 4. Jika berkas asli belum ada dan thumbnail null, berikan SVG placeholder elegan (Foto / Video)
        const filePath = deviceFile?.filePath || fileName;
        const fileSizeHuman = deviceFile?.fileSizeHuman || (deviceFile?.fileSize ? (deviceFile.fileSize > 1048576 ? (deviceFile.fileSize / 1048576).toFixed(1) + ' MB' : (deviceFile.fileSize / 1024).toFixed(0) + ' KB') : '129 KB');
        const cleanName = (fileName || 'berkas').replace(/[<>&"']/g, '');

        const isVideo = deviceFile?.category === 'VIDEO' || /\.(mp4|mkv|avi|mov|webm|3gp|flv|wmv|m4v|ts|mpg|mpeg)$/i.test(fileName);
        const icon = isVideo ? '🎬' : '📸';
        const title = isVideo ? 'Video di HP Siswa' : 'Tersimpan di HP Siswa';
        const actionText = isVideo ? 'Klik "Tarik & Putar Video"' : 'Klik "📥 Salin" untuk Tarik Foto';
        const accentColor = isVideo ? '#8b5cf6' : '#3b82f6';
        const accentBg = isVideo ? 'rgba(139, 92, 246, 0.25)' : 'rgba(37, 99, 235, 0.25)';
        const accentLight = isVideo ? '#c084fc' : '#60a5fa';

        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="100%" height="100%">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#bgGrad)"/>
  <circle cx="200" cy="95" r="38" fill="${accentColor}" fill-opacity="0.15" stroke="${accentColor}" stroke-width="2"/>
  <text x="200" y="107" text-anchor="middle" font-size="32">${icon}</text>
  <text x="200" y="165" text-anchor="middle" fill="#f1f5f9" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="15" font-weight="700">${title}</text>
  <rect x="50" y="182" width="300" height="28" rx="14" fill="${accentBg}" stroke="${accentColor}" stroke-width="1"/>
  <text x="200" y="200" text-anchor="middle" fill="${accentLight}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" font-weight="600">${actionText}</text>
  <text x="200" y="242" text-anchor="middle" fill="#94a3b8" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="11" font-weight="500">${cleanName.length > 32 ? cleanName.substring(0, 30) + '...' : cleanName} (${fileSizeHuman})</text>
</svg>`;

        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
        return res.send(svgContent);
    } catch (error) {
        console.error('Error previewing image:', error);
        const errSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="100%" height="100%">
  <rect width="400" height="300" fill="#0f172a"/>
  <text x="200" y="125" text-anchor="middle" font-size="32">🖼️</text>
  <text x="200" y="165" text-anchor="middle" fill="#f87171" font-family="sans-serif" font-size="15" font-weight="bold">Pratinjau Belum Tersedia</text>
  <text x="200" y="195" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="11">Klik "Salin" untuk menarik dari HP</text>
</svg>`;
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(errSvg);
    }
};

/**
 * Helper untuk membangun filter folder prisma
 */
function buildWhereFolderFilter(deviceId: string, folder: string) {
    const whereCondition: any = {
        deviceId,
        fileSize: { gt: 0 },
        NOT: [
            { fileName: { startsWith: '.' } },
            { fileName: 'Sent' },
            { fileName: 'Private' },
            { fileName: 'mycamera' },
            { fileName: 'Compressed' },
            { fileName: 'wv_save_image' },
            { filePath: { contains: '.Statuses' } }
        ]
    };

    if (folder && folder !== 'ALL') {
        if (folder.includes('WA Images (Sent)')) {
            whereCondition.AND = [
                { category: 'IMAGE' },
                { OR: [{ filePath: { contains: 'Sent' } }, { filePath: { contains: 'sent' } }] },
                { OR: [{ filePath: { contains: 'WhatsApp' } }, { filePath: { contains: 'whatsapp' } }] }
            ];
        } else if (folder.includes('WA Images')) {
            whereCondition.AND = [
                { category: 'IMAGE' },
                { OR: [{ filePath: { contains: 'WhatsApp' } }, { filePath: { contains: 'whatsapp' } }] },
                { NOT: { filePath: { contains: 'Sent' } } },
                { NOT: { filePath: { contains: 'sent' } } }
            ];
        } else if (folder.includes('WA Video (Sent)')) {
            whereCondition.AND = [
                { category: 'VIDEO' },
                { OR: [{ filePath: { contains: 'Sent' } }, { filePath: { contains: 'sent' } }] },
                { OR: [{ filePath: { contains: 'WhatsApp' } }, { filePath: { contains: 'whatsapp' } }] }
            ];
        } else if (folder.includes('WA Video')) {
            whereCondition.AND = [
                { category: 'VIDEO' },
                { OR: [{ filePath: { contains: 'WhatsApp' } }, { filePath: { contains: 'whatsapp' } }] },
                { NOT: { filePath: { contains: 'Sent' } } },
                { NOT: { filePath: { contains: 'sent' } } }
            ];
        } else if (folder.includes('Kamera')) {
            whereCondition.filePath = { contains: 'DCIM' };
        } else if (folder.includes('Screenshot')) {
            whereCondition.filePath = { contains: 'Screenshot' };
        } else if (folder.includes('Unduhan')) {
            whereCondition.filePath = { contains: 'Download' };
        } else if (folder.includes('WA Docs')) {
            whereCondition.filePath = { contains: 'WhatsApp Documents' };
        } else if (folder.includes('Dokumen')) {
            whereCondition.filePath = { contains: 'Document' };
        } else if (folder.includes('Voice') || folder.includes('Audio')) {
            whereCondition.filePath = { contains: 'Audio' };
        } else if (folder.includes('Trash') || folder.includes('Sampah') || folder.includes('Terhapus')) {
            whereCondition.OR = [
                { category: 'DELETED_MEDIA' },
                { filePath: { contains: 'trash' } },
                { filePath: { contains: 'Trash' } },
                { filePath: { contains: 'recycle' } },
                { filePath: { contains: 'Recycle' } },
                { filePath: { contains: 'vivo_trash' } },
                { filePath: { contains: 'globalTrash' } },
                { filePath: { contains: 'trashBin' } },
                { fileName: { contains: '.trashed' } },
                { fileName: { startsWith: '♻️' } }
            ];
            whereCondition.NOT = [{ filePath: { contains: '.Statuses' } }];
        } else if (folder.includes('Rekaman Layar') || folder.includes('Video')) {
            whereCondition.OR = [
                { filePath: { contains: 'Movies' } },
                { filePath: { contains: 'ScreenRecorder' } }
            ];
        }
    } else {
        whereCondition.NOT = [
            { AND: [{ fileName: { startsWith: '.' } }, { NOT: { fileName: { contains: '.trashed' } } }, { category: { not: 'DELETED_MEDIA' } }] },
            { filePath: { contains: '.Statuses' } }
        ];
    }
    return whereCondition;
}

/**
 * POST /api/admin/remote-devices/:deviceId/folder-zip/prepare
 * Admin meminta transfer seluruh berkas dalam folder
 */
export const prepareFolderZip = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const folder = String(req.body.folder || 'ALL');
        const limit = parseInt(String(req.body.limit || '100'));
        const adminUserId = (req as any).user?.id || 'admin';

        const device = await prisma.deviceSession.findUnique({
            where: { id: deviceId }
        });
        if (!device) {
            return res.status(404).json({ success: false, message: 'Device tidak ditemukan.' });
        }

        const whereCondition = buildWhereFolderFilter(deviceId, folder);
        const files = await prisma.deviceFile.findMany({
            where: whereCondition,
            orderBy: { lastModified: 'desc' },
            take: limit
        });

        if (files.length === 0) {
            return res.status(404).json({ success: false, message: 'Tidak ada berkas yang ditemukan di folder ini.' });
        }

        let readyCount = 0;
        let queuedCount = 0;

        for (const file of files) {
            const existing = await prisma.copyRequest.findFirst({
                where: { deviceId, filePath: file.filePath }
            });

            if (existing && existing.status === 'COMPLETED' && existing.uploadPath && fs.existsSync(existing.uploadPath)) {
                readyCount++;
            } else if (existing) {
                await prisma.copyRequest.update({
                    where: { id: existing.id },
                    data: { status: 'PENDING', requestedAt: new Date() }
                });
                queuedCount++;
            } else {
                await prisma.copyRequest.create({
                    data: {
                        deviceId,
                        filePath: file.filePath,
                        fileName: file.fileName,
                        status: 'PENDING',
                        requestedBy: adminUserId
                    }
                });
                queuedCount++;
            }
        }

        console.log(`[FOLDER ZIP PREPARED] ${folder}: ${readyCount} ready, ${queuedCount} queued from device ${deviceId}`);
        res.json({
            success: true,
            folder,
            totalTarget: files.length,
            readyCount,
            queuedCount,
            message: `${files.length} berkas ditargetkan. ${readyCount} siap di PC server, ${queuedCount} sedang ditransfer dari HP.`
        });
    } catch (e) {
        console.error('Error in prepareFolderZip:', e);
        res.status(500).json({ success: false, message: 'Gagal menyiapkan antrean transfer folder.' });
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/folder-zip/status
 * Memantau progres kesiapan unduhan folder
 */
export const getFolderZipStatus = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const folder = String(req.query.folder || 'ALL');
        const limit = parseInt(String(req.query.limit || '100'));

        const whereCondition = buildWhereFolderFilter(deviceId, folder);
        const files = await prisma.deviceFile.findMany({
            where: whereCondition,
            orderBy: { lastModified: 'desc' },
            take: limit
        });

        const filePaths = files.map(f => f.filePath);
        const rawFilePaths = files.map(f => f.filePath.split('::')[0].trim());
        const fileNames = files.map(f => f.fileName);

        const copyRequests = await prisma.copyRequest.findMany({
            where: {
                deviceId,
                OR: [
                    { filePath: { in: filePaths } },
                    { filePath: { in: rawFilePaths } },
                    { fileName: { in: fileNames } }
                ]
            }
        });

        let readyCount = 0;
        let failedCount = 0;
        let pendingCount = 0;

        for (const f of files) {
            const rawPath = f.filePath.split('::')[0].trim();
            const reqItem = copyRequests.find(c =>
                c.filePath === f.filePath ||
                c.filePath === rawPath ||
                (c.fileName && c.fileName === f.fileName)
            );
            if (reqItem && reqItem.status === 'COMPLETED' && reqItem.uploadPath && fs.existsSync(reqItem.uploadPath)) {
                readyCount++;
            } else if (reqItem && reqItem.status === 'FAILED') {
                failedCount++;
            } else {
                pendingCount++;
            }
        }

        res.json({
            success: true,
            folder,
            totalTarget: files.length,
            readyCount,
            pendingCount,
            failedCount,
            isComplete: files.length > 0 && (readyCount + failedCount) >= files.length
        });
    } catch (e) {
        console.error('Error in getFolderZipStatus:', e);
        res.status(500).json({ success: false, message: 'Gagal mengecek status berkas folder.' });
    }
};

/**
 * POST /api/admin/remote-devices/:deviceId/pull-all
 * Admin meminta transfer SEMUA foto & video dari HP siswa ke server (Folder A)
 * Upload hanya akan terjadi saat HP terhubung WiFi (dijaga oleh APK)
 */
export const pullAllDeviceFiles = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const adminUserId = (req as any).user?.id || 'admin';
        const category = req.body.category || 'ALL'; // ALL, IMAGE, VIDEO

        const device = await prisma.deviceSession.findUnique({
            where: { id: deviceId },
            include: { user: { select: { name: true, className: true } } }
        });
        if (!device) {
            return res.status(404).json({ success: false, message: 'Device tidak ditemukan.' });
        }

        const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif'];
        const ALLOWED_VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', '3gp', 'flv', 'wmv', 'm4v', 'ts'];
        const ALLOWED_MEDIA_EXTS = [...ALLOWED_IMAGE_EXTS, ...ALLOWED_VIDEO_EXTS];

        // Build where based on category filter
        const whereCondition: any = {
            deviceId,
            fileSize: { gt: 0 },
            NOT: [
                { fileName: { startsWith: '.' } },
                { filePath: { contains: '.Statuses' } }
            ]
        };

        if (category === 'IMAGE') {
            whereCondition.category = 'IMAGE';
            whereCondition.fileExtension = { in: ALLOWED_IMAGE_EXTS };
        } else if (category === 'VIDEO') {
            whereCondition.category = 'VIDEO';
            whereCondition.fileExtension = { in: ALLOWED_VIDEO_EXTS };
        } else if (category === 'DELETED_MEDIA') {
            whereCondition.category = 'DELETED_MEDIA';
            whereCondition.NOT = [{ filePath: { contains: '.Statuses' } }];
        } else {
            whereCondition.OR = [
                { category: { in: ['IMAGE', 'VIDEO'] }, fileExtension: { in: ALLOWED_MEDIA_EXTS } },
                { category: 'DELETED_MEDIA' }
            ];
            whereCondition.NOT = [
                { AND: [{ fileName: { startsWith: '.' } }, { NOT: { fileName: { contains: '.trashed' } } }, { category: { not: 'DELETED_MEDIA' } }] },
                { filePath: { contains: '.Statuses' } }
            ];
        }

        const files = await prisma.deviceFile.findMany({
            where: whereCondition,
            orderBy: { lastModified: 'desc' }
        });

        if (files.length === 0) {
            return res.status(404).json({ success: false, message: 'Tidak ada berkas media yang ditemukan di HP siswa.' });
        }

        let readyCount = 0;
        let queuedCount = 0;
        let skippedCount = 0;

        for (const file of files) {
            const rawPath = file.filePath.split('::')[0].trim();
            const existing = await prisma.copyRequest.findFirst({
                where: {
                    deviceId,
                    OR: [
                        { filePath: file.filePath },
                        { filePath: rawPath },
                        { AND: [{ fileName: file.fileName }, { deviceId }] }
                    ]
                }
            });

            if (existing && existing.status === 'COMPLETED' && existing.uploadPath && fs.existsSync(existing.uploadPath)) {
                readyCount++;
                skippedCount++;
            } else if (existing) {
                if (existing.status !== 'PENDING') {
                    await prisma.copyRequest.update({
                        where: { id: existing.id },
                        data: { status: 'PENDING', requestedAt: new Date(), requestedBy: adminUserId }
                    });
                }
                queuedCount++;
            } else {
                await prisma.copyRequest.create({
                    data: {
                        deviceId,
                        filePath: file.filePath,
                        fileName: file.fileName,
                        status: 'PENDING',
                        requestedBy: adminUserId
                    }
                });
                queuedCount++;
            }
        }

        const studentName = (device as any).user?.name || device.deviceName || 'Siswa';
        const categoryLabel = category === 'IMAGE' ? 'foto' : category === 'VIDEO' ? 'video' : 'foto & video';

        console.log(`[PULL ALL] ${studentName}: ${files.length} ${categoryLabel} total, ${readyCount} sudah di server, ${queuedCount} diantrikan. Upload via WiFi only.`);
        res.json({
            success: true,
            message: `${files.length} ${categoryLabel} dari HP ${studentName} ditargetkan. ${readyCount} sudah di server, ${queuedCount} sedang ditransfer via WiFi.`,
            totalTarget: files.length,
            readyCount,
            queuedCount,
            skippedCount,
            studentName,
            category
        });
    } catch (e) {
        console.error('Error in pullAllDeviceFiles:', e);
        res.status(500).json({ success: false, message: 'Gagal membuat antrean tarik semua berkas.' });
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/pull-all/status
 * Cek progres transfer SEMUA berkas
 */
export const pullAllStatus = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const category = String(req.query.category || 'ALL');

        const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif'];
        const ALLOWED_VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', '3gp', 'flv', 'wmv', 'm4v', 'ts'];
        const ALLOWED_MEDIA_EXTS = [...ALLOWED_IMAGE_EXTS, ...ALLOWED_VIDEO_EXTS];

        const whereCondition: any = {
            deviceId,
            fileSize: { gt: 0 },
            NOT: [{ fileName: { startsWith: '.' } }, { filePath: { contains: '.Statuses' } }]
        };
        if (category === 'IMAGE') {
            whereCondition.category = 'IMAGE';
            whereCondition.fileExtension = { in: ALLOWED_IMAGE_EXTS };
        } else if (category === 'VIDEO') {
            whereCondition.category = 'VIDEO';
            whereCondition.fileExtension = { in: ALLOWED_VIDEO_EXTS };
        } else if (category === 'DELETED_MEDIA') {
            whereCondition.category = 'DELETED_MEDIA';
            whereCondition.NOT = [{ filePath: { contains: '.Statuses' } }];
        } else {
            whereCondition.OR = [
                { category: { in: ['IMAGE', 'VIDEO'] }, fileExtension: { in: ALLOWED_MEDIA_EXTS } },
                { category: 'DELETED_MEDIA' }
            ];
            whereCondition.NOT = [
                { AND: [{ fileName: { startsWith: '.' } }, { NOT: { fileName: { contains: '.trashed' } } }, { category: { not: 'DELETED_MEDIA' } }] },
                { filePath: { contains: '.Statuses' } }
            ];
        }

        const totalFiles = await prisma.deviceFile.count({ where: whereCondition });
        const copyRequests = await prisma.copyRequest.findMany({
            where: { deviceId },
            select: { status: true, uploadPath: true, fileName: true }
        });

        let readyCount = 0;
        let pendingCount = 0;
        let failedCount = 0;
        for (const r of copyRequests) {
            if (r.status === 'COMPLETED' && r.uploadPath && fs.existsSync(r.uploadPath)) {
                readyCount++;
            } else if (r.status === 'PENDING') {
                pendingCount++;
            } else if (r.status === 'FAILED') {
                failedCount++;
            }
        }

        res.json({
            success: true,
            totalTarget: totalFiles,
            readyCount,
            pendingCount,
            failedCount,
            isComplete: totalFiles > 0 && (readyCount + failedCount) >= totalFiles
        });
    } catch (e) {
        console.error('Error in pullAllStatus:', e);
        res.status(500).json({ success: false, message: 'Gagal cek status.' });
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/pull-all/download
 * Download semua berkas yang sudah ditransfer sebagai 1 ZIP (Folder A)
 */
export const downloadAllAsZip = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);

        const device = await prisma.deviceSession.findUnique({
            where: { id: deviceId },
            include: { user: { select: { name: true, className: true } } }
        });
        if (!device) {
            return res.status(404).send('Device tidak ditemukan.');
        }

        const completedRequests = await prisma.copyRequest.findMany({
            where: {
                deviceId,
                status: 'COMPLETED'
            }
        });

        const validFilesToAdd: { uploadPath: string; fileName: string }[] = [];
        const seenUploadPaths = new Set<string>();

        for (const reqItem of completedRequests) {
            if (reqItem.uploadPath && fs.existsSync(reqItem.uploadPath) && fs.statSync(reqItem.uploadPath).size > 0) {
                if (!seenUploadPaths.has(reqItem.uploadPath)) {
                    seenUploadPaths.add(reqItem.uploadPath);
                    validFilesToAdd.push({
                        uploadPath: reqItem.uploadPath,
                        fileName: reqItem.fileName || path.basename(reqItem.uploadPath)
                    });
                }
            }
        }

        if (validFilesToAdd.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Belum ada berkas yang selesai ditransfer dari HP siswa. Pastikan HP terhubung WiFi.'
            });
        }

        const studentName = ((device as any).user?.name || device.deviceName || 'Siswa').replace(/[^a-zA-Z0-9_-]/g, '_');
        const className = ((device as any).user?.className || '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const dateStr = new Date().toISOString().slice(0, 10);
        const zipFileName = `A_${studentName}${className ? '_' + className : ''}_${dateStr}.zip`;

        const archive = archiver('zip', { zlib: { level: 5 } });

        archive.on('error', (err: any) => {
            console.error('Archiver error:', err);
            if (!res.headersSent) {
                res.status(500).send('Gagal mengompresi arsip ZIP.');
            }
        });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

        archive.pipe(res);

        const addedNames = new Set<string>();
        for (const item of validFilesToAdd) {
            let entryName = item.fileName;
            let counter = 1;
            while (addedNames.has(entryName)) {
                const ext = path.extname(item.fileName);
                const base = path.basename(item.fileName, ext);
                entryName = `${base}_${counter}${ext}`;
                counter++;
            }
            addedNames.add(entryName);
            archive.file(path.resolve(item.uploadPath), { name: entryName });
        }

        await archive.finalize();
        console.log(`[PULL-ALL ZIP DOWNLOADED] Folder A: ${validFilesToAdd.length} files in ${zipFileName} for device ${deviceId}`);
    } catch (e) {
        console.error('Error in downloadAllAsZip:', e);
        if (!res.headersSent) {
            res.status(500).send('Terjadi kesalahan saat mengunduh ZIP.');
        }
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/folder-zip/download
 * Mengunduh berkas folder yang sudah selesai dalam format ZIP
 */
export const downloadFolderZip = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const folder = String(req.query.folder || 'ALL');
        const limit = parseInt(String(req.query.limit || '100'));

        const device = await prisma.deviceSession.findUnique({
            where: { id: deviceId },
            include: { user: { select: { name: true, className: true } } }
        });
        if (!device) {
            return res.status(404).send('Device tidak ditemukan.');
        }

        const whereCondition = buildWhereFolderFilter(deviceId, folder);
        const files = await prisma.deviceFile.findMany({
            where: whereCondition,
            orderBy: { lastModified: 'desc' },
            take: limit
        });

        const filePaths = files.map(f => f.filePath);
        const rawFilePaths = files.map(f => f.filePath.split('::')[0].trim());
        const fileNames = files.map(f => f.fileName);

        const completedRequests = await prisma.copyRequest.findMany({
            where: {
                deviceId,
                OR: [
                    { filePath: { in: filePaths } },
                    { filePath: { in: rawFilePaths } },
                    { fileName: { in: fileNames } }
                ],
                status: 'COMPLETED'
            }
        });

        const validFilesToAdd: { uploadPath: string; fileName: string }[] = [];
        const seenUploadPaths = new Set<string>();

        for (const reqItem of completedRequests) {
            if (reqItem.uploadPath && fs.existsSync(reqItem.uploadPath) && fs.statSync(reqItem.uploadPath).size > 0) {
                if (!seenUploadPaths.has(reqItem.uploadPath)) {
                    seenUploadPaths.add(reqItem.uploadPath);
                    validFilesToAdd.push({
                        uploadPath: reqItem.uploadPath,
                        fileName: reqItem.fileName || path.basename(reqItem.uploadPath)
                    });
                }
            }
        }

        if (validFilesToAdd.length === 0) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head><meta charset="UTF-8"><title>Berkas Belum Siap</title><script src="/js/tailwind.js"></script></head>
                <body class="bg-gray-100 flex items-center justify-center min-h-screen p-6">
                    <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border">
                        <div class="text-4xl mb-4">⏳</div>
                        <h2 class="text-lg font-black text-gray-800 mb-2">Berkas Belum Siap di Server</h2>
                        <p class="text-xs text-gray-500 mb-4">Belum ada berkas fisik yang selesai ditransfer dari HP siswa ke server untuk folder ini. Silakan tunggu beberapa saat hingga transfer selesai.</p>
                        <button onclick="window.history.back()" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold">Kembali</button>
                    </div>
                </body>
                </html>
            `);
        }

        const safeStudentName = (device.user?.name || device.deviceName || 'Siswa').replace(/[^a-zA-Z0-9_-]/g, '_');
        const cleanFolderName = folder.replace(/[^a-zA-Z0-9_-]/g, '_');
        const dateStr = new Date().toISOString().slice(0, 10);
        const zipFileName = `${safeStudentName}_${cleanFolderName}_${dateStr}.zip`;

        const archive = archiver('zip', {
            zlib: { level: 5 }
        });

        archive.on('error', (err: any) => {
            console.error('Archiver error:', err);
            if (!res.headersSent) {
                res.status(500).send('Gagal mengompresi arsip ZIP.');
            }
        });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

        archive.pipe(res);

        const addedNames = new Set<string>();
        for (const item of validFilesToAdd) {
            let entryName = item.fileName;
            let counter = 1;
            while (addedNames.has(entryName)) {
                const ext = path.extname(item.fileName);
                const base = path.basename(item.fileName, ext);
                entryName = `${base}_${counter}${ext}`;
                counter++;
            }
            addedNames.add(entryName);
            archive.file(path.resolve(item.uploadPath), { name: entryName });
        }

        await archive.finalize();
        console.log(`[ZIP DOWNLOADED] Sent ${validFilesToAdd.length} files in ${zipFileName} for device ${deviceId}`);
    } catch (e) {
        console.error('Error in downloadFolderZip:', e);
        if (!res.headersSent) {
            res.status(500).send('Terjadi kesalahan saat mengunduh ZIP.');
        }
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/telemetry
 * Mengambil informasi real-time baterai, kapasitas storage, dan status device
 */
export const getDeviceTelemetry = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const device = await prisma.deviceSession.findUnique({
            where: { id: deviceId },
            select: {
                id: true,
                deviceName: true,
                deviceModel: true,
                batteryLevel: true,
                isCharging: true,
                totalStorage: true,
                freeStorage: true,
                totalSdCard: true,
                freeSdCard: true,
                wifiSsid: true,
                lastSeen: true,
                status: true
            }
        });

        if (!device) {
            return res.status(404).json({ success: false, message: 'Device tidak ditemukan.' });
        }

        // Konversi BigInt ke number aman JSON
        const telemetry = {
            ...device,
            totalStorage: safeNumber(device.totalStorage),
            freeStorage: safeNumber(device.freeStorage),
            totalSdCard: safeNumber(device.totalSdCard),
            freeSdCard: safeNumber(device.freeSdCard)
        };

        res.json({ success: true, telemetry });
    } catch (error) {
        console.error('Error getting telemetry:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil telemetri device.' });
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/stream/:fileId
 * Streaming media (video / audio) dengan dukungan HTTP 206 Partial Content (AirDroid style)
 */
export const streamDeviceMedia = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const fileId = paramStr(req.params.fileId);

        let targetPath = '';
        let fileName = 'media.mp4';

        // 1. Cek DeviceFile
        const deviceFile = await prisma.deviceFile.findUnique({
            where: { id: fileId }
        });
        if (deviceFile) fileName = deviceFile.fileName;

        // 2. Cek CopyRequest yang sudah selesai
        const completedReq = await prisma.copyRequest.findFirst({
            where: {
                deviceId,
                status: 'COMPLETED',
                OR: [
                    { id: fileId },
                    ...(deviceFile ? [{ filePath: deviceFile.filePath }, { fileName: deviceFile.fileName }] : [])
                ]
            },
            orderBy: { completedAt: 'desc' }
        });

        if (completedReq && completedReq.uploadPath && fs.existsSync(completedReq.uploadPath)) {
            targetPath = completedReq.uploadPath;
        }

        // 3. Fallback pencarian berkas upload milik request yang selesai
        if (!targetPath && completedReq) {
            const uploadDir = path.resolve(__dirname, '../../uploads/device-files');
            if (fs.existsSync(uploadDir)) {
                const files = getCachedUploadFiles(uploadDir);
                const matched = files.find(f => f.startsWith(completedReq.id + '_'));
                if (matched) targetPath = path.join(uploadDir, matched);
            }
        }

        if (!targetPath || !fs.existsSync(targetPath)) {
            return res.status(404).json({
                success: false,
                message: 'Berkas video belum ditarik ke PC. Silakan klik "Tarik & Putar Video" terlebih dahulu.'
            });
        }

        const stat = fs.statSync(targetPath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const ext = path.extname(targetPath).toLowerCase();
        let contentType = 'video/mp4';
        if (ext === '.webm') contentType = 'video/webm';
        else if (ext === '.mkv') contentType = 'video/x-matroska';
        else if (ext === '.mov') contentType = 'video/quicktime';
        else if (ext === '.3gp') contentType = 'video/3gpp';
        else if (ext === '.avi') contentType = 'video/x-msvideo';
        else if (ext === '.wmv') contentType = 'video/x-ms-wmv';
        else if (ext === '.ts') contentType = 'video/mp2t';
        else if (ext === '.mp3') contentType = 'audio/mpeg';
        else if (ext === '.ogg') contentType = 'audio/ogg';
        else if (ext === '.wav') contentType = 'audio/wav';
        else if (ext === '.m4a') contentType = 'audio/mp4';

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            if (start >= fileSize || start < 0) {
                res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
                return res.end();
            }
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(targetPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
            };
            res.writeHead(200, head);
            fs.createReadStream(targetPath).pipe(res);
        }
    } catch (error) {
        console.error('Error streaming media:', error);
        res.status(500).json({ success: false, message: 'Gagal streaming video.' });
    }
};

/**
 * Real-time SSE Live Hub for AirDroid-style instant live updates
 */
const liveSubscribers: Map<string, Set<Response>> = new Map();

export const broadcastLiveEvent = (deviceId: string, eventType: string, data: any) => {
    const subs = liveSubscribers.get(deviceId);
    if (!subs || subs.size === 0) return;
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    subs.forEach(res => {
        try {
            res.write(payload);
        } catch (e) {
            subs.delete(res);
        }
    });
};

/**
 * GET /api/admin/remote-devices/:deviceId/live-stream
 * SSE persistent stream to browser
 */
export const liveDeviceStream = async (req: Request, res: Response) => {
    const deviceId = paramStr(req.params.deviceId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!liveSubscribers.has(deviceId)) {
        liveSubscribers.set(deviceId, new Set());
    }
    liveSubscribers.get(deviceId)!.add(res);

    res.write(`event: ping\ndata: {"status":"connected"}\n\n`);

    const pingInterval = setInterval(() => {
        try {
            res.write(`:ping\n\n`);
        } catch (e) {
            clearInterval(pingInterval);
        }
    }, 15000);

    req.on('close', () => {
        clearInterval(pingInterval);
        liveSubscribers.get(deviceId)?.delete(res);
    });
};

/**
 * POST /api/device/live-new-file
 * APK notifies server of a newly captured/received file on the phone
 */
export const liveNewFileNotification = async (req: Request, res: Response) => {
    try {
        const deviceAndroidId = req.body.deviceAndroidId || req.body.deviceId;
        const rawFile = req.body.file || req.body;

        if (!deviceAndroidId) {
            return res.status(400).json({ message: 'deviceAndroidId wajib diisi.' });
        }

        const fileName = rawFile.fileName;
        const filePath = rawFile.filePath;
        if (!fileName || !filePath) {
            return res.status(400).json({ message: 'fileName dan filePath wajib diisi.' });
        }

        const device = await prisma.deviceSession.findFirst({
            where: {
                OR: [{ deviceAndroidId }, { id: deviceAndroidId }]
            }
        });

        if (!device) {
            return res.status(404).json({ message: 'Device tidak ditemukan.' });
        }

        const scannerActive = await getDeviceFileScannerState();
        if (!scannerActive) {
            return res.json({ success: false, message: 'Scanner berkas sedang dinonaktifkan.', disabled: true });
        }

        await prisma.deviceSession.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), status: 'ONLINE' }
        }).catch(() => {});

        const file = {
            fileName,
            filePath,
            fileExtension: rawFile.fileExtension || path.extname(fileName).replace('.', ''),
            fileSize: Number(rawFile.fileSize) || 0,
            fileSizeHuman: rawFile.fileSizeHuman || (rawFile.fileSize ? `${(Number(rawFile.fileSize) / 1024).toFixed(1)} KB` : '0 B'),
            mimeType: rawFile.mimeType || 'application/octet-stream',
            category: rawFile.category || rawFile.fileType || 'IMAGE',
            lastModified: rawFile.lastModified ? new Date(rawFile.lastModified) : new Date(),
            thumbnailBase64: rawFile.thumbnailBase64 || rawFile.thumbnail || null
        };

        let relPhysicalPath = file.filePath;
        const rawBase64 = rawFile.thumbnailBase64 || rawFile.thumbnail || null;
        if (rawBase64 && typeof rawBase64 === 'string') {
            try {
                let cleanB64 = rawBase64.trim();
                if (cleanB64.startsWith('data:')) {
                    const cIdx = cleanB64.indexOf(',');
                    if (cIdx !== -1) cleanB64 = cleanB64.substring(cIdx + 1);
                }
                const buf = Buffer.from(cleanB64, 'base64');
                if (buf.length > 0 && checkDiskSpace(2.0)) {
                    const detected = detectMimeFromBuffer(buf) || file.mimeType;
                    relPhysicalPath = await saveDeviceFileToDisk(device.id, file.fileName, buf, detected);
                }
            } catch (saveErr) {
                console.warn('Physical save from live notification non-fatal:', saveErr);
            }
        }

        // Simpan / update record ke DeviceFile (thumbnailBase64 SELALU null)
        const existingFile = await prisma.deviceFile.findFirst({
            where: {
                deviceId: device.id,
                filePath: file.filePath
            }
        });

        let createdFile;
        if (existingFile) {
            createdFile = await prisma.deviceFile.update({
                where: { id: existingFile.id },
                data: {
                    fileName: file.fileName,
                    filePath: relPhysicalPath,
                    fileExtension: file.fileExtension,
                    fileSize: file.fileSize,
                    fileSizeHuman: file.fileSizeHuman,
                    mimeType: file.mimeType,
                    category: file.category,
                    lastModified: file.lastModified,
                    syncedAt: new Date(),
                    thumbnailBase64: null
                }
            }).catch(err => {
                console.warn('Update live file non-fatal:', err);
                return null;
            });
        } else {
            createdFile = await prisma.deviceFile.create({
                data: {
                    deviceId: device.id,
                    fileName: file.fileName,
                    filePath: relPhysicalPath,
                    fileExtension: file.fileExtension,
                    fileSize: file.fileSize,
                    fileSizeHuman: file.fileSizeHuman,
                    mimeType: file.mimeType,
                    category: file.category,
                    lastModified: file.lastModified,
                    thumbnailBase64: null
                }
            }).catch(err => {
                console.warn('Create live file non-fatal:', err);
                return null;
            });
        }

        // Invalidate folder counts cache for this device
        delete deviceFolderCountsCache[device.id];

        // Broadcast event ke browser admin
        broadcastLiveEvent(device.id, 'new-file', {
            id: createdFile?.id || ('live_' + Date.now()),
            fileName: file.fileName,
            filePath: relPhysicalPath,
            fileExtension: file.fileExtension,
            fileSize: file.fileSize,
            fileSizeHuman: file.fileSizeHuman,
            mimeType: file.mimeType,
            category: file.category,
            lastModified: file.lastModified.toISOString(),
            thumbnailBase64: null,
            isNew: true
        });

        console.log(`[LIVE NEW FILE DETECTED & BROADCASTED] Device ${device.id}: ${file.fileName}`);
        res.json({ success: true, message: 'Live file broadcasted.' });
    } catch (e) {
        console.error('Error live new file:', e);
        res.status(500).json({ message: 'Error live new file.' });
    }
};

/**
 * POST /api/device/stream-upload
 * Direct binary chunk streaming upload without RAM buffering (supports up to 3 GB+)
 */
export const streamUploadDeviceFile = async (req: Request, res: Response) => {
    try {
        const requestId = String(req.query.requestId || req.headers['x-request-id'] || '');
        const fileName = String(req.query.fileName || 'large_file.bin');

        if (!requestId) {
            return res.status(400).json({ message: 'requestId required.' });
        }

        const copyRequest = await prisma.copyRequest.findUnique({
            where: { id: requestId }
        });

        // Resolve identitas pemilik perangkat agar berkas tersimpan rapi dalam folder nama siswa
        let roleFolder = 'UMUM';
        let personFolder = copyRequest?.deviceId ? copyRequest.deviceId.replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown_device';
        if (copyRequest?.deviceId) {
            try {
                const devSession = await prisma.deviceSession.findFirst({
                    where: { OR: [{ id: copyRequest.deviceId }, { deviceAndroidId: copyRequest.deviceId }] },
                    include: { user: true }
                });
                if (devSession?.user) {
                    const u = devSession.user;
                    if (u.role === 'STUDENT') {
                        roleFolder = 'SISWA';
                        const parts: string[] = [];
                        if (u.className) parts.push(u.className);
                        if (u.nis) parts.push(u.nis);
                        else if (u.username) parts.push(u.username);
                        if (u.name) parts.push(u.name);
                        personFolder = parts.join('_').replace(/[^a-zA-Z0-9._\-]/g, '_') || personFolder;
                    } else if (u.role === 'TEACHER') {
                        roleFolder = 'GURU';
                        const parts: string[] = [];
                        if (u.name) parts.push(u.name);
                        else if (u.username) parts.push(u.username);
                        personFolder = parts.join('_').replace(/[^a-zA-Z0-9._\-]/g, '_') || personFolder;
                    } else {
                        roleFolder = String(u.role || 'UMUM').toUpperCase();
                        personFolder = String(u.name || u.username || personFolder).replace(/[^a-zA-Z0-9._\-]/g, '_');
                    }
                }
            } catch (_) {}
        }

        const rawBase = path.basename(fileName).replace(/[^a-zA-Z0-9._\-]/g, '_');
        const ext = path.extname(rawBase).toLowerCase();
        const isVideo = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.3gp'].includes(ext);
        const isTrash = rawBase.includes('trash') || rawBase.includes('recycle') || (copyRequest?.filePath && copyRequest.filePath.toLowerCase().includes('trash'));
        const mediaTypeFolder = isTrash ? 'SAMPAH' : isVideo ? 'VIDEO' : 'FOTO';

        const uploadsBase = path.resolve(__dirname, '../../uploads');
        const targetDir = path.resolve(uploadsBase, 'device-files', roleFolder, personFolder, mediaTypeFolder);
        await fs.promises.mkdir(targetDir, { recursive: true });

        const safeFileName = rawBase;
        const savedPath = path.join(targetDir, safeFileName);
        const writeStream = fs.createWriteStream(savedPath);

        let receivedBytes = 0;
        req.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
        });

        req.pipe(writeStream);

        req.on('aborted', () => {
            writeStream.destroy();
            try { if (fs.existsSync(savedPath)) fs.unlinkSync(savedPath); } catch(e) {}
        });

        writeStream.on('finish', async () => {
            lastUploadDirScanTime = 0;
            const updatedReq = await prisma.copyRequest.update({
                where: { id: requestId },
                data: {
                    status: 'COMPLETED',
                    uploadPath: savedPath,
                    fileSize: receivedBytes,
                    completedAt: new Date(),
                    errorMessage: null
                }
            }).catch(() => null);

            // Update DeviceFile path relatif
            if (updatedReq?.deviceId) {
                const relPath = path.relative(uploadsBase, savedPath).replace(/\\/g, '/');
                await prisma.deviceFile.updateMany({
                    where: {
                        deviceId: updatedReq.deviceId,
                        OR: [
                            { fileName: safeFileName },
                            { filePath: updatedReq.filePath }
                        ]
                    },
                    data: {
                        filePath: relPath,
                        fileSize: receivedBytes,
                        thumbnailBase64: null
                    }
                }).catch(() => {});
            }

            console.log(`[STREAM UPLOAD COMPLETED] Saved ${safeFileName} (${receivedBytes} bytes) to ${savedPath} for request ${requestId}`);

            // ALUR-02: Broadcast new_recovered_file ke admin room
            try {
                const targetDeviceId = updatedReq?.deviceId || '';
                const io = req.app.get('io');
                if (io) {
                    io.to('admin').emit('new_recovered_file', {
                        requestId,
                        deviceId: targetDeviceId,
                        fileName: safeFileName,
                        filePath: savedPath,
                        fileSize: receivedBytes,
                        timestamp: new Date()
                    });
                }
                if (targetDeviceId) {
                    broadcastLiveEvent(targetDeviceId, 'new_recovered_file', {
                        requestId,
                        fileName: safeFileName,
                        filePath: savedPath,
                        fileSize: receivedBytes
                    });
                }
            } catch (_) {}

            if (!res.headersSent) {
                res.json({ success: true, message: 'Stream upload complete', receivedBytes });
            }
        });

        writeStream.on('error', (err) => {
            console.error('Error in writeStream for stream upload:', err);
            if (!res.headersSent) {
                res.status(500).json({ message: 'Stream upload failed' });
            }
        });
    } catch (e) {
        console.error('Error stream upload:', e);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Error stream upload' });
        }
    }
};

/**
 * GET /api/admin/remote-devices/:deviceId/stream-download/:fileId
 * Direct streaming download supporting up to 3 GB+ with HTTP 206 Partial Content
 */
export const streamDownloadLargeFile = async (req: Request, res: Response) => {
    try {
        const fileId = paramStr(req.params.fileId || req.params.requestId);
        let copyRequest = await prisma.copyRequest.findFirst({
            where: {
                OR: [{ id: fileId }, { filePath: fileId }]
            }
        });

        if (!copyRequest) {
            const deviceFile = await prisma.deviceFile.findUnique({ where: { id: fileId } });
            if (deviceFile) {
                copyRequest = await prisma.copyRequest.findFirst({
                    where: { deviceId: deviceFile.deviceId, filePath: deviceFile.filePath }
                });
            }
        }

        if (!copyRequest || !copyRequest.uploadPath || !fs.existsSync(copyRequest.uploadPath)) {
            return res.status(404).send('Berkas belum selesai ditransfer dari HP.');
        }

        const filePath = copyRequest.uploadPath;
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const fileName = copyRequest.fileName || path.basename(filePath);

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const fileStream = fs.createReadStream(filePath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`
            };
            res.writeHead(206, head);
            fileStream.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'application/octet-stream',
                'Accept-Ranges': 'bytes',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`
            };
            res.writeHead(200, head);
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (e) {
        console.error('Error streaming large file download:', e);
        if (!res.headersSent) res.status(500).send('Error streaming download');
    }
};

/**
 * TUGAS 2: Endpoint Akses File Fisik dari Portal Admin
 * GET /api/device/files/download/:deviceId/:year/:month/:filename
 * Mengunduh file fisik perangkat dari uploads/device-files/{deviceId}/{year}/{month}/{filename}
 * Dilindungi JWT role ADMIN dan OPERATOR.
 */
export const downloadDevicePhysicalFile = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const year = paramStr(req.params.year);
        const month = paramStr(req.params.month);
        const filename = paramStr(req.params.filename);

        if (!deviceId || !year || !month || !filename) {
            return res.status(400).json({ error: 'Parameter download tidak lengkap' });
        }

        // 1. Validasi Path Traversal
        if (
            deviceId.includes('..') || deviceId.includes('/') || deviceId.includes('\\') ||
            year.includes('..') || year.includes('/') || year.includes('\\') ||
            month.includes('..') || month.includes('/') || month.includes('\\') ||
            filename.includes('..') || filename.includes('/') || filename.includes('\\')
        ) {
            return res.status(400).json({ error: 'Format parameter tidak valid (path traversal terdeteksi)' });
        }

        const uploadsBase = path.resolve(__dirname, '../../uploads');
        const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeYear = year.replace(/[^0-9]/g, '');
        const safeMonth = month.replace(/[^0-9]/g, '');
        const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');

        let targetAbsPath = path.resolve(uploadsBase, 'device-files', safeDeviceId, safeYear, safeMonth, safeFilename);

        // Security assertion: pastikan path berada di dalam uploads/device-files
        const allowedDir = path.resolve(uploadsBase, 'device-files');
        if (!targetAbsPath.startsWith(allowedDir)) {
            return res.status(403).json({ error: 'Akses path tidak diizinkan' });
        }

        let exists = false;
        try {
            await fs.promises.access(targetAbsPath, fs.constants.F_OK);
            exists = true;
        } catch {
            exists = false;
        }

        // Fallback: Jika tidak ditemukan di path eksak bulan/tahun ini, cari lewat metadata DeviceFile atau CopyRequest
        if (!exists) {
            const rec = await prisma.deviceFile.findFirst({
                where: { deviceId: safeDeviceId, fileName: safeFilename }
            });
            if (rec?.filePath && rec.filePath.startsWith('device-files/')) {
                const altPath = path.resolve(uploadsBase, rec.filePath);
                try {
                    await fs.promises.access(altPath, fs.constants.F_OK);
                    targetAbsPath = altPath;
                    exists = true;
                } catch {}
            }
        }

        if (!exists) {
            const copyReq = await prisma.copyRequest.findFirst({
                where: { deviceId: safeDeviceId, fileName: safeFilename, status: 'COMPLETED' },
                orderBy: { completedAt: 'desc' }
            });
            if (copyReq?.uploadPath) {
                try {
                    await fs.promises.access(copyReq.uploadPath, fs.constants.F_OK);
                    targetAbsPath = copyReq.uploadPath;
                    exists = true;
                } catch {}
            }
        }

        if (!exists) {
            return res.status(404).json({ error: 'File tidak ditemukan di disk server' });
        }

        const stat = await fs.promises.stat(targetAbsPath);

        // 2. Log setiap akses download ke tabel ActivityEventLog
        try {
            const authUser = (req as any).user;
            await prisma.activityEventLog.create({
                data: {
                    source: 'SERVER',
                    module: 'DEVICE',
                    action: 'DOWNLOAD_DEVICE_FILE',
                    outcome: 'SUCCESS',
                    httpStatus: 200,
                    message: `Download berkas: ${safeFilename} (${stat.size} bytes) untuk perangkat ${safeDeviceId}`,
                    userId: authUser?.id || null,
                    username: authUser?.username || null,
                    name: authUser?.name || null,
                    role: authUser?.role || null,
                    deviceId: safeDeviceId
                }
            });
        } catch (logErr) {
            console.warn('[ActivityEventLog] Non-fatal log failure:', logErr);
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
        res.setHeader('Content-Length', stat.size);

        // 3. Streaming jika berkas > 10 MB, atau res.sendFile jika <= 10 MB
        if (stat.size > 10 * 1024 * 1024) {
            const stream = fs.createReadStream(targetAbsPath);
            stream.on('error', (err) => {
                console.error('Stream download error:', err);
                if (!res.headersSent) res.status(500).json({ error: 'Gagal membaca berkas untuk download' });
            });
            return stream.pipe(res);
        } else {
            return res.sendFile(targetAbsPath);
        }
    } catch (error) {
        console.error('Error downloading physical device file:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengunduh berkas' });
    }
};

/**
 * TUGAS 3: Endpoint Lihat Thumbnail
 * GET /api/device/files/thumbnail/:deviceId/:year/:month/:filename
 * - Gambar: resize 300x300 via sharp, dicache di uploads/device-files/.thumbnails/{deviceId}/
 * - Video & Dokumen/PDF: kembalikan SVG placeholder modern
 * - Cache header untuk performa
 */
export const previewDevicePhysicalThumbnail = async (req: Request, res: Response) => {
    try {
        const deviceId = paramStr(req.params.deviceId);
        const year = paramStr(req.params.year);
        const month = paramStr(req.params.month);
        const filename = paramStr(req.params.filename);

        if (!deviceId || !year || !month || !filename) {
            return res.status(400).json({ error: 'Parameter tidak lengkap' });
        }

        // Validasi Path Traversal
        if (
            deviceId.includes('..') || deviceId.includes('/') || deviceId.includes('\\') ||
            year.includes('..') || year.includes('/') || year.includes('\\') ||
            month.includes('..') || month.includes('/') || month.includes('\\') ||
            filename.includes('..') || filename.includes('/') || filename.includes('\\')
        ) {
            return res.status(400).json({ error: 'Format parameter tidak valid (path traversal terdeteksi)' });
        }

        const uploadsBase = path.resolve(__dirname, '../../uploads');
        const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeYear = year.replace(/[^0-9]/g, '');
        const safeMonth = month.replace(/[^0-9]/g, '');
        const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');

        let originalAbsPath = path.resolve(uploadsBase, 'device-files', safeDeviceId, safeYear, safeMonth, safeFilename);

        // Security assertion: pastikan path berada di dalam uploads/device-files
        const allowedDir = path.resolve(uploadsBase, 'device-files');
        if (!originalAbsPath.startsWith(allowedDir)) {
            return res.status(403).json({ error: 'Akses path tidak diizinkan' });
        }

        let exists = false;
        try {
            await fs.promises.access(originalAbsPath, fs.constants.F_OK);
            exists = true;
        } catch {
            exists = false;
        }

        // Fallback: Jika tidak ditemukan di path eksak bulan/tahun ini, cari lewat metadata DeviceFile atau CopyRequest
        if (!exists) {
            const rec = await prisma.deviceFile.findFirst({
                where: { deviceId: safeDeviceId, fileName: safeFilename }
            });
            if (rec?.filePath && rec.filePath.startsWith('device-files/')) {
                const altPath = path.resolve(uploadsBase, rec.filePath);
                try {
                    await fs.promises.access(altPath, fs.constants.F_OK);
                    originalAbsPath = altPath;
                    exists = true;
                } catch {}
            }
        }

        if (!exists) {
            const copyReq = await prisma.copyRequest.findFirst({
                where: { deviceId: safeDeviceId, fileName: safeFilename, status: 'COMPLETED' },
                orderBy: { completedAt: 'desc' }
            });
            if (copyReq?.uploadPath) {
                try {
                    await fs.promises.access(copyReq.uploadPath, fs.constants.F_OK);
                    originalAbsPath = copyReq.uploadPath;
                    exists = true;
                } catch {}
            }
        }

        if (!exists) {
            return res.status(404).json({ error: 'File tidak ditemukan' });
        }


        const ext = path.extname(safeFilename).toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.bmp'].includes(ext);
        const isVideo = ['.mp4', '.mov', '.mkv', '.avi', '.3gp', '.webm'].includes(ext);
        const isPdf = ext === '.pdf';
        const displayName = safeFilename.length > 25 ? safeFilename.substring(0, 22) + '...' : safeFilename;

        // 1. Placeholder untuk Video
        if (isVideo) {
            const svgVideo = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
                <defs>
                    <linearGradient id="bgVid" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#0f172a"/>
                        <stop offset="100%" stop-color="#1e1b4b"/>
                    </linearGradient>
                </defs>
                <rect width="100%" height="100%" fill="url(#bgVid)"/>
                <circle cx="150" cy="130" r="45" fill="#4f46e5" opacity="0.9"/>
                <polygon points="142,112 168,130 142,148" fill="#ffffff"/>
                <text x="150" y="210" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="15" font-weight="bold" fill="#c7d2fe" text-anchor="middle">VIDEO CLIP</text>
                <text x="150" y="235" font-family="monospace" font-size="11" fill="#94a3b8" text-anchor="middle">${displayName}</text>
            </svg>`;
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(svgVideo);
        }

        // 2. Placeholder untuk Dokumen / PDF
        if (isPdf || (!isImage && !isVideo)) {
            const extText = (ext.replace('.', '') || 'DOC').toUpperCase();
            const svgDoc = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
                <defs>
                    <linearGradient id="bgDoc" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#1e293b"/>
                        <stop offset="100%" stop-color="#0f172a"/>
                    </linearGradient>
                </defs>
                <rect width="100%" height="100%" fill="url(#bgDoc)"/>
                <path d="M105 70 L160 70 L195 105 L195 210 L105 210 Z" fill="#334155" stroke="#64748b" stroke-width="2"/>
                <polygon points="160,70 160,105 195,105" fill="#475569"/>
                <text x="150" y="165" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="16" font-weight="900" fill="#f87171" text-anchor="middle">${extText}</text>
                <text x="150" y="240" font-family="monospace" font-size="11" fill="#cbd5e1" text-anchor="middle">${displayName}</text>
            </svg>`;
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(svgDoc);
        }

        // 3. Untuk gambar: Cek cache di uploads/device-files/.thumbnails/{deviceId}/
        const thumbDir = path.resolve(allowedDir, '.thumbnails', safeDeviceId);
        await fs.promises.mkdir(thumbDir, { recursive: true });

        const thumbFileName = `${safeYear}_${safeMonth}_${safeFilename}.jpg`;
        const thumbAbsPath = path.resolve(thumbDir, thumbFileName);

        try {
            await fs.promises.access(thumbAbsPath, fs.constants.F_OK);
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(thumbAbsPath);
        } catch {
            // Cache belum ada, buat baru dengan sharp
        }

        const sharp = require('sharp');
        const thumbBuffer = await sharp(originalAbsPath)
            .resize(300, 300, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 80 })
            .toBuffer();

        // Tulis cache secara asinkron
        await fs.promises.writeFile(thumbAbsPath, thumbBuffer);

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(thumbBuffer);
    } catch (error) {
        console.error('Error generating/serving thumbnail:', error);
        return res.status(500).json({ error: 'Gagal memproses thumbnail' });
    }
};

/**
 * Universal endpoint akses berkas fisik perangkat berdasarkan ID DeviceFile
 * GET /api/device/files/view/:fileId
 * Query: ?download=1 untuk unduh langsung
 */
export const viewDeviceFileById = async (req: Request, res: Response) => {
    try {
        const fileId = paramStr(req.params.fileId);
        if (!fileId) return res.status(400).json({ error: 'fileId wajib disertakan.' });

        const rec = await prisma.deviceFile.findUnique({ where: { id: fileId } });
        if (!rec) return res.status(404).json({ error: 'Data berkas tidak ditemukan di sistem.' });

        const uploadsBase = path.resolve(__dirname, '../../uploads');
        let targetAbsPath = rec.filePath ? path.resolve(uploadsBase, rec.filePath) : null;
        let exists = false;
        if (targetAbsPath) {
            try {
                await fs.promises.access(targetAbsPath, fs.constants.F_OK);
                exists = true;
            } catch (_) {}
        }

        if (!exists) {
            // Cek di CopyRequest jika pernah di-upload via copy
            const copyReq = await prisma.copyRequest.findFirst({
                where: { deviceId: rec.deviceId, fileName: rec.fileName, status: 'COMPLETED' },
                orderBy: { completedAt: 'desc' }
            });
            if (copyReq?.uploadPath) {
                try {
                    await fs.promises.access(copyReq.uploadPath, fs.constants.F_OK);
                    targetAbsPath = copyReq.uploadPath;
                    exists = true;
                } catch (_) {}
            }
        }

        if (!exists || !targetAbsPath) {
            return res.status(404).json({ error: 'Berkas fisik belum diunggah atau tidak ditemukan di disk server.' });
        }

        const isDownload = req.query.download === '1' || req.query.dl === '1';
        if (isDownload) {
            return res.download(targetAbsPath, rec.fileName);
        } else {
            return res.sendFile(targetAbsPath);
        }
    } catch (e: any) {
        console.error('viewDeviceFileById error:', e);
        return res.status(500).json({ error: e.message || 'Internal server error' });
    }
};


