import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// Ensure upload folders exist
const biodataUploadDir = path.join(__dirname, '../../uploads/biodata');
const kkDir = path.join(biodataUploadDir, 'kk');
const aktaDir = path.join(biodataUploadDir, 'akta');
const bantuanDir = path.join(biodataUploadDir, 'bantuan');

if (!fs.existsSync(biodataUploadDir)) fs.mkdirSync(biodataUploadDir, { recursive: true });
if (!fs.existsSync(kkDir)) fs.mkdirSync(kkDir, { recursive: true });
if (!fs.existsSync(aktaDir)) fs.mkdirSync(aktaDir, { recursive: true });
if (!fs.existsSync(bantuanDir)) fs.mkdirSync(bantuanDir, { recursive: true });

// ========================================================
// 1. SYSTEM SETTINGS & FEATURE TOGGLE HELPERS
// ========================================================

export const getBiodataToggleConfig = async () => {
    try {
        const activeSetting = await (prisma as any).systemSetting.findUnique({
            where: { key: 'student_biodata_submission_active' }
        });
        const deadlineSetting = await (prisma as any).systemSetting.findUnique({
            where: { key: 'biodata_submission_deadline' }
        });

        const isActive = activeSetting ? (activeSetting.value === 'true' || activeSetting.value === true) : true;
        const deadline = deadlineSetting?.value || null;

        const now = new Date();
        let isOpenNow = isActive;
        if (isActive && deadline) {
            const dDate = new Date(deadline);
            if (!isNaN(dDate.getTime()) && now > dDate) {
                isOpenNow = false;
            }
        }

        return {
            isActive,
            deadline,
            isOpenNow
        };
    } catch (e: any) {
        return { isActive: true, deadline: null, isOpenNow: true };
    }
};

/**
 * Middleware Backend: Memblokir request pengiriman form (HTTP 403 Forbidden) jika toggle nonaktif
 */
export const ensureBiodataSubmissionActive = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const config = await getBiodataToggleConfig();
        if (!config.isOpenNow) {
            return res.status(403).json({
                success: false,
                isLocked: true,
                message: 'Periode pengisian biodata sedang ditutup oleh pihak sekolah.'
            });
        }
        next();
    } catch (e: any) {
        next();
    }
};

/**
 * PATCH /api/v1/admin/modules/biodata/toggle
 * Admin/Operator mengubah status toggle dan batas waktu pengisian biodata
 */
export const toggleBiodataModule = async (req: Request, res: Response) => {
    try {
        const { isActive, deadline } = req.body;

        await (prisma as any).systemSetting.upsert({
            where: { key: 'student_biodata_submission_active' },
            update: { value: String(isActive === true || isActive === 'true'), type: 'boolean' },
            create: { key: 'student_biodata_submission_active', value: String(isActive === true || isActive === 'true'), type: 'boolean' }
        });

        if (deadline !== undefined) {
            await (prisma as any).systemSetting.upsert({
                where: { key: 'biodata_submission_deadline' },
                update: { value: deadline ? String(deadline) : '', type: 'timestamp' },
                create: { key: 'biodata_submission_deadline', value: deadline ? String(deadline) : '', type: 'timestamp' }
            });
        }

        const config = await getBiodataToggleConfig();
        return res.json({
            success: true,
            message: `Modul pengisian biodata berhasil diubah: ${config.isOpenNow ? 'AKTIF / DIBUKA' : 'NONAKTIF / DITUTUP'}.`,
            data: config
        });
    } catch (error: any) {
        console.error('Error toggleBiodataModule:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal mengubah pengaturan toggle biodata' });
    }
};

// ========================================================
// 2. SUBMIT PENGISIAN BIODATA OLEH ORANG TUA / SISWA (STAGING)
// ========================================================

/**
 * POST /api/v1/mobile/biodata/submit
 * Orang tua mengisi 5-Step Wizard & mengunggah berkas KK & Akta
 * Staging Table: student_profile_submissions (Status: 'PENDING')
 */
