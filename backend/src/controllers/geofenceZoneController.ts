import { Request, Response } from 'express';
import prisma from '../utils/db';

export const DEFAULT_CAMPUS_ZONES = [
  {
    roomName: 'Gerbang Utama SIBOY',
    latCenter: -8.125410,
    longCenter: 111.893620,
    radiusMeters: 50.0,
    bufferMeters: 30.0,
    zonePriority: 1,
    zoneType: 'GERBANG',
    description: 'Pintu gerbang utama kedatangan siswa & staf pendidik'
  },
  {
    roomName: 'Gerbang Belakang & Parkir',
    latCenter: -8.125680,
    longCenter: 111.893250,
    radiusMeters: 45.0,
    bufferMeters: 25.0,
    zonePriority: 2,
    zoneType: 'GERBANG',
    description: 'Pintu gerbang barat dan area parkir sepeda motor staf'
  },
  {
    roomName: 'Lapangan Upacara & Olahraga',
    latCenter: -8.125157,
    longCenter: 111.893912,
    radiusMeters: 75.0,
    bufferMeters: 25.0,
    zonePriority: 1,
    zoneType: 'LAPANGAN',
    description: 'Pusat lapangan upacara bendera dan kegiatan outdoor'
  },
  {
    roomName: 'Gedung Kelas & Pembelajaran',
    latCenter: -8.125450,
    longCenter: 111.893450,
    radiusMeters: 65.0,
    bufferMeters: 35.0,
    zonePriority: 2,
    zoneType: 'KELAS',
    description: 'Kompleks ruang kelas 7, 8, dan 9 lantai 1 & 2'
  },
  {
    roomName: 'Aula & Laboratorium',
    latCenter: -8.125350,
    longCenter: 111.893600,
    radiusMeters: 45.0,
    bufferMeters: 35.0,
    zonePriority: 3,
    zoneType: 'AULA',
    description: 'Aula pertemuan sekolah dan lab komputer'
  },
  {
    roomName: 'Masjid Baitul Ilmi (Mushola)',
    latCenter: -8.1249085,
    longCenter: 111.8934869,
    radiusMeters: 60.0,
    bufferMeters: 30.0,
    zonePriority: 3,
    zoneType: 'MASJID',
    description: 'Titik koordinat resmi Mushola SMPN 1 Boyolangu untuk presensi sholat'
  }
];

/**
 * GET /api/geofence/zones
 * Ambil semua zona geofence (dengan auto-seed default jika kosong)
 */
