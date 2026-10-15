import { Request, Response } from 'express';
import { getAttendanceRekap } from '../controllers/attendanceController';

async function main() {
  const req: any = {
    query: {
      date: '2026-10-09',
      className: 'VII-C'
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

  await getAttendanceRekap(req, res);
  console.log("Total records:", jsonResult?.records?.length);
  const andhara = jsonResult?.records?.find((r: any) => r.name.includes('MAHESTRI') || r.name.includes('ANDHARA'));
  console.log("Andhara in rekap:", JSON.stringify(andhara, null, 2));
}

main().catch(console.error);
