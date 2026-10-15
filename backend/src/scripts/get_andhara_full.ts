import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: {
      name: { contains: 'MAHESTRI' }
    },
    include: {
      class: true
    }
  });

  console.log("=== USER DETAILS ===");
  console.log(JSON.stringify(user, null, 2));

  if (!user) return;

  console.log("\n=== ATTENDANCE RECORDS FOR USER ===");
  const attendances = await prisma.attendance.findMany({
    where: { userId: user.id },
    orderBy: { scanTime: 'desc' },
    take: 10
  });
  console.log(JSON.stringify(attendances, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
