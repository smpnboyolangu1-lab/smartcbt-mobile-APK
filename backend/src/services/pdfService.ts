import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import prisma from '../utils/db';

const execFileAsync = promisify(execFile);

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export interface BiodataPdfData {
    siswa: any;
    ayah: any;
    ibu: any;
    wali?: any;
    afirmasi?: any;
    dokumen?: any[];
    customAcademicYear?: string;
    customDate?: string;
}

/**
 * Menghitung Tahun Pelajaran Berjalan secara Dinamis (contoh: "2026/2027")
 */
export function getDynamicAcademicYear(custom?: string): string {
    if (custom && custom.includes('/')) return custom.trim();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1 - 12
    if (month >= 7) {
        return `${year}/${year + 1}`;
    } else {
        return `${year - 1}/${year}`;
    }
}

/**
 * Format tanggal surat dinamis Bahasa Indonesia (contoh: "4 Oktober 2026")
 */
export function formatIndonesianDate(date?: Date | string): string {
    const d = date ? new Date(date) : new Date();
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export class PdfService {
    /**
     * Generate HTML untuk 3 Halaman Folio F4 (215 x 330 mm)
     * Format 100% identik dengan Sampel PDF Resmi SMPN 1 Boyolangu
     * Halaman 1: Formulir Data Diri Siswa & Denah Lokasi Rumah
     * Halaman 2: Surat Pernyataan Peserta Didik Baru (6 Butir Komitmen)
     * Halaman 3: Surat Pernyataan Orang Tua / Wali (6 Butir Komitmen)
     */
    static buildHtml(data: BiodataPdfData): string {
        const s = data.siswa || {};
        const ayah = data.ayah || {};
        const ibu = data.ibu || {};
        const wali = data.wali || {};
        const afirmasi = data.afirmasi || {};

        const tahunPelajaran = getDynamicAcademicYear(data.customAcademicYear || s.academicYear || s.tahunPelajaran);
        const tanggalSurat = data.customDate || formatIndonesianDate();

        const nisVal = s.nis ? s.nis : '-';
        const nisnVal = s.nisn || s.username || '-';
        const namaSiswa = (s.namaLengkap || s.name || '-').toUpperCase();
        const namaAyah = (ayah.nama || s.fatherName || '-').toUpperCase();
        const namaIbu = (ibu.nama || s.motherName || '-').toUpperCase();
        const namaOrtu = (namaAyah !== '-' ? namaAyah : (namaIbu !== '-' ? namaIbu : (wali.nama || 'ORANG TUA / WALI'))).toUpperCase();
        const pekerjaanOrtu = (ayah.pekerjaan || ibu.pekerjaan || wali.pekerjaan || '-').toUpperCase();
        const pekerjaanAyah = (ayah.pekerjaan || '-').toUpperCase();
        const pekerjaanIbu = (ibu.pekerjaan || '-').toUpperCase();
        const pekerjaanWali = (wali.pekerjaan || '-').toUpperCase();
        const namaWali = (wali.nama || '-').toUpperCase();
        const hubunganWali = (wali.hubungan || '-').toUpperCase();
        const noHpOrtu = ayah.noHp || ibu.noHp || wali.noHp || s.parentPhone || '-';
        const alamat = s.alamatLengkap || s.address || s.alamat || '-';
        const kelas = s.rombel || s.kelas || s.className || 'VII';
        const jkStr = (s.jk === 'L' || s.gender === 'L') ? 'Laki-laki' : ((s.jk === 'P' || s.gender === 'P') ? 'Perempuan' : '-');
        const ttlStr = `${s.tempatLahir || s.pob || 'Tulungagung'}, ${s.tanggalLahir || s.dob || '-'}`;
        const jarakWaktuStr = `${s.jarakKm ? s.jarakKm + ' km' : '- km'} / ${s.waktuTempuhMenit ? s.waktuTempuhMenit + ' menit' : '- menit'}`;
        const koordinatStr = (s.latitude && s.longitude) ? `${s.latitude}, ${s.longitude}` : 'Belum diisi';

        // Foto 3x4 Pasfoto Resmi (Background Biru Solid)
        let fotoHtml = `
            <div class="foto-box">
                <span style="font-weight: bold; font-size: 8pt;">Foto 3x4</span>
            </div>
        `;
        if (s.fotoUrl) {
            const possiblePaths = [
                path.join(__dirname, '../../', s.fotoUrl),
                path.join(__dirname, '../../uploads/', s.fotoUrl.replace(/^\/uploads\//, '')),
                path.resolve(s.fotoUrl)
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    try {
                        const fotoBuf = fs.readFileSync(p);
                        const base64 = fotoBuf.toString('base64');
                        fotoHtml = `<img src="data:image/jpeg;base64,${base64}" class="foto-img" alt="Foto Siswa 3x4" />`;
                        break;
                    } catch (e) {}
                }
            }
        }

        return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Formulir & Surat Pernyataan - ${namaSiswa}</title>
<style>
  @page {
    size: 215mm 330mm; /* Standar Folio / F4 */
    margin: 14mm 16mm 14mm 16mm;
  }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    color: #000000;
    line-height: 1.35;
    margin: 0;
    padding: 0;
    background: #ffffff;
  }
  .page {
    width: 100%;
    page-break-after: always;
    position: relative;
    box-sizing: border-box;
    padding: 2mm 0;
  }
  .page:last-child {
    page-break-after: avoid;
  }
  .doc-title {
    text-align: center;
    font-size: 13pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
    margin-bottom: 2px;
  }
  .doc-subtitle {
    text-align: center;
    font-size: 11pt;
    font-weight: bold;
    margin-bottom: 14px;
    color: #111827;
  }
  .table-data {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    font-size: 9.5pt;
  }
  .table-data td {
    padding: 3px 2px;
    vertical-align: top;
  }
  .table-data td.lbl {
    width: 28%;
    color: #000;
  }
  .table-data td.cln {
    width: 3%;
    text-align: center;
  }
  .table-data td.val {
    width: 69%;
    font-weight: normal;
  }
  .page1-header-grid {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 14px;
  }
  .page1-fields {
    width: 76%;
  }
  .page1-photo {
    width: 22%;
    text-align: right;
  }
  .foto-box {
    width: 30mm;
    height: 40mm;
    border: 1px solid #475569;
    background: #0078D4; /* Solid Royal Blue Pasfoto */
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    margin-left: auto;
  }
  .foto-img {
    width: 30mm;
    height: 40mm;
    object-fit: cover;
    border: 1px solid #1e293b;
    margin-left: auto;
    display: block;
  }
  .denah-box {
    width: 100%;
    height: 105mm;
    border: 1.5px dashed #334155;
    background: #fafafa;
    position: relative;
    box-sizing: border-box;
    padding: 10px;
    margin-top: 8px;
    text-align: center;
  }
  .denah-title {
    font-size: 10.5pt;
    font-weight: bold;
    margin-bottom: 2px;
  }
  .denah-coord {
    font-size: 9pt;
    color: #334155;
    margin-bottom: 2px;
  }
  .denah-hint {
    font-size: 8.5pt;
    font-style: italic;
    color: #64748b;
  }
  .ol-commit {
    margin: 6px 0 10px 18px;
    padding: 0;
    font-size: 9.3pt;
    line-height: 1.4;
  }
  .ol-commit li {
    margin-bottom: 7px;
    text-align: justify;
  }
  .meterai-box {
    border: 1px dashed #64748b;
    width: 36mm;
    height: 22mm;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 8px auto;
    font-size: 8pt;
    color: #475569;
    background: #ffffff;
    text-align: center;
    line-height: 1.2;
  }
  .table-ttd {
    width: 100%;
    border-collapse: collapse;
    margin-top: 14px;
    font-size: 9.5pt;
  }
  .table-ttd td {
    vertical-align: top;
    text-align: center;
    width: 50%;
  }
  @media print {
    body { background: transparent; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: avoid; }
  }
</style>
</head>
<body>

  <!-- ========================================================================= -->
  <!-- HALAMAN 1: FORMULIR DATA DIRI SISWA & DENAH LOKASI RUMAH                   -->
  <!-- ========================================================================= -->
  <div class="page">
    <div class="doc-title" style="margin-bottom: 12px;">FORMULIR DATA DIRI SISWA</div>

    <div class="page1-header-grid">
      <div class="page1-fields">
        <table class="table-data" style="margin-bottom: 0;">
          <tr><td class="lbl">Nama Lengkap</td><td class="cln">:</td><td class="val"><strong>${namaSiswa}</strong></td></tr>
          <tr><td class="lbl">NIS / NISN</td><td class="cln">:</td><td class="val">${nisVal} / ${nisnVal}</td></tr>
          <tr><td class="lbl">Kelas</td><td class="cln">:</td><td class="val">${kelas}</td></tr>
          <tr><td class="lbl">TTL</td><td class="cln">:</td><td class="val">${ttlStr}</td></tr>
          <tr><td class="lbl">Jenis Kelamin</td><td class="cln">:</td><td class="val">${jkStr}</td></tr>
          <tr><td class="lbl">Agama</td><td class="cln">:</td><td class="val">${s.agama || s.religion || 'Islam'}</td></tr>
          <tr><td class="lbl">Alamat (Domisili)</td><td class="cln">:</td><td class="val">${alamat}</td></tr>
          <tr><td class="lbl">Jarak / Waktu Tempuh</td><td class="cln">:</td><td class="val">${jarakWaktuStr}</td></tr>
          <tr><td class="lbl">Nama Ayah</td><td class="cln">:</td><td class="val">${namaAyah}</td></tr>
          <tr><td class="lbl">Pekerjaan Ayah</td><td class="cln">:</td><td class="val">${pekerjaanAyah}</td></tr>
          <tr><td class="lbl">Nama Ibu</td><td class="cln">:</td><td class="val">${namaIbu}</td></tr>
          <tr><td class="lbl">Pekerjaan Ibu</td><td class="cln">:</td><td class="val">${pekerjaanIbu}</td></tr>
          <tr><td class="lbl">No. WhatsApp Aktif (Ortu)</td><td class="cln">:</td><td class="val">${noHpOrtu}</td></tr>
        </table>
      </div>
      <div class="page1-photo">
        ${fotoHtml}
      </div>
    </div>

    <!-- Denah Lokasi Rumah (Kotak Dashed Standar Resmi) -->
    <div class="denah-box">
      <div class="denah-title">DENAH LOKASI RUMAH</div>
      <div class="denah-coord">Koordinat: ${koordinatStr}</div>
      <div class="denah-hint">( Gambarkan secara manual / Tempelkan cetakan peta )</div>
      ${(s.latitude && s.longitude) ? `
      <div style="margin-top: 15px; text-align: center;">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=https://maps.google.com/?q=${s.latitude},${s.longitude}" style="width: 100px; height: 100px;" alt="QR Lokasi Rumah" />
        <div style="font-size: 8pt; color: #475569; margin-top: 4px;">Pindai QR untuk Navigasi Google Maps</div>
      </div>
      ` : ''}
    </div>
  </div>

  <!-- ========================================================================= -->
  <!-- HALAMAN 2: SURAT PERNYATAAN PESERTA DIDIK BARU                            -->
  <!-- ========================================================================= -->
  <div class="page">
    <div class="doc-title">SURAT PERNYATAAN PESERTA DIDIK BARU</div>
    <div class="doc-subtitle">SMP Negeri 1 Boyolangu Tahun Pelajaran ${tahunPelajaran}</div>

    <p style="margin: 6px 0 8px 0;">Saya yang bertanda tangan di bawah ini:</p>

    <table class="table-data" style="margin-bottom: 8px;">
      <tr><td class="lbl">Nama Lengkap</td><td class="cln">:</td><td class="val"><strong>${namaSiswa}</strong></td></tr>
      <tr><td class="lbl">Tempat, Tanggal Lahir</td><td class="cln">:</td><td class="val">${ttlStr}</td></tr>
      <tr><td class="lbl">Jenis Kelamin</td><td class="cln">:</td><td class="val">${jkStr}</td></tr>
      <tr><td class="lbl">Agama</td><td class="cln">:</td><td class="val">${s.agama || s.religion || 'Islam'}</td></tr>
      <tr><td class="lbl">Nomor Pendaftaran</td><td class="cln">:</td><td class="val">${nisnVal}</td></tr>
      <tr><td class="lbl">Diterima di Kelas</td><td class="cln">:</td><td class="val">${kelas}</td></tr>
      <tr><td class="lbl">Nama Orang Tua/Wali</td><td class="cln">:</td><td class="val">${namaOrtu}</td></tr>
      <tr><td class="lbl">Pekerjaan Orang Tua</td><td class="cln">:</td><td class="val">${pekerjaanOrtu}</td></tr>
      <tr><td class="lbl">Nama Wali</td><td class="cln">:</td><td class="val">${namaWali}</td></tr>
      <tr><td class="lbl">Pekerjaan Wali</td><td class="cln">:</td><td class="val">${pekerjaanWali}</td></tr>
      <tr><td class="lbl">Hubungan Orang Tua dengan Wali</td><td class="cln">:</td><td class="val">${hubunganWali}</td></tr>
      <tr><td class="lbl">Alamat Orang Tua/Wali</td><td class="cln">:</td><td class="val">${alamat}</td></tr>
    </table>

    <p style="text-align: justify; margin: 4px 0 6px 0;">
      Dengan penuh kesadaran, rasa tanggung jawab, serta semangat untuk belajar dan berkembang, saya menyatakan bahwa selama menjadi peserta didik di SMP Negeri 1 Boyolangu, saya berkomitmen untuk:
    </p>

    <ol class="ol-commit">
      <li>Mengikuti seluruh proses pembelajaran dan kegiatan sekolah dengan disiplin, tertib, penuh semangat, serta bertanggung jawab.</li>
      <li>Menjaga nama baik diri sendiri, keluarga, dan SMP Negeri 1 Boyolangu melalui sikap, tutur kata, serta perilaku yang sopan, santun, jujur, dan berakhlak mulia.</li>
      <li>Mematuhi seluruh tata tertib, peraturan, dan ketentuan yang berlaku di sekolah dengan penuh kesadaran dan tanggung jawab.</li>
      <li>Menghormati guru, tenaga kependidikan, teman, serta seluruh warga sekolah, serta menjaga suasana belajar yang aman, nyaman, sehat, inklusif, dan menyenangkan.</li>
      <li>Aktif mengikuti kegiatan pembelajaran, pengembangan diri, dan program-program sekolah sesuai dengan kemampuan, serta turut menjaga kebersihan, ketertiban, keamanan, dan kelestarian lingkungan sekolah.</li>
      <li>Apabila saya melakukan pelanggaran terhadap tata tertib sekolah, saya bersedia menerima pembinaan dan tindak lanjut sesuai dengan ketentuan yang berlaku. Apabila setelah mendapatkan pembinaan saya tetap tidak menunjukkan perubahan perilaku yang lebih baik, saya siap menerima keputusan sekolah, termasuk dikembalikan kepada orang tua/wali untuk mendapatkan pendampingan lebih lanjut sesuai dengan peraturan sekolah.</li>
    </ol>

    <p style="text-align: justify; margin: 6px 0 10px 0;">
      Demikian surat pernyataan ini saya buat dengan sebenar-benarnya, tanpa adanya paksaan dari pihak mana pun. Saya berjanji akan berusaha menjadi peserta didik yang berkarakter, bertanggung jawab, berakhlak mulia, serta terus belajar menjadi pribadi yang lebih baik setiap hari.
    </p>

    <div style="text-align: right; margin-right: 15%; margin-bottom: 6px; font-size: 9.5pt;">
      Boyolangu, ${tanggalSurat}
    </div>

    <table class="table-ttd">
      <tr>
        <td>
          Mengetahui / Menyetujui,<br>
          Orang Tua / Wali<br><br><br><br><br>
          <strong>( ${namaOrtu} )</strong>
        </td>
        <td>
          Yang Membuat Pernyataan,<br>
          Siswa Baru
          <div class="meterai-box">
            Meterai Rp 10.000
          </div>
          <strong>( ${namaSiswa} )</strong>
        </td>
      </tr>
    </table>
  </div>

  <!-- ========================================================================= -->
  <!-- HALAMAN 3: SURAT PERNYATAAN ORANG TUA / WALI                              -->
  <!-- ========================================================================= -->
  <div class="page">
    <div class="doc-title">SURAT PERNYATAAN ORANG TUA / WALI</div>
    <div class="doc-subtitle">SMP Negeri 1 Boyolangu Tahun Pelajaran ${tahunPelajaran}</div>

    <p style="margin: 6px 0 8px 0;">Saya yang bertanda tangan di bawah ini:</p>

    <table class="table-data" style="margin-bottom: 8px;">
      <tr><td class="lbl">Nama Orang Tua/Wali</td><td class="cln">:</td><td class="val"><strong>${namaOrtu}</strong></td></tr>
      <tr><td class="lbl">Pekerjaan</td><td class="cln">:</td><td class="val">${pekerjaanOrtu}</td></tr>
      <tr><td class="lbl">Alamat</td><td class="cln">:</td><td class="val">${alamat}</td></tr>
      <tr><td class="lbl">Nomor HP</td><td class="cln">:</td><td class="val">${noHpOrtu}</td></tr>
      <tr><td class="lbl">Agama</td><td class="cln">:</td><td class="val">${s.agama || s.religion || '-'}</td></tr>
      <tr><td class="lbl">Nama Peserta Didik</td><td class="cln">:</td><td class="val"><strong>${namaSiswa}</strong></td></tr>
      <tr><td class="lbl">Jenis Kelamin</td><td class="cln">:</td><td class="val">${jkStr}</td></tr>
      <tr><td class="lbl">Diterima di Kelas</td><td class="cln">:</td><td class="val">${kelas}</td></tr>
      <tr><td class="lbl">Hubungan dengan Peserta Didik</td><td class="cln">:</td><td class="val">${wali.nama ? (wali.hubungan || 'Wali') : 'Anak Kandung'}</td></tr>
    </table>

    <p style="text-align: justify; margin: 4px 0 6px 0;">
      Dengan penuh kesadaran dan tanggung jawab sebagai orang tua/wali, saya menyatakan bahwa:
    </p>

    <ol class="ol-commit">
      <li>Saya bersedia bekerja sama dengan sekolah dalam membimbing, mendampingi, mengingatkan, dan mengawasi putra/putri saya agar mengikuti seluruh proses pembelajaran serta mematuhi tata tertib sekolah dengan penuh tanggung jawab.</li>
      <li>Saya akan mendukung seluruh program pendidikan, pembinaan karakter, serta kegiatan sekolah yang bertujuan mengembangkan potensi, bakat, minat, dan karakter peserta didik.</li>
      <li>Saya memberikan izin kepada putra/putri saya untuk mengikuti kegiatan intrakurikuler, kokurikuler, ekstrakurikuler, dan kegiatan resmi sekolah sesuai dengan ketentuan yang berlaku.</li>
      <li>Saya akan menjalin komunikasi yang baik dengan pihak sekolah serta hadir apabila diperlukan untuk berdiskusi, melakukan pendampingan, atau menyelesaikan permasalahan yang berkaitan dengan perkembangan putra/putri saya.</li>
      <li>Apabila putra/putri saya melakukan pelanggaran terhadap tata tertib sekolah, saya bersedia bekerja sama dengan sekolah dalam proses pembinaan, pendampingan, dan tindak lanjut sesuai dengan ketentuan yang berlaku.</li>
      <li>Apabila setelah berbagai upaya pembinaan dan pendampingan yang dilakukan oleh sekolah bersama orang tua/wali putra/putri saya tetap tidak menunjukkan perubahan perilaku yang positif, saya siap menerima keputusan sekolah sesuai dengan peraturan yang berlaku, termasuk menerima kembali putra/putri saya untuk mendapatkan pembinaan dan pendampingan lebih lanjut di lingkungan keluarga.</li>
    </ol>

    <p style="text-align: justify; margin: 6px 0 10px 0;">
      Demikian surat pernyataan ini saya buat dengan sebenar-benarnya, tanpa adanya paksaan dari pihak mana pun. Saya berkomitmen untuk menjadi mitra sekolah dalam mendukung tumbuh kembang putra/putri saya agar menjadi pribadi yang beriman, berakhlak mulia, disiplin, bertanggung jawab, berprestasi, serta bermanfaat bagi masyarakat.
    </p>

    <div style="text-align: right; margin-right: 15%; margin-bottom: 6px; font-size: 9.5pt;">
      Boyolangu, ${tanggalSurat}
    </div>

    <table class="table-ttd">
      <tr>
        <td style="width: 50%;"></td>
        <td style="width: 50%;">
          Yang Membuat Pernyataan,<br>
          Orang Tua / Wali
          <div class="meterai-box">
            Meterai Rp 10.000
          </div>
          <strong>( ${namaOrtu} )</strong>
        </td>
      </tr>
    </table>
  </div>

</body>
</html>`;
    }

    /**
     * Generate berkas PDF 3 Halaman Folio F4 menggunakan headless Microsoft Edge
     */
    static async generateFormulirLengkap(studentId: string): Promise<{ pdfUrl: string; totalHalaman: number; filePath: string }> {
        // Cari siswa via user atau biodata
        const siswaUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { id: studentId },
                    { username: studentId }
                ]
            }
        });

        const targetStudentId = siswaUser?.id || studentId;
        const siswaBio = await (prisma as any).biodataSiswa.findUnique({
            where: { studentId: targetStudentId }
        });

        if (!siswaBio && !siswaUser) {
            throw new Error(`Data siswa dengan ID ${studentId} tidak ditemukan.`);
        }

        const siswa = {
            ...(siswaBio || {}),
            namaLengkap: siswaBio?.namaLengkap || siswaUser?.name || 'Siswa',
            name: siswaUser?.name || siswaBio?.namaLengkap || 'Siswa',
            nisn: siswaBio?.nisn || siswaUser?.username || '-',
            nis: siswaBio?.nis || (siswaUser as any)?.nis || '',
            nik: siswaBio?.nik || (siswaUser as any)?.nik || '-',
            jk: siswaBio?.jk || siswaUser?.gender || 'L',
            gender: siswaUser?.gender || siswaBio?.jk || 'L',
            tempatLahir: siswaBio?.tempatLahir || (siswaUser as any)?.pob || 'Tulungagung',
            tanggalLahir: siswaBio?.tanggalLahir || (siswaUser as any)?.dob || '-',
            agama: siswaBio?.agama || (siswaUser as any)?.religion || 'Islam',
            rombel: siswaBio?.rombel || siswaBio?.kelas || (siswaUser as any)?.className || 'VII-A',
            fotoUrl: siswaBio?.fotoUrl || (siswaUser as any)?.profilePicUrl || null
        };

        const ayah = await (prisma as any).biodataAyah.findUnique({ where: { studentId: targetStudentId } });
        const ibu = await (prisma as any).biodataIbu.findUnique({ where: { studentId: targetStudentId } });
        const wali = await (prisma as any).biodataWali.findUnique({ where: { studentId: targetStudentId } });
        const afirmasi = await (prisma as any).biodataAfirmasi.findUnique({ where: { studentId: targetStudentId } });

        const rawData: BiodataPdfData = {
            siswa,
            ayah: ayah || {},
            ibu: ibu || {},
            wali: wali || {},
            afirmasi: afirmasi || {}
        };

        // 2. Build HTML
        const html = PdfService.buildHtml(rawData);

        // 3. Tentukan path file output
        const cleanName = (siswa.namaLengkap || siswa.name || 'Siswa').replace(/[^a-zA-Z0-9]/g, '_');
        const nisnFolder = (siswa.nisn || siswa.username || targetStudentId).replace(/[^a-zA-Z0-9]/g, '_');
        const outputDir = path.resolve(__dirname, '../../uploads/siswa', `${nisnFolder}_${cleanName}`);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const tempHtmlPath = path.join(outputDir, 'temp_formulir.html');
        const outputPdfPath = path.join(outputDir, 'formulir_biodata_lengkap.pdf');

        fs.writeFileSync(tempHtmlPath, html, 'utf-8');

        // 4. Print ke PDF menggunakan Headless Edge
        const fileUrl = `file:///${tempHtmlPath.replace(/\\/g, '/')}`;
        await execFileAsync(EDGE_PATH, [
            '--headless',
            '--disable-gpu',
            '--run-all-compositor-stages-before-draw',
            `--print-to-pdf=${outputPdfPath}`,
            fileUrl
        ]);

        // Hapus file HTML sementara
        try { fs.unlinkSync(tempHtmlPath); } catch (e) {}

        const relativePdfUrl = `/uploads/siswa/${nisnFolder}_${cleanName}/formulir_biodata_lengkap.pdf`;

        // 5. Update field pdfUrl di biodata_siswa
        try {
            await (prisma as any).biodataSiswa.update({
                where: { studentId: targetStudentId },
                data: { pdfUrl: relativePdfUrl }
            });
        } catch (e) {}

        return {
            pdfUrl: relativePdfUrl,
            totalHalaman: 3,
            filePath: outputPdfPath
        };
    }
}
