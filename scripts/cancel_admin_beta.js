const path = require('path');
const backendDir = path.resolve(__dirname, '../backend');
const backendNodeModules = path.join(backendDir, 'node_modules');

const dotenv = require(path.join(backendNodeModules, 'dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const { PrismaClient } = require(path.join(backendNodeModules, '@prisma/client'));
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/smartschool?schema=public'
        }
    }
});

async function main() {
    await prisma.appVersionConfig.delete({ where: { id: 'admin_beta' } }).catch(() => {});
    try {
        const jwt = require(path.join(backendNodeModules, 'jsonwebtoken'));
        const token = jwt.sign({ id: 'cli', role: 'ADMIN' }, process.env.JWT_SECRET || 'secret');
        await fetch('http://localhost:3000/api/admin/app-version/cancel-beta', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        }).catch(() => {});
    } catch (e) {}
    console.log('✅ Berhasil membatalkan versi uji coba admin. HP Admin kembali ke versi rilis publik siswa.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
