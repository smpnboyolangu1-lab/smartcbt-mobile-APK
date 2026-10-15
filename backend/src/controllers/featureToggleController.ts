import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_FEATURE_SETTINGS } from "../scripts/seedFeatureFlags";

const prisma = new PrismaClient();

// Helper untuk mengambil setting bertipe string atau default
async function getSettingValue(key: string, defaultValue: string = ""): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? row.value : defaultValue;
}

// Helper untuk mengambil boolean setting
async function getSettingBoolean(key: string, defaultBool: boolean = true): Promise<boolean> {
  const val = await getSettingValue(key, defaultBool ? "true" : "false");
  return val === "true" || val === "1";
}

/**
 * GET /api/admin/feature-panel
 * Mengembalikan data lengkap seluruh fitur, GPS geofence, dan jam server
 */
export const getFeaturePanelData = async (req: Request, res: Response) => {
  try {
    const allSettings = await prisma.systemSetting.findMany();
    const settingsMap = new Map<string, string>();
    allSettings.forEach(s => settingsMap.set(s.key, s.value));

    // Pastikan fallback default jika belum ter-seed
    const featuresList = DEFAULT_FEATURE_SETTINGS.map(item => {
      const currentVal = settingsMap.has(item.key) ? settingsMap.get(item.key)! : item.value;
      return {
        key: item.key,
        value: item.type === "boolean" ? (currentVal === "true" || currentVal === "1") : currentVal,
        type: item.type,
        description: item.description
      };
    });

    // Grupkan Fitur
    const apkFeatures = featuresList.filter(f => f.key.startsWith("feature.scanner") || f.key.startsWith("feature.apk") || f.key.startsWith("feature.auth") || f.key.startsWith("feature.attendance.offline") || f.key.startsWith("feature.remote"));
    const schoolModules = featuresList.filter(f => f.key.startsWith("feature.") && !apkFeatures.some(af => af.key === f.key));
    const gpsSettings = featuresList.filter(f => f.key.startsWith("gps."));

    // Ambil Jam Server Saat Ini (WIB Asia/Jakarta)
    const now = new Date();
    const serverTimeWib = now.toLocaleTimeString("sv-SE", { timeZone: "Asia/Jakarta" }).substring(0, 5);
    const serverDateWib = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

    // Ambil Log Perubahan Terakhir dari AuditLog
    const recentLogs = await prisma.auditLog.findMany({
      where: { action: { startsWith: "FEATURE_TOGGLE" } },
      orderBy: { createdAt: "desc" },
      take: 10
    });

    res.json({
      success: true,
      apkFeatures,
      schoolModules,
      gpsSettings,
      serverTime: {
        iso: now.toISOString(),
        wibTime: serverTimeWib,
        wibDate: serverDateWib,
        timezone: "Asia/Jakarta (WIB)"
      },
      recentLogs
    });
  } catch (error: any) {
    console.error("Error getFeaturePanelData:", error);
    res.status(500).json({ success: false, message: "Gagal memuat data Feature Control Panel: " + error.message });
  }
};

/**
 * PUT /api/admin/feature-panel/:key
 * Mengubah status aktif / nonaktif satu fitur
 */
export const toggleFeatureKey = async (req: Request, res: Response) => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : String(req.params.key || '');
    const { value, reason } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({ success: false, message: "Nilai fitur (value) wajib diisi." });
    }

    const strValue = typeof value === "boolean" ? (value ? "true" : "false") : String(value);

    // Upsert ke SystemSetting
    const updated = await prisma.systemSetting.upsert({
      where: { key },
      update: { value: strValue },
      create: { key, value: strValue, type: typeof value === "boolean" ? "boolean" : "string" }
    });

    // Sinkronkan kompatibilitas balik ke tabel Settings legacy jika relevan
    if (key === "feature.evoting.enabled") {
      await prisma.settings.upsert({
        where: { key: "module_evoting_active" },
        update: { value: strValue },
        create: { key: "module_evoting_active", value: strValue }
      });
    } else if (key === "feature.form.biodata") {
      await prisma.systemSetting.upsert({
        where: { key: "student_biodata_submission_active" },
        update: { value: strValue },
        create: { key: "student_biodata_submission_active", value: strValue, type: "boolean" }
      });
    }

    // Catat ke AuditLog
    const user = (req as any).user;
    const operatorName = user?.name || user?.username || "Admin/Operator";
    await prisma.auditLog.create({
      data: {
        userId: user?.id || null,
        userName: operatorName,
        role: user?.role || "OPERATOR",
        action: `FEATURE_TOGGLE:${key}`,
        target: key,
        details: JSON.stringify({
          newValue: strValue,
          reason: reason || "Diubah via Unified Feature Control Panel",
          updatedAt: new Date().toISOString()
        }),
        ipAddress: req.ip || "127.0.0.1"
      }
    });

    res.json({
      success: true,
      message: `✅ Fitur '${key}' berhasil diperbarui menjadi: ${strValue}`,
      setting: updated
    });
  } catch (error: any) {
    console.error("Error toggleFeatureKey:", error);
    res.status(500).json({ success: false, message: "Gagal menyimpan perubahan fitur: " + error.message });
  }
};

