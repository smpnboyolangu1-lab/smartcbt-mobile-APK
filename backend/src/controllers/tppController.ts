import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * Helper menentukan Triwulan (1 - 4) dari bulan (1 - 12)
 */
export const getTriwulanFromMonth = (month: number): number => {
    if (month >= 1 && month <= 3) return 1;
    if (month >= 4 && month <= 6) return 2;
    if (month >= 7 && month <= 9) return 3;
    return 4;
};

export const getMonthName = (month: number): string => {
    const names = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return names[month - 1] || `Bulan ${month}`;
};

/**
 * GET /api/tpp/my-tpp
 * Untuk Guru mengecek status TPP miliknya sendiri
 */
export const getMyTpp = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Tidak terotentikasi' });
        }

        const requestedYear = parseInt(req.query.tahun as string, 10) || new Date().getFullYear();
        const teacherId = user.id;

        // Ambil data guru dari database
        const teacher = await prisma.user.findUnique({
            where: { id: teacherId },
            select: { id: true, name: true, username: true }
        });

        if (!teacher) {
            return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan' });
        }

        // Cari record TPP guru untuk tahun tersebut
        let records = await prisma.teacherTppRecord.findMany({
            where: {
                teacherId: teacher.id,
                tahun: requestedYear
            },
            orderBy: { bulan: 'asc' }
        });

        // Jika record belum lengkap 12 bulan untuk tahun ini, lakukan auto-inisialisasi yang idempoten per-bulan
        if (records.length < 12) {
            const existingMonthSet = new Set(records.map(r => r.bulan));
            for (let m = 1; m <= 12; m++) {
                if (!existingMonthSet.has(m)) {
                    try {
                        await prisma.teacherTppRecord.upsert({
                            where: {
                                teacher_tpp_unique_period: {
                                    teacherId: teacher.id,
                                    tahun: requestedYear,
                                    bulan: m
                                }
                            },
                            update: {
                                teacherName: teacher.name,
                                nip: (teacher as any).nip || teacher.username || ''
                            },
                            create: {
                                teacherId: teacher.id,
                                nip: (teacher as any).nip || teacher.username || '',
                                teacherName: teacher.name,
                                tahun: requestedYear,
                                bulan: m,
                                triwulan: getTriwulanFromMonth(m),
                                nominal: 0,
                                potongan: 0,
                                nominalBersih: 0,
                                status: 'BELUM_CAIR',
                                statusVerifikasiKurikulum: 'BELUM'
                            }
                        });
                    } catch (e: any) {
                        console.warn(`[TPP Auto-Init] Info: Bulan ${m} sudah ada atau diupdate:`, e.message);
                    }
                }
            }

            records = await prisma.teacherTppRecord.findMany({
                where: {
                    teacherId: teacher.id,
                    tahun: requestedYear
                },
                orderBy: { bulan: 'asc' }
            });
        }

        // Susun grup per Triwulan (TW 1 s/d TW 4)
        const triwulanSummary = [1, 2, 3, 4].map(tw => {
            const twRecords = records.filter(r => r.triwulan === tw);
            const months = twRecords.map(r => ({
                id: r.id,
                bulan: r.bulan,
                namaBulan: getMonthName(r.bulan),
                status: r.status,
                nominal: r.nominal || 0,
                potongan: r.potongan || 0,
                nominalBersih: r.nominalBersih || 0,
                tanggalCairStr: r.tanggalCairStr || '-',
                noReferensi: r.noReferensi || '-',
                catatan: r.catatan || '',
                sanggahanGuru: r.sanggahanGuru || '',
                statusSanggahan: r.statusSanggahan || '',
                statusVerifikasiKurikulum: r.statusVerifikasiKurikulum || 'BELUM'
            }));

            // Tentukan status triwulan: HANYA ADA 2 STATUS (SUDAH_CAIR atau BELUM_CAIR)
            const isAnyCair = twRecords.some(r => r.status === 'SUDAH_CAIR');
            const twStatus = isAnyCair ? 'SUDAH_CAIR' : 'BELUM_CAIR';
            const latestCairStr = twRecords.find(r => r.status === 'SUDAH_CAIR' && r.tanggalCairStr && r.tanggalCairStr !== '-')?.tanggalCairStr || '-';

            return {
                triwulan: tw,
                label: `TW ${tw}`,
                rentangBulan: tw === 1 ? 'Januari – Maret' : tw === 2 ? 'April – Juni' : tw === 3 ? 'Juli – September' : 'Oktober – Desember',
                status: twStatus,
                tanggalCair: latestCairStr,
                months: twRecords.map(r => ({
                    id: r.id,
                    bulan: r.bulan,
                    namaBulan: getMonthName(r.bulan),
                    status: r.status === 'SUDAH_CAIR' ? 'SUDAH_CAIR' : 'BELUM_CAIR',
                    tanggalCairStr: r.tanggalCairStr || '-',
                    noReferensi: r.noReferensi || '-',
                    catatan: r.catatan || '',
                    sanggahanGuru: r.sanggahanGuru || '',
                    statusSanggahan: r.statusSanggahan || '',
                    statusVerifikasiKurikulum: r.statusVerifikasiKurikulum || 'BELUM'
                }))
            };
        });

        // Ringkasan Tahunan (Hanya hitung jumlah bulan cair & belum cair, tanpa nominal)
        const totalSudahCair = records.filter(r => r.status === 'SUDAH_CAIR').length;

        res.json({
            success: true,
            tahun: requestedYear,
            guru: {
                id: teacher.id,
                name: teacher.name,
                nip: teacher.username || '-'
            },
            summary: {
                totalBulanCair: totalSudahCair,
                totalBulanBelumCair: 12 - totalSudahCair
            },
            triwulan: triwulanSummary,
            records: records.map(r => ({
                id: r.id,
                bulan: r.bulan,
                namaBulan: getMonthName(r.bulan),
                triwulan: r.triwulan,
                status: r.status === 'SUDAH_CAIR' ? 'SUDAH_CAIR' : 'BELUM_CAIR',
                tanggalCairStr: r.tanggalCairStr || '-',
                noReferensi: r.noReferensi || '-',
                catatan: r.catatan || '',
                sanggahanGuru: r.sanggahanGuru || '',
                statusSanggahan: r.statusSanggahan || '',
                statusVerifikasiKurikulum: r.statusVerifikasiKurikulum || 'BELUM'
            }))
        });
    } catch (err: any) {
        console.error('Error getMyTpp:', err);
        res.status(500).json({ success: false, message: 'Gagal mengambil data TPP: ' + err.message });
    }
};

