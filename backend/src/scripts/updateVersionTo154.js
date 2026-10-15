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

    console.log(`=== Deploying SmartCBT v2.8.144 (Build 154) ===`);
    console.log(`Using source APK: ${sourceApk}`);
    console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
    console.log(`SHA-256: ${sha256}`);

    const targets = [
      path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.144.apk'),
      path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.144-build154.apk'),
      path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
      path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-v2.8.144-build154.apk')
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
    console.log(`No compiled APK found yet. Updating database metadata to v2.8.144 (Build 154)...`);
  }

  const releaseNotes = `Pembaruan Smart CBT & School v2.8.144 (Build 154):
1. Perlindungan Google Play Protect Bersih: Menghapus izin internal sistem INSTALL_PACKAGES dari AndroidManifest sehingga APK tidak lagi dicap sebagai trojan/dropper oleh Play Protect.
2. Pemulihan Opsi Tunda Update ("Lanjutkan Dahulu"): Update tidak lagi memblokir layar aplikasi; siswa dan guru dapat menunda pembaruan kapan saja tanpa terhambat presensi pagi.
3. Manajemen Sesi & Auto-Pruning Token: Pembersihan token kedaluwarsa otomatis (auto-prune scheduler), pembatasan akumulasi sesi aktif per akun, dan eliminasi error 401.
4. Payload Lengkap Sesi Pengguna: Sesi token kini selalu menyertakan rombel kelas, ID sesi aktif, dan data mata pelajaran secara permanen.
5. Panduan Instalasi Play Protect: Modal dialog pembaruan dilengkapi petunjuk praktis 'Detail selengkapnya' -> 'Tetap instal'.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 154,
      versionName: '2.8.144',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 154,
      versionName: '2.8.144',
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
        versionCode: 154,
        versionName: '2.8.144',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 154,
        versionName: '2.8.144',
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
        versionCode: 154,
        versionName: '2.8.144',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'cbt_latest',
        versionCode: 154,
        versionName: '2.8.144',
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
        where: { versionCode: 154 },
        update: {
          nomorVersi: '2.8.144',
          changelog: releaseNotes,
          fileSizeMb,
          checksumSha256: sha256,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          isForceUpdate: false,
          status: 'ACTIVE'
        },
        create: {
          versionCode: 154,
          nomorVersi: '2.8.144',
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
