const fs = require('fs');
const path = require('path');

console.log('--- Applying Comprehensive Backend Updates ---');

// 1. UPDATE homeworkController.ts - Bridge CBT Exams & UH to Student Homework Inbox
const homeworkPath = path.join(__dirname, '../controllers/homeworkController.ts');
let homeworkContent = fs.readFileSync(homeworkPath, 'utf8');

const targetHwSlice = `        const mappedHomeworks = homeworks.map(h => {
            const sub = subMap.get(h.id);
            const hasScore = sub && sub.score !== null && sub.score !== undefined;
            return {
                ...h,
                isSubmitted: !!sub,
                submissionStatus: sub ? (hasScore ? 'GRADED' : 'SUBMITTED') : 'PENDING',
                score: sub ? sub.score : null,
                feedback: sub ? sub.teacherNote : null,
                submission: sub ? {
                    id: sub.id,
                    fileUrl: sub.fileUrl,
                    notes: sub.answers || sub.teacherNote,
                    answers: sub.answers,
                    score: sub.score,
                    autoScore: sub.autoScore,
                    teacherNote: sub.teacherNote,
                    submittedAt: sub.submittedAt
                } : null
            };
        });

        res.json(mappedHomeworks);`;

const targetHwSliceCRLF = targetHwSlice.replace(/\r?\n/g, '\r\n');

const enrichedHwSlice = `        const mappedHomeworks = homeworks.map(h => {
            const sub = subMap.get(h.id);
            const hasScore = sub && sub.score !== null && sub.score !== undefined;
            return {
                ...h,
                isSubmitted: !!sub,
                submissionStatus: sub ? (hasScore ? 'GRADED' : 'SUBMITTED') : 'PENDING',
                score: sub ? sub.score : null,
                feedback: sub ? sub.teacherNote : null,
                submission: sub ? {
                    id: sub.id,
                    fileUrl: sub.fileUrl,
                    notes: sub.answers || sub.teacherNote,
                    answers: sub.answers,
                    score: sub.score,
                    autoScore: sub.autoScore,
                    teacherNote: sub.teacherNote,
                    submittedAt: sub.submittedAt
                } : null
            };
        });

        // Jembatani Ujian CBT Portal & Ulangan Harian (UH) Guru agar langsung muncul di Tab Tugas & Ujian Siswa
        if (user && user.role === 'STUDENT') {
            const studentClass = (user.className || '').trim().toUpperCase();
            const studentLevel = studentClass.startsWith('VII-') ? 'VII' : (studentClass.startsWith('VIII-') ? 'VIII' : (studentClass.startsWith('IX-') ? 'IX' : ''));

            try {
                // 1. Ambil Ujian CBT dari Portal
                const cbtExams = await prisma.exam.findMany({
                    where: {
                        status: { notIn: ['ARCHIVED', 'ARSIP', 'NONAKTIF'] }
                    },
                    include: {
                        subject: true,
                        _count: { select: { questions: true } },
                        studentExams: {
                            where: { userId: user.id }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 25
                });

                for (const ex of cbtExams) {
                    const assignedList = (ex.assignedClasses || 'ALL').toUpperCase().split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
                    const isClassMatch = assignedList.length === 0 || assignedList.includes('ALL') || assignedList.includes('SEMUA KELAS') ||
                        assignedList.includes(studentClass) || (studentLevel && assignedList.includes(studentLevel));

                    if (!isClassMatch) continue;

                    const myExamSub = ex.studentExams && ex.studentExams.length > 0 ? ex.studentExams[0] : null;
                    const isDone = myExamSub && (myExamSub.status === 'SUBMITTED' || myExamSub.status === 'FINISHED' || myExamSub.status === 'COMPLETED');
                    const examDeadline = ex.executionDate
                        ? \`\${ex.executionDate}T\${ex.endTimeStr || '23:59'}:00\`
                        : new Date(Date.now() + 24 * 3600 * 1000).toISOString();

                    mappedHomeworks.push({
                        id: ex.id,
                        title: \`[CBT] \${ex.title}\`,
                        description: \`Asesmen CBT: \${ex.subject?.name || 'Mata Pelajaran'} (\${ex._count?.questions || 0} Butir Soal • \${ex.durationMinutes} Menit). Token: \${ex.isTokenActive ? (ex.token || 'UNBK26') : 'Terkunci / Hubungi Guru'}\`,
                        deadline: examDeadline,
                        subjectId: ex.subjectId || '',
                        classId: ex.assignedClasses || studentClass,
                        teacherId: ex.teacherId || null,
                        type: 'CBT_EXAM',
                        subject: ex.subject ? { id: ex.subject.id, name: ex.subject.name } : { id: '', name: 'CBT' },
                        class: { id: studentClass, name: studentClass },
                        isSubmitted: isDone,
                        submissionStatus: isDone ? (myExamSub?.score !== null ? 'GRADED' : 'SUBMITTED') : 'PENDING',
                        score: myExamSub?.score ?? null,
                        feedback: isDone ? 'Ujian telah diselesaikan di Server CBT.' : null,
                        submission: myExamSub ? {
                            id: myExamSub.id,
                            fileUrl: null,
                            notes: 'Selesai di ExamBrowser Kiosk Mode',
                            answers: null,
                            score: myExamSub.score,
                            autoScore: myExamSub.score,
                            teacherNote: null,
                            submittedAt: myExamSub.endTime || myExamSub.createdAt
                        } : null
                    } as any);
                }

                // 2. Ambil Ulangan Harian (UH) Guru
                const listAllUh = await (prisma as any).ulanganHarian.findMany({
                    include: {
                        submissions: {
                            where: { siswaId: user.id }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 25
                });

                for (const uh of listAllUh) {
                    const assignedList = (uh.kelasId || '').toUpperCase().split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
                    const isClassMatch = assignedList.length === 0 || assignedList.includes('ALL') || assignedList.includes('SEMUA KELAS') ||
                        assignedList.includes(studentClass) || (studentLevel && assignedList.includes(studentLevel));

                    if (!isClassMatch) continue;

                    const myUhSub = uh.submissions && uh.submissions.length > 0 ? uh.submissions[0] : null;
                    const isDone = myUhSub && (myUhSub.status === 'SELESAI' || myUhSub.status === 'SUBMITTED');

                    mappedHomeworks.push({
                        id: uh.id,
                        title: \`[UH] \${uh.mapelId} — \${uh.topik || 'Ulangan Harian'}\`,
                        description: \`Ulangan Harian oleh \${uh.guruName || 'Guru Mapel'} (\${uh.totalSoal || 0} Soal • Durasi \${uh.durasiMenit || 60} Menit).\`,
                        deadline: uh.waktuSelesai ? new Date(uh.waktuSelesai).toISOString() : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                        subjectId: uh.mapelId || '',
                        classId: uh.kelasId || studentClass,
                        teacherId: uh.guruId || null,
                        type: 'ULANGAN_HARIAN',
                        subject: { id: uh.mapelId || '', name: uh.mapelId || 'UH' },
                        class: { id: studentClass, name: studentClass },
                        isSubmitted: isDone,
                        submissionStatus: isDone ? (myUhSub?.nilai !== null ? 'GRADED' : 'SUBMITTED') : 'PENDING',
                        score: myUhSub?.nilai ?? null,
                        feedback: myUhSub?.catatanGuru ?? null,
                        submission: myUhSub ? {
                            id: myUhSub.id,
                            fileUrl: null,
                            notes: 'Selesai Ulangan Harian',
                            answers: null,
                            score: myUhSub.nilai,
                            autoScore: myUhSub.nilai,
                            teacherNote: myUhSub.catatanGuru,
                            submittedAt: myUhSub.updatedAt || myUhSub.createdAt
                        } : null
                    } as any);
                }
            } catch (err) {
                console.warn('Error bridging CBT/UH to homework list:', err);
            }
        }

        res.json(mappedHomeworks);`;

