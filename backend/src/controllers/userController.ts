import { Request, Response } from 'express';
import { supabase } from '../utils/supabaseClient';
import prisma from '../utils/db';
import bcrypt from 'bcrypt';
import { syncParentAccountForStudent } from '../utils/parentAccountHelper';
import { cascadeDeleteUserData } from './adminUserController';

// Helper: Sync all students from Supabase to local SQLite
async function syncStudentsInternal(): Promise<number> {
    try {
        const { data: students, error } = await supabase.from('siswa').select('*');
        if (error || !students) return 0;

        const classes = await prisma.class.findMany();
        const classMap = new Map<string, any>();
        classes.forEach(c => classMap.set(c.name, c));

        let syncedCount = 0;

        for (const s of students) {
            const nisn = s.nisn ? String(s.nisn).trim() : null;
            const nis = s.nis ? String(s.nis).trim() : null;
            const username = nisn || nis || `siswa_${s.id}`;
            const studentName = s.nama ? String(s.nama).trim() : 'Tanpa Nama';
            const rawClass = s.kelas ? String(s.kelas).trim() : null;
            const defaultPassword = await bcrypt.hash(nisn || nis || 'password123', 10);

            const classRecord = rawClass ? classMap.get(rawClass) : null;
            const classId = classRecord ? classRecord.id : null;
            const counselorTeacher = classRecord ? classRecord.counselorName : null;

            try {
                const upserted = await prisma.user.upsert({
                    where: { username: String(username) },
                    update: {
                        name: studentName,
                        nis: nis,
                        nisn: nisn,
                        gender: s.jenis_kelamin || null,
                        religion: s.agama || null,
                        pob: s.tempat_lahir || null,
                        dob: s.tanggal_lahir || null,
                        address: s.alamat || null,
                        fatherName: s.nama_ayah || null,
                        motherName: s.nama_ibu || null,
                        className: rawClass,
                        classId: classId,
                        counselorTeacher: counselorTeacher,
                        parentPhone: s.no_hp || null,
                        role: 'STUDENT',
                        isActive: true
                    },
                    create: {
                        username: String(username),
                        password: defaultPassword,
                        name: studentName,
                        nis: nis,
                        nisn: nisn,
                        gender: s.jenis_kelamin || null,
                        religion: s.agama || null,
                        pob: s.tempat_lahir || null,
                        dob: s.tanggal_lahir || null,
                        address: s.alamat || null,
                        fatherName: s.nama_ayah || null,
                        motherName: s.nama_ibu || null,
                        className: rawClass,
                        classId: classId,
                        counselorTeacher: counselorTeacher,
                        parentPhone: s.no_hp || null,
                        role: 'STUDENT',
                        isActive: true
                    }
                });

                // Otomatis sinkronisasi akun orang tua P(NISN)
                if (upserted.nisn) {
                    await syncParentAccountForStudent(upserted);
                }

                // Otomatis sinkronisasi berkas kependudukan (KK & Akta Kelahiran) dari Supabase ke eFile
                if (s.kk_url && typeof s.kk_url === 'string' && s.kk_url.trim().length > 5) {
                    try {
                        const existingKk = await prisma.eFile.findFirst({
                            where: {
                                userId: upserted.id,
                                category: 'KEPENDUDUKAN',
                                title: { contains: 'Kartu Keluarga' }
                            }
                        });
                        if (!existingKk) {
                            await prisma.eFile.create({
                                data: {
                                    userId: upserted.id,
                                    title: 'Kartu Keluarga (KK)',
                                    category: 'KEPENDUDUKAN',
                                    fileUrl: s.kk_url.trim(),
                                    fileSize: '1.5 MB',
                                    fileType: 'PDF',
                                    description: s.no_kk ? `Nomor KK: ${s.no_kk}` : 'Berkas resmi Kartu Keluarga (Arsip Dapodik/Supabase)',
                                    source: 'SUPABASE'
                                }
                            });
                        } else if (existingKk.fileUrl !== s.kk_url.trim()) {
                            await prisma.eFile.update({
                                where: { id: existingKk.id },
                                data: { fileUrl: s.kk_url.trim(), description: s.no_kk ? `Nomor KK: ${s.no_kk}` : existingKk.description }
                            });
                        }
                    } catch (kkErr) {
                        console.warn(`Error syncing KK for ${studentName}:`, kkErr);
                    }
                }

                if (s.akta_url && typeof s.akta_url === 'string' && s.akta_url.trim().length > 5) {
                    try {
                        const existingAkta = await prisma.eFile.findFirst({
                            where: {
                                userId: upserted.id,
                                category: 'KEPENDUDUKAN',
                                title: { contains: 'Akta Kelahiran' }
                            }
                        });
                        if (!existingAkta) {
                            await prisma.eFile.create({
                                data: {
                                    userId: upserted.id,
                                    title: 'Akta Kelahiran',
                                    category: 'KEPENDUDUKAN',
                                    fileUrl: s.akta_url.trim(),
                                    fileSize: '1.2 MB',
                                    fileType: 'PDF',
                                    description: s.nik ? `NIK: ${s.nik}` : 'Berkas resmi Akta Kelahiran (Arsip Dapodik/Supabase)',
                                    source: 'SUPABASE'
                                }
                            });
                        } else if (existingAkta.fileUrl !== s.akta_url.trim()) {
                            await prisma.eFile.update({
                                where: { id: existingAkta.id },
                                data: { fileUrl: s.akta_url.trim(), description: s.nik ? `NIK: ${s.nik}` : existingAkta.description }
                            });
                        }
                    } catch (akErr) {
                        console.warn(`Error syncing Akta for ${studentName}:`, akErr);
                    }
                }

                if (s.ijazah_url && typeof s.ijazah_url === 'string' && s.ijazah_url.trim().length > 5) {
                    try {
                        const existingIj = await prisma.eFile.findFirst({
                            where: { userId: upserted.id, title: { contains: 'Ijazah' } }
                        });
                        if (!existingIj) {
                            await prisma.eFile.create({
                                data: {
                                    userId: upserted.id,
                                    title: 'Ijazah Sekolah Asal',
                                    category: 'AKADEMIK',
                                    fileUrl: s.ijazah_url.trim(),
                                    fileSize: '1.8 MB',
                                    fileType: 'PDF',
                                    description: 'Berkas resmi Ijazah jenjang sebelumnya (Arsip Supabase)',
                                    source: 'SUPABASE'
                                }
                            });
                        }
                    } catch (ijErr) {}
                }

                if (s.kip_url && typeof s.kip_url === 'string' && s.kip_url.trim().length > 5) {
                    try {
                        const existingKip = await prisma.eFile.findFirst({
                            where: { userId: upserted.id, title: { contains: 'Kartu Indonesia Pintar' } }
                        });
                        if (!existingKip) {
                            await prisma.eFile.create({
                                data: {
                                    userId: upserted.id,
                                    title: 'Kartu Indonesia Pintar (KIP)',
                                    category: 'BANTUAN',
                                    fileUrl: s.kip_url.trim(),
                                    fileSize: '1.0 MB',
                                    fileType: 'PDF',
                                    description: 'Berkas Kartu Indonesia Pintar / Program Bantuan Sosial',
                                    source: 'SUPABASE'
                                }
                            });
                        }
                    } catch (kipErr) {}
                }

                syncedCount++;
            } catch (err) {
                console.error(`Error upserting student ${studentName}:`, err);
            }
        }
        return syncedCount;
    } catch (e) {
        console.error('syncStudentsInternal error:', e);
        return 0;
    }
}