/**
 * POST /api/tpp/confirm-cair
 * Guru mengonfirmasi sendiri bahwa TPP miliknya telah cair (memilih bulan & menginput tanggal cair).
 * Data ini otomatis masuk ke manajemen operator & kurikulum untuk direkap.
 */
export const confirmTeacherTppCair = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Tidak terotentikasi' });
        }

        const { tppRecordId, tahun, bulanList, tanggalCairStr, catatan } = req.body;

        if (!tanggalCairStr) {
            return res.status(400).json({ success: false, message: 'Tanggal pencairan wajib diisi' });
        }

        const dateStr = tanggalCairStr.trim();
        const updatePayload: any = {
            status: 'SUDAH_CAIR',
            tanggalCair: new Date(),
            tanggalCairStr: dateStr,
            catatan: catatan ? catatan.trim() : 'Dikonfirmasi cair oleh guru',
            updatedBy: user.name || 'Guru',
            updatedAt: new Date()
        };

        // Jika disediakan tppRecordId tunggal
        if (tppRecordId) {
            const record = await prisma.teacherTppRecord.findUnique({
                where: { id: tppRecordId }
            });

            if (!record || record.teacherId !== user.id) {
                return res.status(403).json({ success: false, message: 'Tidak memiliki izin mengubah data TPP ini' });
            }

            await prisma.teacherTppRecord.update({
                where: { id: tppRecordId },
                data: updatePayload
            });

            return res.json({
                success: true,
                message: `Status TPP bulan ${getMonthName(record.bulan)} berhasil dikonfirmasi Sudah Cair pada ${dateStr}!`
            });
        }

        // Jika disediakan list bulan
        const targetYear = parseInt(tahun as any, 10) || new Date().getFullYear();
        const months = Array.isArray(bulanList) && bulanList.length > 0 ? bulanList.map((m: any) => parseInt(m, 10)) : [];

        if (months.length === 0) {
            return res.status(400).json({ success: false, message: 'Pilih minimal satu bulan yang cair' });
        }

        for (const m of months) {
            const existing = await prisma.teacherTppRecord.findFirst({
                where: {
                    teacherId: user.id,
                    tahun: targetYear,
                    bulan: m
                }
            });

            if (existing) {
                await prisma.teacherTppRecord.update({
                    where: { id: existing.id },
                    data: updatePayload
                });
            } else {
                await prisma.teacherTppRecord.create({
                    data: {
                        teacherId: user.id,
                        nip: user.nip || user.username || '',
                        teacherName: user.name,
                        tahun: targetYear,
                        bulan: m,
                        triwulan: getTriwulanFromMonth(m),
                        ...updatePayload
                    }
                });
            }
        }

        // ATURAN INTEGRITAS TPP: Ketika memilih/mengirim laporan TW 3, maka TW 1 dan TW 2 otomatis terkunci
        const maxTw = Math.max(...months.map(m => getTriwulanFromMonth(m)));
        if (maxTw > 1) {
            const earlierMonths = Array.from({ length: (maxTw - 1) * 3 }, (_, i) => i + 1);
            for (const em of earlierMonths) {
                const prevRecord = await prisma.teacherTppRecord.findFirst({
                    where: {
                        teacherId: user.id,
                        tahun: targetYear,
                        bulan: em
                    }
                });
                if (prevRecord) {
                    await prisma.teacherTppRecord.update({
                        where: { id: prevRecord.id },
                        data: {
                            isLocked: true
                        }
                    });
                } else {
                    // Jika belum ada record sebelumnya, buat record default dengan status SUDAH_CAIR & isLocked: true
                    await prisma.teacherTppRecord.create({
                        data: {
                            teacherId: user.id,
                            nip: user.nip || user.username || '',
                            teacherName: user.name,
                            tahun: targetYear,
                            bulan: em,
                            triwulan: getTriwulanFromMonth(em),
                            status: 'SUDAH_CAIR',
                            tanggalCairStr: 'Pencairan Triwulan Sebelumnya (Terkunci Otomatis)',
                            catatan: `Terkunci otomatis saat pengiriman laporan Triwulan ${maxTw}`,
                            isLocked: true
                        }
                    });
                }
            }
        }

        const monthNames = months.map(m => getMonthName(m)).join(', ');
        res.json({
            success: true,
            message: `Status TPP (${monthNames}) berhasil dikonfirmasi Sudah Cair pada ${dateStr}!`
        });
    } catch (err: any) {
        console.error('Error confirmTeacherTppCair:', err);
        res.status(500).json({ success: false, message: 'Gagal mengonfirmasi pencairan: ' + err.message });
    }
};

