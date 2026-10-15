import { Request, Response } from 'express';
import prisma from '../utils/db';
import { logAudit } from '../services/auditLogger';
import fs from 'fs';
import path from 'path';

/**
 * =========================================================================
 * AREA 1: BANK PAKET UJIAN SEKOLAH
 * Khusus: Tryout, PTS, PAS, Asesmen, Ujian Sekolah, Ujian Akhir, Ujian Khusus
 * Hak Akses:
 * - Guru Penyusun: Ditunjuk oleh Kurikulum untuk menyusun paket & butir soal
 * - Kurikulum: Review, revisi, setujui, tetapkan siap rilis, rilis, arsip
 * - Operator/Admin: Administrasi teknis infrastruktur, TIDAK BERHAK ubah isi
 * =========================================================================
 */

// 1. Ambil Semua Paket Ujian dengan Filter Status & Kewenangan
export const getExamPackages = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { status, level, subjectId, search } = req.query;

        const isKurikulum = user && (user.role === 'ADMIN' || (user.rolesTambahan && user.rolesTambahan.includes('kurikulum')));
        const isOperator = user && (user.role === 'OPERATOR');

        const where: any = {};
        if (status && status !== 'ALL') where.status = String(status);
        if (level && level !== 'ALL') where.level = String(level);
        if (subjectId && subjectId !== 'ALL') where.subjectId = String(subjectId);
        if (search) {
            where.OR = [
                { title: { contains: String(search) } },
                { packageCode: { contains: String(search) } }
            ];
        }

        const packages = await prisma.exam.findMany({
            where,
            include: {
                subject: true,
                questions: {
                    select: {
                        id: true,
                        orderNum: true,
                        type: true,
                        content: true,
                        correctOption: true,
                        cognitiveLevel: true,
                        facilityIndex: true,
                        discriminationIndex: true,
                        qualityRating: true
                    },
                    orderBy: { orderNum: 'asc' }
                },
                packageVersions: {
                    orderBy: { version: 'desc' }
                },
                _count: {
                    select: { questions: true, studentExams: true }
                }
            },
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
        });

        // Enrich dengan metadata hak akses user saat ini
        const enriched = packages.map((pkg: any) => {
            const authorIds: string[] = pkg.authorTeacherIds ? JSON.parse(pkg.authorTeacherIds) : [];
            const reviewerIds: string[] = pkg.reviewerTeacherIds ? JSON.parse(pkg.reviewerTeacherIds) : [];
            
            const isAuthor = user ? authorIds.includes(user.id) : false;
            const isReviewer = user ? reviewerIds.includes(user.id) : false;
            const canEditContent = isAuthor || isKurikulum; // Operator tidak boleh mengedit konten soal

            return {
                ...pkg,
                authorIds,
                reviewerIds,
                isAuthor,
                isReviewer,
                canEditContent,
                isLocked: ['DIRILIS', 'AKTIF', 'SELESAI', 'NONAKTIF', 'ARSIP'].includes(pkg.status || '')
            };
        });

        res.json({ success: true, packages: enriched });
    } catch (error: any) {
        console.error('Error in getExamPackages:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat bank paket ujian: ' + error.message });
    }
};

// 2. Kurikulum Menunjuk Guru Penyusun & Reviewer Paket Ujian
export const assignExamAuthors = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { examId, authorTeacherIds, reviewerTeacherIds } = req.body;

        const isKurikulum = user && (user.role === 'ADMIN' || (user.rolesTambahan && user.rolesTambahan.includes('kurikulum')));
        if (!isKurikulum) {
            return res.status(403).json({ success: false, message: 'Hanya Kurikulum yang berhak menugaskan Guru Penyusun Ujian.' });
        }

        const exam = await prisma.exam.findUnique({ where: { id: examId } });
        if (!exam) return res.status(404).json({ success: false, message: 'Paket ujian tidak ditemukan.' });

        const updated = await prisma.exam.update({
            where: { id: examId },
            data: {
                authorTeacherIds: authorTeacherIds ? JSON.stringify(authorTeacherIds) : exam.authorTeacherIds,
                reviewerTeacherIds: reviewerTeacherIds ? JSON.stringify(reviewerTeacherIds) : exam.reviewerTeacherIds
            }
        });

        await logAudit(req, 'ASSIGN_EXAM_AUTHORS', `Penugasan penyusun paket ${exam.title}`, { authorTeacherIds, reviewerTeacherIds });

        res.json({ success: true, message: 'Guru Penyusun & Reviewer berhasil ditugaskan!', exam: updated });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Guru Penyusun Mengajukan Paket Ujian ke Kurikulum untuk Direview
