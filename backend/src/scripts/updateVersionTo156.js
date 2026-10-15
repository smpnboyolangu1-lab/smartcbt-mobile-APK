const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const possibleSources = [
    path.resolve('C:/APK/android_app/app/build/outputs/apk/release/app-release.apk'),
    path.resolve('C:/APK/android_app/app/build/outputs/apk/debug/app-debug.apk')
  ];

  let sourceApk = possibleSources.find(p => fs.existsSync(p));

  let fileSizeMb = 18.0;
  let sha256 = '';

  if (sourceApk && fs.existsSync(sourceApk)) {
    const fileBuffer = fs.readFileSync(sourceApk);
    fileSizeMb = parseFloat((fileBuffer.length / (1024 * 1024)).toFixed(2));
    sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    console.log(`=== Deploying SmartCBT v2.8.146 (Build 156) ===`);
    console.log(`Using source APK: ${sourceApk}`);
    console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
    console.log(`SHA-256: ${sha256}`);

    const targets = [
      path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.146.apk'),
      path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.146-build156.apk'),
      path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
      path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-v2.8.146-build156.apk')
    ];

    for (const target of targets) {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.copyFileSync(sourceApk, target);
      console.log(`Copied to: ${target}`);
    }
  } else {
    console.log(`No compiled APK found yet. Updating database metadata to v2.8.146 (Build 156)...`);
  }

  const releaseNotes = `Pembaruan Smart CBT & School v2.8.146 (Build 156):
1. QR Dinamis Pengurus Kelas (10 Detik): Menghadirkan kode QR presensi dinamis yang berputar setiap 10 detik di menu pengurus kelas (anti-foto, anti-joki, anti-scan dari rumah).
2. Proteksi Stiker Kelas & Narasi Suara TTS: Pemindaian stiker kelas tanpa GPS valid otomatis ditolak dan diarahkan dengan suara: "Presensi GPS tidak terkunci. Silakan pindai QR Dinamis pada HP Pengurus Kelas Anda."
3. Modernisasi Antarmuka Pengurus Kelas: Tampilan elegan 4-tab (Pantau Teman, QR Dinamis 10s, Bantu Scan, Lapor Jam Kosong) dengan countdown timer dan progress bar interaktif.
4. Perbaikan Menu Tugas & Ujian Bebas Layar Gelap: Mengubah dialog dari tema hitam kaku menjadi tema terang modern (#F8FAFC) dengan header biru profesional (#1E40AF) serta pemuatan data instan.
5. Pembersihan Data Dummy 100%: Menghapus seluruh data palsu pada modul Ekstrakurikuler dan Laporan Piket Kurikulum secara tuntas.
6. Panduan Terpercaya Google Play Protect: Edukasi resmi alasan instalasi aplikasi internal SMPN 1 Boyolangu non-Play Store publik dengan opsi update fleksibel tanpa memblokir aktivitas siswa.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 156,
      versionName: '2.8.146',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 156,
      versionName: '2.8.146',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    }
  });
  console.log(`Updated AppVersionConfig 'latest':`, config);

  // 2. Also update app_latest
  try {
    await prisma.appVersionConfig.upsert({
      where: { id: 'app_latest' },
      update: {
        versionCode: 156,
        versionName: '2.8.146',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 156,
        versionName: '2.8.146',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      }
    });
    console.log(`Updated AppVersionConfig 'app_latest'`);
  } catch (e) {
    console.warn(`Could not update app_latest:`, e.message);
  }

  // 3. Also update cbt_latest
  try {
    await prisma.appVersionConfig.upsert({
      where: { id: 'cbt_latest' },
      update: {
        versionCode: 156,
        versionName: '2.8.146',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'cbt_latest',
        versionCode: 156,
        versionName: '2.8.146',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      }
    });
    console.log(`Updated AppVersionConfig 'cbt_latest'`);
  } catch (e) {
    console.warn(`Could not update cbt_latest:`, e.message);
  }

  // 4. Record to AppVersionRelease history if model exists
  try {
    if (prisma.appVersionRelease) {
      await prisma.appVersionRelease.upsert({
        where: { versionCode: 156 },
        update: {
          nomorVersi: '2.8.146',
          changelog: releaseNotes,
          fileSizeMb,
          checksumSha256: sha256,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          isForceUpdate: false,
          status: 'ACTIVE'
        },
        create: {
          versionCode: 156,
          nomorVersi: '2.8.146',
          changelog: releaseNotes,
          fileSizeMb,
          checksumSha256: sha256,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          isForceUpdate: false,
          status: 'ACTIVE'
        }
      });
      console.log(`Recorded to AppVersionRelease history.`);
    }
  } catch (e) {
    console.warn(`Could not update AppVersionRelease:`, e.message);
  }

  console.log(`Deployment script finished successfully.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
