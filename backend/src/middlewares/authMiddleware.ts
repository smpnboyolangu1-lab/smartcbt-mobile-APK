import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { revokedUserIds } from '../controllers/adminUserController';

const getSecretKey = () => process.env.JWT_SECRET || 'cbt_prod_secret_f9a83b27c64e10d592a8174fec01849a62bc38102d7e481b9201948271039841';

export interface AuthRequest extends Request {
    user?: any;
}

/**
 * Helper ekstraksi seluruh kandidat token untuk Web SSR & API (Authorization header, ?token= param, atau cookies)
 */
export const extractAllWebTokens = (req: Request): string[] => {
    const candidates: string[] = [];
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const candidate = authHeader.substring(7).trim();
        if (candidate && candidate !== 'null' && candidate !== 'undefined') {
            candidates.push(candidate);
        }
    }
    if (req.query.token) {
        const qToken = String(req.query.token).trim();
        if (qToken && qToken !== 'null' && qToken !== 'undefined' && !candidates.includes(qToken)) {
            candidates.push(qToken);
        }
    }
    if (req.headers.cookie) {
        const cookies = req.headers.cookie.split(';');
        for (const c of cookies) {
            const [k, v] = c.trim().split('=');
            if (k === 'token' || k === 'jwt_token' || k === 'admin_token') {
                const dec = decodeURIComponent(v || '').trim();
                if (dec && dec !== 'null' && dec !== 'undefined' && !candidates.includes(dec)) {
                    candidates.push(dec);
                }
            }
        }
    }
    return candidates;
};

export const extractWebToken = (req: Request): string | null => {
    const candidates = extractAllWebTokens(req);
    // Jika ada token yang valid, utamakan yang valid
    for (const token of candidates) {
        try {
            const user = jwt.verify(token, getSecretKey());
            if (user) return token;
        } catch (e) {
            // Coba kandidat berikutnya
        }
    }
    return candidates.length > 0 ? candidates[0] : null;
};

export interface ActiveSessionInfo {
    sessionId: string;
    deviceId: string;
    loginTime: number;
}

export const activeUserSessions = new Map<string, ActiveSessionInfo>(); // userId -> ActiveSessionInfo

export const registerUserSession = (userId: string, username: string, sessionId: string, deviceId: string = '') => {
    const info: ActiveSessionInfo = { sessionId, deviceId, loginTime: Date.now() };
    activeUserSessions.set(userId, info);
    if (username) activeUserSessions.set(username, info);
};

export const clearUserSession = (userId: string, username?: string) => {
    activeUserSessions.delete(userId);
    if (username) activeUserSessions.delete(username);
};

export const getActiveUserSession = (userIdOrUsername: string): ActiveSessionInfo | undefined => {
    return activeUserSessions.get(userIdOrUsername);
};

export const authenticateJWT = (req: AuthRequest, res: Response, next: NextFunction) => {
    const candidates = extractAllWebTokens(req);

    if (candidates.length === 0) {
        return res.status(401).json({ 
            success: false,
            message: "Akses ditolak. Token tidak ditemukan.",
            code: "TOKEN_MISSING"
        });
    }

    let verifiedUser: any = null;
    let lastErrorName = 'JsonWebTokenError';

    for (const token of candidates) {
        try {
            const user: any = jwt.verify(token, getSecretKey());
            if (user) {
                verifiedUser = user;
                break;
            }
        } catch (err: any) {
            lastErrorName = err?.name || 'JsonWebTokenError';
        }
    }

    if (!verifiedUser) {
        const isExpired = lastErrorName === 'TokenExpiredError';
        return res.status(401).json({ 
            success: false,
            message: isExpired ? "Sesi telah berakhir. Silakan login kembali." : "Token tidak valid atau telah diubah.",
            code: isExpired ? "TOKEN_EXPIRED" : "TOKEN_INVALID"
        });
    }

    // 1 USER 1 LOGIN & FORCE LOGOUT ENFORCEMENT - Khusus untuk SISWA (STUDENT) di APK Android agar tidak joki ujian
    const userRole = String(verifiedUser.role || '').toUpperCase().trim();
    const isStudent = userRole === 'STUDENT' || userRole === 'SISWA';

    if (isStudent && (revokedUserIds.has(verifiedUser.id) || revokedUserIds.has(verifiedUser.username) || (verifiedUser.nisn && revokedUserIds.has(verifiedUser.nisn)))) {
        return res.status(401).json({
            success: false,
            message: "Sesi login Anda telah diputus oleh Administrator atau Operator sekolah. Silakan masuk kembali.",
            code: "FORCE_LOGOUT",
            forceLogout: true
        });
    }

    const isWebOrKiosk = Boolean(req.headers['sec-ch-ua'] || (req.headers['user-agent'] && req.headers['user-agent'].includes('Mozilla')) || req.path.includes('tap-kartu') || req.path.includes('kiosk'));

    if (isStudent && verifiedUser.sessionId && !isWebOrKiosk) {
        const activeSess = activeUserSessions.get(verifiedUser.id) || activeUserSessions.get(verifiedUser.username);
        const activeSessionId = typeof activeSess === 'string' ? activeSess : activeSess?.sessionId;
        if (activeSessionId && activeSessionId !== verifiedUser.sessionId) {
            return res.status(401).json({
                success: false,
                message: "Akun ini telah login di perangkat atau browser lain. Sistem membatasi 1 Akun untuk 1 Sesi Aktif (1 User 1 Login).",
                code: "FORCE_LOGOUT",
                forceLogout: true
            });
        }
        if (!activeSessionId) {
            registerUserSession(verifiedUser.id, verifiedUser.username, verifiedUser.sessionId);
        }
    }

    req.user = verifiedUser;
    enrichUserRolesInternal(req.user)
        .catch(err => console.warn('[authenticateJWT] enrichUserRoles warning:', err))
        .finally(() => {
            next();
        });
};

