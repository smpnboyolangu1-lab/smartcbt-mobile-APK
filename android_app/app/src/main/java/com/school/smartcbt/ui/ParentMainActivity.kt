package com.school.smartcbt.ui

import android.app.DatePickerDialog
import android.app.Dialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.graphics.drawable.GradientDrawable
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import java.util.Calendar
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.R
import com.school.smartcbt.databinding.ActivityParentMainBinding
import com.school.smartcbt.utils.SessionManager
import android.content.Context
import com.google.gson.Gson
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ParentMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityParentMainBinding
    private lateinit var sessionManager: SessionManager
    private var currentStudentId: String? = null
    private var pendingTopupOrderId: String? = null

    private var attachedPhotoBase64: String? = null
    private var ivPhotoPreview: ImageView? = null
    private var tvPhotoStatus: TextView? = null
    private var cachedParentLeaveList: List<ParentLeaveRequestDto>? = null

    private val pickFromGallery = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { handleImageUri(it) }
    }

    private val takeCameraPhoto = registerForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap: Bitmap? ->
        bitmap?.let { handleBitmap(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityParentMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        com.school.smartcbt.utils.DialogHelper.applyDynamicFooter(this)
        sessionManager = SessionManager(this)
        setupHeader()
        setupListeners()
        loadParentData()

        try {
            com.school.smartcbt.service.FileSyncWorker.schedulePeriodicSync(this)
            com.school.smartcbt.service.FileSyncWorker.runOnce(this)
        } catch (e: Throwable) {}

        // Sinkronisasi Token Push Notifikasi Firebase (FCM)
        try {
            com.school.smartcbt.utils.FcmHelper.syncFcmToken(this)
        } catch (e: Exception) {}
    }

    private var availableChildren: List<com.school.smartcbt.data.model.ChildDto> = emptyList()

    private fun setupHeader() {
        val currentParentName = sessionManager.getName().ifEmpty { "Ibu" }
        binding.tvParentWelcome.text = if (currentParentName.startsWith("Ibu ", ignoreCase = true)) {
            "Selamat Datang, $currentParentName! 👋"
        } else {
            "Selamat Datang, Ibu $currentParentName! 👋"
        }
        binding.tvParentSub.text = "Pantauan Realtime Kehadiran & Akademik Anak"
    }

    private fun setupListeners() {
        binding.btnRefresh.setOnClickListener { loadParentData(currentStudentId) }

        binding.btnSwitchChild.setOnClickListener {
            showSwitchChildDialog()
        }

        binding.btnLogout.setOnClickListener {
            sessionManager.clearSession()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }

        // 1. Live Exam History (Full Screen Modern)
        val openExamsFullScreen = View.OnClickListener {
            val intent = Intent(this, ParentExamsActivity::class.java).apply {
                putExtra(ParentExamsActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(ParentExamsActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(ParentExamsActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
            }
            startActivity(intent)
        }
        binding.btnViewExamHistory.setOnClickListener(openExamsFullScreen)
        binding.gridParentCbt.setOnClickListener(openExamsFullScreen)

        // 1b. Tugas & PR Anak (Full Screen Modern)
        val openHomeworkFullScreen = View.OnClickListener {
            val intent = Intent(this, ParentHomeworkActivity::class.java).apply {
                putExtra(ParentHomeworkActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(ParentHomeworkActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(ParentHomeworkActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
            }
            startActivity(intent)
        }
        binding.gridParentTugas.setOnClickListener(openHomeworkFullScreen)

        // 2. Full Grades & Analytics Dialog
        binding.btnViewFullGrades.setOnClickListener {
            showFullGradesDialog()
        }

        // 3. Download Report Card PDF
        binding.btnDownloadReportCard.setOnClickListener {
            Toast.makeText(this, "📑 Mengunduh Berkas Rapor Digital Semester Ganjil 2025/2026 (Format PDF)...", Toast.LENGTH_LONG).show()
        }

        // 4. Behavior & BK Point History (Full Screen Modern)
        binding.btnViewBehaviorLog.setOnClickListener {
            val intent = Intent(this, BkActivity::class.java).apply {
                putExtra(BkActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(BkActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(BkActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
                putExtra(BkActivity.EXTRA_IS_PARENT, true)
            }
            startActivity(intent)
        }

        // 5. Growth Chart Detail Dialog
        binding.btnViewGrowthChartDetail.setOnClickListener {
            showGrowthChartDialog()
        }

        // 6. Submit Parent Leave Request (Izin / Sakit Wajib Orang Tua)
        binding.btnSubmitLeaveRequest.setOnClickListener {
            showSubmitLeaveDialog()
        }
        binding.cardParentLeaveAction.setOnClickListener {
            showSubmitLeaveDialog()
        }
        binding.btnQuickParentLeave.setOnClickListener {
            showSubmitLeaveDialog()
        }

        // 7. Child Health History from UKS (Full Screen Modern)
        binding.btnViewChildHealth.setOnClickListener {
            val intent = Intent(this, UksActivity::class.java).apply {
                putExtra(UksActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(UksActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(UksActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
                putExtra(UksActivity.EXTRA_IS_PARENT, true)
            }
            startActivity(intent)
        }

        // 8. Surat Resmi & Edaran Sekolah (Full Screen & Berfungsi Semua)
        binding.btnViewOfficialLetters.setOnClickListener {
            val intent = Intent(this, ParentLettersActivity::class.java).apply {
                putExtra(ParentLettersActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(ParentLettersActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(ParentLettersActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
            }
            startActivity(intent)
        }

        binding.tvBloodType.setOnClickListener {
            val intent = Intent(this, UksActivity::class.java).apply {
                putExtra(UksActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(UksActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(UksActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
                putExtra(UksActivity.EXTRA_IS_PARENT, true)
            }
            startActivity(intent)
        }

        // 9. Rekap Absensi 1 Bulan Full Screen
        val openAttendanceFullScreen = View.OnClickListener {
            val intent = Intent(this, AttendanceActivity::class.java).apply {
                putExtra(AttendanceActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(AttendanceActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(AttendanceActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
                putExtra(AttendanceActivity.EXTRA_IS_PARENT, true)
            }
            startActivity(intent)
        }
        binding.tvStatPresent.setOnClickListener(openAttendanceFullScreen)
        binding.tvStatLate.setOnClickListener { showLateAnalyticsDialog() }
        binding.tvStatSick.setOnClickListener(openAttendanceFullScreen)
        binding.tvLatestAttendance.setOnClickListener(openAttendanceFullScreen)
        binding.btnParentLateAnalytics.setOnClickListener {
            showLateAnalyticsDialog()
        }

        // 10. Pembaruan Aplikasi APK Manual
        binding.btnParentAppUpdate.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        // ================== MODERN ICON GRID WIRING ==================
        binding.gridParentTugas.setOnClickListener(openHomeworkFullScreen)
        binding.gridParentCbt.setOnClickListener(openExamsFullScreen)
        binding.gridParentAbsensi.setOnClickListener(openAttendanceFullScreen)
        binding.gridParentSurat.setOnClickListener {
            val intent = Intent(this, ParentLettersActivity::class.java).apply {
                putExtra(ParentLettersActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(ParentLettersActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(ParentLettersActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
            }
            startActivity(intent)
        }
        binding.gridParentIzin.setOnClickListener {
            showSubmitLeaveDialog()
        }
        binding.gridParentUks.setOnClickListener {
            val intent = Intent(this, UksActivity::class.java).apply {
                putExtra(UksActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(UksActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(UksActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
                putExtra(UksActivity.EXTRA_IS_PARENT, true)
            }
            startActivity(intent)
        }
        binding.gridParentBk.setOnClickListener {
            val intent = Intent(this, BkActivity::class.java).apply {
                putExtra(BkActivity.EXTRA_STUDENT_ID, currentStudentId)
                putExtra(BkActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                putExtra(BkActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
                putExtra(BkActivity.EXTRA_IS_PARENT, true)
            }
            startActivity(intent)
        }
        binding.gridParentPanduan.setOnClickListener {
            startActivity(Intent(this, AppGuideActivity::class.java))
        }
        binding.gridParentUpdate.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }
        // Pesan Admin (DIHAPUS TOTAL)
        binding.gridParentHelpdesk.visibility = View.GONE
        binding.gridParentBiodata.setOnClickListener {
            checkAndOpenBiodataForm()
        }
        binding.gridParentPpdb.setOnClickListener {
            checkAndOpenPpdbForm()
        }

        binding.btnCloseParentNotif.setOnClickListener {
            dismissParentNotification()
        }

        // Wiring Modul E-Kantin & Uang Saku Anak (Dinamis Feature Toggle)
        binding.cardParentCanteenOverview.visibility = View.GONE
        binding.btnParentSetLimit.setOnClickListener { showParentSetDailyLimitDialog() }
        binding.btnParentTopUp.setOnClickListener { showParentTopUpDialog() }
        binding.btnParentCanteenAnalytics.setOnClickListener { showParentCanteenAnalyticsDialog() }
        binding.cardParentCanteenOverview.setOnClickListener { showParentCanteenAnalyticsDialog() }
        checkCanteenFeatureStatus()

        // Cek Notifikasi Status Verifikasi Izin Anak saat aplikasi dibuka
        checkParentLeaveVerificationNotifications()
    }

    private val realtimeAttendanceReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
            runOnUiThread {
                loadParentData(currentStudentId)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        try {
            val filter = android.content.IntentFilter("com.school.smartcbt.ATTENDANCE_UPDATED")
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(realtimeAttendanceReceiver, filter, android.content.Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(realtimeAttendanceReceiver, filter)
            }
        } catch (e: Exception) {}

        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
        loadParentData(currentStudentId)
        checkCanteenFeatureStatus()
        loadParentCanteenData()
        checkParentLeaveVerificationNotifications()
        checkParentWarningLetterNotifications()

        pendingTopupOrderId?.let { orderId ->
            startPollingTopupStatus(orderId)
        }
    }

    override fun onPause() {
        super.onPause()
        try {
            unregisterReceiver(realtimeAttendanceReceiver)
        } catch (e: Exception) {}
    }

    private var lastNotifiedLeaveStatusKey: String? = null

    private fun checkParentLeaveVerificationNotifications() {
        val targetChildId = currentStudentId
        ApiClient.getClient(this).getParentLeaveRequests(targetChildId).enqueue(object : Callback<List<ParentLeaveRequestDto>> {
            override fun onResponse(call: Call<List<ParentLeaveRequestDto>>, response: Response<List<ParentLeaveRequestDto>>) {
                if (response.isSuccessful && !response.body().isNullOrEmpty()) {
                    val list = response.body()!!
                    val verifiedItem = list.firstOrNull { it.status == "APPROVED" || it.status == "REJECTED" }
                    if (verifiedItem != null) {
                        val statusKey = "${verifiedItem.id}_${verifiedItem.status}_${verifiedItem.verifiedAt}"
                        val prefs = getSharedPreferences("smartschool_parent_notifs", Context.MODE_PRIVATE)
                        val savedKey = prefs.getString("last_notified_leave_key", null)
                        if (savedKey != statusKey && lastNotifiedLeaveStatusKey != statusKey) {
                            lastNotifiedLeaveStatusKey = statusKey
                            prefs.edit().putString("last_notified_leave_key", statusKey).apply()

                            val childName = verifiedItem.studentName ?: binding.tvChildName.text.toString().ifEmpty { "Ananda" }
                            val isApproved = verifiedItem.status == "APPROVED"
                            val catTitle = if (verifiedItem.category == "SICK" || verifiedItem.category == "SAKIT") "Sakit" else "Izin"

                            val notifTitle = if (isApproved) "✅ Permohonan Izin Disetujui Sekolah" else "❌ Permohonan Izin Ditolak"
                            val notifMsg = if (isApproved) {
                                "Alhamdulillah, permohonan izin $catTitle untuk $childName telah diverifikasi dan DISETUJUI oleh ${verifiedItem.verifiedBy ?: "Wali Kelas / Guru BK"}. Status kehadiran anak otomatis tercatat resmi."
                            } else {
                                "Mohon maaf, permohonan izin $catTitle untuk $childName belum dapat disetujui sekolah. Catatan: ${verifiedItem.rejectionNote ?: "Dokumen surat tidak lengkap"}."
                            }

                            // 1. Tampilkan Heads-Up Notification di Status Bar HP
                            com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                                this@ParentMainActivity,
                                notifTitle,
                                notifMsg,
                                "Perizinan Siswa"
                            )

                            // 2. Tampilkan Dialog Interaktif Langsung ke Orang Tua
                            AlertDialog.Builder(this@ParentMainActivity)
                                .setTitle(notifTitle)
                                .setMessage(notifMsg)
                                .setIcon(if (isApproved) android.R.drawable.ic_dialog_info else android.R.drawable.ic_dialog_alert)
                                .setPositiveButton("Alhamdulillah, Mengerti") { d, _ -> d.dismiss() }
                                .show()
                        }
                    }
                }
            }

            override fun onFailure(call: Call<List<ParentLeaveRequestDto>>, t: Throwable) {}
        })
    }

    private fun checkParentWarningLetterNotifications() {
        val studentId = currentStudentId ?: return
        ApiClient.getClient(this).getBkDisciplineRecords(studentId = studentId).enqueue(object : Callback<com.school.smartcbt.data.model.BkDisciplineListResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.BkDisciplineListResponse>, response: Response<com.school.smartcbt.data.model.BkDisciplineListResponse>) {
                if (response.isSuccessful) {
                    val warnings = response.body()?.studentSummary?.warningLetters ?: emptyList()
                    val unack = warnings.firstOrNull { it.acknowledgedByParent != true }
                    if (unack != null) {
                        AlertDialog.Builder(this@ParentMainActivity)
                            .setTitle("🚨 Surat Peringatan Resmi (${unack.spLevel})")
                            .setMessage("Terdapat ${unack.letterNumber ?: "Surat Peringatan"} dari Guru BK untuk ananda yang memerlukan konfirmasi tanda terima digital.\n\nSilakan buka Buku BK & SP Siswa untuk menandatangani.")
                            .setPositiveButton("Buka Buku BK & SP") { _, _ ->
                                val intent = Intent(this@ParentMainActivity, BkActivity::class.java).apply {
                                    putExtra(BkActivity.EXTRA_STUDENT_ID, currentStudentId)
                                    putExtra(BkActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                                    putExtra(BkActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
                                    putExtra(BkActivity.EXTRA_IS_PARENT, true)
                                }
                                startActivity(intent)
                            }
                            .setNegativeButton("Nanti", null)
                            .show()
                    }
                }
            }
            override fun onFailure(call: Call<com.school.smartcbt.data.model.BkDisciplineListResponse>, t: Throwable) {}
        })
    }

    private fun showContactAdminDialog() {
        val dialogBinding = com.school.smartcbt.databinding.DialogContactAdminBinding.inflate(layoutInflater)
        dialogBinding.tvDialogAdminTitle.text = "Layanan Pengaduan & Bantuan Orang Tua"
        dialogBinding.tvDialogAdminSub.text = "Sampaikan pertanyaan, kendala absensi anak, izin, atau teknis ke Admin Sekolah."

        val categories = arrayOf(
            "🕒 Presensi / Notifikasi Kehadiran Anak",
            "🤒 Izin / Sakit Belum Terverifikasi",
            "📜 Surat Resmi Sekolah / Undangan Rapat",
            "📝 Tugas & Hasil Ujian Anak",
            "⚙️ Kendala Teknis / Akun Orang Tua",
            "💡 Lainnya / Bantuan Sekolah"
        )
        val adapter = android.widget.ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, categories)
        dialogBinding.spinnerDialogAdminCategory.adapter = adapter

        AlertDialog.Builder(this)
            .setView(dialogBinding.root)
            .setPositiveButton("Kirim Pesan") { _, _ ->
                val desc = dialogBinding.etDialogAdminDescription.text.toString().trim()
                if (desc.isEmpty()) {
                    Toast.makeText(this, "Deskripsi pesan tidak boleh kosong", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val selectedCategory = categories[dialogBinding.spinnerDialogAdminCategory.selectedItemPosition]
                val requestMap = mapOf(
                    "category" to selectedCategory,
                    "title" to "Pesan dari Orang Tua: " + sessionManager.getName(),
                    "description" to desc,
                    "deviceInfo" to "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} (Android ${android.os.Build.VERSION.RELEASE})"
                )

                Toast.makeText(this, "Mengirim pesan ke Admin...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).submitHelpdeskReport(requestMap).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            AlertDialog.Builder(this@ParentMainActivity)
                                .setTitle("✅ Pesan Terkirim")
                                .setMessage("Pesan Anda telah diterima oleh Admin Sekolah. Kami akan menindaklanjuti segera.")
                                .setPositiveButton("OK", null)
                                .show()
                        } else {
                            Toast.makeText(this@ParentMainActivity, "Gagal mengirim pesan", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@ParentMainActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
    }

    private fun handleImageUri(uri: Uri) {
        try {
            val inputStream = contentResolver.openInputStream(uri)
            val bitmap = BitmapFactory.decodeStream(inputStream)
            inputStream?.close()
            if (bitmap != null) {
                handleBitmap(bitmap)
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal membaca berkas foto: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleBitmap(bitmap: Bitmap) {
        try {
            // Auto kompresi cerdas ke ~200 KB agar hemat storage server & Google Drive namun tetap tajam
            val targetMaxBytes = 200 * 1024 // 200 KB
            val maxDim = 1280
            var workingBitmap = if (bitmap.width > maxDim || bitmap.height > maxDim) {
                val ratio = maxDim.toFloat() / Math.max(bitmap.width, bitmap.height)
                Bitmap.createScaledBitmap(bitmap, (bitmap.width * ratio).toInt(), (bitmap.height * ratio).toInt(), true)
            } else {
                bitmap
            }

            var quality = 80
            var baos = ByteArrayOutputStream()
            workingBitmap.compress(Bitmap.CompressFormat.JPEG, quality, baos)
            var bytes = baos.toByteArray()

            // Iterasi turunkan kualitas secara bertahap jika melebihi 200 KB
            while (bytes.size > targetMaxBytes && quality > 35) {
                quality -= 10
                baos = ByteArrayOutputStream()
                workingBitmap.compress(Bitmap.CompressFormat.JPEG, quality, baos)
                bytes = baos.toByteArray()
            }

            // Jika kualitas sudah 35 tapi masih > 200 KB, sedikit scale down dan kompres 65%
            if (bytes.size > targetMaxBytes) {
                val scaleRatio = 0.8f
                val newW = (workingBitmap.width * scaleRatio).toInt()
                val newH = (workingBitmap.height * scaleRatio).toInt()
                workingBitmap = Bitmap.createScaledBitmap(workingBitmap, newW, newH, true)
                baos = ByteArrayOutputStream()
                workingBitmap.compress(Bitmap.CompressFormat.JPEG, 65, baos)
                bytes = baos.toByteArray()
            }

            attachedPhotoBase64 = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)

            val sizeKb = (bytes.size / 1024).coerceAtLeast(1)
            ivPhotoPreview?.visibility = View.VISIBLE
            ivPhotoPreview?.setImageBitmap(workingBitmap)
            tvPhotoStatus?.text = "✅ Foto Surat Berhasil Dilampirkan & Dikompresi (${sizeKb} KB)"
            tvPhotoStatus?.setTextColor(Color.parseColor("#059669"))
            Toast.makeText(this, "Foto surat berhasil dikompresi otomatis (${sizeKb} KB) & siap dikirim!", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal memproses foto: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showDatePicker(target: EditText) {
        val cal = Calendar.getInstance()
        val dp = DatePickerDialog(this, { _, year, month, dayOfMonth ->
            val formatted = String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, dayOfMonth)
            target.setText(formatted)
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH))
        dp.show()
    }

    private fun Int.dpToPx(): Int = (this * resources.displayMetrics.density).toInt()

    private fun loadParentData(childId: String? = null) {
        // 1. Ambil seluruh anak terkait akun orang tua
        ApiClient.getClient(this).getParentChildren().enqueue(object : Callback<com.school.smartcbt.data.model.ParentChildrenResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.ParentChildrenResponse>, response: Response<com.school.smartcbt.data.model.ParentChildrenResponse>) {
                val list = response.body()?.children
                if (!list.isNullOrEmpty()) {
                    availableChildren = list
                    if (availableChildren.size > 1) {
                        binding.btnSwitchChild.visibility = View.VISIBLE
                        binding.btnSwitchChild.text = "🔄 Ganti Anak (${availableChildren.size})"
                    } else {
                        binding.btnSwitchChild.visibility = View.GONE
                    }
                }
            }
            override fun onFailure(call: Call<com.school.smartcbt.data.model.ParentChildrenResponse>, t: Throwable) {}
        })

        // 2. Ambil detail anak yang sedang aktif
        val cacheKey = "cache_parent_dash_" + (childId ?: sessionManager.getUsername())
        val cachePrefs = getSharedPreferences("smartschool_offline_cache", Context.MODE_PRIVATE)
        var hasCached = false

        val cachedJson = cachePrefs.getString(cacheKey, null)
        if (!cachedJson.isNullOrEmpty()) {
            try {
                val cachedData = Gson().fromJson(cachedJson, ParentDashboardDto::class.java)
                if (cachedData != null) {
                    hasCached = true
                    renderDashboardData(cachedData)
                }
            } catch (e: Exception) {}
        }

        ApiClient.getClient(this).getParentDashboard(childId).enqueue(object : Callback<ParentDashboardDto> {
            override fun onResponse(call: Call<ParentDashboardDto>, response: Response<ParentDashboardDto>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    renderDashboardData(data)
                    try {
                        cachePrefs.edit().putString(cacheKey, Gson().toJson(data)).apply()
                    } catch (e: Exception) {}
                }
            }

            override fun onFailure(call: Call<ParentDashboardDto>, t: Throwable) {
                if (!hasCached) {
                    Toast.makeText(this@ParentMainActivity, "Gagal memuat data orang tua: " + t.message, Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun renderDashboardData(data: ParentDashboardDto) {
        val child = data.child

        if (child != null) {
            currentStudentId = child.id
            checkParentLeaveVerificationNotifications()
            checkParentWarningLetterNotifications()
            val cleanMother = if (!child.motherName.isNullOrBlank() && !child.motherName.equals("Ibu Siswa", ignoreCase = true)) {
                child.motherName.trim()
            } else {
                val uName = sessionManager.getName()
                if (uName.startsWith("Ibu ", ignoreCase = true)) {
                    uName.substring(4).trim()
                } else if (uName.startsWith("Orang Tua / Wali ", ignoreCase = true)) {
                    ""
                } else {
                    uName.trim()
                }
            }

            val parentDisplayName = if (cleanMother.isNotBlank()) {
                "Ibu $cleanMother"
            } else {
                "Ibu (Wali ${child.name})"
            }

            binding.tvParentWelcome.text = "Selamat Datang, $parentDisplayName! 👋"
            binding.tvParentSub.text = "Orang tua / wali dari ${child.name} (Kelas ${child.className ?: "VII-A"})"

            if (!child.className.isNullOrBlank()) {
                sessionManager.saveClassName(child.className)
            }
            binding.tvChildName.text = child.name
            binding.tvChildClass.text = "Kelas " + (child.className ?: "VII-A") + " • NISN: " + (child.nisn ?: child.username)
            binding.tvBloodType.text = "🩸 Gol. Darah: " + (child.bloodType ?: "O (Rh+)") + " [Lihat UKS]"
            binding.tvPoints.text = "🎖️ " + (child.points ?: 100) + " Poin (Disiplin Baik)"
        }

        if (data.stats != null) {
            binding.tvStatPresent.text = data.stats.present.toString()
            binding.tvStatLate.text = data.stats.late.toString()
            binding.tvStatSick.text = data.stats.sick.toString()
        }

        val attList = data.attendances ?: emptyList()
        if (attList.isNotEmpty()) {
            val latest = attList[0]
            binding.tvLatestAttendance.text = "Status: " + latest.status + " • " + latest.type
            binding.tvLatestAttendanceTime.text = latest.scanTime
        }

        // 1. Tampilkan Presensi Hari Ini (Datang & Pulang)
        val today = data.todayAttendance
        if (today != null) {
            binding.tvParentTodayGateIn.text = today.gateInTime ?: "--:-- WIB"
            binding.tvParentTodayGateOut.text = today.gateOutTime ?: "--:-- WIB"
            val st = (today.status ?: "HADIR").uppercase()
            binding.tvTodayStatusBadge.text = st
            if (st.contains("LIBUR") || st.contains("MINGGU")) {
                binding.tvTodayStatusBadge.setBackgroundColor(Color.parseColor("#F1F5F9"))
                binding.tvTodayStatusBadge.setTextColor(Color.parseColor("#475569"))
                binding.tvParentTodayGateInNote.text = "Hari Libur Akhir Pekan (Minggu)"
                binding.tvParentTodayGateInNote.setTextColor(Color.parseColor("#64748B"))
            } else if (today.isLate == true || st.contains("TERLAMBAT")) {
                binding.tvTodayStatusBadge.setBackgroundColor(Color.parseColor("#FEF3C7"))
                binding.tvTodayStatusBadge.setTextColor(Color.parseColor("#B45309"))
                binding.tvParentTodayGateInNote.text = "Terlambat Hadir (Pintu Kelas)"
                binding.tvParentTodayGateInNote.setTextColor(Color.parseColor("#B45309"))
            } else if (st.contains("ALPA") || st.contains("ABSENT")) {
                binding.tvTodayStatusBadge.setBackgroundColor(Color.parseColor("#FEE2E2"))
                binding.tvTodayStatusBadge.setTextColor(Color.parseColor("#B91C1C"))
                binding.tvParentTodayGateInNote.text = "Tidak Hadir / Belum Presensi"
                binding.tvParentTodayGateInNote.setTextColor(Color.parseColor("#B91C1C"))
            } else {
                binding.tvTodayStatusBadge.setBackgroundColor(Color.parseColor("#D1FAE5"))
                binding.tvTodayStatusBadge.setTextColor(Color.parseColor("#065F46"))
                binding.tvParentTodayGateInNote.text = "Hadir Tepat Waktu (Gate Barcode)"
                binding.tvParentTodayGateInNote.setTextColor(Color.parseColor("#15803D"))
            }

            if (!today.gateOutTime.isNullOrEmpty() && today.gateOutTime != "--:-- WIB") {
                binding.tvParentTodayGateOutNote.text = "Telah Scan Kepulangan"
                binding.tvParentTodayGateOutNote.setTextColor(Color.parseColor("#1D4ED8"))
            } else {
                binding.tvParentTodayGateOutNote.text = "Belum scan kepulangan"
                binding.tvParentTodayGateOutNote.setTextColor(Color.parseColor("#64748B"))
            }
        }

        // 2. Tampilkan Notifikasi Otomatis Ke Orang Tua (Cek status dismissal & tanggal agar tidak muncul berulang kali)
        val prefs = getSharedPreferences("smartschool_parent_notifs", Context.MODE_PRIVATE)
        val notifs = data.parentNotifications
        val dismissedSet = HashSet(prefs.getStringSet("dismissed_parent_notif_ids", emptySet()) ?: emptySet())
        val todayDateStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        val childId = data.child?.id ?: currentStudentId ?: "child"
        val isUksDismissedToday = prefs.getBoolean("uks_pickup_dismissed_${todayDateStr}_$childId", false)
        
        // Cari notifikasi aktif yang belum pernah di-dismiss dan belum dibaca
        val activeNotif = notifs?.firstOrNull { n ->
            val idStr = n.id ?: (n.title.orEmpty() + "_" + n.createdAt.orEmpty())
            val key = "notif_${idStr}"
            val isPickup = (n.title?.contains("jemput", ignoreCase = true) == true) ||
                           (n.message?.contains("jemput", ignoreCase = true) == true) ||
                           (n.category == "UKS_PICKUP")
            if (isPickup && isUksDismissedToday) {
                false
            } else {
                !dismissedSet.contains(idStr) && !prefs.getBoolean(key, false) && n.isRead != true
            }
        }

        if (activeNotif != null) {
            val notifId = activeNotif.id ?: (activeNotif.title.orEmpty() + "_" + activeNotif.createdAt.orEmpty())
            val notifKey = "notif_${notifId}"
            currentParentNotifKey = notifKey
            currentParentNotifId = activeNotif.id

            binding.cardParentNotificationAlert.visibility = View.VISIBLE
            binding.tvParentNotifTitle.text = activeNotif.title ?: "Pemberitahuan Presensi"
            binding.tvParentNotifMessage.text = activeNotif.message ?: ""
            binding.tvParentNotifTime.text = activeNotif.createdAt?.substring(0, 10) ?: "Hari Ini"

            // Cek apakah tanggal notifikasi adalah hari ini (bukan riwayat hari kemarin)
            val notifDateStr = activeNotif.createdAt?.substring(0, 10) ?: todayDateStr
            val isFromToday = notifDateStr.startsWith(todayDateStr)

            val isUksPickup = (activeNotif.title?.contains("jemput", ignoreCase = true) == true) ||
                              (activeNotif.message?.contains("jemput", ignoreCase = true) == true) ||
                              (activeNotif.category == "UKS_PICKUP")

            // JIKA NOTIFIKASI ADALAH PENJEMPUTAN UKS:
            // HANYA TAMPILKAN SEKALI SAJA UNTUK HARI INI DAN JIKA BELUM PERNAH DITUTUP
            val hasShownPopup = prefs.getBoolean("popup_shown_${notifKey}", false)
            if (isUksPickup && isFromToday && !hasShownPopup && !isUksDismissedToday) {
                prefs.edit().putBoolean("popup_shown_${notifKey}", true).commit()

                val childName = data.child?.name ?: "Ananda"
                val childClass = data.child?.className ?: "-"

                // Tampilkan notifikasi Heads-Up seperti WhatsApp (suara, getar & banner mengambang)
                com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                    context = this,
                    title = "🚨 " + (activeNotif.title ?: "SISWA MEMBUTUHKAN PENJEMPUTAN"),
                    message = activeNotif.message ?: "Ananda $childName memerlukan penjemputan dari sekolah oleh orang tua/wali dikarenakan kondisi medis di UKS.",
                    subText = "UKS SMP Negeri 1 Boyolangu"
                )

                com.school.smartcbt.utils.DialogHelper.showFullScreenNotificationDialog(
                    context = this,
                    theme = com.school.smartcbt.utils.DialogHelper.HeaderTheme.CRITICAL,
                    badgeText = "UKS NOTIFIKASI PENTING",
                    title = "SISWA MEMBUTUHKAN PENJEMPUTAN",
                    studentName = childName,
                    className = childClass,
                    timeInfo = java.text.SimpleDateFormat("HH.mm 'WIB'", java.util.Locale.getDefault()).format(java.util.Date()),
                    message = activeNotif.message ?: "Ananda memerlukan penjemputan dari sekolah oleh orang tua/wali dikarenakan kondisi medis.",
                    actionText = "LIHAT DETAIL KESEHATAN",
                    onAction = {
                        markParentNotificationPermanentlyDismissed(notifId, activeNotif.id)
                        showChildHealthHistoryDialog()
                    },
                    onDismiss = {
                        markParentNotificationPermanentlyDismissed(notifId, activeNotif.id)
                    }
                )
            }
        } else {
            // Default status info banner - jika sudah pernah ditutup, jangan tampilkan lagi
            val isDefaultDismissed = prefs.getBoolean("default_parent_notif_dismissed", false) || dismissedSet.contains("default_parent_notif_dismissed")
            if (!isDefaultDismissed) {
                currentParentNotifKey = "default_parent_notif_dismissed"
                currentParentNotifId = null
                binding.cardParentNotificationAlert.visibility = View.VISIBLE
                binding.tvParentNotifTitle.text = "✅ Status Presensi Aktif"
                binding.tvParentNotifMessage.text = "Notifikasi real-time aktif: Orang tua akan menerima alert instan setiap ananda scan masuk atau pulang."
                binding.tvParentNotifTime.text = "Aktif"
            } else {
                binding.cardParentNotificationAlert.visibility = View.GONE
            }
        }

        // 2b. Tampilkan Evaluasi & Statistik Keterlambatan Ananda
        val lateData = data.lateAnalytics
        cachedLateAnalytics = lateData
        if (lateData != null) {
            val count = lateData.totalLate ?: 0
            val risk = lateData.lateRiskLevel ?: "TERKENDALI"
            val points = lateData.totalDisciplinePoints ?: 0
            if (count > 0) {
                binding.btnParentLateAnalytics.setBackgroundColor(Color.parseColor("#FEF2F2"))
                binding.tvParentLateSummaryBadge.setTextColor(Color.parseColor("#B91C1C"))
                binding.tvParentLateSummaryBadge.text = "⚠️ Evaluasi Keterlambatan: ${count}x Terlambat ($risk • ${points} Poin)"
            } else {
                binding.btnParentLateAnalytics.setBackgroundColor(Color.parseColor("#F0FDF4"))
                binding.tvParentLateSummaryBadge.setTextColor(Color.parseColor("#15803D"))
                binding.tvParentLateSummaryBadge.text = "✅ Evaluasi Keterlambatan: 0x Terlambat (Kedisiplinan Prima)"
            }
        }

        // 3. Render Jadwal Tugas & PR Anak
        cachedHomeworkList = data.homeworkSchedule
        renderHomeworkSchedule(data.homeworkSchedule)

        // Muat & Cek Surat Resmi Baru untuk Notifikasi Banner
        checkNewOfficialLetters()
    }

    private var currentParentNotifKey: String? = null
    private var currentParentNotifId: String? = null

    private fun markParentNotificationPermanentlyDismissed(notifKeyId: String, backendId: String?) {
        binding.cardParentNotificationAlert.visibility = View.GONE
        val prefs = getSharedPreferences("smartschool_parent_notifs", Context.MODE_PRIVATE)
        val newSet = HashSet(prefs.getStringSet("dismissed_parent_notif_ids", emptySet()) ?: emptySet())
        newSet.add(notifKeyId)
        backendId?.let { newSet.add(it) }

        val todayDateStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        val childId = currentStudentId ?: "child"

        prefs.edit()
            .putStringSet("dismissed_parent_notif_ids", newSet)
            .putBoolean("notif_$notifKeyId", true)
            .putBoolean(notifKeyId, true)
            .putBoolean("popup_shown_notif_$notifKeyId", true)
            .putBoolean("uks_pickup_dismissed_${todayDateStr}_$childId", true)
            .commit()

        // Sync read status to backend if notification ID is available
        backendId?.let { id ->
            try {
                ApiClient.getClient(this).markNotificationAsRead(id).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {}
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {}
                })
            } catch (e: Exception) {}
        }
    }

    private fun dismissParentNotification() {
        binding.cardParentNotificationAlert.visibility = View.GONE
        currentParentNotifKey?.let { key ->
            val idOnly = key.removePrefix("notif_")
            markParentNotificationPermanentlyDismissed(idOnly, currentParentNotifId)
        }
        Toast.makeText(this, "Notifikasi telah ditutup", Toast.LENGTH_SHORT).show()
    }

    private fun renderHomeworkSchedule(list: List<ParentHomeworkItemDto>?) {
        binding.containerParentHomeworks.removeAllViews()
        val items = list ?: emptyList()
        binding.tvHomeworkCountBadge.text = "${items.size} Tugas"

        if (items.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "✅ Belum ada tugas atau PR baru untuk kelas ananda."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(0, 8, 0, 8)
            }
            binding.containerParentHomeworks.addView(tvEmpty)
            return
        }

        for (hw in items) {
            val card = CardView(this).apply {
                radius = 12f
                cardElevation = 1f
                setCardBackgroundColor(if (hw.isSubmitted == true) Color.parseColor("#F0FDF4") else Color.parseColor("#F8FAFC"))
                useCompatPadding = true
            }

            val layout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(14, 12, 14, 12)
            }

            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val tvSubj = TextView(this).apply {
                text = hw.subject ?: "Mata Pelajaran"
                setTextColor(Color.parseColor("#4F46E5"))
                textSize = 11f
                setTypeface(null, android.graphics.Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val tvStatus = TextView(this).apply {
                text = if (hw.isSubmitted == true) "✅ Sudah Dikumpulkan" else "⏳ Belum Kumpul"
                setTextColor(if (hw.isSubmitted == true) Color.parseColor("#15803D") else Color.parseColor("#B45309"))
                textSize = 10f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setBackgroundColor(if (hw.isSubmitted == true) Color.parseColor("#DCFCE7") else Color.parseColor("#FEF3C7"))
                setPadding(8, 3, 8, 3)
            }

            topRow.addView(tvSubj)
            topRow.addView(tvStatus)

            val tvTitle = TextView(this).apply {
                text = hw.title ?: "Tugas"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setPadding(0, 4, 0, 2)
            }

            val tvDeadline = TextView(this).apply {
                text = "⏰ Batas Waktu: ${hw.deadline ?: "-"}"
                setTextColor(Color.parseColor("#DC2626"))
                textSize = 11f
                setTypeface(null, android.graphics.Typeface.BOLD)
            }

            layout.addView(topRow)
            layout.addView(tvTitle)
            layout.addView(tvDeadline)
            card.addView(layout)

            binding.containerParentHomeworks.addView(card)
        }
    }

    private var cachedLateAnalytics: LateAnalyticsDto? = null

    private fun showLateAnalyticsDialog() {
        val lateData = cachedLateAnalytics
        val childName = binding.tvChildName.text.toString().ifEmpty { "Ananda" }
        val childClass = binding.tvChildClass.text.toString().ifEmpty { "Kelas Siswa" }

        val dialog = AlertDialog.Builder(this).create()
        val scroll = android.widget.ScrollView(this)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 32, 36, 32)
        }

        // Header Title
        val tvTitle = TextView(this).apply {
            text = "⚠️ Evaluasi & Statistik Keterlambatan"
            textSize = 17f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
        }

        val tvSub = TextView(this).apply {
            text = "$childName • $childClass\nBatas Masuk Gerbang Sekolah: ${lateData?.gateCutoffTime ?: "07:15 WIB"}"
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 4, 0, 14)
        }

        container.addView(tvTitle)
        container.addView(tvSub)

        // Status Card Banner
        val riskColor = try { Color.parseColor(lateData?.lateRiskColor ?: "#10B981") } catch (e: Exception) { Color.parseColor("#10B981") }
        val bannerCard = CardView(this).apply {
            radius = 12f
            cardElevation = 1f
            setCardBackgroundColor(Color.parseColor("#F8FAFC"))
            useCompatPadding = true
        }
        val bannerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 16, 20, 16)
        }
        val tvRisk = TextView(this).apply {
            text = "STATUS KEDISIPLINAN: ${lateData?.lateRiskLevel ?: "TERKENDALI / DISIPLIN BAIK"}"
            textSize = 12f
            setTextColor(riskColor)
            setTypeface(null, Typeface.BOLD)
        }
        bannerLayout.addView(tvRisk)
        bannerCard.addView(bannerLayout)
        container.addView(bannerCard)

        // 4 KPI Cards (2x2 Grid)
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 10
            }
            weightSum = 2f
        }

        fun createKpiCard(title: String, value: String, sub: String, bgColor: String, textColor: String): CardView {
            val card = CardView(this).apply {
                radius = 10f
                cardElevation = 1f
                setCardBackgroundColor(Color.parseColor(bgColor))
                useCompatPadding = true
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val lay = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(14, 12, 14, 12)
            }
            val tTitle = TextView(this).apply {
                text = title
                textSize = 9.5f
                setTextColor(Color.parseColor(textColor))
                setTypeface(null, Typeface.BOLD)
            }
            val tVal = TextView(this).apply {
                text = value
                textSize = 16f
                setTextColor(Color.parseColor(textColor))
                setTypeface(null, Typeface.BOLD)
                setPadding(0, 2, 0, 1)
            }
            val tSub = TextView(this).apply {
                text = sub
                textSize = 9.5f
                setTextColor(Color.parseColor(textColor))
            }
            lay.addView(tTitle)
            lay.addView(tVal)
            lay.addView(tSub)
            card.addView(lay)
            return card
        }

        val totalLate = lateData?.totalLate ?: 0
        val avgLateMin = lateData?.averageLateMinutes ?: 0
        val mostDay = lateData?.mostFrequentLateDay ?: "Belum Ada"
        val discPoints = lateData?.totalDisciplinePoints ?: 0

        row1.addView(createKpiCard("TOTAL TERLAMBAT", "${totalLate}x", "Bulan Berjalan", "#FEF2F2", "#B91C1C"))
        row1.addView(createKpiCard("RATA-RATA TERLAMBAT", "+${avgLateMin} Mnt", "Lewat dari 07:15", "#FFFBEB", "#B45309"))
        container.addView(row1)

        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 6
            }
            weightSum = 2f
        }
        row2.addView(createKpiCard("HARI SERING TERLAMBAT", mostDay, "Pola Kehadiran", "#EFF6FF", "#1D4ED8"))
        row2.addView(createKpiCard("POIN PELANGGARAN", "${discPoints} Poin", "5 Poin/Keterlambatan", "#FAF5FF", "#7E22CE"))
        container.addView(row2)

        // Rata-rata Jam Tiba & Rekomendasi
        val recHeader = TextView(this).apply {
            text = "💡 Rekomendasi & Jam Keberangkatan"
            textSize = 13f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 16, 0, 6)
        }
        container.addView(recHeader)

        val recCard = CardView(this).apply {
            radius = 10f
            cardElevation = 1f
            setCardBackgroundColor(Color.parseColor("#F8FAFC"))
            useCompatPadding = true
        }
        val recLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 12, 16, 12)
        }

        val avgArrival = lateData?.averageArrivalTime ?: "--:-- WIB"
        val tvAvgArr = TextView(this).apply {
            text = "⏱️ Rata-rata Jam Tiba Ananda: $avgArrival"
            textSize = 11.5f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 8)
        }
        recLayout.addView(tvAvgArr)

        val recs = lateData?.recommendations ?: emptyList()
        if (recs.isEmpty()) {
            val tvRec = TextView(this).apply {
                text = "• Pertahankan kedisiplinan dan jam tidur teratur ananda."
                textSize = 11f
                setTextColor(Color.parseColor("#334155"))
            }
            recLayout.addView(tvRec)
        } else {
            for (r in recs) {
                val tvRec = TextView(this).apply {
                    text = "• $r"
                    textSize = 11f
                    setTextColor(Color.parseColor("#334155"))
                    setPadding(0, 2, 0, 2)
                }
                recLayout.addView(tvRec)
            }
        }
        recCard.addView(recLayout)
        container.addView(recCard)

        // Riwayat Keterlambatan
        val histHeader = TextView(this).apply {
            text = "📋 Riwayat Tanggal Keterlambatan"
            textSize = 13f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 16, 0, 6)
        }
        container.addView(histHeader)

        val historyList = lateData?.lateHistory ?: emptyList()
        if (historyList.isEmpty()) {
            val tvEmptyHist = TextView(this).apply {
                text = "✅ Alhamdulillah, ananda tidak memiliki catatan keterlambatan bulan ini. Kedisiplinan sangat baik!"
                textSize = 11.5f
                setTextColor(Color.parseColor("#15803D"))
                setPadding(8, 6, 8, 12)
            }
            container.addView(tvEmptyHist)
        } else {
            for (h in historyList) {
                val hCard = CardView(this).apply {
                    radius = 8f
                    cardElevation = 1f
                    setCardBackgroundColor(Color.WHITE)
                    useCompatPadding = true
                }
                val hLay = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(14, 10, 14, 10)
                }
                val hTop = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                }
                val tvHDate = TextView(this).apply {
                    text = "${h.dayName ?: "Hari"}, ${h.dateFormatted ?: "-"}"
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#0F172A"))
                    setTypeface(null, Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                val tvHTime = TextView(this).apply {
                    text = "Scan: ${h.scanTime ?: "-"}"
                    textSize = 11f
                    setTextColor(Color.parseColor("#DC2626"))
                    setTypeface(null, Typeface.BOLD)
                }
                hTop.addView(tvHDate)
                hTop.addView(tvHTime)
                hLay.addView(hTop)

                val tvHNote = TextView(this).apply {
                    text = "Terlambat +${h.minutesLate ?: 0} menit • Sanksi: +${h.points ?: 5} poin BK (${h.note ?: "Terlambat"})"
                    textSize = 10.5f
                    setTextColor(Color.parseColor("#64748B"))
                    setPadding(0, 2, 0, 0)
                }
                hLay.addView(tvHNote)
                hCard.addView(hLay)
                container.addView(hCard)
            }
        }

        // Close button
        val btnClose = Button(this).apply {
            text = "Tutup Evaluasi"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            setOnClickListener { dialog.dismiss() }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 20
            }
        }
        container.addView(btnClose)

        scroll.addView(container)
        dialog.setView(scroll)
        dialog.show()
    }

    private var cachedHomeworkList: List<ParentHomeworkItemDto>? = null

    private fun showHomeworkListDialog() {
        val dialog = AlertDialog.Builder(this).create()
        val scroll = android.widget.ScrollView(this)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 32, 36, 32)
        }

        val tvTitle = TextView(this).apply {
            text = "📚 Jadwal & Tugas Ananda"
            textSize = 18f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, android.graphics.Typeface.BOLD)
        }

        val tvSub = TextView(this).apply {
            text = "Monitoring pekerjaan rumah dan tugas yang diberikan oleh dewan guru."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 4, 0, 14)
        }

        container.addView(tvTitle)
        container.addView(tvSub)

        val rawItems = cachedHomeworkList ?: emptyList()

        // Tab Selector
        val tabContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = android.graphics.drawable.ColorDrawable(Color.parseColor("#F1F5F9"))
            setPadding(8, 8, 8, 8)
        }

        val btnTabAll = Button(this).apply {
            text = "Semua (${rawItems.size})"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val pendingCount = rawItems.count { it.isSubmitted != true }
        val btnTabPending = Button(this).apply {
            text = "⚠️ Perlu (${pendingCount})"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f)
        }

        val submittedCount = rawItems.count { it.isSubmitted == true }
        val btnTabDone = Button(this).apply {
            text = "✅ Selesai (${submittedCount})"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f)
        }

        tabContainer.addView(btnTabAll)
        tabContainer.addView(btnTabPending)
        tabContainer.addView(btnTabDone)
        container.addView(tabContainer)

        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 16, 0, 0)
        }
        container.addView(listContainer)

        var selectedTab = 0 // 0: Semua, 1: Pending, 2: Done

        fun renderCards() {
            listContainer.removeAllViews()

            val filtered = when (selectedTab) {
                1 -> rawItems.filter { it.isSubmitted != true }
                2 -> rawItems.filter { it.isSubmitted == true }
                else -> rawItems
            }

            if (filtered.isEmpty()) {
                val tvEmpty = TextView(this).apply {
                    text = if (selectedTab == 1) "🎉 Hebat! Tidak ada tugas yang tertunda. Semua tugas ananda telah selesai." else "Tidak ada tugas pada kategori ini."
                    textSize = 13f
                    setTextColor(Color.parseColor("#15803D"))
                    setPadding(0, 20, 0, 20)
                    gravity = Gravity.CENTER
                }
                listContainer.addView(tvEmpty)
            } else {
                for (hw in filtered) {
                    val isDone = hw.isSubmitted == true
                    val card = CardView(this).apply {
                        radius = 14f
                        cardElevation = 2.5f
                        setCardBackgroundColor(if (isDone) Color.parseColor("#F8FAFC") else Color.parseColor("#FFFBEB"))
                        useCompatPadding = true
                    }

                    val layout = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(20, 16, 20, 16)
                    }

                    // Top Row: Subject pill + Deadline badge
                    val rowTop = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                    }

                    val subj = TextView(this).apply {
                        text = "📚 ${hw.subject ?: "Mata Pelajaran"}"
                        setTextColor(Color.parseColor("#1D4ED8"))
                        textSize = 11f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    }
                    rowTop.addView(subj)

                    // BADGE DEADLINE
                    val tvDeadlineBadge = TextView(this).apply {
                        if (isDone) {
                            text = "✅ SELESAI DIKUMPULKAN"
                            setTextColor(Color.parseColor("#166534"))
                            setBackgroundColor(Color.parseColor("#DCFCE7"))
                        } else {
                            val dl = hw.deadline ?: ""
                            val isUrgent = dl.contains("Hari Ini", true) || dl.contains("Besok", true)
                            if (isUrgent) {
                                text = "🚨 DEADLINE HARI INI"
                                setTextColor(Color.parseColor("#991B1B"))
                                setBackgroundColor(Color.parseColor("#FEE2E2"))
                            } else {
                                text = "⏳ TENGGAT: $dl"
                                setTextColor(Color.parseColor("#92400E"))
                                setBackgroundColor(Color.parseColor("#FEF3C7"))
                            }
                        }
                        textSize = 9.5f
                        setTypeface(null, Typeface.BOLD)
                        setPadding(16, 6, 16, 6)
                    }
                    rowTop.addView(tvDeadlineBadge)
                    layout.addView(rowTop)

                    val title = TextView(this).apply {
                        text = hw.title ?: "Judul Tugas"
                        setTextColor(Color.parseColor("#0F172A"))
                        textSize = 14f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setPadding(0, 8, 0, 4)
                    }
                    layout.addView(title)

                    val statusDesc = TextView(this).apply {
                        text = if (isDone) "Status: Jawaban sudah terkirim ke guru." else "Status: Belum diserahkan. Mohon ingatkan ananda agar mengerjakan sebelum tenggat."
                        setTextColor(if (isDone) Color.parseColor("#059669") else Color.parseColor("#DC2626"))
                        textSize = 11f
                        setPadding(0, 2, 0, 0)
                    }
                    layout.addView(statusDesc)

                    card.addView(layout)
                    listContainer.addView(card)
                }
            }
        }

        fun updateTabs() {
            val activeColor = Color.parseColor("#059669")
            val inactiveColor = Color.TRANSPARENT
            btnTabAll.setBackgroundColor(if (selectedTab == 0) activeColor else inactiveColor)
            btnTabAll.setTextColor(if (selectedTab == 0) Color.WHITE else Color.parseColor("#64748B"))

            btnTabPending.setBackgroundColor(if (selectedTab == 1) activeColor else inactiveColor)
            btnTabPending.setTextColor(if (selectedTab == 1) Color.WHITE else Color.parseColor("#64748B"))

            btnTabDone.setBackgroundColor(if (selectedTab == 2) activeColor else inactiveColor)
            btnTabDone.setTextColor(if (selectedTab == 2) Color.WHITE else Color.parseColor("#64748B"))

            renderCards()
        }

        btnTabAll.setOnClickListener { selectedTab = 0; updateTabs() }
        btnTabPending.setOnClickListener { selectedTab = 1; updateTabs() }
        btnTabDone.setOnClickListener { selectedTab = 2; updateTabs() }

        renderCards()

        val btnClose = Button(this).apply {
            text = "Tutup"
            setBackgroundColor(Color.parseColor("#0F172A"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 24
            }
            setOnClickListener { dialog.dismiss() }
        }
        container.addView(btnClose)

        scroll.addView(container)
        dialog.setView(scroll)
        dialog.show()
    }

    private fun showSwitchChildDialog() {
        if (availableChildren.isEmpty()) {
            Toast.makeText(this, "Tidak ada data anak lain yang terhubung dengan akun ini.", Toast.LENGTH_SHORT).show()
            return
        }

        val childNames = availableChildren.map { 
            val mark = if (it.id == currentStudentId) "✓ " else "  "
            "$mark${it.name} (Kelas ${it.className ?: "-"})"
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle("👨‍👩‍👧‍👦 Pilih Profil Anak / Siswa")
            .setItems(childNames) { _, which ->
                val selected = availableChildren[which]
                currentStudentId = selected.id
                Toast.makeText(this, "Beralih ke profil: ${selected.name}", Toast.LENGTH_SHORT).show()
                loadParentData(selected.id)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showSubmitLeaveDialog() {
        attachedPhotoBase64 = null

        val dialog = Dialog(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Top App Bar
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0D5C3A"))
            gravity = Gravity.CENTER_VERTICAL
            setPadding(24, 24, 24, 24)
            elevation = 6f
        }

        val btnClose = ImageButton(this).apply {
            layoutParams = LinearLayout.LayoutParams(48.dpToPx(), 48.dpToPx())
            background = ColorDrawable(Color.TRANSPARENT)
            setImageResource(android.R.drawable.ic_menu_revert)
            setColorFilter(Color.WHITE)
            setOnClickListener { dialog.dismiss() }
        }

        val titleLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setPadding(16, 0, 16, 0)
        }

        val tvTitle = TextView(this).apply {
            text = "Ajukan Permohonan Izin / Sakit"
            setTextColor(Color.WHITE)
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
        }

        val tvSub = TextView(this).apply {
            text = "Verifikasi Resmi Wali Kelas & Guru BK SMPN 1 Boyolangu"
            setTextColor(Color.parseColor("#A7F3D0"))
            textSize = 11.5f
        }

        titleLayout.addView(tvTitle)
        titleLayout.addView(tvSub)
        topBar.addView(btnClose)
        topBar.addView(titleLayout)
        root.addView(topBar)

        // Scroll Content
        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val formContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 24, 32, 32)
        }

        // Child Info Card
        val childCard = CardView(this).apply {
            radius = 14f
            cardElevation = 2f
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
        }
        val childInfo = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 20)
        }
        val tvCName = TextView(this).apply {
            text = "👤 Ananda: ${binding.tvChildName.text}"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
        }
        val tvCClass = TextView(this).apply {
            text = "🏫 ${binding.tvChildClass.text}"
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
        }
        childInfo.addView(tvCName)
        childInfo.addView(tvCClass)
        childCard.addView(childInfo)
        formContainer.addView(childCard)

        // Kategori Perizinan Modular 3 Tab (Sakit | Izin | Dispensasi)
        val tvKatLabel = TextView(this).apply {
            text = "Kategori Perizinan (Pilih Tab) *"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(8, 16, 8, 8)
        }
        formContainer.addView(tvKatLabel)

        var selectedCategory = "SICK" // "SICK", "PERMISSION", "DISPENSATION"

        // Opsi Jenis Bukti Sakit (Izin Orang Tua Maks 3 Hari vs Surat Dokter Resmi)
        val sickDocContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(8, 8, 8, 4)
        }
        val tvSickDocLabel = TextView(this).apply {
            text = "Jenis Keterangan Sakit *"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(0, 4, 0, 4)
        }
        sickDocContainer.addView(tvSickDocLabel)

        val rgSickDocType = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
        }
        val rbParentSickNote = RadioButton(this).apply {
            id = View.generateViewId()
            text = "🏠 Izin Sakit dari Orang Tua (Otomatis Dikunci Maksimal 2 Hari)"
            textSize = 12.5f
        }
        val rbDoctorSickNote = RadioButton(this).apply {
            id = View.generateViewId()
            text = "🏥 Surat Keterangan Dokter Resmi (Sesuai Kebutuhan Istirahat Dokter)"
            textSize = 12.5f
        }
        rgSickDocType.addView(rbParentSickNote)
        rgSickDocType.addView(rbDoctorSickNote)
        rgSickDocType.check(rbParentSickNote.id)
        sickDocContainer.addView(rgSickDocType)

        val tvSickRuleBanner = TextView(this).apply {
            text = "ℹ️ KEBIJAKAN IZIN SEKOLAH: Izin sakit dan keluarga dari orang tua dikunci maksimal 2 hari berturut-turut. Jika ananda memerlukan perpanjangan izin lebih dari 2 hari, wajib mengajukan izin baru dengan melampirkan Surat Pengantar berstempel RT setempat, atau Surat Keterangan Dokter/Puskesmas jika ananda berobat ke dokter."
            textSize = 11f
            setTextColor(Color.parseColor("#9A3412"))
            setBackgroundColor(Color.parseColor("#FFEDD5"))
            setPadding(20, 16, 20, 16)
        }
        sickDocContainer.addView(tvSickRuleBanner)

        val tabCatContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                42.dpToPx()
            ).apply { topMargin = 4; bottomMargin = 10 }
        }

        val btnTabSick = Button(this).apply {
            text = "🤒 Sakit"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = 4 }
        }
        val btnTabPerm = Button(this).apply {
            text = "📝 Izin"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = 2; marginEnd = 2 }
        }
        val btnTabDisp = Button(this).apply {
            text = "🎖️ Dispensasi"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = 4 }
        }

        fun updateCategoryTabs() {
            fun styleTab(btn: Button, isSel: Boolean, activeColor: String) {
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = 10f * resources.displayMetrics.density
                    if (isSel) {
                        setColor(Color.parseColor(activeColor))
                    } else {
                        setColor(Color.parseColor("#F1F5F9"))
                        setStroke(1.dpToPx(), Color.parseColor("#E2E8F0"))
                    }
                }
                btn.background = gd
                btn.setTextColor(if (isSel) Color.WHITE else Color.parseColor("#64748B"))
            }

            styleTab(btnTabSick, selectedCategory == "SICK", "#7C3AED")
            styleTab(btnTabPerm, selectedCategory == "PERMISSION", "#D97706")
            styleTab(btnTabDisp, selectedCategory == "DISPENSATION", "#2563EB")
            sickDocContainer.visibility = if (selectedCategory == "SICK") View.VISIBLE else View.GONE
        }

        btnTabSick.setOnClickListener { selectedCategory = "SICK"; updateCategoryTabs() }
        btnTabPerm.setOnClickListener { selectedCategory = "PERMISSION"; updateCategoryTabs() }
        btnTabDisp.setOnClickListener { selectedCategory = "DISPENSATION"; updateCategoryTabs() }

        tabCatContainer.addView(btnTabSick)
        tabCatContainer.addView(btnTabPerm)
        tabCatContainer.addView(btnTabDisp)
        formContainer.addView(tabCatContainer)
        formContainer.addView(sickDocContainer)
        updateCategoryTabs()

        // Tanggal
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        val tvDateLabel = TextView(this).apply {
            text = "Periode Tanggal Tidak Masuk Sekolah *"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(8, 16, 8, 8)
        }
        formContainer.addView(tvDateLabel)

        val dateRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
        }

        val etStartDate = EditText(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(0, 0, 8, 0) }
            hint = "Mulai (YYYY-MM-DD)"
            setText(today)
            textSize = 13f
            setBackgroundResource(android.R.drawable.edit_text)
            setOnClickListener { showDatePicker(this) }
        }

        val etEndDate = EditText(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(8, 0, 0, 0) }
            hint = "Selesai (YYYY-MM-DD)"
            setText(today)
            textSize = 13f
            setBackgroundResource(android.R.drawable.edit_text)
            setOnClickListener { showDatePicker(this) }
        }
        dateRow.addView(etStartDate)
        dateRow.addView(etEndDate)
        formContainer.addView(dateRow)

        // Alasan
        val tvReasonLabel = TextView(this).apply {
            text = "Keterangan / Alasan Rinci *"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(8, 16, 8, 8)
        }
        formContainer.addView(tvReasonLabel)

        val etReason = EditText(this).apply {
            hint = "Contoh: Mengalami demam tinggi dan batuk, sedang istirahat / berobat..."
            minLines = 3
            textSize = 13f
            setBackgroundResource(android.R.drawable.edit_text)
            setPadding(16, 16, 16, 16)
        }
        formContainer.addView(etReason)

        // Lampiran Foto Asli
        val tvAttachLabel = TextView(this).apply {
            text = "📷 Lampiran Foto Asli Surat Dokter / Surat Izin *"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            setPadding(8, 20, 8, 4)
        }
        formContainer.addView(tvAttachLabel)

        val tvAttachInfo = TextView(this).apply {
            text = "Untuk Surat Keterangan Dokter atau Perpanjangan Sakit (Belum Sembuh), WAJIB melampirkan foto fisik Surat Keterangan Dokter resmi (bukan surat buatan orang tua / tulisan tangan)."
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(8, 0, 8, 12)
        }
        formContainer.addView(tvAttachInfo)

        val photoButtonsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
        }

        val btnCamera = Button(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(0, 0, 6, 0) }
            text = "📸 Kamera"
            textSize = 12f
            setBackgroundColor(Color.parseColor("#0284C7"))
            setTextColor(Color.WHITE)
            setOnClickListener { takeCameraPhoto.launch(null) }
        }

        val btnGallery = Button(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(6, 0, 0, 0) }
            text = "🖼️ Galeri HP"
            textSize = 12f
            setBackgroundColor(Color.parseColor("#475569"))
            setTextColor(Color.WHITE)
            setOnClickListener { pickFromGallery.launch("image/*") }
        }
        photoButtonsRow.addView(btnCamera)
        photoButtonsRow.addView(btnGallery)
        formContainer.addView(photoButtonsRow)

        tvPhotoStatus = TextView(this).apply {
            text = "⚠️ Belum ada foto surat yang dilampirkan"
            textSize = 11.5f
            setTextColor(Color.parseColor("#DC2626"))
            setPadding(8, 8, 8, 8)
        }
        formContainer.addView(tvPhotoStatus)

        ivPhotoPreview = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 400).apply { setMargins(0, 8, 0, 12) }
            scaleType = ImageView.ScaleType.FIT_CENTER
            visibility = View.GONE
            setBackgroundColor(Color.parseColor("#E2E8F0"))
        }
        formContainer.addView(ivPhotoPreview)

        // =========================================================================
        // STATUS PROSES VERIFIKASI IZIN / SAKIT (DI BAWAH LAMPIRAN)
        // =========================================================================
        val tvStatusSectionHeader = TextView(this).apply {
            text = "📋 Status Verifikasi & Jumlah Hari Masuk Rekap"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#1E293B"))
            setPadding(8, 20, 8, 8)
        }
        formContainer.addView(tvStatusSectionHeader)

        val statusVerificationContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        formContainer.addView(statusVerificationContainer)

        val tvLoadingStatus = TextView(this).apply {
            text = "Memeriksa status verifikasi izin di server..."
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(12, 12, 12, 12)
        }
        statusVerificationContainer.addView(tvLoadingStatus)

        // Panggil endpoint /api/parent/leave-requests untuk mengambil status verifikasi
        val targetChildId = currentStudentId
        ApiClient.getClient(this).getParentLeaveRequests(targetChildId).enqueue(object : Callback<List<ParentLeaveRequestDto>> {
            override fun onResponse(call: Call<List<ParentLeaveRequestDto>>, response: Response<List<ParentLeaveRequestDto>>) {
                statusVerificationContainer.removeAllViews()
                val list = response.body()
                cachedParentLeaveList = list

                // Cek apakah ada izin sakit aktif / dalam 7 hari terakhir (Perpanjangan Sakit)
                val recentSickItem = list?.firstOrNull { prev ->
                    val isPrevSick = (prev.category == "SICK" || prev.category == "SAKIT")
                    val isNotRejected = prev.status != "REJECTED"
                    if (!isPrevSick || !isNotRejected) false
                    else {
                        try {
                            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                            val endStr = (prev.endDate ?: prev.createdAt ?: "").substringBefore("T")
                            val endDt = sdf.parse(endStr)
                            val diffMs = System.currentTimeMillis() - (endDt?.time ?: 0L)
                            diffMs <= 7L * 24 * 60 * 60 * 1000
                        } catch (e: Exception) { true }
                    }
                }

                if (recentSickItem != null) {
                    rbDoctorSickNote.isChecked = true
                    rbParentSickNote.isEnabled = false
                    tvSickRuleBanner.text = "🚨 PERINGATAN OTOMATIS PERPANJANGAN SAKIT: Ananda tercatat telah menggunakan izin sakit sebelumnya (${recentSickItem.startDate?.substringBefore("T")} s/d ${recentSickItem.endDate?.substringBefore("T")}). Apabila belum sembuh dan diperpanjang, WAJIB melampirkan foto Surat Keterangan berstempel RT setempat atau Surat Keterangan Dokter/Faskes resmi!"
                    tvSickRuleBanner.setTextColor(Color.parseColor("#991B1B"))
                    tvSickRuleBanner.setBackgroundColor(Color.parseColor("#FEE2E2"))

                    com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                        this@ParentMainActivity,
                        "⚠️ Perpanjangan Sakit Wajib Surat Dokter",
                        "Ananda belum sembuh dari izin sebelumnya. Perpanjangan sakit wajib menggunakan Surat Keterangan Dokter resmi (bukan surat buatan orang tua/tangan).",
                        "Sistem Perizinan Sekolah"
                    )
                }

                if (response.isSuccessful && !list.isNullOrEmpty()) {
                    list.forEachIndexed { _, req ->
                        val card = CardView(this@ParentMainActivity).apply {
                            radius = 12f
                            cardElevation = 2f
                            useCompatPadding = true
                            setPadding(0, 0, 0, 0)
                        }

                        val cardContent = LinearLayout(this@ParentMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(20, 16, 20, 16)
                        }

                        val daysApproved = req.approvedDays ?: req.durationDays ?: 1
                        val docLabel = req.documentLabel ?: if (req.isDoctorNote == true) "🏥 Surat Dokter ($daysApproved Hari)" else "🏠 Izin Ortu ($daysApproved Hari)"

                        val statusUpper = req.status?.uppercase() ?: "PENDING"
                        val (statusBadge, statusBg, statusColor, descText) = when (statusUpper) {
                            "APPROVED" -> Quadruple(
                                "✅ DISETUJUI ($daysApproved HARI REKAP)",
                                "#F0FDF4",
                                "#15803D",
                                "Disetujui ${req.verifiedBy ?: "Wali Kelas & BK"} selama $daysApproved HARI ($docLabel). Otomatis masuk ke Rekap Presensi APK, Wali Kelas & Pengurus Kelas. Jika belum sembuh & diperpanjang, WAJIB Surat Dokter resmi."
                            )
                            "REJECTED" -> Quadruple(
                                "❌ DITOLAK",
                                "#FEF2F2",
                                "#B91C1C",
                                "Alasan Penolakan: ${req.rejectionNote ?: "Wajib melampirkan Surat Keterangan Dokter resmi"}"
                            )
                            else -> Quadruple(
                                "⏳ MENUNGGU VERIFIKASI ($daysApproved HARI)",
                                "#FFFBEB",
                                "#B45309",
                                "Jenis: $docLabel. Sedang diperiksa oleh Wali Kelas & Guru BK."
                            )
                        }

                        card.setCardBackgroundColor(Color.parseColor(statusBg))

                        val headerRow = LinearLayout(this@ParentMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                        }

                        val tvCat = TextView(this@ParentMainActivity).apply {
                            text = if (req.category == "SICK" || req.category == "SAKIT") "🤒 Sakit ($docLabel)" else "📝 Izin ($daysApproved Hari)"
                            textSize = 12f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor("#0F172A"))
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        headerRow.addView(tvCat)

                        val tvBadge = TextView(this@ParentMainActivity).apply {
                            text = statusBadge
                            textSize = 10f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor(statusColor))
                        }
                        headerRow.addView(tvBadge)
                        cardContent.addView(headerRow)

                        val tvPeriod = TextView(this@ParentMainActivity).apply {
                            val start = req.startDate?.substringBefore("T") ?: "-"
                            val end = req.endDate?.substringBefore("T") ?: "-"
                            text = "🗓️ Periode: $start s/d $end ($daysApproved Hari)"
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#334155"))
                            setPadding(0, 6, 0, 2)
                        }
                        cardContent.addView(tvPeriod)

                        val tvReason = TextView(this@ParentMainActivity).apply {
                            text = "💬 Alasan: ${req.reason ?: "-"}"
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#475569"))
                        }
                        cardContent.addView(tvReason)

                        val tvExpl = TextView(this@ParentMainActivity).apply {
                            text = descText
                            textSize = 11f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor(statusColor))
                            setPadding(0, 6, 0, 0)
                        }
                        cardContent.addView(tvExpl)

                        card.addView(cardContent)
                        statusVerificationContainer.addView(card)
                    }
                } else {
                    val tvEmpty = TextView(this@ParentMainActivity).apply {
                        text = "ℹ️ Belum ada riwayat permohonan izin sebelumnya untuk Ananda. Formulir di atas siap diisi dan diajukan."
                        textSize = 11.5f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(12, 10, 12, 10)
                    }
                    statusVerificationContainer.addView(tvEmpty)
                }
            }

            override fun onFailure(call: Call<List<ParentLeaveRequestDto>>, t: Throwable) {
                statusVerificationContainer.removeAllViews()
                val tvErr = TextView(this@ParentMainActivity).apply {
                    text = "Gagal memuat status verifikasi: ${t.message}"
                    textSize = 11f
                    setTextColor(Color.parseColor("#94A3B8"))
                }
                statusVerificationContainer.addView(tvErr)
            }
        })

        scrollView.addView(formContainer)
        root.addView(scrollView)

        // Bottom Action Bar
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(32, 16, 32, 24)
            elevation = 8f
        }

        val btnSubmit = Button(this).apply {
            text = "📤 Kirim Permohonan Izin ke Wali Kelas & BK"
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#0D5C3A"))
            setTextColor(Color.WHITE)
            setPadding(0, 20, 0, 20)
            setOnClickListener {
                val isSick = selectedCategory == "SICK"
                val isDoctorNote = isSick && rbDoctorSickNote.isChecked
                val category = selectedCategory
                val reason = etReason.text.toString().trim()
                val start = etStartDate.text.toString().trim()
                var end = etEndDate.text.toString().trim()

                if (reason.isEmpty()) {
                    Toast.makeText(this@ParentMainActivity, "Alasan izin / diagnosa sakit wajib diisi!", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val childId = currentStudentId
                if (childId.isNullOrEmpty()) {
                    Toast.makeText(this@ParentMainActivity, "Data siswa sedang dimuat, silakan coba beberapa saat lagi...", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                // Hitung durasi hari izin/sakit
                var diffDays = 1
                val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                try {
                    val dStart = sdf.parse(start)
                    val dEnd = sdf.parse(end)
                    if (dStart != null && dEnd != null) {
                        val diffMillis = Math.max(0L, dEnd.time - dStart.time)
                        diffDays = (diffMillis / (1000 * 60 * 60 * 24)).toInt() + 1
                    }
                } catch (e: Exception) {}

                // Cek apakah ini Perpanjangan Sakit (belum sembuh dalam 7 hari terakhir)
                val hasRecentSick = cachedParentLeaveList?.any { prev ->
                    val isPrevSick = (prev.category == "SICK" || prev.category == "SAKIT")
                    val isNotRejected = prev.status != "REJECTED"
                    if (!isPrevSick || !isNotRejected) false
                    else {
                        try {
                            val endStr = (prev.endDate ?: prev.createdAt ?: "").substringBefore("T")
                            val endDt = sdf.parse(endStr)
                            val diffMs = System.currentTimeMillis() - (endDt?.time ?: 0L)
                            diffMs <= 7L * 24 * 60 * 60 * 1000
                        } catch (e: Exception) { true }
                    }
                } ?: false

                // 1. Validasi Perpanjangan Sakit: WAJIB SURAT DOKTER RESMI (Bukan surat orang tua / tulisan tangan)
                if (category == "SICK" && hasRecentSick) {
                    if (!isDoctorNote || attachedPhotoBase64.isNullOrEmpty()) {
                        com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                            this@ParentMainActivity,
                            "⚠️ Wajib Surat Dokter untuk Perpanjangan Sakit",
                            "Ananda belum sembuh dari izin sakit sebelumnya. Perpanjangan sakit WAJIB menggunakan foto Surat Keterangan Dokter resmi (bukan surat buatan orang tua/tulisan tangan).",
                            "Sistem Perizinan Sekolah"
                        )
                        AlertDialog.Builder(this@ParentMainActivity)
                            .setTitle("⚠️ Perpanjangan Sakit Wajib Surat Dokter")
                            .setMessage("Ananda tercatat telah menggunakan izin sakit sebelumnya dan belum sembuh.\n\nSesuai tata tertib sekolah:\n1. Perpanjangan izin sakit WAJIB memilih opsi '🏥 Surat Keterangan Dokter Resmi'.\n2. WAJIB melampirkan foto fisik Surat Keterangan Dokter asli (BUKAN surat buatan orang tua atau tulisan tangan).")
                            .setPositiveButton("Pilih Surat Dokter") { _, _ ->
                                rbDoctorSickNote.isChecked = true
                            }
                            .show()
                        return@setOnClickListener
                    }
                }

                // 2. Validasi Izin Sakit & Keluarga Orang Tua -> Mutlak Dikunci Maksimal 2 Hari!
                if (!isDoctorNote && diffDays > 2) {
                    AlertDialog.Builder(this@ParentMainActivity)
                        .setTitle("⚠️ Izin Orang Tua Dikunci Maksimal 2 Hari")
                        .setMessage("Sesuai kebijakan resmi sekolah, izin sakit dan urusan keluarga dari orang tua dikunci MAKSIMAL 2 HARI berturut-turut.\n\nAnda memilih durasi $diffDays hari. Sistem akan membatasi izin ini otomatis menjadi 2 hari.\n\nApabila ananda membutuhkan perpanjangan izin di hari ke-3, wajib mengajukan permohonan baru dengan melampirkan Surat Pengantar berstempel RT setempat, atau Surat Keterangan Dokter jika ananda berobat ke fasilitas kesehatan.")
                        .setPositiveButton("Kunci Maksimal 2 Hari") { _, _ ->
                            try {
                                val dStart = sdf.parse(start)
                                if (dStart != null) {
                                    val cal = Calendar.getInstance()
                                    cal.time = dStart
                                    cal.add(Calendar.DAY_OF_MONTH, 1) // Hari ke-1 dan ke-2 (total 2 hari)
                                    etEndDate.setText(sdf.format(cal.time))
                                }
                            } catch (_: Exception) {}
                        }
                        .setNeutralButton("Gunakan Surat Dokter") { _, _ ->
                            rbDoctorSickNote.isChecked = true
                        }
                        .show()
                    return@setOnClickListener
                }

                // 3. Validasi Surat Dokter Resmi -> Wajib Foto Surat Dokter
                if (category == "SICK" && isDoctorNote && attachedPhotoBase64.isNullOrEmpty()) {
                    AlertDialog.Builder(this@ParentMainActivity)
                        .setTitle("🏥 Wajib Foto Surat Keterangan Dokter")
                        .setMessage("Anda memilih kategori Surat Keterangan Dokter Resmi ($diffDays hari istirahat). Mohon lampirkan foto fisik Surat Keterangan Dokter dari Rumah Sakit / Klinik / Puskesmas.")
                        .setPositiveButton("Ambil Foto Surat", null)
                        .show()
                    return@setOnClickListener
                }

                val docType = if (isDoctorNote) "DOCTOR_NOTE" else "PARENT_NOTE"
                val payload = mapOf(
                    "studentId" to childId,
                    "category" to category,
                    "documentType" to docType,
                    "startDate" to start,
                    "endDate" to end,
                    "reason" to reason,
                    "attachmentUrl" to (attachedPhotoBase64 ?: "")
                )

                Toast.makeText(this@ParentMainActivity, "Mengirim permohonan ke Guru BK...", Toast.LENGTH_SHORT).show()

                ApiClient.getClient(this@ParentMainActivity).submitParentLeaveRequest(payload).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            val cName = binding.tvChildName.text.toString().ifEmpty { "Ananda" }
                            com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                                this@ParentMainActivity,
                                "📩 Permohonan Izin Berhasil Terkirim",
                                "Permohonan $category untuk $cName telah diteruskan khusus ke Guru BK untuk verifikasi.",
                                "Perizinan SMPN 1 Boyolangu"
                            )
                            Toast.makeText(this@ParentMainActivity, "✅ Permohonan Izin Berhasil Dikirim ke Guru BK!", Toast.LENGTH_LONG).show()
                            dialog.dismiss()
                            loadParentData()
                        } else {
                            val errMsg = try {
                                val errStr = response.errorBody()?.string() ?: ""
                                if (errStr.contains("message")) {
                                    org.json.JSONObject(errStr).optString("message", "Gagal mengirim permohonan")
                                } else errStr
                            } catch (e: Exception) { "Gagal memproses permohonan di server" }
                            Toast.makeText(this@ParentMainActivity, "❌ Gagal: $errMsg", Toast.LENGTH_LONG).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@ParentMainActivity, "❌ Gagal terhubung ke server: ${t.message}", Toast.LENGTH_LONG).show()
                    }
                })
            }
        }
        bottomBar.addView(btnSubmit)
        root.addView(bottomBar)

        dialog.setContentView(root)
        dialog.show()
    }

    private fun showSubjectAttendanceDialog() {
        val childId = currentStudentId
        if (childId.isNullOrEmpty()) {
            Toast.makeText(this, "Memuat profil anak...", Toast.LENGTH_SHORT).show()
            return
        }

        Toast.makeText(this, "Memuat rekap kehadiran per mapel...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getParentSubjectAttendanceSummary(childId).enqueue(object : Callback<com.school.smartcbt.data.model.SubjectAttendanceResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.SubjectAttendanceResponse>, response: Response<com.school.smartcbt.data.model.SubjectAttendanceResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val data = response.body()!!
                    renderSubjectAttendanceDialog(data)
                } else {
                    Toast.makeText(this@ParentMainActivity, "Gagal memuat data presensi mapel", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.SubjectAttendanceResponse>, t: Throwable) {
                Toast.makeText(this@ParentMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderSubjectAttendanceDialog(data: com.school.smartcbt.data.model.SubjectAttendanceResponse) {
        val dialog = Dialog(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0D5C3A"))
            gravity = Gravity.CENTER_VERTICAL
            setPadding(24, 24, 24, 24)
            elevation = 6f
        }

        val btnClose = ImageButton(this).apply {
            layoutParams = LinearLayout.LayoutParams(48.dpToPx(), 48.dpToPx())
            background = ColorDrawable(Color.TRANSPARENT)
            setImageResource(android.R.drawable.ic_menu_revert)
            setColorFilter(Color.WHITE)
            setOnClickListener { dialog.dismiss() }
        }

        val titleLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setPadding(16, 0, 16, 0)
        }

        val tvTitle = TextView(this).apply {
            text = "Rekap Kehadiran per Mapel"
            setTextColor(Color.WHITE)
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
        }

        val tvSub = TextView(this).apply {
            text = "${data.studentName ?: "Siswa"} • Kelas ${data.className ?: "VII-A"}"
            setTextColor(Color.parseColor("#A7F3D0"))
            textSize = 12f
        }

        titleLayout.addView(tvTitle)
        titleLayout.addView(tvSub)
        topBar.addView(btnClose)
        topBar.addView(titleLayout)
        root.addView(topBar)

        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 32)
        }

        val subjects = data.subjects ?: emptyList()
        if (subjects.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada rekap mata pelajaran yang tersimpan."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 13f
                setPadding(0, 32, 0, 0)
                gravity = Gravity.CENTER
            }
            listContainer.addView(tvEmpty)
        } else {
            subjects.forEach { subj ->
                val card = CardView(this).apply {
                    radius = 16f * resources.displayMetrics.density
                    cardElevation = 2.5f * resources.displayMetrics.density
                    setCardBackgroundColor(Color.WHITE)
                    useCompatPadding = true
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = 10.dpToPx()
                    }
                    layoutParams = lp
                }

                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(16.dpToPx(), 16.dpToPx(), 16.dpToPx(), 16.dpToPx())
                }

                val headerRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                }

                val titleCol = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginEnd = 8.dpToPx()
                    }
                }

                val tvSubjName = TextView(this).apply {
                    text = "📘 ${subj.subjectName}"
                    textSize = 14.5f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.parseColor("#0F172A"))
                }
                titleCol.addView(tvSubjName)

                val tvTeacher = TextView(this).apply {
                    text = "Guru Pengampu: ${subj.teacherName ?: "-"}"
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#64748B"))
                    setPadding(0, 2.dpToPx(), 0, 0)
                }
                titleCol.addView(tvTeacher)

                headerRow.addView(titleCol)

                val isHigh = subj.percentage >= 85
                val isMed = subj.percentage >= 70
                val prcBg = if (isHigh) "#DCFCE7" else if (isMed) "#FEF3C7" else "#FEE2E2"
                val prcText = if (isHigh) "#15803D" else if (isMed) "#B45309" else "#B91C1C"

                val tvPct = TextView(this).apply {
                    text = "${subj.percentage}% Kehadiran"
                    textSize = 11f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.parseColor(prcText))
                    val shape = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor(prcBg))
                        cornerRadius = 10f * resources.displayMetrics.density
                    }
                    background = shape
                    val hp = 10.dpToPx()
                    val vp = 4.dpToPx()
                    setPadding(hp, vp, hp, vp)
                }
                headerRow.addView(tvPct)
                row.addView(headerRow)

                // Mini Progress Bar
                val progressTrack = LinearLayout(this).apply {
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 6.dpToPx()).apply {
                        topMargin = 12.dpToPx()
                        bottomMargin = 12.dpToPx()
                    }
                    val trackShape = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#E2E8F0"))
                        cornerRadius = 3f * resources.displayMetrics.density
                    }
                    background = trackShape
                    weightSum = 100f
                }

                val safePrc = subj.percentage.coerceIn(0, 100).toFloat()
                if (safePrc > 0f) {
                    val progressFill = View(this).apply {
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, safePrc)
                        val fillShape = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor(if (isHigh) "#10B981" else if (isMed) "#F59E0B" else "#EF4444"))
                            cornerRadius = 3f * resources.displayMetrics.density
                        }
                        background = fillShape
                    }
                    progressTrack.addView(progressFill)
                }
                row.addView(progressTrack)

                val statsRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    weightSum = 4f
                }

                fun statBadge(label: String, value: Int, bgHex: String, colorHex: String, isFirst: Boolean, isLast: Boolean): LinearLayout {
                    return LinearLayout(this).apply {
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                            marginStart = if (isFirst) 0 else 3.dpToPx()
                            marginEnd = if (isLast) 0 else 3.dpToPx()
                        }
                        orientation = LinearLayout.VERTICAL
                        gravity = Gravity.CENTER
                        val shape = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor(bgHex))
                            cornerRadius = 8f * resources.displayMetrics.density
                        }
                        background = shape
                        val vp = 8.dpToPx()
                        val hp = 4.dpToPx()
                        setPadding(hp, vp, hp, vp)

                        val tvV = TextView(this@ParentMainActivity).apply {
                            text = value.toString()
                            textSize = 14f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor(colorHex))
                            gravity = Gravity.CENTER
                        }
                        val tvL = TextView(this@ParentMainActivity).apply {
                            text = label
                            textSize = 10f
                            setTextColor(Color.parseColor(colorHex))
                            gravity = Gravity.CENTER
                            setPadding(0, 2.dpToPx(), 0, 0)
                        }
                        addView(tvV)
                        addView(tvL)
                    }
                }

                statsRow.addView(statBadge("Hadir", subj.present, "#DCFCE7", "#15803D", isFirst = true, isLast = false))
                statsRow.addView(statBadge("Sakit", subj.sick, "#E0F2FE", "#0369A1", isFirst = false, isLast = false))
                statsRow.addView(statBadge("Izin", subj.permission, "#FEF3C7", "#B45309", isFirst = false, isLast = false))
                statsRow.addView(statBadge("Alpa", subj.truant, "#FFE4E6", "#BE123C", isFirst = false, isLast = true))
                card.addView(row)
                listContainer.addView(card)
            }
        }

        scrollView.addView(listContainer)
        root.addView(scrollView)

        dialog.setContentView(root)
        dialog.show()
    }

    private fun showChildHealthHistoryDialog() {
        Toast.makeText(this, "Memuat rekam medis anak dari UKS...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getParentChildHealth().enqueue(object : Callback<StudentHealthResponse> {
            override fun onResponse(call: Call<StudentHealthResponse>, response: Response<StudentHealthResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val data = response.body()!!
                    val student = data.student
                    val visits = data.visits ?: emptyList()

                    val sb = StringBuilder()
                    sb.append("📋 REKAM MEDIS & KESEHATAN ANAK\n")
                    sb.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
                    sb.append("👤 Nama: ${student?.name ?: "-"}\n")
                    sb.append("🏫 Kelas: ${student?.className ?: "-"}\n")
                    sb.append("🩸 Golongan Darah: ${student?.bloodType ?: "-"}\n")
                    sb.append("⚠️ Riwayat Alergi: ${student?.allergies ?: "Tidak Ada Riwayat Alergi"}\n")
                    sb.append("🤒 Total Kunjungan Sakit: ${student?.totalSickDays ?: 0} Hari\n")
                    sb.append("⚠️ Kejadian Pingsan: ${student?.faintingCount ?: 0} Kali\n")
                    if (student?.height != null && student.weight != null) {
                        sb.append("⚖️ Antropometri: TB ${student.height} cm • BB ${student.weight} kg (BMI: ${student.bmi ?: "-"} - ${student.bmiStatus ?: "Normal"})\n")
                    }
                    sb.append("\n")

                    sb.append("🏥 RIWAYAT PEMERIKSAAN UKS SEKOLAH:\n")
                    if (visits.isEmpty()) {
                        sb.append("• Belum ada catatan kunjungan ke ruang UKS sekolah.\n")
                        sb.append("• Kondisi kesehatan anak terpantau bugar & prima.\n")
                    } else {
                        visits.forEachIndexed { idx, v ->
                            sb.append("${idx + 1}. Waktu: ${v.checkInTime ?: "-"}\n")
                            sb.append("   • Keluhan: ${v.complaint ?: "-"}\n")
                            sb.append("   • Penanganan: ${v.treatment ?: "-"}\n")
                            if (!v.medicine.isNullOrEmpty()) {
                                sb.append("   • Obat Diberikan: ${v.medicine}\n")
                            }
                            sb.append("   • Selesai Istirahat: ${v.checkOutTime ?: "Kembali ke Kelas"}\n")
                            sb.append("─────────────────────────────\n")
                        }
                    }

                    AlertDialog.Builder(this@ParentMainActivity)
                        .setTitle("🏥 Riwayat Kesehatan & UKS Anak")
                        .setMessage(sb.toString().trimEnd())
                        .setPositiveButton("Tutup", null)
                        .show()
                } else {
                    Toast.makeText(this@ParentMainActivity, "Gagal memuat rekam medis anak", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<StudentHealthResponse>, t: Throwable) {
                Toast.makeText(this@ParentMainActivity, "Koneksi ke server gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showExamHistoryDialog() {
        val dialog = AlertDialog.Builder(this).create()
        val scroll = android.widget.ScrollView(this)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 32, 36, 32)
        }

        val tvTitle = TextView(this).apply {
            text = "📊 Ujian CBT & Asesmen Ananda"
            textSize = 18f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
        }

        val tvSub = TextView(this).apply {
            text = "Informasi jadwal ulangan mendatang dan rekap nilai ujian CBT resmi."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 4, 0, 14)
        }

        container.addView(tvTitle)
        container.addView(tvSub)

        // Tab Selector: Mendatang vs Selesai
        val tabContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = android.graphics.drawable.ColorDrawable(Color.parseColor("#F1F5F9"))
            setPadding(8, 8, 8, 8)
        }

        val btnTabUpcoming = Button(this).apply {
            text = "📅 Ujian Mendatang"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0A2E5C"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val btnTabHistory = Button(this).apply {
            text = "🏆 Riwayat Selesai"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        tabContainer.addView(btnTabUpcoming)
        tabContainer.addView(btnTabHistory)
        container.addView(tabContainer)

        val sectionContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 16, 0, 0)
        }
        container.addView(sectionContainer)

        var isHistoryTab = false

        fun renderExams() {
            sectionContainer.removeAllViews()

            if (!isHistoryTab) {
                // SECTION: UJIAN MENDATANG
                val tvSec = TextView(this).apply {
                    text = "🗓️ JADWAL UJIAN MENDATANG"
                    setTextColor(Color.parseColor("#1E40AF"))
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setPadding(0, 0, 0, 8)
                }
                sectionContainer.addView(tvSec)

                val upcomingExams = listOf(
                    Triple("Ulangan Harian CBT Bahasa Inggris", "Jumat, 18 Sep 2026 • 08:00 - 09:00 WIB", "⏱️ 60 Menit • Bab 3: Descriptive Text"),
                    Triple("Penilaian Tengah Semester IPA Terpadu", "Rabu, 23 Sep 2026 • 07:30 - 09:00 WIB", "⏱️ 90 Menit • Bab 1 s/d 4"),
                    Triple("Asesmen Sumatif Matematika Terapan", "Senin, 28 Sep 2026 • 07:30 - 09:30 WIB", "⏱️ 120 Menit • Aljabar & Geometri")
                )

                for (item in upcomingExams) {
                    val card = CardView(this).apply {
                        radius = 14f
                        cardElevation = 2f
                        setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                        useCompatPadding = true
                    }
                    val l = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(18, 14, 18, 14)
                    }

                    val tName = TextView(this).apply {
                        text = item.first
                        setTextColor(Color.parseColor("#0F172A"))
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                    }
                    val tTime = TextView(this).apply {
                        text = item.second
                        setTextColor(Color.parseColor("#2563EB"))
                        textSize = 11.5f
                        setTypeface(null, Typeface.BOLD)
                        setPadding(0, 4, 0, 2)
                    }
                    val tDetail = TextView(this).apply {
                        text = item.third
                        setTextColor(Color.parseColor("#64748B"))
                        textSize = 11f
                    }

                    l.addView(tName)
                    l.addView(tTime)
                    l.addView(tDetail)
                    card.addView(l)
                    sectionContainer.addView(card)
                }

                val tip = TextView(this).apply {
                    text = "💡 Petunjuk Orang Tua: Pastikan ananda hadir tepat waktu di sekolah dan mempersiapkan materi belajar sebelum jadwal ujian berlangsung."
                    setTextColor(Color.parseColor("#1D4ED8"))
                    textSize = 10.5f
                    setBackgroundColor(Color.parseColor("#EFF6FF"))
                    setPadding(14, 12, 14, 12)
                }
                sectionContainer.addView(tip)

            } else {
                // SECTION: RIWAYAT UJIAN SELESAI
                val tvSec = TextView(this).apply {
                    text = "🏆 HASIL & NILAI CBT TERAKHIR"
                    setTextColor(Color.parseColor("#047857"))
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    setPadding(0, 0, 0, 8)
                }
                sectionContainer.addView(tvSec)

                val completedExams = listOf(
                    Triple("Penilaian Harian Matematika", "25 Agt 2026", Pair("92.5", "TUNTAS SANGAT BAIK • 0 Pelanggaran")),
                    Triple("Ujian Tengah Semester IPA Terpadu", "20 Agt 2026", Pair("88.0", "TUNTAS BAIK • Selesai Tepat Waktu")),
                    Triple("Asesmen Diagnostik Bahasa Indonesia", "15 Agt 2026", Pair("85.0", "TUNTAS BAIK • 0 Pelanggaran")),
                    Triple("Ulangan Harian PAI & Budi Pekerti", "10 Agt 2026", Pair("94.0", "TUNTAS SANGAT BAIK • Predikat A"))
                )

                for (item in completedExams) {
                    val card = CardView(this).apply {
                        radius = 14f
                        cardElevation = 2f
                        setCardBackgroundColor(Color.parseColor("#F0FDF4"))
                        useCompatPadding = true
                    }
                    val l = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(18, 14, 18, 14)
                    }

                    val rowTop = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                    }

                    val tName = TextView(this).apply {
                        text = item.first
                        setTextColor(Color.parseColor("#0F172A"))
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    }
                    rowTop.addView(tName)

                    val tScore = TextView(this).apply {
                        text = "Nilai: ${item.third.first}"
                        setTextColor(Color.parseColor("#15803D"))
                        textSize = 12f
                        setTypeface(null, Typeface.BOLD)
                        setBackgroundColor(Color.parseColor("#DCFCE7"))
                        setPadding(14, 4, 14, 4)
                    }
                    rowTop.addView(tScore)
                    l.addView(rowTop)

                    val tDate = TextView(this).apply {
                        text = "📅 Dikerjakan: ${item.second}"
                        setTextColor(Color.parseColor("#64748B"))
                        textSize = 11f
                        setPadding(0, 4, 0, 2)
                    }
                    val tStatus = TextView(this).apply {
                        text = "✓ Status: ${item.third.second}"
                        setTextColor(Color.parseColor("#047857"))
                        textSize = 11f
                        setTypeface(null, Typeface.BOLD)
                    }

                    l.addView(tDate)
                    l.addView(tStatus)
                    card.addView(l)
                    sectionContainer.addView(card)
                }
            }
        }

        fun updateTabs() {
            val activeColor = Color.parseColor("#0A2E5C")
            btnTabUpcoming.setBackgroundColor(if (!isHistoryTab) activeColor else Color.TRANSPARENT)
            btnTabUpcoming.setTextColor(if (!isHistoryTab) Color.WHITE else Color.parseColor("#64748B"))

            btnTabHistory.setBackgroundColor(if (isHistoryTab) activeColor else Color.TRANSPARENT)
            btnTabHistory.setTextColor(if (isHistoryTab) Color.WHITE else Color.parseColor("#64748B"))

            renderExams()
        }

        btnTabUpcoming.setOnClickListener { isHistoryTab = false; updateTabs() }
        btnTabHistory.setOnClickListener { isHistoryTab = true; updateTabs() }

        renderExams()

        val btnClose = Button(this).apply {
            text = "Tutup"
            setBackgroundColor(Color.parseColor("#0F172A"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 20
            }
            setOnClickListener { dialog.dismiss() }
        }
        container.addView(btnClose)

        scroll.addView(container)
        dialog.setView(scroll)
        dialog.show()
    }

    private fun showFullGradesDialog() {
        val gradesMsg = """
🎯 REKAP NILAI MATA PELAJARAN (SEMESTER 1):
• Matematika: 88.0 (Predikat A)
• Bahasa Indonesia: 85.0 (Predikat A)
• Bahasa Inggris: 90.0 (Predikat A)
• IPA Terpadu: 92.5 (Predikat A)
• IPS Terpadu: 86.0 (Predikat A)
• PPKn: 89.0 (Predikat A)
• PAI / Budi Pekerti: 94.0 (Predikat A)
• PJOK: 84.0 (Predikat B+)
• Seni Budaya & Prakarya: 88.0 (Predikat A)

Rata-rata Keseluruhan: 88.6 (TUNTAS UNGGUL)
        """.trimIndent()

        AlertDialog.Builder(this)
            .setTitle("📚 Rekap Nilai Akademik Lengkap")
            .setMessage(gradesMsg)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun showGrowthChartDialog() {
        val growthMsg = """
📈 ANALISIS PERKEMBANGAN BELAJAR:
• Tren Nilai: Meningkat stabil (+14.8% dari awal semester)
• Kehadiran: 96.5% (Tepat Waktu)
• Keaktifan Tugas: 100% Tugas terkumpul tepat waktu
• Daya Saing: Masuk dalam 3 Besar di Kelas VII-A

Rekomendasi Guru Wali Kelas:
"Terus pertahankan konsistensi belajar, kemampuan logika analitis sangat menonjol pada mata pelajaran eksakta."
        """.trimIndent()

        AlertDialog.Builder(this)
            .setTitle("📈 Grafik & Analisis Perkembangan Anak")
            .setMessage(growthMsg)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun showBehaviorLogDialog() {
        val behaviorMsg = """
🕊️ BUKU CATATAN KARAKTER, PRESTASI & PELANGGARAN:
• Total Poin Disiplin: 100 / 100 (Status: BEBAS PELANGGARAN)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RIWAYAT NOTIFIKASI KARAKTER:
1. 🏆 PRESTASI (+15 Poin | 20 Agt 2026):
   Juara 1 Lomba Sains & Matematika Tingkat Sekolah
2. 🌟 PRESTASI (+10 Poin | 12 Agt 2026):
   Petugas Upacara Bendera HUT RI Teladan
3. ⚠️ PELANGGARAN RINGAN (-5 Poin | 05 Agt 2026):
   Terlambat Hadir Pintu Gerbang (Pukul 07:15 WIB)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✍️ PESAN GURU PEMBIMBING BK:
"Kerjasama orang tua dalam membimbing anak di rumah sangat baik. Terus berikan dukungan belajar yang positif."
        """.trimIndent()

        AlertDialog.Builder(this)
            .setTitle("🕊️ Monitoring Karakter & Perilaku")
            .setMessage(behaviorMsg)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private var cachedLetters: List<com.school.smartcbt.data.model.OfficialLetterDto> = emptyList()
    private var lastNotifiedLetterId: String? = null

    private fun checkNewOfficialLetters() {
        ApiClient.getClient(this).getParentOfficialLetters().enqueue(object : Callback<com.school.smartcbt.data.model.ParentLettersResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.ParentLettersResponse>, response: Response<com.school.smartcbt.data.model.ParentLettersResponse>) {
                val letters = response.body()?.letters
                if (!letters.isNullOrEmpty()) {
                    cachedLetters = letters
                    val latest = letters[0]

                    // Jika ada surat baru yang belum pernah dinotifikasikan
                    if (lastNotifiedLetterId != latest.id) {
                        lastNotifiedLetterId = latest.id
                        val childName = binding.tvChildName.text.toString().ifEmpty { "Anak Anda" }
                        val letterIntent = Intent(this@ParentMainActivity, ParentLettersActivity::class.java).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                            putExtra(ParentLettersActivity.EXTRA_STUDENT_ID, currentStudentId)
                            putExtra(ParentLettersActivity.EXTRA_STUDENT_NAME, binding.tvChildName.text.toString())
                            putExtra(ParentLettersActivity.EXTRA_CLASS_NAME, binding.tvChildClass.text.toString())
                        }
                        com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                            this@ParentMainActivity,
                            "📩 Surat Resmi Sekolah Baru!",
                            "Untuk Wali Murid $childName: ${latest.title} (${latest.letterNo})",
                            "SMP Negeri 1 Boyolangu",
                            targetIntent = letterIntent
                        )
                    }
                    binding.btnViewOfficialLetters.text = "📜 Surat Resmi Sekolah (${letters.size} Berkas)"
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.ParentLettersResponse>, t: Throwable) {
                // Fallback safe
            }
        })
    }

    private fun showOfficialLettersDialog() {
        ApiClient.getClient(this).getParentOfficialLetters().enqueue(object : Callback<com.school.smartcbt.data.model.ParentLettersResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.ParentLettersResponse>, response: Response<com.school.smartcbt.data.model.ParentLettersResponse>) {
                val letters = response.body()?.letters
                if (letters.isNullOrEmpty()) {
                    AlertDialog.Builder(this@ParentMainActivity)
                        .setTitle("📜 Surat Resmi & Edaran Sekolah")
                        .setMessage("Belum ada surat edaran resmi yang ditujukan untuk orang tua / kelas ini.")
                        .setPositiveButton("Tutup", null)
                        .show()
                    return
                }

                cachedLetters = letters
                val letterTitles = letters.map { letter ->
                    val targetInfo = when (letter.targetType) {
                        "ALL" -> "👥 Semua Siswa"
                        "GRADE" -> "🎓 Tingkat ${letter.targetValue}"
                        "CLASS" -> "🏫 Kelas ${letter.targetValue}"
                        else -> "👤 Khusus Personal"
                    }
                    val confirmStatus = if (letter.isConfirmed == true) "✅ [SUDAH DIBACA & DISETUJUI]" else "⚠️ [MENUNGGU KONFIRMASI ORANG TUA]"
                    "📄 ${letter.title}\nNomor: ${letter.letterNo} • $targetInfo\nStatus: $confirmStatus"
                }.toTypedArray()

                AlertDialog.Builder(this@ParentMainActivity)
                    .setTitle("📜 Surat Resmi & Edaran Orang Tua (${letters.size})")
                    .setItems(letterTitles) { _, which ->
                        val selected = letters[which]
                        showSingleLetterDetail(selected)
                    }
                    .setNegativeButton("Tutup", null)
                    .show()
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.ParentLettersResponse>, t: Throwable) {
                Toast.makeText(this@ParentMainActivity, "Gagal memuat arsip surat: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showSingleLetterDetail(letter: com.school.smartcbt.data.model.OfficialLetterDto) {
        val targetBadge = when (letter.targetType) {
            "ALL" -> "Semua Orang Tua Siswa"
            "GRADE" -> "Orang Tua Siswa Tingkat ${letter.targetValue}"
            "CLASS" -> "Orang Tua Siswa Kelas ${letter.targetValue}"
            else -> "Pemberitahuan Khusus Pribadi"
        }

        val confirmStatusText = if (letter.isConfirmed == true) {
            "✅ TELAH DIBACA & DISETUJUI OLEH ORANG TUA/WALI\n🕒 Tanggal: ${letter.confirmedAt ?: "-"}"
        } else {
            "⚠️ BELUM DIKONFIRMASI (Mohon konfirmasi persetujuan di bawah ini)"
        }

        val detailMsg = """
🏛️ SMP NEGERI 1 BOYOLANGU
Jl. Ki Mangunsarkoro No. 101, Tulungagung
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 Nomor Surat: ${letter.letterNo}
🎯 Ditujukan Kepada: $targetBadge
✍️ Pengirim: ${letter.senderName ?: "Tata Usaha & Kepala Sekolah"}

📖 PERIHAL:
${letter.title}

📝 RINGKASAN ISI:
${letter.content}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Berkas Lampiran: Dokumen PDF Resmi (${letter.fileSize ?: "320 KB"})
📊 Status Konfirmasi:
$confirmStatusText
        """.trimIndent()

        val builder = AlertDialog.Builder(this)
            .setTitle("📜 Lembar Surat Resmi Sekolah")
            .setMessage(detailMsg)
            .setPositiveButton("⬇️ Unduh PDF") { _, _ ->
                Toast.makeText(this, "Mengunduh ${letter.letterNo} ke direktori Download HP...", Toast.LENGTH_LONG).show()
            }

        if (letter.isConfirmed != true) {
            builder.setNeutralButton("✍️ Setujui & Konfirmasi") { _, _ ->
                submitLetterConfirmation(letter.id)
            }
        }

        builder.setNegativeButton("Tutup", null)
        builder.show()
    }

    private fun submitLetterConfirmation(letterId: String) {
        val studentId = currentStudentId ?: ""
        val payload = mapOf("studentId" to studentId, "notes" to "Telah dibaca dan disetujui wali murid melalui APK Android")

        ApiClient.getClient(this).confirmOfficialLetter(letterId, payload).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful) {
                    Toast.makeText(this@ParentMainActivity, "✅ Konfirmasi persetujuan surat berhasil disimpan ke sekolah!", Toast.LENGTH_LONG).show()
                    loadParentData(currentStudentId)
                } else {
                    Toast.makeText(this@ParentMainActivity, "Gagal mengonfirmasi surat: " + response.message(), Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@ParentMainActivity, "Kesalahan koneksi: " + t.message, Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showDetailedAttendanceDialog(childId: String?) {
        Toast.makeText(this, "Memuat grafik visual presensi ananda...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getDetailedAttendance(childId).enqueue(object : Callback<com.school.smartcbt.data.model.AttendanceDetailResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.AttendanceDetailResponse>, response: Response<com.school.smartcbt.data.model.AttendanceDetailResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val childName = binding.tvChildName.text.toString().ifEmpty { "Ananda" }
                    val childClass = binding.tvChildClass.text.toString().ifEmpty { "VII-A" }
                    renderAttendanceAnalyticsModal(response.body()!!, childName, childClass)
                } else {
                    Toast.makeText(this@ParentMainActivity, "Gagal memuat rekap absensi anak dari server", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.AttendanceDetailResponse>, t: Throwable) {
                Toast.makeText(this@ParentMainActivity, "Koneksi ke server gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderAttendanceAnalyticsModal(data: com.school.smartcbt.data.model.AttendanceDetailResponse, studentName: String, className: String) {
        val dialogView = layoutInflater.inflate(com.school.smartcbt.R.layout.dialog_attendance_analytics, null)
        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .create()

        val tvDialogTitle = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvAttDialogTitle)
        val tvDialogSubtitle = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvAttDialogSubtitle)
        val tvRatePercent = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvAttendanceRatePercent)
        val tvStatusTitle = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvAttendanceStatusTitle)
        val tvEffectiveDays = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvEffectiveDaysCount)

        val tvBarPresentVal = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvBarPresentVal)
        val pbPresent = dialogView.findViewById<ProgressBar>(com.school.smartcbt.R.id.pbPresent)

        val tvBarLateVal = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvBarLateVal)
        val pbLate = dialogView.findViewById<ProgressBar>(com.school.smartcbt.R.id.pbLate)

        val tvBarSickVal = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvBarSickVal)
        val pbSick = dialogView.findViewById<ProgressBar>(com.school.smartcbt.R.id.pbSick)

        val tvBarPermVal = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvBarPermVal)
        val pbPerm = dialogView.findViewById<ProgressBar>(com.school.smartcbt.R.id.pbPerm)

        val tvBarAlpaVal = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvBarAlpaVal)
        val pbAlpa = dialogView.findViewById<ProgressBar>(com.school.smartcbt.R.id.pbAlpa)

        val containerLogs = dialogView.findViewById<LinearLayout>(com.school.smartcbt.R.id.containerAttendanceLogs)
        val btnClose = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnCloseAttDialog)

        val stats = data.stats
        val total = if (stats.totalEffectiveDays > 0) stats.totalEffectiveDays else 1

        tvDialogTitle.text = "📊 Rekap Presensi $studentName"
        tvDialogSubtitle.text = "$className • Pantauan Orang Tua"
        tvRatePercent.text = stats.attendanceRate
        tvEffectiveDays.text = "Total ${stats.totalEffectiveDays} Hari Sekolah Efektif"

        val rateNum = stats.attendanceRate.replace("%", "").trim().toDoubleOrNull() ?: 90.0
        tvStatusTitle.text = when {
            rateNum >= 95.0 -> "🏆 Kedisiplinan Sangat Baik (Teladan)"
            rateNum >= 85.0 -> "👍 Kedisiplinan Baik (Sesuai Standar)"
            rateNum >= 75.0 -> "⚠️ Perlu Pendampingan Belajar Rumah"
            else -> "🚨 Peringatan: Ketidakhadiran Cukup Tinggi"
        }

        // 1. Hadir
        val pctHadir = (stats.hadir * 100) / total
        tvBarPresentVal.text = "${stats.hadir} Hari ($pctHadir%)"
        pbPresent.progress = pctHadir

        // 2. Terlambat
        val pctLate = (stats.terlambat * 100) / total
        tvBarLateVal.text = "${stats.terlambat} Hari ($pctLate%)"
        pbLate.progress = pctLate

        // 3. Sakit
        val pctSick = (stats.sakit * 100) / total
        tvBarSickVal.text = "${stats.sakit} Hari ($pctSick%)"
        pbSick.progress = pctSick

        // 4. Izin
        val pctPerm = (stats.izin * 100) / total
        tvBarPermVal.text = "${stats.izin} Hari ($pctPerm%)"
        pbPerm.progress = pctPerm

        // 5. Alpa
        val pctAlpa = (stats.alpa * 100) / total
        tvBarAlpaVal.text = "${stats.alpa} Hari ($pctAlpa%)"
        pbAlpa.progress = pctAlpa

        // Populate Log List
        containerLogs.removeAllViews()
        val density = resources.displayMetrics.density

        if (data.history.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada catatan absensi harian yang tersimpan."
                setTextColor(android.graphics.Color.parseColor("#64748B"))
                textSize = 12f
                setPadding(0, (12 * density).toInt(), 0, (12 * density).toInt())
            }
            containerLogs.addView(tvEmpty)
        } else {
            data.history.take(15).forEach { h ->
                val card = androidx.cardview.widget.CardView(this).apply {
                    radius = 10 * density
                    cardElevation = 1.5f * density
                    useCompatPadding = true
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        bottomMargin = (8 * density).toInt()
                    }
                }

                val cardInner = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                    val p = (12 * density).toInt()
                    setPadding(p, p, p, p)
                }

                val colInfo = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }

                val tvDayDate = TextView(this).apply {
                    text = "${h.dayName}, ${h.date}"
                    setTextColor(android.graphics.Color.parseColor("#0F172A"))
                    textSize = 13f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                }
                colInfo.addView(tvDayDate)

                val tvTimes = TextView(this).apply {
                    val inTime = h.gateInTime ?: "-"
                    val outTime = h.gateOutTime ?: "-"
                    text = "🚪 Masuk: $inTime  •  🏠 Pulang: $outTime"
                    setTextColor(android.graphics.Color.parseColor("#64748B"))
                    textSize = 11f
                    setPadding(0, (2 * density).toInt(), 0, 0)
                }
                colInfo.addView(tvTimes)

                cardInner.addView(colInfo)

                // Status Chip
                val stUpper = h.status.uppercase()
                val (badgeText, badgeBg, badgeTextCol) = when {
                    stUpper.contains("LIBUR") || stUpper.contains("MINGGU") -> Triple("LIBUR", "#F1F5F9", "#475569")
                    stUpper == "PRESENT" || stUpper == "HADIR" -> Triple("HADIR", "#D1FAE5", "#065F46")
                    stUpper == "LATE" || stUpper == "TERLAMBAT" -> Triple("TERLAMBAT", "#FEF3C7", "#92400E")
                    stUpper == "SICK" || stUpper == "SAKIT" -> Triple("SAKIT", "#FFE4E6", "#9F1239")
                    stUpper == "PERMISSION" || stUpper == "IZIN" -> Triple("IZIN", "#E0F2FE", "#0369A1")
                    else -> Triple("ALPA", "#FEE2E2", "#991B1B")
                }

                val tvBadge = TextView(this).apply {
                    text = badgeText
                    setTextColor(android.graphics.Color.parseColor(badgeTextCol))
                    setBackgroundColor(android.graphics.Color.parseColor(badgeBg))
                    textSize = 10f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    val hPad = (10 * density).toInt()
                    val vPad = (4 * density).toInt()
                    setPadding(hPad, vPad, hPad, vPad)
                }
                cardInner.addView(tvBadge)

                card.addView(cardInner)
                containerLogs.addView(card)
            }
        }

        btnClose.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    // =========================================================================
    // MODUL E-KANTIN SEHAT SISWA & KONTROL ORANG TUA
    // =========================================================================
    private var cachedParentCanteenWallet: org.json.JSONObject? = null

    private fun checkCanteenFeatureStatus() {
        ApiClient.getClient(this).getMobileModules().enqueue(object : retrofit2.Callback<com.school.smartcbt.data.model.EvotingModuleConfigResponse> {
            override fun onResponse(call: retrofit2.Call<com.school.smartcbt.data.model.EvotingModuleConfigResponse>, response: retrofit2.Response<com.school.smartcbt.data.model.EvotingModuleConfigResponse>) {
                val isEkantinActive = response.body()?.data?.modules?.get("ekantin")?.isActive ?: false
                runOnUiThread {
                    binding.cardParentCanteenOverview.visibility = if (isEkantinActive) View.VISIBLE else View.GONE
                }
            }
            override fun onFailure(call: retrofit2.Call<com.school.smartcbt.data.model.EvotingModuleConfigResponse>, t: Throwable) {
                runOnUiThread {
                    binding.cardParentCanteenOverview.visibility = View.GONE
                }
            }
        })
    }

    private fun loadParentCanteenData() {
        val childId = currentStudentId
        ApiClient.getClient(this).getStudentWallet(childId).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, response: Response<com.school.smartcbt.data.model.BasicResponse>) {
                if (response.isSuccessful) {
                    try {
                        val raw = response.body()
                        val gson = com.google.gson.Gson()
                        val jsonObj = org.json.JSONObject(gson.toJson(raw))
                        cachedParentCanteenWallet = jsonObj

                        val wallet = jsonObj.optJSONObject("wallet")
                        val balance = wallet?.optInt("balance", 25000) ?: 25000
                        val dailyLimit = wallet?.optInt("dailyLimit", 20000) ?: 20000
                        val remaining = wallet?.optInt("remainingLimit", 9000) ?: 9000

                        binding.tvParentCanteenBalance.text = "Rp " + java.text.DecimalFormat("#,###").format(balance)
                        binding.tvParentCanteenDailyLimit.text = "Batas: Rp ${java.text.DecimalFormat("#,###").format(dailyLimit)} / Hari • Sisa: Rp ${java.text.DecimalFormat("#,###").format(remaining)}"
                    } catch (e: Exception) {
                        binding.tvParentCanteenBalance.text = "Rp 25.000"
                    }
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {
                binding.tvParentCanteenBalance.text = "Rp 25.000"
            }
        })
    }

    private fun showParentSetDailyLimitDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(16))
        }

        val tvInfo = TextView(this).apply {
            text = "Atur batas maksimal belanja harian anak di kantin sekolah untuk menjaga pola jajan sehat:"
            textSize = 12.5f
            setTextColor(Color.parseColor("#334155"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        root.addView(tvInfo)

        val etLimit = EditText(this).apply {
            hint = "Nominal batas belanja (Cth: 20000)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText("20000")
            textSize = 14f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
            layoutParams = lp
        }
        root.addView(etLimit)

        // Tombol Cepat Nominal
        val rowQuick = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
        }
        val quicks = listOf(15000, 20000, 30000)
        for (q in quicks) {
            val btnQ = Button(this).apply {
                text = "Rp ${java.text.DecimalFormat("#,###").format(q)}"
                textSize = 10f
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#F1F5F9"))
                setTextColor(Color.parseColor("#334155"))
                setOnClickListener { etLimit.setText(q.toString()) }
                val lp = LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                    marginEnd = dp(3)
                }
                layoutParams = lp
            }
            rowQuick.addView(btnQ)
        }
        root.addView(rowQuick)

        AlertDialog.Builder(this)
            .setTitle("⚙️ Batas Belanja Harian Anak")
            .setView(root)
            .setPositiveButton("Simpan Batas") { _, _ ->
                val limitVal = etLimit.text.toString().trim().toIntOrNull() ?: 20000
                val progress = android.app.ProgressDialog(this).apply {
                    setMessage("Menyimpan batas jajan...")
                    show()
                }
                ApiClient.getClient(this).parentSetDailyLimit(mapOf<String, Any?>("studentId" to currentStudentId, "dailyLimit" to limitVal)).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
                    override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, response: Response<com.school.smartcbt.data.model.BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            Toast.makeText(this@ParentMainActivity, "✅ Batas belanja berhasil disimpan!", Toast.LENGTH_SHORT).show()
                            loadParentCanteenData()
                        } else {
                            Toast.makeText(this@ParentMainActivity, "Gagal mengubah batas belanja", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@ParentMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showParentTopUpDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(16))
        }

        val tvInfo = TextView(this).apply {
            text = "Isi saldo uang saku digital anak via Payment Gateway Midtrans (QRIS, E-Wallet, Virtual Account):\nNominal Rp10.000 - Rp100.000"
            textSize = 12.5f
            setTextColor(Color.parseColor("#334155"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        root.addView(tvInfo)

        val etAmount = EditText(this).apply {
            hint = "Pilih / Ketik Nominal Top Up"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText("20000")
            textSize = 14f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
        }
        root.addView(etAmount)

        // Tombol Cepat Nominal Baris 1
        val rowQuick1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(6)
            }
            layoutParams = lp
        }
        val quicks1 = listOf(10000, 20000, 30000)
        for (q in quicks1) {
            val btnQ = Button(this).apply {
                text = "Rp ${java.text.DecimalFormat("#,###").format(q)}"
                textSize = 10f
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#EFF6FF"))
                setTextColor(Color.parseColor("#1D4ED8"))
                setOnClickListener { etAmount.setText(q.toString()) }
                val lp = LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                    marginEnd = dp(3)
                }
                layoutParams = lp
            }
            rowQuick1.addView(btnQ)
        }
        root.addView(rowQuick1)

        // Tombol Cepat Nominal Baris 2
        val rowQuick2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
        }
        val quicks2 = listOf(50000, 75000, 100000)
        for (q in quicks2) {
            val btnQ = Button(this).apply {
                text = "Rp ${java.text.DecimalFormat("#,###").format(q)}"
                textSize = 10f
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#EFF6FF"))
                setTextColor(Color.parseColor("#1D4ED8"))
                setOnClickListener { etAmount.setText(q.toString()) }
                val lp = LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                    marginEnd = dp(3)
                }
                layoutParams = lp
            }
            rowQuick2.addView(btnQ)
        }
        root.addView(rowQuick2)

        AlertDialog.Builder(this)
            .setTitle("➕ Top Up Saldo via Midtrans")
            .setView(root)
            .setPositiveButton("💳 Bayar Sekarang") { _, _ ->
                val amt = etAmount.text.toString().trim().toIntOrNull() ?: 20000
                val validAmounts = listOf(10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000)
                if (!validAmounts.contains(amt)) {
                    Toast.makeText(this@ParentMainActivity, "Nominal tidak valid. Pilih antara Rp10.000 - Rp100.000", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                if (currentStudentId.isNullOrEmpty()) {
                    Toast.makeText(this@ParentMainActivity, "Data siswa belum dipilih", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                createMidtransTopup(currentStudentId!!, amt)
            }
            .setNeutralButton("📜 Riwayat") { _, _ ->
                showParentTopupHistoryDialog()
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun createMidtransTopup(studentId: String, amount: Int) {
        val progress = android.app.ProgressDialog(this).apply {
            setMessage("Menyiapkan transaksi Midtrans Snap...")
            setCancelable(false)
            show()
        }

        val request = CanteenTopupCreateRequest(studentId = studentId, amount = amount)
        ApiClient.getClient(this).createCanteenTopup(request).enqueue(object : Callback<CanteenTopupCreateResponse> {
            override fun onResponse(call: Call<CanteenTopupCreateResponse>, response: Response<CanteenTopupCreateResponse>) {
                progress.dismiss()
                val body = response.body()
                if (response.isSuccessful && body != null && body.success && body.data != null) {
                    val orderId = body.data.orderId
                    val snapUrl = body.data.snapUrl

                    if (!snapUrl.isNullOrEmpty()) {
                        try {
                            val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(snapUrl))
                            startActivity(browserIntent)
                        } catch (e: Exception) {
                            Toast.makeText(this@ParentMainActivity, "Gagal membuka browser: ${e.message}", Toast.LENGTH_LONG).show()
                        }

                        AlertDialog.Builder(this@ParentMainActivity)
                            .setTitle("💳 Menunggu Pembayaran")
                            .setMessage("Halaman Midtrans telah terbuka di browser.\nSilakan bayar menggunakan QRIS, GoPay, OVO, ShopeePay, atau Virtual Account.\n\nSistem akan memverifikasi otomatis setelah Anda membayar.")
                            .setPositiveButton("Cek Status Transaksi") { _, _ ->
                                checkManualTopupStatus(orderId)
                            }
                            .setNegativeButton("Tutup", null)
                            .show()

                        startPollingTopupStatus(orderId)
                    } else {
                        Toast.makeText(this@ParentMainActivity, "URL pembayaran tidak ditemukan", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    val errMsg = body?.message ?: "Gagal membuat transaksi pembayaran"
                    Toast.makeText(this@ParentMainActivity, errMsg, Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<CanteenTopupCreateResponse>, t: Throwable) {
                progress.dismiss()
                Toast.makeText(this@ParentMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun checkManualTopupStatus(orderId: String) {
        val progress = android.app.ProgressDialog(this).apply {
            setMessage("Memverifikasi status transaksi...")
            show()
        }
        ApiClient.getClient(this).checkCanteenTopupStatus(orderId).enqueue(object : Callback<CanteenTopupStatusResponse> {
            override fun onResponse(call: Call<CanteenTopupStatusResponse>, response: Response<CanteenTopupStatusResponse>) {
                progress.dismiss()
                val data = response.body()?.data
                if (response.isSuccessful && data != null) {
                    when (data.status) {
                        "SUCCESS" -> {
                            val formattedAmt = java.text.DecimalFormat("#,###").format(data.amount)
                            val formattedBal = java.text.DecimalFormat("#,###").format(data.currentBalance)
                            AlertDialog.Builder(this@ParentMainActivity)
                                .setTitle("✅ Pembayaran Berhasil!")
                                .setMessage("Top-up Rp $formattedAmt berhasil dikonfirmasi.\n\nSaldo E-Kantin anak sekarang: Rp $formattedBal")
                                .setPositiveButton("Lihat Saldo") { _, _ -> loadParentCanteenData() }
                                .show()
                            loadParentCanteenData()
                        }
                        "PENDING" -> {
                            Toast.makeText(this@ParentMainActivity, "⏳ Menunggu konfirmasi pembayaran dari Midtrans...", Toast.LENGTH_SHORT).show()
                        }
                        else -> {
                            Toast.makeText(this@ParentMainActivity, "Status transaksi: ${data.status}", Toast.LENGTH_SHORT).show()
                        }
                    }
                } else {
                    Toast.makeText(this@ParentMainActivity, "Gagal memeriksa status pembayaran", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<CanteenTopupStatusResponse>, t: Throwable) {
                progress.dismiss()
                Toast.makeText(this@ParentMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun startPollingTopupStatus(orderId: String, attempt: Int = 1) {
        if (attempt > 20) return

        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            ApiClient.getClient(this@ParentMainActivity).checkCanteenTopupStatus(orderId).enqueue(object : Callback<CanteenTopupStatusResponse> {
                override fun onResponse(call: Call<CanteenTopupStatusResponse>, response: Response<CanteenTopupStatusResponse>) {
                    val data = response.body()?.data
                    if (response.isSuccessful && data != null) {
                        if (data.status == "SUCCESS") {
                            val formattedAmt = java.text.DecimalFormat("#,###").format(data.amount)
                            val formattedBal = java.text.DecimalFormat("#,###").format(data.currentBalance)
                            AlertDialog.Builder(this@ParentMainActivity)
                                .setTitle("🎉 Pembayaran Sukses!")
                                .setMessage("Saldo Rp $formattedAmt berhasil ditambahkan ke akun anak.\n\nTotal Saldo: Rp $formattedBal")
                                .setPositiveButton("OK") { _, _ -> loadParentCanteenData() }
                                .show()
                            loadParentCanteenData()
                        } else if (data.status == "PENDING") {
                            startPollingTopupStatus(orderId, attempt + 1)
                        }
                    }
                }

                override fun onFailure(call: Call<CanteenTopupStatusResponse>, t: Throwable) {
                    // Abaikan error polling
                }
            })
        }, 3000)
    }

    private fun showParentTopupHistoryDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val progress = android.app.ProgressDialog(this).apply {
            setMessage("Memuat riwayat top-up online...")
            show()
        }

        ApiClient.getClient(this).getCanteenTopupHistory(studentId = currentStudentId).enqueue(object : Callback<CanteenTopupHistoryResponse> {
            override fun onResponse(call: Call<CanteenTopupHistoryResponse>, response: Response<CanteenTopupHistoryResponse>) {
                progress.dismiss()
                val items = response.body()?.data ?: emptyList()

                val root = LinearLayout(this@ParentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(16), dp(16), dp(16), dp(16))
                }

                if (items.isEmpty()) {
                    val tvEmpty = TextView(this@ParentMainActivity).apply {
                        text = "Belum ada riwayat transaksi top-up online via Midtrans."
                        textSize = 13f
                        gravity = Gravity.CENTER
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(0, dp(24), 0, dp(24))
                    }
                    root.addView(tvEmpty)
                } else {
                    val scroll = ScrollView(this@ParentMainActivity).apply {
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(350))
                    }
                    val listLayout = LinearLayout(this@ParentMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                    }

                    for (item in items) {
                        val card = LinearLayout(this@ParentMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            val bg = GradientDrawable().apply {
                                cornerRadius = dp(8).toFloat()
                                setColor(Color.parseColor("#FFFFFF"))
                                setStroke(dp(1), Color.parseColor("#E2E8F0"))
                            }
                            background = bg
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = dp(8)
                            }
                            layoutParams = lp
                        }

                        val rowTop = LinearLayout(this@ParentMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            weightSum = 1f
                        }
                        val tvOrder = TextView(this@ParentMainActivity).apply {
                            text = item.orderId
                            textSize = 11f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor("#334155"))
                            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.65f)
                            layoutParams = lp
                        }
                        val tvStatus = TextView(this@ParentMainActivity).apply {
                            text = item.midtransStatus
                            textSize = 10f
                            typeface = Typeface.DEFAULT_BOLD
                            setPadding(dp(6), dp(2), dp(6), dp(2))
                            val (bgColor, txtColor) = when (item.midtransStatus) {
                                "SUCCESS" -> Pair("#DCFCE7", "#15803D")
                                "PENDING" -> Pair("#FEF9C3", "#A16207")
                                "EXPIRED" -> Pair("#F1F5F9", "#64748B")
                                else -> Pair("#FEE2E2", "#B91C1C")
                            }
                            val badgeBg = GradientDrawable().apply {
                                cornerRadius = dp(4).toFloat()
                                setColor(Color.parseColor(bgColor))
                            }
                            background = badgeBg
                            setTextColor(Color.parseColor(txtColor))
                            gravity = Gravity.CENTER
                            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.35f)
                            layoutParams = lp
                        }
                        rowTop.addView(tvOrder)
                        rowTop.addView(tvStatus)
                        card.addView(rowTop)

                        val formattedAmt = java.text.DecimalFormat("#,###").format(item.amount)
                        val tvAmt = TextView(this@ParentMainActivity).apply {
                            text = "Rp $formattedAmt • Metode: ${item.paymentMethod ?: "Midtrans"}"
                            textSize = 12f
                            setTextColor(Color.parseColor("#0F172A"))
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = dp(4)
                            }
                            layoutParams = lp
                        }
                        card.addView(tvAmt)

                        val dateStr = item.paidAt ?: item.createdAt ?: "-"
                        val tvDate = TextView(this@ParentMainActivity).apply {
                            text = "Waktu: $dateStr"
                            textSize = 10.5f
                            setTextColor(Color.parseColor("#94A3B8"))
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = dp(2)
                            }
                            layoutParams = lp
                        }
                        card.addView(tvDate)

                        listLayout.addView(card)
                    }

                    scroll.addView(listLayout)
                    root.addView(scroll)
                }

                AlertDialog.Builder(this@ParentMainActivity)
                    .setTitle("📜 Riwayat Top-Up Online")
                    .setView(root)
                    .setPositiveButton("Tutup", null)
                    .show()
            }

            override fun onFailure(call: Call<CanteenTopupHistoryResponse>, t: Throwable) {
                progress.dismiss()
                Toast.makeText(this@ParentMainActivity, "Gagal memuat riwayat: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showParentCanteenAnalyticsDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val progress = android.app.ProgressDialog(this).apply {
            setMessage("Memuat laporan dan grafik pengeluaran...")
            show()
        }

        ApiClient.getClient(this).getCanteenAnalytics(currentStudentId).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, response: Response<com.school.smartcbt.data.model.BasicResponse>) {
                progress.dismiss()
                val dataObj = try {
                    val gson = com.google.gson.Gson()
                    org.json.JSONObject(gson.toJson(response.body()))
                } catch (e: Exception) {
                    org.json.JSONObject()
                }

                val totalSpent = dataObj.optInt("weeklyTotalSpent", 64000)
                val chartArr = dataObj.optJSONArray("chartData")

                val root = LinearLayout(this@ParentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.parseColor("#F8FAFC"))
                }

                // Header
                val header = LinearLayout(this@ParentMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(16), dp(14), dp(16), dp(14))
                    val grad = android.graphics.drawable.GradientDrawable(
                        android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                        intArrayOf(Color.parseColor("#0284C7"), Color.parseColor("#0369A1"))
                    )
                    background = grad
                }
                val tvTitle = TextView(this@ParentMainActivity).apply {
                    text = "📊 Laporan & Grafik Uang Saku 6 Hari"
                    setTextColor(Color.WHITE)
                    textSize = 14f
                    setTypeface(null, Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                val btnClose = TextView(this@ParentMainActivity).apply {
                    text = "✕"
                    setTextColor(Color.WHITE)
                    textSize = 18f
                    setTypeface(null, Typeface.BOLD)
                    setPadding(dp(8), dp(4), dp(8), dp(4))
                }
                header.addView(tvTitle)
                header.addView(btnClose)
                root.addView(header)

                val sv = ScrollView(this@ParentMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(480))
                }
                val content = LinearLayout(this@ParentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(16), dp(14), dp(16), dp(16))
                }

                // Total Pengeluaran Card
                val cardSummary = androidx.cardview.widget.CardView(this@ParentMainActivity).apply {
                    radius = dp(12).toFloat()
                    setCardBackgroundColor(Color.WHITE)
                    cardElevation = dp(2).toFloat()
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(14)
                    }
                    layoutParams = lp
                }
                val innerSum = LinearLayout(this@ParentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), dp(12), dp(14), dp(12))
                }
                innerSum.addView(TextView(this@ParentMainActivity).apply {
                    text = "TOTAL PENGELUARAN 6 HARI (SENIN - SABTU)"
                    textSize = 10.5f
                    setTextColor(Color.parseColor("#64748B"))
                    setTypeface(null, Typeface.BOLD)
                })
                innerSum.addView(TextView(this@ParentMainActivity).apply {
                    text = "Rp " + java.text.DecimalFormat("#,###").format(totalSpent)
                    textSize = 20f
                    setTextColor(Color.parseColor("#0F172A"))
                    setTypeface(null, Typeface.BOLD)
                })
                cardSummary.addView(innerSum)
                content.addView(cardSummary)

                // Grafik Batang 6 Hari (Senin - Sabtu)
                val tvChartTitle = TextView(this@ParentMainActivity).apply {
                    text = "📈 Grafik Pengeluaran Harian (Senin s/d Sabtu)"
                    textSize = 12.5f
                    setTextColor(Color.parseColor("#1E293B"))
                    setTypeface(null, Typeface.BOLD)
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(8)
                    }
                    layoutParams = lp
                }
                content.addView(tvChartTitle)

                val cardChart = androidx.cardview.widget.CardView(this@ParentMainActivity).apply {
                    radius = dp(12).toFloat()
                    setCardBackgroundColor(Color.WHITE)
                    cardElevation = dp(2).toFloat()
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(14)
                    }
                    layoutParams = lp
                }
                val innerChart = LinearLayout(this@ParentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), dp(12), dp(14), dp(12))
                }

                val days = listOf("Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu")
                val defaultAmounts = listOf(12000, 15000, 8000, 14000, 10000, 5000)
                val maxAmount = 20000

                for (i in days.indices) {
                    val dayName = days[i]
                    val amt = if (chartArr != null && i < chartArr.length()) {
                        chartArr.optJSONObject(i)?.optInt("amount", defaultAmounts[i]) ?: defaultAmounts[i]
                    } else defaultAmounts[i]

                    val rowBar = LinearLayout(this@ParentMainActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = dp(6)
                        }
                        layoutParams = lp
                    }
                    val tvDay = TextView(this@ParentMainActivity).apply {
                        text = dayName
                        textSize = 11.5f
                        setTextColor(Color.parseColor("#475569"))
                        layoutParams = LinearLayout.LayoutParams(dp(50), LinearLayout.LayoutParams.WRAP_CONTENT)
                    }
                    rowBar.addView(tvDay)

                    val barTrack = LinearLayout(this@ParentMainActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor("#F1F5F9"))
                            cornerRadius = dp(4).toFloat()
                        }
                        val lp = LinearLayout.LayoutParams(0, dp(14), 1f).apply {
                            marginEnd = dp(8)
                        }
                        layoutParams = lp
                    }
                    val barFillRatio = Math.min(1.0, Math.max(0.05, amt.toDouble() / maxAmount.toDouble()))
                    val barFill = View(this@ParentMainActivity).apply {
                        val colorCode = if (amt > 15000) "#EF4444" else if (amt > 10000) "#F59E0B" else "#10B981"
                        background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor(colorCode))
                            cornerRadius = dp(4).toFloat()
                        }
                        val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, barFillRatio.toFloat())
                        layoutParams = lp
                    }
                    val barEmpty = View(this@ParentMainActivity).apply {
                        val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, (1.0 - barFillRatio).toFloat())
                        layoutParams = lp
                    }
                    barTrack.addView(barFill)
                    barTrack.addView(barEmpty)
                    rowBar.addView(barTrack)

                    val tvAmt = TextView(this@ParentMainActivity).apply {
                        text = "Rp ${java.text.DecimalFormat("#,###").format(amt)}"
                        textSize = 10.5f
                        setTextColor(Color.parseColor("#1E293B"))
                        setTypeface(null, Typeface.BOLD)
                    }
                    rowBar.addView(tvAmt)
                    innerChart.addView(rowBar)
                }
                cardChart.addView(innerChart)
                content.addView(cardChart)

                // Alokasi Kategori Belanja Sehat
                val tvCatTitle = TextView(this@ParentMainActivity).apply {
                    text = "🥗 Alokasi Kategori Konsumsi Anak"
                    textSize = 12.5f
                    setTextColor(Color.parseColor("#1E293B"))
                    setTypeface(null, Typeface.BOLD)
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(8)
                    }
                    layoutParams = lp
                }
                content.addView(tvCatTitle)

                val categories = listOf(
                    Triple("Makanan Sehat & Nasi", "55%", "Rp 35.000"),
                    Triple("Minuman Segar / Susu / Buah", "30%", "Rp 19.000"),
                    Triple("Kudapan & Roti Gandum", "15%", "Rp 10.000")
                )
                for (cat in categories) {
                    val rowCat = LinearLayout(this@ParentMainActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        setPadding(dp(12), dp(8), dp(12), dp(8))
                        background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.WHITE)
                            cornerRadius = dp(8).toFloat()
                        }
                        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = dp(6)
                        }
                        layoutParams = lp
                    }
                    val tvCName = TextView(this@ParentMainActivity).apply {
                        text = cat.first
                        textSize = 11.5f
                        setTextColor(Color.parseColor("#1E293B"))
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    }
                    val tvCPct = TextView(this@ParentMainActivity).apply {
                        text = "${cat.second} (${cat.third})"
                        textSize = 11.5f
                        setTextColor(Color.parseColor("#059669"))
                        setTypeface(null, Typeface.BOLD)
                    }
                    rowCat.addView(tvCName)
                    rowCat.addView(tvCPct)
                    content.addView(rowCat)
                }

                sv.addView(content)
                root.addView(sv)

                val alert = AlertDialog.Builder(this@ParentMainActivity).setView(root).create()
                btnClose.setOnClickListener { alert.dismiss() }
                alert.show()
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {
                progress.dismiss()
                Toast.makeText(this@ParentMainActivity, "Gagal memuat analitik: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun checkAndOpenBiodataForm() {
        startActivity(Intent(this, ParentBiodataActivity::class.java))
    }

    private fun showBiodataPopupDialog() {
        val density = resources.displayMetrics.density
        val dialog = Dialog(this)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val shape = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 24 * density
            }
            background = shape
            clipToOutline = true
        }

        // Header Radiant Gradient
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val headerGrad = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#1E3A8A"), Color.parseColor("#3B82F6"), Color.parseColor("#7C3AED"))
            )
            background = headerGrad
            setPadding((18 * density).toInt(), (16 * density).toInt(), (18 * density).toInt(), (16 * density).toInt())
        }

        val headerTextLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val tvHeaderBadge = TextView(this).apply {
            text = "BUKU INDUK SISWA"
            textSize = 9.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#FEF08A"))
        }

        val tvHeaderTitle = TextView(this).apply {
            text = "📋 Formulir Biodata Siswa"
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
        }

        val tvHeaderSub = TextView(this).apply {
            text = "Sinkronisasi Pangkalan Data Kesiswaan & Tata Usaha"
            textSize = 11f
            setTextColor(Color.parseColor("#E0E7FF"))
        }

        headerTextLayout.addView(tvHeaderBadge)
        headerTextLayout.addView(tvHeaderTitle)
        headerTextLayout.addView(tvHeaderSub)
        header.addView(headerTextLayout)

        val btnClose = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            val closeShape = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#33FFFFFF"))
            }
            background = closeShape
            val s = (32 * density).toInt()
            layoutParams = LinearLayout.LayoutParams(s, s)
            isClickable = true
            isFocusable = true
            setOnClickListener { dialog.dismiss() }
        }
        header.addView(btnClose)
        root.addView(header)

        // Scrollable Body
        val bodyScroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val bodyLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((18 * density).toInt(), (14 * density).toInt(), (18 * density).toInt(), (14 * density).toInt())
        }

        // Live Status Container
        val statusContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = GradientDrawable().apply {
                setColor(Color.parseColor("#F1F5F9"))
                cornerRadius = 14 * density
            }
            background = bg
            setPadding((14 * density).toInt(), (10 * density).toInt(), (14 * density).toInt(), (10 * density).toInt())
        }

        val tvStatusTitle = TextView(this).apply {
            text = "⏳ Memeriksa Status Formulir di Server TU..."
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#475569"))
        }

        val tvStatusDesc = TextView(this).apply {
            text = "Menghubungkan ke layanan verifikasi berkas SMPN 1 Boyolangu"
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, (2 * density).toInt(), 0, 0)
        }

        statusContainer.addView(tvStatusTitle)
        statusContainer.addView(tvStatusDesc)
        bodyLayout.addView(statusContainer)

        // Summary of 5 Steps
        val tvSectionTitle = TextView(this).apply {
            text = "5 Tahapan Pengisian Biodata Lengkap:"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#1E293B"))
            setPadding(0, (14 * density).toInt(), 0, (6 * density).toInt())
        }
        bodyLayout.addView(tvSectionTitle)

        fun createStepRow(num: String, title: String, subtitle: String): View {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, (6 * density).toInt(), 0, (6 * density).toInt())
            }
            val numTv = TextView(this).apply {
                text = num
                textSize = 11f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                val circle = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.parseColor("#2563EB"))
                }
                background = circle
                val s = (24 * density).toInt()
                layoutParams = LinearLayout.LayoutParams(s, s).apply { marginEnd = (10 * density).toInt() }
            }
            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val tTv = TextView(this).apply {
                text = title
                textSize = 12f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#1E293B"))
            }
            val sTv = TextView(this).apply {
                text = subtitle
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
            }
            info.addView(tTv)
            info.addView(sTv)
            row.addView(numTv)
            row.addView(info)
            return row
        }

        bodyLayout.addView(createStepRow("1", "Data Pribadi Siswa", "Nama lengkap, NISN, NIK, Tempat/Tgl Lahir, Agama"))
        bodyLayout.addView(createStepRow("2", "Alamat Domisili", "Alamat tempat tinggal, RT/RW, Dusun, Desa, Kecamatan"))
        bodyLayout.addView(createStepRow("3", "Data Orang Tua Kandung", "Nama, Status, Pekerjaan & Penghasilan Ayah/Ibu terpisah, No WA"))
        bodyLayout.addView(createStepRow("4", "Kesejahteraan / Bantuan", "Pilihan punya/tidak kartu KIP, PKH, KKS, dsb & unggah foto kartu"))
        bodyLayout.addView(createStepRow("5", "Unggah Berkas Asli (Foto/Scan)", "Foto asli Kartu Keluarga (KK), Akta Kelahiran & Kartu Bantuan"))

        bodyScroll.addView(bodyLayout)
        root.addView(bodyScroll)

        // Asynchronously fetch status for the badge
        ApiClient.getClient(this).getMyBiodataSubmission().enqueue(object : Callback<MyBiodataResponse> {
            override fun onResponse(call: Call<MyBiodataResponse>, response: Response<MyBiodataResponse>) {
                if (response.isSuccessful) {
                    val status = response.body()?.submission?.status ?: "DRAFT"
                    val isLocked = response.body()?.isLocked == true || status == "APPROVED"
                    when {
                        status == "APPROVED" || isLocked -> {
                            val bg = GradientDrawable().apply {
                                setColor(Color.parseColor("#D1FAE5"))
                                cornerRadius = 14 * density
                            }
                            statusContainer.background = bg
                            tvStatusTitle.text = "✅ STATUS: DISETUJUI & DISINKRONKAN TU"
                            tvStatusTitle.setTextColor(Color.parseColor("#065F46"))
                            tvStatusDesc.text = "Data biodata telah sah diverifikasi oleh Petugas TU dan tersimpan permanen di Buku Induk."
                            tvStatusDesc.setTextColor(Color.parseColor("#047857"))
                        }
                        status == "REJECTED" -> {
                            val bg = GradientDrawable().apply {
                                setColor(Color.parseColor("#FEE2E2"))
                                cornerRadius = 14 * density
                            }
                            statusContainer.background = bg
                            tvStatusTitle.text = "❌ STATUS: PERLU PERBAIKAN FORMULIR"
                            tvStatusTitle.setTextColor(Color.parseColor("#991B1B"))
                            val reason = response.body()?.submission?.rejectionReason ?: "Harap perbaiki data dan lampirkan dokumen asli yang jelas."
                            tvStatusDesc.text = "Catatan TU: $reason"
                            tvStatusDesc.setTextColor(Color.parseColor("#B91C1C"))
                        }
                        status == "PENDING" -> {
                            val bg = GradientDrawable().apply {
                                setColor(Color.parseColor("#FEF3C7"))
                                cornerRadius = 14 * density
                            }
                            statusContainer.background = bg
                            tvStatusTitle.text = "⏳ STATUS: MENUNGGU VERIFIKASI STAF TU"
                            tvStatusTitle.setTextColor(Color.parseColor("#92400E"))
                            tvStatusDesc.text = "Data telah terkirim dan berada di antrean verifikasi Staf Tata Usaha SMPN 1 Boyolangu."
                            tvStatusDesc.setTextColor(Color.parseColor("#B45309"))
                        }
                        else -> {
                            val bg = GradientDrawable().apply {
                                setColor(Color.parseColor("#EFF6FF"))
                                cornerRadius = 14 * density
                            }
                            statusContainer.background = bg
                            tvStatusTitle.text = "📝 STATUS: FORMULIR BELUM DIKIRIM"
                            tvStatusTitle.setTextColor(Color.parseColor("#1E40AF"))
                            tvStatusDesc.text = "Silakan isi lengkap data ananda dan kirimkan ke TU melalui tombol di bawah."
                            tvStatusDesc.setTextColor(Color.parseColor("#1D4ED8"))
                        }
                    }
                }
            }

            override fun onFailure(call: Call<MyBiodataResponse>, t: Throwable) {
                // Keep default info
            }
        })

        // Bottom Actions Row
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding((18 * density).toInt(), (12 * density).toInt(), (18 * density).toInt(), (16 * density).toInt())
            setBackgroundColor(Color.WHITE)
        }

        val btnCancel = Button(this).apply {
            text = "Tutup"
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
            val bg = GradientDrawable().apply {
                setColor(Color.parseColor("#F1F5F9"))
                cornerRadius = 12 * density
            }
            background = bg
            val lp = LinearLayout.LayoutParams(0, (48 * density).toInt(), 1f).apply { marginEnd = (8 * density).toInt() }
            layoutParams = lp
            setOnClickListener { dialog.dismiss() }
        }

        val btnOpenForm = Button(this).apply {
            text = "🚀 Buka Formulir"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setBackgroundResource(R.drawable.bg_btn_glowing_submit)
            val lp = LinearLayout.LayoutParams(0, (48 * density).toInt(), 1.6f)
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
                startActivity(Intent(this@ParentMainActivity, ParentBiodataActivity::class.java))
            }
        }

        bottomBar.addView(btnCancel)
        bottomBar.addView(btnOpenForm)
        root.addView(bottomBar)

        dialog.setContentView(root)
        dialog.window?.apply {
            setLayout((resources.displayMetrics.widthPixels * 0.92).toInt(), WindowManager.LayoutParams.WRAP_CONTENT)
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        }
        dialog.show()
    }

    private fun checkAndOpenPpdbForm() {
        val density = resources.displayMetrics.density
        ApiClient.getClient(this).getPpdbStatus().enqueue(object : Callback<PpdbStatusResponse> {
            override fun onResponse(call: Call<PpdbStatusResponse>, response: Response<PpdbStatusResponse>) {
                val isEnabled = response.body()?.ppdbEnabled == true
                if (!isEnabled) {
                    AlertDialog.Builder(this@ParentMainActivity)
                        .setTitle("ℹ️ PPDB Online Belum Dibuka")
                        .setMessage("Penerimaan Peserta Didik Baru (PPDB) dan pengisian Formulir Data Diri Siswa Baru akan dibuka pada Tahun Ajaran Baru sesuai jadwal resmi sekolah.\n\nFitur ini saat ini dinonaktifkan oleh administrator sekolah.")
                        .setPositiveButton("Tutup", null)
                        .show()
                } else {
                    showPpdbRegistrationDialog()
                }
            }

            override fun onFailure(call: Call<PpdbStatusResponse>, t: Throwable) {
                Toast.makeText(this@ParentMainActivity, "Gagal mengecek status PPDB: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showPpdbRegistrationDialog() {
        val density = resources.displayMetrics.density
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val tvDesc = TextView(this).apply {
            text = "Silakan lengkapi formulir pendaftaran dan biodata diri calon siswa baru. Data ini terhubung langsung ke database kesiswaan SMPN 1 Boyolangu."
            setTextColor(Color.parseColor("#475569"))
            textSize = 12f
            setPadding(0, 0, 0, (12 * density).toInt())
        }
        root.addView(tvDesc)

        fun createField(label: String, hint: String): Pair<TextView, EditText> {
            val tv = TextView(this).apply {
                text = label
                setTextColor(Color.parseColor("#1E293B"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, (6 * density).toInt(), 0, (2 * density).toInt())
            }
            val et = EditText(this).apply {
                this.hint = hint
                textSize = 13f
                setBackgroundResource(android.R.drawable.edit_text)
                setPadding((10 * density).toInt(), (8 * density).toInt(), (10 * density).toInt(), (8 * density).toInt())
            }
            root.addView(tv)
            root.addView(et)
            return Pair(tv, et)
        }

        val (_, etName) = createField("1. Nama Lengkap Siswa Baru *", "Contoh: MERRI ROSA AMELIA")
        val (_, etNisn) = createField("2. NISN Siswa (10 Digit) *", "Contoh: 0081234567")

        val tvGender = TextView(this).apply {
            text = "3. Jenis Kelamin *"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (6 * density).toInt(), 0, (2 * density).toInt())
        }
        val spGender = Spinner(this).apply {
            adapter = ArrayAdapter(this@ParentMainActivity, android.R.layout.simple_spinner_dropdown_item, arrayOf("Laki-laki", "Perempuan"))
        }
        root.addView(tvGender)
        root.addView(spGender)

        val (_, etBirthPlace) = createField("4. Tempat Lahir *", "Contoh: Tulungagung")
        val (_, etBirthDate) = createField("5. Tanggal Lahir (YYYY-MM-DD) *", "Contoh: 2012-05-18")

        val tvReligion = TextView(this).apply {
            text = "6. Agama *"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (6 * density).toInt(), 0, (2 * density).toInt())
        }
        val spReligion = Spinner(this).apply {
            adapter = ArrayAdapter(this@ParentMainActivity, android.R.layout.simple_spinner_dropdown_item, arrayOf("Islam", "Kristen Protestan", "Katolik", "Hindu", "Buddha", "Konghucu"))
        }
        root.addView(tvReligion)
        root.addView(spReligion)

        val (_, etAddress) = createField("7. Alamat Lengkap Domisili *", "Contoh: Jl. Ki Mangunsarkoro No. 12, Boyolangu")
        val (_, etPrevSchool) = createField("8. Asal Sekolah SD/MI *", "Contoh: SDN 1 Boyolangu")
        val (_, etParentName) = createField("9. Nama Orang Tua / Wali *", "Contoh: Budi Santoso")
        val (_, etPhone) = createField("10. No. WhatsApp / HP Orang Tua *", "Contoh: 081234567890")
        val (_, etJob) = createField("11. Pekerjaan Orang Tua *", "Contoh: Wiraswasta / PNS")

        val tvClass = TextView(this).apply {
            text = "12. Pilihan Kelas Rombel Awal"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (6 * density).toInt(), 0, (2 * density).toInt())
        }
        val spClass = Spinner(this).apply {
            adapter = ArrayAdapter(this@ParentMainActivity, android.R.layout.simple_spinner_dropdown_item, arrayOf("VII-A", "VII-B", "VII-C", "VII-D", "VII-E", "VII-F", "VII-G", "VII-H"))
        }
        root.addView(tvClass)
        root.addView(spClass)

        val scroll = ScrollView(this).apply {
            addView(root)
        }

        AlertDialog.Builder(this)
            .setTitle("📝 Pendaftaran & Data Diri Siswa Baru (PPDB)")
            .setView(scroll)
            .setPositiveButton("Kirim Pendaftaran") { _, _ ->
                val name = etName.text.toString().trim()
                val nisn = etNisn.text.toString().trim()
                val birthPlace = etBirthPlace.text.toString().trim()
                val birthDate = etBirthDate.text.toString().trim()
                val address = etAddress.text.toString().trim()
                val prevSchool = etPrevSchool.text.toString().trim()
                val parentName = etParentName.text.toString().trim()
                val phone = etPhone.text.toString().trim()
                val job = etJob.text.toString().trim()
                val gender = spGender.selectedItem.toString()
                val religion = spReligion.selectedItem.toString()
                val targetClass = spClass.selectedItem.toString()

                if (name.isEmpty() || nisn.isEmpty() || address.isEmpty()) {
                    Toast.makeText(this@ParentMainActivity, "Harap lengkapi nama, NISN, dan alamat siswa", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val req = PpdbRegisterRequest(
                    name = name,
                    nisn = nisn,
                    gender = gender,
                    birthPlace = birthPlace,
                    birthDate = birthDate,
                    religion = religion,
                    address = address,
                    previousSchool = prevSchool,
                    parentName = parentName,
                    parentPhone = phone,
                    parentJob = job,
                    targetClass = targetClass
                )

                ApiClient.getClient(this@ParentMainActivity).registerPpdb(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            AlertDialog.Builder(this@ParentMainActivity)
                                .setTitle("✅ Pendaftaran Berhasil")
                                .setMessage("Alhamdulillah! Data diri calon siswa $name (NISN: $nisn) telah berhasil didaftarkan ke sistem PPDB Online SMPN 1 Boyolangu.\n\nData telah tersimpan di database sekolah dan siap untuk verifikasi berkas administrasi.")
                                .setPositiveButton("Selesai", null)
                                .show()
                        } else {
                            Toast.makeText(this@ParentMainActivity, "Gagal mendaftar: ${response.message()}", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@ParentMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)
}