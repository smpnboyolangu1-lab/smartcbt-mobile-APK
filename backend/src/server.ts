import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { classifyFolder } from "./utils/folderClassifier";
import { initMasterSchedulers } from "./services/systemScheduler";
import { initKurikulumScheduler } from "./services/kurikulumScheduler";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" },
  pingTimeout: 30000,
  pingInterval: 10000
});
app.set("io", io);

io.on("connection", (socket) => {
  socket.on("join_room", (room) => {
    socket.join(room);
  });
});

const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;


/** Safe BigInt → Number conversion untuk JSON/EJS serialization */
function safeNumber(val: any): number | null {
  if (val == null) return null;
  try { return Number(val); } catch { return null; }
}

app.use(cors());
app.use(express.json({ limit: "150mb" }));
app.use(express.urlencoded({ limit: "150mb", extended: true }));

// Setup EJS for Web Portal
app.set("view engine", "ejs");
const candidateViewDirs = [
  path.join(process.cwd(), "src/views"),
  path.join(process.cwd(), "backend/src/views"),
  path.join(__dirname, "../src/views"),
  path.join(__dirname, "views"),
  path.join(process.cwd(), "dist/views"),
  path.join(process.cwd(), "backend/dist/views")
];
const resolvedViewsDir = candidateViewDirs.find(d => fs.existsSync(d)) || path.join(__dirname, "views");
app.set("views", resolvedViewsDir);

