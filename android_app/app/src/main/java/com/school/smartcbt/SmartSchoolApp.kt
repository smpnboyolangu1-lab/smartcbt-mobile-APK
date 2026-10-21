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

        // Pastikan hanya terhubung ke server resmi CBT (hapus residu IP lokal LAN)
        try {
            val sessionManager = com.school.smartcbt.utils.SessionManager(this)
            val currentIp = sessionManager.getServerIp()
            if (currentIp.contains("192.168") || currentIp.contains("localhost") || currentIp.contains("127.0.0.1") ||
                currentIp.contains("10.") || currentIp.contains("172.")) {
                sessionManager.setServerIp(com.school.smartcbt.utils.SessionManager.ONLINE_SERVER_URL)
                com.school.smartcbt.data.remote.ApiClient.resetClient()
            }
        } catch (e: Exception) {}
    }
}