/**
 * Helper untuk melakukan enrichment peran dinamis pada objek user:
 * - Parsing rolesTambahan JSON array
 * - Deteksi wali_kelas (kelas binaan dan rombel aktif)
 * - Deteksi kelas_bk (kelas binaan Guru BK dari BkKelasPlot & Class)
 * - Deteksi kurikulum (role KURIKULUM, tugasTambahan, atau rolesTambahan 'kurikulum')
 * - Deteksi piket (tugas piket hari ini dari PiketSchedule & tugasTambahan)
 */
export const enrichUserRolesInternal = async (user: any) => {
    if (!user || !user.id) return;
    try {
        const { default: prisma } = await import('../utils/db');
        const dbUser = await (prisma as any).user.findUnique({
            where: { id: user.id },
            select: {
                id: true,
                name: true,
                username: true,
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
            name: user.name,
            username: user.username,
            role: user.role,
            rolesTambahan: user.rolesTambahan || null,
            tugasTambahan: user.tugasTambahan || null,
            className: user.className || null,
            classRole: user.classRole || null,
            teachingClasses: null,
            teachingSubject: null
        };

        if (effectiveUser.className) {
            user.className = effectiveUser.className;
        }

        // 1. Roles tambahan dari JSON DB atau JWT payload
        let rolesArr: string[] = [];
        if (effectiveUser.rolesTambahan) {
            try {
                const parsed = typeof effectiveUser.rolesTambahan === 'string'
                    ? JSON.parse(effectiveUser.rolesTambahan)
                    : effectiveUser.rolesTambahan;
                if (Array.isArray(parsed)) rolesArr.push(...parsed);
                else if (parsed) rolesArr.push(String(parsed));
            } catch (_) {
                rolesArr.push(String(effectiveUser.rolesTambahan));
            }
        }
        if (user.rolesTambahan) {
            try {
                const parsed = typeof user.rolesTambahan === 'string' ? JSON.parse(user.rolesTambahan) : user.rolesTambahan;
                if (Array.isArray(parsed)) rolesArr.push(...parsed);
            } catch (_) {}
        }
        if (Array.isArray(user.roles_tambahan)) {
            rolesArr.push(...user.roles_tambahan);
        }

        const normRole = String(effectiveUser.role || '').toUpperCase();
        const tugasUpper = String(effectiveUser.tugasTambahan || '').toUpperCase();

        // 2. Deteksi Wali Kelas
        let isWaliKelas = false;
        const waliKelasList: string[] = [];
        if (effectiveUser.className) {
            waliKelasList.push(effectiveUser.className);
            isWaliKelas = true;
        }
        if (tugasUpper.includes('WALI') || rolesArr.map(r => r.toLowerCase()).includes('wali_kelas')) {
            isWaliKelas = true;
        }

        // Cari rombel kelas di mana guru ini adalah wali kelas
        const homeroomStudents = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                homeroomTeacher: effectiveUser.name
            },
            select: { className: true },
            distinct: ['className']
        });
        for (const s of homeroomStudents) {
            if (s.className && !waliKelasList.includes(s.className)) {
                waliKelasList.push(s.className);
                isWaliKelas = true;
            }
        }
        if (effectiveUser.className && !waliKelasList.includes(effectiveUser.className)) {
            waliKelasList.push(effectiveUser.className);
            isWaliKelas = true;
        }

        if (isWaliKelas) {
            rolesArr.push('wali_kelas');
        }

        user.wali_kelas = {
            isWaliKelas,
            kelas: waliKelasList,
            kelasUtama: waliKelasList[0] || effectiveUser.className || null
        };

        // 3. Deteksi Kelas BK
        let isBk = normRole === 'COUNSELOR' || ['BK', 'GURU_BK', 'GURU BK'].includes(normRole) || user.isCounselor;
        const bkKelasList: string[] = [];

        if (isBk || rolesArr.map(r => r.toLowerCase()).includes('bk') || tugasUpper.includes('BK')) {
            isBk = true;
            rolesArr.push('bk');

            // Ambil plotting kelas binaan dari BkKelasPlot
            const bkPlots = await (prisma as any).bkKelasPlot.findMany({
                where: { guruBkId: effectiveUser.id, isActive: true },
                include: { kelas: true }
            });
            for (const p of bkPlots) {
                if (p.kelas?.name && !bkKelasList.includes(p.kelas.name)) {
                    bkKelasList.push(p.kelas.name);
                }
            }

            // Ambil dari Class counselorId atau counselorName
            const assignedClasses = await prisma.class.findMany({
                where: {
                    OR: [
                        { counselorId: effectiveUser.id },
                        { counselorName: effectiveUser.name }
                    ]
                },
                select: { name: true }
            });
            for (const ac of assignedClasses) {
                if (ac.name && !bkKelasList.includes(ac.name)) {
                    bkKelasList.push(ac.name);
                }
            }
        }

        user.isBk = isBk;
        user.kelas_bk = bkKelasList;

        // 4. Deteksi Kurikulum
        const isKurikulum = normRole === 'KURIKULUM' ||
            normRole === 'ADMIN' ||
            normRole === 'SUPERADMIN' ||
            tugasUpper.includes('KURIKULUM') ||
            rolesArr.map(r => r.toLowerCase()).includes('kurikulum');

        if (isKurikulum) {
            rolesArr.push('kurikulum');
        }
        user.isKurikulum = isKurikulum;
        user.kurikulum = isKurikulum;

        // 5. Deteksi Piket
        const todayDay = new Date().getDay();
        const piketScheduleToday = await prisma.piketSchedule.findFirst({
            where: {
                dayOfWeek: todayDay,
                isActive: true,
                OR: [
                    { teacherId: effectiveUser.id },
                    { teacher: { name: { contains: effectiveUser.name } } }
                ]
            }
        });

        const isPiket = !!piketScheduleToday || tugasUpper.includes('PIKET') || rolesArr.map(r => r.toLowerCase()).includes('piket') || normRole === 'ADMIN';
        if (isPiket) {
            rolesArr.push('piket');
        }

        user.piket = {
            isPiket,
            piketHariIni: !!piketScheduleToday || tugasUpper.includes('PIKET'),
            dayOfWeek: todayDay
        };
        user.isPiket = isPiket;

        // 6. Normalisasi roles_tambahan menjadi unik lowercase
        user.roles_tambahan = Array.from(new Set(rolesArr.map(r => String(r).toLowerCase().trim()))).filter(Boolean);
        user.availableRoles = Array.from(new Set([
            normRole,
            ...rolesArr.map(r => String(r).toUpperCase()),
            ...(isWaliKelas ? ['WALI_KELAS'] : []),
            ...(isKurikulum ? ['KURIKULUM'] : []),
            ...(isBk ? ['COUNSELOR', 'BK'] : []),
            ...(isPiket ? ['PIKET'] : []),
            ...(user.availableRoles || [])
        ]));
    } catch (enrichErr) {
        console.warn('[enrichUserRolesInternal] Warning:', enrichErr);
    }
};

