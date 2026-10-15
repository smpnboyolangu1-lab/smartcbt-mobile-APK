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

    console.log(`=== Deploying SmartCBT v2.8.147 (Build 157) ===`);
    console.log(`Using source APK: ${sourceApk}`);
    console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
    console.log(`SHA-256: ${sha256}`);

    const targets = [
      path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.147.apk'),
      path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.147-build157.apk'),
      path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
      path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
      path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-latest.apk'),
      path.resolve('C:/APK/smartcbt-v2.8.147-build157.apk')
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
    console.log(`No compiled APK found yet. Updating database metadata to v2.8.147 (Build 157)...`);
  }

  const releaseNotes = `Pembaruan Smart CBT & School Management v2.8.147 (Build 157):
1. Smart Question Editor Langsung di APK: Penyusunan butir soal mandiri oleh guru dengan Toolbar Rumus Matematika & Sains 1-Sentuh (√, x², xⁿ, ½, ±, π, ∑, ∫, ≠, ≤, ≥, dll.), lampiran gambar soal, dan lampiran audio listening.
2. Quick Clipboard Format Soal: Kemudahan import instan puluhan soal dari teks/WhatsApp/Word dengan pembedah format otomatis (nomor, opsi A-D, dan kunci jawaban).
3. Integrasi Penuh Tugas & Penilaian Terpadu: Riwayat Ulangan Harian (UH 3 Mode) langsung muncul berdampingan dengan Tugas PR dan Ulangan CBT sejak awal buka menu, dilengkapi Live Monitoring, rotasi token, dan rekap skor.
4. Alur Presensi Terpadu Guru & Siswa Kelas: Notifikasi KBM 30 menit sebelum jam mengajar, tombol 1-Tap Presensi Guru di Kelas, buka presensi siswa otomatis 30 menit sebelum jam berakhir dengan proteksi kunci siswa sakit/izin/UKS, dan tombol selesai mengajar 15 menit sebelum jam habis.
5. WhatsApp Gateway Resmi Orang Tua: Sistem blast WhatsApp resmi SMP Negeri 1 Boyolangu dengan QR Pairing scanner di Web Admin Pengaturan, khusus memberitahu siswa terlambat & siswa belum checklock gerbang.
6. Pusat Guru Piket Baru: 3 Tab modern (Jadwal Piket Lengkap Sen-Sab, Rekap Sakit/Izin Guru + Tugas Mandiri, dan Monitoring Kelas Kosong 0 dummy).
7. Panduan Google Play Protect High-Contrast: Edukasi visual panduan instalasi non-Play Store tanpa mengganggu aktivitas belajar mengajar siswa.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 157,
      versionName: '2.8.147',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 157,
      versionName: '2.8.147',
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
        versionCode: 157,
        versionName: '2.8.147',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 157,
        versionName: '2.8.147',
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
        versionCode: 157,
        versionName: '2.8.147',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'cbt_latest',
        versionCode: 157,
        versionName: '2.8.147',
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
        where: { versionCode: 157 },
        update: {
          nomorVersi: '2.8.147',
          changelog: releaseNotes,
          fileSizeMb,
          checksumSha256: sha256,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          isForceUpdate: false,
          status: 'ACTIVE'
        },
        create: {
          versionCode: 157,
          nomorVersi: '2.8.147',
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

  console.log(`Deployment script for v2.8.147 (Build 157) finished successfully.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
