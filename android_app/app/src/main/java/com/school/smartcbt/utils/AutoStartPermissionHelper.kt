package com.school.smartcbt.utils

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog

object AutoStartPermissionHelper {

    private const val TAG = "AutoStartHelper"
    private const val PREF_KEY_BATTERY_PROMPTED = "pref_battery_opt_prompted_v2"
    private const val PREF_KEY_AUTOSTART_PROMPTED = "pref_autostart_prompted_v2"

    /**
     * Memeriksa dan memandu siswa/guru untuk mengabaikan penghemat baterai (Doze Mode)
     * dan mengizinkan Mulai Otomatis (Auto-start) pada HP Xiaomi, OPPO, Vivo, Realme, Infinix.
     */
    fun checkAndPromptBackgroundExecution(activity: Activity) {
        try {
            val prefs = activity.getSharedPreferences("smartcbt_system_prefs", Context.MODE_PRIVATE)

            // 1. Cek Penghemat Baterai (Battery Optimization)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val pm = activity.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val isIgnoring = pm?.isIgnoringBatteryOptimizations(activity.packageName) == true

                if (!isIgnoring && !prefs.getBoolean(PREF_KEY_BATTERY_PROMPTED, false)) {
                    showBatteryOptimizationDialog(activity) {
                        prefs.edit().putBoolean(PREF_KEY_BATTERY_PROMPTED, true).apply()
                        // Lanjutkan cek autostart setelah baterai
                        checkAutoStartOem(activity)
                    }
                    return
                }
            }

            // 2. Cek OEM Auto-start jika baterai sudah pernah dicek
            checkAutoStartOem(activity)
        } catch (e: Exception) {
            Log.w(TAG, "checkAndPromptBackgroundExecution error: ${e.message}")
        }
    }

    private fun checkAutoStartOem(activity: Activity) {
        val prefs = activity.getSharedPreferences("smartcbt_system_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean(PREF_KEY_AUTOSTART_PROMPTED, false)) return

        val brand = Build.MANUFACTURER.lowercase()
        val isOemTarget = brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco") ||
                brand.contains("oppo") || brand.contains("realme") || brand.contains("vivo") ||
                brand.contains("infinix") || brand.contains("tecno") || brand.contains("huawei")

        if (isOemTarget) {
            showAutoStartDialog(activity, brand) {
                prefs.edit().putBoolean(PREF_KEY_AUTOSTART_PROMPTED, true).apply()
            }
        }
    }

    private fun showBatteryOptimizationDialog(activity: Activity, onDismiss: () -> Unit) {
        val density = activity.resources.displayMetrics.density
        val dialog = AlertDialog.Builder(activity).create()

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 20 * density
            }
            val p = (20 * density).toInt()
            setPadding(p, p, p, p)
        }

        val tvTitle = TextView(activity).apply {
            text = "⚡ Optimalkan Sinkronisasi 24 Jam"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 17f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        root.addView(tvTitle)

        val tvDesc = TextView(activity).apply {
            text = "Agar presensi gerbang, telemetri HP, dan notifikasi jadwal sekolah tetap aktif saat aplikasi ditutup, izinkan Smart School berjalan 'Tanpa Pembatasan Baterai'."
            setTextColor(Color.parseColor("#475569"))
            textSize = 12.5f
            setPadding(0, (8 * density).toInt(), 0, (18 * density).toInt())
            setLineSpacing(3f, 1.1f)
        }
        root.addView(tvDesc)

        val btnAllow = Button(activity).apply {
            text = "Izinkan Tanpa Batasan"
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0F766E"))
                cornerRadius = 12 * density
            }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                bottomMargin = (8 * density).toInt()
            }
            setOnClickListener {
                dialog.dismiss()
                onDismiss()
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                            data = Uri.parse("package:${activity.packageName}")
                        }
                        activity.startActivity(intent)
                    }
                } catch (e: Exception) {
                    try {
                        val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                        activity.startActivity(fallback)
                    } catch (ex: Exception) {}
                }
            }
        }
        root.addView(btnAllow)

        val btnLater = Button(activity).apply {
            text = "Nanti Saja"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            background = ColorDrawable(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (38 * density).toInt())
            setOnClickListener {
                dialog.dismiss()
                onDismiss()
            }
        }
        root.addView(btnLater)

        dialog.setView(root)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.show()
    }

    private fun showAutoStartDialog(activity: Activity, brand: String, onDismiss: () -> Unit) {
        val density = activity.resources.displayMetrics.density
        val dialog = AlertDialog.Builder(activity).create()

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 20 * density
            }
            val p = (20 * density).toInt()
            setPadding(p, p, p, p)
        }

        val brandName = brand.replaceFirstChar { it.uppercase() }
        val tvTitle = TextView(activity).apply {
            text = "🚀 Izin Mulai Otomatis ($brandName)"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 17f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        root.addView(tvTitle)

        val tvDesc = TextView(activity).apply {
            text = "Pada perangkat $brandName, sistem HP secara default mematikan aplikasi saat layar mati. Aktifkan toggle 'Mulai Otomatis' agar sistem sekolah tetap tersinkronisasi."
            setTextColor(Color.parseColor("#475569"))
            textSize = 12.5f
            setPadding(0, (8 * density).toInt(), 0, (18 * density).toInt())
            setLineSpacing(3f, 1.1f)
        }
        root.addView(tvDesc)

        val btnOpenSettings = Button(activity).apply {
            text = "Buka Pengaturan $brandName"
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#2563EB"))
                cornerRadius = 12 * density
            }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                bottomMargin = (8 * density).toInt()
            }
            setOnClickListener {
                dialog.dismiss()
                onDismiss()
                openOemAutoStartSettings(activity, brand)
            }
        }
        root.addView(btnOpenSettings)

        val btnLater = Button(activity).apply {
            text = "Lewati"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            background = ColorDrawable(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (38 * density).toInt())
            setOnClickListener {
                dialog.dismiss()
                onDismiss()
            }
        }
        root.addView(btnLater)

        dialog.setView(root)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.show()
    }

    private fun openOemAutoStartSettings(context: Context, brand: String) {
        val intents = mutableListOf<Intent>()

        when {
            brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco") -> {
                intents.add(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
                intents.add(Intent("miui.intent.action.OP_AUTO_START").addCategory(Intent.CATEGORY_DEFAULT))
            }
            brand.contains("oppo") || brand.contains("realme") -> {
                intents.add(Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
                intents.add(Intent().setComponent(ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")))
                intents.add(Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")))
            }
            brand.contains("vivo") -> {
                intents.add(Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.PurviewTabActivity")))
                intents.add(Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")))
                intents.add(Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.MainGuideActivity")))
            }
            brand.contains("infinix") || brand.contains("tecno") -> {
                intents.add(Intent().setComponent(ComponentName("com.transsion.phonemanager", "com.transsion.phonemanager.settings.view.AutoStartListActivity")))
                intents.add(Intent().setComponent(ComponentName("com.transsion.phonemanager", "com.transsion.phonemanager.manage.AutoStartActivity")))
            }
            brand.contains("huawei") -> {
                intents.add(Intent().setComponent(ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")))
                intents.add(Intent().setComponent(ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity")))
            }
        }

        // Standard App Details as Fallback
        intents.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${context.packageName}")
        })

        for (intent in intents) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                return
            } catch (e: Exception) {
                // Try next intent
            }
        }
    }
}
