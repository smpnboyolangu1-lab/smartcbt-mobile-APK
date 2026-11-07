const axios = require('../backend/node_modules/axios');
const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = 'http://localhost:3000';
const TARGET_ANDROID_ID = '4ebca55c1f528b2b';
const TARGET_MODEL = '22120RN86G';
const JWT_SECRET = process.env.JWT_SECRET || 'cbt_prod_secret_f9a83b27c64e10d592a8174fec01849a62bc38102d7e481b9201948271039841';

async function test() {
  console.log('=== START VERIFIKASI HARDWARE SCAN & UPLOAD LOCK ===\n');

  // 1. Verifikasi fungsi unit isDeviceScanLocked
  console.log('--- 1. Test Unit isDeviceScanLocked ---');
  const { isDeviceScanLocked } = require('../backend/dist/controllers/remoteDeviceController');
  
  const test1 = await isDeviceScanLocked(TARGET_ANDROID_ID);
  console.log(`- String "${TARGET_ANDROID_ID}":`, test1 ? 'LOCKED (PASS)' : 'FAILED');
  
  const test2 = await isDeviceScanLocked(TARGET_ANDROID_ID.toUpperCase());
  console.log(`- Uppercase "${TARGET_ANDROID_ID.toUpperCase()}":`, test2 ? 'LOCKED (PASS)' : 'FAILED');
  
  const test3 = await isDeviceScanLocked({ deviceAndroidId: TARGET_ANDROID_ID, user: { username: '99999999', role: 'STUDENT' } });
  console.log(`- Object dgn username lain (99999999):`, test3 ? 'LOCKED (PASS)' : 'FAILED');

  const test4 = await isDeviceScanLocked({ deviceAndroidId: TARGET_ANDROID_ID, deviceModel: TARGET_MODEL, user: { username: 'any_student', role: 'STUDENT' } });
  console.log(`- Object dgn deviceModel Xiaomi 22120RN86G:`, test4 ? 'LOCKED (PASS)' : 'FAILED');

  // 2. Simulasi Login dengan User Berbeda (Jibran / NISN 137244195)
  console.log('\n--- 2. Test Login dengan Akun Lain (Jibran Aimar / 137244195) ---');
  const jibran = await prisma.user.findFirst({
    where: { username: '137244195' }
  });
  console.log('Target Akun Uji:', jibran ? `${jibran.name} (${jibran.username})` : 'User tidak ditemukan');

  const loginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
    username: '137244195',
    password: jibran.nisn || '137244195',
    deviceId: TARGET_ANDROID_ID
  }).catch(e => e.response || { status: 500, data: e.message });

  console.log(`Login status: ${loginRes.status}`);

  // Cek DeviceSession di database pasca-login
  const sessAfterLogin = await prisma.deviceSession.findUnique({
    where: { deviceAndroidId: TARGET_ANDROID_ID },
    include: { user: true }
  });
  console.log('Status DeviceSession setelah login:', {
    deviceAndroidId: sessAfterLogin?.deviceAndroidId,
    status: sessAfterLogin?.status,
    userId: sessAfterLogin?.userId,
    username: sessAfterLogin?.user?.username,
    name: sessAfterLogin?.user?.name
  });
  const passLogin = sessAfterLogin?.status === 'LOCKED_SCAN';
  console.log('Status LOCKED_SCAN bertahan pasca-login:', passLogin ? 'PASS' : 'FAIL');

  // 3. Test API /api/device/register dari HP
  console.log('\n--- 3. Test API /api/device/register ---');
  const regRes = await axios.post(`${BASE_URL}/api/device/register`, {
    deviceAndroidId: TARGET_ANDROID_ID,
    deviceName: 'Xiaomi 22120RN86G',
    deviceModel: TARGET_MODEL,
    deviceBrand: 'Xiaomi',
    deviceOsVersion: 'Android 14 (API 34)',
    appVersion: '2.9.14',
    userId: jibran?.id,
    username: '137244195',
    batteryLevel: 85,
    isCharging: false
  });
  console.log('Register Response:', {
    success: regRes.data?.success,
    status: regRes.data?.device?.status,
    fileScannerEnabled: regRes.data?.fileScannerEnabled,
    isScanLocked: regRes.data?.isScanLocked
  });
  const passReg = regRes.data?.device?.status === 'LOCKED_SCAN' && regRes.data?.fileScannerEnabled === false && regRes.data?.isScanLocked === true;
  console.log('Register Lock Enforced:', passReg ? 'PASS' : 'FAIL');

  // 4. Test API /api/device/heartbeat dari HP
  console.log('\n--- 4. Test API /api/device/heartbeat ---');
  const hbRes = await axios.post(`${BASE_URL}/api/device/heartbeat`, {
    deviceAndroidId: TARGET_ANDROID_ID,
    batteryLevel: 85,
    isCharging: false
  });
  console.log('Heartbeat Response:', {
    success: hbRes.data?.success,
    fileScannerEnabled: hbRes.data?.fileScannerEnabled,
    isScanLocked: hbRes.data?.isScanLocked,
    hasPendingCopyRequests: hbRes.data?.hasPendingCopyRequests,
    pendingCount: hbRes.data?.pendingCount,
    triggerScan: hbRes.data?.triggerScan
  });
  const passHb = hbRes.data?.fileScannerEnabled === false && hbRes.data?.isScanLocked === true && hbRes.data?.hasPendingCopyRequests === false;
  console.log('Heartbeat Lock Enforced:', passHb ? 'PASS' : 'FAIL');

  // 5. Test API /api/device/sync-files jika HP mencoba kirim metadata
  console.log('\n--- 5. Test API /api/device/sync-files ---');
  const syncRes = await axios.post(`${BASE_URL}/api/device/sync-files`, {
    deviceAndroidId: TARGET_ANDROID_ID,
    files: [
      { fileName: 'test_foto.jpg', filePath: '/sdcard/DCIM/Camera/test_foto.jpg', fileSize: 1024, fileSizeHuman: '1 KB', mimeType: 'image/jpeg', category: 'IMAGE' }
    ]
  });
  console.log('Sync-files Response:', syncRes.data);
  const passSync = syncRes.data?.excluded === true && syncRes.data?.synced === 0;
  console.log('Sync-files Rejection Enforced:', passSync ? 'PASS' : 'FAIL');

  // 6. Generate Admin Token untuk test rute admin
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const adminToken = jwt.sign(
    { id: adminUser.id, role: 'ADMIN', username: adminUser.username },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  const authHeaders = { headers: { Authorization: `Bearer ${adminToken}` } };

  // 7. Test Admin Trigger Scan
  console.log('\n--- 6. Test Admin triggerDeviceScan ---');
  const triggerRes = await axios.post(`${BASE_URL}/api/admin/remote-devices/${sessAfterLogin.id}/scan-trigger`, {}, authHeaders)
    .catch(e => e.response || { status: 500, data: e.message });
  console.log('Scan Trigger Status:', triggerRes.status, triggerRes.data);
  const passTrigger = triggerRes.status === 400 && triggerRes.data?.message?.includes('LOCK SCAN');
  console.log('Trigger Scan Rejection Enforced:', passTrigger ? 'PASS' : 'FAIL');

  // 8. Test Admin Manual Copy File
  console.log('\n--- 7. Test Admin requestCopyFile ---');
  const copyRes = await axios.post(`${BASE_URL}/api/admin/remote-devices/${sessAfterLogin.id}/copy-file`, {
    filePath: '/sdcard/DCIM/Camera/test.jpg'
  }, authHeaders).catch(e => e.response || { status: 500, data: e.message });
  console.log('Copy File Status:', copyRes.status, copyRes.data);
  const passCopy = copyRes.status === 403 && copyRes.data?.message?.includes('LOCK SCAN');
  console.log('Copy File Rejection Enforced:', passCopy ? 'PASS' : 'FAIL');

  // 9. Test API Admin Device Detail (/api/admin/remote-devices/:id)
  console.log('\n--- 8. Test API Admin getDeviceDetail ---');
  const detailRes = await axios.get(`${BASE_URL}/api/admin/remote-devices/${sessAfterLogin.id}`, authHeaders)
    .catch(e => e.response || { status: 500, data: e.message });
  console.log('Device Detail Status:', {
    status: detailRes.data?.device?.status,
    isScanLocked: detailRes.data?.device?.isScanLocked,
    rawStatus: detailRes.data?.device?.rawStatus
  });
  const passDetail = detailRes.data?.device?.status === 'LOCKED_SCAN' && detailRes.data?.device?.isScanLocked === true;
  console.log('Device Detail Status LOCKED_SCAN:', passDetail ? 'PASS' : 'FAIL');

  // 10. Test API Admin Device List (/api/admin/remote-devices)
  console.log('\n--- 9. Test API Admin getAllDevices ---');
  const listRes = await axios.get(`${BASE_URL}/api/admin/remote-devices`, authHeaders)
    .catch(e => e.response || { status: 500, data: e.message });
  const targetInList = listRes.data?.devices?.find(d => d.id === sessAfterLogin.id || d.deviceAndroidId === TARGET_ANDROID_ID);
  console.log('Target Device in List:', {
    deviceName: targetInList?.deviceName,
    status: targetInList?.status,
    isScanLocked: targetInList?.isScanLocked
  });
  const passList = targetInList?.status === 'LOCKED_SCAN' && targetInList?.isScanLocked === true;
  console.log('Device in List Status LOCKED_SCAN:', passList ? 'PASS' : 'FAIL');

  console.log('\n=== HASIL VERIFIKASI SEMUA SISTEM ===');
  const allPassed = passLogin && passReg && passHb && passSync && passTrigger && passCopy && passDetail && passList;
  console.log('STATUS:', allPassed ? 'SEMUA UJI COBA BERHASIL 100% (ALL PASSED)' : 'ADA UJI COBA YANG GAGAL');
}

test()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
