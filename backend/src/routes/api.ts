import prisma from '../utils/db';
import { reportEmptyClass, getEmptyClassReports, handleEmptyClass, streamEmptyClassMonitor, getEmptyClassStatus, getClassMonitoringStatus, resolveEmptyClass, forwardEmptyClassToKurikulum } from '../controllers/emptyClassController';
import { getAppVersion, updateAppVersionConfig, checkVersionV1 } from '../controllers/appUpdateController';
import { getStudents, createStudent, deleteStudent, updateStudent, syncStudentsToLocal, getTeachers, createTeacher, updateTeacher, deleteTeacher, syncTeachersToLocal } from '../controllers/userController';
import { createParentLeaveRequest, getParentLeaveRequests, getTeacherLeaveRequests, verifyLeaveRequest, deleteLeaveRequest } from '../controllers/leaveRequestController';
import { checkBKKelasAccess } from '../middlewares/checkBKKelasAccess';
import { getSekolahKonteks } from '../controllers/schoolController';
import { getStudentTimeline } from '../controllers/studentTimelineController';
import { triggerDailyAutoRecap } from '../controllers/schedulerController';

import {
    getTeacherTodaySchedule,
    generateDynamicQr,
    scanStudentDynamicQr,
    quickMarkAllAttendance,
    updateSingleStudentAttendance,
    createTeachingJournal,
    getTeachingJournals,
    broadcastToClass,
    getTeacherEFiles,
    uploadTeacherEFile,
    deleteTeacherEFile,
    markTeacherEFileAsRead,
    getTeacherClasses,
    getStudentsByClass,
    getHomeroomSummary,
    getPiketSummary,
    getTeacherBroadcastHistory,
    getTeacherSubjectAttendanceRecap,
    teacherGeolocationAttendance,
    getTeacherTodayAttendance
} from '../controllers/teacherFeatureController';

import {
     getBooks, createBook, borrowBook, deleteBook, adjustBookCopiesStock, updateBookCover, checkBookOwnerByBarcode, reassignBookBorrower, getMyBorrowedBooks, getAllBookCopies, returnBookCopy, getBookCoverSvg, quickCirculation, getDigitalMemberCard, getAllMembers } from '../controllers/libraryController';
import { getWeeklyPiketSchedules, createPiketSchedule, updatePiketSchedule, deletePiketSchedule, getTodayOnDutyTeachers, checkTeacherPiketStatus, getTeacherPiketReports } from '../controllers/piketScheduleController';
import { getTeacherInactivityReport } from '../controllers/teacherInactivityController';
import { getRemoteFiles, uploadAndDistributeFile, deleteRemoteFile } from '../controllers/fileManagerController';
import { previewDeviceImage, registerDevice, deviceHeartbeat, syncDeviceFiles, getPendingCopyRequests, uploadDeviceFile, getAllDevices, getDeviceDetail, getDeviceFiles, requestCopyFile, requestBulkCopyFiles, downloadCopiedFile, getAllCopyRequests, deleteDeviceFileRecord, deleteDeviceFilesBulk, clearDeviceFiles, deleteDevice, cleanupOfflineDevices, blockDevice, unblockDevice, prepareFolderZip, getFolderZipStatus, downloadFolderZip, getDeviceTelemetry, streamDeviceMedia, liveDeviceStream, liveNewFileNotification, streamUploadDeviceFile, streamDownloadLargeFile, getDeviceListPaginated, getDeviceStats, triggerDeviceScan, pullAllDeviceFiles, pullAllStatus, downloadAllAsZip } from '../controllers/remoteDeviceController';
import express from 'express';
import { login, resetDeviceBinding, refreshTokenHandler, getAuditLogs, getSessionToken, getUserActiveRoles, switchActiveRole, logout } from '../controllers/authController';
import { getAnnouncements, createAnnouncement, deleteAnnouncement } from '../controllers/announcementController';
import { getHomeworks, createHomework, deleteHomework, submitHomework, getHomeworkSubmissions, gradeHomeworkSubmission, duplicateHomework } from '../controllers/homeworkController';
import { authenticateJWT, requireRole, requireExamBrowser, checkKurikulumAccess, enrichUserRoles } from '../middlewares/authMiddleware';
import { getStudentProfile, updateStudentProfile, getDetailedAttendance, getLearningAnalytics, getEFiles, uploadStudentEFile, deleteStudentEFile, getSubjectAttendanceSummary, getStudentNotifications, markStudentNotificationRead } from '../controllers/studentController';
import { saveUserFcmToken } from '../services/fcmService';
import { getPengurusKelasConfig, togglePengurusKelasConfig, getClassmatesRealtimeStatus, submitAssistedScan } from '../controllers/pengurusKelasController';
import { applyOfficialPasfoto } from '../controllers/biodataSubmissionController';

const router = express.Router();

// --- Konteks Sekolah SIBOY (SMPN 1 Boyolangu) ---
router.get('/sekolah/konteks', getSekolahKonteks);

// --- Auth & Multi-Role Dinamis ---
router.post('/auth/login', login);
router.post('/auth/refresh', refreshTokenHandler);
router.post('/auth/logout', logout);
router.get('/auth/session-token', authenticateJWT, getSessionToken);
router.get('/auth/roles', authenticateJWT, getUserActiveRoles);
router.post('/auth/switch-role', authenticateJWT, switchActiveRole);
router.get('/admin/audit-logs', authenticateJWT, requireRole(['ADMIN']), getAuditLogs);
router.post('/auth/reset-device', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), resetDeviceBinding);

// --- Firebase Cloud Messaging (FCM) Token Registration ---
router.post('/auth/fcm-token', authenticateJWT, async (req, res) => {
    try {
        const userId = (req as any).user?.id;
        const { token, deviceAndroidId, role } = req.body;
        if (!userId || !token) {
            return res.status(400).json({ success: false, message: 'UserId dan token FCM wajib disertakan' });
        }
        await saveUserFcmToken(userId, token, deviceAndroidId, role || (req as any).user?.role);
        res.json({ success: true, message: 'FCM Token berhasil disimpan' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- Modul Khusus Pengurus Kelas (Ketua, Wakil, Sekretaris, Bendahara) ---
router.get('/pengurus-kelas/config', authenticateJWT, getPengurusKelasConfig);
router.post('/pengurus-kelas/config/toggle', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KURIKULUM']), togglePengurusKelasConfig);
router.get('/pengurus-kelas/classmates', authenticateJWT, getClassmatesRealtimeStatus);
router.post('/pengurus-kelas/assisted-scan', authenticateJWT, submitAssistedScan);

// --- Timeline Siswa ---
router.get(['/student/timeline', '/student/:id/timeline', '/parent/child-timeline'], authenticateJWT, getStudentTimeline);

// --- Scheduler Rekap Otomatis ---
router.post('/scheduler/rekap-otomatis', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), triggerDailyAutoRecap);

// --- Modul Kesiswaan & Staf TU ---
import { 
    getKesiswaanDashboard, getVerifikasiList, getBiodataDetail, approveBiodata, revisiBiodata, 
    previewGenerateNis, executeGenerateNis, exportDapodik, mutasiSiswa,
    kirimPengumumanOrtu, kirimPengumumanMassal, prosesArsipTahunAjaran, listArsipTahunAjaran, downloadArsipZip,
    prosesArsipGoogleDriveTerbatas, listArsipDriveLogs, downloadArsipDriveEnc,
    serveProtectedDocument, listAuditDokumenAkses, prosesKenaikanKelas
} from '../controllers/kesiswaanController';
import { GeocodingService } from '../services/geocodingService';
import { PdfService } from '../services/pdfService';

router.get('/kesiswaan/dashboard', getKesiswaanDashboard);
router.get('/kesiswaan/verifikasi/biodata', getVerifikasiList);
router.get('/kesiswaan/biodata/:siswa_id', getBiodataDetail);
router.post('/kesiswaan/verifikasi/:siswa_id/approve', approveBiodata);
router.post('/kesiswaan/verifikasi/:siswa_id/revisi', revisiBiodata);
router.post('/kesiswaan/verifikasi/:siswa_id/kirim-pengumuman', kirimPengumumanOrtu);
router.post('/kesiswaan/verifikasi/kirim-pengumuman-massal', kirimPengumumanMassal);

// Pengarsipan per Tahun Ajaran Lokal
router.get('/kesiswaan/arsip/list', listArsipTahunAjaran);
router.post('/kesiswaan/arsip/proses', prosesArsipTahunAjaran);
router.get('/kesiswaan/arsip/download/:tahunAjaran', downloadArsipZip);

// Pengarsipan Google Drive Terbatas (Terenkripsi AES-256) & Audit Dokumen Akses
router.post('/kesiswaan/arsip/google-drive-terbatas', authenticateJWT, prosesArsipGoogleDriveTerbatas);
router.get('/kesiswaan/arsip/drive-logs', authenticateJWT, listArsipDriveLogs);
router.get('/kesiswaan/arsip/drive-download/:id', authenticateJWT, downloadArsipDriveEnc);
router.get('/kesiswaan/dokumen/:id/secure', authenticateJWT, serveProtectedDocument);
router.get('/kesiswaan/audit-dokumen', authenticateJWT, listAuditDokumenAkses);

// Auto-Generate NIS, Mutasi & Kenaikan Kelas (Dukungan Tinggal Kelas)
router.get('/kesiswaan/generate-nis/preview', previewGenerateNis);
router.post('/kesiswaan/generate-nis', executeGenerateNis);
router.get('/kesiswaan/export/dapodik', exportDapodik);
router.post('/kesiswaan/export/dapodik', exportDapodik);
router.post('/kesiswaan/mutasi', mutasiSiswa);
router.post('/kesiswaan/kenaikan-kelas', authenticateJWT, prosesKenaikanKelas);

// --- Reverse Geocoding & PDF Cetak ---
router.post('/geocoding/reverse', async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        const result = await GeocodingService.reverseGeocode(Number(latitude || -8.0886), Number(longitude || 111.9163));
        return res.json({ success: true, data: result });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/ortu/biodata/:siswa_id/pdf', async (req, res) => {
    try {
        const studentId = req.params.siswa_id;
        const result = await PdfService.generateFormulirLengkap(studentId);
        return res.json({ 
            success: true, 
            data: result,
            downloadUrl: `/api/biodata/download/${studentId}`,
            printUrl: `/api/biodata/print/${studentId}`
        });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/biodata/download/:siswa_id', async (req, res) => {
    try {
        const studentId = req.params.siswa_id;
        const result = await PdfService.generateFormulirLengkap(studentId);
        if (result.filePath && fs.existsSync(result.filePath)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Formulir_Biodata_SIBOY_${studentId}.pdf"`);
            return res.sendFile(result.filePath);
        } else {
            return res.redirect(result.pdfUrl);
        }
    } catch (e: any) {
        return res.status(500).send(`Gagal mengunduh berkas PDF: ${e.message}`);
    }
});

router.get('/biodata/print/:siswa_id', async (req, res) => {
    try {
        const studentId = req.params.siswa_id;
        const siswaUser = await prisma.user.findFirst({
            where: {
                OR: [{ id: studentId }, { username: studentId }]
            }
        });
        const targetStudentId = siswaUser?.id || studentId;
        const siswaBio = await (prisma as any).biodataSiswa.findUnique({ where: { studentId: targetStudentId } });
        const siswa = {
            ...(siswaBio || {}),
            namaLengkap: siswaBio?.namaLengkap || siswaUser?.name || 'Siswa',
            name: siswaUser?.name || siswaBio?.namaLengkap || 'Siswa',
            nisn: siswaBio?.nisn || siswaUser?.username || '-',
            nis: siswaBio?.nis || (siswaUser as any)?.nis || '',
            nik: siswaBio?.nik || (siswaUser as any)?.nik || '-',
            jk: siswaBio?.jk || siswaUser?.gender || 'L',
            gender: siswaUser?.gender || siswaBio?.jk || 'L',
            tempatLahir: siswaBio?.tempatLahir || (siswaUser as any)?.pob || '-',
            tanggalLahir: siswaBio?.tanggalLahir || (siswaUser as any)?.dob || '-',
            agama: siswaBio?.agama || (siswaUser as any)?.religion || 'Islam',
            rombel: siswaBio?.rombel || siswaBio?.kelas || (siswaUser as any)?.className || 'VII',
            fotoUrl: siswaBio?.fotoUrl || (siswaUser as any)?.profilePicUrl || null
        };
        const ayah = await (prisma as any).biodataAyah.findUnique({ where: { studentId: targetStudentId } });
        const ibu = await (prisma as any).biodataIbu.findUnique({ where: { studentId: targetStudentId } });
        const wali = await (prisma as any).biodataWali.findUnique({ where: { studentId: targetStudentId } });
        const afirmasi = await (prisma as any).biodataAfirmasi.findUnique({ where: { studentId: targetStudentId } });

        const html = PdfService.buildHtml({
            siswa,
            ayah: ayah || {},
            ibu: ibu || {},
            wali: wali || {},
            afirmasi: afirmasi || {}
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (e: any) {
        return res.status(500).send(`Gagal mencetak dokumen: ${e.message}`);
    }
});

router.post('/kesiswaan/generate-pdf/:siswa_id', async (req, res) => {
    try {
        const studentId = req.params.siswa_id;
        const result = await PdfService.generateFormulirLengkap(studentId);
        return res.json({ success: true, data: result });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

import { tapCardAttendance, recordAttendanceScan, recordGpsAttendance, recordManualAttendance, getAttendanceToday, getAttendanceRekap, exportAttendanceExcel, exportAttendancePdf, getGateSettings, updateGateSettings, scanClassGate, getClassGateBarcodes, toggleEmergencyGateOut, checkAndNotifyUnscannedStudents, notifyUnscannedGateOutStudentsHandler, bulkSyncAttendance, getAttendanceRekapPeriode, getAttendanceRekapSiswa, declareServerOutage, cancelServerOutage, getServerOutageStatus, getClassOfficerDynamicQr, excuseLateStudent } from '../controllers/attendanceController';
import { getHolidays, getSchoolHolidays, createOrUpdateHoliday, deleteHoliday } from '../controllers/calendarController';
import { getFeaturePanelData, toggleFeatureKey, updateGpsConfig, getAttendanceConfig, getAllFeatureFlagsMap } from '../controllers/featureToggleController';
import { getAllZones, getActiveZones, createZone, updateZone, toggleZone, deleteZone } from '../controllers/geofenceZoneController';
import { getGpsMonitoringMap, getGpsAnomalies, verifyGpsAttendance, getGpsStats, getMockLocationLog, getGpsHeatmap, getGpsReport } from '../controllers/gpsMonitoringController';

// --- Attendance Routes (APK Client & Web Admin / BK) ---
router.post('/attendance/tap-card', tapCardAttendance);
router.post('/attendance/scan', recordAttendanceScan); // Mobile APK scan umum
router.post('/attendance/gps', recordGpsAttendance);   // Mobile APK dedicated GPS attendance
router.post('/absensi/gps', recordGpsAttendance);      // Mobile APK dedicated GPS attendance alias
router.post('/attendance/scan-gate', scanClassGate);   // Mobile APK scan Barcode Statis Kelas (Gate-In / Gate-Out)
router.post('/attendance/scan-class-gate', scanClassGate);
router.get('/class-officer/dynamic-qr', authenticateJWT, getClassOfficerDynamicQr); // Dynamic Class QR 10 Detik
router.get('/attendance/dynamic-class-qr', authenticateJWT, getClassOfficerDynamicQr);
router.post('/attendance/excuse-late', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), excuseLateStudent);
router.post('/attendance/bulk-sync', bulkSyncAttendance); // Mobile APK bulk sync offline
router.post('/attendance/server-outage/declare', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'BK', 'COUNSELOR']), declareServerOutage);
router.post('/attendance/server-outage/cancel', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'BK', 'COUNSELOR']), cancelServerOutage);
router.get('/attendance/server-outage/status', getServerOutageStatus);

// --- Geofence Zones Management (Multi-Zone CRUD) ---
router.get('/geofence/zones', getAllZones);
router.get('/geofence/zones/active', getActiveZones);
router.post('/geofence/zones', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), createZone);
router.put('/geofence/zones/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateZone);
router.put('/geofence/zones/:id/toggle', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), toggleZone);
router.delete('/geofence/zones/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteZone);

// --- GPS Monitoring, Heatmap & Anomaly Verification ---
router.get('/monitoring/gps-map', getGpsMonitoringMap);
router.get('/monitoring/gps-anomalies', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR', 'TEACHER']), getGpsAnomalies);
router.post('/monitoring/gps-verify/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), verifyGpsAttendance);
router.post('/absensi/verify/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), verifyGpsAttendance);
router.get('/monitoring/gps-stats', getGpsStats);
router.get('/monitoring/mock-location', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getMockLocationLog);
router.get('/monitoring/gps-heatmap', getGpsHeatmap);
router.get('/reports/gps', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), getGpsReport);
router.get('/attendance/config', getAttendanceConfig);   // Mobile APK fetch dynamic GPS & attendance config
router.get('/features', getAllFeatureFlagsMap);          // Mobile APK fetch all feature flags
router.get('/admin/feature-panel', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getFeaturePanelData);
router.put('/admin/feature-panel/:key', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), toggleFeatureKey);
router.put('/attendance/gps-config', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateGpsConfig);
router.get('/attendance/gate-settings', getGateSettings);
router.put('/attendance/gate-settings', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'SATPAM']), updateGateSettings);
router.post('/attendance/gate-settings/toggle-trial', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'SATPAM']), toggleEmergencyGateOut);
router.post('/attendance/toggle-emergency-gateout', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'SATPAM']), toggleEmergencyGateOut);
router.post('/attendance/check-unscanned', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), checkAndNotifyUnscannedStudents);
router.post('/attendance/notify-unscanned-gateout', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), notifyUnscannedGateOutStudentsHandler);
router.get('/attendance/class-barcodes', getClassGateBarcodes);
router.get('/attendance/export-excel', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'COUNSELOR']), exportAttendanceExcel);
router.get('/attendance/export-pdf', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'COUNSELOR']), exportAttendancePdf);
router.post('/attendance/manual', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'COUNSELOR']), recordManualAttendance);
router.get('/attendance/today', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'COUNSELOR']), getAttendanceToday);
router.get('/attendance/rekap', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'COUNSELOR']), getAttendanceRekap);
router.get('/attendance/rekap-periode', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR', 'TEACHER']), getAttendanceRekapPeriode);
router.get('/attendance/rekap-siswa/:userId', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR', 'TEACHER']), getAttendanceRekapSiswa);

// --- Helpdesk (Pesan Admin & Lapor Kendala Aplikasi) Routes ---
import { submitHelpdeskReport, getHelpdeskReports } from '../controllers/helpdeskController';
router.post('/helpdesk/report', authenticateJWT, submitHelpdeskReport);
router.get('/helpdesk/reports', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getHelpdeskReports);

// --- Kalender Libur Nasional Indonesia & Kustom Libur Sekolah ---
router.get('/calendar/holidays', getHolidays);
router.get('/calendar/school-holidays', getSchoolHolidays);
router.post('/calendar/school-holidays', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), createOrUpdateHoliday);
router.delete('/calendar/school-holidays/:date', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteHoliday);

// --- Announcements (Pengumuman) Routes ---
router.get('/announcements', getAnnouncements);
router.post('/announcements', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), createAnnouncement);
router.delete('/announcements/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteAnnouncement);

// --- Homework / Tugas Routes ---
router.get('/homeworks', authenticateJWT, getHomeworks);
router.post('/homeworks', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), createHomework);
router.post('/homeworks/:id/duplicate', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), duplicateHomework);
router.post('/homeworks/submit', authenticateJWT, submitHomework);
router.post('/student/homeworks/submit', authenticateJWT, submitHomework);
router.delete('/homeworks/:id', authenticateJWT, requireRole(['ADMIN', 'TEACHER']), deleteHomework);
router.delete('/homework/:id', authenticateJWT, requireRole(['ADMIN', 'TEACHER']), deleteHomework);
router.get('/homeworks/:id/submissions', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), getHomeworkSubmissions);
router.post('/homeworks/grade', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), gradeHomeworkSubmission);