/**
 * PUT /api/attendance/gps-config
 * Mengubah titik pusat koordinat sekolah, radius toleransi global, dan batas zona akurasi
 */
export const updateGpsConfig = async (req: Request, res: Response) => {
  try {
    const { lat, lng, radiusGlobal, zoneGood, zoneDegraded, countdownSeconds } = req.body;

    const updates = [];
    if (lat !== undefined) {
      updates.push(prisma.systemSetting.upsert({
        where: { key: "gps.school.lat" },
        update: { value: String(lat) },
        create: { key: "gps.school.lat", value: String(lat), type: "string" }
      }));
    }
    if (lng !== undefined) {
      updates.push(prisma.systemSetting.upsert({
        where: { key: "gps.school.lng" },
        update: { value: String(lng) },
        create: { key: "gps.school.lng", value: String(lng), type: "string" }
      }));
    }
    if (radiusGlobal !== undefined) {
      updates.push(prisma.systemSetting.upsert({
        where: { key: "gps.radius.global" },
        update: { value: String(radiusGlobal) },
        create: { key: "gps.radius.global", value: String(radiusGlobal), type: "string" }
      }));
    }
    if (zoneGood !== undefined) {
      updates.push(prisma.systemSetting.upsert({
        where: { key: "gps.accuracy.zone_good" },
        update: { value: String(zoneGood) },
        create: { key: "gps.accuracy.zone_good", value: String(zoneGood), type: "string" }
      }));
    }
    if (zoneDegraded !== undefined) {
      updates.push(prisma.systemSetting.upsert({
        where: { key: "gps.accuracy.zone_degraded" },
        update: { value: String(zoneDegraded) },
        create: { key: "gps.accuracy.zone_degraded", value: String(zoneDegraded), type: "string" }
      }));
    }
    if (countdownSeconds !== undefined) {
      updates.push(prisma.systemSetting.upsert({
        where: { key: "gps.countdown_seconds" },
        update: { value: String(countdownSeconds) },
        create: { key: "gps.countdown_seconds", value: String(countdownSeconds), type: "string" }
      }));
    }

    await Promise.all(updates);

    // Audit Log
    const user = (req as any).user;
    await prisma.auditLog.create({
      data: {
        userId: user?.id || null,
        userName: user?.name || user?.username || "Admin/Operator",
        role: user?.role || "OPERATOR",
        action: "FEATURE_TOGGLE:GPS_CONFIG",
        target: "GPS & Geofence Sekolah",
        details: JSON.stringify({ lat, lng, radiusGlobal, zoneGood, zoneDegraded, countdownSeconds }),
        ipAddress: req.ip || "127.0.0.1"
      }
    });

    res.json({
      success: true,
      message: "✅ Titik koordinat dan toleransi geofence sekolah berhasil diperbarui secara permanen!"
    });
  } catch (error: any) {
    console.error("Error updateGpsConfig:", error);
    res.status(500).json({ success: false, message: "Gagal menyimpan konfigurasi GPS: " + error.message });
  }
};

/**
 * GET /api/attendance/config
 * Endpoint publik untuk APK ScannerActivity & StudentMainActivity saat startup
 */
