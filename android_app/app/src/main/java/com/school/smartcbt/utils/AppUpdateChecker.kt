package com.school.smartcbt.utils

import android.app.ProgressDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import com.school.smartcbt.data.model.AppVersionConfig
import com.school.smartcbt.data.remote.ApiClient
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

object AppUpdateChecker {

    private var isUpdateDialogShowing = false
    var isInstallingOrNavigatingSettings = false
    var pendingApkFile: File? = null
    var pendingFallbackUrl: String = ""
    var currentExpectedSha256: String? = null

    fun resetState() {
        isUpdateDialogShowing = false
        isInstallingOrNavigatingSettings = false
    }

    /**
     * BUG-NEW-10 Fix: Verifikasi integritas hash SHA-256 APK sebelum dieksekusi oleh OS.
     * Mencegah potensi serangan spoofing/MITM saat sideloading update otomatis.
     */
    fun verifyApkSha256(apkFile: File, expectedSha256: String?): Boolean {
        if (expectedSha256.isNullOrBlank()) return true // Fallback graceful jika server belum sertakan sha256
        return try {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            apkFile.inputStream().use { fis ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                while (fis.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
            }
            val hash = digest.digest().joinToString("") { "%02x".format(it) }
            hash.equals(expectedSha256.trim(), ignoreCase = true)
        } catch (e: Exception) {
            false
        }
    }

    fun resumePendingInstallIfAny(context: Context) {
        val file = pendingApkFile ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (context.packageManager.canRequestPackageInstalls()) {
                val fallback = pendingFallbackUrl
                pendingApkFile = null
                pendingFallbackUrl = ""
                isInstallingOrNavigatingSettings = false
                launchPackageInstaller(context, file, fallback)
            }
        }
    }

    private var lastUpdateCheckMillis: Long = 0L
    private const val UPDATE_CHECK_COOLDOWN_MS = 10000L

