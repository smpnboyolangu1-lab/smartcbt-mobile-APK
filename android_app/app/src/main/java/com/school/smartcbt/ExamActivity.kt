package com.school.smartcbt

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.view.ActionMode
import android.view.Gravity
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.databinding.ActivityExamBinding
import com.school.smartcbt.utils.SessionManager
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.data.local.AppDatabase
import com.school.smartcbt.data.local.QuestionEntity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.widget.ImageView
import android.widget.SeekBar
import android.graphics.BitmapFactory
import java.net.URL

enum class QuestionType {
    MULTIPLE_CHOICE, MATCHING, ESSAY
}

data class QuestionModel(
    val id: String,
    val text: String,
    val type: QuestionType = QuestionType.MULTIPLE_CHOICE,
    val options: List<String> = emptyList(), // OPSI A, B, C, D (4 Pilihan)
    val imageUrl: String? = null,
    val audioUrl: String? = null,
    val correctOption: String? = null,
    val explanation: String? = null
)

class ExamActivity : AppCompatActivity() {

    private lateinit var binding: ActivityExamBinding
    private lateinit var sessionManager: SessionManager
    private var currentFontSizeScale = 1.0f
    private var strikeCount = 0
    private var maxAllowedStrikes = 3
    private var remainingStrikes = 3
    private var lastStrikeTime = 0L
    private var activeExamToken: String? = null
    private var countDownTimer: CountDownTimer? = null
    private var currentQuestionIndex = 0
    private var studentExamId: String? = null
    private var examId: String? = null
    private var examDurationMinutes: Int = 90
    private var isExamFinishedNormally: Boolean = false

    private val autoSaveHandler = Handler(Looper.getMainLooper())
    private val autoSaveRunnable = object : Runnable {
        override fun run() {
            if (studentAnswers.isNotEmpty()) {
                submitExamAnswers(isFinished = false)
            }
            autoSaveHandler.postDelayed(this, 30_000)
        }
    }
    private var essayTextWatcher: TextWatcher? = null
    private val essayDebounceHandler = Handler(Looper.getMainLooper())
    private var essayDebounceRunnable: Runnable? = null

    // Audio Player untuk Soal Listening
    private var mediaPlayer: MediaPlayer? = null
    private var isAudioPlaying = false
    private val audioHandler = Handler(Looper.getMainLooper())
    private var audioProgressRunnable: Runnable? = null
    private val audioPlayCountMap = mutableMapOf<Int, Int>()
    private val maxAudioPlays = 2

    // 🛡️ DYNAMIC ANTI-PHOTO SHIELD (BLUR SOAL OTOMATIS 5 DETIK TANPA SENTUHAN)
    private val antiPhotoBlurHandler = Handler(Looper.getMainLooper())
    private val antiPhotoBlurRunnable = Runnable {
        showAntiPhotoBlurShield()
    }
    private val ANTI_PHOTO_INACTIVITY_MS = 5000L

    // 🛡️ ANTI-CHEAT ONPAUSE GRACE PERIOD (3.5 DETIK TOLERANSI GANGGUAN SESAAT)
    private val strikeGracePeriodHandler = Handler(Looper.getMainLooper())
    private var pendingStrikeRunnable: Runnable? = null

    // DAFTAR SOAL UJIAN CBT
    private val questionsList: MutableList<QuestionModel> = mutableListOf()

    companion object {
        private fun generateExamQuestions(): List<QuestionModel> {
            val list = mutableListOf<QuestionModel>()
            val sampleQuestions = listOf(
                "Berapakah hasil dari 15 x 12 - 50?" to listOf("120", "130", "140", "150"),
                "Sebuah persegi memiliki keliling 48 cm. Berapakah luas persegi tersebut?" to listOf("124 cm²", "144 cm²", "169 cm²", "196 cm²"),
                "Jika nilai x = 4 dan y = 3, maka nilai dari 3x² + 2y - 10 adalah..." to listOf("44", "48", "52", "56"),
                "Panjang hipotenusa segitiga siku-siku dengan alas 6 cm dan tinggi 8 cm adalah..." to listOf("9 cm", "10 cm", "12 cm", "14 cm"),
                "Di antara pecahan berikut, manakah yang memiliki nilai paling besar?" to listOf("3/4", "5/8", "7/10", "2/3"),
                "Berapakah rata-rata (mean) dari data nilai: 70, 80, 85, 90, 75?" to listOf("78", "80", "82", "84"),
                "Sebuah lingkaran memiliki jari-jari 14 cm. Berapakah luas lingkaran tersebut? (π = 22/7)" to listOf("528 cm²", "616 cm²", "628 cm²", "716 cm²"),
                "Berapakah FPB (Faktor Persekutuan Terbesar) dari 24 dan 36?" to listOf("6", "8", "12", "18")
            )

            for (i in 1..50) {
                if (i == 3) {
                    list.add(
                        QuestionModel(
                            "" + i,
                            "Jodohkan istilah statistika berikut dengan definisinya yang tepat:\n(Pilih pasangan nomor dan huruf yang benar)",
                            QuestionType.MATCHING,
                            listOf(
                                "1-A, 2-B, 3-C (Modus-Terbanyak, Median-Tengah, Mean-Rata2)",
                                "1-B, 2-A, 3-C (Modus-Rata2, Median-Terbanyak, Mean-Tengah)",
                                "1-C, 2-B, 3-A (Modus-Tengah, Median-Terbanyak, Mean-Rata2)",
                                "1-A, 2-C, 3-B (Modus-Terbanyak, Median-Rata2, Mean-Tengah)"
                            )
                        )
                    )
                } else if (i == 50) {
                    list.add(
                        QuestionModel(
                            "" + i,
                            "Jelaskan langkah-langkah menghitung volume tabung dengan diameter alas 14 cm dan tinggi 20 cm! (Tuliskan rumus dan penjabarannya secara runtut)",
                            QuestionType.ESSAY
                        )
                    )
                } else {
                    val sample = sampleQuestions[(i - 1) % sampleQuestions.size]
                    list.add(
                        QuestionModel(
                            "" + i,
                            "Soal Nomor " + i + ": " + sample.first,
                            QuestionType.MULTIPLE_CHOICE,
                            sample.second
                        )
                    )
                }
            }
            return list
        }
    }