// Ambil semua siswa dari Database Lokal (SQLite)
export const getStudents = async (req: Request, res: Response) => {
    try {
        let localStudents = await prisma.user.findMany({
            where: { role: 'STUDENT' },
            orderBy: [
                { className: 'asc' },
                { name: 'asc' }
            ]
        });

        // Jika data di SQLite masih kosong, otomatis tarik dari Supabase pertama kali
        if (localStudents.length === 0) {
            await syncStudentsInternal();
            localStudents = await prisma.user.findMany({
                where: { role: 'STUDENT' },
                orderBy: [
                    { className: 'asc' },
                    { name: 'asc' }
                ]
            });
        }

        // Format data sesuai ekspektasi front-end (baik camelCase maupun snake_case)
        const mapped = localStudents.map(s => ({
            id: s.id,
            name: s.name,
            nama: s.name,
            username: s.username,
            nis: s.nis || '',
            nisn: s.nisn || (s.username.startsWith('siswa_') ? '' : s.username),
            className: s.className || '',
            kelas: s.className || '',
            gender: s.gender || '',
            jenis_kelamin: s.gender || '',
            religion: s.religion || '',
            agama: s.religion || '',
            pob: s.pob || '',
            tempat_lahir: s.pob || '',
            dob: s.dob || '',
            tanggal_lahir: s.dob || '',
            parentPhone: s.parentPhone || '',
            no_hp: s.parentPhone || '',
            address: s.address || '',
            alamat: s.address || '',
            fatherName: s.fatherName || '',
            nama_ayah: s.fatherName || '',
            motherName: s.motherName || '',
            nama_ibu: s.motherName || '',
            deviceBindingId: s.deviceBindingId || null,
            classRole: s.classRole || null,
            profilePicUrl: s.profilePicUrl || null,
            role: s.role,
            isActive: s.isActive,
            status_siswa: s.isActive ? 'Aktif' : 'Nonaktif',
            createdAt: s.createdAt
        }));

        res.json(mapped);
    } catch (error) {
        console.error('Error fetching students from local DB:', error);
        res.status(500).json({ message: 'Gagal mengambil data siswa dari database lokal' });
    }
};

