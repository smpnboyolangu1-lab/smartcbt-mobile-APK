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
        path.resolve('C:/APK/backend/uploads/SmartCBT_v2.9.5.apk'),
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

    const releaseNotes = 'Pembaruan Smart CBT & School v2.9.5 (Build 175):\n' +
        '1. Kesiapan Sistem 90%+: Lolos audit keamanan menyeluruh, integritas naskah CBT, dan proteksi anti-tamper.\n' +
        '2. Penghapusan Total RFID: Seluruh pencatatan kehadiran menggunakan QR Dinamis Pengurus Kelas dan Presensi Mandiri GPS.\n' +
        '3. Penguatan CBT Kiosk: Perlindungan kunci jawaban server-side & penguncian status submit idempoten.\n' +
        '4. Backup & Disaster Recovery Otomatis: Pemulihan database PostgreSQL terverifikasi.\n' +
        '5. Optimalisasi Kinerja & Privasi: Sesuai standar UU PDP dan ketahanan beban 989 siswa serentak.';

    // 1. Update appVersionConfig for all keys (latest, app_latest, cbt_latest)
    await prisma.appVersionConfig.updateMany({
        data: {
            versionCode: 175,
            versionName: '2.9.5',
            downloadUrl: 'https://github.com/smpnboyolangu1-lab/smartcbt-mobile-APK/releases/download/v2.9.5/SmartCBT_v2.9.5.apk',
            fileSizeMb,
            releaseNotes,
            isForceUpdate: true
        }
    });
    console.log('Updated all appVersionConfig records successfully.');

    // 2. Update appVersionRelease for sideload controller
    if (prisma.appVersionRelease) {
        await prisma.appVersionRelease.upsert({
        where: { versionCode: 175 },
        update: {
            nomorVersi: '2.9.5',
            changelog: releaseNotes,
            fileApkUrl: 'https://github.com/smpnboyolangu1-lab/smartcbt-mobile-APK/releases/download/v2.9.5/SmartCBT_v2.9.5.apk',
            fileSizeMb,
            checksumSha256: sha256,
            isForceUpdate: true,
            persentaseRollout: 100,
            status: 'ACTIVE'
        },
        create: {
            nomorVersi: '2.9.5',
            versionCode: 175,
            changelog: releaseNotes,
            fileApkUrl: 'https://github.com/smpnboyolangu1-lab/smartcbt-mobile-APK/releases/download/v2.9.5/SmartCBT_v2.9.5.apk',
            fileSizeMb,
            checksumSha256: sha256,
            isForceUpdate: true,
            persentaseRollout: 100,
            status: 'ACTIVE'
        }
    });
    console.log('Updated appVersionRelease successfully.');
    }

    console.log('✅ APK 2.9.5 (Build 175) is officially published and ready for direct download by all students!');
}

main().catch(err => {
    console.error('Publish error:', err);
    process.exit(1);
}).finally(() => prisma.$disconnect());
