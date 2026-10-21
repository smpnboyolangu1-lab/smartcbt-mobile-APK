import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * Helper zona waktu WIB (UTC+7)
 */
export const getWibDate = (d = new Date()): Date => {
    return new Date(d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60000);
};

export const getWibTimeStr = (d = new Date()): string => {
    const wib = getWibDate(d);
    const hh = String(wib.getHours()).padStart(2, '0');
    const mm = String(wib.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
};

export const getWibDayName = (d = new Date()): string => {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const wib = getWibDate(d);
    return days[wib.getDay()];
};

/**
 * Helper menggabungkan blok jam berurutan di kelas & mapel yang sama
 * Contoh: JP 1 (07:00-07:45) + JP 2 (07:45-08:30) di IX-A -> "Jam ke-1–2 · 07:00–08:30 WIB · IX A · Bahasa Inggris"
 */
export const mergeConsecutivePeriods = (periods: any[]): any[] => {
    if (!periods || periods.length === 0) return [];

    const sorted = [...periods].sort((a, b) => (a.periodIndex || 0) - (b.periodIndex || 0));
    const merged: any[] = [];
    let currentBlock: any = null;

    for (const p of sorted) {
        if (!currentBlock) {
            currentBlock = {
                id: p.id,
                day: p.day,
                startPeriodIndex: p.periodIndex,
                endPeriodIndex: p.periodIndex,
                periodIndex: p.periodIndex,
                startTime: p.startTime,
                endTime: p.endTime,
                className: p.className,
                subjectName: p.subjectName,
                teacherId: p.teacherId,
                teacherName: p.teacherName,
                roomName: p.roomName || `Ruang Kelas ${p.className}`,
                isBreak: p.isBreak || false,
                subIds: [p.id]
            };
        } else {
            // Cek apakah berurutan, kelas sama, dan mapel sama
            const isConsecutive = p.periodIndex === currentBlock.endPeriodIndex + 1;
            const isSameClass = p.className.trim().toLowerCase() === currentBlock.className.trim().toLowerCase();
            const isSameSubject = p.subjectName.trim().toLowerCase() === currentBlock.subjectName.trim().toLowerCase();
            const isSameTeacher = (!p.teacherId && !currentBlock.teacherId) || (p.teacherId === currentBlock.teacherId);

            if (isConsecutive && isSameClass && isSameSubject && isSameTeacher && !p.isBreak && !currentBlock.isBreak) {
                currentBlock.endPeriodIndex = p.periodIndex;
                currentBlock.endTime = p.endTime;
                currentBlock.subIds.push(p.id);
            } else {
                merged.push(currentBlock);
                currentBlock = {
                    id: p.id,
                    day: p.day,
                    startPeriodIndex: p.periodIndex,
                    endPeriodIndex: p.periodIndex,
                    periodIndex: p.periodIndex,
                    startTime: p.startTime,
                    endTime: p.endTime,
                    className: p.className,
                    subjectName: p.subjectName,
                    teacherId: p.teacherId,
                    teacherName: p.teacherName,
                    roomName: p.roomName || `Ruang Kelas ${p.className}`,
                    isBreak: p.isBreak || false,
                    subIds: [p.id]
                };
            }
        }
    }

    if (currentBlock) {
        merged.push(currentBlock);
    }

    // Format label & tampilan blok
    return merged.map(b => {
        const pLabel = b.startPeriodIndex === b.endPeriodIndex
            ? `Jam ke-${b.startPeriodIndex}`
            : `Jam ke-${b.startPeriodIndex}–${b.endPeriodIndex}`;
        const timeRangeWib = `${b.startTime}–${b.endTime} WIB`;
        const fullTitle = `${pLabel} · ${timeRangeWib} · ${b.className} · ${b.subjectName}`;

        return {
            ...b,
            periodLabel: pLabel,
            timeRange: timeRangeWib,
            fullTitle
        };
    });
};

/**
 * GET /api/schedule/today
 * Mengembalikan jadwal hari ini dengan blok jam berurutan yang sudah digabung
 */
export const getScheduleToday = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const requestedDay = req.query.day ? String(req.query.day).trim() : null;
        const requestedTeacherId = req.query.teacherId ? String(req.query.teacherId).trim() : null;

        const now = new Date();
        const currentWibDay = getWibDayName(now);
        const currentWibTime = getWibTimeStr(now);

        const targetDay = requestedDay || (currentWibDay === 'Minggu' ? 'Senin' : currentWibDay);
        const targetTeacherId = requestedTeacherId || user?.id;

        const whereClause: any = {
            day: { equals: targetDay, mode: 'insensitive' },
            isBreak: false
        };

        if (targetTeacherId) {
            whereClause.OR = [
                { teacherId: targetTeacherId },
                ...(user?.name ? [{ teacherName: { contains: user.name, mode: 'insensitive' } }] : [])
            ];
        }

        const rawSchedules = await (prisma as any).classPeriodSchedule.findMany({
            where: whereClause,
            orderBy: { periodIndex: 'asc' }
        });

        const merged = mergeConsecutivePeriods(rawSchedules);

        // Tandai status ACTIVE, UPCOMING, atau COMPLETED
        const formatted = merged.map(slot => {
            let status = 'UPCOMING';
            if (targetDay.toLowerCase() === currentWibDay.toLowerCase()) {
                if (currentWibTime >= slot.startTime && currentWibTime <= slot.endTime) {
                    status = 'ACTIVE';
                } else if (currentWibTime > slot.endTime) {
                    status = 'COMPLETED';
                }
            }

            return {
                ...slot,
                status
            };
        });

        res.json({
            success: true,
            server_now: now.toISOString(),
            server_time_wib: `${currentWibTime} WIB`,
            day: targetDay,
            totalSlots: formatted.length,
            schedules: formatted
        });
    } catch (err: any) {
        console.error('Error getScheduleToday:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat jadwal hari ini: ' + err.message });
    }
};