export const getAllZones = async (req: Request, res: Response) => {
  try {
    let zones = await prisma.roomGeofence.findMany({
      orderBy: [{ zonePriority: 'asc' }, { roomName: 'asc' }]
    });

    // Auto-seed default campus zones jika masih kosong
    if (zones.length === 0) {
      for (const dz of DEFAULT_CAMPUS_ZONES) {
        await prisma.roomGeofence.create({
          data: {
            roomName: dz.roomName,
            latCenter: dz.latCenter,
            longCenter: dz.longCenter,
            radiusMeters: dz.radiusMeters,
            bufferMeters: dz.bufferMeters,
            zonePriority: dz.zonePriority,
            zoneType: dz.zoneType,
            description: dz.description,
            isActive: true
          }
        });
      }
      zones = await prisma.roomGeofence.findMany({
        orderBy: [{ zonePriority: 'asc' }, { roomName: 'asc' }]
      });
    }

    return res.json({
      success: true,
      count: zones.length,
      data: zones
    });
  } catch (error: any) {
    console.error('Error in getAllZones:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/geofence/zones/active
 * Ambil hanya zona geofence yang aktif (untuk sinkronisasi ke APK)
 */
export const getActiveZones = async (req: Request, res: Response) => {
  try {
    const zones = await prisma.roomGeofence.findMany({
      where: { isActive: true },
      orderBy: [{ zonePriority: 'asc' }, { radiusMeters: 'desc' }]
    });

    return res.json({
      success: true,
      count: zones.length,
      data: zones
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/geofence/zones
 * Tambah zona geofence baru
 */
export const createZone = async (req: Request, res: Response) => {
  try {
    const {
      roomName,
      latCenter,
      longCenter,
      radiusMeters = 50.0,
      bufferMeters = 30.0,
      validWifiSsid,
      zonePriority = 1,
      zoneType = 'KELAS',
      description,
      classId
    } = req.body;

    if (!roomName || latCenter == null || longCenter == null) {
      return res.status(400).json({
        success: false,
        message: 'Nama zona (roomName), latCenter, dan longCenter wajib diisi.'
      });
    }

    const created = await prisma.roomGeofence.create({
      data: {
        roomName,
        latCenter: parseFloat(latCenter),
        longCenter: parseFloat(longCenter),
        radiusMeters: parseFloat(radiusMeters),
        bufferMeters: parseFloat(bufferMeters),
        validWifiSsid: validWifiSsid || null,
        zonePriority: parseInt(zonePriority) || 1,
        zoneType: zoneType || 'KELAS',
        description: description || null,
        classId: classId || null,
        isActive: true
      }
    });

    return res.status(201).json({
      success: true,
      message: `Zona geofence "${roomName}" berhasil ditambahkan.`,
      data: created
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/geofence/zones/:id
 * Perbarui parameter zona geofence
 */
export const updateZone = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const {
      roomName,
      latCenter,
      longCenter,
      radiusMeters,
      bufferMeters,
      validWifiSsid,
      zonePriority,
      zoneType,
      description,
      isActive
    } = req.body;

    const data: any = {};
    if (roomName !== undefined) data.roomName = roomName;
    if (latCenter !== undefined) data.latCenter = parseFloat(latCenter);
    if (longCenter !== undefined) data.longCenter = parseFloat(longCenter);
    if (radiusMeters !== undefined) data.radiusMeters = parseFloat(radiusMeters);
    if (bufferMeters !== undefined) data.bufferMeters = parseFloat(bufferMeters);
    if (validWifiSsid !== undefined) data.validWifiSsid = validWifiSsid || null;
    if (zonePriority !== undefined) data.zonePriority = parseInt(zonePriority);
    if (zoneType !== undefined) data.zoneType = zoneType;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const updated = await prisma.roomGeofence.update({
      where: { id },
      data
    });

    if (updated.zoneType === 'MASJID' || updated.roomName.toLowerCase().includes('masjid') || updated.roomName.toLowerCase().includes('mushola')) {
      if (updated.latCenter != null) {
        await prisma.systemSetting.upsert({
          where: { key: 'gps.mushola.lat' },
          create: { key: 'gps.mushola.lat', value: String(updated.latCenter), type: 'string' },
          update: { value: String(updated.latCenter) }
        }).catch(() => {});
      }
      if (updated.longCenter != null) {
        await prisma.systemSetting.upsert({
          where: { key: 'gps.mushola.lng' },
          create: { key: 'gps.mushola.lng', value: String(updated.longCenter), type: 'string' },
          update: { value: String(updated.longCenter) }
        }).catch(() => {});
      }
      if (updated.radiusMeters != null) {
        await prisma.systemSetting.upsert({
          where: { key: 'gps.mushola.radius' },
          create: { key: 'gps.mushola.radius', value: String(updated.radiusMeters), type: 'string' },
          update: { value: String(updated.radiusMeters) }
        }).catch(() => {});
      }
    }

    return res.json({
      success: true,
      message: `Zona "${updated.roomName}" berhasil diperbarui.`,
      data: updated
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/geofence/zones/:id/toggle
 * Aktifkan / Nonaktifkan zona geofence tertentu
 */
export const toggleZone = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    const zone = await prisma.roomGeofence.findUnique({ where: { id } });

    if (!zone) {
      return res.status(404).json({ success: false, message: 'Zona geofence tidak ditemukan.' });
    }

    const updated = await prisma.roomGeofence.update({
      where: { id },
      data: { isActive: !zone.isActive }
    });

    return res.json({
      success: true,
      message: `Zona "${updated.roomName}" sekarang ${updated.isActive ? 'AKTIF' : 'NONAKTIF'}.`,
      data: updated
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/geofence/zones/:id
 * Hapus zona geofence
 */
export const deleteZone = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || '');
    await prisma.roomGeofence.delete({ where: { id } });

    return res.json({
      success: true,
      message: 'Zona geofence berhasil dihapus.'
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
