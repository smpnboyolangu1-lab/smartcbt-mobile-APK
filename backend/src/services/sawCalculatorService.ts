import prisma from '../utils/db';

/**
 * Konfigurasi 4 Indikator Standar EWS SIBOY (Metode Simple Additive Weighting / SAW)
 * Total Bobot Wajib = 1.00 (100%)
 */
export const BOBOT_EWS_4_INDIKATOR = {
    disiplin: 0.30,   // Indikator 1: Presensi, Keterlambatan, Membolos
    tataTertib: 0.25, // Indikator 2: Atribut, Seragam, Merokok/Vape, Fasilitas, Gerbang
    akademik: 0.25,   // Indikator 3: Ketuntasan Tugas, Nilai CBT, Kejujuran Ujian
    karakter: 0.20    // Indikator 4: Etika, Sopan Santun, Catatan Konseling, Hubungan Sosial
};

const MAX_POINTS_REFERENCE = 100.0;

/**
 * Menghitung skor SAW (Simple Additive Weighting) untuk satu siswa
 * Menggunakan 4 Indikator Standar SIBOY, Skala Skor 0 - 100.
 */
export async function calculateSawForStudent(siswaId: string): Promise<any> {
    try {
        const [violations, attendances, homeworks] = await Promise.all([
            prisma.bkViolationPointRecord.findMany({
                where: { siswaId }
            }),
            prisma.attendance.findMany({
                where: { userId: siswaId },
                take: 60,
                orderBy: { scanTime: 'desc' }
            }),
            prisma.homeworkSubmission.findMany({
                where: { userId: siswaId },
                take: 30,
                orderBy: { submittedAt: 'desc' }
            })
        ]);

        const totalPoin = violations.reduce((sum, v) => sum + (v.bobotPoin || 5), 0);

        // 1. Pengelompokan Poin Pelanggaran ke dalam 4 Indikator SIBOY
        let disiplinPoin = 0;
        let tataTertibPoin = 0;
        let akademikPoin = 0;
        let karakterPoin = 0;

        for (const v of violations) {
            const j = (v.jenis || '').toUpperCase();
            if (j.includes('TERLAMBAT') || j.includes('MEMBOLOS') || j.includes('ABSEN') || j.includes('PULANG')) {
                disiplinPoin += v.bobotPoin || 5;
            } else if (j.includes('SERAGAM') || j.includes('RAMBUT') || j.includes('ATRIBUT') || j.includes('ROKOK') || j.includes('VAPE') || j.includes('GATEPASS') || j.includes('KELUAR')) {
                tataTertibPoin += v.bobotPoin || 5;
            } else if (j.includes('TUGAS') || j.includes('UJIAN') || j.includes('CONTEK') || j.includes('NILAI')) {
                akademikPoin += v.bobotPoin || 5;
            } else {
                karakterPoin += v.bobotPoin || 5;
            }
        }

        // 2. Pertimbangkan Presensi Riil untuk Indikator Disiplin
        const lateCount = attendances.filter(a => a.status === 'LATE').length;
        const absentCount = attendances.filter(a => a.status === 'ABSENT' || a.status === 'TRUANT').length;
        disiplinPoin += (lateCount * 2) + (absentCount * 5);

        // 3. Normalisasi Skor per Indikator (Cost Criteria: semakin sedikit pelanggaran, semakin mendekati 1.0)
        const calcSubScore = (pts: number) => Math.max(0.0, Math.min(1.0, parseFloat((1.0 - (pts / MAX_POINTS_REFERENCE)).toFixed(3))));

        const rawDisiplin = calcSubScore(disiplinPoin);
        const rawTataTertib = calcSubScore(tataTertibPoin);
        const rawAkademik = calcSubScore(akademikPoin);
        const rawKarakter = calcSubScore(karakterPoin);

        // 4. Komposit SAW Akhir (0.000 - 1.000)
        const skorFinalSaw = parseFloat((
            (BOBOT_EWS_4_INDIKATOR.disiplin * rawDisiplin) +
            (BOBOT_EWS_4_INDIKATOR.tataTertib * rawTataTertib) +
            (BOBOT_EWS_4_INDIKATOR.akademik * rawAkademik) +
            (BOBOT_EWS_4_INDIKATOR.karakter * rawKarakter)
        ).toFixed(3));

        // 5. Konversi ke Skor 0 - 100
        const skor100 = Math.round(skorFinalSaw * 100);

        // 6. Evaluasi Level SP & Status Risiko EWS
        let rekomendasiSp = 'NONE';
        let statusRisiko = 'AMAN';
        let badgeColor = 'green';

        if (skor100 < 50 || totalPoin >= 100) {
            rekomendasiSp = totalPoin >= 150 ? 'SP3' : 'SP2';
            statusRisiko = 'KRITIS';
            badgeColor = 'red';
        } else if (skor100 < 70 || totalPoin >= 50) {
            rekomendasiSp = 'SP1';
            statusRisiko = 'PERHATIAN_KHUSUS';
            badgeColor = 'amber';
        } else if (skor100 < 85 || totalPoin >= 20) {
            rekomendasiSp = 'NONE';
            statusRisiko = 'WASPADA';
            badgeColor = 'yellow';
        } else {
            rekomendasiSp = 'NONE';
            statusRisiko = 'AMAN';
            badgeColor = 'green';
        }

        // Simpan ke tabel cache bkSawRankingCache
        const cache = await (prisma as any).bkSawRankingCache.upsert({
            where: { siswaId },
            create: {
                siswaId,
                totalPoin,
                skorTertib: rawTataTertib,
                skorDisiplin: rawDisiplin,
                skorEtika: rawKarakter,
                skorAkademik: rawAkademik,
                skorEstetika: rawTataTertib,
                skorFinalSaw,
                rekomendasiSp,
                lastCalculated: new Date()
            },
            update: {
                totalPoin,
                skorTertib: rawTataTertib,
                skorDisiplin: rawDisiplin,
                skorEtika: rawKarakter,
                skorAkademik: rawAkademik,
                skorEstetika: rawTataTertib,
                skorFinalSaw,
                rekomendasiSp,
                lastCalculated: new Date()
            }
        });

        return {
            ...cache,
            skor100,
            skorSaw100: skor100,
            statusRisiko,
            badgeColor,
            indikator: {
                disiplin: { skor: Math.round(rawDisiplin * 100), bobot: BOBOT_EWS_4_INDIKATOR.disiplin, poin: disiplinPoin },
                tataTertib: { skor: Math.round(rawTataTertib * 100), bobot: BOBOT_EWS_4_INDIKATOR.tataTertib, poin: tataTertibPoin },
                akademik: { skor: Math.round(rawAkademik * 100), bobot: BOBOT_EWS_4_INDIKATOR.akademik, poin: akademikPoin },
                karakter: { skor: Math.round(rawKarakter * 100), bobot: BOBOT_EWS_4_INDIKATOR.karakter, poin: karakterPoin }
            }
        };
    } catch (e) {
        console.error(`Error calculating SAW for student ${siswaId}:`, e);
        return null;
    }
}

/**
 * Menghitung skor SAW untuk seluruh siswa aktif di sekolah
 */
export async function calculateSawForAllStudents(): Promise<number> {
    try {
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { id: true }
        });

        let count = 0;
        for (const s of students) {
            const res = await calculateSawForStudent(s.id);
            if (res) count++;
        }

        console.log(`✅ [EWS SAW Engine] Berhasil menghitung skor SAW (4 Indikator, Skor 0-100) untuk ${count} siswa.`);
        return count;
    } catch (e) {
        console.error('Error calculating SAW for all students:', e);
        return 0;
    }
}
