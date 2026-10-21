import { Request, Response } from 'express';
import prisma from '../utils/db';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const OFFICIAL_PORTAL_APK_URL = 'https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk';
export const GITHUB_RELEASE_BASE = 'https://cbt.smpn1boyolangu.my.id/uploads';
export const GITHUB_LATEST_APK_URL = OFFICIAL_PORTAL_APK_URL;

interface CachedPayload {
    data: any;
    timestamp: number;
}

let cachedPublicPayload: CachedPayload | null = null;
let cachedAdminPayload: CachedPayload | null = null;
const CACHE_TTL_MS = 10000; // 10 detik cache memory

let cachedSha256Map: Record<string, { hash: string; mtime: number }> = {};

export const getApkFileSha256 = (fileName: string): string | null => {
    try {
        const candidatePaths = [
            path.resolve(__dirname, '../../uploads', fileName),
            path.resolve(__dirname, '../../../backend/uploads', fileName),
            path.resolve('C:/APK/backend/uploads', fileName)
        ];
        for (const fullPath of candidatePaths) {
            if (fs.existsSync(fullPath)) {
                const stat = fs.statSync(fullPath);
                const cached = cachedSha256Map[fullPath];
                if (cached && cached.mtime === stat.mtimeMs) {
                    return cached.hash;
                }
                const buf = fs.readFileSync(fullPath);
                const hash = crypto.createHash('sha256').update(buf).digest('hex');
                cachedSha256Map[fullPath] = { hash, mtime: stat.mtimeMs };
                return hash;
            }
        }
    } catch (e) {
        console.error('Error calculating APK SHA-256:', e);
    }
    return null;
};

export const invalidateVersionCache = () => {
    cachedPublicPayload = null;
    cachedAdminPayload = null;
    cachedSha256Map = {};
};

/**
 * Mendeteksi apakah pemanggil adalah Admin/Operator/Tester internal
 */
export const detectIsAdminTester = (req: Request): boolean => {
    try {
        const queryRole = String(req.query.role || '').toUpperCase();
        const headerRole = String(req.headers['x-user-role'] || req.headers['x-app-role'] || '').toUpperCase();
        const channel = String(req.query.channel || req.headers['x-app-channel'] || '').toLowerCase();

        if (channel === 'admin' || channel === 'beta' || channel === 'internal') {
            return true;
        }

        if (queryRole === 'ADMIN' || queryRole === 'OPERATOR' || headerRole === 'ADMIN' || headerRole === 'OPERATOR') {
            return true;
        }

        // Cek Bearer Token jika disertakan
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const decoded: any = jwt.decode(token);
            if (decoded && decoded.role) {
                const r = String(decoded.role).toUpperCase();
                if (r === 'ADMIN' || r === 'OPERATOR') return true;
            }
        }
    } catch (e) {}

    return false;
};

/**
 * GET /api/app/version-check & alias
 * Mengembalikan konfigurasi versi:
 * - Admin/Operator: Mengembalikan admin_beta jika ada versi baru di lokal, sehingga admin bisa tes di HP sendiri.
 * - Siswa/Ortu/Umum (3.000 siswa): Selalu mengembalikan versi rilis publik yang stabil (id: 'latest').
 */