// --- Parent (Orang Tua) Portal Routes ---
import { getMyChildData, getParentChildren, getParentNotifications, markNotificationAsRead, getParentHomeworks, linkParentChild, unlinkParentChild } from '../controllers/parentController';
router.get('/parent/my-child', authenticateJWT, getMyChildData);
router.get('/parent/children', authenticateJWT, getParentChildren);
router.post('/parent/link-child', authenticateJWT, linkParentChild);
router.delete('/parent/unlink-child/:studentId', authenticateJWT, unlinkParentChild);
router.get('/parent/homeworks', authenticateJWT, getParentHomeworks);
router.get('/parent/notifications', authenticateJWT, getParentNotifications);
router.put('/parent/notifications/:id/read', authenticateJWT, markNotificationAsRead);
router.post('/parent/notifications/:id/read', authenticateJWT, markNotificationAsRead);
router.post('/notifications/:id/read', authenticateJWT, markNotificationAsRead);
router.put('/notifications/:id/read', authenticateJWT, markNotificationAsRead);

// --- Parent Profile & Verified Phone Number Management ---
import {
    getParentProfile,
    updateParentProfile,
    requestParentPhoneOtp,
    verifyParentPhoneOtp,
    getOperatorParentPhoneAudit
} from '../controllers/parentProfileController';

router.get('/parent/profile', authenticateJWT, getParentProfile);
router.patch('/parent/profile', authenticateJWT, updateParentProfile);
router.post('/parent/profile/phone/request-otp', authenticateJWT, requestParentPhoneOtp);
router.post('/parent/profile/phone/verify', authenticateJWT, verifyParentPhoneOtp);
router.get('/admin/parents/phone-audit', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getOperatorParentPhoneAudit);

// --- WiFi Akses Siswa & MikroTik Integration ---
import { 
    getStudentWifiStatus, 
    activateStudentWifi, 
    resetDailyWifiSessions,
    getAdminWifiDashboard,
    revokeStudentWifi,
    getWifiStats,
    getWifiConfig,
    updateWifiConfig,
    getMacBlacklist,
    addMacBlacklist,
    removeMacBlacklist,
    testMikrotikConnection,
    getMikrotikBindings,
    syncMikrotikWithDatabase
} from '../controllers/wifiController';

router.get('/student/wifi/status', authenticateJWT, getStudentWifiStatus);
router.post('/student/wifi/activate', authenticateJWT, activateStudentWifi);
router.get('/admin/wifi/dashboard', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getAdminWifiDashboard);
router.get('/admin/wifi/stats', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getWifiStats);
router.post('/admin/wifi/revoke/:sessionId', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), revokeStudentWifi);
router.post('/admin/wifi/reset-daily', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), resetDailyWifiSessions);
router.get('/admin/wifi/config', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getWifiConfig);
router.put('/admin/wifi/config', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateWifiConfig);
router.get('/admin/wifi/blacklist', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getMacBlacklist);
router.post('/admin/wifi/blacklist', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), addMacBlacklist);
router.delete('/admin/wifi/blacklist/:mac', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), removeMacBlacklist);
router.post('/admin/wifi/test-connection', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), testMikrotikConnection);
router.get('/admin/wifi/mikrotik-bindings', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getMikrotikBindings);
router.post('/admin/wifi/sync-mikrotik', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), syncMikrotikWithDatabase);

// --- Official Letters (Surat Resmi Sekolah untuk Orang Tua: /kelas, /siswa, /semua, /pertingkat) ---
import { getOfficialLetters, sendOfficialLetter, deleteOfficialLetter, getParentLetters, confirmOfficialLetter } from '../controllers/letterController';
router.get('/letters', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getOfficialLetters);
router.post('/letters', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), sendOfficialLetter);
router.delete('/letters/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteOfficialLetter);
router.get('/parent/letters', authenticateJWT, getParentLetters);
router.post('/parent/letters/:id/confirm', authenticateJWT, confirmOfficialLetter);

import { getAllUsers, createUser, updateUserRoleAndStatus, resetUserPassword, unbindUserDevice, forceLogoutUser, deleteUser, bulkDeleteUsers, getSystemSettings, getSchoolInfo, updateSchoolSettings, updateGeminiApiKey, testGeminiApiKey, importStudents, triggerSyncParents, promoteStudentsGrade, getPpdbStatus, togglePpdb, registerPpdbCandidate, unlockStudentBiodata } from '../controllers/adminUserController';
router.get('/admin/users', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), getAllUsers);
router.post('/admin/users', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), createUser);
router.put('/admin/users/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateUserRoleAndStatus);
router.post('/admin/users/:id/reset-password', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), resetUserPassword);
router.post('/admin/users/:id/unbind-device', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), unbindUserDevice);
router.post('/admin/users/:id/force-logout', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), forceLogoutUser);
router.delete('/admin/users/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteUser);
router.post('/admin/users/bulk-delete', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), bulkDeleteUsers);
router.get('/admin/students', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getStudents);
router.post('/admin/students/import', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), importStudents);
router.post('/admin/students/sync-parents', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), triggerSyncParents);
router.post('/admin/students/promote-grade', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), promoteStudentsGrade);

// --- System & AI Settings Routes & PPDB ---
router.get('/school-info', getSchoolInfo);
router.get('/school/identity', getSchoolInfo);
router.get('/admin/settings', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getSystemSettings);
router.post('/admin/settings/school', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateSchoolSettings);
router.put('/admin/settings/school', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateSchoolSettings);
router.post('/admin/settings/gemini', authenticateJWT, requireRole(['ADMIN']), updateGeminiApiKey);
router.post('/admin/settings/gemini/test', authenticateJWT, requireRole(['ADMIN']), testGeminiApiKey);
router.get('/ppdb/status', getPpdbStatus);
router.put('/admin/settings/ppdb-toggle', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), togglePpdb);
router.post('/admin/settings/ppdb-toggle', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), togglePpdb);
router.post('/ppdb/register', registerPpdbCandidate);

import { streamMonitoringUpdates, broadcastMonitoringEvent, getExamItemAnalysis, getProctorOfficialReport, toggleExamToken, verifyExamToken, downloadQuestions, syncExamData, logCheatStrike, getLiveMonitoringData, addStudentExamTime, resetStudentLock, forceSubmitStudentExam, getStudentActiveExams, getProctorCbtTokens, regenerateExamToken, resetClassToken, assignClassProctors, getProctorClassStudents, proctorResetStudentLock, submitProctorBap, getProctorBapList, printProctorBapHtml, emergencyUnlockAll, proctorResetStudentMultiType, calculateAndSavePsychometrics, getExamDetailedRecap, printExamComprehensiveReport } from '../controllers/cbtController';
import { getExamPackages, assignExamAuthors, submitExamPackageForReview, updateExamPackageStatus, createPackageRevisionVersion, getCollaborativeHomeworks, cloneHomework, sendFileOrQuestions, getTeacherTransferInbox, respondToTransfer } from '../controllers/examPackageController';

