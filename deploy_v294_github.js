const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const https = require('https');

const token = process.argv[2] || process.env.GITHUB_TOKEN || '';
const repoOwner = 'smpnboyolangu1-lab';
const repoName = 'smartcbt-mobile-APK';
const tagName = 'v2.9.4';
const versionCode = 174;
const versionName = '2.9.4';
const releaseTitle = 'Smart CBT v2.9.4 (Build 174) - Pembaruan Wajib Presensi Cerdas & Keamanan Sistem';
const builtApkPath = path.resolve('C:/APK/android_app/app/build/outputs/apk/release/app-release.apk');
const gitExe = 'C:\\Users\\user\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\\cmd\\git.exe';

console.log('==========================================================');
console.log('   OTOMATISASI RILIS GITHUB SMART CBT v2.9.4 (BUILD 174)  ');
console.log('   Repositori: https://github.com/' + repoOwner + '/' + repoName);
console.log('==========================================================');

if (!fs.existsSync(builtApkPath)) {
  console.error('[ERROR] Berkas compiled APK tidak ditemukan:', builtApkPath);
  process.exit(1);
}

// 1. Calculate Hash & Size
const apkBuffer = fs.readFileSync(builtApkPath);
const stat = fs.statSync(builtApkPath);
const fileSizeMb = parseFloat((stat.size / (1024 * 1024)).toFixed(2));
const sha256 = crypto.createHash('sha256').update(apkBuffer).digest('hex');

console.log(`\n[1/5] Memeriksa APK: ${fileSizeMb} MB (${stat.size} bytes), SHA-256: ${sha256}`);

// 2. Copy APK to server paths
const copyTargets = [
  path.resolve('C:/APK/backend/uploads/SmartCBT_v2.9.4.apk'),
  path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk'),
  path.resolve('C:/APK/backend/uploads/SmartSchool_CBT_Release.apk'),
  path.resolve('C:/APK/backend/public/uploads/SmartCBT_v2.9.4.apk'),
  path.resolve('C:/APK/backend/public/uploads/smartcbt-latest.apk'),
  path.resolve('C:/APK/backend/smartcbt-latest.apk'),
  path.resolve('C:/APK/smartcbt-latest.apk')
];

for (const dest of copyTargets) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(builtApkPath, dest);
  console.log(` -> Tersalin ke: ${dest}`);
}

