const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sidikId = '2d74fee2-96b9-4afd-9c5d-bee896e55188';

  // 1. Cek tabel Parent / Orang Tua
  const parents = await prisma.$queryRawUnsafe(`SELECT * FROM "Parent" WHERE "userId" = $1 OR "phone" = (SELECT "phone" FROM "User" WHERE id = $1) LIMIT 10`, sidikId).catch(e => e.message);
  console.log('Parent record with userId:', parents);

  // 2. Cek ParentStudentLink
  const links = await prisma.$queryRawUnsafe(`SELECT * FROM "ParentStudentLink" WHERE "orangTuaId" IN (SELECT id FROM "Parent" WHERE "userId" = $1) OR "siswaId" = $1`, sidikId).catch(e => e.message);
  console.log('ParentStudentLink:', links);

  // 3. Cek Device / FCM Token untuk Sidik
  const devices = await prisma.device.findMany({
    where: { userId: sidikId }
  });
  console.log('Devices for Sidik:', devices);

  // 4. Cari semua notifikasi yang dikirim dalam 48 jam terakhir
  const recentNotifs = await prisma.$queryRawUnsafe(`
    SELECT * FROM "NotificationMessage" 
    WHERE "title" ILIKE '%sholat%' OR "message" ILIKE '%sholat%' OR "title" ILIKE '%dzuhur%' OR "message" ILIKE '%dzuhur%'
    ORDER BY "sentAt" DESC LIMIT 15
  `).catch(e => e.message);
  console.log('Recent Prayer Notifications:', recentNotifs);

  // 5. Cek AuditLog terkait PRAYER
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      action: { contains: 'PRAYER' }
    },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Recent Prayer AuditLogs:', auditLogs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
