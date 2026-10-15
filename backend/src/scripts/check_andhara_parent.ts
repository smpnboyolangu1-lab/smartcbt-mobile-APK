import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const student = await prisma.user.findFirst({
    where: { name: { contains: 'MAHESTRI' } }
  });

  console.log("Student:", student);

  if (student) {
    const parentAccounts = await prisma.user.findMany({
      where: {
        OR: [
          { username: `P${student.nisn}` },
          { username: `p${student.nisn}` },
          { username: student.parentPhone || '___none___' },
          { name: student.fatherName || '___none___' },
          { name: student.motherName || '___none___' },
          { role: 'PARENT' }
        ]
      }
    });

    console.log("Matching Parent accounts:", parentAccounts.filter(p => 
      p.username.includes(student.nisn || '') ||
      (student.parentPhone && p.username === student.parentPhone) ||
      (student.fatherName && p.name === student.fatherName) ||
      (student.motherName && p.name === student.motherName)
    ));

    // Also check login history for student
    console.log("Student lastLogin:", student.lastLogin);
    console.log("Student deviceBindingId:", student.deviceBindingId);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
