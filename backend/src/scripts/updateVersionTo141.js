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

  console.log(`=== Deploying SmartCBT v2.8.131 (Build 141) ===`);
  console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
  console.log(`SHA-256: ${sha256}`);

  // Target destinations
  const targets = [
    path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
    path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.131.apk'),
    path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.131-build141.apk'),
    path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
    path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
    path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
    path.resolve('C:/APK/smartcbt-latest.apk'),
    path.resolve('C:/APK/smartcbt-v2.8.131-build141.apk')
  ];

  for (const target of targets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(sourceApk, target);
    console.log(`Copied to: ${target}`);
  }

  const releaseNotes = `Pembaruan Presisi Smart CBT & School v2.8.131 (Build 141):
1. Pemindaian Presensi 100% Otomatis: Menghilangkan pop-up pemilihan GPS vs QR Fallback saat akurasi satelit terdegradasi. Siswa dapat langsung memindai QR kelas secara instan dengan verifikasi geofence dan anti Fake-GPS tetap aktif penuh di latar belakang.
2. Penegasan Jadwal Terlambat (07:00:01 - 07:30:00 WIB): Presensi langsung di ruang kelas tetap DITERIMA SAH dengan status Terlambat (+2 poin kedisiplinan). Siswa langsung dipersilakan masuk kelas tanpa hambatan.
3. Penutupan Gerbang Kelas ke Ruang BK (> 07:30:00 WIB): Pukul 07:30:00 WIB gerbang mandiri kelas ditutup resmi, dan siswa diarahkan ke Ruang BK untuk pendataan Guru BK via QR BK / surat izin masuk.
4. Koreksi Cerdas Hari Minggu & Libur Sekolah: Penanganan prioritas tinggi untuk hari Minggu dan hari libur sekolah dengan tampilan ucapan selamat berakhir pekan yang ramah, menghilangkan notifikasi keliru 'Gerbang Ditutup / Hubungi Wali Kelas'.
5. Edukasi Barcode Kepulangan (Gate-Out) Pagi Hari: Jika siswa tidak sengaja atau panik memindai barcode Gate-Out di pagi hari, aplikasi memberikan informasi edukatif bahwa yang dipindai adalah barcode kepulangan yang sedang ditutup, dan memandu siswa memindai Barcode Masuk (Gate-In) tanpa rasa cemas.
6. Konfirmasi Duplikasi Kepulangan Hijau: Pemindaian barcode kepulangan ulang di siang hari kini mengonfirmasi status kehadiran pulang dengan aman dan sah tanpa pesan penolakan yang membingungkan.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 141,
      versionName: '2.8.131',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 141,
      versionName: '2.8.131',
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
        versionCode: 141,
        versionName: '2.8.131',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 141,
        versionName: '2.8.131',
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
    where: { versionCode: 141 },
    update: {
      nomorVersi: '2.8.131',
      changelog: releaseNotes,
      fileApkUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      checksumSha256: sha256,
      isForceUpdate: false,
      status: 'ACTIVE',
      persentaseRollout: 100
    },
    create: {
      versionCode: 141,
      nomorVersi: '2.8.131',
      changelog: releaseNotes,
      fileApkUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      checksumSha256: sha256,
      isForceUpdate: false,
      status: 'ACTIVE',
      persentaseRollout: 100
    }
  });
  console.log(`Updated AppVersionRelease 141:`, release);

  // 4. Update default version configs if any other keys
  try {
    await prisma.appVersionConfig.updateMany({
      where: {
        id: { in: ['default', 'global', 'android'] }
      },
      data: {
        versionCode: 141,
        versionName: '2.8.131',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        updatedAt: new Date()
      }
    });
  } catch (err) {
    console.log(`Note for additional configs:`, err.message);
  }

  console.log('\n=== Deployment v2.8.131 (Build 141) Selesai Sukses! ===');
}

main()
  .catch((e) => {
    console.error('Error during deployment:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
