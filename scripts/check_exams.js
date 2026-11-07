const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const exams = await prisma.exam.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      executionDate: true,
      startTimeStr: true,
      endTimeStr: true,
      isTokenActive: true,
      token: true,
      assignedClasses: true,
      createdAt: true
    }
  });
  console.log('Total exams:', exams.length);
  for (const e of exams) {
    console.log(e);
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
