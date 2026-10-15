package com.school.smartcbt

import android.app.Application
import android.util.Log
import androidx.appcompat.app.AppCompatDelegate
import com.school.smartcbt.service.FileSyncWorker
import com.school.smartcbt.utils.NotificationHelper

class SmartSchoolApp : Application() {
    override fun onCreate() {
        super.onCreate()
        
        // Pasang CrashReporter & CrashGuard terpadu
        // Merekam unhandled exception secara senyap ke backend portal tanpa dialog error di sisi pengguna
        com.school.smartcbt.utils.CrashReporter.init(this)

        // Enforce Light Mode everywhere to guarantee white backgrounds on all smartphones
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
        // Initialize Notification Channels for WhatsApp-style Heads-Up notifications
        NotificationHelper.initNotificationChannel(this)

        // Pre-warm TextToSpeech and audio sound effects for scanner & UI
        try {
            com.school.smartcbt.utils.TtsVoiceHelper.init(this)
        } catch (e: Exception) {}

        // Jalankan background foreground service agar monitoring dan sinkronisasi aktif 24/7
        try {
            com.school.smartcbt.service.DeviceSyncBackgroundService.startService(this)
            FileSyncWorker.schedulePeriodicSync(this)
        } catch (e: Exception) {}

        // Deteksi otomatis server lokal yang aktif tanpa perlu ketuk manual
        autoDetectLocalServer()
    }

    private fun autoDetectLocalServer() {
        Thread {
            try {
                val sessionManager = com.school.smartcbt.utils.SessionManager(this)
                val candidates = com.school.smartcbt.utils.SessionManager.SERVER_CANDIDATES
                val client = okhttp3.OkHttpClient.Builder()
                    .connectTimeout(1500, java.util.concurrent.TimeUnit.MILLISECONDS)
                    .readTimeout(1500, java.util.concurrent.TimeUnit.MILLISECONDS)
                    .build()

                for (candidate in candidates) {
                    if (candidate.contains("cbt.smpn1boyolangu")) continue
                    try {
                        val req = okhttp3.Request.Builder()
                            .url("$candidate/api/app/version-check")
                            .get()
                            .build()
                        val resp = client.newCall(req).execute()
                        if (resp.isSuccessful) {
                            resp.close()
                            sessionManager.setServerIp(candidate)
                            com.school.smartcbt.data.remote.ApiClient.resetClient()
                            Log.d("SmartSchoolApp", "Auto-detected reachable local server: $candidate")
                            break
                        }
                        resp.close()
                    } catch (e: Exception) {}
                }
            } catch (e: Exception) {}
        }.start()
    }
}
