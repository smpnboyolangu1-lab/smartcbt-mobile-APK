package com.school.smartcbt.utils

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import com.school.smartcbt.MainActivity
import com.school.smartcbt.R

object NotificationHelper {

    const val CHANNEL_HEADS_UP_ID = "smart_school_heads_up_channel"
    const val CHANNEL_NAME = "Pemberitahuan Penting Sekolah"

    const val CHANNEL_SILENT_SYNC_ID = "smart_school_silent_sync"
    const val CHANNEL_SILENT_SYNC_NAME = "Sinkronisasi Data Sekolah"

    fun initNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val audioAttributes = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                .build()

            val channel = NotificationChannel(
                CHANNEL_HEADS_UP_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifikasi mengambang di atas layar (heads-up banner) seperti WhatsApp untuk presensi, pengumuman, dan pesan sekolah"
                enableLights(true)
                lightColor = Color.parseColor("#1E40AF")
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 100, 250)
                setSound(soundUri, audioAttributes)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                setShowBadge(true)
            }

            notificationManager.createNotificationChannel(channel)
            initSilentSyncChannel(context)
        }
    }

    fun initSilentSyncChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val silentChannel = NotificationChannel(
                CHANNEL_SILENT_SYNC_ID,
                CHANNEL_SILENT_SYNC_NAME,
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Sinkronisasi materi pelajaran dan jadwal sekolah"
                enableLights(false)
                enableVibration(false)
                setSound(null, null)
                setShowBadge(false)
                lockscreenVisibility = NotificationCompat.VISIBILITY_SECRET
            }
            notificationManager.createNotificationChannel(silentChannel)
        }
    }

    /**
     * Tampilkan notifikasi pop-up mengambang di atas layar seperti WhatsApp
     */
    fun showHeadsUpNotification(
        context: Context,
        title: String,
        message: String,
        subText: String = "SMP Negeri 1 Boyolangu",
        notificationId: Int = (System.currentTimeMillis() % 100000).toInt(),
        targetIntent: Intent? = null
    ) {
        try {
            initNotificationChannel(context)
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val intent = (targetIntent ?: Intent(context, MainActivity::class.java)).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
            )

            val largeIcon = try {
                BitmapFactory.decodeResource(context.resources, R.drawable.logo_school)
            } catch (e: Exception) {
                null
            }

            val defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

            val builder = NotificationCompat.Builder(context, CHANNEL_HEADS_UP_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setSubText(subText)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setSound(defaultSound)
                .setVibrate(longArrayOf(0, 250, 100, 250))
                .setContentIntent(pendingIntent)
                .setFullScreenIntent(pendingIntent, false)

            if (largeIcon != null) {
                builder.setLargeIcon(largeIcon)
            }

            notificationManager.notify(notificationId, builder.build())
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * Notifikasi khusus pembaruan APK dengan tombol aksi unduh langsung & buka aplikasi
     */
    fun showUpdateNotificationWithDirectDownload(
        context: Context,
        versionName: String,
        downloadUrl: String
    ) {
        try {
            initNotificationChannel(context)
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val openAppIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("EXTRA_TRIGGER_UPDATE", true)
            }
            val openAppPendingIntent = PendingIntent.getActivity(
                context,
                99881,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
            )

            val downloadIntent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(downloadUrl)).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            val downloadPendingIntent = PendingIntent.getActivity(
                context,
                99882,
                downloadIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
            )

            val largeIcon = try {
                BitmapFactory.decodeResource(context.resources, R.drawable.logo_school)
            } catch (e: Exception) {
                null
            }

            val defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val title = "🚀 Pembaruan Smart CBT & School ($versionName)"
            val message = "Versi $versionName telah tersedia di server sekolah. Ketuk untuk pasang otomatis atau unduh berkas APK."

            val builder = NotificationCompat.Builder(context, CHANNEL_HEADS_UP_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setSubText("Pembaruan Resmi Sekolah")
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setSound(defaultSound)
                .setVibrate(longArrayOf(0, 250, 100, 250))
                .setContentIntent(openAppPendingIntent)
                .setFullScreenIntent(openAppPendingIntent, false)
                .addAction(
                    android.R.drawable.stat_sys_download,
                    "⬇️ UNDUH SEKARANG",
                    downloadPendingIntent
                )
                .addAction(
                    android.R.drawable.ic_menu_rotate,
                    "⚡ PERBARUI DI APLIKASI",
                    openAppPendingIntent
                )

            if (largeIcon != null) {
                builder.setLargeIcon(largeIcon)
            }

            notificationManager.notify(99881, builder.build())
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