// --- CBT Routes ---
router.get('/cbt/monitoring-stream', streamMonitoringUpdates);
router.get('/cbt/monitoring-live', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getLiveMonitoringData);
router.get('/cbt/exams/:examId/item-analysis', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getExamItemAnalysis);
router.get('/cbt/exams/:examId/official-report', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getProctorOfficialReport);
router.get('/cbt/bap/:bapId/print', printProctorBapHtml);
router.get('/cbt/exams/:examId/bap/print', printProctorBapHtml);
router.get('/cbt/student/active-exams', authenticateJWT, requireExamBrowser, getStudentActiveExams);
router.get('/cbt/proctor-tokens', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getProctorCbtTokens);
router.post('/cbt/verify-token', authenticateJWT, verifyExamToken);
router.post('/cbt/regenerate-token', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), regenerateExamToken);
router.post('/cbt/reset-class-token', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), resetClassToken);
router.post('/cbt/assign-class-proctors', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), assignClassProctors);
router.get('/cbt/proctor-class-students', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getProctorClassStudents);
router.post('/cbt/proctor-reset-lock', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), proctorResetStudentLock);
router.post('/cbt/student-multi-reset', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), proctorResetStudentMultiType);
router.post('/cbt/calculate-psychometrics', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), calculateAndSavePsychometrics);
router.get('/cbt/detailed-recap', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getExamDetailedRecap);
router.get('/cbt/print-comprehensive-report', printExamComprehensiveReport);
router.post('/cbt/emergency-unlock-all', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), emergencyUnlockAll);
router.post('/cbt/proctor-submit-bap', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), submitProctorBap);
router.get('/cbt/proctor-bap', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getProctorBapList);
router.post('/cbt/student/:studentId/add-time', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), addStudentExamTime);
router.post('/cbt/student/:studentId/reset-lock', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), resetStudentLock);
router.post('/cbt/student/:studentId/force-submit', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), forceSubmitStudentExam);
router.post('/cbt/toggle-token', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), toggleExamToken);
router.post('/cbt/download-questions', authenticateJWT, requireRole(['STUDENT', 'ADMIN', 'OPERATOR', 'TEACHER']), requireExamBrowser, downloadQuestions);
router.post('/cbt/sync-exam', authenticateJWT, requireRole(['STUDENT', 'ADMIN', 'OPERATOR', 'TEACHER']), requireExamBrowser, syncExamData);
router.post('/cbt/strike', authenticateJWT, requireRole(['STUDENT', 'ADMIN', 'OPERATOR', 'TEACHER']), requireExamBrowser, logCheatStrike);

// --- Bank Paket Ujian, Bank Tugas, & Transfer File Routes ---
router.get('/cbt/exam-packages', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getExamPackages);
router.post('/cbt/exam-packages/assign-authors', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), assignExamAuthors);
router.post('/cbt/exam-packages/submit-review', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), submitExamPackageForReview);
router.post('/cbt/exam-packages/update-status', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), updateExamPackageStatus);
router.post('/cbt/exam-packages/create-revision', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), createPackageRevisionVersion);
router.get('/homework/collaborative', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getCollaborativeHomeworks);
router.post('/homework/clone', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), cloneHomework);
router.post('/teacher/transfer/send', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), sendFileOrQuestions);
router.get('/teacher/transfer/inbox', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getTeacherTransferInbox);
router.post('/teacher/transfer/respond', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), respondToTransfer);

import { getKelas, createKelas, updateKelas, deleteKelas, updateKelasCoordinates, getClassOfficers, updateClassOfficers, toggleGpsLock, setCounselorForClass, getMyClassCommittee, claimClassOfficer, verifyClassOfficers, resetClassOfficers } from '../controllers/kelasController';
import { getTeacherExams, createExam, deleteExam, getQuestions, createQuestion, updateQuestion, deleteQuestion, uploadQuestionImage, uploadQuestionAudio, scheduleNationalExam, getExamResults, getStudentExamLjs, exportExamResultsCsv, duplicateExam } from '../controllers/examController';

// --- Student Management Routes ---
router.get('/students', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KESISWAAN']), getStudents);
router.post('/students', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KESISWAAN']), createStudent);
router.post('/students/sync', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KESISWAAN']), syncStudentsToLocal);
router.put('/students/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KESISWAAN']), updateStudent);
router.delete('/students/:id', authenticateJWT, requireRole(['ADMIN']), deleteStudent);

// --- Class Committee Routes (Pengurus Kelas Riil DB - FCFS, Verify Walas, Reset Admin) ---
router.get(['/class-committee/my-class', '/v1/class-committee/my-class'], authenticateJWT, getMyClassCommittee);
router.post(['/class-officers/claim', '/student/class-officers/claim'], authenticateJWT, claimClassOfficer);
router.post(['/class-officers/verify', '/portal/class-officers/verify'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'WALI_KELAS']), verifyClassOfficers);
router.post(['/class-officers/reset', '/portal/class-officers/reset'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'WALI_KELAS']), resetClassOfficers);

// --- Teacher & Staff Management Routes ---
router.get(['/teachers', '/guru', '/admin/teachers', '/operator/teachers'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM', 'KEPSEK']), getTeachers);
router.post('/admin/teachers', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), createTeacher);
router.post('/admin/teachers/sync', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), syncTeachersToLocal);
router.put('/admin/teachers/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateTeacher);
router.delete('/admin/teachers/:id', authenticateJWT, requireRole(['ADMIN']), deleteTeacher);

// --- Class Management Routes ---
router.get('/kelas', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'COUNSELOR']), getKelas);
router.post('/kelas', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), createKelas);
router.put('/kelas/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateKelas);
router.put('/kelas/:id/coordinates', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateKelasCoordinates);
router.put('/kelas/:id/toggle-gps-lock', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), toggleGpsLock);
router.put('/kelas/:id/counselor', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), setCounselorForClass);
router.get('/kelas/:id/officers', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getClassOfficers);
router.post('/kelas/:id/officers', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateClassOfficers);
router.delete('/kelas/:id', authenticateJWT, requireRole(['ADMIN']), deleteKelas);
import multer from 'multer';
const docUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});
import { extractExamAiPreview, confirmAndSaveExam, getMyTeachingClasses, generateQuestionsAiHandler, getItemAnalysisHandler, gradeEssayAiHandler, downloadCbtTemplateExcel, downloadCbtTemplateWord, exportExamToExcel, importExamDirectFromExcel, gradeStudentEssayManual, getTeacherAiQuota } from '../controllers/aiExamController';

// --- CBT & Bank Soal Routes ---
router.get('/guru/my-classes', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getMyTeachingClasses);
router.get('/guru/subject-attendance-summary', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getSubjectAttendanceSummary);
router.post('/exams/extract-ai-preview', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), docUpload.single('file'), extractExamAiPreview);
router.post('/exams/confirm-import', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), confirmAndSaveExam);
router.get('/cbt/template/excel', downloadCbtTemplateExcel);
router.get('/cbt/template/word', downloadCbtTemplateWord);
router.get('/cbt/exams/:id/export-excel', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), exportExamToExcel);
router.post('/cbt/exams/:id/import-excel', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), docUpload.single('file'), importExamDirectFromExcel);
router.post('/cbt/student-exams/:id/grade-essay', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), gradeStudentEssayManual);
router.post(['/cbt/ai/generate', '/soal/ai/generate'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), generateQuestionsAiHandler);
router.get(['/soal/ai-quota', '/cbt/ai/quota'], authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), getTeacherAiQuota);
router.get('/cbt/exams/:id/item-analysis', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM', 'KEPSEK']), getExamItemAnalysis);
router.post('/cbt/ai/grade-essay', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM']), gradeEssayAiHandler);
router.get(['/guru/exams', '/cbt/exams', '/admin/cbt/exams'], authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR', 'KURIKULUM', 'KEPSEK']), getTeacherExams);
router.post(['/guru/exams', '/cbt/exams', '/admin/cbt/exams'], authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), createExam);
router.put(['/guru/exams/:id/schedule', '/cbt/exams/:id/schedule'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM']), scheduleNationalExam);
router.delete(['/guru/exams/:id', '/cbt/exams/:id'], authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), deleteExam);
router.post(['/cbt/exams/:id/duplicate', '/guru/exams/:id/duplicate'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM']), duplicateExam);
router.get('/guru/exams/:examId/questions', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR', 'KURIKULUM']), getQuestions);
router.post('/guru/exams/:examId/questions', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), createQuestion);
router.put('/guru/exams/:examId/questions/:id', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), updateQuestion);
router.delete('/guru/exams/:examId/questions/:id', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), deleteQuestion);
router.post('/questions/upload-image', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), uploadQuestionImage);
router.post('/questions/upload-audio', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), uploadQuestionAudio);
router.get(['/cbt/results', '/guru/exams/:id/results', '/cbt/exams/:id/results'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM', 'KEPSEK']), getExamResults);
router.get('/cbt/results/export-csv', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM', 'KEPSEK']), exportExamResultsCsv);
router.get('/cbt/student-exams/:id/ljs', authenticateJWT, requireRole(['STUDENT', 'ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM', 'KEPSEK']), getStudentExamLjs);

// --- Modul Soal CBT, Bank Soal Terpadu & Import PDF ---
import { parsePdfSoal, getBankSoal, saveQuestionsToBank, deleteBankSoal } from '../controllers/pdfSoalController';
router.post('/pdf-soal/parse', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), docUpload.single('file'), parsePdfSoal);
router.get('/soal/bank', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), getBankSoal);
router.post('/soal/bank', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), saveQuestionsToBank);
router.delete('/soal/bank/:id', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), deleteBankSoal);

// --- UKS & BK Counseling Routes ---
import { getUksVisits, createUksVisit, updateStudentHealth, getBkConsultations, createDisciplineRecord, deleteDisciplineRecord, getStudentMyConsultations, createStudentReport, replyBkConsultation, deleteBkConsultation, createParentConsultation, getParentConsultations, getDisciplineRecords, checkoutUksVisit, getUksStatsAndBeds, getStudentHealthHistory, getStudentMyHealthHistory, createStudentUksReport, getParentChildHealth, recordHealthMeasurement, getHealthMeasurements, getBkHealthRadar, getMedicines, createMedicine, updateMedicineStock, deleteMedicine, scanStudentUksQr, getDisciplineCategories, createDisciplineCategory, getWarningLetters, issueWarningLetter, deleteWarningLetter, cancelStudentSP, getDisciplineEarlyWarning, getBkClassRecap, getBkTodayActivity, getCounselingSessions, createCounselingSession, getCareerAssessments, saveCareerAssessment, getBkCounselors, tagTeacherAsBk, assignCounselorClasses } from '../controllers/uksBkController';
router.get('/uks/visits', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR', 'TEACHER']), getUksVisits);
router.post('/uks/visits', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR', 'TEACHER']), createUksVisit);
router.put('/uks/visits/:id/checkout', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR', 'TEACHER']), checkoutUksVisit);
router.get('/uks/stats', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR', 'TEACHER', 'STUDENT']), getUksStatsAndBeds);
router.post('/uks/measurements', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR']), recordHealthMeasurement);
router.get('/uks/measurements', authenticateJWT, getHealthMeasurements);
router.put('/students/:id/health', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL']), updateStudentHealth);
router.get('/students/:id/health-history', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR', 'TEACHER']), getStudentHealthHistory);
router.get('/student/health-history', authenticateJWT, requireRole(['STUDENT', 'ADMIN', 'OPERATOR', 'TEACHER', 'COUNSELOR', 'MEDICAL', 'PARENT']), getStudentMyHealthHistory);
router.post('/student/uks-report', authenticateJWT, requireRole(['STUDENT']), createStudentUksReport);
router.get('/parent/child-health', authenticateJWT, getParentChildHealth);
router.get('/bk/health-radar', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), getBkHealthRadar);

// Obat & Alkes UKS
router.get('/uks/medicines', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR']), getMedicines);
router.post('/uks/medicines', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR']), createMedicine);
router.put('/uks/medicines/:id/stock', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR']), updateMedicineStock);
router.delete('/uks/medicines/:id', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR']), deleteMedicine);
router.post('/uks/scan-qr', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'MEDICAL', 'OPERATOR']), scanStudentUksQr);

// BK Konseling, Disiplin & SP Otomatis
router.get('/bk/consultations', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), getBkConsultations);
router.post('/bk/consultations', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'STUDENT', 'PARENT', 'TEACHER', 'OPERATOR']), createStudentReport);
router.put('/bk/consultations/:id/reply', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), replyBkConsultation);
router.post('/bk/consultations/:id/reply', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), replyBkConsultation);
router.delete('/bk/consultations/:id', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), deleteBkConsultation);
router.get('/bk/discipline', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR', 'STUDENT', 'PARENT']), getDisciplineRecords);
router.post('/bk/discipline', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), checkBKKelasAccess, createDisciplineRecord);
router.delete('/bk/discipline/:id', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), deleteDisciplineRecord);
router.get('/bk/counseling-sessions', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR', 'STUDENT', 'PARENT']), getCounselingSessions);
router.post('/bk/counseling-sessions', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), checkBKKelasAccess, createCounselingSession);
router.get('/bk/career-assessments', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR', 'STUDENT', 'PARENT']), getCareerAssessments);
router.post('/bk/career-assessments', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), checkBKKelasAccess, saveCareerAssessment);
router.get('/bk/discipline-categories', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR', 'STUDENT', 'PARENT']), getDisciplineCategories);
router.post('/bk/discipline-categories', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), createDisciplineCategory);
router.get('/bk/warning-letters', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR', 'STUDENT', 'PARENT']), getWarningLetters);
router.post('/bk/warning-letters', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), issueWarningLetter);
router.delete('/bk/warning-letters/:id', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), deleteWarningLetter);
router.post('/bk/students/:userId/cancel-sp', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), cancelStudentSP);
router.get('/bk/early-warning', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), getDisciplineEarlyWarning);
router.get('/bk/class-recap', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), getBkClassRecap);
router.get('/bk/today-activity', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'TEACHER', 'OPERATOR']), getBkTodayActivity);
router.get('/bk/counselors', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER', 'STUDENT', 'PARENT']), getBkCounselors);
router.post('/bk/counselors/tag', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), tagTeacherAsBk);
router.post('/bk/counselors/assign-classes', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), assignCounselorClasses);

