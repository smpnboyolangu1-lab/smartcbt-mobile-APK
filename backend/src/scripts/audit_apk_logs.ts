import prisma from '../utils/db';

async function main() {
  console.log('=== APP CLIENT ERROR LOGS (RECENT 15) ===');
  const errLogs = await prisma.appClientErrorLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15
  });
  console.log(`Total client error logs: ${errLogs.length}`);
  for (const el of errLogs) {
    console.log(`- [${el.createdAt.toISOString()}] User: ${el.username} | AppVer: ${el.appVersion} | Type: ${el.level} | Msg: ${el.errorMessage} | Trace: ${el.stackTrace?.slice(0, 150)}`);
  }

  console.log('\n=== ACTIVITY EVENT LOGS (RECENT 20) ===');
  const actLogs = await prisma.activityEventLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log(`Total activity event logs: ${actLogs.length}`);
  for (const al of actLogs) {
    console.log(`- [${al.createdAt.toISOString()}] Source: ${al.source} | Mod: ${al.module} | Act: ${al.action} | Status: ${al.outcome} (${al.httpStatus}) | User: ${al.username} (${al.name}) | Msg: ${al.message}`);
  }

  console.log('\n=== ATTENDANCE ANOMALIES (RECENT 10) ===');
  try {
    const anomLogs = await prisma.attendanceAnomalyLog.findMany({
      orderBy: { waktu: 'desc' },
      take: 10
    });
    console.log(`Total anomaly logs: ${anomLogs.length}`);
    for (const an of anomLogs) {
      console.log(`- [${an.waktu.toISOString()}] User: ${an.userName} | Jenis: ${an.jenisAnomali} | Detail: ${an.detail}`);
    }
  } catch (e: any) {
    console.log('Anomaly query note:', e.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