export const getAppVersion = async (req: Request, res: Response) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

        const now = Date.now();
        const isAdminTester = detectIsAdminTester(req);

        // Periksa in-memory cache sesuai channel
        if (isAdminTester && cachedAdminPayload && (now - cachedAdminPayload.timestamp < CACHE_TTL_MS)) {
            return res.json(cachedAdminPayload.data);
        }
        if (!isAdminTester && cachedPublicPayload && (now - cachedPublicPayload.timestamp < CACHE_TTL_MS)) {
            return res.json(cachedPublicPayload.data);
        }

        // 1. Ambil versi publik resmi
        let publicConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'latest' } });
        const defaultPublicDownloadUrl = '/uploads/smartcbt-latest.apk';

        if (!publicConfig) {
            publicConfig = await prisma.appVersionConfig.create({
                data: {
                    id: 'latest',
                    versionCode: 181,
                    versionName: '2.9.11',
                    downloadUrl: defaultPublicDownloadUrl,
                    fileSizeMb: 17.69,
                    releaseNotes: '⚡ PEMBARUAN SISTEM RESMI: Smart CBT v2.9.11 (Build 181)\n1. Presensi Sholat Mushola & Keputrian\n2. Notifikasi TTS Suara Otomatis\n3. Smart Lockout QR Kelas\n4. Dynamic QR Pengurus Kelas & Kartu Pelajar\n5. CBT Proctor Strike Unlock',
                    isForceUpdate: true
                }
            });
        }

        // 2. Ambil versi uji coba lokal admin (jika ada)
        const adminBetaConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'admin_beta' } });

        // Tentukan konfigurasi mana yang disajikan
        let activeConfig = publicConfig;
        let isServingBeta = false;

        if (isAdminTester && adminBetaConfig && adminBetaConfig.versionCode > publicConfig.versionCode) {
            activeConfig = adminBetaConfig;
            isServingBeta = true;
        }

        let resolvedDownloadUrl = activeConfig.downloadUrl;
        if (!resolvedDownloadUrl || resolvedDownloadUrl.includes('adiprayitno')) {
            resolvedDownloadUrl = isServingBeta ? '/uploads/smartcbt-admin-beta.apk' : '/uploads/smartcbt-latest.apk';
        }

        // Hitung SHA-256 aktual langsung dari berkas APK fisik di disk
        const targetFileName = isServingBeta ? 'smartcbt-admin-beta.apk' : 'smartcbt-latest.apk';
        const fileSha256 = getApkFileSha256(targetFileName);

        let releaseSha256: string | null = null;
        try {
            if ((prisma as any).appVersionRelease) {
                const rel = await (prisma as any).appVersionRelease.findUnique({
                    where: { versionCode: activeConfig.versionCode }
                });
                releaseSha256 = rel?.checksumSha256 || null;
            }
        } catch (e) {}

        const finalSha256 = fileSha256 || releaseSha256 || null;

        const payload = {
            success: true,
            channel: isServingBeta ? 'admin_beta' : 'public',
            channelLabel: isServingBeta ? '🟡 Uji Coba Internal Admin (Local Beta)' : '🟢 Rilis Stabil Publik (3.000 Siswa)',
            targetAudience: isServingBeta ? 'HP Admin & Operator Sekolah Saja' : 'Seluruh Siswa, Guru & Orang Tua',
            update: {
                versionCode: activeConfig.versionCode,
                versionName: activeConfig.versionName,
                downloadUrl: resolvedDownloadUrl,
                fileSizeMb: activeConfig.fileSizeMb,
                releaseNotes: activeConfig.releaseNotes,
                isForceUpdate: activeConfig.isForceUpdate,
                sha256: finalSha256,
                channel: isServingBeta ? 'admin_beta' : 'public'
            },
            versionCode: activeConfig.versionCode,
            versionName: activeConfig.versionName,
            downloadUrl: resolvedDownloadUrl,
            fileSizeMb: activeConfig.fileSizeMb,
            releaseNotes: activeConfig.releaseNotes,
            isForceUpdate: activeConfig.isForceUpdate,
            sha256: finalSha256
        };

        if (isAdminTester) {
            cachedAdminPayload = { data: payload, timestamp: now };
        } else {
            cachedPublicPayload = { data: payload, timestamp: now };
        }

        return res.json(payload);
    } catch (error) {
        console.error('Error fetching app version:', error);
        res.status(500).json({ message: 'Gagal mengecek pembaruan aplikasi' });
    }
};

/**
 * GET /api/v1/app/version-check
 */
