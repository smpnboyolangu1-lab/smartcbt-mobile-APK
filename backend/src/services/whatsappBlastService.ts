import { PrismaClient } from '@prisma/client';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

export interface WaBlastRecipient {
  studentId: string;
  studentName: string;
  className: string;
  parentPhone: string;
  type: 'LATE' | 'ABSENT_NO_CHECKLOCK';
  lateMinutes?: number;
  inTimeStr?: string;
  dateStr: string;
}

export interface WaBlastResult {
  studentId: string;
  studentName: string;
  parentPhone: string;
  status: 'SENT' | 'SIMULATED' | 'FAILED' | 'SKIPPED_NO_PHONE';
  message: string;
  error?: string;
}

// Session directory for Baileys Multi-Device auth
const AUTH_DIR = path.resolve(process.cwd(), 'storage', 'baileys_auth');
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Configuration file path
const CONFIG_FILE = path.resolve(process.cwd(), 'storage', 'whatsapp_config.json');

export interface WaGatewayConfig {
  provider: 'BAILEYS_SELF_HOSTED';
  isActive: boolean;
  schoolDownloadUrl: string;
  officialPhone?: string;
  senderName?: string;
}

// Global Baileys Singleton state
let sock: WASocket | null = null;
let currentQrBase64: string | null = null;
let connectionStatus: 'CONNECTED' | 'WAITING_QR' | 'CONNECTING' | 'DISCONNECTED' = 'DISCONNECTED';
let connectedPhone: string = '';
let connectedName: string = '';
let isInitializing = false;

export function getWaConfig(): WaGatewayConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        provider: 'BAILEYS_SELF_HOSTED',
        isActive: parsed.isActive ?? true,
        schoolDownloadUrl: parsed.schoolDownloadUrl && !parsed.schoolDownloadUrl.includes('/uploads/smartcbt-latest.apk') 
          ? parsed.schoolDownloadUrl 
          : 'https://github.com/adiprayitno160-glitch/smartcbt-mobile-APK/releases/latest/download/SmartCBT_latest.apk',
        officialPhone: parsed.officialPhone || connectedPhone || '081234567890',
        senderName: parsed.senderName || 'SMP Negeri 1 Boyolangu'
      };
    }
  } catch (e) {}

  return {
    provider: 'BAILEYS_SELF_HOSTED',
    isActive: true,
    schoolDownloadUrl: 'https://github.com/adiprayitno160-glitch/smartcbt-mobile-APK/releases/latest/download/SmartCBT_latest.apk',
    officialPhone: connectedPhone || '081234567890',
    senderName: 'SMP Negeri 1 Boyolangu'
  };
}

export function saveWaConfig(cfg: Partial<WaGatewayConfig>) {
  const current = getWaConfig();
  const updated = { ...current, ...cfg, provider: 'BAILEYS_SELF_HOSTED' as const };
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

/**
 * Format Pesan Sopan & Resmi Langsung ke Intinya (Standar SMPN 1 Boyolangu)
 * - Tanpa salam pembuka/penutup panjang
 * - Tanpa judul birokratis berulang
 * - Menyampaikan fakta secara ringkas, jelas, dan santun
 */
export function formatWaMessage(data: WaBlastRecipient, appUrl: string): string {
  if (data.type === 'LATE') {
    return (
      `Bapak/Ibu Orang Tua/Wali dari ananda *${data.studentName}* (Kelas *${data.className}*), kami menginformasikan bahwa ananda tercatat tiba di sekolah terlambat *${data.lateMinutes || 0} menit* pada pukul *${data.inTimeStr || '-'} WIB* hari ini, *${data.dateStr}*.\n\n` +
      `Mohon bantuan Bapak/Ibu untuk memberikan bimbingan kepada ananda agar dapat hadir tepat waktu pada kegiatan belajar selanjutnya. Pantau riwayat kehadiran ananda melalui aplikasi Smart CBT:\n` +
      `${appUrl}\n\n` +
      `— Tim Kesiswaan SMP Negeri 1 Boyolangu`
    );
  } else {
    return (
      `Bapak/Ibu Orang Tua/Wali dari ananda *${data.studentName}* (Kelas *${data.className}*), kami menginformasikan bahwa hingga saat ini ananda belum tercatat melakukan presensi (checklock) di gerbang sekolah pada hari ini, *${data.dateStr}*.\n\n` +
      `Apabila ananda berhalangan hadir dikarenakan sakit atau keperluan keluarga, mohon segera memberikan konfirmasi melalui wali kelas. Pantau status presensi ananda melalui aplikasi Smart CBT:\n` +
      `${appUrl}\n\n` +
      `— Tim Kesiswaan SMP Negeri 1 Boyolangu`
    );
  }
}

/**
 * Inisialisasi Baileys WhatsApp Web Client
 */
export async function initBaileys(forceNew = false): Promise<void> {
  if (isInitializing) return;
  isInitializing = true;

  try {
    if (forceNew) {
      if (sock) {
        try { sock.end(undefined); } catch (e) {}
        sock = null;
      }
      try {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      } catch (e) {}
      currentQrBase64 = null;
      connectionStatus = 'DISCONNECTED';
      connectedPhone = '';
    }

    connectionStatus = 'CONNECTING';
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['SMPN 1 Boyolangu', 'Chrome', '120.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQrBase64 = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
          connectionStatus = 'WAITING_QR';
          console.log('[WhatsApp Baileys] QR Code baru siap dipindai.');
        } catch (qrErr) {
          console.error('[WhatsApp Baileys] Gagal membuat data URL QR:', qrErr);
        }
      }

      if (connection === 'open') {
        connectionStatus = 'CONNECTED';
        currentQrBase64 = null;
        const user = sock?.user;
        connectedPhone = user?.id ? user.id.split(':')[0] : '';
        connectedName = user?.name || 'SMP Negeri 1 Boyolangu';
        console.log(`[WhatsApp Baileys] ✅ Terhubung resmi dengan nomor: +${connectedPhone}`);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsApp Baileys] Koneksi ditutup (kode: ${statusCode}). Auto-reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          connectionStatus = 'CONNECTING';
          setTimeout(() => {
            isInitializing = false;
            initBaileys();
          }, 3500);
        } else {
          connectionStatus = 'DISCONNECTED';
          currentQrBase64 = null;
          connectedPhone = '';
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            fs.mkdirSync(AUTH_DIR, { recursive: true });
          } catch (e) {}
        }
      }
    });
  } catch (error) {
    console.error('[WhatsApp Baileys] Error inisialisasi socket:', error);
    connectionStatus = 'DISCONNECTED';
  } finally {
    isInitializing = false;
  }
}