export const getAttendanceConfig = async (req: Request, res: Response) => {
  try {
    const [
      geolocationEnabled,
      masterGeofenceEnabled,
      antiFakeGps,
      antiRoot,
      latStr,
      lngStr,
      radiusStr,
      zoneGoodStr,
      zoneDegradedStr,
      countdownStr,
      clockDriftStr,
      kalmanFilter,
      averaging,
      sampleCountStr,
      intervalMsStr,
      minAccuracyStr,
      rejectAboveStr,
      bufferDefaultStr,
      requireHighAccuracy,
      showAccuracyToUser,
      multiZone
    ] = await Promise.all([
      getSettingBoolean("feature.scanner.geolocation", true),
      getSettingBoolean("feature.geofence.enabled", true),
      getSettingBoolean("feature.scanner.antiFakeGps", true),
      getSettingBoolean("feature.scanner.antiRoot", true),
      getSettingValue("gps.school.lat", "-8.125157"),
      getSettingValue("gps.school.lng", "111.893912"),
      getSettingValue("gps.radius.global", "150"),
      getSettingValue("gps.accuracy.zone_good", "50"),
      getSettingValue("gps.accuracy.zone_degraded", "100"),
      getSettingValue("gps.countdown_seconds", "60"),
      getSettingValue("attendance.clock_drift_limit_minutes", "5"),
      getSettingBoolean("feature.gps.kalmanFilter", true),
      getSettingBoolean("feature.gps.averaging", true),
      getSettingValue("gps.averaging.sampleCount", "5"),
      getSettingValue("gps.averaging.intervalMs", "600"),
      getSettingValue("gps.minAccuracyMeters", "50"),
      getSettingValue("gps.rejectAboveAccuracy", "100"),
      getSettingValue("gps.buffer.default", "30"),
      getSettingBoolean("feature.gps.requireHighAccuracy", true),
      getSettingBoolean("feature.gps.showAccuracyToUser", true),
      getSettingBoolean("feature.geofence.multiZone", true)
    ]);

    const now = new Date();
    const serverTimeWib = now.toLocaleTimeString("sv-SE", { timeZone: "Asia/Jakarta" }).substring(0, 5);

    // Ambil seluruh zona geofence aktif
    const activeZones = await prisma.roomGeofence.findMany({
      where: { isActive: true },
      orderBy: [{ zonePriority: 'asc' }, { radiusMeters: 'desc' }]
    });

    // Ambil seluruh barcode kelas aktif untuk fallback QR statis di ruang kelas
    const classes = await prisma.class.findMany({
      select: {
        id: true,
        name: true,
        barcodeCode: true,
        gateInBarcode: true,
        gateOutBarcode: true,
        lat: true,
        lng: true,
        radiusMeters: true,
        isGpsLocked: true
      }
    });

    res.json({
      success: true,
      scannerGeolocationEnabled: geolocationEnabled,
      geofenceEnabled: masterGeofenceEnabled,
      antiFakeGps,
      antiRoot,
      school: {
        name: "SMPN 1 Boyolangu",
        lat: parseFloat(latStr) || -8.125157,
        lng: parseFloat(lngStr) || 111.893912,
        radiusMeters: parseInt(radiusStr) || 150,
        bufferMeters: parseInt(bufferDefaultStr) || 30
      },
      gpsThresholds: {
        zoneGood: parseFloat(zoneGoodStr) || 50,
        zoneDegraded: parseFloat(zoneDegradedStr) || 100,
        countdownSeconds: parseInt(countdownStr) || 60
      },
      gpsEnhancement: {
        kalmanFilterEnabled: kalmanFilter,
        averagingEnabled: averaging,
        sampleCount: parseInt(sampleCountStr) || 5,
        intervalMs: parseInt(intervalMsStr) || 600,
        minAccuracyMeters: parseFloat(minAccuracyStr) || 50,
        rejectAboveAccuracy: parseFloat(rejectAboveStr) || 100,
        bufferDefault: parseFloat(bufferDefaultStr) || 30,
        requireHighAccuracy,
        showAccuracyToUser,
        multiZoneEnabled: multiZone
      },
      geofenceZones: activeZones.map(z => ({
        id: z.id,
        name: z.roomName,
        lat: z.latCenter,
        lng: z.longCenter,
        radiusMeters: z.radiusMeters,
        bufferMeters: z.bufferMeters,
        zonePriority: z.zonePriority,
        zoneType: z.zoneType,
        validWifiSsid: z.validWifiSsid
      })),
      clockDriftLimitMinutes: parseInt(clockDriftStr) || 5,
      serverTime: now.toISOString(),
      serverTimeWib,
      timezone: "Asia/Jakarta",
      classes
    });
  } catch (error: any) {
    console.error("Error getAttendanceConfig:", error);
    res.status(500).json({ success: false, message: "Gagal memuat konfigurasi presensi: " + error.message });
  }
};

/**
 * GET /api/features
 * Mengembalikan key-value map sederhana seluruh feature flag untuk APK
 */
export const getAllFeatureFlagsMap = async (req: Request, res: Response) => {
  try {
    const allSettings = await prisma.systemSetting.findMany();
    const flags: Record<string, any> = {};

    // Isi dari default jika belum ada di database
    DEFAULT_FEATURE_SETTINGS.forEach(item => {
      flags[item.key] = item.type === "boolean" ? (item.value === "true") : item.value;
    });

    // Timpa dengan data nyata database
    allSettings.forEach(s => {
      if (s.type === "boolean") {
        flags[s.key] = s.value === "true" || s.value === "1";
      } else {
        flags[s.key] = s.value;
      }
    });

    res.json({
      success: true,
      features: flags,
      serverTimestamp: Date.now()
    });
  } catch (error: any) {
    console.error("Error getAllFeatureFlagsMap:", error);
    res.status(500).json({ success: false, message: "Gagal memuat daftar fitur: " + error.message });
  }
};
