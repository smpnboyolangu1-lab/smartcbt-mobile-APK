import { Request, Response } from 'express';
import prisma from '../utils/db';
import crypto from 'crypto';

// =========================================================================
// 1. KATALOG & MASTER EKSTRAKURIKULER
// =========================================================================

export const getExtracurricularCatalog = async (req: Request, res: Response) => {
    try {
        const { category, search, grade } = req.query;
        const where: any = { isActive: true };

        if (category && typeof category === 'string' && category !== 'ALL') {
            where.category = category;
        }

        if (search && typeof search === 'string') {
            where.OR = [
                { name: { contains: search } },
                { description: { contains: search } },
                { instructorName: { contains: search } },
                { coachName: { contains: search } }
            ];
        }

        const items = await prisma.extracurricular.findMany({
            where,
            include: {
                _count: {
                    select: {
                        members: true,
                        achievements: true,
                        events: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        // Filter by grade if requested
        let filtered = items;
        if (grade && typeof grade === 'string') {
            filtered = items.filter(e => {
                if (!e.allowedGrades) return true;
                return e.allowedGrades.split(',').map(g => g.trim()).includes(grade);
            });
        }

        return res.json({ success: true, count: filtered.length, data: filtered });
    } catch (err: any) {
        console.error('Error getExtracurricularCatalog:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat katalog: ' + err.message });
    }
};

export const getExtracurricularDetail = async (req: Request, res: Response) => {
    try {
        const idOrSlug = String(req.params.idOrSlug);
        const extra = await prisma.extracurricular.findFirst({
            where: {
                OR: [{ id: idOrSlug }, { slug: idOrSlug }]
            },
            include: {
                curriculums: { orderBy: { sequence: 'asc' } },
                achievements: { orderBy: { date: 'desc' }, take: 10 },
                events: { where: { status: 'OPEN' }, orderBy: { date: 'asc' } },
                announcements: { orderBy: { createdAt: 'desc' }, take: 5 },
                members: {
                    select: {
                        id: true,
                        studentId: true,
                        status: true,
                        developmentLevel: true,
                        registeredAt: true,
                        student: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                nisn: true,
                                className: true,
                                gender: true,
                                profilePicUrl: true
                            }
                        }
                    },
                    orderBy: { student: { name: 'asc' } }
                },
                _count: {
                    select: { members: true }
                }
            }
        });

        if (!extra) {
            return res.status(404).json({ success: false, message: 'Ekstrakurikuler tidak ditemukan' });
        }

        return res.json({ success: true, data: extra });
    } catch (err: any) {
        console.error('Error getExtracurricularDetail:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat detail ekstra: ' + err.message });
    }
};

export const createOrUpdateExtracurricular = async (req: Request, res: Response) => {
    try {
        const {
            id, name, category, logoUrl, bannerUrl, description,
            coachName, instructorName, supervisorId, practiceDay,
            practiceTime, location, quota, allowedGrades,
            registrationStatus, requirements, trainingTarget, isActive
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Nama ekstrakurikuler wajib diisi' });
        }

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        let result;
        if (id) {
            result = await prisma.extracurricular.update({
                where: { id },
                data: {
                    name,
                    slug,
                    category: category || 'OLAHRAGA',
                    logoUrl,
                    bannerUrl,
                    description,
                    coachName,
                    instructorName,
                    supervisorId,
                    practiceDay,
                    practiceTime,
                    location,
                    quota: Number(quota) || 30,
                    allowedGrades: allowedGrades || 'VII,VIII,IX',
                    registrationStatus: registrationStatus || 'OPEN',
                    requirements,
                    trainingTarget,
                    isActive: isActive !== undefined ? Boolean(isActive) : true
                }
            });
        } else {
            result = await prisma.extracurricular.create({
                data: {
                    name,
                    slug,
                    category: category || 'OLAHRAGA',
                    logoUrl,
                    bannerUrl,
                    description,
                    coachName,
                    instructorName,
                    supervisorId,
                    practiceDay,
                    practiceTime,
                    location,
                    quota: Number(quota) || 30,
                    allowedGrades: allowedGrades || 'VII,VIII,IX',
                    registrationStatus: registrationStatus || 'OPEN',
                    requirements,
                    trainingTarget,
                    isActive: isActive !== undefined ? Boolean(isActive) : true
                }
            });
        }

        return res.json({ success: true, message: 'Data ekstrakurikuler berhasil disimpan', data: result });
    } catch (err: any) {
        console.error('Error createOrUpdateExtracurricular:', err);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan ekstra: ' + err.message });
    }
};

// =========================================================================
// 2. PENDAFTARAN & KEANGGOTAAN SISWA
// =========================================================================

export const registerExtracurricular = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const studentId = user?.id || req.body.studentId;
        const { extracurricularIds, academicYear = '2026/2027', notes } = req.body;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Identitas siswa tidak ditemukan' });
        }

        const ids: string[] = Array.isArray(extracurricularIds) ? extracurricularIds : [extracurricularIds];

        if (ids.length === 0) {
            return res.status(400).json({ success: false, message: 'Pilih minimal 1 ekstrakurikuler' });
        }

        // Cek batasan maksimal 2 ekstrakurikuler aktif/mengajukan per tahun ajaran
        const existingMemberships = await prisma.extracurricularMember.findMany({
            where: {
                studentId,
                academicYear,
                status: { in: ['PENDING', 'SELECTION', 'ACCEPTED', 'ACTIVE'] }
            }
        });

        const activeCount = existingMemberships.length;
        if (activeCount + ids.length > 2) {
            return res.status(400).json({
                success: false,
                message: `Batas maksimal pendaftaran adalah 2 ekstrakurikuler. Saat ini Anda sudah memiliki ${activeCount} ekstra.`
            });
        }

        const results = [];
        for (const extraId of ids) {
            // Cek kuota dan status ekstra
            const extra = await prisma.extracurricular.findUnique({
                where: { id: extraId },
                include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } }
            });

            if (!extra || !extra.isActive) {
                continue;
            }

            if (extra.registrationStatus === 'CLOSED') {
                return res.status(400).json({
                    success: false,
                    message: `Pendaftaran untuk ${extra.name} saat ini sedang ditutup.`
                });
            }

            if (extra._count.members >= extra.quota) {
                return res.status(400).json({
                    success: false,
                    message: `Kuota untuk ${extra.name} sudah penuh (${extra.quota} siswa).`
                });
            }

            const initialStatus = extra.registrationStatus === 'SELECTION' ? 'SELECTION' : 'PENDING';

            const member = await prisma.extracurricularMember.upsert({
                where: {
                    extracurricularId_studentId_academicYear: {
                        extracurricularId: extraId,
                        studentId,
                        academicYear
                    }
                },
                update: {
                    status: initialStatus,
                    registeredAt: new Date(),
                    notes
                },
                create: {
                    extracurricularId: extraId,
                    studentId,
                    academicYear,
                    status: initialStatus,
                    notes
                }
            });

            results.push({ name: extra.name, member });
        }

        return res.json({
            success: true,
            message: 'Pendaftaran berhasil dikirim. Menunggu verifikasi pembina.',
            data: results
        });
    } catch (err: any) {
        console.error('Error registerExtracurricular:', err);
        return res.status(500).json({ success: false, message: 'Gagal mendaftar ekstra: ' + err.message });
    }
};