/**
 * Middleware Express enrichUserRoles
 * Dapat dipasang pada rute mana pun setelah authenticateJWT
 */
export const enrichUserRoles = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user) {
        await enrichUserRolesInternal(req.user);
    }
    next();
};

export const requireRole = (roles: (string | String)[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(403).json({ message: "Akses ditolak. Anda tidak memiliki izin untuk tindakan ini." });
        }
        const userRole = String(req.user.role || '').toUpperCase().trim();
        const upperRoles = roles.map(r => String(r).toUpperCase().trim());

        // ADMIN & SUPERADMIN have global access to all API routes
        if (userRole === 'ADMIN' || userRole === 'ADMINISTRATOR' || userRole === 'SUPERADMIN') {
            return next();
        }

        // Check if role is allowed
        let isAllowed = upperRoles.includes(userRole);
        if (!isAllowed) {
            if ((upperRoles.includes('COUNSELOR') || upperRoles.includes('BK')) && (['BK', 'COUNSELOR', 'GURU_BK', 'GURU BK'].includes(userRole) || req.user.isCounselor || req.user.isBk || (Array.isArray(req.user.roles_tambahan) && req.user.roles_tambahan.includes('bk')))) isAllowed = true;
            if (upperRoles.includes('TEACHER') && ['GURU', 'KURIKULUM'].includes(userRole)) isAllowed = true;
            if (upperRoles.includes('KURIKULUM') && (['KURIKULUM', 'ADMIN', 'OPERATOR'].includes(userRole) || req.user.isKurikulum || String(req.user.tugasTambahan || '').toUpperCase().includes('KURIKULUM') || (Array.isArray(req.user.roles_tambahan) && req.user.roles_tambahan.includes('kurikulum')))) isAllowed = true;
            if (upperRoles.includes('PIKET') && (req.user.isPiket || req.user.piket?.isPiket || String(req.user.tugasTambahan || '').toUpperCase().includes('PIKET') || (Array.isArray(req.user.roles_tambahan) && req.user.roles_tambahan.includes('piket')))) isAllowed = true;
            if (upperRoles.includes('WALI_KELAS') && (req.user.wali_kelas?.isWaliKelas || String(req.user.tugasTambahan || '').toUpperCase().includes('WALI') || (Array.isArray(req.user.roles_tambahan) && req.user.roles_tambahan.includes('wali_kelas')))) isAllowed = true;
            if (upperRoles.includes('MEDICAL') && ['UKS'].includes(userRole)) isAllowed = true;
            if (upperRoles.includes('LIBRARIAN') && ['PERPUSTAKAAN'].includes(userRole)) isAllowed = true;
            if ((upperRoles.includes('SECURITY') || upperRoles.includes('SATPAM')) && (['SECURITY', 'SATPAM'].includes(userRole) || req.user.isSecurity)) isAllowed = true;
        }

        if (!isAllowed) {
            return res.status(403).json({ message: "Akses ditolak. Anda tidak memiliki izin untuk tindakan ini." });
        }
        next();
    };
};

