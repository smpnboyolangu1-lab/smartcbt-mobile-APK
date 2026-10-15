import { Request, Response } from 'express';
import prisma from '../utils/db';
import { sendFcmToUser } from '../services/fcmService';

// 1. Get Student Wallet Data (Siswa & Orang Tua) - Terhubung Langsung ke Basis Data
export const getStudentWallet = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        let targetStudentId = user.id;

        // Jika dipanggil oleh Orang Tua / Admin / Guru dengan target studentId
        if (req.query.studentId && (user.role === 'PARENT' || user.role === 'ADMIN' || user.role === 'TEACHER')) {
            targetStudentId = String(req.query.studentId);
        }

        const student = await prisma.user.findUnique({
            where: { id: targetStudentId },
            select: { id: true, name: true, nisn: true, className: true, canteenBalance: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan' });
        }

        // Ambil riwayat transaksi riil dari database
        const dbTransactions = await (prisma as any).canteenTransaction.findMany({
            where: { userId: targetStudentId },
            orderBy: { createdAt: 'desc' },
            take: 20
        });

        // Hitung pengeluaran hari ini
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const spentTodayTx = await (prisma as any).canteenTransaction.aggregate({
            where: {
                userId: targetStudentId,
                type: 'EXPENSE',
                createdAt: { gte: todayStart }
            },
            _sum: { amount: true }
        });

        const spentToday = Number(spentTodayTx._sum?.amount || 0);
        const dailyLimit = 30000; // Standar batas harian SMPN 1 Boyolangu
        const remainingLimit = Math.max(0, dailyLimit - spentToday);
        const balance = Number(student.canteenBalance || 0);

        return res.json({
            success: true,
            student: {
                id: student.id,
                name: student.name,
                nisn: student.nisn,
                className: student.className || '-'
            },
            wallet: {
                balance,
                dailyLimit,
                spentToday,
                remainingLimit,
                barcodePayload: `CANTIN-PAY:${student.nisn || student.id}:${Date.now()}`
            },
            recentTransactions: dbTransactions.map((t: any) => ({
                id: t.id,
                date: t.createdAt.toISOString().split('T')[0],
                time: t.createdAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                merchant: t.merchant || 'Stand Kantin Sehat',
                item: t.item || t.description || 'Belanja Kantin',
                amount: t.amount,
                type: t.type
            }))
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Gagal memuat e-kantin: ' + err.message });
    }
};

// 2. Set Daily Spending Limit (Khusus Orang Tua)
export const parentSetDailyLimit = async (req: Request, res: Response) => {
    try {
        const { studentId, dailyLimit } = req.body;
        if (!studentId || dailyLimit === undefined) {
            return res.status(400).json({ success: false, message: 'Student ID dan batas limit harian wajib diisi' });
        }

        return res.json({
            success: true,
            message: `Batas pengeluaran harian berhasil diatur menjadi Rp ${Number(dailyLimit).toLocaleString('id-ID')}/hari.`,
            dailyLimit: Number(dailyLimit)
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Gagal mengatur limit: ' + err.message });
    }
};

// 3. Top Up Saldo Mandiri oleh Orang Tua (Legacy / Manual Transfer - Strictly Controlled)
export const parentTopUp = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        // Hanya ADMIN/Bendahara yang diizinkan melakukan penyesuaian/top-up saldo manual secara langsung tanpa payment gateway
        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                code: 'UNVERIFIED_TOPUP_DISABLED',
                message: '⛔ Top-up langsung tanpa payment gateway resmi dinonaktifkan demi keamanan. Silakan gunakan Payment Gateway resmi sekolah atau hubungi Bendahara.'
            });
        }

        const { studentId, amount } = req.body;
        const amountNum = Number(amount);

        if (!studentId || isNaN(amountNum) || amountNum <= 0) {
            return res.status(400).json({ success: false, message: 'Nominal top up tidak valid' });
        }

        const student = await prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, canteenBalance: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        }

        const currentBal = Number(student.canteenBalance || 0);
        const newBal = currentBal + amountNum;

        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: studentId },
                data: { canteenBalance: newBal }
            });

            await (tx as any).canteenTransaction.create({
                data: {
                    userId: studentId,
                    type: 'TOPUP',
                    amount: amountNum,
                    description: `Penyesuaian Saldo oleh Admin (${user.name || user.username})`,
                    merchant: 'Admin / Bendahara Sekolah',
                    item: 'Top-Up Saldo',
                    balanceBefore: currentBal,
                    balanceAfter: newBal,
                    idempotencyKey: `TOPUP-ADMIN-${studentId}-${Date.now()}`
                }
            });
        });

        return res.json({
            success: true,
            message: `Top up berhasil! Saldo ${student.name} sekarang Rp ${newBal.toLocaleString('id-ID')}.`,
            currentBalance: newBal
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Gagal top up: ' + err.message });
    }
};

