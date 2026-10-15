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

  console.log(`=== Deploying SmartCBT v2.8.132 (Build 142) ===`);
  console.log(`Source APK size: ${fileBuffer.length} bytes (${fileSizeMb} MB)`);
  console.log(`SHA-256: ${sha256}`);

  // Target destinations
  const targets = [
    path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
    path.resolve('C:/APK/backend/uploads/SmartCBT_v2.8.132.apk'),
    path.resolve('C:/APK/backend/uploads/app_releases/smartschool-v2.8.132-build142.apk'),
    path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
    path.resolve('C:/APK/backend/public/downloads/smartschool-latest.apk'),
    path.resolve('C:/APK/backend/public/smartcbt-latest.apk'),
    path.resolve('C:/APK/smartcbt-latest.apk'),
    path.resolve('C:/APK/smartcbt-v2.8.132-build142.apk')
  ];

  for (const target of targets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(sourceApk, target);
    console.log(`Copied to: ${target}`);
  }

  const releaseNotes = `Pembaruan Presisi Smart CBT & School v2.8.132 (Build 142):
1. Proteksi Anti-HP Ke-2 & Anti-AI Soal CBT: Fitur Dynamic Touch-to-Reveal 5 Detik Blur aktif otomatis mengaburkan tampilan soal jika layar tidak disentuh selama 5 detik guna mencegah pemotretan menggunakan HP kedua untuk dikirim ke AI (ChatGPT / Google Lens), diperkuat Watermark Forensik Identitas Siswa bergerak dinamis.
2. Gerbang CBT Layar Penuh (Full Screen Token Modal): Dialog token modern layar penuh standar asesmen resmi dengan edukasi Pakta Integritas & Tata Tertib CBT, validasi token terisolasi 11 kelas paralel, serta penghapusan tombol QR Pengawas yang tidak diperlukan.
3. Desain Jadwal Sholat PAI & Operator Lengkap: Pemilihan jadwal rotasi sholat per tingkat (Tingkat VII 11 rombel, Tingkat VIII 11 rombel, Tingkat IX 11 rombel) dengan tombol cepat (+ Semua VII, + Semua VIII, + Semua IX, Semua Putra JUMAT, Bersihkan) dan centang rombel interaktif dengan sinkronisasi sepekan.
4. Penyempurnaan Pasfoto Biometrik: Peningkatan algoritma segmentasi latar belakang resmi (#0078D4) dengan threshold manusia 0.50 dan zona transisi 20% untuk hasil pasfoto yang rapi, tajam, dan bebas halo abu-abu.
5. Revamp Ekstrakurikuler Spenboy: Standarisasi nama judul menjadi 'EKSTRAKURIKULER', dialog detail Full Screen resmi, daftar siswa anggota yang mengikuti ekskul, pembatalan pendaftaran, dan pembaruan layout Jadwal & Presensi QR.
6. Perbaikan Notifikasi UKS di Akun Orang Tua: Mengatasi duplikasi pop-up pengumuman UKS pada akun wali murid.`;

  // 1. Update or create AppVersionConfig (id: "latest")
  const config = await prisma.appVersionConfig.upsert({
    where: { id: 'latest' },
    update: {
      versionCode: 142,
      versionName: '2.8.132',
      downloadUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      releaseNotes,
      isForceUpdate: false,
      updatedAt: new Date()
    },
    create: {
      id: 'latest',
      versionCode: 142,
      versionName: '2.8.132',
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
        versionCode: 142,
        versionName: '2.8.132',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      },
      create: {
        id: 'app_latest',
        versionCode: 142,
        versionName: '2.8.132',
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
    where: { versionCode: 142 },
    update: {
      nomorVersi: '2.8.132',
      changelog: releaseNotes,
      fileApkUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      checksumSha256: sha256,
      isForceUpdate: false,
      status: 'ACTIVE',
      persentaseRollout: 100
    },
    create: {
      versionCode: 142,
      nomorVersi: '2.8.132',
      changelog: releaseNotes,
      fileApkUrl: '/uploads/smartcbt-latest.apk',
      fileSizeMb,
      checksumSha256: sha256,
      isForceUpdate: false,
      status: 'ACTIVE',
      persentaseRollout: 100
    }
  });
  console.log(`Updated AppVersionRelease 142:`, release);

  // 4. Update default version configs if any other keys
  try {
    await prisma.appVersionConfig.updateMany({
      where: {
        id: { in: ['default', 'global', 'android'] }
      },
      data: {
        versionCode: 142,
        versionName: '2.8.132',
        downloadUrl: '/uploads/smartcbt-latest.apk',
        fileSizeMb,
        releaseNotes,
        isForceUpdate: false,
        updatedAt: new Date()
      }
    });
    console.log(`Updated secondary AppVersionConfig records`);
  } catch (e) {
    console.log(`Note for secondary configs:`, e.message);
  }

  console.log(`\n🎉 Sukses update SmartCBT ke Versi 2.8.132 (Build 142)!`);
}

main()
  .catch(err => {
    console.error('Fatal error in update script:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
