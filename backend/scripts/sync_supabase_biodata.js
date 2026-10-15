const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@supabase/supabase-js');

const prisma = new PrismaClient();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lgcbhzyfnbspdxrcxyon.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY2JoenlmbmJzcGR4cmN4eW9uIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTY5ODM3NiwiZXhwIjoyMDk3Mjc0Mzc2fQ.IH5ZX2w7WalHuriHjoFoOURXy7HpzM0A1dO_pfyHvu0';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function cleanStr(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

function calculateCompleteness(b, ayah, ibu, dokumenCount) {
  let totalScore = 0;
  let maxScore = 14;

  if (b.namaPanggilan) totalScore++;
  if (b.alamatLengkap) totalScore++;
  if (b.latitude && b.longitude) totalScore += 2; else if (b.alamatLengkap) totalScore += 1;
  if (b.jenisTinggal) totalScore++;
  if (b.noHpSiswa) totalScore++;
  if (b.tinggiBadan && b.beratBadan) totalScore++;
  if (b.golonganDarah && b.golonganDarah !== 'Tidak Tahu') totalScore++;
  if (b.hobi || b.citaCita) totalScore++;

  if (ayah && ayah.nama) totalScore++;
  if (ayah && ayah.pekerjaan) totalScore++;

  if (ibu && ibu.nama) totalScore++;
  if (ibu && ibu.pekerjaan) totalScore++;

  if (dokumenCount >= 2) totalScore += 2;
  else if (dokumenCount === 1) totalScore += 1;

  const pct = Math.round((totalScore / maxScore) * 100);
  return Math.min(100, Math.max(10, pct));
}