// Tambah Siswa Baru ke Lokal & Sinkron ke Supabase
export const createStudent = async (req: Request, res: Response) => {
    const { nis, nisn, nama, kelas, jenis_kelamin, agama, no_hp, alamat, tempat_lahir, tanggal_lahir, nama_ayah, nama_ibu } = req.body;
    try {
        const username = nisn || nis || `siswa_${Date.now()}`;
        const defaultPassword = await bcrypt.hash(nisn || nis || 'password123', 10);

        // 1. Simpan ke Database Lokal (SQLite)
        const newLocalStudent = await prisma.user.create({
            data: {
                username: String(username),
                password: defaultPassword,
                name: nama,
                role: 'STUDENT',
                nis: nis ? String(nis) : null,
                nisn: nisn ? String(nisn) : null,
                gender: jenis_kelamin || null,
                religion: agama || null,
                pob: tempat_lahir || null,
                dob: tanggal_lahir || null,
                address: alamat || null,
                fatherName: nama_ayah || null,
                motherName: nama_ibu || null,
                className: kelas || null,
                parentPhone: no_hp || null,
                isActive: true
            }
        });

        // Otomatis buat akun orang tua P(NISN) dengan password NISN
        await syncParentAccountForStudent(newLocalStudent);

        // 2. Simpan juga ke Supabase di background
        supabase.from('siswa').insert([
            {
                nis: nis || '',
                nisn: nisn || '',
                nama,
                kelas: kelas || '',
                jenis_kelamin: jenis_kelamin || '',
                agama: agama || '',
                no_hp: no_hp || '',
                alamat: alamat || '',
                tempat_lahir: tempat_lahir || '',
                tanggal_lahir: tanggal_lahir || '',
                nama_ayah: nama_ayah || '',
                nama_ibu: nama_ibu || '',
                status_siswa: 'Aktif'
            }
        ]).then(({ error }) => {
            if (error) console.error('Supabase async student insert error:', error);
        });

        res.json({
            message: 'Siswa berhasil ditambahkan ke database lokal',
            student: {
                id: newLocalStudent.id,
                nis: newLocalStudent.nis,
                nisn: newLocalStudent.nisn,
                nama: newLocalStudent.name,
                kelas: newLocalStudent.className
            }
        });
    } catch (error) {
        console.error('Error creating student:', error);
        res.status(500).json({ message: 'Gagal menambah siswa ke database.' });
    }
};

