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

  let fileSizeMb = 18.2;
  let sha256 = '';

  if (sourceApk && fs.existsSync(sourceApk)) {
    const fileBuffer = fs.readFileSync(sourceApk);
    fileSizeMb = parseFloat((fileBuffer.length / (1024 * 1024)).toFixed(2));
    sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    console.log(`=== Deploying SmartCBT v2.8.148 (Build 158) ===`);
    console.log(`Using source APK: ${sourceApk}`);
    console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
    console.log(`SHA-256: ${sha256}`);

    const targets = [
      path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.148.apk'),
      path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.148-build158.apk'),
      path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
      path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-v2.8.148-build158.apk')
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
    console.log(`No compiled APK found yet. Updating database metadata to v2.8.148 (Build 158)...`);
  }

  const releaseNotes = `Pembaruan Smart CBT & School Management v2.8.148 (Build 158):
1. 1-Tap Lapor Kelas Kosong Terpadu: Pelaporan jam kosong dari Pengurus Kelas disederhanakan menjadi 1 tombol instan ("🚨 Lapor Jam Kelas Kosong") yang otomatis terkirim serentak ke Guru Piket dan Tim Kurikulum secara real-time.
2. Geolocation Presensi Guru di Kelas: Verifikasi presensi masuk kelas (1 TAP [ IN KELAS ]) kini wajib menggunakan koordinat GPS valid dan geofence lingkungan sekolah/ruang kelas dengan proteksi anti-Fake GPS.
3. Penataan Simetris Menu Siswa (4, 4, 4, 2): Tampilan icon dashboard beranda siswa ditata seimbang dan rapi (Row 1: 4 menu, Row 2: 4 menu, Row 3: 4 menu, Row 4: 2 menu di tengah secara dinamis dan simetris).
4. Animasi Berkedip Panduan Play Protect: Notifikasi edukasi instalasi non-Play Store ("Detail selengkapnya" → "Tetap instal") kini dilengkapi efek kedip dinamis (pulsing blink) yang mencolok dan mudah dipahami.
5. WhatsApp Gateway Mandiri Baileys (Multi-Device): Integrasi langsung WhatsApp resmi SMPN 1 Boyolangu via scan QR di Web Admin (/admin/pengaturan) dengan format pesan sopan & langsung ke intinya untuk notifikasi keterlambatan dan presensi gerbang.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 158,
      versionName: '2.8.148',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 158,
      versionName: '2.8.148',
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
        versionCode: 158,
        versionName: '2.8.148',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 158,
        versionName: '2.8.148',
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
    { key: 'app.latest_version_code', value: '158' },
    { key: 'app.latest_version_name', value: '2.8.148' },
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
  console.log(`Updated SystemSettings for version 158`);

  console.log(`=== Done deploying SmartCBT v2.8.148 (Build 158) ===`);
}

main()
  .catch(e => {
    console.error('Error during update:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
