package com.school.smartcbt.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.widget.RemoteViews
import com.school.smartcbt.R
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.ui.LoginActivity
import com.school.smartcbt.ui.ParentMainActivity
import com.school.smartcbt.utils.SessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ParentAttendanceWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH_PARENT_WIDGET = "com.school.smartcbt.widget.REFRESH_PARENT_WIDGET"
        private val job = SupervisorJob()
        private val widgetScope = CoroutineScope(Dispatchers.IO + job)
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH_PARENT_WIDGET) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val thisWidget = ComponentName(context, ParentAttendanceWidgetProvider::class.java)
            val allWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget)
            for (widgetId in allWidgetIds) {
                updateAppWidget(context, appWidgetManager, widgetId)
            }
        }
    }

    private fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_parent_attendance)

        // 1. PendingIntent: Buka ParentMainActivity saat widget diketuk
        val sessionManager = SessionManager(context)
        val openIntent = if (sessionManager.isLoggedIn()) {
            Intent(context, ParentMainActivity::class.java)
        } else {
            Intent(context, LoginActivity::class.java)
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingOpen = PendingIntent.getActivity(context, 0, openIntent, flags)
        views.setOnClickPendingIntent(R.id.layoutWidgetRoot, pendingOpen)

        // 2. PendingIntent: Tombol Refresh 🔄
        val refreshIntent = Intent(context, ParentAttendanceWidgetProvider::class.java).apply {
            action = ACTION_REFRESH_PARENT_WIDGET
        }
        val pendingRefresh = PendingIntent.getBroadcast(context, 101, refreshIntent, flags)
        views.setOnClickPendingIntent(R.id.btnWidgetRefresh, pendingRefresh)

        if (!sessionManager.isLoggedIn()) {
            views.setTextViewText(R.id.tvWidgetStudentName, "Silakan Login Akun Ortu")
            views.setTextViewText(R.id.tvWidgetStudentClass, "Ketuk widget untuk masuk")
            views.setTextViewText(R.id.tvWidgetFooterNotice, "Belum ada sesi login aktif")
            appWidgetManager.updateAppWidget(appWidgetId, views)
            return
        }

        // Tampilkan indikator memuat sementara
        views.setTextViewText(R.id.tvWidgetFooterNotice, "Memperbarui dari Portal...")
        appWidgetManager.partiallyUpdateAppWidget(appWidgetId, views)

        // 3. Ambil data real-time langsung dari Portal (tanpa data dummy!)
        widgetScope.launch {
            try {
                val response = ApiClient.getClient(context).getParentDashboard().execute()
                val nowTimeStr = SimpleDateFormat("HH:mm", Locale("id", "ID")).format(Date())

                withContext(Dispatchers.Main) {
                    if (response.isSuccessful && response.body() != null) {
                        val body = response.body()!!
                        val childName = body.child?.name ?: sessionManager.getName()
                        val className = body.child?.className ?: "-"

                        views.setTextViewText(R.id.tvWidgetStudentName, childName)
                        views.setTextViewText(R.id.tvWidgetStudentClass, "Kelas $className • SMPN 1 Boyolangu")

                        // 1. Presensi Gerbang Masuk
                        val gateIn = body.todayAttendance?.gateInTime
                        if (!gateIn.isNullOrEmpty() && gateIn != "-") {
                            views.setTextViewText(R.id.tvWidgetGateInTime, gateIn)
                            views.setTextColor(R.id.tvWidgetGateInTime, Color.parseColor("#059669"))
                            views.setTextViewText(R.id.tvWidgetGateInStatus, "Tercatat Masuk")
                            views.setTextColor(R.id.tvWidgetGateInStatus, Color.parseColor("#047857"))
                        } else {
                            views.setTextViewText(R.id.tvWidgetGateInTime, "--:--")
                            views.setTextColor(R.id.tvWidgetGateInTime, Color.parseColor("#94A3B8"))
                            views.setTextViewText(R.id.tvWidgetGateInStatus, "Menunggu")
                            views.setTextColor(R.id.tvWidgetGateInStatus, Color.parseColor("#64748B"))
                        }

                        // 2. Presensi Sholat Mushola (DITENTUKAN JADWAL REAL PORTAL)
                        val prayerNotice = body.todayPrayerNotice
                        val hasSchedule = prayerNotice?.hasScheduleToday == true
                        val prayerTitle = if (hasSchedule) (prayerNotice?.prayerTitle ?: "🕌 Sholat") else "🕌 Mushola"
                        views.setTextViewText(R.id.tvWidgetPrayerTitle, prayerTitle)

                        if (hasSchedule) {
                            val scanTime = prayerNotice?.scanTime
                            val statusLabel = prayerNotice?.studentStatusLabel ?: "Terjadwal"
                            if (!scanTime.isNullOrEmpty() && scanTime != "-") {
                                views.setTextViewText(R.id.tvWidgetPrayerScanTime, scanTime)
                                views.setTextColor(R.id.tvWidgetPrayerScanTime, Color.parseColor("#0D9488"))
                                views.setTextViewText(R.id.tvWidgetPrayerStatus, statusLabel)
                                views.setTextColor(R.id.tvWidgetPrayerStatus, Color.parseColor("#047857"))
                            } else {
                                views.setTextViewText(R.id.tvWidgetPrayerScanTime, prayerNotice?.scheduleTime ?: "Siang")
                                views.setTextColor(R.id.tvWidgetPrayerScanTime, Color.parseColor("#D97706"))
                                views.setTextViewText(R.id.tvWidgetPrayerStatus, "⏳ Belum Scan")
                                views.setTextColor(R.id.tvWidgetPrayerStatus, Color.parseColor("#B45309"))
                            }
                        } else {
                            views.setTextViewText(R.id.tvWidgetPrayerScanTime, "Tidak Ada")
                            views.setTextColor(R.id.tvWidgetPrayerScanTime, Color.parseColor("#94A3B8"))
                            views.setTextViewText(R.id.tvWidgetPrayerStatus, "Tidak Ada Jadwal")
                            views.setTextColor(R.id.tvWidgetPrayerStatus, Color.parseColor("#64748B"))
                        }

                        // 3. Presensi Gerbang Pulang
                        val gateOut = body.todayAttendance?.gateOutTime
                        if (!gateOut.isNullOrEmpty() && gateOut != "-") {
                            views.setTextViewText(R.id.tvWidgetGateOutTime, gateOut)
                            views.setTextColor(R.id.tvWidgetGateOutTime, Color.parseColor("#2563EB"))
                            views.setTextViewText(R.id.tvWidgetGateOutStatus, "Telah Pulang")
                            views.setTextColor(R.id.tvWidgetGateOutStatus, Color.parseColor("#1D4ED8"))
                        } else {
                            views.setTextViewText(R.id.tvWidgetGateOutTime, "--:--")
                            views.setTextColor(R.id.tvWidgetGateOutTime, Color.parseColor("#94A3B8"))
                            views.setTextViewText(R.id.tvWidgetGateOutStatus, "Belum Pulang")
                            views.setTextColor(R.id.tvWidgetGateOutStatus, Color.parseColor("#64748B"))
                        }

                        views.setTextViewText(R.id.tvWidgetFooterNotice, "Sinkron Portal: $nowTimeStr WIB • Ketuk untuk Buka")
                    } else {
                        views.setTextViewText(R.id.tvWidgetFooterNotice, "Gagal sinkron portal (${response.code()}) • Ketuk refresh")
                    }
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    views.setTextViewText(R.id.tvWidgetFooterNotice, "Koneksi portal terputus • Ketuk refresh")
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                }
            }
        }
    }
}
