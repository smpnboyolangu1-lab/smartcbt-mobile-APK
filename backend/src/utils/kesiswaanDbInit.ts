import prisma from './db';

/**
 * Initialize SQLite tables for Kesiswaan: Arsip Google Drive Terbatas & Audit Dokumen Akses
 */
export async function initKesiswaanDriveTables() {
  try {
    // 1. Table: arsip_drive_log
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS arsip_drive_log (
        id TEXT PRIMARY KEY,
        tahun_ajaran TEXT NOT NULL,
        angkatan TEXT NOT NULL,
        drive_file_id TEXT,
        nama_berkas TEXT NOT NULL,
        jumlah_siswa INTEGER NOT NULL,
        jumlah_berkas INTEGER NOT NULL,
        ukuran_byte INTEGER,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'MENUNGGU',
        diunggah_oleh TEXT NOT NULL DEFAULT 'SISTEM',
        diunggah_pada DATETIME,
        catatan TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Table: audit_dokumen_akses
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS audit_dokumen_akses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_role TEXT NOT NULL,
        student_id TEXT NOT NULL,
        student_name TEXT,
        dokumen_jenis TEXT NOT NULL,
        aksi TEXT NOT NULL,
        alasan TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Indices
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_arsip_drive_thn_ang ON arsip_drive_log (tahun_ajaran, angkatan);
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_audit_dokumen_student ON audit_dokumen_akses (student_id, dokumen_jenis);
    `);

    console.log('[KesiswaanDbInit] Arsip Drive & Audit Dokumen tables initialized successfully.');
  } catch (err: any) {
    console.error('[KesiswaanDbInit] Error initializing tables:', err.message);
  }
}
