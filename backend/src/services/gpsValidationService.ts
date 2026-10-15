import prisma from '../utils/db';
import { getDistanceFromLatLonInMeters } from '../utils/haversine';

export interface GpsValidationInput {
  userId: string;
  lat?: number | null;
  lng?: number | null;
  accuracyMeters?: number | null;
  mockLocationDetected?: boolean;
  isRooted?: boolean;
  isDevModeActive?: boolean;
  wifiSsid?: string | null;
  scheduleId?: string | null;
  classId?: string | null;
}

export interface GpsValidationResult {
  isValid: boolean;
  statusVerifikasi: 'AUTO' | 'VERIFIED' | 'REJECTED' | 'FLAGGED' | 'PENDING';
  jarakKeSekolah: number | null;
  geofenceZoneId: string | null;
  geofenceZoneName: string | null;
  notes: string;
  warning?: string;
  isMockGps: boolean;
  geofenceBypassed: boolean;
}

// Helper untuk membaca nilai setting dari SystemSetting
async function getSettingValue(key: string, defaultValue: string = ''): Promise<string> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    return row ? row.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

async function getSettingBoolean(key: string, defaultBool: boolean = true): Promise<boolean> {
  const val = await getSettingValue(key, defaultBool ? 'true' : 'false');
  return val === 'true' || val === '1';
}

/**
 * Validasi GPS Geofence Berlapis SIBOY:
 * 1. Master Toggle Geofence (Bisa diaktifkan/nonaktifkan dari Portal)
 * 2. Deteksi Mock/Fake GPS, Root, Dev Mode
 * 3. Threshold Akurasi Satelit (Min accuracy & Reject threshold)
 * 4. Multi-Zone Geofence (Radius Base + Buffer Toleransi Indoor Drift)
 * 5. Pencatatan Otomatis ke AttendanceAnomalyLog jika anomali
 */
