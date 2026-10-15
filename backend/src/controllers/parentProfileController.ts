import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '../utils/db';
import { sendFcmToUser } from '../services/fcmService';
import { sendWhatsAppMessage } from '../services/whatsappBlastService';

export function normalizePhoneNumber(raw: string): string {
    let cleaned = (raw || '').replace(/[\s\-\(\)\.]/g, '').trim();
    if (cleaned.startsWith('+62')) cleaned = '62' + cleaned.slice(3);
    else if (cleaned.startsWith('08')) cleaned = '62' + cleaned.slice(1);
    else if (cleaned.startsWith('8')) cleaned = '62' + cleaned;
    return cleaned;
}

export function maskPhoneNumber(phone?: string | null): string {
    if (!phone || phone.length < 7) return phone || '-';
    const clean = phone.trim();
    const prefix = clean.substring(0, 4);
    const suffix = clean.substring(clean.length - 3);
    return `${prefix}****${suffix}`;
}

/**
 * 1. GET /api/parent/profile
 * Mengambil profil orang tua, hubungan (IBU/AYAH/WALI), nomor telepon (termasuk mask),
 * serta daftar anak beserta nama ibu/ayah dari data biodata dapodik.
 */
export async function getParentProfile(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const parentId = user?.id;

        if (!parentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        const parent = await prisma.user.findUnique({
            where: { id: parentId },
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                relationship: true,
                phone: true,
                parentPhone: true,
                phoneVerifiedAt: true,
                phoneUpdatedAt: true,
                profilePicUrl: true,
                createdAt: true
            }
        });

        if (!parent) {
            return res.status(404).json({ success: false, message: 'Akun orang tua tidak ditemukan.' });
        }

        // Cari data anak yang terhubung
        const cleanParentNisn = (parent.username || '').replace(/^[Pp]/, '').trim();
        const children = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                OR: [
                    { nisn: cleanParentNisn },
                    { username: cleanParentNisn },
                    ...(parent.username ? [{ username: cleanParentNisn }] : []),
                    ...(parent.phone ? [{ parentPhone: parent.phone }] : []),
                    ...(parent.parentPhone ? [{ parentPhone: parent.parentPhone }] : [])
                ]
            },
            select: {
                id: true,
                name: true,
                nisn: true,
                nis: true,
                className: true,
                motherName: true,
                fatherName: true,
                parentPhone: true,
                profilePicUrl: true
            }
        });

        // Nama default diambil dari nama ibu di biodata jika akun belum dinamai
        let defaultName = parent.name;
        if ((!defaultName || defaultName === 'Orang Tua' || defaultName.startsWith('Ibu ')) && children.length > 0 && children[0].motherName) {
            defaultName = children[0].motherName;
        }

        const activePhone = parent.phone || parent.parentPhone || (children.length > 0 ? children[0].parentPhone : null);

        // Ambil riwayat log perubahan nomor telepon
        const changeLogs = await prisma.parentPhoneChangeLog.findMany({
            where: { parentId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
                id: true,
                oldPhone: true,
                newPhone: true,
                status: true,
                createdAt: true
            }
        });

        return res.json({
            success: true,
            data: {
                id: parent.id,
                username: parent.username,
                name: defaultName,
                relationship: parent.relationship || 'IBU',
                phone: activePhone,
                phoneMasked: maskPhoneNumber(activePhone),
                isPhoneVerified: Boolean(parent.phoneVerifiedAt),
                phoneVerifiedAt: parent.phoneVerifiedAt,
                phoneUpdatedAt: parent.phoneUpdatedAt,
                children: children.map(c => ({
                    id: c.id,
                    name: c.name,
                    nisn: c.nisn,
                    nis: c.nis,
                    className: c.className,
                    motherName: c.motherName,
                    fatherName: c.fatherName,
                    profilePicUrl: c.profilePicUrl
                })),
                recentLogs: changeLogs.map(l => ({
                    id: l.id,
                    oldPhoneMasked: l.oldPhone,
                    newPhoneMasked: maskPhoneNumber(l.newPhone),
                    status: l.status,
                    date: l.createdAt
                }))
            }
        });
    } catch (error: any) {
        console.error('[ParentProfile] Error getParentProfile:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat profil: ' + error.message });
    }
}

