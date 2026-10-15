import prisma from '../utils/db';
import { getDetailedAttendance } from '../controllers/studentController';

async function main() {
  const user = await prisma.user.findFirst({
    where: { nisn: '144921502' }
  });
  console.log('Testing Nur Laela:', user?.name, user?.id);

  const req = {
    user: { id: user?.id, role: 'STUDENT', username: user?.username },
    query: { month: '10', year: '2026' }
  } as any;
  let resJson: any = null;
  const res = {
    json: (data: any) => { resJson = data; },
    status: () => res
  } as any;

  await getDetailedAttendance(req, res);
  console.log('Today record for Nur Laela:');
  const todayRec = resJson?.history?.find((h: any) => h.date === '2026-10-09');
  console.log(JSON.stringify(todayRec, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
