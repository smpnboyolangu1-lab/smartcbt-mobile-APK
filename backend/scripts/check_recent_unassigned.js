require('dotenv').config({ path: 'C:/APK/backend/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const unassigned = await prisma.deviceSession.findMany({
        where: { user: { username: 'unassigned_device' } },
        select: { deviceAndroidId: true, deviceName: true, appVersion: true, lastSeen: true, registeredAt: true },
        orderBy: { lastSeen: 'desc' }
    });
    console.log('Total unassigned sessions:', unassigned.length);
    console.log('Most recent 15 unassigned sessions:', unassigned.slice(0, 15));

    // Cek berapa banyak siswa yang punya deviceBindingId di sistem
    const studentsWithBinding = await prisma.user.findMany({
        where: { role: 'STUDENT', deviceBindingId: { not: null } },
        select: { id: true, name: true, className: true, deviceBindingId: true, lastLogin: true },
        take: 10
    });
    console.log('Sample students with deviceBindingId:', studentsWithBinding);
}

main().catch(console.error).finally(() => prisma.$disconnect());
