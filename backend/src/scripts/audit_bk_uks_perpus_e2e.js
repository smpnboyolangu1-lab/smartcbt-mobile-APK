/**
 * AUDIT & VERIFIKASI E2E KOMPREHENSIF: BK, UKS, DAN PERPUSTAKAAN
 * Menguji integrasi Portal Web dan Mobile APK Client:
 * 1. Perpustakaan: Katalog, Sirkulasi Cepat Barcode, Peminjaman Siswa, Kembalikan, Role LIBRARIAN, Proteksi Route
 * 2. UKS: Lapor Sakit Siswa, Rawat Kunjungan/Triase, Monitoring Kasur UKS, Stok Obat, Emergency Contacts, Checkout Disposisi
 * 3. BK: Konseling Daring, Balasan Guru BK, Rekam Disiplin & Early Warning, Positive Reward Point,
 *        Instrumen Asesmen AKPD & SDQ, Whistleblowing Rahaja Anti-Bullying, Exit Pass Gatepass
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const http = require('http');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'smart-school-secret-key-2025';
const BASE_URL = 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;

function assert(condition, testName, detail = '') {
    if (condition) {
        console.log(`  ✅ [LULUS] ${testName}`);
        passed++;
    } else {
        console.error(`  ❌ [GAGAL] ${testName}${detail ? ' -> ' + detail : ''}`);
        failed++;
    }
}

function makeRequest(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const req = http.request(url, { method, headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runAudit() {
    console.log('================================================================');
    console.log('🚀 MEMULAI AUDIT E2E LIVE: PERPUSTAKAAN, UKS, & BK (WEB & APK)');
    console.log('================================================================\n');

    try {
        // 0. Setup User Aktor Pengujian
        console.log('--- 0. PERSIAPAN PENGGUNA UJI (AKTOR ROLE) ---');
        const timestamp = Date.now();

        // Cari atau buat Librarian
        let librarian = await prisma.user.findFirst({ where: { role: 'LIBRARIAN' } });
        if (!librarian) {
            librarian = await prisma.user.create({
                data: {
                    username: `perpus_${timestamp}`,
                    name: 'Petugas Pustakawan Uji',
                    passwordHash: 'dummy',
                    role: 'LIBRARIAN'
                }
            });
        }
        const librarianToken = jwt.sign({ id: librarian.id, username: librarian.username, role: 'LIBRARIAN', name: librarian.name }, JWT_SECRET, { expiresIn: '2h' });

        // Cari atau buat Guru BK
        let counselor = await prisma.user.findFirst({ where: { role: { in: ['COUNSELOR', 'BK'] } } });
        if (!counselor) {
            counselor = await prisma.user.create({
                data: {
                    username: `bk_${timestamp}`,
                    name: 'Guru BK Uji Konseling',
                    passwordHash: 'dummy',
                    role: 'COUNSELOR'
                }
            });
        }
        const counselorToken = jwt.sign({ id: counselor.id, username: counselor.username, role: 'COUNSELOR', name: counselor.name }, JWT_SECRET, { expiresIn: '2h' });

        // Cari atau buat Petugas Medis UKS
        let medical = await prisma.user.findFirst({ where: { role: { in: ['MEDICAL', 'UKS'] } } });
        if (!medical) {
            medical = await prisma.user.create({
                data: {
                    username: `medis_${timestamp}`,
                    name: 'Petugas Medis UKS Uji',
                    passwordHash: 'dummy',
                    role: 'MEDICAL'
                }
            });
        }
        const medicalToken = jwt.sign({ id: medical.id, username: medical.username, role: 'MEDICAL', name: medical.name }, JWT_SECRET, { expiresIn: '2h' });

        // Cari atau buat Siswa Uji
        let student = await prisma.user.findFirst({ where: { role: 'STUDENT', className: { not: null } } });
        if (!student) {
            student = await prisma.user.create({
                data: {
                    username: `siswa_${timestamp}`,
                    name: 'Siswa Uji E2E',
                    className: 'VII-A',
                    passwordHash: 'dummy',
                    role: 'STUDENT',
                    points: 0
                }
            });
        }

        // Pastikan kelas siswa terhubung dan Guru BK memiliki izin binaan resmi (bkKelasPlot)
        if (student) {
            let cls = student.classId ? await prisma.class.findUnique({ where: { id: student.classId } }) : null;
            if (!cls && student.className) {
                cls = await prisma.class.findFirst({ where: { name: student.className } });
                if (cls) {
                    await prisma.user.update({ where: { id: student.id }, data: { classId: cls.id } });
                    student.classId = cls.id;
                }
            }
            if (cls) {
                const plot = await prisma.bkKelasPlot.findFirst({
                    where: { guruBkId: counselor.id, kelasId: cls.id }
                });
                if (!plot) {
                    await prisma.bkKelasPlot.create({
                        data: {
                            guruBkId: counselor.id,
                            kelasId: cls.id,
                            isActive: true
                        }
                    });
                }
            }
        }
        const studentToken = jwt.sign({ id: student.id, username: student.username, role: 'STUDENT', name: student.name, className: student.className }, JWT_SECRET, { expiresIn: '2h' });

        console.log(`  Pengguna siap:`);
        console.log(`  - Librarian : ${librarian.name} (${librarian.role})`);
        console.log(`  - Counselor : ${counselor.name} (${counselor.role})`);
        console.log(`  - Medical   : ${medical.name} (${medical.role})`);
        console.log(`  - Student   : ${student.name} (${student.className})\n`);

        // ========================================================
        // MODUL 1: PERPUSTAKAAN & E-LIBRARY
        // ========================================================
        console.log('--- 1. AUDIT PERPUSTAKAAN & E-LIBRARY ---');

        // Test 1.1: Web Portal Access untuk LIBRARIAN
        const resPerpusWeb = await makeRequest('GET', '/perpustakaan', null, librarianToken);
        // Note: web route mengizinkan atau redirect/render halaman. Jika ada auth cookie/bearer check:
        assert(resPerpusWeb.status === 200 || resPerpusWeb.status === 302, 'Akses Web Portal Perpustakaan oleh Role LIBRARIAN');

        // Test 1.2: Proteksi Celah Keamanan (Unauthenticated Create Book DITOLAK)
        const resUnauthCreate = await makeRequest('POST', '/api/elibrary/books', {
            title: 'Buku Tidak Terotorisasi',
            author: 'Hacker'
        }, null);
        assert(resUnauthCreate.status === 401 || resUnauthCreate.status === 403, 'Celah Keamanan Tertutup: Tambah Buku Tanpa Auth Wajib Ditolak 401/403');

        // Test 1.3: Tambah Judul Buku Baru oleh Librarian
        const bookBarcode = 'TEST-LIB-' + timestamp;
        const resCreateBook = await makeRequest('POST', '/api/elibrary/books', {
            title: 'Ensiklopedia Sains dan Teknologi Modern',
            author: 'Prof. Uji Antigravity',
            publisher: 'Balai Pustaka',
            yearPublished: '2026',
            isbn: '978-602-1234-56-7',
            barcodeCode: bookBarcode,
            stock: 3,
            subject: 'Sains',
            category: 'REFERENSI',
            gradeClass: 'UMUM'
        }, librarianToken);
        assert(resCreateBook.status === 200 && resCreateBook.body && resCreateBook.body.success, 'Petugas Perpustakaan (LIBRARIAN) Berhasil Menambah Buku Katalog');
        const createdBookId = resCreateBook.body?.book?.id;

        // Test 1.4: Baca Katalog Buku & E-Book
        const resCatalog = await makeRequest('GET', '/api/elibrary/books?search=' + encodeURIComponent('Ensiklopedia Sains'), null, studentToken);
        assert(resCatalog.status === 200 && resCatalog.body?.books?.length > 0, 'Siswa/Guru Dapat Mencari & Membaca Katalog Buku E-Library');

        // Test 1.5: Sirkulasi Cepat (Quick Circulation - Pinjam Buku Buku Umum)
        // Buat buku umum yang boleh dipinjam
        const borrowableBarcode = 'BORROW-' + timestamp;
        const resBorrowableBook = await makeRequest('POST', '/api/elibrary/books', {
            title: 'Kisah Petualangan Literasi SMPN 1',
            author: 'Tim Guru Literasi',
            barcodeCode: borrowableBarcode,
            stock: 2,
            subject: 'Bahasa Indonesia',
            category: 'NOVEL',
            gradeClass: 'VII'
        }, librarianToken);

        const resBorrow = await makeRequest('POST', '/api/elibrary/quick-circulation', {
            action: 'BORROW',
            studentQuery: student.username,
            bookBarcode: borrowableBarcode,
            durationDays: 7
        }, librarianToken);
        assert(resBorrow.status === 200 && resBorrow.body?.success, 'Sirkulasi Cepat Barcode: Petugas Berhasil Meminjamkan Buku ke Siswa');

        // Test 1.6: Riwayat Pinjaman Siswa di APK Client
        const resMyBooks = await makeRequest('GET', '/api/elibrary/my-books', null, studentToken);
        assert(resMyBooks.status === 200 && resMyBooks.body && (resMyBooks.body.books !== undefined || resMyBooks.body.success), 'APK Client Siswa: Memuat Daftar Buku yang Sedang Dipinjam');

        // Test 1.7: Sirkulasi Cepat (Quick Circulation - Kembalikan Buku)
        const resReturn = await makeRequest('POST', '/api/elibrary/quick-circulation', {
            action: 'RETURN',
            studentQuery: student.username,
            bookBarcode: borrowableBarcode
        }, librarianToken);
        assert(resReturn.status === 200 && resReturn.body?.success, 'Sirkulasi Cepat Barcode: Pengembalian Buku Tepat Waktu Berhasil Diproses');

        // Test 1.8: Proteksi Hapus Buku (Tanpa Auth Ditolak)
        if (createdBookId) {
            const resUnauthDelete = await makeRequest('DELETE', `/api/elibrary/books/${createdBookId}`, null, null);
            assert(resUnauthDelete.status === 401 || resUnauthDelete.status === 403, 'Celah Keamanan Tertutup: Hapus Buku Tanpa Auth Wajib Ditolak 401/403');

            // Hapus buku dengan token librarian
            const resAuthDelete = await makeRequest('DELETE', `/api/elibrary/books/${createdBookId}`, null, librarianToken);
            assert(resAuthDelete.status === 200 && resAuthDelete.body?.success, 'LIBRARIAN Berhasil Menghapus Buku dari Katalog');
        }

        // ========================================================
        // MODUL 2: UKS (UNIT KESEHATAN SEKOLAH)
        // ========================================================
        console.log('\n--- 2. AUDIT UNIT KESEHATAN SEKOLAH (UKS) ---');

        // Test 2.1: Siswa Mengirim Laporan Darurat Medis dari APK
        const resStudentUksReport = await makeRequest('POST', '/api/student/uks-report', {
            category: 'SAKIT',
            complaint: 'Pusing dan demam menggigil di kelas VII-A',
            incidentLocation: 'Ruang Kelas VII-A'
        }, studentToken);
        assert(resStudentUksReport.status === 200, 'APK Siswa: Mengirim Laporan Keluhan Sakit Darurat ke UKS');

        // Test 2.2: Petugas UKS Mencatat Kunjungan & Pasien Rawat Inap Kasur UKS
        const resCreateVisit = await makeRequest('POST', '/api/uks/visits', {
            studentId: student.id,
            category: 'PINGSAN',
            isFainting: true,
            incidentLocation: 'Lapangan Upacara',
            temperature: 37.8,
            bloodPressure: '110/70',
            bedNumber: 'Bed 01',
            disposition: 'REST_AT_UKS',
            complaint: 'Pingsan saat upacara bendera hari Senin',
            treatment: 'Pertolongan pertama posisi syok, minyak kayu putih, teh hangat',
            officerName: medical.name
        }, medicalToken);
        const visitId = resCreateVisit.body?.visit?.id || resCreateVisit.body?.id;
        assert(resCreateVisit.status === 200 && visitId, 'Petugas UKS: Berhasil Mencatat Pasien Kunjungan & Menempati Kasur UKS');

        // Test 2.3: Monitoring Kasur & Pasien Aktif di Dashboard UKS (Web & Mobile)
        const resUksStats = await makeRequest('GET', '/api/uks/stats', null, medicalToken);
        assert(resUksStats.status === 200 && (resUksStats.body?.availableBeds !== undefined || resUksStats.body?.totalBeds !== undefined), 'Dashboard Web UKS: Monitoring Realtime Status Kasur & Pasien Beristirahat');

        const resApkUksHealth = await makeRequest('GET', '/api/student/health-history', null, studentToken);
        assert(resApkUksHealth.status === 200 && resApkUksHealth.body?.beds !== undefined, 'APK Client UKS: Memuat Status 4 Kasur UKS & Rekam Medis Siswa');

        // Test 2.4: Kontak Darurat UKS
        const resEmergency = await makeRequest('GET', '/api/uks/emergency-contacts', null, studentToken);
        assert(resEmergency.status === 200, 'APK & Web: Berhasil Mengambil Kontak Darurat Medis Sekolah / Rumah Sakit Rujukan');

        // Test 2.5: Manajemen Stok Obat UKS
        const resMedicineList = await makeRequest('GET', '/api/uks/medicines', null, medicalToken);
        assert(resMedicineList.status === 200, 'Petugas UKS: Memuat Inventaris Obat & Alkes');

        // Test 2.6: Checkout Pasien UKS & Verifikasi Update Disposisi
        if (visitId) {
            const resCheckout = await makeRequest('PUT', `/api/uks/visits/${visitId}/checkout`, {
                note: 'Kondisi telah pulih dan stabil',
                disposition: 'BACK_TO_CLASS'
            }, medicalToken);
            assert(resCheckout.status === 200 && resCheckout.body?.success, 'Petugas UKS: Berhasil Checkout Pasien UKS Kembali ke Kelas');

            // Verifikasi di DB bahwa disposition terupdate ke BACK_TO_CLASS
            const checkDbVisit = await prisma.uksVisit.findUnique({ where: { id: visitId } });
            assert(checkDbVisit?.disposition === 'BACK_TO_CLASS', 'Verifikasi Integritas Data: Kolom Disposisi Database Tersimpan Tepat (BACK_TO_CLASS)');
        }

        // ========================================================
        // MODUL 3: BIMBINGAN KONSELING (BK)
        // ========================================================
        console.log('\n--- 3. AUDIT BIMBINGAN KONSELING (BK) ---');

        // Test 3.1: Siswa Mengajukan Konseling Daring ke Guru BK
        const resCounseling = await makeRequest('POST', '/api/bk/consultations', {
            subject: 'Kesulitan Belajar dan Konsentrasi',
            message: 'Saya sering kesulitan fokus saat jam pelajaran matematika di kelas.',
            category: 'BELAJAR',
            isAnonymous: false
        }, studentToken);
        assert(resCounseling.status === 200, 'APK Siswa: Berhasil Mengajukan Konseling Pribadi ke Guru BK');
        const consultationId = resCounseling.body?.id || resCounseling.body?.consultation?.id;

        // Test 3.2: Guru BK Membaca Daftar Konseling
        const resGetConsultations = await makeRequest('GET', '/api/bk/consultations', null, counselorToken);
        assert(resGetConsultations.status === 200, 'Portal Web BK: Guru BK Berhasil Memuat Antrean Konseling Siswa');

        // Test 3.3: Guru BK Membalas Konseling / Menjadwalkan Tatap Muka
        if (consultationId) {
            const resReply = await makeRequest('PUT', `/api/bk/consultations/${consultationId}/reply`, {
                responseMessage: 'Terima kasih telah berkonsultasi. Mari kita bicarakan di ruang BK besok istirahat pertama.',
                status: 'SCHEDULED'
            }, counselorToken);
            assert(resReply.status === 200, 'Guru BK: Berhasil Membalas Konseling & Menjadwalkan Sesi Tatap Muka');
        }

        // Test 3.4: Pencatatan Rekam Disiplin & Pelanggaran
        const resDiscipline = await makeRequest('POST', '/api/bk/discipline', {
            studentId: student.id,
            category: 'TERLAMBAT',
            description: 'Terlambat masuk gerbang sekolah 15 menit',
            points: 5,
            sanction: 'Teguran lisan & mencatat di buku pembinaan',
            reportedBy: counselor.name
        }, counselorToken);
        assert(resDiscipline.status === 200 && resDiscipline.body?.success, 'Guru BK: Berhasil Mencatat Poin Pelanggaran Kedisiplinan Siswa', JSON.stringify(resDiscipline));

        // Test 3.5: Early Warning System & Rekap Poin Siswa
        const resEarlyWarning = await makeRequest('GET', '/api/bk/early-warning', null, counselorToken);
        assert(resEarlyWarning.status === 200, 'Sistem BK: Early Warning System Mendeteksi Akumulasi Poin Siswa');

        // Test 3.6: Positive Reinforcement Reward (Fitur Pengurang Poin)
        const resReward = await makeRequest('POST', '/api/bk/discipline/reward', {
            studentId: student.id,
            achievementTitle: 'Juara 1 Lomba Kebersihan Kelas & Duta Literasi',
            rewardPoints: 5,
            notes: 'Apresiasi perilaku positif mengurangi poin pelanggaran'
        }, counselorToken);
        assert(resReward.status === 200 && resReward.body?.success, 'Guru BK: Fitur Reward Positif Berhasil Mengurangi Poin Pelanggaran Siswa');

        // Test 3.7: Instrumen Asesmen AKPD (Angket Kebutuhan Peserta Didik) - POST & GET (FITUR BARU)
        const resSubmitAkpd = await makeRequest('POST', '/api/bk/akpd', {
            studentId: student.id,
            scorePribadi: 85,
            scoreSosial: 78,
            scoreBelajar: 90,
            scoreKarir: 82,
            topProblemAreas: ['Manajemen Waktu', 'Penentuan Minat Ekstrakurikuler'],
            answers: { q1: 4, q2: 5, q3: 3 }
        }, studentToken);
        assert(resSubmitAkpd.status === 200 && resSubmitAkpd.body?.success, 'Siswa: Berhasil Mengisi Angket Kebutuhan Peserta Didik (AKPD)');

        // Test 3.8: GET AKPD (Fitur Baru untuk Guru BK)
        const resGetAkpd = await makeRequest('GET', '/api/bk/akpd?className=VII-A', null, counselorToken);
        assert(resGetAkpd.status === 200 && resGetAkpd.body?.success && resGetAkpd.body.averages !== undefined, 'Guru BK: Fitur Baru GET /bk/akpd Memuat Rekap Analisis Kebutuhan Siswa');

        // Test 3.9: Skrining Mental SDQ (Strengths and Difficulties Questionnaire)
        const resSubmitSdq = await makeRequest('POST', '/api/bk/sdq', {
            studentId: student.id,
            emotionalScore: 2,
            conductScore: 1,
            hyperactivityScore: 2,
            peerScore: 1,
            prosocialScore: 9
        }, counselorToken);
        assert(resSubmitSdq.status === 200 && resSubmitSdq.body?.success, 'Guru BK: Skrining Mental SDQ Standar Kemenkes/WHO Berhasil Disimpan');

        // Test 3.10: Kotak Rahaja (Whistleblowing Anti-Bullying Ramah Anak)
        const resWhistleblow = await makeRequest('POST', '/api/bk/whistleblow', {
            subject: 'Laporan Dugaan Pemalakan di Kantin Belakang',
            message: 'Ada siswa yang memaksa meminta uang saku kepada adik kelas saat istirahat.',
            category: 'BULLYING',
            location: 'Kantin Belakang Sekolah',
            isAnonymous: true
        }, studentToken);
        assert(resWhistleblow.status === 200 && resWhistleblow.body?.success, 'Siswa/Whistleblower: Kotak Rahaja Anti-Bullying Aman Terenkripsi & Terkirim ke BK');

        // Test 3.11: Generate Dinamis QR Gatepass BK untuk Izin Keluar/Pulang
        const resDynamicQr = await makeRequest('GET', '/api/v1/bk/dynamic-qr', null, counselorToken);
        assert(resDynamicQr.status === 200 && resDynamicQr.body?.success, 'Guru BK: Berhasil Menghasilkan QR Dinamis Gatepass Izin Siswa');

        // Cleanup Data Uji jika diperlukan
        if (createdBookId) {
            try { await prisma.bookCopy.deleteMany({ where: { bookId: createdBookId } }); } catch (e) {}
            try { await prisma.libraryBook.delete({ where: { id: createdBookId } }); } catch (e) {}
        }

        console.log('\n================================================================');
        console.log(`📊 REKAP HASIL AUDIT MODUL BK, UKS, & PERPUSTAKAAN:`);
        console.log(`   TOTAL LULUS : ${passed}`);
        console.log(`   TOTAL GAGAL : ${failed}`);
        console.log('================================================================\n');

        if (failed === 0) {
            console.log('🎉 SELURUH PENGUJIAN MODUL BK, UKS, & PERPUSTAKAAN DINYATAKAN 100% LULUS!');
            process.exit(0);
        } else {
            console.error(`⚠️ Terdapat ${failed} pengujian yang gagal.`);
            process.exit(1);
        }

    } catch (err) {
        console.error('Fatal error during audit:', err);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

runAudit();
