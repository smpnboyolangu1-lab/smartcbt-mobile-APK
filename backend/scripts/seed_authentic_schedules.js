const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Seeding authentic schedules for SMPN 1 Boyolangu...');

    // 1. Ambil data Sidik Sujatmiko
    const sidik = await prisma.user.findFirst({
        where: { name: { contains: 'Sidik', mode: 'insensitive' } }
    });

    if (!sidik) {
        console.error('Guru Sidik Sujatmiko tidak ditemukan!');
        return;
    }
    console.log(`Guru Sidik ditemukan: ${sidik.name} (ID: ${sidik.id})`);

    // Hapus jadwal lama milik Sidik jika ada
    await prisma.classPeriodSchedule.deleteMany({
        where: {
            OR: [
                { teacherId: sidik.id },
                { teacherName: { contains: 'Sidik', mode: 'insensitive' } }
            ]
        }
    });

    // Jadwal Sidik Sujatmiko:
    // Senin: JP 1-2 IX-A (07:00-08:30), JP 3-4 IX-B (08:30-10:00), JP 6-7 IX-C (10:30-12:00), JP 9-10 IX-F (12:45-14:15)
    // Selasa: JP 1-2 VIII-D (07:00-08:30), JP 3-4 IX-G (08:30-10:00), JP 6-7 VIII-B (10:30-12:00)
    // Rabu: JP 1-2 VIII-K (07:00-08:30), JP 3-4 IX-I (08:30-10:00), JP 6-7 VIII-E (10:30-12:00)
    // Kamis: JP 1-2 IX-K (07:00-08:30), JP 3-4 VIII-G (08:30-10:00), JP 6-7 VIII-I (10:30-12:00)
    // Jumat: JP 1-2 IX-A (07:00-08:30), JP 3-4 IX-B (08:30-10:00)
    // Sabtu: JP 1-2 IX-C (07:00-08:30), JP 3-4 IX-K (08:30-10:00)

    const sidikSlots = [
        // SENIN
        { day: 'Senin', p: 1, start: '07:00', end: '07:45', cls: 'IX-A', subj: 'Bahasa Inggris' },
        { day: 'Senin', p: 2, start: '07:45', end: '08:30', cls: 'IX-A', subj: 'Bahasa Inggris' },
        { day: 'Senin', p: 3, start: '08:30', end: '09:15', cls: 'IX-B', subj: 'Bahasa Inggris' },
        { day: 'Senin', p: 4, start: '09:15', end: '10:00', cls: 'IX-B', subj: 'Bahasa Inggris' },
        { day: 'Senin', p: 6, start: '10:30', end: '11:15', cls: 'IX-C', subj: 'Bahasa Inggris' },
        { day: 'Senin', p: 7, start: '11:15', end: '12:00', cls: 'IX-C', subj: 'Bahasa Inggris' },
        { day: 'Senin', p: 9, start: '12:45', end: '13:30', cls: 'IX-F', subj: 'Bahasa Inggris' },
        { day: 'Senin', p: 10, start: '13:30', end: '14:15', cls: 'IX-F', subj: 'Bahasa Inggris' },

        // SELASA
        { day: 'Selasa', p: 1, start: '07:00', end: '07:45', cls: 'VIII-D', subj: 'Bahasa Inggris' },
        { day: 'Selasa', p: 2, start: '07:45', end: '08:30', cls: 'VIII-D', subj: 'Bahasa Inggris' },
        { day: 'Selasa', p: 3, start: '08:30', end: '09:15', cls: 'IX-G', subj: 'Bahasa Inggris' },
        { day: 'Selasa', p: 4, start: '09:15', end: '10:00', cls: 'IX-G', subj: 'Bahasa Inggris' },
        { day: 'Selasa', p: 6, start: '10:30', end: '11:15', cls: 'VIII-B', subj: 'Bahasa Inggris' },
        { day: 'Selasa', p: 7, start: '11:15', end: '12:00', cls: 'VIII-B', subj: 'Bahasa Inggris' },

        // RABU
        { day: 'Rabu', p: 1, start: '07:00', end: '07:45', cls: 'VIII-K', subj: 'Bahasa Inggris' },
        { day: 'Rabu', p: 2, start: '07:45', end: '08:30', cls: 'VIII-K', subj: 'Bahasa Inggris' },
        { day: 'Rabu', p: 3, start: '08:30', end: '09:15', cls: 'IX-I', subj: 'Bahasa Inggris' },
        { day: 'Rabu', p: 4, start: '09:15', end: '10:00', cls: 'IX-I', subj: 'Bahasa Inggris' },
        { day: 'Rabu', p: 6, start: '10:30', end: '11:15', cls: 'VIII-E', subj: 'Bahasa Inggris' },
        { day: 'Rabu', p: 7, start: '11:15', end: '12:00', cls: 'VIII-E', subj: 'Bahasa Inggris' },

        // KAMIS
        { day: 'Kamis', p: 1, start: '07:00', end: '07:45', cls: 'IX-K', subj: 'Bahasa Inggris' },
        { day: 'Kamis', p: 2, start: '07:45', end: '08:30', cls: 'IX-K', subj: 'Bahasa Inggris' },
        { day: 'Kamis', p: 3, start: '08:30', end: '09:15', cls: 'VIII-G', subj: 'Bahasa Inggris' },
        { day: 'Kamis', p: 4, start: '09:15', end: '10:00', cls: 'VIII-G', subj: 'Bahasa Inggris' },
        { day: 'Kamis', p: 6, start: '10:30', end: '11:15', cls: 'VIII-I', subj: 'Bahasa Inggris' },
        { day: 'Kamis', p: 7, start: '11:15', end: '12:00', cls: 'VIII-I', subj: 'Bahasa Inggris' },

        // JUMAT
        { day: 'Jumat', p: 1, start: '07:00', end: '07:45', cls: 'IX-A', subj: 'Bahasa Inggris' },
        { day: 'Jumat', p: 2, start: '07:45', end: '08:30', cls: 'IX-A', subj: 'Bahasa Inggris' },
        { day: 'Jumat', p: 3, start: '08:30', end: '09:15', cls: 'IX-B', subj: 'Bahasa Inggris' },
        { day: 'Jumat', p: 4, start: '09:15', end: '10:00', cls: 'IX-B', subj: 'Bahasa Inggris' },

        // SABTU
        { day: 'Sabtu', p: 1, start: '07:00', end: '07:45', cls: 'IX-C', subj: 'Bahasa Inggris' },
        { day: 'Sabtu', p: 2, start: '07:45', end: '08:30', cls: 'IX-C', subj: 'Bahasa Inggris' },
        { day: 'Sabtu', p: 3, start: '08:30', end: '09:15', cls: 'IX-K', subj: 'Bahasa Inggris' },
        { day: 'Sabtu', p: 4, start: '09:15', end: '10:00', cls: 'IX-K', subj: 'Bahasa Inggris' }
    ];

    for (const slot of sidikSlots) {
        // Hapus slot bentrok di kelas tersebut pada jam & hari itu
        await prisma.classPeriodSchedule.deleteMany({
            where: {
                day: slot.day,
                periodIndex: slot.p,
                className: slot.cls
            }
        });

        await prisma.classPeriodSchedule.create({
            data: {
                day: slot.day,
                periodIndex: slot.p,
                startTime: slot.start,
                endTime: slot.end,
                className: slot.cls,
                subjectName: slot.subj,
                teacherId: sidik.id,
                teacherName: sidik.name,
                roomName: `Ruang Kelas ${slot.cls}`,
                isBreak: false
            }
        });
    }

    console.log(`✅ Berhasil menambahkan ${sidikSlots.length} slot jadwal mengajar untuk ${sidik.name}`);

    // Update teacherId untuk guru-guru lain yang namanya cocok
    const allTeachers = await prisma.user.findMany({ where: { role: 'TEACHER' } });
    for (const t of allTeachers) {
        if (!t.name || t.name === sidik.name) continue;
        const res = await prisma.classPeriodSchedule.updateMany({
            where: {
                teacherName: { contains: t.name, mode: 'insensitive' },
                teacherId: null
            },
            data: {
                teacherId: t.id
            }
        });
        if (res.count > 0) {
            console.log(`Linked ${res.count} schedules to ${t.name}`);
        }
    }

    console.log('Selesai seeding jadwal authentic.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
