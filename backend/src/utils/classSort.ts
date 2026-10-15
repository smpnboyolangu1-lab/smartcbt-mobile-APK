/**
 * Utilitas Pengurutan Rombel dan Kelas Standar SMP Negeri 1 Boyolangu
 * Memastikan urutan kelas dan jenjang SELALU diawali dari:
 * 1. Kelas VII (VII-A, VII-B, ... VII-K)
 * 2. Kelas VIII (VIII-A, VIII-B, ... VIII-K)
 * 3. Kelas IX (IX-A, IX-B, ... IX-K)
 */

export function getClassRank(className: string | null | undefined): { grade: number; suffix: string } {
    const raw = (className || '').trim();
    if (!raw) return { grade: 999, suffix: '' };

    const upper = raw.toUpperCase();

    // Prioritas pemeriksaan:
    // Wajib cek VIII sebelum VII karena kata 'VIII' mengandung 'VII'!
    if (upper.startsWith('VIII') || upper.startsWith('8') || /\bVIII\b/.test(upper)) {
        const suffix = upper.replace(/^.*?VIII[-_ ]?/, '').replace(/^.*?8[-_ ]?/, '').trim();
        return { grade: 8, suffix };
    }
    if (upper.startsWith('VII') || upper.startsWith('7') || /\bVII\b/.test(upper)) {
        const suffix = upper.replace(/^.*?VII[-_ ]?/, '').replace(/^.*?7[-_ ]?/, '').trim();
        return { grade: 7, suffix };
    }
    if (upper.startsWith('IX') || upper.startsWith('9') || /\bIX\b/.test(upper)) {
        const suffix = upper.replace(/^.*?IX[-_ ]?/, '').replace(/^.*?9[-_ ]?/, '').trim();
        return { grade: 9, suffix };
    }
    if (upper.startsWith('X') || upper.startsWith('10') || /\bX\b/.test(upper)) {
        const suffix = upper.replace(/^.*?X[-_ ]?/, '').replace(/^.*?10[-_ ]?/, '').trim();
        return { grade: 10, suffix };
    }
    if (upper.startsWith('XI') || upper.startsWith('11') || /\bXI\b/.test(upper)) {
        const suffix = upper.replace(/^.*?XI[-_ ]?/, '').replace(/^.*?11[-_ ]?/, '').trim();
        return { grade: 11, suffix };
    }
    if (upper.startsWith('XII') || upper.startsWith('12') || /\bXII\b/.test(upper)) {
        const suffix = upper.replace(/^.*?XII[-_ ]?/, '').replace(/^.*?12[-_ ]?/, '').trim();
        return { grade: 12, suffix };
    }

    return { grade: 99, suffix: upper };
}

/**
 * Komparator pengurutan nama kelas: Urutan VII -> VIII -> IX
 */
export function compareClassNames(classA: string | null | undefined, classB: string | null | undefined): number {
    const a = (classA || '').trim();
    const b = (classB || '').trim();

    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;

    const rankA = getClassRank(a);
    const rankB = getClassRank(b);

    if (rankA.grade !== rankB.grade) {
        return rankA.grade - rankB.grade;
    }

    // Jika tingkatan sama (misal sama-sama VII), urutkan berdasarkan abjad rombel (A, B, C, ...)
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Helper mengurutkan array objek siswa berdasarkan Kelas (VII -> VIII -> IX) lalu Nama
 */
export function sortStudentsByGradeAndName<T extends { className?: string | null; name: string }>(students: T[]): T[] {
    return [...students].sort((a, b) => {
        const classComp = compareClassNames(a.className, b.className);
        if (classComp !== 0) return classComp;
        return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
    });
}