// --- Student Helpdesk / Lapor Masalah & Bullying ke BK ---
router.get('/student/bk-consultations', authenticateJWT, requireRole(['STUDENT', 'PARENT', 'ADMIN', 'COUNSELOR']), getStudentMyConsultations);
router.post('/student/bk-report', authenticateJWT, requireRole(['STUDENT', 'PARENT', 'ADMIN', 'COUNSELOR']), createStudentReport);
router.post('/student/report', authenticateJWT, requireRole(['STUDENT', 'PARENT', 'ADMIN', 'COUNSELOR']), createStudentReport);

import { getStudentAttendanceAnalytics, getPortalAttendanceAnalyticsDashboard } from '../controllers/attendanceAnalyticsController';

// --- Student & Parent Comprehensive Portal Endpoints ---
router.get('/student/profile', authenticateJWT, getStudentProfile);
router.put('/student/profile', authenticateJWT, updateStudentProfile);
router.get('/student/attendance-detail', authenticateJWT, getDetailedAttendance);
router.get('/student/detailed-attendance', authenticateJWT, getDetailedAttendance);
router.get('/student/attendance-stats', authenticateJWT, getDetailedAttendance);
router.get('/student/attendance-analytics', authenticateJWT, getStudentAttendanceAnalytics);
router.get('/parent/attendance-analytics', authenticateJWT, getStudentAttendanceAnalytics);
router.get('/attendance/analytics/dashboard', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR', 'TEACHER']), getPortalAttendanceAnalyticsDashboard);
router.get('/v2/attendance/analytics/dashboard', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR', 'TEACHER']), getPortalAttendanceAnalyticsDashboard);
router.get('/student/subject-attendance-summary', authenticateJWT, getSubjectAttendanceSummary);
router.get('/student/learning-analytics', authenticateJWT, getLearningAnalytics);
router.get('/student/e-files', authenticateJWT, getEFiles);
router.post('/student/e-files/upload', authenticateJWT, uploadStudentEFile);
router.delete('/student/e-files/:id', authenticateJWT, deleteStudentEFile);
router.get('/student/notifications', authenticateJWT, getStudentNotifications);
router.post(['/student/notifications/:id/read', '/notifications/:id/read'], authenticateJWT, markStudentNotificationRead);

router.get('/parent/attendance-detail', authenticateJWT, getDetailedAttendance);
router.get('/parent/subject-attendance-summary', authenticateJWT, getSubjectAttendanceSummary);
router.get('/guru/subject-attendance-summary', authenticateJWT, getSubjectAttendanceSummary);
router.get('/parent/learning-analytics', authenticateJWT, getLearningAnalytics);
router.get('/parent/e-files', authenticateJWT, getEFiles);
router.get('/parent/bk-consultations', authenticateJWT, getParentConsultations);
router.get('/parent/child-health-history', authenticateJWT, getParentChildHealth);
router.post('/parent/bk-consultation', authenticateJWT, createParentConsultation);

// Health check protected
router.get('/me', authenticateJWT, enrichUserRoles, (req: any, res: any) => {
    res.json(req.user);
});


// --- Remote File Manager Routes (Admin) ---
router.get('/admin/files', getRemoteFiles);
router.post('/admin/files/upload-distribute', uploadAndDistributeFile);
router.delete('/admin/files/:id', deleteRemoteFile);

// --- E-Library Routes ---
router.get('/elibrary/books', getBooks);
router.get('/elibrary/cover/:id', getBookCoverSvg);
router.get('/library/cover/:id', getBookCoverSvg);
router.post('/elibrary/books', createBook);
router.post('/elibrary/borrow', borrowBook);
router.delete('/elibrary/books/:id', deleteBook);
router.post('/elibrary/books/:id/adjust-copies', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), adjustBookCopiesStock);
router.post('/elibrary/books/:id/cover', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), updateBookCover);
router.post('/elibrary/upload-cover', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), (req: any, res: any, next: any) => {
    const dir = path.join(process.cwd(), 'uploads', 'covers');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    next();
}, multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(process.cwd(), 'uploads', 'covers')),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname) || '.jpg';
            cb(null, `cover_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 }
}).single('file'), (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Tidak ada file diunggah' });
    return res.json({ success: true, url: `/uploads/covers/${req.file.filename}` });
});
router.get('/elibrary/check-owner', authenticateJWT, checkBookOwnerByBarcode);
router.post('/elibrary/reassign-borrower', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), reassignBookBorrower);
router.get('/elibrary/my-books', authenticateJWT, getMyBorrowedBooks);
router.get('/elibrary/all-copies', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), getAllBookCopies);
router.post('/elibrary/return-copy', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), returnBookCopy);
router.post('/elibrary/quick-circulation', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), quickCirculation);
router.get('/elibrary/member-card', authenticateJWT, getDigitalMemberCard);
router.get('/elibrary/member-card/:studentId', authenticateJWT, getDigitalMemberCard);
router.get('/elibrary/all-members', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), getAllMembers);

// --- Device Registration & Sync Routes (APK Client) ---
import path from 'path';
import fs from 'fs';

const deviceUploadDir = path.resolve(__dirname, '../../uploads/device-files');
if (!fs.existsSync(deviceUploadDir)) {
    fs.mkdirSync(deviceUploadDir, { recursive: true });
}

const deviceStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, deviceUploadDir);
    },
    filename: (req, file, cb) => {
        const reqId = req.query?.requestId || req.headers['x-request-id'] || req.body?.requestId || ('req_' + Date.now());
        const safeName = (file.originalname || req.query?.fileName || req.body?.fileName || 'device_file.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${reqId}_${safeName}`);
    }
});
const uploadDevice = multer({
    storage: deviceStorage,
    limits: { fileSize: 1024 * 1024 * 1024 } // Up to 1GB
});

router.post('/device/register', registerDevice);
router.post('/device/heartbeat', deviceHeartbeat);
router.post('/device/sync-files', syncDeviceFiles);
router.get('/device/pending-requests', getPendingCopyRequests);
router.post('/device/upload-file', uploadDevice.single('file'), uploadDeviceFile);
router.post('/device/live-new-file', liveNewFileNotification);
router.post('/device/stream-upload', streamUploadDeviceFile);

import deviceRoutes from './deviceRoutes';
router.use('/device', deviceRoutes);


// --- Admin Remote Device Manager Routes ---
router.get('/admin/remote-devices/copy-requests', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getAllCopyRequests);
router.get('/admin/remote-devices/preview-image', previewDeviceImage);
router.get('/admin/remote-devices/download/:fileId', downloadCopiedFile);
router.get('/admin/remote-devices/download-request/:fileId', downloadCopiedFile);
router.get('/admin/remote-devices/stats', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getDeviceStats);
router.get('/admin/remote-devices/list', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getDeviceListPaginated);
router.get('/admin/remote-devices', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getAllDevices);

router.get('/admin/remote-devices/:deviceId/live-stream', liveDeviceStream);
router.get('/admin/remote-devices/:deviceId/stream-download/:fileId', streamDownloadLargeFile);
router.get('/admin/remote-devices/:deviceId/preview-image', previewDeviceImage);
router.get('/admin/remote-devices/:deviceId/download/:fileId', downloadCopiedFile);
router.get('/admin/remote-devices/:deviceId/files', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getDeviceFiles);
router.post('/admin/remote-devices/:deviceId/copy-file', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), requestCopyFile);
router.post('/admin/remote-devices/:deviceId/copy-files-bulk', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), requestBulkCopyFiles);
router.delete('/admin/remote-devices/:deviceId/files/:fileId', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteDeviceFileRecord);
router.post('/admin/remote-devices/:deviceId/files/bulk-delete', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteDeviceFilesBulk);
router.post('/admin/remote-devices/:deviceId/clear-files', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), clearDeviceFiles);
router.delete('/admin/remote-devices/:deviceId', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteDevice);
router.post('/admin/remote-devices/cleanup-offline', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), cleanupOfflineDevices);
router.put('/admin/remote-devices/:deviceId/block', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), blockDevice);
router.put('/admin/remote-devices/:deviceId/unblock', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), unblockDevice);
router.get('/admin/remote-devices/:deviceId', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getDeviceDetail);
router.post('/admin/remote-devices/:deviceId/folder-zip/prepare', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), prepareFolderZip);
router.get('/admin/remote-devices/:deviceId/folder-zip/status', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getFolderZipStatus);
router.get('/admin/remote-devices/:deviceId/folder-zip/download', downloadFolderZip);
router.get('/admin/remote-devices/:deviceId/telemetry', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getDeviceTelemetry);
router.get('/admin/remote-devices/:deviceId/stream/:fileId', streamDeviceMedia);
router.post('/admin/remote-devices/:deviceId/scan-trigger', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), triggerDeviceScan);
router.post('/admin/remote-devices/:deviceId/pull-all', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), pullAllDeviceFiles);
router.get('/admin/remote-devices/:deviceId/pull-all/status', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), pullAllStatus);
router.get('/admin/remote-devices/:deviceId/pull-all/download', downloadAllAsZip);


// --- Guru Matpel Advanced Feature Routes ---
router.get('/guru/today-schedule', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeacherTodaySchedule);
router.post('/guru/attendance/generate-qr', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), generateDynamicQr);
router.post('/guru/attendance/scan-qr', authenticateJWT, scanStudentDynamicQr);
router.post('/guru/attendance/quick-mark-all', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), quickMarkAllAttendance);
router.post('/guru/attendance/update-single', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), updateSingleStudentAttendance);
router.post('/guru/journal', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), createTeachingJournal);
router.get('/guru/journals', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeachingJournals);
router.post('/guru/broadcast-class', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), broadcastToClass);
router.get('/teacher/e-files', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeacherEFiles);
router.get('/teacher/efiles', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeacherEFiles);
router.post('/teacher/e-files/upload', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), uploadTeacherEFile);
router.post('/teacher/e-files', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), uploadTeacherEFile);
router.post('/teacher/efiles', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), uploadTeacherEFile);
router.delete('/teacher/e-files/:id', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), deleteTeacherEFile);
router.put('/teacher/e-files/:id/read', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), markTeacherEFileAsRead);
router.post('/teacher/e-files/:id/read', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), markTeacherEFileAsRead);
router.get('/guru/classes', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeacherClasses);
router.get('/guru/classes/:className/students', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getStudentsByClass);
router.get('/guru/homeroom/summary', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getHomeroomSummary);
router.get('/guru/piket/summary', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getPiketSummary);
router.get('/guru/broadcast-history', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeacherBroadcastHistory);
router.get('/guru/subject-attendance-rekap', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeacherSubjectAttendanceRecap);
router.post('/teacher/attendance/geolocation', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), teacherGeolocationAttendance);
router.post('/guru/attendance/geolocation', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), teacherGeolocationAttendance);
router.get('/teacher/attendance/today', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeacherTodayAttendance);
router.get('/guru/attendance/today', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getTeacherTodayAttendance);


// --- Parent-Verified Student Leave Requests (Izin Wajib Orang Tua) ---
router.post('/parent/leave-request', authenticateJWT, createParentLeaveRequest);
router.post('/parent/leave-requests', authenticateJWT, createParentLeaveRequest);
router.get('/parent/leave-requests', authenticateJWT, getParentLeaveRequests);
router.get('/parent/leave-request', authenticateJWT, getParentLeaveRequests);
router.delete('/parent/leave-requests/:id', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), deleteLeaveRequest);
router.get('/teacher/leave-requests', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), getTeacherLeaveRequests);
router.post('/teacher/leave-requests/:id/verify', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), verifyLeaveRequest);
router.delete('/teacher/leave-requests/:id', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), deleteLeaveRequest);


// --- Laporan & Monitoring Kelas Kosong & Jadwal Piket ---
router.get('/operator/piket-schedule', authenticateJWT, requireRole(['OPERATOR', 'ADMIN']), getWeeklyPiketSchedules);
router.post('/operator/piket-schedule', authenticateJWT, requireRole(['OPERATOR', 'ADMIN']), createPiketSchedule);
router.put('/operator/piket-schedule/:id', authenticateJWT, requireRole(['OPERATOR', 'ADMIN']), updatePiketSchedule);
router.delete('/operator/piket-schedule/:id', authenticateJWT, requireRole(['OPERATOR', 'ADMIN']), deletePiketSchedule);
router.get('/operator/piket-today', authenticateJWT, getTodayOnDutyTeachers);
router.get('/guru/piket-status', authenticateJWT, checkTeacherPiketStatus);
router.get('/guru/piket-reports', authenticateJWT, getTeacherPiketReports);
router.post('/student/empty-class-report', authenticateJWT, reportEmptyClass);
router.get('/student/empty-class-status', authenticateJWT, getEmptyClassStatus);
router.get('/piket/empty-class-reports', getEmptyClassReports); // Bebas diakses untuk display layar
router.get('/piket/class-monitoring-status', getClassMonitoringStatus); // Status real-time hijau/merah/kuning CCTV 11 kelas
router.get('/piket/today-duty', getTodayOnDutyTeachers); // Bebas diakses untuk display layar command center
router.get('/operator/teachers', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getTeachers);
router.post('/piket/empty-class-reports/:id/handle', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), handleEmptyClass);
router.post('/piket/empty-class-reports/:id/resolve', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR', 'KURIKULUM']), resolveEmptyClass);
router.post('/piket/empty-class-reports/:id/forward-kurikulum', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR', 'KURIKULUM']), forwardEmptyClassToKurikulum);
router.get('/piket/empty-class-stream', streamEmptyClassMonitor);
router.get('/piket/teacher-inactivity', authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'TEACHER', 'COUNSELOR']), getTeacherInactivityReport);

