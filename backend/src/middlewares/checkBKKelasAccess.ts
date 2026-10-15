import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/db';

/**
 * Middleware: Validasi Pembatasan Akses Plot Kelas Guru BK (Modul BK Terpisah)
 * Menjamin Guru BK (COUNSELOR) hanya dapat mengakses, memodifikasi, atau memproses
 * data siswa dari rombel kelas yang resmi diampunya.
 */
export async function checkBKKelasAccess(req: Request, res: Response, next: NextFunction) {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
        }

        // Administrator dan Operator memiliki izin pengawasan global lintas-kelas
        if (['ADMIN', 'OPERATOR'].includes(user.role)) {
            return next();
        }

        // Terapkan isolasi kelas ketat jika peran adalah COUNSELOR atau flag isBk aktif
        if (user.role === 'COUNSELOR' || user.isBk) {
            const studentId = req.params.siswaId ||
                              req.params.studentId ||
                              req.params.userId ||
                              req.body.studentId ||
                              req.body.siswaId ||
                              req.body.userId ||
                              (req.query.studentId as string) ||
                              (req.query.siswaId as string) ||
                              (req.query.userId as string);

            // Jika tidak ada ID siswa spesifik (misal list/rekap global), biarkan controller memfilter via getBKKelasIds
            if (!studentId) {
                return next();
            }

            const student = await prisma.user.findUnique({
                where: { id: String(studentId) },
                select: { id: true, classId: true, className: true, name: true }
            });

            if (!student || !student.classId) {
                return res.status(404).json({
                    success: false,
                    message: 'Data siswa atau relasi kelas siswa tidak ditemukan.'
                });
            }

            // Periksa di tabel plot kelas resmi
            const hasPlot = await (prisma as any).bkKelasPlot.findFirst({
                where: {
                    guruBkId: user.id,
                    kelasId: student.classId,
                    isActive: true
                }
            });

            // Fallback backward-compatibility: periksa juga field counselorId di tabel Class jika plot belum diisi
            let isAllowed = !!hasPlot;
            if (!isAllowed) {
                const legacyClass = await prisma.class.findFirst({
                    where: {
                        id: student.classId,
                        OR: [
                            { counselorId: user.id },
                            { counselorName: user.name }
                        ]
                    }
                });
                if (legacyClass) {
                    isAllowed = true;
                }
            }

            if (!isAllowed) {
                return res.status(403).json({
                    success: false,
                    code: 'BK_ACCESS_DENIED',
                    message: `Akses Ditolak: Anda tidak mengampu kelas ${student.className || '-'}. Guru BK hanya diizinkan mengakses siswa binaan sendiri.`
                });
            }

            (req as any).siswaKelasId = student.classId;
        }

        next();
    } catch (error: any) {
        console.error('[checkBKKelasAccess Error]', error);
        return res.status(500).json({ success: false, message: 'Validasi hak akses BK gagal: ' + error.message });
    }
}

/**
 * Helper: Ambil seluruh ID kelas yang diampu oleh Guru BK login
 */
export async function getBKKelasIds(bkUserId: string): Promise<string[]> {
    try {
        const plots = await (prisma as any).bkKelasPlot.findMany({
            where: {
                guruBkId: bkUserId,
                isActive: true
            },
            select: { kelasId: true }
        });

        const plotClassIds = plots.map((p: any) => p.kelasId);

        // Tambahkan juga jika ada penugasan legacy di model Class
        const legacyClasses = await prisma.class.findMany({
            where: { counselorId: bkUserId },
            select: { id: true }
        });
        const legacyClassIds = legacyClasses.map(c => c.id);

        return Array.from(new Set([...plotClassIds, ...legacyClassIds]));
    } catch (e) {
        return [];
    }
}
