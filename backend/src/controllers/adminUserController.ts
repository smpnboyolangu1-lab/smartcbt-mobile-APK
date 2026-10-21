import { Request, Response } from 'express';
import prisma from '../utils/db';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import { syncParentAccountForStudent, syncAllExistingParents } from '../utils/parentAccountHelper';
import { logAudit } from '../services/auditLogger';
import { getSchoolSignatures } from '../utils/schoolSignatures';

export const getAllUsers = async (req: Request, res: Response) => {
    try {
        const { role, search } = req.query;

        const whereClause: any = {};
        if (role && role !== 'ALL') {
            whereClause.role = String(role);
        } else {
            // Sembunyikan siswa dari manajemen user (siswa dikelola terpisah di Manajemen Siswa)
            whereClause.role = { not: 'STUDENT' };
        }

        // PENGAMANAN KHUSUS SUPER ADMIN:
        // Akun Super Admin Utama (username 'admin', 'superadmin', role 'SUPERADMIN') disembunyikan
        // dari daftar user agar tidak dapat dilihat, diubah, atau dihapus oleh pihak lain.
        whereClause.AND = [
            { username: { notIn: ['admin', 'superadmin', 'administrator'] } },
            { role: { notIn: ['SUPERADMIN'] } }
        ];

        if (search && typeof search === 'string') {
            whereClause.OR = [
                { name: { contains: search } },
                { username: { contains: search } },
                { className: { contains: search } }
            ];
        }

        const users = await prisma.user.findMany({
            where: whereClause,
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                isActive: true,
                isBk: true,
                isSecurity: true,
                tugasTambahan: true,
                rolesTambahan: true,
                teachingClasses: true,
                className: true,
                nis: true,
                nisn: true,
                parentPhone: true,
                profilePicUrl: true,
                createdAt: true
            },
            orderBy: [
                { role: 'asc' },
                { name: 'asc' }
            ]
        });

        const safeUsers = users.filter(u => 
            !['admin', 'superadmin', 'administrator'].includes((u.username || '').toLowerCase().trim()) && 
            (u.role || '').toUpperCase() !== 'SUPERADMIN'
        );

        res.json(safeUsers);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Gagal mengambil data pengguna' });
    }
};

export const createUser = async (req: Request, res: Response) => {
    try {
        const { username, name, password, role, className, parentPhone, nisn, nis, isBk, isSecurity, tugasTambahan, teachingClasses } = req.body;

        if (!username || !name || !role) {
            return res.status(400).json({ message: 'Username, Nama, dan Role wajib diisi' });
        }

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) {
            return res.status(400).json({ message: 'Username sudah digunakan oleh akun lain' });
        }

        const normalizedRole = (String(role).toUpperCase() === 'SATPAM') ? 'SECURITY' : role;
        const defaultPass = (normalizedRole === 'SECURITY') ? 'satpam123' : 'password123';
        const hashedPassword = await bcrypt.hash(password || defaultPass, 10);
        const studentNisn = (normalizedRole === 'STUDENT') ? (nisn || username) : (nisn || null);

        const isKurikulum = Boolean(req.body.isKurikulum || normalizedRole === 'KURIKULUM' || (tugasTambahan && String(tugasTambahan).toUpperCase().includes('KURIKULUM')));
        const initialRolesTambahan: string[] = [];
        if (isKurikulum) initialRolesTambahan.push('kurikulum');
        if (normalizedRole === 'COUNSELOR' || isBk) initialRolesTambahan.push('bk');
        if (normalizedRole === 'SECURITY' || isSecurity) initialRolesTambahan.push('satpam');

        let finalTugasTambahan = tugasTambahan || (normalizedRole === 'SECURITY' ? 'SATPAM' : null);
        if (isKurikulum) {
            if (!finalTugasTambahan) finalTugasTambahan = 'KURIKULUM';
            else if (!finalTugasTambahan.toUpperCase().includes('KURIKULUM')) finalTugasTambahan += ',KURIKULUM';
        }

        const newUser = await prisma.user.create({
            data: {
                username,
                password: hashedPassword,
                name,
                role: normalizedRole,
                isBk: normalizedRole === 'COUNSELOR' || Boolean(isBk),
                isSecurity: normalizedRole === 'SECURITY' || Boolean(isSecurity),
                tugasTambahan: finalTugasTambahan,
                rolesTambahan: initialRolesTambahan.length > 0 ? JSON.stringify(initialRolesTambahan) : null,
                teachingClasses: teachingClasses || null,
                className: className || null,
                parentPhone: parentPhone || null,
                nisn: studentNisn ? String(studentNisn) : null,
                nis: nis ? String(nis) : null,
                isActive: true
            }
        });

        // Otomatis buat akun orang tua jika pengguna baru adalah Siswa dan memiliki NISN
        if (normalizedRole === 'STUDENT' && studentNisn) {
            await syncParentAccountForStudent(newUser);
        }

        res.json({ message: 'Pengguna berhasil dibuat', user: newUser });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ message: 'Gagal membuat pengguna baru' });
    }
};