// Helper HTTPS request
function githubRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  // 3. Git Push Commits and Tag
  console.log('\n[2/5] Mengunggah commits dan tags ke GitHub smpnboyolangu1-lab...');
  const pushUrl = `https://${token}@github.com/${repoOwner}/${repoName}.git`;
  try {
    execSync(`"${gitExe}" add -A`, { stdio: 'inherit' });
    try {
      execSync(`"${gitExe}" commit -m "release: Smart CBT v2.9.4 (Build 174) [official smpnboyolangu1-lab]"`, { stdio: 'inherit' });
    } catch (e) {}
    try {
      execSync(`"${gitExe}" tag -a -f ${tagName} -m "Release ${tagName}"`, { stdio: 'inherit' });
    } catch (e) {}
    execSync(`"${gitExe}" push "${pushUrl}" main --tags -f`, { stdio: 'inherit' });
    console.log(' -> Git push berhasil!');
  } catch (err) {
    console.warn(' -> Peringatan Git push:', err.message);
  }

  // 4. Create or Get GitHub Release
  console.log('\n[3/5] Membuat Release resmi di GitHub...');
  const releaseNotes = `### Pembaruan Resmi Smart CBT v2.9.4 (Build 174)\n` +
    `⚠️ **PERHATIAN: Pembaruan Wajib!** Versi lama di bawah 2.9.4 telah dinonaktifkan demi stabilitas & keamanan sistem.\n\n` +
    `- 🏫 **Presensi Kelas Cerdas:** Mendukung pemindaian Barcode Statis Kelas Fisik dengan validasi GPS di sekolah.\n` +
    `- ⏱️ **Dynamic QR Pengurus Kelas:** Fitur QR Dinamis 10 detik sebagai alternatif presensi kelas instan tanpa GPS.\n` +
    `- 🏥 **Integrasi UKS Terpadu:** Presensi otomatis IZIN_UKS bagi siswa yang dirawat di ranjang UKS.\n` +
    `- 🔒 **Peningkatan Keamanan:** Proteksi Fake GPS, integrasi device binding, dan optimasi latensi koneksi server.\n\n` +
    `**Download APK:** Ketuk link asset SmartCBT_v2.9.4.apk di bawah atau perbarui langsung dari aplikasi.`;

  const releasePayload = JSON.stringify({
    tag_name: tagName,
    target_commitish: 'main',
    name: releaseTitle,
    body: releaseNotes,
    draft: false,
    prerelease: false
  });

  let releaseData = null;
  const createResp = await githubRequest({
    hostname: 'api.github.com',
    path: `/repos/${repoOwner}/${repoName}/releases`,
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'SmartCBT-AutoDeploy',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(releasePayload)
    }
  }, releasePayload);

  if (createResp.status === 201) {
    releaseData = createResp.data;
    console.log(` -> Release baru berhasil dibuat! ID: ${releaseData.id}`);
  } else {
    // Cari existing release
    const getResp = await githubRequest({
      hostname: 'api.github.com',
      path: `/repos/${repoOwner}/${repoName}/releases/tags/${tagName}`,
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'SmartCBT-AutoDeploy',
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (getResp.status === 200) {
      releaseData = getResp.data;
      console.log(` -> Release ${tagName} sudah ada. ID: ${releaseData.id}`);
    } else {
      console.error('[ERROR] Gagal membuat/mengambil release:', createResp.data);
      process.exit(1);
    }
  }

  // 5. Upload Binary Assets to GitHub
  console.log('\n[4/5] Mengunggah berkas binary APK ke GitHub Releases...');
  const uploadUrlRaw = releaseData.upload_url.replace(/\{\?name,label\}/, '');
  const assetsToUpload = [
    { name: 'SmartCBT_v2.9.4.apk', path: path.resolve('C:/APK/backend/uploads/SmartCBT_v2.9.4.apk') },
    { name: 'SmartCBT_latest.apk', path: path.resolve('C:/APK/backend/uploads/smartcbt-latest.apk') }
  ];

  for (const asset of assetsToUpload) {
    // Hapus asset jika sudah ada
    if (releaseData.assets && releaseData.assets.length > 0) {
      for (const old of releaseData.assets) {
        if (old.name === asset.name) {
          console.log(` -> Menghapus asset lama ${old.name} (ID: ${old.id})...`);
          await githubRequest({
            hostname: 'api.github.com',
            path: `/repos/${repoOwner}/${repoName}/releases/assets/${old.id}`,
            method: 'DELETE',
            headers: {
              'Authorization': `token ${token}`,
              'User-Agent': 'SmartCBT-AutoDeploy',
              'Accept': 'application/vnd.github.v3+json'
            }
          });
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    console.log(` -> Mengunggah ${asset.name} (${fileSizeMb} MB)...`);
    const uploadUrl = `${uploadUrlRaw}?name=${asset.name}`;
    const curlCmd = `C:\\Windows\\System32\\curl.exe -s -L -X POST -H "Authorization: token ${token}" -H "Content-Type: application/vnd.android.package-archive" --data-binary "@${asset.path}" "${uploadUrl}"`;
    execSync(curlCmd, { stdio: 'inherit' });
    console.log(` -> Sukses mengunggah: ${asset.name}`);
  }

  const directDownloadUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/${tagName}/SmartCBT_v2.9.4.apk`;
  console.log(` -> URL Unduhan Resmi: ${directDownloadUrl}`);

  // 6. Update PostgreSQL Database
  console.log('\n[5/5] Memperbarui basis data PostgreSQL & mengunci versi < 2.9.4...');
  const { PrismaClient } = require('./backend/node_modules/@prisma/client');
  const prisma = new PrismaClient();

  for (const key of ['latest', 'app_latest', 'cbt_latest']) {
    await prisma.appVersionConfig.upsert({
      where: { id: key },
      update: {
        versionCode: 174,
        versionName: '2.9.4',
        downloadUrl: directDownloadUrl,
        fileSizeMb,
        releaseNotes,
        isForceUpdate: true
      },
      create: {
        id: key,
        versionCode: 174,
        versionName: '2.9.4',
        downloadUrl: directDownloadUrl,
        fileSizeMb,
        releaseNotes,
        isForceUpdate: true
      }
    });
  }

  if (prisma.appVersionRelease) {
    await prisma.appVersionRelease.upsert({
      where: { versionCode: 174 },
      update: {
        nomorVersi: '2.9.4',
        changelog: releaseNotes,
        fileApkUrl: directDownloadUrl,
        fileSizeMb,
        checksumSha256: sha256,
        isForceUpdate: true,
        persentaseRollout: 100,
        status: 'ACTIVE'
      },
      create: {
        versionCode: 174,
        nomorVersi: '2.9.4',
        changelog: releaseNotes,
        fileApkUrl: directDownloadUrl,
        fileSizeMb,
        checksumSha256: sha256,
        isForceUpdate: true,
        persentaseRollout: 100,
        status: 'ACTIVE'
      }
    });
  }

  await prisma.$disconnect();
  console.log(' -> Database berhasil diperbarui dengan versi 2.9.4!');

  console.log('\n==========================================================');
  console.log('  SUKSES PENUH! RILIS GITHUB v2.9.4 AKTIF 100%             ');
  console.log('  Repositori: https://github.com/' + repoOwner + '/' + repoName);
  console.log('  Direct CDN: ' + directDownloadUrl);
  console.log('==========================================================');
}

main().catch(err => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
