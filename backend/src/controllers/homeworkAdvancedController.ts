import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * 1. Load Balancing Pengecekan Beban Tugas Siswa (Anti-Bentrok)
 * Rule: Maksimal 3 tugas aktif per kelas per hari
 */
export const checkHomeworkLoadBalance = async (req: Request, res: Response) => {
    try {
        const { classId, date } = req.query;

        if (!classId || !date) {
            return res.status(400).json({ success: false, message: 'classId dan date (YYYY-MM-DD) wajib diisi.' });
        }

        const targetDate = new Date(String(date));
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        // Hitung tugas yang deadline-nya jatuh pada hari yang sama
        const existingCount = await prisma.homework.count({
            where: {
                classId: String(classId),
                deadline: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });

        // Ambil batas konfigurasi dari database jika ada
        const policy = await (prisma as any).homeworkLoadPolicy.findUnique({
            where: { id: 'default' }
        });
        const maxLimit = policy?.maxHomeworksDay || 3;

        const isOverloaded = existingCount >= maxLimit;
        const remainingQuota = Math.max(0, maxLimit - existingCount);

        let statusColor = 'GREEN';
        if (existingCount === maxLimit - 1) statusColor = 'YELLOW';
        else if (existingCount >= maxLimit) statusColor = 'RED';

        res.json({
            success: true,
            classId,
            date,
            existingHomeworksCount: existingCount,
            maxLimit,
            remainingQuota,
            isOverloaded,
            statusColor,
            message: isOverloaded
                ? `⚠️ Peringatan Beban Tugas: Kelas ini sudah memiliki ${existingCount} tugas dengan deadline pada tanggal tersebut (Batas maksimum: ${maxLimit}/hari). Siswa berpotensi kelelahan.`
                : `✅ Jadwal tugas aman: Masih tersedia kuota ${remainingQuota} tugas lagi pada tanggal tersebut.`
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 2. Visual Heatmap Kalender Beban Tugas Kelas (1 Bulan Penuh)
 */
export const getHomeworkHeatmap = async (req: Request, res: Response) => {
    try {
        const { classId, year, month } = req.query;

        if (!classId) {
            return res.status(400).json({ success: false, message: 'classId wajib diisi.' });
        }

        const now = new Date();
        const y = Number(year) || now.getFullYear();
        const m = Number(month) != null ? Number(month) : now.getMonth(); // 0-indexed

        const startOfMonth = new Date(y, m, 1, 0, 0, 0);
        const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59);

        const homeworks = await prisma.homework.findMany({
            where: {
                classId: String(classId),
                deadline: {
                    gte: startOfMonth,
                    lte: endOfMonth
                }
            },
            include: { subject: { select: { name: true } } },
            orderBy: { deadline: 'asc' }
        });

        // Petakan ke format tanggal YYYY-MM-DD
        const mapCount: Record<string, { count: number; items: string[] }> = {};
        for (const hw of homeworks) {
            const dateStr = hw.deadline.toISOString().split('T')[0];
            if (!mapCount[dateStr]) {
                mapCount[dateStr] = { count: 0, items: [] };
            }
            mapCount[dateStr].count++;
            mapCount[dateStr].items.push(`${hw.subject.name}: ${hw.title}`);
        }

        res.json({
            success: true,
            classId,
            year: y,
            month: m,
            totalHomeworks: homeworks.length,
            heatmapData: mapCount
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 3. Tugas Recurring (Berulang Otomatis)
 */
export const createRecurringHomeworkPlan = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { title, subjectId, classId, pattern = 'WEEKLY', intervalDays = 7, publishTime = '07:00', deadlineHours = 24 } = req.body;

        if (!title || !subjectId || !classId) {
            return res.status(400).json({ success: false, message: 'title, subjectId, dan classId wajib diisi.' });
        }

        const nextTrigger = new Date();
        nextTrigger.setDate(nextTrigger.getDate() + Number(intervalDays));

        const plan = await (prisma as any).homeworkRecurringPlan.create({
            data: {
                title: title.trim(),
                subjectId,
                classId,
                teacherId: user.id,
                pattern,
                intervalDays: Number(intervalDays),
                publishTime,
                deadlineHours: Number(deadlineHours),
                nextTriggerAt: nextTrigger
            }
        });

        res.json({ success: true, message: 'Rencana tugas berulang berhasil dibuat.', data: plan });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getRecurringHomeworkPlans = async (req: Request, res: Response) => {
    try {
        const plans = await (prisma as any).homeworkRecurringPlan.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, count: plans.length, data: plans });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 4. Analisis Komprehensif Tugas / PR Sekolah (Setara Analisis CBT)
 */
export const getHomeworkComprehensiveAnalytics = async (req: Request, res: Response) => {
    try {
        const homeworkId = Array.isArray(req.params.homeworkId) ? req.params.homeworkId[0] : (req.params.homeworkId as string);
        if (!homeworkId) {
            return res.status(400).json({ success: false, message: 'homeworkId parameter diperlukan.' });
        }

        const homework: any = await (prisma.homework as any).findUnique({
            where: { id: homeworkId },
            include: {
                subject: true,
                class: true,
                submissions: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                nisn: true,
                                className: true,
                                profilePicUrl: true
                            }
                        }
                    }
                }
            }
        });

        if (!homework) {
            return res.status(404).json({ success: false, message: 'Tugas/PR tidak ditemukan.' });
        }

        // Ambil semua siswa terdaftar di kelas tugas ini
        let targetClassName = homework.class?.name;
        const allStudentsInClass = targetClassName
            ? await prisma.user.findMany({
                where: {
                    role: 'STUDENT',
                    className: targetClassName
                },
                select: {
                    id: true,
                    name: true,
                    username: true,
                    nisn: true,
                    className: true,
                    profilePicUrl: true
                },
                orderBy: { name: 'asc' }
            })
            : [];

        const totalStudents = allStudentsInClass.length > 0 ? allStudentsInClass.length : (homework.submissions?.length || 0);
        const deadlineDate = new Date(homework.deadline);

        // Buat map submission siswa
        const submissionMap = new Map<string, any>();
        (homework.submissions || []).forEach((sub: any) => {
            submissionMap.set(sub.userId, sub);
        });

        let submittedCount = 0;
        let onTimeCount = 0;
        let lateCount = 0;
        let unsubmittedCount = 0;

        let totalScore = 0;
        let gradedCount = 0;
        const scores: number[] = [];

        const distribution = {
            sangatBaik: 0, // 90-100
            baik: 0,       // 80-89
            cukup: 0,      // 70-79
            kurang: 0,     // 60-69
            perluBimbingan: 0 // < 60
        };

        const passingGrade = Number(homework.weight) || 75; // KKM / batas ketuntasan
        let passCount = 0;
        let remedialCount = 0;

        const studentRows: any[] = [];

        // Iterasi siswa
        const studentList: any[] = allStudentsInClass.length > 0
            ? allStudentsInClass
            : (homework.submissions || []).map((s: any) => s.user).filter(Boolean);

        studentList.forEach((student: any) => {
            const sub = submissionMap.get(student.id);
            if (sub) {
                submittedCount++;
                const subDate = new Date(sub.submittedAt || sub.createdAt);
                const isLate = subDate.getTime() > deadlineDate.getTime();
                if (isLate) lateCount++; else onTimeCount++;

                const score = sub.score !== null && sub.score !== undefined ? Number(sub.score) : null;
                if (score !== null) {
                    gradedCount++;
                    totalScore += score;
                    scores.push(score);

                    if (score >= passingGrade) passCount++; else remedialCount++;

                    if (score >= 90) distribution.sangatBaik++;
                    else if (score >= 80) distribution.baik++;
                    else if (score >= 70) distribution.cukup++;
                    else if (score >= 60) distribution.kurang++;
                    else distribution.perluBimbingan++;
                }

                studentRows.push({
                    studentId: student.id,
                    name: student.name,
                    nisn: student.nisn || student.username,
                    className: student.className,
                    status: isLate ? 'TERLAMBAT' : 'TEPAT_WAKTU',
                    statusLabel: isLate ? 'Terlambat Mengumpulkan' : 'Tepat Waktu',
                    submittedAt: sub.submittedAt || sub.createdAt,
                    score: score,
                    isPassed: score !== null ? score >= passingGrade : null,
                    teacherNote: sub.teacherNote || '',
                    fileUrl: sub.fileUrl || null
                });
            } else {
                unsubmittedCount++;
                remedialCount++;
                studentRows.push({
                    studentId: student.id,
                    name: student.name,
                    nisn: student.nisn || student.username,
                    className: student.className,
                    status: 'BELUM_KUMPUL',
                    statusLabel: 'Belum Mengumpulkan',
                    submittedAt: null,
                    score: null,
                    isPassed: false,
                    teacherNote: 'Belum ada bukti penyerahan tugas',
                    fileUrl: null
                });
            }
        });

        // Hitung statistik deskriptif
        scores.sort((a, b) => a - b);
        const mean = gradedCount > 0 ? Number((totalScore / gradedCount).toFixed(1)) : 0;
        const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
        const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;
        
        let median = 0;
        if (scores.length > 0) {
            const mid = Math.floor(scores.length / 2);
            median = scores.length % 2 !== 0 ? scores[mid] : Number(((scores[mid - 1] + scores[mid]) / 2).toFixed(1));
        }

        // Standar Deviasi
        let stdDev = 0;
        if (scores.length > 1) {
            const variance = scores.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (scores.length - 1);
            stdDev = Number(Math.sqrt(variance).toFixed(2));
        }

        const submissionRate = totalStudents > 0 ? Number(((submittedCount / totalStudents) * 100).toFixed(1)) : 0;
        const passRate = gradedCount > 0 ? Number(((passCount / gradedCount) * 100).toFixed(1)) : 0;

        res.json({
            success: true,
            homework: {
                id: homework.id,
                title: homework.title,
                description: homework.description,
                subject: homework.subject?.name || 'Umum',
                className: homework.class?.name || '-',
                deadline: homework.deadline,
                passingGrade: passingGrade
            },
            summary: {
                totalStudents,
                submittedCount,
                unsubmittedCount,
                onTimeCount,
                lateCount,
                gradedCount,
                submissionRate,
                passRate
            },
            statistics: {
                mean,
                median,
                highestScore,
                lowestScore,
                stdDev,
                passCount,
                remedialCount
            },
            distribution,
            students: studentRows
        });
    } catch (e: any) {
        console.error('Error in getHomeworkComprehensiveAnalytics:', e);
        res.status(500).json({ success: false, message: 'Gagal menganalisis tugas: ' + e.message });
    }
};
