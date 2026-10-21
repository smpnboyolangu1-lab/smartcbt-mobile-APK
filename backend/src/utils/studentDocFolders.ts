import fs from 'fs';
import path from 'path';
import prisma from './db';

/**
 * Sanitasi string untuk nama folder aman di sistem operasi Windows/Linux
 */
export function sanitizeFolderName(name: string): string {
    return name
        .trim()
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_');
}

/**
 * Helper untuk menentukan nama folder per siswa
 * Format: [NISN/NIS/ID]_[NAMA_SISWA]
 */
export function getStudentFolderName(student: { id: string; name: string; nisn?: string | null; nis?: string | null }): string {
    const identifier = student.nisn || student.nis || student.id.substring(0, 8);
    const cleanName = sanitizeFolderName(student.name);
    return `${identifier}_${cleanName}`;
}

/**
 * Memastikan direktori per siswa di /uploads/kk/ dan /uploads/akta/ terbentuk di server
 */
export async function ensureAllStudentDocFolders() {
    try {
        const rootUploads = path.join(process.cwd(), 'uploads');
        const kkRoot = path.join(rootUploads, 'kk');
        const aktaRoot = path.join(rootUploads, 'akta');

        if (!fs.existsSync(kkRoot)) fs.mkdirSync(kkRoot, { recursive: true });
        if (!fs.existsSync(aktaRoot)) fs.mkdirSync(aktaRoot, { recursive: true });

        // Ambil dokumen yang ada di dokumenSiswa
        const documents = await (prisma as any).dokumenSiswa.findMany({
            where: {
                jenis: { in: ['KK', 'AKTA'] }
            }
        });

        if (documents.length === 0) return;

        const studentIds = Array.from(new Set(documents.map((d: any) => String(d.studentId)))) as string[];
        const students = await prisma.user.findMany({
            where: { id: { in: studentIds } },
            select: { id: true, name: true, nisn: true, nis: true }
        });

        const studentMap = new Map<string, any>(students.map(s => [s.id, s]));

        for (const doc of documents) {
            const student = studentMap.get(doc.studentId);
            if (!student) continue;

            const folderName = getStudentFolderName(student);
            const targetDir = doc.jenis === 'KK' 
                ? path.join(kkRoot, folderName)
                : path.join(aktaRoot, folderName);

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // Jika berkas merupakan berkas lokal di server (misal di uploads/biodata/kk/ atau uploads/biodata/akta/)
            if (doc.fileUrl && !doc.fileUrl.startsWith('http')) {
                const sourceRelative = doc.fileUrl.replace(/^\//, '');
                const sourceAbsolute = path.join(process.cwd(), sourceRelative);
                if (fs.existsSync(sourceAbsolute)) {
                    const destFileName = `${doc.jenis.toLowerCase()}_${student.nisn || student.id.substring(0, 8)}${path.extname(sourceAbsolute) || '.pdf'}`;
                    const destAbsolute = path.join(targetDir, destFileName);
                    if (!fs.existsSync(destAbsolute)) {
                        try {
                            fs.copyFileSync(sourceAbsolute, destAbsolute);
                        } catch (copyErr) {
                            console.warn('[ensureAllStudentDocFolders] Gagal menyalin berkas:', copyErr);
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn('[ensureAllStudentDocFolders] Warning:', err);
    }
}
