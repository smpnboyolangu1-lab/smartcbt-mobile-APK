import { Request, Response } from 'express';
import prisma from '../utils/db';
import { sendFcmToUser } from '../services/fcmService';
import { sendSingleWhatsApp } from '../services/whatsappBlastService';
import { getWibDayBounds } from '../utils/dateUtils';

// =========================================================================
// 1. SISWA AJUKAN LAYANAN UKS (DARI APK SISWA)
// =========================================================================

export const studentRequestUks = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const studentId = user?.id || req.body.studentId;
        const { complaint, incidentLocation = 'Ruang Kelas', notes } = req.body;

        if (!studentId || !complaint) {
            return res.status(400).json({ success: false, message: 'Identitas siswa dan keluhan wajib diisi' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, className: true, parentPhone: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan' });
        }

        // Buat record kunjungan UKS dengan status WAITING
        const visit = await prisma.uksVisit.create({
            data: {
                userId: studentId,
                complaint,
                incidentLocation,
                restNotes: notes,
                visitStatus: 'WAITING',
                urgencyLevel: 'NORMAL',
                disposition: 'REST_AT_UKS',
                officerName: 'Menunggu Petugas'
            }
        });

        // Broadcast realtime socket jika terpasang
        const io = (req.app as any).get('socketio');
        if (io) {
            io.emit('uks_new_request', {
                visitId: visit.id,
                studentId,
                name: student.name,
                className: student.className,
                complaint,
                location: incidentLocation,
                time: new Date()
            });
        }

        return res.json({
            success: true,
            message: 'Permintaan layanan UKS berhasil diajukan. Silakan menuju ruang UKS.',
            data: visit
        });
    } catch (err: any) {
        console.error('Error studentRequestUks:', err);
        return res.status(500).json({ success: false, message: 'Gagal mengajukan ke UKS: ' + err.message });
    }
};

// =========================================================================
// 2. STATUS & ANTREAN REAL-TIME UKS (PETUGAS PMR & PORTAL)
// =========================================================================

export const getUksQueueAndActivePatients = async (req: Request, res: Response) => {
    try {
        const { startOfDay } = getWibDayBounds(new Date());

        const visits = await prisma.uksVisit.findMany({
            where: {
                checkInTime: { gte: startOfDay },
                visitStatus: { notIn: ['FINISHED', 'BACK_TO_CLASS', 'PICKED_UP'] }
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        className: true,
                        gender: true,
                        bloodType: true,
                        allergies: true,
                        parentPhone: true
                    }
                }
            },
            orderBy: { checkInTime: 'asc' }
        });

        // Hitung statistik insiden cepat
        const inTreatmentCount = visits.filter(v => v.visitStatus === 'IN_TREATMENT' || v.visitStatus === 'AT_UKS').length;
        const restingCount = visits.filter(v => v.visitStatus === 'RESTING').length;
        const waitingPickupCount = visits.filter(v => v.visitStatus === 'WAITING_PICKUP').length;
        const referredCount = visits.filter(v => v.visitStatus === 'REFERRED').length;
        const waitingQueueCount = visits.filter(v => v.visitStatus === 'WAITING' || v.visitStatus === 'HEADING').length;

        return res.json({
            success: true,
            stats: {
                inTreatmentCount,
                restingCount,
                waitingPickupCount,
                referredCount,
                waitingQueueCount,
                totalActive: visits.length
            },
            data: visits
        });
    } catch (err: any) {
        console.error('Error getUksQueueAndActivePatients:', err);
        return res.status(500).json({ success: false, message: 'Gagal memuat antrean UKS: ' + err.message });
    }
};

// =========================================================================
// 3. CHECK-IN, OBSERVASAI & TINDAKAN DASAR (PETUGAS PMR / PEMBINA)
// =========================================================================

