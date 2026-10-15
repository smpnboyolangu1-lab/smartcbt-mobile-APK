const fs = require('fs');

let tXml = fs.readFileSync('android_app/app/src/main/res/layout/activity_teacher_main.xml', 'utf8');

tXml = tXml.replace(/android:text="[^"]*Guru Pengampu"/g, 'android:text="👨‍🏫 Guru Pengampu"');
tXml = tXml.replace(/android:text="[^"]*Rombel: -"/g, 'android:text="🏫 Rombel: -"');
tXml = tXml.replace(/android:text="[^"]*Status Piket: Standby"/g, 'android:text="🛡️ Status Piket: Standby"');
tXml = tXml.replace(/android:text="[^"]*PILIH RUANG KELAS"/g, 'android:text="🏫 PILIH RUANG KELAS"');
tXml = tXml.replace(/android:text="[^"]*1-TAP PRESENSI DATANG[^"]*"/g, 'android:text="📍 1-TAP PRESENSI DATANG (GEOLOCATION)"');
tXml = tXml.replace(/android:text="[^"]*Lembar A4"/g, 'android:text="📄 Lembar A4"');

// Fix standalone mojibake text in TextViews
tXml = tXml.replace(/(<TextView[^>]*id="\@\+id\/tvTeachingSessionIcon"[^>]*android:text=)"[^"]*"/g, '$1"🏫"');
tXml = tXml.replace(/(<LinearLayout[^>]*id="\@\+id\/gridTeacherLeave"[\s\S]*?<TextView[^>]*android:text=)"[^"]*"/g, '$1"📍"');
tXml = tXml.replace(/(<LinearLayout[^>]*id="\@\+id\/gridTeacherManagement"[\s\S]*?<TextView[^>]*android:text=)"[^"]*"/g, '$1"🏛️"');
tXml = tXml.replace(/(<androidx\.cardview\.widget\.CardView[^>]*id="\@\+id\/cardTeacherPiketBanner"[\s\S]*?<TextView[^>]*android:text=)"[^"]*"/g, '$1"🛡️"');

// Replace any remaining ð.*
tXml = tXml.replace(/android:text="[^"]*ð[^"]*"/g, (match) => {
    if (match.includes('Lembar')) return 'android:text="📄 Lembar A4"';
    if (match.includes('PRESENSI')) return 'android:text="📍 1-TAP PRESENSI DATANG (GEOLOCATION)"';
    return 'android:text="📍"';
});

fs.writeFileSync('android_app/app/src/main/res/layout/activity_teacher_main.xml', tXml, 'utf8');

let wXml = fs.readFileSync('android_app/app/src/main/res/layout/activity_wali_kelas.xml', 'utf8');
wXml = wXml.replace(/android:text="[^"]*PDF Bulanan"/g, 'android:text="🖨️ PDF Bulanan"');
wXml = wXml.replace(/android:text="[^"]*PDF Harian"/g, 'android:text="🖨️ PDF Harian"');
wXml = wXml.replace(/android:text="[^"]*ð[^"]*"/g, 'android:text="⭐"');

fs.writeFileSync('android_app/app/src/main/res/layout/activity_wali_kelas.xml', wXml, 'utf8');
console.log('Final layout sweep completed!');
