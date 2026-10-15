import prisma from './db';

export interface SchoolSignatures {
    schoolName: string;
    headmasterName: string;
    headmasterNip: string;
    headmasterTitle: string;
    bkCoordinatorName: string;
    bkCoordinatorNip: string;
    bkCoordinatorTitle: string;
    homeroomName?: string;
    homeroomNip?: string;
    homeroomTitle?: string;
    isFullGradeOrAll?: boolean;
}

/**
 * Mengambil informasi identitas sekolah dan tanda tangan resmi (Kepala Sekolah & Guru BK / Koordinator)
 * secara dinamis dari tabel `Settings` (prisma.settings).
 * Perubahan di Pengaturan Sistem akan langsung aktif di seluruh dokumen/laporan/BAP.
 */
export async function getSchoolSignatures(): Promise<SchoolSignatures> {
    try {
        const settings = await prisma.settings.findMany({
            where: {
                key: {
                    in: [
                        'SCHOOL_NAME',
                        'HEADMASTER_NAME',
                        'HEADMASTER_NIP',
                        'BK_COORDINATOR_NAME',
                        'BK_COORDINATOR_NIP',
                        'BK_COORDINATOR_TITLE'
                    ]
                }
            }
        });

        const map: Record<string, string> = {};
        for (const s of settings) {
            if (s.value && s.value.trim().length > 0) {
                map[s.key] = s.value.trim();
            }
        }

        const schoolName = map['SCHOOL_NAME'] || 'SMPN 1 Boyolangu';
        let headmasterName = map['HEADMASTER_NAME'] || 'ADI SUTIGNYO, S.Pd.';
        headmasterName = headmasterName.replace(/SUITGNYO/gi, 'SUTIGNYO').trim();
        if (headmasterName.endsWith('S.Pd')) headmasterName += '.';

        const headmasterNip = (map['HEADMASTER_NIP'] || '196801211991031004').trim();
        const headmasterTitle = `Kepala ${schoolName}`;

        const bkCoordinatorName = (map['BK_COORDINATOR_NAME'] || '').replace(/Dra\.\s*NURUL\s*HIDAYATI/gi, '').trim();
        const bkCoordinatorNip = (map['BK_COORDINATOR_NIP'] || '').replace(/19740921\s*199903\s*2\s*005/gi, '').trim();
        const bkCoordinatorTitle = map['BK_COORDINATOR_TITLE'] || 'Guru BK / Koordinator Presensi';

        return {
            schoolName,
            headmasterName,
            headmasterNip,
            headmasterTitle,
            bkCoordinatorName,
            bkCoordinatorNip,
            bkCoordinatorTitle
        };
    } catch (e) {
        console.error('Error in getSchoolSignatures:', e);
        return {
            schoolName: 'SMPN 1 Boyolangu',
            headmasterName: 'ADI SUTIGNYO, S.Pd.',
            headmasterNip: '196801211991031004',
            headmasterTitle: 'Kepala SMPN 1 Boyolangu',
            bkCoordinatorName: '',
            bkCoordinatorNip: '',
            bkCoordinatorTitle: 'Guru BK / Koordinator Presensi'
        };
    }
}

/**
 * Mengambil tanda tangan rekapitulasi kehadiran dengan aturan:
 * Seluruh dokumen rekapitulasi (baik kelas spesifik maupun seluruh jenjang/tingkat)
 * WAJIB mencantumkan Nama dan NIP Kepala Sekolah (ADI SUTIGNYO, S.Pd. / 196801211991031004)
 * serta Guru BK / Koordinator Presensi dan Wali Kelas jika spesifik kelas.
 */
