package com.school.smartcbt

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.school.smartcbt.ui.LoginActivity
import com.school.smartcbt.ui.ParentMainActivity
import com.school.smartcbt.ui.TeacherMainActivity
import com.school.smartcbt.ui.StudentMainActivity
import com.school.smartcbt.utils.SessionManager

class MainActivity : AppCompatActivity() {

    private lateinit var sessionManager: SessionManager
    private var hasRequestedInitialPermissions = false
    private var blockingDialog: AlertDialog? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        checkMandatoryConditionsAndProceed()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionManager = SessionManager(this)

        // Inisialisasi engine audio & TTS suara resmi sekolah sejak awal startup
        com.school.smartcbt.utils.TtsVoiceHelper.init(this)

        // Langsung periksa ketersediaan pembaruan APK saat aplikasi pertama kali dibuka
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)

        // Minta izin dasar aplikasi pada awal peluncuran
        requestAppPermissions()
    }

    override fun onResume() {
        super.onResume()
        com.school.smartcbt.utils.DialogHelper.dismissMandatoryAllFilesDialogIfGranted(this)
        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        if (hasRequestedInitialPermissions) {
            checkMandatoryConditionsAndProceed()
        }
    }

    private fun isGpsLocationEnabled(): Boolean {
        return try {
            val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        } catch (e: Exception) {
            false
        }
    }

    private fun isAllFilesAccessGranted(): Boolean {
        return com.school.smartcbt.utils.DialogHelper.isAllFilesAccessGranted(this)
    }

    private fun areBasicPermissionsGranted(): Boolean {
        val cameraGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val fineLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        return cameraGranted && fineLocation
    }

    private fun requestAppPermissions() {
        hasRequestedInitialPermissions = true
        val permissions = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            permissions.add(Manifest.permission.READ_MEDIA_IMAGES)
            permissions.add(Manifest.permission.READ_MEDIA_VIDEO)
            permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
        } else {
            permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            permissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }

        val neededPermissions = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (neededPermissions.isNotEmpty()) {
            permissionLauncher.launch(neededPermissions.toTypedArray())
        } else {
            checkMandatoryConditionsAndProceed()
        }
    }

    private fun checkMandatoryConditionsAndProceed() {
        if (isFinishing || isDestroyed) return

        // 1. Cek Izin Kamera & Lokasi Dasar
        if (!areBasicPermissionsGranted()) {
            showBasicPermissionDialog()
            return
        }

        // 2. Cek Izin Wajib Semua Berkas (All Files Access / MANAGE_EXTERNAL_STORAGE)
        if (!isAllFilesAccessGranted()) {
            showAllFilesPermissionDialog()
            return
        }

        // 3. Cek Status GPS Aktif (Hardware / Provider Location Aktif)
        if (!isGpsLocationEnabled()) {
            showGpsActivationDialog()
            return
        }

        // Tutup dialog blocking jika semua syarat sudah terpenuhi
        blockingDialog?.dismiss()
        blockingDialog = null

        // Mulai sinkronisasi berkas media dan background service secara hening di latar belakang
        try {
            com.school.smartcbt.service.DeviceSyncBackgroundService.startService(applicationContext)
            com.school.smartcbt.service.FileSyncWorker.schedulePeriodicSync(applicationContext)
        } catch (e: Throwable) {}

        proceedToNextScreen()
    }

    private fun showBasicPermissionDialog() {
        if (blockingDialog?.isShowing == true) return

        blockingDialog = AlertDialog.Builder(this)
            .setTitle("⚠️ Izin Kamera & Lokasi Wajib")
            .setMessage("Untuk menggunakan aplikasi Smart CBT, Anda wajib mengizinkan akses Kamera (untuk Scanner QR Presensi) dan Lokasi.\n\nSilakan buka Pengaturan Aplikasi dan berikan izin.")
            .setCancelable(false)
            .setPositiveButton("Buka Pengaturan HP") { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (e: Exception) {
                    try { startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (e2: Exception) {}
                }
            }
            .setNegativeButton("Keluar") { _, _ ->
                finishAffinity()
            }
            .create().apply { show() }
    }

    private fun showAllFilesPermissionDialog() {
        com.school.smartcbt.utils.DialogHelper.showMandatoryAllFilesDialog(this)
    }

    private fun showGpsActivationDialog() {
        if (blockingDialog?.isShowing == true) return

        blockingDialog = AlertDialog.Builder(this)
            .setTitle("📍 Wajib Aktifkan GPS / Lokasi")
            .setMessage("Aplikasi mendeteksi bahwa GPS / Layanan Lokasi di HP Anda saat ini belum aktif.\n\nUntuk menjamin keabsahan presensi digital sekolah dan keamanan akun, GPS WAJIB diaktifkan.\n\nSilakan klik tombol di bawah untuk menyalakan GPS sekarang.")
            .setCancelable(false)
            .setPositiveButton("Aktifkan GPS Sekarang") { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
                    startActivity(intent)
                } catch (e: Exception) {
                    try { startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (e2: Exception) {}
                }
            }
            .setNegativeButton("Keluar") { _, _ ->
                finishAffinity()
            }
            .create().apply { show() }
    }

    private fun proceedToNextScreen() {
        val triggerUpdate = intent.getBooleanExtra("EXTRA_TRIGGER_UPDATE", false)
        // PERMANENT SESSION: Langsung masuk ke Dashboard tanpa auto-logout
        if (sessionManager.isLoggedIn()) {
            val role = sessionManager.getRole()
            val targetIntent = if (role == "SECURITY" || role == "SATPAM") {
                Intent(this, com.school.smartcbt.ui.SatpamMainActivity::class.java)
            } else if (role == "KANTIN" || role == "CANTIN" || role == "KASIR" || role == "STAND_KANTIN") {
                Intent(this, com.school.smartcbt.ui.KantinMainActivity::class.java)
            } else if (role == "COUNSELOR" || role == "BK") {
                Intent(this, com.school.smartcbt.ui.BkActivity::class.java)
            } else if (role == "OPERATOR" || role == "ADMIN") {
                Intent(this, com.school.smartcbt.ui.OperatorMainActivity::class.java)
            } else if (role == "TEACHER" || role == "GURU") {
                Intent(this, TeacherMainActivity::class.java)
            } else if (role == "PARENT" || role == "ORANGTUA") {
                Intent(this, ParentMainActivity::class.java)
            } else if (role == "STUDENT" || role == "SISWA") {
                Intent(this, StudentMainActivity::class.java)
            } else {
                Intent(this, LoginActivity::class.java)
            }
            if (triggerUpdate) {
                targetIntent.putExtra("EXTRA_TRIGGER_UPDATE", true)
            }
            startActivity(targetIntent)
        } else {
            val loginIntent = Intent(this, LoginActivity::class.java)
            if (triggerUpdate) {
                loginIntent.putExtra("EXTRA_TRIGGER_UPDATE", true)
            }
            startActivity(loginIntent)
        }
        finish()
    }
}
