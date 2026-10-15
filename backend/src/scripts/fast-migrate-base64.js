const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * Deteksi MIME type dari magic bytes buffer secara presisi
 */
function detectMime(buffer) {
    if (!buffer || buffer.length < 4) return 'image/jpeg';
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
    return 'image/jpeg';
}

async function runFastMigration() {
    console.log('===============================================================');
    console.log('   EKSTRAKSI CEPAT & PENGOSONGAN DATA BASE64 DEVICEFILE        ');
    console.log('===============================================================\n');

    const dbPath = path.resolve(__dirname, '../../prisma/dev.db');
    const uploadsBase = path.resolve(__dirname, '../../uploads');
    const errorLogPath = path.resolve(__dirname, '../../migrate-errors.log');

    const initialDbStat = fs.statSync(dbPath);
    console.log(`[Database Awal] dev.db: ${(initialDbStat.size / (1024 * 1024)).toFixed(2)} MB`);

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
            console.error('Gagal membuka dev.db:', err);
            process.exit(1);
        }
    });

    // Helper Promise untuk query SQLite
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

    const get = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    // Konfigurasi performa SQLite
    await run('PRAGMA busy_timeout = 60000;');
    await run('PRAGMA synchronous = NORMAL;');
    await run('PRAGMA journal_mode = WAL;');

    const countRow = await get("SELECT COUNT(*) as total FROM DeviceFile WHERE thumbnailBase64 IS NOT NULL AND length(thumbnailBase64) > 0");
    const totalTarget = countRow ? countRow.total : 0;
    console.log(`Total record Base64 yang akan diekstrak & dihapus: ${totalTarget.toLocaleString()} berkas\n`);

    if (totalTarget === 0) {
        console.log('Tidak ada data Base64 lama yang tersisa di database. Selesai.');
        db.close();
        return;
    }

    const createdDirs = new Set();
    const BATCH_SIZE = 1000;
    let processed = 0;
    let successCount = 0;
    let errorCount = 0;
    const startTime = Date.now();

    while (true) {
        // Ambil batch 1000 record
        const rows = await all(
            "SELECT id, deviceId, fileName, filePath, fileSize, mimeType, lastModified, syncedAt, thumbnailBase64 " +
            "FROM DeviceFile WHERE thumbnailBase64 IS NOT NULL AND length(thumbnailBase64) > 0 LIMIT ?",
            [BATCH_SIZE]
        );

        if (!rows || rows.length === 0) break;

        const updatePayloads = [];

        // 1. Ekstraksi buffer dan tulis ke filesystem fisik
        for (const item of rows) {
            try {
                let b64 = item.thumbnailBase64.trim();
                if (b64.startsWith('data:')) {
                    const comma = b64.indexOf(',');
                    if (comma !== -1) b64 = b64.substring(comma + 1);
                }

                const buffer = Buffer.from(b64, 'base64');
                if (buffer.length === 0) {
                    updatePayloads.push({ id: item.id, relPath: item.filePath, size: 0, mime: item.mimeType || 'image/jpeg' });
                    continue;
                }

                const safeDeviceId = String(item.deviceId || 'unknown_device').replace(/[^a-zA-Z0-9_-]/g, '_');
                const rawName = path.basename(item.fileName || 'device_thumb.jpg').replace(/[^a-zA-Z0-9._\-]/g, '_');
                
                let dateVal = item.lastModified ? new Date(item.lastModified) : (item.syncedAt ? new Date(item.syncedAt) : new Date());
                if (isNaN(dateVal.getTime())) dateVal = new Date();
                
                const year = String(dateVal.getFullYear());
                const month = String(dateVal.getMonth() + 1).padStart(2, '0');

                const relDir = path.join('device-files', safeDeviceId, year, month);
                const absDir = path.join(uploadsBase, relDir);

                if (!createdDirs.has(absDir)) {
                    await fs.promises.mkdir(absDir, { recursive: true });
                    createdDirs.add(absDir);
                }

                const absPath = path.join(absDir, rawName);
                await fs.promises.writeFile(absPath, buffer);

                const detectedMime = detectMime(buffer);
                const relPath = path.join(relDir, rawName).replace(/\\/g, '/');

                updatePayloads.push({
                    id: item.id,
                    relPath,
                    size: buffer.length,
                    mime: detectedMime
                });
                successCount++;
            } catch (itemErr) {
                errorCount++;
                const errMsg = `[${new Date().toISOString()}] ID: ${item.id}, Err: ${itemErr.message}\n`;
                fs.appendFileSync(errorLogPath, errMsg, 'utf8');
                // Hapus Base64 agar tidak loop selamanya
                updatePayloads.push({ id: item.id, relPath: item.filePath, size: item.fileSize || 0, mime: item.mimeType || 'image/jpeg' });
            }
        }

        // 2. Simpan perubahan ke SQLite dalam 1 Transaksi Cepat
        await run('BEGIN TRANSACTION;');
        const stmt = db.prepare(
            "UPDATE DeviceFile SET thumbnailBase64 = NULL, filePath = ?, fileSize = ?, mimeType = ? WHERE id = ?"
        );

        for (const u of updatePayloads) {
            stmt.run([u.relPath, u.size, u.mime, u.id]);
        }

        await new Promise((resolve, reject) => {
            stmt.finalize((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await run('COMMIT;');

        processed += rows.length;

        // Progress telemetry
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rate = (processed / elapsedSec).toFixed(0);
        const percent = ((processed / totalTarget) * 100).toFixed(1);
        const remainingSec = ((totalTarget - processed) / (processed / elapsedSec)).toFixed(0);
        const remMin = Math.floor(remainingSec / 60);
        const remSec = remainingSec % 60;

        console.log(`[Progress] ${processed.toLocaleString()} / ${totalTarget.toLocaleString()} (${percent}%) | Kecepatan: ${rate} item/dtk | Sisa estimasi: ${remMin}m ${remSec}s`);
    }

    console.log('\n===============================================================');
    console.log('   SELURUH BERKAS BERHASIL DIEKSTRAK KE FILESYSTEM!            ');
    console.log('===============================================================');
    console.log(`Total Diproses : ${processed.toLocaleString()}`);
    console.log(`Berhasil       : ${successCount.toLocaleString()}`);
    console.log(`Gagal / Error  : ${errorCount.toLocaleString()}`);

    console.log('\n[Langkah Akhir 1/2] Menjalankan PRAGMA wal_checkpoint(TRUNCATE)...');
    await run('PRAGMA wal_checkpoint(TRUNCATE);');
    console.log('Checkpoint WAL selesai.');

    console.log('\n[Langkah Akhir 2/2] Menjalankan VACUUM untuk mengecilkan ukuran database dev.db...');
    const vacStart = Date.now();
    await run('VACUUM;');
    console.log(`VACUUM selesai dalam ${((Date.now() - vacStart) / 1000).toFixed(1)} detik.`);

    db.close();

    const finalDbStat = fs.statSync(dbPath);
    console.log('\n===============================================================');
    console.log('   RINGKASAN PENYUSUTAN DATABASE (HASIL AKHIR)                 ');
    console.log('===============================================================');
    console.log(`Ukuran dev.db Sebelum : ${(initialDbStat.size / (1024 * 1024)).toFixed(2)} MB (3.15 GB)`);
    console.log(`Ukuran dev.db Sesudah : ${(finalDbStat.size / (1024 * 1024)).toFixed(2)} MB`);
    const savedMb = ((initialDbStat.size - finalDbStat.size) / (1024 * 1024)).toFixed(2);
    console.log(`Ruang Disk Dihemat    : ${savedMb} MB (~${(savedMb / 1024).toFixed(2)} GB)\n`);
}

runFastMigration().catch((err) => {
    console.error('Fatal error saat migrasi:', err);
    process.exit(1);
});
