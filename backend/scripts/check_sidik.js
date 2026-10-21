const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sidik = await prisma.user.findFirst({
    where: {
      OR: [
        { name: { contains: 'Sidik', mode: 'insensitive' } },
        { username: { contains: 'sidik', mode: 'insensitive' } }
      ]
    }
  });
  console.log('Sidik user details:', sidik);

  if (sidik) {
    const notifs = await prisma.notificationMessage.findMany({
      where: {
        OR: [
          { recipientId: sidik.id },
          { recipientRole: 'TEACHER' }
        ]
      },
      orderBy: { sentAt: 'desc' },
      take: 20
    });
    console.log(`\nNotifications found (${notifs.length}):`);
    notifs.forEach(n => {
      console.log(`[${n.sentAt.toISOString()}] to:${n.recipientId || n.recipientRole} [${n.category}] ${n.title} - ${n.message}`);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
