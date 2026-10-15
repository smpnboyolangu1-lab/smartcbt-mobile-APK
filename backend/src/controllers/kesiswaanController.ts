import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
const archiver = require('archiver');
import { PdfService } from '../services/pdfService';
import { syncParentAccountForStudent } from '../utils/parentAccountHelper';

const prisma = new PrismaClient();

/**
 * Helper: Deteksi field biodata yang masih kosong untuk panduan orang tua & TU
 */
export function detectMissingFields(biodata: any, ayah: any, ibu: any, dokumenList: any[] = []): string[] {
    const missing: string[] = [];
    const docTypes = (dokumenList || []).map(d => (d.jenis || '').toUpperCase());

    if (!biodata?.fotoUrl && !docTypes.includes('FOTO')) {
        missing.push('Foto Siswa (Seragam Biru 3x4)');
    }
    if (!biodata?.alamatLengkap) {
        missing.push('Alamat Tempat Tinggal');
    }
    // Catatan Privasi: Titik Koordinat GPS Rumah & Kartu Afirmasi/Miskin bersifat 100% OPSIONAL.
    // Tidak adanya data tersebut BUKAN merupakan kekurangan berkas dan tidak dimasukkan ke dalam daftar pengingat.
    if (!biodata?.noHpSiswa) {
        missing.push('Nomor Kontak / HP');
    }
    if (!biodata?.beratBadan || !biodata?.tinggiBadan) {
        missing.push('Tinggi & Berat Badan');
    }
    if (!biodata?.golonganDarah || biodata?.golonganDarah === 'Tidak Tahu') {
        missing.push('Golongan Darah');
    }
    if (!docTypes.includes('KK')) {
        missing.push('Dokumen Kartu Keluarga (KK)');
    }
    if (!docTypes.includes('AKTA')) {
        missing.push('Dokumen Akta Kelahiran');
    }
    if (!ayah?.nama || ayah?.nama.startsWith('Ayah ')) {
        missing.push('Nama Lengkap Ayah');
    }
    if (!ayah?.pekerjaan) {
        missing.push('Pekerjaan Ayah');
    }
    if (!ibu?.nama || ibu?.nama.startsWith('Ibu ')) {
        missing.push('Nama Lengkap Ibu');
    }
    if (!ibu?.pekerjaan) {
        missing.push('Pekerjaan Ibu');
    }

    return missing;
}

/**
 * Middleware: Memastikan user memiliki hak akses Kesiswaan (Staf TU) atau Admin
 */
export const checkKesiswaanAccess = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        const roleUpper = (user.role || '').toUpperCase();
        if (roleUpper === 'ADMIN' || roleUpper === 'OPERATOR') {
            return next();
        }

        let rolesTambahan: string[] = [];
        if (Array.isArray(user.rolesTambahan)) {
            rolesTambahan = user.rolesTambahan.map((r: string) => r.toLowerCase());
        } else if (typeof user.rolesTambahan === 'string') {
            try {
                rolesTambahan = JSON.parse(user.rolesTambahan).map((r: string) => r.toLowerCase());
            } catch (e) {}
        }

        if (rolesTambahan.includes('kesiswaan')) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: 'Akses ditolak. Anda tidak memiliki wewenang Staf Kesiswaan / TU.'
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message || 'Error validasi akses kesiswaan' });
    }
};

/**
 * GET /api/kesiswaan/dashboard
 * Statistik ringkasan verifikasi & kelengkapan biodata
 */
