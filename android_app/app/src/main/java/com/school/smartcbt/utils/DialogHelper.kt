package com.school.smartcbt.utils

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.view.LayoutInflater
import android.view.Window
import androidx.core.content.ContextCompat
import com.school.smartcbt.R
import com.school.smartcbt.databinding.DialogAccessDeniedModernBinding

object DialogHelper {

    private var mandatoryFilesDialogInstance: Dialog? = null

    /**
     * Memeriksa apakah izin Akses Semua File (All Files Access / MANAGE_EXTERNAL_STORAGE) sudah diberikan
     */
    fun isAllFilesAccessGranted(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            val read = ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
            val write = ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
            read && write
        }
    }

    /**
     * Menampilkan NOTIFIKASI BESAR & DIALOG BLOCKING WAJIB untuk Izin Akses Semua File
     * Pengguna tidak dapat menutup dialog sebelum izin diaktifkan atau memilih keluar.
     */
    fun showMandatoryAllFilesDialog(activity: Activity) {
        if (activity.isFinishing || activity.isDestroyed) return
        if (isAllFilesAccessGranted(activity)) return

        if (mandatoryFilesDialogInstance?.isShowing == true) return

        try {
            val dialog = Dialog(activity)
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
            val dialogView = LayoutInflater.from(activity).inflate(
                R.layout.dialog_mandatory_all_files_access, null
            )
            dialog.setContentView(dialogView)
            dialog.setCancelable(false)
            dialog.setCanceledOnTouchOutside(false)

            dialog.window?.let { window ->
                window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
                window.setLayout(
                    (activity.resources.displayMetrics.widthPixels * 0.94).toInt(),
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT
                )
            }

            val btnActivate = dialogView.findViewById<android.widget.Button>(
                R.id.btnActivateAllFilesAccess
            )
            val btnExit = dialogView.findViewById<android.widget.Button>(
                R.id.btnExitApp
            )

            btnActivate?.setOnClickListener {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try {
                        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                            data = Uri.parse("package:${activity.packageName}")
                        }
                        activity.startActivity(intent)
                    } catch (e: Exception) {
                        try {
                            activity.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                        } catch (e2: Exception) {
                            try {
                                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                    data = Uri.parse("package:${activity.packageName}")
                                }
                                activity.startActivity(intent)
                            } catch (e3: Exception) {}
                        }
                    }
                } else {
                    try {
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.parse("package:${activity.packageName}")
                        }
                        activity.startActivity(intent)
                    } catch (e: Exception) {}
                }
            }

            btnExit?.setOnClickListener {
                dialog.dismiss()
                mandatoryFilesDialogInstance = null
                activity.finishAffinity()
            }

            mandatoryFilesDialogInstance = dialog
            dialog.show()
        } catch (e: Exception) {
            androidx.appcompat.app.AlertDialog.Builder(activity)
                .setTitle("📁 Izin Akses Semua File Wajib")
                .setMessage("Aplikasi Smart CBT mewajibkan izin Akses Semua File untuk integritas ujian.")
                .setCancelable(false)
                .setPositiveButton("Buka Pengaturan HP") { _, _ ->
                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:${activity.packageName}")
                    }
                    activity.startActivity(intent)
                }
                .setNegativeButton("Keluar") { _, _ -> activity.finishAffinity() }
                .show()
        }
    }

    fun dismissMandatoryAllFilesDialogIfGranted(activity: Activity): Boolean {
        if (isAllFilesAccessGranted(activity)) {
            mandatoryFilesDialogInstance?.dismiss()
            mandatoryFilesDialogInstance = null
            return true
        }
        return false
    }


    /**
     * Menampilkan popup Akses Ditolak / Terbatas modern dengan background warna & styling elegan
     */
    fun showAccessDeniedDialog(
        context: Context,
        title: String = "Akses Ditolak",
        message: String,
        subtitle: String = "Sistem Keamanan Smart School CBT",
        hint: String? = "Hubungi staf BK, wali kelas, atau operator sekolah jika merasa ini adalah kekeliruan.",
        actionText: String = "Mengerti",
        onDismiss: (() -> Unit)? = null
    ) {
        try {
            val dialog = Dialog(context)
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)

            val binding = DialogAccessDeniedModernBinding.inflate(LayoutInflater.from(context))
            dialog.setContentView(binding.root)

            dialog.window?.let { window ->
                window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
                window.setLayout(
                    (context.resources.displayMetrics.widthPixels * 0.90).toInt(),
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT
                )
            }

            binding.tvAccessDeniedTitle.text = title
            binding.tvAccessDeniedSubtitle.text = subtitle
            binding.tvAccessDeniedMessage.text = message

            if (hint.isNullOrEmpty()) {
                binding.tvAccessDeniedHint.visibility = android.view.View.GONE
            } else {
                binding.tvAccessDeniedHint.text = hint
                binding.tvAccessDeniedHint.visibility = android.view.View.VISIBLE
            }

            binding.btnAccessDeniedAction.text = actionText
            binding.btnAccessDeniedAction.setOnClickListener {
                dialog.dismiss()
                onDismiss?.invoke()
            }

            dialog.setOnCancelListener {
                onDismiss?.invoke()
            }

            dialog.show()
        } catch (e: Exception) {
            // Fallback gracefully to standard alert if dialog cannot attach to window
            androidx.appcompat.app.AlertDialog.Builder(context)
                .setTitle("⚠️ $title")
                .setMessage(message)
                .setPositiveButton(actionText) { _, _ -> onDismiss?.invoke() }
                .show()
        }
    }

    enum class HeaderTheme(val primaryColor: String, val secondaryColor: String, val icon: String) {
        UKS("#059669", "#047857", "🏥"),             // Hijau / Hijau-Teal (Kesehatan)
        PMR("#DC2626", "#991B1B", "🚑"),             // Merah / Merah-Marun (Kemanusiaan / PMR)
        GENERAL("#2563EB", "#1D4ED8", "ℹ️"),         // Biru (Notifikasi Umum)
        WARNING("#EA580C", "#C2410C", "⚠️"),         // Oranye (Peringatan)
        CRITICAL("#B91C1C", "#7F1D1D", "🚨"),        // Merah Pekat (Kritis / Urgent / Penjemputan)
        SUCCESS("#16A34A", "#15803D", "✅")          // Hijau (Selesai)
    }

    /**
     * Menampilkan NOTIFIKASI FULL SCREEN dengan HEADER MULTI-WARNA sesuai modul dan tingkat urgensi
     */
    fun showFullScreenNotificationDialog(
        context: Context,
        theme: HeaderTheme = HeaderTheme.UKS,
        badgeText: String = "NOTIFIKASI PENTING",
        title: String = "SISWA MEMBUTUHKAN PENJEMPUTAN",
        studentName: String? = null,
        className: String? = null,
        timeInfo: String? = null,
        message: String = "Siswa menunggu tindak lanjut dari orang tua/wali untuk penjemputan dari sekolah.",
        actionText: String = "LIHAT DETAIL",
        onAction: (() -> Unit)? = null,
        onDismiss: (() -> Unit)? = null
    ) {
        try {
            val dialog = Dialog(context, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            val density = context.resources.displayMetrics.density

            val root = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#F8FAFC"))
                layoutParams = android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT
                )
            }

            // 1. Header Multi-Warna Full Width
            val header = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                val headerBg = android.graphics.drawable.GradientDrawable(
                    android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                    intArrayOf(Color.parseColor(theme.primaryColor), Color.parseColor(theme.secondaryColor))
                )
                background = headerBg
                setPadding((24 * density).toInt(), (48 * density).toInt(), (24 * density).toInt(), (32 * density).toInt())
            }

            // Badge Modul / Kategori
            val tvBadge = android.widget.TextView(context).apply {
                text = "${theme.icon} $badgeText"
                textSize = 11.5f
                setTextColor(Color.WHITE)
                android.graphics.Typeface.DEFAULT_BOLD
                gravity = android.view.Gravity.CENTER
                val badgeBg = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#33FFFFFF"))
                    cornerRadius = 20 * density
                }
                background = badgeBg
                setPadding((14 * density).toInt(), (5 * density).toInt(), (14 * density).toInt(), (5 * density).toInt())
            }

            // Big Icon / Bell
            val tvBell = android.widget.TextView(context).apply {
                text = "🔔"
                textSize = 42f
                gravity = android.view.Gravity.CENTER
                setPadding(0, (14 * density).toInt(), 0, (6 * density).toInt())
            }

            // Title
            val tvTitle = android.widget.TextView(context).apply {
                text = title
                textSize = 19f
                setTextColor(Color.WHITE)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                gravity = android.view.Gravity.CENTER
            }

            header.addView(tvBadge)
            header.addView(tvBell)
            header.addView(tvTitle)
            root.addView(header)

            // 2. Body Card Content
            val body = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                setPadding((24 * density).toInt(), (28 * density).toInt(), (24 * density).toInt(), (24 * density).toInt())
                layoutParams = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    0,
                    1f
                )
            }

            if (!studentName.isNullOrEmpty()) {
                val studentCard = android.widget.LinearLayout(context).apply {
                    orientation = android.widget.LinearLayout.VERTICAL
                    gravity = android.view.Gravity.CENTER_HORIZONTAL
                    val cBg = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.WHITE)
                        setStroke((1.2f * density).toInt(), Color.parseColor("#E2E8F0"))
                        cornerRadius = 16 * density
                    }
                    background = cBg
                    setPadding((20 * density).toInt(), (16 * density).toInt(), (20 * density).toInt(), (16 * density).toInt())
                    val lp = android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        bottomMargin = (16 * density).toInt()
                    }
                    layoutParams = lp
                }

                val tvName = android.widget.TextView(context).apply {
                    text = studentName
                    textSize = 17f
                    setTextColor(Color.parseColor("#0F172A"))
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    gravity = android.view.Gravity.CENTER
                }
                studentCard.addView(tvName)

                if (!className.isNullOrEmpty()) {
                    val tvClass = android.widget.TextView(context).apply {
                        text = "Kelas $className"
                        textSize = 12.5f
                        setTextColor(Color.parseColor("#64748B"))
                        gravity = android.view.Gravity.CENTER
                        setPadding(0, (2 * density).toInt(), 0, 0)
                    }
                    studentCard.addView(tvClass)
                }

                if (!timeInfo.isNullOrEmpty()) {
                    val tvTime = android.widget.TextView(context).apply {
                        text = "Waktu: $timeInfo"
                        textSize = 11.5f
                        setTextColor(Color.parseColor(theme.primaryColor))
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                        gravity = android.view.Gravity.CENTER
                        setPadding(0, (4 * density).toInt(), 0, 0)
                    }
                    studentCard.addView(tvTime)
                }

                body.addView(studentCard)
            }

            // Message text
            val tvMsg = android.widget.TextView(context).apply {
                text = message
                textSize = 13.5f
                setTextColor(Color.parseColor("#334155"))
                gravity = android.view.Gravity.CENTER
                setLineSpacing(4 * density, 1f)
                val lp = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (24 * density).toInt()
                }
                layoutParams = lp
            }
            body.addView(tvMsg)
            root.addView(body)

            // 3. Bottom Action Bar
            val bottomBar = android.widget.LinearLayout(context).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setPadding((24 * density).toInt(), (12 * density).toInt(), (24 * density).toInt(), (24 * density).toInt())
                setBackgroundColor(Color.WHITE)
            }

            var actionExecuted = false
            val btnAction = android.widget.Button(context).apply {
                text = actionText
                textSize = 13.5f
                setTextColor(Color.WHITE)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                val btnBg = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(theme.primaryColor))
                    cornerRadius = 14 * density
                }
                background = btnBg
                val lp = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    (48 * density).toInt()
                )
                layoutParams = lp
                setOnClickListener {
                    actionExecuted = true
                    dialog.dismiss()
                    onAction?.invoke()
                }
            }

            val btnClose = android.widget.TextView(context).apply {
                text = "Tutup Notifikasi"
                textSize = 12f
                setTextColor(Color.parseColor("#94A3B8"))
                gravity = android.view.Gravity.CENTER
                setPadding(0, (12 * density).toInt(), 0, 0)
                setOnClickListener { dialog.dismiss() }
            }

            bottomBar.addView(btnAction)
            bottomBar.addView(btnClose)
            root.addView(bottomBar)

            dialog.setOnDismissListener {
                if (!actionExecuted) {
                    onDismiss?.invoke()
                }
            }

            dialog.setContentView(root)
            dialog.show()
        } catch (e: Exception) {
            var actionExecuted = false
            androidx.appcompat.app.AlertDialog.Builder(context)
                .setTitle("🔔 $title")
                .setMessage(message)
                .setPositiveButton(actionText) { _, _ ->
                    actionExecuted = true
                    onAction?.invoke()
                }
                .setNegativeButton("Tutup") { _, _ ->
                    onDismiss?.invoke()
                }
                .setOnDismissListener {
                    if (!actionExecuted) {
                        onDismiss?.invoke()
                    }
                }
                .show()
        }
    }

    /**
     * Otomatis sinkronisasi teks footer versi Smart CBT di semua layar aplikasi
     */
    fun applyDynamicFooter(activity: Activity) {
        try {
            val tvFooter = activity.findViewById<android.widget.TextView>(com.school.smartcbt.R.id.tvFooter)
            if (tvFooter != null) {
                tvFooter.text = "Smart CBT v${com.school.smartcbt.BuildConfig.VERSION_NAME} • SMP Negeri 1 Boyolangu"
            }
        } catch (e: Exception) {}
    }
}