// Hapus Siswa dari Lokal & Supabase
export const deleteStudent = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            // Coba hapus langsung dari Supabase jika ID adalah ID Supabase
            try {
                await supabase.from('siswa').delete().eq('id', id);
            } catch (sbErr) {}
            return res.json({ success: true, message: 'Data siswa diproses penghapusan.' });
        }

        const nisn = user.nisn || (user.username && !user.username.startsWith('P') ? user.username : null);
        const nis = user.nis;

        // 1. Hapus dari database Supabase (tabel siswa)
        if (nisn || nis) {
            const orFilters: string[] = [];
            if (nisn) orFilters.push(`nisn.eq.${nisn}`);
            if (nis) orFilters.push(`nis.eq.${nis}`);
            try {
                const { error: sbErr } = await supabase.from('siswa').delete().or(orFilters.join(','));
                if (sbErr) console.warn('Supabase delete student error:', sbErr);
            } catch (sbEx) {
                console.warn('Supabase delete student exception:', sbEx);
            }
        }

        // 2. Hapus akun orang tua terkait (P + NISN) jika ada
        if (nisn) {
            try {
                const parentUser = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { username: `P${nisn}` },
                            { username: `p${nisn}` },
                            { nisn: nisn, role: 'PARENT' }
                        ]
                    }
                });
                if (parentUser) {
                    await cascadeDeleteUserData(parentUser.id).catch(() => {});
                }
            } catch(pErr) {}
        }

        // 3. Bersihkan seluruh relasi foreign key & hapus dari SQLite lokal
        await cascadeDeleteUserData(user.id);

        res.json({ success: true, message: `✅ Siswa ${user.name} (${user.username}) berhasil dihapus permanen dari portal lokal dan Supabase.` });
    } catch (error: any) {
        console.error('Error deleting student:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus siswa: ' + (error.message || 'Terjadi kesalahan sistem') });
    }
};

// Edit Siswa di Lokal & Supabase
export const updateStudent = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { nis, nisn, nama, kelas, jenis_kelamin, agama, no_hp, alamat, tempat_lahir, tanggal_lahir, nama_ayah, nama_ibu } = req.body;
    try {
        const oldStudent = await prisma.user.findUnique({ where: { id } });
        const oldNisn = oldStudent?.nisn;

        const updatedLocal = await prisma.user.update({
            where: { id },
            data: {
                name: nama,
                nis: nis ? String(nis) : null,
                nisn: nisn ? String(nisn) : null,
                gender: jenis_kelamin || null,
                religion: agama || null,
                pob: tempat_lahir || null,
                dob: tanggal_lahir || null,
                address: alamat || null,
                fatherName: nama_ayah || null,
                motherName: nama_ibu || null,
                className: kelas || null,
                parentPhone: no_hp || null
            }
        });

        // Jika NISN berubah, akun orang tua otomatis diupdate username & password-nya ke NISN baru
        await syncParentAccountForStudent(updatedLocal, oldNisn);

        // Sinkronisasi update ke Supabase
        const searchVal = updatedLocal.nisn || updatedLocal.nis;
        if (searchVal) {
            supabase.from('siswa').update({
                nis: nis || '',
                nisn: nisn || '',
                nama,
                kelas: kelas || '',
                jenis_kelamin: jenis_kelamin || '',
                agama: agama || '',
                no_hp: no_hp || '',
                alamat: alamat || '',
                tempat_lahir: tempat_lahir || '',
                tanggal_lahir: tanggal_lahir || '',
                nama_ayah: nama_ayah || '',
                nama_ibu: nama_ibu || ''
            }).or(`nisn.eq.${searchVal},nis.eq.${searchVal}`).then(({ error }) => {
                if (error) console.error('Supabase async update student error:', error);
            });
        }

        res.json({ message: 'Data siswa berhasil diupdate', student: updatedLocal });
    } catch (error) {
        console.error('Error updating student:', error);
        res.status(500).json({ message: 'Gagal mengedit siswa.' });
    }
};