export const submitExamPackageForReview = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { examId, notes } = req.body;

        const exam = await prisma.exam.findUnique({
            where: { id: examId },
            include: { _count: { select: { questions: true } } }
        });
        if (!exam) return res.status(404).json({ success: false, message: 'Paket ujian tidak ditemukan.' });

        const authorIds: string[] = exam.authorTeacherIds ? JSON.parse(exam.authorTeacherIds) : [];
        const isAuthor = user && (authorIds.includes(user.id) || exam.teacherId === user.id);
        const isKurikulum = user && (user.role === 'ADMIN' || (user.rolesTambahan && user.rolesTambahan.includes('kurikulum')));

        if (!isAuthor && !isKurikulum) {
            return res.status(403).json({ success: false, message: 'Akses ditolak: Anda bukan Guru Penyusun resmi untuk paket ujian ini.' });
        }

        if (exam._count.questions === 0) {
            return res.status(400).json({ success: false, message: 'Paket ujian masih kosong! Tambahkan soal terlebih dahulu sebelum diajukan.' });
        }

        const updated = await prisma.exam.update({
            where: { id: examId },
            data: {
                status: 'DIAJUKAN',
                curriculumNotes: notes || 'Paket diajukan oleh penyusun untuk penelaahan kurikulum.'
            }
        });

        // Buat notifikasi ke kurikulum
        const kurikulumUsers = await prisma.user.findMany({
            where: {
                OR: [
                    { role: 'ADMIN' },
                    { rolesTambahan: { contains: 'kurikulum' } }
                ]
            },
            select: { id: true }
        });

        for (const k of kurikulumUsers) {
            await prisma.notificationMessage.create({
                data: {
                    recipientId: k.id,
                    recipientRole: 'TEACHER',
                    category: 'EXAM',
                    title: `📦 Paket Ujian Baru Diajukan: ${exam.title}`,
                    message: `Guru ${user?.name || 'Penyusun'} telah mengajukan paket "${exam.title}" (${exam._count.questions} butir soal) untuk ditelaah dan diverifikasi.`
                }
            }).catch(() => null);
        }

        res.json({ success: true, message: 'Paket ujian berhasil diajukan ke Kurikulum untuk direview!', exam: updated });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. Kurikulum Menelaah & Mengubah Status Paket (Review, Revisi, Disetujui, Siap Rilis, Rilis, Arsip)