export const processUksPatientStatus = async (req: Request, res: Response) => {
    try {
        const visitId = String(req.params.visitId);
        const {
            visitStatus, // 'AT_UKS', 'IN_TREATMENT', 'RESTING', 'BACK_TO_CLASS', 'WAITING_PICKUP', 'PICKED_UP', 'REFERRED', 'FINISHED'
            urgencyLevel = 'NORMAL',
            category,
            temperature,
            bloodPressure,
            bedNumber,
            complaint,
            diagnosis,
            treatment,
            medicine,
            medicineQty = 1,
            restNotes,
            pickupParentPhone,
            pickupNotes
        } = req.body;

        const officer = (req as any).user;
        const officerName = officer?.name || 'Petugas PMR / UKS';
        const officerId = officer?.id || null;

        const currentVisit: any = await prisma.uksVisit.findUnique({
            where: { id: visitId },
            include: { user: true }
        });

        if (!currentVisit) {
            return res.status(404).json({ success: false, message: 'Data kunjungan UKS tidak ditemukan' });
        }

        // 1. PENGECEKAN ALERGI OBAT OTOMATIS (HARD-STOP KEAMANAN PASIEN)
        if (medicine) {
            const studentAllergies = (currentVisit.user?.allergies || '').toLowerCase();
            let studentCardAllergy = '';
            try {
                const healthCard = await (prisma as any).uksStudentHealthData.findUnique({
                    where: { siswaId: currentVisit.userId }
                });
                if (healthCard?.alergi) {
                    studentCardAllergy = healthCard.alergi.toLowerCase();
                }
            } catch (_) {}

            const combinedAllergies = `${studentAllergies} ${studentCardAllergy}`.trim();
            const medLower = String(medicine).toLowerCase();

            if (combinedAllergies && (combinedAllergies.includes(medLower) || (medLower.includes('paracetamol') && combinedAllergies.includes('paracetamol')) || (medLower.includes('aspirin') && combinedAllergies.includes('aspirin')) || (medLower.includes('amoxicillin') && combinedAllergies.includes('amoxicillin')) || (medLower.includes('antibiotik') && combinedAllergies.includes('antibiotik')))) {
                return res.status(400).json({
                    success: false,
                    message: `⚠️ PERINGATAN BAHAYA ALERGI: Siswa ${currentVisit.user?.name || 'Siswa'} memiliki riwayat alergi terhadap obat "${medicine}" (Catatan Alergi: "${combinedAllergies}"). Pemberian obat ini dibatalkan demi keselamatan pasien!`
                });
            }

            // 2. PENGECEKAN TANGGAL KADALUWARSA OBAT
            try {
                const medRecord = await (prisma as any).medicine.findFirst({
                    where: { name: { contains: medicine } }
                });
                if (medRecord && medRecord.expiryDate && new Date(medRecord.expiryDate) < new Date()) {
                    return res.status(400).json({
                        success: false,
                        message: `⚠️ PERINGATAN KADALUWARSA: Obat "${medRecord.name}" telah melewati batas tanggal kadaluwarsa (${new Date(medRecord.expiryDate).toLocaleDateString('id-ID')}). Obat kadaluwarsa tidak boleh diberikan kepada siswa!`
                    });
                }
            } catch (_) {}
        }

        const isFinishing = ['FINISHED', 'BACK_TO_CLASS', 'PICKED_UP'].includes(visitStatus);

        const updateData: any = {
            visitStatus,
            urgencyLevel,
            officerName,
            pmrOfficerId: officerId,
            pmrOfficerName: officerName
        };

        if (category) updateData.category = category;
        if (temperature !== undefined) updateData.temperature = parseFloat(temperature);
        if (bloodPressure) updateData.bloodPressure = bloodPressure;
        if (bedNumber !== undefined) updateData.bedNumber = bedNumber;
        if (complaint) updateData.complaint = complaint;
        if (diagnosis) updateData.diagnosis = diagnosis;
        if (treatment) updateData.treatment = treatment;
        if (medicine) updateData.medicine = medicine;
        if (restNotes) updateData.restNotes = restNotes;
        if (isFinishing && !currentVisit.checkOutTime) {
            updateData.checkOutTime = new Date();
        }

        // Kasus Perlu Dijemput Orang Tua
        if (visitStatus === 'WAITING_PICKUP') {
            updateData.pickupRequestedAt = new Date();
            updateData.pickupParentPhone = pickupParentPhone || currentVisit.user?.parentPhone || null;
            updateData.pickupNotes = pickupNotes || restNotes || 'Kondisi kesehatan memerlukan penjemputan.';
            updateData.parentNotified = true;
            updateData.urgencyLevel = 'URGENT';
        }

        if (visitStatus === 'PICKED_UP') {
            updateData.pickupCompletedAt = new Date();
            updateData.checkOutTime = new Date();
        }

        const updated: any = await prisma.uksVisit.update({
            where: { id: visitId },
            data: updateData,
            include: { user: true }
        });

        // 4. POTONG STOK OBAT JIKA DIBERIKAN
        if (medicine) {
            try {
                const item = await prisma.uksInventoryItem.findFirst({
                    where: { item: { contains: medicine } }
                });
                if (item && item.stok >= Number(medicineQty)) {
                    await prisma.uksInventoryItem.update({
                        where: { id: item.id },
                        data: { stok: { decrement: Number(medicineQty) } }
                    });
                }
            } catch (invErr) {
                console.warn('Gagal potong stok obat UKS:', invErr);
            }
        }

        // 5. INTEGRASI SISTEM ABSENSI KELAS
        // Jika sedang di UKS, tandai di catatan absensi siswa hari ini
        try {
            const { startOfDay, endOfDay } = getWibDayBounds(new Date());

            const todayAttendance = await prisma.attendance.findFirst({
                where: {
                    userId: updated.userId,
                    date: { gte: startOfDay, lte: endOfDay }
                }
            });

            if (todayAttendance) {
                if (['AT_UKS', 'IN_TREATMENT', 'RESTING', 'WAITING_PICKUP'].includes(visitStatus)) {
                    await prisma.attendance.update({
                        where: { id: todayAttendance.id },
                        data: { note: `[SEDANG DI UKS] Pukul ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB - ${complaint || updated.complaint}` }
                    });
                } else if (visitStatus === 'BACK_TO_CLASS') {
                    await prisma.attendance.update({
                        where: { id: todayAttendance.id },
                        data: { note: `[KEMBALI KE KELAS] Selesai layanan UKS pukul ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB` }
                    });
                }
            }
        } catch (attErr) {
            console.warn('Gagal sinkron status UKS ke absensi kelas:', attErr);
        }

        // 6. REALTIME SOCKET BROADCAST
        const io = (req.app as any).get('socketio');
        if (io) {
            io.emit('uks_status_changed', {
                visitId: updated.id,
                studentId: updated.userId,
                studentName: updated.user?.name,
                className: updated.user?.className,
                visitStatus: updated.visitStatus,
                urgencyLevel: updated.urgencyLevel,
                officerName: updated.officerName,
                time: new Date()
            });

            if (visitStatus === 'WAITING_PICKUP') {
                io.emit('uks_parent_pickup_alert', {
                    visitId: updated.id,
                    studentName: updated.user?.name,
                    className: updated.user?.className,
                    parentPhone: updated.pickupParentPhone,
                    reason: updated.pickupNotes,
                    time: new Date()
                });

                // Persist notification for parent app and send WhatsApp-like Heads-Up push via FCM
                const notifTitle = "🚨 SISWA MEMBUTUHKAN PENJEMPUTAN (UKS)";
                const notifMsg = `Ananda ${updated.user?.name || 'Siswa'} (${updated.user?.className || '-'}) saat ini berada di ruang UKS dan memerlukan penjemputan segera oleh orang tua/wali dikarenakan: ${updated.pickupNotes || 'kondisi kesehatan'}.`;

                (async () => {
                    try {
                        await (prisma as any).notificationMessage.create({
                            data: {
                                studentId: updated.userId,
                                recipientRole: 'PARENT',
                                title: notifTitle,
                                message: notifMsg,
                                category: 'UKS_PICKUP',
                                isRead: false,
                                sentAt: new Date()
                            }
                        });
                    } catch (ne: any) {
                        console.warn('[UKS Pickup] Error creating notificationMessage:', ne.message);
                    }

                    try {
                        let parentUser = null;
                        if (updated.user?.nisn) {
                            parentUser = await prisma.user.findFirst({
                                where: {
                                    role: 'PARENT',
                                    OR: [
                                        { username: `P${updated.user.nisn}` },
                                        { nisn: updated.user.nisn }
                                    ]
                                }
                            });
                        }

                        if (parentUser) {
                            await sendFcmToUser(parentUser.id, notifTitle, notifMsg, {
                                category: 'UKS_PICKUP',
                                studentId: updated.userId,
                                type: 'UKS_PICKUP',
                                title: notifTitle,
                                body: notifMsg
                            });
                        }

                        await sendFcmToUser(updated.userId, notifTitle, notifMsg, {
                            category: 'UKS_PICKUP',
                            studentId: updated.userId,
                            type: 'UKS_PICKUP',
                            title: notifTitle,
                            body: notifMsg
                        });

                        // Pengiriman WhatsApp Darurat ke Nomor Orang Tua
                        const parentPhone = updated.pickupParentPhone || updated.user?.parentPhone;
                        if (parentPhone) {
                            const cleanPhone = String(parentPhone).replace(/[^0-9]/g, '');
                            if (cleanPhone.length >= 9) {
                                const waMsg = `*PEMBERITAHUAN UKS SMP NEGERI 1 BOYOLANGU*\n\nYth. Orang Tua/Wali dari Ananda *${updated.user?.name || 'Siswa'}* (${updated.user?.className || '-'}),\n\nSaat ini ananda sedang berada di ruang Unit Kesehatan Sekolah (UKS) dan disarankan untuk dijemput beristirahat di rumah.\n\nMohon Bapak/Ibu dapat menuju ke Pos Satpam / Ruang UKS SMPN 1 Boyolangu untuk proses penjemputan ananda.\n\n_Pesan otomatis resmi Sistem Smart School SIBOY 2026._`;
                                await sendSingleWhatsApp(cleanPhone, waMsg).catch(err => console.warn('[WA UKS Alert Error]:', err));
                            }
                        }
                    } catch (fe: any) {
                        console.warn('[UKS Pickup] Error sending notification/WhatsApp:', fe.message);
                    }
                })();
            }
        }

        return res.json({
            success: true,
            message: `Status UKS siswa ${updated.user?.name || 'Siswa'} berhasil diperbarui menjadi ${visitStatus}`,
            data: updated
        });
    } catch (err: any) {
        console.error('Error processUksPatientStatus:', err);
        return res.status(500).json({ success: false, message: 'Gagal memproses pasien UKS: ' + err.message });
    }
};

