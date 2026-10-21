const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const teachers = await prisma.user.findMany({
        where: { role: 'TEACHER' },
        select: {
            id: true,
            name: true,
            username: true,
            teachingSubject: true,
            teachingClasses: true
        },
        orderBy: { name: 'asc' }
    });
    console.log('Total teachers:', teachers.length);
    console.log(JSON.stringify(teachers, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
