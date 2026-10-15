import { Request, Response } from 'express';
import prisma from '../utils/db';
import { calculateSawForAllStudents, calculateSawForStudent } from '../services/sawCalculatorService';
import { getBKKelasIds } from '../middlewares/checkBKKelasAccess';
import { logAudit } from '../services/auditLogger';

/**
 * 1. Manajemen Plot Kelas BK (Admin & Portal)
 */
export const getBkPlots = async (req: Request, res: Response) => {
    try {
        const { tahunAjaran = '2026/2027', semester = 'GANJIL' } = req.query;
        const plots = await (prisma as any).bkKelasPlot.findMany({
            where: {
                tahunAjaran: String(tahunAjaran),
                semester: String(semester)
            },
            include: {
                guruBk: { select: { id: true, name: true, username: true } },
                kelas: { select: { id: true, name: true } }
            },
            orderBy: [{ guruBkId: 'asc' }]
        });
        res.json({ success: true, count: plots.length, data: plots });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const assignBkPlot = async (req: Request, res: Response) => {
    try {
        const { guruBkId, kelasId, tahunAjaran = '2026/2027', semester = 'GANJIL' } = req.body;

        if (!guruBkId || !kelasId) {
            return res.status(400).json({ success: false, message: 'guruBkId dan kelasId wajib diisi.' });
        }

        const plot = await (prisma as any).bkKelasPlot.upsert({
            where: {
                guruBkId_kelasId_tahunAjaran_semester: {
                    guruBkId,
                    kelasId,
                    tahunAjaran,
                    semester
                }
            },
            create: {
                guruBkId,
                kelasId,
                tahunAjaran,
                semester,
                isActive: true
            },
            update: {
                isActive: true
            }
        });

        await logAudit(req, 'ASSIGN_BK_PLOT', `GuruBk: ${guruBkId}, Kelas: ${kelasId}`);
        res.json({ success: true, message: 'Plot kelas Guru BK berhasil disimpan.', data: plot });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const deleteBkPlot = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await (prisma as any).bkKelasPlot.delete({ where: { id } });
        res.json({ success: true, message: 'Plot kelas berhasil dihapus.' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 2. Peringkat SAW Siswa Binaan BK & Early Warning
 */
export const getSawRankingList = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { spLevel, search } = req.query;

        let studentFilter: any = { role: 'STUDENT', isActive: true };

        // Jika Guru BK login, hanya tampilkan siswa binaan dari kelas yang diampu
        if (user.role === 'COUNSELOR' || user.isBk) {
            const classIds = await getBKKelasIds(user.id);
            if (classIds.length > 0) {
                studentFilter.classId = { in: classIds };
            }
        }

        const students = await prisma.user.findMany({
            where: studentFilter,
            select: { id: true, name: true, className: true, nisn: true }
        });

        const studentIds = students.map(s => s.id);
        const whereCache: any = { siswaId: { in: studentIds } };
        if (spLevel) whereCache.rekomendasiSp = String(spLevel);

        const rankings = await (prisma as any).bkSawRankingCache.findMany({
            where: whereCache,
            orderBy: [{ totalPoin: 'desc' }, { skorFinalSaw: 'asc' }]
        });

        const studentMap = new Map(students.map(s => [s.id, s]));
        const combined = rankings.map((r: any) => {
            const skor100 = Math.round((r.skorFinalSaw || 0) * 100);
            let statusRisiko = 'AMAN';
            let badgeColor = 'green';
            if (skor100 < 50 || (r.totalPoin || 0) >= 100) {
                statusRisiko = 'KRITIS';
                badgeColor = 'red';
            } else if (skor100 < 70 || (r.totalPoin || 0) >= 50) {
                statusRisiko = 'PERHATIAN_KHUSUS';
                badgeColor = 'amber';
            } else if (skor100 < 85 || (r.totalPoin || 0) >= 20) {
                statusRisiko = 'WASPADA';
                badgeColor = 'yellow';
            }

            return {
                ...r,
                skor100,
                skorSaw100: skor100,
                statusRisiko,
                badgeColor,
                indikator: {
                    disiplin: Math.round((r.skorDisiplin || 0) * 100),
                    tataTertib: Math.round((r.skorTertib || 0) * 100),
                    akademik: Math.round((r.skorAkademik || 0) * 100),
                    karakter: Math.round((r.skorEtika || 0) * 100)
                },
                student: studentMap.get(r.siswaId) || null
            };
        });

        let filtered = combined;
        if (search) {
            const q = String(search).toLowerCase();
            filtered = combined.filter((item: any) =>
                item.student?.name.toLowerCase().includes(q) ||
                item.student?.className.toLowerCase().includes(q)
            );
        }

        res.json({ success: true, count: filtered.length, data: filtered });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const triggerSawRecalculation = async (req: Request, res: Response) => {
    try {
        const count = await calculateSawForAllStudents();
        res.json({ success: true, message: `Kalkulasi ulang SAW berhasil dijalankan untuk ${count} siswa.` });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 3. Konseling Kelompok
 */
export const createKonselingKelompok = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { namaKelompok, tema, tanggal, studentIds, hasil } = req.body;

        if (!namaKelompok || !tema) {
            return res.status(400).json({ success: false, message: 'Nama kelompok dan tema wajib diisi.' });
        }

        const session = await (prisma as any).bkKonselingKelompokSession.create({
            data: {
                guruBkId: user.id,
                namaKelompok: namaKelompok.trim(),
                tema: tema.trim(),
                tanggal: tanggal ? new Date(tanggal) : new Date(),
                hasil: hasil || null
            }
        });

        if (Array.isArray(studentIds) && studentIds.length > 0) {
            for (const sId of studentIds) {
                await (prisma as any).bkKonselingKelompokMember.create({
                    data: { sessionId: session.id, siswaId: sId }
                }).catch(() => {});
            }
        }

        res.json({ success: true, message: 'Sesi konseling kelompok berhasil dibuat.', data: session });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getKonselingKelompokList = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const where: any = {};
        if (user.role === 'COUNSELOR' || user.isBk) {
            where.guruBkId = user.id;
        }

        const sessions = await (prisma as any).bkKonselingKelompokSession.findMany({
            where,
            include: {
                members: true
            },
            orderBy: { tanggal: 'desc' }
        });

        res.json({ success: true, count: sessions.length, data: sessions });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 4. Home Visit
 */
export const createHomeVisit = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { siswaId, tanggal, tujuan, hasil, fotoUrl, tindakLanjut } = req.body;

        if (!siswaId || !tujuan) {
            return res.status(400).json({ success: false, message: 'siswaId dan tujuan kunjungan wajib diisi.' });
        }

        const record = await (prisma as any).bkHomeVisitRecord.create({
            data: {
                siswaId,
                guruBkId: user.id,
                tanggal: tanggal ? new Date(tanggal) : new Date(),
                tujuan: tujuan.trim(),
                hasil: hasil || null,
                fotoUrl: fotoUrl || null,
                tindakLanjut: tindakLanjut || null
            }
        });

        res.json({ success: true, message: 'Log kunjungan rumah berhasil dicatat.', data: record });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const getHomeVisitList = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { siswaId } = req.query;

        const where: any = {};
        if (siswaId) where.siswaId = String(siswaId);
        if (user.role === 'COUNSELOR' || user.isBk) where.guruBkId = user.id;

        const records = await (prisma as any).bkHomeVisitRecord.findMany({
            where,
            orderBy: { tanggal: 'desc' }
        });

        res.json({ success: true, count: records.length, data: records });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 5. Konferensi Kasus & Referral
 */
export const createKonferensiKasus = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { siswaId, tanggal, agenda, notulen, keputusan, tindakLanjut, peserta } = req.body;

        if (!siswaId || !agenda) {
            return res.status(400).json({ success: false, message: 'siswaId dan agenda rapat wajib diisi.' });
        }

        const record = await (prisma as any).bkKonferensiKasusRecord.create({
            data: {
                siswaId,
                guruBkId: user.id,
                tanggal: tanggal ? new Date(tanggal) : new Date(),
                agenda: agenda.trim(),
                notulen: notulen || null,
                keputusan: keputusan || null,
                tindakLanjut: tindakLanjut || null,
                pesertaJson: peserta ? JSON.stringify(peserta) : null
            }
        });

        res.json({ success: true, message: 'Konferensi kasus berhasil disimpan.', data: record });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

export const createReferral = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { siswaId, lembagaTujuan, alasanRujukan, suratUrl } = req.body;

        if (!siswaId || !lembagaTujuan || !alasanRujukan) {
            return res.status(400).json({ success: false, message: 'siswaId, lembagaTujuan, dan alasanRujukan wajib diisi.' });
        }

        const record = await (prisma as any).bkReferralRecord.create({
            data: {
                siswaId,
                guruBkId: user.id,
                lembagaTujuan: lembagaTujuan.trim(),
                alasanRujukan: alasanRujukan.trim(),
                suratUrl: suratUrl || null,
                status: 'DIAJUKAN'
            }
        });

        res.json({ success: true, message: 'Surat rujukan (referral) berhasil diterbitkan.', data: record });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 6. Rekap 360° Siswa Terpadu
 */
export const getStudent360Detail = async (req: Request, res: Response) => {
    try {
        const studentId = String(req.params.studentId);

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true, nisn: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
        }

        const [violations, warnings, gatepasses, sawRanking, homeVisits] = await Promise.all([
            prisma.bkViolationPointRecord.findMany({ where: { siswaId: studentId }, orderBy: { tanggal: 'desc' } }),
            prisma.disciplineWarningLetter.findMany({ where: { userId: studentId }, orderBy: { issuedAt: 'desc' } }),
            prisma.gatepassRequest.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, take: 10 }),
            (prisma as any).bkSawRankingCache.findUnique({ where: { siswaId: studentId } }),
            (prisma as any).bkHomeVisitRecord.findMany({ where: { siswaId: studentId }, orderBy: { tanggal: 'desc' } })
        ]);

        res.json({
            success: true,
            student,
            violations,
            warnings,
            gatepasses,
            sawRanking,
            homeVisits
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * 7. GAP-07: Konfirmasi Tanda Terima Digital Surat Peringatan (SP) oleh Orang Tua
 * Endpoint: POST /api/bk/sp/acknowledge
 */
export const acknowledgeWarningLetter = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { letterId, parentNote, parentSignature } = req.body;

        if (!letterId) {
            return res.status(400).json({ success: false, message: 'ID Surat Peringatan wajib disertakan.' });
        }

        const letter = await (prisma as any).disciplineWarningLetter.findUnique({
            where: { id: letterId },
            include: { user: { select: { id: true, name: true, className: true } } }
        });

        if (!letter) {
            return res.status(404).json({ success: false, message: 'Surat Peringatan tidak ditemukan.' });
        }

        const updated = await (prisma as any).disciplineWarningLetter.update({
            where: { id: letterId },
            data: {
                acknowledgedByParent: true,
                acknowledgedAt: new Date(),
                parentNote: parentNote || null,
                parentSignature: parentSignature || user.name || 'Orang Tua Siswa'
            }
        });

        // Kirim notifikasi ke Guru BK bahwa tanda terima digital telah ditandatangani
        const counselorUsers = await (prisma as any).user.findMany({
            where: { OR: [{ role: 'COUNSELOR' }, { isBk: true }] },
            select: { id: true }
        });

        for (const c of counselorUsers) {
            await (prisma as any).notificationMessage.create({
                data: {
                    recipientId: c.id,
                    recipientRole: 'COUNSELOR',
                    title: `✍️ Tanda Terima Digital SP (${letter.spLevel})`,
                    message: `Orang tua dari ${letter.user?.name} (${letter.user?.className}) telah mengonfirmasi tanda terima ${letter.letterNo}.`,
                    studentId: letter.userId,
                    studentName: letter.user?.name,
                    category: 'BK_SP_ACK'
                }
            });
        }

        await logAudit(req, 'ACKNOWLEDGE_SP', `Letter: ${letter.letterNo}, Parent: ${user.name}`);

        res.json({
            success: true,
            message: 'Tanda terima digital Surat Peringatan berhasil disimpan.',
            data: updated
        });
    } catch (e: any) {
        res.status(500).json({ success: false, message: 'Gagal mengonfirmasi SP: ' + e.message });
    }
};
