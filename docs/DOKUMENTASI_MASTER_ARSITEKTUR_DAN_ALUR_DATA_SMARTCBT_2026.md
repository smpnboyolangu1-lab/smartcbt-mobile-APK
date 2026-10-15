# DOKUMENTASI MASTER ARSITEKTUR, FITUR, DAN ALUR DATA SISTEM SMARTCBT
## SMP NEGERI 1 BOYOLANGU (EDISI TERBARU 2026 - v2.9.1 BUILD 171)

Dokumen ini merupakan acuan arsitektur komprehensif, kamus endpoint, model data, dan spesifikasi alur data end-to-end untuk aplikasi Android Native (**SmartCBT**) dan Web Portal Administrasi (**SmartSchool Portal**). Dokumen ini disusun secara rinci dan terstandarisasi untuk keperluan audit multi-AI, penjaminan mutu rekayasa perangkat lunak, serta kepatuhan keamanan data institusi pendidikan.

---

## DAFTAR ISI
1. [Ringkasan Eksekutif & Topologi Sistem](#1-ringkasan-eksekutif--topologi-sistem)
2. [Matriks Aktor, Peran, & Hak Akses](#2-matriks-aktor-peran--hak-akses)
3. [Alur Data End-to-End & Diagram Mermaid](#3-alur-data-end-to-end--diagram-mermaid)
   - [3.1 Presensi Kelas Mandiri (Rolling QR & Geofence)](#31-presensi-kelas-mandiri-rolling-qr--geofence)
   - [3.2 Presensi Dibantu Pengurus Kelas (Kartu Fisik / Siswa Tanpa HP)](#32-presensi-dibantu-pengurus-kelas-kartu-fisik--siswa-tanpa-hp)
   - [3.3 Digital Gatepass Boarding-Pass & Pos Satpam Checkpoint](#33-digital-gatepass-boarding-pass--pos-satpam-checkpoint)
   - [3.4 Tahfiz Juz 30 & Target Hafalan Terintegrasi](#34-tahfiz-juz-30--target-hafalan-terintegrasi)
   - [3.5 CBT Exam Gateway & Kiosk Security HUD](#35-cbt-exam-gateway--kiosk-security-hud)
   - [3.6 Manajemen Remote Device & Efisiensi Penyimpanan](#36-manajemen-remote-device--efisiensi-penyimpanan)
   - [3.7 Kesiswaan 360, Kedisiplinan Poin & Pelanggaran](#37-kesiswaan-360-kedisiplinan-poin--pelanggaran)
   - [3.8 Keamanan E-Kantin & Midtrans Payment Hard-Lock](#38-keamanan-e-kantin--midtrans-payment-hard-lock)
4. [Katalog Endpoint & Matriks Otorisasi API](#4-katalog-endpoint--matriks-otorisasi-api)
5. [Skema Database & Integritas Transaksi Konkurensi](#5-skema-database--integritas-transaksi-konkurensi)
6. [Mekanisme Sinkronisasi Offline & Idempotensi Data](#6-mekanisme-sinkronisasi-offline--idempotensi-data)
7. [Mitigasi Kerentanan Keamanan (IDOR, Anti-Race, Sanitasi)](#7-mitigasi-kerentanan-keamanan-idor-anti-race-sanitasi)

---

## 1. RINGKASAN EKSEKUTIF & TOPOLOGI SISTEM

### 1.1 Lingkungan Operasional
- **Lokasi Pemasangan**: Server On-Premise SMPN 1 Boyolangu dengan eksposur aman via Cloudflare Tunnel.
- **Backend Runtime**: Node.js v24 LTS, Express.js 5, TypeScript 5, Prisma ORM 5.
- **Process Manager**: PM2 Cluster (proses `"smart-school-backend"`) dengan restart persistensi.
- **Mesin Database**: 
  - *Produksi Saat Ini*: SQLite (`backend/prisma/dev.db`, mode WAL - Write-Ahead Logging, PRAGMA synchronous = NORMAL, cache_size = -64000).
  - *Target Migrasi*: PostgreSQL 16 (seluruh model data, skema, dan kueri dirancang 100% kompatibel tanpa dialek raw query non-standar).
- **Aplikasi Klien Native**: Android Native Kotlin (minSdk 24 - Android 7.0, targetSdk 34 - Android 14, ViewBinding, Retrofit2, OkHttp3, CameraX, ZXing core, MPAndroidChart).
- **Portal Web**: Server-Side Rendering (SSR) EJS + TailwindCSS / Bootstrap 5 + Socket.IO client untuk telemetri dan notifikasi seketika.
- **Jaringan & Topologi IP**: Klien siswa/guru mengakses melalui LAN internal sekolah dan koneksi seluler di balik NAT operator (Carrier-Grade NAT) dan Cloudflare Tunnel. Oleh karena itu, resolusi IP klien menggunakan urutan prioritas header: `cf-connecting-ip` $\rightarrow$ `x-real-ip` $\rightarrow$ `x-forwarded-for` $\rightarrow$ `socket.remoteAddress`. Rate-limiting dan proteksi brute-force ditegakkan per **User/Device Identifier**, bukan IP bersama.

```mermaid
flowchart TD
    subgraph ClientLayer ["LAPISAN KLIEN"]
        APK_STUDENT["📱 APK Siswa (Android Kotlin)\n• Presensi Mandiri\n• CBT Kiosk Lock\n• Digital Gatepass\n• Tahfiz Juz 30"]
        APK_PENGURUS["📱 APK Pengurus Kelas\n• Buka Sesi Kelas\n• Scan Bantuan Siswa Tanpa HP\n• Popup Pasfoto Biometrik"]
        WEB_PORTAL["💻 Portal Web (EJS + Socket.IO)\n• Admin & Operator\n• Guru & Wali Kelas\n• Guru BK / Konselor\n• Pos Keamanan Satpam"]
    end

    subgraph NetworkLayer ["LAPISAN JARINGAN & PROKSI"]
        CF_TUNNEL["🛡️ Cloudflare Tunnel\n• TLS Termination\n• DDoS Mitigation\n• Header CF-Connecting-IP"]
        LAN_GATEWAY["🏢 Router LAN Sekolah\n• Radius WiFi Whitelist\n• NAT Internal"]
    end

    subgraph BackendLayer ["LAPISAN SERVER BACKEND (Node 24 / PM2)"]
        EXPRESS["🚀 Express 5 API Server\n• JWT Verification & Role ACL\n• Input Sanitization (Zod/Regex)\n• Mutex Advisory Lock"]
        SOCKET_IO["⚡ Socket.IO Server\n• Broadcast Sesi Kelas\n• Telemetri Kiosk CBT\n• Live Status Gatepass"]
        SCHEDULER["⏰ Cron Scheduler\n• Auto-Close Sesi 07:00 WIB\n• Evaluasi Presensi Akhir Hari"]
    end

    subgraph DataLayer ["LAPISAN DATA & ASSET"]
        SQLITE_DB[("🗄️ SQLite DB (WAL Mode)\nDual Compatible PostgreSQL\n• dev.db + dev.db-wal")]
        UPLOADS["📁 File Storage Disk\n• Pasfoto Siswa /siswa/\n• Dokumen Sakit /surat/\n• Device Files /device-files/"]
    end

    APK_STUDENT --> CF_TUNNEL
    APK_PENGURUS --> CF_TUNNEL
    WEB_PORTAL --> CF_TUNNEL
    APK_STUDENT --> LAN_GATEWAY
    LAN_GATEWAY --> EXPRESS
    CF_TUNNEL --> EXPRESS
    EXPRESS --> SOCKET_IO
    EXPRESS --> SQLITE_DB
    EXPRESS --> UPLOADS
    SCHEDULER --> SQLITE_DB
```

---

## 2. MATRIKS AKTOR, PERAN, & HAK AKSES

| Peran (Role) | Platform Utama | Fitur & Wewenang Utama | Pembatasan Ketat & Keamanan |
| :--- | :--- | :--- | :--- |
| **ADMIN** | Web Portal | Manajemen pengguna penuh, konfigurasi sistem, audit log, kontrol rilis APK, pembatalan darurat, manajemen database. | Wajib 2FA/Password kuat, pencatatan IP & Device di `ActivityLog`. |
| **OPERATOR** | Web Portal | Pengaturan jadwal KBM, distribusi CBT, penomoran ruang ujian, manajemen master siswa dan rombel. | Tidak dapat mengubah skema database dan konfigurasi payment gateway. |
| **GURU** | Web Portal | Penginputan nilai raport, ulangan harian, modul ajar, presensi mengajar, verifikasi setoran hafalan Tahfiz. | Terisolasi hanya pada mata pelajaran dan kelas yang diampu. |
| **WALI_KELAS** | Web Portal | Monitoring presensi harian kelas binaan, validasi pengurus kelas, evaluasi kedisiplinan dan poin siswa, buku leger. | Terkunci hanya pada rombel binaan (`user.className`). |
| **BK / COUNSELOR** | Web Portal | Approval perizinan keluar gerbang (Digital Gatepass), konseling 360, penanganan siswa terlambat, riwayat kasus. | Akses data sensitif siswa dibatasi kelas binaan BK. |
| **SATPAM** | Web Portal / Kiosk | Scanner pos gerbang satpam, validasi tiket Gatepass keluar/masuk, verifikasi penjemput siswa darurat. | Akses terbatas hanya pada modul `/satpam/gatepass` & `/api/gatepass/verify`. |
| **PENGURUS_KELAS** | APK Android | Membuka sesi presensi kelas mandiri, melakukan assisted-scan bagi teman sekelas yang tidak membawa smartphone. | Dibatasi geofence sekolah (30m), kuota scan harian, validasi identitas pengurus via server. |
| **SISWA** | APK Android | Presensi mandiri via QR kelas, pengerjaan ujian CBT terkunci, pengajuan Gatepass, setoran Tahfiz, monitoring jadwal & nilai. | Single-device binding (IMEI/UUID), anti-fake GPS, anti-root, auto-kiosk lock saat ujian. |
| **ORANG_TUA** | Web / APK | Monitoring real-time kehadiran anak, rekap nilai, notifikasi kepulangan/izin, riwayat pelanggaran & reward. | IDOR Protection: Wajib terverifikasi di tabel `ParentStudentLink` atau NISN identik. |

---

## 3. ALUR DATA END-TO-END & DIAGRAM MERMAID

### 3.1 Presensi Kelas Mandiri (Rolling QR & Geofence)
Presensi masuk pagi siswa dilakukan langsung di dalam ruang kelas dengan memindai kode QR sesi kelas yang berputar setiap 10-15 detik untuk mencegah kecurangan titip absen via foto/screenshot.

```mermaid
sequenceDiagram
    autonumber
    actor Siswa as 📱 Siswa (APK)
    participant App as SmartCBT App
    participant Server as Express API (/api/class-session)
    participant DB as Database (SQLite/Postgres)
    participant Room as Socket.IO (Room: class_*)

    Note over Siswa,Server: Sesi dibuka oleh Wali Kelas / Pengurus Kelas (06:00 - 07:00 WIB)
    Server->>Room: Broadcast QR Token Baru (Rolling interval 10s)
    App->>App: Scan QR di layar kelas + Ambil GPS akurat (< 30m)
    App->>Server: POST /api/class-session/scan {sessionId, qrToken, lat, lng, accuracy}
    Server->>Server: Verifikasi JWT Siswa & Kelas Siswa
    Server->>Server: Validasi GPS Geofence (Haversine Formula <= 30m)
    Server->>Server: Validasi qrToken aktif (Hash SHA-256 + Timestamp)
    
    critical Atomic Database Transaction (prisma.$transaction)
        Server->>DB: Cek duplikasi di ClassAttendanceRecord (sessionId, studentId)
        alt Sudah Ada Presensi Hari Ini
            DB-->>Server: Unique Constraint P2002 / Duplicate
            Server-->>App: HTTP 200 {success: false, alreadyScanned: true, message: "Anda sudah melakukan presensi"}
        else Belum Presensi
            Server->>DB: INSERT INTO ClassAttendanceRecord (status: PRESENT, isLate: now > 07:00)
            Server->>DB: UPSERT INTO Attendance (type: GATE_IN, dateKey: "YYYY-MM-DD")
        end
    end

    Server-->>Room: Emisi event 'studentScanned' (Update live tile di proyektor kelas)
    Server-->>App: HTTP 200 {success: true, timeStr: "06:45:12 WIB", isLate: false}
    App->>App: Suara TTS: "Presensi berhasil, terima kasih"
```

### 3.2 Presensi Dibantu Pengurus Kelas (Kartu Fisik / Siswa Tanpa HP)
Bagi siswa yang tidak membawa smartphone atau mengalami kendala baterai/perangkat, pengurus kelas resmi memindai barcode kartu fisik siswa menggunakan modul Pengurus Kelas.

```mermaid
sequenceDiagram
    autonumber
    actor Pengurus as 📱 Pengurus Kelas (APK)
    actor SiswaTanpaHP as 👤 Siswa Tanpa HP
    participant App as SmartCBT App
    participant Server as Express API (/api/class-session)
    participant DB as Database
    
    Pengurus->>App: Buka Modul "Bantu Presensi Teman" (Kamera Standby)
    SiswaTanpaHP->>Pengurus: Tunjukkan Kartu Fisik / Kartu Pelajar (Barcode NISN)
    App->>App: CameraX memindai barcode + GPS akurat
    App->>Server: POST /api/class-session/assisted-scan {barcodeValue: "0081234567", scanType: "GATE_IN"}
    
    Server->>Server: Verifikasi JWT Pengurus (Cek role pengurus & kecocokan rombel)
    Server->>DB: Cari Siswa berdasarkan NISN / Barcode
    
    critical Atomic Dual-Write Transaction
        Server->>DB: Cek kuota bantu pengurus & duplikasi presensi hari ini
        Server->>DB: INSERT INTO ClassAttendanceRecord (method: ASSISTED_SCAN, officerId: pengurusId)
        Server->>DB: UPSERT INTO Attendance (studentId, dateKey, type: GATE_IN)
    end
    
    Server-->>App: HTTP 200 {success: true, student: {name, nisn, className, profilePicUrl, isLate}}
    App->>App: TTS: "Presensi [Nama Siswa] berhasil dicatat oleh pengurus kelas"
    App->>App: Tampilkan POPUP MODAL KONFIRMASI:\n• Pasfoto Biometrik Resmi Siswa\n• Nama Lengkap & NISN\n• Badge "📱 Siswa Tanpa HP"\n• Waktu Presensi & Status (Tepat Waktu/Terlambat)
    Pengurus->>App: Klik "Lanjut Scan Siswa Berikutnya"
```

### 3.3 Digital Gatepass Boarding-Pass & Pos Satpam Checkpoint
Siswa yang sakit, memiliki dispensasi lomba, atau urusan mendesak harus melalui persetujuan Guru BK sebelum dapat meninggalkan area sekolah.

```mermaid
sequenceDiagram
    autonumber
    actor Siswa as 📱 Siswa (APK)
    actor BK as 💻 Guru BK (Portal)
    actor Satpam as 🛡️ Satpam (Portal/Kiosk)
    participant Server as Express API
    participant DB as Database

    Siswa->>Server: POST /api/leave/request {category: SAKIT/DISPENSASI, reason, pickupPerson}
    Server->>DB: INSERT INTO LeaveRequest (status: PENDING)
    Server-->>BK: Notifikasi real-time persetujuan izin di Dashboard BK
    
    BK->>Server: POST /api/bk/leave/:id/approve {approved: true, note, doctorVisitNeeded}
    Server->>DB: UPDATE LeaveRequest SET status = 'APPROVED', approvedBy = bkId
    
    Siswa->>Server: GET /api/gatepass/active-ticket
    Server-->>Siswa: Tiket Digital Boarding Pass + Dynamic QR (Hash berputar per 30s)
    
    Note over Siswa,Satpam: Siswa menuju pos gerbang sekolah
    Satpam->>Server: POST /api/gatepass/verify {ticketCode, qrHash}
    
    critical Atomic Checkout Transaction (Pencegahan Double-Exit)
        Server->>DB: SELECT LeaveRequest WHERE id = ticketId AND status = 'APPROVED'
        alt Tiket Sudah Pernah Digunakan / Kedaluwarsa
            Server-->>Satpam: HTTP 409 {success: false, message: "Tiket sudah digunakan sebelumnya!"}
        else Tiket Valid & Aktif
            Server->>DB: UPDATE LeaveRequest SET status = 'COMPLETED', exitTime = NOW()
            Server->>DB: INSERT INTO Attendance (studentId, dateKey, type: 'GATE_OUT')
        end
    end
    
    Server-->>Satpam: HTTP 200 {verified: true, studentName, class, photoUrl, pickupPerson}
    Satpam->>Satpam: Buka palang gerbang & verifikasi penjemput
    Server-->>Siswa: Push Notifikasi: "Izin keluar telah diverifikasi oleh Satpam. Hati-hati di jalan."
```

### 3.4 Tahfiz Juz 30 & Target Hafalan Terintegrasi
Modul hafalan mandiri siswa dengan fitur pemilihan metode setoran eksklusif (Tatap Muka Langsung vs Rekaman Audio) dan sinkronisasi target dari Guru PAI.

```mermaid
flowchart TD
    A["📱 Siswa Buka Modul Tahfiz"] --> B{"Pilih Tab Operasi"}
    B -->|Tab Surat| C["37 Surat Juz 'Amma (An-Naba s.d. An-Nas)\n• Audio Murattal Streaming\n• Status: Mutqin / Progres / Murojaah"]
    B -->|Tab Target| D["Sinkronisasi Target dari Guru PAI\n• GET /api/tahfiz/students/:id\n• Menampilkan deadline ayat per semester"]
    B -->|Tab Setor| E["Formulir Pengajuan Setoran Baru"]
    
    E --> F["Pilih Surat & Rentang Ayat (mis. An-Nazi'at 1-15)"]
    F --> G{"Metode Setoran (Single-Choice Pill)"}
    G -->|🗣️ Langsung| H["Setoran Tatap Muka di Kelas / Masjid"]
    G -->|🎧 Audio| I["Upload Rekaman Suara Siswa"]
    
    H --> J["POST /api/tahfiz/setoran\n{surahNumber, ayatStart, ayatEnd, metode, notes}"]
    I --> J
    
    J --> K[("Database Tahfiz\nStatus: MENUNGGU_VALIDASI")]
    K --> L["💻 Guru PAI Membuka Portal Tahfiz"]
    L --> M["Evaluasi: Nilai Tajwid, Kelancaran, Makhraj (0-100) + Catatan"]
    M --> N["Update Status: MUTQIN / PERLU_MUROJAAH"]
    N --> O["📱 Update Real-Time di Dashboard Siswa & Notifikasi Orang Tua"]
```

### 3.5 CBT Exam Gateway & Kiosk Security HUD
Ujian sekolah berbasis komputer dengan perlindungan berlapis di sisi aplikasi Android untuk menjamin integritas evaluasi akademik.

```mermaid
flowchart TD
    subgraph KioskInit ["INISIALISASI & DETEKSI KEAMANAN"]
        START["Siswa Masuk Modul CBT Exam"] --> DETECT_ETH["Cek Sambungan Jaringan\n(Prioritas LAN Sekolah / SSID Resmi)"]
        DETECT_ETH --> DETECT_ROOT["Cek Integritas: Root, Magisk, Debugger, Dev Options"]
        DETECT_ROOT --> DETECT_FLOAT["Deteksi Floating Apps, Split Screen, Multi-Window"]
    end

    subgraph SecurityLock ["KIOSK LOCKDOWN"]
        DETECT_FLOAT -->|Lolos Uji Keamanan| LOCK_TASK["Aktifkan Android LockTaskMode\n(Tombol Home, Back, Recent Apps Terkunci)"]
        DETECT_FLOAT -->|Gagal| REJECT["Tolak Akses & Laporkan Pelanggaran ke Server"]
    end

    subgraph ExamSession ["PENGERJAAN UJIAN"]
        LOCK_TASK --> DOWNLOAD_EXAM["Ambil Paket Soal Terenkripsi AES-256"]
        DOWNLOAD_EXAM --> RENDER_SOAL["Tampilkan CBT HUD Diagnostic\n(Status Baterai, Ping Jaringan, Indikator Lock)"]
        RENDER_SOAL --> HEARTBEAT["Kirim Heartbeat Socket.IO per 10s ke Proktor"]
        RENDER_SOAL --> ATTEMPT_LEAVE{"Apakah Siswa Berusaha Keluar?"}
        ATTEMPT_LEAVE -->|Ya| WARN_COUNT["Peringatan Keamanan (Maksimal 3x) -> Diskualifikasi"]
        ATTEMPT_LEAVE -->|Tidak| FINISH_SUBMIT["Kirim Jawaban Final -> Dekripsi Token Selesai"]
    end
```

### 3.6 Manajemen Remote Device & Efisiensi Penyimpanan
Optimalisasi manajemen file perangkat jarak jauh yang dikelola sekolah.

```mermaid
flowchart LR
    A["📱 Perangkat Siswa (Background Service)"] -->|Sinkronisasi Daftar Berkas| B["Kirim Metadata File SAJA\n(fileName, size, ext, mimeType, timestamp)\n🚫 TANPA THUMBNAIL BASE64"]
    B --> C["🚀 Server Express (/api/device/files/sync)"]
    C --> D[("🗄️ Database: DeviceFile\n(thumbnailBase64 = NULL)\nMenghemat > 90% Ukuran DB")]
    
    E["💻 Admin Portal Membuka File Manager"] --> F["Klik 'Unduh File Asli'"]
    F --> G["Server Meminta Berkas Penuh dari HP via Socket / Push"]
    G --> H["Disimpan di Disk: uploads/device-files/:deviceId/:year/:month/"]
    H --> I["Admin Mengunduh Berkas Asli Langsung"]
```

### 3.7 Kesiswaan 360, Kedisiplinan Poin & Pelanggaran
Sistem pelacakan kedisiplinan kumulatif dengan pembobotan poin otomatis.

```mermaid
flowchart TD
    A["Kejadian Pelanggaran / Prestasi"] --> B{"Pelapor"}
    B -->|Guru Piket / Satpam| C["Keterlambatan Masuk Sekolah"]
    B -->|Guru Kelas / Mapel| D["Pelanggaran Atribut / Kerapian / KBM"]
    B -->|Guru Pembina| E["Prestasi Akademik / Non-Akademik (+)"]
    
    C --> F["Input via Portal Kesiswaan / Scanner Masuk"]
    D --> F
    E --> F
    
    F --> G["Kalkulasi Otomatis Poin Kumulatif Siswa"]
    G --> H{"Ambang Batas Poin"}
    H -->|Poin >= 25| I["Surat Peringatan 1 (SP1) ke Orang Tua"]
    H -->|Poin >= 50| J["Surat Peringatan 2 (SP2) + Pemanggilan Orang Tua ke Sekolah"]
    H -->|Poin >= 75| K["Sidang Konferensi Kasus Tim BK & Kesiswaan"]
    H -->|Prestasi Tinggi| L["Penerbitan Sertifikat Penghargaan Sekolah"]
    
    G --> M["Tercatat Permanen di Buku Saku Digital Siswa & Notifikasi Orang Tua"]
```

### 3.8 Keamanan E-Kantin & Midtrans Payment Hard-Lock
Demi perlindungan finansial dan stabilitas transaksi, seluruh modul kantin digital dan topup pembayaran dikunci penuh di tingkat server, database, dan portal UI.

```mermaid
flowchart TD
    A["Permintaan Akses: /api/canteen/* atau /api/payment/*"] --> B["CanteenLockdownMiddleware"]
    B --> C{"Cek SystemSetting & Flag\n'ENABLE_EKANTIN' == false"}
    C -->|Terkunci| D["HTTP 403 Forbidden\n{success: false, code: 'CANTEEN_FEATURE_LOCKED',\nmessage: 'Modul E-Kantin SMPN 1 Boyolangu sedang dinonaktifkan sementara'}"]
    C -->|Terbuka (Jika Aktif di Masa Depan)| E["Validasi Debit Atomik: UPDATE saldo WHERE saldo >= nominal"]
    E --> F["Notifikasi Idempoten Webhook Midtrans"]
```

---

## 4. KATALOG ENDPOINT & MATRIKS OTORISASI API

Berikut adalah matriks lengkap seluruh endpoint aktif sistem SmartCBT SMPN 1 Boyolangu:

| No | Method | Rute Endpoint | Otorisasi / Role | Fungsi & Payload Utama | Proteksi & Idempotensi |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `POST` | `/api/auth/login` | Publik | Autentikasi user & siswa (`username`, `password`, `deviceUuid`, `fcmToken`) | Rate-limit 5 req/min, Device Binding verification |
| 2 | `POST` | `/api/auth/refresh` | Publik | Perpanjangan access token JWT menggunakan refresh token | Validasi refresh token aktif di database |
| 3 | `GET` | `/api/app-update/check` | Publik | Pemeriksaan versi APK terbaru (`versionCode`, `versionName`, SHA-256) | Auto-force update jika `versionCode < 171` |
| 4 | `POST` | `/api/class-session/open` | Pengurus, Wali Kelas | Membuka sesi presensi kelas mandiri (`closingHour`, `closingMinute`) | Mengunci kelas sesuai user token (anti-tamper class) |
| 5 | `POST` | `/api/class-session/scan` | Siswa | Siswa memindai QR sesi kelas (`sessionId`, `qrToken`, `lat`, `lng`) | Validasi geofence 30m, P2002 dual-write transaction |
| 6 | `POST` | `/api/class-session/assisted-scan`| Pengurus Kelas | Scan bantuan kartu siswa tanpa HP (`barcodeValue`, `scanType`) | Dual-write atomik, mengembalikan data pasfoto biometrik |
| 7 | `GET` | `/api/class-session/my-classmates` | Pengurus Kelas | Mengambil daftar presensi teman sekelas hari ini | Terfilter strictly `user.className` |
| 8 | `POST` | `/api/leave/request` | Siswa | Pengajuan izin meninggalkan sekolah / Gatepass (`reason`, `category`) | Validasi status aktif siswa, notifikasi ke Guru BK |
| 9 | `GET` | `/api/gatepass/my-leaves` | Siswa | Mengambil riwayat pengajuan izin keluar siswa beserta statusnya | IDOR protected (hanya data siswa bersangkutan) |
| 10 | `POST` | `/api/gatepass/verify` | Satpam, Admin | Verifikasi tiket QR di pos gerbang sekolah (`ticketCode`, `qrHash`) | Atomic single-checkout checkout, HTTP 409 jika double-exit |
| 11 | `GET` | `/api/tahfiz/students/:id` | Siswa, Guru, Ortu | Mengambil data riwayat & target hafalan Juz 30 siswa | IDOR protected (hanya pemilik data / wali / guru PAI) |
| 12 | `POST` | `/api/tahfiz/setoran` | Siswa | Mengajukan setoran hafalan baru (`surahNumber`, `ayatRange`, `metode`) | Validasi rentang ayat, sanitasi nama surat otomatis |
| 13 | `POST` | `/api/tahfiz/evaluate` | Guru PAI | Memberikan nilai dan koreksi tajwid atas setoran siswa | Role strictly GURU / ADMIN |
| 14 | `GET` | `/parent/unified-dashboard/:siswaId`| Orang Tua, Admin | Dashboard 360 orang tua memantau presensi, nilai, dan kasus anak | Validasi wajib via `ParentStudentLink` / NISN |
| 15 | `GET` | `/chat/messages/:threadId` | Partisipan | Mengambil riwayat pesan konsultasi BK antara orang tua dan konselor | Verifikasi kepemilikan thread (IDOR-safe) |
| 16 | `POST` | `/api/device/files/sync` | Device Client | Sinkronisasi metadata file perangkat siswa | Thumbnail Base64 di-null-kan permanen |
| 17 | `GET` | `/api/device/files/download/:id` | Admin, Operator | Mengunduh file fisik asli dari penyimpanan server | Audit logged, streaming berkas aman |
| 18 | `ALL` | `/api/canteen/*` | Semuanya | Seluruh rute kantin dan topup Midtrans | Hard-locked (HTTP 403 Feature Disabled) |

---

## 5. SKEMA DATABASE & INTEGRITAS TRANSAKSI KONKURENSI

### 5.1 Aturan Emas Transaksi Bersama (`prisma.$transaction`)
Semua operasi tulis yang memengaruhi lebih dari satu tabel atau baris diwajibkan menggunakan transaksi atomik dengan pola penanganan error unik Prisma (`P2002`):

```typescript
// Contoh Standar Transaksi Dual-Write Presensi Kelas Mandiri
const result = await prisma.$transaction(async (tx) => {
    // 1. Catat sesi record presensi kelas
    const record = await tx.classAttendanceRecord.create({
        data: {
            sessionId: session.id,
            studentId: student.id,
            status: isLate ? 'LATE' : 'PRESENT',
            verifiedAt: nowWib,
            method: 'QR_SCAN',
            isOfflineSync: isOffline
        }
    });

    // 2. Dual-write ke tabel Attendance utama untuk rekap kehadiran sekolah
    const att = await tx.attendance.upsert({
        where: {
            studentId_dateKey_type: {
                studentId: student.id,
                dateKey: todayKey,
                type: 'GATE_IN'
            }
        },
        update: {
            status: isLate ? 'TERLAMBAT' : 'HADIR',
            time: timeStr
        },
        create: {
            studentId: student.id,
            dateKey: todayKey,
            type: 'GATE_IN',
            status: isLate ? 'TERLAMBAT' : 'HADIR',
            time: timeStr
        }
    });

    return { record, att };
}).catch((err) => {
    if (err.code === 'P2002') {
        // Konkurensi paralel terdeteksi, ubah menjadi respons sukses idempoten
        return { alreadyScanned: true };
    }
    throw err;
});
```

### 5.2 Skema Tabel Utama Terkait Modul Baru & Keamanan
1. **ClassAttendanceSession**: Menyimpan sesi buka/tutup presensi ruang kelas per hari per rombel.
2. **ClassAttendanceRecord**: Catatan kehadiran perorangan per sesi, mencatat metode scan (mandiri / dibantu pengurus).
3. **Attendance**: Agregasi kehadiran harian sekolah (`GATE_IN`, `GATE_OUT`, status: `HADIR`, `TERLAMBAT`, `SAKIT`, `IZIN`, `ALPA`). Indeks unik parsial: `[studentId, dateKey, type]`.
4. **LeaveRequest**: Rekam jejak pengajuan izin keluar (Gatepass), verifikasi BK, dan stempel waktu checkout Satpam.
5. **TahfizSurahMaster & TahfizProgress**: Katalog 37 surat Juz 30, catatan setoran siswa, dan penilaian guru PAI.
6. **ParentStudentLink**: Asosiasi verifikasi resmi akun orang tua terhadap siswa untuk mencegah eskalasi horizontal (IDOR).
7. **DeviceFile**: Katalog berkas perangkat Android yang dikelola, bebas dari blob base64.

---

## 6. MEKANISME SINKRONISASI OFFLINE & IDEMPOTENSI DATA

Ketika jaringan sekolah atau sinyal seluler mengalami gangguan sementara (sinyal drop / BTS padat):
1. **Penyimpanan Lokal APK Siswa**: Aplikasi menyimpan event presensi ke dalam SQLite Room lokal terenkripsi dengan penanda `OFFLINE_PENDING`, timestamp presensi asli, koordinat GPS terakhir yang valid, dan UUID presensi acak.
2. **Sinkronisasi Otomatis**: Saat sinyal pulih (terdeteksi via `ConnectivityManager.NetworkCallback`), aplikasi mengirimkan antrean presensi dengan payload flag `isOfflineSync = true`.
3. **Penerimaan di Server**: Server menandai catatan sebagai `OFFLINE_SYNC`, mempertahankan waktu presensi asli siswa dari device selama masih dalam toleransi jam sekolah hari yang sama (sebelum 07:00 WIB dihitung tepat waktu, setelah 07:00 WIB dihitung terlambat).
4. **Idempotensi**: Setiap pengiriman ulang data yang sama diabaikan secara halus oleh database melalui indeks unik, mencegah duplikasi hitungan presensi.

---

## 7. MITIGASI KERENTANAN KEAMANAN (IDOR, ANTI-RACE, SANITASI)

| Vektor Serangan | Potensi Dampak | Mitigasi Keras yang Telah Diimplementasikan |
| :--- | :--- | :--- |
| **IDOR (Insecure Direct Object Reference)** | Orang tua/siswa melihat data nilai, kasus BK, atau chat pengguna lain dengan mengubah parameter ID di URL. | Server secara ketat memverifikasi bahwa ID target adalah milik token yang melakukan login, atau terikat di tabel relasi `ParentStudentLink`. Jika tidak cocok, server langsung memotong dengan HTTP 403 Forbidden. |
| **Race Condition Gatepass Checkout** | Dua Satpam memindai tiket izin yang sama pada milidetik yang sama, menghasilkan status ganda atau kelolosan tak tercatat. | Pemeriksaan status tiket dipindahkan ke dalam transaksi kondisional atomik (`UPDATE ... WHERE status = 'APPROVED'`). Jika sudah checkout, query kedua mengembalikan 0 baris yang diubah dan ditolak dengan HTTP 409 Conflict. |
| **Class Tampering pada Buka Sesi Kelas** | Pengurus kelas mengirimkan `className` kelas lain untuk membuka sesi atau absen di rombel berbeda. | Server mengabaikan `className` yang dikirimkan klien dan secara mutlak menggunakan `user.className` yang diekstrak langsung dari JWT yang ditandatangani secara kriptografis. |
| **Reopening Closed Sessions** | Sesi presensi yang telah ditutup pada pukul 07:00 WIB dibuka kembali oleh siswa/pengurus nakal. | Logika `openClassAttendanceSession` secara ketat menolak pembukaan ulang sesi jika status sudah `CLOSED` dengan HTTP 409 Conflict. |
| **Database Bloat dari Remote Thumbnails** | Pengunggahan ribuan gambar thumbnail Base64 dari HP siswa menyebabkan database SQLite membengkak menjadi gigabytes dan lambat. | Seluruh kolom `thumbnailBase64` di-null-kan permanen saat proses simpan. Admin mengunduh file asli langsung dari disk secara streaming tanpa membebani database. |
| **Double Execution of End-of-Day Job** | Dua thread scheduler berjalan bersamaan di pergantian hari dan menduplikasi status alpa siswa. | Menggunakan *in-memory advisory mutex lock* (`isEndOfDayJobRunning`). Jika sedang ada evaluasi yang berjalan, eksekusi berikutnya langsung dibatalkan dengan status 409. |

---

*Dokumentasi ini dibuat dan diverifikasi secara otomatis pada 15 Oktober 2026 sebagai standar audit mutu dan keandalan sistem SmartCBT SMP Negeri 1 Boyolangu.*
