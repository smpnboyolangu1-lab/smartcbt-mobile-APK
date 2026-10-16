import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/db';
import { logAudit } from '../services/auditLogger';
import { revokedUserIds } from './adminUserController';
import { AuthRequest, registerUserSession, clearUserSession, getActiveUserSession } from '../middlewares/authMiddleware';
const SECRET_KEY = process.env.JWT_SECRET || 'cbt_prod_secret_f9a83b27c64e10d592a8174fec01849a62bc38102d7e481b9201948271039841';
const REFRESH_SECRET_KEY = process.env.JWT_REFRESH_SECRET || 'cbt_refresh_prod_secret_81726354a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2';

export const login = async (req: Request, res: Response) => {
    const { username, password, deviceId, role } = req.body;

    try {
        const cleanUsername = String(username || '').trim();
        const uLower = cleanUsername.toLowerCase();
        const cleanNip = cleanUsername.replace(/[\s\.\-]/g, '');
        const targetRole = String(role || '').toUpperCase().trim();

        let user = null;

        // 1. Jika mode PARENT dipilih atau username diawali huruf P
        if (targetRole === 'PARENT' || targetRole === 'ORANGTUA' || targetRole === 'ORANG_TUA' || uLower.startsWith('p')) {
            const rawNisn = cleanUsername.replace(/^[Pp]/, '').trim();
            user = await prisma.user.findFirst({
                where: {
                    role: 'PARENT',
                    OR: [
                        { username: cleanUsername },
                        { username: 'P' + rawNisn },
                        { nisn: rawNisn },
                        { nisn: cleanUsername }
                    ]
                }
            });
            // Jika akun orang tua belum ada di DB tapi siswa ada, sinkronkan otomatis
            if (!user && rawNisn) {
                const student = await prisma.user.findFirst({
                    where: {
                        role: 'STUDENT',
                        OR: [
                            { nisn: rawNisn },
                            { username: rawNisn }
                        ]
                    }
                });
                if (student) {
                    const { syncParentAccountForStudent } = require('../utils/parentAccountHelper');
                    user = await syncParentAccountForStudent(student);
                }
            }
        }

        // 2. Jika bukan PARENT atau belum ditemukan, cari berdasarkan username, NIP, atau nisn
        if (!user) {
            user = await prisma.user.findUnique({ where: { username: cleanUsername } });
        }
        if (!user && cleanNip && cleanNip !== cleanUsername) {
            user = await prisma.user.findUnique({ where: { username: cleanNip } });
        }
        if (!user) {
            user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { username: { equals: cleanUsername } },
                        { username: { equals: cleanNip } },
                        { nisn: cleanUsername },
                        { nisn: cleanNip }
                    ]
                }
            });
        }
        if (!user && (uLower === 'admin' || uLower === 'administrator')) {
            user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { role: 'ADMIN' },
                        { role: 'OPERATOR' },
                        { username: 'admin' }
                    ]
                }
            });
        }

        if (!user) {
            return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
        }

        const userRole = String(user.role || '').toUpperCase().trim();
        const isAdminUser = userRole === 'ADMIN' || userRole === 'ADMINISTRATOR' || userRole === 'SUPERADMIN' || uLower === 'admin' || uLower === 'administrator';

        // 1. Cek kecocokan password dengan hash bcrypt terlebih dahulu (prioritas utama jika password baru saja diubah)
        let isValidPassword = false;
        try {
            isValidPassword = await bcrypt.compare(password, user.password);
        } catch (e) {
            isValidPassword = false;
        }

        // Cek juga plain text match (jika database menyimpan password tanpa hash)
        if (!isValidPassword && user.password && user.password === password) {
            isValidPassword = true;
        }

        // 2. Fallback default password untuk Siswa & Orang Tua (Orang Tua login username P<NISN> password <NISN>)
        if (!isValidPassword && (userRole === 'STUDENT' || userRole === 'PARENT')) {
            const studentNisn = (user.nisn || user.username.replace(/^[Pp]/, '')).trim();
            if (userRole === 'PARENT' && studentNisn && (password === studentNisn || password === 'P' + studentNisn || password === user.username)) {
                isValidPassword = true;
            } else {
                const isDbPasswordDefault = !user.password ||
                    user.password === 'password123' ||
                    user.password === studentNisn ||
                    user.password === user.username ||
                    (await bcrypt.compare('password123', user.password).catch(() => false)) ||
                    (studentNisn ? await bcrypt.compare(studentNisn, user.password).catch(() => false) : false) ||
                    (user.username ? await bcrypt.compare(user.username, user.password).catch(() => false) : false);

                if (isDbPasswordDefault) {
                    if (studentNisn && (password === studentNisn || password === user.username)) {
                        isValidPassword = true;
                    } else if (password === 'password123') {
                        isValidPassword = true;
                    }
                }
            }
        }

        // 3. Admin fallback password: hanya aktif jika password admin di DB masih default
        if (!isValidPassword && isAdminUser && (password === 'admin' || password === 'admin123' || password === 'password123' || password === 'Admin123' || password === 'admincbt' || password === 'admincbt123')) {
            const isDbAdminDefault = !user.password ||
                user.password === 'password123' ||
                user.password === 'admin123' ||
                (await bcrypt.compare('password123', user.password).catch(() => false)) ||
                (await bcrypt.compare('admin123', user.password).catch(() => false));
            if (isDbAdminDefault) {
                isValidPassword = true;
            }
        }

        // 4. Guru / Teacher fallback password: login guru menggunakan NIP/username dan password123
        if (!isValidPassword && (userRole === 'TEACHER' || userRole === 'GURU')) {
            if (password === 'password123' || password === 'guru123' || password === 'Guru123' || password === cleanUsername || password === cleanNip) {
                isValidPassword = true;
            }
        }

        // 5. BK fallback password
        if (!isValidPassword && (uLower === 'bk' || userRole === 'COUNSELOR' || userRole === 'BK') && (password === 'bk' || password === 'bk123' || password === 'password123')) {
            isValidPassword = true;
        }

        // 6. Satpam / Security fallback password
        if (!isValidPassword && (uLower === 'satpam' || uLower === 'security' || userRole === 'SECURITY' || userRole === 'SATPAM') && (password === 'satpam' || password === 'satpam123' || password === 'security123' || password === 'password123')) {
            isValidPassword = true;
        }

        if (!isValidPassword) {
            return res.status(401).json({ message: 'Password salah.' });
        }

        if (!user.isActive) {
            return res.status(403).json({ message: 'Akun Anda dinonaktifkan.' });
        }

        // Deteksi apakah guru bertugas sebagai Guru BK / Konselor (via flag isBk, role COUNSELOR, atau tugasTambahan BK)
        let isCounselor = Boolean((user as any).isBk) || userRole === 'COUNSELOR' || userRole === 'BK' || userRole === 'GURU_BK' || uLower === 'bk';
        if (!isCounselor && userRole === 'TEACHER') {
            if ((user.teachingSubject && user.teachingSubject.toUpperCase().includes('BK')) ||
                ((user as any).tugasTambahan && String((user as any).tugasTambahan).toUpperCase().includes('BK'))) {
                isCounselor = true;
            } else {
                const assignedClass = await prisma.class.findFirst({
                    where: { OR: [{ counselorId: user.id }, { counselorName: user.name }] }
                });
                if (assignedClass) isCounselor = true;
            }
        }

        // Deteksi apakah user bertugas sebagai Petugas Keamanan / Satpam
        const isSecurityOfficer = Boolean((user as any).isSecurity) ||
            userRole === 'SECURITY' ||
            userRole === 'SATPAM' ||
            String((user as any).tugasTambahan || '').toUpperCase().includes('SATPAM') ||
            String((user as any).tugasTambahan || '').toUpperCase().includes('SECURITY');

        // Fitur Anti-Joki & Anti-Titip Absen: Device Binding Check KHUSUS Role SISWA (Dikecualikan untuk user dummy testing)
        // PERHATIAN: Guru, Wali Kelas, Staf TU/Kesiswaan, Operator, BK, Orang Tua, dan Satpam BEBAS login dari perangkat/browser mana pun.
        const incomingDeviceId = (deviceId || req.headers['x-device-id']) as string;
        const isDummyTester = user.username === 'siswa1' || user.username === 'parent';
        if (user.role === 'STUDENT' && !isDummyTester) {
            if (incomingDeviceId) {
                if (user.deviceBindingId && user.deviceBindingId !== incomingDeviceId) {
                    return res.status(403).json({ 
                        success: false,
                        message: '⛔ Akses Ditolak: Username sudah terdaftar di perangkat lain. Silakan minta reset perangkat ke Admin atau Operator sekolah.' 
                    });
                } else if (!user.deviceBindingId) {
                    // Binding pertama kali ke perangkat HP siswa
                    await prisma.user.update({
                        where: { id: user.id },
                        data: { deviceBindingId: incomingDeviceId }
                    });
                }
            } else if (user.deviceBindingId) {
                return res.status(403).json({ 
                    success: false,
                    message: '⛔ Akses Ditolak: Username sudah terdaftar di perangkat lain. Silakan minta reset perangkat ke Admin atau Operator sekolah.' 
                });
            }
        } else if (user.role !== 'STUDENT') {
            // Hapus residual deviceBindingId pada akun non-siswa (Guru, TU, BK, Satpam, Orang Tua) agar tidak pernah terkunci
            if (user.deviceBindingId) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { deviceBindingId: null }
                }).catch(() => {});
            }
        }

        // Proteksi Dobel Login (Anti-Double Login / Single Active Session Lock)
        // KHUSUS ROLE SISWA (STUDENT) untuk mencegah joki ujian dan titip absen.
        // Guru, Wali Kelas, Operator, BK, dan Orang Tua dibebaskan sepenuhnya dari batasan ini.
        const forceOverride = Boolean(req.body.forceOverride);
        const activeSess = getActiveUserSession(user.id);
        if (user.role === 'STUDENT' && !isDummyTester && activeSess && activeSess.deviceId && incomingDeviceId && activeSess.deviceId !== incomingDeviceId && !forceOverride) {
            const sessionAgeHours = (Date.now() - activeSess.loginTime) / (1000 * 60 * 60);
            if (sessionAgeHours < 24) {
                return res.status(409).json({
                    success: false,
                    code: 'DOUBLE_LOGIN_PREVENTED',
                    message: `⛔ Akun '${user.name}' saat ini sedang aktif di perangkat HP lain. Sistem membatasi 1 akun siswa hanya dapat login pada 1 perangkat. Silakan Logout terlebih dahulu pada perangkat sebelumnya sebelum login di HP ini.`
                });
            }
        }

        // Catat Last Login & update deviceSession userId jika incomingDeviceId tersedia
        if (incomingDeviceId) {
            await prisma.deviceSession.updateMany({
                where: { deviceAndroidId: incomingDeviceId },
                data: { userId: user.id }
            }).catch(() => {});
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // Hapus status revoked jika user login kembali secara sah
        revokedUserIds.delete(user.id);
        if (user.username) revokedUserIds.delete(user.username);
        if (user.nisn) revokedUserIds.delete(user.nisn);
        if (incomingDeviceId) revokedUserIds.delete(incomingDeviceId);

        // 1. Generate Access Token (7 Hari) untuk stabilitas sesi portal & APK
        const normalizedUserRole = (userRole === 'SATPAM' || userRole === 'SECURITY') ? 'SECURITY' : userRole;
        // Hitung peran tambahan (roles_tambahan & availableRoles)
        const availableRoles: string[] = [];
        const uRoleUpper = (user.role || '').toUpperCase();
        const tTambahan = ((user as any).tugasTambahan || '').toUpperCase();
        let rolesTambahanArr: string[] = [];
        if ((user as any).rolesTambahan) {
            try {
                rolesTambahanArr = typeof (user as any).rolesTambahan === 'string' ? JSON.parse((user as any).rolesTambahan) : (user as any).rolesTambahan;
            } catch {
                rolesTambahanArr = [String((user as any).rolesTambahan)];
            }
        }
        
        if (uRoleUpper === 'TEACHER' || uRoleUpper === 'GURU') {
            availableRoles.push('GURU_MAPEL');
            
            // Wali Kelas jika punya rombel atau ditugaskan di tugasTambahan
            if (user.className || tTambahan.includes('WALI') || tTambahan.includes('WALI_KELAS')) {
                availableRoles.push('WALI_KELAS');
                rolesTambahanArr.push('wali_kelas');
            }
            // Kurikulum jika role kurikulum atau ada di tugasTambahan / roles_tambahan
            if (uRoleUpper === 'KURIKULUM' || tTambahan.includes('KURIKULUM') || rolesTambahanArr.map(r => r.toLowerCase()).includes('kurikulum')) {
                availableRoles.push('KURIKULUM');
                rolesTambahanArr.push('kurikulum');
            }
            // Operator jika diberikan tugas tambahan operator oleh admin
            if (tTambahan.includes('OPERATOR') || isAdminUser) {
                availableRoles.push('OPERATOR');
                rolesTambahanArr.push('operator');
            }
            // Piket jika ada jadwal piket atau tugasTambahan piket
            const todayDay = new Date().getDay();
            const hasPiketToday = await prisma.piketSchedule.findFirst({
                where: {
                    dayOfWeek: todayDay,
                    isActive: true,
                    OR: [
                        { teacherId: user.id },
                        { teacher: { name: { contains: user.name } } }
                    ]
                }
            });
            if (hasPiketToday || tTambahan.includes('PIKET')) {
                availableRoles.push('PIKET');
                rolesTambahanArr.push('piket');
            }
            // PAI jika mapel agama Islam atau tugasTambahan PAI
            const subj = (user.teachingSubject || '').toUpperCase();
            if (subj.includes('PAI') || subj.includes('AGAMA') || subj.includes('ISLAM') || tTambahan.includes('PAI')) {
                availableRoles.push('PAI');
                rolesTambahanArr.push('pai');
            }
            // Guru BK jika tugas BK
            if (isCounselor || tTambahan.includes('BK')) {
                availableRoles.push('COUNSELOR');
                availableRoles.push('BK');
                rolesTambahanArr.push('bk');
            }
            if (isSecurityOfficer) {
                availableRoles.push('SECURITY');
                rolesTambahanArr.push('satpam');
            }
        } else if (uRoleUpper === 'OPERATOR' || isAdminUser) {
            availableRoles.push('OPERATOR');
            availableRoles.push('KURIKULUM');
            availableRoles.push('GURU_MAPEL');
            availableRoles.push('PIKET');
            availableRoles.push('COUNSELOR');
            availableRoles.push('SECURITY');
            rolesTambahanArr.push('operator', 'kurikulum', 'piket', 'bk');
        } else if (uRoleUpper === 'KURIKULUM') {
            availableRoles.push('KURIKULUM');
            availableRoles.push('GURU_MAPEL');
            rolesTambahanArr.push('kurikulum');
        } else if (uRoleUpper === 'SECURITY' || uRoleUpper === 'SATPAM' || isSecurityOfficer) {
            availableRoles.push('SECURITY');
            availableRoles.push('SATPAM');
            rolesTambahanArr.push('satpam');
        }

        const uniqueRolesTambahan = Array.from(new Set(rolesTambahanArr.map(r => String(r).toLowerCase())));

        // 1 USER 1 LOGIN: Generate unique session ID for this login and register it
        const sessionId = `${user.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        registerUserSession(user.id, user.username, sessionId);

        const effectiveRole = isAdminUser ? 'ADMIN' : (isCounselor && normalizedUserRole === 'TEACHER' ? 'COUNSELOR' : normalizedUserRole);
        const accessToken = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                sessionId,
                role: effectiveRole, 
                isCounselor,
                isSecurity: isSecurityOfficer,
                name: user.name,
                teachingSubject: user.teachingSubject,
                teachingClasses: user.teachingClasses,
                className: user.className,
                tugasTambahan: (user as any).tugasTambahan || null,
                roles_tambahan: uniqueRolesTambahan
            },
            SECRET_KEY,
            { expiresIn: '7d' }
        );

        // 2. Generate Refresh Token (30 Hari untuk menjaga sesi APK siswa tetap aktif tanpa ter-logout tiba-tiba)
        const isMobileClient = Boolean(incomingDeviceId || req.headers['x-client-type']);
        const refreshDays = isMobileClient ? 60 : 30;
        const refreshTokenStr = jwt.sign(
            { id: user.id, username: user.username, nonce: Math.random().toString(36).substring(2) + Date.now() },
            REFRESH_SECRET_KEY,
            { expiresIn: `${refreshDays}d` }
        );

        // Simpan Refresh Token ke Database
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + refreshDays);
        try {
            // 1. Bersihkan token kedaluwarsa milik user ini
            await (prisma as any).refreshToken.deleteMany({
                where: {
                    userId: user.id,
                    expiresAt: { lt: new Date() }
                }
            });

            // 2. Batasi penumpukan token per akun:
            // - Jika Siswa: Batasi 1 sesi aktif (Single Device Binding)
            // - Jika Role Lain (Guru, Admin, Ortu, BK, dll): Batasi maksimal 3 sesi aktif
            if (normalizedUserRole === 'STUDENT') {
                await (prisma as any).refreshToken.deleteMany({
                    where: { userId: user.id }
                });
            } else {
                const existingTokens = await (prisma as any).refreshToken.findMany({
                    where: { userId: user.id },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true }
                });
                if (existingTokens.length >= 3) {
                    const surplusTokens = existingTokens.slice(2);
                    const surplusIds = surplusTokens.map((t: any) => t.id);
                    await (prisma as any).refreshToken.deleteMany({
                        where: { id: { in: surplusIds } }
                    });
                }
            }

            await (prisma as any).refreshToken.create({
                data: {
                    token: refreshTokenStr,
                    userId: user.id,
                    expiresAt
                }
            });
        } catch (tokErr) {}

        await logAudit(req, 'USER_LOGIN', `User: ${user.username}`, { role: effectiveRole, name: user.name });

        registerUserSession(user.id, user.username, sessionId, incomingDeviceId || '');

        res.json({
            message: 'Login Berhasil',
            token: accessToken,
            refreshToken: refreshTokenStr,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role: normalizedUserRole,
                isBk: isCounselor,
                isSecurity: isSecurityOfficer,
                classId: user.classId,
                className: user.className,
                nisn: user.nisn,
                teachingSubject: user.teachingSubject,
                teachingClasses: user.teachingClasses,
                tugasTambahan: (user as any).tugasTambahan || (isCounselor ? 'BK' : (isSecurityOfficer ? 'SATPAM' : null)),
                roles_tambahan: uniqueRolesTambahan,
                availableRoles: availableRoles.length > 0 ? Array.from(new Set(availableRoles)) : [normalizedUserRole],
                motherName: user.motherName || null,
                fatherName: user.fatherName || null,
                isClassOfficer: Boolean((user as any).classRole && ['Ketua Kelas', 'Wakil Ketua Kelas', 'Sekretaris', 'Sekretaris 1', 'Sekretaris 2', 'Bendahara', 'Bendahara 1', 'Bendahara 2'].includes((user as any).classRole)),
                classRole: (user as any).classRole || null,
                gender: (user as any).gender || null
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
    }
};

// 3. Endpoint Refresh Token Otomatis (Saat Access Token Habis)
export const refreshTokenHandler = async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(400).json({ success: false, message: 'Refresh token wajib disertakan' });
    }

    try {
        const decoded: any = jwt.verify(refreshToken, REFRESH_SECRET_KEY);
        if (!decoded || !decoded.id) {
            return res.status(401).json({ success: false, message: 'Format refresh token tidak valid' });
        }

        const storedToken = await prisma.refreshToken.findUnique({
            where: { token: refreshToken }
        });

        if (!storedToken || storedToken.expiresAt < new Date()) {
            return res.status(401).json({ success: false, message: 'Refresh token tidak valid atau telah kedaluwarsa' });
        }

        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user || !user.isActive) {
            return res.status(403).json({ success: false, message: 'Pengguna tidak aktif atau diblokir' });
        }

        // Perpanjang masa aktif refresh token (sliding window 90 hari) agar sesi pengguna tidak putus
        const slidingDate = new Date();
        slidingDate.setDate(slidingDate.getDate() + 90);
        await (prisma as any).refreshToken.update({
            where: { id: storedToken.id },
            data: { expiresAt: slidingDate }
        }).catch(() => {});

        // Daftarkan session ID aktif
        const sessionId = `${user.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        registerUserSession(user.id, user.username, sessionId);

        // Buat access token baru lengkap dengan className, role, sessionId
        const newAccessToken = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                sessionId,
                role: user.role, 
                name: user.name,
                className: user.className,
                teachingSubject: user.teachingSubject,
                teachingClasses: user.teachingClasses,
                tugasTambahan: (user as any).tugasTambahan || null
            },
            SECRET_KEY,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token: newAccessToken,
            message: 'Access Token berhasil diperbarui'
        });
    } catch (err) {
        res.status(401).json({ success: false, message: 'Sesi kedaluwarsa, silakan login kembali' });
    }
};