export const updateUserRoleAndStatus = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { role, isActive, name, username, className, nisn, profilePicBase64, profilePicUrl, password, isBk, isSecurity, tugasTambahan, teachingClasses } = req.body;

        const oldUser = await prisma.user.findUnique({ where: { id } });
        if (!oldUser) {
            return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
        }
        if (oldUser.username === 'admin' || oldUser.role === 'SUPERADMIN' || oldUser.username.toLowerCase() === 'admin') {
            return res.status(403).json({ success: false, message: '⛔ Akun Super Admin Utama dilindungi dan tidak dapat diubah melalui panel ini!' });
        }
        const oldNisn = oldUser?.nisn;

        const dataToUpdate: any = {};
        if (role) {
            const normRole = String(role).toUpperCase() === 'SATPAM' ? 'SECURITY' : role;
            dataToUpdate.role = normRole;
            if (normRole === 'SECURITY') dataToUpdate.isSecurity = true;
            if (normRole === 'COUNSELOR') dataToUpdate.isBk = true;
        }
        if (typeof isBk === 'boolean') dataToUpdate.isBk = isBk;
        if (typeof isSecurity === 'boolean') dataToUpdate.isSecurity = isSecurity;
        if (tugasTambahan !== undefined) dataToUpdate.tugasTambahan = tugasTambahan || null;
        if (teachingClasses !== undefined) dataToUpdate.teachingClasses = teachingClasses || null;
        if (typeof isActive === 'boolean') dataToUpdate.isActive = isActive;
        if (name) dataToUpdate.name = name;
        if (username) dataToUpdate.username = username;

        // Sinkronisasi peran kurikulum
        const isKurikulum = req.body.isKurikulum || String(role).toUpperCase() === 'KURIKULUM' || (tugasTambahan && String(tugasTambahan).toUpperCase().includes('KURIKULUM'));
        if (isKurikulum) {
            let rolesArr: string[] = [];
            try {
                if (oldUser.rolesTambahan) rolesArr = JSON.parse(oldUser.rolesTambahan);
            } catch(e) {}
            if (!rolesArr.includes('kurikulum')) rolesArr.push('kurikulum');
            dataToUpdate.rolesTambahan = JSON.stringify(rolesArr);
            if (!dataToUpdate.tugasTambahan) dataToUpdate.tugasTambahan = 'KURIKULUM';
            else if (!dataToUpdate.tugasTambahan.includes('KURIKULUM')) dataToUpdate.tugasTambahan += ',KURIKULUM';
        } else if (req.body.isKurikulum === false) {
            let rolesArr: string[] = [];
            try {
                if (oldUser.rolesTambahan) rolesArr = JSON.parse(oldUser.rolesTambahan);
            } catch(e) {}
            rolesArr = rolesArr.filter(r => r !== 'kurikulum');
            dataToUpdate.rolesTambahan = JSON.stringify(rolesArr);
            if (dataToUpdate.tugasTambahan) {
                dataToUpdate.tugasTambahan = dataToUpdate.tugasTambahan.split(',').map((s: string) => s.trim()).filter((s: string) => s !== 'KURIKULUM').join(',');
            }
        }
        if (nisn !== undefined) dataToUpdate.nisn = nisn ? String(nisn) : null;
        if (className !== undefined) dataToUpdate.className = className || null;
        if (password && String(password).trim().length > 0) {
            dataToUpdate.password = await bcrypt.hash(String(password).trim(), 10);
            dataToUpdate.deviceBindingId = null;
        }

        // Upload Foto Profil jika dikirim base64
        if (profilePicBase64) {
            try {
                const uploadDir = path.resolve(process.cwd(), 'uploads/avatars');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                const safeName = `avatar_${id}_${Date.now()}.jpg`;
                const targetPath = path.join(uploadDir, safeName);
                const cleanBase64 = String(profilePicBase64).replace(/^data:.*?;base64,/, '');
                fs.writeFileSync(targetPath, Buffer.from(cleanBase64, 'base64'));
                dataToUpdate.profilePicUrl = `/uploads/avatars/${safeName}`;
            } catch (fileErr) {
                console.error('Error saving student avatar by admin:', fileErr);
            }
        } else if (profilePicUrl !== undefined) {
            dataToUpdate.profilePicUrl = profilePicUrl;
        }

        const updated = await prisma.user.update({
            where: { id },
            data: dataToUpdate
        });

        // Jika siswa, sinkronisasi otomatis akun orang tua (jika NISN berubah, akun ortu ikut berubah)
        if (updated.role === 'STUDENT') {
            await syncParentAccountForStudent(updated, oldNisn);
        }

        res.json({ success: true, message: 'Data pengguna ' + updated.name + ' berhasil diperbarui (Role: ' + updated.role + ')', user: updated });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui pengguna' });
    }
};

// Import Siswa massal (Excel/CSV/JSON) dengan pembuatan akun orang tua otomatis
export const importStudents = async (req: Request, res: Response) => {
    try {
        const { students } = req.body;
        if (!Array.isArray(students) || students.length === 0) {
            return res.status(400).json({ success: false, message: 'Data siswa berupa array wajib dikirim.' });
        }

        let importedCount = 0;
        let parentCount = 0;
        const defaultPassword = await bcrypt.hash('password123', 10);

        for (const s of students) {
            const rawNisn = s.nisn || s.username;
            if (!rawNisn || (!s.name && !s.nama)) continue;
            const nisn = String(rawNisn).trim();
            const studentName = String(s.name || s.nama).trim();
            const className = s.className || s.kelas || null;
            const parentPhone = s.parentPhone || s.no_hp || null;
            const nis = s.nis ? String(s.nis).trim() : null;

            const existingStudent = await prisma.user.findFirst({
                where: { OR: [{ username: nisn }, { nisn: nisn }] }
            });
            const oldNisn = existingStudent?.nisn;

            const studentRecord = await prisma.user.upsert({
                where: { username: nisn },
                update: {
                    name: studentName,
                    nisn: nisn,
                    nis: nis || existingStudent?.nis || null,
                    className: className || existingStudent?.className || null,
                    parentPhone: parentPhone || existingStudent?.parentPhone || null,
                    role: 'STUDENT',
                    isActive: true
                },
                create: {
                    username: nisn,
                    password: defaultPassword,
                    name: studentName,
                    nisn: nisn,
                    nis: nis,
                    className: className,
                    parentPhone: parentPhone,
                    role: 'STUDENT',
                    isActive: true
                }
            });
            importedCount++;

            // Otomatis sinkronisasi akun orang tua dengan format P(NISN) dan password NISN
            const parent = await syncParentAccountForStudent(studentRecord, oldNisn);
            if (parent) parentCount++;
        }

        res.json({
            success: true,
            message: `Berhasil mengimpor ${importedCount} siswa dan otomatis membuat/memperbarui ${parentCount} akun orang tua (P + NISN).`,
            importedCount,
            parentCount
        });
    } catch (error) {
        console.error('Error importing students:', error);
        res.status(500).json({ success: false, message: 'Gagal mengimpor data siswa.' });
    }
};

// Pemicu sinkronisasi manual seluruh akun orang tua dari database siswa
export const triggerSyncParents = async (req: Request, res: Response) => {
    try {
        const result = await syncAllExistingParents();
        res.json({
            success: true,
            message: `Sinkronisasi selesai! ${result.parentsCreatedOrUpdated} akun orang tua (P + NISN) berhasil dibuat/diverifikasi.`,
            ...result
        });
    } catch (error) {
        console.error('Error in triggerSyncParents:', error);
        res.status(500).json({ success: false, message: 'Gagal melakukan sinkronisasi akun orang tua.' });
    }
};

