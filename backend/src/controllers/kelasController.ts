import { Request, Response } from 'express';
import { supabase } from '../utils/supabaseClient';
import prisma from '../utils/db';
import { invalidateCommitteeCache, getClassCommittee, checkStudentCommitteeRole } from '../utils/classCommittee';
import { compareClassNames } from '../utils/classSort';

let cachedSupabaseData: { supabaseMap: Record<string, any>; guruMap: Record<string, any>; timestamp: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

export const getKelas = async (req: Request, res: Response) => {
    try {
        // Ambil data rombel dari SQLite lokal (memuat koordinat lat, lng, radiusMeters, barcode)
        let localClasses = await prisma.class.findMany({
            orderBy: { name: 'asc' }
        });

        // Coba sinkronisasi jika Supabase tersedia dengan in-memory cache
        let supabaseMap: Record<string, any> = {};
        let guruMap: Record<string, any> = {};

        if (cachedSupabaseData && (Date.now() - cachedSupabaseData.timestamp < CACHE_TTL_MS)) {
            supabaseMap = cachedSupabaseData.supabaseMap;
            guruMap = cachedSupabaseData.guruMap;
        } else {
            try {
                // Timeout 1.5 detik agar tidak memblokir SQLite lokal
                const fetchPromise = Promise.all([
                    supabase.from('kelas').select('*'),
                    supabase.from('guru').select('*')
                ]);
                const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Supabase timeout')), 1500));
                const [kRes, gRes] = await Promise.race([fetchPromise, timeoutPromise]) as any;

                if (kRes && Array.isArray(kRes.data)) {
                    kRes.data.forEach((k: any) => { supabaseMap[k.nama] = k; });
                }
                if (gRes && Array.isArray(gRes.data)) {
                    gRes.data.forEach((g: any) => { guruMap[g.id] = g; });
                }
                cachedSupabaseData = { supabaseMap, guruMap, timestamp: Date.now() };
            } catch (e) {
                if (cachedSupabaseData) {
                    supabaseMap = cachedSupabaseData.supabaseMap;
                    guruMap = cachedSupabaseData.guruMap;
                }
            }
        }

        const localTeachers = await prisma.user.findMany({
            where: { OR: [{ role: { in: ['TEACHER', 'COUNSELOR', 'KURIKULUM', 'GURU', 'OPERATOR', 'ADMIN'] } }, { className: { not: null } }] },
            select: { id: true, name: true, username: true, className: true }
        });

        // Jika localClasses kosong, seed dari siswa atau buat rombel default VII-A s/d IX-H
        if (localClasses.length === 0) {
            const defaultNames = [
                'VII-A', 'VII-B', 'VII-C', 'VII-D', 'VII-E', 'VII-F', 'VII-G',
                'VIII-A', 'VIII-B', 'VIII-C', 'VIII-D', 'VIII-E',
                'IX-A', 'IX-B', 'IX-C', 'IX-D'
            ];
            for (const n of defaultNames) {
                await prisma.class.upsert({
                    where: { name: n },
                    update: {},
                    create: {
                        name: n,
                        barcodeCode: `GATE-CLASS-${n}`,
                        gateInBarcode: `GATE_IN_${n}`,
                        gateOutBarcode: `GATE_OUT_${n}`,
                        lat: -8.125157,
                        lng: 111.893912,
                        radiusMeters: 50
                    }
                });
            }
            localClasses = await prisma.class.findMany({ orderBy: { name: 'asc' } });
        }

        const combined = localClasses.map(c => {
            const sp = supabaseMap[c.name];
            let tingkat = 'VII';
            if (c.name.includes('VIII') || c.name.startsWith('8')) tingkat = 'VIII';
            else if (c.name.includes('IX') || c.name.startsWith('9')) tingkat = 'IX';

            let waliKelasNama: string | null = null;
            let waliKelasNip: string | null = null;
            let waliKelasId: string | null = null;

            if (sp && sp.wali_kelas_id) {
                const sGuru = guruMap[sp.wali_kelas_id];
                if (sGuru) {
                    waliKelasNama = sGuru.nama;
                    waliKelasNip = sGuru.nip || null;
                    const matched = localTeachers.find(t => 
                        t.name.toLowerCase().trim() === sGuru.nama.toLowerCase().trim() ||
                        (t.username && sGuru.nip && t.username.trim() === sGuru.nip.trim())
                    );
                    waliKelasId = matched ? matched.id : sp.wali_kelas_id;
                } else {
                    waliKelasId = sp.wali_kelas_id;
                }
            }

            // Fallback ke guru lokal jika belum didapatkan dari Supabase
            if (!waliKelasNama) {
                const matchedLocal = localTeachers.find(t => t.className === c.name);
                if (matchedLocal) {
                    waliKelasNama = matchedLocal.name;
                    waliKelasNip = matchedLocal.username;
                    waliKelasId = matchedLocal.id;
                }
            }

            let officersParsed = null;
            if (c.officers) {
                try {
                    officersParsed = typeof c.officers === 'string' ? JSON.parse(c.officers) : c.officers;
                } catch(e) {}
            }

            return {
                id: c.id,
                nama: c.name,
                tingkat: sp ? sp.tingkat : tingkat,
                wali_kelas_id: waliKelasId,
                wali_kelas_nama: waliKelasNama,
                wali_kelas_nip: waliKelasNip,
                counselorId: c.counselorId || null,
                counselorName: c.counselorName || null,
                officers: officersParsed,
                isGpsLocked: Boolean(c.isGpsLocked),
                lat: c.lat ?? -8.125157,
                lng: c.lng ?? 111.893912,
                radiusMeters: c.radiusMeters ?? 50,
                barcodeCode: c.barcodeCode || `GATE-CLASS-${c.name}`,
                gateInBarcode: c.gateInBarcode || `GATE_IN_${c.name}`,
                gateOutBarcode: c.gateOutBarcode || `GATE_OUT_${c.name}`
            };
        });

        // Selalu urutkan daftar kelas diawali dari VII, VIII, lalu IX
        combined.sort((a, b) => compareClassNames(a.nama, b.nama));

        res.json(combined);
    } catch (error) {
        console.error('Error fetching kelas:', error);
        res.status(500).json({ message: 'Gagal mengambil data kelas' });
    }
};

export const updateKelasCoordinates = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { lat, lng, radiusMeters } = req.body;

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({ message: 'Latitude dan Longitude wajib diisi' });
        }

        const targetClass = await prisma.class.findFirst({
            where: { OR: [{ id: String(id) }, { name: String(id) }] }
        });
        if (!targetClass) {
            return res.status(404).json({ message: 'Kelas tidak ditemukan' });
        }

        if (targetClass.isGpsLocked) {
            return res.status(403).json({
                message: `🔒 Koordinat GPS Kelas ${targetClass.name} sedang DIKUNCI (LOCKED). Buka kunci terlebih dahulu untuk mengubah koordinat atau radius.`
            });
        }

        const updated = await prisma.class.update({
            where: { id: targetClass.id },
            data: {
                lat: Number(lat),
                lng: Number(lng),
                radiusMeters: radiusMeters ? Number(radiusMeters) : 50
            }
        });

        res.json({
            message: `✅ Koordinat GPS Kelas ${updated.name} berhasil disimpan! (${updated.lat}, ${updated.lng}) Radius: ${updated.radiusMeters}m`,
            kelas: updated
        });
    } catch (error) {
        console.error('Error updating kelas coordinates:', error);
        res.status(500).json({ message: 'Gagal menyimpan koordinat GPS kelas' });
    }
};

