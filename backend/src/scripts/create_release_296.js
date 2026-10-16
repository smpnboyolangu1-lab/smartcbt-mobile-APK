const fs = require('fs');
const https = require('https');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const REPO = 'smpnboyolangu1-lab/smartcbt-mobile-APK';
const TAG = 'v2.9.6';
const NAME = 'SmartCBT v2.9.6 (Build 176) - Alur Cuti Guru 360, Gatepass BK Auto-QR & Navigasi Terpadu';
const BODY = `## Pembaruan Resmi SmartCBT v2.9.6 (Build 176)
- **Alur Rantai Cuti Guru 360°**: Rekap komprehensif kehadiran, keterlambatan (kali & menit), alfa, izin/sakit, dan cuti disetujui kurikulum lengkap dengan rincian hari & disposisi guru piket di Portal & APK Guru.
- **Izin Darurat Siswa (Gatepass BK)**: Tiket QR Gatepass otomatis muncul langsung di layar siswa setelah persetujuan Guru BK tanpa pemindaian ulang di meja BK, siap dipindai Satpam di gerbang.
- **Tahfiz Juz 30 Real-Time**: Setoran menunggu nilai otomatis muncul di riwayat penyerahan dengan status ustadz penilai; pemutakhiran guru PAI aktif (Munawir, Brian, Eny Astuti).
- **Integrasi Menu & Navigasi Rapi**: Tab "Tugas & Ujian" memadukan tugas harian, PR, dan ulangan harian secara elegan dengan kontrol penuh di portal web kurikulum.
- **Kesiapan Ekosistem 90%+**: Validasi kontrol penuh portal backend client security, penghapusan total RFID, dan isolasi ujian CBT formal.`;

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

async function uploadAsset(uploadUrlTemplate, filePath, fileName) {
    const uploadUrl = uploadUrlTemplate.replace(/\{(\?name,label)?\}/, `?name=${encodeURIComponent(fileName)}`);
    const fileStats = fs.statSync(filePath);
    const fileStream = fs.readFileSync(filePath);
    const parsedUrl = new URL(uploadUrl);

    return new Promise((resolve, reject) => {
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
                console.log(`Uploaded ${fileName}: HTTP ${res.statusCode}`);
                resolve(resBody);
            });
        });
        req.on('error', reject);
        req.write(fileStream);
        req.end();
    });
}

async function run() {
    console.log('1. Checking or creating release:', TAG);
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
        tag_name: TAG,
        target_commitish: 'main',
        name: NAME,
        body: BODY,
        draft: false,
        prerelease: false
    }));

    let releaseData = createRes.body;
    if (createRes.status !== 201) {
        console.log('Release might already exist or status:', createRes.status, createRes.body?.message);
        const getRes = await request({
            hostname: 'api.github.com',
            path: `/repos/${REPO}/releases/tags/${TAG}`,
            method: 'GET',
            headers: {
                'Authorization': `token ${TOKEN}`,
                'User-Agent': 'Node-Release-Uploader'
            }
        });
        releaseData = getRes.body;
    }

    if (!releaseData || !releaseData.upload_url) {
        console.error('Failed to get release data:', releaseData);
        process.exit(1);
    }

    console.log('Release ready ID:', releaseData.id);
    const apkPath = path.resolve('c:/APK/android_app/app/build/outputs/apk/release/app-release.apk');
    if (!fs.existsSync(apkPath)) {
        console.error('APK file not found at:', apkPath);
        process.exit(1);
    }

    console.log('2. Uploading SmartCBT_v2.9.6.apk...');
    await uploadAsset(releaseData.upload_url, apkPath, 'SmartCBT_v2.9.6.apk');

    console.log('3. Uploading SmartCBT_latest.apk...');
    await uploadAsset(releaseData.upload_url, apkPath, 'SmartCBT_latest.apk');

    console.log('All releases published successfully!');
}

run().catch(err => {
    console.error('Error running release script:', err);
    process.exit(1);
});
