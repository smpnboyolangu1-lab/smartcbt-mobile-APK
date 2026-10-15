const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const bioCols = await prisma.$queryRawUnsafe('PRAGMA table_info(biodata_siswa)');
    console.log('biodata_siswa:', bioCols.map(c => c.name));
    const userCols = await prisma.$queryRawUnsafe('PRAGMA table_info(User)');
    console.log('User:', userCols.map(c => c.name));
    const ayahCols = await prisma.$queryRawUnsafe('PRAGMA table_info(biodata_ayah)');
    console.log('biodata_ayah:', ayahCols.map(c => c.name));
    const ibuCols = await prisma.$queryRawUnsafe('PRAGMA table_info(biodata_ibu)');
    console.log('biodata_ibu:', ibuCols.map(c => c.name));
    const waliCols = await prisma.$queryRawUnsafe('PRAGMA table_info(biodata_wali)');
    console.log('biodata_wali:', waliCols.map(c => c.name));
}

main().catch(console.error).finally(() => prisma.$disconnect());