export async function getSchoolSignaturesForClass(
    className?: string | null,
    isFullGradeOrAllParam?: boolean
): Promise<SchoolSignatures> {
    const base = await getSchoolSignatures();

    const rawClass = (className || '').trim();
    const normalizedClass = rawClass.toUpperCase();
    const isFullGradeOrAll = isFullGradeOrAllParam ||
        !normalizedClass ||
        normalizedClass === 'ALL' ||
        normalizedClass === 'SEMUA' ||
        normalizedClass.startsWith('TINGKAT') ||
        normalizedClass.startsWith('GRADE') ||
        normalizedClass.startsWith('JENJANG') ||
        normalizedClass === '7' || normalizedClass === '8' || normalizedClass === '9';

    if (isFullGradeOrAll) {
        // Untuk seluruh kelas atau tingkat: Kepala Sekolah & Koordinator BK TETAP DITAMPILKAN LENGKAP
        return {
            schoolName: base.schoolName,
            headmasterName: base.headmasterName || 'ADI SUTIGNYO, S.Pd.',
            headmasterNip: base.headmasterNip || '196801211991031004',
            headmasterTitle: base.headmasterTitle || `Kepala ${base.schoolName}`,
            bkCoordinatorName: base.bkCoordinatorName || '',
            bkCoordinatorNip: base.bkCoordinatorNip || '',
            bkCoordinatorTitle: base.bkCoordinatorName ? (base.bkCoordinatorTitle || 'Guru BK / Koordinator Presensi') : '',
            homeroomName: '',
            homeroomNip: '',
            homeroomTitle: '',
            isFullGradeOrAll: true
        };
    }

    // Rekap per kelas spesifik: Ambil Guru BK pengampu kelas dan Wali Kelas
    let bkName = base.bkCoordinatorName || '';
    let bkNip = base.bkCoordinatorNip || '';
    let bkTitle = bkName ? `Guru BK Kelas ${rawClass}` : '';
    let homeroomName = '';
    let homeroomNip = '';

    try {
        if (rawClass) {
            // Bentuk variasi penulisan nama kelas (e.g. "VII-A", "7A", "7-A", "VIIA")
            const classVariants = Array.from(new Set([
                rawClass,
                rawClass.replace('-', ''),
                rawClass.replace(' ', ''),
                rawClass.replace('VII-', '7').replace('VIII-', '8').replace('IX-', '9'),
                rawClass.replace('VII', '7').replace('VIII', '8').replace('IX', '9'),
                rawClass.replace(/^7/, 'VII-').replace(/^8/, 'VIII-').replace(/^9/, 'IX-'),
                rawClass.replace(/^7-/, 'VII-').replace(/^8-/, 'VIII-').replace(/^9-/, 'IX-'),
                rawClass.replace(/^7/, 'VII').replace(/^8/, 'VIII').replace(/^9/, 'IX')
            ]));

            const classObj = await prisma.class.findFirst({
                where: { name: { in: classVariants } }
            });

            if (classObj) {
                if (classObj.counselorName && classObj.counselorName.trim().length > 0) {
                    bkName = classObj.counselorName.trim();
                }

                // Cari NIP guru BK di tabel User
                let counselorUser: any = null;
                if (classObj.counselorId) {
                    counselorUser = await prisma.user.findUnique({
                        where: { id: classObj.counselorId }
                    });
                }
                if (!counselorUser && bkName) {
                    counselorUser = await prisma.user.findFirst({
                        where: {
                            OR: [
                                { name: { equals: bkName } },
                                { name: { contains: bkName } }
                            ],
                            role: { in: ['COUNSELOR', 'TEACHER', 'ADMIN', 'OPERATOR'] }
                        }
                    });
                }
                if (counselorUser) {
                    bkNip = (counselorUser as any).nip || counselorUser.username || bkNip;
                }
            }

            // Cari Wali Kelas untuk kelas ini:
            // 1. Cek user dengan className cocok atau tugasTambahan mengandung nama kelas
            const homeroomTeacher = await prisma.user.findFirst({
                where: {
                    role: { in: ['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR'] },
                    OR: [
                        { className: { in: classVariants } },
                        { tugasTambahan: { contains: rawClass } }
                    ]
                }
            });

            if (homeroomTeacher) {
                homeroomName = homeroomTeacher.name;
                homeroomNip = (homeroomTeacher as any).nip || homeroomTeacher.username || '';
            }

            // 2. Fallback: cek siswa kelas ini yang punya field homeroomTeacher
            if (!homeroomName) {
                const sampleStudent = await prisma.user.findFirst({
                    where: {
                        role: 'STUDENT',
                        className: { in: classVariants },
                        homeroomTeacher: { not: null }
                    }
                });
                if (sampleStudent?.homeroomTeacher) {
                    homeroomName = sampleStudent.homeroomTeacher.trim();
                }
            }

            // 3. Jika homeroomName ada tapi homeroomNip belum terisi, cari user staff berdasarkan nama
            if (homeroomName && !homeroomNip) {
                const teacherByStudent = await prisma.user.findFirst({
                    where: {
                        role: { in: ['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR'] },
                        OR: [
                            { name: { equals: homeroomName } },
                            { name: { contains: homeroomName } },
                            { username: homeroomName }
                        ]
                    }
                });
                if (teacherByStudent) {
                    homeroomNip = (teacherByStudent as any).nip || teacherByStudent.username || '';
                }
            }

            // 4. Fallback jika nama Wali Kelas sama dengan Guru BK (contoh: Endah Tri Wahyuni)
            if (homeroomName && !homeroomNip && bkName && homeroomName.toLowerCase() === bkName.toLowerCase()) {
                homeroomNip = bkNip;
            }
        }
    } catch (err) {
        console.warn('[getSchoolSignaturesForClass] Failed to lookup specific class info:', err);
    }

    return {
        schoolName: base.schoolName,
        headmasterName: base.headmasterName, // ADI SUTIGNYO, S.Pd.
        headmasterNip: base.headmasterNip,   // 196801211991031004
        headmasterTitle: base.headmasterTitle,
        bkCoordinatorName: bkName,
        bkCoordinatorNip: bkNip,
        bkCoordinatorTitle: bkTitle,
        homeroomName,
        homeroomNip,
        homeroomTitle: `Wali Kelas ${rawClass}`,
        isFullGradeOrAll: false
    };
}