// 4. Audit Log Viewer untuk Super Admin
export const getAuditLogs = async (req: Request, res: Response) => {
    try {
        const logs = await prisma.auditLog.findMany({
            take: 50,
            orderBy: { createdAt: 'desc' }
        });
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat rekam jejak audit' });
    }
};

export const resetDeviceBinding = async (req: Request, res: Response) => {
    const { studentId, nisn, username, query } = req.body;
    try {
        const searchTerm = studentId || nisn || username || query;
        if (!searchTerm) {
            return res.status(400).json({ success: false, message: 'Harap berikan ID, NISN, atau Username siswa.' });
        }

        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { id: searchTerm },
                    { nisn: searchTerm },
                    { username: searchTerm }
                ]
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: `Siswa dengan NISN / Username '${searchTerm}' tidak ditemukan.` });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { deviceBindingId: null }
        });
        await logAudit(req, 'RESET_DEVICE_BINDING', `User: ${user.name} (${user.id})`);
        res.json({ success: true, message: `Device binding untuk ${user.name} (${user.className || 'Siswa'}) berhasil di-reset.` });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Gagal mereset perangkat: ' + error.message });
    }
};

/**
 * Endpoint untuk mendapatkan access token baru berdasarkan sesi login aktif (cookie / header)
 */
