const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DAY_NAMES = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

async function run() {
    console.log("=== SEEDING JADWAL GURU PIKET RESMI SENIN - SABTU ===");
    const count = await prisma.piketSchedule.count();
    if (count > 0) {
        console.log(`Jadwal piket sudah ada (${count} data). Menghapus untuk sinkronisasi ulang data terbaru...`);
        await prisma.piketSchedule.deleteMany({});
    }

    const teachers = await prisma.user.findMany({
        where: { role: 'TEACHER' },
        select: { id: true, name: true, username: true }
    });

    console.log(`Total guru tersedia: ${teachers.length}`);
    if (teachers.length === 0) {
        console.log("Tidak ada guru.");
        return;
    }

    // Hari 1 (Senin) s/d 6 (Sabtu)
    // 5 guru per hari
    let cursor = 0;
    const notesPool = [
        'Koordinator Piket Utama - Lobi Gedung A',
        'Piket Gerbang & Pemantauan KBM Gedung B',
        'Piket Monitoring KBM Lantai 2 & Inval',
        'Piket Presensi & Penanganan Kelas Kosong',
        'Piket Disposisi Kurikulum & Ruang Guru'
    ];

    for (let day = 1; day <= 6; day++) {
        const dayName = DAY_NAMES[day];
        for (let i = 0; i < 5; i++) {
            const t = teachers[cursor % teachers.length];
            cursor++;
            await prisma.piketSchedule.create({
                data: {
                    teacherId: t.id,
                    dayOfWeek: day,
                    dayName,
                    startTime: '06:30',
                    endTime: day === 5 ? '11:45' : '14:30',
                    notes: notesPool[i],
                    isActive: true,
                    createdBy: 'Sistem Sinkronisasi Portal'
                }
            });
            console.log(`[${dayName}] Ditambahkan: ${t.name} (${notesPool[i]})`);
        }
    }

    console.log("✅ Seeding jadwal piket selesai! 30 jadwal piket aktif terpasang.");
}

run().catch(console.error).finally(() => prisma.$disconnect());