/**
 * 2. PATCH /api/parent/profile
 * Memperbarui nama dan hubungan orang tua (IBU, AYAH, WALI).
 */
export async function updateParentProfile(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const parentId = user?.id;
        const { name, relationship } = req.body;

        if (!parentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        const updateData: any = {};
        if (name && typeof name === 'string' && name.trim().length > 0) {
            updateData.name = name.trim();
        }

        if (relationship && typeof relationship === 'string') {
            const relUpper = relationship.trim().toUpperCase();
            if (['IBU', 'AYAH', 'WALI'].includes(relUpper)) {
                updateData.relationship = relUpper;
            } else {
                return res.status(400).json({ success: false, message: 'Pilihan hubungan hanya IBU, AYAH, atau WALI.' });
            }
        }

        const updated = await prisma.user.update({
            where: { id: parentId },
            data: updateData,
            select: { id: true, name: true, relationship: true, phone: true }
        });

        return res.json({
            success: true,
            message: 'Profil orang tua berhasil diperbarui.',
            data: updated
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: 'Gagal memperbarui profil: ' + error.message });
    }
}

/**
 * 3. POST /api/parent/profile/phone/request-otp
 * Meminta perubahan nomor telepon orang tua dengan verifikasi password dan pembatasan 3x/hari.
 */
export async function requestParentPhoneOtp(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const parentId = user?.id;
        const { newPhone, password } = req.body;

        if (!parentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        if (!newPhone || !password) {
            return res.status(400).json({ success: false, message: 'Nomor telepon baru dan kata sandi wajib diisi.' });
        }

        const parent = await prisma.user.findUnique({
            where: { id: parentId }
        });

        if (!parent) {
            return res.status(404).json({ success: false, message: 'Akun orang tua tidak ditemukan.' });
        }

        // 1. Verifikasi Password Akun
        const isPasswordValid = await bcrypt.compare(password, parent.password);
        if (!isPasswordValid) {
            return res.status(403).json({ success: false, message: 'Kata sandi akun salah. Demi keamanan, masukkan kata sandi yang valid.' });
        }

        // 2. Normalisasi Nomor Telepon
        const normalized = normalizePhoneNumber(newPhone);
        if (!normalized.startsWith('62') || normalized.length < 10 || normalized.length > 15 || !/^\d+$/.test(normalized)) {
            return res.status(400).json({
                success: false,
                message: 'Format nomor telepon tidak valid. Gunakan format Indonesia yang benar (cth: 08123456789 atau +628123456789, 10-15 digit).'
            });
        }

        // 3. Batasi Maksimal 3 Kali Permintaan Per Hari
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const requestsToday = await prisma.parentPhoneChangeLog.count({
            where: {
                parentId,
                createdAt: { gte: todayStart, lte: todayEnd }
            }
        });

        if (requestsToday >= 3) {
            return res.status(429).json({
                success: false,
                message: 'Batas harian tercapai! Anda hanya dapat mengajukan perubahan nomor maksimal 3 kali dalam satu hari demi alasan keamanan.'
            });
        }

        // 4. Cek apakah nomor yang sama dipakai oleh akun lain (berbagi HP ayah & ibu)
        const existingAccountWithPhone = await prisma.user.findFirst({
            where: {
                phone: normalized,
                id: { not: parentId }
            },
            select: { id: true, name: true, relationship: true }
        });

        let sharingWarning: string | null = null;
        if (existingAccountWithPhone) {
            sharingWarning = `Pemberitahuan: Nomor ini juga terdaftar pada akun keluarga atas nama ${existingAccountWithPhone.name}. Nomor tetap diizinkan digunakan bersama.`;
        }

        // 5. Generate OTP 6 Digit
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 menit
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const userAgent = req.headers['user-agent'] || 'Android APK';

        // 6. Catat ke ParentPhoneChangeLog
        const currentPhone = parent.phone || parent.parentPhone;
        const changeLog = await prisma.parentPhoneChangeLog.create({
            data: {
                parentId,
                oldPhone: maskPhoneNumber(currentPhone),
                newPhone: normalized,
                status: 'PENDING_VERIFICATION',
                otpCode,
                otpExpiresAt,
                ipAddress: String(clientIp).replace('::ffff:', ''),
                userAgent: String(userAgent).substring(0, 200)
            }
        });

        // 7. Kirim Push Notification FCM ke Akun Orang Tua
        const maskedNew = maskPhoneNumber(normalized);
        try {
            await sendFcmToUser(
                parentId,
                '🔒 Keamanan Akun Orang Tua',
                `Permintaan ubah nomor telepon ke ${maskedNew} sedang diproses. Jika ini bukan Anda, segera hubungi pihak sekolah.`,
                { type: 'PHONE_CHANGE_REQUEST', logId: changeLog.id }
            );
        } catch (fcmErr) {}

        // 8. Kirim Pesan OTP WhatsApp (jika layanan WhatsApp aktif)
        try {
            const waMsg = `*KODE VERIFIKASI SMART SCHOOL SMPN 1 BOYOLANGU*\n\nKode OTP perubahan nomor WhatsApp akun Orang Tua Anda adalah: *${otpCode}*\n\nKode ini berlaku selama 10 menit. JANGAN berikan kode ini kepada siapa pun demi keamanan data putra/putri Anda.`;
            await sendWhatsAppMessage(normalized, waMsg).catch(() => {});
        } catch (waErr) {}

        return res.json({
            success: true,
            message: 'Kode OTP verifikasi telah dikirimkan ke nomor WhatsApp Anda.',
            data: {
                logId: changeLog.id,
                maskedPhone: maskedNew,
                warning: sharingWarning,
                expiresInSeconds: 600
            }
        });

    } catch (error: any) {
        console.error('[ParentProfile] Error requestParentPhoneOtp:', error);
        return res.status(500).json({ success: false, message: 'Gagal memproses permintaan OTP: ' + error.message });
    }
}

