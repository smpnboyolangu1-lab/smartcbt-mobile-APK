import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const OPERATOR_NOTICE_TEXT = 
  "⚠️ PEMBERITAHUAN RESMI OPERATOR DAPODIK: Data ini adalah data resmi hasil import Dapodik Kemendikbudristek & Buku Induk Raport. " +
  "Data pada aplikasi bersifat tetap (READ-ONLY) dan tidak dapat diubah secara langsung oleh siswa maupun orang tua/wali murid. " +
  "Jika terdapat kesalahan penulisan nama, tanggal lahir, nama orang tua, atau data lainnya, pembetulan akan dilakukan oleh Operator Dapodik Sekolah " +
  "dengan melampirkan fotokopi Kartu Keluarga (KK) dan Akta Kelahiran yang sah.";

const OPERATOR_NOTICE_UNIMPORTED_TEXT =
  "⚠️ PEMBERITAHUAN: Data resmi Dapodik Kemendikbud untuk siswa ini belum diimpor oleh Operator Dapodik Sekolah ke sistem Buku Induk Raport. " +
  "Seluruh data resmi Buku Induk Raport dikelola langsung oleh Operator Dapodik Sekolah. " +
  "Jika Anda membutuhkan pemutakhiran data, silakan hubungi Operator Dapodik Sekolah dengan membawa fotokopi Kartu Keluarga (KK) dan Akta Kelahiran yang sah.";

/**
 * Helper to format date into Indonesian standard "DD MMMM YYYY"
 */
function formatIndonesianDate(rawDate: string | null | undefined): string {
    if (!rawDate) return '';
    try {
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) return rawDate;
        const months = [
            'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    } catch {
        return rawDate;
    }
}

/**
 * 1. GET /api/student/biodata-raport
 * Mengambil data 17 item resmi Buku Induk / Raport & Dapodik Kemendikbud (READ-ONLY untuk Siswa & Orang Tua)
 * KHUSUS MENGAMBIL DARI HASIL IMPORT DAPODIK (DapodikRaportRecord), BUKAN DARI ISIAN ORANG TUA!
 */
