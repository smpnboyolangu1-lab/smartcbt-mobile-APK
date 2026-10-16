/**
 * Utility Formatting Tanggal & Waktu Khusus Server SIBOY (WIB / Asia/Jakarta)
 * Mencegah bug double-offset pada kolom database TIMESTAMP (PostgreSQL/SQLite)
 */

const MONTHS_ID_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function formatTimeWib(
    dateInput: Date | string | null | undefined,
    includeSeconds: boolean = false,
    fallbackNote?: string | null
): string {
    if (!dateInput) return '-';
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);

        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).formatToParts(d);

        const hh = parts.find(p => p.type === 'hour')?.value || '00';
        const mm = parts.find(p => p.type === 'minute')?.value || '00';
        const ss = parts.find(p => p.type === 'second')?.value || '00';

        // Fallback resilience: jika ada note dengan format "Pukul HH:mm WIB" atau "Scan: HH:mm:ss"
        // dan jam hasil kalkulasi berbeda jauh (>= 4 jam) akibat sisa time shift, prioritaskan jam dari note
        if (fallbackNote) {
            const m = fallbackNote.match(/(?:Pukul|Scan:)\s*(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/i);
            if (m) {
                const noteH = parseInt(m[1], 10);
                const calcH = parseInt(hh, 10);
                if (Math.abs(calcH - noteH) >= 4) {
                    const noteHh = m[1].padStart(2, '0');
                    const noteMm = m[2];
                    const noteSs = m[3] || '00';
                    return includeSeconds ? `${noteHh}.${noteMm}.${noteSs}` : `${noteHh}.${noteMm}`;
                }
            }
        }

        return includeSeconds ? `${hh}.${mm}.${ss}` : `${hh}.${mm}`;
    } catch {
        if (fallbackNote) {
            const m = fallbackNote.match(/(?:Pukul|Scan:)\s*(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/i);
            if (m) {
                const noteHh = m[1].padStart(2, '0');
                const noteMm = m[2];
                const noteSs = m[3] || '00';
                return includeSeconds ? `${noteHh}.${noteMm}.${noteSs}` : `${noteHh}.${noteMm}`;
            }
        }
        return '-';
    }
}

export function formatTimeWibWithSuffix(
    dateInput: Date | string | null | undefined,
    includeSeconds: boolean = false,
    fallbackNote?: string | null
): string {
    const formatted = formatTimeWib(dateInput, includeSeconds, fallbackNote);
    return formatted === '-' ? '-' : `${formatted} WIB`;
}

export function formatDateWib(dateInput: Date | string | null | undefined): string {
    if (!dateInput) return '-';
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);
        return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    } catch {
        return '-';
    }
}

export function formatDateWibShort(dateInput: Date | string | null | undefined): string {
    if (!dateInput) return '-';
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta',
            day: 'numeric',
            month: 'numeric'
        }).formatToParts(d);
        const day = parts.find(p => p.type === 'day')?.value || '';
        const monthNum = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
        return `${day} ${MONTHS_ID_SHORT[monthNum - 1] || ''}`;
    } catch {
        return '-';
    }
}