export const toggleGpsLock = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const targetClass = await prisma.class.findFirst({
            where: { OR: [{ id: String(id) }, { name: String(id) }] }
        });
        if (!targetClass) {
            return res.status(404).json({ message: 'Kelas tidak ditemukan' });
        }

        const newLockState = !targetClass.isGpsLocked;
        const updated = await prisma.class.update({
            where: { id: targetClass.id },
            data: { isGpsLocked: newLockState }
        });

        res.json({
            success: true,
            isGpsLocked: updated.isGpsLocked,
            message: updated.isGpsLocked
                ? `🔒 Koordinat GPS Kelas ${updated.name} BERHASIL DIKUNCI. Marker tidak dapat digeser tanpa membuka kunci.`
                : `🔓 Kunci Koordinat GPS Kelas ${updated.name} TELAH DIBUKA. Anda sekarang dapat menyesuaikan titik koordinat dan radius.`
        });
    } catch (error) {
        console.error('Error toggling GPS lock:', error);
        res.status(500).json({ message: 'Gagal mengubah status kunci GPS kelas' });
    }
};

export const setCounselorForClass = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { counselorId } = req.body;

        const targetClass = await prisma.class.findFirst({
            where: { OR: [{ id: String(id) }, { name: String(id) }] }
        });
        if (!targetClass) {
            return res.status(404).json({ message: 'Kelas tidak ditemukan' });
        }

        let counselorName: string | null = null;
        if (counselorId) {
            const counselor = await prisma.user.findFirst({
                where: { id: String(counselorId), role: 'COUNSELOR' }
            });
            if (!counselor) {
                return res.status(404).json({ message: 'Data Guru BK tidak ditemukan' });
            }
            counselorName = counselor.name;
        }

        const updated = await prisma.class.update({
            where: { id: targetClass.id },
            data: {
                counselorId: counselorId || null,
                counselorName: counselorName
            }
        });

        // Sinkronkan ke seluruh siswa di rombel kelas ini
        await prisma.user.updateMany({
            where: { className: targetClass.name, role: 'STUDENT' },
            data: { counselorTeacher: counselorName }
        });

        res.json({
            success: true,
            message: counselorName
                ? `✅ Guru BK untuk kelas ${updated.name} berhasil diatur ke ${counselorName}`
                : `ℹ️ Guru BK untuk kelas ${updated.name} telah dikosongkan`,
            kelas: updated
        });
    } catch (error) {
        console.error('Error setting counselor for class:', error);
        res.status(500).json({ message: 'Gagal mengatur Guru BK kelas' });
    }
};

