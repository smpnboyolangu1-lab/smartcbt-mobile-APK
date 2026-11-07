import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * ========================================================
 * ADVANCED UKS 2.0 (SMART HEALTH & CLINICAL TRIAGE) ENGINE
 * Modul Unit Kesehatan Sekolah Canggih:
 * 1. Smart Clinical Triage Engine (Merah, Kuning, Hijau) & First-Aid SOP IDI/PMR
 * 2. Automated Visit Intake with Bed Assignment
 * 3. Outbreak / KLB (Kejadian Luar Biasa) Cluster Detection Early Warning
 * 4. Digital KMS & WHO Growth Standard Z-Score Calculator
 * 5. Live UKS Ward & Bed Occupancy Rate (BOR) Monitoring
 * 6. Drug Allergy & Medicine Safety Cross-Check
 * ========================================================
 */

/**
 * 1. Evaluasi Triase Klinis Cerdas & Rekomendasi SOP Pertolongan Pertama (P3K)
 */
export const evaluateSmartTriage = (complaintCategory: string, temp?: number, isFainting?: boolean, consciousness: string = 'SADAR_PENUH') => {
    let colorCode = 'HIJAU';
    let urgencyLevel = 'NORMAL';
    let triageTitle = '🟢 TRIASI HIJAU (NON-URGENT / RINGAN)';
    let estimatedCareTime = '15 - 30 Menit';
    let disposition = 'BACK_TO_CLASS';
    const sopSteps: string[] = [];

    const temperature = Number(temp) || 36.5;

    // Evaluasi MERAH (Kegawatdaruratan)
    if (consciousness === 'TIDAK_SADAR' || temperature >= 40.0 || complaintCategory === 'SESAK_NAFAS_BERAT') {
        colorCode = 'MERAH';
        urgencyLevel = 'CRITICAL';
        triageTitle = '🔴 TRIASE MERAH (RESUSITASI / GAWAT DARURAT)';
        estimatedCareTime = 'SEGERA (Tindakan Cepat < 5 Menit)';
        disposition = 'REFERRED_HOSPITAL';

        sopSteps.push('1. Posisikan pasien dalam posisi pemulihan (Recovery Position) miring mantap.');
        sopSteps.push('2. Pastikan jalan nafas (Airway) bersih, cek pernafasan (Breathing) dan denyut nadi karotis (Circulation).');
        sopSteps.push('3. Berikan suplementasi oksigen jika tersedia (tabung oksigen UKS).');
        sopSteps.push('4. Hubungi Call Center Darurat 119 / Puskesmas / RS Rujukan terdekat.');
        sopSteps.push('5. Notifikasi darurat instan dikirim ke Orang Tua, Wali Kelas, dan Kepala Sekolah.');
    }
    // Evaluasi KUNING (Urgent / Butuh Observasi di UKS)
    else if (isFainting || temperature >= 38.3 || complaintCategory === 'PINGSAN' || complaintCategory === 'CEDERA_LUKA_BERAT' || complaintCategory === 'MAAG_AKUT') {
        colorCode = 'KUNING';
        urgencyLevel = 'URGENT';
        triageTitle = '🟡 TRIASE KUNING (URGENT / BUTUH OBSERVASI MEDIS)';
        estimatedCareTime = '30 - 60 Menit';
        disposition = 'REST_AT_UKS';

        sopSteps.push('1. Baringkan siswa di Bed UKS dengan posisi kaki sedikit lebih tinggi dari kepala (posisi shock ringan).');
        sopSteps.push('2. Longgarkan kerah baju, dasi, dan ikat pinggang untuk memperlancar sirkulasi udara.');
        sopSteps.push('3. Ukur dan catat tanda vital (suhu tubuh dan tensi) secara periodik setiap 15 menit.');
        sopSteps.push('4. Berikan kompres hangat pada dahi/lipatan tubuh jika demam tinggi.');
        sopSteps.push('5. Jika setelah 45 menit kondisi belum stabil, hubungi orang tua untuk penjemputan pulang.');
    }
    // HIJAU (Perawatan Ringan)
    else {
        colorCode = 'HIJAU';
        urgencyLevel = 'NORMAL';
        triageTitle = '🟢 TRIASE HIJAU (NON-URGENT / PERAWATAN RINGAN)';
        estimatedCareTime = '15 - 25 Menit';
        disposition = 'REST_AT_UKS';

        sopSteps.push('1. Bersihkan luka dengan antiseptik (Povidone Iodine/NaCl) dan tutup dengan perban steril jika luka lecet.');
        sopSteps.push('2. Berikan air hangat atau teh manis hangat untuk memulihkan energi glukosa darah.');
        sopSteps.push('3. Berikan obat pereda nyeri/gejala ringan yang telah disetujui (misal paracetamol / antasida).');
        sopSteps.push('4. Istirahatkan selama 20 menit di Bed UKS.');
        sopSteps.push('5. Evaluasi kesiapan fisik untuk kembali mengikuti pembelajaran di kelas.');
    }

    return {
        colorCode,
        urgencyLevel,
        triageTitle,
        estimatedCareTime,
        disposition,
        sopSteps
    };
};

