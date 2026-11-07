const fs = require('fs');
const path = require('path');

const examPath = path.join(__dirname, '../controllers/examController.ts');
let examContent = fs.readFileSync(examPath, 'utf8');

const targetRes = `        res.json(enrichedExams);
    } catch (error) {`;

const targetResCRLF = targetRes.replace(/\r?\n/g, '\r\n');

const enrichedRes = `        // Sertakan juga Ulangan Harian (UH) yang dibuat guru via APK agar terpantau di Portal CBT
        try {
            const uhWhere = (user && user.role === 'TEACHER')
                ? { OR: [{ guruId: user.id }, { guruName: user.name }] }
                : {};
            const uhList = await (prisma as any).ulanganHarian.findMany({
                where: uhWhere,
                orderBy: { createdAt: 'desc' },
                take: 30
            }).catch(() => []);

            for (const uh of uhList) {
                enrichedExams.push({
                    id: uh.id,
                    title: \`[UH] \${uh.mapelId} — \${uh.topik || 'Ulangan Harian'}\`,
                    packageCode: \`UH-\${uh.mode || 'CBT'}\`,
                    subjectId: '',
                    durationMinutes: uh.durasiMenit || 60,
                    minDurationMinutes: 15,
                    token: 'UH-AUTO',
                    isTokenActive: uh.status === 'AKTIF',
                    status: uh.status === 'AKTIF' ? 'PUBLISHED' : 'DRAFT',
                    assignedClasses: uh.kelasId || 'ALL',
                    sessionName: \`Sesi UH Mode \${uh.mode || 'CBT'}\`,
                    roomName: 'Ruang Kelas',
                    proctorName: uh.guruName || 'Guru Mapel',
                    passingGrade: uh.kkm || 75,
                    level: 'ALL',
                    examType: 'UH',
                    executionDate: uh.waktuMulai ? new Date(uh.waktuMulai).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                    startTimeStr: '07:30',
                    endTimeStr: '15:00',
                    createdAt: uh.createdAt,
                    updatedAt: uh.updatedAt,
                    subject: { id: '', name: uh.mapelId || 'UH' },
                    _count: { questions: uh.totalSoal || 0, studentExams: 0 },
                    classTokens: {},
                    classProctors: {},
                    targetClassesList: (uh.kelasId || 'ALL').split(',').map((s: string) => s.trim())
                } as any);
            }
        } catch (uhErr) {
            console.warn('Error bridging UH to getTeacherExams:', uhErr);
        }

        res.json(enrichedExams);
    } catch (error) {`;

const enrichedResCRLF = enrichedRes.replace(/\r?\n/g, '\r\n');

if (examContent.includes(targetResCRLF)) {
    examContent = examContent.replace(targetResCRLF, enrichedResCRLF);
    fs.writeFileSync(examPath, examContent, 'utf8');
    console.log('examController.ts updated with UH bridge (CRLF)!');
} else if (examContent.includes(targetRes)) {
    examContent = examContent.replace(targetRes, enrichedRes);
    fs.writeFileSync(examPath, examContent, 'utf8');
    console.log('examController.ts updated with UH bridge!');
} else {
    console.warn('targetRes not found in examController.ts');
}
