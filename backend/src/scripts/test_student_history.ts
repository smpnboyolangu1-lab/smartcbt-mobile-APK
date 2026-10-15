import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const targetUserId = "3fb1ff46-2758-48c1-bb49-3709c627da1a"; // ANDHARA KIRANA MAHESTRI
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  console.log("User:", user?.name, user?.username, user?.className);

  const reqMonth = new Date().getMonth() + 1; // 10
  const reqYear = new Date().getFullYear(); // 2026

  const startDate = new Date(reqYear, reqMonth - 1, 1, 0, 0, 0, 0);
  const lastDay = new Date(reqYear, reqMonth, 0).getDate();
  const endDate = new Date(reqYear, reqMonth - 1, lastDay, 23, 59, 59, 999);

  const attendances = await prisma.attendance.findMany({
    where: {
      userId: targetUserId,
      OR: [
        { scanTime: { gte: startDate, lte: endDate } },
        { scanTime: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }
      ]
    },
    orderBy: { scanTime: 'desc' },
    take: 1000
  });

  console.log("Raw attendances count:", attendances.length);

  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const toWibDateStr = (date: Date | string): string => {
    try {
      const d = new Date(date);
      return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    } catch {
      const d = new Date(date);
      return d.toISOString().split('T')[0];
    }
  };

  const groupedMap = new Map<string, any[]>();
  attendances.forEach(att => {
    const dateStr = toWibDateStr(att.scanTime);
    if (!groupedMap.has(dateStr)) {
      groupedMap.set(dateStr, []);
    }
    groupedMap.get(dateStr)!.push(att);
  });

  console.log("Grouped dates:", Array.from(groupedMap.keys()));

  const allHistory: any[] = [];
  for (const [dateStr, records] of groupedMap.entries()) {
    const dateObj = new Date(dateStr + 'T12:00:00Z');
    const dayIndex = dateObj.getDay();
    const dayName = dayNames[dayIndex] || 'Senin';
    const isSunday = (dayIndex === 0);

    const inRecord = records.find(r => r.type === 'GATE_IN' || r.type === 'IN');
    const outRecord = records.find(r => r.type === 'GATE_OUT' || r.type === 'OUT');

    const formatTime = (d: Date | string | null | undefined) => {
      if (!d) return '-';
      try {
        const dt = new Date(d);
        // Note dt.getHours() in UTC vs local!
        const wibTime = dt.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
        return `${wibTime} WIB`;
      } catch {
        return '-';
      }
    };

    allHistory.push({
      date: dateStr,
      dayName,
      inRecord: inRecord ? { id: inRecord.id, scanTime: inRecord.scanTime, method: inRecord.method, status: inRecord.status } : null,
      outRecord: outRecord ? { id: outRecord.id, scanTime: outRecord.scanTime, method: outRecord.method, status: outRecord.status } : null,
    });
  }

  console.log("History items:", JSON.stringify(allHistory, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