/**
 * POST /api/tpp/submit-report
 * Guru mengirim laporan status TPP mandiri:
 * - Triwulan ke: 1, 2, 3, 4
 * - Bulan: 1 s/d 12 (atau daftar bulan)
 * - Status: "SUDAH_CAIR" atau "BELUM_CAIR"
 * - Jika SUDAH_CAIR: tanggalCairStr wajib diisi (tanggal berapa cair) + catatan opsional
 * - Jika BELUM_CAIR: tanggalCairStr otomatis "-", catatan opsional (misal: "Belum masuk rekening")
 * - Update dari Belum Cair ke Cair: Mengubah status yang sebelumnya BELUM_CAIR menjadi SUDAH_CAIR dengan tanggalCairStr baru
 */
export const submitTeacherTppReport = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Tidak terotentikasi' });
        }

        const { tppRecordId, tahun, triwulan, bulanList, bulan, status, tanggalCairStr, catatan } = req.body;
        const targetYear = parseInt(tahun as any, 10) || new Date().getFullYear();
        const isCair = (status || '').toUpperCase() === 'SUDAH_CAIR';

        if (isCair && (!tanggalCairStr || tanggalCairStr.trim() === '-' || tanggalCairStr.trim() === '')) {
            return res.status(400).json({ success: false, message: 'Tanggal pencairan wajib diisi jika status Sudah Cair' });
        }

        const dateStr = isCair ? (tanggalCairStr || '').trim() : '-';
        const defaultNote = isCair ? 'Laporan mandiri guru: Sudah Cair' : 'Laporan mandiri guru: Belum Cair';
        const finalNote = catatan && catatan.trim() ? catatan.trim() : defaultNote;

        const updatePayload: any = {
            status: isCair ? 'SUDAH_CAIR' : 'BELUM_CAIR',
            tanggalCair: isCair ? new Date() : null,
            tanggalCairStr: dateStr,
            catatan: finalNote,
            updatedBy: user.name || 'Guru',
            updatedAt: new Date()
        };

        // Jika disediakan tppRecordId
        if (tppRecordId) {
            const record = await prisma.teacherTppRecord.findUnique({
                where: { id: tppRecordId }
            });
            if (!record || record.teacherId !== user.id) {
                return res.status(403).json({ success: false, message: 'Tidak memiliki izin mengubah data TPP ini' });
            }

            // ATURAN LOCK: Jika sudah berstatus SUDAH_CAIR, status terkunci (tidak bisa dikembalikan ke BELUM_CAIR oleh guru)
            if (record.status === 'SUDAH_CAIR' && !isCair) {
                return res.status(400).json({
                    success: false,
                    isLocked: true,
                    message: `🔒 Status TPP bulan ${getMonthName(record.bulan)} sudah berstatus SUDAH CAIR dan terkunci secara otomatis. Untuk mengajukan koreksi, silakan gunakan menu Sanggahan atau hubungi Operator / Tim Kurikulum.`
                });
            }

            await prisma.teacherTppRecord.update({
                where: { id: tppRecordId },
                data: updatePayload
            });

            return res.json({
                success: true,
                message: isCair 
                    ? `Laporan pencairan bulan ${getMonthName(record.bulan)} (Cair: ${dateStr}) berhasil dikirim ke Kurikulum!`
                    : `Laporan status Belum Cair bulan ${getMonthName(record.bulan)} berhasil dikirim ke Kurikulum!`
            });
        }

        // Jika disediakan list bulan atau single bulan
        let months: number[] = [];
        if (Array.isArray(bulanList) && bulanList.length > 0) {
            months = bulanList.map((m: any) => parseInt(m, 10));
        } else if (bulan !== undefined && bulan !== null) {
            months = [parseInt(bulan as any, 10)];
        } else if (triwulan) {
            const tw = parseInt(triwulan as any, 10);
            months = [(tw - 1) * 3 + 1, (tw - 1) * 3 + 2, (tw - 1) * 3 + 3];
        }

        if (months.length === 0) {
            return res.status(400).json({ success: false, message: 'Pilih minimal satu bulan' });
        }

        for (const m of months) {
            const existing = await prisma.teacherTppRecord.findFirst({
                where: {
                    teacherId: user.id,
                    tahun: targetYear,
                    bulan: m
                }
            });

            // ATURAN LOCK: Jika bulan ini sudah berstatus SUDAH_CAIR, status terkunci
            if (existing && existing.status === 'SUDAH_CAIR' && !isCair) {
                return res.status(400).json({
                    success: false,
                    isLocked: true,
                    message: `🔒 Status TPP bulan ${getMonthName(m)} sudah berstatus SUDAH CAIR dan terkunci secara otomatis. Untuk mengajukan koreksi, silakan gunakan menu Sanggahan atau hubungi Operator / Tim Kurikulum.`
                });
            }

            if (existing) {
                await prisma.teacherTppRecord.update({
                    where: { id: existing.id },
                    data: updatePayload
                });
            } else {
                await prisma.teacherTppRecord.create({
                    data: {
                        teacherId: user.id,
                        nip: user.nip || user.username || '',
                        teacherName: user.name,
                        tahun: targetYear,
                        bulan: m,
                        triwulan: getTriwulanFromMonth(m),
                        ...updatePayload
                    }
                });
            }
        }

        // ATURAN INTEGRITAS TPP: Ketika memilih/mengirim laporan TW 3, maka TW 1 dan TW 2 otomatis terkunci
        const maxTw = Math.max(...months.map(m => getTriwulanFromMonth(m)));
        if (maxTw > 1) {
            const earlierMonths = Array.from({ length: (maxTw - 1) * 3 }, (_, i) => i + 1);
            for (const em of earlierMonths) {
                const prevRecord = await prisma.teacherTppRecord.findFirst({
                    where: {
                        teacherId: user.id,
                        tahun: targetYear,
                        bulan: em
                    }
                });
                if (prevRecord) {
                    await prisma.teacherTppRecord.update({
                        where: { id: prevRecord.id },
                        data: {
                            isLocked: true
                        }
                    });
                } else {
                    // Jika belum ada record sebelumnya, buat record default dengan status SUDAH_CAIR & isLocked: true
                    await prisma.teacherTppRecord.create({
                        data: {
                            teacherId: user.id,
                            nip: user.nip || user.username || '',
                            teacherName: user.name,
                            tahun: targetYear,
                            bulan: em,
                            triwulan: getTriwulanFromMonth(em),
                            status: 'SUDAH_CAIR',
                            tanggalCairStr: 'Pencairan Triwulan Sebelumnya (Terkunci Otomatis)',
                            catatan: `Terkunci otomatis saat pengiriman laporan Triwulan ${maxTw}`,
                            isLocked: true
                        }
                    });
                }
            }
        }

        const monthNames = months.map(m => getMonthName(m)).join(', ');
        res.json({
            success: true,
            message: isCair
                ? `Laporan pencairan periode (${monthNames}) pada tanggal ${dateStr} berhasil dikirim ke Operator & Kurikulum!`
                : `Laporan periode (${monthNames}) status Belum Cair berhasil dikirim ke Operator & Kurikulum!`
        });
    } catch (err: any) {
        console.error('Error submitTeacherTppReport:', err);
        res.status(500).json({ success: false, message: 'Gagal mengirim laporan: ' + err.message });
    }
};

