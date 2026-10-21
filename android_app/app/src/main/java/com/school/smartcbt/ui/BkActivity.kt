package com.school.smartcbt.ui

import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityBkBinding
import com.school.smartcbt.utils.QrCodeHelper
import com.school.smartcbt.utils.SessionManager
import okhttp3.OkHttpClient
import okhttp3.Request
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response


class BkActivity : AppCompatActivity() {

    private lateinit var binding: ActivityBkBinding
    private lateinit var sessionManager: SessionManager

    companion object {
        const val EXTRA_STUDENT_ID = "extra_student_id"
        const val EXTRA_STUDENT_NAME = "extra_student_name"
        const val EXTRA_CLASS_NAME = "extra_class_name"
        const val EXTRA_IS_PARENT = "extra_is_parent"
    }

    private var targetStudentId: String? = null
    private var isParentMode: Boolean = false
    private var isCounselorMode: Boolean = false
    private var isAnonymousReport: Boolean = false
    private var currentSelectedClass: String? = null
    private var allowedBkClasses: List<String> = emptyList()

    private var bkTingkats: List<String> = emptyList()
    private var bkTingkatGroups: Map<String, List<String>> = emptyMap()
    private var bkSelectedTingkat: String = ""
    private var bkSelectedSubClass: String = ""
    private var allRecapStudents: List<BkStudentRecapDto> = emptyList()
    private var lastSelectedClassName: String = ""

    enum class BkSection {
        HOME,
        PARENT_LEAVES,
        ATTENDANCE,
        POINTS_SP,
        COUNSELING,
        GATEPASS,
        TODAY_ACTIVITY
    }

    private var currentSection: BkSection = BkSection.HOME
    private var currentLeaveFilter: String = "ALL"
    private var allParentLeaveRequests: List<ParentLeaveRequestDto> = emptyList()
    private var counselorStatusFilter: String = "ALL"
    private var consultationSearchQuery: String = ""
    private var isSearchWatcherAttached: Boolean = false

    data class BkMenuItem(
        val icon: String,
        val title: String,
        val subtitle: String,
        val bgColor: String,
        val textColor: String,
        val action: () -> Unit
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityBkBinding.inflate(layoutInflater)
        setContentView(binding.root)
        com.school.smartcbt.utils.DialogHelper.applyDynamicFooter(this)

        sessionManager = SessionManager(this)

        val userRole = sessionManager.getRole().uppercase()
        val subject = sessionManager.getTeachingSubject()?.uppercase() ?: ""
        isCounselorMode = (userRole == "COUNSELOR" || userRole == "BK" || subject.contains("BK") || subject.contains("BIMBINGAN") || subject.contains("KONSELING"))
        targetStudentId = intent.getStringExtra(EXTRA_STUDENT_ID)
        isParentMode = intent.getBooleanExtra(EXTRA_IS_PARENT, false) || (userRole == "PARENT")

        setupNavigationAndBackButton()
        setupModernBkDashboard()
        setupUI()
        setupBkTabs()
        if (isCounselorMode) {
            setupCounselorFeatures()
            navigateToSection(BkSection.HOME)
            loadBkClassRecap(null)
            loadParentLeavesSummary()
            loadCounselorOverview()
            loadBkDisciplineAndSpData()
            loadBkTodayActivity()
        } else {
            setupStudentBkDashboard()
        }
        loadConsultations()
        if (!isCounselorMode) {
            loadStudentProfile()
        }

        // Sinkronisasi Token Push Notifikasi Firebase (FCM)
        try {
            com.school.smartcbt.utils.FcmHelper.syncFcmToken(this)
        } catch (e: Exception) {}

        // Cek Pembaruan OTA Otomatis
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
    }

    override fun onResume() {
        super.onResume()
        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
    }

    private var currentBkTab: Int = 0