export const createKelas = async (req: Request, res: Response) => {
    const { nama, tingkat, wali_kelas_id, lat, lng } = req.body;
    try {
        // Simpan ke SQLite lokal
        const local = await prisma.class.upsert({
            where: { name: nama },
            update: {
                lat: lat ? Number(lat) : -8.125157,
                lng: lng ? Number(lng) : 111.893912
            },
            create: {
                name: nama,
                barcodeCode: `GATE-CLASS-${nama}`,
                gateInBarcode: `GATE_IN_${nama}`,
                gateOutBarcode: `GATE_OUT_${nama}`,
                lat: lat ? Number(lat) : -8.125157,
                lng: lng ? Number(lng) : 111.893912,
                radiusMeters: 50
            }
        });

        try {
            await supabase.from('kelas').insert([
                { nama, tingkat, wali_kelas_id: wali_kelas_id || null }
            ]);
        } catch (e) {}

        res.json({ message: 'Kelas berhasil ditambahkan', kelas: local });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menambah kelas.' });
    }
};

export const updateKelas = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { nama, tingkat, wali_kelas_id } = req.body;
    try {
        let teacherName: string | null = null;
        let supabaseGuruId: string | null = null;

        if (wali_kelas_id) {
            // Cek apakah wali_kelas_id adalah ID user teacher lokal SQLite
            const localTeacher = await prisma.user.findFirst({
                where: { id: wali_kelas_id, role: 'TEACHER' }
            });
            if (localTeacher) {
                teacherName = localTeacher.name;
                // Cari ID guru padanannya di Supabase
                const { data: matchedGuru } = await supabase
                    .from('guru')
                    .select('id')
                    .or(`nama.ilike.%${localTeacher.name}%,nip.eq.${localTeacher.username}`)
                    .limit(1);
                if (matchedGuru && matchedGuru.length > 0) {
                    supabaseGuruId = matchedGuru[0].id;
                }
            } else {
                supabaseGuruId = wali_kelas_id;
                const { data: g } = await supabase.from('guru').select('nama').eq('id', wali_kelas_id).single();
                if (g) teacherName = g.nama;
            }
        }

        // Update kelas lokal di SQLite
        await prisma.class.updateMany({
            where: { OR: [{ id }, { name: nama }] },
            data: { name: nama }
        });

        // Update homeroomTeacher siswa di kelas ini agar sinkron di portal & kartu presensi
        if (teacherName) {
            await prisma.user.updateMany({
                where: { className: nama, role: 'STUDENT' },
                data: { homeroomTeacher: teacherName }
            });
        }

        // Update Supabase kelas berdasarkan nama rombel
        try {
            if (supabaseGuruId) {
                await supabase.from('kelas').update({ wali_kelas_id: null }).eq('wali_kelas_id', supabaseGuruId);
            }
            await supabase.from('kelas').update({
                nama,
                tingkat,
                wali_kelas_id: supabaseGuruId
            }).eq('nama', nama);
        } catch (e) {}

        res.json({ message: 'Kelas dan Wali Kelas berhasil diperbarui' });
    } catch (error) {
        console.error('Error updating kelas:', error);
        res.status(500).json({ message: 'Gagal memperbarui kelas.' });
    }
};

