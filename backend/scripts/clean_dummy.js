const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanDummy() {
  try {
    console.log("Auditing class VII-A before cleaning...");
    const beforeStudents = await prisma.user.findMany({
      where: { role: 'STUDENT', className: 'VII-A' },
      select: { id: true, username: true, name: true, nisn: true }
    });
    console.log(`Found ${beforeStudents.length} students in VII-A:`);
    beforeStudents.forEach(s => console.log(`- [${s.id}] username: ${s.username}, name: ${s.name}, nisn: ${s.nisn}`));

    const dummies = beforeStudents.filter(s => 
      s.username === 'siswa1' || 
      s.username === 'siswa' || 
      (s.name && s.name.toLowerCase().includes('dummy')) ||
      (s.name === 'Ahmad Fauzi' && s.username === 'siswa1') ||
      (s.name === 'Bagas Ardiansah' && s.username === 'siswa')
    );

    console.log(`Identified ${dummies.length} dummy students to delete.`);

    for (const dummy of dummies) {
      console.log(`Deleting relations for student: ${dummy.name} (id: ${dummy.id}, username: ${dummy.username})...`);
      
      // Delete attendance records
      const att = await prisma.attendance.deleteMany({ where: { userId: dummy.id } });
      console.log(`  Deleted ${att.count} attendance records.`);

      // Delete exams taken
      try {
        const exams = await prisma.studentExam.deleteMany({ where: { userId: dummy.id } });
        console.log(`  Deleted ${exams.count} studentExam records.`);
      } catch (e) {
        console.log(`  Note on exams: ${e.message}`);
      }

      // Delete notifications
      try {
        const notifs = await prisma.notification.deleteMany({ 
          where: { 
            OR: [
              { recipientId: dummy.id },
              { studentId: dummy.id }
            ] 
          } 
        });
        console.log(`  Deleted ${notifs.count} notifications.`);
      } catch (e) {
        console.log(`  Note on notifications: ${e.message}`);
      }

      // Delete gatepass if any
      try {
        const passes = await prisma.gatepassRequest.deleteMany({ where: { studentId: dummy.id } });
        console.log(`  Deleted ${passes.count} gatepass requests.`);
      } catch (e) {
        console.log(`  Note on gatepasses: ${e.message}`);
      }

      // Delete user
      await prisma.user.delete({ where: { id: dummy.id } });
      console.log(`Successfully deleted dummy student: ${dummy.name}`);
    }

    const afterStudents = await prisma.user.findMany({
      where: { role: 'STUDENT', className: 'VII-A' },
      select: { id: true, username: true, name: true, nisn: true }
    });
    console.log(`Class VII-A now has exactly ${afterStudents.length} students (Target: 32).`);
  } catch (error) {
    console.error("Error during cleaning:", error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDummy();
