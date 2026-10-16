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
        
        const releaseNotes297 = '⚡ PEMBARUAN SISTEM RESMI: Smart CBT v2.9.7 (Build 177)\n' +
            '1. Optimalisasi Kontak Darurat Terpadu: Nomor darurat (Puskesmas Boyolangu, PSC 119, Satpam Sekolah, Polsek) tersinkronisasi dinamis dari portal sekolah ke seluruh APK.\n' +
            '2. Pembaruan Humanis Perpustakaan: Peniadaan denda keterlambatan dan jaminan ijazah/rapor tidak tertahan; penambahan kartu anggota digital dengan barcode.\n' +
            '3. Presensi & Monitoring KBM Akurat: Perbaikan sinkronisasi zona waktu WIB pada layanan UKS dan penugasan guru piket.\n' +
            '4. Peningkatan Keamanan & Kecepatan Unduhan: Unduhan update otomatis langsung dari server sekolah lokal dengan verifikasi checksum SHA-256.';

        const defaultDownloadUrl = '/uploads/smartcbt-latest.apk';

        if (!config || config.versionCode < 177 || config.downloadUrl?.includes('adiprayitno')) {
            config = await prisma.appVersionConfig.upsert({
                where: { id: 'latest' },
                update: {
                    versionCode: 177,
                    versionName: '2.9.7',
                    downloadUrl: defaultDownloadUrl,
                    fileSizeMb: 18.2,
                    releaseNotes: releaseNotes297,
                    isForceUpdate: false
                },
                create: {
                    id: 'latest',
                    versionCode: 177,
                    versionName: '2.9.7',
                    downloadUrl: defaultDownloadUrl,
                    fileSizeMb: 18.2,
                    releaseNotes: releaseNotes297,
                    isForceUpdate: false
                }
            });
        }

        // Pastikan URL download mengarah ke server lokal jika belum diatur atau kosong
        let resolvedDownloadUrl = config.downloadUrl;
        if (!resolvedDownloadUrl || resolvedDownloadUrl.includes('adiprayitno')) {
            resolvedDownloadUrl = '/uploads/smartcbt-latest.apk';
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

        const rawUrl = config?.downloadUrl || '';
        let fullDownloadUrl = '/uploads/smartcbt-latest.apk';
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
                changelog: config?.releaseNotes || "Pembaruan sistem resmi Smart CBT.",
                is_force_update: config?.isForceUpdate ?? false
            }
        });
    } catch (error) {
        console.error('Error fetching version v1:', error);
        res.status(500).json({ status: "error", message: 'Gagal mengecek pembaruan aplikasi' });
    }
};