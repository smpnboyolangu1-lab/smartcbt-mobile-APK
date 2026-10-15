import prisma from '../utils/db';
import { getDetailedAttendance } from '../controllers/studentController';

async function main() {
  const todayStart = new Date('2026-10-08T17:00:00.000Z');
  const todayEnd = new Date('2026-10-09T16:59:59.999Z');
  const allStudents = await prisma.user.findMany({
    where: { role: 'STUDENT', isActive: true },
    select: { id: true, name: true, username: true, className: true },
    take: 50
  });
  const attendedUsers = await prisma.attendance.findMany({
    where: { scanTime: { gte: todayStart, lte: todayEnd } },
    select: { userId: true }
  });
  const attendedSet = new Set(attendedUsers.map(a => a.userId));
  const absentStudents = allStudents.filter(s => !attendedSet.has(s.id));
  console.log('Total students checked:', allStudents.length);
  console.log('Absent students count:', absentStudents.length);
  if (absentStudents.length > 0) {
    const s = absentStudents[0];
    console.log('Sample absent student:', s.id, s.name, s.username, s.className);

    const atts = await prisma.attendance.findMany({
      where: { userId: s.id },
      orderBy: { scanTime: 'desc' },
      take: 5
    });
    console.log('Recent atts for absent student:', atts.map(a => ({
      scanTime: a.scanTime,
      type: a.type,
      status: a.status,
      method: a.method
    })));

    // Mock express req/res to call getDetailedAttendance
    const req = {
      user: { id: s.id, role: 'STUDENT', username: s.username },
      query: { month: '10', year: '2026' }
    } as any;
    let resJson: any = null;
    const res = {
      json: (data: any) => { resJson = data; },
      status: () => res
    } as any;

    await getDetailedAttendance(req, res);
    console.log('Response for absent student:');
    console.log('Stats:', resJson?.stats);
    console.log('History count:', resJson?.history?.length);
    console.log('Recent 3 history items:', resJson?.history?.slice(0, 3));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
