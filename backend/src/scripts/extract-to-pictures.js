const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Deteksi ekstensi file dari magic bytes buffer
 */
function getExtFromBuffer(buffer) {
    if (!buffer || buffer.length < 4) return '.jpg';
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return '.jpg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return '.png';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return '.webp';
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return '.pdf';
    return '.jpg';
}

async function extractToPictures() {
    console.log('======================================================================');
    console.log('   EKSTRAKSI FOTO DARI F:\\dev.db KE FOLDER DOKUMEN / PICTURES        ');
    console.log('======================================================================\n');

    const dbPath = 'F:/dev.db';
    if (!fs.existsSync(dbPath)) {
        console.error('File F:/dev.db tidak ditemukan!');
        process.exit(1);
    }

    const initialStat = fs.statSync(dbPath);
    console.log(`[Database F:\\dev.db] Ukuran awal: ${(initialStat.size / (1024 * 1024)).toFixed(2)} MB (${(initialStat.size / (1024 * 1024 * 1024)).toFixed(2)} GB)`);

    // Target direktori utama: Dokumen / Pictures
    const targetDocsPicturesDir = path.resolve('C:/Users/user/Documents/Pictures');
    const targetPicturesDir = path.resolve('C:/Users/user/Pictures/Device_Files');

    fs.mkdirSync(targetDocsPicturesDir, { recursive: true });

    // Buat Directory Junction di C:\Users\user\Pictures\Device_Files jika belum ada
    if (!fs.existsSync(targetPicturesDir)) {
        try {
            execSync(`cmd /c mklink /J "${targetPicturesDir}" "${targetDocsPicturesDir}"`, { stdio: 'ignore' });
            console.log(`[Junction Dibuat] ${targetPicturesDir} <==> ${targetDocsPicturesDir}`);
        } catch (jErr) {
            fs.mkdirSync(targetPicturesDir, { recursive: true });
        }
    }

    console.log(`[Tujuan Ekstraksi Dokumen] ${targetDocsPicturesDir}`);
    console.log(`[Tujuan Ekstraksi Picture] ${targetPicturesDir}\n`);

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
            console.error('Gagal membuka F:/dev.db:', err);
            process.exit(1);
        }
    });

    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    const all = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    await run('PRAGMA busy_timeout = 60000;');
    await run('PRAGMA synchronous = NORMAL;');
    await run('PRAGMA journal_mode = WAL;');

    // 1. Ambil pemetaan deviceId ke nama siswa & kelas agar folder rapi
    console.log('Membaca data nama siswa & perangkat...');
    const userDeviceMap = new Map();
    try {
        const deviceRows = await all(`
            SELECT d.id as deviceId, u.name, u.className
            FROM DeviceSession d
            LEFT JOIN User u ON d.userId = u.id
        `);
        for (const row of deviceRows) {
            const cleanClass = (row.className || 'NON_KELAS').replace(/[^a-zA-Z0-9_-]/g, '_');
            const cleanName = (row.name || 'Siswa_Device').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
            const folderLabel = `${cleanClass}_${cleanName}`.substring(0, 50);
            userDeviceMap.set(row.deviceId, folderLabel);
        }
        console.log(`Berhasil memetakan ${userDeviceMap.size} perangkat ke nama siswa.\n`);
    } catch (mapErr) {
        console.warn('Gagal memetakan nama siswa (fallback ke deviceId):', mapErr.message);
    }

    const createdFolders = new Set();
    const BATCH_SIZE = 1000;
    let totalExtracted = 0;
    let totalUpdated = 0;
    let lastId = '';
    const startTime = Date.now();

    console.log('Memulai proses ekstraksi berkas foto & pembersihan Base64...\n');

    while (true) {
        let rows = [];
        try {
            rows = await all(
                "SELECT id, deviceId, fileName, thumbnailBase64 " +
                "FROM DeviceFile " +
                "WHERE thumbnailBase64 IS NOT NULL AND id > ? " +
                "ORDER BY id ASC LIMIT ?",
                [lastId, BATCH_SIZE]
            );
        } catch (fetchErr) {
            console.error(`[Error Fetch pada id > ${lastId}]:`, fetchErr.message);
            // Jika ada halaman korup, cari id berikutnya dengan offset
            try {
                const nextRow = await all("SELECT id FROM DeviceFile WHERE id > ? ORDER BY id ASC LIMIT 1 OFFSET 200", [lastId]);
                if (nextRow && nextRow.length > 0) {
                    lastId = nextRow[0].id;
                    continue;
                }
            } catch (skipErr) {}
            break;
        }

        if (!rows || rows.length === 0) {
            break;
        }

        const idsToNull = [];
        const writePromises = [];

        for (const item of rows) {
            lastId = item.id;
            try {
                let b64 = (item.thumbnailBase64 || '').trim();
                if (!b64) {
                    idsToNull.push(item.id);
                    continue;
                }

                if (b64.startsWith('data:')) {
                    const comma = b64.indexOf(',');
                    if (comma !== -1) b64 = b64.substring(comma + 1);
                }

                const buffer = Buffer.from(b64, 'base64');
                if (buffer.length === 0) {
                    idsToNull.push(item.id);
                    continue;
                }

                const folderName = userDeviceMap.get(item.deviceId) || String(item.deviceId || 'device_files').replace(/[^a-zA-Z0-9_-]/g, '_');
                const targetDir = path.join(targetDocsPicturesDir, folderName);

                if (!createdFolders.has(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                    createdFolders.add(targetDir);
                }

                const ext = getExtFromBuffer(buffer);
                let rawBase = path.basename(item.fileName || 'foto.jpg').replace(/[^a-zA-Z0-9._\-]/g, '_');
                if (!rawBase.toLowerCase().endsWith(ext)) {
                    rawBase = `${path.basename(rawBase, path.extname(rawBase))}${ext}`;
                }

                // Sertakan 6 digit ID untuk mencegah file tertimpa jika nama sama
                const uniqueFileName = `${path.basename(rawBase, ext)}_${item.id.substring(0, 6)}${ext}`;
                const outFilePath = path.join(targetDir, uniqueFileName);

                writePromises.push(
                    fs.promises.writeFile(outFilePath, buffer)
                        .then(() => {
                            idsToNull.push(item.id);
                            totalExtracted++;
                        })
                        .catch(() => {
                            idsToNull.push(item.id);
                        })
                );
            } catch (err) {
                idsToNull.push(item.id);
            }
        }

        // Tulis semua file dalam batch ini secara paralel
        await Promise.all(writePromises);

        // Hapus Base64 dari database (set thumbnailBase64 = NULL)
        if (idsToNull.length > 0) {
            try {
                await run('BEGIN TRANSACTION;');
                const stmt = db.prepare('UPDATE DeviceFile SET thumbnailBase64 = NULL WHERE id = ?');
                for (const id of idsToNull) {
                    stmt.run([id]);
                }
                await new Promise((res, rej) => stmt.finalize((err) => err ? rej(err) : res()));
                await run('COMMIT;');
                totalUpdated += idsToNull.length;
            } catch (updErr) {
                console.error('[Update Err]:', updErr.message);
                try { await run('ROLLBACK;'); } catch (rb) {}
            }
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (totalExtracted / elapsed).toFixed(0);
        console.log(`[Ekstraksi] Berhasil: ${totalExtracted.toLocaleString()} foto | Dihapus dari DB: ${totalUpdated.toLocaleString()} | Kecepatan: ${rate} foto/dtk`);
    }

    console.log('\n======================================================================');
    console.log('   EKSTRAKSI SELESAI! MENJALANKAN CHECKPOINT & VACUUM                ');
    console.log('======================================================================');
    console.log(`Total Foto Diekstrak ke Folder Dokumen/Pictures: ${totalExtracted.toLocaleString()}`);
    console.log(`Total Base64 Dihapus dari F:\\dev.db            : ${totalUpdated.toLocaleString()}`);

    try {
        console.log('\nMenjalankan checkpoint WAL...');
        await run('PRAGMA wal_checkpoint(TRUNCATE);');
        console.log('PRAGMA wal_checkpoint(TRUNCATE) berhasil.');
    } catch (e) {
        console.warn('Checkpoint error:', e.message);
    }

    try {
        console.log('Menjalankan VACUUM pada F:\\dev.db untuk mengecilkan ukuran file...');
        const vacStart = Date.now();
        await run('VACUUM;');
        console.log(`VACUUM berhasil dalam ${((Date.now() - vacStart) / 1000).toFixed(1)} detik.`);
    } catch (vacErr) {
        console.warn('Catatan VACUUM:', vacErr.message);
    }

    db.close();

    const finalStat = fs.statSync(dbPath);
    console.log('\n======================================================================');
    console.log('   HASIL AKHIR & STATUS PENYIMPANAN                                   ');
    console.log('======================================================================');
    console.log(`Ukuran F:\\dev.db Sebelum : ${(initialStat.size / (1024 * 1024)).toFixed(2)} MB (3.31 GB)`);
    console.log(`Ukuran F:\\dev.db Sesudah : ${(finalStat.size / (1024 * 1024)).toFixed(2)} MB`);
    const diffMb = ((initialStat.size - finalStat.size) / (1024 * 1024)).toFixed(2);
    console.log(`Kapasitas Berhasil Dihemat: ${diffMb} MB (~${(diffMb / 1024).toFixed(2)} GB)`);
    console.log(`Folder Foto Siap Dibuka di: ${targetDocsPicturesDir}`);
    console.log(`Dan dapat diakses juga di : ${targetPicturesDir}`);
    console.log('======================================================================\n');
}

extractToPictures().catch((err) => {
    console.error('Fatal extraction error:', err);
    process.exit(1);
});