export const updateExamPackageStatus = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { examId, action, notes, qualityScore } = req.body;
        // action: 'REVIEW', 'MINTA_REVISI', 'SETUJUI', 'SIAP_RILIS', 'RILIS', 'NONAKTIF', 'ARSIP'

        const isKurikulum = user && (user.role === 'ADMIN' || (user.rolesTambahan && user.rolesTambahan.includes('kurikulum')));
        if (!isKurikulum) {
            return res.status(403).json({
                success: false,
                message: 'Akses Ditolak: Hanya Tim Kurikulum yang memiliki kewenangan review dan penetapan status paket ujian.'
            });
        }

        const exam = await prisma.exam.findUnique({
            where: { id: examId },
            include: { questions: true }
        });
        if (!exam) return res.status(404).json({ success: false, message: 'Paket ujian tidak ditemukan.' });

        let newStatus = exam.status || 'DRAFT';
        if (action === 'REVIEW') newStatus = 'REVIEW_KURIKULUM';
        else if (action === 'MINTA_REVISI') newStatus = 'REVISI';
        else if (action === 'SETUJUI') newStatus = 'DISETUJUI';
        else if (action === 'SIAP_RILIS') newStatus = 'SIAP_RILIS';
        else if (action === 'RILIS') newStatus = 'DIRILIS';
        else if (action === 'NONAKTIF') newStatus = 'NONAKTIF';
        else if (action === 'ARSIP') newStatus = 'ARSIP';

        // Jika rilis: kunci paket & rekam snapshot versi v1 atau v berikutnya
        if (action === 'RILIS') {
            const nextVersion = (exam.version || 1);
            await prisma.examPackageVersion.create({
                data: {
                    examId: exam.id,
                    version: nextVersion,
                    title: exam.title,
                    packageCode: exam.packageCode || `PKG-${exam.id.substring(0, 8).toUpperCase()}`,
                    snapshot: JSON.stringify({
                        exam,
                        questionsCount: exam.questions.length,
                        releasedAt: new Date(),
                        releasedBy: user.name
                    }),
                    notes: notes || `Versi resmi v${nextVersion} dirilis oleh Kurikulum`,
                    createdBy: user.name
                }
            });
        }

        const updated = await prisma.exam.update({
            where: { id: examId },
            data: {
                status: newStatus,
                curriculumNotes: notes || exam.curriculumNotes,
                qualityScore: qualityScore != null ? Number(qualityScore) : exam.qualityScore,
                isTokenActive: action === 'RILIS' ? true : exam.isTokenActive
            }
        });

        await logAudit(req, 'UPDATE_EXAM_PACKAGE_STATUS', `Status paket ${exam.title} diubah menjadi ${newStatus}`, { action, notes });

        res.json({
            success: true,
            message: `Status paket ujian berhasil diperbarui menjadi ${newStatus}!`,
            exam: updated
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. Buat Versi Revisi v2 Setelah Paket Dirilis (Menjaga Histori)
export const createPackageRevisionVersion = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { examId, reason } = req.body;

        const isKurikulum = user && (user.role === 'ADMIN' || (user.rolesTambahan && user.rolesTambahan.includes('kurikulum')));
        if (!isKurikulum) {
            return res.status(403).json({ success: false, message: 'Hanya Kurikulum yang dapat membuat versi revisi baru setelah rilis.' });
        }

        const exam = await prisma.exam.findUnique({
            where: { id: examId },
            include: { questions: true }
        });
        if (!exam) return res.status(404).json({ success: false, message: 'Paket tidak ditemukan.' });

        const currentVersion = exam.version || 1;
        const nextVersion = currentVersion + 1;

        // Arsipkan versi lama ke snapshot jika belum
        await prisma.examPackageVersion.create({
            data: {
                examId: exam.id,
                version: currentVersion,
                title: exam.title,
                packageCode: exam.packageCode || `PKG-${exam.id.substring(0, 8).toUpperCase()}`,
                snapshot: JSON.stringify(exam),
                notes: `Snapshot versi v${currentVersion} sebelum dinaikkan ke v${nextVersion}: ${reason || '-'}`,
                createdBy: user.name
            }
        });

        // Buka kembali status untuk revisi
        const updated = await prisma.exam.update({
            where: { id: examId },
            data: {
                version: nextVersion,
                status: 'REVISI',
                curriculumNotes: `Versi Revisi v${nextVersion}: ${reason || 'Perbaikan soal oleh kurikulum/penyusun'}`
            }
        });

        res.json({
            success: true,
            message: `Versi revisi v${nextVersion} berhasil dibuka! Guru penyusun dapat memperbarui soal dengan histori tetap tersimpan.`,
            exam: updated
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * =========================================================================
 * AREA 2: BANK TUGAS & PR GURU (KOLABORASI MAPEL + LEVEL KELAS)
 * Contoh: PAI Kelas VII otomatis berkolaborasi dengan guru PAI Kelas VII
 * Salin Tugas (Clone) & Modifikasi tanpa merusak tugas asli
 * =========================================================================
 */

// 1. Ambil Bank Tugas & PR Sesuai Kolaborasi Mapel + Level
export const getCollaborativeHomeworks = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { subjectName, level, scope, search } = req.query;

        const where: any = {};
        if (subjectName && subjectName !== 'ALL') where.subjectName = String(subjectName);
        if (level && level !== 'ALL') where.level = String(level);
        if (search) {
            where.OR = [
                { title: { contains: String(search) } },
                { description: { contains: String(search) } }
            ];
        }

        const selectedScope = String(scope || 'LEVEL_SUBJECT').toUpperCase();

        if (selectedScope === 'MY') {
            if (user?.id) where.teacherId = user.id;
        } else if (selectedScope === 'LEVEL_SUBJECT') {
            // Kolaborasi guru mapel + level yang sama
            where.sharedScope = { in: ['LEVEL_SUBJECT', 'SCHOOL'] };
        } else if (selectedScope === 'TEMPLATES') {
            where.isTemplate = true;
        }

        const homeworks = await prisma.homework.findMany({
            where,
            include: {
                class: { select: { id: true, name: true } },
                subject: { select: { id: true, name: true } },
                _count: { select: { submissions: true } }
            },
            orderBy: [{ isTemplate: 'desc' }, { createdAt: 'desc' }]
        });

        res.json({ success: true, homeworks });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Salin (Clone) Tugas Guru Lain untuk Digunakan Sendiri di Kelas Berbeda
export const cloneHomework = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { homeworkId, targetClassId, customTitle, customDeadline } = req.body;

        const source = await prisma.homework.findUnique({
            where: { id: homeworkId },
            include: { class: true }
        });
        if (!source) return res.status(404).json({ success: false, message: 'Tugas sumber tidak ditemukan.' });

        const targetClass = targetClassId ? await prisma.class.findUnique({ where: { id: targetClassId } }) : source.class;

        const cloned = await prisma.homework.create({
            data: {
                title: customTitle || `${source.title} (Salinan ${targetClass?.name || ''})`,
                description: source.description,
                subjectId: source.subjectId,
                classId: targetClass?.id || source.classId,
                deadline: customDeadline ? new Date(customDeadline) : new Date(Date.now() + 7 * 24 * 3600 * 1000),
                questions: source.questions,
                fileUrl: source.fileUrl,
                audioUrl: source.audioUrl,
                weight: source.weight,
                category: source.category,
                type: source.type,
                level: source.level,
                subjectName: source.subjectName,
                sharedScope: 'PRIVATE',
                isTemplate: false,
                originalHomeworkId: source.id,
                originalTeacherName: source.teacherId,
                teacherId: user?.id || 'GURU_PEMILIK',
                status: 'PUBLISHED'
            }
        });

        // Tingkatkan counter clone pada tugas asli
        await prisma.homework.update({
            where: { id: source.id },
            data: { cloneCount: { increment: 1 } }
        }).catch(() => {});

        res.json({
            success: true,
            message: `Tugas berhasil disalin ke kelas ${targetClass?.name || ''}! Anda dapat mengedit tanpa mengubah tugas asli.`,
            homework: cloned
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * =========================================================================
 * AREA 3: TRANSFER FILE SOAL ANTAR GURU (APK & PORTAL SINKRON)
 * - Kirim file (Word, Excel, PDF, ZIP, Gambar)
 * - Kirim butir soal langsung / transfer paket soal
 * - Kotak Masuk (Terima / Tolak / Simpan ke Bank Soal)
 * - Riwayat Transfer & Audit
 * =========================================================================
 */

// 1. Kirim File Soal atau Paket Soal ke Guru Tertentu / Guru Mapel Level Sama
export const sendFileOrQuestions = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const {
            receiverId,
            receiverName,
            targetSubject,
            targetLevel,
            transferType,
            fileName,
            fileUrl,
            fileSize,
            fileType,
            questionPayload,
            questionCount,
            notes
        } = req.body;

        if (!user) return res.status(401).json({ success: false, message: 'Harap login terlebih dahulu.' });

        const transfer = await prisma.teacherFileTransfer.create({
            data: {
                senderId: user.id,
                senderName: user.name,
                receiverId: receiverId || null,
                receiverName: receiverName || null,
                targetSubject: targetSubject || user.teachingSubject || null,
                targetLevel: targetLevel || null,
                transferType: transferType || 'FILE',
                fileName: fileName || null,
                fileUrl: fileUrl || null,
                fileSize: fileSize ? Number(fileSize) : null,
                fileType: fileType || 'Dokumen',
                questionPayload: questionPayload ? (typeof questionPayload === 'string' ? questionPayload : JSON.stringify(questionPayload)) : null,
                questionCount: questionCount ? Number(questionCount) : 0,
                status: 'PENDING',
                notes: notes || null
            }
        });

        // Kirim notifikasi ke penerima
        if (receiverId) {
            await prisma.notificationMessage.create({
                data: {
                    recipientId: receiverId,
                    recipientRole: 'TEACHER',
                    category: 'ACADEMIC',
                    title: `📥 ${user.name} Mengirimkan ${transferType === 'FILE' ? 'Berkas Soal' : 'Paket Soal'}`,
                    message: `${user.name} mengirimkan ${fileName || (questionCount + ' butir soal')} untuk mata pelajaran ${targetSubject || '-'}. Buka Kotak Masuk untuk menerima atau mengunduh.`
                }
            }).catch(() => null);
        }

        res.json({
            success: true,
            message: `Transfer soal/file berhasil dikirimkan ke ${receiverName || 'Grup Guru Mapel'}!`,
            transfer
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Kotak Masuk Transfer Guru (Diterima & Terkirim)
export const getTeacherTransferInbox = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const [received, sent] = await Promise.all([
            prisma.teacherFileTransfer.findMany({
                where: {
                    OR: [
                        { receiverId: user.id },
                        {
                            receiverId: null,
                            targetSubject: user.teachingSubject || undefined
                        }
                    ]
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.teacherFileTransfer.findMany({
                where: { senderId: user.id },
                orderBy: { createdAt: 'desc' }
            })
        ]);

        res.json({
            success: true,
            received,
            sent,
            unreadCount: received.filter(r => r.status === 'PENDING').length
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Respon Transfer: Terima ke Bank Soal / Simpan ke Tugas / Tolak
export const respondToTransfer = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { transferId, action, targetFolder } = req.body; // action: 'ACCEPT' | 'REJECT' | 'DOWNLOAD'

        const transfer = await prisma.teacherFileTransfer.findUnique({ where: { id: transferId } });
        if (!transfer) return res.status(404).json({ success: false, message: 'Transfer tidak ditemukan.' });

        if (action === 'REJECT') {
            await prisma.teacherFileTransfer.update({
                where: { id: transferId },
                data: { status: 'REJECTED', respondedAt: new Date() }
            });
            return res.json({ success: true, message: 'Transfer ditolak.' });
        }

        // Jika diterima dan berupa butir soal: langsung masukkan ke BankSoal guru penerima
        if (action === 'ACCEPT' && transfer.questionPayload) {
            try {
                const parsed = JSON.parse(transfer.questionPayload);
                const items = Array.isArray(parsed) ? parsed : (parsed.questions || []);

                for (const item of items) {
                    await prisma.bankSoal.create({
                        data: {
                            subjectName: transfer.targetSubject || 'Umum',
                            level: transfer.targetLevel || 'ALL',
                            type: item.type || 'PG',
                            content: item.content || item.text || item.questionText || '',
                            options: typeof item.options === 'string' ? item.options : JSON.stringify(item.options || []),
                            correctOption: item.correctOption || 'A',
                            explanation: item.explanation || '',
                            teacherId: user.id,
                            originalTeacherId: transfer.senderId,
                            originalTeacherName: transfer.senderName,
                            visibility: 'PRIVATE',
                            verificationStatus: 'DRAFT'
                        }
                    });
                }
            } catch (e) {
                console.error('Error importing questions from transfer payload:', e);
            }
        }

        const updated = await prisma.teacherFileTransfer.update({
            where: { id: transferId },
            data: {
                status: action === 'ACCEPT' ? 'ACCEPTED' : 'DOWNLOADED',
                respondedAt: new Date()
            }
        });

        res.json({
            success: true,
            message: action === 'ACCEPT' ? 'Soal berhasil disimpan ke Bank Soal Saya!' : 'Status berkas diperbarui!',
            transfer: updated
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
