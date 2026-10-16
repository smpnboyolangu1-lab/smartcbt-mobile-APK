const fs = require('fs');
const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL
        }
    }
});

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const REPO = 'smpnboyolangu1-lab/smartcbt-mobile-APK';
const TAG = 'v2.9.7';
const NAME = 'SmartCBT v2.9.7 (Build 177) - Pemutakhiran Komprehensif Ekosistem SmartSchool 90%+';
const BODY = `## Pembaruan Resmi SmartCBT v2.9.7 (Build 177)
- **Presensi Siswa QR & Geomaps Validated**: QR Statis Kelas wajib validasi Geomaps/GPS radius sekolah secara real-time. Tidak ada lagi status QR_STATIC tanpa verifikasi lokasi.
- **Pendampingan Pengurus Kelas Aktif**: Siswa tanpa HP atau terkendala GPS/login dapat dipresensikan oleh Pengurus Kelas via QR Dinamis maupun Scan Kartu Pelajar (Barcode/QR Kartu).
- **Alur Presensi Sholat Dhuha, Dhuhur & Keputrian**: Siswa presensi di kelas pagi hari, lalu presensi Sholat Dhuha/Dhuhur di Mushola; siswi berhalangan presensi di pos Keputrian.
- **Notifikasi Suara Audio TTS Ibadah**: Umpan balik suara otomatis yang jernih dan ramah saat presensi Sholat Dhuha, Sholat Dhuhur, dan Keputrian.
- **Otomasi WhatsApp ke Orang Tua**: Notifikasi WhatsApp otomatis dikirim ke HP Orang Tua jika siswa hadir di sekolah namun tidak melakukan presensi sholat berjamaah saat ada jadwal sholat.
- **Penutupan QR Pulang Kelas saat Ada Sholat**: Barcode kepulangan di ruang kelas otomatis ditutup jika kelas terjadwal sholat berjamaah; siswa wajib sholat dan presensi pulang di Mushola.
- **Dashboard Guru Simetris 4-Kolom**: Grid navigasi guru tertata rapi dalam format 4 kolom x 4 baris yang seimbang, intuitif, dan responsif.
- **Proktor CBT Token Live Portal**: Token ujian tersinkronisasi 100% langsung dari portal backend kurikulum (bukan token dummy), lengkap dengan fitur reset dan pengawasan peserta.
- **Rantai Cuti & Izin Guru 360°**: Rekapitulasi komprehensif kehadiran guru (Tepat Waktu, Terlambat kali & menit, Alfa, Izin/Sakit, serta Rincian Cuti Disetujui Kurikulum dan Disposisi Guru Piket) di portal dan APK.
- **Aksesibilitas Menu PAI Terfilter**: Fitur Pembina PAI & Tahfiz hanya dapat diakses oleh guru PAI yang terdaftar (Ustadz Munawir, Brian, Eny Astuti).
- **Modul Wali Kelas Mandiri & Lengkap**: Menu Wali Kelas khusus bagi guru dengan penugasan wali kelas (dihapus dari popup kurikulum), dilengkapi 9 submodul lengkap (Dashboard, Profil Siswa, Kehadiran, Monitoring Akademik, Catatan Pembinaan, Komunikasi Ortu, Administrasi Rapor, Laporan Kelas, Notifikasi).
- **Laporan Kelas & Rekap Kehadiran PDF Akurat**: Evaluasi absensi berbasis kalender hari efektif sekolah (Senin–Sabtu non-libur nasional) sehingga siswa tanpa log tidak lagi salah dihitung 100% hadir.`;

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
    console.log('=== MEMULAI DEPLOYMENT RELEASE v2.9.7 (BUILD 177) ===');
    const apkSourcePath = path.resolve('C:/APK/android_app/app/build/outputs/apk/release/app-release.apk');
    if (!fs.existsSync(apkSourcePath)) {
        console.error('APK file not found at:', apkSourcePath);
        process.exit(1);
    }
    const stats = fs.statSync(apkSourcePath);
    const fileSizeMb = Number((stats.size / (1024 * 1024)).toFixed(2));
    console.log(`Ditemukan APK Release: ${apkSourcePath} (${fileSizeMb} MB)`);

    // 1. Salin APK ke path lokal yang relevan
    const targets = [
        'C:/APK/smartcbt-latest.apk',
        'C:/APK/SmartCBT-v2.9.7-Release.apk',
        'C:/APK/storage/uploads/smartcbt-latest.apk',
        'C:/APK/backend/uploads/smartcbt-latest.apk',
        'C:/APK/backend/uploads/SmartSchool_CBT_Release.apk',
        'C:/APK/backend/uploads/SmartCBT_v2.9.7.apk'
    ];
    for (const t of targets) {
        try {
            const dir = path.dirname(t);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(apkSourcePath, t);
            console.log(`Copied APK to: ${t}`);
        } catch (e) {
            console.warn(`Gagal menyalin ke ${t}:`, e.message);
        }
    }

    // 2. Update Database AppVersionConfig
    console.log('Memperbarui tabel AppVersionConfig di Database...');
    const configIds = ['latest', 'app_latest', 'cbt_latest'];
    for (const cid of configIds) {
        await prisma.appVersionConfig.upsert({
            where: { id: cid },
            update: {
                versionCode: 177,
                versionName: '2.9.7',
                downloadUrl: `https://github.com/${REPO}/releases/download/${TAG}/SmartCBT_${TAG}.apk`,
                fileSizeMb,
                releaseNotes: BODY,
                isForceUpdate: true,
                updatedAt: new Date()
            },
            create: {
                id: cid,
                versionCode: 177,
                versionName: '2.9.7',
                downloadUrl: `https://github.com/${REPO}/releases/download/${TAG}/SmartCBT_${TAG}.apk`,
                fileSizeMb,
                releaseNotes: BODY,
                isForceUpdate: true,
                updatedAt: new Date()
            }
        });
        console.log(`AppVersionConfig '${cid}' updated to v2.9.7 (Build 177).`);
    }

    // 3. GitHub Release
    console.log('Membuat / Mengambil Release GitHub:', TAG);
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

    // Hapus asset lama jika sudah ada agar bisa di-overwrite dengan file terbaru
    if (Array.isArray(releaseData.assets)) {
        for (const asset of releaseData.assets) {
            if (asset.name === `SmartCBT_${TAG}.apk` || asset.name === 'SmartCBT_latest.apk') {
                console.log(`Menghapus asset lama di GitHub: ${asset.name} (ID: ${asset.id})...`);
                try {
                    await request({
                        hostname: 'api.github.com',
                        path: `/repos/${REPO}/releases/assets/${asset.id}`,
                        method: 'DELETE',
                        headers: {
                            'Authorization': `token ${TOKEN}`,
                            'User-Agent': 'Node-Release-Uploader'
                        }
                    });
                } catch (e) {
                    console.warn(`Gagal menghapus asset ${asset.name}:`, e.message);
                }
            }
        }
    }

    console.log('Mengunggah SmartCBT_v2.9.7.apk ke GitHub...');
    await uploadAsset(releaseData.upload_url, apkSourcePath, `SmartCBT_${TAG}.apk`);

    console.log('Mengunggah SmartCBT_latest.apk ke GitHub...');
    await uploadAsset(releaseData.upload_url, apkSourcePath, 'SmartCBT_latest.apk');

    console.log('=== SEMUA TAHAP DEPLOYMENT v2.9.7 BERHASIL! ===');
}

run()
    .catch(err => {
        console.error('Error saat deployment:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