export const getSessionToken = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Belum login' });
        }
        const freshToken = jwt.sign(
            {
                id: req.user.id,
                username: req.user.username,
                role: req.user.role,
                name: req.user.name,
                isCounselor: req.user.isCounselor
            },
            SECRET_KEY,
            { expiresIn: '7d' }
        );
        const cookieOptions: any = {
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        };
        res.cookie('token', freshToken, cookieOptions);
        res.cookie('admin_token', freshToken, cookieOptions);
        res.json({ success: true, token: freshToken });
    } catch (e: any) {
        res.status(500).json({ success: false, message: 'Gagal mendapatkan token sesi: ' + e.message });
    }
};

export const logout = async (req: AuthRequest, res: Response) => {
    try {
        let userId = req.user?.id || req.body?.userId;
        let username = req.user?.username || req.body?.username;
        if (!userId && req.headers.authorization) {
            try {
                const token = req.headers.authorization.replace('Bearer ', '').trim();
                const decoded: any = jwt.decode(token);
                if (decoded?.id) userId = decoded.id;
                if (decoded?.username) username = decoded.username;
            } catch (_) {}
        }

        let userRole = String(req.user?.role || '').toUpperCase().trim();
        if (!userRole && userId) {
            const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
            if (u) userRole = String(u.role || '').toUpperCase().trim();
        }
        const isStudent = userRole === 'STUDENT' || userRole === 'SISWA';

        // Hanya hapus activeUserSessions jika role adalah SISWA (Single Session Protection)
        // Guru, Wali Kelas, BK, Operator, Satpam, dan Orang Tua bebas multi-device login tanpa ter-lock
        if (userId && isStudent) {
            clearUserSession(userId, username);
        }

        // Revoke Refresh Token saat logout agar tidak menumpuk di database
        const reqRefreshToken = req.body?.refreshToken;
        if (reqRefreshToken) {
            await (prisma as any).refreshToken.deleteMany({ where: { token: reqRefreshToken } }).catch(() => {});
        } else if (userId && isStudent) {
            await (prisma as any).refreshToken.deleteMany({ where: { userId } }).catch(() => {});
        }

        res.clearCookie('token', { path: '/' });
        res.clearCookie('admin_token', { path: '/' });
        return res.json({ success: true, message: 'Berhasil logout' });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: 'Gagal logout: ' + e.message });
    }
};

