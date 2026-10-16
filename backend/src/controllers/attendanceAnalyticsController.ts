import { Request, Response } from 'express';
import prisma from '../utils/db';
import { getWibDayBounds } from '../utils/dateUtils';

const BUILTIN_NATIONAL_HOLIDAYS: Record<string, string> = {
    '2026-01-01': 'Tahun Baru 2026 Masehi',
    '2026-01-16': 'Isra Mikraj Nabi Muhammad SAW',
    '2026-02-17': 'Tahun Baru Imlek 2577 Kongzili',
    '2026-03-19': 'Hari Suci Nyepi',
    '2026-03-20': 'Hari Raya Idul Fitri 1447 H',
    '2026-03-21': 'Hari Raya Idul Fitri 1447 H (Hari Kedua)',
    '2026-04-03': 'Wafat Yesus Kristus',
    '2026-04-05': 'Hari Paskah',
    '2026-05-01': 'Hari Buruh Internasional',
    '2026-05-14': 'Kenaikan Yesus Kristus',
    '2026-05-27': 'Hari Raya Idul Adha 1447 H',
    '2026-05-31': 'Hari Raya Waisak 2570 BE',
    '2026-06-01': 'Hari Lahir Pancasila',
    '2026-06-16': 'Tahun Baru Islam 1448 H',
    '2026-08-17': 'HUT RI Ke-81',
    '2026-08-25': 'Maulid Nabi Muhammad SAW',
    '2026-12-25': 'Hari Raya Natal'
};

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function toWibDateStr(date: Date | string): string {
    try {
        const d = new Date(date);
        return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    } catch {
        const d = new Date(date);
        return d.toISOString().split('T')[0];
    }
}

function toTimeMinutes(d: Date | string | null | undefined): number | null {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.getHours() * 60 + dt.getMinutes();
}

