const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const devices = await prisma.registeredDevice.findMany({
    where: {
      OR: [
        { deviceModel: { contains: '22120RN86G', mode: 'insensitive' } },
        { deviceBrand: { contains: 'Xiaomi', mode: 'insensitive' } }
      ]
    }
  });
  console.log('Registered devices count:', devices.length);
  for (const d of devices) {
    const user = await prisma.user.findUnique({
      where: { id: d.userId },
      select: { id: true, name: true, username: true, role: true, className: true }
    });
    console.log(`Device: ${d.deviceId} ${d.deviceBrand} ${d.deviceModel} -> User: ${user?.name} (${user?.role}, ${user?.className})`);
  }

  // Cari di DeviceSession juga
  const sessions = await prisma.deviceSession.findMany({
    where: {
      OR: [
        { deviceModel: { contains: '22120RN86G', mode: 'insensitive' } },
        { deviceBrand: { contains: 'Xiaomi', mode: 'insensitive' } }
      ]
    }
  });
  console.log('\nDeviceSession count:', sessions.length);
  for (const s of sessions) {
    const user = await prisma.user.findUnique({
      where: { id: s.userId },
      select: { id: true, name: true, username: true, role: true, className: true }
    });
    console.log(`Session: ${s.deviceId} ${s.deviceModel} -> User: ${user?.name} (${user?.role}, ${user?.className})`);
  }

  // Cari semua UserFcmToken
  const tokens = await prisma.userFcmToken.findMany({
    take: 30,
    orderBy: { updatedAt: 'desc' }
  });
  console.log('\nUserFcmTokens count:', tokens.length);
  for (const t of tokens) {
    const user = await prisma.user.findUnique({
      where: { id: t.userId },
      select: { id: true, name: true, username: true, role: true, className: true }
    });
    console.log(`FCM: token=${t.token.substring(0, 15)}... deviceId=${t.deviceAndroidId} -> User: ${user?.name} (${user?.role}, ${user?.className})`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