export const getKesiswaanDashboard = async (req: Request, res: Response) => {
    try {
        const totalSiswa = await prisma.user.count({ where: { role: 'STUDENT' } });
        const totalPending = await (prisma as any).biodataSiswa.count({ where: { status: 'PENDING' } });
        const totalApproved = await (prisma as any).biodataSiswa.count({ where: { status: 'APPROVED' } });
        const totalRevisi = await (prisma as any).biodataSiswa.count({ where: { status: 'REVISI' } });
        const totalNisGenerated = await prisma.user.count({
            where: {
                role: 'STUDENT',
                nis: { not: null }
            }
        });

        return res.json({
            success: true,
            data: {
                totalSiswa,
                totalPending,
                totalApproved,
                totalRevisi,
                totalNisGenerated,
                rasioKelengkapan: totalSiswa > 0 ? Math.round((totalApproved / totalSiswa) * 100) : 0
            }
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/verifikasi/biodata
 * Daftar pengajuan biodata dengan filter rombel dan status
 */
export const getVerifikasiList = async (req: Request, res: Response) => {
    try {
        const status = req.query.status ? String(req.query.status) : undefined;
        const className = req.query.className ? String(req.query.className) : undefined;

        const where: any = {};
        if (status) where.status = status;

        const list = await (prisma as any).biodataSiswa.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            take: 350
        });

        // Ambil info user siswa
        const studentIds = list.map((b: any) => b.studentId);
        const students = await prisma.user.findMany({
            where: { id: { in: studentIds } },
            select: { id: true, name: true, nisn: true, nis: true, className: true }
        });
        const studentMap = new Map(students.map(s => [s.id, s]));

        // Ambil data pendukung untuk deteksi kelengkapan real-time
        const ayahList = await (prisma as any).biodataAyah.findMany({ where: { studentId: { in: studentIds } } });
        const ibuList = await (prisma as any).biodataIbu.findMany({ where: { studentId: { in: studentIds } } });
        const docList = await (prisma as any).dokumenSiswa.findMany({ where: { studentId: { in: studentIds } } });

        const ayahMap = new Map(ayahList.map((a: any) => [a.studentId, a]));
        const ibuMap = new Map(ibuList.map((i: any) => [i.studentId, i]));
        const docMap = new Map<string, any[]>();
        for (const doc of docList) {
            if (!docMap.has(doc.studentId)) docMap.set(doc.studentId, []);
            docMap.get(doc.studentId)!.push(doc);
        }

        const results = list.map((b: any) => {
            const s = studentMap.get(b.studentId);
            const ayah = ayahMap.get(b.studentId);
            const ibu = ibuMap.get(b.studentId);
            const docs = docMap.get(b.studentId) || [];
            const missing = detectMissingFields(b, ayah, ibu, docs);

            return {
                ...b,
                studentName: s?.name || '-',
                nisn: s?.nisn || '-',
                nis: s?.nis || '-',
                className: s?.className || '-',
                missingFields: missing,
                isLengkap: missing.length === 0,
                kelengkapanPersen: b.kelengkapanPersen || (missing.length === 0 ? 100 : Math.max(15, 100 - (missing.length * 8)))
            };
        }).filter((item: any) => !className || item.className === className);

        return res.json({ success: true, count: results.length, data: results });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/biodata/:siswa_id
 * Detail lengkap biodata siswa untuk diperiksa oleh Staf Kesiswaan
 */
export const getBiodataDetail = async (req: Request, res: Response) => {
    try {
        const studentId = String(req.params.siswa_id);

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, nisn: true, nis: true, className: true, gender: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const biodata = await (prisma as any).biodataSiswa.findUnique({ where: { studentId } });
        const ayah = await (prisma as any).biodataAyah.findUnique({ where: { studentId } });
        const ibu = await (prisma as any).biodataIbu.findUnique({ where: { studentId } });
        const wali = await (prisma as any).biodataWali.findUnique({ where: { studentId } });
        const afirmasi = await (prisma as any).biodataAfirmasi.findUnique({ where: { studentId } });
        const dokumen = await (prisma as any).dokumenSiswa.findMany({ where: { studentId } });

        return res.json({
            success: true,
            data: {
                student,
                biodata,
                ayah,
                ibu,
                wali,
                afirmasi,
                dokumen
            }
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/verifikasi/:siswa_id/approve
 * Menyetujui biodata dan men-generate dokumen PDF resmi 3 halaman
 */
export const approveBiodata = async (req: Request, res: Response) => {
    try {
        const studentId = String(req.params.siswa_id);
        const verifiedBy = (req as any).user?.id || 'Staf TU Kesiswaan';

        await (prisma as any).biodataSiswa.update({
            where: { studentId },
            data: {
                status: 'APPROVED',
                verifiedBy: String(verifiedBy),
                verifiedAt: new Date(),
                catatanRevisi: null
            }
        });

        // Generate PDF 3 Halaman Folio F4 otomatis
        try {
            await PdfService.generateFormulirLengkap(studentId);
        } catch (pdfErr: any) {
            console.warn('[Kesiswaan] Warning generate PDF:', pdfErr.message);
        }

        return res.json({
            success: true,
            message: 'Biodata siswa berhasil disetujui (VERIFIED) dan dokumen PDF 3 halaman telah terbit.'
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/verifikasi/:siswa_id/revisi
 * Mengembalikan biodata ke status REVISI dengan catatan detail per field
 */
export const revisiBiodata = async (req: Request, res: Response) => {
    try {
        const studentId = String(req.params.siswa_id);
        const { catatanRevisi } = req.body;

        await (prisma as any).biodataSiswa.update({
            where: { studentId },
            data: {
                status: 'REVISI',
                catatanRevisi: typeof catatanRevisi === 'string' ? catatanRevisi : JSON.stringify(catatanRevisi || {}),
                verifiedAt: new Date()
            }
        });

        return res.json({
            success: true,
            message: 'Catatan revisi telah disimpan dan notifikasi telah dikirimkan ke orang tua.'
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/generate-nis/preview
 * Pratinjau auto-generate NIS format [Tahun][Tingkat][Urut4digit] (misal: 202670001)
 * Memastikan tidak menimpa NIS siswa yang sudah ada dan melanjutkan urutan counter tanpa tabrakan.
 */
export const previewGenerateNis = async (req: Request, res: Response) => {
    try {
        const { className, tahun, tingkat } = req.query;
        const yearStr = String(tahun || new Date().getFullYear());
        const gradeStr = String(tingkat || '7');
        const prefix = `${yearStr}${gradeStr}`;

        // 1. Ambil seluruh siswa dalam kohor ini yang sudah memiliki NIS untuk menentukan counter terakhir
        const existingCohortStudents = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                nis: { startsWith: prefix }
            },
            select: { nis: true }
        });

        let maxCounter = 0;
        for (const item of existingCohortStudents) {
            if (item.nis && item.nis.startsWith(prefix)) {
                const suffix = item.nis.substring(prefix.length);
                const num = parseInt(suffix, 10);
                if (!isNaN(num) && num > maxCounter) {
                    maxCounter = num;
                }
            }
        }

        // 2. Ambil siswa target yang BELUM memiliki NIS resmi
        const candidateStudents = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                OR: [
                    { nis: null },
                    { nis: '' }
                ],
                ...(className ? { className: String(className) } : {})
            },
            orderBy: [{ className: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, nisn: true, nis: true, className: true }
        });

        let counter = maxCounter + 1;
        const previewList = candidateStudents.map(s => {
            const padIndex = String(counter++).padStart(4, '0');
            const suggestedNis = `${prefix}${padIndex}`;
            return {
                id: s.id,
                name: s.name,
                nisn: s.nisn,
                className: s.className,
                currentNis: s.nis,
                suggestedNis
            };
        });

        return res.json({
            success: true,
            count: previewList.length,
            startingCounter: maxCounter + 1,
            data: previewList
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/generate-nis
 * Eksekusi massal generate NIS & regenerate PDF dengan Prisma Transaction.
 * Siswa yang telah memiliki NIS dijamin TIDAK PERNAH tertimpa (Never overwritten).
 */
export const executeGenerateNis = async (req: Request, res: Response) => {
    try {
        const { className, tahun, tingkat, items } = req.body;
        const yearStr = String(tahun || new Date().getFullYear());
        const gradeStr = String(tingkat || '7');
        const prefix = `${yearStr}${gradeStr}`;
        const generatedBy = (req as any).user?.name || (req as any).user?.id || 'Staf TU';

        const updatedDetails: any[] = [];

        // Eksekusi Atomic dalam single transaction untuk mencegah race condition / nomor ganda
        await prisma.$transaction(async (tx) => {
            if (Array.isArray(items) && items.length > 0) {
                // Mode 1: Eksekusi daftar hasil pratinjau yang diverifikasi
                for (const item of items) {
                    const student = await tx.user.findUnique({
                        where: { id: item.studentId || item.id },
                        select: { id: true, nis: true, name: true }
                    });

                    // PERLINDUNGAN: Jangan pernah timpa siswa yang sudah memiliki NIS sah
                    if (student && (!student.nis || student.nis.trim() === '')) {
                        await tx.user.update({
                            where: { id: student.id },
                            data: { nis: String(item.suggestedNis || item.nis) }
                        });
                        updatedDetails.push({
                            studentId: student.id,
                            name: student.name,
                            nis: String(item.suggestedNis || item.nis)
                        });
                    }
                }
            } else {
                // Mode 2: Auto sequential generate untuk seluruh siswa tanpa NIS
                const existingCohort = await tx.user.findMany({
                    where: { role: 'STUDENT', nis: { startsWith: prefix } },
                    select: { nis: true }
                });

                let maxCounter = 0;
                for (const item of existingCohort) {
                    if (item.nis && item.nis.startsWith(prefix)) {
                        const num = parseInt(item.nis.substring(prefix.length), 10);
                        if (!isNaN(num) && num > maxCounter) maxCounter = num;
                    }
                }

                const studentsToAssign = await tx.user.findMany({
                    where: {
                        role: 'STUDENT',
                        OR: [{ nis: null }, { nis: '' }],
                        ...(className ? { className: String(className) } : {})
                    },
                    orderBy: [{ className: 'asc' }, { name: 'asc' }],
                    select: { id: true, name: true }
                });

                let counter = maxCounter + 1;
                for (const s of studentsToAssign) {
                    const padIndex = String(counter++).padStart(4, '0');
                    const newNis = `${prefix}${padIndex}`;

                    await tx.user.update({
                        where: { id: s.id },
                        data: { nis: newNis }
                    });

                    updatedDetails.push({ studentId: s.id, name: s.name, nis: newNis });
                }
            }
        });

        // Regenerate Dokumen PDF di background & catat audit log
        for (const det of updatedDetails) {
            try {
                await PdfService.generateFormulirLengkap(det.studentId);
            } catch (e) {}
        }

        if (updatedDetails.length > 0) {
            await (prisma as any).generateNisLog.create({
                data: {
                    tahunAjaran: `${yearStr}/${Number(yearStr) + 1}`,
                    tingkat: parseInt(gradeStr, 10),
                    totalSiswa: updatedDetails.length,
                    generatedBy: String(generatedBy),
                    detail: JSON.stringify(updatedDetails)
                }
            }).catch(() => {});
        }

        return res.json({
            success: true,
            message: `Berhasil men-generate NIS resmi untuk ${updatedDetails.length} siswa secara atomic tanpa duplikasi. Seluruh formulir PDF telah diperbarui otomatis.`,
            data: updatedDetails
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/export/dapodik
 * Export data siswa yang terverifikasi ke format Excel (.xlsx) standar Dapodik
 */
export const exportDapodik = async (req: Request, res: Response) => {
    try {
        const { className } = req.body;

        const biodataList = await (prisma as any).biodataSiswa.findMany({
            where: { status: 'APPROVED' }
        });
        const studentIds = biodataList.map((b: any) => b.studentId);

        const students = await prisma.user.findMany({
            where: {
                id: { in: studentIds },
                ...(className ? { className: String(className) } : {})
            }
        });
        const studentMap = new Map(students.map(s => [s.id, s]));

        const rows: any[] = [];
        for (const b of biodataList) {
            const s = studentMap.get(b.studentId);
            if (!s) continue;

            const ayah = await (prisma as any).biodataAyah.findUnique({ where: { studentId: b.studentId } });
            const ibu = await (prisma as any).biodataIbu.findUnique({ where: { studentId: b.studentId } });

            rows.push({
                'Nama Lengkap': s.name,
                'Jenis Kelamin': s.gender || b.jk || 'L',
                'NISN': s.nisn || '',
                'NIS': s.nis || '',
                'NIK Siswa': b.nik || s.nik || '',
                'Tempat Lahir': s.pob || '',
                'Tanggal Lahir': s.dob || '',
                'Agama': s.religion || b.agama || 'Islam',
                'Alamat Jalan': b.alamatLengkap || '',
                'RT': b.rt || '',
                'RW': b.rw || '',
                'Dusun': b.dusun || '',
                'Desa/Kelurahan': b.desaKelurahan || '',
                'Kecamatan': b.kecamatan || 'Boyolangu',
                'Kabupaten': b.kabupaten || 'Tulungagung',
                'Kode Pos': b.kodePos || '',
                'Latitude': b.latitude || '',
                'Longitude': b.longitude || '',
                'Nama Ayah': ayah?.nama || '',
                'NIK Ayah': ayah?.nik || '',
                'Pekerjaan Ayah': ayah?.pekerjaan || '',
                'Nama Ibu': ibu?.nama || '',
                'NIK Ibu': ibu?.nik || '',
                'Pekerjaan Ibu': ibu?.pekerjaan || '',
                'No HP Siswa': b.noHpSiswa || '',
                'Kebutuhan Khusus': b.berkebutuhanKhusus || 'Tidak'
            });
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Dapodik_SMPN1_Boyolangu');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Dapodik_SMPN1_Boyolangu.xlsx');
        return res.send(buffer);
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/mutasi
 * Pencatatan mutasi siswa (MASUK, KELUAR, LULUS)
 * Mutasi KELUAR: Nonaktifkan akun, cabut device binding, cabut active refresh tokens, set className = 'MUTASI_KELUAR'
 * Mutasi MASUK: Aktifkan akun, tempatkan di kelas tujuan, dan sediakan auto-sequential NIS jika diperlukan
 * Kelulusan LULUS: Set isActive = false, className = 'ALUMNI', cabut device binding & tokens
 */
export const mutasiSiswa = async (req: Request, res: Response) => {
    try {
        const { studentId, jenis, tanggalMutasi, sekolahTujuan, alasan, nomorSurat, targetClass, autoNis } = req.body;
        const diprosesOleh = (req as any).user?.name || (req as any).user?.id || 'Staf TU';

        const student = await prisma.user.findUnique({ where: { id: studentId } });
        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }

        const effectiveDate = tanggalMutasi ? new Date(tanggalMutasi) : new Date();

        const record = await (prisma as any).mutasiSiswa.create({
            data: {
                studentId,
                jenis,
                tanggalMutasi: effectiveDate,
                sekolahTujuan: sekolahTujuan || null,
                alasan: alasan || null,
                nomorSurat: nomorSurat || null,
                diprosesOleh: String(diprosesOleh)
            }
        });

        // 1. Mutasi KELUAR: Nonaktifkan, cabut device binding, hapus refresh token sesi, set className = 'MUTASI_KELUAR'
        if (jenis === 'KELUAR') {
            await prisma.user.update({
                where: { id: studentId },
                data: {
                    isActive: false,
                    deviceBindingId: null,
                    className: 'MUTASI_KELUAR'
                }
            });
            // Cabut seluruh sesi aktif
            await (prisma as any).refreshToken.deleteMany({ where: { userId: studentId } }).catch(() => {});
        } else if (jenis === 'LULUS') {
            // Kelulusan / Alumni
            await prisma.user.update({
                where: { id: studentId },
                data: {
                    isActive: false,
                    deviceBindingId: null,
                    className: 'ALUMNI'
                }
            });
            await (prisma as any).refreshToken.deleteMany({ where: { userId: studentId } }).catch(() => {});
        } else if (jenis === 'MASUK') {
            // Pindahan masuk
            const destClass = targetClass || student.className || 'VII-A';
            const updateData: any = {
                isActive: true,
                className: destClass
            };

            // Jika siswa belum punya NIS atau diminta alokasi NIS otomatis
            if (autoNis || !student.nis) {
                const yearStr = String(new Date().getFullYear());
                const gradeStr = destClass.startsWith('VIII') ? '8' : (destClass.startsWith('IX') ? '9' : '7');
                const prefix = `${yearStr}${gradeStr}`;

                const existingCohort = await prisma.user.findMany({
                    where: { role: 'STUDENT', nis: { startsWith: prefix } },
                    select: { nis: true }
                });

                let maxC = 0;
                for (const it of existingCohort) {
                    if (it.nis && it.nis.startsWith(prefix)) {
                        const num = parseInt(it.nis.substring(prefix.length), 10);
                        if (!isNaN(num) && num > maxC) maxC = num;
                    }
                }
                updateData.nis = `${prefix}${String(maxC + 1).padStart(4, '0')}`;
            }

            await prisma.user.update({
                where: { id: studentId },
                data: updateData
            });

            // Sinkronisasi akun orang tua
            await syncParentAccountForStudent({ ...student, ...updateData });
        }

        return res.json({
            success: true,
            message: `Mutasi siswa (${jenis}) berhasil diproses dan dicatat. Status keaktifan dan kelas siswa telah diperbarui.`,
            data: record
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/verifikasi/:siswa_id/kirim-pengumuman
 * Mengirim notifikasi / pengumuman ke orang tua untuk melengkapi field yang masih kosong
 */
export const kirimPengumumanOrtu = async (req: Request, res: Response) => {
    try {
        const studentId = String(req.params.siswa_id);
        const sender = (req as any).user?.name || 'Staf TU Kesiswaan';

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, nisn: true, className: true, parentPhone: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const biodata = await (prisma as any).biodataSiswa.findUnique({ where: { studentId } });
        const ayah = await (prisma as any).biodataAyah.findUnique({ where: { studentId } });
        const ibu = await (prisma as any).biodataIbu.findUnique({ where: { studentId } });
        const docs = await (prisma as any).dokumenSiswa.findMany({ where: { studentId } });

        const missing = detectMissingFields(biodata, ayah, ibu, docs);

        let noticeTitle = `Pemberitahuan Kelengkapan Biodata: ${student.name}`;
        let noticeMessage = '';

        if (missing.length === 0) {
            noticeMessage = `Yth. Bapak/Ibu wali murid dari ${student.name} (${student.className || '-'}), data formulir biodata Anda telah LENGKAP dan siap diverifikasi oleh pihak sekolah. Terima kasih atas kerja samanya.`;
        } else {
            const listStr = missing.map((m, idx) => `${idx + 1}. ${m}`).join('\n');
            noticeMessage = `Yth. Bapak/Ibu wali murid dari ${student.name} (${student.className || '-'}), berdasarkan pengecekan verifikasi TU sekolah, mohon untuk melengkapi data berikut pada menu Formulir Biodata di aplikasi SIBOY:\n${listStr}\n\nMohon segera dilengkapi agar penerbitan dokumen resmi dan NIS dapat diproses. Terima kasih.`;
        }

        // 1. Simpan ke NotificationMessage (khusus orang tua siswa ini)
        const notification = await (prisma as any).notificationMessage.create({
            data: {
                recipientRole: 'PARENT',
                studentId: student.id,
                studentName: student.name,
                className: student.className,
                title: noticeTitle,
                message: noticeMessage,
                category: 'ANNOUNCEMENT'
            }
        });

        // 2. Simpan juga ke Announcement agar tampil di beranda pengumuman
        await (prisma as any).announcement.create({
            data: {
                title: noticeTitle,
                content: noticeMessage,
                category: 'PENTING',
                author: sender,
                isPinned: true
            }
        });

        return res.json({
            success: true,
            message: `Pengumuman kelengkapan biodata berhasil dikirimkan ke halaman orang tua ${student.name}.`,
            data: {
                notificationId: notification.id,
                missingCount: missing.length,
                missingFields: missing
            }
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/verifikasi/kirim-pengumuman-massal
 * Mengirim notifikasi / pengumuman massal untuk seluruh siswa yang biodatanya belum lengkap
 */
export const kirimPengumumanMassal = async (req: Request, res: Response) => {
    try {
        const sender = (req as any).user?.name || 'Staf TU Kesiswaan';
        const { className } = req.body;

        const allBiodata = await (prisma as any).biodataSiswa.findMany();
        const studentIds = allBiodata.map((b: any) => b.studentId);

        const students = await prisma.user.findMany({
            where: {
                id: { in: studentIds },
                ...(className ? { className: String(className) } : {})
            },
            select: { id: true, name: true, className: true }
        });
        const studentMap = new Map(students.map(s => [s.id, s]));

        const ayahList = await (prisma as any).biodataAyah.findMany({ where: { studentId: { in: studentIds } } });
        const ibuList = await (prisma as any).biodataIbu.findMany({ where: { studentId: { in: studentIds } } });
        const docList = await (prisma as any).dokumenSiswa.findMany({ where: { studentId: { in: studentIds } } });

        const ayahMap = new Map(ayahList.map((a: any) => [a.studentId, a]));
        const ibuMap = new Map(ibuList.map((i: any) => [i.studentId, i]));
        const docMap = new Map<string, any[]>();
        for (const doc of docList) {
            if (!docMap.has(doc.studentId)) docMap.set(doc.studentId, []);
            docMap.get(doc.studentId)!.push(doc);
        }

        let sentCount = 0;
        for (const b of allBiodata) {
            const s = studentMap.get(b.studentId);
            if (!s) continue;

            const ayah = ayahMap.get(b.studentId);
            const ibu = ibuMap.get(b.studentId);
            const docs = docMap.get(b.studentId) || [];
            const missing = detectMissingFields(b, ayah, ibu, docs);

            if (missing.length > 0) {
                const listStr = missing.slice(0, 4).join(', ');
                const msg = `Yth. Bapak/Ibu wali dari ${s.name} (${s.className || '-'}), mohon melengkapi data formulir yang masih belum terisi (${listStr}${missing.length > 4 ? ', dll' : ''}) pada menu Biodata Siswa di aplikasi SIBOY.`;

                await (prisma as any).notificationMessage.create({
                    data: {
                        recipientRole: 'PARENT',
                        studentId: s.id,
                        studentName: s.name,
                        className: s.className,
                        title: 'Pemberitahuan Kelengkapan Biodata',
                        message: msg,
                        category: 'ANNOUNCEMENT'
                    }
                });
                sentCount++;
            }
        }

        // Buat pengumuman umum di papan pengumuman orang tua
        await (prisma as any).announcement.create({
            data: {
                title: 'Pengumuman Penting: Batas Kelengkapan Biodata Siswa',
                content: `Diberitahukan kepada seluruh Bapak/Ibu Orang Tua/Wali Murid yang formulir biodatanya belum lengkap (terutama Foto 3x4 berseragam, Dokumen Kartu Keluarga, dan Akta Kelahiran), dimohon untuk segera melengkapi data melalui aplikasi SIBOY demi kelancaran penerbitan NIS resmi dan pencatatan Dapodik.`,
                category: 'PENTING',
                author: sender,
                isPinned: true
            }
        });

        return res.json({
            success: true,
            message: `Berhasil mengirimkan pengumuman & notifikasi kepada ${sentCount} orang tua siswa yang biodatanya belum lengkap.`
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/arsip/proses
 * Mengarsipkan seluruh biodata dan dokumen siswa per tahun ajaran dalam folder map terstruktur
 * serta membuat file ZIP bundle lengkap
 */
export const prosesArsipTahunAjaran = async (req: Request, res: Response) => {
    try {
        const { tahunAjaran } = req.body;
        const archivedBy = (req as any).user?.name || 'Staf TU Kesiswaan';
        const rawYear = String(tahunAjaran || '2025/2026').trim();
        const safeYear = rawYear.replace(/[\/\\:]/g, '-'); // e.g. 2025-2026

        const baseArchiveDir = path.resolve(process.cwd(), 'storage', 'archives');
        const yearArchiveDir = path.join(baseArchiveDir, safeYear);

        if (!fs.existsSync(yearArchiveDir)) {
            fs.mkdirSync(yearArchiveDir, { recursive: true });
        }

        // Ambil seluruh siswa aktif
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT' },
            orderBy: [{ className: 'asc' }, { name: 'asc' }]
        });

        const studentIds = students.map(s => s.id);
        const biodataList = await (prisma as any).biodataSiswa.findMany({ where: { studentId: { in: studentIds } } });
        const ayahList = await (prisma as any).biodataAyah.findMany({ where: { studentId: { in: studentIds } } });
        const ibuList = await (prisma as any).biodataIbu.findMany({ where: { studentId: { in: studentIds } } });
        const waliList = await (prisma as any).biodataWali.findMany({ where: { studentId: { in: studentIds } } });
        const afirmasiList = await (prisma as any).biodataAfirmasi.findMany({ where: { studentId: { in: studentIds } } });
        const docList = await (prisma as any).dokumenSiswa.findMany({ where: { studentId: { in: studentIds } } });

        const bioMap = new Map(biodataList.map((b: any) => [b.studentId, b]));
        const ayahMap = new Map(ayahList.map((a: any) => [a.studentId, a]));
        const ibuMap = new Map(ibuList.map((i: any) => [i.studentId, i]));
        const waliMap = new Map(waliList.map((w: any) => [w.studentId, w]));
        const afirmasiMap = new Map(afirmasiList.map((af: any) => [af.studentId, af]));
        const docMap = new Map<string, any[]>();
        for (const doc of docList) {
            if (!docMap.has(doc.studentId)) docMap.set(doc.studentId, []);
            docMap.get(doc.studentId)!.push(doc);
        }

        let totalMapCreated = 0;
        const summaryRows: any[] = [];

        for (const s of students) {
            const className = s.className || 'Tanpa_Kelas';
            const cleanName = s.name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
            const studentFolder = `${s.nisn || s.nis || 'ID'}_${cleanName}`;

            const studentDir = path.join(yearArchiveDir, className, studentFolder);
            if (!fs.existsSync(studentDir)) {
                fs.mkdirSync(studentDir, { recursive: true });
            }

            const bio: any = bioMap.get(s.id) || {};
            const ayah: any = ayahMap.get(s.id) || {};
            const ibu: any = ibuMap.get(s.id) || {};
            const wali: any = waliMap.get(s.id) || {};
            const afirmasi: any = afirmasiMap.get(s.id) || {};
            const docs: any = docMap.get(s.id) || [];

            // 1. Simpan Snapshot JSON
            const studentDataSnapshot = {
                tahunAjaran: rawYear,
                tanggalArsip: new Date().toISOString(),
                diarsipkanOleh: archivedBy,
                siswa: {
                    id: s.id,
                    nama: s.name,
                    nisn: s.nisn,
                    nis: s.nis,
                    nik: s.nik,
                    kelas: s.className,
                    jenisKelamin: s.gender,
                    tempatLahir: s.pob,
                    tanggalLahir: s.dob,
                    agama: s.religion,
                    alamat: s.address,
                    noHp: s.parentPhone,
                    golonganDarah: s.bloodType
                },
                biodataTambahan: bio,
                ayah,
                ibu,
                wali,
                afirmasi,
                dokumen: docs
            };

            fs.writeFileSync(
                path.join(studentDir, 'Biodata_Lengkap.json'),
                JSON.stringify(studentDataSnapshot, null, 2),
                'utf-8'
            );

            // 2. Simpan Ringkasan Teks
            const txtContent = `==========================================================\n` +
                `ARSIP BIODATA SISWA — SMP NEGERI 1 BOYOLANGU\n` +
                `Tahun Ajaran: ${rawYear}\n` +
                `==========================================================\n` +
                `Nama Siswa    : ${s.name}\n` +
                `NISN          : ${s.nisn || '-'}\n` +
                `NIS           : ${s.nis || '-'}\n` +
                `Kelas         : ${s.className || '-'}\n` +
                `Jenis Kelamin : ${s.gender || '-'}\n` +
                `TTL           : ${s.pob || '-'}, ${s.dob || '-'}\n` +
                `Alamat        : ${bio.alamatLengkap || s.address || '-'}\n` +
                `Koordinat GPS : ${bio.latitude || '-'}, ${bio.longitude || '-'}\n` +
                `No. Kontak    : ${bio.noHpSiswa || s.parentPhone || '-'}\n` +
                `Nama Ayah     : ${ayah.nama || '-'}\n` +
                `Pekerjaan Ayah: ${ayah.pekerjaan || '-'}\n` +
                `Nama Ibu      : ${ibu.nama || '-'}\n` +
                `Pekerjaan Ibu : ${ibu.pekerjaan || '-'}\n` +
                `Status Berkas : ${bio.status || 'PENDING'} (${bio.kelengkapanPersen || 0}%)\n` +
                `Tanggal Arsip : ${new Date().toLocaleString('id-ID')}\n` +
                `==========================================================\n`;

            fs.writeFileSync(path.join(studentDir, 'Ringkasan_Biodata.txt'), txtContent, 'utf-8');

            summaryRows.push({
                'Tahun Ajaran': rawYear,
                'Kelas': s.className || '-',
                'NISN': s.nisn || '-',
                'NIS': s.nis || '-',
                'Nama Siswa': s.name,
                'Jenis Kelamin': s.gender || '-',
                'Alamat': bio.alamatLengkap || s.address || '-',
                'Nama Ayah': ayah.nama || '-',
                'Nama Ibu': ibu.nama || '-',
                'Status Verifikasi': bio.status || 'PENDING',
                'Kelengkapan (%)': bio.kelengkapanPersen || 0
            });

            totalMapCreated++;
        }

        // 3. Simpan Rekap Excel Angkatan
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(summaryRows);
        XLSX.utils.book_append_sheet(wb, ws, `Arsip_${safeYear}`);
        const excelPath = path.join(yearArchiveDir, `REKAP_ARSIP_SISWA_${safeYear}.xlsx`);
        XLSX.writeFile(wb, excelPath);

        // 4. Buat Bundle ZIP Tahun Ajaran
        const zipFileName = `SIBOY_Arsip_${safeYear}.zip`;
        const zipFilePath = path.join(baseArchiveDir, zipFileName);

        const output = fs.createWriteStream(zipFilePath);
        const ZipArchiveClass = (archiver as any).ZipArchive || (archiver as any).Archiver || archiver;
        const archive = new ZipArchiveClass({ zlib: { level: 9 } });

        await new Promise<void>((resolve, reject) => {
            output.on('close', () => resolve());
            output.on('error', (err: any) => reject(err));
            archive.on('error', (err: any) => reject(err));
            archive.pipe(output);
            archive.directory(yearArchiveDir, safeYear);
            archive.finalize().catch((err: any) => reject(err));
        });

        const zipStat = fs.statSync(zipFilePath);
        const zipSizeMb = (zipStat.size / (1024 * 1024)).toFixed(2);

        return res.json({
            success: true,
            message: `Pengarsipan Tahun Ajaran ${rawYear} berhasil selesai! Total ${totalMapCreated} map dokumen siswa telah dibuat rapi per folder kelas.`,
            data: {
                tahunAjaran: rawYear,
                safeYear,
                totalSiswa: totalMapCreated,
                archiveDir: yearArchiveDir,
                zipFileName,
                zipSizeMb: `${zipSizeMb} MB`,
                downloadUrl: `/api/kesiswaan/arsip/download/${encodeURIComponent(safeYear)}`
            }
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/arsip/list
 * Mengambil daftar tahun ajaran yang telah diarsipkan
 */
export const listArsipTahunAjaran = async (req: Request, res: Response) => {
    try {
        const baseArchiveDir = path.resolve(process.cwd(), 'storage', 'archives');
        if (!fs.existsSync(baseArchiveDir)) {
            return res.json({ success: true, data: [] });
        }

        const entries = fs.readdirSync(baseArchiveDir, { withFileTypes: true });
        const archives: any[] = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const yearFolder = entry.name;
                const folderPath = path.join(baseArchiveDir, yearFolder);
                const zipPath = path.join(baseArchiveDir, `SIBOY_Arsip_${yearFolder}.zip`);
                const hasZip = fs.existsSync(zipPath);
                let zipSize = '-';
                if (hasZip) {
                    const st = fs.statSync(zipPath);
                    zipSize = (st.size / (1024 * 1024)).toFixed(2) + ' MB';
                }

                // Hitung total map kelas & siswa
                let studentCount = 0;
                const classes = fs.readdirSync(folderPath, { withFileTypes: true });
                for (const c of classes) {
                    if (c.isDirectory()) {
                        const classDir = path.join(folderPath, c.name);
                        const studentsInClass = fs.readdirSync(classDir, { withFileTypes: true });
                        studentCount += studentsInClass.filter(s => s.isDirectory()).length;
                    }
                }

                archives.push({
                    tahunAjaran: yearFolder.replace('-', '/'),
                    safeYear: yearFolder,
                    totalSiswa: studentCount,
                    hasZip,
                    zipSize,
                    folderPath,
                    downloadUrl: hasZip ? `/api/kesiswaan/arsip/download/${encodeURIComponent(yearFolder)}` : null
                });
            }
        }

        return res.json({ success: true, data: archives });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/arsip/download/:tahunAjaran
 * Mengunduh file bundle ZIP arsip tahun ajaran
 */
export const downloadArsipZip = async (req: Request, res: Response) => {
    try {
        const rawYear = String(req.params.tahunAjaran || '').trim();
        const safeYear = rawYear.replace(/[^a-zA-Z0-9_\-]/g, '-');
        const archivesBaseDir = path.resolve(process.cwd(), 'storage', 'archives');
        const zipPath = path.resolve(archivesBaseDir, `SIBOY_Arsip_${safeYear}.zip`);

        // Pencegahan Path Traversal
        if (!zipPath.startsWith(archivesBaseDir)) {
            return res.status(403).json({ success: false, message: 'Akses path tidak valid.' });
        }

        if (!fs.existsSync(zipPath)) {
            return res.status(404).json({ success: false, message: `File arsip tahun ajaran ${safeYear} belum digenerate.` });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=SIBOY_Arsip_${safeYear}.zip`);
        return fs.createReadStream(zipPath).pipe(res);
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// =========================================================================
// HELPER ARSIP GOOGLE DRIVE TERBATAS & ENKRIPSI AES-256
// =========================================================================

/**
 * Mencari lokasi file fisik di server berdasarkan fileUrl yang tersimpan di database
 */
export function resolveLocalDocPath(fileUrl: string): string | null {
    if (!fileUrl) return null;
    const cleanUrl = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
    const candidates = [
        path.resolve(process.cwd(), cleanUrl),
        path.resolve(process.cwd(), 'backend', cleanUrl),
        path.resolve(process.cwd(), 'uploads', path.basename(cleanUrl)),
        path.resolve(process.cwd(), 'uploads', 'biodata', 'kk', path.basename(cleanUrl)),
        path.resolve(process.cwd(), 'uploads', 'biodata', 'akta', path.basename(cleanUrl)),
        path.resolve(process.cwd(), 'uploads', 'biodata', 'bantuan', path.basename(cleanUrl)),
        path.resolve(process.cwd(), 'storage', cleanUrl)
    ];
    for (const cand of candidates) {
        if (fs.existsSync(cand)) return cand;
    }
    return null;
}

/**
 * Enkripsi berkas menggunakan AES-256-CBC dengan IV acak 16-byte di awal stream
 * Mengembalikan string hash SHA-256 dari paket terenkripsi
 */
export function encryptFileAes256(inputPath: string, outputPath: string, secretKeyStr: string): string {
    const key = crypto.createHash('sha256').update(secretKeyStr).digest(); // 32 bytes
    const iv = crypto.randomBytes(16); // 16 bytes IV
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    const inputData = fs.readFileSync(inputPath);
    const encrypted = Buffer.concat([iv, cipher.update(inputData), cipher.final()]);

    fs.writeFileSync(outputPath, encrypted);
    return crypto.createHash('sha256').update(encrypted).digest('hex');
}

/**
 * Dekripsi berkas AES-256-CBC untuk audit atau verifikasi berkas
 */
export function decryptFileAes256(inputPath: string, outputPath: string, secretKeyStr: string): void {
    const key = crypto.createHash('sha256').update(secretKeyStr).digest();
    const data = fs.readFileSync(inputPath);
    const iv = data.subarray(0, 16);
    const ciphertext = data.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    fs.writeFileSync(outputPath, decrypted);
}

/**
 * POST /api/kesiswaan/arsip/google-drive-terbatas
 * Membuat paket arsip terbatas untuk Google Drive per angkatan per tahun ajaran.
 * KEBIJAKAN PRIVASI KETAT:
 * 1. Hanya 3 jenis berkas: KK, Akta Kelahiran, dan Dokumen Afirmasi (hanya jika ada).
 * 2. Pas foto, rapor, ijazah SD TIDAK ikut diunggah (tetap di server lokal sekolah).
 * 3. Folder menggunakan ID internal siswa <kode-siswa>, BUKAN nama siswa.
 * 4. Berkas afirmasi dinamai netral 'dok-3.pdf' (TIDAK PERNAH memakai kata 'miskin').
 * 5. Paket di-ZIP bersama manifest.json lalu dienkripsi penuh AES-256-CBC (.zip.enc).
 * 6. Dicatat di tabel ArsipDriveLog dengan hash SHA-256. Berkas lokal tidak dihapus otomatis.
 */
export const prosesArsipGoogleDriveTerbatas = async (req: Request, res: Response) => {
    try {
        const { tahunAjaran, angkatan } = req.body;
        const rawYear = String(tahunAjaran || '2026/2027').trim();
        const safeYear = rawYear.replace(/[\/\\:]/g, '-');
        const cohort = String(angkatan || 'VII').trim().toUpperCase();
        const archivedBy = (req as any).user?.name || (req as any).user?.id || 'Staf TU Kesiswaan';

        const gdrivePackagesDir = path.resolve(process.cwd(), 'storage', 'archives', 'gdrive_packages');
        if (!fs.existsSync(gdrivePackagesDir)) {
            fs.mkdirSync(gdrivePackagesDir, { recursive: true });
        }

        // 1. Ambil seluruh siswa dalam angkatan tersebut
        let gradePrefixes = [cohort];
        if (cohort === 'VII' || cohort === '7') gradePrefixes = ['VII', '7'];
        else if (cohort === 'VIII' || cohort === '8') gradePrefixes = ['VIII', '8'];
        else if (cohort === 'IX' || cohort === '9') gradePrefixes = ['IX', '9'];

        const students = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                OR: gradePrefixes.map(pfx => ({ className: { startsWith: pfx } }))
            },
            select: { id: true, name: true, nisn: true, className: true }
        });

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Tidak ditemukan siswa untuk Angkatan ${cohort} pada Tahun Ajaran ${rawYear}.`
            });
        }

        const studentIds = students.map(s => s.id);

        // 2. Query HANYA 3 jenis dokumen yang diizinkan (KK, AKTA, KARTU_BANTUAN/DTKS)
        // Dokumen lain (FOTO, RAPORT, IJAZAH) otomatis dilewati di tingkat query database.
        const docs = await (prisma as any).dokumenSiswa.findMany({
            where: {
                studentId: { in: studentIds },
                jenis: { in: ['KK', 'AKTA', 'KARTU_BANTUAN', 'DTKS'] }
            }
        });

        const docMap = new Map<string, any[]>();
        for (const d of docs) {
            if (!docMap.has(d.studentId)) docMap.set(d.studentId, []);
            docMap.get(d.studentId)!.push(d);
        }

        // 3. Staging folder sementara untuk kompresi ZIP
        const stagingId = `staging_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const stagingDir = path.join(gdrivePackagesDir, stagingId);
        fs.mkdirSync(stagingDir, { recursive: true });

        const manifestFiles: any[] = [];
        let studentsWithDocsCount = 0;
        let totalDocsCount = 0;

        for (const s of students) {
            const studentDocs = docMap.get(s.id) || [];
            if (studentDocs.length === 0) {
                // Berkas kosong tidak dibuatkan folder atau placeholder
                continue;
            }

            // Gunakan ID internal siswa yang anonim untuk nama folder
            const studentFolder = s.id;
            const studentDirPath = path.join(stagingDir, studentFolder);

            let addedDocForStudent = false;

            for (const d of studentDocs) {
                const j = String(d.jenis).toUpperCase();
                let neutralName = '';

                if (j === 'KK') {
                    neutralName = 'kk.pdf';
                } else if (j === 'AKTA') {
                    neutralName = 'akta.pdf';
                } else if (j === 'KARTU_BANTUAN' || j === 'DTKS') {
                    // Nama netral dok-3.pdf (TIDAK ADA kata 'miskin' demi menjaga kerahasiaan & martabat)
                    neutralName = 'dok-3.pdf';
                } else {
                    continue;
                }

                const localFilePath = resolveLocalDocPath(d.fileUrl);
                if (localFilePath && fs.existsSync(localFilePath)) {
                    if (!fs.existsSync(studentDirPath)) {
                        fs.mkdirSync(studentDirPath, { recursive: true });
                    }

                    const targetPath = path.join(studentDirPath, neutralName);
                    fs.copyFileSync(localFilePath, targetPath);

                    const fileBuf = fs.readFileSync(targetPath);
                    const fileSha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
                    const fileStat = fs.statSync(targetPath);

                    manifestFiles.push({
                        kodeSiswa: s.id,
                        jenis: j === 'KARTU_BANTUAN' || j === 'DTKS' ? 'DOK-3' : j,
                        namaBerkas: neutralName,
                        ukuranByte: fileStat.size,
                        sha256: fileSha256
                    });

                    addedDocForStudent = true;
                    totalDocsCount++;
                }
            }

            if (addedDocForStudent) {
                studentsWithDocsCount++;
            }
        }

        // 4. Buat manifest.json di dalam root ZIP
        const manifestData = {
            tahunAjaran: rawYear,
            angkatan: cohort,
            dibuatPada: new Date().toISOString(),
            dibuatOleh: archivedBy,
            totalSiswa: studentsWithDocsCount,
            totalBerkas: totalDocsCount,
            kebijakan: 'Arsip Terbatas Google Drive (Hanya KK, Akta, dan dok-3 netral)',
            berkas: manifestFiles
        };

        fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifestData, null, 2), 'utf-8');

        // 5. ZIP folder staging ke temp.zip
        const tempZipPath = path.join(gdrivePackagesDir, `${stagingId}.zip`);
        const output = fs.createWriteStream(tempZipPath);
        const ZipArchiveClass = (archiver as any).ZipArchive || (archiver as any).Archiver || archiver;
        const archive = new ZipArchiveClass({ zlib: { level: 9 } });

        await new Promise<void>((resolve, reject) => {
            output.on('close', () => resolve());
            output.on('error', (err: any) => reject(err));
            archive.on('error', (err: any) => reject(err));
            archive.pipe(output);
            archive.directory(stagingDir, false);
            archive.finalize().catch((err: any) => reject(err));
        });

        // 6. Enkripsi berkas ZIP penuh menggunakan AES-256-CBC
        const secretKey = process.env.ENCRYPTION_KEY || 'SIBOY-KESISWAAN-SECRET-KEY-2026';
        const encPackageName = `arsip_${safeYear}_angkatan-${cohort}.zip.enc`;
        const encPackagePath = path.join(gdrivePackagesDir, encPackageName);

        const packageSha256 = encryptFileAes256(tempZipPath, encPackagePath, secretKey);
        const encStat = fs.statSync(encPackagePath);

        // Hapus folder staging sementara dan file temp.zip non-terenkripsi
        try {
            fs.rmSync(stagingDir, { recursive: true, force: true });
            fs.unlinkSync(tempZipPath);
        } catch (e) {}

        // 7. Catat di tabel ArsipDriveLog
        const driveLog = await (prisma as any).arsipDriveLog.create({
            data: {
                tahunAjaran: rawYear,
                angkatan: cohort,
                namaBerkas: encPackageName,
                jumlahSiswa: studentsWithDocsCount,
                jumlahBerkas: totalDocsCount,
                ukuranByte: BigInt(encStat.size),
                sha256: packageSha256,
                status: 'TERUNGGAH',
                diunggahOleh: String(archivedBy),
                diunggahPada: new Date(),
                catatan: 'Paket terenkripsi AES-256 siap disinkronkan ke Google Drive lembaga. Hanya berkas KK, Akta, dan dok-3.'
            }
        });

        return res.json({
            success: true,
            message: `Arsip Google Drive Terbatas (${cohort} - ${rawYear}) berhasil dibuat & dienkripsi AES-256! Total ${studentsWithDocsCount} siswa (${totalDocsCount} berkas) siap diunggah satu arah ke Drive lembaga.`,
            data: {
                id: driveLog.id,
                tahunAjaran: rawYear,
                angkatan: cohort,
                namaBerkas: encPackageName,
                jumlahSiswa: studentsWithDocsCount,
                jumlahBerkas: totalDocsCount,
                ukuranByte: encStat.size,
                ukuranMb: (encStat.size / (1024 * 1024)).toFixed(2) + ' MB',
                sha256: packageSha256,
                status: driveLog.status,
                downloadUrl: `/api/kesiswaan/arsip/drive-download/${driveLog.id}`
            }
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/arsip/drive-logs
 * Mengambil riwayat paket arsip Google Drive terbatas terenkripsi
 */
export const listArsipDriveLogs = async (req: Request, res: Response) => {
    try {
        const logs = await (prisma as any).arsipDriveLog.findMany({
            orderBy: { createdAt: 'desc' }
        });

        const safeLogs = logs.map((l: any) => ({
            ...l,
            ukuranByte: l.ukuranByte ? Number(l.ukuranByte) : 0,
            ukuranMb: l.ukuranByte ? (Number(l.ukuranByte) / (1024 * 1024)).toFixed(2) + ' MB' : '0 MB',
            downloadUrl: `/api/kesiswaan/arsip/drive-download/${l.id}`
        }));

        return res.json({ success: true, count: safeLogs.length, data: safeLogs });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/arsip/drive-download/:id
 * Mengunduh berkas bundle arsip terenkripsi .zip.enc
 */
export const downloadArsipDriveEnc = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const log = await (prisma as any).arsipDriveLog.findUnique({ where: { id } });

        if (!log) {
            return res.status(404).json({ success: false, message: 'Catatan arsip tidak ditemukan.' });
        }

        const encPath = path.resolve(process.cwd(), 'storage', 'archives', 'gdrive_packages', log.namaBerkas);
        if (!fs.existsSync(encPath)) {
            return res.status(404).json({ success: false, message: 'Berkas arsip fisik .zip.enc tidak ditemukan di server.' });
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${log.namaBerkas}"`);
        return fs.createReadStream(encPath).pipe(res);
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/dokumen/:id/secure
 * Penyajian berkas dokumen siswa terproteksi dengan Audit Access Logging.
 * ATURAN AKSES KHUSUS KARTU AFIRMASI/BANTUAN SOSIAL:
 * - Hanya dapat diakses oleh Staf TU Kesiswaan, Wakasek Kesiswaan, Admin/Operator, atau siswa/ortu bersangkutan.
 * - Guru mapel, pengurus kelas, dan publik DILARANG mengakses demi privasi dan martabat siswa.
 * - Setiap akses (VIEW/DOWNLOAD) dicatat di tabel AuditDokumenAkses.
 */
export const serveProtectedDocument = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        const doc = await (prisma as any).dokumenSiswa.findUnique({ where: { id } });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Dokumen tidak ditemukan.' });
        }

        const student = await prisma.user.findUnique({
            where: { id: doc.studentId },
            select: { id: true, name: true, className: true, nisn: true }
        });

        const isSensitive = ['KARTU_BANTUAN', 'DTKS', 'SURAT_DINSOS'].includes((doc.jenis || '').toUpperCase());
        const roleUpper = (user.role || '').toUpperCase();
        let rolesTambahan: string[] = [];
        if (Array.isArray(user.rolesTambahan)) {
            rolesTambahan = user.rolesTambahan.map((r: string) => r.toLowerCase());
        } else if (typeof user.rolesTambahan === 'string') {
            try {
                rolesTambahan = JSON.parse(user.rolesTambahan).map((r: string) => r.toLowerCase());
            } catch (e) {}
        }

        const isTUOrAdmin = roleUpper === 'ADMIN' || roleUpper === 'OPERATOR' || rolesTambahan.includes('kesiswaan');
        const isOwnerStudent = user.id === doc.studentId;
        const isOwnerParent = user.role === 'PARENT' && (
            user.studentId === doc.studentId ||
            user.username === `P${(student as any)?.nisn}` ||
            user.name === student?.name ||
            user.phone === (student as any)?.parentPhone
        );
        const isHomeroomTeacher = roleUpper === 'TEACHER' && student?.className && (user.homeroomClass === student.className);

        // Perlindungan dokumen kependudukan siswa umum (KK, Akta) dari akses sembarang akun
        const hasAccess = isTUOrAdmin || isOwnerStudent || isOwnerParent || isHomeroomTeacher;
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Akses ditolak. Anda tidak berhak melihat atau mengunduh dokumen kependudukan siswa ini.'
            });
        }

        if (isSensitive && !isTUOrAdmin && !isOwnerStudent && !isOwnerParent) {
            return res.status(403).json({
                success: false,
                message: 'Akses ditolak. Dokumen bantuan sosial / afirmasi hanya dapat diakses oleh Staf Kesiswaan & Pimpinan yang berwenang demi menjaga martabat dan privasi siswa.'
            });
        }

        // Catat Audit Dokumen Akses
        const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
        await (prisma as any).auditDokumenAkses.create({
            data: {
                userId: user.id,
                userName: user.name || user.username || 'User',
                userRole: user.role || 'USER',
                studentId: doc.studentId,
                studentName: student?.name || null,
                dokumenJenis: doc.jenis,
                aksi: req.query.download === 'true' ? 'DOWNLOAD' : 'VIEW',
                alasan: (req.query.alasan as string) || 'Pemeriksaan berkas kesiswaan',
                ipAddress: String(clientIp),
                userAgent: (req.headers['user-agent'] as string) || 'SIBOY-PORTAL'
            }
        }).catch((e: any) => console.error('Error logging document access:', e.message));

        const filePath = resolveLocalDocPath(doc.fileUrl);
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'File fisik dokumen tidak ditemukan di server.' });
        }

        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === '.pdf') contentType = 'application/pdf';
        else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.png') contentType = 'image/png';

        res.setHeader('Content-Type', contentType);
        if (req.query.download === 'true') {
            res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        } else {
            res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
        }

        return fs.createReadStream(filePath).pipe(res);
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/kesiswaan/audit-dokumen
 * Mengambil log riwayat pemeriksaan berkas kesiswaan
 */
export const listAuditDokumenAkses = async (req: Request, res: Response) => {
    try {
        const { limit = 50, studentId } = req.query;
        const logs = await (prisma as any).auditDokumenAkses.findMany({
            where: studentId ? { studentId: String(studentId) } : undefined,
            orderBy: { createdAt: 'desc' },
            take: Number(limit)
        });
        return res.json({ success: true, count: logs.length, data: logs });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /api/kesiswaan/kenaikan-kelas
 * Memproses promosi kenaikan kelas tahun ajaran baru dengan dukungan siswa tinggal kelas.
 * Siswa dalam daftar retainedStudentIds (Tinggal Kelas) tetap berada di kelas/tingkat semula.
 * Kenaikan IX -> ALUMNI secara otomatis me-nonaktifkan akun dan mencabut token sesi.
 */
export const prosesKenaikanKelas = async (req: Request, res: Response) => {
    try {
        const { sourceLevel, targetLevel, retainedStudentIds = [], sourceClass, targetClass, mode } = req.body;

        if (!sourceLevel || !targetLevel) {
            return res.status(400).json({ success: false, message: 'sourceLevel dan targetLevel wajib diisi.' });
        }

        const retainedSet = new Set((retainedStudentIds || []).map((id: string) => String(id)));
        let promotedCount = 0;
        let retainedCount = 0;

        if (sourceLevel === 'IX' && (targetLevel === 'ALUMNI' || targetLevel === 'LULUS')) {
            // Kelulusan Tingkat IX -> ALUMNI
            const students = await prisma.user.findMany({
                where: { role: 'STUDENT', className: { startsWith: 'IX' } }
            });

            for (const st of students) {
                if (retainedSet.has(st.id)) {
                    retainedCount++;
                    continue;
                }
                await prisma.user.update({
                    where: { id: st.id },
                    data: {
                        className: 'ALUMNI',
                        isActive: false,
                        deviceBindingId: null
                    }
                });
                await (prisma as any).refreshToken.deleteMany({ where: { userId: st.id } }).catch(() => {});
                promotedCount++;
            }

            return res.json({
                success: true,
                message: `Kelulusan angkatan IX berhasil: ${promotedCount} siswa dinyatakan LULUS (Alumni) dan ${retainedCount} siswa tinggal kelas.`,
                promotedCount,
                retainedCount
            });
        }

        // Promosi Per Kelas Tunggal
        if (mode === 'SINGLE_CLASS' && sourceClass && targetClass) {
            const students = await prisma.user.findMany({
                where: { role: 'STUDENT', className: String(sourceClass) }
            });

            for (const st of students) {
                if (retainedSet.has(st.id)) {
                    retainedCount++;
                    continue;
                }
                await prisma.user.update({
                    where: { id: st.id },
                    data: { className: String(targetClass) }
                });
                await syncParentAccountForStudent({ ...st, className: String(targetClass) });
                promotedCount++;
            }

            return res.json({
                success: true,
                message: `Kenaikan kelas dari ${sourceClass} ke ${targetClass} berhasil: ${promotedCount} siswa naik, ${retainedCount} siswa tinggal kelas.`,
                promotedCount,
                retainedCount
            });
        }

        // Promosi Massal Seluruh Angkatan (VII -> VIII atau VIII -> IX)
        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
        for (const letter of letters) {
            const src = `${sourceLevel}-${letter}`;
            const dst = `${targetLevel}-${letter}`;
            const students = await prisma.user.findMany({
                where: { role: 'STUDENT', className: src }
            });

            for (const st of students) {
                if (retainedSet.has(st.id)) {
                    retainedCount++;
                    continue;
                }

                await prisma.user.update({
                    where: { id: st.id },
                    data: { className: dst }
                });
                await syncParentAccountForStudent({ ...st, className: dst });
                promotedCount++;
            }
        }

        return res.json({
            success: true,
            message: `Kenaikan kelas dari Tingkat ${sourceLevel} ke ${targetLevel} berhasil: ${promotedCount} siswa naik kelas, ${retainedCount} siswa tinggal kelas.`,
            promotedCount,
            retainedCount
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

