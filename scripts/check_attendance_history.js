const { PrismaClient } = require('../backend/node_modules/@prisma/client');
require('../backend/node_modules/dotenv').config({ path: 'backend/.env' });
const prisma = new PrismaClient();

async function checkHistory() {
    const fourteenDaysAgo = new Date('2026-10-10T00:00:00.000Z');
    const logs = await prisma.attendance.findMany({
        where: { scanTime: { gte: fourteenDaysAgo } },
        select: { scanTime: true, userId: true, type: true }
    });

    const dayMap = {};
    for (const l of logs) {
        const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(l.scanTime);
        if (!dayMap[d]) dayMap[d] = { totalScans: 0, users: new Set() };
        dayMap[d].totalScans++;
        dayMap[d].users.add(l.userId);
    }

    console.log('--- RIWAYAT PRESENSI 14 HARI TERAKHIR ---');
    for (const d of Object.keys(dayMap).sort()) {
        const dateObj = new Date(d + 'T00:00:00+07:00');
        const dayName = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }).format(dateObj);
        console.log(`- ${d} (${dayName}): ${dayMap[d].users.size} siswa hadir (${dayMap[d].totalScans} scan)`);
    }

    // Check attendance anomalies today
    const startWib = new Date('2026-10-24T00:00:00.000+07:00');
    const endWib = new Date('2026-10-24T23:59:59.999+07:00');
    const anomalies = await prisma.attendanceAnomalyLog.findMany({
        where: { waktu: { gte: startWib, lte: endWib } }
    });
    console.log('\n--- LOG ANOMALI PRESENSI HARI INI ---');
    console.log('Jumlah Anomali:', anomalies.length);
    for (const a of anomalies) {
        console.log(`- [${a.jenisAnomali}] ${a.userName}: ${a.detail}`);
    }

    // Check rejection / failure events in ActivityEventLog
    const actLogs = await prisma.activityEventLog.findMany({
        where: {
            createdAt: { gte: startWib, lte: endWib }
        },
        orderBy: { createdAt: 'desc' },
        take: 30
    }).catch(() => []);
    console.log('\n--- ACTIVITY EVENT LOG HARI INI ---');
    console.log('Jumlah Log Event:', actLogs.length);
    for (const al of actLogs) {
        console.log(`- [${al.eventType}] User: ${al.userName} (${al.role}): ${al.details}`);
    }

    await prisma['$disconnect']();
}

checkHistory().catch(e => {
    console.error(e);
    process.exit(1);
});
