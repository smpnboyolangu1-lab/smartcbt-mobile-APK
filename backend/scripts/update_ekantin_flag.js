const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  await prisma.systemSetting.upsert({
    where: { key: 'feature.ekantin.enabled' },
    update: { value: 'false' },
    create: { key: 'feature.ekantin.enabled', value: 'false' }
  });
  await prisma.systemSetting.upsert({
    where: { key: 'feature.attendance.offlineQueue' },
    update: { value: 'false' },
    create: { key: 'feature.attendance.offlineQueue', value: 'false' }
  });
  console.log('✅ Feature flags successfully set: ekantin=false, offlineQueue=false');
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