// Explicit route for APK download with correct Android Package headers
app.get([
  '/uploads/SmartSchool_CBT_Release.apk',
  '/SmartSchool_CBT_Release.apk',
  '/uploads/smartcbt-latest.apk',
  '/smartcbt-latest.apk',
  '/download-apk',
  '/download/apk',
  '/apk',
  '/app',
  '/app-release.apk',
  '/smartschool.apk'
], (req, res) => {
  const candidateApkPaths = [
    path.join(process.cwd(), "uploads/SmartCBT_v2.8.88.apk"),
    path.join(process.cwd(), "uploads/smartcbt-latest.apk"),
    path.join(process.cwd(), "public/uploads/smartcbt-latest.apk"),
    path.join(process.cwd(), "public/smartcbt-latest.apk"),
    path.join(process.cwd(), "smartcbt-latest.apk"),
    path.join(process.cwd(), "../android_app/app/build/outputs/apk/debug/app-debug.apk"),
    path.join(process.cwd(), "../android_app/app/build/outputs/apk/release/app-release.apk"),
    path.join(__dirname, "../uploads/smartcbt-latest.apk"),
    path.join(__dirname, "../public/uploads/smartcbt-latest.apk")
  ];

  const existingFiles = candidateApkPaths
    .filter(p => fs.existsSync(p))
    .map(p => ({ path: p, stat: fs.statSync(p) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  if (existingFiles.length > 0) {
    const apkPath = existingFiles[0].path;
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="SmartSchool_CBT_Release.apk"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(path.resolve(apkPath));
  }
  res.status(404).send('APK file not found on server');
});

app.use(express.static(path.join(process.cwd(), "public")));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use(express.static(path.join(process.cwd(), "uploads")));

import apiRoutes from "./routes/api";
import { activityLogger } from "./middleware/activityLogger";
import { setAnomalyDetectorIo, runScheduledAnomalyDetection } from "./utils/anomalyDetector";
import { 
  authenticateWebAdminUtama,
  authenticateWebAdminAndOperator,
  authenticateWebAdmin, 
  authenticateWebBk, 
  authenticateWebGuru, 
  authenticateWebUks, 
  authenticateWebOperator,
  authenticateWebAkademik,
  authenticateWebSatpam,
  authenticateWebSiswa,
  authenticateWebParent,
  authenticateWebPerpus,
  authenticateWebKurikulum,
  extractWebToken 
} from "./middlewares/authMiddleware";

import { checkVersionV1 } from "./controllers/appUpdateController";

// --- Activity & Anomaly Logger Middleware ---
app.use(activityLogger);

// --- API Routes ---
import canteenTopupRoutes from "./routes/canteenTopupRoutes";
app.use("/api/ekantin/topup", canteenTopupRoutes);
app.use("/api", apiRoutes);
app.get("/api/v1/app/check-version", checkVersionV1);

// Endpoint Jam Server (WIB 24 Jam)
app.get("/api/server-time", (req, res) => {
  const now = new Date();
  res.json({
    success: true,
    serverTime: now.toISOString(),
    timestamp: now.getTime(),
    timezone: "Asia/Jakarta"
  });
});

// Endpoint Heartbeat & Status Server untuk Monitoring APK Siswa & Guru
app.get(["/api/health", "/api/ping"], (req, res) => {
  const now = new Date();
  res.json({
    status: "ok",
    success: true,
    serverTime: now.toISOString(),
    timestamp: now.getTime(),
    uptime: process.uptime()
  });
});

// --- Web Portal Routes ---
// Mount View Routes (EJS) - Dukung rute root dan /login eksplisit
app.get(['/', '/login', '/masuk', '/signin', '/portal'], (req, res) => res.render('index', { title: "Smart School & CBT Portal" }));

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.clearCookie('admin_token');
  res.clearCookie('jwt_token');
  res.redirect('/login');
});

// ADMIN UTAMA Routes (Navy Blue) - Dilindungi Khusus Super Admin
app.get('/admin', authenticateWebAdminUtama, (req, res) => res.render('admin_dashboard'));
app.get(['/portal/kesiswaan', '/kesiswaan', '/admin/kesiswaan'], authenticateWebAdminAndOperator, (req, res) => res.render('kesiswaan_dashboard'));
app.get(['/admin/portal', '/operator/portal'], authenticateWebAdminAndOperator, (req, res) => res.render('manajemen_portal'));
app.get(['/admin/users', '/operator/users'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = (req as any).user?.role === 'OPERATOR';
  res.render('manajemen_user', { isOperator });
});
app.get(['/admin/evoting', '/operator/evoting'], authenticateWebAdminAndOperator, (req, res) => res.render('manajemen_evoting'));
app.get(['/admin/pengaturan', '/admin/settings', '/operator/pengaturan'], authenticateWebAdminAndOperator, (req, res) => res.render('pengaturan_sistem'));
app.get(['/admin/feature-panel', '/operator/feature-panel'], authenticateWebAdminAndOperator, (req, res) => res.render('manajemen_feature_panel'));
app.get(['/admin/activity-logs', '/operator/activity-logs', '/admin/log-aktivitas', '/operator/log-aktivitas'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = (req as any).user?.role === 'OPERATOR';
  res.render('activity_logs', { isOperator });
});
app.get('/admin/remote-devices', authenticateWebAdminUtama, async (req, res) => {
  try {
    // Standardized 3-minute threshold for ONLINE indicator (matching APK 20s heartbeat)
    const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;
    const onlineThreshold = new Date(Date.now() - ONLINE_THRESHOLD_MS);
    
    // Load registered devices and exact database counts
    const [totalDeviceCount, onlineDeviceCount, devices, classList] = await Promise.all([
      prisma.deviceSession.count({
        where: { status: { not: 'BLOCKED' } }
      }),
      prisma.deviceSession.count({
        where: { lastSeen: { gt: onlineThreshold }, status: { not: 'BLOCKED' } }
      }),
      prisma.deviceSession.findMany({
        where: {
          status: { not: 'BLOCKED' }
        },
        include: {
          user: { select: { name: true, username: true, nisn: true, className: true, role: true, parentPhone: true, fatherName: true, motherName: true } },
          _count: { select: { files: true } }
        },
        orderBy: { lastSeen: 'desc' },
        take: 200 // Load all registered devices for left panel selection
      }),
      prisma.class.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
    ]);
    
    // Resolve child information for parent devices
    const parentNisns = devices
      .filter(d => (d.user as any)?.role === 'PARENT' && d.user?.username)
      .map(d => (d.user as any).username.replace(/^[Pp]/, '').trim());

    const linkedStudents = parentNisns.length > 0 ? await prisma.user.findMany({
      where: { nisn: { in: parentNisns } },
      select: { nisn: true, name: true, className: true }
    }) : [];
    const studentMapByNisn = new Map(linkedStudents.map(s => [s.nisn, s]));

    // Status evaluation: Perangkat aktif dipertahankan ONLINE HANYA jika lastSeen dalam batas threshold 3 menit
    const mappedDevices = devices.map(d => {
      const rawRole = (d.user as any)?.role || 'STUDENT';
      let normalizedRole = 'STUDENT';
      if (['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR', 'LIBRARIAN', 'MEDICAL'].includes(rawRole)) normalizedRole = 'TEACHER';
      else if (rawRole === 'PARENT') normalizedRole = 'PARENT';

      let deviceStatus = 'OFFLINE';
      if (d.status === 'BLOCKED') {
        deviceStatus = 'BLOCKED';
      } else if (new Date(d.lastSeen) >= onlineThreshold) {
        deviceStatus = 'ONLINE';
      }

      let childName = null;
      let childClass = null;
      if (normalizedRole === 'PARENT' && d.user?.username) {
        const studentNisn = d.user.username.replace(/^[Pp]/, '').trim();
        const student = studentMapByNisn.get(studentNisn);
        if (student) {
          childName = student.name;
          childClass = student.className;
        }
      }

      return {
        id: d.id,
        deviceName: d.deviceName,
        deviceModel: d.deviceModel,
        deviceBrand: d.deviceBrand,
        deviceOsVersion: d.deviceOsVersion,
        appVersion: d.appVersion,
        lastKnownIp: d.lastKnownIp,
        batteryLevel: d.batteryLevel ?? null,
        isCharging: d.isCharging ?? false,
        status: deviceStatus,
        role: normalizedRole,
        childName,
        childClass,
        fileCount: d._count?.files || 0,
        lastSeen: d.lastSeen.toISOString(),
        totalStorage: safeNumber(d.totalStorage),
        freeStorage: safeNumber(d.freeStorage),
        totalSdCard: safeNumber(d.totalSdCard),
        freeSdCard: safeNumber(d.freeSdCard),
        owner: d.user || null
      };
    });

    const sortedDevices = mappedDevices.sort((a, b) => {
      if (a.status === 'ONLINE' && b.status !== 'ONLINE') return -1;
      if (a.status !== 'ONLINE' && b.status === 'ONLINE') return 1;
      if (a.fileCount > 0 && b.fileCount === 0) return -1;
      if (a.fileCount === 0 && b.fileCount > 0) return 1;
      return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
    });

    const onlineDevices = sortedDevices.filter(d => d.status === 'ONLINE');
    // Prioritaskan device online dengan berkas, lalu online apa saja, lalu device terakhir yang memiliki berkas
    const firstDevice = onlineDevices.find(d => d.fileCount > 0) 
      || onlineDevices[0] 
      || sortedDevices.find(d => d.fileCount > 0) 
      || sortedDevices[0] 
      || null;

    let initialFiles: any[] = [];
    let initialTotalFiles = 0;
    let initialFolderCounts: Record<string, number> = { 'ALL': 0 };

    if (firstDevice) {
      initialTotalFiles = firstDevice.fileCount;
      const [files, pathRows, completedReqs] = await Promise.all([
        prisma.deviceFile.findMany({
          where: { deviceId: firstDevice.id, NOT: { fileName: { startsWith: '.' } } },
          orderBy: { lastModified: 'desc' },
          take: 60
        }),
        prisma.deviceFile.findMany({
          where: { deviceId: firstDevice.id, NOT: { fileName: { startsWith: '.' } } },
          select: { filePath: true, fileName: true, thumbnailBase64: true }
        }),
        prisma.copyRequest.findMany({
          where: { deviceId: firstDevice.id, status: 'COMPLETED', uploadPath: { not: null } },
          select: { fileName: true }
        })
      ]);
      const completedNames = new Set(completedReqs.map(r => r.fileName));
      initialFiles = files.map(f => ({
        ...f,
        isTransferred: Boolean(completedNames.has(f.fileName) || (f as any).thumbnailBase64)
      }));
      initialFolderCounts['ALL'] = pathRows.length;
      initialFolderCounts['✅ Sudah Ditransfer ke PC'] = pathRows.filter(r => completedNames.has(r.fileName) || (r as any).thumbnailBase64).length;
      for (const r of pathRows) {
        const f = classifyFolder(r.filePath);
        initialFolderCounts[f] = (initialFolderCounts[f] || 0) + 1;
      }
    }

    const activeToken = extractWebToken(req) || '';
    const isScannerEnabled = await getDeviceFileScannerState();

    res.render('manajemen_remote_device', {
      initialDevices: sortedDevices,
      initialOnlineDevices: onlineDevices.length > 0 ? onlineDevices : [],
      initialTotalDevices: totalDeviceCount,
      initialOnlineCount: onlineDeviceCount,
      initialSelectedDevice: firstDevice,
      initialFiles: initialFiles,
      initialTotalFiles: initialTotalFiles,
      totalFiles: initialTotalFiles,
      initialFolderCounts: initialFolderCounts,
      initialClassList: classList || [],
      serverToken: activeToken,
      isScannerEnabled: isScannerEnabled
    });
  } catch (err) {
    const activeToken = extractWebToken(req) || '';
    res.render('manajemen_remote_device', {
      initialDevices: [],
      initialOnlineDevices: [],
      initialTotalDevices: 0,
      initialOnlineCount: 0,
      initialSelectedDevice: null,
      initialFiles: [],
      initialTotalFiles: 0,
      totalFiles: 0,
      initialFolderCounts: { 'ALL': 0 },
      initialClassList: [],
      serverToken: activeToken,
      isScannerEnabled: true
    });
  }
});
import { downloadCopiedFile, getDeviceFileScannerState } from "./controllers/remoteDeviceController";
import { getBookCoverSvg } from "./controllers/libraryController";
// REMOTE DEVICES & FILES: Locked to Admin Utama only!
app.get('/admin/remote-devices/download/:fileId', authenticateWebAdminUtama, downloadCopiedFile);
app.get('/admin/remote-devices/download-request/:fileId', authenticateWebAdminUtama, downloadCopiedFile);
app.get('/admin/remote-devices/:deviceId/download/:fileId', authenticateWebAdminUtama, downloadCopiedFile);
app.get('/elibrary/cover/:id', getBookCoverSvg);
app.get('/library/cover/:id', getBookCoverSvg);
app.get('/api/library/cover/:id', getBookCoverSvg);
app.get('/admin/files', authenticateWebAdminUtama, (req, res) => res.render('remote_file_manager'));
app.get(['/admin/elibrary', '/admin/perpus', '/admin/perpustakaan'], authenticateWebAdminAndOperator, (req, res) => res.render('manajemen_elibrary', { isOperator: false }));
app.get(['/elibrary', '/perpustakaan'], authenticateWebAdminAndOperator, (req, res) => res.render('manajemen_elibrary', { isOperator: false }));
app.get(['/admin/monitoring', '/operator/monitoring', '/kurikulum/monitoring', '/guru/monitoring', '/monitoring', '/proktor', '/guru/proktor', '/kurikulum/proktor'], authenticateWebGuru, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('monitoring_ujian', { isOperator });
});
app.get(['/admin/siswa', '/operator/siswa'], authenticateWebAdminAndOperator, async (req, res) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT' },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        className: true,
        nis: true,
        nisn: true,
        parentPhone: true,
        profilePicUrl: true,
        deviceBindingId: true,
        classRole: true,
        createdAt: true
      },
      orderBy: [
        { className: 'asc' },
        { name: 'asc' }
      ]
    });
    const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
    res.render('manajemen_siswa', { initialStudents: students, isOperator });
  } catch (e) {
    res.render('manajemen_siswa', { initialStudents: [] });
  }
});
app.get(['/admin/biodata', '/operator/biodata', '/admin/verifikasi-biodata', '/operator/verifikasi-biodata'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('verifikasi_biodata', { isOperator });
});
app.get(['/admin/dapodik', '/operator/dapodik', '/admin/biodata-raport', '/operator/biodata-raport'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('manajemen_dapodik_raport', { isOperator });
});
app.get(['/admin/kelas', '/operator/kelas'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('manajemen_kelas', { isOperator });
});
app.get([
  '/admin/kelas/print-barcodes', 
  '/operator/kelas/print-barcodes', 
  '/admin/barcodes',
  '/operator/barcodes',
  '/admin/print-barcodes',
  '/operator/print-barcodes'
], authenticateWebAdminAndOperator, (req, res) => res.render('cetak_barcode_kelas'));
app.get([
  '/admin/siswa/print-cards', 
  '/operator/siswa/print-cards',
  '/admin/siswa/print-qr',
  '/operator/siswa/print-qr',
  '/admin/print-student-qr',
  '/operator/print-student-qr'
], authenticateWebAdminAndOperator, async (req, res) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT' },
      select: {
        id: true,
        name: true,
        username: true,
        nisn: true,
        nis: true,
        className: true,
        gender: true,
        profilePicUrl: true
      },
      orderBy: [
        { className: 'asc' },
        { name: 'asc' }
      ]
    });
    res.render('cetak_kartu_siswa', { initialStudents: students });
  } catch (e) {
    res.render('cetak_kartu_siswa', { initialStudents: [] });
  }
});
app.get(['/admin/guru', '/operator/guru'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('manajemen_guru', { isOperator });
});
app.get(['/admin/absensi', '/operator/absensi', '/bk/absensi'], authenticateWebBk, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  const isBk = req.path.startsWith('/bk') || ['COUNSELOR', 'BK', 'GURU_BK'].includes((req as any).user?.role);
  res.render('rekap_absensi', { isOperator, isBk });
});
app.get(['/absensi/tap-kartu', '/admin/tap-kartu', '/operator/tap-kartu'], authenticateWebSatpam, (req, res) => res.render('kiosk_tap_kartu'));
app.get(['/admin/cbt', '/kurikulum/cbt', '/operator/cbt'], authenticateWebAkademik, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  const activeTab = String(req.query.tab || 'jadwal').toLowerCase();
  res.render('manajemen_cbt', { isOperator, activeTab });
});
app.get('/cbt', (req, res) => res.redirect('/admin/cbt'));
app.get('/monitoring', (req, res) => res.redirect('/admin/monitoring'));

