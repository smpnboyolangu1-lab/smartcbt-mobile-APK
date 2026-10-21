const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const files = await prisma.deviceFile.findMany({
        where: { filePath: { contains: 'Perangkat_Belum_Terhubung' } },
        take: 5,
        include: { device: { include: { user: true } } }
    });
    console.log('Files with Perangkat_Belum_Terhubung count:', files.length);
    console.log(JSON.stringify(files, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));

    const copyReqs = await prisma.copyRequest.findMany({
        where: { uploadPath: { contains: 'Perangkat_Belum_Terhubung' } },
        take: 5
    });
    console.log('CopyRequests with Perangkat_Belum_Terhubung:', copyReqs.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
