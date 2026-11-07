const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function run() {
  const deviceId = '598f2e17-2727-4676-be4b-fbf600b9824d';
  console.log(`[TARGET PURGE] Membersihkan semua sisa file COMPLETED untuk target device: ${deviceId}`);

  const completed = await prisma.copyRequest.findMany({
    where: {
      deviceId,
      status: 'COMPLETED'
    },
    select: { id: true, uploadPath: true, fileName: true, fileSize: true }
  });

  console.log(`Ditemukan ${completed.length} file COMPLETED.`);
  let unlinked = 0;
  let bytesFreed = 0;

  for (const c of completed) {
    if (c.uploadPath) {
      const p = String(c.uploadPath);
      try {
        if (fs.existsSync(p)) {
          const st = fs.statSync(p);
          if (st.isFile()) {
            fs.unlinkSync(p);
            bytesFreed += st.size;
            unlinked++;
          }
        }
      } catch (err) {
        console.warn(`Gagal unlink ${p}:`, err.message);
      }
    }
  }

  const ids = completed.map(c => c.id);
  if (ids.length > 0) {
    await prisma.copyRequest.updateMany({
      where: { id: { in: ids } },
      data: { status: 'PURGED_ARCHIVED' }
    });
  }

  console.log(`[TARGET PURGE] Selesai: ${unlinked} file fisik dihapus, ${(bytesFreed / (1024*1024)).toFixed(2)} MB dibebaskan.`);
  console.log(`[TARGET PURGE] ${ids.length} records di-update ke 'PURGED_ARCHIVED'.`);

  // Verify counts now
  const remainingCompleted = await prisma.copyRequest.count({
    where: { deviceId, status: 'COMPLETED' }
  });
  const totalPurged = await prisma.copyRequest.count({
    where: { deviceId, status: 'PURGED_ARCHIVED' }
  });
  console.log(`Status terkini untuk device ${deviceId}: COMPLETED = ${remainingCompleted}, PURGED_ARCHIVED = ${totalPurged}`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
