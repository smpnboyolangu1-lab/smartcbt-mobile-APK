/**
 * Helper Ekstraksi & Resolusi Barcode / QR Kartu Pelajar Siswa
 * Mendukung format:
 * - STUDENT_MEMBER:<id>:<nisn>:<name>:<class>
 * - Barcode NISN standar (10 digit angka atau NIS)
 * - Prefix umum: STUDENT_, NISN:, KARTU_, CARD:, SISWA_
 * - JSON payload kartu pelajar
 */

export interface ParsedStudentCard {
    cleanCode: string;
    studentId?: string;
    nisn?: string;
    name?: string;
    className?: string;
    candidates: string[];
}

export function extractStudentCardCandidates(rawBarcode: string | null | undefined): ParsedStudentCard {
    if (!rawBarcode) {
        return { cleanCode: '', candidates: [] };
    }

    let clean = String(rawBarcode).trim();
    // Bersihkan pembungkus quote jika terbawa
    clean = clean.replace(/^["']|["']$/g, '').trim();

    const candidates = new Set<string>();
    candidates.add(clean);

    let studentId: string | undefined;
    let nisn: string | undefined;
    let name: string | undefined;
    let className: string | undefined;

    // 1. Cek JSON string
    if (clean.startsWith('{') && clean.endsWith('}')) {
        try {
            const parsed = JSON.parse(clean);
            if (parsed.id) {
                studentId = String(parsed.id).trim();
                candidates.add(studentId);
            }
            if (parsed.nisn) {
                nisn = String(parsed.nisn).trim();
                candidates.add(nisn);
            }
            if (parsed.nis) {
                candidates.add(String(parsed.nis).trim());
            }
            if (parsed.name) name = String(parsed.name).trim();
            if (parsed.className) className = String(parsed.className).trim();
        } catch (_) {}
    }

    // 2. Format Cetak Kartu Resmi SIBOY: STUDENT_MEMBER:<id>:<nisn>:<name>:<class>
    if (clean.toUpperCase().startsWith('STUDENT_MEMBER:')) {
        const parts = clean.split(':');
        // parts[0] = STUDENT_MEMBER
        // parts[1] = id
        // parts[2] = nisn
        // parts[3] = name
        // parts[4] = class
        if (parts.length >= 2 && parts[1]?.trim()) {
            studentId = parts[1].trim();
            candidates.add(studentId);
        }
        if (parts.length >= 3 && parts[2]?.trim()) {
            nisn = parts[2].trim();
            candidates.add(nisn);
        }
        if (parts.length >= 4 && parts[3]?.trim()) {
            name = parts[3].trim();
        }
        if (parts.length >= 5 && parts[4]?.trim()) {
            className = parts[4].trim();
        }
    } else {
        // 3. Strip prefix umum (STUDENT_, NISN:, KARTU_, CARD:, SISWA_)
        const stripped = clean.replace(/^(STUDENT_|NISN:|KARTU_|CARD:|SISWA_)/i, '').trim();
        if (stripped && stripped !== clean) {
            candidates.add(stripped);
            if (!nisn) nisn = stripped;
        }
    }

    return {
        cleanCode: clean,
        studentId,
        nisn,
        name,
        className,
        candidates: Array.from(candidates).filter(Boolean)
    };
}

/**
 * Membangun query Prisma OR filter untuk mencari siswa berdasarkan kandidat barcode
 */
export function buildStudentCardPrismaOr(parsed: ParsedStudentCard): any[] {
    const orList: any[] = [];
    if (parsed.studentId) {
        orList.push({ id: parsed.studentId });
    }
    if (parsed.nisn) {
        orList.push({ nisn: parsed.nisn });
        orList.push({ nis: parsed.nisn });
        orList.push({ username: parsed.nisn });
    }
    for (const c of parsed.candidates) {
        orList.push({ id: c });
        orList.push({ nisn: c });
        orList.push({ nis: c });
        orList.push({ username: c });
    }
    return orList;
}
