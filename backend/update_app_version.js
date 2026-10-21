const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const config = await prisma.appVersionConfig.upsert({
        where: { id: 'latest' },
        update: {
            versionCode: 180,
            versionName: '2.9.10',
            downloadUrl: '/uploads/smartcbt-latest.apk',
            fileSizeMb: 19.0,
            isForceUpdate: false,
            releaseNotes: '⚡ PEMBARUAN SISTEM RESMI: Smart CBT v2.9.10 (Build 180)\n' +
                '1. Modul Deteksi Dini & Skrining SDQ Kemendikbud: Standar baku 5 skala evaluasi emosi dan perilaku siswa usia 11–17 tahun (Normal, Borderline, Abnormal).\n' +
                '2. Sosiometri Digital & Anti-Bullying: Pemetaan relasi pertemanan/geng, deteksi siswa terisolasi, dan Kotak Rahaja (Whistleblowing anonim + unggah tangkapan layar bukti digital).\n' +
                '3. Generator E-RPL Resmi & Laporan A4: Penyusunan otomatis RPL Kurikulum Merdeka dan Laporan Bulanan/Semesteran siap cetak PDF A4 resmi dengan TTD Kepala Sekolah & Guru BK.\n' +
                '4. Skor SAW & Disiplin Positif: Poin Reward untuk prestasi/perilaku terpuji pengurang poin pelanggaran, serta Kontrak Perilaku siswa sebelum penerbitan SP.\n' +
                '5. Keamanan Data & Etika Konseling: Asas kerahasiaan konseling terenkripsi, Informed Consent Digital, dan Audit Log pelacakan akses catatan sensitif.\n' +
                '6. Berkas KK & Akta per Folder Siswa: Akses dokumen KK dan Akta terstruktur per folder siswa untuk Wali Kelas tanpa meminta ulang berkas.\n' +
                '7. Dashboard Konseling BK Modern: Kartu konseling eksekutif ringkas, filter status cepat, dan pemulihan data presensi kelas ampuan.'
        },
        create: {
            id: 'latest',
            versionCode: 180,
            versionName: '2.9.10',
            downloadUrl: '/uploads/smartcbt-latest.apk',
            fileSizeMb: 19.0,
            isForceUpdate: false,
            releaseNotes: '⚡ PEMBARUAN SISTEM RESMI: Smart CBT v2.9.10 (Build 180)'
        }
    });
    console.log('✅ appVersionConfig updated:', config);
}

main().finally(() => prisma.$disconnect());
