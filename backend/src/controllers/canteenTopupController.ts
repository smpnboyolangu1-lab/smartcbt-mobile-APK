import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/db';
import { snap } from '../config/midtrans';
import { sendFcmToUser } from '../services/fcmService';

const VALID_AMOUNTS = [10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000];

/**
 * 1. POST /api/ekantin/topup/create
 * Dipanggil APK orang tua saat memilih nominal top-up
 * Auth: Role PARENT / ADMIN
 */
export async function createTopup(req: Request, res: Response) {
    try {
        const IS_CANTEEN_LOCKED: boolean = true;
        if (IS_CANTEEN_LOCKED) {
            return res.status(403).json({
                success: false,
                code: 'CANTEEN_LOCKED',
                message: '⛔ Layanan Top-Up Saldo E-Kantin sementara DIKUNCI TOTAL oleh pihak sekolah.'
            });
        }

        const user = (req as any).user;
        const parentId = user?.id;
        const { studentId, amount } = req.body;

        if (!parentId) {
            return res.status(401).json({ success: false, message: 'Autentikasi orang tua diperlukan.' });
        }

        // 1. Validasi nominal
        const amountNum = Number(amount);
        if (!VALID_AMOUNTS.includes(amountNum)) {
            return res.status(400).json({
                success: false,
                message: 'Nominal tidak valid. Pilih antara Rp10.000 - Rp100.000 (kelipatan resmi).'
            });
        }

        // 2. Validasi hubungan orang tua - siswa
        const parentUser = await prisma.user.findUnique({
            where: { id: parentId }
        });

        if (!parentUser) {
            return res.status(404).json({ success: false, message: 'Akun orang tua tidak ditemukan.' });
        }

        const cleanParentNisn = (parentUser.username || '').replace(/^[Pp]/, '').trim();

        const student = await prisma.user.findFirst({
            where: {
                id: studentId,
                role: 'STUDENT',
                ...(parentUser.role !== 'ADMIN' ? {
                    OR: [
                        { nisn: cleanParentNisn },
                        { username: cleanParentNisn },
                        ...(parentUser.nisn ? [{ nisn: parentUser.nisn }] : []),
                        ...(parentUser.parentPhone ? [{ parentPhone: parentUser.parentPhone }] : []),
                        ...(parentUser.name ? [{ fatherName: parentUser.name }, { motherName: parentUser.name }] : [])
                    ]
                } : {})
            },
            select: { id: true, name: true, nisn: true, className: true, canteenBalance: true }
        });

        if (!student) {
            return res.status(403).json({
                success: false,
                message: 'Siswa tidak terdaftar sebagai anak binaan akun Anda.'
            });
        }

        // 3. Cek apakah ada transaksi PENDING yang belum kadaluarsa
        const pendingTopup = await prisma.canteenTopup.findFirst({
            where: {
                parentId,
                studentId,
                midtransStatus: 'PENDING',
                expiredAt: { gt: new Date() }
            }
        });

        if (pendingTopup && pendingTopup.midtransToken) {
            return res.json({
                success: true,
                message: 'Transaksi sebelumnya masih aktif. Silakan selesaikan pembayaran.',
                data: {
                    orderId: pendingTopup.orderId,
                    snapToken: pendingTopup.midtransToken,
                    snapUrl: pendingTopup.midtransUrl,
                    amount: pendingTopup.amount,
                    studentName: student.name,
                    expiredAt: pendingTopup.expiredAt
                }
            });
        }

        // 4. Buat Order ID Unik
        const orderId = `TOPUP-${student.id.substring(0, 8).toUpperCase()}-${Date.now()}`;
        const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Jam

        // 5. Request Snap Token ke Midtrans
        const snapParameter = {
            transaction_details: {
                order_id: orderId,
                gross_amount: amountNum,
            },
            customer_details: {
                first_name: parentUser.name || 'Orang Tua Siswa',
                phone: parentUser.parentPhone || '',
                email: 'noreply@smpn1boyolangu.sch.id',
            },
            item_details: [{
                id: `SALDO-${student.id.substring(0, 8)}`,
                price: amountNum,
                quantity: 1,
                name: `Top-Up E-Kantin ${student.name}`,
                category: 'Pendidikan',
                merchant_name: 'SMPN 1 Boyolangu'
            }],
            enabled_payments: [
                'gopay', 'shopeepay', 'other_qris',
                'bca_va', 'bni_va', 'bri_va', 'permata_va',
                'indomaret', 'alfamart'
            ],
            expiry: {
                unit: 'hours',
                duration: 24
            },
            callbacks: {
                finish: `${process.env.APP_BASE_URL || 'https://cbt.smpn1boyolangu.my.id'}/topup/finish`,
            }
        };

        const snapResponse = await snap.createTransaction(snapParameter);

        // 6. Simpan ke Database
        const topup = await prisma.canteenTopup.create({
            data: {
                parentId,
                studentId,
                amount: amountNum,
                orderId,
                midtransToken: snapResponse.token,
                midtransUrl: snapResponse.redirect_url,
                midtransStatus: 'PENDING',
                expiredAt,
            }
        });

        return res.json({
            success: true,
            message: 'Transaksi top-up berhasil disiapkan.',
            data: {
                orderId: topup.orderId,
                snapToken: snapResponse.token,
                snapUrl: snapResponse.redirect_url,
                amount: topup.amount,
                studentName: student.name,
                expiredAt: topup.expiredAt
            }
        });

    } catch (error: any) {
        console.error('[TopUp] Error membuat transaksi:', error);
        return res.status(500).json({
            success: false,
            message: 'Gagal membuat transaksi top-up: ' + (error.message || 'Coba lagi.')
        });
    }
}

