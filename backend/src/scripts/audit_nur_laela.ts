import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("=== AUDIT NUR LAELA YUMDA ===");
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: 'LAELA' } },
        { name: { contains: 'YUMDA' } },
        { name: { contains: 'NUR' } },
        { username: { contains: 'yumda' } }
      ]
    },
    include: {
      class: true
    }
  });

  const matched = users.filter(u => 
    u.name.toUpperCase().includes('YUMDA') || 
    (u.name.toUpperCase().includes('NUR') && u.name.toUpperCase().includes('LAELA'))
  );

  console.log(`Matched Users (${matched.length}):`);
  for (const u of matched) {
    console.log(`- ID: ${u.id} | Name: ${u.name} | Role: ${u.role} | Class: ${u.className} | NISN: ${u.nisn} | Username: ${u.username}`);
  }

  const targetUser = matched[0];
  if (!targetUser) {
    console.log("No user matched NUR LAELA YUMDA");
    return;
  }

  // 1. Check Attendances
  console.log("\n=== ALL ATTENDANCES FOR NUR LAELA YUMDA ===");
  const attendances = await prisma.attendance.findMany({
    where: { userId: targetUser.id },
    orderBy: { scanTime: 'desc' },
    take: 15
  });

  for (const a of attendances) {
    console.log(`- [${a.scanTime.toISOString()}] ID: ${a.id} | Type: ${a.type} | Method: ${a.method} | Status: ${a.status} | Note: ${a.note} | Zone: ${a.geofenceZoneName} | Lat/Lng: ${a.lat}, ${a.lng}`);
  }

  // 2. Check ActivityEventLogs for Nur Laela
  console.log("\n=== ACTIVITY EVENT LOGS FOR NUR LAELA YUMDA ===");
  const logs = await prisma.activityEventLog.findMany({
    where: {
      OR: [
        { username: targetUser.username },
        { username: targetUser.nisn || '___' },
        { name: { contains: 'YUMDA' } }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 15
  });

  for (const l of logs) {
    console.log(`- [${l.createdAt.toISOString()}] [${l.module}] [${l.action}] [${l.outcome} - ${l.httpStatus}] User: ${l.name} (${l.username}) - Msg: ${l.message} | Payload: ${JSON.stringify(l.payload)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