export const submitStudentBiodata = async (req: Request, res: Response) => {
    try {
        const currentUser = (req as any).user;
        if (!currentUser) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        // Tentukan studentId target
        let studentId = '';
        let parentId: string | null = null;

        if (currentUser.role === 'STUDENT') {
            studentId = currentUser.id;
        } else if (currentUser.role === 'PARENT') {
            parentId = currentUser.id;
            // Ambil NISN dari parent username (P<NISN>) atau nisn field
            const cleanNisn = (currentUser.nisn || currentUser.username.replace(/^[Pp]/, '')).trim();
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
            } else if (req.body.studentId) {
                studentId = req.body.studentId;
            }
        } else if (currentUser.role === 'ADMIN' || currentUser.role === 'OPERATOR') {
            studentId = req.body.studentId || '';
        }

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Data siswa tujuan tidak ditemukan.' });
        }

        // Cek submission yang sudah ada
        const existing = await (prisma as any).studentProfileSubmission.findFirst({
            where: { studentId },
            orderBy: { submittedAt: 'desc' }
        });

        // Ambil file upload multer (KK, Akta Kelahiran, Kartu Bantuan, Pas Foto Siswa 3x4, dan Surat Dinsos)
        const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
        let kkFileUrl = existing?.kkFileUrl || null;
        let aktaFileUrl = existing?.aktaFileUrl || null;
        let bantuanFileUrl: string | null = null;
        let dinsosFileUrl: string | null = null;
        let fotoFileUrl: string | null = null;
        try {
            if (existing?.payloadJson) {
                const prev = JSON.parse(existing.payloadJson);
                bantuanFileUrl = prev.bantuanFileUrl || null;
                dinsosFileUrl = prev.dinsosFileUrl || null;
                fotoFileUrl = prev.fotoFileUrl || null;
            }
        } catch (e) {}

        if (files?.kk && files.kk.length > 0) {
            kkFileUrl = `/uploads/biodata/kk/${files.kk[0].filename}`;
        }
        if (files?.akta && files.akta.length > 0) {
            aktaFileUrl = `/uploads/biodata/akta/${files.akta[0].filename}`;
        }
        if (files?.bantuan && files.bantuan.length > 0) {
            bantuanFileUrl = `/uploads/biodata/bantuan/${files.bantuan[0].filename}`;
        }
        if (files?.dinsos && files.dinsos.length > 0) {
            dinsosFileUrl = `/uploads/biodata/dinsos/${files.dinsos[0].filename}`;
        }
        if (files?.foto && files.foto.length > 0) {
            fotoFileUrl = `/uploads/biodata/foto/${files.foto[0].filename}`;
        }

        const {
            step1Data,
            step2Data,
            step3Data,
            step4Data,
            step5Data
        } = req.body;

        const s1Obj = typeof step1Data === 'string' ? JSON.parse(step1Data || '{}') : (step1Data || {});
        const s2Obj = typeof step2Data === 'string' ? JSON.parse(step2Data || '{}') : (step2Data || {});
        const s3Obj = typeof step3Data === 'string' ? JSON.parse(step3Data || '{}') : (step3Data || {});
        const s4Obj = typeof step4Data === 'string' ? JSON.parse(step4Data || '{}') : (step4Data || {});
        const s5Obj = typeof step5Data === 'string' ? JSON.parse(step5Data || '{}') : (step5Data || {});

        // Fallback pemetaan data jika form mengirim field langsung di root body
        if (!s1Obj.nik && req.body.nik) s1Obj.nik = req.body.nik;
        if (!s1Obj.tempatLahir && (req.body.tempatLahir || req.body.pob)) s1Obj.tempatLahir = req.body.tempatLahir || req.body.pob;
        if (!s1Obj.tanggalLahir && (req.body.tanggalLahir || req.body.dob)) s1Obj.tanggalLahir = req.body.tanggalLahir || req.body.dob;
        if (!s1Obj.jenisKelamin && (req.body.jenisKelamin || req.body.gender)) s1Obj.jenisKelamin = req.body.jenisKelamin || req.body.gender;
        if (!s1Obj.agama && (req.body.agama || req.body.religion)) s1Obj.agama = req.body.agama || req.body.religion;
        if (!s1Obj.noHp && (req.body.noHp || req.body.phone)) s1Obj.noHp = req.body.noHp || req.body.phone;

        if (!s2Obj.alamat && (req.body.alamat || req.body.address)) s2Obj.alamat = req.body.alamat || req.body.address;
        if (!s2Obj.rt && req.body.rt) s2Obj.rt = req.body.rt;
        if (!s2Obj.rw && req.body.rw) s2Obj.rw = req.body.rw;
        if (!s2Obj.desa && (req.body.desa || req.body.desaKelurahan)) s2Obj.desa = req.body.desa || req.body.desaKelurahan;
        if (!s2Obj.kecamatan && req.body.kecamatan) s2Obj.kecamatan = req.body.kecamatan;
        if (!s2Obj.kodePos && req.body.kodePos) s2Obj.kodePos = req.body.kodePos;
        if (!s2Obj.latitude && req.body.latitude) s2Obj.latitude = req.body.latitude;
        if (!s2Obj.longitude && req.body.longitude) s2Obj.longitude = req.body.longitude;

        if (!s3Obj.namaAyah && (req.body.namaAyah || req.body.fatherName)) s3Obj.namaAyah = req.body.namaAyah || req.body.fatherName;
        if (!s3Obj.pekerjaanAyah && req.body.pekerjaanAyah) s3Obj.pekerjaanAyah = req.body.pekerjaanAyah;
        if (!s3Obj.penghasilanAyah && req.body.penghasilanAyah) s3Obj.penghasilanAyah = req.body.penghasilanAyah;
        if (!s3Obj.namaIbu && (req.body.namaIbu || req.body.motherName)) s3Obj.namaIbu = req.body.namaIbu || req.body.motherName;
        if (!s3Obj.pekerjaanIbu && req.body.pekerjaanIbu) s3Obj.pekerjaanIbu = req.body.pekerjaanIbu;
        if (!s3Obj.penghasilanIbu && req.body.penghasilanIbu) s3Obj.penghasilanIbu = req.body.penghasilanIbu;
        if (!s3Obj.noHpOrtu && (req.body.noHpOrtu || req.body.parentPhone)) s3Obj.noHpOrtu = req.body.noHpOrtu || req.body.parentPhone;

        if (!s4Obj.kip && req.body.kip) s4Obj.kip = req.body.kip;
        if (!s4Obj.pkh && req.body.pkh) s4Obj.pkh = req.body.pkh;
        if (!s4Obj.kks && req.body.kks) s4Obj.kks = req.body.kks;

        if (!s5Obj.transportasi && req.body.transportasi) s5Obj.transportasi = req.body.transportasi;
        if (!s5Obj.jarakSekolah && req.body.jarakSekolah) s5Obj.jarakSekolah = req.body.jarakSekolah;

        if (bantuanFileUrl) {
            s4Obj.bantuanFileUrl = bantuanFileUrl;
        }
        if (dinsosFileUrl) {
            s4Obj.dinsosFileUrl = dinsosFileUrl;
        }
        if (fotoFileUrl) {
            s1Obj.fotoUrl = fotoFileUrl;
        }

        const combinedPayload = {
            step1: s1Obj,
            step2: s2Obj,
            step3: s3Obj,
            step4: s4Obj,
            step5: s5Obj,
            kkFileUrl,
            aktaFileUrl,
            bantuanFileUrl,
            dinsosFileUrl,
            fotoFileUrl
        };

        let resultSubmission;
        if (existing) {
            // Update data antrean staging yang sedang pending / perbaikan setelah ditolak
            resultSubmission = await (prisma as any).studentProfileSubmission.update({
                where: { id: existing.id },
                data: {
                    parentId,
                    step1Data: JSON.stringify(s1Obj),
                    step2Data: JSON.stringify(s2Obj),
                    step3Data: JSON.stringify(s3Obj),
                    step4Data: JSON.stringify(s4Obj),
                    step5Data: JSON.stringify(s5Obj),
                    payloadJson: JSON.stringify(combinedPayload),
                    kkFileUrl,
                    aktaFileUrl,
                    status: 'PENDING',
                    rejectionReason: null, // Reset alasan penolakan
                    submittedAt: new Date()
                }
            });
        } else {
            // Buat record staging baru
            resultSubmission = await (prisma as any).studentProfileSubmission.create({
                data: {
                    studentId,
                    parentId,
                    step1Data: JSON.stringify(s1Obj),
                    step2Data: JSON.stringify(s2Obj),
                    step3Data: JSON.stringify(s3Obj),
                    step4Data: JSON.stringify(s4Obj),
                    step5Data: JSON.stringify(s5Obj),
                    payloadJson: JSON.stringify(combinedPayload),
                    kkFileUrl,
                    aktaFileUrl,
                    status: 'PENDING',
                    submittedAt: new Date()
                }
            });
        }

        // Sinkronisasi Langsung ke Tabel Portal Kesiswaan TU (Single Source of Truth)
        try {
            // 1. Update User Pokok
            await prisma.user.update({
                where: { id: studentId },
                data: {
                    nik: s1Obj.nik || undefined,
                    pob: s1Obj.tempatLahir || undefined,
                    dob: s1Obj.tanggalLahir || undefined,
                    gender: s1Obj.jenisKelamin || undefined,
                    religion: s1Obj.agama || undefined,
                    address: s2Obj.alamat || undefined,
                    parentPhone: s3Obj.noHpOrtu || undefined,
                    fatherName: s3Obj.namaAyah || undefined,
                    motherName: s3Obj.namaIbu || undefined,
                    profilePicUrl: fotoFileUrl || undefined
                }
            });

            // 2. Update BiodataSiswa
            const latVal = s2Obj.latitude ? parseFloat(s2Obj.latitude) : null;
            const lngVal = s2Obj.longitude ? parseFloat(s2Obj.longitude) : null;
            await (prisma as any).biodataSiswa.upsert({
                where: { studentId },
                create: {
                    studentId,
                    parentId,
                    alamatLengkap: s2Obj.alamat || null,
                    rt: s2Obj.rt || null,
                    rw: s2Obj.rw || null,
                    kodePos: s2Obj.kodePos || null,
                    desaKelurahan: s2Obj.desa || null,
                    kecamatan: s2Obj.kecamatan || null,
                    latitude: latVal,
                    longitude: lngVal,
                    lokasiTerkonfirmasi: !!(latVal && lngVal),
                    fotoUrl: fotoFileUrl || null,
                    status: 'PENDING',
                    konfirmasiAkhir: true
                },
                update: {
                    alamatLengkap: s2Obj.alamat || undefined,
                    rt: s2Obj.rt || undefined,
                    rw: s2Obj.rw || undefined,
                    kodePos: s2Obj.kodePos || undefined,
                    desaKelurahan: s2Obj.desa || undefined,
                    kecamatan: s2Obj.kecamatan || undefined,
                    latitude: latVal !== null ? latVal : undefined,
                    longitude: lngVal !== null ? lngVal : undefined,
                    lokasiTerkonfirmasi: !!(latVal && lngVal),
                    fotoUrl: fotoFileUrl || undefined,
                    status: 'PENDING',
                    konfirmasiAkhir: true
                }
            });

            // 3. Update Ayah Kandung
            await (prisma as any).biodataAyah.upsert({
                where: { studentId },
                create: {
                    studentId,
                    nama: s3Obj.namaAyah || 'Ayah Kandung',
                    statusHidup: s3Obj.statusAyah || 'Masih Hidup',
                    pekerjaan: s3Obj.pekerjaanAyah || null,
                    penghasilan: s3Obj.penghasilanAyah || null,
                    noHp: s3Obj.noHpOrtu || null
                },
                update: {
                    nama: s3Obj.namaAyah || undefined,
                    statusHidup: s3Obj.statusAyah || undefined,
                    pekerjaan: s3Obj.pekerjaanAyah || undefined,
                    penghasilan: s3Obj.penghasilanAyah || undefined,
                    noHp: s3Obj.noHpOrtu || undefined
                }
            });

            // 4. Update Ibu Kandung
            await (prisma as any).biodataIbu.upsert({
                where: { studentId },
                create: {
                    studentId,
                    nama: s3Obj.namaIbu || 'Ibu Kandung',
                    statusHidup: s3Obj.statusIbu || 'Masih Hidup',
                    pekerjaan: s3Obj.pekerjaanIbu || null,
                    penghasilan: s3Obj.penghasilanIbu || null,
                    noHp: s3Obj.noHpOrtu || null
                },
                update: {
                    nama: s3Obj.namaIbu || undefined,
                    statusHidup: s3Obj.statusIbu || undefined,
                    pekerjaan: s3Obj.pekerjaanIbu || undefined,
                    penghasilan: s3Obj.penghasilanIbu || undefined,
                    noHp: s3Obj.noHpOrtu || undefined
                }
            });

            // 5. Update Wali (Jika diisi)
            if (s3Obj.hasGuardian && s3Obj.namaWali) {
                await (prisma as any).biodataWali.upsert({
                    where: { studentId },
                    create: {
                        studentId,
                        nama: s3Obj.namaWali,
                        nik: s3Obj.nikWali || null,
                        hubungan: s3Obj.hubunganWali || 'Wali',
                        pekerjaan: s3Obj.pekerjaanWali || null,
                        penghasilan: s3Obj.penghasilanWali || null,
                        noHp: s3Obj.noHpWali || null
                    },
                    update: {
                        nama: s3Obj.namaWali,
                        nik: s3Obj.nikWali || undefined,
                        hubungan: s3Obj.hubunganWali || undefined,
                        pekerjaan: s3Obj.pekerjaanWali || undefined,
                        penghasilan: s3Obj.penghasilanWali || undefined,
                        noHp: s3Obj.noHpWali || undefined
                    }
                });
            }

            // 6. Dokumen Siswa
            if (kkFileUrl) {
                await (prisma as any).dokumenSiswa.deleteMany({ where: { studentId, jenis: 'KK' } });
                await (prisma as any).dokumenSiswa.create({
                    data: { studentId, jenis: 'KK', fileUrl: kkFileUrl, uploadedBy: parentId || 'PARENT' }
                });
            }
            if (aktaFileUrl) {
                await (prisma as any).dokumenSiswa.deleteMany({ where: { studentId, jenis: 'AKTA' } });
                await (prisma as any).dokumenSiswa.create({
                    data: { studentId, jenis: 'AKTA', fileUrl: aktaFileUrl, uploadedBy: parentId || 'PARENT' }
                });
            }
            if (fotoFileUrl) {
                await (prisma as any).dokumenSiswa.deleteMany({ where: { studentId, jenis: 'FOTO' } });
                await (prisma as any).dokumenSiswa.create({
                    data: { studentId, jenis: 'FOTO', fileUrl: fotoFileUrl, uploadedBy: parentId || 'PARENT' }
                });
            }
            if (bantuanFileUrl) {
                await (prisma as any).dokumenSiswa.deleteMany({ where: { studentId, jenis: 'KARTU_BANTUAN' } });
                await (prisma as any).dokumenSiswa.create({
                    data: { studentId, jenis: 'KARTU_BANTUAN', fileUrl: bantuanFileUrl, uploadedBy: parentId || 'PARENT' }
                });
            }
            if (dinsosFileUrl) {
                await (prisma as any).dokumenSiswa.deleteMany({ where: { studentId, jenis: 'SURAT_DINSOS' } });
                await (prisma as any).dokumenSiswa.create({
                    data: { studentId, jenis: 'SURAT_DINSOS', fileUrl: dinsosFileUrl, uploadedBy: parentId || 'PARENT' }
                });
            }

            // 7. Update Afirmasi & Desil Kesejahteraan
            const rawDesil = s4Obj.desil ? parseInt(String(s4Obj.desil).replace(/\D/g, '')) || null : null;
            await (prisma as any).biodataAfirmasi.upsert({
                where: { studentId },
                create: {
                    studentId,
                    punyaAfirmasi: Boolean(s4Obj.hasAssistance),
                    jenisKartu: s4Obj.hasAssistance ? (s4Obj.assistanceType || 'KIP') : null,
                    kartuUrl: bantuanFileUrl || s4Obj.bantuanFileUrl || null,
                    desilDtks: rawDesil,
                    dtksUrl: dinsosFileUrl || s4Obj.dinsosFileUrl || null
                },
                update: {
                    punyaAfirmasi: Boolean(s4Obj.hasAssistance),
                    jenisKartu: s4Obj.hasAssistance ? (s4Obj.assistanceType || 'KIP') : null,
                    kartuUrl: bantuanFileUrl || s4Obj.bantuanFileUrl || undefined,
                    desilDtks: rawDesil !== null ? rawDesil : undefined,
                    dtksUrl: dinsosFileUrl || s4Obj.dinsosFileUrl || undefined
                }
            });
        } catch (syncErr: any) {
            console.warn('[BiodataSubmission] Warning sinkronisasi tabel:', syncErr.message);
        }

        return res.status(200).json({
            success: true,
            message: '🎉 Berkas biodata siswa berhasil diserahkan ke antrean verifikasi Staf Tata Usaha.',
            submission: resultSubmission
        });
    } catch (error: any) {
        console.error('Error submitStudentBiodata:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal mengirimkan formulir biodata' });
    }
};

