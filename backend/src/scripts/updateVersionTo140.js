const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const sourceApk = path.resolve('C:/APK/android_app/app/build/outputs/apk/release/app-release.apk');

  if (!fs.existsSync(sourceApk)) {
    console.error(`Source APK not found at: ${sourceApk}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(sourceApk);
  const fileSizeMb = parseFloat((fileBuffer.length / (1024 * 1024)).toFixed(2));
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  console.log(`=== Deploying SmartCBT v2.8.130 (Build 140) ===`);
  console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
  console.log(`SHA-256: ${sha256}`);

  // Target destinations
  const targets = [
    path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
    path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.130.apk'),
    path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.130-build140.apk'),
    path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
    path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
    path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
    path.resolve('C:/APK/smartcbt-latest.apk'),
    path.resolve('C:/APK/smartcbt-v2.8.130-build140.apk')
  ];

  for (const target of targets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(sourceApk, target);
    console.log(`Copied to: ${target}`);
  }

  const releaseNotes = `Pembaruan Smart CBT & School v2.8.130 (Build 140):
1. Sinkronisasi Dinamis Ekstrakurikuler: Katalog 11 ekstrakurikuler kini terhubung 100% dinamis dengan database backend secara realtime (nama, jadwal, pelatih, kuota, persyaratan).
2. Pendaftaran Ekstra Terverifikasi: Pendaftaran minat & bakat siswa tersimpan langsung ke database resmi sekolah dengan validasi maksimal 2 ekskul per siswa.
3. Portal Pembina Ekstrakurikuler di APK Guru: Ditambahkan menu akses cepat 'Pembina Ekstrakurikuler' pada Management Hub Guru untuk mempermudah absensi sesi dan pendataan anggota di lapangan.
4. Jadwal Latihan Terpersonalisasi & Portofolio Bersih: Tab jadwal memprioritaskan kegiatan yang diikuti siswa dan tab portofolio menampilkan status piagam resmi yang bersih tanpa data dummy.
5. URL Dinamis Cetak Rekap PDF: Seluruh endpoint cetak berkas dan rekap presensi di portal Wali Kelas dan Guru kini sepenuhnya menggunakan host dinamis aktif (LAN / Online failover).`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 140,
      versionName: '2.8.130',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 140,
      versionName: '2.8.130',
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
        versionCode: 140,
        versionName: '2.8.130',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 140,
        versionName: '2.8.130',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      }
    });
    console.log(`Updated AppVersionConfig 'app_latest'`);
  } catch (e) {
    console.log(`Note for app_latest:`, e.message);
  }

  // 3. Upsert AppVersionRelease (for staged OTA check)
  const release = await prisma.appVersionRelease.upsert({
    where: { versionCode: 140 },
    update: {
      nomorVersi: '2.8.130',
      changelog: releaseNotes,
      fileApkUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      checksumSha256: sha256,
      isForceUpdate: false,
      status: 'ACTIVE',
      persentaseRollout: 100
    },
    create: {
      versionCode: 140,
      nomorVersi: '2.8.130',
      changelog: releaseNotes,
      fileApkUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      checksumSha256: sha256,
      isForceUpdate: false,
      status: 'ACTIVE',
      persentaseRollout: 100
    }
  });
  console.log(`Updated AppVersionRelease 140:`, release);

  // 4. Update default version configs if any other keys
  try {
    await prisma.appVersionConfig.updateMany({
      where: {
        id: { in: ['default', 'global', 'android'] }
      },
      data: {
        versionCode: 140,
        versionName: '2.8.130',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        updatedAt: new Date()
      }
    });
  } catch (err) {
    console.log(`Note for additional configs:`, err.message);
  }

  console.log('\n=== Deployment v2.8.130 (Build 140) Selesai Sukses! ===');
}

main()
  .catch((e) => {
    console.error('Error during deployment:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
