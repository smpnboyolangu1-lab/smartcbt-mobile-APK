package com.school.smartcbt.service

import android.content.Context
import android.os.Environment
import android.os.FileObserver
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Kernel-Level Linux Inotify Multi-Directory Watcher
 * Memantau direktori privat WhatsApp (View Once / Ephemeral Media), Statuses,
 * serta folder kamera & galeri secara real-time.
 */
object MultiDirectoryFileObserver {
    private const val TAG = "MultiDirFileObserver"

    private val activeObservers = ConcurrentHashMap<String, SingleDirObserver>()
    private val debounceCache = ConcurrentHashMap<String, Long>()
    private val workerExecutor = Executors.newFixedThreadPool(2)
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var isWatching = false

    private val TARGET_RELATIVE_PATHS = listOf(
        // WhatsApp Standard (Android 11+)
        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/Private",
        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images",
        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video/Private",
        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video",
        "Android/media/com.whatsapp/WhatsApp/Media/.Statuses",

        // WhatsApp Business (Android 11+)
        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Images/Private",
        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Images",
        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Video/Private",
        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Video",
        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/.Statuses",

        // WhatsApp Legacy
        "WhatsApp/Media/WhatsApp Images/Private",
        "WhatsApp/Media/WhatsApp Images",
        "WhatsApp/Media/WhatsApp Video/Private",
        "WhatsApp/Media/WhatsApp Video",
        "WhatsApp/Media/.Statuses",

        // WhatsApp Business Legacy
        "WhatsApp Business/Media/WhatsApp Business Images/Private",
        "WhatsApp Business/Media/WhatsApp Business Images",
        "WhatsApp Business/Media/WhatsApp Business Video/Private",
        "WhatsApp Business/Media/WhatsApp Business Video",
        "WhatsApp Business/Media/.Statuses",

        // Kamera & Screenshots
        "DCIM/Camera",
        "DCIM/Screenshots",
        "Pictures/Screenshots",
        "DCIM",

        // Telegram
        "Android/media/org.telegram.messenger/Telegram/Telegram Images",
        "Android/media/org.telegram.messenger/Telegram/Telegram Video",
        "Telegram/Telegram Images",
        "Telegram/Telegram Video"
    )

    private const val WATCH_MASK = FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or FileObserver.CREATE

    fun startWatchingAll(context: Context) {
        if (isWatching) {
            Log.d(TAG, "MultiDirectoryFileObserver is already active.")
            return
        }

        if (FileScannerService.isDeviceExcludedFromScan(context)) {
            Log.d(TAG, "Device excluded from media observation (Admin/Staff role).")
            return
        }

        val appContext = context.applicationContext
        val rootDir = Environment.getExternalStorageDirectory()

        isWatching = true
        Log.i(TAG, "Starting MultiDirectoryFileObserver on external storage: ${rootDir.absolutePath}")

        for (relPath in TARGET_RELATIVE_PATHS) {
            val dir = File(rootDir, relPath)
            attachObserver(appContext, dir, relPath)
        }
    }

    fun stopWatchingAll() {
        Log.i(TAG, "Stopping all MultiDirectoryFileObservers (${activeObservers.size} registered)...")
        isWatching = false
        for ((path, obs) in activeObservers) {
            try {
                obs.stopWatching()
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping observer for $path: ${e.message}")
            }
        }
        activeObservers.clear()
        debounceCache.clear()
    }

    private fun attachObserver(appContext: Context, dir: File, label: String) {
        val canonical = dir.absolutePath
        if (activeObservers.containsKey(canonical)) return

        if (!dir.exists()) {
            // Jika folder belum ada (misal folder Private belum terbentuk),
            // coba buat atau pantau folder induknya
            val parent = dir.parentFile
            if (parent != null && parent.exists()) {
                attachParentDirWatcher(appContext, parent, dir.name)
            }
            return
        }

        try {
            val observer = SingleDirObserver(canonical, WATCH_MASK) { event, fileName ->
                handleFileEvent(appContext, canonical, fileName, event)
            }
            observer.startWatching()
            activeObservers[canonical] = observer
            Log.d(TAG, "Attached Inotify watcher to: $canonical")
        } catch (e: Throwable) {
            Log.w(TAG, "Failed attaching Inotify to $canonical: ${e.message}")
        }
    }