/**
 * Mendapatkan seluruh peran aktif dan asosiasi dinamis pengguna saat ini
 * GET /api/auth/roles
 */
export const getUserActiveRoles = async (req: AuthRequest, res: Response) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Autentikasi login diperlukan.' });
        }

        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                rolesTambahan: true,
                tugasTambahan: true,
                className: true,
                classRole: true,
                teachingClasses: true,
                teachingSubject: true
            }
        });

        const effectiveUser = dbUser || {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            rolesTambahan: user.rolesTambahan || null,
            tugasTambahan: null,
            className: user.className || null,
            classRole: user.classRole || null,
            teachingClasses: null,
            teachingSubject: null
        };

        let parsedRolesTambahan: string[] = [];
        if (typeof effectiveUser.rolesTambahan === 'string') {
            try { parsedRolesTambahan = JSON.parse(effectiveUser.rolesTambahan); } catch (_) {}
        } else if (Array.isArray(effectiveUser.rolesTambahan)) {
            parsedRolesTambahan = effectiveUser.rolesTambahan;
        }
        if (Array.isArray(user.roles_tambahan)) {
            parsedRolesTambahan.push(...user.roles_tambahan);
        }

        const availableRoles = user.availableRoles || Array.from(new Set([
            effectiveUser.role,
            ...parsedRolesTambahan.map((r: string) => String(r).toUpperCase())
        ]));

        const userData = {
            id: effectiveUser.id,
            username: effectiveUser.username,
            name: effectiveUser.name,
            primaryRole: effectiveUser.role,
            activeRole: user.role || effectiveUser.role,
            roles: availableRoles,
            roles_tambahan: parsedRolesTambahan,
            availableRoles: availableRoles,
            wali_kelas: user.wali_kelas || { isWaliKelas: false, kelas: [] },
            kelas_bk: user.kelas_bk || [],
            isKurikulum: !!user.isKurikulum || parsedRolesTambahan.some((r: string) => r.toLowerCase() === 'kurikulum'),
            piket: user.piket || { isPiket: false, piketHariIni: false }
        };

        res.json({
            success: true,
            data: userData,
            user: userData
        });
    } catch (error: any) {
        console.error('Error in getUserActiveRoles:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat peran aktif pengguna' });
    }
};