/**
 * POST /api/tpp/cancel-cair
 * Guru membatalkan konfirmasi pencairan (mengembalikan status ke Belum Cair)
 */
export const cancelTeacherTppCair = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Tidak terotentikasi' });
        }

        const { tppRecordId } = req.body;
        if (!tppRecordId) {
            return res.status(400).json({ success: false, message: 'ID TPP wajib disertakan' });
        }

        const record = await prisma.teacherTppRecord.findUnique({
            where: { id: tppRecordId }
        });

        if (!record || record.teacherId !== user.id) {
            return res.status(403).json({ success: false, message: 'Tidak memiliki izin mengubah data TPP ini' });
        }

        await prisma.teacherTppRecord.update({
            where: { id: tppRecordId },
            data: {
                status: 'BELUM_CAIR',
                tanggalCair: null,
                tanggalCairStr: '-',
                catatan: 'Dibatalkan oleh guru',
                updatedBy: user.name || 'Guru',
                updatedAt: new Date()
            }
        });

        res.json({
            success: true,
            message: `Status TPP bulan ${getMonthName(record.bulan)} berhasil dikembalikan ke Belum Cair`
        });
    } catch (err: any) {
        console.error('Error cancelTeacherTppCair:', err);
        res.status(500).json({ success: false, message: 'Gagal membatalkan konfirmasi: ' + err.message });
    }
};

