import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.activityEventLog.findMany({
    where: {
      username: '3136666926',
      createdAt: {
        gte: new Date('2026-10-08T22:00:00Z')
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`Found ${logs.length} logs for Andhara today:`);
  for (const l of logs) {
    console.log(JSON.stringify(l, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
