const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '..', 'android_app', 'app', 'src', 'main', 'res', 'drawable', 'logo_school.png');
let logoBase64 = '';
if (fs.existsSync(logoPath)) {
    logoBase64 = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');
}

const htmlContent = `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DOKUMEN ANALISIS TEKNIS & CHECKLIST OPERASIONAL SMART SCHOOL CBT - SMPN 1 BOYOLANGU (FORMAT F4 / FOLIO)</title>
    <style>
        /* Standar Ukuran Kertas F4 / Folio Indonesia: 215mm x 330mm (8.5 x 13 inch) */
        @page {
            size: 215mm 330mm portrait;
            margin: 12mm 15mm 15mm 15mm;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
            font-size: 10pt;
            line-height: 1.48;
            color: #1e293b;
            background-color: #f1f5f9;
        }

        /* Screen Top Navigation Bar */
        .no-print-bar {
            position: sticky;
            top: 0;
            z-index: 9999;
            background: #0f172a;
            color: white;
            padding: 12px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 14px rgba(0,0,0,0.2);
        }

        .bar-info {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .badge-f4 {
            background: #f59e0b;
            color: #78350f;
            font-size: 8.5pt;
            font-weight: 800;
            padding: 3px 8px;
            border-radius: 4px;
            letter-spacing: 0.5px;
        }

        .btn-print {
            background: #2563eb;
            color: white;
            border: none;
            padding: 10px 24px;
            font-size: 11pt;
            font-weight: 700;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 8px rgba(37,99,235,0.4);
            transition: all 0.2s;
        }

        .btn-print:hover {
            background: #1d4ed8;
            transform: translateY(-1px);
        }

        /* Sheet Document Container for F4 / Folio (215mm x 330mm) */
        .document-container {
            max-width: 215mm;
            min-height: 330mm;
            margin: 20px auto 40px auto;
            background: #ffffff;
            padding: 16mm 18mm;
            box-shadow: 0 4px 25px rgba(0,0,0,0.08);
            border-radius: 4px;
        }

        /* Kop Surat Resmi Sekolah */
        .kop-surat {
            display: flex;
            align-items: center;
            border-bottom: 3.5px double #0f172a;
            padding-bottom: 12px;
            margin-bottom: 16px;
            gap: 16px;
        }

        .kop-logo {
            width: 85px;
            height: 85px;
            object-fit: contain;
        }

        .kop-text {
            flex: 1;
            text-align: center;
        }

        .kop-text h3 {
            font-size: 11pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #334155;
            line-height: 1.2;
        }

        .kop-text h2 {
            font-size: 12.5pt;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #1e293b;
            line-height: 1.2;
        }

        .kop-text h1 {
            font-size: 16pt;
            font-weight: 900;
            text-transform: uppercase;
            color: #0f172a;
            letter-spacing: 1px;
            margin: 3px 0;
            line-height: 1.2;
        }

        .kop-text p {
            font-size: 8.5pt;
            color: #475569;
            line-height: 1.35;
        }

        /* Document Title Banner */
        .doc-header-banner {
            text-align: center;
            margin: 14px 0 18px 0;
            padding: 10px 14px;
            background: #f1f5f9;
            border-left: 6px solid #2563eb;
            border-radius: 4px;
        }

        .doc-header-banner h2 {
            font-size: 12.5pt;
            font-weight: 800;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .doc-header-banner p {
            font-size: 9pt;
            color: #475569;
            font-weight: 600;
            margin-top: 3px;
        }

        /* Metadata Table */
        .meta-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 8.5pt;
        }

        .meta-table td {
            padding: 5px 8px;
            border: 1px solid #cbd5e1;
        }

        .meta-table td.label {
            width: 25%;
            font-weight: 700;
            background: #f8fafc;
            color: #334155;
        }

        .meta-table td.val {
            width: 75%;
            color: #0f172a;
        }

        /* Section Headings */
        h2.section-title {
            font-size: 11.5pt;
            font-weight: 800;
            color: #0f172a;
            text-transform: uppercase;
            border-bottom: 2px solid #2563eb;
            padding-bottom: 5px;
            margin: 20px 0 12px 0;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        h3.sub-section-title {
            font-size: 10pt;
            font-weight: 700;
            color: #1e293b;
            margin: 14px 0 6px 0;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        p, li {
            font-size: 9.2pt;
            color: #334155;
            line-height: 1.48;
        }

        ul, ol {
            padding-left: 20px;
            margin-bottom: 12px;
        }

        li {
            margin-bottom: 4px;
        }

        /* Data Tables */
        table.styled-table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0 16px 0;
            font-size: 8.5pt;
        }

        table.styled-table th {
            background: #1e293b;
            color: white;
            font-weight: 700;
            text-align: left;
            padding: 7px 9px;
            border: 1px solid #0f172a;
        }

        table.styled-table td {
            padding: 6px 9px;
            border: 1px solid #cbd5e1;
            vertical-align: top;
        }

        table.styled-table tr:nth-child(even) {
            background-color: #f8fafc;
        }

        /* Flow Diagrams (HTML boxes for printing) */
        .flow-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 10px 0 14px 0;
        }

        .flow-step {
            display: flex;
            align-items: stretch;
            gap: 12px;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 12px;
        }

        .flow-step-num {
            background: #2563eb;
            color: white;
            font-weight: 800;
            font-size: 9pt;
            min-width: 26px;
            height: 26px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 2px;
        }

        .flow-step-content {
            flex: 1;
        }

        .flow-step-content strong {
            font-size: 9pt;
            color: #0f172a;
            display: block;
            margin-bottom: 2px;
        }

        .flow-step-content p {
            font-size: 8.5pt;
            color: #475569;
            margin: 0;
        }

        .flow-arrow-down {
            text-align: center;
            color: #2563eb;
            font-size: 13pt;
            font-weight: bold;
            line-height: 0.8;
        }

        /* Checklist Tables */
        .checklist-table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0 18px 0;
            font-size: 8.5pt;
        }

        .checklist-table th {
            background: #0f172a;
            color: #ffffff;
            font-weight: 700;
            padding: 7px 9px;
            border: 1px solid #0f172a;
            text-align: left;
        }

        .checklist-table td {
            padding: 6px 9px;
            border: 1px solid #cbd5e1;
            vertical-align: middle;
        }

        .checklist-table td.col-box {
            width: 34px;
            text-align: center;
        }

        .check-box-square {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid #0f172a;
            border-radius: 3px;
            background: #ffffff;
        }

        .checklist-table tr:nth-child(even) {
            background: #f8fafc;
        }

        .tag-badge {
            display: inline-block;
            padding: 2px 7px;
            border-radius: 4px;
            font-size: 7.5pt;
            font-weight: 700;
            text-transform: uppercase;
        }

        .tag-blue { background: #dbeafe; color: #1e40af; }
        .tag-green { background: #dcfce7; color: #166534; }
        .tag-purple { background: #f3e8ff; color: #6b21a8; }
        .tag-amber { background: #fef3c7; color: #92400e; }
        .tag-red { background: #fee2e2; color: #991b1b; }

        /* Signature Section */
        .signature-section {
            margin-top: 26px;
            width: 100%;
            border-collapse: collapse;
            page-break-inside: avoid;
            break-inside: avoid;
        }

        .signature-section td {
            width: 33.33%;
            text-align: center;
            vertical-align: top;
            padding: 10px;
            font-size: 8.5pt;
        }

        .sig-space {
            height: 65px;
        }

        /* Page Breaks */
        .page-break {
            page-break-after: always;
            break-after: page;
        }

        .avoid-break {
            page-break-inside: avoid;
            break-inside: avoid;
        }

        /* Print Media Styles specifically for F4 / Folio (215mm x 330mm) */
        @media print {
            body {
                background: white !important;
                font-size: 9.2pt !important;
            }
            .no-print-bar {
                display: none !important;
            }
            .document-container {
                max-width: 100% !important;
                min-height: auto !important;
                margin: 0 !important;
                padding: 0 !important;
                box-shadow: none !important;
                border-radius: 0 !important;
            }
            a {
                text-decoration: none !important;
                color: #000 !important;
            }
            .check-box-square {
                border: 2px solid #000000 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            th {
                background-color: #1e293b !important;
                color: white !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .doc-header-banner {
                background-color: #f1f5f9 !important;
                border-left: 6px solid #2563eb !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .tag-badge {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
        }
    </style>
</head>
<body>

    <!-- Bar Navigasi Cetak di Layar Komputer -->
    <div class="no-print-bar">
        <div class="bar-info">
            <strong>🖨️ Lembar Dokumen Resmi Siap Cetak</strong>
            <span class="badge-f4">MODE KERTAS F4 / FOLIO (215 mm × 330 mm)</span>
            <span style="font-size: 8.5pt; opacity: 0.85;">Pada jendela cetak (Ctrl+P), pilih ukuran kertas: Folio / F4 / 215×330 mm</span>
        </div>
        <button class="btn-print" onclick="window.print()">
            <span>🖨️ Cetak Dokumen F4 Sekarang (Ctrl + P)</span>
        </button>
    </div>

    <div class="document-container">

        <!-- KOP SURAT RESMI SEKOLAH -->
        <div class="kop-surat">
            <img src="${logoBase64}" alt="Logo Sekolah" class="kop-logo">
            <div class="kop-text">
                <h3>Pemerintah Kabupaten Tulungagung</h3>
                <h2>Dinas Pendidikan, Kepemudaan dan Olahraga</h2>
                <h1>SMP Negeri 1 Boyolangu</h1>
                <p>Jalan Ki Mangunsarkoro No. 101, Dusun Beji, Beji, Kec. Boyolangu, Kabupaten Tulungagung, Jawa Timur 66233<br>
                Website Resmi: https://smpn1boyolangu.sch.id • Portal CBT: https://cbt.smpn1boyolangu.my.id</p>
            </div>
        </div>

        <!-- HEADER DOKUMEN -->
        <div class="doc-header-banner">
            <h2>DOKUMEN ANALISIS TEKNIS, FITUR & ALUR KERJA APLIKASI MOBILE</h2>
            <p>Smart School CBT Mobile • Versi Terkini: v2.8.113 (Build 123) • Format Kertas F4 / Folio (21.5 cm × 33.0 cm)</p>
        </div>

        <!-- METADATA TABEL -->
        <table class="meta-table">
            <tr>
                <td class="label">Nama Perangkat Lunak</td>
                <td class="val"><strong>Smart School CBT (Android Client Application)</strong></td>
                <td class="label">Tanggal Dokumen</td>
                <td class="val">Oktober 2026</td>
            </tr>
            <tr>
                <td class="label">Versi / Kode Build</td>
                <td class="val"><strong>v2.8.113 (Build 123)</strong></td>
                <td class="label">Format Ukuran Kertas</td>
                <td class="val"><strong>F4 / Folio (215 mm × 330 mm / 8.5" × 13.0")</strong></td>
            </tr>
            <tr>
                <td class="label">Teknologi Client</td>
                <td class="val">Android Native Kotlin, Retrofit2, Room DB, Google ML Kit, CameraX, Android TTS</td>
                <td class="label">Konektivitas Live</td>
                <td class="val">Cloudflare Tunnel (VPS Live) & LAN Switchboard Lokal Sekolah</td>
            </tr>
            <tr>
                <td class="label">Teknologi Server</td>
                <td class="val">Node.js Express 5 + TypeScript, Prisma ORM (SQLite WAL), Google Gemini 2.5 Flash</td>
                <td class="label">Target Populasi</td>
                <td class="val">990 Siswa · 72 Guru & Staf · 332 Akun Wali Murid · 33 Rombel</td>
            </tr>
        </table>

        <!-- 1. IKHTISAR SISTEM -->
        <h2 class="section-title">1. Ikhtisar Sistem & Arsitektur Perangkat Lunak</h2>
        <p>Aplikasi <strong>Smart School CBT</strong> dibangun menggunakan paradigma <strong>Thin Client (Klien Tipis)</strong>, di mana seluruh komputasi intensif (validasi titik koordinat geofencing, verifikasi biometrik citra pasfoto, pembacaan dokumen medis berbasis AI Gemini Vision OCR, penentuan jadwal KBM dan penilaian ujian otomatis) dipusatkan di server sekolah. Hal ini menjamin konsistensi data riil, meringankan beban memori RAM perangkat ponsel pintar pengguna, serta mencegah potensi manipulasi data di sisi klien (*client-side tampering*).</p>

        <h3 class="sub-section-title">A. Keandalan Sambungan Jaringan (Dual-Server Auto Fallback)</h3>
        <p>Aplikasi dilengkapi pengendali koneksi cerdas pada <code>LoginActivity.kt</code>:</p>
        <ul>
            <li><strong>Jalur Utama (VPS Cloudflare Tunnel):</strong> Aplikasi secara default terhubung ke <code>https://cbt.smpn1boyolangu.my.id</code> sehingga dapat diakses dari mana pun oleh guru, siswa, dan orang tua.</li>
            <li><strong>Uji Konektivitas Otomatis:</strong> Saat diluncurkan, sistem melakukan *heartbeat ping* (3.500 ms) ke endpoint <code>/api/app/version-check</code>.</li>
            <li><strong>Fallback LAN Otomatis:</strong> Jika jaringan internet eksternal terputus atau padam, aplikasi secara instan beralih ke Server Cadangan Lokal Sekolah (<code>http://192.168.1.xxx:3000</code>) tanpa mengharuskan pengguna login ulang.</li>
        </ul>

        <h3 class="sub-section-title">B. Keamanan & Kepatuhan Integritas</h3>
        <ul>
            <li><strong>Pengikatan Tunggal Perangkat (Single Device Binding):</strong> Setiap akun siswa diikat secara permanen ke ID perangkat keras unik HP masing-masing guna memberantas praktik titip akun atau joki ujian.</li>
            <li><strong>Validasi Lokasi Terpadu (Anti-Fake GPS):</strong> Memverifikasi koordinat GPS asli sekolah (Polygon Radius &le; 150 meter) dan memblokir aplikasi penyedia lokasi tiruan (*Mock Location Providers*).</li>
            <li><strong>Kiosk Mode Anti-Curang CBT:</strong> Mode layar penuh (*Immersive Sticky*) yang menonaktifkan tombol sistem Android, mengosongkan clipboard, dan mendeteksi perpindahan aplikasi dengan *Strike Violation System*.</li>
        </ul>

        <div class="page-break"></div>

        <!-- 2. PEMETAAN FITUR 8 ROLE -->
        <h2 class="section-title">2. Pemetaan Fitur Lengkap Berdasarkan Hak Akses Pengguna (8 Role)</h2>
        <table class="styled-table">
            <thead>
                <tr>
                    <th style="width: 18%;">Peran (Role)</th>
                    <th style="width: 32%;">Fitur Utama</th>
                    <th style="width: 50%;">Keterangan & Rincian Operasional</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>1. SISWA</strong><br><span class="tag-badge tag-blue">STUDENT</span></td>
                    <td>
                        • Presensi QR Kelas<br>
                        • Exambro Kiosk CBT<br>
                        • Modul Tugas & PR<br>
                        • Mushola & Ibadah<br>
                        • E-Library & UKS<br>
                        • E-Voting OSIS
                    </td>
                    <td>Siswa memindai QR dinamis di layar kelas (wajib GPS &le; 150m, sebelum 07:00 Hadir, lewat 07:00 Terlambat). Mengerjakan ujian CBT dalam mode Kiosk terkunci. Memantau rekap nilai tugas dan meminjam buku perpustakaan.</td>
                </tr>
                <tr>
                    <td><strong>2. PENGURUS KELAS</strong><br><span class="tag-badge tag-purple">CLASS OFFICER</span></td>
                    <td>
                        • Pantau 33 Siswa Kelas<br>
                        • Bantu Presensi Beruntun<br>
                        • Lapor Jam Kosong
                    </td>
                    <td>Ketua, Wakil, Sekretaris, dan Bendahara kelas memiliki dasbor khusus. Fitur <strong>Bantu Presensi</strong> memindai kartu pelajar teman menggunakan kamera ML Kit berkelanjutan + suara TTS. Siswa bertanda "Tanpa HP" bebas kuota bantuan & bebas label titip kartu.</td>
                </tr>
                <tr>
                    <td><strong>3. GURU MAPEL</strong><br><span class="tag-badge tag-green">TEACHER</span></td>
                    <td>
                        • 1-Tap Geolocation<br>
                        • Estafet Ruang (NFC/QR)<br>
                        • Token CBT Pengawas<br>
                        • E-File Materi Ajar
                    </td>
                    <td>Absensi datang dan pulang mandiri berbasis GPS. Melakukan *Room Handover* dengan menempelkan NFC stiker pintu ruang kelas atau scan QR Ruang untuk membuka sesi KBM & mengunci presensi rombel. Memantau token CBT dinamis.</td>
                </tr>
                <tr>
                    <td><strong>4. WALI KELAS</strong><br><span class="tag-badge tag-blue">HOMEROOM</span></td>
                    <td>
                        • Monitoring Rombel<br>
                        • Presensi Manual Kelas<br>
                        • Toggle Siswa Tanpa HP<br>
                        • Susunan Pengurus
                    </td>
                    <td>Memantau persentase absensi harian kelas binaan. Melakukan presensi manual darurat (Hadir/Terlambat/Pulang). Menetapkan sakelar <strong>[📵 Tanpa HP]</strong> pada profil siswa yang tidak memiliki gadget.</td>
                </tr>
                <tr>
                    <td><strong>5. GURU BK</strong><br><span class="tag-badge tag-purple">COUNSELOR</span></td>
                    <td>
                        • Pusat Izin Terpadu (AI)<br>
                        • Rekap Poin Tata Tertib<br>
                        • Surat Peringatan (SP)<br>
                        • Gatepass Keluar Kampus
                    </td>
                    <td>Otoritas tunggal verifikasi izin sakit siswa. Didukung <strong>AI Gemini Vision OCR</strong> yang otomatis memvalidasi kop klinik/RS, stempel, dan tanda tangan dokter. Mengelola poin kedisiplinan dan menerbitkan tiket gatepass keluar.</td>
                </tr>
                <tr>
                    <td><strong>6. ORANG TUA</strong><br><span class="tag-badge tag-amber">PARENT</span></td>
                    <td>
                        • Notifikasi Realtime<br>
                        • Pengajuan Izin Kamera<br>
                        • Pantauan Nilai CBT<br>
                        • Verifikasi Biodata
                    </td>
                    <td>Login praktis menggunakan kode <code>P</code> + NISN. Menerima notifikasi instan saat anak hadir, terlambat, pulang, atau dibantu pengurus kelas. Mengajukan izin sakit wajib memotret surat fisik secara langsung (*live camera*).</td>
                </tr>
                <tr>
                    <td><strong>7. SATPAM</strong><br><span class="tag-badge tag-red">SECURITY</span></td>
                    <td>
                        • Scan Barcode Gatepass<br>
                        • Pencatatan Check-Out<br>
                        • Pencatatan Check-In
                    </td>
                    <td>Petugas keamanan memindai tiket gatepass di gerbang sekolah. Mencatat jam keluar dan jam kembali siswa secara digital hingga satuan detik untuk mencegah siswa membolos.</td>
                </tr>
                <tr>
                    <td><strong>8. OPERATOR & ADMIN</strong><br><span class="tag-badge tag-amber">ADMINISTRATOR</span></td>
                    <td>
                        • Reset Device Siswa<br>
                        • Unlock Biodata Siswa<br>
                        • Broadcast Edaran PDF<br>
                        • Rekap Laporan Dinas
                    </td>
                    <td>Membuka ikatan ID HP jika siswa berganti ponsel. Membuka proteksi edit data siswa bagi orang tua. Menyiarkan surat edaran PDF ke seluruh siswa/wali per tingkat, serta mengekspor rekap presensi resmi.</td>
                </tr>
            </tbody>
        </table>

        <!-- 3. ALUR KERJA UTAMA -->
        <h2 class="section-title">3. Analisis Alur Kerja Lengkap Sistem (End-to-End Workflows)</h2>

        <h3 class="sub-section-title">Alur A: Presensi Masuk Siswa Reguler vs Siswa Khusus Tanpa HP</h3>
        <div class="flow-container">
            <div class="flow-step">
                <div class="flow-step-num">1</div>
                <div class="flow-step-content">
                    <strong>Pemeriksaan Metode Kedatangan (06:00 - 07:00 WIB)</strong>
                    <p>Siswa tiba di kelas. Siswa reguler membuka aplikasi Smart CBT di ponselnya, sedangkan siswa yang tidak memiliki ponsel membawa Kartu Pelajar fisik resmi ber-QR Code.</p>
                </div>
            </div>
            <div class="flow-arrow-down">&darr;</div>
            <div class="flow-step">
                <div class="flow-step-num">2</div>
                <div class="flow-step-content">
                    <strong>Pemindaian Barcode & Verifikasi Geofence</strong>
                    <p>• <em>Siswa Reguler:</em> Memindai QR Code proyektor kelas via menu Scanner. GPS diverifikasi &le; 150m dan anti-mock location.<br>
                    • <em>Siswa Tanpa HP:</em> Menunjukkan kartu ke Pengurus Kelas yang mengoperasikan menu [Bantu Presensi].</p>
                </div>
            </div>
            <div class="flow-arrow-down">&darr;</div>
            <div class="flow-step">
                <div class="flow-step-num">3</div>
                <div class="flow-step-content">
                    <strong>Validasi Status & Bypass Aturan Khusus di Server</strong>
                    <p>Server memeriksa status <code>isNoSmartphone</code> pada tabel Settings/User:<br>
                    • <em>Siswa Reguler:</em> Dibatasi kuota 5 bantuan/hari. Jika dibantu &ge; 2x seminggu ditandai <code>[⚠️ SISWA SERING TITIP KARTU]</code>.<br>
                    • <em>Siswa Tanpa HP:</em> <strong>Bebas Kuota (Unlimited)</strong>, bebas sanksi titip kartu, pemindaian instan beruntun (*fast resume* 600ms).</p>
                </div>
            </div>
            <div class="flow-arrow-down">&darr;</div>
            <div class="flow-step">
                <div class="flow-step-num">4</div>
                <div class="flow-step-content">
                    <strong>Umpan Balik Suara (TTS) & Notifikasi Orang Tua</strong>
                    <p>HP membunyikan suara: <em>"Presensi [Nama] berhasil dicatat oleh pengurus kelas"</em>. Server mengirimkan push notification seketika ke akun Orang Tua (<code>P</code>+NISN) bahwa anak telah berada di sekolah.</p>
                </div>
            </div>
        </div>

        <div class="page-break"></div>

        <h3 class="sub-section-title">Alur B: Pengajuan & Verifikasi Surat Izin Sakit AI (Gemini 2.5 Flash Vision)</h3>
        <div class="flow-container">
            <div class="flow-step">
                <div class="flow-step-num">1</div>
                <div class="flow-step-content">
                    <strong>Orang Tua Memotret Surat Dokter via Live Camera</strong>
                    <p>Orang tua masuk menu Perizinan di aplikasi dan wajib memotret surat fisik keterangan dokter secara langsung (akses unggah galeri dinonaktifkan demi mencegah pemalsuan foto usang).</p>
                </div>
            </div>
            <div class="flow-arrow-down">&darr;</div>
            <div class="flow-step">
                <div class="flow-step-num">2</div>
                <div class="flow-step-content">
                    <strong>Pemrosesan Dokumen oleh Gemini AI Vision OCR</strong>
                    <p>Server mengirim citra surat ke model Google Gemini 2.5 Flash untuk membaca: kop puskesmas/klinik, nama pasien, tanggal periksa, jumlah hari istirahat, serta keberadaan stempel basah dan tanda tangan.</p>
                </div>
            </div>
            <div class="flow-arrow-down">&darr;</div>
            <div class="flow-step">
                <div class="flow-step-num">3</div>
                <div class="flow-step-content">
                    <strong>Pemberian Keputusan Otomatis vs Antrean Manual BK</strong>
                    <p>• <em>Lolos Aturan (Kop sah + cap ada + nama cocok):</em> <strong>AUTO-APPROVE</strong> instan oleh sistem.<br>
                    • <em>Anomali (Tanpa stempel, tanggal lampau, nama berbeda):</em> Dialihkan ke antrean verifikasi manual Guru BK.</p>
                </div>
            </div>
            <div class="flow-arrow-down">&darr;</div>
            <div class="flow-step">
                <div class="flow-step-num">4</div>
                <div class="flow-step-content">
                    <strong>Pembaruan Status Presensi & Penyiaran Notifikasi</strong>
                    <p>Status kehadiran siswa otomatis berubah menjadi SAKIT/IZIN. Notifikasi disiarkan ke akun Siswa, Wali Kelas, Guru Mapel hari tersebut, dan Pengurus Kelas.</p>
                </div>
            </div>
        </div>

        <h3 class="sub-section-title">Alur C: Ujian CBT Kiosk Anti-Kecurangan (Exambro Gateway & Exam Activity)</h3>
        <div class="flow-container">
            <div class="flow-step">
                <div class="flow-step-num">1</div>
                <div class="flow-step-content">
                    <strong>Verifikasi Token Ujian di Gateway</strong>
                    <p>Siswa membuka <code>ExambroGatewayActivity</code>, memilih ujian aktif, lalu memasukkan token 6 digit atau memindai barcode token dari layar Guru Pengawas.</p>
                </div>
            </div>
            <div class="flow-arrow-down">&darr;</div>
            <div class="flow-step">
                <div class="flow-step-num">2</div>
                <div class="flow-step-content">
                    <strong>Aktivasi Kiosk Mode & Immersive Fullscreen</strong>
                    <p>Aplikasi mengunci antarmuka ponsel: bilah navigasi dan status bar disembunyikan permanen, clipboard dinetralkan, fungsi tombol fisik kembali (*Back*) dinonaktifkan.</p>
                </div>
            </div>
            <div class="flow-arrow-down">&darr;</div>
            <div class="flow-step">
                <div class="flow-step-num">3</div>
                <div class="flow-step-content">
                    <strong>Pengerjaan Soal & Pendeteksian Kecurangan (Strike System)</strong>
                    <p>Jawaban disimpan berlapis pada Room DB lokal dan server. Jika siswa berpindah aplikasi, membuka floating window, atau mencoba mengambil screenshot, sistem menambah 1 poin pelanggaran (*Strike*). Jika strike melampaui batas toleransi pengawas, lembar ujian otomatis terkunci dan jawaban disetor paksa ke server.</p>
                </div>
            </div>
        </div>

        <div class="page-break"></div>

        <!-- 4. CHECKLIST PENGUJIAN LAPANGAN -->
        <h2 class="section-title">4. Lembar Periksa Kesiapan Operasional (Printable Operational Checklist - F4 / Folio)</h2>
        <p style="margin-bottom: 10px;">Beri tanda centang ( &check; ) pada kotak yang telah berhasil diuji dan diverifikasi sebelum pengoperasian penuh:</p>

        <!-- KELOMPOK A -->
        <table class="checklist-table avoid-break">
            <thead>
                <tr>
                    <th colspan="3">A. INISIALISASI, PERIZINAN & KONEKTIVITAS APLIKASI</th>
                </tr>
                <tr>
                    <th style="width: 34px; text-align: center;">Status</th>
                    <th style="width: 35%;">Item Pemeriksaan</th>
                    <th style="width: 60%;">Kriteria Keberhasilan / Verifikasi Lapangan</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Izin Kamera & Lokasi</strong></td>
                    <td>Aplikasi meminta izin Kamera dan Lokasi (Fine/Coarse) pada peluncuran perdana dan berfungsi normal.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Izin Akses Berkas Penuh</strong></td>
                    <td>Dialog pengarah membuka menu <code>MANAGE_EXTERNAL_STORAGE</code> untuk sinkronisasi materi dan berkas telemetri.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Pencegahan GPS Mati</strong></td>
                    <td>Aplikasi menampilkan dialog wajib aktifkan GPS dan memblokir layar presensi jika toggle lokasi HP dalam keadaan mati.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Dual-Server Handshake</strong></td>
                    <td>Aplikasi sukses terhubung ke VPS <code>cbt.smpn1boyolangu.my.id</code> saat online; beralih ke LAN saat offline tanpa crash.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>In-App Self Updater</strong></td>
                    <td>Notifikasi versi baru muncul otomatis dan dapat menginstal APK terbaru (v2.8.113) secara langsung.</td>
                </tr>
            </tbody>
        </table>

        <!-- KELOMPOK B -->
        <table class="checklist-table avoid-break">
            <thead>
                <tr>
                    <th colspan="3">B. AUTENTIKASI PENGGUNA & KEAMANAN PERANGKAT</th>
                </tr>
                <tr>
                    <th style="width: 34px; text-align: center;">Status</th>
                    <th style="width: 35%;">Item Pemeriksaan</th>
                    <th style="width: 60%;">Kriteria Keberhasilan / Verifikasi Lapangan</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Login Akun Siswa</strong></td>
                    <td>Siswa berhasil login menggunakan 10 digit NISN tanpa kendala format kredensial.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Login Akun Orang Tua</strong></td>
                    <td>Wali murid berhasil login menggunakan awalan <code>P</code> + NISN dan diarahkan ke antarmuka Orang Tua.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Login Guru & Staf</strong></td>
                    <td>Guru/Staf berhasil login menggunakan NIP 18 digit atau username resmi dengan kata sandi terdaftar.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Device Binding Anti-Joki</strong></td>
                    <td>Percobaan login akun siswa yang sama pada ponsel kedua ditolak dengan pesan peringatan perangkat tidak cocok.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Reset Device Operator</strong></td>
                    <td>Operator sekolah dapat mereset ikatan perangkat siswa sehingga siswa dapat login kembali di ponsel baru.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Sesi Login Permanen</strong></td>
                    <td>Sesi akun tersimpan persisten (*Permanent Session*) tanpa auto-logout saat aplikasi ditutup dan dibuka kembali.</td>
                </tr>
            </tbody>
        </table>

        <!-- KELOMPOK C -->
        <table class="checklist-table avoid-break">
            <thead>
                <tr>
                    <th colspan="3">C. VALIDASI PRESENSI & PERLINDUNGAN GEOLOCATION</th>
                </tr>
                <tr>
                    <th style="width: 34px; text-align: center;">Status</th>
                    <th style="width: 35%;">Item Pemeriksaan</th>
                    <th style="width: 60%;">Kriteria Keberhasilan / Verifikasi Lapangan</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Radius Geofence Sekolah</strong></td>
                    <td>Presensi diterima saat posisi HP &le; 150 meter dari titik koordinat resmi SMPN 1 Boyolangu.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Penolakan Luar Radius</strong></td>
                    <td>Presensi ditolak dengan pesan informatif jika siswa berada di luar pagar sekolah (> 150 meter).</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Pencegahan Fake / Mock GPS</strong></td>
                    <td>Presensi otomatis digugurkan jika sistem mendeteksi aplikasi pemalsu koordinat (Mock Provider).</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Batas Jam Kedatangan</strong></td>
                    <td>Presensi sebelum 07:00:00 WIB tercatat <strong>HADIR</strong>; presensi &ge; 07:00:00 WIB tercatat <strong>TERLAMBAT</strong>.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Respons Suara TTS</strong></td>
                    <td>Speaker HP mengeluarkan suara berbahasa Indonesia menyebutkan nama dan status presensi siswa.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Anti-Double Scanning</strong></td>
                    <td>Memindai barcode yang sama dua kali pada sesi yang sama menampilkan notifikasi presensi telah tercatat.</td>
                </tr>
            </tbody>
        </table>

        <div class="page-break"></div>

        <!-- KELOMPOK D -->
        <table class="checklist-table avoid-break">
            <thead>
                <tr>
                    <th colspan="3">D. FITUR KHUSUS PENGURUS KELAS & SISWA TANPA HP</th>
                </tr>
                <tr>
                    <th style="width: 34px; text-align: center;">Status</th>
                    <th style="width: 35%;">Item Pemeriksaan</th>
                    <th style="width: 60%;">Kriteria Keberhasilan / Verifikasi Lapangan</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Hak Akses Menu Pengurus</strong></td>
                    <td>Menu Pengurus Kelas hanya muncul jika akun siswa tercatat sebagai <code>isClassOfficer: true</code>.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Pantau Teman Rombel</strong></td>
                    <td>Tab pemantauan menampilkan 33-34 siswa sekelas dengan indikator warna status kehadiran yang presisi.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Toggle Siswa Tanpa HP</strong></td>
                    <td>Wali Kelas / BK / Operator dapat mengaktifkan tanda <code>[📵 Tanpa HP]</code> pada siswa tanpa gadget.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Bypass Kuota Bantuan</strong></td>
                    <td>Pengurus kelas dapat memindai &ge; 6 siswa bertanda tanpa HP tanpa terhalang limit kuota 5 siswa reguler.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Bebas Sanksi Titip Kartu</strong></td>
                    <td>Siswa bertanda tanpa HP yang dipindai setiap hari tidak mendapat peringatan <code>[⚠️ SISWA SERING TITIP KARTU]</code>.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Fast Rapid Continuous Scan</strong></td>
                    <td>Kamera pemindai langsung aktif kembali dalam 600 ms setelah membaca kartu siswa tanpa popup dialog lambat.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Toggle Datang & Pulang</strong></td>
                    <td>Pengurus kelas dapat mengalihkan mode scanner antara <strong>Gate-In (Masuk)</strong> dan <strong>Gate-Out (Pulang)</strong>.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Lapor Jam Pelajaran Kosong</strong></td>
                    <td>Pengurus kelas dapat mengirim laporan jam kosong beserta nama mapel ke notifikasi Guru Piket.</td>
                </tr>
            </tbody>
        </table>

        <!-- KELOMPOK E -->
        <table class="checklist-table avoid-break">
            <thead>
                <tr>
                    <th colspan="3">E. SISTEM UJIAN CBT KIOSK ANTI-KECURANGAN</th>
                </tr>
                <tr>
                    <th style="width: 34px; text-align: center;">Status</th>
                    <th style="width: 35%;">Item Pemeriksaan</th>
                    <th style="width: 60%;">Kriteria Keberhasilan / Verifikasi Lapangan</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Validasi Token Ujian</strong></td>
                    <td>Ujian hanya dapat dimulai jika token 6 digit atau hasil scan QR token proktor cocok dengan data server.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Kunci Layar Penuh (Immersive)</strong></td>
                    <td>Bilah navigasi bawah dan status bar atas terkunci rapat selama pengerjaan soal berlangsung.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Pencegahan Salin/Tempel</strong></td>
                    <td>Fungsi salin teks soal dinonaktifkan dan isi clipboard memory otomatis dikosongkan.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Deteksi Focus Loss (Strike)</strong></td>
                    <td>Membuka aplikasi lain, notifikasi, atau pop-up memicu penambahan 1 poin strike pelanggaran.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Penguncian Lembar Jawaban</strong></td>
                    <td>Jika strike melebihi toleransi proktor, sesi ujian terkunci permanen dan jawaban disetor otomatis ke server.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Cache Jawaban Lokal (Room DB)</strong></td>
                    <td>Setiap butir jawaban yang dipilih tersimpan di database lokal SQLite sehingga aman bila HP mati mendadak.</td>
                </tr>
            </tbody>
        </table>

        <!-- KELOMPOK F -->
        <table class="checklist-table avoid-break">
            <thead>
                <tr>
                    <th colspan="3">F. GURU BK, WALI KELAS & AI SURAT IZIN DOKTER</th>
                </tr>
                <tr>
                    <th style="width: 34px; text-align: center;">Status</th>
                    <th style="width: 35%;">Item Pemeriksaan</th>
                    <th style="width: 60%;">Kriteria Keberhasilan / Verifikasi Lapangan</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Monitoring Rombel Wali Kelas</strong></td>
                    <td>Wali kelas dapat melihat daftar siswa yang hadir, terlambat, sakit, atau izin secara real-time.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Presensi Manual Wali Kelas</strong></td>
                    <td>Wali kelas dapat menandai kehadiran darurat siswa (Hadir, Terlambat, Pulang) tanpa opsi sakit/izin.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Pemisahan Otoritas Izin</strong></td>
                    <td>Wewenang persetujuan izin sepenuhnya dipegang oleh Guru BK; wali kelas hanya menerima notifikasi tembusan.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Analisis Gemini Vision OCR</strong></td>
                    <td>AI Vision membaca kop instansi medis, nama siswa, tanggal surat, dan stempel pada foto surat izin.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Auto-Approve Surat Sah</strong></td>
                    <td>Surat dokter lengkap berstempel basah disetujui otomatis oleh sistem tanpa intervensi manual.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Penyaringan Anomali Medis</strong></td>
                    <td>Surat tanpa stempel, tanggal lampau, atau foto buram dialihkan ke daftar antrean telaah manual Guru BK.</td>
                </tr>
            </tbody>
        </table>

        <!-- KELOMPOK G -->
        <table class="checklist-table avoid-break">
            <thead>
                <tr>
                    <th colspan="3">G. GURU MAPEL, POS SATPAM & ORANG TUA</th>
                </tr>
                <tr>
                    <th style="width: 34px; text-align: center;">Status</th>
                    <th style="width: 35%;">Item Pemeriksaan</th>
                    <th style="width: 60%;">Kriteria Keberhasilan / Verifikasi Lapangan</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Presensi 1-Tap Geolocation Guru</strong></td>
                    <td>Guru dapat melakukan absensi datang dan pulang dengan 1 sentuhan berbasis titik GPS sekolah.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Estafet Ruang KBM (NFC/QR)</strong></td>
                    <td>Menempelkan stiker NFC atau memindai barcode ruang kelas membuka sesi mengajar dan mengisi jurnal guru.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Notifikasi Realtime Orang Tua</strong></td>
                    <td>Orang tua menerima notifikasi instan saat anak hadir, terlambat, pulang, atau dibantu presensi oleh pengurus.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Foto Izin Wajib Live Camera</strong></td>
                    <td>Formulir pengajuan izin sakit orang tua mewajibkan potret kamera langsung (tombol galeri ditiadakan).</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Scanner Gatepass Pos Satpam</strong></td>
                    <td>Satpam dapat memindai tiket gatepass izin keluar siswa di pos penjagaan gerbang sekolah.</td>
                </tr>
                <tr>
                    <td class="col-box"><span class="check-box-square"></span></td>
                    <td><strong>Pencatatan Check-Out & Check-In</strong></td>
                    <td>Jam keluar dan jam kembali siswa tercatat digital secara akurat hingga satuan detik di pos satpam.</td>
                </tr>
            </tbody>
        </table>

        <!-- LEMBAR PENGESAHAN RESMI -->
        <div class="avoid-break" style="margin-top: 24px; border-top: 1.5px solid #0f172a; padding-top: 14px;">
            <div style="text-align: right; font-size: 8.5pt; color: #334155; margin-bottom: 8px;">
                Ditetapkan di: Boyolangu, Tulungagung<br>
                Pada tanggal: ..................................................... 2026
            </div>
            <table class="signature-section">
                <tr>
                    <td>
                        <strong>Mengetahui & Menyetujui,</strong><br>
                        Kepala SMP Negeri 1 Boyolangu
                        <div class="sig-space"></div>
                        <strong><u>( ..................................................................... )</u></strong><br>
                        NIP. .............................................................
                    </td>
                    <td>
                        <strong>Memeriksa & Memvalidasi,</strong><br>
                        Koordinator IT & Kurikulum
                        <div class="sig-space"></div>
                        <strong><u>( ..................................................................... )</u></strong><br>
                        NIP. .............................................................
                    </td>
                    <td>
                        <strong>Pelaksana Teknis,</strong><br>
                        Operator Smart School CBT
                        <div class="sig-space"></div>
                        <strong><u>( ..................................................................... )</u></strong><br>
                        NIP. .............................................................
                    </td>
                </tr>
            </table>
        </div>

    </div>

</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'DOKUMEN_ANALISIS_FITUR_DAN_ALUR_APK_SMARTCBT.html'), htmlContent, 'utf8');
console.log('SUCCESS_F4_HTML_CREATED');