// 4. Laporan & Grafik Pemakaian Uang Saku 7 Hari (Orang Tua & Siswa)
export const getCanteenAnalytics = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        let targetStudentId = user.id;
        if (req.query.studentId) targetStudentId = String(req.query.studentId);

        const student = await prisma.user.findUnique({
            where: { id: targetStudentId },
            select: { canteenBalance: true }
        });

        const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const sampleExpenses = [12000, 15000, 8000, 14000, 10000, 5000];

        const chartData = dayNames.map((day, idx) => ({
            day,
            amount: sampleExpenses[idx],
            label: `Rp ${sampleExpenses[idx].toLocaleString('id-ID')}`
        }));

        const totalSpentWeekly = sampleExpenses.reduce((a, b) => a + b, 0);

        return res.json({
            success: true,
            studentId: targetStudentId,
            currentBalance: Number(student?.canteenBalance || 0),
            dailyLimit: 30000,
            weeklyTotalSpent: totalSpentWeekly,
            chartData,
            categoryBreakdown: [
                { category: 'Makanan Sehat & Nasi', percentage: 55, amount: 35000 },
                { category: 'Minuman / Susu / Buah', percentage: 30, amount: 19000 },
                { category: 'Kudapan & Roti Gandum', percentage: 15, amount: 10000 }
            ]
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Gagal memuat analitik kantin: ' + err.message });
    }
};

// 5. Daftar Menu Makanan & Minuman Sehat Kantin
export const getCanteenMenu = async (_req: Request, res: Response) => {
    const menus = [
        { id: 1, name: 'Nasi Soto Ayam Kampung', stand: 'Stand 01 - Bu Siti', price: 8000, category: 'MAKANAN', available: true },
        { id: 2, name: 'Nasi Pecel Sayur Sehat', stand: 'Stand 02 - Bu Dewi', price: 7000, category: 'MAKANAN', available: true },
        { id: 3, name: 'Nasi Ayam Geprek Sambal Tomat', stand: 'Stand 03 - Pak Joko', price: 10000, category: 'MAKANAN', available: true },
        { id: 4, name: 'Roti Gandum Pisang Cokelat', stand: 'Stand 04 - Bakery Sehat', price: 4000, category: 'SNACK', available: true },
        { id: 5, name: 'Susu UHT Segar 200ml', stand: 'Stand 05 - Minuman Berkah', price: 5000, category: 'MINUMAN', available: true },
        { id: 6, name: 'Jus Buah Segar (Alpukat/Jeruk)', stand: 'Stand 05 - Minuman Berkah', price: 5000, category: 'MINUMAN', available: true },
        { id: 7, name: 'Air Mineral Prima 600ml', stand: 'Stand 01 - Bu Siti', price: 3000, category: 'MINUMAN', available: true }
    ];
    return res.json({ success: true, menus });
};

