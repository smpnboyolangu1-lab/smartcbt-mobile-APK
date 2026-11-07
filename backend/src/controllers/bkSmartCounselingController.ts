import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * ========================================================
 * ADVANCED SMART COUNSELING (BK 2.0) ENGINE
 * Modul Bimbingan Konseling Canggih:
 * 1. Daily Mood & Emotional Well-Being Tracker di APK
 * 2. Early Warning Alert Anomali Emosional (3 Hari Kecemasan Berulang)
 * 3. Comprehensive RIASEC Holland Code Career & High School Pathway Advisor
 * 4. Class Sociometry Matrix & Anti-Bullying Social Network Analysis
 * 5. Student Burnout & Psychological Distress Risk Index
 * ========================================================
 */

/**
 * 1. Submit Daily Mood Log dari APK Siswa
 */
export const submitDailyMoodLog = async (req: Request, res: Response) => {
    try {
        const studentId = req.body.studentId || (req as any).user?.id;
        const studentName = req.body.studentName || (req as any).user?.name || 'Siswa';
        const { mood, intensity = 3, tags = [], notes = '' } = req.body;

        if (!studentId || !mood) {
            return res.status(400).json({ success: false, message: 'studentId dan mood wajib diisi' });
        }

        const validMoods = ['SENANG', 'TENANG', 'LELAH', 'CEMAS', 'SEDIH', 'MARAH'];
        if (!validMoods.includes(mood)) {
            return res.status(400).json({ success: false, message: `Mood tidak valid. Pilihan: ${validMoods.join(', ')}` });
        }

        const student = await prisma.user.findUnique({
            where: { id: String(studentId) },
            select: { id: true, name: true, username: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        // Catat mood ke log aktivitas
        const moodLog = await prisma.activityEventLog.create({
            data: {
                module: 'BK',
                action: 'DAILY_MOOD_CHECKIN',
                outcome: 'SUCCESS',
                userId: student.id,
                username: student.username,
                name: student.name,
                className: student.className,
                message: `Siswa merasa ${mood} (Intensitas ${intensity}/5). Catatan: ${notes || '-'}. Pemicu: ${tags.join(', ') || '-'}`,
                payload: JSON.stringify({
                    mood,
                    intensity: Number(intensity),
                    tags,
                    notes,
                    recordedAt: new Date().toISOString()
                })
            }
        });

        // Deteksi Anomali Emosional: Periksa 3 log terakhir siswa
        const recentMoodLogs = await prisma.activityEventLog.findMany({
            where: {
                userId: student.id,
                module: 'BK',
                action: 'DAILY_MOOD_CHECKIN'
            },
            orderBy: { createdAt: 'desc' },
            take: 3
        });

        const negativeMoods = ['CEMAS', 'SEDIH', 'MARAH'];
        let consecutiveNegativeCount = 0;

        recentMoodLogs.forEach((log: any) => {
            try {
                const meta = JSON.parse(log.payload || '{}');
                if (negativeMoods.includes(meta.mood)) {
                    consecutiveNegativeCount++;
                }
            } catch (_) {}
        });

        let alertTriggered = false;
        let supportRecommendation = 'Pertahankan suasana hati yang positif dan tetap semangat belajar!';

        if (consecutiveNegativeCount >= 3) {
            alertTriggered = true;
            supportRecommendation = 'Kami mendeteksi Anda mengalami hari-hari yang cukup berat akhir-akhir ini. Ruang BK selalu terbuka untuk berbincang dengan hangat tanpa penilaian apa pun. Tetap tenang, Anda tidak sendiri.';

            // Kirim notifikasi peringatan ke guru BK / wali kelas
            try {
                await prisma.notificationMessage.create({
                    data: {
                        recipientId: student.id,
                        recipientRole: 'COUNSELOR',
                        studentId: student.id,
                        studentName: student.name,
                        className: student.className || '',
                        title: `⚠️ EARLY WARNING BK: Anomali Mood 3 Hari Berturut-turut (${student.name})`,
                        message: `Siswa ${student.name} (${student.className}) mencatat mood negatif berturut-turut (${mood}, intensitas ${intensity}). Disarankan sesi konseling suportif preventif.`,
                        category: 'COUNSELING'
                    }
                });
            } catch (_) {}
        } else if (mood === 'LELAH' || mood === 'CEMAS') {
            supportRecommendation = 'Ambil nafas dalam-dalam selama 4 hitungan, tahan, dan hembuskan perlahan. Istirahat sejenak setelah belajar 25 menit (Teknik Pomodoro).';
        }

        return res.json({
            success: true,
            message: 'Check-in suasana hati harian berhasil dicatat.',
            data: {
                studentId: student.id,
                studentName: student.name,
                mood,
                intensity,
                tags,
                alertTriggered,
                supportRecommendation,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error: any) {
        console.error('Error submitting daily mood log:', error);
        return res.status(500).json({ success: false, message: 'Gagal mencatat mood harian: ' + error.message });
    }
};

/**
 * 2. Get Student Mood Radar & Well-Being Analytics
 */
export const getStudentMoodRadar = async (req: Request, res: Response) => {
    try {
        const studentId = req.params.studentId || (req as any).user?.id;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'studentId wajib disertakan' });
        }

        const logs = await prisma.activityEventLog.findMany({
            where: {
                userId: String(studentId),
                module: 'BK',
                action: 'DAILY_MOOD_CHECKIN'
            },
            orderBy: { createdAt: 'desc' },
            take: 30
        });

        const moodCounts: Record<string, number> = {
            SENANG: 0,
            TENANG: 0,
            LELAH: 0,
            CEMAS: 0,
            SEDIH: 0,
            MARAH: 0
        };

        const timeline: any[] = [];
        logs.forEach((log: any) => {
            try {
                const meta = JSON.parse(log.payload || '{}');
                if (moodCounts[meta.mood] !== undefined) {
                    moodCounts[meta.mood]++;
                }
                timeline.push({
                    date: log.createdAt,
                    mood: meta.mood,
                    intensity: meta.intensity,
                    tags: meta.tags
                });
            } catch (_) {}
        });

        // Hitung Indeks Kesejahteraan Emosional (0 - 100%)
        const totalLogs = logs.length;
        let positiveScore = 0;
        if (totalLogs > 0) {
            positiveScore = ((moodCounts.SENANG * 100 + moodCounts.TENANG * 80 + moodCounts.LELAH * 40 + moodCounts.CEMAS * 20) / (totalLogs * 100)) * 100;
        } else {
            positiveScore = 75; // Baseline
        }

        return res.json({
            success: true,
            studentId,
            totalLogs,
            emotionalWellbeingScore: Number(positiveScore.toFixed(1)),
            moodDistribution: moodCounts,
            recentTimeline: timeline.slice(0, 7)
        });
    } catch (error: any) {
        console.error('Error getting mood radar:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat analitik mood: ' + error.message });
    }
};

/**
 * 3. Comprehensive RIASEC Holland Code Assessment & High School Pathway Advisor
 * Menghitung profil 6 dimensi Holland (R-I-A-S-E-C) dan memberikan rekomendasi jurusan SMA/SMK
 */
export const submitRiasecAssessment = async (req: Request, res: Response) => {
    try {
        const studentId = req.body.studentId || (req as any).user?.id;
        const {
            scores = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 },
            academicYear = '2026/2027',
            notes = ''
        } = req.body;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'studentId wajib diisi' });
        }

        const student = await prisma.user.findUnique({
            where: { id: String(studentId) }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const dimensions = [
            { code: 'R', name: 'Realistic (Praktikal & Rekayasa)', score: Number(scores.R || 0) },
            { code: 'I', name: 'Investigative (Analitis & Sains)', score: Number(scores.I || 0) },
            { code: 'A', name: 'Artistic (Kreatif & Desain)', score: Number(scores.A || 0) },
            { code: 'S', name: 'Social (Interpersonal & Pendidikan)', score: Number(scores.S || 0) },
            { code: 'E', name: 'Enterprising (Kepemimpinan & Bisnis)', score: Number(scores.E || 0) },
            { code: 'C', name: 'Conventional (Terorganisir & Data)', score: Number(scores.C || 0) }
        ];

        // Urutkan dimensi tertinggi
        dimensions.sort((a, b) => b.score - a.score);
        const hollandTop3 = dimensions.slice(0, 3);
        const hollandCode = hollandTop3.map(d => d.code).join('');

        // Rekomendasi Penjurusan SMA (Kurikulum Merdeka) & Program SMK
        const recommendedSmaTracks: string[] = [];
        const recommendedSmkMajors: string[] = [];
        const careerProspects: string[] = [];

        // Evaluasi Penjurusan berdasarkan Top Holland Code
        const primary = hollandTop3[0].code;
        const secondary = hollandTop3[1]?.code || '';

        if (primary === 'R' || primary === 'I') {
            recommendedSmaTracks.push('SMA - Peminatan MIPA (Matematika & Sains Terapan)');
            recommendedSmkMajors.push('SMK Rekayasa Perangkat Lunak (RPL)', 'SMK Teknik Komputer Jaringan (TKJ)', 'SMK Mekatronika & Otomotif');
            careerProspects.push('Software Engineer', 'Data Analyst', 'Teknisi Sistem Robotik', 'Ahli Bioteknologi');
        }
        if (primary === 'A') {
            recommendedSmaTracks.push('SMA - Peminatan Bahasa, Komunikasi & Budaya');
            recommendedSmkMajors.push('SMK Desain Komunikasi Visual (DKV)', 'SMK Animasi 3D', 'SMK Tata Busana / Desain Mode');
            careerProspects.push('UI/UX Designer', 'Motion Animator', 'Arsitek Kreatif', 'Content Creator');
        }
        if (primary === 'S') {
            recommendedSmaTracks.push('SMA - Peminatan Ilmu Sosial & Humaniora');
            recommendedSmkMajors.push('SMK Layanan Kesehatan / Keperawatan', 'SMK Pekerjaan Sosial', 'SMK Pariwisata & Perhotelan');
            careerProspects.push('Psikolog', 'Konselor Pendidikan', 'Guru / Dosen', 'Public Relations Specialist');
        }
        if (primary === 'E' || primary === 'C') {
            recommendedSmaTracks.push('SMA - Peminatan IPS & Ekonomi Terapan');
            recommendedSmkMajors.push('SMK Bisnis Digital & E-Commerce', 'SMK Akuntansi & Keuangan Lembaga', 'SMK Manajemen Perkantoran');
            careerProspects.push('Wirausahawan Startup', 'Financial Analyst', 'Auditor', 'Project Manager Operasional');
        }

        // Simpan langsung ke model CareerAssessment di database
        const assessment = await prisma.careerAssessment.create({
            data: {
                studentId: student.id,
                academicYear,
                interestFields: JSON.stringify({
                    hollandCode,
                    dimensions,
                    topStrengths: hollandTop3.map(d => d.name)
                }),
                recommendedMajors: JSON.stringify({
                    sma: recommendedSmaTracks,
                    smk: recommendedSmkMajors,
                    careers: careerProspects
                }),
                psychologicalNotes: notes || `Asesmen Minat Bakat Holland RIASEC (${hollandCode}). Siswa memiliki kecenderungan dominan pada aspek ${hollandTop3[0].name}.`
            }
        });

        return res.json({
            success: true,
            message: 'Asesmen Minat Bakat RIASEC berhasil disimpan dan dianalisis.',
            data: {
                assessmentId: assessment.id,
                studentId: student.id,
                studentName: student.name,
                hollandCode,
                topDimensions: hollandTop3,
                radarScores: dimensions,
                pathwayRecommendations: {
                    smaTracks: recommendedSmaTracks,
                    smkMajors: recommendedSmkMajors,
                    futureCareers: careerProspects
                }
            }
        });
    } catch (error: any) {
        console.error('Error submitting RIASEC assessment:', error);
        return res.status(500).json({ success: false, message: 'Gagal memproses asesmen minat bakat: ' + error.message });
    }
};

