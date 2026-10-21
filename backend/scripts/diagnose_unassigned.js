require('dotenv').config({ path: 'C:/APK/backend/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const unassignedDevs = await prisma.deviceSession.findMany({
        where: { user: { username: 'unassigned_device' } }
    });
    console.log('Total unassigned sessions:', unassignedDevs.length);

    // Cek apakah ada di User (by deviceBindingId)
    const androidIds = unassignedDevs.map(d => d.deviceAndroidId);
    const users = await prisma.user.findMany({
        where: { deviceBindingId: { in: androidIds } }
    });
    console.log('Users having deviceBindingId:', users.length);

    // Cek apakah IP perangkat-perangkat ini cocok dengan IP siswa saat login
    for (const dev of unassignedDevs.slice(0, 5)) {
        console.log(`Device: ${dev.deviceName} | androidId: ${dev.deviceAndroidId} | lastKnownIp: ${dev.lastKnownIp} | lastSeen: ${dev.lastSeen}`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
