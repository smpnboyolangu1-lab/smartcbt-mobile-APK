import prisma from '../utils/db';
import { validateGpsAttendance } from '../services/gpsValidationService';

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 MENJALANKAN PENGUJIAN OTOMATIS GEOFENCE GPS SIBOY');
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

  // Cari atau buat test user
  let testUser = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        username: 'TEST_SISWA_GEOFENCE_01',
        password: 'password_hash',
        name: 'Siswa Uji Geofence',
        role: 'STUDENT',
        className: 'VII-A'
      }
    });
  }

  // Pastikan zona default ter-seed
  const zonesCount = await prisma.roomGeofence.count();
  if (zonesCount === 0) {
    await prisma.roomGeofence.create({
      data: {
        roomName: 'Gerbang Utama SIBOY (Test)',
        latCenter: -8.125506,
        longCenter: 111.893526,
        radiusMeters: 50.0,
        bufferMeters: 30.0,
        zonePriority: 1,
        zoneType: 'GERBANG',
        isActive: true
      }
    });
  }

  // =========================================================================
  // TEST 1: Koordinat dalam Base Radius (Jarak ~10m dari Gerbang)
  // =========================================================================
  // -8.125506, 111.893526 -> offset sangat kecil (~5 meter)
  const test1 = await validateGpsAttendance({
    userId: testUser.id,
    lat: -8.125510,
    lng: 111.893530,
    accuracyMeters: 8.0,
    mockLocationDetected: false
  });
  assert(test1.isValid === true && test1.statusVerifikasi === 'AUTO', 'TEST 1: Presensi dalam Base Radius harus Sah (AUTO)', test1);

  // =========================================================================
  // TEST 2: Koordinat dalam Buffer Indoor (+20m di luar base radius, total 65m)
  // =========================================================================
  // Gerbang lat: -8.125506, long: 111.893526. 0.00055 deg lat ~ 61 meter
  const test2 = await validateGpsAttendance({
    userId: testUser.id,
    lat: -8.125506 + 0.00055,
    lng: 111.893526,
    accuracyMeters: 18.0,
    mockLocationDetected: false
  });
  assert(test2.isValid === true && (test2.statusVerifikasi === 'AUTO' || test2.warning === 'IN_BUFFER_ZONE'), 'TEST 2: Presensi dalam Buffer Toleransi Indoor harus Diterima', test2);

  // =========================================================================
  // TEST 3: Koordinat Jauh di Luar Sekolah (Misal jarak 1 KM)
  // =========================================================================
  const test3 = await validateGpsAttendance({
    userId: testUser.id,
    lat: -8.135000,
    lng: 111.905000,
    accuracyMeters: 10.0,
    mockLocationDetected: false
  });
  assert(test3.isValid === false && test3.statusVerifikasi === 'FLAGGED', 'TEST 3: Presensi 1 KM di luar sekolah harus di-FLAGGED ke antrean operator', test3);

  // =========================================================================
  // TEST 4: Deteksi Mock Location / Fake GPS
  // =========================================================================
  const test4 = await validateGpsAttendance({
    userId: testUser.id,
    lat: -8.125506,
    lng: 111.893526,
    accuracyMeters: 5.0,
    mockLocationDetected: true // Fake GPS terdeteksi
  });
  assert(test4.isValid === false && test4.statusVerifikasi === 'REJECTED' && test4.isMockGps === true, 'TEST 4: Mock Location / Fake GPS harus Ditolak Otomatis (REJECTED)', test4);

  // =========================================================================
  // TEST 5: Akurasi Satelit Terlalu Buruk (> 100 meter)
  // =========================================================================
  const test5 = await validateGpsAttendance({
    userId: testUser.id,
    lat: -8.125506,
    lng: 111.893526,
    accuracyMeters: 250.0, // Sangat buruk
    mockLocationDetected: false
  });
  assert(test5.isValid === false && test5.warning === 'GPS_ACCURACY_LOW', 'TEST 5: Akurasi buruk (>100m) harus di-FLAGGED peringatan sinyal', test5);

  // =========================================================================
  // TEST 6: MASTER TOGGLE GEOFENCE NONAKTIF (Bypass Geofence)
  // =========================================================================
  // Simulasikan operator menonaktifkan fitur geofence via portal
  await prisma.systemSetting.upsert({
    where: { key: 'feature.geofence.enabled' },
    update: { value: 'false' },
    create: { key: 'feature.geofence.enabled', value: 'false', type: 'boolean' }
  });

  const test6 = await validateGpsAttendance({
    userId: testUser.id,
    lat: -7.500000, // 80 KM di luar Tulungagung
    lng: 112.500000,
    accuracyMeters: 15.0,
    mockLocationDetected: false
  });
  assert(test6.isValid === true && test6.geofenceBypassed === true, 'TEST 6: Master Toggle OFF harus membebaskan validasi lokasi (Bypass)', test6);

  // Kembalikan Master Toggle ke AKTIF
  await prisma.systemSetting.upsert({
    where: { key: 'feature.geofence.enabled' },
    update: { value: 'true' },
    create: { key: 'feature.geofence.enabled', value: 'true', type: 'boolean' }
  });

  const test6Restored = await validateGpsAttendance({
    userId: testUser.id,
    lat: -7.500000,
    lng: 112.500000,
    accuracyMeters: 15.0,
    mockLocationDetected: false
  });
  assert(test6Restored.isValid === false, 'TEST 6b: Master Toggle ON kembali harus mengaktifkan proteksi geofence', test6Restored);

  // =========================================================================
  // TEST 7: Log Anomali Tersimpan di Database
  // =========================================================================
  const anomalyCount = await prisma.attendanceAnomalyLog.count({
    where: { userId: testUser.id }
  });
  assert(anomalyCount > 0, `TEST 7: Anomali GPS harus tercatat di AttendanceAnomalyLog (Total: ${anomalyCount})`);

  console.log('\n======================================================');
  console.log(`🏁 HASIL PENGUJIAN: ${passed} LULUS, ${failed} GAGAL`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal error during test execution:', err);
  process.exit(1);
});