export const checkVersionV1 = async (req: Request, res: Response) => {
    try {
        const isAdminTester = detectIsAdminTester(req);
        let publicConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'latest' } });
        const adminBetaConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'admin_beta' } });

        let activeConfig = publicConfig;
        let isServingBeta = false;

        if (isAdminTester && adminBetaConfig && adminBetaConfig.versionCode > (publicConfig?.versionCode || 0)) {
            activeConfig = adminBetaConfig;
            isServingBeta = true;
        }

        const latestVersion = activeConfig?.versionName || '2.9.11';
        const minSupportedVersion = activeConfig?.versionName || '2.9.11';

        const rawUrl = activeConfig?.downloadUrl || (isServingBeta ? '/uploads/smartcbt-admin-beta.apk' : '/uploads/smartcbt-latest.apk');
        let fullDownloadUrl = rawUrl;
        if (rawUrl && rawUrl.startsWith('http') && !rawUrl.includes('adiprayitno')) {
            fullDownloadUrl = rawUrl;
        } else if (rawUrl && rawUrl.startsWith('/')) {
            fullDownloadUrl = `https://cbt.smpn1boyolangu.my.id${rawUrl}`;
        } else {
            fullDownloadUrl = `https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk`;
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

        res.json({
            status: "success",
            data: {
                latest_version: latestVersion,
                min_supported_version: minSupportedVersion,
                download_url: fullDownloadUrl,
                changelog: activeConfig?.releaseNotes || "Pembaruan sistem resmi Smart CBT.",
                is_force_update: activeConfig?.isForceUpdate ?? true,
                channel: isServingBeta ? 'admin_beta' : 'public',
                target_audience: isServingBeta ? 'HP Admin & Operator Saja' : 'Seluruh 3.000 Siswa'
            }
        });
    } catch (error) {
        console.error('Error fetching version v1:', error);
        res.status(500).json({ status: "error", message: 'Gagal mengecek pembaruan aplikasi' });
    }
};

/**
 * GET /api/admin/app-version/staged-status
 * Menampilkan status versi publik (siswa) vs versi uji coba lokal admin
 */
export const getStagedVersionStatus = async (req: Request, res: Response) => {
    try {
        const publicConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'latest' } });
        const adminBetaConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'admin_beta' } });

        // Cek file fisik di disk
        const publicApkPath = path.resolve(process.cwd(), 'uploads/smartcbt-latest.apk');
        const betaApkPath = path.resolve(process.cwd(), 'uploads/smartcbt-admin-beta.apk');

        const publicFileExists = fs.existsSync(publicApkPath);
        const betaFileExists = fs.existsSync(betaApkPath);

        const totalStudents = await prisma.user.count({ where: { role: 'STUDENT' } }).catch(() => 3000);

        res.json({
            success: true,
            publicVersion: publicConfig ? {
                versionCode: publicConfig.versionCode,
                versionName: publicConfig.versionName,
                downloadUrl: publicConfig.downloadUrl,
                fileSizeMb: publicConfig.fileSizeMb,
                releaseNotes: publicConfig.releaseNotes,
                isForceUpdate: publicConfig.isForceUpdate,
                updatedAt: publicConfig.updatedAt,
                fileExists: publicFileExists
            } : null,
            adminBetaVersion: adminBetaConfig ? {
                versionCode: adminBetaConfig.versionCode,
                versionName: adminBetaConfig.versionName,
                downloadUrl: adminBetaConfig.downloadUrl,
                fileSizeMb: adminBetaConfig.fileSizeMb,
                releaseNotes: adminBetaConfig.releaseNotes,
                isForceUpdate: adminBetaConfig.isForceUpdate,
                updatedAt: adminBetaConfig.updatedAt,
                fileExists: betaFileExists,
                isActive: (publicConfig ? adminBetaConfig.versionCode > publicConfig.versionCode : true)
            } : null,
            hasActiveBeta: Boolean(adminBetaConfig && (!publicConfig || adminBetaConfig.versionCode > publicConfig.versionCode)),
            totalStudents
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message || 'Gagal mengambil status rilis bertahap' });
    }
};

/**
 * POST /api/admin/app-version/publish-to-students
 * Menyetujui rilis beta admin dan langsung MEMPUBLIKASIKAN ke seluruh 3.000 siswa!
 */