export const resetUserPassword = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { newPassword, targetRole } = req.body;

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
        }
        if (user.username === 'admin' || user.role === 'SUPERADMIN' || user.username.toLowerCase() === 'admin') {
            return res.status(403).json({ success: false, message: '⛔ Password Super Admin Utama dilindungi dan tidak dapat di-reset melalui panel ini!' });
        }

        let pwdToSet = newPassword;
        let message = '';

        if (user.role === 'PARENT') {
            const studentNisn = user.nisn || user.username.replace(/^[Pp]/, '').trim();
            pwdToSet = (newPassword && newPassword.trim()) || studentNisn || 'password123';
            const hashedPassword = await bcrypt.hash(pwdToSet, 10);
            await prisma.user.update({
                where: { id: user.id },
                data: { password: hashedPassword, deviceBindingId: null }
            });
            message = `Password Orang Tua (${user.username}) berhasil di-reset menjadi: ${pwdToSet}`;
        } else if (user.role === 'STUDENT') {
            // If requested to reset associated parent specifically
            if (targetRole === 'PARENT') {
                const parentUsername = 'P' + (user.nisn || user.username);
                const parent = await prisma.user.findUnique({ where: { username: parentUsername } });
                if (parent) {
                    const parentPwd = (newPassword && newPassword.trim()) || user.nisn || 'password123';
                    const parentHash = await bcrypt.hash(parentPwd, 10);
                    await prisma.user.update({
                        where: { id: parent.id },
                        data: { password: parentHash, deviceBindingId: null }
                    });
                    message = `Password akun Orang Tua (${parentUsername}) berhasil di-reset menjadi: ${parentPwd}`;
                } else {
                    message = `Akun Orang Tua (${parentUsername}) belum terdaftar.`;
                }
            } else {
                // Reset Student password
                pwdToSet = (newPassword && newPassword.trim()) || user.nisn || 'password123';
                const hashedPassword = await bcrypt.hash(pwdToSet, 10);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { password: hashedPassword, deviceBindingId: null }
                });
                message = `Password Siswa (${user.name}) berhasil di-reset menjadi: ${pwdToSet} dan ikatan HP berhasil dibebaskan.`;

                // If targetRole is BOTH, also reset parent password to NISN
                if (targetRole === 'BOTH' && user.nisn) {
                    const parentUsername = 'P' + user.nisn;
                    const parent = await prisma.user.findUnique({ where: { username: parentUsername } });
                    if (parent) {
                        const parentHash = await bcrypt.hash(user.nisn, 10);
                        await prisma.user.update({
                            where: { id: parent.id },
                            data: { password: parentHash, deviceBindingId: null }
                        });
                        message += ` Password Orang Tua (${parentUsername}) juga di-reset ke NISN: ${user.nisn}.`;
                    }
                }
            }
        } else {
            // Other roles (TEACHER, ADMIN, OPERATOR, etc.)
            pwdToSet = (newPassword && newPassword.trim()) ? newPassword.trim() : (user.username === 'admin' ? 'admin123' : 'password123');
            const hashedPassword = await bcrypt.hash(pwdToSet, 10);
            await prisma.user.update({
                where: { id: user.id },
                data: { password: hashedPassword, deviceBindingId: null }
            });
            message = `Password ${user.name} berhasil di-reset menjadi: ${pwdToSet}`;
        }

        res.json({ success: true, message });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ success: false, message: 'Gagal mereset password pengguna' });
    }
};

