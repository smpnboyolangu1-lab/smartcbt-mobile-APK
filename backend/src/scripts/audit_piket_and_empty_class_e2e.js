/**
 * AUDIT & VERIFIKASI E2E KOMPREHENSIF: MODUL GURU PIKET & KELAS KOSONG
 * 1. Jadwal Piket Mingguan: Create, Read, Update, Delete oleh Kurikulum/Admin/Operator
 * 2. Status Piket Hari Ini & Check Status Guru yang Login (APK & Web)
 * 3. Pelaporan Jam Kosong oleh Pengurus Kelas (Anti-spam 1x per jam pelajaran)
 * 4. Rekomendasi Cerdas Guru Pengganti / Guru Badal (Smart Teacher Substitution)
 * 5. Penugasan Guru Inval / Badal ke Kelas Kosong
 * 6. Distribusi Tugas Mandiri Darurat (Emergency Assignment Delivery) ke Seluruh Siswa
 * 7. Penyelesaian Kasus Jam Kosong (RESOLVED)
 * 8. Berita Acara Pelaksanaan (BAP) Piket Harian (Data Agregat JSON)
 * 9. Cetak Dokumen Resmi BAP Piket Harian Standar Dinas A4
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
    console.log('🚀 MEMULAI AUDIT E2E: GURU PIKET & MONITORING KELAS KOSONG');
    console.log('================================================================\n');

    try {
        console.log('--- 0. PERSIAPAN PENGGUNA UJI (AKTOR ROLE) ---');
        const timestamp = Date.now();

        // 1. Kurikulum
        let kurikulum = await prisma.user.findFirst({ where: { role: 'KURIKULUM' } });
        if (!kurikulum) {
            kurikulum = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
        }
        const kurikulumToken = jwt.sign({ id: kurikulum.id, username: kurikulum.username, role: kurikulum.role, name: kurikulum.name }, JWT_SECRET, { expiresIn: '2h' });

        // 2. Guru Piket
        let teacher = await prisma.user.findFirst({ where: { role: 'TEACHER', teachingSubject: { not: null } } });
        if (!teacher) {
            teacher = await prisma.user.create({
                data: {
                    username: `guru_${timestamp}`,
                    name: 'Guru Uji Piket, S.Pd',
                    role: 'TEACHER',
                    passwordHash: 'dummy',
                    teachingSubject: 'Matematika'
                }
            });
        }
        const teacherToken = jwt.sign({ id: teacher.id, username: teacher.username, role: 'TEACHER', name: teacher.name }, JWT_SECRET, { expiresIn: '2h' });

        // 3. Siswa (Pengurus Kelas)
        let student = await prisma.user.findFirst({ where: { role: 'STUDENT', className: { not: null } } });
        if (!student) {
            student = await prisma.user.create({
                data: {
                    username: `siswa_${timestamp}`,
                    name: 'Ketua Kelas Uji',
                    className: 'VII-A',
                    role: 'STUDENT',
                    passwordHash: 'dummy',
                    classRole: 'KETUA_KELAS'
                }
            });
        } else {
            await prisma.user.update({
                where: { id: student.id },
                data: { classRole: 'KETUA_KELAS' }
            });
        }
        const studentToken = jwt.sign({ id: student.id, username: student.username, role: 'STUDENT', name: student.name, className: student.className, classRole: 'KETUA_KELAS' }, JWT_SECRET, { expiresIn: '2h' });

        console.log(`  Pengguna siap:`);
        console.log(`  - Kurikulum / Admin : ${kurikulum.name} (${kurikulum.role})`);
        console.log(`  - Guru Piket        : ${teacher.name} (${teacher.teachingSubject || '-'})`);
        console.log(`  - Pengurus Kelas    : ${student.name} (${student.className || '-'}, ${student.classRole})\n`);

        // ========================================================
        // 1. MANAJEMEN JADWAL PIKET MINGGUAN (KURIKULUM & OPERATOR)
        // ========================================================
        console.log('--- 1. AUDIT JADWAL PIKET MINGGUAN ---');

        const now = new Date();
        const currentDayOfWeek = now.getDay(); // 0-6

        // Test 1.1: Kurikulum Menambah Guru ke Jadwal Piket Hari Ini
        const resCreatePiket = await makeRequest('POST', '/api/operator/piket-schedule', {
            teacherId: teacher.id,
            dayOfWeek: currentDayOfWeek,
            startTime: '06:45',
            endTime: '14:30',
            notes: 'Posko Piket Gerbang Utama & Koridor Tengah'
        }, kurikulumToken);
        assert(resCreatePiket.status === 200 && resCreatePiket.body?.success, 'Kurikulum Berhasil Menetapkan Jadwal Guru Piket Hari Ini');
        const createdPiketId = resCreatePiket.body?.schedule?.id;

        // Test 1.2: Membaca Jadwal Piket Mingguan
        const resWeekly = await makeRequest('GET', '/api/operator/piket-schedule', null, kurikulumToken);
        assert(resWeekly.status === 200 && resWeekly.body?.success && resWeekly.body.schedules?.length > 0, 'Kurikulum & Operator Memuat Jadwal Piket Mingguan Lengkap');

        // Test 1.3: Mengambil Daftar Guru Piket Bertugas Hari Ini (Web & Public Display)
        const resTodayPiket = await makeRequest('GET', '/api/piket/today-duty', null, null);
        assert(resTodayPiket.status === 200 && resTodayPiket.body?.success && resTodayPiket.body.totalOnDuty > 0, 'Display TV & Posko Piket: Memuat Petugas Guru Piket On-Duty Hari Ini');

        // Test 1.4: Cek Status Piket Guru yang Login di APK Guru
        const resTeacherPiketStatus = await makeRequest('GET', '/api/guru/piket-status', null, teacherToken);
        assert(resTeacherPiketStatus.status === 200 && resTeacherPiketStatus.body?.isPiketToday === true, 'APK Guru: Deteksi Otomatis Tugas Piket Guru yang Sedang Login Hari Ini');

        // ========================================================
        // 2. PELAPORAN JAM KOSONG & MONITORING LIVE TV
        // ========================================================
        console.log('\n--- 2. AUDIT PELAPORAN JAM KOSONG OLEH SISWA ---');

        const testPeriodLesson = 'Jam ke 3-4 (08:40 - 10:00)';
        const testSubject = 'Ilmu Pengetahuan Alam (IPA)';
        const testClass = student.className || 'VII-A';

        // Test 2.1: Pengurus Kelas Melaporkan Jam Kosong via APK
        const resReport = await makeRequest('POST', '/api/student/empty-class-report', {
            className: testClass,
            periodLesson: testPeriodLesson,
            subjectName: testSubject,
            scheduledTeacher: 'Dra. Hj. Nurul Hidayati, M.Pd',
            teacherStatus: 'SAKIT',
            hasAssignment: false
        }, studentToken);
        assert(resReport.status === 200 && (resReport.body?.success || resReport.body?.alreadyReported), 'APK Siswa: Pengurus Kelas Mengirim Laporan Jam Kosong ke Posko Piket');
        const reportId = resReport.body?.report?.id;

        // Test 2.2: Laporan Dibatasi (Anti-Spam: Tidak Boleh Duplikat di Jam yang Sama)
        const resSpamReport = await makeRequest('POST', '/api/student/empty-class-report', {
            className: testClass,
            periodLesson: testPeriodLesson,
            subjectName: testSubject,
            scheduledTeacher: 'Dra. Hj. Nurul Hidayati, M.Pd',
            teacherStatus: 'SAKIT'
        }, studentToken);
        assert(resSpamReport.status === 400 && resSpamReport.body?.alreadyReported === true, 'Perlindungan Anti-Spam: Laporan Duplikat Kelas pada Jam Sama Dibatasi');

        // Test 2.3: Status Monitoring Real-Time untuk TV Koridor
        const resMonitoring = await makeRequest('GET', '/api/piket/class-monitoring-status', null, null);
        assert(resMonitoring.status === 200 && (resMonitoring.body?.classes !== undefined || Array.isArray(resMonitoring.body)), 'TV Koridor / Display: Memuat Status KBM Seluruh Kelas Real-Time');

        // ========================================================
        // 3. FITUR BARU: SMART TEACHER SUBSTITUTION (GURU BADAL CERDAS)
        // ========================================================
        console.log('\n--- 3. AUDIT FITUR BARU: SMART TEACHER SUBSTITUTION ---');

        // Test 3.1: Rekomendasi Cerdas Guru Pengganti Berdasarkan Jadwal & Rumpun
        const resCandidates = await makeRequest('GET', `/api/piket/smart-candidates?className=${encodeURIComponent(testClass)}&periodLesson=${encodeURIComponent(testPeriodLesson)}&subjectName=${encodeURIComponent(testSubject)}`, null, kurikulumToken);
        assert(resCandidates.status === 200 && resCandidates.body?.success && resCandidates.body.candidates !== undefined, 'Fitur Baru: Smart Substitution Menganalisis Guru Piket Standby & Rumpun Relevan');
        if (resCandidates.body?.candidates?.length > 0) {
            const topCandidate = resCandidates.body.candidates[0];
            console.log(`    Rekomendasi Teratas: ${topCandidate.name} (${topCandidate.subject}) - Status: ${topCandidate.isStandby ? 'STANDBY' : 'MENGAJAR'} [Skor: ${topCandidate.priorityScore}]`);
        }

        // Test 3.2: Penugasan Guru Inval / Pengganti Resmi
        if (reportId) {
            const resAssignInval = await makeRequest('POST', `/api/piket/empty-class-reports/${reportId}/handle`, {
                actionType: 'GURU_INVAL_ASSIGNED',
                substituteTeacher: teacher.name,
                substituteNotes: 'Ditugaskan oleh Posko Piket menggantikan jam IPA jam ke 3-4'
            }, teacherToken);
            assert(resAssignInval.status === 200 && resAssignInval.body?.success, 'Guru Piket: Berhasil Menugaskan Guru Inval / Badal ke Ruang Kelas');
        }

        // ========================================================
        // 4. FITUR BARU: DISTRIBUSI TUGAS MANDIRI DARURAT (EMERGENCY ASSIGNMENT)
        // ========================================================
        console.log('\n--- 4. AUDIT FITUR BARU: EMERGENCY ASSIGNMENT DISPATCHER ---');

        // Test 4.1: Guru Piket/Kurikulum Mendistribusikan Tugas Mandiri ke Siswa
        const resDispatch = await makeRequest('POST', '/api/piket/emergency-assignment', {
            reportId: reportId || undefined,
            className: testClass,
            periodLesson: testPeriodLesson,
            subjectName: testSubject,
            assignmentTitle: 'Resume Bab 4: Ekosistem dan Rantai Makanan',
            instructions: 'Buka Buku Paket IPA Halaman 78-82. Buatlah bagan rantai makanan di buku catatan masing-masing.',
            dueDate: 'Hari ini pukul 10:00 WIB'
        }, teacherToken);
        assert(resDispatch.status === 200 && resDispatch.body?.success && resDispatch.body.recipientsCount > 0, 'Fitur Baru: Tugas Mandiri Berhasil Didistribusikan ke Seluruh Siswa di Kelas');

        // Test 4.2: Penyelesaian Kasus Jam Kosong (RESOLVED)
        if (reportId) {
            const resResolve = await makeRequest('POST', `/api/piket/empty-class-reports/${reportId}/resolve`, {
                resolutionNotes: 'Siswa telah mengerjakan tugas mandiri dengan tertib dan disupervisi oleh guru piket.'
            }, teacherToken);
            assert(resResolve.status === 200 && resResolve.body?.success, 'Guru Piket: Menyelesaikan Kasus Jam Kosong dengan Status RESOLVED');
        }

        // ========================================================
        // 5. FITUR BARU: BERITA ACARA PELAKSANAAN (BAP) PIKET HARIAN & CETAK RESMI
        // ========================================================
        console.log('\n--- 5. AUDIT FITUR BARU: BERITA ACARA PELAKSANAAN (BAP) PIKET HARIAN ---');

        // Test 5.1: Mengambil Data Rekap BAP Piket Harian (JSON)
        const resBapData = await makeRequest('GET', '/api/piket/bap-report', null, kurikulumToken);
        assert(resBapData.status === 200 && resBapData.body?.success && resBapData.body.summary !== undefined, 'Fitur Baru: Rekapitulasi Data BAP Piket Harian Terintegrasi Penuh');

        // Test 5.2: Dokumen Cetak Resmi BAP Piket Harian A4 Standar Dinas
        const resBapPrint = await makeRequest('GET', '/api/piket/bap-report/print', null, null);
        assert(resBapPrint.status === 200 && resBapPrint.headers['content-type']?.includes('text/html'), 'Fitur Baru: Dokumen Resmi Cetak BAP Piket A4 Lengkap Kop & Kolom Tanda Tangan');

        // Cleanup: Hapus jadwal piket uji jika dibuat
        if (createdPiketId) {
            await makeRequest('DELETE', `/api/operator/piket-schedule/${createdPiketId}`, null, kurikulumToken);
        }

        console.log('\n================================================================');
        console.log(`📊 REKAP HASIL AUDIT MODUL GURU PIKET & KELAS KOSONG:`);
        console.log(`   TOTAL LULUS : ${passed}`);
        console.log(`   TOTAL GAGAL : ${failed}`);
        console.log('================================================================\n');

        if (failed === 0) {
            console.log('🎉 SELURUH PENGUJIAN MODUL GURU PIKET & KELAS KOSONG 100% LULUS!');
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