export const deleteKelas = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
        try {
            await supabase.from('kelas').delete().eq('id', id);
        } catch (e) {}
        await prisma.class.deleteMany({ where: { id } });
        res.json({ message: 'Kelas berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus kelas.' });
    }
};

export const getClassOfficers = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const cls = await prisma.class.findFirst({
            where: { OR: [{ id: String(id) }, { name: String(id) }] }
        });
        if (!cls) {
            return res.status(404).json({ message: 'Kelas tidak ditemukan' });
        }

        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className: cls.name },
            select: { id: true, name: true, nisn: true, username: true, classRole: true },
            orderBy: { name: 'asc' }
        });

        let officers: any = {};
        if (cls.officers) {
            try {
                officers = JSON.parse(cls.officers);
            } catch (e) {}
        }

        const committee = await getClassCommittee(cls.name);

        res.json({
            success: true,
            classId: cls.id,
            className: cls.name,
            officers,
            committee,
            students
        });
    } catch (error) {
        console.error('Error fetching class officers:', error);
        res.status(500).json({ message: 'Gagal mengambil data pengurus kelas' });
    }
};

export const getMyClassCommittee = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        let className = user?.className || req.query.className;
        if (!className && user?.id) {
            const dbUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { className: true, name: true, role: true }
            });
            className = dbUser?.className;
        }

        if (!className) {
            return res.json({
                success: true,
                className: null,
                committee: {
                    leaderName: '-',
                    viceLeaderName: '-',
                    secretaryName: '-',
                    treasurerName: '-'
                },
                isCommittee: false,
                position: null,
                classLeaderName: '-',
                classViceLeaderName: '-',
                classSecretaryName: '-',
                classTreasurerName: '-'
            });
        }

        const normClass = String(className).trim();
        const committee = await getClassCommittee(normClass);
        let isCommittee = false;
        let position: string | null = null;

        if (user?.id) {
            const check = await checkStudentCommitteeRole(user.id, user.name || '', normClass);
            isCommittee = check.isCommittee;
            position = check.position;
        }

        res.json({
            success: true,
            className: normClass,
            committee,
            isCommittee,
            position,
            classLeaderName: committee.leaderName,
            classViceLeaderName: committee.viceLeaderName,
            classSecretaryName: committee.secretaryName,
            classTreasurerName: committee.treasurerName,
            officers: committee
        });
    } catch (error: any) {
        console.error('Error getMyClassCommittee:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data pengurus kelas' });
    }
};

