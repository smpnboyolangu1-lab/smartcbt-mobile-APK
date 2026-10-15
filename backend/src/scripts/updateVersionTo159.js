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

  let fileSizeMb = 17.4;
  let sha256 = '';

  if (sourceApk && fs.existsSync(sourceApk)) {
    const fileBuffer = fs.readFileSync(sourceApk);
    fileSizeMb = parseFloat((fileBuffer.length / (1024 * 1024)).toFixed(2));
    sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    console.log(`=== Deploying SmartCBT v2.8.149 (Build 159) ===`);
    console.log(`Using source APK: ${sourceApk}`);
    console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
    console.log(`SHA-256: ${sha256}`);

    const targets = [
      path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.149.apk'),
      path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.149-build159.apk'),
      path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
      path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-v2.8.149-build159.apk')
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
    console.log(`No compiled APK found yet. Updating database metadata to v2.8.149 (Build 159)...`);
  }

  const releaseNotes = `Pembaruan Smart CBT & School Management v2.8.149 (Build 159):
1. Pemulihan Audio Suara & Beep Presensi: Engine Text-To-Speech (TTS) dan audio feedback dioptimalkan dengan audio stream aktif (USAGE_MEDIA), proteksi anti-shutdown singleton, dan auto re-inisialisasi di seluruh dashboard sehingga ucapan sambutan dan notifikasi presensi terdengar jernih di semua tipe HP.
2. Dialog Presensi Anti-Tertutup Navbar: Tata letak dialog hasil scan kini menggunakan scrollable body dan fixed bottom action footer yang diproteksi dynamic Navigation Bar insets, memastikan tombol "Scan Ulang" dan "Kembali ke Dashboard" selalu tampak jelas di atas tombol navigasi sistem HP.
3. Tombol Kembali ke Dashboard saat Gerbang Kelas Ditutup: Memperjelas alur navigasi saat presensi kelas telah ditutup pukul 07:30 WIB dengan tombol tindakan eksplisit "🏠 Kembali ke Dashboard" dan "🏢 Scan Barcode BK".
4. Menu Pengurus Kelas Mencolok & Kontras: Tampilan tab menu Pengurus Kelas (Pantau Teman, QR Dinamis, Bantu Scan, Lapor Jam Kosong) diperbarui dengan palet warna kontras tinggi yang mencolok dan mudah dibaca di berbagai pencahayaan ruang kelas.
5. Pemulihan Server & Cloudflare Tunnel: Mengaktifkan pengawasan persistensi layanan server port 3000 dan tunnel otomatis pasca gangguan listrik.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 159,
      versionName: '2.8.149',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 159,
      versionName: '2.8.149',
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
        versionCode: 159,
        versionName: '2.8.149',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 159,
        versionName: '2.8.149',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      }
    });
  } catch (e) {
    console.warn(`Could not update 'app_latest': ${e.message}`);
  }

  // 3. Update SystemSettings for backward compatibility
  const settings = [
    { key: 'app.latest_version_code', value: '159' },
    { key: 'app.latest_version_name', value: '2.8.149' },
    { key: 'app.download_url', value: '/uploads/smartcbt-latest.apk' },
    { key: 'app.release_notes', value: releaseNotes },
    { key: 'app.is_force_update', value: 'false' },
    { key: 'app.file_size_mb', value: String(fileSizeMb) },
    { key: 'app.sha256', value: sha256 }
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value, updatedAt: new Date() },
      create: { key: s.key, value: s.value }
    });
  }
  console.log(`Updated SystemSettings for version 159`);

  console.log(`=== Done deploying SmartCBT v2.8.149 (Build 159) ===`);
}

main()
  .catch(e => {
    console.error('Error during update:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
