import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const DEFAULT_FEATURE_SETTINGS = [
  // 1. FITUR APK ANDROID
  {
    key: "feature.scanner.geolocation",
    value: "true",
    type: "boolean",
    description: "Jika NONAKTIF: Scanner presensi beralih ke Mode QR-Only murni (zero GPS). Tidak ada aktivasi GPS/lokasi satelit sama sekali, sangat hemat baterai, siswa cukup memindai QR code kelas."
  },
  {
    key: "feature.scanner.antiFakeGps",
    value: "true",
    type: "boolean",
    description: "Deteksi Mock / Fake GPS & aplikasi lokasi palsu pada saat pemindaian presensi."
  },
  {
    key: "feature.scanner.antiRoot",
    value: "true",
    type: "boolean",
    description: "Deteksi perangkat root / Magisk / developer options aktif untuk mencegah manipulasi data absensi."
  },
  {
    key: "feature.apk.forceUpdate",
    value: "true",
    type: "boolean",
    description: "Wajibkan pembaruan APK otomatis (Force Update). Jika aktif, versi lama tidak dapat digunakan."
  },
  {
    key: "feature.apk.stagedRollout",
    value: "false",
    type: "boolean",
    description: "Rollout bertahap (10% - 100%) untuk rilis APK versi baru."
  },
  {
    key: "feature.auth.deviceBinding",
    value: "true",
    type: "boolean",
    description: "Penguncian 1 Akun Siswa hanya pada 1 Perangkat HP Android fisik terdaftar (Device Binding)."
  },
  {
    key: "feature.attendance.offlineQueue",
    value: "false",
    type: "boolean",
    description: "Mode antrian absensi offline: Dinonaktifkan sesuai kebijakan presensi langsung online real-time."
  },
  {
    key: "feature.ekantin.enabled",
    value: "false",
    type: "boolean",
    description: "Modul E-Kantin Digital Siswa, Orang Tua & Kasir Stand Kantin: Dompet digital siswa, limit belanja harian, dan kasir POS stand kantin (Status: Dalam Pengembangan - Default Nonaktif)."
  },
  {
    key: "feature.remote.wifiOnlyUpload",
    value: "true",
    type: "boolean",
    description: "Pengunggahan berkas tugas/telemetri perangkat remote HANYA aktif saat terhubung ke Wi-Fi agar kuota data seluler siswa tetap hemat."
  },

  // 2. MODUL UTAMA SEKOLAH
  {
    key: "feature.evoting.enabled",
    value: "true",
    type: "boolean",
    description: "Layanan E-Voting OSIS LUBER JURDIL: Mengaktifkan atau menonaktifkan bilik suara pemilihan ketua OSIS di portal dan APK siswa."
  },
  {
    key: "feature.form.biodata",
    value: "true",
    type: "boolean",
    description: "Layanan Formulir Pembaruan Biodata Siswa: Membuka atau menutup periode pengisian data pribadi dan orang tua siswa."
  },
  {
    key: "feature.cbt.enabled",
    value: "true",
    type: "boolean",
    description: "Modul Asesmen & CBT Ujian Online: Mengaktifkan portal pengerjaan ujian dan validasi token CBT siswa."
  },
  {
    key: "feature.homework.enabled",
    value: "true",
    type: "boolean",
    description: "Modul Tugas & PR Digital Guru: Mengizinkan pembuatan dan pengumpulan lembar kerja / pekerjaan rumah siswa."
  },
  {
    key: "feature.attendance.geofence",
    value: "true",
    type: "boolean",
    description: "Validasi Geofencing Presensi Ruang Kelas untuk guru dan staf pengajar."
  },
  {
    key: "feature.prayer.attendance",
    value: "true",
    type: "boolean",
    description: "Presensi Sholat Berjamaah (Dhuhur/Jumat/Dhuha) via scan barcode statis di masjid sekolah."
  },
  {
    key: "feature.library.ebook",
    value: "true",
    type: "boolean",
    description: "Katalog Perpustakaan & E-Book Digital Siswa."
  },
  {
    key: "feature.library.borrowing",
    value: "true",
    type: "boolean",
    description: "Sirkulasi Peminjaman dan Pengembalian Buku Paket Fisik Perpustakaan."
  },
  {
    key: "feature.bk.consultation",
    value: "true",
    type: "boolean",
    description: "Layanan Konsultasi BK Online & Surat Panggilan Bimbingan Konseling."
  },
  {
    key: "feature.parent.portal",
    value: "true",
    type: "boolean",
    description: "Portal Orang Tua / Wali Murid untuk pantauan presensi, nilai, dan rekam medis UKS."
  },
  {
    key: "feature.gatepass.enabled",
    value: "true",
    type: "boolean",
    description: "Digital Gatepass & Izin Keluar Sekolah Terpadu BK dan Petugas Keamanan."
  },
  {
    key: "feature.uks.enabled",
    value: "true",
    type: "boolean",
    description: "Sistem Layanan Medis UKS Digital & Rekap Riwayat Kesehatan Siswa."
  },
  {
    key: "feature.piket.enabled",
    value: "true",
    type: "boolean",
    description: "Jadwal Guru Piket & Penanganan Otomatis Kelas Kosong (Guru Inval)."
  },
  {
    key: "feature.broadcast.enabled",
    value: "true",
    type: "boolean",
    description: "Siaran Pengumuman & Surat Edaran Resmi Sekolah Realtime ke HP Orang Tua dan Siswa."
  },

  // 3. PENGATURAN GPS SEKOLAH & TOLERANSI
  {
    key: "gps.school.lat",
    value: "-8.125157",
    type: "string",
    description: "Titik Latitude Pusat Kampus SMPN 1 Boyolangu (-8.125157)."
  },
  {
    key: "gps.school.lng",
    value: "111.893912",
    type: "string",
    description: "Titik Longitude Pusat Kampus SMPN 1 Boyolangu (111.893912)."
  },
  {
    key: "gps.radius.global",
    value: "150",
    type: "string",
    description: "Radius toleransi geofence kampus sekolah dalam satuan meter (Default: 150m, dapat disesuaikan 50m - 500m)."
  },
  {
    key: "gps.accuracy.zone_good",
    value: "50",
    type: "string",
    description: "Batas akurasi GPS satelit presisi baik (≤ 50 meter: presensi langsung diterima sah)."
  },
  {
    key: "gps.accuracy.zone_degraded",
    value: "100",
    type: "string",
    description: "Batas akurasi GPS terdegradasi (51 - 100 meter: presensi diterima dengan catatan peringatan / log anomali HP)."
  },
  {
    key: "gps.countdown_seconds",
    value: "60",
    type: "string",
    description: "Waktu tunggu maksimal penguncian satelit GPS sebelum tombol 'Scan QR Kelas' dimunculkan sebagai alternatif fallback."
  },
  {
    key: "attendance.clock_drift_limit_minutes",
    value: "5",
    type: "string",
    description: "Batas selisih jam HP siswa dengan Jam Server WIB (Default 5 menit). Melebihi ini dicatat sebagai indikasi manipulasi jam."
  },

  // 4. GPS ENHANCEMENT & GEOFENCE MASTER TOGGLE
  {
    key: "feature.geofence.enabled",
    value: "true",
    type: "boolean",
    description: "🔘 MASTER TOGGLE GEOFENCE: Mengaktifkan atau menonaktifkan seluruh validasi Geofence GPS presensi secara terpusat dari portal. Jika NONAKTIF, siswa/guru dapat presensi tanpa diblokir validasi radius lokasi."
  },
  {
    key: "feature.gps.kalmanFilter",
    value: "true",
    type: "boolean",
    description: "Aktifkan Kalman Filter 4D di APK untuk smoothing koordinat GPS dan mereduksi indoor signal drift."
  },
  {
    key: "feature.gps.averaging",
    value: "true",
    type: "boolean",
    description: "Aktifkan Coordinate Averaging di APK: mengambil 3-5 sampel GPS berkala lalu merata-ratakan posisinya."
  },
  {
    key: "gps.averaging.sampleCount",
    value: "5",
    type: "string",
    description: "Jumlah sampel GPS yang diambil untuk averaging sebelum dikirim ke portal (3 - 10 sampel)."
  },
  {
    key: "gps.averaging.intervalMs",
    value: "600",
    type: "string",
    description: "Interval jeda antar sampel koordinat GPS dalam milidetik (default: 600ms)."
  },
  {
    key: "gps.minAccuracyMeters",
    value: "50",
    type: "string",
    description: "Batas akurasi GPS ideal yang diterima secara instan (meter). Di atas ini akan diperingatkan."
  },
  {
    key: "gps.rejectAboveAccuracy",
    value: "100",
    type: "string",
    description: "Batas penolakan otomatis presensi jika akurasi GPS terlalu buruk (meter)."
  },
  {
    key: "gps.buffer.default",
    value: "30",
    type: "string",
    description: "Buffer toleransi standar di luar radius base untuk kompensasi pantulan sinyal gedung beton (meter)."
  },
  {
    key: "feature.gps.requireHighAccuracy",
    value: "true",
    type: "boolean",
    description: "Wajibkan mode GPS High Accuracy (GPS Satelit Hardware) pada aplikasi mobile."
  },
  {
    key: "feature.gps.showAccuracyToUser",
    value: "true",
    type: "boolean",
    description: "Tampilkan indikator akurasi GPS real-time (meter) pada antarmuka layar presensi siswa/guru."
  },
  {
    key: "feature.geofence.multiZone",
    value: "true",
    type: "boolean",
    description: "Aktifkan validasi Multi-Zona Geofence (Gerbang Utama, Lapangan, Aula, Masjid, Ruang Kelas)."
  }
];

export async function seedFeatureFlags() {
  console.log("🌱 Menjalankan Seeding Pengaturan Fitur & Geofence SystemSetting...");
  for (const item of DEFAULT_FEATURE_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: item.key },
      update: {
        type: item.type
      },
      create: {
        key: item.key,
        value: item.value,
        type: item.type
      }
    });
  }
  console.log("✅ Berhasil menginisialisasi seluruh konfigurasi fitur ke dalam database!");
}

if (require.main === module) {
  seedFeatureFlags()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Gagal seed feature flags:", err);
      process.exit(1);
    });
}
