// @ts-ignore
import midtransClient from 'midtrans-client';

// Snap API untuk tampilan payment Midtrans
export const snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-TESTKEY2026',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-TESTKEY2026',
});

// Core API untuk verifikasi status transaksi
export const coreApi = new midtransClient.CoreApi({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-TESTKEY2026',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-TESTKEY2026',
});
