import { Request, Response } from 'express';
import prisma from '../utils/db';

export const GITHUB_RELEASE_BASE = 'https://github.com/smpnboyolangu1-lab/smartcbt-mobile-APK/releases';
export const GITHUB_LATEST_APK_URL = `${GITHUB_RELEASE_BASE}/latest/download/SmartCBT_latest.apk`;

let cachedVersionPayload: any = null;
let lastVersionFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15 detik cache memory untuk ultra-fast response (<1ms)

export const getAppVersion = async (req: Request, res: Response) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

        const now = Date.now();
        if (cachedVersionPayload && (now - lastVersionFetchTime < CACHE_TTL_MS)) {
            return res.json(cachedVersionPayload);
        }

        let config = await prisma.appVersionConfig.findUnique({ where: { id: 'latest' } });
        
        const releaseNotes295 = '⚠️ PEMBARUAN WAJIB SISTEM: Smart CBT v2.9.5 (Build 175)\n' +
            '1. Kesiapan Sistem 90%+: Lolos audit keamanan menyeluruh, integritas naskah CBT, dan proteksi anti-tamper.\n' +
            '2. Penghapusan Total RFID: Seluruh pencatatan kehadiran menggunakan QR Dinamis Pengurus Kelas dan Presensi Mandiri GPS.\n' +
            '3. Penguatan CBT Kiosk: Perlindungan kunci jawaban server-side & penguncian status submit idempoten.\n' +
            '4. Optimalisasi Kinerja & Privasi: Sesuai standar UU PDP dan ketahanan beban 989 siswa serentak.';

        const targetGithubUrl = `${GITHUB_RELEASE_BASE}/download/v2.9.5/SmartCBT_v2.9.5.apk`;

        if (!config || config.versionCode < 175 || !config.isForceUpdate || config.downloadUrl?.includes('adiprayitno')) {
            config = await prisma.appVersionConfig.upsert({
                where: { id: 'latest' },
                update: {
                    versionCode: 175,
                    versionName: '2.9.5',
                    downloadUrl: targetGithubUrl,
                    fileSizeMb: 18.5,
                    releaseNotes: releaseNotes295,
                    isForceUpdate: true
                },
                create: {
                    id: 'latest',
                    versionCode: 175,
                    versionName: '2.9.5',
                    downloadUrl: targetGithubUrl,
                    fileSizeMb: 18.5,
                    releaseNotes: releaseNotes295,
                    isForceUpdate: true
                }
            });
        }

        // Pastikan URL download mengarah ke GitHub Releases CDN resmi sekolah atau server lokal
        let resolvedDownloadUrl = config.downloadUrl;
        if (!resolvedDownloadUrl || resolvedDownloadUrl.includes('adiprayitno')) {
            resolvedDownloadUrl = `${GITHUB_RELEASE_BASE}/download/v${config.versionName}/SmartCBT_v${config.versionName}.apk`;
        }

        const payload = {
            success: true,
            update: {
                versionCode: config.versionCode,
                versionName: config.versionName,
                downloadUrl: resolvedDownloadUrl,
                fileSizeMb: config.fileSizeMb,
                releaseNotes: config.releaseNotes,
                isForceUpdate: config.isForceUpdate,
                sha256: (config as any).sha256 || null
            },
            versionCode: config.versionCode,
            versionName: config.versionName,
            downloadUrl: resolvedDownloadUrl,
            fileSizeMb: config.fileSizeMb,
            releaseNotes: config.releaseNotes,
            isForceUpdate: config.isForceUpdate,
            sha256: (config as any).sha256 || null
        };

        cachedVersionPayload = payload;
        lastVersionFetchTime = now;

        return res.json(payload);
    } catch (error) {
        console.error('Error fetching app version:', error);
        res.status(500).json({ message: 'Gagal mengecek pembaruan aplikasi' });
    }
};

export const updateAppVersionConfig = async (req: Request, res: Response) => {
    try {
        const { versionCode, versionName, downloadUrl, fileSizeMb, releaseNotes, isForceUpdate } = req.body;
        
        cachedVersionPayload = null; // Invalidate cache seketika
        lastVersionFetchTime = 0;

        const config = await prisma.appVersionConfig.upsert({
            where: { id: 'latest' },
            update: { versionCode, versionName, downloadUrl, fileSizeMb, releaseNotes, isForceUpdate },
            create: { id: 'latest', versionCode, versionName, downloadUrl, fileSizeMb, releaseNotes, isForceUpdate }
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

export const checkVersionV1 = async (req: Request, res: Response) => {
    try {
        const platform = (req.query.platform as string) || 'android';
        const currentVersion = (req.query.current_version as string) || '1.0.0';

        let config = await prisma.appVersionConfig.findUnique({ where: { id: 'latest' } });
        const latestVersion = config?.versionName || '2.9.4';
        const minSupportedVersion = '2.9.4';

        const rawUrl = config?.downloadUrl;
        let fullDownloadUrl = rawUrl && rawUrl.startsWith('http') && !rawUrl.includes('adiprayitno')
            ? rawUrl
            : `${GITHUB_RELEASE_BASE}/download/v${latestVersion}/SmartCBT_v${latestVersion}.apk`;

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
                changelog: config?.releaseNotes || "⚠️ Pembaruan Wajib: Seluruh versi di bawah 2.9.4 ditutup demi keamanan sistem.",
                is_force_update: true
            }
        });
    } catch (error) {
        console.error('Error fetching version v1:', error);
        res.status(500).json({ status: "error", message: 'Gagal mengecek pembaruan aplikasi' });
    }
};