/**
 * 4. POST /api/parent/profile/phone/verify
 * Memverifikasi kode OTP dan menerapkan nomor baru ke User & data Siswa sebagai Single Source of Truth.
 */
export async function verifyParentPhoneOtp(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const parentId = user?.id;
        const { logId, otpCode } = req.body;

        if (!parentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        if (!otpCode) {
            return res.status(400).json({ success: false, message: 'Kode OTP wajib diisi.' });
        }

        const log = await prisma.parentPhoneChangeLog.findFirst({
            where: {
                ...(logId ? { id: logId } : {}),
                parentId,
                status: 'PENDING_VERIFICATION'
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!log) {
            return res.status(404).json({ success: false, message: 'Permintaan verifikasi tidak ditemukan atau sudah kedaluwarsa.' });
        }

        if (log.otpExpiresAt && log.otpExpiresAt < new Date()) {
            await prisma.parentPhoneChangeLog.update({
                where: { id: log.id },
                data: { status: 'EXPIRED' }
            });
            return res.status(400).json({ success: false, message: 'Kode OTP telah kedaluwarsa. Silakan minta kode baru.' });
        }

        if (log.otpCode !== String(otpCode).trim()) {
            return res.status(400).json({ success: false, message: 'Kode OTP yang Anda masukkan salah.' });
        }

        // Terapkan nomor baru secara terpadu
        const now = new Date();
        await prisma.$transaction(async (tx) => {
            // 1. Update akun User orang tua
            await tx.user.update({
                where: { id: parentId },
                data: {
                    phone: log.newPhone,
                    parentPhone: log.newPhone,
                    phoneVerifiedAt: now,
                    phoneUpdatedAt: now
                }
            });

            // 2. Update log status
            await tx.parentPhoneChangeLog.update({
                where: { id: log.id },
                data: {
                    status: 'VERIFIED',
                    otpCode: null // Bersihkan OTP setelah diverifikasi
                }
            });

            // 3. Sinkronkan ke data anak-anaknya agar WhatsApp blast dan notifikasi otomatis merujuk ke nomor valid ini
            const parentUser = await tx.user.findUnique({ where: { id: parentId } });
            const cleanParentNisn = (parentUser?.username || '').replace(/^[Pp]/, '').trim();

            await tx.user.updateMany({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { nisn: cleanParentNisn },
                        { username: cleanParentNisn }
                    ]
                },
                data: {
                    parentPhone: log.newPhone
                }
            });
        });

        // Kirim konfirmasi akhir via FCM
        try {
            await sendFcmToUser(
                parentId,
                '✅ Nomor Telepon Berhasil Diverifikasi',
                `Nomor kontak akun Orang Tua Anda telah resmi diperbarui menjadi ${maskPhoneNumber(log.newPhone)}.`,
                { type: 'PHONE_VERIFIED_SUCCESS' }
            );
        } catch (e) {}

        return res.json({
            success: true,
            message: 'Nomor telepon resmi orang tua berhasil diperbarui dan diverifikasi.',
            data: {
                phone: log.newPhone,
                phoneMasked: maskPhoneNumber(log.newPhone),
                verifiedAt: now
            }
        });

    } catch (error: any) {
        console.error('[ParentProfile] Error verifyParentPhoneOtp:', error);
        return res.status(500).json({ success: false, message: 'Gagal memverifikasi OTP: ' + error.message });
    }
}