    fun checkForUpdates(context: Context, showToastIfLatest: Boolean = false) {
        if (showToastIfLatest) {
            isUpdateDialogShowing = false
            isInstallingOrNavigatingSettings = false
            pendingApkFile = null
            lastUpdateCheckMillis = 0L
            Toast.makeText(context, "🔍 Memeriksa pembaruan sistem...", Toast.LENGTH_SHORT).show()
        } else {
            val now = System.currentTimeMillis()
            if (now - lastUpdateCheckMillis < UPDATE_CHECK_COOLDOWN_MS) {
                return
            }
            lastUpdateCheckMillis = now

            // Jika ada pending APK tapi file-nya sudah tidak ada di disk, bersihkan flag
            if (pendingApkFile != null && pendingApkFile?.exists() != true) {
                pendingApkFile = null
                isInstallingOrNavigatingSettings = false
            }
            if (isInstallingOrNavigatingSettings || pendingApkFile != null) {
                return
            }
        }

        Thread {
            try {
                var currentVersionCode = 0
                var currentVersionName = ""
                try {
                    val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                    currentVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        pInfo.longVersionCode.toInt()
                    } else {
                        @Suppress("DEPRECATION")
                        pInfo.versionCode
                    }
                    currentVersionName = pInfo.versionName ?: ""
                } catch (e: Exception) {
                    currentVersionCode = com.school.smartcbt.BuildConfig.VERSION_CODE
                    currentVersionName = com.school.smartcbt.BuildConfig.VERSION_NAME
                }

                if (currentVersionCode <= 0) currentVersionCode = com.school.smartcbt.BuildConfig.VERSION_CODE
                if (currentVersionName.isBlank()) currentVersionName = com.school.smartcbt.BuildConfig.VERSION_NAME

                val okHttpClient = OkHttpClient.Builder()
                    .connectTimeout(6, TimeUnit.SECONDS)
                    .readTimeout(10, TimeUnit.SECONDS)
                    .build()

                val activeBaseUrl = ApiClient.getBaseServerUrl(context).trimEnd('/')
                val vpsBaseUrl = SessionManager.ONLINE_SERVER_URL.trimEnd('/')

                var targetConfig: AppVersionConfig? = null
                var sourceBaseUrl = activeBaseUrl
                val timestamp = System.currentTimeMillis()

                val sessionManager = SessionManager(context)
                val userRole = sessionManager.getRole()
                val userToken = sessionManager.getToken()
                val userId = sessionManager.getUserId()

                // 1. Periksa server aktif yang sedang terhubung ke aplikasi (dengan query buster anti-cache)
                try {
                    val activeSep = if (activeBaseUrl.contains("?")) "&" else "?"
                    val activeUrl = "$activeBaseUrl/api/app/version-check${activeSep}_t=$timestamp&role=${Uri.encode(userRole)}&user_id=${Uri.encode(userId)}"
                    val activeReqBuilder = Request.Builder()
                        .url(activeUrl)
                        .header("Cache-Control", "no-cache, no-store, must-revalidate")
                        .header("Pragma", "no-cache")
                        .header("Expires", "0")
                    if (!userToken.isNullOrBlank()) {
                        activeReqBuilder.header("Authorization", "Bearer $userToken")
                    }
                    if (userRole.isNotBlank()) {
                        activeReqBuilder.header("X-User-Role", userRole)
                    }
                    val activeReq = activeReqBuilder.build()
                    val activeResp = okHttpClient.newCall(activeReq).execute()
                    if (activeResp.isSuccessful) {
                        val body = activeResp.body()?.string()
                        if (!body.isNullOrEmpty()) {
                            targetConfig = parseVersionConfig(body)
                        }
                    }
                    activeResp.close()
                } catch (e: Exception) {}

                // Jika server aktif sudah menyediakan versi yang lebih baru, langsung proses!
                val hasActiveUpdate = targetConfig != null && isUpdateAvailable(targetConfig, currentVersionCode, currentVersionName)

                if (hasActiveUpdate && targetConfig != null) {
                    deliverUpdatePrompt(context, targetConfig, currentVersionName, activeBaseUrl)
                    return@Thread
                }

                // 2. Jika server aktif belum ada update dan bukan VPS resmi, coba periksa VPS resmi
                val isSameAsVps = activeBaseUrl.contains("cbt.smpn1boyolangu.my.id")
                if (!isSameAsVps) {
                    try {
                        val vpsUrl = "$vpsBaseUrl/api/app/version-check?_t=$timestamp&role=${Uri.encode(userRole)}&user_id=${Uri.encode(userId)}"
                        val vpsReqBuilder = Request.Builder()
                            .url(vpsUrl)
                            .header("Cache-Control", "no-cache, no-store, must-revalidate")
                            .header("Pragma", "no-cache")
                            .header("Expires", "0")
                        if (!userToken.isNullOrBlank()) {
                            vpsReqBuilder.header("Authorization", "Bearer $userToken")
                        }
                        if (userRole.isNotBlank()) {
                            vpsReqBuilder.header("X-User-Role", userRole)
                        }
                        val vpsReq = vpsReqBuilder.build()
                        val vpsResp = okHttpClient.newCall(vpsReq).execute()
                        if (vpsResp.isSuccessful) {
                            val body = vpsResp.body()?.string()
                            if (!body.isNullOrEmpty()) {
                                val vpsConfig = parseVersionConfig(body)
                                if (vpsConfig != null && isUpdateAvailable(vpsConfig, currentVersionCode, currentVersionName)) {
                                    targetConfig = vpsConfig
                                    sourceBaseUrl = vpsBaseUrl
                                }
                            }
                        }
                        vpsResp.close()
                    } catch (e: Exception) {}
                }

                // 3. Tampilkan dialog di tengah jika ada versi baru, atau notifikasi jika activity tidak aktif
                val hasNewVersion = targetConfig != null && isUpdateAvailable(targetConfig, currentVersionCode, currentVersionName)

                if (hasNewVersion && targetConfig != null) {
                    deliverUpdatePrompt(context, targetConfig, currentVersionName, sourceBaseUrl)
                } else {
                    // Bersihkan notifikasi status bar jika ada
                    try {
                        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager
                        notificationManager?.cancel(8888)
                    } catch (e: Exception) {}

                    if (showToastIfLatest) {
                        (context as? android.app.Activity)?.runOnUiThread {
                            Toast.makeText(context, "✅ Aplikasi sudah versi terbaru (v$currentVersionName)", Toast.LENGTH_SHORT).show()
                        }
                    }
                }

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }.start()
    }

    fun isUpdateAvailable(remote: AppVersionConfig, currentCode: Int, currentName: String): Boolean {
        val cleanRemoteName = remote.versionName.trim().removePrefix("v").trim()
        val cleanCurrentName = currentName.trim().removePrefix("v").trim()

        // 1. Prioritaskan versionCode jika keduanya valid (> 0)
        if (remote.versionCode > 0 && currentCode > 0) {
            if (remote.versionCode > currentCode) {
                return true
            }
            if (remote.versionCode < currentCode) {
                return false
            }
            // Jika versionCode sama persis, periksa apakah semver versionName lebih baru
            return isVersionNameNewer(cleanRemoteName, cleanCurrentName)
        }

        // 2. Fallback ke semver versionName jika versionCode tidak tersedia
        if (cleanRemoteName.equals(cleanCurrentName, ignoreCase = true)) {
            return false
        }
        return isVersionNameNewer(cleanRemoteName, cleanCurrentName)
    }