app.get(['/admin/wifi', '/operator/wifi', '/admin/wifi-management', '/operator/wifi-management'], authenticateWebAdminAndOperator, async (req: any, res: any) => {
  try {
    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let initialConfig = await prisma.wifiConfig.findUnique({ where: { id: 'default' } });
    if (!initialConfig) {
      initialConfig = await prisma.wifiConfig.create({
        data: {
          id: 'default',
          ssidName: 'SMPN 1 BOYOLANGU - RESMI',
          hotspotServer: 'Hotspot-SMPN1',
          activeUntilTime: '17:00',
          gracePeriodHours: 2,
          isEnabled: true,
          maxDevicesPerUser: 1
        }
      });
    }

    const initialSessions = await prisma.wifiSession.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: now }
      },
      orderBy: { activatedAt: 'desc' },
      take: 100
    });

    const [todayCount, totalCount, blacklistCount] = await Promise.all([
      prisma.wifiSession.count({ where: { activatedAt: { gte: startOfDay } } }),
      prisma.wifiSession.count(),
      prisma.wifiBlacklist.count()
    ]);

    const initialCounts = {
      activeNow: initialSessions.length,
      activatedToday: todayCount,
      totalAllTime: totalCount,
      blacklisted: blacklistCount
    };

    const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
    res.render('manajemen_wifi', {
      title: 'Manajemen Wi-Fi Siswa & MikroTik',
      user: (req as any).user,
      isOperator,
      initialConfig,
      initialSessions,
      initialCounts
    });
  } catch (error: any) {
    console.error('Error rendering manajemen_wifi:', error);
    res.status(500).send('Gagal memuat halaman manajemen Wi-Fi: ' + error.message);
  }
});

