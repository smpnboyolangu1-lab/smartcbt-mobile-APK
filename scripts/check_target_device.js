const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const s = await prisma.systemSetting.findFirst({
    where: { key: 'feature.device_file_scanner.locked_device_ids' }
  });
  console.log('locked_device_ids setting:', s ? s.value : 'NULL');

  const files = await prisma.deviceFile.count({
    where: { deviceId: '598f2e17-2727-4676-be4b-fbf600b9824d' }
  });
  console.log('Total deviceFile count for Aiko device:', files);

  const copyReqs = await prisma.copyRequest.groupBy({
    by: ['status'],
    where: { deviceId: '598f2e17-2727-4676-be4b-fbf600b9824d' },
    _count: true
  });
  console.log('CopyRequests by status for Aiko device:', copyReqs);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
