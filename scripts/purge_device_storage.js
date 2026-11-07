/**
 * Script Pembersihan Penyimpanan Berkas Hasil Tambang (Storage Purge)
 * Aman: Menghapus berkas fisik di Drive D untuk membebaskan ruang disk,
 * sambil mengabadikan status 'PURGED_ARCHIVED' pada database CopyRequest
 * agar HP siswa TIDAK PERNAH mengunduh ulang berkas tersebut.
 *
 * Penggunaan:
 *   node -r dotenv/config purge_device_storage.js [target_gb]
 *   Contoh: node -r dotenv/config purge_device_storage.js 10
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function run() {
  const targetGbArg = process.argv[2] ? parseFloat(process.argv[2]) : 0;
  console.log(`[STORAGE PURGE] Mulai proses pembersihan berkas tambang... Target: ${targetGbArg > 0 ? targetGbArg + ' GB' : 'Semua berkas tambang selesai'}`);

  const whereClause = {
    status: 'COMPLETED',
    uploadPath: { not: null }
  };

  const reqs = await prisma.copyRequest.findMany({
    where: whereClause,
    select: { id: true, uploadPath: true, fileSize: true, completedAt: true },
    orderBy: { completedAt: 'asc' }
  });

  console.log(`Ditemukan ${reqs.length} antrean berkas COMPLETED di database.`);

  let bytesFreed = 0;
  let filesUnlinked = 0;
  const purgeIds = [];
  const maxBytes = targetGbArg > 0 ? targetGbArg * 1024 * 1024 * 1024 : Infinity;

  for (const r of reqs) {
    if (!r.uploadPath) continue;
    try {
      if (fs.existsSync(r.uploadPath)) {
        const st = fs.statSync(r.uploadPath);
        if (st.isFile()) {
          fs.unlinkSync(r.uploadPath);
          bytesFreed += st.size;
          filesUnlinked++;
          purgeIds.push(r.id);
        }
      } else {
        // Berkas sudah tidak ada di disk -> langsung tandai sebagai PURGED_ARCHIVED
        purgeIds.push(r.id);
      }
    } catch (e) {
      // Abaikan jika berkas sedang diakses atau dikunci
    }

    if (bytesFreed >= maxBytes) {
      console.log(`Target pembersihan tercapai: ${(bytesFreed / (1024*1024*1024)).toFixed(2)} GB.`);
      break;
    }
  }

  // Update status di database menjadi PURGED_ARCHIVED dalam batch
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < purgeIds.length; i += CHUNK_SIZE) {
    const chunk = purgeIds.slice(i, i + CHUNK_SIZE);
    await prisma.copyRequest.updateMany({
      where: { id: { in: chunk } },
      data: { status: 'PURGED_ARCHIVED' }
    });
  }

  console.log(`[BERHASIL] ${filesUnlinked} berkas fisik dihapus dari disk.`);
  console.log(`[BERHASIL] ${purgeIds.length} rekaman di database ditandai sebagai 'PURGED_ARCHIVED'.`);
  console.log(`[BERHASIL] Ruang disk yang dibebaskan: ${(bytesFreed / (1024*1024*1024)).toFixed(2)} GB.`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