/**
 * POST /api/tpp/sanggahan
 * Guru mengajukan sanggahan/koreksi terkait TPP periode tertentu
 */
export const submitTppDispute = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { tppRecordId, alasanSanggahan } = req.body;

        if (!tppRecordId || !alasanSanggahan) {
            return res.status(400).json({ success: false, message: 'ID TPP dan alasan sanggahan wajib diisi' });
        }

        const record = await prisma.teacherTppRecord.findUnique({
            where: { id: tppRecordId }
        });

        if (!record || record.teacherId !== user.id) {
            return res.status(403).json({ success: false, message: 'Tidak memiliki izin mengakses data TPP ini' });
        }

        const updated = await prisma.teacherTppRecord.update({
            where: { id: tppRecordId },
            data: {
                status: 'SANGGAHAN',
                sanggahanGuru: alasanSanggahan.trim(),
                statusSanggahan: 'MENUNGGU',
                updatedAt: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Sanggahan TPP berhasil diajukan dan masuk ke antrean peninjauan Operator & Kurikulum',
            data: updated
        });
    } catch (err: any) {
        console.error('Error submitTppDispute:', err);
        res.status(500).json({ success: false, message: 'Gagal mengajukan sanggahan: ' + err.message });
    }
};

/**
 * GET /api/tpp/kurikulum/monitoring
 * Untuk Tim Kurikulum & Operator merekap laporan status TPP dari seluruh guru
 */
export const getKurikulumTppMonitoring = async (req: Request, res: Response) => {
    try {
        const requestedYear = parseInt(req.query.tahun as string, 10) || new Date().getFullYear();
        const requestedTw = parseInt(req.query.triwulan as string, 10) || 0; // 0 = semua
        const requestedBulan = parseInt(req.query.bulan as string, 10) || 0; // 0 = semua

        // Ambil seluruh guru aktif
        const teachers = await prisma.user.findMany({
            where: {
                role: 'TEACHER'
            },
            select: {
                id: true,
                name: true,
                username: true,
                teachingSubject: true,
                teachingClasses: true
            },
            orderBy: { name: 'asc' }
        });

        // Pastikan inisialisasi record jika belum ada untuk guru-guru ini
        const teacherIds = teachers.map(t => t.id);
        const existingRecords = await prisma.teacherTppRecord.findMany({
            where: {
                tahun: requestedYear,
                teacherId: { in: teacherIds },
                ...(requestedTw > 0 && { triwulan: requestedTw }),
                ...(requestedBulan > 0 && { bulan: requestedBulan })
            }
        });

        // Susun daftar guru dan status TPP masing-masing (Sesuai Aturan Privasi: Tanpa Nominal)
        const teacherList = teachers.map(t => {
            const records = existingRecords.filter(r => r.teacherId === t.id);
            
            // Hitung status: SUDAH_CAIR (jika sudah dikonfirmasi cair oleh guru) atau BELUM_CAIR
            const isAnyCair = records.some(r => r.status === 'SUDAH_CAIR');
            const currentStatus = isAnyCair ? 'SUDAH_CAIR' : 'BELUM_CAIR';

            const cairRecord = records.find(r => r.status === 'SUDAH_CAIR' && r.tanggalCairStr && r.tanggalCairStr !== '-');
            const latest = records.length > 0 ? records[records.length - 1] : null;

            const tanggalCairStr = cairRecord?.tanggalCairStr || (isAnyCair ? (latest?.tanggalCairStr || '-') : '-');
            const catatan = cairRecord?.catatan || latest?.catatan || latest?.catatanKurikulum || '';
            const statusVerifikasi = latest?.statusVerifikasiKurikulum || 'BELUM';
            const adaSanggahan = records.some(r => r.status === 'SANGGAHAN' || !!r.sanggahanGuru);

            return {
                teacherId: t.id,
                name: t.name,
                nip: t.username || '-',
                mapel: t.teachingSubject || '-',
                rombel: t.teachingClasses || '-',
                status: currentStatus,
                tanggalCairStr,
                statusVerifikasi,
                adaSanggahan,
                catatan,
                // Rincian per periode (tanpa nominal)
                periods: records.map(r => ({
                    id: r.id,
                    bulan: r.bulan,
                    namaBulan: getMonthName(r.bulan),
                    triwulan: r.triwulan,
                    status: r.status === 'SUDAH_CAIR' ? 'SUDAH_CAIR' : 'BELUM_CAIR',
                    tanggalCairStr: r.tanggalCairStr || '-',
                    statusVerifikasiKurikulum: r.statusVerifikasiKurikulum || 'BELUM',
                    catatan: r.catatan || '',
                    sanggahanGuru: r.sanggahanGuru || ''
                }))
            };
        });

        // KPI Ringkasan
        const totalGuru = teacherList.length;
        const totalSudahCair = teacherList.filter(t => t.status === 'SUDAH_CAIR').length;
        const totalBelumCair = totalGuru - totalSudahCair;
        const totalSanggahan = teacherList.filter(t => t.adaSanggahan).length;

        res.json({
            success: true,
            tahun: requestedYear,
            triwulan: requestedTw,
            bulan: requestedBulan,
            kpi: {
                totalGuru,
                totalSudahCair,
                totalBelumCair,
                totalSanggahan,
                persentaseCair: totalGuru > 0 ? Math.round((totalSudahCair / totalGuru) * 100) : 0
            },
            teachers: teacherList
        });
    } catch (err: any) {
        console.error('Error getKurikulumTppMonitoring:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat monitoring Kurikulum: ' + err.message });
    }
};