/**
 * Menentukan URL beranda portal yang sah dan aman untuk setiap peran pengguna.
 * Mencegah pengguna tersasar atau mencoba masuk ke area portal yang bukan haknya.
 */
export const getSafeUserHome = (user: any): string => {
    if (!user) return '/?error=unauthorized';
    const role = String(user.role || '').toUpperCase().trim();
    const tugasTambahan = String(user.tugasTambahan || '').toUpperCase().trim();

    if (role === 'ADMIN' || role === 'SUPERADMIN' || role === 'ADMINISTRATOR' || String(user.username || '').toLowerCase() === 'admin') {
        return '/admin';
    }
    if (role === 'OPERATOR') {
        return '/operator';
    }
    if (role === 'KURIKULUM' || tugasTambahan.includes('KURIKULUM')) {
        return '/kurikulum';
    }
    if (role === 'TEACHER' || role === 'GURU') {
        return '/guru';
    }
    if (role === 'COUNSELOR' || role === 'BK' || role === 'GURU_BK' || user.isCounselor) {
        return '/bk';
    }
    if (role === 'MEDICAL' || role === 'UKS') {
        return '/uks';
    }
    if (role === 'LIBRARIAN' || role === 'PERPUSTAKAAN') {
        return '/perpustakaan';
    }
    if (role === 'SECURITY' || role === 'SATPAM' || user.isSecurity) {
        return '/satpam/gatepass';
    }
    if (role === 'STUDENT' || role === 'SISWA') {
        return '/siswa';
    }
    if (role === 'PARENT' || role === 'ORANGTUA' || role === 'ORANG_TUA') {
        return '/orangtua';
    }
    return '/?error=unauthorized';
};

