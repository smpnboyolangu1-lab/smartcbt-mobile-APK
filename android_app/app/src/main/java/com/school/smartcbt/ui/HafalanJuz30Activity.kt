package com.school.smartcbt.ui

import android.app.AlertDialog
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.data.remote.ApiClient
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.text.SimpleDateFormat
import java.util.*

class HafalanJuz30Activity : AppCompatActivity() {

    data class SurahItem(
        val number: Int,
        val nameLatin: String,
        val nameArabic: String,
        val meaning: String,
        val ayatCount: Int,
        val place: String,
        val audioUrl: String = ""
    )

    private val surahList = listOf(
        SurahItem(78, "An-Naba'", "النَّبَإِ", "Berita Besar", 40, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/078.mp3"),
        SurahItem(79, "An-Nazi'at", "النَّازِعَاتِ", "Malaikat Pencabut", 46, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/079.mp3"),
        SurahItem(80, "'Abasa", "عَبَسَ", "Ia Bermuka Masam", 42, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/080.mp3"),
        SurahItem(81, "At-Takwir", "التَّكْوِيرِ", "Menggulung", 29, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/081.mp3"),
        SurahItem(82, "Al-Infitar", "الانْفِطَارِ", "Terbelah", 19, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/082.mp3"),
        SurahItem(83, "Al-Muthaffifin", "المُطَفِّفِينَ", "Orang Curang", 36, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/083.mp3"),
        SurahItem(84, "Al-Inshiqaq", "الانْشِقَاقِ", "Terbelah", 25, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/084.mp3"),
        SurahItem(85, "Al-Buruj", "البُرُوجِ", "Gugusan Bintang", 22, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/085.mp3"),
        SurahItem(86, "At-Tariq", "الطَّارِقِ", "Bintang di Malam Hari", 17, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/086.mp3"),
        SurahItem(87, "Al-A'la", "الأَعْلَى", "Yang Maha Tinggi", 19, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/087.mp3"),
        SurahItem(88, "Al-Ghasyiyah", "الغَاشِيَةِ", "Hari Pembalasan", 26, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/088.mp3"),
        SurahItem(89, "Al-Fajr", "الفَجْرِ", "Fajar", 30, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/089.mp3"),
        SurahItem(90, "Al-Balad", "البَلَدِ", "Negeri", 20, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/090.mp3"),
        SurahItem(91, "Asy-Syams", "الشَّمْسِ", "Matahari", 15, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/091.mp3"),
        SurahItem(92, "Al-Lail", "اللَّيْلِ", "Malam", 21, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/092.mp3"),
        SurahItem(93, "Ad-Duha", "الضُّحَى", "Waktu Dhuha", 11, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/093.mp3"),
        SurahItem(94, "Asy-Syarh", "الشَّرْحِ", "Kelapangan", 8, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/094.mp3"),
        SurahItem(95, "At-Tin", "التِّينِ", "Buah Tin", 8, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/095.mp3"),
        SurahItem(96, "Al-'Alaq", "العَلَقِ", "Segumpal Darah", 19, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/096.mp3"),
        SurahItem(97, "Al-Qadr", "القَدْرِ", "Kemuliaan", 5, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/097.mp3"),
        SurahItem(98, "Al-Bayyinah", "البَيِّنَةِ", "Bukti Nyata", 8, "Madaniyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/098.mp3"),
        SurahItem(99, "Az-Zalzalah", "الزَّلْزَلَةِ", "Kegoncangan", 8, "Madaniyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/099.mp3"),
        SurahItem(100, "Al-'Adiyat", "العَادِيَاتِ", "Kuda Perang Berlari Kencang", 11, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/100.mp3"),
        SurahItem(101, "Al-Qari'ah", "القَارِعَةِ", "Hari Kiamat", 11, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/101.mp3"),
        SurahItem(102, "At-Takatsur", "التَّكَاثُرِ", "Bermegah-Megahan", 8, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/102.mp3"),
        SurahItem(103, "Al-'Asr", "العَصْرِ", "Masa / Waktu", 3, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/103.mp3"),
        SurahItem(104, "Al-Humazah", "الهُمَزَةِ", "Pengumpat", 9, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/104.mp3"),
        SurahItem(105, "Al-Fil", "الفِيلِ", "Gajah", 5, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/105.mp3"),
        SurahItem(106, "Quraisy", "قُرَيْشٍ", "Suku Quraisy", 4, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/106.mp3"),
        SurahItem(107, "Al-Ma'un", "المَاعُونِ", "Barang Berguna", 7, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/107.mp3"),
        SurahItem(108, "Al-Kautsar", "الكَوْثَرِ", "Nikmat Berlimpah", 3, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/108.mp3"),
        SurahItem(109, "Al-Kafirun", "الكَافِرُونَ", "Orang-Orang Kafir", 6, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/109.mp3"),
        SurahItem(110, "An-Nasr", "النَّصْرِ", "Pertolongan", 3, "Madaniyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/110.mp3"),
        SurahItem(111, "Al-Lahab", "المَسَدِ", "Gejolak Api", 5, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/111.mp3"),
        SurahItem(112, "Al-Ikhlas", "الإِخْلَاصِ", "Keesaan Allah", 4, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/112.mp3"),
        SurahItem(113, "Al-Falaq", "الفَلَقِ", "Waktu Subuh", 5, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/113.mp3"),
        SurahItem(114, "An-Nas", "النَّاسِ", "Manusia", 6, "Makkiyah", "https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/114.mp3")
    )

    private lateinit var prefs: SharedPreferences
    private var currentTab = "SURAH" // SURAH, TARGET, SETORAN, PRESTASI
    private var currentFilter = "ALL" // ALL, MUTQIN, PROGRES, BELUM
    private var searchQuery = ""

    private var mediaPlayer: MediaPlayer? = null
    private var currentlyPlayingSurahNum: Int? = null

    // UI Views
    private lateinit var tvMutqinCount: TextView
    private lateinit var tvProgresCount: TextView
    private lateinit var tvBelumCount: TextView
    private lateinit var tvProgressPercentage: TextView
    private lateinit var progressBar: ProgressBar

    private lateinit var containerSurahList: LinearLayout
    private lateinit var containerTargetList: LinearLayout
    private lateinit var containerSetoranHistory: LinearLayout
    private lateinit var containerPrestasiView: LinearLayout

    private lateinit var tabBtnSurah: TextView
    private lateinit var tabBtnTarget: TextView
    private lateinit var tabBtnSetoran: TextView
    private lateinit var tabBtnPrestasi: TextView

    private lateinit var paneSurah: LinearLayout
    private lateinit var paneTarget: LinearLayout
    private lateinit var paneSetoran: LinearLayout
    private lateinit var panePrestasi: LinearLayout

    private var liveTargets: List<Map<String, Any>> = emptyList()
    private var liveEvaluations: List<Map<String, Any>> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("smartcbt_hafalan_juz30", Context.MODE_PRIVATE)

        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Header Bar
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#065F46"))
            val padH = dp(16)
            val padV = dp(14)
            setPadding(padH, padV, padH, padV)
            gravity = Gravity.CENTER_VERTICAL
        }

        val btnBack = TextView(this).apply {
            text = "←"
            textSize = 22f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, dp(14), 0)
            setOnClickListener { finish() }
        }
        header.addView(btnBack)

        val headerTextLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvHeaderTitle = TextView(this).apply {
            text = "📖 Tahfiz & Murojaah Juz 30"
            textSize = 15.5f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
        }
        val tvHeaderSub = TextView(this).apply {
            text = "APK Siswa • 37 Surah Juz 'Amma • SMPN 1 Boyolangu"
            textSize = 11f
            setTextColor(Color.parseColor("#D1FAE5"))
        }
        headerTextLayout.addView(tvHeaderTitle)
        headerTextLayout.addView(tvHeaderSub)
        header.addView(headerTextLayout)
        root.addView(header)

        // 4 Main Segmented Tabs (A. Daftar Surat, B. Target, C. Setoran, D. Prestasi)
        val tabContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
            val padH = dp(8)
            val padV = dp(6)
            setPadding(padH, padV, padH, padV)
            weightSum = 4f
        }

        tabBtnSurah = createTabButton("📖 Surat", 0f).apply {
            setOnClickListener { switchTab("SURAH") }
        }
        tabBtnTarget = createTabButton("🎯 Target", 0f).apply {
            setOnClickListener { switchTab("TARGET") }
        }
        tabBtnSetoran = createTabButton("📥 Setor", 0f).apply {
            setOnClickListener { switchTab("SETORAN") }
        }
        tabBtnPrestasi = createTabButton("🏆 Prestasi", 0f).apply {
            setOnClickListener { switchTab("PRESTASI") }
        }

        tabContainer.addView(tabBtnSurah)
        tabContainer.addView(tabBtnTarget)
        tabContainer.addView(tabBtnSetoran)
        tabContainer.addView(tabBtnPrestasi)
        root.addView(tabContainer)

        // Scrollable Body
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val mainContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(14)
            setPadding(pad, pad, pad, dp(24))
        }

        // ==================== PANE A: DAFTAR SURAT ====================
        paneSurah = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        // Progress Overview Card
        val cardProgress = CardView(this).apply {
            radius = dp(16).toFloat()
            cardElevation = dp(2).toFloat()
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
        }
        val innerProgress = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
        }

        val rowProgressTop = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val tvProgressTitle = TextView(this).apply {
            text = "🎯 Target Capaian Hafalan Mandiri"
            textSize = 13f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        tvProgressPercentage = TextView(this).apply {
            text = "0%"
            textSize = 15f
            setTextColor(Color.parseColor("#059669"))
            setTypeface(null, Typeface.BOLD)
        }
        rowProgressTop.addView(tvProgressTitle)
        rowProgressTop.addView(tvProgressPercentage)
        innerProgress.addView(rowProgressTop)

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 37
            progress = 0
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8)).apply {
                topMargin = dp(8)
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        innerProgress.addView(progressBar)

        // Stats mini counters
        val rowStats = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
        }

        fun createStatCard(title: String, colorText: String, bgColor: String): Pair<LinearLayout, TextView> {
            val tvCount = TextView(this).apply {
                text = "0"
                textSize = 18f
                setTextColor(Color.parseColor(colorText))
                setTypeface(null, Typeface.BOLD)
            }
            val tvLabel = TextView(this).apply {
                text = title
                textSize = 10f
                setTextColor(Color.parseColor("#64748B"))
                setTypeface(null, Typeface.BOLD)
            }
            val col = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setBackgroundColor(Color.parseColor(bgColor))
                val p = dp(8)
                setPadding(p, p, p, p)
                val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginEnd = dp(6)
                }
                layoutParams = lp
                addView(tvCount)
                addView(tvLabel)
            }
            return Pair(col, tvCount)
        }

        val (statMutqin, tvM) = createStatCard("Lulus (Mutqin)", "#059669", "#ECFDF5")
        val (statProgres, tvP) = createStatCard("Menghafal", "#D97706", "#FFFBEB")
        val (statBelum, tvB) = createStatCard("Belum Mulai", "#475569", "#F1F5F9")

        tvMutqinCount = tvM
        tvProgresCount = tvP
        tvBelumCount = tvB

        rowStats.addView(statMutqin)
        rowStats.addView(statProgres)
        rowStats.addView(statBelum)
        innerProgress.addView(rowStats)
        cardProgress.addView(innerProgress)
        paneSurah.addView(cardProgress)

        // Search Bar & Filter Chips
        val searchCard = CardView(this).apply {
            radius = dp(12).toFloat()
            cardElevation = dp(1).toFloat()
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(6)
            }
            layoutParams = lp
        }
        val etSearch = EditText(this).apply {
            hint = "🔍 Cari nama surah, arti, atau nomor..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#1E293B"))
            setHintTextColor(Color.parseColor("#94A3B8"))
            setBackgroundColor(Color.TRANSPARENT)
            val p = dp(10)
            setPadding(p, p, p, p)
            addTextChangedListener(object : TextWatcher {
                override fun afterTextChanged(s: Editable?) {
                    searchQuery = s?.toString()?.trim() ?: ""
                    renderSurahList()
                }
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            })
        }
        searchCard.addView(etSearch)
        paneSurah.addView(searchCard)

        containerSurahList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            }
            layoutParams = lp
        }
        paneSurah.addView(containerSurahList)
        mainContent.addView(paneSurah)

        // ==================== PANE B: TARGET HAFALANKU ====================
        paneTarget = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        val cardTargetHeader = CardView(this).apply {
            radius = dp(16).toFloat()
            cardElevation = dp(2).toFloat()
            setCardBackgroundColor(Color.parseColor("#065F46"))
            useCompatPadding = true
        }
        val innerTargetHeader = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        val tvTargetHead = TextView(this).apply {
            text = "🎯 Target Hafalan Dari Guru PAI & Target Pribadi"
            textSize = 14f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
        }
        val tvTargetSub = TextView(this).apply {
            text = "Selesaikan target hafalan bertahap agar tidak terbebani saat evaluasi semester."
            textSize = 11f
            setTextColor(Color.parseColor("#A7F3D0"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(4)
            }
            layoutParams = lp
        }
        innerTargetHeader.addView(tvTargetHead)
        innerTargetHeader.addView(tvTargetSub)
        cardTargetHeader.addView(innerTargetHeader)
        paneTarget.addView(cardTargetHeader)

        containerTargetList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            }
            layoutParams = lp
        }
        paneTarget.addView(containerTargetList)
        mainContent.addView(paneTarget)

        // ==================== PANE C: SETORAN HAFALAN ====================
        paneSetoran = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        val cardSetorAction = CardView(this).apply {
            radius = dp(16).toFloat()
            cardElevation = dp(2).toFloat()
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
        }
        val innerSetorAction = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        val tvSetorTitle = TextView(this).apply {
            text = "📥 Ajukan Setoran Hafalan Baru"
            textSize = 14f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
        }
        val tvSetorDesc = TextView(this).apply {
            text = "Pilih surat dan ayat yang ingin kamu setorkan. Kamu dapat memilih setoran langsung tatap muka atau rekaman audio suara."
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(4)
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        val btnOpenSetoranForm = Button(this).apply {
            text = "🚀 Buat Pengajuan Setoran Sekarang"
            setBackgroundColor(Color.parseColor("#059669"))
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            setOnClickListener { showSetoranFormDialog() }
        }
        innerSetorAction.addView(tvSetorTitle)
        innerSetorAction.addView(tvSetorDesc)
        innerSetorAction.addView(btnOpenSetoranForm)
        cardSetorAction.addView(innerSetorAction)
        paneSetoran.addView(cardSetorAction)

        val tvHistoryHead = TextView(this).apply {
            text = "📜 Riwayat Pengajuan & Catatan Koreksi Guru:"
            textSize = 13f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(14)
                bottomMargin = dp(6)
            }
            layoutParams = lp
        }
        paneSetoran.addView(tvHistoryHead)

        containerSetoranHistory = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        paneSetoran.addView(containerSetoranHistory)
        mainContent.addView(paneSetoran)

        // ==================== PANE D: PRESTASI & LENCANA ====================
        panePrestasi = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        containerPrestasiView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        panePrestasi.addView(containerPrestasiView)
        mainContent.addView(panePrestasi)

        scroll.addView(mainContent)
        root.addView(scroll)
        setContentView(root)

        // Load Initial Data & Sync
        switchTab("SURAH")
        syncDataFromServer()
    }

    private fun createTabButton(textLabel: String, weightVal: Float): TextView {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        return TextView(this).apply {
            text = textLabel
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            val p = dp(8)
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            layoutParams = lp
        }
    }

    private fun switchTab(targetTab: String) {
        currentTab = targetTab
        tabBtnSurah.setTextColor(if (targetTab == "SURAH") Color.parseColor("#065F46") else Color.parseColor("#64748B"))
        tabBtnTarget.setTextColor(if (targetTab == "TARGET") Color.parseColor("#065F46") else Color.parseColor("#64748B"))
        tabBtnSetoran.setTextColor(if (targetTab == "SETORAN") Color.parseColor("#065F46") else Color.parseColor("#64748B"))
        tabBtnPrestasi.setTextColor(if (targetTab == "PRESTASI") Color.parseColor("#065F46") else Color.parseColor("#64748B"))

        paneSurah.visibility = if (targetTab == "SURAH") View.VISIBLE else View.GONE
        paneTarget.visibility = if (targetTab == "TARGET") View.VISIBLE else View.GONE
        paneSetoran.visibility = if (targetTab == "SETORAN") View.VISIBLE else View.GONE
        panePrestasi.visibility = if (targetTab == "PRESTASI") View.VISIBLE else View.GONE

        when (targetTab) {
            "SURAH" -> {
                updateOverviewStats()
                renderSurahList()
            }
            "TARGET" -> renderTargetList()
            "SETORAN" -> renderSetoranHistory()
            "PRESTASI" -> renderPrestasiView()
        }
    }

    private fun getSurahStatus(number: Int): String {
        return prefs.getString("surah_status_$number", "BELUM") ?: "BELUM"
    }

    private fun setSurahStatus(number: Int, status: String) {
        prefs.edit().putString("surah_status_$number", status).apply()
        updateOverviewStats()
        renderSurahList()
    }

    private fun updateOverviewStats() {
        var mutqin = 0
        var progres = 0
        var belum = 0

        for (s in surahList) {
            when (getSurahStatus(s.number)) {
                "MUTQIN" -> mutqin++
                "PROGRES" -> progres++
                else -> belum++
            }
        }

        tvMutqinCount.text = "$mutqin"
        tvProgresCount.text = "$progres"
        tvBelumCount.text = "$belum"

        val percent = if (surahList.isNotEmpty()) (mutqin * 100) / surahList.size else 0
        tvProgressPercentage.text = "$percent% ($mutqin/37 Surah)"
        progressBar.progress = mutqin
    }

    private fun renderSurahList() {
        containerSurahList.removeAllViews()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val filtered = surahList.filter { s ->
            val status = getSurahStatus(s.number)
            val matchFilter = when (currentFilter) {
                "MUTQIN" -> status == "MUTQIN"
                "PROGRES" -> status == "PROGRES"
                "BELUM" -> status == "BELUM"
                else -> true
            }
            val matchSearch = if (searchQuery.isEmpty()) true else {
                s.nameLatin.contains(searchQuery, ignoreCase = true) ||
                        s.meaning.contains(searchQuery, ignoreCase = true) ||
                        s.number.toString().contains(searchQuery)
            }
            matchFilter && matchSearch
        }

        if (filtered.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Tidak ada surah yang cocok dengan filter atau pencarian."
                textSize = 12f
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, dp(30), 0, dp(30))
                gravity = Gravity.CENTER
            }
            containerSurahList.addView(tvEmpty)
            return
        }

        for (s in filtered) {
            val status = getSurahStatus(s.number)
            val card = CardView(this).apply {
                radius = dp(12).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }

            // Top Row: Number, Latin name, Arabic name
            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val tvNum = TextView(this).apply {
                text = "${s.number}"
                textSize = 11f
                setTextColor(Color.WHITE)
                setTypeface(null, Typeface.BOLD)
                setBackgroundColor(Color.parseColor("#047857"))
                gravity = Gravity.CENTER
                val size = dp(28)
                layoutParams = LinearLayout.LayoutParams(size, size).apply { marginEnd = dp(10) }
            }
            topRow.addView(tvNum)

            val nameCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val tvLatin = TextView(this).apply {
                text = s.nameLatin
                textSize = 14f
                setTextColor(Color.parseColor("#0F172A"))
                setTypeface(null, Typeface.BOLD)
            }
            val tvMeta = TextView(this).apply {
                text = "${s.meaning} • ${s.ayatCount} Ayat • ${s.place}"
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
            }
            nameCol.addView(tvLatin)
            nameCol.addView(tvMeta)
            topRow.addView(nameCol)

            val tvArabic = TextView(this).apply {
                text = s.nameArabic
                textSize = 16f
                setTextColor(Color.parseColor("#065F46"))
                setTypeface(null, Typeface.BOLD)
            }
            topRow.addView(tvArabic)
            inner.addView(topRow)

            // Action Row: Audio Player Button, Status Badge, Setor Button
            val actionRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(10)
                }
                layoutParams = lp
            }

            // Audio Murattal Play/Pause
            val isPlayingThis = (currentlyPlayingSurahNum == s.number && mediaPlayer?.isPlaying == true)
            val btnAudio = TextView(this).apply {
                text = if (isPlayingThis) "⏹️ Berhenti" else "▶️ Murattal"
                textSize = 10.5f
                setTextColor(if (isPlayingThis) Color.parseColor("#E11D48") else Color.parseColor("#0D9488"))
                setTypeface(null, Typeface.BOLD)
                setBackgroundColor(Color.parseColor(if (isPlayingThis) "#FFE4E6" else "#CCFBF1"))
                val padH = dp(8)
                val padV = dp(4)
                setPadding(padH, padV, padH, padV)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = dp(8)
                }
                layoutParams = lp
                setOnClickListener {
                    togglePlayAudio(s)
                }
            }
            actionRow.addView(btnAudio)

            val btnStatusBadge = TextView(this).apply {
                val (txt, bgCol, textCol) = when (status) {
                    "MUTQIN" -> Triple("🟢 Tuntas (Mutqin)", "#DCFCE7", "#15803D")
                    "PROGRES" -> Triple("🟡 Sedang Dihafal", "#FEF3C7", "#D97706")
                    "MENUNGGU" -> Triple("⏳ Menunggu Nilai", "#E0E7FF", "#4338CA")
                    "MUROJAAH" -> Triple("🟣 Perlu Murojaah", "#F3E8FF", "#7E22CE")
                    else -> Triple("⚪ Belum Dihafal", "#F1F5F9", "#64748B")
                }
                text = txt
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(textCol))
                setBackgroundColor(Color.parseColor(bgCol))
                val padH = dp(8)
                val padV = dp(4)
                setPadding(padH, padV, padH, padV)
                setOnClickListener {
                    showStatusPickerDialog(s)
                }
            }
            actionRow.addView(btnStatusBadge)

            val spacer = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
            }
            actionRow.addView(spacer)

            val btnSetor = TextView(this).apply {
                text = "Ajukan Setoran →"
                textSize = 11f
                setTextColor(Color.parseColor("#0284C7"))
                setTypeface(null, Typeface.BOLD)
                val padH = dp(6)
                val padV = dp(4)
                setPadding(padH, padV, padH, padV)
                setOnClickListener {
                    showSetoranFormDialog(s.number)
                }
            }
            actionRow.addView(btnSetor)

            inner.addView(actionRow)

            // GAP-03: Tampilkan Nilai Penguji & Catatan Feedback Guru jika ada
            val teacherScore = prefs.getFloat("surah_score_${s.number}", -1f)
            val teacherNote = prefs.getString("surah_feedback_${s.number}", null)
            if (teacherScore >= 0 || !teacherNote.isNullOrEmpty()) {
                val feedbackBox = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.parseColor("#F0FDF4"))
                    val pad = dp(8)
                    setPadding(pad, pad, pad, pad)
                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = dp(8)
                    }
                    layoutParams = lp
                }
                if (teacherScore >= 0) {
                    val tvScore = TextView(this).apply {
                        text = "⭐ Nilai Guru PAI: ${teacherScore.toInt()} / 100"
                        textSize = 10.5f
                        setTextColor(Color.parseColor("#15803D"))
                        setTypeface(null, Typeface.BOLD)
                    }
                    feedbackBox.addView(tvScore)
                }
                if (!teacherNote.isNullOrEmpty()) {
                    val tvNote = TextView(this).apply {
                        text = "💬 Catatan: \"$teacherNote\""
                        textSize = 10f
                        setTextColor(Color.parseColor("#334155"))
                    }
                    feedbackBox.addView(tvNote)
                }
                inner.addView(feedbackBox)
            }

            card.addView(inner)
            containerSurahList.addView(card)
        }
    }

    private fun togglePlayAudio(surah: SurahItem) {
        if (currentlyPlayingSurahNum == surah.number && mediaPlayer?.isPlaying == true) {
            mediaPlayer?.stop()
            mediaPlayer?.release()
            mediaPlayer = null
            currentlyPlayingSurahNum = null
            renderSurahList()
            return
        }

        try {
            mediaPlayer?.release()
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .build()
                )
                setDataSource(surah.audioUrl)
                setOnPreparedListener {
                    start()
                    currentlyPlayingSurahNum = surah.number
                    renderSurahList()
                    Toast.makeText(this@HafalanJuz30Activity, "Memutar Murattal: ${surah.nameLatin}", Toast.LENGTH_SHORT).show()
                }
                setOnCompletionListener {
                    currentlyPlayingSurahNum = null
                    renderSurahList()
                }
                prepareAsync()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal memutar audio: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showStatusPickerDialog(surah: SurahItem) {
        val options = arrayOf(
            "🟢 Sudah Lulus (Mutqin)",
            "🟡 Sedang Menghafal",
            "🟣 Perlu Murojaah Pengulangan",
            "⚪ Belum Mulai"
        )
        val current = when (getSurahStatus(surah.number)) {
            "MUTQIN" -> 0
            "PROGRES" -> 1
            "MUROJAAH" -> 2
            else -> 3
        }

        AlertDialog.Builder(this)
            .setTitle("Status Hafalan: ${surah.nameLatin}")
            .setSingleChoiceItems(options, current) { dialog, which ->
                val newStatus = when (which) {
                    0 -> "MUTQIN"
                    1 -> "PROGRES"
                    2 -> "MUROJAAH"
                    else -> "BELUM"
                }
                setSurahStatus(surah.number, newStatus)
                dialog.dismiss()
                Toast.makeText(this, "Status ${surah.nameLatin} diperbarui!", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Tutup", null)
            .show()
    }

    // ==================== TAB B: TARGET HAFALANKU ====================
    private fun renderTargetList() {
        containerTargetList.removeAllViews()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        if (liveTargets.isEmpty()) {
            val cardEmpty = CardView(this).apply {
                radius = dp(14).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
            }
            val innerEmpty = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(20)
                setPadding(p, p, p, p)
                gravity = Gravity.CENTER
            }
            val tvIcon = TextView(this).apply {
                text = "🎯"
                textSize = 32f
                gravity = Gravity.CENTER
            }
            val tvTitle = TextView(this).apply {
                text = "Target Hafalan Kelas & Mandiri"
                textSize = 14f
                setTextColor(Color.parseColor("#065F46"))
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(6)
                }
                layoutParams = lp
            }
            val tvMsg = TextView(this).apply {
                text = "Belum ada target khusus dari Guru PAI untuk kelas ini.\nSilakan pilih surah di tab 'Surat' untuk memulai setoran mandiri."
                textSize = 11.5f
                setTextColor(Color.parseColor("#64748B"))
                gravity = Gravity.CENTER
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            innerEmpty.addView(tvIcon)
            innerEmpty.addView(tvTitle)
            innerEmpty.addView(tvMsg)
            cardEmpty.addView(innerEmpty)
            containerTargetList.addView(cardEmpty)
            return
        }

        for (t in liveTargets) {
            val surahNum = (t["surah_number"] as? Number)?.toInt() ?: 114
            val surahName = t["surah_name"] as? String ?: "Surat Juz 30"
            val ayatStart = (t["ayat_start"] as? Number)?.toInt() ?: 1
            val ayatEnd = (t["ayat_end"] as? Number)?.toInt() ?: 10
            val targetType = t["target_type"] as? String ?: "KELAS"
            val deadline = t["deadline_date"] as? String ?: "Sesuai Kalender Akademik"
            val semester = t["semester"] as? String ?: "Ganjil"
            val academicYear = t["academic_year"] as? String ?: "2026/2027"

            val card = CardView(this).apply {
                radius = dp(14).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
            }
            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(14)
                setPadding(p, p, p, p)
            }

            val rowHead = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val title = TextView(this).apply {
                text = "Surat $surahName (Ayat $ayatStart-$ayatEnd)"
                textSize = 13.5f
                setTextColor(Color.parseColor("#065F46"))
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            val badgeType = TextView(this).apply {
                text = targetType
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0284C7"))
                setBackgroundColor(Color.parseColor("#E0F2FE"))
                setPadding(dp(8), dp(3), dp(8), dp(3))
            }
            rowHead.addView(title)
            rowHead.addView(badgeType)
            inner.addView(rowHead)

            val desc = TextView(this).apply {
                text = "Target PAI • Semester $semester ($academicYear)"
                textSize = 11.5f
                setTextColor(Color.parseColor("#475569"))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            inner.addView(desc)

            val dl = TextView(this).apply {
                text = "📅 Batas Waktu: $deadline"
                textSize = 10.5f
                setTextColor(Color.parseColor("#D97706"))
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            inner.addView(dl)

            val btnStartTarget = TextView(this).apply {
                text = "Mulai Setor Surat Ini →"
                textSize = 11.5f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#059669"))
                setTypeface(null, Typeface.BOLD)
                gravity = Gravity.CENTER
                val p = dp(8)
                setPadding(p, p, p, p)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(10)
                }
                layoutParams = lp
                setOnClickListener {
                    showSetoranFormDialog(surahNum)
                }
            }
            inner.addView(btnStartTarget)

            card.addView(inner)
            containerTargetList.addView(card)
        }
    }

    // ==================== TAB C: SETORAN HAFALAN ====================
    private fun showSetoranFormDialog(preselectedSurahNum: Int? = null) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(16)
            setPadding(pad, pad, pad, pad)
        }

        val tvTitle = TextView(this).apply {
            text = "Formulir Setoran Hafalan ke Guru PAI"
            textSize = 15f
            setTextColor(Color.parseColor("#065F46"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
        }
        dialogView.addView(tvTitle)

        // Surah Spinner
        val tvSurahLbl = TextView(this).apply { text = "Pilih Surat:"; textSize = 11.5f; setTextColor(Color.parseColor("#475569")) }
        dialogView.addView(tvSurahLbl)

        val spinnerSurah = Spinner(this)
        val surahNames = surahList.map { "${it.number}. ${it.nameLatin} (${it.ayatCount} Ayat)" }
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, surahNames)
        spinnerSurah.adapter = adapter
        if (preselectedSurahNum != null) {
            val idx = surahList.indexOfFirst { it.number == preselectedSurahNum }
            if (idx >= 0) spinnerSurah.setSelection(idx)
        }
        dialogView.addView(spinnerSurah)

        // Ayat Range
        val rowAyat = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            }
            layoutParams = lp
        }
        val etAyatStart = EditText(this).apply {
            hint = "Ayat Awal"
            setText("1")
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(6) }
        }
        val etAyatEnd = EditText(this).apply {
            hint = "Ayat Akhir"
            setText("10")
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        rowAyat.addView(etAyatStart)
        rowAyat.addView(etAyatEnd)
        dialogView.addView(rowAyat)

        // Modern Selectable Pills for Metode Setoran (Anti-Bug Single Choice)
        val tvMetodeLbl = TextView(this).apply {
            text = "Metode Setoran:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(10)
            }
            layoutParams = lp
        }
        dialogView.addView(tvMetodeLbl)

        var selectedMetode = "LANGSUNG"
        val rowMetode = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(4)
                bottomMargin = dp(8)
            }
            layoutParams = lp
        }

        val btnMetodeLangsung = TextView(this).apply {
            text = "🗣️ Langsung"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            val p = dp(10)
            setPadding(p, p, p, p)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(4) }
        }

        val btnMetodeAudio = TextView(this).apply {
            text = "🎧 Rekaman Audio"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            val p = dp(10)
            setPadding(p, p, p, p)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(4) }
        }

        fun updateMetodeUI() {
            if (selectedMetode == "LANGSUNG") {
                btnMetodeLangsung.setBackgroundColor(Color.parseColor("#065F46"))
                btnMetodeLangsung.setTextColor(Color.WHITE)
                btnMetodeAudio.setBackgroundColor(Color.parseColor("#E2E8F0"))
                btnMetodeAudio.setTextColor(Color.parseColor("#475569"))
            } else {
                btnMetodeAudio.setBackgroundColor(Color.parseColor("#065F46"))
                btnMetodeAudio.setTextColor(Color.WHITE)
                btnMetodeLangsung.setBackgroundColor(Color.parseColor("#E2E8F0"))
                btnMetodeLangsung.setTextColor(Color.parseColor("#475569"))
            }
        }
        btnMetodeLangsung.setOnClickListener { selectedMetode = "LANGSUNG"; updateMetodeUI() }
        btnMetodeAudio.setOnClickListener { selectedMetode = "REKAMAN_AUDIO"; updateMetodeUI() }
        updateMetodeUI()

        rowMetode.addView(btnMetodeLangsung)
        rowMetode.addView(btnMetodeAudio)
        dialogView.addView(rowMetode)

        val etNotes = EditText(this).apply {
            hint = "Catatan santri untuk ustadz / guru PAI..."
            textSize = 12f
            setLines(2)
        }
        dialogView.addView(etNotes)

        AlertDialog.Builder(this)
            .setView(dialogView)
            .setPositiveButton("Kirim Setoran") { dialog, _ ->
                val selectedIdx = spinnerSurah.selectedItemPosition
                val chosenSurah = surahList[selectedIdx]
                val aStart = etAyatStart.text.toString().toIntOrNull() ?: 1
                val aEnd = etAyatEnd.text.toString().toIntOrNull() ?: chosenSurah.ayatCount
                val notes = etNotes.text.toString().trim()

                submitSetoranToServer(chosenSurah, aStart, aEnd, selectedMetode, notes)
                dialog.dismiss()
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun submitSetoranToServer(surah: SurahItem, ayatStart: Int, ayatEnd: Int, metode: String, notes: String) {
        val body = mapOf(
            "surahNumber" to surah.number,
            "surahName" to surah.nameLatin,
            "ayatStart" to ayatStart,
            "ayatEnd" to ayatEnd,
            "metode" to metode,
            "notes" to notes
        )

        Toast.makeText(this, "Mengirim pengajuan setoran...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).submitTahfizSetoran(body).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (response.isSuccessful && response.body()?.get("success") == true) {
                    Toast.makeText(this@HafalanJuz30Activity, "✅ Setoran ${surah.nameLatin} berhasil diajukan!", Toast.LENGTH_LONG).show()
                    setSurahStatus(surah.number, "MENUNGGU")
                    syncDataFromServer()
                } else {
                    Toast.makeText(this@HafalanJuz30Activity, "Setoran disimpan: ${response.message()}", Toast.LENGTH_SHORT).show()
                    setSurahStatus(surah.number, "MENUNGGU")
                    syncDataFromServer()
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                Toast.makeText(this@HafalanJuz30Activity, "Tersimpan offline: Disinkron saat koneksi kembali", Toast.LENGTH_SHORT).show()
                setSurahStatus(surah.number, "MENUNGGU")
                renderSetoranHistory()
            }
        })
    }

    private fun renderSetoranHistory() {
        containerSetoranHistory.removeAllViews()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        if (liveEvaluations.isEmpty()) {
            val cardEmpty = CardView(this).apply {
                radius = dp(14).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
            }
            val innerEmpty = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(20)
                setPadding(p, p, p, p)
                gravity = Gravity.CENTER
            }
            val tvIcon = TextView(this).apply {
                text = "📜"
                textSize = 32f
                gravity = Gravity.CENTER
            }
            val tvTitle = TextView(this).apply {
                text = "Riwayat Penilaian Setoran"
                textSize = 14f
                setTextColor(Color.parseColor("#065F46"))
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(6)
                }
                layoutParams = lp
            }
            val tvMsg = TextView(this).apply {
                text = "Belum ada riwayat penilaian setoran dari Guru PAI.\nAjukan setoran hafalan pertama Anda melalui tombol 'Ajukan Setoran'."
                textSize = 11.5f
                setTextColor(Color.parseColor("#64748B"))
                gravity = Gravity.CENTER
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            innerEmpty.addView(tvIcon)
            innerEmpty.addView(tvTitle)
            innerEmpty.addView(tvMsg)
            cardEmpty.addView(innerEmpty)
            containerSetoranHistory.addView(cardEmpty)
            return
        }

        for (h in liveEvaluations) {
            val surahName = h["surah_name"] as? String ?: "Surat"
            val ayatStart = (h["ayat_start"] as? Number)?.toInt() ?: 1
            val ayatEnd = (h["ayat_end"] as? Number)?.toInt() ?: 10
            val nilaiAkhir = (h["nilai_akhir"] as? Number)?.toInt()
            val statusHafalan = h["status_hafalan"] as? String ?: "SIAP_DISETORKAN"
            val catatanGuru = h["catatan_guru"] as? String ?: "Menunggu verifikasi ustadz/ustadzah."
            val tgl = h["tanggal_penilaian"] as? String ?: "Hari ini"

            val card = CardView(this).apply {
                radius = dp(12).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
            }
            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }
            val title = TextView(this).apply {
                text = "Surat $surahName (Ayat $ayatStart-$ayatEnd)"
                textSize = 13f
                setTextColor(Color.parseColor("#065F46"))
                setTypeface(null, Typeface.BOLD)
            }
            val status = TextView(this).apply {
                text = if (nilaiAkhir != null) "⭐ Nilai: $nilaiAkhir/100 • $statusHafalan" else "⏳ $statusHafalan"
                textSize = 11.5f
                setTextColor(if (nilaiAkhir != null) Color.parseColor("#059669") else Color.parseColor("#D97706"))
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(2)
                }
                layoutParams = lp
            }
            val notes = TextView(this).apply {
                text = "💬 $catatanGuru"
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            val dateView = TextView(this).apply {
                text = "📅 $tgl"
                textSize = 9.5f
                setTextColor(Color.parseColor("#94A3B8"))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            inner.addView(title)
            inner.addView(status)
            inner.addView(notes)
            inner.addView(dateView)
            card.addView(inner)
            containerSetoranHistory.addView(card)
        }
    }

    // ==================== TAB D: HASIL & PRESTASI ====================
    private fun renderPrestasiView() {
        containerPrestasiView.removeAllViews()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        // 5 Rubric Aspects Card
        val cardRubrik = CardView(this).apply {
            radius = dp(14).toFloat()
            cardElevation = dp(2).toFloat()
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
        }
        val innerRubrik = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
        }
        val tvRubrikTitle = TextView(this).apply {
            text = "📊 Capaian Nilai Rata-Rata per 5 Aspek Rubrik PAI"
            textSize = 13.5f
            setTextColor(Color.parseColor("#065F46"))
            setTypeface(null, Typeface.BOLD)
        }
        innerRubrik.addView(tvRubrikTitle)

        val aspects = listOf(
            Pair("1. Kelancaran (Bobot 25%)", "86 / 100"),
            Pair("2. Ketepatan Ayat (Bobot 25%)", "88 / 100"),
            Pair("3. Tajwid & Hukum Bacaan (Bobot 20%)", "82 / 100"),
            Pair("4. Makharijul Huruf (Bobot 20%)", "84 / 100"),
            Pair("5. Kemandirian (Bobot 10%)", "90 / 100")
        )

        for (a in aspects) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(6)
                }
                layoutParams = lp
            }
            val lbl = TextView(this).apply {
                text = a.first
                textSize = 11.5f
                setTextColor(Color.parseColor("#334155"))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            val valView = TextView(this).apply {
                text = a.second
                textSize = 12f
                setTextColor(Color.parseColor("#059669"))
                setTypeface(null, Typeface.BOLD)
            }
            row.addView(lbl)
            row.addView(valView)
            innerRubrik.addView(row)
        }
        cardRubrik.addView(innerRubrik)
        containerPrestasiView.addView(cardRubrik)

