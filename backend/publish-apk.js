const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    const buildApkPath = path.resolve('C:/APK/android_app/app/build/outputs/apk/release/app-release.apk');
    if (!fs.existsSync(buildApkPath)) {
        console.error('APK file not found at:', buildApkPath);
        process.exit(1);
    }

    const apkBuffer = fs.readFileSync(buildApkPath);
    const stat = fs.statSync(buildApkPath);
    const fileSizeMb = parseFloat((stat.size / (1024 * 1024)).toFixed(2));
    const sha256 = crypto.createHash('sha256').update(apkBuffer).digest('hex');

    console.log(`Found compiled APK: ${buildApkPath}`);
    console.log(`Size: ${fileSizeMb} MB (${stat.size} bytes), SHA-256: ${sha256}`);

    // Destination target paths
    const destinations = [
        path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
        path.resolve('C:/APK/backend/uploads/SmartSchool_CBT_Release.apk'),
        path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
        path.resolve('C:/APK/backend/smartcbt-latest.apk')
    ];

    for (const dest of destinations) {
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.copyFileSync(buildApkPath, dest);
        console.log(`Copied APK to: ${dest}`);
    }

    const releaseNotes = 'Pembaruan Smart CBT & School v2.9.3 (Build 173):\n' +
        '1. Stabilitas Pembaruan: Pengecekan versi definitif tanpa perulangan dialog.\n' +
        '2. Mode Notifikasi Ringan: Latar belakang bersih tanpa notifikasi berjalan terus-menerus.\n' +
        '3. Keamanan Presensi: QR Statis dinonaktifkan total, digantikan Dynamic Class QR Session.\n' +
        '4. Notifikasi Suara Pengurus: Suara TTS otomatis saat presensi terbaca oleh pengurus kelas.\n' +
        '5. Notifikasi Orang Tua: Laporan keterlambatan dikirimkan langsung ke WhatsApp orang tua.';

    // 1. Update appVersionConfig for all keys (latest, app_latest, cbt_latest)
    await prisma.appVersionConfig.updateMany({
        data: {
            versionCode: 173,
            versionName: '2.9.3',
            downloadUrl: 'https://github.com/adiprayitno160-glitch/smartcbt-mobile-APK/releases/download/v2.9.3/SmartCBT_v2.9.3.apk',
            fileSizeMb,
            releaseNotes,
            isForceUpdate: true
        }
    });
    console.log('Updated all appVersionConfig records successfully.');

    // 2. Update appVersionRelease for sideload controller
    if (prisma.appVersionRelease) {
        await prisma.appVersionRelease.upsert({
        where: { versionCode: 173 },
        update: {
            nomorVersi: '2.9.3',
            changelog: releaseNotes,
            fileApkUrl: 'https://github.com/adiprayitno160-glitch/smartcbt-mobile-APK/releases/download/v2.9.3/SmartCBT_v2.9.3.apk',
            fileSizeMb,
            checksumSha256: sha256,
            isForceUpdate: true,
            persentaseRollout: 100,
            status: 'ACTIVE'
        },
        create: {
            nomorVersi: '2.9.3',
            versionCode: 173,
            changelog: releaseNotes,
            fileApkUrl: 'https://github.com/adiprayitno160-glitch/smartcbt-mobile-APK/releases/download/v2.9.3/SmartCBT_v2.9.3.apk',
            fileSizeMb,
            checksumSha256: sha256,
            isForceUpdate: true,
            persentaseRollout: 100,
            status: 'ACTIVE'
        }
    });
    console.log('Updated appVersionRelease successfully.');
    }

    console.log('✅ APK 2.9.3 (Build 173) is officially published and ready for direct download by all students!');
}

main().catch(err => {
    console.error('Publish error:', err);
    process.exit(1);
}).finally(() => prisma.$disconnect());
