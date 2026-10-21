const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const apkPath = path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk');
  let fileSizeMb = 17.68;
  let sha256 = 'E432EDA78262C2F1474D466DF00629089AA655AB44E1C759BDA81ACAE57BB698';

  if (fs.existsSync(apkPath)) {
    const stats = fs.statSync(apkPath);
    fileSizeMb = Math.round((stats.size / (1024 * 1024)) * 100) / 100;
    const fileBuffer = fs.readFileSync(apkPath);
    sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();
    console.log(`APK found: ${apkPath}`);
    console.log(`File size: ${stats.size} bytes (${fileSizeMb} MB)`);
    console.log(`SHA256: ${sha256}`);
  }

  const releaseNotes = `⚡ PEMBARUAN SISTEM RESMI: Smart CBT v2.9.10 (Build 180)
1. Modul Deteksi Dini & Skrining SDQ Kemendikbud: Standar baku 5 skala evaluasi emosi dan perilaku siswa usia 11–17 tahun (Normal, Borderline, Abnormal).
2. Sosiometri Digital & Anti-Bullying: Pemetaan relasi pertemanan/geng, deteksi siswa terisolasi, dan Kotak Rahaja (Whistleblowing anonim + unggah tangkapan layar bukti digital).
3. Generator E-RPL Resmi & Laporan A4: Penyusunan otomatis RPL Kurikulum Merdeka dan Laporan Bulanan/Semesteran siap cetak PDF A4 resmi dengan TTD Kepala Sekolah & Guru BK.
4. Skor SAW & Disiplin Positif: Poin Reward untuk prestasi/perilaku terpuji pengurang poin pelanggaran, serta Kontrak Perilaku siswa sebelum penerbitan SP.
5. Keamanan Data & Etika Konseling: Asas kerahasiaan konseling terenkripsi, Informed Consent Digital, dan Audit Log pelacakan akses catatan sensitif.
6. Berkas KK & Akta per Folder Siswa: Akses berkas KK dan Akta terstruktur per folder siswa untuk Wali Kelas tanpa meminta ulang berkas.
7. Dashboard Konseling BK Modern: Kartu konseling eksekutif ringkas, filter status cepat, dan pemulihan data presensi kelas ampuan.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 180,
      versionName: '2.9.10',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 180,
      versionName: '2.9.10',
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
        versionCode: 180,
        versionName: '2.9.10',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 180,
        versionName: '2.9.10',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      }
    });
    console.log(`Updated AppVersionConfig 'app_latest'`);
  } catch (e) {
    console.warn(`Could not update 'app_latest': ${e.message}`);
  }

  // 3. Update SystemSettings for backward compatibility
  const settings = [
    { key: 'app.latest_version_code', value: '180' },
    { key: 'app.latest_version_name', value: '2.9.10' },
    { key: 'app.download_url', value: '/uploads/smartcbt-latest.apk' },
    { key: 'app.release_notes', value: releaseNotes },
    { key: 'app.is_force_update', value: 'false' },
    { key: 'app.file_size_mb', value: String(fileSizeMb) },
    { key: 'app.sha256', value: sha256 }
  ];

  for (const s of settings) {
    try {
      await prisma.systemSetting.upsert({
        where: { key: s.key },
        update: { value: s.value },
        create: { key: s.key, value: s.value }
      });
    } catch (e) {
      // Ignore if systemSetting table doesn't have unique on key or differs
    }
  }

  // 4. Upsert into AppVersionRelease
  try {
    const existingRelease = await prisma.appVersionRelease.findFirst({
      where: { versionCode: 180 }
    });

    if (existingRelease) {
      await prisma.appVersionRelease.update({
        where: { id: existingRelease.id },
        data: {
          nomorVersi: '2.9.10',
          changelog: releaseNotes,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          fileSizeMb,
          checksumSha256: sha256,
          isForceUpdate: false
        }
      });
      console.log(`Updated AppVersionRelease for build 180`);
    } else {
      await prisma.appVersionRelease.create({
        data: {
          nomorVersi: '2.9.10',
          versionCode: 180,
          changelog: releaseNotes,
          fileApkUrl: '/uploads/smartcbt-latest.apk',
          fileSizeMb,
          checksumSha256: sha256,
          isForceUpdate: false
        }
      });
      console.log(`Created AppVersionRelease for build 180`);
    }
  } catch (e) {
    console.warn(`Could not update AppVersionRelease: ${e.message}`);
  }

  console.log('✅ Version 2.9.10 (Build 180) updated successfully in database!');
}

main()
  .catch((e) => {
    console.error('Error updating version:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