// Helper pembersih seluruh relasi foreign key pengguna (Cascade Cleanup)
export const cascadeDeleteUserData = async (userId: string) => {
    // 1. Lepas status Guru BK & Wali dari rombel kelas
    await prisma.class.updateMany({
        where: { counselorId: userId },
        data: { counselorId: null, counselorName: null }
    }).catch(() => {});
    try {
        await (prisma.class as any).updateMany({
            where: { homeroomTeacherId: userId },
            data: { homeroomTeacherId: null }
        });
    } catch(he) {}
    try {
        await (prisma as any).studentPrayer?.deleteMany({ where: { studentId: userId } });
    } catch(pe) {}

    // 2. Presensi / Kehadiran
    await prisma.attendance.deleteMany({ where: { userId } }).catch(() => {});

    // 3. Rekam Ujian CBT Siswa
    await prisma.studentExam.deleteMany({ where: { userId } }).catch(() => {});

    // 4. Pengumpulan Tugas / PR Siswa
    await prisma.homeworkSubmission.deleteMany({ where: { userId } }).catch(() => {});

    // 5. Rekam Medis UKS & Pengukuran Antropometri
    await prisma.uksVisit.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.studentHealthMeasurement.deleteMany({ where: { studentId: userId } }).catch(() => {});

    // 6. Sirkulasi Perpustakaan: Kembalikan eksemplar buku yang sedang dipinjam ke status AVAILABLE
    await prisma.bookCopy.updateMany({
        where: { currentBorrowerId: userId },
        data: {
            currentBorrowerId: null,
            currentBorrowerName: null,
            currentBorrowerClass: null,
            currentBorrowerNisn: null,
            borrowedAt: null,
            dueDate: null,
            status: 'AVAILABLE'
        }
    }).catch(() => {});
    await prisma.libraryBorrowing.deleteMany({ where: { userId } }).catch(() => {});

    // 7. Konseling & Bimbingan Karir BK
    await prisma.bkConsultation.deleteMany({
        where: { OR: [{ studentId: userId }, { counselorId: userId }] }
    }).catch(() => {});
    await prisma.counselingSession.deleteMany({ where: { studentId: userId } }).catch(() => {});
    await prisma.careerAssessment.deleteMany({ where: { studentId: userId } }).catch(() => {});

    // 8. Catatan Disiplin & Surat Peringatan Siswa
    await prisma.disciplineRecord.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.disciplineWarningLetter.deleteMany({ where: { userId } }).catch(() => {});

    // 9. Jadwal Piket, E-Files Dokumen (termasuk file fisik di disk), Sesi Perangkat & Refresh Token
    await prisma.piketSchedule.deleteMany({ where: { teacherId: userId } }).catch(() => {});
    
    // Hapus berkas fisik e-file jika ada di direktori uploads
    try {
        const userEFiles = await prisma.eFile.findMany({ where: { userId } });
        for (const ef of userEFiles) {
            if (ef.fileUrl && ef.fileUrl.startsWith('/uploads/')) {
                const rel = ef.fileUrl.replace(/^\//, '');
                const abs = path.resolve(process.cwd(), rel);
                if (fs.existsSync(abs)) {
                    try { fs.unlinkSync(abs); } catch (e) {}
                }
            }
        }
    } catch (eFEx) {}
    await prisma.eFile.deleteMany({ where: { userId } }).catch(() => {});

    // Bersihkan sesi KBM kelas, izin siswa, rekam UKS & BK, dan link orang tua
    try {
        await (prisma as any).classPeriodAttendance?.deleteMany({ where: { studentId: userId } });
    } catch (cpaE) {}
    try {
        await prisma.studentLeaveRequest.deleteMany({ where: { studentId: userId } });
    } catch (slrE) {}
    try {
        await (prisma as any).studentLeavePermit?.deleteMany({ where: { siswaId: userId } });
    } catch (slpE) {}
    try {
        await (prisma as any).uksVisitEvent?.deleteMany({ where: { siswaId: userId } });
    } catch (uveE) {}
    try {
        await (prisma as any).bkCaseRecord?.deleteMany({ where: { siswaId: userId } });
        await (prisma as any).bkViolationPointRecord?.deleteMany({ where: { siswaId: userId } });
        await (prisma as any).bkCounselingBooking?.deleteMany({ where: { siswaId: userId } });
    } catch (bkE) {}
    try {
        await (prisma as any).parentStudentLink?.deleteMany({ where: { studentId: userId } });
    } catch (pslE) {}
    try {
        await (prisma as any).registeredDevice?.deleteMany({ where: { userId } });
        await (prisma as any).deviceFile?.deleteMany({ where: { userId } });
    } catch (devE) {}

    // Bersihkan relasi tambahan yang merujuk ke User id
    try { await (prisma as any).studentPrayerAttendance?.deleteMany({ where: { studentId: userId } }); } catch(e) {}
    try { await (prisma as any).studentSubjectAttendance?.deleteMany({ where: { studentId: userId } }); } catch(e) {}
    try { await (prisma as any).electionAttendance?.deleteMany({ where: { studentId: userId } }); } catch(e) {}
    try { await (prisma as any).studentBookAssignment?.deleteMany({ where: { studentId: userId } }); } catch(e) {}
    try { await (prisma as any).studentLeave?.deleteMany({ where: { studentId: userId } }); } catch(e) {}
    try { await (prisma as any).studentProfileSubmission?.deleteMany({ where: { OR: [{ studentId: userId }, { parentId: userId }] } }); } catch(e) {}
    try { await (prisma as any).teachingSession?.deleteMany({ where: { teacherId: userId } }); } catch(e) {}
    try { await (prisma as any).gatepassRequest?.deleteMany({ where: { OR: [{ studentId: userId }, { approvedByBkId: userId }, { checkoutSatpamId: userId }] } }); } catch(e) {}
    try { await (prisma as any).bkActiveToken?.deleteMany({ where: { bkUserId: userId } }); } catch(e) {}
    try { await (prisma as any).bkKelasPlot?.deleteMany({ where: { guruBkId: userId } }); } catch(e) {}
    try { await (prisma as any).examParticipant?.deleteMany({ where: { userId } }); } catch(e) {}
    try { await (prisma as any).examSeating?.deleteMany({ where: { userId } }); } catch(e) {}
    try { await (prisma as any).attendanceAnomalyLog?.deleteMany({ where: { userId } }); } catch(e) {}
    try { await (prisma as any).vote?.deleteMany({ where: { studentId: userId } }); } catch(e) {}
    try { await (prisma as any).packageBookBorrowing?.deleteMany({ where: { studentId: userId } }); } catch(e) {}

    try { await (prisma as any).copyRequest?.deleteMany({ where: { device: { userId } } }); } catch(e) {}
    try { await (prisma as any).deviceFile?.deleteMany({ where: { device: { userId } } }); } catch(e) {}
    await prisma.deviceSession.deleteMany({ where: { userId } }).catch(() => {});
    try {
        await (prisma as any).refreshToken?.deleteMany({ where: { userId } });
    } catch(tokErr) {}

    // 10. Hapus akun pengguna utama secara aman
    try {
        await prisma.user.delete({ where: { id: userId } });
    } catch (delErr: any) {
        await prisma.user.deleteMany({ where: { id: userId } });
    }
};

export const deleteUser = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
        }
        if (user.username === 'admin' || user.role === 'SUPERADMIN' || user.username.toLowerCase() === 'admin') {
            return res.status(403).json({ success: false, message: '⛔ Akun Super Admin Utama dilindungi dan tidak dapat dihapus!' });
        }

        // Cegah menghapus akun sendiri yang sedang login
        const loggedInUser = (req as any).user;
        if (loggedInUser && loggedInUser.id === id) {
            return res.status(400).json({ success: false, message: 'Anda tidak dapat menghapus akun Anda sendiri saat sedang login.' });
        }

        // Cegah menghapus siswa yang masih memiliki saldo kantin
        if (Number(user.canteenBalance || 0) > 0) {
            return res.status(400).json({
                success: false,
                code: 'CANTEEN_BALANCE_REMAINING',
                message: `⛔ Siswa ${user.name} masih memiliki saldo E-Kantin sebesar Rp ${Number(user.canteenBalance).toLocaleString('id-ID')}. Selesaikan penarikan/refund saldo terlebih dahulu sebelum menghapus akun.`
            });
        }

        // Cegah menghapus siswa yang memiliki gatepass aktif berjalan
        const activeGatepass = await (prisma as any).gatepassRequest.findFirst({
            where: { studentId: id, status: { in: ['PENDING', 'ACTIVE_APPROVED', 'WAITING_BK_SCAN'] } }
        });
        if (activeGatepass) {
            return res.status(400).json({
                success: false,
                code: 'ACTIVE_GATEPASS_EXISTS',
                message: `⛔ Siswa ${user.name} memiliki izin keluar gerbang (Gatepass) yang masih aktif. Selesaikan izin terlebih dahulu.`
            });
        }

        // Bersihkan seluruh relasi foreign key & hapus user
        await cascadeDeleteUserData(id);

        await logAudit(req, 'USER_DELETE', `Pengguna ${user.name} (${user.username}, Role: ${user.role}) telah dihapus`, { deletedId: id });

        res.json({ success: true, message: `✅ Pengguna ${user.name} (${user.username}) berhasil dihapus permanen.` });
    } catch (error: any) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus pengguna: ' + (error.message || 'Terjadi kesalahan sistem') });
    }
};

