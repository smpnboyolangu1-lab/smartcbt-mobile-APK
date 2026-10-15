package com.school.smartcbt.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.os.BatteryManager
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.ExamActivity
import android.content.ClipboardManager
import android.os.Build
import android.os.Vibrator
import android.os.VibratorManager
import android.widget.ProgressBar
import com.school.smartcbt.ScannerActivity
import com.school.smartcbt.data.model.ActiveExamsResponse
import com.school.smartcbt.data.model.ExamItemDto
import com.school.smartcbt.data.model.VerifyTokenRequest
import com.school.smartcbt.data.model.VerifyTokenResponse
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityExambroGatewayBinding
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class ExambroGatewayActivity : AppCompatActivity() {

    private lateinit var binding: ActivityExambroGatewayBinding
    private lateinit var sessionManager: SessionManager
    private var allExams: List<ExamItemDto> = emptyList()
    private var fullSchedules: List<com.school.smartcbt.data.model.CbtScheduleAgendaDto> = emptyList()
    private var serverTodayDate: String? = null
    private var isCompletedTabActive: Boolean = false

    private var pendingTokenDialogExamId: String? = null
    private var pendingTokenDialogTitle: String? = null
    private var pendingTokenDialogSubject: String? = null
    private var pendingTokenDialogDuration: Int = 90
    private var activeTokenDialog: AlertDialog? = null
    private var activeEtTokenInput: EditText? = null

    private val scanTokenQrLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK && result.data != null) {
            val scannedToken = result.data?.getStringExtra(ScannerActivity.EXTRA_SCANNED_TOKEN)
            if (!scannedToken.isNullOrBlank()) {
                val clean = scannedToken.uppercase()
                activeEtTokenInput?.setText(clean)
                Toast.makeText(this, "✅ QR Token Terdeteksi: $clean", Toast.LENGTH_SHORT).show()

                val dialog = activeTokenDialog
                val examId = pendingTokenDialogExamId
                if (dialog != null && dialog.isShowing && examId != null) {
                    val title = pendingTokenDialogTitle ?: "Ujian"
                    val subject = pendingTokenDialogSubject ?: "Mata Pelajaran"
                    val duration = pendingTokenDialogDuration
                    val pb = dialog.findViewById<ProgressBar>(com.school.smartcbt.R.id.pbTokenLoading)
                    val errorLayout = dialog.findViewById<LinearLayout>(com.school.smartcbt.R.id.layoutTokenError)
                    val tvError = dialog.findViewById<TextView>(com.school.smartcbt.R.id.tvTokenErrorMessage)
                    val btnSubmit = dialog.findViewById<Button>(com.school.smartcbt.R.id.btnSubmitTokenDialog)
                    verifyAndLaunchExam(examId, title, subject, duration, clean, pb, errorLayout, tvError, btnSubmit, dialog)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityExambroGatewayBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)

        setupHeader()
        setupTabs()
        checkBatteryTelemetry()
        loadActiveExams()

        if (!com.school.smartcbt.utils.DialogHelper.isAllFilesAccessGranted(this)) {
            com.school.smartcbt.utils.DialogHelper.showMandatoryAllFilesDialog(this)
        }
    }

    override fun onResume() {
        super.onResume()
        if (!com.school.smartcbt.utils.DialogHelper.dismissMandatoryAllFilesDialogIfGranted(this)) {
            com.school.smartcbt.utils.DialogHelper.showMandatoryAllFilesDialog(this)
        }
    }

    private fun setupHeader() {
        binding.btnBackExambro.setOnClickListener { finish() }
        binding.btnRefreshExambro.setOnClickListener {
            Toast.makeText(this, "Menyegarkan jadwal ujian...", Toast.LENGTH_SHORT).show()
            loadActiveExams()
        }

        binding.cardCalendarAgenda.setOnClickListener {
            showFullCalendarAgendaDialog()
        }

        val name = sessionManager.getName().ifEmpty { "Peserta CBT" }
        val nisn = sessionManager.getNisn().ifEmpty { "0013929592" }
        val cName = sessionManager.getClassName().ifEmpty { "VII-A" }

        binding.tvExambroStudentName.text = "Peserta: $name"
        binding.tvExambroStudentClass.text = "NISN: $nisn • Rombel: $cName"
    }

    private fun setupTabs() {
        binding.btnTabExamActive.setOnClickListener {
            if (isCompletedTabActive) {
                isCompletedTabActive = false
                updateTabStyles()
                renderCurrentTabExams()
            }
        }
        binding.btnTabExamCompleted.setOnClickListener {
            if (!isCompletedTabActive) {
                isCompletedTabActive = true
                updateTabStyles()
                renderCurrentTabExams()
            }
        }
    }

    private fun updateTabStyles() {
        if (!isCompletedTabActive) {
            binding.btnTabExamActive.setBackgroundColor(Color.parseColor("#0A2E5C"))
            binding.btnTabExamActive.setTextColor(Color.WHITE)
            binding.btnTabExamCompleted.setBackgroundColor(Color.TRANSPARENT)
            binding.btnTabExamCompleted.setTextColor(Color.parseColor("#64748B"))
            binding.tvExamSectionTitle.text = "📝 DAFTAR JADWAL UJIAN HARI INI"
            binding.tvExamSectionSubtitle.text = "Pilih sesi ujian aktif hari ini untuk memasukkan token dan memulai ujian."
        } else {
            binding.btnTabExamCompleted.setBackgroundColor(Color.parseColor("#0A2E5C"))
            binding.btnTabExamCompleted.setTextColor(Color.WHITE)
            binding.btnTabExamActive.setBackgroundColor(Color.TRANSPARENT)
            binding.btnTabExamActive.setTextColor(Color.parseColor("#64748B"))
            binding.tvExamSectionTitle.text = "🏆 RIWAYAT UJIAN SELESAI"
            binding.tvExamSectionSubtitle.text = "Daftar ujian CBT yang telah berhasil dikerjakan dan tersimpan di server."
        }
    }

    private fun isExamCompleted(exam: ExamItemDto): Boolean {
        val st = exam.status.uppercase()
        return st == "FINISHED" || st == "COMPLETED" || st == "SUBMITTED" || st == "DONE"
    }

    private fun updateExamProgress() {
        val total = allExams.size
        val completed = allExams.count { isExamCompleted(it) }
        val pct = if (total > 0) (completed * 100) / total else 0
        binding.tvExamProgressSummary.text = "$completed/$total Selesai ($pct%)"
        binding.pbExamProgress.progress = pct
    }

    private fun renderCurrentTabExams() {
        val filtered = if (isCompletedTabActive) {
            allExams.filter { isExamCompleted(it) }
        } else {
            allExams.filter { !isExamCompleted(it) }
        }
        binding.tvExamCountBadge.text = "${filtered.size} Ujian"
        if (filtered.isNotEmpty()) {
            renderExamCards(filtered, isCompletedTabActive)
        } else {
            val emptyMsg = if (isCompletedTabActive) {
                "Belum ada sesi ujian CBT yang telah diselesaikan untuk akun Anda."
            } else {
                "Tidak ada jadwal ujian CBT aktif untuk hari ini. Gunakan menu 'Agenda Kalender Semua Jadwal Ujian' untuk melihat jadwal lengkap."
            }
            renderEmptyExamState(emptyMsg)
        }
    }

    private fun loadActiveExams() {
        ApiClient.getClient(this).getStudentCbtExams().enqueue(object : Callback<ActiveExamsResponse> {
            override fun onResponse(call: Call<ActiveExamsResponse>, response: Response<ActiveExamsResponse>) {
                val exams = response.body()?.exams ?: emptyList()
                fullSchedules = response.body()?.schedules ?: emptyList()
                serverTodayDate = response.body()?.todayDate
                allExams = exams
                updateExamProgress()
                renderCurrentTabExams()
            }

            override fun onFailure(call: Call<ActiveExamsResponse>, t: Throwable) {
                renderEmptyExamState("Tidak dapat terhubung ke server CBT (${t.message}). Pastikan jaringan lokal sekolah terhubung.")
            }
        })
    }

    private fun renderExamCards(exams: List<ExamItemDto>, isCompleted: Boolean = false) {
        binding.containerExamCards.removeAllViews()
        val density = resources.displayMetrics.density

        exams.forEach { exam ->
            val card = createExamCard(
                id = exam.id,
                title = exam.title,
                subject = exam.subject,
                duration = exam.durationMinutes,
                isTokenActive = exam.isTokenActive,
                token = exam.token,
                sessionName = exam.sessionName ?: "Sesi Ujian CBT",
                startTimeStr = exam.startTimeStr ?: "07:30",
                endTimeStr = exam.endTimeStr ?: "12:00",
                questionsCount = exam.questionsCount.takeIf { it > 0 } ?: 0,
                isCompleted = isCompleted,
                density = density
            )
            binding.containerExamCards.addView(card)
        }
    }

    private fun checkBatteryTelemetry() {
        try {
            val batteryFilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val batteryStatus = registerReceiver(null, batteryFilter)
            val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val batteryPct = if (level >= 0 && scale > 0) (level * 100 / scale) else 85

            binding.tvExambroBattery.text = "🔋 Baterai: $batteryPct%"
            if (batteryPct < 20) {
                binding.tvExambroBattery.setTextColor(Color.parseColor("#991B1B"))
                binding.tvExambroBattery.setBackgroundColor(Color.parseColor("#FEE2E2"))
            }
        } catch (e: Exception) {
            binding.tvExambroBattery.text = "🔋 Baterai: 85%"
        }
    }

    private fun renderEmptyExamState(message: String) {
        binding.containerExamCards.removeAllViews()
        val density = resources.displayMetrics.density

        val card = CardView(this).apply {
            radius = 16 * density
            cardElevation = 2 * density
            useCompatPadding = true
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = (24 * density).toInt()
            }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val pad = (28 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val tvIcon = TextView(this).apply {
            text = "📭"
            textSize = 44f
            gravity = Gravity.CENTER
        }
        layout.addView(tvIcon)

        val tvTitle = TextView(this).apply {
            text = "Belum Ada Jadwal Ujian Aktif"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, (12 * density).toInt(), 0, 0)
        }
        layout.addView(tvTitle)

        val tvDesc = TextView(this).apply {
            text = message
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(0, (6 * density).toInt(), 0, (16 * density).toInt())
        }
        layout.addView(tvDesc)

        val btnRefresh = Button(this).apply {
            text = "🔄 Segarkan Jadwal"
            setBackgroundColor(Color.parseColor("#1E3A8A"))
            setTextColor(Color.WHITE)
            textSize = 12f
            setOnClickListener { loadActiveExams() }
        }
        layout.addView(btnRefresh)

        card.addView(layout)
        binding.containerExamCards.addView(card)
    }

    private fun createExamCard(
        id: String,
        title: String,
        subject: String,
        duration: Int,
        isTokenActive: Boolean,
        token: String?,
        sessionName: String,
        startTimeStr: String,
        endTimeStr: String,
        questionsCount: Int,
        isCompleted: Boolean = false,
        density: Float
    ): CardView {
        val card = CardView(this).apply {
            radius = 14 * density
            cardElevation = 2.5f * density
            useCompatPadding = true
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (12 * density).toInt()
            }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        // Row 1: Session Badge & Token Status Pill
        val rowTop = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val tvSession = TextView(this).apply {
            text = "🏛️ $sessionName"
            setTextColor(Color.parseColor("#475569"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        rowTop.addView(tvSession)

        val tvTokenBadge = TextView(this).apply {
            val (badgeText, badgeFg, badgeBg) = when {
                isCompleted -> Triple("✅ Sudah Selesai Dikerjakan", "#166534", "#DCFCE7")
                isTokenActive -> Triple("🔒 Butuh Token Pengawas", "#991B1B", "#FEE2E2")
                else -> Triple("🔓 Bebas Token (Langsung Mulai)", "#065F46", "#D1FAE5")
            }
            text = badgeText
            setTextColor(Color.parseColor(badgeFg))
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            val gdBadge = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 8 * density
                setColor(Color.parseColor(badgeBg))
            }
            background = gdBadge
            val hP = (10 * density).toInt()
            val vP = (4 * density).toInt()
            setPadding(hP, vP, hP, vP)
        }
        rowTop.addView(tvTokenBadge)
        root.addView(rowTop)

        // Row 2: Subject & Title
        val tvSubject = TextView(this).apply {
            text = subject
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (6 * density).toInt(), 0, 0)
        }
        root.addView(tvSubject)

        val tvTitle = TextView(this).apply {
            text = title
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            setPadding(0, (2 * density).toInt(), 0, (8 * density).toInt())
        }
        root.addView(tvTitle)

        // Row 3: Jam Ujian Highlight Banner
        val bannerTime = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val gdBanner = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 10 * density
                setColor(Color.parseColor(if (isCompleted) "#F0FDF4" else "#EFF6FF"))
            }
            background = gdBanner
            val pB = (10 * density).toInt()
            setPadding(pB, pB, pB, pB)
        }

        val tvTime = TextView(this).apply {
            text = if (isCompleted) "✓ Status: Telah Diserahkan" else "🕒 Jam Ujian: $startTimeStr - $endTimeStr WIB"
            setTextColor(Color.parseColor(if (isCompleted) "#15803D" else "#1D4ED8"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        bannerTime.addView(tvTime)

        val tvDuration = TextView(this).apply {
            text = "⏱️ $duration Menit • $questionsCount Soal"
            setTextColor(Color.parseColor(if (isCompleted) "#166534" else "#1E40AF"))
            textSize = 11f
        }
        bannerTime.addView(tvDuration)
        root.addView(bannerTime)

        // Row 4: Action Button "Mulai Ujian / Masukkan Token / Selesai"
        val btnStart = androidx.appcompat.widget.AppCompatButton(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (46 * density).toInt()
            ).apply {
                topMargin = (12 * density).toInt()
            }
            val gdBtn = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 12 * density
                setColor(Color.parseColor(if (isCompleted) "#E2E8F0" else if (isTokenActive) "#D97706" else "#1E3A8A"))
            }
            background = gdBtn
            stateListAnimator = null
            elevation = 0f
            if (isCompleted) {
                text = "🔒 SUDAH SELESAI (TIDAK BISA DIULANG)"
                setTextColor(Color.parseColor("#475569"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                isEnabled = true
                setOnClickListener {
                    AlertDialog.Builder(this@ExambroGatewayActivity)
                        .setTitle("🔒 Ujian Sudah Diselesaikan")
                        .setMessage("Anda telah menyelesaikan ujian ini dan lembar jawaban tersimpan resmi di Server Proktor.\n\nSesuai regulasi Asesmen CBT, siswa tidak diperkenankan mengulang pengerjaan atau meminta token kembali.")
                        .setPositiveButton("Mengerti", null)
                        .show()
                }
            } else {
                text = if (isTokenActive) "🔑 Masukkan Token & Buka Ujian" else "🚀 Buka ExamBrowser Sekarang"
                setTextColor(Color.WHITE)
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
            }
        }

        if (!isCompleted) {
            val clickListener = View.OnClickListener {
                handleExamClick(id, title, subject, duration, isTokenActive, token)
            }
            btnStart.setOnClickListener(clickListener)
            card.setOnClickListener(clickListener)
        } else {
            card.setOnClickListener {
                AlertDialog.Builder(this@ExambroGatewayActivity)
                    .setTitle("🔒 Ujian Sudah Diselesaikan")
                    .setMessage("Anda telah menyelesaikan ujian ini dan lembar jawaban tersimpan resmi di Server Proktor.\n\nSesuai regulasi Asesmen CBT, siswa tidak diperkenankan mengulang pengerjaan atau meminta token kembali.")
                    .setPositiveButton("Mengerti", null)
                    .show()
            }
        }

        root.addView(btnStart)
        card.addView(root)
        return card
    }

    private fun handleExamClick(examId: String, title: String, subject: String, duration: Int, isTokenActive: Boolean, expectedToken: String?) {
        if (!isTokenActive) {
            showParticipantConfirmationFullScreen(examId, title, subject, duration, expectedToken ?: "UNBK26")
        } else {
            promptExamToken(examId, title, subject, duration, expectedToken)
        }
    }

    private fun promptExamToken(examId: String, title: String, subject: String, duration: Int, expectedToken: String?) {
        pendingTokenDialogExamId = examId
        pendingTokenDialogTitle = title
        pendingTokenDialogSubject = subject
        pendingTokenDialogDuration = duration

        val dialogView = layoutInflater.inflate(com.school.smartcbt.R.layout.dialog_exam_token_modern, null)
        val tvTitle = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvTokenDialogTitle)
        val tvSubject = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvTokenDialogSubject)
        val tvClass = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvTokenDialogClass)
        val cbIntegrity = dialogView.findViewById<android.widget.CheckBox>(com.school.smartcbt.R.id.cbAgreeIntegrity)
        val etToken = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etExamTokenInput)
        val btnPaste = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnPasteToken)
        val layoutError = dialogView.findViewById<LinearLayout>(com.school.smartcbt.R.id.layoutTokenError)
        val tvErrorMessage = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvTokenErrorMessage)
        val pbLoading = dialogView.findViewById<ProgressBar>(com.school.smartcbt.R.id.pbTokenLoading)
        val btnCancel = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnCancelTokenDialog)
        val btnSubmit = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnSubmitTokenDialog)

        activeEtTokenInput = etToken
        etToken.filters = arrayOf(android.text.InputFilter.AllCaps(), android.text.InputFilter.LengthFilter(15))
        etToken.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                val upper = s?.toString()?.uppercase()
                if (upper != null && upper != s.toString()) {
                    val pos = etToken.selectionStart
                    etToken.setText(upper)
                    etToken.setSelection(pos.coerceAtMost(upper.length))
                }
            }
        })

        tvTitle.text = title
        tvSubject.text = "$subject • $duration Menit"
        val studentClass = sessionManager.getClassName().trim()
        tvClass.text = if (studentClass.isNotEmpty()) "🏛️ Ruang / Rombel: Kelas $studentClass" else "🏛️ Ruang / Rombel: Peserta CBT"

        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            .setView(dialogView)
            .setCancelable(true)
            .create()

        activeTokenDialog = dialog

        // Paste dari Clipboard
        btnPaste.setOnClickListener {
            try {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = clipboard.primaryClip
                if (clip != null && clip.itemCount > 0) {
                    val pasted = clip.getItemAt(0).text?.toString()?.trim()?.uppercase() ?: ""
                    if (pasted.isNotEmpty()) {
                        etToken.setText(pasted)
                        etToken.setSelection(pasted.length)
                        layoutError.visibility = View.GONE
                        Toast.makeText(this, "📋 Berhasil menempel token: $pasted", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this, "Clipboard kosong", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    Toast.makeText(this, "Clipboard kosong", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this, "Gagal menempel: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }

        btnSubmit.setOnClickListener {
            if (!com.school.smartcbt.utils.DialogHelper.isAllFilesAccessGranted(this)) {
                com.school.smartcbt.utils.DialogHelper.showMandatoryAllFilesDialog(this)
                return@setOnClickListener
            }
            if (cbIntegrity != null && !cbIntegrity.isChecked) {
                layoutError.visibility = View.VISIBLE
                tvErrorMessage.text = "⚠️ Anda wajib menyetujui Tata Tertib & Pakta Integritas sebelum memulai ujian."
                vibrateError()
                return@setOnClickListener
            }
            val entered = etToken.text.toString().trim().uppercase()
            if (entered.isEmpty()) {
                layoutError.visibility = View.VISIBLE
                tvErrorMessage.text = "⚠️ Token ujian tidak boleh kosong. Masukkan kode dari Pengawas Ruang."
                vibrateError()
                return@setOnClickListener
            }
            verifyAndLaunchExam(examId, title, subject, duration, entered, pbLoading, layoutError, tvErrorMessage, btnSubmit, dialog)
        }

        dialog.show()
        dialog.window?.setLayout(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.MATCH_PARENT
        )
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.parseColor("#F8FAFC")))
    }

    private fun verifyAndLaunchExam(
        examId: String,
        title: String,
        subject: String,
        duration: Int,
        token: String,
        pbLoading: ProgressBar?,
        layoutError: LinearLayout?,
        tvErrorMessage: TextView?,
        btnSubmit: Button?,
        dialog: AlertDialog?
    ) {
        pbLoading?.visibility = View.VISIBLE
        layoutError?.visibility = View.GONE
        btnSubmit?.isEnabled = false
        btnSubmit?.text = "Memverifikasi..."

        ApiClient.getClient(this).verifyExamToken(VerifyTokenRequest(examId, token))
            .enqueue(object : Callback<VerifyTokenResponse> {
                override fun onResponse(call: Call<VerifyTokenResponse>, response: Response<VerifyTokenResponse>) {
                    pbLoading?.visibility = View.GONE
                    btnSubmit?.isEnabled = true
                    btnSubmit?.text = "🚀 Verifikasi & Mulai"

                    if (response.isSuccessful && response.body()?.valid == true) {
                        dialog?.dismiss()
                        com.school.smartcbt.utils.ClientLogger.logCbt(
                            context = this@ExambroGatewayActivity,
                            action = "VERIFY_TOKEN",
                            outcome = "SUCCESS",
                            message = "Token valid ($token) untuk ujian $title",
                            examId = examId,
                            token = token
                        )
                        Toast.makeText(this@ExambroGatewayActivity, "✅ Token Valid! Membuka Konfirmasi Data...", Toast.LENGTH_SHORT).show()
                        showParticipantConfirmationFullScreen(examId, title, subject, duration, token)
                    } else {
                        val errMsg = response.body()?.message ?: try {
                            val errJson = response.errorBody()?.string()
                            org.json.JSONObject(errJson ?: "").optString("message", "Token ujian tidak valid atau belum dirilis Pengawas.")
                        } catch (e: Exception) { "Token ujian tidak valid atau belum dirilis Pengawas." }

                        com.school.smartcbt.utils.ClientLogger.logCbt(
                            context = this@ExambroGatewayActivity,
                            action = "VERIFY_TOKEN",
                            outcome = "REJECTED",
                            message = "Token ditolak: $errMsg",
                            examId = examId,
                            token = token
                        )

                        layoutError?.visibility = View.VISIBLE
                        tvErrorMessage?.text = "❌ $errMsg"
                        vibrateError()
                        Toast.makeText(this@ExambroGatewayActivity, "⚠️ Akses Ditolak: $errMsg", Toast.LENGTH_LONG).show()
                    }
                }

                override fun onFailure(call: Call<VerifyTokenResponse>, t: Throwable) {
                    pbLoading?.visibility = View.GONE
                    btnSubmit?.isEnabled = true
                    btnSubmit?.text = "🚀 Verifikasi & Mulai"

                    val netMsg = t.message ?: "Koneksi terputus"
                    com.school.smartcbt.utils.ClientLogger.logCbt(
                        context = this@ExambroGatewayActivity,
                        action = "VERIFY_TOKEN",
                        outcome = "ERROR",
                        message = "Koneksi verifikasi token gagal: $netMsg",
                        examId = examId,
                        token = token
                    )

                    layoutError?.visibility = View.VISIBLE
                    tvErrorMessage?.text = "⚠️ Gagal memverifikasi token ke Server: $netMsg. Pastikan perangkat terhubung ke Wi-Fi sekolah."
                    vibrateError()
                    Toast.makeText(this@ExambroGatewayActivity, "❌ Verifikasi Token Gagal: Soal tidak dapat diakses!", Toast.LENGTH_LONG).show()
                }
            })
    }

    private fun vibrateError() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator?.vibrate(android.os.VibrationEffect.createOneShot(200, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                v?.vibrate(200)
            }
        } catch (e: Exception) {}
    }

    private fun launchExamSession(examId: String, title: String, subject: String, duration: Int, token: String) {
        val intent = Intent(this, ExamActivity::class.java).apply {
            putExtra("EXAM_ID", examId)
            putExtra("EXAM_TITLE", title)
            putExtra("EXAM_SUBJECT", "$subject ($duration Menit)")
            putExtra("EXAM_DURATION", duration)
            putExtra("EXAM_TOKEN", token)
        }
        startActivity(intent)
    }

    private fun showParticipantConfirmationFullScreen(
        examId: String,
        title: String,
        subject: String,
        duration: Int,
        token: String
    ) {
        val density = resources.displayMetrics.density
        val studentName = sessionManager.getName().ifEmpty { "Peserta CBT" }
        val studentNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }.ifEmpty { "0013929592" }
        val studentClass = sessionManager.getClassName().ifEmpty { "VII-A" }

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Header Form Formal
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * density).toInt()
            setPadding(p, p, p, (14 * density).toInt())
            setBackgroundColor(Color.parseColor("#0A2540"))
        }

        val tvBadgeFormal = TextView(this).apply {
            text = "🏛️ SISTEM ASESMEN CBT TERSTANDAR SMP"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            letterSpacing = 0.05f
        }
        headerLayout.addView(tvBadgeFormal)

        val tvHeaderTitle = TextView(this).apply {
            text = "LEMBAR KONFIRMASI DATA UJIAN"
            setTextColor(Color.WHITE)
            textSize = 19f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (4 * density).toInt(), 0, (2 * density).toInt())
        }
        headerLayout.addView(tvHeaderTitle)

        val tvHeaderSub = TextView(this).apply {
            text = "Periksa kelengkapan identitas peserta & paket ujian sebelum memulai pengerjaan."
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
        }
        headerLayout.addView(tvHeaderSub)
        rootLayout.addView(headerLayout)

        // Scroll Content
        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        // Card 1: Identitas Peserta
        val cardPeserta = CardView(this).apply {
            radius = 16 * density
            cardElevation = 3 * density
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
        }
        val innerPeserta = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvSection1 = TextView(this).apply {
            text = "👤 IDENTITAS PESERTA UJIAN"
            setTextColor(Color.parseColor("#1E3A8A"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, (10 * density).toInt())
        }
        innerPeserta.addView(tvSection1)
        innerPeserta.addView(createDataRow("Nama Peserta", studentName, density))
        innerPeserta.addView(createDataRow("Nomor Peserta / NISN", studentNisn, density))
        innerPeserta.addView(createDataRow("Rombel / Kelas", "Kelas $studentClass", density))
        innerPeserta.addView(createDataRow("Sekolah", "SMP NEGERI 1 BOYOLANGU", density))
        cardPeserta.addView(innerPeserta)
        contentLayout.addView(cardPeserta)

        // Card 2: Rincian Paket Ujian
        val cardExam = CardView(this).apply {
            radius = 16 * density
            cardElevation = 3 * density
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
        }
        val innerExam = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvSection2 = TextView(this).apply {
            text = "📑 RINCIAN SESI & NASKAH UJIAN"
            setTextColor(Color.parseColor("#0F766E"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, (10 * density).toInt())
        }
        innerExam.addView(tvSection2)
        innerExam.addView(createDataRow("Mata Pelajaran", subject, density))
        innerExam.addView(createDataRow("Judul Asesmen", title, density))
        innerExam.addView(createDataRow("Alokasi Waktu", "$duration Menit", density))
        innerExam.addView(createDataRow("Format Soal", "Pilihan Ganda (4 Opsi A-D Standar SMP) & Isian", density))
        innerExam.addView(createDataRow("Token Pengawas", "$token (Valid)", density))
        cardExam.addView(innerExam)
        contentLayout.addView(cardExam)

        // Card 3: Pakta Integritas & Kiosk Lock
        val cardWarning = CardView(this).apply {
            radius = 16 * density
            cardElevation = 3 * density
            setCardBackgroundColor(Color.parseColor("#FFF1F2"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
        }
        val innerWarning = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvWarningHead = TextView(this).apply {
            text = "🛡️ PAKTA INTEGRITAS & ATURAN LOCKDOWN"
            setTextColor(Color.parseColor("#BE123C"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
        }
        innerWarning.addView(tvWarningHead)

        val tvWarningBody = TextView(this).apply {
            text = "1. Aplikasi ini terkunci dalam Mode Kiosk CBT. Tombol navigasi keluar dan recent apps dinonaktifkan.\n" +
                    "2. Membuka jendela lain atau menekan tombol home dihitung sebagai pelanggaran (Strike).\n" +
                    "3. ⚠️ PENTING: Sekali Anda menekan 'Selesai' atau mengumpulkan lembar ujian, status ujian dinyatakan SELESAI dan Anda TIDAK BISA DIULANG KEMBALI atau meminta token lagi!"
            setTextColor(Color.parseColor("#9F1239"))
            textSize = 11.5f
            setPadding(0, (8 * density).toInt(), 0, 0)
            setLineSpacing(0f, 1.2f)
        }
        innerWarning.addView(tvWarningBody)
        cardWarning.addView(innerWarning)
        contentLayout.addView(cardWarning)

        scrollView.addView(contentLayout)
        rootLayout.addView(scrollView)

        // Sticky Footer: Action Buttons
        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#0A2540"))
        }

        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            .setView(rootLayout)
            .setCancelable(false)
            .create()

        val btnStartNow = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "🚀 MULAI MENGERJAKAN UJIAN SEKARANG"
            setTextColor(Color.WHITE)
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 12 * density
                setColor(Color.parseColor("#059669"))
            }
            background = gd
            stateListAnimator = null
            elevation = 0f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (50 * density).toInt())
            setOnClickListener {
                dialog.dismiss()
                launchExamSession(examId, title, subject, duration, token)
            }
        }
        footer.addView(btnStartNow)

        val btnCancel = Button(this).apply {
            text = "Batal / Kembali"
            setBackgroundColor(Color.TRANSPARENT)
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * density).toInt()).apply {
                topMargin = (6 * density).toInt()
            }
            setOnClickListener {
                dialog.dismiss()
            }
        }
        footer.addView(btnCancel)
        rootLayout.addView(footer)

        dialog.show()
    }

    private fun createDataRow(label: String, value: String, density: Float): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, (4 * density).toInt(), 0, (4 * density).toInt())
        }
        val tvLabel = TextView(this).apply {
            text = label
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f)
        }
        val tvVal = TextView(this).apply {
            text = value
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 2f)
        }
        row.addView(tvLabel)
        row.addView(tvVal)
        return row
    }

    private fun showFullCalendarAgendaDialog() {
        val density = resources.displayMetrics.density

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#0A2E5C"))
        }

        val tvTitle = TextView(this).apply {
            text = "📅 AGENDA SEMUA JADWAL UJIAN CBT"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        header.addView(tvTitle)

        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            .setView(rootLayout)
            .setCancelable(true)
            .create()

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "✕ Tutup"
            setTextColor(Color.WHITE)
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 8 * density
                setColor(Color.parseColor("#1E3A8A"))
            }
            background = gd
            stateListAnimator = null
            elevation = 0f
            setOnClickListener { dialog.dismiss() }
        }
        header.addView(btnClose)
        rootLayout.addView(header)

        // Subheader Info
        val subheader = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#EFF6FF"))
        }
        val tvSub = TextView(this).apply {
            text = "Daftar lengkap sesi ujian yang terjadwal di kalender untuk kelas Anda. Ujian yang aktif pada tanggal hari ini dapat langsung dikerjakan dari beranda."
            setTextColor(Color.parseColor("#1E40AF"))
            textSize = 11.5f
        }
        subheader.addView(tvSub)
        rootLayout.addView(subheader)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        // Tab Selector: [🔥 Sesi Ujian Aktif] vs [✅ Riwayat Selesai]
        val tabBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val p = (12 * density).toInt()
            setPadding(p, (8 * density).toInt(), p, (8 * density).toInt())
            setBackgroundColor(Color.WHITE)
        }

        var isCompletedAgendaTab = false
        val activeCount = fullSchedules.count { !it.isCompleted }
        val completedCount = fullSchedules.count { it.isCompleted }

        val btnAgendaActive = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "🔥 Sesi Ujian ($activeCount)"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, (40 * density).toInt(), 1f).apply { marginEnd = (4 * density).toInt() }
        }

        val btnAgendaCompleted = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "✅ Riwayat Selesai ($completedCount)"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, (40 * density).toInt(), 1f).apply { marginStart = (4 * density).toInt() }
        }

        fun updateAgendaTabStyles() {
            if (!isCompletedAgendaTab) {
                btnAgendaActive.setTextColor(Color.WHITE)
                btnAgendaActive.background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 10 * density
                    setColor(Color.parseColor("#0A2E5C"))
                }
                btnAgendaCompleted.setTextColor(Color.parseColor("#64748B"))
                btnAgendaCompleted.background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 10 * density
                    setColor(Color.parseColor("#F1F5F9"))
                }
            } else {
                btnAgendaCompleted.setTextColor(Color.WHITE)
                btnAgendaCompleted.background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 10 * density
                    setColor(Color.parseColor("#059669"))
                }
                btnAgendaActive.setTextColor(Color.parseColor("#64748B"))
                btnAgendaActive.background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 10 * density
                    setColor(Color.parseColor("#F1F5F9"))
                }
            }
        }

        fun renderAgendaList() {
            container.removeAllViews()
            val filtered = if (!isCompletedAgendaTab) {
                fullSchedules.filter { !it.isCompleted }
            } else {
                fullSchedules.filter { it.isCompleted }
            }

            if (filtered.isEmpty()) {
                val tvEmpty = TextView(this).apply {
                    text = if (!isCompletedAgendaTab) {
                        "📭 Tidak ada sesi ujian aktif atau mendatang yang tersisa untuk kelas Anda."
                    } else {
                        "📭 Belum ada riwayat ujian yang telah diselesaikan."
                    }
                    setTextColor(Color.parseColor("#64748B"))
                    textSize = 13f
                    gravity = Gravity.CENTER
                    setPadding(0, (40 * density).toInt(), 0, (40 * density).toInt())
                }
                container.addView(tvEmpty)
            } else {
                val grouped = filtered.groupBy { it.executionDate ?: "Jadwal Terbuka" }
                grouped.forEach { (dateStr, items) ->
                    val isToday = items.any { it.isToday }
                    val headerDate = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        setPadding(0, (12 * density).toInt(), 0, (6 * density).toInt())
                    }
                    val tvDate = TextView(this).apply {
                        text = "🗓️ Tanggal: $dateStr"
                        setTextColor(Color.parseColor(if (isToday) "#0A2E5C" else "#334155"))
                        textSize = 14f
                        setTypeface(null, Typeface.BOLD)
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    }
                    headerDate.addView(tvDate)

                    if (isToday) {
                        val tvTodayBadge = TextView(this).apply {
                            text = "🔥 HARI INI"
                            setTextColor(Color.parseColor("#BE123C"))
                            textSize = 10f
                            setTypeface(null, Typeface.BOLD)
                            val gd = android.graphics.drawable.GradientDrawable().apply {
                                cornerRadius = 6 * density
                                setColor(Color.parseColor("#FFE4E6"))
                            }
                            background = gd
                            val pB = (6 * density).toInt()
                            setPadding(pB, (2 * density).toInt(), pB, (2 * density).toInt())
                        }
                        headerDate.addView(tvTodayBadge)
                    }
                    container.addView(headerDate)

                    items.forEach { sched ->
                        val c = CardView(this).apply {
                            radius = 12 * density
                            cardElevation = 2 * density
                            useCompatPadding = true
                            setCardBackgroundColor(Color.WHITE)
                            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = (6 * density).toInt()
                            }
                        }
                        val itemLayout = LinearLayout(this).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = (12 * density).toInt()
                            setPadding(p, p, p, p)
                        }

                        val rowTop = LinearLayout(this).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                        }
                        val tvMapel = TextView(this).apply {
                            text = "${sched.subject} - ${sched.title}"
                            setTextColor(Color.parseColor("#0F172A"))
                            textSize = 13f
                            setTypeface(null, Typeface.BOLD)
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        val tvStatus = TextView(this).apply {
                            val (sText, sFg, sBg) = when {
                                sched.isCompleted -> Triple("✅ Selesai", "#15803D", "#DCFCE7")
                                sched.isToday -> Triple("🚀 Aktif Hari Ini", "#1D4ED8", "#DBEAFE")
                                else -> Triple("⏳ Terjadwal", "#475569", "#F1F5F9")
                            }
                            text = sText
                            setTextColor(Color.parseColor(sFg))
                            textSize = 10f
                            setTypeface(null, Typeface.BOLD)
                            val gd = android.graphics.drawable.GradientDrawable().apply {
                                cornerRadius = 6 * density
                                setColor(Color.parseColor(sBg))
                            }
                            background = gd
                            val hP = (8 * density).toInt()
                            setPadding(hP, (3 * density).toInt(), hP, (3 * density).toInt())
                        }
                        rowTop.addView(tvMapel)
                        rowTop.addView(tvStatus)
                        itemLayout.addView(rowTop)

                        val tvDetails = TextView(this).apply {
                            text = "🕒 Jam: ${sched.startTimeStr ?: "07:30"} - ${sched.endTimeStr ?: "12:00"} WIB • ⏱️ ${sched.durationMinutes} Menit • 🏛️ ${sched.sessionName ?: "Sesi CBT"}"
                            setTextColor(Color.parseColor("#64748B"))
                            textSize = 11f
                            setPadding(0, (4 * density).toInt(), 0, 0)
                        }
                        itemLayout.addView(tvDetails)

                        c.addView(itemLayout)
                        container.addView(c)
                    }
                }
            }
        }

        btnAgendaActive.setOnClickListener {
            if (isCompletedAgendaTab) {
                isCompletedAgendaTab = false
                updateAgendaTabStyles()
                renderAgendaList()
            }
        }

        btnAgendaCompleted.setOnClickListener {
            if (!isCompletedAgendaTab) {
                isCompletedAgendaTab = true
                updateAgendaTabStyles()
                renderAgendaList()
            }
        }

        updateAgendaTabStyles()
        renderAgendaList()

        tabBar.addView(btnAgendaActive)
        tabBar.addView(btnAgendaCompleted)
        rootLayout.addView(tabBar)

        scroll.addView(container)
        rootLayout.addView(scroll)
        dialog.show()
    }
}
