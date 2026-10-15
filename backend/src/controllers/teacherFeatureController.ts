import { Request, Response } from 'express';
import prisma from '../utils/db';
import crypto from 'crypto';
import { sendFcmToUser } from '../services/fcmService';
import { formatTimeWibWithSuffix } from '../utils/dateUtils';

export const getTeacherTodaySchedule = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const teacherName = user?.name || 'Guru';
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const now = new Date();
        const currentDay = days[now.getDay()];
        const currentTimeStr = now.toTimeString().substring(0, 5);
        const reqDay = req.query.day ? String(req.query.day).trim() : null;

        // If today is weekend (Minggu / Sabtu) and no specific day requested, default to 'Senin'
        const isWeekend = (currentDay === 'Minggu' || currentDay === 'Sabtu');
        let selectedDay = reqDay || (isWeekend ? 'Senin' : currentDay);

        // Fetch all schedules for this teacher across all days
        const allDbSchedules = await (prisma as any).classPeriodSchedule.findMany({
            where: {
                isBreak: false,
                OR: [
                    { teacherId: user?.id },
                    { teacherName: { contains: user?.name || '' } }
                ]
            },
            orderBy: [{ day: 'asc' }, { periodIndex: 'asc' }]
        });

        // Compute count per day and assigned classes
        const dayCounts: Record<string, number> = {
            'Senin': 0, 'Selasa': 0, 'Rabu': 0, 'Kamis': 0, 'Jumat': 0
        };
        const assignedClassesSet = new Set<string>();

        for (const s of allDbSchedules) {
            if (s.day && dayCounts[s.day] !== undefined) {
                dayCounts[s.day]++;
            }
            if (s.className) {
                assignedClassesSet.add(s.className);
            }
        }

        // Filter schedules for the selected day or ALL
        const targetSchedules = selectedDay.toUpperCase() === 'ALL'
            ? allDbSchedules
            : allDbSchedules.filter((s: any) => s.day.toLowerCase() === selectedDay.toLowerCase());

        let schedules = [];
        for (const s of targetSchedules) {
            const totalStudents = await prisma.user.count({
                where: { role: 'STUDENT', className: s.className }
            });
            const isToday = (currentDay.toLowerCase() === s.day.toLowerCase());
            const isActive = isToday && (currentTimeStr >= s.startTime && currentTimeStr <= s.endTime);
            schedules.push({
                id: s.id,
                day: s.day,
                periodIndex: s.periodIndex,
                className: s.className,
                subject: s.subjectName,
                timeRange: `${s.startTime} - ${s.endTime}`,
                startTime: s.startTime,
                endTime: s.endTime,
                room: s.roomName || `Ruang Kelas ${s.className}`,
                totalStudents: totalStudents || 32,
                status: isActive ? 'ACTIVE' : (isToday && currentTimeStr < s.startTime ? 'UPCOMING' : 'SCHEDULED'),
                isToday
            });
        }

        res.json({
            success: true,
            teacherName,
            currentDay,
            selectedDay,
            isWeekend,
            currentTime: currentTimeStr,
            schedules,
            weeklyDays: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'],
            dayCounts,
            assignedClasses: Array.from(assignedClassesSet)
        });
    } catch (error) {
        console.error('Error fetching teacher schedule:', error);
        res.status(500).json({ message: 'Gagal memuat jadwal guru' });
    }
};

export const generateDynamicQr = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { className, subjectName } = req.body;

        if (!className) {
            return res.status(400).json({ message: 'Kelas wajib dipilih' });
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 15 * 1000);
        const randomSalt = crypto.randomBytes(8).toString('hex');
        const tokenString = 'CBT_QR_' + className + '_' + now.getTime() + '_' + randomSalt;

        await (prisma as any).dynamicQrSession.create({
            data: {
                teacherId: user?.id || 'teacher-1',
                className,
                subjectName: subjectName || 'Mata Pelajaran',
                qrToken: tokenString,
                expiresAt,
                isActive: true
            }
        });

        res.json({
            qrToken: tokenString,
            refreshIntervalSeconds: 10,
            expiresAt: expiresAt.toISOString(),
            className,
            timestamp: now.getTime()
        });
    } catch (error) {
        console.error('Error generating dynamic QR:', error);
        res.status(500).json({ message: 'Gagal membuat QR Code dinamis' });
    }
};

export const scanStudentDynamicQr = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { qrToken } = req.body;

        if (!qrToken) {
            return res.status(400).json({ message: 'QR Token wajib disertakan' });
        }

        const qrSession = await (prisma as any).dynamicQrSession.findUnique({
            where: { qrToken }
        });

        if (!qrSession) {
            return res.status(400).json({ message: '❌ QR Code tidak valid atau sudah kadaluarsa.' });
        }

        if (new Date() > new Date(qrSession.expiresAt)) {
            return res.status(400).json({ message: '⏱️ QR Code sudah berganti. Silakan scan QR terbaru di layar HP Guru.' });
        }

        // Validasi: Siswa hanya dapat scan presensi di rombel kelasnya sendiri
        if (user.className && qrSession.className && user.className.trim().toUpperCase() !== qrSession.className.trim().toUpperCase()) {
            return res.status(403).json({
                message: `❌ Presensi Ditolak! Anda terdaftar di kelas ${user.className}. Anda tidak dapat melakukan presensi di kelas ${qrSession.className}.`
            });
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const existingAttendance = await prisma.attendance.findFirst({
            where: {
                userId: user.id,
                type: 'CLASS_ATTENDANCE',
                scanTime: {
                    gte: startOfDay,
                    lte: endOfDay
                },
                note: { contains: qrSession.className }
            }
        });

        if (!existingAttendance) {
            await prisma.attendance.create({
                data: {
                    userId: user.id,
                    type: 'CLASS_ATTENDANCE',
                    method: 'QR_DYNAMIC_TEACHER',
                    status: 'PRESENT',
                    note: 'Presensi Matpel: ' + qrSession.subjectName + ' (' + qrSession.className + ') - Dinamis 10s'
                }
            });
        }

        res.json({
            message: '✅ Berhasil Presensi di Kelas ' + qrSession.className + ' - ' + qrSession.subjectName + '! Status: HADIR TEPAT WAKTU.',
            className: qrSession.className,
            studentName: user.name,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error recording QR scan:', error);
        res.status(500).json({ message: 'Gagal memproses presensi scan QR' });
    }
};

export const quickMarkAllAttendance = async (req: Request, res: Response) => {
    try {
        const { className, subjectName } = req.body;
        const currentUser = (req as any).user;

        if (!className) {
            return res.status(400).json({ message: 'Kelas wajib dipilih' });
        }

        // Validasi: Guru harus sudah presensi MASUK dan aktif mengajar di kelas ini
        if (currentUser && currentUser.role === 'TEACHER') {
            const activeSession = await (prisma as any).teachingSession.findFirst({
                where: {
                    teacherId: currentUser.id,
                    status: 'IN_PROGRESS',
                    className
                }
            });

            if (!activeSession) {
                return res.status(403).json({
                    success: false,
                    message: `⚠️ Anda belum melakukan Presensi Masuk KBM di kelas ${className}. Silakan mulai sesi mengajar di kelas terlebih dahulu sebelum melakukan presensi siswa.`
                });
            }
        }

        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className }
        });

        if (students.length === 0) {
            return res.status(404).json({ message: 'Tidak ada data siswa di kelas ' + className });
        }

        for (const s of students) {
            await prisma.attendance.create({
                data: {
                    userId: s.id,
                    type: 'CLASS_ATTENDANCE',
                    method: 'ONE_CLICK_TEACHER',
                    status: 'PRESENT',
                    note: 'Presensi 1-Klik Guru: ' + (subjectName || 'Matpel') + ' (' + className + ')'
                }
            });
        }

        req.app.get('io')?.emit('attendance_updated', { className, type: 'QUICK_ALL_PRESENT' });

        res.json({
            message: '✅ Sukses! Seluruh ' + students.length + ' siswa di kelas ' + className + ' telah ditandai HADIR.',
            totalMarked: students.length,
            className
        });
    } catch (error) {
        console.error('Error quick mark attendance:', error);
        res.status(500).json({ message: 'Gagal melakukan absensi 1-klik' });
    }
};