/**
 * POST /api/tpp/kurikulum/verify
 * [NONAKTIF SESUAI TEMUAN #23]: Verifikasi Kinerja TPP dinonaktifkan demi privasi guru
 */
export const verifyKurikulumTpp = async (req: Request, res: Response) => {
    return res.status(410).json({
        success: false,
        message: 'Layanan Verifikasi Kinerja TPP telah dinonaktifkan sesuai kebijakan privasi guru (Temuan #23).'
    });
};

/**
 * POST /api/tpp/admin/generate-records
 * [TEMUAN #21]: Generator data TPP idempoten per-guru dengan laporan berhasil N, gagal M
 */
export const generateTppBatchRecords = async (req: Request, res: Response) => {
    try {
        const targetYear = parseInt(req.body.tahun as string, 10) || new Date().getFullYear();
        const teachers = await prisma.user.findMany({
            where: { role: 'TEACHER' },
            select: { id: true, name: true, username: true }
        });

        let successCount = 0;
        let failCount = 0;
        const details: any[] = [];

        for (const t of teachers) {
            try {
                let monthsCreated = 0;
                for (let m = 1; m <= 12; m++) {
                    await prisma.teacherTppRecord.upsert({
                        where: {
                            teacher_tpp_unique_period: {
                                teacherId: t.id,
                                tahun: targetYear,
                                bulan: m
                            }
                        },
                        update: {
                            teacherName: t.name,
                            nip: t.username || ''
                        },
                        create: {
                            teacherId: t.id,
                            nip: t.username || '',
                            teacherName: t.name,
                            tahun: targetYear,
                            bulan: m,
                            triwulan: getTriwulanFromMonth(m),
                            status: 'BELUM_CAIR',
                            nominal: 0,
                            potongan: 0,
                            nominalBersih: 0,
                            statusVerifikasiKurikulum: 'BELUM'
                        }
                    });
                    monthsCreated++;
                }
                successCount++;
                details.push({ teacherId: t.id, name: t.name, status: 'OK', months: monthsCreated });
            } catch (err: any) {
                failCount++;
                details.push({ teacherId: t.id, name: t.name, status: 'FAIL', reason: err.message });
            }
        }

        res.json({
            success: true,
            message: `Generator data TPP selesai: ${successCount} guru berhasil, ${failCount} guru gagal`,
            tahun: targetYear,
            summary: {
                totalTeachers: teachers.length,
                successCount,
                failCount
            },
            details
        });
    } catch (err: any) {
        console.error('Error generateTppBatchRecords:', err);
        res.status(500).json({ success: false, message: 'Gagal membuat batch TPP: ' + err.message });
    }
};

