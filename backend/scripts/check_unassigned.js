const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const unassigned = await prisma.user.findUnique({
        where: { username: 'unassigned_device' },
        include: { devices: { select: { id: true, deviceName: true, deviceModel: true, lastSeen: true, appVersion: true } } }
    });
    console.log('Devices bound to unassigned_device:', unassigned ? unassigned.devices.length : 0);
    if (unassigned && unassigned.devices) {
        console.log('Sample unassigned devices:', unassigned.devices.slice(0, 10));
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
