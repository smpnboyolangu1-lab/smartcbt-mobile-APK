const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addColIfMissing(table, colName, colType) {
    try {
        const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info(${table})`);
        const exists = cols.some(c => c.name === colName);
        if (!exists) {
            await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType}`);
            console.log(`Added column ${colName} to ${table}`);
        } else {
            console.log(`Column ${colName} already exists on ${table}`);
        }
    } catch (e) {
        console.error(`Error on ${table}.${colName}:`, e.message);
    }
}

async function main() {
    await addColIfMissing('biodata_siswa', 'status_dalam_keluarga', "TEXT DEFAULT 'Anak Kandung'");
    await addColIfMissing('biodata_siswa', 'sekolah_asal', 'TEXT');
    await addColIfMissing('biodata_siswa', 'diterima_kelas', 'TEXT');
    await addColIfMissing('biodata_siswa', 'diterima_tanggal', 'TEXT');
    await addColIfMissing('biodata_siswa', 'telepon_rumah', 'TEXT');

    await addColIfMissing('biodata_ayah', 'alamat', 'TEXT');
    await addColIfMissing('biodata_ibu', 'alamat', 'TEXT');
    console.log('Database migration completed successfully.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