/**
 * GET /api/tpp/kurikulum/rekap-pdf
 * [TEMUAN #22]: Unduh Rekap TPP Lengkap dalam format cetak resmi (Tanpa Nominal)
 */
export const getKurikulumTppRekapPdf = async (req: Request, res: Response) => {
    try {
        const requestedYear = parseInt(req.query.tahun as string, 10) || new Date().getFullYear();
        const requestedTw = parseInt(req.query.triwulan as string, 10) || 0;

        const teachers = await prisma.user.findMany({
            where: { role: 'TEACHER' },
            select: { id: true, name: true, username: true, teachingSubject: true, teachingClasses: true },
            orderBy: { name: 'asc' }
        });

        const teacherIds = teachers.map(t => t.id);
        const records = await prisma.teacherTppRecord.findMany({
            where: {
                tahun: requestedYear,
                teacherId: { in: teacherIds },
                ...(requestedTw > 0 && { triwulan: requestedTw })
            }
        });

        const periodLabel = requestedTw > 0 ? `TRIWULAN ${requestedTw}` : 'TAHUNAN (TW 1 - 4)';

        let rowsHtml = '';
        teachers.forEach((t, idx) => {
            const tRecords = records.filter(r => r.teacherId === t.id);
            const isCair = tRecords.some(r => r.status === 'SUDAH_CAIR');
            const cairRecord = tRecords.find(r => r.status === 'SUDAH_CAIR' && r.tanggalCairStr && r.tanggalCairStr !== '-');
            const tglCair = cairRecord ? cairRecord.tanggalCairStr : (isCair ? 'Sudah Cair' : '-');
            const catatan = cairRecord?.catatan || (tRecords[0]?.catatan || '-');

            const statusBadge = isCair
                ? '<span style="color:#059669; font-weight:bold; background:#ECFDF5; padding:3px 8px; border-radius:4px; border:1px solid #A7F3D0;">🟢 SUDAH CAIR</span>'
                : '<span style="color:#D97706; font-weight:bold; background:#FFFBEB; padding:3px 8px; border-radius:4px; border:1px solid #FDE68A;">⏳ BELUM CAIR</span>';

            rowsHtml += `
                <tr style="border-bottom: 1px solid #E2E8F0;">
                    <td style="padding: 8px 10px; text-align: center;">${idx + 1}</td>
                    <td style="padding: 8px 10px; font-weight: 600;">${t.name}</td>
                    <td style="padding: 8px 10px;">${t.username || '-'}</td>
                    <td style="padding: 8px 10px;">${t.teachingSubject || '-'}</td>
                    <td style="padding: 8px 10px; text-align: center;">${statusBadge}</td>
                    <td style="padding: 8px 10px; text-align: center;">${tglCair}</td>
                    <td style="padding: 8px 10px; font-size: 11px; color: #475569;">${catatan}</td>
                </tr>
            `;
        });

        const totalGuru = teachers.length;
        const totalCair = teachers.filter(t => records.some(r => r.teacherId === t.id && r.status === 'SUDAH_CAIR')).length;
        const totalBelum = totalGuru - totalCair;
        const persentase = totalGuru > 0 ? Math.round((totalCair / totalGuru) * 100) : 0;

        const html = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Rekap TPP Guru - SMPN 1 Boyolangu</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; color: #1E293B; font-size: 12px; }
        .kop { text-align: center; border-bottom: 3px double #0F172A; padding-bottom: 10px; margin-bottom: 15px; }
        .kop h2 { margin: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
        .kop h3 { margin: 2px 0; font-size: 14px; }
        .kop p { margin: 2px 0; font-size: 11px; color: #475569; }
        .kpi-box { display: flex; justify-content: space-between; margin-bottom: 15px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 15px; }
        .kpi-item { text-align: center; }
        .kpi-val { font-size: 16px; font-weight: bold; color: #1E3A8A; }
        .kpi-lbl { font-size: 10.5px; color: #64748B; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11.5px; }
        th { background: #1E3A8A; color: white; padding: 8px 10px; text-align: left; font-weight: 600; }
        .footer-sig { margin-top: 30px; display: flex; justify-content: space-between; page-break-inside: avoid; }
        .sig-box { text-align: center; width: 220px; }
        @media print {
            .no-print { display: none; }
            body { margin: 0; }
        }
    </style>
</head>
<body>
    <div class="no-print" style="margin-bottom: 15px; text-align: right;">
        <button onclick="window.print()" style="background: #1E3A8A; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer;">🖨️ Cetak / Simpan PDF</button>
    </div>

    <div class="kop">
        <h2>PEMERINTAH KABUPATEN TULUNGAGUNG • DINAS PENDIDIKAN</h2>
        <h3>SMP NEGERI 1 BOYOLANGU</h3>
        <p>Jl. Ki Mangunsarkoro No. 101, Boyolangu, Tulungagung • Posko Akademik & Kurikulum SIBOY</p>
        <h4 style="margin: 10px 0 0 0; color: #1E3A8A; font-size: 13px;">REKAPITULASI LAPORAN PENCAIRAN TPP GURU</h4>
        <p style="margin: 2px 0; font-weight: bold;">Periode: ${periodLabel} • Tahun Anggaran ${requestedYear}</p>
        <p style="margin: 0; font-size: 10px; color: #64748B;">Kebijakan Privasi Sekolah: Zero Nominal Rupiah (Hanya Rekap Status Pencairan)</p>
    </div>

    <div class="kpi-box">
        <div class="kpi-item">
            <div class="kpi-val">${totalGuru}</div>
            <div class="kpi-lbl">Total Guru Terdata</div>
        </div>
        <div class="kpi-item">
            <div class="kpi-val" style="color: #059669;">${totalCair} Guru</div>
            <div class="kpi-lbl">Sudah Konfirmasi Cair</div>
        </div>
        <div class="kpi-item">
            <div class="kpi-val" style="color: #D97706;">${totalBelum} Guru</div>
            <div class="kpi-lbl">Belum Konfirmasi Cair</div>
        </div>
        <div class="kpi-item">
            <div class="kpi-val">${persentase}%</div>
            <div class="kpi-lbl">Tingkat Pencairan</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th style="width: 35px; text-align: center;">No</th>
                <th>Nama Guru</th>
                <th>NIP / Username</th>
                <th>Mata Pelajaran</th>
                <th style="text-align: center; width: 130px;">Status TPP</th>
                <th style="text-align: center; width: 110px;">Tanggal Cair</th>
                <th>Catatan / Keterangan</th>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml}
        </tbody>
    </table>

    <div class="footer-sig">
        <div class="sig-box">
            <p>Mengetahui,<br>Kepala SMPN 1 Boyolangu</p>
            <br><br><br>
            <p><strong>ADI SUITGNYO, S.Pd</strong><br>NIP. 196801211991031004</p>
        </div>
        <div class="sig-box">
            <p>Tulungagung, ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}<br>Tim Manajemen Kurikulum & TPP</p>
            <br><br><br>
            <p><strong>TIM KURIKULUM SIBOY</strong><br>SMP Negeri 1 Boyolangu</p>
        </div>
    </div>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err: any) {
        console.error('Error getKurikulumTppRekapPdf:', err);
        res.status(500).send('Gagal membuat rekap PDF: ' + err.message);
    }
};

/**
 * POST /api/tpp/operator/update-status
 * Operator / Admin memperbarui status pencairan TPP, tanggal cair, nominal, dan no referensi
 */
export const updateTppStatusByOperator = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            tppRecordIds,
            status,
            tanggalCairStr,
            noReferensi,
            catatan,
            nominal,
            potongan
        } = req.body;

        if (!Array.isArray(tppRecordIds) || tppRecordIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Daftar record TPP wajib dipilih' });
        }

        const updateData: any = {
            updatedBy: user?.name || 'Operator',
            updatedAt: new Date()
        };

        const getIndonesianDateStr = (date = new Date()): string => {
            const d = date.getDate();
            const m = getMonthName(date.getMonth() + 1);
            const y = date.getFullYear();
            return `${d} ${m} ${y}`;
        };

        if (status === 'SUDAH_CAIR') {
            updateData.status = 'SUDAH_CAIR';
            updateData.tanggalCair = new Date();
            updateData.tanggalCairStr = (tanggalCairStr && tanggalCairStr !== '-') ? tanggalCairStr : getIndonesianDateStr();
        } else if (status) {
            updateData.status = 'BELUM_CAIR';
        }
        if (noReferensi !== undefined) updateData.noReferensi = noReferensi;
        if (catatan !== undefined) updateData.catatan = catatan;

        if (nominal !== undefined) {
            const nom = parseFloat(nominal) || 0;
            const pot = parseFloat(potongan) || 0;
            updateData.nominal = nom;
            updateData.potongan = pot;
            updateData.nominalBersih = Math.max(0, nom - pot);
        }

        await prisma.teacherTppRecord.updateMany({
            where: { id: { in: tppRecordIds } },
            data: updateData
        });

        res.json({
            success: true,
            message: `Status pencairan berhasil diperbarui untuk ${tppRecordIds.length} data guru`,
            status: status || 'UPDATED',
            tanggalCairStr: tanggalCairStr || '-'
        });
    } catch (err: any) {
        console.error('Error updateTppStatusByOperator:', err);
        res.status(500).json({ success: false, message: 'Gagal memperbarui status TPP: ' + err.message });
    }
};