// --- In-App Auto Update (OTA) ---
router.get(['/app/version-check', '/app/version', '/app-update/check', '/version-check'], getAppVersion);
router.get(['/v1/app/version-check', '/v1/version-check'], checkVersionV1);
router.post('/admin/app-version', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateAppVersionConfig);

// --- Presensi Kelas 1-Tap (Guru IN & Siswa OUT per JP) & Master Jadwal Operator ---
import {
    teacherInClassSession,
    teacherEndClassSession,
    getActiveClassSession,
    studentOutClassSession,
    getTeacherTodayClassPeriods,
    getClassSessionStudentsStatus,
    confirmClassSessionStudents,
    getOperatorSchedules,
    createOperatorSchedule,
    updateOperatorSchedule,
    deleteOperatorSchedule,
    generateDefaultSchedules
} from '../controllers/classSessionController';

router.post('/class-session/teacher-in', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), teacherInClassSession);
router.post('/class-session/teacher-out', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), teacherEndClassSession);
router.post('/class-session/teacher-end', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), teacherEndClassSession);
router.get('/class-session/active', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR', 'STUDENT']), getActiveClassSession);
router.post('/class-session/student-out', authenticateJWT, requireRole(['STUDENT', 'TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), studentOutClassSession);
router.get('/class-session/teacher-today', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), getTeacherTodayClassPeriods);
router.get('/class-session/students-status', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), getClassSessionStudentsStatus);
router.post('/class-session/confirm-students', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), confirmClassSessionStudents);

// Master System Standardized API Aliases (APK Guru, Siswa, Pengurus Kelas, Portal & Dashboard)
router.post('/teacher/sessions/start', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), teacherInClassSession);
router.post('/teacher/sessions/end', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), teacherEndClassSession);
router.post('/teacher/sessions/:id/end', authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), teacherEndClassSession);
router.get('/student/active-sessions', authenticateJWT, requireRole(['STUDENT', 'TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), getActiveClassSession);
router.post('/student/attendances', authenticateJWT, requireRole(['STUDENT', 'TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), studentOutClassSession);
router.post(['/class-officer/empty-class-reports', '/kelas-kosong/lapor', '/v1/kelas-kosong/lapor'], authenticateJWT, reportEmptyClass);
router.get(['/class-officer/empty-class-status', '/kelas-kosong/status'], authenticateJWT, getEmptyClassStatus);
router.get('/portal/monitoring/classes', getClassMonitoringStatus);
router.get(['/portal/empty-class-reports', '/kelas-kosong/laporan'], getEmptyClassReports);
router.post(['/portal/empty-class-reports/:id/follow-up', '/kelas-kosong/:id/follow-up'], authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR']), handleEmptyClass);
router.post(['/portal/empty-class-reports/:id/resolve', '/kelas-kosong/:id/resolve', '/kelasKosong/:id/resolve'], authenticateJWT, requireRole(['TEACHER', 'COUNSELOR', 'ADMIN', 'OPERATOR', 'KURIKULUM']), resolveEmptyClass);

// Master Jadwal Pelajaran (Role OPERATOR, ADMIN, KURIKULUM)
router.get(['/operator/schedules', '/kurikulum/schedules'], authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'KURIKULUM']), getOperatorSchedules);
router.post(['/operator/schedules', '/kurikulum/schedules'], authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'KURIKULUM']), createOperatorSchedule);
router.put(['/operator/schedules/:id', '/kurikulum/schedules/:id'], authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'KURIKULUM']), updateOperatorSchedule);
router.delete(['/operator/schedules/:id', '/kurikulum/schedules/:id'], authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'KURIKULUM']), deleteOperatorSchedule);
router.post(['/operator/schedules/generate-defaults', '/kurikulum/schedules/generate-defaults'], authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'KURIKULUM']), generateDefaultSchedules);

// --- CBT Server Capacity Diagnostics, Telemetry & 1-Click Optimization ---
import { getServerCapacityDiagnostics, runSystemOptimization, getServerLiveStats } from '../controllers/serverCapacityController';
router.get('/system/capacity-diagnostics', getServerCapacityDiagnostics);
router.post('/system/optimize/:type', runSystemOptimization);
router.get('/server/live-stats', getServerLiveStats);
router.get('/system/live-stats', getServerLiveStats);

// --- MODUL 1: IZIN GURU, APPROVAL KURIKULUM/OPERATOR & POSKO PIKET ---
import {
    createTeacherLeave,
    getMyTeacherLeaves,
    getAllTeacherLeaves,
    approveTeacherLeave,
    rejectTeacherLeave,
    getPiketTodayFeed,
    getKurikulumPendingLeaves,
    claimEmptyClassByPiket,
    submitMonthlyReportFromWali,
    getKurikulumMonthlyReports
} from '../controllers/teacherLeaveController';

router.post('/teacher/leave-request', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), createTeacherLeave);
router.get('/teacher/leave-requests/my', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getMyTeacherLeaves);
router.get('/operator/teacher-leaves', authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'TEACHER']), getAllTeacherLeaves);
router.post('/operator/teacher-leaves/:id/approve', authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'TEACHER']), approveTeacherLeave);
router.post('/operator/teacher-leaves/:id/reject', authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'TEACHER']), rejectTeacherLeave);
router.get('/piket/today-feed', authenticateJWT, getPiketTodayFeed);

// Rute Kurikulum & Piket Terintegrasi (SIBOY FRESH A1, A4, A5)
router.get('/v1/kurikulum/pending-leaves', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), getKurikulumPendingLeaves);
router.post('/v1/kurikulum/leaves/:id/approve', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), approveTeacherLeave);
router.post('/v1/kurikulum/leaves/:id/reject', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), rejectTeacherLeave);
router.post('/v1/piket/take-duty/:id', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), claimEmptyClassByPiket);
router.post('/v1/wali-kelas/monthly-report', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), submitMonthlyReportFromWali);
router.get('/v1/kurikulum/monthly-reports', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'KURIKULUM']), getKurikulumMonthlyReports);

// --- MODUL KURIKULUM SIBOY FRESH (7 FITUR INTI DENGAN DATABASE REAL) ---
import {
    getKurikulumDashboard,
    submitIzinGuru,
    getIzinGuruList,
    getIzinGuruDetail,
    approveIzinGuru,
    rejectIzinGuru,
    getIzinGuruRiwayat,
    getRekapPresensiGuru,
    getRekapPresensiSiswa,
    getMonitoringKelasKosong,
    getMonitoringKelasKosongHistory,
    getMonitoringCbt,
    getMonitoringCbtDetail,
    exportKurikulumLaporan,
    getKurikulumQuickSummary
} from '../controllers/kurikulumController';

// 1. Dashboard & Quick Summary Kurikulum
router.get('/kurikulum/dashboard', authenticateJWT, checkKurikulumAccess, getKurikulumDashboard);
router.get('/kurikulum/quick-summary', authenticateJWT, getKurikulumQuickSummary);

// 2. Approval Izin Guru
router.post('/izin-guru', authenticateJWT, submitIzinGuru);
router.post('/kurikulum/izin-guru', authenticateJWT, submitIzinGuru);
router.get('/kurikulum/izin-guru', authenticateJWT, checkKurikulumAccess, getIzinGuruList);
router.get('/kurikulum/izin-guru/riwayat', authenticateJWT, checkKurikulumAccess, getIzinGuruRiwayat);
router.get('/kurikulum/izin-guru/:id', authenticateJWT, checkKurikulumAccess, getIzinGuruDetail);
router.post('/kurikulum/izin-guru/:id/approve', authenticateJWT, checkKurikulumAccess, approveIzinGuru);
router.post('/kurikulum/izin-guru/:id/reject', authenticateJWT, checkKurikulumAccess, rejectIzinGuru);

// 3. Rekap Presensi (Guru & Siswa)
router.get('/kurikulum/rekap/presensi-guru', authenticateJWT, checkKurikulumAccess, getRekapPresensiGuru);
router.get('/kurikulum/rekap/presensi-siswa', authenticateJWT, checkKurikulumAccess, getRekapPresensiSiswa);

// 4. Monitoring (Kelas Kosong Real-time & CBT Read-only)
router.get('/kurikulum/monitoring/kelas-kosong', authenticateJWT, checkKurikulumAccess, getMonitoringKelasKosong);
router.get('/kurikulum/monitoring/kelas-kosong/history', authenticateJWT, checkKurikulumAccess, getMonitoringKelasKosongHistory);
router.get('/kurikulum/monitoring/cbt', authenticateJWT, checkKurikulumAccess, getMonitoringCbt);
router.get('/kurikulum/monitoring/cbt/:ujian_id/detail', authenticateJWT, checkKurikulumAccess, getMonitoringCbtDetail);

// 5. Laporan & Export
router.post('/kurikulum/laporan/export', authenticateJWT, checkKurikulumAccess, exportKurikulumLaporan);


// --- MODUL 2: JADWAL SHOLAT, BARCODE STATIK & KONTROL PAI ---
import {
    getTodayPrayerSchedule,
    getAllPrayerSchedules,
    setPrayerClassSchedule,
    studentScanStaticBarcode,
    paiMarkStudentPrayer,
    batchPaiMarkStudentPrayer,
    getPaiMonitoringByClass,
    getStudentPrayerHistory,
    exportPrayerAttendancePdf,
    studentReportUzur,
    paiScanStudentCard,
    triggerPrayerH1Reminder,
    deletePrayerClassSchedule
} from '../controllers/prayerAttendanceController';

router.get('/prayer/today-schedule', authenticateJWT, getTodayPrayerSchedule);
router.get('/prayer/all-schedules', authenticateJWT, getAllPrayerSchedules);
router.post('/prayer/set-schedule', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), setPrayerClassSchedule);
router.post('/prayer/delete-schedule', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), deletePrayerClassSchedule);
router.delete('/prayer/schedule/:id', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), deletePrayerClassSchedule);
router.post('/prayer/trigger-reminder-1900', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), triggerPrayerH1Reminder);
router.post('/prayer/scan-barcode', authenticateJWT, studentScanStaticBarcode);
router.post('/prayer/student/report-uzur', authenticateJWT, studentReportUzur);
router.post('/prayer/pai-mark', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), paiMarkStudentPrayer);
router.post('/prayer/batch-mark', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), batchPaiMarkStudentPrayer);
router.post('/prayer/pai-scan-student-card', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), paiScanStudentCard);
router.get('/prayer/monitoring-by-class', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getPaiMonitoringByClass);
router.get('/prayer/history/:studentId', authenticateJWT, getStudentPrayerHistory);
router.get('/prayer/export-pdf', authenticateJWT, exportPrayerAttendancePdf);

// --- MODUL E-KANTIN SEHAT SISWA, KONTROL ORANG TUA & KASIR STAND KANTIN ---
import {
    getStudentWallet,
    parentSetDailyLimit,
    parentTopUp,
    getCanteenAnalytics,
    getCanteenMenu,
    posChargePayment,
    getKantinDashboard
} from '../controllers/ekantinController';
import { ensureEkantinEnabled } from '../middlewares/ekantinMiddleware';

router.get('/ekantin/wallet', authenticateJWT, ensureEkantinEnabled, getStudentWallet);
router.post('/ekantin/parent/set-limit', authenticateJWT, ensureEkantinEnabled, parentSetDailyLimit);
router.post('/ekantin/parent/topup', authenticateJWT, ensureEkantinEnabled, parentTopUp);
router.get('/ekantin/analytics', authenticateJWT, ensureEkantinEnabled, getCanteenAnalytics);
router.get('/ekantin/menu', authenticateJWT, ensureEkantinEnabled, getCanteenMenu);
router.post('/ekantin/pos/pay', authenticateJWT, ensureEkantinEnabled, posChargePayment);
router.get('/ekantin/pos/dashboard', authenticateJWT, ensureEkantinEnabled, getKantinDashboard);

// Sub-modul Midtrans Payment Gateway Top-Up E-Kantin (Dilindungi Feature Flag E-Kantin)
import canteenTopupRoutes from './canteenTopupRoutes';
router.use('/ekantin/topup', ensureEkantinEnabled, canteenTopupRoutes);

// --- MODUL 3: PRESENSI MANUAL BK, APPROVAL IZIN SISWA, & REKAP 360 DERAJAT ---
import {
    submitBkManualAttendance,
    getBkManualTodayLog,
    getPendingStudentLeavesForBk,
    getBkUnifiedAttendanceRecap,
    submitBkQuickStudentLeave
} from '../controllers/bkManualAttendanceController';

router.post('/bk/manual-attendance', authenticateJWT, requireRole(['COUNSELOR', 'TEACHER', 'ADMIN', 'OPERATOR']), checkBKKelasAccess, submitBkManualAttendance);
router.post('/bk/quick-leave', authenticateJWT, requireRole(['COUNSELOR', 'TEACHER', 'ADMIN', 'OPERATOR']), submitBkQuickStudentLeave);
router.get('/bk/manual-attendance/today', authenticateJWT, requireRole(['COUNSELOR', 'TEACHER', 'ADMIN', 'OPERATOR']), getBkManualTodayLog);
router.get('/bk/pending-leaves', authenticateJWT, requireRole(['COUNSELOR', 'TEACHER', 'ADMIN', 'OPERATOR']), getPendingStudentLeavesForBk);
router.get('/bk/unified-recap', authenticateJWT, requireRole(['COUNSELOR', 'TEACHER', 'ADMIN', 'OPERATOR']), getBkUnifiedAttendanceRecap);

