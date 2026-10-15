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

  let fileSizeMb = 17.5;
  let sha256 = '';

  if (sourceApk && fs.existsSync(sourceApk)) {
    const fileBuffer = fs.readFileSync(sourceApk);
    fileSizeMb = parseFloat((fileBuffer.length / (1024 * 1024)).toFixed(2));
    sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    console.log(`=== Deploying SmartCBT v2.8.137 (Build 147) ===`);
    console.log(`Using source APK: ${sourceApk}`);
    console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
    console.log(`SHA-256: ${sha256}`);

    const targets = [
      path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.137.apk'),
      path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.137-build147.apk'),
      path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
      path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-v2.8.137-build147.apk')
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
    console.log(`No compiled APK found yet. Updating database metadata to v2.8.137 (Build 147)...`);
  }

  const releaseNotes = `Pembaruan Smart CBT & School v2.8.137 (Build 147):
1. Pembebasan Penguncian Akun Guru & Staf: Anti-double login strictly hanya berlaku untuk akun Siswa saat ujian. Guru, Wali Kelas, Guru BK, Operator, Satpam, dan Orang Tua bebas login tanpa terkunci.
2. Pemulihan Pemuatan Data Guru: Mengatasi spinner loading terus-menerus pada data rombel dan sesi ujian aktif guru (Mavrik Sartika, Arsyad, dll).
3. Rekapitulasi Presensi Mapel: Perbaikan query data foto siswa pada laporan rekap kelas guru sehingga rekapitulasi dapat dimuat tanpa kendala.
4. Jadwal Sholat Tepat Waktu: Sinkronisasi pemuatan jadwal sholat harian pada akun guru dan siswa.
5. Modul Presensi Guru Masuk & Keluar Kelas: Label dan alur check-in/check-out KBM diperjelas menjadi "PRESENSI GURU MASUK KELAS" dan "PRESENSI GURU KELUAR KELAS" dengan pencatatan log kehadiran resmi secara real-time.
6. Logout Terintegrasi: Penambahan pembersihan sesi aktif di server secara otomatis saat menekan tombol Keluar.
7. Pembatasan Pengumuman 1 x 24 Jam: Notifikasi dan dialog pengumuman kepulangan lebih awal hanya aktif maksimal 1 x 24 jam dan dicegah muncul berulang.
8. Filter Dispensasi & Izin Masa Lalu: Notifikasi izin keluar dan dispensasi BK lampau tidak akan muncul kembali.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 147,
      versionName: '2.8.137',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: true,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 147,
      versionName: '2.8.137',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: true,
      updatedAt: new Date()
    }
  });
  console.log(`Updated AppVersionConfig 'latest':`, config);

  // 2. Also update app_latest
  try {
    await prisma.appVersionConfig.upsert({
      where: { id: 'app_latest' },
      update: {
        versionCode: 147,
        versionName: '2.8.137',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: true,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 147,
        versionName: '2.8.137',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: true,
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
        versionCode: 147,
        versionName: '2.8.137',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: true,
        updatedAt: new Date()
      },
      create: {
        id: 'cbt_latest',
        versionCode: 147,
        versionName: '2.8.137',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: true,
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
        where: { versionCode: 147 },
        update: {
          nomorVersi: '2.8.137',
          changelog: releaseNotes,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          fileSizeMb,
          checksumSha256: sha256 || null,
          isForceUpdate: true,
          status: 'ACTIVE'
        },
        create: {
          nomorVersi: '2.8.137',
          versionCode: 147,
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
