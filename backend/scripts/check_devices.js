const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const devices = await prisma.deviceSession.findMany({
        select: { deviceModel: true, lastSeen: true, status: true, lastKnownIp: true, appVersion: true },
        orderBy: { lastSeen: 'desc' },
        take: 30
    });
    console.log('Top 30 most recently active devices:');
    devices.forEach((d, i) => {
        const diffMin = Math.round((Date.now() - new Date(d.lastSeen).getTime()) / 60000);
        console.log(`${i+1}. ${d.deviceModel} (v${d.appVersion}) | lastSeen: ${d.lastSeen.toISOString()} (${diffMin}m ago) | IP: ${d.lastKnownIp} | status: ${d.status}`);
    });

    const now = Date.now();
    const c1 = await prisma.deviceSession.count({ where: { lastSeen: { gte: new Date(now - 3 * 60 * 1000) } } });
    const c10 = await prisma.deviceSession.count({ where: { lastSeen: { gte: new Date(now - 10 * 60 * 1000) } } });
    const c30 = await prisma.deviceSession.count({ where: { lastSeen: { gte: new Date(now - 30 * 60 * 1000) } } });
    const c60 = await prisma.deviceSession.count({ where: { lastSeen: { gte: new Date(now - 60 * 60 * 1000) } } });
    const c24h = await prisma.deviceSession.count({ where: { lastSeen: { gte: new Date(now - 24 * 60 * 60 * 1000) } } });

    console.log(`\nActive counts:\n- Last 3 min: ${c1}\n- Last 10 min: ${c10}\n- Last 30 min: ${c30}\n- Last 1 hour: ${c60}\n- Last 24 hours: ${c24h}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
