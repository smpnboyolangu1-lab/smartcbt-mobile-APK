package com.school.smartcbt.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.school.smartcbt.R
import com.school.smartcbt.ScannerActivity
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityEkstrakurikulerBinding
import com.school.smartcbt.utils.DialogHelper
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class EkstrakurikulerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEkstrakurikulerBinding
    private lateinit var sessionManager: SessionManager

    // In-memory data store for the 11 official extracurriculars
    private val allExtracurriculars = mutableListOf<Map<String, Any>>()
    private val myRegisteredIds = mutableSetOf<String>()
    private var currentFilterCategory: String = "ALL"
    private var searchQuery: String = ""

    private val scanQrLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val scannedToken = result.data?.getStringExtra(ScannerActivity.EXTRA_SCANNED_TOKEN)
                ?: result.data?.getStringExtra("SCANNED_TOKEN")
                ?: ""
            if (scannedToken.isNotBlank()) {
                submitQrAttendance(scannedToken.trim())
            } else {
                Toast.makeText(this, "QR Code tidak terbaca", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEkstrakurikulerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)

        initMasterData()
        setupListeners()
        setupTabs()
        loadBackendData()
    }

    private fun initMasterData() {
        allExtracurriculars.clear()
        allExtracurriculars.addAll(listOf(
            mapOf(
                "id" to "extra-futsal",
                "slug" to "futsal",
                "name" to "Futsal Spenboy",
                "category" to "SPORTS",
                "emoji" to "⚽",
                "badge" to "🔥 TERFAVORIT",
                "badgeColor" to "#DC2626",
                "instructorName" to "Bpk. Hendro, S.Pd.",
                "coachName" to "Coach Rian",
                "practiceDay" to "Kamis & Sabtu",
                "practiceTime" to "15.30 - 17.30 WIB",
                "location" to "Lapangan Olahraga Utama",
                "quota" to 30,
                "rating" to "⭐ 4.9 (Juara 1 Kab)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Pembinaan fisik, taktik sepak bola modern, passing, shooting, dan kompetisi bergengsi tingkat kabupaten & karesidenan.",
                "curriculums" to listOf("Passing & Kontrol Dasar", "Dribbling & Ball Mastery", "Taktik Bertahan & Menyerang", "Simulasi Pertandingan"),
                "achievements" to listOf("🥇 Juara 1 Turnamen Futsal Pelajar Tulungagung 2026", "🥈 Runner-up Liga Pelajar Karesidenan Kediri"),
                "requirements" to "Memiliki sepatu futsal & komitmen hadir latihan rutin 80%."
            ),
            mapOf(
                "id" to "extra-basket",
                "slug" to "bola-basket",
                "name" to "Bola Basket",
                "category" to "SPORTS",
                "emoji" to "🏀",
                "badge" to "🔥 POPULER",
                "badgeColor" to "#EA580C",
                "instructorName" to "Ibu Dwi Astuti, S.Pd.",
                "coachName" to "Coach Dimas",
                "practiceDay" to "Selasa & Jumat",
                "practiceTime" to "15.30 - 17.30 WIB",
                "location" to "Lapangan Basket Outdoor",
                "quota" to 28,
                "rating" to "⭐ 4.8 (Juara 2 Cup)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Pelatihan teknik fundamental bola basket, pivot, lay-up, shooting, zone defense, dan persiapan Kejurda.",
                "curriculums" to listOf("Fundamental Dribble & Pivot", "Shooting Form & Free Throw", "Pick & Roll Strategy", "Scrimmage Match"),
                "achievements" to listOf("🥈 Juara 2 Perbasi Cup Tulungagung 2026"),
                "requirements" to "Pakaian olahraga lengkap & disiplin waktu."
            ),
            mapOf(
                "id" to "extra-voli",
                "slug" to "bola-voli",
                "name" to "Bola Voli",
                "category" to "SPORTS",
                "emoji" to "🏐",
                "badge" to "👍 KOMPAK",
                "badgeColor" to "#2563EB",
                "instructorName" to "Bpk. Slamet, M.Pd.",
                "coachName" to "Coach Bagus",
                "practiceDay" to "Rabu & Sabtu",
                "practiceTime" to "15.30 - 17.00 WIB",
                "location" to "Lapangan Voli Spenboy",
                "quota" to 24,
                "rating" to "⭐ 4.7 (Top 4 O2SN)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Latihan passing bawah, passing atas, spike keras, blocking, dan kekompakan tim.",
                "curriculums" to listOf("Passing Bawah & Atas", "Servis Atas Akurat", "Smash / Spike Keras", "Formasi Tim"),
                "achievements" to listOf("🥉 Juara 3 O2SN Tingkat Kabupaten"),
                "requirements" to "Sehat jasmani & semangat gotong royong."
            ),
            mapOf(
                "id" to "extra-pramuka",
                "slug" to "pramuka",
                "name" to "Pramuka Inti (Gudep Spenboy)",
                "category" to "LEADERSHIP",
                "emoji" to "⛺",
                "badge" to "⭐ TELADAN",
                "badgeColor" to "#059669",
                "instructorName" to "Bpk. Supriyanto, S.Pd.",
                "coachName" to "Kak Bambang",
                "practiceDay" to "Jumat",
                "practiceTime" to "13.30 - 16.00 WIB",
                "location" to "Sanggar Pramuka & Halaman",
                "quota" to 40,
                "rating" to "⭐ 5.0 (Regu Berprestasi)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Pendidikan kepanduan, kepemimpinan, tali-temali, semaphore, pioneering, pertolongan pertama, dan survival alam.",
                "curriculums" to listOf("Dasa Darma & Sandi", "Pioneering Menara Pandang", "Navigasi Darat & Peta Pita", "Perkemahan Prestasi"),
                "achievements" to listOf("🏆 Regu Berprestasi Tinggi LT-III Kwarcab Tulungagung"),
                "requirements" to "Seragam pramuka lengkap & memiliki SKU Penggalang."
            ),
            mapOf(
                "id" to "extra-pmr",
                "slug" to "pmr",
                "name" to "PMR Madya & Kader UKS",
                "category" to "LEADERSHIP",
                "emoji" to "⛑️",
                "badge" to "🚑 TIM MEDIS",
                "badgeColor" to "#DC2626",
                "instructorName" to "Ibu Siti Rahayu, S.Kep.",
                "coachName" to "Kader Senior PMR",
                "practiceDay" to "Senin & Rabu",
                "practiceTime" to "14.30 - 16.30 WIB",
                "location" to "Ruang UKS Terpadu",
                "quota" to 30,
                "rating" to "⭐ 4.9 (Pelayanan Prima)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Pelatihan pertolongan pertama (PP), evakuasi tandu, perawatan keluarga, donor darah, dan bertugas sebagai tim medis sekolah & upacara.",
                "curriculums" to listOf("Prinsip Pertolongan Pertama (PP)", "Balut Bidai & Patah Tulang", "Operasional UKS & Triase", "Evakuasi Pasien Tandu Darurat"),
                "achievements" to listOf("🥇 Juara 1 Lomba Tandu Darurat Jumbara PMR Kabupaten"),
                "requirements" to "Empati tinggi, tidak takut darah, bersedia piket UKS."
            ),
            mapOf(
                "id" to "extra-paskibra",
                "slug" to "paskibra",
                "name" to "Paskibra (Bhinneka Spenboy)",
                "category" to "LEADERSHIP",
                "emoji" to "🇮🇩",
                "badge" to "🎖️ DISIPLIN",
                "badgeColor" to "#7C3AED",
                "instructorName" to "Bpk. Wahyudi, S.Pd.",
                "coachName" to "Kang Fajar (Purna Paskibraka)",
                "practiceDay" to "Senin & Kamis",
                "practiceTime" to "15.30 - 17.30 WIB",
                "location" to "Lapangan Upacara Utama",
                "quota" to 32,
                "rating" to "⭐ 4.9 (Juara LPBB)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Pelatihan formasi PBB presisi, kekompakan baris-berbaris, upacara bendera kenegaraan, dan pembentukan karakter disiplin baja.",
                "curriculums" to listOf("PBB Statis & Dinamis", "Langkah Tegap & Hormat Kanan", "Variasi & Formasi Estetis", "Petugas Pengibar Bendera 17 Agustus"),
                "achievements" to listOf("🥇 Juara 1 LPBB Tingkat Provinsi Jawa Timur 2026"),
                "requirements" to "Tinggi badan proporsional & disiplin tinggi."
            ),
            mapOf(
                "id" to "extra-rohis",
                "slug" to "rohis",
                "name" to "Rohis & Tahfidz Quran",
                "category" to "RELIGIOUS",
                "emoji" to "🕌",
                "badge" to "✨ RELIGI",
                "badgeColor" to "#059669",
                "instructorName" to "Ust. Achmad Fauzi, S.Pd.I.",
                "coachName" to "Ust. Fauzi",
                "practiceDay" to "Kamis",
                "practiceTime" to "15.00 - 17.00 WIB",
                "location" to "Masjid Nurul Huda Spenboy",
                "quota" to 50,
                "rating" to "⭐ 4.9 (Tahfidz Juz 30)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Kajian keislaman, bimbingan tilawah, qiroah, tahfidz juz 30, rebana modern / hadrah, dan kepanitiaan PHBI sekolah.",
                "curriculums" to listOf("Tahsin & Tajwid Al-Quran", "Tahfidz Juz Amma", "Seni Rebana / Hadrah Banjari", "Public Speaking Da'i Remaja"),
                "achievements" to listOf("🥇 Juara 1 MTQ & MHQ Pelajar SMP"),
                "requirements" to "Muslim/Muslimah yang ingin memperdalam ilmu agama."
            ),
            mapOf(
                "id" to "extra-tari",
                "slug" to "seni-tari",
                "name" to "Seni Tari Tradisional & Modern",
                "category" to "ARTS",
                "emoji" to "💃",
                "badge" to "🎭 KREATIF",
                "badgeColor" to "#DB2777",
                "instructorName" to "Ibu Larasati, S.Sn.",
                "coachName" to "Ibu Laras",
                "practiceDay" to "Rabu",
                "practiceTime" to "14.30 - 16.30 WIB",
                "location" to "Aula Seni & Budaya Spenboy",
                "quota" to 25,
                "rating" to "⭐ 4.9 (Pentas Akbar)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Pelestarian tari tradisional khas Jawa Timuran (Tari Gandrung, Reog, Jaranan) dan koreografi kreasi baru kontemporer.",
                "curriculums" to listOf("Wiraga (Ketepatan Gerak)", "Wirama (Kesesuaian Ritme Gamelan)", "Wirasa (Penghayatan Ekspresi)", "Tari Kreasi Nusantara"),
                "achievements" to listOf("🥇 Juara 1 FLS2N Seni Tari Tingkat Kabupaten"),
                "requirements" to "Minat seni gerak & komitmen latihan pementasan."
            ),
            mapOf(
                "id" to "extra-padus",
                "slug" to "paduan-suara",
                "name" to "Paduan Suara (Gita Spenboy)",
                "category" to "ARTS",
                "emoji" to "🎵",
                "badge" to "🎶 HARMONI",
                "badgeColor" to "#8B5CF6",
                "instructorName" to "Bpk. Yohanes, S.Sn.",
                "coachName" to "Kak Maria",
                "practiceDay" to "Selasa & Jumat",
                "practiceTime" to "14.30 - 16.30 WIB",
                "location" to "Laboratorium Musik Spenboy",
                "quota" to 35,
                "rating" to "⭐ 4.8 (Padus Resmi)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Teknik vokal, pernapasan diafragma, solfeggio, harmonisasi SATB (Sopran, Alto, Tenor, Bass), dan kor upacara resmi sekolah.",
                "curriculums" to listOf("Vocalizing & Pitch Accuracy", "Sight Reading Partitur Not Angka", "Harmonisasi Suara Dua-Tiga", "Repertoar Lagu Wajib Nasional"),
                "achievements" to listOf("🥇 Juara 1 Paduan Suara Hari Pahlawan"),
                "requirements" to "Bisa bernyanyi dengan nada stabil (ada tes vokal dasar)."
            ),
            mapOf(
                "id" to "extra-english",
                "slug" to "english-club",
                "name" to "English Club & Debate",
                "category" to "LANGUAGE",
                "emoji" to "🗣️",
                "badge" to "🌍 GLOBAL",
                "badgeColor" to "#0284C7",
                "instructorName" to "Ibu Maya Anggraeni, M.Pd.",
                "coachName" to "Ms. Maya",
                "practiceDay" to "Kamis",
                "practiceTime" to "15.00 - 16.30 WIB",
                "location" to "Laboratorium Bahasa Modern",
                "quota" to 25,
                "rating" to "⭐ 4.8 (Debater Handal)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Melatih kepercayaan diri berbahasa Inggris melalui Storytelling, Speech, Parliamentary Debate, dan persiapan lomba bahasa Inggris.",
                "curriculums" to listOf("Fluency & Public Speaking", "Storytelling with Expression", "British Parliamentary Debate System", "TOEFL Junior Preparation"),
                "achievements" to listOf("🥇 Best Speaker English Debate Competition 2026"),
                "requirements" to "Ketertarikan berbahasa Inggris dan berpikiran kritis."
            ),
            mapOf(
                "id" to "extra-kir",
                "slug" to "kir",
                "name" to "Kelompok Ilmiah Remaja (KIR)",
                "category" to "SCIENCE",
                "emoji" to "🔬",
                "badge" to "💡 RISET & INOVASI",
                "badgeColor" to "#0D9488",
                "instructorName" to "Ibu Sri Wahyuni, M.Pd.",
                "coachName" to "Ibu Yuni & Kak Dito",
                "practiceDay" to "Rabu",
                "practiceTime" to "14.30 - 16.30 WIB",
                "location" to "Laboratorium IPA Terpadu",
                "quota" to 20,
                "rating" to "⭐ 5.0 (Medali Emas LKIR)",
                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                "description" to "Penelitian ilmiah sains terapan, karya inovasi teknologi tepat guna, penulisan karya tulis ilmiah (KTI), dan lomba OPSI Kemdikbud.",
                "curriculums" to listOf("Metodologi Penelitian Sains", "Eksperimen Laboratorium IPA", "Analisis Data & Statistik", "Teknik Penulisan KTI & Presentasi Ilmiah"),
                "achievements" to listOf("🥇 Medali Emas Lomba Karya Ilmiah Remaja Nasional 2026"),
                "requirements" to "Rasa ingin tahu tinggi & gemar membaca/bereksperimen."
            )
        ))
    }

    private fun setupListeners() {
        binding.btnBackEkskul.setOnClickListener { finish() }

        // Cart counter pill click
        binding.cardCartEkskul.setOnClickListener {
            switchTab(1) // Go to My Registrations tab
        }

        // Live Search Input filter
        binding.etSearchEkskul.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                searchQuery = s?.toString()?.trim() ?: ""
                renderCatalogGrid()
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        // Category Filter Chips
        binding.chipAll.setOnClickListener { setCategoryFilter("ALL", binding.chipAll) }
        binding.chipSports.setOnClickListener { setCategoryFilter("SPORTS", binding.chipSports) }
        binding.chipArts.setOnClickListener { setCategoryFilter("ARTS", binding.chipArts) }
        binding.chipLeadership.setOnClickListener { setCategoryFilter("LEADERSHIP", binding.chipLeadership) }
        binding.chipAcademic.setOnClickListener { setCategoryFilter("SCIENCE", binding.chipAcademic) }
        binding.chipLanguage.setOnClickListener { setCategoryFilter("LANGUAGE", binding.chipLanguage) }
        binding.chipReligion.setOnClickListener { setCategoryFilter("RELIGIOUS", binding.chipReligion) }

        // Scan QR Attendance button in Schedule Tab
        binding.cardScanQrAction.setOnClickListener {
            val intent = Intent(this, ScannerActivity::class.java).apply {
                putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_ATTENDANCE)
            }
            scanQrLauncher.launch(intent)
        }
    }

    private fun setCategoryFilter(category: String, activeBtn: Button) {
        currentFilterCategory = category
        val allChips = listOf(
            binding.chipAll, binding.chipSports, binding.chipArts,
            binding.chipLeadership, binding.chipAcademic, binding.chipLanguage, binding.chipReligion
        )
        for (btn in allChips) {
            btn.setBackgroundColor(Color.parseColor("#F1F5F9"))
            btn.setTextColor(Color.parseColor("#475569"))
        }
        activeBtn.setBackgroundColor(Color.parseColor("#1E1B4B"))
        activeBtn.setTextColor(Color.parseColor("#FFFFFF"))

        renderCatalogGrid()
    }

    private fun setupTabs() {
        binding.tabCatalog.setOnClickListener { switchTab(0) }
        binding.tabMyRegistrations.setOnClickListener { switchTab(1) }
        binding.tabSchedule.setOnClickListener { switchTab(2) }
        binding.tabPortfolio.setOnClickListener { switchTab(3) }
    }

    private fun switchTab(index: Int) {
        binding.sectionCatalog.visibility = if (index == 0) View.VISIBLE else View.GONE
        binding.sectionMyRegistrations.visibility = if (index == 1) View.VISIBLE else View.GONE
        binding.sectionSchedule.visibility = if (index == 2) View.VISIBLE else View.GONE
        binding.sectionPortfolio.visibility = if (index == 3) View.VISIBLE else View.GONE

        val tabs = listOf(binding.tabCatalog, binding.tabMyRegistrations, binding.tabSchedule, binding.tabPortfolio)
        tabs.forEachIndexed { i, btn ->
            if (i == index) {
                btn.setBackgroundColor(Color.parseColor("#4F46E5"))
                btn.setTextColor(Color.parseColor("#FFFFFF"))
                btn.setTypeface(null, Typeface.BOLD)
            } else {
                btn.setBackgroundColor(Color.parseColor("#F1F5F9"))
                btn.setTextColor(Color.parseColor("#475569"))
                btn.setTypeface(null, Typeface.NORMAL)
            }
        }
    }

    private fun loadBackendData() {
        // 1. Fetch remote catalog from database to dynamically enrich
        ApiClient.getClient(this).getExtracurricularCatalog().enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (response.isSuccessful) {
                    val data = response.body()?.get("data") as? List<Map<String, Any>>
                    if (!data.isNullOrEmpty()) {
                        val mappedList = mutableListOf<Map<String, Any>>()
                        for (remote in data) {
                            val remoteId = remote["id"]?.toString() ?: ""
                            val remoteName = remote["name"]?.toString() ?: ""
                            val remoteSlug = remote["slug"]?.toString() ?: ""
                            val remoteCat = (remote["category"]?.toString() ?: "").uppercase()

                            val localTemplate = allExtracurriculars.find {
                                it["slug"] == remoteSlug ||
                                (it["name"]?.toString()?.contains(remoteName, ignoreCase = true) == true) ||
                                (remoteName.contains(it["name"]?.toString() ?: "", ignoreCase = true))
                            }

                            val catMapped = when {
                                remoteCat.contains("SPORT") || remoteCat.contains("OLAHRAGA") -> "SPORTS"
                                remoteCat.contains("ART") || remoteCat.contains("SENI") -> "ARTS"
                                remoteCat.contains("LEADER") || remoteCat.contains("PIMPIN") || remoteCat.contains("PRAMUKA") || remoteCat.contains("PASKIBRA") -> "LEADERSHIP"
                                remoteCat.contains("HUMAN") || remoteCat.contains("MANUSIA") || remoteCat.contains("PMR") -> "LEADERSHIP"
                                remoteCat.contains("RELIG") || remoteCat.contains("AGAMA") || remoteCat.contains("ROHIS") -> "RELIGIOUS"
                                remoteCat.contains("LANG") || remoteCat.contains("BAHASA") || remoteCat.contains("ENGLISH") -> "LANGUAGE"
                                remoteCat.contains("SCI") || remoteCat.contains("AKADEMIK") || remoteCat.contains("KIR") -> "SCIENCE"
                                else -> localTemplate?.get("category")?.toString() ?: "SPORTS"
                            }

                            val emoji = localTemplate?.get("emoji")?.toString() ?: when (catMapped) {
                                "SPORTS" -> "⚽"
                                "ARTS" -> "🎨"
                                "LEADERSHIP" -> "⛺"
                                "RELIGIOUS" -> "🕌"
                                "LANGUAGE" -> "🗣️"
                                "SCIENCE" -> "🔬"
                                else -> "🏆"
                            }

                            val badge = localTemplate?.get("badge")?.toString() ?: "✨ RESMI"
                            val badgeColor = localTemplate?.get("badgeColor")?.toString() ?: "#4F46E5"
                            val coach = remote["coachName"]?.toString()?.ifEmpty { null }
                                ?: localTemplate?.get("coachName")?.toString()
                                ?: "Pembina Sekolah"
                            val instructor = remote["instructorName"]?.toString()?.ifEmpty { null }
                                ?: localTemplate?.get("instructorName")?.toString()
                                ?: coach
                            val day = remote["practiceDay"]?.toString()?.ifEmpty { null }
                                ?: localTemplate?.get("practiceDay")?.toString()
                                ?: "Sabtu"
                            val time = remote["practiceTime"]?.toString()?.ifEmpty { null }
                                ?: localTemplate?.get("practiceTime")?.toString()
                                ?: "15.00 - 17.00 WIB"
                            val loc = remote["location"]?.toString()?.ifEmpty { null }
                                ?: localTemplate?.get("location")?.toString()
                                ?: "Area Kampus Spenboy"
                            val quota = (remote["quota"] as? Number)?.toInt()
                                ?: (localTemplate?.get("quota") as? Int)
                                ?: 30
                            val desc = remote["description"]?.toString()?.ifEmpty { null }
                                ?: localTemplate?.get("description")?.toString()
                                ?: "Kegiatan pengembangan bakat, minat, dan prestasi siswa SMPN 1 Boyolangu."
                            val reqs = remote["requirements"]?.toString()?.ifEmpty { null }
                                ?: localTemplate?.get("requirements")?.toString()
                                ?: "Siswa aktif SMPN 1 Boyolangu & komitmen hadir latihan rutin 80%."
                            val curriculums = (remote["curriculums"] as? List<*>)
                                ?: (localTemplate?.get("curriculums") as? List<*>)
                                ?: listOf("Materi Dasar & Pengenalan", "Latihan Terbimbing", "Praktik & Simulasi Pertandingan")
                            val achievements = (remote["achievements"] as? List<*>)
                                ?: (localTemplate?.get("achievements") as? List<*>)
                                ?: emptyList<Any>()

                            mappedList.add(mapOf(
                                "id" to remoteId,
                                "slug" to remoteSlug,
                                "name" to remoteName,
                                "category" to catMapped,
                                "rawCategory" to remoteCat,
                                "emoji" to emoji,
                                "badge" to badge,
                                "badgeColor" to badgeColor,
                                "instructorName" to instructor,
                                "coachName" to coach,
                                "practiceDay" to day,
                                "practiceTime" to time,
                                "location" to loc,
                                "quota" to quota,
                                "rating" to (localTemplate?.get("rating")?.toString() ?: "⭐ 4.9 (Terakreditasi)"),
                                "priceText" to "GRATIS • FASILITAS SEKOLAH",
                                "description" to desc,
                                "curriculums" to curriculums,
                                "achievements" to achievements,
                                "requirements" to reqs
                            ))
                        }
                        if (mappedList.isNotEmpty()) {
                            allExtracurriculars.clear()
                            allExtracurriculars.addAll(mappedList)
                        }
                    }
                }
                loadStudentHistory()
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                loadStudentHistory()
            }
        })
    }

    private fun loadStudentHistory() {
        val studentId = sessionManager.getUserId() ?: ""
        if (studentId.isBlank()) {
            updateCartCounter()
            renderCatalogGrid()
            renderMyRegistrations(emptyList())
            renderSchedules()
            renderPortfolio(emptyList())
            return
        }

        ApiClient.getClient(this).getStudentExtracurricularHistory(studentId).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                val list = response.body()?.get("data") as? List<Map<String, Any>> ?: emptyList()
                myRegisteredIds.clear()
                for (item in list) {
                    val extraId = item["extracurricularId"] as? String
                    if (!extraId.isNullOrEmpty()) {
                        myRegisteredIds.add(extraId)
                    }
                }
                updateCartCounter()
                renderCatalogGrid()
                renderMyRegistrations(list)
                renderSchedules()
                loadStudentPortfolio()
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                updateCartCounter()
                renderCatalogGrid()
                renderMyRegistrations(emptyList())
                renderSchedules()
            }
        })
    }

    private fun loadStudentPortfolio() {
        val studentId = sessionManager.getUserId() ?: ""
        ApiClient.getClient(this).getStudentExtracurricularPortfolio(studentId).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                val achievements = response.body()?.get("achievements") as? List<Map<String, Any>> ?: emptyList()
                renderPortfolio(achievements)
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                renderPortfolio(emptyList())
            }
        })
    }

    private fun updateCartCounter() {
        val count = myRegisteredIds.size
        binding.tvCartCounter.text = "Ekskul Saya: $count/2"
        if (count >= 2) {
            binding.cardCartEkskul.setCardBackgroundColor(Color.parseColor("#B91C1C")) // Red if full
        } else {
            binding.cardCartEkskul.setCardBackgroundColor(Color.parseColor("#312E81"))
        }
    }

    // =========================================================================
    // 1. RENDER E-COMMERCE PRODUCT GRID (2 COLUMNS)
    // =========================================================================
    private fun renderCatalogGrid() {
        binding.containerProductGrid.removeAllViews()

        var filtered = allExtracurriculars.toList()
        if (currentFilterCategory != "ALL") {
            filtered = filtered.filter { it["category"] == currentFilterCategory }
        }
        if (searchQuery.isNotBlank()) {
            filtered = filtered.filter {
                val name = it["name"]?.toString() ?: ""
                val coach = it["instructorName"]?.toString() ?: ""
                val day = it["practiceDay"]?.toString() ?: ""
                name.contains(searchQuery, ignoreCase = true) ||
                coach.contains(searchQuery, ignoreCase = true) ||
                day.contains(searchQuery, ignoreCase = true)
            }
        }

        binding.tvCatalogCount.text = "DAFTAR PILIHAN RESMI (${filtered.size})"

        if (filtered.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Tidak ada ekstrakurikuler yang sesuai pencarian \"$searchQuery\"."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 13f
                gravity = Gravity.CENTER
                setPadding(0, 32, 0, 32)
            }
            binding.containerProductGrid.addView(tvEmpty)
            return
        }

        // Build 2-column layout programmatically
        for (i in filtered.indices step 2) {
            val row = LinearLayout(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = 12
                }
                orientation = LinearLayout.HORIZONTAL
                weightSum = 2f
            }

            val item1 = filtered[i]
            val card1 = createEcommerceProductCard(item1)
            row.addView(card1)

            if (i + 1 < filtered.size) {
                val item2 = filtered[i + 1]
                val card2 = createEcommerceProductCard(item2)
                row.addView(card2)
            } else {
                // Empty spacer for odd count
                val spacer = View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
                }
                row.addView(spacer)
            }

            binding.containerProductGrid.addView(row)
        }
    }

    private fun createEcommerceProductCard(item: Map<String, Any>): View {
        val id = item["id"] as? String ?: ""
        val name = item["name"] as? String ?: ""
        val emoji = item["emoji"] as? String ?: "🏆"
        val badge = item["badge"] as? String ?: "TERSEDIA"
        val badgeColor = item["badgeColor"] as? String ?: "#4F46E5"
        val coach = item["coachName"] as? String ?: item["instructorName"] as? String ?: "Pembina"
        val day = item["practiceDay"] as? String ?: ""
        val rating = item["rating"] as? String ?: "⭐ 4.9"
        val quota = item["quota"] as? Int ?: 30
        val isRegistered = myRegisteredIds.contains(id)

        val card = CardView(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(4, 4, 4, 4)
            }
            radius = 16f
            cardElevation = 2f
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
            isClickable = true
            isFocusable = true
        }

        val cardContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(12, 12, 12, 12)
        }

        // Top Thumbnail & Badge Banner
        val topBanner = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 100)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }

        val tvEmoji = TextView(this).apply {
            text = emoji
            textSize = 36f
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        topBanner.addView(tvEmoji)

        // Pill badge
        val tvBadge = TextView(this).apply {
            text = if (isRegistered) "✅ TERDAFTAR" else badge
            setTextColor(Color.WHITE)
            textSize = 9f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor(if (isRegistered) "#15803D" else badgeColor))
            setPadding(8, 4, 8, 4)
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.TOP or Gravity.START
                setMargins(6, 6, 0, 0)
            }
        }
        topBanner.addView(tvBadge)

        cardContent.addView(topBanner)

        // Title
        val tvName = TextView(this).apply {
            text = name
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            maxLines = 2
            setPadding(0, 8, 0, 2)
        }
        cardContent.addView(tvName)

        // Rating
        val tvRating = TextView(this).apply {
            text = rating
            setTextColor(Color.parseColor("#D97706"))
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
        }
        cardContent.addView(tvRating)

        // Schedule & Coach
        val tvSchedule = TextView(this).apply {
            text = "📅 $day\n👤 $coach"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 10f
            maxLines = 2
            setPadding(0, 4, 0, 4)
        }
        cardContent.addView(tvSchedule)

        // Price Tag equivalent (Quota info)
        val tvPrice = TextView(this).apply {
            text = "GRATIS • Kuota $quota"
            setTextColor(Color.parseColor("#4F46E5"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 2, 0, 8)
        }
        cardContent.addView(tvPrice)

        // Action Button: "Detail & Daftar"
        val btnAction = Button(this).apply {
            text = if (isRegistered) "✓ Terpilih" else "+ Lihat & Daftar"
            setTextColor(Color.WHITE)
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor(if (isRegistered) "#059669" else "#1E1B4B"))
            setPadding(0, 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(36))
            setOnClickListener {
                showFullScreenProductDetail(item)
            }
        }
        cardContent.addView(btnAction)

        card.addView(cardContent)

        card.setOnClickListener {
            showFullScreenProductDetail(item)
        }

        return card
    }

    // =========================================================================
    // 2. FULL SCREEN DETAIL EKSTRAKURIKULER & DAFTAR ANGGOTA SISWA
    // =========================================================================
    private fun showFullScreenProductDetail(item: Map<String, Any>) {
        val id = item["id"] as? String ?: ""
        val slug = item["slug"] as? String ?: ""
        val name = item["name"] as? String ?: ""
        val emoji = item["emoji"] as? String ?: "🏆"
        val instructor = item["instructorName"] as? String ?: "-"
        val coach = item["coachName"] as? String ?: "-"
        val day = item["practiceDay"] as? String ?: "-"
        val time = item["practiceTime"] as? String ?: "-"
        val loc = item["location"] as? String ?: "-"
        val quota = item["quota"] as? Int ?: 30
        val desc = item["description"] as? String ?: ""
        val reqs = item["requirements"] as? String ?: "Komitmen tinggi."
        val curriculums = item["curriculums"] as? List<String> ?: emptyList()
        val achievements = item["achievements"] as? List<String> ?: emptyList()
        val isRegistered = myRegisteredIds.contains(id)

        val dialog = android.app.Dialog(this, android.R.style.Theme_Light_NoTitleBar_Fullscreen)
        val rootView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Top Navigation Header with Back and Close button
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setBackgroundColor(Color.parseColor("#1E1B4B"))
        }

        val btnBack = TextView(this).apply {
            text = "← Kembali"
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, dp(4), dp(12), dp(4))
            setOnClickListener { dialog.dismiss() }
        }
        val tvHeaderTitle = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            text = "DETAIL EKSTRAKURIKULER"
            setTextColor(Color.WHITE)
            textSize = 14.5f
            setTypeface(null, Typeface.BOLD)
        }
        val btnClose = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
            setPadding(dp(8), dp(4), dp(4), dp(4))
            setOnClickListener { dialog.dismiss() }
        }
        header.addView(btnBack)
        header.addView(tvHeaderTitle)
        header.addView(btnClose)
        rootView.addView(header)

        // Scrollable Body
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            isFillViewport = true
        }
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(20))
        }

        // Big Hero Presentation Card
        val heroCard = CardView(this).apply {
            radius = 16f
            cardElevation = 2f
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
        }
        val heroLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }
        val tvBigEmoji = TextView(this).apply {
            text = emoji
            textSize = 52f
            gravity = Gravity.CENTER
        }
        val tvBigName = TextView(this).apply {
            text = name
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 19f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(4))
        }
        val tvOfficial = TextView(this).apply {
            text = "🌟 Ekstrakurikuler Resmi SMPN 1 Boyolangu"
            setTextColor(Color.parseColor("#4F46E5"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        heroLayout.addView(tvBigEmoji)
        heroLayout.addView(tvBigName)
        heroLayout.addView(tvOfficial)
        heroCard.addView(heroLayout)
        body.addView(heroCard)

        // Description Card
        val descCard = CardView(this).apply {
            radius = 12f
            cardElevation = 1f
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
        }
        val descLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }
        val tvDescTitle = TextView(this).apply {
            text = "📖 Tentang Kegiatan & Pembinaan"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, dp(6))
        }
        val tvDesc = TextView(this).apply {
            text = desc
            setTextColor(Color.parseColor("#475569"))
            textSize = 12f
            setLineSpacing(4f, 1f)
        }
        descLayout.addView(tvDescTitle)
        descLayout.addView(tvDesc)
        descCard.addView(descLayout)
        body.addView(descCard)

        // Specs Grid Card (Hari, Jam, Tempat, Kuota, Pembina, Pelatih)
        val specsCard = CardView(this).apply {
            radius = 12f
            cardElevation = 1f
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
        }
        val specsLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }
        val tvSpecTitle = TextView(this).apply {
            text = "📌 Informasi Pelaksanaan"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, dp(8))
        }
        specsLayout.addView(tvSpecTitle)
        specsLayout.addView(createSpecRow("👤 Pembina:", instructor))
        specsLayout.addView(createSpecRow("🏃 Pelatih:", coach))
        specsLayout.addView(createSpecRow("📅 Hari Latihan:", day))
        specsLayout.addView(createSpecRow("⏰ Jam Latihan:", time))
        specsLayout.addView(createSpecRow("📍 Lokasi:", loc))
        specsLayout.addView(createSpecRow("👥 Kuota Peserta:", "$quota Siswa (Tingkat VII, VIII, IX)"))
        specsLayout.addView(createSpecRow("🏷️ Biaya:", "GRATIS • Didukung Penuh Sekolah"))
        specsCard.addView(specsLayout)
        body.addView(specsCard)

        // Curriculums
        if (curriculums.isNotEmpty()) {
            val currCard = CardView(this).apply {
                radius = 12f
                cardElevation = 1f
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(14)
                }
            }
            val currLayout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(14), dp(16), dp(14))
            }
            val tvCurrTitle = TextView(this).apply {
                text = "🎯 Target Capaian & Program Pembinaan"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, 0, 0, dp(6))
            }
            currLayout.addView(tvCurrTitle)
            for (c in curriculums) {
                val tvItem = TextView(this).apply {
                    text = "• $c"
                    setTextColor(Color.parseColor("#334155"))
                    textSize = 12f
                    setPadding(dp(6), dp(2), 0, dp(2))
                }
                currLayout.addView(tvItem)
            }
            currCard.addView(currLayout)
            body.addView(currCard)
        }

        // Achievements
        if (achievements.isNotEmpty()) {
            val achCard = CardView(this).apply {
                radius = 12f
                cardElevation = 1f
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(14)
                }
            }
            val achLayout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(14), dp(16), dp(14))
            }
            val tvAchTitle = TextView(this).apply {
                text = "🏆 Rekam Prestasi Unggulan"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, 0, 0, dp(6))
            }
            achLayout.addView(tvAchTitle)
            for (a in achievements) {
                val tvItem = TextView(this).apply {
                    text = "$a"
                    setTextColor(Color.parseColor("#B45309"))
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setPadding(dp(6), dp(2), 0, dp(2))
                }
                achLayout.addView(tvItem)
            }
            achCard.addView(achLayout)
            body.addView(achCard)
        }

        // Requirements
        val reqCard = CardView(this).apply {
            radius = 12f
            cardElevation = 1f
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
        }
        val reqLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }
        val tvReqTitle = TextView(this).apply {
            text = "📝 Persyaratan Keanggotaan"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, dp(4))
        }
        val tvReq = TextView(this).apply {
            text = reqs
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
        }
        reqLayout.addView(tvReqTitle)
        reqLayout.addView(tvReq)
        reqCard.addView(reqLayout)
        body.addView(reqCard)

        // 👥 DAFTAR ANGGOTA SISWA YANG MENGIKUTI EKSTRAKURIKULER INI ("SIAPA SAJA YANG IKUT")
        val membersCard = CardView(this).apply {
            radius = 14f
            cardElevation = 2f
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(16)
            }
        }
        val membersLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val tvMembersHeader = TextView(this).apply {
            text = "👥 DAFTAR SISWA ANGGOTA TERDAFTAR"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
        }
        val tvMembersSub = TextView(this).apply {
            text = "Daftar siswa-siswi SMPN 1 Boyolangu yang telah bergabung di kegiatan ini"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 11f
            setPadding(0, dp(2), 0, dp(10))
        }
        val membersContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        val tvLoadingMembers = TextView(this).apply {
            text = "⏳ Memuat daftar siswa anggota dari server..."
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 11.5f
            setPadding(0, dp(8), 0, dp(8))
        }
        membersContainer.addView(tvLoadingMembers)
        membersLayout.addView(tvMembersHeader)
        membersLayout.addView(tvMembersSub)
        membersLayout.addView(membersContainer)
        membersCard.addView(membersLayout)
        body.addView(membersCard)

        // Load Live Members from Backend
        val queryId = if (slug.isNotBlank()) slug else id
        ApiClient.getClient(this).getExtracurricularDetail(queryId).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                val detailData = response.body()?.get("data") as? Map<String, Any>
                val membersList = detailData?.get("members") as? List<Map<String, Any>>
                membersContainer.removeAllViews()

                if (membersList.isNullOrEmpty()) {
                    val tvEmpty = TextView(this@EkstrakurikulerActivity).apply {
                        text = "Belum ada siswa lain yang terdaftar. Jadilah siswa pertama yang bergabung di ekstrakurikuler ini!"
                        setTextColor(Color.parseColor("#94A3B8"))
                        textSize = 11.5f
                        setPadding(0, dp(8), 0, dp(8))
                    }
                    membersContainer.addView(tvEmpty)
                    tvMembersHeader.text = "👥 DAFTAR ANGGOTA SISWA (0 SISWA)"
                } else {
                    tvMembersHeader.text = "👥 DAFTAR ANGGOTA SISWA (${membersList.size} SISWA)"
                    for ((idx, m) in membersList.withIndex()) {
                        val studentObj = m["student"] as? Map<String, Any>
                        val sName = studentObj?.get("name")?.toString() ?: "Siswa"
                        val sNisn = studentObj?.get("nisn")?.toString() ?: studentObj?.get("username")?.toString() ?: "-"
                        val sClass = studentObj?.get("className")?.toString() ?: "-"
                        val sStatus = m["status"]?.toString() ?: "AKTIF"

                        val studentRow = LinearLayout(this@EkstrakurikulerActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                            setPadding(0, dp(6), 0, dp(6))
                        }

                        val tvIdx = TextView(this@EkstrakurikulerActivity).apply {
                            text = "${idx + 1}"
                            setTextColor(Color.parseColor("#4F46E5"))
                            textSize = 11f
                            setTypeface(null, Typeface.BOLD)
                            setBackgroundColor(Color.parseColor("#EEF2FF"))
                            gravity = Gravity.CENTER
                            layoutParams = LinearLayout.LayoutParams(dp(26), dp(26)).apply {
                                marginEnd = dp(10)
                            }
                        }
                        studentRow.addView(tvIdx)

                        val sInfoCol = LinearLayout(this@EkstrakurikulerActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        val tvStudentName = TextView(this@EkstrakurikulerActivity).apply {
                            text = sName
                            setTextColor(Color.parseColor("#0F172A"))
                            textSize = 12.5f
                            setTypeface(null, Typeface.BOLD)
                        }
                        val tvStudentClass = TextView(this@EkstrakurikulerActivity).apply {
                            text = "Kelas $sClass • NISN: $sNisn"
                            setTextColor(Color.parseColor("#64748B"))
                            textSize = 10.5f
                        }
                        sInfoCol.addView(tvStudentName)
                        sInfoCol.addView(tvStudentClass)
                        studentRow.addView(sInfoCol)

                        val statusBadge = TextView(this@EkstrakurikulerActivity).apply {
                            text = when (sStatus.uppercase()) {
                                "ACTIVE", "ACCEPTED" -> "✓ AKTIF"
                                "PENDING" -> "MENUNGGU"
                                else -> sStatus
                            }
                            setTextColor(Color.parseColor(if (sStatus.uppercase() in listOf("ACTIVE", "ACCEPTED")) "#059669" else "#D97706"))
                            setBackgroundColor(Color.parseColor(if (sStatus.uppercase() in listOf("ACTIVE", "ACCEPTED")) "#ECFDF5" else "#FFFBEB"))
                            textSize = 9.5f
                            setTypeface(null, Typeface.BOLD)
                            setPadding(dp(8), dp(3), dp(8), dp(3))
                        }
                        studentRow.addView(statusBadge)

                        membersContainer.addView(studentRow)

                        if (idx < membersList.size - 1) {
                            val divider = View(this@EkstrakurikulerActivity).apply {
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1).apply {
                                    topMargin = dp(2)
                                    bottomMargin = dp(2)
                                }
                                setBackgroundColor(Color.parseColor("#F1F5F9"))
                            }
                            membersContainer.addView(divider)
                        }
                    }
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                membersContainer.removeAllViews()
                val tvErr = TextView(this@EkstrakurikulerActivity).apply {
                    text = "Daftar anggota dapat dilihat setelah terhubung ke jaringan sekolah."
                    setTextColor(Color.parseColor("#94A3B8"))
                    textSize = 11.5f
                }
                membersContainer.addView(tvErr)
            }
        })

        scroll.addView(body)
        rootView.addView(scroll)

        // Sticky Bottom Action Bar
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setBackgroundColor(Color.WHITE)
            elevation = 12f
        }

        val priceSummary = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvPriceLabel = TextView(this).apply {
            text = "Status Keikutsertaan"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 10f
        }
        val tvPriceVal = TextView(this).apply {
            text = if (isRegistered) "✓ Anda Terdaftar di Ekstra Ini" else "Pendaftaran Aktif Terbuka"
            setTextColor(Color.parseColor(if (isRegistered) "#059669" else "#4338CA"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        priceSummary.addView(tvPriceLabel)
        priceSummary.addView(tvPriceVal)
        bottomBar.addView(priceSummary)

        val btnRegister = Button(this).apply {
            text = if (isRegistered) "✕ Batalkan Pendaftaran" else "📝 Daftar Ekstra Ini"
            setTextColor(Color.WHITE)
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor(if (isRegistered) "#DC2626" else "#4F46E5"))
            setOnClickListener {
                dialog.dismiss()
                if (isRegistered) {
                    confirmCancelRegistration(item)
                } else {
                    attemptRegisterExtracurricular(item)
                }
            }
        }
        bottomBar.addView(btnRegister)

        rootView.addView(bottomBar)

        dialog.setContentView(rootView)
        dialog.show()
    }

    private fun confirmCancelRegistration(item: Map<String, Any>) {
        val id = item["id"] as? String ?: ""
        val name = item["name"] as? String ?: ""
        val studentId = sessionManager.getUserId() ?: ""

        AlertDialog.Builder(this)
            .setTitle("⚠️ Konfirmasi Pembatalan")
            .setMessage("Apakah Anda yakin ingin membatalkan pendaftaran ekstrakurikuler $name?")
            .setPositiveButton("Ya, Batalkan") { _, _ ->
                Toast.makeText(this, "Membatalkan pendaftaran...", Toast.LENGTH_SHORT).show()
                val body = mapOf(
                    "studentId" to studentId,
                    "extracurricularId" to id
                )
                ApiClient.getClient(this).cancelExtracurricularRegistration(body).enqueue(object : Callback<Map<String, Any>> {
                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                        if (response.isSuccessful && response.body()?.get("success") == true) {
                            Toast.makeText(this@EkstrakurikulerActivity, "✅ Berhasil membatalkan pendaftaran $name", Toast.LENGTH_SHORT).show()
                            loadStudentHistory()
                        } else {
                            val msg = response.body()?.get("message")?.toString() ?: "Gagal membatalkan pendaftaran"
                            Toast.makeText(this@EkstrakurikulerActivity, "⚠️ $msg", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                        Toast.makeText(this@EkstrakurikulerActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun createSpecRow(label: String, value: String): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 3, 0, 3)
        }
        val tvLabel = TextView(this).apply {
            text = label
            setTextColor(Color.parseColor("#475569"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(dp(110), LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val tvVal = TextView(this).apply {
            text = value
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 11f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(tvLabel)
        row.addView(tvVal)
        return row
    }

    // =========================================================================
    // 3. PENDAFTARAN SISWA (MAKSIMAL 2 EKSKUL ENFORCEMENT)
    // =========================================================================
    private fun attemptRegisterExtracurricular(item: Map<String, Any>) {
        val id = item["id"] as? String ?: ""
        val name = item["name"] as? String ?: ""

        if (myRegisteredIds.contains(id)) {
            Toast.makeText(this, "Anda sudah terdaftar di ekstrakurikuler $name.", Toast.LENGTH_SHORT).show()
            return
        }

        if (myRegisteredIds.size >= 2) {
            AlertDialog.Builder(this)
                .setTitle("⚠️ Batas Maksimal Tercapai")
                .setMessage("Sesuai aturan kurikulum SMPN 1 Boyolangu, setiap siswa hanya dapat memilih maksimal 2 ekstrakurikuler.\n\nAnda saat ini sudah memilih 2 ekstrakurikuler. Silakan batalkan salah satu pendaftaran terlebih dahulu jika ingin memilih ekstra ini.")
                .setPositiveButton("Lihat Pendaftaran Saya") { _, _ -> switchTab(1) }
                .setNegativeButton("Tutup", null)
                .show()
            return
        }

        AlertDialog.Builder(this)
            .setTitle("🛒 Konfirmasi Pendaftaran Ekstra")
            .setMessage("Kirim formulir pendaftaran untuk $name?\n\n• Pilihan saat ini: ${myRegisteredIds.size + 1} dari 2 kuota\n• Pendaftaran akan diverifikasi oleh Pembina terkait.")
            .setPositiveButton("Ya, Kirim Pendaftaran") { _, _ ->
                sendRegistrationToServer(id, name)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun sendRegistrationToServer(extraId: String, extraName: String) {
        val studentId = sessionManager.getUserId() ?: ""
        Toast.makeText(this, "Mengirim formulir pendaftaran ke server...", Toast.LENGTH_SHORT).show()

        val body = mapOf(
            "studentId" to studentId,
            "extracurricularIds" to listOf(extraId),
            "academicYear" to "2026/2027"
        )

        ApiClient.getClient(this).registerExtracurricular(body).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (response.isSuccessful && response.body()?.get("success") == true) {
                    myRegisteredIds.add(extraId)
                    updateCartCounter()
                    renderCatalogGrid()
                    loadStudentHistory()

                    DialogHelper.showFullScreenNotificationDialog(
                        context = this@EkstrakurikulerActivity,
                        theme = DialogHelper.HeaderTheme.SUCCESS,
                        badgeText = "PENDAFTARAN BERHASIL",
                        title = "FORMULIR TERKIRIM",
                        studentName = sessionManager.getName(),
                        className = sessionManager.getClassName(),
                        timeInfo = "Tahun Ajaran 2026/2027",
                        message = "Pendaftaran untuk ekstrakurikuler $extraName berhasil diajukan.\n\nStatus saat ini: MENUNGGU VERIFIKASI PEMBINA. Anda dapat memantau status keanggotaan pada tab 'Pendaftaran Saya'.",
                        actionText = "LIHAT STATUS PENDAFTARAN",
                        onAction = {
                            switchTab(1)
                        }
                    )
                } else {
                    val msg = response.body()?.get("message")?.toString() ?: "Gagal memproses pendaftaran ekstra"
                    Toast.makeText(this@EkstrakurikulerActivity, "Gagal: $msg", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                // If offline / local test:
                myRegisteredIds.add(extraId)
                updateCartCounter()
                renderCatalogGrid()
                Toast.makeText(this@EkstrakurikulerActivity, "✅ Pendaftaran $extraName tersimpan lokal!", Toast.LENGTH_SHORT).show()
                switchTab(1)
            }
        })
    }

    // =========================================================================
    // 4. RENDER TAB PENDAFTARAN SAYA (ORDERS TRACKER)
    // =========================================================================
    private fun renderMyRegistrations(list: List<Map<String, Any>>) {
        binding.containerMyEkskulList.removeAllViews()

        if (myRegisteredIds.isEmpty() && list.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada ekstrakurikuler yang dipilih.\nBuka tab '🛍️ Katalog Ekstra' untuk memilih hingga 2 kegiatan minat & bakat."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                gravity = Gravity.CENTER
                setPadding(0, 40, 0, 40)
            }
            binding.containerMyEkskulList.addView(tvEmpty)
            return
        }

        // Loop registered extras
        val itemsToDisplay = if (list.isNotEmpty()) {
            list.map { m ->
                val extraObj = m["extracurricular"] as? Map<String, Any>
                val extraId = m["extracurricularId"]?.toString() ?: ""
                val localMatched = allExtracurriculars.find { it["id"] == extraId || it["slug"] == extraId }
                mapOf(
                    "id" to extraId,
                    "name" to (extraObj?.get("name") ?: localMatched?.get("name") ?: "Ekstrakurikuler"),
                    "emoji" to (localMatched?.get("emoji") ?: "🏆"),
                    "status" to (m["status"]?.toString() ?: "ACTIVE"),
                    "level" to (m["developmentLevel"]?.toString() ?: "BERKEMBANG"),
                    "rate" to (m["attendanceRate"] ?: 90),
                    "notes" to (m["notes"]?.toString() ?: "Aktif mengikuti pembinaan mingguan.")
                )
            }
        } else {
            myRegisteredIds.mapNotNull { id ->
                val local = allExtracurriculars.find { it["id"] == id }
                local?.let {
                    mapOf(
                        "id" to id,
                        "name" to (it["name"] ?: ""),
                        "emoji" to (it["emoji"] ?: "🏆"),
                        "status" to "PENDING",
                        "level" to "PEMULA",
                        "rate" to 100,
                        "notes" to "Menunggu verifikasi Pembina."
                    )
                }
            }
        }

        for (item in itemsToDisplay) {
            val name = item["name"]?.toString() ?: ""
            val emoji = item["emoji"]?.toString() ?: "🏆"
            val status = item["status"]?.toString() ?: "PENDING"
            val level = item["level"]?.toString() ?: "BERKEMBANG"
            val rate = item["rate"]?.toString() ?: "100"
            val notes = item["notes"]?.toString() ?: "-"

            val card = CardView(this).apply {
                radius = 16f
                cardElevation = 2f
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 12
                }
            }

            val cardLayout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(16, 16, 16, 16)
            }

            // Status Badge Row
            val statusRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val tvEmoji = TextView(this).apply {
                text = emoji
                textSize = 24f
            }
            val titleCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setPadding(10, 0, 0, 0)
            }
            val tvName = TextView(this).apply {
                text = name
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 14f
                setTypeface(null, Typeface.BOLD)
            }
            val tvYear = TextView(this).apply {
                text = "Tahun Ajaran: 2026/2027 • SMPN 1 Boyolangu"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 10f
            }
            titleCol.addView(tvName)
            titleCol.addView(tvYear)

            val tvStatusBadge = TextView(this).apply {
                when (status.uppercase()) {
                    "ACTIVE", "ACCEPTED" -> {
                        text = "AKTIF / DITERIMA"
                        setTextColor(Color.parseColor("#15803D"))
                        setBackgroundColor(Color.parseColor("#DCFCE7"))
                    }
                    "PENDING" -> {
                        text = "MENUNGGU VERIFIKASI"
                        setTextColor(Color.parseColor("#B45309"))
                        setBackgroundColor(Color.parseColor("#FEF3C7"))
                    }
                    "SELECTION" -> {
                        text = "SELEKSI KHUSUS"
                        setTextColor(Color.parseColor("#1D4ED8"))
                        setBackgroundColor(Color.parseColor("#DBEAFE"))
                    }
                    else -> {
                        text = status
                        setTextColor(Color.parseColor("#475569"))
                        setBackgroundColor(Color.parseColor("#F1F5F9"))
                    }
                }
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setPadding(8, 4, 8, 4)
            }

            statusRow.addView(tvEmoji)
            statusRow.addView(titleCol)
            statusRow.addView(tvStatusBadge)
            cardLayout.addView(statusRow)

            val sep = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1).apply {
                    setMargins(0, 10, 0, 10)
                }
                setBackgroundColor(Color.parseColor("#E2E8F0"))
            }
            cardLayout.addView(sep)

            // Progress & Level info
            val infoGrid = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                weightSum = 2f
            }
            val colAttendance = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val tvAttLabel = TextView(this).apply {
                text = "Tingkat Kehadiran:"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 10f
            }
            val tvAttVal = TextView(this).apply {
                text = "$rate% Hadir"
                setTextColor(Color.parseColor("#059669"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
            }
            colAttendance.addView(tvAttLabel)
            colAttendance.addView(tvAttVal)

            val colLevel = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val tvLvlLabel = TextView(this).apply {
                text = "Level Perkembangan:"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 10f
            }
            val tvLvlVal = TextView(this).apply {
                text = level.uppercase()
                setTextColor(Color.parseColor("#4F46E5"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
            }
            colLevel.addView(tvLvlLabel)
            colLevel.addView(tvLvlVal)

            infoGrid.addView(colAttendance)
            infoGrid.addView(colLevel)
            cardLayout.addView(infoGrid)

            // Notes from Pembina
            val tvNotes = TextView(this).apply {
                text = "Catatan Pembina: $notes"
                setTextColor(Color.parseColor("#475569"))
                textSize = 11f
                setPadding(0, 8, 0, 0)
            }
            cardLayout.addView(tvNotes)

            card.addView(cardLayout)
            binding.containerMyEkskulList.addView(card)
        }
    }

    // =========================================================================
    // 5. RENDER TAB JADWAL & PRESENSI QR
    // =========================================================================
    private fun renderSchedules() {
        val studentName = sessionManager.getName()
        val nisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }
        val className = sessionManager.getClassName()
        binding.tvScheduleStudentName.text = studentName
        binding.tvScheduleStudentInfo.text = "NISN: $nisn • Kelas: $className"

        binding.containerScheduleList.removeAllViews()

        val registeredItems = allExtracurriculars.filter { myRegisteredIds.contains(it["id"]) }
        val displayItems = if (registeredItems.isNotEmpty()) registeredItems else allExtracurriculars

        if (displayItems.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada jadwal latihan ekstrakurikuler yang aktif."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                gravity = Gravity.CENTER
                setPadding(0, dp(32), 0, dp(32))
            }
            binding.containerScheduleList.addView(tvEmpty)
            return
        }

        for (item in displayItems) {
            val id = item["id"] as? String ?: ""
            val name = item["name"] as? String ?: ""
            val emoji = item["emoji"] as? String ?: "🏆"
            val day = item["practiceDay"] as? String ?: ""
            val time = item["practiceTime"] as? String ?: ""
            val loc = item["location"] as? String ?: ""
            val coach = item["coachName"] as? String ?: item["instructorName"] as? String ?: "Pembina"
            val isMyExtra = myRegisteredIds.contains(id)

            val card = CardView(this).apply {
                radius = 14f
                cardElevation = 2f
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(12)
                }
            }
            val layout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(14), dp(16), dp(14))
            }
            val headerRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val tvEmoji = TextView(this).apply {
                text = emoji
                textSize = 20f
                setPadding(0, 0, dp(8), 0)
            }
            val tvTitle = TextView(this).apply {
                text = name
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            headerRow.addView(tvEmoji)
            headerRow.addView(tvTitle)

            if (isMyExtra) {
                val badgeRegistered = TextView(this).apply {
                    text = "✓ TERDAFTAR"
                    setTextColor(Color.parseColor("#059669"))
                    textSize = 10f
                    setTypeface(null, Typeface.BOLD)
                    setBackgroundColor(Color.parseColor("#D1FAE5"))
                    setPadding(dp(10), dp(4), dp(10), dp(4))
                }
                headerRow.addView(badgeRegistered)
            }
            layout.addView(headerRow)

            val metaRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(8)
                }
            }
            val tvDayTime = TextView(this).apply {
                text = "📅 $day • ⏰ $time"
                setTextColor(Color.parseColor("#1E1B4B"))
                setBackgroundColor(Color.parseColor("#EEF2FF"))
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(dp(8), dp(4), dp(8), dp(4))
            }
            metaRow.addView(tvDayTime)
            layout.addView(metaRow)

            val tvDetail = TextView(this).apply {
                text = "📍 Lokasi: $loc\n👤 Pelatih/Pembina: $coach"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11f
                setLineSpacing(2f, 1f)
                setPadding(0, dp(6), 0, 0)
            }
            layout.addView(tvDetail)

            card.addView(layout)
            binding.containerScheduleList.addView(card)
        }
    }

    // =========================================================================
    // 6. RENDER TAB PORTOFOLIO & PRESTASI
    // =========================================================================
    private fun renderPortfolio(achievements: List<Map<String, Any>>) {
        binding.containerPortfolioList.removeAllViews()

        if (achievements.isEmpty()) {
            val emptyLayout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(32, 48, 32, 48)
            }
            val tvIcon = TextView(this).apply {
                text = "🏅"
                textSize = 40f
                gravity = Gravity.CENTER
            }
            val tvTitle = TextView(this).apply {
                text = "Belum Ada Piagam Prestasi Resmi"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 14f
                setTypeface(null, Typeface.BOLD)
                gravity = Gravity.CENTER
                setPadding(0, 12, 0, 4)
            }
            val tvSub = TextView(this).apply {
                text = "Catatan prestasi kejuaraan dan piagam penghargaan digital akan tercantum di sini setelah diverifikasi resmi oleh Pembina Ekstrakurikuler Anda. Terus giat berlatih dan harumkan nama Spenboy!"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 12f
                gravity = Gravity.CENTER
                setLineSpacing(4f, 1f)
            }
            emptyLayout.addView(tvIcon)
            emptyLayout.addView(tvTitle)
            emptyLayout.addView(tvSub)
            binding.containerPortfolioList.addView(emptyLayout)
            return
        }

        for (ach in achievements) {
            val title = ach["title"]?.toString() ?: "Prestasi Ekstrakurikuler"
            val rank = ach["rank"]?.toString() ?: "Juara"
            val date = ach["date"]?.toString() ?: "2026"
            val extra = ach["extra"]?.toString() ?: "Spenboy"

            val card = CardView(this).apply {
                radius = 14f
                cardElevation = 2f
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 10
                }
            }
            val layout = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(16, 14, 16, 14)
            }
            val tvMedal = TextView(this).apply {
                text = "🥇"
                textSize = 28f
            }
            val col = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setPadding(12, 0, 0, 0)
            }
            val tvTitle = TextView(this).apply {
                text = title
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
            }
            val tvDesc = TextView(this).apply {
                text = "$rank • $extra • $date"
                setTextColor(Color.parseColor("#D97706"))
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
            }
            col.addView(tvTitle)
            col.addView(tvDesc)
            layout.addView(tvMedal)
            layout.addView(col)
            card.addView(layout)
            binding.containerPortfolioList.addView(card)
        }
    }

    // =========================================================================
    // 7. QR CODE ATTENDANCE SUBMISSION
    // =========================================================================
    private fun submitQrAttendance(token: String) {
        val studentId = sessionManager.getUserId() ?: ""
        Toast.makeText(this, "Memverifikasi presensi sesi latihan...", Toast.LENGTH_SHORT).show()

        val body = mapOf(
            "studentId" to studentId,
            "qrToken" to token
        )

        ApiClient.getClient(this).checkInExtracurricularSession(body).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (response.isSuccessful && response.body()?.get("success") == true) {
                    val msg = response.body()?.get("message")?.toString() ?: "Presensi berhasil dicatat"
                    DialogHelper.showFullScreenNotificationDialog(
                        context = this@EkstrakurikulerActivity,
                        theme = DialogHelper.HeaderTheme.SUCCESS,
                        badgeText = "PRESENSI TERVERIFIKASI",
                        title = "KEHADIRAN DICATAT",
                        studentName = sessionManager.getName(),
                        className = sessionManager.getClassName(),
                        timeInfo = java.text.SimpleDateFormat("HH.mm 'WIB'", java.util.Locale.getDefault()).format(java.util.Date()),
                        message = "Kehadiran sesi latihan berhasil diverifikasi ke server: $msg.\n\nPersentase kehadiran Anda telah diperbarui secara otomatis.",
                        actionText = "TUTUP",
                        onAction = { loadStudentHistory() }
                    )
                } else {
                    val err = response.body()?.get("message")?.toString() ?: "Token presensi tidak valid atau kadaluarsa"
                    Toast.makeText(this@EkstrakurikulerActivity, "⚠️ $err", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                Toast.makeText(this@EkstrakurikulerActivity, "Koneksi presensi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun dp(value: Int): Int {
        val density = resources.displayMetrics.density
        return (value * density).toInt()
    }
}
