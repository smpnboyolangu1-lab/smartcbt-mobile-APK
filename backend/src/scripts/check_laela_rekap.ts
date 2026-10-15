import { Request, Response } from 'express';
import { getAttendanceRekap } from '../controllers/attendanceController';

async function main() {
  const req: any = {
    query: {
      date: '2026-10-09',
      className: 'VII-A'
    }
  };

  let jsonResult: any = null;
  const res: any = {
    status: (code: number) => ({
      json: (data: any) => {
        jsonResult = data;
      }
    }),
    json: (data: any) => {
      jsonResult = data;
    }
  };

  await getAttendanceRekap(req, res);
  const laela = jsonResult?.records?.find((r: any) => r.name.includes('LAELA') || r.name.includes('YUMNA'));
  console.log("Nur Laela in rekap:", JSON.stringify(laela, null, 2));
}

main().catch(console.error);