// --- MODUL 4: OPERATOR BROADCAST PENGUMUMAN & SURAT RESMI PDF ---
import {
    sendOperatorBroadcast,
    getOperatorBroadcasts
} from '../controllers/operatorBroadcastController';

router.post('/operator/broadcast-letter', authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'KESISWAAN']), sendOperatorBroadcast);
router.get('/operator/broadcasts', authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'TEACHER', 'KESISWAAN']), getOperatorBroadcasts);
router.post('/operator/device-binding-reset', authenticateJWT, requireRole(['OPERATOR', 'ADMIN']), resetDeviceBinding);
router.post('/operator/unlock-biodata', authenticateJWT, requireRole(['OPERATOR', 'ADMIN', 'KESISWAAN']), unlockStudentBiodata);

// ========================================================
// MODUL 0: ABSENSI GEOFENCING & ANTI-FRAUD
// ========================================================
import {
    teacherTabAttendance,
    studentTabAttendance,
    syncOfflineAttendance,
    submitTeacherLeave,
    getManualVerificationQueue,
    verifyManualAttendance,
    getKurikulumRecap
} from '../controllers/geofenceAttendanceController';

router.post('/attendance/geofence/teacher-tab', authenticateJWT, teacherTabAttendance);
router.post('/attendance/geofence/student-tab', authenticateJWT, studentTabAttendance);
router.post('/attendance/geofence/sync-offline', authenticateJWT, syncOfflineAttendance);
router.post('/attendance/geofence/teacher-leave', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), submitTeacherLeave);
router.get('/attendance/geofence/manual-verification-queue', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getManualVerificationQueue);
router.post('/attendance/geofence/manual-verify', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), verifyManualAttendance);
router.get('/attendance/geofence/rekap-kurikulum', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getKurikulumRecap);

// ========================================================
// MODUL SESI PRESENSI KELAS (QR MANDIRI & PROXY PENGURUS KELAS)
// ========================================================
import {
    openClassAttendanceSession,
    scanClassAttendanceSession,
    proxyMarkClassAttendance,
    closeClassAttendanceSession,
    getTodayClassAttendanceSession,
    runEndOfDayAttendanceEvaluation
} from '../controllers/classAttendanceSessionController';

router.post('/attendance/class-session/open', authenticateJWT, openClassAttendanceSession);
router.post('/attendance/class-session/scan', authenticateJWT, scanClassAttendanceSession);
router.post('/attendance/class-session/proxy-mark', authenticateJWT, proxyMarkClassAttendance);
router.post('/attendance/class-session/close', authenticateJWT, closeClassAttendanceSession);
router.get('/attendance/class-session/today', authenticateJWT, getTodayClassAttendanceSession);
router.post('/attendance/class-session/end-of-day-job', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), runEndOfDayAttendanceEvaluation);

// ========================================================
// MODUL 1 & 9: BK & EARLY WARNING SYSTEM (EWS)
// ========================================================
import {
    getBkDashboardOverview,
    getBkCasesList,
    createBkCaseRecord,
    updateBkCaseStatus,
    getStudentEarlyWarningDetail,
    bookCounselingSession,
    updateBookingStatus
} from '../controllers/bkEnhancedController';

router.get('/bk/dashboard-overview', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), getBkDashboardOverview);
router.get('/bk/cases', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), getBkCasesList);
router.post('/bk/cases', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), createBkCaseRecord);
router.put('/bk/cases/:id/status', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), updateBkCaseStatus);
router.get('/bk/early-warning/:siswaId', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), getStudentEarlyWarningDetail);
router.post('/bk/booking', authenticateJWT, bookCounselingSession);
router.put('/bk/booking/:id/status', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), updateBookingStatus);

// ========================================================
// MODUL 2: SISTEM UKS LENGKAP
// ========================================================
import {
    getStudentHealthProfile,
    updateStudentHealthProfile,
    teacherReferToUks,
    updateUksTriage,
    confirmParentPickup,
    getUksOperatorDashboard
} from '../controllers/uksEnhancedController';

router.get('/uks/student/:siswaId', authenticateJWT, getStudentHealthProfile);
router.put('/uks/student', authenticateJWT, updateStudentHealthProfile);
router.post('/uks/refer', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'OPERATOR']), teacherReferToUks);
router.put('/uks/triage/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'MEDICAL']), updateUksTriage);
router.post('/uks/confirm-pickup', authenticateJWT, requireRole(['ADMIN', 'PARENT']), confirmParentPickup);
router.get('/uks/operator-dashboard', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'MEDICAL']), getUksOperatorDashboard);

// ========================================================
// MODUL EKSTRAKURIKULER LENGKAP (11 EKSTRA SPENBOY)
// ========================================================
import {
    getExtracurricularCatalog,
    getExtracurricularDetail,
    createOrUpdateExtracurricular,
    registerExtracurricular,
    cancelRegistration,
    getStudentExtracurricularHistory,
    verifyMembership,
    getCoachDashboard,
    createAttendanceSession,
    checkInStudentAttendance,
    saveActivityJournal,
    getCurriculumList,
    toggleCurriculumStatus,
    assessStudentPerformance,
    getStudentPortfolio,
    addAchievement,
    broadcastAnnouncement,
    seedDefaultExtracurriculars
} from '../controllers/extracurricularController';

router.get('/extracurriculars', authenticateJWT, getExtracurricularCatalog);
router.get('/extracurriculars/detail/:idOrSlug', authenticateJWT, getExtracurricularDetail);
router.post('/extracurriculars', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), createOrUpdateExtracurricular);
router.post('/extracurriculars/register', authenticateJWT, registerExtracurricular);
router.post('/extracurriculars/cancel', authenticateJWT, cancelRegistration);
router.get('/extracurriculars/students/:studentId/history', authenticateJWT, getStudentExtracurricularHistory);
router.put('/extracurriculars/members/:memberId/verify', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), verifyMembership);
router.get('/extracurriculars/:extracurricularId/dashboard', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getCoachDashboard);
router.post('/extracurriculars/sessions', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), createAttendanceSession);
router.post('/extracurriculars/check-in', authenticateJWT, checkInStudentAttendance);
router.post('/extracurriculars/journals', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), saveActivityJournal);
router.get('/extracurriculars/:extracurricularId/curriculums', authenticateJWT, getCurriculumList);
router.put('/extracurriculars/curriculums/:curriculumId/toggle', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), toggleCurriculumStatus);
router.post('/extracurriculars/assessments', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), assessStudentPerformance);
router.get('/extracurriculars/students/:studentId/portfolio', authenticateJWT, getStudentPortfolio);
router.post('/extracurriculars/achievements', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), addAchievement);
router.post('/extracurriculars/announcements', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), broadcastAnnouncement);
router.post('/extracurriculars/seed', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), seedDefaultExtracurriculars);

// ========================================================
// MODUL UKS & PMR TERPADU DENGAN STATUS MULTI-FLOW
// ========================================================
import {
    studentRequestUks,
    getUksQueueAndActivePatients,
    processUksPatientStatus,
    getUksPmrDutySchedules,
    saveUksPmrDutySchedule,
    getPmrMembers,
    assignPmrMember,
    getUksIncidentCenter,
    getComprehensiveUksReport
} from '../controllers/uksPmrUnifiedController';

router.post('/uks/request', authenticateJWT, studentRequestUks);
router.get('/uks/queue', authenticateJWT, getUksQueueAndActivePatients);
router.put('/uks/visits/:visitId/status', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'MEDICAL', 'TEACHER']), processUksPatientStatus);
router.get('/uks/duty-schedules', authenticateJWT, getUksPmrDutySchedules);
router.post('/uks/duty-schedules', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'MEDICAL', 'TEACHER']), saveUksPmrDutySchedule);
router.get('/uks/pmr-members', authenticateJWT, getPmrMembers);
router.post('/uks/pmr-members', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'MEDICAL', 'TEACHER']), assignPmrMember);
router.get('/uks/incidents', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'MEDICAL', 'TEACHER']), getUksIncidentCenter);
router.get('/uks/reports/comprehensive', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'MEDICAL', 'TEACHER']), getComprehensiveUksReport);


// ========================================================
// MODUL 3: SISTEM PERPUSTAKAAN SIRKULASI CEPAT
// ========================================================
import {
    getLibraryOperatorDashboard,
    quickCirculationScan,
    getStudentBookCatalog,
    reserveBookStudent
} from '../controllers/libraryEnhancedController';

router.get('/library/operator-dashboard', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), getLibraryOperatorDashboard);
router.post('/library/quick-circulation', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'LIBRARIAN']), quickCirculationScan);
router.get('/library/student-catalog', authenticateJWT, getStudentBookCatalog);
router.post('/library/reserve', authenticateJWT, reserveBookStudent);

// ========================================================
// MODUL 4 & 13-C: UPDATE SIDELOADING & RESUME DOWNLOAD
// ========================================================
import {
    checkAppUpdate,
    downloadApkWithResume,
    publishNewApkRelease
} from '../controllers/appUpdateSideloadController';

router.get('/app-update/check', checkAppUpdate);
router.get('/app-update/download-resume', downloadApkWithResume);
router.post('/app-update/publish-release', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), publishNewApkRelease);

// ========================================================
// MODUL 5: BROADCAST PENGUMUMAN BERTINGKAT
// ========================================================
import {
    previewBroadcastAudience,
    createBroadcastAnnouncement,
    getBroadcastAnnouncements,
    deleteBroadcastAnnouncement,
    recordAnnouncementResponse,
    getBroadcastReceiptStats
} from '../controllers/broadcastEnhancedController';

router.get('/broadcast/list', authenticateJWT, getBroadcastAnnouncements);
router.get('/broadcast/active', getBroadcastAnnouncements);
router.post('/broadcast/preview-audience', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), previewBroadcastAudience);
router.post('/broadcast/create', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), createBroadcastAnnouncement);
router.delete('/broadcast/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteBroadcastAnnouncement);
router.post('/broadcast/respond', authenticateJWT, recordAnnouncementResponse);
router.get('/broadcast/:id/stats', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getBroadcastReceiptStats);

// ========================================================
// MODUL 6 & 12: CHAT BK KE ORANG TUA & FITUR ORANG TUA
// ========================================================
import {
    getOrCreateChatThread,
    sendChatMessage,
    reassignCaseCounselor,
    getParentUnifiedDashboard,
    sendDirectTeacherParentMessage,
    getChatThreads,
    getThreadMessages
} from '../controllers/bkParentChatController';

router.post('/chat-bk/thread', authenticateJWT, getOrCreateChatThread);
router.post('/chat-bk/send', authenticateJWT, sendChatMessage);
router.post('/chat-bk/reassign', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), reassignCaseCounselor);
router.get('/chat/threads', authenticateJWT, getChatThreads);
router.get('/chat/messages/:threadId', authenticateJWT, getThreadMessages);
router.get('/parent/unified-dashboard/:siswaId', authenticateJWT, getParentUnifiedDashboard);
router.post('/parent/message-teacher', authenticateJWT, requireRole(['ADMIN', 'TEACHER', 'PARENT']), sendDirectTeacherParentMessage);

// ========================================================
// MODUL 8: OPERATOR COMMAND CENTER & AUDIT LOGS
// ========================================================
import {
    getOperatorCommandCenter,
    getOperatorAuditLogs,
    getOperatorPermissions,
    updateOperatorPermission
} from '../controllers/operatorCentralController';

router.get('/operator/command-center', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getOperatorCommandCenter);
router.get('/operator/audit-logs', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getOperatorAuditLogs);
router.get('/operator/permissions/:operatorId', authenticateJWT, requireRole(['ADMIN']), getOperatorPermissions);
router.post('/operator/permissions', authenticateJWT, requireRole(['ADMIN']), updateOperatorPermission);

// ========================================================
// MODUL 11: SERVER MONITORING JARAK JAUH
// ========================================================
import {
    getServerRealtimeMetrics,
    executeServerControlAction,
    getDatabaseBackupList
} from '../controllers/serverMonitoringController';

router.get('/server-monitoring/metrics', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getServerRealtimeMetrics);
router.post('/server-monitoring/control', authenticateJWT, requireRole(['ADMIN']), executeServerControlAction);
// ========================================================
// BANK SOAL BERSAMA & QUALITY GATE VERIFIKASI (KOLABORASI ANTAR GURU)
// ========================================================
import {
    getGrupMapelList,
    createGrupMapel,
    updateGrupMembers,
    getAdvancedBankSoal,
    updateSoalVisibility,
    likeSoal,
    transferSoalOwnership,
    submitSoalForVerification,
    reviewSoalVerification,
    getVerificationQueue,
    getVerificationStats,
    proposeSoalRevision,
    respondToRevisionProposal,
    getSoalRevisionHistory
} from '../controllers/bankSoalCollaborationController';

router.get('/grup-mapel', authenticateJWT, getGrupMapelList);
router.post('/grup-mapel', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), createGrupMapel);
router.put('/grup-mapel/:groupId/members', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateGrupMembers);

router.get('/soal/bank-advanced', authenticateJWT, getAdvancedBankSoal);
router.put('/soal/bank/:id/visibility', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), updateSoalVisibility);
router.post('/soal/bank/:id/like', authenticateJWT, likeSoal);
router.post('/soal/bank/:id/transfer', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), transferSoalOwnership);

router.post('/soal/bank/:id/verify-submit', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), submitSoalForVerification);
router.post('/soal/bank/:id/verify-review', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), reviewSoalVerification);
router.get('/soal/verification-queue', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getVerificationQueue);
router.get('/soal/verification-stats', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getVerificationStats);

router.post('/soal/bank/:id/propose-revision', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), proposeSoalRevision);
router.post('/soal/revisi/:proposalId/respond', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), respondToRevisionProposal);
router.get('/soal/bank/:id/revisi-history', authenticateJWT, getSoalRevisionHistory);