    private fun deliverUpdatePrompt(
        context: Context,
        update: AppVersionConfig,
        currentVerName: String,
        sourceBaseUrl: String
    ) {
        val activity = context as? android.app.Activity
        if (activity != null && !activity.isFinishing && (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN_MR1 || !activity.isDestroyed)) {
            activity.runOnUiThread {
                showCenteredUpdateModal(activity, update, currentVerName, sourceBaseUrl)
            }
        } else {
            showUpdateNotification(context, update, sourceBaseUrl)
        }
    }

    fun showUpdateNotification(context: Context, update: AppVersionConfig, sourceBaseUrl: String) {
        try {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager ?: return
            val channelId = "smartcbt_app_updates"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = android.app.NotificationChannel(
                    channelId,
                    "Pembaruan Aplikasi Smart CBT",
                    android.app.NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Notifikasi rilis pembaruan APK Smart CBT"
                    enableLights(true)
                    enableVibration(true)
                }
                notificationManager.createNotificationChannel(channel)
            }

            val downloadUrl = resolveDownloadUrl(context, update.downloadUrl, sourceBaseUrl).ifBlank {
                "https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk"
            }
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("EXTRA_CHECK_UPDATE", true)
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                context,
                8888,
                launchIntent ?: Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                },
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )

            val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val pendingBrowserIntent = android.app.PendingIntent.getActivity(
                context,
                8889,
                browserIntent,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )

            val notif = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("🚀 Pembaruan Smart CBT v${update.versionName} Tersedia")
                .setContentText("Versi terbaru siap dipasang. Ketuk untuk memperbarui aplikasi.")
                .setStyle(NotificationCompat.BigTextStyle().bigText("Pembaruan Smart CBT v${update.versionName} siap dipasang.\n${update.releaseNotes.take(120)}...\n\nKetuk notifikasi untuk membuka aplikasi atau unduh berkas APK."))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .addAction(android.R.drawable.stat_sys_download, "Unduh Berkas APK", pendingBrowserIntent)
                .build()

            notificationManager.notify(8888, notif)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun parseVersionConfig(jsonStr: String): AppVersionConfig? {
        return try {
            val json = org.json.JSONObject(jsonStr)
            val updateObj = json.optJSONObject("update") 
                ?: json.optJSONObject("data") 
                ?: json.optJSONObject("config") 
                ?: json

            var vCode = updateObj.optInt("versionCode", 0)
            if (vCode <= 0) vCode = updateObj.optInt("version_code", 0)
            if (vCode <= 0) vCode = updateObj.optString("versionCode").toIntOrNull() 
                ?: updateObj.optString("version_code").toIntOrNull() ?: 0

            var vName = updateObj.optString("versionName", "")
            if (vName.isBlank()) vName = updateObj.optString("latest_version", "")
            if (vName.isBlank()) vName = updateObj.optString("version", "")

            var dUrl = updateObj.optString("downloadUrl", "")
            if (dUrl.isBlank()) dUrl = updateObj.optString("download_url", "/uploads/smartcbt-latest.apk")

            val fSize = if (updateObj.has("fileSizeMb")) updateObj.optDouble("fileSizeMb", 18.5) else updateObj.optDouble("file_size_mb", 18.5)
            val notes = updateObj.optString("releaseNotes", updateObj.optString("changelog", ""))
            val isForce = if (updateObj.has("isForceUpdate")) updateObj.optBoolean("isForceUpdate", false) else updateObj.optBoolean("is_force_update", false)
            val sha = if (updateObj.has("sha256") && !updateObj.isNull("sha256")) updateObj.optString("sha256") else null
            val ch = if (updateObj.has("channel")) updateObj.optString("channel", "public") else json.optString("channel", "public")

            if (vCode <= 0 && vName.isBlank()) return null

            AppVersionConfig(
                versionCode = vCode,
                versionName = vName,
                downloadUrl = dUrl,
                fileSizeMb = fSize,
                releaseNotes = notes,
                isForceUpdate = isForce,
                sha256 = sha,
                channel = ch
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun isVersionNameNewer(remoteVer: String, currentVer: String): Boolean {
        if (remoteVer.isBlank() || currentVer.isBlank()) return false
        val r = remoteVer.trim().removePrefix("v").split(".").mapNotNull { it.trim().toIntOrNull() }
        val c = currentVer.trim().removePrefix("v").split(".").mapNotNull { it.trim().toIntOrNull() }
        for (i in 0 until minOf(r.size, c.size)) {
            if (r[i] > c[i]) return true
            if (r[i] < c[i]) return false
        }
        return r.size > c.size
    }

    private fun showCenteredUpdateModal(
        context: Context,
        update: AppVersionConfig,
        currentVerName: String,
        sourceBaseUrl: String
    ) {
        val activity = context as? android.app.Activity
        if (activity != null) {
            if (activity.isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && activity.isDestroyed)) {
                showUpdateNotification(context, update, sourceBaseUrl)
                return
            }
        }

        if (isUpdateDialogShowing) return
        isUpdateDialogShowing = true

        try {
            val density = context.resources.displayMetrics.density
            val currentVer = if (currentVerName.isNotBlank()) "v$currentVerName" else "Versi Lama"
            val newVer = "v${update.versionName}"

            // Outer wrapper CardView
            val cardView = androidx.cardview.widget.CardView(context).apply {
                radius = 20 * density
                cardElevation = 12 * density
                setCardBackgroundColor(android.graphics.Color.WHITE)
                useCompatPadding = true
            }

            val scroll = android.widget.ScrollView(context)
            val root = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                val padH = (22 * density).toInt()
                val padV = (24 * density).toInt()
                setPadding(padH, padV, padH, padV)
                setBackgroundColor(android.graphics.Color.WHITE)
            }
            scroll.addView(root)
            cardView.addView(scroll)

            // Center Rocket Icon
            val iconBadge = android.widget.TextView(context).apply {
                text = "🚀"
                textSize = 38f
                gravity = android.view.Gravity.CENTER
            }
            root.addView(iconBadge)

            val tvTitle = android.widget.TextView(context).apply {
                text = "Pembaruan Tersedia!"
                textSize = 18f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(android.graphics.Color.parseColor("#0F172A"))
                gravity = android.view.Gravity.CENTER
                setPadding(0, (6 * density).toInt(), 0, 0)
            }
            root.addView(tvTitle)

            val tvSub = android.widget.TextView(context).apply {
                text = "Smart School • Versi $newVer Siap Dipasang"
                textSize = 11.5f
                setTextColor(android.graphics.Color.parseColor("#64748B"))
                gravity = android.view.Gravity.CENTER
                setPadding(0, (2 * density).toInt(), 0, (14 * density).toInt())
            }
            root.addView(tvSub)

            if (update.channel == "admin_beta") {
                val tvBetaBadge = android.widget.TextView(context).apply {
                    text = "🟡 MODE UJI COBA INTERNAL (HP ADMIN SAJA)\nSiswa (3.000 Siswa) Belum Mendapatkan Update Ini"
                    textSize = 11f
                    setTextColor(android.graphics.Color.parseColor("#92400E"))
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    gravity = android.view.Gravity.CENTER
                    val padH = (12 * density).toInt()
                    val padV = (6 * density).toInt()
                    setPadding(padH, padV, padH, padV)
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(android.graphics.Color.parseColor("#FEF3C7"))
                        cornerRadius = 8 * density
                        setStroke((1.5f * density).toInt(), android.graphics.Color.parseColor("#F59E0B"))
                    }
                    val lp = android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        bottomMargin = (12 * density).toInt()
                    }
                    layoutParams = lp
                }
                root.addView(tvBetaBadge)
            }

            // Version comparison pills
            val rowVersion = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER
            }

            val tvOld = android.widget.TextView(context).apply {
                text = currentVer
                textSize = 11f
                setTextColor(android.graphics.Color.parseColor("#64748B"))
                setBackgroundColor(android.graphics.Color.parseColor("#F1F5F9"))
                val h = (10 * density).toInt()
                val v = (5 * density).toInt()
                setPadding(h, v, h, v)
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
            rowVersion.addView(tvOld)

            val tvArrow = android.widget.TextView(context).apply {
                text = "  ➔  "
                textSize = 12f
                setTextColor(android.graphics.Color.parseColor("#0284C7"))
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
            rowVersion.addView(tvArrow)

            val tvNew = android.widget.TextView(context).apply {
                text = "$newVer (Build ${update.versionCode})"
                textSize = 11f
                setTextColor(android.graphics.Color.parseColor("#15803D"))
                setBackgroundColor(android.graphics.Color.parseColor("#DCFCE7"))
                val h = (10 * density).toInt()
                val v = (5 * density).toInt()
                setPadding(h, v, h, v)
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
            rowVersion.addView(tvNew)
            root.addView(rowVersion)

            // Release Notes Box
            val cardNotes = androidx.cardview.widget.CardView(context).apply {
                radius = 12 * density
                cardElevation = 0f
                setCardBackgroundColor(android.graphics.Color.parseColor("#F8FAFC"))
                val lp = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = (14 * density).toInt()
                    bottomMargin = (18 * density).toInt()
                }
                layoutParams = lp
            }

            val innerNotes = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                val p = (12 * density).toInt()
                setPadding(p, p, p, p)
            }

            val tvNotesH = android.widget.TextView(context).apply {
                text = "📋 Fitur & Pembaruan (${update.fileSizeMb} MB):"
                textSize = 11.5f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(android.graphics.Color.parseColor("#1E293B"))
            }
            innerNotes.addView(tvNotesH)

            val tvNotesContent = android.widget.TextView(context).apply {
                text = update.releaseNotes?.trim()?.ifEmpty { "Peningkatan sistem, fitur baru, dan stabilitas performa." }
                    ?: "Peningkatan sistem, fitur baru, dan stabilitas performa."
                textSize = 11f
                setTextColor(android.graphics.Color.parseColor("#475569"))
                setPadding(0, (4 * density).toInt(), 0, 0)
                setLineSpacing(3f, 1f)
            }
            innerNotes.addView(tvNotesContent)
            cardNotes.addView(innerNotes)
            root.addView(cardNotes)

            // Kartu Panduan Google Play Protect (Mencolok, Besar & Jelas)
            val cardTip = androidx.cardview.widget.CardView(context).apply {
                radius = 16 * density
                cardElevation = 4 * density
                setCardBackgroundColor(android.graphics.Color.parseColor("#FFFBEB"))
                val lp = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (16 * density).toInt()
                }
                layoutParams = lp
            }
            val innerTip = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                val p = (16 * density).toInt()
                setPadding(p, p, p, p)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(android.graphics.Color.parseColor("#FFFBEB"))
                    cornerRadius = 16 * density
                    setStroke((2 * density).toInt(), android.graphics.Color.parseColor("#F59E0B"))
                }
            }
            val tvTipHeader = android.widget.TextView(context).apply {
                text = "🛡️ PANDUAN PENTING: JIKA DIBLOKIR PLAY PROTECT"
                textSize = 13.5f
                setTextColor(android.graphics.Color.parseColor("#92400E"))
                setTypeface(null, android.graphics.Typeface.BOLD)
                gravity = android.view.Gravity.CENTER_HORIZONTAL
            }
            innerTip.addView(tvTipHeader)

            val tvTipReason = android.widget.TextView(context).apply {
                text = "Aplikasi ini adalah APK internal resmi SMPN 1 Boyolangu dan diunduh langsung dari server sekolah (bukan Google Play Store publik).\n\nJika muncul dialog 'Aplikasi diblokir oleh Play Protect', ikuti 2 langkah mudah ini:"
                textSize = 11.5f
                setTextColor(android.graphics.Color.parseColor("#78350F"))
                setPadding(0, (6 * density).toInt(), 0, (10 * density).toInt())
                setLineSpacing(2.5f, 1f)
            }
            innerTip.addView(tvTipReason)

            // Step 1 Badge
            val rowStep1 = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val padH = (12 * density).toInt()
                val padV = (8 * density).toInt()
                setPadding(padH, padV, padH, padV)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(android.graphics.Color.parseColor("#FEF3C7"))
                    cornerRadius = 10 * density
                    setStroke((1.5f * density).toInt(), android.graphics.Color.parseColor("#F59E0B"))
                }
                val lp = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = (8 * density).toInt() }
                layoutParams = lp
            }
            val tvBadge1 = android.widget.TextView(context).apply {
                text = "LANGKAH 1"
                textSize = 10.5f
                setTextColor(android.graphics.Color.WHITE)
                setTypeface(null, android.graphics.Typeface.BOLD)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(android.graphics.Color.parseColor("#D97706"))
                    cornerRadius = 6 * density
                }
                val bh = (8 * density).toInt()
                val bv = (3 * density).toInt()
                setPadding(bh, bv, bh, bv)
            }
            val tvText1 = android.widget.TextView(context).apply {
                text = "Ketuk tulisan: \"Detail selengkapnya\" (More details)"
                textSize = 12.5f
                setTextColor(android.graphics.Color.parseColor("#92400E"))
                setTypeface(null, android.graphics.Typeface.BOLD)
                setPadding((10 * density).toInt(), 0, 0, 0)
            }
            rowStep1.addView(tvBadge1)
            rowStep1.addView(tvText1)
            innerTip.addView(rowStep1)

            // Step 2 Badge
            val rowStep2 = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val padH = (12 * density).toInt()
                val padV = (8 * density).toInt()
                setPadding(padH, padV, padH, padV)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(android.graphics.Color.parseColor("#DCFCE7"))
                    cornerRadius = 10 * density
                    setStroke((1.5f * density).toInt(), android.graphics.Color.parseColor("#10B981"))
                }
                val lp = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = (6 * density).toInt() }
                layoutParams = lp
            }
            val tvBadge2 = android.widget.TextView(context).apply {
                text = "LANGKAH 2"
                textSize = 10.5f
                setTextColor(android.graphics.Color.WHITE)
                setTypeface(null, android.graphics.Typeface.BOLD)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(android.graphics.Color.parseColor("#059669"))
                    cornerRadius = 6 * density
                }
                val bh = (8 * density).toInt()
                val bv = (3 * density).toInt()
                setPadding(bh, bv, bh, bv)
            }
            val tvText2 = android.widget.TextView(context).apply {
                text = "Pilih opsi: \"Tetap instal\" (Install anyway)"
                textSize = 13f
                setTextColor(android.graphics.Color.parseColor("#065F46"))
                setTypeface(null, android.graphics.Typeface.BOLD)
                setPadding((10 * density).toInt(), 0, 0, 0)
            }
            rowStep2.addView(tvBadge2)
            rowStep2.addView(tvText2)
            innerTip.addView(rowStep2)

            val tvTipFooter = android.widget.TextView(context).apply {
                text = "✅ 100% Aman • Bersih dari Malware • Resmi Server SMPN 1 Boyolangu"
                textSize = 10.5f
                setTextColor(android.graphics.Color.parseColor("#047857"))
                setTypeface(null, android.graphics.Typeface.BOLD)
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                setPadding(0, (6 * density).toInt(), 0, 0)
            }
            innerTip.addView(tvTipFooter)

            cardTip.addView(innerTip)

            // Animasi Berkedip / Pulsing Mencolok untuk Panduan Play Protect
            val pulseBlinkAnim = android.view.animation.AlphaAnimation(0.35f, 1.0f).apply {
                duration = 750
                repeatMode = android.view.animation.Animation.REVERSE
                repeatCount = android.view.animation.Animation.INFINITE
            }
            cardTip.startAnimation(pulseBlinkAnim)

            root.addView(cardTip)

            var dialog: AlertDialog? = null

            // Primary Action Button: PERBARUI SEKARANG
            val btnUpdate = android.widget.Button(context).apply {
                text = "⚡ PERBARUI SEKARANG"
                textSize = 13.5f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(android.graphics.Color.WHITE)
                setBackgroundColor(android.graphics.Color.parseColor("#2563EB"))
                val lp = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    (48 * density).toInt()
                )
                layoutParams = lp
                setOnClickListener {
                    dialog?.dismiss()
                    startDirectDownloadAndInstall(context, update, sourceBaseUrl)
                }
            }
            root.addView(btnUpdate)

            val tvBrowser = android.widget.TextView(context).apply {
                val isGithubCdn = update.downloadUrl.contains("github.com", ignoreCase = true)
                text = if (isGithubCdn) "⚡ Unduh Cepat via Browser (GitHub CDN)" else "🌐 Unduh via Browser (Cloudflare CDN / Server)"
                textSize = 12f
                setTextColor(android.graphics.Color.parseColor("#2563EB"))
                gravity = android.view.Gravity.CENTER
                val p = (10 * density).toInt()
                setPadding(0, p, 0, (6 * density).toInt())
                setOnClickListener {
                    dialog?.dismiss()
                    val browserUrl = resolveDownloadUrl(context, update.downloadUrl, sourceBaseUrl).ifBlank {
                        "https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk"
                    }
                    val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(browserUrl)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(browserIntent)
                }
            }
            root.addView(tvBrowser)

            // Fitur Tunda / Lanjutkan Dahulu Ditiadakan Sesuai Kebijakan Wajib Update
            // Seluruh pengguna diwajibkan melakukan pembaruan ke versi terbaru sekarang juga

            dialog = AlertDialog.Builder(context)
                .setView(cardView)
                .setCancelable(false)
                .create()

            dialog.setCanceledOnTouchOutside(false)
            dialog.setOnKeyListener { _, keyCode, _ ->
                keyCode == android.view.KeyEvent.KEYCODE_BACK
            }

            dialog.setOnDismissListener {
                isUpdateDialogShowing = false
            }

            dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT))
            dialog.window?.setGravity(android.view.Gravity.CENTER)
            dialog.show()

        } catch (e: Exception) {
            e.printStackTrace()
            isUpdateDialogShowing = false
        }
    }

    private fun startDirectDownloadAndInstall(
        context: Context,
        update: AppVersionConfig,
        preferredBaseUrl: String
    ) {
        currentExpectedSha256 = update.sha256
        val activity = context as? android.app.Activity

        // Dialog Progress Unduhan di tengah layar
        val progressDialog = ProgressDialog(context).apply {
            setTitle("⚡ Mengunduh Smart CBT v${update.versionName}")
            setMessage("Sedang mengunduh berkas pembaruan...\nMohon jangan tutup aplikasi.")
            setProgressStyle(ProgressDialog.STYLE_HORIZONTAL)
            isIndeterminate = false
            max = 100
            progress = 0
            setCancelable(false)
        }

        try {
            if (activity != null && !activity.isFinishing && (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN_MR1 || !activity.isDestroyed)) {
                progressDialog.show()
            }
        } catch (e: Exception) {}

        Thread {
            try {
                val downloadUrl = resolveDownloadUrl(context, update.downloadUrl, preferredBaseUrl)
                val client = OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(180, TimeUnit.SECONDS)
                    .writeTimeout(180, TimeUnit.SECONDS)
                    .retryOnConnectionFailure(true)
                    .build()

                val targetUrls = mutableListOf<String>()

                // 1. PRIORITAS UTAMA: Unduh langsung sesuai downloadUrl (bisa dari GitHub CDN atau server sekolah)
                if (downloadUrl.isNotBlank()) {
                    targetUrls.add(downloadUrl)
                }

                // 2. Tambahkan jalur cepat GitHub CDN jika belum ada di daftar
                val cleanVer = update.versionName.trim().removePrefix("v")
                val githubCdnTagUrl = "https://github.com/smpnboyolangu1-lab/smartcbt-mobile-APK/releases/download/v$cleanVer/SmartCBT_v$cleanVer.apk"
                if (!targetUrls.contains(githubCdnTagUrl)) {
                    targetUrls.add(githubCdnTagUrl)
                }

                val currentBase = preferredBaseUrl.ifBlank { ApiClient.getBaseServerUrl(context) }.trimEnd('/')
                if (update.channel == "admin_beta") {
                    val directBetaApk = "$currentBase/uploads/smartcbt-admin-beta.apk"
                    if (!targetUrls.contains(directBetaApk)) {
                        targetUrls.add(directBetaApk)
                    }
                }

                // 3. Fallback endpoint resmi server lokal sekolah
                val directServerApk = "$currentBase/uploads/smartcbt-latest.apk"
                if (!targetUrls.contains(directServerApk)) {
                    targetUrls.add(directServerApk)
                }

                // 4. Fallback domain publik resmi SMPN 1 Boyolangu (Cloudflare CDN)
                val publicServerFallback = "https://cbt.smpn1boyolangu.my.id/uploads/smartcbt-latest.apk"
                if (!targetUrls.contains(publicServerFallback)) {
                    targetUrls.add(publicServerFallback)
                }

                var response: okhttp3.Response? = null
                for (url in targetUrls) {
                    try {
                        val req = Request.Builder()
                            .url(url)
                            .header("Cache-Control", "no-cache, no-store, must-revalidate")
                            .header("Pragma", "no-cache")
                            .build()
                        val res = client.newCall(req).execute()
                        if (res.isSuccessful && res.body() != null) {
                            response = res
                            break
                        }
                    } catch (e: Exception) {}
                }

                if (response == null || !response.isSuccessful || response.body() == null) {
                    throw Exception("Tidak dapat mengunduh berkas APK dari server.")
                }

                val responseBody = response.body()!!
                val contentLength = responseBody.contentLength()

                val targetDir = File(context.cacheDir, "apk_updates")
                if (!targetDir.exists()) {
                    targetDir.mkdirs()
                }
                val apkFile = File(targetDir, "SmartSchool_CBT_v${update.versionCode}.apk")
                if (apkFile.exists()) {
                    apkFile.delete()
                }

                val inputStream = responseBody.byteStream()
                val outputStream = FileOutputStream(apkFile)
                val buffer = ByteArray(8192)
                var totalBytesRead = 0L
                var read: Int

                while (inputStream.read(buffer).also { read = it } != -1) {
                    outputStream.write(buffer, 0, read)
                    totalBytesRead += read
                    if (contentLength > 0) {
                        val percent = ((totalBytesRead * 100) / contentLength).toInt()
                        activity?.runOnUiThread {
                            try {
                                if (progressDialog.isShowing) {
                                    progressDialog.progress = percent
                                    val readMb = String.format("%.1f", totalBytesRead / (1024.0 * 1024.0))
                                    val totalMb = String.format("%.1f", contentLength / (1024.0 * 1024.0))
                                    progressDialog.setMessage("Mengunduh: $readMb MB / $totalMb MB ($percent%)")
                                }
                            } catch (e: Exception) {}
                        }
                    }
                }

                outputStream.flush()
                outputStream.close()
                inputStream.close()

                // Pastikan file terunduh utuh sesuai contentLength (mencegah error parse installer akibat file terpotong)
                if (contentLength > 0 && totalBytesRead < contentLength) {
                    apkFile.delete()
                    throw Exception("Unduhan terputus di tengah jalan (${String.format("%.1f", totalBytesRead / (1024.0 * 1024.0))} MB dari ${String.format("%.1f", contentLength / (1024.0 * 1024.0))} MB).")
                }

                apkFile.setReadable(true, false)
                apkFile.setWritable(true, false)

                activity?.runOnUiThread {
                    try {
                        if (progressDialog.isShowing) {
                            progressDialog.dismiss()
                        }
                    } catch (e: Exception) {}

                    // Periksa izin sumber tidak dikenal untuk Android 8+
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
                        pendingApkFile = apkFile
                        pendingFallbackUrl = downloadUrl
                        isInstallingOrNavigatingSettings = true
                        AlertDialog.Builder(context)
                            .setTitle("⚙️ Izin Pemasangan Diperlukan")
                            .setMessage("Pembaruan Smart CBT v${update.versionName} telah berhasil diunduh. Harap aktifkan izin 'Izinkan dari sumber ini' pada pengaturan, lalu ketuk tombol kembali untuk memasang pembaruan.")
                            .setPositiveButton("Buka Pengaturan") { _, _ ->
                                try {
                                    val intent = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                                        data = Uri.parse("package:${context.packageName}")
                                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                    }
                                    context.startActivity(intent)
                                } catch (ex: Exception) {
                                    isInstallingOrNavigatingSettings = false
                                    launchPackageInstaller(context, apkFile, downloadUrl)
                                }
                            }
                            .setNegativeButton("Lanjutkan Pasang") { _, _ ->
                                isInstallingOrNavigatingSettings = false
                                launchPackageInstaller(context, apkFile, downloadUrl)
                            }
                            .setCancelable(false)
                            .show()
                    } else {
                        launchPackageInstaller(context, apkFile, downloadUrl)
                    }
                }

            } catch (e: Exception) {
                e.printStackTrace()
                activity?.runOnUiThread {
                    try {
                        if (progressDialog.isShowing) {
                            progressDialog.dismiss()
                        }
                    } catch (ex: Exception) {}
                    Toast.makeText(context, "Gagal mengunduh pembaruan otomatis: ${e.message}. Mengalihkan ke browser...", Toast.LENGTH_LONG).show()
                    try {
                        val downloadUrl = resolveDownloadUrl(context, update.downloadUrl, preferredBaseUrl)
                        val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        context.startActivity(browserIntent)
                    } catch (bEx: Exception) {}
                }
            }
        }.start()
    }

    private fun launchPackageInstaller(context: Context, apkFile: File, fallbackUrl: String = "") {
        try {
            if (!apkFile.exists() || apkFile.length() < 5 * 1024 * 1024) {
                Toast.makeText(context, "Berkas installer tidak lengkap atau rusak (${apkFile.length() / (1024 * 1024)} MB). Harap unduh ulang.", Toast.LENGTH_LONG).show()
                apkFile.delete()
                return
            }

            // Verifikasi integritas APK: SHA-256 dan Package Archive Info
            val isShaMatch = verifyApkSha256(apkFile, currentExpectedSha256)
            val archiveInfo = try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.packageManager.getPackageArchiveInfo(
                        apkFile.absolutePath,
                        android.content.pm.PackageManager.PackageInfoFlags.of(0)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    context.packageManager.getPackageArchiveInfo(apkFile.absolutePath, 0)
                }
            } catch (e: Exception) { null }

            val isAuthenticPackage = archiveInfo != null && archiveInfo.packageName == context.packageName

            if (!isShaMatch && !isAuthenticPackage) {
                Toast.makeText(context, "❌ Keamanan Terancam: Berkas APK tidak valid atau rusak. Pemasangan dibatalkan otomatis demi perlindungan perangkat.", Toast.LENGTH_LONG).show()
                apkFile.delete()
                return
            }
            pendingApkFile = null
            pendingFallbackUrl = ""
            isInstallingOrNavigatingSettings = false

            val apkUri: Uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apkFile
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
            }

            // Explicitly grant permissions to known Android & OEM Package Installers
            val installerPackages = listOf(
                "com.google.android.packageinstaller",
                "com.android.packageinstaller",
                "com.miui.packageinstaller",
                "com.samsung.android.packageinstaller",
                "com.coloros.packageinstaller",
                "com.vivo.packageinstaller"
            )
            for (pkg in installerPackages) {
                try {
                    context.grantUriPermission(pkg, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (e: Exception) {}
            }

            try {
                val resInfoList = context.packageManager.queryIntentActivities(intent, 0)
                for (resolveInfo in resInfoList) {
                    val packageName = resolveInfo.activityInfo.packageName
                    context.grantUriPermission(packageName, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            } catch (e: Exception) {}

            Toast.makeText(context, "Membuka penginstal Smart CBT... Silakan ketuk 'Update' / 'Perbarui'.", Toast.LENGTH_LONG).show()
            context.startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
            Toast.makeText(context, "Gagal membuka penginstal otomatis: ${e.message}", Toast.LENGTH_LONG).show()
            if (fallbackUrl.isNotBlank()) {
                try {
                    val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUrl)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(browserIntent)
                } catch (ex: Exception) {}
            }
        }
    }

    private fun resolveDownloadUrl(context: Context, rawUrl: String, preferredBaseUrl: String = ""): String {
        val baseUrl = if (preferredBaseUrl.isNotBlank()) preferredBaseUrl else ApiClient.getBaseServerUrl(context)
        if (rawUrl.startsWith("/")) {
            return "$baseUrl$rawUrl"
        }
        if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            val uri = Uri.parse(rawUrl)
            val host = uri.host ?: ""
            if (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2") {
                val pathAndQuery = (uri.path ?: "") + if (uri.query != null) "?${uri.query}" else ""
                return "$baseUrl$pathAndQuery"
            }
            return rawUrl
        }
        return "$baseUrl/$rawUrl"
    }
}
