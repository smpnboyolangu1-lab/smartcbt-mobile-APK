const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setup() {
    console.log('--- SETUP DATABASE MODUL KURIKULUM SIBOY ---');

    // 1. Cek & Tambah kolom roles_tambahan ke User jika belum ada
    try {
        const userCols = await prisma.$queryRawUnsafe(`PRAGMA table_info(User)`);
        const hasRolesTambahan = userCols.some(c => c.name === 'roles_tambahan');
        if (!hasRolesTambahan) {
            console.log('Menambahkan kolom roles_tambahan ke tabel User...');
            await prisma.$executeRawUnsafe(`ALTER TABLE User ADD COLUMN roles_tambahan TEXT DEFAULT NULL`);
            console.log('✓ Kolom roles_tambahan berhasil ditambahkan.');
        } else {
            console.log('✓ Kolom roles_tambahan sudah tersedia di tabel User.');
        }
    } catch (e) {
        console.error('Error alter User table:', e.message);
    }

    // 2. Buat tabel izin_guru
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS izin_guru (
                id VARCHAR(36) PRIMARY KEY,
                guru_id VARCHAR(36) NOT NULL,
                guru_nama VARCHAR(150),
                jenis VARCHAR(30) NOT NULL, -- SAKIT, IZIN, DINAS_LUAR, CUTI
                tanggal_mulai DATE NOT NULL,
                tanggal_selesai DATE NOT NULL,
                alasan TEXT,
                lampiran_url VARCHAR(255),
                status VARCHAR(30) DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, ACTIVE, EXPIRED
                approved_by VARCHAR(100),
                approved_at DATETIME,
                catatan_kurikulum TEXT,
                jadwal_terdampak TEXT, -- JSON array of affected schedules
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_izin_guru_status ON izin_guru(status)`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_izin_guru_guru ON izin_guru(guru_id)`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_izin_guru_tanggal ON izin_guru(tanggal_mulai, tanggal_selesai)`);
        console.log('✓ Tabel izin_guru siap.');
    } catch (e) {
        console.error('Error create izin_guru:', e.message);
    }

    // 3. Buat tabel absensi_guru
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS absensi_guru (
                id VARCHAR(36) PRIMARY KEY,
                guru_id VARCHAR(36) NOT NULL,
                jadwal_id VARCHAR(36),
                kelas_id VARCHAR(36),
                mapel_id VARCHAR(100),
                status VARCHAR(30) DEFAULT 'HADIR', -- HADIR, IZIN, SAKIT, ALFA, TERLAMBAT
                waktu_masuk DATETIME,
                waktu_selesai DATETIME,
                metode VARCHAR(30) DEFAULT 'APK', -- APK, MANUAL, SISTEM
                catatan TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_absensi_guru_guru ON absensi_guru(guru_id)`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_absensi_guru_jadwal ON absensi_guru(jadwal_id)`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_absensi_guru_kelas ON absensi_guru(kelas_id)`);
        console.log('✓ Tabel absensi_guru siap.');
    } catch (e) {
        console.error('Error create absensi_guru:', e.message);
    }

    // 4. Buat tabel kelas_kosong_log
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS kelas_kosong_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                jadwal_id VARCHAR(36),
                kelas_id VARCHAR(36),
                kelas_nama VARCHAR(50),
                guru_id VARCHAR(36),
                guru_nama VARCHAR(150),
                mapel_id VARCHAR(100),
                tanggal DATE,
                jam_mulai TIME,
                jam_selesai TIME,
                menit_kosong INTEGER DEFAULT 0,
                status VARCHAR(30) DEFAULT 'KOSONG', -- KOSONG, TERLAMBAT, TERISI
                resolved_by VARCHAR(100),
                resolved_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_kelas_kosong_tanggal ON kelas_kosong_log(tanggal)`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_kelas_kosong_status ON kelas_kosong_log(status)`);
        console.log('✓ Tabel kelas_kosong_log siap.');
    } catch (e) {
        console.error('Error create kelas_kosong_log:', e.message);
    }

    // 5. Buat tabel kurikulum_config
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS kurikulum_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_name VARCHAR(50) UNIQUE,
                value VARCHAR(255),
                deskripsi TEXT
            )
        `);
        // Seed konfigurasi default
        const configs = [
            { key: 'notif_kelas_kosong_menit', val: '5', desc: 'Notif jika kelas kosong > X menit' },
            { key: 'auto_assign_piket', val: 'true', desc: 'Auto assign guru piket saat ada kelas kosong' },
            { key: 'sla_approval_izin_jam', val: '2', desc: 'Target approval izin guru oleh kurikulum' },
            { key: 'kategori_warna_baik', val: '80', desc: 'Batas persentase presensi baik (hijau)' },
            { key: 'kategori_warna_perhatian', val: '60', desc: 'Batas persentase presensi perhatian (kuning)' }
        ];

        for (const c of configs) {
            await prisma.$executeRawUnsafe(`
                INSERT OR IGNORE INTO kurikulum_config (key_name, value, deskripsi)
                VALUES (?, ?, ?)
            `, c.key, c.val, c.desc);
        }
        console.log('✓ Tabel kurikulum_config siap.');
    } catch (e) {
        console.error('Error create kurikulum_config:', e.message);
    }

    await prisma.$disconnect();
    console.log('🎉 Setup Database Kurikulum Selesai!');
}

setup().catch(err => {
    console.error(err);
    process.exit(1);
});