export const getBiodataRaport = async (req: Request, res: Response) => {
    try {
        const currentUser = (req as any).user;
        if (!currentUser) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan' });
        }

        let studentId = '';
        let targetNisn = '';

        if (currentUser.role === 'STUDENT') {
            studentId = currentUser.id;
            targetNisn = (currentUser.nisn || currentUser.username || '').trim();
        } else if (currentUser.role === 'PARENT') {
            const requestedChildId = (req.query.studentId || req.query.childId) as string;
            if (requestedChildId) {
                studentId = requestedChildId;
                const child = await prisma.user.findUnique({ where: { id: studentId } });
                if (child) {
                    targetNisn = (child.nisn || child.username || '').trim();
                }
            } else {
                // Format username orang tua: P + NISN anak
                const cleanNisn = (currentUser.nisn || currentUser.username.replace(/^[Pp]/, '')).trim();
                targetNisn = cleanNisn;
                const student = await prisma.user.findFirst({
                    where: {
                        role: 'STUDENT',
                        OR: [
                            { nisn: cleanNisn },
                            { username: cleanNisn }
                        ]
                    }
                });
                if (student) {
                    studentId = student.id;
                    if (!targetNisn) targetNisn = (student.nisn || student.username || '').trim();
                }
            }
        } else if (['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM', 'COUNSELOR'].includes(currentUser.role)) {
            const requestedStudentId = (req.query.studentId || req.query.childId) as string;
            if (requestedStudentId) {
                studentId = requestedStudentId;
                const s = await prisma.user.findUnique({ where: { id: studentId } });
                if (s) targetNisn = (s.nisn || s.username || '').trim();
            }
        }

        if (!studentId && !targetNisn) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan' });
        }

        // Cari profil siswa di tabel User
        let student = studentId ? await prisma.user.findUnique({ where: { id: studentId } }) : null;
        if (!student && targetNisn) {
            student = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [{ nisn: targetNisn }, { username: targetNisn }]
                }
            });
            if (student) studentId = student.id;
        }

        if (!student) {
            return res.status(404).json({ success: false, message: 'Profil siswa tidak ditemukan di database' });
        }

        const nisnToQuery = targetNisn || student.nisn || student.username;

        // AMBIL SECARA EKSKLUSIF DARI MASTER RECORD DAPODIK HASIL IMPORT
        const dapodikRecord = await (prisma as any).dapodikRaportRecord.findFirst({
            where: {
                OR: [
                    { nisn: nisnToQuery },
                    ...(studentId ? [{ studentId }] : [])
                ]
            }
        });

        // KONDISI A: SISWA SUDAH DIIMPORT KE MASTER DAPODIK RESMI
        if (dapodikRecord) {
            const tempatLahir = dapodikRecord.tempatLahir || student.pob || '-';
            const tglLahirFormatted = dapodikRecord.tanggalLahir ? formatIndonesianDate(dapodikRecord.tanggalLahir) : (student.dob ? formatIndonesianDate(student.dob) : '-');
            const ttl = (tempatLahir !== '-' && tglLahirFormatted !== '-') ? `${tempatLahir}, ${tglLahirFormatted}` : (tempatLahir !== '-' ? tempatLahir : tglLahirFormatted);

            let alamatLengkap = dapodikRecord.alamatPesertaDidik || '';
            const detailAlamat: string[] = [];
            if (dapodikRecord.rt && dapodikRecord.rw) detailAlamat.push(`RT ${dapodikRecord.rt}/RW ${dapodikRecord.rw}`);
            if (dapodikRecord.dusun) detailAlamat.push(`Dusun ${dapodikRecord.dusun}`);
            if (dapodikRecord.desaKelurahan) detailAlamat.push(`Desa/Kel. ${dapodikRecord.desaKelurahan}`);
            if (dapodikRecord.kecamatan) detailAlamat.push(`Kec. ${dapodikRecord.kecamatan}`);
            if (dapodikRecord.kabupaten) detailAlamat.push(`Kab. ${dapodikRecord.kabupaten}`);
            if (detailAlamat.length > 0 && !alamatLengkap.includes(detailAlamat[0])) {
                alamatLengkap = alamatLengkap ? `${alamatLengkap}, ${detailAlamat.join(', ')}` : detailAlamat.join(', ');
            }
            if (!alamatLengkap) alamatLengkap = '-';

            const alamatOrtu = dapodikRecord.alamatOrangTua || alamatLengkap;

            const raportData = {
                studentId: student.id,
                item1_namaLengkap: dapodikRecord.namaLengkap || student.name || '-',
                item2_nisn: dapodikRecord.nisn || student.nisn || student.username || '-',
                item2_nis: dapodikRecord.nis || student.nis || '-',
                item3_ttl: ttl,
                item3_tempatLahir: tempatLahir,
                item3_tanggalLahir: tglLahirFormatted,
                item4_jenisKelamin: dapodikRecord.jenisKelamin || student.gender || 'Laki-laki',
                item5_agama: dapodikRecord.agama || student.religion || 'Islam',
                item6_statusDalamKeluarga: dapodikRecord.statusDalamKeluarga || 'Anak Kandung',
                item7_anakKe: dapodikRecord.anakKe ? String(dapodikRecord.anakKe) : '1',
                item8_alamat: alamatLengkap,
                item8_rt: dapodikRecord.rt || '-',
                item8_rw: dapodikRecord.rw || '-',
                item8_desa: dapodikRecord.desaKelurahan || '-',
                item8_kecamatan: dapodikRecord.kecamatan || '-',
                item8_kabupaten: dapodikRecord.kabupaten || 'Tulungagung',
                item8_kodePos: dapodikRecord.kodePos || '-',
                item9_teleponRumah: dapodikRecord.teleponRumah || '-',
                item10_sekolahAsal: dapodikRecord.sekolahAsal || '-',
                item11_diterimaKelas: dapodikRecord.diterimaKelas || dapodikRecord.rombelKelas || student.className || 'VII',
                item11_diterimaTanggal: dapodikRecord.diterimaTanggal || '15 Juli 2024',
                item12_namaAyah: dapodikRecord.namaAyah || '-',
                item12_namaIbu: dapodikRecord.namaIbu || '-',
                item13_alamatOrangTua: alamatOrtu,
                item14_teleponOrangTua: dapodikRecord.teleponOrangTua || dapodikRecord.teleponRumah || '-',
                item15_pekerjaanAyah: dapodikRecord.pekerjaanAyah || '-',
                item15_pekerjaanIbu: dapodikRecord.pekerjaanIbu || '-',
                item16_namaWali: dapodikRecord.namaWali || '-',
                item16_alamatWali: dapodikRecord.alamatWali || '-',
                item16_teleponWali: dapodikRecord.teleponWali || '-',
                item17_pekerjaanWali: dapodikRecord.pekerjaanWali || '-',
                isDapodikVerified: true,
                statusDapodik: 'TERCATAT RESMI DI DAPODIK',
                noticeDapodik: OPERATOR_NOTICE_TEXT,
                isReadOnly: true
            };

            return res.json({
                success: true,
                data: raportData
            });
        }

        // KONDISI B: BELUM DIIMPORT KE DAPODIK OLEH OPERATOR
        // JANGAN MENGAMBIL ISIAN FORMULIR ORANG TUA! Tampilkan status belum diimport dengan instruksi resmi ke Operator Dapodik.
        const unimportedData = {
            studentId: student.id,
            item1_namaLengkap: student.name || '-',
            item2_nisn: student.nisn || student.username || '-',
            item2_nis: student.nis || '-',
            item3_ttl: student.pob && student.dob ? `${student.pob}, ${formatIndonesianDate(student.dob)}` : '(Menunggu Import Dapodik)',
            item3_tempatLahir: student.pob || '-',
            item3_tanggalLahir: student.dob ? formatIndonesianDate(student.dob) : '-',
            item4_jenisKelamin: student.gender || '-',
            item5_agama: student.religion || 'Islam',
            item6_statusDalamKeluarga: '-',
            item7_anakKe: '-',
            item8_alamat: student.address || '(Menunggu Import Dapodik)',
            item8_rt: '-',
            item8_rw: '-',
            item8_desa: '-',
            item8_kecamatan: '-',
            item8_kabupaten: 'Tulungagung',
            item8_kodePos: '-',
            item9_teleponRumah: '-',
            item10_sekolahAsal: '-',
            item11_diterimaKelas: student.className || 'VII',
            item11_diterimaTanggal: '-',
            item12_namaAyah: '-',
            item12_namaIbu: '-',
            item13_alamatOrangTua: '-',
            item14_teleponOrangTua: '-',
            item15_pekerjaanAyah: '-',
            item15_pekerjaanIbu: '-',
            item16_namaWali: '-',
            item16_alamatWali: '-',
            item16_teleponWali: '-',
            item17_pekerjaanWali: '-',
            isDapodikVerified: false,
            statusDapodik: 'BELUM DI-IMPORT DARI DAPODIK',
            noticeDapodik: OPERATOR_NOTICE_UNIMPORTED_TEXT,
            isReadOnly: true
        };

        return res.json({
            success: true,
            data: unimportedData
        });
    } catch (error: any) {
        console.error('Error in getBiodataRaport:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat biodata raport', error: error.message });
    }
};

