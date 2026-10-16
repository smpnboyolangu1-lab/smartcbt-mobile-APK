import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import util from 'util';

const execPromise = util.promisify(exec);

const BACKUP_DIR = path.resolve(__dirname, '../../storage/backups');
const PG_DUMP_PATH = path.resolve(__dirname, '../../../pgsql/bin/pg_dump.exe');
const PSQL_PATH = path.resolve(__dirname, '../../../pgsql/bin/psql.exe');

export interface BackupResult {
    success: boolean;
    backupPath?: string;
    fileSizeBytes?: number;
    fileSizeMb?: string;
    timestamp?: string;
    message: string;
}

/**
 * Memastikan direktori backup tersedia
 */
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

/**
 * Menjalankan Automated Database Backup (P0 / B-16)
 * Target: RPO <= 24 jam, RTO <= 8 jam
 */
export async function runDatabaseBackup(): Promise<BackupResult> {
    ensureBackupDir();

    const now = new Date();
    const dateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }).replace(/-/g, '');
    const timeStr = now.toLocaleTimeString('sv-SE', { timeZone: 'Asia/Jakarta' }).replace(/:/g, '');
    const backupFileName = `smartschool_backup_${dateStr}_${timeStr}.sql`;
    const sqlFilePath = path.join(BACKUP_DIR, backupFileName);
    const gzFilePath = `${sqlFilePath}.gz`;

    const env = {
        ...process.env,
        PGPASSWORD: process.env.DB_PASSWORD || 'postgres'
    };

    const dumpCmd = `"${PG_DUMP_PATH}" -U postgres -h localhost -p 5432 -d smartschool -F p --no-owner --no-acl -f "${sqlFilePath}"`;

    try {
        console.log(`📦 [BACKUP SERVICE] Memulai dump database PostgreSQL ke ${sqlFilePath}...`);
        await execPromise(dumpCmd, { env });

        if (!fs.existsSync(sqlFilePath)) {
            throw new Error('File hasil pg_dump tidak ditemukan di disk.');
        }

        // Kompres file SQL dengan GZIP
        const fileContents = fs.createReadStream(sqlFilePath);
        const writeStream = fs.createWriteStream(gzFilePath);
        const zip = zlib.createGzip({ level: 9 });

        await new Promise<void>((resolve, reject) => {
            fileContents
                .pipe(zip)
                .pipe(writeStream)
                .on('finish', () => resolve())
                .on('error', (err) => reject(err));
        });

        // Hapus file .sql mentah setelah sukses terkompresi
        try { fs.unlinkSync(sqlFilePath); } catch (e) {}

        const stats = fs.statSync(gzFilePath);
        const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`✅ [BACKUP SERVICE] Backup berhasil disimpan: ${gzFilePath} (${sizeMb} MB)`);

        // Rotasi backup (pertahankan 7 backup harian terakhir)
        await pruneOldBackups(7);

        return {
            success: true,
            backupPath: gzFilePath,
            fileSizeBytes: stats.size,
            fileSizeMb: `${sizeMb} MB`,
            timestamp: now.toISOString(),
            message: `Backup database PostgreSQL berhasil dibuat (${sizeMb} MB).`
        };
    } catch (err: any) {
        console.error('❌ [BACKUP SERVICE Error]', err);
        return {
            success: false,
            message: `Gagal membuat backup database: ${err.message}`
        };
    }
}

/**
 * Hapus backup yang lebih tua dari maxRetained
 */
async function pruneOldBackups(maxRetained: number = 7) {
    try {
        ensureBackupDir();
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('smartschool_backup_') && f.endsWith('.sql.gz'))
            .map(f => ({
                name: f,
                path: path.join(BACKUP_DIR, f),
                time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length > maxRetained) {
            const toDelete = files.slice(maxRetained);
            for (const item of toDelete) {
                fs.unlinkSync(item.path);
                console.log(`🗑️ [BACKUP RETENTION] Menghapus backup usang: ${item.name}`);
            }
        }
    } catch (e) {
        console.warn('Peringatan saat membersihkan backup lama:', e);
    }
}

/**
 * Uji Integritas Pemulihan / Restore Simulation (P0 / B-16)
 * Membaca header dan struktur file backup terkompresi untuk memverifikasi kelayakan restorasi.
 */
export async function testBackupRestoreIntegrity(backupFileGz?: string): Promise<{ valid: boolean; summary: string }> {
    ensureBackupDir();
    let target = backupFileGz;
    if (!target) {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('smartschool_backup_') && f.endsWith('.sql.gz'))
            .sort()
            .reverse();
        if (files.length === 0) {
            return { valid: false, summary: 'Tidak ada berkas backup yang tersedia untuk diuji.' };
        }
        target = path.join(BACKUP_DIR, files[0]);
    }

    try {
        const compressed = fs.readFileSync(target);
        const decompressed = zlib.gunzipSync(compressed).toString('utf-8');

        const hasPostgresHeader = decompressed.includes('PostgreSQL database dump') || decompressed.includes('CREATE TABLE');
        const hasCompleteTrailer = decompressed.includes('PostgreSQL database dump complete');

        if (hasPostgresHeader && hasCompleteTrailer) {
            return {
                valid: true,
                summary: `Verifikasi integritas lolos: Header dan trailer dump PostgreSQL valid. Ukuran terdekompresi: ${(decompressed.length / 1024 / 1024).toFixed(2)} MB.`
            };
        } else {
            return {
                valid: false,
                summary: `Berkas dump tidak lengkap atau header/trailer tidak ditemukan.`
            };
        }
    } catch (e: any) {
        return {
            valid: false,
            summary: `Gagal membaca atau mendekompresi backup: ${e.message}`
        };
    }
}