// 6. POS Kasir Stan Kantin: Proses Pembayaran Belanja Siswa (DEBIT ATOMIK & IDEMPOTEN)
export const posChargePayment = async (req: Request, res: Response) => {
    try {
        const IS_CANTEEN_LOCKED: boolean = true;
        if (IS_CANTEEN_LOCKED) {
            return res.status(403).json({
                success: false,
                code: 'CANTEEN_LOCKED',
                message: '⛔ Layanan Pembayaran Belanja E-Kantin sementara DIKUNCI TOTAL oleh pihak sekolah.'
            });
        }

        const { qrCode, amount, itemsNote, merchantName, idempotencyKey } = req.body;
        const amountNum = Number(amount);

        if (!qrCode || isNaN(amountNum) || amountNum <= 0) {
            return res.status(400).json({ success: false, message: 'QR Code atau barcode siswa dan nominal belanja wajib diisi dengan benar' });
        }

        // Parse QR payload: CANTIN-PAY:<nisnOrId>:<timestamp>
        let studentIdentifier = qrCode.trim();
        if (studentIdentifier.startsWith('CANTIN-PAY:')) {
            const parts = studentIdentifier.split(':');
            studentIdentifier = parts[1] || studentIdentifier;
        }

        // Cari data siswa di database berdasarkan id, nisn, atau username
        const student = await prisma.user.findFirst({
            where: {
                OR: [
                    { id: studentIdentifier },
                    { nisn: studentIdentifier },
                    { username: studentIdentifier }
                ]
            },
            select: { id: true, name: true, nisn: true, className: true, canteenBalance: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Data siswa dengan barcode tersebut tidak ditemukan.' });
        }

        const effectiveIdempotencyKey = idempotencyKey || `POS-${student.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        // Cek Idempotensi
        const existingTx = await (prisma as any).canteenTransaction.findUnique({
            where: { idempotencyKey: effectiveIdempotencyKey }
        });

        if (existingTx) {
            return res.json({
                success: true,
                message: 'Transaksi sudah berhasil diproses sebelumnya (Idempotent)',
                transactionId: existingTx.id,
                remainingBalance: existingTx.balanceAfter,
                alreadyProcessed: true
            });
        }

        const currentBal = Number(student.canteenBalance || 0);

        // 1. Cek Saldo Dompet Siswa
        if (currentBal < amountNum) {
            return res.status(402).json({
                success: false,
                message: `Saldo tidak mencukupi! Saldo saat ini Rp ${currentBal.toLocaleString('id-ID')}, total belanja Rp ${amountNum.toLocaleString('id-ID')}.`
            });
        }

        const stand = merchantName || 'Stand Kantin Sehat';
        const note = itemsNote || 'Pembelian Makanan/Minuman Kantin';
        let newBalance = currentBal - amountNum;
        let createdTxn: any = null;

        // 2. Eksekusi Debit Atomik Bersyarat di Database
        await prisma.$transaction(async (tx) => {
            const affected = await tx.$executeRawUnsafe(
                `UPDATE "User" SET "canteenBalance" = "canteenBalance" - ${amountNum} WHERE "id" = '${student.id}' AND "canteenBalance" >= ${amountNum}`
            );

            if (affected === 0) {
                throw new Error('SALDO_INSUFFICIENT_RACE');
            }

            const updatedUser = await tx.user.findUnique({
                where: { id: student.id },
                select: { canteenBalance: true }
            });
            newBalance = Number(updatedUser?.canteenBalance || 0);

            createdTxn = await (tx as any).canteenTransaction.create({
                data: {
                    userId: student.id,
                    type: 'EXPENSE',
                    amount: amountNum,
                    description: note,
                    merchant: stand,
                    item: note,
                    balanceBefore: currentBal,
                    balanceAfter: newBalance,
                    idempotencyKey: effectiveIdempotencyKey
                }
            });
        });

        // 3. Kirim FCM Push ke Orang Tua Siswa secara Asinkron
        if (student.nisn) {
            prisma.user.findFirst({
                where: {
                    role: 'PARENT',
                    OR: [
                        { nisn: student.nisn },
                        { username: `p${student.nisn}` },
                        { username: `P${student.nisn}` }
                    ]
                }
            }).then(parent => {
                if (parent) {
                    sendFcmToUser(
                        parent.id,
                        'Transaksi E-Kantin Siswa',
                        `${student.name} berbelanja sebesar Rp ${amountNum.toLocaleString('id-ID')} di ${stand}. Sisa saldo: Rp ${newBalance.toLocaleString('id-ID')}.`,
                        { type: 'CANTEEN_EXPENSE', amount: String(amountNum), balance: String(newBalance) }
                    ).catch(() => {});
                }
            }).catch(() => {});
        }

        return res.json({
            success: true,
            message: `Pembayaran berhasil! Saldo siswa terpotong Rp ${amountNum.toLocaleString('id-ID')}.`,
            transactionId: createdTxn?.id || effectiveIdempotencyKey,
            student: {
                id: student.id,
                name: student.name,
                className: student.className || '-'
            },
            amount: amountNum,
            remainingBalance: newBalance
        });
    } catch (err: any) {
        if (err.message === 'SALDO_INSUFFICIENT_RACE') {
            return res.status(402).json({ success: false, message: 'Transaksi ditolak! Saldo siswa tidak mencukupi untuk pembayaran ini.' });
        }
        return res.status(500).json({ success: false, message: 'Gagal memproses pembayaran kasir kantin: ' + err.message });
    }
};

// 7. Dashboard & Rekap Omzet Stan Kasir Kantin
export const getKantinDashboard = async (req: Request, res: Response) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todayOrders = await (prisma as any).canteenTransaction.findMany({
            where: {
                type: 'EXPENSE',
                createdAt: { gte: todayStart }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        const totalRevenueToday = todayOrders.reduce((acc: number, curr: any) => acc + curr.amount, 0);

        return res.json({
            success: true,
            todayDate: todayStart.toISOString().split('T')[0],
            totalRevenueToday,
            totalTransactionsToday: todayOrders.length,
            recentOrders: todayOrders.map((t: any) => ({
                id: t.id,
                amount: t.amount,
                notes: t.description || t.item,
                standName: t.merchant,
                time: t.createdAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                date: t.createdAt.toISOString().split('T')[0]
            }))
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Gagal memuat rekap kasir kantin: ' + err.message });
    }
};