/**
 * Berpindah peran aktif (Role Switcher) bagi pengguna multi-role
 * POST /api/auth/switch-role
 * Body: { targetRole: 'KURIKULUM' | 'WALI_KELAS' | 'TEACHER' | 'PIKET' | 'COUNSELOR' | 'OPERATOR' }
 */
export const switchActiveRole = async (req: AuthRequest, res: Response) => {
    try {
        const user = req.user;
        const { targetRole } = req.body;

        if (!user) {
            return res.status(401).json({ success: false, message: 'Autentikasi login diperlukan.' });
        }

        if (!targetRole) {
            return res.status(400).json({ success: false, message: 'targetRole wajib ditentukan.' });
        }

        const normalizedTarget = String(targetRole).toUpperCase().trim();
        const availableRoles = (user.availableRoles || []).map((r: string) => String(r).toUpperCase());
        
        let parsedRolesTambahan: string[] = [];
        if (typeof user.rolesTambahan === 'string') {
            try { parsedRolesTambahan = JSON.parse(user.rolesTambahan); } catch (_) {}
        } else if (Array.isArray(user.rolesTambahan)) {
            parsedRolesTambahan = user.rolesTambahan;
        }
        if (Array.isArray(user.roles_tambahan)) {
            parsedRolesTambahan.push(...user.roles_tambahan);
        }
        const rolesTambahan = parsedRolesTambahan.map((r: string) => String(r).toUpperCase());

        // Validasi apakah user berhak menggunakan peran ini
        const isAllowedRole =
            availableRoles.includes(normalizedTarget) ||
            rolesTambahan.includes(normalizedTarget) ||
            normalizedTarget === String(user.role).toUpperCase() ||
            user.role === 'ADMIN' ||
            user.role === 'SUPERADMIN' ||
            (normalizedTarget === 'WALI_KELAS' && (user.wali_kelas?.isWaliKelas || rolesTambahan.includes('WALI_KELAS'))) ||
            (normalizedTarget === 'KURIKULUM' && (user.isKurikulum || rolesTambahan.includes('KURIKULUM'))) ||
            (normalizedTarget === 'PIKET' && (user.isPiket || rolesTambahan.includes('PIKET'))) ||
            (normalizedTarget === 'COUNSELOR' && (user.isBk || rolesTambahan.includes('BK'))) ||
            (normalizedTarget === 'BK' && (user.isBk || rolesTambahan.includes('BK')));

        if (!isAllowedRole) {
            return res.status(403).json({
                success: false,
                message: `Akses ditolak: Anda tidak memiliki wewenang untuk peran [${normalizedTarget}].`
            });
        }

        // Buat access token baru dengan active role yang diminta
        const { iat, exp, ...cleanUser } = user;
        const newPayload = {
            ...cleanUser,
            role: normalizedTarget === 'WALI_KELAS' ? 'TEACHER' : (normalizedTarget === 'BK' ? 'COUNSELOR' : normalizedTarget),
            activeViewRole: normalizedTarget
        };

        const switchedToken = jwt.sign(newPayload, SECRET_KEY, { expiresIn: '7d' });
        res.cookie('token', switchedToken, { path: '/', maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

        res.json({
            success: true,
            message: `✅ Berhasil beralih ke peran [${normalizedTarget}].`,
            activeRole: normalizedTarget,
            data: {
                token: switchedToken,
                activeRole: normalizedTarget
            },
            token: switchedToken
        });
    } catch (error: any) {
        console.error('Error in switchActiveRole:', error);
        res.status(500).json({ success: false, message: 'Gagal beralih peran' });
    }
};