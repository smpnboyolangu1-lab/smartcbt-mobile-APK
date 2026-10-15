import prisma from './db';

let globalIo: any = null;

export function setAnomalyDetectorIo(ioInstance: any) {
    globalIo = ioInstance;
}

export interface AnomalyPayload {
    code: string;
    level: 'INFO' | 'SEDANG' | 'TINGGI' | 'KRITIS';
    module: 'ATTENDANCE' | 'CBT' | 'HOMEWORK' | 'EKANTIN' | 'AUTH';
    summary: string;
    count?: number;
    sampleStudents?: any[];
    notes?: string;
}

export async function recordAnomaly(data: AnomalyPayload) {
    try {
        // Cek apakah anomali serupa yang masih OPEN sudah tercatat dalam 30 menit terakhir
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
        const existing = await prisma.activityAnomaly.findFirst({
            where: {
                code: data.code,
                module: data.module,
                status: 'OPEN',
                createdAt: { gte: thirtyMinsAgo }
            }
        });

        let anomalyRecord;
        if (existing) {
            let samples: any[] = [];
            try {
                samples = existing.sampleStudents ? JSON.parse(existing.sampleStudents) : [];
            } catch {}
            if (data.sampleStudents && data.sampleStudents.length > 0) {
                for (const s of data.sampleStudents) {
                    if (!samples.some((old: any) => old.id === s.id && old.time === s.time)) {
                        samples.push(s);
                    }
                }
            }
            anomalyRecord = await prisma.activityAnomaly.update({
                where: { id: existing.id },
                data: {
                    count: { increment: data.count || 1 },
                    sampleStudents: JSON.stringify(samples.slice(-10)),
                    summary: data.summary || existing.summary,
                    level: (data.level === 'KRITIS' || existing.level === 'KRITIS') ? 'KRITIS' : data.level
                }
            });
        } else {
            anomalyRecord = await prisma.activityAnomaly.create({
                data: {
                    code: data.code,
                    level: data.level,
                    module: data.module,
                    summary: data.summary,
                    count: data.count || 1,
                    sampleStudents: data.sampleStudents ? JSON.stringify(data.sampleStudents.slice(-10)) : null,
                    status: 'OPEN',
                    notes: data.notes || null
                }
            });
        }

        // Broadcast realtime via Socket.IO ke portal Admin & Operator
        if (globalIo) {
            globalIo.emit('activity_anomaly', {
                ...anomalyRecord,
                isNew: !existing
            });
        }

        return anomalyRecord;
    } catch (e) {
        console.error('Error recording ActivityAnomaly:', e);
        return null;
    }
}

/**
 * Pengecekan anomali langsung (realtime) saat ada log penolakan/error dari middleware
 */
