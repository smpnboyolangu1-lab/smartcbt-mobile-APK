export interface GeocodingResult {
    alamatLengkap: string;
    rt: string;
    rw: string;
    dusun: string;
    desaKelurahan: string;
    kecamatan: string;
    kabupaten: string;
    kodePos: string;
    jarakKm: number;
    waktuTempuhMenit: number;
}

// Koordinat SMPN 1 Boyolangu, Tulungagung
const SIBOY_LAT = -8.088611;
const SIBOY_LNG = 111.916389;

function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
}

export class GeocodingService {
    static async reverseGeocode(latitude: number, longitude: number): Promise<GeocodingResult> {
        const jarakKm = calculateHaversineDistance(latitude, longitude, SIBOY_LAT, SIBOY_LNG);
        // Estimasi waktu tempuh dengan sepeda motor (asumsi 30 km/jam)
        const waktuTempuhMenit = Math.max(5, Math.round((jarakKm / 30) * 60));

        // Default Tulungagung fallback
        let desa = 'Boyolangu';
        let kecamatan = 'Boyolangu';
        let dusun = 'Dusun Krajan';
        let kodePos = '66235';

        // Penentuan kecamatan berdasarkan koordinat perkiraan Tulungagung
        if (latitude > -8.06) {
            kecamatan = 'Kedungwaru';
            desa = 'Ketanon';
            kodePos = '66226';
        } else if (longitude < 111.89) {
            kecamatan = 'Gondang';
            desa = 'Gondang';
            kodePos = '66263';
        } else if (latitude < -8.11) {
            kecamatan = 'Campurdarat';
            desa = 'Campurdarat';
            kodePos = '66272';
        }

        const alamatLengkap = `${dusun}, RT 02 / RW 01, Desa ${desa}, Kec. ${kecamatan}, Kab. Tulungagung, Jawa Timur`;

        return {
            alamatLengkap,
            rt: '02',
            rw: '01',
            dusun,
            desaKelurahan: desa,
            kecamatan,
            kabupaten: 'Tulungagung',
            kodePos,
            jarakKm,
            waktuTempuhMenit
        };
    }
}
