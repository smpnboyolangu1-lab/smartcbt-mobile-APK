package com.school.smartcbt.services

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.school.smartcbt.MainActivity
import com.school.smartcbt.R
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class MyFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FCM_Service"
        const val CHANNEL_ID = "smartcbt_urgent_alerts"
        const val CHANNEL_NAME = "Notifikasi Resmi Sekolah (SmartCBT)"
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.i(TAG, "New FCM Token received: $token")
        sendRegistrationToServer(token)
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "From: ${remoteMessage.from}")

        // 1. Ambil data payload / notification payload
        val title = remoteMessage.notification?.title 
            ?: remoteMessage.data["title"] 
            ?: "SMPN 1 Boyolangu"
        val body = remoteMessage.notification?.body 
            ?: remoteMessage.data["body"] 
            ?: remoteMessage.data["message"]
            ?: "Ada informasi baru dari sekolah."

        // 2. Tampilkan Heads-Up Notification seperti WhatsApp
        showNotification(title, body, remoteMessage.data)

        // 3. Siarkan event realtime agar dashboard orang tua, kalender, dan siswa langsung menyegarkan diri
        try {
            val localBroadcast = Intent("com.school.smartcbt.ATTENDANCE_UPDATED")
            for ((k, v) in remoteMessage.data) {
                localBroadcast.putExtra(k, v)
            }
            sendBroadcast(localBroadcast)
        } catch (e: Exception) {}
    }

    private fun showNotification(title: String, messageBody: String, data: Map<String, String>) {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            for ((k, v) in data) {
                putExtra(k, v)
            }
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            (System.currentTimeMillis() % 10000).toInt(),
            intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )

        val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Notification Channel untuk Android Oreo 8.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val audioAttributes = android.media.AudioAttributes.Builder()
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                .build()

            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifikasi darurat, presensi, izin, dan pengumuman sekolah"
                enableLights(true)
                lightColor = Color.GREEN
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 150, 250)
                setSound(defaultSoundUri, audioAttributes)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                setShowBadge(true)
            }
            notificationManager.createNotificationChannel(channel)
        }

        val notificationBuilder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher))
            .setContentTitle(title)
            .setContentText(messageBody)
            .setStyle(NotificationCompat.BigTextStyle().bigText(messageBody))
            .setAutoCancel(true)
            .setSound(defaultSoundUri)
            .setVibrate(longArrayOf(0, 250, 150, 250))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setColor(Color.parseColor("#0F766E"))
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, false)

        val notificationId = (System.currentTimeMillis() % 100000).toInt()
        notificationManager.notify(notificationId, notificationBuilder.build())
    }

    private fun sendRegistrationToServer(token: String) {
        try {
            com.school.smartcbt.utils.FcmHelper.syncFcmToken(applicationContext)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to sync FCM token: ${e.message}")
        }
    }
}