export const updateSingleStudentAttendance = async (req: Request, res: Response) => {
    try {
        const { studentId, status, note, className } = req.body;
        const currentUser = (req as any).user;

        if (!studentId || !status) {
            return res.status(400).json({ message: 'studentId dan status wajib diisi' });
        }

        // Validasi: Guru harus sudah presensi MASUK dan aktif mengajar di kelas jika role TEACHER
        if (currentUser && currentUser.role === 'TEACHER' && className) {
            const activeSession = await (prisma as any).teachingSession.findFirst({
                where: {
                    teacherId: currentUser.id,
                    status: 'IN_PROGRESS',
                    className
                }
            });

            if (!activeSession) {
                return res.status(403).json({
                    success: false,
                    message: `⚠️ Anda belum melakukan Presensi Masuk KBM di kelas ${className}. Silakan mulai sesi mengajar di kelas terlebih dahulu sebelum memperbarui presensi siswa.`
                });
            }
        }

        await prisma.attendance.create({
            data: {
                userId: studentId,
                type: 'CLASS_ATTENDANCE',
                method: 'MANUAL_TEACHER',
                status,
                note: note || 'Presensi Guru di Kelas ' + (className || '-')
            }
        });

        // Notifikasi Otomatis ke Orang Tua jika status Sakit, Izin, Alpa, atau Terlambat
        if (status === 'SICK' || status === 'PERMISSION' || status === 'ABSENT' || status === 'LATE') {
            const student = await prisma.user.findUnique({ where: { id: studentId } });
            if (student) {
                const cleanNisn = (student.nisn || student.username || '').replace(/^[Pp]/, '').trim();
                const statusMap: Record<string, string> = {
                    SICK: 'Izin Sakit',
                    PERMISSION: 'Izin Keperluan',
                    ABSENT: 'Alpa / Tidak Hadir',
                    LATE: 'Terlambat Masuk Kelas'
                };
                const statusLabel = statusMap[status] || status;
                const notifTitle = `📋 [SIBOY KBM] Presensi Siswa: Tercatat ${statusLabel}`;
                const notifMsg = `Yth. Orang Tua / Wali dari ananda ${student.name} (Kelas ${className || student.className || '-'}):\n\n` +
                    `Diberitahukan bahwa pada jam pembelajaran di kelas hari ini, ananda tercatat: ${statusLabel}.\n` +
                    `• Keterangan: ${note || '-'}\n` +
                    `• Waktu Pencatatan: ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB\n\n` +
                    `Catatan kehadiran ini telah diverifikasi langsung oleh Guru Pengampu di kelas.`;

                await (prisma as any).notificationMessage.create({
                    data: {
                        studentId: student.id,
                        studentName: student.name,
                        className: className || student.className,
                        recipientPhone: student.parentPhone,
                        recipientRole: 'PARENT',
                        title: notifTitle,
                        message: notifMsg,
                        category: 'ATTENDANCE'
                    }
                }).catch(() => null);

                const parentUsers = await prisma.user.findMany({
                    where: {
                        role: 'PARENT',
                        OR: [
                            { username: `P${cleanNisn}` },
                            { username: `p${cleanNisn}` },
                            { username: cleanNisn },
                            { nisn: cleanNisn },
                            ...(student.parentPhone ? [{ username: student.parentPhone }] : [])
                        ]
                    }
                });

                for (const p of parentUsers) {
                    sendFcmToUser(p.id, notifTitle, notifMsg, {
                        type: 'CLASS_ATTENDANCE',
                        status,
                        studentId: student.id
                    }).catch(() => null);
                }
            }
        }

        req.app.get('io')?.emit('attendance_updated', { studentId, status, className });

        res.json({ message: '✅ Status absensi siswa berhasil diubah menjadi: ' + status });
    } catch (error) {
        console.error('Error updating single attendance:', error);
        res.status(500).json({ message: 'Gagal memperbarui absensi siswa' });
    }
};

export const createTeachingJournal = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { className, subjectName, topic, competencyCode, description, photoUrl, presentCount, absentCount, lateCount } = req.body;

        if (!className || !topic || !description) {
            return res.status(400).json({ message: 'Kelas, Topik Materi, dan Uraian Jurnal wajib diisi' });
        }

        const journal = await (prisma as any).teacherJournal.create({
            data: {
                teacherId: user?.id || 'teacher-1',
                teacherName: user?.name || 'Guru Pengampu',
                className,
                subjectName: subjectName || 'Mata Pelajaran',
                topic,
                competencyCode: competencyCode || 'KD 3.1',
                description,
                photoUrl: photoUrl || null,
                presentCount: Number(presentCount) || 30,
                absentCount: Number(absentCount) || 0,
                lateCount: Number(lateCount) || 0
            }
        });

        res.json({
            message: '📘 Jurnal mengajar harian berhasil disimpan ke sistem administrasi sertifikasi guru!',
            journal
        });
    } catch (error) {
        console.error('Error creating teaching journal:', error);
        res.status(500).json({ message: 'Gagal menyimpan jurnal mengajar' });
    }
};

