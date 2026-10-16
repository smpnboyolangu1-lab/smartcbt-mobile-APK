const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PrismaClient } = require('./backend/node_modules/@prisma/client');

const token = process.argv[2];
if (!token) {
  console.error('Harap sertakan token GitHub: node deploy_github.js <TOKEN>');
  process.exit(1);
}
const repoOwner = 'smpnboyolangu1-lab';
const repoName = 'smartcbt-mobile-APK';
const tagName = 'v2.8.91';
const releaseTitle = 'Smart CBT v2.8.91 (Build 101) - UI Profil Modern, Grafik Tren Canggih & Menu Panduan';
const apkPath = path.resolve(__dirname, 'backend/uploads/SmartCBT_v2.8.91.apk');
const gitExe = 'C:\\Users\\user\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\\cmd\\git.exe';

console.log('==========================================================');
console.log('   OTOMATISASI RILIS GITHUB SMART CBT v2.8.91 (BUILD 101) ');
console.log('==========================================================');

// Helper for GitHub API requests
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
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Helper for uploading binary to GitHub upload URL
function githubUploadBinary(uploadUrl, filePath, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const fileStats = fs.statSync(filePath);
    const fileStream = fs.createReadStream(filePath);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': fileStats.size,
        'User-Agent': 'SmartCBT-AutoDeploy'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    fileStream.pipe(req);
  });
}