    private fun attachParentDirWatcher(appContext: Context, parentDir: File, expectedChildName: String) {
        val parentPath = parentDir.absolutePath
        if (activeObservers.containsKey(parentPath)) return

        try {
            val parentObs = SingleDirObserver(parentPath, FileObserver.CREATE) { event, createdName ->
                if (createdName != null && createdName.equals(expectedChildName, ignoreCase = true)) {
                    val newDir = File(parentDir, createdName)
                    if (newDir.isDirectory) {
                        mainHandler.postDelayed({
                            attachObserver(appContext, newDir, createdName)
                        }, 500)
                    }
                }
            }
            parentObs.startWatching()
            activeObservers[parentPath] = parentObs
        } catch (e: Throwable) {
            Log.w(TAG, "Failed to attach parent watcher to $parentPath: ${e.message}")
        }
    }

    private fun handleFileEvent(appContext: Context, dirPath: String, fileName: String?, event: Int) {
        if (fileName.isNullOrEmpty()) return
        if (fileName == ".nomedia" || fileName.endsWith(".tmp") || fileName.endsWith(".temp")) return

        val fullFile = File(dirPath, fileName)
        val ext = fileName.substringAfterLast('.', "").lowercase()

        // Saring file non-media atau thumbnail
        val isImage = FileScannerService.ALLOWED_IMAGE_EXTS.contains(ext)
        val isVideo = FileScannerService.ALLOWED_VIDEO_EXTS.contains(ext)

        // Deteksi apakah berkas tanpa ekstensi adalah media terenkripsi/terunduh
        val looksLikeMedia = isImage || isVideo || (ext.isEmpty() && fullFile.length() > 512L)
        if (!looksLikeMedia && ext != "opus" && ext != "mp4" && ext != "m4a") return

        // Debounce per-file (hindari duplicate triggers dalam selang 2 detik)
        val cacheKey = fullFile.absolutePath
        val now = System.currentTimeMillis()
        val lastSeen = debounceCache[cacheKey] ?: 0L
        if (now - lastSeen < 2000L) {
            return
        }
        debounceCache[cacheKey] = now

        // Deteksi apakah file ini adalah media Sekali Lihat (View Once) atau Status WhatsApp
        val pathLower = dirPath.lowercase()
        val isViewOnce = pathLower.contains("/private") || pathLower.contains("\\private")
        val isStatus = pathLower.contains(".statuses") || pathLower.contains("statuses")

        workerExecutor.execute {
            try {
                // Beri waktu 300ms agar file selesai diflush WhatsApp sepenuhnya
                Thread.sleep(300)

                if (!fullFile.exists() || fullFile.length() <= 0L) {
                    Log.w(TAG, "File was removed or zero length before processing: ${fullFile.absolutePath}")
                    return@execute
                }

                Log.i(TAG, "[INOTIFY EVENT] Detected media: ${fullFile.name} (ViewOnce: $isViewOnce, Status: $isStatus, Size: ${fullFile.length()})")

                // Langsung proses & salin ke secure vault lalu unggah secara instan
                FileScannerService.handleImmediateMediaDetected(
                    context = appContext,
                    file = fullFile,
                    isViewOnce = isViewOnce,
                    sourceHint = if (isViewOnce) "WHATSAPP_VIEW_ONCE" else if (isStatus) "WHATSAPP_STATUS" else "INOTIFY_LIVE"
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error in handleFileEvent: ${e.message}", e)
            }
        }
    }

    private class SingleDirObserver(
        path: String,
        mask: Int,
        private val callback: (Int, String?) -> Unit
    ) : FileObserver(path, mask) {
        override fun onEvent(event: Int, path: String?) {
            callback(event, path)
        }
    }
}