export const cancelRegistration = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const studentId = user?.id || req.body.studentId;
        const { extracurricularId, academicYear = '2026/2027' } = req.body;

        if (!studentId || !extracurricularId) {
            return res.status(400).json({ success: false, message: 'Identitas siswa atau ekstrakurikuler tidak valid' });
        }

        await prisma.extracurricularMember.deleteMany({
            where: {
                studentId,
                extracurricularId,
                academicYear
            }
        });

        return res.json({ success: true, message: 'Pendaftaran ekstrakurikuler berhasil dibatalkan.' });
    } catch (err: any) {
        console.error('Error cancelRegistration:', err);
        return res.status(500).json({ success: false, message: 'Gagal membatalkan pendaftaran: ' + err.message });
    }
};

export const getStudentExtracurricularHistory = async (req: Request, res: Response) => {
    try {
        const studentId = String(req.params.studentId);
        const memberships = await prisma.extracurricularMember.findMany({
            where: { studentId },
            include: {
                extracurricular: true,
                assessments: { orderBy: { assessedAt: 'desc' } },
                _count: {
                    select: { attendances: true }
                }
            },
            orderBy: [{ academicYear: 'desc' }, { registeredAt: 'desc' }]
        });

        // Hitung statistik kehadiran per ekstra
        const enriched = await Promise.all(memberships.map(async (m) => {
            const totalSessions = await prisma.extracurricularAttendanceSession.count({
                where: { extracurricularId: m.extracurricularId }
            });

            const presentCount = await prisma.extracurricularAttendance.count({
                where: {
                    extracurricularId: m.extracurricularId,
                    studentId: m.studentId,
                    status: 'HADIR'
                }
            });

            const attendanceRate = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 100;

            return {
                ...m,
                totalSessions,
                presentCount,
                attendanceRate
            };
        }));

        return res.json({ success: true, studentId, data: enriched });
    } catch (err: any) {
        console.error('Error getStudentExtracurricularHistory:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat riwayat siswa: ' + err.message });
    }
};

