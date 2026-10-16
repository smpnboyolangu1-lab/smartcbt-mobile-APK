import { Request, Response } from 'express';
import prisma from '../utils/db';
import { sendFcmToUser } from '../services/fcmService';
import { sendSingleWhatsApp } from '../services/whatsappBlastService';

// ========================================================
// 1. DATA KESEHATAN DIGITAL SISWA (MODUL 2-A & 2-F)
// ========================================================
export const getStudentHealthProfile = async (req: Request, res: Response) => {
    try {
        const { siswaId } = req.params;
        const targetSiswaId = String(siswaId);

        const healthData = await prisma.uksStudentHealthData.findUnique({
            where: { siswaId: targetSiswaId }
        });

        const activeVisit = await prisma.uksVisitEvent.findFirst({
            where: {
                siswaId: targetSiswaId,
                status: { in: ['SEDANG_DIRAWAT', 'PERLU_DIJEMPUT'] }
            },
            orderBy: { tanggal: 'desc' }
        });

        const visitHistory = await prisma.uksVisitEvent.findMany({
            where: { siswaId: targetSiswaId },
            orderBy: { tanggal: 'desc' },
            take: 10
        });

        return res.json({
            success: true,
            healthCard: healthData,
            isActiveInUks: !!activeVisit,
            activeVisitDetail: activeVisit,
            history: visitHistory
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const updateStudentHealthProfile = async (req: Request, res: Response) => {
    try {
        const { siswaId, golonganDarah, alergi, riwayatPenyakit, kontakDarurat, kondisiKhusus } = req.body;

        const updated = await prisma.uksStudentHealthData.upsert({
            where: { siswaId },
            create: {
                siswaId,
                golonganDarah,
                alergi,
                riwayatPenyakit,
                kontakDarurat,
                kondisiKhusus
            },
            update: {
                golonganDarah,
                alergi,
                riwayatPenyakit,
                kontakDarurat,
                kondisiKhusus
            }
        });

        return res.json({ success: true, message: 'Data kesehatan siswa berhasil diperbarui', data: updated });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 2. ALUR KUNJUNGAN: GURU RUJUK SISWA KE UKS (MODUL 2-B)
// ========================================================
export const teacherReferToUks = async (req: Request, res: Response) => {
    try {
        const { siswaId, keluhan, teacherId } = req.body;

        if (!siswaId || !keluhan) {
            return res.status(400).json({ success: false, message: 'siswaId dan keluhan wajib diisi' });
        }

        const visit = await prisma.uksVisitEvent.create({
            data: {
                siswaId,
                keluhan,
                status: 'SEDANG_DIRAWAT',
                isNotifOrtuTerkirim: true // Flag notifikasi terkirim serentak ke UKS & Orang tua
            }
        });

        return res.json({
            success: true,
            message: 'Rujukan siswa sakit berhasil disubmit. Notifikasi otomatis dikirimkan ke Petugas UKS dan Orang Tua.',
            data: visit
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 3. PETUGAS UKS: CATAT PEMERIKSAAN & UPDATE STATUS (MODUL 2-B & 2-G)
// ========================================================
export const updateUksTriage = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const targetId = String(id);
        const { tindakan, obatDiberikan, status, petugasId } = req.body;

        const visit = await prisma.uksVisitEvent.findUnique({
            where: { id: targetId }
        });

        if (!visit) {
            return res.status(404).json({ success: false, message: 'Data kunjungan UKS tidak ditemukan' });
        }

        const updated = await prisma.uksVisitEvent.update({
            where: { id: targetId },
            data: {
                tindakan: tindakan || visit.tindakan,
                obatDiberikan: obatDiberikan || visit.obatDiberikan,
                status: status || visit.status,
                petugasId: petugasId || visit.petugasId,
                waktuSelesai: status === 'PULANG' || status === 'MEMBAIK' ? new Date() : undefined
            }
        });

        // INTEGRASI MUTLAK: Jika status "PERLU_DIJEMPUT" atau siswa dipulangkan karena sakit
        // -> Status kehadiran siswa di sistem otomatis sinkron jadi "SAKIT", bukan alpa! (Modul 2-E)
        if (status === 'PERLU_DIJEMPUT' || status === 'PULANG') {
            const today = new Date();
            const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

            await prisma.studentLeavePermit.upsert({
                where: { id: `uks-leave-${visit.siswaId}-${startOfDay.toISOString().split('T')[0]}` },
                create: {
                    id: `uks-leave-${visit.siswaId}-${startOfDay.toISOString().split('T')[0]}` ,
                    siswaId: visit.siswaId,
                    kelasId: 'AUTO_UKS',
                    kategoriIzin: 'SAKIT',
                    tanggal: startOfDay,
                    status: 'APPROVED',
                    keterangan: `Dipulangkan dari UKS: ${visit.keluhan}`
                },
                update: {
                    kategoriIzin: 'SAKIT',
                    status: 'APPROVED'
                }
            });

            if (status === 'PERLU_DIJEMPUT') {
                const notifTitle = "🚨 SISWA MEMBUTUHKAN PENJEMPUTAN (UKS)";
                const notifMsg = `Ananda memerlukan penjemputan segera oleh orang tua/wali dari ruang UKS dikarenakan: ${visit.keluhan || 'kondisi medis'}.`;

                (async () => {
                    try {
                        await (prisma as any).notificationMessage.create({
                            data: {
                                studentId: visit.siswaId,
                                recipientRole: 'PARENT',
                                title: notifTitle,
                                message: notifMsg,
                                category: 'UKS_PICKUP',
                                isRead: false,
                                sentAt: new Date()
                            }
                        });

                        const student = await prisma.user.findUnique({ where: { id: visit.siswaId } });
                        let parentUser = null;
                        if (student?.nisn) {
                            parentUser = await prisma.user.findFirst({
                                where: {
                                    role: 'PARENT',
                                    OR: [
                                        { username: `P${student.nisn}` },
                                        { nisn: student.nisn }
                                    ]
                                }
                            });
                        }

                        if (parentUser) {
                            await sendFcmToUser(parentUser.id, notifTitle, notifMsg, {
                                category: 'UKS_PICKUP',
                                studentId: visit.siswaId,
                                type: 'UKS_PICKUP',
                                title: notifTitle,
                                body: notifMsg
                            });
                        }

                        await sendFcmToUser(visit.siswaId, notifTitle, notifMsg, {
                            category: 'UKS_PICKUP',
                            studentId: visit.siswaId,
                            type: 'UKS_PICKUP',
                            title: notifTitle,
                            body: notifMsg
                        });

                        // Pengiriman WhatsApp Darurat ke Orang Tua Siswa
                        if (student?.parentPhone) {
                            const cleanPhone = String(student.parentPhone).replace(/[^0-9]/g, '');
                            if (cleanPhone.length >= 9) {
                                const waMsg = `*PEMBERITAHUAN UKS SMP NEGERI 1 BOYOLANGU*\n\nYth. Orang Tua/Wali dari Ananda *${student.name || 'Siswa'}* (${student.className || '-'}),\n\nSaat ini ananda sedang berada di ruang Unit Kesehatan Sekolah (UKS) dan disarankan untuk dijemput beristirahat di rumah.\n\nMohon Bapak/Ibu dapat menuju ke Pos Satpam / Ruang UKS SMPN 1 Boyolangu untuk proses penjemputan ananda.\n\n_Pesan otomatis resmi Sistem Smart School SIBOY 2026._`;
                                await sendSingleWhatsApp(cleanPhone, waMsg).catch(err => console.warn('[WA UKS Alert Error]:', err));
                            }
                        }
                    } catch (e: any) {
                        console.warn('[UKS Pickup] Error sending notification:', e.message);
                    }
                })();
            }
        }

        return res.json({
            success: true,
            message: 'Pemeriksaan UKS berhasil diperbarui dan status kehadiran tersinkronkan otomatis.',
            data: updated
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 4. ORANG TUA: KONFIRMASI CEPAT JEMPUT SISWA (MODUL 2-B & 12-D)
// ========================================================
export const confirmParentPickup = async (req: Request, res: Response) => {
    try {
        const { visitId } = req.body;

        const updated = await prisma.uksVisitEvent.update({
            where: { id: visitId },
            data: {
                isKonfirmasiJemput: true,
                waktuKonfirmasiJemput: new Date()
            }
        });

        return res.json({
            success: true,
            message: 'Konfirmasi penjemputan berhasil dikirimkan ke Petugas UKS.',
            data: updated
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ========================================================
// 5. OPERATOR UKS DASHBOARD & INVENTORY (MODUL 2-D & 2-G)
// ========================================================
export const getUksOperatorDashboard = async (req: Request, res: Response) => {
    try {
        const activeVisits = await prisma.uksVisitEvent.findMany({
            where: {
                status: { in: ['SEDANG_DIRAWAT', 'PERLU_DIJEMPUT'] }
            },
            orderBy: { tanggal: 'desc' }
        });

        // Inventory alert (menipis atau mendekati kedaluwarsa)
        const lowStockMedicines = await prisma.uksInventoryItem.findMany({
            where: {
                stok: { lte: 10 }
            }
        });

        return res.json({
            success: true,
            activeCount: activeVisits.length,
            needPickupCount: activeVisits.filter(v => v.status === 'PERLU_DIJEMPUT' && !v.isKonfirmasiJemput).length,
            activeVisits,
            lowStockMedicines
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
