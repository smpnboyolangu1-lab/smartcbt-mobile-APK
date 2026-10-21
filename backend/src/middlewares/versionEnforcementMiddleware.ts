import { Request, Response, NextFunction } from 'express';

export const enforceMinimumAppVersion = (req: Request, res: Response, next: NextFunction) => {
    // Whitelist path yang wajib bisa diakses tanpa syarat versi (cek update, report error, jam server, konteks sekolah)
    const bypassPaths = [
        '/api/app/version-check',
        '/api/app/version',
        '/api/v1/app/check-version',
        '/api/client-logs',
        '/api/server-time',
        '/api/sekolah/konteks',
        '/uploads',
        '/downloads'
    ];

    const currentPath = req.originalUrl || req.url || '';
    for (const bypass of bypassPaths) {
        if (currentPath.startsWith(bypass)) {
            return next();
        }
    }

    const rawAppVersion = req.headers['x-app-version'] as string | undefined;

    // Jika bukan dari APK mobile (misalnya akses dari web portal admin/guru/kurikulum/browser), loloskan
    if (!rawAppVersion) {
        return next();
    }

    // Bersihkan format versi (misal: "v2.9.3" -> "2.9.3", "2.9.3-debug" -> "2.9.3")
    const cleanVer = rawAppVersion.trim().replace(/^v/i, '').split('-')[0];
    const parts = cleanVer.split('.').map(p => parseInt(p, 10));
    const major = isNaN(parts[0]) ? 0 : parts[0];
    const minor = isNaN(parts[1]) ? 0 : parts[1];
    const patch = isNaN(parts[2]) ? 0 : parts[2];

    // Syarat Minimum Versi: Wajib >= 2.9.4
    const isBelow294 = major < 2 || (major === 2 && minor < 9) || (major === 2 && minor === 9 && patch < 4);

    if (isBelow294) {
        return res.status(426).json({
            success: false,
            message: `⛔ Akses Versi Ini Telah Ditutup: Anda menggunakan Smart CBT v${rawAppVersion}. Versi di bawah 2.9.4 telah dinonaktifkan demi stabilitas & keamanan sistem sekolah. Harap perbarui ke versi terbaru untuk melanjutkan.`,
            requireUpdate: true,
            currentVersion: rawAppVersion,
            latestVersion: '2.9.11',
            downloadUrl: 'https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk'
        });
    }

    next();
};