/**
 * 5. GET /api/admin/parents/phone-audit
 * Untuk Web Portal Operator / Admin:
 * Melihat daftar nomor orang tua, status verifikasi, tanggal update, riwayat perubahan,
 * serta daftar orang tua yang belum pernah memperbarui nomor kontak.
 */
export async function getOperatorParentPhoneAudit(req: Request, res: Response) {
    try {
        const { search, status, className, page = '1' } = req.query;
        const pageSize = 25;
        const skip = (Math.max(1, parseInt(page as string, 10)) - 1) * pageSize;

        const whereClause: any = { role: 'PARENT' };

        if (status === 'VERIFIED') {
            whereClause.phoneVerifiedAt = { not: null };
        } else if (status === 'UNVERIFIED') {
            whereClause.phoneVerifiedAt = null;
        }

        if (search && typeof search === 'string') {
            whereClause.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { parentPhone: { contains: search } }
            ];
        }

        const [total, parents] = await Promise.all([
            prisma.user.count({ where: whereClause }),
            prisma.user.findMany({
                where: whereClause,
                skip,
                take: pageSize,
                orderBy: { name: 'asc' },
                select: {
                    id: true,
                    username: true,
                    name: true,
                    relationship: true,
                    phone: true,
                    parentPhone: true,
                    phoneVerifiedAt: true,
                    phoneUpdatedAt: true,
                    parentPhoneChangeLogs: {
                        orderBy: { createdAt: 'desc' },
                        take: 3,
                        select: {
                            id: true,
                            oldPhone: true,
                            newPhone: true,
                            status: true,
                            createdAt: true,
                            ipAddress: true
                        }
                    }
                }
            })
        ]);

        return res.json({
            success: true,
            total,
            page: Number(page),
            pageSize,
            data: parents.map(p => {
                const currentPhone = p.phone || p.parentPhone;
                return {
                    id: p.id,
                    username: p.username,
                    name: p.name,
                    relationship: p.relationship || 'IBU',
                    phoneMasked: maskPhoneNumber(currentPhone),
                    rawPhone: currentPhone,
                    isVerified: Boolean(p.phoneVerifiedAt),
                    verifiedAt: p.phoneVerifiedAt,
                    updatedAt: p.phoneUpdatedAt,
                    recentChangeLogs: p.parentPhoneChangeLogs.map(l => ({
                        oldPhone: l.oldPhone,
                        newPhoneMasked: maskPhoneNumber(l.newPhone),
                        status: l.status,
                        date: l.createdAt,
                        ip: l.ipAddress
                    }))
                };
            })
        });

    } catch (error: any) {
        return res.status(500).json({ success: false, message: 'Gagal memuat audit nomor orang tua: ' + error.message });
    }
}
