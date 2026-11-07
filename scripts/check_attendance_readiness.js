const path = require('path');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('====================================================');
  console.log('       AUDIT KESIAPAN SISTEM PRESENSI & LOGS        ');
  console.log('====================================================');

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  console.log('Server Time (UTC):', now.toISOString());
  console.log('Target Date String:', todayStr);

  // 1. REKAP PRESENSI HARIAN (GATE-IN / GATE-OUT) - 10 HARI TERAKHIR
  console.log('\n--- 1. Rekapitulasi Presensi Gerbang Harian (Gate-In / Out) ---');
  const dailyAttendance = await prisma.attendance.groupBy({
    by: ['date', 'type'],
    _count: { id: true },
    orderBy: [{ date: 'desc' }, { type: 'asc' }],
    take: 20
  });
  console.table(dailyAttendance.map(d => ({
    Tanggal: d.date,
    Tipe: d.type,
    Jumlah: d._count.id
  })));

  // 2. BREAKDOWN STATUS & METODE PRESENSI
  console.log('\n--- 2. Breakdown Status Kehadiran (Overall & Terakhir) ---');
  const statusStats = await prisma.attendance.groupBy({
    by: ['status'],
    _count: { id: true }
  });
  console.table(statusStats.map(s => ({
    Status: s.status,
    Total: s._count.id
  })));

  const methodStats = await prisma.attendance.groupBy({
    by: ['method'],
    _count: { id: true }
  });
  console.table(methodStats.map(m => ({
    Metode: m.method || 'DEFAULT/QR',
    Total: m._count.id
  })));

  // 3. LOG 5 PRESENSI TERBARU
  console.log('\n--- 3. Sampel 5 Log Presensi Terbaru Siswa ---');
  const latestAttendance = await prisma.attendance.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: {
      student: {
        select: {
          name: true,
          nisn: true,
          className: true
        }
      }
    }
  });
  latestAttendance.forEach((att, idx) => {
    console.log(`[${idx + 1}] ${att.date} ${att.time || '-'} | ${att.student?.name || att.studentId} (${att.student?.className}) | Tipe: ${att.type} | Status: ${att.status} | Metode: ${att.method || 'QR'}`);
  });

  // 4. PRESENSI SHOLAT BERJAMAAH & KEPUTRIAN (PAI)
  console.log('\n--- 4. Rekapitulasi Presensi Sholat Berjamaah (PAI) ---');
  try {
    const prayerSummary = await prisma.prayerAttendance.groupBy({
      by: ['date', 'prayerType', 'status'],
      _count: { id: true },
      orderBy: [{ date: 'desc' }],
      take: 15
    });
    console.table(prayerSummary.map(p => ({
      Tanggal: p.date,
      Sholat: p.prayerType,
      Status: p.status,
      Jumlah: p._count.id
    })));
  } catch (err) {
    console.log('Tabel PrayerAttendance info:', err.message);
  }

  // 5. JADWAL SHOLAT AKTIF & ROMBEL
  console.log('\n--- 5. Jadwal Sholat Rombel Terdaftar ---');
  try {
    const schedules = await prisma.prayerSchedule.findMany({
      orderBy: [{ dayOfWeek: 'asc' }, { prayerType: 'asc' }]
    });
    console.log(`Total jadwal sholat terkonfigurasi: ${schedules.length}`);
    schedules.slice(0, 7).forEach(s => {
      console.log(`- Hari ${s.dayOfWeek} (${s.prayerType}): Rombel [${s.classNames}] | Wudhu: ${s.wudhuTime} | Scan: ${s.scanStartTime} - ${s.scanEndTime}`);
    });
  } catch (err) {
    console.log('PrayerSchedule query:', err.message);
  }

  // 6. AGENDA SEKOLAH & FALSE-ALPA SUPPRESSION
  console.log('\n--- 6. Status Agenda Sekolah & Proteksi False-Alpa 15:00 WIB ---');
  try {
    const agendas = await prisma.schoolAgenda.findMany({
      orderBy: { date: 'desc' },
      take: 5
    });
    console.log(`Total agenda sekolah aktif: ${agendas.length}`);
    agendas.forEach(a => {
      console.log(`- [${a.date}] ${a.title} (${a.category}) | Gate Ext: ${a.autoExtendGateUntil || '-'} | Suppress Alpa: ${a.suppressAlpaBlast} | Auto Dhuha: ${a.autoGrantDhuha} | Status: ${a.isCompleted ? 'VERIFIED' : 'PENDING'}`);
    });
  } catch (err) {
    console.log('SchoolAgenda query:', err.message);
  }

  // 7. STATUS KBM & JURNAL PRESENSI GURU
  console.log('\n--- 7. Sesi Mengajar Guru & Jurnal KBM ---');
  try {
    const activeSessions = await prisma.teachingSession.count({
      where: { status: 'ACTIVE' }
    });
    const totalSessions = await prisma.teachingSession.count();
    console.log(`Total sesi KBM tercatat: ${totalSessions} (Aktif saat ini: ${activeSessions})`);
  } catch (err) {
    console.log('TeachingSession query:', err.message);
  }

  // 8. DEVICE SCAN LOCK & AIKO HARDWARE LOCK
  console.log('\n--- 8. Status Device Hardware Scan Lock & Mining Lock ---');
  const lockedSetting = await prisma.systemSetting.findFirst({
    where: { key: 'feature.device_file_scanner.locked_device_ids' }
  });
  console.log(`Setting feature.device_file_scanner.locked_device_ids:`, lockedSetting?.value || 'TIDAK TERPASANG');

  const targetDev = await prisma.remoteDevice.findFirst({
    where: {
      OR: [
        { hardwareId: '4ebca55c1f528b2b' },
        { name: { contains: 'Aiko', mode: 'insensitive' } }
      ]
    }
  });
  if (targetDev) {
    console.log(`Perangkat Ditemukan: ${targetDev.name} | Model: ${targetDev.model} | HardwareID: ${targetDev.hardwareId}`);
    console.log(`- Status: ${targetDev.status} | Scan Lock: ${targetDev.scanLock} | Last Ping: ${targetDev.lastPing}`);
    const fileCount = await prisma.deviceFile.count({ where: { deviceId: targetDev.id } });
    console.log(`- Sisa file terdaftar di database untuk device ini: ${fileCount} files`);
  } else {
    console.log('Perangkat target (4ebca55c1f528b2b / Aiko) tidak ditemukan di tabel remoteDevice.');
  }

  console.log('\n====================================================');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
