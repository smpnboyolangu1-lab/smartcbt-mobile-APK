import { Request, Response } from 'express';
import { getDetailedAttendance } from '../controllers/studentController';

async function main() {
  const req: any = {
    user: {
      id: '3fb1ff46-2758-48c1-bb49-3709c627da1a',
      role: 'STUDENT',
      name: 'ANDHARA KIRANA MAHESTRI',
      username: '3136666926'
    },
    query: {
      month: '10',
      year: '2026'
    }
  };

  let jsonResult: any = null;
  const res: any = {
    status: (code: number) => ({
      json: (data: any) => {
        console.log('Status code:', code);
        jsonResult = data;
      }
    }),
    json: (data: any) => {
      jsonResult = data;
    }
  };

  await getDetailedAttendance(req, res);
  console.log("=== JSON RESULT STATS ===");
  console.log(JSON.stringify(jsonResult?.stats, null, 2));
  console.log("=== JSON RESULT HISTORY (Count: " + (jsonResult?.history?.length || 0) + ") ===");
  console.log(JSON.stringify(jsonResult?.history, null, 2));
}

main().catch(console.error);