// Sync Manual dari Supabase ke Lokal SQLite
export const syncStudentsToLocal = async (req: Request, res: Response) => {
    try {
        const syncedCount = await syncStudentsInternal();
        res.json({ message: `Berhasil mensinkronkan ${syncedCount} data siswa dari Supabase ke database lokal (CBT SQLite).` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Gagal sinkronisasi data ke lokal.' });
    }
};

// --- Manajemen Guru (Supabase & Sync to CBT) ---
export const getTeachers = async (req: Request, res: Response) => {
    try {
        // Ambil data guru dari database lokal Prisma (CBT & Piket)
        const localTeachers = await prisma.user.findMany({
            where: { role: { in: ['TEACHER', 'COUNSELOR', 'KURIKULUM', 'GURU'] } },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                username: true,
                teachingSubject: true,
                teachingClasses: true,
                role: true,
                isBk: true,
                tugasTambahan: true,
                rolesTambahan: true,
                className: true,
                parentPhone: true,
                address: true
            }
        });

        if (localTeachers && localTeachers.length > 0) {
            const normalized = localTeachers.map(teacher => {
                const roleUpper = (teacher.role || '').toUpperCase();
                const tTambahan = ((teacher as any).tugasTambahan || '').toUpperCase();
                const rTambahan = ((teacher as any).rolesTambahan || '').toLowerCase();
                const isBk = roleUpper === 'COUNSELOR' || (teacher as any).isBk === true || tTambahan.includes('BK') || rTambahan.includes('bk');
                const isKurikulum = roleUpper === 'KURIKULUM' || tTambahan.includes('KURIKULUM') || rTambahan.includes('kurikulum');

                return {
                    id: teacher.id,
                    name: teacher.name,
                    nama: teacher.name,
                    username: teacher.username,
                    nip: teacher.username,
                    teachingSubject: teacher.teachingSubject || '-',
                    mata_pelajaran: teacher.teachingSubject || '-',
                    teachingClasses: teacher.teachingClasses || '-',
                    kelas_ajar: teacher.teachingClasses || '-',
                    no_hp: teacher.parentPhone || '-',
                    alamat: teacher.address || '-',
                    role: teacher.role,
                    isBk,
                    isKurikulum,
                    tugasTambahan: (teacher as any).tugasTambahan,
                    rolesTambahan: (teacher as any).rolesTambahan,
                    wali_kelas: teacher.className ? { id: teacher.className, nama: teacher.className } : null
                };
            });
            return res.json(normalized);
        }

        // Fallback jika lokal kosong: ambil dari Supabase
        const { data: teachers, error: errTeachers } = await supabase
            .from('guru')
            .select('*')
            .order('nama', { ascending: true });

        if (errTeachers) throw errTeachers;

        const { data: kelasList } = await supabase
            .from('kelas')
            .select('id, nama, tingkat, wali_kelas_id');

        const enrichedTeachers = (teachers || []).map(teacher => {
            const assignedClass = kelasList ? kelasList.find(k => k.wali_kelas_id === teacher.id) : null;
            return {
                ...teacher,
                id: teacher.id,
                name: teacher.nama || teacher.name,
                nama: teacher.nama || teacher.name,
                username: teacher.nip || teacher.username || '',
                nip: teacher.nip || teacher.username || '',
                teachingSubject: teacher.mata_pelajaran || teacher.teachingSubject || '-',
                wali_kelas: assignedClass ? { id: assignedClass.id, nama: assignedClass.nama, tingkat: assignedClass.tingkat } : null
            };
        });

        res.json(enrichedTeachers);
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ message: 'Gagal mengambil data guru' });
    }
};

export const createTeacher = async (req: Request, res: Response) => {
    const { nip, nama, mata_pelajaran, no_hp, alamat, kelas_ajar, classId, isBk, isKurikulum } = req.body;
    try {
        const finalNip = nip || `GURU-${Math.floor(100000 + Math.random() * 900000)}`;
        let assignedClassName: string | null = null;
        if (classId) {
            const targetClass = await prisma.class.findFirst({ where: { OR: [{ id: String(classId) }, { name: String(classId) }] } });
            if (targetClass) assignedClassName = targetClass.name;
        }

        // Sinkronisasi prioritas ke akun lokal Prisma (CBT SQLite)
        const rolesArr: string[] = [];
        const tugasArr: string[] = [];
        if (isKurikulum) {
            rolesArr.push('kurikulum');
            tugasArr.push('KURIKULUM');
        }
        if (isBk) {
            rolesArr.push('bk');
            tugasArr.push('BK');
        }
        const normalizedRole = isBk ? 'COUNSELOR' : (isKurikulum ? 'KURIKULUM' : 'TEACHER');
        const defaultPass = await bcrypt.hash('password123', 10);

        const prismaUser = await prisma.user.upsert({
            where: { username: finalNip },
            update: {
                name: nama,
                teachingSubject: mata_pelajaran || '',
                teachingClasses: kelas_ajar || '',
                className: assignedClassName,
                classId: classId ? String(classId) : null,
                parentPhone: no_hp || null,
                address: alamat || null,
                isBk: Boolean(isBk),
                role: normalizedRole,
                rolesTambahan: rolesArr.length > 0 ? JSON.stringify(rolesArr) : null,
                tugasTambahan: tugasArr.length > 0 ? tugasArr.join(',') : null
            },
            create: {
                username: finalNip,
                name: nama,
                password: defaultPass,
                role: normalizedRole,
                isBk: Boolean(isBk),
                teachingSubject: mata_pelajaran || '',
                teachingClasses: kelas_ajar || '',
                className: assignedClassName,
                classId: classId ? String(classId) : null,
                parentPhone: no_hp || null,
                address: alamat || null,
                rolesTambahan: rolesArr.length > 0 ? JSON.stringify(rolesArr) : null,
                tugasTambahan: tugasArr.length > 0 ? tugasArr.join(',') : null,
                isActive: true
            }
        });

        // Sinkronisasi opsional ke Supabase (tidak boleh memblokir jika offline/error)
        let sbData = null;
        try {
            const { data, error } = await supabase.from('guru').insert([
                {
                    nip: finalNip,
                    nama,
                    mata_pelajaran: mata_pelajaran || '',
                    no_hp: no_hp || '',
                    alamat: alamat || '',
                    kelas_ajar: kelas_ajar || ''
                }
            ]).select().maybeSingle();

            if (!error && data) {
                sbData = data;
                if (classId) {
                    await supabase.from('kelas').update({ wali_kelas_id: data.id }).eq('id', classId);
                }
            }
        } catch (sbErr) {
            console.warn('Supabase sync createTeacher error ignored:', sbErr);
        }

        res.json({ message: 'Guru berhasil ditambahkan dan disinkronkan ke sistem', teacher: prismaUser });
    } catch (error) {
        console.error('Error creating teacher:', error);
        res.status(500).json({ message: 'Gagal menambah data guru.' });
    }
};

