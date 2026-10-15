import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: 'fahira' } },
        { name: { contains: 'bilqis' } },
        { name: { contains: 'bliqis' } },
        { name: { contains: 'sinta' } },
        { name: { contains: 'sahira' } },
        { name: { contains: 'shinta' } }
      ]
    },
    select: { id: true, name: true, username: true, nisn: true, className: true }
  });
  console.log('=== MATCHED STUDENTS ===');
  for (const u of users) {
    console.log(`- ${u.name} | Kelas: ${u.className} | NISN/User: ${u.username} | ID: ${u.id}`);
  }

  // Cek apakah ada scan gate masuk atau penolakan gerbang terkunci hari ini
  console.log('\n=== LOG SCAN GATE IN / OUT REJECTIONS TODAY ===');
  const gateRejections = await prisma.activityEventLog.findMany({
    where: {
      action: { in: ['SCAN_GATE_IN', 'SCAN_GATE_OUT'] },
      outcome: 'REJECTED',
      createdAt: { gte: new Date('2026-10-09T22:00:00.000Z') }
    },
    orderBy: { createdAt: 'desc' },
    take: 30
  });
  for (const r of gateRejections) {
    console.log(`[${r.createdAt.toISOString()}] [${r.action}] User: ${r.username} (${r.name}) Kelas: ${r.className}`);
    console.log(`   Message: ${r.message}`);
    console.log(`   Payload: ${r.payload}`);
  }
}

main().finally(() => prisma.$disconnect());
