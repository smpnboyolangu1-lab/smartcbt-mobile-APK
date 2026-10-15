import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import prisma from '../utils/db';
import { sendFcmToUser, sendFcmToRole } from './fcmService';

export interface AiLeaveAnalysisResult {
    isAutoApproved: boolean;
    docType: 'DOKTER_RS_PUSKESMAS' | 'SURAT_RT_WARGA' | 'SURAT_ORTU_BIASA' | 'LAINNYA';
    hasRtStamp: boolean;
    hasDoctorStamp: boolean;
    approvedDays: number;
    anomalies: string[];
    aiNotes: string;
}

export async function analyzeAndProcessLeaveWithAi(leaveRequestId: string): Promise<AiLeaveAnalysisResult> {
    const leave = await (prisma as any).studentLeaveRequest.findUnique({
        where: { id: leaveRequestId }
    });

    if (!leave) {
        throw new Error('Leave request not found');
    }

    const start = new Date(leave.startDate);
    const end = new Date(leave.endDate);
    const requestedDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // Default fallback analysis
    let analysis: AiLeaveAnalysisResult = {
        isAutoApproved: false,
        docType: 'SURAT_ORTU_BIASA',
        hasRtStamp: false,
        hasDoctorStamp: false,
        approvedDays: Math.min(requestedDays, 2),
        anomalies: [],
        aiNotes: ''
    };

    try {
        const geminiSetting = await prisma.settings.findUnique({ where: { key: 'GEMINI_API_KEY' } });
        const apiKey = geminiSetting?.value || process.env.GEMINI_API_KEY;

        if (apiKey && leave.attachmentUrl) {
            let relativePath = leave.attachmentUrl;
            if (relativePath.startsWith('/')) relativePath = relativePath.substring(1);
            const absoluteFilePath = path.join(process.cwd(), relativePath);

            if (fs.existsSync(absoluteFilePath)) {
                const fileBuffer = fs.readFileSync(absoluteFilePath);
                const base64Data = fileBuffer.toString('base64');
                const ext = path.extname(absoluteFilePath).toLowerCase().replace('.', '');
                const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

                const ai = new GoogleGenAI({ apiKey });
                const prompt = `Anda adalah sistem kecerdasan buatan (AI) sekolah SMPN 1 Boyolangu yang bertugas memverifikasi surat izin siswa secara cerdas dan ketat.
Identitas Siswa Pemohon: "${leave.studentName}"
Kelas: "${leave.className}"
Kategori Pengajuan: "${leave.category}" (SICK = Sakit, PERMISSION = Izin Bepergian / Keluarga)
Durasi Diajukan: ${requestedDays} hari.

Analisis foto dokumen/surat ini dan berikan output strictly dalam format JSON:
{
  "docType": "DOKTER_RS_PUSKESMAS" ATAU "SURAT_RT_WARGA" ATAU "SURAT_ORTU_BIASA",
  "hasDoctorStamp": true/false (apakah ada kop surat resmi / stempel RS / Puskesmas / Klinik / Dokter Praktik),
  "hasRtStamp": true/false (apakah ada stempel basah RT / RW / Kelurahan),
  "patientName": "nama yang tertulis pada surat",
  "nameMatches": true/false (apakah nama di surat cocok dengan "${leave.studentName}"),
  "daysRecommended": number (jumlah hari istirahat yang tertulis di surat dokter, jika bukan surat dokter tulis ${requestedDays}),
  "anomalies": ["daftar anomali atau catatan kejanggalan jika ada"]
}
Aturan Mutlak:
1. Surat Sakit dari Dokter/RS/Puskesmas: jika hasDoctorStamp=true dan nama cocok, durasi mengikuti daysRecommended di surat.
2. Surat Sakit tanpa dokter: WAJIB memiliki stempel RT (hasRtStamp=true), maksimal izin 2 hari. Jika tanpa stempel RT, masukkan ke anomalies: "Wajib menyertakan stempel RT setempat".
3. Izin Bepergian / Keperluan Keluarga: WAJIB memiliki stempel RT (hasRtStamp=true), maksimal 2 hari. Jika tanpa stempel RT, masukkan ke anomalies: "Izin bepergian wajib stempel RT".
4. Jika nama tidak cocok atau tanggal lama/kedaluwarsa, masukkan ke anomalies.`;

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                { text: prompt },
                                {
                                    inlineData: {
                                        mimeType: mimeType,
                                        data: base64Data
                                    }
                                }
                            ]
                        }
                    ]
                });

                const textResp = response.text || '';
                const jsonMatch = textResp.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    analysis.docType = parsed.docType || 'SURAT_ORTU_BIASA';
                    analysis.hasDoctorStamp = !!parsed.hasDoctorStamp;
                    analysis.hasRtStamp = !!parsed.hasRtStamp;
                    analysis.anomalies = Array.isArray(parsed.anomalies) ? parsed.anomalies : [];
                    if (!parsed.nameMatches && parsed.patientName) {
                        analysis.anomalies.push(`Nama di surat (${parsed.patientName}) tidak cocok dengan siswa (${leave.studentName})`);
                    }

                    if (analysis.hasDoctorStamp) {
                        analysis.approvedDays = Math.max(1, Number(parsed.daysRecommended) || requestedDays);
                    } else {
                        analysis.approvedDays = Math.min(requestedDays, 2);
                    }
                }
            } else {
                analysis.anomalies.push('Berkas lampiran fisik surat tidak ditemukan di server.');
            }
        } else {
            // Tanpa lampiran
            analysis.anomalies.push('Pengajuan izin tidak melampirkan foto surat resmi (Wajib stempel RT / Surat Dokter).');
        }
    } catch (err: any) {
        console.warn('[AI Leave Analysis] Error:', err.message);
        analysis.anomalies.push('AI verifikasi terkendala: ' + err.message);
    }

    // Validasi Kelayakan Auto-Approve
    const isSick = leave.category === 'SICK' || leave.category === 'SAKIT';
    let eligibleAutoApprove = false;

    if (analysis.hasDoctorStamp && analysis.anomalies.length === 0) {
        // Surat Dokter Resmi Lolos
        eligibleAutoApprove = true;
        analysis.aiNotes = `✅ Disetujui Otomatis oleh AI: Surat Dokter / Puskesmas Resmi Terverifikasi (${analysis.approvedDays} hari).`;
    } else if (analysis.hasRtStamp && requestedDays <= 2 && analysis.anomalies.length === 0) {
        // Izin/Sakit Berstempel RT Lolos Maksimal 2 Hari
        eligibleAutoApprove = true;
        analysis.approvedDays = requestedDays;
        analysis.aiNotes = `✅ Disetujui Otomatis oleh AI: Surat Terverifikasi Berstempel RT (${analysis.approvedDays} hari).`;
    } else {
        // Terdeteksi Anomali / Tanpa Stempel RT -> Dialihkan ke Manual BK
        eligibleAutoApprove = false;
        if (analysis.anomalies.length === 0) {
            if (!analysis.hasRtStamp) analysis.anomalies.push('Surat belum memiliki stempel resmi RT.');
            if (requestedDays > 2) analysis.anomalies.push(`Permohonan ${requestedDays} hari melebihi batas reguler 2 hari.`);
        }
        analysis.aiNotes = `⚠️ Menunggu Verifikasi Manual Guru BK: ${analysis.anomalies.join(' • ')}`;
    }

    analysis.isAutoApproved = eligibleAutoApprove;

    // Eksekusi Persetujuan Otomatis jika Memenuhi Syarat
    if (eligibleAutoApprove) {
        await executeLeaveApproval(leave, analysis.approvedDays, 'AI_AUTO_SYSTEM (Terverifikasi AI)');
    } else {
        // Tandai catatan AI pada permohonan agar Guru BK langsung melihat rekomendasi AI
        await (prisma as any).studentLeaveRequest.update({
            where: { id: leave.id },
            data: {
                rejectionNote: `[REKOMENDASI AI]: ${analysis.aiNotes}`
            }
        });
    }

    return analysis;
}

