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
  console.log(JSON.stringify(users, null, 2));

  const userIds = users.map(u => u.id);
  const usernames = users.map(u => u.username);

  console.log('\n=== LOGS FOR MATCHED STUDENTS (TODAY) ===');
  const logs = await prisma.activityEventLog.findMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { username: { in: usernames } }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log(JSON.stringify(logs, null, 2));

  console.log('\n=== ATTENDANCE ANOMALIES TODAY ===');
  const anomalies = await prisma.attendanceAnomalyLog.findMany({
    where: {
      waktu: { gte: new Date('2026-10-09T22:00:00.000Z') }
    },
    orderBy: { waktu: 'desc' },
    take: 20
  });
  console.log(JSON.stringify(anomalies, null, 2));

  console.log('\n=== ATTENDANCE REJECTIONS TODAY (ALL STUDENTS) ===');
  const rejections = await prisma.activityEventLog.findMany({
    where: {
      module: 'ATTENDANCE',
      outcome: 'REJECTED',
      createdAt: { gte: new Date('2026-10-09T22:00:00.000Z') }
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log(JSON.stringify(rejections, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
