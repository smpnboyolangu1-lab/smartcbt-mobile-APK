import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const className = 'VII-C';
  const cur = new Date();
  const y = cur.getFullYear();
  const m = String(cur.getMonth() + 1).padStart(2, '0');
  const d = String(cur.getDate()).padStart(2, '0');
  const targetDateStr = `${y}-${m}-${d}`;
  const startOfDay = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 23, 59, 59, 999);

  const rawStudents = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      isActive: true,
      className: { in: ['VII-C', 'VII C', 'VII - C'] }
    },
    orderBy: { name: 'asc' }
  });

  console.log(`Found ${rawStudents.length} students in ${className}`);

  const [logs] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        scanTime: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      orderBy: { scanTime: 'asc' }
    })
  ]);

  console.log(`Found ${logs.length} attendance logs total today`);

  const userLogsMap = new Map<string, any[]>();
  logs.forEach(l => {
    if (!userLogsMap.has(l.userId)) userLogsMap.set(l.userId, []);
    userLogsMap.get(l.userId)!.push(l);
  });

  const andhara = rawStudents.find(s => s.name.includes('MAHESTRI') || s.name.includes('ANDHARA'));
  if (andhara) {
    const userLogs = userLogsMap.get(andhara.id) || [];
    console.log(`Andhara (${andhara.id}): ${userLogs.length} logs found today!`);
    console.log(JSON.stringify(userLogs, null, 2));
  } else {
    console.log("Andhara not found in VII-C list!");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
