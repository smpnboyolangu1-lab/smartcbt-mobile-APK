const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  for (const day of ['2026-10-06','2026-10-07','2026-10-08']) {
    const s = new Date(day + 'T00:00:00+07:00'), e = new Date(day + 'T23:59:59+07:00');
    const rows = await prisma.attendance.groupBy({ by: ['type','method'], where: { scanTime: { gte: s, lte: e } }, _count: true });
    console.log(day, JSON.stringify(rows));
  }
  const s = new Date('2026-10-08T10:00:00+07:00');
  const outs = await prisma.attendance.findMany({ where: { type: { in: ['GATE_OUT','MUSHOLA_OUT'] }, scanTime: { gte: s } }, orderBy: { scanTime: 'asc' }, take: 5, select: { scanTime: true, note: true } });
  console.log('first outs today', JSON.stringify(outs, null, 1));
}
main().finally(() => prisma.$disconnect());