/**
 * 2. GET /api/dapodik/students
 * Mengambil daftar biodata seluruh siswa dengan filter rombel / kelas untuk Portal Operator Dapodik
 * Menampilkan data resmi DapodikRaportRecord dan status verifikasi Dapodik
 */
export const getDapodikStudentsList = async (req: Request, res: Response) => {
    try {
        const { className, search, page = '1', limit = '100' } = req.query;
        const pageNum = parseInt(page as string, 10) || 1;
        const limitNum = parseInt(limit as string, 10) || 100;
        const skip = (pageNum - 1) * limitNum;

        // Filter User Siswa
        const whereClause: any = { role: 'STUDENT' };

        if (className && className !== 'ALL') {
            if (className === 'VII') {
                whereClause.className = { startsWith: 'VII' };
            } else if (className === 'VIII') {
                whereClause.className = { startsWith: 'VIII' };
            } else if (className === 'IX') {
                whereClause.className = { startsWith: 'IX' };
            } else {
                whereClause.className = String(className);
            }
        }

        if (search && typeof search === 'string' && search.trim()) {
            const q = search.trim();
            whereClause.OR = [
                { name: { contains: q } },
                { nisn: { contains: q } },
                { nis: { contains: q } },
                { username: { contains: q } }
            ];
        }

        const [total, students] = await Promise.all([
            prisma.user.count({ where: whereClause }),
            prisma.user.findMany({
                where: whereClause,
                select: {
                    id: true,
                    name: true,
                    nisn: true,
                    nis: true,
                    className: true,
                    gender: true,
                    religion: true,
                    pob: true,
                    dob: true,
                    address: true,
                    parentPhone: true
                },
                orderBy: [
                    { className: 'asc' },
                    { name: 'asc' }
                ],
                skip,
                take: limitNum
            })
        ]);

        // Ambil data resmi dari DapodikRaportRecord
        const nisns = students.map(s => s.nisn || s.id).filter(Boolean);
        const studentIds = students.map(s => s.id);

        const dapodikRecords = await (prisma as any).dapodikRaportRecord.findMany({
            where: {
                OR: [
                    { nisn: { in: nisns } },
                    { studentId: { in: studentIds } }
                ]
            }
        });

        const dapodikMapByNisn = new Map(dapodikRecords.map((r: any) => [r.nisn, r]));
        const dapodikMapById = new Map(dapodikRecords.map((r: any) => [r.studentId, r]));

        const enriched = students.map(s => {
            const dr: any = (s.nisn ? dapodikMapByNisn.get(s.nisn) : null) || dapodikMapById.get(s.id) || null;
            const isImported = !!dr;

            return {
                id: s.id,
                name: (dr?.namaLengkap) || s.name,
                nisn: (dr?.nisn) || s.nisn || '',
                nis: (dr?.nis) || s.nis || '',
                className: (dr?.rombelKelas) || s.className || '',
                gender: (dr?.jenisKelamin) || s.gender || 'Laki-laki',
                religion: (dr?.religion) || s.religion || 'Islam',
                pob: (dr?.tempatLahir) || s.pob || '',
                dob: (dr?.tanggalLahir) || s.dob || '',
                statusDalamKeluarga: dr?.statusDalamKeluarga || 'Anak Kandung',
                anakKe: dr?.anakKe || '1',
                alamat: dr?.alamatPesertaDidik || s.address || '',
                rt: dr?.rt || '',
                rw: dr?.rw || '',
                dusun: dr?.dusun || '',
                desa: dr?.desaKelurahan || '',
                kecamatan: dr?.kecamatan || '',
                kabupaten: dr?.kabupaten || 'Tulungagung',
                kodePos: dr?.kodePos || '',
                teleponRumah: dr?.teleponRumah || '',
                sekolahAsal: dr?.sekolahAsal || '',
                diterimaKelas: dr?.diterimaKelas || s.className || 'VII',
                diterimaTanggal: dr?.diterimaTanggal || '',
                namaAyah: dr?.namaAyah || '',
                pekerjaanAyah: dr?.pekerjaanAyah || '',
                namaIbu: dr?.namaIbu || '',
                pekerjaanIbu: dr?.pekerjaanIbu || '',
                alamatOrtu: dr?.alamatOrangTua || dr?.alamatPesertaDidik || s.address || '',
                teleponOrtu: dr?.teleponOrangTua || dr?.teleponRumah || s.parentPhone || '',
                namaWali: dr?.namaWali || '',
                alamatWali: dr?.alamatWali || '',
                teleponWali: dr?.teleponWali || '',
                pekerjaanWali: dr?.pekerjaanWali || '',
                isImportedFromDapodik: isImported,
                statusDapodik: isImported ? 'TERVERIFIKASI DAPODIK' : 'BELUM IMPORT DAPODIK',
                dapodikRecordId: dr?.id || null
            };
        });

        // Hitung statistik tingkat
        const [countAll, countVII, countVIII, countIX, countVerified] = await Promise.all([
            prisma.user.count({ where: { role: 'STUDENT' } }),
            prisma.user.count({ where: { role: 'STUDENT', className: { startsWith: 'VII' } } }),
            prisma.user.count({ where: { role: 'STUDENT', className: { startsWith: 'VIII' } } }),
            prisma.user.count({ where: { role: 'STUDENT', className: { startsWith: 'IX' } } }),
            (prisma as any).dapodikRaportRecord.count()
        ]);

        return res.json({
            success: true,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
            stats: {
                totalAll: countAll,
                totalVII: countVII,
                totalVIII: countVIII,
                totalIX: countIX,
                totalVerifiedDapodik: countVerified
            },
            data: enriched
        });
    } catch (error: any) {
        console.error('Error in getDapodikStudentsList:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat daftar siswa Dapodik', error: error.message });
    }
};

