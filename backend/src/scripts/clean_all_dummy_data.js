const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanDummyData() {
    console.log('=== 1. PEMBERSIHAN DATA DUMMY EKSTRAKURIKULER ===');
    const delMem = await prisma.extracurricularMember.deleteMany({});
    console.log(`- Dihapus ${delMem.count} anggota dummy ekstrakurikuler`);
    const delAch = await prisma.extracurricularAchievement.deleteMany({});
    console.log(`- Dihapus ${delAch.count} prestasi dummy ekstrakurikuler`);
    const delCur = await prisma.extracurricularCurriculum.deleteMany({});
    console.log(`- Dihapus ${delCur.count} kurikulum dummy ekstrakurikuler`);
    const delEvt = await prisma.extracurricularEvent.deleteMany({});
    console.log(`- Dihapus ${delEvt.count} event dummy ekstrakurikuler`);
    const delAnn = await prisma.extracurricularAnnouncement.deleteMany({});
    console.log(`- Dihapus ${delAnn.count} pengumuman dummy ekstrakurikuler`);
    const delExt = await prisma.extracurricular.deleteMany({});
    console.log(`- Dihapus ${delExt.count} master dummy ekstrakurikuler`);

    console.log('\n=== 2. PEMBERSIHAN DATA DUMMY LAPORAN KELAS KOSONG / PIKET / KURIKULUM ===');
    const delEmpty = await prisma.emptyClassReport.deleteMany({
        where: {
            OR: [
                { reporterName: 'Sistem Deteksi Kurikulum' },
                { reporterName: 'Scheduler 5 Menit SIBOY' },
                { reporterName: null },
                { scheduledTeacher: 'Guru Pengampu' }
            ]
        }
    });
    console.log(`- Dihapus ${delEmpty.count} laporan palsu hasil scheduler/dummy pada emptyClassReport`);

    const delKelasKosong = await prisma.kelasKosongLog.deleteMany({});
    console.log(`- Dihapus ${delKelasKosong.count} log sampah pada kelasKosongLog`);

    console.log('\n=== 3. PEMBERSIHAN DATA DUMMY IZIN GURU TESTING ===');
    try {
        const delLeave = await prisma.teacherLeaveRequest.deleteMany({
            where: {
                OR: [
                    { teacherId: 'user-guru-biasa-test' },
                    { reason: { contains: 'Demam tinggi dan istirahat dokter' } }
                ]
            }
        });
        console.log(`- Dihapus ${delLeave.count} izin dummy testing pada teacherLeaveRequest`);
    } catch (e) {
        console.log('teacherLeaveRequest delete info:', e.message);
    }

    console.log('\n=== 4. VERIFIKASI SISA DATA SETELAH PEMBERSIHAN ===');
    const remExt = await prisma.extracurricular.count();
    const remReports = await prisma.emptyClassReport.count();
    const remLogs = await prisma.kelasKosongLog.count();
    const remPiket = await prisma.piketSchedule.count();
    console.log(`- Sisa Extracurricular di DB : ${remExt}`);
    console.log(`- Sisa EmptyClassReports     : ${remReports}`);
    console.log(`- Sisa KelasKosongLog        : ${remLogs}`);
    console.log(`- Jadwal Piket Guru Riil     : ${remPiket} (Tetap dipertahankan untuk jadwal operasional resmi)`);

    await prisma.$disconnect();
    console.log('\n✅ Pembersihan seluruh data dummy selesai dengan sukses!');
}

cleanDummyData().catch(err => {
    console.error('Pembersihan gagal:', err);
    process.exit(1);
});