/**
 * Logout & Putus sesi WhatsApp
 */
export async function logoutBaileys(): Promise<void> {
  try {
    if (sock) {
      await sock.logout();
      sock.end(undefined);
      sock = null;
    }
  } catch (e) {}

  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  } catch (e) {}

  connectionStatus = 'DISCONNECTED';
  currentQrBase64 = null;
  connectedPhone = '';
  connectedName = '';

  // Buat sesi baru siap scan
  setTimeout(() => {
    initBaileys(true);
  }, 1000);
}

/**
 * Dapatkan status koneksi WhatsApp & live QR Code
 */
export async function getWhatsAppLiveStatusAndQr(): Promise<{
  isConnected: boolean;
  statusText: string;
  device?: string;
  qrUrl?: string;
  provider: string;
  officialPhone: string;
  senderName: string;
  message?: string;
}> {
  if (!sock && !isInitializing) {
    initBaileys();
  }

  const isConnected = (connectionStatus === 'CONNECTED');
  const phoneDisplay = connectedPhone || '081234567890';

  let message = 'Menyiapkan engine WhatsApp...';
  if (isConnected) {
    message = `Terhubung dengan nomor WhatsApp resmi: +${connectedPhone}`;
  } else if (currentQrBase64) {
    message = 'Silakan pindai QR Code dengan menu Perangkat Tertaut di WhatsApp HP resmi sekolah.';
  } else if (connectionStatus === 'CONNECTING') {
    message = 'Sedang menyambungkan ke server WhatsApp...';
  }

  return {
    isConnected,
    statusText: connectionStatus,
    device: connectedPhone ? `WhatsApp Web (+${connectedPhone})` : undefined,
    qrUrl: currentQrBase64 || undefined,
    provider: 'BAILEYS_SELF_HOSTED',
    officialPhone: phoneDisplay,
    senderName: connectedName || 'SMP Negeri 1 Boyolangu',
    message
  };
}

/**
 * Kirim 1 pesan teks langsung via Baileys Engine
 */