/**
 * 2. POST /api/ekantin/topup/webhook
 * Dipanggil otomatis oleh Midtrans webhook saat pembayaran terkonfirmasi
 * TIDAK perlu JWT — diverifikasi via HMAC SHA-512 Signature Key
 */
export async function handleMidtransWebhook(req: Request, res: Response) {
    try {
        const notification = req.body;

        if (!notification || !notification.order_id) {
            return res.status(400).json({ message: 'Payload webhook tidak lengkap' });
        }

        // Verifikasi Signature Midtrans
        const serverKey = process.env.MIDTRANS_SERVER_KEY;
        if (!serverKey) {
            console.error('[Webhook] MIDTRANS_SERVER_KEY belum dikonfigurasi di .env!');
            return res.status(500).json({ message: 'Konfigurasi server Midtrans belum lengkap' });
        }
        const rawSignature = (notification.order_id || '') +
            (notification.status_code || '') +
            (notification.gross_amount || '') +
            serverKey;
        const expectedSignature = crypto.createHash('sha512').update(rawSignature).digest('hex');

        if (notification.signature_key && notification.signature_key.toLowerCase() !== expectedSignature.toLowerCase()) {
            console.warn('[Webhook] Signature Midtrans TIDAK VALID! Kemungkinan spoofing.');
            return res.status(403).json({ message: 'Invalid signature key' });
        }

        const orderId: string = notification.order_id;
        const transactionStatus: string = notification.transaction_status;
        const fraudStatus: string = notification.fraud_status;

        // Cari transaksi di database
        const topup = await prisma.canteenTopup.findUnique({
            where: { orderId },
            include: {
                student: { select: { id: true, name: true, canteenBalance: true } },
                parent: { select: { id: true, name: true } }
            }
        });

        if (!topup) {
            console.warn(`[Webhook] Transaksi ${orderId} tidak ditemukan di database.`);
            return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
        }

        if (topup.midtransStatus === 'SUCCESS') {
            return res.json({ message: 'Transaksi sudah berstatus SUCCESS sebelumnya.' });
        }

        // Verifikasi kesesuaian gross_amount Midtrans dengan nominal topup di database
        const grossAmountReceived = Math.round(Number(notification.gross_amount || 0));
        if (grossAmountReceived !== topup.amount) {
            console.warn(`[Webhook] Gross amount mismatch! Expected ${topup.amount}, got ${grossAmountReceived}`);
            return res.status(400).json({ message: 'Gross amount mismatch' });
        }

        // Tentukan Status Final
        let isSuccess = false;
        let finalStatus = 'PENDING';

        if (transactionStatus === 'capture') {
            isSuccess = fraudStatus === 'accept';
            finalStatus = isSuccess ? 'SUCCESS' : 'FAILED';
        } else if (transactionStatus === 'settlement') {
            isSuccess = true;
            finalStatus = 'SUCCESS';
        } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
            finalStatus = transactionStatus.toUpperCase();
        } else if (transactionStatus === 'pending') {
            finalStatus = 'PENDING';
        }

        // Jika Sukses: Update Saldo & Catat Transaksi secara Atomik
        let updatedBalanceAfter = 0;
        if (isSuccess) {
            await prisma.$transaction(async (tx) => {
                // 1. Update status transaksi top-up secara idempoten dalam satu transaksi
                const updateRes = await tx.canteenTopup.updateMany({
                    where: { orderId, midtransStatus: { not: 'SUCCESS' } },
                    data: {
                        midtransStatus: 'SUCCESS',
                        paymentMethod: notification.payment_type || 'midtrans',
                        paidAt: new Date(),
                    }
                });

                // HANYA lanjut jika count === 1 (mencegah double top-up saat webhook concurrent)
                if (updateRes.count !== 1) {
                    console.log(`[Webhook] Transaksi ${orderId} sudah pernah diproses oleh event paralel (count: ${updateRes.count}).`);
                    return;
                }

                // 2. Ambil saldo terkini siswa di DALAM transaksi untuk menghitung balanceBefore secara presisi
                const freshStudent = await tx.user.findUnique({
                    where: { id: topup.studentId },
                    select: { id: true, name: true, canteenBalance: true }
                });
                const balanceBefore = Number(freshStudent?.canteenBalance || 0);
                const balanceAfter = balanceBefore + topup.amount;
                updatedBalanceAfter = balanceAfter;

                // 3. Tambah saldo siswa
                await tx.user.update({
                    where: { id: topup.studentId },
                    data: {
                        canteenBalance: { increment: topup.amount }
                    }
                });

                // 4. Catat di riwayat mutasi kantin dengan balanceBefore & balanceAfter akurat
                await tx.canteenTransaction.create({
                    data: {
                        userId: topup.studentId,
                        type: 'TOPUP',
                        amount: topup.amount,
                        description: `Top-Up via ${notification.payment_type || 'Midtrans'} oleh Orang Tua`,
                        balanceBefore,
                        balanceAfter,
                        referenceId: orderId,
                        idempotencyKey: `TOPUP-${orderId}`
                    }
                });

                // 5. Audit Log
                await (tx as any).activityEventLog.create({
                    data: {
                        source: 'SERVER',
                        module: 'EKANTIN',
                        action: 'CANTEEN_TOPUP_SUCCESS',
                        outcome: 'SUCCESS',
                        userId: topup.parentId,
                        name: topup.parent?.name || 'Orang Tua',
                        message: `Top-up Rp${topup.amount.toLocaleString('id-ID')} untuk ${freshStudent?.name || topup.student?.name} berhasil.`,
                        payload: JSON.stringify({ orderId, amount: topup.amount, paymentType: notification.payment_type, balanceBefore, balanceAfter })
                    }
                }).catch(() => {});
            });

            // 5 & 6. Kirim Push Notification FCM ke Siswa dan Orang Tua (Terisolasi dari transaksi inti)
            try {
                await sendFcmToUser(
                    topup.studentId,
                    '💰 Saldo E-Kantin Bertambah!',
                    `Rp ${topup.amount.toLocaleString('id-ID')} telah ditambahkan oleh Orang Tua. Saldo kamu sekarang Rp ${updatedBalanceAfter.toLocaleString('id-ID')}`,
                    {
                        type: 'CANTEEN_TOPUP',
                        amount: String(topup.amount),
                        newBalance: String(updatedBalanceAfter),
                        orderId
                    }
                );
            } catch (fcmErr) {
                console.warn('[Webhook] Gagal mengirim push notifikasi FCM ke siswa:', fcmErr);
            }

            try {
                await sendFcmToUser(
                    topup.parentId,
                    '✅ Top-Up Saldo E-Kantin Berhasil!',
                    `Pembayaran Rp ${topup.amount.toLocaleString('id-ID')} untuk ${topup.student?.name} telah terkonfirmasi resmi.`,
                    {
                        type: 'TOPUP_SUCCESS',
                        orderId,
                        amount: String(topup.amount),
                        studentId: topup.studentId
                    }
                );
            } catch (fcmErr) {
                console.warn('[Webhook] Gagal mengirim push notifikasi FCM ke orang tua:', fcmErr);
            }

            console.log(`[Webhook] ✅ Top-up ${orderId} berhasil dikonfirmasi. Saldo ${topup.student?.name} +Rp${topup.amount}`);

        } else if (finalStatus !== 'PENDING') {
            await prisma.canteenTopup.update({
                where: { orderId },
                data: { midtransStatus: finalStatus }
            });

            try {
                await sendFcmToUser(
                    topup.parentId,
                    '❌ Top-Up Saldo Gagal / Kadaluarsa',
                    `Pembayaran top-up saldo e-kantin untuk ${topup.student?.name} ${finalStatus.toLowerCase()}. Silakan ulangi pemesanan.`,
                    { type: 'TOPUP_FAILED', orderId }
                );
            } catch (fcmErr) {}
        }

        return res.json({ message: 'OK' });

    } catch (error: any) {
        console.error('[Webhook] Error handling Midtrans webhook:', error);
        return res.status(200).json({ message: 'Error handled smoothly' });
    }
}

