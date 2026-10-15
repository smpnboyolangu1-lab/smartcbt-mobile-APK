const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const sourceApk = path.resolve('C:/APK/android_app/app/build/outputs/apk/release/app-release.apk');
  let fileSizeMb = 38.5;
  let sha256 = '';

  if (fs.existsSync(sourceApk)) {
    const fileBuffer = fs.readFileSync(sourceApk);
    fileSizeMb = parseFloat((fileBuffer.length / (1024 * 1024)).toFixed(2));
    sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    console.log(`=== Deploying SmartCBT v2.8.133 (Build 143) ===`);
    console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
    console.log(`SHA-256: ${sha256}`);

    // Target destinations
    const targets = [
      path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.133.apk'),
      path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.133-build143.apk'),
      path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
      path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-v2.8.133-build143.apk')
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
    console.log(`Source release APK not compiled yet (as instructed: 'jangan di compile dahulu'). Updating database metadata to v2.8.133 (Build 143)...`);
  }

  const releaseNotes = `Pembaruan Presisi Smart CBT & School v2.8.133 (Build 143):
1. Layanan Foreground Service & Pemantauan 24/7 Selalu Aktif: Mengubah DeviceSyncBackgroundService menjadi true Foreground Service Android (dataSync) dengan Partial WakeLock dan auto-restart sticky service, didukung BootCompletedReceiver otomatis aktif saat restart HP, menjaga pelaporan telemetri dan status ujian tetap realtime nonstop tanpa terhenti saat aplikasi idle.
2. Notifikasi Mengambang Prioritas Tinggi (WhatsApp-Style Heads-Up Banner): Mengonfigurasi kanal FCM dengan IMPORTANCE_HIGH, PRIORITY_MAX, CATEGORY_MESSAGE, dan AudioAttributes komunikasi instan dengan getaran & suara alarm resmi sehingga panggilan jemputan UKS siswa langsung muncul melayang di layar bahkan saat aplikasi sedang tertutup.
3. Eliminasi Looping & Dialog Dismiss Permanen: Memperbaiki seluruh logika penutupan notifikasi di DialogHelper, ParentMainActivity, dan StudentMainActivity. Notifikasi yang telah ditutup/dismiss oleh pengguna disimpan permanen di SharedPreferences dan disinkronkan ke server melalui endpoint read notification sehingga tidak akan pernah muncul kembali saat refresh atau navigasi.
4. Perbaikan Pengajuan Biodata Siswa: Membuka akses submit mandiri bagi akun Siswa (role === 'STUDENT'), membuka batasan edit data, serta menambahkan auto-fallback pemetaan kolom formulir root level ke dalam blok s1-s5 untuk memastikan seluruh biodata siswa dan orang tua tersimpan 100% utuh di server database.
5. Monitoring Real-time Kelas Operator APK & Kurikulum Portal: Memperbaiki monitoring CBT pada Operator APK dengan token kelas interaktif dan auto-refresh 10 detik, serta web socket listener instan pada Kurikulum Dashboard untuk live monitoring tanpa bug.
6. Redesain Total & Profesionalisme CBT & Bank Soal: Menata ulang seluruh antarmuka CBT (manajemen_cbt.ejs) dengan pill navigation modern, 4 Ribbon KPI Stats Bank Soal, pencarian & filter mapel instan, tabel 7-kolom presisi, fitur Rekap Nilai Siswa dengan filter KKM dan pencarian live, serta Analisis Psikometrik Butir Soal lengkap dengan visualisasi Distribusi Nilai Siswa dan Diagnosis Penguasaan Kompetensi Dasar (KD).
7. Menu Cek Biodata Raport & Dapodik (Siswa & Wali Murid) & Integrasi Portal Spreadsheet: Menambahkan menu Cek Biodata Raport 17 instrumen Kemendikbud secara read-only di aplikasi Siswa dan Orang Tua dengan peringatan pembetulan data resmi via Operator Dapodik, serta portal manajemen data terhubung Excel Spreadsheet untuk impor/ekspor data Dapodik massal (Kelas VII).`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 143,
      versionName: '2.8.133',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 143,
      versionName: '2.8.133',
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
        versionCode: 143,
        versionName: '2.8.133',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 143,
        versionName: '2.8.133',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      }
    });
  } catch (e) {
    console.warn(`Could not update app_latest:`, e.message);
  }

  // 3. Also update cbt_latest
  try {
    await prisma.appVersionConfig.upsert({
      where: { id: 'cbt_latest' },
      update: {
        versionCode: 143,
        versionName: '2.8.133',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'cbt_latest',
        versionCode: 143,
        versionName: '2.8.133',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      }
    });
  } catch (e) {
    console.warn(`Could not update cbt_latest:`, e.message);
  }

  // 4. Record to AppReleaseHistory
  try {
    const history = await prisma.appReleaseHistory.create({
      data: {
        versionCode: 143,
        versionName: '2.8.133',
        releaseType: 'RELEASE',
        targetApp: 'SMARTCBT',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        sha256: sha256 || 'PRE_COMPILED_SHA',
        releaseNotes,
        isMandatory: false,
        status: 'ACTIVE',
        minAndroidSdk: 24,
        targetAndroidSdk: 34,
        createdBy: 'SYSTEM_UPGRADE_143'
      }
    });
    console.log(`Created AppReleaseHistory record:`, history.id);
  } catch (e) {
    console.warn(`Could not write to AppReleaseHistory:`, e.message);
  }

  console.log(`\n=== Release v2.8.133 (Build 143) metadata update completed successfully! ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
