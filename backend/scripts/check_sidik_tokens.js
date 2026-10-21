const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sidikId = '2d74fee2-96b9-4afd-9c5d-bee896e55188';

  // 1. Cek tokens milik Sidik
  const sidikTokens = await prisma.userFcmToken.findMany({
    where: { userId: sidikId }
  });
  console.log('FCM Tokens for Sidik:', sidikTokens);

  // Jika ada deviceAndroidId, cari user lain dengan deviceAndroidId yang sama
  if (sidikTokens.length > 0) {
    for (const t of sidikTokens) {
      if (t.deviceAndroidId) {
        const otherTokens = await prisma.userFcmToken.findMany({
          where: { deviceAndroidId: t.deviceAndroidId }
        });
        console.log(`Other tokens with deviceAndroidId ${t.deviceAndroidId}:`, otherTokens);

        const otherUsers = await prisma.user.findMany({
          where: { id: { in: otherTokens.map(ot => ot.userId) } },
          select: { id: true, name: true, username: true, role: true, className: true }
        });
        console.log('Users on same device:', otherUsers);
      }
    }
  }

  // 2. Cek apakah ada notifikasi sholat di NotificationMessage
  const prayerNotifs = await prisma.notificationMessage.findMany({
    where: {
      OR: [
        { title: { contains: 'Sholat', mode: 'insensitive' } },
        { message: { contains: 'Sholat', mode: 'insensitive' } },
        { title: { contains: 'Dzuhur', mode: 'insensitive' } },
        { message: { contains: 'Dzuhur', mode: 'insensitive' } }
      ]
    },
    orderBy: { sentAt: 'desc' },
    take: 10
  });
  console.log('\nTop 10 Prayer NotificationMessages:');
  prayerNotifs.forEach(n => {
    console.log(`[${n.sentAt.toISOString()}] id:${n.id} recipientId:${n.recipientId} role:${n.recipientRole} student:${n.studentName} (${n.className}) - ${n.title}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
