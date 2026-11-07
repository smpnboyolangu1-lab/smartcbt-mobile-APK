const { PrismaClient } = require('../backend/node_modules/@prisma/client');
require('../backend/node_modules/dotenv').config({ path: 'backend/.env' });
const prisma = new PrismaClient();

async function updateSchedule() {
    const cur = await prisma.gateSetting.findFirst();
    const id = cur?.id || 'default';

    const newDailySchedule = [
        { day: 1, dayName: 'Senin', isActive: true, gateInStart: '06:00', gateInEnd: '07:00', gateInMax: '08:00', gateOutStart: '12:00', gateOutEnd: '16:00' },
        { day: 2, dayName: 'Selasa', isActive: true, gateInStart: '06:00', gateInEnd: '07:00', gateInMax: '08:00', gateOutStart: '12:00', gateOutEnd: '16:00' },
        { day: 3, dayName: 'Rabu', isActive: true, gateInStart: '06:00', gateInEnd: '07:00', gateInMax: '08:00', gateOutStart: '12:00', gateOutEnd: '16:00' },
        { day: 4, dayName: 'Kamis', isActive: true, gateInStart: '06:00', gateInEnd: '07:00', gateInMax: '08:00', gateOutStart: '12:00', gateOutEnd: '16:00' },
        { day: 5, dayName: 'Jumat', isActive: true, gateInStart: '06:00', gateInEnd: '07:00', gateInMax: '08:00', gateOutStart: '10:00', gateOutEnd: '16:00' },
        { day: 6, dayName: 'Sabtu', isActive: true, gateInStart: '06:00', gateInEnd: '07:00', gateInMax: '08:00', gateOutStart: '11:00', gateOutEnd: '16:00' },
        { day: 0, dayName: 'Minggu', isActive: false, gateInStart: '06:00', gateInEnd: '07:00', gateInMax: '08:00', gateOutStart: '12:00', gateOutEnd: '16:00' }
    ];

    const updated = await prisma.gateSetting.upsert({
        where: { id },
        update: {
            gateOutStartTime: '12:00',
            gateOutEndTime: '16:00',
            dailySchedule: JSON.stringify(newDailySchedule),
            updatedBy: 'Sistem (Instruksi Jam Kepulangan: Jum 10:00, Sab 11:00, Sen-Kam 12:00)',
            updatedAt: new Date()
        },
        create: {
            id: 'default',
            gateInStartTime: '06:00',
            gateInEndTime: '07:00',
            gateInMaxTime: '08:00',
            gateOutStartTime: '12:00',
            gateOutEndTime: '16:00',
            dailySchedule: JSON.stringify(newDailySchedule),
            updatedBy: 'Sistem (Instruksi Jam Kepulangan)'
        }
    });

    console.log('Successfully updated GateSetting:');
    console.log('- gateOutStartTime:', updated.gateOutStartTime);
    console.log('- dailySchedule:', JSON.parse(updated.dailySchedule));

    await prisma.$disconnect();
}

updateSchedule().catch(err => {
    console.error('Error updating GateSetting:', err);
    process.exit(1);
});
