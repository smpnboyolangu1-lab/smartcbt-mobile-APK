const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const ach = await prisma.extracurricularAchievement.count();
    const cur = await prisma.extracurricularCurriculum.count();
    const evt = await prisma.extracurricularEvent.count();
    const ann = await prisma.extracurricularAnnouncement.count();
    const mem = await prisma.extracurricularMember.count();
    const ext = await prisma.extracurricular.count();
    console.log({
        extracurriculars: ext,
        achievements: ach,
        curriculums: cur,
        events: evt,
        announcements: ann,
        members: mem
    });

    if (ach > 0) {
        const achs = await prisma.extracurricularAchievement.findMany();
        console.log('Achievements:', achs);
    }
    if (evt > 0) {
        const evts = await prisma.extracurricularEvent.findMany();
        console.log('Events:', evts);
    }
    if (ann > 0) {
        const anns = await prisma.extracurricularAnnouncement.findMany();
        console.log('Announcements:', anns);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
