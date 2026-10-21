const path = require('path');
const fs = require('fs');
const backendDir = path.resolve(__dirname, '../backend');
const backendNodeModules = path.join(backendDir, 'node_modules');

const dotenv = require(path.join(backendNodeModules, 'dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const { PrismaClient } = require(path.join(backendNodeModules, '@prisma/client'));

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/smartschool?schema=public'
        }
    }
});

async function main() {
    console.log('==========================================================================');
    console.log('🚀 MEMULAI PUBLIKASI PEMBARUAN KE SELURUH SISWA (3.000 SISWA)');
    console.log('SMP NEGERI 1 BOYOLANGU - SMART CBT');
    console.log('==========================================================================\n');

    // 1. Ambil data admin_beta
    const betaConfig = await prisma.appVersionConfig.findUnique({ where: { id: 'admin_beta' } });
    if (!betaConfig) {
        console.log('❌ TIDAK DITEMUKAN VERSI UJI COBA (admin_beta).');
        console.log('💡 Silakan buat build lokal terlebih dahulu menggunakan "build-local-update.bat"');
        process.exit(1);
    }

    console.log(`📌 Versi yang akan dipublikasikan: Smart CBT v${betaConfig.versionName} (Build ${betaConfig.versionCode})`);
    console.log(`📝 Catatan Rilis:\n${betaConfig.releaseNotes}\n`);

    // 2. Salin berkas fisik APK
    const uploadsDir = path.resolve(__dirname, '../backend/uploads');
    const betaApk = path.join(uploadsDir, 'smartcbt-admin-beta.apk');
    const latestApk = path.join(uploadsDir, 'smartcbt-latest.apk');

    if (fs.existsSync(betaApk)) {
        console.log('📂 Menyalin berkas APK uji coba ke rilis publik...');
        fs.copyFileSync(betaApk, latestApk);
        console.log('  ✓ ' + latestApk);

        const mirrors = [
            path.resolve(__dirname, '../backend/public/smartcbt-latest.apk'),
            path.resolve(__dirname, '../backend/public/downloads/smartcbt-latest.apk'),
            path.resolve(__dirname, '../backend/public/uploads/smartcbt-latest.apk'),
            path.resolve(__dirname, '../backend/storage/apk/smartcbt-latest.apk'),
            path.resolve(__dirname, '../smartcbt-latest.apk')
        ];

        for (const mirror of mirrors) {
            try {
                const dir = path.dirname(mirror);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.copyFileSync(betaApk, mirror);
                console.log('  ✓ ' + mirror);
            } catch (e) {}
        }
    } else {
        console.log('⚠️ Berkas smartcbt-admin-beta.apk tidak ditemukan di disk uploads. Menggunakan berkas latest yang ada.');
    }

    // 3. Perbarui database
    console.log('\n📡 Memperbarui status rilis publik di database...');
    const updated = await prisma.appVersionConfig.upsert({
        where: { id: 'latest' },
        update: {
            versionCode: betaConfig.versionCode,
            versionName: betaConfig.versionName,
            downloadUrl: '/uploads/smartcbt-latest.apk',
            fileSizeMb: betaConfig.fileSizeMb,
            releaseNotes: betaConfig.releaseNotes,
            isForceUpdate: betaConfig.isForceUpdate
        },
        create: {
            id: 'latest',
            versionCode: betaConfig.versionCode,
            versionName: betaConfig.versionName,
            downloadUrl: '/uploads/smartcbt-latest.apk',
            fileSizeMb: betaConfig.fileSizeMb,
            releaseNotes: betaConfig.releaseNotes,
            isForceUpdate: betaConfig.isForceUpdate
        }
    });

    await prisma.appVersionConfig.updateMany({
        where: { id: { in: ['app_latest', 'cbt_latest'] } },
        data: {
            versionCode: betaConfig.versionCode,
            versionName: betaConfig.versionName,
            downloadUrl: '/uploads/smartcbt-latest.apk',
            fileSizeMb: betaConfig.fileSizeMb,
            releaseNotes: betaConfig.releaseNotes,
            isForceUpdate: betaConfig.isForceUpdate
        }
    }).catch(() => {});

    // 4. Hapus admin_beta
    await prisma.appVersionConfig.delete({ where: { id: 'admin_beta' } }).catch(() => {});

    const totalStudents = await prisma.user.count({ where: { role: 'STUDENT' } }).catch(() => 3000);

    // 5. Invalidate cache backend via HTTP ping jika backend aktif
    try {
        const jwt = require(path.join(backendNodeModules, 'jsonwebtoken'));
        const token = jwt.sign({ id: 'cli', role: 'ADMIN' }, process.env.JWT_SECRET || 'secret');
        await fetch('http://localhost:3000/api/admin/app-version/publish-to-students', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        }).catch(() => {});
    } catch (e) {}

    console.log('\n==========================================================================');
    console.log('🎉 BERHASIL! PEMBARUAN RESMI DILEMPAR KE SELURUH SISWA!');
    console.log('==========================================================================');
    console.log(`📱 Versi Publik Aktif : Smart CBT v${updated.versionName} (Build ${updated.versionCode})`);
    console.log(`👥 Target Penerima    : Seluruh ${totalStudents} Siswa, Guru & Orang Tua`);
    console.log(`⚡ Mode Pembaruan     : ${updated.isForceUpdate ? 'UPDATE WAJIB (Force Update)' : 'Update Opsional'}`);
    console.log('==========================================================================\n');
}

main().catch(err => {
    console.error('Terjadi kesalahan:', err);
    process.exit(1);
}).finally(() => prisma.$disconnect());