/**
 * GET /api/schedule/current
 * Mengembalikan slot jadwal aktif saat ini untuk presensi KBM otomatis
 * Contoh: Pak Sidik pukul 07:00 otomatis IX A, pukul 08:30 otomatis IX B
 */
export const getCurrentScheduleSlot = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Tidak terotentikasi' });
        }

        const now = new Date();
        const currentWibDay = getWibDayName(now);
        const currentWibTime = getWibTimeStr(now);

        // Ambil seluruh jadwal hari ini milik guru
        const rawSchedules = await (prisma as any).classPeriodSchedule.findMany({
            where: {
                day: { equals: currentWibDay, mode: 'insensitive' },
                isBreak: false,
                OR: [
                    { teacherId: user.id },
                    ...(user.name ? [{ teacherName: { contains: user.name, mode: 'insensitive' } }] : [])
                ]
            },
            orderBy: { periodIndex: 'asc' }
        });

        const mergedSlots = mergeConsecutivePeriods(rawSchedules);

        // Helper konversi HH:mm ke menit sejak 00:00
        const toMinutes = (timeStr: string): number => {
            const [h, m] = timeStr.split(':').map(Number);
            return (h * 60) + m;
        };

        const nowMinutes = toMinutes(currentWibTime);

        // Toleransi: Window buka 15 menit sebelum slot mulai, ditutup 15 menit setelah slot selesai
        const TOLERANCE_BEFORE_MINUTES = 15;
        const TOLERANCE_AFTER_MINUTES = 15;

        let activeSlot: any = null;
        let slotState: 'BERLANGSUNG' | 'AKAN_MULAI' | 'MENUNGGU_MASUK' | 'SELESAI' | 'KOSONG' = 'KOSONG';

        for (const slot of mergedSlots) {
            const startMin = toMinutes(slot.startTime);
            const endMin = toMinutes(slot.endTime);
            const windowOpen = startMin - TOLERANCE_BEFORE_MINUTES;
            const windowClose = endMin + TOLERANCE_AFTER_MINUTES;

            if (nowMinutes >= windowOpen && nowMinutes <= windowClose) {
                activeSlot = slot;
                if (nowMinutes < startMin) {
                    slotState = 'AKAN_MULAI';
                } else if (nowMinutes >= startMin && nowMinutes <= (startMin + 10)) {
                    slotState = 'BERLANGSUNG';
                } else if (nowMinutes > (startMin + 10) && nowMinutes <= endMin) {
                    slotState = 'MENUNGGU_MASUK'; // Terlambat jika belum check-in
                } else {
                    slotState = 'SELESAI';
                }
                break;
            }
        }

        // Jika tidak ada slot yang sedang dalam window, cari slot berikutnya (upcoming)
        let nextSlot: any = null;
        if (!activeSlot) {
            nextSlot = mergedSlots.find(s => toMinutes(s.startTime) > nowMinutes) || null;
            if (nextSlot) {
                activeSlot = nextSlot;
                slotState = 'AKAN_MULAI';
            }
        }

        // Cek apakah ada sesi KBM yang sedang aktif di database
        const activeSession = await prisma.teachingSession.findFirst({
            where: {
                teacherId: user.id,
                status: 'IN_PROGRESS'
            },
            include: {
                room: true
            }
        });

        // Hitung window waktu
        let windowOpenAt = '-';
        let windowCloseAt = '-';
        if (activeSlot) {
            const startMin = toMinutes(activeSlot.startTime);
            const endMin = toMinutes(activeSlot.endTime);
            const openH = Math.floor(Math.max(0, startMin - TOLERANCE_BEFORE_MINUTES) / 60);
            const openM = Math.max(0, startMin - TOLERANCE_BEFORE_MINUTES) % 60;
            const closeH = Math.floor((endMin + TOLERANCE_AFTER_MINUTES) / 60);
            const closeM = (endMin + TOLERANCE_AFTER_MINUTES) % 60;
            windowOpenAt = `${String(openH).padStart(2, '0')}:${String(openM).padStart(2, '0')} WIB`;
            windowCloseAt = `${String(closeH).padStart(2, '0')}:${String(closeM).padStart(2, '0')} WIB`;
        }

        res.json({
            success: true,
            server_now: now.toISOString(),
            server_time_wib: `${currentWibTime} WIB`,
            day: currentWibDay,
            state: slotState,
            slot: activeSlot,
            window_open_at: windowOpenAt,
            window_close_at: windowCloseAt,
            active_session: activeSession ? {
                id: activeSession.id,
                className: activeSession.className,
                subjectName: activeSession.subjectName,
                checkInTime: activeSession.checkInTime,
                studentCount: activeSession.studentCount,
                presentCount: activeSession.presentCount,
                status: activeSession.status
            } : null,
            totalSlotsToday: mergedSlots.length
        });
    } catch (err: any) {
        console.error('Error getCurrentScheduleSlot:', err);
        res.status(500).json({ success: false, message: 'Gagal mengecek slot jadwal KBM: ' + err.message });
    }
};

