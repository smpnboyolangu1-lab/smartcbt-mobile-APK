const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const config = await prisma.appVersionConfig.upsert({
        where: { id: 'latest' },
        update: {
            versionCode: 129,
            versionName: '2.8.119',
            downloadUrl: '/uploads/smartcbt-latest.apk',
            fileSizeMb: 17.50,
            isForceUpdate: false,
            releaseNotes: 'Pembaruan Resmi Smart CBT v2.8.119 (Build 129):\n' +
                '1. Tampilan CBT Siswa Standar Ujian Nasional / ANBK Pusmendik: Header Navy #0A2540, tombol zoom font [A-] [A] [A+], status badge terjawab/ragu/belum, dan tombol Pembahasan Soal langkah demi langkah pasca ujian.\n' +
                '2. AI Prompt Soal Terkunci Mutlak Jenjang SMP (Fase D Kurikulum Merdeka): Menolak materi di luar SMP, 4 opsi A-D, dan pembahasan lengkap per butir soal.\n' +
                '3. E-Kantin Sehat Digital Siswa & Orang Tua: Saldo uang saku digital, barcode bayar stan kantin, menu sehat, kontrol batas jajan harian, top up, dan grafik pengeluaran 6 hari (Senin s/d Sabtu).\n' +
                '4. Verifikasi Ganda Sholat Putri (2 Centang Kejujuran): Lapor uzur syar\'i/haid wajib verifikasi 2 centang sebelum submit.\n' +
                '5. Guru PAI Scan Kartu Pelajar Siswa Tanpa HP: Langsung catat sholat mushola dan gate in/out sekolah terintegrasi.\n' +
                '6. Pusat Guru Piket & Lapor Jam Kosong: Integrasi teruskan/disposisi ke Tim Kurikulum, info tim piket hari ini, dan rekap guru izin.\n' +
                '7. Rekap Presensi Wali Kelas: Penggantian kode "?" menjadi "[TP] Tanpa Pulang" dan integrasi keterangan sakit via BK.\n' +
                '8. Sederhanakan Pos Satpam: Fokus pemindaian barcode tiket dispensasi pulang/izin keluar siswa.\n' +
                '9. Atur Jadwal Sholat Fullscreen Ber-Header Islami Emerald & Redesain Dialog Tutup Sesi KBM.'
        },
        create: {
            id: 'latest',
            versionCode: 129,
            versionName: '2.8.119',
            downloadUrl: '/uploads/smartcbt-latest.apk',
            fileSizeMb: 17.50,
            isForceUpdate: false,
            releaseNotes: 'Pembaruan Resmi Smart CBT v2.8.119 (Build 129)'
        }
    });
    console.log('✅ appVersionConfig updated:', config);
}

main().finally(() => prisma.$disconnect());
