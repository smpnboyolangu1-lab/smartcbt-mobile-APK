/**
 * Utility Formatting Tanggal & Waktu Khusus Server SIBOY (WIB / Asia/Jakarta)
 * Mencegah bug double-offset pada kolom database TIMESTAMP WITHOUT TIME ZONE (PostgreSQL/SQLite)
 */

export function formatTimeWib(dateInput: Date | string | null | undefined, includeSeconds: boolean = false): string {
    if (!dateInput) return '-';
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);
        // Kolom timestamp without time zone PostgreSQL dibaca driver sebagai UTC (akhiran 'Z').
        // UTC hours/minutes mewakili jam/menit asli WIB yang disimpan di database.
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        if (includeSeconds) {
            const ss = String(d.getUTCSeconds()).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        }
        return `${hh}:${mm}`;
    } catch {
        return '-';
    }
}

export function formatTimeWibWithSuffix(dateInput: Date | string | null | undefined, includeSeconds: boolean = false): string {
    const formatted = formatTimeWib(dateInput, includeSeconds);
    return formatted === '-' ? '-' : `${formatted} WIB`;
}

export function formatDateWib(dateInput: Date | string | null | undefined): string {
    if (!dateInput) return '-';
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    } catch {
        return '-';
    }
}

const MONTHS_ID_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function formatDateWibShort(dateInput: Date | string | null | undefined): string {
    if (!dateInput) return '-';
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);
        const dd = d.getUTCDate();
        const month = MONTHS_ID_SHORT[d.getUTCMonth()] || '';
        return `${dd} ${month}`;
    } catch {
        return '-';
    }
}