/**
 * Pembuat middleware autentikasi SSR berdasarkan peran (roles).
 * Admin memiliki hak akses penuh ke seluruh halaman portal.
 * Jika tidak terotentikasi, otomatis redirect ke halaman login portal (/?error=unauthorized).
 * Jika peran tidak diizinkan, dialihkan (302) secara aman ke portal peran masing-masing.
 */
export const authenticateWebRoles = (allowedRoles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        const token = extractWebToken(req);

        if (!token) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(401).json({ success: false, message: 'Autentikasi login diperlukan.' });
            }
            return res.redirect('/?error=unauthorized');
        }

        jwt.verify(token, getSecretKey(), (err, decoded: any) => {
            if (err || !decoded) {
                if (req.xhr || req.headers.accept?.includes('application/json')) {
                    return res.status(401).json({ success: false, message: 'Sesi login telah berakhir.' });
                }
                return res.redirect('/?error=session_expired');
            }

            // 1 USER 1 LOGIN ENFORCEMENT FOR WEB PORTAL:
            // Sesuai instruksi sekolah, web portal, dashboard administrasi, kios tap kartu RFID,
            // dan seluruh akun staf (Admin, Operator, Guru, BK, UKS, Satpam) dibebaskan dari pembatasan 1 sesi
            // agar kegiatan monitoring ujian dan administrasi tidak terputus di browser.
            const userRoleCheck = String(decoded.role || '').toUpperCase().trim();
            const isStaffOrWebExempt = ['ADMIN', 'SUPERADMIN', 'ADMINISTRATOR', 'OPERATOR', 'TEACHER', 'GURU', 'KURIKULUM', 'COUNSELOR', 'BK', 'GURU_BK', 'MEDICAL', 'UKS', 'SECURITY', 'SATPAM', 'PARENT', 'WALI_MURID'].includes(userRoleCheck) ||
                req.path.includes('tap-kartu') || req.path.includes('kiosk');

            if (!isStaffOrWebExempt && decoded.sessionId) {
                const activeSess = activeUserSessions.get(decoded.id) || activeUserSessions.get(decoded.username);
                const activeSessionId = typeof activeSess === 'string' ? activeSess : activeSess?.sessionId;
                if (activeSessionId && activeSessionId !== decoded.sessionId) {
                    if (req.xhr || req.headers.accept?.includes('application/json')) {
                        return res.status(401).json({
                            success: false,
                            message: 'Akun Anda telah login di browser atau perangkat lain (1 User 1 Login).',
                            code: 'FORCE_LOGOUT'
                        });
                    }
                    return res.redirect('/?error=concurrent_login');
                }
                if (!activeSessionId) {
                    registerUserSession(decoded.id, decoded.username, decoded.sessionId);
                }
            }

            const userRole = String(decoded.role || '').toUpperCase().trim();
            const upperAllowed = allowedRoles.map(r => r.toUpperCase().trim());

            // 1. ADMIN & SUPERADMIN dapat mengakses SELURUH halaman portal!
            if (userRole === 'ADMIN' || userRole === 'ADMINISTRATOR' || userRole === 'SUPERADMIN') {
                req.user = decoded;
                return next();
            }

            // 2. Cek apakah role langsung terdaftar
            let isAllowed = upperAllowed.includes(userRole);

            // 3. Alias peran & Multi-role
            if (!isAllowed) {
                // Kurikulum
                if (upperAllowed.includes('KURIKULUM') && (userRole === 'KURIKULUM' || String(decoded.tugasTambahan || '').toUpperCase().includes('KURIKULUM'))) {
                    isAllowed = true;
                }
                // Guru BK / Konselor
                if (upperAllowed.includes('COUNSELOR') || upperAllowed.includes('BK')) {
                    if (['COUNSELOR', 'BK', 'GURU_BK', 'GURU BK'].includes(userRole) || decoded.isCounselor) {
                        isAllowed = true;
                    }
                }
                // Guru
                if (upperAllowed.includes('TEACHER') && ['TEACHER', 'GURU', 'KURIKULUM'].includes(userRole)) {
                    isAllowed = true;
                }
                // Medis UKS
                if (upperAllowed.includes('MEDICAL') && ['MEDICAL', 'UKS'].includes(userRole)) {
                    isAllowed = true;
                }
                // Perpustakaan
                if (upperAllowed.includes('LIBRARIAN') && ['LIBRARIAN', 'PERPUSTAKAAN'].includes(userRole)) {
                    isAllowed = true;
                }
                // Satpam / Pos Keamanan
                if (upperAllowed.includes('SECURITY') || upperAllowed.includes('SATPAM')) {
                    if (['SECURITY', 'SATPAM'].includes(userRole) || decoded.isSecurity) {
                        isAllowed = true;
                    }
                }
            }

            if (!isAllowed) {
                if (req.xhr || req.headers.accept?.includes('application/json')) {
                    return res.status(403).json({
                        success: false,
                        message: 'Akses Ditolak: Anda tidak memiliki hak akses untuk halaman ini.'
                    });
                }
                const safeHome = getSafeUserHome(decoded);
                // Cegah redirect loop jika safeHome sama dengan rute yang diminta
                if (safeHome && safeHome !== req.path && !req.originalUrl.startsWith(safeHome)) {
                    return res.redirect(safeHome);
                }
                return res.redirect('/?error=forbidden');
            }
            req.user = decoded;
            next();
        });
    };
};