function formatMinutesToHHMM(totalMin: number | null): string {
    if (totalMin === null || isNaN(totalMin) || totalMin <= 0) return '-';
    const h = Math.floor(totalMin / 60) % 24;
    const m = Math.round(totalMin % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTimeHHMM(d: Date | string | null | undefined): string {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '-';
    return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function computeSpStatus(points: number): string {
    if (points >= 50) return 'SP3';
    if (points >= 30) return 'SP2';
    if (points >= 15) return 'SP1';
    if (points > 0) return 'PEMBINAAN';
    return 'AMAN';
}

interface DailyAggregatedRecord {
    dateStr: string;
    dateObj: Date;
    status: string;
    checkInTime: Date | null;
    checkOutTime: Date | null;
}

function normalizeAttStatus(raw: string | null | undefined): string {
    const s = String(raw || 'HADIR').toUpperCase();
    if (s === 'SICK' || s === 'SAKIT') return 'SAKIT';
    if (s === 'PERMISSION' || s === 'IZIN') return 'IZIN';
    if (s === 'LATE' || s === 'TERLAMBAT') return 'TERLAMBAT';
    if (s === 'ABSENT' || s === 'ALPA' || s === 'ALPHA') return 'ALPA';
    return 'HADIR';
}

function aggregateByStudentDay(records: Array<{ userId: string; type: string; status: string; scanTime: Date }>): Map<string, DailyAggregatedRecord> {
    const byDate = new Map<string, Array<{ userId: string; type: string; status: string; scanTime: Date }>>();
    for (const r of records) {
        const ds = toWibDateStr(r.scanTime);
        if (!byDate.has(ds)) byDate.set(ds, []);
        byDate.get(ds)!.push(r);
    }

    const result = new Map<string, DailyAggregatedRecord>();
    for (const [dateStr, dayRecs] of byDate.entries()) {
        const inRec = dayRecs.find(x => x.type === 'GATE_IN') || dayRecs[0];
        const outRec = dayRecs.find(x => x.type === 'GATE_OUT');
        const rawStatus = normalizeAttStatus(inRec?.status);
        result.set(dateStr, {
            dateStr,
            dateObj: new Date(dateStr + 'T12:00:00Z'),
            status: rawStatus,
            checkInTime: inRec ? new Date(inRec.scanTime) : null,
            checkOutTime: outRec ? new Date(outRec.scanTime) : null
        });
    }
    return result;
}

/**
 * GET /api/student/attendance-analytics
 * Deep real-time attendance analytics & multi-period trends for Student, Parent, Teacher, Counselor, Admin
 */
export const getStudentAttendanceAnalytics = async (req: Request, res: Response) => {
    try {
        const authUser = (req as any).user;
        let targetUserId: string | undefined = req.query.studentId
            ? String(req.query.studentId)
            : (req.query.userId ? String(req.query.userId) : (authUser?.id || authUser?.userId));

        if (authUser?.role === 'PARENT' && !req.query.studentId && !req.query.userId) {
            const cleanNisn = String(authUser.username || '').replace(/^[Pp]/, '').trim();
            const child = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { nisn: cleanNisn },
                        { username: cleanNisn },
                        { parentPhone: authUser.username },
                        { fatherName: authUser.name },
                        { motherName: authUser.name }
                    ]
                },
                select: { id: true }
            });
            if (child) {
                targetUserId = child.id;
            }
        }

        if (!targetUserId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const student = await prisma.user.findUnique({
            where: { id: String(targetUserId) },
            select: {
                id: true,
                name: true,
                username: true,
                nisn: true,
                className: true,
                points: true
            }
        });

        if (!student) {
            return res.status(404).json({ message: 'Siswa tidak ditemukan' });
        }

        const studentPoints = student.points ?? 0;
        const studentSpStatus = computeSpStatus(studentPoints);

        const now = new Date();
        const selectedMonth = req.query.month ? Number(req.query.month) : (now.getMonth() + 1);
        const selectedYear = req.query.year ? Number(req.query.year) : now.getFullYear();

        // Load custom school holidays
        const customHolidays = await prisma.schoolHoliday.findMany().catch(() => []);
        const holidayMap: Record<string, string> = { ...BUILTIN_NATIONAL_HOLIDAYS };
        for (const h of customHolidays) {
            if (h.date) holidayMap[h.date] = h.name || 'Libur Sekolah';
        }

        // Load gate settings for standard entry time (default 07:00 = 420 mins)
        const gateSetting = await (prisma as any).gateAttendanceSetting?.findFirst().catch(() => null);
        const gateInEndStr = gateSetting?.gateInEnd || '07:00';
        const [gateHour, gateMin] = String(gateInEndStr).split(':').map((x: string) => Number(x) || 0);
        const gateDeadlineMinutes = (gateHour || 7) * 60 + (gateMin || 0);

        // Date window: 6 months back from end of selected month
        const sixMonthsStart = new Date(selectedYear, selectedMonth - 6, 1, 0, 0, 0);
        const selectedMonthStart = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0);
        const selectedMonthEnd = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);
        const queryEnd = selectedMonthEnd > now ? now : selectedMonthEnd;

        // 1. Fetch all Gate Attendance for this student in the 6-month window
        const rawAttendances = await prisma.attendance.findMany({
            where: {
                userId: student.id,
                scanTime: { gte: sixMonthsStart, lte: selectedMonthEnd }
            },
            orderBy: { scanTime: 'asc' }
        });

        const dailyMap = aggregateByStudentDay(rawAttendances);
        const allDailyRecords = Array.from(dailyMap.values()).sort((a, b) => a.dateStr.localeCompare(b.dateStr));

        // 2. Compute Current Month Summary & Punctuality Metrics
        const monthPrefix = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
        const monthDailyRecords = allDailyRecords.filter(r => r.dateStr.startsWith(monthPrefix));

        let hadirCount = 0;
        let terlambatCount = 0;
        let izinCount = 0;
        let sakitCount = 0;
        let alpaCount = 0;

        const checkInMinutesList: number[] = [];
        let totalLateMinutes = 0;
        const bucketBefore645 = { label: '< 06:45', count: 0 };
        const bucket645To700 = { label: '06:45-07:00', count: 0 };
        const bucket701To715 = { label: '07:01-07:15', count: 0 };
        const bucketAfter715 = { label: '> 07:15', count: 0 };

        for (const rec of monthDailyRecords) {
            const st = rec.status;
            if (st === 'HADIR') hadirCount++;
            else if (st === 'TERLAMBAT') {
                hadirCount++;
                terlambatCount++;
            } else if (st === 'IZIN') izinCount++;
            else if (st === 'SAKIT') sakitCount++;
            else if (st === 'ALPA' || st === 'ALPHA') alpaCount++;

            if (rec.checkInTime && (st === 'HADIR' || st === 'TERLAMBAT')) {
                const mins = toTimeMinutes(rec.checkInTime);
                if (mins !== null && mins > 0) {
                    checkInMinutesList.push(mins);
                    if (mins > gateDeadlineMinutes) {
                        totalLateMinutes += (mins - gateDeadlineMinutes);
                    }
                    if (mins < 6 * 60 + 45) bucketBefore645.count++;
                    else if (mins <= 7 * 60) bucket645To700.count++;
                    else if (mins <= 7 * 60 + 15) bucket701To715.count++;
                    else bucketAfter715.count++;
                }
            }
        }

        // Count effective school days elapsed in selected month
        let effectiveSchoolDaysInMonth = 0;
        const cursorMonth = new Date(selectedMonthStart);
        const limitDate = selectedMonthEnd < now ? selectedMonthEnd : now;
        while (cursorMonth <= limitDate) {
            const ds = toWibDateStr(cursorMonth);
            const dayOfWeek = cursorMonth.getDay();
            if (dayOfWeek !== 0 && !holidayMap[ds]) {
                effectiveSchoolDaysInMonth++;
            }
            cursorMonth.setDate(cursorMonth.getDate() + 1);
        }

        const totalRecordedInMonth = hadirCount + izinCount + sakitCount + alpaCount;
        const effectiveDenominator = Math.max(totalRecordedInMonth, effectiveSchoolDaysInMonth, 1);
        const attendanceRate = totalRecordedInMonth > 0
            ? Math.min(100, Math.round((hadirCount / Math.max(totalRecordedInMonth, 1)) * 100))
            : 0;
        const onTimeCount = Math.max(0, hadirCount - terlambatCount);
        const punctualityRate = hadirCount > 0 ? Math.round((onTimeCount / hadirCount) * 100) : 100;

        // Weighted Composite Discipline Score (0..100)
        // 55% Gate Attendance Rate + 25% Punctuality Rate + 20% BK Discipline Health
        const bkPenalty = Math.min(100, Math.max(0, studentPoints * 2));
        const bkHealthScore = Math.max(0, 100 - bkPenalty);
        const disciplineScore = totalRecordedInMonth > 0
            ? Math.round((attendanceRate * 0.55) + (punctualityRate * 0.25) + (bkHealthScore * 0.20))
            : Math.round((100 * 0.80) + (bkHealthScore * 0.20));

        const avgCheckInMin = checkInMinutesList.length > 0
            ? Math.round(checkInMinutesList.reduce((a, b) => a + b, 0) / checkInMinutesList.length)
            : null;
        const earliestCheckInMin = checkInMinutesList.length > 0 ? Math.min(...checkInMinutesList) : null;
        const latestCheckInMin = checkInMinutesList.length > 0 ? Math.max(...checkInMinutesList) : null;

        // 3. Trend Mode 1: Last 14 School Days (daily14)
        const daily14: Array<{
            date: string;
            label: string;
            dayName: string;
            status: string;
            score: number;
            checkIn: string;
            checkOut: string;
            lateMinutes: number;
        }> = [];

        const scanBackCursor = new Date(queryEnd);
        let guardDays = 0;
        while (daily14.length < 14 && guardDays < 45) {
            const ds = toWibDateStr(scanBackCursor);
            const dow = scanBackCursor.getDay();
            const rec = dailyMap.get(ds);
            if ((dow !== 0 && !holidayMap[ds]) || rec) {
                const st = rec ? rec.status : 'BELUM_ABSEN';
                let score = 0;
                if (st === 'HADIR') score = 100;
                else if (st === 'TERLAMBAT') score = 82;
                else if (st === 'IZIN' || st === 'SAKIT') score = 68;
                else if (st === 'ALPA' || st === 'ALPHA') score = 12;
                else score = 0;

                const checkInMin = rec?.checkInTime ? toTimeMinutes(rec.checkInTime) : null;
                const lateMin = (checkInMin && checkInMin > gateDeadlineMinutes) ? (checkInMin - gateDeadlineMinutes) : 0;

                daily14.unshift({
                    date: ds,
                    label: `${String(scanBackCursor.getDate()).padStart(2, '0')}/${String(scanBackCursor.getMonth() + 1).padStart(2, '0')}`,
                    dayName: DAY_NAMES_ID[dow],
                    status: st,
                    score,
                    checkIn: formatTimeHHMM(rec?.checkInTime),
                    checkOut: formatTimeHHMM(rec?.checkOutTime),
                    lateMinutes: lateMin
                });
            }
            scanBackCursor.setDate(scanBackCursor.getDate() - 1);
            guardDays++;
        }

        // 4. Trend Mode 2: 4-Week Real Aggregation (weekly4) — 100% Real Data!
        const weekly4: Array<{
            weekNumber: number;
            label: string;
            dateRange: string;
            hadir: number;
            terlambat: number;
            izinSakit: number;
            alpa: number;
            totalDays: number;
            attendanceRate: number;
            punctualityRate: number;
            score: number;
        }> = [];

        const daysInSelectedMonth = new Date(selectedYear, selectedMonth, 0).getDate();
        const weekRanges = [
            { weekNumber: 1, startDay: 1, endDay: 7 },
            { weekNumber: 2, startDay: 8, endDay: 14 },
            { weekNumber: 3, startDay: 15, endDay: 21 },
            { weekNumber: 4, startDay: 22, endDay: daysInSelectedMonth }
        ];

        for (const wr of weekRanges) {
            let wHadir = 0;
            let wTerlambat = 0;
            let wIzinSakit = 0;
            let wAlpa = 0;
            let wSchoolDays = 0;

            for (let d = wr.startDay; d <= wr.endDay; d++) {
                const dt = new Date(selectedYear, selectedMonth - 1, d, 12, 0, 0);
                const ds = toWibDateStr(dt);
                const rec = dailyMap.get(ds);
                if (dt > now && !rec) continue;
                const dow = dt.getDay();
                const isSchoolDay = dow !== 0 && !holidayMap[ds];

                if (isSchoolDay) wSchoolDays++;
                if (rec) {
                    const st = rec.status;
                    if (st === 'HADIR') wHadir++;
                    else if (st === 'TERLAMBAT') {
                        wHadir++;
                        wTerlambat++;
                    } else if (st === 'IZIN' || st === 'SAKIT') wIzinSakit++;
                    else if (st === 'ALPA' || st === 'ALPHA') wAlpa++;
                }
            }

            const wTotalRecorded = wHadir + wIzinSakit + wAlpa;
            const wAttRate = wTotalRecorded > 0 ? Math.min(100, Math.round((wHadir / wTotalRecorded) * 100)) : 0;
            const wOnTime = Math.max(0, wHadir - wTerlambat);
            const wPunctRate = wHadir > 0 ? Math.round((wOnTime / wHadir) * 100) : (wTotalRecorded > 0 ? 0 : 100);
            const wScore = wTotalRecorded > 0
                ? Math.round((wAttRate * 0.75) + (wPunctRate * 0.25))
                : 0;

            weekly4.push({
                weekNumber: wr.weekNumber,
                label: `Pekan ${wr.weekNumber}`,
                dateRange: `${wr.startDay}-${wr.endDay} ${MONTH_NAMES_SHORT[selectedMonth - 1]}`,
                hadir: wHadir,
                terlambat: wTerlambat,
                izinSakit: wIzinSakit,
                alpa: wAlpa,
                totalDays: Math.max(wTotalRecorded, wSchoolDays),
                attendanceRate: wAttRate,
                punctualityRate: wPunctRate,
                score: wScore
            });
        }

        // 5. Trend Mode 3 & 4: 6-Month Semester Trend + Class Comparison
        let classmatesIds: string[] = [student.id];
        if (student.className) {
            const classmates = await prisma.user.findMany({
                where: { role: 'STUDENT', className: student.className },
                select: { id: true }
            });
            if (classmates.length > 0) {
                classmatesIds = classmates.map(c => c.id);
            }
        }

        const classAttendances6M = await prisma.attendance.findMany({
            where: {
                userId: { in: classmatesIds },
                type: 'GATE_IN',
                scanTime: { gte: sixMonthsStart, lte: selectedMonthEnd }
            },
            select: {
                userId: true,
                scanTime: true,
                status: true
            }
        });

        const monthly6: Array<{
            month: number;
            year: number;
            label: string;
            hadir: number;
            terlambat: number;
            izinSakit: number;
            alpa: number;
            attendanceRate: number;
            classAvgRate: number;
        }> = [];

        for (let offset = 5; offset >= 0; offset--) {
            const mDate = new Date(selectedYear, selectedMonth - 1 - offset, 1);
            const mNum = mDate.getMonth() + 1;
            const yNum = mDate.getFullYear();
            const prefix = `${yNum}-${String(mNum).padStart(2, '0')}`;

            const sRecs = allDailyRecords.filter(r => r.dateStr.startsWith(prefix));

            let mHadir = 0;
            let mTerlambat = 0;
            let mIzinSakit = 0;
            let mAlpa = 0;
            for (const r of sRecs) {
                const st = r.status;
                if (st === 'HADIR') mHadir++;
                else if (st === 'TERLAMBAT') { mHadir++; mTerlambat++; }
                else if (st === 'IZIN' || st === 'SAKIT') mIzinSakit++;
                else if (st === 'ALPA' || st === 'ALPHA') mAlpa++;
            }
            const mTotal = mHadir + mIzinSakit + mAlpa;
            const mRate = mTotal > 0 ? Math.round((mHadir / mTotal) * 100) : 0;

            // Class average for that month
            const cRecs = classAttendances6M.filter(a => toWibDateStr(a.scanTime).startsWith(prefix));
            let cHadir = 0;
            for (const cr of cRecs) {
                const st = String(cr.status || '').toUpperCase();
                if (st === 'HADIR' || st === 'TERLAMBAT') cHadir++;
            }
            const cRate = cRecs.length > 0 ? Math.round((cHadir / cRecs.length) * 100) : mRate;

            monthly6.push({
                month: mNum,
                year: yNum,
                label: MONTH_NAMES_SHORT[mNum - 1],
                hadir: mHadir,
                terlambat: mTerlambat,
                izinSakit: mIzinSakit,
                alpa: mAlpa,
                attendanceRate: mRate,
                classAvgRate: cRate
            });
        }

        const currentMonthClassEntry = monthly6[monthly6.length - 1];
        const classAvgCurrentMonth = currentMonthClassEntry ? currentMonthClassEntry.classAvgRate : attendanceRate;

        // 6. Day-of-Week Reliability (Senin - Sabtu) across 6 months
        const dayOfWeekStats = [1, 2, 3, 4, 5, 6].map(dow => {
            const recs = allDailyRecords.filter(a => a.dateObj.getDay() === dow);
            let dHadir = 0;
            let dLate = 0;
            for (const r of recs) {
                const st = r.status;
                if (st === 'HADIR') dHadir++;
                else if (st === 'TERLAMBAT') { dHadir++; dLate++; }
            }
            const rate = recs.length > 0 ? Math.round((dHadir / recs.length) * 100) : 100;
            return {
                dayIndex: dow,
                dayName: DAY_NAMES_ID[dow],
                totalRecords: recs.length,
                hadirCount: dHadir,
                lateCount: dLate,
                attendanceRate: rate
            };
        });

        // 7. Streak & Milestones (across 6 months of daily records)
        let currentStreak = 0;
        let bestStreak = 0;
        let runningStreak = 0;
        for (const r of allDailyRecords) {
            const st = r.status;
            if (st === 'HADIR' || st === 'TERLAMBAT') {
                runningStreak++;
                if (runningStreak > bestStreak) bestStreak = runningStreak;
            } else if (st === 'ALPA' || st === 'ALPHA' || st === 'IZIN' || st === 'SAKIT') {
                runningStreak = 0;
            }
        }
        const sortedDesc = [...allDailyRecords].reverse();
        for (const r of sortedDesc) {
            const st = r.status;
            if (st === 'HADIR' || st === 'TERLAMBAT') currentStreak++;
            else break;
        }
        if (currentStreak > bestStreak) bestStreak = currentStreak;

        const milestones = [7, 14, 30, 60, 100];
        const nextMilestone = milestones.find(m => m > currentStreak) || 100;
        const badges: string[] = [];
        if (bestStreak >= 7) badges.push('🔥 Streak 7 Hari');
        if (bestStreak >= 14) badges.push('⚡ Streak 2 Pekan');
        if (bestStreak >= 30) badges.push('🏆 Sebulan Penuh');
        if (punctualityRate >= 95 && hadirCount >= 5) badges.push('⏰ Master Tepat Waktu');
        if (attendanceRate === 100 && hadirCount >= 10) badges.push('💎 Kehadiran Sempurna');

        // 8. Multi-Dimension Breakdown (Gerbang + Mapel KBM + Ibadah Sholat + Gatepass)
        const subjectRecords = await (prisma as any).classPeriodAttendance?.findMany({
            where: {
                studentId: student.id,
                date: { gte: selectedMonthStart, lte: selectedMonthEnd }
            }
        }).catch(() => []) || [];

        let subjHadir = 0;
        for (const sr of subjectRecords) {
            const st = String(sr.status || '').toUpperCase();
            if (st === 'HADIR' || st === 'TERLAMBAT' || st === 'PRESENT' || st === 'LATE') subjHadir++;
        }
        const subjectRate = subjectRecords.length > 0 ? Math.round((subjHadir / subjectRecords.length) * 100) : attendanceRate;

        const prayerRecords = await (prisma as any).studentPrayerAttendance?.findMany({
            where: {
                studentId: student.id,
                date: { gte: selectedMonthStart, lte: selectedMonthEnd }
            }
        }).catch(() => []) || [];

        let prayerHadir = 0;
        for (const pr of prayerRecords) {
            const st = String(pr.status || 'HADIR').toUpperCase();
            if (st === 'HADIR' || st === 'BERJAMAAH' || st === 'PRESENT' || st === 'SHOLAT') prayerHadir++;
        }
        const prayerRate = prayerRecords.length > 0 ? Math.round((prayerHadir / prayerRecords.length) * 100) : (hadirCount > 0 ? 100 : 0);

        const gatepassCount = await (prisma as any).gatepass?.count({
            where: {
                userId: student.id,
                createdAt: { gte: selectedMonthStart, lte: selectedMonthEnd }
            }
        }).catch(() => 0) || 0;

        // 9. Smart Insights Generation (100% Data-Driven)
        const insights: Array<{ type: 'POSITIVE' | 'WARNING' | 'INFO'; title: string; message: string }> = [];

        const diffVsClass = attendanceRate - classAvgCurrentMonth;
        if (diffVsClass >= 3) {
            insights.push({
                type: 'POSITIVE',
                title: 'Di Atas Rata-Rata Kelas',
                message: `Tingkat kehadiranmu (${attendanceRate}%) lebih tinggi +${diffVsClass}% dibandingkan rata-rata kelas ${student.className || ''} (${classAvgCurrentMonth}%).`
            });
        } else if (diffVsClass <= -5) {
            insights.push({
                type: 'WARNING',
                title: 'Di Bawah Rata-Rata Kelas',
                message: `Kehadiranmu bulan ini (${attendanceRate}%) berada ${Math.abs(diffVsClass)}% di bawah rata-rata kelas ${student.className || ''} (${classAvgCurrentMonth}%). Yuk tingkatkan!`
            });
        } else {
            insights.push({
                type: 'INFO',
                title: 'Performa Seimbang dengan Kelas',
                message: `Tingkat kehadiranmu (${attendanceRate}%) sejajar dengan rata-rata kelas ${student.className || 'mu'} (${classAvgCurrentMonth}%).`
            });
        }

        if (terlambatCount > 0) {
            insights.push({
                type: 'WARNING',
                title: `Evaluasi Ketepatan Waktu (${terlambatCount}x Terlambat)`,
                message: `Rata-rata jam tiba pukul ${formatMinutesToHHMM(avgCheckInMin)} dengan total keterlambatan ${totalLateMinutes} menit bulan ini. Usahakan berangkat 10 menit lebih awal.`
            });
        } else if (hadirCount > 0) {
            insights.push({
                type: 'POSITIVE',
                title: 'Zero Keterlambatan Bulan Ini',
                message: `Luar biasa! Kamu hadir ${hadirCount} hari tanpa sekalipun terlambat (Rata-rata tiba pukul ${formatMinutesToHHMM(avgCheckInMin)}).`
            });
        }

        const weakestDay = [...dayOfWeekStats]
            .filter(d => d.totalRecords >= 2)
            .sort((a, b) => a.attendanceRate - b.attendanceRate || b.lateCount - a.lateCount)[0];
        if (weakestDay && (weakestDay.attendanceRate < 90 || weakestDay.lateCount >= 2)) {
            insights.push({
                type: 'INFO',
                title: `Pola Hari ${weakestDay.dayName}`,
                message: `Data 6 bulan menunjukkan hari ${weakestDay.dayName} memiliki tingkat kehadiran ${weakestDay.attendanceRate}% (${weakestDay.lateCount}x terlambat). Siapkan perlengkapan sejak malam sebelumnya.`
            });
        }

        return res.json({
            student: {
                id: student.id,
                name: student.name,
                nisn: student.nisn || student.username,
                className: student.className || '-',
                points: studentPoints,
                spStatus: studentSpStatus
            },
            period: {
                month: selectedMonth,
                year: selectedYear,
                monthName: MONTH_NAMES_SHORT[selectedMonth - 1],
                effectiveSchoolDays: effectiveDenominator
            },
            summary: {
                hadir: hadirCount,
                terlambat: terlambatCount,
                izin: izinCount,
                sakit: sakitCount,
                alpa: alpaCount,
                attendanceRate,
                punctualityRate,
                disciplineScore,
                classAvgRate: classAvgCurrentMonth,
                diffFromClassAvg: diffVsClass
            },
            punctuality: {
                gateDeadline: gateInEndStr,
                avgCheckInTime: formatMinutesToHHMM(avgCheckInMin),
                earliestCheckInTime: formatMinutesToHHMM(earliestCheckInMin),
                latestCheckInTime: formatMinutesToHHMM(latestCheckInMin),
                onTimeCount,
                lateCount: terlambatCount,
                totalLateMinutes,
                onTimeRate: punctualityRate,
                distribution: [bucketBefore645, bucket645To700, bucket701To715, bucketAfter715]
            },
            streak: {
                currentStreak,
                bestStreak,
                nextMilestone,
                progressToMilestone: Math.min(100, Math.round((currentStreak / nextMilestone) * 100)),
                badges
            },
            dimensions: {
                gate: {
                    label: 'Presensi Gerbang',
                    hadir: hadirCount,
                    total: Math.max(totalRecordedInMonth, effectiveSchoolDaysInMonth),
                    rate: attendanceRate
                },
                subject: {
                    label: 'Kehadiran KBM Mapel',
                    hadir: subjHadir,
                    total: subjectRecords.length,
                    rate: subjectRate
                },
                prayer: {
                    label: 'Ibadah Sholat Wajib',
                    hadir: prayerHadir,
                    total: prayerRecords.length,
                    rate: prayerRate
                },
                gatepass: {
                    label: 'Izin Keluar (Gatepass)',
                    totalThisMonth: gatepassCount
                }
            },
            trends: {
                daily14,
                weekly4,
                monthly6,
                dayOfWeekStats
            },
            insights
        });
    } catch (error) {
        console.error('Error in getStudentAttendanceAnalytics:', error);
        return res.status(500).json({ message: 'Gagal memuat analitik kehadiran siswa' });
    }
};

