import { Request, Response } from 'express';
import prisma from '../utils/db';

// Utility helper untuk tanggal WIB (Asia/Jakarta / UTC+7)
function getWibDateStr(date?: Date): string {
    const d = date || new Date();
    const wib = new Date(d.getTime() + 7 * 3600 * 1000);
    return wib.toISOString().slice(0, 10);
}

function getWibTimeStr(date?: Date): string {
    const d = date || new Date();
    const wib = new Date(d.getTime() + 7 * 3600 * 1000);
    return wib.toISOString().slice(11, 16);
}

/**
 * 1. Ambil seluruh daftar agenda sekolah
 */
export const getAgendas = async (req: Request, res: Response) => {
    try {
        const { date, category, month } = req.query;
        const whereClause: any = {};

        if (date) {
            whereClause.date = String(date);
        } else if (month) {
            whereClause.date = { startsWith: String(month) };
        }

        if (category) {
            whereClause.category = String(category).toUpperCase();
        }

        const agendas = await (prisma as any).schoolAgenda.findMany({
            where: whereClause,
            orderBy: [{ date: 'desc' }, { startTime: 'asc' }]
        });

        res.json({
            success: true,
            total: agendas.length,
            agendas
        });
    } catch (err: any) {
        console.error('[getAgendas Error]', err);
        res.status(500).json({ success: false, message: 'Gagal memuat agenda: ' + err.message });
    }
};

/**
 * 2. Ambil agenda yang aktif hari ini beserta penyesuaian presensi (Gate, Dhuha, dll)
 */
export const getTodayAgendas = async (req: Request, res: Response) => {
    try {
        const todayStr = getWibDateStr();
        const currentTime = getWibTimeStr();

        const agendas = await (prisma as any).schoolAgenda.findMany({
            where: { date: todayStr },
            orderBy: { startTime: 'asc' }
        });

        // Hitung dampak presensi hari ini
        let hasActiveAgenda = agendas.length > 0;
        let extendedGateUntil: string | null = null;
        let suppressAlpaBlast = false;
        let activeDhuhaAgenda = false;

        agendas.forEach((a: any) => {
            if (a.autoExtendGateUntil && (!extendedGateUntil || a.autoExtendGateUntil > extendedGateUntil)) {
                extendedGateUntil = a.autoExtendGateUntil;
            }
            if (a.suppressAlpaBlast) {
                suppressAlpaBlast = true;
            }
            if (a.autoGrantDhuha || a.category === 'KEAGAMAAN') {
                activeDhuhaAgenda = true;
            }
        });

        res.json({
            success: true,
            today: todayStr,
            currentTime,
            hasActiveAgenda,
            extendedGateUntil,
            suppressAlpaBlast,
            activeDhuhaAgenda,
            agendas
        });
    } catch (err: any) {
        console.error('[getTodayAgendas Error]', err);
        res.status(500).json({ success: false, message: 'Gagal memuat agenda hari ini: ' + err.message });
    }
};

/**
 * 3. Tambah Agenda Baru (Operator, Kurikulum, Guru PAI, Admin)
 */
export const createAgenda = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            title,
            description,
            category,
            date,
            startTime,
            endTime,
            targetScope,
            targetClasses,
            autoExtendGateUntil,
            suppressAlpaBlast,
            autoGrantDhuha,
            autoGrantGateIn
        } = req.body;

        if (!title || !date || !category) {
            return res.status(400).json({
                success: false,
                message: 'Judul agenda, tanggal (YYYY-MM-DD), dan kategori wajib diisi!'
            });
        }

        const validCat = ['KEAGAMAAN', 'UPACARA', 'AKADEMIK', 'NON_KBM'].includes(String(category).toUpperCase())
            ? String(category).toUpperCase()
            : 'NON_KBM';

        const agenda = await (prisma as any).schoolAgenda.create({
            data: {
                title: String(title).trim(),
                description: description ? String(description).trim() : null,
                category: validCat,
                date: String(date).trim(),
                startTime: startTime ? String(startTime).trim() : '06:30',
                endTime: endTime ? String(endTime).trim() : '11:30',
                targetScope: targetScope ? String(targetScope).toUpperCase() : 'ALL',
                targetClasses: targetClasses ? String(targetClasses).trim() : null,
                autoExtendGateUntil: autoExtendGateUntil ? String(autoExtendGateUntil).trim() : '10:30',
                suppressAlpaBlast: suppressAlpaBlast !== undefined ? Boolean(suppressAlpaBlast) : true,
                autoGrantDhuha: autoGrantDhuha !== undefined ? Boolean(autoGrantDhuha) : (validCat === 'KEAGAMAAN'),
                autoGrantGateIn: autoGrantGateIn !== undefined ? Boolean(autoGrantGateIn) : true,
                createdBy: user?.name || user?.username || 'PETUGAS',
                creatorRole: user?.role || 'OPERATOR'
            }
        });

        // Audit log
        await prisma.auditLog.create({
            data: {
                action: 'CREATE_SCHOOL_AGENDA',
                userId: user?.id,
                userName: user?.name || user?.username,
                role: user?.role,
                details: JSON.stringify({
                    agendaId: agenda.id,
                    title: agenda.title,
                    date: agenda.date,
                    category: agenda.category,
                    targetScope: agenda.targetScope
                })
            }
        }).catch(() => {});

        res.json({
            success: true,
            message: `✅ Agenda "${agenda.title}" untuk tanggal ${agenda.date} berhasil ditambahkan dan terhubung ke presensi!`,
            agenda
        });
    } catch (err: any) {
        console.error('[createAgenda Error]', err);
        res.status(500).json({ success: false, message: 'Gagal membuat agenda: ' + err.message });
    }
};