export const updateClassOfficers = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { ketuaId, wakilId, sekretaris1Id, sekretaris2Id, bendahara1Id, bendahara2Id } = req.body;

        const cls = await prisma.class.findFirst({
            where: { OR: [{ id: String(id) }, { name: String(id) }] }
        });
        if (!cls) {
            return res.status(404).json({ message: 'Kelas tidak ditemukan' });
        }

        const officerPayload = {
            ketuaId: ketuaId || null,
            wakilId: wakilId || null,
            sekretaris1Id: sekretaris1Id || null,
            sekretaris2Id: sekretaris2Id || null,
            bendahara1Id: bendahara1Id || null,
            bendahara2Id: bendahara2Id || null
        };

        await prisma.class.update({
            where: { id: cls.id },
            data: { officers: JSON.stringify(officerPayload) }
        });

        // Reset classRole siswa lama di kelas ini
        await prisma.user.updateMany({
            where: { role: 'STUDENT', className: cls.name },
            data: { classRole: null }
        });

        // Update classRole masing-masing siswa yang di-plot
        const assignments = [
            { id: ketuaId, role: 'Ketua Kelas' },
            { id: wakilId, role: 'Wakil Ketua Kelas' },
            { id: sekretaris1Id, role: 'Sekretaris 1' },
            { id: sekretaris2Id, role: 'Sekretaris 2' },
            { id: bendahara1Id, role: 'Bendahara 1' },
            { id: bendahara2Id, role: 'Bendahara 2' }
        ];

        for (const a of assignments) {
            if (a.id) {
                await prisma.user.updateMany({
                    where: { id: a.id },
                    data: { classRole: a.role }
                });
            }
        }

        // Invalidate committee cache agar APK langsung mendapatkan susunan terbaru
        invalidateCommitteeCache(cls.name);

        res.json({
            success: true,
            message: `✅ Struktur Pengurus Kelas ${cls.name} berhasil disimpan!`,
            officers: officerPayload
        });
    } catch (error) {
        console.error('Error updating class officers:', error);
        res.status(500).json({ message: 'Gagal memperbarui struktur pengurus kelas' });
    }
};

/**
 * 1. FCFS Claim Posisi Pengurus Kelas oleh Siswa
 * Posisi: 'Ketua Kelas', 'Wakil Ketua Kelas', 'Sekretaris 1', 'Sekretaris 2', 'Bendahara 1', 'Bendahara 2'
 * First-Come, First-Served: Jika posisi kosong, siswa langsung mengklaim.
 */
export const claimClassOfficer = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { position, className: reqClassName } = req.body;

        const studentId = user?.id;
        const studentName = user?.name || 'Siswa';
        const targetClassName = user?.className || reqClassName;

        if (!studentId || !targetClassName) {
            return res.status(400).json({ success: false, message: 'Identitas siswa dan kelas wajib disertakan.' });
        }

        const validPositions = [
            'Ketua Kelas',
            'Wakil Ketua Kelas',
            'Sekretaris 1',
            'Sekretaris 2',
            'Bendahara 1',
            'Bendahara 2'
        ];

        if (!position || !validPositions.includes(position)) {
            return res.status(400).json({
                success: false,
                message: `Posisi tidak valid. Pilih salah satu dari: ${validPositions.join(', ')}`
            });
        }

        const cls = await prisma.class.findFirst({
            where: { OR: [{ name: targetClassName }, { id: targetClassName }] }
        });

        if (!cls) {
            return res.status(404).json({ success: false, message: `Kelas ${targetClassName} tidak ditemukan.` });
        }

        let officers: any = {};
        if (cls.officers) {
            try {
                officers = JSON.parse(cls.officers);
            } catch (_) {}
        }

        // Mapping field
        const keyMap: Record<string, string> = {
            'Ketua Kelas': 'ketuaId',
            'Wakil Ketua Kelas': 'wakilId',
            'Sekretaris 1': 'sekretaris1Id',
            'Sekretaris 2': 'sekretaris2Id',
            'Bendahara 1': 'bendahara1Id',
            'Bendahara 2': 'bendahara2Id'
        };

        const officerKey = keyMap[position];
        const existingOfficerId = officers[officerKey];

        // Cek jika sudah terisi di JSON atau di tabel User
        if (existingOfficerId && existingOfficerId !== studentId) {
            const occupant = await prisma.user.findUnique({
                where: { id: existingOfficerId },
                select: { name: true }
            });
            return res.status(409).json({
                success: false,
                message: `⚠️ Posisi [${position}] sudah terisi oleh ${occupant?.name || 'siswa lain'}. Sistem FCFS (First-Come First-Served) mengunci posisi yang sudah diambil.`
            });
        }

        // Cek siswa yang punya classRole ini di kelas yang sama
        const userHolding = await prisma.user.findFirst({
            where: {
                className: cls.name,
                classRole: position,
                isActive: true,
                id: { not: studentId }
            },
            select: { name: true }
        });

        if (userHolding) {
            return res.status(409).json({
                success: false,
                message: `⚠️ Posisi [${position}] telah diambil oleh ${userHolding.name}.`
            });
        }

        // Lepas posisi lama siswa jika sebelumnya punya jabatan lain di kelas ini
        for (const k of Object.keys(keyMap)) {
            const field = keyMap[k];
            if (officers[field] === studentId) {
                officers[field] = null;
            }
        }

        // Isi posisi baru (FCFS)
        officers[officerKey] = studentId;
        officers[officerKey + '_claimedAt'] = new Date();
        officers[officerKey + '_verified'] = false; // Menunggu verifikasi Walas

        await prisma.class.update({
            where: { id: cls.id },
            data: { officers: JSON.stringify(officers) }
        });

        await prisma.user.update({
            where: { id: studentId },
            data: { classRole: position }
        });

        invalidateCommitteeCache(cls.name);

        res.json({
            success: true,
            message: `🎉 Selamat! Posisi [${position}] Kelas ${cls.name} berhasil Anda klaim (FCFS). Menunggu verifikasi akhir Wali Kelas.`,
            position,
            className: cls.name,
            officers
        });
    } catch (error: any) {
        console.error('Error claiming class officer:', error);
        res.status(500).json({ success: false, message: 'Gagal mengklaim posisi pengurus kelas' });
    }
};

