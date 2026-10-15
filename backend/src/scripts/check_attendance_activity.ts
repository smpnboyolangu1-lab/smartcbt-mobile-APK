import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.activityEventLog.findMany({
    where: {
      module: 'ATTENDANCE',
      createdAt: {
        gte: new Date('2026-10-08T22:00:00Z') // 05:00 WIB
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  console.log(`Found ${logs.length} ATTENDANCE activity event logs today:`);
  for (const l of logs) {
    console.log(`[${l.createdAt.toISOString()}] [${l.action}] [${l.outcome} - ${l.httpStatus}] User: ${l.name} (${l.username}, ${l.className}) - Msg: ${l.message}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
