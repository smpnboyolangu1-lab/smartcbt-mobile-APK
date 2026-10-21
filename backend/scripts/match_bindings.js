const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const devSessions = await prisma.deviceSession.findMany({
        where: { user: { username: 'unassigned_device' } },
        select: { id: true, deviceAndroidId: true, deviceName: true, appVersion: true, lastSeen: true }
    });
    const androidIds = devSessions.map(d => d.deviceAndroidId);
    const matchedUsers = await prisma.user.findMany({
        where: { deviceBindingId: { in: androidIds } },
        select: { id: true, name: true, className: true, deviceBindingId: true, role: true }
    });
    console.log('Unassigned dev sessions:', devSessions.length);
    console.log('Users having these deviceBindingId:', matchedUsers.length);
    if (matchedUsers.length > 0) {
        console.log('Sample matched:', matchedUsers.slice(0, 10));
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