const enrichedHwSliceCRLF = enrichedHwSlice.replace(/\r?\n/g, '\r\n');

if (homeworkContent.includes(targetHwSliceCRLF)) {
    homeworkContent = homeworkContent.replace(targetHwSliceCRLF, enrichedHwSliceCRLF);
    fs.writeFileSync(homeworkPath, homeworkContent, 'utf8');
    console.log('  [x] homeworkController: Bridged Portal CBT Exams & UH to student homeworks (CRLF).');
} else if (homeworkContent.includes(targetHwSlice)) {
    homeworkContent = homeworkContent.replace(targetHwSlice, enrichedHwSlice);
    fs.writeFileSync(homeworkPath, homeworkContent, 'utf8');
    console.log('  [x] homeworkController: Bridged Portal CBT Exams & UH to student homeworks.');
} else {
    console.warn('  [!] homeworkController: targetHwSlice not matched.');
}

// 2. UPDATE cbtController.ts - Relax isExpired for Today's CBT Exams
const cbtPath = path.join(__dirname, '../controllers/cbtController.ts');
let cbtContent = fs.readFileSync(cbtPath, 'utf8');

const oldExpireCheck = `        if (curMinutes > endMinutes) {
            return {
                isReleased: false,
                isTokenRequired: true,
                isExpired: true,
                reason: \`Sesi ujian telah berakhir pada pukul \${exam.endTimeStr || '12:00'} WIB.\`
            };
        }`;

const newExpireCheck = `        // Ujian terjadwal hari ini tetap dapat diakses jika token diaktifkan atau status siap/aktif
        if (curMinutes > endMinutes && !exam.isTokenActive && exam.status !== 'ACTIVE' && exam.status !== 'READY') {
            return {
                isReleased: false,
                isTokenRequired: true,
                isExpired: true,
                reason: \`Sesi ujian telah berakhir pada pukul \${exam.endTimeStr || '12:00'} WIB.\`
            };
        }`;

const oldExpireCRLF = oldExpireCheck.replace(/\r?\n/g, '\r\n');
const newExpireCRLF = newExpireCheck.replace(/\r?\n/g, '\r\n');

if (cbtContent.includes(oldExpireCRLF)) {
    cbtContent = cbtContent.replace(oldExpireCRLF, newExpireCRLF);
    fs.writeFileSync(cbtPath, cbtContent, 'utf8');
    console.log('  [x] cbtController: Token expiration relaxed for today exams with active token/status (CRLF).');
} else if (cbtContent.includes(oldExpireCheck)) {
    cbtContent = cbtContent.replace(oldExpireCheck, newExpireCheck);
    fs.writeFileSync(cbtPath, cbtContent, 'utf8');
    console.log('  [x] cbtController: Token expiration relaxed for today exams with active token/status.');
} else {
    console.warn('  [!] cbtController: oldExpireCheck not matched.');
}

console.log('--- Finished Backend Script ---');