/**
 * 3. GET /api/dapodik/export-excel
 * Ekspor Spreadsheet Excel (.xlsx) Biodata Raport & Dapodik (17 Item) dari DapodikRaportRecord
 */
export const exportDapodikExcel = async (req: Request, res: Response) => {
    try {
        const { className } = req.query;
        const whereClause: any = { role: 'STUDENT' };

        if (className && className !== 'ALL') {
            if (className === 'VII') whereClause.className = { startsWith: 'VII' };
            else if (className === 'VIII') whereClause.className = { startsWith: 'VIII' };
            else if (className === 'IX') whereClause.className = { startsWith: 'IX' };
            else whereClause.className = String(className);
        }

        const students = await prisma.user.findMany({
            where: whereClause,
            orderBy: [{ className: 'asc' }, { name: 'asc' }]
        });

        const nisns = students.map(s => s.nisn || s.id).filter(Boolean);
        const studentIds = students.map(s => s.id);

        const dapodikRecords = await (prisma as any).dapodikRaportRecord.findMany({
            where: {
                OR: [
                    { nisn: { in: nisns } },
                    { studentId: { in: studentIds } }
                ]
            }
        });

        const dapodikMapByNisn = new Map(dapodikRecords.map((r: any) => [r.nisn, r]));
        const dapodikMapById = new Map(dapodikRecords.map((r: any) => [r.studentId, r]));

        const rows = students.map((s, idx) => {
            const dr: any = (s.nisn ? dapodikMapByNisn.get(s.nisn) : null) || dapodikMapById.get(s.id) || {};

            let jk = dr.jenisKelamin || s.gender || 'Laki-laki';
            if (jk === 'P' || jk === 'Perempuan') jk = 'Perempuan';
            else if (jk === 'L' || jk === 'Laki-laki') jk = 'Laki-laki';

            return {
                'No': idx + 1,
                '1. Nama Peserta Didik (Lengkap)': dr.namaLengkap || s.name || '',
                '2. NISN': dr.nisn || s.nisn || s.username || '',
                'NIS Sekolah': dr.nis || s.nis || '',
                'Kelas / Rombel': dr.rombelKelas || s.className || '',
                '3. Tempat Lahir': dr.tempatLahir || s.pob || '',
                'Tanggal Lahir': dr.tanggalLahir || s.dob || '',
                '4. Jenis Kelamin': jk,
                '5. Agama': dr.agama || s.religion || 'Islam',
                '6. Status Dalam Keluarga': dr.statusDalamKeluarga || 'Anak Kandung',
                '7. Anak Ke': dr.anakKe || 1,
                '8. Alamat Peserta Didik': dr.alamatPesertaDidik || s.address || '',
                'RT': dr.rt || '',
                'RW': dr.rw || '',
                'Dusun': dr.dusun || '',
                'Desa / Kelurahan': dr.desaKelurahan || '',
                'Kecamatan': dr.kecamatan || '',
                'Kabupaten': dr.kabupaten || 'Tulungagung',
                'Kode Pos': dr.kodePos || '',
                '9. Nomor Telepon Rumah / Siswa': dr.teleponRumah || s.parentPhone || '',
                '10. Sekolah Asal': dr.sekolahAsal || '',
                '11a. Diterima Di Kelas': dr.diterimaKelas || dr.rombelKelas || s.className || '',
                '11b. Tanggal Diterima': dr.diterimaTanggal || '',
                '12a. Nama Ayah Kandung': dr.namaAyah || '',
                '12b. Nama Ibu Kandung': dr.namaIbu || '',
                '13. Alamat Orang Tua': dr.alamatOrangTua || dr.alamatPesertaDidik || s.address || '',
                '14. Telepon Orang Tua': dr.teleponOrangTua || dr.teleponRumah || s.parentPhone || '',
                '15a. Pekerjaan Ayah': dr.pekerjaanAyah || '',
                '15b. Pekerjaan Ibu': dr.pekerjaanIbu || '',
                '16a. Nama Wali': dr.namaWali || '',
                '16b. Alamat Wali': dr.alamatWali || '',
                '16c. Telepon Wali': dr.teleponWali || '',
                '17. Pekerjaan Wali': dr.pekerjaanWali || '',
                'Status Master Dapodik': dr.id ? 'TERVERIFIKASI' : 'BELUM IMPORT'
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Biodata Raport Dapodik');

        const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length + 3, 14) }));
        worksheet['!cols'] = colWidths;

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        const safeClassName = className ? String(className).replace(/[^a-zA-Z0-9_-]/g, '') : 'Semua';

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Biodata_Raport_Dapodik_${safeClassName}.xlsx"`);
        return res.send(buffer);
    } catch (error: any) {
        console.error('Error in exportDapodikExcel:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengekspor spreadsheet Dapodik', error: error.message });
    }
};

