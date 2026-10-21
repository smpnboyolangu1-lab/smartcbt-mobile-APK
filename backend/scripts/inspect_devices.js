const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const total = await prisma.deviceSession.count();
    const withoutUser = await prisma.deviceSession.count({ where: { userId: null } });
    const withUser = total - withoutUser;
    console.log({ total, withUser, withoutUser });

    const totalStudents = await prisma.user.count({ where: { role: 'STUDENT' } });
    const studentsWithDevice = await prisma.user.count({ where: { role: 'STUDENT', deviceBindingId: { not: null } } });
    const studentsWithDeviceSessions = await prisma.deviceSession.count({
        where: { user: { role: 'STUDENT' } }
    });
    console.log({ totalStudents, studentsWithDevice, studentsWithDeviceSessions });

    const noUserSample = await prisma.deviceSession.findMany({
        where: { userId: null },
        take: 5,
        select: { id: true, deviceName: true, deviceModel: true, lastSeen: true, appVersion: true, status: true, lastKnownIp: true }
    });
    console.log('Sample deviceSession without user:', noUserSample);

    const withUserSample = await prisma.deviceSession.findMany({
        where: { userId: { not: null } },
        take: 5,
        include: { user: { select: { id: true, name: true, role: true, className: true } } }
    });
    console.log('Sample deviceSession with user:', withUserSample);
}

main().catch(console.error).finally(() => prisma.$disconnect());