/**
 * PERMANENT SECURITY LOCK FLAG:
 * Fitur Manajemen Remote, Remote Devices, Remote Files, dan Dashboard Admin Utama
 * DIKUNCI MATI (LOCKED) dan HANYA dapat diakses oleh Admin Utama (Super Admin).
 * Flag ini permanen untuk mencegah regresi hak akses di masa depan.
 */
export const REMOTE_MANAGEMENT_ADMIN_UTAMA_ONLY = true;

/**
 * Middleware KHUSUS Admin Utama (Super Admin).
 * Memblokir Operator, Guru, Siswa, dan pihak luar dari /admin dan fitur remote.
 * Jika pengguna lain mencoba masuk ke /admin, otomatis dialihkan (302) ke portal hak miliknya.
 */
export const authenticateWebAdminUtama = (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = extractWebToken(req);

    if (!token) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ success: false, message: 'Autentikasi login diperlukan.' });
        }
        return res.redirect('/?error=unauthorized');
    }

    jwt.verify(token, getSecretKey(), (err, decoded: any) => {
        if (err || !decoded) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(401).json({ success: false, message: 'Sesi login telah berakhir.' });
            }
            return res.redirect('/?error=session_expired');
        }

        const userRole = String(decoded.role || '').toUpperCase().trim();
        const username = String(decoded.username || '').toLowerCase().trim();

        // HANYA Admin Utama / Superadmin yang berhak mengakses!
        if (userRole === 'ADMIN' || userRole === 'ADMINISTRATOR' || userRole === 'SUPERADMIN' || username === 'admin') {
            req.user = decoded;
            return next();
        }

        // Pengamanan Khusus: Siapapun selain Admin Utama (Operator, Kurikulum, Guru, Siswa, Ortu, Satpam, BK, UKS)
        // DITOLAK TOTAL dan dialihkan ke portal masing-masing secara aman!
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(403).json({
                success: false,
                message: '⛔ Akses Ditolak: Fitur Manajemen Remote dan Halaman Admin Utama dikunci khusus untuk Admin Utama (Super Admin).'
            });
        }

        const safeHome = getSafeUserHome(decoded);
        return res.redirect(safeHome);
    });
};