// =========================================================================
// 4. JADWAL PIKET UKS & PMR (PENGELOLA: PEMBINA PMR)
// =========================================================================

export const getUksPmrDutySchedules = async (req: Request, res: Response) => {
    try {
        const schedules = await prisma.uksPmrDutySchedule.findMany({
            where: { isActive: true },
            orderBy: { dayOfWeek: 'asc' }
        });
        return res.json({ success: true, data: schedules });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const saveUksPmrDutySchedule = async (req: Request, res: Response) => {
    try {
        const { id, dayOfWeek, shiftName, startTime, endTime, roomLocation = 'Ruang UKS Utama', memberIds, memberNames } = req.body;
        const supervisorId = (req as any).user?.id || null;

        let result;
        if (id) {
            result = await prisma.uksPmrDutySchedule.update({
                where: { id },
                data: {
                    dayOfWeek,
                    shiftName,
                    startTime,
                    endTime,
                    roomLocation,
                    memberIds: typeof memberIds === 'object' ? JSON.stringify(memberIds) : memberIds,
                    memberNames: typeof memberNames === 'object' ? JSON.stringify(memberNames) : memberNames
                }
            });
        } else {
            result = await prisma.uksPmrDutySchedule.create({
                data: {
                    dayOfWeek,
                    shiftName,
                    startTime,
                    endTime,
                    roomLocation,
                    memberIds: typeof memberIds === 'object' ? JSON.stringify(memberIds) : (memberIds || '[]'),
                    memberNames: typeof memberNames === 'object' ? JSON.stringify(memberNames) : (memberNames || '[]'),
                    supervisorId
                }
            });
        }

        return res.json({ success: true, message: 'Jadwal piket UKS/PMR berhasil disimpan', data: result });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Gagal menyimpan jadwal piket: ' + err.message });
    }
};

// =========================================================================
// 5. MANAJEMEN ANGGOTA PMR & KADER UKS
// =========================================================================

export const getPmrMembers = async (req: Request, res: Response) => {
    try {
        const members = await prisma.uksPmrMember.findMany({
            include: {
                student: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        className: true,
                        gender: true,
                        parentPhone: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        return res.json({ success: true, data: members });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const assignPmrMember = async (req: Request, res: Response) => {
    try {
        const { studentId, roleTitle = 'KADER_UKS', competencies, certificates } = req.body;

        const record = await prisma.uksPmrMember.upsert({
            where: { studentId },
            update: {
                roleTitle,
                competencies: typeof competencies === 'object' ? JSON.stringify(competencies) : competencies,
                certificates: typeof certificates === 'object' ? JSON.stringify(certificates) : certificates,
                status: 'ACTIVE'
            },
            create: {
                studentId,
                roleTitle,
                competencies: typeof competencies === 'object' ? JSON.stringify(competencies) : (competencies || '["Pertolongan Pertama"]'),
                certificates: typeof certificates === 'object' ? JSON.stringify(certificates) : certificates,
                status: 'ACTIVE'
            },
            include: { student: { select: { id: true, name: true, className: true } } }
        });

        return res.json({
            success: true,
            message: `Siswa ${record.student.name} berhasil ditugaskan sebagai ${roleTitle}`,
            data: record
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Gagal menugaskan anggota PMR: ' + err.message });
    }
};

// =========================================================================
// 6. LAPORAN & INCIDENT CENTER UKS
// =========================================================================

export const getUksIncidentCenter = async (req: Request, res: Response) => {
    try {
        const incidents = await prisma.uksVisit.findMany({
            where: {
                OR: [
                    { urgencyLevel: { in: ['ALERT', 'URGENT', 'CRITICAL'] } },
                    { isFainting: true },
                    { visitStatus: { in: ['IN_TREATMENT', 'WAITING_PICKUP', 'REFERRED'] } }
                ]
            },
            include: {
                user: { select: { id: true, name: true, className: true, parentPhone: true } }
            },
            orderBy: { checkInTime: 'desc' },
            take: 30
        });

        return res.json({ success: true, data: incidents });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getComprehensiveUksReport = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, period = 'MONTHLY' } = req.query;

        let start: Date;
        if (startDate && typeof startDate === 'string') {
            start = new Date(`${startDate}T00:00:00.000+07:00`);
        } else {
            const { ymd } = getWibDayBounds(new Date());
            const [year, month] = ymd.split('-');
            start = new Date(`${year}-${month}-01T00:00:00.000+07:00`);
        }

        let end: Date;
        if (endDate && typeof endDate === 'string') {
            end = new Date(`${endDate}T23:59:59.999+07:00`);
        } else {
            end = getWibDayBounds(new Date()).endOfDay;
        }

        const visits = await prisma.uksVisit.findMany({
            where: {
                checkInTime: { gte: start, lte: end }
            },
            include: {
                user: { select: { id: true, name: true, className: true, gender: true } }
            },
            orderBy: { checkInTime: 'asc' }
        });

        const totalVisits = visits.length;
        const faintingVisits = visits.filter(v => v.isFainting).length;
        const sentHomeVisits = visits.filter(v => v.visitStatus === 'PICKED_UP' || v.disposition === 'SENT_HOME').length;
        const backToClassVisits = visits.filter(v => v.visitStatus === 'BACK_TO_CLASS' || v.disposition === 'BACK_TO_CLASS').length;
        const referredVisits = visits.filter(v => v.visitStatus === 'REFERRED' || v.disposition === 'REFERRED_HOSPITAL').length;

        // Distribusi kategori keluhan
        const categoryMap: Record<string, number> = {};
        visits.forEach(v => {
            const cat = v.category || 'LAINNYA';
            categoryMap[cat] = (categoryMap[cat] || 0) + 1;
        });

        return res.json({
            success: true,
            period,
            range: { start, end },
            summary: {
                totalVisits,
                faintingVisits,
                sentHomeVisits,
                backToClassVisits,
                referredVisits
            },
            categoryDistribution: categoryMap,
            records: visits
        });
    } catch (err: any) {
        console.error('Error getComprehensiveUksReport:', err);
        return res.status(500).json({ success: false, message: 'Gagal membuat laporan UKS: ' + err.message });
    }
};

// =========================================================================
// 8. MANAJEMEN KONTAK DARURAT & HOTLINE UKS (KONTROL DARI PORTAL KE APK)
// =========================================================================

const DEFAULT_EMERGENCY_CONTACTS = [
    { id: '1', name: 'Puskesmas Boyolangu', phone: '(0355) 321852', cleanPhone: '0355321852', icon: '🏥', category: 'Puskesmas', active: true },
    { id: '2', name: 'Ambulans Gawat Darurat (PSC 119)', phone: '119', cleanPhone: '119', icon: '🚑', category: 'Ambulans', active: true },
    { id: '3', name: 'Pos Medis & Satpam Sekolah', phone: '08123456789', cleanPhone: '08123456789', icon: '🏫', category: 'Sekolah', active: true },
    { id: '4', name: 'Polsek Boyolangu', phone: '(0355) 321110', cleanPhone: '0355321110', icon: '👮', category: 'Polisi', active: true }
];

export const getUksEmergencyContacts = async (req: Request, res: Response) => {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'uks_emergency_contacts' }
        });

        if (setting && setting.value) {
            try {
                const parsed = JSON.parse(setting.value);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return res.json({ success: true, data: parsed });
                }
            } catch (_) {}
        }

        return res.json({ success: true, data: DEFAULT_EMERGENCY_CONTACTS });
    } catch (err: any) {
        return res.json({ success: true, data: DEFAULT_EMERGENCY_CONTACTS });
    }
};

export const saveUksEmergencyContacts = async (req: Request, res: Response) => {
    try {
        const { contacts } = req.body;
        if (!contacts || !Array.isArray(contacts)) {
            return res.status(400).json({ success: false, message: 'Format data kontak tidak valid (harus array).' });
        }

        const jsonStr = JSON.stringify(contacts);

        await prisma.systemSetting.upsert({
            where: { key: 'uks_emergency_contacts' },
            create: {
                key: 'uks_emergency_contacts',
                value: jsonStr
            },
            update: {
                value: jsonStr
            }
        });

        return res.json({
            success: true,
            message: 'Kontak darurat UKS berhasil diperbarui di portal dan disinkronkan ke seluruh APK client.',
            data: contacts
        });
    } catch (err: any) {
        console.error('Error saveUksEmergencyContacts:', err);
        return res.status(500).json({ success: false, message: 'Gagal menyimpan kontak darurat: ' + err.message });
    }
};

