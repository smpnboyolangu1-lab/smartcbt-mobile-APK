const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'smpnboyolangu1-lab/smartcbt-mobile-APK';

function request(options, data) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let resBody = '';
            res.on('data', chunk => resBody += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(resBody) });
                } catch(e) {
                    resolve({ status: res.statusCode, headers: res.headers, body: resBody });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

function uploadAsset(uploadUrlTemplate, filePath, fileName) {
    return new Promise((resolve, reject) => {
        const uploadUrl = uploadUrlTemplate.replace(/\{(\?name,label)?\}/, `?name=${encodeURIComponent(fileName)}`);
        const fileStats = fs.statSync(filePath);
        const fileStream = fs.readFileSync(filePath);
        const parsedUrl = new URL(uploadUrl);

        const req = https.request({
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Authorization': `token ${TOKEN}`,
                'User-Agent': 'Node-Release-Uploader',
                'Content-Type': 'application/vnd.android.package-archive',
                'Content-Length': fileStats.size
            }
        }, (res) => {
            let resBody = '';
            res.on('data', chunk => resBody += chunk);
            res.on('end', () => {
                console.log(`[Asset Upload] Uploaded ${fileName}: HTTP ${res.statusCode}`);
                resolve(resBody);
            });
        });
        req.on('error', reject);
        req.write(fileStream);
        req.end();
    });
}