/**
 * GET /api/v1/mobile/biodata/my-submission
 * Ambil data submission aktif orang tua / siswa untuk mengisi atau melihat status
 */
export const getMyBiodataSubmission = async (req: Request, res: Response) => {
    try {
        const currentUser = (req as any).user;
        if (!currentUser) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        let studentId = '';
        if (currentUser.role === 'PARENT') {
            const cleanNisn = (currentUser.nisn || currentUser.username.replace(/^[Pp]/, '')).trim();
            const student = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { nisn: cleanNisn },
                        { username: cleanNisn }
                    ]
                }
            });
            if (student) studentId = student.id;
        } else if (currentUser.role === 'STUDENT') {
            studentId = currentUser.id;
        }

        const config = await getBiodataToggleConfig();

        if (!studentId) {
            return res.json({
                success: true,
                isToggleOpen: config.isOpenNow,
                deadline: config.deadline,
                submission: null,
                student: null
            });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: {
                id: true,
                name: true,
                nisn: true,
                nik: true,
                className: true,
                gender: true,
                religion: true,
                pob: true,
                dob: true,
                address: true,
                fatherName: true,
                motherName: true,
                parentPhone: true,
                profilePicUrl: true
            }
        });

        const [bioSiswa, bioAyah, bioIbu, bioWali, bioAfirmasi, dokSiswa] = await Promise.all([
            (prisma as any).biodataSiswa.findUnique({ where: { studentId } }),
            (prisma as any).biodataAyah.findUnique({ where: { studentId } }),
            (prisma as any).biodataIbu.findUnique({ where: { studentId } }),
            (prisma as any).biodataWali.findUnique({ where: { studentId } }),
            (prisma as any).biodataAfirmasi.findUnique({ where: { studentId } }),
            (prisma as any).dokumenSiswa.findFirst({ where: { studentId } })
        ]);

        const submission = await (prisma as any).studentProfileSubmission.findFirst({
            where: { studentId },
            orderBy: { submittedAt: 'desc' }
        });

        // Susun objek data lengkap agar formulir di HP langsung memunculkan seluruh data master tanpa menunggu atau kosong
        let effectiveSubmission: any = submission;
        if (!effectiveSubmission) {
            effectiveSubmission = {
                id: 'master-bio',
                studentId,
                status: 'DRAFT',
                rejectionReason: null,
                kkFileUrl: dokSiswa?.fileKkUrl || null,
                aktaFileUrl: dokSiswa?.fileAktaUrl || null,
                bantuanFileUrl: dokSiswa?.fileBantuanUrl || null,
                step1Data: JSON.stringify({
                    nama: student?.name || bioSiswa?.namaLengkap || '',
                    nisn: student?.nisn || bioSiswa?.nisn || '',
                    nik: student?.nik || bioSiswa?.nik || '',
                    tempatLahir: student?.pob || bioSiswa?.tempatLahir || '',
                    tanggalLahir: student?.dob || bioSiswa?.tanggalLahir || '',
                    jenisKelamin: student?.gender || bioSiswa?.jk || 'L',
                    agama: student?.religion || bioSiswa?.agama || 'Islam',
                    fotoUrl: dokSiswa?.foto3x4Url || student?.profilePicUrl || bioSiswa?.fotoUrl || null
                }),
                step2Data: JSON.stringify({
                    alamat: bioSiswa?.alamatLengkap || student?.address || '',
                    latitude: bioSiswa?.latitude != null ? String(bioSiswa.latitude) : '',
                    longitude: bioSiswa?.longitude != null ? String(bioSiswa.longitude) : '',
                    rt: bioSiswa?.rt || '',
                    rw: bioSiswa?.rw || '',
                    kodePos: bioSiswa?.kodePos || '',
                    desa: bioSiswa?.desaKelurahan || '',
                    kecamatan: bioSiswa?.kecamatan || 'Boyolangu'
                }),
                step3Data: JSON.stringify({
                    namaAyah: bioAyah?.nama || student?.fatherName || '',
                    statusAyah: bioAyah?.statusHidup || 'Masih Hidup',
                    pekerjaanAyah: bioAyah?.pekerjaan || '',
                    penghasilanAyah: bioAyah?.penghasilan || '',
                    namaIbu: bioIbu?.nama || student?.motherName || '',
                    statusIbu: bioIbu?.statusHidup || 'Masih Hidup',
                    pekerjaanIbu: bioIbu?.pekerjaan || '',
                    penghasilanIbu: bioIbu?.penghasilan || '',
                    hasGuardian: !!(bioWali?.nama),
                    namaWali: bioWali?.nama || '',
                    nikWali: bioWali?.nik || '',
                    hubunganWali: bioWali?.hubungan || 'Wali',
                    pekerjaanWali: bioWali?.pekerjaan || '',
                    penghasilanWali: bioWali?.penghasilan || '',
                    noHpWali: bioWali?.noHp || '',
                    noHpOrtu: student?.parentPhone || bioAyah?.noHp || bioIbu?.noHp || ''
                }),
                step4Data: JSON.stringify({
                    hasAssistance: !!(bioAfirmasi?.punyaAfirmasi),
                    assistanceType: bioAfirmasi?.jenisKartu || 'KIP (Kartu Indonesia Pintar)',
                    assistanceNumber: bioAfirmasi?.nomorKartu || '',
                    desil: bioAfirmasi?.desilDtks ? `Desil ${bioAfirmasi.desilDtks}` : 'Non-Desil',
                    dinsosFileUploaded: !!(bioAfirmasi?.dtksUrl || dokSiswa?.fileDinsosUrl),
                    dinsosUrl: bioAfirmasi?.dtksUrl || dokSiswa?.fileDinsosUrl || null,
                    bantuanFileUploaded: !!(dokSiswa?.fileBantuanUrl)
                }),
                step5Data: JSON.stringify({
                    kkUploaded: !!(dokSiswa?.fileKkUrl),
                    aktaUploaded: !!(dokSiswa?.fileAktaUrl),
                    bantuanUploaded: !!(dokSiswa?.fileBantuanUrl)
                })
            };
        } else {
            // Jika submission ada tapi ada field kosong, lengkapi dari data master portal
            try {
                const s1 = JSON.parse(effectiveSubmission.step1Data || '{}');
                if (!s1.nama && (student?.name || bioSiswa?.namaLengkap)) s1.nama = student?.name || bioSiswa?.namaLengkap;
                if (!s1.nisn && (student?.nisn || bioSiswa?.nisn)) s1.nisn = student?.nisn || bioSiswa?.nisn;
                if (!s1.nik && (student?.nik || bioSiswa?.nik)) s1.nik = student?.nik || bioSiswa?.nik;
                if (!s1.tempatLahir && (student?.pob || bioSiswa?.tempatLahir)) s1.tempatLahir = student?.pob || bioSiswa?.tempatLahir;
                if (!s1.tanggalLahir && (student?.dob || bioSiswa?.tanggalLahir)) s1.tanggalLahir = student?.dob || bioSiswa?.tanggalLahir;
                if (!s1.fotoUrl && (dokSiswa?.foto3x4Url || student?.profilePicUrl)) s1.fotoUrl = dokSiswa?.foto3x4Url || student?.profilePicUrl;
                effectiveSubmission.step1Data = JSON.stringify(s1);

                const s2 = JSON.parse(effectiveSubmission.step2Data || '{}');
                if (!s2.alamat && (bioSiswa?.alamatLengkap || student?.address)) s2.alamat = bioSiswa?.alamatLengkap || student?.address;
                if (!s2.latitude && bioSiswa?.latitude != null) s2.latitude = String(bioSiswa.latitude);
                if (!s2.longitude && bioSiswa?.longitude != null) s2.longitude = String(bioSiswa.longitude);
                if (!s2.rt && bioSiswa?.rt) s2.rt = bioSiswa.rt;
                if (!s2.rw && bioSiswa?.rw) s2.rw = bioSiswa.rw;
                if (!s2.desa && bioSiswa?.desaKelurahan) s2.desa = bioSiswa.desaKelurahan;
                if (!s2.kecamatan && bioSiswa?.kecamatan) s2.kecamatan = bioSiswa.kecamatan;
                effectiveSubmission.step2Data = JSON.stringify(s2);

                const s3 = JSON.parse(effectiveSubmission.step3Data || '{}');
                if (!s3.namaAyah && (bioAyah?.nama || student?.fatherName)) s3.namaAyah = bioAyah?.nama || student?.fatherName;
                if (!s3.statusAyah && bioAyah?.statusHidup) s3.statusAyah = bioAyah.statusHidup;
                if (!s3.pekerjaanAyah && bioAyah?.pekerjaan) s3.pekerjaanAyah = bioAyah.pekerjaan;
                if (!s3.penghasilanAyah && bioAyah?.penghasilan) s3.penghasilanAyah = bioAyah.penghasilan;
                if (!s3.namaIbu && (bioIbu?.nama || student?.motherName)) s3.namaIbu = bioIbu?.nama || student?.motherName;
                if (!s3.statusIbu && bioIbu?.statusHidup) s3.statusIbu = bioIbu.statusHidup;
                if (!s3.pekerjaanIbu && bioIbu?.pekerjaan) s3.pekerjaanIbu = bioIbu.pekerjaan;
                if (!s3.penghasilanIbu && bioIbu?.penghasilan) s3.penghasilanIbu = bioIbu.penghasilan;
                if (!s3.noHpOrtu && (student?.parentPhone || bioAyah?.noHp || bioIbu?.noHp)) s3.noHpOrtu = student?.parentPhone || bioAyah?.noHp || bioIbu?.noHp;
                if (!s3.hasGuardian && bioWali?.nama) {
                    s3.hasGuardian = true;
                    s3.namaWali = bioWali.nama;
                    s3.nikWali = bioWali.nik || '';
                    s3.hubunganWali = bioWali.hubungan || 'Wali';
                    s3.pekerjaanWali = bioWali.pekerjaan || '';
                    s3.penghasilanWali = bioWali.penghasilan || '';
                    s3.noHpWali = bioWali.noHp || '';
                }
                effectiveSubmission.step3Data = JSON.stringify(s3);
            } catch (e) {}
        }

        const isLocked = effectiveSubmission?.status === 'APPROVED' || effectiveSubmission?.status === 'PENDING';

        return res.json({
            success: true,
            isToggleOpen: config.isOpenNow,
            deadline: config.deadline,
            isLocked,
            status: effectiveSubmission?.status || 'NOT_SUBMITTED',
            rejectionReason: effectiveSubmission?.rejectionReason || null,
            submission: effectiveSubmission,
            student
        });
    } catch (error: any) {
        console.error('Error getMyBiodataSubmission:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memuat submission biodata' });
    }
};