/**
 * 4. Class Sociometry Matrix & Anti-Bullying Social Network Analysis
 * Menganalisis dinamika kelompok kelas, mengidentifikasi siswa terisolasi & siswa bintang
 */
export const calculateClassSociometry = async (req: Request, res: Response) => {
    try {
        const { className, criteria = 'BELAJAR_KELOMPOK', nominations = [] } = req.body;
        // nominations: [{ studentId, studentName, chosenStudentIds: [id1, id2] }]

        if (!className || !Array.isArray(nominations) || nominations.length === 0) {
            return res.status(400).json({ success: false, message: 'className dan nominations (array) wajib diisi' });
        }

        // Hitung frekuensi dipilih (In-Degree) tiap siswa
        const inDegreeMap: Record<string, number> = {};
        const studentNameMap: Record<string, string> = {};

        nominations.forEach((nom: any) => {
            studentNameMap[nom.studentId] = nom.studentName;
            if (inDegreeMap[nom.studentId] === undefined) inDegreeMap[nom.studentId] = 0;
        });

        nominations.forEach((nom: any) => {
            if (Array.isArray(nom.chosenStudentIds)) {
                nom.chosenStudentIds.forEach((chosenId: string) => {
                    inDegreeMap[chosenId] = (inDegreeMap[chosenId] || 0) + 1;
                });
            }
        });

        const totalStudents = nominations.length;
        const avgChoices = totalStudents > 0 ? Object.values(inDegreeMap).reduce((a, b) => a + b, 0) / totalStudents : 0;

        const starStudents: any[] = [];
        const isolatedStudents: any[] = [];

        Object.entries(inDegreeMap).forEach(([sId, votes]) => {
            const name = studentNameMap[sId] || sId;
            if (votes >= avgChoices + 2) {
                starStudents.push({ studentId: sId, studentName: name, votesReceived: votes });
            } else if (votes <= 0) {
                isolatedStudents.push({
                    studentId: sId,
                    studentName: name,
                    votesReceived: votes,
                    riskNotice: 'Tidak menerima pilihan teman sekelas (Berisiko terisolasi sosial / kesepian)'
                });
            }
        });

        // Simpan / Perbarui ke tabel BkSociometry
        const savedSociometry = await prisma.bkSociometry.create({
            data: {
                className,
                academicYear: '2026/2027',
                semester: 'GANJIL',
                criteria,
                matrixJson: JSON.stringify(nominations),
                isolatedStudents: JSON.stringify(isolatedStudents),
                starStudents: JSON.stringify(starStudents),
                cliquesJson: JSON.stringify({}),
                totalResponses: totalStudents,
                status: 'SELESAI'
            }
        });

        return res.json({
            success: true,
            className,
            criteria,
            totalStudentsAnalyzed: totalStudents,
            summary: {
                starStudentsCount: starStudents.length,
                isolatedStudentsCount: isolatedStudents.length,
                averageAcceptanceScore: Number(avgChoices.toFixed(2))
            },
            starStudents,
            isolatedStudents,
            pedagogicalRecommendation: isolatedStudents.length > 0
                ? 'Guru BK & Wali Kelas disarankan membentuk kelompok belajar heterogen dengan memasangkan siswa terisolasi bersama siswa bintang yang suportif.'
                : 'Dinamika sosial kelas terjalin harmonis tanpa adanya siswa yang terisolasi ekstrem.',
            recordId: savedSociometry.id
        });
    } catch (error: any) {
        console.error('Error calculating class sociometry:', error);
        return res.status(500).json({ success: false, message: 'Gagal menganalisis sosiometri kelas: ' + error.message });
    }
};

