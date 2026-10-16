import { runDatabaseBackup, testBackupRestoreIntegrity } from '../services/backupService';

async function main() {
    console.log('--- TEST AUDIT B-16: BACKUP & DISASTER RECOVERY ---');
    console.log('1. Menjalankan backup database otomatis...');
    const result = await runDatabaseBackup();
    console.log('Hasil Backup:', result);

    if (!result.success || !result.backupPath) {
        console.error('❌ Gagal membuat backup database.');
        process.exit(1);
    }

    console.log('\n2. Menguji integritas berkas backup untuk verifikasi pemulihan (restore simulation)...');
    const integrity = await testBackupRestoreIntegrity(result.backupPath);
    console.log('Hasil Integritas Restore:', integrity);

    if (integrity.valid) {
        console.log('\n🎯 [PASS] Uji Backup & Disaster Recovery RPO/RTO BERHASIL 100%!');
        process.exit(0);
    } else {
        console.error('\n❌ [FAIL] Integritas backup gagal dipulihkan.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
