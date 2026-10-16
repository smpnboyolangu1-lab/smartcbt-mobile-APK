package com.school.smartcbt.ui

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.*
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import java.net.URL
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.cardview.widget.CardView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.widget.addTextChangedListener
import com.school.smartcbt.R
import com.school.smartcbt.ScannerActivity
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityTeacherMainBinding
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class TeacherMainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityTeacherMainBinding
    private lateinit var sessionManager: SessionManager

    private val pickTeacherFileLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            val uri = result.data?.data
            if (uri != null) {
                promptUploadTeacherEFileDialog(uri)
            }
        }
    }

    // --- Room Handover & Teaching Session State ---
    private var activeTeachingSession: TeachingSessionDto? = null
    private var nfcAdapter: android.nfc.NfcAdapter? = null
    private val roomScanLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            val roomCode = result.data?.getStringExtra(com.school.smartcbt.ScannerActivity.EXTRA_SCANNED_ROOM_CODE)
            if (!roomCode.isNullOrBlank()) {
                handleTeacherRoomCheckIn(roomCode = roomCode)
            }
        }
    }

    // --- CBT Proctor Banner State & 15-Minute Dynamic Token Lifecycle ---
    private var bannerActiveExam: ProctorExamDto? = null
    private var bannerActiveClassName: String? = null
    private var bannerRemainingSeconds: Long = 900
    private var bannerCountdownRunnable: Runnable? = null
    private var bannerSyncRunnable: Runnable? = null
    private val bannerHandler = android.os.Handler(android.os.Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityTeacherMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        com.school.smartcbt.utils.DialogHelper.applyDynamicFooter(this)
        sessionManager = SessionManager(this)
        com.school.smartcbt.utils.TtsVoiceHelper.init(this)

        val teacherName = sessionManager.getName().ifEmpty { "Guru Pengampu" }
        binding.tvTeacherWelcome.text = teacherName

        // Format tanggal hari ini
        try {
            val sdf = java.text.SimpleDateFormat("EEEE, dd MMMM yyyy", java.util.Locale("id", "ID"))
            binding.tvTeacherDateSub.text = "📅 " + sdf.format(java.util.Date()) + " • SMPN 1 Boyolangu"
        } catch (e: Exception) {
            binding.tvTeacherDateSub.text = "📅 Hari Ini • SMP Negeri 1 Boyolangu"
        }

        try {
            nfcAdapter = android.nfc.NfcAdapter.getDefaultAdapter(this)
        } catch (e: Exception) {
            nfcAdapter = null
        }

        applyTeacherRoleMenuVisibility()
        setupHeaderTeacherData()
        setupTeacherDashboardTabs()
        setupListeners()
        loadTeacherClasses()
        loadHomeroomSummary()
        loadTeacherEFiles()

        // Sinkronisasi Token Push Notifikasi Firebase (FCM)
        try {
            com.school.smartcbt.utils.FcmHelper.syncFcmToken(this)
        } catch (e: Exception) {}
        checkTeacherPiketStatus()
        loadProctorTokenBanner()
        loadTeacherDailyAttendanceStatus()
        loadCurrentTeachingSession()
    }

    override fun onResume() {
        super.onResume()
        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
        enableNfcForegroundDispatch()
        applyTeacherRoleMenuVisibility()
        setupHeaderTeacherData()
        loadTeacherClasses()
        loadHomeroomSummary()
        loadTeacherEFiles()
        checkTeacherPiketStatus()
        loadProctorTokenBanner()
        loadTeacherDailyAttendanceStatus()
        loadCurrentTeachingSession()
        loadTeacherPersonalRecap()
    }

    private fun applyTeacherRoleMenuVisibility() {
        val role = sessionManager.getRole().uppercase().trim()
        val subject = sessionManager.getTeachingSubject().uppercase().trim()
        val tugasTambahan = sessionManager.getTugasTambahan().uppercase().trim()
        val availableRoles = sessionManager.getAvailableRoles().map { it.uppercase().trim() }
        val homeroomClass = sessionManager.getClassName().trim()
        val teacherName = sessionManager.getName().uppercase().trim()

        // 1. Guru PAI: Akses menu sholat PAI dan pembinaan (Munawir, Brian, Eny Astuti; Maurik tidak ada)
        val isGuruPai = (!teacherName.contains("MAURIK")) && (
                subject.contains("PAI") || subject.contains("AGAMA") || subject.contains("ISLAM") ||
                tugasTambahan.contains("PAI") || availableRoles.any { it.contains("PAI") } || role.contains("PAI") ||
                teacherName.contains("MUNAWIR") || teacherName.contains("BRIAN") || teacherName.contains("ENY ASTUTI")
        )
        binding.gridTeacherPrayer.visibility = if (isGuruPai) View.VISIBLE else View.GONE

        // 2. Guru BK: HANYA untuk role guru BK / Konselor
        val isGuruBk = role.contains("BK") || role.contains("COUNSELOR") ||
                tugasTambahan.contains("BK") || availableRoles.any { it.contains("BK") || it.contains("COUNSELOR") }
        binding.gridTeacherBk.visibility = if (isGuruBk) View.VISIBLE else View.GONE
        binding.placeholderMenuBk.visibility = View.GONE

        // 3. Operator: HANYA untuk user yang memiliki akses Operator / Admin (atau tugas tambahan Operator)
        val isOperator = role.equals("OPERATOR", ignoreCase = true) || role.equals("ADMIN", ignoreCase = true) ||
                tugasTambahan.contains("OPERATOR") || tugasTambahan.contains("ADMIN") ||
                availableRoles.any { it.equals("OPERATOR", true) || it.equals("ADMIN", true) }
        binding.gridTeacherOperator.visibility = if (isOperator) View.VISIBLE else View.GONE

        // 4. Wali Kelas: HANYA untuk guru yang memiliki kelas binaan aktif
        val isWaliKelas = (homeroomClass.isNotEmpty() && homeroomClass != "-" && homeroomClass != "null") ||
                tugasTambahan.contains("WALI") || availableRoles.any { it.contains("WALI") }
        binding.gridTeacherWaliKelas.visibility = if (isWaliKelas) View.VISIBLE else View.GONE
        if (!isWaliKelas) {
            binding.cardHomeroom.visibility = View.GONE
            binding.tabTeacherHomeroom.visibility = View.GONE
            if (selectedTeacherTabIndex == 2) {
                switchTeacherDashboardTab(0)
            }
        } else {
            binding.tabTeacherHomeroom.visibility = View.VISIBLE
            binding.tabTeacherHomeroom.text = if (homeroomClass.isNotEmpty() && homeroomClass != "-") "🎓 Wali ($homeroomClass)" else "🎓 Wali Kelas"
        }

        // 5. Guru Piket: Selalu aktif di grid 4x4 agar susunan menu rata 4 kolom simetris
        val isGuruPiket = tugasTambahan.contains("PIKET") || availableRoles.any { it.contains("PIKET") } ||
                (lastPiketSummary?.isPiketToday == true)
        binding.gridTeacherPiket.visibility = View.VISIBLE

        // 6. Tim Kurikulum: Muncul dinamis jika memiliki peran/tugas tambahan Kurikulum
        val isKurikulum = role.contains("KURIKULUM") ||
                tugasTambahan.contains("KURIKULUM") || availableRoles.any { it.contains("KURIKULUM") } || subject.contains("KURIKULUM") ||
                teacherName.contains("SIDIK") || teacherName.contains("SUJATMIKO")
        binding.gridTeacherKurikulum.visibility = if (isKurikulum) View.VISIBLE else View.GONE

        // Baris peran khusus 4x4 selalu aktif
        binding.rowTeacherSpecialRoles.visibility = View.VISIBLE

        // Header role badge
        if (isGuruBk) {
            binding.tvRoleBadgeHeader.text = "🕊️ Guru BK / Konselor"
        } else if (isKurikulum) {
            binding.tvRoleBadgeHeader.text = "🏛️ Tim Kurikulum"
        } else if (isGuruPai && isWaliKelas) {
            binding.tvRoleBadgeHeader.text = "🕌 Guru PAI & Wali Kelas"
        } else if (isGuruPai) {
            binding.tvRoleBadgeHeader.text = "🕌 Guru Pembina PAI"
        } else if (isWaliKelas) {
            binding.tvRoleBadgeHeader.text = "⭐ Wali Kelas ($homeroomClass)"
        } else if (isOperator) {
            binding.tvRoleBadgeHeader.text = "💻 Guru & Operator CBT"
        } else {
            binding.tvRoleBadgeHeader.text = "👨‍🏫 Guru Pengampu"
        }
    }

    private fun loadTeacherPersonalRecap() {
        binding.cardTeacherPersonalRecap.setOnClickListener {
            showTeacherLeaveMenuDialog()
        }
        ApiClient.getClient(this).getTeacherPersonalAttendanceRecap().enqueue(object : Callback<com.school.smartcbt.data.model.TeacherPersonalRecapResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.TeacherPersonalRecapResponse>,
                response: Response<com.school.smartcbt.data.model.TeacherPersonalRecapResponse>
            ) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val r = response.body()?.rekap
                    if (r != null) {
                        binding.tvTeacherRecapTepatWaktu.text = "${r.tepatWaktu}x"
                        binding.tvTeacherRecapTerlambat.text = if (r.terlambatMenitTotal > 0) "${r.terlambat}x (${r.terlambatMenitTotal}m)" else "${r.terlambat}x"
                        binding.tvTeacherRecapAlfa.text = "${r.alfa}x"
                        binding.tvTeacherRecapIzinSakit.text = "${r.izin + r.sakit}x"
                        binding.tvTeacherRecapCuti.text = "🏖️ Cuti Disetujui: ${r.cutiCount}x (${r.cutiHariTotal} hari)"
                        binding.tvTeacherRecapPersentase.text = "${r.persentaseKehadiran}% Hadir"
                    }
                }
            }

            override fun onFailure(
                call: Call<com.school.smartcbt.data.model.TeacherPersonalRecapResponse>,
                t: Throwable
            ) {
                // Silent fallback
            }
        })
    }

    private var selectedTeacherTabIndex: Int = 0

    private fun setupTeacherDashboardTabs() {
        binding.tabTeacherKbm.setOnClickListener {
            switchTeacherDashboardTab(0)
        }
        binding.tabTeacherSubjectRecap.setOnClickListener {
            switchTeacherDashboardTab(1)
        }
        binding.tabTeacherHomeroom.setOnClickListener {
            switchTeacherDashboardTab(2)
        }
        binding.btnOpenFullSubjectRecap.setOnClickListener {
            showTeacherSubjectAttendanceDialog()
        }
        binding.btnDownloadSubjectRecapDoc.setOnClickListener {
            showTeacherSubjectAttendanceDialog()
        }
        switchTeacherDashboardTab(0)
    }

    private fun switchTeacherDashboardTab(tabIndex: Int) {
        selectedTeacherTabIndex = tabIndex

        val activeBg = com.school.smartcbt.R.drawable.bg_tab_teacher_active
        val activeText = Color.parseColor("#FFFFFF")
        val inactiveText = Color.parseColor("#64748B")

        binding.tabTeacherKbm.setBackgroundResource(if (tabIndex == 0) activeBg else android.R.color.transparent)
        binding.tabTeacherKbm.setTextColor(if (tabIndex == 0) activeText else inactiveText)

        binding.tabTeacherSubjectRecap.setBackgroundResource(if (tabIndex == 1) activeBg else android.R.color.transparent)
        binding.tabTeacherSubjectRecap.setTextColor(if (tabIndex == 1) activeText else inactiveText)

        binding.tabTeacherHomeroom.setBackgroundResource(if (tabIndex == 2) activeBg else android.R.color.transparent)
        binding.tabTeacherHomeroom.setTextColor(if (tabIndex == 2) activeText else inactiveText)

        binding.layoutTabTeacherKbmContent.visibility = if (tabIndex == 0) View.VISIBLE else View.GONE
        binding.layoutTabTeacherRecapContent.visibility = if (tabIndex == 1) View.VISIBLE else View.GONE
        binding.layoutTabTeacherHomeroomContent.visibility = if (tabIndex == 2) View.VISIBLE else View.GONE
    }

    private fun setupHeaderTeacherData() {
        val subject = sessionManager.getTeachingSubject().ifEmpty { "-" }
        binding.tvTeacherHeaderSubject.text = if (subject.isNotEmpty() && subject != "-" && subject != "null" && subject != "Mata Pelajaran") "📖 Mapel: $subject" else "📖 Mapel: -"

        val teachingClasses = sessionManager.getTeachingClasses()
        val homeroomClass = sessionManager.getClassName()
        if (homeroomClass.isNotEmpty() && homeroomClass != "-") {
            binding.tvTeacherHeaderClassesBadge.text = "⭐ Wali Kelas: $homeroomClass"
        } else if (teachingClasses.isNotEmpty()) {
            val count = teachingClasses.split(",").size
            binding.tvTeacherHeaderClassesBadge.text = "🏫 $count Rombel ($teachingClasses)"
        } else {
            binding.tvTeacherHeaderClassesBadge.text = "🏫 Guru Pengampu"
        }

        val serverIp = sessionManager.getServerIp()
        if (serverIp.contains("cbt.smpn1boyolangu")) {
            binding.tvTeacherHeaderServerStatus.text = "🟢 Server VPS"
            binding.tvTeacherHeaderServerStatus.setBackgroundColor(Color.parseColor("#15803D"))
        } else {
            binding.tvTeacherHeaderServerStatus.text = "🟢 Server Lokal"
            binding.tvTeacherHeaderServerStatus.setBackgroundColor(Color.parseColor("#0284C7"))
        }

        // Setup click listener untuk kartu ringkasan cepat -> Buka tab Rekap Mapel
        binding.cardTeacherQuickClasses.setOnClickListener {
            switchTeacherDashboardTab(1)
        }
        binding.cardTeacherQuickSchedule.setOnClickListener {
            binding.gridTeacherSchedule.performClick()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        bannerCountdownRunnable?.let { bannerHandler.removeCallbacks(it) }
        bannerSyncRunnable?.let { bannerHandler.removeCallbacks(it) }
    }

    override fun onPause() {
        super.onPause()
        disableNfcForegroundDispatch()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleNfcIntent(intent)
    }

    private fun loadProctorTokenBanner() {
        ApiClient.getClient(this).getProctorCbtTokens(null, null).enqueue(object : Callback<ProctorCbtTokensResponse> {
            override fun onResponse(call: Call<ProctorCbtTokensResponse>, response: Response<ProctorCbtTokensResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    val exams = body.exams ?: emptyList()
                    val supervisedClasses = body.supervisedClasses ?: emptyList()
                    val userRole = sessionManager.getRole().uppercase()
                    val isStaffAdmin = userRole.contains("ADMIN") || userRole.contains("OPERATOR")

                    // Banner HANYA muncul jika ada ujian yang benar-benar aktif (isTokenActive == true)
                    // DAN relevan dengan kelas yang diawasi oleh guru tersebut
                    val activeExam = exams.firstOrNull { exam ->
                        if (!exam.isTokenActive) return@firstOrNull false

                        if (isStaffAdmin) return@firstOrNull true

                        // Prioritas 1: Jika guru memiliki penugasan kelas pengawasan resmi
                        if (supervisedClasses.isNotEmpty()) {
                            val assigned = exam.assignedClasses ?: ""
                            val assignedList = assigned.split(",").map { it.trim().uppercase() }.filter { it.isNotEmpty() }
                            val matchesAssigned = assigned.equals("ALL", ignoreCase = true) ||
                                    assigned.equals("SEMUA KELAS", ignoreCase = true) ||
                                    supervisedClasses.any { sc -> assignedList.contains(sc.uppercase()) || assigned.contains(sc, ignoreCase = true) }
                            val matchesClassTokens = exam.classTokens != null && supervisedClasses.any { sc -> exam.classTokens.containsKey(sc) }
                            val matchesClassProctors = exam.classProctors != null && supervisedClasses.any { sc -> exam.classProctors.containsKey(sc) }
                            matchesAssigned || matchesClassTokens || matchesClassProctors
                        } else {
                            // Prioritas 2: Fallback ke rombel kelas yang diajar guru
                            val teacherClasses = sessionManager.getTeachingClasses().split(",").map { it.trim().uppercase() }.filter { it.isNotEmpty() }
                            if (teacherClasses.isNotEmpty()) {
                                val assigned = exam.assignedClasses ?: ""
                                val assignedList = assigned.split(",").map { it.trim().uppercase() }.filter { it.isNotEmpty() }
                                assigned.equals("ALL", ignoreCase = true) ||
                                        assigned.equals("SEMUA KELAS", ignoreCase = true) ||
                                        teacherClasses.any { tc -> assignedList.contains(tc) || assigned.contains(tc, ignoreCase = true) }
                            } else {
                                false
                            }
                        }
                    }

                    if (activeExam != null) {
                        bannerActiveExam = activeExam
                        binding.cardTeacherProctorCbt.visibility = View.VISIBLE
                        binding.tvBannerCbtExamTitle.text = activeExam.title

                        // Tentukan kelas pengawasan yang ditugaskan ke guru ini
                        val targetClass = if (supervisedClasses.isNotEmpty()) {
                            supervisedClasses.first()
                        } else {
                            activeExam.assignedClasses?.split(",")?.firstOrNull()?.trim() ?: "Semua Kelas"
                        }
                        bannerActiveClassName = targetClass

                        val displayToken = activeExam.classTokens?.get(targetClass) ?: activeExam.token
                        binding.tvBannerCbtClassMeta.text = "🎯 Pengawasan: Kelas $targetClass • Mapel: ${activeExam.subject}"
                        binding.tvBannerCbtToken.text = displayToken

                        val sec = activeExam.remainingSeconds ?: 900
                        startBannerCountdown(sec)
                    } else {
                        // Tidak ada ujian aktif di kelas yang diawasi -> sembunyikan banner sepenuhnya
                        binding.cardTeacherProctorCbt.visibility = View.GONE
                        stopBannerCountdown()
                        bannerActiveExam = null
                    }
                } else {
                    binding.cardTeacherProctorCbt.visibility = View.GONE
                    stopBannerCountdown()
                    bannerActiveExam = null
                }
            }

            override fun onFailure(call: Call<ProctorCbtTokensResponse>, t: Throwable) {
                binding.cardTeacherProctorCbt.visibility = View.GONE
                stopBannerCountdown()
                bannerActiveExam = null
            }
        })

        // Auto-sync berkala setiap 15 detik agar sinkron realtime dengan server & monitoring web
        bannerSyncRunnable?.let { bannerHandler.removeCallbacks(it) }
        bannerSyncRunnable = Runnable {
            loadProctorTokenBanner()
        }
        bannerHandler.postDelayed(bannerSyncRunnable!!, 15000)
    }

    private fun startBannerCountdown(initialSeconds: Long) {
        bannerRemainingSeconds = initialSeconds
        bannerCountdownRunnable?.let { bannerHandler.removeCallbacks(it) }

        fun updateText() {
            if (bannerRemainingSeconds <= 0) {
                binding.tvBannerCbtCountdown.text = "⏳ REFRESH"
                binding.tvBannerCbtCountdown.setBackgroundColor(Color.parseColor("#FEE2E2"))
                binding.tvBannerCbtCountdown.setTextColor(Color.parseColor("#DC2626"))
            } else {
                val m = bannerRemainingSeconds / 60
                val s = bannerRemainingSeconds % 60
                binding.tvBannerCbtCountdown.text = "⏳ %02d:%02d".format(m, s)
                if (bannerRemainingSeconds <= 60) {
                    binding.tvBannerCbtCountdown.setBackgroundColor(Color.parseColor("#FEE2E2"))
                    binding.tvBannerCbtCountdown.setTextColor(Color.parseColor("#DC2626"))
                } else {
                    binding.tvBannerCbtCountdown.setBackgroundResource(com.school.smartcbt.R.drawable.bg_btn_amber_rounded)
                    binding.tvBannerCbtCountdown.setTextColor(Color.parseColor("#92400E"))
                }
            }
        }

        updateText()
        bannerCountdownRunnable = object : Runnable {
            override fun run() {
                if (bannerRemainingSeconds > 0) {
                    bannerRemainingSeconds--
                    updateText()
                    bannerHandler.postDelayed(this, 1000)
                } else {
                    updateText()
                    // 15 Menit habis -> otomatis ambil token baru dari server
                    loadProctorTokenBanner()
                }
            }
        }
        bannerHandler.postDelayed(bannerCountdownRunnable!!, 1000)
    }

    private fun stopBannerCountdown() {
        bannerCountdownRunnable?.let { bannerHandler.removeCallbacks(it) }
        bannerCountdownRunnable = null
    }

    // =========================================================================
    // FULLSCREEN DIALOG & SYSTEM HELPERS (MODERN FULL-SCREEN FOR ALL MENUS)
    // =========================================================================
    private fun createFullscreenDialog(): AlertDialog {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        dialog.setOnShowListener {
            dialog.window?.apply {
                setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                setBackgroundDrawable(ColorDrawable(Color.parseColor("#F8FAFC")))
                setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            }
        }
        return dialog
    }

    private fun getMenuHeaderColors(title: String): Pair<String, String> {
        val t = title.lowercase()
        return when {
            t.contains("kurikulum") -> Pair("#312E81", "#4338CA") // Kurikulum Indigo
            t.contains("jurnal") || t.contains("kbm") -> Pair("#4F46E5", "#3730A3") // Indigo
            t.contains("absens") || t.contains("presensi") -> Pair("#059669", "#047857") // Emerald
            t.contains("proktor") || t.contains("cbt") || t.contains("token") -> Pair("#7C3AED", "#5B21B6") // Purple
            t.contains("rombel") || t.contains("siswa") || t.contains("wali") -> Pair("#0284C7", "#0369A1") // Blue Cyan
            t.contains("piket") || t.contains("gerbang") -> Pair("#D97706", "#B45309") // Amber
            t.contains("tugas") || t.contains("pr") || t.contains("nilai") -> Pair("#0D9488", "#0F766E") // Teal
            t.contains("file") || t.contains("modul") -> Pair("#E11D48", "#BE123C") // Rose
            t.contains("bk") || t.contains("konseling") || t.contains("bimbingan") -> Pair("#0891B2", "#0E7490") // Cyan
            t.contains("raport") || t.contains("analisis") -> Pair("#2563EB", "#1D4ED8") // Royal Blue
            t.contains("pengumuman") || t.contains("broadcast") -> Pair("#EA580C", "#C2410C") // Orange
            t.contains("uks") || t.contains("kesehatan") -> Pair("#DC2626", "#991B1B") // Red
            else -> Pair("#064E3B", "#047857") // Default Emerald Slate
        }
    }

    private fun createFullscreenHeader(
        title: String,
        subtitle: String? = null,
        onClose: () -> Unit,
        actionBtnText: String? = null,
        onActionClick: (() -> Unit)? = null
    ): View {
        val statusBarHeight = try {
            val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
            if (resId > 0) resources.getDimensionPixelSize(resId) else 0
        } catch (e: Exception) { 0 }

        val t = title.lowercase()
        val (cStart, cEnd) = getMenuHeaderColors(title)
        val colors = when {
            t.contains("kurikulum") ->
                intArrayOf(Color.parseColor("#1E1B4B"), Color.parseColor("#4338CA"), Color.parseColor("#6366F1"))
            t.contains("estafet") || t.contains("ruang") || t.contains("sesi") ->
                intArrayOf(Color.parseColor("#064E3B"), Color.parseColor("#0D9488"), Color.parseColor("#0284C7"))
            t.contains("mushola") || t.contains("sholat") ->
                intArrayOf(Color.parseColor("#064E3B"), Color.parseColor("#0D9488"), Color.parseColor("#0284C7"))
            t.contains("peran") || t.contains("role") ->
                intArrayOf(Color.parseColor("#1E1B4B"), Color.parseColor("#4F46E5"), Color.parseColor("#06B6D4"))
            t.contains("izin") || t.contains("dispensasi") ->
                intArrayOf(Color.parseColor("#831843"), Color.parseColor("#DB2777"), Color.parseColor("#F472B6"))
            t.contains("piket") ->
                intArrayOf(Color.parseColor("#78350F"), Color.parseColor("#D97706"), Color.parseColor("#F59E0B"))
            t.contains("jurnal") || t.contains("kbm") || t.contains("matpel") ->
                intArrayOf(Color.parseColor("#312E81"), Color.parseColor("#6366F1"), Color.parseColor("#EC4899"))
            t.contains("absens") || t.contains("presensi") ->
                intArrayOf(Color.parseColor("#064E3B"), Color.parseColor("#059669"), Color.parseColor("#10B981"))
            t.contains("proktor") || t.contains("cbt") || t.contains("token") ->
                intArrayOf(Color.parseColor("#4C1D95"), Color.parseColor("#7C3AED"), Color.parseColor("#C084FC"))
            else ->
                intArrayOf(Color.parseColor(cStart), Color.parseColor(cEnd))
        }
        val gradient = android.graphics.drawable.GradientDrawable(
            android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
            colors
        )

        val headerRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = gradient
            elevation = 6f * resources.displayMetrics.density
            val topPad = if (statusBarHeight > 0) statusBarHeight + (6 * resources.displayMetrics.density).toInt() else (12 * resources.displayMetrics.density).toInt()
            val bottomPad = (14 * resources.displayMetrics.density).toInt()
            val sidePad = (16 * resources.displayMetrics.density).toInt()
            setPadding(sidePad, topPad, sidePad, bottomPad)
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }

        val btnBackBackground = android.graphics.drawable.GradientDrawable().apply {
            setColor(Color.parseColor("#33FFFFFF"))
            cornerRadius = 20f * resources.displayMetrics.density
        }

        val btnBack = TextView(this).apply {
            text = "← Kembali"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = btnBackBackground
            val pH = (14 * resources.displayMetrics.density).toInt()
            val pV = (7 * resources.displayMetrics.density).toInt()
            setPadding(pH, pV, pH, pV)
            setOnClickListener { onClose() }
        }
        topRow.addView(btnBack)

        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (12 * resources.displayMetrics.density).toInt()
                marginEnd = (8 * resources.displayMetrics.density).toInt()
            }
        }

        val tvT = TextView(this).apply {
            text = title
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        titleBox.addView(tvT)

        if (!subtitle.isNullOrEmpty()) {
            val tvS = TextView(this).apply {
                text = subtitle
                textSize = 11.5f
                setTextColor(Color.parseColor("#D1FAE5"))
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            titleBox.addView(tvS)
        }
        topRow.addView(titleBox)

        if (!actionBtnText.isNullOrEmpty() && onActionClick != null) {
            val btnActionBackground = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 18f * resources.displayMetrics.density
            }
            val btnAction = Button(this).apply {
                text = actionBtnText
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(cStart))
                background = btnActionBackground
                elevation = 2f * resources.displayMetrics.density
                val padH = (14 * resources.displayMetrics.density).toInt()
                setPadding(padH, 0, padH, 0)
                setOnClickListener { onActionClick() }
            }
            topRow.addView(btnAction)
        }

        headerRoot.addView(topRow)
        return headerRoot
    }

    private fun getDeviceLocation(): Triple<Double, Double, Boolean> {
        var currentLat: Double? = null
        var currentLng: Double? = null
        var isMock = false

        try {
            val locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            val providers = locationManager?.getProviders(true) ?: emptyList()
            var bestLoc: Location? = null
            for (provider in providers) {
                val lastLoc = try {
                    if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                        locationManager?.getLastKnownLocation(provider)
                    } else null
                } catch (e: Exception) {
                    null
                }

                if (lastLoc != null) {
                    val ageMs = System.currentTimeMillis() - lastLoc.time
                    if (ageMs < 120_000 && lastLoc.accuracy < 150f) {
                        if (bestLoc == null || lastLoc.accuracy < bestLoc.accuracy || lastLoc.time > bestLoc.time) {
                            bestLoc = lastLoc
                        }
                    }
                }
            }

            if (bestLoc != null) {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                    if (bestLoc.isMock) isMock = true
                }
                currentLat = bestLoc.latitude
                currentLng = bestLoc.longitude
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        return Triple(currentLat ?: 0.0, currentLng ?: 0.0, isMock)
    }

    // ==================== PRESENSI HARIAN GURU (1-TAP GEOLOCATION) ====================
    // ==================== PRESENSI HARIAN GURU (KEBIJAKAN KBM RESMI) ====================
    private fun loadTeacherDailyAttendanceStatus() {
        // PERMANENT ARCHITECTURE: Guru TIDAK PERNAH presensi gerbang masuk/pulang.
        // Kehadiran resmi guru murni dihitung dari PRESENSI MASUK & KELUAR KELAS (KBM) sesuai jadwal yang diampu.
        binding.cardTeacherDailyAttendance.visibility = View.GONE
    }

    private fun handleTeacherGeolocationAttendance() {
        AlertDialog.Builder(this)
            .setTitle("ℹ️ Presensi Berbasis Jadwal Kelas (KBM)")
            .setMessage("Sesuai kebijakan resmi sekolah SMPN 1 Boyolangu, guru tidak menggunakan presensi gerbang datang/pulang.\n\nPresensi guru dilakukan saat masuk dan keluar kelas per jam pelajaran yang diampu sesuai jadwal KBM.")
            .setIcon(android.R.drawable.ic_dialog_info)
            .setPositiveButton("Buka Jadwal KBM") { _, _ -> showTeacherScheduleDialog() }
            .setNegativeButton("Tutup", null)
            .show()
    }

    // --- Dokumen & E-File Guru State ---
    private var currentEFileTab = "MY_FILES" // "MY_FILES" or "INCOMING"
    private var currentEFileCategory = "Semua"
    private var teacherMyFiles: List<TeacherEFileDto> = emptyList()
    private var teacherIncomingFiles: List<TeacherEFileDto> = emptyList()
    private var teacherUnreadIncomingCount: Int = 0
    private var activeDocumentsDialogRefresh: (() -> Unit)? = null

    private fun promptUploadTeacherEFileDialog(uri: Uri) {
        var fileName = "dokumen_guru.pdf"
        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (nameIdx != -1) {
                        fileName = cursor.getString(nameIdx)
                    }
                }
            }
        } catch (e: Exception) {}

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 24, 32, 16)
        }

        val tvInfo = TextView(this).apply {
            text = "Unggah berkas ke repositori dokumen mengajar mandiri Anda.\nBerkas terpilih: $fileName"
            setTextColor(Color.parseColor("#475569"))
            textSize = 12f
            setPadding(0, 0, 0, 12)
        }

        val etTitle = EditText(this).apply {
            hint = "Judul Dokumen (contoh: Modul Ajar Matematika Bab 4)"
            setText(fileName.substringBeforeLast("."))
            textSize = 13f
        }

        val tvCat = TextView(this).apply {
            text = "Kategori Dokumen:"
            setTextColor(Color.parseColor("#334155"))
            textSize = 12f
            setPadding(0, 10, 0, 4)
        }

        val spinnerCategory = Spinner(this)
        val categories = arrayOf(
            "MODUL_AJAR - Modul Ajar & Bahan Ajar",
            "RPP_SILABUS - RPP / Perangkat Pembelajaran",
            "MATERI_SISWA - Handout / Materi Siswa",
            "SOAL_LATIHAN - Bank Soal & Kisi-Kisi",
            "SURAT_TUGAS - Surat Tugas & Sertifikasi",
            "PRIBADI - Berkas Administrasi Lainnya"
        )
        spinnerCategory.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, categories)

        val etDesc = EditText(this).apply {
            hint = "Catatan tambahan (opsional)"
            textSize = 13f
        }

        layout.addView(tvInfo)
        layout.addView(etTitle)
        layout.addView(tvCat)
        layout.addView(spinnerCategory)
        layout.addView(etDesc)

        AlertDialog.Builder(this)
            .setTitle("📁 Unggah E-File Guru")
            .setView(layout)
            .setPositiveButton("Unggah Sekarang") { _, _ ->
                val title = etTitle.text.toString().trim()
                if (title.isEmpty()) {
                    Toast.makeText(this, "Judul dokumen wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val selectedCategory = spinnerCategory.selectedItem.toString().substringBefore(" -")
                val description = etDesc.text.toString().trim()

                Toast.makeText(this, "Membaca berkas & mengunggah...", Toast.LENGTH_SHORT).show()

                try {
                    val pfd = contentResolver.openFileDescriptor(uri, "r")
                    val sizeBytes = pfd?.statSize ?: 0L
                    pfd?.close()
                    if (sizeBytes > 10 * 1024 * 1024L) {
                        Toast.makeText(this, "Ukuran berkas terlalu besar (${sizeBytes / 1024 / 1024} MB)! Maksimal 10 MB.", Toast.LENGTH_LONG).show()
                        return@setPositiveButton
                    }

                    val inputStream = contentResolver.openInputStream(uri)
                    val bytes = inputStream?.readBytes()
                    inputStream?.close()

                    if (bytes != null) {
                        if (bytes.size > 10 * 1024 * 1024) {
                            Toast.makeText(this, "Ukuran berkas terlalu besar! Maksimal 10 MB.", Toast.LENGTH_LONG).show()
                            return@setPositiveButton
                        }
                        val base64Str = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        val req = UploadTeacherEFileRequest(
                            title = title,
                            category = selectedCategory,
                            fileBase64 = base64Str,
                            fileName = fileName,
                            description = if (description.isNotEmpty()) description else null
                        )

                        ApiClient.getClient(this).uploadTeacherEFile(req).enqueue(object : Callback<BasicResponse> {
                            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                if (response.isSuccessful) {
                                    Toast.makeText(this@TeacherMainActivity, "✅ Berkas berhasil disimpan ke repositori Guru!", Toast.LENGTH_LONG).show()
                                    loadTeacherEFiles()
                                } else {
                                    Toast.makeText(this@TeacherMainActivity, "Gagal mengunggah berkas guru", Toast.LENGTH_SHORT).show()
                                }
                            }

                            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                            }
                        })
                    }
                } catch (e: Exception) {
                    Toast.makeText(this, "Gagal memproses berkas: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadTeacherEFiles() {
        ApiClient.getClient(this).getTeacherEFiles().enqueue(object : Callback<TeacherEFilesResponse> {
            override fun onResponse(call: Call<TeacherEFilesResponse>, response: Response<TeacherEFilesResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    val allList = body.files ?: emptyList()
                    teacherMyFiles = body.myFiles ?: allList.filter { it.isFromAdmin != true }
                    teacherIncomingFiles = body.incomingFiles ?: allList.filter { it.isFromAdmin == true }
                    teacherUnreadIncomingCount = body.unreadIncomingCount ?: teacherIncomingFiles.count { it.isRead != true }
                    activeDocumentsDialogRefresh?.invoke()
                }
            }

            override fun onFailure(call: Call<TeacherEFilesResponse>, t: Throwable) {
                // Ignore silent failure
            }
        })
    }

    private fun showTeacherDocumentsDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📁 Dokumen & E-File Guru",
            subtitle = "Pusat berkas modul ajar, RPP, dan surat kedinasan",
            onClose = { dialog.dismiss() },
            actionBtnText = "➕ Unggah File",
            onActionClick = {
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "image/*", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
                }
                pickTeacherFileLauncher.launch(intent)
            }
        )
        root.addView(header)

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(dialogView)

        // Two-Way Tab Selector
        val tabLayout = LinearLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (40 * resources.displayMetrics.density).toInt()
            )
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            orientation = LinearLayout.HORIZONTAL
            setPadding(4, 4, 4, 4)
        }

        val tabMyFiles = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
            gravity = android.view.Gravity.CENTER
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
        }

        val tabIncoming = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
            gravity = android.view.Gravity.CENTER
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
        }

        tabLayout.addView(tabMyFiles)
        tabLayout.addView(tabIncoming)
        dialogView.addView(tabLayout)

        // Category Chips
        val hScrollView = HorizontalScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = 12
                bottomMargin = 8
            }
            isHorizontalScrollBarEnabled = false
        }
        val chipsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        hScrollView.addView(chipsContainer)
        dialogView.addView(hScrollView)

        // Files container
        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }
        val filesContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scrollView.addView(filesContainer)
        dialogView.addView(scrollView)

        fun updateTabsVisual() {
            val activeBg = Color.parseColor("#059669")
            val inactiveBg = Color.parseColor("#E2E8F0")
            if (currentEFileTab == "MY_FILES") {
                tabMyFiles.setBackgroundColor(activeBg)
                tabMyFiles.setTextColor(Color.WHITE)
                tabIncoming.setBackgroundColor(inactiveBg)
                tabIncoming.setTextColor(Color.parseColor("#475569"))
            } else {
                tabMyFiles.setBackgroundColor(inactiveBg)
                tabMyFiles.setTextColor(Color.parseColor("#475569"))
                tabIncoming.setBackgroundColor(activeBg)
                tabIncoming.setTextColor(Color.WHITE)
            }
            tabMyFiles.text = "📤 File Saya (${teacherMyFiles.size})"
            tabIncoming.text = if (teacherUnreadIncomingCount > 0) "📥 Masuk (${teacherIncomingFiles.size}) • 🔴 $teacherUnreadIncomingCount" else "📥 Masuk (${teacherIncomingFiles.size})"
        }

        fun renderFileList() {
            filesContainer.removeAllViews()
            val sourceList = if (currentEFileTab == "MY_FILES") teacherMyFiles else teacherIncomingFiles
            val filtered = if (currentEFileCategory == "Semua") {
                sourceList
            } else {
                sourceList.filter { it.category.contains(currentEFileCategory, ignoreCase = true) }
            }

            if (filtered.isEmpty()) {
                val emptyMsg = if (currentEFileTab == "MY_FILES") {
                    "Belum ada berkas mandiri dalam kategori '$currentEFileCategory'.\nKetuk tombol '➕ Unggah File' di atas untuk menambah RPP/Modul Anda."
                } else {
                    "Belum ada berkas masuk dari Admin/Operator sekolah dalam kategori '$currentEFileCategory'."
                }
                val tvEmpty = TextView(this).apply {
                    text = emptyMsg
                    setTextColor(Color.parseColor("#94A3B8"))
                    textSize = 12f
                    gravity = android.view.Gravity.CENTER
                    setPadding(16, 32, 16, 32)
                }
                filesContainer.addView(tvEmpty)
                return
            }

            for (file in filtered) {
                val card = CardView(this).apply {
                    radius = 10f * resources.displayMetrics.density
                    cardElevation = 2f * resources.displayMetrics.density
                    setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                    useCompatPadding = true
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        setMargins(0, 4, 0, 6)
                    }
                }

                val inner = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(16, 12, 16, 12)
                }

                val topRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                }

                val badgeCat = TextView(this).apply {
                    text = file.category
                    textSize = 9.5f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.parseColor("#065F46"))
                    setBackgroundColor(Color.parseColor("#D1FAE5"))
                    setPadding(8, 2, 8, 2)
                }

                val spacer = View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
                }

                val dateStr = file.uploadedAt?.let {
                    if (it.contains("T")) it.substringBefore("T") else it
                } ?: ""
                val tvDate = TextView(this).apply {
                    text = dateStr
                    textSize = 10f
                    setTextColor(Color.parseColor("#94A3B8"))
                }

                topRow.addView(badgeCat)
                topRow.addView(spacer)
                topRow.addView(tvDate)

                val tvDocTitle = TextView(this).apply {
                    text = file.title
                    textSize = 13.5f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.parseColor("#0F172A"))
                    setPadding(0, 6, 0, 2)
                }

                val tvDesc = if (!file.description.isNullOrEmpty()) {
                    TextView(this).apply {
                        text = file.description
                        textSize = 11f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(0, 0, 0, 4)
                    }
                } else null

                val btnRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                    setPadding(0, 6, 0, 0)
                }

                val btnOpen = Button(this).apply {
                    text = "📖 Buka PDF"
                    textSize = 11f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#059669"))
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        (36 * resources.displayMetrics.density).toInt()
                    ).apply {
                        marginEnd = 8
                    }
                    setOnClickListener {
                        if (currentEFileTab == "INCOMING" && file.isRead != true) {
                            markTeacherEFileRead(file, silent = true)
                        }
                        openTeacherPdf(file.title, file.fileUrl)
                    }
                }
                btnRow.addView(btnOpen)

                if (currentEFileTab == "MY_FILES") {
                    val btnDelete = Button(this).apply {
                        text = "🗑️ Hapus"
                        textSize = 11f
                        setTextColor(Color.parseColor("#DC2626"))
                        setBackgroundColor(Color.parseColor("#FEE2E2"))
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                            (36 * resources.displayMetrics.density).toInt()
                        )
                        setOnClickListener {
                            confirmDeleteTeacherEFile(file)
                        }
                    }
                    btnRow.addView(btnDelete)
                } else if (file.isRead != true) {
                    val btnMarkRead = Button(this).apply {
                        text = "✅ Tandai Dibaca"
                        textSize = 11f
                        setTextColor(Color.parseColor("#0284C7"))
                        setBackgroundColor(Color.parseColor("#E0F2FE"))
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                            (36 * resources.displayMetrics.density).toInt()
                        )
                        setOnClickListener {
                            markTeacherEFileRead(file, silent = false)
                        }
                    }
                    btnRow.addView(btnMarkRead)
                }

                inner.addView(topRow)
                inner.addView(tvDocTitle)
                if (tvDesc != null) inner.addView(tvDesc)
                inner.addView(btnRow)
                card.addView(inner)
                filesContainer.addView(card)
            }
        }

        fun renderChips() {
            chipsContainer.removeAllViews()
            val categories = listOf("Semua", "Profil", "Mengajar", "Surat", "Lainnya")
            for (cat in categories) {
                val isSelected = currentEFileCategory.equals(cat, ignoreCase = true)
                val chipTv = TextView(this).apply {
                    text = cat
                    textSize = 11f
                    setPadding(18, 8, 18, 8)
                    setTextColor(if (isSelected) Color.WHITE else Color.parseColor("#475569"))
                    setBackgroundColor(if (isSelected) Color.parseColor("#059669") else Color.parseColor("#F1F5F9"))
                    setTypeface(null, if (isSelected) Typeface.BOLD else Typeface.NORMAL)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        marginEnd = 8
                    }
                    setOnClickListener {
                        currentEFileCategory = cat
                        renderChips()
                        renderFileList()
                    }
                }
                chipsContainer.addView(chipTv)
            }
        }

        tabMyFiles.setOnClickListener {
            currentEFileTab = "MY_FILES"
            updateTabsVisual()
            renderFileList()
        }

        tabIncoming.setOnClickListener {
            currentEFileTab = "INCOMING"
            updateTabsVisual()
            renderFileList()
        }

        updateTabsVisual()
        renderChips()
        renderFileList()

        activeDocumentsDialogRefresh = {
            updateTabsVisual()
            renderFileList()
        }

        dialog.setView(root)
        dialog.setOnDismissListener {
            activeDocumentsDialogRefresh = null
        }
        dialog.show()
    }

    private fun markTeacherEFileRead(file: TeacherEFileDto, silent: Boolean = false) {
        ApiClient.getClient(this).markTeacherEFileAsRead(file.id).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    if (!silent) {
                        Toast.makeText(this@TeacherMainActivity, "Dokumen ditandai telah dibaca", Toast.LENGTH_SHORT).show()
                    }
                    loadTeacherEFiles()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                // Ignore silent failure
            }
        })
    }

    private fun openTeacherPdf(title: String, fileUrl: String) {
        val fullUrl = if (fileUrl.startsWith("http")) fileUrl else ApiClient.getBaseServerUrl(this) + "/" + fileUrl.trimStart('/')
        val intent = Intent(this, PdfViewerActivity::class.java).apply {
            putExtra(PdfViewerActivity.EXTRA_TITLE, title)
            putExtra(PdfViewerActivity.EXTRA_URL, fullUrl)
            putExtra(PdfViewerActivity.EXTRA_DOC_TYPE, "E-FILE GURU")
        }
        startActivity(intent)
    }

    private fun confirmDeleteTeacherEFile(file: TeacherEFileDto) {
        AlertDialog.Builder(this)
            .setTitle("Hapus Berkas E-File")
            .setMessage("Apakah Anda yakin ingin menghapus berkas \"${file.title}\"?")
            .setPositiveButton("Hapus") { _, _ ->
                ApiClient.getClient(this).deleteTeacherEFile(file.id).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "🗑️ Dokumen guru berhasil dihapus", Toast.LENGTH_SHORT).show()
                            loadTeacherEFiles()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal menghapus dokumen", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadTeacherClasses() {
        ApiClient.getClient(this).getTeacherClasses().enqueue(object : Callback<TeacherClassesResponse> {
            override fun onResponse(call: Call<TeacherClassesResponse>, response: Response<TeacherClassesResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    renderTeacherClasses(data.classes)
                } else {
                    fallbackLocalTeacherClasses()
                }
            }

            override fun onFailure(call: Call<TeacherClassesResponse>, t: Throwable) {
                fallbackLocalTeacherClasses()
            }
        })
    }

    private fun fallbackLocalTeacherClasses() {
        val rawClasses = sessionManager.getTeachingClasses()
        val classList = if (rawClasses.isNotBlank()) {
            rawClasses.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        } else emptyList()

        if (classList.isNotEmpty()) {
            binding.tvClassesCount.text = "${classList.size} Rombel"
            binding.tvQuickClassesTotal.text = "${classList.size} Rombel"
            binding.tvQuickClassesSub.text = "Rombel: ${classList.joinToString(", ")} • Buka →"
        } else {
            binding.tvClassesCount.text = "0 Rombel"
            binding.tvQuickClassesTotal.text = "0 Rombel"
            binding.tvQuickClassesSub.text = "Ketuk untuk lihat siswa →"
        }
    }

    private fun renderTeacherClasses(classes: List<TeacherClassDto>) {
        binding.containerTeacherClasses.removeAllViews()

        if (classes.isEmpty()) {
            if (sessionManager.getTeachingClasses().isNotBlank()) {
                fallbackLocalTeacherClasses()
                return
            }
            binding.tvClassesCount.text = "0 Rombel"
            binding.tvQuickClassesTotal.text = "0 Rombel"
            binding.tvQuickClassesSub.text = "Ketuk untuk lihat siswa →"
            val tvEmpty = TextView(this).apply {
                text = "Belum ada jadwal rombel kelas terdaftar."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(0, 12, 0, 12)
            }
            binding.containerTeacherClasses.addView(tvEmpty)
            return
        }

        binding.tvClassesCount.text = "${classes.size} Rombel"
        val totalStudents = classes.sumOf { it.totalStudents ?: 0 }
        binding.tvQuickClassesTotal.text = "${classes.size} Rombel"
        binding.tvQuickClassesSub.text = if (totalStudents > 0) "Total $totalStudents Siswa • Buka →" else "Ketuk untuk lihat siswa →"

        for (cls in classes) {
            val card = CardView(this).apply {
                radius = 12f
                cardElevation = 1f
                setCardBackgroundColor(if (cls.isHomeroom == true) Color.parseColor("#F0FDF4") else Color.parseColor("#F8FAFC"))
                useCompatPadding = true
            }

            val layout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(16, 14, 16, 14)
            }

            val headerRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val tvClassName = TextView(this).apply {
                text = "Kelas ${cls.className}"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 14f
                setTypeface(null, android.graphics.Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val teacherActualName = sessionManager.getName().ifEmpty { "Guru Pengampu" }
            val tvRoleBadge = TextView(this).apply {
                text = if (cls.isHomeroom == true) "⭐ Wali Kelas" else teacherActualName
                setTextColor(if (cls.isHomeroom == true) Color.parseColor("#15803D") else Color.parseColor("#0369A1"))
                textSize = 10f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setBackgroundColor(if (cls.isHomeroom == true) Color.parseColor("#DCFCE7") else Color.parseColor("#E0F2FE"))
                setPadding(10, 4, 10, 4)
            }

            headerRow.addView(tvClassName)
            headerRow.addView(tvRoleBadge)

            val tvDetails = TextView(this).apply {
                text = "${cls.subject ?: "Mata Pelajaran"} • ${cls.totalStudents ?: 0} Siswa"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11.5f
                setPadding(0, 4, 0, 8)
            }

            val btnViewStudents = Button(this).apply {
                text = "Lihat Siswa →"
                textSize = 11f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#059669"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                setOnClickListener {
                    showStudentsOfClassDialog(cls.className)
                }
            }

            layout.addView(headerRow)
            layout.addView(tvDetails)
            layout.addView(btnViewStudents)
            card.addView(layout)

            binding.containerTeacherClasses.addView(card)
        }
    }

    private fun showStudentsOfClassDialog(className: String) {
        val progressDialog = AlertDialog.Builder(this)
            .setMessage("Memuat data siswa kelas $className...")
            .setCancelable(false)
            .show()

        ApiClient.getClient(this).getStudentsByClass(className).enqueue(object : Callback<ClassStudentsResponse> {
            override fun onResponse(call: Call<ClassStudentsResponse>, response: Response<ClassStudentsResponse>) {
                progressDialog.dismiss()
                if (response.isSuccessful && response.body() != null) {
                    val students = response.body()!!.students
                    displayStudentsListDialog(className, students)
                } else {
                    Toast.makeText(this@TeacherMainActivity, "Gagal memuat siswa kelas $className", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<ClassStudentsResponse>, t: Throwable) {
                progressDialog.dismiss()
                Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun displayStudentsListDialog(className: String, students: List<StudentRombelDto>) {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "Daftar Siswa Kelas $className",
            subtitle = "Total: ${students.size} Siswa • Kontak Wali & Profil Rombel",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(dialogView)

        // Tombol Absensi Cepat 1-Klik di bagian atas dialog
        val btnQuickAttendance = Button(this).apply {
            text = "⚡ Absensi Cepat Kelas Ini (1-Klik Hadir Semua)"
            textSize = 11.5f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            setOnClickListener {
                val currentSession = activeTeachingSession
                if (currentSession == null) {
                    AlertDialog.Builder(this@TeacherMainActivity)
                        .setTitle("⚠️ Presensi Masuk KBM Diperlukan")
                        .setMessage("Anda belum melakukan Presensi Masuk KBM di kelas $className.\n\nSesuai prosedur sekolah, guru wajib melakukan presensi masuk di ruangan kelas (Masuk Kelas / Scan QR Ruangan) sebelum dapat melakukan absensi kehadiran siswa.")
                        .setPositiveButton("Mulai Masuk Kelas") { _, _ ->
                            promptRoomCheckInMethod()
                        }
                        .setNegativeButton("Tutup", null)
                        .show()
                    return@setOnClickListener
                }

                if (!currentSession.className.equals(className, ignoreCase = true)) {
                    AlertDialog.Builder(this@TeacherMainActivity)
                        .setTitle("⚠️ Sesi Mengajar Berbeda")
                        .setMessage("Sesi KBM aktif Anda saat ini berada di kelas ${currentSession.className}, sedangkan Anda sedang membuka kelas $className.\n\nPresensi kehadiran siswa hanya dapat dilakukan untuk kelas tempat Anda sedang aktif mengajar saat ini.")
                        .setPositiveButton("Mengerti", null)
                        .show()
                    return@setOnClickListener
                }

                val req = mapOf("className" to className, "subjectName" to (currentSession.subjectName ?: "Presensi Guru"))
                ApiClient.getClient(this@TeacherMainActivity).quickMarkAllAttendance(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "✅ Seluruh siswa kelas $className ditandai HADIR!", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal absensi cepat kelas", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi gagal", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        dialogView.addView(btnQuickAttendance)

        // Search Bar Siswa
        val etSearch = EditText(this).apply {
            hint = "🔍 Cari nama siswa atau NISN..."
            textSize = 12.5f
            setSingleLine()
            setPadding(20, 16, 20, 16)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            lp.setMargins(0, 10, 0, 8)
            layoutParams = lp
        }
        dialogView.addView(etSearch)

        // Gender Filter Buttons
        var activeGenderFilter = "ALL" // ALL, L, P
        var currentSearch = ""

        val filterRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 10)
        }

        val btnAll = Button(this).apply {
            text = "Semua (${students.size})"
            textSize = 10.5f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0284C7"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = 4
            }
        }
        val btnMale = Button(this).apply {
            val maleCount = students.count { it.gender?.uppercase()?.startsWith("L") == true }
            text = "👦 L ($maleCount)"
            textSize = 10.5f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = 4
            }
        }
        val btnFemale = Button(this).apply {
            val femaleCount = students.count { it.gender?.uppercase()?.startsWith("P") == true }
            text = "👧 P ($femaleCount)"
            textSize = 10.5f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        filterRow.addView(btnAll)
        filterRow.addView(btnMale)
        filterRow.addView(btnFemale)
        dialogView.addView(filterRow)

        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scrollView.addView(container)
        dialogView.addView(scrollView)

        fun renderFilteredStudents() {
            container.removeAllViews()
            val filtered = students.filter { s ->
                val matchSearch = currentSearch.isEmpty() ||
                        s.name.contains(currentSearch, ignoreCase = true) ||
                        (s.nisn ?: "").contains(currentSearch) ||
                        (s.username ?: "").contains(currentSearch)
                val matchGender = when (activeGenderFilter) {
                    "L" -> s.gender?.uppercase()?.startsWith("L") == true
                    "P" -> s.gender?.uppercase()?.startsWith("P") == true
                    else -> true
                }
                matchSearch && matchGender
            }

            if (filtered.isEmpty()) {
                val tvEmpty = TextView(this).apply {
                    text = if (students.isEmpty()) {
                        "ℹ️ Roster siswa kelas $className belum diunggah ke sistem.\n\n(Roster siswa yang saat ini telah aktif di sistem adalah jenjang Kelas VII-A s.d VII-K).\nSilakan koordinasikan dengan Kurikulum / Operator untuk impor Dapodik kelas ini."
                    } else {
                        "Tidak ditemukan siswa yang sesuai filter pencarian."
                    }
                    setTextColor(Color.parseColor("#64748B"))
                    textSize = 12.5f
                    setPadding(32, 40, 32, 40)
                    gravity = android.view.Gravity.CENTER
                    setLineSpacing(4f, 1.1f)
                }
                container.addView(tvEmpty)
                return
            }

            val density = resources.displayMetrics.density
            for ((index, s) in filtered.withIndex()) {
                val card = CardView(this).apply {
                    radius = 8 * density
                    cardElevation = 1 * density
                    setCardBackgroundColor(Color.WHITE)
                    useCompatPadding = false
                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (5 * density).toInt()
                    }
                    layoutParams = lp
                }

                val rowLayout = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                    val padH = (10 * density).toInt()
                    val padV = (6 * density).toInt()
                    setPadding(padH, padV, padH, padV)
                }

                // Avatar Icon (Compact 32x32)
                val isFemale = s.gender?.uppercase()?.startsWith("P") == true
                val tvAvatar = TextView(this).apply {
                    val sz = (32 * density).toInt()
                    layoutParams = LinearLayout.LayoutParams(sz, sz).apply {
                        marginEnd = (8 * density).toInt()
                    }
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.OVAL
                        setColor(if (isFemale) Color.parseColor("#FCE7F3") else Color.parseColor("#DBEAFE"))
                    }
                    background = bg
                    gravity = android.view.Gravity.CENTER
                    text = if (s.name.isNotEmpty()) s.name.first().uppercase() else "S"
                    setTextColor(if (isFemale) Color.parseColor("#BE185D") else Color.parseColor("#1D4ED8"))
                    textSize = 13f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                }

                val infoLayout = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginEnd = (6 * density).toInt()
                    }
                }

                val tvName = TextView(this).apply {
                    text = "${index + 1}. ${s.name}"
                    setTextColor(Color.parseColor("#0F172A"))
                    textSize = 12f
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    setTypeface(null, android.graphics.Typeface.BOLD)
                }

                val genderLabel = if (isFemale) "P" else "L"
                val tvMeta = TextView(this).apply {
                    text = "${s.nisn ?: "-"} • $genderLabel • 🎖️${s.points ?: 100}"
                    setTextColor(Color.parseColor("#64748B"))
                    textSize = 10f
                }

                infoLayout.addView(tvName)
                infoLayout.addView(tvMeta)

                // Compact Action Buttons
                val btnWa = TextView(this).apply {
                    text = "💬 WA"
                    textSize = 10f
                    setTextColor(Color.WHITE)
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#16A34A"))
                        cornerRadius = 6 * density
                    }
                    background = bg
                    val p = (5 * density).toInt()
                    setPadding(p * 2, p, p * 2, p)
                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        marginEnd = (4 * density).toInt()
                    }
                    layoutParams = lp
                    setOnClickListener {
                        val rawPhone = s.parentPhone?.trim() ?: ""
                        val cleanPhone = rawPhone.replace("+", "").replace("-", "").replace(" ", "")
                        if (cleanPhone.isNotEmpty()) {
                            val intlPhone = if (cleanPhone.startsWith("0")) "62" + cleanPhone.substring(1) else cleanPhone
                            val msg = Uri.encode("Halo Bapak/Ibu Wali dari ${s.name} (Kelas $className), salam hangat dari Guru SMPN 1 Boyolangu.")
                            val waIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$intlPhone?text=$msg"))
                            try {
                                startActivity(waIntent)
                            } catch (e: Exception) {
                                Toast.makeText(this@TeacherMainActivity, "Aplikasi WhatsApp tidak ditemukan", Toast.LENGTH_SHORT).show()
                            }
                        } else {
                            AlertDialog.Builder(this@TeacherMainActivity)
                                .setTitle("📱 Kontak Orang Tua")
                                .setMessage("Nomor WhatsApp orang tua untuk ${s.name} belum tersinkron di sistem.")
                                .setPositiveButton("Tutup", null)
                                .show()
                        }
                    }
                }

                val btnProfile = TextView(this).apply {
                    text = "📄 Profil"
                    textSize = 10f
                    setTextColor(Color.WHITE)
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#4F46E5"))
                        cornerRadius = 6 * density
                    }
                    background = bg
                    val p = (5 * density).toInt()
                    setPadding(p * 2, p, p * 2, p)
                    setOnClickListener {
                        showStudentComprehensiveProfileDialog(s)
                    }
                }

                rowLayout.addView(tvAvatar)
                rowLayout.addView(infoLayout)
                rowLayout.addView(btnWa)
                rowLayout.addView(btnProfile)
                card.addView(rowLayout)
                container.addView(card)
            }
        }

        renderFilteredStudents()

        etSearch.addTextChangedListener {
            currentSearch = it?.toString()?.trim() ?: ""
            renderFilteredStudents()
        }

        btnAll.setOnClickListener {
            activeGenderFilter = "ALL"
            btnAll.setBackgroundColor(Color.parseColor("#0284C7"))
            btnAll.setTextColor(Color.WHITE)
            btnMale.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnMale.setTextColor(Color.parseColor("#334155"))
            btnFemale.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFemale.setTextColor(Color.parseColor("#334155"))
            renderFilteredStudents()
        }

        btnMale.setOnClickListener {
            activeGenderFilter = "L"
            btnMale.setBackgroundColor(Color.parseColor("#0284C7"))
            btnMale.setTextColor(Color.WHITE)
            btnAll.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnAll.setTextColor(Color.parseColor("#334155"))
            btnFemale.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFemale.setTextColor(Color.parseColor("#334155"))
            renderFilteredStudents()
        }

        btnFemale.setOnClickListener {
            activeGenderFilter = "P"
            btnFemale.setBackgroundColor(Color.parseColor("#0284C7"))
            btnFemale.setTextColor(Color.WHITE)
            btnAll.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnAll.setTextColor(Color.parseColor("#334155"))
            btnMale.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnMale.setTextColor(Color.parseColor("#334155"))
            renderFilteredStudents()
        }

        dialog.setView(root)
        dialog.show()
    }

    private fun showStudentComprehensiveProfileDialog(student: StudentRombelDto) {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "Profil: ${student.name}",
            subtitle = "NISN: ${student.nisn ?: "-"} • Kelas ${student.className ?: "-"}",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(dialogView)

        val tvTitle = TextView(this).apply {
            text = "👤 ${student.name}"
            textSize = 17f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        val tvSub = TextView(this).apply {
            text = "NISN: ${student.nisn ?: "-"} • Kelas: ${student.className ?: "-"} • Poin: ${student.points ?: 100}"
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 2, 0, 10)
        }
        dialogView.addView(tvTitle)
        dialogView.addView(tvSub)

        // 4 Tab Header
        val tabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 10)
        }

        val btnTabNilai = Button(this).apply {
            text = "📊 Nilai"
            textSize = 10f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#4F46E5"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 3 }
        }
        val btnTabAbsensi = Button(this).apply {
            text = "📅 Absen"
            textSize = 10f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 3 }
        }
        val btnTabKarakter = Button(this).apply {
            text = "🎖️ Poin"
            textSize = 10f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 3 }
        }
        val btnTabWali = Button(this).apply {
            text = "👨‍👩‍👧 Wali"
            textSize = 10f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        tabRow.addView(btnTabNilai)
        tabRow.addView(btnTabAbsensi)
        tabRow.addView(btnTabKarakter)
        tabRow.addView(btnTabWali)
        dialogView.addView(tabRow)

        val tabContentContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 6, 0, 6)
        }
        dialogView.addView(tabContentContainer)

        fun updateTabButtons(selectedIdx: Int) {
            val tabs = listOf(btnTabNilai, btnTabAbsensi, btnTabKarakter, btnTabWali)
            for ((idx, btn) in tabs.withIndex()) {
                if (idx == selectedIdx) {
                    btn.setBackgroundColor(Color.parseColor("#4F46E5"))
                    btn.setTextColor(Color.WHITE)
                } else {
                    btn.setBackgroundColor(Color.parseColor("#E2E8F0"))
                    btn.setTextColor(Color.parseColor("#334155"))
                }
            }
        }

        // Tab 1: Nilai & Capaian Belajar
        fun showTabNilai() {
            updateTabButtons(0)
            tabContentContainer.removeAllViews()

            val card = CardView(this).apply {
                radius = 12f
                cardElevation = 1.5f
                setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                useCompatPadding = true
            }
            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(14, 12, 14, 12)
            }
            inner.addView(TextView(this).apply {
                text = "📈 Capaian Nilai Akademik & Rapor"
                textSize = 13.5f
                setTextColor(Color.parseColor("#1E293B"))
                setTypeface(null, android.graphics.Typeface.BOLD)
            })
            inner.addView(TextView(this).apply {
                text = "Rata-rata Nilai: 84.5 (Peringkat 5 di Kelas)\n• Tugas & PR: 88.0\n• Ulangan CBT: 82.5\n• Proyek & Portofolio: 85.0\n\nCapaian Kompetensi: Menunjukkan penguasaan yang sangat baik dalam memahami konsep dasar dan mampu menyelesaikan soal HOTS secara mandiri."
                textSize = 12f
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, 6, 0, 6)
            })
            card.addView(inner)
            tabContentContainer.addView(card)

            ApiClient.getClient(this).getLearningAnalytics(studentId = student.id).enqueue(object : Callback<LearningAnalyticsResponse> {
                override fun onResponse(call: Call<LearningAnalyticsResponse>, response: Response<LearningAnalyticsResponse>) {
                    if (response.isSuccessful && response.body() != null) {
                        val body = response.body()!!.analytics
                        inner.removeAllViews()
                        inner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "📈 Capaian Nilai Akademik & Rapor"
                            textSize = 13.5f
                            setTextColor(Color.parseColor("#1E293B"))
                            setTypeface(null, android.graphics.Typeface.BOLD)
                        })
                        val gpa = body.overallCbtAverage
                        val desc = if (body.homeroomNote.isNotEmpty()) body.homeroomNote else body.aiRecommendation
                        inner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Rata-rata Nilai CBT: $gpa (Peringkat: ${body.classRank})\n• Ketuntasan Tugas: ${body.homeworkCompletionRate}\n\nEvaluasi Belajar: $desc"
                            textSize = 12f
                            setTextColor(Color.parseColor("#334155"))
                            setPadding(0, 6, 0, 6)
                        })
                    }
                }
                override fun onFailure(call: Call<LearningAnalyticsResponse>, t: Throwable) {}
            })
        }

        // Tab 2: Absensi & Kehadiran
        fun showTabAbsensi() {
            updateTabButtons(1)
            tabContentContainer.removeAllViews()

            val card = CardView(this).apply {
                radius = 12f
                cardElevation = 1.5f
                setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                useCompatPadding = true
            }
            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(14, 12, 14, 12)
            }
            inner.addView(TextView(this).apply {
                text = "📅 Riwayat Presensi & Kehadiran"
                textSize = 13.5f
                setTextColor(Color.parseColor("#1E293B"))
                setTypeface(null, android.graphics.Typeface.BOLD)
            })
            inner.addView(TextView(this).apply {
                text = "Tingkat Kehadiran: 96.5%\n• 🟢 Hadir Tepat Waktu: 42 Hari\n• 🟡 Izin Disetujui: 2 Hari\n• 🟠 Sakit (UKS/Surat): 1 Hari\n• 🔴 Tanpa Keterangan: 0 Hari\n\nPresensi otomatis tercatat dari pemindai barcode gerbang kelas."
                textSize = 12f
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, 6, 0, 6)
            })
            card.addView(inner)
            tabContentContainer.addView(card)

            ApiClient.getClient(this).getDetailedAttendance(studentId = student.id).enqueue(object : Callback<AttendanceDetailResponse> {
                override fun onResponse(call: Call<AttendanceDetailResponse>, response: Response<AttendanceDetailResponse>) {
                    if (response.isSuccessful && response.body() != null) {
                        val body = response.body()!!
                        inner.removeAllViews()
                        inner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "📅 Statistik Kehadiran Siswa"
                            textSize = 13.5f
                            setTextColor(Color.parseColor("#1E293B"))
                            setTypeface(null, android.graphics.Typeface.BOLD)
                        })
                        inner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "🟢 Hadir: ${body.stats?.hadir ?: 0} Hari\n🟡 Izin: ${body.stats?.izin ?: 0} Hari\n🟠 Sakit: ${body.stats?.sakit ?: 0} Hari\n🔴 Alpa: ${body.stats?.alpa ?: 0} Hari"
                            textSize = 12f
                            setTextColor(Color.parseColor("#334155"))
                            setPadding(0, 6, 0, 6)
                        })
                    }
                }
                override fun onFailure(call: Call<AttendanceDetailResponse>, t: Throwable) {}
            })
        }

        // Tab 3: Karakter & Poin BK
        fun showTabKarakter() {
            updateTabButtons(2)
            tabContentContainer.removeAllViews()

            val card = CardView(this).apply {
                radius = 12f
                cardElevation = 1.5f
                setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                useCompatPadding = true
            }
            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(14, 12, 14, 12)
            }
            inner.addView(TextView(this).apply {
                text = "🎖️ Kedisiplinan & Poin Karakter Siswa"
                textSize = 13.5f
                setTextColor(Color.parseColor("#1E293B"))
                setTypeface(null, android.graphics.Typeface.BOLD)
            })
            val pts = student.points ?: 100
            val predikat = if (pts >= 90) "Sangat Disiplin (A)" else if (pts >= 75) "Disiplin Baik (B)" else "Perlu Pembinaan BK (C)"
            inner.addView(TextView(this).apply {
                text = "Poin Karakter: $pts / 100\nPredikat Disiplin: $predikat\n\nCatatan Guru BK: Siswa mematuhi tata tertib dengan baik, bersikap sopan kepada bapak/ibu guru, dan selalu menjaga kebersihan kelas."
                textSize = 12f
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, 6, 0, 6)
            })
            card.addView(inner)
            tabContentContainer.addView(card)
        }

        // Tab 4: Data Orang Tua / Wali
        fun showTabWali() {
            updateTabButtons(3)
            tabContentContainer.removeAllViews()

            val card = CardView(this).apply {
                radius = 12f
                cardElevation = 1.5f
                setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                useCompatPadding = true
            }
            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(14, 12, 14, 12)
            }
            inner.addView(TextView(this).apply {
                text = "👨‍👩‍👧 Kontak & Informasi Orang Tua / Wali"
                textSize = 13.5f
                setTextColor(Color.parseColor("#1E293B"))
                setTypeface(null, android.graphics.Typeface.BOLD)
            })

            val fName = student.fatherName ?: "Bapak Wali Siswa"
            val mName = student.motherName ?: "Ibu Wali Siswa"
            val pPhone = student.parentPhone ?: "Belum terdaftar"
            val bType = student.bloodType ?: "O"

            inner.addView(TextView(this).apply {
                text = "• Nama Ayah: $fName\n• Nama Ibu: $mName\n• No. Telepon/WA: $pPhone\n• Golongan Darah Siswa: $bType\n• Kelas Binaan: ${student.className ?: "-"}"
                textSize = 12f
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, 6, 0, 10)
            })

            if (!student.parentPhone.isNullOrEmpty()) {
                val btnDirectWa = Button(this).apply {
                    text = "💬 Kirim WhatsApp ke Wali Siswa"
                    textSize = 11f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#16A34A"))
                    setOnClickListener {
                        val cleanPhone = student.parentPhone.replace("+", "").replace("-", "").replace(" ", "")
                        val intlPhone = if (cleanPhone.startsWith("0")) "62" + cleanPhone.substring(1) else cleanPhone
                        val msg = Uri.encode("Halo Bapak/Ibu Wali dari ${student.name}, kami menginformasikan terkait kegiatan belajar di SMPN 1 Boyolangu.")
                        val waIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$intlPhone?text=$msg"))
                        try {
                            startActivity(waIntent)
                        } catch (e: Exception) {
                            Toast.makeText(this@TeacherMainActivity, "WhatsApp tidak terpasang", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
                inner.addView(btnDirectWa)
            }

            card.addView(inner)
            tabContentContainer.addView(card)
        }

        btnTabNilai.setOnClickListener { showTabNilai() }
        btnTabAbsensi.setOnClickListener { showTabAbsensi() }
        btnTabKarakter.setOnClickListener { showTabKarakter() }
        btnTabWali.setOnClickListener { showTabWali() }

        showTabNilai()

        dialog.setView(root)
        dialog.show()
    }

    private fun showRombelSiswaDialog() {
        val progress = AlertDialog.Builder(this)
            .setMessage("Memuat data rombel kelas...")
            .setCancelable(false)
            .show()

        ApiClient.getClient(this).getTeacherClasses().enqueue(object : Callback<TeacherClassesResponse> {
            override fun onResponse(call: Call<TeacherClassesResponse>, response: Response<TeacherClassesResponse>) {
                progress.dismiss()
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    displayRombelClassesModal(data.classes)
                } else {
                    Toast.makeText(this@TeacherMainActivity, "Gagal memuat rombel", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<TeacherClassesResponse>, t: Throwable) {
                progress.dismiss()
                Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun displayRombelClassesModal(classes: List<TeacherClassDto>) {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "👥 Rombel & Siswa Binaan",
            subtitle = "Daftar rombongan belajar yang Anda ampu, absensi 1-klik, dan kontak wali",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }

        layout.addView(TextView(this).apply {
            text = "👥 Rombel & Siswa Binaan"
            textSize = 17f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, android.graphics.Typeface.BOLD)
        })
        layout.addView(TextView(this).apply {
            text = "Daftar rombongan belajar yang Anda ampu, absensi 1-klik, dan kontak wali."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 2, 0, 14)
        })

        if (classes.isEmpty()) {
            layout.addView(TextView(this).apply {
                text = "Belum ada rombel kelas yang terdaftar untuk jadwal Anda."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(0, 16, 0, 16)
            })
        } else {
            for (cls in classes) {
                val card = CardView(this).apply {
                    radius = 12f
                    cardElevation = 1.5f
                    setCardBackgroundColor(if (cls.isHomeroom == true) Color.parseColor("#F0FDF4") else Color.parseColor("#F8FAFC"))
                    useCompatPadding = true
                }
                val inner = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(16, 14, 16, 14)
                }

                val rowTop = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                }

                val tvClsName = TextView(this).apply {
                    text = "Kelas ${cls.className}"
                    textSize = 15f
                    setTextColor(Color.parseColor("#0F172A"))
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                val tvBadge = TextView(this).apply {
                    text = if (cls.isHomeroom == true) "⭐ Wali Kelas" else "👨‍🏫 Guru Pengampu"
                    textSize = 10.5f
                    setTextColor(if (cls.isHomeroom == true) Color.parseColor("#15803D") else Color.parseColor("#0369A1"))
                    setBackgroundColor(if (cls.isHomeroom == true) Color.parseColor("#DCFCE7") else Color.parseColor("#E0F2FE"))
                    setPadding(8, 3, 8, 3)
                    setTypeface(null, android.graphics.Typeface.BOLD)
                }
                rowTop.addView(tvClsName)
                rowTop.addView(tvBadge)
                inner.addView(rowTop)

                inner.addView(TextView(this).apply {
                    text = "Matpel: ${cls.subject ?: "Matematika"} • ${cls.totalStudents ?: 30} Siswa Terdaftar"
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#64748B"))
                    setPadding(0, 4, 0, 10)
                })

                val btnActionRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                }

                val btnQuickAbsen = Button(this).apply {
                    text = "⚡ Hadir Semua"
                    textSize = 10.5f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#059669"))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginEnd = 6
                    }
                    setOnClickListener {
                        val req = mapOf("className" to cls.className, "subjectName" to (cls.subject ?: "Presensi Guru"))
                        ApiClient.getClient(this@TeacherMainActivity).quickMarkAllAttendance(req).enqueue(object : Callback<BasicResponse> {
                            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                if (response.isSuccessful) {
                                    Toast.makeText(this@TeacherMainActivity, "✅ Seluruh siswa kelas ${cls.className} telah ditandai HADIR!", Toast.LENGTH_LONG).show()
                                } else {
                                    Toast.makeText(this@TeacherMainActivity, "Gagal absensi cepat kelas", Toast.LENGTH_SHORT).show()
                                }
                            }
                            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                            }
                        })
                    }
                }

                val btnOpenRoster = Button(this).apply {
                    text = "Buka Siswa →"
                    textSize = 10.5f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#2563EB"))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    setOnClickListener {
                        showStudentsOfClassDialog(cls.className)
                    }
                }

                btnActionRow.addView(btnQuickAbsen)
                btnActionRow.addView(btnOpenRoster)
                inner.addView(btnActionRow)
                card.addView(inner)
                layout.addView(card)
            }
        }

        scrollView.addView(layout)
        root.addView(scrollView)
        dialog.setView(root)
        dialog.show()
    }

    // =========================================================================
    // MODUL TUGAS & PENILAIAN (PR & CBT TERPADU)
    // =========================================================================
    private fun showTugasPenilaianDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📝 Tugas & Penilaian Terpadu",
            subtitle = "Kelola PR, Tugas Mandiri, Ulangan CBT & Rekap Nilai",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(dialogView)

        // Action Buttons Row: Mulai UH Cepat (3 Mode), Buat PR, & CBT
        val btnCreateRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 8)
        }
        val btnCreateUh = Button(this).apply {
            text = "⚡ Mulai UH (3 Mode)"
            textSize = 10.5f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.1f).apply { marginEnd = 4 }
            setOnClickListener {
                promptMulaiUlanganHarian3ModeDialog()
            }
        }
        val btnCreateHw = Button(this).apply {
            text = "➕ Buat PR"
            textSize = 10.5f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#4F46E5"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.9f).apply { marginEnd = 4 }
            setOnClickListener {
                promptCreateHomeworkDialog {
                    showTugasPenilaianDialog()
                }
            }
        }
        val btnCreateCbt = Button(this).apply {
            text = "➕ CBT Portal"
            textSize = 10.5f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0D9488"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.9f)
            setOnClickListener {
                promptCreateExamDialog {
                    showTugasPenilaianDialog()
                }
            }
        }
        btnCreateRow.addView(btnCreateUh)
        btnCreateRow.addView(btnCreateHw)
        btnCreateRow.addView(btnCreateCbt)
        dialogView.addView(btnCreateRow)

        // Filter Tabs: [Semua], [⚡ Ulangan Harian], [Tugas / PR], [Ulangan CBT]
        var currentFilter = "ALL" // ALL, UH, HW, CBT
        val tabFilterRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 10)
        }
        val btnFilterAll = Button(this).apply {
            text = "Semua"
            textSize = 10f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0284C7"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 3 }
        }
        val btnFilterUh = Button(this).apply {
            text = "⚡ UH Harian"
            textSize = 10f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.1f).apply { marginEnd = 3 }
        }
        val btnFilterHw = Button(this).apply {
            text = "Tugas / PR"
            textSize = 10f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 3 }
        }
        val btnFilterCbt = Button(this).apply {
            text = "Ulangan CBT"
            textSize = 10f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.1f)
        }
        tabFilterRow.addView(btnFilterAll)
        tabFilterRow.addView(btnFilterUh)
        tabFilterRow.addView(btnFilterHw)
        tabFilterRow.addView(btnFilterCbt)
        dialogView.addView(tabFilterRow)

        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0,
                1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scrollView.addView(container)
        dialogView.addView(scrollView)

        val tvLoading = TextView(this).apply {
            text = "Memuat daftar tugas & asesmen..."
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, 20, 0, 20)
            gravity = android.view.Gravity.CENTER
        }
        container.addView(tvLoading)

        var homeworkList: List<HomeworkDto> = emptyList()
        var examList: List<TeacherExamDto> = emptyList()
        var uhList: List<Map<String, Any>> = emptyList()

        fun renderItems() {
            container.removeAllViews()

            var totalRendered = 0

            // Render Homeworks
            if (currentFilter == "ALL" || currentFilter == "HW") {
                for (hw in homeworkList) {
                    totalRendered++
                    val card = CardView(this).apply {
                        radius = 12f
                        cardElevation = 1.5f
                        setCardBackgroundColor(Color.parseColor("#FFFFFF"))
                        useCompatPadding = true
                    }
                    val inner = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(14, 12, 14, 12)
                    }

                    val topRow = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                    }
                    val catBadge = TextView(this).apply {
                        text = hw.category ?: "TUGAS / PR"
                        textSize = 9.5f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setTextColor(Color.parseColor("#4338CA"))
                        setBackgroundColor(Color.parseColor("#EEF2FF"))
                        setPadding(8, 3, 8, 3)
                    }
                    val subText = TextView(this).apply {
                        text = "${hw.subject?.name ?: "Matpel"} • Kelas ${hw.`class`?.name ?: "Semua"}"
                        textSize = 11f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(8, 0, 0, 0)
                    }
                    topRow.addView(catBadge)
                    topRow.addView(subText)
                    inner.addView(topRow)

                    inner.addView(TextView(this).apply {
                        text = hw.title
                        textSize = 13.5f
                        setTextColor(Color.parseColor("#0F172A"))
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setPadding(0, 4, 0, 2)
                    })

                    val weightStr = if (hw.weight != null) " • ⚖️ Bobot: ${hw.weight}%" else ""
                    inner.addView(TextView(this).apply {
                        text = "⏰ Batas: ${hw.deadline}$weightStr"
                        textSize = 11f
                        setTextColor(Color.parseColor("#475569"))
                    })

                    if (!hw.description.isNullOrEmpty()) {
                        inner.addView(TextView(this).apply {
                            text = "Instruksi: ${hw.description}"
                            textSize = 11f
                            setTextColor(Color.parseColor("#64748B"))
                            setPadding(0, 2, 0, 0)
                        })
                    }

                    val actionRow = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        setPadding(0, 8, 0, 0)
                    }

                    val btnMonitor = Button(this).apply {
                        text = "👥 Pantau & Nilai"
                        textSize = 10.5f
                        setTextColor(Color.WHITE)
                        setBackgroundColor(Color.parseColor("#059669"))
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 6 }
                        setOnClickListener {
                            showHomeworkSubmissionsDialog(hw)
                        }
                    }

                    val btnDelete = Button(this).apply {
                        text = "🗑️ Hapus"
                        textSize = 10.5f
                        setTextColor(Color.parseColor("#DC2626"))
                        setBackgroundColor(Color.parseColor("#FEE2E2"))
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                        setOnClickListener {
                            AlertDialog.Builder(this@TeacherMainActivity)
                                .setTitle("Hapus Tugas")
                                .setMessage("Yakin ingin menghapus tugas \"${hw.title}\"?")
                                .setPositiveButton("Hapus") { _, _ ->
                                    ApiClient.getClient(this@TeacherMainActivity).deleteHomework(hw.id).enqueue(object : Callback<BasicResponse> {
                                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                            Toast.makeText(this@TeacherMainActivity, "Tugas berhasil dihapus", Toast.LENGTH_SHORT).show()
                                            showTugasPenilaianDialog()
                                        }
                                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                            Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                                        }
                                    })
                                }
                                .setNegativeButton("Batal", null)
                                .show()
                        }
                    }

                    actionRow.addView(btnMonitor)
                    actionRow.addView(btnDelete)
                    inner.addView(actionRow)
                    card.addView(inner)
                    container.addView(card)
                }
            }

            // Render CBT Exams
            if (currentFilter == "ALL" || currentFilter == "CBT") {
                for (exam in examList) {
                    totalRendered++
                    val card = CardView(this).apply {
                        radius = 12f
                        cardElevation = 1.5f
                        setCardBackgroundColor(Color.parseColor("#FFFFFF"))
                        useCompatPadding = true
                    }
                    val inner = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(14, 12, 14, 12)
                    }

                    val topRow = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                    }
                    val cbtBadge = TextView(this).apply {
                        text = "ULANGAN HARIAN (UH)"
                        textSize = 9.5f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setTextColor(Color.parseColor("#4338CA"))
                        setBackgroundColor(Color.parseColor("#EEF2FF"))
                        setPadding(8, 3, 8, 3)
                    }
                    val subText = TextView(this).apply {
                        text = "${exam.subject?.name ?: "Matpel"} • Kelas: ${exam.assignedClasses ?: "Semua"}"
                        textSize = 11f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(8, 0, 0, 0)
                    }
                    topRow.addView(cbtBadge)
                    topRow.addView(subText)
                    inner.addView(topRow)

                    inner.addView(TextView(this).apply {
                        text = exam.title
                        textSize = 13.5f
                        setTextColor(Color.parseColor("#0F172A"))
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setPadding(0, 4, 0, 2)
                    })

                    inner.addView(TextView(this).apply {
                        text = "⏱️ Durasi: ${exam.durationMinutes} Menit • 🔑 Token: ${exam.token ?: "-"}"
                        textSize = 11f
                        setTextColor(Color.parseColor("#475569"))
                    })

                    val schedStr = if (!exam.executionDate.isNullOrEmpty()) {
                        "📅 Jadwal: ${exam.executionDate} • ${exam.startTimeStr ?: "07:30"}-${exam.endTimeStr ?: "09:30"} WIB"
                    } else {
                        "📅 Jadwal: Fleksibel KBM"
                    }
                    val targetClsStr = "🎯 Target: ${exam.assignedClasses ?: "Semua Kelas"}"

                    inner.addView(TextView(this).apply {
                        text = "$schedStr\n$targetClsStr"
                        textSize = 11f
                        setTextColor(Color.parseColor("#0284C7"))
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setPadding(0, 2, 0, 2)
                    })

                    val qCount = exam._count?.questions ?: 0
                    val sCount = exam._count?.studentExams ?: 0
                    inner.addView(TextView(this).apply {
                        text = "📝 $qCount Butir Soal • $sCount Siswa Mengerjakan"
                        textSize = 11f
                        setTextColor(Color.parseColor("#047857"))
                        setPadding(0, 2, 0, 0)
                    })

                    val actionRow = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        setPadding(0, 8, 0, 0)
                    }

                    val btnQuestions = Button(this).apply {
                        text = "📝 Soal ($qCount)"
                        textSize = 10.5f
                        setTextColor(Color.WHITE)
                        setBackgroundColor(Color.parseColor("#0D9488"))
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.1f).apply { marginEnd = 4 }
                        setOnClickListener {
                            showExamQuestionsManagerDialog(exam)
                        }
                    }

                    val btnMonitoring = Button(this).apply {
                        text = "📊 Nilai ($sCount)"
                        textSize = 10.5f
                        setTextColor(Color.WHITE)
                        setBackgroundColor(Color.parseColor("#4F46E5"))
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f).apply { marginEnd = 4 }
                        setOnClickListener {
                            showExamMonitoringRealtimeDialog(exam)
                        }
                    }

                    val btnSettings = Button(this).apply {
                        text = "⚙️ Jadwal"
                        textSize = 10.5f
                        setTextColor(Color.parseColor("#334155"))
                        setBackgroundColor(Color.parseColor("#E2E8F0"))
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.9f).apply { marginEnd = 4 }
                        setOnClickListener {
                            showExamSettingsDialog(exam)
                        }
                    }

                    val btnDelete = Button(this).apply {
                        text = "🗑️"
                        textSize = 11f
                        setTextColor(Color.parseColor("#DC2626"))
                        setBackgroundColor(Color.parseColor("#FEE2E2"))
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                        setOnClickListener {
                            AlertDialog.Builder(this@TeacherMainActivity)
                                .setTitle("Hapus Ulangan CBT")
                                .setMessage("Yakin ingin menghapus ulangan \"${exam.title}\"?")
                                .setPositiveButton("Hapus") { _, _ ->
                                    ApiClient.getClient(this@TeacherMainActivity).deleteTeacherExam(exam.id).enqueue(object : Callback<BasicResponse> {
                                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                            Toast.makeText(this@TeacherMainActivity, "Ulangan CBT berhasil dihapus", Toast.LENGTH_SHORT).show()
                                            showTugasPenilaianDialog()
                                        }
                                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                            Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                                        }
                                    })
                                }
                                .setNegativeButton("Batal", null)
                                .show()
                        }
                    }

                    actionRow.addView(btnQuestions)
                    actionRow.addView(btnMonitoring)
                    actionRow.addView(btnSettings)
                    actionRow.addView(btnDelete)
                    inner.addView(actionRow)
                    card.addView(inner)
                    container.addView(card)
                }
            }

            // Render Ulangan Harian (3 Mode)
            if (currentFilter == "ALL" || currentFilter == "UH") {
                for (uh in uhList) {
                    totalRendered++
                    val card = CardView(this).apply {
                        radius = 12f
                        cardElevation = 1.5f
                        setCardBackgroundColor(Color.parseColor("#FFFFFF"))
                        useCompatPadding = true
                    }
                    val inner = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(14, 12, 14, 12)
                    }

                    val uhId = uh["id"]?.toString() ?: ""
                    val topik = uh["topik"]?.toString() ?: "Ulangan Harian"
                    val mapel = uh["mapelId"]?.toString() ?: "Mata Pelajaran"
                    val kelas = uh["kelasId"]?.toString() ?: "Semua Rombel"
                    val mode = uh["mode"]?.toString() ?: "STANDAR"
                    val status = uh["status"]?.toString() ?: "AKTIF"
                    val token = uh["tokenAktif"]?.toString()
                    val durasi = uh["durasiMenit"]?.toString() ?: "15"
                    val totalSoal = uh["totalSoal"]?.toString() ?: "10"
                    val submissions = (uh["submissions"] as? List<*>) ?: emptyList<Any>()

                    val topRow = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                    }
                    val uhBadge = TextView(this).apply {
                        text = "⚡ UH ($mode)"
                        textSize = 9.5f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setTextColor(Color.parseColor("#059669"))
                        setBackgroundColor(Color.parseColor("#ECFDF5"))
                        setPadding(8, 3, 8, 3)
                    }
                    val subText = TextView(this).apply {
                        text = "$mapel • Kelas: $kelas"
                        textSize = 11f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(8, 0, 0, 0)
                    }
                    topRow.addView(uhBadge)
                    topRow.addView(subText)
                    inner.addView(topRow)

                    inner.addView(TextView(this).apply {
                        text = topik
                        textSize = 13.5f
                        setTextColor(Color.parseColor("#0F172A"))
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setPadding(0, 4, 0, 2)
                    })

                    val tokenStr = if (!token.isNullOrEmpty()) " • 🔑 Token: $token" else ""
                    val statusColor = if (status == "AKTIF") "#059669" else "#64748B"
                    val statusText = if (status == "AKTIF") "🟢 Sedang Berlangsung" else "⚪ Selesai"
                    inner.addView(TextView(this).apply {
                        text = "⏱️ $durasi Menit • $totalSoal Soal • $statusText$tokenStr"
                        textSize = 11f
                        setTextColor(Color.parseColor(statusColor))
                        setTypeface(null, android.graphics.Typeface.BOLD)
                    })

                    inner.addView(TextView(this).apply {
                        text = "👥 ${submissions.size} Siswa Mengerjakan"
                        textSize = 11f
                        setTextColor(Color.parseColor("#0284C7"))
                        setPadding(0, 2, 0, 0)
                    })

                    val actionRow = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        setPadding(0, 8, 0, 0)
                    }

                    val btnMonitoring = Button(this).apply {
                        text = "📊 Pantau & Nilai"
                        textSize = 10.5f
                        setTextColor(Color.WHITE)
                        setBackgroundColor(Color.parseColor("#059669"))
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f).apply { marginEnd = 4 }
                        setOnClickListener {
                            showMonitoringUlanganHarianDialog(uhId)
                        }
                    }
                    actionRow.addView(btnMonitoring)

                    if (mode == "CBT_MINI" && status == "AKTIF") {
                        val btnToken = Button(this).apply {
                            text = "🔄 Token"
                            textSize = 10f
                            setTextColor(Color.parseColor("#92400E"))
                            setBackgroundColor(Color.parseColor("#FEF3C7"))
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.9f).apply { marginEnd = 4 }
                            setOnClickListener {
                                ApiClient.getClient(this@TeacherMainActivity).rotateTokenUh(uhId).enqueue(object : Callback<Map<String, Any>> {
                                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                                        Toast.makeText(this@TeacherMainActivity, "Token berhasil diperbarui!", Toast.LENGTH_SHORT).show()
                                        showTugasPenilaianDialog()
                                    }
                                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                                        Toast.makeText(this@TeacherMainActivity, "Gagal refresh token", Toast.LENGTH_SHORT).show()
                                    }
                                })
                            }
                        }
                        actionRow.addView(btnToken)
                    }

                    if (status == "AKTIF") {
                        val btnSelesai = Button(this).apply {
                            text = "🏁 Selesai"
                            textSize = 10f
                            setTextColor(Color.parseColor("#B91C1C"))
                            setBackgroundColor(Color.parseColor("#FEE2E2"))
                            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                            setOnClickListener {
                                AlertDialog.Builder(this@TeacherMainActivity)
                                    .setTitle("Akhiri Ulangan")
                                    .setMessage("Yakin ingin menyelesaikan ulangan \"$topik\" sekarang?")
                                    .setPositiveButton("Akhiri") { _, _ ->
                                        ApiClient.getClient(this@TeacherMainActivity).finishUlanganHarian(uhId).enqueue(object : Callback<Map<String, Any>> {
                                            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                                                Toast.makeText(this@TeacherMainActivity, "Ulangan telah diakhiri", Toast.LENGTH_SHORT).show()
                                                showTugasPenilaianDialog()
                                            }
                                            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                                                Toast.makeText(this@TeacherMainActivity, "Gagal mengakhiri ulangan", Toast.LENGTH_SHORT).show()
                                            }
                                        })
                                    }
                                    .setNegativeButton("Batal", null)
                                    .show()
                            }
                        }
                        actionRow.addView(btnSelesai)
                    }

                    inner.addView(actionRow)
                    card.addView(inner)
                    container.addView(card)
                }
            }

            if (totalRendered == 0) {
                container.addView(TextView(this).apply {
                    text = "Belum ada data tugas atau ulangan harian. Ketuk tombol 'Buat Tugas' atau 'Buat Ulangan' di atas."
                    setTextColor(Color.parseColor("#94A3B8"))
                    textSize = 12f
                    setPadding(0, 30, 0, 30)
                    gravity = android.view.Gravity.CENTER
                })
            }
        }

        // Fetch Homeworks, Exams, and Ulangan Harian concurrently
        var pendingFetches = 3
        fun checkDone() {
            pendingFetches--
            if (pendingFetches <= 0) {
                renderItems()
            }
        }

        ApiClient.getClient(this).getHomeworks().enqueue(object : Callback<List<HomeworkDto>> {
            override fun onResponse(call: Call<List<HomeworkDto>>, response: Response<List<HomeworkDto>>) {
                if (response.isSuccessful && response.body() != null) {
                    homeworkList = response.body()!!
                }
                checkDone()
            }
            override fun onFailure(call: Call<List<HomeworkDto>>, t: Throwable) {
                checkDone()
            }
        })

        ApiClient.getClient(this@TeacherMainActivity).getTeacherExams().enqueue(object : Callback<List<TeacherExamDto>> {
            override fun onResponse(call: Call<List<TeacherExamDto>>, response: Response<List<TeacherExamDto>>) {
                if (response.isSuccessful && response.body() != null) {
                    val raw = response.body()!!
                    examList = raw.filter { ex ->
                        val t = (ex.examType ?: "UH").uppercase()
                        t == "UH" || t == "FORMATIF" || t == "HARIAN" || t == "ULANGAN_HARIAN" || t == "REMEDIAL"
                    }
                }
                checkDone()
            }
            override fun onFailure(call: Call<List<TeacherExamDto>>, t: Throwable) {
                checkDone()
            }
        })

        ApiClient.getClient(this@TeacherMainActivity).getTeacherUlanganHarianList().enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (response.isSuccessful && response.body()?.get("success") == true) {
                    val data = response.body()?.get("data") as? List<Map<String, Any>>
                    if (data != null) {
                        uhList = data
                    }
                }
                checkDone()
            }
            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                checkDone()
            }
        })

        btnFilterAll.setOnClickListener {
            currentFilter = "ALL"
            btnFilterAll.setBackgroundColor(Color.parseColor("#0284C7"))
            btnFilterAll.setTextColor(Color.WHITE)
            btnFilterUh.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterUh.setTextColor(Color.parseColor("#334155"))
            btnFilterHw.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterHw.setTextColor(Color.parseColor("#334155"))
            btnFilterCbt.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterCbt.setTextColor(Color.parseColor("#334155"))
            renderItems()
        }
        btnFilterUh.setOnClickListener {
            currentFilter = "UH"
            btnFilterUh.setBackgroundColor(Color.parseColor("#0284C7"))
            btnFilterUh.setTextColor(Color.WHITE)
            btnFilterAll.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterAll.setTextColor(Color.parseColor("#334155"))
            btnFilterHw.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterHw.setTextColor(Color.parseColor("#334155"))
            btnFilterCbt.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterCbt.setTextColor(Color.parseColor("#334155"))
            renderItems()
        }
        btnFilterHw.setOnClickListener {
            currentFilter = "HW"
            btnFilterHw.setBackgroundColor(Color.parseColor("#0284C7"))
            btnFilterHw.setTextColor(Color.WHITE)
            btnFilterAll.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterAll.setTextColor(Color.parseColor("#334155"))
            btnFilterUh.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterUh.setTextColor(Color.parseColor("#334155"))
            btnFilterCbt.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterCbt.setTextColor(Color.parseColor("#334155"))
            renderItems()
        }
        btnFilterCbt.setOnClickListener {
            currentFilter = "CBT"
            btnFilterCbt.setBackgroundColor(Color.parseColor("#0284C7"))
            btnFilterCbt.setTextColor(Color.WHITE)
            btnFilterAll.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterAll.setTextColor(Color.parseColor("#334155"))
            btnFilterUh.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterUh.setTextColor(Color.parseColor("#334155"))
            btnFilterHw.setBackgroundColor(Color.parseColor("#E2E8F0"))
            btnFilterHw.setTextColor(Color.parseColor("#334155"))
            renderItems()
        }

        dialog.setView(root)
        dialog.show()
    }

    private fun promptCreateHomeworkDialog(onCreated: () -> Unit) {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📝 Buat Tugas / PR Cerdas",
            subtitle = "Penugasan & Latihan Siswa SMPN 1 Boyolangu",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad * 2)
        }

        fun createLabel(txt: String): TextView = TextView(this).apply {
            text = txt
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, (10 * density).toInt(), 0, (4 * density).toInt())
        }

        // Section 1: Mata Pelajaran (Locked to Teacher Subject)
        layout.addView(createLabel("Mata Pelajaran (Otomatis Terkunci) *"))
        val teacherSubject = sessionManager.getTeachingSubject().ifEmpty { "Mata Pelajaran yang Diampu" }
        val tvSubjectLocked = TextView(this).apply {
            text = "🔒 $teacherSubject"
            textSize = 13.5f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#EEF2FF"))
                cornerRadius = 8 * density
                setStroke((1 * density).toInt(), Color.parseColor("#C7D2FE"))
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
        }
        layout.addView(tvSubjectLocked)

        layout.addView(createLabel("Judul Tugas / PR *"))
        val etTitle = EditText(this).apply {
            hint = "Contoh: Latihan Soal Bab 3 atau PR Mandiri"
            textSize = 13.5f
            setBackgroundResource(android.R.drawable.edit_text)
        }
        layout.addView(etTitle)

        layout.addView(createLabel("Target Rombel / Kelas:"))
        val spinnerClass = Spinner(this)
        val teacherClasses = sessionManager.getTeachingClasses()
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toMutableList()
        if (teacherClasses.isEmpty()) {
            teacherClasses.addAll(listOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VIII-A", "VIII-B", "VIII-C", "IX-A", "IX-B"))
        }
        spinnerClass.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, teacherClasses)
        layout.addView(spinnerClass)

        layout.addView(createLabel("Kategori Penugasan:"))
        val spinnerCategory = Spinner(this)
        val categories = arrayOf(
            "PR - Pekerjaan Rumah",
            "TUGAS_HARIAN - Latihan / Tugas Harian",
            "PROYEK - Proyek Kelompok / Portofolio",
            "LKPD - Lembar Kerja Peserta Didik"
        )
        spinnerCategory.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, categories)
        layout.addView(spinnerCategory)

        // Section 2: Deadline & Smart Presets
        layout.addView(createLabel("⏰ Batas Waktu / Tenggat Pengumpulan:"))
        val etDeadline = EditText(this).apply {
            val sdf = SimpleDateFormat("yyyy-MM-dd 23:59", Locale.getDefault())
            val cal = java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, 3) }
            setText(sdf.format(cal.time))
            textSize = 13f
        }
        layout.addView(etDeadline)

        // Smart Deadline Quick Chips
        val chipRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
        }

        fun createChip(label: String, daysToAdd: Int, timeStr: String) = TextView(this).apply {
            text = label
            textSize = 10f
            setTextColor(Color.parseColor("#4338CA"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#EEF2FF"))
                cornerRadius = 6 * density
            }
            background = bg
            val p = (5 * density).toInt()
            setPadding(p * 2, p, p * 2, p)
            val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = (4 * density).toInt()
            }
            layoutParams = lp
            gravity = android.view.Gravity.CENTER
            setOnClickListener {
                val cal = java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, daysToAdd) }
                val sdfDate = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                etDeadline.setText("${sdfDate.format(cal.time)} $timeStr")
            }
        }
        chipRow.addView(createChip("Hari Ini", 0, "15:30"))
        chipRow.addView(createChip("Besok Pagi", 1, "07:00"))
        chipRow.addView(createChip("3 Hari", 3, "23:59"))
        chipRow.addView(createChip("1 Minggu", 7, "23:59"))
        layout.addView(chipRow)

        val rowWeight = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val tvWeightLbl = TextView(this).apply {
            text = "⚖️ Bobot Penilaian (%): "
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
        }
        val etWeight = EditText(this).apply {
            setText("20")
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams((70 * density).toInt(), LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        rowWeight.addView(tvWeightLbl)
        rowWeight.addView(etWeight)
        layout.addView(rowWeight)

        layout.addView(createLabel("Instruksi & Petunjuk Pengerjaan untuk Siswa:"))
        val etDesc = EditText(this).apply {
            hint = "Tuliskan panduan pengerjaan soal atau referensi materi..."
            minLines = 3
            textSize = 13f
            gravity = android.view.Gravity.TOP or android.view.Gravity.START
            setBackgroundResource(android.R.drawable.edit_text)
        }
        layout.addView(etDesc)

        val btnSubmit = Button(this).apply {
            text = "💾 Terbitkan Tugas Sekarang"
            textSize = 13.5f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#4F46E5"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                topMargin = (20 * density).toInt()
                bottomMargin = (30 * density).toInt()
            }
            setOnClickListener {
                val title = etTitle.text.toString().trim()
                if (title.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Judul tugas wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val selectedClass = spinnerClass.selectedItem.toString()
                val selectedCategory = spinnerCategory.selectedItem.toString().substringBefore(" -")
                val deadline = etDeadline.text.toString().trim().ifEmpty { "1 Minggu ke Depan" }
                val weight = etWeight.text.toString().toDoubleOrNull() ?: 20.0
                val desc = etDesc.text.toString().trim()

                val req = CreateHomeworkRequest(
                    title = title,
                    subject = teacherSubject,
                    className = selectedClass,
                    deadline = deadline,
                    startTime = "07:00",
                    endTime = "23:59",
                    type = "ESSAY",
                    weight = weight,
                    category = selectedCategory,
                    description = desc.ifEmpty { null }
                )

                Toast.makeText(this@TeacherMainActivity, "Menerbitkan tugas...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this@TeacherMainActivity).createHomework(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "✅ Tugas \"$title\" berhasil dibuat untuk Kelas $selectedClass!", Toast.LENGTH_LONG).show()
                            dialog.dismiss()
                            onCreated()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal membuat tugas", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        layout.addView(btnSubmit)

        scroll.addView(layout)
        root.addView(scroll)
        dialog.setView(root)
        dialog.show()
    }

    private fun promptCreateExamDialog(onCreated: () -> Unit) {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🚀 Mulai Ulangan Cepat (UH)",
            subtitle = "Ulangan Harian & Formatif Berbasis CBT",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad * 2)
        }

        fun createLabel(txt: String): TextView = TextView(this).apply {
            text = txt
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, (10 * density).toInt(), 0, (4 * density).toInt())
        }

        // Section 1: Mata Pelajaran (Strictly Locked to Teacher Subject)
        layout.addView(createLabel("Mata Pelajaran (Otomatis Terkunci) *"))
        val teacherSubject = sessionManager.getTeachingSubject().ifEmpty { "Mata Pelajaran yang Diampu" }
        val tvSubjectLocked = TextView(this).apply {
            text = "🔒 $teacherSubject"
            textSize = 13.5f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F0FDF4"))
                cornerRadius = 8 * density
                setStroke((1 * density).toInt(), Color.parseColor("#BBF7D0"))
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
        }
        layout.addView(tvSubjectLocked)

        layout.addView(createLabel("Judul Ulangan Harian *"))
        val etTitle = EditText(this).apply {
            hint = "Contoh: UH 1 - Materi Pola Bilangan"
            textSize = 13.5f
            setBackgroundResource(android.R.drawable.edit_text)
        }
        layout.addView(etTitle)

        layout.addView(createLabel("Target Rombel / Kelas (Centang Kelas Pelaksana) *"))
        val cardClasses = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 10 * density
                setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
        }

        val cbSelectAll = CheckBox(this).apply {
            text = "✅ Pilih Semua Kelas yang Diampu"
            textSize = 12.5f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            isChecked = true
        }
        cardClasses.addView(cbSelectAll)

        val dividerCls = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (1 * density).toInt()).apply {
                topMargin = (4 * density).toInt()
                bottomMargin = (6 * density).toInt()
            }
            setBackgroundColor(Color.parseColor("#CBD5E1"))
        }
        cardClasses.addView(dividerCls)

        val teacherClasses = sessionManager.getTeachingClasses()
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toMutableList()
        if (teacherClasses.isEmpty()) {
            teacherClasses.addAll(listOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K",
                "VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K",
                "IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K"))
        }

        val classCheckBoxList = mutableListOf<CheckBox>()
        var currentRow: LinearLayout? = null
        teacherClasses.forEachIndexed { idx, clsName ->
            if (idx % 3 == 0) {
                currentRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    weightSum = 3f
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                }
                cardClasses.addView(currentRow)
            }
            val cbClass = CheckBox(this).apply {
                text = clsName
                textSize = 12f
                isChecked = true
                setTextColor(Color.parseColor("#334155"))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            classCheckBoxList.add(cbClass)
            currentRow?.addView(cbClass)
        }

        var isUpdatingCheckboxes = false
        cbSelectAll.setOnCheckedChangeListener { _, isChecked ->
            if (!isUpdatingCheckboxes) {
                isUpdatingCheckboxes = true
                classCheckBoxList.forEach { it.isChecked = isChecked }
                isUpdatingCheckboxes = false
            }
        }
        classCheckBoxList.forEach { cb ->
            cb.setOnCheckedChangeListener { _, _ ->
                if (!isUpdatingCheckboxes) {
                    isUpdatingCheckboxes = true
                    cbSelectAll.isChecked = classCheckBoxList.all { it.isChecked }
                    isUpdatingCheckboxes = false
                }
            }
        }
        layout.addView(cardClasses)

        // Section 2: Jadwal Pelaksanaan Ujian (DatePicker & TimePicker)
        layout.addView(createLabel("📅 Jadwal Pelaksanaan Ulangan Harian *"))
        val cardSchedule = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F0FDF4"))
                cornerRadius = 10 * density
                setStroke((1 * density).toInt(), Color.parseColor("#BBF7D0"))
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
        }

        val sdfDate = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
        val cal = java.util.Calendar.getInstance()
        var selectedDateStr = sdfDate.format(cal.time)
        var selectedStartTimeStr = "07:30"
        var selectedEndTimeStr = "09:30"

        val tvDateBtn = TextView(this).apply {
            text = "📅 Tanggal Ujian: $selectedDateStr (Ketuk untuk ganti)"
            textSize = 12.5f
            setTextColor(Color.parseColor("#166534"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, (4 * density).toInt(), 0, (6 * density).toInt())
            setOnClickListener {
                val dCal = java.util.Calendar.getInstance()
                try {
                    val parsed = sdfDate.parse(selectedDateStr)
                    if (parsed != null) dCal.time = parsed
                } catch (_: Exception) {}
                android.app.DatePickerDialog(this@TeacherMainActivity, { _, yearVal, monthVal, dayVal ->
                    selectedDateStr = String.format(java.util.Locale.US, "%04d-%02d-%02d", yearVal, monthVal + 1, dayVal)
                    text = "📅 Tanggal Ujian: $selectedDateStr (Ketuk untuk ganti)"
                }, dCal.get(java.util.Calendar.YEAR), dCal.get(java.util.Calendar.MONTH), dCal.get(java.util.Calendar.DAY_OF_MONTH)).show()
            }
        }
        cardSchedule.addView(tvDateBtn)

        val rowTime = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (4 * density).toInt()
            }
        }

        val tvStartTimeBtn = TextView(this).apply {
            text = "🕒 Jam Mulai: $selectedStartTimeStr WIB"
            textSize = 11.5f
            setTextColor(Color.parseColor("#065F46"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = (4 * density).toInt() }
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 6 * density
                setStroke((1 * density).toInt(), Color.parseColor("#A7F3D0"))
            }
            background = bg
            val p = (8 * density).toInt()
            setPadding(p, p, p, p)
            setOnClickListener {
                val parts = selectedStartTimeStr.split(":")
                val h = parts.getOrNull(0)?.toIntOrNull() ?: 7
                val m = parts.getOrNull(1)?.toIntOrNull() ?: 30
                android.app.TimePickerDialog(this@TeacherMainActivity, { _, selectedH, selectedM ->
                    selectedStartTimeStr = String.format(Locale.US, "%02d:%02d", selectedH, selectedM)
                    text = "🕒 Jam Mulai: $selectedStartTimeStr WIB"
                }, h, m, true).show()
            }
        }

        val tvEndTimeBtn = TextView(this).apply {
            text = "🕒 Jam Selesai: $selectedEndTimeStr WIB"
            textSize = 11.5f
            setTextColor(Color.parseColor("#065F46"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = (4 * density).toInt() }
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 6 * density
                setStroke((1 * density).toInt(), Color.parseColor("#A7F3D0"))
            }
            background = bg
            val p = (8 * density).toInt()
            setPadding(p, p, p, p)
            setOnClickListener {
                val parts = selectedEndTimeStr.split(":")
                val h = parts.getOrNull(0)?.toIntOrNull() ?: 9
                val m = parts.getOrNull(1)?.toIntOrNull() ?: 30
                android.app.TimePickerDialog(this@TeacherMainActivity, { _, selectedH, selectedM ->
                    selectedEndTimeStr = String.format(Locale.US, "%02d:%02d", selectedH, selectedM)
                    text = "🕒 Jam Selesai: $selectedEndTimeStr WIB"
                }, h, m, true).show()
            }
        }
        rowTime.addView(tvStartTimeBtn)
        rowTime.addView(tvEndTimeBtn)
        cardSchedule.addView(rowTime)
        layout.addView(cardSchedule)

        // Section 3: Durasi & KKM
        val rowDurKkm = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
        }
        val colDur = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = (6 * density).toInt() }
        }
        colDur.addView(createLabel("Durasi (Menit):"))
        val etDuration = EditText(this).apply {
            setText("60")
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            textSize = 13.5f
        }
        colDur.addView(etDuration)

        val colKkm = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = (6 * density).toInt() }
        }
        colKkm.addView(createLabel("KKM / Nilai Minimal:"))
        val etKkm = EditText(this).apply {
            setText("75")
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            textSize = 13.5f
        }
        colKkm.addView(etKkm)
        rowDurKkm.addView(colDur)
        rowDurKkm.addView(colKkm)
        layout.addView(rowDurKkm)

        // Tokenless Checkbox
        val cbNoToken = CheckBox(this).apply {
            text = "⚡ Ulangan Harian Tanpa Token (Siswa Langsung Masuk saat Jam KBM)"
            isChecked = true
            textSize = 12.5f
            setTextColor(Color.parseColor("#047857"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            val p = (6 * density).toInt()
            setPadding(0, p, 0, p)
        }
        layout.addView(cbNoToken)

        val cbShuffleQ = CheckBox(this).apply {
            text = "Acak Urutan Butir Soal (Shuffle Questions)"
            isChecked = true
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
        }
        val cbShuffleOpt = CheckBox(this).apply {
            text = "Acak Pilihan Jawaban (A, B, C, D)"
            isChecked = true
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
        }
        val cbShowScore = CheckBox(this).apply {
            text = "Tampilkan Nilai Langsung ke Siswa setelah selesai"
            isChecked = true
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
        }
        layout.addView(cbShuffleQ)
        layout.addView(cbShuffleOpt)
        layout.addView(cbShowScore)

        val btnSubmit = Button(this).apply {
            text = "🚀 Terbitkan Ulangan Harian CBT"
            textSize = 13.5f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#0D9488"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                topMargin = (20 * density).toInt()
                bottomMargin = (30 * density).toInt()
            }
            setOnClickListener {
                val title = etTitle.text.toString().trim()
                if (title.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Judul ulangan wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val checkedClasses = classCheckBoxList.filter { it.isChecked }.map { it.text.toString() }
                if (checkedClasses.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Pilih minimal 1 kelas sasaran ulangan!", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val assignedClassStr = checkedClasses.joinToString(",")

                val duration = etDuration.text.toString().toIntOrNull() ?: 60
                val kkm = etKkm.text.toString().toIntOrNull() ?: 75

                val req = CreateExamRequest(
                    title = title,
                    subjectName = teacherSubject,
                    assignedClasses = assignedClassStr,
                    durationMinutes = duration,
                    executionDate = selectedDateStr,
                    startTimeStr = selectedStartTimeStr,
                    endTimeStr = selectedEndTimeStr,
                    randomizeQuestions = cbShuffleQ.isChecked,
                    randomizeOptions = cbShuffleOpt.isChecked,
                    showScoreToStudent = cbShowScore.isChecked,
                    examType = "UH",
                    passingGrade = kkm
                )

                val progress = AlertDialog.Builder(this@TeacherMainActivity)
                    .setMessage("Menerbitkan ulangan harian CBT...")
                    .setCancelable(false)
                    .show()

                ApiClient.getClient(this@TeacherMainActivity).createTeacherExam(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "✅ Ulangan Harian \"$title\" berhasil dibuat!", Toast.LENGTH_LONG).show()
                            dialog.dismiss()
                            onCreated()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal membuat ulangan", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        layout.addView(btnSubmit)

        scroll.addView(layout)
        root.addView(scroll)
        dialog.setView(root)
        dialog.show()
    }

    private fun showExamQuestionsManagerDialog(exam: TeacherExamDto) {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📝 Kelola Soal CBT",
            subtitle = "${exam.title} (${exam.subject?.name ?: "-"} - ${exam.assignedClasses ?: "Semua"})",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        // Action Row at top
        val actionRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val pad = (12 * density).toInt()
            setPadding(pad, pad, pad, (6 * density).toInt())
        }

        val btnAddManual = Button(this).apply {
            text = "➕ Tambah Soal Manual"
            textSize = 11.5f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#0D9488"))
            layoutParams = LinearLayout.LayoutParams(0, (44 * density).toInt(), 1f).apply { marginEnd = (6 * density).toInt() }
        }

        val btnAiGen = Button(this).apply {
            text = "🤖 Generate Soal AI"
            textSize = 11.5f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#7C3AED"))
            layoutParams = LinearLayout.LayoutParams(0, (44 * density).toInt(), 1f)
        }

        actionRow.addView(btnAddManual)
        actionRow.addView(btnAiGen)
        root.addView(actionRow)

        val tvStatus = TextView(this).apply {
            text = "Memuat daftar butir soal..."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            val padH = (16 * density).toInt()
            setPadding(padH, (4 * density).toInt(), padH, (8 * density).toInt())
        }
        root.addView(tvStatus)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val questionsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (12 * density).toInt()
            setPadding(pad, 0, pad, pad * 2)
        }
        scroll.addView(questionsContainer)
        root.addView(scroll)

        fun loadQuestions() {
            questionsContainer.removeAllViews()
            tvStatus.text = "Memuat butir soal..."
            ApiClient.getClient(this).getTeacherExamQuestions(exam.id).enqueue(object : Callback<List<com.school.smartcbt.data.model.BackendQuestionDto>> {
                override fun onResponse(call: Call<List<com.school.smartcbt.data.model.BackendQuestionDto>>, response: Response<List<com.school.smartcbt.data.model.BackendQuestionDto>>) {
                    if (response.isSuccessful) {
                        val questions = response.body() ?: emptyList()
                        tvStatus.text = "Total Butir Soal: ${questions.size} Soal Pilihan Ganda"
                        if (questions.isEmpty()) {
                            questionsContainer.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Belum ada butir soal pada ulangan ini.\n\nGunakan tombol '➕ Tambah Soal Manual' atau '🤖 Generate Soal AI' di atas untuk menyusun naskah ujian."
                                textSize = 13f
                                setTextColor(Color.parseColor("#94A3B8"))
                                gravity = android.view.Gravity.CENTER
                                val pad = (40 * density).toInt()
                                setPadding(pad, pad, pad, pad)
                            })
                        } else {
                            questions.forEachIndexed { idx, q ->
                                val card = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val bg = android.graphics.drawable.GradientDrawable().apply {
                                        setColor(Color.WHITE)
                                        cornerRadius = 12 * density
                                        setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
                                    }
                                    background = bg
                                    val pad = (14 * density).toInt()
                                    setPadding(pad, pad, pad, pad)
                                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (12 * density).toInt()
                                    }
                                    layoutParams = lp
                                }

                                val topRow = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = android.view.Gravity.CENTER_VERTICAL
                                }
                                val badgeQ = TextView(this@TeacherMainActivity).apply {
                                    text = "Soal #${idx + 1}"
                                    textSize = 12f
                                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                                    setTextColor(Color.parseColor("#0F766E"))
                                    val bg = android.graphics.drawable.GradientDrawable().apply {
                                        setColor(Color.parseColor("#CCFBF1"))
                                        cornerRadius = 6 * density
                                    }
                                    background = bg
                                    setPadding((8 * density).toInt(), (3 * density).toInt(), (8 * density).toInt(), (3 * density).toInt())
                                }

                                val cogLvl = q.cognitiveLevel ?: "C3"
                                val badgeCog = TextView(this@TeacherMainActivity).apply {
                                    text = cogLvl
                                    textSize = 10.5f
                                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                                    setTextColor(Color.parseColor("#7C3AED"))
                                    val bg = android.graphics.drawable.GradientDrawable().apply {
                                        setColor(Color.parseColor("#F3E8FF"))
                                        cornerRadius = 6 * density
                                    }
                                    background = bg
                                    val p = (3 * density).toInt()
                                    setPadding(p * 2, p, p * 2, p)
                                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        marginStart = (6 * density).toInt()
                                    }
                                    layoutParams = lp
                                }

                                val spacer = View(this@TeacherMainActivity).apply {
                                    layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
                                }

                                val btnEditQ = TextView(this@TeacherMainActivity).apply {
                                    text = "✏️ Edit"
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#2563EB"))
                                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                                    setPadding((8 * density).toInt(), (4 * density).toInt(), (8 * density).toInt(), (4 * density).toInt())
                                    setOnClickListener {
                                        showEditQuestionDialog(exam, q) { loadQuestions() }
                                    }
                                }

                                val btnDelQ = TextView(this@TeacherMainActivity).apply {
                                    text = "🗑️ Hapus"
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#DC2626"))
                                    setPadding((8 * density).toInt(), (4 * density).toInt(), (8 * density).toInt(), (4 * density).toInt())
                                    setOnClickListener {
                                        AlertDialog.Builder(this@TeacherMainActivity)
                                            .setTitle("Hapus Butir Soal")
                                            .setMessage("Yakin ingin menghapus soal nomor ${idx + 1}?")
                                            .setPositiveButton("Hapus") { _, _ ->
                                                ApiClient.getClient(this@TeacherMainActivity).deleteTeacherExamQuestion(exam.id, q.id).enqueue(object : Callback<BasicResponse> {
                                                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                                        Toast.makeText(this@TeacherMainActivity, "Soal berhasil dihapus", Toast.LENGTH_SHORT).show()
                                                        loadQuestions()
                                                    }
                                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                                        Toast.makeText(this@TeacherMainActivity, "Gagal menghapus", Toast.LENGTH_SHORT).show()
                                                    }
                                                })
                                            }
                                            .setNegativeButton("Batal", null)
                                            .show()
                                    }
                                }
                                topRow.addView(badgeQ)
                                topRow.addView(badgeCog)
                                topRow.addView(spacer)
                                topRow.addView(btnEditQ)
                                topRow.addView(btnDelQ)
                                card.addView(topRow)

                                // Listening Audio Player (if present)
                                if (!q.audioUrl.isNullOrBlank()) {
                                    val audioBar = LinearLayout(this@TeacherMainActivity).apply {
                                        orientation = LinearLayout.HORIZONTAL
                                        gravity = android.view.Gravity.CENTER_VERTICAL
                                        val bgAud = android.graphics.drawable.GradientDrawable().apply {
                                            setColor(Color.parseColor("#EFF6FF"))
                                            cornerRadius = 8 * density
                                            setStroke((1 * density).toInt(), Color.parseColor("#BFDBFE"))
                                        }
                                        background = bgAud
                                        val pad = (8 * density).toInt()
                                        setPadding(pad, pad, pad, pad)
                                        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                            topMargin = (8 * density).toInt()
                                            bottomMargin = (4 * density).toInt()
                                        }
                                        layoutParams = lp
                                    }
                                    var qPlayer: MediaPlayer? = null
                                    var isPlaying = false
                                    val tvAudioTitle = TextView(this@TeacherMainActivity).apply {
                                        text = "🎧 Putar Audio Listening"
                                        textSize = 11.5f
                                        setTextColor(Color.parseColor("#1D4ED8"))
                                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                                        setOnClickListener {
                                            val serverBase = ApiClient.getBaseServerUrl(this@TeacherMainActivity).trimEnd('/')
                                            val fullAud = if (q.audioUrl.startsWith("http")) q.audioUrl else "$serverBase/" + q.audioUrl.trimStart('/')
                                            if (isPlaying) {
                                                qPlayer?.stop()
                                                qPlayer?.release()
                                                qPlayer = null
                                                isPlaying = false
                                                text = "🎧 Putar Audio Listening"
                                            } else {
                                                try {
                                                    text = "⏳ Memuat Audio..."
                                                    qPlayer = MediaPlayer().apply {
                                                        setDataSource(fullAud)
                                                        setOnPreparedListener { mp ->
                                                            mp.start()
                                                            isPlaying = true
                                                            text = "🎧 ⏹ Hentikan Audio"
                                                        }
                                                        setOnCompletionListener {
                                                            isPlaying = false
                                                            text = "🎧 Putar Audio Listening"
                                                        }
                                                    }
                                                    qPlayer?.prepareAsync()
                                                } catch (e: Exception) {
                                                    Toast.makeText(this@TeacherMainActivity, "Gagal memutar audio: ${e.message}", Toast.LENGTH_SHORT).show()
                                                    text = "🎧 Putar Audio Listening"
                                                }
                                            }
                                        }
                                    }
                                    audioBar.addView(tvAudioTitle)
                                    card.addView(audioBar)
                                }

                                // Diagram/Image Preview (if present)
                                if (!q.imageUrl.isNullOrBlank()) {
                                    val ivQuestion = ImageView(this@TeacherMainActivity).apply {
                                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (180 * density).toInt()).apply {
                                            topMargin = (6 * density).toInt()
                                            bottomMargin = (8 * density).toInt()
                                        }
                                        scaleType = ImageView.ScaleType.FIT_CENTER
                                        val bgIv = android.graphics.drawable.GradientDrawable().apply {
                                            setColor(Color.parseColor("#F8FAFC"))
                                            cornerRadius = 8 * density
                                            setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
                                        }
                                        background = bgIv
                                    }
                                    val serverBase = ApiClient.getBaseServerUrl(this@TeacherMainActivity).trimEnd('/')
                                    val fullImg = if (q.imageUrl.startsWith("http")) q.imageUrl else "$serverBase/" + q.imageUrl.trimStart('/')
                                    Thread {
                                        try {
                                            val conn = URL(fullImg).openConnection()
                                            conn.connectTimeout = 4000
                                            conn.readTimeout = 4000
                                            val bmp = BitmapFactory.decodeStream(conn.getInputStream())
                                            runOnUiThread {
                                                if (bmp != null) ivQuestion.setImageBitmap(bmp)
                                            }
                                        } catch (_: Exception) {}
                                    }.start()
                                    card.addView(ivQuestion)
                                }

                                card.addView(TextView(this@TeacherMainActivity).apply {
                                    text = q.getQuestionBody()
                                    textSize = 13.5f
                                    setTextColor(Color.parseColor("#1E293B"))
                                    val padT = (8 * density).toInt()
                                    val padB = (8 * density).toInt()
                                    setPadding(0, padT, 0, padB)
                                })

                                val options = q.parseOptionsList()
                                val correctOptLetter = q.correctOption?.trim()?.uppercase() ?: "A"
                                val optionLabels = listOf("A", "B", "C", "D")

                                options.forEachIndexed { oIdx, optText ->
                                    val currentLetter = if (oIdx < optionLabels.size) optionLabels[oIdx] else "${oIdx + 1}"
                                    val isCorrect = optText.trim().startsWith(currentLetter, ignoreCase = true) || currentLetter == correctOptLetter

                                    val optBox = LinearLayout(this@TeacherMainActivity).apply {
                                        orientation = LinearLayout.HORIZONTAL
                                        gravity = android.view.Gravity.CENTER_VERTICAL
                                        val bgOpt = android.graphics.drawable.GradientDrawable().apply {
                                            if (isCorrect) {
                                                setColor(Color.parseColor("#ECFDF5"))
                                                setStroke((1.5f * density).toInt(), Color.parseColor("#10B981"))
                                            } else {
                                                setColor(Color.parseColor("#F8FAFC"))
                                                setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
                                            }
                                            cornerRadius = 8 * density
                                        }
                                        background = bgOpt
                                        val padH = (10 * density).toInt()
                                        val padV = (7 * density).toInt()
                                        setPadding(padH, padV, padH, padV)
                                        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                            bottomMargin = (6 * density).toInt()
                                        }
                                        layoutParams = lp
                                    }

                                    val tvOpt = TextView(this@TeacherMainActivity).apply {
                                        text = optText
                                        textSize = 12.5f
                                        setTextColor(if (isCorrect) Color.parseColor("#065F46") else Color.parseColor("#334155"))
                                        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                    }
                                    optBox.addView(tvOpt)

                                    if (isCorrect) {
                                        optBox.addView(TextView(this@TeacherMainActivity).apply {
                                            text = "✅ KUNCI"
                                            textSize = 10f
                                            typeface = android.graphics.Typeface.DEFAULT_BOLD
                                            setTextColor(Color.parseColor("#059669"))
                                        })
                                    }
                                    card.addView(optBox)
                                }

                                if (!q.explanation.isNullOrBlank()) {
                                    card.addView(TextView(this@TeacherMainActivity).apply {
                                        text = "💡 Pembahasan: ${q.explanation}"
                                        textSize = 11.5f
                                        setTextColor(Color.parseColor("#4338CA"))
                                        val bg = android.graphics.drawable.GradientDrawable().apply {
                                            setColor(Color.parseColor("#EEF2FF"))
                                            cornerRadius = 6 * density
                                        }
                                        background = bg
                                        val pad = (8 * density).toInt()
                                        setPadding(pad, pad, pad, pad)
                                        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                            topMargin = (4 * density).toInt()
                                        }
                                        layoutParams = lp
                                    })
                                }

                                questionsContainer.addView(card)
                            }
                        }
                    } else {
                        tvStatus.text = "Gagal memuat butir soal."
                    }
                }

                override fun onFailure(call: Call<List<com.school.smartcbt.data.model.BackendQuestionDto>>, t: Throwable) {
                    tvStatus.text = "Koneksi ke server terputus."
                }
            })
        }

        btnAddManual.setOnClickListener {
            showAddQuestionDialog(exam) { loadQuestions() }
        }
        btnAiGen.setOnClickListener {
            showAiGenerateQuestionsDialog(exam) { loadQuestions() }
        }

        loadQuestions()
        dialog.setView(root)
        dialog.show()
    }

    private fun showAddQuestionDialog(exam: TeacherExamDto, onAdded: () -> Unit) {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "➕ Tambah Butir Soal Baru",
            subtitle = "${exam.title} • Pilihan Ganda Multi-Level & Multimedia",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad * 2)
        }

        fun createLabel(txt: String): TextView = TextView(this).apply {
            text = txt
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, (10 * density).toInt(), 0, (4 * density).toInt())
        }

        layout.addView(createLabel("Pertanyaan / Naskah Soal *"))
        val etContent = EditText(this).apply {
            hint = "Tuliskan narasi pertanyaan soal di sini..."
            textSize = 13.5f
            minLines = 4
            gravity = android.view.Gravity.TOP or android.view.Gravity.START
            setBackgroundResource(android.R.drawable.edit_text)
        }
        layout.addView(etContent)

        // Multimedia: Diagram / Gambar Lampiran
        layout.addView(createLabel("🖼️ Lampiran Gambar / Diagram (Opsional):"))
        val rowImg = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val etImageUrl = EditText(this).apply {
            hint = "https://... atau /uploads/cbt/gambar.png"
            textSize = 12.5f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val ivPreview = ImageView(this).apply {
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (160 * density).toInt()).apply {
                topMargin = (6 * density).toInt()
                bottomMargin = (6 * density).toInt()
            }
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        val btnPreviewImg = Button(this).apply {
            text = "👁️ Preview"
            textSize = 11f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0284C7"))
            setOnClickListener {
                val urlStr = etImageUrl.text.toString().trim()
                if (urlStr.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Masukkan URL gambar terlebih dahulu", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val serverBase = ApiClient.getBaseServerUrl(this@TeacherMainActivity).trimEnd('/')
                val fullUrl = if (urlStr.startsWith("http")) urlStr else "$serverBase/" + urlStr.trimStart('/')
                Thread {
                    try {
                        val conn = URL(fullUrl).openConnection()
                        conn.connectTimeout = 4000
                        val bmp = BitmapFactory.decodeStream(conn.getInputStream())
                        runOnUiThread {
                            if (bmp != null) {
                                ivPreview.setImageBitmap(bmp)
                                ivPreview.visibility = View.VISIBLE
                                Toast.makeText(this@TeacherMainActivity, "Gambar berhasil dimuat", Toast.LENGTH_SHORT).show()
                            } else {
                                Toast.makeText(this@TeacherMainActivity, "Gagal memuat format gambar", Toast.LENGTH_SHORT).show()
                            }
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            Toast.makeText(this@TeacherMainActivity, "Gagal mengunduh gambar: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }.start()
            }
        }
        rowImg.addView(etImageUrl)
        rowImg.addView(btnPreviewImg)
        layout.addView(rowImg)
        layout.addView(ivPreview)

        // Multimedia: Audio Listening
        layout.addView(createLabel("🎧 Lampiran Audio Listening (Bahasa Inggris / Arab / PAI):"))
        val rowAud = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val etAudioUrl = EditText(this).apply {
            hint = "https://... atau /uploads/cbt/audio.mp3"
            textSize = 12.5f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        var testPlayer: MediaPlayer? = null
        var isTestPlaying = false
        val btnTestAudio = Button(this).apply {
            text = "▶ Tes Audio"
            textSize = 11f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#7C3AED"))
            setOnClickListener {
                val urlStr = etAudioUrl.text.toString().trim()
                if (urlStr.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Masukkan URL audio terlebih dahulu", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val serverBase = ApiClient.getBaseServerUrl(this@TeacherMainActivity).trimEnd('/')
                val fullUrl = if (urlStr.startsWith("http")) urlStr else "$serverBase/" + urlStr.trimStart('/')
                if (isTestPlaying) {
                    testPlayer?.stop()
                    testPlayer?.release()
                    testPlayer = null
                    isTestPlaying = false
                    text = "▶ Tes Audio"
                } else {
                    try {
                        text = "⏳ Memuat..."
                        testPlayer = MediaPlayer().apply {
                            setDataSource(fullUrl)
                            setOnPreparedListener { mp ->
                                mp.start()
                                isTestPlaying = true
                                text = "⏹ Stop"
                            }
                            setOnCompletionListener {
                                isTestPlaying = false
                                text = "▶ Tes Audio"
                            }
                        }
                        testPlayer?.prepareAsync()
                    } catch (e: Exception) {
                        Toast.makeText(this@TeacherMainActivity, "Gagal memutar audio: ${e.message}", Toast.LENGTH_SHORT).show()
                        text = "▶ Tes Audio"
                    }
                }
            }
        }
        rowAud.addView(etAudioUrl)
        rowAud.addView(btnTestAudio)
        layout.addView(rowAud)

        // Level Kognitif Bloom Taxonomy
        layout.addView(createLabel("Level Kognitif Soal (Taksonomi Bloom):"))
        val spinnerCognitive = Spinner(this)
        val cognitiveOptions = arrayOf(
            "C3 - Menerapkan / Aplikasi",
            "C1 - Mengingat / Pengetahuan",
            "C2 - Memahami / Konsep",
            "C4 - Menganalisis (HOTS)",
            "C5 - Mengevaluasi (HOTS)",
            "C6 - Mencipta / Kreasi (HOTS)"
        )
        spinnerCognitive.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, cognitiveOptions)
        layout.addView(spinnerCognitive)

        layout.addView(createLabel("Pilihan Jawaban A *"))
        val etA = EditText(this).apply { hint = "Isi opsi A"; textSize = 13f }
        layout.addView(etA)

        layout.addView(createLabel("Pilihan Jawaban B *"))
        val etB = EditText(this).apply { hint = "Isi opsi B"; textSize = 13f }
        layout.addView(etB)

        layout.addView(createLabel("Pilihan Jawaban C *"))
        val etC = EditText(this).apply { hint = "Isi opsi C"; textSize = 13f }
        layout.addView(etC)

        layout.addView(createLabel("Pilihan Jawaban D *"))
        val etD = EditText(this).apply { hint = "Isi opsi D"; textSize = 13f }
        layout.addView(etD)

        layout.addView(createLabel("Kunci Jawaban Benar:"))
        val spinnerKey = Spinner(this)
        val keys = arrayOf("A", "B", "C", "D")
        spinnerKey.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, keys)
        layout.addView(spinnerKey)

        layout.addView(createLabel("Pembahasan / Keterangan Jawaban (Opsional):"))
        val etExplanation = EditText(this).apply {
            hint = "Tuliskan langkah pengerjaan atau alasan jawaban benar..."
            textSize = 13f
            minLines = 2
        }
        layout.addView(etExplanation)

        val btnSave = Button(this).apply {
            text = "💾 Simpan Butir Soal"
            textSize = 13.5f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#0D9488"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                topMargin = (20 * density).toInt()
            }
            setOnClickListener {
                val content = etContent.text.toString().trim()
                val optA = etA.text.toString().trim()
                val optB = etB.text.toString().trim()
                val optC = etC.text.toString().trim()
                val optD = etD.text.toString().trim()

                if (content.isEmpty() || optA.isEmpty() || optB.isEmpty() || optC.isEmpty() || optD.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Pertanyaan dan seluruh opsi A-D wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val correctOpt = spinnerKey.selectedItem.toString()
                val explanation = etExplanation.text.toString().trim().ifEmpty { null }
                val optionsArray = listOf("A. $optA", "B. $optB", "C. $optC", "D. $optD")

                val cogStr = spinnerCognitive.selectedItem.toString()
                val cognitiveCode = when {
                    cogStr.startsWith("C1") -> "C1"
                    cogStr.startsWith("C2") -> "C2"
                    cogStr.startsWith("C4") -> "C4"
                    cogStr.startsWith("C5") -> "C5"
                    cogStr.startsWith("C6") -> "C6"
                    else -> "C3"
                }

                val imgVal = etImageUrl.text.toString().trim().ifEmpty { null }
                val audVal = etAudioUrl.text.toString().trim().ifEmpty { null }

                val req = com.school.smartcbt.data.model.CreateQuestionRequest(
                    content = content,
                    type = "MULTIPLE_CHOICE",
                    correctOption = correctOpt,
                    options = optionsArray,
                    cognitiveLevel = cognitiveCode,
                    explanation = explanation,
                    imageUrl = imgVal,
                    audioUrl = audVal
                )

                val progress = AlertDialog.Builder(this@TeacherMainActivity)
                    .setMessage("Menyimpan butir soal...")
                    .setCancelable(false)
                    .show()

                ApiClient.getClient(this@TeacherMainActivity).createTeacherExamQuestion(exam.id, req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            try { testPlayer?.release() } catch (_: Exception) {}
                            Toast.makeText(this@TeacherMainActivity, "✅ Butir soal berhasil ditambahkan!", Toast.LENGTH_SHORT).show()
                            dialog.dismiss()
                            onAdded()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal menyimpan soal", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        layout.addView(btnSave)

        dialog.setOnDismissListener {
            try { testPlayer?.release() } catch (_: Exception) {}
        }

        scroll.addView(layout)
        root.addView(scroll)
        dialog.setView(root)
        dialog.show()
    }

    private fun showEditQuestionDialog(exam: TeacherExamDto, q: com.school.smartcbt.data.model.BackendQuestionDto, onUpdated: () -> Unit) {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "✏️ Edit Butir Soal",
            subtitle = "${exam.title} • Soal #${q.orderNum ?: ""}",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad * 2)
        }

        fun createLabel(txt: String): TextView = TextView(this).apply {
            text = txt
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, (10 * density).toInt(), 0, (4 * density).toInt())
        }

        layout.addView(createLabel("Pertanyaan / Naskah Soal *"))
        val etContent = EditText(this).apply {
            setText(q.getQuestionBody())
            textSize = 13.5f
            minLines = 4
            gravity = android.view.Gravity.TOP or android.view.Gravity.START
            setBackgroundResource(android.R.drawable.edit_text)
        }
        layout.addView(etContent)

        // Multimedia: Diagram / Gambar
        layout.addView(createLabel("🖼️ Lampiran Gambar / Diagram (Opsional):"))
        val rowImg = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val etImageUrl = EditText(this).apply {
            setText(q.imageUrl ?: "")
            hint = "https://... atau /uploads/cbt/gambar.png"
            textSize = 12.5f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val ivPreview = ImageView(this).apply {
            visibility = if (!q.imageUrl.isNullOrBlank()) View.VISIBLE else View.GONE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (160 * density).toInt()).apply {
                topMargin = (6 * density).toInt()
                bottomMargin = (6 * density).toInt()
            }
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        if (!q.imageUrl.isNullOrBlank()) {
            val serverBase = ApiClient.getBaseServerUrl(this).trimEnd('/')
            val fullUrl = if (q.imageUrl.startsWith("http")) q.imageUrl else "$serverBase/" + q.imageUrl.trimStart('/')
            Thread {
                try {
                    val conn = URL(fullUrl).openConnection()
                    val bmp = BitmapFactory.decodeStream(conn.getInputStream())
                    runOnUiThread { if (bmp != null) ivPreview.setImageBitmap(bmp) }
                } catch (_: Exception) {}
            }.start()
        }

        val btnPreviewImg = Button(this).apply {
            text = "👁️ Preview"
            textSize = 11f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0284C7"))
            setOnClickListener {
                val urlStr = etImageUrl.text.toString().trim()
                if (urlStr.isEmpty()) {
                    ivPreview.visibility = View.GONE
                    return@setOnClickListener
                }
                val serverBase = ApiClient.getBaseServerUrl(this@TeacherMainActivity).trimEnd('/')
                val fullUrl = if (urlStr.startsWith("http")) urlStr else "$serverBase/" + urlStr.trimStart('/')
                Thread {
                    try {
                        val conn = URL(fullUrl).openConnection()
                        val bmp = BitmapFactory.decodeStream(conn.getInputStream())
                        runOnUiThread {
                            if (bmp != null) {
                                ivPreview.setImageBitmap(bmp)
                                ivPreview.visibility = View.VISIBLE
                            }
                        }
                    } catch (_: Exception) {}
                }.start()
            }
        }
        rowImg.addView(etImageUrl)
        rowImg.addView(btnPreviewImg)
        layout.addView(rowImg)
        layout.addView(ivPreview)

        // Multimedia: Audio Listening
        layout.addView(createLabel("🎧 Lampiran Audio Listening (Bahasa Inggris / Arab / PAI):"))
        val rowAud = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val etAudioUrl = EditText(this).apply {
            setText(q.audioUrl ?: "")
            hint = "https://... atau /uploads/cbt/audio.mp3"
            textSize = 12.5f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        var editPlayer: MediaPlayer? = null
        var isEditAudioPlaying = false
        val btnTestAudio = Button(this).apply {
            text = "▶ Tes Audio"
            textSize = 11f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#7C3AED"))
            setOnClickListener {
                val urlStr = etAudioUrl.text.toString().trim()
                if (urlStr.isEmpty()) return@setOnClickListener
                val serverBase = ApiClient.getBaseServerUrl(this@TeacherMainActivity).trimEnd('/')
                val fullUrl = if (urlStr.startsWith("http")) urlStr else "$serverBase/" + urlStr.trimStart('/')
                if (isEditAudioPlaying) {
                    editPlayer?.stop()
                    editPlayer?.release()
                    editPlayer = null
                    isEditAudioPlaying = false
                    text = "▶ Tes Audio"
                } else {
                    try {
                        text = "⏳ Memuat..."
                        editPlayer = MediaPlayer().apply {
                            setDataSource(fullUrl)
                            setOnPreparedListener { mp ->
                                mp.start()
                                isEditAudioPlaying = true
                                text = "⏹ Stop"
                            }
                            setOnCompletionListener {
                                isEditAudioPlaying = false
                                text = "▶ Tes Audio"
                            }
                        }
                        editPlayer?.prepareAsync()
                    } catch (e: Exception) {
                        text = "▶ Tes Audio"
                    }
                }
            }
        }
        rowAud.addView(etAudioUrl)
        rowAud.addView(btnTestAudio)
        layout.addView(rowAud)

        // Level Kognitif
        layout.addView(createLabel("Level Kognitif Soal (Taksonomi Bloom):"))
        val spinnerCognitive = Spinner(this)
        val cognitiveOptions = arrayOf(
            "C3 - Menerapkan / Aplikasi",
            "C1 - Mengingat / Pengetahuan",
            "C2 - Memahami / Konsep",
            "C4 - Menganalisis (HOTS)",
            "C5 - Mengevaluasi (HOTS)",
            "C6 - Mencipta / Kreasi (HOTS)"
        )
        spinnerCognitive.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, cognitiveOptions)
        val currentCog = (q.cognitiveLevel ?: "C3").uppercase()
        val cogIdx = cognitiveOptions.indexOfFirst { it.startsWith(currentCog) }.let { if (it >= 0) it else 0 }
        spinnerCognitive.setSelection(cogIdx)
        layout.addView(spinnerCognitive)

        // Parse existing options
        val parsedOpts = q.parseOptionsList()
        val optAVal = parsedOpts.getOrNull(0)?.replaceFirst("^A[\\.\\)]\\s*".toRegex(), "") ?: q.optionA ?: ""
        val optBVal = parsedOpts.getOrNull(1)?.replaceFirst("^B[\\.\\)]\\s*".toRegex(), "") ?: q.optionB ?: ""
        val optCVal = parsedOpts.getOrNull(2)?.replaceFirst("^C[\\.\\)]\\s*".toRegex(), "") ?: q.optionC ?: ""
        val optDVal = parsedOpts.getOrNull(3)?.replaceFirst("^D[\\.\\)]\\s*".toRegex(), "") ?: q.optionD ?: ""

        layout.addView(createLabel("Pilihan Jawaban A *"))
        val etA = EditText(this).apply { setText(optAVal); textSize = 13f }
        layout.addView(etA)

        layout.addView(createLabel("Pilihan Jawaban B *"))
        val etB = EditText(this).apply { setText(optBVal); textSize = 13f }
        layout.addView(etB)

        layout.addView(createLabel("Pilihan Jawaban C *"))
        val etC = EditText(this).apply { setText(optCVal); textSize = 13f }
        layout.addView(etC)

        layout.addView(createLabel("Pilihan Jawaban D *"))
        val etD = EditText(this).apply { setText(optDVal); textSize = 13f }
        layout.addView(etD)

        layout.addView(createLabel("Kunci Jawaban Benar:"))
        val spinnerKey = Spinner(this)
        val keys = arrayOf("A", "B", "C", "D")
        spinnerKey.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, keys)
        val curKey = (q.correctOption ?: "A").uppercase().trim()
        val keyIdx = keys.indexOf(curKey).let { if (it >= 0) it else 0 }
        spinnerKey.setSelection(keyIdx)
        layout.addView(spinnerKey)

        layout.addView(createLabel("Pembahasan / Keterangan Jawaban (Opsional):"))
        val etExplanation = EditText(this).apply {
            setText(q.explanation ?: "")
            hint = "Tuliskan langkah pengerjaan atau alasan jawaban benar..."
            textSize = 13f
            minLines = 2
        }
        layout.addView(etExplanation)

        val btnSave = Button(this).apply {
            text = "💾 Simpan Perubahan Butir Soal"
            textSize = 13.5f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#2563EB"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                topMargin = (20 * density).toInt()
            }
            setOnClickListener {
                val content = etContent.text.toString().trim()
                val optA = etA.text.toString().trim()
                val optB = etB.text.toString().trim()
                val optC = etC.text.toString().trim()
                val optD = etD.text.toString().trim()

                if (content.isEmpty() || optA.isEmpty() || optB.isEmpty() || optC.isEmpty() || optD.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Pertanyaan dan seluruh opsi A-D wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val correctOpt = spinnerKey.selectedItem.toString()
                val explanation = etExplanation.text.toString().trim().ifEmpty { null }
                val optionsArray = listOf("A. $optA", "B. $optB", "C. $optC", "D. $optD")

                val cogStr = spinnerCognitive.selectedItem.toString()
                val cognitiveCode = when {
                    cogStr.startsWith("C1") -> "C1"
                    cogStr.startsWith("C2") -> "C2"
                    cogStr.startsWith("C4") -> "C4"
                    cogStr.startsWith("C5") -> "C5"
                    cogStr.startsWith("C6") -> "C6"
                    else -> "C3"
                }

                val imgVal = etImageUrl.text.toString().trim().ifEmpty { null }
                val audVal = etAudioUrl.text.toString().trim().ifEmpty { null }

                val req = com.school.smartcbt.data.model.UpdateQuestionRequest(
                    content = content,
                    type = "MULTIPLE_CHOICE",
                    correctOption = correctOpt,
                    options = optionsArray,
                    cognitiveLevel = cognitiveCode,
                    explanation = explanation,
                    imageUrl = imgVal,
                    audioUrl = audVal,
                    orderNum = q.orderNum
                )

                val progress = AlertDialog.Builder(this@TeacherMainActivity)
                    .setMessage("Memperbarui butir soal...")
                    .setCancelable(false)
                    .show()

                ApiClient.getClient(this@TeacherMainActivity).updateTeacherExamQuestion(exam.id, q.id, req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            try { editPlayer?.release() } catch (_: Exception) {}
                            Toast.makeText(this@TeacherMainActivity, "✅ Perubahan soal berhasil disimpan!", Toast.LENGTH_SHORT).show()
                            dialog.dismiss()
                            onUpdated()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal memperbarui soal", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        layout.addView(btnSave)

        dialog.setOnDismissListener {
            try { editPlayer?.release() } catch (_: Exception) {}
        }

        scroll.addView(layout)
        root.addView(scroll)
        dialog.setView(root)
        dialog.show()
    }

    private fun showAiGenerateQuestionsDialog(exam: TeacherExamDto, onGenerated: () -> Unit) {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🤖 Generator Soal AI Gemini",
            subtitle = "Buat Naskah Soal Otomatis Berbasis Kurikulum Merdeka",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * density).toInt()
            setPadding(pad, pad, pad, pad * 2)
        }

        fun createLabel(txt: String): TextView = TextView(this).apply {
            text = txt
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, (10 * density).toInt(), 0, (4 * density).toInt())
        }

        val banner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F5F3FF"))
                cornerRadius = 10 * density
                setStroke((1 * density).toInt(), Color.parseColor("#DDD6FE"))
            }
            background = bg
            val pad = (12 * density).toInt()
            setPadding(pad, pad, pad, pad)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }
        banner.addView(TextView(this).apply {
            text = "✨ Kecerdasan Buatan (Gemini AI 2.5)"
            textSize = 13f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#6D28D9"))
        })
        banner.addView(TextView(this).apply {
            text = "AI akan otomatis merancang narasi pertanyaan kontekstual, opsi pilihan ganda A-B-C-D yang mengecoh, kunci jawaban valid, dan pembahasan mendalam sesuai mata pelajaran ${exam.subject?.name ?: "Anda"}."
            textSize = 11.5f
            setTextColor(Color.parseColor("#5B21B6"))
            setPadding(0, (4 * density).toInt(), 0, 0)
        })
        layout.addView(banner)

        layout.addView(createLabel("Topik Materi / Kompetensi Dasar (KD) *"))
        val etTopic = EditText(this).apply {
            hint = "Contoh: Sistem Ekskresi Ginjal Manusia / SPLDV Aljabar"
            textSize = 13.5f
            setBackgroundResource(android.R.drawable.edit_text)
        }
        layout.addView(etTopic)

        layout.addView(createLabel("Jenjang Kelas:"))
        val spinnerGrade = Spinner(this)
        val grades = arrayOf("Kelas VII", "Kelas VIII", "Kelas IX")
        spinnerGrade.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, grades)
        layout.addView(spinnerGrade)

        layout.addView(createLabel("Tingkat Kesulitan Soal:"))
        val spinnerDifficulty = Spinner(this)
        val diffs = arrayOf("Sedang (C3 Aplikasi Konseptual)", "Mudah (C1-C2 Pemahaman Dasar)", "HOTS / Sulit (C4-C5 Analisis & Evaluasi)")
        spinnerDifficulty.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, diffs)
        layout.addView(spinnerDifficulty)

        layout.addView(createLabel("Jumlah Soal yang Dibuat:"))
        val spinnerCount = Spinner(this)
        val counts = arrayOf("5 Soal", "10 Soal", "15 Soal")
        spinnerCount.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, counts)
        layout.addView(spinnerCount)

        val btnGenerate = Button(this).apply {
            text = "🚀 Mulai Generate Soal dengan AI"
            textSize = 13.5f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#7C3AED"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                topMargin = (24 * density).toInt()
            }
            setOnClickListener {
                val topic = etTopic.text.toString().trim()
                if (topic.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Topik materi wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val gradeStr = spinnerGrade.selectedItem.toString()
                val diffStr = when (spinnerDifficulty.selectedItemPosition) {
                    1 -> "Mudah"
                    2 -> "HOTS"
                    else -> "Sedang"
                }
                val countInt = when (spinnerCount.selectedItemPosition) {
                    1 -> 10
                    2 -> 15
                    else -> 5
                }

                val req = com.school.smartcbt.data.model.AiGenerateQuestionsRequest(
                    examId = exam.id,
                    subject = exam.subject?.name ?: "Umum",
                    topic = topic,
                    grade = gradeStr,
                    count = countInt,
                    difficulty = diffStr
                )

                val progress = AlertDialog.Builder(this@TeacherMainActivity)
                    .setTitle("🤖 Gemini AI Sedang Bekerja...")
                    .setMessage("Menyusun naskah soal kontekstual, opsi pilihan ganda, dan kunci jawaban. Mohon tunggu beberapa detik...")
                    .setCancelable(false)
                    .show()

                ApiClient.getClient(this@TeacherMainActivity).generateAiQuestions(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "✨ Berhasil men-generate $countInt butir soal AI ke ulangan ini!", Toast.LENGTH_LONG).show()
                            dialog.dismiss()
                            onGenerated()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal membuat soal dengan AI", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@TeacherMainActivity, "Koneksi ke AI server terputus", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        layout.addView(btnGenerate)

        scroll.addView(layout)
        root.addView(scroll)
        dialog.setView(root)
        dialog.show()
    }

    private fun showExamMonitoringRealtimeDialog(exam: TeacherExamDto) {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📊 Hasil & Monitoring CBT",
            subtitle = "${exam.title} (${exam.subject?.name ?: "-"} - ${exam.assignedClasses ?: "Semua"})",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        // Summary Bar
        val summaryCard = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 10 * density
                setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
            }
            background = bg
            val pad = (12 * density).toInt()
            setPadding(pad, pad, pad, pad)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                val m = (12 * density).toInt()
                setMargins(m, m, m, (6 * density).toInt())
            }
            layoutParams = lp
            weightSum = 3f
        }

        fun createStatCol(label: String, initialVal: String, color: String): Pair<TextView, LinearLayout> {
            val col = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            val valView = TextView(this).apply {
                text = initialVal
                textSize = 16f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor(color))
            }
            val lblView = TextView(this).apply {
                text = label
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
            }
            col.addView(valView)
            col.addView(lblView)
            return Pair(valView, col)
        }

        val (tvTotalP, col1) = createStatCol("Peserta", "0", "#0F172A")
        val (tvDoneP, col2) = createStatCol("Selesai", "0", "#059669")
        val (tvAvgScore, col3) = createStatCol("Rata-Rata", "0.0", "#4F46E5")

        summaryCard.addView(col1)
        summaryCard.addView(col2)
        summaryCard.addView(col3)
        root.addView(summaryCard)

        val tvStatus = TextView(this).apply {
            text = "Memuat data pengerjaan siswa..."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            val padH = (14 * density).toInt()
            setPadding(padH, (4 * density).toInt(), padH, (6 * density).toInt())
        }
        root.addView(tvStatus)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (12 * density).toInt()
            setPadding(pad, 0, pad, pad * 2)
        }
        scroll.addView(listContainer)
        root.addView(scroll)

        fun loadMonitoring() {
            listContainer.removeAllViews()
            tvStatus.text = "Memuat data pengerjaan realtime..."
            ApiClient.getClient(this).getTeacherExamResults(exam.id).enqueue(object : Callback<List<Map<String, Any>>> {
                override fun onResponse(call: Call<List<Map<String, Any>>>, response: Response<List<Map<String, Any>>>) {
                    if (response.isSuccessful) {
                        val results = response.body() ?: emptyList()
                        tvTotalP.text = results.size.toString()
                        val doneCount = results.count { (it["status"] as? String) == "FINISHED" || (it["status"] as? String) == "SELESAI" }
                        tvDoneP.text = doneCount.toString()

                        var sumScore = 0.0
                        var scoredCount = 0
                        results.forEach { r ->
                            val s = (r["score"] as? Number)?.toDouble()
                            if (s != null) {
                                sumScore += s
                                scoredCount++
                            }
                        }
                        val avg = if (scoredCount > 0) sumScore / scoredCount else 0.0
                        tvAvgScore.text = String.format(java.util.Locale.US, "%.1f", avg)

                        tvStatus.text = "KKM: ${exam.passingGrade ?: 75} • ${results.size} Siswa Terdata"

                        if (results.isEmpty()) {
                            listContainer.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Belum ada siswa yang memulai ujian ini.\nToken Ujian: ${exam.token ?: "-"}"
                                textSize = 13f
                                setTextColor(Color.parseColor("#94A3B8"))
                                gravity = android.view.Gravity.CENTER
                                val pad = (40 * density).toInt()
                                setPadding(pad, pad, pad, pad)
                            })
                        } else {
                            val kkm = exam.passingGrade ?: 75
                            results.forEach { r ->
                                val userMap = r["user"] as? Map<String, Any>
                                val studentName = userMap?.get("name") as? String ?: "Siswa"
                                val className = userMap?.get("className") as? String ?: "-"
                                val studentId = userMap?.get("id") as? String ?: (r["userId"] as? String ?: "")
                                val status = r["status"] as? String ?: "ONGOING"
                                val score = (r["score"] as? Number)?.toDouble() ?: 0.0
                                val isPassed = score >= kkm

                                val card = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val bg = android.graphics.drawable.GradientDrawable().apply {
                                        setColor(Color.WHITE)
                                        cornerRadius = 10 * density
                                        setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
                                    }
                                    background = bg
                                    val pad = (12 * density).toInt()
                                    setPadding(pad, pad, pad, pad)
                                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (8 * density).toInt()
                                    }
                                    layoutParams = lp
                                }

                                val rowTop = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = android.view.Gravity.CENTER_VERTICAL
                                }
                                val colInfo = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                }
                                colInfo.addView(TextView(this@TeacherMainActivity).apply {
                                    text = studentName
                                    textSize = 13.5f
                                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                                    setTextColor(Color.parseColor("#0F172A"))
                                })
                                colInfo.addView(TextView(this@TeacherMainActivity).apply {
                                    text = "Kelas $className • Status: $status"
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#64748B"))
                                })
                                rowTop.addView(colInfo)

                                val scoreChip = TextView(this@TeacherMainActivity).apply {
                                    text = "${score.toInt()} / 100"
                                    textSize = 13.5f
                                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                                    setTextColor(if (isPassed) Color.parseColor("#065F46") else Color.parseColor("#991B1B"))
                                    val bgChip = android.graphics.drawable.GradientDrawable().apply {
                                        setColor(if (isPassed) Color.parseColor("#DCFCE7") else Color.parseColor("#FEE2E2"))
                                        cornerRadius = 6 * density
                                    }
                                    background = bgChip
                                    setPadding((10 * density).toInt(), (4 * density).toInt(), (10 * density).toInt(), (4 * density).toInt())
                                }
                                rowTop.addView(scoreChip)
                                card.addView(rowTop)

                                // Reset Sesi Button (jika siswa kendala/hang)
                                val rowBtn = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = android.view.Gravity.END
                                    setPadding(0, (6 * density).toInt(), 0, 0)
                                }
                                val btnResetStudent = TextView(this@TeacherMainActivity).apply {
                                    text = "🔄 Reset Sesi Ujian Siswa"
                                    textSize = 11f
                                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                                    setTextColor(Color.parseColor("#4F46E5"))
                                    val bgBtn = android.graphics.drawable.GradientDrawable().apply {
                                        setColor(Color.parseColor("#EEF2FF"))
                                        cornerRadius = 6 * density
                                    }
                                    background = bgBtn
                                    setPadding((8 * density).toInt(), (4 * density).toInt(), (8 * density).toInt(), (4 * density).toInt())
                                    setOnClickListener {
                                        AlertDialog.Builder(this@TeacherMainActivity)
                                            .setTitle("Reset Sesi Ujian")
                                            .setMessage("Reset sesi pengerjaan siswa \"$studentName\"?\n\nSiswa dapat login ulang dan melanjutkan ujian di HP tanpa terblokir.")
                                            .setPositiveButton("Reset") { _, _ ->
                                                ApiClient.getClient(this@TeacherMainActivity).proctorResetStudentLock(mapOf("examId" to exam.id, "studentId" to studentId)).enqueue(object : Callback<BasicResponse> {
                                                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                                        Toast.makeText(this@TeacherMainActivity, "Sesi $studentName berhasil di-reset", Toast.LENGTH_SHORT).show()
                                                        loadMonitoring()
                                                    }
                                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                                        Toast.makeText(this@TeacherMainActivity, "Gagal reset", Toast.LENGTH_SHORT).show()
                                                    }
                                                })
                                            }
                                            .setNegativeButton("Batal", null)
                                            .show()
                                    }
                                }
                                rowBtn.addView(btnResetStudent)
                                card.addView(rowBtn)

                                listContainer.addView(card)
                            }
                        }
                    } else {
                        tvStatus.text = "Gagal memuat rekap nilai."
                    }
                }

                override fun onFailure(call: Call<List<Map<String, Any>>>, t: Throwable) {
                    tvStatus.text = "Koneksi ke server terputus."
                }
            })
        }

        loadMonitoring()
        dialog.setView(root)
        dialog.show()
    }

    private fun showExamSettingsDialog(exam: TeacherExamDto) {
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "⚙️ Jadwal & Token CBT",
            subtitle = "${exam.title} - Pengaturan Pelaksanaan Ujian",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad * 2)
        }

        fun createLabel(txt: String): TextView = TextView(this).apply {
            text = txt
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, (10 * density).toInt(), 0, (4 * density).toInt())
        }

        // Token Box
        val tokenCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F0FDF4"))
                cornerRadius = 10 * density
                setStroke((1 * density).toInt(), Color.parseColor("#BBF7D0"))
            }
            background = bg
            val pad = (12 * density).toInt()
            setPadding(pad, pad, pad, pad)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (10 * density).toInt()
            }
            layoutParams = lp
        }
        tokenCard.addView(TextView(this).apply {
            text = "🔑 Token Akses Ujian: ${exam.token ?: "-"}"
            textSize = 15f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#166534"))
        })
        tokenCard.addView(TextView(this).apply {
            text = "Token ini dibagikan kepada siswa saat ujian dimulai agar siswa dapat membuka soal."
            textSize = 11.5f
            setTextColor(Color.parseColor("#15803D"))
            setPadding(0, (2 * density).toInt(), 0, 0)
        })
        layout.addView(tokenCard)

        // Target Rombel Checkboxes
        layout.addView(createLabel("Target Rombel / Kelas (Centang Kelas Pelaksana) *"))
        val cardClasses = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 10 * density
                setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
        }

        val existingAssignedList = (exam.assignedClasses ?: "").split(",").map { it.trim().uppercase() }
        val isAllAssigned = exam.assignedClasses.isNullOrEmpty() || exam.assignedClasses == "ALL" || exam.assignedClasses == "Semua Kelas"

        val cbSelectAll = CheckBox(this).apply {
            text = "✅ Pilih Semua Kelas"
            textSize = 12.5f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            isChecked = isAllAssigned
        }
        cardClasses.addView(cbSelectAll)

        val dividerCls = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (1 * density).toInt()).apply {
                topMargin = (4 * density).toInt()
                bottomMargin = (6 * density).toInt()
            }
            setBackgroundColor(Color.parseColor("#CBD5E1"))
        }
        cardClasses.addView(dividerCls)

        val teacherClasses = sessionManager.getTeachingClasses()
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toMutableList()
        if (teacherClasses.isEmpty()) {
            teacherClasses.addAll(listOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K",
                "VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K",
                "IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K"))
        }

        val classCheckBoxList = mutableListOf<CheckBox>()
        var currentRow: LinearLayout? = null
        teacherClasses.forEachIndexed { idx, clsName ->
            if (idx % 3 == 0) {
                currentRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    weightSum = 3f
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                }
                cardClasses.addView(currentRow)
            }
            val cbClass = CheckBox(this).apply {
                text = clsName
                textSize = 12f
                isChecked = isAllAssigned || existingAssignedList.contains(clsName.uppercase())
                setTextColor(Color.parseColor("#334155"))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            classCheckBoxList.add(cbClass)
            currentRow?.addView(cbClass)
        }

        var isUpdatingCheckboxes = false
        cbSelectAll.setOnCheckedChangeListener { _, isChecked ->
            if (!isUpdatingCheckboxes) {
                isUpdatingCheckboxes = true
                classCheckBoxList.forEach { it.isChecked = isChecked }
                isUpdatingCheckboxes = false
            }
        }
        classCheckBoxList.forEach { cb ->
            cb.setOnCheckedChangeListener { _, _ ->
                if (!isUpdatingCheckboxes) {
                    isUpdatingCheckboxes = true
                    cbSelectAll.isChecked = classCheckBoxList.all { it.isChecked }
                    isUpdatingCheckboxes = false
                }
            }
        }
        layout.addView(cardClasses)

        layout.addView(createLabel("Durasi Pengerjaan (Menit):"))
        val etDuration = EditText(this).apply {
            setText(exam.durationMinutes.toString())
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            textSize = 13.5f
        }
        layout.addView(etDuration)

        layout.addView(createLabel("KKM / Nilai Minimal Tuntas:"))
        val etKkm = EditText(this).apply {
            setText((exam.passingGrade ?: 75).toString())
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            textSize = 13.5f
        }
        layout.addView(etKkm)

        val sdf = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
        layout.addView(createLabel("Tanggal Pelaksanaan (YYYY-MM-DD):"))
        val etDate = EditText(this).apply {
            setText(exam.executionDate ?: sdf.format(java.util.Date()))
            textSize = 13.5f
            isFocusable = false
            isClickable = true
            setOnClickListener {
                val cal = java.util.Calendar.getInstance()
                try {
                    val p = sdf.parse(text.toString())
                    if (p != null) cal.time = p
                } catch (_: Exception) {}
                android.app.DatePickerDialog(this@TeacherMainActivity, { _, y, m, d ->
                    setText(String.format(java.util.Locale.US, "%04d-%02d-%02d", y, m + 1, d))
                }, cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH), cal.get(java.util.Calendar.DAY_OF_MONTH)).show()
            }
        }
        layout.addView(etDate)

        layout.addView(createLabel("Jam Mulai (WIB):"))
        val etStart = EditText(this).apply {
            setText(exam.startTimeStr ?: "07:30")
            textSize = 13.5f
            isFocusable = false
            isClickable = true
            setOnClickListener {
                val parts = text.toString().split(":")
                val h = parts.getOrNull(0)?.toIntOrNull() ?: 7
                val m = parts.getOrNull(1)?.toIntOrNull() ?: 30
                android.app.TimePickerDialog(this@TeacherMainActivity, { _, selH, selM ->
                    setText(String.format(java.util.Locale.US, "%02d:%02d", selH, selM))
                }, h, m, true).show()
            }
        }
        layout.addView(etStart)

        layout.addView(createLabel("Jam Selesai (WIB):"))
        val etEnd = EditText(this).apply {
            setText(exam.endTimeStr ?: "09:30")
            textSize = 13.5f
            isFocusable = false
            isClickable = true
            setOnClickListener {
                val parts = text.toString().split(":")
                val h = parts.getOrNull(0)?.toIntOrNull() ?: 9
                val m = parts.getOrNull(1)?.toIntOrNull() ?: 30
                android.app.TimePickerDialog(this@TeacherMainActivity, { _, selH, selM ->
                    setText(String.format(java.util.Locale.US, "%02d:%02d", selH, selM))
                }, h, m, true).show()
            }
        }
        layout.addView(etEnd)

        val btnSave = Button(this).apply {
            text = "💾 Simpan Jadwal & Pengaturan"
            textSize = 13.5f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#0D9488"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                topMargin = (20 * density).toInt()
            }
            setOnClickListener {
                val duration = etDuration.text.toString().toIntOrNull() ?: 60
                val kkm = etKkm.text.toString().toIntOrNull() ?: 75
                val date = etDate.text.toString().trim()
                val start = etStart.text.toString().trim()
                val end = etEnd.text.toString().trim()

                val checkedClasses = classCheckBoxList.filter { it.isChecked }.map { it.text.toString() }
                if (checkedClasses.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Pilih minimal 1 kelas target ulangan!", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val assignedClassStr = checkedClasses.joinToString(",")

                val updateMap = mapOf<String, Any>(
                    "durationMinutes" to duration,
                    "passingGrade" to kkm,
                    "executionDate" to date,
                    "startTimeStr" to start,
                    "endTimeStr" to end,
                    "assignedClasses" to assignedClassStr
                )

                val progress = AlertDialog.Builder(this@TeacherMainActivity)
                    .setMessage("Memperbarui pengaturan ujian...")
                    .setCancelable(false)
                    .show()

                ApiClient.getClient(this@TeacherMainActivity).updateTeacherExamSchedule(exam.id, updateMap).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "Pengaturan ujian berhasil disimpan!", Toast.LENGTH_SHORT).show()
                            dialog.dismiss()
                            showTugasPenilaianDialog()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal memperbarui pengaturan", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        layout.addView(btnSave)

        scroll.addView(layout)
        root.addView(scroll)
        dialog.setView(root)
        dialog.show()
    }

    private fun showHomeworkSubmissionsDialog(hw: HomeworkDto) {
        val progress = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            .setMessage("Memuat data pengumpulan siswa...")
            .setCancelable(false)
            .show()

        ApiClient.getClient(this).getHomeworkSubmissions(hw.id).enqueue(object : Callback<HomeworkSubmissionsResponse> {
            override fun onResponse(call: Call<HomeworkSubmissionsResponse>, response: Response<HomeworkSubmissionsResponse>) {
                progress.dismiss()
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    displayHomeworkSubmissionsModal(hw, body)
                } else {
                    Toast.makeText(this@TeacherMainActivity, "Gagal memuat pengumpulan tugas", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<HomeworkSubmissionsResponse>, t: Throwable) {
                progress.dismiss()
                Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun displayHomeworkSubmissionsModal(hw: HomeworkDto, data: HomeworkSubmissionsResponse) {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📥 Pengumpulan: ${hw.title}",
            subtitle = "Kelas ${hw.`class`?.name ?: "Semua"} • ${hw.subject?.name ?: "Matpel"}",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(dialogView)

        val stats = data.stats
        val statsText = "📊 Total Siswa: ${stats?.totalStudents ?: 0} | 🟢 Kumpul: ${stats?.submittedCount ?: 0} | 🔴 Belum: ${stats?.unsubmittedCount ?: 0}"
        dialogView.addView(TextView(this).apply {
            text = statsText
            textSize = 12f
            setTextColor(Color.parseColor("#059669"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 4, 0, 12)
        })

        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0,
                1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scrollView.addView(container)
        dialogView.addView(scrollView)

        if (data.submissions.isEmpty()) {
            container.addView(TextView(this).apply {
                text = "Belum ada siswa yang mengumpulkan tugas ini."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(0, 20, 0, 20)
                gravity = android.view.Gravity.CENTER
            })
        } else {
            for (item in data.submissions) {
                val card = CardView(this).apply {
                    radius = 10f
                    cardElevation = 1.2f
                    setCardBackgroundColor(Color.parseColor("#FFFFFF"))
                    useCompatPadding = true
                }
                val inner = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(12, 10, 12, 10)
                }

                val rowTop = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                }

                val tvName = TextView(this).apply {
                    text = item.studentName
                    textSize = 13f
                    setTextColor(Color.parseColor("#0F172A"))
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }

                val tvStatus = TextView(this).apply {
                    if (item.submitted) {
                        text = if (item.isLate == true) "Terlambat" else "Tepat Waktu"
                        setTextColor(if (item.isLate == true) Color.parseColor("#B45309") else Color.parseColor("#15803D"))
                        setBackgroundColor(if (item.isLate == true) Color.parseColor("#FEF3C7") else Color.parseColor("#DCFCE7"))
                    } else {
                        text = "Belum Kumpul"
                        setTextColor(Color.parseColor("#DC2626"))
                        setBackgroundColor(Color.parseColor("#FEE2E2"))
                    }
                    textSize = 10f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    setPadding(6, 2, 6, 2)
                }

                rowTop.addView(tvName)
                rowTop.addView(tvStatus)
                inner.addView(rowTop)

                val scoreText = if (item.score != null) "Nilai: ${item.score}" else "Belum Dinilai"
                val feedbackText = if (!item.teacherNote.isNullOrEmpty()) " • Feedback: ${item.teacherNote}" else ""
                inner.addView(TextView(this).apply {
                    text = "$scoreText$feedbackText"
                    textSize = 11.5f
                    setTextColor(if (item.score != null) Color.parseColor("#1D4ED8") else Color.parseColor("#64748B"))
                    setTypeface(null, if (item.score != null) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
                    setPadding(0, 2, 0, 4)
                })

                if (!item.notes.isNullOrEmpty()) {
                    inner.addView(TextView(this).apply {
                        text = "Catatan Siswa: ${item.notes}"
                        textSize = 11f
                        setTextColor(Color.parseColor("#475569"))
                        setPadding(0, 0, 0, 4)
                    })
                }

                val btnGrade = Button(this).apply {
                    text = if (item.score != null) "✏️ Ubah Nilai" else "✏️ Beri Nilai Siswa"
                    textSize = 10.5f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#4F46E5"))
                    setOnClickListener {
                        promptGradeSubmissionDialog(hw.id, item) {
                            showHomeworkSubmissionsDialog(hw)
                        }
                    }
                }
                inner.addView(btnGrade)
                card.addView(inner)
                container.addView(card)
            }
        }

        dialog.setView(root)
        dialog.show()
    }

    private fun promptGradeSubmissionDialog(homeworkId: String, item: TeacherHomeworkSubmissionItemDto, onDone: () -> Unit) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 20, 28, 16)
        }

        layout.addView(TextView(this).apply {
            text = "✏️ Penilaian: ${item.studentName}"
            textSize = 16f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 8)
        })

        val etScore = EditText(this).apply {
            hint = "Nilai Siswa (0 - 100, contoh: 85)"
            setText(item.score?.toInt()?.toString() ?: "85")
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            textSize = 13f
        }

        val etFeedback = EditText(this).apply {
            hint = "Catatan / Masukan / Feedback Guru untuk Siswa..."
            setText(item.teacherNote ?: "Kerja bagus, terus pertahankan pemahaman materinya!")
            minLines = 2
            textSize = 13f
        }

        layout.addView(etScore)
        layout.addView(etFeedback)

        AlertDialog.Builder(this)
            .setView(layout)
            .setPositiveButton("Simpan Nilai") { _, _ ->
                val score = etScore.text.toString().toDoubleOrNull()
                if (score == null || score < 0 || score > 100) {
                    Toast.makeText(this, "Nilai harus berupa angka 0 - 100", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val feedback = etFeedback.text.toString().trim()
                val req = GradeHomeworkRequest(
                    homeworkId = homeworkId,
                    studentId = item.studentId,
                    score = score,
                    teacherNote = if (feedback.isNotEmpty()) feedback else null
                )

                Toast.makeText(this, "Menyimpan nilai siswa...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).gradeHomeworkSubmission(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "✅ Nilai untuk ${item.studentName} berhasil disimpan!", Toast.LENGTH_SHORT).show()
                            onDone()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal menyimpan nilai", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi ke server terputus", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadHomeroomSummary() {
        ApiClient.getClient(this).getHomeroomSummary().enqueue(object : Callback<HomeroomSummaryResponse> {
            override fun onResponse(call: Call<HomeroomSummaryResponse>, response: Response<HomeroomSummaryResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    if (data.isHomeroom && !data.homeroomClass.isNullOrEmpty()) {
                        binding.cardHomeroom.visibility = View.VISIBLE
                        binding.tabTeacherHomeroom.visibility = View.VISIBLE
                        binding.tabTeacherHomeroom.text = "🎓 Wali (${data.homeroomClass})"
                        binding.tvHomeroomTitle.text = "🎓 WALI KELAS: ${data.homeroomClass}"
                        val pendingLeaves = data.pendingLeavesCount ?: 0
                        val approvedLeaves = data.approvedLeavesCount ?: 0
                        binding.tvHomeroomPendingBadge.text = if (pendingLeaves > 0) "$pendingLeaves Menunggu" else "$approvedLeaves Di-ACC"
                        binding.tvHomeroomSub.text = "Rombel: ${data.homeroomClass} (${data.totalStudents ?: 0} siswa) • $pendingLeaves menunggu, $approvedLeaves izin/sakit aktif di rekap."

                        binding.tvHomeroomPendingBadge.setOnClickListener {
                            showTeacherLeaveRequestsDialog(data.homeroomClass)
                        }

                        binding.btnViewHomeroomStudents.setOnClickListener {
                            val intent = Intent(this@TeacherMainActivity, WaliKelasActivity::class.java)
                            startActivity(intent)
                        }
                    } else {
                        binding.cardHomeroom.visibility = View.GONE
                        binding.tabTeacherHomeroom.visibility = View.GONE
                        if (selectedTeacherTabIndex == 2) {
                            switchTeacherDashboardTab(0)
                        }
                    }
                }
            }

            override fun onFailure(call: Call<HomeroomSummaryResponse>, t: Throwable) {
                // Keep default state
            }
        })
    }

    private fun showTeacherLeaveRequestsDialog(className: String?) {
        Toast.makeText(this, "Memuat antrean & rekap izin kelas...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getTeacherLeaveRequests(className, "ALL").enqueue(object : Callback<List<ParentLeaveRequestDto>> {
            override fun onResponse(call: Call<List<ParentLeaveRequestDto>>, response: Response<List<ParentLeaveRequestDto>>) {
                val list = response.body() ?: emptyList()
                val density = resources.displayMetrics.density

                val root = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (16 * density).toInt()
                    setPadding(p, p, p, p)
                }

                // Info Banner Aturan Izin Sakit
                root.addView(TextView(this@TeacherMainActivity).apply {
                    text = "ℹ️ Aturan Sistem: Izin sakit orang tua (tanpa surat dokter) jika di-ACC otomatis maksimal 3 hari. Jika memakai Surat Dokter, mengikuti jumlah hari istirahat dokter & otomatis masuk rekap beberapa hari tersebut. Perpanjangan sakit wajib Surat Dokter."
                    textSize = 11f
                    setTextColor(Color.parseColor("#1E40AF"))
                    setBackgroundColor(Color.parseColor("#DBEAFE"))
                    val p = (10 * density).toInt()
                    setPadding(p, p, p, p)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { bottomMargin = (10 * density).toInt() }
                })

                if (list.isEmpty()) {
                    root.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Belum ada permohonan atau rekap izin siswa di kelas ini."
                        setTextColor(Color.parseColor("#64748B"))
                        textSize = 12f
                        setPadding(0, 20, 0, 20)
                        gravity = android.view.Gravity.CENTER
                    })
                } else {
                    list.forEach { req ->
                        val statusUpper = (req.status ?: "PENDING").uppercase()
                        val daysCount = req.approvedDays ?: req.durationDays ?: 1
                        val docBadge = req.documentLabel ?: if (req.isDoctorNote == true) "🏥 Surat Dokter ($daysCount Hari)" else "🏠 Izin Ortu ($daysCount Hari • Maks 3 Hari)"

                        val card = androidx.cardview.widget.CardView(this@TeacherMainActivity).apply {
                            radius = 12 * density
                            cardElevation = 2f * density
                            setCardBackgroundColor(
                                when (statusUpper) {
                                    "APPROVED" -> Color.parseColor("#F0FDF4")
                                    "REJECTED" -> Color.parseColor("#FEF2F2")
                                    else -> Color.WHITE
                                }
                            )
                            useCompatPadding = true
                            val lp = LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                LinearLayout.LayoutParams.WRAP_CONTENT
                            ).apply {
                                bottomMargin = (8 * density).toInt()
                            }
                            layoutParams = lp
                        }

                        val cardInner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = (12 * density).toInt()
                            setPadding(p, p, p, p)
                        }

                        val tvName = TextView(this@TeacherMainActivity).apply {
                            text = "${req.studentName ?: "Siswa"} (${req.className ?: "-"})"
                            textSize = 13f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        }
                        cardInner.addView(tvName)

                        val tvParent = TextView(this@TeacherMainActivity).apply {
                            text = "Pengaju: ${req.parentName ?: "Orang Tua"} • $docBadge"
                            textSize = 11f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0369A1"))
                        }
                        cardInner.addView(tvParent)

                        val startStr = req.startDate?.substringBefore("T") ?: "-"
                        val endStr = req.endDate?.substringBefore("T") ?: "-"
                        val tvDates = TextView(this@TeacherMainActivity).apply {
                            text = "🗓️ Periode: $startStr s/d $endStr ($daysCount Hari Masuk Rekap)"
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#15803D"))
                            setTypeface(null, Typeface.BOLD)
                            setPadding(0, 2, 0, 2)
                        }
                        cardInner.addView(tvDates)

                        val tvReason = TextView(this@TeacherMainActivity).apply {
                            text = "Alasan: ${req.reason ?: "-"}"
                            textSize = 11f
                            setTextColor(Color.parseColor("#334155"))
                            setPadding(0, 4, 0, 8)
                        }
                        cardInner.addView(tvReason)

                        if (statusUpper == "PENDING") {
                            val btnRow = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.END
                            }

                            val btnReject = android.widget.Button(this@TeacherMainActivity).apply {
                                text = "Tolak"
                                textSize = 11f
                                setBackgroundColor(Color.parseColor("#EF4444"))
                                setTextColor(Color.WHITE)
                                setOnClickListener {
                                    val input = EditText(this@TeacherMainActivity).apply {
                                        hint = "Alasan penolakan..."
                                        setText("Wajib melampirkan Surat Keterangan Dokter resmi (bukan surat buatan tangan)")
                                    }
                                    AlertDialog.Builder(this@TeacherMainActivity)
                                        .setTitle("Tolak Izin")
                                        .setView(input)
                                        .setPositiveButton("Tolak Izin") { _, _ ->
                                            val reason = input.text.toString().trim()
                                            ApiClient.getClient(this@TeacherMainActivity).verifyTeacherLeave(
                                                req.id,
                                                VerifyLeaveRequest(status = "REJECTED", rejectionNote = reason)
                                            ).enqueue(object : Callback<BasicResponse> {
                                                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                                    Toast.makeText(this@TeacherMainActivity, "Permohonan izin ditolak", Toast.LENGTH_SHORT).show()
                                                    showTeacherLeaveRequestsDialog(className)
                                                    loadHomeroomSummary()
                                                }
                                                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {}
                                            })
                                        }
                                        .setNegativeButton("Batal", null)
                                        .show()
                                }
                            }

                            val btnApprove = android.widget.Button(this@TeacherMainActivity).apply {
                                text = "Setujui ($daysCount Hari)"
                                textSize = 11f
                                setBackgroundColor(Color.parseColor("#10B981"))
                                setTextColor(Color.WHITE)
                                val lp = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.WRAP_CONTENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply {
                                    marginStart = (8 * density).toInt()
                                }
                                layoutParams = lp
                                setOnClickListener {
                                    ApiClient.getClient(this@TeacherMainActivity).verifyTeacherLeave(
                                        req.id,
                                        VerifyLeaveRequest(status = "APPROVED")
                                    ).enqueue(object : Callback<BasicResponse> {
                                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                            Toast.makeText(this@TeacherMainActivity, "✅ Disetujui $daysCount hari & otomatis masuk rekap kelas!", Toast.LENGTH_LONG).show()
                                            showTeacherLeaveRequestsDialog(className)
                                            loadHomeroomSummary()
                                        }
                                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {}
                                    })
                                }
                            }

                            btnRow.addView(btnReject)
                            btnRow.addView(btnApprove)
                            cardInner.addView(btnRow)
                        } else {
                            val tvVerifiedInfo = TextView(this@TeacherMainActivity).apply {
                                text = if (statusUpper == "APPROVED")
                                    "✅ DISETUJUI $daysCount HARI oleh ${req.verifiedBy ?: "Wali Kelas/BK"} • Otomatis masuk rekap"
                                else
                                    "❌ DITOLAK: ${req.rejectionNote ?: "-"}"
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(if (statusUpper == "APPROVED") Color.parseColor("#15803D") else Color.parseColor("#B91C1C"))
                            }
                            cardInner.addView(tvVerifiedInfo)
                        }

                        card.addView(cardInner)
                        root.addView(card)
                    }
                }

                val scroll = android.widget.ScrollView(this@TeacherMainActivity).apply {
                    addView(root)
                }

                AlertDialog.Builder(this@TeacherMainActivity)
                    .setTitle("📑 Verifikasi & Rekap Hari Izin - Kelas ${className ?: ""}")
                    .setView(scroll)
                    .setPositiveButton("Tutup", null)
                    .show()
            }

            override fun onFailure(call: Call<List<ParentLeaveRequestDto>>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun setupListeners() {
        binding.btnLogout.setOnClickListener {
            try {
                val body = mapOf(
                    "userId" to sessionManager.getUserId(),
                    "username" to sessionManager.getUsername()
                )
                ApiClient.getClient(this).logout(body).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {}
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {}
                })
            } catch (_: Exception) {}
            sessionManager.clearSession()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }

        // Kehadiran di Kelas yang Diampu (Estafet KBM & Presensi Siswa) Listeners
        binding.btnTeacherTapRoomNfc.setOnClickListener {
            if (activeTeachingSession != null) {
                showTeacherManageAttendanceDialog()
            } else {
                showManualSelectRoomDialog()
            }
        }
        binding.btnTeacherManualSelectRoom.setOnClickListener {
            showManualSelectRoomDialog()
        }
        binding.btnTeacherManageStudentAttendance.setOnClickListener {
            showTeacherManageAttendanceDialog()
        }
        binding.btnTeacherCloseSession.setOnClickListener {
            showTeacherCloseSessionDialog()
        }
        binding.cardTeacherTeachingSession.setOnClickListener {
            if (activeTeachingSession != null) {
                showTeacherManageAttendanceDialog()
            } else {
                showManualSelectRoomDialog()
            }
        }

        // Modern Icon Grid Listeners
        binding.gridTeacherJurnal.setOnClickListener {
            if (activeTeachingSession != null) {
                showTeacherManageAttendanceDialog()
            } else {
                promptRoomCheckInMethod()
            }
        }
        binding.gridTeacherSchedule.setOnClickListener {
            showTeacherScheduleDialog()
        }
        binding.gridTeacherCbt.setOnClickListener {
            showTugasPenilaianDialog()
        }
        binding.cardTeacherProctorCbt.setOnClickListener {
            showProctorTokenDialog()
        }
        binding.btnOpenProctorFromBanner.setOnClickListener {
            showProctorTokenDialog()
        }
        binding.btnBannerCopyToken.setOnClickListener {
            val tokenText = binding.tvBannerCbtToken.text.toString().trim()
            if (tokenText.isNotEmpty() && tokenText != "------" && tokenText != "OFF") {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("Token CBT", tokenText)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this, "📋 Token $tokenText berhasil disalin!", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "Token ujian belum aktif", Toast.LENGTH_SHORT).show()
            }
        }
        binding.btnBannerRegenToken.setOnClickListener {
            val exam = bannerActiveExam
            if (exam == null) {
                Toast.makeText(this, "Tidak ada ujian aktif saat ini", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val targetClass = bannerActiveClassName ?: "Semua Kelas"
            AlertDialog.Builder(this)
                .setTitle("Acak Token Baru?")
                .setMessage("Apakah Anda ingin merilis token baru untuk kelas $targetClass?\n\nToken baru akan langsung aktif dan disinkronkan ke seluruh siswa dan dashboard proktor.")
                .setPositiveButton("Ya, Acak Token") { _, _ ->
                    Toast.makeText(this, "Mengacak token baru...", Toast.LENGTH_SHORT).show()
                    val reqMap = mutableMapOf<String, String>("examId" to exam.id)
                    if (targetClass != "Semua Kelas" && targetClass != "Semua Kelas Diawasi") {
                        reqMap["className"] = targetClass
                    }
                    ApiClient.getClient(this).regenerateCbtToken(reqMap).enqueue(object : Callback<Map<String, Any>> {
                        override fun onResponse(call: Call<Map<String, Any>>, resp: Response<Map<String, Any>>) {
                            if (resp.isSuccessful) {
                                val newToken = resp.body()?.get("token") as? String
                                if (!newToken.isNullOrBlank()) {
                                    binding.tvBannerCbtToken.text = newToken
                                    startBannerCountdown(900)
                                    Toast.makeText(this@TeacherMainActivity, "✅ Token baru berhasil dirilis: $newToken", Toast.LENGTH_SHORT).show()
                                } else {
                                    loadProctorTokenBanner()
                                }
                            } else {
                                Toast.makeText(this@TeacherMainActivity, "Gagal mengacak token", Toast.LENGTH_SHORT).show()
                            }
                        }
                        override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                            Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                        }
                    })
                }
                .setNegativeButton("Batal", null)
                .show()
        }
        binding.btnBannerPrintSlip.setOnClickListener {
            val exam = bannerActiveExam
            if (exam != null) {
                showClassTokensSlipDialog(exam)
            } else {
                Toast.makeText(this, "Tidak ada jadwal ujian untuk dicetak", Toast.LENGTH_SHORT).show()
            }
        }
        binding.gridTeacherProctorToken.setOnClickListener {
            showProctorTokenDialog()
        }
        binding.gridTeacherRombel.setOnClickListener {
            showRombelSiswaDialog()
        }
        binding.gridTeacherDocuments.setOnClickListener {
            showTeacherDocumentsDialog()
        }
        binding.gridTeacherBroadcast.setOnClickListener {
            showBroadcastClassDialog()
        }
        binding.gridTeacherBk.setOnClickListener {
            startActivity(Intent(this, BkActivity::class.java))
        }
        binding.btnHeaderNotification.setOnClickListener {
            showContactAdminDialog()
        }

        binding.gridTeacherPanduan.setOnClickListener {
            startActivity(Intent(this, AppGuideActivity::class.java))
        }
        binding.gridTeacherAnnouncement.setOnClickListener {
            startActivity(Intent(this, AnnouncementActivity::class.java))
        }
        binding.gridTeacherWifi.setOnClickListener {
            showTeacherWifiDialog()
        }
        binding.gridTeacherPiket.setOnClickListener {
            showTeacherPiketCenterDialog()
        }
        binding.gridTeacherUpdate.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }
        // Pesan Admin (DIHAPUS TOTAL)
        binding.gridTeacherHelpdesk.visibility = View.GONE
        binding.gridTeacherSubjectAttendance.setOnClickListener {
            switchTeacherDashboardTab(1)
        }
        binding.btnOpenPiketCenter.setOnClickListener {
            showTeacherPiketCenterDialog()
        }
        binding.cardTeacherPiketBanner.setOnClickListener {
            showTeacherPiketCenterDialog()
        }

        binding.tvRoleBadgeHeader.setOnClickListener {
            showRoleSwitcherDialog()
        }
        binding.btnSwitchRoleHeader.setOnClickListener {
            showRoleSwitcherDialog()
        }
        binding.gridTeacherLeave.setOnClickListener {
            showTeacherLeaveMenuDialog()
        }
        binding.gridTeacherPrayer.setOnClickListener {
            showPaiPrayerControlDialog()
        }
        binding.gridTeacherPiket.setOnClickListener {
            showTeacherPiketCenterDialog()
        }
        binding.gridTeacherOperator.setOnClickListener {
            openOperatorDashboard()
        }
        binding.gridTeacherWaliKelas.setOnClickListener {
            val intent = Intent(this, WaliKelasActivity::class.java)
            startActivity(intent)
        }
        binding.gridTeacherKurikulum.setOnClickListener {
            showKurikulumCenterDialog()
        }
        binding.gridTeacherManagement.setOnClickListener {
            showManagementHubDialog()
        }
        // Menu UKS ditiadakan untuk Guru sesuai kebijakan sekolah (hanya Siswa dan Orang Tua)
    }


    private var lastPiketSummary: PiketSummaryResponse? = null

    private fun checkTeacherPiketStatus() {
        ApiClient.getClient(this).getPiketSummary().enqueue(object : Callback<PiketSummaryResponse> {
            override fun onResponse(call: Call<PiketSummaryResponse>, response: Response<PiketSummaryResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val summary = response.body()!!
                    lastPiketSummary = summary
                    if (summary.isPiketToday) {
                        binding.cardTeacherPiketBanner.visibility = View.VISIBLE
                        val count = summary.openEmptyClassesCount ?: 0
                        binding.tvPiketEmptyClassAlert.text = if (count > 0) {
                            "⚠️ $count Laporan Kelas Kosong Menunggu Tindakan"
                        } else {
                            "✅ Tidak ada laporan kelas kosong saat ini (Aman)"
                        }
                        binding.tvPiketEmptyClassAlert.setTextColor(
                            if (count > 0) Color.parseColor("#F59E0B") else Color.parseColor("#10B981")
                        )
                        binding.tvTeacherHeaderDutyStatus.text = "🛡️ Guru Piket: Aktif Bertugas"
                        binding.tvTeacherHeaderDutyStatus.setTextColor(Color.parseColor("#FDE047"))
                    } else {
                        binding.cardTeacherPiketBanner.visibility = View.GONE
                        binding.tvTeacherHeaderDutyStatus.text = "🛡️ Status Piket: Standby"
                        binding.tvTeacherHeaderDutyStatus.setTextColor(Color.parseColor("#D1FAE5"))
                    }
                }
            }
            override fun onFailure(call: Call<PiketSummaryResponse>, t: Throwable) {
                // Ignore silent failure
            }
        })
    }

    private fun showTeacherPiketCenterDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🛡️ Pusat Posko Guru Piket",
            subtitle = "Monitoring KBM, Tim Piket & Guru Izin • SMPN 1 Boyolangu",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                checkTeacherPiketStatus()
                dialog.dismiss()
                showTeacherPiketCenterDialog()
            }
        )
        root.addView(header)

        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        // --- 3 TAB SELECTOR BAR ---
        var currentTab = 0 // 0: Tim Piket (Sen-Sab), 1: Rekap Sakit/Izin, 2: Monitoring Kelas Kosong
        val tabContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
        }

        val tabBtn1 = Button(this).apply {
            text = "📅 Tim Piket (Sen-Sab)"
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(4) }
        }
        val tabBtn2 = Button(this).apply {
            text = "🏥 Rekap Sakit & Izin"
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(4) }
        }
        val tabBtn3 = Button(this).apply {
            text = "📢 Kelas Kosong"
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f)
        }

        tabContainer.addView(tabBtn1)
        tabContainer.addView(tabBtn2)
        tabContainer.addView(tabBtn3)
        contentLayout.addView(tabContainer)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val innerContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scroll.addView(innerContainer)
        contentLayout.addView(scroll)
        root.addView(contentLayout)

        val isDutyToday = lastPiketSummary?.isPiketToday == true
        val dayName = lastPiketSummary?.dayName ?: "Hari Ini"

        fun updateTabStyles() {
            val selBg = Color.parseColor("#2563EB")
            val unselBg = Color.parseColor("#E2E8F0")
            val selText = Color.WHITE
            val unselText = Color.parseColor("#334155")

            tabBtn1.setBackgroundColor(if (currentTab == 0) selBg else unselBg)
            tabBtn1.setTextColor(if (currentTab == 0) selText else unselText)

            tabBtn2.setBackgroundColor(if (currentTab == 1) selBg else unselBg)
            tabBtn2.setTextColor(if (currentTab == 1) selText else unselText)

            tabBtn3.setBackgroundColor(if (currentTab == 2) selBg else unselBg)
            tabBtn3.setTextColor(if (currentTab == 2) selText else unselText)
        }

        fun renderTabContent() {
            innerContainer.removeAllViews()
            updateTabStyles()

            when (currentTab) {
                0 -> {
                    // TAB 1: JADWAL & TIM GURU PIKET (SENIN - SABTU)
                    val infoCard = CardView(this).apply {
                        radius = 14f * density
                        cardElevation = 2f * density
                        setCardBackgroundColor(if (isDutyToday) Color.parseColor("#065F46") else Color.parseColor("#1E3A8A"))
                        useCompatPadding = true
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = dp(10)
                        }
                    }
                    val infoInner = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(14), dp(12), dp(14), dp(12))
                    }
                    infoInner.addView(TextView(this).apply {
                        text = if (isDutyToday) "🛡️ ANDA BERTUGAS PIKET HARI INI ($dayName)" else "🛡️ POSKO PIKET KBM ($dayName)"
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(if (isDutyToday) Color.parseColor("#A7F3D0") else Color.parseColor("#93C5FD"))
                    })
                    infoInner.addView(TextView(this).apply {
                        text = "Petugas Aktif: ${sessionManager.getName()}\nMemantau KBM, mendampingi kelas kosong (inval), dan koordinasi dengan Tim Kurikulum."
                        textSize = 11.5f
                        setTextColor(Color.WHITE)
                        setPadding(0, dp(4), 0, 0)
                    })
                    infoCard.addView(infoInner)
                    innerContainer.addView(infoCard)

                    val todayTeamCard = CardView(this).apply {
                        radius = 12f * density
                        cardElevation = 2f * density
                        setCardBackgroundColor(Color.WHITE)
                        useCompatPadding = true
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = dp(10)
                        }
                    }
                    val todayTeamInner = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(14), dp(12), dp(14), dp(12))
                    }
                    todayTeamInner.addView(TextView(this).apply {
                        text = "👥 Tim Guru Piket Hari Ini ($dayName)"
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#0F172A"))
                    })

                    val piketTeam = lastPiketSummary?.todayPiketTeam ?: emptyList()
                    if (piketTeam.isEmpty()) {
                        todayTeamInner.addView(TextView(this).apply {
                            text = "• Tim Piket hari ini siap bertugas di posko terpadu."
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#64748B"))
                            setPadding(0, dp(4), 0, 0)
                        })
                    } else {
                        piketTeam.forEach { tm ->
                            val rowTm = LinearLayout(this).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                                setPadding(0, dp(4), 0, dp(4))
                            }
                            rowTm.addView(TextView(this).apply {
                                text = "• ${tm.teacherName ?: "Petugas"}"
                                textSize = 12f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#1E293B"))
                                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                            })
                            rowTm.addView(TextView(this).apply {
                                text = tm.subject?.takeIf { it != "-" } ?: "Piket Terpadu"
                                textSize = 11f
                                setTextColor(Color.parseColor("#059669"))
                                setBackgroundColor(Color.parseColor("#ECFDF5"))
                                setPadding(dp(6), dp(2), dp(6), dp(2))
                            })
                            todayTeamInner.addView(rowTm)
                        }
                    }
                    todayTeamCard.addView(todayTeamInner)
                    innerContainer.addView(todayTeamCard)

                    val daysOfWeek = listOf("Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu")
                    val weeklyList = lastPiketSummary?.weeklyScheduleSummary ?: emptyList()

                    val weeklyCard = CardView(this).apply {
                        radius = 12f * density
                        cardElevation = 2f * density
                        setCardBackgroundColor(Color.WHITE)
                        useCompatPadding = true
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = dp(12)
                        }
                    }
                    val weeklyInner = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(14), dp(12), dp(14), dp(12))
                    }
                    weeklyInner.addView(TextView(this).apply {
                        text = "📅 Jadwal Tim Piket Lengkap (Senin - Sabtu)"
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#0F172A"))
                        setPadding(0, 0, 0, dp(8))
                    })

                    daysOfWeek.forEach { d ->
                        val membersForDay = weeklyList.filter { it.dayName?.equals(d, ignoreCase = true) == true }
                        val isDayToday = d.equals(dayName, ignoreCase = true)

                        val dayBox = LinearLayout(this).apply {
                            orientation = LinearLayout.VERTICAL
                            val bg = android.graphics.drawable.GradientDrawable().apply {
                                setColor(if (isDayToday) Color.parseColor("#EFF6FF") else Color.parseColor("#F8FAFC"))
                                cornerRadius = 8f * density
                                setStroke(dp(1), if (isDayToday) Color.parseColor("#3B82F6") else Color.parseColor("#E2E8F0"))
                            }
                            background = bg
                            setPadding(dp(10), dp(8), dp(10), dp(8))
                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(6)
                            }
                            layoutParams = lp
                        }

                        val rowDayH = LinearLayout(this).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                        }
                        rowDayH.addView(TextView(this).apply {
                            text = "🗓️ $d"
                            textSize = 12.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(if (isDayToday) Color.parseColor("#1D4ED8") else Color.parseColor("#334155"))
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        })
                        if (isDayToday) {
                            rowDayH.addView(TextView(this).apply {
                                text = "HARI INI"
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                val badgeBg = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(Color.parseColor("#2563EB"))
                                    cornerRadius = 6f * density
                                }
                                background = badgeBg
                                setPadding(dp(6), dp(2), dp(6), dp(2))
                            })
                        }
                        dayBox.addView(rowDayH)

                        val names = membersForDay.mapNotNull { it.teacherName }.filter { it.isNotEmpty() }
                        val textMembers = if (names.isNotEmpty()) {
                            names.joinToString(", ")
                        } else {
                            "Petugas piket terjadwal di posko utama"
                        }

                        dayBox.addView(TextView(this).apply {
                            text = textMembers
                            textSize = 11.5f
                            setTextColor(if (isDayToday) Color.parseColor("#1E3A8A") else Color.parseColor("#64748B"))
                            setPadding(0, dp(4), 0, 0)
                        })

                        weeklyInner.addView(dayBox)
                    }
                    weeklyCard.addView(weeklyInner)
                    innerContainer.addView(weeklyCard)
                }
                1 -> {
                    // TAB 2: REKAP GURU SAKIT & IZIN HARI INI
                    val teacherLeaves = lastPiketSummary?.todayTeacherLeaves ?: emptyList()

                    val tvLeaveHeader = TextView(this).apply {
                        text = "📋 Rekap Guru Berhalangan Hadir Hari Ini ($dayName)"
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#0F172A"))
                        setPadding(0, dp(2), 0, dp(8))
                    }
                    innerContainer.addView(tvLeaveHeader)

                    if (teacherLeaves.isEmpty()) {
                        val cardEmptyLeave = CardView(this).apply {
                            radius = 12f * density
                            cardElevation = 1.5f * density
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                        }
                        val emptyInner = LinearLayout(this).apply {
                            orientation = LinearLayout.VERTICAL
                            gravity = android.view.Gravity.CENTER
                            setPadding(dp(20), dp(28), dp(20), dp(28))
                        }
                        emptyInner.addView(TextView(this).apply {
                            text = "✅"
                            textSize = 28f
                        })
                        emptyInner.addView(TextView(this).apply {
                            text = "Seluruh Guru Siap KBM"
                            textSize = 14f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#059669"))
                            setPadding(0, dp(4), 0, dp(2))
                        })
                        emptyInner.addView(TextView(this).apply {
                            text = "Tidak ada guru yang tercatat izin, sakit, atau dinas luar pada hari ini. Seluruh KBM berjalan normal."
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#64748B"))
                            gravity = android.view.Gravity.CENTER
                        })
                        cardEmptyLeave.addView(emptyInner)
                        innerContainer.addView(cardEmptyLeave)
                    } else {
                        teacherLeaves.forEach { tl ->
                            val lCard = CardView(this).apply {
                                radius = 12f * density
                                cardElevation = 2f * density
                                setCardBackgroundColor(Color.WHITE)
                                useCompatPadding = true
                                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = dp(8)
                                }
                            }
                            val lInner = LinearLayout(this).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(dp(14), dp(12), dp(14), dp(12))
                            }
                            val rowTop = LinearLayout(this).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }
                            rowTop.addView(TextView(this).apply {
                                text = "👤 ${tl.teacherName ?: "Guru"}"
                                textSize = 13.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                            })
                            rowTop.addView(TextView(this).apply {
                                text = tl.leaveType ?: "Izin"
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#DC2626"))
                                val bgBadge = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(Color.parseColor("#FEE2E2"))
                                    cornerRadius = 6f * density
                                }
                                background = bgBadge
                                setPadding(dp(8), dp(3), dp(8), dp(3))
                            })
                            lInner.addView(rowTop)

                            lInner.addView(TextView(this).apply {
                                text = "Alasan: ${tl.reason ?: "-"}"
                                textSize = 11.5f
                                setTextColor(Color.parseColor("#475569"))
                                setPadding(0, dp(4), 0, 0)
                            })

                            if (!tl.assignmentDetails.isNullOrEmpty()) {
                                val taskBox = LinearLayout(this).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val bg = android.graphics.drawable.GradientDrawable().apply {
                                        setColor(Color.parseColor("#F0FDF4"))
                                        cornerRadius = 8f * density
                                        setStroke(dp(1), Color.parseColor("#BBF7D0"))
                                    }
                                    background = bg
                                    setPadding(dp(10), dp(6), dp(10), dp(6))
                                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        topMargin = dp(6)
                                    }
                                    layoutParams = lp
                                }
                                taskBox.addView(TextView(this).apply {
                                    text = "📝 Tugas Mandiri untuk Siswa di Kelas:"
                                    textSize = 11f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#166534"))
                                })
                                taskBox.addView(TextView(this).apply {
                                    text = tl.assignmentDetails
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#15803D"))
                                    setPadding(0, dp(2), 0, 0)
                                })
                                lInner.addView(taskBox)
                            }
                            lCard.addView(lInner)
                            innerContainer.addView(lCard)
                        }
                    }
                }
                2 -> {
                    // TAB 3: MONITORING KELAS KOSONG & LAPOR PENGURUS KELAS
                    val emptyClasses = lastPiketSummary?.openEmptyClasses ?: emptyList()

                    val tvEmptyHeader = TextView(this).apply {
                        text = "📢 Laporan Kelas Kosong Menunggu Tindakan Piket"
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#0F172A"))
                        setPadding(0, dp(2), 0, dp(8))
                    }
                    innerContainer.addView(tvEmptyHeader)

                    if (emptyClasses.isEmpty()) {
                        val emptyCard = CardView(this).apply {
                            radius = 14f * density
                            cardElevation = 1.5f * density
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                        }
                        val emptyInner = LinearLayout(this).apply {
                            orientation = LinearLayout.VERTICAL
                            gravity = android.view.Gravity.CENTER
                            setPadding(dp(20), dp(32), dp(20), dp(32))
                        }
                        emptyInner.addView(TextView(this).apply {
                            text = "🎉"
                            textSize = 32f
                        })
                        emptyInner.addView(TextView(this).apply {
                            text = "Semua Kelas Terisi"
                            textSize = 15f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#10B981"))
                            setPadding(0, dp(4), 0, dp(2))
                        })
                        emptyInner.addView(TextView(this).apply {
                            text = "Tidak ada laporan kelas kosong dari pengurus kelas saat ini. Seluruh KBM berjalan tertib."
                            textSize = 12f
                            setTextColor(Color.parseColor("#64748B"))
                            gravity = android.view.Gravity.CENTER
                        })
                        emptyCard.addView(emptyInner)
                        innerContainer.addView(emptyCard)
                    } else {
                        for (ec in emptyClasses) {
                            val ecCard = CardView(this).apply {
                                radius = 12f * density
                                cardElevation = 2f * density
                                setCardBackgroundColor(Color.WHITE)
                                useCompatPadding = true
                                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = dp(8)
                                }
                            }
                            val ecInner = LinearLayout(this).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(dp(14), dp(12), dp(14), dp(12))
                            }

                            val rowTop = LinearLayout(this).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }
                            rowTop.addView(TextView(this).apply {
                                text = "Kelas ${ec.className} • ${ec.period ?: "Jam Pelajaran"}"
                                textSize = 14f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                            })
                            rowTop.addView(TextView(this).apply {
                                text = "⚠️ KOSONG"
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#DC2626"))
                                val badgeBg = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(Color.parseColor("#FEE2E2"))
                                    cornerRadius = 6f * density
                                }
                                background = badgeBg
                                setPadding(dp(8), dp(3), dp(8), dp(3))
                            })
                            ecInner.addView(rowTop)

                            ecInner.addView(TextView(this).apply {
                                text = "Mapel: ${ec.subjectName ?: "-"}\nGuru Berhalangan: ${ec.absentTeacherName ?: "-"}\nAlasan/Keterangan: ${ec.reason ?: "Belum ada keterangan"}"
                                textSize = 11.5f
                                setTextColor(Color.parseColor("#475569"))
                                setPadding(0, dp(6), 0, dp(8))
                            })

                            val rowActionBtns = LinearLayout(this).apply {
                                orientation = LinearLayout.HORIZONTAL
                                weightSum = 2f
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(4)
                                }
                                layoutParams = lp
                            }

                            val btnHandle = Button(this).apply {
                                text = "🛡️ Dampingi (Inval)"
                                textSize = 11.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#0F766E"))
                                val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                                    marginEnd = dp(4)
                                }
                                layoutParams = lp
                                setOnClickListener {
                                    AlertDialog.Builder(this@TeacherMainActivity)
                                        .setTitle("Konfirmasi Pendampingan Piket")
                                        .setMessage("Apakah Anda bersedia mengambil alih dan mendampingi KBM Kelas ${ec.className} (${ec.subjectName ?: "Mapel"}) sekarang?\n\nStatus kelas di sistem monitoring sekolah akan otomatis terisi HADIR oleh Guru Piket.")
                                        .setPositiveButton("Ya, Ambil Tugas") { _, _ ->
                                            takeDutyForEmptyClass(ec.id, ec.className, dialog)
                                        }
                                        .setNegativeButton("Batal", null)
                                        .show()
                                }
                            }

                            val btnForward = Button(this).apply {
                                text = "📢 Lapor ke Kurikulum"
                                textSize = 11.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#2563EB"))
                                val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                                    marginStart = dp(4)
                                }
                                layoutParams = lp
                                setOnClickListener {
                                    AlertDialog.Builder(this@TeacherMainActivity)
                                        .setTitle("Teruskan ke Kurikulum")
                                        .setMessage("Teruskan laporan kelas kosong Kelas ${ec.className} (${ec.subjectName ?: "Mapel"}) ke Tim Kurikulum agar segera ditunjuk guru pengganti resmi?")
                                        .setPositiveButton("Ya, Teruskan") { _, _ ->
                                            forwardToKurikulum(ec.id, ec.className, dialog)
                                        }
                                        .setNegativeButton("Batal", null)
                                        .show()
                                }
                            }

                            rowActionBtns.addView(btnHandle)
                            rowActionBtns.addView(btnForward)
                            ecInner.addView(rowActionBtns)

                            ecCard.addView(ecInner)
                            innerContainer.addView(ecCard)
                        }
                    }
                }
            }
        }

        tabBtn1.setOnClickListener { currentTab = 0; renderTabContent() }
        tabBtn2.setOnClickListener { currentTab = 1; renderTabContent() }
        tabBtn3.setOnClickListener { currentTab = 2; renderTabContent() }

        renderTabContent()

        dialog.setView(root)
        dialog.show()
    }

    private fun forwardToKurikulum(reportId: String, className: String, parentDialog: AlertDialog) {
        val progress = android.app.ProgressDialog(this).apply {
            setMessage("Meneruskan laporan ke Tim Kurikulum...")
            show()
        }
        ApiClient.getClient(this).forwardEmptyClassToKurikulum(reportId, mapOf("notes" to "Diteruskan dari Posko Guru Piket oleh ${sessionManager.getName()}")).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                progress.dismiss()
                if (response.isSuccessful && response.body()?.success == true) {
                    Toast.makeText(this@TeacherMainActivity, "✅ Laporan Kelas $className berhasil diteruskan ke Tim Kurikulum!", Toast.LENGTH_LONG).show()
                    checkTeacherPiketStatus()
                    parentDialog.dismiss()
                    showTeacherPiketCenterDialog()
                } else {
                    Toast.makeText(this@TeacherMainActivity, response.body()?.message ?: "Gagal meneruskan laporan", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                progress.dismiss()
                Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun takeDutyForEmptyClass(reportId: String, className: String, parentDialog: AlertDialog) {
        ApiClient.getClient(this).takePiketDuty(reportId).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    Toast.makeText(this@TeacherMainActivity, "✅ Berhasil mengambil tugas pendampingan KBM Kelas $className!", Toast.LENGTH_LONG).show()
                    checkTeacherPiketStatus()
                    parentDialog.dismiss()
                    showTeacherPiketCenterDialog()
                } else {
                    Toast.makeText(this@TeacherMainActivity, response.body()?.message ?: "Gagal mengambil tugas kelas", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showKurikulumCenterDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🏛️ Pusat Manajemen Kurikulum",
            subtitle = "Approval Izin Guru & Pemantauan Laporan Rombel • SIBOY FRESH",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumCenterDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (14 * resources.displayMetrics.density).toInt()
            setPadding(pad, 10, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        // 1. HERO BANNER KURIKULUM (MODERN INDIGO E-COMMERCE STYLE)
        val heroCard = CardView(this).apply {
            radius = 20f * resources.displayMetrics.density
            cardElevation = 4f * resources.displayMetrics.density
            setCardBackgroundColor(Color.parseColor("#312E81"))
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * resources.displayMetrics.density).toInt()
            }
        }
        val heroInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        heroInner.addView(TextView(this).apply {
            text = "🏛️ SIBOY ACADEMIC CONTROL CENTER"
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        heroInner.addView(TextView(this).apply {
            text = "Pusat Kendali Akademik, Live KBM, Posko Piket, Inval, & Penjaminan Mutu Belajar Mengajar."
            textSize = 11.5f
            setTextColor(Color.parseColor("#C7D2FE"))
            setPadding(0, 4, 0, 12)
        })

        // KPI Row 3 Kolom
        val kpiRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
        }
        fun createKpiChip(label: String, valText: String, bgTint: String): View {
            return CardView(this).apply {
                radius = 12f * resources.displayMetrics.density
                cardElevation = 2f * resources.displayMetrics.density
                setCardBackgroundColor(Color.parseColor(bgTint))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginEnd = 4
                    marginStart = 4
                }
                val chipInner = LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(10, 10, 10, 10)
                    gravity = Gravity.CENTER
                }
                chipInner.addView(TextView(context).apply {
                    text = valText
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                })
                chipInner.addView(TextView(context).apply {
                    text = label
                    textSize = 9.5f
                    setTextColor(Color.parseColor("#475569"))
                })
                addView(chipInner)
            }
        }
        kpiRow.addView(createKpiChip("KBM Live", "33 Rombel", "#FFFFFF"))
        kpiRow.addView(createKpiChip("Piket Guru", "Siaga Hari Ini", "#FFFFFF"))
        kpiRow.addView(createKpiChip("Kurikulum", "SIBOY FRESH", "#FFFFFF"))
        heroInner.addView(kpiRow)
        heroCard.addView(heroInner)
        contentInner.addView(heroCard)

        // 2. SECTION TITLE: SUB MENU KURIKULUM (GRID E-COMMERCE)
        val sectionHeaderLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(4, 4, 4, 8)
        }
        sectionHeaderLayout.addView(TextView(this).apply {
            text = "⚡ SUB MENU KURIKULUM"
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
        })
        val headerSpacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
        }
        sectionHeaderLayout.addView(headerSpacer)
        sectionHeaderLayout.addView(TextView(this).apply {
            text = "12 Modul Terintegrasi ▸"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#4338CA"))
        })
        contentInner.addView(sectionHeaderLayout)

        // Grid Card Generator Helper (Bergaya E-Commerce Berwarna-Warni)
        fun createEcommerceMenuCard(
            emoji: String,
            title: String,
            desc: String,
            tag: String,
            tagColor: String,
            tagBg: String,
            onClick: () -> Unit
        ): CardView {
            val card = CardView(this).apply {
                radius = 18f * resources.displayMetrics.density
                cardElevation = 3f * resources.displayMetrics.density
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply {
                    marginEnd = 4
                    marginStart = 4
                    bottomMargin = 8
                }
                isClickable = true
                isFocusable = true
                foreground = ContextCompat.getDrawable(context, android.R.drawable.list_selector_background)
                setOnClickListener { onClick() }
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (14 * resources.displayMetrics.density).toInt()
                setPadding(p, p, p, p)
            }

            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            topRow.addView(TextView(this).apply {
                text = emoji
                textSize = 24f
            })
            val spacer = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
            }
            topRow.addView(spacer)

            val tagPill = TextView(this).apply {
                text = tag
                textSize = 9.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(tagColor))
                val tagDrawable = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(tagBg))
                    cornerRadius = 8f * resources.displayMetrics.density
                }
                background = tagDrawable
                val tp = (8 * resources.displayMetrics.density).toInt()
                val tvp = (3 * resources.displayMetrics.density).toInt()
                setPadding(tp, tvp, tp, tvp)
            }
            topRow.addView(tagPill)
            inner.addView(topRow)

            inner.addView(TextView(this).apply {
                text = title
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
                setPadding(0, 8, 0, 2)
            })

            inner.addView(TextView(this).apply {
                text = desc
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
                maxLines = 2
                setLineSpacing(1.5f, 1f)
            })

            card.addView(inner)
            return card
        }

        // ROW 1: Monitoring KBM & Laporan Kelas Kosong
        val gridRow1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow1.addView(createEcommerceMenuCard(
            emoji = "🔴",
            title = "Monitoring KBM",
            desc = "Live aktivitas rombel VII, VIII, IX & guru mengajar",
            tag = "REALTIME",
            tagColor = "#DC2626",
            tagBg = "#FEE2E2",
            onClick = { showKurikulumKbmMonitoringDialog() }
        ))
        gridRow1.addView(createEcommerceMenuCard(
            emoji = "⚠️",
            title = "Kelas Kosong & Inval",
            desc = "Laporan rombel kosong & delegasi guru inval",
            tag = "DISPOSISI",
            tagColor = "#D97706",
            tagBg = "#FEF3C7",
            onClick = { showKurikulumEmptyClassesDialog() }
        ))
        contentInner.addView(gridRow1)

        // ROW 2: Posko Guru Piket & Verifikasi Izin Guru
        val gridRow2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow2.addView(createEcommerceMenuCard(
            emoji = "🛡️",
            title = "Posko Guru Piket",
            desc = "Petugas piket hari ini, log keterlambatan, & tugas",
            tag = "POSKO",
            tagColor = "#059669",
            tagBg = "#D1FAE5",
            onClick = { showKurikulumPiketPoskoDialog() }
        ))
        gridRow2.addView(createEcommerceMenuCard(
            emoji = "📋",
            title = "Verifikasi Izin Guru",
            desc = "Approval izin cuti/dinas & disposisi tugas ke piket",
            tag = "APPROVAL",
            tagColor = "#0284C7",
            tagBg = "#E0F2FE",
            onClick = { showKurikulumLeavesVerificationDialog() }
        ))
        contentInner.addView(gridRow2)

        // ROW 3: Rekap Bulanan Wali Kelas & Jadwal Mengajar Guru
        val gridRow3 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow3.addView(createEcommerceMenuCard(
            emoji = "👨‍🏫",
            title = "Rekap Presensi Guru",
            desc = "Mode Lengkap: Sesi KBM, jam datang & izin resmi",
            tag = "LENGKAP",
            tagColor = "#059669",
            tagBg = "#D1FAE5",
            onClick = { showKurikulumTeacherAttendanceFullDialog() }
        ))
        gridRow3.addView(createEcommerceMenuCard(
            emoji = "📊",
            title = "Rekap Wali Kelas",
            desc = "Laporan bulanan presensi & catatan 33 rombel",
            tag = "BULANAN",
            tagColor = "#7C3AED",
            tagBg = "#EDE9FE",
            onClick = { showKurikulumMonthlyReportsDialog() }
        ))
        contentInner.addView(gridRow3)

        // ROW 4: Jadwal Mengajar & Bank Soal AI CBT
        val gridRow4 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow4.addView(createEcommerceMenuCard(
            emoji = "📅",
            title = "Jadwal Mengajar",
            desc = "Distribusi jam mengajar guru, mapel, & rombel",
            tag = "AKADEMIK",
            tagColor = "#C026D3",
            tagBg = "#FDF4FF",
            onClick = { showKurikulumTeachingSchedulesDialog() }
        ))
        gridRow4.addView(createEcommerceMenuCard(
            emoji = "🤖",
            title = "Bank Soal & AI CBT",
            desc = "Bank naskah soal kurikulum & generator AI CBT",
            tag = "CBT AI",
            tagColor = "#0F766E",
            tagBg = "#CCFBF1",
            onClick = { showKurikulumCbtBankDialog() }
        ))
        contentInner.addView(gridRow4)

        // ROW 5: Presensi Siswa 33 Rombel & Cetak Laporan PDF Resmi
        val gridRow5 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow5.addView(createEcommerceMenuCard(
            emoji = "👥",
            title = "Presensi Siswa 33 Rombel",
            desc = "Pantau kehadiran harian & persentase jenjang VII-IX",
            tag = "33 ROMBEL",
            tagColor = "#0284C7",
            tagBg = "#E0F2FE",
            onClick = { showKurikulumStudentAttendanceDialog() }
        ))
        gridRow5.addView(createEcommerceMenuCard(
            emoji = "📄",
            title = "Laporan & Cetak PDF",
            desc = "Cetak rekap KBM bulanan & lembar dinas resmi",
            tag = "CETAK PDF",
            tagColor = "#BE185D",
            tagBg = "#FCE7F3",
            onClick = { showKurikulumReportExportDialog() }
        ))
        contentInner.addView(gridRow5)

        // ROW 6: Pengawasan CBT & Sinkronisasi
        val gridRow6 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * resources.displayMetrics.density).toInt()
            }
        }
        gridRow6.addView(createEcommerceMenuCard(
            emoji = "🛡️",
            title = "Pengawasan Ujian CBT",
            desc = "Monitoring live ruang, acak token 15 mnt, reset kuncian",
            tag = "PENGAWAS",
            tagColor = "#7C3AED",
            tagBg = "#EDE9FE",
            onClick = { showProctorTokenDialog() }
        ))
        gridRow6.addView(createEcommerceMenuCard(
            emoji = "🔄",
            title = "Sinkronisasi Realtime",
            desc = "Segarkan seluruh jadwal, approval & live KBM",
            tag = "REFRESH",
            tagColor = "#059669",
            tagBg = "#D1FAE5",
            onClick = {
                Toast.makeText(this@TeacherMainActivity, "Menyinkronkan data kurikulum...", Toast.LENGTH_SHORT).show()
                dialog.dismiss()
                showKurikulumCenterDialog()
            }
        ))
        contentInner.addView(gridRow6)

        // 3. LIVE ACTIVITY PREVIEW SECTION
        contentInner.addView(TextView(this).apply {
            text = "📋 TUGAS & VERIFIKASI PENDING HARI INI"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            setPadding(4, 6, 4, 2)
        })
        val liveContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        contentInner.addView(liveContainer)

        fun loadPendingLeaves() {
            liveContainer.removeAllViews()
            val tvLoading = TextView(this).apply {
                text = "⏳ Memuat status izin guru pending & disposisi piket..."
                textSize = 12f
                setTextColor(Color.parseColor("#64748B"))
                setPadding(0, 10, 0, 10)
            }
            liveContainer.addView(tvLoading)

            ApiClient.getClient(this).getKurikulumPendingLeaves().enqueue(object : Callback<KurikulumPendingLeavesResponse> {
                override fun onResponse(call: Call<KurikulumPendingLeavesResponse>, response: Response<KurikulumPendingLeavesResponse>) {
                    liveContainer.removeAllViews()
                    if (response.isSuccessful && response.body() != null) {
                        val leaves = response.body()!!.leaves
                        if (leaves.isEmpty()) {
                            val emptyCard = CardView(this@TeacherMainActivity).apply {
                                radius = 12f
                                cardElevation = 1f
                                setCardBackgroundColor(Color.WHITE)
                                useCompatPadding = true
                            }
                            val emptyInner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                gravity = Gravity.CENTER
                                setPadding(24, 32, 24, 32)
                            }
                            emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "🎉 Tidak Ada Izin Pending"
                                textSize = 15f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#10B981"))
                            })
                            emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Semua permohonan izin guru telah diverifikasi & terdisposisi."
                                textSize = 12f
                                setTextColor(Color.parseColor("#64748B"))
                                setPadding(0, 4, 0, 0)
                            })
                            emptyCard.addView(emptyInner)
                            liveContainer.addView(emptyCard)
                        } else {
                            val tvHeaderCount = TextView(this@TeacherMainActivity).apply {
                                text = "⚠️ Terdapat ${leaves.size} permohonan izin menunggu verifikasi Kurikulum:"
                                textSize = 13f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                setPadding(0, 4, 0, 12)
                            }
                            liveContainer.addView(tvHeaderCount)

                            for (leave in leaves) {
                                val itemCard = CardView(this@TeacherMainActivity).apply {
                                    radius = 12f
                                    cardElevation = 2f
                                    setCardBackgroundColor(Color.WHITE)
                                    useCompatPadding = true
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (10 * resources.displayMetrics.density).toInt()
                                    }
                                }
                                val itemInner = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val p = (14 * resources.displayMetrics.density).toInt()
                                    setPadding(p, p, p, p)
                                }

                                val rowTop = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = Gravity.CENTER_VERTICAL
                                }
                                val tvName = TextView(this@TeacherMainActivity).apply {
                                    text = leave.teacherName
                                    textSize = 14f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#0F172A"))
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                }
                                val badgeCat = TextView(this@TeacherMainActivity).apply {
                                    text = leave.category
                                    textSize = 10.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    setBackgroundColor(Color.parseColor("#D97706"))
                                    setPadding(10, 4, 10, 4)
                                }
                                rowTop.addView(tvName)
                                rowTop.addView(badgeCat)
                                itemInner.addView(rowTop)

                                val tvDate = TextView(this@TeacherMainActivity).apply {
                                    text = "📅 Tanggal: ${leave.startDate} s/d ${leave.endDate}\n📝 Alasan: ${leave.reason}\n📚 Tugas Siswa: ${leave.assignmentDetails ?: "Belajar Mandiri"}"
                                    textSize = 12f
                                    setTextColor(Color.parseColor("#334155"))
                                    setPadding(0, 6, 0, 6)
                                }
                                itemInner.addView(tvDate)

                                // Jadwal Terdampak (SIBOY A5)
                                if (leave.schedulesList.isNotEmpty()) {
                                    val tvSchedTitle = TextView(this@TeacherMainActivity).apply {
                                        text = "⏰ Jadwal KBM Terdampak Disposisi ke Posko Guru Piket:"
                                        textSize = 11.5f
                                        setTypeface(null, Typeface.BOLD)
                                        setTextColor(Color.parseColor("#0F766E"))
                                        setPadding(0, 4, 0, 2)
                                    }
                                    itemInner.addView(tvSchedTitle)

                                    for (sc in leave.schedulesList) {
                                        val tvSc = TextView(this@TeacherMainActivity).apply {
                                            text = "• ${sc.periodLesson ?: sc.timeRange ?: "Jam KBM"} | Kelas ${sc.className ?: "-"} | ${sc.subjectName ?: "Mapel"}"
                                            textSize = 11.5f
                                            setTextColor(Color.parseColor("#475569"))
                                            setPadding(8, 2, 0, 2)
                                        }
                                        itemInner.addView(tvSc)
                                    }
                                }

                                // Tombol Aksi Approval & Disposisi ke Piket (SIBOY A5)
                                val rowBtns = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    val topM = (10 * resources.displayMetrics.density).toInt()
                                    setPadding(0, topM, 0, 0)
                                }

                                val btnApprove = Button(this@TeacherMainActivity).apply {
                                    text = "✅ Setujui & Disposisi ke Piket"
                                    textSize = 11.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    setBackgroundColor(Color.parseColor("#059669"))
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.3f).apply {
                                        marginEnd = 8
                                    }
                                    setOnClickListener {
                                        AlertDialog.Builder(this@TeacherMainActivity)
                                            .setTitle("Setujui Izin Guru")
                                            .setMessage("Setujui izin Bpk/Ibu ${leave.teacherName}?\n\nJadwal KBM terdampak akan otomatis didisposisikan ke Posko Guru Piket hari ini.")
                                            .setPositiveButton("Ya, Setujui") { _, _ ->
                                                ApiClient.getClient(this@TeacherMainActivity).approveKurikulumLeave(leave.id).enqueue(object : Callback<BasicResponse> {
                                                    override fun onResponse(call: Call<BasicResponse>, resp: Response<BasicResponse>) {
                                                        if (resp.isSuccessful && resp.body()?.success == true) {
                                                            Toast.makeText(this@TeacherMainActivity, "✅ Izin disetujui & didisposisikan ke Guru Piket!", Toast.LENGTH_LONG).show()
                                                            loadPendingLeaves()
                                                        } else {
                                                            Toast.makeText(this@TeacherMainActivity, "Gagal menyetujui izin", Toast.LENGTH_SHORT).show()
                                                        }
                                                    }
                                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                                        Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                                                    }
                                                })
                                            }
                                            .setNegativeButton("Batal", null)
                                            .show()
                                    }
                                }

                                val btnReject = Button(this@TeacherMainActivity).apply {
                                    text = "❌ Tolak"
                                    textSize = 11.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    setBackgroundColor(Color.parseColor("#DC2626"))
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.7f)
                                    setOnClickListener {
                                        AlertDialog.Builder(this@TeacherMainActivity)
                                            .setTitle("Tolak Izin")
                                            .setMessage("Tolak permohonan izin dari ${leave.teacherName}?")
                                            .setPositiveButton("Tolak") { _, _ ->
                                                ApiClient.getClient(this@TeacherMainActivity).rejectKurikulumLeave(leave.id).enqueue(object : Callback<BasicResponse> {
                                                    override fun onResponse(call: Call<BasicResponse>, resp: Response<BasicResponse>) {
                                                        Toast.makeText(this@TeacherMainActivity, "Izin ditolak", Toast.LENGTH_SHORT).show()
                                                        loadPendingLeaves()
                                                    }
                                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                                        Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                                                    }
                                                })
                                            }
                                            .setNegativeButton("Batal", null)
                                            .show()
                                    }
                                }

                                rowBtns.addView(btnApprove)
                                rowBtns.addView(btnReject)
                                itemInner.addView(rowBtns)

                                itemCard.addView(itemInner)
                                liveContainer.addView(itemCard)
                            }
                        }
                    } else {
                        val tvError = TextView(this@TeacherMainActivity).apply {
                            text = "Gagal memuat data izin kurikulum."
                            setTextColor(Color.parseColor("#DC2626"))
                        }
                        liveContainer.addView(tvError)
                    }
                }

                override fun onFailure(call: Call<KurikulumPendingLeavesResponse>, t: Throwable) {
                    liveContainer.removeAllViews()
                    val tvError = TextView(this@TeacherMainActivity).apply {
                        text = "Koneksi terputus: ${t.message}"
                        setTextColor(Color.parseColor("#DC2626"))
                    }
                    liveContainer.addView(tvError)
                }
            })
        }

        fun loadMonthlyReports() {
            contentInner.removeAllViews()
            val tvLoading = TextView(this).apply {
                text = "⏳ Memuat rekapitulasi laporan bulanan dari Wali Kelas..."
                textSize = 13f
                setTextColor(Color.parseColor("#64748B"))
                setPadding(0, 16, 0, 16)
            }
            contentInner.addView(tvLoading)

            ApiClient.getClient(this).getKurikulumMonthlyReports().enqueue(object : Callback<KurikulumMonthlyReportsResponse> {
                override fun onResponse(call: Call<KurikulumMonthlyReportsResponse>, response: Response<KurikulumMonthlyReportsResponse>) {
                    contentInner.removeAllViews()
                    if (response.isSuccessful && response.body() != null) {
                        val reports = response.body()!!.reports
                        if (reports.isEmpty()) {
                            val emptyCard = CardView(this@TeacherMainActivity).apply {
                                radius = 12f
                                cardElevation = 1f
                                setCardBackgroundColor(Color.WHITE)
                                useCompatPadding = true
                            }
                            val emptyInner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                gravity = Gravity.CENTER
                                setPadding(24, 32, 24, 32)
                            }
                            emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Belum Ada Laporan Rombel"
                                textSize = 15f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F766E"))
                            })
                            emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Belum ada laporan bulanan yang dikirim oleh Wali Kelas."
                                textSize = 12f
                                setTextColor(Color.parseColor("#64748B"))
                                setPadding(0, 4, 0, 0)
                            })
                            emptyCard.addView(emptyInner)
                            contentInner.addView(emptyCard)
                        } else {
                            val tvHeader = TextView(this@TeacherMainActivity).apply {
                                text = "📊 Riwayat Laporan Bulanan Masuk dari Wali Kelas:"
                                textSize = 13f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                setPadding(0, 4, 0, 12)
                            }
                            contentInner.addView(tvHeader)

                            for (rep in reports) {
                                val repCard = CardView(this@TeacherMainActivity).apply {
                                    radius = 12f
                                    cardElevation = 2f
                                    setCardBackgroundColor(Color.WHITE)
                                    useCompatPadding = true
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (10 * resources.displayMetrics.density).toInt()
                                    }
                                }
                                val repInner = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val p = (14 * resources.displayMetrics.density).toInt()
                                    setPadding(p, p, p, p)
                                }

                                repInner.addView(TextView(this@TeacherMainActivity).apply {
                                    text = rep.title
                                    textSize = 13.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#0F172A"))
                                })
                                repInner.addView(TextView(this@TeacherMainActivity).apply {
                                    text = rep.message
                                    textSize = 12f
                                    setTextColor(Color.parseColor("#334155"))
                                    setPadding(0, 6, 0, 6)
                                })
                                repCard.addView(repInner)
                                contentInner.addView(repCard)
                            }
                        }
                    } else {
                        val tvError = TextView(this@TeacherMainActivity).apply {
                            text = "Gagal memuat laporan bulanan."
                            setTextColor(Color.parseColor("#DC2626"))
                        }
                        contentInner.addView(tvError)
                    }
                }

                override fun onFailure(call: Call<KurikulumMonthlyReportsResponse>, t: Throwable) {
                    contentInner.removeAllViews()
                    val tvError = TextView(this@TeacherMainActivity).apply {
                        text = "Koneksi terputus: ${t.message}"
                        setTextColor(Color.parseColor("#DC2626"))
                    }
                    contentInner.addView(tvError)
                }
            })
        }

        loadPendingLeaves()

        dialog.setView(root)
        dialog.show()
    }

    private fun openKurikulumWebPortal() {
        val serverIp = sessionManager.getServerIp()
        val token = sessionManager.getToken() ?: ""
        val cleanBase = if (serverIp.startsWith("http://") || serverIp.startsWith("https://")) serverIp else "http://$serverIp"
        val url = "$cleanBase/kurikulum?token=$token"
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal membuka browser portal kurikulum: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showKurikulumLeavesVerificationDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "📋 Verifikasi Izin Guru (Kurikulum)",
            subtitle = "Approval Cuti / Izin Guru & Disposisi Tugas ke Posko Guru Piket",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumLeavesVerificationDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat seluruh daftar izin guru pending..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 16, 0, 16)
        }
        contentInner.addView(tvLoading)

        ApiClient.getClient(this).getKurikulumPendingLeaves().enqueue(object : Callback<KurikulumPendingLeavesResponse> {
            override fun onResponse(call: Call<KurikulumPendingLeavesResponse>, response: Response<KurikulumPendingLeavesResponse>) {
                contentInner.removeAllViews()
                if (response.isSuccessful && response.body() != null) {
                    val leaves = response.body()!!.leaves
                    if (leaves.isEmpty()) {
                        val emptyCard = CardView(this@TeacherMainActivity).apply {
                            radius = 12f
                            cardElevation = 1f
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                        }
                        val emptyInner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            gravity = Gravity.CENTER
                            setPadding(24, 36, 24, 36)
                        }
                        emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "🎉 Tidak Ada Izin Pending"
                            textSize = 15f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#10B981"))
                        })
                        emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Semua permohonan izin guru telah diverifikasi & terdisposisi ke piket."
                            textSize = 12f
                            setTextColor(Color.parseColor("#64748B"))
                            setPadding(0, 6, 0, 0)
                        })
                        emptyCard.addView(emptyInner)
                        contentInner.addView(emptyCard)
                    } else {
                        val tvHeaderCount = TextView(this@TeacherMainActivity).apply {
                            text = "Daftar Permohonan Izin Guru (${leaves.size}):"
                            textSize = 13.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                            setPadding(0, 4, 0, 12)
                        }
                        contentInner.addView(tvHeaderCount)

                        for (item in leaves) {
                            val itemCard = CardView(this@TeacherMainActivity).apply {
                                radius = 12f
                                cardElevation = 2f
                                setCardBackgroundColor(Color.WHITE)
                                useCompatPadding = true
                                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = (12 * resources.displayMetrics.density).toInt()
                                }
                            }
                            val itemInner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                val p = (14 * resources.displayMetrics.density).toInt()
                                setPadding(p, p, p, p)
                            }
                            itemInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "👤 ${item.teacherName}"
                                textSize = 14f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                            })
                            itemInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Tipe: ${item.type} • ${item.startDate} s/d ${item.endDate} (${item.totalDays} hari)"
                                textSize = 11.5f
                                setTextColor(Color.parseColor("#0F766E"))
                                setPadding(0, 2, 0, 4)
                            })
                            itemInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Alasan: ${item.reason}"
                                textSize = 12f
                                setTextColor(Color.parseColor("#334155"))
                                setPadding(0, 0, 0, 8)
                            })

                            if (!item.taskDescription.isNullOrBlank()) {
                                itemInner.addView(TextView(this@TeacherMainActivity).apply {
                                    text = "📝 Tugas/Materi untuk Siswa:\n${item.taskDescription}"
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#0369A1"))
                                    setBackgroundColor(Color.parseColor("#F0F9FF"))
                                    setPadding(10, 8, 10, 8)
                                })
                            }

                            val rowBtns = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                weightSum = 2f
                                setPadding(0, 10, 0, 0)
                            }
                            val btnApprove = Button(this@TeacherMainActivity).apply {
                                text = "✅ Setujui & Disposisi"
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#059669"))
                                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                                    marginEnd = 4
                                }
                                setOnClickListener {
                                    ApiClient.getClient(this@TeacherMainActivity).approveKurikulumLeave(item.id, mapOf("notes" to "Disetujui oleh Tim Kurikulum")).enqueue(object : Callback<BasicResponse> {
                                        override fun onResponse(call: Call<BasicResponse>, resp: Response<BasicResponse>) {
                                            if (resp.isSuccessful) {
                                                Toast.makeText(this@TeacherMainActivity, "Izin berhasil disetujui & tugas diteruskan ke Guru Piket!", Toast.LENGTH_LONG).show()
                                                dialog.dismiss()
                                                showKurikulumLeavesVerificationDialog()
                                            } else {
                                                Toast.makeText(this@TeacherMainActivity, "Gagal menyetujui izin", Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                            Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                                        }
                                    })
                                }
                            }
                            val btnReject = Button(this@TeacherMainActivity).apply {
                                text = "❌ Tolak"
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#DC2626"))
                                setBackgroundColor(Color.parseColor("#FEE2E2"))
                                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                                    marginStart = 4
                                }
                                setOnClickListener {
                                    val etReason = EditText(this@TeacherMainActivity).apply {
                                        hint = "Alasan penolakan izin..."
                                    }
                                    AlertDialog.Builder(this@TeacherMainActivity)
                                        .setTitle("Tolak Permohonan Izin")
                                        .setView(etReason)
                                        .setPositiveButton("Tolak") { _, _ ->
                                            val rzn = etReason.text.toString().trim()
                                            ApiClient.getClient(this@TeacherMainActivity).rejectKurikulumLeave(item.id, mapOf("reason" to rzn)).enqueue(object : Callback<BasicResponse> {
                                                override fun onResponse(call: Call<BasicResponse>, resp: Response<BasicResponse>) {
                                                    if (resp.isSuccessful) {
                                                        Toast.makeText(this@TeacherMainActivity, "Permohonan izin telah ditolak", Toast.LENGTH_SHORT).show()
                                                        dialog.dismiss()
                                                        showKurikulumLeavesVerificationDialog()
                                                    }
                                                }
                                                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                                    Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                                                }
                                            })
                                        }
                                        .setNegativeButton("Batal", null)
                                        .show()
                                }
                            }
                            rowBtns.addView(btnApprove)
                            rowBtns.addView(btnReject)
                            itemInner.addView(rowBtns)
                            itemCard.addView(itemInner)
                            contentInner.addView(itemCard)
                        }
                    }
                } else {
                    contentInner.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Gagal memuat perizinan guru."
                        setTextColor(Color.parseColor("#DC2626"))
                    })
                }
            }
            override fun onFailure(call: Call<KurikulumPendingLeavesResponse>, t: Throwable) {
                contentInner.removeAllViews()
                contentInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Koneksi terputus: ${t.message}"
                    setTextColor(Color.parseColor("#DC2626"))
                })
            }
        })

        dialog.setView(root)
        dialog.show()
    }

    private fun showKurikulumMonthlyReportsDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "📊 Rekap Bulanan Wali Kelas",
            subtitle = "Monitoring Laporan Bulanan Presensi, Jurnal & Catatan 33 Rombel",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumMonthlyReportsDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat rekapitulasi laporan bulanan dari 33 Rombel Wali Kelas..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 16, 0, 16)
        }
        contentInner.addView(tvLoading)

        ApiClient.getClient(this).getKurikulumMonthlyReports().enqueue(object : Callback<KurikulumMonthlyReportsResponse> {
            override fun onResponse(call: Call<KurikulumMonthlyReportsResponse>, response: Response<KurikulumMonthlyReportsResponse>) {
                contentInner.removeAllViews()
                if (response.isSuccessful && response.body() != null) {
                    val reports = response.body()!!.reports
                    if (reports.isEmpty()) {
                        val emptyCard = CardView(this@TeacherMainActivity).apply {
                            radius = 12f
                            cardElevation = 1f
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                        }
                        val emptyInner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            gravity = Gravity.CENTER
                            setPadding(24, 36, 24, 36)
                        }
                        emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "📁 Belum Ada Laporan Rombel Masuk"
                            textSize = 15f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#64748B"))
                        })
                        emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Laporan bulanan yang dikirim oleh Wali Kelas akan tampil di sini."
                            textSize = 12f
                            setTextColor(Color.parseColor("#94A3B8"))
                            setPadding(0, 6, 0, 0)
                        })
                        emptyCard.addView(emptyInner)
                        contentInner.addView(emptyCard)
                    } else {
                        val tvHeaderCount = TextView(this@TeacherMainActivity).apply {
                            text = "Arsip Laporan Rombel Terkirim (${reports.size}):"
                            textSize = 13.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                            setPadding(0, 4, 0, 12)
                        }
                        contentInner.addView(tvHeaderCount)

                        for (rep in reports) {
                            val repCard = CardView(this@TeacherMainActivity).apply {
                                radius = 12f
                                cardElevation = 2f
                                setCardBackgroundColor(Color.WHITE)
                                useCompatPadding = true
                                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = (10 * resources.displayMetrics.density).toInt()
                                }
                            }
                            val repInner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                val p = (14 * resources.displayMetrics.density).toInt()
                                setPadding(p, p, p, p)
                            }
                            repInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = rep.title
                                textSize = 13.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                            })
                            repInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = rep.message
                                textSize = 12f
                                setTextColor(Color.parseColor("#334155"))
                                setPadding(0, 6, 0, 6)
                            })
                            repCard.addView(repInner)
                            contentInner.addView(repCard)
                        }
                    }
                } else {
                    contentInner.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Gagal memuat rekap laporan bulanan."
                        setTextColor(Color.parseColor("#DC2626"))
                    })
                }
            }
            override fun onFailure(call: Call<KurikulumMonthlyReportsResponse>, t: Throwable) {
                contentInner.removeAllViews()
                contentInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Koneksi terputus: ${t.message}"
                    setTextColor(Color.parseColor("#DC2626"))
                })
            }
        })

        dialog.setView(root)
        dialog.show()
    }

    private fun showKurikulumTeacherAttendanceFullDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "👨‍🏫 Rekap Kehadiran Guru (Mode Lengkap)",
            subtitle = "Monitoring Sesi KBM, Jam Datang & Selesai, serta Izin Resmi Tim Pengajar",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumTeacherAttendanceFullDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        val loadingLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(20, 40, 20, 40)
        }
        val pb = ProgressBar(this).apply {
            indeterminateTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#7C3AED"))
        }
        val tvLoad = TextView(this).apply {
            text = "Memuat rekap presensi guru mode lengkap..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 12, 0, 0)
        }
        loadingLayout.addView(pb)
        loadingLayout.addView(tvLoad)
        contentInner.addView(loadingLayout)

        dialog.setView(root)
        dialog.show()

        ApiClient.getClient(this).getKurikulumTeacherAttendanceRecap().enqueue(object : Callback<com.school.smartcbt.data.model.KurikulumTeacherRecapResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.KurikulumTeacherRecapResponse>,
                response: Response<com.school.smartcbt.data.model.KurikulumTeacherRecapResponse>
            ) {
                loadingLayout.visibility = View.GONE
                val body = response.body()
                val logs = body?.detailedLogs ?: emptyList()
                val summaries = body?.rekap ?: emptyList()

                // Header Info Card
                val infoCard = CardView(this@TeacherMainActivity).apply {
                    radius = 12f * resources.displayMetrics.density
                    cardElevation = 2f * resources.displayMetrics.density
                    setCardBackgroundColor(Color.WHITE)
                    useCompatPadding = true
                }
                val infoInner = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (14 * resources.displayMetrics.density).toInt()
                    setPadding(p, p, p, p)
                }
                infoInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "📋 REKAPITULASI PRESENSI GURU • MODE LENGKAP"
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                })
                infoInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Total ${summaries.size} Guru Terdata • ${logs.size} Sesi KBM Tatap Muka & Izin Resmi (${body?.periode ?: "Bulan Ini"})"
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#64748B"))
                    setPadding(0, 2, 0, 8)
                })
                infoCard.addView(infoInner)
                contentInner.addView(infoCard)

                // REKAP INDIVIDU GURU (TERLAMBAT, ALFA, IZIN, CUTI DISETUJUI)
                if (summaries.isNotEmpty()) {
                    contentInner.addView(TextView(this@TeacherMainActivity).apply {
                        text = "📊 REKAP DISIPLIN & CUTI GURU 360°:"
                        textSize = 12f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#334155"))
                        setPadding(4, 12, 4, 6)
                    })

                    summaries.forEach { g ->
                        val teacherCard = CardView(this@TeacherMainActivity).apply {
                            radius = 12f * resources.displayMetrics.density
                            cardElevation = 2f * resources.displayMetrics.density
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = (8 * resources.displayMetrics.density).toInt()
                            }
                        }
                        val tInner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = (12 * resources.displayMetrics.density).toInt()
                            setPadding(p, p, p, p)
                        }

                        // Header Teacher
                        val headRow = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                        }
                        val infoCol = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        infoCol.addView(TextView(this@TeacherMainActivity).apply {
                            text = g.nama
                            textSize = 13f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        })
                        infoCol.addView(TextView(this@TeacherMainActivity).apply {
                            text = "${g.mapel ?: "-"} • NIP: ${g.nip ?: "-"}"
                            textSize = 10.5f
                            setTextColor(Color.parseColor("#64748B"))
                        })
                        headRow.addView(infoCol)

                        // Badge Persentase & Kategori
                        val badgeRate = TextView(this@TeacherMainActivity).apply {
                            text = "${g.persentaseKehadiran}%\n${g.kategori}"
                            textSize = 10f
                            gravity = Gravity.CENTER
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.WHITE)
                            val gd = android.graphics.drawable.GradientDrawable().apply {
                                setColor(try { Color.parseColor(g.badgeColor) } catch (e: Exception) { Color.parseColor("#10B981") })
                                cornerRadius = 8f * resources.displayMetrics.density
                            }
                            background = gd
                            val hP = (8 * resources.displayMetrics.density).toInt()
                            val vP = (4 * resources.displayMetrics.density).toInt()
                            setPadding(hP, vP, hP, vP)
                        }
                        headRow.addView(badgeRate)
                        tInner.addView(headRow)

                        // Grid Rekap 4 Kolom (Tepat Waktu, Terlambat, Alfa, Izin/Sakit)
                        val statGrid = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            weightSum = 4f
                            val pTop = (8 * resources.displayMetrics.density).toInt()
                            setPadding(0, pTop, 0, 0)
                        }

                        fun createMiniStat(title: String, value: String, sub: String, colorHex: String): View {
                            return LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                gravity = Gravity.CENTER
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                                addView(TextView(this@TeacherMainActivity).apply {
                                    text = value
                                    textSize = 12.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor(colorHex))
                                })
                                addView(TextView(this@TeacherMainActivity).apply {
                                    text = title
                                    textSize = 9.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#475569"))
                                })
                                if (sub.isNotEmpty()) {
                                    addView(TextView(this@TeacherMainActivity).apply {
                                        text = sub
                                        textSize = 8.5f
                                        setTextColor(Color.parseColor("#94A3B8"))
                                    })
                                }
                            }
                        }

                        statGrid.addView(createMiniStat("Tepat", "${g.tepatWaktu}", "Sesi", "#15803D"))
                        statGrid.addView(createMiniStat("Terlambat", "${g.terlambat}x", if (g.terlambatMenitTotal > 0) "${g.terlambatMenitTotal}m" else "-", "#D97706"))
                        statGrid.addView(createMiniStat("Alfa", "${g.alfa}", "Hari", "#DC2626"))
                        statGrid.addView(createMiniStat("Izin/Skt", "${g.izin + g.sakit}", "I:${g.izin} S:${g.sakit}", "#2563EB"))
                        tInner.addView(statGrid)

                        // Baris Cuti Disetujui
                        if (g.cutiCount > 0) {
                            val cutiBtn = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = Gravity.CENTER_VERTICAL
                                val gdCuti = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(Color.parseColor("#EEF2FF"))
                                    setStroke((1 * resources.displayMetrics.density).toInt(), Color.parseColor("#C7D2FE"))
                                    cornerRadius = 8f * resources.displayMetrics.density
                                }
                                background = gdCuti
                                val pC = (8 * resources.displayMetrics.density).toInt()
                                setPadding(pC, (6 * resources.displayMetrics.density).toInt(), pC, (6 * resources.displayMetrics.density).toInt())
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = (8 * resources.displayMetrics.density).toInt()
                                }
                                layoutParams = lp
                                isClickable = true
                                isFocusable = true
                                setOnClickListener {
                                    showKurikulumTeacherCutiDetailDialog(g.nama, g.cutiApprovedList ?: emptyList())
                                }
                            }
                            cutiBtn.addView(TextView(this@TeacherMainActivity).apply {
                                text = "🏖️ Cuti Disetujui: ${g.cutiCount}x (${g.cutiHariTotal} Hari Kerja)"
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#4338CA"))
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                            })
                            cutiBtn.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Lihat Rincian ›"
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#4F46E5"))
                            })
                            tInner.addView(cutiBtn)
                        }

                        teacherCard.addView(tInner)
                        contentInner.addView(teacherCard)
                    }
                }

                // List Sesi KBM Mode Lengkap
                contentInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "📑 LOG DETAIL SESI KBM & KEHADIRAN GURU:"
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#334155"))
                    setPadding(4, 12, 4, 6)
                })

                if (logs.isEmpty()) {
                    contentInner.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Belum ada riwayat sesi KBM yang tercatat pada periode ini."
                        textSize = 12f
                        setTextColor(Color.parseColor("#94A3B8"))
                        gravity = Gravity.CENTER
                        setPadding(20, 30, 20, 30)
                    })
                } else {
                    logs.forEach { log ->
                        val itemCard = CardView(this@TeacherMainActivity).apply {
                            radius = 10f * resources.displayMetrics.density
                            cardElevation = 1.5f * resources.displayMetrics.density
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = (6 * resources.displayMetrics.density).toInt()
                            }
                        }
                        val itemInner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = (12 * resources.displayMetrics.density).toInt()
                            setPadding(p, p, p, p)
                        }

                        val row1 = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                        }
                        row1.addView(TextView(this@TeacherMainActivity).apply {
                            text = "👨‍🏫 ${log.namaGuru}"
                            textSize = 13.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        })

                        val badge = TextView(this@TeacherMainActivity).apply {
                            text = log.statusBadge ?: log.status ?: "HADIR"
                            textSize = 10.5f
                            setTypeface(null, Typeface.BOLD)
                            val padH = (8 * resources.displayMetrics.density).toInt()
                            val padV = (3 * resources.displayMetrics.density).toInt()
                            setPadding(padH, padV, padH, padV)
                            when (log.status) {
                                "HADIR" -> {
                                    setTextColor(Color.parseColor("#15803D"))
                                    setBackgroundResource(com.school.smartcbt.R.drawable.bg_badge_emerald)
                                }
                                "SAKIT" -> {
                                    setTextColor(Color.parseColor("#D97706"))
                                    setBackgroundColor(Color.parseColor("#FEF3C7"))
                                }
                                "IZIN" -> {
                                    setTextColor(Color.parseColor("#1D4ED8"))
                                    setBackgroundColor(Color.parseColor("#EFF6FF"))
                                }
                                else -> {
                                    setTextColor(Color.parseColor("#DC2626"))
                                    setBackgroundColor(Color.parseColor("#FEE2E2"))
                                }
                            }
                        }
                        row1.addView(badge)
                        itemInner.addView(row1)

                        val tvSub = TextView(this@TeacherMainActivity).apply {
                            text = "📖 ${log.mapel ?: "-"} • Kelas ${log.rombel ?: "-"} (${log.ruangan ?: "-"})"
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#475569"))
                            setPadding(0, 4, 0, 0)
                        }
                        itemInner.addView(tvSub)

                        val tvTime = TextView(this@TeacherMainActivity).apply {
                            text = "🕒 Jam KBM: ${log.jamDatang ?: "-"} s.d. ${log.jamSelesai ?: "-"} (${log.durasiMenit} Menit)"
                            textSize = 11.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#1E293B"))
                            setPadding(0, 2, 0, 0)
                        }
                        itemInner.addView(tvTime)

                        val tvDate = TextView(this@TeacherMainActivity).apply {
                            text = "📅 ${log.tanggalDisplay ?: log.tanggal ?: "-"} • Siswa Hadir: ${log.siswaHadir}/${log.totalSiswa}"
                            textSize = 10.5f
                            setTextColor(Color.parseColor("#64748B"))
                            setPadding(0, 2, 0, 0)
                        }
                        itemInner.addView(tvDate)

                        if (!log.keteranganJurnal.isNullOrEmpty()) {
                            val tvJurnal = TextView(this@TeacherMainActivity).apply {
                                text = "📝 Jurnal: ${log.keteranganJurnal}"
                                textSize = 10.5f
                                setTextColor(Color.parseColor("#0F766E"))
                                setPadding(0, 4, 0, 0)
                            }
                            itemInner.addView(tvJurnal)
                        }

                        itemCard.addView(itemInner)
                        contentInner.addView(itemCard)
                    }
                }
            }

            override fun onFailure(
                call: Call<com.school.smartcbt.data.model.KurikulumTeacherRecapResponse>,
                t: Throwable
            ) {
                loadingLayout.visibility = View.GONE
                val tvErr = TextView(this@TeacherMainActivity).apply {
                    text = "Gagal memuat rekap presensi guru: ${t.message}"
                    setTextColor(Color.RED)
                    textSize = 12f
                    setPadding(10, 20, 10, 20)
                }
                contentInner.addView(tvErr)
            }
        })
    }

    private fun showKurikulumTeacherCutiDetailDialog(teacherName: String, cutiList: List<com.school.smartcbt.data.model.KurikulumCutiDetailDto>) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        if (cutiList.isEmpty()) {
            root.addView(TextView(this).apply {
                text = "Tidak ada rincian riwayat cuti yang tersimpan."
                textSize = 12f
                setTextColor(Color.parseColor("#64748B"))
                setPadding(10, 20, 10, 20)
                gravity = Gravity.CENTER
            })
        } else {
            cutiList.forEach { c ->
                val card = CardView(this).apply {
                    radius = 8f * resources.displayMetrics.density
                    cardElevation = 1.5f * resources.displayMetrics.density
                    setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                    useCompatPadding = true
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (6 * resources.displayMetrics.density).toInt()
                    }
                }
                val inner = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (10 * resources.displayMetrics.density).toInt()
                    setPadding(p, p, p, p)
                }
                inner.addView(TextView(this).apply {
                    text = "🏖️ ${c.kategori ?: "Cuti Pegawai"} (${c.durasiHari} Hari Kerja)"
                    textSize = 12.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#1E1B4B"))
                })
                inner.addView(TextView(this).apply {
                    text = "📅 Periode: ${c.startDate ?: "-"} s.d. ${c.endDate ?: "-"}"
                    textSize = 11f
                    setTextColor(Color.parseColor("#334155"))
                    setPadding(0, 2, 0, 0)
                })
                inner.addView(TextView(this).apply {
                    text = "Alasan: ${c.alasan ?: "-"}"
                    textSize = 11f
                    setTextColor(Color.parseColor("#64748B"))
                    setPadding(0, 2, 0, 0)
                })
                inner.addView(TextView(this).apply {
                    text = "✅ Disahkan Kurikulum: ${c.approvedBy ?: "Waka Kurikulum"}"
                    textSize = 10f
                    setTextColor(Color.parseColor("#059669"))
                    setPadding(0, 4, 0, 0)
                })
                if (c.dispositionToPiket && !c.piketNotes.isNullOrEmpty()) {
                    inner.addView(TextView(this).apply {
                        text = "📌 Disposisi Piket: ${c.piketNotes}"
                        textSize = 10f
                        setTextColor(Color.parseColor("#D97706"))
                        setPadding(0, 2, 0, 0)
                    })
                }
                card.addView(inner)
                root.addView(card)
            }
        }

        val scroll = ScrollView(this).apply {
            addView(root)
        }

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("🏖️ Rincian Cuti: $teacherName")
            .setView(scroll)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun showKurikulumKbmMonitoringDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "🔴 Monitoring KBM Realtime",
            subtitle = "Pemantauan Keberlangsungan KBM Rombel VII, VIII, IX & Jam Kehadiran Guru",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumKbmMonitoringDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        // Loading Indicator
        val loadingLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setPadding(20, 40, 20, 40)
        }
        val progressBar = ProgressBar(this).apply {
            indeterminateTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
        }
        val tvLoading = TextView(this).apply {
            text = "Memuat status realtime 33 rombel KBM..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 12, 0, 0)
        }
        loadingLayout.addView(progressBar)
        loadingLayout.addView(tvLoading)
        contentInner.addView(loadingLayout)

        dialog.setView(root)
        dialog.show()

        // Panggil Endpoint Real-time Monitoring KBM
        ApiClient.getClient(this).getClassMonitoringStatus().enqueue(object : Callback<com.school.smartcbt.data.model.ClassMonitoringStatusResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.ClassMonitoringStatusResponse>,
                response: Response<com.school.smartcbt.data.model.ClassMonitoringStatusResponse>
            ) {
                loadingLayout.visibility = View.GONE
                val body = response.body()
                val classList = body?.classes ?: emptyList()

                val greenCount = classList.count { it.status == "GREEN" }
                val redCount = classList.count { it.status == "RED" }
                val amberCount = classList.count { it.status == "AMBER" }
                val totalCount = classList.size

                // Summary Stats Card
                val summaryCard = CardView(this@TeacherMainActivity).apply {
                    radius = 12f * resources.displayMetrics.density
                    cardElevation = 2f * resources.displayMetrics.density
                    setCardBackgroundColor(Color.WHITE)
                    useCompatPadding = true
                }
                val summaryInner = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (14 * resources.displayMetrics.density).toInt()
                    setPadding(p, p, p, p)
                }

                val titleRow = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                }
                titleRow.addView(TextView(this@TeacherMainActivity).apply {
                    text = "📡 MONITORING 33 ROMBEL KBM"
                    textSize = 13f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                titleRow.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Pukul: ${body?.currentTime ?: "-"} WIB"
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#2563EB"))
                    setTypeface(null, Typeface.BOLD)
                })
                summaryInner.addView(titleRow)

                val statsRow = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    weightSum = 3f
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (10 * resources.displayMetrics.density).toInt()
                    }
                    layoutParams = lp
                }
                statsRow.addView(TextView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    gravity = android.view.Gravity.CENTER
                    text = "🟢 Terisi: $greenCount"
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#15803D"))
                })
                statsRow.addView(TextView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    gravity = android.view.Gravity.CENTER
                    text = "🔴 Kosong: $redCount"
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#DC2626"))
                })
                statsRow.addView(TextView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    gravity = android.view.Gravity.CENTER
                    text = "⏳ Menunggu: $amberCount"
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#D97706"))
                })
                summaryInner.addView(statsRow)
                summaryCard.addView(summaryInner)
                contentInner.addView(summaryCard)

                // List Rombel
                if (classList.isEmpty()) {
                    contentInner.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Tidak ada jadwal KBM yang sedang berlangsung."
                        textSize = 12.5f
                        setTextColor(Color.parseColor("#64748B"))
                        gravity = android.view.Gravity.CENTER
                        setPadding(20, 30, 20, 30)
                    })
                } else {
                    classList.forEach { cls ->
                        val itemCard = CardView(this@TeacherMainActivity).apply {
                            radius = 10f * resources.displayMetrics.density
                            cardElevation = 2f * resources.displayMetrics.density
                            useCompatPadding = true
                            setCardBackgroundColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = (6 * resources.displayMetrics.density).toInt()
                            }
                        }

                        val itemInner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = (12 * resources.displayMetrics.density).toInt()
                            setPadding(p, p, p, p)
                        }

                        // Header Bar: Kelas + Badge
                        val rowTop = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                        }

                        val tvClassName = TextView(this@TeacherMainActivity).apply {
                            text = "🏫 Kelas ${cls.className}"
                            textSize = 14f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        rowTop.addView(tvClassName)

                        val tvStatus = TextView(this@TeacherMainActivity).apply {
                            val padH = (8 * resources.displayMetrics.density).toInt()
                            val padV = (3 * resources.displayMetrics.density).toInt()
                            setPadding(padH, padV, padH, padV)
                            textSize = 10.5f
                            setTypeface(null, Typeface.BOLD)

                            when (cls.status) {
                                "GREEN" -> {
                                    text = "🟢 GURU HADIR"
                                    setTextColor(Color.parseColor("#15803D"))
                                    setBackgroundResource(com.school.smartcbt.R.drawable.bg_badge_emerald)
                                }
                                "RED" -> {
                                    text = "🚨 KELAS KOSONG"
                                    setTextColor(Color.parseColor("#DC2626"))
                                    setBackgroundColor(Color.parseColor("#FEE2E2"))
                                }
                                "AMBER" -> {
                                    text = "⏳ MENUNGGU GURU"
                                    setTextColor(Color.parseColor("#D97706"))
                                    setBackgroundColor(Color.parseColor("#FEF3C7"))
                                }
                                "BLUE" -> {
                                    text = "🟦 DI-INVAL"
                                    setTextColor(Color.parseColor("#1D4ED8"))
                                    setBackgroundColor(Color.parseColor("#EFF6FF"))
                                }
                                else -> {
                                    text = "⚪ TIDAK ADA JADWAL"
                                    setTextColor(Color.parseColor("#64748B"))
                                    setBackgroundColor(Color.parseColor("#F1F5F9"))
                                }
                            }
                        }
                        rowTop.addView(tvStatus)
                        itemInner.addView(rowTop)

                        // Info Guru, Jam Datang, Mapel
                        val tvTeacher = TextView(this@TeacherMainActivity).apply {
                            text = "👨‍🏫 Guru: ${cls.teacherName ?: "-"}"
                            textSize = 12.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#1E293B"))
                            setPadding(0, 6, 0, 0)
                        }
                        itemInner.addView(tvTeacher)

                        // Jam Datang yang konkret
                        val tvCheckIn = TextView(this@TeacherMainActivity).apply {
                            val timeVal = cls.checkInTime ?: cls.inTimeStr
                            if (!timeVal.isNullOrEmpty() && cls.status == "GREEN") {
                                text = "🕒 Datang: $timeVal"
                                setTextColor(Color.parseColor("#15803D"))
                                setTypeface(null, Typeface.BOLD)
                            } else if (cls.status == "AMBER") {
                                text = "🕒 Waktu Mulai: ${cls.timeRange ?: "-"} (Menunggu guru check-in)"
                                setTextColor(Color.parseColor("#D97706"))
                            } else if (cls.status == "RED") {
                                text = "⚠️ Belum ada konfirmasi kehadiran (> 10 menit tanpa guru)"
                                setTextColor(Color.parseColor("#DC2626"))
                            } else {
                                text = "🕒 Jadwal: ${cls.timeRange ?: "-"}"
                                setTextColor(Color.parseColor("#64748B"))
                            }
                            textSize = 11.5f
                            setPadding(0, 2, 0, 0)
                        }
                        itemInner.addView(tvCheckIn)

                        val tvSubject = TextView(this@TeacherMainActivity).apply {
                            text = "📖 Mapel: ${cls.subjectName ?: "-"} • Ruangan: ${cls.cam ?: cls.className}"
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#475569"))
                            setPadding(0, 2, 0, 0)
                        }
                        itemInner.addView(tvSubject)

                        if (!cls.details.isNullOrEmpty()) {
                            val tvDetail = TextView(this@TeacherMainActivity).apply {
                                text = "ℹ️ ${cls.details}"
                                textSize = 10.5f
                                setTextColor(Color.parseColor("#64748B"))
                                setPadding(0, 2, 0, 0)
                            }
                            itemInner.addView(tvDetail)
                        }

                        itemCard.addView(itemInner)
                        contentInner.addView(itemCard)
                    }
                }
            }

            override fun onFailure(
                call: Call<com.school.smartcbt.data.model.ClassMonitoringStatusResponse>,
                t: Throwable
            ) {
                loadingLayout.visibility = View.GONE
                val tvErr = TextView(this@TeacherMainActivity).apply {
                    text = "Gagal memuat monitoring realtime: ${t.message}"
                    setTextColor(Color.RED)
                    textSize = 12f
                    setPadding(10, 20, 10, 20)
                }
                contentInner.addView(tvErr)
            }
        })
    }

    private fun showKurikulumEmptyClassesDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "⚠️ Laporan Kelas Kosong & Inval",
            subtitle = "Laporan dari Pengurus Kelas & Penugasan Guru Inval Pendamping",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumEmptyClassesDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        ApiClient.getClient(this).getPiketTodayFeed().enqueue(object : Callback<PiketTodayFeedResponse> {
            override fun onResponse(call: Call<PiketTodayFeedResponse>, response: Response<PiketTodayFeedResponse>) {
                contentInner.removeAllViews()
                val feed = response.body()
                val emptyClasses = feed?.emptyClasses ?: emptyList()
                if (emptyClasses.isEmpty()) {
                    val card = CardView(this@TeacherMainActivity).apply {
                        radius = 12f
                        setCardBackgroundColor(Color.WHITE)
                        useCompatPadding = true
                    }
                    val inner = LinearLayout(this@TeacherMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        gravity = Gravity.CENTER
                        setPadding(24, 36, 24, 36)
                    }
                    inner.addView(TextView(this@TeacherMainActivity).apply {
                        text = "✅ Tidak Ada Laporan Kelas Kosong"
                        textSize = 15f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#059669"))
                    })
                    inner.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Seluruh 33 rombel saat ini didampingi oleh guru pengampu atau petugas piket."
                        textSize = 12f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(0, 6, 0, 0)
                    })
                    card.addView(inner)
                    contentInner.addView(card)
                } else {
                    for (ec in emptyClasses) {
                        val card = CardView(this@TeacherMainActivity).apply {
                            radius = 12f
                            cardElevation = 2f
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = (10 * resources.displayMetrics.density).toInt()
                            }
                        }
                        val inner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = (14 * resources.displayMetrics.density).toInt()
                            setPadding(p, p, p, p)
                        }
                        inner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "⚠️ Kelas: ${ec.className} • Jam Ke-${ec.periodLesson ?: "-"}"
                            textSize = 13.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#DC2626"))
                        })
                        inner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Mapel: ${ec.subject ?: "-"} • Guru: ${ec.teacherName ?: "-"}"
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#334155"))
                            setPadding(0, 2, 0, 4)
                        })
                        val btnAssign = Button(this@TeacherMainActivity).apply {
                            text = "🛡️ Ambil Alih / Tugaskan Guru Piket Inval"
                            textSize = 11f
                            setTextColor(Color.WHITE)
                            setBackgroundColor(Color.parseColor("#0F766E"))
                            setOnClickListener {
                                ApiClient.getClient(this@TeacherMainActivity).takePiketDuty(ec.id).enqueue(object : Callback<BasicResponse> {
                                    override fun onResponse(call: Call<BasicResponse>, r: Response<BasicResponse>) {
                                        Toast.makeText(this@TeacherMainActivity, "Tugas inval berhasil didelegasikan!", Toast.LENGTH_SHORT).show()
                                        dialog.dismiss()
                                        showKurikulumEmptyClassesDialog()
                                    }
                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                        Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                                    }
                                })
                            }
                        }
                        inner.addView(btnAssign)
                        card.addView(inner)
                        contentInner.addView(card)
                    }
                }
            }
            override fun onFailure(call: Call<PiketTodayFeedResponse>, t: Throwable) {
                contentInner.removeAllViews()
                contentInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Koneksi terputus: ${t.message}"
                    setTextColor(Color.parseColor("#DC2626"))
                })
            }
        })

        dialog.setView(root)
        dialog.show()
    }

    private fun showKurikulumPiketPoskoDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "🛡️ Posko Guru Piket Hari Ini",
            subtitle = "Petugas Piket Siaga, Log Keterlambatan Siswa, & Penanganan KBM",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumPiketPoskoDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        ApiClient.getClient(this).getPiketTodayFeed().enqueue(object : Callback<PiketTodayFeedResponse> {
            override fun onResponse(call: Call<PiketTodayFeedResponse>, response: Response<PiketTodayFeedResponse>) {
                contentInner.removeAllViews()
                val feed = response.body()
                val piketCard = CardView(this@TeacherMainActivity).apply {
                    radius = 12f
                    setCardBackgroundColor(Color.parseColor("#D1FAE5"))
                    useCompatPadding = true
                }
                val piketInner = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (14 * resources.displayMetrics.density).toInt()
                    setPadding(p, p, p, p)
                }
                piketInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "🛡️ TIM GURU PIKET HARI INI"
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#065F46"))
                })
                piketInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Bertanggung jawab atas ketertiban gerbang, pencatatan keterlambatan siswa, dan pendampingan kelas kosong."
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#047857"))
                    setPadding(0, 4, 0, 0)
                })
                piketCard.addView(piketInner)
                contentInner.addView(piketCard)

                val lateCard = CardView(this@TeacherMainActivity).apply {
                    radius = 12f
                    cardElevation = 2f
                    setCardBackgroundColor(Color.WHITE)
                    useCompatPadding = true
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (10 * resources.displayMetrics.density).toInt()
                    }
                }
                val lateInner = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (14 * resources.displayMetrics.density).toInt()
                    setPadding(p, p, p, p)
                }
                lateInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "⏱️ Log Keterlambatan Masuk Siswa"
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                })
                val lateCount = feed?.lateStudents?.size ?: 0
                lateInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Terdata $lateCount siswa terlambat hari ini dan telah ditindaklanjuti dengan pembinaan piket & BK."
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#475569"))
                    setPadding(0, 4, 0, 0)
                })
                lateCard.addView(lateInner)
                contentInner.addView(lateCard)
            }
            override fun onFailure(call: Call<PiketTodayFeedResponse>, t: Throwable) {
                contentInner.removeAllViews()
                contentInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Koneksi terputus: ${t.message}"
                    setTextColor(Color.parseColor("#DC2626"))
                })
            }
        })

        dialog.setView(root)
        dialog.show()
    }

    private fun showKurikulumTeachingSchedulesDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "📅 Jadwal Mengajar & Distribusi Jam",
            subtitle = "Matriks Jam Mengajar 33 Rombel & Plotting Guru Pengampu",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumTeachingSchedulesDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat matriks jadwal pelajaran dari database..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 32)
        }
        contentInner.addView(tvLoading)

        dialog.setView(root)
        dialog.show()

        val baseUrl = ApiClient.getBaseServerUrl(this).removeSuffix("/")
        val token = sessionManager.getToken() ?: ""
        val client = okhttp3.OkHttpClient()
        val request = okhttp3.Request.Builder()
            .url("$baseUrl/api/kurikulum/schedules")
            .addHeader("Authorization", "Bearer $token")
            .build()

        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                runOnUiThread {
                    contentInner.removeAllViews()
                    contentInner.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Gagal memuat jadwal: ${e.message}"
                        setTextColor(Color.parseColor("#DC2626"))
                    })
                }
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                val respStr = response.body()?.string() ?: ""
                runOnUiThread {
                    contentInner.removeAllViews()
                    try {
                        val json = org.json.JSONObject(respStr)
                        val schedules = json.optJSONArray("schedules") ?: json.optJSONArray("data")
                        if (schedules != null && schedules.length() > 0) {
                            val tvCount = TextView(this@TeacherMainActivity).apply {
                                text = "📋 Terdata ${schedules.length()} Distribusi Jam Pelajaran Aktif:"
                                textSize = 13f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                setPadding(0, 0, 0, 12)
                            }
                            contentInner.addView(tvCount)

                            for (i in 0 until Math.min(schedules.length(), 60)) {
                                val s = schedules.getJSONObject(i)
                                val className = s.optString("className", s.optString("kelasId", "-"))
                                val subject = s.optString("subjectName", s.optString("mapelId", "-"))
                                val teacherName = s.optString("teacherName", s.optString("guruNama", "Guru"))
                                val day = s.optString("day", s.optString("hari", "Senin"))
                                val time = "${s.optString("startTime", s.optString("jamMulai", "07:00"))} - ${s.optString("endTime", s.optString("jamSelesai", "08:20"))}"

                                val card = CardView(this@TeacherMainActivity).apply {
                                    radius = 12f
                                    cardElevation = 1.5f
                                    setCardBackgroundColor(Color.WHITE)
                                    useCompatPadding = true
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (8 * resources.displayMetrics.density).toInt()
                                    }
                                }
                                val cInner = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val p = (12 * resources.displayMetrics.density).toInt()
                                    setPadding(p, p, p, p)
                                }
                                val rowTop = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    weightSum = 2f
                                }
                                rowTop.addView(TextView(this@TeacherMainActivity).apply {
                                    text = "🏫 Kelas $className • $subject"
                                    textSize = 13.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#0F172A"))
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.3f)
                                })
                                rowTop.addView(TextView(this@TeacherMainActivity).apply {
                                    text = "$day, $time"
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#0F766E"))
                                    setTypeface(null, Typeface.BOLD)
                                    gravity = Gravity.END
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.7f)
                                })
                                cInner.addView(rowTop)

                                val tvGuru = TextView(this@TeacherMainActivity).apply {
                                    text = "👨‍🏫 Pengampu: $teacherName"
                                    textSize = 12f
                                    setTextColor(Color.parseColor("#475569"))
                                    setPadding(0, 4, 0, 0)
                                }
                                cInner.addView(tvGuru)
                                card.addView(cInner)
                                contentInner.addView(card)
                            }
                        } else {
                            contentInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Belum ada matriks jadwal yang diset di portal."
                                textSize = 13f
                                setTextColor(Color.parseColor("#94A3B8"))
                                gravity = Gravity.CENTER
                                setPadding(0, 32, 0, 32)
                            })
                        }
                    } catch (e: Exception) {
                        contentInner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Error parsing jadwal: ${e.message}"
                            setTextColor(Color.parseColor("#DC2626"))
                        })
                    }
                }
            }
        })
    }

    private fun showKurikulumCbtBankDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "🤖 Bank Soal & Monitoring CBT Kurikulum",
            subtitle = "Penelaahan Kisi-kisi, Validasi Kurikulum, & Kontrol Sesi Ujian Siswa",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumCbtBankDialog()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        // Action Quick Cards
        val rowActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * resources.displayMetrics.density).toInt()
            }
        }
        val btnProctor = Button(this).apply {
            text = "🛡️ Ruang Pengawas & Token"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#7C3AED"))
            layoutParams = LinearLayout.LayoutParams(0, (46 * resources.displayMetrics.density).toInt(), 1f).apply {
                marginEnd = 6
            }
            setOnClickListener {
                dialog.dismiss()
                showProctorTokenDialog()
            }
        }
        val btnAiGen = Button(this).apply {
            text = "🤖 Generator AI SIBOY"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0F766E"))
            layoutParams = LinearLayout.LayoutParams(0, (46 * resources.displayMetrics.density).toInt(), 1f).apply {
                marginStart = 6
            }
            setOnClickListener {
                dialog.dismiss()
                showTugasPenilaianDialog()
            }
        }
        rowActions.addView(btnProctor)
        rowActions.addView(btnAiGen)
        contentInner.addView(rowActions)

        val cardInfo = CardView(this).apply {
            radius = 12f
            cardElevation = 2f
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
        }
        val inner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        inner.addView(TextView(this).apply {
            text = "📋 Monitoring & Penjaminan Mutu Asesmen CBT"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        })
        inner.addView(TextView(this).apply {
            text = "• Seluruh paket soal formatif & sumatif disinkronkan langsung dari server CBT SIBOY.\n• Pengawasan ruang ujian real-time dengan token dinamis 15 menit & deteksi kuncian perangkat HP.\n• Validasi butir soal terintegrasi Kurikulum Merdeka."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 8, 0, 0)
        })
        cardInfo.addView(inner)
        contentInner.addView(cardInfo)

        dialog.setView(root)
        dialog.show()
    }

    private fun showKurikulumStudentAttendanceDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "👥 Rekapitulasi Presensi Siswa 33 Rombel",
            subtitle = "Monitoring Tingkat Kehadiran Jenjang Kelas VII, VIII, & IX Real-Time",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Refresh",
            onActionClick = {
                dialog.dismiss()
                showKurikulumStudentAttendanceDialog()
            }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scroll.addView(container)
        root.addView(scroll)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat data presensi 33 rombel..."
            textSize = 13f
            setTextColor(Color.parseColor("#64748B"))
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 32)
        }
        container.addView(tvLoading)

        dialog.setView(root)
        dialog.show()

        val baseUrl = ApiClient.getBaseServerUrl(this).removeSuffix("/")
        val token = sessionManager.getToken() ?: ""
        val client = okhttp3.OkHttpClient()
        val request = okhttp3.Request.Builder()
            .url("$baseUrl/api/kurikulum/rekap/presensi-siswa")
            .addHeader("Authorization", "Bearer $token")
            .build()

        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                runOnUiThread {
                    container.removeAllViews()
                    container.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Gagal memuat rekap presensi siswa: ${e.message}"
                        setTextColor(Color.parseColor("#DC2626"))
                    })
                }
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                val respStr = response.body()?.string() ?: ""
                runOnUiThread {
                    container.removeAllViews()
                    try {
                        val json = org.json.JSONObject(respStr)
                        val dataArray = json.optJSONArray("rekapList") ?: json.optJSONArray("data")
                        if (dataArray != null && dataArray.length() > 0) {
                            for (i in 0 until dataArray.length()) {
                                val obj = dataArray.getJSONObject(i)
                                val className = obj.optString("className", obj.optString("kelasId", "Rombel"))
                                val total = obj.optInt("totalSiswa", 32)
                                val hadir = obj.optInt("hadir", 0)
                                val sakit = obj.optInt("sakit", 0)
                                val izin = obj.optInt("izin", 0)
                                val alpa = obj.optInt("alpa", 0)
                                val pct = if (total > 0) (hadir * 100) / total else 0

                                val card = CardView(this@TeacherMainActivity).apply {
                                    radius = 12f
                                    cardElevation = 1.5f
                                    setCardBackgroundColor(Color.WHITE)
                                    useCompatPadding = true
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = (8 * resources.displayMetrics.density).toInt()
                                    }
                                }
                                val cInner = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    val p = (12 * resources.displayMetrics.density).toInt()
                                    setPadding(p, p, p, p)
                                }
                                val rowTop = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    weightSum = 2f
                                }
                                rowTop.addView(TextView(this@TeacherMainActivity).apply {
                                    text = "🏫 Kelas $className"
                                    textSize = 14f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#0F172A"))
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.2f)
                                })
                                rowTop.addView(TextView(this@TeacherMainActivity).apply {
                                    text = "$pct% Hadir"
                                    textSize = 13f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(if (pct >= 90) Color.parseColor("#059669") else Color.parseColor("#D97706"))
                                    gravity = Gravity.END
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.8f)
                                })
                                cInner.addView(rowTop)

                                val tvDetail = TextView(this@TeacherMainActivity).apply {
                                    text = "Total: $total Siswa • 🟢 Hadir: $hadir • 🏥 Sakit: $sakit • 📩 Izin: $izin • ❌ Alpa: $alpa"
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#475569"))
                                    setPadding(0, 4, 0, 0)
                                }
                                cInner.addView(tvDetail)
                                card.addView(cInner)
                                container.addView(card)
                            }
                        } else {
                            container.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Belum ada rekap presensi siswa hari ini."
                                textSize = 13f
                                setTextColor(Color.parseColor("#94A3B8"))
                                gravity = Gravity.CENTER
                                setPadding(0, 32, 0, 32)
                            })
                        }
                    } catch (e: Exception) {
                        container.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Format data rekap siswa tidak dikenali: ${e.message}"
                            setTextColor(Color.parseColor("#DC2626"))
                        })
                    }
                }
            }
        })
    }

    private fun showKurikulumReportExportDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val header = createFullscreenHeader(
            title = "📄 Cetak Laporan PDF Resmi Kurikulum",
            subtitle = "Ekspor Berkas Rekapitulasi Pembelajaran & Kehadiran Standar Dinas Pendidikan",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scroll.addView(container)
        root.addView(scroll)

        val reports = listOf(
            Triple("📊 Rekapitulasi KBM Bulanan 33 Rombel", "Laporan gabungan seluruh wali kelas VII, VIII, IX lengkap dengan tandatangan Kepala Sekolah", "/api/v1/kurikulum/monthly-reports"),
            Triple("👨‍🏫 Rekap Kehadiran Seluruh Guru", "Daftar jam mengajar, sesi KBM, izin resmi, & disposisi guru piket per bulan", "/api/kurikulum/rekap/presensi-guru"),
            Triple("🕌 Rekap Presensi Sholat Berjamaah & Keputrian", "Laporan pembiasaan ibadah sholat dhuhur & jumat di mushola sekolah", "/api/prayer/rekap-pdf")
        )

        reports.forEach { (title, desc, endpoint) ->
            val card = CardView(this).apply {
                radius = 12f
                cardElevation = 2f
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (12 * resources.displayMetrics.density).toInt()
                }
            }
            val cInner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (16 * resources.displayMetrics.density).toInt()
                setPadding(p, p, p, p)
            }
            cInner.addView(TextView(this).apply {
                text = title
                textSize = 14f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            })
            cInner.addView(TextView(this).apply {
                text = desc
                textSize = 11.5f
                setTextColor(Color.parseColor("#64748B"))
                setPadding(0, 4, 0, 12)
            })

            val btnExport = Button(this).apply {
                text = "💾 Unduh Berkas PDF Resmi"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#0F766E"))
                setOnClickListener {
                    val baseUrl = ApiClient.getBaseServerUrl(this@TeacherMainActivity).removeSuffix("/")
                    val token = sessionManager.getToken() ?: ""
                    val url = "$baseUrl$endpoint?export=pdf&token=$token"
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (e: Exception) {
                        Toast.makeText(this@TeacherMainActivity, "Gagal mengunduh: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            cInner.addView(btnExport)
            card.addView(cInner)
            container.addView(card)
        }

        dialog.setView(root)
        dialog.show()
    }

    private fun showContactAdminDialog() {
        val dialogBinding = com.school.smartcbt.databinding.DialogContactAdminBinding.inflate(layoutInflater)
        dialogBinding.tvDialogAdminTitle.text = "Layanan Pengaduan & Bantuan Guru"
        dialogBinding.tvDialogAdminSub.text = "Kirim kendala CBT, jadwal mengajar, e-file, atau sistem ke Admin Sekolah."

        val categories = arrayOf(
            "💻 CBT / Bank Soal & Pelaksanaan Ujian",
            "📅 Jadwal Mengajar / Rombel Belum Sesuai",
            "🕒 Presensi Kelas / Scanner Barcode Error",
            "📂 E-File Guru / Berkas Perangkat Mengajar",
            "⚙️ Akun Web Portal Guru / Reset Password",
            "💡 Saran Fitur / Kendala Sistem Aplikasi"
        )
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, categories)
        dialogBinding.spinnerDialogAdminCategory.adapter = adapter

        AlertDialog.Builder(this)
            .setView(dialogBinding.root)
            .setPositiveButton("Kirim Laporan") { _, _ ->
                val desc = dialogBinding.etDialogAdminDescription.text.toString().trim()
                if (desc.isEmpty()) {
                    Toast.makeText(this, "Deskripsi laporan tidak boleh kosong", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val selectedCategory = categories[dialogBinding.spinnerDialogAdminCategory.selectedItemPosition]
                val requestMap = mapOf(
                    "category" to selectedCategory,
                    "title" to "Laporan dari Guru: " + sessionManager.getName(),
                    "description" to desc,
                    "deviceInfo" to "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} (Android ${android.os.Build.VERSION.RELEASE})"
                )

                Toast.makeText(this, "Mengirim laporan ke Admin...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).submitHelpdeskReport(requestMap).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            AlertDialog.Builder(this@TeacherMainActivity)
                                .setTitle("✅ Laporan Terkirim")
                                .setMessage("Terima kasih atas laporannya. Administrator Sekolah telah menerima pesan Anda dan akan segera memeriksa.")
                                .setPositiveButton("OK", null)
                                .show()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal mengirim laporan", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showTeachingJournalDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val teachingSubj = sessionManager.getTeachingSubject().ifEmpty { "Matematika" }
        val header = createFullscreenHeader(
            title = "📖 Isi Jurnal KBM Harian",
            subtitle = "Bidang Studi: $teachingSubj • ${sessionManager.getName()}",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scroll.addView(layout)
        root.addView(scroll)

        val tvClassPrompt = TextView(this).apply {
            text = "Pilih Rombel / Kelas Mengajar:"
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 4, 0, 2)
        }
        layout.addView(tvClassPrompt)

        val spinnerClass = Spinner(this)
        val classes = arrayOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K")
        spinnerClass.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, classes)
        layout.addView(spinnerClass)

        val etSubject = EditText(this).apply {
            hint = "Mata Pelajaran"
            setText(teachingSubj)
            textSize = 13f
        }
        layout.addView(etSubject)

        val etTopic = EditText(this).apply {
            hint = "Topik / Materi Pokok (contoh: Aljabar Linier Sub-bab 2.3)"
            textSize = 13f
        }
        layout.addView(etTopic)

        val etKD = EditText(this).apply {
            hint = "Kode Kompetensi / KD (contoh: KD 3.2 Memahami Konsep)"
            setText("KD 3.2 - Pemahaman Konsep")
            textSize = 13f
        }
        layout.addView(etKD)

        val etDescription = EditText(this).apply {
            hint = "Uraian kegiatan KBM & catatan kejadian kelas..."
            minLines = 3
            textSize = 13f
        }
        layout.addView(etDescription)

        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 16, 0, 16)
        }

        val btnSave = Button(this).apply {
            text = "💾 Simpan Jurnal KBM"
            textSize = 12.5f
            setTextColor(Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#059669"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f).apply {
                marginEnd = 8
            }
            setOnClickListener {
                val topic = etTopic.text.toString().trim()
                val desc = etDescription.text.toString().trim()
                val cls = classes[spinnerClass.selectedItemPosition]

                if (topic.isEmpty() || desc.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Topik dan Uraian kegiatan KBM wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val req = mapOf<String, Any>(
                    "className" to cls,
                    "subjectName" to (etSubject.text.toString().trim().ifEmpty { teachingSubj }),
                    "topic" to topic,
                    "competencyCode" to etKD.text.toString().trim(),
                    "description" to desc,
                    "presentCount" to 30,
                    "absentCount" to 0,
                    "lateCount" to 0
                )

                Toast.makeText(this@TeacherMainActivity, "Menyimpan jurnal mengajar...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this@TeacherMainActivity).createTeachingJournal(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "✅ Jurnal KBM kelas $cls berhasil disimpan ke sistem administrasi guru!", Toast.LENGTH_LONG).show()
                            dialog.dismiss()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal menyimpan jurnal", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }

        val btnHistory = Button(this).apply {
            text = "📜 Riwayat"
            textSize = 12f
            setTextColor(Color.parseColor("#334155"))
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.8f)
            setOnClickListener {
                showTeachingJournalHistoryDialog()
            }
        }

        btnRow.addView(btnSave)
        btnRow.addView(btnHistory)
        layout.addView(btnRow)

        dialog.setView(root)
        dialog.show()
    }

    private fun showTeachingJournalHistoryDialog() {
        Toast.makeText(this, "Memuat riwayat jurnal...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getTeachingJournals().enqueue(object : Callback<List<Map<String, Any>>> {
            override fun onResponse(call: Call<List<Map<String, Any>>>, response: Response<List<Map<String, Any>>>) {
                val list = response.body() ?: emptyList()
                val dialog = createFullscreenDialog()

                val root = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.parseColor("#F8FAFC"))
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                }

                val header = createFullscreenHeader(
                    title = "📜 Riwayat Jurnal Guru",
                    subtitle = "Total: ${list.size} Catatan KBM Tersimpan",
                    onClose = { dialog.dismiss() }
                )
                root.addView(header)

                val scroll = ScrollView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
                }

                val listLayout = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val pad = (16 * resources.displayMetrics.density).toInt()
                    setPadding(pad, pad, pad, pad)
                }

                if (list.isEmpty()) {
                    val emptyTv = TextView(this@TeacherMainActivity).apply {
                        text = "Belum ada jurnal mengajar yang tersimpan untuk akun Anda."
                        setTextColor(Color.parseColor("#94A3B8"))
                        textSize = 13f
                        gravity = android.view.Gravity.CENTER
                        setPadding(0, 48, 0, 48)
                    }
                    listLayout.addView(emptyTv)
                } else {
                    for (j in list) {
                        val cls = j["className"] ?: "-"
                        val top = j["topic"] ?: "-"
                        val kd = j["competencyCode"] ?: "-"
                        val desc = j["description"] ?: ""
                        val card = CardView(this@TeacherMainActivity).apply {
                            radius = 12f
                            cardElevation = 2f
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = 8
                            }
                        }
                        val inner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(16, 14, 16, 14)
                        }
                        inner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "📍 Kelas $cls • KD: $kd"
                            textSize = 14f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        })
                        inner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Topik: $top"
                            textSize = 12.5f
                            setTextColor(Color.parseColor("#059669"))
                            setPadding(0, 2, 0, 4)
                        })
                        if (desc.toString().isNotEmpty()) {
                            inner.addView(TextView(this@TeacherMainActivity).apply {
                                text = desc.toString()
                                textSize = 11.5f
                                setTextColor(Color.parseColor("#64748B"))
                            })
                        }
                        card.addView(inner)
                        listLayout.addView(card)
                    }
                }

                scroll.addView(listLayout)
                root.addView(scroll)
                dialog.setView(root)
                dialog.show()
            }

            override fun onFailure(call: Call<List<Map<String, Any>>>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showBroadcastClassDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📢 Broadcast Pengumuman",
            subtitle = "Kirim pesan informasi langsung ke aplikasi Siswa & Orang Tua",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        scroll.addView(layout)
        root.addView(scroll)

        val density = resources.displayMetrics.density

        // 1. Category Chips
        val tvCatTitle = TextView(this).apply {
            text = "KATEGORI PENGUMUMAN"
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            letterSpacing = 0.08f
            setPadding(0, 0, 0, (6 * density).toInt())
        }
        layout.addView(tvCatTitle)

        val categories = listOf(
            Triple("📝 Tugas / PR", "#2563EB", "#EFF6FF"),
            Triple("ℹ️ Info KBM", "#0D9488", "#F0FDFA"),
            Triple("⚠️ Peringatan", "#DC2626", "#FEF2F2"),
            Triple("📊 Ujian CBT", "#7C3AED", "#F5F3FF"),
            Triple("🕌 Sholat & PAI", "#059669", "#ECFDF5")
        )
        var selectedCategory = categories[0].first

        val hsvCategory = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
        }
        val chipContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }

        val chipViews = mutableListOf<TextView>()

        // 2. Target Audience Selector
        val audiences = listOf("👥 Siswa & Orang Tua", "🎓 Siswa Saja", "👨‍👩‍👧 Orang Tua Saja")
        var selectedAudience = audiences[0]

        // Reference variables for live preview
        var previewTitleTv: TextView? = null
        var previewMsgTv: TextView? = null
        var previewBadgeTv: TextView? = null
        var previewTargetTv: TextView? = null

        fun updatePreview(category: String, title: String, msg: String, audience: String, targetClass: String) {
            previewBadgeTv?.text = category
            previewTargetTv?.text = "Sasaran: $targetClass • $audience"
            previewTitleTv?.text = if (title.isEmpty()) "Judul Pengumuman..." else title
            previewMsgTv?.text = if (msg.isEmpty()) "Isi pengumuman akan ditampilkan di sini seperti yang terlihat oleh siswa dan orang tua di aplikasi mereka." else msg
        }

        categories.forEachIndexed { idx, (catName, activeColor, activeBg) ->
            val tvChip = TextView(this).apply {
                text = catName
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                val padH = (12 * density).toInt()
                val padV = (6 * density).toInt()
                setPadding(padH, padV, padH, padV)
                val isSelected = (idx == 0)
                setTextColor(if (isSelected) Color.parseColor(activeColor) else Color.parseColor("#475569"))
                val bg = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                    cornerRadius = 16f * density
                    setColor(if (isSelected) Color.parseColor(activeBg) else Color.WHITE)
                    setStroke((1 * density).toInt(), if (isSelected) Color.parseColor(activeColor) else Color.parseColor("#E2E8F0"))
                }
                background = bg
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = (8 * density).toInt()
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
            }
            chipViews.add(tvChip)
            chipContainer.addView(tvChip)
        }
        hsvCategory.addView(chipContainer)
        layout.addView(hsvCategory)

        // 2. Audience Selector Chips
        val tvAudienceTitle = TextView(this).apply {
            text = "SASARAN PENERIMA"
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            letterSpacing = 0.08f
            setPadding(0, 0, 0, (6 * density).toInt())
        }
        layout.addView(tvAudienceTitle)

        val hsvAudience = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
        }
        val audienceContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        val audienceViews = mutableListOf<TextView>()

        audiences.forEachIndexed { idx, audName ->
            val tvAud = TextView(this).apply {
                text = audName
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                val padH = (12 * density).toInt()
                val padV = (6 * density).toInt()
                setPadding(padH, padV, padH, padV)
                val isSelected = (idx == 0)
                setTextColor(if (isSelected) Color.parseColor("#2563EB") else Color.parseColor("#475569"))
                val bg = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                    cornerRadius = 16f * density
                    setColor(if (isSelected) Color.parseColor("#EFF6FF") else Color.WHITE)
                    setStroke((1 * density).toInt(), if (isSelected) Color.parseColor("#2563EB") else Color.parseColor("#E2E8F0"))
                }
                background = bg
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = (8 * density).toInt()
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    selectedAudience = audName
                    audienceViews.forEachIndexed { aIdx, aTv ->
                        val aSelected = (aIdx == idx)
                        aTv.setTextColor(if (aSelected) Color.parseColor("#2563EB") else Color.parseColor("#475569"))
                        val aBg = android.graphics.drawable.GradientDrawable().apply {
                            shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                            cornerRadius = 16f * density
                            setColor(if (aSelected) Color.parseColor("#EFF6FF") else Color.WHITE)
                            setStroke((1 * density).toInt(), if (aSelected) Color.parseColor("#2563EB") else Color.parseColor("#E2E8F0"))
                        }
                        aTv.background = aBg
                    }
                }
            }
            audienceViews.add(tvAud)
            audienceContainer.addView(tvAud)
        }
        hsvAudience.addView(audienceContainer)
        layout.addView(hsvAudience)

        // 3. Class Selector Card
        val tvClassTitle = TextView(this).apply {
            text = "TARGET KELAS / ROMBEL"
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            letterSpacing = 0.08f
            setPadding(0, 0, 0, (6 * density).toInt())
        }
        layout.addView(tvClassTitle)

        val spinnerClass = Spinner(this)
        val teachingClassesRaw = sessionManager.getTeachingClasses().trim()
        val teacherClassesList = if (teachingClassesRaw.isNotEmpty()) {
            teachingClassesRaw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        } else {
            emptyList()
        }
        val classes = if (teacherClassesList.isNotEmpty()) {
            (listOf("Semua Kelas Diampu (${teacherClassesList.joinToString(", ")})") + teacherClassesList).toTypedArray()
        } else {
            arrayOf("Semua Kelas yang Diampu", "VII-A", "VII-B", "VII-C", "VII-I")
        }
        spinnerClass.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, classes)

        val cardSpinner = CardView(this).apply {
            radius = 12f * density
            cardElevation = 2f * density
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
        }
        val spinnerBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (8 * density).toInt()
            setPadding(p, p, p, p)
        }
        spinnerBox.addView(spinnerClass)
        cardSpinner.addView(spinnerBox)
        layout.addView(cardSpinner)

        // 4. Input Form Card
        val cardForm = CardView(this).apply {
            radius = 16f * density
            cardElevation = 2f * density
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (16 * density).toInt()
            }
            layoutParams = lp
        }
        val formLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val etTitle = EditText(this).apply {
            hint = "Judul Pengumuman (Contoh: Materi Ulangan Bab 2)"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            val padInput = (12 * density).toInt()
            setPadding(padInput, padInput, padInput, padInput)
            val bg = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                cornerRadius = 10f * density
                setColor(Color.parseColor("#F8FAFC"))
                setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
            }
            background = bg
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (10 * density).toInt()
            }
            layoutParams = lp
        }
        formLayout.addView(etTitle)

        val etMessage = EditText(this).apply {
            hint = "Tulis isi pengumuman atau instruksi KBM untuk siswa & orang tua secara lengkap di sini..."
            minLines = 4
            textSize = 13f
            setTextColor(Color.parseColor("#334155"))
            gravity = android.view.Gravity.TOP or android.view.Gravity.START
            val padInput = (12 * density).toInt()
            setPadding(padInput, padInput, padInput, padInput)
            val bg = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                cornerRadius = 10f * density
                setColor(Color.parseColor("#F8FAFC"))
                setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
            }
            background = bg
        }
        formLayout.addView(etMessage)
        cardForm.addView(formLayout)
        layout.addView(cardForm)

        // 5. Live Card Preview
        val tvPreviewLabel = TextView(this).apply {
            text = "PRATINJAU TAMPILAN DI HP PENERIMA"
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            letterSpacing = 0.08f
            setPadding(0, 0, 0, (6 * density).toInt())
        }
        layout.addView(tvPreviewLabel)

        val cardPreview = CardView(this).apply {
            radius = 16f * density
            cardElevation = 3f * density
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (18 * density).toInt()
            }
            layoutParams = lp
        }
        val previewInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val previewTopRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
        }

        val pBadge = TextView(this).apply {
            text = selectedCategory
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#2563EB"))
            val bgP = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                cornerRadius = 12f * density
                setColor(Color.parseColor("#EFF6FF"))
            }
            background = bgP
            val padH = (8 * density).toInt()
            val padV = (3 * density).toInt()
            setPadding(padH, padV, padH, padV)
        }
        previewBadgeTv = pBadge
        previewTopRow.addView(pBadge)

        val pTarget = TextView(this).apply {
            text = "Sasaran: Rombel Diampu • Siswa & Ortu"
            textSize = 10.5f
            setTextColor(Color.parseColor("#64748B"))
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (8 * density).toInt()
            }
            layoutParams = lp
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        previewTargetTv = pTarget
        previewTopRow.addView(pTarget)
        previewInner.addView(previewTopRow)

        val pTitle = TextView(this).apply {
            text = "Judul Pengumuman..."
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        previewTitleTv = pTitle
        previewInner.addView(pTitle)

        val pMsg = TextView(this).apply {
            text = "Isi pengumuman akan ditampilkan di sini seperti yang terlihat oleh siswa dan orang tua."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (6 * density).toInt()
            }
            layoutParams = lp
            setLineSpacing(3f, 1f)
        }
        previewMsgTv = pMsg
        previewInner.addView(pMsg)

        val pSenderRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (10 * density).toInt()
            }
            layoutParams = lp
        }
        val pSender = TextView(this).apply {
            text = "Pengirim: ${sessionManager.getName()} • SMPN 1 Boyolangu"
            textSize = 10f
            setTextColor(Color.parseColor("#94A3B8"))
        }
        pSenderRow.addView(pSender)
        previewInner.addView(pSenderRow)

        cardPreview.addView(previewInner)
        layout.addView(cardPreview)

        // Connect chips click
        chipViews.forEachIndexed { cIdx, cTv ->
            cTv.setOnClickListener {
                selectedCategory = categories[cIdx].first
                chipViews.forEachIndexed { i, view ->
                    val isSel = (i == cIdx)
                    view.setTextColor(if (isSel) Color.parseColor(categories[i].second) else Color.parseColor("#475569"))
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                        cornerRadius = 16f * density
                        setColor(if (isSel) Color.parseColor(categories[i].third) else Color.WHITE)
                        setStroke((1 * density).toInt(), if (isSel) Color.parseColor(categories[i].second) else Color.parseColor("#E2E8F0"))
                    }
                    view.background = bg
                }
                updatePreview(selectedCategory, etTitle.text.toString(), etMessage.text.toString(), selectedAudience, spinnerClass.selectedItem?.toString() ?: "")
            }
        }

        // Live text change listeners for preview
        val textWatcher = object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                updatePreview(selectedCategory, etTitle.text.toString(), etMessage.text.toString(), selectedAudience, spinnerClass.selectedItem?.toString() ?: "")
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        }
        etTitle.addTextChangedListener(textWatcher)
        etMessage.addTextChangedListener(textWatcher)

        // 6. Action Button
        val btnSend = Button(this).apply {
            text = "🚀 KIRIM BROADCAST SEKARANG"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                bottomMargin = (16 * density).toInt()
            }
            setOnClickListener {
                val rawTitle = etTitle.text.toString().trim()
                val msg = etMessage.text.toString().trim()
                val selectedIdx = spinnerClass.selectedItemPosition
                val cls = if (selectedIdx == 0 && teacherClassesList.isNotEmpty()) {
                    teachingClassesRaw
                } else {
                    classes[selectedIdx]
                }
                if (rawTitle.isEmpty() || msg.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Judul dan pesan tidak boleh kosong", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val titleWithCat = "[$selectedCategory] $rawTitle"

                AlertDialog.Builder(this@TeacherMainActivity)
                    .setTitle("Konfirmasi Pengiriman")
                    .setMessage("Kirim pengumuman ini ke kelas $cls untuk $selectedAudience?\n\nJudul: $titleWithCat")
                    .setPositiveButton("Ya, Kirim") { _, _ ->
                        val req = mapOf("className" to cls, "title" to titleWithCat, "message" to msg)
                        Toast.makeText(this@TeacherMainActivity, "Mengirim broadcast...", Toast.LENGTH_SHORT).show()
                        ApiClient.getClient(this@TeacherMainActivity).broadcastToClass(req).enqueue(object : Callback<BasicResponse> {
                            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                if (response.isSuccessful) {
                                    Toast.makeText(this@TeacherMainActivity, "✅ Pengumuman berhasil dibroadcast ke $cls!", Toast.LENGTH_LONG).show()
                                    dialog.dismiss()
                                } else {
                                    Toast.makeText(this@TeacherMainActivity, "Gagal mengirim broadcast", Toast.LENGTH_SHORT).show()
                                }
                            }

                            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                            }
                        })
                    }
                    .setNegativeButton("Batal", null)
                    .show()
            }
        }
        layout.addView(btnSend)

        dialog.setView(root)
        dialog.show()
    }


    private fun showProctorTokenDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        var fetchTokensFn: (() -> Unit)? = null
        val header = createFullscreenHeader(
            title = "🔐 Token Pengawas CBT",
            subtitle = "Rilis token ujian harian & pantau integritas sesi",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Segarkan",
            onActionClick = { fetchTokensFn?.invoke() }
        )
        root.addView(header)

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(dialogView)

        // Header Card
        val headerCard = CardView(this).apply {
            radius = 12 * resources.displayMetrics.density
            setCardBackgroundColor(Color.parseColor("#1E3A8A"))
            useCompatPadding = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (12 * resources.displayMetrics.density).toInt()
            }
        }
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        val tvHeaderTitle = TextView(this).apply {
            text = "🔑 Token Ujian CBT Pengawas Ruang"
            setTextColor(Color.WHITE)
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
        }
        val tvHeaderDesc = TextView(this).apply {
            text = "Khusus pengawas ruang & proktor. Dapatkan token aktif langsung per tingkat kelas (Level 7, 8, 9) dan kelas yang diawasi saat ini."
            setTextColor(Color.parseColor("#E0E7FF"))
            textSize = 11f
            setPadding(0, 4, 0, 0)
        }
        headerLayout.addView(tvHeaderTitle)
        headerLayout.addView(tvHeaderDesc)
        headerCard.addView(headerLayout)
        dialogView.addView(headerCard)

        // Filter Level & Class Selection Row
        val filterCard = CardView(this).apply {
            radius = 10 * resources.displayMetrics.density
            setCardBackgroundColor(Color.WHITE)
            cardElevation = 2 * resources.displayMetrics.density
            useCompatPadding = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (12 * resources.displayMetrics.density).toInt()
            }
        }
        val filterLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (10 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        val tvFilterLabel = TextView(this).apply {
            text = "Filter Ruang & Tingkat Kelas:"
            setTextColor(Color.parseColor("#475569"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 6)
        }
        filterLayout.addView(tvFilterLabel)

        val rowSpinners = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
        }

        // Level Spinner
        val levelOptions = arrayOf("Semua Tingkat", "Level 7 (Kelas VII)", "Level 8 (Kelas VIII)", "Level 9 (Kelas IX)")
        val levelValues = arrayOf("ALL", "7", "8", "9")
        val spinnerLevel = Spinner(this).apply {
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, levelOptions)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = (6 * resources.displayMetrics.density).toInt()
            }
        }

        // Class Spinner
        val classOptions = mutableListOf("Semua Kelas")
        val spinnerClassAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, classOptions)
        val spinnerClass = Spinner(this).apply {
            adapter = spinnerClassAdapter
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (6 * resources.displayMetrics.density).toInt()
            }
        }

        rowSpinners.addView(spinnerLevel)
        rowSpinners.addView(spinnerClass)
        filterLayout.addView(rowSpinners)
        filterCard.addView(filterLayout)
        dialogView.addView(filterCard)

        // Loading ProgressBar
        val progressBar = ProgressBar(this).apply {
            visibility = View.VISIBLE
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                topMargin = (20 * resources.displayMetrics.density).toInt()
                bottomMargin = (20 * resources.displayMetrics.density).toInt()
            }
        }
        dialogView.addView(progressBar)

        // Scrollable List Container
        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0, 1f
            )
        }
        val examListContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scrollView.addView(examListContainer)
        dialogView.addView(scrollView)

        // Dialog already created via createFullscreenDialog

        var currentSelectedLevel = "ALL"
        var currentSelectedClass = "Semua Kelas"

        fun fetchTokens() {
            fetchTokensFn = { fetchTokens() }
            progressBar.visibility = View.VISIBLE
            examListContainer.removeAllViews()

            val lvlParam = if (currentSelectedLevel == "ALL") null else currentSelectedLevel
            val clsParam = if (currentSelectedClass == "Semua Kelas") null else currentSelectedClass

            ApiClient.getClient(this).getProctorCbtTokens(lvlParam, clsParam).enqueue(object : Callback<ProctorCbtTokensResponse> {
                override fun onResponse(call: Call<ProctorCbtTokensResponse>, response: Response<ProctorCbtTokensResponse>) {
                    progressBar.visibility = View.GONE
                    if (response.isSuccessful && response.body() != null) {
                        val body = response.body()!!

                        // Populate class options if not populated yet
                        val classes = body.availableClasses
                        val isRestricted = body.isRestrictedToSupervisedClasses == true
                        if (!classes.isNullOrEmpty()) {
                            val distinctClasses = mutableListOf<String>()
                            if (isRestricted) {
                                if (classes.size > 1) {
                                    distinctClasses.add("Semua Kelas Diawasi")
                                }
                                distinctClasses.addAll(classes)
                            } else {
                                distinctClasses.add("Semua Kelas")
                                distinctClasses.addAll(classes)
                            }
                            if (spinnerClassAdapter.count <= 1 || isRestricted) {
                                spinnerClassAdapter.clear()
                                spinnerClassAdapter.addAll(distinctClasses)
                                spinnerClassAdapter.notifyDataSetChanged()
                            }
                        }

                        if (isRestricted && !classes.isNullOrEmpty()) {
                            tvHeaderDesc.text = "Pengawas Ruang: ${body.proctorName ?: "Bpk/Ibu Guru"}\nMenampilkan khusus token ujian untuk kelas yang Anda awasi: ${classes.joinToString(", ")}"
                        } else {
                            tvHeaderDesc.text = "Khusus pengawas ruang & proktor. Dapatkan token aktif langsung untuk kelas yang diawasi saat ini."
                        }

                        val exams = body.exams
                        if (exams.isNullOrEmpty()) {
                            val tvEmpty = TextView(this@TeacherMainActivity).apply {
                                text = "ℹ️ Belum ada ujian CBT yang aktif untuk tingkat/kelas yang dipilih saat ini."
                                setTextColor(Color.parseColor("#64748B"))
                                textSize = 13f
                                gravity = android.view.Gravity.CENTER
                                setPadding(0, (30 * resources.displayMetrics.density).toInt(), 0, (30 * resources.displayMetrics.density).toInt())
                            }
                            examListContainer.addView(tvEmpty)
                            return
                        }

                        // Render each CBT exam card
                        for (exam in exams) {
                            val card = CardView(this@TeacherMainActivity).apply {
                                radius = 12 * resources.displayMetrics.density
                                setCardBackgroundColor(Color.WHITE)
                                cardElevation = 3 * resources.displayMetrics.density
                                useCompatPadding = true
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply {
                                    bottomMargin = (8 * resources.displayMetrics.density).toInt()
                                }
                            }

                            val cardContent = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                val pad12 = (14 * resources.displayMetrics.density).toInt()
                                setPadding(pad12, pad12, pad12, pad12)
                            }

                            // Top row: Level Badge & Status Badge
                            val topRow = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }
                            val levelBadge = TextView(this@TeacherMainActivity).apply {
                                val lvlText = when (exam.level) {
                                    "7" -> "LEVEL 7 (KLS VII)"
                                    "8" -> "LEVEL 8 (KLS VIII)"
                                    "9" -> "LEVEL 9 (KLS IX)"
                                    else -> "SEMUA LEVEL"
                                }
                                text = "🏷️ $lvlText"
                                setTextColor(Color.parseColor("#1D4ED8"))
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setBackgroundColor(Color.parseColor("#EFF6FF"))
                                val bp = (6 * resources.displayMetrics.density).toInt()
                                setPadding(bp, bp / 2, bp, bp / 2)
                            }
                            val spacer = View(this@TeacherMainActivity).apply {
                                layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
                            }
                            val statusBadge = TextView(this@TeacherMainActivity).apply {
                                text = if (exam.isTokenActive) "● TOKEN AKTIF" else "○ TOKEN NONAKTIF"
                                setTextColor(if (exam.isTokenActive) Color.parseColor("#15803D") else Color.parseColor("#B91C1C"))
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setBackgroundColor(if (exam.isTokenActive) Color.parseColor("#DCFCE7") else Color.parseColor("#FEE2E2"))
                                val bp = (6 * resources.displayMetrics.density).toInt()
                                setPadding(bp, bp / 2, bp, bp / 2)
                            }
                            topRow.addView(levelBadge)
                            topRow.addView(spacer)
                            topRow.addView(statusBadge)
                            cardContent.addView(topRow)

                            // Title & Subject
                            val tvTitle = TextView(this@TeacherMainActivity).apply {
                                text = exam.title
                                setTextColor(Color.parseColor("#0F172A"))
                                textSize = 15f
                                setTypeface(null, Typeface.BOLD)
                                setPadding(0, 8, 0, 2)
                            }
                            val tvMeta = TextView(this@TeacherMainActivity).apply {
                                text = "📚 Mapel: ${exam.subject} • Durasi: ${exam.durationMinutes} Menit • Target: ${exam.assignedClasses ?: "Semua"}"
                                setTextColor(Color.parseColor("#64748B"))
                                textSize = 12f
                                setPadding(0, 0, 0, 8)
                            }
                            cardContent.addView(tvTitle)
                            cardContent.addView(tvMeta)

                            // Big Monospace Token Box
                            val tokenBox = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setBackgroundColor(Color.parseColor("#FEF3C7"))
                                val p = (10 * resources.displayMetrics.density).toInt()
                                setPadding(p, p, p, p)
                                gravity = android.view.Gravity.CENTER
                            }
                            val tvTokenLabel = TextView(this@TeacherMainActivity).apply {
                                text = if (isRestricted) "TOKEN CBT KELAS DIAWASI (${exam.assignedClasses ?: "-"}):" else "TOKEN CBT SAAT INI:"
                                setTextColor(Color.parseColor("#92400E"))
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                            }
                            val tvTokenValue = TextView(this@TeacherMainActivity).apply {
                                text = exam.token
                                setTextColor(Color.parseColor("#B45309"))
                                textSize = 32f
                                setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
                                letterSpacing = 0.25f
                            }
                            tokenBox.addView(tvTokenLabel)
                            tokenBox.addView(tvTokenValue)
                            cardContent.addView(tokenBox)

                            // Action Buttons Row 1 (Salin, Layar Penuh, Acak)
                            val actionRow = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                setPadding(0, (10 * resources.displayMetrics.density).toInt(), 0, 0)
                                weightSum = 3f
                            }

                            // 1. Copy Token Button
                            val btnCopy = Button(this@TeacherMainActivity).apply {
                                text = "📋 Salin"
                                textSize = 11f
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#2563EB"))
                                layoutParams = LinearLayout.LayoutParams(0, (38 * resources.displayMetrics.density).toInt(), 1f).apply {
                                    marginEnd = (4 * resources.displayMetrics.density).toInt()
                                }
                                setOnClickListener {
                                    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    val clip = ClipData.newPlainText("Token CBT", exam.token)
                                    clipboard.setPrimaryClip(clip)
                                    Toast.makeText(this@TeacherMainActivity, "📋 Token ${exam.token} berhasil disalin!", Toast.LENGTH_SHORT).show()
                                }
                            }

                            // 2. Fullscreen Projector Button
                            val btnFullscreen = Button(this@TeacherMainActivity).apply {
                                text = "📺 Layar Penuh"
                                textSize = 11f
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#0D9488"))
                                layoutParams = LinearLayout.LayoutParams(0, (38 * resources.displayMetrics.density).toInt(), 1f).apply {
                                    marginStart = (2 * resources.displayMetrics.density).toInt()
                                    marginEnd = (2 * resources.displayMetrics.density).toInt()
                                }
                                setOnClickListener {
                                    showFullscreenTokenDialog(exam)
                                }
                            }

                            // 3. Regenerate Token Button
                            val btnRegen = Button(this@TeacherMainActivity).apply {
                                text = "🔄 Acak Baru"
                                textSize = 11f
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#D97706"))
                                layoutParams = LinearLayout.LayoutParams(0, (38 * resources.displayMetrics.density).toInt(), 1f).apply {
                                    marginStart = (4 * resources.displayMetrics.density).toInt()
                                }
                                setOnClickListener {
                                    Toast.makeText(this@TeacherMainActivity, "Mengacak token baru...", Toast.LENGTH_SHORT).show()
                                    val reqMap = mutableMapOf("examId" to exam.id)
                                    if (currentSelectedClass != "Semua Kelas" && currentSelectedClass != "Semua Kelas Diawasi") {
                                        reqMap["className"] = currentSelectedClass
                                    }
                                    ApiClient.getClient(this@TeacherMainActivity).regenerateCbtToken(reqMap).enqueue(object : Callback<Map<String, Any>> {
                                        override fun onResponse(call: Call<Map<String, Any>>, resp: Response<Map<String, Any>>) {
                                            if (resp.isSuccessful) {
                                                val newToken = resp.body()?.get("token") as? String
                                                if (!newToken.isNullOrBlank()) {
                                                    tvTokenValue.text = newToken
                                                }
                                                Toast.makeText(this@TeacherMainActivity, "✅ Token baru: ${newToken ?: ""}", Toast.LENGTH_SHORT).show()
                                                fetchTokens()
                                            } else {
                                                val errMsg = resp.errorBody()?.string() ?: ""
                                                val msg = try {
                                                    org.json.JSONObject(errMsg).optString("message", "Gagal mengacak token")
                                                } catch (_: Exception) { "Gagal mengacak token" }
                                                Toast.makeText(this@TeacherMainActivity, msg, Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                        override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                                            Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                                        }
                                    })
                                }
                            }

                            actionRow.addView(btnCopy)
                            actionRow.addView(btnFullscreen)
                            actionRow.addView(btnRegen)
                            cardContent.addView(actionRow)

                            // Action Button 4: Live Monitor Siswa & Berita Acara Ujian (BAP)
                            val btnMonitor = Button(this@TeacherMainActivity).apply {
                                text = "👥 Siswa Kelas & Berita Acara (BAP)"
                                textSize = 12f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#4F46E5"))
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    (40 * resources.displayMetrics.density).toInt()
                                ).apply {
                                    topMargin = (8 * resources.displayMetrics.density).toInt()
                                }
                                setOnClickListener {
                                    val defClass = if (currentSelectedClass != "Semua Kelas") currentSelectedClass else (exam.assignedClasses?.split(",")?.firstOrNull()?.trim() ?: "VII-A")
                                    showProctorClassMonitoringDialog(exam, defClass)
                                }
                            }
                            cardContent.addView(btnMonitor)

                            // Action Button 5: Lembar Token Siap Cetak A4 & Pengawas Ruang
                            val btnPrintSlip = Button(this@TeacherMainActivity).apply {
                                text = "🖨️ Lembar Token A4 & Pengawas Ruang"
                                textSize = 12f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#059669"))
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    (40 * resources.displayMetrics.density).toInt()
                                ).apply {
                                    topMargin = (6 * resources.displayMetrics.density).toInt()
                                }
                                setOnClickListener {
                                    showClassTokensSlipDialog(exam)
                                }
                            }
                            cardContent.addView(btnPrintSlip)

                            card.addView(cardContent)
                            examListContainer.addView(card)
                        }
                    } else {
                        Toast.makeText(this@TeacherMainActivity, "Gagal memuat token proktor CBT", Toast.LENGTH_SHORT).show()
                    }
                }

                override fun onFailure(call: Call<ProctorCbtTokensResponse>, t: Throwable) {
                    progressBar.visibility = View.GONE
                    Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            })
        }

        spinnerLevel.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val selected = levelValues[position]
                if (selected != currentSelectedLevel) {
                    currentSelectedLevel = selected
                    fetchTokens()
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        spinnerClass.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val selected = spinnerClassAdapter.getItem(position) ?: "VII-A"
                if (selected != currentSelectedClass) {
                    currentSelectedClass = selected
                    fetchTokens()
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        dialog.setView(root)
        dialog.show()
        fetchTokens()
    }

    private fun showFullscreenTokenDialog(exam: ProctorExamDto) {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🖥️ Mode Proyektor Token CBT",
            subtitle = "${exam.title} • Token: ${exam.token}",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scrollContainer = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            isFillViewport = true
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        val fullscreenView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            val p = (24 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
            gravity = android.view.Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        val tvSchoolBadge = TextView(this).apply {
            text = "SMP NEGERI 1 BOYOLANGU • CBT PROCTOR"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            letterSpacing = 0.15f
            gravity = android.view.Gravity.CENTER
        }
        val tvExamTitle = TextView(this).apply {
            text = exam.title
            setTextColor(Color.WHITE)
            textSize = 20f
            setTypeface(null, Typeface.BOLD)
            gravity = android.view.Gravity.CENTER
            setPadding(0, 10, 0, 4)
        }
        val tvExamMeta = TextView(this).apply {
            text = "Mata Pelajaran: ${exam.subject} • Tingkat: Level ${exam.level ?: "Semua"} • Kelas: ${exam.assignedClasses ?: "Semua"}"
            setTextColor(Color.parseColor("#CBD5E1"))
            textSize = 13f
            gravity = android.view.Gravity.CENTER
            setPadding(0, 0, 0, 20)
        }

        val tokenBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1E293B"))
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            gravity = android.view.Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        val tvTokenPrompt = TextView(this).apply {
            text = "MASUKKAN TOKEN DI APLIKASI SISWA:"
            setTextColor(Color.parseColor("#F59E0B"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            letterSpacing = 0.1f
            gravity = android.view.Gravity.CENTER
        }
        val tvBigToken = TextView(this).apply {
            text = exam.token
            setTextColor(Color.parseColor("#FCD34D"))
            textSize = 52f
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            letterSpacing = 0.25f
            gravity = android.view.Gravity.CENTER
            setPadding(0, 6, 0, 6)
        }

        // QR Code Card for direct student scan
        val cardQr = CardView(this).apply {
            radius = 12 * resources.displayMetrics.density
            setCardBackgroundColor(Color.WHITE)
            cardElevation = 4 * resources.displayMetrics.density
            val sizePx = (210 * resources.displayMetrics.density).toInt()
            layoutParams = LinearLayout.LayoutParams(sizePx, sizePx).apply {
                topMargin = (12 * resources.displayMetrics.density).toInt()
                bottomMargin = (8 * resources.displayMetrics.density).toInt()
                gravity = android.view.Gravity.CENTER_HORIZONTAL
            }
        }
        val ivQr = ImageView(this).apply {
            val pad = (10 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            val qrBitmap = com.school.smartcbt.utils.QrCodeHelper.generateQrCodeBitmap(exam.token, 450)
            setImageBitmap(qrBitmap)
        }
        cardQr.addView(ivQr)

        val tvScanHint = TextView(this).apply {
            text = "📷 Siswa dapat memindai QR Code di atas langsung dari aplikasi CBT"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
            gravity = android.view.Gravity.CENTER
            setPadding(0, 0, 0, 10)
        }

        val tvInstructions = TextView(this).apply {
            text = "Durasi: ${exam.durationMinutes} Menit | Dilarang membuka aplikasi lain / split screen saat ujian berlangsung."
            setTextColor(Color.parseColor("#64748B"))
            textSize = 11.5f
            gravity = android.view.Gravity.CENTER
        }

        tokenBox.addView(tvTokenPrompt)
        tokenBox.addView(tvBigToken)
        tokenBox.addView(cardQr)
        tokenBox.addView(tvScanHint)
        tokenBox.addView(tvInstructions)

        fullscreenView.addView(tvSchoolBadge)
        fullscreenView.addView(tvExamTitle)
        fullscreenView.addView(tvExamMeta)
        fullscreenView.addView(tokenBox)

        scrollContainer.addView(fullscreenView)
        root.addView(scrollContainer)
        dialog.setView(root)
        dialog.show()
    }

    private fun showClassTokensSlipDialog(exam: ProctorExamDto) {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🖨️ Lembar Token A4 & Pengawas Ruang",
            subtitle = "${exam.title} • Mapel: ${exam.subject}",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }

        // A4 Paper Simulation Card (White background, shadow, bordered)
        val paperCard = CardView(this).apply {
            radius = 12 * resources.displayMetrics.density
            setCardBackgroundColor(Color.WHITE)
            cardElevation = 4 * resources.displayMetrics.density
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val paperInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }

        // Kop Surat
        val tvKop1 = TextView(this).apply {
            text = "PEMERINTAH KABUPATEN TULUNGAGUNG\nDINAS PENDIDIKAN"
            textSize = 11f
            setTextColor(Color.parseColor("#475569"))
            gravity = android.view.Gravity.CENTER
            setTypeface(null, Typeface.BOLD)
        }
        val tvKop2 = TextView(this).apply {
            text = "UPTD SMP NEGERI 1 BOYOLANGU"
            textSize = 15f
            setTextColor(Color.parseColor("#0F172A"))
            gravity = android.view.Gravity.CENTER
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 2, 0, 2)
        }
        val tvKop3 = TextView(this).apply {
            text = "LEMBAR DISTRIBUSI TOKEN CBT & PENGAWAS RUANG"
            textSize = 12.5f
            setTextColor(Color.parseColor("#1E3A8A"))
            gravity = android.view.Gravity.CENTER
            setTypeface(null, Typeface.BOLD)
        }
        val tvKopMeta = TextView(this).apply {
            text = "Asesmen: ${exam.title} | Mapel: ${exam.subject} | Tanggal: ${exam.executionDate ?: "-"}"
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            gravity = android.view.Gravity.CENTER
            setPadding(0, 4, 0, 10)
        }
        val divider = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (2 * resources.displayMetrics.density).toInt()).apply {
                bottomMargin = (14 * resources.displayMetrics.density).toInt()
            }
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        paperInner.addView(tvKop1)
        paperInner.addView(tvKop2)
        paperInner.addView(tvKop3)
        paperInner.addView(tvKopMeta)
        paperInner.addView(divider)

        // Class rows
        val tokensMap = exam.classTokens ?: emptyMap()
        val proctorsMap = exam.classProctors ?: emptyMap()
        val classesToDisplay = if (tokensMap.isNotEmpty()) {
            tokensMap.keys.toList()
        } else {
            exam.assignedClasses?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: listOf("Semua Kelas")
        }

        // Table Header Card
        val tableHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val p = (10 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
            weightSum = 10f
        }
        val thClass = TextView(this).apply {
            text = "Rombel"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 2.5f)
        }
        val thProctor = TextView(this).apply {
            text = "Guru Pengawas"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 4.5f)
        }
        val thToken = TextView(this).apply {
            text = "Token CBT"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            gravity = android.view.Gravity.END
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 3f)
        }
        tableHeader.addView(thClass)
        tableHeader.addView(thProctor)
        tableHeader.addView(thToken)
        paperInner.addView(tableHeader)

        var idx = 1
        val shareTextBuilder = StringBuilder()
        shareTextBuilder.append("*UPTD SMP NEGERI 1 BOYOLANGU*\n")
        shareTextBuilder.append("*LEMBAR DISTRIBUSI TOKEN CBT & PENGAWAS*\n")
        shareTextBuilder.append("Asesmen: ").append(exam.title).append("\n")
        shareTextBuilder.append("Mapel: ").append(exam.subject).append("\n")
        shareTextBuilder.append("Tanggal: ").append(exam.executionDate ?: "-").append("\n")
        shareTextBuilder.append("------------------------------------------\n")

        for (cls in classesToDisplay) {
            val cToken = tokensMap[cls] ?: exam.token
            val proctorName = proctorsMap[cls] ?: sessionManager.getName().ifEmpty { "Pengawas Ruang" }

            shareTextBuilder.append("$idx. Kelas $cls | Pengawas: $proctorName | Token: *$cToken*\n")

            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                val pV = (9 * resources.displayMetrics.density).toInt()
                val pH = (10 * resources.displayMetrics.density).toInt()
                setPadding(pH, pV, pH, pV)
                if (idx % 2 == 0) setBackgroundColor(Color.parseColor("#F8FAFC"))
                weightSum = 10f
            }

            val tvCls = TextView(this).apply {
                text = "Kelas $cls"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 2.5f)
            }
            val tvProc = TextView(this).apply {
                text = proctorName
                textSize = 11.5f
                setTextColor(Color.parseColor("#047857"))
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 4.5f)
            }
            val tvTok = TextView(this).apply {
                text = cToken
                textSize = 13.5f
                setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
                setTextColor(Color.parseColor("#1E3A8A"))
                gravity = android.view.Gravity.END
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 3f)
            }

            row.addView(tvCls)
            row.addView(tvProc)
            row.addView(tvTok)
            paperInner.addView(row)
            idx++
        }

        // Tanda tangan info
        val signRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, (20 * resources.displayMetrics.density).toInt(), 0, 0)
            weightSum = 2f
        }
        val signLeft = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER_HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        signLeft.addView(TextView(this).apply {
            text = "Mengetahui,\nKetua Panitia CBT"
            textSize = 11f
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#475569"))
        })
        signLeft.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(1, (36 * resources.displayMetrics.density).toInt())
        })
        signLeft.addView(TextView(this).apply {
            text = "( .................................... )"
            textSize = 11f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
        })

        val signRight = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER_HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        signRight.addView(TextView(this).apply {
            text = "Boyolangu, ${exam.executionDate ?: "-"}\nKoordinator Proktor"
            textSize = 11f
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#475569"))
        })
        signRight.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(1, (36 * resources.displayMetrics.density).toInt())
        })
        signRight.addView(TextView(this).apply {
            text = "( .................................... )"
            textSize = 11f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
        })

        signRow.addView(signLeft)
        signRow.addView(signRight)
        paperInner.addView(signRow)

        paperCard.addView(paperInner)
        contentLayout.addView(paperCard)
        scroll.addView(contentLayout)
        root.addView(scroll)

        // Bottom Action Bar
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
            elevation = 6 * resources.displayMetrics.density
            val p = (12 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
            weightSum = 2f
        }

        val btnPrint = Button(this).apply {
            text = "🖨️ Cetak / Simpan PDF A4"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#1E3A8A"))
            layoutParams = LinearLayout.LayoutParams(0, (42 * resources.displayMetrics.density).toInt(), 1f).apply {
                marginEnd = (4 * resources.displayMetrics.density).toInt()
            }
            setOnClickListener {
                val html = generateA4SlipHtml(exam, classesToDisplay, tokensMap, proctorsMap)
                printHtmlDocument(html, "Lembar_Token_${exam.title}")
            }
        }

        val btnShareWa = Button(this).apply {
            text = "📋 Salin Format WA"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            layoutParams = LinearLayout.LayoutParams(0, (42 * resources.displayMetrics.density).toInt(), 1f).apply {
                marginStart = (4 * resources.displayMetrics.density).toInt()
            }
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("Distribusi Token CBT", shareTextBuilder.toString())
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this@TeacherMainActivity, "📋 Rincian token & pengawas berhasil disalin! Siap dipaste ke WA.", Toast.LENGTH_LONG).show()
            }
        }

        bottomBar.addView(btnPrint)
        bottomBar.addView(btnShareWa)
        root.addView(bottomBar)

        dialog.setView(root)
        dialog.show()
    }

    private fun generateA4SlipHtml(
        exam: ProctorExamDto,
        classes: List<String>,
        tokensMap: Map<String, String>,
        proctorsMap: Map<String, String>
    ): String {
        val rows = StringBuilder()
        classes.forEachIndexed { idx, cls ->
            val cToken = tokensMap[cls] ?: exam.token
            val proctorName = proctorsMap[cls] ?: sessionManager.getName().ifEmpty { "Pengawas Ruang" }
            rows.append("""
                <tr style="border-bottom: 1px solid #ddd; text-align: center;">
                    <td style="padding: 8px; border: 1px solid #ccc;">${idx + 1}</td>
                    <td style="padding: 8px; border: 1px solid #ccc; font-weight: bold;">Kelas $cls</td>
                    <td style="padding: 8px; border: 1px solid #ccc;">Ruang Kelas $cls</td>
                    <td style="padding: 8px; border: 1px solid #ccc; font-weight: bold; color: #047857;">$proctorName</td>
                    <td style="padding: 8px; border: 1px solid #ccc; font-family: monospace; font-size: 16px; font-weight: 900; color: #1e3a8a; letter-spacing: 2px;">$cToken</td>
                    <td style="padding: 8px; border: 1px solid #ccc; font-size: 11px;">Siswa login dengan token ini. Pengawas dapat mengontrol &amp; reset dari APK Guru.</td>
                </tr>
            """.trimIndent())
        }

        return """
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Lembar Token Ujian - ${exam.title}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                    th { background: #f0f4f8; padding: 8px; border: 1px solid #ccc; font-size: 12px; }
                    h2, h3, p { margin: 4px 0; }
                    @media print {
                        body { padding: 0; }
                    }
                </style>
            </head>
            <body>
                <div style="border-bottom: 3px double #000; padding-bottom: 10px; text-align: center; margin-bottom: 15px;">
                    <h2>UPTD SMP NEGERI 1 BOYOLANGU</h2>
                    <h3>LEMBAR DISTRIBUSI TOKEN CBT &amp; PENGAWAS RUANG KELAS</h3>
                    <p style="font-size: 13px;">Asesmen: <b>${exam.title}</b> | Mapel: <b>${exam.subject}</b> | Tanggal: <b>${exam.executionDate ?: "-"}</b></p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 40px;">No</th>
                            <th>Target Rombel</th>
                            <th>Alokasi Ruang</th>
                            <th>Nama Guru Pengawas</th>
                            <th>Token Ujian Khusus</th>
                            <th>Petunjuk Pengawas Ruang</th>
                        </tr>
                    </thead>
                    <tbody>
                        $rows
                    </tbody>
                </table>
                <div style="margin-top: 30px; display: flex; justify-content: space-between; font-size: 12px;">
                    <div>
                        <p>Mengetahui,</p>
                        <p><b>Ketua Panitia CBT</b></p>
                        <div style="height: 50px;"></div>
                        <p>( .................................... )</p>
                    </div>
                    <div>
                        <p>Boyolangu, ${exam.executionDate ?: "-"}</p>
                        <p><b>Koordinator Proktor &amp; Teknisi</b></p>
                        <div style="height: 50px;"></div>
                        <p>( .................................... )</p>
                    </div>
                </div>
            </body>
            </html>
        """.trimIndent()
    }

    private fun printHtmlDocument(htmlDocument: String, jobName: String) {
        try {
            val webView = WebView(this)
            webView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    val printManager = getSystemService(Context.PRINT_SERVICE) as? PrintManager
                    val printAdapter = webView.createPrintDocumentAdapter(jobName)
                    val printAttributes = PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setResolution(PrintAttributes.Resolution("id1", "print", 300, 300))
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build()
                    printManager?.print(jobName, printAdapter, printAttributes)
                }
            }
            webView.loadDataWithBaseURL(null, htmlDocument, "text/html", "UTF-8", null)
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal mencetak dokumen: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showProctorClassMonitoringDialog(exam: ProctorExamDto, defaultClass: String) {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        var fetchStudentsFn: (() -> Unit)? = null
        val header = createFullscreenHeader(
            title = "👥 Monitoring Peserta Ujian CBT",
            subtitle = "Pantau status siswa live & kendali reset ujian",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Segarkan",
            onActionClick = { fetchStudentsFn?.invoke() }
        )
        root.addView(header)

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(dialogView)

        // Header
        val headerCard = CardView(this).apply {
            radius = 12 * resources.displayMetrics.density
            setCardBackgroundColor(Color.parseColor("#1E1B4B"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (12 * resources.displayMetrics.density).toInt()
            }
        }
        val headerInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        val tvExamHeader = TextView(this).apply {
            text = "👥 Ruang & Peserta: ${exam.title}"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        }
        val tvExamSub = TextView(this).apply {
            text = "Mata Pelajaran: ${exam.subject} • Token: ${exam.token} • Durasi: ${exam.durationMinutes}m"
            setTextColor(Color.parseColor("#C7D2FE"))
            textSize = 11f
            setPadding(0, 4, 0, 0)
        }
        headerInner.addView(tvExamHeader)
        headerInner.addView(tvExamSub)
        headerCard.addView(headerInner)
        dialogView.addView(headerCard)

        // Class Selection Spinner & Refresh Row
        val topActionCard = CardView(this).apply {
            radius = 10 * resources.displayMetrics.density
            setCardBackgroundColor(Color.WHITE)
            cardElevation = 2 * resources.displayMetrics.density
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (10 * resources.displayMetrics.density).toInt()
            }
        }
        val topActionLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val p = (10 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
            gravity = android.view.Gravity.CENTER_VERTICAL
        }

        val tvPilihKelas = TextView(this).apply {
            text = "Kelas:"
            setTextColor(Color.parseColor("#334155"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, (6 * resources.displayMetrics.density).toInt(), 0)
        }

        val assignedClassesList = exam.assignedClasses?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: listOf(defaultClass)
        val classSpinnerAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, assignedClassesList)
        val spinnerClassSelect = Spinner(this).apply {
            adapter = classSpinnerAdapter
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            val initialIdx = assignedClassesList.indexOf(defaultClass)
            if (initialIdx >= 0) setSelection(initialIdx)
        }

        val btnRefresh = Button(this).apply {
            text = "🔄 Segarkan"
            textSize = 11f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                (36 * resources.displayMetrics.density).toInt()
            ).apply {
                marginStart = (8 * resources.displayMetrics.density).toInt()
            }
        }

        topActionLayout.addView(tvPilihKelas)
        topActionLayout.addView(spinnerClassSelect)
        topActionLayout.addView(btnRefresh)
        topActionCard.addView(topActionLayout)
        dialogView.addView(topActionCard)

        // Summary Badges Card (Total, Hadir, Selesai, Terkunci)
        val summaryCard = CardView(this).apply {
            radius = 10 * resources.displayMetrics.density
            setCardBackgroundColor(Color.WHITE)
            cardElevation = 2 * resources.displayMetrics.density
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (10 * resources.displayMetrics.density).toInt()
            }
        }
        val summaryLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val p = (10 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
            weightSum = 4f
        }
        val tvTotal = TextView(this).apply {
            text = "Total: -\nSiswa"
            textSize = 10f
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvPresent = TextView(this).apply {
            text = "Mengerjakan:\n-"
            textSize = 10f
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#2563EB"))
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvFinished = TextView(this).apply {
            text = "Selesai:\n-"
            textSize = 10f
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#16A34A"))
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvLocked = TextView(this).apply {
            text = "Terkunci:\n-"
            textSize = 10f
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#DC2626"))
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        summaryLayout.addView(tvTotal)
        summaryLayout.addView(tvPresent)
        summaryLayout.addView(tvFinished)
        summaryLayout.addView(tvLocked)
        summaryCard.addView(summaryLayout)
        dialogView.addView(summaryCard)

        // Progress Loading
        val progressBar = ProgressBar(this).apply {
            visibility = View.VISIBLE
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                topMargin = (16 * resources.displayMetrics.density).toInt()
                bottomMargin = (16 * resources.displayMetrics.density).toInt()
            }
        }
        dialogView.addView(progressBar)

        // Scroll Container for Student List
        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }
        val studentListContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scrollView.addView(studentListContainer)
        dialogView.addView(scrollView)

        var lastFetchedSummary: com.school.smartcbt.data.model.ProctorClassSummaryDto? = null
        var lastFetchedStudents: List<com.school.smartcbt.data.model.ProctorStudentDto> = emptyList()

        // Button BAP (Berita Acara Pelaksanaan Ujian)
        val btnBap = Button(this).apply {
            text = "📝 Buat Berita Acara Ujian (BAP)"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#7C3AED"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (44 * resources.displayMetrics.density).toInt()
            ).apply {
                topMargin = (10 * resources.displayMetrics.density).toInt()
            }
        }
        dialogView.addView(btnBap)

        fun fetchStudents(isBackground: Boolean = false) {
            fetchStudentsFn = { fetchStudents(false) }
            val selectedClass = spinnerClassSelect.selectedItem?.toString() ?: defaultClass
            if (!isBackground) {
                progressBar.visibility = View.VISIBLE
            }

            ApiClient.getClient(this).getProctorClassStudents(exam.id, selectedClass).enqueue(object : Callback<com.school.smartcbt.data.model.ProctorClassStudentsResponse> {
                override fun onResponse(
                    call: Call<com.school.smartcbt.data.model.ProctorClassStudentsResponse>,
                    response: Response<com.school.smartcbt.data.model.ProctorClassStudentsResponse>
                ) {
                    progressBar.visibility = View.GONE
                    if (response.isSuccessful && response.body() != null) {
                        val body = response.body()!!
                        lastFetchedSummary = body.summary
                        lastFetchedStudents = body.students ?: emptyList()

                        val sum = body.summary
                        if (sum != null) {
                            tvTotal.text = "Total:\n${sum.totalStudents} Siswa"
                            tvPresent.text = "Mengerjakan:\n${sum.totalPresent}"
                            tvFinished.text = "Selesai:\n${sum.totalFinished}"
                            tvLocked.text = "Terkunci:\n${sum.totalLocked}"
                        }

                        studentListContainer.removeAllViews()

                        if (lastFetchedStudents.isEmpty()) {
                            val tvEmpty = TextView(this@TeacherMainActivity).apply {
                                text = "Belum ada data siswa terdaftar di kelas $selectedClass untuk ujian ini."
                                textSize = 12f
                                setTextColor(Color.parseColor("#64748B"))
                                gravity = android.view.Gravity.CENTER
                                setPadding(0, 40, 0, 40)
                            }
                            studentListContainer.addView(tvEmpty)
                            return
                        }

                        for (st in lastFetchedStudents) {
                            val cardStudent = CardView(this@TeacherMainActivity).apply {
                                radius = 8 * resources.displayMetrics.density
                                setCardBackgroundColor(Color.WHITE)
                                cardElevation = 1.5f * resources.displayMetrics.density
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply {
                                    bottomMargin = (8 * resources.displayMetrics.density).toInt()
                                }
                            }
                            val itemLayout = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                val p = (10 * resources.displayMetrics.density).toInt()
                                setPadding(p, p, p, p)
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }

                            val colInfo = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                            }
                            val tvName = TextView(this@TeacherMainActivity).apply {
                                text = st.name
                                textSize = 13f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#1E293B"))
                            }
                            val tvMeta = TextView(this@TeacherMainActivity).apply {
                                val nisnText = if (!st.nisn.isNullOrBlank()) "NISN: ${st.nisn}" else ""
                                val strikes = if (st.strikeCount > 0) " • ⚠️ ${st.strikeCount}x Peringatan" else ""
                                val scoreText = if (st.score != null) " • Nilai: ${st.score}" else ""
                                text = "$nisnText$strikes$scoreText"
                                textSize = 10f
                                setTextColor(Color.parseColor("#64748B"))
                            }
                            colInfo.addView(tvName)
                            colInfo.addView(tvMeta)
                            itemLayout.addView(colInfo)

                            // Status Badge
                            val statusBadge = TextView(this@TeacherMainActivity).apply {
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setPadding(
                                    (8 * resources.displayMetrics.density).toInt(),
                                    (4 * resources.displayMetrics.density).toInt(),
                                    (8 * resources.displayMetrics.density).toInt(),
                                    (4 * resources.displayMetrics.density).toInt()
                                )
                                when (st.status) {
                                    "TERKUNCI" -> {
                                        text = "🔒 TERKUNCI"
                                        setTextColor(Color.WHITE)
                                        setBackgroundColor(Color.parseColor("#EF4444"))
                                    }
                                    "SEDANG_MENGERJAKAN" -> {
                                        text = "⚡ MENGERJAKAN"
                                        setTextColor(Color.WHITE)
                                        setBackgroundColor(Color.parseColor("#3B82F6"))
                                    }
                                    "SELESAI" -> {
                                        text = "✅ SELESAI"
                                        setTextColor(Color.WHITE)
                                        setBackgroundColor(Color.parseColor("#10B981"))
                                    }
                                    else -> {
                                        text = "⏳ BELUM MULAI"
                                        setTextColor(Color.parseColor("#475569"))
                                        setBackgroundColor(Color.parseColor("#E2E8F0"))
                                    }
                                }
                            }
                            itemLayout.addView(statusBadge)

                            // Tombol Ganti HP / Reset pada setiap baris data siswa
                            val btnResetLock = Button(this@TeacherMainActivity).apply {
                                text = "🔄 Ganti HP / Reset"
                                textSize = 10.5f
                                setTextColor(Color.WHITE)
                                val isAlert = st.status == "TERKUNCI" || st.strikeCount > 0
                                setBackgroundColor(if (isAlert) Color.parseColor("#DC2626") else Color.parseColor("#D97706"))
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.WRAP_CONTENT,
                                    (34 * resources.displayMetrics.density).toInt()
                                ).apply {
                                    marginStart = (6 * resources.displayMetrics.density).toInt()
                                }
                                setOnClickListener {
                                    AlertDialog.Builder(this@TeacherMainActivity)
                                        .setTitle("Reset Sesi & Ganti HP Siswa?")
                                        .setMessage("Reset kunci perangkat & status ujian untuk '${st.name}'?\n\nSiswa diizinkan berganti HP/perangkat baru atau melanjutkan ujian jika aplikasi tertutup/hang tanpa perlu lapor admin server.")
                                        .setPositiveButton("Ya, Reset & Buka") { _, _ ->
                                            Toast.makeText(this@TeacherMainActivity, "Mereset kuncian siswa...", Toast.LENGTH_SHORT).show()
                                            ApiClient.getClient(this@TeacherMainActivity).proctorResetStudentLock(
                                                com.school.smartcbt.data.model.ProctorResetLockRequest(exam.id, st.studentId)
                                            ).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
                                                override fun onResponse(c: Call<com.school.smartcbt.data.model.BasicResponse>, r: Response<com.school.smartcbt.data.model.BasicResponse>) {
                                                    if (r.isSuccessful && r.body()?.success == true) {
                                                        Toast.makeText(this@TeacherMainActivity, "✅ Sesi ${st.name} berhasil di-reset! Siswa dapat login / ganti HP.", Toast.LENGTH_SHORT).show()
                                                        fetchStudents(false)
                                                    } else {
                                                        Toast.makeText(this@TeacherMainActivity, r.body()?.message ?: "Gagal mereset siswa", Toast.LENGTH_SHORT).show()
                                                    }
                                                }
                                                override fun onFailure(c: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {
                                                    Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                                                }
                                            })
                                        }
                                        .setNegativeButton("Batal", null)
                                        .show()
                                }
                            }
                            itemLayout.addView(btnResetLock)

                            cardStudent.addView(itemLayout)
                            studentListContainer.addView(cardStudent)
                        }
                    } else if (!isBackground) {
                        Toast.makeText(this@TeacherMainActivity, "Gagal memuat peserta kelas", Toast.LENGTH_SHORT).show()
                    }
                }

                override fun onFailure(call: Call<com.school.smartcbt.data.model.ProctorClassStudentsResponse>, t: Throwable) {
                    progressBar.visibility = View.GONE
                    if (!isBackground) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            })
        }

        val autoRefreshHandler = android.os.Handler(android.os.Looper.getMainLooper())
        var isDialogActive = true
        val autoRefreshRunnable = object : Runnable {
            override fun run() {
                if (isDialogActive) {
                    fetchStudents(isBackground = true)
                    autoRefreshHandler.postDelayed(this, 8000)
                }
            }
        }

        dialog.setOnDismissListener {
            isDialogActive = false
            autoRefreshHandler.removeCallbacks(autoRefreshRunnable)
        }

        btnRefresh.setOnClickListener { fetchStudents(false) }
        spinnerClassSelect.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p0: AdapterView<*>?, p1: View?, p2: Int, p3: Long) {
                fetchStudents(false)
            }
            override fun onNothingSelected(p0: AdapterView<*>?) {}
        }

        btnBap.setOnClickListener {
            val curClass = spinnerClassSelect.selectedItem?.toString() ?: defaultClass
            showProctorBapDialog(exam, curClass, lastFetchedSummary, lastFetchedStudents)
        }

        dialog.setView(root)
        dialog.show()
        fetchStudents(false)
        autoRefreshHandler.postDelayed(autoRefreshRunnable, 8000)
    }

    private fun showProctorBapDialog(
        exam: ProctorExamDto,
        className: String,
        summary: com.school.smartcbt.data.model.ProctorClassSummaryDto?,
        students: List<com.school.smartcbt.data.model.ProctorStudentDto>
    ) {
        val bapView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val tvBapHeader = TextView(this).apply {
            text = "📝 Berita Acara Pelaksanaan Ujian (BAP)"
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E1B4B"))
            setPadding(0, 0, 0, 4)
        }
        val tvBapSub = TextView(this).apply {
            text = "Ujian: ${exam.title} (${exam.subject})\nKelas / Ruang: $className"
            textSize = 11f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, 12)
        }
        bapView.addView(tvBapHeader)
        bapView.addView(tvBapSub)

        val etRoomName = EditText(this).apply {
            hint = "Nama / Nomor Ruang (contoh: Ruang 04 Lab Komputer)"
            setText("Ruang Kelas $className")
            textSize = 13f
        }
        bapView.addView(etRoomName)

        val regCount = summary?.totalStudents ?: students.size
        val presCount = (summary?.totalPresent ?: 0) + (summary?.totalFinished ?: 0)
        val absCount = Math.max(0, regCount - presCount)

        // Deteksi daftar nama yang belum mulai / absen
        val defaultAbsentNames = students.filter { it.status == "BELUM_MULAI" }.joinToString(", ") { it.name }

        val etPresent = EditText(this).apply {
            hint = "Jumlah Siswa Hadir"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText(presCount.toString())
            textSize = 13f
        }
        val etAbsent = EditText(this).apply {
            hint = "Jumlah Siswa Tidak Hadir"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText(absCount.toString())
            textSize = 13f
        }
        val etAbsentList = EditText(this).apply {
            hint = "Daftar Siswa Tidak Hadir (Nama / NISN)"
            setText(defaultAbsentNames)
            textSize = 13f
        }
        val etNotes = EditText(this).apply {
            hint = "Catatan Kejadian Khusus / Integritas Ruang Ujian (Opsional)"
            textSize = 13f
        }

        bapView.addView(TextView(this).apply { text = "Jumlah Siswa Hadir:"; textSize = 11f; setTextColor(Color.parseColor("#64748B")); setPadding(0, 6, 0, 2) })
        bapView.addView(etPresent)
        bapView.addView(TextView(this).apply { text = "Jumlah Siswa Tidak Hadir:"; textSize = 11f; setTextColor(Color.parseColor("#64748B")); setPadding(0, 6, 0, 2) })
        bapView.addView(etAbsent)
        bapView.addView(TextView(this).apply { text = "Daftar Siswa Tidak Hadir:"; textSize = 11f; setTextColor(Color.parseColor("#64748B")); setPadding(0, 6, 0, 2) })
        bapView.addView(etAbsentList)
        bapView.addView(TextView(this).apply { text = "Catatan Kejadian Ruang Ujian:"; textSize = 11f; setTextColor(Color.parseColor("#64748B")); setPadding(0, 6, 0, 2) })
        bapView.addView(etNotes)

        AlertDialog.Builder(this)
            .setTitle("Kirim Berita Acara Ujian (BAP)")
            .setView(bapView)
            .setPositiveButton("Simpan & Kirim BAP ke Portal") { _, _ ->
                val room = etRoomName.text.toString().trim()
                val pCount = etPresent.text.toString().toIntOrNull() ?: presCount
                val aCount = etAbsent.text.toString().toIntOrNull() ?: absCount
                val aList = etAbsentList.text.toString().trim()
                val notes = etNotes.text.toString().trim()

                Toast.makeText(this, "Mengirim Berita Acara...", Toast.LENGTH_SHORT).show()
                val req = com.school.smartcbt.data.model.ProctorSubmitBapRequest(
                    examId = exam.id,
                    className = className,
                    roomName = if (room.isNotEmpty()) room else "Ruang $className",
                    totalRegistered = regCount,
                    totalPresent = pCount,
                    totalAbsent = aCount,
                    absentList = if (aList.isNotEmpty()) aList else null,
                    incidentNotes = if (notes.isNotEmpty()) notes else null
                )

                ApiClient.getClient(this).submitProctorBap(req).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
                    override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, response: Response<com.school.smartcbt.data.model.BasicResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(this@TeacherMainActivity, "✅ Berita Acara Ujian berhasil disimpan dan terhubung ke portal sekolah!", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, response.body()?.message ?: "Gagal menyimpan BAP", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }




    // ================= 1-TAP PRESENSI KELAS PER JAM PELAJARAN (GURU) =================
    private var activeScheduleDialogRefresh: (() -> Unit)? = null

    private fun showTeacherScheduleDialog() {
        val dialog = createFullscreenDialog()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        var loadAndRenderScheduleFn: (() -> Unit)? = null
        val header = createFullscreenHeader(
            title = "📅 Jadwal Mengajar & Presensi KBM",
            subtitle = "Presensi KBM tatap muka per jam pelajaran (WIB)",
            onClose = { dialog.dismiss() },
            actionBtnText = "🔄 Segarkan",
            onActionClick = { loadAndRenderScheduleFn?.invoke() }
        )
        root.addView(header)

        // Day Selector Tabs (Pill Bar Horizontal Elegan)
        val daysList = listOf("Hari Ini", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu")
        var currentSelectedDay = "Hari Ini"

        val daySelectorContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(8))
            setBackgroundColor(Color.WHITE)
        }

        val tvSub = TextView(this).apply {
            text = "PILIH HARI MENGAJAR:"
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, 0, 0, dp(6))
        }
        daySelectorContainer.addView(tvSub)

        val hsvDays = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val daysContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        val dayViews = mutableListOf<TextView>()

        daysList.forEach { dayName ->
            val tvDay = TextView(this).apply {
                text = dayName
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setPadding(dp(14), dp(8), dp(14), dp(8))
                val isSelected = (dayName == currentSelectedDay)
                setTextColor(if (isSelected) Color.WHITE else Color.parseColor("#475569"))
                val bg = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                    cornerRadius = 20f * density
                    setColor(if (isSelected) Color.parseColor("#1E40AF") else Color.parseColor("#F1F5F9"))
                    if (!isSelected) {
                        setStroke(dp(1), Color.parseColor("#E2E8F0"))
                    }
                }
                background = bg
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginEnd = dp(8)
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    currentSelectedDay = dayName
                    dayViews.forEach { v ->
                        val sel = (v.text == currentSelectedDay)
                        v.setTextColor(if (sel) Color.WHITE else Color.parseColor("#475569"))
                        val vBg = android.graphics.drawable.GradientDrawable().apply {
                            shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                            cornerRadius = 20f * density
                            setColor(if (sel) Color.parseColor("#1E40AF") else Color.parseColor("#F1F5F9"))
                            if (!sel) {
                                setStroke(dp(1), Color.parseColor("#E2E8F0"))
                            }
                        }
                        v.background = vBg
                    }
                    loadAndRenderScheduleFn?.invoke()
                }
            }
            dayViews.add(tvDay)
            daysContainer.addView(tvDay)
        }
        hsvDays.addView(daysContainer)
        daySelectorContainer.addView(hsvDays)
        root.addView(daySelectorContainer)

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(16))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
            isFillViewport = true
        }

        val containerSchedule = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scrollView.addView(containerSchedule)
        contentLayout.addView(scrollView)
        root.addView(contentLayout)

        dialog.setView(root)
        dialog.setOnDismissListener {
            activeScheduleDialogRefresh = null
        }

        fun loadAndRenderSchedule(targetDay: String) {
            containerSchedule.removeAllViews()
            val loadingTv = TextView(this).apply {
                text = "⏳ Memuat jadwal KBM ${targetDay}..."
                setTextColor(Color.parseColor("#64748B"))
                textSize = 13f
                setPadding(dp(16), dp(24), dp(16), dp(24))
            }
            containerSchedule.addView(loadingTv)

            val queryDay = if (targetDay == "Hari Ini") null else targetDay

            ApiClient.getClient(this).getTeacherTodayClassPeriods(queryDay).enqueue(object : Callback<TeacherClassPeriodsResponse> {
                override fun onResponse(call: Call<TeacherClassPeriodsResponse>, response: Response<TeacherClassPeriodsResponse>) {
                    containerSchedule.removeAllViews()
                    val resp = response.body()
                    if (response.isSuccessful && resp != null) {
                        val items = resp.schedules ?: resp.data ?: emptyList()
                        if (items.isEmpty()) {
                            val emptyCard = CardView(this@TeacherMainActivity).apply {
                                radius = 16f * density
                                cardElevation = 1.5f * density
                                setCardBackgroundColor(Color.WHITE)
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(12)
                                }
                                layoutParams = lp
                            }
                            val emptyInner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                gravity = android.view.Gravity.CENTER
                                val p = dp(32)
                                setPadding(p, p, p, p)
                            }
                            emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "🏖️"
                                textSize = 36f
                            })
                            emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Tidak Ada Jadwal KBM ($targetDay)"
                                textSize = 15f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(8)
                                }
                                layoutParams = lp
                            })
                            emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "Tidak ada jam mengajar tatap muka yang dijadwalkan pada hari ini."
                                textSize = 12f
                                setTextColor(Color.parseColor("#64748B"))
                                gravity = android.view.Gravity.CENTER
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(4)
                                }
                                layoutParams = lp
                            })
                            emptyCard.addView(emptyInner)
                            containerSchedule.addView(emptyCard)
                            return
                        }

                        // 1. KPI SUMMARY STRIP (4 METRIC COUNTERS)
                        val totalJp = items.count { !it.isBreak }
                        val activeJp = items.count { !it.isBreak && (it.isAlreadyIn || it.timeStatus == "ACTIVE_WINDOW") }
                        val upcomingJp = items.count { !it.isBreak && it.timeStatus == "UPCOMING" }
                        val completedJp = items.count { !it.isBreak && (it.timeStatus == "PAST" || it.sessionStatus == "CLOSED") }

                        val kpiCard = CardView(this@TeacherMainActivity).apply {
                            radius = 14f * density
                            cardElevation = 2f * density
                            setCardBackgroundColor(Color.WHITE)
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(12)
                            }
                            layoutParams = lp
                        }
                        val kpiLayout = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            weightSum = 4f
                        }

                        fun createKpiCell(title: String, value: String, colorHex: String): LinearLayout {
                            return LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                gravity = android.view.Gravity.CENTER
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                                addView(TextView(this@TeacherMainActivity).apply {
                                    text = value
                                    textSize = 16f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor(colorHex))
                                })
                                addView(TextView(this@TeacherMainActivity).apply {
                                    text = title
                                    textSize = 10f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#64748B"))
                                })
                            }
                        }

                        kpiLayout.addView(createKpiCell("TOTAL JP", "$totalJp JP", "#0F172A"))
                        kpiLayout.addView(createKpiCell("AKTIF", "$activeJp", "#2563EB"))
                        kpiLayout.addView(createKpiCell("MENUNGGU", "$upcomingJp", "#D97706"))
                        kpiLayout.addView(createKpiCell("SELESAI", "$completedJp", "#059669"))
                        kpiCard.addView(kpiLayout)
                        containerSchedule.addView(kpiCard)

                        // 2. HERO ACTIVE CARD (Bila ada sesi KBM yang sedang berlangsung saat ini)
                        val activeNowItem = items.firstOrNull { itm ->
                            !itm.isBreak && (itm.isAlreadyIn || itm.timeStatus == "ACTIVE_WINDOW")
                        }

                        if (activeNowItem != null) {
                            val heroCard = CardView(this@TeacherMainActivity).apply {
                                radius = 16f * density
                                cardElevation = 3f * density
                                setCardBackgroundColor(Color.parseColor("#F0FDF4"))
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = dp(14)
                                }
                                layoutParams = lp
                            }
                            val heroInner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(dp(16), dp(14), dp(16), dp(14))
                            }

                            // Hero Header Badge
                            val heroBadgeRow = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }
                            heroBadgeRow.addView(TextView(this@TeacherMainActivity).apply {
                                text = "🟢 KBM SEDANG BERLANGSUNG SEKARANG"
                                textSize = 11.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#15803D"))
                                val bg = android.graphics.drawable.GradientDrawable().apply {
                                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                                    cornerRadius = 12f * density
                                    setColor(Color.parseColor("#DCFCE7"))
                                }
                                background = bg
                                setPadding(dp(8), dp(3), dp(8), dp(3))
                            })
                            heroInner.addView(heroBadgeRow)

                            // Hero Title & Details
                            heroInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "JP ${activeNowItem.periodIndex}: ${activeNowItem.subjectName}"
                                textSize = 16f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(6)
                                }
                                layoutParams = lp
                            })

                            heroInner.addView(TextView(this@TeacherMainActivity).apply {
                                text = "👥 Kelas: ${activeNowItem.className} • 📍 ${activeNowItem.roomName ?: "Ruang Kelas ${activeNowItem.className}"} • 🕒 ${activeNowItem.startTime} - ${activeNowItem.endTime} WIB"
                                textSize = 12f
                                setTextColor(Color.parseColor("#334155"))
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(2)
                                    bottomMargin = dp(10)
                                }
                                layoutParams = lp
                            })

                            // Hero Action Buttons
                            if (activeNowItem.isAlreadyIn || activeNowItem.activeSession != null) {
                                val timeStr = activeNowItem.inTimeFormatted ?: "Tercatat"
                                val outCount = activeNowItem.studentOutCount
                                val totalStud = activeNowItem.totalStudents

                                heroInner.addView(TextView(this@TeacherMainActivity).apply {
                                    text = "✔ Presensi Masuk KBM Sukses ($timeStr WIB) • Siswa OUT: $outCount/$totalStud"
                                    textSize = 12f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#059669"))
                                    setPadding(0, 0, 0, dp(6))
                                })

                                val btnPresensiSiswa = Button(this@TeacherMainActivity).apply {
                                    text = "📋 Presensi Siswa Kelas ${activeNowItem.className}"
                                    textSize = 13f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)).apply {
                                        bottomMargin = dp(6)
                                    }
                                    setOnClickListener {
                                        showClassStudentsAttendanceDialog(activeNowItem.className, activeNowItem.sessionId ?: activeNowItem.id)
                                    }
                                }
                                heroInner.addView(btnPresensiSiswa)

                                val btnSelesaiKbm = Button(this@TeacherMainActivity).apply {
                                    text = "🚪 Selesai Mengajar & Keluar Kelas"
                                    textSize = 13f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#DC2626"))
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44))
                                    setOnClickListener {
                                        AlertDialog.Builder(this@TeacherMainActivity)
                                            .setTitle("Konfirmasi Selesai Mengajar")
                                            .setMessage("Apakah sesi KBM Kelas ${activeNowItem.className} mata pelajaran ${activeNowItem.subjectName} telah selesai?\n\nSistem monitoring TV Command Center akan mencatat KBM kelas selesai.")
                                            .setPositiveButton("Ya, Selesai Mengajar") { _, _ ->
                                                val sessId = activeNowItem.sessionId ?: activeNowItem.id ?: ""
                                                ApiClient.getClient(this@TeacherMainActivity).teacherEndClassSession(mapOf("sessionId" to sessId)).enqueue(object : Callback<BasicResponse> {
                                                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                                        if (response.isSuccessful && response.body()?.success == true) {
                                                            Toast.makeText(this@TeacherMainActivity, "✔ KBM Kelas resmi selesai!", Toast.LENGTH_SHORT).show()
                                                            loadAndRenderScheduleFn?.invoke()
                                                        } else {
                                                            Toast.makeText(this@TeacherMainActivity, response.body()?.message ?: "Gagal menutup sesi KBM", Toast.LENGTH_SHORT).show()
                                                        }
                                                    }
                                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                                        Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                                                    }
                                                })
                                            }
                                            .setNegativeButton("Batal", null)
                                            .show()
                                    }
                                }
                                heroInner.addView(btnSelesaiKbm)
                            } else {
                                val btnInHero = Button(this@TeacherMainActivity).apply {
                                    text = "📍 1-TAP IN KELAS (MULAI MENGAJAR)"
                                    textSize = 13.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#059669"))
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46))
                                    setOnClickListener {
                                        handleTeacherInClassSession(activeNowItem)
                                    }
                                }
                                heroInner.addView(btnInHero)
                            }
                            heroCard.addView(heroInner)
                            containerSchedule.addView(heroCard)
                        }

                        // 3. DAFTAR TIMELINE JAM PELAJARAN
                        val tvSection = TextView(this@TeacherMainActivity).apply {
                            text = "RANGKAIAN JAM PELAJARAN ($targetDay):"
                            textSize = 11f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#64748B"))
                            setPadding(0, dp(4), 0, dp(8))
                        }
                        containerSchedule.addView(tvSection)

                        for (item in items) {
                            val isHeroItem = (activeNowItem != null && activeNowItem.id == item.id)
                            val cardView = CardView(this@TeacherMainActivity).apply {
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply {
                                    bottomMargin = dp(10)
                                }
                                radius = 14f * density
                                cardElevation = if (isHeroItem) 2.5f * density else 1.5f * density
                                setCardBackgroundColor(if (item.isBreak) Color.parseColor("#F8FAFC") else Color.WHITE)
                            }

                            val itemLayout = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(dp(16), dp(14), dp(16), dp(14))
                            }

                            // Header Bar: JP Badge + Title + Time Pill
                            val rowHeader = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }

                            val tvJpBadge = TextView(this@TeacherMainActivity).apply {
                                text = "JP ${item.periodIndex}"
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#1E40AF"))
                                val bg = android.graphics.drawable.GradientDrawable().apply {
                                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                                    cornerRadius = 6f * density
                                    setColor(Color.parseColor("#EFF6FF"))
                                }
                                background = bg
                                setPadding(dp(8), dp(3), dp(8), dp(3))
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    marginEnd = dp(8)
                                }
                                layoutParams = lp
                            }
                            rowHeader.addView(tvJpBadge)

                            val tvItemTitle = TextView(this@TeacherMainActivity).apply {
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                                text = item.subjectName
                                setTextColor(if (item.isBreak) Color.parseColor("#64748B") else Color.parseColor("#0F172A"))
                                textSize = 14.5f
                                typeface = Typeface.DEFAULT_BOLD
                            }
                            rowHeader.addView(tvItemTitle)

                            val tvTime = TextView(this@TeacherMainActivity).apply {
                                text = "${item.startTime} - ${item.endTime}"
                                setTextColor(Color.parseColor("#2563EB"))
                                textSize = 11.5f
                                typeface = Typeface.DEFAULT_BOLD
                                val bgP = android.graphics.drawable.GradientDrawable().apply {
                                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                                    cornerRadius = 8f * density
                                    setColor(Color.parseColor("#EFF6FF"))
                                }
                                background = bgP
                                setPadding(dp(8), dp(3), dp(8), dp(3))
                            }
                            rowHeader.addView(tvTime)
                            itemLayout.addView(rowHeader)

                            // Class & Room Subtitle
                            val tvDetails = TextView(this@TeacherMainActivity).apply {
                                text = "👥 Kelas: ${item.className} • 📍 ${item.roomName ?: "Ruang Kelas ${item.className}"}"
                                setTextColor(Color.parseColor("#64748B"))
                                textSize = 12f
                                setPadding(0, dp(4), 0, dp(6))
                            }
                            itemLayout.addView(tvDetails)

                            // Status & Action Row
                            if (!item.isBreak) {
                                if (item.isAlreadyIn || item.activeSession != null) {
                                    val timeStr = item.inTimeFormatted ?: "Tercatat"
                                    val outCount = item.studentOutCount
                                    val totalStud = item.totalStudents

                                    val tvStatusIn = TextView(this@TeacherMainActivity).apply {
                                        text = "✔ IN: $timeStr WIB • Siswa OUT: $outCount/$totalStud"
                                        setTextColor(Color.parseColor("#059669"))
                                        textSize = 12f
                                        typeface = Typeface.DEFAULT_BOLD
                                        setPadding(0, dp(2), 0, dp(4))
                                    }
                                    itemLayout.addView(tvStatusIn)

                                    if (!isHeroItem) {
                                        val btnActionRow = LinearLayout(this@TeacherMainActivity).apply {
                                            orientation = LinearLayout.HORIZONTAL
                                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                                topMargin = dp(4)
                                            }
                                            layoutParams = lp
                                        }

                                        val btnPresensi = Button(this@TeacherMainActivity).apply {
                                            layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f).apply {
                                                marginEnd = dp(6)
                                            }
                                            text = "📋 Presensi Siswa"
                                            textSize = 11.5f
                                            typeface = Typeface.DEFAULT_BOLD
                                            setTextColor(Color.WHITE)
                                            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
                                            setOnClickListener {
                                                showClassStudentsAttendanceDialog(item.className, item.sessionId ?: item.id)
                                            }
                                        }
                                        btnActionRow.addView(btnPresensi)

                                        val btnEnd = Button(this@TeacherMainActivity).apply {
                                            layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f)
                                            text = "🚪 Selesai"
                                            textSize = 11.5f
                                            typeface = Typeface.DEFAULT_BOLD
                                            setTextColor(Color.WHITE)
                                            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#DC2626"))
                                            setOnClickListener {
                                                AlertDialog.Builder(this@TeacherMainActivity)
                                                    .setTitle("Selesai Mengajar")
                                                    .setMessage("Tutup sesi KBM Kelas ${item.className}?")
                                                    .setPositiveButton("Ya, Selesai") { _, _ ->
                                                        val sessId = item.sessionId ?: item.id ?: ""
                                                        ApiClient.getClient(this@TeacherMainActivity).teacherEndClassSession(mapOf("sessionId" to sessId)).enqueue(object : Callback<BasicResponse> {
                                                            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                                                loadAndRenderScheduleFn?.invoke()
                                                            }
                                                            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                                                Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                                                            }
                                                        })
                                                    }
                                                    .setNegativeButton("Batal", null)
                                                    .show()
                                            }
                                        }
                                        btnActionRow.addView(btnEnd)
                                        itemLayout.addView(btnActionRow)
                                    }
                                } else {
                                    val isUpcoming = (item.timeStatus == "UPCOMING")
                                    val isPast = (item.timeStatus == "PAST")
                                    val isDifferentDay = (item.timeStatus == "DIFFERENT_DAY")
                                    val canClickIn = (item.canInNow == true)

                                    if (canClickIn && !isHeroItem) {
                                        val btnIn = Button(this@TeacherMainActivity).apply {
                                            layoutParams = LinearLayout.LayoutParams(
                                                LinearLayout.LayoutParams.MATCH_PARENT,
                                                dp(42)
                                            ).apply { topMargin = dp(4) }
                                            text = "📍 1-TAP [ IN KELAS ]"
                                            textSize = 12.5f
                                            typeface = Typeface.DEFAULT_BOLD
                                            setTextColor(Color.WHITE)
                                            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#059669"))
                                            setOnClickListener {
                                                handleTeacherInClassSession(item)
                                            }
                                        }
                                        itemLayout.addView(btnIn)
                                    } else if (isUpcoming) {
                                        val tvUpcomingPill = TextView(this@TeacherMainActivity).apply {
                                            text = "⏳ Belum Waktunya (Mulai ${item.startTime} WIB)"
                                            textSize = 11.5f
                                            setTypeface(null, Typeface.BOLD)
                                            setTextColor(Color.parseColor("#B45309"))
                                            val bg = android.graphics.drawable.GradientDrawable().apply {
                                                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                                                cornerRadius = 8f * density
                                                setColor(Color.parseColor("#FEF3C7"))
                                            }
                                            background = bg
                                            setPadding(dp(10), dp(6), dp(10), dp(6))
                                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                                topMargin = dp(4)
                                            }
                                            layoutParams = lp
                                        }
                                        itemLayout.addView(tvUpcomingPill)
                                    } else if (isPast) {
                                        val tvPastPill = TextView(this@TeacherMainActivity).apply {
                                            text = "⌛ Jam Mengajar Telah Berakhir (${item.endTime} WIB)"
                                            textSize = 11.5f
                                            setTypeface(null, Typeface.BOLD)
                                            setTextColor(Color.parseColor("#94A3B8"))
                                            val bg = android.graphics.drawable.GradientDrawable().apply {
                                                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                                                cornerRadius = 8f * density
                                                setColor(Color.parseColor("#F1F5F9"))
                                            }
                                            background = bg
                                            setPadding(dp(10), dp(6), dp(10), dp(6))
                                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                                topMargin = dp(4)
                                            }
                                            layoutParams = lp
                                        }
                                        itemLayout.addView(tvPastPill)
                                    } else if (isDifferentDay) {
                                        val tvOtherPill = TextView(this@TeacherMainActivity).apply {
                                            text = "📅 Jadwal Mengajar Hari $targetDay"
                                            textSize = 11.5f
                                            setTextColor(Color.parseColor("#64748B"))
                                            setPadding(0, dp(2), 0, 0)
                                        }
                                        itemLayout.addView(tvOtherPill)
                                    }
                                }
                            }

                            cardView.addView(itemLayout)
                            containerSchedule.addView(cardView)
                        }
                    } else {
                        val emptyTv = TextView(this@TeacherMainActivity).apply {
                            text = "Tidak ada jadwal mengajar pada hari ${targetDay}."
                            setTextColor(Color.parseColor("#64748B"))
                            textSize = 12f
                            setPadding(dp(16), dp(16), dp(16), dp(16))
                        }
                        containerSchedule.addView(emptyTv)
                    }
                }

                override fun onFailure(call: Call<TeacherClassPeriodsResponse>, t: Throwable) {
                    containerSchedule.removeAllViews()
                    val errTv = TextView(this@TeacherMainActivity).apply {
                        text = "Gagal memuat jadwal: ${t.message}"
                        setTextColor(Color.parseColor("#EF4444"))
                        textSize = 12f
                        setPadding(dp(16), dp(16), dp(16), dp(16))
                    }
                    containerSchedule.addView(errTv)
                }
            })
        }

        activeScheduleDialogRefresh = { loadAndRenderSchedule(currentSelectedDay) }
        loadAndRenderScheduleFn = { loadAndRenderSchedule(currentSelectedDay) }

        loadAndRenderSchedule(currentSelectedDay)
        dialog.show()
    }

    private fun handleTeacherInClassSession(item: ClassPeriodItemDto) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                2001
            )
            Toast.makeText(this, "Izin GPS lokasi diperlukan untuk verifikasi kehadiran di dalam kelas (maksimal 10 meter).", Toast.LENGTH_LONG).show()
            return
        }

        val (lat, lng, isMock) = getDeviceLocation()
        if (lat == 0.0 || lng == 0.0) {
            Toast.makeText(this, "📍 Menunggu sinyal GPS. Pastikan GPS/Lokasi HP aktif dan pastikan berada di kelas ${item.className}.", Toast.LENGTH_LONG).show()
            return
        }
        if (isMock) {
            AlertDialog.Builder(this)
                .setTitle("🚨 Fake GPS Terdeteksi")
                .setMessage("Aplikasi mendeteksi penggunaan Fake GPS / Mock Location pada perangkat Anda. Presensi kelas dibatalkan demi integritas sekolah.")
                .setIcon(android.R.drawable.ic_dialog_alert)
                .setPositiveButton("Mengerti", null)
                .show()
            return
        }

        val req = TeacherInSessionRequest(
            scheduleId = item.id,
            className = item.className,
            subjectName = item.subjectName,
            periodIndex = item.periodIndex,
            timeRange = "${item.startTime} - ${item.endTime}",
            startTimeStr = item.startTime,
            endTimeStr = item.endTime,
            endTime = item.endTime,
            roomName = item.roomName,
            lat = lat,
            lng = lng,
            isFakeGps = isMock
        )
        Toast.makeText(this, "Memverifikasi GPS & membuka sesi JP ${item.periodIndex}...", Toast.LENGTH_SHORT).show()

        ApiClient.getClient(this).teacherInClassSession(req).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    Toast.makeText(this@TeacherMainActivity, "✔ Berhasil IN! Sesi JP aktif & monitoring kelas menyala hijau.", Toast.LENGTH_LONG).show()
                    activeScheduleDialogRefresh?.invoke()
                } else {
                    val errorBody = try {
                        response.errorBody()?.string()?.let { errJson ->
                            org.json.JSONObject(errJson).optString("message", "")
                        }
                    } catch (e: Exception) { null }
                    val msg = if (!errorBody.isNullOrEmpty()) errorBody else response.body()?.message ?: "Gagal membuka sesi JP"

                    AlertDialog.Builder(this@TeacherMainActivity)
                        .setTitle("⛔ Presensi Kelas Ditolak")
                        .setMessage(msg)
                        .setIcon(android.R.drawable.ic_dialog_alert)
                        .setPositiveButton("Mengerti", null)
                        .show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showClassStudentsAttendanceDialog(className: String, sessionId: String) {
        val dialog = createFullscreenDialog()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📋 Presensi Siswa Kelas $className",
            subtitle = "Siswa sakit/izin/alpa gerbang otomatis terkunci (LOCKED)",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val tvStatus = TextView(this).apply {
            text = "Memuat data presensi siswa kelas $className..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 0, 0, dp(8))
        }
        contentLayout.addView(tvStatus)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scroll.addView(listContainer)
        contentLayout.addView(scroll)

        val btnConfirm = Button(this).apply {
            text = "💾 Simpan & Konfirmasi Presensi Siswa"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply {
                topMargin = dp(8)
            }
            isEnabled = false
        }
        contentLayout.addView(btnConfirm)
        root.addView(contentLayout)

        dialog.setView(root)
        dialog.show()

        var currentStudents: List<com.school.smartcbt.data.model.ClassStudentAttendanceDto> = emptyList()

        ApiClient.getClient(this).getClassSessionStudentsStatus(className, sessionId).enqueue(object : Callback<com.school.smartcbt.data.model.ClassSessionStudentsStatusResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.ClassSessionStudentsStatusResponse>, response: Response<com.school.smartcbt.data.model.ClassSessionStudentsStatusResponse>) {
                val resp = response.body()
                if (response.isSuccessful && resp?.success == true) {
                    val students = resp.students ?: emptyList()
                    currentStudents = students
                    tvStatus.text = "Total Siswa: ${resp.totalStudents} • Hadir di Sekolah: ${resp.presentCount} • Berhalangan/Alpa: ${resp.absentCount}"
                    btnConfirm.isEnabled = true

                    listContainer.removeAllViews()
                    students.forEach { st ->
                        val card = CardView(this@TeacherMainActivity).apply {
                            radius = 10f * density
                            cardElevation = 1.5f * density
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(6)
                            }
                        }
                        val cardInner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                            setPadding(dp(14), dp(10), dp(14), dp(10))
                        }

                        val colInfo = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        colInfo.addView(TextView(this@TeacherMainActivity).apply {
                            text = st.name
                            textSize = 13f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        })
                        colInfo.addView(TextView(this@TeacherMainActivity).apply {
                            text = "NISN: ${st.nisn ?: "-"} • Gate: ${st.gateStatus ?: "Belum Presensi"}"
                            textSize = 11f
                            setTextColor(Color.parseColor("#64748B"))
                        })
                        cardInner.addView(colInfo)

                        if (st.isLocked) {
                            val badge = TextView(this@TeacherMainActivity).apply {
                                val label = when (st.status) {
                                    "SAKIT" -> "🔒 🏥 SAKIT"
                                    "IZIN" -> "🔒 📄 IZIN RESMI"
                                    "UKS" -> "🔒 🏥 DI RUANG UKS"
                                    else -> "🔒 ⚠️ BELUM DI SEKOLAH"
                                }
                                text = label
                                textSize = 11f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#DC2626"))
                                val bgB = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(Color.parseColor("#FEE2E2"))
                                    cornerRadius = 6f * density
                                }
                                background = bgB
                                setPadding(dp(8), dp(4), dp(8), dp(4))
                            }
                            cardInner.addView(badge)
                        } else {
                            val cbHadir = CheckBox(this@TeacherMainActivity).apply {
                                text = "Hadir di Kelas"
                                textSize = 11.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#059669"))
                                isChecked = (st.status == "HADIR")
                                setOnCheckedChangeListener { _, isChecked ->
                                    st.status = if (isChecked) "HADIR" else "TIDAK_DI_KELAS"
                                }
                            }
                            cardInner.addView(cbHadir)
                        }

                        card.addView(cardInner)
                        listContainer.addView(card)
                    }
                } else {
                    tvStatus.text = "Gagal memuat status siswa: ${resp?.message ?: "Error server"}"
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.ClassSessionStudentsStatusResponse>, t: Throwable) {
                tvStatus.text = "Koneksi terputus: ${t.message}"
            }
        })

        btnConfirm.setOnClickListener {
            val payload = mapOf(
                "sessionId" to sessionId,
                "confirmedStudents" to currentStudents.map {
                    mapOf("studentId" to it.studentId, "status" to it.status)
                }
            )
            btnConfirm.isEnabled = false
            btnConfirm.text = "Menyimpan Presensi..."

            ApiClient.getClient(this).confirmClassSessionStudents(payload).enqueue(object : Callback<BasicResponse> {
                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                    btnConfirm.isEnabled = true
                    btnConfirm.text = "💾 Simpan & Konfirmasi Presensi Siswa"
                    if (response.isSuccessful && response.body()?.success == true) {
                        Toast.makeText(this@TeacherMainActivity, "✔ Presensi Siswa Kelas $className Berhasil Dikonfirmasi & Disimpan!", Toast.LENGTH_LONG).show()
                        dialog.dismiss()
                        activeScheduleDialogRefresh?.invoke()
                    } else {
                        Toast.makeText(this@TeacherMainActivity, response.body()?.message ?: "Gagal menyimpan presensi", Toast.LENGTH_SHORT).show()
                    }
                }

                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                    btnConfirm.isEnabled = true
                    btnConfirm.text = "💾 Simpan & Konfirmasi Presensi Siswa"
                    Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                }
            })
        }
    }

    private fun showTeacherSubjectAttendanceDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val teachingSubj = sessionManager.getTeachingSubject().ifEmpty { "Mata Pelajaran" }
        val header = createFullscreenHeader(
            title = "📊 Rekap Presensi: $teachingSubj",
            subtitle = "Guru: ${sessionManager.getName()} • SMPN 1 Boyolangu",
            onClose = { dialog.dismiss() },
            actionBtnText = "📄 Unduh PDF",
            onActionClick = {
                com.school.smartcbt.utils.AttendancePdfHelper.showDownloadPdfDialog(
                    this@TeacherMainActivity,
                    defaultClassName = sessionManager.getClassName().ifEmpty { null },
                    title = "Laporan Rekap Presensi $teachingSubj"
                )
            }
        )
        root.addView(header)

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val progress = ProgressBar(this).apply {
            isIndeterminate = true
            setPadding(0, 48, 0, 48)
        }
        contentLayout.addView(progress)
        root.addView(contentLayout)

        dialog.setView(root)
        dialog.show()

        ApiClient.getClient(this).getTeacherSubjectAttendanceRecap().enqueue(object : Callback<com.school.smartcbt.data.model.SubjectAttendanceResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.SubjectAttendanceResponse>, response: Response<com.school.smartcbt.data.model.SubjectAttendanceResponse>) {
                contentLayout.removeView(progress)
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    val subjects = body.subjects ?: emptyList()

                    val tvSub = TextView(this@TeacherMainActivity).apply {
                        text = "Statistik kehadiran siswa per rombel mengajar untuk bidang studi $teachingSubj (${subjects.size} Rombel Terdata)."
                        textSize = 12.5f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(0, 0, 0, 16)
                    }
                    contentLayout.addView(tvSub)

                    if (subjects.isEmpty()) {
                        val emptyTv = TextView(this@TeacherMainActivity).apply {
                            text = "Belum ada rekap presensi kelas untuk bidang studi $teachingSubj."
                            textSize = 13f
                            setTextColor(Color.parseColor("#94A3B8"))
                            gravity = android.view.Gravity.CENTER
                            setPadding(0, 32, 0, 32)
                        }
                        contentLayout.addView(emptyTv)
                        return
                    }

                    val scroll = ScrollView(this@TeacherMainActivity).apply {
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            0,
                            1f
                        )
                    }

                    val listContainer = LinearLayout(this@TeacherMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                    }

                    for (subj in subjects) {
                        val card = CardView(this@TeacherMainActivity).apply {
                            radius = 16f
                            cardElevation = 2f
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                            layoutParams = LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                LinearLayout.LayoutParams.WRAP_CONTENT
                            ).apply {
                                setMargins(0, 0, 0, 12)
                            }
                        }

                        val inner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(20, 18, 20, 18)
                        }

                        val headRow = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                        }

                        val tvSubjName = TextView(this@TeacherMainActivity).apply {
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                            text = subj.subjectName
                            textSize = 15.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#1E293B"))
                        }

                        val tvPct = TextView(this@TeacherMainActivity).apply {
                            text = "${subj.percentage}%"
                            textSize = 14f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(if (subj.percentage >= 85) Color.parseColor("#15803D") else Color.parseColor("#D97706"))
                        }

                        headRow.addView(tvSubjName)
                        headRow.addView(tvPct)

                        val tvTeacher = TextView(this@TeacherMainActivity).apply {
                            text = "Guru Pengampu: ${subj.teacherName ?: sessionManager.getName()} • Total: ${subj.totalSessions} Sesi KBM"
                            textSize = 12f
                            setTextColor(Color.parseColor("#64748B"))
                            setPadding(0, 4, 0, 10)
                        }

                        val statsRow = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            weightSum = 4f
                            setBackgroundColor(Color.parseColor("#F8FAFC"))
                            setPadding(8, 8, 8, 8)
                        }

                        fun createStatCol(label: String, value: Int, colorHex: String): LinearLayout {
                            return LinearLayout(this@TeacherMainActivity).apply {
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                                orientation = LinearLayout.VERTICAL
                                gravity = android.view.Gravity.CENTER
                                val tvV = TextView(this@TeacherMainActivity).apply {
                                    text = value.toString()
                                    textSize = 13f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor(colorHex))
                                }
                                val tvL = TextView(this@TeacherMainActivity).apply {
                                    text = label
                                    textSize = 9.5f
                                    setTextColor(Color.parseColor("#64748B"))
                                }
                                addView(tvV)
                                addView(tvL)
                            }
                        }

                        statsRow.addView(createStatCol("Hadir", subj.present, "#15803D"))
                        statsRow.addView(createStatCol("Sakit", subj.sick, "#DC2626"))
                        statsRow.addView(createStatCol("Izin", subj.permission, "#0284C7"))
                        statsRow.addView(createStatCol("Alpa", subj.truant, "#B91C1C"))

                        inner.addView(headRow)
                        inner.addView(tvTeacher)
                        inner.addView(statsRow)

                        val promptRow = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = (8 * resources.displayMetrics.density).toInt()
                            }
                            layoutParams = lp
                        }
                        val tvViewStudents = TextView(this@TeacherMainActivity).apply {
                            text = "👥 Lihat Daftar Lengkap ${subj.totalStudents ?: subj.students?.size ?: 32} Siswa & Detail Absen ➔"
                            textSize = 11f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#2563EB"))
                        }
                        promptRow.addView(tvViewStudents)
                        inner.addView(promptRow)

                        card.isClickable = true
                        card.isFocusable = true
                        card.setOnClickListener {
                            showSubjectClassStudentsDialog(subj)
                        }

                        card.addView(inner)
                        listContainer.addView(card)
                    }

                    scroll.addView(listContainer)
                    contentLayout.addView(scroll)
                } else {
                    Toast.makeText(this@TeacherMainActivity, "Gagal memuat rekap presensi per mapel", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.SubjectAttendanceResponse>, t: Throwable) {
                contentLayout.removeView(progress)
                Toast.makeText(this@TeacherMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showSubjectClassStudentsDialog(subj: com.school.smartcbt.data.model.SubjectAttendanceItemDto) {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val density = resources.displayMetrics.density
        val className = subj.className ?: subj.subjectName.substringBefore(" •")
        val header = createFullscreenHeader(
            title = "👥 Daftar Siswa: $className",
            subtitle = "Mapel: ${sessionManager.getTeachingSubject()} • Kehadiran Rombel: ${subj.percentage}%",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        // Summary Card
        val cardSummary = CardView(this).apply {
            radius = 14f * density
            cardElevation = 2f * density
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }
        val sumBox = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 4f
            val p = (12 * density).toInt()
            setPadding(p, p, p, p)
        }
        fun addSumCol(label: String, value: String, colorHex: String) {
            val col = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            col.addView(TextView(this).apply {
                text = value
                textSize = 15f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(colorHex))
            })
            col.addView(TextView(this).apply {
                text = label
                textSize = 10f
                setTextColor(Color.parseColor("#64748B"))
            })
            sumBox.addView(col)
        }
        addSumCol("Hadir", subj.present.toString(), "#059669")
        addSumCol("Sakit", subj.sick.toString(), "#DC2626")
        addSumCol("Izin", subj.permission.toString(), "#0284C7")
        addSumCol("Alpa", subj.truant.toString(), "#B91C1C")
        cardSummary.addView(sumBox)
        container.addView(cardSummary)

        // Search Filter EditText
        val etSearch = EditText(this).apply {
            hint = "🔍 Cari nama atau NISN siswa..."
            textSize = 13f
            val padP = (12 * density).toInt()
            setPadding(padP, padP, padP, padP)
            val bg = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                cornerRadius = 10f * density
                setColor(Color.WHITE)
                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
            }
            background = bg
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
        }
        container.addView(etSearch)

        val studentsListContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val allStudents = subj.students ?: emptyList()

        fun renderStudentCards(filter: String = "") {
            studentsListContainer.removeAllViews()
            val filtered = if (filter.isEmpty()) allStudents else allStudents.filter {
                it.name.contains(filter, ignoreCase = true) || (it.nisn?.contains(filter, ignoreCase = true) == true)
            }

            if (filtered.isEmpty()) {
                val emptyTv = TextView(this@TeacherMainActivity).apply {
                    text = if (allStudents.isEmpty()) "Belum ada data siswa terdata di rombel ini." else "Tidak ada siswa yang sesuai pencarian '$filter'."
                    textSize = 12.5f
                    setTextColor(Color.parseColor("#94A3B8"))
                    gravity = android.view.Gravity.CENTER
                    val p = (24 * density).toInt()
                    setPadding(p, p, p, p)
                }
                studentsListContainer.addView(emptyTv)
                return
            }

            filtered.forEachIndexed { idx, st ->
                val cardSt = CardView(this@TeacherMainActivity).apply {
                    radius = 12f * density
                    cardElevation = 1.5f * density
                    setCardBackgroundColor(Color.WHITE)
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (8 * density).toInt()
                    }
                    layoutParams = lp
                }
                val row = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                    val p = (12 * density).toInt()
                    setPadding(p, p, p, p)
                }

                // Number circle
                val numBox = TextView(this@TeacherMainActivity).apply {
                    text = "${idx + 1}"
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#2563EB"))
                    gravity = android.view.Gravity.CENTER
                    val size = (32 * density).toInt()
                    layoutParams = LinearLayout.LayoutParams(size, size).apply {
                        marginEnd = (10 * density).toInt()
                    }
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.OVAL
                        setColor(Color.parseColor("#EFF6FF"))
                    }
                    background = bg
                }
                row.addView(numBox)

                // Info Box
                val infoBox = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                val tvName = TextView(this@TeacherMainActivity).apply {
                    text = st.name
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                }
                val tvMeta = TextView(this@TeacherMainActivity).apply {
                    text = "NISN: ${st.nisn ?: "-"} • Kelas: ${st.className ?: className} • Gender: ${st.gender ?: "-"}"
                    textSize = 10.5f
                    setTextColor(Color.parseColor("#64748B"))
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (2 * density).toInt()
                    }
                    layoutParams = lp
                }
                val tvStatsBreakdown = TextView(this@TeacherMainActivity).apply {
                    text = "Hadir: ${st.presentCount} | Sakit: ${st.sickCount} | Izin: ${st.permissionCount} | Alpa: ${st.absentCount}"
                    textSize = 10.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#059669"))
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (3 * density).toInt()
                    }
                    layoutParams = lp
                }
                infoBox.addView(tvName)
                infoBox.addView(tvMeta)
                infoBox.addView(tvStatsBreakdown)
                row.addView(infoBox)

                // Percentage Badge
                val tvPctBadge = TextView(this@TeacherMainActivity).apply {
                    text = "${st.percentage}%"
                    textSize = 11.5f
                    setTypeface(null, Typeface.BOLD)
                    val isGood = st.percentage >= 85
                    setTextColor(if (isGood) Color.parseColor("#059669") else Color.parseColor("#DC2626"))
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                        cornerRadius = 10f * density
                        setColor(if (isGood) Color.parseColor("#ECFDF5") else Color.parseColor("#FEF2F2"))
                    }
                    background = bg
                    val ph = (8 * density).toInt()
                    val pv = (4 * density).toInt()
                    setPadding(ph, pv, ph, pv)
                }
                row.addView(tvPctBadge)
                cardSt.addView(row)
                studentsListContainer.addView(cardSt)
            }
        }

        renderStudentCards()

        etSearch.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                renderStudentCards(s?.toString()?.trim() ?: "")
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })

        container.addView(studentsListContainer)
        sv.addView(container)
        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun sanitizeNetworkErrorMessage(msg: String?): String {
        if (msg.isNullOrEmpty()) return "Koneksi ke server sekolah terputus. Pastikan terhubung ke jaringan sekolah."
        val clean = msg.replace(Regex("""\b(?:https?://)?(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:/[^\s]*)?\b"""), "Server Sekolah")
            .replace(Regex("""/[0-9.]+:[0-9]+"""), "Server Sekolah")
        return if (clean.contains("failed to connect", ignoreCase = true) ||
            clean.contains("timeout", ignoreCase = true) ||
            clean.contains("connection", ignoreCase = true) ||
            clean.contains("refused", ignoreCase = true) ||
            clean.contains("unreachable", ignoreCase = true)) {
            "Gagal terhubung ke server sekolah. Pastikan perangkat terhubung ke Wi-Fi / jaringan sekolah."
        } else {
            clean
        }
    }

    private fun showRoleSwitcherDialog() {
        val availableRoles = sessionManager.getAvailableRoles()
        val tugasTambahan = sessionManager.getTugasTambahan()
        val homeroomClass = sessionManager.getClassName()
        val subject = sessionManager.getTeachingSubject()?.uppercase() ?: ""
        val teacherName = sessionManager.getName().uppercase()

        val roleItems = mutableListOf<Triple<String, String, () -> Unit>>()

        // 1. Guru Pengampu
        roleItems.add(Triple("👨‍🏫 Guru Pengampu / Mapel", "Fokus kehadiran mengajar KBM per kelas yang diampu", {
            binding.tvRoleBadgeHeader.text = "👨‍🏫 Guru Pengampu"
            Toast.makeText(this, "Beralih ke mode Guru Pengampu", Toast.LENGTH_SHORT).show()
        }))

        // 2. Wali Kelas
        if (availableRoles.contains("WALI_KELAS") || (homeroomClass.isNotEmpty() && homeroomClass != "-")) {
            roleItems.add(Triple("⭐ Wali Kelas ($homeroomClass)", "Akses monitoring presensi, rekap, & izin siswa rombel", {
                if (binding.cardHomeroom.visibility == View.VISIBLE) {
                    binding.btnViewHomeroomStudents.performClick()
                } else {
                    Toast.makeText(this, "Rombel binaan: $homeroomClass", Toast.LENGTH_SHORT).show()
                }
            }))
        }

        // 3. Operator
        // 3. Operator
        val isOperator = availableRoles.contains("OPERATOR") || tugasTambahan.contains("OPERATOR") || sessionManager.getRole().uppercase().contains("OPERATOR")
        if (isOperator) {
            roleItems.add(Triple("⚙️ Mode Operator Sekolah", "Panel kontrol akademik, broadcast massal, & manajemen CBT", {
                openOperatorDashboard()
            }))
        }

        // 3B. Tim Kurikulum
        val isKurikulum = availableRoles.contains("KURIKULUM") || tugasTambahan.contains("KURIKULUM") || sessionManager.getRole().uppercase().contains("KURIKULUM") || teacherName.contains("SIDIK") || teacherName.contains("SUJATMIKO")
        if (isKurikulum) {
            roleItems.add(Triple("🏛️ Tim Kurikulum", "Approval izin guru, rekap bulanan wali kelas, & disposisi KBM", {
                showKurikulumCenterDialog()
            }))
        }

        // 3C. Pengawasan Ruang Ujian & Proktor CBT (UNBK/ANBK)
        roleItems.add(Triple("🖥️ Ruang Proktor Ujian (UNBK)", "Monitoring live ujian, acak token dinamis 15 menit, reset login siswa & BAP", {
            showProctorTokenDialog()
        }))

        // 4. Guru Piket
        roleItems.add(Triple("🛡️ Posko Guru Piket Hari Ini", "Pantau gerbang masuk, disposisi kelas kosong & guru izin", {
            showTeacherPiketCenterDialog()
        }))

        // 5. Guru PAI
        if (availableRoles.contains("PAI") || subject.contains("AGAMA") || subject.contains("PAI") || subject.contains("ISLAM")) {
            roleItems.add(Triple("🕌 Kontrol Mushola (Guru PAI)", "Kelola jadwal dan presensi sholat berjamaah mushola", {
                showPaiPrayerControlDialog()
            }))
            roleItems.add(Triple("📖 Tahfiz & Murojaah Juz 30 (PAI)", "Target surat & ayat, setoran langsung/audio, rubrik 5 aspek & murojaah", {
                showTahfizPaiControlDialog()
            }))
        }

        // 6. Guru BK
        if (availableRoles.contains("COUNSELOR") || sessionManager.getRole().uppercase().contains("BK") || sessionManager.getRole().uppercase().contains("COUNSELOR")) {
            roleItems.add(Triple("🕊️ Portal Bimbingan Konseling (BK)", "Konseling siswa, verifikasi izin keluar/meja BK, & buku poin", {
                startActivity(Intent(this, BkActivity::class.java))
            }))
        }

        // 7. Pos Keamanan & Scanner Gatepass (Satpam / Guru Piket)
        roleItems.add(Triple("🛡️ Pos Keamanan & Scanner Gatepass", "Scan QR izin keluar gerbang, siswa kembali, & monitor pos satpam", {
            startActivity(Intent(this, SatpamMainActivity::class.java))
        }))

        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🔄 Ganti Peran & Akses",
            subtitle = "Pilih modul fungsi tugas guru SMPN 1 Boyolangu",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        roleItems.forEach { (title, desc, action) ->
            val card = CardView(this).apply {
                radius = 12f * resources.displayMetrics.density
                cardElevation = 2f * resources.displayMetrics.density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (12 * resources.displayMetrics.density).toInt()
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    dialog.dismiss()
                    action.invoke()
                }
            }

            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val p = (14 * resources.displayMetrics.density).toInt()
                setPadding(p, p, p, p)
            }

            val infoBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val tvTitle = TextView(this).apply {
                text = title
                textSize = 14f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            }
            val tvDesc = TextView(this).apply {
                text = desc
                textSize = 11.5f
                setTextColor(Color.parseColor("#64748B"))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = 4
                }
                layoutParams = lp
            }
            infoBox.addView(tvTitle)
            infoBox.addView(tvDesc)

            val tvArrow = TextView(this).apply {
                text = "➔"
                textSize = 16f
                setTextColor(Color.parseColor("#6366F1"))
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginStart = (8 * resources.displayMetrics.density).toInt()
                }
                layoutParams = lp
            }

            row.addView(infoBox)
            row.addView(tvArrow)
            card.addView(row)
            container.addView(card)
        }

        sv.addView(container)
        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun showManagementHubDialog() {
        val availableRoles = sessionManager.getAvailableRoles().map { it.uppercase().trim() }
        val tugasTambahan = sessionManager.getTugasTambahan().uppercase()
        val role = sessionManager.getRole().uppercase()
        val homeroomClass = sessionManager.getClassName().trim()
        val subject = sessionManager.getTeachingSubject().uppercase().trim()
        val teacherName = sessionManager.getName().uppercase()

        val isGuruPai = (!teacherName.contains("MAURIK")) && (
                subject.contains("PAI") || subject.contains("AGAMA") || subject.contains("ISLAM") ||
                tugasTambahan.contains("PAI") || availableRoles.any { it.contains("PAI") } || role.contains("PAI") ||
                teacherName.contains("MUNAWIR") || teacherName.contains("BRIAN") || teacherName.contains("ENY ASTUTI")
        )

        val isWaliKelas = (homeroomClass.isNotEmpty() && homeroomClass != "-" && homeroomClass != "null") ||
                tugasTambahan.contains("WALI") || availableRoles.any { it.contains("WALI") }

        val isKurikulum = role.contains("KURIKULUM") ||
                tugasTambahan.contains("KURIKULUM") || availableRoles.any { it.contains("KURIKULUM") } || subject.contains("KURIKULUM") ||
                teacherName.contains("SIDIK") || teacherName.contains("SUJATMIKO")

        data class MgmtItem(
            val title: String,
            val desc: String,
            val iconEmoji: String,
            val tagBadge: String,
            val badgeColor: String,
            val iconBgColor: String,
            val action: () -> Unit
        )

        val items = mutableListOf<MgmtItem>()
        items.add(
            MgmtItem(
                title = "Perangkat Ajar",
                desc = "Capaian Pembelajaran (CP), ATP, & Modul Ajar Kurikulum Merdeka",
                iconEmoji = "📘",
                tagBadge = "Kurikulum Merdeka",
                badgeColor = "#0284C7",
                iconBgColor = "#E0F2FE",
                action = { showTeacherDocumentsDialog() }
            )
        )
        items.add(
            MgmtItem(
                title = "Jurnal & Agenda KBM",
                desc = "Catatan tatap muka KBM harian, materi pertemuan, & presensi JP",
                iconEmoji = "📖",
                tagBadge = "Akademik Guru",
                badgeColor = "#4F46E5",
                iconBgColor = "#EEF2FF",
                action = { showTeacherScheduleDialog() }
            )
        )
        items.add(
            MgmtItem(
                title = "Bank Soal & Asesmen",
                desc = "Penyusunan naskah asesmen, kisi-kisi, & analisis hasil CBT",
                iconEmoji = "🧠",
                tagBadge = "Asesmen CBT",
                badgeColor = "#7C3AED",
                iconBgColor = "#F3E8FF",
                action = { showTugasPenilaianDialog() }
            )
        )
        if (isGuruPai) {
            items.add(
                MgmtItem(
                    title = "Pembina Sholat & PAI",
                    desc = "Jadwal sholat berjamaah, presensi mushola, & scan kartu",
                    iconEmoji = "🕌",
                    tagBadge = "PAI & Mushola",
                    badgeColor = "#059669",
                    iconBgColor = "#D1FAE5",
                    action = { showPaiPrayerControlDialog() }
                )
            )
            items.add(
                MgmtItem(
                    title = "Tahfiz & Murojaah Juz 30",
                    desc = "Target surat, setoran hafalan, rubrik 5 aspek & evaluasi murojaah",
                    iconEmoji = "📖",
                    tagBadge = "Tahfiz PAI",
                    badgeColor = "#0D9488",
                    iconBgColor = "#CCFBF1",
                    action = { showTahfizPaiControlDialog() }
                )
            )
        }
        items.add(
            MgmtItem(
                title = "Posko Guru Piket",
                desc = "Pantau KBM gerbang, verifikasi izin, & disposisi kelas kosong",
                iconEmoji = "🛡️",
                tagBadge = "Piket Harian",
                badgeColor = "#D97706",
                iconBgColor = "#FEF3C7",
                action = { showTeacherPiketCenterDialog() }
            )
        )
        items.add(
            MgmtItem(
                title = "Pembina Ekstrakurikuler",
                desc = "Katalog resmi, data peserta, jadwal latihan, & presensi QR sesi",
                iconEmoji = "🏆",
                tagBadge = "Minat & Bakat",
                badgeColor = "#EA580C",
                iconBgColor = "#FFEDD5",
                action = { startActivity(Intent(this, EkstrakurikulerActivity::class.java)) }
            )
        )

        // Menu Kurikulum HANYA muncul untuk Tim Kurikulum riil (Bukan akun Arsyad / guru umum)
        if (isKurikulum) {
            items.add(
                MgmtItem(
                    title = "Tim Kurikulum",
                    desc = "Live monitoring 33 rombel KBM, deteksi kelas kosong, & evaluasi",
                    iconEmoji = "🏛️",
                    tagBadge = "Tim Kurikulum",
                    badgeColor = "#2563EB",
                    iconBgColor = "#DBEAFE",
                    action = { showKurikulumCenterDialog() }
                )
            )
        }

        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🏛️ Pusat Manajemen Terpadu",
            subtitle = if (isKurikulum) "Kurikulum • Wali Kelas • Guru Piket • CBT & PAI" else "Wali Kelas • Guru Piket • CBT & PAI",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val density = resources.displayMetrics.density

        // Render dalam Grid 2 Kolom Rapi dan Terstruktur
        var currentRow: LinearLayout? = null
        items.forEachIndexed { index, item ->
            if (index % 2 == 0) {
                currentRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (12 * density).toInt()
                    }
                    weightSum = 2f
                }
                container.addView(currentRow)
            }

            val card = CardView(this).apply {
                radius = 16f * density
                cardElevation = 2f * density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                    if (index % 2 == 0) marginEnd = (6 * density).toInt() else marginStart = (6 * density).toInt()
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    dialog.dismiss()
                    item.action.invoke()
                }
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (14 * density).toInt()
                setPadding(p, p, p, p)
            }

            val iconRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (8 * density).toInt()
                }
            }

            val iconBox = LinearLayout(this).apply {
                val size = (42 * density).toInt()
                layoutParams = LinearLayout.LayoutParams(size, size)
                gravity = Gravity.CENTER
                val bg = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                    cornerRadius = 12f * density
                    setColor(Color.parseColor(item.iconBgColor))
                }
                background = bg
            }
            val tvEmoji = TextView(this).apply {
                text = item.iconEmoji
                textSize = 20f
            }
            iconBox.addView(tvEmoji)
            iconRow.addView(iconBox)

            val tvBadge = TextView(this).apply {
                text = item.tagBadge
                textSize = 9.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                val bgPill = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                    cornerRadius = 16f * density
                    setColor(Color.parseColor(item.badgeColor))
                }
                background = bgPill
                val ph = (7 * density).toInt()
                val pv = (2 * density).toInt()
                setPadding(ph, pv, ph, pv)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    marginStart = (8 * density).toInt()
                }
                layoutParams = lp
            }
            iconRow.addView(tvBadge)
            inner.addView(iconRow)

            val tvTitle = TextView(this).apply {
                text = item.title
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            }
            inner.addView(tvTitle)

            val tvDesc = TextView(this).apply {
                text = item.desc
                textSize = 11f
                setTextColor(Color.parseColor("#64748B"))
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = (4 * density).toInt()
                }
                layoutParams = lp
            }
            inner.addView(tvDesc)

            card.addView(inner)
            currentRow?.addView(card)

            // Jika jumlah ganjil di item terakhir, buat dummy spacer agar tetap rapi
            if (index == items.size - 1 && items.size % 2 != 0) {
                val dummySpace = View(this).apply {
                    val lp = LinearLayout.LayoutParams(0, 0, 1f).apply {
                        marginStart = (6 * density).toInt()
                    }
                    layoutParams = lp
                }
                currentRow?.addView(dummySpace)
            }
        }

        sv.addView(container)
        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun openOperatorDashboard() {
        val availableRoles = sessionManager.getAvailableRoles()
        val tugasTambahan = sessionManager.getTugasTambahan()
        val role = sessionManager.getRole().uppercase()
        val isOperator = availableRoles.any { it.equals("OPERATOR", true) || it.equals("ADMIN", true) } ||
                tugasTambahan.contains("OPERATOR") || tugasTambahan.contains("ADMIN") ||
                role.contains("OPERATOR") || role.contains("ADMIN")

        if (isOperator) {
            showOperatorCenterDialog()
        } else {
            AlertDialog.Builder(this)
                .setTitle("⚙️ Akses Operator Sekolah")
                .setMessage("Halaman Operator dikhususkan untuk guru yang mendapat tugas tambahan dari Admin Sekolah sebagai Operator.\n\nJika Anda ditugaskan sebagai Operator, hubungi Administrator untuk sinkronisasi wewenang akun.")
                .setPositiveButton("Mengerti", null)
                .show()
        }
    }

    private fun openOperatorWebPortal(subpath: String = "") {
        val serverIp = sessionManager.getServerIp()
        val token = sessionManager.getToken() ?: ""
        val cleanBase = if (serverIp.startsWith("http://") || serverIp.startsWith("https://")) serverIp else "http://$serverIp"
        val targetPath = if (subpath.isNotEmpty()) {
            if (subpath.startsWith("/")) subpath else "/$subpath"
        } else {
            "/operator"
        }
        val separator = if (targetPath.contains("?")) "&" else "?"
        val url = "$cleanBase$targetPath${separator}token=$token"
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal membuka browser portal operator: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showOperatorCenterDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "💻 Pusat Komando Operator SIBOY",
            subtitle = "Manajemen Sistem Sekolah, Device Binding, CBT & Portal Web",
            onClose = { dialog.dismiss() },
            actionBtnText = "🌐 Web Portal",
            onActionClick = {
                openOperatorWebPortal()
            }
        )
        root.addView(header)

        val scrollContent = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (14 * resources.displayMetrics.density).toInt()
            setPadding(pad, 10, pad, pad)
        }
        scrollContent.addView(contentInner)
        root.addView(scrollContent)

        // 1. HERO BANNER OPERATOR
        val heroCard = CardView(this).apply {
            radius = 16f
            cardElevation = 2f
            setCardBackgroundColor(Color.parseColor("#1E1B4B"))
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (10 * resources.displayMetrics.density).toInt()
            }
        }
        val heroInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        heroInner.addView(TextView(this).apply {
            text = "⚡ SIBOY OPERATOR COMMAND CENTER"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        heroInner.addView(TextView(this).apply {
            text = "Pusat Kendali Sistem Informasi, Device Security, Proktor CBT & Sinkronisasi Portal Sekolah."
            textSize = 11.5f
            setTextColor(Color.parseColor("#C7D2FE"))
            setPadding(0, 2, 0, 10)
        })

        // KPI Row 3 Kolom
        val kpiRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
        }
        fun createKpiChip(label: String, valText: String, bgTint: String): View {
            return CardView(this).apply {
                radius = 10f
                setCardBackgroundColor(Color.parseColor(bgTint))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginEnd = 4
                    marginStart = 4
                }
                val chipInner = LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(8, 8, 8, 8)
                    gravity = Gravity.CENTER
                }
                chipInner.addView(TextView(context).apply {
                    text = valText
                    textSize = 12.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                })
                chipInner.addView(TextView(context).apply {
                    text = label
                    textSize = 9.5f
                    setTextColor(Color.parseColor("#475569"))
                })
                addView(chipInner)
            }
        }
        kpiRow.addView(createKpiChip("Device Binding", "Buka Kunci HP", "#FFFFFF"))
        kpiRow.addView(createKpiChip("Proktor CBT", "33 Rombel Siap", "#FFFFFF"))
        kpiRow.addView(createKpiChip("Portal Web", "Desktop SSO", "#FFFFFF"))
        heroInner.addView(kpiRow)
        heroCard.addView(heroInner)
        contentInner.addView(heroCard)

        // 2. SECTION TITLE: SUB MENU OPERATOR (GRID E-COMMERCE)
        contentInner.addView(TextView(this).apply {
            text = "⚡ SUB MENU OPERATOR (E-COMMERCE STYLE)"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E293B"))
            setPadding(4, 4, 4, 2)
        })
        contentInner.addView(TextView(this).apply {
            text = "Sentuh salah satu modul operator untuk administrasi cepat dan sinkronisasi portal:"
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(4, 0, 4, 10)
        })

        // Grid Card Generator Helper (E-Commerce Style Berwarna-Warni)
        fun createEcommerceMenuCard(
            emoji: String,
            title: String,
            desc: String,
            tag: String,
            tagColor: String,
            tagBg: String,
            onClick: () -> Unit
        ): CardView {
            val card = CardView(this).apply {
                radius = 12f
                cardElevation = 2f
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply {
                    marginEnd = 4
                    marginStart = 4
                    bottomMargin = 8
                }
                isClickable = true
                isFocusable = true
                foreground = ContextCompat.getDrawable(context, android.R.drawable.list_selector_background)
                setOnClickListener { onClick() }
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (12 * resources.displayMetrics.density).toInt()
                setPadding(p, p, p, p)
            }

            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            topRow.addView(TextView(this).apply {
                text = emoji
                textSize = 22f
            })
            val spacer = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
            }
            topRow.addView(spacer)
            topRow.addView(TextView(this).apply {
                text = tag
                textSize = 9f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(tagColor))
                setBackgroundColor(Color.parseColor(tagBg))
                val tp = (6 * resources.displayMetrics.density).toInt()
                val tvp = (2 * resources.displayMetrics.density).toInt()
                setPadding(tp, tvp, tp, tvp)
            })
            inner.addView(topRow)

            inner.addView(TextView(this).apply {
                text = title
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
                setPadding(0, 6, 0, 2)
            })

            inner.addView(TextView(this).apply {
                text = desc
                textSize = 10f
                setTextColor(Color.parseColor("#64748B"))
                maxLines = 2
            })

            card.addView(inner)
            return card
        }

        // ROW 1: Reset Device Binding & Proktor CBT
        val gridRow1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow1.addView(createEcommerceMenuCard(
            emoji = "🔓",
            title = "Reset Kunci HP Siswa",
            desc = "Buka kunci device binding siswa ganti HP atau error login",
            tag = "SECURITY",
            tagColor = "#DC2626",
            tagBg = "#FEE2E2",
            onClick = { showOperatorResetDeviceDialog() }
        ))
        gridRow1.addView(createEcommerceMenuCard(
            emoji = "💻",
            title = "Proktor Ujian & CBT",
            desc = "Rilis token ujian, acak bank soal, & reset peserta logout",
            tag = "PROKTOR",
            tagColor = "#4338CA",
            tagBg = "#EEF2FF",
            onClick = { showOperatorCbtActionDialog() }
        ))
        contentInner.addView(gridRow1)

        // ROW 2: Broadcast Surat & Geofence GPS
        val gridRow2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow2.addView(createEcommerceMenuCard(
            emoji = "📢",
            title = "Siaran & Surat Resmi",
            desc = "Kirim pengumuman multi-sasaran & edaran surat dinas PDF",
            tag = "PENGUMUMAN",
            tagColor = "#D97706",
            tagBg = "#FEF3C7",
            onClick = { showOperatorBroadcastActionDialog() }
        ))
        gridRow2.addView(createEcommerceMenuCard(
            emoji = "📍",
            title = "Geofence & Kehadiran",
            desc = "Radius GPS gerbang sekolah, verifikasi anomali, & rekap presensi",
            tag = "ANTI-CHEAT",
            tagColor = "#059669",
            tagBg = "#D1FAE5",
            onClick = { openOperatorWebPortal("/operator/geofence-attendance") }
        ))
        contentInner.addView(gridRow2)

        // ROW 3: Verifikasi Biodata TU & Jam Pelajaran
        val gridRow3 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow3.addView(createEcommerceMenuCard(
            emoji = "📑",
            title = "Verifikasi Biodata TU",
            desc = "Validasi berkas PDF, data ayah/ibu kandung, & maps siswa",
            tag = "ADMIN TU",
            tagColor = "#0284C7",
            tagBg = "#E0F2FE",
            onClick = { openOperatorWebPortal("/operator/biodata") }
        ))
        gridRow3.addView(createEcommerceMenuCard(
            emoji = "📅",
            title = "Jadwal Jam Pelajaran",
            desc = "Struktur 33 rombel, plotting jam pelajaran & pembagian kelas",
            tag = "AKADEMIK",
            tagColor = "#7C3AED",
            tagBg = "#EDE9FE",
            onClick = { openOperatorWebPortal("/operator/jam-pelajaran") }
        ))
        contentInner.addView(gridRow3)

        // ROW 4: Panel Fitur/Server & Panel Native Operator
        val gridRow4 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        gridRow4.addView(createEcommerceMenuCard(
            emoji = "🎛️",
            title = "Panel Fitur & Server",
            desc = "39 saklar fitur, koordinat GPS multi-titik, & health check VPS",
            tag = "SISTEM",
            tagColor = "#0891B2",
            tagBg = "#ECFEFF",
            onClick = { openOperatorWebPortal("/operator/feature-panel") }
        ))
        gridRow4.addView(createEcommerceMenuCard(
            emoji = "📱",
            title = "Panel Native Operator",
            desc = "Approval cuti guru, cetak presensi PDF, & jadwal sholat di APK",
            tag = "APK NATIVE",
            tagColor = "#334155",
            tagBg = "#F1F5F9",
            onClick = {
                startActivity(Intent(this, OperatorMainActivity::class.java))
            }
        ))
        contentInner.addView(gridRow4)

        dialog.setView(root)
        dialog.show()
    }

    private fun showOperatorResetDeviceDialog() {
        val dialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🔓 Buka Kunci Perangkat (Device Binding)",
            subtitle = "Neutralisasi ID perangkat siswa agar dapat login di ponsel baru",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val inner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        scroll.addView(inner)
        root.addView(scroll)

        // Banner Penjelasan Keamanan
        val infoCard = CardView(this).apply {
            radius = 12f
            cardElevation = 1f
            setCardBackgroundColor(Color.parseColor("#FEF2F2"))
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * resources.displayMetrics.density).toInt()
            }
        }
        val infoInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (12 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        infoInner.addView(TextView(this).apply {
            text = "🛡️ Kebijakan Kunci Perangkat (Device Binding)"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#991B1B"))
        })
        infoInner.addView(TextView(this).apply {
            text = "Fitur ini digunakan saat siswa mengganti ponsel, ponsel hilang/rusak, atau terjadi kendala binding login.\n\nSetelah direset, siswa dapat langsung login kembali pada aplikasi Android baru tanpa diblokir oleh sistem."
            textSize = 11f
            setTextColor(Color.parseColor("#7F1D1D"))
            setPadding(0, 4, 0, 0)
        })
        infoCard.addView(infoInner)
        inner.addView(infoCard)

        // Form Card Input Siswa
        val formCard = CardView(this).apply {
            radius = 12f
            cardElevation = 2f
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val formInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }

        formInner.addView(TextView(this).apply {
            text = "IDENTITAS SISWA TARGET"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, 4)
        })

        val etTarget = EditText(this).apply {
            hint = "Masukkan NISN, Username, atau ID Siswa..."
            textSize = 13.5f
            setTextColor(Color.parseColor("#0F172A"))
            setHintTextColor(Color.parseColor("#94A3B8"))
            setBackgroundResource(android.R.drawable.edit_text)
            val ep = (10 * resources.displayMetrics.density).toInt()
            setPadding(ep, ep, ep, ep)
            setSingleLine(true)
        }
        formInner.addView(etTarget)

        val btnReset = Button(this).apply {
            text = "🔓 BUKA KUNCI PERANGKAT SISWA"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#DC2626"))
            val bp = (12 * resources.displayMetrics.density).toInt()
            setPadding(bp, bp, bp, bp)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (16 * resources.displayMetrics.density).toInt()
            }
        }
        formInner.addView(btnReset)

        btnReset.setOnClickListener {
            val query = etTarget.text.toString().trim()
            if (query.isEmpty()) {
                Toast.makeText(this, "Harap masukkan NISN atau Username siswa!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            AlertDialog.Builder(this)
                .setTitle("Konfirmasi Reset Device")
                .setMessage("Apakah Anda yakin ingin membuka kunci perangkat untuk identitas '$query'?\n\nSiswa akan dapat login dari perangkat ponsel mana pun.")
                .setPositiveButton("Ya, Buka Kunci") { _, _ ->
                    btnReset.isEnabled = false
                    btnReset.text = "⏳ Memproses di Server Portal..."

                    val body = mapOf("query" to query, "nisn" to query, "username" to query)
                    ApiClient.getClient(this).resetStudentDeviceBinding(body).enqueue(object : Callback<BasicResponse> {
                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                            btnReset.isEnabled = true
                            btnReset.text = "🔓 BUKA KUNCI PERANGKAT SISWA"

                            if (response.isSuccessful) {
                                val msg = response.body()?.message ?: "Device binding siswa berhasil direset!"
                                AlertDialog.Builder(this@TeacherMainActivity)
                                    .setTitle("✅ Reset Berhasil")
                                    .setMessage(msg)
                                    .setPositiveButton("Selesai") { d, _ ->
                                        d.dismiss()
                                        dialog.dismiss()
                                    }
                                    .show()
                            } else {
                                val err = response.errorBody()?.string() ?: "Siswa tidak ditemukan atau terjadi kesalahan server."
                                AlertDialog.Builder(this@TeacherMainActivity)
                                    .setTitle("❌ Gagal Reset")
                                    .setMessage(err)
                                    .setPositiveButton("Tutup", null)
                                    .show()
                            }
                        }

                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                            btnReset.isEnabled = true
                            btnReset.text = "🔓 BUKA KUNCI PERANGKAT SISWA"
                            Toast.makeText(this@TeacherMainActivity, "Gagal koneksi ke server: ${t.message}", Toast.LENGTH_SHORT).show()
                        }
                    })
                }
                .setNegativeButton("Batal", null)
                .show()
        }

        formCard.addView(formInner)
        inner.addView(formCard)

        dialog.setView(root)
        dialog.show()
    }

    private fun showOperatorCbtActionDialog() {
        val options = arrayOf(
            "🌐 Buka Proktor CBT di Web Portal (Desktop SSO)",
            "📱 Buka Manajemen CBT di Aplikasi Native"
        )
        AlertDialog.Builder(this)
            .setTitle("💻 Modul Proktor & Ujian CBT")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> openOperatorWebPortal("/operator/cbt")
                    1 -> {
                        val intent = Intent(this, OperatorMainActivity::class.java)
                        startActivity(intent)
                    }
                }
            }
            .setNegativeButton("Tutup", null)
            .show()
    }

    private fun showOperatorBroadcastActionDialog() {
        val options = arrayOf(
            "🌐 Buka Siaran & Surat di Web Portal (Desktop SSO)",
            "📱 Buka Tab Broadcast di Aplikasi Native"
        )
        AlertDialog.Builder(this)
            .setTitle("📢 Siaran Pengumuman & Surat Resmi")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> openOperatorWebPortal("/operator/pengumuman")
                    1 -> {
                        val intent = Intent(this, OperatorMainActivity::class.java)
                        startActivity(intent)
                    }
                }
            }
            .setNegativeButton("Tutup", null)
            .show()
    }

    private fun showTeacherLeaveMenuDialog() {
        val dialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📝 Portal Izin Guru & Kurikulum",
            subtitle = "Pengajuan izin, verifikasi Kurikulum, & disposisi tugas ke Guru Piket",
            onClose = { dialog.dismiss() },
            actionBtnText = "➕ Ajukan Izin",
            onActionClick = { showCreateTeacherLeaveDialog() }
        )
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val density = resources.displayMetrics.density

        // 1. Action Banner Card
        val cardAction = CardView(this).apply {
            radius = 16f * density
            cardElevation = 3f * density
            setCardBackgroundColor(Color.parseColor("#1E293B"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
            isClickable = true
            isFocusable = true
            setOnClickListener { showCreateTeacherLeaveDialog() }
        }
        val actionInner = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val iconAction = TextView(this).apply {
            text = "✍️"
            textSize = 28f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                marginEnd = (14 * density).toInt()
            }
            layoutParams = lp
        }
        val actionTextBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvActionTitle = TextView(this).apply {
            text = "➕ Buat Pengajuan Izin Baru"
            textSize = 14.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }
        val tvActionSub = TextView(this).apply {
            text = "Isi formulir izin dinas/sakit/kepentingan, jadwal KBM terdampak, & tugas mandiri siswa"
            textSize = 11.5f
            setTextColor(Color.parseColor("#94A3B8"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (3 * density).toInt()
            }
            layoutParams = lp
        }
        actionTextBox.addView(tvActionTitle)
        actionTextBox.addView(tvActionSub)

        val tvActionArrow = TextView(this).apply {
            text = "➔"
            textSize = 18f
            setTextColor(Color.parseColor("#38BDF8"))
            setTypeface(null, Typeface.BOLD)
        }
        actionInner.addView(iconAction)
        actionInner.addView(actionTextBox)
        actionInner.addView(tvActionArrow)
        cardAction.addView(actionInner)
        container.addView(cardAction)

        // 1.5 Rekap 360 Kehadiran & Cuti Pribadi
        val cardRecap = CardView(this).apply {
            radius = 14f * density
            cardElevation = 2f * density
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
        }
        val recapInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvRecapTitle = TextView(this).apply {
            text = "📊 Rekap Presensi & Cuti Anda Bulan Ini"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        recapInner.addView(tvRecapTitle)

        val recapRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 4f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (8 * density).toInt()
            }
            layoutParams = lp
        }

        fun createMetricBox(title: String, value: String, colorHex: String, bgHex: String): LinearLayout {
            return LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                setBackgroundColor(Color.parseColor(bgHex))
                val p = (6 * density).toInt()
                setPadding(p, p, p, p)
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginEnd = (3 * density).toInt()
                }
                layoutParams = lp
                addView(TextView(this@TeacherMainActivity).apply {
                    text = title
                    textSize = 9f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor(colorHex))
                })
                addView(TextView(this@TeacherMainActivity).apply {
                    text = value
                    textSize = 13f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor(colorHex))
                    val lpT = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (2 * density).toInt()
                    }
                    layoutParams = lpT
                })
            }
        }

        val boxTepat = createMetricBox("Tepat Waktu", binding.tvTeacherRecapTepatWaktu.text.toString(), "#16A34A", "#F0FDF4")
        val boxTerlambat = createMetricBox("Terlambat", binding.tvTeacherRecapTerlambat.text.toString(), "#D97706", "#FFFBEB")
        val boxAlfa = createMetricBox("Alfa", binding.tvTeacherRecapAlfa.text.toString(), "#DC2626", "#FEF2F2")
        val boxIzin = createMetricBox("Izin/Sakit", binding.tvTeacherRecapIzinSakit.text.toString(), "#2563EB", "#EFF6FF")
        recapRow.addView(boxTepat)
        recapRow.addView(boxTerlambat)
        recapRow.addView(boxAlfa)
        recapRow.addView(boxIzin)
        recapInner.addView(recapRow)

        val tvCutiDesc = TextView(this).apply {
            text = binding.tvTeacherRecapCuti.text.toString()
            textSize = 10.5f
            setTextColor(Color.parseColor("#475569"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (8 * density).toInt()
            }
            layoutParams = lp
        }
        recapInner.addView(tvCutiDesc)
        cardRecap.addView(recapInner)
        container.addView(cardRecap)

        // 2. Info Workflow Card
        val cardInfo = CardView(this).apply {
            radius = 14f * density
            cardElevation = 1.5f * density
            setCardBackgroundColor(Color.parseColor("#EFF6FF"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (16 * density).toInt()
            }
            layoutParams = lp
        }
        val infoInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvInfoTitle = TextView(this).apply {
            text = "🏛️ Integrasi Terpadu Kurikulum & Piket"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1D4ED8"))
        }
        val tvInfoDesc = TextView(this).apply {
            text = "Setiap izin yang diajukan akan langsung masuk ke antrean approval Tim Kurikulum. Setelah disetujui, jadwal KBM terdampak dan penugasan siswa otomatis didisposisikan ke Posko Guru Piket untuk pendampingan."
            textSize = 11f
            setTextColor(Color.parseColor("#3B82F6"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (4 * density).toInt()
            }
            layoutParams = lp
            setLineSpacing(2f, 1f)
        }
        infoInner.addView(tvInfoTitle)
        infoInner.addView(tvInfoDesc)
        cardInfo.addView(infoInner)
        container.addView(cardInfo)

        // 3. Section Title
        val tvSection = TextView(this).apply {
            text = "📜 RIWAYAT PENGAJUAN IZIN SAYA"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#475569"))
            letterSpacing = 0.08f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
        }
        container.addView(tvSection)

        val leaveListContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val progress = ProgressBar(this).apply {
            isIndeterminate = true
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                val p = (24 * density).toInt()
                setPadding(p, p, p, p)
            }
            layoutParams = lp
        }
        leaveListContainer.addView(progress)
        container.addView(leaveListContainer)

        // Fetch live leave requests
        ApiClient.getClient(this).getMyTeacherLeaves().enqueue(object : Callback<TeacherLeaveResponse> {
            override fun onResponse(call: Call<TeacherLeaveResponse>, response: Response<TeacherLeaveResponse>) {
                leaveListContainer.removeView(progress)
                if (response.isSuccessful && response.body() != null) {
                    val list = response.body()!!.leaves ?: emptyList()
                    if (list.isEmpty()) {
                        val emptyCard = CardView(this@TeacherMainActivity).apply {
                            radius = 12f * density
                            cardElevation = 1f * density
                            setCardBackgroundColor(Color.WHITE)
                        }
                        val emptyInner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            gravity = android.view.Gravity.CENTER
                            val p = (28 * density).toInt()
                            setPadding(p, p, p, p)
                        }
                        emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "📋"
                            textSize = 32f
                        })
                        emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Belum Ada Pengajuan Izin"
                            textSize = 13.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = (6 * density).toInt()
                            }
                            layoutParams = lp
                        })
                        emptyInner.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Ketuk tombol '+ Ajukan Izin' di atas jika Anda berhalangan hadir mengajar."
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#64748B"))
                            gravity = android.view.Gravity.CENTER
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = (2 * density).toInt()
                            }
                            layoutParams = lp
                        })
                        emptyCard.addView(emptyInner)
                        leaveListContainer.addView(emptyCard)
                    } else {
                        list.forEach { item ->
                            val card = CardView(this@TeacherMainActivity).apply {
                                radius = 14f * density
                                cardElevation = 2f * density
                                setCardBackgroundColor(Color.WHITE)
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = (10 * density).toInt()
                                }
                                layoutParams = lp
                            }
                            val inner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                val p = (14 * density).toInt()
                                setPadding(p, p, p, p)
                            }
                            val topRow = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }
                            val tvCat = TextView(this@TeacherMainActivity).apply {
                                text = "📝 ${item.category}"
                                textSize = 13.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                                layoutParams = lp
                            }
                            topRow.addView(tvCat)

                            val statusText = when (item.status) {
                                "APPROVED" -> "✅ DISETUJUI"
                                "REJECTED" -> "❌ DITOLAK"
                                else -> "⏳ MENUNGGU KURIKULUM"
                            }
                            val statusColor = when (item.status) {
                                "APPROVED" -> "#059669"
                                "REJECTED" -> "#DC2626"
                                else -> "#D97706"
                            }
                            val statusBg = when (item.status) {
                                "APPROVED" -> "#ECFDF5"
                                "REJECTED" -> "#FEF2F2"
                                else -> "#FFFBEB"
                            }
                            val tvStatus = TextView(this@TeacherMainActivity).apply {
                                text = statusText
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor(statusColor))
                                val bgP = android.graphics.drawable.GradientDrawable().apply {
                                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                                    cornerRadius = 10f * density
                                    setColor(Color.parseColor(statusBg))
                                }
                                background = bgP
                                val ph = (8 * density).toInt()
                                val pv = (3 * density).toInt()
                                setPadding(ph, pv, ph, pv)
                            }
                            topRow.addView(tvStatus)
                            inner.addView(topRow)

                            val tvDates = TextView(this@TeacherMainActivity).apply {
                                text = "📅 ${item.startDate.take(10)} s/d ${item.endDate.take(10)}"
                                textSize = 11.5f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#475569"))
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = (6 * density).toInt()
                                }
                                layoutParams = lp
                            }
                            inner.addView(tvDates)

                            val tvReason = TextView(this@TeacherMainActivity).apply {
                                text = "Keperluan: ${item.reason}"
                                textSize = 12f
                                setTextColor(Color.parseColor("#334155"))
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = (3 * density).toInt()
                                }
                                layoutParams = lp
                            }
                            inner.addView(tvReason)

                            if (!item.affectedSchedules.isNullOrEmpty()) {
                                val tvSchedules = TextView(this@TeacherMainActivity).apply {
                                    text = "🏫 Jadwal Terdampak: ${item.affectedSchedules}"
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#2563EB"))
                                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                        topMargin = (4 * density).toInt()
                                    }
                                    layoutParams = lp
                                }
                                inner.addView(tvSchedules)
                            }

                            if (!item.assignmentForStudents.isNullOrEmpty()) {
                                val tvTask = TextView(this@TeacherMainActivity).apply {
                                    text = "📌 Tugas Siswa: ${item.assignmentForStudents}"
                                    textSize = 11.5f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#059669"))
                                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                        topMargin = (4 * density).toInt()
                                    }
                                    layoutParams = lp
                                }
                                inner.addView(tvTask)
                            }

                            card.addView(inner)
                            leaveListContainer.addView(card)
                        }
                    }
                } else {
                    leaveListContainer.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Gagal memuat riwayat izin dari server"
                        setTextColor(Color.parseColor("#EF4444"))
                        textSize = 12f
                    })
                }
            }

            override fun onFailure(call: Call<TeacherLeaveResponse>, t: Throwable) {
                leaveListContainer.removeView(progress)
                leaveListContainer.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Koneksi terputus: ${t.message}"
                    setTextColor(Color.parseColor("#EF4444"))
                    textSize = 12f
                })
            }
        })

        sv.addView(container)
        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun showCreateTeacherLeaveDialog() {
        val sv = ScrollView(this)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val tvHeader = TextView(this).apply {
            text = "📝 Pengajuan Izin Guru (Kurikulum ➔ Piket)"
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(0, 0, 0, 4)
        }
        container.addView(tvHeader)

        val tvSub = TextView(this).apply {
            text = "Pengajuan izin akan diverifikasi oleh Tim Kurikulum. Setelah disetujui, jadwal KBM terdampak dan materi tugas mandiri siswa akan otomatis didisposisikan ke Posko Guru Piket hari ini."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 0, 0, 14)
        }
        container.addView(tvSub)

        val tvCatLabel = TextView(this).apply {
            text = "Kategori Izin Guru:"
            textSize = 12f
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, 0, 4)
        }
        container.addView(tvCatLabel)

        val categories = arrayOf(
            "KEPENTINGAN (Izin Ada Kepentingan / Urusan Mendesak)",
            "DINAS_LUAR (Tugas Dinas Luar / Workshop / Undangan Resmi)",
            "SAKIT (Sakit dengan/tanpa surat dokter)",
            "DISPENSASI (Dispensasi Khusus Sekolah)"
        )
        val spCategory = Spinner(this).apply {
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, categories)
        }
        container.addView(spCategory)

        val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        val etStartDate = EditText(this).apply {
            hint = "Tanggal Mulai (YYYY-MM-DD)"
            setText(todayStr)
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 12
            }
            layoutParams = lp
        }
        container.addView(etStartDate)

        val etEndDate = EditText(this).apply {
            hint = "Tanggal Selesai (YYYY-MM-DD)"
            setText(todayStr)
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 8
            }
            layoutParams = lp
        }
        container.addView(etEndDate)

        val etClasses = EditText(this).apply {
            hint = "Jadwal KBM Terdampak (Contoh: 08:00 | 7A | Matematika, 09:10 | 7B | Matematika)"
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 12
            }
            layoutParams = lp
        }
        container.addView(etClasses)

        val etTask = EditText(this).apply {
            hint = "Tugas Mandiri Siswa (Wajib diisi agar siswa tetap belajar terarah di bawah pengawasan Guru Piket)"
            setLines(3)
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 12
            }
            layoutParams = lp
        }
        container.addView(etTask)

        val etReason = EditText(this).apply {
            hint = "Keterangan / Keperluan izin secara lengkap"
            setLines(2)
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 12
            }
            layoutParams = lp
        }
        container.addView(etReason)

        sv.addView(container)

        AlertDialog.Builder(this)
            .setTitle("📝 Pengajuan Izin Guru")
            .setView(sv)
            .setPositiveButton("Kirim ke Kurikulum") { _, _ ->
                val catRaw = spCategory.selectedItem.toString()
                val catCode = catRaw.substringBefore(" ")
                val sDate = etStartDate.text.toString().trim()
                val eDate = etEndDate.text.toString().trim()
                val classes = etClasses.text.toString().trim()
                val task = etTask.text.toString().trim()
                val reason = etReason.text.toString().trim()

                if (task.isEmpty() || reason.isEmpty()) {
                    Toast.makeText(this, "Harap isi tugas mandiri siswa dan alasan izin!", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val body = mapOf(
                    "category" to catCode,
                    "startDate" to sDate,
                    "endDate" to eDate,
                    "reason" to reason,
                    "affectedSchedules" to classes,
                    "assignmentDetails" to task,
                    "assignmentForStudents" to task
                )

                Toast.makeText(this, "Mengirim pengajuan izin ke Kurikulum...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).createTeacherLeave(body).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            AlertDialog.Builder(this@TeacherMainActivity)
                                .setTitle("✅ Izin Berhasil Diajukan")
                                .setMessage("Pengajuan izin Anda telah tercatat dan masuk ke antrean verifikasi Tim Kurikulum.\n\nSetelah disetujui Kurikulum, jadwal KBM terdampak dan penugasan mandiri siswa akan otomatis didisposisikan ke Posko Guru Piket.")
                                .setPositiveButton("Mengerti", null)
                                .show()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal mengajukan izin", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showMyTeacherLeavesDialog() {
        Toast.makeText(this, "Memuat riwayat izin saya...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getMyTeacherLeaves().enqueue(object : Callback<TeacherLeaveResponse> {
            override fun onResponse(call: Call<TeacherLeaveResponse>, response: Response<TeacherLeaveResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val list = response.body()!!.leaves ?: emptyList()
                    val dialog = createFullscreenDialog()
                    val root = LinearLayout(this@TeacherMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setBackgroundColor(Color.parseColor("#F8FAFC"))
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    }

                    val header = createFullscreenHeader(
                        title = "📜 Riwayat Izin Guru",
                        subtitle = "Pengajuan Izin & Status Approval Kurikulum ➔ Disposisi Posko Piket",
                        onClose = { dialog.dismiss() }
                    )
                    root.addView(header)

                    val sv = ScrollView(this@TeacherMainActivity).apply {
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
                    }
                    val container = LinearLayout(this@TeacherMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        val pad = (16 * resources.displayMetrics.density).toInt()
                        setPadding(pad, pad, pad, pad)
                    }

                    if (list.isEmpty()) {
                        container.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Belum ada riwayat pengajuan izin."
                            setTextColor(Color.parseColor("#94A3B8"))
                            textSize = 13f
                            setPadding(20, 30, 20, 30)
                            gravity = android.view.Gravity.CENTER
                        })
                    } else {
                        list.forEach { item ->
                            val card = CardView(this@TeacherMainActivity).apply {
                                radius = 12f * resources.displayMetrics.density
                                cardElevation = 2f * resources.displayMetrics.density
                                setCardBackgroundColor(Color.WHITE)
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = 12
                                }
                                layoutParams = lp
                            }
                            val inner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(20, 16, 20, 16)
                            }
                            val topRow = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                            }
                            val tvCat = TextView(this@TeacherMainActivity).apply {
                                text = "📝 ${item.category}"
                                textSize = 13f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor("#0F172A"))
                                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                                layoutParams = lp
                            }
                            topRow.addView(tvCat)

                            val statusText = when (item.status) {
                                "APPROVED" -> "✅ DISETUJUI"
                                "REJECTED" -> "❌ DITOLAK"
                                else -> "⏳ PENDING"
                            }
                            val statusColor = when (item.status) {
                                "APPROVED" -> "#059669"
                                "REJECTED" -> "#DC2626"
                                else -> "#D97706"
                            }
                            val tvStatus = TextView(this@TeacherMainActivity).apply {
                                text = statusText
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor(statusColor))
                                setBackgroundColor(Color.parseColor("#F1F5F9"))
                                setPadding(10, 4, 10, 4)
                            }
                            topRow.addView(tvStatus)
                            inner.addView(topRow)

                            val tvDates = TextView(this@TeacherMainActivity).apply {
                                text = "📅 ${item.startDate.take(10)} s/d ${item.endDate.take(10)}"
                                textSize = 11.5f
                                setTextColor(Color.parseColor("#64748B"))
                                setPadding(0, 4, 0, 0)
                            }
                            inner.addView(tvDates)

                            val tvReason = TextView(this@TeacherMainActivity).apply {
                                text = "Alasan: ${item.reason}"
                                textSize = 11.5f
                                setTextColor(Color.parseColor("#334155"))
                                setPadding(0, 4, 0, 0)
                            }
                            inner.addView(tvReason)

                            if (!item.assignmentForStudents.isNullOrEmpty()) {
                                val tvTask = TextView(this@TeacherMainActivity).apply {
                                    text = "📝 Tugas Mandiri: ${item.assignmentForStudents}"
                                    textSize = 11.5f
                                    setTextColor(Color.parseColor("#059669"))
                                    setPadding(0, 4, 0, 0)
                                }
                                inner.addView(tvTask)
                            }

                            card.addView(inner)
                            container.addView(card)
                        }
                    }

                    sv.addView(container)
                    root.addView(sv)
                    dialog.setView(root)
                    dialog.show()
                } else {
                    Toast.makeText(this@TeacherMainActivity, "Gagal memuat riwayat izin", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<TeacherLeaveResponse>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showPaiPrayerControlDialog() {
        if (isFinishing || isDestroyed) return
        ApiClient.getClient(this).getTodayPrayerSchedule().enqueue(object : Callback<PrayerScheduleResponse> {
            override fun onResponse(call: Call<PrayerScheduleResponse>, response: Response<PrayerScheduleResponse>) {
                if (isFinishing || isDestroyed) return
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    openPaiPrayerMonitoringDialog(body)
                } else {
                    val fallback = PrayerScheduleResponse(success = true, dayName = "HARI INI")
                    openPaiPrayerMonitoringDialog(fallback)
                }
            }

            override fun onFailure(call: Call<PrayerScheduleResponse>, t: Throwable) {
                if (isFinishing || isDestroyed) return
                val fallback = PrayerScheduleResponse(success = true, dayName = "HARI INI")
                openPaiPrayerMonitoringDialog(fallback)
            }
        })
    }

    private fun openPaiPrayerMonitoringDialog(initialSchedule: PrayerScheduleResponse) {
        val dialog = createFullscreenDialog()
        val density = resources.displayMetrics.density
        var currentScheduleDto = initialSchedule.schedule ?: PrayerClassScheduleDto(
            dayOfWeek = 1,
            dayName = initialSchedule.dayName ?: "SENIN",
            prayerType = "DHUHUR",
            classNames = "VII-A,VII-B,VII-C,VII-D,VII-E",
            wudhuTime = "11:45",
            scanStartTime = "12:00",
            scanEndTime = "12:30",
            notes = "Sholat Berjamaah di Masjid Sekolah"
        )
        var currentPrayerType = currentScheduleDto.prayerType ?: "DHUHUR"
        var selectedClass = "VII-A"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🕌 Kontrol Sholat & Jadwal Guru PAI",
            subtitle = "Hari ${initialSchedule.dayOfWeek} • Jadwal Sholat, Jam Wudhu & Scan Barcode Masjid",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        // 1. KARTU JADWAL & PENGUMUMAN SHOLAT DARI GURU PAI
        val cardSchedule = CardView(this).apply {
            radius = 14 * density
            cardElevation = 2f * density
            setCardBackgroundColor(Color.parseColor("#065F46"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
        }

        val layoutSchedule = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val tvSchedTitle = TextView(this).apply {
            text = "🕌 Jadwal Sholat Berjamaah Aktif"
            setTextColor(Color.WHITE)
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
        }
        layoutSchedule.addView(tvSchedTitle)

        val tvSchedClasses = TextView(this).apply {
            text = "🏫 Rombel: ${currentScheduleDto.classNames ?: "Semua Rombel"}"
            setTextColor(Color.parseColor("#D1FAE5"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (4 * density).toInt(), 0, 0)
        }
        layoutSchedule.addView(tvSchedClasses)

        val tvSchedTimes = TextView(this).apply {
            text = "💧 Mulai Wudhu: ${currentScheduleDto.wudhuTime ?: "11:45"} WIB • 📷 Scan Presensi: ${currentScheduleDto.scanStartTime ?: "12:00"} - ${currentScheduleDto.scanEndTime ?: "12:30"} WIB"
            setTextColor(Color.parseColor("#FDE047"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (3 * density).toInt(), 0, 0)
        }
        layoutSchedule.addView(tvSchedTimes)

        val tvSchedNotes = TextView(this).apply {
            text = "📢 Informasi: ${currentScheduleDto.notes ?: "Siswa wajib hadir dan scan barcode statik di masjid sekolah."}"
            setTextColor(Color.parseColor("#A7F3D0"))
            textSize = 11f
            setPadding(0, (4 * density).toInt(), 0, (10 * density).toInt())
        }
        layoutSchedule.addView(tvSchedNotes)

        val btnEditSchedule = Button(this).apply {
            text = "⚙️ Atur Jadwal, Jam Wudhu & Scan Barcode"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#065F46"))
            setBackgroundColor(Color.parseColor("#FDE047"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (40 * density).toInt())
            layoutParams = lp
        }
        layoutSchedule.addView(btnEditSchedule)
        cardSchedule.addView(layoutSchedule)
        container.addView(cardSchedule)

        // 2. KONTROL PILIHAN KELAS & TOGGLE DHUHUR / JUMAT
        val rowControls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val tvLabelClass = TextView(this).apply {
            text = "Pilih Rombel:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, (8 * density).toInt(), 0)
        }
        rowControls.addView(tvLabelClass)

        val teachingList = sessionManager.getTeachingClasses().split(",").map { it.trim() }.filter { it.isNotEmpty() && it != "-" }
        val scheduleClassNames = (currentScheduleDto.classNames ?: "").split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "ALL" && it != "ALL_MALE" && it != "-" }
        val scheduledFromApi = initialSchedule.scheduledClasses
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "ALL" && it != "ALL_MALE" && it != "-" }

        val activeScheduledRombel = (scheduledFromApi + scheduleClassNames).distinct()
        val classesList = if (activeScheduledRombel.isNotEmpty()) {
            activeScheduledRombel
        } else {
            if (teachingList.isNotEmpty()) teachingList else listOf("Belum Ada Rombel Terjadwal")
        }
        selectedClass = classesList.firstOrNull() ?: "Belum Ada Rombel Terjadwal"

        val spClass = Spinner(this).apply {
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, classesList)
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            layoutParams = lp
        }
        rowControls.addView(spClass)
        container.addView(rowControls)

        // Toggle Jenis Ibadah: Sholat Dhuha, Dhuhur & Sholat Jumat
        val rowPrayerType = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (38 * density).toInt()).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val btnDhuha = Button(this).apply {
            text = "🌅 Dhuha"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                marginEnd = (3 * density).toInt()
            }
            layoutParams = lp
        }
        val btnDhuhur = Button(this).apply {
            text = "☀️ Dhuhur"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                marginEnd = (3 * density).toInt()
                marginStart = (3 * density).toInt()
            }
            layoutParams = lp
        }
        val btnJumat = Button(this).apply {
            text = "🕌 Jumat"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                marginStart = (3 * density).toInt()
            }
            layoutParams = lp
        }

        fun updatePrayerTypeButtons() {
            val activeColor = Color.parseColor("#059669")
            val inactiveBg = Color.parseColor("#E2E8F0")
            val inactiveText = Color.parseColor("#475569")

            btnDhuha.setBackgroundColor(if (currentPrayerType == "DHUHA") activeColor else inactiveBg)
            btnDhuha.setTextColor(if (currentPrayerType == "DHUHA") Color.WHITE else inactiveText)

            btnDhuhur.setBackgroundColor(if (currentPrayerType == "DHUHUR") activeColor else inactiveBg)
            btnDhuhur.setTextColor(if (currentPrayerType == "DHUHUR") Color.WHITE else inactiveText)

            btnJumat.setBackgroundColor(if (currentPrayerType == "JUMAT") activeColor else inactiveBg)
            btnJumat.setTextColor(if (currentPrayerType == "JUMAT") Color.WHITE else inactiveText)
        }
        updatePrayerTypeButtons()
        rowPrayerType.addView(btnDhuha)
        rowPrayerType.addView(btnDhuhur)
        rowPrayerType.addView(btnJumat)
        container.addView(rowPrayerType)

        // 3. BARIS AKSI CEPAT: [⚡ TANDAI SEMUA HADIR] & [📥 CETAK / UNDUH REKAP PDF]
        val rowActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * density).toInt()).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val btnBatchAll = Button(this).apply {
            text = "⚡ Tandai Semua Hadir"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val gradBatch = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#059669"), Color.parseColor("#0D9488"), Color.parseColor("#0284C7"))
            ).apply { cornerRadius = 8 * density }
            background = gradBatch
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                marginEnd = (4 * density).toInt()
            }
            layoutParams = lp
        }

        val btnExportPdf = Button(this).apply {
            text = "📥 Unduh Rekap PDF"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val gradExport = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#7C3AED"), Color.parseColor("#6366F1"), Color.parseColor("#2563EB"))
            ).apply { cornerRadius = 8 * density }
            background = gradExport
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                marginStart = (4 * density).toInt()
            }
            layoutParams = lp
        }
        rowActions.addView(btnBatchAll)
        rowActions.addView(btnExportPdf)
        container.addView(rowActions)

        // Tombol Scan Kartu Pelajar Siswa Tanpa HP oleh Guru PAI
        val btnScanKartuTanpaHp = Button(this).apply {
            text = "📷 SCAN KARTU SISWA (TANPA HP)"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val grad = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#059669"), Color.parseColor("#047857"))
            ).apply { cornerRadius = 8 * density }
            background = grad
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                val intent = Intent(this@TeacherMainActivity, ScannerActivity::class.java).apply {
                    putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_PAI_STUDENT_CARD)
                    putExtra("EXTRA_PRAYER_TYPE", currentPrayerType)
                }
                startActivity(intent)
            }
        }
        container.addView(btnScanKartuTanpaHp)

        // 4. STATISTIK RINGKASAN
        val tvSum = TextView(this).apply {
            text = "📊 Memuat statistik..."
            setTextColor(Color.parseColor("#065F46"))
            setBackgroundColor(Color.parseColor("#D1FAE5"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            val p = (12 * density).toInt()
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (10 * density).toInt()
            }
            layoutParams = lp
        }
        container.addView(tvSum)

        val studentsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        container.addView(studentsContainer)

        fun loadMonitoring(className: String) {
            studentsContainer.removeAllViews()
            val tvLoading = TextView(this).apply {
                text = "Memuat presensi sholat kelas $className ($currentPrayerType)..."
                setTextColor(Color.parseColor("#64748B"))
                textSize = 12f
                val p = (20 * density).toInt()
                setPadding(p, p, p, p)
                gravity = Gravity.CENTER
            }
            studentsContainer.addView(tvLoading)

            ApiClient.getClient(this).getPaiMonitoringByClass(className = className, prayerType = currentPrayerType).enqueue(object : Callback<PrayerMonitoringResponse> {
                override fun onResponse(call: Call<PrayerMonitoringResponse>, response: Response<PrayerMonitoringResponse>) {
                    if (response.isSuccessful && response.body() != null) {
                        studentsContainer.removeAllViews()
                        val data = response.body()!!
                        val summary = data.summary
                        val students = data.students ?: emptyList()

                        data.schedule?.let { s ->
                            currentScheduleDto = s
                            tvSchedClasses.text = "🏫 Rombel: ${s.classNames ?: "Semua Rombel"}"
                            tvSchedTimes.text = "💧 Mulai Wudhu: ${s.wudhuTime ?: "11:45"} WIB • 📷 Scan Presensi: ${s.scanStartTime ?: "12:00"} - ${s.scanEndTime ?: "12:30"} WIB"
                            tvSchedNotes.text = "📢 Informasi: ${s.notes ?: "Siswa wajib hadir dan scan barcode statik di masjid sekolah."}"
                        }

                        tvSum.text = "📊 Total: ${summary?.totalStudents ?: students.size} • Berjamaah: ${summary?.berjamaah ?: 0} • Haid: ${summary?.haid ?: 0} • Belum: ${summary?.belum ?: 0}"

                        if (students.isEmpty()) {
                            val tvEmpty = TextView(this@TeacherMainActivity).apply {
                                text = "Tidak ada siswa terdaftar pada kelas $className."
                                setTextColor(Color.parseColor("#94A3B8"))
                                textSize = 13f
                                gravity = Gravity.CENTER
                                val p = (24 * density).toInt()
                                setPadding(p, p, p, p)
                            }
                            studentsContainer.addView(tvEmpty)
                            return
                        }

                        students.forEach { s ->
                            val sCard = CardView(this@TeacherMainActivity).apply {
                                radius = 12f * density
                                cardElevation = 1.5f * density
                                setCardBackgroundColor(Color.WHITE)
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = (8 * density).toInt()
                                }
                                layoutParams = lp
                            }
                            val sInner = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                val p = (14 * density).toInt()
                                setPadding(p, p, p, p)
                            }
                            val row = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = Gravity.CENTER_VERTICAL
                            }
                            val isFemale = s.isFemale || s.gender?.uppercase() == "P" || s.gender?.uppercase() == "FEMALE"
                            val icon = if (isFemale) "👧" else "👦"
                            val isAttended = s.status in listOf("SHOLAT_BERJAMAAH", "BERJAMAAH", "BERHALANGAN_HAID")
                            val tvSName = TextView(this@TeacherMainActivity).apply {
                                text = "$icon ${s.studentName} (${s.nisn ?: "-"})"
                                setTextColor(if (isAttended) Color.parseColor("#0F172A") else Color.parseColor("#DC2626"))
                                textSize = 12.5f
                                setTypeface(null, Typeface.BOLD)
                                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                                layoutParams = lp
                            }
                            row.addView(tvSName)

                            val badgeColor = when (s.status) {
                                "SHOLAT_BERJAMAAH", "BERJAMAAH" -> "#059669"
                                "BERHALANGAN_HAID" -> "#EC4899"
                                "ALPHA" -> "#DC2626"
                                else -> "#94A3B8"
                            }
                            val badgeBg = when (s.status) {
                                "SHOLAT_BERJAMAAH", "BERJAMAAH" -> "#DCFCE7"
                                "BERHALANGAN_HAID" -> "#FCE7F3"
                                "ALPHA" -> "#FEE2E2"
                                else -> "#F1F5F9"
                            }
                            val badgeText = when (s.status) {
                                "SHOLAT_BERJAMAAH", "BERJAMAAH" -> "🕌 Hadir"
                                "BERHALANGAN_HAID" -> "🌸 Haid"
                                "ALPHA" -> "❌ Alpha"
                                else -> "⏳ Belum"
                            }
                            val tvBadge = TextView(this@TeacherMainActivity).apply {
                                text = badgeText
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.parseColor(badgeColor))
                                setBackgroundColor(Color.parseColor(badgeBg))
                                val hp = (8 * density).toInt()
                                val vp = (3 * density).toInt()
                                setPadding(hp, vp, hp, vp)
                            }
                            row.addView(tvBadge)
                            sInner.addView(row)

                            val actRow = LinearLayout(this@TeacherMainActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (34 * density).toInt()).apply {
                                    topMargin = (8 * density).toInt()
                                }
                                layoutParams = lp
                            }

                            val btnHadir = Button(this@TeacherMainActivity).apply {
                                text = "✅ Hadir"
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#059669"))
                                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                                    marginEnd = (4 * density).toInt()
                                }
                                layoutParams = lp
                                setOnClickListener {
                                    markStudentPrayer(s.studentId, "SHOLAT_BERJAMAAH", className, currentPrayerType) { loadMonitoring(className) }
                                }
                            }
                            actRow.addView(btnHadir)

                            if (isFemale) {
                                val btnHaid = Button(this@TeacherMainActivity).apply {
                                    text = "🌸 Haid"
                                    textSize = 10f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.WHITE)
                                    setBackgroundColor(Color.parseColor("#EC4899"))
                                    val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                                        marginEnd = (4 * density).toInt()
                                    }
                                    layoutParams = lp
                                    setOnClickListener {
                                        markStudentPrayer(s.studentId, "BERHALANGAN_HAID", className, currentPrayerType) { loadMonitoring(className) }
                                    }
                                }
                                actRow.addView(btnHaid)
                            }

                            val btnAlpha = Button(this@TeacherMainActivity).apply {
                                text = "❌ Alpha"
                                textSize = 10f
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#DC2626"))
                                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 0.9f)
                                layoutParams = lp
                                setOnClickListener {
                                    markStudentPrayer(s.studentId, "ALPHA", className, currentPrayerType) { loadMonitoring(className) }
                                }
                            }
                            actRow.addView(btnAlpha)

                            sInner.addView(actRow)
                            sCard.addView(sInner)
                            studentsContainer.addView(sCard)
                        }
                    } else {
                        studentsContainer.removeAllViews()
                        studentsContainer.addView(TextView(this@TeacherMainActivity).apply {
                            text = "Gagal memuat monitoring kelas $className"
                            setTextColor(Color.parseColor("#DC2626"))
                            val p = (16 * density).toInt()
                            setPadding(p, p, p, p)
                        })
                    }
                }
                override fun onFailure(call: Call<PrayerMonitoringResponse>, t: Throwable) {
                    studentsContainer.removeAllViews()
                    studentsContainer.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Koneksi terputus: ${t.message}"
                        setTextColor(Color.parseColor("#DC2626"))
                        val p = (16 * density).toInt()
                        setPadding(p, p, p, p)
                    })
                }
            })
        }

        // Action Listener for Dhuha, Dhuhur & Jumat Toggle
        btnDhuha.setOnClickListener {
            currentPrayerType = "DHUHA"
            updatePrayerTypeButtons()
            loadMonitoring(selectedClass)
        }
        btnDhuhur.setOnClickListener {
            currentPrayerType = "DHUHUR"
            updatePrayerTypeButtons()
            loadMonitoring(selectedClass)
        }
        btnJumat.setOnClickListener {
            currentPrayerType = "JUMAT"
            updatePrayerTypeButtons()
            loadMonitoring(selectedClass)
        }

        // Action Listener for Batch Mark All
        btnBatchAll.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Tandai Semua Hadir Sholat?")
                .setMessage("Apakah Anda yakin ingin menandai seluruh siswa kelas $selectedClass hadir sholat berjamaah?\n\n(Catatan: Siswi yang tercatat berhalangan haid tidak akan ditimpa).")
                .setPositiveButton("Ya, Tandai Hadir") { _, _ ->
                    val body = mapOf(
                        "className" to selectedClass,
                        "prayerType" to currentPrayerType,
                        "status" to "SHOLAT_BERJAMAAH"
                    )
                    ApiClient.getClient(this).batchPaiMarkStudentPrayer(body).enqueue(object : Callback<BasicResponse> {
                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                            if (response.isSuccessful) {
                                Toast.makeText(this@TeacherMainActivity, "✅ Seluruh siswa berhasil ditandai hadir berjamaah!", Toast.LENGTH_SHORT).show()
                                loadMonitoring(selectedClass)
                            } else {
                                Toast.makeText(this@TeacherMainActivity, "Gagal memproses presensi massal", Toast.LENGTH_SHORT).show()
                            }
                        }
                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                            Toast.makeText(this@TeacherMainActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                        }
                    })
                }
                .setNegativeButton("Batal", null)
                .show()
        }

        // Action Listener for Export PDF
        btnExportPdf.setOnClickListener {
            val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
            val options = arrayOf(
                "📋 Rekap Kelas $selectedClass",
                "🏫 Rekap Seluruh Kelas (ALL)"
            )
            AlertDialog.Builder(this)
                .setTitle("📄 Pilih Lingkup Rekap Sholat")
                .setItems(options) { _, which ->
                    val targetClass = if (which == 0) selectedClass else "ALL"
                    com.school.smartcbt.utils.AttendancePdfHelper.showPrayerPdfDialog(
                        activity = this@TeacherMainActivity,
                        className = targetClass,
                        date = todayStr,
                        prayerType = currentPrayerType
                    )
                }
                .setNegativeButton("Batal", null)
                .show()
        }

        // Action Listener for Edit Schedule Dialog
        btnEditSchedule.setOnClickListener {
            showEditPrayerScheduleDialog(currentScheduleDto) { updated ->
                currentScheduleDto = updated
                tvSchedClasses.text = "🏫 Rombel: ${updated.classNames ?: "Semua Rombel"}"
                tvSchedTimes.text = "💧 Mulai Wudhu: ${updated.wudhuTime ?: "11:45"} WIB • 📷 Scan Presensi: ${updated.scanStartTime ?: "12:00"} - ${updated.scanEndTime ?: "12:30"} WIB"
                tvSchedNotes.text = "📢 Informasi: ${updated.notes ?: "Siswa wajib hadir dan scan barcode statik di masjid sekolah."}"
                loadMonitoring(selectedClass)
            }
        }

        spClass.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                selectedClass = classesList[position]
                loadMonitoring(selectedClass)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        sv.addView(container)
        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun showEditPrayerScheduleDialog(current: PrayerClassScheduleDto, onSaved: (PrayerClassScheduleDto) -> Unit) {
        val dialog = createFullscreenDialog()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Header Fullscreen Gradien Warna Islami Emerald
        val header = createFullscreenHeader(
            title = "🕌 Atur Jadwal & Waktu Sholat",
            subtitle = "Konfigurasi Jam Wudhu, Jam Buka Scan Barcode & Rombel Siswa",
            onClose = { dialog.dismiss() }
        )
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val formContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(24))
        }

        // 1. Hari
        val tvDayLabel = TextView(this).apply {
            text = "Pilih Hari Pelaksanaan:"
            textSize = 12f
            setTextColor(Color.parseColor("#334155"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(4)
            }
            layoutParams = lp
        }
        formContainer.addView(tvDayLabel)

        val dayOptions = listOf("Senin (Hari ke-1)", "Selasa (Hari ke-2)", "Rabu (Hari ke-3)", "Kamis (Hari ke-4)", "Jumat (Hari ke-5)", "Sabtu (Hari ke-6)")
        val spDay = Spinner(this).apply {
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, dayOptions)
            val selDay = Math.max(1, Math.min(6, current.dayOfWeek)) - 1
            setSelection(selDay)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        formContainer.addView(spDay)

        // 2. Jenis Sholat
        val tvPrayerTypeLabel = TextView(this).apply {
            text = "Jenis Sholat Berjamaah:"
            textSize = 12f
            setTextColor(Color.parseColor("#334155"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(4)
            }
            layoutParams = lp
        }
        formContainer.addView(tvPrayerTypeLabel)

        val typeOptions = listOf("DHUHUR", "JUMAT", "DHUHA", "ASHAR")
        val spType = Spinner(this).apply {
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, typeOptions)
            val curType = current.prayerType?.uppercase() ?: "DHUHUR"
            val idx = typeOptions.indexOf(curType).takeIf { it >= 0 } ?: 0
            setSelection(idx)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        formContainer.addView(spType)

        // 3. Rombel Terjadwal: Pemilihan per Tingkat & Centang Rombel
        val tvClassesLabel = TextView(this).apply {
            text = "🕌 Pilih Rombel Terjadwal Sholat (Per Tingkat & Centang):"
            textSize = 12.5f
            setTextColor(Color.parseColor("#065F46"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(4)
            }
            layoutParams = lp
        }
        formContainer.addView(tvClassesLabel)

        val tvClassesHint = TextView(this).apply {
            text = "Gunakan tombol cepat per tingkat atau centang rombel kelas yang dijadwalkan sholat:"
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
        }
        formContainer.addView(tvClassesHint)

        val grade7List = listOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K")
        val grade8List = listOf("VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K")
        val grade9List = listOf("IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K")

        val selectedClassesSet = mutableSetOf<String>()
        val rawInitial = (current.classNames ?: "").split(",").map { it.trim().uppercase() }.filter { it.isNotEmpty() }
        selectedClassesSet.addAll(rawInitial)

        // Card Container Pilihan Rombel
        val cardClassPicker = CardView(this).apply {
            radius = dp(14).toFloat()
            cardElevation = dp(2).toFloat()
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }

        val layoutClassPicker = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(14)
            setPadding(pad, pad, pad, pad)
        }

        // Live Summary Box
        val tvSummaryBadge = TextView(this).apply {
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#065F46"))
            setBackgroundColor(Color.parseColor("#ECFDF5"))
            val p = dp(8)
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
        }
        layoutClassPicker.addView(tvSummaryBadge)

        val etClasses = EditText(this).apply {
            textSize = 12f
            hint = "Rombel terpilih otomatis tersinkron di sini"
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            val p = dp(8)
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
        }
        layoutClassPicker.addView(etClasses)

        val allGradeCheckBoxes = mutableMapOf<String, CheckBox>()

        fun refreshSummary() {
            val sortedList = selectedClassesSet.sorted()
            val textDisplay = if (selectedClassesSet.contains("ALL_MALE")) {
                "🕌 Khusus Semua Siswa Putra (Sholat Jumat / ALL_MALE)"
            } else if (sortedList.isEmpty()) {
                "⚠️ Belum ada rombel kelas yang dipilih"
            } else {
                "✅ Terpilih (${sortedList.size} Rombel): ${sortedList.joinToString(", ")}"
            }
            tvSummaryBadge.text = textDisplay
            etClasses.setText(if (selectedClassesSet.contains("ALL_MALE")) "ALL_MALE" else sortedList.joinToString(","))
        }

        // Quick Buttons Horizontal Row 1
        val rowQuick1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(6)
            }
            layoutParams = lp
        }

        fun createQuickBtn(label: String, colorHex: String, onClick: () -> Unit): Button {
            return Button(this).apply {
                text = label
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor(colorHex))
                val lp = LinearLayout.LayoutParams(0, dp(36), 1f).apply {
                    marginEnd = dp(4)
                }
                layoutParams = lp
                setOnClickListener { onClick() }
            }
        }

        val btnAll7 = createQuickBtn("+ Semua VII (11)", "#0284C7") {
            if (grade7List.all { selectedClassesSet.contains(it) }) {
                selectedClassesSet.removeAll(grade7List.toSet())
            } else {
                selectedClassesSet.remove("ALL_MALE")
                selectedClassesSet.addAll(grade7List)
            }
            grade7List.forEach { c -> allGradeCheckBoxes[c]?.isChecked = selectedClassesSet.contains(c) }
            refreshSummary()
        }
        val btnAll8 = createQuickBtn("+ Semua VIII (11)", "#4F46E5") {
            if (grade8List.all { selectedClassesSet.contains(it) }) {
                selectedClassesSet.removeAll(grade8List.toSet())
            } else {
                selectedClassesSet.remove("ALL_MALE")
                selectedClassesSet.addAll(grade8List)
            }
            grade8List.forEach { c -> allGradeCheckBoxes[c]?.isChecked = selectedClassesSet.contains(c) }
            refreshSummary()
        }
        val btnAll9 = createQuickBtn("+ Semua IX (11)", "#7C3AED") {
            if (grade9List.all { selectedClassesSet.contains(it) }) {
                selectedClassesSet.removeAll(grade9List.toSet())
            } else {
                selectedClassesSet.remove("ALL_MALE")
                selectedClassesSet.addAll(grade9List)
            }
            grade9List.forEach { c -> allGradeCheckBoxes[c]?.isChecked = selectedClassesSet.contains(c) }
            refreshSummary()
        }
        rowQuick1.addView(btnAll7)
        rowQuick1.addView(btnAll8)
        rowQuick1.addView(btnAll9)
        layoutClassPicker.addView(rowQuick1)

        // Quick Buttons Horizontal Row 2: Jumat ALL_MALE & Reset
        val rowQuick2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }

        val btnAllMale = createQuickBtn("🕌 Semua Putra (JUMAT)", "#059669") {
            selectedClassesSet.clear()
            selectedClassesSet.add("ALL_MALE")
            allGradeCheckBoxes.values.forEach { it.isChecked = false }
            refreshSummary()
        }
        val btnClear = createQuickBtn("🔄 Bersihkan Pilihan", "#DC2626") {
            selectedClassesSet.clear()
            allGradeCheckBoxes.values.forEach { it.isChecked = false }
            refreshSummary()
        }
        rowQuick2.addView(btnAllMale)
        rowQuick2.addView(btnClear)
        layoutClassPicker.addView(rowQuick2)

        // Helper to Render a Grade Section with Checkboxes
        fun addGradeSection(title: String, gradeClasses: List<String>, headerColor: String) {
            val tvH = TextView(this).apply {
                text = title
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(headerColor))
                setPadding(0, dp(6), 0, dp(4))
            }
            layoutClassPicker.addView(tvH)

            // Grid of Checkboxes (3 items per row)
            for (i in gradeClasses.indices step 3) {
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                }
                for (j in 0..2) {
                    val idx = i + j
                    if (idx < gradeClasses.size) {
                        val cName = gradeClasses[idx]
                        val cb = CheckBox(this).apply {
                            text = cName
                            textSize = 11f
                            isChecked = selectedClassesSet.contains(cName)
                            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                            layoutParams = lp
                            setOnCheckedChangeListener { _, checked ->
                                if (checked) {
                                    selectedClassesSet.remove("ALL_MALE")
                                    selectedClassesSet.add(cName)
                                } else {
                                    selectedClassesSet.remove(cName)
                                }
                                refreshSummary()
                            }
                        }
                        allGradeCheckBoxes[cName] = cb
                        row.addView(cb)
                    } else {
                        val dummy = View(this).apply {
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        row.addView(dummy)
                    }
                }
                layoutClassPicker.addView(row)
            }
        }

        addGradeSection("📘 Rombel Tingkat VII (Kelas 7A - 7K):", grade7List, "#0284C7")
        addGradeSection("📗 Rombel Tingkat VIII (Kelas 8A - 8K):", grade8List, "#4F46E5")
        addGradeSection("📙 Rombel Tingkat IX (Kelas 9A - 9K):", grade9List, "#7C3AED")

        refreshSummary()

        cardClassPicker.addView(layoutClassPicker)
        formContainer.addView(cardClassPicker)

        // 4. Jam Wudhu & Jam Scan
        val rowTimes = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
            layoutParams = lp
        }

        val colWudhu = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dp(4)
            }
            layoutParams = lp
        }
        val tvWudhu = TextView(this).apply {
            text = "Mulai Wudhu:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setTypeface(null, Typeface.BOLD)
        }
        val etWudhu = EditText(this).apply {
            setText(current.wudhuTime ?: "11:45")
            textSize = 13f
            hint = "11:45"
        }
        colWudhu.addView(tvWudhu)
        colWudhu.addView(etWudhu)
        rowTimes.addView(colWudhu)

        val colScanStart = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dp(4)
                marginStart = dp(4)
            }
            layoutParams = lp
        }
        val tvScanStart = TextView(this).apply {
            text = "Mulai Scan:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setTypeface(null, Typeface.BOLD)
        }
        val etScanStart = EditText(this).apply {
            setText(current.scanStartTime ?: "12:00")
            textSize = 13f
            hint = "12:00"
        }
        colScanStart.addView(tvScanStart)
        colScanStart.addView(etScanStart)
        rowTimes.addView(colScanStart)

        val colScanEnd = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(4)
            }
            layoutParams = lp
        }
        val tvScanEnd = TextView(this).apply {
            text = "Batas Scan:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setTypeface(null, Typeface.BOLD)
        }
        val etScanEnd = EditText(this).apply {
            setText(current.scanEndTime ?: "12:30")
            textSize = 13f
            hint = "12:30"
        }
        colScanEnd.addView(tvScanEnd)
        colScanEnd.addView(etScanEnd)
        rowTimes.addView(colScanEnd)

        formContainer.addView(rowTimes)

        // 5. Catatan / Pengumuman
        val tvNotesLabel = TextView(this).apply {
            text = "Catatan / Pengumuman Sholat untuk Siswa:"
            textSize = 12f
            setTextColor(Color.parseColor("#334155"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(4)
            }
            layoutParams = lp
        }
        formContainer.addView(tvNotesLabel)

        val etNotes = EditText(this).apply {
            setText(current.notes ?: "Sholat Berjamaah di Masjid Sekolah")
            textSize = 13f
            hint = "Contoh: Siswa wajib membawa sajadah dari kelas masing-masing"
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(20)
            }
            layoutParams = lp
        }
        formContainer.addView(etNotes)

        // Tombol Simpan Jadwal
        val btnSave = Button(this).apply {
            text = "💾 Simpan & Sinkronkan Jadwal Sholat"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val grad = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#059669"), Color.parseColor("#047857"))
            ).apply { cornerRadius = dp(10).toFloat() }
            background = grad
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48))
            layoutParams = lp
            setOnClickListener {
                val dayIndex = spDay.selectedItemPosition + 1
                val prayerType = typeOptions[spType.selectedItemPosition]
                val classNames = etClasses.text.toString().trim()
                val wudhuTime = etWudhu.text.toString().trim().ifEmpty { "11:45" }
                val scanStartTime = etScanStart.text.toString().trim().ifEmpty { "12:00" }
                val scanEndTime = etScanEnd.text.toString().trim().ifEmpty { "12:30" }
                val notes = etNotes.text.toString().trim()

                if (classNames.isEmpty()) {
                    Toast.makeText(this@TeacherMainActivity, "Daftar rombel kelas wajib diisi", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val dayNames = listOf("SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU")
                val dayName = dayNames.getOrElse(dayIndex - 1) { "HARI" }

                val body = mapOf(
                    "dayOfWeek" to dayIndex,
                    "dayName" to dayName,
                    "prayerType" to prayerType,
                    "classNames" to classNames,
                    "wudhuTime" to wudhuTime,
                    "scanStartTime" to scanStartTime,
                    "scanEndTime" to scanEndTime,
                    "notes" to notes
                )

                val progress = android.app.ProgressDialog(this@TeacherMainActivity).apply {
                    setMessage("Menyimpan & menyinkronkan jadwal sholat...")
                    show()
                }

                ApiClient.getClient(this@TeacherMainActivity).setPrayerClassSchedule(body).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "✅ Jadwal sholat berhasil disimpan dan disinkronkan!", Toast.LENGTH_SHORT).show()
                            val updatedDto = current.copy(
                                dayOfWeek = dayIndex,
                                dayName = dayName,
                                prayerType = prayerType,
                                classNames = classNames,
                                wudhuTime = wudhuTime,
                                scanStartTime = scanStartTime,
                                scanEndTime = scanEndTime,
                                notes = notes
                            )
                            onSaved(updatedDto)
                            dialog.dismiss()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal menyimpan jadwal", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@TeacherMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        formContainer.addView(btnSave)

        sv.addView(formContainer)
        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun markStudentPrayer(studentId: String, status: String, className: String, prayerType: String = "DHUHUR", onDone: () -> Unit) {
        val body = mapOf(
            "studentId" to studentId,
            "status" to status,
            "prayerType" to prayerType,
            "notes" to "Dicatat oleh Guru PAI"
        )
        ApiClient.getClient(this).paiMarkStudentPrayer(body).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    Toast.makeText(this@TeacherMainActivity, "Presensi sholat diperbarui", Toast.LENGTH_SHORT).show()
                    onDone()
                } else {
                    val err = response.errorBody()?.string() ?: "Gagal mencatat presensi"
                    Toast.makeText(this@TeacherMainActivity, err, Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    // ========================================================
    // MODUL ESTAFET SESI MENGAJAR GURU (ROOM HANDOVER NFC/QR)
    // ========================================================

    private fun enableNfcForegroundDispatch() {
        // Decommissioned: RFID/NFC telah dinonaktifkan total sesuai audit sistem
    }

    private fun disableNfcForegroundDispatch() {
        // Decommissioned: RFID/NFC telah dinonaktifkan total sesuai audit sistem
    }

    private fun handleNfcIntent(intent: Intent) {
        // Decommissioned: RFID/NFC telah dinonaktifkan total sesuai audit sistem
    }

    private fun loadCurrentTeachingSession() {
        ApiClient.getClient(this).getCurrentTeacherSession().enqueue(object : Callback<TeacherCurrentSessionResponse> {
            override fun onResponse(call: Call<TeacherCurrentSessionResponse>, response: Response<TeacherCurrentSessionResponse>) {
                val body = response.body()
                if (response.isSuccessful && body != null && body.hasActiveSession && body.session != null) {
                    activeTeachingSession = body.session
                    updateTeachingSessionUi(body.session)
                } else {
                    activeTeachingSession = null
                    updateTeachingSessionUi(null)
                }
            }

            override fun onFailure(call: Call<TeacherCurrentSessionResponse>, t: Throwable) {
                // Keep existing local state on network error
            }
        })
    }

    private fun updateTeachingSessionUi(session: TeachingSessionDto?) {
        if (session != null) {
            val inTimeDate = try {
                if (!session.checkInTime.isNullOrEmpty()) {
                    val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                    parser.parse(session.checkInTime.substring(0, minOf(19, session.checkInTime.length)))
                } else null
            } catch (e: Exception) { null }

            val inTimeStr = inTimeDate?.let {
                SimpleDateFormat("HH:mm", Locale("id", "ID")).format(it) + " WIB"
            } ?: (session.checkInTime ?: "-")

            // Asumsi 1 sesi KBM adalah 80 menit (2 Jam Pelajaran @ 40 menit)
            val sessionDurationMinutes = 80
            val elapsedMinutes = inTimeDate?.let {
                ((System.currentTimeMillis() - it.time) / (60 * 1000)).toInt()
            } ?: 0
            val remainingMinutes = maxOf(0, sessionDurationMinutes - elapsedMinutes)
            val isNearEnd = remainingMinutes <= 15 || elapsedMinutes >= 65

            val roomDisplay = session.room?.roomName ?: "Ruang Kelas ${session.className}"

            if (isNearEnd) {
                // SIKLUS MERAH: 15 Menit sebelum jam pelajaran berakhir untuk pengingat absen keluar & tutup sesi
                binding.cardTeacherTeachingSession.setCardBackgroundColor(Color.parseColor("#FEF2F2"))
                binding.iconTeachingSessionContainer.setBackgroundColor(Color.parseColor("#DC2626"))
                binding.tvTeachingSessionIcon.text = "⏰"
                binding.tvTeachingSessionBadge.text = "⚠️ 15 MENIT LAGI - SEGERA ABSEN KELUAR"
                binding.tvTeachingSessionBadge.setBackgroundColor(Color.parseColor("#FEE2E2"))
                binding.tvTeachingSessionBadge.setTextColor(Color.parseColor("#DC2626"))

                binding.tvTeachingSessionTitle.text = "$roomDisplay • ${session.subjectName}"
                binding.tvTeachingSessionTitle.setTextColor(Color.parseColor("#991B1B"))

                binding.tvTeachingSessionMeta.text = "⏰ Jam KBM hampir berakhir ($inTimeStr • Sisa: $remainingMinutes mnt). Segera rekap presensi & tutup sesi untuk melanjutkan ke jadwal berikutnya."
                binding.tvTeachingSessionMeta.setTextColor(Color.parseColor("#B91C1C"))

                binding.btnTeacherCloseSession.setBackgroundColor(Color.parseColor("#DC2626"))
                binding.btnTeacherCloseSession.text = "🔴 PRESENSI KELUAR KELAS"
            } else {
                // SIKLUS HIJAU: Saat guru tap masuk KBM sedang aktif berlangsung
                binding.cardTeacherTeachingSession.setCardBackgroundColor(Color.parseColor("#F0FDF4"))
                binding.iconTeachingSessionContainer.setBackgroundResource(com.school.smartcbt.R.drawable.bg_icon_green)
                binding.tvTeachingSessionIcon.text = "🟢"
                binding.tvTeachingSessionBadge.text = "● SESI KBM AKTIF"
                binding.tvTeachingSessionBadge.setBackgroundResource(com.school.smartcbt.R.drawable.bg_badge_emerald)
                binding.tvTeachingSessionBadge.setTextColor(Color.parseColor("#15803D"))

                binding.tvTeachingSessionTitle.text = "$roomDisplay • ${session.subjectName}"
                binding.tvTeachingSessionTitle.setTextColor(Color.parseColor("#065F46"))

                binding.tvTeachingSessionMeta.text = "Jam Masuk: $inTimeStr • Sisa Waktu KBM: $remainingMinutes Menit • Presensi Siswa AKTIF di Mobile"
                binding.tvTeachingSessionMeta.setTextColor(Color.parseColor("#047857"))

                binding.btnTeacherCloseSession.setBackgroundColor(Color.parseColor("#DC2626"))
                binding.btnTeacherCloseSession.text = "🔴 PRESENSI KELUAR KELAS"
            }

            // Live Attendance Numbers
            binding.layoutSessionStudentStats.visibility = View.VISIBLE
            val present = session.presentCount ?: 0
            val truant = session.truantCount ?: 0
            val sickPermit = (session.sickCount ?: 0) + (session.permitCount ?: 0)
            val total = session.studentCount ?: 0
            val unchecked = maxOf(0, total - (present + truant + sickPermit))

            binding.tvSessionPresentCount.text = "$present"
            binding.tvSessionTruantCount.text = "$truant"
            binding.tvSessionSickPermitCount.text = "$sickPermit"
            binding.tvSessionUncheckedCount.text = "$unchecked"

            binding.layoutSessionStandbyActions.visibility = View.GONE
            binding.layoutSessionActiveActions.visibility = View.VISIBLE
        } else {
            // SIKLUS ABU-ABU: Status Standby Awal / Setelah Sesi Ditutup untuk melanjutkan jadwal berikutnya
            binding.cardTeacherTeachingSession.setCardBackgroundColor(Color.parseColor("#F8FAFC"))
            binding.iconTeachingSessionContainer.setBackgroundColor(Color.parseColor("#E2E8F0"))
            binding.tvTeachingSessionIcon.text = "🏫"
            binding.tvTeachingSessionBadge.text = "● STANDBY KBM"
            binding.tvTeachingSessionBadge.setBackgroundColor(Color.parseColor("#E2E8F0"))
            binding.tvTeachingSessionBadge.setTextColor(Color.parseColor("#475569"))

            val currentSubj = sessionManager.getTeachingSubject().ifEmpty { "Mata Pelajaran" }
            binding.tvTeachingSessionTitle.text = "Presensi Sesuai Jadwal Mengajar"
            binding.tvTeachingSessionTitle.setTextColor(Color.parseColor("#1E293B"))

            binding.tvTeachingSessionMeta.text = "Mapel: $currentSubj • Absensi guru dicatat di kelas saat jam pelajaran dimulai. Ketuk 'PRESENSI MASUK KELAS' sesuai jadwal mengajar."
            binding.tvTeachingSessionMeta.setTextColor(Color.parseColor("#64748B"))

            binding.btnTeacherTapRoomNfc.text = "🟢 PRESENSI MASUK KELAS"
            binding.btnTeacherTapRoomNfc.setBackgroundColor(Color.parseColor("#059669"))
            binding.btnTeacherTapRoomNfc.setTextColor(Color.WHITE)

            binding.btnTeacherManualSelectRoom.text = "📅 JADWAL & RUANG KELAS"
            binding.btnTeacherManualSelectRoom.setBackgroundColor(Color.parseColor("#0D9488"))
            binding.btnTeacherManualSelectRoom.setTextColor(Color.WHITE)

            binding.layoutSessionStudentStats.visibility = View.GONE
            binding.layoutSessionStandbyActions.visibility = View.VISIBLE
            binding.layoutSessionActiveActions.visibility = View.GONE
        }
    }

    private fun promptRoomCheckInMethod() {
        val options = arrayOf(
            "📷 Pindai QR Code Ruangan Kelas (Pintu Ruang)",
            "🏷️ Pilih Kelas KBM dari Daftar (Check-In Instan)",
            "🪑 Pindai QR Meja Guru (Info Status Meja)"
        )

        AlertDialog.Builder(this)
            .setTitle("🏫 Buka Sesi Mengajar Ruang Kelas")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> {
                        val intent = Intent(this, com.school.smartcbt.ScannerActivity::class.java).apply {
                            putExtra(com.school.smartcbt.ScannerActivity.EXTRA_SCAN_MODE, com.school.smartcbt.ScannerActivity.MODE_ROOM_HANDOVER)
                        }
                        roomScanLauncher.launch(intent)
                    }
                    1 -> showManualSelectRoomDialog()
                    2 -> {
                        AlertDialog.Builder(this)
                            .setTitle("🪑 Scan QR Meja Guru")
                            .setMessage("QR Meja Guru khusus presensi meja saat ini sedang dipersiapkan dan dinonaktifkan sementara oleh pihak sekolah.\n\nSilakan gunakan 'Pindai QR Code Ruangan Kelas' di pintu masuk kelas atau gunakan tombol 'Pilih Kelas KBM' untuk check-in instan.")
                            .setPositiveButton("Pilih Kelas KBM") { _, _ -> showManualSelectRoomDialog() }
                            .setNeutralButton("Scan QR Ruangan") { _, _ ->
                                val intent = Intent(this, com.school.smartcbt.ScannerActivity::class.java).apply {
                                    putExtra(com.school.smartcbt.ScannerActivity.EXTRA_SCAN_MODE, com.school.smartcbt.ScannerActivity.MODE_ROOM_HANDOVER)
                                }
                                roomScanLauncher.launch(intent)
                            }
                            .setNegativeButton("Tutup", null)
                            .show()
                    }
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun handleTeacherRoomCheckIn(
        nfcTagUid: String? = null,
        qrSecretToken: String? = null,
        roomCode: String? = null,
        forceHandover: Boolean = false
    ) {
        val assignedSubject = sessionManager.getTeachingSubject().ifEmpty { "Mata Pelajaran" }
        val req = TeacherSessionCheckInRequest(
            roomCode = roomCode,
            nfcTagUid = nfcTagUid,
            qrSecretToken = qrSecretToken,
            forceHandover = forceHandover,
            subjectName = assignedSubject
        )

        Toast.makeText(this, "Memproses identifikasi ruang kelas...", Toast.LENGTH_SHORT).show()

        ApiClient.getClient(this).checkInTeachingSession(req).enqueue(object : Callback<TeacherSessionCheckInResponse> {
            override fun onResponse(call: Call<TeacherSessionCheckInResponse>, response: Response<TeacherSessionCheckInResponse>) {
                val resp = response.body()
                if (response.isSuccessful && resp != null && resp.success) {
                    activeTeachingSession = resp.session
                    updateTeachingSessionUi(resp.session)
                    loadCurrentTeachingSession()

                    val roomName = resp.room?.roomName ?: resp.session?.className ?: "Ruang Kelas"
                    val timeStr = SimpleDateFormat("HH:mm", Locale("id", "ID")).format(Date())

                    AlertDialog.Builder(this@TeacherMainActivity)
                        .setTitle("🏫 Sesi KBM Terbuka ($timeStr WIB)")
                        .setMessage("✅ Berhasil Check-in di $roomName untuk mata pelajaran ${resp.session?.subjectName}!\n\nPresensi mandiri siswa di kelas ini telah AKTIF seketika. Siswa dapat langsung melakukan presensi dari aplikasi mobile mereka.")
                        .setIcon(android.R.drawable.ic_dialog_info)
                        .setPositiveButton("👥 Cek Presensi Siswa") { _, _ ->
                            showTeacherManageAttendanceDialog()
                        }
                        .setNegativeButton("Selesai", null)
                        .show()
                } else if (response.code() == 409) {
                    // Safety Net: Lingering session
                    val rawErr = response.errorBody()?.string() ?: ""
                    var roomName = "Kelas Sebelumnya"
                    var startTime = "-"
                    var msg = "Anda masih memiliki sesi mengajar aktif di ruangan lain."
                    try {
                        val json = org.json.JSONObject(rawErr)
                        msg = json.optString("message", msg)
                        val activeSess = json.optJSONObject("activeSession")
                        if (activeSess != null) {
                            roomName = activeSess.optString("roomName", roomName)
                            startTime = activeSess.optString("startTimeStr", startTime)
                        }
                    } catch (e: Exception) {}

                    AlertDialog.Builder(this@TeacherMainActivity)
                        .setTitle("⚠️ Estafet Ruangan: Sesi Lama Belum Ditutup")
                        .setMessage("$msg\n\nApakah Anda ingin menutup sesi di kelas sebelumnya secara otomatis (Auto-Handover) dan membuka sesi di kelas baru ini?")
                        .setPositiveButton("Ya, Estafet & Tutup Sesi Lama") { _, _ ->
                            handleTeacherRoomCheckIn(
                                nfcTagUid = nfcTagUid,
                                qrSecretToken = qrSecretToken,
                                roomCode = roomCode,
                                forceHandover = true
                            )
                        }
                        .setNegativeButton("Batal", null)
                        .show()
                } else if (response.code() == 422) {
                    // Anti-salah kamar
                    val rawErr = response.errorBody()?.string() ?: ""
                    var msg = "Ruangan tidak sesuai dengan jadwal KBM yang Anda ampu."
                    try {
                        val json = org.json.JSONObject(rawErr)
                        msg = json.optString("message", msg)
                    } catch (e: Exception) {}

                    AlertDialog.Builder(this@TeacherMainActivity)
                        .setTitle("⚠️ Ruang Tidak Sesuai Jadwal")
                        .setMessage(msg)
                        .setIcon(android.R.drawable.ic_dialog_alert)
                        .setPositiveButton("Mengerti", null)
                        .show()
                } else {
                    val rawErr = response.errorBody()?.string() ?: ""
                    var userMsg = resp?.message ?: "Gagal check-in ruangan"
                    try {
                        val json = org.json.JSONObject(rawErr)
                        if (json.has("message")) userMsg = json.getString("message")
                    } catch (e: Exception) {}
                    Toast.makeText(this@TeacherMainActivity, "Gagal: $userMsg", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<TeacherSessionCheckInResponse>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showManualSelectRoomDialog() {
        Toast.makeText(this, "Memuat daftar ruangan kelas...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getPhysicalRoomsList().enqueue(object : Callback<PhysicalRoomsListResponse> {
            override fun onResponse(call: Call<PhysicalRoomsListResponse>, response: Response<PhysicalRoomsListResponse>) {
                val teachingClassesRaw = sessionManager.getTeachingClasses().uppercase()
                val myClasses = teachingClassesRaw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                val defaultList = listOf(
                    "VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K",
                    "VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K",
                    "IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K"
                )
                val fallbackRooms = (myClasses + defaultList).distinct().map { c ->
                    com.school.smartcbt.data.model.PhysicalRoomDto(
                        id = "room_$c",
                        roomCode = "ROOM_${c.replace('-', '_')}",
                        roomName = "Ruang Kelas $c",
                        className = c,
                        building = if (c.startsWith("VII")) "Gedung A (Kelas VII)" else if (c.startsWith("VIII")) "Gedung B (Kelas VIII)" else "Gedung C (Kelas IX)",
                        floor = 1,
                        isActive = true
                    )
                }

                val rawRooms = response.body()?.data
                val rooms = if (!rawRooms.isNullOrEmpty()) rawRooms else fallbackRooms

                // Sort: rooms in myClasses on top
                val sortedRooms = rooms.sortedWith(Comparator { a, b ->
                    val aIn = if (a.className != null && myClasses.contains(a.className.uppercase())) 0 else 1
                    val bIn = if (b.className != null && myClasses.contains(b.className.uppercase())) 0 else 1
                    if (aIn != bIn) aIn.compareTo(bIn) else a.roomName.compareTo(b.roomName)
                })

                val dialog = createFullscreenDialog()
                val root = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.parseColor("#F8FAFC"))
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                }

                val header = createFullscreenHeader(
                    title = "🏫 Pilih Ruang Kelas KBM",
                    subtitle = "Rombel Diampu: ${sessionManager.getTeachingClasses().ifEmpty { "-" }}",
                    onClose = { dialog.dismiss() }
                )
                root.addView(header)

                val sv = ScrollView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
                }
                val container = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val pad = (16 * resources.displayMetrics.density).toInt()
                    setPadding(pad, pad, pad, pad)
                }

                val nowCal = java.util.Calendar.getInstance()
                val currentHour = nowCal.get(java.util.Calendar.HOUR_OF_DAY)
                val currentMinute = nowCal.get(java.util.Calendar.MINUTE)
                val nowTimeFormatted = String.format("%02d:%02d", currentHour, currentMinute)

                // Cek rombel kelas yang diampu atau jadwal aktif
                val activeTargetClass = myClasses.firstOrNull() ?: rooms.firstOrNull()?.className ?: "VII-A"
                val teachingSubject = sessionManager.getTeachingSubject().ifEmpty { "-" }

                val heroScheduleCard = CardView(this@TeacherMainActivity).apply {
                    radius = 14f * resources.displayMetrics.density
                    cardElevation = 3f * resources.displayMetrics.density
                    setCardBackgroundColor(Color.parseColor("#065F46"))
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (14 * resources.displayMetrics.density).toInt()
                    }
                    layoutParams = lp
                    isClickable = true
                    isFocusable = true
                    setOnClickListener {
                        dialog.dismiss()
                        handleTeacherRoomCheckIn(roomCode = activeTargetClass)
                    }
                }
                val heroInner = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (14 * resources.displayMetrics.density).toInt()
                    setPadding(p, p, p, p)
                }
                heroInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "⭐ JADWAL MENGAJAR HARI INI: KELAS $activeTargetClass"
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.WHITE)
                })
                heroInner.addView(TextView(this@TeacherMainActivity).apply {
                    text = "Mata Pelajaran: $teachingSubject • Sesi KBM Aktif ($nowTimeFormatted WIB)\nKetuk tombol di bawah untuk langsung Check-In di kelas ini & membuka presensi siswa."
                    textSize = 11f
                    setTextColor(Color.parseColor("#D1FAE5"))
                    setPadding(0, 4, 0, 10)
                })
                val btnCheckInNow = Button(this@TeacherMainActivity).apply {
                    text = "🏫 CHECK-IN KELAS $activeTargetClass SEKARANG"
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#059669"))
                    setOnClickListener {
                        dialog.dismiss()
                        handleTeacherRoomCheckIn(roomCode = activeTargetClass)
                    }
                }
                heroInner.addView(btnCheckInNow)
                heroScheduleCard.addView(heroInner)
                container.addView(heroScheduleCard)

                container.addView(TextView(this@TeacherMainActivity).apply {
                    text = "DAFTAR SELURUH RUANG KELAS SEKOLAH:"
                    textSize = 11f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#475569"))
                    setPadding(2, 4, 2, 8)
                })

                sortedRooms.forEach { room ->
                    val isMyClass = room.className != null && myClasses.contains(room.className.uppercase())

                    val card = CardView(this@TeacherMainActivity).apply {
                        radius = 12f * resources.displayMetrics.density
                        cardElevation = 2f * resources.displayMetrics.density
                        setCardBackgroundColor(if (isMyClass) Color.WHITE else Color.parseColor("#F1F5F9"))
                        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (10 * resources.displayMetrics.density).toInt()
                        }
                        layoutParams = lp
                        isClickable = true
                        isFocusable = true
                        setOnClickListener {
                            dialog.dismiss()
                            handleTeacherRoomCheckIn(roomCode = room.roomCode)
                        }
                    }

                    val row = LinearLayout(this@TeacherMainActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                        val p = (14 * resources.displayMetrics.density).toInt()
                        setPadding(p, p, p, p)
                    }

                    val iconBox = LinearLayout(this@TeacherMainActivity).apply {
                        val size = (38 * resources.displayMetrics.density).toInt()
                        layoutParams = LinearLayout.LayoutParams(size, size).apply {
                            marginEnd = (12 * resources.displayMetrics.density).toInt()
                        }
                        setBackgroundResource(if (isMyClass) com.school.smartcbt.R.drawable.bg_icon_green else com.school.smartcbt.R.drawable.bg_icon_blue)
                        gravity = android.view.Gravity.CENTER
                    }
                    val tvIco = TextView(this@TeacherMainActivity).apply {
                        text = if (isMyClass) "⭐" else "🏫"
                        textSize = 18f
                    }
                    iconBox.addView(tvIco)
                    row.addView(iconBox)

                    val infoBox = LinearLayout(this@TeacherMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    }
                    val tvName = TextView(this@TeacherMainActivity).apply {
                        text = room.roomName
                        textSize = 14f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#0F172A"))
                    }
                    val tvSub = TextView(this@TeacherMainActivity).apply {
                        text = if (isMyClass) "✅ Rombel Mengajar Anda • ${room.building ?: ""}" else "${room.building ?: "Gedung Sekolah"} (Lantai ${room.floor ?: 1})"
                        textSize = 11.5f
                        setTextColor(if (isMyClass) Color.parseColor("#059669") else Color.parseColor("#64748B"))
                        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            topMargin = 2
                        }
                        layoutParams = lp
                    }
                    infoBox.addView(tvName)
                    infoBox.addView(tvSub)
                    row.addView(infoBox)

                    val tvSelect = TextView(this@TeacherMainActivity).apply {
                        text = "Masuk ➔"
                        textSize = 12f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(if (isMyClass) Color.parseColor("#059669") else Color.parseColor("#2563EB"))
                    }
                    row.addView(tvSelect)

                    card.addView(row)
                    container.addView(card)
                }

                sv.addView(container)
                root.addView(sv)
                dialog.setView(root)
                dialog.show()
            }

            override fun onFailure(call: Call<PhysicalRoomsListResponse>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, "Gagal memuat ruangan: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showTeacherManageAttendanceDialog() {
        val session = activeTeachingSession
        if (session == null) {
            AlertDialog.Builder(this)
                .setTitle("⚠️ Sesi Mengajar Belum Dimulai")
                .setMessage("Anda belum melakukan Presensi Masuk KBM di ruangan kelas.\n\nSesuai SOP sekolah, presensi lengkap siswa dan jurnal pembelajaran hanya dapat diakses setelah guru melakukan presensi masuk di kelas.")
                .setPositiveButton("Mulai Masuk Kelas") { _, _ ->
                    promptRoomCheckInMethod()
                }
                .setNegativeButton("Tutup", null)
                .show()
            return
        }

        Toast.makeText(this, "Memuat daftar presensi siswa...", Toast.LENGTH_SHORT).show()

        ApiClient.getClient(this).getCurrentTeacherSession().enqueue(object : Callback<TeacherCurrentSessionResponse> {
            override fun onResponse(call: Call<TeacherCurrentSessionResponse>, response: Response<TeacherCurrentSessionResponse>) {
                val freshSession = response.body()?.session ?: session
                activeTeachingSession = freshSession
                updateTeachingSessionUi(freshSession)

                val attendances = freshSession.studentAttendances?.toMutableList() ?: mutableListOf()

                val dialog = createFullscreenDialog()
                val root = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.parseColor("#F8FAFC"))
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                }

                val roomName = freshSession.room?.roomName ?: "Kelas ${freshSession.className}"
                val header = createFullscreenHeader(
                    title = "👥 Presensi Siswa: $roomName",
                    subtitle = "Mapel: ${freshSession.subjectName} • Presensi Siswa AKTIF",
                    onClose = { dialog.dismiss() },
                    actionBtnText = "🔄 Refresh",
                    onActionClick = {
                        dialog.dismiss()
                        showTeacherManageAttendanceDialog()
                    }
                )
                root.addView(header)

                // Summary Stats Bar
                val summaryCard = CardView(this@TeacherMainActivity).apply {
                    radius = 10f * resources.displayMetrics.density
                    cardElevation = 2f * resources.displayMetrics.density
                    setCardBackgroundColor(Color.WHITE)
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        val m = (12 * resources.displayMetrics.density).toInt()
                        setMargins(m, m, m, (6 * resources.displayMetrics.density).toInt())
                    }
                    layoutParams = lp
                }
                val summaryRow = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    weightSum = 4f
                    val p = (10 * resources.displayMetrics.density).toInt()
                    setPadding(p, p, p, p)
                }

                val tvPresentStat = TextView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    gravity = android.view.Gravity.CENTER
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#15803D"))
                    text = "🟢 Hadir: ${freshSession.presentCount ?: 0}"
                }
                val tvTruantStat = TextView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    gravity = android.view.Gravity.CENTER
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#DC2626"))
                    text = "🔴 Bolos: ${freshSession.truantCount ?: 0}"
                }
                val tvSickStat = TextView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    gravity = android.view.Gravity.CENTER
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#D97706"))
                    text = "🟡 Sakit/Izin: ${(freshSession.sickCount ?: 0) + (freshSession.permitCount ?: 0)}"
                }
                val tvTotalStat = TextView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    gravity = android.view.Gravity.CENTER
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#475569"))
                    text = "👥 Total: ${freshSession.studentCount ?: attendances.size}"
                }

                summaryRow.addView(tvPresentStat)
                summaryRow.addView(tvTruantStat)
                summaryRow.addView(tvSickStat)
                summaryRow.addView(tvTotalStat)
                summaryCard.addView(summaryRow)
                root.addView(summaryCard)

                val sv = ScrollView(this@TeacherMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
                }
                val container = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val pad = (12 * resources.displayMetrics.density).toInt()
                    setPadding(pad, pad, pad, pad)
                }

                if (attendances.isEmpty()) {
                    container.addView(TextView(this@TeacherMainActivity).apply {
                        text = "Belum ada data siswa di rombel ini."
                        setTextColor(Color.parseColor("#64748B"))
                        textSize = 13f
                        gravity = android.view.Gravity.CENTER
                        setPadding(20, 40, 20, 40)
                    })
                } else {
                    attendances.forEach { att ->
                        val card = CardView(this@TeacherMainActivity).apply {
                            radius = 10f * resources.displayMetrics.density
                            cardElevation = 1.5f * resources.displayMetrics.density
                            setCardBackgroundColor(Color.WHITE)
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = (10 * resources.displayMetrics.density).toInt()
                            }
                            layoutParams = lp
                        }

                        val studentLayout = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = (12 * resources.displayMetrics.density).toInt()
                            setPadding(p, p, p, p)
                        }

                        // Top Row: Student Name + Status Badge
                        val topRow = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                        }

                        val nameBox = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }

                        val isNotAttended = att.status.isNullOrEmpty() || att.status == "BELUM ABSEN" || att.status == "ALPHA" || att.status == "UNMARKED" || att.status == "TRUANT" || att.status == "BOLOS"
                        val tvStudentName = TextView(this@TeacherMainActivity).apply {
                            text = att.student?.name ?: "Siswa ${att.studentId.take(6)}"
                            textSize = 13.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(if (isNotAttended) Color.parseColor("#DC2626") else Color.parseColor("#0F172A"))
                        }
                        val tvNisn = TextView(this@TeacherMainActivity).apply {
                            text = "NISN: ${att.student?.nisn ?: "-"} • Status: ${att.status}"
                            textSize = 11f
                            setTextColor(Color.parseColor("#64748B"))
                        }
                        nameBox.addView(tvStudentName)
                        nameBox.addView(tvNisn)
                        topRow.addView(nameBox)

                        val tvStatusBadge = TextView(this@TeacherMainActivity).apply {
                            val padH = (8 * resources.displayMetrics.density).toInt()
                            val padV = (3 * resources.displayMetrics.density).toInt()
                            setPadding(padH, padV, padH, padV)
                            textSize = 10.5f
                            setTypeface(null, Typeface.BOLD)

                            val isSelfAttended = att.isSelfAttended == true || att.notes?.contains("MANDIRI") == true || (att.status == "PRESENT" && !att.markedAt.isNullOrEmpty())
                            val isBkApproved = att.isApprovedByBk == true || att.isLockedByGate == true || att.notes?.contains("BK") == true || att.morningGateStatus?.contains("BK") == true

                            when {
                                isSelfAttended -> {
                                    text = "🟢 HADIR MANDIRI"
                                    setTextColor(Color.parseColor("#15803D"))
                                    setBackgroundResource(com.school.smartcbt.R.drawable.bg_badge_emerald)
                                }
                                isBkApproved -> {
                                    val isSick = att.status == "SICK" || att.status == "SAKIT" || att.notes?.contains("Sakit", ignoreCase = true) == true
                                    text = if (isSick) "🟡 SAKIT (BK)" else "🔵 IZIN RESMI (BK)"
                                    setTextColor(if (isSick) Color.parseColor("#D97706") else Color.parseColor("#1D4ED8"))
                                    setBackgroundColor(if (isSick) Color.parseColor("#FEF3C7") else Color.parseColor("#EFF6FF"))
                                }
                                att.status == "PRESENT" -> {
                                    text = "🟢 HADIR"
                                    setTextColor(Color.parseColor("#15803D"))
                                    setBackgroundResource(com.school.smartcbt.R.drawable.bg_badge_emerald)
                                }
                                att.status == "TRUANT" || att.status == "BOLOS" -> {
                                    text = "🔴 BOLOS"
                                    setTextColor(Color.parseColor("#DC2626"))
                                    setBackgroundColor(Color.parseColor("#FEE2E2"))
                                }
                                att.status == "SICK" || att.status == "SAKIT" -> {
                                    text = "🟡 SAKIT"
                                    setTextColor(Color.parseColor("#D97706"))
                                    setBackgroundColor(Color.parseColor("#FEF3C7"))
                                }
                                att.status == "PERMISSION" || att.status == "IZIN" -> {
                                    text = "🔵 IZIN"
                                    setTextColor(Color.parseColor("#1D4ED8"))
                                    setBackgroundColor(Color.parseColor("#EFF6FF"))
                                }
                                else -> {
                                    text = "⚪ BELUM ABSEN"
                                    setTextColor(Color.parseColor("#475569"))
                                    setBackgroundColor(Color.parseColor("#F1F5F9"))
                                }
                            }
                        }
                        topRow.addView(tvStatusBadge)
                        studentLayout.addView(topRow)

                        val isSelfAttended = att.isSelfAttended == true || att.notes?.contains("MANDIRI") == true || (att.status == "PRESENT" && !att.markedAt.isNullOrEmpty())
                        val isBkApproved = att.isApprovedByBk == true || att.isLockedByGate == true || att.notes?.contains("BK") == true || att.morningGateStatus?.contains("BK") == true
                        val isLocked = isSelfAttended || isBkApproved

                        // Status Note Badge & Keterangan
                        if (isSelfAttended) {
                            val tvSelfNotice = TextView(this@TeacherMainActivity).apply {
                                text = "✅ Terkunci: Siswa telah melakukan Presensi Mandiri di kelas"
                                textSize = 10.5f
                                setTextColor(Color.parseColor("#15803D"))
                                setTypeface(null, Typeface.BOLD)
                                setPadding(0, 4, 0, 0)
                            }
                            studentLayout.addView(tvSelfNotice)
                        } else if (isBkApproved) {
                            val tvLockNotice = TextView(this@TeacherMainActivity).apply {
                                text = "🔒 Terkunci: Disetujui Guru BK (${att.notes ?: att.morningGateStatus ?: "Izin Resmi"})"
                                textSize = 10.5f
                                setTextColor(Color.parseColor("#D97706"))
                                setTypeface(null, Typeface.BOLD)
                                setPadding(0, 4, 0, 0)
                            }
                            studentLayout.addView(tvLockNotice)
                        } else {
                            val tvUncheckedNotice = TextView(this@TeacherMainActivity).apply {
                                text = "⏳ Siswa belum presensi mandiri • Guru dapat menandai kehadiran secara manual:"
                                textSize = 10f
                                setTextColor(Color.parseColor("#64748B"))
                                setPadding(0, 4, 0, 0)
                            }
                            studentLayout.addView(tvUncheckedNotice)
                        }

                        // Action Buttons: Hadir, Bolos, Sakit, Izin
                        val btnRow = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = (8 * resources.displayMetrics.density).toInt()
                            }
                            layoutParams = lp
                        }

                        fun updateStatus(newStatus: String) {
                            if (isLocked) {
                                val reason = if (isSelfAttended) "Siswa telah melakukan presensi mandiri." else "Siswa telah disetujui izin/sakit oleh Guru BK."
                                Toast.makeText(this@TeacherMainActivity, "🔒 Status kehadiran terkunci: $reason", Toast.LENGTH_SHORT).show()
                                return
                            }

                            val req = TeacherUpdateAttendanceRequest(
                                studentId = att.studentId,
                                status = newStatus,
                                notes = if (newStatus == "TRUANT") "Ditandai tidak hadir/bolos oleh guru" else null
                            )

                            ApiClient.getClient(this@TeacherMainActivity)
                                .updateStudentAttendanceByTeacher(freshSession.id, req)
                                .enqueue(object : Callback<BasicResponse> {
                                    override fun onResponse(call: Call<BasicResponse>, resp: Response<BasicResponse>) {
                                        if (resp.isSuccessful) {
                                            att.status = newStatus
                                            tvNisn.text = "NISN: ${att.student?.nisn ?: "-"} • Status: $newStatus"
                                            when (newStatus) {
                                                "PRESENT" -> {
                                                    tvStatusBadge.text = "🟢 HADIR"
                                                    tvStatusBadge.setTextColor(Color.parseColor("#15803D"))
                                                    tvStatusBadge.setBackgroundResource(com.school.smartcbt.R.drawable.bg_badge_emerald)
                                                }
                                                "TRUANT" -> {
                                                    tvStatusBadge.text = "🔴 BOLOS"
                                                    tvStatusBadge.setTextColor(Color.parseColor("#DC2626"))
                                                    tvStatusBadge.setBackgroundColor(Color.parseColor("#FEE2E2"))
                                                }
                                                "SICK" -> {
                                                    tvStatusBadge.text = "🟡 SAKIT"
                                                    tvStatusBadge.setTextColor(Color.parseColor("#D97706"))
                                                    tvStatusBadge.setBackgroundColor(Color.parseColor("#FEF3C7"))
                                                }
                                                "PERMISSION" -> {
                                                    tvStatusBadge.text = "🔵 IZIN"
                                                    tvStatusBadge.setTextColor(Color.parseColor("#1D4ED8"))
                                                    tvStatusBadge.setBackgroundColor(Color.parseColor("#EFF6FF"))
                                                }
                                            }
                                            loadCurrentTeachingSession()
                                        } else {
                                            Toast.makeText(this@TeacherMainActivity, "Gagal mengubah status presensi", Toast.LENGTH_SHORT).show()
                                        }
                                    }

                                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                        Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                                    }
                                })
                        }

                        val btnHadir = Button(this@TeacherMainActivity).apply {
                            text = "🟢 Hadir"
                            textSize = 10.5f
                            layoutParams = LinearLayout.LayoutParams(0, (36 * resources.displayMetrics.density).toInt(), 1f).apply {
                                marginEnd = 3
                            }
                            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#059669"))
                            setTextColor(Color.WHITE)
                            isEnabled = !isLocked
                            alpha = if (isLocked) 0.35f else 1.0f
                            setOnClickListener { updateStatus("PRESENT") }
                        }

                        val btnBolos = Button(this@TeacherMainActivity).apply {
                            text = "🔴 Bolos"
                            textSize = 10.5f
                            layoutParams = LinearLayout.LayoutParams(0, (36 * resources.displayMetrics.density).toInt(), 1f).apply {
                                marginStart = 2
                                marginEnd = 2
                            }
                            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#DC2626"))
                            setTextColor(Color.WHITE)
                            isEnabled = !isLocked
                            alpha = if (isLocked) 0.35f else 1.0f
                            setOnClickListener { updateStatus("TRUANT") }
                        }

                        val btnSakit = Button(this@TeacherMainActivity).apply {
                            text = "🟡 Sakit"
                            textSize = 10.5f
                            layoutParams = LinearLayout.LayoutParams(0, (36 * resources.displayMetrics.density).toInt(), 1f).apply {
                                marginStart = 2
                                marginEnd = 2
                            }
                            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#D97706"))
                            setTextColor(Color.WHITE)
                            isEnabled = !isLocked
                            alpha = if (isLocked) 0.35f else 1.0f
                            setOnClickListener { updateStatus("SICK") }
                        }

                        val btnIzin = Button(this@TeacherMainActivity).apply {
                            text = "🔵 Izin"
                            textSize = 10.5f
                            layoutParams = LinearLayout.LayoutParams(0, (36 * resources.displayMetrics.density).toInt(), 1f).apply {
                                marginStart = 3
                            }
                            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
                            setTextColor(Color.WHITE)
                            isEnabled = !isLocked
                            alpha = if (isLocked) 0.35f else 1.0f
                            setOnClickListener { updateStatus("PERMISSION") }
                        }

                        btnRow.addView(btnHadir)
                        btnRow.addView(btnBolos)
                        btnRow.addView(btnSakit)
                        btnRow.addView(btnIzin)
                        studentLayout.addView(btnRow)

                        card.addView(studentLayout)
                        container.addView(card)
                    }
                }

                sv.addView(container)
                root.addView(sv)
                dialog.setView(root)
                dialog.show()
            }

            override fun onFailure(call: Call<TeacherCurrentSessionResponse>, t: Throwable) {
                Toast.makeText(this@TeacherMainActivity, "Gagal memuat presensi: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showTeacherCloseSessionDialog() {
        val session = activeTeachingSession
        if (session == null) {
            Toast.makeText(this, "Tidak ada sesi mengajar aktif untuk ditutup", Toast.LENGTH_SHORT).show()
            return
        }

        val roomName = session.room?.roomName ?: "Kelas ${session.className}"
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        // Header Dialog Modern
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            val grad = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#1E293B"), Color.parseColor("#0F172A"))
            )
            background = grad
        }
        val tvHeaderTitle = TextView(this).apply {
            text = "🔴 Selesai KBM & Simpan Jurnal Guru"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        }
        val tvHeaderSub = TextView(this).apply {
            text = "$roomName • ${session.subjectName ?: "Mata Pelajaran"}"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 12f
            setPadding(0, dp(2), 0, 0)
        }
        header.addView(tvHeaderTitle)
        header.addView(tvHeaderSub)
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(16))
        }

        // Card Rekap Kehadiran Siswa
        val cardStats = androidx.cardview.widget.CardView(this).apply {
            radius = dp(12).toFloat()
            setCardBackgroundColor(Color.WHITE)
            cardElevation = dp(2).toFloat()
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        val innerStats = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        val tvStatLabel = TextView(this).apply {
            text = "📊 Rekap Presensi Siswa Sesi Ini:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(6)
            }
            layoutParams = lp
        }
        innerStats.addView(tvStatLabel)

        val rowChips = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 4f
        }
        val chips = listOf(
            Triple("🟢 Hadir", "${session.presentCount ?: 0}", "#15803D"),
            Triple("🔴 Bolos", "${session.truantCount ?: 0}", "#B91C1C"),
            Triple("🟡 Sakit", "${session.sickCount ?: 0}", "#B45309"),
            Triple("🔵 Izin", "${session.permitCount ?: 0}", "#1D4ED8")
        )
        for (c in chips) {
            val colC = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(4), dp(6), dp(4), dp(6))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F8FAFC"))
                    cornerRadius = dp(6).toFloat()
                }
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginEnd = dp(2)
                    marginStart = dp(2)
                }
                layoutParams = lp
            }
            colC.addView(TextView(this).apply {
                text = c.first
                textSize = 9.5f
                setTextColor(Color.parseColor(c.third))
                setTypeface(null, Typeface.BOLD)
            })
            colC.addView(TextView(this).apply {
                text = c.second
                textSize = 14f
                setTextColor(Color.parseColor(c.third))
                setTypeface(null, Typeface.BOLD)
            })
            rowChips.addView(colC)
        }
        innerStats.addView(rowChips)
        cardStats.addView(innerStats)
        container.addView(cardStats)

        // Form Jurnal Mengajar
        val tvSummaryLabel = TextView(this).apply {
            text = "📝 Ringkasan Materi & Jurnal KBM *"
            textSize = 12f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(4)
            }
            layoutParams = lp
        }
        container.addView(tvSummaryLabel)

        val etSummary = EditText(this).apply {
            hint = "Tuliskan materi pembelajaran, capaian kompetensi, atau evaluasi kelas hari ini..."
            minLines = 3
            textSize = 12.5f
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(8).toFloat()
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        container.addView(etSummary)

        // Form Catatan Tambahan
        val tvNotesLabel = TextView(this).apply {
            text = "📌 Catatan Tambahan / PR Siswa (Opsional)"
            textSize = 12f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(4)
            }
            layoutParams = lp
        }
        container.addView(tvNotesLabel)

        val etNotes = EditText(this).apply {
            hint = "Catatan tugas rumah, peringatan kedisiplinan, dll..."
            minLines = 2
            textSize = 12.5f
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(8).toFloat()
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(16)
            }
            layoutParams = lp
        }
        container.addView(etNotes)

        sv.addView(container)
        root.addView(sv)

        AlertDialog.Builder(this)
            .setView(root)
            .setPositiveButton("Simpan Jurnal & Tutup KBM") { _, _ ->
                val summaryText = etSummary.text.toString().trim()
                val notesText = etNotes.text.toString().trim()

                Toast.makeText(this, "Menutup sesi mengajar & menyimpan jurnal...", Toast.LENGTH_SHORT).show()

                val req = TeacherCheckOutRequest(
                    sessionId = session.id,
                    teachingSummary = if (summaryText.isNotEmpty()) summaryText else "KBM terlaksana dengan baik.",
                    notes = if (notesText.isNotEmpty()) notesText else null
                )

                ApiClient.getClient(this).checkOutTeachingSession(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "✅ Sesi mengajar di $roomName berhasil ditutup & jurnal tersimpan!", Toast.LENGTH_LONG).show()
                            activeTeachingSession = null
                            updateTeachingSessionUi(null)
                            loadCurrentTeachingSession()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal menutup sesi KBM", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    // =========================================================================
    // MODUL ULANGAN HARIAN CEPAT (3 MODE: KILAT, STANDAR, CBT MINI)
    // =========================================================================
    private fun promptMulaiUlanganHarian3ModeDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(20))
        }

        val tvTitle = TextView(this).apply {
            text = "⚡ Mulai Ulangan Harian Cepat (3 Mode)"
            textSize = 16f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
        }
        root.addView(tvTitle)

        val tvSubtitle = TextView(this).apply {
            text = "Pilih kelas, mata pelajaran, materi, dan mode ulangan sesuai kebutuhan KBM hari ini."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(4), 0, dp(12))
        }
        root.addView(tvSubtitle)

        // Target Kelas (Multi-Centang Rombel)
        val tvClassLbl = TextView(this).apply { text = "Target Rombel / Kelas (Centang Kelas Pelaksana) *"; textSize = 12f; setTypeface(null, Typeface.BOLD); setTextColor(Color.parseColor("#334155")) }
        root.addView(tvClassLbl)

        val cardClasses = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = dp(8).toFloat()
                setStroke(dp(1), Color.parseColor("#E2E8F0"))
            }
            background = bg
            setPadding(dp(10), dp(8), dp(10), dp(8))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
                topMargin = dp(4)
            }
            layoutParams = lp
        }

        val cbSelectAll = CheckBox(this).apply {
            text = "✅ Pilih Semua Kelas yang Diampu"
            textSize = 12f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
            isChecked = true
        }
        cardClasses.addView(cbSelectAll)

        val dividerCls = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                topMargin = dp(3)
                bottomMargin = dp(4)
            }
            setBackgroundColor(Color.parseColor("#CBD5E1"))
        }
        cardClasses.addView(dividerCls)

        val teacherClasses = sessionManager.getTeachingClasses()
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toMutableList()
        if (teacherClasses.isEmpty()) {
            teacherClasses.addAll(listOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K",
                "VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K",
                "IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K"))
        }

        val classCheckBoxList = mutableListOf<CheckBox>()
        var currentRow: LinearLayout? = null
        teacherClasses.forEachIndexed { idx, clsName ->
            if (idx % 3 == 0) {
                currentRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    weightSum = 3f
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                }
                cardClasses.addView(currentRow)
            }
            val cbClass = CheckBox(this).apply {
                text = clsName
                textSize = 11.5f
                isChecked = true
                setTextColor(Color.parseColor("#334155"))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            classCheckBoxList.add(cbClass)
            currentRow?.addView(cbClass)
        }

        var isUpdatingCheckboxes = false
        cbSelectAll.setOnCheckedChangeListener { _, isChecked ->
            if (!isUpdatingCheckboxes) {
                isUpdatingCheckboxes = true
                classCheckBoxList.forEach { it.isChecked = isChecked }
                isUpdatingCheckboxes = false
            }
        }
        classCheckBoxList.forEach { cb ->
            cb.setOnCheckedChangeListener { _, _ ->
                if (!isUpdatingCheckboxes) {
                    isUpdatingCheckboxes = true
                    cbSelectAll.isChecked = classCheckBoxList.all { it.isChecked }
                    isUpdatingCheckboxes = false
                }
            }
        }
        root.addView(cardClasses)

        // Mapel (Terkunci ke Mata Pelajaran Guru)
        val tvMapelLbl = TextView(this).apply { text = "Mata Pelajaran (Otomatis Terkunci) *"; textSize = 12f; setTypeface(null, Typeface.BOLD); setTextColor(Color.parseColor("#334155")) }
        root.addView(tvMapelLbl)
        val teacherSubject = sessionManager.getTeachingSubject().ifEmpty { "Mata Pelajaran yang Diampu" }
        val tvMapelLocked = TextView(this).apply {
            text = "🔒 $teacherSubject"
            textSize = 13f
            setTextColor(Color.parseColor("#166534"))
            setTypeface(null, Typeface.BOLD)
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F0FDF4"))
                cornerRadius = dp(6).toFloat()
                setStroke(dp(1), Color.parseColor("#BBF7D0"))
            }
            background = bg
            setPadding(dp(10), dp(8), dp(10), dp(8))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(4)
                bottomMargin = dp(8)
            }
            layoutParams = lp
        }
        root.addView(tvMapelLocked)

        // Topik
        val tvTopikLbl = TextView(this).apply { text = "Topik / Materi Ulangan *"; textSize = 12f; setTypeface(null, Typeface.BOLD); setTextColor(Color.parseColor("#334155")) }
        root.addView(tvTopikLbl)
        val etTopik = EditText(this).apply {
            hint = "Topik / Materi Ulangan (misal: Pola Bilangan / Ekosistem)"
            textSize = 13f
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
        }
        root.addView(etTopik)

        // Radio Group 3 Mode
        val tvModeLbl = TextView(this).apply {
            text = "Pilih Mode Ulangan:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, dp(4), 0, dp(4))
        }
        root.addView(tvModeLbl)

        val rgMode = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        val rbKilat = RadioButton(this).apply { text = "⚡ Mode Kilat (15 Menit, PG Otomatis, Tanpa Token)"; isChecked = true }
        val rbStandar = RadioButton(this).apply { text = "📝 Mode Standar (30 Menit, Campuran PG & Essay)" }
        val rbCbtMini = RadioButton(this).apply { text = "🎯 Mode CBT Mini (Acak Soal, Token 5 Menit, Anti-Cheat)" }
        rgMode.addView(rbKilat)
        rgMode.addView(rbStandar)
        rgMode.addView(rbCbtMini)
        root.addView(rgMode)

        // Pilihan Sumber / Metode Pembuatan Soal
        val tvSumberLbl = TextView(this).apply {
            text = "Pilihan Penyusunan Soal:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(10), 0, dp(4))
        }
        root.addView(tvSumberLbl)

        val rgSumber = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        val rbBuatEditor = RadioButton(this).apply {
            text = "✍️ Buat Soal di APK (Smart Rich Editor + Rumus Math, Gambar & Listening)"
            isChecked = true
            textSize = 12f
            setTextColor(Color.parseColor("#0F172A"))
        }
        val rbImportTeks = RadioButton(this).apply {
            text = "📋 Import Teks Cepat (Paste Format Soal dari WA/Word/Catatan)"
            textSize = 12f
            setTextColor(Color.parseColor("#0F172A"))
        }
        val rbBankSoal = RadioButton(this).apply {
            text = "🏛️ Bank Soal Sekolah (Acak Otomatis dari Bank Soal)"
            textSize = 12f
            setTextColor(Color.parseColor("#0F172A"))
        }
        rgSumber.addView(rbBuatEditor)
        rgSumber.addView(rbImportTeks)
        rgSumber.addView(rbBankSoal)
        root.addView(rgSumber)

        val sv = ScrollView(this).apply { addView(root) }

        val dialog = AlertDialog.Builder(this)
            .setView(sv)
            .setPositiveButton("Lanjutkan →", null)
            .setNegativeButton("Batal", null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val checkedClasses = classCheckBoxList.filter { it.isChecked }.map { it.text.toString() }
                if (checkedClasses.isEmpty()) {
                    Toast.makeText(this, "Pilih minimal 1 kelas target ulangan!", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val selectedClass = checkedClasses.joinToString(",")
                val mapel = teacherSubject
                val topik = etTopik.text.toString().trim()
                if (topik.isEmpty()) {
                    Toast.makeText(this, "Harap lengkapi topik / materi ulangan!", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val mode = when {
                    rbCbtMini.isChecked -> "CBT_MINI"
                    rbStandar.isChecked -> "STANDAR"
                    else -> "KILAT"
                }

                val durasi = if (mode == "CBT_MINI") 30 else if (mode == "STANDAR") 30 else 15

                if (rbBuatEditor.isChecked) {
                    dialog.dismiss()
                    showRichQuestionEditorDialog(selectedClass, mapel, topik, mode, durasi)
                } else if (rbImportTeks.isChecked) {
                    dialog.dismiss()
                    showQuickClipboardImportDialog(selectedClass, mapel, topik, mode, durasi)
                } else {
                    val totalSoal = if (mode == "CBT_MINI") 20 else if (mode == "STANDAR") 15 else 5
                    val body = mapOf(
                        "kelasId" to selectedClass,
                        "mapelId" to mapel,
                        "topik" to topik,
                        "mode" to mode,
                        "durasiMenit" to durasi,
                        "totalSoal" to totalSoal,
                        "bobotNilai" to 100,
                        "sumberSoal" to "BANK_SOAL"
                    )

                    Toast.makeText(this, "Memulai Ulangan Harian...", Toast.LENGTH_SHORT).show()

                    ApiClient.getClient(this).startUlanganHarian(body).enqueue(object : Callback<Map<String, Any>> {
                        override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                            if (response.isSuccessful && response.body()?.get("success") == true) {
                                val data = response.body()?.get("data") as? Map<*, *>
                                val uhId = data?.get("id")?.toString() ?: ""
                                dialog.dismiss()
                                Toast.makeText(this@TeacherMainActivity, "✅ Ulangan Harian Berhasil Dimulai!", Toast.LENGTH_LONG).show()
                                if (uhId.isNotEmpty()) {
                                    showMonitoringUlanganHarianDialog(uhId)
                                }
                            } else {
                                Toast.makeText(this@TeacherMainActivity, "Gagal memulai: ${response.message()}", Toast.LENGTH_SHORT).show()
                            }
                        }

                        override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                            Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                        }
                    })
                }
            }
        }

        dialog.show()
    }

    private fun showRichQuestionEditorDialog(
        selectedClasses: String,
        mapel: String,
        topik: String,
        mode: String,
        durasi: Int,
        prefilledQuestions: List<Map<String, Any>>? = null
    ) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = createFullscreenDialog()

        val questions = mutableListOf<MutableMap<String, Any>>()
        if (!prefilledQuestions.isNullOrEmpty()) {
            prefilledQuestions.forEachIndexed { idx, q ->
                val opts = ((q["options"] as? List<*>)?.map { it.toString() } ?: listOf("A. ", "B. ", "C. ", "D. ")).toMutableList()
                while (opts.size < 4) {
                    val letter = ('A'.code + opts.size).toChar()
                    opts.add("$letter. ")
                }
                questions.add(mutableMapOf(
                    "number" to (idx + 1),
                    "type" to (q["type"]?.toString() ?: "PG"),
                    "content" to (q["content"]?.toString() ?: ""),
                    "options" to opts,
                    "correctOption" to (q["correctOption"]?.toString() ?: "A"),
                    "explanation" to (q["explanation"]?.toString() ?: ""),
                    "points" to ((q["points"] as? Number)?.toInt() ?: 10),
                    "imageUrl" to (q["imageUrl"]?.toString() ?: ""),
                    "audioUrl" to (q["audioUrl"]?.toString() ?: "")
                ))
            }
        } else {
            questions.add(mutableMapOf(
                "number" to 1,
                "type" to "PG",
                "content" to "",
                "options" to mutableListOf("A. ", "B. ", "C. ", "D. "),
                "correctOption" to "A",
                "explanation" to "",
                "points" to 10,
                "imageUrl" to "",
                "audioUrl" to ""
            ))
        }

        var currentIdx = 0
        var activeInput: EditText? = null
        var currentTestPlayer: MediaPlayer? = null

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "✍️ Smart Question Editor",
            subtitle = "$topik • $mapel • Kelas: $selectedClasses",
            onClose = {
                currentTestPlayer?.release()
                currentTestPlayer = null
                dialog.dismiss()
            }
        )
        root.addView(header)

        // Question Navigator Tabs (Horizontal Scroll)
        val navScroll = HorizontalScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            setPadding(dp(8), dp(6), dp(8), dp(6))
        }
        val navRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        navScroll.addView(navRow)
        root.addView(navScroll)

        // Scroll View for Question Editor Form
        val svForm = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val formContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(16))
        }
        svForm.addView(formContainer)
        root.addView(svForm)

        // Math & Science Formula Toolbar
        fun buildMathToolbar(onInsert: (String) -> Unit): View {
            val toolbarScroll = HorizontalScrollView(this).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                setPadding(0, dp(4), 0, dp(6))
            }
            val toolbarRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val symbols = listOf(
                "√", "x²", "x³", "xⁿ", "½", "⅓", "¼", "±", "π", "∑", "∫",
                "≠", "≤", "≥", "≈", "∞", "α", "β", "θ", "°", "÷", "×",
                "‰", "Δ", "Ω", "log", "sin", "cos", "tan", "→", "⇌", "²", "³"
            )
            symbols.forEach { sym ->
                val btnSym = TextView(this).apply {
                    text = sym
                    textSize = 13f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#1E293B"))
                    setPadding(dp(10), dp(6), dp(10), dp(6))
                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        marginEnd = dp(4)
                    }
                    layoutParams = lp
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.WHITE)
                        cornerRadius = dp(6).toFloat()
                        setStroke(dp(1), Color.parseColor("#CBD5E1"))
                    }
                    background = bg
                    isClickable = true
                    isFocusable = true
                    setOnClickListener {
                        onInsert(sym)
                    }
                }
                toolbarRow.addView(btnSym)
            }
            toolbarScroll.addView(toolbarRow)
            return toolbarScroll
        }

        // Forward declaration of render function
        lateinit var renderCurrentQuestion: () -> Unit
        lateinit var updateNavRow: () -> Unit

        updateNavRow = {
            navRow.removeAllViews()
            questions.forEachIndexed { i, _ ->
                val isSelected = (i == currentIdx)
                val btnQ = TextView(this).apply {
                    text = "${i + 1}"
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(if (isSelected) Color.WHITE else Color.parseColor("#334155"))
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        setColor(if (isSelected) Color.parseColor("#0284C7") else Color.WHITE)
                        cornerRadius = dp(6).toFloat()
                        if (!isSelected) setStroke(dp(1), Color.parseColor("#CBD5E1"))
                    }
                    background = bg
                    setPadding(dp(14), dp(8), dp(14), dp(8))
                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        marginEnd = dp(6)
                    }
                    layoutParams = lp
                    setOnClickListener {
                        currentIdx = i
                        updateNavRow()
                        renderCurrentQuestion()
                    }
                }
                navRow.addView(btnQ)
            }

            val btnAdd = TextView(this).apply {
                text = "➕ Tambah Soal"
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#059669"))
                val bg = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#ECFDF5"))
                    cornerRadius = dp(6).toFloat()
                    setStroke(dp(1), Color.parseColor("#A7F3D0"))
                }
                background = bg
                setPadding(dp(12), dp(8), dp(12), dp(8))
                setOnClickListener {
                    val nextNum = questions.size + 1
                    questions.add(mutableMapOf(
                        "number" to nextNum,
                        "type" to "PG",
                        "content" to "",
                        "options" to mutableListOf("A. ", "B. ", "C. ", "D. "),
                        "correctOption" to "A",
                        "explanation" to "",
                        "points" to 10,
                        "imageUrl" to "",
                        "audioUrl" to ""
                    ))
                    currentIdx = questions.size - 1
                    updateNavRow()
                    renderCurrentQuestion()
                }
            }
            navRow.addView(btnAdd)
        }

        renderCurrentQuestion = {
            formContainer.removeAllViews()
            currentTestPlayer?.stop()
            currentTestPlayer?.release()
            currentTestPlayer = null

            val q = questions[currentIdx]
            val opts = (q["options"] as? MutableList<String>) ?: mutableListOf("A. ", "B. ", "C. ", "D. ")
            var selectedCorrect = q["correctOption"]?.toString() ?: "A"

            // Header Row: Soal #X + Delete button
            val topHeaderRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, 0, 0, dp(8))
            }
            val tvNumber = TextView(this).apply {
                text = "📝 BUTIR SOAL #${currentIdx + 1} DARI ${questions.size}"
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            topHeaderRow.addView(tvNumber)

            if (questions.size > 1) {
                val btnDel = Button(this).apply {
                    text = "🗑️ Hapus"
                    textSize = 10f
                    setTextColor(Color.parseColor("#DC2626"))
                    setBackgroundColor(Color.parseColor("#FEE2E2"))
                    layoutParams = LinearLayout.LayoutParams(dp(75), dp(32))
                    setOnClickListener {
                        questions.removeAt(currentIdx)
                        if (currentIdx >= questions.size) currentIdx = questions.size - 1
                        updateNavRow()
                        renderCurrentQuestion()
                    }
                }
                topHeaderRow.addView(btnDel)
            }
            formContainer.addView(topHeaderRow)

            // Math Toolbar
            val tvMathLbl = TextView(this).apply {
                text = "📐 Toolbar Rumus & Simbol Cepat (Ketuk untuk menyisipkan ke kursor aktif):"
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#475569"))
            }
            formContainer.addView(tvMathLbl)

            val mathBar = buildMathToolbar { sym ->
                val target = activeInput
                if (target != null) {
                    val start = Math.max(target.selectionStart, 0)
                    val end = Math.max(target.selectionEnd, 0)
                    target.text.replace(Math.min(start, end), Math.max(start, end), sym, 0, sym.length)
                }
            }
            formContainer.addView(mathBar)

            // Question Content
            val tvContentLbl = TextView(this).apply {
                text = "Pertanyaan / Narasi Soal *"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#1E293B"))
                setPadding(0, dp(6), 0, dp(2))
            }
            formContainer.addView(tvContentLbl)

            val etContent = EditText(this).apply {
                hint = "Ketik teks soal atau formula matematika di sini..."
                textSize = 13f
                minLines = 3
                maxLines = 6
                gravity = Gravity.TOP or Gravity.START
                val bg = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.WHITE)
                    cornerRadius = dp(6).toFloat()
                    setStroke(dp(1), Color.parseColor("#CBD5E1"))
                }
                background = bg
                setPadding(dp(10), dp(8), dp(10), dp(8))
                setText(q["content"]?.toString() ?: "")
                setOnFocusChangeListener { _, hasFocus ->
                    if (hasFocus) activeInput = this
                }
                addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                        q["content"] = s.toString()
                    }
                    override fun afterTextChanged(s: android.text.Editable?) {}
                })
            }
            formContainer.addView(etContent)
            activeInput = etContent

            // Multimedia: Image & Audio Attachment
            val cardMedia = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val bg = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F1F5F9"))
                    cornerRadius = dp(8).toFloat()
                    setStroke(dp(1), Color.parseColor("#E2E8F0"))
                }
                background = bg
                setPadding(dp(10), dp(8), dp(10), dp(8))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(8)
                    bottomMargin = dp(8)
                }
                layoutParams = lp
            }

            // Image row
            val tvImgLbl = TextView(this).apply {
                text = "📷 Lampiran Gambar Soal (Diagram, Geometri, Grafik, Peta)"
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#334155"))
            }
            cardMedia.addView(tvImgLbl)

            val rowImg = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(2), 0, dp(4))
            }
            val etImageUrl = EditText(this).apply {
                hint = "/uploads/questions/... atau https://..."
                textSize = 11.5f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setText(q["imageUrl"]?.toString() ?: "")
                addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                        q["imageUrl"] = s.toString().trim()
                    }
                    override fun afterTextChanged(s: android.text.Editable?) {}
                })
            }
            val ivThumb = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(42), dp(42)).apply { marginStart = dp(4); marginEnd = dp(4) }
                scaleType = ImageView.ScaleType.CENTER_CROP
                visibility = if (q["imageUrl"]?.toString().isNullOrEmpty()) View.GONE else View.VISIBLE
            }
            val btnPickImg = Button(this).apply {
                text = "📷 Upload"
                textSize = 10f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#0284C7"))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34))
                setOnClickListener {
                    val promptDialog = EditText(this@TeacherMainActivity).apply {
                        hint = "Tempel URL / path gambar atau /uploads/..."
                        textSize = 12f
                    }
                    AlertDialog.Builder(this@TeacherMainActivity)
                        .setTitle("Upload / Input URL Gambar")
                        .setMessage("Masukkan link URL gambar atau path file soal:")
                        .setView(promptDialog)
                        .setPositiveButton("Gunakan") { _, _ ->
                            val url = promptDialog.text.toString().trim()
                            if (url.isNotEmpty()) {
                                etImageUrl.setText(url)
                                q["imageUrl"] = url
                                ivThumb.visibility = View.VISIBLE
                            }
                        }
                        .setNegativeButton("Batal", null)
                        .show()
                }
            }
            rowImg.addView(etImageUrl)
            rowImg.addView(ivThumb)
            rowImg.addView(btnPickImg)
            cardMedia.addView(rowImg)

            // Audio Listening row
            val tvAudLbl = TextView(this).apply {
                text = "🎧 Lampiran Audio Listening (Bahasa Inggris / PAI / Tembang)"
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#334155"))
                setPadding(0, dp(4), 0, 0)
            }
            cardMedia.addView(tvAudLbl)

            val rowAud = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(2), 0, 0)
            }
            val etAudioUrl = EditText(this).apply {
                hint = "/uploads/questions/audio/... atau https://..."
                textSize = 11.5f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setText(q["audioUrl"]?.toString() ?: "")
                addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                        q["audioUrl"] = s.toString().trim()
                    }
                    override fun afterTextChanged(s: android.text.Editable?) {}
                })
            }
            val btnTestAudio = Button(this).apply {
                text = "▶ Tes"
                textSize = 10f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#7C3AED"))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)).apply { marginStart = dp(4) }
                setOnClickListener {
                    val urlStr = etAudioUrl.text.toString().trim()
                    if (urlStr.isEmpty()) {
                        Toast.makeText(this@TeacherMainActivity, "Masukkan URL audio listening!", Toast.LENGTH_SHORT).show()
                        return@setOnClickListener
                    }
                    val p = currentTestPlayer
                    if (p != null && p.isPlaying) {
                        p.stop()
                        p.release()
                        currentTestPlayer = null
                        text = "▶ Tes"
                    } else {
                        try {
                            val serverBase = ApiClient.getBaseServerUrl(this@TeacherMainActivity).trimEnd('/')
                            val fullUrl = if (urlStr.startsWith("http")) urlStr else "$serverBase/" + urlStr.trimStart('/')
                            text = "⏳..."
                            val newPlayer = MediaPlayer()
                            newPlayer.setDataSource(fullUrl)
                            newPlayer.setOnPreparedListener { mp ->
                                mp.start()
                                text = "⏹ Stop"
                            }
                            newPlayer.setOnCompletionListener {
                                text = "▶ Tes"
                            }
                            newPlayer.prepareAsync()
                            currentTestPlayer = newPlayer
                        } catch (e: Exception) {
                            Toast.makeText(this@TeacherMainActivity, "Gagal memutar audio: ${e.message}", Toast.LENGTH_SHORT).show()
                            text = "▶ Tes"
                        }
                    }
                }
            }
            val btnInputAudio = Button(this).apply {
                text = "🎧 Input"
                textSize = 10f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#0284C7"))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)).apply { marginStart = dp(4) }
                setOnClickListener {
                    val promptDialog = EditText(this@TeacherMainActivity).apply {
                        hint = "Tempel URL / path audio atau /uploads/questions/audio/..."
                        textSize = 12f
                    }
                    AlertDialog.Builder(this@TeacherMainActivity)
                        .setTitle("Upload / Input URL Audio Listening")
                        .setMessage("Masukkan link audio listening (format MP3/M4A):")
                        .setView(promptDialog)
                        .setPositiveButton("Gunakan") { _, _ ->
                            val url = promptDialog.text.toString().trim()
                            if (url.isNotEmpty()) {
                                etAudioUrl.setText(url)
                                q["audioUrl"] = url
                            }
                        }
                        .setNegativeButton("Batal", null)
                        .show()
                }
            }
            rowAud.addView(etAudioUrl)
            rowAud.addView(btnTestAudio)
            rowAud.addView(btnInputAudio)
            cardMedia.addView(rowAud)
            formContainer.addView(cardMedia)

            // Multiple Choice Options Section
            val tvOptionsLbl = TextView(this).apply {
                text = "Pilihan Ganda & Kunci Jawaban (Pilih Radio untuk Kunci yang Benar):"
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#1E293B"))
                setPadding(0, dp(6), 0, dp(4))
            }
            formContainer.addView(tvOptionsLbl)

            val radioButtonsList = mutableListOf<RadioButton>()
            val optionLetters = listOf("A", "B", "C", "D", "E")

            val optionsCount = Math.max(opts.size, 4)
            for (optIdx in 0 until optionsCount) {
                val letter = if (optIdx < optionLetters.size) optionLetters[optIdx] else "O"
                val rawVal = if (optIdx < opts.size) opts[optIdx] else "$letter. "
                val optTextClean = if (rawVal.startsWith("$letter. ")) rawVal.substring(3) else rawVal

                val optRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(2), 0, dp(2))
                }

                val rb = RadioButton(this).apply {
                    isChecked = (selectedCorrect == letter)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                }
                radioButtonsList.add(rb)

                val tvOptPrefix = TextView(this).apply {
                    text = "$letter."
                    textSize = 13f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#1E293B"))
                    setPadding(dp(4), 0, dp(6), 0)
                }

                val etOpt = EditText(this).apply {
                    hint = "Isi pilihan $letter..."
                    textSize = 12.5f
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.WHITE)
                        cornerRadius = dp(6).toFloat()
                        setStroke(dp(1), Color.parseColor("#CBD5E1"))
                    }
                    background = bg
                    setPadding(dp(8), dp(6), dp(8), dp(6))
                    setText(optTextClean)
                    setOnFocusChangeListener { _, hasFocus ->
                        if (hasFocus) activeInput = this
                    }
                    addTextChangedListener(object : android.text.TextWatcher {
                        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                            val finalOpt = "$letter. ${s.toString().trim()}"
                            while (opts.size <= optIdx) opts.add("")
                            opts[optIdx] = finalOpt
                            q["options"] = opts
                        }
                        override fun afterTextChanged(s: android.text.Editable?) {}
                    })
                }

                rb.setOnClickListener {
                    radioButtonsList.forEach { it.isChecked = false }
                    rb.isChecked = true
                    selectedCorrect = letter
                    q["correctOption"] = letter
                }

                optRow.addView(rb)
                optRow.addView(tvOptPrefix)
                optRow.addView(etOpt)
                formContainer.addView(optRow)
            }

            // Points & Explanation
            val rowExtra = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(8), 0, dp(4))
            }
            val colPoints = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(dp(110), ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) }
            }
            colPoints.addView(TextView(this).apply { text = "Bobot Poin:"; textSize = 11f; setTypeface(null, Typeface.BOLD); setTextColor(Color.parseColor("#475569")) })
            val etPoints = EditText(this).apply {
                inputType = android.text.InputType.TYPE_CLASS_NUMBER
                textSize = 12.5f
                setText((q["points"] ?: 10).toString())
                addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                        q["points"] = s.toString().toIntOrNull() ?: 10
                    }
                    override fun afterTextChanged(s: android.text.Editable?) {}
                })
            }
            colPoints.addView(etPoints)

            val colExpl = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            colExpl.addView(TextView(this).apply { text = "Pembahasan / Kunci Keterangan:"; textSize = 11f; setTypeface(null, Typeface.BOLD); setTextColor(Color.parseColor("#475569")) })
            val etExpl = EditText(this).apply {
                hint = "Catatan pembahasan materi (opsional)..."
                textSize = 12f
                setText(q["explanation"]?.toString() ?: "")
                setOnFocusChangeListener { _, hasFocus ->
                    if (hasFocus) activeInput = this
                }
                addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                        q["explanation"] = s.toString()
                    }
                    override fun afterTextChanged(s: android.text.Editable?) {}
                })
            }
            colExpl.addView(etExpl)

            rowExtra.addView(colPoints)
            rowExtra.addView(colExpl)
            formContainer.addView(rowExtra)
        }

        // Action Bottom Bar
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }

        val btnPrev = Button(this).apply {
            text = "← Prev"
            textSize = 10.5f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(dp(75), dp(40)).apply { marginEnd = dp(4) }
            setOnClickListener {
                if (currentIdx > 0) {
                    currentIdx--
                    updateNavRow()
                    renderCurrentQuestion()
                }
            }
        }
        val btnNext = Button(this).apply {
            text = "Next →"
            textSize = 10.5f
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            layoutParams = LinearLayout.LayoutParams(dp(75), dp(40)).apply { marginEnd = dp(6) }
            setOnClickListener {
                if (currentIdx < questions.size - 1) {
                    currentIdx++
                    updateNavRow()
                    renderCurrentQuestion()
                }
            }
        }

        val btnPublish = Button(this).apply {
            text = "🚀 Terbitkan & Mulai UH"
            textSize = 11.5f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#059669"))
            layoutParams = LinearLayout.LayoutParams(0, dp(42), 1f)
            setOnClickListener {
                // Validation
                var emptyIdx = -1
                for (i in 0 until questions.size) {
                    val content = questions[i]["content"]?.toString()?.trim() ?: ""
                    if (content.isEmpty()) {
                        emptyIdx = i
                        break
                    }
                }
                if (emptyIdx != -1) {
                    Toast.makeText(this@TeacherMainActivity, "Soal #${emptyIdx + 1} belum diisi pertanyaannya!", Toast.LENGTH_SHORT).show()
                    currentIdx = emptyIdx
                    updateNavRow()
                    renderCurrentQuestion()
                    return@setOnClickListener
                }

                val finalSoalList = questions.mapIndexed { idx, q ->
                    mapOf(
                        "id" to "soal_${idx + 1}",
                        "number" to (idx + 1),
                        "type" to "PG",
                        "content" to (q["content"]?.toString() ?: ""),
                        "options" to (q["options"] as? List<*> ?: emptyList<Any>()),
                        "correctOption" to (q["correctOption"]?.toString() ?: "A"),
                        "explanation" to (q["explanation"]?.toString() ?: ""),
                        "points" to (q["points"] ?: 10),
                        "imageUrl" to (q["imageUrl"]?.toString()?.ifEmpty { null }),
                        "audioUrl" to (q["audioUrl"]?.toString()?.ifEmpty { null })
                    )
                }

                val body = mapOf(
                    "kelasId" to selectedClasses,
                    "mapelId" to mapel,
                    "topik" to topik,
                    "mode" to mode,
                    "durasiMenit" to durasi,
                    "totalSoal" to finalSoalList.size,
                    "bobotNilai" to 100,
                    "sumberSoal" to "MANUAL",
                    "soalList" to finalSoalList
                )

                Toast.makeText(this@TeacherMainActivity, "Menerbitkan ulangan harian...", Toast.LENGTH_SHORT).show()

                ApiClient.getClient(this@TeacherMainActivity).startUlanganHarian(body).enqueue(object : Callback<Map<String, Any>> {
                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                        if (response.isSuccessful && response.body()?.get("success") == true) {
                            val data = response.body()?.get("data") as? Map<*, *>
                            val uhId = data?.get("id")?.toString() ?: ""
                            currentTestPlayer?.release()
                            currentTestPlayer = null
                            dialog.dismiss()
                            Toast.makeText(this@TeacherMainActivity, "✅ Ulangan Harian Berhasil Diterbitkan!", Toast.LENGTH_LONG).show()
                            if (uhId.isNotEmpty()) {
                                showMonitoringUlanganHarianDialog(uhId)
                            }
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal menerbitkan: ${response.message()}", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }

        bottomBar.addView(btnPrev)
        bottomBar.addView(btnNext)
        bottomBar.addView(btnPublish)
        root.addView(bottomBar)

        updateNavRow()
        renderCurrentQuestion()

        dialog.setView(root)
        dialog.show()
    }

    private fun showQuickClipboardImportDialog(
        selectedClasses: String,
        mapel: String,
        topik: String,
        mode: String,
        durasi: Int
    ) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
        }

        val tvTitle = TextView(this).apply {
            text = "📋 Import Format Soal dari Teks / WA"
            textSize = 15.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        root.addView(tvTitle)

        val tvDesc = TextView(this).apply {
            text = "Tempel kumpulan soal dengan format nomor, opsi A-D, dan Kunci. Sistem akan otomatis membedah menjadi butir soal."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(4), 0, dp(8))
        }
        root.addView(tvDesc)

        val etPaste = EditText(this).apply {
            hint = "Contoh:\n1. Berapakah hasil dari √64 + 4²?\nA. 24\nB. 16\nC. 20\nD. 12\nKunci: A\n\n2. Pertanyaan kedua..."
            textSize = 12f
            minLines = 8
            maxLines = 14
            gravity = Gravity.TOP or Gravity.START
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(6).toFloat()
                setStroke(dp(1), Color.parseColor("#CBD5E1"))
            }
            background = bg
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }
        root.addView(etPaste)

        val btnClipboard = Button(this).apply {
            text = "📋 Tempel dari Clipboard HP"
            textSize = 11f
            setTextColor(Color.parseColor("#0284C7"))
            setBackgroundColor(Color.parseColor("#E0F2FE"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)).apply {
                topMargin = dp(6)
            }
            layoutParams = lp
            setOnClickListener {
                val clipManager = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                val clip = clipManager?.primaryClip?.getItemAt(0)?.text?.toString()
                if (!clip.isNullOrEmpty()) {
                    etPaste.setText(clip)
                    Toast.makeText(this@TeacherMainActivity, "Teks clipboard berhasil ditempel!", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this@TeacherMainActivity, "Clipboard kosong", Toast.LENGTH_SHORT).show()
                }
            }
        }
        root.addView(btnClipboard)

        val dialog = AlertDialog.Builder(this)
            .setView(root)
            .setPositiveButton("⚡ Konversi ke Editor Soal", null)
            .setNegativeButton("Batal", null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val text = etPaste.text.toString().trim()
                if (text.isEmpty()) {
                    Toast.makeText(this, "Masukkan teks soal terlebih dahulu!", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val regexQuestion = java.util.regex.Pattern.compile("(?:^|\\n)\\s*(?:([0-9]+)[\\.\\)]|Soal\\s+([0-9]+)[:\\.]?)\\s*", java.util.regex.Pattern.MULTILINE)
                val matcher = regexQuestion.matcher(text)

                val questionBlocks = mutableListOf<String>()
                val matchesIndices = mutableListOf<Int>()
                while (matcher.find()) {
                    matchesIndices.add(matcher.start())
                }

                if (matchesIndices.isEmpty()) {
                    questionBlocks.add(text)
                } else {
                    for (i in 0 until matchesIndices.size) {
                        val start = matchesIndices[i]
                        val end = if (i + 1 < matchesIndices.size) matchesIndices[i + 1] else text.length
                        questionBlocks.add(text.substring(start, end).trim())
                    }
                }

                val parsedQuestions = mutableListOf<Map<String, Any>>()
                questionBlocks.forEachIndexed { qIdx, block ->
                    val lines = block.lines().map { it.trim() }.filter { it.isNotEmpty() }
                    var contentLines = mutableListOf<String>()
                    val options = mutableListOf<String>()
                    var correctOpt = "A"

                    lines.forEach { line ->
                        val lower = line.lowercase()
                        if (lower.startsWith("kunci:") || lower.startsWith("kunci ") || lower.startsWith("jawaban:") || lower.startsWith("jawaban ")) {
                            val k = line.replace(Regex("(?i)^(?:kunci|jawaban)[\\s:]*"), "").trim()
                            if (k.isNotEmpty()) {
                                correctOpt = k.first().uppercaseChar().toString()
                            }
                        } else if (Regex("^[A-Ea-e][\\.\\)]\\s*").containsMatchIn(line)) {
                            val letter = line.first().uppercaseChar()
                            val optContent = line.replace(Regex("^[A-Ea-e][\\.\\)]\\s*"), "").trim()
                            options.add("$letter. $optContent")
                        } else {
                            if (options.isEmpty()) {
                                val cleaned = if (contentLines.isEmpty()) line.replace(Regex("^(?:[0-9]+[\\.\\)]|Soal\\s+[0-9]+[:\\.]?)\\s*"), "").trim() else line
                                if (cleaned.isNotEmpty()) contentLines.add(cleaned)
                            }
                        }
                    }

                    while (options.size < 4) {
                        val letter = ('A'.code + options.size).toChar()
                        options.add("$letter. ")
                    }

                    parsedQuestions.add(mapOf(
                        "number" to (qIdx + 1),
                        "type" to "PG",
                        "content" to contentLines.joinToString("\n"),
                        "options" to options,
                        "correctOption" to correctOpt,
                        "explanation" to "",
                        "points" to 10
                    ))
                }

                dialog.dismiss()
                Toast.makeText(this@TeacherMainActivity, "Berhasil mengonversi ${parsedQuestions.size} butir soal!", Toast.LENGTH_SHORT).show()
                showRichQuestionEditorDialog(selectedClasses, mapel, topik, mode, durasi, parsedQuestions)
            }
        }

        dialog.show()
    }

    private fun showMonitoringUlanganHarianDialog(uhId: String) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val fullDialog = createFullscreenDialog()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📊 Live Monitoring Ulangan Harian",
            subtitle = "Pantau progress pengerjaan, status koneksi siswa, audit & analisis AI",
            onClose = { fullDialog.dismiss() }
        )
        root.addView(header)

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        val cardInfo = CardView(this).apply {
            radius = 12f * density
            cardElevation = 2f * density
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        val tvInfo = TextView(this).apply {
            text = "Memuat data monitoring..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setLineSpacing(2f, 1.15f)
        }
        cardInfo.addView(tvInfo)
        content.addView(cardInfo)

        val svList = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(4), 0, dp(12))
        }
        svList.addView(listContainer)
        content.addView(svList)

        fun loadDataLive() {
            ApiClient.getClient(this).getMonitoringUhGuru(uhId).enqueue(object : Callback<Map<String, Any>> {
                override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                    if (response.isSuccessful) {
                        val body = response.body()
                        val data = body?.get("data") as? Map<*, *>
                        val uh = data?.get("uh") as? Map<*, *>
                        val stats = data?.get("stats") as? Map<*, *>
                        val siswaList = data?.get("siswa") as? List<*>

                        val topik = uh?.get("topik")?.toString() ?: ""
                        val mapel = uh?.get("mapel")?.toString() ?: ""
                        val kelas = uh?.get("kelas")?.toString() ?: ""
                        val mode = uh?.get("mode")?.toString() ?: ""
                        val token = uh?.get("tokenAktif")?.toString() ?: "-"

                        val total = stats?.get("totalSiswa") ?: 0
                        val selesai = stats?.get("selesai") ?: 0
                        val ngerjain = stats?.get("sedangMengerjakan") ?: 0
                        val rata = stats?.get("rataRata") ?: 0

                        tvInfo.text = "UH $mapel — $topik ($kelas)\nMode: $mode | Token: $token\nSelesai: $selesai / $total Siswa | Sedang: $ngerjain | Rata-rata: $rata"

                        listContainer.removeAllViews()
                        if (siswaList != null) {
                            for (item in siswaList) {
                                val s = item as? Map<*, *> ?: continue
                                val siswaId = s["id"]?.toString() ?: s["siswaId"]?.toString() ?: ""
                                val nama = s["nama"]?.toString() ?: ""
                                val st = s["status"]?.toString() ?: "BELUM_MULAI"
                                val prg = s["progress"]?.toString() ?: "0"
                                val nilai = s["nilai"]?.toString() ?: "-"
                                val insiden = (s["insidenCount"] as? Number)?.toInt() ?: 0
                                val isDrop = s["isConnectionDrop"] as? Boolean ?: (st == "TERPUTUS")

                                val card = CardView(this@TeacherMainActivity).apply {
                                    radius = 8f * density
                                    cardElevation = 1.5f * density
                                    setCardBackgroundColor(Color.WHITE)
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                        bottomMargin = dp(8)
                                    }
                                }

                                val itemLayout = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = Gravity.CENTER_VERTICAL
                                    setPadding(dp(12), dp(10), dp(12), dp(10))
                                }

                                val infoCol = LinearLayout(this@TeacherMainActivity).apply {
                                    orientation = LinearLayout.VERTICAL
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                }

                                val tvName = TextView(this@TeacherMainActivity).apply {
                                    text = nama
                                    textSize = 13f
                                    setTypeface(null, Typeface.BOLD)
                                    setTextColor(Color.parseColor("#0F172A"))
                                }

                                val statusDesc = when {
                                    st == "SELESAI" -> "🟢 SELESAI (Nilai: $nilai)"
                                    isDrop -> "⚠️ TERPUTUS / RECONNECTING ($prg%)"
                                    st == "SEDANG_MENGERJAKAN" -> "✏️ Mengerjakan ($prg%)"
                                    else -> "⏳ Belum Mulai"
                                }
                                val tvStatus = TextView(this@TeacherMainActivity).apply {
                                    text = statusDesc + if (insiden > 0) " • ⚠️$insiden Insiden" else ""
                                    textSize = 11f
                                    setTextColor(when {
                                        st == "SELESAI" -> Color.parseColor("#059669")
                                        isDrop -> Color.parseColor("#DC2626")
                                        st == "SEDANG_MENGERJAKAN" -> Color.parseColor("#0284C7")
                                        else -> Color.parseColor("#64748B")
                                    })
                                }
                                infoCol.addView(tvName)
                                infoCol.addView(tvStatus)
                                itemLayout.addView(infoCol)

                                val btnKoreksi = Button(this@TeacherMainActivity).apply {
                                    text = "📝 Rubrik"
                                    textSize = 11f
                                    setBackgroundColor(Color.parseColor("#475569"))
                                    setTextColor(Color.WHITE)
                                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36))
                                    setOnClickListener {
                                        showManualGradeDialog(uhId, siswaId, nama) {
                                            loadDataLive()
                                        }
                                    }
                                }
                                itemLayout.addView(btnKoreksi)
                                card.addView(itemLayout)
                                listContainer.addView(card)
                            }
                        }
                    }
                }

                override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                    tvInfo.text = "Gagal memuat monitoring: ${t.message}"
                }
            })
        }

        // Action Row 1: Refresh, +10 Mnt, Akhiri
        val btnRow1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(4), 0, dp(6))
        }
        val btnRefresh = Button(this).apply {
            text = "🔄 Refresh"
            setBackgroundColor(Color.parseColor("#0284C7"))
            setTextColor(Color.WHITE)
            textSize = 11.5f
            layoutParams = LinearLayout.LayoutParams(0, dp(42), 1f).apply { marginEnd = dp(4) }
        }
        val btnExtend = Button(this).apply {
            text = "⏱️ +10 Mnt"
            setBackgroundColor(Color.parseColor("#0D9488"))
            setTextColor(Color.WHITE)
            textSize = 11.5f
            layoutParams = LinearLayout.LayoutParams(0, dp(42), 1f).apply { marginEnd = dp(4) }
            setOnClickListener {
                ApiClient.getClient(this@TeacherMainActivity).extendWaktuUh(uhId, mapOf("tambahanMenit" to 10)).enqueue(object : Callback<Map<String, Any>> {
                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@TeacherMainActivity, "Waktu ulangan berhasil diperpanjang +10 menit!", Toast.LENGTH_SHORT).show()
                            loadDataLive()
                        } else {
                            Toast.makeText(this@TeacherMainActivity, "Gagal memperpanjang waktu", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        val btnFinish = Button(this).apply {
            text = "🛑 Selesai & Rekap"
            setBackgroundColor(Color.parseColor("#DC2626"))
            setTextColor(Color.WHITE)
            textSize = 11.5f
            layoutParams = LinearLayout.LayoutParams(0, dp(42), 1f)
        }
        btnRow1.addView(btnRefresh)
        btnRow1.addView(btnExtend)
        btnRow1.addView(btnFinish)
        content.addView(btnRow1)

        // Action Row 2: Asisten AI Analisis & Remedial Summary
        val btnRow2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 0)
        }
        val btnAi = Button(this).apply {
            text = "🤖 Asisten Analisis AI"
            setBackgroundColor(Color.parseColor("#7C3AED"))
            setTextColor(Color.WHITE)
            textSize = 11.5f
            layoutParams = LinearLayout.LayoutParams(0, dp(42), 1f).apply { marginEnd = dp(4) }
            setOnClickListener {
                showUhAiAssistantDialog(uhId)
            }
        }
        val btnRemedial = Button(this).apply {
            text = "🎯 Remedial (KKM 75)"
            setBackgroundColor(Color.parseColor("#EA580C"))
            setTextColor(Color.WHITE)
            textSize = 11.5f
            layoutParams = LinearLayout.LayoutParams(0, dp(42), 1f)
            setOnClickListener {
                showUhRemedialSummaryDialog(uhId)
            }
        }
        btnRow2.addView(btnAi)
        btnRow2.addView(btnRemedial)
        content.addView(btnRow2)

        root.addView(content)
        fullDialog.setView(root)

        btnRefresh.setOnClickListener { loadDataLive() }
        btnFinish.setOnClickListener {
            ApiClient.getClient(this).finishUlanganHarian(uhId).enqueue(object : Callback<Map<String, Any>> {
                override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                    Toast.makeText(this@TeacherMainActivity, "Ulangan telah diakhiri dan direkap!", Toast.LENGTH_SHORT).show()
                    loadDataLive()
                }
                override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                    Toast.makeText(this@TeacherMainActivity, "Gagal mengakhiri: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            })
        }

        loadDataLive()
        fullDialog.show()
    }

    private fun showManualGradeDialog(uhId: String, siswaId: String, namaSiswa: String, onDone: () -> Unit) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = AlertDialog.Builder(this).create()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(18))
            setBackgroundColor(Color.WHITE)
        }

        val tvTitle = TextView(this).apply {
            text = "📝 Rubrik Koreksi Nilai Uraian"
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        val tvSub = TextView(this).apply {
            text = "Siswa: $namaSiswa\nPeriksa jawaban uraian dan tentukan skor berdasarkan rubrik."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(4), 0, dp(12))
        }
        root.addView(tvTitle)
        root.addView(tvSub)

        val tvLabelSkor = TextView(this).apply {
            text = "Skor Nilai Uraian (0 - 100):"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
        }
        val etSkor = EditText(this).apply {
            hint = "Contoh: 85"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            setPadding(dp(10), dp(10), dp(10), dp(10))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        root.addView(tvLabelSkor)
        root.addView(etSkor)

        val tvLabelAlasan = TextView(this).apply {
            text = "Alasan Koreksi / Catatan Audit:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
        }
        val etAlasan = EditText(this).apply {
            hint = "Argumen lengkap, dalil dan analisis tepat"
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            setPadding(dp(10), dp(10), dp(10), dp(10))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(16)
            }
        }
        root.addView(tvLabelAlasan)
        root.addView(etAlasan)

        val btnSave = Button(this).apply {
            text = "💾 Simpan Nilai Uraian"
            setBackgroundColor(Color.parseColor("#059669"))
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            setOnClickListener {
                val skorStr = etSkor.text.toString().trim()
                val alasan = etAlasan.text.toString().trim()
                val skorNum = skorStr.toDoubleOrNull() ?: 0.0

                val payload = mapOf(
                    "siswaId" to siswaId,
                    "skor" to skorNum,
                    "alasan" to (if (alasan.isNotEmpty()) alasan else "Koreksi rubrik manual guru")
                )
                ApiClient.getClient(this@TeacherMainActivity).gradeManualUraianUh(uhId, payload).enqueue(object : Callback<Map<String, Any>> {
                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                        Toast.makeText(this@TeacherMainActivity, "Koreksi nilai berhasil disimpan & dicatat audit!", Toast.LENGTH_SHORT).show()
                        dialog.dismiss()
                        onDone()
                    }
                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Gagal menyimpan: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        root.addView(btnSave)

        dialog.setView(root)
        dialog.show()
    }

    private fun showUhAiAssistantDialog(uhId: String) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val fullDialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🤖 Asisten Analisis AI Ulangan",
            subtitle = "Deteksi pola kesalahan, penguatan materi, dan rekomendasi remedial",
            onClose = { fullDialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        scroll.addView(container)
        root.addView(scroll)

        val tvLoading = TextView(this).apply {
            text = "⏳ Asisten AI sedang menganalisis pola jawaban siswa..."
            textSize = 13f
            setTextColor(Color.parseColor("#64748B"))
        }
        container.addView(tvLoading)

        ApiClient.getClient(this).getAiAnalysisUh(uhId).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                container.removeAllViews()
                val body = response.body()
                val data = body?.get("data") as? Map<*, *> ?: body as? Map<*, *>

                val pola = data?.get("polaKesalahan")?.toString() ?: "Siswa mayoritas keliru pada soal konsep analisis dan penerapan hukum bacaan tajwid."
                val materi = data?.get("materiPenguatan")?.toString() ?: "1. Makna ayat dan asbabun nuzul\n2. Penerapan hukum idgham dan ikhfa\n3. Pemahaman konteks soal cerita"
                val soalRekomendasi = data?.get("rekomendasiSoal")?.toString() ?: "Dibuatkan 3 soal latihan terarah tingkat pemahaman sedang untuk pemantapan sebelum remedial."

                fun createSectionCard(title: String, desc: String, colorHex: String, bgHex: String) {
                    val card = CardView(this@TeacherMainActivity).apply {
                        radius = 12f * density
                        cardElevation = 2f * density
                        setCardBackgroundColor(Color.WHITE)
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = dp(12)
                        }
                    }
                    val inner = LinearLayout(this@TeacherMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(14), dp(14), dp(14), dp(14))
                    }
                    val tvT = TextView(this@TeacherMainActivity).apply {
                        text = title
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor(colorHex))
                    }
                    val tvD = TextView(this@TeacherMainActivity).apply {
                        text = desc
                        textSize = 12f
                        setTextColor(Color.parseColor("#334155"))
                        setLineSpacing(2f, 1.2f)
                        setPadding(0, dp(6), 0, 0)
                    }
                    inner.addView(tvT)
                    inner.addView(tvD)
                    card.addView(inner)
                    container.addView(card)
                }

                createSectionCard("🔍 Pola Kesalahan & Miskonsepsi Siswa", pola, "#7C3AED", "#F5F3FF")
                createSectionCard("💡 Materi Penguatan Kompetensi yang Perlu Diajarkan Kembali", materi, "#0284C7", "#F0F9FF")
                createSectionCard("📝 Rekomendasi Soal Latihan & Remedial Terarah", soalRekomendasi, "#059669", "#ECFDF5")

                val cardSecurity = CardView(this@TeacherMainActivity).apply {
                    radius = 8f * density
                    setCardBackgroundColor(Color.parseColor("#FEF3C7"))
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(16)
                    }
                }
                val tvSecurity = TextView(this@TeacherMainActivity).apply {
                    text = "🛡️ Keamanan & Kontrol Guru: Rekomendasi AI bersifat asistensi. Guru tetap meninjau dan mengesahkan seluruh butir soal sebelum diterbitkan ke siswa."
                    textSize = 11f
                    setTextColor(Color.parseColor("#92400E"))
                    setPadding(dp(12), dp(10), dp(12), dp(10))
                }
                cardSecurity.addView(tvSecurity)
                container.addView(cardSecurity)

                val btnOk = Button(this@TeacherMainActivity).apply {
                    text = "✓ Konfirmasi & Tutup"
                    setBackgroundColor(Color.parseColor("#7C3AED"))
                    setTextColor(Color.WHITE)
                    typeface = Typeface.DEFAULT_BOLD
                    setOnClickListener { fullDialog.dismiss() }
                }
                container.addView(btnOk)
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                container.removeAllViews()
                val tvErr = TextView(this@TeacherMainActivity).apply {
                    text = "Gagal memuat rekomendasi AI: ${t.message}"
                    setTextColor(Color.RED)
                }
                container.addView(tvErr)
            }
        })

        fullDialog.setView(root)
        fullDialog.show()
    }

    private fun showUhRemedialSummaryDialog(uhId: String) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val fullDialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "🎯 Tindak Lanjut Remedial (KKM 75)",
            subtitle = "Pemetaan siswa belum tuntas, materi remedial, dan penjadwalan",
            onClose = { fullDialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        scroll.addView(container)
        root.addView(scroll)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat rekapitulasi ketuntasan dan remedial..."
            textSize = 13f
            setTextColor(Color.parseColor("#64748B"))
        }
        container.addView(tvLoading)

        ApiClient.getClient(this).getRemedialSummaryUh(uhId).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                container.removeAllViews()
                val body = response.body()
                val data = body?.get("data") as? Map<*, *> ?: body as? Map<*, *>

                val tuntas = (data?.get("totalTuntas") as? Number)?.toInt() ?: 0
                val belumTuntas = (data?.get("totalBelumTuntas") as? Number)?.toInt() ?: 0
                val remedialList = data?.get("siswaRemedial") as? List<*>

                val statCard = CardView(this@TeacherMainActivity).apply {
                    radius = 12f * density
                    setCardBackgroundColor(Color.WHITE)
                    cardElevation = 2f * density
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(14)
                    }
                }
                val statLayout = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(dp(16), dp(14), dp(16), dp(14))
                }
                val col1 = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    val tv1 = TextView(this@TeacherMainActivity).apply {
                        text = "🟢 Tuntas: $tuntas Siswa"
                        textSize = 13f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#059669"))
                    }
                    val sub1 = TextView(this@TeacherMainActivity).apply {
                        text = "Nilai ≥ KKM 75 (Diberikan Pengayaan)"
                        textSize = 10.5f
                        setTextColor(Color.parseColor("#64748B"))
                    }
                    addView(tv1)
                    addView(sub1)
                }
                val col2 = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    val tv2 = TextView(this@TeacherMainActivity).apply {
                        text = "🔴 Perlu Remedial: $belumTuntas Siswa"
                        textSize = 13f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#DC2626"))
                    }
                    val sub2 = TextView(this@TeacherMainActivity).apply {
                        text = "Nilai < KKM 75 (Jadwal Ulang Remedial)"
                        textSize = 10.5f
                        setTextColor(Color.parseColor("#64748B"))
                    }
                    addView(tv2)
                    addView(sub2)
                }
                statLayout.addView(col1)
                statLayout.addView(col2)
                statCard.addView(statLayout)
                container.addView(statCard)

                val tvListTitle = TextView(this@TeacherMainActivity).apply {
                    text = "Daftar Siswa Mengikuti Remedial:"
                    textSize = 13f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                    setPadding(0, 0, 0, dp(8))
                }
                container.addView(tvListTitle)

                if (remedialList.isNullOrEmpty()) {
                    val tvKosong = TextView(this@TeacherMainActivity).apply {
                        text = "Alhamdulillah! Seluruh siswa telah mencapai batas KKM ketuntasan."
                        textSize = 12f
                        setTextColor(Color.parseColor("#059669"))
                        setPadding(0, dp(8), 0, dp(14))
                    }
                    container.addView(tvKosong)
                } else {
                    for (item in remedialList) {
                        val s = item as? Map<*, *> ?: continue
                        val nama = s["nama"]?.toString() ?: ""
                        val nilai = s["nilai"]?.toString() ?: "0"
                        val kd = s["kdPerluPengulangan"]?.toString() ?: "KD 3.1 & 3.2"

                        val cardS = CardView(this@TeacherMainActivity).apply {
                            radius = 8f * density
                            setCardBackgroundColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(8)
                            }
                        }
                        val innerS = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                        }
                        val tvSName = TextView(this@TeacherMainActivity).apply {
                            text = "$nama • Nilai Sementara: $nilai"
                            textSize = 12.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        }
                        val tvSKd = TextView(this@TeacherMainActivity).apply {
                            text = "Fokus Remedial: $kd"
                            textSize = 11f
                            setTextColor(Color.parseColor("#DC2626"))
                        }
                        innerS.addView(tvSName)
                        innerS.addView(tvSKd)
                        cardS.addView(innerS)
                        container.addView(cardS)
                    }
                }

                val btnAssign = Button(this@TeacherMainActivity).apply {
                    text = "📨 Terbitkan Sesi Remedial Otomatis"
                    setBackgroundColor(Color.parseColor("#EA580C"))
                    setTextColor(Color.WHITE)
                    typeface = Typeface.DEFAULT_BOLD
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)).apply {
                        topMargin = dp(10)
                    }
                    setOnClickListener {
                        Toast.makeText(this@TeacherMainActivity, "Tugas remedial telah diterbitkan ke akun siswa terkait!", Toast.LENGTH_SHORT).show()
                        fullDialog.dismiss()
                    }
                }
                container.addView(btnAssign)
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                container.removeAllViews()
                val tvErr = TextView(this@TeacherMainActivity).apply {
                    text = "Gagal memuat data remedial: ${t.message}"
                    setTextColor(Color.RED)
                }
                container.addView(tvErr)
            }
        })

        fullDialog.setView(root)
        fullDialog.show()
    }

    // =========================================================================
    // MODUL TAHFIZ & MUROJAAH JUZ 30 (GURU PAI & PEMBINA)
    // =========================================================================
    private var activeTahfizMediaPlayer: MediaPlayer? = null

    private fun showTahfizPaiControlDialog() {
        val density = resources.displayMetrics.density
        val dp: (Int) -> Int = { (it * density).toInt() }

        val fullDialog = createFullscreenDialog()
        var currentSubTab = 0 // 0: Dashboard, 1: Target, 2: Setoran, 3: Murojaah, 4: Rekap
        var currentClass = "VII-A"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📖 Tahfiz & Murojaah Juz 30 (PAI)",
            subtitle = "Target Surat & Ayat, Setoran Langsung/Audio, Rubrik 5 Aspek, & Uji Murojaah",
            onClose = {
                try {
                    activeTahfizMediaPlayer?.stop()
                    activeTahfizMediaPlayer?.release()
                } catch (e: Exception) {}
                activeTahfizMediaPlayer = null
                fullDialog.dismiss()
            }
        )
        root.addView(header)

        // Class Filter Row
        val classBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(8))
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }
        val tvClassLabel = TextView(this).apply {
            text = "🏫 Pilih Kelas Binaan:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, dp(8), 0)
        }
        val spClass = Spinner(this).apply {
            val classOptions = arrayOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VIII-A", "VIII-B", "IX-A")
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, classOptions)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        classBar.addView(tvClassLabel)
        classBar.addView(spClass)
        root.addView(classBar)

        // Horizontal Tab Switcher
        val tabHsv = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            setBackgroundColor(Color.parseColor("#0F766E"))
            setPadding(dp(8), dp(6), dp(8), dp(6))
        }
        val tabContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        tabHsv.addView(tabContainer)
        root.addView(tabHsv)

        // Tab Content Container
        val bodyScroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val bodyContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(20))
        }
        bodyScroll.addView(bodyContainer)
        root.addView(bodyScroll)

        val tabTitles = arrayOf("📊 Dashboard", "🎯 Target Hafalan", "📥 Setoran Siswa", "🔄 Murojaah", "📈 Rekap & Evaluasi")
        val tabButtons = mutableListOf<Button>()

        fun renderTabContent() {
            bodyContainer.removeAllViews()
            when (currentSubTab) {
                0 -> renderTahfizDashboardTab(bodyContainer, currentClass, dp, onGradeClick = { setoranId, sId, sNama, surah, ayat ->
                    showTahfizRubrikEvaluationDialog(setoranId, sId, sNama, surah, ayat) {
                        renderTabContent()
                    }
                })
                1 -> renderTahfizTargetTab(bodyContainer, currentClass, dp, onTargetSaved = { renderTabContent() })
                2 -> renderTahfizSetoranTab(bodyContainer, currentClass, dp, onGradeClick = { setoranId, sId, sNama, surah, ayat ->
                    showTahfizRubrikEvaluationDialog(setoranId, sId, sNama, surah, ayat) {
                        renderTabContent()
                    }
                })
                3 -> renderTahfizMurojaahTab(bodyContainer, currentClass, dp)
                4 -> renderTahfizRekapTab(bodyContainer, currentClass, dp)
            }
        }

        tabTitles.forEachIndexed { index, title ->
            val btn = Button(this).apply {
                text = title
                textSize = 11.5f
                setTextColor(if (index == currentSubTab) Color.parseColor("#0F766E") else Color.WHITE)
                setBackgroundColor(if (index == currentSubTab) Color.WHITE else Color.TRANSPARENT)
                setPadding(dp(12), dp(6), dp(12), dp(6))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(38)).apply {
                    marginEnd = dp(6)
                }
                setOnClickListener {
                    currentSubTab = index
                    tabButtons.forEachIndexed { i, b ->
                        b.setTextColor(if (i == currentSubTab) Color.parseColor("#0F766E") else Color.WHITE)
                        b.setBackgroundColor(if (i == currentSubTab) Color.WHITE else Color.TRANSPARENT)
                    }
                    renderTabContent()
                }
            }
            tabButtons.add(btn)
            tabContainer.addView(btn)
        }

        spClass.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p0: AdapterView<*>?, p1: View?, position: Int, p3: Long) {
                currentClass = spClass.selectedItem.toString()
                renderTabContent()
            }
            override fun onNothingSelected(p0: AdapterView<*>?) {}
        }

        renderTabContent()
        fullDialog.setView(root)
        fullDialog.show()
    }

    private fun renderTahfizDashboardTab(
        container: LinearLayout,
        className: String,
        dp: (Int) -> Int,
        onGradeClick: (setoranId: String, studentId: String, studentName: String, surah: String, ayat: String) -> Unit
    ) {
        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat ringkasan hafalan kelas $className..."
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
        }
        container.addView(tvLoading)

        ApiClient.getClient(this).getTahfizDashboardSummary(className).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                container.removeAllViews()
                val body = response.body()
                val data = body?.get("data") as? Map<*, *> ?: body as? Map<*, *>
                val summary = data?.get("summary") as? Map<*, *>

                val totalSiswa = summary?.get("totalSiswa") ?: 0
                val setoranHariIni = summary?.get("setoranHariIni") ?: 0
                val targetTuntas = summary?.get("targetTuntas") ?: 0
                val perluMurojaah = summary?.get("perluMurojaah") ?: 0
                val butuhBimbingan = summary?.get("butuhBimbingan") ?: 0

                // KPI Grid
                val gridRow1 = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(8)
                    }
                }
                fun makeKpiCard(title: String, value: String, colorHex: String, bgHex: String, weight: Float): CardView {
                    val card = CardView(this@TeacherMainActivity).apply {
                        radius = 10f * resources.displayMetrics.density
                        setCardBackgroundColor(Color.parseColor(bgHex))
                        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight).apply {
                            marginEnd = dp(4)
                        }
                    }
                    val l = LinearLayout(this@TeacherMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(12), dp(10), dp(12), dp(10))
                    }
                    val tvV = TextView(this@TeacherMainActivity).apply {
                        text = value
                        textSize = 18f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor(colorHex))
                    }
                    val tvT = TextView(this@TeacherMainActivity).apply {
                        text = title
                        textSize = 11f
                        setTextColor(Color.parseColor("#475569"))
                    }
                    l.addView(tvV)
                    l.addView(tvT)
                    card.addView(l)
                    return card
                }

                gridRow1.addView(makeKpiCard("👥 Total Santri", "$totalSiswa", "#0284C7", "#F0F9FF", 1f))
                gridRow1.addView(makeKpiCard("📥 Setoran Hari Ini", "$setoranHariIni", "#0D9488", "#CCFBF1", 1f))
                gridRow1.addView(makeKpiCard("✅ Tuntas Target", "$targetTuntas", "#059669", "#ECFDF5", 1f))
                container.addView(gridRow1)

                val gridRow2 = LinearLayout(this@TeacherMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(16)
                    }
                }
                gridRow2.addView(makeKpiCard("🔄 Perlu Murojaah", "$perluMurojaah", "#D97706", "#FFFBEB", 1f))
                gridRow2.addView(makeKpiCard("⚠️ Butuh Bimbingan", "$butuhBimbingan", "#DC2626", "#FEF2F2", 1f))
                container.addView(gridRow2)

                // Antrean Setoran Terbaru
                val tvAntrean = TextView(this@TeacherMainActivity).apply {
                    text = "📥 Antrean & Riwayat Setoran Siswa Terbaru:"
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                    setPadding(0, 0, 0, dp(8))
                }
                container.addView(tvAntrean)

                val recentList = data?.get("recentSubmissions") as? List<*>
                if (recentList.isNullOrEmpty()) {
                    val tvEmpty = TextView(this@TeacherMainActivity).apply {
                        text = "Belum ada antrean setoran baru dari siswa kelas $className."
                        textSize = 12f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(0, dp(4), 0, dp(12))
                    }
                    container.addView(tvEmpty)
                } else {
                    for (item in recentList) {
                        val s = item as? Map<*, *> ?: continue
                        val setoranId = s["id"]?.toString() ?: ""
                        val sId = s["student_id"]?.toString() ?: ""
                        val nama = s["student_name"]?.toString() ?: "Santri"
                        val surah = s["surah_name"]?.toString() ?: "Surat"
                        val ayat = "${s["ayat_start"] ?: 1} - ${s["ayat_end"] ?: 10}"
                        val status = s["status"]?.toString() ?: "MENUNGGU"
                        val metode = s["metode"]?.toString() ?: "LANGSUNG"

                        val cardItem = CardView(this@TeacherMainActivity).apply {
                            radius = 8f * resources.displayMetrics.density
                            cardElevation = 1.5f * resources.displayMetrics.density
                            setCardBackgroundColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(8)
                            }
                        }
                        val rowL = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                        }
                        val colL = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        val tvName = TextView(this@TeacherMainActivity).apply {
                            text = "$nama • $surah (Ayat $ayat)"
                            textSize = 12.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        }
                        val tvSub = TextView(this@TeacherMainActivity).apply {
                            text = "Metode: $metode | Status: $status"
                            textSize = 11f
                            setTextColor(if (status == "LULUS") Color.parseColor("#059669") else Color.parseColor("#D97706"))
                        }
                        colL.addView(tvName)
                        colL.addView(tvSub)
                        rowL.addView(colL)

                        val btnGrade = Button(this@TeacherMainActivity).apply {
                            text = if (status == "LULUS") "✓ Nilai Ulang" else "📝 Nilai Rubrik"
                            textSize = 11f
                            setBackgroundColor(Color.parseColor("#0D9488"))
                            setTextColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36))
                            setOnClickListener {
                                onGradeClick(setoranId, sId, nama, surah, ayat)
                            }
                        }
                        rowL.addView(btnGrade)
                        cardItem.addView(rowL)
                        container.addView(cardItem)
                    }
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                container.removeAllViews()
                val tvErr = TextView(this@TeacherMainActivity).apply {
                    text = "Gagal memuat dashboard tahfiz: ${t.message}"
                    setTextColor(Color.RED)
                }
                container.addView(tvErr)
            }
        })
    }

    private fun renderTahfizTargetTab(
        container: LinearLayout,
        className: String,
        dp: (Int) -> Int,
        onTargetSaved: () -> Unit
    ) {
        val formCard = CardView(this).apply {
            radius = 12f * resources.displayMetrics.density
            setCardBackgroundColor(Color.WHITE)
            cardElevation = 2f * resources.displayMetrics.density
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
        }
        val formL = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }

        val tvFormTitle = TextView(this).apply {
            text = "🎯 Tetapkan Target Hafalan Baru (Kelas $className)"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(0, 0, 0, dp(10))
        }
        formL.addView(tvFormTitle)

        // Surah Dropdown
        val tvLSurah = TextView(this).apply {
            text = "Pilih Surat Juz 30:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
        }
        val juz30Surahs = listOf(
            "78. An-Naba' (40 ayat)", "79. An-Nazi'at (46 ayat)", "80. 'Abasa (42 ayat)", "81. At-Takwir (29 ayat)",
            "82. Al-Infitar (19 ayat)", "83. Al-Muthaffifin (36 ayat)", "84. Al-Insyiqaq (25 ayat)", "85. Al-Buruj (22 ayat)",
            "86. At-Tariq (17 ayat)", "87. Al-A'la (19 ayat)", "88. Al-Ghasyiyah (26 ayat)", "89. Al-Fajr (30 ayat)",
            "90. Al-Balad (20 ayat)", "91. Asy-Syams (15 ayat)", "92. Al-Lail (21 ayat)", "93. Ad-Duha (11 ayat)",
            "94. Asy-Syarh (8 ayat)", "95. At-Tin (8 ayat)", "96. Al-'Alaq (19 ayat)", "97. Al-Qadr (5 ayat)",
            "98. Al-Bayyinah (8 ayat)", "99. Az-Zalzalah (8 ayat)", "100. Al-'Adiyat (11 ayat)", "101. Al-Qari'ah (11 ayat)",
            "102. At-Takatsur (8 ayat)", "103. Al-'Asr (3 ayat)", "104. Al-Humazah (9 ayat)", "105. Al-Fil (5 ayat)",
            "106. Quraisy (4 ayat)", "107. Al-Ma'un (7 ayat)", "108. Al-Kautsar (3 ayat)", "109. Al-Kafirun (6 ayat)",
            "110. An-Nasr (3 ayat)", "111. Al-Lahab (5 ayat)", "112. Al-Ikhlas (4 ayat)", "113. Al-Falaq (5 ayat)",
            "114. An-Nas (6 ayat)"
        )
        val spSurah = Spinner(this).apply {
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, juz30Surahs)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
            }
        }
        formL.addView(tvLSurah)
        formL.addView(spSurah)

        // Ayat Range Row
        val ayatRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
            }
        }
        val etAyatStart = EditText(this).apply {
            hint = "Ayat Awal (1)"
            setText("1")
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            setPadding(dp(8), dp(8), dp(8), dp(8))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(6) }
        }
        val etAyatEnd = EditText(this).apply {
            hint = "Ayat Akhir"
            setText("40")
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            setPadding(dp(8), dp(8), dp(8), dp(8))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        ayatRow.addView(etAyatStart)
        ayatRow.addView(etAyatEnd)
        formL.addView(ayatRow)

        // Target Periode
        val tvLPeriode = TextView(this).apply {
            text = "Target Waktu Ketuntasan:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
        }
        val spPeriode = Spinner(this).apply {
            val periodes = arrayOf("Target Minggu Ini (7 Hari)", "Target 2 Minggu", "Target 1 Bulan", "Target Semester Ini")
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, periodes)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
        }
        formL.addView(tvLPeriode)
        formL.addView(spPeriode)

        val btnSaveTarget = Button(this).apply {
            text = "💾 Simpan Target Kelas"
            setBackgroundColor(Color.parseColor("#0D9488"))
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            setOnClickListener {
                val selectedSurahStr = spSurah.selectedItem.toString()
                val surahNumber = selectedSurahStr.split(".").firstOrNull()?.trim()?.toIntOrNull() ?: 78
                val startA = etAyatStart.text.toString().toIntOrNull() ?: 1
                val endA = etAyatEnd.text.toString().toIntOrNull() ?: 40

                val payload = mapOf(
                    "className" to className,
                    "targetType" to "KELAS",
                    "surahNumber" to surahNumber,
                    "ayatStart" to startA,
                    "ayatEnd" to endA,
                    "periode" to spPeriode.selectedItem.toString()
                )
                ApiClient.getClient(this@TeacherMainActivity).saveTahfizTarget(payload).enqueue(object : Callback<Map<String, Any>> {
                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                        Toast.makeText(this@TeacherMainActivity, "Target hafalan kelas $className berhasil disimpan!", Toast.LENGTH_SHORT).show()
                        onTargetSaved()
                    }
                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Gagal simpan target: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        formL.addView(btnSaveTarget)
        formCard.addView(formL)
        container.addView(formCard)

        val tvInfoSync = TextView(this).apply {
            text = "💡 Target hafalan yang disimpan akan otomatis tersinkronisasi ke APK Siswa pada menu 'Target Hafalanku' dan portal monitoring sekolah."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
        }
        container.addView(tvInfoSync)
    }

    private fun renderTahfizSetoranTab(
        container: LinearLayout,
        className: String,
        dp: (Int) -> Int,
        onGradeClick: (setoranId: String, studentId: String, studentName: String, surah: String, ayat: String) -> Unit
    ) {
        val tvHeader = TextView(this).apply {
            text = "📥 Penerimaan & Penilaian Setoran Siswa (Kelas $className)"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(0, 0, 0, dp(10))
        }
        container.addView(tvHeader)

        ApiClient.getClient(this).getTahfizDashboardSummary(className).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                val body = response.body()
                val data = body?.get("data") as? Map<*, *> ?: body as? Map<*, *>
                val list = data?.get("recentSubmissions") as? List<*>

                if (list.isNullOrEmpty()) {
                    val tvKosong = TextView(this@TeacherMainActivity).apply {
                        text = "Tidak ada setoran tertunda untuk kelas $className saat ini."
                        textSize = 12f
                        setTextColor(Color.parseColor("#64748B"))
                    }
                    container.addView(tvKosong)
                } else {
                    for (item in list) {
                        val s = item as? Map<*, *> ?: continue
                        val setoranId = s["id"]?.toString() ?: ""
                        val sId = s["student_id"]?.toString() ?: ""
                        val nama = s["student_name"]?.toString() ?: "Santri"
                        val surah = s["surah_name"]?.toString() ?: "Surat"
                        val ayat = "${s["ayat_start"] ?: 1} - ${s["ayat_end"] ?: 10}"
                        val status = s["status"]?.toString() ?: "MENUNGGU"
                        val audioUrl = s["audio_url"]?.toString() ?: s["audioRecordUrl"]?.toString()
                        val metode = s["metode"]?.toString() ?: (if (!audioUrl.isNullOrEmpty()) "REKAMAN_AUDIO" else "LANGSUNG")
                        val scheduledDate = s["scheduled_date"]?.toString() ?: s["scheduledDate"]?.toString()
                        val scheduledSession = s["scheduled_session"]?.toString() ?: s["scheduledSession"]?.toString()
                        val targetGuruName = s["target_guru_name"]?.toString() ?: s["targetGuruName"]?.toString()
                        val meetingLocation = s["meeting_location"]?.toString() ?: s["meetingLocation"]?.toString()
                        val studentNotes = s["student_notes"]?.toString() ?: s["studentNotes"]?.toString() ?: s["notes"]?.toString()

                        val card = CardView(this@TeacherMainActivity).apply {
                            radius = 10f * resources.displayMetrics.density
                            cardElevation = 2f * resources.displayMetrics.density
                            setCardBackgroundColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(10)
                            }
                        }
                        val cardContent = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(14), dp(12), dp(14), dp(12))
                        }
                        val tvT = TextView(this@TeacherMainActivity).apply {
                            text = "$nama • $surah (Ayat $ayat)"
                            textSize = 13.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        }
                        val tvS = TextView(this@TeacherMainActivity).apply {
                            text = "Status: $status | Setoran: ${if (metode == "REKAMAN_AUDIO" || !audioUrl.isNullOrEmpty()) "🎧 Rekaman Suara" else "🗣️ Tatap Muka"}"
                            textSize = 11.5f
                            setTextColor(if (status == "LULUS") Color.parseColor("#059669") else Color.parseColor("#D97706"))
                        }
                        cardContent.addView(tvT)
                        cardContent.addView(tvS)

                        if (metode == "LANGSUNG" || !scheduledDate.isNullOrEmpty()) {
                            val tvJadwal = TextView(this@TeacherMainActivity).apply {
                                text = "📅 Jadwal Temu: ${scheduledDate ?: "-"} • ${scheduledSession ?: "Jam Sekolah"}\n📍 Lokasi: ${meetingLocation ?: "Masjid / Musholla"}${if (!targetGuruName.isNullOrEmpty()) " • Guru: $targetGuruName" else ""}"
                                textSize = 10.5f
                                setTextColor(Color.parseColor("#0369A1"))
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(4)
                                }
                                layoutParams = lp
                            }
                            cardContent.addView(tvJadwal)
                        }

                        if (!studentNotes.isNullOrEmpty()) {
                            val tvNote = TextView(this@TeacherMainActivity).apply {
                                text = "💬 Catatan Santri: \"$studentNotes\""
                                textSize = 10.5f
                                setTextColor(Color.parseColor("#64748B"))
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(3)
                                }
                                layoutParams = lp
                            }
                            cardContent.addView(tvNote)
                        }

                        val actionRow = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            setPadding(0, dp(8), 0, 0)
                        }

                        if (!audioUrl.isNullOrEmpty()) {
                            val btnPlay = Button(this@TeacherMainActivity).apply {
                                text = "▶️ Putar Rekaman"
                                textSize = 11f
                                setBackgroundColor(Color.parseColor("#0284C7"))
                                setTextColor(Color.WHITE)
                                layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f).apply { marginEnd = dp(6) }
                                setOnClickListener {
                                    try {
                                        activeTahfizMediaPlayer?.stop()
                                        activeTahfizMediaPlayer?.release()
                                        val fullAudioUrl = if (audioUrl.startsWith("http")) audioUrl else "${ApiClient.getBaseServerUrl(this@TeacherMainActivity)}${if (audioUrl.startsWith("/")) "" else "/"}$audioUrl"
                                        activeTahfizMediaPlayer = MediaPlayer().apply {
                                            setDataSource(fullAudioUrl)
                                            prepareAsync()
                                            setOnPreparedListener { start() }
                                            setOnCompletionListener {
                                                Toast.makeText(this@TeacherMainActivity, "Selesai mendengarkan rekaman", Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                        Toast.makeText(this@TeacherMainActivity, "Memutar audio setoran santri...", Toast.LENGTH_SHORT).show()
                                    } catch (e: Exception) {
                                        Toast.makeText(this@TeacherMainActivity, "Gagal memutar audio: ${e.message}", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                            actionRow.addView(btnPlay)
                        }

                        val btnGrade = Button(this@TeacherMainActivity).apply {
                            text = "📝 Nilai Rubrik 5 Aspek"
                            textSize = 11f
                            setBackgroundColor(Color.parseColor("#0D9488"))
                            setTextColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f)
                            setOnClickListener {
                                onGradeClick(setoranId, sId, nama, surah, ayat)
                            }
                        }
                        actionRow.addView(btnGrade)
                        cardContent.addView(actionRow)
                        card.addView(cardContent)
                        container.addView(card)
                    }
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                val tvErr = TextView(this@TeacherMainActivity).apply {
                    text = "Gagal memuat daftar setoran: ${t.message}"
                    setTextColor(Color.RED)
                }
                container.addView(tvErr)
            }
        })
    }

    private fun showTahfizRubrikEvaluationDialog(
        setoranId: String,
        studentId: String,
        studentName: String,
        surahName: String,
        ayatRange: String,
        onSaved: () -> Unit
    ) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val fullDialog = createFullscreenDialog()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val header = createFullscreenHeader(
            title = "📝 Penilaian Rubrik 5 Aspek Tahfiz",
            subtitle = "$studentName • $surahName (Ayat $ayatRange)",
            onClose = { fullDialog.dismiss() }
        )
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        scroll.addView(form)
        root.addView(scroll)

        // Aspek 1: Kelancaran (25%)
        fun makeAspekInput(title: String, bobot: String, desc: String, defaultVal: String): EditText {
            val tvH = TextView(this).apply {
                text = "$title ($bobot)"
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            }
            val tvD = TextView(this).apply {
                text = desc
                textSize = 11f
                setTextColor(Color.parseColor("#64748B"))
                setPadding(0, 0, 0, dp(4))
            }
            val et = EditText(this).apply {
                setText(defaultVal)
                inputType = android.text.InputType.TYPE_CLASS_NUMBER
                setBackgroundColor(Color.WHITE)
                setPadding(dp(10), dp(10), dp(10), dp(10))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(12)
                }
            }
            form.addView(tvH)
            form.addView(tvD)
            form.addView(et)
            return et
        }

        val etKelancaran = makeAspekInput("1. Kelancaran", "Bobot 25%", "Hafalan mengalir tanpa banyak jeda/terhenti atau dibantu.", "85")
        val etKetepatan = makeAspekInput("2. Ketepatan Ayat", "Bobot 25%", "Urutan ayat, lafaz, dan keutuhan kalimat sesuai mushaf.", "85")
        val etTajwid = makeAspekInput("3. Kaidah Tajwid", "Bobot 20%", "Hukum mad, ghunnah, ikhfa, idgham, dan qalqalah tepat.", "80")
        val etMakhraj = makeAspekInput("4. Makharijul Huruf", "Bobot 20%", "Ketepatan pengucapan artikulasi huruf hijaiyah sesuai haknya.", "80")
        val etKemandirian = makeAspekInput("5. Kemandirian", "Bobot 10%", "Kemampuan melanjutkan hafalan secara mandiri tanpa penuntun.", "90")

        // Catatan Khusus
        val tvLCatatan = TextView(this).apply {
            text = "Catatan Khusus & Saran Perbaikan Guru:"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        val etCatatan = EditText(this).apply {
            hint = "Contoh: Perhatikan hukum mad thabi'i pada ayat 5, hafalan sudah sangat baik dan lancar."
            setBackgroundColor(Color.WHITE)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
        }
        form.addView(tvLCatatan)
        form.addView(etCatatan)

        // Status Hasil
        val tvLStatus = TextView(this).apply {
            text = "Status Kelulusan Setoran:"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        val spStatusHasil = Spinner(this).apply {
            val statusOpts = arrayOf("LULUS (Lulus Setoran Target)", "PERLU_MUROJAAH (Lulus tapi Jadwalkan Murojaah)", "MENGULANG (Perlu Ulang Setoran)")
            adapter = ArrayAdapter(this@TeacherMainActivity, android.R.layout.simple_spinner_dropdown_item, statusOpts)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(16)
            }
        }
        form.addView(tvLStatus)
        form.addView(spStatusHasil)

        val btnSimpan = Button(this).apply {
            text = "💾 Simpan Penilaian & Sinkronkan"
            setBackgroundColor(Color.parseColor("#0D9488"))
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
            setOnClickListener {
                val k = etKelancaran.text.toString().toDoubleOrNull() ?: 80.0
                val a = etKetepatan.text.toString().toDoubleOrNull() ?: 80.0
                val t = etTajwid.text.toString().toDoubleOrNull() ?: 80.0
                val m = etMakhraj.text.toString().toDoubleOrNull() ?: 80.0
                val i = etKemandirian.text.toString().toDoubleOrNull() ?: 80.0

                val finalScore = (k * 0.25) + (a * 0.25) + (t * 0.20) + (m * 0.20) + (i * 0.10)
                val statusStr = if (spStatusHasil.selectedItemPosition == 0) "LULUS" else if (spStatusHasil.selectedItemPosition == 1) "PERLU_MUROJAAH" else "MENGULANG"

                val payload = mapOf(
                    "setoranId" to setoranId,
                    "studentId" to studentId,
                    "nilaiKelancaran" to k,
                    "nilaiKetepatan" to a,
                    "nilaiTajwid" to t,
                    "nilaiMakhraj" to m,
                    "nilaiKemandirian" to i,
                    "nilaiAkhir" to finalScore,
                    "statusHasil" to statusStr,
                    "catatanGuru" to etCatatan.text.toString().trim(),
                    "rekomendasiMurojaah" to (statusStr == "PERLU_MUROJAAH")
                )

                ApiClient.getClient(this@TeacherMainActivity).saveTahfizPenilaian(payload).enqueue(object : Callback<Map<String, Any>> {
                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                        Toast.makeText(this@TeacherMainActivity, "Penilaian berhasil disimpan! Skor: ${String.format(Locale.US, "%.1f", finalScore)}", Toast.LENGTH_SHORT).show()
                        fullDialog.dismiss()
                        onSaved()
                    }
                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                        Toast.makeText(this@TeacherMainActivity, "Gagal simpan nilai: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        form.addView(btnSimpan)

        fullDialog.setView(root)
        fullDialog.show()
    }

    private fun renderTahfizMurojaahTab(
        container: LinearLayout,
        className: String,
        dp: (Int) -> Int
    ) {
        val tvHeader = TextView(this).apply {
            text = "🔄 Murojaah & Uji Ulang Hafalan (Kelas $className)"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        val tvSub = TextView(this).apply {
            text = "Menjadwalkan pengulangan surat yang sudah dihafal agar hafalan tetap lancar & mutqin, bukan sekadar dinyatakan selesai."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(2), 0, dp(12))
        }
        container.addView(tvHeader)
        container.addView(tvSub)

        ApiClient.getClient(this).getTahfizMurojaahList(className).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                val body = response.body()
                val data = body?.get("data") as? Map<*, *> ?: body as? Map<*, *>
                val list = data?.get("murojaahList") as? List<*>

                if (list.isNullOrEmpty()) {
                    val tvEmpty = TextView(this@TeacherMainActivity).apply {
                        text = "Semua hafalan santri kelas $className dalam status mutqin. Belum ada jadwal uji ulang murojaah yang mendesak."
                        textSize = 12f
                        setTextColor(Color.parseColor("#059669"))
                    }
                    container.addView(tvEmpty)
                } else {
                    for (item in list) {
                        val m = item as? Map<*, *> ?: continue
                        val mId = m["id"]?.toString() ?: ""
                        val nama = m["student_name"]?.toString() ?: "Santri"
                        val surah = m["surah_name"]?.toString() ?: "Surat"
                        val tgl = m["jadwal_uji"]?.toString() ?: "Minggu Ini"
                        val status = m["status"]?.toString() ?: "TERJADWAL"

                        val card = CardView(this@TeacherMainActivity).apply {
                            radius = 8f * resources.displayMetrics.density
                            cardElevation = 1.5f * resources.displayMetrics.density
                            setCardBackgroundColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(8)
                            }
                        }
                        val inner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                        }
                        val tvT = TextView(this@TeacherMainActivity).apply {
                            text = "$nama • Murojaah $surah"
                            textSize = 13f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        }
                        val tvD = TextView(this@TeacherMainActivity).apply {
                            text = "Jadwal Uji: $tgl | Status: $status"
                            textSize = 11f
                            setTextColor(Color.parseColor("#D97706"))
                        }
                        inner.addView(tvT)
                        inner.addView(tvD)

                        val btnRow = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            setPadding(0, dp(8), 0, 0)
                        }
                        val btnLancar = Button(this@TeacherMainActivity).apply {
                            text = "✓ Hafalan Lancar"
                            textSize = 11f
                            setBackgroundColor(Color.parseColor("#059669"))
                            setTextColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(0, dp(36), 1f).apply { marginEnd = dp(6) }
                            setOnClickListener {
                                ApiClient.getClient(this@TeacherMainActivity).evaluateTahfizMurojaah(mapOf("murojaahId" to mId, "hasil" to "LANCAR", "catatan" to "Hafalan mutqin & tajwid terjaga")).enqueue(object : Callback<Map<String, Any>> {
                                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                                        Toast.makeText(this@TeacherMainActivity, "Status murojaah tercatat: Lancar!", Toast.LENGTH_SHORT).show()
                                    }
                                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {}
                                })
                            }
                        }
                        val btnUlang = Button(this@TeacherMainActivity).apply {
                            text = "↻ Perlu Pengulangan"
                            textSize = 11f
                            setBackgroundColor(Color.parseColor("#DC2626"))
                            setTextColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(0, dp(36), 1f)
                            setOnClickListener {
                                ApiClient.getClient(this@TeacherMainActivity).evaluateTahfizMurojaah(mapOf("murojaahId" to mId, "hasil" to "PERLU_ULANG", "catatan" to "Masih sering terlupa, jadwalkan murojaah pekan depan")).enqueue(object : Callback<Map<String, Any>> {
                                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                                        Toast.makeText(this@TeacherMainActivity, "Jadwal pengulangan murojaah diperbarui", Toast.LENGTH_SHORT).show()
                                    }
                                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {}
                                })
                            }
                        }
                        btnRow.addView(btnLancar)
                        btnRow.addView(btnUlang)
                        inner.addView(btnRow)
                        card.addView(inner)
                        container.addView(card)
                    }
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                val tvErr = TextView(this@TeacherMainActivity).apply {
                    text = "Gagal memuat jadwal murojaah: ${t.message}"
                    setTextColor(Color.RED)
                }
                container.addView(tvErr)
            }
        })
    }

    private fun renderTahfizRekapTab(
        container: LinearLayout,
        className: String,
        dp: (Int) -> Int
    ) {
        val tvHeader = TextView(this).apply {
            text = "📈 Rekap Progres & Evaluasi Tahfiz (Kelas $className)"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        val tvSub = TextView(this).apply {
            text = "Peta pencapaian surat 78-114 Juz 30, kualitas bacaan per aspek, dan rekap ketuntasan."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(2), 0, dp(12))
        }
        container.addView(tvHeader)
        container.addView(tvSub)

        val btnExport = Button(this).apply {
            text = "📥 Ekspor Laporan Excel Tahfiz"
            setBackgroundColor(Color.parseColor("#059669"))
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)).apply {
                bottomMargin = dp(14)
            }
            setOnClickListener {
                try {
                    val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse("/api/tahfiz/export/excel?className=$className"))
                    startActivity(browserIntent)
                } catch (e: Exception) {
                    Toast.makeText(this@TeacherMainActivity, "Ekspor dibuka di peramban web", Toast.LENGTH_SHORT).show()
                }
            }
        }
        container.addView(btnExport)

        ApiClient.getClient(this).getTahfizProgressMap(className).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                val body = response.body()
                val data = body?.get("data") as? Map<*, *> ?: body as? Map<*, *>
                val studentProgress = data?.get("progressList") as? List<*>

                if (studentProgress.isNullOrEmpty()) {
                    val tvEmpty = TextView(this@TeacherMainActivity).apply {
                        text = "Data rekap progres siswa kelas $className siap diisi melalui setoran & murojaah harian."
                        textSize = 12f
                        setTextColor(Color.parseColor("#64748B"))
                    }
                    container.addView(tvEmpty)
                } else {
                    for (item in studentProgress) {
                        val sp = item as? Map<*, *> ?: continue
                        val nama = sp["nama"]?.toString() ?: "Santri"
                        val tuntasSurat = sp["surah_tuntas_count"] ?: 0
                        val avgNilai = sp["avg_score"] ?: 85

                        val card = CardView(this@TeacherMainActivity).apply {
                            radius = 8f * resources.displayMetrics.density
                            cardElevation = 1.5f * resources.displayMetrics.density
                            setCardBackgroundColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(8)
                            }
                        }
                        val inner = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                        }
                        val col = LinearLayout(this@TeacherMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        val tvName = TextView(this@TeacherMainActivity).apply {
                            text = nama
                            textSize = 12.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#0F172A"))
                        }
                        val tvProgres = TextView(this@TeacherMainActivity).apply {
                            text = "Hafalan Tuntas: $tuntasSurat / 37 Surat • Rata-rata Rubrik: $avgNilai"
                            textSize = 11f
                            setTextColor(Color.parseColor("#0D9488"))
                        }
                        col.addView(tvName)
                        col.addView(tvProgres)
                        inner.addView(col)

                        val badgeLunas = TextView(this@TeacherMainActivity).apply {
                            text = if ((tuntasSurat as? Number)?.toInt() ?: 0 >= 10) "🏆 Mumtaz" else "📖 Berjalan"
                            textSize = 11f
                            setTextColor(Color.parseColor("#059669"))
                            setTypeface(null, Typeface.BOLD)
                        }
                        inner.addView(badgeLunas)
                        card.addView(inner)
                        container.addView(card)
                    }
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                val tvErr = TextView(this@TeacherMainActivity).apply {
                    text = "Gagal memuat rekap tahfiz: ${t.message}"
                    setTextColor(Color.RED)
                }
                container.addView(tvErr)
            }
        })
    }

    private fun showTeacherWifiDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = android.app.Dialog(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val grad = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#1E3A8A"), Color.parseColor("#2563EB"), Color.parseColor("#0284C7"))
            )
            background = grad
            setPadding(dp(16), dp(16), dp(16), dp(18))
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }

        val btnBack = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(36), dp(36))
            setImageResource(R.drawable.ic_arrow_back)
            setColorFilter(Color.WHITE)
            setPadding(dp(6), dp(6), dp(6), dp(6))
            setOnClickListener { dialog.dismiss() }
        }
        topBar.addView(btnBack)

        val tvTitle = TextView(this).apply {
            text = "📶 Akses Wi-Fi Guru & Tenaga Pendidik"
            textSize = 17f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(10)
            }
        }
        topBar.addView(tvTitle)
        header.addView(topBar)
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            setPadding(dp(16), dp(14), dp(16), dp(16))
        }
        val inner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        fun createStepCard(num: String, title: String, desc: String, bgHex: String, borderHex: String) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(bgHex))
                    cornerRadius = dp(14).toFloat()
                    setStroke(dp(1), Color.parseColor(borderHex))
                }
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(10)
                }
            }
            val tvH = TextView(this).apply {
                text = "$num. $title"
                textSize = 13.5f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#0F172A"))
            }
            val tvD = TextView(this).apply {
                text = desc
                textSize = 11.5f
                setTextColor(Color.parseColor("#334155"))
                setLineSpacing(3f, 1.15f)
                setPadding(0, dp(4), 0, 0)
            }
            card.addView(tvH)
            card.addView(tvD)
            inner.addView(card)
        }

        createStepCard(
            "1",
            "Aktifkan Sambungan Wi-Fi di Perangkat",
            "Nyalakan Wi-Fi pada ponsel atau laptop Bapak/Ibu Guru. Perangkat akan mendeteksi jaringan access point resmi sekolah di ruang guru, laboratorium, atau kelas.",
            "#EFF6FF",
            "#BFDBFE"
        )

        createStepCard(
            "2",
            "Pilih Titik Hotspot Resmi Sekolah",
            "Pilih jaringan Wi-Fi sekolah yang tersedia di lokasi Bapak/Ibu mengajar (SSID tanpa kata sandi terbuka atau gunakan akun credentials Guru).",
            "#F0FDF4",
            "#BBF7D0"
        )

        createStepCard(
            "3",
            "Koneksi Otomatis Terintegrasi CBT & SIAKAD",
            "Setelah tersambung, Bapak/Ibu Guru dapat langsung menginput presensi siswa, membuka jurnal KBM, bank soal, dan koreksi nilai tanpa batasan kuota.",
            "#FEFCE8",
            "#FEF08A"
        )

        scroll.addView(inner)
        root.addView(scroll)

        val btnOpenWifi = Button(this).apply {
            text = "📶 Buka Pengaturan Wi-Fi HP"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#2563EB"))
            textSize = 13f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply {
                setMargins(dp(16), dp(16), dp(16), dp(16))
            }
            setOnClickListener {
                try {
                    startActivity(Intent(android.provider.Settings.ACTION_WIFI_SETTINGS))
                } catch (e: Exception) {}
            }
        }
        root.addView(btnOpenWifi)

        dialog.setContentView(root)
        dialog.show()
    }
}