export const publishBetaToStudents = async (req: Request, res: Response) => {
    try {
        const adminBetaConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'admin_beta' } });
        if (!adminBetaConfig) {
            return res.status(400).json({ success: false, message: 'Tidak ada versi uji coba (admin_beta) yang ditemukan untuk dipublikasikan.' });
        }

        // 1. Salin file fisik APK dari admin-beta ke latest
        const baseUploads = path.resolve(process.cwd(), 'uploads');
        const betaApkPath = path.join(baseUploads, 'smartcbt-admin-beta.apk');
        const latestApkPath = path.join(baseUploads, 'smartcbt-latest.apk');

        if (fs.existsSync(betaApkPath)) {
            fs.copyFileSync(betaApkPath, latestApkPath);

            // Replikasi ke public & downloads folder jika ada
            const mirrors = [
                path.resolve(process.cwd(), 'public/smartcbt-latest.apk'),
                path.resolve(process.cwd(), 'public/downloads/smartcbt-latest.apk'),
                path.resolve(process.cwd(), 'public/uploads/smartcbt-latest.apk'),
                path.resolve(process.cwd(), 'storage/apk/smartcbt-latest.apk'),
                path.resolve(process.cwd(), '../smartcbt-latest.apk')
            ];

            for (const mirror of mirrors) {
                try {
                    const dir = path.dirname(mirror);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.copyFileSync(betaApkPath, mirror);
                } catch (e) {}
            }
        }

        // 2. Perbarui tabel latest dengan data dari admin_beta
        const updatedLatest = await prisma.appVersionConfig.upsert({
            where: { id: 'latest' },
            update: {
                versionCode: adminBetaConfig.versionCode,
                versionName: adminBetaConfig.versionName,
                downloadUrl: '/uploads/smartcbt-latest.apk',
                fileSizeMb: adminBetaConfig.fileSizeMb,
                releaseNotes: adminBetaConfig.releaseNotes,
                isForceUpdate: adminBetaConfig.isForceUpdate
            },
            create: {
                id: 'latest',
                versionCode: adminBetaConfig.versionCode,
                versionName: adminBetaConfig.versionName,
                downloadUrl: '/uploads/smartcbt-latest.apk',
                fileSizeMb: adminBetaConfig.fileSizeMb,
                releaseNotes: adminBetaConfig.releaseNotes,
                isForceUpdate: adminBetaConfig.isForceUpdate
            }
        });

        // 3. Juga update row app_latest & cbt_latest jika ada
        await prisma.appVersionConfig.updateMany({
            where: { id: { in: ['app_latest', 'cbt_latest'] } },
            data: {
                versionCode: adminBetaConfig.versionCode,
                versionName: adminBetaConfig.versionName,
                downloadUrl: '/uploads/smartcbt-latest.apk',
                fileSizeMb: adminBetaConfig.fileSizeMb,
                releaseNotes: adminBetaConfig.releaseNotes,
                isForceUpdate: adminBetaConfig.isForceUpdate
            }
        }).catch(() => {});

        // 4. Hapus data beta agar kembali ke status normal
        await prisma.appVersionConfig.delete({ where: { id: 'admin_beta' } }).catch(() => {});

        // 5. Invalidate cache memory
        invalidateVersionCache();

        const totalStudents = await prisma.user.count({ where: { role: 'STUDENT' } }).catch(() => 3000);

        return res.json({
            success: true,
            message: `🚀 Sukses! Pembaruan v${updatedLatest.versionName} (Build ${updatedLatest.versionCode}) resmi dipublikasikan ke seluruh ${totalStudents} siswa!`,
            config: updatedLatest
        });
    } catch (error: any) {
        console.error('Error publishing beta to students:', error);
        res.status(500).json({ success: false, message: error.message || 'Gagal mempublikasikan ke siswa' });
    }
};

/**
 * POST /api/admin/app-version/cancel-beta
 * Membatalkan versi uji coba admin dan mengembalikan HP Admin ke versi stabil siswa
 */
export const cancelAdminBeta = async (req: Request, res: Response) => {
    try {
        await prisma.appVersionConfig.delete({ where: { id: 'admin_beta' } }).catch(() => {});
        invalidateVersionCache();

        res.json({
            success: true,
            message: 'Versi uji coba lokal admin berhasil dibatalkan. HP Admin kembali memantau versi rilis publik stabil.'
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message || 'Gagal membatalkan uji coba admin' });
    }
};

/**
 * POST /api/admin/app-version/register-local-build
 * Mendaftarkan build APK baru yang baru saja di-build secara lokal oleh script / admin
 */