export const updateTeacher = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { nip, nama, mata_pelajaran, no_hp, alamat, kelas_ajar, classId, isBk, isKurikulum } = req.body;
    try {
        const teacherId = String(id);
        const targetClassId = classId ? String(classId) : null;
        let assignedClassName: string | null = null;
        if (targetClassId) {
            const targetClass = await prisma.class.findFirst({ where: { OR: [{ id: targetClassId }, { name: targetClassId }] } });
            if (targetClass) assignedClassName = targetClass.name;
        }

        // 1. Ambil & Update data user di database lokal Prisma SQLite terlebih dahulu
        let existingUser = await prisma.user.findFirst({
            where: { OR: [{ id: teacherId }, { username: String(nip || teacherId) }] }
        });

        let updatedPrismaUser = null;
        if (existingUser) {
            let rolesArr: string[] = [];
            try {
                if (existingUser.rolesTambahan) rolesArr = JSON.parse(existingUser.rolesTambahan);
            } catch(e) {}

            if (isKurikulum === true && !rolesArr.includes('kurikulum')) rolesArr.push('kurikulum');
            if (isKurikulum === false) rolesArr = rolesArr.filter(r => r !== 'kurikulum');
            if (isBk === true && !rolesArr.includes('bk')) rolesArr.push('bk');
            if (isBk === false) rolesArr = rolesArr.filter(r => r !== 'bk');

            let currentTugas = existingUser.tugasTambahan ? existingUser.tugasTambahan.split(',').map((s: string) => s.trim()) : [];
            if (isKurikulum === true && !currentTugas.includes('KURIKULUM')) currentTugas.push('KURIKULUM');
            if (isKurikulum === false) currentTugas = currentTugas.filter((s: string) => s !== 'KURIKULUM');
            if (isBk === true && !currentTugas.includes('BK')) currentTugas.push('BK');
            if (isBk === false) currentTugas = currentTugas.filter((s: string) => s !== 'BK');

            const newRole = isBk ? 'COUNSELOR' : (isKurikulum && existingUser.role === 'TEACHER' ? 'KURIKULUM' : existingUser.role);

            updatedPrismaUser = await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                    username: nip || existingUser.username,
                    name: nama || existingUser.name,
                    teachingSubject: mata_pelajaran !== undefined ? mata_pelajaran : existingUser.teachingSubject,
                    teachingClasses: kelas_ajar !== undefined ? kelas_ajar : existingUser.teachingClasses,
                    className: assignedClassName !== undefined ? assignedClassName : existingUser.className,
                    classId: targetClassId || existingUser.classId,
                    parentPhone: no_hp !== undefined ? no_hp : existingUser.parentPhone,
                    address: alamat !== undefined ? alamat : existingUser.address,
                    role: newRole,
                    isBk: typeof isBk === 'boolean' ? isBk : existingUser.isBk,
                    rolesTambahan: JSON.stringify(rolesArr),
                    tugasTambahan: currentTugas.length > 0 ? currentTugas.join(',') : null
                }
            });
        }

        // 2. Sinkronkan ke Supabase (dalam try-catch agar kegagalan Supabase tidak memblokir simpan)
        let sbData = null;
        try {
            const { data: sbRes, error: sbErr } = await supabase.from('guru').update({
                nip: nip || existingUser?.username,
                nama: nama || existingUser?.name,
                mata_pelajaran: mata_pelajaran || '',
                no_hp: no_hp || '',
                alamat: alamat || '',
                kelas_ajar: kelas_ajar || ''
            }).or(`id.eq.${id},nip.eq.${nip || existingUser?.username}`).select().maybeSingle();
            sbData = sbRes;

            if (sbData?.id) {
                await supabase.from('kelas').update({ wali_kelas_id: null }).eq('wali_kelas_id', sbData.id);
                if (targetClassId) {
                    await supabase.from('kelas').update({ wali_kelas_id: sbData.id }).eq('id', targetClassId);
                }
            }
        } catch (sbError) {
            console.warn('Supabase sync updateTeacher ignored error:', sbError);
        }

        return res.json({
            success: true,
            message: 'Data guru berhasil diperbarui dan disinkronkan',
            teacher: updatedPrismaUser || sbData || { id, nama, nip }
        });
    } catch (error) {
        console.error('Error updating teacher:', error);
        res.status(500).json({ message: 'Gagal memperbarui data guru.' });
    }
};