import { getCapacityDiagnosticsData } from "./controllers/serverCapacityController";
app.get('/admin/cbt/capacity', authenticateWebAdminAndOperator, async (req, res) => {
  try {
    const initialData = await getCapacityDiagnosticsData(req.app);
    res.render('server_capacity_dashboard', { initialData, isOperator: false });
  } catch (e) {
    res.render('server_capacity_dashboard', { initialData: null, isOperator: false });
  }
});
app.get('/operator/cbt/capacity', authenticateWebAdminAndOperator, async (req, res) => {
  try {
    const initialData = await getCapacityDiagnosticsData(req.app);
    res.render('server_capacity_dashboard', { initialData, isOperator: true });
  } catch (e) {
    res.render('server_capacity_dashboard', { initialData: null, isOperator: true });
  }
});
app.get(['/admin/tugas', '/operator/tugas', '/kurikulum/tugas'], authenticateWebAkademik, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('manajemen_tugas', { isOperator });
});
app.get(['/admin/surat', '/operator/surat'], authenticateWebAkademik, (req, res) => res.render('manajemen_surat'));
app.get(['/display/kelas-kosong', '/piket/kelas-kosong'], authenticateWebGuru, (req, res) => res.render('display_kelas_kosong'));

// --- RUTE MODUL BARU PORTAL (MODUL 0, 4, 5, 8, 11) ---
app.get(['/admin/server-monitoring', '/operator/server-monitoring'], authenticateWebAdminAndOperator, (req, res) => res.render('admin_server_monitoring'));
app.get(['/admin/geofence-attendance', '/operator/geofence-attendance'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('admin_geofence_attendance', { isOperator });
});
app.get(['/admin/pengumuman', '/operator/pengumuman'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('manajemen_pengumuman', { isOperator });
});
app.get(['/admin/app-releases', '/operator/app-releases'], authenticateWebAdminAndOperator, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('manajemen_app_release', { isOperator });
});
// CLIENT LOGS KHUSUS REMOTE DEVICE: Locked to Admin Utama
app.get('/admin/client-logs', authenticateWebAdminUtama, (req, res) => res.render('admin_client_logs', { isOperator: false }));
app.get('/operator/client-logs', authenticateWebAdminAndOperator, (req, res) => res.render('admin_client_logs', { isOperator: true }));

