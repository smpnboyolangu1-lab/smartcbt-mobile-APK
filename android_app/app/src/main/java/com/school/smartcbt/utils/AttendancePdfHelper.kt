package com.school.smartcbt.utils

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.Gravity
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import com.school.smartcbt.data.remote.ApiClient
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object AttendancePdfHelper {

    /**
     * Membangun URL otentikasi ekspor PDF presensi resmi
     */
    fun buildExportUrl(
        context: Context,
        className: String? = null,
        scope: String? = null,
        tingkat: String? = null
    ): String? {
        val session = SessionManager(context)
        val token = session.getToken()
        if (token.isNullOrBlank()) {
            Toast.makeText(context, "Sesi login tidak valid. Harap login ulang.", Toast.LENGTH_SHORT).show()
            return null
        }

        val baseUrl = ApiClient.getBaseServerUrl(context).trimEnd('/')
        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        var exportUrl = "$baseUrl/api/attendance/export-pdf?token=${Uri.encode(token)}&date=$todayStr"

        if (!className.isNullOrBlank() && className != "ALL") {
            exportUrl += "&className=${Uri.encode(className)}&scope=CLASS"
        } else if (!tingkat.isNullOrBlank() && tingkat != "ALL") {
            exportUrl += "&tingkat=${Uri.encode(tingkat)}&scope=LEVEL"
        } else if (!scope.isNullOrBlank() && scope != "ALL") {
            exportUrl += "&scope=${Uri.encode(scope)}"
        } else {
            exportUrl += "&scope=ALL"
        }
        return exportUrl
    }

    /**
     * Dialog interaktif untuk Guru, Wali Kelas, Operator, dan BK
     * Memungkinkan Cetak/Simpan PDF langsung (PrintManager Android), buka di browser, atau unduh ke perangkat.
     */
    fun showDownloadPdfDialog(
        activity: Activity,
        defaultClassName: String? = null,
        title: String = "Laporan Rekap Presensi Siswa",
        scope: String? = null,
        tingkat: String? = null
    ) {
        val session = SessionManager(activity)
        val targetClass = defaultClassName ?: session.getClassName().ifEmpty { null }
        val exportUrl = buildExportUrl(activity, targetClass, scope, tingkat) ?: return
        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        val displayDate = SimpleDateFormat("dd MMMM yyyy", Locale("id", "ID")).format(Date())

        val classLabel = if (!targetClass.isNullOrBlank() && targetClass != "ALL") {
            "Kelas $targetClass"
        } else if (!tingkat.isNullOrBlank() && tingkat != "ALL") {
            "Tingkat Kelas $tingkat"
        } else {
            "Seluruh Rombel Sekolah"
        }

        val density = activity.resources.displayMetrics.density

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val tvTitle = TextView(activity).apply {
            text = "📄 $title"
            textSize = 17f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.parseColor("#0F172A"))
        }
        root.addView(tvTitle)

        val tvSub = TextView(activity).apply {
            text = "Target: $classLabel\nTanggal: $displayDate\nFormat: Dokumen Laporan Resmi A4 Sesuai Portal Sekolah"
            textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#475569"))
            setPadding(0, (6 * density).toInt(), 0, (16 * density).toInt())
            setLineSpacing(3f, 1f)
        }
        root.addView(tvSub)

        var dialog: AlertDialog? = null

        // Pilihan 1: Cetak & Simpan PDF Langsung (Native Android PrintManager)
        val btnPrint = android.widget.Button(activity).apply {
            text = "🖨️ Cetak / Simpan PDF (Sistem Android)"
            textSize = 12.5f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.WHITE)
            setBackgroundColor(android.graphics.Color.parseColor("#0284C7")) // Sky-600
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (46 * density).toInt()
            ).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                printViaWebView(activity, exportUrl + "&autoprint=false", targetClass ?: tingkat ?: scope, todayStr)
            }
        }
        root.addView(btnPrint)

        // Pilihan 2: Buka & Unduh via Browser
        val btnBrowser = android.widget.Button(activity).apply {
            text = "🌐 Buka / Unduh di Browser HP"
            textSize = 12.5f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.WHITE)
            setBackgroundColor(android.graphics.Color.parseColor("#15803D")) // Green-700
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (46 * density).toInt()
            ).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                try {
                    val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(exportUrl)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    activity.startActivity(browserIntent)
                } catch (e: Exception) {
                    Toast.makeText(activity, "Gagal membuka browser: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
        root.addView(btnBrowser)

        // Pilihan 3: Unduh Berkas Langsung via DownloadManager
        val btnDownload = android.widget.Button(activity).apply {
            text = "📥 Unduh Berkas ke Folder Download"
            textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#475569"))
            setBackgroundColor(android.graphics.Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (42 * density).toInt()
            )
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                enqueueDownloadManager(activity, exportUrl, targetClass ?: tingkat ?: scope, todayStr)
            }
        }
        root.addView(btnDownload)

        dialog = AlertDialog.Builder(activity)
            .setView(root)
            .setNegativeButton("Tutup", null)
            .create()

        dialog.show()
    }

    /**
     * Cetak dokumen PDF langsung menggunakan Android PrintManager
     */
    fun printPdfDirectly(
        activity: Activity,
        className: String? = null,
        scope: String? = null,
        tingkat: String? = null
    ) {
        val url = buildExportUrl(activity, className, scope, tingkat) ?: return
        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        printViaWebView(activity, url + "&autoprint=false", className ?: tingkat ?: scope, todayStr)
    }

    /**
     * Buka dokumen PDF di web browser perangkat
     */
    fun openBrowserDirectly(
        activity: Activity,
        className: String? = null,
        scope: String? = null,
        tingkat: String? = null
    ) {
        val url = buildExportUrl(activity, className, scope, tingkat) ?: return
        try {
            val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(browserIntent)
        } catch (e: Exception) {
            Toast.makeText(activity, "Gagal membuka browser: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Membuka PrintManager bawaan Android menggunakan WebView untuk mencetak / menyimpan PDF A4
     */
    private fun printViaWebView(activity: Activity, url: String, className: String?, dateStr: String) {
        val toast = Toast.makeText(activity, "⏳ Menyiapkan dokumen PDF resmi...", Toast.LENGTH_SHORT)
        toast.show()

        val webView = WebView(activity)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, loadedUrl: String?) {
                super.onPageFinished(view, loadedUrl)
                try {
                    val printManager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
                    if (printManager != null) {
                        val safeClass = (className ?: "Semua_Kelas").replace("\\s+".toRegex(), "_")
                        val jobName = "Laporan_Presensi_${safeClass}_$dateStr"
                        val printAdapter = webView.createPrintDocumentAdapter(jobName)
                        val printAttributes = PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build()

                        printManager.print(jobName, printAdapter, printAttributes)
                    } else {
                        Toast.makeText(activity, "Fitur cetak dokumen tidak didukung pada perangkat ini.", Toast.LENGTH_SHORT).show()
                    }
                } catch (e: Exception) {
                    Toast.makeText(activity, "Gagal memproses cetak: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                super.onReceivedError(view, errorCode, description, failingUrl)
                Toast.makeText(activity, "Gagal memuat dokumen dari server: $description", Toast.LENGTH_SHORT).show()
            }
        }

        webView.loadUrl(url)
    }

    /**
     * Mengunduh berkas laporan via DownloadManager Android
     */
    private fun enqueueDownloadManager(context: Context, url: String, className: String?, dateStr: String) {
        try {
            val safeClass = (className ?: "Semua_Kelas").replace("\\s+".toRegex(), "_")
            val fileName = "Laporan_Presensi_${safeClass}_$dateStr.html"

            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle("Laporan Presensi SMPN 1 Boyolangu")
                setDescription("Mengunduh laporan rekapitulasi presensi...")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI or DownloadManager.Request.NETWORK_MOBILE)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(true)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                setMimeType("text/html")
            }

            val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
            manager?.enqueue(request)

            Toast.makeText(context, "📥 Berkas sedang diunduh ke folder Download ($fileName)", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(context, "Gagal mengunduh: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Dialog interaktif untuk Cetak/Unduh Rekap Presensi Sholat Berjamaah & Keputrian
     */
    fun showPrayerPdfDialog(
        activity: Activity,
        className: String,
        date: String? = null,
        prayerType: String = "DHUHUR"
    ) {
        val session = SessionManager(activity)
        val serverUrl = ApiClient.getBaseServerUrl(activity).trimEnd('/')
        val token = session.getToken() ?: ""
        val targetDate = date ?: SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        val displayDate = SimpleDateFormat("dd MMMM yyyy", Locale("id", "ID")).format(Date())

        val exportUrl = "$serverUrl/api/prayer/export-pdf?className=${Uri.encode(className)}&date=${Uri.encode(targetDate)}&prayerType=${Uri.encode(prayerType)}&token=${Uri.encode(token)}"

        val isAllClasses = className.equals("ALL", ignoreCase = true) || className.equals("Semua Kelas", ignoreCase = true)
        val titleText = if (isAllClasses) "Rekap Sholat Berjamaah Seluruh Kelas" else "🕌 Cetak Rekap Sholat Berjamaah"
        val classLabel = if (isAllClasses) "Seluruh Kelas" else "Kelas $className"

        val density = activity.resources.displayMetrics.density

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val tvTitle = TextView(activity).apply {
            text = titleText
            textSize = 17f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.parseColor("#0F172A"))
        }
        root.addView(tvTitle)

        val tvSub = TextView(activity).apply {
            text = "Rombel: $classLabel\nTanggal: $displayDate\nIbadah: Sholat $prayerType Berjamaah\nFormat: Dokumen Resmi A4 Ber-Kop & Bertandatangan Digital"
            textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#475569"))
            setPadding(0, (6 * density).toInt(), 0, (16 * density).toInt())
            setLineSpacing(3f, 1f)
        }
        root.addView(tvSub)

        var dialog: AlertDialog? = null

        // Pilihan 1: Cetak & Simpan PDF Langsung (Native Android PrintManager)
        val btnPrint = Button(activity).apply {
            text = "🖨️ Cetak / Simpan PDF (Sistem Android)"
            textSize = 12.5f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.WHITE)
            setBackgroundColor(android.graphics.Color.parseColor("#059669"))
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (48 * density).toInt()
            ).apply {
                bottomMargin = (10 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                val jobName = if (isAllClasses) "Rekap_Sholat_Semua_Kelas" else "Rekap_Sholat_$className"
                printViaWebView(activity, exportUrl + "&autoprint=false", jobName, targetDate)
            }
        }
        root.addView(btnPrint)

        // Pilihan 2: Buka di Browser Luar
        val btnBrowser = Button(activity).apply {
            text = "🌐 Buka di Browser Luar (Chrome / Edge)"
            textSize = 12.5f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.parseColor("#1E293B"))
            setBackgroundColor(android.graphics.Color.parseColor("#E2E8F0"))
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (48 * density).toInt()
            ).apply {
                bottomMargin = (10 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(exportUrl))
                    activity.startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(activity, "Tidak dapat membuka browser: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
        root.addView(btnBrowser)

        // Pilihan 3: Unduh Berkas
        val btnDownload = Button(activity).apply {
            text = "📥 Unduh Berkas ke Perangkat"
            textSize = 12.5f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.parseColor("#1E293B"))
            setBackgroundColor(android.graphics.Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (48 * density).toInt()
            )
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                val fileName = "Rekap_Sholat_${className}_${targetDate}.pdf"
                try {
                    val request = DownloadManager.Request(Uri.parse(exportUrl)).apply {
                        setTitle("Rekap Sholat Berjamaah")
                        setDescription("Mengunduh $fileName...")
                        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI or DownloadManager.Request.NETWORK_MOBILE)
                        setAllowedOverMetered(true)
                        setAllowedOverRoaming(true)
                        setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                        setMimeType("application/pdf")
                    }
                    val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
                    manager?.enqueue(request)
                    Toast.makeText(activity, "📥 Berkas sedang diunduh ke folder Download ($fileName)", Toast.LENGTH_LONG).show()
                } catch (e: Exception) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(exportUrl))
                        activity.startActivity(intent)
                    } catch (ex: Exception) {
                        Toast.makeText(activity, "Gagal mengunduh berkas: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
        root.addView(btnDownload)

        dialog = AlertDialog.Builder(activity)
            .setView(root)
            .setNegativeButton("Tutup", null)
            .create()
        dialog.show()
    }
}