// Fitur Hapus Masal (Bulk Delete Users)
export const bulkDeleteUsers = async (req: Request, res: Response) => {
    try {
        const { userIds } = req.body;
        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Daftar ID pengguna (array) wajib dikirim.' });
        }

        const loggedInUser = (req as any).user;
        const loggedInId = loggedInUser?.id;

        let deletedCount = 0;
        const errors: string[] = [];

        for (const id of userIds) {
            if (id === loggedInId) {
                errors.push(`Akun Anda sendiri (${loggedInUser?.username || id}) dilewati demi keamanan.`);
                continue;
            }

            try {
                const user = await prisma.user.findUnique({ where: { id } });
                if (!user) continue;

                if (Number(user.canteenBalance || 0) > 0) {
                    errors.push(`Pengguna ${user.name} (${user.username}) dilewati karena masih memiliki saldo E-Kantin Rp ${Number(user.canteenBalance).toLocaleString('id-ID')}.`);
                    continue;
                }

                await cascadeDeleteUserData(id);
                deletedCount++;
            } catch (err: any) {
                errors.push(`Gagal menghapus ID ${id}: ${err.message}`);
            }
        }

        await logAudit(req, 'USER_BULK_DELETE', `Hapus masal ${deletedCount} pengguna`, { userIds, deletedCount, errors });

        res.json({
            success: true,
            message: `Berhasil menghapus ${deletedCount} pengguna secara permanen.${errors.length > 0 ? ' (' + errors.join(', ') + ')' : ''}`,
            deletedCount,
            errors
        });
    } catch (error: any) {
        console.error('Error in bulkDeleteUsers:', error);
        res.status(500).json({ success: false, message: 'Gagal melakukan hapus masal pengguna: ' + (error.message || 'Terjadi kesalahan sistem') });
    }
};


export const getStudents = async (req: Request, res: Response) => {
    try {
        const { search, className, tingkat } = req.query;
        const whereClause: any = { role: 'STUDENT' };

        if (className && className !== 'ALL') {
            whereClause.className = String(className);
        } else if (tingkat && tingkat !== 'ALL') {
            whereClause.className = { startsWith: String(tingkat) + '-' };
        }

        if (search && typeof search === 'string') {
            whereClause.OR = [
                { name: { contains: search } },
                { username: { contains: search } },
                { nisn: { contains: search } },
                { className: { contains: search } }
            ];
        }

        const noPhoneSetting = await prisma.settings.findUnique({ where: { key: 'NO_SMARTPHONE_STUDENT_IDS' } });
        let noPhoneIds: string[] = [];
        if (noPhoneSetting && noPhoneSetting.value) {
            try { noPhoneIds = JSON.parse(noPhoneSetting.value); } catch {}
        }

        const rawStudents = await prisma.user.findMany({
            where: whereClause,
            select: {
                id: true,
                username: true,
                name: true,
                role: true,
                className: true,
                nis: true,
                nisn: true,
                parentPhone: true,
                profilePicUrl: true,
                deviceBindingId: true,
                hasNoSmartphone: true,
                classRole: true,
                createdAt: true,
                devices: {
                    select: {
                        id: true,
                        deviceName: true,
                        deviceModel: true,
                        deviceBrand: true,
                        status: true,
                        lastSeen: true,
                        appVersion: true,
                        batteryLevel: true
                    },
                    orderBy: { lastSeen: 'desc' },
                    take: 1
                }
            },
            orderBy: [
                { className: 'asc' },
                { name: 'asc' }
            ]
        });

        const students = rawStudents.map(s => {
            const isNoPhone = Boolean(s.hasNoSmartphone || noPhoneIds.includes(s.id));
            const activeDevice = (s.devices && s.devices.length > 0) ? s.devices[0] : null;
            const isConnected = !isNoPhone && Boolean(activeDevice || s.deviceBindingId);

            let phoneStatus: 'CONNECTED' | 'NOT_CONNECTED' | 'NO_PHONE' = 'NOT_CONNECTED';
            if (isNoPhone) {
                phoneStatus = 'NO_PHONE';
            } else if (isConnected) {
                phoneStatus = 'CONNECTED';
            }

            return {
                ...s,
                hasNoSmartphone: isNoPhone,
                phoneStatus,
                activeDevice
            };
        });

        res.json(students);
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ message: 'Gagal mengambil data siswa' });
    }
};

export const toggleStudentNoPhoneAdmin = async (req: Request, res: Response) => {
    try {
        const id = (req.params.id || req.body.studentId || req.body.id) as string;
        const isNoPhone = req.body.isNoPhone;

        if (!id) {
            return res.status(400).json({ success: false, message: 'ID Siswa wajib disertakan.' });
        }

        const student = await prisma.user.findUnique({ where: { id } });
        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
        }

        const setting = await prisma.settings.findUnique({ where: { key: 'NO_SMARTPHONE_STUDENT_IDS' } });
        let ids: string[] = [];
        if (setting && setting.value) {
            try { ids = JSON.parse(setting.value); } catch {}
        }

        const currentlyNoPhone = Boolean(student.hasNoSmartphone || ids.includes(id));
        const targetState = (typeof isNoPhone === 'boolean') ? isNoPhone : !currentlyNoPhone;

        if (targetState) {
            if (!ids.includes(id)) ids.push(id);
        } else {
            ids = ids.filter(i => i !== id);
        }

        await prisma.$transaction([
            prisma.user.update({
                where: { id },
                data: { hasNoSmartphone: targetState }
            }),
            prisma.settings.upsert({
                where: { key: 'NO_SMARTPHONE_STUDENT_IDS' },
                create: { key: 'NO_SMARTPHONE_STUDENT_IDS', value: JSON.stringify(ids) },
                update: { value: JSON.stringify(ids) }
            })
        ]);

        return res.json({
            success: true,
            isNoSmartphone: targetState,
            message: `Status siswa ${student.name} berhasil diubah: ${targetState ? '⚪ Siswa Tanpa HP (Fasilitas Lab CBT)' : '📱 Siswa Memiliki HP Reguler'}`
        });
    } catch (error) {
        console.error('Error toggling no-phone status:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengubah status kepemilikan HP siswa.' });
    }
};