export async function triggerRealtimeAnomalyCheck(logItem: any) {
    try {
        const now = new Date();
        const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
        const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);

        // 1. GATEOUT_REJECT_BUT_HAS_IN
        if (logItem.module === 'ATTENDANCE' && logItem.action === 'SCAN_GATE_OUT' && logItem.outcome === 'REJECTED') {
            const msgLower = (logItem.message || '').toLowerCase();
            if (msgLower.includes('belum scan masuk') || msgLower.includes('belum tercatat melakukan presensi masuk')) {
                if (logItem.userId) {
                    const startOfDay = new Date();
                    startOfDay.setHours(0, 0, 0, 0);
                    const endOfDay = new Date();
                    endOfDay.setHours(23, 59, 59, 999);

                    const actualIn = await prisma.attendance.findFirst({
                        where: {
                            userId: logItem.userId,
                            type: 'GATE_IN',
                            scanTime: { gte: startOfDay, lte: endOfDay }
                        }
                    });

                    if (actualIn) {
                        await recordAnomaly({
                            code: 'GATEOUT_REJECT_BUT_HAS_IN',
                            level: 'KRITIS',
                            module: 'ATTENDANCE',
                            summary: `Scan pulang ditolak "belum masuk" untuk ${logItem.name || logItem.userId} (${logItem.className || '-'}), padahal di server ada presensi masuk hari ini.`,
                            count: 1,
                            sampleStudents: [{
                                id: logItem.userId,
                                name: logItem.name,
                                className: logItem.className,
                                reason: logItem.message,
                                time: new Date().toLocaleTimeString('id-ID')
                            }]
                        });
                    }
                }
            }
        }

        // Bedakan antara token expiry (normal saat sesi habis) dengan kegagalan login (potensi brute-force)
        const isLoginEndpoint = (logItem.path && (logItem.path.includes('/login') || logItem.path.includes('/auth/login'))) ||
            logItem.action === 'LOGIN_ATTEMPT' ||
            logItem.action === 'LOGIN_FAILED';

        const isAuthExpiryError = !isLoginEndpoint && (
            logItem.httpStatus === 401 ||
            logItem.errorCode === 'TOKEN_EXPIRED' ||
            logItem.errorCode === 'TOKEN_MISSING' ||
            logItem.errorCode === 'TOKEN_INVALID' ||
            (logItem.message && (
                logItem.message.toLowerCase().includes('token expired') ||
                logItem.message.toLowerCase().includes('token kadaluarsa') ||
                logItem.message.toLowerCase().includes('token tidak valid') ||
                logItem.message.toLowerCase().includes('akses ditolak: token')
            ))
        );

        // 2. REPEATED_REJECT: 1 siswa ditolak >= 3x dalam 10 menit pada modul yang sama (di luar auth expiry)
        if (!isAuthExpiryError && logItem.userId && (logItem.outcome === 'REJECTED' || logItem.outcome === 'ERROR')) {
            const rejectCount = await prisma.activityEventLog.count({
                where: {
                    userId: logItem.userId,
                    module: logItem.module,
                    outcome: { in: ['REJECTED', 'ERROR'] },
                    httpStatus: { not: 401 },
                    createdAt: { gte: tenMinsAgo }
                }
            });

            if (rejectCount >= 3) {
                await recordAnomaly({
                    code: 'REPEATED_REJECT',
                    level: 'TINGGI',
                    module: logItem.module,
                    summary: `Siswa ${logItem.name || logItem.username} (${logItem.className || '-'}) mengalami penolakan berulang (${rejectCount}x) dalam 10 menit di modul ${logItem.module}.`,
                    count: 1,
                    sampleStudents: [{
                        id: logItem.userId,
                        name: logItem.name,
                        className: logItem.className,
                        reason: logItem.message,
                        time: new Date().toLocaleTimeString('id-ID')
                    }]
                });
            }
        }

        // 3. MASS_REJECT: 10 penolakan dengan alasan serupa dalam 15 menit (di luar auth expiry)
        if (!isAuthExpiryError && logItem.message && logItem.outcome === 'REJECTED') {
            const coreMsg = logItem.message.substring(0, 30);
            const similarRejects = await prisma.activityEventLog.findMany({
                where: {
                    module: logItem.module,
                    outcome: 'REJECTED',
                    httpStatus: { not: 401 },
                    message: { contains: coreMsg },
                    createdAt: { gte: fifteenMinsAgo }
                },
                take: 15,
                select: { userId: true, name: true, className: true, message: true, createdAt: true }
            });

            if (similarRejects.length >= 10) {
                await recordAnomaly({
                    code: 'MASS_REJECT',
                    level: 'KRITIS',
                    module: logItem.module,
                    summary: `Terdeteksi ${similarRejects.length} penolakan massal dalam 15 menit di modul ${logItem.module} dengan alasan: "${coreMsg}..."`,
                    count: similarRejects.length,
                    sampleStudents: similarRejects.slice(0, 5).map(r => ({
                        id: r.userId,
                        name: r.name,
                        className: r.className,
                        reason: r.message,
                        time: new Date(r.createdAt).toLocaleTimeString('id-ID')
                    }))
                });
            }
        }

        // 4. SERVER_ERROR_SPIKE: Error 5xx >= 5x dalam 5 menit
        if (logItem.outcome === 'ERROR' || (logItem.httpStatus && logItem.httpStatus >= 500)) {
            const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);
            const errCount = await prisma.activityEventLog.count({
                where: {
                    module: logItem.module,
                    outcome: 'ERROR',
                    createdAt: { gte: fiveMinsAgo }
                }
            });

            if (errCount >= 5) {
                await recordAnomaly({
                    code: 'SERVER_ERROR_SPIKE',
                    level: 'KRITIS',
                    module: logItem.module,
                    summary: `Lonjakan internal server error (5xx) sebanyak ${errCount}x dalam 5 menit pada modul ${logItem.module}.`,
                    count: errCount
                });
            }
        }

        // 5. CBT_SYNC_FAIL
        if (logItem.module === 'CBT' && (logItem.action === 'SYNC_EXAM_ANSWERS' || logItem.action === 'SUBMIT_EXAM') && logItem.outcome !== 'SUCCESS') {
            await recordAnomaly({
                code: 'CBT_SYNC_FAIL',
                level: 'KRITIS',
                module: 'CBT',
                summary: `Sinkronisasi atau submit jawaban CBT gagal untuk siswa ${logItem.name || '-'} (${logItem.className || '-'}): ${logItem.message || 'Unknown error'}`,
                count: 1,
                sampleStudents: [{
                    id: logItem.userId,
                    name: logItem.name,
                    className: logItem.className,
                    reason: logItem.message,
                    time: new Date().toLocaleTimeString('id-ID')
                }]
            });
        }

        // 6. EKANTIN_PAYMENT_FAIL
        if (logItem.module === 'EKANTIN' && logItem.action === 'PAYMENT_TRANSACTION' && logItem.outcome !== 'SUCCESS') {
            await recordAnomaly({
                code: 'EKANTIN_PAYMENT_FAIL',
                level: 'KRITIS',
                module: 'EKANTIN',
                summary: `Transaksi pembayaran E-Kantin gagal untuk ${logItem.name || logItem.userId}: ${logItem.message || 'Gagal'}`,
                count: 1
            });
        }
    } catch (err) {
        console.error('Error in triggerRealtimeAnomalyCheck:', err);
    }
}

