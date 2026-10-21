package com.school.smartcbt.ui

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.cardview.widget.CardView
import com.school.smartcbt.data.model.GenericTppActionResponse
import com.school.smartcbt.data.model.KurikulumTppMonitoringResponse
import com.school.smartcbt.data.model.MyTppResponse
import com.school.smartcbt.data.model.TppRecordDto
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.text.SimpleDateFormat
import java.util.*

/**
 * Helper Khusus Layanan & Monitoring TPP Guru (Tambahan Penghasilan Pegawai)
 * Dilengkapi dengan kartu ber-Header Warna (tidak polosan) sesuai standar estetika SIBOY 2026.
 */
object TeacherTppHelper {

    data class StatusTheme(
        val label: String,
        val headerColor: String,
        val badgeTextColor: String,
        val badgeBgColor: String,
        val icon: String
    )

    fun getStatusTheme(status: String): StatusTheme {
        val isCair = status.uppercase() == "SUDAH_CAIR"
        return if (isCair) {
            StatusTheme(
                label = "SUDAH CAIR (Terkunci)",
                headerColor = "#059669", // Emerald Green (#059669)
                badgeTextColor = "#065F46",
                badgeBgColor = "#D1FAE5",
                icon = "🔒"
            )
        } else {
            StatusTheme(
                label = "BELUM CAIR",
                headerColor = "#EA580C", // Vivid Warm Orange-Amber (#EA580C)
                badgeTextColor = "#9A3412",
                badgeBgColor = "#FFEDD5",
                icon = "⏳"
            )
        }
    }