/**
 * 4. Update Agenda
 */
export const updateAgenda = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const user = (req as any).user;
        const data = req.body;

        const existing = await (prisma as any).schoolAgenda.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Agenda tidak ditemukan.' });
        }

        const updated = await (prisma as any).schoolAgenda.update({
            where: { id },
            data: {
                title: data.title !== undefined ? String(data.title).trim() : undefined,
                description: data.description !== undefined ? String(data.description).trim() : undefined,
                category: data.category !== undefined ? String(data.category).toUpperCase() : undefined,
                date: data.date !== undefined ? String(data.date).trim() : undefined,
                startTime: data.startTime !== undefined ? String(data.startTime).trim() : undefined,
                endTime: data.endTime !== undefined ? String(data.endTime).trim() : undefined,
                targetScope: data.targetScope !== undefined ? String(data.targetScope).toUpperCase() : undefined,
                targetClasses: data.targetClasses !== undefined ? String(data.targetClasses).trim() : undefined,
                autoExtendGateUntil: data.autoExtendGateUntil !== undefined ? String(data.autoExtendGateUntil).trim() : undefined,
                suppressAlpaBlast: data.suppressAlpaBlast !== undefined ? Boolean(data.suppressAlpaBlast) : undefined,
                autoGrantDhuha: data.autoGrantDhuha !== undefined ? Boolean(data.autoGrantDhuha) : undefined,
                autoGrantGateIn: data.autoGrantGateIn !== undefined ? Boolean(data.autoGrantGateIn) : undefined
            }
        });

        res.json({
            success: true,
            message: `✅ Agenda "${updated.title}" berhasil diperbarui!`,
            agenda: updated
        });
    } catch (err: any) {
        console.error('[updateAgenda Error]', err);
        res.status(500).json({ success: false, message: 'Gagal memperbarui agenda: ' + err.message });
    }
};

/**
 * 5. Hapus Agenda
 */
export const deleteAgenda = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const existing = await (prisma as any).schoolAgenda.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Agenda tidak ditemukan.' });
        }

        await (prisma as any).schoolAgenda.delete({ where: { id } });
        res.json({
            success: true,
            message: `✅ Agenda "${existing.title}" berhasil dihapus.`
        });
    } catch (err: any) {
        console.error('[deleteAgenda Error]', err);
        res.status(500).json({ success: false, message: 'Gagal menghapus agenda: ' + err.message });
    }
};

/**
 * 6. KONFIRMASI 1-TAP HADIR MASSAL (One-Click Mass Attendance Verification)
 * Dijalankan oleh Guru PAI, Kurikulum, atau Operator untuk mengonfirmasi kehadiran
 * seluruh siswa peserta agenda tanpa perlu siswa antre scan satu per satu.
 */