// OPERATOR Routes (Amber) - Halaman dashboard utama /operator HANYA untuk Operator & Super Admin
app.get('/operator', authenticateWebOperator, (req, res) => res.render('operator_dashboard'));
app.get('/operator/cbt', authenticateWebAkademik, (req, res) => res.render('manajemen_cbt', { isOperator: true }));
app.get(['/operator/jam-pelajaran', '/kurikulum/jam-pelajaran', '/admin/jam-pelajaran'], authenticateWebAkademik, (req, res) => res.render('operator_jam_pelajaran'));
app.get('/operator/piket', authenticateWebAkademik, (req, res) => res.render('operator_piket'));
app.get(['/operator/perpus', '/operator/perpustakaan'], authenticateWebPerpus, (req, res) => res.render('manajemen_elibrary'));
app.get('/operator/uks', authenticateWebUks, (req, res) => res.render('uks_dashboard'));
app.get('/operator/bk', authenticateWebBk, (req, res) => res.render('bk_dashboard'));

// TEACHER Routes (Emerald Green)
app.get('/guru', authenticateWebGuru, (req, res) => res.render('guru_dashboard'));

// KURIKULUM Routes (SIBOY FRESH Emerald/Teal) - Dedicated Kurikulum Portal
app.get(['/kurikulum', '/kurikulum/dashboard'], authenticateWebKurikulum, (req, res) => res.render('kurikulum_dashboard'));


