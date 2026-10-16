package com.school.smartcbt.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityOperatorMainBinding
import com.school.smartcbt.utils.AttendancePdfHelper
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class OperatorMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityOperatorMainBinding
    private lateinit var sessionManager: SessionManager

    private var selectedPdfBase64: String? = null
    private var selectedPdfFileName: String? = null

    private val pickPdfLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val uri = result.data?.data
            if (uri != null) {
                handleSelectedPdf(uri)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityOperatorMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        com.school.smartcbt.utils.DialogHelper.applyDynamicFooter(this)
        sessionManager = SessionManager(this)

        setupUI()
        setupTabs()
        loadTeacherLeaves()

        // Cek Pembaruan OTA Otomatis
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
    }

    override fun onResume() {
        super.onResume()
        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
        if (currentTabIndex == 2) {
            startCbtAutoRefresh()
        }
    }

    override fun onPause() {
        super.onPause()
        stopCbtAutoRefresh()
    }

    override fun onDestroy() {
        stopCbtAutoRefresh()
        super.onDestroy()
    }

    private fun setupUI() {
        binding.btnBackOperator.setOnClickListener { finish() }
        binding.btnSwitchToTeacherMode.setOnClickListener {
            startActivity(Intent(this, TeacherMainActivity::class.java))
            finish()
        }
        binding.btnCheckUpdateOperator.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        binding.btnRefreshOpLeaves.setOnClickListener {
            loadTeacherLeaves()
        }

        // Setup Broadcast Target Spinner
        val targets = arrayOf(
            "Semua Siswa & Wali Murid (ALL)",
            "Tingkat Kelas 7 (LEVEL_7)",
            "Tingkat Kelas 8 (LEVEL_8)",
            "Tingkat Kelas 9 (LEVEL_9)",
            "Kelas Tertentu (CLASS)"
        )
        binding.spinnerOpBroadcastTarget.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, targets)
        binding.spinnerOpBroadcastTarget.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                binding.etOpBroadcastClass.visibility = if (position == 4) View.VISIBLE else View.GONE
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        binding.btnOpPickPdf.setOnClickListener {
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "application/pdf"
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            pickPdfLauncher.launch(Intent.createChooser(intent, "Pilih Surat / Edaran PDF"))
        }

        binding.btnOpSendBroadcast.setOnClickListener {
            submitOperatorBroadcast()
        }

        binding.btnRefreshOpCbt.setOnClickListener {
            loadCbtExams()
        }

        binding.btnOpDoResetDevice.setOnClickListener {
            val query = binding.etOpDeviceStudentQuery.text.toString().trim()
            if (query.isEmpty()) {
                Toast.makeText(this, "Harap isi NISN atau Username siswa!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            resetStudentDevice(query)
        }

        binding.btnOpUnlockBiodata.setOnClickListener {
            val query = binding.etOpDeviceStudentQuery.text.toString().trim()
            if (query.isEmpty()) {
                Toast.makeText(this, "Harap isi NISN atau Username siswa!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            unlockStudentBiodata(query)
        }

        binding.btnOpToggleNoPhone.setOnClickListener {
            val query = binding.etOpDeviceStudentQuery.text.toString().trim()
            if (query.isEmpty()) {
                Toast.makeText(this, "Harap isi NISN atau Username siswa!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            toggleNoPhoneStudent(query)
        }

        // Setup Prayer Schedule Days Spinner & Interactive Class Picker (Tab 4)
        setupPrayerSchedulePicker()

        // Setup Rekap Presensi PDF Controls (Tab 5)
        val pdfScopes = arrayOf(
            "Semua Tingkat & Seluruh Rombel (ALL)",
            "Tingkat Kelas VII (7)",
            "Tingkat Kelas VIII (8)",
            "Tingkat Kelas IX (9)",
            "Pilih Kelas Tertentu"
        )
        binding.spinnerOpPdfScope.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, pdfScopes)

        val schoolClasses = arrayOf(
            "VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K",
            "VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K",
            "IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K"
        )
        binding.spinnerOpPdfClass.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, schoolClasses)

        binding.spinnerOpPdfScope.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val isSpecificClass = (position == 4)
                binding.tvOpPdfClassLabel.visibility = if (isSpecificClass) View.VISIBLE else View.GONE
                binding.spinnerOpPdfClass.visibility = if (isSpecificClass) View.VISIBLE else View.GONE
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        binding.btnOpPrintPdf.setOnClickListener {
            val (scope, tingkat, className) = getSelectedPdfParams()
            AttendancePdfHelper.printPdfDirectly(this, className, scope, tingkat)
        }

        binding.btnOpOpenBrowserPdf.setOnClickListener {
            val (scope, tingkat, className) = getSelectedPdfParams()
            AttendancePdfHelper.openBrowserDirectly(this, className, scope, tingkat)
        }
    }

    private fun getSelectedPdfParams(): Triple<String?, String?, String?> {
        val pos = binding.spinnerOpPdfScope.selectedItemPosition
        return when (pos) {
            1 -> Triple("LEVEL", "7", null)
            2 -> Triple("LEVEL", "8", null)
            3 -> Triple("LEVEL", "9", null)
            4 -> {
                val selectedClass = binding.spinnerOpPdfClass.selectedItem?.toString() ?: "VII-A"
                Triple("CLASS", null, selectedClass)
            }
            else -> Triple("ALL", null, null)
        }
    }

    private fun setupTabs() {
        binding.tabBtnOpLeaves.setOnClickListener { switchTab(0) }
        binding.tabBtnOpBroadcast.setOnClickListener { switchTab(1) }
        binding.tabBtnOpCbt.setOnClickListener { switchTab(2) }
        binding.tabBtnOpDevice.setOnClickListener { switchTab(3) }
        binding.tabBtnOpPrayer.setOnClickListener { switchTab(4) }
        binding.tabBtnOpAttendancePdf.setOnClickListener { switchTab(5) }
        switchTab(0)
    }

    private fun switchTab(tabIndex: Int) {
        val inactiveBg = Color.parseColor("#F1F5F9")
        val inactiveText = Color.parseColor("#64748B")
        val activeColor = Color.parseColor("#312E81")
        val white = Color.WHITE

        fun styleTab(btn: View, tv: TextView, isActive: Boolean) {
            val gd = android.graphics.drawable.GradientDrawable()
            gd.cornerRadius = 18f * resources.displayMetrics.density
            if (isActive) {
                gd.setColor(activeColor)
                btn.background = gd
                tv.setTextColor(white)
                tv.setTypeface(null, Typeface.BOLD)
            } else {
                gd.setColor(inactiveBg)
                btn.background = gd
                tv.setTextColor(inactiveText)
                tv.setTypeface(null, Typeface.NORMAL)
            }
        }

        binding.containerTabOpLeaves.visibility = if (tabIndex == 0) View.VISIBLE else View.GONE
        binding.containerTabOpBroadcast.visibility = if (tabIndex == 1) View.VISIBLE else View.GONE
        binding.containerTabOpCbt.visibility = if (tabIndex == 2) View.VISIBLE else View.GONE
        binding.containerTabOpDevice.visibility = if (tabIndex == 3) View.VISIBLE else View.GONE
        binding.containerTabOpPrayer.visibility = if (tabIndex == 4) View.VISIBLE else View.GONE
        binding.containerTabOpAttendancePdf.visibility = if (tabIndex == 5) View.VISIBLE else View.GONE

        styleTab(binding.tabBtnOpLeaves, binding.tvTabOpLeaves, tabIndex == 0)
        styleTab(binding.tabBtnOpBroadcast, binding.tvTabOpBroadcast, tabIndex == 1)
        styleTab(binding.tabBtnOpCbt, binding.tvTabOpCbt, tabIndex == 2)
        styleTab(binding.tabBtnOpDevice, binding.tvTabOpDevice, tabIndex == 3)
        styleTab(binding.tabBtnOpPrayer, binding.tvTabOpPrayer, tabIndex == 4)
        styleTab(binding.tabBtnOpAttendancePdf, binding.tvTabOpAttendancePdf, tabIndex == 5)

        currentTabIndex = tabIndex
        if (tabIndex == 2) {
            startCbtAutoRefresh()
        } else {
            stopCbtAutoRefresh()
        }

        when (tabIndex) {
            0 -> loadTeacherLeaves()
            1 -> loadBroadcastHistory()
            2 -> loadCbtExams()
            4 -> loadTodayPrayerSchedule()
        }
    }

    // ==================== TAB 0: APPROVAL IZIN GURU ====================
    private fun loadTeacherLeaves() {
        Toast.makeText(this, "Memuat permohonan izin guru...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getAllTeacherLeaves("PENDING").enqueue(object : Callback<TeacherLeaveResponse> {
            override fun onResponse(call: Call<TeacherLeaveResponse>, response: Response<TeacherLeaveResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val list = response.body()!!.leaves ?: emptyList()
                    binding.tvOpLeavesSummary.text = "Terdapat ${list.size} pengajuan izin guru menunggu persetujuan Operator"
                    renderTeacherLeaves(list)
                } else {
                    Toast.makeText(this@OperatorMainActivity, "Gagal memuat izin guru", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<TeacherLeaveResponse>, t: Throwable) {
                Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderTeacherLeaves(leaves: List<TeacherLeaveDto>) {
        val container = binding.llOpLeavesList
        container.removeAllViews()

        if (leaves.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "🎉 Tidak ada pengajuan izin guru yang menunggu persetujuan."
                setTextColor(Color.parseColor("#64748B"))
                textSize = 12f
                setPadding(20, 30, 20, 30)
                gravity = android.view.Gravity.CENTER
            }
            container.addView(tvEmpty)
            return
        }

        leaves.forEach { item ->
            val card = CardView(this).apply {
                radius = 12f * resources.displayMetrics.density
                cardElevation = 2f * resources.displayMetrics.density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 14
                }
                layoutParams = lp
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(24, 20, 24, 20)
            }

            // Top Row
            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val tvName = TextView(this).apply {
                text = "👨‍🏫 ${item.teacherName} (${item.teachingSubject ?: "Guru"})"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                layoutParams = lp
            }
            topRow.addView(tvName)

            val tvCat = TextView(this).apply {
                text = item.category
                setTextColor(Color.parseColor("#312E81"))
                setBackgroundColor(Color.parseColor("#EEF2FF"))
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(12, 4, 12, 4)
            }
            topRow.addView(tvCat)
            inner.addView(topRow)

            val sDate = item.startDate.take(10)
            val eDate = item.endDate.take(10)
            val tvDates = TextView(this).apply {
                text = "📅 Tanggal: $sDate s/d $eDate"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11.5f
                setPadding(0, 6, 0, 0)
            }
            inner.addView(tvDates)

            val tvReason = TextView(this).apply {
                text = "Alasan: ${item.reason}"
                setTextColor(Color.parseColor("#334155"))
                textSize = 12f
                setPadding(0, 4, 0, 0)
            }
            inner.addView(tvReason)

            if (!item.affectedSchedules.isNullOrEmpty()) {
                val tvClasses = TextView(this).apply {
                    text = "🏫 Kelas & Jam Terdampak: ${item.affectedSchedules}"
                    setTextColor(Color.parseColor("#D97706"))
                    textSize = 11.5f
                    setTypeface(null, Typeface.BOLD)
                    setPadding(0, 4, 0, 0)
                }
                inner.addView(tvClasses)
            }

            if (!item.assignmentForStudents.isNullOrEmpty()) {
                val tvTask = TextView(this).apply {
                    text = "📝 Tugas Mandiri: ${item.assignmentForStudents}"
                    setTextColor(Color.parseColor("#059669"))
                    textSize = 11.5f
                    setPadding(0, 4, 0, 0)
                }
                inner.addView(tvTask)
            }

            // Buttons: Approve & Reject
            val btnRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = 12
                }
                layoutParams = lp
            }

            val btnApprove = Button(this).apply {
                text = "✅ Setujui Izin"
                textSize = 11.5f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#059669"))
                val lp = LinearLayout.LayoutParams(0, (40 * resources.displayMetrics.density).toInt(), 1f).apply {
                    marginEnd = 6
                }
                layoutParams = lp
                setOnClickListener {
                    approveLeave(item.id, item.teacherName)
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
                    rejectLeave(item.id, item.teacherName)
                }
            }
            btnRow.addView(btnReject)

            inner.addView(btnRow)
            card.addView(inner)
            container.addView(card)
        }
    }

    private fun approveLeave(id: String, teacherName: String) {
        AlertDialog.Builder(this)
            .setTitle("Setujui Izin: $teacherName?")
            .setMessage("Setelah disetujui, kelas kosong & tugas mandiri akan otomatis diteruskan ke Guru Piket hari ini.")
            .setPositiveButton("Setujui") { _, _ ->
                Toast.makeText(this, "Memproses persetujuan...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).approveTeacherLeave(id, emptyMap()).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@OperatorMainActivity, "✅ Izin berhasil disetujui! Posko Guru Piket telah diperbarui.", Toast.LENGTH_LONG).show()
                            loadTeacherLeaves()
                        } else {
                            Toast.makeText(this@OperatorMainActivity, "Gagal menyetujui izin", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun rejectLeave(id: String, teacherName: String) {
        val input = EditText(this).apply {
            hint = "Alasan penolakan izin..."
            setPadding(30, 20, 30, 20)
        }
        AlertDialog.Builder(this)
            .setTitle("Tolak Izin: $teacherName")
            .setView(input)
            .setPositiveButton("Tolak Izin") { _, _ ->
                val reason = input.text.toString().trim().ifEmpty { "Ditolak oleh Operator" }
                ApiClient.getClient(this).rejectTeacherLeave(id, mapOf("rejectionNote" to reason)).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            Toast.makeText(this@OperatorMainActivity, "Izin ditolak.", Toast.LENGTH_SHORT).show()
                            loadTeacherLeaves()
                        } else {
                            Toast.makeText(this@OperatorMainActivity, "Gagal menolak izin", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    // ==================== TAB 1: BROADCAST PDF ====================
    private fun handleSelectedPdf(uri: Uri) {
        try {
            val contentResolver = applicationContext.contentResolver
            val inputStream = contentResolver.openInputStream(uri)
            val bytes = inputStream?.readBytes()
            inputStream?.close()

            if (bytes != null) {
                selectedPdfBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                selectedPdfFileName = "surat_edaran_${System.currentTimeMillis()}.pdf"
                binding.tvOpPdfFileName.text = "✅ $selectedPdfFileName (${bytes.size / 1024} KB)"
                binding.tvOpPdfFileName.setTextColor(Color.parseColor("#059669"))
                Toast.makeText(this, "File PDF berhasil dimuat!", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal membaca PDF: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun submitOperatorBroadcast() {
        val title = binding.etOpBroadcastTitle.text.toString().trim()
        val message = binding.etOpBroadcastMessage.text.toString().trim()
        val targetPos = binding.spinnerOpBroadcastTarget.selectedItemPosition
        val targetType = when (targetPos) {
            1 -> "GRADE"
            2 -> "GRADE"
            3 -> "GRADE"
            4 -> "CLASS"
            else -> "ALL"
        }
        val targetGrade = when (targetPos) {
            1 -> "7"
            2 -> "8"
            3 -> "9"
            else -> null
        }
        val targetClass = if (targetPos == 4) binding.etOpBroadcastClass.text.toString().trim() else null

        if (title.isEmpty() || message.isEmpty()) {
            Toast.makeText(this, "Harap isi judul dan keterangan pengumuman!", Toast.LENGTH_SHORT).show()
            return
        }

        val body = mutableMapOf<String, Any?>(
            "title" to title,
            "message" to message,
            "targetType" to targetType
        )
        if (targetGrade != null) body["targetGrade"] = targetGrade
        if (!targetClass.isNullOrEmpty()) body["targetClass"] = targetClass
        if (!selectedPdfBase64.isNullOrEmpty()) {
            body["pdfBase64"] = selectedPdfBase64
            body["fileName"] = selectedPdfFileName
        }

        Toast.makeText(this, "Mengirim broadcast pengumuman...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).sendOperatorBroadcast(body).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    Toast.makeText(this@OperatorMainActivity, "✅ Broadcast pengumuman berhasil dikirim!", Toast.LENGTH_LONG).show()
                    binding.etOpBroadcastTitle.text.clear()
                    binding.etOpBroadcastMessage.text.clear()
                    selectedPdfBase64 = null
                    selectedPdfFileName = null
                    binding.tvOpPdfFileName.text = "Belum ada file PDF dipilih"
                    binding.tvOpPdfFileName.setTextColor(Color.parseColor("#64748B"))
                    loadBroadcastHistory()
                } else {
                    Toast.makeText(this@OperatorMainActivity, "Gagal mengirim broadcast", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun loadBroadcastHistory() {
        ApiClient.getClient(this).getOperatorBroadcasts().enqueue(object : Callback<OperatorBroadcastResponse> {
            override fun onResponse(call: Call<OperatorBroadcastResponse>, response: Response<OperatorBroadcastResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val list = response.body()!!.letters ?: emptyList()
                    renderBroadcastHistory(list)
                }
            }
            override fun onFailure(call: Call<OperatorBroadcastResponse>, t: Throwable) {}
        })
    }

    private fun renderBroadcastHistory(letters: List<OfficialLetterDto>) {
        val container = binding.llOpBroadcastHistory
        container.removeAllViews()

        if (letters.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada riwayat broadcast surat resmi."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(10, 10, 10, 10)
            }
            container.addView(tvEmpty)
            return
        }

        letters.forEach { letter ->
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

            val tvTitle = TextView(this).apply {
                text = "📢 ${letter.title}"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
            }
            inner.addView(tvTitle)

            val tvTarget = TextView(this).apply {
                text = "Sasaran: ${letter.targetType} • Dibuat: ${letter.createdAt?.take(10) ?: "-"}"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11f
                setPadding(0, 4, 0, 0)
            }
            inner.addView(tvTarget)

            if (!letter.fileUrl.isNullOrEmpty()) {
                val tvPdf = TextView(this).apply {
                    text = "📎 Dilampirkan PDF Resmi: ${letter.fileUrl}"
                    setTextColor(Color.parseColor("#2563EB"))
                    textSize = 11f
                    setPadding(0, 4, 0, 0)
                }
                inner.addView(tvPdf)
            }

            card.addView(inner)
            container.addView(card)
        }
    }

    // ==================== TAB 2: TOKEN CBT (REALTIME MONITORING) ====================
    private var cbtRefreshHandler: android.os.Handler? = null
    private var cbtRefreshRunnable: Runnable? = null
    private var currentTabIndex = 0

    private fun startCbtAutoRefresh() {
        stopCbtAutoRefresh()
        cbtRefreshHandler = android.os.Handler(android.os.Looper.getMainLooper())
        cbtRefreshRunnable = object : Runnable {
            override fun run() {
                if (currentTabIndex == 2 && !isFinishing) {
                    loadCbtExams(silent = true)
                    cbtRefreshHandler?.postDelayed(this, 10000)
                }
            }
        }
        cbtRefreshHandler?.postDelayed(cbtRefreshRunnable!!, 10000)
    }

    private fun stopCbtAutoRefresh() {
        cbtRefreshRunnable?.let { cbtRefreshHandler?.removeCallbacks(it) }
        cbtRefreshHandler = null
        cbtRefreshRunnable = null
    }

    private fun loadCbtExams(silent: Boolean = false) {
        if (!silent) {
            Toast.makeText(this, "Memperbarui monitoring ujian CBT...", Toast.LENGTH_SHORT).show()
        }
        ApiClient.getClient(this).getProctorCbtTokens(null, null).enqueue(object : Callback<ProctorCbtTokensResponse> {
            override fun onResponse(call: Call<ProctorCbtTokensResponse>, response: Response<ProctorCbtTokensResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val exams = response.body()!!.exams ?: emptyList()
                    renderCbtExams(exams)
                } else if (!silent) {
                    Toast.makeText(this@OperatorMainActivity, "Gagal memuat ujian CBT", Toast.LENGTH_SHORT).show()
                }
            }
            override fun onFailure(call: Call<ProctorCbtTokensResponse>, t: Throwable) {
                if (!silent) {
                    Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun renderCbtExams(exams: List<ProctorExamDto>) {
        val container = binding.llOpCbtExamsList
        container.removeAllViews()

        // Badge Status Realtime
        val liveBadge = TextView(this).apply {
            text = "🟢 Live Real-time Monitoring Aktif (Auto-Refresh 10 detik)"
            setTextColor(Color.parseColor("#059669"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#ECFDF5"))
                setStroke((1 * resources.displayMetrics.density).toInt(), Color.parseColor("#A7F3D0"))
                cornerRadius = 8 * resources.displayMetrics.density
            }
            background = bg
            setPadding(16, 8, 16, 8)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = 12
            }
            layoutParams = lp
        }
        container.addView(liveBadge)

        if (exams.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Tidak ada jadwal ujian CBT aktif hari ini."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(10, 20, 10, 20)
            }
            container.addView(tvEmpty)
            return
        }

        exams.forEach { exam ->
            val card = CardView(this).apply {
                radius = 12f * resources.displayMetrics.density
                cardElevation = 2f * resources.displayMetrics.density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 14
                }
                layoutParams = lp
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(22, 18, 22, 18)
            }

            val tvTitle = TextView(this).apply {
                text = "📝 ${exam.title}"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 14f
                setTypeface(null, Typeface.BOLD)
            }
            inner.addView(tvTitle)

            val tvToken = TextView(this).apply {
                text = "🔑 Token Master: ${exam.token ?: "OFF"} • Sasaran: ${exam.assignedClasses ?: "Semua Kelas"}"
                setTextColor(Color.parseColor("#78350F"))
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, 4, 0, 0)
            }
            inner.addView(tvToken)

            // Distribusi Token per Rombel Paralel (Pills Interaktif & Salin)
            val classTokens = exam.classTokens
            if (!classTokens.isNullOrEmpty()) {
                val tvClassTokensTitle = TextView(this).apply {
                    text = "Distribusi Token per Kelas (Klik untuk Menyalin):"
                    setTextColor(Color.parseColor("#475569"))
                    textSize = 11f
                    setTypeface(null, Typeface.BOLD)
                    setPadding(0, 10, 0, 4)
                }
                inner.addView(tvClassTokensTitle)

                val tokensContainer = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(0, 4, 0, 0)
                }

                var currentRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = 6
                    }
                }
                var itemsInRow = 0

                classTokens.toSortedMap().forEach { (cName, cToken) ->
                    if (itemsInRow == 3) {
                        tokensContainer.addView(currentRow)
                        currentRow = LinearLayout(this).apply {
                            orientation = LinearLayout.HORIZONTAL
                            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = 6
                            }
                        }
                        itemsInRow = 0
                    }

                    val pill = TextView(this).apply {
                        text = "$cName: $cToken"
                        textSize = 11f
                        setTextColor(Color.parseColor("#1E3A8A"))
                        setTypeface(null, Typeface.BOLD)
                        val pillBg = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor("#EFF6FF"))
                            setStroke((1 * resources.displayMetrics.density).toInt(), Color.parseColor("#BFDBFE"))
                            cornerRadius = 8 * resources.displayMetrics.density
                        }
                        background = pillBg
                        setPadding(12, 8, 12, 8)
                        val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                            rightMargin = 6
                        }
                        layoutParams = lp
                        gravity = android.view.Gravity.CENTER
                        setOnClickListener {
                            val clipboard = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                            val clip = android.content.ClipData.newPlainText("Token $cName", cToken)
                            clipboard.setPrimaryClip(clip)
                            Toast.makeText(this@OperatorMainActivity, "Token $cName ($cToken) disalin!", Toast.LENGTH_SHORT).show()
                        }
                    }
                    currentRow.addView(pill)
                    itemsInRow++
                }
                if (itemsInRow > 0) {
                    tokensContainer.addView(currentRow)
                }
                inner.addView(tokensContainer)
            }

            card.addView(inner)
            container.addView(card)
        }
    }

    // ==================== TAB 3: RESET DEVICE, UNLOCK BIODATA & STATUS SISWA ====================
    private fun resetStudentDevice(query: String) {
        Toast.makeText(this, "Mereset kunci perangkat siswa...", Toast.LENGTH_SHORT).show()
        val body = mapOf("query" to query)
        ApiClient.getClient(this).resetStudentDeviceBinding(body).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    val msg = response.body()?.message ?: "Device binding siswa berhasil di-reset!"
                    AlertDialog.Builder(this@OperatorMainActivity)
                        .setTitle("✅ Reset Berhasil")
                        .setMessage(msg)
                        .setPositiveButton("OK", null)
                        .show()
                    binding.etOpDeviceStudentQuery.text.clear()
                } else {
                    val err = response.errorBody()?.string() ?: "Siswa tidak ditemukan"
                    Toast.makeText(this@OperatorMainActivity, "Gagal: $err", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun unlockStudentBiodata(query: String) {
        Toast.makeText(this, "Membuka kunci formulir biodata...", Toast.LENGTH_SHORT).show()
        val body = mapOf("query" to query)
        ApiClient.getClient(this).unlockStudentBiodata(body).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    val msg = response.body()?.message ?: "Kunci biodata siswa berhasil dibuka!"
                    AlertDialog.Builder(this@OperatorMainActivity)
                        .setTitle("✅ Kunci Biodata Terbuka")
                        .setMessage(msg)
                        .setPositiveButton("OK", null)
                        .show()
                    binding.etOpDeviceStudentQuery.text.clear()
                } else {
                    val err = response.errorBody()?.string() ?: "Siswa tidak ditemukan"
                    Toast.makeText(this@OperatorMainActivity, "Gagal: $err", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun toggleNoPhoneStudent(query: String) {
        Toast.makeText(this, "Mengubah status Siswa Tanpa HP...", Toast.LENGTH_SHORT).show()
        val body = mapOf<String, Any>("query" to query)
        ApiClient.getClient(this).toggleNoPhoneByOperator(body).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    val msg = response.body()?.message ?: "Status siswa tanpa HP berhasil diubah!"
                    AlertDialog.Builder(this@OperatorMainActivity)
                        .setTitle("✅ Status Diperbarui")
                        .setMessage(msg)
                        .setPositiveButton("OK", null)
                        .show()
                    binding.etOpDeviceStudentQuery.text.clear()
                } else {
                    val err = response.errorBody()?.string() ?: "Gagal mengubah status"
                    Toast.makeText(this@OperatorMainActivity, "Gagal: $err", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    // ==================== TAB 4: JADWAL SHOLAT ====================
    private val selectedOpPrayerClasses = mutableSetOf<String>()
    private val opPrayerCheckboxes = mutableMapOf<String, CheckBox>()
    private var weeklyOpPrayerSchedules: List<PrayerClassScheduleDto> = emptyList()

    private val opGrade7Classes = listOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H", "VII-I", "VII-J", "VII-K")
    private val opGrade8Classes = listOf("VIII-A", "VIII-B", "VIII-C", "VIII-D", "VIII-E", "VIII-F", "VIII-G", "VIII-H", "VIII-I", "VIII-J", "VIII-K")
    private val opGrade9Classes = listOf("IX-A", "IX-B", "IX-C", "IX-D", "IX-E", "IX-F", "IX-G", "IX-H", "IX-I", "IX-J", "IX-K")

    private fun setupPrayerSchedulePicker() {
        val days = arrayOf("SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU")
        binding.spinnerOpPrayerDay.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, days)

        buildOpPrayerCheckboxes()

        binding.btnOpQuickAll7.setOnClickListener {
            toggleGradeClasses(opGrade7Classes)
        }
        binding.btnOpQuickAll8.setOnClickListener {
            toggleGradeClasses(opGrade8Classes)
        }
        binding.btnOpQuickAll9.setOnClickListener {
            toggleGradeClasses(opGrade9Classes)
        }
        binding.btnOpQuickAllMale.setOnClickListener {
            selectedOpPrayerClasses.clear()
            selectedOpPrayerClasses.add("ALL_MALE")
            opPrayerCheckboxes.values.forEach { it.isChecked = false }
            refreshOpPrayerSummary()
        }
        binding.btnOpQuickClear.setOnClickListener {
            selectedOpPrayerClasses.clear()
            opPrayerCheckboxes.values.forEach { it.isChecked = false }
            refreshOpPrayerSummary()
        }

        binding.spinnerOpPrayerDay.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val dayIndex = position + 1 // 1=Senin, 2=Selasa, dst.
                syncScheduleForDay(dayIndex)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        binding.btnOpSavePrayerSchedule.setOnClickListener {
            savePrayerSchedule()
        }

        loadAllPrayerSchedulesForOperator()
        loadTodayPrayerSchedule()
    }

    private fun buildOpPrayerCheckboxes() {
        val container = binding.llOpPrayerCheckboxesContainer
        container.removeAllViews()
        opPrayerCheckboxes.clear()

        val density = resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()

        fun addGradeSection(title: String, gradeClasses: List<String>, headerColor: String) {
            val tvH = TextView(this).apply {
                text = title
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(headerColor))
                setPadding(0, dp(6), 0, dp(4))
            }
            container.addView(tvH)

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
                            isChecked = selectedOpPrayerClasses.contains(cName)
                            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                            layoutParams = lp
                            setOnCheckedChangeListener { _, checked ->
                                if (checked) {
                                    selectedOpPrayerClasses.remove("ALL_MALE")
                                    selectedOpPrayerClasses.add(cName)
                                } else {
                                    selectedOpPrayerClasses.remove(cName)
                                }
                                refreshOpPrayerSummary()
                            }
                        }
                        opPrayerCheckboxes[cName] = cb
                        row.addView(cb)
                    } else {
                        val dummy = View(this).apply {
                            layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
                        }
                        row.addView(dummy)
                    }
                }
                container.addView(row)
            }
        }

        addGradeSection("Tingkat Kelas VII (11 Rombel):", opGrade7Classes, "#0284C7")
        addGradeSection("Tingkat Kelas VIII (11 Rombel):", opGrade8Classes, "#4F46E5")
        addGradeSection("Tingkat Kelas IX (11 Rombel):", opGrade9Classes, "#7C3AED")
    }

    private fun toggleGradeClasses(gradeList: List<String>) {
        if (gradeList.all { selectedOpPrayerClasses.contains(it) }) {
            selectedOpPrayerClasses.removeAll(gradeList.toSet())
        } else {
            selectedOpPrayerClasses.remove("ALL_MALE")
            selectedOpPrayerClasses.addAll(gradeList)
        }
        gradeList.forEach { c -> opPrayerCheckboxes[c]?.isChecked = selectedOpPrayerClasses.contains(c) }
        refreshOpPrayerSummary()
    }

    private fun refreshOpPrayerSummary() {
        val sortedList = selectedOpPrayerClasses.sorted()
        val textDisplay = if (selectedOpPrayerClasses.contains("ALL_MALE")) {
            "🕌 Khusus Semua Siswa Putra (Sholat Jumat / ALL_MALE)"
        } else if (sortedList.isEmpty()) {
            "⚠️ Belum ada rombel kelas yang dipilih (Centang kelas di bawah)"
        } else {
            "✅ Terpilih (${sortedList.size} Rombel): ${sortedList.joinToString(", ")}"
        }
        binding.tvOpPrayerSummaryBadge.text = textDisplay
        binding.etOpPrayerClasses.setText(if (selectedOpPrayerClasses.contains("ALL_MALE")) "ALL_MALE" else sortedList.joinToString(","))
    }

    private fun syncScheduleForDay(dayIndex: Int) {
        val sched = weeklyOpPrayerSchedules.find { it.dayOfWeek == dayIndex }
        selectedOpPrayerClasses.clear()
        if (sched != null) {
            val raw = (sched.classNames ?: "").split(",").map { it.trim().uppercase() }.filter { it.isNotEmpty() }
            selectedOpPrayerClasses.addAll(raw)
        }
        opPrayerCheckboxes.forEach { (cName, cb) ->
            cb.isChecked = selectedOpPrayerClasses.contains(cName)
        }
        refreshOpPrayerSummary()
    }

    private fun loadAllPrayerSchedulesForOperator() {
        ApiClient.getClient(this).getAllPrayerSchedules().enqueue(object : Callback<AllPrayerSchedulesResponse> {
            override fun onResponse(call: Call<AllPrayerSchedulesResponse>, response: Response<AllPrayerSchedulesResponse>) {
                if (response.isSuccessful && response.body()?.schedules != null) {
                    weeklyOpPrayerSchedules = response.body()!!.schedules!!
                    val curDayIdx = binding.spinnerOpPrayerDay.selectedItemPosition + 1
                    syncScheduleForDay(curDayIdx)
                }
            }
            override fun onFailure(call: Call<AllPrayerSchedulesResponse>, t: Throwable) {}
        })
    }

    private fun savePrayerSchedule() {
        val day = binding.spinnerOpPrayerDay.selectedItem.toString()
        val classes = binding.etOpPrayerClasses.text.toString().trim()
        if (classes.isEmpty()) {
            Toast.makeText(this, "Harap pilih minimal 1 rombel atau centang kelas untuk hari $day", Toast.LENGTH_SHORT).show()
            return
        }

        val cleanDayUpper = day.uppercase()
        val prayerType = if (cleanDayUpper == "JUMAT" && classes == "ALL_MALE") {
            "JUMAT"
        } else if ((cleanDayUpper == "JUMAT" && !classes.contains("ALL_MALE")) || (cleanDayUpper == "SABTU" && classes.contains("IX-K"))) {
            "DHUHA"
        } else {
            "DHUHUR"
        }
        val body = mapOf(
            "dayOfWeek" to day,
            "classes" to classes,
            "prayerType" to prayerType
        )
        Toast.makeText(this, "Menyimpan & menyinkronkan jadwal sholat...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).setPrayerClassSchedule(body).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    Toast.makeText(this@OperatorMainActivity, "✅ Jadwal sholat hari $day berhasil disimpan & disinkronkan!", Toast.LENGTH_SHORT).show()
                    loadAllPrayerSchedulesForOperator()
                    loadTodayPrayerSchedule()
                } else {
                    Toast.makeText(this@OperatorMainActivity, "Gagal menyimpan jadwal sholat", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@OperatorMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun loadTodayPrayerSchedule() {
        ApiClient.getClient(this).getTodayPrayerSchedule().enqueue(object : Callback<PrayerScheduleResponse> {
            override fun onResponse(call: Call<PrayerScheduleResponse>, response: Response<PrayerScheduleResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    val container = binding.llOpPrayerTodayInfo
                    container.removeAllViews()

                    val tv = TextView(this@OperatorMainActivity).apply {
                        text = "📅 Hari Ini (${body.dayOfWeek}):\nKelas Terjadwal Sholat: ${if (body.scheduledClasses.isEmpty()) "Semua Siswa Mandiri" else body.scheduledClasses.joinToString(", ")}"
                        setTextColor(Color.parseColor("#059669"))
                        textSize = 12f
                        setTypeface(null, Typeface.BOLD)
                        setBackgroundColor(Color.parseColor("#ECFDF5"))
                        setPadding(20, 16, 20, 16)
                    }
                    container.addView(tv)
                }
            }
            override fun onFailure(call: Call<PrayerScheduleResponse>, t: Throwable) {}
        })
    }
}