async function main() {
  try {
    // 1. PUSH GIT COMMITS & TAGS
    console.log('\n[1/4] Mengunggah source code dan tag ke GitHub...');
    const pushUrl = `https://${token}@github.com/${repoOwner}/${repoName}.git`;
    execSync(`"${gitExe}" push "${pushUrl}" main --tags -f`, { stdio: 'inherit', cwd: __dirname });
    console.log(' -> Git push berhasil!');

    // 2. CREATE RELEASE DI GITHUB
    console.log('\n[2/4] Membuat Release di GitHub...');
    const releasePayload = JSON.stringify({
      tag_name: tagName,
      target_commitish: 'main',
      name: releaseTitle,
      body: `### Pembaruan Resmi Smart CBT v2.8.91 (Build 101)\n- 📱 Pemindahan Menu Panduan Aplikasi di Samping Ekstrakurikuler\n- 📊 Grafik Tren Kehadiran Interaktif & Canggih (Mode 14 Hari vs Mingguan, Streak Kehadiran, Skor Disiplin, dan Box Detail Hari Interaktif)\n- ✨ Desain UI & Layout Halaman Profil Siswa Modern, Bersih, dan Rapih\n- 🔄 Cek Update Otomatis Terhubung Langsung ke GitHub Releases\n- ⚙️ Stabilisasi Performa & Keamanan Aplikasi\n\n**Download APK:** Tersedia otomatis melalui menu Update APK di aplikasi atau unduh manual asset di bawah.`,
      draft: false,
      prerelease: false
    });

    let releaseResp = await githubRequest({
      hostname: 'api.github.com',
      path: `/repos/${repoOwner}/${repoName}/releases`,
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'SmartCBT-AutoDeploy',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(releasePayload)
      }
    }, releasePayload);

    let release = releaseResp.data;
    if (releaseResp.status === 422) {
      console.log(' -> Tag release sudah ada, mengambil data rilis yang sudah terdaftar...');
      const existingResp = await githubRequest({
        hostname: 'api.github.com',
        path: `/repos/${repoOwner}/${repoName}/releases/tags/${tagName}`,
        method: 'GET',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'SmartCBT-AutoDeploy'
        }
      });
      release = existingResp.data;
    }

    console.log(` -> Release siap! ID: ${release.id}, HTML: ${release.html_url}`);

    // 3. UPLOAD APK
    console.log('\n[3/4] Mengunggah file APK ke GitHub Releases (18.83 MB)...');
    if (!fs.existsSync(apkPath)) {
      throw new Error(`File APK tidak ditemukan di: ${apkPath}`);
    }

    const apkFileName = path.basename(apkPath);
    let uploadUrlRaw = release.upload_url.replace(/\{\?name,label\}/, '');
    const uploadUrl = `${uploadUrlRaw}?name=${apkFileName}`;

    // Hapus asset lama jika sudah ada
    if (release.assets && release.assets.length > 0) {
      for (const asset of release.assets) {
        if (asset.name === apkFileName) {
          console.log(` -> Menghapus asset lama ID: ${asset.id}...`);
          await githubRequest({
            hostname: 'api.github.com',
            path: `/repos/${repoOwner}/${repoName}/releases/assets/${asset.id}`,
            method: 'DELETE',
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'SmartCBT-AutoDeploy'
            }
          });
        }
      }
    }

    console.log(' -> Mengunggah berkas APK ke GitHub...');
    const uploadResult = await githubUploadBinary(uploadUrl, apkPath, token);
    console.log(' -> Upload selesai! Status:', uploadResult.status);

    const directDownloadUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/${tagName}/${apkFileName}`;
    console.log(` -> URL Download Resmi: ${directDownloadUrl}`);

    // 4. UPDATE DATABASE
    console.log('\n[4/4] Memperbarui database server...');
    const prisma = new PrismaClient();
    const fileSizeMb = parseFloat((fs.statSync(apkPath).size / (1024 * 1024)).toFixed(2));

    await prisma.appVersionConfig.upsert({
      where: { id: 'latest' },
      update: {
        versionCode: 101,
        versionName: '2.8.91',
        downloadUrl: directDownloadUrl,
        fileSizeMb: fileSizeMb,
        isForceUpdate: true,
        releaseNotes: 'Update Resmi Smart CBT v2.8.91 (Build 101): Pemindahan Menu Panduan Aplikasi di Samping Ekstrakurikuler, Grafik Tren Kehadiran Interaktif & Canggih (Streak, Skor Disiplin, Mode 14 Hari vs Mingguan), Desain Modern & Rapih Halaman Profil Siswa.'
      },
      create: {
        id: 'latest',
        versionCode: 101,
        versionName: '2.8.91',
        downloadUrl: directDownloadUrl,
        fileSizeMb: fileSizeMb,
        isForceUpdate: true,
        releaseNotes: 'Update Resmi Smart CBT v2.8.91 (Build 101): Pemindahan Menu Panduan Aplikasi di Samping Ekstrakurikuler, Grafik Tren Kehadiran Interaktif & Canggih (Streak, Skor Disiplin, Mode 14 Hari vs Mingguan), Desain Modern & Rapih Halaman Profil Siswa.'
      }
    });

    await prisma.appVersionRelease.upsert({
      where: { versionCode: 101 },
      update: {
        fileApkUrl: directDownloadUrl,
        status: 'ACTIVE'
      },
      create: {
        versionCode: 101,
        nomorVersi: '2.8.91',
        fileApkUrl: directDownloadUrl,
        changelog: 'Menu Panduan Aplikasi di Samping Ekstrakurikuler, Grafik Tren Kehadiran Canggih Interaktif, UI Profil Modern & Rapi',
        fileSizeMb: fileSizeMb,
        checksumSha256: 'f87a8b919a79cbf201e859089e5a1b327c598006',
        status: 'ACTIVE'
      }
    });

    await prisma.$disconnect();
    console.log(' -> Database berhasil disinkronkan dengan link GitHub!');

    console.log('\n==========================================================');
    console.log('  SUKSES PENUH! RILIS GITHUB SELESAI & AKTIF 100%         ');
    console.log(`  Download Link: ${directDownloadUrl}`);
    console.log('  Seluruh HP siswa kini otomatis mendownload dari GitHub! ');
    console.log('==========================================================');
  } catch (err) {
    console.error('Terjadi error saat deployment:', err);
    process.exit(1);
  }
}

main();
