const fs = require('fs');
const path = require('path');

const cbtPath = path.join(__dirname, '../controllers/cbtController.ts');
let cbtContent = fs.readFileSync(cbtPath, 'utf8');

// 1. Relaksasi expiration di isExamTokenReleased jika token aktif / status active
const oldExpire = `        if (curMinutes > endMinutes) {
            return {
                isReleased: false,
                isTokenRequired: true,
                isExpired: true,
                reason: \`Jadwal ujian hari ini telah berakhir (\${execDate} pukul \${exam.endTimeStr || 'selesai'} WIB). Sesi ujian otomatis dinonaktifkan.\`
            };
        }`;

const newExpire = `        // Ujian terjadwal hari ini tetap bisa diakses jika token diaktifkan atau status aktif/ready
        if (curMinutes > endMinutes && !exam.isTokenActive && exam.status !== 'ACTIVE' && exam.status !== 'READY') {
            return {
                isReleased: false,
                isTokenRequired: true,
                isExpired: true,
                reason: \`Jadwal ujian hari ini telah berakhir (\${execDate} pukul \${exam.endTimeStr || 'selesai'} WIB). Sesi ujian otomatis dinonaktifkan.\`
            };
        }`;

cbtContent = cbtContent.replace(oldExpire.replace(/\r?\n/g, '\r\n'), newExpire.replace(/\r?\n/g, '\r\n'));

// 2. Relaksasi di getStudentActiveExams agar ujian yang dibuat di portal hari ini / token aktif langsung muncul
const oldFilter = `                const releaseInfo = isExamTokenReleased(e);
                if (execDate === todayStr && !releaseInfo.isExpired) {`;

const newFilter = `                const releaseInfo = isExamTokenReleased(e);
                // Ujian tampil jika tanggal hari ini ATAU token aktif ATAU status aktif/ready/published
                const isApplicable = (execDate === todayStr || e.isTokenActive || e.status === 'ACTIVE' || e.status === 'READY' || e.status === 'PUBLISHED') && !['ARCHIVED', 'SELESAI', 'FINISHED'].includes((e.status || '').toUpperCase());
                if (isApplicable && !releaseInfo.isExpired) {`;

cbtContent = cbtContent.replace(oldFilter.replace(/\r?\n/g, '\r\n'), newFilter.replace(/\r?\n/g, '\r\n'));

fs.writeFileSync(cbtPath, cbtContent, 'utf8');
console.log('cbtController.ts updated successfully!');
