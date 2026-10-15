import prisma from './db';
import bcrypt from 'bcrypt';

interface StudentData {
    id?: string;
    name: string;
    nisn?: string | null;
    className?: string | null;
    parentPhone?: string | null;
}

/**
 * Otomatis membuat atau memperbarui akun Orang Tua (PARENT) berdasarkan NISN siswa.
 * Username: P[NISN] (contoh: P131412082)
 * Password default: [NISN] (contoh: 131412082)
 * Jika NISN berubah, username & password orang tua otomatis diupdate mengikuti NISN baru.
 */
export async function syncParentAccountForStudent(student: StudentData, oldNisn?: string | null): Promise<any> {
    try {
        const cleanOldNisn = oldNisn ? String(oldNisn).trim() : null;
        const cleanNewNisn = student.nisn ? String(student.nisn).trim() : null;

        // 1. Jika terjadi perubahan NISN dan ada NISN lama yang berbeda
        if (cleanOldNisn && cleanNewNisn && cleanOldNisn !== cleanNewNisn) {
            const oldParentUsername = 'P' + cleanOldNisn;
            const newParentUsername = 'P' + cleanNewNisn;

            const existingOldParent = await prisma.user.findUnique({
                where: { username: oldParentUsername }
            });

            if (existingOldParent) {
                const newHashedPassword = await bcrypt.hash(cleanNewNisn, 10);
                const updatedParent = await prisma.user.update({
                    where: { id: existingOldParent.id },
                    data: {
                        username: newParentUsername,
                        password: newHashedPassword,
                        name: student.name,
                        className: student.className || null,
                        parentPhone: student.parentPhone || null,
                        nisn: cleanNewNisn,
                        isActive: true
                    }
                });
                console.log(`[PARENT SYNC] Updated parent username from ${oldParentUsername} to ${newParentUsername} for student ${student.name}`);
                return updatedParent;
            }
        }

        // 2. Jika ada NISN baru / saat pembuatan siswa baru atau sync
        if (cleanNewNisn && cleanNewNisn.length > 0) {
            const parentUsername = 'P' + cleanNewNisn;
            const parentPassword = cleanNewNisn;
            const hashedPassword = await bcrypt.hash(parentPassword, 10);

            const parentUser = await prisma.user.upsert({
                where: { username: parentUsername },
                update: {
                    name: student.name,
                    className: student.className || null,
                    parentPhone: student.parentPhone || null,
                    nisn: cleanNewNisn,
                    isActive: true
                },
                create: {
                    username: parentUsername,
                    password: hashedPassword,
                    name: student.name,
                    role: 'PARENT',
                    className: student.className || null,
                    parentPhone: student.parentPhone || null,
                    nisn: cleanNewNisn,
                    isActive: true
                }
            });

            console.log(`[PARENT SYNC] Created/Verified parent ${parentUsername} for student ${student.name}`);
            return parentUser;
        }

        return null;
    } catch (error) {
        console.error(`[PARENT SYNC ERROR] Failed syncing parent for student ${student.name}:`, error);
        return null;
    }
}

/**
 * Sinkronisasi massal seluruh akun orang tua untuk seluruh siswa aktif di database yang memiliki NISN
 */
export async function syncAllExistingParents(): Promise<{ totalStudents: number; parentsCreatedOrUpdated: number }> {
    try {
        const students = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                nisn: { not: null }
            },
            select: {
                id: true,
                name: true,
                nisn: true,
                className: true,
                parentPhone: true
            }
        });

        let count = 0;
        for (const s of students) {
            if (s.nisn && s.nisn.trim().length > 0) {
                const res = await syncParentAccountForStudent(s);
                if (res) count++;
            }
        }

        console.log(`[PARENT SYNC COMPLETE] Synced ${count} parent accounts for ${students.length} students.`);
        return { totalStudents: students.length, parentsCreatedOrUpdated: count };
    } catch (e) {
        console.error('[PARENT SYNC ERROR] Batch sync failed:', e);
        return { totalStudents: 0, parentsCreatedOrUpdated: 0 };
    }
}