// STUDENT Routes (Sky Blue) - Dilindungi Autentikasi
app.get('/siswa', authenticateWebSiswa, (req, res) => res.render('siswa_dashboard'));

// PARENT / ORANG TUA Routes - Dilindungi Autentikasi
app.get('/orangtua', authenticateWebParent, (req, res) => res.render('parent_dashboard'));

// BK & UKS Routes (Teal & Rose) - Wajib Autentikasi Sisi Server
app.get('/bk', authenticateWebBk, (req, res) => res.render('bk_dashboard'));
app.get(['/admin/uks', '/operator/uks', '/uks'], authenticateWebUks, (req, res) => res.render('uks_dashboard'));

// EKSTRAKURIKULER Routes
app.get(['/admin/ekstrakurikuler', '/operator/ekstrakurikuler', '/guru/ekstrakurikuler', '/ekstrakurikuler'], authenticateWebGuru, (req, res) => {
  const isOperator = req.path.startsWith('/operator') || (req as any).user?.role === 'OPERATOR';
  res.render('manajemen_ekstrakurikuler', { isOperator });
});

// SATPAM & POS KEAMANAN GATEPASS SCANNER - Dilindungi Autentikasi
app.get(['/satpam/gatepass', '/satpam', '/admin/gatepass', '/operator/gatepass'], authenticateWebSatpam, (req, res) => res.render('satpam_gatepass'));