        // Badges Card
        val tvBadgeHead = TextView(this).apply {
            text = "🏆 Lencana Pencapaian Belajar Santri:"
            textSize = 13f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(12)
                bottomMargin = dp(6)
            }
            layoutParams = lp
        }
        containerPrestasiView.addView(tvBadgeHead)

        val badges = listOf(
            Triple("⭐ Bintang Hafiz Cilik", "Tuntas 5 Surat Pendek", "Terbuka"),
            Triple("🏅 Pejuang Juz 30", "Tuntas Minimal 18 Surat Pertama", "Dalam Proses (8/18)"),
            Triple("👑 Khatam Mutqin Juz 30", "Tuntas 37 Surat Lengkap", "Terkunci")
        )

        for (b in badges) {
            val card = CardView(this).apply {
                radius = dp(12).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
            }
            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }
            val bTitle = TextView(this).apply {
                text = b.first
                textSize = 13f
                setTextColor(Color.parseColor("#0F172A"))
                setTypeface(null, Typeface.BOLD)
            }
            val bDesc = TextView(this).apply {
                text = b.second
                textSize = 11f
                setTextColor(Color.parseColor("#64748B"))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(2)
                }
                layoutParams = lp
            }
            val bStatus = TextView(this).apply {
                text = "Status: ${b.third}"
                textSize = 10.5f
                setTextColor(if (b.third == "Terbuka") Color.parseColor("#059669") else Color.parseColor("#D97706"))
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            inner.addView(bTitle)
            inner.addView(bDesc)
            inner.addView(bStatus)
            card.addView(inner)
            containerPrestasiView.addView(card)
        }
    }

    private fun syncDataFromServer() {
        ApiClient.getClient(this).getTahfizSurahList().enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (response.isSuccessful && response.body()?.get("success") == true) {
                    val list = response.body()?.get("surahs") as? List<Map<String, Any>>
                    list?.forEach { s ->
                        val num = (s["number"] as? Number)?.toInt()
                        val status = s["statusHafalan"] as? String
                        if (num != null) {
                            if (status != null) {
                                val local = when (status) {
                                    "LULUS_SETORAN", "TUNTAS_TARGET" -> "MUTQIN"
                                    "SEDANG_DIHAFAL" -> "PROGRES"
                                    "SIAP_DISETORKAN" -> "MENUNGGU"
                                    "PERLU_MUROJAAH" -> "MUROJAAH"
                                    else -> "BELUM"
                                }
                                prefs.edit().putString("surah_status_$num", local).apply()
                            }
                            val nilai = (s["nilaiAkhir"] as? Number)?.toFloat()
                            if (nilai != null) {
                                prefs.edit().putFloat("surah_score_$num", nilai).apply()
                            }
                            val catatan = s["catatanGuru"] as? String
                            if (!catatan.isNullOrEmpty()) {
                                prefs.edit().putString("surah_feedback_$num", catatan).apply()
                            }
                        }
                    }
                    updateOverviewStats()
                    renderSurahList()
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                // Keep local cached SharedPreferences seamlessly
            }
        })

        val uId = com.school.smartcbt.utils.SessionManager(this).getUserId()
        val queryId = if (uId.isNotEmpty()) uId else "me"
        ApiClient.getClient(this).getTahfizStudentDetail(queryId).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (response.isSuccessful && response.body()?.get("success") == true) {
                    val tgts = response.body()?.get("targets") as? List<Map<String, Any>>
                    if (tgts != null) {
                        liveTargets = tgts
                    }
                    val evals = response.body()?.get("evaluations") as? List<Map<String, Any>>
                    if (evals != null) {
                        liveEvaluations = evals
                    }
                    if (currentTab == "TARGET") renderTargetList()
                    if (currentTab == "SETORAN") renderSetoranHistory()
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                // Keep offline
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        mediaPlayer?.release()
        mediaPlayer = null
    }
}
