import { Request, Response } from 'express';
import prisma from '../utils/db';
import {
  dispatchLateStudentsBlastToday,
  dispatchAbsentStudentsBlastToday,
  getWaConfig,
  saveWaConfig,
  getWhatsAppLiveStatusAndQr,
  sendSingleWhatsApp,
  logoutBaileys,
  initBaileys
} from '../services/whatsappBlastService';

export const triggerLateBlast = async (req: Request, res: Response) => {
  try {
    const results = await dispatchLateStudentsBlastToday();
    res.json({
      success: true,
      totalProcessed: results.length,
      sentCount: results.filter(r => r.status === 'SENT').length,
      skippedCount: results.filter(r => r.status === 'SKIPPED_NO_PHONE').length,
      failedCount: results.filter(r => r.status === 'FAILED').length,
      results
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal menjalankan blast keterlambatan: ' + err.message });
  }
};

export const triggerAbsentBlast = async (req: Request, res: Response) => {
  try {
    const results = await dispatchAbsentStudentsBlastToday();
    res.json({
      success: true,
      totalProcessed: results.length,
      sentCount: results.filter(r => r.status === 'SENT').length,
      skippedCount: results.filter(r => r.status === 'SKIPPED_NO_PHONE').length,
      failedCount: results.filter(r => r.status === 'FAILED').length,
      results
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal menjalankan blast alpa/tanpa checklock: ' + err.message });
  }
};

export const getWhatsAppStatus = async (req: Request, res: Response) => {
  try {
    const live = await getWhatsAppLiveStatusAndQr();
    const config = getWaConfig();
    res.json({
      success: true,
      ...live,
      config: {
        provider: config.provider,
        isActive: config.isActive,
        schoolDownloadUrl: config.schoolDownloadUrl,
        officialPhone: live.officialPhone,
        senderName: live.senderName
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil status WhatsApp: ' + err.message });
  }
};

export const getWhatsAppConfigEndpoint = async (req: Request, res: Response) => {
  try {
    const config = getWaConfig();
    res.json({
      success: true,
      config
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil konfigurasi: ' + err.message });
  }
};

export const testSendWhatsApp = async (req: Request, res: Response) => {
  try {
    const { targetPhone } = req.body;
    if (!targetPhone) {
      return res.status(400).json({ success: false, message: 'Nomor telepon tujuan wajib diisi.' });
    }

    const testMsg =
      `Bapak/Ibu Orang Tua/Wali Murid, ini adalah pesan uji coba resmi dari Sistem Layanan Presensi SMP Negeri 1 Boyolangu.\n\n` +
      `Sistem ini digunakan untuk memberikan pemberitahuan kehadiran siswa dan pemantauan kegiatan sekolah melalui aplikasi Smart CBT:\n` +
      `https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk\n\n` +
      `— Tim Kesiswaan SMP Negeri 1 Boyolangu`;

    const sendRes = await sendSingleWhatsApp(targetPhone, testMsg);
    if (sendRes.success) {
      res.json({ success: true, message: `Pesan uji coba berhasil dikirim ke nomor ${targetPhone}!`, raw: sendRes.rawResponse });
    } else {
      res.status(500).json({ success: false, message: `Gagal mengirim pesan uji coba: ${sendRes.error}` });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pengiriman uji coba: ' + err.message });
  }
};

export const updateWhatsAppConfig = async (req: Request, res: Response) => {
  try {
    const { isActive, schoolDownloadUrl, officialPhone, senderName } = req.body;
    const updated = saveWaConfig({
      ...(isActive !== undefined && { isActive }),
      ...(schoolDownloadUrl && { schoolDownloadUrl }),
      ...(officialPhone && { officialPhone }),
      ...(senderName && { senderName })
    });
    res.json({ success: true, message: 'Konfigurasi WhatsApp Gateway berhasil disimpan', config: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan konfigurasi WhatsApp: ' + err.message });
  }
};

export const disconnectWhatsAppEndpoint = async (req: Request, res: Response) => {
  try {
    await logoutBaileys();
    res.json({ success: true, message: 'Sesi WhatsApp resmi berhasil diputus. QR Code baru sedang dimuat.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal memutus sesi WhatsApp: ' + err.message });
  }
};

export const restartWhatsAppSessionEndpoint = async (req: Request, res: Response) => {
  try {
    await initBaileys(true);
    res.json({ success: true, message: 'Engine WhatsApp berhasil di-restart. Silakan tunggu QR Code baru.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal me-restart WhatsApp: ' + err.message });
  }
};

export function normalizeIndonesianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = '62' + digits.substring(1);
  } else if (!digits.startsWith('62')) {
    digits = '62' + digits;
  }
  if (digits.length < 9 || digits.length > 15) return null;
  return '+' + digits;
}

/**
 * Statistik Nomor HP Orang Tua untuk Sinkronisasi Google Contacts
 */
export const getParentContactsStats = async (req: Request, res: Response) => {
  try {
    const students = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        isActive: true
      },
      select: {
        id: true,
        name: true,
        className: true,
        parentPhone: true,
        nisn: true
      },
      orderBy: [
        { className: 'asc' },
        { name: 'asc' }
      ]
    });

    const totalStudents = students.length;
    let withParentPhone = 0;
    const classMap: Record<string, { total: number; withPhone: number }> = {};

    for (const s of students) {
      const cls = s.className || 'Tanpa Kelas';
      if (!classMap[cls]) {
        classMap[cls] = { total: 0, withPhone: 0 };
      }
      classMap[cls].total++;

      const normalized = normalizeIndonesianPhone(s.parentPhone);
      if (normalized) {
        withParentPhone++;
        classMap[cls].withPhone++;
      }
    }

    const classes = Object.keys(classMap).sort().map(className => ({
      className,
      total: classMap[className].total,
      withPhone: classMap[className].withPhone,
      percentage: Math.round((classMap[className].withPhone / classMap[className].total) * 100)
    }));

    res.json({
      success: true,
      totalStudents,
      withParentPhone,
      withoutParentPhone: totalStudents - withParentPhone,
      percentage: totalStudents > 0 ? Math.round((withParentPhone / totalStudents) * 100) : 0,
      classes
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil statistik kontak: ' + err.message });
  }
};

/**
 * Ekspor Kontak Orang Tua ke Format vCard 3.0 (.vcf)
 * Langsung dapat diimpor sekali klik ke Google Contacts / Buku Telepon HP Android Admin
 */
export const exportParentContactsVcf = async (req: Request, res: Response) => {
  try {
    const targetClass = req.query.className as string | undefined;

    const whereClause: any = {
      role: 'STUDENT',
      isActive: true,
      parentPhone: { not: null }
    };

    if (targetClass && targetClass !== 'ALL') {
      whereClause.className = targetClass;
    }

    const students = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        className: true,
        parentPhone: true,
        nisn: true
      },
      orderBy: [
        { className: 'asc' },
        { name: 'asc' }
      ]
    });

    const vcards: string[] = [];

    for (const s of students) {
      const cleanPhone = normalizeIndonesianPhone(s.parentPhone);
      if (!cleanPhone) continue;

      const cls = s.className || 'Siswa';
      const cleanName = (s.name || 'Siswa').trim();
      const nameParts = cleanName.split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName;

      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:Ortu ${cls} - ${cleanName}`,
        `N:${lastName};${firstName};;Ortu ${cls};`,
        `ORG:SMP Negeri 1 Boyolangu`,
        `TITLE:Orang Tua Siswa`,
        `TEL;TYPE=CELL,VOICE,PREF:${cleanPhone}`,
        `NOTE:Siswa: ${cleanName} | Kelas: ${cls} | NISN: ${s.nisn || '-'}`,
        `CATEGORIES:SMPN 1 Boyolangu,Orang Tua Siswa,Kelas ${cls}`,
        'END:VCARD'
      ].join('\r\n');

      vcards.push(vcard);
    }

    const fileContent = vcards.join('\r\n');
    const safeClass = targetClass && targetClass !== 'ALL' ? `_${targetClass.replace(/[^a-zA-Z0-9_-]/g, '')}` : '_Semua_Kelas';
    const filename = `Kontak_Ortu_SMPN1Boyolangu${safeClass}.vcf`;

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(fileContent);
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal mengekspor file vCard: ' + err.message });
  }
};

/**
 * Ekspor Kontak Orang Tua ke Format Google Contacts CSV
 * Siap diunggah ke contacts.google.com
 */
export const exportParentContactsCsv = async (req: Request, res: Response) => {
  try {
    const targetClass = req.query.className as string | undefined;

    const whereClause: any = {
      role: 'STUDENT',
      isActive: true,
      parentPhone: { not: null }
    };

    if (targetClass && targetClass !== 'ALL') {
      whereClause.className = targetClass;
    }

    const students = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        className: true,
        parentPhone: true,
        nisn: true
      },
      orderBy: [
        { className: 'asc' },
        { name: 'asc' }
      ]
    });

    const headers = [
      'Name',
      'Given Name',
      'Family Name',
      'Group Membership',
      'Phone 1 - Type',
      'Phone 1 - Value',
      'Organization 1 - Name',
      'Organization 1 - Title',
      'Notes'
    ];

    const escapeCsv = (val: string) => {
      const str = String(val || '').replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows: string[] = [headers.map(escapeCsv).join(',')];

    for (const s of students) {
      const cleanPhone = normalizeIndonesianPhone(s.parentPhone);
      if (!cleanPhone) continue;

      const cls = s.className || 'Siswa';
      const cleanName = (s.name || 'Siswa').trim();
      const nameParts = cleanName.split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName;

      const row = [
        escapeCsv(`Ortu ${cls} - ${cleanName}`),
        escapeCsv(firstName),
        escapeCsv(lastName),
        escapeCsv(`SMPN 1 Boyolangu ::: Kelas ${cls}`),
        escapeCsv('Mobile'),
        escapeCsv(cleanPhone),
        escapeCsv('SMP Negeri 1 Boyolangu'),
        escapeCsv('Orang Tua Siswa'),
        escapeCsv(`Siswa: ${cleanName} | Kelas: ${cls} | NISN: ${s.nisn || '-'}`)
      ];

      rows.push(row.join(','));
    }

    const fileContent = rows.join('\r\n');
    const safeClass = targetClass && targetClass !== 'ALL' ? `_${targetClass.replace(/[^a-zA-Z0-9_-]/g, '')}` : '_Semua_Kelas';
    const filename = `Kontak_Ortu_SMPN1Boyolangu_GoogleContacts${safeClass}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(fileContent);
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Gagal mengekspor file Google Contacts CSV: ' + err.message });
  }
};

