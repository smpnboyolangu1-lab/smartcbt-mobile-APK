require('dotenv').config();
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

    const releaseNotes = '⚡ PEMBARUAN SISTEM RESMI: Smart CBT & School v2.9.23 (Build 195)\n' +
        '1. Perbaikan Akses Berkas Siswa (All Files Access): Solusi setelan terbatas Android 13/14+ dan tombol fallback akses berkas standar agar siswa tidak terkunci/stuck di pengaturan perangkat.\n' +
        '2. Proteksi Anti-Screenshot & Screen Recording: Penerapan FLAG_SECURE dan blokir screen recorder / overlay pada menu CBT Ujian, Lembar PR & Tugas Harian, serta Kunci Pembahasan Soal.\n' +
        '3. Perlindungan Teks & Anti-Kecurangan: Penonaktifan seleksi teks/copy-paste soal dan jawaban tugas & CBT.\n' +
        '4. Sinkronisasi Checksum SHA-256 Otomatis: Memastikan integritas berkas APK terverifikasi di server portal.';

    // 1. Update appVersionConfig for all keys (latest, app_latest, cbt_latest)
    await prisma.appVersionConfig.updateMany({
        data: {
            versionCode: 195,
            versionName: '2.9.23',
            downloadUrl: '/uploads/smartcbt-latest.apk',
            fileSizeMb,
            releaseNotes,
            isForceUpdate: false
        }
    });
    console.log('Updated all appVersionConfig records successfully.');

    // 2. Update appVersionRelease for sideload controller
    try {
        await prisma.appVersionRelease.upsert({
            where: { versionCode: 195 },
            update: {
                nomorVersi: '2.9.23',
                changelog: releaseNotes,
                fileApkUrl: '/uploads/smartcbt-latest.apk',
                fileSizeMb,
                checksumSha256: sha256,
                isForceUpdate: false,
                persentaseRollout: 100,
                status: 'ACTIVE'
            },
            create: {
                nomorVersi: '2.9.23',
                versionCode: 195,
                changelog: releaseNotes,
                fileApkUrl: '/uploads/smartcbt-latest.apk',
                fileSizeMb,
                checksumSha256: sha256,
                isForceUpdate: false,
                persentaseRollout: 100,
                status: 'ACTIVE'
            }
        });
        console.log('Updated appVersionRelease successfully.');
    } catch (e) {
        console.warn('appVersionRelease upsert skipped or errored:', e.message);
    }

    console.log('✅ APK 2.9.23 (Build 195) is officially published and checksum synced!');
}

main().catch(err => {
    console.error('Publish error:', err);
    process.exit(1);
}).finally(() => prisma.$disconnect());
