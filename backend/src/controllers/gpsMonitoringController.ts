import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * GET /api/monitoring/gps-map
 * Data untuk Leaflet Map real-time:
 * 1. Seluruh zona geofence aktif (center + radius + buffer)
 * 2. Seluruh absensi hari ini yang memiliki koordinat GPS
 */
export const getGpsMonitoringMap = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    // Ambil zona geofence aktif
    const zones = await prisma.roomGeofence.findMany({
      where: { isActive: true },
      orderBy: { zonePriority: 'asc' }
    });

    // Ambil data absensi hari ini dengan koordinat
    const attendances = await prisma.attendance.findMany({
      where: {
        scanTime: { gte: startOfDay, lt: endOfDay },
        lat: { not: null },
        lng: { not: null }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            className: true,
            role: true,
            profilePicUrl: true
          }
        }
      },
      orderBy: { scanTime: 'desc' },
      take: 500
    });

    const formatToWib = (date: Date | string | null | undefined): string => {
      if (!date) return '-';
      const d = new Date(date);
      if (isNaN(d.getTime())) return String(date);
      // Kolom scanTime menyimpan timestamp lokal tanpa timezone.
      // UTC methods mengambil jam/menit asli yang tersimpan tanpa double shift +7 jam.
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      return `${hh}.${mm}.${ss} WIB`;
    };

    // Mapped attendance pins dengan indikator warna
    const pins = attendances.map(a => {
      let pinColor = 'GREEN'; // Dalam radius base
      if (a.isFakeGps || a.statusVerifikasi === 'REJECTED') {
        pinColor = 'RED';
      } else if (a.statusVerifikasi === 'FLAGGED') {
        pinColor = 'ORANGE';
      } else if (a.note && a.note.includes('toleransi buffer')) {
        pinColor = 'YELLOW';
      }

      return {
        id: a.id,
        userId: a.userId,
        userName: a.user?.name || a.userId,
        nisn: a.user?.username || '-',
        className: a.user?.className || '-',
        role: a.user?.role || 'STUDENT',
        lat: a.lat,
        lng: a.lng,
        accuracyMeters: a.accuracyMeters || 10,
        jarakKeSekolah: a.jarakKeSekolah || 0,
        zoneName: a.geofenceZoneName || 'Kampus Utama',
        scanTime: a.scanTime,
        timeFormatted: formatToWib(a.scanTime),
        status: a.status,
        type: a.type,
        method: a.method,
        statusVerifikasi: a.statusVerifikasi,
        kalmanApplied: a.kalmanApplied,
        isFakeGps: a.isFakeGps,
        pinColor,
        note: a.note
      };
    });

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      zones,
      pins,
      stats: {
        totalPins: pins.length,
        greenPins: pins.filter(p => p.pinColor === 'GREEN').length,
        yellowPins: pins.filter(p => p.pinColor === 'YELLOW').length,
        orangePins: pins.filter(p => p.pinColor === 'ORANGE').length,
        redPins: pins.filter(p => p.pinColor === 'RED').length
      }
    });
  } catch (error: any) {
    console.error('Error in getGpsMonitoringMap:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/monitoring/gps-anomalies
 * Daftar presensi yang membutuhkan review operator (FLAGGED / PENDING / REJECTED)
 */
export const getGpsAnomalies = async (req: Request, res: Response) => {
  try {
    const { status, limit = 50 } = req.query;

    const whereClause: any = {
      OR: [
        { statusVerifikasi: { in: ['FLAGGED', 'PENDING', 'REJECTED'] } },
        { isFakeGps: true }
      ]
    };

    if (status && typeof status === 'string' && status !== 'ALL') {
      whereClause.statusVerifikasi = status;
    }

    const anomalies = await prisma.attendance.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            className: true,
            role: true
          }
        }
      },
      orderBy: { scanTime: 'desc' },
      take: parseInt(String(limit)) || 50
    });

    const formatToWib = (date: Date | string | null | undefined): string => {
      if (!date) return '-';
      const d = new Date(date);
      if (isNaN(d.getTime())) return String(date);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      return `${hh}.${mm}.${ss} WIB`;
    };

    const formattedAnomalies = anomalies.map(a => ({
      ...a,
      timeFormatted: formatToWib(a.scanTime)
    }));

    return res.json({
      success: true,
      count: formattedAnomalies.length,
      data: formattedAnomalies
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/monitoring/gps-verify/:id
 * Operator menyetujui (APPROVE) atau menolak (REJECT) presensi anomali
 */
export const verifyGpsAttendance = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const { action, notes } = req.body; // action: 'APPROVE' | 'REJECT'

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action harus APPROVE atau REJECT.' });
    }

    const attendance = await prisma.attendance.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!attendance) {
      return res.status(404).json({ success: false, message: 'Data presensi tidak ditemukan.' });
    }

    const user = (req as any).user;
    const operatorName = user?.name || user?.username || 'Operator Admin';

    const newStatusVerifikasi = action === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
    const newAttendanceStatus = action === 'APPROVE' ? 'PRESENT' : 'ABSENT';

    const updated = await prisma.attendance.update({
      where: { id },
      data: {
        statusVerifikasi: newStatusVerifikasi,
        status: newAttendanceStatus,
        verifiedBy: operatorName,
        verifiedAt: new Date(),
        catatanVerifikasi: notes || (action === 'APPROVE' ? 'Disetujui secara manual oleh Operator' : 'Ditolak secara manual oleh Operator')
      }
    });

    // Catat ke AuditLog
    await prisma.auditLog.create({
      data: {
        userId: user?.id || null,
        userName: operatorName,
        role: user?.role || 'OPERATOR',
        action: `GPS_VERIFY_${action}`,
        target: `Attendance: ${attendance.user?.name || attendance.userId}`,
        details: JSON.stringify({
          attendanceId: id,
          action,
          notes,
          oldStatus: attendance.statusVerifikasi,
          newStatus: newStatusVerifikasi,
          distanceMeters: attendance.jarakKeSekolah,
          accuracyMeters: attendance.accuracyMeters
        }),
        ipAddress: req.ip || '127.0.0.1'
      }
    });

    return res.json({
      success: true,
      message: `Presensi berhasil ${action === 'APPROVE' ? 'disetujui (VALID)' : 'ditolak (ALPA)'}.`,
      data: updated
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/monitoring/gps-stats
 * Ringkasan statistik GPS hari ini
 */
export const getGpsStats = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const todayAttendances = await prisma.attendance.findMany({
      where: {
        scanTime: { gte: startOfDay },
        method: 'GPS'
      },
      select: {
        id: true,
        statusVerifikasi: true,
        jarakKeSekolah: true,
        accuracyMeters: true,
        kalmanApplied: true,
        isFakeGps: true
      }
    });

    const total = todayAttendances.length;
    const valid = todayAttendances.filter(a => a.statusVerifikasi === 'AUTO' || a.statusVerifikasi === 'VERIFIED').length;
    const flagged = todayAttendances.filter(a => a.statusVerifikasi === 'FLAGGED' || a.statusVerifikasi === 'PENDING').length;
    const rejected = todayAttendances.filter(a => a.statusVerifikasi === 'REJECTED' || a.isFakeGps).length;
    const kalmanCount = todayAttendances.filter(a => a.kalmanApplied).length;

    // Rata-rata akurasi & jarak
    const accList = todayAttendances.map(a => a.accuracyMeters).filter((a): a is number => a != null);
    const avgAccuracy = accList.length > 0 ? Math.round((accList.reduce((x, y) => x + y, 0) / accList.length) * 10) / 10 : 0;

    const distList = todayAttendances.map(a => a.jarakKeSekolah).filter((d): d is number => d != null);
    const avgDistance = distList.length > 0 ? Math.round((distList.reduce((x, y) => x + y, 0) / distList.length) * 10) / 10 : 0;

    return res.json({
      success: true,
      stats: {
        total,
        valid,
        flagged,
        rejected,
        kalmanCount,
        avgAccuracyMeters: avgAccuracy,
        avgDistanceMeters: avgDistance,
        validPercentage: total > 0 ? Math.round((valid / total) * 100) : 100
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/monitoring/mock-location
 * Log riwayat deteksi Fake GPS
 */
export const getMockLocationLog = async (req: Request, res: Response) => {
  try {
    const logs = await prisma.attendanceAnomalyLog.findMany({
      where: { jenisAnomali: 'MOCK_LOCATION' },
      orderBy: { waktu: 'desc' },
      take: 100
    });

    return res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/monitoring/gps-heatmap
 * Data titik koordinat untuk layer Heatmap Leaflet
 */
export const getGpsHeatmap = async (req: Request, res: Response) => {
  try {
    const points = await prisma.attendance.findMany({
      where: {
        lat: { not: null },
        lng: { not: null },
        isFakeGps: false
      },
      select: {
        lat: true,
        lng: true,
        accuracyMeters: true
      },
      take: 2000
    });

    const heatmapData = points.map(p => {
      // Bobot intensitas lebih tinggi jika akurasinya lebih presisi
      const intensity = p.accuracyMeters ? Math.max(0.2, Math.min(1.0, 50 / p.accuracyMeters)) : 0.5;
      return [p.lat, p.lng, intensity];
    });

    return res.json({
      success: true,
      count: heatmapData.length,
      data: heatmapData
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/reports/gps
 * Data laporan komprehensif audit GPS
 */
export const getGpsReport = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, className, status } = req.query;

    const where: any = { method: 'GPS' };

    if (startDate || endDate) {
      where.scanTime = {};
      if (startDate) where.scanTime.gte = new Date(String(startDate));
      if (endDate) {
        const end = new Date(String(endDate));
        end.setHours(23, 59, 59, 999);
        where.scanTime.lte = end;
      }
    }

    if (status && status !== 'ALL') {
      where.statusVerifikasi = String(status);
    }

    const attendances = await prisma.attendance.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            className: true
          }
        }
      },
      orderBy: { scanTime: 'desc' },
      take: 1000
    });

    const filtered = (className && className !== 'ALL')
      ? attendances.filter(a => a.user?.className === String(className))
      : attendances;

    return res.json({
      success: true,
      count: filtered.length,
      data: filtered
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