export const registerLocalBuild = async (req: Request, res: Response) => {
    try {
        const {
            versionCode,
            versionName,
            downloadUrl,
            fileSizeMb,
            releaseNotes,
            isForceUpdate = true,
            target = 'admin_only', // 'admin_only' (default) atau 'public'
            sha256
        } = req.body;

        if (!versionCode || !versionName) {
            return res.status(400).json({ success: false, message: 'versionCode dan versionName wajib disertakan' });
        }

        const targetId = target === 'public' ? 'latest' : 'admin_beta';
        const defaultUrl = target === 'public' ? '/uploads/smartcbt-latest.apk' : '/uploads/smartcbt-admin-beta.apk';

        const config = await prisma.appVersionConfig.upsert({
            where: { id: targetId },
            update: {
                versionCode: Number(versionCode),
                versionName: String(versionName),
                downloadUrl: downloadUrl || defaultUrl,
                fileSizeMb: Number(fileSizeMb) || 18.0,
                releaseNotes: releaseNotes || `Pembaruan Smart CBT v${versionName} (Build ${versionCode})`,
                isForceUpdate: Boolean(isForceUpdate)
            },
            create: {
                id: targetId,
                versionCode: Number(versionCode),
                versionName: String(versionName),
                downloadUrl: downloadUrl || defaultUrl,
                fileSizeMb: Number(fileSizeMb) || 18.0,
                releaseNotes: releaseNotes || `Pembaruan Smart CBT v${versionName} (Build ${versionCode})`,
                isForceUpdate: Boolean(isForceUpdate)
            }
        });

        // Simpan juga ke AppVersionRelease jika model tersedia
        try {
            if ((prisma as any).appVersionRelease) {
                const finalChecksum = sha256 || getApkFileSha256(target === 'public' ? 'smartcbt-latest.apk' : 'smartcbt-admin-beta.apk');
                await (prisma as any).appVersionRelease.upsert({
                    where: { versionCode: Number(versionCode) },
                    update: {
                        nomorVersi: String(versionName),
                        changelog: releaseNotes || `Pembaruan Smart CBT v${versionName} (Build ${versionCode})`,
                        fileApkUrl: downloadUrl || defaultUrl,
                        fileSizeMb: Number(fileSizeMb) || 18.0,
                        checksumSha256: finalChecksum,
                        isForceUpdate: Boolean(isForceUpdate),
                        status: 'ACTIVE'
                    },
                    create: {
                        nomorVersi: String(versionName),
                        versionCode: Number(versionCode),
                        changelog: releaseNotes || `Pembaruan Smart CBT v${versionName} (Build ${versionCode})`,
                        fileApkUrl: downloadUrl || defaultUrl,
                        fileSizeMb: Number(fileSizeMb) || 18.0,
                        checksumSha256: finalChecksum,
                        isForceUpdate: Boolean(isForceUpdate),
                        status: 'ACTIVE'
                    }
                });
            }
        } catch (e) {}

        invalidateVersionCache();

        return res.json({
            success: true,
            message: target === 'admin_only'
                ? `🟡 Build v${versionName} (Build ${versionCode}) terdaftar untuk HP Admin Saja (3.000 Siswa Aman).`
                : `🟢 Build v${versionName} (Build ${versionCode}) langsung aktif untuk seluruh siswa.`,
            config
        });
    } catch (error: any) {
        console.error('Error registering local build:', error);
        res.status(500).json({ success: false, message: error.message || 'Gagal mendaftarkan build lokal' });
    }
};

/**
 * POST /api/admin/app-version
 * Legacy / Manual Form Update
 */
export const updateAppVersionConfig = async (req: Request, res: Response) => {
    try {
        const { versionCode, versionName, downloadUrl, fileSizeMb, releaseNotes, isForceUpdate, targetId = 'latest' } = req.body;
        
        invalidateVersionCache();

        const config = await prisma.appVersionConfig.upsert({
            where: { id: targetId },
            update: {
                versionCode: Number(versionCode),
                versionName: String(versionName),
                downloadUrl: String(downloadUrl),
                fileSizeMb: Number(fileSizeMb),
                releaseNotes: String(releaseNotes),
                isForceUpdate: Boolean(isForceUpdate)
            },
            create: {
                id: targetId,
                versionCode: Number(versionCode),
                versionName: String(versionName),
                downloadUrl: String(downloadUrl),
                fileSizeMb: Number(fileSizeMb),
                releaseNotes: String(releaseNotes),
                isForceUpdate: Boolean(isForceUpdate)
            }
        });

        res.json({
            success: true,
            message: 'Konfigurasi versi aplikasi berhasil diperbarui',
            config
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memperbarui konfigurasi aplikasi' });
    }
};