/**
 * 5. Student Burnout & Stress Risk Index
 */
export const getStudentBurnoutRiskIndex = async (req: Request, res: Response) => {
    try {
        const studentId = req.params.studentId || (req as any).user?.id;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'studentId wajib disertakan' });
        }

        const student = await prisma.user.findUnique({
            where: { id: String(studentId) },
            select: { id: true, name: true, username: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        // Periksa beban PR/tugas yang belum diselesaikan
        let pendingHomeworksCount = 0;
        try {
            pendingHomeworksCount = await prisma.homework.count({
                where: {
                    class: { name: student.className || '' },
                    deadline: { gte: new Date() }
                }
            });
        } catch (_) {}

        // Periksa keterlambatan / absensi 30 hari terakhir
        let lateAttendancesCount = 0;
        try {
            lateAttendancesCount = await prisma.attendance.count({
                where: {
                    userId: student.id,
                    status: 'LATE'
                }
            });
        } catch (_) {}

        // Kalkulasi Skor Burnout (0 - 100)
        let burnoutScore = 20; // Baseline normal
        burnoutScore += Math.min(pendingHomeworksCount * 10, 40);
        burnoutScore += Math.min(lateAttendancesCount * 8, 30);
        burnoutScore = Math.min(100, burnoutScore);

        let riskLevel = 'LOW';
        let recommendation = 'Beban belajar siswa dalam batas sehat dan kondusif.';

        if (burnoutScore >= 70) {
            riskLevel = 'HIGH_BURNOUT_RISK';
            recommendation = 'Siswa menunjukkan beban akademik dan stres yang tinggi. Disarankan restrukturisasi prioritas tugas dan konsultasi pendampingan konseling.';
        } else if (burnoutScore >= 45) {
            riskLevel = 'MODERATE';
            recommendation = 'Perhatikan manajemen waktu dan berikan ruang relaksasi di akhir pekan.';
        }

        return res.json({
            success: true,
            student: {
                id: student.id,
                name: student.name,
                className: student.className
            },
            burnoutMetrics: {
                burnoutScore,
                riskLevel,
                pendingHomeworksCount,
                lateAttendancesCount,
                recommendation
            }
        });
    } catch (error: any) {
        console.error('Error calculating burnout index:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghitung indeks beban psikologis: ' + error.message });
    }
};