/**
 * GET /api/kurikulum/rekap-presensi-guru
 * Rekap Presensi Keluar Masuk Kelas Guru Bulanan (Menyelesaikan #30)
 * Menggantikan rekap wali kelas di menu Kurikulum
 */
export const getKurikulumTeacherMonthlyAttendance = async (req: Request, res: Response) => {
    try {
        const month = parseInt(req.query.bulan as string, 10) || (new Date().getMonth() + 1);
        const year = parseInt(req.query.tahun as string, 10) || new Date().getFullYear();

        // 1. Ambil seluruh guru aktif
        const teachers = await prisma.user.findMany({
            where: { role: 'TEACHER' },
            select: {
                id: true,
                name: true,
                username: true,
                teachingSubject: true,
                teachingClasses: true
            },
            orderBy: { name: 'asc' }
        });

        // 2. Ambil seluruh sesi KBM di bulan tersebut (Rollup tanpa N+1)
        const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
        const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));

        const sessions = await prisma.teachingSession.findMany({
            where: {
                checkInTime: {
                    gte: startDate,
                    lte: endDate
                }
            },
            select: {
                id: true,
                teacherId: true,
                className: true,
                subjectName: true,
                checkInTime: true,
                checkOutTime: true,
                status: true,
                studentCount: true,
                presentCount: true
            }
        });

        // 3. Ambil jadwal terdaftar per guru
        const allSchedules = await (prisma as any).classPeriodSchedule.findMany({
            where: { isBreak: false }
        });

        // 4. Hitung ringkasan per guru
        const teacherRows = teachers.map(t => {
            const teacherSessions = sessions.filter(s => s.teacherId === t.id);
            const teacherSchedules = allSchedules.filter((s: any) => 
                s.teacherId === t.id || (t.name && s.teacherName && s.teacherName.toLowerCase().includes(t.name.toLowerCase()))
            );

            const totalScheduledPerWeek = teacherSchedules.length;
            const estimatedMonthlySlots = totalScheduledPerWeek * 4; // Estimasi slot terjadwal per bulan

            const totalSesiMasuk = teacherSessions.length;
            const totalSesiSelesaiCheckOut = teacherSessions.filter(s => s.checkOutTime != null).length;
            const totalTidakCheckOut = totalSesiMasuk - totalSesiSelesaiCheckOut;

            // Hitung ketepatan waktu check-in (toleransi masuk <= 10 menit dari mulai)
            let tepatWaktu = 0;
            let terlambat = 0;

            for (const sess of teacherSessions) {
                const sessDate = getWibDate(sess.checkInTime);
                const checkInMinutes = sessDate.getHours() * 60 + sessDate.getMinutes();

                // Cari jadwal yang cocok
                const matchingSched = teacherSchedules.find((s: any) => 
                    s.className.toLowerCase().replace(/[^a-z0-9]/g, '') === sess.className.toLowerCase().replace(/[^a-z0-9]/g, '')
                );

                if (matchingSched) {
                    const [sh, sm] = matchingSched.startTime.split(':').map(Number);
                    const schedStartMin = sh * 60 + sm;
                    if (checkInMinutes <= schedStartMin + 10) {
                        tepatWaktu++;
                    } else {
                        terlambat++;
                    }
                } else {
                    tepatWaktu++;
                }
            }

            const percentage = estimatedMonthlySlots > 0
                ? Math.min(100, Math.round((totalSesiMasuk / estimatedMonthlySlots) * 100))
                : (totalSesiMasuk > 0 ? 100 : 0);

            return {
                teacherId: t.id,
                name: t.name,
                nip: t.username || '-',
                subject: t.teachingSubject || '-',
                teachingClasses: t.teachingClasses || '-',
                totalScheduledWeekly: totalScheduledPerWeek,
                totalScheduledMonthly: estimatedMonthlySlots,
                totalSesiMasuk,
                totalSesiSelesaiCheckOut,
                totalTidakCheckOut,
                tepatWaktu,
                terlambat,
                persentaseKehadiranKbm: percentage,
                statusKetaatan: percentage >= 90 ? '🟢 SANGAT DISIPLIN' : (percentage >= 75 ? '🟡 DISIPLIN' : '🔴 PERLU PEMBINAAN'),
                sessionsPreview: teacherSessions.slice(0, 5).map(s => ({
                    id: s.id,
                    className: s.className,
                    subjectName: s.subjectName,
                    checkIn: s.checkInTime,
                    checkOut: s.checkOutTime || '-',
                    status: s.status
                }))
            };
        });

        // KPI Ringkasan
        const totalGuru = teachers.length;
        const totalSesiSekolah = sessions.length;
        const rataRataDisiplin = teacherRows.length > 0
            ? Math.round(teacherRows.reduce((acc, r) => acc + r.persentaseKehadiranKbm, 0) / teacherRows.length)
            : 0;

        res.json({
            success: true,
            bulan: month,
            tahun: year,
            kpi: {
                totalGuru,
                totalSesiSekolah,
                rataRataDisiplin: `${rataRataDisiplin}%`,
                guruPerluPembinaan: teacherRows.filter(r => r.persentaseKehadiranKbm < 75).length
            },
            teachers: teacherRows
        });
    } catch (err: any) {
        console.error('Error getKurikulumTeacherMonthlyAttendance:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat rekap presensi guru: ' + err.message });
    }
};
