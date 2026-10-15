const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const c1 = await prisma.classPeriodSchedule.count();
    const c2 = await prisma.teachingSchedule.count();
    const s1 = await prisma.classPeriodSchedule.findFirst();
    const s2 = await prisma.teachingSchedule.findFirst();
    console.log('Result:', {
        classPeriodScheduleCount: c1,
        teachingScheduleCount: c2,
        sampleClassPeriodSchedule: s1,
        sampleTeachingSchedule: s2
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