// Eksekusi Persetujuan Izin (Dipanggil oleh AI Auto-Approve atau Manual oleh BK)
export async function executeLeaveApproval(leaveReq: any, approvedDays: number, verifiedBy: string): Promise<void> {
    const start = new Date(leaveReq.startDate);
    const end = new Date(start);
    end.setDate(start.getDate() + approvedDays - 1);

    // 1. Update status permohonan
    await (prisma as any).studentLeaveRequest.update({
        where: { id: leaveReq.id },
        data: {
            status: 'APPROVED',
            verifiedBy: verifiedBy,
            verifiedAt: new Date(),
            endDate: end
        }
    });

    const isSick = leaveReq.category === 'SICK' || leaveReq.category === 'SAKIT';
    const attStatus = isSick ? 'SICK' : 'PERMISSION';
    const docLabel = isSick ? 'Sakit' : 'Izin Resmi';

    // 2. Tandai Presensi Hari Ini jika masuk dalam rentang tanggal izin
    const todayStr = new Date().toISOString().split('T')[0];
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    if (todayStr >= startStr && todayStr <= endStr) {
        const todayAttendance = await prisma.attendance.findFirst({
            where: {
                userId: leaveReq.studentId,
                scanTime: {
                    gte: new Date(`${todayStr}T00:00:00.000Z`),
                    lte: new Date(`${todayStr}T23:59:59.999Z`)
                }
            }
        });

        if (todayAttendance) {
            await prisma.attendance.update({
                where: { id: todayAttendance.id },
                data: {
                    status: attStatus,
                    note: `${docLabel} (${approvedDays} hari disetujui oleh ${verifiedBy})`
                }
            });
        } else {
            await prisma.attendance.create({
                data: {
                    userId: leaveReq.studentId,
                    type: 'GATE_IN',
                    method: 'MANUAL',
                    status: attStatus,
                    note: `${docLabel} (${approvedDays} hari disetujui oleh ${verifiedBy})`
                }
            });
        }
    }

    // 3. Distribusi Notifikasi Lengkap (Ortu, Siswa, Pengurus Kelas, Wali Kelas, Guru Mapel)
    const notifMsg = `Permohonan ${docLabel} ananda ${leaveReq.studentName} (${leaveReq.className}) selama ${approvedDays} hari telah DISETUJUI oleh ${verifiedBy}. Data otomatis masuk ke rekap presensi.`;

    // A. Orang Tua
    const parentUser = await prisma.user.findFirst({
        where: {
            role: 'PARENT',
            OR: [
                { username: 'P' + leaveReq.studentId },
                { nisn: leaveReq.studentId }
            ]
        }
    });
    if (parentUser) {
        await prisma.notificationMessage.create({
            data: {
                recipientId: parentUser.id,
                recipientRole: 'PARENT',
                studentId: leaveReq.studentId,
                studentName: leaveReq.studentName,
                className: leaveReq.className,
                title: `✅ ${docLabel} Disetujui: ${leaveReq.studentName}`,
                message: notifMsg,
                category: 'ATTENDANCE'
            }
        });
        sendFcmToUser(parentUser.id, `✅ ${docLabel} Disetujui`, notifMsg);
    }

    // B. Siswa
    await prisma.notificationMessage.create({
        data: {
            recipientId: leaveReq.studentId,
            recipientRole: 'STUDENT',
            studentId: leaveReq.studentId,
            studentName: leaveReq.studentName,
            className: leaveReq.className,
            title: `✅ ${docLabel} Disetujui`,
            message: notifMsg,
            category: 'ATTENDANCE'
        }
    });
    sendFcmToUser(leaveReq.studentId, `✅ ${docLabel} Disetujui`, notifMsg);

    // C. Pengurus Kelas (Ketua, Wakil, Sekretaris)
    const officers = await prisma.user.findMany({
        where: {
            className: leaveReq.className,
            role: 'STUDENT',
            classRole: { in: ['Ketua Kelas', 'Wakil Ketua Kelas', 'Sekretaris', 'Bendahara'] }
        }
    });
    for (const off of officers) {
        const offMsg = `📋 Rekap Pengurus Kelas: Teman Anda ${leaveReq.studentName} berstatus ${docLabel} (${approvedDays} hari) telah disetujui.`;
        await prisma.notificationMessage.create({
            data: {
                recipientId: off.id,
                recipientRole: 'STUDENT',
                className: leaveReq.className,
                title: `📋 Info Presensi Kelas: ${leaveReq.studentName}`,
                message: offMsg,
                category: 'ATTENDANCE'
            }
        });
        sendFcmToUser(off.id, `📋 Presensi ${leaveReq.className}`, offMsg);
    }

    // D. Wali Kelas (Hanya Menerima Pemberitahuan)
    const classObj = await prisma.class.findFirst({
        where: { name: leaveReq.className }
    });
    const waliUser = await prisma.user.findFirst({
        where: {
            role: 'TEACHER',
            teachingClasses: { contains: leaveReq.className },
            rolesTambahan: { contains: 'wali_kelas' }
        }
    });
    if (waliUser) {
        const waliMsg = `🔔 Laporan Wali Kelas: Ananda ${leaveReq.studentName} (${leaveReq.className}) disetujui ${docLabel} (${approvedDays} hari) oleh ${verifiedBy}.`;
        await prisma.notificationMessage.create({
            data: {
                recipientId: waliUser.id,
                recipientRole: 'TEACHER',
                title: `🔔 Rekap Izin Kelas ${leaveReq.className}`,
                message: waliMsg,
                category: 'ATTENDANCE'
            }
        });
        sendFcmToUser(waliUser.id, `🔔 Rekap Izin ${leaveReq.className}`, waliMsg);
    }

    // E. Guru Mapel yang mengajar di kelas hari ini
    try {
        const schedules = await (prisma as any).teachingSession?.findMany({
            where: { className: leaveReq.className }
        });
        if (schedules && schedules.length > 0) {
            for (const s of schedules) {
                if (s.teacherId) {
                    sendFcmToUser(s.teacherId, `ℹ️ Izin Siswa KBM: ${leaveReq.studentName}`, `${leaveReq.studentName} disetujui ${docLabel} hari ini.`);
                }
            }
        }
    } catch (_) {}
}