export const deleteTeacher = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    try {
        let user = await prisma.user.findUnique({ where: { id } });
        let nip: string = user?.username || '';

        // Jika tidak ditemukan dengan ID langsung, coba cari berdasarkan NIP atau username
        if (!user) {
            user = await prisma.user.findFirst({
                where: { OR: [{ username: id }, { id }] }
            });
            nip = user?.username || id;
        }

        // 1. Lepas wali kelas di Supabase & Hapus dari tabel guru di Supabase
        try {
            let sbTeacherId = id;
            if (nip) {
                const { data: sbGuru } = await supabase.from('guru').select('id, nip').or(`nip.eq.${nip},id.eq.${id}`).maybeSingle();
                if (sbGuru) {
                    sbTeacherId = sbGuru.id;
                }
            }
            await supabase.from('kelas').update({ wali_kelas_id: null }).eq('wali_kelas_id', sbTeacherId);
            await supabase.from('guru').delete().or(`id.eq.${sbTeacherId}${nip ? `,nip.eq.${nip}` : ''}`);
        } catch (sbErr) {
            console.warn('Supabase delete teacher error:', sbErr);
        }

        // 2. Jika user ditemukan di SQLite, lakukan cascade deletion
        if (user) {
            await cascadeDeleteUserData(user.id);
            return res.json({ success: true, message: `✅ Guru ${user.name} (${user.username}) berhasil dihapus dari sistem portal dan Supabase.` });
        }

        res.json({ success: true, message: 'Guru berhasil diproses penghapusan.' });
    } catch (error: any) {
        console.error('Error deleting teacher:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus guru: ' + (error.message || 'Terjadi kesalahan sistem') });
    }
};

export const syncTeachersToLocal = async (req: Request, res: Response) => {
    try {
        const { data: teachers, error } = await supabase.from('guru').select('*');
        if (error) throw error;

        let syncedCount = 0;
        const defaultPassword = await bcrypt.hash('guru123', 10);

        for (const t of teachers) {
            const username = t.nip || `guru_${t.id.substring(0, 8)}`;
            const teacherName = t.nama || 'Tanpa Nama';

            try {
                await prisma.user.upsert({
                    where: { username: username },
                    update: {
                        name: teacherName,
                        role: 'TEACHER',
                        isActive: true
                    },
                    create: {
                        username: username,
                        password: defaultPassword,
                        name: teacherName,
                        role: 'TEACHER',
                        isActive: true
                    }
                });
                syncedCount++;
            } catch (upsertError) {
                console.error(`Gagal sync guru ${teacherName}:`, upsertError);
            }
        }

        res.json({ message: `Berhasil mensinkronkan ${syncedCount} dari ${teachers.length} guru ke database lokal (Prisma CBT).` });
    } catch (error) {
        console.error('Error syncing teachers to local:', error);
        res.status(500).json({ message: 'Gagal sinkronisasi data guru ke lokal.' });
    }
};
