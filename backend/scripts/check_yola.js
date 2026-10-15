const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Searching for user...');
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: 'YOLA' } },
        { name: { contains: 'DINIYAR' } }
      ]
    },
    include: {
      class: true
    }
  });
  console.log('Users found:', users.length);
  for (const u of users) {
    console.log(`\nUser: ${u.name} (ID: ${u.id}, Username/NISN: ${u.username}, Class: ${u.className})`);
    console.log(`Device ID: ${u.deviceBindingId}, RFID: ${u.rfidChipUid}`);

    // Check attendances
    const attendances = await prisma.attendance.findMany({
      where: { userId: u.id },
      orderBy: { scanTime: 'desc' },
      take: 20
    });
    console.log(`Attendance count: ${attendances.length}`);
    for (const a of attendances) {
      console.log(`- [${a.scanTime.toISOString()}] Type: ${a.type}, Method: ${a.method}, Status: ${a.status}, Accuracy: ${a.accuracyMeters}, Dist: ${a.jarakKeSekolah}, Note: ${a.note}`);
    }
  }

  // Also check gate settings
  const gateSettings = await prisma.gateSetting.findMany();
  console.log('\nGate Settings:', JSON.stringify(gateSettings, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