// =========================================================================
// 3. SELEKSI & VERIFIKASI OLEH PEMBINA
// =========================================================================

export const verifyMembership = async (req: Request, res: Response) => {
    try {
        const memberId = String(req.params.memberId);
        const { status, notes, developmentLevel } = req.body;
        const verifier = (req as any).user?.name || 'Pembina Ekstrakurikuler';

        if (!['ACCEPTED', 'REJECTED', 'ACTIVE', 'SELECTION', 'INACTIVE', 'ON_LEAVE', 'EXPELLED', 'COMPLETED', 'RESIGNED'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Status tidak valid' });
        }

        const updated: any = await prisma.extracurricularMember.update({
            where: { id: memberId },
            data: {
                status,
                verifiedAt: new Date(),
                verifiedBy: verifier,
                notes: notes ? String(notes) : undefined,
                developmentLevel: developmentLevel || undefined
            },
            include: {
                student: { select: { id: true, name: true, className: true } },
                extracurricular: { select: { id: true, name: true } }
            }
        });

        return res.json({
            success: true,
            message: `Status siswa ${updated.student?.name || 'Siswa'} berhasil diubah menjadi ${status}`,
            data: updated
        });
    } catch (err: any) {
        console.error('Error verifyMembership:', err);
        return res.status(500).json({ success: false, message: 'Gagal memverifikasi keanggotaan: ' + err.message });
    }
};

// =========================================================================
// 4. DASHBOARD PEMBINA EKSTRAKURIKULER
// =========================================================================

export const getCoachDashboard = async (req: Request, res: Response) => {
    try {
        const extracurricularId = String(req.params.extracurricularId);

        const extra = await prisma.extracurricular.findUnique({
            where: { id: extracurricularId },
            include: {
                curriculums: { orderBy: { sequence: 'asc' } }
            }
        });

        if (!extra) {
            return res.status(404).json({ success: false, message: 'Ekstrakurikuler tidak ditemukan' });
        }

        const totalMembers = await prisma.extracurricularMember.count({
            where: { extracurricularId, status: { in: ['ACCEPTED', 'ACTIVE'] } }
        });

        const pendingMembers = await prisma.extracurricularMember.count({
            where: { extracurricularId, status: { in: ['PENDING', 'SELECTION'] } }
        });

        // Hitung kehadiran bulan ini
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const monthlySessions: any[] = await prisma.extracurricularAttendanceSession.findMany({
            where: {
                extracurricularId,
                date: { gte: startOfMonth }
            },
            include: {
                attendances: true
            }
        });

        let hadirCount = 0;
        let tidakHadirCount = 0;
        let izinCount = 0;

        monthlySessions.forEach((s: any) => {
            s.attendances?.forEach((a: any) => {
                if (a.status === 'HADIR') hadirCount++;
                else if (a.status === 'IZIN' || a.status === 'SAKIT') izinCount++;
                else if (a.status === 'ALPA') tidakHadirCount++;
            });
        });

        // Cari siswa yang perlu evaluasi (kehadiran < 75%)
        const allMembers: any[] = await prisma.extracurricularMember.findMany({
            where: { extracurricularId, status: { in: ['ACCEPTED', 'ACTIVE'] } },
            include: {
                student: { select: { id: true, name: true, className: true, username: true } },
                attendances: true
            }
        });

        const totalAllSessions = await prisma.extracurricularAttendanceSession.count({
            where: { extracurricularId }
        });

        const evaluationNeeded: any[] = [];
        allMembers.forEach((m: any) => {
            const attended = m.attendances?.filter((a: any) => a.status === 'HADIR').length || 0;
            const rate = totalAllSessions > 0 ? Math.round((attended / totalAllSessions) * 100) : 100;
            if (rate < 75 && totalAllSessions >= 2) {
                evaluationNeeded.push({
                    memberId: m.id,
                    student: m.student,
                    rate,
                    level: rate < 60 ? 'PEMBINAAN_KRITIS' : 'PERHATIAN'
                });
            }
        });

        const achievementsCount = await prisma.extracurricularAchievement.count({
            where: { extracurricularId }
        });

        const latestAnnouncements = await prisma.extracurricularAnnouncement.findMany({
            where: { extracurricularId },
            orderBy: { createdAt: 'desc' },
            take: 3
        });

        return res.json({
            success: true,
            extracurricular: extra,
            stats: {
                totalMembers,
                pendingMembers,
                hadirBulanIni: hadirCount,
                tidakHadirBulanIni: tidakHadirCount,
                izinBulanIni: izinCount,
                achievementsCount,
                evaluationNeededCount: evaluationNeeded.length
            },
            evaluationNeeded,
            latestAnnouncements
        });
    } catch (err: any) {
        console.error('Error getCoachDashboard:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat dashboard pembina: ' + err.message });
    }
};