/**
 * 3. GET /api/ekantin/topup/status/:orderId
 * APK Polling tiap 3 detik untuk update konfirmasi pembayaran
 */
export async function checkTopupStatus(req: Request, res: Response) {
    try {
        const orderId = String(req.params.orderId || '');
        const user = (req as any).user;
        const parentId = user?.id;

        const topup: any = await prisma.canteenTopup.findFirst({
            where: {
                orderId,
                ...(user?.role !== 'ADMIN' ? { parentId } : {})
            },
            include: {
                student: { select: { name: true, canteenBalance: true } }
            }
        });

        if (!topup) {
            return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan.' });
        }

        return res.json({
            success: true,
            data: {
                orderId: topup.orderId,
                status: topup.midtransStatus,
                amount: topup.amount,
                studentName: topup.student?.name,
                currentBalance: topup.student?.canteenBalance || 0,
                paymentMethod: topup.paymentMethod,
                paidAt: topup.paidAt,
                expiredAt: topup.expiredAt
            }
        });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: 'Gagal mengecek status transaksi: ' + e.message });
    }
}

/**
 * 4. GET /api/ekantin/topup/history
 * Riwayat Top-Up Orang Tua
 */
export async function getTopupHistory(req: Request, res: Response) {
    try {
        const user = (req as any).user;
        const parentId = user?.id;
        const { studentId, page = '1' } = req.query;
        const pageSize = 20;
        const skip = (Math.max(1, parseInt(page as string, 10)) - 1) * pageSize;

        const whereClause: any = {};
        if (user?.role !== 'ADMIN') {
            whereClause.parentId = parentId;
        }
        if (studentId) {
            whereClause.studentId = String(studentId);
        }

        const [total, history] = await Promise.all([
            prisma.canteenTopup.count({ where: whereClause }),
            prisma.canteenTopup.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                take: pageSize,
                skip,
                include: {
                    student: { select: { name: true, className: true } },
                    parent: { select: { name: true } }
                }
            })
        ]);

        return res.json({
            success: true,
            total,
            page: Number(page),
            pageSize,
            data: history.map((h: any) => ({
                id: h.id,
                orderId: h.orderId,
                amount: h.amount,
                midtransStatus: h.midtransStatus,
                paymentMethod: h.paymentMethod || '-',
                createdAt: h.createdAt,
                paidAt: h.paidAt,
                studentName: h.student?.name || '-',
                className: h.student?.className || '-',
                parentName: h.parent?.name || '-'
            }))
        });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: 'Gagal memuat riwayat top-up: ' + e.message });
    }
}

/**
 * 5. GET /api/ekantin/topup/portal-summary
 * Statistik ringkas untuk Portal Web Bendahara / Admin Kantin
 */
export async function getPortalTopupSummary(_req: Request, res: Response) {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

        const [successTodayRows, pendingCount, monthRows] = await Promise.all([
            prisma.canteenTopup.findMany({
                where: {
                    midtransStatus: 'SUCCESS',
                    paidAt: { gte: todayStart, lte: todayEnd }
                },
                select: { amount: true }
            }),
            prisma.canteenTopup.count({
                where: { midtransStatus: 'PENDING' }
            }),
            prisma.canteenTopup.findMany({
                where: {
                    midtransStatus: 'SUCCESS',
                    paidAt: { gte: monthStart }
                },
                select: { amount: true }
            })
        ]);

        const totalSuccessToday = successTodayRows.reduce((acc: number, r: any) => acc + (r.amount || 0), 0);
        const totalThisMonth = monthRows.reduce((acc: number, r: any) => acc + (r.amount || 0), 0);

        return res.json({
            success: true,
            data: {
                totalSuccessToday,
                totalPending: pendingCount,
                totalThisMonth
            }
        });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: 'Gagal memuat ringkasan portal: ' + e.message });
    }
}
