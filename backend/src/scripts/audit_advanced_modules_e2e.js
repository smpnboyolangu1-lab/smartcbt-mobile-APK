/**
 * AUDIT END-TO-END (E2E) MODUL CANGGIH 2.0
 * Menguji fungsionalitas modul:
 * 1. CBT Canggih 2.0 (Watermark Layar, Heartbeat Proctoring, Psikometrik IRT, Remote Proctor Command)
 * 2. Perpustakaan Canggih 2.0 (Smart Recommendations, 15-Min Literacy Gamification, Reading Progress, Queue, Leaderboard)
 * 3. BK Canggih 2.0 (Daily Mood Radar, RIASEC Holland Code Pathway, Matriks Sosiometri, Burnout Risk)
 * 4. UKS Canggih 2.0 (Smart Clinical Triage, Outbreak KLB Detection, KMS WHO Growth, Live Ward Monitoring)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const http = require('http');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'smart-school-secret-key-2025';
const BASE_URL = 'http://127.0.0.1:3000';

let adminToken = '';
let studentToken = '';
let studentUser = null;
let testExamId = '';
let testBookId = '';

let passed = 0;
let failed = 0;

function assert(name, condition, details = '') {
    if (condition) {
        console.log(`  [PASS] ${name}`);
        passed++;
    } else {
        console.error(`  [FAIL] ${name}${details ? ' -> ' + details : ''}`);
        failed++;
    }
}

function makeRequest(method, endpointPath, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpointPath, BASE_URL);
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

async function runE2ETests() {
    console.log('================================================================');
    console.log('   AUDIT E2E MODUL CANGGIH: CBT 2.0, PERPUSTAKAAN, BK & UKS');
    console.log('================================================================\n');

    try {
        console.log('1. Mempersiapkan Token Aktor & Data Master...');
        let adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
        if (!adminUser) {
            adminUser = await prisma.user.findFirst({ where: { role: 'KURIKULUM' } });
        }
        adminToken = jwt.sign(
            { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: adminUser.name },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        studentUser = await prisma.user.findFirst({ where: { role: 'STUDENT', className: { not: null } } });
        if (!studentUser) {
            studentUser = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
        }
        studentToken = jwt.sign(
            { id: studentUser.id, username: studentUser.username, role: 'STUDENT', name: studentUser.name, className: studentUser.className || '7A' },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        assert('Persiapan Aktor Admin & Siswa', !!adminToken && !!studentToken);

        // Ambil data referensi Ujian & Buku
        const exam = await prisma.exam.findFirst();
        if (exam) testExamId = exam.id;

        let book = await prisma.libraryMasterBook.findFirst();
        if (!book) {
            book = await prisma.libraryMasterBook.create({
                data: {
                    judul: 'Sains dan Masa Depan Boyolangu',
                    pengarang: 'Prof. Supriyono',
                    kategori: 'SAINS',
                    isbn: '978-602-001-' + Date.now().toString().slice(-4),
                    jumlahEksemplar: 2
                }
            });
        }
        testBookId = book.id;

        // ==========================================
        // TEST SUITE 1: ADVANCED CBT 2.0 ENGINE
        // ==========================================
        console.log('\n2. Menguji Modul CBT Canggih 2.0...');
        // 1.1 Watermark Token
        const wmRes = await makeRequest('GET', `/api/cbt/watermark-token?examId=${testExamId || 'EXAM-01'}`, null, studentToken);
        assert('CBT 2.0: Dynamic Floating Watermark Token', wmRes.status === 200 && wmRes.body?.success && wmRes.body.watermark?.tokenHash, JSON.stringify(wmRes.body));

        // 1.2 Heartbeat Proctoring & AI Suspicion Index
        const hbRes = await makeRequest('POST', '/api/cbt/proctor-heartbeat', {
            examId: testExamId || 'EXAM-01',
            blurCount: 2,
            fullscreenExitCount: 1,
            screenshotAttempts: 1,
            floatingAppDetected: false,
            splitScreenDetected: false
        }, studentToken);
        assert('CBT 2.0: AI Suspicion Index & Live Heartbeat', hbRes.status === 200 && hbRes.body?.success && hbRes.body.integrityMetrics?.suspicionScore !== undefined, JSON.stringify(hbRes.body));

        // 1.3 Proctor Remote Command
        const cmdRes = await makeRequest('POST', '/api/cbt/proctor-command', {
            examId: testExamId || 'EXAM-01',
            studentId: studentUser.id,
            command: 'SEND_WARNING',
            reason: 'Dilarang berbicara saat ujian'
        }, adminToken);
        assert('CBT 2.0: Remote Proktor Command Dispatcher', cmdRes.status === 200 && cmdRes.body?.success && cmdRes.body.command === 'SEND_WARNING', JSON.stringify(cmdRes.body));

        // 1.4 Psychometrics Butir Soal (Jika ada ujian)
        if (testExamId) {
            const psychoRes = await makeRequest('GET', `/api/cbt/psychometrics/${testExamId}`, null, adminToken);
            assert('CBT 2.0: Advanced Item Psychometrics (IRT & Distractor)', psychoRes.status === 200 && psychoRes.body?.success, JSON.stringify(psychoRes.body));
        }

        // ==========================================
        // TEST SUITE 2: ADVANCED LIBRARY 2.0 ENGINE
        // ==========================================
        console.log('\n3. Menguji Modul Perpustakaan Canggih 2.0...');
        // 2.1 Smart Book Recommendations
        const recRes = await makeRequest('GET', `/api/library/recommendations?studentId=${studentUser.id}`, null, studentToken);
        assert('Perpus 2.0: AI Smart Book Recommendations', recRes.status === 200 && recRes.body?.success && Array.isArray(recRes.body.data), JSON.stringify(recRes.body));

        // 2.2 Record 15-Minute Reading Session
        const readRes = await makeRequest('POST', '/api/library/reading-session', {
            studentId: studentUser.id,
            studentName: studentUser.name,
            bookId: testBookId,
            durationMinutes: 20,
            lastPage: 15,
            isCompleted: false
        }, studentToken);
        assert('Perpus 2.0: 15-Menit Pembiasaan Literasi Session & EXP', readRes.status === 200 && readRes.body?.success && readRes.body.sessionSummary?.habitMet === true, JSON.stringify(readRes.body));

        // 2.3 Student Literacy Progress & Gamification Badges
        const progRes = await makeRequest('GET', `/api/library/literacy-progress/${studentUser.id}`, null, studentToken);
        assert('Perpus 2.0: Literacy Badges & Level Dashboard', progRes.status === 200 && progRes.body?.success && progRes.body.gamification?.levelTitle, JSON.stringify(progRes.body));

        // 2.4 Leaderboard Literasi
        const leadRes = await makeRequest('GET', '/api/library/leaderboard', null, studentToken);
        assert('Perpus 2.0: School Literacy Leaderboard', leadRes.status === 200 && leadRes.body?.success && Array.isArray(leadRes.body.studentsLeaderboard), JSON.stringify(leadRes.body));

        // ==========================================
        // TEST SUITE 3: ADVANCED SMART COUNSELING (BK 2.0)
        // ==========================================
        console.log('\n4. Menguji Modul Bimbingan Konseling (BK) Canggih 2.0...');
        // 3.1 Submit Daily Mood Log
        const moodRes = await makeRequest('POST', '/api/bk/mood-log', {
            studentId: studentUser.id,
            studentName: studentUser.name,
            mood: 'TENANG',
            intensity: 4,
            tags: ['BELAJAR', 'PERPUSTAKAAN'],
            notes: 'Membaca buku di perpustakaan sangat menyenangkan'
        }, studentToken);
        assert('BK 2.0: Daily Emotional Mood Tracker Siswa', moodRes.status === 200 && moodRes.body?.success && moodRes.body.data?.mood === 'TENANG', JSON.stringify(moodRes.body));

        // 3.2 Get Student Mood Radar
        const radarRes = await makeRequest('GET', `/api/bk/mood-radar/${studentUser.id}`, null, studentToken);
        assert('BK 2.0: Emotional Well-being Radar & Analytics', radarRes.status === 200 && radarRes.body?.success && radarRes.body.emotionalWellbeingScore !== undefined, JSON.stringify(radarRes.body));

        // 3.3 RIASEC Holland Code Career & High School Pathway Advisor
        const riasecRes = await makeRequest('POST', '/api/bk/riasec-assessment', {
            studentId: studentUser.id,
            academicYear: '2026/2027',
            scores: { R: 85, I: 90, A: 60, S: 70, E: 75, C: 65 },
            notes: 'Sangat tertarik dengan pemrograman komputer dan robotika'
        }, studentToken);
        assert('BK 2.0: RIASEC Holland Code & SMA/SMK Pathway', riasecRes.status === 200 && riasecRes.body?.success && riasecRes.body.data?.hollandCode, JSON.stringify(riasecRes.body));

        // 3.4 Sosiometri Kelas
        const socioRes = await makeRequest('POST', '/api/bk/sociometry-matrix', {
            className: studentUser.className || '7A',
            criteria: 'BELAJAR_KELOMPOK',
            nominations: [
                { studentId: studentUser.id, studentName: studentUser.name, chosenStudentIds: ['teman-1', 'teman-2'] },
                { studentId: 'teman-1', studentName: 'Teman Satu', chosenStudentIds: [studentUser.id] },
                { studentId: 'teman-2', studentName: 'Teman Dua', chosenStudentIds: [studentUser.id] },
                { studentId: 'teman-3', studentName: 'Teman Tiga (Terisolasi)', chosenStudentIds: [] }
            ]
        }, adminToken);
        assert('BK 2.0: Class Sociometry & Anti-Bullying Social Network Analysis', socioRes.status === 200 && socioRes.body?.success && socioRes.body.summary?.averageAcceptanceScore !== undefined, JSON.stringify(socioRes.body));

        // 3.5 Student Burnout Risk Index
        const burnoutRes = await makeRequest('GET', `/api/bk/burnout-risk/${studentUser.id}`, null, studentToken);
        assert('BK 2.0: Student Burnout & Distress Risk Index', burnoutRes.status === 200 && burnoutRes.body?.success && burnoutRes.body.burnoutMetrics?.burnoutScore !== undefined, JSON.stringify(burnoutRes.body));

        // ==========================================
        // TEST SUITE 4: ADVANCED UKS 2.0 ENGINE
        // ==========================================
        console.log('\n5. Menguji Modul UKS Canggih 2.0...');
        // 4.1 Smart Clinical Triage Visit
        const triageRes = await makeRequest('POST', '/api/uks/triage-visit', {
            userId: studentUser.id,
            category: 'DEMAM',
            temperature: 38.6,
            bloodPressure: '110/70',
            complaint: 'Demam menggigil setelah upacara bendera',
            bedNumber: 'Bed 01',
            isFainting: false
        }, adminToken);
        assert('UKS 2.0: Smart Clinical Triage (Kuning) & SOP First Aid', triageRes.status === 200 && triageRes.body?.success && triageRes.body.triage?.colorCode === 'KUNING', JSON.stringify(triageRes.body));

        // 4.2 Outbreak / KLB Early Warning
        const outbreakRes = await makeRequest('GET', '/api/uks/outbreak-warning', null, adminToken);
        assert('UKS 2.0: Outbreak / KLB Cluster Detection Early Warning', outbreakRes.status === 200 && outbreakRes.body?.success && outbreakRes.body.isOutbreakDetected !== undefined, JSON.stringify(outbreakRes.body));

        // 4.3 KMS WHO Growth Z-Score Calculator
        const kmsRes = await makeRequest('POST', '/api/uks/kms-growth', {
            studentId: studentUser.id,
            heightCm: 162,
            weightKg: 52,
            academicPeriod: 'Semester Ganjil 2026/2027',
            measuredBy: 'PMR PMI Boyolangu'
        }, adminToken);
        assert('UKS 2.0: Digital KMS & WHO Nutritional Status IMT', kmsRes.status === 200 && kmsRes.body?.success && kmsRes.body.data?.bmi === 19.8 && kmsRes.body.data?.nutritionalStatus === 'NORMAL', JSON.stringify(kmsRes.body));

        // 4.4 Live UKS Ward & Bed Occupancy Monitoring
        const wardRes = await makeRequest('GET', '/api/uks/ward-status', null, adminToken);
        assert('UKS 2.0: Live UKS Ward & Bed Occupancy Rate (BOR)', wardRes.status === 200 && wardRes.body?.success && Array.isArray(wardRes.body.wardBeds), JSON.stringify(wardRes.body));

    } catch (err) {
        console.error('Fatal Error during audit:', err);
        failed++;
    } finally {
        await prisma.$disconnect();
    }

    console.log('\n================================================================');
    console.log(`HASIL AUDIT E2E MODUL CANGGIH:`);
    console.log(`TOTAL PENGUJIAN: ${passed + failed}`);
    console.log(`LULUS          : ${passed}`);
    console.log(`GAGAL          : ${failed}`);
    console.log('================================================================');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runE2ETests();
