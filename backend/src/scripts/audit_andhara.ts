import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("=== AUDIT ANDHARA KIRANA MAHESWARI ===");
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: 'Andhara' } },
        { name: { contains: 'Kirana' } },
        { name: { contains: 'Maheswari' } },
        { username: { contains: 'andhara' } }
      ]
    },
    include: {
      class: true
    }
  });

  console.log("Found Users:", users.length);
  for (const u of users) {
    console.log(`- User ID: ${u.id}, Username: ${u.username}, Name: ${u.name}, Role: ${u.role}, Class: ${u.className} / ${u.class?.name}, NISN: ${u.nisn}, NIS: ${u.nis}, RFID: ${u.rfidChipUid}, DeviceBinding: ${u.deviceBindingId}`);
  }

  const userIds = users.map(u => u.id);
  const usernames = users.map(u => u.username);

  // Check Attendances for these users
  console.log("\n=== RECENT ATTENDANCE RECORDS FOR USER ===");
  const attendances = await prisma.attendance.findMany({
    where: {
      userId: { in: userIds }
    },
    orderBy: { scanTime: 'desc' },
    take: 20
  });
  console.log(`Found ${attendances.length} attendance records:`);
  for (const att of attendances) {
    console.log(`- ID: ${att.id} | ScanTime: ${att.scanTime.toISOString()} | Type: ${att.type} | Method: ${att.method} | Status: ${att.status} | Note: ${att.note} | Zone: ${att.geofenceZoneName} | FakeGPS: ${att.isFakeGps}`);
  }

  // Check StudentSubjectAttendance
  console.log("\n=== STUDENT SUBJECT ATTENDANCES (MAPEL/KELAS) ===");
  try {
    const subjAtt = await (prisma as any).studentSubjectAttendance.findMany({
      where: {
        siswaId: { in: userIds }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log(`Found ${subjAtt.length} subject attendances:`);
    for (const sa of subjAtt) {
      console.log(`- [${sa.createdAt.toISOString()}] Jadwal: ${sa.jadwalId} | Status: ${sa.status} | Note: ${sa.catatan}`);
    }
  } catch (e: any) {
    console.log("StudentSubjectAttendance error:", e.message);
  }

  // Check StudentGeofenceAttendance
  console.log("\n=== STUDENT GEOFENCE ATTENDANCES ===");
  try {
    const geoAtt = await prisma.studentGeofenceAttendance.findMany({
      where: {
        siswaId: { in: userIds }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log(`Found ${geoAtt.length} geofence attendances:`);
    for (const ga of geoAtt) {
      console.log(`- [${ga.createdAt.toISOString()}] Jadwal: ${ga.jadwalId} | Status: ${ga.status} | Method: ${ga.deviceId}`);
    }
  } catch (e: any) {
    console.log("StudentGeofenceAttendance error:", e.message);
  }

  // Check ActivityEventLog
  console.log("\n=== ACTIVITY EVENT LOGS ===");
  try {
    const logs = await prisma.activityEventLog.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { username: { in: usernames } },
          { name: { contains: 'Andhara' } },
          { message: { contains: 'Andhara' } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 25
    });
    console.log(`Found ${logs.length} activityEventLog records:`);
    for (const l of logs) {
      console.log(`- [${l.createdAt.toISOString()}] [${l.module}] [${l.action}] [${l.outcome} - ${l.httpStatus}] User: ${l.name} (${l.username}) - Msg: ${l.message} | Payload: ${JSON.stringify(l.payload)}`);
    }
  } catch (e: any) {
    console.log("ActivityEventLog error:", e.message);
  }

  // Check AttendanceAnomalyLog
  console.log("\n=== ATTENDANCE ANOMALY LOGS ===");
  try {
    const anomalies = await prisma.attendanceAnomalyLog.findMany({
      where: {
        userId: { in: userIds }
      },
      orderBy: { waktu: 'desc' },
      take: 10
    });
    console.log(`Found ${anomalies.length} anomaly records:`);
    for (const a of anomalies) {
      console.log(JSON.stringify(a, null, 2));
    }
  } catch (e: any) {
    console.log("AttendanceAnomalyLog error:", e.message);
  }

  // Check today's all attendances around 05:00 - 08:00 WIB
  console.log("\n=== ALL ATTENDANCES TODAY (2026-10-09) ===");
  const todayAtt = await prisma.attendance.findMany({
    where: {
      scanTime: {
        gte: new Date('2026-10-08T21:00:00Z') // 04:00 WIB Oct 9
      }
    },
    orderBy: { scanTime: 'desc' },
    take: 30,
    include: {
      user: { select: { name: true, username: true, className: true } }
    }
  });
  console.log(`Today's attendances count: ${todayAtt.length}`);
  for (const ta of todayAtt) {
    console.log(`- ${ta.scanTime.toISOString()} | User: ${ta.user?.name} (${ta.user?.className}) | Type: ${ta.type} | Status: ${ta.status} | Method: ${ta.method} | Note: ${ta.note}`);
  }

  // Check today's recent activity logs
  console.log("\n=== RECENT 10 ACTIVITY LOGS TODAY ===");
  try {
    const recentLogs = await prisma.activityEventLog.findMany({
      where: {
        createdAt: {
          gte: new Date('2026-10-08T21:00:00Z')
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    for (const rl of recentLogs) {
      console.log(`- [${rl.createdAt.toISOString()}] [${rl.module}] [${rl.action}] [${rl.outcome}] ${rl.name} (${rl.username}) - ${rl.message}`);
    }
  } catch (e: any) {
    console.log("Error recent activity logs:", e.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