export const getTeachingJournals = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const journals = await (prisma as any).teacherJournal.findMany({
            where: { teacherId: user?.id || 'teacher-1' },
            orderBy: { teachingDate: 'desc' }
        });

        res.json(journals);
    } catch (error) {
        console.error('Error fetching teaching journals:', error);
        res.status(500).json({ message: 'Gagal memuat riwayat jurnal' });
    }
};

export const broadcastToClass = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { className, title, message } = req.body;

        if (!className || !title || !message) {
            return res.status(400).json({ message: 'Kelas, Judul, dan Pesan Pengumuman wajib diisi' });
        }

        const announcement = await prisma.announcement.create({
            data: {
                title: '[' + className + '] ' + title,
                content: message,
                category: 'PENTING',
                author: 'Guru Matpel (' + (user?.name || 'Guru') + ')',
                isPinned: true
            }
        });

        res.json({
            message: '📢 Pengumuman berhasil dibroadcast langsung ke seluruh siswa Kelas ' + className + '!',
            announcement
        });
    } catch (error) {
        console.error('Error broadcasting announcement:', error);
        res.status(500).json({ message: 'Gagal mengirim pengumuman kelas' });
    }
};

// 7. Modul E-File & Dokumen Guru Mandiri
// 7. Modul E-File & Dokumen Guru (Dua Arah: File Saya & File Masuk)
export const getTeacherEFiles = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user || !user.id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const files = await prisma.eFile.findMany({
            where: { userId: user.id },
            orderBy: { uploadedAt: 'desc' }
        });

        const mapItem = (f: any) => ({
            id: f.id,
            title: f.title,
            category: f.category,
            fileUrl: f.fileUrl,
            fileSize: f.fileSize || '1.0 MB',
            fileType: f.fileType || (f.fileUrl.endsWith('.pdf') ? 'PDF' : 'IMAGE'),
            description: f.description || '',
            isFromAdmin: Boolean(f.isFromAdmin),
            senderName: f.senderName || (f.isFromAdmin ? 'Operator Sekolah' : user.name),
            source: f.source || 'Tata Usaha',
            period: f.period || 'Insidental',
            isRead: Boolean(f.isRead),
            readAt: f.readAt ? f.readAt.toISOString() : null,
            uploadedAt: f.uploadedAt.toISOString()
        });

        const myFiles = files.filter(f => !f.isFromAdmin).map(mapItem);
        const incomingFiles = files.filter(f => Boolean(f.isFromAdmin)).map(mapItem);
        const unreadCount = incomingFiles.filter(f => !f.isRead).length;

        res.json({
            success: true,
            teacherName: user.name,
            count: files.length,
            unreadIncomingCount: unreadCount,
            myFiles,
            incomingFiles,
            files: files.map(mapItem) // Full backward compatibility
        });
    } catch (error) {
        console.error('Error fetching teacher e-files:', error);
        res.status(500).json({ message: 'Gagal memuat berkas e-file guru' });
    }
};

export const markTeacherEFileAsRead = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = String(req.params.id);
        if (!user || !user.id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        await prisma.eFile.updateMany({
            where: { id, userId: user.id },
            data: { isRead: true, readAt: new Date() }
        });

        res.json({
            success: true,
            message: '✅ Berkas telah ditandai sudah dibaca'
        });
    } catch (error: any) {
        console.error('Error marking e-file as read:', error);
        res.status(500).json({ message: 'Gagal menandai berkas: ' + error.message });
    }
};