    private val studentAnswers = mutableMapOf<Int, String>()
    private val doubtStatus = mutableMapOf<Int, Boolean>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. EXAMBROWSER SECURITY: FLAG_SECURE (Blokir Screenshot, Screen Recording & Cast)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        // 2. EXAMBROWSER ENTERPRISE SECURITY: Blokir Floating Overlays & Chat Bubbles (Android 12+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                window.setHideOverlayWindows(true)
            } catch (e: Exception) {}
        }

        binding = ActivityExamBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)

        if (!com.school.smartcbt.utils.DialogHelper.isAllFilesAccessGranted(this)) {
            com.school.smartcbt.utils.DialogHelper.showMandatoryAllFilesDialog(this)
            return
        }

        examId = intent.getStringExtra("EXAM_ID")
        examDurationMinutes = intent.getIntExtra("EXAM_DURATION", 90)
        val token = intent.getStringExtra("EXAM_TOKEN") ?: ""
        activeExamToken = token

        applyKioskImmersiveMode()
        applyAntiPasteSecurity()

        // BUG-NEW-07 Fix: Cek Accessibility Services pihak ketiga
        if (!checkAccessibilityServices()) {
            return
        }

        setupExamHeader()
        setupQuestionNavigation()
        setupBackBlocker()
        setupAntiPhotoSecurity()

        fetchExamQuestions(examId, token)
    }

    private fun fetchExamQuestions(eId: String?, token: String) {
        if (token.isBlank()) {
            questionsList.clear()
            binding.tvQuestionText.text = "Token ujian belum diisi!"
            AlertDialog.Builder(this@ExamActivity)
                .setTitle("⚠️ Token Ujian Wajib Diisi")
                .setMessage("Akses ujian memerlukan token aktif dari Pengawas Ruang. Silakan minta token ke Pengawas.")
                .setPositiveButton("Tutup") { _, _ -> finish() }
                .setCancelable(false)
                .show()
            return
        }

        binding.tvQuestionText.text = "Memvalidasi token ujian ke Server CBT..."

        lifecycleScope.launch {
            val req = DownloadQuestionsRequest(examId = eId, token = token)
            ApiClient.getClient(this@ExamActivity).downloadCbtQuestions(req).enqueue(object : Callback<DownloadQuestionsResponse> {
                override fun onResponse(call: Call<DownloadQuestionsResponse>, response: Response<DownloadQuestionsResponse>) {
                    val body = response.body()
                    if (response.isSuccessful && body?.success == true && !body.questions.isNullOrEmpty()) {
                        studentExamId = body.studentExamId
                        if (!studentExamId.isNullOrEmpty() && !eId.isNullOrEmpty()) {
                            getSharedPreferences("CbtExamPrefs", Context.MODE_PRIVATE).edit()
                                .putString("cbt_student_exam_id_$eId", studentExamId)
                                .apply()
                        }
                        val duration = body.durationMinutes ?: examDurationMinutes
                        val backendQuestions = body.questions
                        questionsList.clear()

                        val entitiesToCache = mutableListOf<QuestionEntity>()
                        val gson = Gson()

                        backendQuestions.forEachIndexed { idx, bq ->
                            val parsedOptions = bq.parseOptionsList()
                            val options = if (parsedOptions.isNotEmpty()) parsedOptions.toMutableList() else {
                                val fallbackOpts = mutableListOf<String>()
                                bq.optionA?.let { if (it.isNotBlank()) fallbackOpts.add(it) }
                                bq.optionB?.let { if (it.isNotBlank()) fallbackOpts.add(it) }
                                bq.optionC?.let { if (it.isNotBlank()) fallbackOpts.add(it) }
                                bq.optionD?.let { if (it.isNotBlank()) fallbackOpts.add(it) }
                                fallbackOpts
                            }

                            val qText = bq.getQuestionBody()

                            val qType = when (bq.type?.uppercase()) {
                                "MATCHING" -> QuestionType.MATCHING
                                "ESSAY" -> QuestionType.ESSAY
                                else -> QuestionType.MULTIPLE_CHOICE
                            }

                            questionsList.add(
                                QuestionModel(
                                    id = bq.id,
                                    text = qText,
                                    type = qType,
                                    options = options,
                                    imageUrl = bq.imageUrl,
                                    audioUrl = bq.audioUrl,
                                    correctOption = bq.correctOption,
                                    explanation = bq.explanation
                                )
                            )

                            entitiesToCache.add(
                                QuestionEntity(
                                    id = bq.id,
                                    examId = eId ?: "online_exam",
                                    content = qText,
                                    type = bq.type ?: "MULTIPLE_CHOICE",
                                    options = gson.toJson(options),
                                    orderNum = idx,
                                    selectedAnswer = null,
                                    imageUrl = bq.imageUrl,
                                    audioUrl = bq.audioUrl
                                )
                            )
                        }

                        // Simpan ke Room DB lokal secara asynchronous
                        lifecycleScope.launch(Dispatchers.IO) {
                            try {
                                val db = AppDatabase.getDatabase(this@ExamActivity)
                                db.cbtDao().insertQuestions(entitiesToCache)
                            } catch (e: Exception) {
                                e.printStackTrace()
                            }
                        }

                        com.school.smartcbt.utils.ClientLogger.logCbt(
                            context = this@ExamActivity,
                            action = "DOWNLOAD_QUESTIONS",
                            outcome = "SUCCESS",
                            message = "Berhasil memuat & mengamankan ${questionsList.size} butir soal",
                            examId = eId,
                            token = token
                        )
                        Toast.makeText(this@ExamActivity, "✅ Berhasil memuat & mengamankan ${questionsList.size} butir soal!", Toast.LENGTH_SHORT).show()
                        showParticipantConfirmationDialog(duration)
                    } else {
                        questionsList.clear()
                        binding.tvQuestionText.text = "⚠️ Token Tidak Valid atau Kadaluarsa"
                        val errMsg = body?.message ?: try {
                            val errJson = response.errorBody()?.string()
                            org.json.JSONObject(errJson ?: "").optString("message", "Token ujian tidak valid atau belum dirilis oleh Pengawas.")
                        } catch (e: Exception) { "Token ujian tidak valid atau belum dirilis oleh Pengawas." }

                        com.school.smartcbt.utils.ClientLogger.logCbt(
                            context = this@ExamActivity,
                            action = "DOWNLOAD_QUESTIONS",
                            outcome = "REJECTED",
                            message = "Download soal ditolak: $errMsg",
                            examId = eId,
                            token = token
                        )

                        val isNoQuestions = (body?.success == true && body.questions.isNullOrEmpty()) || errMsg.contains("belum diunggah") || errMsg.contains("belum dirilis")
                        val dialogTitle = if (isNoQuestions) "⚠️ Naskah Soal Belum Tersedia" else "⚠️ Token Ujian Ditolak"
                        val dialogMsg = if (isNoQuestions) 
                            "Naskah butir soal belum diunggah atau belum dirilis oleh Guru Pengampu untuk paket ujian ini. Silakan laporkan kepada Pengawas Ruang."
                        else 
                            "Verifikasi token gagal: $errMsg\n\nPastikan Anda memasukkan token yang diumumkan oleh Pengawas Ruang untuk sesi ini."

                        AlertDialog.Builder(this@ExamActivity)
                            .setTitle(dialogTitle)
                            .setMessage(dialogMsg)
                            .setPositiveButton("Kembali") { _, _ -> finish() }
                            .setCancelable(false)
                            .show()
                    }
                }

                override fun onFailure(call: Call<DownloadQuestionsResponse>, t: Throwable) {
                    questionsList.clear()
                    binding.tvQuestionText.text = "⚠️ Gagal Terhubung ke Server CBT"
                    val netMsg = t.message ?: "Koneksi terputus"

                    com.school.smartcbt.utils.ClientLogger.logCbt(
                        context = this@ExamActivity,
                        action = "DOWNLOAD_QUESTIONS",
                        outcome = "ERROR",
                        message = "Koneksi download soal gagal: $netMsg",
                        examId = eId,
                        token = token
                    )

                    AlertDialog.Builder(this@ExamActivity)
                        .setTitle("⚠️ Gagal Menghubungi Server")
                        .setMessage("Tidak dapat memverifikasi token ke Server CBT ($netMsg). Pastikan perangkat terhubung ke Wi-Fi sekolah.")
                        .setPositiveButton("Coba Lagi") { _, _ -> fetchExamQuestions(eId, token) }
                        .setNegativeButton("Keluar") { _, _ -> finish() }
                        .setCancelable(false)
                        .show()
                }
            })
        }
    }

    private fun persistAnswerLocally(questionIndex: Int, answer: String) {
        if (answer.isNotBlank()) {
            studentAnswers[questionIndex] = answer
        } else {
            studentAnswers.remove(questionIndex)
        }
        val q = questionsList.getOrNull(questionIndex) ?: return
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                AppDatabase.getDatabase(this@ExamActivity).cbtDao().updateAnswer(q.id, answer)
            } catch (e: Exception) {}
        }
    }

    private fun loadFallbackQuestions() {
        Toast.makeText(this@ExamActivity, "Menggunakan bank soal cadangan lokal", Toast.LENGTH_SHORT).show()
        questionsList.clear()
        questionsList.addAll(generateExamQuestions())
        setupExamTimer(examDurationMinutes)
        currentQuestionIndex = 0
        renderQuestion(currentQuestionIndex)
        updateUnbkCounters()
    }

    private fun setupBackBlocker() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!isExamFinishedNormally) {
                    Toast.makeText(this@ExamActivity, "🔒 Tombol Kembali Dinonaktifkan! Anda tidak dapat keluar sebelum menyelesaikan ujian.", Toast.LENGTH_LONG).show()
                } else {
                    finish()
                }
            }
        })
    }

    private fun setupAntiPhotoSecurity() {
        // 1. Watermark Identitas Siswa Forensik Dinamis (Pelacak foto kamera gawai lain)
        val studentName = sessionManager.getName()
        val studentNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }
        val studentClass = sessionManager.getClassName()
        binding.tvExamWatermark.text = "$studentName • $studentNisn • Kelas $studentClass • SMPN 1 BOYOLANGU"

        // 2. Tombol dan Touch Listener Buka Kunci Blur
        binding.btnUnblurQuestion.setOnClickListener {
            resetAntiPhotoTimer()
        }
        binding.layoutAntiPhotoBlurShield.setOnClickListener {
            resetAntiPhotoTimer()
        }

        // Mulai timer pelindung layar anti-foto
        resetAntiPhotoTimer()
    }

    private fun resetAntiPhotoTimer() {
        antiPhotoBlurHandler.removeCallbacks(antiPhotoBlurRunnable)
        if (binding.layoutAntiPhotoBlurShield.visibility == View.VISIBLE) {
            binding.layoutAntiPhotoBlurShield.visibility = View.GONE
        }
        antiPhotoBlurHandler.postDelayed(antiPhotoBlurRunnable, ANTI_PHOTO_INACTIVITY_MS)
    }

    private fun showAntiPhotoBlurShield() {
        if (!isFinishing && (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN_MR1 || !isDestroyed)) {
            binding.layoutAntiPhotoBlurShield.visibility = View.VISIBLE
        }
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        resetAntiPhotoTimer()
        return super.dispatchTouchEvent(ev)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyKioskImmersiveMode()
            clearSystemClipboard()
        }
    }

    private fun applyKioskImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
        }
    }

    private fun applyAntiPasteSecurity() {
        val noOpActionMode = object : ActionMode.Callback {
            override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean = false
            override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean = false
            override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean = false
            override fun onDestroyActionMode(mode: ActionMode?) {}
        }

        binding.tvQuestionText.customSelectionActionModeCallback = noOpActionMode
        binding.tvQuestionText.isLongClickable = false
        binding.tvQuestionText.setTextIsSelectable(false)

        clearSystemClipboard()
    }

    private fun clearSystemClipboard() {
        try {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            clipboard?.setPrimaryClip(ClipData.newPlainText("", ""))
        } catch (e: Exception) {
            // Safe fallback
        }
    }

    /**
     * BUG-NEW-07 Fix: Deteksi Accessibility Services pihak ketiga yang berpotensi
     * membaca layar atau menginjeksi teks (cheat bypass kiosk).
     */
    private fun checkAccessibilityServices(): Boolean {
        return try {
            val enabledServices = android.provider.Settings.Secure.getString(
                contentResolver,
                android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val suspiciousServices = enabledServices.split(":")
                .map { it.trim() }
                .filter { it.isNotBlank() && !it.contains("com.google.android.marvin.talkback", ignoreCase = true) && !it.contains("talkback", ignoreCase = true) }

            if (suspiciousServices.isNotEmpty()) {
                AlertDialog.Builder(this)
                    .setTitle("🚨 Aksesibilitas Mencurigakan Terdeteksi")
                    .setMessage("Aplikasi mendeteksi Layanan Aksesibilitas (Accessibility Services) yang aktif:\n\n${suspiciousServices.joinToString("\n")}\n\nDemi integritas ujian CBT, harap nonaktifkan layanan pihak ketiga ini di Pengaturan > Aksesibilitas sebelum memulai ujian.")
                    .setCancelable(false)
                    .setPositiveButton("Buka Pengaturan") { _, _ ->
                        try {
                            val intent = Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)
                            startActivity(intent)
                        } catch (e: Exception) {}
                        finish()
                    }
                    .setNegativeButton("Keluar Ujian") { _, _ ->
                        finish()
                    }
                    .show()
                false
            } else {
                true
            }
        } catch (e: Exception) {
            true
        }
    }

    private fun setupExamHeader() {
        val studentName = sessionManager.getName()
        val studentNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }
        val examTitle = intent.getStringExtra("EXAM_TITLE") ?: intent.getStringExtra("EXAM_SUBJECT") ?: "Ujian CBT Siswa"
        val token = intent.getStringExtra("EXAM_TOKEN") ?: "UNBK26"

        binding.tvStudentName.text = studentName
        binding.tvStudentNisn.text = "Peserta: $studentNisn"
        binding.tvExamTitle.text = examTitle

        setupFontSizeControls()
        Toast.makeText(this, "🔐 ExamBrowser Aktif (Kiosk & Anti-Cheat). Token: $token", Toast.LENGTH_SHORT).show()
    }

    private fun setupFontSizeControls() {
        binding.btnFontSmall.setOnClickListener { updateFontSize(0.85f) }
        binding.btnFontNormal.setOnClickListener { updateFontSize(1.0f) }
        binding.btnFontLarge.setOnClickListener { updateFontSize(1.25f) }
        updateFontSize(1.0f)
    }

    private fun updateFontSize(scale: Float) {
        currentFontSizeScale = scale
        val activeBg = Color.parseColor("#1E3A8A")
        val inactiveBg = Color.parseColor("#0F172A")
        val activeText = Color.WHITE
        val inactiveText = Color.parseColor("#94A3B8")

        binding.btnFontSmall.setBackgroundColor(if (scale < 0.95f) activeBg else inactiveBg)
        binding.btnFontSmall.setTextColor(if (scale < 0.95f) activeText else inactiveText)

        binding.btnFontNormal.setBackgroundColor(if (scale in 0.95f..1.1f) activeBg else inactiveBg)
        binding.btnFontNormal.setTextColor(if (scale in 0.95f..1.1f) activeText else inactiveText)

        binding.btnFontLarge.setBackgroundColor(if (scale > 1.15f) activeBg else inactiveBg)
        binding.btnFontLarge.setTextColor(if (scale > 1.15f) activeText else inactiveText)

        binding.tvQuestionText.textSize = 17f * currentFontSizeScale
        if (questionsList.isNotEmpty() && currentQuestionIndex in questionsList.indices) {
            renderQuestion(currentQuestionIndex)
        }
    }

    private fun showParticipantConfirmationDialog(durationMinutes: Int) {
        val density = resources.displayMetrics.density
        val studentName = sessionManager.getName().ifEmpty { "Peserta CBT" }
        val studentNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }
        val studentClass = sessionManager.getClassName().ifEmpty { "VII-A" }
        val examTitle = intent.getStringExtra("EXAM_TITLE") ?: intent.getStringExtra("EXAM_SUBJECT") ?: "Ujian CBT Siswa"
        val token = activeExamToken ?: "UNBK26"

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
            text = "🏛️ LEMBAR KONFIRMASI DATA UJIAN RESMI"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
        }
        headerLayout.addView(tvBadgeFormal)

        val tvHeaderTitle = TextView(this).apply {
            text = "KONFIRMASI PESERTA CBT"
            setTextColor(Color.WHITE)
            textSize = 19f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (4 * density).toInt(), 0, (2 * density).toInt())
        }
        headerLayout.addView(tvHeaderTitle)

        val tvHeaderSub = TextView(this).apply {
            text = "Pastikan seluruh data diri dan paket ujian telah sesuai sebelum memulai hitung mundur."
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
        }
        headerLayout.addView(tvHeaderSub)
        rootLayout.addView(headerLayout)

        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        // Card Identitas
        val cardPeserta = CardView(this).apply {
            radius = 14 * density
            cardElevation = 3 * density
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
        }
        val innerP = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvH1 = TextView(this).apply {
            text = "👤 IDENTITAS PESERTA"
            setTextColor(Color.parseColor("#1E3A8A"))
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, (8 * density).toInt())
        }
        innerP.addView(tvH1)
        innerP.addView(createConfRow("Nama Peserta", studentName, density))
        innerP.addView(createConfRow("Nomor Peserta / NISN", studentNisn, density))
        innerP.addView(createConfRow("Rombel / Kelas", "Kelas $studentClass", density))
        cardPeserta.addView(innerP)
        content.addView(cardPeserta)

        // Card Paket Ujian
        val cardExam = CardView(this).apply {
            radius = 14 * density
            cardElevation = 3 * density
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
        }
        val innerE = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvH2 = TextView(this).apply {
            text = "📑 DETAIL PAKET ASESMEN"
            setTextColor(Color.parseColor("#0F766E"))
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, (8 * density).toInt())
        }
        innerE.addView(tvH2)
        innerE.addView(createConfRow("Mata Pelajaran", examTitle, density))
        innerE.addView(createConfRow("Alokasi Waktu", "$durationMinutes Menit", density))
        innerE.addView(createConfRow("Jumlah Naskah", "${questionsList.size} Butir Soal (4 Opsi A-D)", density))
        innerE.addView(createConfRow("Token Pengawas", "$token (Terverifikasi)", density))
        cardExam.addView(innerE)
        content.addView(cardExam)

        // Card Integritas
        val cardWarning = CardView(this).apply {
            radius = 14 * density
            cardElevation = 3 * density
            setCardBackgroundColor(Color.parseColor("#FFF1F2"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
        }
        val innerW = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (14 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvH3 = TextView(this).apply {
            text = "🛡️ KETENTUAN UJIAN & LOCKDOWN"
            setTextColor(Color.parseColor("#BE123C"))
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
        }
        innerW.addView(tvH3)
        val tvWText = TextView(this).apply {
            text = "• Layar ujian terkunci otomatis dalam Kiosk Mode.\n" +
                    "• Dilarang memencet tombol Home, Recent Apps, atau mencoba keluar.\n" +
                    "• ⚠️ PENTING: Sekali Anda selesai mengerjakan dan mengumpulkan lembar ujian, status dinyatakan SELESAI dan Anda TIDAK DAPAT mengulang kembali!"
            setTextColor(Color.parseColor("#9F1239"))
            textSize = 11f
            setPadding(0, (6 * density).toInt(), 0, 0)
            setLineSpacing(0f, 1.2f)
        }
        innerW.addView(tvWText)
        cardWarning.addView(innerW)
        content.addView(cardWarning)

        scrollView.addView(content)
        rootLayout.addView(scrollView)

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

        val btnStart = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "🚀 MULAI UJIAN SEKARANG"
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
                setupExamTimer(durationMinutes)
                currentQuestionIndex = 0
                renderQuestion(currentQuestionIndex)
                updateUnbkCounters()
                autoSaveHandler.postDelayed(autoSaveRunnable, 30_000)
            }
        }
        footer.addView(btnStart)

        val btnCancel = Button(this).apply {
            text = "Batal / Keluar"
            setBackgroundColor(Color.TRANSPARENT)
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * density).toInt()).apply {
                topMargin = (6 * density).toInt()
            }
            setOnClickListener {
                dialog.dismiss()
                finish()
            }
        }
        footer.addView(btnCancel)
        rootLayout.addView(footer)

        dialog.show()
    }

    private fun createConfRow(label: String, value: String, density: Float): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, (3 * density).toInt(), 0, (3 * density).toInt())
        }
        val tvLabel = TextView(this).apply {
            text = label
            setTextColor(Color.parseColor("#64748B"))
            textSize = 11.5f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f)
        }
        val tvVal = TextView(this).apply {
            text = value
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 2f)
        }
        row.addView(tvLabel)
        row.addView(tvVal)
        return row
    }

    private fun setNavigationLocked(locked: Boolean) {
        binding.btnPrev.isEnabled = !locked && currentQuestionIndex > 0
        binding.btnNext.isEnabled = !locked
        binding.btnDoubt.isEnabled = !locked
        binding.btnDaftarSoal.isEnabled = !locked

        val alphaVal = if (locked) 0.5f else 1.0f
        binding.btnPrev.alpha = alphaVal
        binding.btnNext.alpha = alphaVal
        binding.btnDoubt.alpha = alphaVal
        binding.btnDaftarSoal.alpha = alphaVal
    }

    private fun setupExamTimer(durationMinutes: Int = 90) {
        countDownTimer?.cancel()
        val totalMillis = durationMinutes * 60 * 1000L
        countDownTimer = object : CountDownTimer(totalMillis, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val hours = (millisUntilFinished / 3600000)
                val minutes = (millisUntilFinished % 3600000) / 60000
                val seconds = (millisUntilFinished % 60000) / 1000
                binding.tvTimer.text = String.format("%02d:%02d:%02d", hours, minutes, seconds)
            }

            override fun onFinish() {
                binding.tvTimer.text = "00:00:00"
                Toast.makeText(this@ExamActivity, "⏰ WAKTU HABIS! Mengumpulkan lembar jawaban otomatis ke Server Proktor...", Toast.LENGTH_LONG).show()
                submitExamAnswers(isFinished = true)
            }
        }.start()
    }

    private fun updateUnbkCounters() {
        val total = questionsList.size
        val answered = studentAnswers.size
        var doubt = 0
        for (i in 0 until total) {
            if (doubtStatus[i] == true) {
                doubt++
            }
        }
        val unanswered = total - answered

        binding.tvAnsweredCount.text = "🟢 Terjawab: " + answered
        binding.tvDoubtCount.text = "🟡 Ragu: " + doubt
        binding.tvUnansweredCount.text = "⚪ Belum: " + unanswered
    }

    private fun stopListeningAudio() {
        audioProgressRunnable?.let { audioHandler.removeCallbacks(it) }
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (e: Exception) {}
        mediaPlayer = null
        isAudioPlaying = false
        binding.btnPlayAudio.text = "▶"
        setNavigationLocked(false)
    }

    private fun setupListeningPlayer(rawAudioUrl: String) {
        stopListeningAudio()
        binding.cardListeningAudio.visibility = View.VISIBLE

        val currentPlayCount = audioPlayCountMap[currentQuestionIndex] ?: 0
        val remainingPlays = maxAudioPlays - currentPlayCount

        val serverBase = ApiClient.getBaseServerUrl(this).trimEnd('/')
        val fullAudioUrl = if (rawAudioUrl.startsWith("http")) rawAudioUrl else "$serverBase/" + rawAudioUrl.trimStart('/')

        binding.tvAudioDuration.text = "00:00 / --:-- (Sisa Putar: $remainingPlays kali)"
        binding.seekBarAudio.progress = 0
        binding.btnPlayAudio.text = "▶"
        binding.btnPlayAudio.isEnabled = remainingPlays > 0

        if (remainingPlays <= 0) {
            binding.btnPlayAudio.text = "⏹"
            binding.tvAudioDuration.text = "Batas Putar Audio Habis (Maks. $maxAudioPlays kali)"
            return
        }

        binding.btnPlayAudio.setOnClickListener {
            val plays = audioPlayCountMap[currentQuestionIndex] ?: 0
            if (plays >= maxAudioPlays && !isAudioPlaying) {
                Toast.makeText(this@ExamActivity, "⚠️ Batas pemutaran audio (maksimal $maxAudioPlays kali) sudah habis!", Toast.LENGTH_SHORT).show()
                binding.btnPlayAudio.isEnabled = false
                return@setOnClickListener
            }

            if (isAudioPlaying) {
                mediaPlayer?.pause()
                isAudioPlaying = false
                setNavigationLocked(false)
                binding.btnPlayAudio.text = "▶"
            } else {
                if (mediaPlayer == null) {
                    try {
                        mediaPlayer = MediaPlayer().apply {
                            setDataSource(fullAudioUrl)
                            setOnPreparedListener { mp ->
                                val totalSec = mp.duration / 1000
                                val totalStr = String.format("%02d:%02d", totalSec / 60, totalSec % 60)
                                val updatedPlays = (audioPlayCountMap[currentQuestionIndex] ?: 0) + 1
                                audioPlayCountMap[currentQuestionIndex] = updatedPlays
                                val rem = maxAudioPlays - updatedPlays
                                binding.tvAudioDuration.text = "00:00 / $totalStr (Sisa Putar: $rem kali)"
                                binding.seekBarAudio.max = mp.duration
                                mp.start()
                                isAudioPlaying = true
                                setNavigationLocked(true)
                                binding.btnPlayAudio.text = "⏸"
                                startAudioProgressTracking()
                            }
                            setOnCompletionListener {
                                isAudioPlaying = false
                                setNavigationLocked(false)
                                binding.btnPlayAudio.text = "▶"
                                binding.seekBarAudio.progress = 0
                                val playsNow = audioPlayCountMap[currentQuestionIndex] ?: 0
                                val rem = maxAudioPlays - playsNow
                                if (rem <= 0) {
                                    binding.btnPlayAudio.isEnabled = false
                                    binding.btnPlayAudio.text = "⏹"
                                    binding.tvAudioDuration.text = "Audio Selesai (Batas putar habis)"
                                } else {
                                    binding.tvAudioDuration.text = "Audio Selesai (Sisa Putar: $rem kali)"
                                }
                                Toast.makeText(this@ExamActivity, "🎧 Pemutaran audio selesai. Navigasi soal dibuka kembali.", Toast.LENGTH_SHORT).show()
                            }
                            setOnErrorListener { _, _, _ ->
                                Toast.makeText(this@ExamActivity, "Gagal memutar berkas audio listening", Toast.LENGTH_SHORT).show()
                                stopListeningAudio()
                                true
                            }
                            prepareAsync()
                        }
                    } catch (e: Exception) {
                        Toast.makeText(this, "Tidak dapat memutar audio: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    mediaPlayer?.start()
                    isAudioPlaying = true
                    setNavigationLocked(true)
                    binding.btnPlayAudio.text = "⏸"
                    startAudioProgressTracking()
                }
            }
        }

        binding.seekBarAudio.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) {
                    mediaPlayer?.seekTo(progress)
                }
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })
    }

    private fun startAudioProgressTracking() {
        audioProgressRunnable = object : Runnable {
            override fun run() {
                mediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        val curr = mp.currentPosition
                        val dur = mp.duration
                        binding.seekBarAudio.progress = curr
                        val curSec = curr / 1000
                        val totSec = dur / 1000
                        binding.tvAudioDuration.text = String.format("%02d:%02d / %02d:%02d", curSec / 60, curSec % 60, totSec / 60, totSec % 60)
                        audioHandler.postDelayed(this, 500)
                    }
                }
            }
        }
        audioHandler.post(audioProgressRunnable!!)
    }

    private fun renderQuestion(index: Int) {
        val q = questionsList[index]
        val typeLabel = when (q.type) {
            QuestionType.MULTIPLE_CHOICE -> "[Pilihan Ganda A-D]"
            QuestionType.MATCHING -> "[Menjodohkan]"
            QuestionType.ESSAY -> "[Uraian / Essai]"
        }

        binding.tvQuestionNumber.text = "Soal No. " + (index + 1) + " dari " + questionsList.size + " " + typeLabel
        
        // 1. Audio Listening Handler
        if (!q.audioUrl.isNullOrEmpty()) {
            setupListeningPlayer(q.audioUrl)
        } else {
            stopListeningAudio()
            binding.cardListeningAudio.visibility = View.GONE
        }

        // 2. Image Attachment Handler
        if (!q.imageUrl.isNullOrEmpty()) {
            binding.ivQuestionImage.visibility = View.VISIBLE
            val serverBase = ApiClient.getBaseServerUrl(this).trimEnd('/')
            val fullImgUrl = if (q.imageUrl.startsWith("http")) q.imageUrl else "$serverBase/" + q.imageUrl.trimStart('/')
            binding.ivQuestionImage.tag = fullImgUrl
            Thread {
                try {
                    val conn = URL(fullImgUrl).openConnection()
                    conn.connectTimeout = 5000
                    conn.readTimeout = 5000
                    val bmp = BitmapFactory.decodeStream(conn.getInputStream())
                    runOnUiThread {
                        if (binding.ivQuestionImage.tag == fullImgUrl && bmp != null) {
                            binding.ivQuestionImage.setImageBitmap(bmp)
                        }
                    }
                } catch (e: Exception) {
                    // Safe fallback
                }
            }.start()
        } else {
            binding.ivQuestionImage.visibility = View.GONE
        }

        // 3. Formula / KaTeX / LaTeX or Plain Text Question Handler
        val containsMathOrHtml = q.text.contains("\\(") || q.text.contains("$$") || q.text.contains("\\frac") || 
                                 q.text.contains("\\sqrt") || q.text.contains("<img") || q.text.contains("<p>") || 
                                 q.text.contains("^{") || q.text.contains("_{") || q.text.contains("\\times")
        if (containsMathOrHtml) {
            binding.tvQuestionText.visibility = View.GONE
            binding.wvQuestionMath.visibility = View.VISIBLE
            binding.wvQuestionMath.settings.javaScriptEnabled = true
            binding.wvQuestionMath.settings.domStorageEnabled = true
            
            val katexHtml = """
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
                    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
                    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body, {delimiters: [{left: '$$', right: '$$', display: true}, {left: '\\(', right: '\\)', display: false}, {left: '$', right: '$', display: false}]});"></script>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: ${(16 * currentFontSizeScale).toInt()}px; font-weight: bold; color: #1E293B; margin: 0; padding: 4px; line-height: 1.6; }
                        img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; }
                    </style>
                </head>
                <body>
                    ${q.text}
                </body>
                </html>
            """.trimIndent()
            val serverBase = ApiClient.getBaseServerUrl(this)
            binding.wvQuestionMath.loadDataWithBaseURL(serverBase, katexHtml, "text/html", "UTF-8", null)
        } else {
            binding.wvQuestionMath.visibility = View.GONE
            binding.tvQuestionText.visibility = View.VISIBLE
            binding.tvQuestionText.textSize = 17f * currentFontSizeScale
            binding.tvQuestionText.text = q.text
        }

        val isDoubt = doubtStatus[index] == true
        val isAnswered = studentAnswers.containsKey(index) && studentAnswers[index]!!.isNotEmpty()

        if (isDoubt) {
            binding.tvQuestionStatusBadge.text = "🟡 RAGU-RAGU"
            binding.tvQuestionStatusBadge.setBackgroundColor(Color.parseColor("#FEF3C7"))
            binding.tvQuestionStatusBadge.setTextColor(Color.parseColor("#D97706"))
            binding.btnDoubt.text = "✅ Hapus Ragu"
            binding.btnDoubt.setBackgroundColor(Color.parseColor("#10B981"))
        } else if (isAnswered) {
            binding.tvQuestionStatusBadge.text = "🟢 SUDAH DIJAWAB"
            binding.tvQuestionStatusBadge.setBackgroundColor(Color.parseColor("#D1FAE5"))
            binding.tvQuestionStatusBadge.setTextColor(Color.parseColor("#059669"))
            binding.btnDoubt.text = "🟡 Ragu-Ragu"
            binding.btnDoubt.setBackgroundColor(Color.parseColor("#F59E0B"))
        } else {
            binding.tvQuestionStatusBadge.text = "⚪ BELUM DIJAWAB"
            binding.tvQuestionStatusBadge.setBackgroundColor(Color.parseColor("#F1F5F9"))
            binding.tvQuestionStatusBadge.setTextColor(Color.parseColor("#64748B"))
            binding.btnDoubt.text = "🟡 Ragu-Ragu"
            binding.btnDoubt.setBackgroundColor(Color.parseColor("#F59E0B"))
        }

        binding.rgOptions.removeAllViews()

        // 4. Answer Input (ESSAY vs MULTIPLE CHOICE)
        if (q.type == QuestionType.ESSAY) {
            binding.layoutEssayContainer.visibility = View.VISIBLE
            binding.rgOptions.visibility = View.GONE

            val savedAns = studentAnswers[index] ?: ""
            binding.etEssayAnswer.setText(savedAns)
            val wordCount = if (savedAns.isBlank()) 0 else savedAns.trim().split("\\s+".toRegex()).size
            binding.tvEssayCharCounter.text = "$wordCount kata • ${savedAns.length} karakter"

            // Reactive Autosave TextWatcher with Debounce
            essayTextWatcher?.let { binding.etEssayAnswer.removeTextChangedListener(it) }
            essayDebounceRunnable?.let { essayDebounceHandler.removeCallbacks(it) }

            val watcher = object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
                    val typed = s?.toString() ?: ""
                    val words = if (typed.isBlank()) 0 else typed.trim().split("\\s+".toRegex()).size
                    binding.tvEssayCharCounter.text = "$words kata • ${typed.length} karakter"

                    essayDebounceRunnable?.let { essayDebounceHandler.removeCallbacks(it) }
                    essayDebounceRunnable = Runnable {
                        if (typed.isNotBlank()) {
                            persistAnswerLocally(index, typed.trim())
                            binding.tvEssayAutoSaveNotice.text = "💾 Tersimpan otomatis ke lembar ujian"
                            binding.tvEssayAutoSaveNotice.setTextColor(Color.parseColor("#10B981"))
                        } else {
                            persistAnswerLocally(index, "")
                            binding.tvEssayAutoSaveNotice.text = "⚪ Belum ada jawaban yang ditulis"
                            binding.tvEssayAutoSaveNotice.setTextColor(Color.parseColor("#94A3B8"))
                        }
                        updateUnbkCounters()
                    }
                    essayDebounceHandler.postDelayed(essayDebounceRunnable!!, 400)
                }
                override fun afterTextChanged(s: Editable?) {}
            }
            essayTextWatcher = watcher
            binding.etEssayAnswer.addTextChangedListener(watcher)
        } else {
            essayTextWatcher?.let { binding.etEssayAnswer.removeTextChangedListener(it) }
            essayDebounceRunnable?.let { essayDebounceHandler.removeCallbacks(it) }
            binding.layoutEssayContainer.visibility = View.GONE
            binding.rgOptions.visibility = View.VISIBLE

            // OPSI PILIHAN GANDA STANDAR RESMI ANBK PUSMENDIK (4 OPSI: A, B, C, D)
            val letters = listOf("A", "B", "C", "D")
            val density = resources.displayMetrics.density
            val maxOptions = minOf(q.options.size, 4)

            for (i in 0 until maxOptions) {
                val letter = letters.getOrElse(i) { "${(i + 1)}" }
                val isSelected = studentAnswers[index] == i.toString() || studentAnswers[index] == letter

                val optionCard = androidx.cardview.widget.CardView(this).apply {
                    radius = 12f * density
                    cardElevation = if (isSelected) 2f * density else 0f
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (6 * density).toInt()
                        bottomMargin = (6 * density).toInt()
                    }
                    layoutParams = lp
                    isClickable = true
                    isFocusable = true
                }

                // Border outline dan warna latar khas ANBK Pusmendik
                val cardShape = android.graphics.drawable.GradientDrawable().apply {
                    setColor(if (isSelected) Color.parseColor("#EFF6FF") else Color.parseColor("#FFFFFF"))
                    setStroke((1.5f * density).toInt(), if (isSelected) Color.parseColor("#2563EB") else Color.parseColor("#E2E8F0"))
                    cornerRadius = 12f * density
                }
                optionCard.background = cardShape

                val rowLayout = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding((14 * density).toInt(), (12 * density).toInt(), (14 * density).toInt(), (12 * density).toInt())
                }

                // Lingkaran Huruf ANBK (A / B / C / D)
                val circleBadge = TextView(this).apply {
                    val size = (34 * density).toInt()
                    layoutParams = LinearLayout.LayoutParams(size, size).apply {
                        marginEnd = (14 * density).toInt()
                    }
                    gravity = Gravity.CENTER
                    text = letter
                    textSize = 14f * currentFontSizeScale
                    typeface = Typeface.DEFAULT_BOLD
                    if (isSelected) {
                        setTextColor(Color.WHITE)
                        val circleShape = android.graphics.drawable.GradientDrawable().apply {
                            shape = android.graphics.drawable.GradientDrawable.OVAL
                            setColor(Color.parseColor("#2563EB"))
                        }
                        background = circleShape
                    } else {
                        setTextColor(Color.parseColor("#475569"))
                        val circleShape = android.graphics.drawable.GradientDrawable().apply {
                            shape = android.graphics.drawable.GradientDrawable.OVAL
                            setColor(Color.parseColor("#F1F5F9"))
                            setStroke((1f * density).toInt(), Color.parseColor("#CBD5E1"))
                        }
                        background = circleShape
                    }
                }

                // Teks Pilihan Jawaban
                val tvOptionText = TextView(this).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f)
                    text = q.options[i]
                    textSize = 15f * currentFontSizeScale
                    setTextColor(if (isSelected) Color.parseColor("#1E3A8A") else Color.parseColor("#1E293B"))
                    if (isSelected) typeface = Typeface.DEFAULT_BOLD
                    setLineSpacing(4f * density, 1f)
                }

                rowLayout.addView(circleBadge)
                rowLayout.addView(tvOptionText)
                optionCard.addView(rowLayout)

                optionCard.setOnClickListener {
                    persistAnswerLocally(index, i.toString())
                    updateUnbkCounters()
                    renderQuestion(currentQuestionIndex)
                }

                binding.rgOptions.addView(optionCard)
            }
        }

        binding.btnPrev.isEnabled = index > 0
        if (index == questionsList.size - 1) {
            binding.btnNext.text = "SELESAI ▶"
            binding.btnNext.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#DC2626"))
        } else {
            binding.btnNext.text = "BERIKUTNYA ▶"
            binding.btnNext.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
        }
    }

    private fun setupQuestionNavigation() {
        binding.btnPrev.setOnClickListener {
            if (isAudioPlaying) {
                Toast.makeText(this@ExamActivity, "🎧 Audio listening sedang diputar! Anda tidak dapat berpindah nomor hingga audio selesai.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (currentQuestionIndex > 0) {
                currentQuestionIndex--
                renderQuestion(currentQuestionIndex)
            }
        }

        binding.btnNext.setOnClickListener {
            if (isAudioPlaying) {
                Toast.makeText(this@ExamActivity, "🎧 Audio listening sedang diputar! Anda tidak dapat berpindah nomor hingga audio selesai.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (currentQuestionIndex < questionsList.size - 1) {
                currentQuestionIndex++
                renderQuestion(currentQuestionIndex)
            } else {
                showSubmitConfirmDialog()
            }
        }

        binding.btnDoubt.setOnClickListener {
            if (isAudioPlaying) {
                Toast.makeText(this@ExamActivity, "🎧 Audio listening sedang diputar! Tunggu hingga selesai.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val currentDoubt = doubtStatus[currentQuestionIndex] ?: false
            doubtStatus[currentQuestionIndex] = !currentDoubt
            updateUnbkCounters()
            renderQuestion(currentQuestionIndex)
        }

        binding.btnDaftarSoal.setOnClickListener {
            if (isAudioPlaying) {
                Toast.makeText(this@ExamActivity, "🎧 Audio listening sedang diputar! Anda tidak dapat membuka daftar soal hingga audio selesai.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            showUnbkQuestionGridDialog()
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            // Jika siswa sedang mengetik di kolom esai, biarkan tombol diketik apa adanya
            if (binding.etEssayAnswer.hasFocus()) {
                return super.dispatchKeyEvent(event)
            }

            if (isAudioPlaying) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
                    KeyEvent.KEYCODE_PAGE_UP, KeyEvent.KEYCODE_PAGE_DOWN,
                    KeyEvent.KEYCODE_A, KeyEvent.KEYCODE_B, KeyEvent.KEYCODE_C,
                    KeyEvent.KEYCODE_D, KeyEvent.KEYCODE_R -> {
                        Toast.makeText(this@ExamActivity, "🎧 Audio listening sedang diputar! Navigasi dan tombol terkunci hingga audio selesai.", Toast.LENGTH_SHORT).show()
                        return true
                    }
                }
            }

            when (event.keyCode) {
                KeyEvent.KEYCODE_A, KeyEvent.KEYCODE_1, KeyEvent.KEYCODE_NUMPAD_1 -> {
                    selectAnswerByIndex(0)
                    return true
                }
                KeyEvent.KEYCODE_B, KeyEvent.KEYCODE_2, KeyEvent.KEYCODE_NUMPAD_2 -> {
                    selectAnswerByIndex(1)
                    return true
                }
                KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_3, KeyEvent.KEYCODE_NUMPAD_3 -> {
                    selectAnswerByIndex(2)
                    return true
                }
                KeyEvent.KEYCODE_D, KeyEvent.KEYCODE_4, KeyEvent.KEYCODE_NUMPAD_4 -> {
                    selectAnswerByIndex(3)
                    return true
                }
                KeyEvent.KEYCODE_R -> {
                    binding.btnDoubt.performClick()
                    return true
                }
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_PAGE_UP -> {
                    if (binding.btnPrev.isEnabled) binding.btnPrev.performClick()
                    return true
                }
                KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_PAGE_DOWN, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    if (binding.btnNext.isEnabled) binding.btnNext.performClick()
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun selectAnswerByIndex(optIndex: Int) {
        if (questionsList.isEmpty() || currentQuestionIndex !in questionsList.indices) return
        val q = questionsList[currentQuestionIndex]
        if (q.type == QuestionType.MULTIPLE_CHOICE && optIndex in 0..3 && optIndex in q.options.indices) {
            persistAnswerLocally(currentQuestionIndex, optIndex.toString())
            updateUnbkCounters()
            renderQuestion(currentQuestionIndex)
            val letters = listOf("A", "B", "C", "D")
            val letterLabel = if (optIndex in letters.indices) letters[optIndex] else "${optIndex + 1}"
            Toast.makeText(this, "⌨️ Opsi $letterLabel Terpilih", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * POPUP TOTAL SOAL STANDAR CBT / UNBK (KOMPAK & MENGAKOMODASI 50+ SOAL)
     * Desain tombol matriks diperkecil dan ditata 5 kolom presisi sehingga
     * 50 butir soal tampil rapi, padat, mudah digulir, dan responsif.
     */
    private fun showUnbkQuestionGridDialog() {
        val rootLayout = LinearLayout(this)
        rootLayout.orientation = LinearLayout.VERTICAL
        rootLayout.setPadding(24, 16, 24, 16)

        // 1. REKAP TOTAL SOAL (HEADER POPUP)
        val total = questionsList.size
        val answered = studentAnswers.size
        var doubt = 0
        for (i in 0 until total) {
            if (doubtStatus[i] == true) doubt++
        }
        val unanswered = total - answered

        val headerCard = CardView(this)
        headerCard.radius = 12f
        headerCard.cardElevation = 2f

        val headerLayout = LinearLayout(this)
        headerLayout.orientation = LinearLayout.VERTICAL
        headerLayout.setPadding(16, 12, 16, 12)
        headerLayout.setBackgroundColor(Color.parseColor("#F8FAFC"))

        val tvTotalHeader = TextView(this)
        tvTotalHeader.text = "📋 TOTAL SOAL UJIAN: " + total + " BUTIR"
        tvTotalHeader.setTextColor(Color.parseColor("#0F172A"))
        tvTotalHeader.textSize = 13f
        tvTotalHeader.typeface = Typeface.DEFAULT_BOLD
        headerLayout.addView(tvTotalHeader)

        val statsLayout = LinearLayout(this)
        statsLayout.orientation = LinearLayout.HORIZONTAL
        statsLayout.setPadding(0, 6, 0, 0)

        val tvTerjawab = TextView(this)
        tvTerjawab.text = "🟢 " + answered + " Terjawab"
        tvTerjawab.setTextColor(Color.parseColor("#059669"))
        tvTerjawab.textSize = 11f
        tvTerjawab.typeface = Typeface.DEFAULT_BOLD
        tvTerjawab.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        statsLayout.addView(tvTerjawab)

        val tvRagu = TextView(this)
        tvRagu.text = "🟡 " + doubt + " Ragu"
        tvRagu.setTextColor(Color.parseColor("#D97706"))
        tvRagu.textSize = 11f
        tvRagu.typeface = Typeface.DEFAULT_BOLD
        tvRagu.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        statsLayout.addView(tvRagu)

        val tvBelum = TextView(this)
        tvBelum.text = "⚪ " + unanswered + " Belum"
        tvBelum.setTextColor(Color.parseColor("#64748B"))
        tvBelum.textSize = 11f
        tvBelum.typeface = Typeface.DEFAULT_BOLD
        tvBelum.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        statsLayout.addView(tvBelum)

        headerLayout.addView(statsLayout)
        headerCard.addView(headerLayout)
        rootLayout.addView(headerCard)

        // 2. SCROLLABLE GRID MATRIKS NOMOR SOAL (KOMPAK 5 KOLOM)
        val scrollView = ScrollView(this)
        scrollView.setPadding(0, 12, 0, 8)

        val grid = GridLayout(this)
        grid.columnCount = 5 // 5 Kolom per baris
        grid.alignmentMode = GridLayout.ALIGN_MARGINS

        val letters = listOf("A", "B", "C", "D")

        for (i in questionsList.indices) {
            val q = questionsList[i]
            val isAns = studentAnswers.containsKey(i) && studentAnswers[i]!!.isNotEmpty()
            val isDoubt = doubtStatus[i] == true
            val isCurrent = (i == currentQuestionIndex)

            val btn = Button(this)
            btn.textSize = 11f
            btn.typeface = Typeface.DEFAULT_BOLD
            btn.setTextColor(Color.WHITE)
            btn.gravity = Gravity.CENTER
            btn.setPadding(2, 2, 2, 2)
            btn.minHeight = 0
            btn.minimumHeight = 0
            btn.minWidth = 0
            btn.minimumWidth = 0

            val selectedOptionText = if (isAns) {
                if (q.type == QuestionType.ESSAY) {
                    " [E]"
                } else {
                    val ansIdx = studentAnswers[i]?.toIntOrNull()
                    if (ansIdx != null && ansIdx in letters.indices) {
                        " [" + letters[ansIdx] + "]"
                    } else {
                        " [✓]"
                    }
                }
            } else {
                " [-]"
            }

            btn.text = "" + (i + 1) + selectedOptionText

            if (isDoubt) {
                btn.setBackgroundColor(Color.parseColor("#F59E0B")) // Kuning Ragu
                btn.text = "" + (i + 1) + selectedOptionText + "?"
            } else if (isAns) {
                btn.setBackgroundColor(Color.parseColor("#10B981")) // Hijau Terjawab
            } else {
                btn.setBackgroundColor(Color.parseColor("#94A3B8")) // Abu-abu Belum
                btn.setTextColor(Color.parseColor("#FFFFFF"))
            }

            if (isCurrent) {
                // Highlight soal yang sedang aktif
                btn.setTextColor(Color.parseColor("#FEF08A"))
            }

            val params = GridLayout.LayoutParams()
            params.width = 135
            params.height = 100
            params.setMargins(6, 6, 6, 6)
            btn.layoutParams = params

            btn.setOnClickListener {
                currentQuestionIndex = i
                renderQuestion(currentQuestionIndex)
                (btn.tag as? AlertDialog)?.dismiss()
            }
            grid.addView(btn)
        }

        scrollView.addView(grid)
        rootLayout.addView(scrollView)

        val dialog = AlertDialog.Builder(this)
            .setTitle("📑 MATRIKS 50 SOAL CBT")
            .setView(rootLayout)
            .setNegativeButton("Tutup", null)
            .create()

        for (i in 0 until grid.childCount) {
            grid.getChildAt(i).tag = dialog
        }
        dialog.show()
    }

    private fun showSubmitConfirmDialog() {
        val density = resources.displayMetrics.density
        val total = questionsList.size
        val answered = studentAnswers.size
        var doubt = 0
        for (i in 0 until total) {
            if (doubtStatus[i] == true) doubt++
        }
        val unanswered = total - answered

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * density).toInt()
            setPadding(p, p, p, (14 * density).toInt())
            setBackgroundColor(Color.parseColor("#0A2540"))
        }
        val tvH1 = TextView(this).apply {
            text = "📤 PENYERAHAN LEMBAR JAWABAN"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
        }
        header.addView(tvH1)

        val tvH2 = TextView(this).apply {
            text = "KONFIRMASI SELESAI UJIAN"
            setTextColor(Color.WHITE)
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (4 * density).toInt(), 0, (2 * density).toInt())
        }
        header.addView(tvH2)

        val tvH3 = TextView(this).apply {
            text = "Periksa kembali status lembar jawaban Anda sebelum mengirim ke Meja Proktor."
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
        }
        header.addView(tvH3)
        rootLayout.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val container = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        // Card Rekapitulasi
        val cardStats = CardView(this).apply {
            radius = 14 * density
            cardElevation = 3 * density
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
        }
        val innerS = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvSHead = TextView(this).apply {
            text = "📊 STATUS LEMBAR JAWABAN ANDA"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, (10 * density).toInt())
        }
        innerS.addView(tvSHead)

        innerS.addView(createSubmitStatRow("Total Naskah Soal", "$total Soal", "#0F172A", density))
        innerS.addView(createSubmitStatRow("✓ Soal Telah Terjawab", "$answered Soal", "#059669", density))
        innerS.addView(createSubmitStatRow("⚠️ Jawaban Masih Ragu-Ragu", "$doubt Soal", "#D97706", density))
        innerS.addView(createSubmitStatRow("✗ Soal Belum Terjawab", "$unanswered Soal", if (unanswered > 0) "#DC2626" else "#059669", density))
        cardStats.addView(innerS)
        container.addView(cardStats)

        // Card Peringatan Integritas
        val cardWarn = CardView(this).apply {
            radius = 14 * density
            cardElevation = 3 * density
            setCardBackgroundColor(Color.parseColor("#FFF1F2"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
        }
        val innerW = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvWTitle = TextView(this).apply {
            text = "⚠️ PERINGATAN PENGUNCIAN PERMANEN"
            setTextColor(Color.parseColor("#BE123C"))
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
        }
        innerW.addView(tvWTitle)
        val tvWDesc = TextView(this).apply {
            text = "Begitu Anda menekan tombol 'Ya, Kumpulkan Jawaban':\n" +
                    "1. Seluruh jawaban Anda akan terkirim dan tersimpan resmi di Server Proktor.\n" +
                    "2. Status ujian berubah menjadi SELESAI dan Anda TIDAK BISA MASUK KEMBALI atau meminta token lagi.\n" +
                    (if (unanswered > 0) "3. ⚠️ PERHATIAN: Masih ada $unanswered soal yang belum Anda jawab!" else "3. Seluruh butir soal telah berhasil dijawab.")
            setTextColor(Color.parseColor("#9F1239"))
            textSize = 11.5f
            setPadding(0, (6 * density).toInt(), 0, 0)
            setLineSpacing(0f, 1.25f)
        }
        innerW.addView(tvWDesc)
        cardWarn.addView(innerW)
        container.addView(cardWarn)

        scroll.addView(container)
        rootLayout.addView(scroll)

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

        val btnSubmit = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "✅ YA, SELESAIKAN & KUMPULKAN JAWABAN"
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 12 * density
                setColor(Color.parseColor("#DC2626"))
            }
            background = gd
            stateListAnimator = null
            elevation = 0f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (50 * density).toInt())
            setOnClickListener {
                dialog.dismiss()
                submitExamAnswers(isFinished = true)
            }
        }
        footer.addView(btnSubmit)

        val btnCancel = Button(this).apply {
            text = "🔍 Periksa Kembali Soal"
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

    private fun createSubmitStatRow(label: String, value: String, colorHex: String, density: Float): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, (4 * density).toInt(), 0, (4 * density).toInt())
        }
        val tvL = TextView(this).apply {
            text = label
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.5f)
        }
        val tvV = TextView(this).apply {
            text = value
            setTextColor(Color.parseColor(colorHex))
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            gravity = Gravity.END
        }
        row.addView(tvL)
        row.addView(tvV)
        return row
    }

    private fun showExamFinishedSuccessFullScreen(score: Double?, sExamId: String) {
        isExamFinishedNormally = true
        if (examId != null) {
            getSharedPreferences("CbtExamPrefs", Context.MODE_PRIVATE).edit()
                .putBoolean("cbt_submitted_$examId", true)
                .apply()
        }

        val density = resources.displayMetrics.density
        val studentName = sessionManager.getName().ifEmpty { "Peserta CBT" }
        val studentNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }
        val examTitle = intent.getStringExtra("EXAM_TITLE") ?: intent.getStringExtra("EXAM_SUBJECT") ?: "Ujian CBT Siswa"

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0A2540"))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            val p = (20 * density).toInt()
            setPadding(p, p, p, p)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }

        val tvIcon = TextView(this).apply {
            text = "🎉"
            textSize = 54f
            gravity = Gravity.CENTER
            setPadding(0, (20 * density).toInt(), 0, (8 * density).toInt())
        }
        container.addView(tvIcon)

        val tvTitle = TextView(this).apply {
            text = "UJIAN CBT RESMI SELESAI"
            setTextColor(Color.WHITE)
            textSize = 20f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        container.addView(tvTitle)

        val tvSub = TextView(this).apply {
            text = "Lembar jawaban Anda telah diterima dan tersimpan resmi di Server Proktor."
            setTextColor(Color.parseColor("#93C5FD"))
            textSize = 12.5f
            gravity = Gravity.CENTER
            setPadding((16 * density).toInt(), (4 * density).toInt(), (16 * density).toInt(), (20 * density).toInt())
        }
        container.addView(tvSub)

        // Card Bukti Penyerahan (Slip)
        val cardSlip = CardView(this).apply {
            radius = 16 * density
            cardElevation = 4 * density
            setCardBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (16 * density).toInt()
            }
        }
        val innerSlip = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }
        val tvSlipHead = TextView(this).apply {
            text = "🧾 BUKTI PENYERAHAN RESMI (CBT SLIP)"
            setTextColor(Color.parseColor("#0A2540"))
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, (10 * density).toInt())
        }
        innerSlip.addView(tvSlipHead)

        innerSlip.addView(createConfRow("Nama Peserta", studentName, density))
        innerSlip.addView(createConfRow("Nomor Peserta / NISN", studentNisn, density))
        innerSlip.addView(createConfRow("Mata Pelajaran", examTitle, density))
        innerSlip.addView(createConfRow("Status Server", "TERKIRIM & TERKUNCI (SELESAI)", density))
        if (score != null) {
            innerSlip.addView(createConfRow("Skor / Nilai Akhir", String.format("%.1f", score), density))
        } else {
            innerSlip.addView(createConfRow("Status Penilaian", "Menunggu Koreksi & Penilaian Guru (Esai)", density))
        }

        val tvNotice = TextView(this).apply {
            text = "🔒 Catatan: Sesuai aturan CBT, status ujian Anda telah ditutup dan Anda tidak dapat masuk kembali untuk mengulang ujian."
            setTextColor(Color.parseColor("#475569"))
            textSize = 11f
            setPadding(0, (10 * density).toInt(), 0, 0)
        }
        innerSlip.addView(tvNotice)
        cardSlip.addView(innerSlip)
        container.addView(cardSlip)

        scroll.addView(container)
        rootLayout.addView(scroll)

        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#07192C"))
        }

        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            .setView(rootLayout)
            .setCancelable(false)
            .create()

        val btnReview = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "📖 LEMBAR PEMBAHASAN MATERI"
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 12 * density
                setColor(Color.parseColor("#2563EB"))
            }
            background = gd
            stateListAnimator = null
            elevation = 0f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (48 * density).toInt())
            setOnClickListener {
                dialog.dismiss()
                showExamReviewDiscussionDialog(sExamId)
            }
        }
        footer.addView(btnReview)

        val btnHome = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "🏠 KELUAR KE BERANDA CBT"
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 12 * density
                setColor(Color.parseColor("#0F766E"))
            }
            background = gd
            stateListAnimator = null
            elevation = 0f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                topMargin = (8 * density).toInt()
            }
            setOnClickListener {
                dialog.dismiss()
                finish()
            }
        }
        footer.addView(btnHome)
        rootLayout.addView(footer)

        dialog.show()
    }

    private fun submitExamAnswers(isFinished: Boolean) {
        val letters = listOf("A", "B", "C", "D")
        val answersMap = mutableMapOf<String, String>()

        for (i in questionsList.indices) {
            val q = questionsList[i]
            val ans = studentAnswers[i]
            if (!ans.isNullOrEmpty()) {
                val ansVal = if (q.type == QuestionType.ESSAY) {
                    ans
                } else {
                    val idx = ans.toIntOrNull()
                    if (idx != null && idx in letters.indices) letters[idx] else ans
                }
                answersMap[q.id] = ansVal
            }
        }

        val jsonStr = org.json.JSONObject(answersMap as Map<*, *>).toString()
        var sExamId = studentExamId
        if (sExamId == null && examId != null) {
            val prefs = getSharedPreferences("CbtExamPrefs", Context.MODE_PRIVATE)
            sExamId = prefs.getString("cbt_student_exam_id_$examId", null)
            if (sExamId != null) {
                studentExamId = sExamId
            }
        }

        if (sExamId != null) {
            val req = SyncExamRequest(
                studentExamId = sExamId,
                answersJson = jsonStr,
                strikeCount = strikeCount,
                isFinished = isFinished
            )
            ApiClient.getClient(this).syncExamAnswers(req).enqueue(object : Callback<SyncExamResponse> {
                override fun onResponse(call: Call<SyncExamResponse>, response: Response<SyncExamResponse>) {
                    if (isFinished) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            val score = response.body()?.score

                            com.school.smartcbt.utils.ClientLogger.logCbt(
                                context = this@ExamActivity,
                                action = "SUBMIT_EXAM",
                                outcome = "SUCCESS",
                                message = "Lembar jawaban berhasil diserahkan ke Meja Proktor (Skor: $score)",
                                examId = examId,
                                extra = mapOf("studentExamId" to sExamId, "score" to score)
                            )

                            showExamFinishedSuccessFullScreen(score, sExamId)
                        } else {
                            val errMsg = response.body()?.message ?: "Gagal memproses lembar jawaban di server proktor."

                            com.school.smartcbt.utils.ClientLogger.logCbt(
                                context = this@ExamActivity,
                                action = "SUBMIT_EXAM",
                                outcome = "REJECTED",
                                message = "Gagal serahkan jawaban: $errMsg",
                                examId = examId,
                                extra = mapOf("studentExamId" to sExamId)
                            )

                            Toast.makeText(this@ExamActivity, "⚠️ $errMsg", Toast.LENGTH_LONG).show()
                            showSubmissionRetryDialog()
                        }
                    } else {
                        // Autosave background log
                        if (!response.isSuccessful) {
                            com.school.smartcbt.utils.ClientLogger.logCbt(
                                context = this@ExamActivity,
                                action = "SYNC_EXAM_ANSWERS",
                                outcome = "REJECTED",
                                message = "Autosave berkala gagal: status ${response.code()}",
                                examId = examId
                            )
                        }
                    }
                }

                override fun onFailure(call: Call<SyncExamResponse>, t: Throwable) {
                    val netErr = t.message ?: "Koneksi terputus"
                    if (isFinished) {
                        com.school.smartcbt.utils.ClientLogger.logCbt(
                            context = this@ExamActivity,
                            action = "SUBMIT_EXAM",
                            outcome = "ERROR",
                            message = "Gagal kirim jawaban (Network Error): $netErr",
                            examId = examId,
                            extra = mapOf("studentExamId" to sExamId)
                        )
                        Toast.makeText(this@ExamActivity, "Koneksi terputus: $netErr", Toast.LENGTH_SHORT).show()
                        showSubmissionRetryDialog()
                    } else {
                        com.school.smartcbt.utils.ClientLogger.logCbt(
                            context = this@ExamActivity,
                            action = "SYNC_EXAM_ANSWERS",
                            outcome = "ERROR",
                            message = "Autosave terputus: $netErr",
                            examId = examId
                        )
                    }
                }
            })
        } else {
            if (isFinished) {
                showExamFinishedSuccessFullScreen(null, "")
            }
        }
    }

    private fun showExamReviewDiscussionDialog(sExamId: String) {
        val progress = android.app.ProgressDialog(this).apply {
            setMessage("Memuat lembar pembahasan materi...")
            setCancelable(false)
            show()
        }

        if (sExamId.isNotEmpty()) {
            ApiClient.getClient(this).getStudentExamLjs(sExamId).enqueue(object : Callback<StudentExamLjsResponse> {
                override fun onResponse(call: Call<StudentExamLjsResponse>, response: Response<StudentExamLjsResponse>) {
                    progress.dismiss()
                    val body = response.body()
                    if (response.isSuccessful && body != null && !body.items.isNullOrEmpty()) {
                        renderDiscussionDialogFromLjs(body)
                    } else {
                        renderLocalDiscussionDialog()
                    }
                }

                override fun onFailure(call: Call<StudentExamLjsResponse>, t: Throwable) {
                    progress.dismiss()
                    renderLocalDiscussionDialog()
                }
            })
        } else {
            progress.dismiss()
            renderLocalDiscussionDialog()
        }
    }

    private fun renderDiscussionDialogFromLjs(data: StudentExamLjsResponse) {
        val density = resources.displayMetrics.density

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Header Full Screen
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * density).toInt()
            setPadding(p, p, p, (16 * density).toInt())
            setBackgroundColor(Color.parseColor("#0A2540"))
        }

        val tvHeaderBadge = TextView(this).apply {
            text = "📖 LEMBAR PEMBAHASAN MATERI CBT"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        headerLayout.addView(tvHeaderBadge)

        val score = data.summary?.finalScore
        val tvHeaderTitle = TextView(this).apply {
            text = if (score != null) "PEMBAHASAN SOAL (NILAI: ${String.format("%.1f", score)})" else "PEMBAHASAN SOAL UJIAN"
            setTextColor(Color.WHITE)
            textSize = 19f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (4 * density).toInt(), 0, (2 * density).toInt())
        }
        headerLayout.addView(tvHeaderTitle)

        val totalQ = data.items?.size ?: questionsList.size
        val tvHeaderSub = TextView(this).apply {
            text = "Total $totalQ butir soal. Kunci jawaban tidak ditampilkan demi kerahasiaan & integritas ujian."
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
        }
        headerLayout.addView(tvHeaderSub)
        rootLayout.addView(headerLayout)

        // Scrollable List of Questions
        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }

        val itemsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        data.items?.forEach { item ->
            val qCard = CardView(this).apply {
                radius = 14 * density
                cardElevation = 2 * density
                useCompatPadding = true
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (12 * density).toInt()
                }
            }

            val cardContent = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (16 * density).toInt()
                setPadding(p, p, p, p)
            }

            val numBadge = TextView(this).apply {
                text = "📝 SOAL NOMOR ${item.orderNum}"
                setTextColor(Color.parseColor("#1E3A8A"))
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
            }
            cardContent.addView(numBadge)

            val tvQText = TextView(this).apply {
                text = item.content ?: "-"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 14f
                setLineSpacing(4f * density, 1f)
                setPadding(0, (8 * density).toInt(), 0, (10 * density).toInt())
            }
            cardContent.addView(tvQText)

            val ansBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val gdAns = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 8 * density
                    setColor(Color.parseColor("#EFF6FF"))
                    setStroke((1 * density).toInt(), Color.parseColor("#BFDBFE"))
                }
                background = gdAns
                val pA = (12 * density).toInt()
                setPadding(pA, (10 * density).toInt(), pA, (10 * density).toInt())
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (10 * density).toInt()
                }
            }

            val tvAnsLabel = TextView(this).apply {
                val stAns = item.studentAnswer?.trim()
                text = if (stAns.isNullOrEmpty()) "Jawaban Anda: (Tidak Dijawab)" else "Jawaban Anda: $stAns"
                setTextColor(Color.parseColor("#1E40AF"))
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
            }
            ansBox.addView(tvAnsLabel)
            cardContent.addView(ansBox)

            // Kotak Pembahasan Materi
            val explBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val gdExpl = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 8 * density
                    setColor(Color.parseColor("#F0FDF4"))
                    setStroke((1 * density).toInt(), Color.parseColor("#BBF7D0"))
                }
                background = gdExpl
                val pE = (12 * density).toInt()
                setPadding(pE, (10 * density).toInt(), pE, (10 * density).toInt())
            }

            val tvExplTitle = TextView(this).apply {
                text = "💡 Pembahasan Materi:"
                setTextColor(Color.parseColor("#047857"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
            }
            explBox.addView(tvExplTitle)

            val tvExplText = TextView(this).apply {
                val rawExpl = item.explanation?.trim()
                text = if (rawExpl.isNullOrEmpty()) {
                    "Gunakan pemahaman konsep dasar materi kurikulum SMP untuk menganalisis dan menyelesaikan butir soal ini."
                } else {
                    rawExpl
                }
                setTextColor(Color.parseColor("#065F46"))
                textSize = 12.5f
                setLineSpacing(3f * density, 1f)
                setPadding(0, (4 * density).toInt(), 0, 0)
            }
            explBox.addView(tvExplText)
            cardContent.addView(explBox)

            qCard.addView(cardContent)
            itemsContainer.addView(qCard)
        }

        scrollView.addView(itemsContainer)
        rootLayout.addView(scrollView)

        // Footer Full Screen
        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#0A2540"))
        }

        var dialog: AlertDialog? = null

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "🏠 TUTUP & KEMBALI KE BERANDA"
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 12 * density
                setColor(Color.parseColor("#2563EB"))
            }
            background = gd
            stateListAnimator = null
            elevation = 0f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (48 * density).toInt()
            )
            setOnClickListener {
                dialog?.dismiss()
                finish()
            }
        }
        footer.addView(btnClose)
        rootLayout.addView(footer)

        dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            .setView(rootLayout)
            .setCancelable(false)
            .create()

        dialog.show()
    }

    private fun renderLocalDiscussionDialog() {
        val density = resources.displayMetrics.density

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Header Full Screen
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * density).toInt()
            setPadding(p, p, p, (16 * density).toInt())
            setBackgroundColor(Color.parseColor("#0A2540"))
        }

        val tvHeaderBadge = TextView(this).apply {
            text = "📖 LEMBAR PEMBAHASAN MATERI CBT"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        headerLayout.addView(tvHeaderBadge)

        val totalQ = questionsList.size
        val tvHeaderTitle = TextView(this).apply {
            text = "PEMBAHASAN SOAL UJIAN"
            setTextColor(Color.WHITE)
            textSize = 19f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (4 * density).toInt(), 0, (2 * density).toInt())
        }
        headerLayout.addView(tvHeaderTitle)

        val tvHeaderSub = TextView(this).apply {
            text = "Total $totalQ butir soal. Kunci jawaban tidak ditampilkan demi kerahasiaan & integritas ujian."
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
        }
        headerLayout.addView(tvHeaderSub)
        rootLayout.addView(headerLayout)

        // Scrollable List of Questions
        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }

        val itemsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val letters = listOf("A", "B", "C", "D")

        questionsList.forEachIndexed { idx, q ->
            val ans = studentAnswers[idx]
            val studentAnsText = if (ans != null) {
                val ansIdx = ans.toIntOrNull()
                if (ansIdx != null && ansIdx in letters.indices) letters[ansIdx] else ans
            } else ""

            val qCard = CardView(this).apply {
                radius = 14 * density
                cardElevation = 2 * density
                useCompatPadding = true
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (12 * density).toInt()
                }
            }

            val cardContent = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (16 * density).toInt()
                setPadding(p, p, p, p)
            }

            val numBadge = TextView(this).apply {
                text = "📝 SOAL NOMOR ${idx + 1}"
                setTextColor(Color.parseColor("#1E3A8A"))
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
            }
            cardContent.addView(numBadge)

            val tvQText = TextView(this).apply {
                text = q.text
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 14f
                setLineSpacing(4f * density, 1f)
                setPadding(0, (8 * density).toInt(), 0, (10 * density).toInt())
            }
            cardContent.addView(tvQText)

            val ansBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val gdAns = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 8 * density
                    setColor(Color.parseColor("#EFF6FF"))
                    setStroke((1 * density).toInt(), Color.parseColor("#BFDBFE"))
                }
                background = gdAns
                val pA = (12 * density).toInt()
                setPadding(pA, (10 * density).toInt(), pA, (10 * density).toInt())
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (10 * density).toInt()
                }
            }

            val tvAnsLabel = TextView(this).apply {
                val stAns = studentAnsText.trim()
                text = if (stAns.isEmpty()) "Jawaban Anda: (Tidak Dijawab)" else "Jawaban Anda: $stAns"
                setTextColor(Color.parseColor("#1E40AF"))
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
            }
            ansBox.addView(tvAnsLabel)
            cardContent.addView(ansBox)

            // Kotak Pembahasan Materi
            val explBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val gdExpl = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 8 * density
                    setColor(Color.parseColor("#F0FDF4"))
                    setStroke((1 * density).toInt(), Color.parseColor("#BBF7D0"))
                }
                background = gdExpl
                val pE = (12 * density).toInt()
                setPadding(pE, (10 * density).toInt(), pE, (10 * density).toInt())
            }

            val tvExplTitle = TextView(this).apply {
                text = "💡 Pembahasan Materi:"
                setTextColor(Color.parseColor("#047857"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
            }
            explBox.addView(tvExplTitle)

            val tvExplText = TextView(this).apply {
                val rawExpl = q.explanation?.trim()
                text = if (rawExpl.isNullOrEmpty()) {
                    "Gunakan pemahaman konsep dasar materi kurikulum SMP untuk menganalisis dan menyelesaikan butir soal ini."
                } else {
                    rawExpl
                }
                setTextColor(Color.parseColor("#065F46"))
                textSize = 12.5f
                setLineSpacing(3f * density, 1f)
                setPadding(0, (4 * density).toInt(), 0, 0)
            }
            explBox.addView(tvExplText)
            cardContent.addView(explBox)

            qCard.addView(cardContent)
            itemsContainer.addView(qCard)
        }

        scrollView.addView(itemsContainer)
        rootLayout.addView(scrollView)

        // Footer Full Screen
        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#0A2540"))
        }

        var dialog: AlertDialog? = null

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "🏠 TUTUP & KEMBALI KE BERANDA"
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 12 * density
                setColor(Color.parseColor("#2563EB"))
            }
            background = gd
            stateListAnimator = null
            elevation = 0f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (48 * density).toInt()
            )
            setOnClickListener {
                dialog?.dismiss()
                finish()
            }
        }
        footer.addView(btnClose)
        rootLayout.addView(footer)

        dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            .setView(rootLayout)
            .setCancelable(false)
            .create()

        dialog.show()
    }

    private fun showSubmissionRetryDialog() {
        AlertDialog.Builder(this)
            .setTitle("⚠️ Gagal Mengumpulkan Lembar Jawaban")
            .setMessage("Koneksi ke Server Proktor terputus saat pengiriman lembar jawaban final. Seluruh jawaban Anda telah aman tersimpan di memori perangkat. Silakan periksa koneksi Wi-Fi ujian dan tekan 'Kirim Ulang'.")
            .setPositiveButton("Kirim Ulang") { _, _ ->
                submitExamAnswers(isFinished = true)
            }
            .setNegativeButton("Tutup", null)
            .setCancelable(false)
            .show()
    }

    private var hasShownWarningDialog = false

    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean) {
        super.onMultiWindowModeChanged(isInMultiWindowMode)
        if (isInMultiWindowMode) {
            val now = System.currentTimeMillis()
            if (now - lastStrikeTime > 2000) {
                lastStrikeTime = now
                strikeCount++
                reportCheatStrikeToServer("Terdeteksi Membuka Layar Terbagi (Split-Screen / Multi-Window)")
            }
            showCheatWarningModal()
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (!isExamFinishedNormally) {
            val now = System.currentTimeMillis()
            if (now - lastStrikeTime > 2500) {
                lastStrikeTime = now
                strikeCount++
                reportCheatStrikeToServer("Mencoba menekan tombol Home / Beralih Aplikasi")
            }
            try {
                val bringToFront = Intent(this, ExamActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                startActivity(bringToFront)
            } catch (e: Exception) {}
            Toast.makeText(this@ExamActivity, "🔒 Anda tidak dapat keluar dari ujian sebelum menyelesaikan pengerjaan!", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onPause() {
        super.onPause()
        antiPhotoBlurHandler.removeCallbacks(antiPhotoBlurRunnable)
        autoSaveHandler.removeCallbacks(autoSaveRunnable)
        if (!isExamFinishedNormally && !isFinishing) {
            // Beri masa tenggang (grace period) 3.5 detik untuk membedakan gangguan sesaat (notifikasi/telepon) vs curang nyata
            pendingStrikeRunnable?.let { strikeGracePeriodHandler.removeCallbacks(it) }
            val pauseTimestamp = System.currentTimeMillis()
            pendingStrikeRunnable = Runnable {
                if (!isExamFinishedNormally && !isFinishing) {
                    if (pauseTimestamp - lastStrikeTime > 3500) {
                        lastStrikeTime = pauseTimestamp
                        strikeCount++
                        reportCheatStrikeToServer("Layar ujian kehilangan fokus > 3.5 detik / Beralih aplikasi")
                    }
                }
            }
            strikeGracePeriodHandler.postDelayed(pendingStrikeRunnable!!, 3500L)

            try {
                val bringToFront = Intent(this, ExamActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                startActivity(bringToFront)
            } catch (e: Exception) {}
        }
    }

    override fun onResume() {
        super.onResume()
        // Siswa kembali ke aplikasi dalam batas toleransi (< 3.5 detik) -> batalkan penalti strike sesaat
        pendingStrikeRunnable?.let {
            strikeGracePeriodHandler.removeCallbacks(it)
            pendingStrikeRunnable = null
        }

        if (!com.school.smartcbt.utils.DialogHelper.dismissMandatoryAllFilesDialogIfGranted(this)) {
            com.school.smartcbt.utils.DialogHelper.showMandatoryAllFilesDialog(this)
        }
        applyKioskImmersiveMode()

        autoSaveHandler.removeCallbacks(autoSaveRunnable)
        autoSaveHandler.postDelayed(autoSaveRunnable, 30_000)

        resetAntiPhotoTimer()

        if (strikeCount > 0) {
            showCheatWarningModal()
        }
    }

    private fun showCheatWarningModal() {
        if (isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed)) return

        try {
            val density = resources.displayMetrics.density
            val isLocked = strikeCount >= maxAllowedStrikes

            val root = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                setBackgroundColor(Color.WHITE)
                val pad = (20 * density).toInt()
                setPadding(pad, pad, pad, pad)
            }

            // Header Icon & Title Card
            val headerCard = CardView(this).apply {
                radius = 16 * density
                cardElevation = 0f
                setCardBackgroundColor(Color.parseColor(if (isLocked) "#FEF2F2" else "#FFFBEB"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (14 * density).toInt()
                }
            }

            val headerLayout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                val padH = (16 * density).toInt()
                setPadding(padH, padH, padH, padH)
            }

            val tvIcon = TextView(this).apply {
                text = if (isLocked) "🚨" else "⚠️"
                textSize = 36f
                gravity = android.view.Gravity.CENTER
            }
            headerLayout.addView(tvIcon)

            val tvTitle = TextView(this).apply {
                text = if (isLocked) "UJIAN DIKUNCI (STRIKE MAKSIMAL)" else "PERINGATAN INTEGRITAS CBT"
                textSize = 15.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(if (isLocked) "#991B1B" else "#92400E"))
                gravity = android.view.Gravity.CENTER
                setPadding(0, (4 * density).toInt(), 0, (2 * density).toInt())
            }
            headerLayout.addView(tvTitle)

            val tvBadge = TextView(this).apply {
                val remStr = if (remainingStrikes > 0) " (Sisa: $remainingStrikes)" else " (Terkunci)"
                text = "Peringatan Pelanggaran: Strike $strikeCount / $maxAllowedStrikes$remStr"
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(if (isLocked) "#B91C1C" else "#D97706"))
                setBackgroundColor(Color.parseColor(if (isLocked) "#FEE2E2" else "#FEF3C7"))
                val h = (10 * density).toInt()
                val v = (4 * density).toInt()
                setPadding(h, v, h, v)
                gravity = android.view.Gravity.CENTER
            }
            headerLayout.addView(tvBadge)

            headerCard.addView(headerLayout)
            root.addView(headerCard)

            // Message Body
            val tvMsg = TextView(this).apply {
                text = if (isLocked) {
                    "Anda telah meninggalkan layar ujian sebanyak $strikeCount kali (Batas toleransi: $maxAllowedStrikes kali). Lembar ujian Anda telah terkunci secara otomatis demi integritas CBT.\n\nHarap hubungi Proktor / Pengawas Ruangan untuk memasukkan Token Buka Kunci agar dapat melanjutkan ujian."
                } else {
                    "Anda terdeteksi meninggalkan/beralih dari layar ujian! Aktivitas ini dicatat otomatis oleh sistem pengawas (Proktor).\n\nStrike $strikeCount dari maksimal $maxAllowedStrikes (Sisa toleransi: $remainingStrikes kali). Jika mencapai batas maksimal, ujian akan dikunci secara otomatis."
                }
                textSize = 12.5f
                setTextColor(Color.parseColor("#334155"))
                gravity = android.view.Gravity.CENTER
                setPadding(0, 0, 0, (14 * density).toInt())
            }
            root.addView(tvMsg)

            // Input Token Proktor Section
            val tokenCard = CardView(this).apply {
                radius = 12 * density
                cardElevation = 0f
                setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (16 * density).toInt()
                }
            }

            val tokenLayout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (12 * density).toInt()
                setPadding(p, p, p, p)
            }

            val tvTokenLabel = TextView(this).apply {
                text = "🔑 Token Buka Kunci Proktor:"
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#1E293B"))
            }
            tokenLayout.addView(tvTokenLabel)

            val etToken = EditText(this).apply {
                hint = "Masukkan Token Proktor (Contoh: 6 Digit)"
                textSize = 13f
                setSingleLine()
                setBackgroundColor(Color.WHITE)
                setTextColor(Color.parseColor("#0F172A"))
                val pE = (10 * density).toInt()
                setPadding(pE, pE, pE, pE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = (6 * density).toInt()
                }
            }
            tokenLayout.addView(etToken)
            tokenCard.addView(tokenLayout)
            root.addView(tokenCard)

            var dialog: AlertDialog? = null

            // Button 1: Buka Kunci via Token
            val btnUnlockToken = Button(this).apply {
                text = "⚡ Buka Kunci dengan Token"
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#2563EB"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    (46 * density).toInt()
                )
                setOnClickListener {
                    val input = etToken.text.toString().trim()
                    if (input.isEmpty()) {
                        Toast.makeText(this@ExamActivity, "Harap isi Token Proktor terlebih dahulu", Toast.LENGTH_SHORT).show()
                        return@setOnClickListener
                    }
                    val validToken = activeExamToken?.trim()
                    if (!validToken.isNullOrBlank() && input.equals(validToken, ignoreCase = true)) {
                        strikeCount = 0
                        remainingStrikes = maxAllowedStrikes
                        Toast.makeText(this@ExamActivity, "✅ Kunci Ujian Berhasil Dibuka oleh Proktor!", Toast.LENGTH_LONG).show()
                        dialog?.dismiss()
                    } else {
                        Toast.makeText(this@ExamActivity, "❌ Token Proktor Tidak Valid!", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            root.addView(btnUnlockToken)

            // Button 2: Secondary Action (Lanjutkan / Kumpulkan)
            val btnSecondary = Button(this).apply {
                text = if (isLocked) "📥 Kumpulkan Ujian & Keluar" else "Paham & Kembali ke Ujian"
                textSize = 12f
                setTextColor(Color.parseColor(if (isLocked) "#B91C1C" else "#475569"))
                setBackgroundColor(Color.parseColor(if (isLocked) "#FEE2E2" else "#F1F5F9"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    (42 * density).toInt()
                ).apply {
                    topMargin = (8 * density).toInt()
                }
                setOnClickListener {
                    if (isLocked) {
                        dialog?.dismiss()
                        submitExamAnswers(isFinished = true)
                    } else {
                        dialog?.dismiss()
                    }
                }
            }
            root.addView(btnSecondary)

            val scroll = ScrollView(this).apply { addView(root) }

            dialog = AlertDialog.Builder(this)
                .setView(scroll)
                .setCancelable(false)
                .create()

            dialog.show()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun reportCheatStrikeToServer(reason: String) {
        val sExamId = studentExamId
        if (sExamId != null) {
            ApiClient.getClient(this).reportCheatStrike(CheatStrikeRequest(sExamId)).enqueue(object : Callback<CheatStrikeResponse> {
                override fun onResponse(call: Call<CheatStrikeResponse>, response: Response<CheatStrikeResponse>) {
                    if (response.isSuccessful) {
                        response.body()?.let { res ->
                            strikeCount = res.strikeCount ?: 0
                            maxAllowedStrikes = res.maxStrikes ?: 3
                            remainingStrikes = res.remainingStrikes ?: Math.max(0, maxAllowedStrikes - strikeCount)
                            runOnUiThread {
                                if (strikeCount > 0 && !isFinishing) {
                                    showCheatWarningModal()
                                }
                            }
                        }
                    }
                }
                override fun onFailure(call: Call<CheatStrikeResponse>, t: Throwable) {}
            })
        }
    }

    override fun onDestroy() {
        antiPhotoBlurHandler.removeCallbacks(antiPhotoBlurRunnable)
        countDownTimer?.cancel()
        stopListeningAudio()
        autoSaveHandler.removeCallbacks(autoSaveRunnable)
        essayDebounceRunnable?.let { essayDebounceHandler.removeCallbacks(it) }
        super.onDestroy()
    }

    /**
     * Membaca tingkat persentase baterai aktual perangkat siswa (1-100%)
     */
    fun getBatteryPercentage(): Int {
        return try {
            val bm = getSystemService(Context.BATTERY_SERVICE) as? android.os.BatteryManager
            val level = bm?.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
            if (level >= 0) level else 85
        } catch (e: Exception) {
            85
        }
    }
}

