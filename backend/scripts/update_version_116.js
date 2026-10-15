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

  console.log(`=== Deploying SmartCBT v2.8.106 (Build 116) ===`);
  console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
  console.log(`SHA-256: ${sha256}`);

  // Target destinations
  const targets = [
    path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
    path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.106.apk'),
    path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
    path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
    path.resolve('C:/APK/smartcbt-latest.apk'),
    path.resolve('C:/APK/SmartSchool_CBT_Release.apk'),
    path.resolve('C:/APK/SmartCBT_v2.8.106.apk')
  ];

  for (const target of targets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(sourceApk, target);
    console.log(`Copied to: ${target}`);
  }

  const releaseNotes = `Update Resmi SmartCBT v2.8.106 (Build 116):
1. Formulir Biodata Terpadu: NISN terkunci Dapodik, Pas Foto 3x4 latar belakang biru (#0078D4), Geotagging GPS otomatis + Cek Google Maps.
2. Data Orang Tua Kandung (Sesuai Akta Kelahiran): Kunci otomatis pekerjaan & penghasilan jika status meninggal dunia.
3. Data Wali Siswa Opsional (Tinggal Bersama Wali) dengan validasi lengkap.
4. Fitur CamScanner Otomatis: Berkas KK, Akta, dan Kartu Bantuan otomatis di-enhance (kontras tajam dokumen) dan dikonversi langsung menjadi PDF standar resmi (bukan foto mentah).
5. Tombol 'SELESAI & KIRIM BERKAS' ke TU Kesiswaan.
6. Integrasi Verifikasi TU Kesiswaan: Real-time deteksi kelengkapan berkas, tombol Notifikasi Ortu & Pengumuman Massal ke Akun Orang Tua di APK.
7. Sistem Arsip Digital per Tahun Ajaran: Folder map per kelas, rekapitulasi Excel, dan arsip ZIP satu-klik.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 116,
      versionName: '2.8.106',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb: fileSizeMb,
      releaseNotes: releaseNotes,
      isForceUpdate: true,
    },
    create: {
      id: 'latest',
      versionCode: 116,
      versionName: '2.8.106',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb: fileSizeMb,
      releaseNotes: releaseNotes,
      isForceUpdate: true,
    },
  });
  console.log(`AppVersionConfig updated:`, config);

  // 2. Upsert AppVersionRelease
  const release = await prisma.appVersionRelease.upsert({
    where: { versionCode: 116 },
    update: {
      nomorVersi: '2.8.106',
      changelog: releaseNotes,
      fileApkUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb: fileSizeMb,
      checksumSha256: sha256,
      isForceUpdate: true,
      persentaseRollout: 100,
      status: 'ACTIVE',
    },
    create: {
      nomorVersi: '2.8.106',
      versionCode: 116,
      changelog: releaseNotes,
      fileApkUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb: fileSizeMb,
      checksumSha256: sha256,
      isForceUpdate: true,
      persentaseRollout: 100,
      status: 'ACTIVE',
    },
  });
  console.log(`AppVersionRelease updated:`, release);

  console.log('✅ Deployment and Database Version Update Completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
