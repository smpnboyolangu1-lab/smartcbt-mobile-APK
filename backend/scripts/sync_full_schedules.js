const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const teachers = await prisma.user.findMany({
        where: { role: 'TEACHER' }
    });
    console.log('Total teachers:', teachers.length);
    const withSubject = teachers.filter(t => t.teachingSubject);
    console.log('Teachers with teachingSubject:', withSubject.length);
    teachers.forEach(t => {
        console.log(`- ${t.name} (${t.username}): Mapel=[${t.teachingSubject || '-'}] Rombel=[${t.teachingClasses || '-'}]`);
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
