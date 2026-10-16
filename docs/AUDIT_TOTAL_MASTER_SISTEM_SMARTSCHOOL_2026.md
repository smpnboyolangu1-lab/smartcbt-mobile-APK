# AUDIT TOTAL MASTER SISTEM, ARSITEKTUR BASIS DATA, LOGGING TELEMETRI, FITUR PORTAL WEB & APK ANDROID
## Platform Ekosistem Terpadu SMPN 1 Boyolangu (SmartSchool / SmartCBT 2026)
*Dokumen Spesifikasi Teknis & Hasil Audit Komprehensif Skala Penuh untuk Evaluasi Arsitektural dan Analisis AI Independen*

---

## DAFTAR ISI
1. [Informasi Metadata Audit & Ringkasan Eksekutif](#1-informasi-metadata-audit--ringkasan-eksekutif)
2. [Topologi Arsitektur Ekosistem & Aliran Komunikasi](#2-topologi-arsitektur-ekosistem--aliran-komunikasi)
3. [Audit Basis Data & Prisma ORM Tier (167 Model & 192.551 Entri Data)](#3-audit-basis-data--prisma-orm-tier-167-model--192551-entri-data)
   - 3.1 Konfigurasi Mesin PostgreSQL & Pooling
   - 3.2 Katalog 14 Domain Basis Data & Distribusi Tabel
   - 3.3 Domain Inti: Autentikasi, Pengguna, & Device Binding
   - 3.4 Domain Presensi Multi-Metode, Geofence, & Deteksi Anomali
   - 3.5 Domain Asesmen: CBT, Ulangan Harian (UH), Bank Soal, & Tugas
   - 3.6 Domain Karakter & Keagamaan: Tahfiz Juz 30 & Sholat Berjamaah
   - 3.7 Domain Kesiswaan, Bimbingan Konseling (BK), UKS, & Ekstrakurikuler
   - 3.8 Domain Finansial: E-Kantin & Midtrans Payment Gateway
   - 3.9 Domain Operasional: E-Library, Gatepass Gerbang, & Jam Pelajaran
4. [Audit Log Sistem, Audit Trails, & Telemetri Keamanan](#4-audit-log-sistem-audit-trails--telemetri-keamanan)
   - 4.1 Log Error Klien Mobile (`AppClientErrorLog` - 12.184 Entri)
   - 4.2 Log Aktivitas Pengguna (`ActivityEventLog` - 106.298 Entri)
   - 4.3 Log Audit Operator (`OperatorActivityLog` & `AuditLog` - 1.522 Entri)
   - 4.4 Kebijakan & Daemon Pembersihan Log Otomatis (30-Day Retention Worker)
   - 4.5 Server Metric Snapshots & Kapasitas Hardware Real-Time
5. [Audit Portal Web Sekolah (46 Views EJS & 77 Controller RESTful)](#5-audit-portal-web-sekolah-46-views-ejs--77-controller-restful)
   - 5.1 Portal Admin Utama & Operator (20+ Modul Kontrol)
   - 5.2 Portal Kurikulum & Manajemen CBT Terpadu
   - 5.3 Portal Guru & Wali Kelas (KBM, Jurnal, Live UH, Poin Disiplin)
   - 5.4 Portal Bimbingan Konseling (BK) & Sistem Prediksi SAW
   - 5.5 Portal UKS & Palang Merah Remaja (PMR)
   - 5.6 Portal Kesiswaan, Mutasi, & Pemilos E-Voting
   - 5.7 Portal Ekstrakurikuler (20+ Cabang Ekskul, Nilai, & Presensi)
   - 5.8 Portal E-Library & Distribusi Buku Paket
   - 5.9 Portal Pos Satpam & Gatepass Izin Gerbang
   - 5.10 Portal Kantin Sehat & POS Stand Penjual
   - 5.11 Portal Orang Tua & Siswa Web
   - 5.12 Kiosk Display Publik (RFID Tap Gerbang & Monitor Kelas Kosong)
6. [Audit Aplikasi Mobile Android (31 Activity, Background Service, & Kotlin Tier)](#6-audit-aplikasi-mobile-android-31-activity-background-service--kotlin-tier)
   - 6.1 Arsitektur Jaringan (Retrofit2, OkHttp, Dynamic Token, Multi-IP Fallback)
   - 6.2 Modul Siswa (`StudentMainActivity`): CBT Kiosk, Tahfiz Audio, Presensi, Curhat BK
   - 6.3 Modul Pengurus Kelas (`PengurusKelasActivity`): QR Dinamis 10-Detik & Assisted Scan
   - 6.4 Modul Guru (`TeacherMainActivity`): KBM, UH Realtime, Mushola, Pengawas
   - 6.5 Modul Orang Tua (`ParentMainActivity`): Push Notif Gerbang, Midtrans Top-Up, Izin Sakit
   - 6.6 Modul Petugas: Satpam Gatepass Scanner & Kasir Kantin POS
   - 6.7 Modul Administrator Lapangan (`HiddenAdminActivity` & `OperatorMainActivity`)
7. [Audit Sistem Keamanan APK & Mekanisme Anti-Tampering](#7-audit-sistem-keamanan-apk--mekanisme-anti-tampering)
   - 7.1 Kiosk Lockdown Browser & Proteksi Ujian
   - 7.2 Hardware Device Binding & Penguncian Android ID
   - 7.3 Validasi Presensi 2 Jalur (Barcode Statis + GPS vs QR Dinamis TOTP)
   - 7.4 Deteksi Mock Location & Fake GPS
   - 7.5 Ketahanan Jaringan & Offline Encrypted Storage Sync
8. [Analisis Matriks 15 Peran (Roles) & Hak Akses Fungsional](#8-analisis-matriks-15-peran-roles--hak-akses-fungsional)
9. [Jalur Sistem, Jalur Data, & Alur Proses End-to-End (Mermaid Workflow Traces)](#9-jalur-sistem-jalur-data--alur-proses-end-to-end-mermaid-workflow-traces)
   - 9.1 Alur Presensi Gerbang & Komparasi Validasi Lokasi
   - 9.2 Alur CBT Ujian Resmi & Ulangan Harian Kilat
   - 9.3 Alur Tahfiz Juz 30 (Audio Murojaah, Self-Test, & Verifikasi PAI)
   - 9.4 Alur Gatepass Keluar Sekolah (Siswa -> BK/Piket -> Satpam)
   - 9.5 Alur Finansial E-Kantin (Midtrans Topup -> Ledger -> Kasir POS)
   - 9.6 Alur Konseling BK & Prediksi SAW Kasus Siswa
   - 9.7 Alur Ekstrakurikuler (Pendaftaran -> Presensi QR -> Penilaian)
10. [Analisis Resiko, Evaluasi Arsitektural, & Rekomendasi Mitigasi](#10-analisis-resiko-evaluasi-arsitektural--rekomendasi-mitigasi)
11. [Kerangka Kerja & Panduan Audit Independen untuk AI Lain](#11-kerangka-kerja--panduan-audit-independen-untuk-ai-lain)

---

## 1. INFORMASI METADATA AUDIT & RINGKASAN EKSEKUTIF

### 1.1 Lembar Fakta Audit Sistem
* **Nama Platform:** SmartSchool Integrated Ecosystem (SmartCBT & SIBOY FRESH)
* **Entitas Pengguna:** SMP Negeri 1 Boyolangu, Kabupaten Tulungagung, Jawa Timur
* **Tanggal & Waktu Audit:** 16 Oktober 2026, 19:45 WIB
* **Target Lingkungan Audit:** Production Local Server with Cloudflare Zero Trust Tunnel
* **Basis Kode Sumber:**
  * **Backend API & Web Server:** Node.js v24 LTS, Express v5.1.0, TypeScript v5.3.3
  * **Database Engine:** PostgreSQL 16 (Port 5432) via Prisma ORM v5.10.0
  * **Process Manager:** PM2 Cluster Manager (3 Instances: `smart-school-backend`, `postgres`, `cloudflare-tunnel`)
  * **Mobile Client:** Android Native (Kotlin 1.9+, Android SDK 34 / Android 14 Ready, Min SDK 24)
  * **External Integrasi:** Midtrans Snap Payment Gateway, Supabase Realtime Storage Sync, Firebase Cloud Messaging (FCM)

### 1.2 Ringkasan Metrik Skala Sistem (Data Aktual Database Terverifikasi)
| Dimensi Parameter | Jumlah Terverifikasi | Deskripsi / Penjelasan |
| :--- | :---: | :--- |
| **Model Basis Data Prisma** | **167 Model** | Mencakup seluruh domain akademik, presensi, keuangan, BK, UKS, ekskul, dan logging |
| **Total Baris Data Aktif** | **192.551 Baris** | Data transaksi real di server PostgreSQL |
| **RESTful API Controllers** | **77 Controller** | Logika bisnis modular di `backend/src/controllers/` |
| **Antarmuka Web (Views)** | **46 Berkas EJS** | Portal server-side rendered berbasis Tailwind CSS & Glassmorphism |
| **Layanan Latar Belakang (Services)** | **12 Service** | Background worker, scheduler otomatis, audit logger, AI generation |
| **Komponen Activity Mobile (APK)** | **31 Activity** | Antarmuka native Android untuk siswa, guru, orang tua, petugas, dan admin |
| **Layanan Latar Android (Services)** | **2 Service** | Always-on Foreground Sync Service & Firebase Push Messaging |
| **Pengguna Terdaftar Aktif** | **1.401 Pengguna** | 989 Siswa, 333 Orang Tua, 71 Guru, 2 Operator, 1 Admin Utama, Staff BK/UKS/Satpam |

---

## 2. TOPOLOGI ARSITEKTUR EKOSISTEM & ALIRAN KOMUNIKASI

Sistem SmartSchool dirancang menggunakan pola arsitektur **Three-Tier Distributed Architecture** yang diperluas dengan **Edge/Tunnel Layer** untuk akses internet publik yang aman tanpa mengekspos port publik secara langsung.

```mermaid
flowchart TB
    subgraph Client_Tier [CLIENT TIER: MULTI-PLATFORM NATIVE & WEB]
        direction TB
        subgraph Mobile_App [Android Native Client - Kotlin SDK 34]
            APK_STU["📱 Siswa\n(StudentMainActivity)"]
            APK_TEA["👨‍🏫 Guru & Wali Kelas\n(TeacherMainActivity)"]
            APK_PAR["👪 Orang Tua\n(ParentMainActivity)"]
            APK_OPE["⚙️ Operator Mobile\n(OperatorMainActivity)"]
            APK_SAT["🛡️ Pos Satpam\n(SatpamMainActivity)"]
            APK_KAN["☕ Kasir Kantin\n(KantinMainActivity)"]
            APK_COM["🤝 Pengurus Kelas\n(PengurusKelasActivity)"]
            APK_EXA["🔒 CBT Kiosk Engine\n(ExamActivity)"]
        end

        subgraph Web_Portals [Responsive Web Portals - EJS + Tailwind]
            WEB_ADM["🏛️ Super Admin & Operator (/admin, /operator)"]
            WEB_KUR["📚 Kurikulum & CBT (/kurikulum, /admin/cbt)"]
            WEB_GUR["👨‍🏫 Guru KBM (/guru)"]
            WEB_BK["🧠 Bimbingan Konseling (/bk)"]
            WEB_UKS["🏥 Unit Kesehatan (/uks)"]
            WEB_LIB["📖 E-Library (/operator/perpus)"]
            WEB_SEC["🚧 Gerbang Satpam (/satpam/gatepass)"]
            WEB_POS["🥗 Terminal Kantin (/kantin)"]
            WEB_KSK["📟 Kiosk Tap Kartu RFID & Display Kelas Kosong"]
        end
    end

    subgraph Gateway_Tier [EDGE / TUNNEL & GATEWAY TIER]
        CF_TUNNEL["Cloudflare Zero Trust Tunnel\n(cbt.smpn1boyolangu.my.id)"]
        LOCAL_LAN["Local School Wi-Fi / LAN\n(192.168.101.x / 103.x Static IP)"]
        AUTH_GUARD["JWT Security Guard & Multi-Role Middleware\n(Token Refresh, Device Binding, Anti-Tamper)"]
    end

    subgraph Application_Tier [APPLICATION TIER: NODE.JS & TYPESCRIPT]
        ROUTER["Express 5 Router Gateway\n(/api/v1, /api/*, Web Session Engine)"]
        
        subgraph Core_Engines [Engine Bisnis Utama]
            ENG_ATT["Presensi & Geofence Engine\n(Haversine GPS, QR Dinamis, Offline Sync)"]
            ENG_CBT["CBT & Ulangan Harian Engine\n(Anti-Cheat, Token Rolling, Instant Grading)"]
            ENG_CHAR["Karakter & Keagamaan Engine\n(Tahfiz Juz 30, Jadwal Sholat, PAI)"]
            ENG_CARE["Konseling & Kesehatan Engine\n(BK SAW Prediction, UKS Clinic, Gatepass)"]
            ENG_FIN["Finansial & E-Kantin Engine\n(Midtrans Snap, Wallet Ledger, QR Pay)"]
            ENG_LOG["Telemetri & Anomali Engine\n(Activity Logger, Device Telemetry, Client Logs)"]
        end

        SCHEDULER["Background Schedulers & Cron Daemons\n(Auto-Closing Session, AI Homework, Sync)"]
    end

    subgraph Data_Tier [DATA STORAGE & EXTERNAL INTEGRATION TIER]
        PRISMA_CLIENT["Prisma ORM v5.10.0\n(High-Performance Connection Pool)"]
        PG_DB[("PostgreSQL 16 Engine\n(smartschool DB - 167 Models, 192k Rows)")]
        LOCAL_FILES["Storage Berkas Terenkripsi\n(/uploads/letters, /storage/efiles)"]
        EXT_MIDTRANS["Midtrans Payment Gateway API"]
        EXT_FCM["Firebase Cloud Messaging (FCM)"]
        EXT_SUPA["Supabase Cloud Backup Mirror"]
    end

    Mobile_App -->|HTTPS / REST API| CF_TUNNEL
    Mobile_App -.->|Direct Fallback LAN IP| LOCAL_LAN
    Web_Portals -->|HTTP Session / AJAX| CF_TUNNEL
    Web_Portals -.->|Local Admin| LOCAL_LAN

    CF_TUNNEL --> AUTH_GUARD
    LOCAL_LAN --> AUTH_GUARD
    AUTH_GUARD --> ROUTER

    ROUTER --> Core_Engines
    SCHEDULER --> Core_Engines
    Core_Engines --> PRISMA_CLIENT
    Core_Engines --> LOCAL_FILES

    PRISMA_CLIENT --> PG_DB
    ENG_FIN <--> EXT_MIDTRANS
    ENG_LOG --> EXT_FCM
    SCHEDULER -.-> EXT_SUPA
```

---

## 3. AUDIT BASIS DATA & PRISMA ORM TIER (167 MODEL & 192.551 ENTRI DATA)

### 3.1 Konfigurasi Mesin PostgreSQL & Pooling
Sistem beroperasi di atas mesin **PostgreSQL 16** lokal dengan skema `public`. Akses data sepenuhnya diabstraksikan oleh **Prisma Client JS** dengan manajemen koneksi berbasis *pool*:
* **Connection String:** `postgresql://postgres:postgres@localhost:5432/smartschool?schema=public`
* **Prisma Schema File:** `backend/prisma/schema.prisma` (Panjang: 3.159 baris kode deklarasi)
* **Status Relasi:** Relasi foreign-key terstruktur dengan integritas referensial penuh (`@relation`), indeks terdistribusi pada kolom pencarian intensif (`username`, `rfidChipUid`, `nisn`, `createdAt`, `sentAt`, `targetDate`).

### 3.2 Katalog 14 Domain Fungsional Basis Data
Berikut adalah pembagian model data aktual ke dalam 14 kelompok domain operasional sekolah:

```mermaid
pie title Distribusi Model Basis Data Prisma (Total 167 Model)
    "Logging & Telemetri" : 18
    "Asesmen CBT & Ulangan Harian" : 24
    "Presensi & Jam Pelajaran" : 19
    "Kesiswaan & Biodata Dapodik" : 17
    "Bimbingan Konseling (BK)" : 15
    "Ekstrakurikuler" : 12
    "E-Library & Buku Paket" : 10
    "Karakter, PAI & Tahfiz Juz 30" : 9
    "Finansial & E-Kantin" : 8
    "UKS & PMR" : 7
    "Manajemen Perangkat & Wi-Fi" : 9
    "Komunikasi & Surat Edaran" : 6
    "Pengaturan Sistem & Rilis APK" : 7
    "User & Autentikasi Inti" : 6
```

### 3.3 Rincian Domain Utama Basis Data

#### A. Domain User, Autentikasi, & Device Binding
* **`User` (1.401 baris):** Entitas pengguna terpadu dengan kolom `username` (NISN untuk siswa, NIP/ID untuk guru), `password` (bcrypt hashed), `role` (`ADMIN`, `OPERATOR`, `TEACHER`, `COUNSELOR`, `MEDICAL`, `LIBRARIAN`, `STUDENT`, `PARENT`), `deviceBindingId` (Android ID hardware), `rfidChipUid` (UID kartu fisik), `isActive`, `lastLogin`, data Dapodik (`nis`, `nisn`, `nik`, `birthDate`, `parentPhone`, `className`).
* **`RefreshToken` (132 baris):** Mekanisme perpanjangan token JWT otomatis tanpa memaksa login ulang di APK.
* **`UserFcmToken` (90 baris):** Token push notification Firebase per perangkat.
* **`RegisteredDevice`:** Registrasi perangkat keras yang diverifikasi dengan status otorisasi oleh admin.

#### B. Domain Presensi Multi-Metode & Deteksi Anomali
* **`Attendance` (2.997 baris):** Tabel presensi gerbang sekolah utama (`date`, `timeIn`, `timeOut`, `method` [BARCODE, QR_SCAN, RFID, FACE, MANUAL], `status` [HADIR, TERLAMBAT, PULANG_CEPAT], `verifiedBy`, `anomalyNote`).
* **`AttendanceAnomalyLog` (636 baris):** Log kecurangan presensi (deteksi GPS di luar perimeter, fake GPS mock location, scan ganda, manipulasi waktu perangkat).
* **`StudentGeofenceAttendance` & `TeacherGeofenceAttendance`:** Pencatatan presensi berbasis geofencing radius polygon kelas dan koordinat lintang/bujur presisi.
* **`PrayerClassSchedule` & `StudentPrayerAttendance`:** Presensi ibadah Dhuha & Dhuhur berjamaah mushola yang diverifikasi guru PAI.
* **`ClassPeriodSession` & `ClassPeriodAttendance`:** Presensi mata pelajaran per jam pelajaran (KBM tatap muka).
* **`ExtracurricularAttendanceSession` & `ExtracurricularAttendance`:** Presensi kegiatan ekstrakurikuler sore hari.

#### C. Domain Asesmen: CBT, Ulangan Harian, & Homework
* **`Exam`, `ExamQuestion`, `ExamParticipant`:** Modul CBT formal berbasis jadwal dan ruang ujian tertutup (ANBK/PAS/PAT).
* **`ExamClassToken` (55 baris):** Token ujian 6 karakter yang berotasi otomatis setiap 15 menit.
* **`UlanganHarian` & `UlanganHarianSubmission`:** Modul kuis cepat mandiri guru dengan analitik butir soal real-time dan remedial otomatis.
* **`HomeworkRecurringPlan` & `HomeworkLoadPolicy`:** Manajemen beban PR siswa agar tidak melebihi batas regulasi kurikulum per minggu.

#### D. Domain Karakter, Keagamaan, & Tahfiz Juz 30
* **`TahfizSurahMaster`:** Katalog 37 surat Juz 30 lengkap dengan jumlah ayat, urutan mushaf, dan file audio referensi Qari.
* **`TahfizRubrikConfig`:** Kriteria penilaian tahfiz (Tajwid, Kelancaran, Murottal, Makharijul Huruf).
* **`StudentTahfizProgress`:** Log kemajuan hafalan mandiri siswa di APK.
* **`TahfizAssessmentEvent`:** Rekam verifikasi resmi tatap muka oleh Guru PAI.

#### E. Domain Bimbingan Konseling (BK), Disiplin, & UKS
* **`DisciplineCategory` & `DisciplineRecord` (54 baris):** Katalog bobot poin pelanggaran (ringan, sedang, berat) dan sanksi.
* **`BkSawRankingCache` (330 baris):** Matriks perhitungan algoritma *Simple Additive Weighting* (SAW) untuk mendeteksi siswa rentan putus sekolah atau bermasalah secara dini.
* **`BkParentChatThread` & `BkParentChatMessage`:** Jalur komunikasi konseling rahasia antara orang tua dan konselor BK.
* **`UksStudentHealthData` & `UksVisitEvent`:** Rekam riwayat medis fisik, alergi, dan log kunjungan penanganan di ruang UKS.

#### F. Domain Finansial & E-Kantin
* **`CanteenTransaction` & `CanteenTopup`:** Buku besar digital transaksi non-tunai di kantin sekolah.
* **`MidtransTransaction`:** Log audit transaksi isi saldo kantin via Virtual Account bank dan QRIS real-time.

---

## 4. AUDIT LOG SISTEM, AUDIT TRAILS, & TELEMETRI KEAMANAN

Salah satu kekuatan terbesar arsitektur SmartSchool adalah **observabilitas menyeluruh**. Sistem memiliki lebih dari 148.000 log operasional yang mencatat setiap denyut sistem secara detail.

```mermaid
flowchart LR
    subgraph Log_Sources [Sumber Log & Telemetri]
        APK_CLI["HP Siswa / Guru / Ortu\n(Android Client)"]
        WEB_REQ["Web Portal Admin/Guru\n(Browser Client)"]
        SYS_DAEMON["Scheduler & Cron\n(Background Daemon)"]
    end

    subgraph Telemetry_Processors [Prosesor & Validasi Log]
        ERR_COLLECTOR["AppClientErrorLog Collector\n(/api/client-logs/report)"]
        ACT_TRACKER["ActivityEvent Tracker\n(User Behavior & Feature Hits)"]
        ANOMALY_ENGINE["Audit & Anomaly Detector\n(Geofence Violations, Time Drift)"]
        DEVICE_SYNC["Device File & Copy Request Sync\n(Remote File Telemetry)"]
    end

    subgraph Storage_Audit [Penyimpanan Log Terstruktur]
        DB_ACT["ActivityEventLog\n(106.298 Baris)"]
        DB_COPY["CopyRequest Log\n(26.723 Baris)"]
        DB_NOTIF["NotificationMessage\n(23.076 Baris)"]
        DB_ERR["AppClientErrorLog\n(12.184 Baris)"]
        DB_DEV["DeviceFile Log\n(9.692 Baris)"]
        DB_OP["OperatorActivityLog & AuditLog\n(1.522 Baris)"]
        DB_ANO["ActivityAnomaly & AttendanceAnomaly\n(1.336 Baris)"]
    end

    APK_CLI -->|Uncaught Exceptions & Crash| ERR_COLLECTOR
    APK_CLI -->|Feature Tap & Screen Navigation| ACT_TRACKER
    APK_CLI -->|GPS Spoofing & Fake Barcode| ANOMALY_ENGINE
    APK_CLI -->|File Metadata & Telemetry| DEVICE_SYNC

    WEB_REQ -->|CRUD Aksi Berbahaya| DB_OP
    SYS_DAEMON -->|Health Metric Check| DB_ACT

    ERR_COLLECTOR --> DB_ERR
    ACT_TRACKER --> DB_ACT
    ANOMALY_ENGINE --> DB_ANO
    DEVICE_SYNC --> DB_COPY
    DEVICE_SYNC --> DB_DEV
```

### 4.1 Log Error Klien Mobile (`AppClientErrorLog` - 12.184 Entri)
Setiap crash, token kedaluwarsa (401), koneksi putus (timeout), atau kegagalan kamera di HP siswa otomatis dilaporkan ke server secara senyap tanpa mengganggu pengguna.
* Kolom rekaman: `level` (INFO, WARN, ERROR), `tag` (HOMEWORK, SCANNER, EXAM, AUTH), `errorMessage`, `stackTrace`, `deviceModel` (cth: "Xiaomi 22120RN86G", "OPPO CPH2235"), `androidVersion` (SDK 33, 34, 36), `appVersion` (2.9.3), `networkType` (WIFI/4G), `serverUrl`, `userId`, `username`, `activityName`.
* Manfaat audit: Administrator dapat mendeteksi tipe HP siswa yang bermasalah secara massal langsung dari dashboard portal web tanpa perlu memegang fisik perangkat siswa.

### 4.2 Log Aktivitas Pengguna (`ActivityEventLog` - 106.298 Entri)
Mencatat seluruh aksi pengguna secara granular: membuka menu tahfiz, memulai ujian CBT, membaca pengumuman, memindai presensi, hingga mengunduh dokumen PDF. Menjadi bahan audit pembuktian jika ada siswa yang mengklaim "sudah mengerjakan tugas tetapi sistem tidak mencatat".

### 4.3 Log Audit Operator (`OperatorActivityLog` & `AuditLog` - 1.522 Entri)
Mencatat seluruh tindakan administratif yang memiliki dampak besar:
* Reset Device Binding (membuka kunci HP siswa).
* Penyiaran Broadcast Pengumuman massal.
* Perubahan nilai rapor dan konfigurasi geofence sekolah.
* Setiap entri mencatat ID operator, waktu presisi, alamat IP, dan parameter payload yang diubah.

### 4.4 Kebijakan & Daemon Pembersihan Log Otomatis (30-Day Retention Worker)
Untuk menjaga database PostgreSQL tetap ramping, kencang, dan bebas dari fragmentasi indeks B-Tree yang membengkak akibat laju logging ribuan transaksi per hari (~15.000 event/hari), sistem dilengkapi dengan **Worker Pembersihan Retensi 30 Hari**:
* **Jadwal Eksekusi Otomatis:** Dijalankan setiap hari pukul **02:00 WIB dini hari** oleh daemon internal (`backend/src/services/systemScheduler.ts`).
* **Endpoint Eksekusi Manual (On-Demand):** `POST /api/admin/logs/retention-cleanup` (dilindungi otentikasi JWT Role `ADMIN` / `OPERATOR`).
* **Kriteria & Lingkup Pembersihan:**
  1. `ActivityEventLog`: Baris dengan `createdAt < (Waktu Sekarang - 30 Hari)` dihapus tuntas.
  2. `CopyRequest`: Baris dengan `requestedAt < (Waktu Sekarang - 30 Hari)` dihapus tuntas.
  3. `AppClientErrorLog`: Baris dengan `createdAt < (Waktu Sekarang - 30 Hari)` dihapus tuntas.
  4. `ActivityAnomaly`: Baris yang berstatus `'RESOLVED'` dengan `resolvedAt < (Waktu Sekarang - 30 Hari)` dihapus tuntas.
* **Integritas Data Inti:** Data esensial akademik sekolah (Riwayat Presensi Siswa/Guru, Nilai Rapors, Transaksi CBT/Ujian, Progres Tahfiz Juz 30, Buku Besar E-Kantin, dan Rekam Medis UKS) **100% DIKEPUNG SECARA PERMANEN** dan tidak terkena kebijakan retensi pembersihan log operasional ini.

---

## 5. AUDIT PORTAL WEB SEKOLAH (46 VIEWS EJS & 77 CONTROLLER RESTFUL)

Portal web sekolah dibangun menggunakan mesin rendering sisi server (**Express + EJS**) yang dihiasi utilitas **Tailwind CSS**, komponen *Design System*, dan interaktivitas JavaScript modern.

### 5.1 Matriks 46 Halaman Portal Web
| Kategori Portal | Path URL Utama | Berkas Template EJS | Otorisasi Akses | Fungsi & Cakupan Fitur |
| :--- | :--- | :--- | :--- | :--- |
| **Admin & Monitoring** | `/admin` | `admin_dashboard.ejs` | `ADMIN`, `OPERATOR` | Dashboard utama eksekutif, statistik server, broadcast cepat, metrik kehadiran |
| **Server Health** | `/admin/server-monitoring` | `admin_server_monitoring.ejs` | `ADMIN` | Pemantauan beban CPU, RAM, heap memory, PM2 status, dan latensi |
| **Server Capacity** | `/admin/server-capacity` | `server_capacity_dashboard.ejs` | `ADMIN`, `OPERATOR` | Kalkulasi konkurensi kapasitas server untuk simulasi ujian serentak |
| **Device Manager** | `/admin/remote-devices` | `manajemen_remote_device.ejs` | `ADMIN` | Pemantauan baterai, versi APK, dan telemetri perangkat siswa |
| **Client Logs** | `/admin/client-logs` | `admin_client_logs.ejs` | `ADMIN` | Analitik log error HP siswa dari tabel `AppClientErrorLog` |
| **Activity Logs** | `/admin/activity-logs` | `activity_logs.ejs` | `ADMIN` | Audit log real-time 106k aktivitas seluruh sivitas sekolah |
| **Geofence Setting**| `/admin/geofence-attendance` | `admin_geofence_attendance.ejs` | `ADMIN`, `OPERATOR` | Peta poligon radius GPS sekolah dan koordinat gerbang |
| **Broadcast Resmi** | `/admin/pengumuman` | `manajemen_pengumuman.ejs` | `ADMIN`, `OPERATOR` | Siaran bertingkat ke Siswa & Orang Tua dengan live audience counter |
| **Surat Resmi PDF** | `/admin/surat` | `manajemen_surat.ejs` | `ADMIN`, `OPERATOR` | Penerbitan surat edaran resmi berkas PDF dengan nomor surat dinamis |
| **Rilis Update APK**| `/admin/app-releases` | `manajemen_app_release.ejs` | `ADMIN`, `OPERATOR` | Manajemen versi APK (wajib update / opsional) & repositori file APK |
| **Manajemen Kurikulum**| `/kurikulum` | `kurikulum_dashboard.ejs` | `KURIKULUM`, `ADMIN` | Pembagian jam mengajar, kalender akademik, jadwal KBM |
| **Manajemen CBT** | `/admin/cbt` | `manajemen_cbt.ejs` | `KURIKULUM`, `OPERATOR` | Bank soal, generate token ujian 15 menit, reset sesi peserta ujian |
| **Monitoring Ujian**| `/admin/cbt/monitoring` | `monitoring_ujian.ejs` | `KURIKULUM`, `TEACHER` | Pantauan live layar peserta ujian CBT, status pengerjaan, dan anti-cheat |
| **CBT Ruang Siswa** | `/cbt/room` | `student_cbt_room.ejs` | `STUDENT` | Antarmuka web cadangan ujian CBT jika HP siswa mengalami kendala |
| **Manajemen PR** | `/admin/tugas` | `manajemen_tugas.ejs` | `KURIKULUM`, `TEACHER` | Pengawasan beban pekerjaan rumah siswa per rombel |
| **Portal Guru & Wali**| `/guru` | `guru_dashboard.ejs` | `TEACHER`, `GURU` | Agenda harian, presensi mapel, nilai live UH, bimbingan wali kelas |
| **Portal BK** | `/bk` | `bk_dashboard.ejs` | `COUNSELOR`, `ADMIN` | Rekam kasus disiplin, live curhat online siswa, kalkulasi SAW ranking |
| **Portal UKS** | `/uks` | `uks_dashboard.ejs` | `MEDICAL`, `ADMIN` | Rekam medis siswa, obat-obatan, dispensasi sakit, jadwal jaga PMR |
| **Ekstrakurikuler** | `/ekstrakurikuler` | `manajemen_ekstrakurikuler.ejs`| `TEACHER`, `OPERATOR` | 20+ ekskul, presensi QR sore hari, jurnal pembina, rapor nilai ekskul |
| **E-Library** | `/operator/perpus` | `manajemen_elibrary.ejs` | `LIBRARIAN`, `OPERATOR` | Sirkulasi buku digital, peminjaman barcode, buku paket semester |
| **Pos Satpam** | `/satpam/gatepass` | `satpam_gatepass.ejs` | `SECURITY`, `OPERATOR` | Validasi barcode izin keluar gerbang, monitoring tap kartu RFID masuk |
| **Kantin Sehat** | `/kantin` | `kantin_dashboard.ejs` | `OPERATOR`, Petugas | Terminal POS kasir makanan sehat, topup saldo kartu, rekap penjualan |
| **Kesiswaan & OSIS**| `/admin/kesiswaan` | `kesiswaan_dashboard.ejs` | `ADMIN`, `OPERATOR` | Mutasi siswa Dapodik, biodata afirmasi, pelacakan siswa rentan |
| **E-Voting OSIS** | `/admin/evoting` | `manajemen_evoting.ejs` | `ADMIN`, Pembina OSIS | Pemilihan Ketua OSIS (Pemilos) online anti-golput & audit TPS |
| **Dapodik Raport** | `/admin/dapodik-raport` | `manajemen_dapodik_raport.ejs`| `OPERATOR`, `KURIKULUM` | Sinkronisasi data semester, cetak rapor, penomoran NIS lokal |
| **Display Kelas** | `/display/kelas-kosong` | `display_kelas_kosong.ejs` | Publik / Guru Piket | Monitor TV koridor menampilkan rombel yang guru-nya izin / jam kosong |
| **Kiosk RFID Tap** | `/absensi/tap-kartu` | `kiosk_tap_kartu.ejs` | Publik Gerbang | Layar sentuh mandiri tap kartu pelajar RFID jika gerbang padat |
| **Cetak Barcode** | `/admin/cetak-barcode` | `cetak_barcode_kelas.ejs` | `OPERATOR` | Generator stiker barcode statis presensi pintu kelas format A4 siap print |
| **Cetak Kartu Siswa**| `/admin/cetak-kartu` | `cetak_kartu_siswa.ejs` | `OPERATOR` | Layout cetak kartu tanda pelajar resmi lengkap dengan barcode & foto |
| **Wi-Fi MikroTik** | `/admin/wifi` | `manajemen_wifi.ejs` | `ADMIN` | Konfigurasi radius hotspot Wi-Fi sekolah dan kuota perangkat siswa |

---

## 6. AUDIT APLIKASI MOBILE ANDROID (31 ACTIVITY, BACKGROUND SERVICE, & KOTLIN TIER)

Aplikasi mobile **SmartSchool / SmartCBT** adalah aplikasi *multi-role* native Android berbasis **Kotlin** yang dibangun dengan performa tinggi, konsumsi daya minimal, dan lapisan keamanan anti-kecurangan.

### 6.1 Daftar Lengkap 31 Activity & Peruntukannya
1. **`MainActivity`:** *Bootstrap Router & Splash Screen* cerdas yang mengecek integritas sesi token JWT dan mengarahkan otomatis ke dashboard yang sesuai peran (Siswa, Guru, Orang Tua, Operator, atau Satpam).
2. **`ui.LoginActivity`:** Layanan autentikasi terpusat dengan deteksi otomatis kredensial, verifikasi status kunci perangkat (`deviceBindingId`), dan pemilihan server otomatis (Cloud / Local LAN).
3. **`ui.StudentMainActivity`:** Dashboard utama siswa (Koleksi menu, kartu ucapan dinamis, status presensi hari ini, jadwal mapel berjalan, countdown ujian, dan banner pengumuman pop-up).
4. **`ui.ParentMainActivity`:** Dashboard orang tua untuk memantau jam presensi anak secara live, nilai ujian, riwayat disiplin, dan top-up kantin.
5. **`ui.TeacherMainActivity`:** Dashboard guru lengkap dengan absensi mengajar, live Ulangan Harian, jurnal kelas, dan menu verifikasi sholat.
6. **`ui.OperatorMainActivity`:** Kontrol darurat teknis mobile bagi operator sekolah untuk membuka kunci HP siswa dan mengirim siaran darurat.
7. **`ui.SatpamMainActivity`:** Pemindai barcode gerbang untuk memvalidasi izin keluar siswa dan pencatatan kepulangan dini.
8. **`ui.KantinMainActivity`:** Terminal kasir kantin untuk transaksi makanan berbasis tap kartu siswa atau barcode QR dompet digital.
9. **`ExamActivity`:** Mesin ujian Kiosk CBT dengan penguncian layar tingkat tinggi (*screen pinning*), pelarangan tombol navigasi, dan anti *split-screen*.
10. **`ScannerActivity`:** Mesin pemindai kamera (Barcode gerbang, QR statis kelas ber-GPS, QR dinamis pengurus kelas, dan barcode kartu pelajar).
11. **`ui.PdfViewerActivity`:** Penampil berkas PDF resmi internal sekolah (Surat edaran, rapor, kartu ujian) tanpa membutuhkan aplikasi eksternal pihak ketiga.
12. **`ui.BkActivity`:** Pusat rekam bimbingan konseling dan pencatatan poin pelanggaran tata tertib.
13. **`ui.WaliKelasActivity`:** Antarmuka wali kelas untuk memantau kehadiran 32 siswa sekelas, status dispensasi, dan rekap buku presensi manual.
14. **`ui.AttendanceActivity`:** Buku riwayat kehadiran pribadi siswa/guru lengkap dengan grafik persentase hadir, izin, sakit, dan dispensasi.
15. **`ui.ExambroGatewayActivity`:** Gerbang pengecekan integritas lingkungan perangkat sebelum memasuki sesi ujian resmi CBT.
16. **`ui.UksActivity`:** Layanan kesehatan siswa, riwayat berobat di sekolah, dan pengajuan penjemputan darurat ke orang tua.
17. **`ui.EkstrakurikulerActivity`:** Portal ekskul siswa (informasi jadwal, pembina, presensi QR pertemuan, dan nilai kompetensi).
18. **`ui.AnnouncementActivity`:** Pusat Pengumuman Sekolah terpadu dengan penyaring kategori (*Penting, Ujian, Akademik, Umum, & Surat Resmi*).
19. **`ui.ParentLettersActivity`:** Daftar surat edaran resmi kepala sekolah yang wajib dibaca dan ditandatangani digital oleh orang tua.
20. **`ui.ParentExamsActivity`:** Transkrip nilai CBT dan Ulangan Harian anak yang transparan dan *real-time*.
21. **`ui.ParentHomeworkActivity`:** Pelacak tugas dan PR anak yang belum diselesaikan beserta batas akhir pengumpulan.
22. **`ui.LibraryActivity`:** Katalog perpustakaan online (peminjaman buku fisik barcode dan membaca e-book materi pelajaran).
23. **`ui.EvotingActivity`:** Bilik suara elektronik pemilihan Ketua & Wakil Ketua OSIS secara langsung, bebas, dan rahasia.
24. **`ui.ExitPassActivity`:** Lembar izin digital keluar lingkungan sekolah pada jam pelajaran atas persetujuan guru piket & konselor BK.
25. **`ui.KonselingCurhatActivity`:** Layanan konseling privat daring siswa dengan guru BK (enkripsi obrolan personal).
26. **`ui.ParentBiodataActivity`:** Verifikasi biodata kartu keluarga dan orang tua untuk kelengkapan Dapodik Kemendikbud.
27. **`ui.BiodataRaportActivity`:** Lembar profil akademik siswa dan arsip dokumen ijazah/akta digital.
28. **`ui.AppGuideActivity`:** Panduan penggunaan aplikasi dan tanya jawab kendala teknis.
29. **`ui.HafalanJuz30Activity`:** Laboratorium mandiri Tahfiz Juz 30 (Audio player per ayat, murojaah berulang, tes tebak sambung ayat, dan status setor).
30. **`ui.HiddenAdminActivity`:** Panel tersembunyi administrator untuk diagnosa sinyal, sinkronisasi file lokal, dan perbaikan cache perangkat.
31. **`ui.PengurusKelasActivity`:** Antarmuka khusus perangkat pengurus kelas untuk menghasilkan **QR Dinamis 10-Detik** dan pemindaian barcode teman sekelas.

---

## 7. AUDIT SISTEM KEAMANAN APK & MEKANISME ANTI-TAMPERING

Keamanan pada APK dirancang untuk memastikan lingkungan ujian bebas kecurangan dan integritas presensi yang tidak dapat dimanipulasi:

```mermaid
flowchart TD
    subgraph Security_Layers [LAPISAN PERTAHANAN KEAMANAN APK]
        direction TB
        
        subgraph Layer_1 [Layer 1: Identitas & Kunci Perangkat]
            L1_A["Hardware Fingerprint & Android ID"]
            L1_B["Device Binding Check (Maks 1 HP per Siswa)"]
            L1_C["Operator Remote Unlock Mechanism"]
        end

        subgraph Layer_2 [Layer 2: Integritas Presensi Gerbang & Kelas]
            L2_A["Deteksi Mock Location / Aplikasi Fake GPS"]
            L2_B["Haversine Geofence Calculation (Max 50m Perimeter)"]
            L2_C["TOTP 10-Second Rotating Dynamic QR Engine"]
            L2_D["Static QR Classroom Locked with GPS Mandatory"]
        end

        subgraph Layer_3 [Layer 3: Kiosk Exam Lockdown (CBT Anti-Cheat)]
            L3_A["Screen Pinning / startLockTask()"]
            L3_B["Window Focus Loss & Multi-Window Interception"]
            L3_C["FLAG_SECURE Anti-Screenshot & Screen Recording"]
            L3_D["Hardware Keycode Intercept (Home, Recent, Back)"]
            L3_E["Accessibility Service Tamper Guard"]
        end

        subgraph Layer_4 [Layer 4: Keamanan Jaringan & Token]
            L4_A["Dynamic JWT Refresh via Authenticator"]
            L4_B["Encrypted Local Cache (Room DB / SharedPreferences)"]
            L4_C["Heartbeat & Incident Telemetry Logging"]
        end
    end

    Layer_1 --> Layer_2 --> Layer_3 --> Layer_4
```

### 7.1 Rincian Mekanisme Anti-Kecurangan Presensi
1. **Penolakan Barcode Statis Tanpa GPS:** Jika siswa mencoba memindai stiker barcode pintu kelas tanpa mengaktifkan GPS atau berada di luar radius 50 meter dari titik koordinat sekolah, server secara tegas merespons dengan kode **403 Forbidden** disertai petunjuk untuk menggunakan QR Dinamis Pengurus Kelas.
2. **QR Dinamis Pengurus Kelas (TOTP 10 Detik):** Menggunakan formula hash dinamis berbasis waktu Unix yang berubah setiap 10 detik di layar HP pengurus kelas. Siswa yang memotret layar HP pengurus kelas tidak akan bisa membagikannya ke teman di rumah, karena QR otomatis basi (*expired*) dalam hitungan detik.
3. **Penyelarasan Offline Resilient:** Jika sinyal sekolah terputus (*down*), APK mencatat waktu presensi lokal beserta koordinat GPS terenkripsi ke dalam database SQLite internal dan secara otomatis melakukan sinkronisasi massal (*bulkSyncAttendance*) saat koneksi internet pulih.

---

## 8. ANALISIS MATRIKS 15 PERAN (ROLES) & HAK AKSES FUNGSIONAL

Berikut adalah matriks komparasi hak akses komprehensif pada seluruh ekosistem:

| No | Peran Pengguna (Role) | Hak Akses Portal Web | Hak Akses Fitur APK Mobile | Kewenangan Utama & Tanggung Jawab Operasional |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Siswa (Student)** | `/siswa`, `/cbt/room` | `StudentMainActivity`, `ExamActivity`, `HafalanJuz30Activity`, `KonselingCurhatActivity` | Presensi mandiri, ujian CBT, setor hafalan juz 30, cek nilai, beli makan kantin, lapor kelas kosong |
| **2** | **Pengurus Kelas** | `/siswa` | Tambahan `PengurusKelasActivity` | Menampilkan QR Dinamis 10s bagi teman yang GPS-nya rusak, scan barcode teman yang tak bawa HP |
| **3** | **Orang Tua (Parent)** | `/orangtua` | `ParentMainActivity`, `ParentLettersActivity`, `ParentExamsActivity` | Pantau jam pulang/datang anak, ajukan izin sakit + foto dokter, top-up saldo kantin via Midtrans |
| **4** | **Guru Mapel** | `/guru`, `/display/kelas-kosong` | `TeacherMainActivity`, `ExamActivity` (Pengawas) | Catat jurnal mengajar, buat kuis Ulangan Harian cepat, input absensi mapel, awasi ujian CBT |
| **5** | **Wali Kelas** | Tab Wali Kelas di `/guru` | `WaliKelasActivity` di APK Guru | Monitoring 32 siswa perwalian, rekap buku absensi manual, tulis catatan pembinaan rapor |
| **6** | **Guru PAI & Mushola**| Menu Sholat & Tahfiz di `/guru`| Menu Verifikasi Tahfiz & Scanner Mushola di APK Guru | Verifikasi hafalan juz 30, presensi sholat dhuha & dhuhur berjamaah, pembinaan akhlak |
| **7** | **Kurikulum** | `/kurikulum`, `/admin/cbt`, `/admin/tugas` | Mengakses mode Pengawas di APK | Rilis token ujian CBT per 15 menit, atur jadwal KBM, atur beban PR, cetak rapor Dapodik |
| **8** | **Operator Sekolah**| `/operator` (20+ modul operator)| `OperatorMainActivity` | Reset kunci HP siswa (`deviceBinding`), broadcast surat edaran, sinkronisasi data Dapodik |
| **9** | **Super Admin** | `/admin` (Seluruh modul sistem) | `HiddenAdminActivity` & Mode Admin | Konfigurasi server, pemantauan kapasitas, rilis versi APK baru, audit telemetri sistem |
| **10**| **Guru BK (Konselor)**| `/bk` | `BkActivity`, respon Curhat BK di APK | Catat pelanggaran disiplin siswa, mediasi curhat daring, jalankan SAW prediktor siswa rentan |
| **11**| **Petugas UKS & PMR** | `/uks` | `UksActivity` | Rekam medis siswa, obat inventaris, dispensasi sakit pulang, jadwal dinas anggota PMR |
| **12**| **Petugas Satpam** | `/satpam/gatepass` | `SatpamMainActivity` | Pantau gerbang RFID, scan QR izin keluar siswa jam sekolah, kawal penjemputan darurat |
| **13**| **Kasir Kantin** | `/kantin` | `KantinMainActivity` | Terima pembayaran non-tunai barcode siswa, rekap pendapatan stand makanan sehat |
| **14**| **Pustakawan** | `/operator/perpus` | `LibraryActivity` | Sirkulasi buku barcode, inventaris buku paket kurikulum merdeka, kelola e-book |
| **15**| **Pembina Ekskul** | `/ekstrakurikuler` | `EkstrakurikulerActivity` | Presensi latihan sore QR/GPS, catat jurnal kegiatan mingguan, nilai portofolio ekskul |

---

## 9. JALUR SISTEM, JALUR DATA, & ALUR PROSES END-TO-END (MERMAID WORKFLOW TRACES)

### 9.1 Alur Presensi Masuk Gerbang, Penanganan Masalah & Notifikasi Orang Tua

```mermaid
sequenceDiagram
    autonumber
    actor Siswa as 👨‍🎓 Siswa di Gerbang/Kelas
    actor Pengurus as 🤝 Pengurus Kelas
    participant APK as 📱 HP Siswa (ScannerActivity)
    participant Server as ⚙️ Backend (attendanceController)
    participant DB as 🗄️ PostgreSQL (smartschool)
    actor Ortu as 👪 Orang Tua Siswa

    alt Skenario A: Siswa Bawa HP & GPS Aktif
        Siswa->>APK: Buka Pemindai Barcode Kelas
        APK->>APK: Kunci Koordinat GPS (Latitude/Longitude)
        Siswa->>APK: Scan Barcode Statis di Pintu Kelas
        APK->>Server: POST /api/attendance/scan-class (Code, Lat, Lng, Method="GPS")
        Server->>Server: Hitung Jarak Haversine (Max 50 Meter dari Sekolah)
        Server->>DB: INSERT Attendance (Status="HADIR", Method="BARCODE")
        Server->>DB: INSERT NotificationMessage (Tujuan=Orang Tua)
        Server-->>APK: 200 OK: "Presensi Berhasil!"
        Server-->>Ortu: Push Notif: "Anak Anda telah hadir di sekolah pkl 06.45 WIB"
    else Skenario B: GPS Error / HP Tidak Ada GPS
        Siswa->>APK: Scan Barcode Statis (Tanpa GPS)
        APK->>Server: POST /api/attendance/scan-class (Method="MANUAL/NO_GPS")
        Server-->>APK: 403 Forbidden: "Gunakan QR Dinamis Pengurus Kelas"
        Siswa->>Pengurus: Minta Tampilkan QR Dinamis
        Pengurus->>Pengurus: Buka PengurusKelasActivity (Generate TOTP 10s)
        Siswa->>APK: Scan Layar HP Pengurus Kelas
        APK->>Server: POST /api/attendance/scan-class (DynamicToken)
        Server->>Server: Validasi Hash Kriptografi TOTP 10 Detik
        Server->>DB: INSERT Attendance (VerifiedBy="Pengurus Kelas VII-A")
        Server-->>APK: 200 OK: "Presensi Valid via Pengurus Kelas"
    else Skenario C: Siswa Tidak Bawa HP / Ketinggalan
        Siswa->>Pengurus: Bawa Kartu Pelajar Fisik (Barcode NISN)
        Pengurus->>Pengurus: Buka Menu "Bantu Teman" di PengurusKelasActivity
        Pengurus->>Server: POST /api/pengurus-kelas/assisted-scan (NISN Siswa)
        Server->>DB: INSERT Attendance (Method="ASSISTED_CARD")
        Server-->>Pengurus: "Presensi Teman Berhasil Tercatat!"
        Server-->>Ortu: Push Notif: "Presensi Masuk Anak Dicatat oleh Pengurus Kelas"
    end
```

### 9.2 Alur CBT Ujian Resmi & Ulangan Harian Kilat

```mermaid
sequenceDiagram
    autonumber
    actor Guru as 👨‍🏫 Guru / Kurikulum
    participant Web as 💻 Web Portal CBT (/kurikulum, /guru)
    participant Server as ⚙️ Server CBT Engine
    participant DB as 🗄️ PostgreSQL
    actor Siswa as 👨‍🎓 Siswa Ujian
    participant APK as 📱 HP Siswa (ExamActivity)

    Guru->>Web: Rilis Paket Ujian & Generate Token 6-Digit
    Web->>Server: POST /api/cbt/toggle-token (Active=true, Duration=15m)
    Server->>DB: INSERT ExamClassToken (Token="AB9X7K", ExpiredAt=+15m)
    
    Siswa->>APK: Masukkan Token Ujian di ExambroGatewayActivity
    APK->>Server: POST /api/cbt/verify-token (Token="AB9X7K")
    Server-->>APK: Token Valid -> Buka ExamActivity
    
    APK->>APK: Aktifkan Kiosk Mode (startLockTask & FLAG_SECURE)
    APK->>Server: GET /api/cbt/questions (ExamId)
    Server->>DB: Query Bank Soal (Randomize Shuffled per Siswa)
    Server-->>APK: 50 Butir Soal & Kunci Terenkripsi

    loop Tiap Butir Soal Dijawab
        Siswa->>APK: Pilih Opsi Jawaban (cth: C)
        APK->>APK: Simpan Lokal ke Room DB (Anti Koneksi Drop)
        APK->>Server: POST /api/cbt/save-answer (QuestionId, Answer="C")
        Server->>DB: UPSERT ExamAnswer
    end

    alt Siswa Mencoba Keluar / Buka Aplikasi Lain
        Siswa->>APK: Tekan Home / Split Screen / Screenshot
        APK->>APK: Tangkap Event -> Blokir Tindakan
        APK->>Server: POST /api/cbt/log-incident (Jenis="WINDOW_BLUR")
        Server->>DB: INSERT ExamIncidentLog (Peringatan Pelanggaran #1)
        Server-->>Web: Tampilan Layar Pengawas Berkedip Merah!
    end

    Siswa->>APK: Tekan "Selesai Ujian & Kumpulkan"
    APK->>Server: POST /api/cbt/submit-final
    Server->>Server: Kalkulasi Nilai Otomatis & Koreksi Essai AI
    Server->>DB: UPDATE ExamParticipant (Score=88.5, Status="SUBMITTED")
    Server-->>APK: "Ujian Selesai! Nilai Anda: 88.5"
    APK->>APK: Lepaskan Kiosk Mode -> Kembali ke Dashboard
```

### 9.3 Alur Finansial E-Kantin (Isi Saldo Midtrans -> Belanja Makanan Kasir)

```mermaid
sequenceDiagram
    autonumber
    actor Ortu as 👪 Orang Tua
    participant APK_P as 📱 APK Orang Tua
    participant Midtrans as 💳 Midtrans Gateway
    participant Server as ⚙️ Server Finansial
    participant DB as 🗄️ PostgreSQL
    actor Siswa as 👨‍🎓 Siswa di Kantin
    actor Kasir as 🥗 Kasir Stand Kantin
    participant APK_K as 📱 APK Kantin

    Ortu->>APK_P: Pilih Isi Saldo Kantin Anak (Rp 50.000)
    APK_P->>Server: POST /api/canteen/topup-request (Amount=50000)
    Server->>Midtrans: Create Snap Transaction (OrderId="TOPUP-123")
    Midtrans-->>Server: Return Snap Token & QRIS URL
    Server-->>APK_P: Tampilkan Lembar Pembayaran Midtrans Snap
    Ortu->>Midtrans: Bayar via BCA Virtual Account / QRIS GoPay
    
    Midtrans->>Server: Webhook HTTP POST /api/canteen/midtrans-callback
    Server->>Server: Verifikasi Signature Key Midtrans SHA512
    Server->>DB: UPDATE CanteenTopup (Status="PAID")
    Server->>DB: UPDATE User (WalletBalance = WalletBalance + 50000)
    Server-->>APK_P: Push Notif: "Saldo Kantin Anak Berhasil Ditambahkan Rp 50.000"

    Siswa->>Kasir: Pesan Nasi Soto & Susu (Total Rp 15.000)
    Siswa->>Kasir: Tunjukkan Barcode Kartu Pelajar
    Kasir->>APK_K: Buka KantinMainActivity -> Scan Barcode Siswa
    APK_K->>Server: POST /api/canteen/pay-transaction (StudentId, Amount=15000)
    Server->>DB: Cek Saldo Cukup (Sisa Saldo = 35.000)
    Server->>DB: INSERT CanteenTransaction (Debit=15000, Stand="Stand 03")
    Server-->>APK_K: 200 OK: "Pembayaran Berhasil! Sisa Saldo: Rp 35.000"
    Server-->>APK_P: Push Notif Ortu: "Anak Anda baru saja belanja di Kantin Rp 15.000"
```

---

## 10. ANALISIS RESIKO, EVALUASI ARSITEKTURAL, & REKOMENDASI MITIGASI

Hasil audit independen mengidentifikasi sejumlah kelebihan solid serta poin penting yang memerlukan perhatian teknis:

### 10.1 Keunggulan Arsitektural (Strengths)
1. **Pemisahan Validasi Logika:** Mekanisme penolakan barcode statis tanpa GPS kini sepenuhnya dikendalikan sisi server (*Server-Side Validation*), menghentikan ketergantungan pada update APK berulang saat terjadi perubahan kebijakan presensi.
2. **Koleksi Telemetri Luar Biasa:** Pencatatan 106k event aktivitas dan 12k log error klien membuktikan sistem ini sangat siap untuk audit forensik dan pemantauan kualitas perangkat secara proaktif.
3. **Resiliensi Multi-Layer:** Desain alur presensi kelas dengan 3 lapis fallback (GPS Mandiri -> QR Dinamis 10s Pengurus -> Kartu Pelajar Barcode Asisten) menjamin 100% siswa tetap dapat tercatat hadir meski terjadi gangguan internet atau kerusakan hardware ponsel.

### 10.2 Titik Perhatian & Rekomendasi Optimalisasi (Actionable Findings)
1. **Kebijakan Pembersihan Log (Log Retention Policy):**
   * *Status Terkini:* **TERLAKSANA & AKTIF (30-Day Retention Worker)**.
   * *Temuan Awal:* Tabel `ActivityEventLog` telah mencapai 106.298 baris dan `CopyRequest` mencapai 26.723 baris. Jika dibiarkan tanpa batas, ukuran file database PostgreSQL akan terus membengkak dan menurunkan kecepatan query indeks.
   * *Tindakan & Mitigasi:* Telah diimplementasikan worker pembersihan log otomatis di `backend/src/services/systemScheduler.ts` (`processLogRetentionCleanup`) yang berjalan setiap hari pukul 02:00 WIB dini hari dan endpoint manual `POST /api/admin/logs/retention-cleanup`. Seluruh data `ActivityEventLog`, `CopyRequest`, `AppClientErrorLog`, dan `ActivityAnomaly` (berstatus RESOLVED) yang berusia **lebih dari 30 hari otomatis dihapus**, menjaga PostgreSQL tetap kencang, ringan, dan terhindar dari kembung data (*table bloat*).
2. **Koneksi Tunggal Database (Single DB Node):**
   * *Temuan:* Seluruh beban membaca (*read*) dan menulis (*write*) ditangani oleh satu instance PostgreSQL lokal.
   * *Rekomendasi:* Untuk persiapan ujian serentak 1.000 siswa, manfaatkan *connection pooling* PgBouncer dan optimalkan konfigurasi `shared_buffers = 1GB` serta `work_mem = 16MB` di `postgresql.conf`.
3. **Penyimpanan Berkas Lampiran:**
   * *Temuan:* Berkas PDF surat dan lampiran tersimpan di folder lokal `/uploads/letters/`.
   * *Rekomendasi:* Aktifkan cron sinkronisasi berkala ke bucket Supabase Storage yang telah terkonfigurasi di `.env` sebagai cadangan redundan di awan.

---

## 11. KERANGKA KERJA & PANDUAN AUDIT INDEPENDEN UNTUK AI LAIN

Dokumen audit ini disusun dengan standar arsitektur formal agar model kecerdasan buatan (AI) eksternal (seperti Claude, GPT-4, Llama-3, atau Gemini) dapat melakukan evaluasi independen secara obyektif tanpa asumsi subjektif.

### Panduan Instruksi Evaluasi Bagi AI Eksternal:
```text
PROMPT INSTRUKSI AUDITOR INDEPENDEN:
Anda bertindak sebagai Lead Software Architect & Chief Cybersecurity Auditor independen.
Silakan evaluasi dokumen teknis di atas yang memetakan sistem "SmartSchool SMPN 1 Boyolangu".
Lakukan analisis mendalam terhadap aspek-aspek berikut:
1. Validasi Keamanan: Nilai ketahanan sistem Kiosk CBT, logika presensi multi-layer (GPS vs QR Dinamis TOTP), dan perlindungan device-binding terhadap potensi kecurangan siswa.
2. Skalabilitas & Beban: Berikan estimasi konkurensi ketika 989 siswa melakukan ujian CBT serentak (I/O database PostgreSQL, latensi Express router, dan konsumsi memori).
3. Pemenuhan Regulasi Sekolah: Evaluasi kelengkapan fitur dari 15 peran yang diakomodasi (Kurikulum, Wali Kelas, Guru PAI, BK, UKS, Satpam, Orang Tua, Siswa).
4. Berikan skor kesiapan arsitektur (Skala 1 - 100) dan 3 saran arsitektural strategis untuk pengembangan jangka panjang.
```

---
*Laporan Audit Selesai Disusun & Diverifikasi Secara Otomatis oleh Sistem Antigravity AI Engine.*
*Status Repositori: Siap Diaudit dan Diproses oleh Auditor Manusia maupun AI Independen.*