export const uploadTeacherEFile = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user || !user.id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const {
            title,
            category,
            fileBase64,
            fileName,
            description,
            period,
            source,
            targetType,
            targetTeacherId,
            targetClass,
            teacherId
        } = req.body;

        if (!title || !fileBase64) {
            return res.status(400).json({ message: 'Judul dokumen dan file wajib diisi.' });
        }

        // Tentukan daftar target ID penerima (SINGLE, ALL, atau CLASS)
        let targetTeacherIds: string[] = [];
        const isFromAdmin = user.role === 'ADMIN' || user.role === 'OPERATOR';

        if (isFromAdmin) {
            if (targetType === 'ALL') {
                const allTeachers = await prisma.user.findMany({
                    where: { role: 'TEACHER' },
                    select: { id: true }
                });
                targetTeacherIds = allTeachers.map(t => t.id);
            } else if (targetType === 'CLASS' && targetClass) {
                const isTingkat = targetClass.startsWith('TINGKAT_') || targetClass === 'VII' || targetClass === 'VIII' || targetClass === 'IX';
                const gradePrefix = targetClass.replace('TINGKAT_', '');
                
                let whereClause: any = { role: 'TEACHER' };
                if (isTingkat) {
                    whereClause.OR = [
                        { teachingClasses: { contains: gradePrefix } },
                        { className: { startsWith: gradePrefix } },
                        // If teacher has no specific class set, include all active teachers so nobody misses the announcement
                        { teachingClasses: null }
                    ];
                } else {
                    whereClause.OR = [
                        { teachingClasses: { contains: targetClass } },
                        { className: targetClass }
                    ];
                }

                let classTeachers = await prisma.user.findMany({
                    where: whereClause,
                    select: { id: true }
                });

                // Fallback to all teachers if none specifically matched
                if (classTeachers.length === 0) {
                    classTeachers = await prisma.user.findMany({
                        where: { role: 'TEACHER' },
                        select: { id: true }
                    });
                }
                targetTeacherIds = classTeachers.map(t => t.id);
            } else if (targetTeacherId || teacherId) {
                targetTeacherIds = [String(targetTeacherId || teacherId)];
            } else {
                targetTeacherIds = [user.id];
            }
        } else {
            targetTeacherIds = [user.id];
        }

        if (targetTeacherIds.length === 0) {
            return res.status(404).json({ message: 'Tidak ditemukan guru penerima untuk target ini.' });
        }

        const path = await import('path');
        const fs = await import('fs');

        const uploadDir = path.resolve(process.cwd(), 'uploads/teacher_files');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const ext = path.extname(fileName || '.pdf') || '.pdf';
        const isPdf = ext.toLowerCase() === '.pdf';
        const safeName = `efile_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
        const targetPath = path.join(uploadDir, safeName);
        const cleanBase64 = String(fileBase64).replace(/^data:.*?;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        fs.writeFileSync(targetPath, buffer);

        const sizeInMb = (buffer.length / (1024 * 1024)).toFixed(1);
        const sizeStr = buffer.length > 1024 * 1024 ? `${sizeInMb} MB` : `${Math.round(buffer.length / 1024)} KB`;

        const senderInfo = isFromAdmin ? (user.name || 'Operator Sekolah') : user.name;
        const docSource = source || (isFromAdmin ? 'Tata Usaha' : 'Mandiri Guru');
        const docPeriod = period || 'Insidental';

        const createdFiles = [];
        for (const tId of targetTeacherIds) {
            const newFile = await prisma.eFile.create({
                data: {
                    userId: tId,
                    title,
                    category: category || (isFromAdmin ? 'SURAT_TUGAS' : 'MODUL_AJAR'),
                    fileUrl: `/uploads/teacher_files/${safeName}`,
                    fileSize: sizeStr,
                    fileType: isPdf ? 'PDF' : 'IMAGE',
                    description: description || '',
                    isFromAdmin: isFromAdmin,
                    senderName: senderInfo,
                    source: docSource,
                    period: docPeriod,
                    isRead: !isFromAdmin // File mandiri guru otomatis dianggap sudah dibaca oleh diri sendiri
                }
            });
            createdFiles.push(newFile);
        }

        res.json({
            success: true,
            message: isFromAdmin
                ? `✅ Berkas "${title}" berhasil didistribusikan ke ${createdFiles.length} Guru!`
                : `✅ Berkas "${title}" berhasil disimpan ke File Saya!`,
            count: createdFiles.length,
            data: createdFiles[0]
        });
    } catch (error: any) {
        console.error('Error uploading teacher e-file:', error);
        res.status(500).json({ message: 'Gagal mengunggah berkas guru: ' + error.message });
    }
};

export const deleteTeacherEFile = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = String(req.params.id);

        if (!user || !user.id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const efile = await prisma.eFile.findUnique({ where: { id } });
        if (!efile) {
            return res.status(404).json({ message: 'Dokumen tidak ditemukan.' });
        }

        if (efile.userId !== user.id && user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Anda tidak memiliki hak untuk menghapus dokumen ini.' });
        }

        try {
            const path = await import('path');
            const fs = await import('fs');
            const fullPath = path.resolve(process.cwd(), efile.fileUrl.replace(/^\//, ''));
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        } catch (e) {
            console.warn('File removal warning:', e);
        }

        await prisma.eFile.delete({ where: { id } });

        res.json({
            success: true,
            message: '🗑️ Dokumen guru berhasil dihapus dari E-File.'
        });
    } catch (error: any) {
        console.error('Error deleting teacher e-file:', error);
        res.status(500).json({ message: 'Gagal menghapus dokumen guru: ' + error.message });
    }
};

// 1. Mengambil Daftar Kelas yang Diampu Guru Beserta Jumlah Siswa
export const getTeacherClasses = async (req: Request, res: Response) => {
    try {
        const tokenUser = (req as any).user;
        const user = await prisma.user.findUnique({ where: { id: tokenUser.id } }) || tokenUser;
        const todayOnly = req.query.todayOnly === 'true' || req.query.today === 'true';
        let classesList: string[] = [];

        if (todayOnly) {
            const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
            const todayDayName = dayNames[new Date().getDay()];

            // Cari kelas yang dijadwalkan diajar oleh guru ini hari ini
            const todaySchedules = await prisma.classPeriodSchedule.findMany({
                where: {
                    day: todayDayName,
                    OR: [
                        { teacherId: user.id },
                        { teacherName: { contains: user.name } }
                    ]
                }
            });

            const scheduledClasses = Array.from(new Set(todaySchedules.map(s => s.className).filter(Boolean)));
            if (scheduledClasses.length > 0) {
                classesList = scheduledClasses;
            }
        }

        if (classesList.length === 0) {
            // 1. Dari field teachingClasses database
            if (user.teachingClasses && user.teachingClasses.trim() !== '' && user.teachingClasses !== 'OPERATOR') {
                classesList = user.teachingClasses.split(',').map((c: string) => c.trim()).filter(Boolean);
            }

            // 2. Dari seluruh jadwal mengajar di classPeriodSchedule
            if (classesList.length === 0) {
                const allSchedules = await prisma.classPeriodSchedule.findMany({
                    where: {
                        OR: [
                            { teacherId: user.id },
                            { teacherName: { contains: user.name } }
                        ]
                    },
                    select: { className: true }
                });
                classesList = Array.from(new Set(allSchedules.map(s => s.className).filter(Boolean)));
            }

            // 3. Dari kelas binaan wali kelas
            if (user.className && user.className.trim() !== '' && user.className.trim() !== '-' && !classesList.includes(user.className)) {
                classesList.unshift(user.className);
            }

            // 4. Dari siswa binaan homeroomTeacher
            const walasStudents = await prisma.user.findMany({
                where: { role: 'STUDENT', homeroomTeacher: user.name },
                select: { className: true },
                distinct: ['className']
            });
            for (const ws of walasStudents) {
                if (ws.className && !classesList.includes(ws.className)) {
                    classesList.unshift(ws.className);
                }
            }

            // 5. Jika Kurikulum, Kepala Sekolah, Admin, atau Operator dan masih kosong, berikan seluruh 33 rombel
            const isKurikulum = (user.tugasTambahan || '').includes('KURIKULUM') || (user.rolesTambahan || '').includes('kurikulum') || user.role === 'KURIKULUM' || (user.name || '').toLowerCase().includes('sidik');
            const isHeadmaster = user.teachingSubject === 'Kepala Sekolah' || (user.name || '').includes('Adi Sutignyo');
            if (classesList.length === 0 && (isKurikulum || isHeadmaster || user.role === 'ADMIN' || user.role === 'OPERATOR')) {
                const allClasses = await prisma.class.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
                classesList = allClasses.map(c => c.name);
            }
        }

        const classesWithStats = await Promise.all(classesList.map(async (cls) => {
            let altCls = cls;
            if (cls.startsWith('VII-')) altCls = '7' + cls.slice(4);
            else if (cls.startsWith('VIII-')) altCls = '8' + cls.slice(5);
            else if (cls.startsWith('IX-')) altCls = '9' + cls.slice(3);

            const studentCount = await prisma.user.count({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { className: cls },
                        { className: altCls }
                    ]
                }
            });
            const isHomeroom = user.className === cls;
            return {
                className: cls,
                subject: user.teachingSubject || 'Mata Pelajaran',
                totalStudents: studentCount || 32,
                isHomeroom,
                roleLabel: isHomeroom ? 'Wali Kelas & Guru Pengampu' : 'Guru Pengampu'
            };
        }));

        res.json({
            success: true,
            teacherName: user.name,
            subject: user.teachingSubject || 'Mata Pelajaran',
            homeroomClass: user.className || null,
            classes: classesWithStats
        });
    } catch (error) {
        console.error('Error fetching teacher classes:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat kelas yang diampu' });
    }
};

// 2. Mengambil Seluruh Siswa Berdasarkan Kelas Rombel (Dinamis VII-A <-> 7A)
export const getStudentsByClass = async (req: Request, res: Response) => {
    try {
        const rawClass = String(req.params.className || req.query.className || 'VII-A').trim();
        let altClass = rawClass;
        if (rawClass.startsWith('VII-')) altClass = '7' + rawClass.slice(4);
        else if (rawClass.startsWith('VIII-')) altClass = '8' + rawClass.slice(5);
        else if (rawClass.startsWith('IX-')) altClass = '9' + rawClass.slice(3);
        else if (rawClass.startsWith('7')) altClass = 'VII-' + rawClass.slice(1);
        else if (rawClass.startsWith('8')) altClass = 'VIII-' + rawClass.slice(1);
        else if (rawClass.startsWith('9')) altClass = 'IX-' + rawClass.slice(1);

        const students = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                OR: [
                    { className: rawClass },
                    { className: altClass }
                ]
            },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                username: true,
                nis: true,
                nisn: true,
                className: true,
                classRole: true,
                gender: true,
                points: true,
                latestHeightCm: true,
                latestWeightKg: true,
                bloodType: true,
                parentPhone: true,
                fatherName: true,
                motherName: true
            }
        });

        res.json({
            success: true,
            className: rawClass,
            totalStudents: students.length,
            students
        });
    } catch (error) {
        console.error('Error fetching students by class:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat daftar siswa' });
    }
};

// 3. Ringkasan Khusus Guru Wali Kelas
export const getHomeroomSummary = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const requestedClass = (req.query.className as string)?.trim();
        let homeroomClass = requestedClass || user.className;

        if (!homeroomClass && user.tugasTambahan) {
            const match = user.tugasTambahan.match(/WALI(?:_KELAS)?[:\s-]*([VII|VIII|IX|X|XI|XII0-9A-Za-z-]+)/i);
            if (match && match[1]) {
                homeroomClass = match[1].trim();
            }
        }

        if (!homeroomClass) {
            // Cek apakah guru ini terdaftar sebagai wali kelas di tabel siswa
            const sampleStudent = await prisma.user.findFirst({
                where: {
                    role: 'STUDENT',
                    OR: [
                        { homeroomTeacher: { contains: user.name } },
                        { homeroomTeacher: { contains: user.username } }
                    ]
                },
                select: { className: true }
            });
            if (sampleStudent?.className) {
                homeroomClass = sampleStudent.className;
            }
        }

        // Jika masih null, cek tabel Class jika ada
        if (!homeroomClass && user.teachingClasses) {
            const firstCls = user.teachingClasses.split(',')[0]?.trim();
            if (firstCls) homeroomClass = firstCls;
        }

        // Ambil seluruh daftar kelas yang ada di database
        const dbClasses = await prisma.class.findMany({
            orderBy: { name: 'asc' },
            select: { name: true }
        });
        const defaultClassList = [
            'VII-A', 'VII-B', 'VII-C', 'VII-D', 'VII-E', 'VII-F', 'VII-G', 'VII-H', 'VII-I', 'VII-J', 'VII-K',
            'VIII-A', 'VIII-B', 'VIII-C', 'VIII-D', 'VIII-E', 'VIII-F', 'VIII-G', 'VIII-H', 'VIII-I', 'VIII-J', 'VIII-K',
            'IX-A', 'IX-B', 'IX-C', 'IX-D', 'IX-E', 'IX-F', 'IX-G', 'IX-H', 'IX-I', 'IX-J', 'IX-K'
        ];
        const availableClasses = dbClasses.length > 0 ? dbClasses.map(c => c.name) : defaultClassList;

        if (!homeroomClass) {
            homeroomClass = availableClasses[0] || 'VII-A';
        }

        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', className: homeroomClass },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                nisn: true,
                nis: true,
                points: true,
                gender: true,
                parentPhone: true,
                fatherName: true,
                motherName: true,
                address: true,
                bloodType: true,
                profilePicUrl: true
            }
        });

        // Cek presensi hari ini untuk setiap siswa di kelas
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const todayAttendances = await prisma.attendance.findMany({
            where: {
                userId: { in: students.map(s => s.id) },
                scanTime: { gte: todayStart, lte: todayEnd }
            }
        });

        const inMap = new Map<string, any>();
        const outMap = new Map<string, any>();
        todayAttendances.forEach(a => {
            if (a.type === 'GATE_IN') inMap.set(a.userId, a);
            else if (a.type === 'GATE_OUT') outMap.set(a.userId, a);
        });

        const enrichedStudents = students.map(s => {
            const inAtt = inMap.get(s.id);
            const outAtt = outMap.get(s.id);
            return {
                ...s,
                todayStatus: inAtt ? inAtt.status : 'BELUM',
                todayInTime: inAtt?.scanTime || null,
                todayOutTime: outAtt?.scanTime || null
            };
        });

        const mapLeaveWithDuration = (l: any) => {
            const st = l.startDate ? new Date(l.startDate) : new Date();
            const en = l.endDate ? new Date(l.endDate) : st;
            const sDay = new Date(st); sDay.setHours(0, 0, 0, 0);
            const eDay = new Date(en); eDay.setHours(0, 0, 0, 0);
            const durationDays = Math.floor(Math.max(0, eDay.getTime() - sDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            const isSick = l.category === 'SICK' || l.category === 'SAKIT';
            const isDoctorNote = String(l.reason || '').toUpperCase().includes('[SURAT DOKTER') || String(l.reason || '').toUpperCase().includes('SURAT DOKTER RESMI');
            const approvedDays = isSick && !isDoctorNote ? Math.min(durationDays, 3) : durationDays;
            return {
                ...l,
                durationDays,
                approvedDays,
                isDoctorNote,
                documentLabel: isSick
                    ? (isDoctorNote ? `🏥 Surat Dokter (${approvedDays} Hari)` : `🏠 Izin Ortu (${approvedDays} Hari • Maks 3 Hari)`)
                    : `📝 Izin Resmi (${approvedDays} Hari)`
            };
        };

        // Cek permohonan izin orang tua yang pending & yang sudah di-approve
        const allClassLeaves = await prisma.studentLeaveRequest.findMany({
            where: {
                className: homeroomClass
            },
            orderBy: { createdAt: 'desc' },
            take: 30
        });

        const enrichedLeaves = allClassLeaves.map(mapLeaveWithDuration);
        const pendingLeaves = enrichedLeaves.filter(l => l.status === 'PENDING');
        const approvedLeaves = enrichedLeaves.filter(l => l.status === 'APPROVED');

        res.json({
            success: true,
            isHomeroom: true,
            homeroomClass,
            availableClasses,
            totalStudents: enrichedStudents.length,
            pendingLeavesCount: pendingLeaves.length,
            approvedLeavesCount: approvedLeaves.length,
            pendingLeaves,
            approvedLeaves,
            students: enrichedStudents
        });
    } catch (error) {
        console.error('Error fetching homeroom summary:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat ringkasan wali kelas' });
    }
};

// 4. Ringkasan Khusus Guru Piket Hari Ini & Jadwal Piket Terpadu
export const getPiketSummary = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const wib = new Date(utc + (3600000 * 7));
        const currentDay = wib.getDay();
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const dayName = dayNames[currentDay];

        // Cari jadwal piket hari ini (berdasarkan teacherId atau kecocokan nama/username)
        const piketToday = await prisma.piketSchedule.findFirst({
            where: {
                dayOfWeek: currentDay,
                isActive: true,
                OR: [
                    { teacherId: user.id },
                    { teacher: { name: { contains: user.name } } },
                    { teacher: { username: { contains: user.username } } }
                ]
            },
            include: {
                teacher: true
            }
        });

        // Ambil SELURUH tim petugas piket yang bertugas hari ini
        const todayPiketTeam = await prisma.piketSchedule.findMany({
            where: {
                dayOfWeek: currentDay,
                isActive: true
            },
            include: {
                teacher: {
                    select: { id: true, name: true, teachingSubject: true }
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        const isTaggedPiket = Boolean(piketToday) || user.role === 'PIKET' || user.role === 'GURU_PIKET' ||
            todayPiketTeam.some(t => t.teacherId === user.id || (t.teacher?.name && t.teacher.name.toLowerCase() === user.name.toLowerCase()));

        // Ambil laporan jam kosong hari ini
        const todayStart = new Date(wib);
        todayStart.setHours(0, 0, 0, 0);

        const openEmptyClasses = await prisma.emptyClassReport.findMany({
            where: {
                createdAt: { gte: todayStart }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Ambil data guru yang izin / sakit / dinas luar hari ini
        const todayTeacherLeaves = (prisma as any).teacherLeaveRequest ? await (prisma as any).teacherLeaveRequest.findMany({
            where: {
                startDate: { lte: wib },
                endDate: { gte: todayStart }
            },
            include: {
                teacher: { select: { id: true, name: true, teachingSubject: true } }
            },
            orderBy: { createdAt: 'desc' }
        }).catch(() => []) : [];

        // Ambil jadwal piket mingguan (Senin s/d Sabtu)
        const weeklyPiketSchedule = await prisma.piketSchedule.findMany({
            where: { isActive: true },
            include: {
                teacher: { select: { id: true, name: true, teachingSubject: true } }
            },
            orderBy: [{ dayOfWeek: 'asc' }, { createdAt: 'asc' }]
        }).catch(() => []);

        res.json({
            success: true,
            isPiketToday: isTaggedPiket,
            dayName,
            dayOfWeek: currentDay,
            piketDetails: piketToday || null,
            todayPiketTeam: todayPiketTeam.map(item => ({
                id: item.id,
                teacherId: item.teacherId,
                teacherName: item.teacher?.name || 'Petugas Piket',
                phone: (item.teacher as any)?.phone || '-',
                subject: item.teacher?.teachingSubject || '-',
                notes: item.notes || 'Petugas Posko Piket'
            })),
            openEmptyClassesCount: openEmptyClasses.filter(c => c.status === 'PENDING').length,
            openEmptyClasses,
            todayTeacherLeaves: todayTeacherLeaves.map((l: any) => ({
                id: l.id,
                teacherName: l.teacher?.name || 'Guru',
                subject: l.teacher?.teachingSubject || '-',
                leaveType: l.leaveType,
                reason: l.reason,
                status: l.status,
                hasAssignment: l.hasAssignment || false,
                assignmentDetails: l.assignmentDetails || null
            })),
            weeklyScheduleSummary: weeklyPiketSchedule.map(s => ({
                id: s.id,
                dayOfWeek: s.dayOfWeek,
                dayName: dayNames[s.dayOfWeek] || `Hari ${s.dayOfWeek}`,
                teacherName: s.teacher?.name || 'Guru'
            }))
        });
    } catch (error) {
        console.error('Error fetching piket summary:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat ringkasan piket' });
    }
};

// 5. Riwayat Log Broadcast Pengumuman Guru
export const getTeacherBroadcastHistory = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const announcements = await prisma.announcement.findMany({
            where: {
                OR: [
                    { author: { contains: user.name } },
                    { author: { contains: 'Guru Matpel' } }
                ]
            },
            orderBy: { createdAt: 'desc' },
            take: 30
        });

        res.json({
            success: true,
            broadcasts: announcements
        });
    } catch (error) {
        console.error('Error fetching broadcast history:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat riwayat broadcast' });
    }
};

// 6. Rekap Presensi Khusus Guru Mapel (Berdasarkan Mata Pelajaran yang Diampu)
export const getTeacherSubjectAttendanceRecap = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const dbTeacher = await prisma.user.findUnique({ where: { id: user.id } });
        const teachingSubject = dbTeacher?.teachingSubject || user.teachingSubject || 'Matematika';

        let classList: string[] = [];
        if (dbTeacher?.teachingClasses && dbTeacher.teachingClasses.trim() !== '') {
            classList = dbTeacher.teachingClasses.split(',').map((c: string) => c.trim()).filter(Boolean);
        }
        if (dbTeacher?.className && dbTeacher.className.trim() !== '' && dbTeacher.className.trim() !== '-' && !classList.includes(dbTeacher.className)) {
            classList.unshift(dbTeacher.className);
        }

        // Query all schedules of this teacher to ensure all taught classes are included
        const teacherSchedules = await (prisma as any).classPeriodSchedule.findMany({
            where: {
                OR: [
                    { teacherId: user.id },
                    { teacherName: { contains: dbTeacher?.name || user.name } }
                ]
            },
            select: { className: true }
        });
        for (const s of teacherSchedules) {
            if (s.className && !classList.includes(s.className)) {
                classList.push(s.className);
            }
        }

        // Ambil data dari sesi KBM jam pelajaran yang pernah dibuat oleh guru ini atau untuk mapel ini
        const sessions = await (prisma as any).classPeriodSession.findMany({
            where: {
                OR: [
                    { teacherId: user.id },
                    { subjectName: teachingSubject }
                ]
            },
            include: {
                attendances: true
            },
            orderBy: { inTime: 'desc' },
            take: 100
        });

        // Ambil seluruh siswa di rombel-rombel yang diampu
        const allStudentsInClasses = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                className: { in: classList }
            },
            select: {
                id: true,
                name: true,
                nisn: true,
                className: true,
                gender: true,
                profilePicUrl: true
            },
            orderBy: { name: 'asc' }
        });

        // Agregasi presensi per siswa untuk sesi KBM guru ini
        const studentStatsMap: Record<string, { present: number; sick: number; permission: number; absent: number }> = {};
        for (const sess of sessions) {
            for (const att of sess.attendances || []) {
                const sId = att.studentId;
                if (!studentStatsMap[sId]) {
                    studentStatsMap[sId] = { present: 0, sick: 0, permission: 0, absent: 0 };
                }
                const st = (att.status || 'PRESENT').toUpperCase();
                if (st === 'PRESENT' || st === 'AUTO_PRESENT' || st === 'HADIR') {
                    studentStatsMap[sId].present++;
                } else if (st === 'SICK' || st === 'SAKIT') {
                    studentStatsMap[sId].sick++;
                } else if (st === 'PERMISSION' || st === 'IZIN') {
                    studentStatsMap[sId].permission++;
                } else {
                    studentStatsMap[sId].absent++;
                }
            }
        }

        // Jika belum ada sesi KBM guru tercatat, ambil agregasi kehadiran siswa dari tabel presensi sekolah
        const studentIds = allStudentsInClasses.map((s: any) => s.id);
        const generalAttendances = await prisma.attendance.findMany({
            where: {
                userId: { in: studentIds }
            },
            select: { userId: true, status: true }
        });
        const generalStatsMap: Record<string, { present: number; sick: number; permission: number; absent: number }> = {};
        for (const att of generalAttendances) {
            if (!generalStatsMap[att.userId]) {
                generalStatsMap[att.userId] = { present: 0, sick: 0, permission: 0, absent: 0 };
            }
            const st = (att.status || 'PRESENT').toUpperCase();
            if (st === 'PRESENT' || st === 'LATE' || st === 'HADIR' || st === 'TERLAMBAT' || st === 'AUTO_PRESENT') {
                generalStatsMap[att.userId].present++;
            } else if (st === 'SICK' || st === 'SAKIT') {
                generalStatsMap[att.userId].sick++;
            } else if (st === 'PERMISSION' || st === 'IZIN') {
                generalStatsMap[att.userId].permission++;
            } else {
                generalStatsMap[att.userId].absent++;
            }
        }

        // Kelompokkan siswa per rombel
        const studentsByClass: Record<string, any[]> = {};
        for (const stu of allStudentsInClasses) {
            const cls = stu.className || 'Tanpa Rombel';
            if (!studentsByClass[cls]) {
                studentsByClass[cls] = [];
            }
            const st = studentStatsMap[stu.id] || generalStatsMap[stu.id] || { present: 1, sick: 0, permission: 0, absent: 0 };
            const total = st.present + st.sick + st.permission + st.absent;
            const pct = total > 0 ? Math.round((st.present / total) * 100) : 100;
            studentsByClass[cls].push({
                id: stu.id,
                name: stu.name,
                nisn: stu.nisn || '-',
                className: cls,
                gender: stu.gender || 'L',
                presentCount: st.present,
                sickCount: st.sick,
                permissionCount: st.permission,
                absentCount: st.absent,
                percentage: pct
            });
        }

        // Agregasi per kelas
        const recapByClass: any = {};
        for (const cls of classList) {
            const classStudents = studentsByClass[cls] || [];
            let cPresent = 0;
            let cSick = 0;
            let cPermit = 0;
            let cAbsent = 0;
            for (const cs of classStudents) {
                cPresent += cs.presentCount;
                cSick += cs.sickCount;
                cPermit += cs.permissionCount;
                cAbsent += cs.absentCount;
            }

            recapByClass[cls] = {
                className: cls,
                subject: teachingSubject,
                subjectName: teachingSubject,
                totalSessions: Math.max(sessions.filter((s: any) => s.className === cls).length, 1),
                presentCount: cPresent,
                absentCount: cAbsent,
                lateCount: 0,
                sickCount: cSick,
                permissionCount: cPermit,
                percentage: 100
            };
        }

        for (const sess of sessions) {
            if (!recapByClass[sess.className]) {
                recapByClass[sess.className] = {
                    className: sess.className,
                    subject: sess.subjectName || teachingSubject,
                    subjectName: sess.subjectName || teachingSubject,
                    totalSessions: 0,
                    presentCount: 0,
                    absentCount: 0,
                    lateCount: 0,
                    sickCount: 0,
                    permissionCount: 0,
                    percentage: 100
                };
            }
            recapByClass[sess.className].totalSessions++;
            for (const att of sess.attendances || []) {
                const st = (att.status || 'PRESENT').toUpperCase();
                if (st === 'PRESENT' || st === 'AUTO_PRESENT' || st === 'HADIR') {
                    recapByClass[sess.className].presentCount++;
                } else if (st === 'SICK' || st === 'SAKIT') {
                    recapByClass[sess.className].sickCount++;
                } else if (st === 'PERMISSION' || st === 'IZIN') {
                    recapByClass[sess.className].permissionCount++;
                } else if (st === 'LATE' || st === 'TERLAMBAT') {
                    recapByClass[sess.className].lateCount++;
                } else {
                    recapByClass[sess.className].absentCount++;
                }
            }
        }

        // Hitung persentase kehadiran per kelas
        const classResults = Object.values(recapByClass).map((c: any) => {
            const totalHadir = c.presentCount;
            const totalTidakHadir = c.absentCount + c.sickCount + c.permissionCount;
            const totalAbsensi = totalHadir + totalTidakHadir;
            const pct = totalAbsensi > 0 ? Math.round((totalHadir / totalAbsensi) * 100) : 100;
            const classStudents = studentsByClass[c.className] || [];
            return {
                ...c,
                percentage: pct,
                totalStudents: classStudents.length,
                students: classStudents
            };
        });

        const subjectsResult = classResults.map((c: any) => ({
            subjectName: `${c.className} • ${c.subjectName}`,
            className: c.className,
            teacherName: dbTeacher?.name || user.name,
            totalSessions: c.totalSessions,
            present: c.presentCount,
            sick: c.sickCount,
            permission: c.permissionCount,
            truant: c.absentCount,
            percentage: c.percentage,
            totalStudents: c.totalStudents,
            students: c.students
        }));

        res.json({
            success: true,
            teacherName: dbTeacher?.name || user.name,
            subject: teachingSubject,
            subjectName: teachingSubject,
            subjects: subjectsResult,
            classes: classResults
        });
    } catch (error) {
        console.error('Error fetching subject attendance recap:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat rekap presensi guru mapel' });
    }
};

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Endpoint Presensi Geolocation Harian Guru (Datang & Pulang via Tombol 1-Tap GPS, Tanpa Scan Kamera)
 */
export const teacherGeolocationAttendance = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { lat, lng, isFakeGps } = req.body;

        if (isFakeGps === true) {
            return res.status(403).json({
                success: false,
                message: '🚨 Presensi Ditolak! Terdeteksi Fake GPS / Mock Location pada perangkat Anda.'
            });
        }

        // Koordinat Kampus SMPN 1 Boyolangu
        const schoolLat = -8.125157;
        const schoolLng = 111.893912;
        const maxRadiusMeters = 200; // Radius toleransi lingkungan sekolah

        if (lat != null && lng != null && String(lat) !== '' && String(lng) !== '') {
            const distance = calculateDistanceMeters(Number(lat), Number(lng), schoolLat, schoolLng);
            if (distance > maxRadiusMeters) {
                return res.status(403).json({
                    success: false,
                    message: `📍 Presensi Ditolak! Anda terdeteksi berada di luar area SMPN 1 Boyolangu (Jarak: ${Math.round(distance)} meter). Presensi hanya dapat dilakukan di lingkungan sekolah.`
                });
            }
        }

        // Ambil rentang waktu hari ini (00:00 - 23:59 WIB)
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        // Cari presensi guru hari ini
        const todayAttendances = await prisma.attendance.findMany({
            where: {
                userId: user.id,
                scanTime: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            },
            orderBy: { scanTime: 'asc' }
        });

        const hasIn = todayAttendances.find(a => a.type === 'GATE_IN');
        const hasOut = todayAttendances.find(a => a.type === 'GATE_OUT');

        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

        if (!hasIn) {
            // Catat Presensi DATANG
            const newAtt = await prisma.attendance.create({
                data: {
                    userId: user.id,
                    type: 'GATE_IN',
                    method: 'GPS',
                    status: 'PRESENT',
                    scanTime: now,
                    lat: lat ? Number(lat) : schoolLat,
                    lng: lng ? Number(lng) : schoolLng,
                    isFakeGps: Boolean(isFakeGps),
                    note: `Presensi Datang Guru (1-Tap Geolocation) • ${timeStr}`
                }
            });

            return res.json({
                success: true,
                type: 'GATE_IN',
                message: `✔ Presensi DATANG Berhasil! Tercatat pada ${timeStr} via Geolocation GPS.`,
                timeStr,
                attendance: newAtt
            });
        } else if (!hasOut) {
            // Catat Presensi PULANG
            const newAtt = await prisma.attendance.create({
                data: {
                    userId: user.id,
                    type: 'GATE_OUT',
                    method: 'GPS',
                    status: 'PRESENT',
                    scanTime: now,
                    lat: lat ? Number(lat) : schoolLat,
                    lng: lng ? Number(lng) : schoolLng,
                    isFakeGps: Boolean(isFakeGps),
                    note: `Presensi Pulang Guru (1-Tap Geolocation) • ${timeStr}`
                }
            });

            return res.json({
                success: true,
                type: 'GATE_OUT',
                message: `✔ Presensi PULANG Berhasil! Tercatat pada ${timeStr} via Geolocation GPS.`,
                timeStr,
                attendance: newAtt
            });
        } else {
            return res.json({
                success: false,
                message: 'Presensi kehadiran hari ini sudah lengkap (Datang & Pulang).',
                isCompleted: true
            });
        }
    } catch (error: any) {
        console.error('Error in teacherGeolocationAttendance:', error);
        return res.status(500).json({ success: false, message: 'Gagal mencatat presensi guru: ' + error.message });
    }
};

/**
 * Status Presensi Harian Guru Hari Ini (Untuk APK Guru)
 */
export const getTeacherTodayAttendance = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        const todayAttendances = await prisma.attendance.findMany({
            where: {
                userId: user.id,
                scanTime: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            },
            orderBy: { scanTime: 'asc' }
        });

        const inRecord = todayAttendances.find(a => a.type === 'GATE_IN');
        const outRecord = todayAttendances.find(a => a.type === 'GATE_OUT');

        const inTimeStr = inRecord ? formatTimeWibWithSuffix(inRecord.scanTime) : null;
        const outTimeStr = outRecord ? formatTimeWibWithSuffix(outRecord.scanTime) : null;

        return res.json({
            success: true,
            hasIn: !!inRecord,
            inTime: inTimeStr,
            hasOut: !!outRecord,
            outTime: outTimeStr,
            status: inRecord ? (outRecord ? 'COMPLETED' : 'CHECKED_IN') : 'NOT_CHECKED_IN'
        });
    } catch (error: any) {
        console.error('Error in getTeacherTodayAttendance:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat status presensi guru' });
    }
};


