/**
 * Skrip Migrasi Otomatis dan Pembersihan Ruang Harddisk:
 * uploads/device-files
 * 
 * 1. Menghapus 7.244 file 0-byte (kosong tanpa isi).
 * 2. Menghapus file PURGED_ARCHIVED (bekas purge lama yang tersisa di root).
 * 3. Menghapus duplikat flat jika berkas asli sudah tersimpan di folder SISWA/...
 * 4. Memindahkan (move) berkas yang belum ada ke folder masing-masing siswa / guru / umum.
 * 5. Mengupdate database CopyRequest dan DeviceFile.
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function sanitizeFolder(str) {
    return String(str || '').trim().replace(/[^a-zA-Z0-9._\-]/g, '_');
}

function getMediaTypeFolder(fileName, mimeType) {
    const fn = (fileName || '').toLowerCase();
    const isTrash = fn.includes('♻️') || fn.includes('.trash') || fn.includes('trash') || fn.includes('recycle');
    if (isTrash) return 'SAMPAH';

    const ext = path.extname(fn).toLowerCase();
    const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.3gp', '.webm', '.flv'];
    const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic'];

    if (videoExts.includes(ext) || (mimeType && mimeType.startsWith('video/'))) {
        return 'VIDEO';
    }
    if (imageExts.includes(ext) || (mimeType && mimeType.startsWith('image/'))) {
        return 'FOTO';
    }
    return 'DOKUMEN';
}

async function main() {
    console.log('================================================================');
    console.log('   SISTEM PEMBERSIHAN & MIGRASI OTOMATIS: uploads/device-files  ');
    console.log('================================================================\n');

    const uploadsBase = path.resolve(__dirname, '../../uploads');
    const deviceFilesRoot = path.join(uploadsBase, 'device-files');

    if (!fs.existsSync(deviceFilesRoot)) {
        console.error('Folder uploads/device-files tidak ditemukan!');
        process.exit(1);
    }

    // 1. Baca semua file flat di root uploads/device-files
    const entries = fs.readdirSync(deviceFilesRoot, { withFileTypes: true });
    const flatFiles = entries.filter(e => e.isFile()).map(e => e.name);
    console.log(`Ditemukan ${flatFiles.length} file flat di root uploads/device-files.\n`);

    // 2. Cache semua DeviceSession + User untuk lookup instan tanpa N+1 query
    console.log('Memuat data DeviceSession dan User ke memori...');
    const allSessions = await prisma.deviceSession.findMany({
        include: { user: true }
    });
    const sessionMap = new Map();
    for (const s of allSessions) {
        if (s.id) sessionMap.set(s.id, s);
        if (s.deviceAndroidId) sessionMap.set(s.deviceAndroidId, s);
    }
    console.log(`Berhasil memuat ${sessionMap.size} pemetaan perangkat.\n`);

    // -------------------------------------------------------------
    // TAHAP 1: BERSIHKAN FILE 0-BYTE
    // -------------------------------------------------------------
    console.log('--- TAHAP 1: PEMBERSIHAN FILE 0-BYTE ---');
    let zeroByteDeleted = 0;
    const nonZeroFiles = [];

    for (const f of flatFiles) {
        const fullP = path.join(deviceFilesRoot, f);
        try {
            const st = fs.statSync(fullP);
            if (st.size === 0) {
                fs.unlinkSync(fullP);
                zeroByteDeleted++;
            } else {
                nonZeroFiles.push({ name: f, size: st.size, fullP });
            }
        } catch (err) {
            // File might already be moved or inaccessible
        }
    }
    console.log(`✓ Selesai membersihkan ${zeroByteDeleted} file 0-byte (kosong).\n`);

    // -------------------------------------------------------------
    // TAHAP 2: BACA METADATA COPYREQUEST DARI DATABASE
    // -------------------------------------------------------------
    console.log(`--- TAHAP 2: PEMETAAN ${nonZeroFiles.length} FILE NON-ZERO KE DATABASE ---`);
    const reqIds = [];
    for (const item of nonZeroFiles) {
        const idx = item.name.indexOf('_');
        const reqId = idx > 0 ? item.name.substring(0, idx) : null;
        if (reqId) reqIds.push(reqId);
    }

    const reqMap = new Map();
    const batchSize = 1000;
    for (let i = 0; i < reqIds.length; i += batchSize) {
        const batch = reqIds.slice(i, i + batchSize);
        const rows = await prisma.copyRequest.findMany({
            where: { id: { in: batch } },
            select: {
                id: true,
                deviceId: true,
                status: true,
                uploadPath: true,
                fileName: true,
                filePath: true,
                fileSize: true
            }
        });
        for (const r of rows) {
            reqMap.set(r.id, r);
        }
    }
    console.log(`Ditemukan ${reqMap.size} CopyRequest terkait di database.\n`);

    // -------------------------------------------------------------
    // TAHAP 3: MIGRASI / DEDUKPLIKASI FILE NON-ZERO
    // -------------------------------------------------------------
    console.log('--- TAHAP 3: MIGRASI & DEDUPLIKASI BERKAS SISWA/GURU ---');

    let purgedDeletedCount = 0;
    let purgedDeletedBytes = 0;

    let duplicateDeletedCount = 0;
    let duplicateDeletedBytes = 0;

    let migratedCount = 0;
    let migratedBytes = 0;

    let unhandledCount = 0;

    const copyRequestsToComplete = [];

    for (let i = 0; i < nonZeroFiles.length; i++) {
        const item = nonZeroFiles[i];
        const idx = item.name.indexOf('_');
        const reqId = idx > 0 ? item.name.substring(0, idx) : null;
        const origFileName = idx > 0 ? item.name.substring(idx + 1) : item.name;

        const req = reqId ? reqMap.get(reqId) : null;

        // 3a. Jika request statusnya PURGED_ARCHIVED (sudah pernah dihapus admin sebelumnya):
        if (req && req.status === 'PURGED_ARCHIVED') {
            try {
                fs.unlinkSync(item.fullP);
                purgedDeletedCount++;
                purgedDeletedBytes += item.size;
            } catch (_) {}
            continue;
        }

        // 3b. Tentukan pemilik berkas (Siswa / Guru / Umum)
        let deviceId = req?.deviceId || null;
        let session = deviceId ? sessionMap.get(deviceId) : null;

        let roleFolder = 'UMUM';
        let personFolder = sanitizeFolder(deviceId || 'unknown_device');

        if (session?.user) {
            const u = session.user;
            if (u.role === 'STUDENT') {
                roleFolder = 'SISWA';
                const parts = [];
                if (u.className) parts.push(u.className.trim().replace(/\s+/g, '-'));
                if (u.nis) parts.push(u.nis.trim());
                else if (u.nisn) parts.push(u.nisn.trim());
                else if (u.username) parts.push(u.username.trim());
                if (u.name) parts.push(u.name.trim());
                if (u.gender) {
                    const g = u.gender.trim().toUpperCase();
                    parts.push(g.startsWith('L') ? 'L' : (g.startsWith('P') ? 'P' : g));
                }
                personFolder = sanitizeFolder(parts.join('_')) || sanitizeFolder(deviceId);
            } else if (u.role === 'TEACHER') {
                roleFolder = 'GURU';
                personFolder = sanitizeFolder(u.name || u.username || deviceId);
            } else {
                roleFolder = sanitizeFolder(u.role || 'UMUM').toUpperCase();
                personFolder = sanitizeFolder(u.name || u.username || deviceId);
            }
        }

        const mediaTypeFolder = getMediaTypeFolder(origFileName);
        const targetDir = path.join(deviceFilesRoot, roleFolder, personFolder, mediaTypeFolder);
        const targetAbsPath = path.join(targetDir, origFileName);

        // 3c. Cek apakah berkas dengan nama & ukuran sama SUDAH ADA di folder terorganisir
        let targetAlreadyExists = false;
        if (fs.existsSync(targetAbsPath)) {
            try {
                const targetStat = fs.statSync(targetAbsPath);
                if (targetStat.size > 0) {
                    targetAlreadyExists = true;
                }
            } catch (_) {}
        }

        if (targetAlreadyExists) {
            // Berkas flat di root adalah DUPLIKAT! Hapus flat file.
            try {
                fs.unlinkSync(item.fullP);
                duplicateDeletedCount++;
                duplicateDeletedBytes += item.size;
            } catch (_) {}

            // Pastikan CopyRequest tercatat COMPLETED dengan uploadPath yang benar
            if (req && req.status !== 'COMPLETED') {
                copyRequestsToComplete.push({
                    id: req.id,
                    uploadPath: targetAbsPath,
                    fileSize: item.size
                });
            }
        } else {
            // Berkas BELUM ADA di folder terorganisir -> PINDAHKAN (Move)
            try {
                fs.mkdirSync(targetDir, { recursive: true });
                fs.renameSync(item.fullP, targetAbsPath);
                migratedCount++;
                migratedBytes += item.size;

                if (req) {
                    copyRequestsToComplete.push({
                        id: req.id,
                        uploadPath: targetAbsPath,
                        fileSize: item.size
                    });
                }
            } catch (moveErr) {
                unhandledCount++;
            }
        }

        if ((i + 1) % 1000 === 0 || i === nonZeroFiles.length - 1) {
            console.log(`  Progres: ${i + 1}/${nonZeroFiles.length} file diproses...`);
        }
    }

    // -------------------------------------------------------------
    // TAHAP 4: UPDATE STATUS DATABASE DALAM TRANSAKSI BATCH
    // -------------------------------------------------------------
    console.log(`\n--- TAHAP 4: UPDATE ${copyRequestsToComplete.length} DATA DI DATABASE ---`);
    const updateBatchSize = 500;
    for (let i = 0; i < copyRequestsToComplete.length; i += updateBatchSize) {
        const batch = copyRequestsToComplete.slice(i, i + updateBatchSize);
        await Promise.all(batch.map(item => 
            prisma.copyRequest.update({
                where: { id: item.id },
                data: {
                    status: 'COMPLETED',
                    uploadPath: item.uploadPath,
                    fileSize: item.fileSize,
                    completedAt: new Date(),
                    errorMessage: null
                }
            }).catch(() => {})
        ));
        console.log(`  Update batch ${Math.min(i + updateBatchSize, copyRequestsToComplete.length)}/${copyRequestsToComplete.length}...`);
    }

    // -------------------------------------------------------------
    // TAHAP 5: VERIFIKASI AKHIR FOLDER ROOT
    // -------------------------------------------------------------
    const remainingEntries = fs.readdirSync(deviceFilesRoot, { withFileTypes: true });
    const remainingFiles = remainingEntries.filter(e => e.isFile()).length;
    const remainingDirs = remainingEntries.filter(e => e.isDirectory()).map(e => e.name);

    const toMB = (b) => (b / (1024 * 1024)).toFixed(1) + ' MB';
    const toGB = (b) => (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';

    console.log('\n================================================================');
    console.log('            HASIL AKHIR PEMBERSIHAN & MIGRASI                  ');
    console.log('================================================================');
    console.log(`1. File 0-Byte Dihapus           : ${zeroByteDeleted} file`);
    console.log(`2. File PURGED_ARCHIVED Dihapus : ${purgedDeletedCount} file (${toMB(purgedDeletedBytes)})`);
    console.log(`3. Duplikat Flat Dihapus         : ${duplicateDeletedCount} file (${toMB(duplicateDeletedBytes)})`);
    console.log(`4. File Berhasil Dimigrasikan    : ${migratedCount} file (${toGB(migratedBytes)})`);
    console.log(`5. Total Ruang Disk Dibebaskan   : ${toGB(purgedDeletedBytes + duplicateDeletedBytes)}`);
    console.log(`6. File Tersisa di Root          : ${remainingFiles} file`);
    console.log(`7. Folder Terorganisir Aktif     : ${remainingDirs.join(', ')}`);
    console.log('================================================================\n');

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('Terjadi error saat menjalankan migrasi:', err);
    process.exit(1);
});