    /**
     * Dialog Cek TPP Mandiri untuk Guru (Tampilan Triwulan & Bulanan dengan Header Berwarna)
     */
    fun showMyTppDialog(activity: TeacherMainActivity) {
        val dialog = AlertDialog.Builder(activity, android.R.style.Theme_Light_NoTitleBar_Fullscreen).create()
        val density = activity.resources.displayMetrics.density

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        var currentYear = Calendar.getInstance().get(Calendar.YEAR)
        var viewMode = "TRIWULAN" // "TRIWULAN" atau "BULANAN"
        var selectedTw = 1 // Default Triwulan 1 (klik TW 1 -> tampil bulan Jan-Mar)

        // 1. HEADER DIALOG UTAMA (Gradien Biru Tua Elegan)
        val headerCard = CardView(activity).apply {
            radius = 0f
            cardElevation = 4f * density
            setCardBackgroundColor(Color.parseColor("#1E3A8A"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val headerInner = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val btnBack = TextView(activity).apply {
            text = "✕"
            textSize = 20f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val bp = (8 * density).toInt()
            setPadding(0, 0, bp, 0)
            setOnClickListener { dialog.dismiss() }
        }
        headerInner.addView(btnBack)

        val headerTextLayout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        headerTextLayout.addView(TextView(activity).apply {
            text = "💰 Layanan TPP Guru"
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        headerTextLayout.addView(TextView(activity).apply {
            text = "Pengecekan Status Pencairan & Laporan Triwulan • SMPN 1 Boyolangu"
            textSize = 11f
            setTextColor(Color.parseColor("#BFDBFE"))
            setPadding(0, 2, 0, 0)
        })
        headerInner.addView(headerTextLayout)

        val btnRefresh = TextView(activity).apply {
            text = "🔄"
            textSize = 18f
            setTextColor(Color.WHITE)
            val rp = (6 * density).toInt()
            setPadding(rp, rp, rp, rp)
        }
        headerInner.addView(btnRefresh)
        headerCard.addView(headerInner)
        root.addView(headerCard)

        val scrollContent = ScrollView(activity).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        val dynamicContainer = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
        }
        contentInner.addView(dynamicContainer)

        fun loadTppData(year: Int) {
            dynamicContainer.removeAllViews()

            // Loading layout
            val loadingLayout = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(20, 60, 20, 60)
                addView(ProgressBar(activity))
                addView(TextView(activity).apply {
                    text = "Memuat data TPP dari server sekolah..."
                    textSize = 12.5f
                    setTextColor(Color.parseColor("#64748B"))
                    setPadding(0, 12, 0, 0)
                })
            }
            dynamicContainer.addView(loadingLayout)

            ApiClient.getClient(activity).getMyTpp(year).enqueue(object : Callback<MyTppResponse> {
                override fun onResponse(call: Call<MyTppResponse>, response: Response<MyTppResponse>) {
                    dynamicContainer.removeAllViews()
                    val data = response.body()
                    if (!response.isSuccessful || data == null || !data.success) {
                        dynamicContainer.addView(TextView(activity).apply {
                            text = "❌ Gagal memuat data: ${data?.message ?: "Terjadi kesalahan server"}"
                            textSize = 13f
                            setTextColor(Color.parseColor("#DC2626"))
                            gravity = Gravity.CENTER
                            setPadding(20, 40, 20, 40)
                        })
                        return
                    }

                    // 1. FILTER TAHUN & TOGGLE VIEW MODE
                    val controlRow = LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (12 * density).toInt()
                        }
                    }

                    val chipYear = TextView(activity).apply {
                        text = "📅 Tahun: $year ▾"
                        textSize = 11.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#1E293B"))
                        background = GradientDrawable().apply {
                            setColor(Color.WHITE)
                            setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                            cornerRadius = 10f * density
                        }
                        val p = (12 * density).toInt()
                        setPadding(p, (7 * density).toInt(), p, (7 * density).toInt())
                        setOnClickListener {
                            val years = arrayOf("${year - 1}", "$year", "${year + 1}")
                            AlertDialog.Builder(activity)
                                .setTitle("Pilih Tahun Anggaran")
                                .setItems(years) { _, which ->
                                    val y = years[which].toIntOrNull() ?: year
                                    currentYear = y
                                    loadTppData(y)
                                }
                                .show()
                        }
                    }
                    controlRow.addView(chipYear)

                    val spacer = View(activity).apply {
                        layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
                    }
                    controlRow.addView(spacer)

                    val btnToggle = TextView(activity).apply {
                        text = if (viewMode == "TRIWULAN") "Mode: 📅 Triwulan ▾" else "Mode: 📋 Bulanan ▾"
                        textSize = 11.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#2563EB"))
                        background = GradientDrawable().apply {
                            setColor(Color.parseColor("#EFF6FF"))
                            setStroke((1 * density).toInt(), Color.parseColor("#BFDBFE"))
                            cornerRadius = 10f * density
                        }
                        val p = (12 * density).toInt()
                        setPadding(p, (7 * density).toInt(), p, (7 * density).toInt())
                        setOnClickListener {
                            viewMode = if (viewMode == "TRIWULAN") "BULANAN" else "TRIWULAN"
                            loadTppData(year)
                        }
                    }
                    controlRow.addView(btnToggle)
                    dynamicContainer.addView(controlRow)

                    // 2. HERO CARD DENGAN HEADER BERWARNA (Ringkasan Pegawai & Nominal Bersih)
                    val heroCard = CardView(activity).apply {
                        radius = 18f * density
                        cardElevation = 3f * density
                        setCardBackgroundColor(Color.WHITE)
                        useCompatPadding = true
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (14 * density).toInt()
                        }
                    }
                    val heroWrapper = LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                    }

                    // Top Banner Berwarna pada Hero Card
                    val heroTopBanner = LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        setBackgroundColor(Color.parseColor("#1E3A8A"))
                        val p = (12 * density).toInt()
                        setPadding(p, p, p, p)
                    }
                    heroTopBanner.addView(TextView(activity).apply {
                        text = "🏛️ STATUS KEUANGAN & TPP GURU • TA $year"
                        textSize = 11.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.WHITE)
                        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    })
                    heroTopBanner.addView(TextView(activity).apply {
                        text = "RESMI DINAS"
                        textSize = 9.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#1E3A8A"))
                        background = GradientDrawable().apply {
                            setColor(Color.parseColor("#FDE047"))
                            cornerRadius = 6f * density
                        }
                        val bp = (6 * density).toInt()
                        setPadding(bp, 2, bp, 2)
                    })
                    heroWrapper.addView(heroTopBanner)

                    // Body Hero Card
                    val heroBody = LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                        val p = (14 * density).toInt()
                        setPadding(p, p, p, p)
                    }
                    heroBody.addView(TextView(activity).apply {
                        text = "${data.guru?.name ?: "Guru"} • NIP: ${data.guru?.nip ?: "-"}"
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#0F172A"))
                    })

                    // Status Ringkasan 2 Kolom (🟢 Sudah Cair & ⏳ Belum Cair) - Tanpa Nominal
                    val statusSummaryRow = LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        weightSum = 2f
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            topMargin = (8 * density).toInt()
                            bottomMargin = (4 * density).toInt()
                        }
                    }

                    fun createStatBadge(label: String, count: Int, bg: String, stroke: String, textCol: String): View {
                        return LinearLayout(activity).apply {
                            orientation = LinearLayout.VERTICAL
                            gravity = Gravity.CENTER
                            background = GradientDrawable().apply {
                                setColor(Color.parseColor(bg))
                                setStroke((1 * density).toInt(), Color.parseColor(stroke))
                                cornerRadius = 8f * density
                            }
                            val p = (8 * density).toInt()
                            setPadding(p, p, p, p)
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                                marginEnd = (3 * density).toInt()
                                marginStart = (3 * density).toInt()
                            }
                            addView(TextView(activity).apply {
                                text = "$count Bulan"
                                textSize = 14f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor(textCol))
                            })
                            addView(TextView(activity).apply {
                                text = label
                                textSize = 10f
                                setTextColor(Color.parseColor(textCol))
                            })
                        }
                    }

                    statusSummaryRow.addView(createStatBadge("🟢 Sudah Cair", data.summary?.totalBulanCair ?: 0, "#ECFDF5", "#A7F3D0", "#065F46"))
                    statusSummaryRow.addView(createStatBadge("⏳ Belum Cair", data.summary?.totalBulanBelumCair ?: 0, "#FFFBEB", "#FDE68A", "#92400E"))
                    heroBody.addView(statusSummaryRow)

                    // Tombol Aksi Utama: Lapor Status Pencairan TPP (Cair / Belum Cair)
                    val btnOpenReport = TextView(activity).apply {
                        text = "✍️ Buat / Update Laporan Pencairan TPP"
                        textSize = 12.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.WHITE)
                        gravity = Gravity.CENTER
                        background = GradientDrawable().apply {
                            setColor(Color.parseColor("#1E3A8A")) // Deep Navy Blue
                            cornerRadius = 10f * density
                        }
                        val p = (12 * density).toInt()
                        setPadding(p, (10 * density).toInt(), p, (10 * density).toInt())
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            topMargin = (10 * density).toInt()
                        }
                        setOnClickListener {
                            showTppReportDialog(activity, year, 1, null, "SUDAH_CAIR", null) {
                                loadTppData(year)
                            }
                        }
                    }
                    heroBody.addView(btnOpenReport)

                    heroWrapper.addView(heroBody)
                    heroCard.addView(heroWrapper)
                    dynamicContainer.addView(heroCard)

                    // DETEKSI PERUBAHAN STATUS: DARI BELUM CAIR MENJADI SUDAH CAIR
                    val teacherId = data.guru?.id ?: "me"
                    val prefs = activity.getSharedPreferences("SP_TPP_MONITOR", Context.MODE_PRIVATE)
                    val cacheKey = "CAIR_PERIODS_${teacherId}_$year"
                    val prevCairSet = prefs.getStringSet(cacheKey, null)

                    val currentCairPeriods = mutableListOf<String>()
                    val newlyCairList = mutableListOf<String>()
                    var latestCairDateFound = "-"

                    data.records?.forEach { r ->
                        if (r.status.uppercase() == "SUDAH_CAIR") {
                            val periodKey = "${r.triwulan}_${r.bulan}"
                            currentCairPeriods.add(periodKey)
                            if (prevCairSet != null && !prevCairSet.contains(periodKey)) {
                                newlyCairList.add(r.namaBulan)
                                if (!r.tanggalCairStr.isNullOrBlank() && r.tanggalCairStr != "-") {
                                    latestCairDateFound = r.tanggalCairStr!!
                                }
                            }
                        }
                    }

                    // Simpan status cair saat ini ke preferences
                    prefs.edit().putStringSet(cacheKey, currentCairPeriods.toSet()).apply()

                    // JIKA ADA PERUBAHAN DARI BELUM CAIR MENJADI SUDAH CAIR, TAMPILKAN BANNER & POPUP PERAYAAN
                    if (newlyCairList.isNotEmpty()) {
                        val names = newlyCairList.joinToString(", ")
                        val bannerAlert = createMessageAlertBox(
                            activity,
                            density,
                            title = "🎉 PEMBERITAHUAN: TPP TELAH RESMI CAIR!",
                            message = "Kabar gembira! TPP Anda untuk periode ($names) telah cair pada tanggal ${if (latestCairDateFound != "-") latestCairDateFound else "hari ini"}. Silakan periksa rekening Anda.",
                            headerBg = "#059669",
                            bodyBg = "#ECFDF5"
                        )
                        dynamicContainer.addView(bannerAlert)

                        try {
                            AlertDialog.Builder(activity)
                                .setTitle("🎉 Kabar Baik! TPP Sudah Cair")
                                .setMessage("Dana TPP Anda untuk periode:\n⭐ $names\n\nTelah berhasil dicairkan pada tanggal ${if (latestCairDateFound != "-") latestCairDateFound else "hari ini"}.\n\nSilakan periksa mutasi rekening Anda.")
                                .setPositiveButton("Alhamdulillah", null)
                                .show()
                        } catch (e: Exception) {}
                    }

                    // 3. SELECTOR TAB TRIWULAN (Klik Triwulan 1 -> Menampilkan Rincian Bulan TW 1, tidak semua TW muncul bersamaan)
                    val twBarCard = CardView(activity).apply {
                        radius = 14f * density
                        cardElevation = 2f * density
                        setCardBackgroundColor(Color.WHITE)
                        useCompatPadding = true
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (12 * density).toInt()
                        }
                    }
                    val twBarInner = LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                        val p = (12 * density).toInt()
                        setPadding(p, p, p, p)
                    }

                    val tvTwGuide = TextView(activity).apply {
                        text = "📌 Pilih Triwulan (Klik untuk menampilkan rincian bulan):"
                        textSize = 12f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#1E293B"))
                        setPadding(0, 0, 0, (8 * density).toInt())
                    }
                    twBarInner.addView(tvTwGuide)

                    val twTabsRow = LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        weightSum = 4f
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    }

                    val twItems = listOf(
                        1 to "TW 1\n(Jan - Mar)",
                        2 to "TW 2\n(Apr - Jun)",
                        3 to "TW 3\n(Jul - Sep)",
                        4 to "TW 4\n(Okt - Des)"
                    )
                    val twButtons = mutableListOf<Pair<Int, TextView>>()
                    for ((twNum, twText) in twItems) {
                        val btn = TextView(activity).apply {
                            text = twText
                            textSize = 11f
                            gravity = Gravity.CENTER
                            val padH = (6 * density).toInt()
                            val padV = (8 * density).toInt()
                            setPadding(padH, padV, padH, padV)
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                                marginStart = (2 * density).toInt()
                                marginEnd = (2 * density).toInt()
                            }
                        }
                        twButtons.add(twNum to btn)
                        twTabsRow.addView(btn)
                    }
                    twBarInner.addView(twTabsRow)

                    val btnAllTw = TextView(activity).apply {
                        text = if (selectedTw == 0) "✓ Menampilkan Semua Triwulan" else "🔍 Tampilkan Semua Triwulan Sekaligus"
                        textSize = 10.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(if (selectedTw == 0) Color.parseColor("#1E3A8A") else Color.parseColor("#64748B"))
                        gravity = Gravity.CENTER
                        setPadding(0, (8 * density).toInt(), 0, 0)
                    }
                    twBarInner.addView(btnAllTw)

                    twBarCard.addView(twBarInner)
                    dynamicContainer.addView(twBarCard)

                    val cardsContainer = LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                    }
                    dynamicContainer.addView(cardsContainer)

                    fun updateTwTabs() {
                        for ((twNum, btn) in twButtons) {
                            val isSelected = twNum == selectedTw
                            btn.background = GradientDrawable().apply {
                                setColor(if (isSelected) Color.parseColor("#1E3A8A") else Color.parseColor("#F8FAFC"))
                                setStroke((1 * density).toInt(), if (isSelected) Color.parseColor("#1E3A8A") else Color.parseColor("#CBD5E1"))
                                cornerRadius = 8f * density
                            }
                            btn.setTextColor(if (isSelected) Color.WHITE else Color.parseColor("#475569"))
                            btn.setTypeface(null, if (isSelected) Typeface.BOLD else Typeface.NORMAL)
                        }
                        btnAllTw.text = if (selectedTw == 0) "✓ Menampilkan Semua Triwulan" else "🔍 Tampilkan Semua Triwulan Sekaligus"
                        btnAllTw.setTextColor(if (selectedTw == 0) Color.parseColor("#1E3A8A") else Color.parseColor("#64748B"))
                    }

                    fun renderCards() {
                        updateTwTabs()
                        cardsContainer.removeAllViews()

                        if (viewMode == "TRIWULAN") {
                            val twList = data.triwulan ?: emptyList()
                            val displayList = if (selectedTw > 0) twList.filter { it.triwulan == selectedTw } else twList

                            if (displayList.isEmpty()) {
                                cardsContainer.addView(TextView(activity).apply {
                                    text = "Belum ada data untuk Triwulan $selectedTw"
                                    textSize = 12.5f
                                    setTextColor(Color.parseColor("#94A3B8"))
                                    gravity = Gravity.CENTER
                                    setPadding(20, 40, 20, 40)
                                })
                                return
                            }

                            for (tw in displayList) {
                                val theme = getStatusTheme(tw.status)

                                val cardTw = CardView(activity).apply {
                                    radius = 16f * density
                                    cardElevation = 2.5f * density
                                    setCardBackgroundColor(Color.WHITE)
                                    useCompatPadding = true
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (12 * density).toInt()
                                    }
                                }
                                val cardLayout = LinearLayout(activity).apply {
                                    orientation = LinearLayout.VERTICAL
                                }

                                // === HEADER STRIP BERWARNA (TIDAK POLOSAN) ===
                                val headerStrip = LinearLayout(activity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = Gravity.CENTER_VERTICAL
                                    setBackgroundColor(Color.parseColor(theme.headerColor))
                                    val p = (12 * density).toInt()
                                    setPadding(p, (10 * density).toInt(), p, (10 * density).toInt())
                                }
                                headerStrip.addView(TextView(activity).apply {
                                    text = "📅 ${tw.label} • ${tw.rentangBulan}"
                                    textSize = 13f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                })
                                // Badge Status
                                val badgeView = TextView(activity).apply {
                                    text = "${theme.icon} ${theme.label}"
                                    textSize = 10f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor(theme.badgeTextColor))
                                    background = GradientDrawable().apply {
                                        setColor(Color.parseColor(theme.badgeBgColor))
                                        cornerRadius = 6f * density
                                    }
                                    val bp = (8 * density).toInt()
                                    setPadding(bp, (3 * density).toInt(), bp, (3 * density).toInt())
                                }
                                headerStrip.addView(badgeView)
                                cardLayout.addView(headerStrip)

                                // Body Kartu
                                val cardBody = LinearLayout(activity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val p = (14 * density).toInt()
                                    setPadding(p, p, p, p)
                                }

                                // Badge Penanda Status & Tanggal Pencairan
                                val isTwCair = tw.status.uppercase() == "SUDAH_CAIR"
                                val dateBadge = LinearLayout(activity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = Gravity.CENTER_VERTICAL
                                    background = GradientDrawable().apply {
                                        setColor(Color.parseColor(if (isTwCair) "#ECFDF5" else "#FFFBEB"))
                                        setStroke((1 * density).toInt(), Color.parseColor(if (isTwCair) "#A7F3D0" else "#FDE68A"))
                                        cornerRadius = 8f * density
                                    }
                                    val p = (10 * density).toInt()
                                    setPadding(p, (6 * density).toInt(), p, (6 * density).toInt())
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (6 * density).toInt()
                                    }
                                }
                                dateBadge.addView(TextView(activity).apply {
                                    val tgl = if (tw.tanggalCair.isNotBlank() && tw.tanggalCair != "-") tw.tanggalCair else "Sudah Diterima"
                                    text = if (isTwCair) "🎉 Telah Cair pada tanggal: $tgl" else "⏳ Status: Belum Cair (Menunggu Pencairan Dinas)"
                                    textSize = 12f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor(if (isTwCair) "#065F46" else "#92400E"))
                                })
                                cardBody.addView(dateBadge)

                                // Rincian 3 Bulan di dalamnya
                                val months = tw.months ?: emptyList()
                                val monthsBox = LinearLayout(activity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    background = GradientDrawable().apply {
                                        setColor(Color.parseColor("#F8FAFC"))
                                        cornerRadius = 8f * density
                                    }
                                    val mp = (10 * density).toInt()
                                    setPadding(mp, mp, mp, mp)
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        topMargin = (4 * density).toInt()
                                        bottomMargin = (8 * density).toInt()
                                    }
                                }

                                for (m in months) {
                                    val mTheme = getStatusTheme(m.status)
                                    val isMCair = m.status.uppercase() == "SUDAH_CAIR"
                                    val cairSuffix = if (isMCair && !m.tanggalCairStr.isNullOrBlank() && m.tanggalCairStr != "-") " • Cair: ${m.tanggalCairStr}" else ""

                                    val mRow = LinearLayout(activity).apply {
                                        orientation = LinearLayout.HORIZONTAL
                                        gravity = Gravity.CENTER_VERTICAL
                                        setPadding(0, 4, 0, 4)
                                    }
                                    mRow.addView(TextView(activity).apply {
                                        text = "• ${m.namaBulan}:"
                                        textSize = 11.5f
                                        setTypeface(null, Typeface.BOLD)
                                        setTextColor(Color.parseColor("#334155"))
                                        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                    })
                                    mRow.addView(TextView(activity).apply {
                                        text = "${mTheme.icon} ${mTheme.label}$cairSuffix"
                                        textSize = 10f
                                        setTypeface(null, Typeface.BOLD)
                                        setTextColor(Color.parseColor(mTheme.headerColor))
                                    })

                                    val btnMonthAction: View = if (isMCair) {
                                        TextView(activity).apply {
                                            text = "🔒 Terkunci"
                                            textSize = 9.5f
                                            setTypeface(null, Typeface.BOLD)
                                            setTextColor(Color.parseColor("#065F46"))
                                            background = GradientDrawable().apply {
                                                setColor(Color.parseColor("#D1FAE5"))
                                                setStroke((1 * density).toInt(), Color.parseColor("#A7F3D0"))
                                                cornerRadius = 5f * density
                                            }
                                            val bp = (8 * density).toInt()
                                            setPadding(bp, (3 * density).toInt(), bp, (3 * density).toInt())
                                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                                marginStart = (8 * density).toInt()
                                            }
                                            setOnClickListener {
                                                AlertDialog.Builder(activity)
                                                    .setTitle("🔒 Status TPP Terkunci")
                                                    .setMessage("Status pencairan TPP bulan ${m.namaBulan} telah berstatus SUDAH CAIR pada tanggal ${if (!m.tanggalCairStr.isNullOrBlank() && m.tanggalCairStr != "-") m.tanggalCairStr else "tercatat"} dan terkunci secara otomatis demi integritas data keuangan sekolah.\n\nJika ada kekeliruan pencairan, silakan ajukan sanggahan atau hubungi Tim Kurikulum / Bendahara.")
                                                    .setPositiveButton("Mengerti", null)
                                                    .show()
                                            }
                                        }
                                    } else {
                                        TextView(activity).apply {
                                            text = "✅ Lapor Cair"
                                            textSize = 9.5f
                                            setTypeface(null, Typeface.BOLD)
                                            setTextColor(Color.WHITE)
                                            background = GradientDrawable().apply {
                                                setColor(Color.parseColor("#059669"))
                                                cornerRadius = 5f * density
                                            }
                                            val bp = (8 * density).toInt()
                                            setPadding(bp, (3 * density).toInt(), bp, (3 * density).toInt())
                                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                                marginStart = (8 * density).toInt()
                                            }
                                            setOnClickListener {
                                                showTppReportDialog(activity, year, tw.triwulan, m.bulan, "SUDAH_CAIR", m.id) {
                                                    loadTppData(year)
                                                }
                                            }
                                        }
                                    }
                                    mRow.addView(btnMonthAction)
                                    monthsBox.addView(mRow)
                                }
                                cardBody.addView(monthsBox)

                                // PESAN / CATATAN KHUSUS (HEADER BERWARNA KHUSUS)
                                val firstWithNote = tw.months?.find { !it.catatan.isNullOrBlank() }
                                if (firstWithNote != null && !firstWithNote.catatan.isNullOrBlank()) {
                                    val noteCard = createMessageAlertBox(
                                        activity,
                                        density,
                                        title = "💬 CATATAN OPERATOR / KEUANGAN",
                                        message = firstWithNote.catatan ?: "",
                                        headerBg = "#2563EB",
                                        bodyBg = "#EFF6FF"
                                    )
                                    cardBody.addView(noteCard)
                                }

                                // SANGGAHAN JIKA ADA
                                val firstWithDispute = tw.months?.find { !it.sanggahanGuru.isNullOrBlank() }
                                if (firstWithDispute != null && !firstWithDispute.sanggahanGuru.isNullOrBlank()) {
                                    val disputeCard = createMessageAlertBox(
                                        activity,
                                        density,
                                        title = "📝 SANGGAHAN ANDA (SEDANG DITINJAU)",
                                        message = firstWithDispute.sanggahanGuru ?: "",
                                        headerBg = "#7C3AED",
                                        bodyBg = "#F5F3FF"
                                    )
                                    cardBody.addView(disputeCard)
                                }

                                // Action: Tombol Konfirmasi Cair & Sanggahan
                                val actionRow = LinearLayout(activity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = Gravity.END
                                    setPadding(0, (8 * density).toInt(), 0, 0)
                                }
                                val isAllTwMonthsCair = tw.months?.all { it.status.uppercase() == "SUDAH_CAIR" } == true
                                val btnLaporTw = TextView(activity).apply {
                                    if (isAllTwMonthsCair || isTwCair) {
                                        text = "🔒 TW ${tw.triwulan} Terkunci (Cair)"
                                        textSize = 11f
                                        setTypeface(null, Typeface.BOLD)
                                        setTextColor(Color.parseColor("#065F46"))
                                        background = GradientDrawable().apply {
                                            setColor(Color.parseColor("#D1FAE5"))
                                            setStroke((1 * density).toInt(), Color.parseColor("#A7F3D0"))
                                            cornerRadius = 8f * density
                                        }
                                        val bp = (12 * density).toInt()
                                        setPadding(bp, (6 * density).toInt(), bp, (6 * density).toInt())
                                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                            marginEnd = (8 * density).toInt()
                                        }
                                        setOnClickListener {
                                            AlertDialog.Builder(activity)
                                                .setTitle("🔒 Triwulan ${tw.triwulan} Terkunci")
                                                .setMessage("Seluruh pencairan TPP untuk Triwulan ${tw.triwulan} (${tw.rentangBulan}) telah berstatus SUDAH CAIR dan terkunci secara otomatis.\n\nData telah diverifikasi dan masuk dalam rekapitulasi keuangan sekolah.")
                                                .setPositiveButton("Tutup", null)
                                                .show()
                                        }
                                    } else {
                                        text = "✍️ Lapor / Ubah TW ${tw.triwulan}"
                                        textSize = 11.5f
                                        setTypeface(null, Typeface.BOLD)
                                        setTextColor(Color.WHITE)
                                        background = GradientDrawable().apply {
                                            setColor(Color.parseColor("#059669"))
                                            cornerRadius = 8f * density
                                        }
                                        val bp = (12 * density).toInt()
                                        setPadding(bp, (6 * density).toInt(), bp, (6 * density).toInt())
                                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                            marginEnd = (8 * density).toInt()
                                        }
                                        setOnClickListener {
                                            showTppReportDialog(activity, year, tw.triwulan, null, "SUDAH_CAIR", null) {
                                                loadTppData(year)
                                            }
                                        }
                                    }
                                }
                                actionRow.addView(btnLaporTw)

                                val btnDispute = TextView(activity).apply {
                                    text = "📝 Sanggahan"
                                    textSize = 11f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#7C3AED"))
                                    background = GradientDrawable().apply {
                                        setColor(Color.parseColor("#F5F3FF"))
                                        setStroke((1 * density).toInt(), Color.parseColor("#DDD6FE"))
                                        cornerRadius = 8f * density
                                    }
                                    val bp = (10 * density).toInt()
                                    setPadding(bp, (6 * density).toInt(), bp, (6 * density).toInt())
                                    setOnClickListener {
                                        val firstId = tw.months?.firstOrNull()?.id ?: ""
                                        showDisputeDialog(activity, firstId, tw.label, year) {
                                            loadTppData(year)
                                        }
                                    }
                                }
                                actionRow.addView(btnDispute)
                                cardBody.addView(actionRow)

                                cardLayout.addView(cardBody)
                                cardTw.addView(cardLayout)
                                cardsContainer.addView(cardTw)
                            }
                        } else {
                            // TAMPILAN BULANAN (Sesuai Triwulan yang dipilih)
                            val records = data.records ?: emptyList()
                            val displayRecords = if (selectedTw > 0) records.filter { it.triwulan == selectedTw } else records

                            if (displayRecords.isEmpty()) {
                                cardsContainer.addView(TextView(activity).apply {
                                    text = "Belum ada data bulan untuk Triwulan $selectedTw"
                                    textSize = 12.5f
                                    setTextColor(Color.parseColor("#94A3B8"))
                                    gravity = Gravity.CENTER
                                    setPadding(20, 40, 20, 40)
                                })
                                return
                            }

                            for (r in displayRecords) {
                                val theme = getStatusTheme(r.status)

                                val cardM = CardView(activity).apply {
                                    radius = 12f * density
                                    cardElevation = 1.5f * density
                                    setCardBackgroundColor(Color.WHITE)
                                    useCompatPadding = true
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (10 * density).toInt()
                                    }
                                }
                                val cardLayout = LinearLayout(activity).apply {
                                    orientation = LinearLayout.VERTICAL
                                }

                                // Header Strip Bulan
                                val mHeader = LinearLayout(activity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = Gravity.CENTER_VERTICAL
                                    setBackgroundColor(Color.parseColor(theme.headerColor))
                                    val p = (10 * density).toInt()
                                    setPadding(p, (8 * density).toInt(), p, (8 * density).toInt())
                                }
                                mHeader.addView(TextView(activity).apply {
                                    text = "📅 ${r.namaBulan} $year (TW ${r.triwulan})"
                                    textSize = 12.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                })
                                mHeader.addView(TextView(activity).apply {
                                    text = "${theme.icon} ${theme.label}"
                                    textSize = 9.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor(theme.badgeTextColor))
                                    background = GradientDrawable().apply {
                                        setColor(Color.parseColor(theme.badgeBgColor))
                                        cornerRadius = 5f * density
                                    }
                                    val bp = (6 * density).toInt()
                                    setPadding(bp, 2, bp, 2)
                                })
                                cardLayout.addView(mHeader)

                                val mBody = LinearLayout(activity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val p = (12 * density).toInt()
                                    setPadding(p, p, p, p)
                                }
                                val isRCair = r.status.uppercase() == "SUDAH_CAIR"
                                val dateBadgeM = LinearLayout(activity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = Gravity.CENTER_VERTICAL
                                    background = GradientDrawable().apply {
                                        setColor(Color.parseColor(if (isRCair) "#ECFDF5" else "#FFFBEB"))
                                        setStroke((1 * density).toInt(), Color.parseColor(if (isRCair) "#A7F3D0" else "#FDE68A"))
                                        cornerRadius = 6f * density
                                    }
                                    val p = (8 * density).toInt()
                                    setPadding(p, (4 * density).toInt(), p, (4 * density).toInt())
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (6 * density).toInt()
                                    }
                                }
                                dateBadgeM.addView(TextView(activity).apply {
                                    val tgl = if (!r.tanggalCairStr.isNullOrBlank() && r.tanggalCairStr != "-") r.tanggalCairStr else "Terkonfirmasi Cair"
                                    text = if (isRCair) "🎉 Cair pada: $tgl ${if (!r.noReferensi.isNullOrBlank() && r.noReferensi != "-") "• Ref: ${r.noReferensi}" else ""}" else "⏳ Status: Belum Cair (Menunggu Pencairan Dinas)"
                                    textSize = 11.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor(if (isRCair) "#065F46" else "#92400E"))
                                })
                                mBody.addView(dateBadgeM)

                                if (!r.catatan.isNullOrBlank()) {
                                    val noteCard = createMessageAlertBox(
                                        activity,
                                        density,
                                        title = "💬 CATATAN OPERATOR",
                                        message = r.catatan ?: "",
                                        headerBg = "#2563EB",
                                        bodyBg = "#EFF6FF"
                                    )
                                    mBody.addView(noteCard)
                                }

                                val actionRowM = LinearLayout(activity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = Gravity.END
                                    setPadding(0, (6 * density).toInt(), 0, 0)
                                }

                                val btnLaporM = if (isRCair) {
                                    TextView(activity).apply {
                                        text = "🔒 Terkunci (Cair)"
                                        textSize = 10.5f
                                        setTypeface(null, Typeface.BOLD)
                                        setTextColor(Color.parseColor("#065F46"))
                                        background = GradientDrawable().apply {
                                            setColor(Color.parseColor("#D1FAE5"))
                                            setStroke((1 * density).toInt(), Color.parseColor("#A7F3D0"))
                                            cornerRadius = 6f * density
                                        }
                                        val bp = (10 * density).toInt()
                                        setPadding(bp, (5 * density).toInt(), bp, (5 * density).toInt())
                                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                            marginEnd = (8 * density).toInt()
                                        }
                                        setOnClickListener {
                                            AlertDialog.Builder(activity)
                                                .setTitle("🔒 Status TPP Terkunci")
                                                .setMessage("Status pencairan TPP bulan ${r.namaBulan} telah berstatus SUDAH CAIR pada tanggal ${if (!r.tanggalCairStr.isNullOrBlank() && r.tanggalCairStr != "-") r.tanggalCairStr else "tercatat"} dan terkunci secara otomatis demi integritas data keuangan sekolah.\n\nJika ada kekeliruan pencairan, silakan ajukan sanggahan atau hubungi Tim Kurikulum / Bendahara.")
                                                .setPositiveButton("Mengerti", null)
                                                .show()
                                        }
                                    }
                                } else {
                                    TextView(activity).apply {
                                        text = "✅ Lapor Cair"
                                        textSize = 11.5f
                                        setTypeface(null, Typeface.BOLD)
                                        setTextColor(Color.WHITE)
                                        background = GradientDrawable().apply {
                                            setColor(Color.parseColor("#059669"))
                                            cornerRadius = 6f * density
                                        }
                                        val bp = (12 * density).toInt()
                                        setPadding(bp, (5 * density).toInt(), bp, (5 * density).toInt())
                                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                            marginEnd = (8 * density).toInt()
                                        }
                                        setOnClickListener {
                                            showTppReportDialog(activity, year, r.triwulan ?: 1, r.bulan, "SUDAH_CAIR", r.id) {
                                                loadTppData(year)
                                            }
                                        }
                                    }
                                }
                                actionRowM.addView(btnLaporM)

                                val btnDisputeM = TextView(activity).apply {
                                    text = "📝 Sanggahan"
                                    textSize = 11f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#7C3AED"))
                                    background = GradientDrawable().apply {
                                        setColor(Color.parseColor("#F5F3FF"))
                                        setStroke((1 * density).toInt(), Color.parseColor("#DDD6FE"))
                                        cornerRadius = 6f * density
                                    }
                                    val bp = (10 * density).toInt()
                                    setPadding(bp, (5 * density).toInt(), bp, (5 * density).toInt())
                                    setOnClickListener {
                                        showDisputeDialog(activity, r.id, r.namaBulan, year) {
                                            loadTppData(year)
                                        }
                                    }
                                }
                                actionRowM.addView(btnDisputeM)
                                mBody.addView(actionRowM)

                                cardLayout.addView(mBody)
                                cardM.addView(cardLayout)
                                cardsContainer.addView(cardM)
                            }
                        }
                    }

                    for ((twNum, btn) in twButtons) {
                        btn.setOnClickListener {
                            selectedTw = twNum
                            renderCards()
                        }
                    }
                    btnAllTw.setOnClickListener {
                        selectedTw = if (selectedTw == 0) 1 else 0
                        renderCards()
                    }

                    renderCards()
                }

                override fun onFailure(call: Call<MyTppResponse>, t: Throwable) {
                    dynamicContainer.removeAllViews()
                    dynamicContainer.addView(TextView(activity).apply {
                        text = "❌ Gagal terhubung ke server: ${t.message}"
                        textSize = 13f
                        setTextColor(Color.parseColor("#DC2626"))
                        gravity = Gravity.CENTER
                        setPadding(20, 40, 20, 40)
                    })
                }
            })
        }

        btnRefresh.setOnClickListener {
            loadTppData(currentYear)
        }

        loadTppData(currentYear)
        dialog.setView(root)
        dialog.show()
    }

    /**
     * Membuat Kotak Pesan / Alert Ber-Header Warna (Tidak Polosan)
     */
    fun createMessageAlertBox(
        context: Context,
        density: Float,
        title: String,
        message: String,
        headerBg: String,
        bodyBg: String
    ): View {
        val card = CardView(context).apply {
            radius = 10f * density
            cardElevation = 1f * density
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (6 * density).toInt()
                bottomMargin = (6 * density).toInt()
            }
        }
        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
        }

        // Header Strip Berwarna pada Pesan
        val msgHeader = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor(headerBg))
            val p = (10 * density).toInt()
            setPadding(p, (6 * density).toInt(), p, (6 * density).toInt())
        }
        msgHeader.addView(TextView(context).apply {
            text = title
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        layout.addView(msgHeader)

        // Isi Pesan
        val msgBody = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(bodyBg))
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
        }
        msgBody.addView(TextView(context).apply {
            text = message
            textSize = 11.5f
            setTextColor(Color.parseColor("#1E293B"))
            setLineSpacing(1.2f, 1f)
        })
        layout.addView(msgBody)
        card.addView(layout)
        return card
    }

    /**
     * Dialog Form Sanggahan TPP Ber-Header Warna
     */
    private fun showDisputeDialog(
        activity: TeacherMainActivity,
        recordId: String,
        periodLabel: String,
        year: Int,
        onSuccess: () -> Unit
    ) {
        val density = activity.resources.displayMetrics.density
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }

        // Header Strip Ungu Menawan
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#7C3AED"))
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        header.addView(TextView(activity).apply {
            text = "📝 FORM SANGGAHAN TPP"
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        header.addView(TextView(activity).apply {
            text = "Periode $periodLabel $year • Kirim Koreksi ke Operator & Kurikulum"
            textSize = 11f
            setTextColor(Color.parseColor("#EDE9FE"))
            setPadding(0, 2, 0, 0)
        })
        root.addView(header)

        val bodyLayout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        bodyLayout.addView(TextView(activity).apply {
            text = "Jelaskan perbedaan data kehadiran / status pencairan secara jelas:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, 8)
        })

        val etReason = EditText(activity).apply {
            hint = "Contoh: Di rekening belum masuk per tanggal 12 April atau ada selisih kehadiran..."
            textSize = 12.5f
            minLines = 3
            gravity = Gravity.TOP
            val p = (12 * density).toInt()
            setPadding(p, p, p, p)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                cornerRadius = 8f * density
            }
        }
        bodyLayout.addView(etReason)
        root.addView(bodyLayout)

        AlertDialog.Builder(activity)
            .setView(root)
            .setPositiveButton("Kirim Sanggahan") { _, _ ->
                val reason = etReason.text.toString().trim()
                if (reason.isBlank()) {
                    Toast.makeText(activity, "Alasan sanggahan wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val body = mapOf(
                    "tppRecordId" to recordId,
                    "alasanSanggahan" to reason
                )

                Toast.makeText(activity, "Mengirim sanggahan ke Operator...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(activity).submitTppDispute(body).enqueue(object : Callback<GenericTppActionResponse> {
                    override fun onResponse(call: Call<GenericTppActionResponse>, response: Response<GenericTppActionResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(activity, "✅ Sanggahan berhasil dikirim dan masuk antrean peninjauan!", Toast.LENGTH_LONG).show()
                            onSuccess()
                        } else {
                            Toast.makeText(activity, "Gagal: ${response.body()?.message ?: "Terjadi kesalahan"}", Toast.LENGTH_LONG).show()
                        }
                    }

                    override fun onFailure(call: Call<GenericTppActionResponse>, t: Throwable) {
                        Toast.makeText(activity, "Gagal terhubung: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    /**
     * Dialog Form Konfirmasi Pencairan oleh Guru (Header Warna Hijau Emerald)
     * Guru memilih bulan apa & menginput tanggal berapa dana cair ke rekening.
     * Data ini langsung diteruskan ke Operator & Manajemen Kurikulum untuk direkap.
     */
    /**
     * Dialog Form Laporan Status TPP Mandiri:
     * - Pencairan Triwulan Ke (TW 1 s/d TW 4)
     * - Bulan (Januari s/d Desember sesuai TW)
     * - Status Biner: Cair + Belum
     * - Jika Cair -> Input tanggal berapa cair + tombol Kirim Laporan
     * - Jika Belum -> Catatan (opsional) + tombol Kirim Laporan
     * - Update dari Belum Cair ke Cair -> Pilih Cair, isi tanggal berapa cair, klik Kirim Laporan
     */
    fun showTppReportDialog(
        activity: TeacherMainActivity,
        year: Int,
        initialTw: Int? = 1,
        initialMonth: Int? = null,
        initialStatus: String = "SUDAH_CAIR",
        recordId: String? = null,
        onSuccess: () -> Unit
    ) {
        val density = activity.resources.displayMetrics.density
        val dialog = AlertDialog.Builder(activity).create()

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }

        // Header Strip Berwarna
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1E3A8A")) // Deep Navy Blue
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        header.addView(TextView(activity).apply {
            text = "📋 FORM LAPORAN STATUS TPP"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        header.addView(TextView(activity).apply {
            text = "Pencairan Triwulan • Pilihan Bulan • Status Cair & Belum Cair"
            textSize = 11f
            setTextColor(Color.parseColor("#BFDBFE"))
            setPadding(0, 2, 0, 0)
        })
        root.addView(header)

        val scroll = ScrollView(activity)
        val bodyLayout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        scroll.addView(bodyLayout)
        root.addView(scroll)

        // Hitung selectedTw awal
        var selectedTw = if (initialMonth != null && initialMonth in 1..12) {
            (initialMonth - 1) / 3 + 1
        } else if (initialTw != null && initialTw in 1..4) {
            initialTw
        } else {
            1
        }

        var isCair = initialStatus.uppercase() == "SUDAH_CAIR"

        // 1. PENCAIRAN TRIWULAN KE
        bodyLayout.addView(TextView(activity).apply {
            text = "1. Pencairan Triwulan Ke:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            setPadding(0, 0, 0, (6 * density).toInt())
        })

        val twButtonsLayout = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 4f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
        }

        val twChips = mutableListOf<TextView>()

        val tvTwLockNotice = TextView(activity).apply {
            textSize = 10.5f
            setTextColor(Color.parseColor("#15803D"))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#F0FDF4"))
                cornerRadius = 8f * density
                setStroke((1 * density).toInt(), Color.parseColor("#BBF7D0"))
            }
            val p = (8 * density).toInt()
            setPadding(p, p, p, p)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (10 * density).toInt()
            }
            visibility = if (selectedTw > 1) View.VISIBLE else View.GONE
        }
        bodyLayout.addView(tvTwLockNotice)

        fun updateTwLockNoticeText() {
            if (selectedTw > 1) {
                tvTwLockNotice.visibility = View.VISIBLE
                val prevTws = if (selectedTw == 2) "TW 1" else if (selectedTw == 3) "TW 1 dan TW 2" else "TW 1, TW 2, dan TW 3"
                tvTwLockNotice.text = "🔒 Integritas Data: Mengirim laporan TW $selectedTw akan otomatis mengunci $prevTws menjadi status terkunci (Lock Hijau) dan tidak dapat diubah mundur."
            } else {
                tvTwLockNotice.visibility = View.GONE
            }
        }
        updateTwLockNoticeText()

        // 2. BULAN SPINNER (Didefinisikan di awal agar bisa di-update saat TW berubah)
        val monthLabel = TextView(activity).apply {
            text = "2. Bulan Pencairan:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            setPadding(0, 0, 0, (6 * density).toInt())
        }
        bodyLayout.addView(twButtonsLayout)
        bodyLayout.addView(monthLabel)

        val spinnerMonth = Spinner(activity).apply {
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                cornerRadius = 8f * density
            }
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
        }
        bodyLayout.addView(spinnerMonth)

        // Data pemetaan bulan per triwulan
        fun getMonthsForTw(tw: Int): List<Pair<Int, String>> {
            return when (tw) {
                1 -> listOf(0 to "⭐ Semua 3 Bulan TW 1 (Jan - Mar)", 1 to "Januari", 2 to "Februari", 3 to "Maret")
                2 -> listOf(0 to "⭐ Semua 3 Bulan TW 2 (Apr - Jun)", 4 to "April", 5 to "Mei", 6 to "Juni")
                3 -> listOf(0 to "⭐ Semua 3 Bulan TW 3 (Jul - Sep)", 7 to "Juli", 8 to "Agustus", 9 to "September")
                else -> listOf(0 to "⭐ Semua 3 Bulan TW 4 (Okt - Des)", 10 to "Oktober", 11 to "November", 12 to "Desember")
            }
        }

        var currentMonthPairs = getMonthsForTw(selectedTw)
        var selectedMonthCode = initialMonth ?: 0

        fun updateMonthSpinner(tw: Int) {
            currentMonthPairs = getMonthsForTw(tw)
            val names = currentMonthPairs.map { it.second }
            val adapter = ArrayAdapter(activity, android.R.layout.simple_spinner_dropdown_item, names)
            spinnerMonth.adapter = adapter
            val defaultIndex = if (initialMonth != null) currentMonthPairs.indexOfFirst { it.first == initialMonth } else 0
            spinnerMonth.setSelection(if (defaultIndex >= 0) defaultIndex else 0)
        }

        spinnerMonth.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position in currentMonthPairs.indices) {
                    selectedMonthCode = currentMonthPairs[position].first
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        // Render Chip Triwulan 1 s/d 4
        fun updateTwChipsUi() {
            for (idx in 1..4) {
                val chip = twChips[idx - 1]
                val isSelected = idx == selectedTw
                chip.setTextColor(if (isSelected) Color.WHITE else Color.parseColor("#334155"))
                chip.setTypeface(null, if (isSelected) Typeface.BOLD else Typeface.NORMAL)
                chip.background = GradientDrawable().apply {
                    setColor(if (isSelected) Color.parseColor("#1E3A8A") else Color.parseColor("#F1F5F9"))
                    cornerRadius = 8f * density
                    if (!isSelected) {
                        setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                    }
                }
            }
        }

        for (i in 1..4) {
            val chip = TextView(activity).apply {
                text = "TW $i"
                textSize = 12f
                gravity = Gravity.CENTER
                val p = (8 * density).toInt()
                setPadding(p, (10 * density).toInt(), p, (10 * density).toInt())
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    if (i > 1) marginStart = (4 * density).toInt()
                }
                setOnClickListener {
                    selectedTw = i
                    updateTwChipsUi()
                    updateMonthSpinner(selectedTw)
                    updateTwLockNoticeText()
                }
            }
            twChips.add(chip)
            twButtonsLayout.addView(chip)
        }
        updateTwChipsUi()
        updateMonthSpinner(selectedTw)

        // 3. STATUS PENCAIRAN (CAIR + BELUM)
        bodyLayout.addView(TextView(activity).apply {
            text = "3. Status Pencairan (Pilih Salah Satu):"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            setPadding(0, 0, 0, (6 * density).toInt())
        })

        val statusRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
        }

        val cardSudahCair = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val p = (10 * density).toInt()
            setPadding(p, (12 * density).toInt(), p, (12 * density).toInt())
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = (4 * density).toInt()
            }
            addView(TextView(activity).apply {
                text = "🟢 SUDAH CAIR"
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#065F46"))
            })
            addView(TextView(activity).apply {
                text = "Dana masuk rekening"
                textSize = 10f
                setTextColor(Color.parseColor("#047857"))
                setPadding(0, 2, 0, 0)
            })
        }

        val cardBelumCair = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val p = (10 * density).toInt()
            setPadding(p, (12 * density).toInt(), p, (12 * density).toInt())
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (4 * density).toInt()
            }
            addView(TextView(activity).apply {
                text = "⏳ BELUM CAIR"
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#92400E"))
            })
            addView(TextView(activity).apply {
                text = "Belum ada mutasi"
                textSize = 10f
                setTextColor(Color.parseColor("#B45309"))
                setPadding(0, 2, 0, 0)
            })
        }
        statusRow.addView(cardSudahCair)
        statusRow.addView(cardBelumCair)
        bodyLayout.addView(statusRow)

        // 4. CONTAINER JIKA CAIR
        val containerCair = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
        }
        containerCair.addView(TextView(activity).apply {
            text = "📅 Tanggal Berapa Cair Masuk Rekening?"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            setPadding(0, 0, 0, 4)
        })
        val etDate = EditText(activity).apply {
            val sdf = SimpleDateFormat("dd MMMM yyyy", Locale("id", "ID"))
            setText(sdf.format(Date()))
            hint = "Contoh: 19 Oktober 2026"
            textSize = 12.5f
            val p = (12 * density).toInt()
            setPadding(p, p, p, p)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                cornerRadius = 8f * density
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (10 * density).toInt()
            }
        }
        containerCair.addView(etDate)

        containerCair.addView(TextView(activity).apply {
            text = "💬 Keterangan / Rekening (Opsional):"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, 4)
        })
        val etNotesCair = EditText(activity).apply {
            hint = "Contoh: Sudah masuk rekening Bank Jatim..."
            textSize = 12f
            minLines = 2
            val p = (12 * density).toInt()
            setPadding(p, p, p, p)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                cornerRadius = 8f * density
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
        }
        containerCair.addView(etNotesCair)
        bodyLayout.addView(containerCair)

        // 5. CONTAINER JIKA BELUM CAIR
        val containerBelum = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
        }
        val alertBelum = createMessageAlertBox(
            activity,
            density,
            title = "ℹ️ KONFIRMASI STATUS BELUM CAIR",
            message = "Laporan ini akan mengonfirmasi bahwa Anda belum menerima pencairan TPP periode ini. Data akan otomatis masuk ke rekap Kurikulum & Operator.",
            headerBg = "#EA580C",
            bodyBg = "#FFFBEB"
        )
        containerBelum.addView(alertBelum)

        containerBelum.addView(TextView(activity).apply {
            text = "💬 Keterangan Belum Cair (Opsional):"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, (6 * density).toInt(), 0, 4)
        })
        val etNotesBelum = EditText(activity).apply {
            hint = "Contoh: Dicek di mutasi rekening belum ada dana masuk..."
            textSize = 12f
            minLines = 2
            val p = (12 * density).toInt()
            setPadding(p, p, p, p)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                cornerRadius = 8f * density
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
        }
        containerBelum.addView(etNotesBelum)
        bodyLayout.addView(containerBelum)

        // 6. TOMBOL KIRIM LAPORAN
        val btnSubmit = TextView(activity).apply {
            text = "🚀 Kirim Laporan Pencairan"
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            val p = (14 * density).toInt()
            setPadding(p, p, p, p)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (6 * density).toInt()
                bottomMargin = (8 * density).toInt()
            }
        }
        bodyLayout.addView(btnSubmit)

        // Update UI Status (Cair vs Belum)
        fun updateStatusSelectionUi() {
            if (isCair) {
                cardSudahCair.background = GradientDrawable().apply {
                    setColor(Color.parseColor("#ECFDF5"))
                    setStroke((2 * density).toInt(), Color.parseColor("#059669"))
                    cornerRadius = 10f * density
                }
                cardBelumCair.background = GradientDrawable().apply {
                    setColor(Color.WHITE)
                    setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                    cornerRadius = 10f * density
                }
                containerCair.visibility = View.VISIBLE
                containerBelum.visibility = View.GONE
                btnSubmit.text = "🚀 Kirim Laporan (Sudah Cair)"
                btnSubmit.background = GradientDrawable().apply {
                    setColor(Color.parseColor("#059669"))
                    cornerRadius = 10f * density
                }
            } else {
                cardSudahCair.background = GradientDrawable().apply {
                    setColor(Color.WHITE)
                    setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                    cornerRadius = 10f * density
                }
                cardBelumCair.background = GradientDrawable().apply {
                    setColor(Color.parseColor("#FFFBEB"))
                    setStroke((2 * density).toInt(), Color.parseColor("#EA580C"))
                    cornerRadius = 10f * density
                }
                containerCair.visibility = View.GONE
                containerBelum.visibility = View.VISIBLE
                btnSubmit.text = "📤 Kirim Laporan (Belum Cair)"
                btnSubmit.background = GradientDrawable().apply {
                    setColor(Color.parseColor("#EA580C"))
                    cornerRadius = 10f * density
                }
            }
        }

        cardSudahCair.setOnClickListener {
            isCair = true
            updateStatusSelectionUi()
        }
        cardBelumCair.setOnClickListener {
            isCair = false
            updateStatusSelectionUi()
        }
        updateStatusSelectionUi()

        // AKSI KIRIM LAPORAN
        btnSubmit.setOnClickListener {
            // Tentukan bulanList yang dilaporkan
            val targetMonths = if (selectedMonthCode == 0) {
                listOf((selectedTw - 1) * 3 + 1, (selectedTw - 1) * 3 + 2, (selectedTw - 1) * 3 + 3)
            } else {
                listOf(selectedMonthCode)
            }

            val dateStr = if (isCair) {
                val inputDate = etDate.text.toString().trim()
                if (inputDate.isBlank()) {
                    SimpleDateFormat("dd MMMM yyyy", Locale("id", "ID")).format(Date())
                } else {
                    inputDate
                }
            } else {
                "-"
            }

            val noteStr = if (isCair) {
                etNotesCair.text.toString().trim()
            } else {
                etNotesBelum.text.toString().trim()
            }

            val body = mutableMapOf<String, Any>(
                "tahun" to year,
                "triwulan" to selectedTw,
                "bulanList" to targetMonths,
                "status" to if (isCair) "SUDAH_CAIR" else "BELUM_CAIR",
                "tanggalCairStr" to dateStr,
                "catatan" to noteStr
            )
            if (!recordId.isNullOrBlank()) {
                body["tppRecordId"] = recordId
            }

            Toast.makeText(activity, "Mengirim laporan TPP...", Toast.LENGTH_SHORT).show()
            ApiClient.getClient(activity).submitTeacherTppReport(body).enqueue(object : Callback<GenericTppActionResponse> {
                override fun onResponse(call: Call<GenericTppActionResponse>, response: Response<GenericTppActionResponse>) {
                    if (response.isSuccessful && response.body()?.success == true) {
                        val msg = response.body()?.message ?: "✅ Laporan status TPP berhasil dikirim ke Operator & Kurikulum!"
                        Toast.makeText(activity, msg, Toast.LENGTH_LONG).show()
                        dialog.dismiss()
                        onSuccess()
                    } else {
                        val errMsg = try {
                            val errBodyStr = response.errorBody()?.string() ?: ""
                            org.json.JSONObject(errBodyStr).optString("message", "Gagal mengirim laporan")
                        } catch (e: Exception) {
                            response.body()?.message ?: "Terjadi kesalahan"
                        }
                        AlertDialog.Builder(activity)
                            .setTitle("Pemberitahuan")
                            .setMessage(errMsg)
                            .setPositiveButton("Tutup", null)
                            .show()
                    }
                }

                override fun onFailure(call: Call<GenericTppActionResponse>, t: Throwable) {
                    Toast.makeText(activity, "Gagal terhubung: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            })
        }

        dialog.setView(root)
        dialog.show()
    }

    /**
     * Pembungkus kompatibilitas untuk konfirmasi cair cepat
     */
    fun showConfirmCairDialog(
        activity: TeacherMainActivity,
        recordId: String?,
        year: Int,
        defaultMonth: Int,
        monthOptions: List<Pair<Int, String>>,
        onSuccess: () -> Unit
    ) {
        val tw = (defaultMonth - 1) / 3 + 1
        showTppReportDialog(activity, year, tw, defaultMonth, "SUDAH_CAIR", recordId, onSuccess)
    }

    /**
     * Pembungkus kompatibilitas untuk membatalkan cair
     */
    fun showCancelCairDialog(
        activity: TeacherMainActivity,
        recordId: String,
        monthName: String,
        onSuccess: () -> Unit
    ) {
        val curYear = Calendar.getInstance().get(Calendar.YEAR)
        showTppReportDialog(activity, curYear, 1, null, "BELUM_CAIR", recordId, onSuccess)
    }

    /**
     * Dialog Monitoring TPP untuk Tim Kurikulum (Tanpa Nominal Rupiah - Privasi Terjamin)
     */
    fun showKurikulumTppMonitoringDialog(activity: TeacherMainActivity) {
        val dialog = AlertDialog.Builder(activity, android.R.style.Theme_Light_NoTitleBar_Fullscreen).create()
        val density = activity.resources.displayMetrics.density

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        var selectedTw = 1
        val selectedYear = Calendar.getInstance().get(Calendar.YEAR)

        // Header Dialog Kurikulum
        val headerCard = CardView(activity).apply {
            radius = 0f
            cardElevation = 4f * density
            setCardBackgroundColor(Color.parseColor("#312E81")) // Indigo
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val headerInner = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        headerInner.addView(TextView(activity).apply {
            text = "✕"
            textSize = 20f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val bp = (8 * density).toInt()
            setPadding(0, 0, bp, 0)
            setOnClickListener { dialog.dismiss() }
        })
        val headerTextLayout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        headerTextLayout.addView(TextView(activity).apply {
            text = "🏛️ Rekapitulasi TPP Guru (33 Rombel)"
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        headerTextLayout.addView(TextView(activity).apply {
            text = "Rekap Laporan Pencairan dari Seluruh Guru (Privasi: Tanpa Nominal)"
            textSize = 10.5f
            setTextColor(Color.parseColor("#C7D2FE"))
            setPadding(0, 2, 0, 0)
        })
        headerInner.addView(headerTextLayout)

        var lastMonitoringData: KurikulumTppMonitoringResponse? = null

        val btnCopyRecap = TextView(activity).apply {
            text = "📋 Salin Rekap"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#4338CA"))
                cornerRadius = 6f * density
            }
            val p = (8 * density).toInt()
            setPadding(p, (4 * density).toInt(), p, (4 * density).toInt())
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginEnd = (8 * density).toInt()
            }
            setOnClickListener {
                val data = lastMonitoringData
                if (data == null || data.teachers.isNullOrEmpty()) {
                    Toast.makeText(activity, "Data rekap belum dimuat", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val sb = StringBuilder()
                sb.append("📋 REKAPITULASI PENCAIRAN TPP GURU SMPN 1 BOYOLANGU\n")
                sb.append("Tahun: $selectedYear • Periode: TW $selectedTw\n")
                sb.append("Total Guru: ${data.kpi?.totalGuru ?: 0} | Sudah Lapor Cair: ${data.kpi?.totalSudahCair ?: 0} | Belum Lapor: ${(data.kpi?.totalGuru ?: 0) - (data.kpi?.totalSudahCair ?: 0)}\n")
                sb.append("Persentase Lapor Cair: ${data.kpi?.persentaseCair ?: 0}%\n")
                sb.append("------------------------------------------\n")
                sb.append("RINCIAN STATUS PER GURU:\n")
                data.teachers.forEachIndexed { idx, t ->
                    val statusText = if (t.status.uppercase() == "SUDAH_CAIR") "🟢 SUDAH CAIR (${t.tanggalCairStr})" else "⏳ BELUM LAPOR"
                    sb.append("${idx + 1}. ${t.name} (NIP: ${t.nip}) - $statusText\n")
                    if (!t.catatan.isNullOrBlank()) {
                        sb.append("   Catatan: ${t.catatan}\n")
                    }
                }
                sb.append("------------------------------------------\n")
                sb.append("Dicetak otomatis via Aplikasi SIBOY FRESH 2026\n")

                val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                val clip = android.content.ClipData.newPlainText("Rekap TPP Guru", sb.toString())
                clipboard.setPrimaryClip(clip)
                Toast.makeText(activity, "✅ Rekap laporan TPP berhasil disalin ke clipboard!", Toast.LENGTH_LONG).show()
            }
        }
        headerInner.addView(btnCopyRecap)

        val btnExportPdf = TextView(activity).apply {
            text = "🖨️ Unduh PDF"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#059669"))
                cornerRadius = 6f * density
            }
            val p = (8 * density).toInt()
            setPadding(p, (4 * density).toInt(), p, (4 * density).toInt())
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginEnd = (8 * density).toInt()
            }
            setOnClickListener {
                val sm = SessionManager(activity)
                val base = sm.getServerIp().trimEnd('/')
                val token = sm.getToken() ?: ""
                val url = "$base/api/tpp/kurikulum/rekap-pdf?tahun=$selectedYear&triwulan=$selectedTw&token=$token"
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    activity.startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(activity, "Gagal membuka link PDF: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
        headerInner.addView(btnExportPdf)

        val btnRefresh = TextView(activity).apply {
            text = "🔄"
            textSize = 18f
            setTextColor(Color.WHITE)
            val rp = (6 * density).toInt()
            setPadding(rp, rp, rp, rp)
        }
        headerInner.addView(btnRefresh)
        headerCard.addView(headerInner)
        root.addView(headerCard)

        val scrollContent = ScrollView(activity).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        val dynamicContainer = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
        }
        contentInner.addView(dynamicContainer)

        fun loadMonitoring(tw: Int) {
            dynamicContainer.removeAllViews()

            val loadingLayout = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(20, 60, 20, 60)
                addView(ProgressBar(activity))
                addView(TextView(activity).apply {
                    text = "Memuat data monitoring TPP seluruh guru..."
                    textSize = 12.5f
                    setTextColor(Color.parseColor("#64748B"))
                    setPadding(0, 12, 0, 0)
                })
            }
            dynamicContainer.addView(loadingLayout)

            ApiClient.getClient(activity).getKurikulumTppMonitoring(selectedYear, tw, 0).enqueue(object : Callback<KurikulumTppMonitoringResponse> {
                override fun onResponse(call: Call<KurikulumTppMonitoringResponse>, response: Response<KurikulumTppMonitoringResponse>) {
                    dynamicContainer.removeAllViews()
                    val body = response.body()
                    if (!response.isSuccessful || body == null || !body.success) {
                        dynamicContainer.addView(TextView(activity).apply {
                            text = "❌ Gagal memuat data: ${body?.message ?: "Terjadi kesalahan server"}"
                            textSize = 13f
                            setTextColor(Color.parseColor("#DC2626"))
                            gravity = Gravity.CENTER
                            setPadding(20, 40, 20, 40)
                        })
                        return
                    }
                    lastMonitoringData = body

                    // 1. FILTER CHIPS TRIWULAN (TW1 s/d TW4)
                    val twFilterRow = LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        setPadding(0, 0, 0, (12 * density).toInt())
                    }
                    val twLabels = arrayOf("TW 1 (Jan-Mar)", "TW 2 (Apr-Jun)", "TW 3 (Jul-Sep)", "TW 4 (Okt-Des)")
                    for (i in 1..4) {
                        val isSel = i == tw
                        val chip = TextView(activity).apply {
                            text = twLabels[i - 1]
                            textSize = 11f
                            setTypeface(null, if (isSel) Typeface.BOLD else Typeface.NORMAL)
                            setTextColor(if (isSel) Color.WHITE else Color.parseColor("#475569"))
                            background = GradientDrawable().apply {
                                setColor(if (isSel) Color.parseColor("#4338CA") else Color.WHITE)
                                cornerRadius = 10f * density
                                if (!isSel) setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                            }
                            val p = (10 * density).toInt()
                            setPadding(p, (6 * density).toInt(), p, (6 * density).toInt())
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                marginEnd = (6 * density).toInt()
                            }
                            setOnClickListener {
                                selectedTw = i
                                loadMonitoring(i)
                            }
                        }
                        twFilterRow.addView(chip)
                    }
                    val scrollTw = HorizontalScrollView(activity).apply {
                        isFillViewport = false
                        isHorizontalScrollBarEnabled = false
                    }
                    scrollTw.addView(twFilterRow)
                    dynamicContainer.addView(scrollTw)

                    // 2. MACRO KPI ROW (Total, Cair, Proses, Sanggahan)
                    val kpi = body.kpi
                    val kpiCard = CardView(activity).apply {
                        radius = 16f * density
                        cardElevation = 2f * density
                        setCardBackgroundColor(Color.parseColor("#312E81"))
                        useCompatPadding = true
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (12 * density).toInt()
                        }
                    }
                    val kpiInner = LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                        val p = (14 * density).toInt()
                        setPadding(p, p, p, p)
                    }
                    kpiInner.addView(TextView(activity).apply {
                        text = "🏛️ REKAPITULASI PENCAIRAN GURU • TW $tw $selectedYear"
                        textSize = 11f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#C7D2FE"))
                    })
                    val kpiGrid = LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        weightSum = 4f
                        setPadding(0, 10, 0, 0)
                    }
                    fun makeKpiItem(count: Int, label: String, textCol: String): View {
                        return LinearLayout(activity).apply {
                            orientation = LinearLayout.VERTICAL
                            gravity = Gravity.CENTER
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                            addView(TextView(activity).apply {
                                text = "$count"
                                textSize = 16f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor(textCol))
                            })
                            addView(TextView(activity).apply {
                                text = label
                                textSize = 9.5f
                                setTextColor(Color.parseColor("#E0E7FF"))
                                gravity = Gravity.CENTER
                            })
                        }
                    }
                    val totalBelumCair = (kpi?.totalGuru ?: 0) - (kpi?.totalSudahCair ?: 0)
                    kpiGrid.addView(makeKpiItem(kpi?.totalGuru ?: 0, "Total Guru", "#FFFFFF"))
                    kpiGrid.addView(makeKpiItem(kpi?.totalSudahCair ?: 0, "🟢 Sudah Cair", "#4ADE80"))
                    kpiGrid.addView(makeKpiItem(totalBelumCair, "⏳ Belum Cair", "#FBBF24"))
                    kpiGrid.addView(makeKpiItem(kpi?.totalSanggahan ?: 0, "Sanggahan", "#C084FC"))
                    kpiInner.addView(kpiGrid)
                    kpiCard.addView(kpiInner)
                    dynamicContainer.addView(kpiCard)

                    // 3. SEARCH BAR
                    val etSearch = EditText(activity).apply {
                        hint = "🔍 Cari nama atau NIP guru..."
                        textSize = 12.5f
                        val p = (10 * density).toInt()
                        setPadding(p, p, p, p)
                        background = GradientDrawable().apply {
                            setColor(Color.WHITE)
                            setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                            cornerRadius = 10f * density
                        }
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (12 * density).toInt()
                        }
                    }
                    dynamicContainer.addView(etSearch)

                    // 4. LIST GURU DENGAN HEADER BERWARNA (TANPA NOMINAL RUPIAH)
                    val listContainer = LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                    }
                    dynamicContainer.addView(listContainer)

                    val teachers = body.teachers ?: emptyList()

                    fun renderTeachers(query: String) {
                        listContainer.removeAllViews()
                        val filtered = if (query.isBlank()) teachers else teachers.filter {
                            it.name.contains(query, ignoreCase = true) || it.nip.contains(query) || it.mapel.contains(query, ignoreCase = true)
                        }

                        if (filtered.isEmpty()) {
                            listContainer.addView(TextView(activity).apply {
                                text = "Tidak ada data guru yang cocok dengan pencarian."
                                textSize = 12f
                                setTextColor(Color.parseColor("#94A3B8"))
                                gravity = Gravity.CENTER
                                setPadding(0, 30, 0, 30)
                            })
                            return
                        }

                        for (t in filtered) {
                            val theme = getStatusTheme(t.status)

                            val card = CardView(activity).apply {
                                radius = 14f * density
                                cardElevation = 1.5f * density
                                setCardBackgroundColor(Color.WHITE)
                                useCompatPadding = true
                                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = (8 * density).toInt()
                                }
                            }
                            val cardLayout = LinearLayout(activity).apply {
                                orientation = LinearLayout.VERTICAL
                            }

                            // Header Strip Berwarna pada Kartu Guru
                            val tHeader = LinearLayout(activity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = Gravity.CENTER_VERTICAL
                                setBackgroundColor(Color.parseColor(theme.headerColor))
                                val p = (10 * density).toInt()
                                setPadding(p, (8 * density).toInt(), p, (8 * density).toInt())
                            }
                            tHeader.addView(TextView(activity).apply {
                                text = t.name
                                textSize = 13f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                            })
                            tHeader.addView(TextView(activity).apply {
                                text = "${theme.icon} ${theme.label}"
                                textSize = 9.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor(theme.badgeTextColor))
                                background = GradientDrawable().apply {
                                    setColor(Color.parseColor(theme.badgeBgColor))
                                    cornerRadius = 5f * density
                                }
                                val bp = (6 * density).toInt()
                                setPadding(bp, 2, bp, 2)
                            })
                            cardLayout.addView(tHeader)

                            val tBody = LinearLayout(activity).apply {
                                orientation = LinearLayout.VERTICAL
                                val p = (12 * density).toInt()
                                setPadding(p, p, p, p)
                            }
                            tBody.addView(TextView(activity).apply {
                                text = "NIP: ${t.nip} • Mapel: ${t.mapel} (Kelas: ${t.rombel})"
                                textSize = 11f
                                setTextColor(Color.parseColor("#64748B"))
                                setPadding(0, 0, 0, 4)
                            })
                            val isTCair = t.status.uppercase() == "SUDAH_CAIR"
                            tBody.addView(TextView(activity).apply {
                                val tgl = if (t.tanggalCairStr != "-") t.tanggalCairStr else "Belum Cair"
                                text = if (isTCair) "🎉 Telah Cair: $tgl • Verifikasi: ${t.statusVerifikasi}" else "⏳ Status: Belum Cair • Verifikasi: ${t.statusVerifikasi}"
                                textSize = 11.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor(if (isTCair) "#065F46" else "#92400E"))
                                setPadding(0, 0, 0, 4)
                            })

                            if (t.adaSanggahan) {
                                val disputeAlert = createMessageAlertBox(
                                    activity,
                                    density,
                                    title = "⚠️ SANGGAHAN DARI GURU INI",
                                    message = "Guru telah mengajukan permohonan koreksi / sanggahan pada periode ini.",
                                    headerBg = "#7C3AED",
                                    bodyBg = "#F5F3FF"
                                )
                                tBody.addView(disputeAlert)
                            }

                            // Tombol Update Tanggal / Verifikasi
                            val btnActionRow = LinearLayout(activity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = Gravity.END
                                setPadding(0, (4 * density).toInt(), 0, 0)
                            }
                            val btnVerify = TextView(activity).apply {
                                text = "⚡ Update Tanggal / Verifikasi"
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#2563EB"))
                                background = GradientDrawable().apply {
                                    setColor(Color.parseColor("#EFF6FF"))
                                    cornerRadius = 6f * density
                                }
                                val bp = (8 * density).toInt()
                                setPadding(bp, 4, bp, 4)
                                setOnClickListener {
                                    val periodIds = t.periods?.map { it.id } ?: emptyList()
                                    showKurikulumVerifyDialog(activity, t.name, periodIds) {
                                        loadMonitoring(tw)
                                    }
                                }
                            }
                            btnActionRow.addView(btnVerify)
                            tBody.addView(btnActionRow)

                            cardLayout.addView(tBody)
                            card.addView(cardLayout)
                            listContainer.addView(card)
                        }
                    }

                    renderTeachers("")

                    etSearch.addTextChangedListener(object : TextWatcher {
                        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                            renderTeachers(s?.toString()?.trim() ?: "")
                        }
                        override fun afterTextChanged(s: Editable?) {}
                    })
                }

                override fun onFailure(call: Call<KurikulumTppMonitoringResponse>, t: Throwable) {
                    dynamicContainer.removeAllViews()
                    dynamicContainer.addView(TextView(activity).apply {
                        text = "❌ Gagal memuat data: ${t.message}"
                        textSize = 13f
                        setTextColor(Color.parseColor("#DC2626"))
                        gravity = Gravity.CENTER
                        setPadding(20, 40, 20, 40)
                    })
                }
            })
        }

        btnRefresh.setOnClickListener {
            loadMonitoring(selectedTw)
        }

        loadMonitoring(selectedTw)
        dialog.setView(root)
        dialog.show()
    }

    /**
     * Dialog Verifikasi & Update Tanggal oleh Kurikulum
     */
    private fun showKurikulumVerifyDialog(
        activity: TeacherMainActivity,
        teacherName: String,
        recordIds: List<String>,
        onDone: () -> Unit
    ) {
        val density = activity.resources.displayMetrics.density
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }

        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1E3A8A"))
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        header.addView(TextView(activity).apply {
            text = "⚡ VERIFIKASI & UPDATE TANGGAL TPP"
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        header.addView(TextView(activity).apply {
            text = "Guru: $teacherName"
            textSize = 11.5f
            setTextColor(Color.parseColor("#BFDBFE"))
            setPadding(0, 2, 0, 0)
        })
        root.addView(header)

        val bodyLayout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        bodyLayout.addView(TextView(activity).apply {
            text = "Tanggal Pencairan / Verifikasi:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, 4)
        })

        val etDate = EditText(activity).apply {
            val sdf = SimpleDateFormat("dd MMMM yyyy", Locale("id", "ID"))
            setText(sdf.format(Date()))
            hint = "Contoh: 12 April 2026"
            textSize = 12.5f
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                cornerRadius = 8f * density
            }
        }
        bodyLayout.addView(etDate)

        bodyLayout.addView(TextView(activity).apply {
            text = "Catatan Kurikulum / Pendukung KBM:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 10, 0, 4)
        })

        val etNotes = EditText(activity).apply {
            hint = "Catatan status kehadiran / kelengkapan jurnal..."
            textSize = 12.5f
            minLines = 2
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                cornerRadius = 8f * density
            }
        }
        bodyLayout.addView(etNotes)
        root.addView(bodyLayout)

        AlertDialog.Builder(activity)
            .setView(root)
            .setPositiveButton("Simpan Verifikasi") { _, _ ->
                val dateStr = etDate.text.toString().trim()
                val notes = etNotes.text.toString().trim()

                val body = mapOf(
                    "tppRecordIds" to recordIds,
                    "statusVerifikasi" to "TERVERIFIKASI",
                    "tanggalCairStr" to dateStr,
                    "catatanKurikulum" to notes
                )

                Toast.makeText(activity, "Menyimpan verifikasi...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(activity).verifyKurikulumTpp(body).enqueue(object : Callback<GenericTppActionResponse> {
                    override fun onResponse(call: Call<GenericTppActionResponse>, response: Response<GenericTppActionResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(activity, "✅ Verifikasi TPP berhasil disimpan!", Toast.LENGTH_SHORT).show()
                            onDone()
                        } else {
                            Toast.makeText(activity, "Gagal: ${response.body()?.message ?: "Terjadi kesalahan"}", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<GenericTppActionResponse>, t: Throwable) {
                        Toast.makeText(activity, "Gagal koneksi: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    /**
     * Memeriksa status TPP secara otomatis saat guru membuka APK.
     * Jika terjadi perubahan status dari BELUM CAIR menjadi SUDAH CAIR,
     * APK Guru langsung menampilkan dialog perayaan & menginformasikan tanggal pencairannya.
     */
    fun checkTppNotificationBadge(activity: TeacherMainActivity) {
        val currentYear = Calendar.getInstance().get(Calendar.YEAR)
        ApiClient.getClient(activity).getMyTpp(currentYear).enqueue(object : Callback<MyTppResponse> {
            override fun onResponse(call: Call<MyTppResponse>, response: Response<MyTppResponse>) {
                val data = response.body() ?: return
                val teacherId = data.guru?.id ?: "me"
                val prefs = activity.getSharedPreferences("SP_TPP_MONITOR", Context.MODE_PRIVATE)
                val cacheKey = "CAIR_PERIODS_${teacherId}_$currentYear"
                val prevCairSet = prefs.getStringSet(cacheKey, null)

                val currentCairPeriods = mutableListOf<String>()
                val newlyCairList = mutableListOf<String>()
                var latestCairDate = "-"

                data.records?.forEach { r ->
                    if (r.status.uppercase() == "SUDAH_CAIR") {
                        val periodKey = "${r.triwulan}_${r.bulan}"
                        currentCairPeriods.add(periodKey)
                        if (prevCairSet != null && !prevCairSet.contains(periodKey)) {
                            newlyCairList.add(r.namaBulan)
                            if (!r.tanggalCairStr.isNullOrBlank() && r.tanggalCairStr != "-") {
                                latestCairDate = r.tanggalCairStr!!
                            }
                        }
                    }
                }

                // Update cache lokal
                prefs.edit().putStringSet(cacheKey, currentCairPeriods.toSet()).apply()

                if (newlyCairList.isNotEmpty()) {
                    val names = newlyCairList.joinToString(", ")
                    try {
                        AlertDialog.Builder(activity)
                            .setTitle("🎉 Pemberitahuan: TPP Anda Sudah Cair!")
                            .setMessage("Kabar gembira! Dana TPP periode:\n⭐ $names\n\nTelah resmi CAIR pada tanggal ${if (latestCairDate != "-") latestCairDate else "hari ini"}.\n\nSilakan cek rekening bank Anda.")
                            .setPositiveButton("Lihat Rincian TPP") { _, _ ->
                                showMyTppDialog(activity)
                            }
                            .setNegativeButton("Tutup", null)
                            .show()
                    } catch (e: Exception) {}
                }
            }

            override fun onFailure(call: Call<MyTppResponse>, t: Throwable) {
                // Silently ignore background check errors
            }
        })
    }
}
