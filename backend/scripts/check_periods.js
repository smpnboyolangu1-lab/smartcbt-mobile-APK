const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const periodTimes = await prisma.classPeriodSchedule.findMany({
        where: { day: 'Senin' },
        select: { periodIndex: true, startTime: true, endTime: true, isBreak: true },
        distinct: ['periodIndex'],
        orderBy: { periodIndex: 'asc' }
    });
    console.log('Senin periods:', JSON.stringify(periodTimes, null, 2));

    const jumatPeriods = await prisma.classPeriodSchedule.findMany({
        where: { day: 'Jumat' },
        select: { periodIndex: true, startTime: true, endTime: true, isBreak: true },
        distinct: ['periodIndex'],
        orderBy: { periodIndex: 'asc' }
    });
    console.log('Jumat periods:', JSON.stringify(jumatPeriods, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
