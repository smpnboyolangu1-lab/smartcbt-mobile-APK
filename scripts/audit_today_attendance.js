const { PrismaClient } = require('../backend/node_modules/@prisma/client');
require('../backend/node_modules/dotenv').config({ path: 'backend/.env' });
const prisma = new PrismaClient();

async function checkTodayAttendance() {
    const startOfDayWib = new Date('2026-10-24T00:00:00.000+07:00');
    const endOfDayWib = new Date('2026-10-24T23:59:59.999+07:00');

    console.log('=== AUDIT PRESENSI HARI INI (SABTU, 24 OKTOBER 2026) ===');
    console.log('Rentang Waktu WIB: 2026-10-24 00:00:00 s.d. 23:59:59');

    const allToday = await prisma.attendance.findMany({
        where: {
            scanTime: { gte: startOfDayWib, lte: endOfDayWib }
        },
        include: {
            user: { select: { id: true, name: true, className: true, role: true } }
        },
        orderBy: { scanTime: 'asc' }
    });

    console.log('\n--- 1. RINGKASAN RECORD PRESENSI ---');
    console.log('Total baris scan tercatat:', allToday.length);

    const byType = {};
    const byStatus = {};
    const byMethod = {};
    let fakeGpsCount = 0;
    const studentMap = new Map();
    const highDistance = [];

    for (const a of allToday) {
        byType[a.type] = (byType[a.type] || 0) + 1;
        byStatus[a.status] = (byStatus[a.status] || 0) + 1;
        byMethod[a.method] = (byMethod[a.method] || 0) + 1;
        if (a.isFakeGps) fakeGpsCount++;
        if (a.user) {
            if (!studentMap.has(a.user.id)) {
                studentMap.set(a.user.id, { name: a.user.name, class: a.user.className, logs: [] });
            }
            studentMap.get(a.user.id).logs.push({ type: a.type, time: a.scanTime, method: a.method, dist: a.jarakKeSekolah });
        }
        if (a.jarakKeSekolah && a.jarakKeSekolah > 100) {
            highDistance.push({ name: a.user?.name, dist: a.jarakKeSekolah, time: a.scanTime, note: a.note });
        }
    }

    console.log('Tipe Scan:', JSON.stringify(byType));
    console.log('Status Presensi:', JSON.stringify(byStatus));
    console.log('Metode Presensi:', JSON.stringify(byMethod));
    console.log('Total Siswa Unik Hadir:', studentMap.size);
    console.log('Fake GPS / Mock Location Terdeteksi:', fakeGpsCount);
    console.log('Presensi Jarak Jauh (>100 meter):', highDistance.length);

    if (allToday.length > 0) {
        const first = allToday[0];
        const last = allToday[allToday.length - 1];
        const fmtWib = (d) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', timeStyle: 'medium' }).format(d);
        console.log(`Scan Pertama: ${fmtWib(first.scanTime)} WIB (${first.user?.name} - ${first.type})`);
        console.log(`Scan Terakhir: ${fmtWib(last.scanTime)} WIB (${last.user?.name} - ${last.type})`);
    }

    // Siswa Masuk vs Pulang
    let inOnly = 0;
    let inAndOut = 0;
    let outOnly = 0;
    for (const [uid, data] of studentMap.entries()) {
        const hasIn = data.logs.some(l => l.type === 'GATE_IN');
        const hasOut = data.logs.some(l => l.type === 'GATE_OUT');
        if (hasIn && hasOut) inAndOut++;
        else if (hasIn) inOnly++;
        else if (hasOut) outOnly++;
    }
    console.log(`Siswa Masuk & Pulang Lengkap: ${inAndOut}`);
    console.log(`Siswa Masuk Saja (Belum/Tidak Tap Pulang): ${inOnly}`);
    console.log(`Siswa Pulang Saja (Tanpa Tap Masuk): ${outOnly}`);

    // 2. Anomali Presensi Log
    console.log('\n--- 2. LOG ANOMALI PRESENSI (AttendanceAnomalyLog) ---');
    try {
        const anomalies = await prisma.attendanceAnomalyLog.findMany({
            where: {
                createdAt: { gte: startOfDayWib, lte: endOfDayWib }
            },
            take: 20,
            orderBy: { createdAt: 'desc' }
        });
        console.log('Total anomali presensi hari ini:', anomalies.length);
        for (const an of anomalies) {
            console.log(`- [${an.severity || 'WARN'}] ${an.reason} (User: ${an.userId})`);
        }
    } catch (e) {
        console.log('Tabel AttendanceAnomalyLog tidak ada / error:', e.message);
    }

    // 3. Client Error Logs (AppClientErrorLog)
    console.log('\n--- 3. CLIENT CRASH / ERROR LOGS HARI INI (AppClientErrorLog) ---');
    try {
        const clientErrors = await prisma.appClientErrorLog.findMany({
            where: {
                createdAt: { gte: startOfDayWib, lte: endOfDayWib }
            },
            take: 20,
            orderBy: { createdAt: 'desc' }
        });
        console.log('Total Client Errors hari ini:', clientErrors.length);
        for (const ce of clientErrors) {
            console.log(`- [${ce.errorType || 'ERROR'}] Device ${ce.deviceModel}: ${ce.errorMessage}`);
        }
    } catch (e) {
        console.log('AppClientErrorLog error:', e.message);
    }

    // 4. Audit Log Presensi Terkait Penolakan / Gagal
    console.log('\n--- 4. AUDIT LOG PRESENSI HARI INI ---');
    try {
        const auditLogs = await prisma.auditLog.findMany({
            where: {
                createdAt: { gte: startOfDayWib, lte: endOfDayWib },
                action: { contains: 'ATTENDANCE' }
            },
            take: 10,
            orderBy: { createdAt: 'desc' }
        });
        console.log('Audit logs terkait ATTENDANCE hari ini:', auditLogs.length);
        for (const al of auditLogs) {
            console.log(`- ${al.action}: ${al.details}`);
        }
    } catch (e) {
        console.log('AuditLog error:', e.message);
    }

    // 5. Cek Pengaturan Gate Hari Ini
    console.log('\n--- 5. PENGATURAN GATE AKTIF ---');
    try {
        const gateSetting = await prisma.gateSetting.findFirst();
        if (gateSetting) {
            console.log(`Batas Jam Masuk (Gate In Max): ${gateSetting.gateInMaxTime}`);
            console.log(`Mulai Jam Pulang (Gate Out Start): ${gateSetting.gateOutStartTime}`);
            console.log(`Batas Jam Pulang (Gate Out End): ${gateSetting.gateOutEndTime}`);
            console.log(`Radius Geofence: ${gateSetting.radiusMeters || 100} meter`);
            console.log(`Mock Location Blocked: ${gateSetting.blockMockLocation !== false ? 'AKTIF' : 'NONAKTIF'}`);
        } else {
            console.log('Gate setting memakai default (07:15, 14:00-17:00).');
        }
    } catch (e) {
        console.log('GateSetting error:', e.message);
    }

    // 6. Cek Agenda / Hari Sabtu di Kalender
    console.log('\n--- 6. STATUS HARI (SABTU) ---');
    const dayOfWeek = new Date().getDay(); // 6 = Saturday
    console.log('Hari dalam minggu (0=Minggu, 6=Sabtu):', dayOfWeek);
    try {
        const satAgenda = await prisma.schoolAgenda.findMany({
            where: {
                date: { gte: startOfDayWib, lte: endOfDayWib }
            }
        });
        console.log('Agenda sekolah terdaftar hari ini:', satAgenda.length > 0 ? satAgenda : 'Tidak ada agenda khusus (Hari Pembelajaran / Ekstrakurikuler Sabtu)');
    } catch (e) {
        console.log('Agenda query error / none:', e.message);
    }

    await prisma['$disconnect']();
}

checkTodayAttendance().catch(e => {
    console.error('Audit fatal error:', e);
    process.exit(1);
});