/**
 * Mesin Deteksi Anomali Berkala (jalan setiap 2 menit)
 */
export async function runScheduledAnomalyDetection() {
    try {
        const now = new Date();
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Aturan MISSING_GATE_IN_ON_OUT:
        // Cek apakah ada record attendance GATE_OUT hari ini yang memiliki note "Pulang tanpa data masuk"
        const missingInAttendances = await prisma.attendance.findMany({
            where: {
                type: 'GATE_OUT',
                scanTime: { gte: startOfDay, lte: endOfDay },
                note: { contains: 'Pulang tanpa data masuk' }
            },
            take: 20,
            include: { user: { select: { id: true, name: true, className: true } } }
        });

        if (missingInAttendances.length > 0) {
            await recordAnomaly({
                code: 'MISSING_GATE_IN_ON_OUT',
                level: 'SEDANG',
                module: 'ATTENDANCE',
                summary: `Terdapat ${missingInAttendances.length} siswa yang melakukan scan pulang hari ini tanpa rekam scan masuk (ditandai perlu verifikasi BK/Wali Kelas).`,
                count: missingInAttendances.length,
                sampleStudents: missingInAttendances.map(a => ({
                    id: a.user.id,
                    name: a.user.name,
                    className: a.user.className,
                    reason: a.note,
                    time: new Date(a.scanTime).toLocaleTimeString('id-ID')
                }))
            });
        }

        // Aturan CBT_STRIKE_BURST:
        const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
        const strikesCount = await prisma.activityEventLog.count({
            where: {
                module: 'CBT',
                action: 'CBT_SECURITY_STRIKE',
                createdAt: { gte: tenMinsAgo }
            }
        });
        if (strikesCount >= 8) {
            await recordAnomaly({
                code: 'CBT_STRIKE_BURST',
                level: 'SEDANG',
                module: 'CBT',
                summary: `Terdeteksi gelombang ${strikesCount} strike / pelanggaran CBT dalam 10 menit terakhir.`,
                count: strikesCount
            });
        }
    } catch (err) {
        console.error('Scheduled anomaly detection error:', err);
    }
}
