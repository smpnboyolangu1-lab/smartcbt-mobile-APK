import { Request, Response } from 'express';
import prisma from '../utils/db';

// ========================================================
// 1. DASHBOARD BK (MODUL 9-A)
// ========================================================
export const getBkDashboardOverview = async (req: Request, res: Response) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Kasus baru masuk belum ditindaklanjuti
        const newCasesCount = await prisma.bkCaseRecord.count({
            where: { status: 'BARU' }
        });

        // Jadwal konseling hari ini
        const todaySchedules = await prisma.bkCounselingBooking.findMany({
            where: {
                waktu: { gte: todayStart },
                status: 'APPROVED'
            },
            orderBy: { waktu: 'asc' }
        });

        // Chat belum dibalas dari orang tua
        const unreadParentChatsCount = await prisma.bkParentChatMessage.count({
            where: {
                senderRole: 'PARENT',
                statusBaca: false
            }
        });

        // Siswa dengan Skor Risiko KRITIS atau WASPADA dari Early Warning System
        const atRiskStudents = await prisma.bkEarlyWarningPrediction.findMany({
            where: {
                kategoriRisiko: { in: ['KRITIS', 'WASPADA'] }
            },
            orderBy: { skorRisiko: 'desc' },
            take: 10
        });

        const user = (req as any).user;
        let supervisedClasses: string[] = [];
        if (user) {
            const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
            if (dbUser?.teachingClasses) {
                try {
                    if (dbUser.teachingClasses.startsWith('[')) {
                        supervisedClasses = JSON.parse(dbUser.teachingClasses);
                    } else {
                        supervisedClasses = dbUser.teachingClasses.split(',').map((c: string) => c.trim()).filter(Boolean);
                    }
                } catch {
                    supervisedClasses = dbUser.teachingClasses.split(',').map((c: string) => c.trim()).filter(Boolean);
                }
            }
        }
        supervisedClasses = Array.from(new Set(supervisedClasses));
        const totalSupervisedStudents = supervisedClasses.length > 0 ? await prisma.user.count({
            where: { role: 'STUDENT', className: { in: supervisedClasses }, isActive: true }
        }) : 0;

        return res.json({
            success: true,
            summary: {
                newCasesCount,
                todaySchedulesCount: todaySchedules.length,
                unreadParentChatsCount,
                atRiskCount: atRiskStudents.length,
                supervisedClasses,
                totalClasses: supervisedClasses.length,
                totalStudents: totalSupervisedStudents
            },
            todaySchedules,
            atRiskStudents
        });
    } catch (error: any) {
        console.error('Error in getBkDashboardOverview:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 2. KANBAN / CASE MANAGEMENT (MODUL 1-A & 9-B)
// ========================================================
export const getBkCasesList = async (req: Request, res: Response) => {
    try {
        const { status, kategori, urgensi, search } = req.query;
        const userRole = (req as any).user?.role || 'COUNSELOR';

        const whereClause: any = {};
        if (status) whereClause.status = String(status);
        if (kategori) whereClause.kategori = String(kategori);
        if (urgensi) whereClause.urgensi = String(urgensi);

        // Validasi Kerahasiaan Server-Side (Modul 1-A)
        // Data KEPSEK_ONLY hanya untuk ADMIN/KEPSEK. WALI_KELAS hanya bisa melihat UMUM & WALI_KELAS.
        if (userRole === 'TEACHER') {
            whereClause.tingkatKerahasiaan = { in: ['UMUM', 'WALI_KELAS'] };
        } else if (userRole !== 'ADMIN' && userRole !== 'COUNSELOR') {
            whereClause.tingkatKerahasiaan = 'UMUM';
        }

        const cases = await prisma.bkCaseRecord.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' }
        });

        return res.json({ success: true, count: cases.length, data: cases });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const createBkCaseRecord = async (req: Request, res: Response) => {
    try {
        const {
            siswaId,
            kategori,
            urgensi,
            catatanSesi,
            tindakLanjut,
            tingkatKerahasiaan,
            dokumenLampiranUrl,
            counselorId
        } = req.body;

        if (!siswaId || !catatanSesi) {
            return res.status(400).json({ success: false, message: 'siswaId dan catatanSesi wajib diisi' });
        }

        const newCase = await prisma.bkCaseRecord.create({
            data: {
                siswaId,
                kategori: kategori || 'PRIBADI',
                urgensi: urgensi || 'SEDANG',
                catatanSesi,
                tindakLanjut,
                status: 'BARU',
                ditanganiOlehId: counselorId || (req as any).user?.id,
                tingkatKerahasiaan: tingkatKerahasiaan || 'BK_ONLY',
                dokumenLampiranUrl
            }
        });

        // Trigger kalkulasi Early Warning System setelah kasus dicatat
        await recalculateEarlyWarningScore(siswaId);

        return res.json({ success: true, message: 'Kasus BK berhasil dicatat', data: newCase });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const updateBkCaseStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status, tindakLanjut, catatanSesi } = req.body;

        const updated = await prisma.bkCaseRecord.update({
            where: { id: String(id) },
            data: {
                status,
                tindakLanjut,
                catatanSesi: catatanSesi ? catatanSesi : undefined
            }
        });

        return res.json({ success: true, message: 'Status kasus diperbarui', data: updated });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 3. EARLY WARNING SYSTEM (EWS) - MODUL 1-C
// ========================================================
export const recalculateEarlyWarningScore = async (siswaId: string) => {
    try {
        // 1. Hitung Kehadiran dari Absensi Geofencing & Gate In (30 hari terakhir)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const attendances = await prisma.studentGeofenceAttendance.findMany({
            where: {
                siswaId,
                waktuTabServer: { gte: thirtyDaysAgo }
            }
        });

        let attendanceScore = 100;
        if (attendances.length > 0) {
            const hadirCount = attendances.filter(a => a.status === 'HADIR').length;
            attendanceScore = Math.round((hadirCount / attendances.length) * 100);
        }

        // 2. Akumulasi Poin Pelanggaran
        const violations = await prisma.bkViolationPointRecord.findMany({
            where: { siswaId }
        });
        const totalViolationPoints = violations.reduce((sum, v) => sum + (v.bobotPoin || 0), 0);

        // 3. Skor Nilai / Akademik (Rata-rata CBT/Homework jika ada)
        const academicScore = 80.0; // Default baseline

        // Formula Prediktif Early Warning:
        // Bobot: Kehadiran (40%), Poin Pelanggaran (40%), Akademik (20%)
        // Penalti pelanggaran: 1 poin = 0.5% risiko bertambah
        const violationPenalty = Math.min(50, totalViolationPoints * 0.5);
        const attendanceRisk = (100 - attendanceScore) * 0.4;
        const academicRisk = (100 - academicScore) * 0.2;

        const totalRiskScore = Math.min(100, Math.round(violationPenalty + attendanceRisk + academicRisk));

        let riskCategory = 'NORMAL';
        if (totalRiskScore >= 75) {
            riskCategory = 'KRITIS';
        } else if (totalRiskScore >= 50) {
            riskCategory = 'WASPADA';
        } else if (totalRiskScore >= 25) {
            riskCategory = 'PERLU_PERHATIAN';
        }

        const prediction = await prisma.bkEarlyWarningPrediction.upsert({
            where: { siswaId },
            create: {
                siswaId,
                skorRisiko: totalRiskScore,
                kategoriRisiko: riskCategory,
                skorKehadiran: attendanceScore,
                skorAkademik: academicScore,
                totalPoinPelanggaran: totalViolationPoints,
                terakhirDihitung: new Date()
            },
            update: {
                skorRisiko: totalRiskScore,
                kategoriRisiko: riskCategory,
                skorKehadiran: attendanceScore,
                totalPoinPelanggaran: totalViolationPoints,
                terakhirDihitung: new Date()
            }
        });

        return prediction;
    } catch (err) {
        console.error('Error recalculating EWS:', err);
        return null;
    }
};

export const getStudentEarlyWarningDetail = async (req: Request, res: Response) => {
    try {
        const { siswaId } = req.params;
        const prediction = await recalculateEarlyWarningScore(String(siswaId));
        return res.json({ success: true, data: prediction });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 4. JADWAL KONSELING (BOOKING OLEH SISWA/ORTU - MODUL 1-D)
// ========================================================
export const bookCounselingSession = async (req: Request, res: Response) => {
    try {
        const { siswaId, orangTuaId, bkId, waktu, topik } = req.body;

        if (!siswaId || !waktu) {
            return res.status(400).json({ success: false, message: 'siswaId dan waktu wajib diisi' });
        }

        const booking = await prisma.bkCounselingBooking.create({
            data: {
                siswaId,
                orangTuaId,
                bkId,
                waktu: new Date(waktu),
                topik,
                status: 'PENDING'
            }
        });

        return res.json({ success: true, message: 'Jadwal konseling berhasil diajukan', data: booking });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const updateBookingStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'APPROVED' | 'REJECTED' | 'SELESAI'

        const updated = await prisma.bkCounselingBooking.update({
            where: { id: String(id) },
            data: { status }
        });

        return res.json({ success: true, message: `Status booking diubah menjadi ${status}`, data: updated });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
