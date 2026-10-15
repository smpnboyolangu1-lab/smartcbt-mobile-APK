const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const canteenTxCols = await prisma.$queryRawUnsafe(`PRAGMA table_info(CanteenTransaction)`);
    console.log('CanteenTransaction columns:', canteenTxCols.map(c => c.name));

    // Create ClassAttendanceSession table
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ClassAttendanceSession" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "classId" TEXT NOT NULL,
            "dateKey" TEXT NOT NULL,
            "type" TEXT NOT NULL,
            "openedBy" TEXT NOT NULL,
            "opensAt" DATETIME NOT NULL,
            "closesAt" DATETIME,
            "status" TEXT NOT NULL DEFAULT 'OPEN',
            "qrToken" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "ClassAttendanceSession_classId_dateKey_type_key" ON "ClassAttendanceSession"("classId", "dateKey", "type");
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ClassAttendanceSession_classId_dateKey_idx" ON "ClassAttendanceSession"("classId", "dateKey");
    `);

    // Create ClassAttendanceRecord table
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ClassAttendanceRecord" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "sessionId" TEXT NOT NULL,
            "studentId" TEXT NOT NULL,
            "status" TEXT NOT NULL,
            "source" TEXT NOT NULL DEFAULT 'STUDENT_SELF_QR',
            "scannedBy" TEXT,
            "reason" TEXT,
            "deviceId" TEXT,
            "bssid" TEXT,
            "lat" REAL,
            "lng" REAL,
            "flags" TEXT,
            "verifiedBy" TEXT,
            "verifiedAt" DATETIME,
            "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "ClassAttendanceRecord_sessionId_studentId_key" ON "ClassAttendanceRecord"("sessionId", "studentId");
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ClassAttendanceRecord_studentId_scannedAt_idx" ON "ClassAttendanceRecord"("studentId", "scannedAt");
    `);

    // Add idempotencyKey to CanteenTransaction if not exists
    const hasIdempotencyKey = canteenTxCols.some(c => c.name === 'idempotencyKey');
    if (!hasIdempotencyKey) {
        console.log('Adding idempotencyKey to CanteenTransaction...');
        await prisma.$executeRawUnsafe(`ALTER TABLE "CanteenTransaction" ADD COLUMN "idempotencyKey" TEXT;`);
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "CanteenTransaction_idempotencyKey_key" ON "CanteenTransaction"("idempotencyKey");`);
        console.log('idempotencyKey added successfully.');
    }

    console.log('Database tables ready.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
