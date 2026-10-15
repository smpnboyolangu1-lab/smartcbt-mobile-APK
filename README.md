# SMART SCHOOL CBT — SMP NEGERI 1 BOYOLANGU
### Sistem Terpadu Computer-Based Testing (CBT) Mobile APK & Unified Web Portal
*Versi Rilis Saat Ini: **v2.8.150** (Build **160**) • Target OS: Android 14 (API 34) & Web Enterprise*

---

## 📌 Ringkasan Ekosistem
Smart School CBT adalah platform digital komprehensif milik SMP Negeri 1 Boyolangu, Tulungagung, Jawa Timur. Sistem ini mengintegrasikan asesmen ujian berbasis kiosk anti-kecurangan, presensi digital geofence GPS, protokol bantuan presensi bagi siswa tanpa HP, kecerdasan buatan Google Gemini 2.5 Flash Vision OCR untuk verifikasi surat izin sakit dokter, dan portal manajemen akademik kurikulum terpadu.

Dokumentasi teknis resmi dan lengkap tersedia di:
👉 **[DOKUMENTASI_LENGKAP_APK_DAN_PORTAL_SMARTCBT.md](docs/DOKUMENTASI_LENGKAP_APK_DAN_PORTAL_SMARTCBT.md)**

---

## 📂 Struktur Utama Repositori

```
C:\APK
├── android_app/           # Proyek Android Native (Kotlin, SDK 34, CameraX, Room DB, ML Kit)
│   ├── app/src/main/java/com/school/smartcbt/
│   │   ├── ui/            # Seluruh antarmuka 8 Role (Siswa, Guru, Pengurus, BK, Satpam, dll)
│   │   ├── service/       # Always-On Foreground Service 24/7 & Worker sinkronisasi
│   │   ├── data/          # Model DTO, Room Database lokal & Retrofit REST API Client
│   │   └── utils/         # Deteksi Mock GPS, Selfie Segmentation AI, TTS & Update Checker
│   └── build_apk.bat      # Skrip sekali klik untuk kompilasi release APK
│
├── backend/               # Server Web Portal (Node.js 20+, Express 5, TypeScript, Prisma ORM)
│   ├── src/
│   │   ├── server.ts      # Entrypoint server, Socket.io, Cloudflare timeout handler
│   │   ├── routes/        # Rute API RESTful (/api)
│   │   ├── controllers/   # Logika bisnis CBT, Presensi, BK AI, WhatsApp Blast & Device Manager
│   │   └── views/         # 30+ Antarmuka Web Portal EJS (Kurikulum, Admin, Guru, BK, Satpam)
│   ├── prisma/            # Skema database SQLite WAL (dev.db)
│   └── uploads/           # Berkas APK rilis, media foto, pasfoto biometrik, modul & tugas
│
├── docs/                  # Dokumentasi teknis, analisis arsitektur & checklist kesiapan cetak
│   ├── DOKUMENTASI_LENGKAP_APK_DAN_PORTAL_SMARTCBT.md  <-- Master Panduan Lengkap
│   └── CHECKLIST_FITUR_SMARTCBT_SIAP_PRINT.docx       <-- Checklist Siap Cetak
│
├── smartcbt-latest.apk    # Distribusi biner APK rilis resmi terbaru (v2.8.150 Build 160)
├── run_pm2_persistent.bat # Skrip daemon persistent server backend 24/7
└── deploy_to_vps.ps1      # Skrip sinkronisasi & deploy ke server produksi
```

---

## 🚀 Panduan Ringkas Menjalankan Sistem

### 1. Menjalankan Server Backend Web Portal
Pastikan dependensi Node.js telah terpasang, lalu jalankan server persisten melalui PM2:
```cmd
cd C:\APK
run_pm2_persistent.bat
```
Server akan aktif di:
- **Akses LAN Lokal**: `http://localhost:3000` atau `http://192.168.1.xxx:3000`
- **Akses Publik Internet**: `https://cbt.smpn1boyolangu.my.id` (via Cloudflare Tunnel)

### 2. Melakukan Kompilasi & Build APK Android
Untuk mengompilasi APK versi rilis dengan optimasi Proguard/R8:
```cmd
cd C:\APK\android_app
build_apk.bat
```
Berkas APK yang dihasilkan akan otomatis disalin ke `C:\APK\smartcbt-latest.apk` dan `C:\APK\backend\uploads\smartcbt-latest.apk`, siap diunduh oleh seluruh siswa melalui fitur in-app updater.

---

## 👥 Matriks Hak Akses & Akun Sistem

| Peran (Role) | Kredensial Masuk | Dasbor Mobile APK | Dasbor Web Portal |
|---|---|---|---|
| **Super Admin** | `admin` | `HiddenAdminActivity` (Tap 7x) | `/admin` (`admin_dashboard.ejs`) |
| **Kurikulum** | Akun Guru Kurikulum | `TeacherMainActivity` | `/kurikulum` & `/admin/cbt` |
| **Guru Mapel** | NIP 18 Digit | `TeacherMainActivity` | `/guru` (`guru_dashboard.ejs`) |
| **Wali Kelas** | NIP 18 Digit | `WaliKelasActivity` | `/guru` (Tab Rombel Binaan) |
| **Guru BK** | NIP 18 Digit | `BkActivity` | `/bk` (`bk_dashboard.ejs`) |
| **Siswa** | NISN 10 Digit | `StudentMainActivity` | `/siswa` (`siswa_dashboard.ejs`) |
| **Pengurus Kelas** | NISN (Diberi Mandat) | `PengurusKelasActivity` | Terintegrasi di APK |
| **Orang Tua** | `P` + NISN Siswa | `ParentMainActivity` | `/orangtua` (`parent_dashboard.ejs`) |
| **Satpam / Pos Gerbang** | `satpam` / `satpam123` | `SatpamMainActivity` | `/satpam/gatepass` |
| **Operator Sekolah** | Akun Operator | `OperatorMainActivity` | `/operator` (`operator_dashboard.ejs`) |

---

Untuk panduan mendalam tentang alur kerja, struktur kode sumber, arsitektur database, dan panduan pemecahan masalah teknis, silakan merujuk pada **[DOKUMENTASI_LENGKAP_APK_DAN_PORTAL_SMARTCBT.md](docs/DOKUMENTASI_LENGKAP_APK_DAN_PORTAL_SMARTCBT.md)**.
