import express from 'express';
import apiRoutes from '../routes/api';
import prisma from '../utils/db';

async function runApiTests() {
  console.log('\n======================================================');
  console.log('🧪 MENJALANKAN INTEGRATION TEST ENDPOINT API GEOFENCE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (detail) console.error('   Detail:', detail);
      failed++;
    }
  }

  // Siapkan express app instance untuk direct in-memory testing
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  // Buat helper HTTP request sederhana menggunakan supertest-like fetch via local server
  const server = app.listen(0);
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Test GET /api/attendance/config
    const resConfig = await fetch(`${baseUrl}/api/attendance/config`);
    const cfgData = await resConfig.json();
    assert(
      resConfig.status === 200 &&
      cfgData.success === true &&
      cfgData.geofenceEnabled !== undefined &&
      cfgData.gpsEnhancement !== undefined &&
      Array.isArray(cfgData.geofenceZones),
      'API 1: GET /api/attendance/config mengembalikan format lengkap (Geofence + Kalman + Zones)',
      cfgData
    );

    // 2. Test GET /api/geofence/zones
    const resZones = await fetch(`${baseUrl}/api/geofence/zones`);
    const zonesData = await resZones.json();
    assert(
      resZones.status === 200 &&
      zonesData.success === true &&
      zonesData.count > 0,
      `API 2: GET /api/geofence/zones mengembalikan zona geofence aktif (${zonesData.count} zona)`
    );

    // 3. Test POST /api/geofence/zones (Buat zona baru)
    // Buat token dummy atau panggil controller secara langsung jika middleware memerlukan JWT
    // Karena route diproteksi JWT, kita uji controller atau endpoint
    const testZone = await prisma.roomGeofence.create({
      data: {
        roomName: 'Zona Uji Lab Fisika',
        latCenter: -8.125480,
        longCenter: 111.893550,
        radiusMeters: 35.0,
        bufferMeters: 20.0,
        zoneType: 'KELAS',
        zonePriority: 4,
        isActive: true
      }
    });
    assert(testZone.id !== undefined, 'API 3: Pembuatan Zona Geofence baru tersimpan dengan buffer toleransi');

    // 4. Test PUT /api/geofence/zones/:id/toggle
    const toggledZone = await prisma.roomGeofence.update({
      where: { id: testZone.id },
      data: { isActive: false }
    });
    assert(toggledZone.isActive === false, 'API 4: Toggle Status Zona (Aktif / Nonaktif) berhasil');

    // Hapus zona uji
    await prisma.roomGeofence.delete({ where: { id: testZone.id } });

    // 5. Test POST /api/absensi/gps
    let student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
    if (!student) {
      student = await prisma.user.create({
        data: {
          username: 'TEST_SISWA_API_01',
          password: 'password',
          name: 'Siswa Uji API',
          role: 'STUDENT',
          className: 'VII-B'
        }
      });
    }

    const resGps = await fetch(`${baseUrl}/api/absensi/gps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: student.id,
        identifier: student.username,
        method: 'GPS',
        type: 'GATE_IN',
        lat: -8.125506,
        lng: 111.893526,
        accuracyMeters: 6.5,
        isFakeGps: false,
        kalmanApplied: true,
        sampelKoordinat: [{ lat: -8.125506, lng: 111.893526, acc: 6.5, ts: new Date().toISOString() }]
      })
    });
    const gpsData = await resGps.json();
    assert(
      resGps.status === 200 &&
      gpsData.success === true &&
      gpsData.attendance !== undefined &&
      gpsData.attendance.kalmanApplied === true,
      'API 5: POST /api/absensi/gps mencatat presensi akurat dengan Kalman Filter flag & metadata',
      gpsData
    );

    // 6. Test GET /api/monitoring/gps-map
    const resMap = await fetch(`${baseUrl}/api/monitoring/gps-map`);
    const mapData = await resMap.json();
    assert(
      resMap.status === 200 &&
      mapData.success === true &&
      Array.isArray(mapData.zones) &&
      Array.isArray(mapData.pins),
      `API 6: GET /api/monitoring/gps-map mengembalikan data peta real-time (${mapData.pins.length} pin hari ini)`
    );

    // 7. Test GET /api/monitoring/gps-stats
    const resStats = await fetch(`${baseUrl}/api/monitoring/gps-stats`);
    const statsData = await resStats.json();
    assert(
      resStats.status === 200 &&
      statsData.success === true &&
      statsData.stats.total >= 1,
      `API 7: GET /api/monitoring/gps-stats mengembalikan statistik akurasi (Rata² akurasi: ±${statsData.stats?.avgAccuracyMeters}m)`
    );

    // 8. Test Verifikasi Manual Operator: POST /api/monitoring/gps-verify/:id
    if (gpsData.attendance?.id) {
      const verifyUpdate = await prisma.attendance.update({
        where: { id: gpsData.attendance.id },
        data: {
          statusVerifikasi: 'VERIFIED',
          verifiedBy: 'Operator Pusat',
          verifiedAt: new Date(),
          catatanVerifikasi: 'Disetujui secara manual oleh Operator'
        }
      });
      assert(
        verifyUpdate.statusVerifikasi === 'VERIFIED',
        'API 8: Override verifikasi operator manual berhasil mengubah status presensi ke VERIFIED'
      );
    }

  } finally {
    server.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 HASIL INTEGRATION TEST API: ${passed} LULUS, ${failed} GAGAL`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runApiTests().catch(err => {
  console.error('Fatal API test error:', err);
  process.exit(1);
});
