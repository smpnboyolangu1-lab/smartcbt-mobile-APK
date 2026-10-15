import { Request, Response } from 'express';
import prisma from '../utils/db';

export const GITHUB_RELEASE_BASE = 'https://github.com/adiprayitno160-glitch/smartcbt-mobile-APK/releases';
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
        
        if (!config || config.versionCode < 173 || !config.downloadUrl || config.downloadUrl.startsWith('/uploads')) {
            const releaseNotes293 = 'Pembaruan Smart CBT & School v2.9.3 (Build 173):\n' +
                '1. Perlindungan Privasi & Arsip Google Drive Terbatas: Berkas yang diunggah hanya 3 jenis (KK, Akta Kelahiran, dan Dokumen Afirmasi netral dok-3.pdf). Pas foto, rapor, dan ijazah SD tetap aman di server sekolah. Paket dienkripsi penuh AES-256-CBC dengan verifikasi hash SHA-256.\n' +
                '2. Kebijakan Anti-Joki Khusus Siswa: Penghapusan total Device Binding untuk Guru, Staf TU/Kesiswaan, Operator, BK, Satpam, dan Orang Tua sehingga dapat login bebas dari perangkat atau browser apa pun tanpa terkunci.\n' +
                '3. Generator NIS Terpadu & Bebas Tabrakan: Alokasi urutan NIS transaksional atomic, melanjutkan counter kohor tanpa menimpa nomor siswa yang telah terbit.\n' +
                '4. Siklus Mutasi & Kenaikan Kelas Komprehensif: Dukungan siswa tinggal kelas, otomasi mutasi keluar/masuk dengan pencabutan token sesi aktif dan sinkronisasi akun orang tua.\n' +
                '5. Audit Akses Dokumen: Rekam jejak transparan setiap akses berkas kesiswaan demi menjamin integritas dan martabat data siswa.';

            const targetGithubUrl = `${GITHUB_RELEASE_BASE}/download/v2.9.3/SmartCBT_v2.9.3.apk`;

            config = await prisma.appVersionConfig.upsert({
                where: { id: 'latest' },
                update: {
                    versionCode: 173,
                    versionName: '2.9.3',
                    downloadUrl: targetGithubUrl,
                    fileSizeMb: 18.5,
                    releaseNotes: releaseNotes293,
                    isForceUpdate: false
                },
                create: {
                    id: 'latest',
                    versionCode: 173,
                    versionName: '2.9.3',
                    downloadUrl: targetGithubUrl,
                    fileSizeMb: 18.5,
                    releaseNotes: releaseNotes293,
                    isForceUpdate: false
                }
            });
        }

        // Pastikan URL download selalu mengarah ke GitHub Releases CDN resmi berkecepatan tinggi
        let resolvedDownloadUrl = config.downloadUrl;
        if (!resolvedDownloadUrl || resolvedDownloadUrl.startsWith('/') || resolvedDownloadUrl.includes('cbt.smpn1boyolangu.my.id')) {
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
        const latestVersion = config?.versionName || '2.9.3';
        const minSupportedVersion = '2.9.0';

        const rawUrl = config?.downloadUrl;
        let fullDownloadUrl = rawUrl && rawUrl.startsWith('http') && !rawUrl.includes('cbt.smpn1boyolangu.my.id')
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
                changelog: config?.releaseNotes || "Pembaruan stabilitas sistem presensi, verifikasi Satpam Gatepass, dan perbaikan koneksi.",
                is_force_update: config?.isForceUpdate ?? false
            }
        });
    } catch (error) {
        console.error('Error fetching version v1:', error);
        res.status(500).json({ status: "error", message: 'Gagal mengecek pembaruan aplikasi' });
    }
};