export const revokedUserIds = new Set<string>();

export const unbindUserDevice = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        await prisma.user.update({
            where: { id },
            data: { deviceBindingId: null }
        });
        res.json({ success: true, message: 'Ikatan perangkat (Device Binding) berhasil dibebaskan / di-reset.' });
    } catch (error) {
        console.error('Error unbinding device:', error);
        res.status(500).json({ success: false, message: 'Gagal membebaskan ikatan perangkat.' });
    }
};

export const forceLogoutUser = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
        }

        // 1. Reset device binding
        await prisma.user.update({
            where: { id: user.id },
            data: { deviceBindingId: null }
        });

        // 2. Hapus semua refresh token pengguna ini
        try {
            await (prisma as any).refreshToken.deleteMany({
                where: { userId: user.id }
            });
        } catch (e) {}

        // 3. Masukkan ke revokedUserIds agar request berikutnya langsung ditolak
        revokedUserIds.add(user.id);
        if (user.username) revokedUserIds.add(user.username);
        if (user.nisn) revokedUserIds.add(user.nisn);

        // 4. Masukkan seluruh deviceSession milik user ini
        const sessions = await prisma.deviceSession.findMany({
            where: { userId: user.id }
        });
        for (const s of sessions) {
            revokedUserIds.add(s.deviceAndroidId);
        }

        await logAudit(req, 'FORCE_LOGOUT_USER', `Pengguna ${user.name} (${user.username}) dipaksa keluar (force logout) oleh Admin/Operator`, { userId: user.id });

        res.json({
            success: true,
            message: `Sesi login ${user.name} (${user.className || user.role}) berhasil diputus paksa. Aplikasi di HP siswa akan otomatis kembali ke menu login.`
        });
    } catch (error: any) {
        console.error('Error forcing logout:', error);
        res.status(500).json({ success: false, message: 'Gagal melakukan logout paksa: ' + error.message });
    }
};

import { GoogleGenAI } from '@google/genai';

// --- SYSTEM SETTINGS & GEMINI AI CONFIGURATION ---
export const getSystemSettings = async (req: Request, res: Response) => {
    try {
        const geminiSetting = await prisma.settings.findUnique({
            where: { key: 'GEMINI_API_KEY' }
        });

        const activeKey = geminiSetting ? geminiSetting.value : (process.env.GEMINI_API_KEY || '');
        const maskedKey = activeKey && activeKey.length > 8
            ? activeKey.substring(0, 4) + '••••••••••••••••' + activeKey.substring(activeKey.length - 4)
            : (activeKey ? '••••••••' : '');

        const geminiModelSetting = await prisma.settings.findUnique({
            where: { key: 'GEMINI_MODEL' }
        });

        const sigs = await getSchoolSignatures();

        res.json({
            geminiApiKey: maskedKey,
            hasCustomApiKey: Boolean(activeKey),
            geminiModel: geminiModelSetting ? geminiModelSetting.value : 'gemini-2.5-flash',
            ppdbEnabled: (await prisma.settings.findUnique({ where: { key: 'PPDB_ENABLED' } }))?.value === 'true',
            headmasterName: sigs.headmasterName,
            headmasterNip: sigs.headmasterNip,
            schoolName: sigs.schoolName,
            bkCoordinatorName: sigs.bkCoordinatorName,
            bkCoordinatorNip: sigs.bkCoordinatorNip,
            bkCoordinatorTitle: sigs.bkCoordinatorTitle,
            systemStatus: 'ONLINE'
        });
    } catch (error) {
        console.error('Error fetching system settings:', error);
        res.status(500).json({ message: 'Gagal memuat pengaturan sistem' });
    }
};

/**
 * Endpoint publik/terautentikasi untuk memuat identitas sekolah dan tanda tangan resmi
 * Bisa diakses oleh seluruh peran (Guru, BK, Operator, Siswa, Orang Tua) untuk dokumen resmi
 */
export const getSchoolInfo = async (req: Request, res: Response) => {
    try {
        const sigs = await getSchoolSignatures();
        res.json({
            success: true,
            ...sigs
        });
    } catch (error) {
        console.error('Error in getSchoolInfo:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat data identitas sekolah' });
    }
};

export const updateSchoolSettings = async (req: Request, res: Response) => {
    try {
        const { headmasterName, headmasterNip, schoolName, bkCoordinatorName, bkCoordinatorNip, bkCoordinatorTitle } = req.body;

        if (headmasterName !== undefined) {
            await prisma.settings.upsert({
                where: { key: 'HEADMASTER_NAME' },
                update: { value: String(headmasterName).trim() },
                create: { key: 'HEADMASTER_NAME', value: String(headmasterName).trim() }
            });
        }

        if (headmasterNip !== undefined) {
            await prisma.settings.upsert({
                where: { key: 'HEADMASTER_NIP' },
                update: { value: String(headmasterNip).trim() },
                create: { key: 'HEADMASTER_NIP', value: String(headmasterNip).trim() }
            });
        }

        if (schoolName !== undefined) {
            await prisma.settings.upsert({
                where: { key: 'SCHOOL_NAME' },
                update: { value: String(schoolName).trim() },
                create: { key: 'SCHOOL_NAME', value: String(schoolName).trim() }
            });
        }

        if (bkCoordinatorName !== undefined) {
            await prisma.settings.upsert({
                where: { key: 'BK_COORDINATOR_NAME' },
                update: { value: String(bkCoordinatorName).trim() },
                create: { key: 'BK_COORDINATOR_NAME', value: String(bkCoordinatorName).trim() }
            });
        }

        if (bkCoordinatorNip !== undefined) {
            await prisma.settings.upsert({
                where: { key: 'BK_COORDINATOR_NIP' },
                update: { value: String(bkCoordinatorNip).trim() },
                create: { key: 'BK_COORDINATOR_NIP', value: String(bkCoordinatorNip).trim() }
            });
        }

        if (bkCoordinatorTitle !== undefined) {
            await prisma.settings.upsert({
                where: { key: 'BK_COORDINATOR_TITLE' },
                update: { value: String(bkCoordinatorTitle).trim() },
                create: { key: 'BK_COORDINATOR_TITLE', value: String(bkCoordinatorTitle).trim() }
            });
        }

        const updatedHeadmaster = (await prisma.settings.findUnique({ where: { key: 'HEADMASTER_NAME' } }))?.value || 'ADI SUTIGNYO, S.Pd.';
        const updatedNip = (await prisma.settings.findUnique({ where: { key: 'HEADMASTER_NIP' } }))?.value || '196801211991031004';
        const updatedSchool = (await prisma.settings.findUnique({ where: { key: 'SCHOOL_NAME' } }))?.value || 'SMPN 1 Boyolangu';
        const updatedBkName = (await prisma.settings.findUnique({ where: { key: 'BK_COORDINATOR_NAME' } }))?.value || '';
        const updatedBkNip = (await prisma.settings.findUnique({ where: { key: 'BK_COORDINATOR_NIP' } }))?.value || '';
        const updatedBkTitle = (await prisma.settings.findUnique({ where: { key: 'BK_COORDINATOR_TITLE' } }))?.value || '';

        res.json({
            success: true,
            message: '✅ Pengaturan Kepala Sekolah, Guru BK / Koordinator & Identitas Sekolah berhasil disimpan!',
            headmasterName: updatedHeadmaster,
            headmasterNip: updatedNip,
            schoolName: updatedSchool,
            bkCoordinatorName: updatedBkName,
            bkCoordinatorNip: updatedBkNip,
            bkCoordinatorTitle: updatedBkTitle
        });
    } catch (error) {
        console.error('Error updating school settings:', error);
        res.status(500).json({ message: 'Gagal menyimpan pengaturan sekolah' });
    }
};