export async function validateGpsAttendance(input: GpsValidationInput): Promise<GpsValidationResult> {
  const {
    userId,
    lat,
    lng,
    accuracyMeters = null,
    mockLocationDetected = false,
    isRooted = false,
    isDevModeActive = false,
    wifiSsid = null,
    scheduleId = null
  } = input;

  // 1. CEK MASTER TOGGLE GEOFENCE
  const masterGeofenceEnabled = await getSettingBoolean('feature.geofence.enabled', true);

  if (!masterGeofenceEnabled) {
    return {
      isValid: true,
      statusVerifikasi: 'AUTO',
      jarakKeSekolah: (lat != null && lng != null) ? 0 : null,
      geofenceZoneId: null,
      geofenceZoneName: 'GEOFENCE_BYPASSED',
      notes: 'Presensi diterima (Geofence dinonaktifkan secara terpusat via Portal)',
      isMockGps: false,
      geofenceBypassed: true
    };
  }

  // 2. CEK ANTI-FRAUD: FAKE / MOCK GPS
  if (mockLocationDetected) {
    const antiFakeGpsEnabled = await getSettingBoolean('feature.scanner.antiFakeGps', true);
    if (antiFakeGpsEnabled) {
      try {
        await prisma.attendanceAnomalyLog.create({
          data: {
            userId,
            jenisAnomali: 'MOCK_LOCATION',
            detail: JSON.stringify({
              lat,
              lng,
              accuracyMeters,
              scheduleId,
              timestamp: new Date().toISOString()
            }),
            statusReview: 'PENDING'
          }
        });
      } catch (err) {
        console.error('Error logging MOCK_LOCATION anomaly:', err);
      }

      return {
        isValid: false,
        statusVerifikasi: 'REJECTED',
        jarakKeSekolah: null,
        geofenceZoneId: null,
        geofenceZoneName: null,
        notes: 'Aplikasi mendeteksi lokasi palsu (Fake/Mock GPS). Presensi ditolak otomatis!',
        isMockGps: true,
        geofenceBypassed: false
      };
    }
  }

  // Cek Root / Developer Mode
  if (isRooted || isDevModeActive) {
    try {
      await prisma.attendanceAnomalyLog.create({
        data: {
          userId,
          jenisAnomali: isRooted ? 'ROOT_DETECTED' : 'DEV_MODE',
          detail: JSON.stringify({ isRooted, isDevModeActive, scheduleId }),
          statusReview: 'PENDING'
        }
      });
    } catch {}
  }

  // 3. JIKA KOORDINAT TIDAK TERSEDIA (GPS MATI / COLD START)
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    return {
      isValid: false,
      statusVerifikasi: 'FLAGGED',
      jarakKeSekolah: null,
      geofenceZoneId: null,
      geofenceZoneName: null,
      notes: 'Koordinat GPS tidak terdeteksi. Silakan aktifkan GPS akurasi tinggi atau scan QR kelas.',
      isMockGps: false,
      geofenceBypassed: false
    };
  }

  // 4. CEK THRESHOLD AKURASI GPS (METER)
  const rejectAboveAccuracy = parseFloat(await getSettingValue('gps.rejectAboveAccuracy', '100'));
  const minAccuracyMeters = parseFloat(await getSettingValue('gps.minAccuracyMeters', '50'));

  if (accuracyMeters != null && accuracyMeters > rejectAboveAccuracy) {
    try {
      await prisma.attendanceAnomalyLog.create({
        data: {
          userId,
          jenisAnomali: 'GPS_DEGRADED',
          detail: JSON.stringify({
            accuracyMeters,
            rejectAboveAccuracy,
            lat,
            lng,
            scheduleId
          }),
          statusReview: 'PENDING'
        }
      });
    } catch {}

    return {
      isValid: false,
      statusVerifikasi: 'FLAGGED',
      jarakKeSekolah: null,
      geofenceZoneId: null,
      geofenceZoneName: null,
      notes: `Akurasi sinyal GPS terlalu lemah (±${Math.round(accuracyMeters)}m > ${rejectAboveAccuracy}m). Silakan tunggu penguncian satelit di area terbuka.`,
      warning: 'GPS_ACCURACY_LOW',
      isMockGps: false,
      geofenceBypassed: false
    };
  }

  // 5. EVALUASI MULTI-ZONA GEOFENCE
  const multiZoneEnabled = await getSettingBoolean('feature.geofence.multiZone', true);
  let activeZones: any[] = [];

  if (multiZoneEnabled) {
    try {
      activeZones = await prisma.roomGeofence.findMany({
        where: { isActive: true },
        orderBy: [{ zonePriority: 'asc' }, { radiusMeters: 'desc' }]
      });
    } catch (e) {
      console.error('Error fetching active geofence zones:', e);
    }
  }

  // Jika tidak ada zona spesifik, gunakan Titik Pusat Sekolah Global
  if (activeZones.length === 0) {
    const schoolLat = parseFloat(await getSettingValue('gps.school.lat', '-8.125157'));
    const schoolLng = parseFloat(await getSettingValue('gps.school.lng', '111.893912'));
    const globalRadius = parseFloat(await getSettingValue('gps.radius.global', '150'));
    const defaultBuffer = parseFloat(await getSettingValue('gps.buffer.default', '30'));

    activeZones = [{
      id: 'default_school_campus',
      roomName: 'Kampus SMPN 1 Boyolangu (Global)',
      latCenter: schoolLat,
      longCenter: schoolLng,
      radiusMeters: globalRadius,
      bufferMeters: defaultBuffer,
      validWifiSsid: null
    }];
  }

  // Hitung jarak ke setiap zona aktif, cari zona terdekat
  let nearestZone = activeZones[0];
  let minDistance = Infinity;

  for (const zone of activeZones) {
    const dist = getDistanceFromLatLonInMeters(lat, lng, zone.latCenter, zone.longCenter);
    if (dist < minDistance) {
      minDistance = dist;
      nearestZone = zone;
    }
  }

  const roundedDistance = Math.round(minDistance * 10) / 10;
  const baseRadius = nearestZone.radiusMeters || 50.0;
  const bufferMeters = nearestZone.bufferMeters || 30.0;
  const totalAllowedDistance = baseRadius + bufferMeters;

  // Skenario A: Masuk dalam Base Radius Murni (Sangat Akurat)
  if (minDistance <= baseRadius) {
    return {
      isValid: true,
      statusVerifikasi: 'AUTO',
      jarakKeSekolah: roundedDistance,
      geofenceZoneId: nearestZone.id,
      geofenceZoneName: nearestZone.roomName,
      notes: `Presensi Valid: Berada di dalam radius zona ${nearestZone.roomName} (${roundedDistance}m <= ${baseRadius}m)`,
      isMockGps: false,
      geofenceBypassed: false
    };
  }

  // Skenario B: Masuk dalam Buffer Toleransi Indoor Drift (Misal dalam gedung kelas beton)
  if (minDistance <= totalAllowedDistance) {
    return {
      isValid: true,
      statusVerifikasi: 'AUTO',
      jarakKeSekolah: roundedDistance,
      geofenceZoneId: nearestZone.id,
      geofenceZoneName: nearestZone.roomName,
      notes: `Presensi Diterima: Berada dalam batas toleransi buffer indoor (${roundedDistance}m <= ${totalAllowedDistance}m)`,
      warning: 'IN_BUFFER_ZONE',
      isMockGps: false,
      geofenceBypassed: false
    };
  }

  // Skenario C: Di luar radius + buffer
  // Cek apakah terhubung ke WiFi resmi sekolah (Fallback lapis 2)
  if (nearestZone.validWifiSsid && wifiSsid && wifiSsid === nearestZone.validWifiSsid) {
    return {
      isValid: true,
      statusVerifikasi: 'VERIFIED',
      jarakKeSekolah: roundedDistance,
      geofenceZoneId: nearestZone.id,
      geofenceZoneName: nearestZone.roomName,
      notes: `Tervalidasi via WiFi Resmi Sekolah (${wifiSsid}) meskipun GPS meleset ${roundedDistance}m`,
      warning: 'WIFI_OVERRIDE',
      isMockGps: false,
      geofenceBypassed: false
    };
  }

  // Skenario D: Di luar radius sekolah -> Tandai sebagai FLAGGED untuk antrean verifikasi operator
  try {
    await prisma.attendanceAnomalyLog.create({
      data: {
        userId,
        jenisAnomali: 'GEOFENCE_VIOLATION',
        detail: JSON.stringify({
          distanceMeters: roundedDistance,
          maxAllowed: totalAllowedDistance,
          baseRadius,
          bufferMeters,
          nearestZone: nearestZone.roomName,
          userCoords: { lat, lng },
          accuracyMeters
        }),
        statusReview: 'PENDING'
      }
    });
  } catch (err) {
    console.error('Error logging GEOFENCE_VIOLATION:', err);
  }

  return {
    isValid: false,
    statusVerifikasi: 'FLAGGED',
    jarakKeSekolah: roundedDistance,
    geofenceZoneId: nearestZone.id,
    geofenceZoneName: nearestZone.roomName,
    notes: `Di luar area sekolah: Berjarak ${roundedDistance}m dari ${nearestZone.roomName} (Batas maksimal ${totalAllowedDistance}m). Memerlukan verifikasi operator.`,
    warning: 'OUTSIDE_GEOFENCE',
    isMockGps: false,
    geofenceBypassed: false
  };
}
