const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const anomalies = await prisma.attendanceAnomalyLog.findMany({
    where: {
      OR: [
        { userName: { contains: 'YOLA' } },
        { userName: { contains: 'DINIYAR' } },
        { detail: { contains: '135807607' } }
      ]
    },
    orderBy: { waktu: 'desc' },
    take: 20
  });
  console.log('Anomalies for Yola:');
  console.log(JSON.stringify(anomalies, null, 2));

  console.log('\n--- Today Anomalies for all users (waktu >= 2026-10-07T17:00:00Z) ---');
  const todayAnomalies = await prisma.attendanceAnomalyLog.findMany({
    where: {
      waktu: { gte: new Date('2026-10-07T17:00:00.000Z') }
    },
    orderBy: { waktu: 'desc' },
    take: 20
  });
  console.log(JSON.stringify(todayAnomalies, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