export const getPpdbStatus = async (req: Request, res: Response) => {
    try {
        const ppdbSetting = await prisma.settings.findUnique({ where: { key: 'PPDB_ENABLED' } });
        const isEnabled = ppdbSetting ? ppdbSetting.value === 'true' : false;
        res.json({
            success: true,
            isEnabled,
            message: isEnabled 
                ? 'Pendaftaran Siswa Baru (PPDB) sedang AKTIF dibuka.' 
                : 'Pendaftaran Siswa Baru (PPDB) belum dibuka oleh sekolah.'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Gagal memuat status PPDB' });
    }
};

export const togglePpdb = async (req: Request, res: Response) => {
    try {
        const { enabled } = req.body;
        const boolVal = enabled === true || enabled === 'true';
        await prisma.settings.upsert({
            where: { key: 'PPDB_ENABLED' },
            update: { value: boolVal ? 'true' : 'false' },
            create: { key: 'PPDB_ENABLED', value: boolVal ? 'true' : 'false' }
        });
        res.json({
            success: true,
            isEnabled: boolVal,
            message: boolVal 
                ? '✅ Formulir Pendaftaran Siswa Baru (PPDB) berhasil DIAKTIFKAN.' 
                : '🔒 Formulir Pendaftaran Siswa Baru (PPDB) berhasil DINONAKTIFKAN.'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Gagal memperbarui status PPDB' });
    }
};

export const registerPpdbCandidate = async (req: Request, res: Response) => {
    try {
        const ppdbSetting = await prisma.settings.findUnique({ where: { key: 'PPDB_ENABLED' } });
        if (!ppdbSetting || ppdbSetting.value !== 'true') {
            return res.status(403).json({
                success: false,
                message: 'Pendaftaran Siswa Baru (PPDB) saat ini belum dibuka oleh pihak sekolah.'
            });
        }

        const { fullName, nisn, gender, pob, dob, fatherName, motherName, parentPhone, address, prevSchool } = req.body;
        if (!fullName || !parentPhone) {
            return res.status(400).json({ success: false, message: 'Nama lengkap dan nomor WhatsApp orang tua wajib diisi.' });
        }

        const tempUsername = (nisn && nisn.trim().length > 0) ? nisn.trim() : `PPDB${Date.now().toString().slice(-6)}`;
        
        // Cek apakah NISN sudah ada
        const existing = await prisma.user.findFirst({
            where: {
                OR: [
                    { username: tempUsername },
                    ...(nisn ? [{ nisn: nisn.trim() }] : [])
                ]
            }
        });

        if (existing) {
            return res.status(400).json({ success: false, message: 'Data siswa dengan NISN / username tersebut sudah terdaftar di sistem.' });
        }

        const candidate = await prisma.user.create({
            data: {
                username: tempUsername,
                password: '$2a$10$defaultHashForPpdbCandidates123',
                name: fullName.trim(),
                role: 'STUDENT',
                nisn: nisn ? nisn.trim() : null,
                gender: gender || 'L',
                pob: pob || null,
                dob: dob ? String(dob) : null,
                fatherName: fatherName || null,
                motherName: motherName || null,
                parentPhone: parentPhone.trim(),
                address: address || null,
                className: 'CALON_SISWA',
                isActive: false // Menunggu konfirmasi admin saat tahun ajaran baru
            }
        });

        res.json({
            success: true,
            message: `🎉 Formulir pendaftaran ${fullName} berhasil dikirim! Silakan simpan nomor pendaftaran: ${tempUsername}.`,
            registrationNumber: tempUsername
        });
    } catch (error: any) {
        console.error('Error registering PPDB candidate:', error);
        res.status(500).json({ success: false, message: 'Gagal mengirim formulir PPDB: ' + error.message });
    }
};

export const updateGeminiApiKey = async (req: Request, res: Response) => {
    try {
        const { apiKey, modelName } = req.body;

        if (apiKey !== undefined && typeof apiKey === 'string') {
            const cleanKey = apiKey.trim();
            if (cleanKey.length > 0 && !cleanKey.includes('•••')) {
                await prisma.settings.upsert({
                    where: { key: 'GEMINI_API_KEY' },
                    update: { value: cleanKey },
                    create: { key: 'GEMINI_API_KEY', value: cleanKey }
                });
                process.env.GEMINI_API_KEY = cleanKey;
            }
        }

        if (modelName) {
            await prisma.settings.upsert({
                where: { key: 'GEMINI_MODEL' },
                update: { value: modelName },
                create: { key: 'GEMINI_MODEL', value: modelName }
            });
        }

        res.json({ message: 'Konfigurasi Gemini AI API Key berhasil disimpan!' });
    } catch (error) {
        console.error('Error updating Gemini API key:', error);
        res.status(500).json({ message: 'Gagal menyimpan pengaturan Gemini API Key' });
    }
};

export const testGeminiApiKey = async (req: Request, res: Response) => {
    try {
        const { apiKey } = req.body;
        let keyToTest = apiKey;

        if (!keyToTest || keyToTest.includes('•••')) {
            const setting = await prisma.settings.findUnique({ where: { key: 'GEMINI_API_KEY' } });
            keyToTest = setting ? setting.value : (process.env.GEMINI_API_KEY || '');
        }

        if (!keyToTest) {
            return res.status(400).json({ message: 'API Key Gemini belum diatur atau kosong' });
        }

        const ai = new GoogleGenAI({ apiKey: keyToTest });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'Balas dengan satu kata: PONG'
        });

        const reply = response.text ? response.text.trim() : 'OK';
        res.json({
            success: true,
            message: 'Koneksi ke Google Gemini AI Berhasil! Respons: ' + reply,
            reply
        });
    } catch (error: any) {
        console.error('Gemini API test error:', error);
        res.status(400).json({
            success: false,
            message: 'Koneksi ke Gemini AI Gagal: ' + (error.message || 'Periksa kembali API Key Anda')
        });
    }
};

export const promoteStudentsGrade = async (req: Request, res: Response) => {
    try {
        const { sourceLevel, targetLevel, sourceClass, targetClass, mode } = req.body;
        let updatedCount = 0;

        if (mode === 'SINGLE_CLASS') {
            if (!sourceClass || !targetClass) {
                return res.status(400).json({ success: false, message: 'sourceClass dan targetClass wajib diisi.' });
            }

            const students = await prisma.user.findMany({
                where: { role: 'STUDENT', className: String(sourceClass) }
            });

            for (const st of students) {
                await prisma.user.update({
                    where: { id: st.id },
                    data: { className: String(targetClass) }
                });
                await syncParentAccountForStudent({ ...st, className: String(targetClass) });
                updatedCount++;
            }

            return res.json({
                success: true,
                message: `✅ Berhasil menaikkan kelas ${updatedCount} siswa dari ${sourceClass} ke ${targetClass}! Akun orang tua dan aplikasi Android tersinkronisasi otomatis.`,
                updatedCount
            });
        }

        if (sourceLevel === 'VII' && targetLevel === 'VIII') {
            const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
            for (const letter of letters) {
                const src = `VII-${letter}`;
                const dst = `VIII-${letter}`;
                const students = await prisma.user.findMany({
                    where: { role: 'STUDENT', className: src }
                });
                for (const st of students) {
                    await prisma.user.update({
                        where: { id: st.id },
                        data: { className: dst }
                    });
                    await syncParentAccountForStudent({ ...st, className: dst });
                    updatedCount++;
                }
            }

            return res.json({
                success: true,
                message: `✅ Promosi Kenaikan Kelas Berhasil! Sebanyak ${updatedCount} siswa Tingkat VII berhasil dinaikkan ke Tingkat VIII (VII-A s.d VII-K menjadi VIII-A s.d VIII-K). Seluruh data tersinkron ke APK Android.`,
                updatedCount
            });
        }

        if (sourceLevel === 'VIII' && targetLevel === 'IX') {
            const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
            for (const letter of letters) {
                const src = `VIII-${letter}`;
                const dst = `IX-${letter}`;
                const students = await prisma.user.findMany({
                    where: { role: 'STUDENT', className: src }
                });
                for (const st of students) {
                    await prisma.user.update({
                        where: { id: st.id },
                        data: { className: dst }
                    });
                    await syncParentAccountForStudent({ ...st, className: dst });
                    updatedCount++;
                }
            }

            return res.json({
                success: true,
                message: `✅ Promosi Kenaikan Kelas Berhasil! Sebanyak ${updatedCount} siswa Tingkat VIII berhasil dinaikkan ke Tingkat IX (VIII-A s.d VIII-K menjadi IX-A s.d IX-K). Seluruh data tersinkron ke APK Android.`,
                updatedCount
            });
        }

        res.status(400).json({ success: false, message: 'Pilihan kenaikan kelas tidak valid.' });
    } catch (error) {
        console.error('Error promoting students:', error);
        res.status(500).json({ success: false, message: 'Gagal memproses kenaikan kelas.' });
    }
};

// Operator membuka kunci formulir biodata siswa agar bisa diedit kembali tanpa mengisi dari nol
export const unlockStudentBiodata = async (req: Request, res: Response) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ success: false, message: 'Harap masukkan NISN atau Username siswa' });

        const trimmed = String(query).trim();
        const student = await prisma.user.findFirst({
            where: {
                role: 'STUDENT',
                OR: [
                    { nisn: trimmed },
                    { username: trimmed },
                    { name: { contains: trimmed } }
                ]
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: `Siswa dengan NISN/Username "${trimmed}" tidak ditemukan.` });
        }

        // Cari atau update submission biodata siswa di kedua tabel
        await (prisma as any).studentProfileSubmission.updateMany({
            where: { studentId: student.id },
            data: {
                status: 'REVISION',
                rejectionReason: 'Kunci pengisian dibuka oleh Tim Kesiswaan / Operator untuk pemutakhiran data.'
            }
        });

        await (prisma as any).biodataSubmission.updateMany({
            where: { studentId: student.id },
            data: {
                status: 'REVISION',
                notes: 'Kunci pengisian dibuka oleh Tim Kesiswaan / Operator untuk perbaikan/pemutakhiran data.'
            }
        }).catch(() => {});

        await logAudit(req, 'UNLOCK_STUDENT_BIODATA', `Buka kunci biodata: ${student.name} (${student.nisn})`, {
            studentId: student.id,
            nisn: student.nisn
        });

        res.json({
            success: true,
            message: `✅ Kunci pengisian biodata untuk ${student.name} (NISN: ${student.nisn || student.username}) berhasil dibuka! Orang tua dapat mengoreksi data langsung di aplikasi tanpa mengisi ulang dari nol.`
        });
    } catch (error: any) {
        console.error('Error in unlockStudentBiodata:', error);
        res.status(500).json({ success: false, message: 'Gagal membuka kunci biodata: ' + (error.message || 'Error server') });
    }
};


