const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getSubjectKey(s) {
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower.includes('matematika')) return 'matematika';
    if (lower.includes('indonesia')) return 'indonesia';
    if (lower.includes('inggris')) return 'inggris';
    if (lower.includes('ipa') || lower.includes('alam')) return 'ipa';
    if (lower.includes('ips') || lower.includes('sosial')) return 'ips';
    if (lower.includes('pai') || lower.includes('agama islam') || lower.includes('islam')) return 'pai';
    if (lower.includes('kristen')) return 'kristen';
    if (lower.includes('pjok') || lower.includes('penjas') || lower.includes('olahraga')) return 'pjok';
    if (lower.includes('seni') || lower.includes('budaya')) return 'seni';
    if (lower.includes('prakarya') || lower.includes('kewirausahaan')) return 'prakarya';
    if (lower.includes('jawa')) return 'jawa';
    if (lower.includes('informatika') || lower.includes('tik') || lower.includes('komputer')) return 'informatika';
    if (lower.includes('ppkn') || lower.includes('pancasila') || lower.includes('pkn')) return 'ppkn';
    if (lower.includes('bk') || lower.includes('konseling') || lower.includes('bimbingan')) return 'bk';
    return lower.replace(/[^a-z0-9]/g, '');
}

async function run() {
    console.log("=== SINKRONISASI JADWAL MAPEL & GURU DENGAN DATA MASTER PORTAL ===");
    
    const teachers = await prisma.user.findMany({
        where: { role: 'TEACHER' },
        select: { id: true, name: true, teachingSubject: true, teachingClasses: true }
    });

    const validTeachers = teachers.filter(t => t.teachingSubject && t.teachingSubject.trim().length > 0);
    console.log(`Guru terdaftar dengan mapel: ${validTeachers.length}`);

    const schedules = await prisma.classPeriodSchedule.findMany({
        where: { isBreak: false }
    });

    console.log(`Total entri jadwal KBM aktif: ${schedules.length}`);

    let updatedCount = 0;
    let fallbackCount = 0;

    for (const sch of schedules) {
        const sKey = getSubjectKey(sch.subjectName);

        // 1. Cari guru pengampu mapel yang kelas ajarannya mencakup kelas jadwal ini
        let matched = validTeachers.find(t => {
            const tKey = getSubjectKey(t.teachingSubject);
            if (tKey !== sKey) return false;
            if (!t.teachingClasses) return false;
            return t.teachingClasses.split(',').map(c => c.trim()).includes(sch.className);
        });

        // 2. Jika tidak ada spesifik kelas, cari guru dengan mapel yang sama
        if (!matched) {
            matched = validTeachers.find(t => getSubjectKey(t.teachingSubject) === sKey);
            if (matched) fallbackCount++;
        }

        if (matched && (sch.teacherId !== matched.id || sch.teacherName !== matched.name)) {
            await prisma.classPeriodSchedule.update({
                where: { id: sch.id },
                data: {
                    teacherId: matched.id,
                    teacherName: matched.name
                }
            });
            updatedCount++;
        }
    }

    console.log(`✅ Berhasil menyelaraskan ${updatedCount} jadwal mapel ke guru riil portal!`);
    console.log(`Fallback mapel umum: ${fallbackCount}`);

    // Verifikasi VII-D
    const viid = await prisma.classPeriodSchedule.findMany({
        where: { className: 'VII-D', isBreak: false }
    });
    console.log(`\nVerifikasi Jadwal Kelas VII-D:`);
    const distViid = {};
    viid.forEach(s => {
        distViid[s.subjectName] = s.teacherName;
    });
    console.log(distViid);
}

run().catch(console.error).finally(() => prisma.$disconnect());