/**
 * GET /api/v2/attendance/analytics/dashboard
 * School-wide & Class-level Attendance Analytics for Portal Admin / BK / Wali Kelas
 */
export const getPortalAttendanceAnalyticsDashboard = async (req: Request, res: Response) => {
    try {
        const className = req.query.className ? String(req.query.className) : undefined;
        const days = Math.min(90, Math.max(7, Number(req.query.days || 30)));

        const endDate = getWibDayBounds(new Date()).endOfDay;
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - days);
        const startDate = getWibDayBounds(pastDate).startOfDay;

        const whereUser: any = { role: 'STUDENT' };
        if (className && className !== 'ALL') {
            whereUser.className = className;
        }

        const students = await prisma.user.findMany({
            where: whereUser,
            select: { id: true, name: true, nisn: true, className: true, points: true }
        });

        const studentIds = students.map(s => s.id);
        const records = await prisma.attendance.findMany({
            where: {
                userId: { in: studentIds },
                type: 'GATE_IN',
                scanTime: { gte: startDate, lte: endDate }
            },
            orderBy: { scanTime: 'asc' }
        });

        const classStatsMap: Record<string, { className: string; totalStudents: number; hadir: number; terlambat: number; izinSakit: number; alpa: number; totalRecords: number }> = {};
        for (const s of students) {
            const cn = s.className || 'Tanpa Kelas';
            if (!classStatsMap[cn]) {
                classStatsMap[cn] = { className: cn, totalStudents: 0, hadir: 0, terlambat: 0, izinSakit: 0, alpa: 0, totalRecords: 0 };
            }
            classStatsMap[cn].totalStudents++;
        }

        const studentMap = new Map(students.map(s => [s.id, s]));
        const studentAbsenceCounter: Record<string, { alpa: number; terlambat: number; izinSakit: number; hadir: number }> = {};

        for (const r of records) {
            const st = studentMap.get(r.userId);
            if (!st) continue;
            const cn = st.className || 'Tanpa Kelas';
            const group = classStatsMap[cn];
            const status = String(r.status || '').toUpperCase();

            if (!studentAbsenceCounter[r.userId]) {
                studentAbsenceCounter[r.userId] = { alpa: 0, terlambat: 0, izinSakit: 0, hadir: 0 };
            }

            if (group) group.totalRecords++;
            if (status === 'HADIR') {
                if (group) group.hadir++;
                studentAbsenceCounter[r.userId].hadir++;
            } else if (status === 'TERLAMBAT') {
                if (group) { group.hadir++; group.terlambat++; }
                studentAbsenceCounter[r.userId].hadir++;
                studentAbsenceCounter[r.userId].terlambat++;
            } else if (status === 'IZIN' || status === 'SAKIT') {
                if (group) group.izinSakit++;
                studentAbsenceCounter[r.userId].izinSakit++;
            } else if (status === 'ALPA' || status === 'ALPHA') {
                if (group) group.alpa++;
                studentAbsenceCounter[r.userId].alpa++;
            }
        }

        const classRanking = Object.values(classStatsMap).map(c => ({
            ...c,
            attendanceRate: c.totalRecords > 0 ? Math.round((c.hadir / c.totalRecords) * 100) : 0,
            punctualityRate: c.hadir > 0 ? Math.round(((c.hadir - c.terlambat) / c.hadir) * 100) : 100
        })).sort((a, b) => b.attendanceRate - a.attendanceRate);

        const earlyWarningStudents = students
            .map(s => {
                const counts = studentAbsenceCounter[s.id] || { alpa: 0, terlambat: 0, izinSakit: 0, hadir: 0 };
                const pts = s.points ?? 0;
                return {
                    id: s.id,
                    name: s.name,
                    nisn: s.nisn,
                    className: s.className || '-',
                    points: pts,
                    spStatus: computeSpStatus(pts),
                    ...counts
                };
            })
            .filter(s => s.alpa >= 2 || s.terlambat >= 3)
            .sort((a, b) => (b.alpa * 3 + b.terlambat) - (a.alpa * 3 + a.terlambat))
            .slice(0, 25);

        return res.json({
            periodDays: days,
            totalStudents: students.length,
            totalRecords: records.length,
            classRanking,
            earlyWarningStudents
        });
    } catch (error) {
        console.error('Error in getPortalAttendanceAnalyticsDashboard:', error);
        return res.status(500).json({ message: 'Gagal memuat analitik kehadiran sekolah' });
    }
};
