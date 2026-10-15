package com.school.smartcbt.utils

import android.content.Context
import android.location.Location
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import java.io.File

/**
 * GpsUtils & Anti-Cheat Security Layer (Modul 0-G)
 * - Deteksi Mock Location / Fake GPS
 * - Deteksi Developer Mode & USB Debugging
 * - Deteksi Root / Jailbreak
 * - Validasi SSID WiFi Sekolah
 * - Haversine Distance Calculator
 */
object GpsUtils {

    /**
     * Mendeteksi apakah koordinat GPS berasal dari aplikasi Fake GPS (Mock Provider).
     */
    fun isFakeGps(context: Context, location: Location): Boolean {
        var isMock = false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            isMock = location.isMock
        } else {
            @Suppress("DEPRECATION")
            isMock = location.isFromMockProvider
        }

        val isMockSettingsEnabled = try {
            @Suppress("DEPRECATION")
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ALLOW_MOCK_LOCATION) == "1"
        } catch (e: Exception) {
            false
        }

        return isMock || isMockSettingsEnabled
    }

    /**
     * Deteksi Developer Options / USB Debugging aktif saat aksi tab
     */
    fun isDeveloperModeActive(context: Context): Boolean {
        return try {
            val devEnabled = Settings.Global.getInt(
                context.contentResolver,
                Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0
            ) != 0

            val adbEnabled = Settings.Global.getInt(
                context.contentResolver,
                Settings.Global.ADB_ENABLED, 0
            ) != 0

            devEnabled || adbEnabled
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Deteksi Root pada perangkat Android (cek build tags & binary su)
     */
    fun isDeviceRooted(): Boolean {
        val buildTags = Build.TAGS
        if (buildTags != null && buildTags.contains("test-keys")) {
            return true
        }

        val knownSuPaths = arrayOf(
            "/system/app/Superuser.apk",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/system/sd/xbin/su",
            "/system/bin/failsafe/su",
            "/data/local/su"
        )

        for (path in knownSuPaths) {
            if (File(path).exists()) {
                return true
            }
        }

        return false
    }

    /**
     * Mengambil nama WiFi SSID yang sedang terhubung saat ini
     */
    fun getConnectedWifiSsid(context: Context): String? {
        return try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val info = wifiManager?.connectionInfo
            val ssid = info?.ssid?.replace("\"", "")
            if (ssid == "<unknown ssid>" || ssid.isNullOrBlank()) null else ssid
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Hitung jarak radius meter menggunakan Haversine Formula
     */
    fun calculateDistanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0 // Earth radius in meters
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2)
        val c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return r * c
    }

    /**
     * Memeriksa apakah GPS hardware aktif dalam mode Akurasi Tinggi (bukan Battery Saving / Off)
     */
    fun isHighAccuracyGpsEnabled(context: Context): Boolean {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? android.location.LocationManager ?: return false
        val isGpsProviderEnabled = locationManager.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
        if (!isGpsProviderEnabled) return false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (!locationManager.isLocationEnabled) return false
        } else {
            @Suppress("DEPRECATION")
            val mode = try {
                Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE)
            } catch (e: Exception) {
                Settings.Secure.LOCATION_MODE_HIGH_ACCURACY
            }
            if (mode == Settings.Secure.LOCATION_MODE_OFF || mode == Settings.Secure.LOCATION_MODE_BATTERY_SAVING) {
                return false
            }
        }
        return true
    }

    /**
     * Menampilkan dialog penolakan pembukaan kamera jika GPS mati atau mode hemat baterai
     */
    fun showGpsRequirementDialog(activity: android.app.Activity, onCancel: (() -> Unit)? = null) {
        val builder = androidx.appcompat.app.AlertDialog.Builder(activity)
        builder.setTitle("⚠️ GPS Mode Akurasi Tinggi Diperlukan")
        builder.setMessage("Presensi sekolah memerlukan deteksi posisi riil satelit.\n\nStatus saat ini: GPS Anda nonaktif atau berada dalam mode Hemat Baterai (Akurasi Rendah).\n\nSilakan aktifkan GPS Mode Akurasi Tinggi untuk Presensi agar kamera pemindai dapat dibuka.")
        builder.setPositiveButton("Aktifkan GPS") { _, _ ->
            try {
                val intent = android.content.Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
                activity.startActivity(intent)
            } catch (e: Exception) {
                // fallback
            }
            onCancel?.invoke()
        }
        builder.setNegativeButton("Batal") { dialog, _ ->
            dialog.dismiss()
            onCancel?.invoke()
        }
        builder.setCancelable(false)
        builder.show()
    }

    const val REQUEST_CHECK_SETTINGS_GPS = 9922

    /**
     * Meminta aktivasi GPS via Google Play Services One-Tap System Dialog (SIBOY FRESH).
     * Jika GPS mati, Android memunculkan pop-up resmi sistem: [OK] / [Batal].
     * Siswa cukup menekan [OK] dan GPS langsung menyala tanpa membuka Settings/bilah notifikasi.
     */
    fun checkAndRequestOneTapGps(
        activity: android.app.Activity,
        requestCode: Int = REQUEST_CHECK_SETTINGS_GPS,
        onGpsAlreadyEnabled: () -> Unit,
        onResolutionPrompted: () -> Unit = {},
        onErrorFallback: () -> Unit
    ) {
        try {
            val locationRequest = com.google.android.gms.location.LocationRequest.Builder(
                com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY, 1000
            ).setMinUpdateIntervalMillis(500).build()

            val builder = com.google.android.gms.location.LocationSettingsRequest.Builder()
                .addLocationRequest(locationRequest)
                .setAlwaysShow(true)

            val client = com.google.android.gms.location.LocationServices.getSettingsClient(activity)
            val task = client.checkLocationSettings(builder.build())

            task.addOnSuccessListener {
                onGpsAlreadyEnabled()
            }

            task.addOnFailureListener { exception ->
                if (exception is com.google.android.gms.common.api.ResolvableApiException) {
                    try {
                        onResolutionPrompted()
                        exception.startResolutionForResult(activity, requestCode)
                    } catch (sendEx: android.content.IntentSender.SendIntentException) {
                        onErrorFallback()
                    }
                } else {
                    onErrorFallback()
                }
            }
        } catch (e: Exception) {
            onErrorFallback()
        }
    }
}