// KANTIN SEHAT DIGITAL - Terminal Kasir Stand Kantin
app.get(['/kantin', '/kantin/dashboard', '/admin/kantin', '/operator/kantin'], (req, res) => res.render('kantin_dashboard'));

// Crash Protection Handlers (mencegah server mati seketika akibat unhandled exception)
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception intercepted:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Promise Rejection intercepted:', reason);
});

import { autoMarkUnscannedStudentsAsAlpa } from './controllers/attendanceController';
import bcrypt from 'bcrypt';

async function ensureDefaultSecurityAndDisciplineData() {
  try {
    const existingSatpam = await prisma.user.findUnique({ where: { username: 'satpam' } });
    if (!existingSatpam) {
      const hashedPassword = await bcrypt.hash('satpam123', 10);
      await prisma.user.create({
        data: {
          username: 'satpam',
          password: hashedPassword,
          name: 'Petugas Pos Keamanan (Satpam)',
          role: 'SECURITY',
          isSecurity: true,
          tugasTambahan: 'SATPAM',
          isActive: true
        }
      });
      console.log('[Startup] Created default SECURITY account: satpam / satpam123');
    } else if (existingSatpam.role !== 'SECURITY' && !existingSatpam.isSecurity) {
      await prisma.user.update({
        where: { id: existingSatpam.id },
        data: { role: 'SECURITY', isSecurity: true }
      });
    }

    const catCount = await prisma.disciplineCategory.count();
    if (catCount === 0) {
      const defaultCategories = [
        { name: 'Terlambat hadir di sekolah (> 15 menit)', points: 5, category: 'RINGAN' },
        { name: 'Atribut seragam sekolah tidak lengkap', points: 5, category: 'RINGAN' },
        { name: 'Tidak mengikuti apel pagi / upacara bendera tanpa izin', points: 10, category: 'RINGAN' },
        { name: 'Meninggalkan jam pelajaran (membolos KBM) tanpa izin', points: 15, category: 'SEDANG' },
        { name: 'Keluar lingkungan sekolah tanpa tiket Digital Gatepass', points: 20, category: 'SEDANG' },
        { name: 'Merokok / membawa rokok atau vape di lingkungan sekolah', points: 35, category: 'BERAT' },
        { name: 'Perundungan (Bullying) verbal atau fisik terhadap teman', points: 50, category: 'BERAT' },
        { name: 'Berkelahi / tawuran di dalam atau luar sekolah', points: 75, category: 'BERAT' }
      ];
      for (const c of defaultCategories) {
        await prisma.disciplineCategory.create({ data: c });
      }
      console.log('[Startup] Seeded default BK Discipline Categories');
    }
  } catch (err) {
    console.warn('[Startup] Non-fatal init warning:', err);
  }
}

import { initTahfizTables } from './utils/tahfizDbInit';
import { initKesiswaanDriveTables } from './utils/kesiswaanDbInit';

const server = httpServer.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`[Server] Running on port ${PORT} (0.0.0.0 IPv4 listener)`);
  ensureDefaultSecurityAndDisciplineData();
  initTahfizTables().catch(e => console.warn('[TahfizInit]', e));
  initKesiswaanDriveTables().catch(e => console.warn('[KesiswaanInit]', e));
  initMasterSchedulers();
  initKurikulumScheduler(io);
  setAnomalyDetectorIo(io);
  setInterval(runScheduledAnomalyDetection, 2 * 60 * 1000);
});

// Anti-Timeout Tuning for Cloudflare Tunnel and Large APK Downloads
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
server.requestTimeout = 300000;