export const verifyMassAttendanceAgenda = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const user = (req as any).user;

        const agenda = await (prisma as any).schoolAgenda.findUnique({ where: { id } });
        if (!agenda) {
            return res.status(404).json({ success: false, message: 'Agenda tidak ditemukan.' });
        }

        // Tentukan daftar siswa yang menjadi sasaran agenda
        let studentWhere: any = { role: 'STUDENT', isActive: true };
        const scope = (agenda.targetScope || 'ALL').toUpperCase();

        if (scope === 'VII' || scope === 'KELAS_VII') {
            studentWhere.className = { startsWith: 'VII' };
        } else if (scope === 'VIII' || scope === 'KELAS_VIII') {
            studentWhere.className = { startsWith: 'VIII' };
        } else if (scope === 'IX' || scope === 'KELAS_IX') {
            studentWhere.className = { startsWith: 'IX' };
        } else if (scope === 'CUSTOM' && agenda.targetClasses) {
            const classList = agenda.targetClasses.split(',').map((c: string) => c.trim());
            studentWhere.className = { in: classList };
        }

        const students = await prisma.user.findMany({
            where: studentWhere,
            select: { id: true, name: true, className: true, gender: true }
        });

        if (students.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Tidak ada data siswa yang cocok dengan target rombel agenda ini.'
            });
        }

        const agendaDateStr = agenda.date;
        const startOfDay = new Date(`${agendaDateStr}T00:00:00.000Z`);
        const endOfDay = new Date(`${agendaDateStr}T23:59:59.999Z`);
        const now = new Date();

        let grantedGateIn = 0;
        let grantedDhuha = 0;

        // 1. Eksekusi Hadir Masuk Sekolah (GATE_IN) jika diaktifkan
        if (agenda.autoGrantGateIn) {
            const existingGateIns = await prisma.attendance.findMany({
                where: {
                    userId: { in: students.map((s: any) => s.id) },
                    type: 'GATE_IN',
                    scanTime: { gte: startOfDay, lte: endOfDay }
                },
                select: { userId: true }
            });
            const recordedIds = new Set(existingGateIns.map((g: any) => g.userId));

            const toCreateGateIn = students
                .filter((s: any) => !recordedIds.has(s.id))
                .map((s: any) => ({
                    userId: s.id,
                    type: 'GATE_IN',
                    method: 'AGENDA_MASS_VERIFIED',
                    status: 'PRESENT',
                    scanTime: now,
                    note: `Hadir resmi kegiatan: ${agenda.title} (Verifikasi: ${user?.name || user?.username || 'Guru/Operator'})`
                }));

            if (toCreateGateIn.length > 0) {
                await prisma.attendance.createMany({ data: toCreateGateIn });
                grantedGateIn = toCreateGateIn.length;
            }
        }

        // 2. Eksekusi Hadir Sholat Dhuha PAI jika diaktifkan
        if (agenda.autoGrantDhuha) {
            const existingPrayers = await (prisma as any).studentPrayerAttendance.findMany({
                where: {
                    studentId: { in: students.map((s: any) => s.id) },
                    date: agendaDateStr,
                    prayerType: 'DHUHA'
                },
                select: { studentId: true }
            });
            const recordedPrayerIds = new Set(existingPrayers.map((p: any) => p.studentId));

            const toCreatePrayers = students
                .filter((s: any) => !recordedPrayerIds.has(s.id))
                .map((s: any) => ({
                    studentId: s.id,
                    studentName: s.name,
                    className: s.className || '-',
                    gender: s.gender || 'L',
                    prayerType: 'DHUHA',
                    date: agendaDateStr,
                    status: 'SHOLAT_BERJAMAAH',
                    method: 'AGENDA_MASS_PAI',
                    recordedById: user?.id || 'PAI_TEACHER',
                    recordedByName: user?.name || user?.username || 'Guru PAI',
                    notes: `Hadir Sholat Dhuha Berjamaah / Kegiatan Keagamaan: ${agenda.title}`
                }));

            if (toCreatePrayers.length > 0) {
                await (prisma as any).studentPrayerAttendance.createMany({ data: toCreatePrayers });
                grantedDhuha = toCreatePrayers.length;
            }
        }

        // 3. Update status agenda menjadi completed
        const updatedAgenda = await (prisma as any).schoolAgenda.update({
            where: { id },
            data: {
                isCompleted: true,
                verifiedAt: now,
                verifiedBy: user?.name || user?.username || 'Guru/Operator',
                verifiedRole: user?.role || 'TEACHER'
            }
        });

        // 4. Audit log
        await prisma.auditLog.create({
            data: {
                action: 'VERIFY_MASS_AGENDA_ATTENDANCE',
                userId: user?.id,
                userName: user?.name || user?.username,
                role: user?.role,
                details: JSON.stringify({
                    agendaId: agenda.id,
                    title: agenda.title,
                    totalTarget: students.length,
                    grantedGateIn,
                    grantedDhuha
                })
            }
        }).catch(() => {});

        res.json({
            success: true,
            message: `🎉 Berhasil! Kehadiran massal untuk ${students.length} siswa pada agenda "${agenda.title}" telah diverifikasi.`,
            stats: {
                totalTargetStudents: students.length,
                newGateInRecorded: grantedGateIn,
                newDhuhaRecorded: grantedDhuha
            },
            agenda: updatedAgenda
        });
    } catch (err: any) {
        console.error('[verifyMassAttendanceAgenda Error]', err);
        res.status(500).json({ success: false, message: 'Gagal memverifikasi presensi massal: ' + err.message });
    }
};