export async function sendSingleWhatsApp(phone: string, text: string): Promise<{ success: boolean; rawResponse?: any; error?: string }> {
  // Normalisasi ke format nomor internasional tanpa karakter aneh
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '62' + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith('62')) {
    cleanPhone = '62' + cleanPhone;
  }

  const jid = `${cleanPhone}@s.whatsapp.net`;

  if (!sock || connectionStatus !== 'CONNECTED') {
    return {
      success: false,
      error: 'WhatsApp resmi belum terhubung. Silakan pindai QR Code di menu Pengaturan Web Admin terlebih dahulu.'
    };
  }

  try {
    const result = await sock.sendMessage(jid, { text });
    return { success: true, rawResponse: result };
  } catch (err: any) {
    console.error(`[WhatsApp Baileys] Gagal mengirim pesan ke ${cleanPhone}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Alias untuk sendSingleWhatsApp
 */
export const sendWhatsAppMessage = sendSingleWhatsApp;

/**
 * Scan & kirim blast khusus siswa TERLAMBAT hari ini
 */
export async function dispatchLateStudentsBlastToday(): Promise<WaBlastResult[]> {
  const config = getWaConfig();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const dateStr = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const lateAttendances = await prisma.attendance.findMany({
    where: {
      type: 'GATE_IN',
      scanTime: { gte: startOfDay, lte: endOfDay },
      status: { in: ['LATE', 'TERLAMBAT'] }
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          className: true,
          parentPhone: true
        }
      }
    }
  });

  const results: WaBlastResult[] = [];

  for (const att of lateAttendances) {
    const student = att.user;
    if (!student) continue;

    let parentPhone = student.parentPhone;
    if (!parentPhone) {
      const bio = await (prisma as any).biodataSiswa?.findUnique({
        where: { siswaId: student.id },
        select: { teleponOrangTua: true, noHpAyah: true, noHpIbu: true, noHpWali: true }
      });
      parentPhone = bio?.teleponOrangTua || bio?.noHpIbu || bio?.noHpAyah || bio?.noHpWali || null;
    }

    if (!parentPhone) {
      results.push({
        studentId: student.id,
        studentName: student.name,
        parentPhone: '-',
        status: 'SKIPPED_NO_PHONE',
        message: 'Tidak ada nomor telepon orang tua/wali di profil siswa'
      });
      continue;
    }

    const inDate = new Date(att.scanTime);
    const hh = inDate.getUTCHours();
    const mm = inDate.getUTCMinutes();
    const inTimeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} WIB`;
    const lateMinutes = Math.max(1, Math.round((hh * 60 + mm) - (7 * 60 + 0)));

    const text = formatWaMessage(
      {
        studentId: student.id,
        studentName: student.name,
        className: student.className || 'Kelas Siswa',
        parentPhone,
        type: 'LATE',
        lateMinutes,
        inTimeStr,
        dateStr
      },
      config.schoolDownloadUrl
    );

    const sendRes = await sendSingleWhatsApp(parentPhone, text);

    results.push({
      studentId: student.id,
      studentName: student.name,
      parentPhone,
      status: sendRes.success ? 'SENT' : 'FAILED',
      message: sendRes.success ? 'Berhasil dikirim ke orang tua via WhatsApp Resmi' : `Gagal: ${sendRes.error}`,
      error: sendRes.error
    });

    // Jeda aman antar pesan agar natural (500ms)
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

/**
 * Scan & kirim blast khusus siswa BELUM PRESENSI / TANPA CHECKLOCK hari ini
 */
export async function dispatchAbsentStudentsBlastToday(): Promise<WaBlastResult[]> {
  const config = getWaConfig();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const dateStr = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const allActiveStudents = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      isActive: true
    },
    select: {
      id: true,
      name: true,
      className: true,
      parentPhone: true
    }
  });

  const checkedInUsers = await prisma.attendance.findMany({
    where: {
      scanTime: { gte: startOfDay, lte: endOfDay }
    },
    select: { userId: true },
    distinct: ['userId']
  });

  const checkedInUserIds = new Set(checkedInUsers.map((a) => a.userId));
  const unchecklockedStudents = allActiveStudents.filter((s) => !checkedInUserIds.has(s.id));

  const results: WaBlastResult[] = [];

  for (const student of unchecklockedStudents) {
    let parentPhone = student.parentPhone;
    if (!parentPhone) {
      const bio = await (prisma as any).biodataSiswa?.findUnique({
        where: { siswaId: student.id },
        select: { teleponOrangTua: true, noHpAyah: true, noHpIbu: true, noHpWali: true }
      });
      parentPhone = bio?.teleponOrangTua || bio?.noHpIbu || bio?.noHpAyah || bio?.noHpWali || null;
    }

    if (!parentPhone) {
      results.push({
        studentId: student.id,
        studentName: student.name,
        parentPhone: '-',
        status: 'SKIPPED_NO_PHONE',
        message: 'Tidak ada nomor telepon orang tua/wali di profil siswa'
      });
      continue;
    }

    const text = formatWaMessage(
      {
        studentId: student.id,
        studentName: student.name,
        className: student.className || 'Kelas Siswa',
        parentPhone,
        type: 'ABSENT_NO_CHECKLOCK',
        dateStr
      },
      config.schoolDownloadUrl
    );

    const sendRes = await sendSingleWhatsApp(parentPhone, text);

    results.push({
      studentId: student.id,
      studentName: student.name,
      parentPhone,
      status: sendRes.success ? 'SENT' : 'FAILED',
      message: sendRes.success ? 'Berhasil dikirim ke orang tua via WhatsApp Resmi' : `Gagal: ${sendRes.error}`,
      error: sendRes.error
    });

    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

// Inisialisasi awal saat server Node.js pertama kali booting
setTimeout(() => {
  initBaileys();
}, 2000);