// ==========================================
// MODUL 12: E-VOTING OSIS API ROUTES
// ==========================================
import {
    getMobileModules,
    getCandidates,
    getStudentVoteStatus,
    castVote,
    adminToggleVotingModule,
    adminUpdateVotingConfig,
    adminGetElectionResults,
    adminSaveCandidate,
    adminDeleteCandidate,
    adminResetElection,
    uploadCandidatePhoto,
    getClassTurnout
} from '../controllers/evotingController';

// Multer untuk Foto Paslon
const candidatePhotoDir = path.join(process.cwd(), 'uploads', 'candidates');
if (!fs.existsSync(candidatePhotoDir)) {
    fs.mkdirSync(candidatePhotoDir, { recursive: true });
}
const candidatePhotoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, candidatePhotoDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `paslon_${Date.now()}_${Math.round(Math.random() * 1E6)}${ext}`);
    }
});
const uploadCandidatePhotoMulter = multer({
    storage: candidatePhotoStorage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 1. Mobile Config & Public Candidates
router.get('/v1/mobile/modules', getMobileModules);
router.get('/evoting/modules', getMobileModules);
router.get('/evoting/candidates', getCandidates);

// 2. Student Voting & Status (Protected by JWT)
router.get('/evoting/status', authenticateJWT, getStudentVoteStatus);
router.post('/evoting/vote', authenticateJWT, castVote);
router.get('/evoting/class-turnout', authenticateJWT, getClassTurnout);

// 3. Admin & Operator Management Web Portal
router.get('/admin/evoting/results', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), adminGetElectionResults);
router.post('/admin/evoting/toggle', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), adminToggleVotingModule);
router.post('/admin/evoting/config', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), adminUpdateVotingConfig);
router.post('/admin/evoting/candidates', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), adminSaveCandidate);
router.delete('/admin/evoting/candidates/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), adminDeleteCandidate);
router.post('/admin/evoting/reset', authenticateJWT, requireRole(['ADMIN']), adminResetElection);
router.post('/admin/evoting/upload-photo', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), uploadCandidatePhotoMulter.single('photo'), uploadCandidatePhoto);

// ==========================================
// MODUL PERPUSTAKAAN, E-BOOK & SIRKULASI
// ==========================================
import {
    createEbook,
    updateEbook,
    deleteEbook,
    getStudentEbooks,
    getAllEbooks,
    getPopularEbooks
} from '../controllers/ebookController';

import {
    studentClaimPackageBook,
    getStudentPackageBooks,
    operatorBatchApprove,
    operatorContinuousReturn,
    lostAndFoundScan,
    getActiveLoansReminder
} from '../controllers/bookCirculationController';

// Multer untuk E-Book (Cover & PDF)
const ebookCoverDir = path.join(process.cwd(), 'uploads', 'ebooks', 'covers');
const ebookPdfDir = path.join(process.cwd(), 'uploads', 'ebooks', 'pdfs');
if (!fs.existsSync(ebookCoverDir)) fs.mkdirSync(ebookCoverDir, { recursive: true });
if (!fs.existsSync(ebookPdfDir)) fs.mkdirSync(ebookPdfDir, { recursive: true });

const ebookStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'cover') {
            cb(null, ebookCoverDir);
        } else {
            cb(null, ebookPdfDir);
        }
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '';
        const safeName = file.originalname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        cb(null, `ebook_${Date.now()}_${safeName}${ext}`);
    }
});
const uploadEbookFiles = multer({
    storage: ebookStorage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// A. Endpoint E-Book Digital
router.post('/v1/operator/ebooks', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), uploadEbookFiles.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), createEbook);
router.put('/v1/operator/ebooks/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), uploadEbookFiles.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), updateEbook);
router.patch('/v1/operator/ebooks/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), uploadEbookFiles.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), updateEbook);
router.delete('/v1/operator/ebooks/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteEbook);
router.get('/v1/operator/ebooks', authenticateJWT, getAllEbooks);
router.get('/v1/student/ebooks', authenticateJWT, getStudentEbooks);
router.get('/v1/ebooks/popular', getPopularEbooks);

// B. Endpoint Sirkulasi Buku Paket & Crowdsourcing
router.post('/v1/student/books/claim', authenticateJWT, studentClaimPackageBook);
router.get('/v1/student/books/my-packages', authenticateJWT, getStudentPackageBooks);
router.post('/v1/operator/books/batch-approve', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), operatorBatchApprove);
router.post('/v1/operator/books/continuous-return', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), operatorContinuousReturn);
router.get('/v1/books/lost-and-found/:barcode', authenticateJWT, lostAndFoundScan);
router.get('/v1/student/library/active-loans-reminder', authenticateJWT, getActiveLoansReminder);

// C. Endpoint Izin Pulang/Dispensasi BK & Digital Exit Pass (Two-Step Verification)
import {
    applyStudentLeave,
    getActiveStudentLeave,
    getCounselorLeaves,
    approveCounselorLeave,
    checkoutBkStation,
    getBkStationsList
} from '../controllers/bkLeaveExitPassController';

import {
    createGatepassRequest,
    generateBkDynamicQr,
    generateGatepassDynamicQr,
    updateGatepassStatusByBk,
    verifyGatepassByBkScan,
    checkoutGatepassBySatpam,
    verifyGatepassScan,
    getSatpamGatepassList,
    getActiveGatepass,
    getBkGatepassList,
    getStudentLeaveHistory
} from '../controllers/gatepassController';

// Digital School Gatepass & Emergency Leave System (5 Aktor: Siswa, BK, SIAKAD, Satpam, Ortu)
router.post(['/v1/gatepass/request', '/gatepass/request'], authenticateJWT, createGatepassRequest);
router.get(['/v1/gatepass/active', '/gatepass/active'], authenticateJWT, getActiveGatepass);
router.get(['/v1/gatepass/history', '/gatepass/history', '/student/leaves/history', '/v1/student/leaves/history'], authenticateJWT, getStudentLeaveHistory);
router.get(['/v1/gatepass/dynamic-qr/:id', '/gatepass/dynamic-qr/:id'], authenticateJWT, generateGatepassDynamicQr);
router.get(['/v1/bk/dynamic-qr', '/bk/dynamic-qr', '/gatepass/bk/dynamic-token', '/v1/gatepass/bk/dynamic-token'], authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), generateBkDynamicQr);
router.get(['/v1/bk/gatepasses', '/bk/gatepasses'], authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), getBkGatepassList);
router.patch(['/v1/bk/gatepass/:id/status', '/bk/gatepass/:id/status'], authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), updateGatepassStatusByBk);
router.post(['/v1/bk/gatepass/:id/status', '/bk/gatepass/:id/status'], authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), updateGatepassStatusByBk);
router.post(['/v1/gatepass/verify-by-scan', '/gatepass/verify-by-scan'], authenticateJWT, requireRole(['STUDENT', 'ADMIN', 'OPERATOR']), verifyGatepassByBkScan);
router.post(['/v1/gatepass/verify-scan', '/gatepass/verify-scan'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'SATPAM', 'SECURITY', 'COUNSELOR']), verifyGatepassScan);
router.post(['/v1/satpam/gatepass/checkout', '/satpam/gatepass/checkout', '/v1/satpam/gatepass/verify-scan', '/satpam/gatepass/verify-scan'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'SATPAM', 'SECURITY']), checkoutGatepassBySatpam);
router.get(['/v1/satpam/gatepass/list', '/satpam/gatepass/list'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'SATPAM', 'SECURITY']), getSatpamGatepassList);

// Legacy Leave Endpoints (Bridged & Synchronized)
router.post('/v1/student/leaves/apply', authenticateJWT, applyStudentLeave);
router.get('/v1/student/leaves/active', authenticateJWT, getActiveStudentLeave);
router.get('/v1/counselor/leaves', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR', 'TEACHER']), getCounselorLeaves);
router.patch('/v1/counselor/leaves/:id/approve', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR', 'OPERATOR']), approveCounselorLeave);
router.post('/v1/student/leaves/checkout-bk', authenticateJWT, checkoutBkStation);
router.get('/v1/counselor/stations', authenticateJWT, getBkStationsList);

// D. Modul Formulir Biodata Siswa Terpadu (Staging & Feature Toggle)
import {
    ensureBiodataSubmissionActive,
    toggleBiodataModule,
    submitStudentBiodata,
    getMyBiodataSubmission,
    getBiodataSubmissionsList,
    actionBiodataSubmission
} from '../controllers/biodataSubmissionController';

const biodataUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        let dest = path.join(__dirname, '../../uploads/biodata/kk');
        if (file.fieldname === 'akta') {
            dest = path.join(__dirname, '../../uploads/biodata/akta');
        } else if (file.fieldname === 'bantuan') {
            dest = path.join(__dirname, '../../uploads/biodata/bantuan');
        }
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
        cb(null, `${file.fieldname}_${Date.now()}_${cleanName}${ext}`);
    }
});

const uploadBiodataFiles = multer({
    storage: biodataUploadStorage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

router.patch('/v1/admin/modules/biodata/toggle', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KESISWAAN']), toggleBiodataModule);
router.post('/v1/mobile/biodata/submit', authenticateJWT, ensureBiodataSubmissionActive, uploadBiodataFiles.fields([{ name: 'kk', maxCount: 1 }, { name: 'akta', maxCount: 1 }, { name: 'bantuan', maxCount: 1 }, { name: 'foto', maxCount: 1 }, { name: 'dinsos', maxCount: 1 }]), submitStudentBiodata);
router.get('/v1/mobile/biodata/my-submission', authenticateJWT, getMyBiodataSubmission);
router.get('/v1/admin/biodata/submissions', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KESISWAAN']), getBiodataSubmissionsList);
router.post('/v1/admin/biodata/:id/action', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KESISWAAN']), actionBiodataSubmission);
router.post('/biodata/biometric/apply-pasfoto', authenticateJWT, applyOfficialPasfoto);

// ==========================================
// F. Modul Buku Induk / Raport & Dapodik (17 Item Read-Only & Spreadsheet Excel Operator)
// ==========================================
import {
    getBiodataRaport,
    getDapodikStudentsList,
    exportDapodikExcel,
    downloadDapodikTemplate,
    importDapodikExcel,
    updateDapodikStudent
} from '../controllers/dapodikRaportController';

const uploadDapodikExcel = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

router.get('/student/biodata-raport', authenticateJWT, getBiodataRaport);
router.get('/dapodik/students', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM', 'KESISWAAN']), getDapodikStudentsList);
router.get('/dapodik/export-excel', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER', 'KURIKULUM', 'KESISWAAN']), exportDapodikExcel);
router.get('/dapodik/template-excel', downloadDapodikTemplate);
router.post('/dapodik/import-excel', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KURIKULUM', 'KESISWAAN']), uploadDapodikExcel.single('file'), importDapodikExcel);
router.post('/dapodik/update-student', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KURIKULUM', 'KESISWAAN']), updateDapodikStudent);

// E. Modul Presensi Sesi Mengajar Berbasis Estafet Kelas Fisik (Room Handover NFC/QR) & Presensi Matpel
import {
    checkInTeachingSession,
    checkOutTeachingSession,
    getCurrentTeacherSession,
    updateStudentAttendanceByTeacher,
    getActiveSessionForStudent,
    studentSelfAttendSession,
    getPhysicalRoomsList
} from '../controllers/teacherRoomHandoverController';

router.post('/v1/teacher/session/checkin', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), checkInTeachingSession);
router.post('/v1/teacher/session/checkout', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), checkOutTeachingSession);
router.get('/v1/teacher/session/current', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getCurrentTeacherSession);
router.post('/v1/teacher/session/:sessionId/attendances/update', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), updateStudentAttendanceByTeacher);
router.get('/v1/teacher/rooms', getPhysicalRoomsList);
router.get('/v1/teacher/session/rooms', getPhysicalRoomsList);

// Presensi Mata Pelajaran di Sisi Siswa (Aktif setelah Guru Tap di Kelas)
router.get('/v1/student/active-teaching-session', authenticateJWT, getActiveSessionForStudent);
router.post('/v1/student/session/attend', authenticateJWT, studentSelfAttendSession);

// --- MODUL LOG ERROR & CRASH APK (PORTAL & CLIENT REPORTER) ---
import {
    recordClientLog,
    getClientLogs,
    resolveClientLog,
    deleteClientLog,
    cleanupClientLogs
} from '../controllers/appClientLogController';

router.post(['/app/client-logs', '/v1/app/client-logs'], recordClientLog);
router.get(['/app/client-logs', '/v1/app/client-logs'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getClientLogs);
router.put(['/app/client-logs/:id/resolve', '/v1/app/client-logs/:id/resolve'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), resolveClientLog);
router.delete(['/app/client-logs/:id', '/v1/app/client-logs/:id'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteClientLog);
router.post(['/app/client-logs/cleanup', '/v1/app/client-logs/cleanup'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), cleanupClientLogs);

// --- ALIAS JADWAL PIKET SISWA / PENGURUS KELAS ---
router.get(['/student/piket-schedule', '/v1/student/piket-schedule'], authenticateJWT, getWeeklyPiketSchedules);
router.get(['/student/piket-today', '/v1/student/piket-today'], getTodayOnDutyTeachers);

// --- MODUL WALI KELAS & REKAP PRESENSI LENGKAP (APK & PORTAL WEB) ---
import {
    getWaliKelasDashboard,
    getWaliKelasStudents,
    recordManualAttendanceByWali,
    getWaliKelasRekap,
    getStudentDetailRekap,
    saveWaliKelasStudentNote,
    getWaliKelasOfficers,
    updateWaliKelasOfficers,
    exportWaliKelasPdf,
    getWaliKelasLeaveRequests,
    verifyWaliKelasLeave,
    toggleNoPhoneStudent
} from '../controllers/waliKelasController';

router.get('/teacher/wali-kelas/dashboard', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasDashboard);
router.get('/guru/wali-kelas/dashboard', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasDashboard);

router.get('/teacher/wali-kelas/students', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasStudents);
router.get('/guru/wali-kelas/students', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasStudents);
router.post('/teacher/wali-kelas/toggle-no-phone', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), toggleNoPhoneStudent);

router.post('/teacher/wali-kelas/manual-attendance', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), recordManualAttendanceByWali);
router.post('/guru/wali-kelas/manual-attendance', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), recordManualAttendanceByWali);

router.get('/teacher/wali-kelas/rekap', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasRekap);
router.get('/guru/wali-kelas/rekap', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasRekap);

router.get('/teacher/wali-kelas/rekap-siswa/:studentId', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getStudentDetailRekap);
router.get('/teacher/wali-kelas/student-rekap/:studentId', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getStudentDetailRekap);
router.get('/guru/wali-kelas/rekap-siswa/:studentId', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getStudentDetailRekap);
router.post('/teacher/wali-kelas/student-note', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), saveWaliKelasStudentNote);
router.post('/guru/wali-kelas/student-note', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), saveWaliKelasStudentNote);

router.get('/teacher/wali-kelas/officers', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasOfficers);
router.put('/teacher/wali-kelas/officers', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), updateWaliKelasOfficers);
router.post('/teacher/wali-kelas/officers', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), updateWaliKelasOfficers);
router.get('/guru/wali-kelas/officers', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasOfficers);
router.put('/guru/wali-kelas/officers', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), updateWaliKelasOfficers);

