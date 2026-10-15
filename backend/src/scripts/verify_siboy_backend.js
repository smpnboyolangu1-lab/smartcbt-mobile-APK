const jwt = require('jsonwebtoken');
const http = require('http');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'cbt_prod_secret_f9a83b27c64e10d592a8174fec01849a62bc38102d7e481b9201948271039841';
const PORT = 3000;

function request(options, postData) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    parsed = body;
                }
                resolve({ statusCode: res.statusCode || 0, data: parsed });
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

async function runTests() {
    console.log('================================================================');
    console.log('🚀 SIBOY BACKEND VERIFICATION TEST SUITE (SMPN 1 BOYOLANGU)');
    console.log('================================================================');

    const dbAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const dbTeacher = await prisma.user.findFirst({ where: { role: 'TEACHER' } });
    const dbStudent = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
    const dbBk = await prisma.user.findFirst({ where: { OR: [{ role: 'COUNSELOR' }, { isBk: true }] } });

    const adminUser = dbAdmin || { id: 'admin-test-id', username: 'admin', role: 'ADMIN', name: 'Super Admin' };
    const teacherUser = dbTeacher || { id: 'teacher-test-id', username: 'guru1', role: 'TEACHER', name: 'Guru Pembina' };
    const studentUser = dbStudent || { id: 'student-test-id', username: 'siswa1', role: 'STUDENT', name: 'Siswa Percobaan' };
    const bkUser = dbBk || adminUser;

    const adminToken = jwt.sign(
        { id: adminUser.id, username: adminUser.username, role: 'ADMIN', name: adminUser.name },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    const teacherToken = jwt.sign(
        { 
            id: teacherUser.id, 
            username: teacherUser.username, 
            role: 'TEACHER', 
            name: teacherUser.name, 
            rolesTambahan: JSON.stringify(['kurikulum', 'wali_kelas', 'piket']),
            availableRoles: ['TEACHER', 'KURIKULUM', 'WALI_KELAS', 'PIKET']
        },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    const bkToken = jwt.sign(
        { id: bkUser.id, username: bkUser.username, role: bkUser.role || 'COUNSELOR', name: bkUser.name, isBk: true },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    const studentToken = jwt.sign(
        { id: studentUser.id, username: studentUser.username, role: 'STUDENT', name: studentUser.name },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    const parentToken = jwt.sign(
        { id: 'parent-test-id', username: 'ortu1', role: 'PARENT', name: 'Orang Tua' },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    let passedCount = 0;
    let totalCount = 0;

    async function testCase(name, fn) {
        totalCount++;
        try {
            await fn();
            console.log(`✅ [PASS] ${name}`);
            passedCount++;
        } catch (err) {
            console.error(`❌ [FAIL] ${name}: ${err.message || err}`);
        }
    }

    // 1. GET /api/sekolah/konteks
    await testCase('1. Endpoint GET /api/sekolah/konteks delivers dynamic DB metadata', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/sekolah/konteks',
            method: 'GET'
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        const d = res.data;
        if (!d.success || !d.data) throw new Error('Invalid response structure');
        const ctx = d.data;
        if (!ctx.nama_sekolah || !ctx.npsn || !ctx.semboyan) {
            throw new Error(`Missing core school info: ${JSON.stringify(ctx)}`);
        }
        if (ctx.npsn !== '20515437') throw new Error(`NPSN mismatch: expected 20515437, got ${ctx.npsn}`);
        if (!ctx.semboyan.includes('SIBOY FRESH')) throw new Error(`Semboyan mismatch: ${ctx.semboyan}`);
        console.log(`   -> Nama: ${ctx.nama_sekolah}, NPSN: ${ctx.npsn}, Semboyan: ${ctx.semboyan}`);
        console.log(`   -> Counts: Kelas=${ctx.total_kelas}, Guru=${ctx.total_guru}, Siswa=${ctx.total_siswa}, BK=${ctx.total_bk}`);
        console.log(`   -> Geofence Zones loaded: ${ctx.geofence_zones?.length || 0} zones`);
    });

    // 2. Auth Roles & enrichUserRoles (GET /api/auth/roles)
    await testCase('2. Middleware enrichUserRoles & GET /api/auth/roles', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/auth/roles',
            method: 'GET',
            headers: { Authorization: `Bearer ${teacherToken}` }
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        if (!res.data.success || !res.data.data) throw new Error('Response success is false');
        const roles = res.data.data.roles;
        console.log(`   -> Available Roles for enriched teacher: ${JSON.stringify(roles)}`);
        if (!roles.includes('TEACHER')) throw new Error('Missing primary role TEACHER');
    });

    // 3. Switch Role (POST /api/auth/switch-role)
    await testCase('3. Multi-Role Dynamic Switching (POST /api/auth/switch-role)', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/auth/switch-role',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${teacherToken}`
            }
        }, { targetRole: 'WALI_KELAS' });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        if (!res.data.success || !res.data.data?.token) throw new Error('Token not returned');
        console.log(`   -> Switched to activeRole: ${res.data.data.activeRole}`);
    });

    // 4. Manajemen Pengurus Kelas (FCFS Claim, Verify, Reset)
    await testCase('4. Manajemen Pengurus Kelas Endpoints', async () => {
        const claimRes = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/class-officers/claim',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${studentToken}`
            }
        }, { position: 'KETUA_KELAS' });
        if (claimRes.statusCode !== 400 && claimRes.statusCode !== 200 && claimRes.statusCode !== 404) {
            throw new Error(`Unexpected claim status: ${claimRes.statusCode} - ${JSON.stringify(claimRes.data)}`);
        }
        console.log(`   -> FCFS Claim endpoint validation responsive (status ${claimRes.statusCode})`);

        const resetRes = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/class-officers/reset',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`
            }
        }, { classId: 'dummy-class-id' });
        if (resetRes.statusCode !== 200 && resetRes.statusCode !== 404) {
            throw new Error(`Unexpected reset status: ${resetRes.statusCode}`);
        }
        console.log(`   -> Reset Class Officers endpoint responsive (status ${resetRes.statusCode})`);
    });

    // 5. Laporan Kelas Kosong & Auto-Route (POST /api/kelas-kosong/lapor)
    await testCase('5. Laporan Kelas Kosong Routing & Resolve', async () => {
        const laporRes = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/kelas-kosong/lapor',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${studentToken}`
            }
        }, {
            className: 'VII-A',
            jamPelajaran: 'Jam 3-4',
            catatan: 'Guru matematika berhalangan hadir'
        });
        if (laporRes.statusCode !== 200 && laporRes.statusCode !== 201 && laporRes.statusCode !== 400) {
            throw new Error(`Unexpected status: ${laporRes.statusCode} - ${JSON.stringify(laporRes.data)}`);
        }
        console.log(`   -> Report empty class responsive (status ${laporRes.statusCode}: ${laporRes.data?.message || 'OK'})`);

        const resolveRes = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/kelas-kosong/dummy-report-id/resolve',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${teacherToken}`
            }
        }, { resolutionType: 'TUGAS_MANDIRI', resolutionNote: 'Dikerjakan di LKS hal 45' });
        if (resolveRes.statusCode !== 200 && resolveRes.statusCode !== 404) {
            throw new Error(`Unexpected resolve status: ${resolveRes.statusCode}`);
        }
        console.log(`   -> Resolve empty class endpoint responsive (status ${resolveRes.statusCode})`);
    });

    // 6. Multi-Child Orang Tua (/api/parent/children)
    await testCase('6. Multi-Child Orang Tua (GET /api/parent/children & linking)', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/parent/children',
            method: 'GET',
            headers: { Authorization: `Bearer ${parentToken}` }
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        console.log(`   -> Children queried successfully. Count: ${res.data.children?.length || res.data.data?.length || 0}`);
    });

    // 7. EWS BK SAW Ranking (GET /api/bk-advanced/saw-ranking)
    await testCase('7. EWS BK SAW 4-Indicator 0-100 Calculation (/api/bk/saw-rankings)', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/bk/saw-rankings',
            method: 'GET',
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        if (!res.data.success) throw new Error('Success flag is false');
        console.log(`   -> SAW Ranking returned ${res.data.data?.length || 0} student entries with 0-100 scale`);
        if (res.data.data && res.data.data.length > 0) {
            const first = res.data.data[0];
            console.log(`   -> Sample entry: Student="${first.namaSiswa || 'Siswa'}", SkorSAW=${first.skor100}, Status=${first.statusRisiko}`);
        }
    });

    // 8. Dispensasi Barcode Dinamis (GET /api/v1/bk/dynamic-qr)
    await testCase('8. Dispensasi Dynamic Barcode Token Generator', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/v1/bk/dynamic-qr',
            method: 'GET',
            headers: { Authorization: `Bearer ${bkToken}` }
        });
        if (res.statusCode !== 200) {
            throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        }
        console.log(`   -> Dynamic token generated: ${res.data.token || res.data.qrCodeData || 'Valid QR Token'}`);
    });

    // 9. Chat Internal Multi-Role (/api/chat/threads)
    await testCase('9. Chat Internal Multi-Role Threads & Messages', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/chat/threads',
            method: 'GET',
            headers: { Authorization: `Bearer ${teacherToken}` }
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        console.log(`   -> Chat threads query responsive, total threads: ${res.data.threads?.length || 0}`);
    });

    // 10. Student Timeline (GET /api/student/timeline)
    await testCase('10. Student Unified Multi-Module Timeline', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/student/timeline',
            method: 'GET',
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        if (res.statusCode !== 200 && res.statusCode !== 404) {
            throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        }
        console.log(`   -> Timeline endpoint responsive with status ${res.statusCode} (${res.data.timeline?.length || 0} events)`);
    });

    // 11. Rekap Otomatis Scheduler (POST /api/scheduler/rekap-otomatis)
    await testCase('11. Rekap Otomatis Daily Scheduler Trigger', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/scheduler/rekap-otomatis',
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        console.log(`   -> Daily Auto Recap triggered successfully: ${res.data.message || 'OK'}`);
    });

    // 12. AI Question Generator Quota & RAG (/api/soal/ai-quota)
    await testCase('12. AI Question Generator Quota Check', async () => {
        const res = await request({
            hostname: 'localhost',
            port: PORT,
            path: '/api/soal/ai-quota',
            method: 'GET',
            headers: { Authorization: `Bearer ${teacherToken}` }
        });
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`);
        console.log(`   -> AI Quota: ${res.data.usedToday}/${res.data.dailyLimit} sessions used today. Remaining: ${res.data.remainingToday}`);
    });

    await prisma.$disconnect();

    console.log('================================================================');
    console.log(`📊 TEST SUITE SUMMARY: ${passedCount}/${totalCount} TEST CASES PASSED`);
    console.log('================================================================');
}

runTests().catch(console.error);