// =========================================================================
// 5. SESI PRESENSI & PRESENSI QR / MANUAL
// =========================================================================

export const createAttendanceSession = async (req: Request, res: Response) => {
    try {
        const { extracurricularId, title = 'Latihan Rutin', startTime, endTime, location, coachName } = req.body;

        const qrToken = crypto.randomBytes(8).toString('hex').toUpperCase();

        const session = await prisma.extracurricularAttendanceSession.create({
            data: {
                extracurricularId,
                title,
                startTime,
                endTime,
                location,
                coachName,
                qrToken,
                status: 'OPEN'
            }
        });

        return res.json({
            success: true,
            message: 'Sesi latihan dan presensi berhasil dibuka',
            data: session
        });
    } catch (err: any) {
        console.error('Error createAttendanceSession:', err);
        return res.status(500).json({ success: false, message: 'Gagal membuat sesi latihan: ' + err.message });
    }
};

export const checkInStudentAttendance = async (req: Request, res: Response) => {
    try {
        const { sessionId, qrToken, studentId, status = 'HADIR', notes } = req.body;

        const session = await prisma.extracurricularAttendanceSession.findUnique({
            where: { id: sessionId }
        });

        if (!session || session.status === 'CLOSED') {
            return res.status(400).json({ success: false, message: 'Sesi latihan sudah ditutup atau tidak ditemukan' });
        }

        if (qrToken && session.qrToken && qrToken !== session.qrToken) {
            return res.status(400).json({ success: false, message: 'Token QR Presensi tidak cocok atau sudah kadaluarsa' });
        }

        const member = await prisma.extracurricularMember.findFirst({
            where: {
                extracurricularId: session.extracurricularId,
                studentId,
                status: { in: ['ACCEPTED', 'ACTIVE'] }
            }
        });

        const record = await prisma.extracurricularAttendance.upsert({
            where: {
                sessionId_studentId: {
                    sessionId,
                    studentId
                }
            },
            update: {
                status,
                checkInTime: new Date(),
                notes
            },
            create: {
                sessionId,
                extracurricularId: session.extracurricularId,
                memberId: member?.id || null,
                studentId,
                status,
                notes
            }
        });

        return res.json({
            success: true,
            message: `Presensi siswa berhasil dicatat (${status})`,
            data: record
        });
    } catch (err: any) {
        console.error('Error checkInStudentAttendance:', err);
        return res.status(500).json({ success: false, message: 'Gagal mencatat presensi: ' + err.message });
    }
};

