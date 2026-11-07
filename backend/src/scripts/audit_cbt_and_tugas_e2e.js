/**
 * END-TO-END (E2E) LIVE AUDIT SCRIPT: CBT & TUGAS / PR
 * Menguji seluruh alur Kurikulum, Guru Pengawas, Guru Biasa, dan Siswa secara nyata
 * terhadap server aktif (http://localhost:3000) & PostgreSQL Database.
 */

const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

const BASE_URL = 'http://localhost:3000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_smartcbt_2026';

async function apiRequest(method, endpoint, token, body = null, extraHeaders = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'X-Client-Type': 'SmartSchool-ExamBrowser',
        'User-Agent': 'SmartSchool-ExamBrowser/2.0 (Android; SmartSchool-CBT; okhttp/4.12.0)',
        ...extraHeaders
    };
    const options = { method, headers };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        options.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE_URL}${endpoint}`, options);
    let data = null;
    const text = await res.text();
    try {
        data = JSON.parse(text);
    } catch (_) {
        data = { raw: text };
    }
    return { status: res.status, ok: res.ok, data };
}

async function runAudit() {
    console.log('====================================================================');
    console.log('   AUDIT END-TO-END (E2E) KELANCARAN SISTEM CBT & TUGAS PR          ');
    console.log('====================================================================\n');

    let passed = 0;
    let failed = 0;
    const assert = (condition, successMsg, failMsg) => {
        if (condition) {
            console.log(`  ✅ [LULUS] ${successMsg}`);
            passed++;
        } else {
            console.error(`  ❌ [GAGAL] ${failMsg}`);
            failed++;
        }
    };

    let createdExamId = null;
    let createdHomeworkId = null;

    try {
        // 1. PERSIAPAN AKUN UJI DARI DATABASE RIIL
        console.log('--- 1. Menyiapkan Akun Simulasi (Kurikulum, Guru Mapel, Guru Biasa, Siswa) ---');
        const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
        const teachers = await prisma.user.findMany({ where: { role: 'TEACHER' }, take: 5 });
        const studentUser = await prisma.user.findFirst({
            where: { role: 'STUDENT', className: { not: null } }
        });

        if (!adminUser || teachers.length < 2 || !studentUser) {
            throw new Error('Data pengguna di database tidak mencukupi untuk simulasi.');
        }

        const guruMapel = teachers[0];
        const guruBiasa = teachers[1];
        const targetClass = studentUser.className || 'VII-A';

        const signToken = (u, extraRoles = []) => jwt.sign({
            id: u.id,
            username: u.username,
            role: u.role,
            name: u.name,
            className: u.className,
            additionalRoles: extraRoles
        }, JWT_SECRET, { expiresIn: '1h' });

        const kurikulumToken = signToken(adminUser, ['KURIKULUM']);
        const guruMapelToken = signToken(guruMapel);
        const guruBiasaToken = signToken(guruBiasa);
        const studentToken = signToken(studentUser);

        console.log(`  • Kurikulum/Admin : ${adminUser.name}`);
        console.log(`  • Guru Mapel/Proktor: ${guruMapel.name} (${guruMapel.id})`);
        console.log(`  • Guru Biasa (Non-Proktor): ${guruBiasa.name} (${guruBiasa.id})`);
        console.log(`  • Siswa Uji       : ${studentUser.name} (Kelas: ${targetClass})\n`);

        // ====================================================================
        // BAGIAN A: AUDIT SISTEM CBT (KURIKULUM -> GURU -> PROKTOR -> SISWA)
        // ====================================================================
        console.log('--- 2. [CBT - Kurikulum] Membuat Jadwal Ujian & Plotting Kelas/Proktor ---');
        const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        const createExamRes = await apiRequest('POST', '/cbt/exams', kurikulumToken, {
            title: '[AUDIT-E2E] Tryout & SAS Matematika Terpadu',
            subject: 'Matematika',
            examCategory: 'SAS',
            level: targetClass.split('-')[0] || 'VII',
            assignedClasses: targetClass,
            durationMinutes: 60,
            executionDate: todayYmd,
            startTime: '00:01',
            endTime: '23:59',
            passingGrade: 75,
            randomizeQuestions: true,
            randomizeOptions: true,
            showScoreToStudent: true
        });

        createdExamId = createExamRes.data?.id || createExamRes.data?.exam?.id;
        assert(
            createExamRes.ok && createdExamId,
            `Kurikulum berhasil membuat jadwal ujian resmi (ID: ${createdExamId}) untuk kelas ${targetClass}`,
            `Gagal membuat ujian: ${JSON.stringify(createExamRes.data)}`
        );

        // Delegasi Guru Mapel sebagai Penulis Soal
        const assignAuthorRes = await apiRequest('POST', '/cbt/exam-packages/assign-authors', kurikulumToken, {
            examId: createdExamId,
            teacherIds: [guruMapel.id]
        });
        assert(
            assignAuthorRes.ok,
            `Kurikulum berhasil menugaskan ${guruMapel.name} sebagai Penulis Soal paket ujian`,
            `Gagal assign penulis soal: ${JSON.stringify(assignAuthorRes.data)}`
        );

        // Plot Guru Mapel sebagai Pengawas Ruang kelas targetClass
        const assignProctorRes = await apiRequest('POST', '/cbt/assign-class-proctors', kurikulumToken, {
            examId: createdExamId,
            assignments: {
                [targetClass]: guruMapel.id
            }
        });
        assert(
            assignProctorRes.ok,
            `Kurikulum berhasil mem-plot ${guruMapel.name} sebagai Pengawas Ruang kelas ${targetClass}`,
            `Gagal plot pengawas: ${JSON.stringify(assignProctorRes.data)}`
        );

        console.log('\n--- 3. [CBT - Guru] CRUD Butir Soal (Tambah PG, Edit, Verifikasi) ---');
        // Cek apakah ujian muncul di daftar ujian Guru Mapel
        const teacherExamsRes = await apiRequest('GET', '/guru/exams', guruMapelToken);
        const foundInTeacherList = Array.isArray(teacherExamsRes.data) && teacherExamsRes.data.some(e => e.id === createdExamId);
        assert(
            foundInTeacherList,
            `Paket ujian resmi tampil di daftar CBT Guru Penulis Soal (/api/guru/exams)`,
            `Paket ujian tidak tampil di daftar Guru Penulis Soal`
        );

        // Tambah Soal 1 (PG)
        const q1Res = await apiRequest('POST', `/guru/exams/${createdExamId}/questions`, guruMapelToken, {
            questionText: 'Berapakah hasil dari 15 + 25 x 2?',
            questionType: 'MULTIPLE_CHOICE',
            optionA: '80',
            optionB: '65',
            optionC: '70',
            optionD: '55',
            correctAnswer: 'B',
            weight: 50
        });
        const q1Id = q1Res.data?.id || q1Res.data?.question?.id;
        assert(
            q1Res.ok && q1Id,
            `Guru berhasil menambahkan Soal #1 (PG, Bobot 50, Kunci: B)`,
            `Gagal tambah Soal #1: ${JSON.stringify(q1Res.data)}`
        );

        // Tambah Soal 2 (PG)
        const q2Res = await apiRequest('POST', `/guru/exams/${createdExamId}/questions`, guruMapelToken, {
            questionText: 'Nilai x dari persamaan 3x - 6 = 12 adalah...',
            questionType: 'MULTIPLE_CHOICE',
            optionA: '4',
            optionB: '5',
            optionC: '6',
            optionD: '8',
            correctAnswer: 'C',
            weight: 50
        });
        const q2Id = q2Res.data?.id || q2Res.data?.question?.id;
        assert(
            q2Res.ok && q2Id,
            `Guru berhasil menambahkan Soal #2 (PG, Bobot 50, Kunci: C)`,
            `Gagal tambah Soal #2: ${JSON.stringify(q2Res.data)}`
        );

        // Edit Soal 1
        const editQ1Res = await apiRequest('PUT', `/guru/exams/${createdExamId}/questions/${q1Id}`, guruMapelToken, {
            questionText: 'Berapakah hasil operasi hitung campuran 15 + (25 x 2)?',
            questionType: 'MULTIPLE_CHOICE',
            optionA: '80',
            optionB: '65',
            optionC: '70',
            optionD: '55',
            correctAnswer: 'B',
            weight: 50
        });
        assert(
            editQ1Res.ok,
            `Guru berhasil mengedit butir Soal #1 (PUT /api/guru/exams/:examId/questions/:id)`,
            `Gagal edit Soal #1: ${JSON.stringify(editQ1Res.data)}`
        );

        // Ambil daftar soal
        const listQRes = await apiRequest('GET', `/guru/exams/${createdExamId}/questions`, guruMapelToken);
        const questionsList = Array.isArray(listQRes.data) ? listQRes.data : (listQRes.data?.questions || []);
        assert(
            questionsList.length === 2,
            `Daftar soal terverifikasi berisi ${questionsList.length} soal aktif`,
            `Jumlah soal tidak sesuai: ${questionsList.length}`
        );

        console.log('\n--- 4. [CBT - Token & Pengawasan] Verifikasi Isolasi Token Pengawas vs Guru Biasa ---');
        // Rilis token oleh pengawas/kurikulum
        const releaseTokenRes = await apiRequest('POST', '/cbt/toggle-token', guruMapelToken, {
            examId: createdExamId,
            isReleased: true,
            action: 'RELEASE'
        });
        assert(
            releaseTokenRes.ok,
            `Pengawas berhasil mengaktifkan/merilis token ujian`,
            `Gagal rilis token: ${JSON.stringify(releaseTokenRes.data)}`
        );

        // Cek token dari sisi Guru Pengawas Resmi
        const proctorTokensRes = await apiRequest('GET', '/cbt/proctor-tokens', guruMapelToken);
        const proctorExams = proctorTokensRes.data?.exams || [];
        const targetExamInProctor = proctorExams.find(e => e.examId === createdExamId);
        assert(
            Boolean(targetExamInProctor),
            `Guru Pengawas Resmi (${guruMapel.name}) MENERIMA token ujian kelas ${targetClass} di dashboardnya`,
            `Guru Pengawas Resmi gagal melihat token ujiannya: ${JSON.stringify(proctorTokensRes.data)}`
        );

        // Cek token dari sisi Guru Biasa (Bukan Pengawas ujian ini)
        const nonProctorTokensRes = await apiRequest('GET', '/cbt/proctor-tokens', guruBiasaToken);
        const nonProctorExams = nonProctorTokensRes.data?.exams || [];
        const leakedToNonProctor = nonProctorExams.some(e => e.examId === createdExamId);
        assert(
            !leakedToNonProctor,
            `Guru Biasa Non-Pengawas (${guruBiasa.name}) TIDAK MENERIMA bocoran banner token ujian tersebut (Isolasi 100% Aman)`,
            `BUG: Token ujian masih bocor ke Guru Biasa yang bukan pengawas!`
        );

        // Ambil token yang berlaku untuk kelas targetClass
        const activeToken = targetExamInProctor?.classTokens?.[targetClass] || targetExamInProctor?.globalToken;
        console.log(`  • Token Aktif Kelas ${targetClass}: ${activeToken}`);

        console.log('\n--- 5. [CBT - Siswa] Alur Ujian Siswa: Cek Jadwal -> Verifikasi Token -> Unduh Soal -> Jawab & Submit ---');
        const studentActiveRes = await apiRequest('GET', '/cbt/student/active-exams', studentToken);
        const activeExamsList = studentActiveRes.data?.exams || (Array.isArray(studentActiveRes.data) ? studentActiveRes.data : []);
        const studentSeesExam = activeExamsList.some(e => e.id === createdExamId);
        assert(
            studentSeesExam,
            `Siswa (${studentUser.name} - ${targetClass}) melihat ujian aktif di daftar CBT APK`,
            `Siswa tidak melihat ujian di daftar aktif: ${JSON.stringify(studentActiveRes.data)}`
        );

        // Verifikasi Token oleh Siswa
        const verifyTokenRes = await apiRequest('POST', '/cbt/verify-token', studentToken, {
            examId: createdExamId,
            token: activeToken
        });
        assert(
            verifyTokenRes.ok && verifyTokenRes.data?.valid !== false,
            `Siswa berhasil memverifikasi token ruang ujian (${activeToken})`,
            `Gagal verifikasi token oleh siswa: ${JSON.stringify(verifyTokenRes.data)}`
        );

        // Unduh Soal oleh Siswa
        const downloadQRes = await apiRequest('POST', '/cbt/download-questions', studentToken, {
            examId: createdExamId,
            token: activeToken
        });
        const downloadedQuestions = downloadQRes.data?.questions || [];
        assert(
            downloadQRes.ok && downloadedQuestions.length === 2,
            `Siswa berhasil mengunduh ${downloadedQuestions.length} butir soal ujian ke perangkat`,
            `Gagal unduh soal ujian: ${JSON.stringify(downloadQRes.data)}`
        );

        // Siswa menjawab semua soal dengan benar & submit selesai
        const syncExamRes = await apiRequest('POST', '/cbt/sync-exam', studentToken, {
            examId: createdExamId,
            answers: {
                [q1Id]: 'B',
                [q2Id]: 'C'
            },
            cheatStrikes: 0,
            isFinished: true
        });
        assert(
            syncExamRes.ok && Number(syncExamRes.data?.score) === 100,
            `Siswa berhasil submit jawaban & sistem menghitung skor otomatis dengan tepat: Nilai = ${syncExamRes.data?.score}`,
            `Gagal sinkronisasi/submit jawaban siswa: ${JSON.stringify(syncExamRes.data)}`
        );

        // Guru memeriksa hasil ujian
        const resultsRes = await apiRequest('GET', `/cbt/results?examId=${createdExamId}`, guruMapelToken);
        const resultsArr = Array.isArray(resultsRes.data) ? resultsRes.data : (resultsRes.data?.results || []);
        const studentResult = resultsArr.find(r => r.studentId === studentUser.id);
        assert(
            studentResult && Number(studentResult.score) === 100,
            `Rekap nilai siswa langsung tercatat di Portal Guru & Kurikulum (Skor: ${studentResult?.score}, Status: ${studentResult?.status})`,
            `Hasil ujian siswa tidak ditemukan di rekap guru`
        );

        // ====================================================================
        // BAGIAN B: AUDIT SISTEM TUGAS / PR (GURU -> SISWA -> PENILAIAN GURU)
        // ====================================================================
        console.log('\n--- 6. [Tugas/PR - Guru] Buat Tugas Baru & Edit Tugas ---');
        const tomorrowYmd = new Date(Date.now() + 86400000).toISOString();
        const createHwRes = await apiRequest('POST', '/homeworks', guruMapelToken, {
            title: '[AUDIT-E2E] Latihan Soal Persamaan Linear',
            subject: 'Matematika',
            description: 'Kerjakan halaman 45 nomor 1 sampai 5 di buku latihan, lalu foto dan unggah.',
            className: targetClass,
            dueDate: tomorrowYmd
        });
        createdHomeworkId = createHwRes.data?.homework?.id || createHwRes.data?.id;
        assert(
            createHwRes.ok && createdHomeworkId,
            `Guru berhasil membuat Tugas/PR baru (ID: ${createdHomeworkId}) untuk kelas ${targetClass}`,
            `Gagal membuat Tugas/PR: ${JSON.stringify(createHwRes.data)}`
        );

        // Edit Tugas PR oleh Guru
        const updateHwRes = await apiRequest('PUT', `/homeworks/${createdHomeworkId}`, guruMapelToken, {
            title: '[AUDIT-E2E] Latihan Soal Persamaan Linear (Revisi)',
            subject: 'Matematika',
            description: 'Kerjakan halaman 45 nomor 1 sampai 10 beserta cara pengerjaannya.',
            className: targetClass,
            dueDate: tomorrowYmd
        });
        assert(
            updateHwRes.ok && updateHwRes.data?.homework?.title?.includes('(Revisi)'),
            `Guru berhasil mengedit Tugas/PR (PUT /api/homeworks/:id)`,
            `Gagal mengedit Tugas/PR: ${JSON.stringify(updateHwRes.data)}`
        );

        console.log('\n--- 7. [Tugas/PR - Siswa & Guru] Siswa Kumpul Tugas -> Guru Periksa & Beri Nilai ---');
        // Siswa melihat daftar PR
        const studentHwListRes = await apiRequest('GET', '/homeworks', studentToken);
        const studentHwList = Array.isArray(studentHwListRes.data) ? studentHwListRes.data : [];
        const targetHwForStudent = studentHwList.find(h => h.id === createdHomeworkId);
        assert(
            Boolean(targetHwForStudent),
            `Siswa melihat Tugas/PR "${targetHwForStudent?.title}" di daftar tugas kelas ${targetClass}`,
            `Tugas/PR tidak muncul di akun siswa`
        );

        // Siswa mengumpulkan tugas
        const submitHwRes = await apiRequest('POST', '/homeworks/submit', studentToken, {
            homeworkId: createdHomeworkId,
            answerText: 'Berikut jawaban saya: 1) x = 6, 2) x = 10, 3) y = 4.',
            fileUrl: '/uploads/homeworks/sample_jawaban_siswa.pdf'
        });
        assert(
            submitHwRes.ok,
            `Siswa berhasil mengirimkan jawaban & lampiran Tugas/PR`,
            `Gagal mengumpulkan Tugas/PR: ${JSON.stringify(submitHwRes.data)}`
        );

        // Guru melihat daftar submisi siswa
        const subListRes = await apiRequest('GET', `/homeworks/${createdHomeworkId}/submissions`, guruMapelToken);
        const submissions = subListRes.data?.submissions || [];
        const studentSub = submissions.find(s => s.studentId === studentUser.id);
        assert(
            Boolean(studentSub) && studentSub.status === 'SUBMITTED',
            `Guru melihat submisi jawaban siswa (${studentUser.name}) dengan status "${studentSub?.status}"`,
            `Submisi siswa tidak ditemukan di daftar submisi guru: ${JSON.stringify(subListRes.data)}`
        );

        // Guru memberikan nilai & feedback
        const gradeHwRes = await apiRequest('POST', '/homeworks/grade', guruMapelToken, {
            submissionId: studentSub.id,
            score: 95,
            feedback: 'Langkah penyelesaian sangat rapi dan tepat. Pertahankan!'
        });
        assert(
            gradeHwRes.ok && Number(gradeHwRes.data?.submission?.score) === 95,
            `Guru berhasil menilai Tugas/PR siswa (Nilai: 95, Feedback tersimpan)`,
            `Gagal menilai Tugas/PR: ${JSON.stringify(gradeHwRes.data)}`
        );

        // Siswa mengecek nilai PR yang sudah dinilai guru
        const studentHwAfterRes = await apiRequest('GET', '/homeworks', studentToken);
        const updatedHw = (Array.isArray(studentHwAfterRes.data) ? studentHwAfterRes.data : []).find(h => h.id === createdHomeworkId);
        assert(
            updatedHw && updatedHw.submissionStatus === 'GRADED' && Number(updatedHw.score) === 95,
            `Siswa menerima hasil penilaian PR secara realtime (Status: ${updatedHw?.submissionStatus}, Nilai: ${updatedHw?.score}, Feedback: "${updatedHw?.feedback}")`,
            `Status nilai PR di akun siswa belum terupdate: ${JSON.stringify(updatedHw)}`
        );

        // ====================================================================
        // BAGIAN C: AUDIT ULANGAN HARIAN (UH) MANDIRI GURU & PR PILIHAN GANDA AUTO-SCORE
        // ====================================================================
        console.log('\n--- 8. [UH Mandiri & PR Auto-Score] Uji Ulangan Harian Guru & PR Pilihan Ganda ---');
        const createUhRes = await apiRequest('POST', '/guru/exams', guruMapelToken, {
            title: '[AUDIT-E2E] Ulangan Harian Bab 1',
            subject: 'Matematika',
            examType: 'UH',
            assignedClasses: targetClass,
            durationMinutes: 45,
            executionDate: todayYmd,
            startTimeStr: '00:01',
            endTimeStr: '23:59',
            showScoreToStudent: true
        });
        const createdUhId = createUhRes.data?.id || createUhRes.data?.exam?.id;
        assert(
            createUhRes.ok && createdUhId,
            `Guru berhasil membuat Ulangan Harian (UH) mandiri (ID: ${createdUhId})`,
            `Gagal membuat UH mandiri: ${JSON.stringify(createUhRes.data)}`
        );

        if (createdUhId) {
            await apiRequest('POST', '/cbt/toggle-token', guruMapelToken, { examId: createdUhId, isActive: true });
            const uhProctorRes = await apiRequest('GET', '/cbt/proctor-tokens', guruMapelToken);
            const uhVisibleToOwner = (uhProctorRes.data?.exams || []).some(e => e.id === createdUhId);
            const uhNonOwnerRes = await apiRequest('GET', '/cbt/proctor-tokens', guruBiasaToken);
            const uhLeakedToOther = (uhNonOwnerRes.data?.exams || []).some(e => e.id === createdUhId);
            assert(
                uhVisibleToOwner && !uhLeakedToOther,
                `UH mandiri tampil di dashboard guru pembuatnya & terisolasi dari guru lain`,
                `Isolasi UH mandiri gagal (visible=${uhVisibleToOwner}, leaked=${uhLeakedToOther})`
            );
            await prisma.exam.delete({ where: { id: createdUhId } }).catch(() => {});
        }

        // Uji PR Pilihan Ganda dengan Auto-Scoring
        const createMcHwRes = await apiRequest('POST', '/homeworks', guruMapelToken, {
            title: '[AUDIT-E2E] Kuis PR Pilihan Ganda Otomatis',
            subject: 'Matematika',
            className: targetClass,
            type: 'PG',
            deadline: tomorrowYmd,
            questions: [
                { id: '1', questionText: '2 + 3 = ?', type: 'PG', options: { A: '4', B: '5', C: '6', D: '7' }, correctOption: 'B' },
                { id: '2', questionText: '10 / 2 = ?', type: 'PG', options: { A: '5', B: '4', C: '3', D: '2' }, correctOption: 'A' }
            ]
        });
        const mcHwId = createMcHwRes.data?.homework?.id || createMcHwRes.data?.id;
        if (mcHwId) {
            const submitMcRes = await apiRequest('POST', '/homeworks/submit', studentToken, {
                homeworkId: mcHwId,
                answers: { '1': 'B', '2': 'A' }
            });
            assert(
                submitMcRes.ok && Number(submitMcRes.data?.submission?.autoScore) === 100,
                `PR Pilihan Ganda berhasil dinilai otomatis (Auto-Score = ${submitMcRes.data?.submission?.autoScore})`,
                `Auto-score PR Pilihan Ganda gagal: ${JSON.stringify(submitMcRes.data)}`
            );
            await prisma.homeworkSubmission.deleteMany({ where: { homeworkId: mcHwId } }).catch(() => {});
            await prisma.homework.delete({ where: { id: mcHwId } }).catch(() => {});
        }

    } catch (err) {
        console.error('\n❌ ERROR EKSEKUSI AUDIT:', err);
        failed++;
    } finally {
        // 8. CLEANUP DATA UJI AGAR DATABASE TETAP BERSIH
        console.log('\n--- 8. Membersihkan Data Simulasi Uji (Cleanup) ---');
        try {
            if (createdExamId) {
                await prisma.studentExam.deleteMany({ where: { examId: createdExamId } });
                await prisma.question.deleteMany({ where: { examId: createdExamId } });
                await prisma.examProctorAssignment.deleteMany({ where: { examId: createdExamId } }).catch(() => {});
                await prisma.exam.delete({ where: { id: createdExamId } });
                console.log(`  🧹 Data ujian simulasi (${createdExamId}) telah dibersihkan.`);
            }
            if (createdHomeworkId) {
                await prisma.homeworkSubmission.deleteMany({ where: { homeworkId: createdHomeworkId } });
                await prisma.homework.delete({ where: { id: createdHomeworkId } });
                console.log(`  🧹 Data Tugas/PR simulasi (${createdHomeworkId}) telah dibersihkan.`);
            }
        } catch (cleanupErr) {
            console.warn('  ⚠️ Peringatan saat cleanup:', cleanupErr.message);
        }

        console.log('\n====================================================================');
        console.log(`   HASIL AKHIR AUDIT E2E: ${passed} LULUS | ${failed} GAGAL`);
        console.log('====================================================================\n');

        await prisma.$disconnect();
        process.exit(failed > 0 ? 1 : 0);
    }
}

runAudit();