/**
 * 2. Verifikasi Pengurus Kelas oleh Wali Kelas
 */
export const verifyClassOfficers = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { id, className: reqClassName, status = 'VERIFIED', notes } = req.body;
        const classTarget = id || reqClassName || req.params.id || user?.className;

        if (!classTarget) {
            return res.status(400).json({ success: false, message: 'Target kelas wajib disertakan.' });
        }

        const cls = await prisma.class.findFirst({
            where: { OR: [{ id: String(classTarget) }, { name: String(classTarget) }] }
        });

        if (!cls) {
            return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan.' });
        }

        let officers: any = {};
        if (cls.officers) {
            try {
                officers = JSON.parse(cls.officers);
            } catch (_) {}
        }

        officers.isVerifiedByWalas = status === 'VERIFIED';
        officers.walasVerifiedAt = new Date();
        officers.walasVerifierName = user?.name || 'Wali Kelas';
        officers.walasNotes = notes || null;

        await prisma.class.update({
            where: { id: cls.id },
            data: { officers: JSON.stringify(officers) }
        });

        invalidateCommitteeCache(cls.name);

        res.json({
            success: true,
            message: `✅ Struktur Pengurus Kelas ${cls.name} telah diverifikasi oleh Wali Kelas (${user?.name || 'Walas'}).`,
            officers
        });
    } catch (error: any) {
        console.error('Error verifying class officers:', error);
        res.status(500).json({ success: false, message: 'Gagal memverifikasi pengurus kelas' });
    }
};

/**
 * 3. Reset Pengurus Kelas oleh Admin / Operator
 */
export const resetClassOfficers = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const classIdentifier = req.params.id || req.body.classId || req.body.className;

        if (!classIdentifier) {
            return res.status(400).json({ success: false, message: 'Target ID/Nama kelas wajib disertakan untuk reset.' });
        }

        const cls = await prisma.class.findFirst({
            where: { OR: [{ id: String(classIdentifier) }, { name: String(classIdentifier) }] }
        });

        if (!cls) {
            return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan.' });
        }

        // 1. Kosongkan officers di Class
        await prisma.class.update({
            where: { id: cls.id },
            data: { officers: null }
        });

        // 2. Reset classRole seluruh siswa di kelas tersebut
        await prisma.user.updateMany({
            where: { className: cls.name, role: 'STUDENT' },
            data: { classRole: null }
        });

        invalidateCommitteeCache(cls.name);

        res.json({
            success: true,
            message: `🔄 Struktur Pengurus Kelas ${cls.name} berhasil di-reset total oleh Administrator (${user?.name || 'Admin'}). Seluruh posisi kembali terbuka.`
        });
    } catch (error: any) {
        console.error('Error resetting class officers:', error);
        res.status(500).json({ success: false, message: 'Gagal mereset pengurus kelas' });
    }
};