export const authenticateWebAdminAndOperator = authenticateWebRoles(['ADMIN', 'OPERATOR']);
export const authenticateWebAdmin = authenticateWebAdminUtama; // /admin strictly Admin Utama!
export const authenticateWebOperator = authenticateWebRoles(['ADMIN', 'OPERATOR']); // /operator strictly Admin & Operator!
export const authenticateWebAkademik = authenticateWebRoles(['ADMIN', 'OPERATOR', 'KURIKULUM']); // Fitur akademik bersama Kurikulum & Operator
export const authenticateWebBk = authenticateWebRoles(['ADMIN', 'OPERATOR', 'COUNSELOR', 'BK', 'GURU_BK', 'KURIKULUM']);
export const authenticateWebGuru = authenticateWebRoles(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM']);
export const authenticateWebUks = authenticateWebRoles(['ADMIN', 'OPERATOR', 'MEDICAL', 'UKS', 'COUNSELOR']);
export const authenticateWebSatpam = authenticateWebRoles(['ADMIN', 'OPERATOR', 'SECURITY', 'SATPAM', 'COUNSELOR', 'BK']);
export const authenticateWebSiswa = authenticateWebRoles(['ADMIN', 'STUDENT']);
export const authenticateWebParent = authenticateWebRoles(['ADMIN', 'PARENT']);
export const authenticateWebKurikulum = authenticateWebRoles(['ADMIN', 'OPERATOR', 'KURIKULUM']);

export const checkKurikulumAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Pastikan user terautentikasi
    const user = req.user;
    if (!user) {
        return res.status(401).json({ success: false, message: 'Akses ditolak: Autentikasi diperlukan.' });
    }

    const roleUpper = String(user.role || '').toUpperCase();
    const tugasTambahan = String(user.tugasTambahan || '').toUpperCase();

    // 1. Super Admin, Admin, Operator, Kurikulum, Kesiswaan, dan Guru (untuk rekap KBM)
    if (
        roleUpper === 'ADMIN' ||
        roleUpper === 'SUPERADMIN' ||
        roleUpper === 'ADMINISTRATOR' ||
        roleUpper === 'OPERATOR' ||
        roleUpper === 'KURIKULUM' ||
        roleUpper === 'KESISWAAN' ||
        roleUpper === 'TEACHER' ||
        roleUpper === 'GURU' ||
        roleUpper === 'WALI_KELAS'
    ) {
        return next();
    }

    // 3. Tugas Tambahan mengandung KURIKULUM
    if (tugasTambahan.includes('KURIKULUM')) {
        return next();
    }

    // 4. Verifikasi ke Database untuk memastikan roles_tambahan
    try {
        const { default: prisma } = await import('../utils/db');
        const dbUser = await (prisma as any).user.findUnique({
            where: { id: user.id },
            select: { role: true, tugasTambahan: true, rolesTambahan: true }
        });
        if (dbUser) {
            const dbRole = String(dbUser.role || '').toUpperCase();
            const dbTugas = String(dbUser.tugasTambahan || '').toUpperCase();
            let dbRoles: string[] = [];
            if (dbUser.rolesTambahan) {
                try {
                    dbRoles = typeof dbUser.rolesTambahan === 'string' ? JSON.parse(dbUser.rolesTambahan) : dbUser.rolesTambahan;
                } catch {
                    dbRoles = [String(dbUser.rolesTambahan)];
                }
            }
            if (
                dbRole === 'ADMIN' ||
                dbRole === 'KURIKULUM' ||
                dbRole === 'OPERATOR' ||
                dbRole === 'TEACHER' ||
                dbRole === 'GURU' ||
                dbRole === 'WALI_KELAS' ||
                dbTugas.includes('KURIKULUM') ||
                dbRoles.map((r: any) => String(r).toLowerCase()).includes('kurikulum')
            ) {
                return next();
            }
        }
    } catch (dbErr) {
        console.warn('checkKurikulumAccess DB check error:', dbErr);
    }

    return res.status(403).json({
        success: false,
        message: 'Akses Ditolak: Anda tidak memiliki wewenang Tim Kurikulum.'
    });
};

export const authenticateWebPerpus = authenticateWebRoles(['ADMIN', 'OPERATOR', 'LIBRARIAN']);

export const requireExamBrowser = (req: AuthRequest, res: Response, next: NextFunction) => {
    const clientType = req.headers['x-client-type'];
    const userAgent = String(req.headers['user-agent'] || '');
    
    // Guru, Admin, Operator bebas akses
    const user = req.user;
    if (user && (user.role === 'ADMIN' || user.role === 'OPERATOR' || user.role === 'TEACHER')) {
        return next();
    }

    // Untuk Siswa: wajib melalui APK Smart School ExamBrowser
    const isExambro = clientType === 'SmartSchool-ExamBrowser' ||
                      userAgent.includes('SmartSchool-ExamBrowser') ||
                      userAgent.includes('SmartSchool-CBT') ||
                      userAgent.includes('SmartSchool') ||
                      userAgent.includes('okhttp') ||
                      userAgent.includes('Dalvik');

    if (!isExambro && user && user.role === 'STUDENT') {
        return res.status(403).json({
            success: false,
            message: 'Akses Ditolak! Ujian CBT SMPN 1 Boyolangu HANYA dapat diakses melalui Aplikasi Resmi Smart School ExamBrowser (APK). Demi menjaga integritas dan keamanan asesmen nasional, akses melalui web browser biasa diblokir.'
        });
    }
    next();
};



