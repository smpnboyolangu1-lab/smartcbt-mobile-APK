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

    console.log(`=== Deploying SmartCBT v2.8.143 (Build 153) ===`);
    console.log(`Using source APK: ${sourceApk}`);
    console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
    console.log(`SHA-256: ${sha256}`);

    const targets = [
      path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.143.apk'),
      path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.143-build153.apk'),
      path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
      path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-v2.8.143-build153.apk')
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
    console.log(`No compiled APK found yet. Updating database metadata to v2.8.143 (Build 153)...`);
  }

  const releaseNotes = `Pembaruan Smart CBT & School v2.8.143 (Build 153):
1. Menu Siswa & Modul Hafalan Juz 30 (Juz 'Amma): Mengatasi celah menu kosong di dashboard siswa dengan susunan grid 4 kolom simetris dan modul hafalan Juz 30 lengkap (Surah 78-114).
2. Segmentasi Tab Dashboard Guru: Dashboard guru ditata rapi menjadi 3 tab tersegmentasi: [Presensi KBM], [Rekap Mapel], dan [Wali Kelas].
3. Target Rombel Ulangan Harian Multi-Centang: Pemilihan kelas sasaran ulangan harian mendukung multi-checkbox (misal: VII-A & VII-B saja).
4. Penguncian Hak Akses CBT Ujian Harian: Siswa di luar kelas yang dicentang guru diblokir secara ketat dari pengerjaan ulangan.
5. Jadwal Ulangan Harian: Pembuatan ulangan harian dilengkapi pemilih tanggal serta jam mulai/selesai KBM.
6. Posko Guru Piket Dinamis & Lapor Khusus Pengurus Kelas: Guru piket berganti otomatis sesuai jadwal piket hari ini, dan hak lapor jam kosong hanya diberikan kepada Pengurus Kelas.
7. Dual Routing Laporan Jam Kosong (Piket & Kurikulum): Laporan otomatis diteruskan serentak ke Guru Piket dan Tim Kurikulum dengan FCM push notification.
8. Sinkronisasi Guru Mapel Riil: Seluruh 1.221 jadwal KBM disinkronkan ke guru pengampu riil portal sekolah.
9. Modul Ekstrakurikuler Terintegrasi: Informasi pelatih dan kegiatan ekskul bersumber dinamis dari database portal.
10. Hub Terpadu Tugas & Ujian: Menu "Tugas & PR" diperbarui menjadi "Tugas & Ujian" yang menyatukan tugas dan ulangan harian.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 153,
      versionName: '2.8.143',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 153,
      versionName: '2.8.143',
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
        versionCode: 153,
        versionName: '2.8.143',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 153,
        versionName: '2.8.143',
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
        versionCode: 153,
        versionName: '2.8.143',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'cbt_latest',
        versionCode: 153,
        versionName: '2.8.143',
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
        where: { versionCode: 153 },
        update: {
          nomorVersi: '2.8.143',
          changelog: releaseNotes,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          fileSizeMb,
          checksumSha256: sha256 || null,
          isForceUpdate: true,
          status: 'ACTIVE'
        },
        create: {
          nomorVersi: '2.8.143',
          versionCode: 153,
          changelog: releaseNotes,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          fileSizeMb,
          checksumSha256: sha256 || null,
          isForceUpdate: true,
          status: 'ACTIVE'
        }
      });
      console.log(`Recorded to AppVersionRelease history.`);
    }
  } catch (e) {
    console.warn(`Could not record to AppVersionRelease:`, e.message);
  }

  console.log(`Deployment script finished successfully.`);
}

main()
  .catch(e => {
    console.error('Error during deployment:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