// ========================================================
// 3. VERIFIKASI & APPROVAL OLEH STAF TU (PORTAL WEB)
// ========================================================

/**
 * GET /api/v1/admin/biodata/submissions
 * Daftar antrean validasi biodata untuk Portal Web Staf TU (Filter PENDING, APPROVED, REJECTED)
 */
export const getBiodataSubmissionsList = async (req: Request, res: Response) => {
    try {
        const { status, className, search } = req.query;
        const whereClause: any = {};

        if (status && status !== 'ALL') {
            whereClause.status = String(status);
        }

        const submissions = await (prisma as any).studentProfileSubmission.findMany({
            where: whereClause,
            include: {
                student: {
                    select: {
                        id: true,
                        name: true,
                        className: true,
                        nisn: true,
                        nik: true,
                        profilePicUrl: true
                    }
                }
            },
            orderBy: { submittedAt: 'desc' },
            take: 150
        });

        let filtered = submissions;
        if (className && className !== 'ALL') {
            filtered = filtered.filter((s: any) => s.student?.className === className);
        }
        if (search && typeof search === 'string' && search.trim()) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter((s: any) =>
                s.student?.name?.toLowerCase().includes(q) ||
                s.student?.nisn?.includes(q)
            );
        }

        return res.json({
            success: true,
            count: filtered.length,
            data: filtered
        });
    } catch (error: any) {
        console.error('Error getBiodataSubmissionsList:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal mengambil daftar antrean biodata' });
    }
};

