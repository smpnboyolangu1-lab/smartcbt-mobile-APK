const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const yola = await prisma.user.findFirst({
    where: { name: { contains: 'YOLA' } }
  });
  console.log('User Yola:', yola?.name, yola?.id, yola?.username, yola?.className);

  // Check all attendances for Yola
  const atts = await prisma.attendance.findMany({
    where: { userId: yola.id },
    orderBy: { scanTime: 'desc' },
    take: 10
  });
  console.log('\n--- Recent Attendances ---');
  console.log(JSON.stringify(atts, null, 2));

  // Check AttendanceAnomalyLog if exists
  try {
    const anomalies = await prisma.attendanceAnomalyLog.findMany({
      where: { userId: yola.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log('\n--- Anomalies for Yola ---');
    console.log(JSON.stringify(anomalies, null, 2));
  } catch (e) {
    console.log('attendanceAnomalyLog error / not found:', e.message);
  }

  // Check recent anomalies for anyone today
  try {
    const allAnomalies = await prisma.attendanceAnomalyLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log('\n--- Recent Anomalies (Any User) ---');
    console.log(JSON.stringify(allAnomalies, null, 2));
  } catch (e) {
    console.log('allAnomalies error:', e.message);
  }

  // Check AuditLog
  try {
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { userId: yola.id },
          { userName: { contains: 'YOLA' } },
          { details: { contains: 'YOLA' } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log('\n--- Audit Logs for Yola ---');
    console.log(JSON.stringify(auditLogs, null, 2));
  } catch (e) {
    console.log('auditLog error:', e.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
