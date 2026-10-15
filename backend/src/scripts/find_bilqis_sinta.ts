import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: 'FAHIRA' } },
        { name: { contains: 'BILQIS' } },
        { name: { contains: 'BLIQIS' } },
        { name: { contains: 'SINTA' } },
        { name: { contains: 'SAHIRA' } },
        { name: { contains: 'SHINTA' } },
        { name: { contains: 'zahra' } },
        { name: { contains: 'zahrina' } }
      ]
    },
    select: { id: true, name: true, username: true, nisn: true, className: true }
  });
  console.log('Total found:', users.length);
  for (const u of users) {
    console.log(`[USER] Name: ${u.name} | Class: ${u.className} | NISN: ${u.nisn || u.username} | ID: ${u.id}`);
  }
}

main().finally(() => prisma.$disconnect());