    private fun setupNavigationAndBackButton() {
        binding.btnBackBk.setOnClickListener {
            if (currentSection != BkSection.HOME && isCounselorMode) {
                navigateToSection(BkSection.HOME)
            } else {
                finish()
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (currentSection != BkSection.HOME && isCounselorMode) {
                    navigateToSection(BkSection.HOME)
                } else {
                    finish()
                }
            }
        })
    }

    fun navigateToSection(section: BkSection) {
        currentSection = section

        if (!isCounselorMode) return

        val isLeavesOrGatepass = (section == BkSection.PARENT_LEAVES || section == BkSection.GATEPASS)
        binding.layoutBkHomeDashboard.visibility = if (section == BkSection.HOME) View.VISIBLE else View.GONE
        binding.containerTabBkLeaves.visibility = if (isLeavesOrGatepass) View.VISIBLE else View.GONE
        binding.containerTabBkRecap.visibility = if (section == BkSection.ATTENDANCE) View.VISIBLE else View.GONE
        binding.containerTabBkPoints.visibility = if (section == BkSection.POINTS_SP) View.VISIBLE else View.GONE
        binding.containerTabBkReplies.visibility = if (section == BkSection.COUNSELING) View.VISIBLE else View.GONE
        binding.containerTabBkToday.visibility = if (section == BkSection.TODAY_ACTIVITY) View.VISIBLE else View.GONE
        binding.containerTabBkManual.visibility = View.GONE
        binding.containerTabBk360.visibility = View.GONE

        if (section == BkSection.PARENT_LEAVES) {
            binding.tvBkLeavesCardTitle.text = "📋 PERMOHONAN IZIN SISWA (ORANG TUA)"
            binding.tvBkLeavesSummary.text = "Verifikasi izin/sakit ananda dari orang tua beserta bukti surat dokter"
            binding.tvBkDoctorRuleBanner.visibility = View.VISIBLE
            binding.layoutBkLeaveFilters.visibility = View.VISIBLE
        } else if (section == BkSection.GATEPASS) {
            binding.tvBkLeavesCardTitle.text = "🚪 IZIN KELUAR SEKOLAH / GATEPASS SATPAM"
            binding.tvBkLeavesSummary.text = "Izin meninggalkan sekolah saat jam KBM (sakit/kegiatan/acara darurat)"
            binding.tvBkDoctorRuleBanner.visibility = View.GONE
            binding.layoutBkLeaveFilters.visibility = View.GONE
        }

        binding.scrollViewBk.post {
            binding.scrollViewBk.scrollTo(0, 0)
        }

        if (section == BkSection.HOME) {
            binding.tvBkTopTitle.text = "🕊️ Ruang BK Konselor"
            binding.tvBkTopSubtitle.text = "Bimbingan & Konseling • SMPN 1 Boyolangu"
        } else {
            binding.tvBkTopTitle.text = when (section) {
                BkSection.PARENT_LEAVES -> "📋 Surat Izin Orang Tua Siswa"
                BkSection.ATTENDANCE -> "📱 Presensi Siswa Kelas Ampuan"
                BkSection.POINTS_SP -> "⚖️ Buku Poin & SP Siswa"
                BkSection.COUNSELING -> "💬 Layanan Konseling Siswa"
                BkSection.GATEPASS -> "🚪 Izin Keluar Sekolah (Gatepass)"
                BkSection.TODAY_ACTIVITY -> "⏱️ Aktivitas Presensi Hari Ini"
                else -> "Ruang BK"
            }
            binding.tvBkTopSubtitle.text = "← Ketuk panah kembali untuk ke Menu Utama"
        }

        when (section) {
            BkSection.PARENT_LEAVES -> loadParentLeavesData(currentLeaveFilter)
            BkSection.ATTENDANCE -> loadBkClassRecap(bkSelectedSubClass.ifEmpty { currentSelectedClass })
            BkSection.POINTS_SP -> loadBkDisciplineAndSpData()
            BkSection.COUNSELING -> loadConsultations()
            BkSection.GATEPASS -> loadPendingStudentLeaves()
            BkSection.TODAY_ACTIVITY -> loadBkTodayActivity()
            else -> {}
        }
    }

    
    private fun loadCounselorOverview() {
        ApiClient.getClient(this).getBkDashboardOverview().enqueue(object : Callback<BkDashboardOverviewResponse> {
            override fun onResponse(call: Call<BkDashboardOverviewResponse>, response: Response<BkDashboardOverviewResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val summary = response.body()?.summary
                    if (summary != null) {
                        val classes = summary.supervisedClasses
                        val classStr = if (classes.isNotEmpty()) classes.joinToString(", ") else "Belum Ditentukan"
                        binding.tvBkSupervisedClasses.text = "🏛️ Kelas Binaan: $classStr"
                        binding.tvBkSupervisedStats.text = "📊 ${summary.totalClasses} Kelas Binaan • ${summary.totalStudents} Siswa Binaan Total"
                        binding.tvQuickClassCount.text = "${summary.totalStudents} Siswa"
                        binding.tvQuickCounselingCount.text = "${summary.todaySchedulesCount} Sesi"
                        binding.tvQuickPointsCount.text = "${summary.atRiskCount} Kasus"
                    }
                }
            }

            override fun onFailure(call: Call<BkDashboardOverviewResponse>, t: Throwable) {
                binding.tvBkSupervisedClasses.text = "🏛️ Kelas Binaan: Terhubung ke Server"
            }
        })
    }

    private fun setupModernBkDashboard() {
        if (!isCounselorMode) {
            binding.layoutBkHomeDashboard.visibility = View.GONE
            return
        }

        binding.layoutBkHomeDashboard.visibility = View.VISIBLE

        val counselorName = sessionManager.getName().ifEmpty { sessionManager.getUsername() }.ifEmpty { "Guru BK" }
        binding.tvBkHeroName.text = counselorName
        binding.tvBkHeroGreeting.text = "Selamat Datang, Bapak/Ibu Guru BK!"
        binding.tvBkHeroRole.text = "👩‍🏫 Guru BK Konselor • SMPN 1 Boyolangu"
        binding.tvBkAppVersionInfo.text = "Smart CBT v${com.school.smartcbt.BuildConfig.VERSION_NAME} • SMP Negeri 1 Boyolangu"

        // Click listeners on 4 KPI Cards
        binding.cardQuickClassCount.setOnClickListener { navigateToSection(BkSection.ATTENDANCE) }
        binding.cardQuickLeavesCount.setOnClickListener { navigateToSection(BkSection.PARENT_LEAVES) }
        binding.cardQuickCounselingCount.setOnClickListener { navigateToSection(BkSection.COUNSELING) }
        binding.cardQuickPointsCount.setOnClickListener { navigateToSection(BkSection.POINTS_SP) }

        // Click listeners on Unified Grid Menu Cards
        binding.gridMenuParentLeaves.setOnClickListener { navigateToSection(BkSection.PARENT_LEAVES) }
        binding.gridMenuAttendance.setOnClickListener { navigateToSection(BkSection.ATTENDANCE) }
        binding.gridMenuPointsSp.setOnClickListener { navigateToSection(BkSection.POINTS_SP) }
        binding.gridMenuCounseling.setOnClickListener { navigateToSection(BkSection.COUNSELING) }
        binding.gridMenuGatepass.setOnClickListener { navigateToSection(BkSection.GATEPASS) }
        binding.gridMenuTodayActivity.setOnClickListener { navigateToSection(BkSection.TODAY_ACTIVITY) }
        binding.cardBkGlobalPrayer.setOnClickListener { showBkGlobalPrayerDialog() }
        binding.gridMenuUpdate.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        // Modul Terpadu Layanan & Instrumen BK Kemendikbud
        binding.cardHubSdq.setOnClickListener { showSdqHubDialog() }
        binding.cardHubWhistleblow.setOnClickListener { showWhistleblowHubDialog() }
        binding.cardHubBehaviorContract.setOnClickListener { showBehaviorContractHubDialog() }
        binding.cardHubRpl.setOnClickListener { showRplHubDialog() }
        binding.cardHubSociometry.setOnClickListener { showSociometryHubDialog() }
        binding.cardHubAkpd.setOnClickListener { showAkpdHubDialog() }
        binding.cardHubReward.setOnClickListener { showDisciplineRewardHubDialog() }
        binding.cardHubMonthlyReport.setOnClickListener { showMonthlyReportHubDialog() }
        binding.cardHubSecurityEthics.setOnClickListener { showSecurityEthicsHubDialog() }
        // Deteksi Multi-Role: Guru BK yang merangkap Wali Kelas (seperti Bu Endah Tri)
        val homeroomClass = sessionManager.getClassName().trim()
        val tugasTambahan = sessionManager.getTugasTambahan().uppercase().trim()
        val availableRoles = sessionManager.getAvailableRoles().map { it.uppercase().trim() }
        val isWaliKelas = (homeroomClass.isNotEmpty() && homeroomClass != "-" && homeroomClass != "null") ||
                tugasTambahan.contains("WALI") || availableRoles.any { it.contains("WALI") }

        if (isWaliKelas) {
            binding.gridMenuWaliKelas.visibility = View.VISIBLE
            val targetLabel = if (homeroomClass.isNotEmpty() && homeroomClass != "-" && homeroomClass != "null") "Kelas $homeroomClass" else "Kelas Binaan"
            binding.tvGridMenuWaliKelasSub.text = targetLabel
            binding.gridMenuWaliKelas.setOnClickListener {
                startActivity(Intent(this, WaliKelasActivity::class.java))
            }
        } else {
            binding.gridMenuWaliKelas.visibility = View.GONE
        }

        // Leave Filter buttons inside subpage
        binding.btnLeaveFilterAll.setOnClickListener { setLeaveFilter("ALL") }
        binding.btnLeaveFilterPending.setOnClickListener { setLeaveFilter("PENDING") }
        binding.btnLeaveFilterApproved.setOnClickListener { setLeaveFilter("APPROVED") }
        binding.btnLeaveFilterRejected.setOnClickListener { setLeaveFilter("REJECTED") }
        binding.btnRefreshBkLeaves.setOnClickListener { loadParentLeavesData(currentLeaveFilter) }
    }

    private fun setLeaveFilter(filter: String) {
        currentLeaveFilter = filter
        val activeBg = Color.parseColor("#059669")
        val activeText = Color.WHITE
        val inactiveText = Color.parseColor("#475569")

        fun applyFilterBtn(tv: TextView, isActive: Boolean) {
            if (isActive) {
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    setColor(activeBg)
                    cornerRadius = 10f * resources.displayMetrics.density
                }
                tv.background = gd
                tv.setTextColor(activeText)
                tv.setTypeface(null, Typeface.BOLD)
            } else {
                tv.setBackgroundColor(Color.TRANSPARENT)
                tv.setTextColor(inactiveText)
                tv.setTypeface(null, Typeface.NORMAL)
            }
        }

        applyFilterBtn(binding.btnLeaveFilterAll, filter == "ALL")
        applyFilterBtn(binding.btnLeaveFilterPending, filter == "PENDING")
        applyFilterBtn(binding.btnLeaveFilterApproved, filter == "APPROVED")
        applyFilterBtn(binding.btnLeaveFilterRejected, filter == "REJECTED")

        renderParentLeaveCards()
    }

    private fun loadParentLeavesSummary() {
        ApiClient.getClient(this).getTeacherLeaveRequests(status = "PENDING").enqueue(object : Callback<List<ParentLeaveRequestDto>> {
            override fun onResponse(call: Call<List<ParentLeaveRequestDto>>, response: Response<List<ParentLeaveRequestDto>>) {
                if (response.isSuccessful && response.body() != null) {
                    val count = response.body()!!.size
                    binding.tvQuickLeavesCount.text = "$count Menunggu"
                    binding.tvParentLeavesBadge.text = "$count"
                    binding.tvParentLeavesBadge.visibility = if (count > 0) View.VISIBLE else View.GONE
                }
            }
            override fun onFailure(call: Call<List<ParentLeaveRequestDto>>, t: Throwable) {}
        })
    }

    private fun loadParentLeavesData(filterStatus: String = "ALL") {
        Toast.makeText(this, "Memuat surat permohonan izin orang tua...", Toast.LENGTH_SHORT).show()
        val queryStatus = if (filterStatus == "ALL") null else filterStatus
        ApiClient.getClient(this).getTeacherLeaveRequests(status = queryStatus).enqueue(object : Callback<List<ParentLeaveRequestDto>> {
            override fun onResponse(call: Call<List<ParentLeaveRequestDto>>, response: Response<List<ParentLeaveRequestDto>>) {
                if (response.isSuccessful && response.body() != null) {
                    allParentLeaveRequests = response.body()!!
                    val pendingCount = allParentLeaveRequests.count { it.status.equals("PENDING", ignoreCase = true) }
                    binding.tvBkLeavesSummary.text = "Terdapat $pendingCount permohonan izin siswa menunggu persetujuan Guru BK"
                    binding.tvQuickLeavesCount.text = "$pendingCount Menunggu"
                    binding.tvParentLeavesBadge.text = "$pendingCount"
                    binding.tvParentLeavesBadge.visibility = if (pendingCount > 0) View.VISIBLE else View.GONE

                    renderParentLeaveCards()
                } else {
                    Toast.makeText(this@BkActivity, "Gagal memuat izin siswa", Toast.LENGTH_SHORT).show()
                }
            }
            override fun onFailure(call: Call<List<ParentLeaveRequestDto>>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderParentLeaveCards() {
        val container = binding.llBkLeavesList
        container.removeAllViews()

        val filtered = when (currentLeaveFilter) {
            "PENDING" -> allParentLeaveRequests.filter { it.status.equals("PENDING", ignoreCase = true) }
            "APPROVED" -> allParentLeaveRequests.filter { it.status.equals("APPROVED", ignoreCase = true) }
            "REJECTED" -> allParentLeaveRequests.filter { it.status.equals("REJECTED", ignoreCase = true) }
            else -> allParentLeaveRequests
        }

        if (filtered.isEmpty()) {
            val emptyTv = TextView(this).apply {
                text = "🎉 Tidak ada permohonan izin orang tua pada kategori ini."
                setTextColor(Color.parseColor("#64748B"))
                textSize = 12f
                gravity = android.view.Gravity.CENTER
                setPadding(20, 40, 20, 40)
            }
            container.addView(emptyTv)
            return
        }

        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        filtered.forEach { req ->
            val statusUpper = (req.status ?: "PENDING").uppercase()
            val daysCount = req.approvedDays ?: req.durationDays ?: 1
            val isDoctor = req.isDoctorNote == true
            val docLabel = if (isDoctor) {
                "🏥 Surat Keterangan Dokter Resmi ($daysCount Hari)"
            } else if (req.category.equals("SICK", ignoreCase = true)) {
                "🏠 Izin Sakit Orang Tua (Maks 3 Hari • Diajukan $daysCount Hari)"
            } else {
                "📝 Surat Izin Resmi Orang Tua ($daysCount Hari)"
            }

            val card = CardView(this).apply {
                radius = 14f * density
                cardElevation = 2f * density
                setCardBackgroundColor(
                    when (statusUpper) {
                        "APPROVED" -> Color.parseColor("#F0FDF4")
                        "REJECTED" -> Color.parseColor("#FEF2F2")
                        else -> Color.WHITE
                    }
                )
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(12)
                }
                layoutParams = lp
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
            }

            // Row 1: Student Name & Status Badge
            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val tvName = TextView(this).apply {
                text = "👤 ${req.studentName ?: "Siswa"} (${req.className ?: "-"})"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                layoutParams = lp
            }
            topRow.addView(tvName)

            val tvStatusBadge = TextView(this).apply {
                val (txt, bg, col) = when (statusUpper) {
                    "APPROVED" -> Triple("✅ DISETUJUI", "#DCFCE7", "#15803D")
                    "REJECTED" -> Triple("❌ DITOLAK", "#FEE2E2", "#DC2626")
                    else -> Triple("⏳ MENUNGGU DISETUJUI", "#FEF3C7", "#B45309")
                }
                text = txt
                setTextColor(Color.parseColor(col))
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(bg))
                    cornerRadius = dp(6).toFloat()
                }
                background = gd
                textSize = 9.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(dp(8), dp(4), dp(8), dp(4))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginStart = dp(6)
                }
                layoutParams = lp
            }
            topRow.addView(tvStatusBadge)
            inner.addView(topRow)

            // Category & Issuer of Letter
            val catLabel = when (req.category?.uppercase()) {
                "SICK", "SAKIT" -> "🏥 SAKIT"
                "PERMISSION", "IZIN" -> "✉️ IZIN KELUARGA"
                "DISPENSATION" -> "🎖️ DISPENSASI"
                else -> req.category ?: "IZIN"
            }
            val tvCat = TextView(this).apply {
                text = "$catLabel • $docLabel"
                setTextColor(if (isDoctor) Color.parseColor("#0284C7") else Color.parseColor("#059669"))
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, dp(4), 0, 0)
            }
            inner.addView(tvCat)

            // Dates & Duration
            val startStr = req.startDate?.take(10) ?: "-"
            val endStr = req.endDate?.take(10) ?: "-"
            val tvDates = TextView(this).apply {
                text = "🗓️ Durasi: $daysCount Hari ($startStr s/d $endStr)"
                setTextColor(Color.parseColor("#334155"))
                textSize = 11.5f
                setPadding(0, dp(3), 0, 0)
            }
            inner.addView(tvDates)

            // Issuer Details
            val tvIssuer = TextView(this).apply {
                text = if (isDoctor) "👨‍⚕️ Pengeluar: Surat Keterangan Dokter Resmi (Klinik / RS)"
                else "👨‍👩‍👧 Pengeluar: Surat Izin Orang Tua / Wali Ananda"
                setTextColor(Color.parseColor("#475569"))
                textSize = 11f
                setPadding(0, dp(2), 0, 0)
            }
            inner.addView(tvIssuer)

            // Requester
            val tvParent = TextView(this).apply {
                text = "📞 Pemohon: ${req.parentName ?: "Orang Tua"} • Telp: ${req.parentPhone ?: "-"}"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11f
                setPadding(0, dp(2), 0, 0)
            }
            inner.addView(tvParent)

            // Reason
            val tvReason = TextView(this).apply {
                text = "💬 Alasan: ${req.reason ?: "-"}"
                setTextColor(Color.parseColor("#1E293B"))
                textSize = 11.5f
                setPadding(0, dp(4), 0, dp(6))
            }
            inner.addView(tvReason)

            // Proof Photo Button
            if (!req.attachmentUrl.isNullOrEmpty()) {
                val btnViewPhoto = Button(this).apply {
                    text = "📎 Lihat Foto Bukti / Surat Dokter →"
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#2563EB"))
                    setBackgroundColor(Color.parseColor("#EFF6FF"))
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38)).apply {
                        topMargin = dp(4)
                        bottomMargin = dp(4)
                    }
                    layoutParams = lp
                    setOnClickListener {
                        showProofPhotoDialog(req.studentName ?: "Siswa", req.attachmentUrl!!)
                    }
                }
                inner.addView(btnViewPhoto)
            } else {
                val tvNoDoc = TextView(this).apply {
                    text = "⚠️ Tanpa lampiran foto surat dokter/bukti fisik"
                    setTextColor(Color.parseColor("#94A3B8"))
                    textSize = 10.5f
                    setPadding(0, dp(2), 0, dp(4))
                }
                inner.addView(tvNoDoc)
            }

            // Action Buttons if PENDING
            if (statusUpper == "PENDING") {
                val btnRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = dp(6)
                    }
                    layoutParams = lp
                }

                val btnReject = Button(this).apply {
                    text = "❌ Tolak Izin"
                    textSize = 11f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#DC2626"))
                    val lp = LinearLayout.LayoutParams(0, dp(38), 1f).apply { marginEnd = dp(4) }
                    layoutParams = lp
                    setOnClickListener {
                        val input = EditText(this@BkActivity).apply {
                            hint = "Alasan penolakan..."
                            setText("Wajib melampirkan Surat Keterangan Dokter resmi (bukan tulisan tangan)")
                        }
                        AlertDialog.Builder(this@BkActivity)
                            .setTitle("Tolak Permohonan Izin")
                            .setMessage("Masukkan alasan penolakan untuk orang tua ananda:")
                            .setView(input)
                            .setPositiveButton("Tolak Izin") { _, _ ->
                                val reason = input.text.toString().trim()
                                ApiClient.getClient(this@BkActivity).verifyTeacherLeave(
                                    req.id,
                                    VerifyLeaveRequest(status = "REJECTED", rejectionNote = reason)
                                ).enqueue(object : Callback<BasicResponse> {
                                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                        Toast.makeText(this@BkActivity, "Permohonan izin ditolak", Toast.LENGTH_SHORT).show()
                                        loadParentLeavesData(currentLeaveFilter)
                                        loadParentLeavesSummary()
                                    }
                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                        Toast.makeText(this@BkActivity, "Gagal menolak izin", Toast.LENGTH_SHORT).show()
                                    }
                                })
                            }
                            .setNegativeButton("Batal", null)
                            .show()
                    }
                }

                val btnApprove = Button(this).apply {
                    text = "✅ Setujui ($daysCount Hari)"
                    textSize = 11f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#059669"))
                    val lp = LinearLayout.LayoutParams(0, dp(38), 1f).apply { marginStart = dp(4) }
                    layoutParams = lp
                    setOnClickListener {
                        AlertDialog.Builder(this@BkActivity)
                            .setTitle("Setujui Izin Siswa")
                            .setMessage("Setujui izin ${req.studentName ?: "Siswa"} selama $daysCount hari ($startStr s/d $endStr)?\n\nPresensi siswa otomatis akan dicatat sebagai ${req.category} pada rekap presensi kelas.")
                            .setPositiveButton("Ya, Setujui") { _, _ ->
                                ApiClient.getClient(this@BkActivity).verifyTeacherLeave(
                                    req.id,
                                    VerifyLeaveRequest(status = "APPROVED")
                                ).enqueue(object : Callback<BasicResponse> {
                                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                        Toast.makeText(this@BkActivity, "✅ Izin berhasil disetujui & otomatis masuk rekap harian!", Toast.LENGTH_LONG).show()
                                        loadParentLeavesData(currentLeaveFilter)
                                        loadParentLeavesSummary()
                                        loadBkClassRecap(currentSelectedClass)
                                    }
                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                        Toast.makeText(this@BkActivity, "Gagal menyetujui izin", Toast.LENGTH_SHORT).show()
                                    }
                                })
                            }
                            .setNegativeButton("Batal", null)
                            .show()
                    }
                }

                btnRow.addView(btnReject)
                btnRow.addView(btnApprove)
                inner.addView(btnRow)
            } else {
                val tvVerified = TextView(this).apply {
                    text = if (statusUpper == "APPROVED")
                        "✅ Disetujui $daysCount Hari oleh ${req.verifiedBy ?: "Guru BK"} • Otomatis masuk rekap"
                    else
                        "❌ Ditolak: ${req.rejectionNote ?: "-"}"
                    setTextColor(if (statusUpper == "APPROVED") Color.parseColor("#15803D") else Color.parseColor("#DC2626"))
                    textSize = 11f
                    setTypeface(null, Typeface.BOLD)
                    setPadding(0, dp(4), 0, 0)
                }
                inner.addView(tvVerified)
            }

            card.addView(inner)
            container.addView(card)
        }
    }

    private fun showContactAdminDialog() {
        AlertDialog.Builder(this)
            .setTitle("🎧 Pusat Bantuan & Operator Sekolah")
            .setMessage("Layanan Teknis Smart CBT SMP Negeri 1 Boyolangu:\n\n• Operator CBT / Kurikulum: Tersedia di Ruang Kurikulum\n• Hubungi Admin IT / Lab CBT: 0812-3456-7890\n• Jam Layanan: 07.00 - 15.30 WIB")
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun setupBkMainMenuGrid() {
        // Digantikan oleh setupModernBkDashboard() & navigateToSection()
    }

    private fun setupBkTabs() {
        if (isCounselorMode) {
            navigateToSection(BkSection.HOME)
        }
    }

    fun switchBkTab(tabIndex: Int) {
        currentBkTab = tabIndex
        if (isCounselorMode) {
            navigateToSection(BkSection.HOME)
        }
    }

    private fun loadBkArticles() {
        val container = binding.llBkArticlesContainer
        container.removeAllViews()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val articles = listOf(
            Triple("💡 Tips Manajemen Waktu & Anti Menunda Tugas", "Gunakan metode Pomodoro (25 menit belajar, 5 menit istirahat). Tulis daftar prioritas harian agar tugas tidak menumpuk sebelum deadline!", "#EFF6FF" to "#1D4ED8"),
            Triple("🧭 Kenali 3 Gaya Belajar: Visual, Auditori, Kinestetik", "Gaya visual belajar lebih efektif lewat diagram & warna, auditori lewat mendengarkan & diskusi, kinestetik lewat praktik langsung.", "#F0FDF4" to "#15803D"),
            Triple("🛡️ Stop Perundungan (Bullying)! Berani Bicara!", "Perundungan bukan hal yang wajar. Jika kamu atau temanmu mengalami tekanan fisik, verbal, atau cyberbullying, segera sampaikan lewat tab Curhat & Lapor secara anonim.", "#FEF2F2" to "#991B1B"),
            Triple("🧘 Mengatasi Kejenuhan & Stres Belajar SMP", "Luangkan waktu 15 menit setiap sore untuk relaksasi, minum air putih cukup, dan konsultasikan kendala belajar dengan Guru BK atau Wali Kelasmu.", "#FFFBEB" to "#B45309")
        )

        articles.forEach { (title, desc, colors) ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(colors.first))
                    cornerRadius = dp(12).toFloat()
                    setStroke(dp(1), Color.parseColor(colors.second))
                }
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(10) }
            }

            val tvTitle = TextView(this).apply {
                text = title
                setTextColor(Color.parseColor(colors.second))
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
            }
            val tvDesc = TextView(this).apply {
                text = desc
                setTextColor(Color.parseColor("#334155"))
                textSize = 11.5f
                setPadding(0, dp(4), 0, 0)
            }
            card.addView(tvTitle)
            card.addView(tvDesc)
            container.addView(card)
        }
    }

    private fun setupUI() {
        binding.btnBackBk.setOnClickListener { finish() }
        binding.btnLogoutBk.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("🚪 Logout Akun Guru BK")
                .setMessage("Apakah Anda yakin ingin keluar dari akun ${sessionManager.getName()}?")
                .setPositiveButton("Ya, Keluar") { _, _ ->
                    sessionManager.clearSession()
                    val intent = Intent(this, LoginActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    }
                    startActivity(intent)
                    finish()
                }
                .setNegativeButton("Batal", null)
                .show()
        }

        binding.etSearchStudentBk.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
                filterBkRecapStudents(s?.toString()?.trim() ?: "")
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })

        binding.btnRefreshBk.setOnClickListener {
            Toast.makeText(this, "Menyegarkan data konseling & kedisiplinan...", Toast.LENGTH_SHORT).show()
            if (isCounselorMode) {
                loadBkClassRecap(bkSelectedSubClass.ifEmpty { currentSelectedClass })
                loadPendingStudentLeaves()
                loadBkDisciplineAndSpData()
                loadConsultations()
            } else {
                loadConsultations()
                loadStudentProfile()
                if (currentBkTab == 3) loadBkDisciplineAndSpData()
            }
        }

        if (isCounselorMode) {
            binding.tvBkTopTitle.text = "🏛️ Portal Guru BK (Bimbingan Konseling)"
            binding.tvBkTopSubtitle.text = "Menu Utama BK, Poin Kedisiplinan, Early Warning SP & Konseling"
            binding.tvBkCounselorName.text = "${sessionManager.getName()} (Guru BK)"
            binding.cardAppointmentForm.visibility = View.GONE
            binding.cardReportForm.visibility = View.GONE
            binding.tvBkTotalPoints.text = "Radar Early Warning SP & Buku Poin"
            binding.tvBkSpBadge.text = "🛡️ Mode Guru BK"
            binding.tvBkSpBadge.setBackgroundColor(Color.parseColor("#E0E7FF"))
            binding.tvBkSpBadge.setTextColor(Color.parseColor("#3730A3"))
            return
        }

        if (isParentMode) {
            val childName = intent.getStringExtra(EXTRA_STUDENT_NAME)?.ifEmpty { null } ?: sessionManager.getName().ifEmpty { "Ananda" }
            val className = intent.getStringExtra(EXTRA_CLASS_NAME)?.ifEmpty { null } ?: sessionManager.getClassName().ifEmpty { "-" }
            binding.tvBkTopTitle.text = "💬 Ruang Konsultasi Langsung Wali Murid"
            binding.tvBkTopSubtitle.text = "Konsultasi & Tanya Jawab Langsung Guru BK • $childName ($className)"
            binding.tvReportCardTitle.text = "💬 Tulis Pertanyaan / Konsultasi Baru ke Guru BK"
            binding.tvReportCardSub.text = "Ajukan pertanyaan, kendala belajar, atau konsultasi perkembangan ananda langsung kepada Guru BK"
            binding.etReportSubject.hint = "Topik / Perihal Konsultasi (Contoh: Kendala Belajar Matematika)"
            binding.etReportMessage.hint = "Tuliskan pertanyaan atau hal yang ingin Anda konsultasikan secara lengkap..."
            binding.btnSubmitReport.text = "Kirim Pertanyaan ke Guru BK"
            binding.btnSubmitReport.setBackgroundColor(Color.parseColor("#0D9488"))
            binding.containerIdentityCards.visibility = View.GONE
            binding.tvIdentityOptionTitle.visibility = View.GONE
        } else {
            binding.tvBkTopTitle.text = "🕊️ Ruang BK & Konseling Siswa"
            binding.tvBkTopSubtitle.text = "Privasi Terjamin • Bimbingan Belajar, Karakter & Anti-Bullying"
            binding.containerIdentityCards.visibility = View.VISIBLE
            binding.tvIdentityOptionTitle.visibility = View.VISIBLE
        }

        // Setup Identity Selector Cards (Card 1: Tampilkan Identitas / Default, Card 2: Sembunyikan Nama / Whistleblower)
        fun updateIdentitySelectionUI(isAnon: Boolean) {
            isAnonymousReport = isAnon
            if (!isAnon) {
                binding.cardIdentityOpen.setCardBackgroundColor(Color.parseColor("#EFF6FF"))
                binding.rbIdentityOpen.isChecked = true
                binding.tvIdentityOpenTitle.setTextColor(Color.parseColor("#1D4ED8"))

                binding.cardIdentityAnon.setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                binding.rbIdentityAnon.isChecked = false
                binding.tvIdentityAnonTitle.setTextColor(Color.parseColor("#475569"))
            } else {
                binding.cardIdentityOpen.setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                binding.rbIdentityOpen.isChecked = false
                binding.tvIdentityOpenTitle.setTextColor(Color.parseColor("#475569"))

                binding.cardIdentityAnon.setCardBackgroundColor(Color.parseColor("#FEF3C7"))
                binding.rbIdentityAnon.isChecked = true
                binding.tvIdentityAnonTitle.setTextColor(Color.parseColor("#B45309"))
            }
        }

        updateIdentitySelectionUI(false) // Default: Tampilkan Identitas Terbuka

        binding.cardIdentityOpen.setOnClickListener {
            updateIdentitySelectionUI(false)
        }
        binding.cardIdentityAnon.setOnClickListener {
            updateIdentitySelectionUI(true)
        }

        // Setup Category Spinner
        val categories = if (isParentMode) {
            arrayOf(
                "Konsultasi Perkembangan Karakter Anak",
                "Kendala Belajar & Disiplin di Rumah",
                "Laporan / Kekhawatiran Perundungan (Bullying)",
                "Koordinasi Perilaku & Sosial",
                "Rencana Studi Lanjutan Anak",
                "Lainnya"
            )
        } else {
            arrayOf(
                "Masalah Belajar & Akademik",
                "Pengaduan Perundungan (Bullying)",
                "Masalah Sosial & Pertemanan",
                "Kendala Pribadi & Emosional",
                "Bimbingan Karir & Masa Depan",
                "Lainnya"
            )
        }
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, categories)
        binding.spinnerReportCategory.adapter = adapter

        // Setup Janji Temu Submit
        binding.btnSubmitAppointment.setOnClickListener {
            val topic = binding.etAppointmentTopic.text.toString().trim()
            val date = binding.etAppointmentDate.text.toString().trim()
            val time = binding.etAppointmentTime.text.toString().trim()

            if (topic.isEmpty()) {
                Toast.makeText(this, "Harap isi topik konseling", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val senderPrefix = if (isParentMode) "[Janji Temu Wali Murid]" else "Janji Temu"
            val req = SendReportRequest(
                category = "JANJI_TEMU",
                subject = "$senderPrefix: $topic",
                message = "Permohonan sesi tatap muka: $date pukul $time. Topik: $topic",
                isAnonymous = false,
                studentId = targetStudentId
            )

            sendReportToServer(req, "✅ Permohonan janji temu berhasil diajukan ke Guru BK!")
        }

        // Setup Pengaduan / Konsultasi Submit
        binding.btnSubmitReport.setOnClickListener {
            val cat = binding.spinnerReportCategory.selectedItem.toString()
            val subject = binding.etReportSubject.text.toString().trim()
            val message = binding.etReportMessage.text.toString().trim()
            val isAnon = if (isParentMode) false else isAnonymousReport

            if (subject.isEmpty() || message.isEmpty()) {
                Toast.makeText(this, "Harap isi judul dan keterangan pengaduan", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val prefix = if (isParentMode) "[KONSULTASI WALI MURID] " else ""
            val req = SendReportRequest(
                category = if (isParentMode) "WALI_MURID" else cat,
                subject = prefix + subject,
                message = message,
                isAnonymous = isAnon,
                studentId = targetStudentId
            )

            val successMsg = if (isParentMode)
                "✅ Pesan konsultasi wali murid berhasil dikirim ke Guru BK!"
            else if (isAnon)
                "✅ Laporan berhasil dikirim secara anonim (identitas dirahasiakan)!"
            else
                "✅ Konsultasi berhasil dikirim ke Guru BK!"
            sendReportToServer(req, successMsg)
        }
    }

    private fun sendReportToServer(req: SendReportRequest, successMsg: String) {
        ApiClient.getClient(this).sendStudentReport(req).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    Toast.makeText(this@BkActivity, successMsg, Toast.LENGTH_LONG).show()
                    binding.etAppointmentTopic.text.clear()
                    binding.etAppointmentDate.text.clear()
                    binding.etAppointmentTime.text.clear()
                    binding.etReportSubject.text.clear()
                    binding.etReportMessage.text.clear()
                    loadConsultations()
                    switchBkTab(0)
                } else {
                    Toast.makeText(this@BkActivity, "Gagal mengirim ke server BK", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun loadConsultations() {
        if (isCounselorMode) {
            ApiClient.getClient(this).getAllBkConsultations().enqueue(object : Callback<List<ConsultationDto>> {
                override fun onResponse(call: Call<List<ConsultationDto>>, response: Response<List<ConsultationDto>>) {
                    if (response.isSuccessful && response.body() != null) {
                        val list = response.body()!!
                        allCounselorConsultations = list
                        setupCounselorTabFilterUI()
                        filterAndRenderCounselorConsultations()
                    }
                }

                override fun onFailure(call: Call<List<ConsultationDto>>, t: Throwable) {
                    // Ignore network error in background refresh
                }
            })
        } else {
            val queryId = targetStudentId ?: if (isParentMode) null else sessionManager.getUserId()
            ApiClient.getClient(this).getStudentConsultations(queryId).enqueue(object : Callback<List<ConsultationDto>> {
                override fun onResponse(call: Call<List<ConsultationDto>>, response: Response<List<ConsultationDto>>) {
                    if (response.isSuccessful && response.body() != null) {
                        val list = response.body()!!
                        renderConsultationList(list)
                    }
                }

                override fun onFailure(call: Call<List<ConsultationDto>>, t: Throwable) {
                    // Ignore network error in background refresh
                }
            })
        }
    }

    private fun setupCounselorTabFilterUI() {
        if (!isCounselorMode) return
        binding.layoutBkCounselorTabs.visibility = View.VISIBLE

        binding.btnTabFilterStudent.setOnClickListener {
            counselorFilterType = "STUDENT"
            updateCounselorTabIndicator()
            filterAndRenderCounselorConsultations()
        }

        binding.btnTabFilterParent.setOnClickListener {
            counselorFilterType = "PARENT"
            updateCounselorTabIndicator()
            filterAndRenderCounselorConsultations()
        }

        if (!isSearchWatcherAttached) {
            binding.etSearchBkConsultations.addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    consultationSearchQuery = s?.toString()?.trim() ?: ""
                    filterAndRenderCounselorConsultations()
                }
                override fun afterTextChanged(s: android.text.Editable?) {}
            })
            isSearchWatcherAttached = true
        }

        updateCounselorTabIndicator()
    }

    private fun updateCounselorTabIndicator() {
        if (counselorFilterType == "STUDENT") {
            binding.btnTabFilterStudent.apply {
                setBackgroundColor(Color.WHITE)
                setTextColor(Color.parseColor("#4338CA"))
                setTypeface(null, Typeface.BOLD)
            }
            binding.btnTabFilterParent.apply {
                setBackgroundColor(Color.TRANSPARENT)
                setTextColor(Color.parseColor("#64748B"))
                setTypeface(null, Typeface.NORMAL)
            }
        } else {
            binding.btnTabFilterStudent.apply {
                setBackgroundColor(Color.TRANSPARENT)
                setTextColor(Color.parseColor("#64748B"))
                setTypeface(null, Typeface.NORMAL)
            }
            binding.btnTabFilterParent.apply {
                setBackgroundColor(Color.WHITE)
                setTextColor(Color.parseColor("#0D9488"))
                setTypeface(null, Typeface.BOLD)
            }
        }
    }

    private fun renderBkStatusChips(baseList: List<ConsultationDto>) {
        val ll = binding.llBkStatusChips
        ll.removeAllViews()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val allCount = baseList.size
        val pendingCount = baseList.count { (it.status == "PENDING" || it.status.isNullOrEmpty()) && it.replyMessage.isNullOrEmpty() }
        val scheduledCount = baseList.count { it.status == "SCHEDULED" }
        val repliedCount = baseList.count { (it.status == "REPLIED" || !it.replyMessage.isNullOrEmpty()) && it.status != "RESOLVED" && it.status != "COMPLETED" && it.status != "SELESAI" && it.status != "SCHEDULED" }
        val resolvedCount = baseList.count { it.status == "RESOLVED" || it.status == "COMPLETED" || it.status == "SELESAI" }

        val filterDefs = listOf(
            Triple("ALL", "Semua", allCount),
            Triple("PENDING", "⏳ Menunggu", pendingCount),
            Triple("SCHEDULED", "📅 Tatap Muka", scheduledCount),
            Triple("REPLIED", "💬 Dibalas", repliedCount),
            Triple("RESOLVED", "✔ Selesai", resolvedCount)
        )

        filterDefs.forEach { (key, label, count) ->
            val isSel = (counselorStatusFilter == key)
            val btn = TextView(this).apply {
                text = "$label ($count)"
                textSize = 11f
                setTypeface(null, if (isSel) Typeface.BOLD else Typeface.NORMAL)
                val padH = dp(12)
                val padV = dp(6)
                setPadding(padH, padV, padH, padV)
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 14f * density
                    if (isSel) {
                        setColor(Color.parseColor("#4338CA"))
                    } else {
                        setColor(Color.parseColor("#F1F5F9"))
                        setStroke(dp(1), Color.parseColor("#CBD5E1"))
                    }
                }
                background = gd
                setTextColor(if (isSel) Color.WHITE else Color.parseColor("#475569"))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = dp(6)
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    counselorStatusFilter = key
                    renderBkStatusChips(baseList)
                    filterAndRenderCounselorConsultations()
                }
            }
            ll.addView(btn)
        }
    }

    private fun filterAndRenderCounselorConsultations() {
        val studentList = allCounselorConsultations.filter { c ->
            !c.category.contains("WALI", ignoreCase = true) && !c.subject.contains("WALI MURID", ignoreCase = true)
        }
        val parentList = allCounselorConsultations.filter { c ->
            c.category.contains("WALI", ignoreCase = true) || c.subject.contains("WALI MURID", ignoreCase = true)
        }

        binding.btnTabFilterStudent.text = "💬 Laporan Siswa (${studentList.size})"
        binding.btnTabFilterParent.text = "👨‍👩‍👧 Konsultasi Wali Murid (${parentList.size})"

        val baseList = if (counselorFilterType == "STUDENT") studentList else parentList
        renderBkStatusChips(baseList)

        var filtered = when (counselorStatusFilter) {
            "PENDING" -> baseList.filter { (it.status == "PENDING" || it.status.isNullOrEmpty()) && it.replyMessage.isNullOrEmpty() }
            "SCHEDULED" -> baseList.filter { it.status == "SCHEDULED" }
            "REPLIED" -> baseList.filter { (it.status == "REPLIED" || !it.replyMessage.isNullOrEmpty()) && it.status != "RESOLVED" && it.status != "COMPLETED" && it.status != "SELESAI" && it.status != "SCHEDULED" }
            "RESOLVED" -> baseList.filter { it.status == "RESOLVED" || it.status == "COMPLETED" || it.status == "SELESAI" }
            else -> baseList
        }

        if (consultationSearchQuery.isNotEmpty()) {
            val q = consultationSearchQuery.lowercase()
            filtered = filtered.filter { c ->
                (c.student?.name?.lowercase()?.contains(q) == true) ||
                (c.student?.className?.lowercase()?.contains(q) == true) ||
                (c.subject.lowercase().contains(q)) ||
                (c.message.lowercase().contains(q)) ||
                (c.category?.lowercase()?.contains(q) == true)
            }
        }

        renderConsultationList(filtered)
    }

    private fun renderConsultationList(list: List<ConsultationDto>) {
        binding.containerBkMessages.removeAllViews()
        binding.tvBkMessageCount.text = "${list.size} Konsultasi"

        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        if (list.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = if (isCounselorMode)
                    "Tidak ada pengaduan atau konsultasi yang cocok dengan filter."
                else if (isParentMode)
                    "Belum ada riwayat konsultasi tanya jawab dengan Guru BK.\nSilakan sampaikan pertanyaan atau konsultasi baru di formulir bawah."
                else
                    "Belum ada riwayat sesi konseling atau pengaduan."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(dp(20), dp(20), dp(20), dp(20))
                setBackgroundColor(Color.WHITE)
                gravity = android.view.Gravity.CENTER
            }
            binding.containerBkMessages.addView(tvEmpty)
            return
        }

        list.forEach { c ->
            val isResolved = (c.status == "RESOLVED" || c.status == "COMPLETED" || c.status == "SELESAI")
            val isScheduled = (c.status == "SCHEDULED")
            val isReplied = (c.status == "REPLIED" || !c.replyMessage.isNullOrEmpty()) && !isResolved && !isScheduled

            val card = CardView(this).apply {
                radius = 12f * density
                cardElevation = 1.5f * density
                useCompatPadding = true
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = dp(8)
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    showConsultationDetailAndReplyDialog(c)
                }
            }

            val cardInner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }

            // Row 1: Category Pill & Status Badge
            val rowHeader = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val isWhistle = c.isAnonymous || c.category?.contains("BULLYING", ignoreCase = true) == true
            val tvCategory = TextView(this).apply {
                text = if (c.isAnonymous) "🛡️ Whistleblower Anonim" else (c.category ?: "Bimbingan BK")
                setTextColor(if (isWhistle) Color.parseColor("#991B1B") else Color.parseColor("#1E293B"))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(if (isWhistle) Color.parseColor("#FEE2E2") else Color.parseColor("#F1F5F9"))
                    cornerRadius = 6f * density
                }
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(dp(8), dp(3), dp(8), dp(3))
            }
            rowHeader.addView(tvCategory)

            val spacerH = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
            }
            rowHeader.addView(spacerH)

            val (statusText, statusBg, statusColor) = when {
                isResolved -> Triple("✔ SELESAI", "#DCFCE7", "#15803D")
                isScheduled -> Triple("📅 TATAP MUKA", "#EEF2FF", "#3730A3")
                isReplied -> Triple("💬 DIBALAS", "#CCFBF1", "#0D9488")
                else -> Triple("⏳ MENUNGGU", "#FEF3C7", "#92400E")
            }

            val tvStatus = TextView(this).apply {
                text = statusText
                setTextColor(Color.parseColor(statusColor))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(statusBg))
                    cornerRadius = 6f * density
                }
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setPadding(dp(8), dp(3), dp(8), dp(3))
            }
            rowHeader.addView(tvStatus)
            cardInner.addView(rowHeader)

            // Row 2: Sender identity & Date
            val rowSender = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(6)
                }
                layoutParams = lp
            }

            val isParentMsg = c.category?.contains("WALI", ignoreCase = true) == true || c.subject.contains("WALI MURID", ignoreCase = true)
            val senderLabel = when {
                isParentMsg -> "👨‍👩‍👧 Wali Murid • ${c.student?.name ?: "Siswa"} (${c.student?.className ?: "-"})"
                c.isAnonymous -> "🕵️ Siswa Anonim (TPPK Rahaja)"
                else -> "👤 ${c.student?.name ?: "Siswa"} • Kelas ${c.student?.className ?: "-"}"
            }

            val tvSender = TextView(this).apply {
                text = senderLabel
                setTextColor(if (c.isAnonymous) Color.parseColor("#D97706") else Color.parseColor("#4338CA"))
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            rowSender.addView(tvSender)

            val tvDate = TextView(this).apply {
                val rawDate = c.replyDate ?: ""
                text = if (rawDate.length >= 10) rawDate.take(10) else ""
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 10f
            }
            rowSender.addView(tvDate)
            cardInner.addView(rowSender)

            // Row 3: Subject (Bold, maxLines 1)
            val tvSubject = TextView(this).apply {
                text = c.subject
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            cardInner.addView(tvSubject)

            // Row 4: Message Excerpt (Max 2 lines)
            val tvExcerpt = TextView(this).apply {
                text = c.message
                setTextColor(Color.parseColor("#475569"))
                textSize = 11f
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(2)
                }
                layoutParams = lp
            }
            cardInner.addView(tvExcerpt)

            // Row 5: Action Strip / Indicator
            val actionRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(8)
                }
                layoutParams = lp
            }

            if (!c.evidenceUrl.isNullOrEmpty()) {
                val tvEvBadge = TextView(this).apply {
                    text = "📷 Bukti Digital"
                    textSize = 9.5f
                    setTextColor(Color.parseColor("#BE123C"))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#FFE4E6"))
                        cornerRadius = 4f * density
                    }
                    setPadding(dp(6), dp(2), dp(6), dp(2))
                }
                actionRow.addView(tvEvBadge)
            } else if (isScheduled) {
                val tvSchedBadge = TextView(this).apply {
                    text = "📅 Sesi Terjadwal"
                    textSize = 9.5f
                    setTextColor(Color.parseColor("#3730A3"))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#EEF2FF"))
                        cornerRadius = 4f * density
                    }
                    setPadding(dp(6), dp(2), dp(6), dp(2))
                }
                actionRow.addView(tvSchedBadge)
            } else if (isReplied) {
                val tvRepBadge = TextView(this).apply {
                    text = "💬 Sudah Ditanggapi"
                    textSize = 9.5f
                    setTextColor(Color.parseColor("#0D9488"))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#CCFBF1"))
                        cornerRadius = 4f * density
                    }
                    setPadding(dp(6), dp(2), dp(6), dp(2))
                }
                actionRow.addView(tvRepBadge)
            }

            val actionSpacer = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
            }
            actionRow.addView(actionSpacer)

            val tvOpenDetail = TextView(this).apply {
                text = if (isCounselorMode) "👁️ Tindak Lanjut →" else "👁️ Buka Detail →"
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0D9488"))
                setOnClickListener {
                    showConsultationDetailAndReplyDialog(c)
                }
            }
            actionRow.addView(tvOpenDetail)
            cardInner.addView(actionRow)

            card.addView(cardInner)
            binding.containerBkMessages.addView(card)
        }
    }

    private fun showConsultationDetailAndReplyDialog(c: ConsultationDto) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        scroll.addView(root)

        // 1. Status & Category Header
        val headerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val isResolved = (c.status == "RESOLVED" || c.status == "COMPLETED" || c.status == "SELESAI")
        val isScheduled = (c.status == "SCHEDULED")
        val isReplied = (c.status == "REPLIED" || !c.replyMessage.isNullOrEmpty()) && !isResolved && !isScheduled

        val tvCategoryBadge = TextView(this).apply {
            text = c.category ?: "Bimbingan BK"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        headerRow.addView(tvCategoryBadge)

        val (statusText, statusBg, statusColor) = when {
            isResolved -> Triple("✔ SELESAI", "#DCFCE7", "#15803D")
            isScheduled -> Triple("📅 TATAP MUKA", "#EEF2FF", "#3730A3")
            isReplied -> Triple("💬 DIBALAS", "#CCFBF1", "#0D9488")
            else -> Triple("⏳ MENUNGGU", "#FEF3C7", "#92400E")
        }
        val tvStatusBadge = TextView(this).apply {
            text = statusText
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor(statusColor))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor(statusBg))
                cornerRadius = 8f * density
            }
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        headerRow.addView(tvStatusBadge)
        root.addView(headerRow)

        // 2. Sender Identity Card
        val senderCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 10f * density
                setStroke(dp(1), Color.parseColor("#E2E8F0"))
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(10)
            }
            layoutParams = lp
        }

        val isParentMsg = c.category?.contains("WALI", ignoreCase = true) == true || c.subject.contains("WALI MURID", ignoreCase = true)
        val senderTitle = when {
            isParentMsg -> "👨‍👩‍👧 Wali Murid dari Siswa: ${c.student?.name ?: "Siswa"}"
            c.isAnonymous -> "🕵️ Siswa Anonim (Whistleblower Protection)"
            else -> "👤 Siswa: ${c.student?.name ?: "Siswa"} (Kelas ${c.student?.className ?: "-"})"
        }
        val tvSender = TextView(this).apply {
            text = senderTitle
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(if (c.isAnonymous) Color.parseColor("#D97706") else Color.parseColor("#0F172A"))
        }
        senderCard.addView(tvSender)

        if (!c.isAnonymous && c.student != null) {
            val tvSubInfo = TextView(this).apply {
                text = "NISN: ${c.student?.nisn ?: "-"} • Kelas: ${c.student?.className ?: "-"}"
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
                setPadding(0, dp(2), 0, 0)
            }
            senderCard.addView(tvSubInfo)
        }
        root.addView(senderCard)

        // 3. Subject Box
        val tvSubjHeader = TextView(this).apply {
            text = "📌 SUBJEK KASUS / PENGADUAN:"
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(12), 0, dp(2))
        }
        root.addView(tvSubjHeader)

        val tvSubject = TextView(this).apply {
            text = c.subject
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        root.addView(tvSubject)

        // 4. Message Box
        val msgBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F0F9FF"))
                cornerRadius = 10f * density
                setStroke(dp(1), Color.parseColor("#BAE6FD"))
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            }
            layoutParams = lp
        }

        val tvMsgHeader = TextView(this).apply {
            text = if (isParentMsg) "💬 Isi Pesan Wali Murid:" else "💬 Isi Pesan / Curhat Siswa:"
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0284C7"))
        }
        msgBox.addView(tvMsgHeader)

        val tvMessage = TextView(this).apply {
            text = c.message
            textSize = 12f
            setTextColor(Color.parseColor("#0C4A6E"))
            setPadding(0, dp(4), 0, 0)
            setTextIsSelectable(true)
        }
        msgBox.addView(tvMessage)
        root.addView(msgBox)

        // 5. Evidence Screenshot (if present)
        if (!c.evidenceUrl.isNullOrEmpty()) {
            val btnEvidence = Button(this).apply {
                text = "📷 Buka Bukti Screenshot Cyberbullying"
                textSize = 11.5f
                setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#BE123C"))
                    cornerRadius = 8f * density
                }
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)).apply {
                    topMargin = dp(8)
                }
                layoutParams = lp
                setOnClickListener {
                    showEvidenceImageDialog(c.evidenceUrl!!)
                }
            }
            root.addView(btnEvidence)
        }

        // 6. Scheduled Meeting Box (if scheduled)
        if (isScheduled) {
            val schedBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#EEF2FF"))
                    cornerRadius = 10f * density
                    setStroke(dp(1), Color.parseColor("#C7D2FE"))
                }
                setPadding(dp(12), dp(10), dp(12), dp(10))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(10)
                }
                layoutParams = lp
            }
            val tvSchedTitle = TextView(this).apply {
                text = "📅 JADWAL PERTEMUAN TATAP MUKA RUANG BK"
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#3730A3"))
            }
            schedBox.addView(tvSchedTitle)

            val tvSchedNotes = TextView(this).apply {
                text = c.replyMessage ?: "Siswa dijadwalkan hadir ke Ruang BK."
                textSize = 11.5f
                setTextColor(Color.parseColor("#1E1B4B"))
                setPadding(0, dp(4), 0, 0)
            }
            schedBox.addView(tvSchedNotes)
            root.addView(schedBox)
        }

        // 7. Counselor Reply Box (if replied)
        if (!c.replyMessage.isNullOrEmpty() && !isScheduled) {
            val replyBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F0FDF4"))
                    cornerRadius = 10f * density
                    setStroke(dp(1), if (isResolved) Color.parseColor("#86EFAC") else Color.parseColor("#BBF7D0"))
                }
                setPadding(dp(12), dp(10), dp(12), dp(10))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(10)
                }
                layoutParams = lp
            }
            val tvReplyTitle = TextView(this).apply {
                text = if (isResolved) "🕊️ Tanggapan & Solusi Guru BK (STATUS: SELESAI ✔):" else "🕊️ Tanggapan Guru BK (Konselor):"
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#15803D"))
            }
            replyBox.addView(tvReplyTitle)

            val tvReply = TextView(this).apply {
                text = c.replyMessage
                textSize = 12f
                setTextColor(Color.parseColor("#14532D"))
                setPadding(0, dp(4), 0, 0)
                setTextIsSelectable(true)
            }
            replyBox.addView(tvReply)
            root.addView(replyBox)
        }

        var dialog: AlertDialog? = null

        // 8. Action Buttons
        val actionsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(14)
            }
            layoutParams = lp
        }

        if (isCounselorMode) {
            val btnReply = Button(this).apply {
                text = if (isResolved) "✏️ Perbarui Tanggapan / Solusi" else "✍️ Berikan Tanggapan / Solusi BK"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#0D9488"))
                    cornerRadius = 8f * density
                }
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)).apply {
                    bottomMargin = dp(8)
                }
                layoutParams = lp
                setOnClickListener {
                    dialog?.dismiss()
                    showCounselorReplyDialog(c)
                }
            }
            actionsContainer.addView(btnReply)

            val btnScheduleMeeting = Button(this).apply {
                text = "📅 Jadwalkan Tatap Muka Ruang BK"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#4338CA"))
                    cornerRadius = 8f * density
                }
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)).apply {
                    bottomMargin = dp(8)
                }
                layoutParams = lp
                setOnClickListener {
                    dialog?.dismiss()
                    showScheduleMeetingDialog(c)
                }
            }
            actionsContainer.addView(btnScheduleMeeting)

            if (!isResolved) {
                val btnMarkResolved = Button(this).apply {
                    text = "✔ Tandai Kasus Selesai (Resolved)"
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.WHITE)
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#15803D"))
                        cornerRadius = 8f * density
                    }
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)).apply {
                        bottomMargin = dp(8)
                    }
                    layoutParams = lp
                    setOnClickListener {
                        dialog?.dismiss()
                        markConsultationResolved(c)
                    }
                }
                actionsContainer.addView(btnMarkResolved)
            }
        } else if (isParentMode) {
            val btnReplyParent = Button(this).apply {
                text = "💬 Balas / Tanya Lanjutan"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#0D9488"))
                    cornerRadius = 8f * density
                }
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42))
                layoutParams = lp
                setOnClickListener {
                    dialog?.dismiss()
                    showParentFollowUpDialog(c)
                }
            }
            actionsContainer.addView(btnReplyParent)
        } else {
            val btnReplyStudent = Button(this).apply {
                text = "💬 Balas / Tanggapi Guru BK"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#0D9488"))
                    cornerRadius = 8f * density
                }
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42))
                layoutParams = lp
                setOnClickListener {
                    dialog?.dismiss()
                    showStudentFollowUpDialog(c)
                }
            }
            actionsContainer.addView(btnReplyStudent)
        }

        root.addView(actionsContainer)

        dialog = AlertDialog.Builder(this)
            .setTitle("Detail Bimbingan & Konseling")
            .setView(scroll)
            .setPositiveButton("Tutup", null)
            .create()
        dialog.show()
    }

    private fun showEvidenceImageDialog(url: String) {
        val baseUrl = ApiClient.getBaseServerUrl(this).trimEnd('/')
        val fullUrl = if (url.startsWith("http")) url else "$baseUrl$url"
        AlertDialog.Builder(this)
            .setTitle("Bukti Digital / Screenshot")
            .setMessage("URL Bukti: $url\n\nKetuk tombol di bawah untuk membuka dan memeriksa lampiran bukti.")
            .setPositiveButton("🌐 Buka Bukti") { _, _ ->
                try {
                    val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(fullUrl))
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(this, "Gagal membuka link: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Tutup", null)
            .show()
    }

    private fun markConsultationResolved(c: ConsultationDto) {
        ApiClient.getClient(this).replyBkConsultation(
            c.id,
            ReplyBkRequest(
                replyMessage = c.replyMessage ?: "Penanganan konseling telah diselesaikan secara tuntas oleh Guru BK.",
                status = "RESOLVED"
            )
        ).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    Toast.makeText(this@BkActivity, "✅ Status konseling berhasil ditandai SELESAI!", Toast.LENGTH_SHORT).show()
                    loadConsultations()
                } else {
                    Toast.makeText(this@BkActivity, "Gagal memperbarui status", Toast.LENGTH_SHORT).show()
                }
            }
            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showScheduleMeetingDialog(c: ConsultationDto) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }

        val etDate = EditText(this).apply {
            val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
            setText(todayStr)
            hint = "Format: YYYY-MM-DD"
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 8f * density
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
        }
        val spSession = Spinner(this).apply {
            val sessions = arrayOf(
                "Jam Istirahat 1 (09:30 - 10:00 WIB)",
                "Jam Istirahat 2 (12:00 - 12:45 WIB)",
                "Sepulang Sekolah (14:30 - 15:30 WIB)",
                "Jam KBM Tertentu (Izin Guru Mapel)"
            )
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, sessions)
        }
        val etRoom = EditText(this).apply {
            setText("Ruang Bimbingan & Konseling (BK)")
            hint = "Lokasi Pertemuan"
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 8f * density
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
        }
        val etNotes = EditText(this).apply {
            hint = "Catatan / hal yang perlu dipersiapkan siswa..."
            setLines(2)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 8f * density
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
        }

        fun addLabel(text: String) {
            val tv = TextView(this).apply {
                this.text = text
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, dp(8), 0, dp(4))
            }
            root.addView(tv)
        }

        addLabel("📅 Tanggal Pertemuan:")
        root.addView(etDate)
        addLabel("⏰ Sesi Pertemuan:")
        root.addView(spSession)
        addLabel("📍 Ruang / Lokasi:")
        root.addView(etRoom)
        addLabel("📝 Catatan untuk Siswa:")
        root.addView(etNotes)

        AlertDialog.Builder(this)
            .setTitle("Jadwalkan Tatap Muka Ruang BK")
            .setView(root)
            .setPositiveButton("Simpan & Undang") { _, _ ->
                val dateStr = etDate.text.toString().trim()
                val sessionStr = spSession.selectedItem.toString()
                val roomStr = etRoom.text.toString().trim()
                val notesStr = etNotes.text.toString().trim()

                val formattedMsg = "📌 JADWAL PERTEMUAN TATAP MUKA RUANG BK\n• Hari/Tanggal: $dateStr\n• Waktu: $sessionStr\n• Tempat: $roomStr\n• Catatan: ${if (notesStr.isNotEmpty()) notesStr else "Harap hadir tepat waktu di Ruang BK."}"

                ApiClient.getClient(this).replyBkConsultation(
                    c.id,
                    ReplyBkRequest(
                        replyMessage = formattedMsg,
                        status = "SCHEDULED"
                    )
                ).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@BkActivity, "✅ Jadwal tatap muka berhasil dikirim ke siswa!", Toast.LENGTH_SHORT).show()
                            loadConsultations()
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal menyimpan jadwal", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    // ========================================================
    // MODUL STANDAR BAKU BK KEMENDIKBUD & CASE MANAGEMENT
    // ========================================================

    private fun pickStudentFromClass(
        promptTitle: String,
        onSelected: (studentId: String, studentName: String, className: String) -> Unit
    ) {
        if (allRecapStudents.isNotEmpty()) {
            val studentNames = allRecapStudents.map { "${it.name} (${it.className ?: "-"}) • NISN: ${it.nisn ?: "-"}" }
            AlertDialog.Builder(this)
                .setTitle(promptTitle)
                .setItems(studentNames.toTypedArray()) { _, which ->
                    val s = allRecapStudents[which]
                    onSelected(s.id, s.name, s.className ?: "-")
                }
                .setNegativeButton("Batal", null)
                .show()
        } else {
            Toast.makeText(this, "Memuat daftar siswa binaan...", Toast.LENGTH_SHORT).show()
            val targetCls = bkSelectedSubClass.ifEmpty { currentSelectedClass }
            ApiClient.getClient(this).getBkClassRecap(targetCls).enqueue(object : Callback<BkClassRecapResponse> {
                override fun onResponse(call: Call<BkClassRecapResponse>, response: Response<BkClassRecapResponse>) {
                    val students = response.body()?.students ?: emptyList()
                    if (students.isNotEmpty()) {
                        allRecapStudents = students
                        val studentNames = students.map { "${it.name} (${it.className ?: "-"}) • NISN: ${it.nisn ?: "-"}" }
                        AlertDialog.Builder(this@BkActivity)
                            .setTitle(promptTitle)
                            .setItems(studentNames.toTypedArray()) { _, which ->
                                val s = students[which]
                                onSelected(s.id, s.name, s.className ?: "-")
                            }
                            .setNegativeButton("Batal", null)
                            .show()
                    } else {
                        Toast.makeText(this@BkActivity, "Belum ada data siswa ditemukan.", Toast.LENGTH_SHORT).show()
                    }
                }
                override fun onFailure(call: Call<BkClassRecapResponse>, t: Throwable) {
                    Toast.makeText(this@BkActivity, "Gagal memuat siswa: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            })
        }
    }

    private fun showSdqHubDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }

        val tvDesc = TextView(this).apply {
            text = "Pusat Asesmen & Deteksi Dini Bimbingan Konseling SMPN 1 Boyolangu:\n• Skrining SDQ: Skrining perilaku & emosi (11–17 thn)\n• Sosiometri Digital: Peta relasi sosial & deteksi risiko bullying\n• AKPD: Analisis kebutuhan peserta didik 4 bidang layanan."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(14))
        }
        root.addView(tvDesc)

        var dialog: AlertDialog? = null

        val btnInput = Button(this).apply {
            text = "🧠 Input Skrining SDQ Siswa"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#4338CA"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                showInputSdqFormDialog()
            }
        }
        root.addView(btnInput)

        val btnRekap = Button(this).apply {
            text = "📊 Rekap Hasil Skrining SDQ Kelas"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#0284C7"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                showSdqClassRecapDialog()
            }
        }
        root.addView(btnRekap)

        val btnSosiometri = Button(this).apply {
            text = "🌐 Pemetaan Sosiometri Kelas (Dinamika Sosial)"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#0D9488"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                showSociometryHubDialog()
            }
        }
        root.addView(btnSosiometri)

        val btnAkpd = Button(this).apply {
            text = "📋 Profil Diagnostik AKPD & Sinkron E-RPL"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#D97706"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44))
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                showAkpdHubDialog()
            }
        }
        root.addView(btnAkpd)

        dialog = AlertDialog.Builder(this)
            .setTitle("🧠 Pusat Asesmen & Deteksi Dini BK")
            .setView(root)
            .setNegativeButton("Tutup", null)
            .create()
        dialog.show()
    }

    private fun showInputSdqFormDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        scroll.addView(root)

        var selectedStudentId = allRecapStudents.firstOrNull()?.id ?: ""
        var selectedStudentLabel = allRecapStudents.firstOrNull()?.let { "${it.name} (${it.className ?: "-"})" } ?: "Pilih Siswa Binaan..."

        val tvLabelId = TextView(this).apply {
            text = "Pilih Siswa untuk Skrining SDQ:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(tvLabelId)

        val btnPick = Button(this).apply {
            text = "👤 $selectedStudentLabel ▾"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F1F5F9"))
                cornerRadius = 8f * density
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
            setOnClickListener {
                pickStudentFromClass("Pilih Siswa untuk Skrining SDQ") { sid, sname, sclass ->
                    selectedStudentId = sid
                    selectedStudentLabel = "$sname ($sclass)"
                    text = "👤 $selectedStudentLabel ▾"
                }
            }
        }
        root.addView(btnPick)

        fun createScaleInput(label: String, defVal: String = "2"): EditText {
            val tv = TextView(this).apply {
                text = label
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, dp(6), 0, dp(4))
            }
            root.addView(tv)
            val et = EditText(this).apply {
                setText(defVal)
                hint = "Skor (0 - 10)"
                inputType = android.text.InputType.TYPE_CLASS_NUMBER
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F8FAFC"))
                    cornerRadius = 8f * density
                    setStroke(dp(1), Color.parseColor("#CBD5E1"))
                }
            }
            root.addView(et)
            return et
        }

        val etEmosi = createScaleInput("1. Gejala Emosional (Emotional Symptoms, 0-10):", "3")
        val etPerilaku = createScaleInput("2. Masalah Perilaku (Conduct Problems, 0-10):", "2")
        val etHiper = createScaleInput("3. Hiperaktivitas (Hyperactivity/Inattention, 0-10):", "2")
        val etSebaya = createScaleInput("4. Masalah Teman Sebaya (Peer Problems, 0-10):", "2")
        val etPrososial = createScaleInput("5. Perilaku Prososial (Prosocial Behavior, 0-10):", "8")

        val etNotes = EditText(this).apply {
            hint = "Catatan tindak lanjut Guru BK..."
            setLines(2)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 8f * density
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
        }
        val tvNotesLabel = TextView(this).apply {
            text = "Catatan Observasi Konselor:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(8), 0, dp(4))
        }
        root.addView(tvNotesLabel)
        root.addView(etNotes)

        AlertDialog.Builder(this)
            .setTitle("Evaluasi SDQ Siswa")
            .setView(scroll)
            .setPositiveButton("Simpan Skrining") { _, _ ->
                if (selectedStudentId.isEmpty()) {
                    Toast.makeText(this, "Harap pilih siswa terlebih dahulu", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val em = etEmosi.text.toString().toIntOrNull() ?: 0
                val pr = etPerilaku.text.toString().toIntOrNull() ?: 0
                val hp = etHiper.text.toString().toIntOrNull() ?: 0
                val sb = etSebaya.text.toString().toIntOrNull() ?: 0
                val ps = etPrososial.text.toString().toIntOrNull() ?: 0
                val notes = etNotes.text.toString().trim()

                val req = BkSdqRequest(
                    studentId = selectedStudentId,
                    scoreEmotional = em,
                    scoreConduct = pr,
                    scoreHyperactivity = hp,
                    scorePeer = sb,
                    scoreProsocial = ps,
                    recommendations = if (notes.isNotEmpty()) notes else null
                )

                ApiClient.getClient(this).submitBkSdq(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            val total = em + pr + hp + sb
                            val statusStr = if (total <= 15) "NORMAL" else if (total <= 19) "BORDERLINE" else "ABNORMAL"
                            Toast.makeText(this@BkActivity, "✅ Skrining SDQ tersimpan! Total Skor: $total ($statusStr)", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal menyimpan hasil SDQ", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showSdqClassRecapDialog() {
        val targetClass = bkSelectedSubClass.ifEmpty { currentSelectedClass ?: "VII-A" }
        Toast.makeText(this, "Memuat rekap SDQ kelas $targetClass...", Toast.LENGTH_SHORT).show()

        ApiClient.getClient(this).getBkSdqAssessments(className = targetClass).enqueue(object : Callback<BkSdqListResponse> {
            override fun onResponse(call: Call<BkSdqListResponse>, response: Response<BkSdqListResponse>) {
                val list = response.body()?.data ?: emptyList()
                val density = resources.displayMetrics.density
                fun dp(v: Int): Int = (v * density).toInt()

                val scroll = ScrollView(this@BkActivity)
                val root = LinearLayout(this@BkActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = dp(16)
                    setPadding(p, p, p, p)
                }
                scroll.addView(root)

                if (list.isEmpty()) {
                    val tvEmpty = TextView(this@BkActivity).apply {
                        text = "Belum ada data skrining SDQ yang tercatat untuk kelas $targetClass.\nSilakan gunakan menu 'Input Skrining SDQ Siswa' terlebih dahulu."
                        textSize = 12f
                        setTextColor(Color.parseColor("#94A3B8"))
                        setPadding(0, dp(10), 0, dp(10))
                        gravity = android.view.Gravity.CENTER
                    }
                    root.addView(tvEmpty)
                } else {
                    list.forEach { item ->
                        val card = LinearLayout(this@BkActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            background = android.graphics.drawable.GradientDrawable().apply {
                                setColor(Color.parseColor("#F8FAFC"))
                                cornerRadius = 8f * density
                                setStroke(dp(1), Color.parseColor("#E2E8F0"))
                            }
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(8)
                            }
                            layoutParams = lp
                        }

                        val (stBg, stColor) = when (item.interpretation.uppercase()) {
                            "ABNORMAL" -> Pair("#FEE2E2", "#DC2626")
                            "BORDERLINE" -> Pair("#FEF3C7", "#D97706")
                            else -> Pair("#DCFCE7", "#15803D")
                        }

                        val rowH = LinearLayout(this@BkActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                        }
                        val tvName = TextView(this@BkActivity).apply {
                            text = item.studentName
                            textSize = 12f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        rowH.addView(tvName)

                        val tvBadge = TextView(this@BkActivity).apply {
                            text = "${item.interpretation} (${item.totalDifficultiesScore}/40)"
                            textSize = 10f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor(stColor))
                            background = android.graphics.drawable.GradientDrawable().apply {
                                setColor(Color.parseColor(stBg))
                                cornerRadius = 4f * density
                            }
                            setPadding(dp(6), dp(2), dp(6), dp(2))
                        }
                        rowH.addView(tvBadge)
                        card.addView(rowH)

                        val tvDetail = TextView(this@BkActivity).apply {
                            text = "Emosional: ${item.scoreEmotional} • Perilaku: ${item.scoreConduct} • Hiperaktif: ${item.scoreHyperactivity} • Sebaya: ${item.scorePeer} • Prososial: ${item.scoreProsocial}"
                            textSize = 10.5f
                            setTextColor(Color.parseColor("#64748B"))
                            setPadding(0, dp(4), 0, 0)
                        }
                        card.addView(tvDetail)
                        root.addView(card)
                    }
                }

                AlertDialog.Builder(this@BkActivity)
                    .setTitle("📊 Hasil Skrining SDQ Kelas $targetClass")
                    .setView(scroll)
                    .setPositiveButton("Tutup", null)
                    .show()
            }
            override fun onFailure(call: Call<BkSdqListResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showSociometryHubDialog() {
        val targetClass = bkSelectedSubClass.ifEmpty { currentSelectedClass ?: "VII-A" }
        Toast.makeText(this, "Memuat analisis sosiometri kelas $targetClass...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getBkSociometry(targetClass).enqueue(object : Callback<BkSociometryResponse> {
            override fun onResponse(call: Call<BkSociometryResponse>, response: Response<BkSociometryResponse>) {
                val data = response.body()?.data
                val density = resources.displayMetrics.density
                fun dp(v: Int): Int = (v * density).toInt()

                val scroll = ScrollView(this@BkActivity)
                val root = LinearLayout(this@BkActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = dp(16)
                    setPadding(p, p, p, p)
                }
                scroll.addView(root)

                val tvSub = TextView(this@BkActivity).apply {
                    text = "Pemetaan relasi sosial siswa kelas $targetClass untuk deteksi dini isolasi sosial dan potensi klik (geng) berisiko bullying."
                    textSize = 12f
                    setTextColor(Color.parseColor("#475569"))
                    setPadding(0, 0, 0, dp(12))
                }
                root.addView(tvSub)

                fun addSection(title: String, icon: String, items: List<String>, bgHex: String, textHex: String) {
                    val card = LinearLayout(this@BkActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor(bgHex))
                            cornerRadius = 10f * density
                        }
                        setPadding(dp(12), dp(10), dp(12), dp(10))
                        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = dp(10)
                        }
                        layoutParams = lp
                    }
                    val tvH = TextView(this@BkActivity).apply {
                        text = "$icon $title (${items.size})"
                        textSize = 12.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor(textHex))
                    }
                    card.addView(tvH)

                    val bodyStr = if (items.isNotEmpty()) items.joinToString("\n• ", prefix = "• ") else "Belum ada catatan khusus pada indikator ini (relasi terpantau seimbang)."
                    val tvB = TextView(this@BkActivity).apply {
                        text = bodyStr
                        textSize = 11.5f
                        setTextColor(Color.parseColor("#0F172A"))
                        setPadding(0, dp(4), 0, 0)
                    }
                    card.addView(tvB)
                    root.addView(card)
                }

                val popular = data?.popularStudents ?: emptyList()
                val isolated = data?.isolatedStudents ?: emptyList()
                val cliques = data?.cliques ?: emptyList()

                addSection("Siswa Bintang / Populer (Star Students)", "⭐", popular, "#EFF6FF", "#1D4ED8")
                addSection("Siswa Terisolasi / Rentan Bullying", "⚠️", isolated, "#FEF2F2", "#B91C1C")
                addSection("Kelompok Pertemanan (Klik / Potensi Geng)", "👥", cliques, "#F0FDF4", "#15803D")

                AlertDialog.Builder(this@BkActivity)
                    .setTitle("🌐 Sosiometri Digital Kelas $targetClass")
                    .setView(scroll)
                    .setPositiveButton("Tutup", null)
                    .show()
            }
            override fun onFailure(call: Call<BkSociometryResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showAkpdHubDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }

        val tvDesc = TextView(this).apply {
            text = "Angket Kebutuhan Peserta Didik (AKPD) memetakan kebutuhan nyata siswa pada 4 bidang layanan bimbingan konseling di SMPN 1 Boyolangu."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(tvDesc)

        fun addDomainBar(label: String, icon: String, percent: Int, colorHex: String) {
            val tv = TextView(this).apply {
                text = "$icon $label: $percent% kebutuhan"
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, dp(4), 0, dp(2))
            }
            root.addView(tv)

            val pb = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 100
                progress = percent
                progressTintList = android.content.res.ColorStateList.valueOf(Color.parseColor(colorHex))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(8)).apply {
                    bottomMargin = dp(8)
                }
                layoutParams = lp
            }
            root.addView(pb)
        }

        addDomainBar("Bidang Belajar (Fokus & Prestasi)", "📚", 34, "#0284C7")
        addDomainBar("Bidang Pribadi (Manajemen Emosi & Mental)", "🧘", 28, "#0D9488")
        addDomainBar("Bidang Sosial (Pertemanan & Anti-Bullying)", "🤝", 22, "#D97706")
        addDomainBar("Bidang Karir (Minat, Bakat & Studi Lanjut)", "🎯", 16, "#7C3AED")

        val btnSyncRpl = Button(this).apply {
            text = "✨ Susun E-RPL Berdasarkan Hasil AKPD"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#0D9488"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)).apply {
                topMargin = dp(10)
            }
            layoutParams = lp
            setOnClickListener {
                showRplHubDialog()
            }
        }
        root.addView(btnSyncRpl)

        AlertDialog.Builder(this)
            .setTitle("📊 Profil Diagnostik AKPD Sekolah")
            .setView(root)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun showRplHubDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }

        val tvSub = TextView(this).apply {
            text = "Generator otomatis Rencana Pelaksanaan Layanan (RPL) BK standar resmi Kurikulum Merdeka + Cetak PDF A4."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(tvSub)

        var dialog: AlertDialog? = null

        val btnGenerate = Button(this).apply {
            text = "✨ Susun E-RPL Baru (Resmi)"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#16A34A"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                showCreateRplDialog()
            }
        }
        root.addView(btnGenerate)

        val btnList = Button(this).apply {
            text = "📑 Riwayat & Cetak Dokumen RPL A4"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#0284C7"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44))
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                showRplListDialog()
            }
        }
        root.addView(btnList)

        dialog = AlertDialog.Builder(this)
            .setTitle("📝 E-RPL BK Kurikulum Merdeka")
            .setView(root)
            .setNegativeButton("Tutup", null)
            .create()
        dialog.show()
    }

    private fun showCreateRplDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        scroll.addView(root)

        fun createInput(label: String, defVal: String, hintText: String): EditText {
            val tv = TextView(this).apply {
                text = label
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, dp(8), 0, dp(4))
            }
            root.addView(tv)
            val et = EditText(this).apply {
                setText(defVal)
                hint = hintText
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F8FAFC"))
                    cornerRadius = 8f * density
                    setStroke(dp(1), Color.parseColor("#CBD5E1"))
                }
            }
            root.addView(et)
            return et
        }

        val etTopic = createInput("Topik / Tema Layanan:", "Membangun Motivasi Belajar & Manajemen Waktu", "Contoh: Stop Perundungan, Gaya Belajar")
        val etClass = createInput("Sasaran Kelas / Rombel:", bkSelectedSubClass.ifEmpty { "Kelas VII" }, "Contoh: Kelas VII-A / Tingkat VIII")
        val etTime = createInput("Alokasi Waktu:", "1 x 40 Menit", "Contoh: 1 x 40 Menit")

        val tvTypeLabel = TextView(this).apply {
            text = "Jenis Layanan BK:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(8), 0, dp(4))
        }
        root.addView(tvTypeLabel)

        val spType = Spinner(this).apply {
            val types = arrayOf("KLASIKAL", "KELOMPOK", "INDIVIDUAL")
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, types)
        }
        root.addView(spType)

        val tvDomainLabel = TextView(this).apply {
            text = "Bidang Bimbingan:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(8), 0, dp(4))
        }
        root.addView(tvDomainLabel)

        val spDomain = Spinner(this).apply {
            val domains = arrayOf("BELAJAR", "PRIBADI", "SOSIAL", "KARIR")
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, domains)
        }
        root.addView(spDomain)

        AlertDialog.Builder(this)
            .setTitle("Susun E-RPL Kurikulum Merdeka")
            .setView(scroll)
            .setPositiveButton("Generate E-RPL") { _, _ ->
                val topic = etTopic.text.toString().trim()
                if (topic.isEmpty()) {
                    Toast.makeText(this, "Topik wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val req = BkRplGenerateRequest(
                    jenisLayanan = spType.selectedItem.toString(),
                    topik = topic,
                    bidangBimbingan = spDomain.selectedItem.toString(),
                    kelasTarget = etClass.text.toString().trim(),
                    alokasiWaktu = etTime.text.toString().trim(),
                    tujuanLayanan = "Meningkatkan pemahaman peserta didik mengenai $topic",
                    metodeDanTeknik = "Diskusi Interaktif, Refleksi Mandiri & Tanya Jawab",
                    mediaAlat = "Modul Ajar BK & Lembar Kerja Siswa"
                )

                Toast.makeText(this, "Menyusun E-RPL standar Kemendikbud...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).generateBkRpl(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@BkActivity, "✅ E-RPL '$topic' berhasil disusun!", Toast.LENGTH_LONG).show()
                            showRplListDialog()
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal generate RPL", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showRplListDialog() {
        Toast.makeText(this, "Memuat dokumen E-RPL...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getBkRplList().enqueue(object : Callback<BkRplListResponse> {
            override fun onResponse(call: Call<BkRplListResponse>, response: Response<BkRplListResponse>) {
                val list = response.body()?.data ?: emptyList()
                val density = resources.displayMetrics.density
                fun dp(v: Int): Int = (v * density).toInt()

                val scroll = ScrollView(this@BkActivity)
                val root = LinearLayout(this@BkActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = dp(16)
                    setPadding(p, p, p, p)
                }
                scroll.addView(root)

                if (list.isEmpty()) {
                    val tvEmpty = TextView(this@BkActivity).apply {
                        text = "Belum ada dokumen E-RPL yang disimpan.\nSilakan gunakan tombol 'Susun E-RPL Baru'."
                        textSize = 12f
                        setTextColor(Color.parseColor("#94A3B8"))
                        setPadding(0, dp(10), 0, dp(10))
                        gravity = android.view.Gravity.CENTER
                    }
                    root.addView(tvEmpty)
                } else {
                    val baseUrl = ApiClient.getBaseServerUrl(this@BkActivity).trimEnd('/')
                    val token = sessionManager.getToken() ?: ""
                    val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())

                    list.forEach { rpl ->
                        val card = LinearLayout(this@BkActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            background = android.graphics.drawable.GradientDrawable().apply {
                                setColor(Color.parseColor("#F8FAFC"))
                                cornerRadius = 8f * density
                                setStroke(dp(1), Color.parseColor("#CBD5E1"))
                            }
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(8)
                            }
                            layoutParams = lp
                        }

                        val tvT = TextView(this@BkActivity).apply {
                            text = "📝 ${rpl.topik}"
                            textSize = 12.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        }
                        card.addView(tvT)

                        val tvSub = TextView(this@BkActivity).apply {
                            text = "Layanan: ${rpl.jenisLayanan} • Sasaran: ${rpl.kelasTarget} • Waktu: ${rpl.alokasiWaktu}"
                            textSize = 11f
                            setTextColor(Color.parseColor("#64748B"))
                            setPadding(0, dp(2), 0, dp(6))
                        }
                        card.addView(tvSub)

                        val btnPrint = Button(this@BkActivity).apply {
                            text = "🖨️ Cetak / Simpan PDF A4 (Resmi)"
                            textSize = 11.5f
                            setTextColor(Color.WHITE)
                            background = android.graphics.drawable.GradientDrawable().apply {
                                setColor(Color.parseColor("#15803D"))
                                cornerRadius = 6f * density
                            }
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38))
                            layoutParams = lp
                            setOnClickListener {
                                val printUrl = "$baseUrl/api/bk/rpl/${rpl.id}/print?token=${android.net.Uri.encode(token)}"
                                com.school.smartcbt.utils.AttendancePdfHelper.printViaWebView(
                                    this@BkActivity,
                                    printUrl,
                                    rpl.kelasTarget,
                                    todayStr
                                )
                            }
                        }
                        card.addView(btnPrint)
                        root.addView(card)
                    }
                }

                AlertDialog.Builder(this@BkActivity)
                    .setTitle("📑 Dokumen E-RPL Resmi")
                    .setView(scroll)
                    .setPositiveButton("Tutup", null)
                    .show()
            }
            override fun onFailure(call: Call<BkRplListResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showBehaviorContractHubDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        scroll.addView(root)

        val tvDesc = TextView(this).apply {
            text = "Modul Kontrak Perilaku (Behavior Contract) adalah komitmen tertulis antara Siswa, Guru BK, dan Orang Tua untuk memperbaiki perilaku sebelum sanksi SP diterbitkan."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(tvDesc)

        var selectedStudentId = allRecapStudents.firstOrNull()?.id ?: ""
        var selectedStudentLabel = allRecapStudents.firstOrNull()?.let { "${it.name} (${it.className ?: "-"})" } ?: "Pilih Siswa Binaan..."

        val tvStudentLabel = TextView(this).apply {
            text = "Target Siswa Binaan:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(tvStudentLabel)

        val btnPick = Button(this).apply {
            text = "👤 $selectedStudentLabel ▾"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F1F5F9"))
                cornerRadius = 8f * density
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                pickStudentFromClass("Pilih Siswa untuk Kontrak Perilaku") { sid, sname, sclass ->
                    selectedStudentId = sid
                    selectedStudentLabel = "$sname ($sclass)"
                    text = "👤 $selectedStudentLabel ▾"
                }
            }
        }
        root.addView(btnPick)

        fun createInput(label: String, defVal: String, hintText: String): EditText {
            val tv = TextView(this).apply {
                text = label
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, dp(8), 0, dp(4))
            }
            root.addView(tv)
            val et = EditText(this).apply {
                setText(defVal)
                hint = hintText
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F8FAFC"))
                    cornerRadius = 8f * density
                    setStroke(dp(1), Color.parseColor("#CBD5E1"))
                }
            }
            root.addView(et)
            return et
        }

        val etTargetBehavior = createInput("Perilaku yang Harus Diubah:", "Terlambat masuk sekolah dan membolos jam pelajaran", "Contoh: Terlambat, gaduh di kelas")
        val etAgreedBehavior = createInput("Perilaku Positif yang Disepakati:", "Hadir di sekolah sebelum pukul 06.45 WIB setiap hari", "Contoh: Masuk tepat waktu, mencatat pelajaran")
        val etReward = createInput("Reward jika Berhasil:", "Pemberian Poin Reward +20 dan pembersihan catatan SP", "Contoh: Bebas SP, Poin Reward")
        val etConsequence = createInput("Konsekuensi jika Melanggar:", "Penerbitan Surat Peringatan (SP) dan pemanggilan orang tua resmi", "Contoh: Terbit SP 1")

        AlertDialog.Builder(this)
            .setTitle("📜 Buat Kontrak Perilaku Siswa")
            .setView(scroll)
            .setPositiveButton("Terbitkan Kontrak") { _, _ ->
                if (selectedStudentId.isEmpty()) {
                    Toast.makeText(this, "Harap pilih siswa terlebih dahulu", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val req = BkBehaviorContractRequest(
                    studentId = selectedStudentId,
                    targetBehaviors = listOf(etTargetBehavior.text.toString().trim()),
                    rewards = listOf(etReward.text.toString().trim()),
                    consequences = listOf(etConsequence.text.toString().trim()),
                    notes = etAgreedBehavior.text.toString().trim()
                )

                ApiClient.getClient(this).createBkBehaviorContract(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@BkActivity, "✅ Kontrak perilaku resmi berhasil diterbitkan!", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal membuat kontrak perilaku", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showDisciplineRewardHubDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        scroll.addView(root)

        val tvDesc = TextView(this).apply {
            text = "Mekanisme Positive Reinforcement (Poin Reward) memberikan poin prestasi atau perilaku terpuji yang mengurangi akumulasi poin pelanggaran siswa."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(tvDesc)

        var selectedStudentId = allRecapStudents.firstOrNull()?.id ?: ""
        var selectedStudentLabel = allRecapStudents.firstOrNull()?.let { "${it.name} (${it.className ?: "-"})" } ?: "Pilih Siswa Binaan..."

        val tvId = TextView(this).apply {
            text = "Target Siswa Penerima Reward:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(tvId)

        val btnPick = Button(this).apply {
            text = "👤 $selectedStudentLabel ▾"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F1F5F9"))
                cornerRadius = 8f * density
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                pickStudentFromClass("Pilih Siswa untuk Poin Reward") { sid, sname, sclass ->
                    selectedStudentId = sid
                    selectedStudentLabel = "$sname ($sclass)"
                    text = "👤 $selectedStudentLabel ▾"
                }
            }
        }
        root.addView(btnPick)

        val tvCat = TextView(this).apply {
            text = "Kategori Perilaku Terpuji:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(8), 0, dp(4))
        }
        root.addView(tvCat)

        val spCategory = Spinner(this).apply {
            val cats = arrayOf(
                "🏆 Prestasi Juara Lomba Akademik / Non-Akademik (-25 Poin)",
                "🤝 Kejujuran (Mengembalikan Barang Temuan) (-10 Poin)",
                "⏱️ Disiplin Kehadiran 1 Bulan Penuh (-10 Poin)",
                "🌟 Pemenuhan Kontrak Perilaku Positif (-20 Poin)",
                "🌿 Keaktifan Duta Lingkungan & OSIS (-15 Poin)"
            )
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, cats)
        }
        root.addView(spCategory)

        val etDesc = EditText(this).apply {
            hint = "Keterangan prestasi atau rincian bukti..."
            setLines(2)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 8f * density
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
        }
        val tvDescLabel = TextView(this).apply {
            text = "Keterangan / Catatan Penghargaan:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(8), 0, dp(4))
        }
        root.addView(tvDescLabel)
        root.addView(etDesc)

        AlertDialog.Builder(this)
            .setTitle("⭐ Berikan Poin Reward Siswa")
            .setView(scroll)
            .setPositiveButton("Simpan Reward") { _, _ ->
                if (selectedStudentId.isEmpty()) {
                    Toast.makeText(this, "Harap pilih siswa terlebih dahulu", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val selCat = spCategory.selectedItem.toString()
                val pts = when {
                    selCat.contains("-25") -> 25
                    selCat.contains("-20") -> 20
                    selCat.contains("-15") -> 15
                    else -> 10
                }
                val req = BkDisciplineRewardRequest(
                    studentId = selectedStudentId,
                    achievementTitle = selCat,
                    rewardPoints = pts,
                    notes = etDesc.text.toString().trim().ifEmpty { selCat }
                )

                ApiClient.getClient(this).issueBkDisciplineReward(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@BkActivity, "⭐ Poin reward $pts berhasil diberikan! Poin pelanggaran berkurang.", Toast.LENGTH_LONG).show()
                            loadBkClassRecap(currentSelectedClass)
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal memberikan reward", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showWhistleblowHubDialog() {
        val whistleList = allCounselorConsultations.filter {
            it.isAnonymous || it.category?.contains("BULLYING", ignoreCase = true) == true
        }

        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        scroll.addView(root)

        val tvSub = TextView(this).apply {
            text = "Kotak Rahaja (Whistleblowing Anti-Bullying) menampung laporan anonim siswa terkait perundungan fisik, verbal, maupun cyberbullying."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(tvSub)

        if (whistleList.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada laporan perundungan / bullying yang masuk ke Kotak Rahaja."
                textSize = 12f
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, dp(10), 0, dp(10))
                gravity = android.view.Gravity.CENTER
            }
            root.addView(tvEmpty)
        } else {
            whistleList.forEach { c ->
                val card = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#FFF1F2"))
                        cornerRadius = 8f * density
                        setStroke(dp(1), Color.parseColor("#FECDD3"))
                    }
                    setPadding(dp(12), dp(10), dp(12), dp(10))
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(8)
                    }
                    layoutParams = lp
                }

                val tvH = TextView(this).apply {
                    text = "🚨 ${c.subject}"
                    textSize = 12.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#991B1B"))
                }
                card.addView(tvH)

                val tvMsg = TextView(this).apply {
                    text = c.message
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#0F172A"))
                    setPadding(0, dp(4), 0, dp(6))
                }
                card.addView(tvMsg)

                val btnDetail = TextView(this).apply {
                    text = "👁️ Buka Detail Investigasi & Balas →"
                    textSize = 11f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#BE123C"))
                    setOnClickListener {
                        showConsultationDetailAndReplyDialog(c)
                    }
                }
                card.addView(btnDetail)
                root.addView(card)
            }
        }

        AlertDialog.Builder(this)
            .setTitle("🛡️ Kotak Rahaja (Anti-Bullying TPPK)")
            .setView(scroll)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun showMonthlyReportHubDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }

        val tvDesc = TextView(this).apply {
            text = "Laporan Bulanan & Semesteran Otomatis menyusun seluruh rekap konseling, kasus kedisiplinan, kontrak perilaku, dan reward dalam format resmi A4 lengkap dengan tanda tangan Kepala Sekolah & Guru BK."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(tvDesc)

        val cal = java.util.Calendar.getInstance()
        val curMonth = cal.get(java.util.Calendar.MONTH) + 1
        val curYear = cal.get(java.util.Calendar.YEAR)

        val baseUrl = ApiClient.getBaseServerUrl(this).trimEnd('/')
        val token = sessionManager.getToken() ?: ""
        val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())

        val btnPrintMonth = Button(this).apply {
            text = "🖨️ Cetak / Simpan Laporan Bulan Ini (A4 Resmi)"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#7C3AED"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                val printUrl = "$baseUrl/api/bk/reports/monthly/print?month=$curMonth&year=$curYear&token=${android.net.Uri.encode(token)}"
                com.school.smartcbt.utils.AttendancePdfHelper.printViaWebView(
                    this@BkActivity,
                    printUrl,
                    "Laporan Bulanan BK",
                    todayStr
                )
            }
        }
        root.addView(btnPrintMonth)

        AlertDialog.Builder(this)
            .setTitle("📑 Laporan Bulanan BK Standar Kemendikbud")
            .setView(root)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun showSecurityEthicsHubDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }

        val tvDesc = TextView(this).apply {
            text = "Modul Keamanan Data & Etika Konseling menjamin asas kerahasiaan BK dengan Informed Consent Digital, Watermark BAP, dan Audit Log pelacakan akses catatan sensitif."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(tvDesc)

        var dialog: AlertDialog? = null

        val btnAudit = Button(this).apply {
            text = "🛡️ Periksa Audit Log Keamanan Data"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#0F172A"))
                cornerRadius = 8f * density
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                dialog?.dismiss()
                showAuditLogsDialog()
            }
        }
        root.addView(btnAudit)

        dialog = AlertDialog.Builder(this)
            .setTitle("🔒 Keamanan & Etika Profesi BK")
            .setView(root)
            .setNegativeButton("Tutup", null)
            .create()
        dialog.show()
    }

    private fun showAuditLogsDialog() {
        Toast.makeText(this, "Memeriksa audit log keamanan...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getBkAuditLogs().enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                val density = resources.displayMetrics.density
                fun dp(v: Int): Int = (v * density).toInt()

                val scroll = ScrollView(this@BkActivity)
                val root = LinearLayout(this@BkActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = dp(16)
                    setPadding(p, p, p, p)
                }
                scroll.addView(root)

                val tvInfo = TextView(this@BkActivity).apply {
                    text = "Catatan Audit Log Aktif (Terpantau Real-Time):\n• Setiap akses profil, laporan konseling, dan cetak BAP dicatat dengan timestamp otentik.\n• Dokumen yang dicetak disematkan watermark identitas Guru BK pengunduh."
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#334155"))
                    setPadding(0, 0, 0, dp(10))
                }
                root.addView(tvInfo)

                AlertDialog.Builder(this@BkActivity)
                    .setTitle("🛡️ Audit Log Keamanan Data")
                    .setView(scroll)
                    .setPositiveButton("Tutup", null)
                    .show()
            }
            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showStudentFollowUpDialog(c: ConsultationDto) {
        val cleanSubject = c.subject.trim()
        val newSubject = if (cleanSubject.startsWith("Re: ")) cleanSubject else "Re: $cleanSubject"

        val input = EditText(this).apply {
            hint = "Tulis tanggapan atau pesan balasan Anda untuk Guru BK..."
            setLines(4)
            setPadding(30, 30, 30, 30)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 20, 40, 10)

            val tvTopic = TextView(this@BkActivity).apply {
                text = "📌 Topik: $newSubject"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
                setPadding(0, 0, 0, 8)
            }
            addView(tvTopic)

            if (!c.replyMessage.isNullOrEmpty()) {
                val tvPrevReply = TextView(this@BkActivity).apply {
                    text = "💡 Tanggapan Guru BK:\n\"${c.replyMessage}\""
                    textSize = 11f
                    setTextColor(Color.parseColor("#047857"))
                    setBackgroundColor(Color.parseColor("#ECFDF5"))
                    setPadding(20, 16, 20, 16)
                }
                addView(tvPrevReply)
            }

            val space = View(this@BkActivity).apply {
                layoutParams = LinearLayout.LayoutParams(1, (10 * resources.displayMetrics.density).toInt())
            }
            addView(space)
            addView(input)
        }

        AlertDialog.Builder(this)
            .setTitle("💬 Balas Tanggapan Guru BK")
            .setView(container)
            .setPositiveButton("Kirim Balasan") { _, _ ->
                val msg = input.text.toString().trim()
                if (msg.isNotEmpty()) {
                    val req = SendReportRequest(
                        category = c.category ?: "BIMBINGAN",
                        subject = newSubject,
                        message = msg,
                        isAnonymous = c.isAnonymous,
                        studentId = sessionManager.getUserId()
                    )
                    sendReportToServer(req, "✅ Pesan balasan berhasil dikirim ke Guru BK!")
                } else {
                    Toast.makeText(this@BkActivity, "Pesan tidak boleh kosong", Toast.LENGTH_SHORT).show()
                }
            }
            .setNeutralButton("Buka Form Lengkap") { _, _ ->
                switchBkTab(1)
                binding.etReportSubject.setText(newSubject)
                binding.scrollViewBk.post {
                    binding.scrollViewBk.fullScroll(View.FOCUS_DOWN)
                    binding.etReportMessage.requestFocus()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showParentFollowUpDialog(c: ConsultationDto) {
        val cleanSubject = c.subject.replace(Regex("^\\[KONSULTASI WALI MURID\\]\\s*"), "").trim()
        val newSubject = if (cleanSubject.startsWith("Re: ")) cleanSubject else "Re: $cleanSubject"

        val input = EditText(this).apply {
            hint = "Tulis pertanyaan lanjutan atau tanggapan Anda untuk Guru BK..."
            setLines(4)
            setPadding(30, 30, 30, 30)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 20, 40, 10)

            val tvTopic = TextView(this@BkActivity).apply {
                text = "📌 Topik: $newSubject"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
                setPadding(0, 0, 0, 8)
            }
            addView(tvTopic)

            if (!c.replyMessage.isNullOrEmpty()) {
                val tvPrevReply = TextView(this@BkActivity).apply {
                    text = "💡 Balasan Guru BK Sebelumnya:\n\"${c.replyMessage}\""
                    textSize = 11f
                    setTextColor(Color.parseColor("#047857"))
                    setBackgroundColor(Color.parseColor("#ECFDF5"))
                    setPadding(20, 16, 20, 16)
                }
                addView(tvPrevReply)
            }

            val space = View(this@BkActivity).apply {
                layoutParams = LinearLayout.LayoutParams(1, (10 * resources.displayMetrics.density).toInt())
            }
            addView(space)
            addView(input)
        }

        AlertDialog.Builder(this)
            .setTitle("💬 Balas Konsultasi Guru BK")
            .setView(container)
            .setPositiveButton("Kirim Pesan Lanjutan") { _, _ ->
                val msg = input.text.toString().trim()
                if (msg.isNotEmpty()) {
                    val req = SendReportRequest(
                        category = "WALI_MURID",
                        subject = "[KONSULTASI WALI MURID] $newSubject",
                        message = msg,
                        isAnonymous = false,
                        studentId = targetStudentId
                    )
                    sendReportToServer(req, "✅ Pesan lanjutan berhasil dikirim ke Guru BK!")
                } else {
                    Toast.makeText(this@BkActivity, "Pesan tidak boleh kosong", Toast.LENGTH_SHORT).show()
                }
            }
            .setNeutralButton("Buka Form Lengkap") { _, _ ->
                switchBkTab(1)
                binding.etReportSubject.setText(newSubject)
                binding.scrollViewBk.post {
                    binding.scrollViewBk.fullScroll(View.FOCUS_DOWN)
                    binding.etReportMessage.requestFocus()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showCounselorReplyDialog(c: ConsultationDto) {
        val input = EditText(this).apply {
            hint = "Tulis tanggapan, arahan, atau solusi Guru BK..."
            setText(c.replyMessage ?: "")
            setLines(4)
            setPadding(30, 30, 30, 30)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val cbResolved = CheckBox(this).apply {
            text = "✅ Tandai Penanganan Konseling Ini Sudah SELESAI (Resolved)"
            setTextColor(Color.parseColor("#15803D"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            isChecked = (c.status == "RESOLVED" || c.status == "COMPLETED" || c.status == "SELESAI")
            setPadding((8 * resources.displayMetrics.density).toInt(), 0, 0, 0)
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 20, 40, 10)
            addView(input)
            val spacer = View(this@BkActivity).apply {
                layoutParams = LinearLayout.LayoutParams(1, (10 * resources.displayMetrics.density).toInt())
            }
            addView(spacer)
            addView(cbResolved)
        }

        AlertDialog.Builder(this)
            .setTitle("Tanggapan Guru BK")
            .setMessage("Topik: ${c.subject}\nPengirim: ${if (c.isAnonymous) "Anonim (Whistleblower)" else c.student?.name ?: "Siswa"}")
            .setView(container)
            .setPositiveButton("Kirim Balasan") { _, _ ->
                val reply = input.text.toString().trim()
                if (reply.isNotEmpty()) {
                    val targetStatus = if (cbResolved.isChecked) "RESOLVED" else "REPLIED"
                    ApiClient.getClient(this).replyBkConsultation(
                        c.id,
                        ReplyBkRequest(replyMessage = reply, status = targetStatus)
                    ).enqueue(object : Callback<BasicResponse> {
                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                            if (response.isSuccessful) {
                                val statusMsg = if (cbResolved.isChecked) "✅ Tanggapan dikirim & status ditandai SELESAI!" else "✅ Tanggapan berhasil dikirim!"
                                Toast.makeText(this@BkActivity, statusMsg, Toast.LENGTH_SHORT).show()
                                loadConsultations()
                            } else {
                                Toast.makeText(this@BkActivity, "Gagal mengirim tanggapan", Toast.LENGTH_SHORT).show()
                            }
                        }

                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                            Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                        }
                    })
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private var studentCurrentPoints: Int = 0
    private var allCounselorConsultations: List<ConsultationDto> = emptyList()
    private var counselorFilterType: String = "STUDENT" // "STUDENT" or "PARENT"

    private fun setupStudentBkDashboard() {
        if (isParentMode) {
            setupParentBkDashboard()
            return
        }

        binding.layoutBkHomeDashboard.visibility = View.GONE
        binding.layoutBkStudentDashboard.visibility = View.VISIBLE
        binding.containerTabBkLeaves.visibility = View.GONE
        binding.containerTabBkRecap.visibility = View.GONE
        binding.containerTabBkPoints.visibility = View.GONE
        binding.containerTabBkReplies.visibility = View.VISIBLE
        binding.containerTabBkToday.visibility = View.GONE

        val studentName = sessionManager.getName().ifEmpty { sessionManager.getUsername() }
        val studentClass = sessionManager.getClassName().ifEmpty { "-" }
        val nisn = sessionManager.getNisn().ifEmpty { "-" }

        // Sub-menu 1: Konseling Pribadi & Curhat BK -> Buka Halaman Khusus Konseling & Curhat Anti-Bullying
        binding.cardStudentMenuCounseling.setOnClickListener {
            startActivity(Intent(this, KonselingCurhatActivity::class.java))
        }

        // Sub-menu 2: Janji Temu Tatap Muka di Ruang BK
        binding.cardStudentMenuAppointment.setOnClickListener {
            startActivity(Intent(this, KonselingCurhatActivity::class.java))
        }

        // Sub-menu 3: Pos Anti-Bullying / TPPK Anonim -> Buka Halaman Khusus Konseling & Curhat Anti-Bullying
        binding.cardStudentMenuBullying.setOnClickListener {
            startActivity(Intent(this, KonselingCurhatActivity::class.java))
        }

        // Sub-menu 4: Izin Keluar Sekolah & Gatepass Satpam
        binding.cardStudentMenuGatepass.setOnClickListener {
            val intent = Intent(this, ExitPassActivity::class.java)
            startActivity(intent)
        }

        // Sub-menu 5: Buku Poin & Rekap Prestasi
        binding.cardStudentMenuPoints.setOnClickListener {
            showStudentPointsDialog()
        }

        // Sub-menu 6: Jadwal Guru BK & Posko Piket (Menu D)
        binding.cardStudentMenuSchedule.setOnClickListener {
            showScheduleDialog()
        }
    }

    private fun setupParentBkDashboard() {
        binding.layoutBkHomeDashboard.visibility = View.GONE
        binding.layoutBkStudentDashboard.visibility = View.GONE
        binding.containerTabBkLeaves.visibility = View.GONE
        binding.containerTabBkRecap.visibility = View.GONE
        binding.containerTabBkPoints.visibility = View.GONE
        binding.containerTabBkReplies.visibility = View.VISIBLE
        binding.containerTabBkToday.visibility = View.GONE
        binding.containerTabBkReport.visibility = View.VISIBLE
        binding.cardReportForm.visibility = View.VISIBLE
    }

    private fun showAppointmentDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = AlertDialog.Builder(this).create()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(18))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(20).toFloat()
            }
        }

        // Header Title
        val tvTitle = TextView(this).apply {
            text = "🤝 Janji Temu Tatap Muka Ruang BK"
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#1E3A8A"))
        }
        val tvSub = TextView(this).apply {
            text = "Pilih sesi waktu dan sampaikan topik pertemuan tatap muka langsung bersama Guru BK di sekolah."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(2), 0, dp(12))
        }
        root.addView(tvTitle)
        root.addView(tvSub)

        // Pilihan Sesi Waktu
        val tvSessionLabel = TextView(this).apply {
            text = "🕒 Pilih Sesi Pertemuan Tatap Muka:"
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(tvSessionLabel)

        val spinnerSession = Spinner(this).apply {
            val sessions = arrayOf(
                "Istirahat Pertama (09.30 - 10.00 WIB)",
                "Istirahat Kedua (11.45 - 12.30 WIB)",
                "Jam Khusus BK / Jam Kosong Kelas",
                "Sepulang Sekolah (14.00 - 15.30 WIB)"
            )
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, sessions)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F1F5F9"))
                cornerRadius = dp(10).toFloat()
            }
            setPadding(dp(10), dp(10), dp(10), dp(10))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(46)).apply {
                bottomMargin = dp(10)
            }
        }
        root.addView(spinnerSession)

        // Topik Konsultasi
        val tvTopicLabel = TextView(this).apply {
            text = "📝 Topik / Keperluan Pertemuan:"
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(tvTopicLabel)

        val etTopic = EditText(this).apply {
            hint = "Contoh: Konsultasi kesulitan belajar / minat bakat"
            textSize = 12f
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), Color.parseColor("#E2E8F0"))
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        root.addView(etTopic)

        // Catatan Tambahan
        val tvNoteLabel = TextView(this).apply {
            text = "💬 Pesan / Catatan Tambahan (Opsional):"
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(tvNoteLabel)

        val etNotes = EditText(this).apply {
            hint = "Tuliskan hal penting yang ingin Anda sampaikan..."
            textSize = 12f
            gravity = android.view.Gravity.TOP or android.view.Gravity.START
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), Color.parseColor("#E2E8F0"))
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(70)).apply {
                bottomMargin = dp(14)
            }
        }
        root.addView(etNotes)

        // Tombol Aksi
        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }

        val btnCancel = Button(this).apply {
            text = "Batal"
            setTextColor(Color.parseColor("#64748B"))
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f).apply {
                marginEnd = dp(6)
            }
            setOnClickListener { dialog.dismiss() }
        }

        val btnSend = Button(this).apply {
            text = "Kirim Janji Temu"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#1E3A8A"))
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, dp(44), 1.5f).apply {
                marginStart = dp(6)
            }
            setOnClickListener {
                val topic = etTopic.text.toString().trim()
                if (topic.isEmpty()) {
                    Toast.makeText(this@BkActivity, "Silakan isi topik pertemuan tatap muka", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val chosenSession = spinnerSession.selectedItem.toString()
                val notes = etNotes.text.toString().trim()
                val fullMessage = "Permohonan Janji Temu Tatap Muka di Ruang BK:\n• Sesi: $chosenSession\n• Topik: $topic" +
                        if (notes.isNotEmpty()) "\n• Catatan: $notes" else ""

                val req = SendReportRequest(
                    category = "Bimbingan Tatap Muka",
                    subject = "[JANJI TEMU TATAP MUKA] $topic",
                    message = fullMessage,
                    isAnonymous = false,
                    studentId = if (isParentMode) targetStudentId else sessionManager.getUserId()
                )
                sendReportToServer(req, "🤝 Permohonan Janji Temu telah dikirim ke Guru BK!")
                dialog.dismiss()
            }
        }

        btnRow.addView(btnCancel)
        btnRow.addView(btnSend)
        root.addView(btnRow)

        dialog.setView(root)
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        dialog.show()
    }

    private fun showScheduleDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = AlertDialog.Builder(this).create()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(18))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(20).toFloat()
            }
        }

        val tvTitle = TextView(this).apply {
            text = "📅 Jadwal Guru BK & Posko Piket Konseling"
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
        }
        val tvSub = TextView(this).apply {
            text = "SMPN 1 Boyolangu • Layanan Konseling & Pendampingan Siswa Ramah Anak"
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(2), 0, dp(12))
        }
        root.addView(tvTitle)
        root.addView(tvSub)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(340))
        }
        val inner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        fun addScheduleCard(icon: String, title: String, content: String, bgHex: String, borderHex: String) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(10), dp(12), dp(10))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(bgHex))
                    cornerRadius = dp(12).toFloat()
                    setStroke(dp(1), Color.parseColor(borderHex))
                }
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(8)
                }
            }
            val tvH = TextView(this).apply {
                text = "$icon $title"
                textSize = 12.5f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#0F172A"))
            }
            val tvC = TextView(this).apply {
                text = content
                textSize = 11f
                setTextColor(Color.parseColor("#334155"))
                setLineSpacing(3f, 1.15f)
                setPadding(0, dp(3), 0, 0)
            }
            card.addView(tvH)
            card.addView(tvC)
            inner.addView(card)
        }

        addScheduleCard(
            "🏢",
            "Posko Utama Konseling BK",
            "• Lokasi: Gedung Utama Lt. 1 (Sebelah Ruang Kepala Sekolah)\n• Jam Kerja: Senin - Jumat (07.00 - 15.30 WIB)\n• Suasana: Nyaman, tenang, ber-AC & privasi kedap suara.",
            "#EFF6FF",
            "#BFDBFE"
        )

        addScheduleCard(
            "👩‍🏫",
            "Jadwal Piket Guru BK Hari Ini",
            "• Tingkat Kelas VII : Tim Guru BK Kelas VII (Posko A)\n• Tingkat Kelas VIII: Tim Guru BK Kelas VIII (Posko B)\n• Tingkat Kelas IX  : Tim Guru BK Kelas IX (Posko C)\n• Siap melayani konsultasi belajar, pribadi & sosial.",
            "#F0FDF4",
            "#BBF7D0"
        )

        addScheduleCard(
            "🛡️",
            "Pos Pengaduan & Layanan Darurat TPPK",
            "• Satuan Tugas Pencegahan & Penanganan Kekerasan (TPPK)\n• Penanganan darurat kasus perundungan (bullying) & krisis mental\n• Laporan anonim dapat langsung dikirim via Pos Anti-Bullying aplikasi.",
            "#FFF1F2",
            "#FECDD3"
        )

        addScheduleCard(
            "📋",
            "Ketentuan & Prosedur Konsultasi",
            "1. Siswa dapat datang langsung saat jam istirahat tanpa surat izin.\n2. Saat jam KBM berlangsung, siswa wajib meminta izin guru mapel.\n3. Setiap informasi yang disampaikan dijamin 100% kerahasiaannya.",
            "#FEFCE8",
            "#FEF08A"
        )

        scroll.addView(inner)
        root.addView(scroll)

        val btnClose = Button(this).apply {
            text = "Tutup"
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                topMargin = dp(10)
            }
            setOnClickListener { dialog.dismiss() }
        }
        root.addView(btnClose)

        dialog.setView(root)
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        dialog.show()
    }

    private fun showStudentPointsDialog() {
        val points = studentCurrentPoints
        val (statusText, statusColor) = when {
            points >= 100 -> Pair("🔴 Panggilan Ortu (SP-3)", "#EF4444")
            points >= 50 -> Pair("🟠 Peringatan 2 (SP-2)", "#F97316")
            points >= 25 -> Pair("🟡 Peringatan 1 (SP-1)", "#EAB308")
            else -> Pair("🟢 Sangat Baik (Bebas SP)", "#10B981")
        }

        val message = """
            👤 Nama: ${binding.tvStudentBkName.text}
            🏛️ Kelas: ${binding.tvStudentBkClassInfo.text}

            📊 Poin Pelanggaran: $points Poin
            🛡️ Status Disiplin: $statusText

            📌 Ketentuan Poin Sekolah:
            • 0 - 24 Poin : Status Aman & Bebas SP (Teladan)
            • 25 - 49 Poin : Surat Peringatan 1 (SP-1) & Pembinaan BK
            • 50 - 99 Poin : Surat Peringatan 2 (SP-2) & Pemanggilan Ortu
            • ≥ 100 Poin : Surat Peringatan 3 (SP-3) & Sidang Disiplin

            Siswa SMPN 1 Boyolangu senantiasa menjunjung tinggi kejujuran, disiplin, dan budi pekerti luhur!
        """.trimIndent()

        AlertDialog.Builder(this)
            .setTitle("⚖️ Buku Poin Kedisiplinan Siswa")
            .setMessage(message)
            .setPositiveButton("Siap Disiplin!", null)
            .show()
    }

    private fun loadStudentProfile() {
        ApiClient.getClient(this).getStudentProfile(targetStudentId).enqueue(object : Callback<StudentProfileResponse> {
            override fun onResponse(call: Call<StudentProfileResponse>, response: Response<StudentProfileResponse>) {
                val user = response.body()?.user ?: response.body()?.data
                if (user != null) {
                    val counselor = user.counselorTeacher
                    if (!counselor.isNullOrBlank()) {
                        binding.tvBkCounselorName.text = "$counselor (Guru BK Pendamping)"
                        binding.tvStudentBkCounselor.text = "👩‍🏫 Guru BK Pendamping: $counselor"
                    } else {
                        val cls = user.className ?: sessionManager.getClassName()
                        binding.tvBkCounselorName.text = "Guru BK Kelas $cls"
                        binding.tvStudentBkCounselor.text = "👩‍🏫 Guru BK Pendamping: Guru BK Kelas $cls"
                    }
                    val points = user.points ?: 0
                    studentCurrentPoints = points
                    binding.tvBkTotalPoints.text = "$points Poin Pelanggaran"

                    val studentName = user.name ?: sessionManager.getName().ifEmpty { sessionManager.getUsername() }
                    binding.tvStudentBkName.text = studentName
                    binding.tvStudentBkGreeting.text = "Halo, $studentName 👋"
                    val cls = user.className ?: sessionManager.getClassName()
                    val nisn = user.nisn ?: sessionManager.getNisn().ifEmpty { "-" }
                    binding.tvStudentBkClassInfo.text = "Kelas $cls • NISN: $nisn"

                    when {
                        points >= 100 -> {
                            binding.tvBkSpBadge.text = "🔴 Panggilan Ortu (SP-3)"
                            binding.tvBkSpBadge.setTextColor(Color.parseColor("#991B1B"))
                            binding.tvBkSpBadge.setBackgroundColor(Color.parseColor("#FEE2E2"))
                            binding.tvStudentBkStatusBadge.text = "🔴 SP-3 (100+ Poin)"
                            binding.tvStudentBkStatusBadge.setBackgroundColor(Color.parseColor("#EF4444"))
                        }
                        points >= 50 -> {
                            binding.tvBkSpBadge.text = "🟠 Peringatan 2 (SP-2)"
                            binding.tvBkSpBadge.setTextColor(Color.parseColor("#9A3412"))
                            binding.tvBkSpBadge.setBackgroundColor(Color.parseColor("#FFEDD5"))
                            binding.tvStudentBkStatusBadge.text = "🟠 SP-2 (50+ Poin)"
                            binding.tvStudentBkStatusBadge.setBackgroundColor(Color.parseColor("#F97316"))
                        }
                        points >= 25 -> {
                            binding.tvBkSpBadge.text = "🟡 Peringatan 1 (SP-1)"
                            binding.tvBkSpBadge.setTextColor(Color.parseColor("#92400E"))
                            binding.tvBkSpBadge.setBackgroundColor(Color.parseColor("#FEF3C7"))
                            binding.tvStudentBkStatusBadge.text = "🟡 SP-1 (25+ Poin)"
                            binding.tvStudentBkStatusBadge.setBackgroundColor(Color.parseColor("#EAB308"))
                        }
                        else -> {
                            binding.tvBkSpBadge.text = "🟢 Sangat Baik (Bebas SP)"
                            binding.tvBkSpBadge.setTextColor(Color.parseColor("#065F46"))
                            binding.tvBkSpBadge.setBackgroundColor(Color.parseColor("#D1FAE5"))
                            binding.tvStudentBkStatusBadge.text = "🟢 Bebas SP"
                            binding.tvStudentBkStatusBadge.setBackgroundColor(Color.parseColor("#10B981"))
                        }
                    }
                }
            }

            override fun onFailure(call: Call<StudentProfileResponse>, t: Throwable) {
                // Ignore profile fetch failure
            }
        })
    }

    private fun loadBkDisciplineAndSpData() {
        val container = binding.llBkDisciplineDynamicContainer
        container.removeAllViews()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat data Poin Kedisiplinan & Early Warning SP dari server..."
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            setPadding(dp(8), dp(12), dp(8), dp(12))
        }
        container.addView(tvLoading)

        if (isCounselorMode) {
            ApiClient.getClient(this).getBkDisciplineEarlyWarning(currentSelectedClass).enqueue(object : Callback<BkEarlyWarningResponse> {
                override fun onResponse(call: Call<BkEarlyWarningResponse>, response: Response<BkEarlyWarningResponse>) {
                    container.removeAllViews()
                    val body = response.body()
                    val students = body?.students ?: emptyList()

                    // Action Bar for Guru BK
                    val actionCard = LinearLayout(this@BkActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(14), dp(14), dp(14), dp(14))
                        background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.WHITE)
                            cornerRadius = dp(14).toFloat()
                            setStroke(dp(1), Color.parseColor("#FECACA"))
                        }
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT
                        ).apply { bottomMargin = dp(12) }
                    }

                    val tvHeader = TextView(this@BkActivity).apply {
                        text = "🚨 RADAR EARLY WARNING SP & BUKU POIN BK"
                        setTextColor(Color.parseColor("#991B1B"))
                        textSize = 13f
                        setTypeface(null, Typeface.BOLD)
                    }
                    val tvSub = TextView(this@BkActivity).apply {
                        text = "Ambang Batas Resmi: SP 1 (25 Poin) • SP 2 (50 Poin) • SP 3 / Panggilan Ortu (100 Poin)"
                        setTextColor(Color.parseColor("#64748B"))
                        textSize = 11f
                        setPadding(0, dp(2), 0, dp(10))
                    }
                    actionCard.addView(tvHeader)
                    actionCard.addView(tvSub)

                    val sawInfoBox = LinearLayout(this@BkActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(10), dp(8), dp(10), dp(8))
                        background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor("#F8FAFC"))
                            cornerRadius = dp(8).toFloat()
                            setStroke(dp(1), Color.parseColor("#E2E8F0"))
                        }
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT
                        ).apply { bottomMargin = dp(10) }
                    }

                    val tvSawFormula = TextView(this@BkActivity).apply {
                        text = "⚖️ METODE SAW (Simple Additive Weighting):\n• Kriteria: Tata Tertib (25%) • Disiplin (25%) • Etika (20%) • Akademik (15%) • Estetika (15%)\n• Kategori: Ringan (5 Poin) | Sedang (20 Poin) | Berat (50 Poin)\n• Normalisasi: Nij = Xij / Max(Xij) • Skor Vi = Σ(Wj × Nij)"
                        setTextColor(Color.parseColor("#334155"))
                        textSize = 10f
                    }
                    sawInfoBox.addView(tvSawFormula)
                    actionCard.addView(sawInfoBox)

                    val btnQuickInput = Button(this@BkActivity).apply {
                        text = "➕ Catat Pelanggaran / Prestasi Siswa"
                        setTextColor(Color.WHITE)
                        textSize = 12f
                        setBackgroundColor(Color.parseColor("#DC2626"))
                        setOnClickListener {
                            showQuickSelectStudentDisciplineDialog()
                        }
                    }
                    actionCard.addView(btnQuickInput)
                    container.addView(actionCard)

                    if (students.isEmpty()) {
                        val tvSafe = TextView(this@BkActivity).apply {
                            text = "🟢 Seluruh siswa saat ini berada dalam kategori AMAN (< 15 Poin Pelanggaran)."
                            setTextColor(Color.parseColor("#065F46"))
                            textSize = 12f
                            setPadding(dp(14), dp(14), dp(14), dp(14))
                            background = android.graphics.drawable.GradientDrawable().apply {
                                setColor(Color.parseColor("#ECFDF5"))
                                cornerRadius = dp(12).toFloat()
                            }
                        }
                        container.addView(tvSafe)
                    } else {
                        students.forEach { st ->
                            try {
                                val stCard = LinearLayout(this@BkActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    setPadding(dp(14), dp(12), dp(14), dp(12))
                                    background = android.graphics.drawable.GradientDrawable().apply {
                                        setColor(Color.WHITE)
                                        cornerRadius = dp(12).toFloat()
                                        setStroke(dp(1), Color.parseColor("#E2E8F0"))
                                    }
                                    layoutParams = LinearLayout.LayoutParams(
                                        LinearLayout.LayoutParams.MATCH_PARENT,
                                        LinearLayout.LayoutParams.WRAP_CONTENT
                                    ).apply { bottomMargin = dp(8) }
                                }

                                val recLevel = st.recommendedLevel ?: "AMAN"
                                val activeSpVal = st.activeSp ?: "AMAN"

                                val tvStTitle = TextView(this@BkActivity).apply {
                                    text = "👤 ${st.name} (${st.className ?: "-"}) • ${st.points} Poin [$recLevel]"
                                    setTextColor(Color.parseColor("#0F172A"))
                                    textSize = 13f
                                    setTypeface(null, Typeface.BOLD)
                                }
                                val tvStSub = TextView(this@BkActivity).apply {
                                    val spIssued = if (activeSpVal.isEmpty() || activeSpVal == "AMAN") "Belum Terbit SP" else "SP Terbit: $activeSpVal"
                                    text = "NISN: ${st.nisn ?: "-"} • $spIssued • Pelanggaran: ${st.recentRecords?.size ?: 0}x"
                                    setTextColor(Color.parseColor("#64748B"))
                                    textSize = 11f
                                    setPadding(0, dp(2), 0, dp(8))
                                }
                                stCard.addView(tvStTitle)
                                stCard.addView(tvStSub)

                                val btnRow = LinearLayout(this@BkActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                }
                                val btnAddPoint = Button(this@BkActivity).apply {
                                    text = "⚖️ +Poin"
                                    textSize = 11f
                                    setTextColor(Color.parseColor("#1E40AF"))
                                    setBackgroundColor(Color.parseColor("#EFF6FF"))
                                    layoutParams = LinearLayout.LayoutParams(0, dp(36), 1f).apply { marginEnd = dp(4) }
                                    setOnClickListener {
                                        showCreateDisciplineDialog(st.id, st.name, st.className ?: "-")
                                    }
                                }
                                val btnIssueSp = Button(this@BkActivity).apply {
                                    val targetSp = if (recLevel.startsWith("SP")) recLevel else "SP1"
                                    text = "📄 Terbitkan $targetSp"
                                    textSize = 11f
                                    setTextColor(Color.WHITE)
                                    setBackgroundColor(Color.parseColor("#DC2626"))
                                    layoutParams = LinearLayout.LayoutParams(0, dp(36), 1f).apply { marginStart = dp(4) }
                                    setOnClickListener {
                                        showIssueSpDialog(st.id, st.name, st.className ?: "-", targetSp, st.points)
                                    }
                                }
                                btnRow.addView(btnAddPoint)
                                btnRow.addView(btnIssueSp)
                                stCard.addView(btnRow)
                                container.addView(stCard)
                            } catch (e: Exception) {
                                android.util.Log.e("BkActivity", "Error displaying student discipline card: ${e.message}", e)
                            }
                        }
                    }
                }

                override fun onFailure(call: Call<BkEarlyWarningResponse>, t: Throwable) {
                    container.removeAllViews()
                }
            })
        } else {
            // Student / Parent Mode: Fetch student's discipline records & warning letters
            ApiClient.getClient(this).getBkDisciplineRecords(studentId = targetStudentId).enqueue(object : Callback<BkDisciplineListResponse> {
                override fun onResponse(call: Call<BkDisciplineListResponse>, response: Response<BkDisciplineListResponse>) {
                    container.removeAllViews()
                    val body = response.body()
                    val summary = body?.studentSummary
                    val records = body?.records ?: emptyList()
                    val warnings = summary?.warningLetters ?: emptyList()

                    if (summary != null) {
                        val pts = summary.totalViolationPoints
                        binding.tvBkTotalPoints.text = "$pts Poin Pelanggaran"
                    }

                    // Threshold Info Card
                    val infoCard = LinearLayout(this@BkActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(14), dp(12), dp(14), dp(12))
                        background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor("#F8FAFC"))
                            cornerRadius = dp(12).toFloat()
                            setStroke(dp(1), Color.parseColor("#CBD5E1"))
                        }
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT
                        ).apply { bottomMargin = dp(10) }
                    }
                    val tvRule = TextView(this@BkActivity).apply {
                        text = "📊 Standar Early Warning SP SMPN 1 Boyolangu:\n• 0 - 24 Poin: 🟢 Aman (Tertib)\n• 25 - 49 Poin: 🟡 Surat Peringatan 1 (SP1)\n• 50 - 99 Poin: 🟠 Surat Peringatan 2 (SP2)\n• ≥ 100 Poin: 🔴 Surat Peringatan 3 (SP3 & Panggilan Orang Tua)"
                        setTextColor(Color.parseColor("#334155"))
                        textSize = 11f
                    }
                    infoCard.addView(tvRule)
                    container.addView(infoCard)

                    if (warnings.isNotEmpty()) {
                        warnings.forEach { sp ->
                            val spCard = LinearLayout(this@BkActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(dp(14), dp(12), dp(14), dp(12))
                                background = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(Color.parseColor("#FEF2F2"))
                                    cornerRadius = dp(12).toFloat()
                                    setStroke(dp(1), Color.parseColor("#FCA5A5"))
                                }
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply { bottomMargin = dp(8) }
                            }
                            val tvSpHead = TextView(this@BkActivity).apply {
                                text = "🚨 SURAT PERINGATAN RESMI (${sp.spLevel}) — No: ${sp.letterNumber ?: "-"}"
                                setTextColor(Color.parseColor("#991B1B"))
                                textSize = 12f
                                setTypeface(null, Typeface.BOLD)
                            }
                            val tvSpBody = TextView(this@BkActivity).apply {
                                text = "Tanggal: ${sp.issuedAt?.take(10) ?: "-"} • Poin Saat Terbit: ${sp.totalPointsSnapshot} Poin\nAlasan: ${sp.reasonSummary}"
                                setTextColor(Color.parseColor("#7F1D1D"))
                                textSize = 11f
                                setPadding(0, dp(4), 0, 0)
                            }
                            spCard.addView(tvSpHead)
                            spCard.addView(tvSpBody)

                            if (sp.acknowledgedByParent == true) {
                                val tvAck = TextView(this@BkActivity).apply {
                                    text = "✅ Sudah Dikonfirmasi & Ditandatangani Orang Tua (${sp.acknowledgedAt?.take(10) ?: "Terkonfirmasi"})"
                                    setTextColor(Color.parseColor("#15803D"))
                                    textSize = 10.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setPadding(0, dp(4), 0, 0)
                                }
                                spCard.addView(tvAck)
                            } else if (isParentMode) {
                                val btnAck = Button(this@BkActivity).apply {
                                    text = "✍️ Tanda Tangani Tanda Terima Digital SP"
                                    textSize = 11f
                                    setTextColor(Color.WHITE)
                                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#DC2626"))
                                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)).apply {
                                        topMargin = dp(8)
                                    }
                                    layoutParams = lp
                                    setOnClickListener {
                                        showAcknowledgeSpDialog(sp)
                                    }
                                }
                                spCard.addView(btnAck)
                            }

                            container.addView(spCard)
                        }
                    }

                    if (records.isEmpty()) {
                        val tvClean = TextView(this@BkActivity).apply {
                            text = "✅ Belum ada catatan pelanggaran tata tertib. Pertahankan kedisiplinan Anda!"
                            setTextColor(Color.parseColor("#065F46"))
                            textSize = 12f
                            setPadding(dp(14), dp(14), dp(14), dp(14))
                            background = android.graphics.drawable.GradientDrawable().apply {
                                setColor(Color.parseColor("#ECFDF5"))
                                cornerRadius = dp(12).toFloat()
                            }
                        }
                        container.addView(tvClean)
                    } else {
                        records.forEach { rec ->
                            val rCard = LinearLayout(this@BkActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(dp(12), dp(10), dp(12), dp(10))
                                background = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(Color.WHITE)
                                    cornerRadius = dp(10).toFloat()
                                    setStroke(dp(1), Color.parseColor("#E2E8F0"))
                                }
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply { bottomMargin = dp(8) }
                            }
                            val tvRecTitle = TextView(this@BkActivity).apply {
                                text = "⚠️ +${rec.points} Poin • ${rec.category} (${rec.createdAt?.take(10) ?: "-"})"
                                setTextColor(Color.parseColor("#DC2626"))
                                textSize = 12f
                                setTypeface(null, Typeface.BOLD)
                            }
                            val tvRecDesc = TextView(this@BkActivity).apply {
                                text = rec.description
                                setTextColor(Color.parseColor("#334155"))
                                textSize = 11.5f
                                setPadding(0, dp(2), 0, 0)
                            }
                            rCard.addView(tvRecTitle)
                            rCard.addView(tvRecDesc)
                            container.addView(rCard)
                        }
                    }
                }

                override fun onFailure(call: Call<BkDisciplineListResponse>, t: Throwable) {
                    container.removeAllViews()
                }
            })
        }
    }

    private fun showQuickSelectStudentDisciplineDialog() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 24, 40, 12)
        }
        val etStudentId = EditText(this).apply {
            hint = "ID atau NISN Siswa"
        }
        val etStudentName = EditText(this).apply {
            hint = "Nama Siswa (Opsional)"
        }
        layout.addView(etStudentId)
        layout.addView(etStudentName)

        AlertDialog.Builder(this)
            .setTitle("⚖️ Pilih Siswa untuk Catat Poin")
            .setMessage("Tips: Anda juga dapat menekan tombol '+Poin' langsung pada daftar siswa di tab Rekap Kelas BK atau Radar Early Warning.")
            .setView(layout)
            .setPositiveButton("Lanjut") { _, _ ->
                val sid = etStudentId.text.toString().trim()
                val sname = etStudentName.text.toString().trim().ifEmpty { sid }
                if (sid.isNotEmpty()) {
                    showCreateDisciplineDialog(sid, sname, currentSelectedClass ?: "-")
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showIssueSpDialog(studentId: String, studentName: String, className: String, defaultLevel: String, currentPoints: Int) {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 24, 40, 12)
        }
        val levels = arrayOf("SP1 (Surat Peringatan 1 - >= 25 Poin)", "SP2 (Surat Peringatan 2 - >= 50 Poin)", "SP3 (Panggilan Orang Tua - >= 100 Poin)")
        val spLevel = Spinner(this).apply {
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, levels)
            setSelection(when (defaultLevel) { "SP3" -> 2; "SP2" -> 1; else -> 0 })
        }
        val etReason = EditText(this).apply {
            hint = "Alasan penerbitan SP & tindak lanjut pembinaan..."
            setText("Akumulasi poin pelanggaran tata tertib mencapai $currentPoints poin.")
            setLines(3)
        }
        container.addView(spLevel)
        container.addView(etReason)

        AlertDialog.Builder(this)
            .setTitle("📄 Terbitkan SP: $studentName ($className)")
            .setView(container)
            .setPositiveButton("Terbitkan & Kirim Notif Ortu") { _, _ ->
                val chosenLevel = spLevel.selectedItem.toString().substringBefore(" ")
                val reason = etReason.text.toString().trim()
                ApiClient.getClient(this).issueBkWarningLetter(
                    IssueWarningLetterRequest(
                        userId = studentId,
                        spLevel = chosenLevel,
                        reasonSummary = reason
                    )
                ).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@BkActivity, "✅ Surat Peringatan $chosenLevel berhasil diterbitkan & dikirim ke Orang Tua!", Toast.LENGTH_LONG).show()
                            loadBkDisciplineAndSpData()
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal menerbitkan SP", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@BkActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showAcknowledgeSpDialog(sp: com.school.smartcbt.data.model.BkWarningLetterDto) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(16))
        }

        val tvInfo = TextView(this).apply {
            text = "Dengan mengonfirmasi secara digital, saya selaku Orang Tua / Wali Siswa menyatakan telah membaca dan menerima Surat Peringatan ${sp.spLevel} (No: ${sp.letterNumber ?: "-"})."
            textSize = 12.5f
            setTextColor(Color.parseColor("#334155"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
        }
        root.addView(tvInfo)

        val etNote = EditText(this).apply {
            hint = "Catatan Orang Tua / Tanggapan Pembinaan (Opsional)"
            textSize = 13f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
        }
        root.addView(etNote)

        AlertDialog.Builder(this)
            .setTitle("✍️ Tanda Terima Digital SP")
            .setView(root)
            .setPositiveButton("Konfirmasi & Tandatangani") { _, _ ->
                val note = etNote.text.toString().trim()
                val progress = android.app.ProgressDialog(this).apply {
                    setMessage("Mengirim konfirmasi tanda terima ke Guru BK...")
                    show()
                }

                ApiClient.getClient(this).acknowledgeWarningLetter(mapOf("letterId" to sp.id, "parentNote" to note)).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
                    override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, response: Response<com.school.smartcbt.data.model.BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            Toast.makeText(this@BkActivity, "✅ Tanda terima digital berhasil dikonfirmasi!", Toast.LENGTH_SHORT).show()
                            loadBkDisciplineAndSpData()
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal mengonfirmasi SP", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@BkActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun setupCounselorFeatures() {
        binding.btnRefreshBkRecap.setOnClickListener {
            loadBkClassRecap(bkSelectedSubClass.ifEmpty { currentSelectedClass })
        }

        binding.spinnerBkClassFilter.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (allowedBkClasses.isNotEmpty() && position < allowedBkClasses.size) {
                    val sel = allowedBkClasses[position]
                    val cls = if (sel.startsWith("Semua")) null else sel
                    if (cls != null && cls != bkSelectedSubClass) {
                        bkSelectedSubClass = cls
                        currentSelectedClass = cls
                        renderBkTingkatAndSubClassChips()
                        loadBkClassRecap(cls)
                    }
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        binding.btnRefreshBkLeaves.setOnClickListener {
            loadPendingStudentLeaves()
        }


        binding.btnOpenBkManualForm.setOnClickListener {
            showBkManualAttendanceDialog()
        }

        binding.btnRefreshBk360.setOnClickListener {
            loadBk360AttendanceRecap()
        }
    }

    private fun loadBkClassRecap(className: String?) {
        ApiClient.getClient(this).getBkClassRecap(className).enqueue(object : Callback<BkClassRecapResponse> {
            override fun onResponse(call: Call<BkClassRecapResponse>, response: Response<BkClassRecapResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    val classes = data.allowedClasses ?: emptyList()
                    if (allowedBkClasses.isEmpty() && classes.isNotEmpty()) {
                        allowedBkClasses = listOf("Semua Kelas Ampuan") + classes
                        val adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, allowedBkClasses)
                        binding.spinnerBkClassFilter.adapter = adapter
                    }

                    val tingkats = data.tingkats ?: emptyList()
                    val groups = data.tingkatGroups ?: emptyMap()
                    if (tingkats.isNotEmpty()) {
                        bkTingkats = tingkats
                        bkTingkatGroups = groups
                        if (bkSelectedTingkat.isEmpty() || !bkTingkats.contains(bkSelectedTingkat)) {
                            bkSelectedTingkat = bkTingkats.first()
                        }
                    }

                    val targetCls = data.selectedClass ?: className ?: "Semua"
                    if (targetCls != "Semua" && targetCls != "ALL") {
                        bkSelectedSubClass = targetCls
                    }

                    renderBkTingkatAndSubClassChips()

                    val students = data.students ?: emptyList()
                    allRecapStudents = students
                    renderBkRecap(students, targetCls)
                } else {
                    Toast.makeText(this@BkActivity, "Gagal memuat rekap kelas BK", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BkClassRecapResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderBkTingkatAndSubClassChips() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        // 1. Render Tingkat Chips (Kelas VII, Kelas VIII, Kelas IX)
        val llTingkat = binding.llBkTingkatChips
        llTingkat.removeAllViews()

        if (bkTingkats.isEmpty() && allowedBkClasses.isNotEmpty()) {
            val autoGroups = mutableMapOf<String, MutableList<String>>()
            allowedBkClasses.filterNot { it.startsWith("Semua") }.forEach { c ->
                val m = Regex("^(VII|VIII|IX|X|XI|XII|7|8|9)", RegexOption.IGNORE_CASE).find(c)
                val t = if (m != null) {
                    val raw = m.value.uppercase()
                    if (raw.startsWith("7")) "Kelas VII" else if (raw.startsWith("8")) "Kelas VIII" else if (raw.startsWith("9")) "Kelas IX" else "Kelas $raw"
                } else "Kelas Lainnya"
                autoGroups.getOrPut(t) { mutableListOf() }.add(c)
            }
            bkTingkatGroups = autoGroups
            bkTingkats = autoGroups.keys.toList()
            if (bkSelectedTingkat.isEmpty() && bkTingkats.isNotEmpty()) {
                bkSelectedTingkat = bkTingkats.first()
            }
        }

        bkTingkats.forEach { tingkat ->
            val isSelected = (tingkat == bkSelectedTingkat)
            val btn = TextView(this).apply {
                text = tingkat
                textSize = 12f
                setTypeface(null, if (isSelected) Typeface.BOLD else Typeface.NORMAL)
                val padH = dp(14)
                val padV = dp(6)
                setPadding(padH, padV, padH, padV)
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 18f * density
                    if (isSelected) {
                        setColor(Color.parseColor("#059669"))
                    } else {
                        setColor(Color.parseColor("#F1F5F9"))
                        setStroke(dp(1), Color.parseColor("#E2E8F0"))
                    }
                }
                background = gd
                setTextColor(if (isSelected) Color.WHITE else Color.parseColor("#334155"))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = dp(8)
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    if (bkSelectedTingkat != tingkat) {
                        bkSelectedTingkat = tingkat
                        val subList = bkTingkatGroups[tingkat] ?: emptyList()
                        val newSub = subList.firstOrNull() ?: ""
                        bkSelectedSubClass = newSub
                        renderBkTingkatAndSubClassChips()
                        if (newSub.isNotEmpty()) {
                            loadBkClassRecap(newSub)
                        }
                    }
                }
            }
            llTingkat.addView(btn)
        }

        // 2. Render Sub-Class Chips (VII-A, VII-B, ...)
        val llSub = binding.llBkSubClassChips
        llSub.removeAllViews()

        val subList = bkTingkatGroups[bkSelectedTingkat] ?: emptyList()
        if (subList.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Tidak ada rombel untuk tingkat ini"
                textSize = 11f
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, dp(4), 0, dp(4))
            }
            llSub.addView(tvEmpty)
            return
        }

        if (bkSelectedSubClass.isEmpty() || !subList.contains(bkSelectedSubClass)) {
            bkSelectedSubClass = subList.first()
        }

        subList.forEach { subClass ->
            val isSelected = (subClass == bkSelectedSubClass)
            val btn = TextView(this).apply {
                text = subClass
                textSize = 12f
                setTypeface(null, if (isSelected) Typeface.BOLD else Typeface.NORMAL)
                val padH = dp(14)
                val padV = dp(6)
                setPadding(padH, padV, padH, padV)
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 18f * density
                    if (isSelected) {
                        setColor(Color.parseColor("#2563EB"))
                    } else {
                        setColor(Color.parseColor("#F1F5F9"))
                        setStroke(dp(1), Color.parseColor("#CBD5E1"))
                    }
                }
                background = gd
                setTextColor(if (isSelected) Color.WHITE else Color.parseColor("#1E293B"))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = dp(8)
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    if (bkSelectedSubClass != subClass) {
                        bkSelectedSubClass = subClass
                        renderBkTingkatAndSubClassChips()
                        loadBkClassRecap(subClass)
                    }
                }
            }
            llSub.addView(btn)
        }
    }

    private fun renderBkRecap(students: List<BkStudentRecapDto>, selectedClass: String) {
        allRecapStudents = students
        lastSelectedClassName = selectedClass

        var totalH = 0
        var totalT = 0
        var totalS = 0
        var totalI = 0
        var totalA = 0
        var totalSp = 0

        students.forEach { s ->
            totalH += s.stats?.hadir ?: 0
            totalT += s.stats?.terlambat ?: 0
            totalS += s.stats?.sakit ?: 0
            totalI += s.stats?.izin ?: 0
            totalA += s.stats?.alpa ?: 0
            if (s.spLevel != null && s.spLevel != "Aman") {
                totalSp++
            }
        }

        binding.tvBkRecapTotalHadir.text = totalH.toString()
        binding.tvBkRecapTotalTerlambat.text = totalT.toString()
        binding.tvBkRecapTotalSakitIzin.text = (totalS + totalI).toString()
        binding.tvBkRecapTotalAlpa.text = totalA.toString()
        binding.tvBkRecapTotalSp.text = totalSp.toString()

        val query = binding.etSearchStudentBk.text?.toString()?.trim() ?: ""
        filterBkRecapStudents(query)
    }

    private fun filterBkRecapStudents(query: String) {
        val filtered = if (query.isEmpty()) {
            allRecapStudents
        } else {
            allRecapStudents.filter {
                it.name.contains(query, ignoreCase = true) ||
                (it.nisn?.contains(query, ignoreCase = true) == true) ||
                (it.className?.contains(query, ignoreCase = true) == true)
            }
        }
        renderBkRecapCards(filtered, lastSelectedClassName)
    }

    private fun renderBkRecapCards(students: List<BkStudentRecapDto>, selectedClass: String) {
        binding.tvBkRecapHeaderTitle.text = "👥 SISWA KELAS ${selectedClass.uppercase()}"
        binding.tvBkRecapStudentCount.text = "${students.size} Siswa"

        val container = binding.containerBkRecapStudents
        container.removeAllViews()

        if (students.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Tidak ada data siswa untuk pencarian / kelas ${selectedClass.uppercase()}."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(30, 30, 30, 30)
                gravity = android.view.Gravity.CENTER
            }
            container.addView(tvEmpty)
            return
        }

        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        students.forEach { s ->
            val card = CardView(this).apply {
                radius = 14f * density
                cardElevation = 2.5f * density
                useCompatPadding = true
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = dp(10)
                }
                layoutParams = lp
            }

            val cardInner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(14)
                setPadding(p, p, p, p)
            }

            // 1. Top Row: Avatar Initials + Name + Class Badge
            val rowTop = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val initials = s.name.split(" ").filter { it.isNotBlank() }.take(2).map { it.first() }.joinToString("").uppercase()
            val tvAvatar = TextView(this).apply {
                text = initials.ifEmpty { "S" }
                setTextColor(Color.parseColor("#059669"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                gravity = android.view.Gravity.CENTER
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL
                    setColor(Color.parseColor("#DCFCE7"))
                }
                background = gd
                val lp = LinearLayout.LayoutParams(dp(36), dp(36)).apply {
                    marginEnd = dp(10)
                }
                layoutParams = lp
            }
            rowTop.addView(tvAvatar)

            val colName = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val tvName = TextView(this).apply {
                text = s.name
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
            }
            colName.addView(tvName)

            val tvSub = TextView(this).apply {
                val gText = if (s.gender?.uppercase()?.startsWith("P") == true) "♀ Putri" else "♂ Putra"
                text = "NISN: ${s.nisn ?: "-"} • $gText • HP: ${s.parentPhone ?: "-"}"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 10.5f
            }
            colName.addView(tvSub)
            rowTop.addView(colName)

            val tvClass = TextView(this).apply {
                text = s.className ?: selectedClass
                setTextColor(Color.parseColor("#065F46"))
                setBackgroundColor(Color.parseColor("#D1FAE5"))
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(dp(8), dp(3), dp(8), dp(3))
            }
            rowTop.addView(tvClass)
            cardInner.addView(rowTop)

            // 2. Attendance Summary Badges Row (H, T, S, I, A)
            val rowAtt = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(8)
                }
                layoutParams = lp
            }

            fun createBadge(label: String, count: Int, bgHex: String, textHex: String): TextView {
                return TextView(this).apply {
                    text = "$label: $count"
                    textSize = 10f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor(textHex))
                    setBackgroundColor(Color.parseColor(bgHex))
                    setPadding(dp(6), dp(2), dp(6), dp(2))
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        marginEnd = dp(6)
                    }
                    layoutParams = lp
                }
            }

            val st = s.stats ?: BkStudentStatsDto()
            rowAtt.addView(createBadge("H", st.hadir, "#DCFCE7", "#15803D"))
            rowAtt.addView(createBadge("T", st.terlambat, "#FEF3C7", "#B45309"))
            rowAtt.addView(createBadge("S", st.sakit, "#E0E7FF", "#3730A3"))
            rowAtt.addView(createBadge("I", st.izin, "#CFFAFE", "#0E7490"))
            rowAtt.addView(createBadge("A", st.alpa, "#FEE2E2", "#B91C1C"))
            cardInner.addView(rowAtt)

            // 3. Status Presensi Hari Ini Box (QR Barcode & Meja BK)
            val boxToday = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 8f * density
                    setColor(Color.parseColor("#F8FAFC"))
                    setStroke(dp(1), Color.parseColor("#E2E8F0"))
                }
                background = gd
                val pB = dp(8)
                setPadding(pB, pB, pB, pB)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(10)
                }
                layoutParams = lp
            }

            // Row In
            val rowIn = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }
            val hasIn = s.todayGateIn != null
            val tvInIcon = TextView(this).apply {
                text = if (hasIn) "🟢" else "⏳"
                textSize = 11f
                setPadding(0, 0, dp(6), 0)
            }
            val tvInText = TextView(this).apply {
                if (hasIn) {
                    text = "Datang/Masuk: ${s.todayGateIn?.time ?: "-"} (${s.todayGateIn?.status ?: "HADIR"})"
                    setTextColor(Color.parseColor("#059669"))
                    setTypeface(null, Typeface.BOLD)
                } else {
                    text = "Datang/Masuk: Belum Tercatat Hari Ini"
                    setTextColor(Color.parseColor("#64748B"))
                }
                textSize = 11f
            }
            rowIn.addView(tvInIcon)
            rowIn.addView(tvInText)
            boxToday.addView(rowIn)

            // Row Out
            val rowOut = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(4)
                }
                layoutParams = lp
            }
            val hasOut = s.todayGateOut != null
            val tvOutIcon = TextView(this).apply {
                text = if (hasOut) "🔵" else "⏳"
                textSize = 11f
                setPadding(0, 0, dp(6), 0)
            }
            val tvOutText = TextView(this).apply {
                if (hasOut) {
                    text = "Kepulangan: ${s.todayGateOut?.time ?: "-"} (${s.todayGateOut?.status ?: "PULANG"})"
                    setTextColor(Color.parseColor("#2563EB"))
                    setTypeface(null, Typeface.BOLD)
                } else {
                    text = "Kepulangan: Belum Tercatat Hari Ini"
                    setTextColor(Color.parseColor("#64748B"))
                }
                textSize = 11f
            }
            rowOut.addView(tvOutIcon)
            rowOut.addView(tvOutText)
            boxToday.addView(rowOut)

            cardInner.addView(boxToday)

            // 4. Action Buttons Row: Absen Masuk + Absen Pulang (Auto Disabled jika sudah absen QR/Server)
            val rowActions = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(10)
                }
                layoutParams = lp
            }

            // Tombol Absen Datang (Masuk) - Otomatis Disabled jika sudah scan QR / tercatat masuk
            val masukTime = s.todayGateIn?.time
            val hasMasuk = !masukTime.isNullOrBlank()
            val btnMasuk = Button(this).apply {
                val lp = LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                    marginEnd = dp(6)
                }
                layoutParams = lp
                textSize = 10.5f
                setPadding(dp(4), 0, dp(4), 0)
                setTypeface(null, Typeface.BOLD)
                if (hasMasuk) {
                    text = "✅ Masuk: $masukTime"
                    isEnabled = false
                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#94A3B8"))
                    setTextColor(Color.parseColor("#475569"))
                } else {
                    text = "🟢 Absen Masuk"
                    isEnabled = true
                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#059669"))
                    setTextColor(Color.WHITE)
                    setOnClickListener {
                        quickSubmitAttendance(s.id, s.name, "GATE_IN", s.className ?: selectedClass)
                    }
                }
            }
            rowActions.addView(btnMasuk)

            // Tombol Absen Pulang - Otomatis Disabled jika sudah scan QR / tercatat kepulangan
            val pulangTime = s.todayGateOut?.time
            val hasPulang = !pulangTime.isNullOrBlank()
            val btnPulang = Button(this).apply {
                val lp = LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                    marginEnd = dp(6)
                }
                layoutParams = lp
                textSize = 10.5f
                setPadding(dp(4), 0, dp(4), 0)
                setTypeface(null, Typeface.BOLD)
                if (hasPulang) {
                    text = "✅ Pulang: $pulangTime"
                    isEnabled = false
                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#94A3B8"))
                    setTextColor(Color.parseColor("#475569"))
                } else {
                    text = "🔵 Absen Pulang"
                    isEnabled = true
                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
                    setTextColor(Color.WHITE)
                    setOnClickListener {
                        quickSubmitAttendance(s.id, s.name, "GATE_OUT", s.className ?: selectedClass)
                    }
                }
            }
            rowActions.addView(btnPulang)

            // Tombol Catat Poin Kedisiplinan / SP
            val btnDiscipline = Button(this).apply {
                val lp = LinearLayout.LayoutParams(dp(80), dp(38))
                layoutParams = lp
                text = "⚖️ Poin"
                textSize = 10.5f
                setTextColor(Color.parseColor("#334155"))
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#F1F5F9"))
                setOnClickListener {
                    showCreateDisciplineDialog(s.id, s.name, s.className ?: selectedClass)
                }
            }
            rowActions.addView(btnDiscipline)

            cardInner.addView(rowActions)

            card.addView(cardInner)
            container.addView(card)
        }
    }

    private fun quickSubmitAttendance(studentId: String, studentName: String, type: String, className: String) {
        val typeLabel = if (type == "GATE_IN") "Masuk (Datang)" else "Kepulangan (Pulang)"
        val options = arrayOf(
            "⚡ Catat Jam Sekarang (Otomatis)",
            "🕒 Pilih Jam & Menit Khusus (Jam Kedatangan/Kepulangan)"
        )

        AlertDialog.Builder(this)
            .setTitle("⏱️ Presensi $typeLabel Siswa")
            .setMessage("👤 Siswa: $studentName\n🏫 Kelas: $className\n\nPilih waktu pencatatan presensi:")
            .setItems(options) { _, which ->
                if (which == 0) {
                    doSubmitAttendance(studentId, studentName, type, className, null)
                } else {
                    val nowCal = java.util.Calendar.getInstance()
                    val curH = nowCal.get(java.util.Calendar.HOUR_OF_DAY)
                    val curM = nowCal.get(java.util.Calendar.MINUTE)
                    android.app.TimePickerDialog(this, { _, selectedHour, selectedMinute ->
                        val timeStr = String.format("%02d:%02d", selectedHour, selectedMinute)
                        doSubmitAttendance(studentId, studentName, type, className, timeStr)
                    }, curH, curM, true).show()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun doSubmitAttendance(studentId: String, studentName: String, type: String, className: String, clockTime: String?) {
        val typeLabel = if (type == "GATE_IN") "Masuk (Datang)" else "Kepulangan (Pulang)"
        val body = mutableMapOf(
            "studentId" to studentId,
            "type" to type,
            "status" to "PRESENT",
            "reasonNoPhone" to "Presensi Terverifikasi Guru BK",
            "notes" to "Dicatat langsung dari modul kelas ampuan BK ($className)"
        )
        if (!clockTime.isNullOrEmpty()) {
            body["clockTime"] = clockTime
        }

        ApiClient.getClient(this).submitBkManualAttendance(body).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val timeMsg = if (clockTime != null) " (Jam $clockTime WIB)" else ""
                    Toast.makeText(this@BkActivity, "✅ Presensi $typeLabel $studentName$timeMsg berhasil dicatat!", Toast.LENGTH_SHORT).show()
                    loadBkClassRecap(bkSelectedSubClass.ifEmpty { className })
                } else {
                    val err = response.body()?.message ?: "Gagal mencatat presensi"
                    Toast.makeText(this@BkActivity, "⚠️ $err", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun loadBkTodayActivity() {
        ApiClient.getClient(this).getBkTodayActivity().enqueue(object : Callback<BkTodayActivityResponse> {
            override fun onResponse(call: Call<BkTodayActivityResponse>, response: Response<BkTodayActivityResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    renderTodayActivity(data)
                }
            }
            override fun onFailure(call: Call<BkTodayActivityResponse>, t: Throwable) {
                // Background refresh ignore
            }
        })
    }

    private fun renderTodayActivity(data: BkTodayActivityResponse) {
        val density = resources.displayMetrics.density
        val lates = data.lateArrivals ?: emptyList()
        val earlies = data.earlyLeaves ?: emptyList()

        binding.tvBkTodayLateCount.text = "${lates.size} Siswa Terlambat di Ruang BK Hari Ini"
        binding.tvBkTodayEarlyCount.text = "${earlies.size} Siswa Izin Pulang Cepat Disetujui BK Hari Ini"

        val containerLate = binding.containerBkTodayLate
        containerLate.removeAllViews()

        if (lates.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "✅ Tidak ada siswa terlambat yang tercatat di ruang BK hari ini."
                setTextColor(Color.parseColor("#10B981"))
                textSize = 11.5f
                setPadding(20, 16, 20, 16)
                setBackgroundColor(Color.parseColor("#ECFDF5"))
            }
            containerLate.addView(tvEmpty)
        } else {
            lates.forEach { item ->
                val card = CardView(this).apply {
                    radius = 10 * density
                    cardElevation = 1.5f * density
                    useCompatPadding = true
                    setCardBackgroundColor(Color.WHITE)
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (6 * density).toInt()
                    }
                    layoutParams = lp
                }
                val inner = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (10 * density).toInt()
                    setPadding(p, p, p, p)
                }

                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                }
                val tvName = TextView(this).apply {
                    text = "🚨 ${item.studentName ?: "Siswa"} (${item.className ?: "-"})"
                    setTextColor(Color.parseColor("#DC2626"))
                    textSize = 12.5f
                    setTypeface(null, Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                row.addView(tvName)

                val timeStr = item.scanTime?.let {
                    try {
                        val d = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault()).parse(it)
                        java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(d ?: java.util.Date())
                    } catch (e: Exception) { it }
                } ?: "-"
                val tvTime = TextView(this).apply {
                    text = "🕒 $timeStr WIB"
                    setTextColor(Color.parseColor("#64748B"))
                    textSize = 11f
                }
                row.addView(tvTime)
                inner.addView(row)

                val tvNote = TextView(this).apply {
                    text = item.note ?: "Terlambat di Ruang BK (Poin +5)"
                    setTextColor(Color.parseColor("#475569"))
                    textSize = 11f
                    setPadding(0, 4, 0, 0)
                }
                inner.addView(tvNote)

                card.addView(inner)
                containerLate.addView(card)
            }
        }

        val containerEarly = binding.containerBkTodayEarly
        containerEarly.removeAllViews()

        if (earlies.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "ℹ️ Tidak ada siswa izin pulang cepat hari ini."
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11.5f
                setPadding(20, 16, 20, 16)
                setBackgroundColor(Color.parseColor("#F1F5F9"))
            }
            containerEarly.addView(tvEmpty)
        } else {
            earlies.forEach { item ->
                val card = CardView(this).apply {
                    radius = 10 * density
                    cardElevation = 1.5f * density
                    useCompatPadding = true
                    setCardBackgroundColor(Color.WHITE)
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (6 * density).toInt()
                    }
                    layoutParams = lp
                }
                val inner = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (10 * density).toInt()
                    setPadding(p, p, p, p)
                }

                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                }
                val tvName = TextView(this).apply {
                    text = "🚪 ${item.studentName ?: "Siswa"} (${item.className ?: "-"})"
                    setTextColor(Color.parseColor("#2563EB"))
                    textSize = 12.5f
                    setTypeface(null, Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                row.addView(tvName)

                val timeStr = item.scanTime?.let {
                    try {
                        val d = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault()).parse(it)
                        java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(d ?: java.util.Date())
                    } catch (e: Exception) { it }
                } ?: "-"
                val tvTime = TextView(this).apply {
                    text = "🕒 $timeStr WIB"
                    setTextColor(Color.parseColor("#64748B"))
                    textSize = 11f
                }
                row.addView(tvTime)
                inner.addView(row)

                val tvNote = TextView(this).apply {
                    text = item.note ?: "Izin Pulang Cepat Disetujui BK"
                    setTextColor(Color.parseColor("#475569"))
                    textSize = 11f
                    setPadding(0, 4, 0, 0)
                }
                inner.addView(tvNote)

                card.addView(inner)
                containerEarly.addView(card)
            }
        }
    }

    private fun showCreateDisciplineDialog(studentId: String, studentName: String, className: String) {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 20, 40, 10)
        }

        val tvInfo = TextView(this).apply {
            text = "Catat Kedisiplinan: $studentName ($className)"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 10)
        }
        container.addView(tvInfo)

        val rgType = android.widget.RadioGroup(this).apply {
            orientation = android.widget.RadioGroup.HORIZONTAL
        }
        val rbPelanggaran = android.widget.RadioButton(this).apply {
            text = "Pelanggaran (+Poin)"
            isChecked = true
            setTextColor(Color.parseColor("#DC2626"))
        }
        val rbPrestasi = android.widget.RadioButton(this).apply {
            text = "Prestasi (-Poin)"
            setTextColor(Color.parseColor("#059669"))
        }
        rgType.addView(rbPelanggaran)
        rgType.addView(rbPrestasi)
        container.addView(rgType)

        // Kategori SAW: Ringan (5), Sedang (20), Berat (50)
        val categories = arrayOf("Ringan (5 Poin)", "Sedang (20 Poin)", "Berat (50 Poin)", "Kustom")
        val spCategory = Spinner(this).apply {
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, categories)
        }
        container.addView(TextView(this).apply {
            text = "Kategori Tingkat Pelanggaran (SAW):"
            textSize = 11.5f
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 10, 0, 4)
        })
        container.addView(spCategory)

        // Kriteria SAW Bobot Resmi SIBOY
        val criteriaList = arrayOf(
            "Tata Tertib (Bobot: 25%)",
            "Disiplin Kehadiran (Bobot: 25%)",
            "Etika & Sopan Santun (Bobot: 20%)",
            "Akademik & Tugas (Bobot: 15%)",
            "Estetika & Kerapian (Bobot: 15%)"
        )
        val spCriteria = Spinner(this).apply {
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, criteriaList)
        }
        container.addView(TextView(this).apply {
            text = "Kriteria Penilaian SAW:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 10, 0, 4)
        })
        container.addView(spCriteria)

        val etPoints = EditText(this).apply {
            hint = "Jumlah Poin"
            setText("5")
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 12
            }
            layoutParams = lp
        }
        container.addView(etPoints)

        spCategory.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                when (position) {
                    0 -> etPoints.setText("5")
                    1 -> etPoints.setText("20")
                    2 -> etPoints.setText("50")
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        val etDesc = EditText(this).apply {
            hint = "Keterangan / Kejadian (contoh: Terlambat masuk sekolah > 15 menit)"
            setLines(3)
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 12
            }
            layoutParams = lp
        }
        container.addView(etDesc)

        val cbNotifyParent = CheckBox(this).apply {
            text = "Kirim Notifikasi Real-Time ke Orang Tua (FCM)"
            isChecked = true
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 11.5f
            setPadding(8, 8, 8, 8)
        }
        container.addView(cbNotifyParent)

        AlertDialog.Builder(this)
            .setTitle("⚖️ Catat Poin Kedisiplinan")
            .setView(container)
            .setPositiveButton("Simpan Poin") { _, _ ->
                val type = if (rbPelanggaran.isChecked) "PELANGGARAN" else "PRESTASI"
                val pts = etPoints.text.toString().toIntOrNull() ?: 5
                val rawDesc = etDesc.text.toString().trim()

                if (rawDesc.isEmpty()) {
                    Toast.makeText(this, "Harap isi keterangan pelanggaran / prestasi", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val selectedCrit = spCriteria.selectedItem?.toString()?.substringBefore(" ") ?: "Umum"
                val selectedCat = spCategory.selectedItem?.toString()?.substringBefore(" ") ?: "Ringan"
                val fullDesc = "[$selectedCat • $selectedCrit] $rawDesc"

                val req = CreateDisciplineRequest(
                    studentId = studentId,
                    type = type,
                    description = fullDesc,
                    points = pts
                )

                Toast.makeText(this, "Menyimpan catatan kedisiplinan...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).createDisciplineRecord(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@BkActivity, "✅ Catatan kedisiplinan berhasil disimpan!", Toast.LENGTH_LONG).show()
                            loadBkClassRecap(currentSelectedClass)
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal menyimpan kedisiplinan", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadPendingStudentLeaves() {
        Toast.makeText(this, "Memuat permohonan izin siswa...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getPendingStudentLeavesForBk(null, "PENDING").enqueue(object : Callback<PendingStudentLeavesResponse> {
            override fun onResponse(call: Call<PendingStudentLeavesResponse>, response: Response<PendingStudentLeavesResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    val leaves = data.leaves ?: emptyList()
                    binding.tvBkLeavesSummary.text = "Terdapat ${leaves.size} permohonan izin siswa yang menunggu verifikasi BK"
                    renderBkLeaves(leaves)
                } else {
                    Toast.makeText(this@BkActivity, "Gagal memuat izin siswa", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<PendingStudentLeavesResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderBkLeaves(leaves: List<StudentLeaveRequestDto>) {
        val container = binding.llBkLeavesList
        container.removeAllViews()

        if (leaves.isEmpty()) {
            val cardEmpty = CardView(this).apply {
                radius = 12f * resources.displayMetrics.density
                cardElevation = 1f * resources.displayMetrics.density
                setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                layoutParams = lp
            }
            val tvEmpty = TextView(this).apply {
                text = "🎉 Tidak ada permohonan izin/sakit yang menunggu verifikasi saat ini."
                setTextColor(Color.parseColor("#64748B"))
                textSize = 12f
                gravity = android.view.Gravity.CENTER
                setPadding(30, 40, 30, 40)
            }
            cardEmpty.addView(tvEmpty)
            container.addView(cardEmpty)
            return
        }

        leaves.forEach { item ->
            val card = CardView(this).apply {
                radius = 12f * resources.displayMetrics.density
                cardElevation = 2f * resources.displayMetrics.density
                setCardBackgroundColor(Color.parseColor("#FFFFFF"))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 14
                }
                layoutParams = lp
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(24, 20, 24, 20)
            }

            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val tvName = TextView(this).apply {
                text = "${item.studentName} (${item.className})"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                layoutParams = lp
            }
            topRow.addView(tvName)

            val catLabel = when (item.category.uppercase()) {
                "SICK" -> "🤒 SAKIT"
                "PERMISSION" -> "✉️ IZIN"
                "DISPENSATION" -> "🎖️ DISPENSASI"
                else -> item.category
            }
            val catColor = when (item.category.uppercase()) {
                "SICK" -> "#EA580C"
                "PERMISSION" -> "#2563EB"
                "DISPENSATION" -> "#7C3AED"
                else -> "#475569"
            }

            val tvCatBadge = TextView(this).apply {
                text = catLabel
                setTextColor(Color.parseColor(catColor))
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setBackgroundColor(Color.parseColor("#F1F5F9"))
                setPadding(14, 4, 14, 4)
            }
            topRow.addView(tvCatBadge)
            inner.addView(topRow)

            val sDate = item.startDate.take(10)
            val eDate = item.endDate.take(10)
            val durDays = item.durationDays ?: 1
            val appDays = item.approvedDays ?: if (item.category.uppercase() == "SICK" && item.isDoctorNote != true) minOf(durDays, 3) else durDays
            val docLabel = item.documentLabel ?: if (item.isDoctorNote == true) {
                "🏥 Surat Keterangan Dokter Resmi ($appDays Hari Istirahat)"
            } else if (item.category.uppercase() == "SICK") {
                "🏠 Izin Sakit Orang Tua (Otomatis Maks 3 Hari)"
            } else {
                "📝 Izin Resmi"
            }

            val tvDates = TextView(this).apply {
                text = "📅 Periode: $sDate s/d $eDate • Disetujui: $appDays Hari"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, 8, 0, 0)
            }
            inner.addView(tvDates)

            val tvDocInfo = TextView(this).apply {
                val extTag = if (item.isExtension == true) " [🔄 PERPANJANGAN SAKIT]" else ""
                text = "$docLabel$extTag"
                setTextColor(if (item.isDoctorNote == true) Color.parseColor("#0284C7") else Color.parseColor("#D97706"))
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, 4, 0, 0)
            }
            inner.addView(tvDocInfo)

            val tvReason = TextView(this).apply {
                text = "Keterangan: ${item.reason}"
                setTextColor(Color.parseColor("#334155"))
                textSize = 12f
                setPadding(0, 4, 0, 0)
            }
            inner.addView(tvReason)

            val tvParent = TextView(this).apply {
                text = "Diajukan oleh: ${item.parentName} (${item.parentPhone ?: "-"})"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11f
                setPadding(0, 4, 0, 0)
            }
            inner.addView(tvParent)

            if (!item.attachmentUrl.isNullOrEmpty()) {
                val btnViewPhoto = Button(this).apply {
                    text = "📎 Lihat Foto Bukti / Surat Dokter"
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#2563EB"))
                    setBackgroundColor(Color.parseColor("#EFF6FF"))
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (40 * resources.displayMetrics.density).toInt()).apply {
                        topMargin = 10
                    }
                    layoutParams = lp
                    setOnClickListener {
                        showProofPhotoDialog(item.studentName, item.attachmentUrl!!)
                    }
                }
                inner.addView(btnViewPhoto)
            }

            val btnRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = 10
                }
                layoutParams = lp
            }

            val btnApprove = Button(this).apply {
                text = "✅ Setujui ($appDays Hari)"
                textSize = 11.5f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#059669"))
                val lp = LinearLayout.LayoutParams(0, (40 * resources.displayMetrics.density).toInt(), 1f).apply {
                    marginEnd = 6
                }
                layoutParams = lp
                setOnClickListener {
                    verifyStudentLeave(item.id, "APPROVED", null)
                }
            }
            btnRow.addView(btnApprove)

            val btnReject = Button(this).apply {
                text = "❌ Tolak"
                textSize = 11.5f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#DC2626"))
                val lp = LinearLayout.LayoutParams(0, (40 * resources.displayMetrics.density).toInt(), 1f).apply {
                    marginStart = 6
                }
                layoutParams = lp
                setOnClickListener {
                    showRejectLeaveDialog(item.id, item.studentName)
                }
            }
            btnRow.addView(btnReject)

            inner.addView(btnRow)
            card.addView(inner)
            container.addView(card)
        }
    }

    private fun showRejectLeaveDialog(leaveId: String, studentName: String) {
        val input = EditText(this).apply {
            hint = "Alasan penolakan izin (contoh: Bukti surat tidak valid)"
            setPadding(30, 20, 30, 20)
        }
        AlertDialog.Builder(this)
            .setTitle("Tolak Izin: $studentName")
            .setView(input)
            .setPositiveButton("Tolak Izin") { _, _ ->
                val reason = input.text.toString().trim().ifEmpty { "Ditolak oleh Guru BK" }
                verifyStudentLeave(leaveId, "REJECTED", reason)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun verifyStudentLeave(id: String, status: String, note: String?) {
        val req = VerifyLeaveRequest(status = status, rejectionNote = note)
        ApiClient.getClient(this).verifyTeacherLeave(id, req).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    val action = if (status == "APPROVED") "disetujui" else "ditolak"
                    Toast.makeText(this@BkActivity, "✅ Permohonan izin berhasil $action!", Toast.LENGTH_SHORT).show()
                    loadPendingStudentLeaves()
                } else {
                    Toast.makeText(this@BkActivity, "Gagal memproses verifikasi izin", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private var dynamicQrDialog: AlertDialog? = null
    private var dynamicQrHandler: Handler? = null
    private var dynamicQrRunnable: Runnable? = null
    private var dynamicQrTtlSeconds: Int = 45

    private fun showDynamicRotatingQrDialog() {
        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 32, 40, 32)
            gravity = android.view.Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.WHITE)
        }

        val tvTitle = TextView(this).apply {
            text = "🛡️ DYNAMIC ROTATING QR RUANG BK"
            setTextColor(Color.parseColor("#065F46"))
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            gravity = android.view.Gravity.CENTER
        }
        dialogView.addView(tvTitle)

        val tvSub = TextView(this).apply {
            text = "Anti-Fraud 45-Detik: Tunjukkan QR ini ke Siswa yang Berdiri di Meja BK"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 11.5f
            gravity = android.view.Gravity.CENTER
            setPadding(0, 4, 0, 16)
        }
        dialogView.addView(tvSub)

        val cardQr = CardView(this).apply {
            radius = 16 * resources.displayMetrics.density
            cardElevation = 4 * resources.displayMetrics.density
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams((250 * resources.displayMetrics.density).toInt(), (250 * resources.displayMetrics.density).toInt()).apply {
                gravity = android.view.Gravity.CENTER
            }
            layoutParams = lp
        }

        val ivQr = ImageView(this).apply {
            setPadding(16, 16, 16, 16)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        cardQr.addView(ivQr)
        dialogView.addView(cardQr)

        val tvTtl = TextView(this).apply {
            text = "⏳ Memuat token QR baru..."
            setTextColor(Color.parseColor("#D97706"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            gravity = android.view.Gravity.CENTER
            setPadding(0, 16, 0, 4)
        }
        dialogView.addView(tvTtl)

        val tvHash = TextView(this).apply {
            text = "HMAC SHA-256 Token Protection Active"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 10f
            gravity = android.view.Gravity.CENTER
            setPadding(0, 0, 0, 16)
        }
        dialogView.addView(tvHash)

        fun fetchAndRenderQr() {
            ApiClient.getClient(this).getBkDynamicQr("RUANG_BK_UTAMA").enqueue(object : Callback<BkDynamicQrResponse> {
                override fun onResponse(call: Call<BkDynamicQrResponse>, response: Response<BkDynamicQrResponse>) {
                    val body = response.body()
                    if (response.isSuccessful && body?.success == true && body.data != null) {
                        val tokenData = body.data
                        val bmp = QrCodeHelper.generateQrCodeBitmap(tokenData.tokenPayload, 550)
                        if (bmp != null) {
                            ivQr.setImageBitmap(bmp)
                        }
                        dynamicQrTtlSeconds = tokenData.ttlSeconds
                        tvTtl.text = "⏳ Berputar otomatis dalam ${dynamicQrTtlSeconds}s"
                        tvHash.text = "Token: ${tokenData.currentTokenHash.take(12)}... • Window #${tokenData.windowIndex}"
                    } else {
                        tvTtl.text = "⚠️ Gagal memuat token"
                    }
                }
                override fun onFailure(call: Call<BkDynamicQrResponse>, t: Throwable) {
                    tvTtl.text = "⚠️ Koneksi server terputus: ${t.message}"
                }
            })
        }

        fetchAndRenderQr()

        dynamicQrHandler = Handler(Looper.getMainLooper())
        dynamicQrRunnable = object : Runnable {
            override fun run() {
                dynamicQrTtlSeconds--
                if (dynamicQrTtlSeconds <= 0) {
                    fetchAndRenderQr()
                } else {
                    tvTtl.text = "⏳ Berputar otomatis dalam ${dynamicQrTtlSeconds}s"
                }
                dynamicQrHandler?.postDelayed(this, 1000)
            }
        }
        dynamicQrHandler?.postDelayed(dynamicQrRunnable!!, 1000)

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .setPositiveButton("Tutup") { d, _ ->
                d.dismiss()
            }
            .setOnDismissListener {
                dynamicQrRunnable?.let { dynamicQrHandler?.removeCallbacks(it) }
                dynamicQrHandler = null
            }
            .create()

        dynamicQrDialog = dialog
        dialog.show()
    }

    private fun showProofPhotoDialog(studentName: String, photoUrl: String) {
        val sv = ScrollView(this)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(30, 20, 30, 20)
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }

        val tvInfo = TextView(this).apply {
            text = "📄 Foto Bukti Surat / Keterangan Dokter"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 12)
        }
        container.addView(tvInfo)

        val ivPhoto = ImageView(this).apply {
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                height = (320 * resources.displayMetrics.density).toInt()
            }
            layoutParams = lp
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }
        container.addView(ivPhoto)

        val tvFooter = TextView(this).apply {
            text = "Diunggah langsung oleh orang tua siswa melalui aplikasi SmartCBT."
            setTextColor(Color.parseColor("#64748B"))
            textSize = 11f
            setPadding(0, 10, 0, 0)
        }
        container.addView(tvFooter)
        sv.addView(container)

        Thread {
            try {
                if (photoUrl.startsWith("data:image")) {
                    val base64Data = photoUrl.substringAfter(",")
                    val decoded = Base64.decode(base64Data, Base64.DEFAULT)
                    val bmp = BitmapFactory.decodeByteArray(decoded, 0, decoded.size)
                    runOnUiThread { ivPhoto.setImageBitmap(bmp) }
                } else {
                    val finalUrl = if (photoUrl.startsWith("http://") || photoUrl.startsWith("https://")) {
                        photoUrl
                    } else {
                        ApiClient.BASE_URL.removeSuffix("/") + "/" + photoUrl.removePrefix("/")
                    }
                    val client = OkHttpClient()
                    val req = Request.Builder().url(finalUrl).build()
                    val resp = client.newCall(req).execute()
                    if (resp.isSuccessful) {
                        val stream = resp.body()?.byteStream()
                        if (stream != null) {
                            val bmp = BitmapFactory.decodeStream(stream)
                            runOnUiThread { ivPhoto.setImageBitmap(bmp) }
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@BkActivity, "Gagal memuat foto bukti: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }.start()

        AlertDialog.Builder(this)
            .setTitle("📎 Surat Izin: $studentName")
            .setView(sv)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun showBkManualAttendanceDialog() {
        val sv = ScrollView(this)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 24, 36, 16)
        }

        val tvHeader = TextView(this).apply {
            text = "📱 Form Presensi Manual BK (Tanpa HP)"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 8)
        }
        container.addView(tvHeader)

        val tvSub = TextView(this).apply {
            text = "Pencatatan darurat untuk siswa yang HP-nya tertinggal, baterai habis, atau rusak. Data otomatis terhubung ke rekap gerbang & orang tua."
            setTextColor(Color.parseColor("#64748B"))
            textSize = 11f
            setPadding(0, 0, 0, 14)
        }
        container.addView(tvSub)

        val etStudent = EditText(this).apply {
            hint = "Nama atau NISN Siswa"
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }
        container.addView(etStudent)

        val rgType = RadioGroup(this).apply {
            orientation = RadioGroup.HORIZONTAL
            setPadding(0, 10, 0, 10)
        }
        val rbIn = RadioButton(this).apply {
            text = "🚪 Masuk (GATE_IN)"
            isChecked = true
            setTextColor(Color.parseColor("#059669"))
        }
        val rbOut = RadioButton(this).apply {
            text = "🏃 Pulang (GATE_OUT)"
            setTextColor(Color.parseColor("#2563EB"))
        }
        rgType.addView(rbIn)
        rgType.addView(rbOut)
        container.addView(rgType)

        val tvStatusLabel = TextView(this).apply {
            text = "Status Kehadiran:"
            setTextColor(Color.parseColor("#334155"))
            textSize = 11.5f
            setPadding(0, 8, 0, 4)
        }
        container.addView(tvStatusLabel)

        val statusList = arrayOf("PRESENT (Hadir Tepat Waktu)", "LATE (Terlambat)", "SICK (Sakit)", "PERMISSION (Izin)")
        val spStatus = Spinner(this).apply {
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, statusList)
        }
        container.addView(spStatus)

        val tvReasonLabel = TextView(this).apply {
            text = "Alasan Tanpa HP:"
            setTextColor(Color.parseColor("#334155"))
            textSize = 11.5f
            setPadding(0, 10, 0, 4)
        }
        container.addView(tvReasonLabel)

        val reasonOptions = arrayOf(
            "FORGOT (HP Tertinggal di Rumah)",
            "BATTERY_EMPTY (Baterai HP Habis)",
            "NO_PHONE (Tidak Membawa HP / Rusak)",
            "OTHER (Alasan Khusus Lainnya)"
        )
        val spReason = Spinner(this).apply {
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, reasonOptions)
        }
        container.addView(spReason)

        val etNotes = EditText(this).apply {
            hint = "Catatan Tambahan Guru BK (Opsional)"
            setLines(2)
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 12
            }
            layoutParams = lp
        }
        container.addView(etNotes)

        sv.addView(container)

        AlertDialog.Builder(this)
            .setTitle("➕ Catat Presensi Siswa")
            .setView(sv)
            .setPositiveButton("Simpan Presensi") { _, _ ->
                val studentInput = etStudent.text.toString().trim()
                if (studentInput.isEmpty()) {
                    Toast.makeText(this, "Harap isi nama atau NISN siswa!", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val type = if (rbIn.isChecked) "GATE_IN" else "GATE_OUT"
                val rawStatus = spStatus.selectedItem.toString()
                val status = rawStatus.substringBefore(" ")
                val rawReason = spReason.selectedItem.toString()
                val reasonCode = rawReason.substringBefore(" ")
                val note = etNotes.text.toString().trim()

                val body = mapOf(
                    "studentId" to studentInput,
                    "type" to type,
                    "status" to status,
                    "reasonWithoutPhone" to reasonCode,
                    "note" to note
                )

                Toast.makeText(this, "Menyimpan presensi manual BK...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).submitBkManualAttendance(body).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@BkActivity, "✅ Presensi manual BK berhasil dicatat!", Toast.LENGTH_LONG).show()
                            loadBkManualLogs()
                        } else {
                            Toast.makeText(this@BkActivity, "Gagal mencatat presensi", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadBkManualLogs() {
        ApiClient.getClient(this).getBkManualTodayLog().enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    val rawLogs = body["logs"] as? List<Map<String, Any>> ?: emptyList()
                    renderBkManualLogs(rawLogs)
                } else {
                    Toast.makeText(this@BkActivity, "Gagal memuat log presensi BK", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderBkManualLogs(logs: List<Map<String, Any>>) {
        val container = binding.llBkManualLogsList
        container.removeAllViews()

        if (logs.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada siswa yang dicatat presensi manual oleh Guru BK hari ini."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(10, 20, 10, 20)
            }
            container.addView(tvEmpty)
            return
        }

        logs.forEach { log ->
            val userMap = log["user"] as? Map<String, Any>
            val studentName = userMap?.get("name")?.toString() ?: "Siswa"
            val className = userMap?.get("className")?.toString() ?: "-"
            val nisn = userMap?.get("nisn")?.toString() ?: "-"
            val type = log["type"]?.toString() ?: "GATE_IN"
            val status = log["status"]?.toString() ?: "PRESENT"
            val reason = log["reasonWithoutPhone"]?.toString() ?: "-"
            val note = log["notes"]?.toString() ?: ""
            val scanTime = log["scanTime"]?.toString()?.takeLast(13)?.take(5) ?: "-"

            val card = CardView(this).apply {
                radius = 10f * resources.displayMetrics.density
                cardElevation = 1.5f * resources.displayMetrics.density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 10
                }
                layoutParams = lp
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(20, 16, 20, 16)
            }

            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val tvName = TextView(this).apply {
                text = "$studentName ($className)"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                layoutParams = lp
            }
            topRow.addView(tvName)

            val tvTime = TextView(this).apply {
                text = "🕒 $scanTime WIB"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11f
            }
            topRow.addView(tvTime)
            inner.addView(topRow)

            val badgesRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 6, 0, 0)
            }

            val typeBadge = TextView(this).apply {
                text = if (type == "GATE_IN") "🚪 MASUK" else "🏃 PULANG"
                setTextColor(if (type == "GATE_IN") Color.parseColor("#059669") else Color.parseColor("#2563EB"))
                setBackgroundColor(Color.parseColor("#F1F5F9"))
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setPadding(10, 3, 10, 3)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = 6
                }
                layoutParams = lp
            }
            badgesRow.addView(typeBadge)

            val reasonBadge = TextView(this).apply {
                text = "📱 $reason"
                setTextColor(Color.parseColor("#EA580C"))
                setBackgroundColor(Color.parseColor("#FFF7ED"))
                textSize = 10f
                setPadding(10, 3, 10, 3)
            }
            badgesRow.addView(reasonBadge)
            inner.addView(badgesRow)

            if (note.isNotEmpty()) {
                val tvNote = TextView(this).apply {
                    text = "Catatan: $note"
                    setTextColor(Color.parseColor("#64748B"))
                    textSize = 11f
                    setPadding(0, 4, 0, 0)
                }
                inner.addView(tvNote)
            }

            card.addView(inner)
            container.addView(card)
        }
    }

    private fun loadBk360AttendanceRecap() {
        Toast.makeText(this, "Memuat rekap presensi 360°...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getBkUnifiedAttendanceRecap(currentSelectedClass, null).enqueue(object : Callback<BkUnifiedRecapResponse> {
            override fun onResponse(call: Call<BkUnifiedRecapResponse>, response: Response<BkUnifiedRecapResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    renderBk360(data)
                } else {
                    Toast.makeText(this@BkActivity, "Gagal memuat rekap 360°", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BkUnifiedRecapResponse>, t: Throwable) {
                Toast.makeText(this@BkActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderBk360(data: BkUnifiedRecapResponse) {
        val container = binding.llBk360Cards
        container.removeAllViews()

        val summary = data.summary
        val gate = summary?.gate
        val sholat = summary?.sholat
        val students = data.students ?: emptyList()

        val cardSummary = CardView(this).apply {
            radius = 12f * resources.displayMetrics.density
            cardElevation = 2f * resources.displayMetrics.density
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = 14
            }
            layoutParams = lp
        }

        val innerSummary = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 20)
        }

        val tvTitle = TextView(this).apply {
            text = "📊 STATISTIK HARI INI (${data.className ?: "Semua Kelas Ampuan"})"
            setTextColor(Color.parseColor("#7C3AED"))
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
        }
        innerSummary.addView(tvTitle)

        val btnDownloadBkPdf = Button(this).apply {
            text = "📄 Unduh / Cetak Laporan PDF Lengkap (A4 Portal)"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#7C3AED"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * resources.displayMetrics.density).toInt()).apply {
                topMargin = 10
                bottomMargin = 8
            }
            layoutParams = lp
            setOnClickListener {
                com.school.smartcbt.utils.AttendancePdfHelper.showDownloadPdfDialog(
                    activity = this@BkActivity,
                    defaultClassName = currentSelectedClass,
                    title = "Laporan Presensi 360° Siswa BK"
                )
            }
        }
        innerSummary.addView(btnDownloadBkPdf)

        val statsGrid = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 10, 0, 0)
        }

        val colGate = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = 6
            }
            layoutParams = lp
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            setPadding(16, 12, 16, 12)
        }
        val tvGateH = TextView(this).apply {
            text = "🚪 Gerbang Masuk"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        val tvGateInfo = TextView(this).apply {
            text = "Hadir: ${gate?.hadir ?: 0}\nTelat: ${gate?.terlambat ?: 0}\nSakit/Izin: ${gate?.sakitIzin ?: 0}\nBelum: ${gate?.belumMasuk ?: 0}"
            setTextColor(Color.parseColor("#475569"))
            textSize = 11f
            setPadding(0, 4, 0, 0)
        }
        colGate.addView(tvGateH)
        colGate.addView(tvGateInfo)
        statsGrid.addView(colGate)

        val colSholat = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = 6
            }
            layoutParams = lp
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            setPadding(16, 12, 16, 12)
        }
        val tvSholatH = TextView(this).apply {
            text = "🕌 Sholat Dhuhur"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        val tvSholatInfo = TextView(this).apply {
            text = "Berjamaah: ${sholat?.berjamaah ?: 0}\nBerhalangan: ${sholat?.haid ?: 0}\nBelum: ${sholat?.belum ?: 0}"
            setTextColor(Color.parseColor("#475569"))
            textSize = 11f
            setPadding(0, 4, 0, 0)
        }
        colSholat.addView(tvSholatH)
        colSholat.addView(tvSholatInfo)
        statsGrid.addView(colSholat)

        innerSummary.addView(statsGrid)
        cardSummary.addView(innerSummary)
        container.addView(cardSummary)

        val tvListHeader = TextView(this).apply {
            text = "👥 Integrasi Presensi Per Siswa (${students.size} Siswa)"
            setTextColor(Color.parseColor("#334155"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 4, 0, 10)
        }
        container.addView(tvListHeader)

        if (students.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Tidak ada data presensi siswa untuk ditampilkan."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(10, 10, 10, 10)
            }
            container.addView(tvEmpty)
            return
        }

        students.forEach { s ->
            val card = CardView(this).apply {
                radius = 10f * resources.displayMetrics.density
                cardElevation = 1.5f * resources.displayMetrics.density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 8
                }
                layoutParams = lp
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(20, 16, 20, 16)
            }

            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val genderIcon = if (s.gender?.uppercase() == "P" || s.gender?.uppercase() == "FEMALE") "👧" else "👦"
            val tvName = TextView(this).apply {
                text = "$genderIcon ${s.name} (${s.className ?: "-"})"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                layoutParams = lp
            }
            topRow.addView(tvName)

            val tvNisn = TextView(this).apply {
                text = "NISN: ${s.nisn ?: "-"}"
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 10.5f
            }
            topRow.addView(tvNisn)
            inner.addView(topRow)

            val badgesRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 8, 0, 0)
            }

            val gateText = when (s.gateStatus.uppercase()) {
                "HADIR" -> "🚪 Hadir"
                "TERLAMBAT" -> "🏃 Telat"
                "SAKIT" -> "🤒 Sakit"
                "IZIN" -> "✉️ Izin"
                else -> "🚪 Belum Masuk"
            }
            val gateColor = when (s.gateStatus.uppercase()) {
                "HADIR" -> "#059669"
                "TERLAMBAT" -> "#EA580C"
                "SAKIT", "IZIN" -> "#2563EB"
                else -> "#94A3B8"
            }
            val badgeGate = TextView(this).apply {
                text = gateText
                setTextColor(Color.parseColor(gateColor))
                setBackgroundColor(Color.parseColor("#F1F5F9"))
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setPadding(10, 4, 10, 4)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = 6
                }
                layoutParams = lp
            }
            badgesRow.addView(badgeGate)

            val badgeMapel = TextView(this).apply {
                text = "📖 ${s.mapelCount} Mapel"
                setTextColor(Color.parseColor("#0284C7"))
                setBackgroundColor(Color.parseColor("#F0F9FF"))
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setPadding(10, 4, 10, 4)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = 6
                }
                layoutParams = lp
            }
            badgesRow.addView(badgeMapel)

            val prayerText = when (s.prayerStatus.uppercase()) {
                "HADIR_KEPUTRIAN" -> "🌸 Hadir Keputrian"
                "BERJAMAAH", "SHOLAT_BERJAMAAH" -> "🕌 Sholat"
                "BERHALANGAN_HAID" -> "🩸 Berhalangan (Haid)"
                "ALPHA" -> "❌ Alpha"
                else -> "⏳ Belum Sholat"
            }
            val prayerColor = when (s.prayerStatus.uppercase()) {
                "HADIR_KEPUTRIAN" -> "#BE185D"
                "BERJAMAAH", "SHOLAT_BERJAMAAH" -> "#059669"
                "BERHALANGAN_HAID" -> "#BE185D"
                "ALPHA" -> "#DC2626"
                else -> "#94A3B8"
            }
            val badgePrayer = TextView(this).apply {
                text = prayerText
                setTextColor(Color.parseColor(prayerColor))
                setBackgroundColor(Color.parseColor("#F1F5F9"))
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setPadding(10, 4, 10, 4)
            }
            badgesRow.addView(badgePrayer)

            inner.addView(badgesRow)
            card.addView(inner)
            container.addView(card)
        }
    }

    private fun showBkGlobalPrayerDialog() {
        val dialog = AlertDialog.Builder(this).create()
        val density = resources.displayMetrics.density

        val scrollView = ScrollView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((16 * density).toInt(), (16 * density).toInt(), (16 * density).toInt(), (24 * density).toInt())
        }
        scrollView.addView(root)
        dialog.setView(scrollView)

        // Header
        val headerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val colTitle = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvTitle = TextView(this).apply {
            text = "🕌 Rekap Global Sholat Seluruh Rombel"
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        val tvSub = TextView(this).apply {
            text = "Monitoring Ibadah 33 Rombel & Konseling Kedisiplinan BK"
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
        }
        colTitle.addView(tvTitle)
        colTitle.addView(tvSub)
        headerRow.addView(colTitle)

        val btnClose = Button(this).apply {
            text = "✕"
            textSize = 14f
            setTextColor(Color.parseColor("#64748B"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { dialog.dismiss() }
        }
        headerRow.addView(btnClose)
        root.addView(headerRow)

        // Filter Controls
        val filterRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (12 * density).toInt()
            }
        }
        val spGrade = Spinner(this).apply {
            val grades = listOf("Semua Tingkat (33 Rombel)", "Kelas 7 Saja", "Kelas 8 Saja", "Kelas 9 Saja")
            adapter = ArrayAdapter(this@BkActivity, android.R.layout.simple_spinner_dropdown_item, grades)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        filterRow.addView(spGrade)
        root.addView(filterRow)

        // Container for Stats KPI
        val statsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (12 * density).toInt()
            }
            weightSum = 4f
        }
        root.addView(statsContainer)

        // Content Area (Class Breakdown & Alpa Students)
        val contentArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (14 * density).toInt()
            }
        }
        root.addView(contentArea)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat rekap makro sholat dari server..."
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            setPadding(0, (20 * density).toInt(), 0, (20 * density).toInt())
            gravity = android.view.Gravity.CENTER
        }
        contentArea.addView(tvLoading)

        dialog.show()

        fun loadData(gradeFilter: String) {
            val targetGrade = when (gradeFilter) {
                "Kelas 7 Saja" -> "7"
                "Kelas 8 Saja" -> "8"
                "Kelas 9 Saja" -> "9"
                else -> "ALL"
            }
            contentArea.removeAllViews()
            contentArea.addView(tvLoading)
            statsContainer.removeAllViews()

            ApiClient.getClient(this).getBkGlobalPrayerRecap(null, null, targetGrade).enqueue(object : Callback<BkGlobalPrayerRecapResponse> {
                override fun onResponse(call: Call<BkGlobalPrayerRecapResponse>, response: Response<BkGlobalPrayerRecapResponse>) {
                    contentArea.removeAllViews()
                    if (response.isSuccessful && response.body() != null && response.body()!!.success) {
                        val body = response.body()!!
                        val ms = body.macroStats

                        // Render 4 KPI Mini Cards
                        statsContainer.removeAllViews()
                        val kpis = listOf(
                            Triple("Terjadwal", "${ms?.totalScheduledStudents ?: 0}", "#1E293B"),
                            Triple("Sholat", "${ms?.totalSholat ?: 0} (${ms?.overallPercentage ?: 0}%)", "#059669"),
                            Triple("Uzur/Keputrian", "${(ms?.totalUzur ?: 0) + (ms?.totalKeputrian ?: 0)}", "#7C3AED"),
                            Triple("Alpa", "${ms?.totalAlpa ?: 0}", "#DC2626")
                        )
                        kpis.forEach { (label, value, col) ->
                            val cardKpi = CardView(this@BkActivity).apply {
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                                    marginEnd = (4 * density).toInt()
                                }
                                radius = 8 * density
                                cardElevation = 0f
                                setCardBackgroundColor(Color.parseColor("#FFFFFF"))
                            }
                            val inner = LinearLayout(this@BkActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding((6 * density).toInt(), (8 * density).toInt(), (6 * density).toInt(), (8 * density).toInt())
                                gravity = android.view.Gravity.CENTER
                            }
                            val tvVal = TextView(this@BkActivity).apply {
                                text = value
                                textSize = 11.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor(col))
                            }
                            val tvLbl = TextView(this@BkActivity).apply {
                                text = label
                                textSize = 8.5f
                                setTextColor(Color.parseColor("#64748B"))
                            }
                            inner.addView(tvVal)
                            inner.addView(tvLbl)
                            cardKpi.addView(inner)
                            statsContainer.addView(cardKpi)
                        }

                        // Section 1: Daftar Siswa Alpa (Butuh Konseling)
                        val alpaList = body.alpaStudents ?: emptyList()
                        val tvAlpaSectionHeader = TextView(this@BkActivity).apply {
                            text = "🚨 Siswa Alpa Sholat (Butuh Konseling BK): ${alpaList.size} Siswa"
                            textSize = 13f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#DC2626"))
                            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = (10 * density).toInt()
                                bottomMargin = (6 * density).toInt()
                            }
                        }
                        contentArea.addView(tvAlpaSectionHeader)

                        if (alpaList.isEmpty()) {
                            val tvAllGood = TextView(this@BkActivity).apply {
                                text = "🎉 Tidak ada siswa yang alpa sholat. Seluruh siswa terjadwal hadir tepat waktu."
                                textSize = 11f
                                setTextColor(Color.parseColor("#059669"))
                                setPadding(0, 0, 0, (10 * density).toInt())
                            }
                            contentArea.addView(tvAllGood)
                        } else {
                            alpaList.forEach { st ->
                                val cardAlpa = CardView(this@BkActivity).apply {
                                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (6 * density).toInt()
                                    }
                                    radius = 8 * density
                                    setCardBackgroundColor(Color.parseColor("#FEF2F2"))
                                }
                                val row = LinearLayout(this@BkActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    setPadding((10 * density).toInt(), (8 * density).toInt(), (10 * density).toInt(), (8 * density).toInt())
                                    gravity = android.view.Gravity.CENTER_VERTICAL
                                }
                                val colInfo = LinearLayout(this@BkActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                                }
                                val tvStName = TextView(this@BkActivity).apply {
                                    text = "${st.studentName} (${st.className})"
                                    textSize = 12f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#991B1B"))
                                }
                                val tvStNisn = TextView(this@BkActivity).apply {
                                    text = "NISN: ${st.nisn ?: "-"} • Gender: ${st.gender ?: "L"}"
                                    textSize = 10f
                                    setTextColor(Color.parseColor("#B91C1C"))
                                }
                                colInfo.addView(tvStName)
                                colInfo.addView(tvStNisn)
                                row.addView(colInfo)

                                val btnCounsel = Button(this@BkActivity).apply {
                                    text = "🕊️ Konseling"
                                    textSize = 9.5f
                                    setTextColor(Color.WHITE)
                                    setBackgroundColor(Color.parseColor("#4F46E5"))
                                    setOnClickListener {
                                        dialog.dismiss()
                                        navigateToSection(BkSection.COUNSELING)
                                        Toast.makeText(this@BkActivity, "Membuka konseling untuk ${st.studentName}", Toast.LENGTH_SHORT).show()
                                    }
                                }
                                row.addView(btnCounsel)
                                cardAlpa.addView(row)
                                contentArea.addView(cardAlpa)
                            }
                        }

                        // Section 2: Rekapitulasi Per-Kelas (33 Rombel)
                        val tvClassSectionHeader = TextView(this@BkActivity).apply {
                            text = "🏫 Rekapitulasi Kedisiplinan Sholat per-Rombel"
                            textSize = 13f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = (16 * density).toInt()
                                bottomMargin = (6 * density).toInt()
                            }
                        }
                        contentArea.addView(tvClassSectionHeader)

                        val classList = body.classBreakdown ?: emptyList()
                        classList.forEach { c ->
                            val cardCls = CardView(this@BkActivity).apply {
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = (6 * density).toInt()
                                }
                                radius = 8 * density
                                setCardBackgroundColor(if (c.isScheduledToday) Color.parseColor("#F0FDF4") else Color.parseColor("#FFFFFF"))
                            }
                            val row = LinearLayout(this@BkActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                setPadding((10 * density).toInt(), (8 * density).toInt(), (10 * density).toInt(), (8 * density).toInt())
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }
                            val colLeft = LinearLayout(this@BkActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                            }
                            val tvCName = TextView(this@BkActivity).apply {
                                text = "Kelas ${c.className}" + if (c.isScheduledToday) " ⭐ (Terjadwal Hari Ini)" else ""
                                textSize = 12f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(if (c.isScheduledToday) Color.parseColor("#15803D") else Color.parseColor("#1E293B"))
                            }
                            val tvCStats = TextView(this@BkActivity).apply {
                                text = "Siswa: ${c.totalStudents} • Sholat: ${c.sholatCount} • Keputrian/Uzur: ${c.uzurCount + c.keputrianCount} • Alpa: ${c.alpaCount}"
                                textSize = 10f
                                setTextColor(Color.parseColor("#64748B"))
                            }
                            colLeft.addView(tvCName)
                            colLeft.addView(tvCStats)
                            row.addView(colLeft)

                            val tvPct = TextView(this@BkActivity).apply {
                                text = "${c.percentage}%"
                                textSize = 13f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(if (c.percentage >= 80) Color.parseColor("#15803D") else Color.parseColor("#DC2626"))
                            }
                            row.addView(tvPct)
                            cardCls.addView(row)
                            contentArea.addView(cardCls)
                        }
                    } else {
                        val tvErr = TextView(this@BkActivity).apply {
                            text = "Gagal memuat data: ${response.message()}"
                            setTextColor(Color.RED)
                        }
                        contentArea.addView(tvErr)
                    }
                }

                override fun onFailure(call: Call<BkGlobalPrayerRecapResponse>, t: Throwable) {
                    contentArea.removeAllViews()
                    val tvErr = TextView(this@BkActivity).apply {
                        text = "Kesalahan koneksi: ${t.message}"
                        setTextColor(Color.RED)
                    }
                    contentArea.addView(tvErr)
                }
            })
        }

        spGrade.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val selected = spGrade.selectedItem.toString()
                loadData(selected)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }
}

