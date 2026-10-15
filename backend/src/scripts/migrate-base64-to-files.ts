import prisma from '../utils/db';
import path from 'path';
import fs from 'fs';

/**
 * Validasi dan deteksi MIME type dari magic bytes buffer
 */
function detectMimeFromBuffer(buffer: Buffer): string | null {
    if (!buffer || buffer.length < 4) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
        buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
        return 'image/png';
    }

    // WebP: RIFF (bytes 0-3) .... WEBP (bytes 8-11)
    if (buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'image/webp';
    }

    // PDF: %PDF (25 50 44 46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
        return 'application/pdf';
    }

    // Matroska / MKV: 1A 45 DF A3
    if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
        return 'video/x-matroska';
    }

    // ISO Base Media File Format: MP4 / MOV / HEIC
    if (buffer.length >= 12 &&
        buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        const brand = buffer.toString('ascii', 8, 12).toLowerCase();
        if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1') || brand.startsWith('msf1')) {
            return 'image/heic';
        }
        if (brand === 'qt  ') return 'video/quicktime';
        return 'video/mp4';
    }

    return null;
}

/**
 * Script Migrasi Data Base64 ke File Fisik di Filesystem
 * Menghilangkan penyimpanan Base64 di database SQLite untuk menyusutkan ukuran database.
 * 
 * Jalankan: npx ts-node src/scripts/migrate-base64-to-files.ts
 */
async function migrateBase64ToFiles() {
    console.log('=== MEMULAI MIGRASI BASE64 DEVICEFILE KE FILESYSTEM ===\n');

    const uploadsBase = path.resolve(__dirname, '../../uploads');
    const errorLogPath = path.resolve(__dirname, '../../migrate-errors.log');
    const BATCH_SIZE = 500;

    let processedCount = 0;
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    const failedIds = new Set<string>();

    const totalToMigrate = await prisma.deviceFile.count({
        where: { thumbnailBase64: { not: null } }
    });

    console.log(`Total record DeviceFile dengan Base64: ${totalToMigrate}`);
    if (totalToMigrate === 0) {
        console.log('Tidak ada data Base64 yang perlu dimigrasikan. Selesai.');
        await prisma.$disconnect();
        return;
    }

    while (true) {
        const batch = await prisma.deviceFile.findMany({
            where: {
                thumbnailBase64: { not: null },
                id: { notIn: Array.from(failedIds) }
            },
            take: BATCH_SIZE,
            orderBy: { id: 'asc' }
        });

        if (!batch || batch.length === 0) break;

        for (const item of batch) {
            processedCount++;
            try {
                let base64Str = item.thumbnailBase64?.trim() || '';
                if (!base64Str) {
                    // Hanya kosongkan jika null string
                    await prisma.deviceFile.update({
                        where: { id: item.id },
                        data: { thumbnailBase64: null }
                    });
                    skipCount++;
                    continue;
                }

                // Hapus data URI prefix jika ada
                if (base64Str.startsWith('data:')) {
                    const commaIdx = base64Str.indexOf(',');
                    if (commaIdx !== -1) {
                        base64Str = base64Str.substring(commaIdx + 1);
                    }
                }

                const buffer = Buffer.from(base64Str, 'base64');
                if (buffer.length === 0) {
                    await prisma.deviceFile.update({
                        where: { id: item.id },
                        data: { thumbnailBase64: null }
                    });
                    skipCount++;
                    continue;
                }

                const detectedMime = detectMimeFromBuffer(buffer) || item.mimeType || 'image/jpeg';
                const safeDeviceId = String(item.deviceId || 'unknown_device').replace(/[^a-zA-Z0-9_-]/g, '_');
                const rawBase = path.basename(item.fileName || 'device_file.jpg').replace(/[^a-zA-Z0-9._\-]/g, '_');
                const ext = path.extname(rawBase) || (detectedMime === 'image/jpeg' ? '.jpg' : '.bin');
                const nameWithoutExt = path.basename(rawBase, ext);

                const dateRef = item.lastModified || item.syncedAt || new Date();
                const year = String(dateRef.getFullYear());
                const month = String(dateRef.getMonth() + 1).padStart(2, '0');

                const relFolder = path.join('device-files', safeDeviceId, year, month);
                const absFolder = path.join(uploadsBase, relFolder);

                await fs.promises.mkdir(absFolder, { recursive: true });

                let finalFileName = rawBase;
                let targetAbsPath = path.join(absFolder, finalFileName);
                let counter = 1;

                while (fs.existsSync(targetAbsPath)) {
                    finalFileName = `${nameWithoutExt}_${counter}${ext}`;
                    targetAbsPath = path.join(absFolder, finalFileName);
                    counter++;
                }

                // Tulis file fisik
                await fs.promises.writeFile(targetAbsPath, buffer);

                const relFilePath = path.join(relFolder, finalFileName).replace(/\\/g, '/');

                // Update database
                await prisma.deviceFile.update({
                    where: { id: item.id },
                    data: {
                        filePath: relFilePath,
                        fileSize: buffer.length,
                        mimeType: detectedMime,
                        thumbnailBase64: null
                    }
                });

                successCount++;
            } catch (err: any) {
                errorCount++;
                failedIds.add(item.id);
                const errMsg = `[${new Date().toISOString()}] ID: ${item.id}, File: ${item.fileName}, Err: ${err?.message || err}\n`;
                await fs.promises.appendFile(errorLogPath, errMsg, 'utf8').catch(() => {});
            }

            if (processedCount % 1000 === 0) {
                console.log(`[Progress] Diproses: ${processedCount}/${totalToMigrate} (Sukses: ${successCount}, Skip: ${skipCount}, Gagal: ${errorCount})`);
            }
        }
    }

    console.log(`\n=== MIGRASI SELESAI ===`);
    console.log(`Total Diproses: ${processedCount}`);
    console.log(`Berhasil: ${successCount}`);
    console.log(`Dilewati: ${skipCount}`);
    console.log(`Gagal: ${errorCount}`);
    if (errorCount > 0) {
        console.log(`Detail error tercatat di: ${errorLogPath}`);
    }

    console.log('\nMenjalankan checkpoint database SQLite (PRAGMA wal_checkpoint)...');
    try {
        await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
        console.log('PRAGMA wal_checkpoint(TRUNCATE) berhasil.');
    } catch (e: any) {
        console.warn('Gagal wal_checkpoint:', e?.message || e);
    }

    await prisma.$disconnect();
    console.log('Selesai.');
}

migrateBase64ToFiles().catch((err) => {
    console.error('Fatal error during migration:', err);
    process.exit(1);
});