/**
 * POST /api/v1/admin/biodata/:id/action
 * Action Staf TU: 'APPROVE' atau 'REJECT'
 * Jika Approved: Salin otomatis ke tabel master `User` (students) & kunci form di APK menjadi Read-Only
 * Jika Rejected: Set status REJECTED, simpan `rejection_reason`, buka kembali form di APK
 */
export const actionBiodataSubmission = async (req: Request, res: Response) => {
    try {
        const reviewerName = (req as any).user?.name || 'Petugas TU';
        const { id } = req.params;
        const { action, rejectionReason } = req.body;

        if (!['APPROVE', 'REJECT'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Aksi tidak valid. Pilih APPROVE atau REJECT.' });
        }

        const submission = await (prisma as any).studentProfileSubmission.findUnique({
            where: { id },
            include: { student: true }
        });

        if (!submission) {
            return res.status(404).json({ success: false, message: 'Data pengajuan biodata tidak ditemukan.' });
        }

        if (action === 'APPROVE') {
            // Parsing Step Data
            let s1: any = {};
            let s2: any = {};
            let s3: any = {};
            try {
                if (submission.step1Data) s1 = JSON.parse(submission.step1Data);
                if (submission.step2Data) s2 = JSON.parse(submission.step2Data);
                if (submission.step3Data) s3 = JSON.parse(submission.step3Data);
            } catch (e) {}

            const fullAddress = s2.alamat
                ? `${s2.alamat}${s2.rt ? ` RT ${s2.rt}` : ''}${s2.rw ? ` RW ${s2.rw}` : ''}${s2.desa ? `, Desa ${s2.desa}` : ''}${s2.kecamatan ? `, Kec. ${s2.kecamatan}` : ''}${s2.kabupaten ? `, ${s2.kabupaten}` : ''}`
                : submission.student.address;

            // Salin otomatis ke tabel master `User` (Student)
            await prisma.user.update({
                where: { id: submission.studentId },
                data: {
                    name: s1.nama || submission.student.name,
                    nik: s1.nik || (submission.student as any).nik || null,
                    pob: s1.tempatLahir || submission.student.pob,
                    dob: s1.tanggalLahir || submission.student.dob,
                    gender: s1.jenisKelamin || submission.student.gender,
                    religion: s1.agama || submission.student.religion,
                    address: fullAddress,
                    fatherName: s3.namaAyah || submission.student.fatherName,
                    motherName: s3.namaIbu || submission.student.motherName,
                    parentPhone: s3.noHpOrtu || submission.student.parentPhone,
                    profilePicUrl: s1.fotoUrl || (submission as any).fotoUrl || undefined
                }
            });

            // Update submission status menjadi APPROVED
            const updated = await (prisma as any).studentProfileSubmission.update({
                where: { id },
                data: {
                    status: 'APPROVED',
                    reviewedBy: reviewerName,
                    reviewedAt: new Date(),
                    rejectionReason: null
                }
            });

            // Notifikasi ke Orang Tua
            try {
                await (prisma as any).notificationMessage.create({
                    data: {
                        recipientRole: 'PARENT',
                        studentId: submission.studentId,
                        studentName: submission.student.name,
                        className: submission.student.className || '-',
                        title: '✅ Verifikasi Biodata Siswa Selesai!',
                        message: `Selamat, berkas dan data formulir biodata ananda ${submission.student.name} telah diverifikasi dan disetujui oleh Petugas TU (${reviewerName}). Data resmi telah diperbarui di SIAKAD.`,
                        category: 'BIODATA_VERIFIED'
                    }
                });
            } catch (e) {}

            return res.json({
                success: true,
                message: `✅ Biodata ananda ${submission.student.name} berhasil disetujui & disinkronkan ke tabel utama siswa. Form di APK terkunci (Read-Only).`,
                data: updated
            });

        } else {
            // REJECT
            if (!rejectionReason || rejectionReason.trim().length < 5) {
                return res.status(400).json({
                    success: false,
                    message: 'Alasan penolakan / catatan revisi wajib diisi minimal 5 karakter.'
                });
            }

            const updated = await (prisma as any).studentProfileSubmission.update({
                where: { id },
                data: {
                    status: 'REJECTED',
                    rejectionReason: rejectionReason.trim(),
                    reviewedBy: reviewerName,
                    reviewedAt: new Date()
                }
            });

            // Notifikasi revisi ke Orang Tua
            try {
                await (prisma as any).notificationMessage.create({
                    data: {
                        recipientRole: 'PARENT',
                        studentId: submission.studentId,
                        studentName: submission.student.name,
                        className: submission.student.className || '-',
                        title: '⚠️ Revisi Pengajuan Biodata Siswa Diperlukan',
                        message: `Pengajuan biodata ananda ${submission.student.name} memerlukan perbaikan dari Petugas TU (${reviewerName}). Catatan: "${rejectionReason.trim()}". Silakan buka kembali form di aplikasi untuk perbaikan.`,
                        category: 'BIODATA_REVISED'
                    }
                });
            } catch (e) {}

            return res.json({
                success: true,
                message: `Pengajuan biodata ditolak. Catatan revisi telah dikirimkan ke akun orang tua siswa. Form di APK terbuka kembali untuk perbaikan.`,
                data: updated
            });
        }
    } catch (error: any) {
        console.error('Error actionBiodataSubmission:', error);
        return res.status(500).json({ success: false, message: error.message || 'Gagal memproses aksi biodata' });
    }
};

/**
 * 8. SIMPAN HASIL PASFOTO AI DENGAN LATAR BIRU RESMI
 * Menyimpan foto editan AI latar biru sebagai foto profil siswa dan dokumen foto 3x4 resmi,
 * tanpa merusak atau menghapus foto biometrik asli.
 */
export const applyOfficialPasfoto = async (req: Request, res: Response) => {
    try {
        const { submissionId, studentId, base64Image } = req.body;
        if (!studentId || !base64Image) {
            return res.status(400).json({ success: false, message: 'studentId dan base64Image wajib disertakan.' });
        }

        const fotoDir = path.join(__dirname, '../../uploads/biodata/foto');
        if (!fs.existsSync(fotoDir)) fs.mkdirSync(fotoDir, { recursive: true });

        const cleanBase64 = base64Image.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        const filename = `pasfoto_blue_${studentId}_${Date.now()}.jpg`;
        const filePath = path.join(fotoDir, filename);

        fs.writeFileSync(filePath, buffer);
        const relativeUrl = `/uploads/biodata/foto/${filename}`;

        // 1. Update profilePicUrl siswa
        await prisma.user.update({
            where: { id: studentId },
            data: { profilePicUrl: relativeUrl }
        });

        // 2. Simpan di dokumen siswa
        try {
            await (prisma as any).dokumenSiswa.deleteMany({ where: { studentId, jenis: 'FOTO_3X4_BIRU' } });
            await (prisma as any).dokumenSiswa.create({
                data: {
                    studentId,
                    jenis: 'FOTO_3X4_BIRU',
                    fileUrl: relativeUrl,
                    uploadedBy: 'AI_STUDIO'
                }
            });
        } catch (_) {}

        // 3. Update pengajuan submission jika ada
        if (submissionId) {
            try {
                const sub = await (prisma as any).studentProfileSubmission.findUnique({ where: { id: submissionId } });
                if (sub) {
                    let s1 = {};
                    try { s1 = JSON.parse(sub.step1Data || '{}'); } catch(_) {}
                    (s1 as any).pasfotoBiruUrl = relativeUrl;
                    await (prisma as any).studentProfileSubmission.update({
                        where: { id: submissionId },
                        data: {
                            step1Data: JSON.stringify(s1),
                            fotoFileUrl: relativeUrl
                        }
                    });
                }
            } catch (_) {}
        }

        return res.json({
            success: true,
            message: '✅ Pasfoto AI Latar Biru Resmi berhasil diterapkan dan tersimpan sebagai foto profil siswa!',
            fileUrl: relativeUrl
        });
    } catch (e: any) {
        console.error('Error applyOfficialPasfoto:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
};