async function main() {
    console.log('================================================================');
    console.log('    PUBLISH SMART CBT KE GITHUB RELEASES (DUAL-CDN DEPLOY)     ');
    console.log('================================================================');

    // 1. Dapatkan file APK target
    const apkPath = path.resolve(__dirname, '../uploads/smartcbt-latest.apk');
    if (!fs.existsSync(apkPath)) {
        console.error('❌ File APK tidak ditemukan di:', apkPath);
        process.exit(1);
    }

    const apkBuf = fs.readFileSync(apkPath);
    const stats = fs.statSync(apkPath);
    const fileSizeMb = Number((stats.size / (1024 * 1024)).toFixed(2));
    const sha256 = crypto.createHash('sha256').update(apkBuf).digest('hex');

    console.log(`[APK Info] Berkas: ${apkPath}`);
    console.log(`[APK Info] Ukuran: ${fileSizeMb} MB, SHA-256: ${sha256}`);

    // 2. Ambil data versi saat ini dari Database
    const currentConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'latest' } });
    const versionName = currentConfig ? currentConfig.versionName : '2.9.11';
    const versionCode = currentConfig ? currentConfig.versionCode : 181;
    const releaseNotes = currentConfig ? currentConfig.releaseNotes : 'Pembaruan Resmi Smart CBT';

    const cleanVer = versionName.trim().replace(/^v/i, '');
    const tag = `v${cleanVer}`;
    const releaseTitle = `Smart CBT v${cleanVer} (Build ${versionCode}) - Pembaruan Resmi SMPN 1 Boyolangu`;

    console.log(`[Target Release] Tag: ${tag}, Title: ${releaseTitle}`);

    // 3. Buat atau dapatkan Release di GitHub
    console.log(`\n[1/3] Menghubungi GitHub API (${REPO})...`);
    let releaseData = null;

    const getRes = await request({
        hostname: 'api.github.com',
        path: `/repos/${REPO}/releases/tags/${tag}`,
        method: 'GET',
        headers: {
            'Authorization': `token ${TOKEN}`,
            'User-Agent': 'Node-Release-Uploader'
        }
    });

    if (getRes.status === 200 && getRes.body?.id) {
        releaseData = getRes.body;
        console.log(` -> Release ${tag} sudah ada di GitHub (ID: ${releaseData.id})`);
    } else {
        console.log(` -> Membuat Release baru untuk tag ${tag}...`);
        const createRes = await request({
            hostname: 'api.github.com',
            path: `/repos/${REPO}/releases`,
            method: 'POST',
            headers: {
                'Authorization': `token ${TOKEN}`,
                'User-Agent': 'Node-Release-Uploader',
                'Content-Type': 'application/json'
            }
        }, JSON.stringify({
            tag_name: tag,
            target_commitish: 'main',
            name: releaseTitle,
            body: `### ${releaseTitle}\n\n${releaseNotes}\n\n**Unduh Otomatis:** Aplikasi Android Smart CBT akan memperbarui otomatis dari rilis ini.\n**Checksum SHA-256:** \`${sha256}\``,
            draft: false,
            prerelease: false
        }));

        if (createRes.status === 201 && createRes.body?.id) {
            releaseData = createRes.body;
            console.log(` -> Release baru berhasil dibuat (ID: ${releaseData.id})`);
        } else {
            console.error('❌ Gagal membuat release di GitHub:', createRes.status, createRes.body);
            process.exit(1);
        }
    }

    // 4. Hapus asset lama jika nama sama agar tidak duplikat
    console.log('\n[2/3] Memeriksa dan mengunggah binary APK ke GitHub Releases...');
    const assetNames = [`SmartCBT_v${cleanVer}.apk`, 'SmartCBT_latest.apk'];

    if (Array.isArray(releaseData.assets)) {
        for (const asset of releaseData.assets) {
            if (assetNames.includes(asset.name)) {
                console.log(` -> Menghapus asset lama: ${asset.name} (ID: ${asset.id})...`);
                await request({
                    hostname: 'api.github.com',
                    path: `/repos/${REPO}/releases/assets/${asset.id}`,
                    method: 'DELETE',
                    headers: {
                        'Authorization': `token ${TOKEN}`,
                        'User-Agent': 'Node-Release-Uploader'
                    }
                });
            }
        }
    }

    // Unggah file binary
    for (const aName of assetNames) {
        console.log(` -> Mengunggah ${aName} ke GitHub CDN...`);
        await uploadAsset(releaseData.upload_url, apkPath, aName);
    }

    // 5. Update database dengan URL GitHub Fastly CDN
    const githubDownloadUrl = `https://github.com/${REPO}/releases/download/${tag}/SmartCBT_v${cleanVer}.apk`;
    console.log(`\n[3/3] Memperbarui database konfigurasi unduhan ke GitHub CDN:\n       ${githubDownloadUrl}`);

    const configKeys = ['latest', 'app_latest', 'cbt_latest'];
    for (const key of configKeys) {
        await prisma.appVersionConfig.upsert({
            where: { id: key },
            update: {
                versionCode,
                versionName: cleanVer,
                downloadUrl: githubDownloadUrl,
                fileSizeMb,
                releaseNotes,
                isForceUpdate: true,
                updatedAt: new Date()
            },
            create: {
                id: key,
                versionCode,
                versionName: cleanVer,
                downloadUrl: githubDownloadUrl,
                fileSizeMb,
                releaseNotes,
                isForceUpdate: true,
                updatedAt: new Date()
            }
        });
    }

    if (prisma.appVersionRelease) {
        await prisma.appVersionRelease.upsert({
            where: { versionCode },
            update: {
                nomorVersi: cleanVer,
                changelog: releaseNotes,
                fileApkUrl: githubDownloadUrl,
                fileSizeMb,
                checksumSha256: sha256,
                isForceUpdate: true,
                persentaseRollout: 100,
                status: 'ACTIVE'
            },
            create: {
                nomorVersi: cleanVer,
                versionCode,
                changelog: releaseNotes,
                fileApkUrl: githubDownloadUrl,
                fileSizeMb,
                checksumSha256: sha256,
                isForceUpdate: true,
                persentaseRollout: 100,
                status: 'ACTIVE'
            }
        }).catch(() => null);
    }

    console.log('\n================================================================');
    console.log('✅ BERHASIL! Rilis GitHub v' + cleanVer + ' aktif dan siap melayani 3.000 siswa');
    console.log('   Tautan CDN Langsung: ' + githubDownloadUrl);
    console.log('   Fallback Portal: https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk');
    console.log('================================================================');
}

main()
    .catch(err => {
        console.error('Error saat deploy ke GitHub:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