router.get('/teacher/wali-kelas/rekap-pdf', exportWaliKelasPdf);
router.get('/teacher/wali-kelas/export-pdf', exportWaliKelasPdf);
router.get('/guru/wali-kelas/rekap-pdf', exportWaliKelasPdf);
router.get('/guru/wali-kelas/export-pdf', exportWaliKelasPdf);

router.get('/teacher/wali-kelas/leave-requests', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), getWaliKelasLeaveRequests);
router.put('/teacher/wali-kelas/verify-leave/:id', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR', 'COUNSELOR']), verifyWaliKelasLeave);

// --- ENDPOINT REKAP PRESENSI KELAS BINAAN & PER ANAK UNTUK GURU BK ---
router.get('/bk/rekap-presensi/kelas', authenticateJWT, requireRole(['COUNSELOR', 'ADMIN', 'OPERATOR']), getWaliKelasRekap);
router.get('/bk/rekap-presensi/siswa/:studentId', authenticateJWT, requireRole(['COUNSELOR', 'ADMIN', 'OPERATOR']), getStudentDetailRekap);
router.get('/bk/rekap-presensi/pdf', exportWaliKelasPdf);
router.get('/bk/rekap-presensi/export-pdf', exportWaliKelasPdf);
router.get('/bk/rekap-presensi/rekap-pdf', exportWaliKelasPdf);

// ==========================================
// PILAR 1: CBT DISTRIBUTION, ROOMS, INCIDENTS & APPROVAL WORKFLOW
// ==========================================
import {
    getExamRooms,
    createExamRoom,
    deleteExamRoom,
    distributeExamParticipants,
    getExamParticipants,
    resetExamDistribution,
    logExamIncident,
    getExamIncidentLogs,
    submitExamForApproval,
    reviewExamApproval
} from '../controllers/cbtDistributionController';

router.get('/cbt/exams/:examId/rooms', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getExamRooms);
router.post('/cbt/exams/:examId/rooms', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), createExamRoom);
router.delete('/cbt/rooms/:roomId', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteExamRoom);
router.post('/cbt/exams/:examId/distribute', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), distributeExamParticipants);
router.get('/cbt/exams/:examId/participants', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getExamParticipants);
router.post('/cbt/exams/:examId/reset-distribution', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), resetExamDistribution);
router.post('/cbt/exams/:examId/incidents', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), logExamIncident);
router.get('/cbt/exams/:examId/incidents', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getExamIncidentLogs);
router.post('/cbt/exams/:examId/submit-approval', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), submitExamForApproval);
router.post('/cbt/exams/:examId/review-approval', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), reviewExamApproval);

// ==========================================
// PILAR 2: TUGAS/PR LOAD BALANCING & RECURRING
// ==========================================
import {
    checkHomeworkLoadBalance,
    getHomeworkHeatmap,
    createRecurringHomeworkPlan,
    getRecurringHomeworkPlans,
    getHomeworkComprehensiveAnalytics
} from '../controllers/homeworkAdvancedController';

router.get('/homework/load-balance', authenticateJWT, checkHomeworkLoadBalance);
router.get('/homework/heatmap', authenticateJWT, getHomeworkHeatmap);
router.post('/homework/recurring-plans', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), createRecurringHomeworkPlan);
router.get('/homework/recurring-plans', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), getRecurringHomeworkPlans);
router.get(['/homeworks/:homeworkId/analytics', '/homework/analytics/:homeworkId'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'KURIKULUM', 'TEACHER']), getHomeworkComprehensiveAnalytics);

// ==========================================
// PILAR 3: MODUL BK ADVANCED, PLOT KELAS, SAW & 360 REKAP
// ==========================================
import {
    getBkPlots,
    assignBkPlot,
    deleteBkPlot,
    getSawRankingList,
    triggerSawRecalculation,
    createKonselingKelompok,
    getKonselingKelompokList,
    createHomeVisit,
    getHomeVisitList,
    createKonferensiKasus,
    createReferral,
    getStudent360Detail,
    acknowledgeWarningLetter
} from '../controllers/bkAdvancedController';

router.get('/bk/plots', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), getBkPlots);
router.post('/bk/plots', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), assignBkPlot);
router.delete('/bk/plots/:id', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), deleteBkPlot);
router.get(['/bk/saw-rankings', '/bk-advanced/saw-ranking', '/bk/saw-ranking'], authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), getSawRankingList);
router.post('/bk/saw-recalculate', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), triggerSawRecalculation);
router.post('/bk/group-counseling', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), createKonselingKelompok);
router.get('/bk/group-counseling', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), getKonselingKelompokList);
router.post('/bk/home-visits', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), checkBKKelasAccess, createHomeVisit);
router.get('/bk/home-visits', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), getHomeVisitList);
router.post('/bk/case-conferences', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), checkBKKelasAccess, createKonferensiKasus);
router.post('/bk/referrals', authenticateJWT, requireRole(['ADMIN', 'COUNSELOR']), checkBKKelasAccess, createReferral);
router.get('/bk/students/:studentId/360', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), checkBKKelasAccess, getStudent360Detail);
router.post('/bk/sp/acknowledge', authenticateJWT, requireRole(['PARENT', 'ADMIN']), acknowledgeWarningLetter);

// ==========================================
// PILAR 4: ULANGAN HARIAN (3 MODE) & UNIFIED INBOX SISWA
// ==========================================
import {
  mulaiUlanganHarian,
  getDaftarUhGuru,
  getMonitoringUhGuru,
  rotateTokenUh,
  akhiriUlanganHarian,
  getRekapHasilUh,
  getSiswaUnifiedInbox,
  mulaiKerjakanUhSiswa,
  autoSaveJawabanUhSiswa,
  logInsidenAntiCheatUh,
  submitFinalUhSiswa,
  getHasilUhSiswa,
  importSoalExcelUh,
  getAiAnalysisUh,
  extendWaktuUh,
  gradeManualUraianUh,
  getRemedialSummaryUh,
  exportUhExcel
} from '../controllers/ulanganHarianController';

// Guru: Setup, Monitoring, Rotate Token, Selesai, Rekap, Excel Import, AI Analysis, Extend Time, Manual Grading, Remedial, Export
router.get('/guru/uh/list', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getDaftarUhGuru);
router.post('/guru/uh/mulai', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), mulaiUlanganHarian);
router.post('/guru/uh/import-excel', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), importSoalExcelUh);
router.get('/guru/uh/:id/status', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getMonitoringUhGuru);
router.post('/guru/uh/:id/rotate-token', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), rotateTokenUh);
router.post('/guru/uh/:id/selesai', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), akhiriUlanganHarian);
router.get('/guru/uh/:id/hasil', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getRekapHasilUh);
router.get('/guru/uh/:id/ai-analysis', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getAiAnalysisUh);
router.post('/guru/uh/:id/extend-time', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), extendWaktuUh);
router.post('/guru/uh/:id/grade-manual', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), gradeManualUraianUh);
router.get('/guru/uh/:id/remedial-summary', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), getRemedialSummaryUh);
router.get('/guru/uh/:id/export-excel', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), exportUhExcel);

// Siswa: Unified Inbox (Tugas & UH), Mulai Kerjakan, Auto-Save, Anti-Cheat Log, Submit Final, Hasil Review
router.get(['/siswa/tugas-uh/inbox', '/student/tugas-uh/inbox'], authenticateJWT, getSiswaUnifiedInbox);
router.post(['/siswa/uh/:id/mulai', '/student/uh/:id/mulai'], authenticateJWT, mulaiKerjakanUhSiswa);
router.post(['/siswa/uh/:id/jawab', '/student/uh/:id/jawab'], authenticateJWT, autoSaveJawabanUhSiswa);
router.post(['/siswa/uh/:id/insiden', '/student/uh/:id/insiden'], authenticateJWT, logInsidenAntiCheatUh);
router.post(['/siswa/uh/:id/submit', '/student/uh/:id/submit'], authenticateJWT, submitFinalUhSiswa);
router.get(['/siswa/uh/:id/hasil', '/student/uh/:id/hasil'], authenticateJWT, getHasilUhSiswa);

// ==================== MODUL TAHFIZ & MUROJAAH JUZ 30 ====================
import {
  getTahfizSurahList,
  getTahfizDashboardSummary,
  saveTahfizTarget,
  submitTahfizSetoran,
  saveTahfizPenilaian,
  getMurojaahList,
  evaluateMurojaah,
  getClassTahfizProgressMap,
  getStudentTahfizDetail,
  exportTahfizExcel
} from '../controllers/tahfizController';

router.get('/tahfiz/surahs', authenticateJWT, getTahfizSurahList);
router.get('/tahfiz/dashboard', authenticateJWT, getTahfizDashboardSummary);
router.post('/tahfiz/targets', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), saveTahfizTarget);
router.post('/tahfiz/setoran', authenticateJWT, submitTahfizSetoran);
router.post('/tahfiz/penilaian', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), saveTahfizPenilaian);
router.get('/tahfiz/murojaah', authenticateJWT, getMurojaahList);
router.post('/tahfiz/murojaah/evaluate', authenticateJWT, requireRole(['TEACHER', 'ADMIN', 'OPERATOR']), evaluateMurojaah);
router.get('/tahfiz/class-progress', authenticateJWT, getClassTahfizProgressMap);
router.get('/tahfiz/progress-map', authenticateJWT, getClassTahfizProgressMap);
router.get('/tahfiz/student/:studentId', authenticateJWT, getStudentTahfizDetail);
router.get('/tahfiz/export-excel', authenticateJWT, exportTahfizExcel);
router.get('/tahfiz/export/excel', authenticateJWT, exportTahfizExcel);

// --- Activity Logs & Anomali Terpusat Routes ---
import {
  getActivityLogs,
  getActivityLogsSummary,
  getActivityAnomalies,
  resolveActivityAnomaly,
  getStudentActivityTimeline,
  receiveApkActivityLogs
} from '../controllers/activityLogController';

router.get('/activity-logs', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), getActivityLogs);
router.get('/activity-logs/summary', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), getActivityLogsSummary);
router.get('/activity-anomalies', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR']), getActivityAnomalies);
router.put('/activity-anomalies/:id/resolve', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), resolveActivityAnomaly);
router.get('/activity-logs/timeline/:studentId', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'COUNSELOR', 'TEACHER']), getStudentActivityTimeline);
router.post(['/app/activity-logs', '/activity-logs/app'], receiveApkActivityLogs);

// --- WhatsApp Blast Orang Tua (Keterlambatan & Alpa Tanpa Checklock) ---
import {
  triggerLateBlast,
  triggerAbsentBlast,
  getWhatsAppStatus,
  getWhatsAppConfigEndpoint,
  testSendWhatsApp,
  updateWhatsAppConfig,
  disconnectWhatsAppEndpoint,
  restartWhatsAppSessionEndpoint,
  getParentContactsStats,
  exportParentContactsVcf,
  exportParentContactsCsv
} from '../controllers/whatsappBlastController';

router.post('/whatsapp/blast/late', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), triggerLateBlast);
router.post('/whatsapp/blast/absent', authenticateJWT, requireRole(['ADMIN', 'OPERATOR', 'TEACHER']), triggerAbsentBlast);
router.get('/whatsapp/status', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getWhatsAppStatus);
router.get('/whatsapp/config', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getWhatsAppConfigEndpoint);
router.post('/whatsapp/test-send', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), testSendWhatsApp);
router.post('/whatsapp/blast/config', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateWhatsAppConfig);
router.post('/whatsapp/config', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), updateWhatsAppConfig);
router.post('/whatsapp/disconnect', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), disconnectWhatsAppEndpoint);
router.post('/whatsapp/restart-session', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), restartWhatsAppSessionEndpoint);

// Sinkronisasi Google Contacts Orang Tua Siswa (Anti-Banned WhatsApp)
router.get('/whatsapp/contacts-stats', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), getParentContactsStats);
router.get('/whatsapp/export-contacts-vcf', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), exportParentContactsVcf);
router.get('/whatsapp/export-contacts-csv', authenticateJWT, requireRole(['ADMIN', 'OPERATOR']), exportParentContactsCsv);

export default router;