async function syncAllBiodata() {
  console.log('--- Memulai Sinkronisasi Biodata Lengkap dari Supabase ke Database Lokal ---');

  const { data: supaStudents, error } = await supabase.from('siswa').select('*');
  if (error) {
    console.error('Gagal mengambil data dari Supabase:', error);
    await prisma.$disconnect();
    return;
  }

  console.log(`Ditemukan ${supaStudents.length} siswa di Supabase.`);

  let successCount = 0;
  let skippedCount = 0;

  for (const s of supaStudents) {
    try {
      const nisnClean = cleanStr(s.nisn);
      const nisClean = cleanStr(s.nis);
      const namaClean = cleanStr(s.nama);

      // Cari user lokal siswa
      let user = null;
      if (nisnClean) {
        user = await prisma.user.findFirst({
          where: {
            role: 'STUDENT',
            OR: [{ nisn: nisnClean }, { username: nisnClean }]
          }
        });
      }
      if (!user && nisClean) {
        user = await prisma.user.findFirst({
          where: {
            role: 'STUDENT',
            OR: [{ nis: nisClean }, { username: nisClean }]
          }
        });
      }
      if (!user && namaClean) {
        user = await prisma.user.findFirst({
          where: {
            role: 'STUDENT',
            name: { contains: namaClean }
          }
        });
      }

      if (!user) {
        skippedCount++;
        continue;
      }

      // Parse validasi_notes (berisi koordinat, kebutuhan khusus, riwayat, transportasi, dll)
      let notes = {};
      if (s.validasi_notes) {
        try {
          notes = typeof s.validasi_notes === 'object' ? s.validasi_notes : JSON.parse(s.validasi_notes);
        } catch (e) {
          notes = {};
        }
      }

      let lat = null;
      let lng = null;
      if (notes.koordinat && typeof notes.koordinat === 'string') {
        const parts = notes.koordinat.split(',');
        if (parts.length >= 2) {
          const pLat = parseFloat(parts[0].trim());
          const pLng = parseFloat(parts[1].trim());
          if (!isNaN(pLat) && !isNaN(pLng)) {
            lat = pLat;
            lng = pLng;
          }
        }
      }

      let waktuTempuh = null;
      if (notes.waktu_tempuh) {
        const parsed = parseInt(String(notes.waktu_tempuh).replace(/\D/g, ''), 10);
        if (!isNaN(parsed)) waktuTempuh = parsed;
      }

      // Update data dasar siswa di tabel User jika belum lengkap
      await prisma.user.update({
        where: { id: user.id },
        data: {
          nis: cleanStr(s.nis) || user.nis,
          nisn: cleanStr(s.nisn) || user.nisn,
          nik: cleanStr(s.nik) || user.nik,
          gender: cleanStr(s.jenis_kelamin) || user.gender,
          religion: cleanStr(s.agama) || user.religion,
          pob: cleanStr(s.tempat_lahir) || user.pob,
          dob: cleanStr(s.tanggal_lahir) || user.dob,
          address: cleanStr(s.alamat) || user.address,
          parentPhone: cleanStr(s.no_hp) || user.parentPhone,
          bloodType: cleanStr(s.golongan_darah) || user.bloodType,
          fatherName: cleanStr(s.nama_ayah) || user.fatherName,
          motherName: cleanStr(s.nama_ibu) || user.motherName,
          className: cleanStr(s.kelas) || user.className
        }
      });

      // 1. BIODATA SISWA
      const statusOrtu = (s.status_ayah === 'Meninggal' && s.status_ibu === 'Meninggal')
        ? 'Yatim Piatu'
        : (s.status_ayah === 'Meninggal' ? 'Yatim' : (s.status_ibu === 'Meninggal' ? 'Piatu' : 'Lengkap'));

      const biodataPayload = {
        namaPanggilan: cleanStr(s.nama_panggilan),
        anakKe: typeof s.anak_ke === 'number' ? s.anak_ke : (parseInt(s.anak_ke, 10) || 1),
        jumlahSaudaraKandung: typeof s.jumlah_saudara === 'number' ? s.jumlah_saudara : (parseInt(s.jumlah_saudara, 10) || 0),
        statusOrangTua: statusOrtu,
        bahasaSehariHari: cleanStr(s.bahasa) || 'Bahasa Indonesia',
        alamatLengkap: cleanStr(s.alamat),
        latitude: lat,
        longitude: lng,
        lokasiTerkonfirmasi: !!(lat && lng),
        jarakKm: s.jarak_sekolah ? parseFloat(s.jarak_sekolah) || null : null,
        waktuTempuhMenit: waktuTempuh,
        modaTransportasi: cleanStr(notes.transportasi),
        jenisTinggal: cleanStr(s.tinggal_bersama),
        noHpSiswa: cleanStr(s.no_hp),
        beratBadan: typeof s.berat_badan === 'number' ? s.berat_badan : (parseInt(s.berat_badan, 10) || null),
        tinggiBadan: typeof s.tinggi_badan === 'number' ? s.tinggi_badan : (parseInt(s.tinggi_badan, 10) || null),
        golonganDarah: cleanStr(s.golongan_darah),
        riwayatPenyakit: cleanStr(notes.riwayat_penyakit),
        berkebutuhanKhusus: cleanStr(notes.kebutuhan_khusus) ? JSON.stringify([notes.kebutuhan_khusus]) : null,
        hobi: cleanStr(s.hobi),
        citaCita: cleanStr(s.cita_cita),
        fotoUrl: cleanStr(s.foto_url),
        status: 'PENDING', // Otomatis masuk antrean verifikasi TU
        konfirmasiAkhir: true
      };

      await prisma.biodataSiswa.upsert({
        where: { studentId: user.id },
        create: {
          studentId: user.id,
          ...biodataPayload
        },
        update: biodataPayload
      });

      // 2. BIODATA AYAH
      const ayahPayload = {
        nama: cleanStr(s.nama_ayah) || 'Ayah ' + user.name,
        nik: null,
        pendidikan: cleanStr(s.pendidikan_ayah),
        pekerjaan: cleanStr(s.pekerjaan_ayah),
        statusHidup: cleanStr(s.status_ayah) || 'Masih Hidup',
        noHp: cleanStr(s.no_hp)
      };

      await prisma.biodataAyah.upsert({
        where: { studentId: user.id },
        create: {
          studentId: user.id,
          ...ayahPayload
        },
        update: ayahPayload
      });

      // 3. BIODATA IBU
      const ibuPayload = {
        nama: cleanStr(s.nama_ibu) || 'Ibu ' + user.name,
        nik: null,
        pendidikan: cleanStr(s.pendidikan_ibu),
        pekerjaan: cleanStr(s.pekerjaan_ibu),
        statusHidup: cleanStr(s.status_ibu) || 'Masih Hidup',
        noHp: cleanStr(s.no_hp)
      };

      await prisma.biodataIbu.upsert({
        where: { studentId: user.id },
        create: {
          studentId: user.id,
          ...ibuPayload
        },
        update: ibuPayload
      });

      // 4. BIODATA WALI (jika ada)
      const waliNama = cleanStr(s.wali_nama) || cleanStr(s.nama_wali);
      if (waliNama) {
        const waliPayload = {
          nama: waliNama,
          hubungan: cleanStr(s.wali_hubungan) || 'Wali',
          alamat: cleanStr(s.alamat_wali),
          noHp: cleanStr(s.no_hp)
        };
        await prisma.biodataWali.upsert({
          where: { studentId: user.id },
          create: {
            studentId: user.id,
            ...waliPayload
          },
          update: waliPayload
        });
      }

      // 5. BIODATA AFIRMASI (KIP / Bantuan jika ada)
      const punyaAfirmasi = !!(s.is_prasejahtera || cleanStr(s.no_kip) || cleanStr(s.kip_url) || cleanStr(s.jenis_bantuan));
      const afirmasiPayload = {
        punyaAfirmasi,
        jenisKartu: cleanStr(s.jenis_bantuan) ? JSON.stringify([s.jenis_bantuan]) : (cleanStr(s.no_kip) ? JSON.stringify(['KIP']) : null),
        kartuUrl: cleanStr(s.kip_url)
      };
      await prisma.biodataAfirmasi.upsert({
        where: { studentId: user.id },
        create: {
          studentId: user.id,
          ...afirmasiPayload
        },
        update: afirmasiPayload
      });

      // 6. DOKUMEN SISWA (KK, AKTA, FOTO, IJAZAH, KIP)
      let docCount = 0;
      if (cleanStr(s.kk_url)) {
        await prisma.dokumenSiswa.deleteMany({ where: { studentId: user.id, jenis: 'KK' } });
        await prisma.dokumenSiswa.create({
          data: { studentId: user.id, jenis: 'KK', fileUrl: s.kk_url, uploadedBy: 'SUPABASE_SYNC' }
        });
        docCount++;
      }
      if (cleanStr(s.akta_url)) {
        await prisma.dokumenSiswa.deleteMany({ where: { studentId: user.id, jenis: 'AKTA' } });
        await prisma.dokumenSiswa.create({
          data: { studentId: user.id, jenis: 'AKTA', fileUrl: s.akta_url, uploadedBy: 'SUPABASE_SYNC' }
        });
        docCount++;
      }
      if (cleanStr(s.foto_url)) {
        await prisma.dokumenSiswa.deleteMany({ where: { studentId: user.id, jenis: 'FOTO' } });
        await prisma.dokumenSiswa.create({
          data: { studentId: user.id, jenis: 'FOTO', fileUrl: s.foto_url, uploadedBy: 'SUPABASE_SYNC' }
        });
        docCount++;
      }
      if (cleanStr(s.ijazah_url)) {
        await prisma.dokumenSiswa.deleteMany({ where: { studentId: user.id, jenis: 'IJAZAH' } });
        await prisma.dokumenSiswa.create({
          data: { studentId: user.id, jenis: 'IJAZAH', fileUrl: s.ijazah_url, uploadedBy: 'SUPABASE_SYNC' }
        });
        docCount++;
      }
      if (cleanStr(s.kip_url)) {
        await prisma.dokumenSiswa.deleteMany({ where: { studentId: user.id, jenis: 'KARTU_BANTUAN' } });
        await prisma.dokumenSiswa.create({
          data: { studentId: user.id, jenis: 'KARTU_BANTUAN', fileUrl: s.kip_url, uploadedBy: 'SUPABASE_SYNC' }
        });
        docCount++;
      }

      // Hitung kelengkapan persen
      const kelengkapan = calculateCompleteness(biodataPayload, ayahPayload, ibuPayload, docCount);
      await prisma.biodataSiswa.update({
        where: { studentId: user.id },
        data: { kelengkapanPersen: kelengkapan }
      });

      successCount++;
    } catch (err) {
      console.error(`Error syncing student id ${s.id} (${s.nama}):`, err.message);
    }
  }

  console.log(`\n=== HASIL SINKRONISASI ===`);
  console.log(`Berhasil disinkronkan: ${successCount} siswa`);
  console.log(`Dilewati (tidak ditemukan): ${skippedCount} siswa`);
  console.log(`Semua biodata lengkap sekarang tersimpan di database lokal & antrean verifikasi TU.`);

  await prisma.$disconnect();
}

syncAllBiodata().catch(err => {
  console.error(err);
  prisma.$disconnect();
});
