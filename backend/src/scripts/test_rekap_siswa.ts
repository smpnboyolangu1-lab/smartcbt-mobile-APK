import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const targetUserId = "3fb1ff46-2758-48c1-bb49-3709c627da1a"; // ANDHARA KIRANA MAHESTRI
  const targetYear = 2026;
  const targetMonth = 10;

  const student = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      username: true,
      className: true
    }
  });

  const startDate = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  const endDate = new Date(targetYear, targetMonth - 1, lastDay, 23, 59, 59, 999);

  const dayDateStrings: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const yyyy = targetYear;
    const mm = String(targetMonth).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    dayDateStrings.push(`${yyyy}-${mm}-${dd}`);
  }

  const [holidays, logs] = await Promise.all([
    prisma.schoolHoliday.findMany({
      where: { date: { in: dayDateStrings } }
    }),
    prisma.attendance.findMany({
      where: {
        userId: student!.id,
        scanTime: { gte: startDate, lte: endDate }
      },
      orderBy: { scanTime: 'asc' }
    })
  ]);

  console.log("Logs found for Andhara in October 2026:", logs.length);
  for (const l of logs) {
    console.log(`- ${l.scanTime.toISOString()} | Type: ${l.type} | Method: ${l.method} | Status: ${l.status}`);
  }

  const logsByDate = new Map<string, any[]>();
  logs.forEach(l => {
    const dKey = new Date(l.scanTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    if (!logsByDate.has(dKey)) logsByDate.set(dKey, []);
    logsByDate.get(dKey)!.push(l);
  });

  console.log("Logs by date keys:", Array.from(logsByDate.keys()));

  // Let's check today's key: 2026-10-09
  console.log("Today logs (2026-10-09):", logsByDate.get('2026-10-09'));
}

main().catch(console.error).finally(() => prisma.$disconnect());