/**
 * 4. GET /api/dapodik/template-excel
 * Download Master Template Spreadsheet Excel (.xlsx) untuk Import Data Dapodik (Khususnya Kelas VII)
 */
export const downloadDapodikTemplate = async (req: Request, res: Response) => {
    try {
        const sampleRows = [
            {
                'No': 1,
                '1. Nama Peserta Didik (Lengkap)': 'AGUS MUHAMAD SUKARNO',
                '2. NISN': '0025559318',
                'NIS Sekolah': '8401',
                'Kelas / Rombel': 'VII-A',
                '3. Tempat Lahir': 'Cianjur',
                'Tanggal Lahir': '2011-08-17',
                '4. Jenis Kelamin': 'Laki-laki',
                '5. Agama': 'Islam',
                '6. Status Dalam Keluarga': 'Anak Kandung',
                '7. Anak Ke': '1',
                '8. Alamat Peserta Didik': 'Kp. Gombong 001/007 Ds. Salagedang',
                'RT': '001',
                'RW': '007',
                'Dusun': 'Gombong',
                'Desa / Kelurahan': 'Salagedang',
                'Kecamatan': 'Cibeber',
                'Kabupaten': 'Tulungagung',
                'Kode Pos': '66231',
                '9. Nomor Telepon Rumah / Siswa': '081234567890',
                '10. Sekolah Asal': 'SD Negeri 1 Cibeber',
                '11a. Diterima Di Kelas': 'VII-A',
                '11b. Tanggal Diterima': '15 Juli 2024',
                '12a. Nama Ayah Kandung': 'Unang',
                '12b. Nama Ibu Kandung': 'Ii',
                '13. Alamat Orang Tua': 'Kp. Gombong 001/007 Desa Salagedang Kec. Cibeber',
                '14. Telepon Orang Tua': '081234567890',
                '15a. Pekerjaan Ayah': 'Wiraswasta',
                '15b. Pekerjaan Ibu': 'Mengurus Rumah Tangga',
                '16a. Nama Wali': '',
                '16b. Alamat Wali': '',
                '16c. Telepon Wali': '',
                '17. Pekerjaan Wali': ''
            },
            {
                'No': 2,
                '1. Nama Peserta Didik (Lengkap)': 'SITI AISYAH NURJANAH',
                '2. NISN': '0025559319',
                'NIS Sekolah': '8402',
                'Kelas / Rombel': 'VII-A',
                '3. Tempat Lahir': 'Tulungagung',
                'Tanggal Lahir': '2011-05-12',
                '4. Jenis Kelamin': 'Perempuan',
                '5. Agama': 'Islam',
                '6. Status Dalam Keluarga': 'Anak Kandung',
                '7. Anak Ke': '2',
                '8. Alamat Peserta Didik': 'Jl. Diponegoro No. 45',
                'RT': '002',
                'RW': '003',
                'Dusun': 'Krajan',
                'Desa / Kelurahan': 'Boyolangu',
                'Kecamatan': 'Boyolangu',
                'Kabupaten': 'Tulungagung',
                'Kode Pos': '66232',
                '9. Nomor Telepon Rumah / Siswa': '081298765432',
                '10. Sekolah Asal': 'SD Negeri 1 Boyolangu',
                '11a. Diterima Di Kelas': 'VII-A',
                '11b. Tanggal Diterima': '15 Juli 2024',
                '12a. Nama Ayah Kandung': 'Supriyadi',
                '12b. Nama Ibu Kandung': 'Nurul Hidayah',
                '13. Alamat Orang Tua': 'Jl. Diponegoro No. 45 Boyolangu',
                '14. Telepon Orang Tua': '081298765432',
                '15a. Pekerjaan Ayah': 'PNS',
                '15b. Pekerjaan Ibu': 'Guru',
                '16a. Nama Wali': '',
                '16b. Alamat Wali': '',
                '16c. Telepon Wali': '',
                '17. Pekerjaan Wali': ''
            }
        ];

        const worksheet = XLSX.utils.json_to_sheet(sampleRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Dapodik Raport');

        const colWidths = Object.keys(sampleRows[0]).map(k => ({ wch: Math.max(k.length + 3, 14) }));
        worksheet['!cols'] = colWidths;

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Template_Import_Dapodik_Raport_Kelas_VII.xlsx"');
        return res.send(buffer);
    } catch (error: any) {
        console.error('Error in downloadDapodikTemplate:', error);
        return res.status(500).json({ success: false, message: 'Gagal membuat template spreadsheet', error: error.message });
    }
};

/**
 * 5. POST /api/dapodik/import-excel
 * Import Spreadsheet Excel (.xlsx) / CSV Dapodik untuk Pembetulan Massal Biodata Siswa (Khususnya Kelas VII)
 * DATA DISIMPAN EKSKLUSIF KE DapodikRaportRecord (TIDAK MENCEMARI FORMULIR BIODATA ORANG TUA)!
 */
export const importDapodikExcel = async (req: Request, res: Response) => {
    try {
        let rawRows: any[] = [];
        let sourceFileName = 'Spreadsheet_Dapodik_Import.xlsx';

        if ((req as any).file && (req as any).file.buffer) {
            sourceFileName = (req as any).file.originalname || sourceFileName;
            const workbook = XLSX.read((req as any).file.buffer, { type: 'buffer' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            rawRows = XLSX.utils.sheet_to_json(worksheet);
        } else if (req.body.students && Array.isArray(req.body.students)) {
            rawRows = req.body.students;
        } else if (req.body.base64) {
            const buffer = Buffer.from(req.body.base64, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            rawRows = XLSX.utils.sheet_to_json(worksheet);
        } else {
            return res.status(400).json({ success: false, message: 'File spreadsheet Excel atau data baris tidak ditemukan' });
        }

        if (rawRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Spreadsheet kosong, tidak ada baris data yang terbaca.' });
        }

        let updatedCount = 0;
        let insertedCount = 0;
        const defaultPassword = await bcrypt.hash('password123', 10);
        const operatorUsername = (req as any).user?.username || 'OPERATOR_DAPODIK';

        for (const row of rawRows) {
            // Pemetaan cerdas kolom fleksibel
            const nama = (row['1. Nama Peserta Didik (Lengkap)'] || row['Nama'] || row['nama'] || row['Nama Lengkap'] || row['namaLengkap'] || row['NAMA'] || '').toString().trim();
            const rawNisn = (row['2. NISN'] || row['NISN'] || row['nisn'] || row['Username'] || row['nisn_siswa'] || '').toString().trim();
            const nis = (row['NIS Sekolah'] || row['NIS'] || row['nis'] || row['Nomor Induk'] || '').toString().trim();
            const kelas = (row['Kelas / Rombel'] || row['Kelas'] || row['kelas'] || row['className'] || row['Rombel'] || 'VII-A').toString().trim();
            const tempatLahir = (row['3. Tempat Lahir'] || row['Tempat Lahir'] || row['tempatLahir'] || row['pob'] || row['TEMPAT LAHIR'] || '').toString().trim();
            const tglLahir = (row['Tanggal Lahir'] || row['tanggalLahir'] || row['dob'] || row['TANGGAL LAHIR'] || '').toString().trim();
            const jkRaw = (row['4. Jenis Kelamin'] || row['Jenis Kelamin'] || row['JK'] || row['gender'] || row['JENIS KELAMIN'] || 'L').toString().trim().toUpperCase();
            const gender = (jkRaw.startsWith('P') || jkRaw === 'PEREMPUAN') ? 'Perempuan' : 'Laki-laki';
            const agama = (row['5. Agama'] || row['Agama'] || row['agama'] || row['AGAMA'] || 'Islam').toString().trim();
            const statusKeluarga = (row['6. Status Dalam Keluarga'] || row['Status Keluarga'] || row['statusDalamKeluarga'] || 'Anak Kandung').toString().trim();
            const anakKe = (row['7. Anak Ke'] || row['Anak Ke'] || row['anakKe'] || '1').toString().trim();
            const alamat = (row['8. Alamat Peserta Didik'] || row['Alamat'] || row['alamat'] || row['ALAMAT'] || '').toString().trim();
            const rt = (row['RT'] || row['rt'] || '').toString().trim();
            const rw = (row['RW'] || row['rw'] || '').toString().trim();
            const dusun = (row['Dusun'] || row['dusun'] || '').toString().trim();
            const desa = (row['Desa / Kelurahan'] || row['Desa'] || row['desa'] || row['Kelurahan'] || '').toString().trim();
            const kec = (row['Kecamatan'] || row['kecamatan'] || '').toString().trim();
            const kab = (row['Kabupaten'] || row['kabupaten'] || 'Tulungagung').toString().trim();
            const kodePos = (row['Kode Pos'] || row['kodePos'] || '').toString().trim();
            const teleponSiswa = (row['9. Nomor Telepon Rumah / Siswa'] || row['Telepon'] || row['telepon'] || row['teleponRumah'] || '').toString().trim();
            const sekolahAsal = (row['10. Sekolah Asal'] || row['Sekolah Asal'] || row['sekolahAsal'] || '').toString().trim();
            const diterimaKelas = (row['11a. Diterima Di Kelas'] || row['Diterima Di Kelas'] || row['diterimaKelas'] || kelas || 'VII').toString().trim();
            const diterimaTanggal = (row['11b. Tanggal Diterima'] || row['Tanggal Diterima'] || row['diterimaTanggal'] || '15 Juli 2024').toString().trim();

            const namaAyah = (row['12a. Nama Ayah Kandung'] || row['Nama Ayah'] || row['ayah'] || row['namaAyah'] || '').toString().trim();
            const namaIbu = (row['12b. Nama Ibu Kandung'] || row['Nama Ibu'] || row['ibu'] || row['namaIbu'] || '').toString().trim();
            const alamatOrtu = (row['13. Alamat Orang Tua'] || row['Alamat Ortu'] || row['alamatOrangTua'] || alamat || '').toString().trim();
            const teleponOrtu = (row['14. Telepon Orang Tua'] || row['Telepon Ortu'] || row['teleponOrangTua'] || teleponSiswa || '').toString().trim();
            const pekerjaanAyah = (row['15a. Pekerjaan Ayah'] || row['Pekerjaan Ayah'] || row['pekerjaanAyah'] || '').toString().trim();
            const pekerjaanIbu = (row['15b. Pekerjaan Ibu'] || row['Pekerjaan Ibu'] || row['pekerjaanIbu'] || '').toString().trim();

            const namaWali = (row['16a. Nama Wali'] || row['Nama Wali'] || row['namaWali'] || '').toString().trim();
            const alamatWali = (row['16b. Alamat Wali'] || row['Alamat Wali'] || row['alamatWali'] || '').toString().trim();
            const teleponWali = (row['16c. Telepon Wali'] || row['Telepon Wali'] || row['teleponWali'] || '').toString().trim();
            const pekerjaanWali = (row['17. Pekerjaan Wali'] || row['Pekerjaan Wali'] || row['pekerjaanWali'] || '').toString().trim();

            if (!rawNisn && !nama) continue;
            const nisn = rawNisn || `TEMP_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

            // 1. Cari atau sinkronkan akun User siswa agar siswa & ortu bisa login
            let existingStudent = await prisma.user.findFirst({
                where: {
                    OR: [
                        { nisn: nisn },
                        { username: nisn }
                    ]
                }
            });

            let studentId = '';
            if (existingStudent) {
                studentId = existingStudent.id;
                await prisma.user.update({
                    where: { id: studentId },
                    data: {
                        name: nama || existingStudent.name,
                        nis: nis || existingStudent.nis,
                        className: kelas || existingStudent.className,
                        gender: gender,
                        religion: agama || existingStudent.religion,
                        pob: tempatLahir || existingStudent.pob,
                        dob: tglLahir || existingStudent.dob,
                        address: alamat || existingStudent.address,
                        parentPhone: teleponOrtu || existingStudent.parentPhone,
                        isActive: true
                    }
                });
            } else {
                const newStudent = await prisma.user.create({
                    data: {
                        username: nisn,
                        password: defaultPassword,
                        name: nama,
                        nisn: nisn,
                        nis: nis || null,
                        className: kelas,
                        gender: gender,
                        religion: agama,
                        pob: tempatLahir,
                        dob: tglLahir,
                        address: alamat,
                        parentPhone: teleponOrtu,
                        role: 'STUDENT',
                        isActive: true
                    }
                });
                studentId = newStudent.id;

                // Otomatis siapkan akun Orang Tua P + NISN
                const parentUsername = `P${nisn}`;
                const parentExists = await prisma.user.findFirst({ where: { username: parentUsername } });
                if (!parentExists) {
                    await prisma.user.create({
                        data: {
                            username: parentUsername,
                            password: defaultPassword,
                            name: `Orang Tua dari ${nama}`,
                            nisn: nisn,
                            role: 'PARENT',
                            parentPhone: teleponOrtu,
                            isActive: true
                        }
                    }).catch(() => {});
                }
            }

            // 2. SIMPAN/UPSERT EKSKLUSIF KE MODEL DapodikRaportRecord
            const existingRecord = await (prisma as any).dapodikRaportRecord.findUnique({
                where: { nisn }
            });

            const dapodikPayload = {
                nisn,
                studentId,
                nis: nis || null,
                namaLengkap: nama,
                rombelKelas: kelas,
                tempatLahir: tempatLahir || null,
                tanggalLahir: tglLahir || null,
                jenisKelamin: gender,
                agama: agama || 'Islam',
                statusDalamKeluarga: statusKeluarga || 'Anak Kandung',
                anakKe: String(anakKe || '1'),
                alamatPesertaDidik: alamat || null,
                rt: rt || null,
                rw: rw || null,
                dusun: dusun || null,
                desaKelurahan: desa || null,
                kecamatan: kec || null,
                kabupaten: kab || 'Tulungagung',
                kodePos: kodePos || null,
                teleponRumah: teleponSiswa || null,
                sekolahAsal: sekolahAsal || null,
                diterimaKelas: diterimaKelas || kelas,
                diterimaTanggal: diterimaTanggal || '15 Juli 2024',
                namaAyah: namaAyah || null,
                namaIbu: namaIbu || null,
                alamatOrangTua: alamatOrtu || null,
                teleponOrangTua: teleponOrtu || null,
                pekerjaanAyah: pekerjaanAyah || null,
                pekerjaanIbu: pekerjaanIbu || null,
                namaWali: namaWali || null,
                alamatWali: alamatWali || null,
                teleponWali: teleponWali || null,
                pekerjaanWali: pekerjaanWali || null,
                sourceFile: sourceFileName,
                importedBy: operatorUsername
            };

            if (existingRecord) {
                await (prisma as any).dapodikRaportRecord.update({
                    where: { nisn },
                    data: dapodikPayload
                });
                updatedCount++;
            } else {
                await (prisma as any).dapodikRaportRecord.create({
                    data: dapodikPayload
                });
                insertedCount++;
            }
        }

        return res.json({
            success: true,
            message: `Pembetulan data Master Dapodik & Buku Induk Raport berhasil! Memperbarui ${updatedCount} siswa dan mengimpor ${insertedCount} siswa baru ke master Dapodik (termasuk sinkronisasi akun login siswa & orang tua). Formulir isian mandiri orang tua tetap terlindungi dan terpisah.`,
            totalProcessed: rawRows.length,
            updatedCount,
            insertedCount
        });
    } catch (error: any) {
        console.error('Error in importDapodikExcel:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengimpor file spreadsheet Dapodik', error: error.message });
    }
};

/**
 * 6. POST /api/dapodik/update-student
 * Operator Dapodik memperbarui data 17 item seorang siswa secara individual dari Web Portal
 * EKSKLUSIF MEMPERBARUI DapodikRaportRecord!
 */
export const updateDapodikStudent = async (req: Request, res: Response) => {
    try {
        const {
            studentId,
            namaLengkap,
            nisn,
            nis,
            className,
            pob,
            dob,
            gender,
            religion,
            statusDalamKeluarga,
            anakKe,
            alamat,
            rt,
            rw,
            dusun,
            desa,
            kecamatan,
            kabupaten,
            kodePos,
            teleponRumah,
            sekolahAsal,
            diterimaKelas,
            diterimaTanggal,
            namaAyah,
            pekerjaanAyah,
            namaIbu,
            pekerjaanIbu,
            alamatOrtu,
            teleponOrtu,
            namaWali,
            alamatWali,
            teleponWali,
            pekerjaanWali,
            catatanOperator
        } = req.body;

        if (!studentId && !nisn) {
            return res.status(400).json({ success: false, message: 'ID Siswa atau NISN wajib disertakan' });
        }

        // Cari siswa di User
        let student = studentId ? await prisma.user.findUnique({ where: { id: studentId } }) : null;
        if (!student && nisn) {
            student = await prisma.user.findFirst({
                where: { OR: [{ nisn }, { username: nisn }] }
            });
        }

        const effectiveStudentId = student?.id || studentId;
        const effectiveNisn = (nisn || student?.nisn || student?.username || '').trim();

        if (!effectiveNisn) {
            return res.status(400).json({ success: false, message: 'NISN siswa tidak valid' });
        }

        // 1. Update basic info di User jika ada
        if (effectiveStudentId) {
            await prisma.user.update({
                where: { id: effectiveStudentId },
                data: {
                    name: namaLengkap || undefined,
                    nisn: effectiveNisn || undefined,
                    nis: nis || undefined,
                    className: className || undefined,
                    pob: pob || undefined,
                    dob: dob || undefined,
                    gender: gender || undefined,
                    religion: religion || undefined,
                    address: alamat || undefined,
                    parentPhone: teleponOrtu || undefined
                }
            }).catch(() => {});
        }

        // 2. Upsert ke DapodikRaportRecord
        const dapodikPayload = {
            nisn: effectiveNisn,
            studentId: effectiveStudentId || null,
            nis: nis || null,
            namaLengkap: namaLengkap || student?.name || 'Siswa',
            rombelKelas: className || student?.className || 'VII',
            tempatLahir: pob || null,
            tanggalLahir: dob || null,
            jenisKelamin: gender || 'Laki-laki',
            agama: religion || 'Islam',
            statusDalamKeluarga: statusDalamKeluarga || 'Anak Kandung',
            anakKe: String(anakKe || '1'),
            alamatPesertaDidik: alamat || null,
            rt: rt || null,
            rw: rw || null,
            dusun: dusun || null,
            desaKelurahan: desa || null,
            kecamatan: kecamatan || null,
            kabupaten: kabupaten || 'Tulungagung',
            kodePos: kodePos || null,
            teleponRumah: teleponRumah || null,
            sekolahAsal: sekolahAsal || null,
            diterimaKelas: diterimaKelas || className || 'VII',
            diterimaTanggal: diterimaTanggal || null,
            namaAyah: namaAyah || null,
            namaIbu: namaIbu || null,
            alamatOrangTua: alamatOrtu || null,
            teleponOrangTua: teleponOrtu || null,
            pekerjaanAyah: pekerjaanAyah || null,
            pekerjaanIbu: pekerjaanIbu || null,
            namaWali: namaWali || null,
            alamatWali: alamatWali || null,
            teleponWali: teleponWali || null,
            pekerjaanWali: pekerjaanWali || null,
            catatanOperator: catatanOperator || 'Diperbarui oleh Operator Dapodik Sekolah sesuai dokumen KK & Akta'
        };

        const existingRecord = await (prisma as any).dapodikRaportRecord.findUnique({
            where: { nisn: effectiveNisn }
        });

        if (existingRecord) {
            await (prisma as any).dapodikRaportRecord.update({
                where: { nisn: effectiveNisn },
                data: dapodikPayload
            });
        } else {
            await (prisma as any).dapodikRaportRecord.create({
                data: dapodikPayload
            });
        }

        return res.json({
            success: true,
            message: `Data Buku Induk & Dapodik untuk siswa ${namaLengkap} berhasil diperbarui di Master Dapodik.`
        });
    } catch (error: any) {
        console.error('Error in updateDapodikStudent:', error);
        return res.status(500).json({ success: false, message: 'Gagal memperbarui data siswa', error: error.message });
    }
};