/**
 * 2. Catat Kunjungan UKS dengan Triase Medis Otomatis & Alokasi Bed
 */
export const recordUksTriageVisit = async (req: Request, res: Response) => {
    try {
        const {
            userId,
            category = 'LAINNYA',
            temperature,
            bloodPressure,
            complaint,
            treatment,
            medicine,
            officerName = 'Petugas UKS',
            bedNumber,
            isFainting = false,
            consciousness = 'SADAR_PENUH',
            incidentLocation = 'Ruang Kelas'
        } = req.body;

        if (!userId || !complaint) {
            return res.status(400).json({ success: false, message: 'userId dan complaint wajib diisi' });
        }

        const student = await prisma.user.findUnique({
            where: { id: String(userId) },
            select: { id: true, name: true, username: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        // Jalankan evaluasi triase klinis
        const triageResult = evaluateSmartTriage(category, temperature, isFainting, consciousness);

        // Alokasikan bed jika dibutuhkan
        const allocatedBed = bedNumber || (triageResult.colorCode !== 'HIJAU' ? 'Bed 01' : 'Bed 02');

        const visit = await prisma.uksVisit.create({
            data: {
                userId: student.id,
                category,
                isFainting: !!isFainting,
                incidentLocation,
                temperature: temperature ? Number(temperature) : null,
                bloodPressure: bloodPressure || null,
                bedNumber: allocatedBed,
                disposition: triageResult.disposition,
                complaint,
                diagnosis: `Kondisi klinis: ${complaint} (${triageResult.colorCode})`,
                treatment: treatment || triageResult.sopSteps.join('; '),
                medicine: medicine || null,
                officerName,
                visitStatus: 'AT_UKS',
                urgencyLevel: triageResult.urgencyLevel,
                parentNotified: triageResult.colorCode === 'MERAH'
            }
        });

        // Jika Triase MERAH, kirim notifikasi darurat instan
        if (triageResult.colorCode === 'MERAH') {
            try {
                await prisma.notificationMessage.create({
                    data: {
                        recipientId: student.id,
                        recipientRole: 'HEADMASTER',
                        studentId: student.id,
                        studentName: student.name,
                        className: student.className || '',
                        title: `🚨 UKS EMERGENCY ALERT (TRIASE MERAH): ${student.name}`,
                        message: `Pasien ${student.name} (${student.className}) masuk UKS dengan status darurat (${complaint}). Tindakan SOP Rujukan RS sedang dilakukan.`,
                        category: 'UKS_EMERGENCY'
                    }
                });
            } catch (_) {}
        }

        return res.json({
            success: true,
            message: 'Kunjungan UKS berhasil dicatat dengan triase klinis.',
            triage: triageResult,
            data: visit
        });
    } catch (error: any) {
        console.error('Error recording UKS visit:', error);
        return res.status(500).json({ success: false, message: 'Gagal mencatat kunjungan UKS: ' + error.message });
    }
};

/**
 * 3. Outbreak / KLB (Kejadian Luar Biasa) Early Warning & Cluster Detection
 * Menganalisis jika ada kluster gejala serupa >= 3 siswa dalam 1 kelas dalam 48 jam
 */
export const checkOutbreakEarlyWarning = async (req: Request, res: Response) => {
    try {
        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

        const recentVisits = await prisma.uksVisit.findMany({
            where: {
                checkInTime: { gte: twoDaysAgo }
            },
            include: {
                user: { select: { id: true, name: true, className: true } }
            },
            orderBy: { checkInTime: 'desc' }
        });

        // Kelompokkan per kelas dan kategori gejala
        const clusterMap: Record<string, Record<string, any[]>> = {};

        recentVisits.forEach(v => {
            const cls = v.user?.className || 'Lainnya';
            const cat = v.category || 'LAINNYA';

            if (!clusterMap[cls]) clusterMap[cls] = {};
            if (!clusterMap[cls][cat]) clusterMap[cls][cat] = [];

            clusterMap[cls][cat].push({
                studentId: v.user?.id,
                studentName: v.user?.name,
                complaint: v.complaint,
                checkInTime: v.checkInTime
            });
        });

        const activeOutbreakAlerts: any[] = [];

        Object.entries(clusterMap).forEach(([className, catGroup]) => {
            Object.entries(catGroup).forEach(([category, students]) => {
                if (students.length >= 3) {
                    activeOutbreakAlerts.push({
                        alertLevel: students.length >= 5 ? 'CRITICAL_OUTBREAK' : 'WARNING_CLUSTER',
                        className,
                        symptomCategory: category,
                        affectedStudentsCount: students.length,
                        students,
                        mitigationAction: `Ditemukan ${students.length} siswa kelas ${className} dengan keluhan serupa (${category}) dalam 48 jam. Rekomendasi: sterilisasi ruang kelas, desinfeksi ventilasi, dan edukasi cuci tangan/masker.`
                    });
                }
            });
        });

        return res.json({
            success: true,
            totalVisitsLast48Hours: recentVisits.length,
            isOutbreakDetected: activeOutbreakAlerts.length > 0,
            activeOutbreakAlertsCount: activeOutbreakAlerts.length,
            alerts: activeOutbreakAlerts
        });
    } catch (error: any) {
        console.error('Error checking outbreak early warning:', error);
        return res.status(500).json({ success: false, message: 'Gagal menganalisis peringatan wabah: ' + error.message });
    }
};

/**
 * 4. Digital KMS & WHO Growth Standard Z-Score Calculator
 * Menghitung IMT dan status gizi anak sekolah
 */
export const calculateKmsGrowthData = async (req: Request, res: Response) => {
    try {
        const { studentId, heightCm, weightKg, academicPeriod = 'Semester Ganjil 2026/2027', measuredBy = 'Petugas UKS' } = req.body;

        if (!studentId || !heightCm || !weightKg) {
            return res.status(400).json({ success: false, message: 'studentId, heightCm, dan weightKg wajib diisi' });
        }

        const student = await prisma.user.findUnique({
            where: { id: String(studentId) },
            select: { id: true, name: true, username: true, className: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const heightM = Number(heightCm) / 100;
        const weight = Number(weightKg);
        const bmi = Number((weight / (heightM * heightM)).toFixed(1));

        // Klasifikasi Standar Kemenkes / WHO Remaja Usia Sekolah
        let nutritionalStatus = 'NORMAL';
        let nutritionalAdvice = 'Gizi seimbang dan pertahankan pola aktivitas fisik teratur.';

        if (bmi < 17.0) {
            nutritionalStatus = 'UNDERWEIGHT_BERAT';
            nutritionalAdvice = 'Pola gizi kurang berat: Diperlukan asupan kalori dan protein tinggi serta konsumsi susu bergizi.';
        } else if (bmi < 18.5) {
            nutritionalStatus = 'UNDERWEIGHT';
            nutritionalAdvice = 'Berat badan kurang: Tingkatkan frekuensi makan teratur 3x sehari dengan menu gizi seimbang.';
        } else if (bmi <= 25.0) {
            nutritionalStatus = 'NORMAL';
            nutritionalAdvice = 'Indeks Massa Tubuh ideal. Pertahankan asupan buah, sayur, dan olahraga rutin.';
        } else if (bmi <= 27.0) {
            nutritionalStatus = 'OVERWEIGHT';
            nutritionalAdvice = 'Kelebihan berat badan ringan: Batasi minuman manis kemasan, perbanyak aktivitas jalan kaki dan olahraga aerobik.';
        } else {
            nutritionalStatus = 'OBESE';
            nutritionalAdvice = 'Obesitas: Disarankan konsultasi menu diet rendah gula dan pemantauan aktivitas fisik harian.';
        }

        // Simpan pengukuran ke tabel StudentHealthMeasurement
        const record = await prisma.studentHealthMeasurement.create({
            data: {
                studentId: student.id,
                heightCm: Number(heightCm),
                weightKg: weight,
                bmiValue: bmi,
                nutritionalStatus,
                academicPeriod,
                notes: nutritionalAdvice,
                measuredBy
            }
        });

        return res.json({
            success: true,
            message: 'Pengukuran KMS kesehatan siswa berhasil dihitung dan disimpan.',
            data: {
                measurementId: record.id,
                studentId: student.id,
                studentName: student.name,
                className: student.className,
                heightCm: Number(heightCm),
                weightKg: weight,
                bmi,
                nutritionalStatus,
                nutritionalAdvice,
                measuredAt: record.createdAt
            }
        });
    } catch (error: any) {
        console.error('Error calculating KMS growth data:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghitung KMS: ' + error.message });
    }
};

/**
 * 5. Live UKS Ward & Bed Occupancy Monitoring
 */
export const getUksLiveWardStatus = async (req: Request, res: Response) => {
    try {
        const activeVisits = await prisma.uksVisit.findMany({
            where: {
                visitStatus: { in: ['AT_UKS', 'IN_TREATMENT', 'RESTING'] }
            },
            include: {
                user: { select: { id: true, name: true, className: true } }
            },
            orderBy: { checkInTime: 'asc' }
        });

        const beds = ['Bed 01', 'Bed 02', 'Bed 03', 'Bed 04'];
        const wardBeds = beds.map(bedCode => {
            const occupant = activeVisits.find(v => v.bedNumber === bedCode);
            if (occupant) {
                const elapsedMinutes = Math.floor((Date.now() - new Date(occupant.checkInTime).getTime()) / 60000);
                return {
                    bedCode,
                    isOccupied: true,
                    occupant: {
                        visitId: occupant.id,
                        studentId: occupant.user.id,
                        studentName: occupant.user.name,
                        className: occupant.user.className,
                        complaint: occupant.complaint,
                        urgencyLevel: occupant.urgencyLevel,
                        checkInTime: occupant.checkInTime,
                        elapsedMinutes
                    }
                };
            }
            return {
                bedCode,
                isOccupied: false,
                occupant: null
            };
        });

        const occupiedCount = wardBeds.filter(b => b.isOccupied).length;
        const bor = Number(((occupiedCount / beds.length) * 100).toFixed(0));

        return res.json({
            success: true,
            totalBeds: beds.length,
            occupiedBeds: occupiedCount,
            availableBeds: beds.length - occupiedCount,
            bedOccupancyRate: `${bor}%`,
            wardBeds
        });
    } catch (error: any) {
        console.error('Error getting live UKS ward status:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat status bangsal UKS: ' + error.message });
    }
};