// =========================================================================
// 6. JURNAL KEGIATAN & KURIKULUM PEMBINA
// =========================================================================

export const saveActivityJournal = async (req: Request, res: Response) => {
    try {
        const {
            extracurricularId, material, objectives, activities,
            presentCount, absentCount, evaluation, notes, photoUrl, coachName
        } = req.body;

        if (!material) {
            return res.status(400).json({ success: false, message: 'Materi kegiatan wajib diisi' });
        }

        const journal = await prisma.extracurricularJournal.create({
            data: {
                extracurricularId,
                material,
                objectives,
                activities,
                presentCount: Number(presentCount) || 0,
                absentCount: Number(absentCount) || 0,
                evaluation,
                notes,
                photoUrl,
                coachName
            }
        });

        return res.json({
            success: true,
            message: 'Jurnal latihan pembina berhasil disimpan',
            data: journal
        });
    } catch (err: any) {
        console.error('Error saveActivityJournal:', err);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan jurnal: ' + err.message });
    }
};

export const getCurriculumList = async (req: Request, res: Response) => {
    try {
        const extracurricularId = String(req.params.extracurricularId);
        const list = await prisma.extracurricularCurriculum.findMany({
            where: { extracurricularId },
            orderBy: { sequence: 'asc' }
        });
        return res.json({ success: true, data: list });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const toggleCurriculumStatus = async (req: Request, res: Response) => {
    try {
        const curriculumId = String(req.params.curriculumId);
        const curr = await prisma.extracurricularCurriculum.findUnique({ where: { id: curriculumId } });
        if (!curr) return res.status(404).json({ success: false, message: 'Materi tidak ditemukan' });

        const updated = await prisma.extracurricularCurriculum.update({
            where: { id: curriculumId },
            data: {
                isCompleted: !curr.isCompleted,
                completedAt: !curr.isCompleted ? new Date() : null
            }
        });

        return res.json({ success: true, data: updated });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// =========================================================================
// 7. PENILAIAN PERKEMBANGAN & PORTOFOLIO SISWA
// =========================================================================

export const assessStudentPerformance = async (req: Request, res: Response) => {
    try {
        const { memberId, indicators, notes } = req.body;
        const assessor = (req as any).user?.name || 'Pembina Ekstrakurikuler';

        const member = await prisma.extracurricularMember.findUnique({
            where: { id: memberId },
            include: { extracurricular: true }
        });

        if (!member) {
            return res.status(404).json({ success: false, message: 'Anggota ekstra tidak ditemukan' });
        }

        // Hitung rata-rata nilai indikator
        const parsed = typeof indicators === 'object' ? indicators : JSON.parse(indicators || '{}');
        const scores = Object.values(parsed).map((v: any) => Number(v) || 0);
        const finalScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

        // Tentukan level perkembangan
        let level = 'BERKEMBANG';
        if (finalScore >= 90) level = 'UNGGUL';
        else if (finalScore >= 80) level = 'MAHIR';
        else if (finalScore >= 70) level = 'BAIK';
        else if (finalScore >= 60) level = 'BERKEMBANG';
        else level = 'PEMULA';

        const assessment = await prisma.extracurricularAssessment.create({
            data: {
                extracurricularId: member.extracurricularId,
                memberId: member.id,
                studentId: member.studentId,
                indicators: JSON.stringify(parsed),
                finalScore,
                developmentLevel: level,
                notes,
                assessedBy: assessor
            }
        });

        // Update level pada member
        await prisma.extracurricularMember.update({
            where: { id: member.id },
            data: { developmentLevel: level }
        });

        return res.json({
            success: true,
            message: 'Penilaian perkembangan siswa berhasil disimpan',
            data: assessment
        });
    } catch (err: any) {
        console.error('Error assessStudentPerformance:', err);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan penilaian: ' + err.message });
    }
};

export const getStudentPortfolio = async (req: Request, res: Response) => {
    try {
        const studentId = String(req.params.studentId);

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true, username: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const members = await prisma.extracurricularMember.findMany({
            where: { studentId },
            include: {
                extracurricular: true,
                assessments: { orderBy: { assessedAt: 'desc' } }
            }
        });

        // Cari prestasi siswa
        const achievements = await prisma.extracurricularAchievement.findMany({
            where: {
                OR: [
                    { participantIds: { contains: studentId } },
                    { participantNames: { contains: student.name } }
                ]
            },
            include: { extracurricular: true },
            orderBy: { date: 'desc' }
        });

        return res.json({
            success: true,
            student,
            members,
            achievements
        });
    } catch (err: any) {
        console.error('Error getStudentPortfolio:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat portofolio: ' + err.message });
    }
};

// =========================================================================
// 8. PRESTASI & EVENT EKSTRAKURIKULER
// =========================================================================

export const addAchievement = async (req: Request, res: Response) => {
    try {
        const {
            extracurricularId, competitionName, level = 'KABUPATEN',
            rank = 'JUARA_1', organizer, date, participantIds,
            participantNames, certificateUrl, photoUrl, notes
        } = req.body;

        const achievement = await prisma.extracurricularAchievement.create({
            data: {
                extracurricularId,
                competitionName,
                level,
                rank,
                organizer,
                date: new Date(date || Date.now()),
                participantIds: typeof participantIds === 'object' ? JSON.stringify(participantIds) : participantIds,
                participantNames,
                certificateUrl,
                photoUrl,
                notes
            }
        });

        return res.json({
            success: true,
            message: 'Prestasi berhasil dicatat dan masuk portofolio siswa',
            data: achievement
        });
    } catch (err: any) {
        console.error('Error addAchievement:', err);
        return res.status(500).json({ success: false, message: 'Gagal menambah prestasi: ' + err.message });
    }
};

// =========================================================================
// 9. PENGUMUMAN & KOMUNIKASI PEMBINA
// =========================================================================

export const broadcastAnnouncement = async (req: Request, res: Response) => {
    try {
        const { extracurricularId, title, content, priority = 'NORMAL' } = req.body;
        const author = (req as any).user?.name || 'Pembina Ekstra';

        const announcement = await prisma.extracurricularAnnouncement.create({
            data: {
                extracurricularId,
                title,
                content,
                priority,
                authorName: author
            }
        });

        return res.json({
            success: true,
            message: 'Pengumuman berhasil disiarkan ke seluruh anggota',
            data: announcement
        });
    } catch (err: any) {
        console.error('Error broadcastAnnouncement:', err);
        return res.status(500).json({ success: false, message: 'Gagal membuat pengumuman: ' + err.message });
    }
};

// =========================================================================
// 10. SEED DATA AWAL 11 EKSTRAKURIKULER SMPN 1 BOYOLANGU
// =========================================================================

export const seedDefaultExtracurriculars = async (req: Request, res: Response) => {
    try {
        const defaultEkstras = [
            {
                name: 'Futsal',
                category: 'OLAHRAGA',
                description: 'Pembinaan bakat sepak bola mini dan futsal berprestasi tingkat kabupaten dan provinsi.',
                coachName: 'Coach Andri',
                instructorName: 'Bapak Rudianto, S.Pd.',
                practiceDay: 'Kamis & Sabtu',
                practiceTime: '15:30 - 17:00 WIB',
                location: 'Lapangan Utama SMPN 1 Boyolangu',
                quota: 30,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Kondisi fisik sehat, sepatu futsal, seragam olahraga.',
                trainingTarget: 'Juara 1 Turnamen Futsal Pelajar Tulungagung'
            },
            {
                name: 'Bola Basket',
                category: 'OLAHRAGA',
                description: 'Pengembangan kemampuan fundamental basketball, teamwork, dan kompetisi DBL Junior.',
                coachName: 'Coach Dimas',
                instructorName: 'Bapak Sugeng, S.Pd.',
                practiceDay: 'Rabu & Jumat',
                practiceTime: '15:30 - 17:00 WIB',
                location: 'Lapangan Basket Outdoor',
                quota: 25,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Kebugaran jasmani, sepatu basket.',
                trainingTarget: 'Finalis Liga Bola Basket Pelajar'
            },
            {
                name: 'Bola Voli',
                category: 'OLAHRAGA',
                description: 'Latihan teknik passing, smash, block, dan taktik pertandingan voli antar sekolah.',
                coachName: 'Bpk. Danang Wahyudi, S.Pd.',
                instructorName: 'Ibu Endang, S.Pd.',
                practiceDay: 'Selasa & Kamis',
                practiceTime: '15:30 - 17:00 WIB',
                location: 'Lapangan Voli',
                quota: 25,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Fisik prima, komitmen kehadiran latihan rutin.',
                trainingTarget: 'Juara POPDA Bola Voli'
            },
            {
                name: 'Pramuka (Gudep Spenboy)',
                category: 'KEPEMIMPINAN',
                description: 'Pendidikan karakter, kemandirian, pionering, semaphore, survival, dan kepemimpinan pramuka penggalang.',
                coachName: 'Kak Agus & Kak Fitri',
                instructorName: 'Bapak Santoso, M.Pd.',
                practiceDay: 'Jumat',
                practiceTime: '13:30 - 16:00 WIB',
                location: 'Aula & Halaman Upacara',
                quota: 60,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Seragam Pramuka Lengkap, buku saku penggalang.',
                trainingTarget: 'Lomba Tingkat (LT) III & Jambore'
            },
            {
                name: 'PMR Madya & Kader UKS',
                category: 'KEMANUSIAAN',
                description: 'Pelatihan pertolongan pertama (PP), triase, tandu darurat, donor darah, dan operasional layanan kesehatan UKS.',
                coachName: 'Pembina PMI Cabang',
                instructorName: 'Ibu Nurtikawati, S.Pd.',
                practiceDay: 'Senin & Kamis',
                practiceTime: '14:30 - 16:30 WIB',
                location: 'Ruang UKS & Aula',
                quota: 40,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Rela berkorban, disiplin, peduli sesama.',
                trainingTarget: 'Jumbara PMR Madya & Akreditasi UKS Sekolah Sehat'
            },
            {
                name: 'Paskibra (Bhayangkara)',
                category: 'KEPEMIMPINAN',
                description: 'Pembentukan kedisiplinan baris-berbaris (PBB), formasi pengibaran bendera pusaka, dan etika kedirgantaraan.',
                coachName: 'Pelatih PPI Tulungagung',
                instructorName: 'Bapak Hartono, S.Pd.',
                practiceDay: 'Selasa & Sabtu',
                practiceTime: '15:00 - 17:00 WIB',
                location: 'Lapangan Upacara Utama',
                quota: 35,
                allowedGrades: 'VII,VIII',
                requirements: 'Tinggi badan proporsional, disiplin tinggi.',
                trainingTarget: 'Lomba LKBB Tingkat Provinsi Jawa Timur'
            },
            {
                name: 'Rohis (Remaja Masjid)',
                category: 'KEAGAMAAN',
                description: 'Kajian Islam, tilawah Al-Quran, hadrah, tartil, dan manajemen kegiatan hari besar Islam (PHBI) di Mushola.',
                coachName: 'Ustadz Ahmad',
                instructorName: 'Bapak Fauzi, S.Ag.',
                practiceDay: 'Rabu & Jumat',
                practiceTime: '13:00 - 14:30 WIB',
                location: 'Mushola Nurul Ilmi SMPN 1 Boyolangu',
                quota: 50,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Mampu membaca Al-Quran / Iqra.',
                trainingTarget: 'Juara MTQ & Festival Banjari'
            },
            {
                name: 'Seni Tari Tradisional',
                category: 'SENI',
                description: 'Pelestarian tari tradisional khas Jawa Timur, kreasi baru nusantara, dan pementasan seni budaya.',
                coachName: 'Ibu Sekar, S.Sn.',
                instructorName: 'Ibu Sri Rahayu, S.Pd.',
                practiceDay: 'Rabu & Sabtu',
                practiceTime: '14:00 - 16:00 WIB',
                location: 'Sanggar Seni Tari Sekolah',
                quota: 25,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Kelenturan gerak, minat seni budaya tinggi.',
                trainingTarget: 'Pentas Seni Daerah & FLS2N Seni Tari'
            },
            {
                name: 'Paduan Suara (Spenboy Choir)',
                category: 'SENI',
                description: 'Teknik olah vokal, resonansi, ritme paduan suara sopran, alto, tenor, bass, dan lagu wajib upacara resmi.',
                coachName: 'Bapak Daniel, S.Pd.',
                instructorName: 'Ibu Retno, M.Pd.',
                practiceDay: 'Senin & Kamis',
                practiceTime: '14:30 - 16:00 WIB',
                location: 'Ruang Musik Sekolah',
                quota: 35,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Audisi uji warna vokal dan kepekaan nada.',
                trainingTarget: 'Juara FLS2N Paduan Suara & Paduan Upacara HUT RI'
            },
            {
                name: 'English Club',
                category: 'AKADEMIK',
                description: 'Peningkatan kemampuan komunikasi bahasa Inggris melalui story telling, speech contest, debate, dan fun games.',
                coachName: 'Ms. Clara',
                instructorName: 'Ibu Nurul, S.Pd.',
                practiceDay: 'Selasa',
                practiceTime: '14:30 - 16:00 WIB',
                location: 'Lab Bahasa',
                quota: 30,
                allowedGrades: 'VII,VIII,IX',
                requirements: 'Keinginan kuat berlatih berbicara bahasa Inggris aktif.',
                trainingTarget: 'Juara English Speech Contest se-Karesidenan'
            },
            {
                name: 'KIR (Kelompok Ilmiah Remaja)',
                category: 'AKADEMIK',
                description: 'Riset sains, eksperimen inovatif, penulisan karya tulis ilmiah, dan kompetisi peneliti muda nasional.',
                coachName: 'Bapak Tri, M.Si.',
                instructorName: 'Ibu Dwi Astuti, S.Pd.',
                practiceDay: 'Rabu',
                practiceTime: '14:30 - 16:00 WIB',
                location: 'Laboratorium IPA & Komputer',
                quota: 25,
                allowedGrades: 'VII,VIII',
                requirements: 'Rasa ingin tahu tinggi dan gemar membaca ilmiah.',
                trainingTarget: 'Finalis OPSI / Lomba Peneliti Belia Nasional'
            }
        ];

        let createdCount = 0;
        for (const e of defaultEkstras) {
            const slug = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const existing = await prisma.extracurricular.findFirst({
                where: { OR: [{ name: e.name }, { slug }] }
            });

            if (!existing) {
                await prisma.extracurricular.create({
                    data: {
                        name: e.name,
                        slug,
                        category: e.category,
                        description: e.description,
                        coachName: e.coachName,
                        instructorName: e.instructorName,
                        practiceDay: e.practiceDay,
                        practiceTime: e.practiceTime,
                        location: e.location,
                        quota: e.quota,
                        allowedGrades: e.allowedGrades,
                        requirements: e.requirements,
                        trainingTarget: e.trainingTarget
                    }
                });
                createdCount++;
            }
        }

        return res.json({
            success: true,
            message: `Berhasil inisialisasi master ekstrakurikuler (${createdCount} baru ditambahkan)`,
            total: defaultEkstras.length
        });
    } catch (err: any) {
        console.error('Error seedDefaultExtracurriculars:', err);
        return res.status(500).json({ success: false, message: 'Gagal inisialisasi ekstra: ' + err.message });
    }
};
