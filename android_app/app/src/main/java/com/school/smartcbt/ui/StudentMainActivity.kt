package com.school.smartcbt.ui
import java.util.Date
import java.util.Calendar
import java.util.Locale
import java.text.SimpleDateFormat

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.media.MediaPlayer
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import com.school.smartcbt.R
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.oned.Code128Writer
import com.school.smartcbt.ExamActivity
import com.school.smartcbt.ScannerActivity
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityStudentMainBinding
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

data class HomeworkQuestionItem(
    val id: Int,
    val text: String,
    val options: List<String> = emptyList(),
    val correctOption: Int? = null,
    val points: Double = 10.0
)

class StudentMainActivity : AppCompatActivity() {

    private var cachedStudentUserDto: StudentUserDto? = null
    private var selectedHomeworkFileBase64: String? = null
    private var selectedHomeworkFileName: String? = null
    private var onHomeworkFileSelectedCallback: ((String) -> Unit)? = null
    private var allHomeworkList: List<HomeworkDto> = emptyList()
    private var selectedHwTab: Int = 0 // 0: Semua, 1: Belum Kumpul, 2: Sudah Kumpul

    private val serverHeartbeatHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val serverHeartbeatRunnable = object : Runnable {
        override fun run() {
            checkServerConnection(showToast = false)
            loadActiveClassSession()
            loadTodayAttendanceSummary()
            checkStudentNotifications()
            serverHeartbeatHandler.postDelayed(this, 20000)
        }
    }

    private val pickHomeworkFileLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            val uri = result.data?.data
            if (uri != null) {
                try {
                    val contentResolver = applicationContext.contentResolver
                    var fileName = "lampiran_tugas"
                    var fileSize: Long = 0L
                    contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) {
                            val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                            if (nameIndex != -1) {
                                fileName = cursor.getString(nameIndex)
                            }
                            val sizeIndex = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
                            if (sizeIndex != -1) {
                                fileSize = cursor.getLong(sizeIndex)
                            }
                        }
                    }

                    val isVideo = fileName.endsWith(".mp4", true) || fileName.endsWith(".mov", true) || fileName.endsWith(".mkv", true) || fileName.endsWith(".3gp", true)
                    val maxAllowedBytes = if (isVideo) 50 * 1024 * 1024L else 12 * 1024 * 1024L
                    val maxAllowedMb = if (isVideo) 50 else 12

                    if (fileSize > maxAllowedBytes) {
                        Toast.makeText(this, "Ukuran berkas terlalu besar (${fileSize / 1024 / 1024} MB)! Maksimal $maxAllowedMb MB.", Toast.LENGTH_LONG).show()
                        return@registerForActivityResult
                    }

                    val inputStream = contentResolver.openInputStream(uri)
                    val bytes = inputStream?.readBytes()
                    inputStream?.close()
                    if (bytes != null) {
                        if (bytes.size > maxAllowedBytes) {
                            Toast.makeText(this, "Ukuran berkas terlalu besar! Maksimal $maxAllowedMb MB.", Toast.LENGTH_LONG).show()
                            return@registerForActivityResult
                        }
                        selectedHomeworkFileBase64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                        selectedHomeworkFileName = fileName
                        onHomeworkFileSelectedCallback?.invoke(fileName)
                    }
                } catch (e: Exception) {
                    Toast.makeText(this, "Gagal membaca file: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private val pickAvatarLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            val uri = result.data?.data
            if (uri != null) {
                try {
                    val inputStream = contentResolver.openInputStream(uri)
                    val bitmap = android.graphics.BitmapFactory.decodeStream(inputStream)
                    inputStream?.close()
                    if (bitmap != null) {
                        val maxDim = 600
                        val scaled = if (bitmap.width > maxDim || bitmap.height > maxDim) {
                            val ratio = bitmap.width.toFloat() / bitmap.height.toFloat()
                            val w = if (ratio > 1) maxDim else (maxDim * ratio).toInt()
                            val h = if (ratio > 1) (maxDim / ratio).toInt() else maxDim
                            android.graphics.Bitmap.createScaledBitmap(bitmap, w, h, true)
                        } else bitmap
                        val baos = java.io.ByteArrayOutputStream()
                        scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, baos)
                        val base64 = "data:image/jpeg;base64," + android.util.Base64.encodeToString(baos.toByteArray(), android.util.Base64.NO_WRAP)

                        Toast.makeText(this, "Mengunggah foto profil baru...", Toast.LENGTH_SHORT).show()
                        ApiClient.getClient(this).updateStudentAvatar(UpdateAvatarRequest(imageBase64 = base64)).enqueue(object : Callback<BasicResponse> {
                            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                if (response.isSuccessful) {
                                    Toast.makeText(this@StudentMainActivity, "✅ Foto profil berhasil diubah!", Toast.LENGTH_SHORT).show()
                                    val rounded = getCircularBitmap(scaled)
                                    binding.ivProfileAvatar.setImageBitmap(rounded)
                                    binding.ivHomeAvatar.setImageBitmap(rounded)

                                    // Simpan ke SessionManager secara persisten
                                    sessionManager.saveProfilePicUrl(base64)
                                    if (cachedStudentUserDto != null) {
                                        cachedStudentUserDto = cachedStudentUserDto?.copy(profilePicUrl = base64)
                                        try {
                                            sessionManager.saveStudentProfileJson(com.google.gson.Gson().toJson(cachedStudentUserDto))
                                        } catch (e: Exception) {}
                                    }

                                    // Refresh dari server untuk mendapatkan URL permanen
                                    setupProfileData()
                                } else {
                                    Toast.makeText(this@StudentMainActivity, "Gagal mengunggah foto profil", Toast.LENGTH_SHORT).show()
                                }
                            }
                            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                            }
                        })
                    }
                } catch (e: Exception) {
                    Toast.makeText(this, "Gagal memproses foto: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private val pickEFileLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            val uri = result.data?.data
            if (uri != null) {
                promptUploadEFileDialog(uri)
            }
        }
    }

    private val wifiCardScannerLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            val token = result.data?.getStringExtra(com.school.smartcbt.ScannerActivity.EXTRA_SCANNED_TOKEN)
            if (!token.isNullOrBlank()) {
                activateWifiWithCardToken(token)
            } else {
                Toast.makeText(this, "Barcode kartu pelajar tidak terdeteksi", Toast.LENGTH_SHORT).show()
            }
        }
    }


    private lateinit var binding: ActivityStudentMainBinding
    private lateinit var sessionManager: SessionManager
    private var currentCounselorTeacher: String? = null
    private var currentTabIndex: Int = 0
    private var backPressedTime: Long = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityStudentMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        com.school.smartcbt.utils.DialogHelper.applyDynamicFooter(this)
        sessionManager = SessionManager(this)
        com.school.smartcbt.utils.TtsVoiceHelper.init(this)

        // STRICT ROLE LOCK: Pastikan hanya Siswa yang berada di StudentMainActivity
        val userRole = sessionManager.getRole().uppercase()
        if (userRole == "TEACHER" || userRole == "GURU") {
            startActivity(Intent(this, TeacherMainActivity::class.java))
            finish()
            return
        } else if (userRole == "PARENT" || userRole == "ORANGTUA") {
            startActivity(Intent(this, ParentMainActivity::class.java))
            finish()
            return
        }

        // Penanganan Navigasi Tombol Back: Kembali ke Beranda (Tab 0) sebelum keluar
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (currentTabIndex != 0) {
                    switchTab(0)
                } else {
                    if (backPressedTime + 2000 > System.currentTimeMillis()) {
                        finish()
                    } else {
                        Toast.makeText(this@StudentMainActivity, "Tekan sekali lagi untuk keluar dari aplikasi", Toast.LENGTH_SHORT).show()
                        backPressedTime = System.currentTimeMillis()
                    }
                }
            }
        })

        setupProfileData()
        setupBottomNav()
        setupGridMenu()
        setupNoticeBoard()
        setupEFilesListeners()
        setupHomeworkTabs()
        setupListeners()
        loadHomeworks()
        loadTodayAttendanceSummary()
        loadActiveClassSession()
        checkEvotingModuleStatus()

        // Cek Pembaruan OTA
        val isUpdateTriggered = intent?.getBooleanExtra("EXTRA_TRIGGER_UPDATE", false) == true
        if (isUpdateTriggered) {
            intent?.removeExtra("EXTRA_TRIGGER_UPDATE")
            com.school.smartcbt.utils.AppUpdateChecker.resetState()
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        } else {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
        }

        // Jadwalkan sinkronisasi dan transfer berkas remote AirDroid
        try {
            com.school.smartcbt.service.DeviceSyncBackgroundService.startService(this)
            com.school.smartcbt.service.FileSyncWorker.schedulePeriodicSync(this)
            com.school.smartcbt.service.FileSyncWorker.runOnce(this)
        } catch (e: Exception) {}

        // Cek Notifikasi Siswa (Izin Disetujui & Rekap Manual Ketua Kelas)
        checkStudentNotifications()

        // Sinkronisasi Token Push Notifikasi Firebase (FCM)
        try {
            com.school.smartcbt.utils.FcmHelper.syncFcmToken(this)
        } catch (e: Exception) {}

        // Verifikasi izin akses berkas untuk sinkronisasi remote file manager
        checkStoragePermissionsAndSync()
    }

    override fun onResume() {
        super.onResume()
        com.school.smartcbt.utils.DialogHelper.dismissMandatoryAllFilesDialogIfGranted(this)
        checkAllFilesAccess()
        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        serverHeartbeatHandler.removeCallbacks(serverHeartbeatRunnable)
        serverHeartbeatHandler.post(serverHeartbeatRunnable)
        loadActiveClassSession()
        loadTodayAttendanceSummary()
        loadHomeworks()
        checkStudentNotifications()
        updateOfflineAttendanceBadge()
        checkEvotingModuleStatus()
        com.school.smartcbt.utils.OfflineAttendanceManager.clearPendingScans(this)
        try {
            if (intent?.getBooleanExtra("EXTRA_TRIGGER_UPDATE", false) == true) {
                intent?.removeExtra("EXTRA_TRIGGER_UPDATE")
                com.school.smartcbt.utils.AppUpdateChecker.resetState()
                com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
            } else {
                com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
            }
            com.school.smartcbt.service.DeviceSyncBackgroundService.startService(this)
        } catch (e: Exception) {}
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent?.getBooleanExtra("EXTRA_TRIGGER_UPDATE", false) == true) {
            intent.removeExtra("EXTRA_TRIGGER_UPDATE")
            com.school.smartcbt.utils.AppUpdateChecker.resetState()
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }
    }

    override fun onPause() {
        super.onPause()
        serverHeartbeatHandler.removeCallbacks(serverHeartbeatRunnable)
    }

    override fun onDestroy() {
        super.onDestroy()
        serverHeartbeatHandler.removeCallbacks(serverHeartbeatRunnable)
    }


    private fun setupProfileData() {
        val name = sessionManager.getName()
        val className = sessionManager.getClassName()
        val nisn = sessionManager.getNisn()

        // Home View - Default clean state
        binding.tvHomeStudentName.text = name
        binding.tvHomeBadgeClass.text = "Kelas " + className
        binding.tvHomeWaliKelas.text = "👨‍🏫 Wali Kelas: -"
        binding.tvHomeGuruBk.text = "🕊️ Guru BK: -"

        // Profile Tab View
        binding.tvProfName.text = name
        binding.tvProfNisn.text = "NISN: " + nisn
        binding.tvProfNisn.setOnClickListener {
            showDigitalMemberCardDialog()
        }
        binding.ivProfileAvatar?.setOnClickListener {
            showDigitalMemberCardDialog()
        }
        val savedAvatar = sessionManager.getProfilePicUrl()
        if (!savedAvatar.isNullOrEmpty()) {
            loadAvatarIntoImageView(savedAvatar, binding.ivHomeAvatar)
            loadAvatarIntoImageView(savedAvatar, binding.ivProfileAvatar)
        }
        binding.tvProfClass.text = "Kelas: " + className
        binding.tvProfWaliKelas.text = "-"
        binding.tvProfGuruBk.text = "-"
        binding.tvProfBlood.text = "Golongan Darah [UKS]"
        binding.tvProfBlood.setOnClickListener {
            showStudentHealthDialog()
        }
        binding.tvProfPoints.text = "0 Poin Pelanggaran (Aman)"
        binding.tvProfPoints.setOnClickListener {
            showBkPointHistoryDialog()
        }

        try {
            val pInfo = packageManager.getPackageInfo(packageName, 0)
            binding.tvAppVersionStatus.text = "Versi saat ini: v${pInfo.versionName} (Build ${pInfo.versionCode}) • Ketuk untuk cek rilis"
        } catch (e: Exception) {
            binding.tvAppVersionStatus.text = "Versi saat ini: v${com.school.smartcbt.BuildConfig.VERSION_NAME} (Build ${com.school.smartcbt.BuildConfig.VERSION_CODE}) • Ketuk untuk cek rilis terbaru"
        }

        // Coba muat data profil dari cache lokal terlebih dahulu jika ada
        val cachedJson = sessionManager.getStudentProfileJson()
        if (!cachedJson.isNullOrEmpty()) {
            try {
                val cached = com.google.gson.Gson().fromJson(cachedJson, com.school.smartcbt.data.model.StudentUserDto::class.java)
                if (cached != null) {
                    cachedStudentUserDto = cached
                    applyStudentProfileToViews(cached)
                }
            } catch (e: Exception) {}
        }

        // Fetch Live Profile from Server (Sync Wali Kelas & Guru BK from Portal)
        ApiClient.getClient(this).getStudentProfile().enqueue(object : Callback<com.school.smartcbt.data.model.StudentProfileResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.StudentProfileResponse>, response: Response<com.school.smartcbt.data.model.StudentProfileResponse>) {
                val p = response.body()?.user ?: response.body()?.data
                if (p != null) {
                    cachedStudentUserDto = p
                    try {
                        val gson = com.google.gson.Gson()
                        sessionManager.saveStudentProfileJson(gson.toJson(p))
                    } catch (e: Exception) {}

                    if (!p.profilePicUrl.isNullOrEmpty()) {
                        sessionManager.saveProfilePicUrl(p.profilePicUrl)
                    }
                    applyStudentProfileToViews(p)
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.StudentProfileResponse>, t: Throwable) {
                // Safe fallback
            }
        })
    }

    private fun applyStudentProfileToViews(p: com.school.smartcbt.data.model.StudentUserDto) {
        val wk = p.homeroomTeacher?.trim()
        if (!wk.isNullOrEmpty()) {
            binding.tvHomeWaliKelas.text = "👨‍🏫 Wali Kelas: $wk"
            binding.tvProfWaliKelas.text = wk
            binding.tvCommitteeHomeroom.text = wk
        } else {
            binding.tvHomeWaliKelas.text = "👨‍🏫 Wali Kelas: -"
            binding.tvProfWaliKelas.text = "-"
        }
        if (!p.className.isNullOrEmpty()) {
            binding.tvCommitteeClassNameBadge.text = "Kelas " + p.className
        }

        // Sinkronisasi susunan pengurus kelas riil dari server
        binding.tvCommitteeLeader.text = if (!p.classLeaderName.isNullOrBlank() && p.classLeaderName != "-") p.classLeaderName else "-"
        binding.tvCommitteeViceLeader.text = if (!p.classViceLeaderName.isNullOrBlank() && p.classViceLeaderName != "-") p.classViceLeaderName else "-"
        binding.tvCommitteeSecretary.text = if (!p.classSecretaryName.isNullOrBlank() && p.classSecretaryName != "-") p.classSecretaryName else "-"
        binding.tvCommitteeTreasurer.text = if (!p.classTreasurerName.isNullOrBlank() && p.classTreasurerName != "-") p.classTreasurerName else "-"
        binding.cardStudentClassCommittee.visibility = View.VISIBLE

        val myName = sessionManager.getName().trim().lowercase()
        val isOfficerByName = (!p.classLeaderName.isNullOrBlank() && p.classLeaderName.trim().lowercase() == myName) ||
                (!p.classViceLeaderName.isNullOrBlank() && p.classViceLeaderName.trim().lowercase() == myName) ||
                (!p.classSecretaryName.isNullOrBlank() && p.classSecretaryName.trim().lowercase() == myName) ||
                (!p.classTreasurerName.isNullOrBlank() && p.classTreasurerName.trim().lowercase() == myName)

        val isCommittee = (p.isClassCommittee ?: false) || sessionManager.isClassOfficer() || isOfficerByName
        val rawPos = p.committeePosition ?: sessionManager.getClassRole()
        val committeePos = if (!rawPos.isNullOrBlank() && rawPos != "-") rawPos else {
            when {
                !p.classLeaderName.isNullOrBlank() && p.classLeaderName.trim().lowercase() == myName -> "Ketua Kelas"
                !p.classViceLeaderName.isNullOrBlank() && p.classViceLeaderName.trim().lowercase() == myName -> "Wakil Ketua"
                !p.classSecretaryName.isNullOrBlank() && p.classSecretaryName.trim().lowercase() == myName -> "Sekretaris"
                !p.classTreasurerName.isNullOrBlank() && p.classTreasurerName.trim().lowercase() == myName -> "Bendahara"
                else -> "Pengurus Kelas"
            }
        }
        sessionManager.setClassCommittee(isCommittee, committeePos)

        if (isCommittee) {
            binding.gridMenuGuruPiket.visibility = View.VISIBLE
            binding.layoutMenuPengurusContainer.visibility = View.VISIBLE
            binding.cardPengurusKelas.visibility = View.VISIBLE
            binding.tvPengurusKelasSubtitle.text = "👑 $committeePos"
            if (!committeePos.isNullOrBlank()) {
                binding.tvCommitteeClassNameBadge.text = "👑 $committeePos • Rekap Izin Kelas"
                binding.tvCommitteeClassNameBadge.setBackgroundColor(Color.parseColor("#FEF3C7"))
                binding.tvCommitteeClassNameBadge.setTextColor(Color.parseColor("#B45309"))
            }
            binding.tvCommitteeClassNameBadge.setOnClickListener {
                showClassOfficerApprovedLeavesDialog()
            }
        }

        val bk = p.counselorTeacher?.trim()
        if (!bk.isNullOrEmpty()) {
            currentCounselorTeacher = bk
            binding.tvHomeGuruBk.text = "🕊️ Guru BK: $bk"
            binding.tvProfGuruBk.text = bk
            binding.tvCommitteeCounselor.text = bk
        } else {
            currentCounselorTeacher = null
            binding.tvHomeGuruBk.text = "🕊️ Guru BK: -"
            binding.tvProfGuruBk.text = "-"
            binding.tvCommitteeCounselor.text = "-"
        }

        if (!p.bloodType.isNullOrEmpty()) {
            binding.tvProfBlood.text = "${p.bloodType} [Lihat UKS]"
        }
        if (p.points != null) {
            val pts = p.points
            val spStatus = when {
                pts >= 100 -> "SP 3 / Panggilan"
                pts >= 50 -> "SP 2"
                pts >= 25 -> "SP 1"
                pts > 0 -> "Pembinaan"
                else -> "Aman"
            }
            binding.tvProfPoints.text = "$pts Poin Pelanggaran ($spStatus)"
        }

        // Sinkronisasi kelas terkini
        if (!p.className.isNullOrBlank()) {
            sessionManager.saveClassName(p.className)
            binding.tvHomeBadgeClass.text = "Kelas " + p.className
            binding.tvProfClass.text = "Kelas: " + p.className
        }

        // Muat foto profil siswa dari portal/server
        if (!p.profilePicUrl.isNullOrEmpty()) {
            loadAvatarIntoImageView(p.profilePicUrl, binding.ivHomeAvatar)
            loadAvatarIntoImageView(p.profilePicUrl, binding.ivProfileAvatar)
        }
    }

    private fun loadAvatarIntoImageView(rawUrl: String?, targetView: ImageView) {
        if (rawUrl.isNullOrEmpty()) {
            targetView.setImageResource(com.school.smartcbt.R.drawable.ic_default_avatar)
            return
        }

        // Cek jika avatar berupa Base64 (data URI atau string base64)
        if (rawUrl.startsWith("data:image") || (rawUrl.length > 200 && !rawUrl.startsWith("http") && !rawUrl.contains("/"))) {
            try {
                val cleanBase64 = if (rawUrl.contains(",")) rawUrl.substringAfter(",") else rawUrl
                val decodedBytes = android.util.Base64.decode(cleanBase64, android.util.Base64.DEFAULT)
                val bitmap = android.graphics.BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                if (bitmap != null) {
                    val rounded = getCircularBitmap(bitmap)
                    targetView.setImageBitmap(rounded)
                    return
                }
            } catch (e: Exception) {
                // Lanjut coba via URL jika parsing Base64 gagal
            }
        }

        val baseUrl = ApiClient.getBaseServerUrl(this).trimEnd('/')
        var fullUrl = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            rawUrl
        } else {
            baseUrl + "/" + rawUrl.trimStart('/')
        }

        // Normalisasi HTTPS untuk domain sekolah agar tidak terkena redirect 301
        if (fullUrl.contains("cbt.smpn1boyolangu.my.id") && fullUrl.startsWith("http://")) {
            fullUrl = fullUrl.replace("http://", "https://")
        }

        Thread {
            try {
                val client = okhttp3.OkHttpClient.Builder()
                    .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .build()

                val request = okhttp3.Request.Builder()
                    .url(fullUrl)
                    .header("User-Agent", "SmartSchoolCBT-Android")
                    .build()

                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    val input = response.body()?.byteStream()
                    if (input != null) {
                        val bitmap = android.graphics.BitmapFactory.decodeStream(input)
                        if (bitmap != null) {
                            val rounded = getCircularBitmap(bitmap)
                            runOnUiThread {
                                targetView.setImageBitmap(rounded)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                // Fallback default avatar jika gagal load foto
            }
        }.start()
    }

    private fun getCircularBitmap(bitmap: android.graphics.Bitmap): android.graphics.Bitmap {
        val size = Math.min(bitmap.width, bitmap.height)
        val output = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(output)
        val paint = android.graphics.Paint()
        val rect = android.graphics.Rect(0, 0, size, size)
        paint.isAntiAlias = true
        canvas.drawARGB(0, 0, 0, 0)
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
        paint.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN)
        val left = (bitmap.width - size) / 2
        val top = (bitmap.height - size) / 2
        val srcRect = android.graphics.Rect(left, top, left + size, top + size)
        canvas.drawBitmap(bitmap, srcRect, rect, paint)
        return output
    }

    private fun setupGridMenu() {
        // Menu Pantau Teman Sekelas & Pengurus Kelas (Bisa diakses seluruh siswa untuk transparansi kehadiran sekelas)
        val isClassOfficer = sessionManager.isClassOfficer()
        binding.layoutMenuPengurusContainer.visibility = View.VISIBLE
        binding.cardPengurusKelas.visibility = View.VISIBLE
        val role = sessionManager.getClassRole()
        if (isClassOfficer) {
            binding.tvPengurusKelasSubtitle.text = "Role: $role • Pantau Teman & Bantu Presensi Scan Kartu"
        } else {
            binding.tvPengurusKelasSubtitle.text = "Pantau Kehadiran Teman Sekelas • Real-Time"
        }
        binding.cardPengurusKelas.setOnClickListener {
            val intent = Intent(this, PengurusKelasActivity::class.java)
            startActivity(intent)
        }

        checkPengurusKelasMenuStatus()

        // Grid 1: Ujian CBT (Buka Gerbang ExamBrowser Kiosk Mode)
        binding.gridMenuCbt.setOnClickListener {
            val intent = Intent(this, ExambroGatewayActivity::class.java)
            startActivity(intent)
        }

        // Grid 2: Tugas & Ujian (Unified Inbox: Tugas & Ulangan Harian Guru Mapel)
        binding.gridMenuTugas.setOnClickListener {
            showUnifiedInboxDialog()
        }

        // Card Ringkasan Tugas di Beranda
        binding.cardHomeHomeworkOverview.setOnClickListener {
            switchTab(1)
        }

        // Grid 3: Rekap Absensi Harian (Buka Langsung AttendanceActivity)
        binding.gridMenuAbsensi.setOnClickListener {
            startActivity(Intent(this, AttendanceActivity::class.java))
        }

        // Menu Khusus: Presensi (Mushola & KBM)
        binding.gridMenuPresensiKhusus.setOnClickListener {
            showSpecialAttendanceActionDialog()
        }

        // Menu E-Kantin (Layanan Siswa)
        binding.gridMenuEKantin.setOnClickListener {
            showStudentCanteenDialog()
        }
        loadStudentCanteenWallet()

        // Grid 4: Ruang BK / Konseling & Curhat Anti-Bullying
        binding.gridMenuBk.setOnClickListener {
            val userRole = sessionManager.getRole().uppercase()
            if (userRole == "STUDENT") {
                startActivity(Intent(this, KonselingCurhatActivity::class.java))
            } else {
                startActivity(Intent(this, BkActivity::class.java))
            }
        }

        // Grid 5: E-Library & Audit Barcode Buku
        binding.gridMenuELibrary.setOnClickListener {
            startActivity(Intent(this, LibraryActivity::class.java))
        }

        // Grid 6: Klinik UKS & Kesehatan Siswa
        binding.gridMenuUks.setOnClickListener {
            startActivity(Intent(this, UksActivity::class.java))
        }

        // Grid 7: Pesan Admin (DIHAPUS TOTAL)
        binding.gridMenuHelpdesk.visibility = View.GONE

        // Grid: Hafalan Al-Qur'an Juz 30 (Juz 'Amma)
        binding.gridMenuHafalanJuz30.setOnClickListener {
            startActivity(Intent(this, HafalanJuz30Activity::class.java))
        }

        // Grid 9: Cek Update APK Langsung dari Beranda
        binding.gridMenuUpdate.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        // Grid 10: Perizinan Siswa (Gatepass BK)
        binding.gridMenuExitPass.setOnClickListener {
            startActivity(Intent(this, ExitPassActivity::class.java))
        }

        // Grid: Cek Biodata Raport & Dapodik (Nonaktif - Digunakan Aplikasi Khusus)
        binding.gridMenuBiodataRaport.visibility = View.GONE

        // Grid 11: Panduan Aplikasi
        binding.gridMenuPanduan.setOnClickListener {
            startActivity(Intent(this, AppGuideActivity::class.java))
        }

        // Grid 13: Jadwal Guru Piket (Khusus Pengurus Kelas)
        binding.gridMenuGuruPiket.visibility = if (isClassOfficer) View.VISIBLE else View.GONE
        binding.gridMenuGuruPiket.setOnClickListener {
            openPiketDutyDialog()
        }

        // Grid 14: Ekstrakurikuler (E-Commerce Market & Full Screen)
        binding.gridMenuEkskul.setOnClickListener {
            startActivity(Intent(this, EkstrakurikulerActivity::class.java))
        }

        // Banner & Grid Modul e-Voting OSIS (Feature Toggle)
        binding.cardHomeEvoting.setOnClickListener {
            startActivity(Intent(this, EvotingActivity::class.java))
        }

        binding.gridMenuEvoting.setOnClickListener {
            startActivity(Intent(this, EvotingActivity::class.java))
        }

        binding.gridMenuWifi.setOnClickListener {
            showWifiAccessDialog()
        }
    }

    private fun openPiketDutyDialog() {
        val dialog = android.app.Dialog(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Header Toolbar Fullscreen
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1E3A8A")) // Navy Blue
            setPadding((16 * density).toInt(), (14 * density).toInt(), (16 * density).toInt(), (14 * density).toInt())
        }

        val btnBack = ImageView(this).apply {
            setImageResource(android.R.drawable.ic_menu_revert)
            setColorFilter(Color.WHITE)
            val lp = LinearLayout.LayoutParams((28 * density).toInt(), (28 * density).toInt()).apply {
                marginEnd = (12 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener { dialog.dismiss() }
        }

        val headerTextLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val tvTitle = TextView(this).apply {
            text = "📋 Jadwal Guru Piket Hari Ini"
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
        }

        val roleName = sessionManager.getClassRole()
        val cName = sessionManager.getClassName()
        val tvSub = TextView(this).apply {
            text = "Akses Khusus: $roleName Kelas $cName • SMPN 1 Boyolangu"
            textSize = 12f
            setTextColor(Color.parseColor("#93C5FD"))
        }

        headerTextLayout.addView(tvTitle)
        headerTextLayout.addView(tvSub)
        header.addView(btnBack)
        header.addView(headerTextLayout)
        root.addView(header)

        // Main content in ScrollView with layout_weight 1
        val contentScroll = androidx.core.widget.NestedScrollView(this).apply {
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            layoutParams = lp
            setPadding((16 * density).toInt(), (14 * density).toInt(), (16 * density).toInt(), (14 * density).toInt())
        }

        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        contentScroll.addView(listContainer)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat daftar guru piket aktif dari server..."
            textSize = 13f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, (20 * density).toInt(), 0, (20 * density).toInt())
        }
        listContainer.addView(tvLoading)

        // Bottom Action Buttons
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding((16 * density).toInt(), (12 * density).toInt(), (16 * density).toInt(), (16 * density).toInt())
            elevation = 10 * density
        }

        val btnApprovedLeaves = Button(this).apply {
            text = "📋 Rekap Izin & Sakit Kelas (Hari Di-Approve)"
            setBackgroundColor(Color.parseColor("#0284C7"))
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt())
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
                showClassOfficerApprovedLeavesDialog()
            }
        }

        val btnReportClass = Button(this).apply {
            text = "📢 Lapor Jam Kosong ke Guru Piket"
            setBackgroundColor(Color.parseColor("#E11D48"))
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                topMargin = (8 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
                showReportEmptyClassDialog()
            }
        }

        val btnClose = Button(this).apply {
            text = "Tutup Layar Penuh"
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            setTextColor(Color.parseColor("#334155"))
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * density).toInt()).apply {
                topMargin = (8 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener { dialog.dismiss() }
        }

        bottomBar.addView(btnApprovedLeaves)
        bottomBar.addView(btnReportClass)
        bottomBar.addView(btnClose)

        root.addView(contentScroll)
        root.addView(bottomBar)

        dialog.setContentView(root)
        dialog.show()

        // Fetch Piket Today Feed from API
        ApiClient.getClient(this).getPiketTodayFeed().enqueue(object : retrofit2.Callback<com.school.smartcbt.data.model.PiketTodayFeedResponse> {
            override fun onResponse(call: retrofit2.Call<com.school.smartcbt.data.model.PiketTodayFeedResponse>, response: retrofit2.Response<com.school.smartcbt.data.model.PiketTodayFeedResponse>) {
                val body = response.body()
                val teachers = body?.piketTeachers
                listContainer.removeAllViews()

                if (teachers.isNullOrEmpty()) {
                    val tvEmpty = TextView(this@StudentMainActivity).apply {
                        text = "ℹ️ Belum ada guru piket yang terjadwal untuk hari ini."
                        textSize = 13f
                        setTextColor(Color.parseColor("#64748B"))
                        setPadding(0, (20 * density).toInt(), 0, (20 * density).toInt())
                    }
                    listContainer.addView(tvEmpty)
                } else {
                    for (t in teachers) {
                        val card = LinearLayout(this@StudentMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val cardBg = GradientDrawable().apply {
                                setColor(Color.WHITE)
                                setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
                                cornerRadius = 12 * density
                            }
                            background = cardBg
                            setPadding((12 * density).toInt(), (10 * density).toInt(), (12 * density).toInt(), (10 * density).toInt())
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = (8 * density).toInt()
                            }
                            layoutParams = lp
                        }

                        val tvName = TextView(this@StudentMainActivity).apply {
                            text = "👨‍🏫 " + t.name
                            textSize = 14f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor("#0F172A"))
                        }

                        val tvTime = TextView(this@StudentMainActivity).apply {
                            val start = t.startTime ?: "07:00"
                            val end = t.endTime ?: "14:00"
                            text = "🕒 Jam Tugas: $start - $end WIB"
                            textSize = 11f
                            setTextColor(Color.parseColor("#475569"))
                        }

                        val tvNotes = TextView(this@StudentMainActivity).apply {
                            text = "📍 Posko: " + (t.notes ?: "Posko Piket Utama / Lobi Sekolah")
                            textSize = 11f
                            setTextColor(Color.parseColor("#059669"))
                            typeface = Typeface.DEFAULT_BOLD
                        }

                        card.addView(tvName)
                        card.addView(tvTime)
                        card.addView(tvNotes)
                        listContainer.addView(card)
                    }
                }
            }

            override fun onFailure(call: retrofit2.Call<com.school.smartcbt.data.model.PiketTodayFeedResponse>, t: Throwable) {
                listContainer.removeAllViews()
                val tvErr = TextView(this@StudentMainActivity).apply {
                    text = "⚠️ Gagal memuat data dari portal: ${t.message}"
                    textSize = 12f
                    setTextColor(Color.parseColor("#E11D48"))
                }
                listContainer.addView(tvErr)
            }
        })
    }

    private fun showWifiAccessDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = android.app.Dialog(this, android.R.style.Theme_Light_NoTitleBar_Fullscreen)
        val scrollView = ScrollView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        // Header Full Screen Berwarna
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val shape = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#1E3A8A"), Color.parseColor("#2563EB"), Color.parseColor("#0284C7"))
            )
            background = shape
            setPadding(dp(20), dp(22), dp(20), dp(22))
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }

        val btnBack = ImageView(this).apply {
            setImageResource(R.drawable.ic_arrow_back)
            setColorFilter(Color.WHITE)
            setPadding(dp(4), dp(4), dp(4), dp(4))
            val lp = LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(12) }
            layoutParams = lp
            setOnClickListener { dialog.dismiss() }
        }

        val titleContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            layoutParams = lp
        }

        val tvTitle = TextView(this).apply {
            text = "📶 Akses Wi-Fi Sekolah"
            setTextColor(Color.WHITE)
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
        }

        val tvSub = TextView(this).apply {
            text = "Bypass Hotspot MikroTik Otomatis"
            setTextColor(Color.parseColor("#BFDBFE"))
            textSize = 11.5f
        }

        titleContainer.addView(tvTitle)
        titleContainer.addView(tvSub)
        topRow.addView(btnBack)
        topRow.addView(titleContainer)
        header.addView(topRow)
        root.addView(header)

        // Body Content
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(20))
        }

        // Status Card
        val statusCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 16f * density
                setStroke(dp(1), Color.parseColor("#E2E8F0"))
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
            layoutParams = lp
        }

        val tvStatus = TextView(this).apply {
            text = "⏳ Memeriksa status akses Wi-Fi sekolah hari ini..."
            setTextColor(Color.parseColor("#475569"))
            textSize = 12.5f
            setLineSpacing(4f, 1.2f)
        }
        statusCard.addView(tvStatus)
        body.addView(statusCard)

        // Panduan 3 Langkah Cerdas
        val guideCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 16f * density
                setStroke(dp(1), Color.parseColor("#E2E8F0"))
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(16)
            }
            layoutParams = lp
        }

        val tvGuideTitle = TextView(this).apply {
            text = "💡 Cara Menghubungkan ke Wi-Fi Sekolah:"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
        }

        val tvGuide1 = TextView(this).apply {
            text = "1️⃣  Hubungkan HP Anda ke jaringan Wi-Fi sekolah yang tersedia di kelas/sekolah (abaikan bila muncul halaman login browser/hotspot)."
            setTextColor(Color.parseColor("#334155"))
            textSize = 12f
            setLineSpacing(3f, 1.15f)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
        }

        val tvGuide2 = TextView(this).apply {
            text = "2️⃣  Ketuk tombol biru 'Scan Kartu Pelajar Fisik' di bawah, lalu arahkan kamera ke barcode/QR pada Kartu Pelajar Anda."
            setTextColor(Color.parseColor("#334155"))
            textSize = 12f
            setLineSpacing(3f, 1.15f)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
        }

        val tvGuide3 = TextView(this).apply {
            text = "3️⃣  Sistem MikroTik sekolah akan otomatis mengenali perangkat Anda dan membuka akses internet tanpa perlu login hotspot lagi!"
            setTextColor(Color.parseColor("#15803D"))
            textSize = 12f
            setLineSpacing(3f, 1.15f)
            typeface = Typeface.DEFAULT_BOLD
        }

        guideCard.addView(tvGuideTitle)
        guideCard.addView(tvGuide1)
        guideCard.addView(tvGuide2)
        guideCard.addView(tvGuide3)
        body.addView(guideCard)

        // Action Buttons
        val btnScanCard = Button(this).apply {
            text = "📷 Scan Kartu Pelajar Fisik"
            setTextColor(Color.WHITE)
            val shape = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#1D4ED8"), Color.parseColor("#2563EB"))
            )
            shape.cornerRadius = 14f * density
            background = shape
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply {
                bottomMargin = dp(10)
            }
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
                val intent = Intent(this@StudentMainActivity, com.school.smartcbt.ScannerActivity::class.java).apply {
                    putExtra(com.school.smartcbt.ScannerActivity.EXTRA_SCAN_MODE, com.school.smartcbt.ScannerActivity.MODE_WIFI_CARD)
                }
                wifiCardScannerLauncher.launch(intent)
            }
        }

        val btnClose = Button(this).apply {
            text = "Tutup Layar Penuh"
            setTextColor(Color.parseColor("#475569"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            textSize = 12.5f
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44))
            layoutParams = lp
            setOnClickListener { dialog.dismiss() }
        }

        body.addView(btnScanCard)
        body.addView(btnClose)
        root.addView(body)
        scrollView.addView(root)

        dialog.setContentView(scrollView)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.show()

        // Fetch Status from server
        ApiClient.getClient(this).getStudentWifiStatus().enqueue(object : Callback<com.school.smartcbt.data.model.WifiStatusResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.WifiStatusResponse>, response: Response<com.school.smartcbt.data.model.WifiStatusResponse>) {
                val bodyResp = response.body()
                if (response.isSuccessful && bodyResp != null) {
                    val isActive = bodyResp.isActive
                    val validUntil = bodyResp.validUntil ?: "17:00 WIB"

                    if (isActive) {
                        tvStatus.text = "✅ STATUS: WI-FI TELAH AKTIF HARI INI\n\nMasa Berlaku: Hingga $validUntil\nStatus Hotspot: Bypass MikroTik Aktif\n\nPerangkat Anda telah terverifikasi resmi dan dapat langsung mengakses internet sekolah tanpa login hotspot."
                        tvStatus.setTextColor(Color.parseColor("#15803D"))
                        statusCard.background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor("#F0FDF4"))
                            cornerRadius = 16f * density
                            setStroke(dp(1), Color.parseColor("#86EFAC"))
                        }
                        btnScanCard.text = "🔄 Pindai Ulang Kartu Pelajar"
                    } else {
                        tvStatus.text = "🔒 STATUS: BELUM DIAKTIFKAN HARI INI\n\nSilakan ikuti 3 langkah mudah di bawah untuk mengaktifkan akses internet sekolah pada perangkat Anda."
                        tvStatus.setTextColor(Color.parseColor("#B45309"))
                        statusCard.background = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor("#FFFBEB"))
                            cornerRadius = 16f * density
                            setStroke(dp(1), Color.parseColor("#FDE68A"))
                        }
                    }
                }
            }
            override fun onFailure(call: Call<com.school.smartcbt.data.model.WifiStatusResponse>, t: Throwable) {
                tvStatus.text = "ℹ️ Hubungkan perangkat Anda ke jaringan Wi-Fi sekolah untuk memeriksa status koneksi lokal."
            }
        })
    }

    private fun activateWifiWithCardToken(cardBarcode: String) {
        val progressDialog = AlertDialog.Builder(this)
            .setMessage("⏳ Memverifikasi token kartu pelajar & mendaftarkan ke MikroTik sekolah...")
            .setCancelable(false)
            .show()

        val req = com.school.smartcbt.data.model.WifiActivateRequest(
            cardBarcode = cardBarcode,
            deviceMac = null,
            deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"
        )

        ApiClient.getClient(this).activateStudentWifi(req).enqueue(object : Callback<com.school.smartcbt.data.model.WifiActivateResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.WifiActivateResponse>, response: Response<com.school.smartcbt.data.model.WifiActivateResponse>) {
                progressDialog.dismiss()
                val body = response.body()
                if (response.isSuccessful && body?.success == true) {
                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("🎉 Wi-Fi Sekolah Berhasil Diaktifkan!")
                        .setMessage("✅ ${body.message ?: "Akses internet resmi sekolah telah aktif."}\n\nSSID: ${body.ssid ?: "SMPN 1 BOYOLANGU - RESMI"}\nMasa Berlaku: ${body.validUntil ?: "Hari ini s/d 17:00 WIB"}\n\nPerangkat Anda kini langsung terhubung ke internet tanpa login hotspot!")
                        .setPositiveButton("Bagus, Terima Kasih", null)
                        .show()
                } else {
                    val errMsg = body?.message ?: "Kartu pelajar tidak cocok atau tidak terdaftar di sistem sekolah."
                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("❌ Aktivasi Wi-Fi Gagal")
                        .setMessage(errMsg)
                        .setPositiveButton("Tutup", null)
                        .show()
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.WifiActivateResponse>, t: Throwable) {
                progressDialog.dismiss()
                AlertDialog.Builder(this@StudentMainActivity)
                    .setTitle("⚠️ Gangguan Koneksi")
                    .setMessage("Tidak dapat terhubung ke server sekolah: ${t.message}")
                    .setPositiveButton("Tutup", null)
                    .show()
            }
        })
    }

    private fun showEkskulDialog() {
        val dialog = AlertDialog.Builder(this).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val shape = GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 24 * density
            }
            background = shape
            setPadding((18 * density).toInt(), (18 * density).toInt(), (18 * density).toInt(), (16 * density).toInt())
        }

        // Header Title
        val tvTitle = TextView(this).apply {
            text = "🏆 Ekstrakurikuler Siswa"
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
        }

        val tvSub = TextView(this).apply {
            text = "SMPN 1 Boyolangu • Pilih menu kegiatan minat & bakat:"
            textSize = 11.5f
            setTextColor(Color.parseColor("#64748B"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (2 * density).toInt()
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val contentScroll = androidx.core.widget.NestedScrollView(this).apply {
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (340 * density).toInt())
            layoutParams = lp
        }

        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        contentScroll.addView(listContainer)

        val primaryEkskuls = listOf(
            mapOf(
                "title" to "Futsal",
                "subtitle" to "Tim Futsal Juara Spenboy",
                "schedule" to "Kamis & Sabtu, 15:30 - 17:00 WIB",
                "coach" to "Coach Andri & Bpk Rudianto, S.Pd.",
                "location" to "Lapangan Utama Sekolah",
                "iconRes" to com.school.smartcbt.R.drawable.ic_menu_ekskul,
                "accentColor" to "#2563EB",
                "desc" to "Teknik passing, dribbling, shooting, kerja sama taktik, kebugaran fisik, dan persiapan turnamen futsal pelajar tingkat kabupaten."
            ),
            mapOf(
                "title" to "Bola Basket",
                "subtitle" to "DBL Junior & Basketball Academy",
                "schedule" to "Rabu & Jumat, 15:30 - 17:00 WIB",
                "coach" to "Coach Dimas & Bpk Sugeng, S.Pd.",
                "location" to "Lapangan Basket Outdoor",
                "iconRes" to com.school.smartcbt.R.drawable.ic_menu_ekskul,
                "accentColor" to "#EA580C",
                "desc" to "Fundamental dribble, lay-up, shooting 3-point, defense zone & man-to-man, dan persiapan kompetisi liga basket junior."
            ),
            mapOf(
                "title" to "Bola Voli",
                "subtitle" to "Tim Voli Pelajar Spenboy",
                "schedule" to "Selasa & Kamis, 15:30 - 17:00 WIB",
                "coach" to "Bpk. Danang Wahyudi, S.Pd. & Ibu Endang, S.Pd.",
                "location" to "Lapangan Voli Sekolah",
                "iconRes" to com.school.smartcbt.R.drawable.ic_menu_ekskul,
                "accentColor" to "#0D9488",
                "desc" to "Teknik passing bawah & atas, servis atas mengapung, smash tajam, dan strategi rotasi formasi pertandingan POPDA."
            ),
            mapOf(
                "title" to "Pramuka",
                "subtitle" to "Gugus Depan Penggalang Spenboy",
                "schedule" to "Jumat, 13:30 - 16:00 WIB",
                "coach" to "Kak Agus & Kak Fitri",
                "location" to "Aula & Halaman Upacara",
                "iconRes" to com.school.smartcbt.R.drawable.ic_ekskul_pramuka,
                "accentColor" to "#D97706",
                "desc" to "Pioneering tongkat, semaphore & morse, survival kepanduan, penjelajahan alam, dan Lomba Tingkat (LT) III Penggalang."
            ),
            mapOf(
                "title" to "PMR Madya & Kader UKS",
                "subtitle" to "Palang Merah Remaja & Tim Medis UKS",
                "schedule" to "Senin & Kamis, 14:30 - 16:30 WIB",
                "coach" to "Ibu Nurtikawati, S.Pd. & PMI",
                "location" to "Ruang UKS Terpadu & Aula",
                "iconRes" to com.school.smartcbt.R.drawable.ic_ekskul_pmr,
                "accentColor" to "#DC2626",
                "desc" to "Pertolongan Pertama (PP), triase bencana, tandu darurat, donor darah, pencegahan penyakit, dan operasional layanan kesehatan UKS."
            ),
            mapOf(
                "title" to "Paskibra",
                "subtitle" to "Korps Paskibraka Bhayangkara",
                "schedule" to "Selasa & Sabtu, 15:00 - 17:00 WIB",
                "coach" to "Pelatih PPI & Bpk Hartono, S.Pd.",
                "location" to "Lapangan Upacara Utama",
                "iconRes" to com.school.smartcbt.R.drawable.ic_menu_ekskul,
                "accentColor" to "#4F46E5",
                "desc" to "Peraturan Baris Berbaris (PBB) baku, formasi pengibaran bendera, kedisiplinan militer halus, dan persiapan Lomba LKBB Jawa Timur."
            ),
            mapOf(
                "title" to "Rohis (Remaja Masjid)",
                "subtitle" to "Kajian Islam & Rebana Banjari",
                "schedule" to "Rabu & Jumat, 13:00 - 14:30 WIB",
                "coach" to "Ustadz Ahmad & Bpk Fauzi, S.Ag.",
                "location" to "Mushola Nurul Ilmi",
                "iconRes" to com.school.smartcbt.R.drawable.ic_menu_ekskul,
                "accentColor" to "#16A34A",
                "desc" to "Tilawah Quran, tartil, hadrah banjari, manajemen PHBI sekolah, dan pembinaan akhlak mulia remaja muslim."
            ),
            mapOf(
                "title" to "Seni Tari Tradisional",
                "subtitle" to "Tari Reog Kendang & Kreasi Nusantara",
                "schedule" to "Rabu & Sabtu, 14:00 - 16:00 WIB",
                "coach" to "Ibu Sekar, S.Sn. & Ibu Sri Rahayu",
                "location" to "Sanggar Seni Tari Lantai 2",
                "iconRes" to com.school.smartcbt.R.drawable.ic_ekskul_tari,
                "accentColor" to "#EC4899",
                "desc" to "Olah tubuh wiraga, wirama, wirasa, Tari Reog Kendang Tulungagung, tari kreasi kontemporer, dan persiapan pentas FLS2N."
            ),
            mapOf(
                "title" to "Paduan Suara (Spenboy Choir)",
                "subtitle" to "Vokal Grup & Paduan Suara Resmi",
                "schedule" to "Senin & Kamis, 14:30 - 16:00 WIB",
                "coach" to "Bpk Daniel & Ibu Retno, M.Pd.",
                "location" to "Ruang Musik Sekolah",
                "iconRes" to com.school.smartcbt.R.drawable.ic_ekskul_karawitan,
                "accentColor" to "#7C3AED",
                "desc" to "Teknik pernapasan diafragma, vokalisi, harmonisasi 4 suara (SATB), lagu perjuangan nasional, dan kompetisi paduan suara FLS2N."
            ),
            mapOf(
                "title" to "English Club",
                "subtitle" to "Speaking, Debate & Story Telling",
                "schedule" to "Selasa, 14:30 - 16:00 WIB",
                "coach" to "Ms. Clara & Ibu Nurul, S.Pd.",
                "location" to "Laboratorium Bahasa",
                "iconRes" to com.school.smartcbt.R.drawable.ic_menu_ekskul,
                "accentColor" to "#0284C7",
                "desc" to "Public speaking, English debate championship, story telling, spelling bee, dan communicative fun activities."
            ),
            mapOf(
                "title" to "KIR (Kelompok Ilmiah Remaja)",
                "subtitle" to "Riset Sains & Karya Tulis Ilmiah",
                "schedule" to "Rabu, 14:30 - 16:00 WIB",
                "coach" to "Bpk Tri, M.Si. & Ibu Dwi Astuti",
                "location" to "Laboratorium IPA & Komputer",
                "iconRes" to com.school.smartcbt.R.drawable.ic_menu_ekskul,
                "accentColor" to "#059669",
                "desc" to "Metodologi penelitian sains & sosial, eksperimen biologi/fisika terapan, penulisan karya ilmiah, dan lomba peneliti muda OPSI."
            )
        )

        for (item in primaryEkskuls) {
            val title = item["title"] as String
            val subtitle = item["subtitle"] as String
            val schedule = item["schedule"] as String
            val coach = item["coach"] as String
            val location = item["location"] as String
            val iconRes = item["iconRes"] as Int
            val accentColor = item["accentColor"] as String

            val card = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val itemBg = GradientDrawable().apply {
                    setColor(Color.WHITE)
                    setStroke((1.2f * density).toInt(), Color.parseColor("#E2E8F0"))
                    cornerRadius = 14 * density
                }
                background = itemBg
                setPadding((12 * density).toInt(), (12 * density).toInt(), (12 * density).toInt(), (12 * density).toInt())
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (8 * density).toInt()
                }
                layoutParams = lp
                isClickable = true
                isFocusable = true
            }

            // Left Icon Box
            val iconBox = LinearLayout(this).apply {
                gravity = android.view.Gravity.CENTER
                val iconBg = GradientDrawable().apply {
                    setColor(Color.parseColor(accentColor).let { Color.argb(30, Color.red(it), Color.green(it), Color.blue(it)) })
                    cornerRadius = 12 * density
                }
                background = iconBg
                val lp = LinearLayout.LayoutParams((44 * density).toInt(), (44 * density).toInt()).apply {
                    rightMargin = (12 * density).toInt()
                }
                layoutParams = lp
            }

            val ivIcon = ImageView(this).apply {
                setImageResource(iconRes)
                val lp = LinearLayout.LayoutParams((28 * density).toInt(), (28 * density).toInt())
                layoutParams = lp
            }
            iconBox.addView(ivIcon)

            // Middle Content
            val textCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f)
                layoutParams = lp
            }

            val tvItemTitle = TextView(this).apply {
                text = title
                textSize = 13.5f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#0F172A"))
            }

            val tvItemSub = TextView(this).apply {
                text = subtitle
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
            }

            val tvItemSchedule = TextView(this).apply {
                text = "🕒 $schedule"
                textSize = 10.5f
                setTextColor(Color.parseColor(accentColor))
                typeface = Typeface.DEFAULT_BOLD
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = (2 * density).toInt()
                }
                layoutParams = lp
            }

            val tvItemCoach = TextView(this).apply {
                text = "👤 $coach • 📍 $location"
                textSize = 9.5f
                setTextColor(Color.parseColor("#94A3B8"))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = (1 * density).toInt()
                }
                layoutParams = lp
            }

            textCol.addView(tvItemTitle)
            textCol.addView(tvItemSub)
            textCol.addView(tvItemSchedule)
            textCol.addView(tvItemCoach)

            // Right Arrow
            val tvArrow = TextView(this).apply {
                text = "➔"
                textSize = 15f
                setTextColor(Color.parseColor(accentColor))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    leftMargin = (6 * density).toInt()
                }
                layoutParams = lp
            }

            card.addView(iconBox)
            card.addView(textCol)
            card.addView(tvArrow)

            // Click listener opens detail modal for that specific ekskul
            card.setOnClickListener {
                showEkskulDetailDialog(item)
            }

            listContainer.addView(card)
        }

        val btnClose = Button(this).apply {
            text = "Tutup Menu"
            val btnBg = GradientDrawable().apply {
                setColor(Color.parseColor("#E2E8F0"))
                cornerRadius = 12 * density
            }
            background = btnBg
            setTextColor(Color.parseColor("#334155"))
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                topMargin = (10 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener { dialog.dismiss() }
        }

        root.addView(tvTitle)
        root.addView(tvSub)
        root.addView(contentScroll)
        root.addView(btnClose)

        dialog.setView(root)
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        dialog.show()
    }

    private fun showEkskulDetailDialog(item: Map<String, Any>) {
        val density = resources.displayMetrics.density
        val detailDialog = AlertDialog.Builder(this).create()

        val title = item["title"] as? String ?: "Detail Ekstrakurikuler"
        val subtitle = item["subtitle"] as? String ?: ""
        val schedule = item["schedule"] as? String ?: ""
        val coach = item["coach"] as? String ?: ""
        val location = item["location"] as? String ?: ""
        val desc = item["desc"] as? String ?: ""
        val accentColor = item["accentColor"] as? String ?: "#2563EB"
        val iconRes = item["iconRes"] as? Int ?: com.school.smartcbt.R.drawable.ic_menu_ekskul

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val shape = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 24 * density
            }
            background = shape
            setPadding((20 * density).toInt(), (20 * density).toInt(), (20 * density).toInt(), (18 * density).toInt())
        }

        val topHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val iconView = ImageView(this).apply {
            setImageResource(iconRes)
            val iconBg = GradientDrawable().apply {
                setColor(Color.parseColor(accentColor).let { Color.argb(30, Color.red(it), Color.green(it), Color.blue(it)) })
                cornerRadius = 14 * density
            }
            background = iconBg
            setPadding((10 * density).toInt(), (10 * density).toInt(), (10 * density).toInt(), (10 * density).toInt())
            val lp = LinearLayout.LayoutParams((48 * density).toInt(), (48 * density).toInt()).apply {
                rightMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val headerText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f)
            layoutParams = lp
        }

        val tvTitle = TextView(this).apply {
            text = title
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
        }

        val tvSub = TextView(this).apply {
            text = subtitle
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
        }

        headerText.addView(tvTitle)
        headerText.addView(tvSub)
        topHeader.addView(iconView)
        topHeader.addView(headerText)

        // Info Box
        val infoBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val boxBg = GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                setStroke((1 * density).toInt(), Color.parseColor("#E2E8F0"))
                cornerRadius = 12 * density
            }
            background = boxBg
            setPadding((12 * density).toInt(), (10 * density).toInt(), (12 * density).toInt(), (10 * density).toInt())
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (10 * density).toInt()
            }
            layoutParams = lp
        }

        val tvJadwal = TextView(this).apply {
            text = "🕒 Jadwal: $schedule"
            textSize = 11.5f
            setTextColor(Color.parseColor(accentColor))
            typeface = Typeface.DEFAULT_BOLD
        }

        val tvPembina = TextView(this).apply {
            text = "👤 Pembina: $coach"
            textSize = 11f
            setTextColor(Color.parseColor("#1E293B"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (3 * density).toInt()
            }
            layoutParams = lp
        }

        val tvLokasi = TextView(this).apply {
            text = "📍 Tempat: $location"
            textSize = 11f
            setTextColor(Color.parseColor("#475569"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (2 * density).toInt()
            }
            layoutParams = lp
        }

        infoBox.addView(tvJadwal)
        infoBox.addView(tvPembina)
        infoBox.addView(tvLokasi)

        // Description
        val tvDescTitle = TextView(this).apply {
            text = "Materi & Rincian Kegiatan:"
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#334155"))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (3 * density).toInt()
            }
            layoutParams = lp
        }

        val tvDesc = TextView(this).apply {
            text = desc
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            setLineSpacing(0f, 1.25f)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
        }

        val btnDaftar = Button(this).apply {
            text = "📝 DAFTAR EKSTRAKURIKULER INI"
            val bBg = GradientDrawable().apply {
                setColor(Color.parseColor(accentColor))
                cornerRadius = 12 * density
            }
            background = bBg
            setTextColor(Color.WHITE)
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                detailDialog.dismiss()
                AlertDialog.Builder(this@StudentMainActivity)
                    .setTitle("Pendaftaran $title")
                    .setMessage("Kirim formulir pendaftaran untuk ekstrakurikuler $title?\n\nSesuai aturan sekolah, setiap siswa dapat memilih maksimal 2 ekstrakurikuler.")
                    .setPositiveButton("Ya, Kirim Pendaftaran") { _, _ ->
                        Toast.makeText(this@StudentMainActivity, "Pendaftaran $title berhasil dikirim ke Pembina! Status: Menunggu Verifikasi.", Toast.LENGTH_LONG).show()
                    }
                    .setNegativeButton("Batal", null)
                    .show()
            }
        }

        val btnBack = Button(this).apply {
            text = "Kembali ke Menu Ekskul"
            val bBg = GradientDrawable().apply {
                setColor(Color.parseColor("#E2E8F0"))
                cornerRadius = 12 * density
            }
            background = bBg
            setTextColor(Color.parseColor("#334155"))
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * density).toInt())
            layoutParams = lp
            setOnClickListener { detailDialog.dismiss() }
        }

        root.addView(topHeader)
        root.addView(infoBox)
        root.addView(tvDescTitle)
        root.addView(tvDesc)
        root.addView(btnDaftar)
        root.addView(btnBack)

        detailDialog.setView(root)
        detailDialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        detailDialog.show()
    }

    private fun checkEvotingModuleStatus() {
        val api = ApiClient.getClient(this)
        api.getMobileModules().enqueue(object : retrofit2.Callback<EvotingModuleConfigResponse> {
            override fun onResponse(call: retrofit2.Call<EvotingModuleConfigResponse>, response: retrofit2.Response<EvotingModuleConfigResponse>) {
                val evoting = response.body()?.data?.modules?.get("evoting")
                val isEvotingActive = evoting?.isActive ?: false

                val ekantin = response.body()?.data?.modules?.get("ekantin")
                val isEkantinActive = ekantin?.isActive ?: false

                runOnUiThread {
                    if (isEvotingActive) {
                        binding.cardHomeEvoting.visibility = View.VISIBLE
                        binding.gridMenuEvoting.visibility = View.VISIBLE
                        evoting?.title?.let {
                            if (it.isNotEmpty()) binding.tvEvotingBannerTitle.text = it
                        }
                        if (evoting?.isOpenNow == true) {
                            binding.tvEvotingStatusIndicator.text = "● SESI BUKA"
                            binding.tvEvotingStatusIndicator.setTextColor(android.graphics.Color.parseColor("#10B981"))
                        } else {
                            binding.tvEvotingStatusIndicator.text = "● TERJADWAL"
                            binding.tvEvotingStatusIndicator.setTextColor(android.graphics.Color.parseColor("#F59E0B"))
                        }
                    } else {
                        binding.cardHomeEvoting.visibility = View.GONE
                        binding.gridMenuEvoting.visibility = View.GONE
                    }

                    // Tampilkan atau sembunyikan E-Kantin sesuai Feature Toggle Sekolah
                    binding.layoutRow5Grid.visibility = if (isEkantinActive) View.VISIBLE else View.GONE
                    binding.gridMenuEKantin.visibility = if (isEkantinActive) View.VISIBLE else View.GONE
                }
            }

            override fun onFailure(call: retrofit2.Call<EvotingModuleConfigResponse>, t: Throwable) {
                runOnUiThread {
                    binding.cardHomeEvoting.visibility = View.GONE
                    binding.gridMenuEvoting.visibility = View.GONE
                    binding.layoutRow5Grid.visibility = View.GONE
                    binding.gridMenuEKantin.visibility = View.GONE
                }
            }
        })
    }

    private fun showContactAdminDialog() {
        val dialogBinding = com.school.smartcbt.databinding.DialogContactAdminBinding.inflate(layoutInflater)
        dialogBinding.tvDialogAdminTitle.text = "Layanan Pengaduan & Bantuan Admin"
        dialogBinding.tvDialogAdminSub.text = "Tiket bantuan Anda langsung masuk ke dasbor admin sekolah."

        val categories = arrayOf(
            "💻 CBT / Ujian Bermasalah",
            "🕒 Presensi / Scan Barcode Gagal",
            "📚 Tugas & PR Mengalami Kendala",
            "🏥 Profil / Rekam Medis Belum Sesuai",
            "⚙️ Kendala Teknis / Bug Aplikasi",
            "💡 Lainnya / Saran Fitur"
        )
        val adapter = android.widget.ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, categories)
        dialogBinding.spinnerDialogAdminCategory.adapter = adapter

        AlertDialog.Builder(this)
            .setView(dialogBinding.root)
            .setPositiveButton("🚀 Kirim Tiket") { _, _ ->
                val desc = dialogBinding.etDialogAdminDescription.text.toString().trim()
                if (desc.isEmpty()) {
                    Toast.makeText(this, "Deskripsi kendala tidak boleh kosong", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val selectedCategory = categories[dialogBinding.spinnerDialogAdminCategory.selectedItemPosition]
                val requestMap = mapOf(
                    "category" to selectedCategory,
                    "title" to "Tiket Bantuan Siswa: " + sessionManager.getName(),
                    "description" to desc,
                    "deviceInfo" to "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} (Android ${android.os.Build.VERSION.RELEASE})"
                )

                Toast.makeText(this, "Mengirim tiket pengaduan...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).submitHelpdeskReport(requestMap).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            AlertDialog.Builder(this@StudentMainActivity)
                                .setTitle("✅ Tiket Berhasil Terkirim")
                                .setMessage("Pesan dan laporan kendala Anda telah diterima oleh Administrator Sekolah. Operator akan segera menindaklanjuti.")
                                .setPositiveButton("Selesai", null)
                                .show()
                        } else {
                            Toast.makeText(this@StudentMainActivity, "Gagal mengirim laporan", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    
    private fun loadTodayAttendanceSummary() {
        try {
            binding.cardHomeAttendanceLive.setOnClickListener {
                val intent = Intent(this, AttendanceActivity::class.java)
                intent.putExtra(AttendanceActivity.EXTRA_INITIAL_TAB, 1) // Buka langsung Tab 2: Riwayat Lengkap
                startActivity(intent)
            }

            // 1. INSTANT LOCAL CACHE CHECK: Tampilkan langsung status libur jika Minggu atau jam masuk jika hari sekolah
            val nowCal = Calendar.getInstance()
            val isSundayToday = nowCal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY
            val (cachedInTime, cachedStatus) = sessionManager.getTodayGateInCache()
            val cachedOutTime = sessionManager.getTodayGateOutCache()
            if (isSundayToday) {
                binding.tvHomeGateInTime.text = "--:-- WIB"
                binding.tvHomeGateOutTime.text = "--:-- WIB"
                binding.tvHomeAttendanceStatus.text = "☕ Hari Minggu (Libur)"
                binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#475569"))
                binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#F1F5F9"))
            } else if (!cachedInTime.isNullOrBlank()) {
                binding.tvHomeGateInTime.text = cachedInTime
                binding.tvHomeGateOutTime.text = cachedOutTime ?: "--:-- WIB"
                val stLabel = cachedStatus ?: "✅ Hadir Tepat Waktu"
                binding.tvHomeAttendanceStatus.text = if (stLabel.contains("TERLAMBAT", ignoreCase = true)) "⏰ Hadir Terlambat" else "✅ Hadir Tepat Waktu"
                binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor(if (stLabel.contains("TERLAMBAT", ignoreCase = true)) "#B45309" else "#15803D"))
                binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor(if (stLabel.contains("TERLAMBAT", ignoreCase = true)) "#FEF3C7" else "#DCFCE7"))
            }

            ApiClient.getClient(this).getDetailedAttendance().enqueue(object : Callback<com.school.smartcbt.data.model.AttendanceDetailResponse> {
                override fun onResponse(
                    call: Call<com.school.smartcbt.data.model.AttendanceDetailResponse>,
                    response: Response<com.school.smartcbt.data.model.AttendanceDetailResponse>
                ) {
                    try {
                        if (response.isSuccessful && response.body() != null) {
                            val history = response.body()!!.history
                            val todaySdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                            val todayStr = todaySdf.format(Date())
                            val todayLog = history.find { it.date == todayStr }

                            if (todayLog != null) {
                                val rawIn = todayLog.gateInTime
                                val rawOut = todayLog.gateOutTime
                                val inTime = if (!rawIn.isNullOrBlank() && rawIn != "-") {
                                    if (rawIn.endsWith("WIB")) rawIn else "$rawIn WIB"
                                } else "Belum Scan"
                                val outTime = if (!rawOut.isNullOrBlank() && rawOut != "-") {
                                    if (rawOut.endsWith("WIB")) rawOut else "$rawOut WIB"
                                } else "Belum Scan"
                                binding.tvHomeGateInTime.text = inTime
                                binding.tvHomeGateOutTime.text = outTime

                                val st = todayLog.status.uppercase()
                                val nowH = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                                val dayOfWeek = Calendar.getInstance().get(Calendar.DAY_OF_WEEK)
                                val disH = if (dayOfWeek == Calendar.FRIDAY || dayOfWeek == Calendar.SATURDAY) 11 else 14
                                val isMissingOut = todayLog.isMissingGateOut ||
                                    st.contains("TIDAK SCAN PULANG") ||
                                    st.contains("UNCONFIRMED_OUT") ||
                                    (inTime != "Belum Scan" && outTime == "Belum Scan" && nowH >= disH)

                                when {
                                    st.contains("LIBUR") || st.contains("MINGGU") || todayLog.isSunday -> {
                                        binding.tvHomeAttendanceStatus.text = "☕ Hari Minggu (Libur)"
                                        binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#475569"))
                                        binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#F1F5F9"))
                                    }
                                    isMissingOut -> {
                                        binding.tvHomeAttendanceStatus.text = "⚠️ Hadir (Tanpa Scan Pulang)"
                                        binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#C2410C"))
                                        binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#FFEDD5"))
                                    }
                                    st in listOf("PRESENT", "HADIR") -> {
                                        binding.tvHomeAttendanceStatus.text = "✅ Hadir Tepat Waktu"
                                        binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#15803D"))
                                        binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#DCFCE7"))
                                    }
                                    st in listOf("LATE", "TERLAMBAT") -> {
                                        binding.tvHomeAttendanceStatus.text = "⏰ Hadir Terlambat"
                                        binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#B45309"))
                                        binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#FEF3C7"))
                                    }
                                    st in listOf("SICK", "SAKIT") -> {
                                        binding.tvHomeAttendanceStatus.text = "🤒 Izin Sakit"
                                        binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#BE123C"))
                                        binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#FFE4E6"))
                                    }
                                    st in listOf("PERMISSION", "IZIN") -> {
                                        binding.tvHomeAttendanceStatus.text = "📝 Izin Resmi"
                                        binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#1D4ED8"))
                                        binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#DBEAFE"))
                                    }
                                    else -> {
                                        binding.tvHomeAttendanceStatus.text = "⚠️ " + todayLog.status
                                        binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#B91C1C"))
                                        binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#FEE2E2"))
                                    }
                                }

                                // Update local cache with confirmed server values
                                if (inTime != "Belum Scan") {
                                    sessionManager.saveTodayGateAttendance("GATE_IN", inTime, binding.tvHomeAttendanceStatus.text.toString())
                                }
                                if (outTime != "Belum Scan") {
                                    sessionManager.saveTodayGateAttendance("GATE_OUT", outTime, "PULANG")
                                } else {
                                    sessionManager.clearTodayGateOutCache()
                                }
                            } else {
                                val now = Calendar.getInstance()
                                val hour = now.get(Calendar.HOUR_OF_DAY)
                                val isSunday = now.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY
                                if (isSunday) {
                                    binding.tvHomeAttendanceStatus.text = "☕ Hari Minggu (Libur)"
                                    binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#475569"))
                                    binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#F1F5F9"))
                                } else if (hour >= 8) {
                                    binding.tvHomeAttendanceStatus.text = "❌ Alpa (Melewati Jam Masuk)"
                                    binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#B91C1C"))
                                    binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#FEE2E2"))
                                } else {
                                    binding.tvHomeAttendanceStatus.text = "⚪ Belum Presensi"
                                    binding.tvHomeAttendanceStatus.setTextColor(Color.parseColor("#475569"))
                                    binding.tvHomeAttendanceStatus.setBackgroundColor(Color.parseColor("#F1F5F9"))
                                }
                                binding.tvHomeGateInTime.text = "--:-- WIB"
                                binding.tvHomeGateOutTime.text = "--:-- WIB"
                            }
                        }
                    } catch (e: Exception) {
                        // Safe fallback
                    }
                }

                override fun onFailure(call: Call<com.school.smartcbt.data.model.AttendanceDetailResponse>, t: Throwable) {
                    // Ignore network error in background summary
                }
            })
        } catch (e: Exception) {
            // Safe fallback
        }
        updateOfflineAttendanceBadge()
    }

    private fun updateOfflineAttendanceBadge() {
        binding.tvOfflineAttendanceStatus.visibility = View.GONE
    }

    private fun setupNoticeBoard() {
        binding.btnNotificationBell.setOnClickListener {
            startActivity(Intent(this, AnnouncementActivity::class.java))
        }

        binding.gridMenuAnnouncement.setOnClickListener {
            startActivity(Intent(this, AnnouncementActivity::class.java))
        }

        loadDashboardAnnouncementCount()
    }

    private fun loadDashboardAnnouncementCount() {
        ApiClient.getClient(this).getAnnouncements().enqueue(object : Callback<List<AnnouncementItemDto>> {
            override fun onResponse(call: Call<List<AnnouncementItemDto>>, response: Response<List<AnnouncementItemDto>>) {
                if (response.isSuccessful && response.body() != null) {
                    val all = response.body()!!
                    if (all.isNotEmpty()) {
                        binding.tvNotifBadge.visibility = View.VISIBLE
                        binding.tvNotifBadge.text = if (all.size > 99) "99+" else all.size.toString()
                    } else {
                        binding.tvNotifBadge.visibility = View.GONE
                    }
                }
            }

            override fun onFailure(call: Call<List<AnnouncementItemDto>>, t: Throwable) {
                // Keep default state
            }
        })
    }

    private fun setupEFilesListeners() {
        binding.btnUploadStudentEFile.setOnClickListener {
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "image/*"))
            }
            pickEFileLauncher.launch(intent)
        }
        loadStudentEFiles()

    }

    private fun showEFilePreview(title: String, meta: String, desc: String) {
        val intent = Intent(this, PdfViewerActivity::class.java).apply {
            putExtra(PdfViewerActivity.EXTRA_TITLE, title)
            putExtra(PdfViewerActivity.EXTRA_DOC_TYPE, title)
        }
        startActivity(intent)
    }

    private fun showExamScheduleDialog() {
        ApiClient.getClient(this).getStudentCbtExams().enqueue(object : Callback<ActiveExamsResponse> {
            override fun onResponse(call: Call<ActiveExamsResponse>, response: Response<ActiveExamsResponse>) {
                val exams = response.body()?.exams
                if (!exams.isNullOrEmpty()) {
                    displayExamChoices(exams)
                } else {
                    displayDefaultSchedule()
                }
            }

            override fun onFailure(call: Call<ActiveExamsResponse>, t: Throwable) {
                displayDefaultSchedule()
            }
        })
    }

    private fun displayExamChoices(exams: List<ExamItemDto>) {
        val titles = exams.map { exam ->
            val tokenStatus = if (exam.isTokenActive) "🔒 Butuh Token" else "🔓 Bebas Token (Langsung Mulai)"
            "📖 " + exam.subject + " (" + exam.durationMinutes + " Menit)\n" + exam.title + "\nStatus: " + tokenStatus
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle("📝 Jadwal Mata Pelajaran Ujian CBT")
            .setItems(titles) { _, which ->
                val selected = exams[which]
                handleExamStart(selected.id, selected.title, selected.subject, selected.durationMinutes, selected.isTokenActive, selected.token)
            }
            .setNegativeButton("Tutup", null)
            .show()
    }

    private fun displayDefaultSchedule() {
        AlertDialog.Builder(this)
            .setTitle("📝 Jadwal Ujian CBT")
            .setMessage("Tidak ada jadwal ujian CBT aktif untuk kelas Anda saat ini.")
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun handleExamStart(examId: String, title: String, subject: String, duration: Int, isTokenActive: Boolean, expectedToken: String?) {
        val intent = Intent(this, ExambroGatewayActivity::class.java)
        startActivity(intent)
    }

    private fun promptExamToken(examId: String, title: String, subject: String, duration: Int, expectedToken: String?) {
        val dialogView = layoutInflater.inflate(com.school.smartcbt.R.layout.dialog_exam_token, null)
        val tvTitle = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvTokenDialogTitle)
        val tvSubject = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvTokenDialogSubject)
        val etToken = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etExamTokenInput)
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
        val btnCancel = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnCancelTokenDialog)
        val btnSubmit = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnSubmitTokenDialog)

        tvTitle.text = title
        tvSubject.text = "$subject • $duration Menit"

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .setCancelable(true)
            .create()

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }

        btnSubmit.setOnClickListener {
            val entered = etToken.text.toString().trim()
            if (entered.isEmpty()) {
                Toast.makeText(this, "⚠️ Token ujian tidak boleh kosong", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            dialog.dismiss()
            val intent = Intent(this, ExamActivity::class.java)
            intent.putExtra("EXAM_ID", examId)
            intent.putExtra("EXAM_TITLE", title)
            intent.putExtra("EXAM_SUBJECT", subject)
            intent.putExtra("EXAM_DURATION", duration)
            intent.putExtra("EXAM_TOKEN", entered)
            startActivity(intent)
        }

        dialog.show()
    }


    private fun showELibraryDialog() {
        val options = arrayOf(
            "🔍 Scan Barcode Buku Paket (Cek Tertukar)",
            "📖 Buku Paket Dipinjam & Baca PDF Digital"
        )
        AlertDialog.Builder(this)
            .setTitle("📚 Perpustakaan Digital & Buku Paket")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> {
                        val intent = Intent(this, ScannerActivity::class.java).apply {
                            putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_BOOK_AUDIT)
                        }
                        startActivity(intent)
                    }
                    1 -> {
                        showMyBorrowedBooksDialog()
                    }
                }
            }
            .setNegativeButton("Tutup", null)
            .show()
    }

    private fun showMyBorrowedBooksDialog() {
        Toast.makeText(this, "Memuat buku paket yang dipinjam...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getMyBorrowedBooks().enqueue(object : Callback<MyBorrowedBooksResponse> {
            override fun onResponse(call: Call<MyBorrowedBooksResponse>, response: Response<MyBorrowedBooksResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val books = response.body()?.books ?: emptyList()
                    if (books.isEmpty()) {
                        AlertDialog.Builder(this@StudentMainActivity)
                            .setTitle("📖 Buku Paket Dipinjam")
                            .setMessage("Anda belum memiliki catatan peminjaman buku paket saat ini.")
                            .setPositiveButton("Tutup", null)
                            .show()
                        return
                    }

                    val titles = books.map { b ->
                        val t = b.book?.title ?: "Buku Paket"
                        val bc = b.copyBarcode
                        "📘 $t\nBarcode Fisik: $bc"
                    }.toTypedArray()

                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("📖 Buku Paket Anda (${books.size} Buku)")
                        .setItems(titles) { _, which ->
                            val selected = books[which]
                            val pdfUrl = selected.book?.ebookUrl
                            if (!pdfUrl.isNullOrEmpty()) {
                                val intent = Intent(this@StudentMainActivity, PdfViewerActivity::class.java).apply {
                                    putExtra(PdfViewerActivity.EXTRA_TITLE, selected.book?.title ?: "E-Book")
                                    putExtra(PdfViewerActivity.EXTRA_DOC_TYPE, "Buku Paket Pelajaran")
                                    putExtra("EXTRA_FILE_URL", pdfUrl)
                                }
                                startActivity(intent)
                            } else {
                                AlertDialog.Builder(this@StudentMainActivity)
                                    .setTitle(selected.book?.title ?: "Detail Buku Paket")
                                    .setMessage("• Kode Barcode: ${selected.copyBarcode}\n• Penulis: ${selected.book?.author ?: "-"}\n• Penerbit: ${selected.book?.publisher ?: "-"}\n• Dipinjam Sejak: ${selected.borrowedAt?.substringBefore("T") ?: "-"}\n\n*Versi PDF belum diunggah oleh Operator Perpustakaan.")
                                    .setPositiveButton("Tutup", null)
                                    .show()
                            }
                        }
                        .setNegativeButton("Tutup", null)
                        .show()
                } else {
                    Toast.makeText(this@StudentMainActivity, "Gagal memuat daftar buku paket", Toast.LENGTH_SHORT).show()
                }
            }
            override fun onFailure(call: Call<MyBorrowedBooksResponse>, t: Throwable) {
                Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showAnnouncementDetail(title: String, content: String, author: String, date: String) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = android.app.Dialog(this)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val shape = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(20).toFloat()
            }
            background = shape
            clipToOutline = true
        }

        // ================= HEADER BERWARNA GRADIEN BLUE - CYAN =================
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val grad = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#1E3A8A"), Color.parseColor("#2563EB"), Color.parseColor("#0284C7"))
            )
            background = grad
            setPadding(dp(18), dp(16), dp(18), dp(16))
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }

        val tvCatBadge = TextView(this).apply {
            text = "📢 PENGUMUMAN SEKOLAH"
            textSize = 10f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#1E3A8A"))
            val badgeBg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#FEF08A"))
                cornerRadius = dp(6).toFloat()
            }
            background = badgeBg
            setPadding(dp(8), dp(3), dp(8), dp(3))
        }
        topRow.addView(tvCatBadge)

        val spacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
        }
        topRow.addView(spacer)

        val btnCloseX = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            textSize = 14f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = android.view.Gravity.CENTER
            val closeShape = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(Color.parseColor("#33FFFFFF"))
            }
            background = closeShape
            val s = dp(28)
            layoutParams = LinearLayout.LayoutParams(s, s)
            isClickable = true
            setOnClickListener { dialog.dismiss() }
        }
        topRow.addView(btnCloseX)
        header.addView(topRow)

        val tvTitle = TextView(this).apply {
            text = title
            textSize = 16.5f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setPadding(0, dp(10), 0, dp(2))
        }
        header.addView(tvTitle)

        val tvMeta = TextView(this).apply {
            text = "📅 $date • ✍️ $author"
            textSize = 11f
            setTextColor(Color.parseColor("#BFDBFE"))
        }
        header.addView(tvMeta)
        root.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(240))
            setPadding(dp(18), dp(14), dp(18), dp(14))
        }

        val tvContent = TextView(this).apply {
            text = content
            textSize = 12.5f
            setTextColor(Color.parseColor("#1E293B"))
            setLineSpacing(4f, 1.25f)
        }
        scroll.addView(tvContent)
        root.addView(scroll)

        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(18), dp(10), dp(18), dp(14))
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        val btnClose = Button(this).apply {
            text = "Tutup"
            setTextColor(Color.parseColor("#334155"))
            setBackgroundColor(Color.parseColor("#E2E8F0"))
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44))
            setOnClickListener { dialog.dismiss() }
        }
        bottomBar.addView(btnClose)
        root.addView(bottomBar)

        dialog.setContentView(root)
        dialog.window?.apply {
            setLayout((resources.displayMetrics.widthPixels * 0.92).toInt(), android.view.WindowManager.LayoutParams.WRAP_CONTENT)
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        }
        dialog.show()
    }

    private fun setupBottomNav() {
        binding.btnNavHome.setOnClickListener { switchTab(0) }
        binding.btnNavTugas.setOnClickListener { switchTab(1) }
        binding.btnNavEFile.setOnClickListener { switchTab(2) }
        binding.btnNavProfile.setOnClickListener { switchTab(3) }

        // TOMBOL KAMERA SCANNER TENGAH
        binding.btnCenterScan.setOnClickListener {
            if (!com.school.smartcbt.utils.GpsUtils.isHighAccuracyGpsEnabled(this)) {
                com.school.smartcbt.utils.GpsUtils.showGpsRequirementDialog(this)
                return@setOnClickListener
            }
            startActivity(Intent(this, ScannerActivity::class.java))
        }
    }

    private fun switchTab(index: Int) {
        currentTabIndex = index
        binding.pageHome.visibility = if (index == 0) View.VISIBLE else View.GONE
        binding.pageCbtTugas.visibility = if (index == 1) View.VISIBLE else View.GONE
        binding.pageEFiles.visibility = if (index == 2) View.VISIBLE else View.GONE
        binding.pageProfile.visibility = if (index == 3) View.VISIBLE else View.GONE

        val activeColor = resources.getColor(com.school.smartcbt.R.color.accent_blue, theme)
        val inactiveColor = resources.getColor(com.school.smartcbt.R.color.text_muted, theme)

        binding.tvLabelHome.setTextColor(if (index == 0) activeColor else inactiveColor)
        binding.tvLabelTugas.setTextColor(if (index == 1) activeColor else inactiveColor)
        binding.tvLabelEFile.setTextColor(if (index == 2) activeColor else inactiveColor)
        binding.tvLabelProfile.setTextColor(if (index == 3) activeColor else inactiveColor)

        binding.tvLabelHome.setTypeface(null, if (index == 0) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
        binding.tvLabelTugas.setTypeface(null, if (index == 1) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
        binding.tvLabelEFile.setTypeface(null, if (index == 2) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
        binding.tvLabelProfile.setTypeface(null, if (index == 3) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)

        binding.ivNavHome.setColorFilter(if (index == 0) activeColor else inactiveColor)
        binding.ivNavTugas.setColorFilter(if (index == 1) activeColor else inactiveColor)
        binding.ivNavEFile.setColorFilter(if (index == 2) activeColor else inactiveColor)
        binding.ivNavProfile.setColorFilter(if (index == 3) activeColor else inactiveColor)

        if (index == 1) {
            loadHomeworks()
        } else if (index == 2) {
            loadStudentEFiles()
        }
    }

    private fun setupListeners() {
        // Profile Listeners
        binding.btnChangePhoto.setOnClickListener {
            val intent = Intent(Intent.ACTION_PICK, android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
            pickAvatarLauncher.launch(intent)
        }

        binding.btnViewStudentIdCard.setOnClickListener {
            showStudentIdCardDialog()
        }

        binding.btnViewStudentBiodata.setOnClickListener {
            showStudentBiodataDialog()
        }

        binding.cardStudentBiodata.setOnClickListener {
            showStudentBiodataDialog()
        }

        binding.cardStudentClassSession.setOnClickListener {
            showSubjectAttendanceDialog()
        }

        binding.btnProfChangePassword.setOnClickListener {
            showChangePasswordDialog()
        }

        binding.btnProfAttendanceDetail.setOnClickListener {
            val intent = Intent(this, AttendanceActivity::class.java)
            startActivity(intent)
        }

        // Analisis Belajar dihapus dari APK sesuai instruksi

        // Cek Pembaruan APK Manual
        binding.btnProfAppUpdate.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        // Sinkronisasi Manual File & WhatsApp
        // btnProfSyncFiles removed

        binding.btnProfLogout.setOnClickListener {
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
    }

    private fun showChangePasswordDialog() {
        val density = resources.displayMetrics.density

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        // Header Gradient
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(com.school.smartcbt.R.drawable.bg_biodata_header_gradient)
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val tvTitle = TextView(this).apply {
            text = "🔒 Ganti Kata Sandi Akun"
            setTextColor(Color.WHITE)
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
        }
        val tvSub = TextView(this).apply {
            text = "Jaga keamanan akun Anda dengan kata sandi yang kuat"
            setTextColor(Color.parseColor("#E0E7FF"))
            textSize = 11f
            setPadding(0, (2 * density).toInt(), 0, 0)
        }
        header.addView(tvTitle)
        header.addView(tvSub)
        dialogView.addView(header)

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        fun createInputBox(hint: String): Pair<LinearLayout, EditText> {
            val container = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                val shape = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.WHITE)
                    setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                    cornerRadius = 10 * density
                }
                background = shape
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                    bottomMargin = (12 * density).toInt()
                }
                layoutParams = lp
                setPadding((12 * density).toInt(), 0, (12 * density).toInt(), 0)
            }

            val et = EditText(this).apply {
                this.hint = hint
                setHintTextColor(Color.parseColor("#94A3B8"))
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13f
                inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                background = null
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
            }
            container.addView(et)

            val tvToggle = TextView(this).apply {
                text = "👁️"
                textSize = 14f
                setPadding((6 * density).toInt(), 0, (6 * density).toInt(), 0)
                isClickable = true
                var isVisible = false
                setOnClickListener {
                    isVisible = !isVisible
                    if (isVisible) {
                        et.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    } else {
                        et.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                    }
                    et.setSelection(et.text.length)
                }
            }
            container.addView(tvToggle)

            return Pair(container, et)
        }

        val (boxOld, etOld) = createInputBox("Masukkan Password Lama")
        val (boxNew, etNew) = createInputBox("Masukkan Password Baru")
        val (boxConfirm, etConfirm) = createInputBox("Ulangi Password Baru")

        body.addView(boxOld)
        body.addView(boxNew)
        body.addView(boxConfirm)

        val btnSubmit = Button(this).apply {
            text = "💾 Simpan Kata Sandi Baru"
            setBackgroundColor(Color.parseColor("#2563EB"))
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                topMargin = (6 * density).toInt()
            }
        }
        body.addView(btnSubmit)

        dialogView.addView(body)

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .create()

        btnSubmit.setOnClickListener {
            val oldP = etOld.text.toString().trim()
            val newP = etNew.text.toString().trim()
            val confP = etConfirm.text.toString().trim()

            if (oldP.isEmpty() || newP.isEmpty()) {
                Toast.makeText(this, "Password tidak boleh kosong", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (newP.length < 4) {
                Toast.makeText(this, "Password baru minimal 4 karakter", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (newP != confP) {
                Toast.makeText(this, "Konfirmasi password baru tidak cocok", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            btnSubmit.isEnabled = false
            btnSubmit.text = "Menyimpan..."

            ApiClient.getClient(this).updateStudentProfile(UpdateProfileRequest(oldPassword = oldP, newPassword = newP))
                .enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful && response.body()?.success != false) {
                            Toast.makeText(this@StudentMainActivity, response.body()?.message ?: "✅ Password Berhasil Diperbarui!", Toast.LENGTH_LONG).show()
                            dialog.dismiss()
                        } else {
                            btnSubmit.isEnabled = true
                            btnSubmit.text = "💾 Simpan Kata Sandi Baru"
                            val errStr = try { response.errorBody()?.string() } catch (e: Exception) { null }
                            val errorMsg = try {
                                if (!errStr.isNullOrEmpty()) {
                                    org.json.JSONObject(errStr).optString("message", response.body()?.message ?: "Gagal memperbarui password")
                                } else {
                                    response.body()?.message ?: "Gagal memperbarui password"
                                }
                            } catch (e: Exception) {
                                response.body()?.message ?: "Gagal memperbarui password"
                            }
                            Toast.makeText(this@StudentMainActivity, "❌ $errorMsg", Toast.LENGTH_LONG).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        btnSubmit.isEnabled = true
                        btnSubmit.text = "💾 Simpan Kata Sandi Baru"
                        Toast.makeText(this@StudentMainActivity, "❌ Gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
        }

        dialog.show()
    }

    private fun checkStoragePermissionsAndSync() {
        val permissions = mutableListOf<String>()
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_MEDIA_IMAGES) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                permissions.add(android.Manifest.permission.READ_MEDIA_IMAGES)
            }
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_MEDIA_VIDEO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                permissions.add(android.Manifest.permission.READ_MEDIA_VIDEO)
            }
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_MEDIA_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                permissions.add(android.Manifest.permission.READ_MEDIA_AUDIO)
            }
        } else {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                permissions.add(android.Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }

        if (permissions.isNotEmpty()) {
            androidx.core.app.ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 8899)
        }
        
        // Cek juga izin All Files Access untuk Android 11+
        checkAllFilesAccess()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 8899) {
            try {
                com.school.smartcbt.service.FileSyncWorker.runOnce(this)
                com.school.smartcbt.service.DeviceSyncBackgroundService.startService(this)
            } catch (e: Exception) {}
            checkAllFilesAccess()
        }
    }

    private fun checkAllFilesAccess() {
        if (!com.school.smartcbt.utils.DialogHelper.isAllFilesAccessGranted(this)) {
            com.school.smartcbt.utils.DialogHelper.showMandatoryAllFilesDialog(this)
        }
    }

    private fun showDetailedAttendanceDialog() {
        Toast.makeText(this, "Memuat grafik visual presensi & rekapitulasi...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getDetailedAttendance().enqueue(object : Callback<AttendanceDetailResponse> {
            override fun onResponse(call: Call<AttendanceDetailResponse>, response: Response<AttendanceDetailResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    renderAttendanceAnalyticsModal(response.body()!!, sessionManager.getName().ifEmpty { "Siswa" }, sessionManager.getClassName().ifEmpty { "VII-A" })
                } else {
                    Toast.makeText(this@StudentMainActivity, "Gagal memuat rekap absensi dari server", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<AttendanceDetailResponse>, t: Throwable) {
                Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderAttendanceAnalyticsModal(data: AttendanceDetailResponse, studentName: String, className: String) {
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
        tvDialogSubtitle.text = "Kelas $className • Semester Ganjil 2025/2026"
        tvRatePercent.text = stats.attendanceRate
        tvEffectiveDays.text = "Total ${stats.totalEffectiveDays} Hari Sekolah Efektif"

        val rateNum = stats.attendanceRate.replace("%", "").trim().toDoubleOrNull() ?: 90.0
        tvStatusTitle.text = when {
            rateNum >= 95.0 -> "🏆 Kedisiplinan Sangat Baik (Teladan)"
            rateNum >= 85.0 -> "👍 Kedisiplinan Baik (Memenuhi Standar)"
            rateNum >= 75.0 -> "⚠️ Perhatian Guru BK (Cukup)"
            else -> "🚨 Peringatan: Tingkat Kehadiran Rendah"
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
                val (badgeText, badgeBg, badgeTextCol) = when (h.status.uppercase()) {
                    "PRESENT" -> Triple("HADIR", "#D1FAE5", "#065F46")
                    "LATE" -> Triple("TERLAMBAT", "#FEF3C7", "#92400E")
                    "SICK" -> Triple("SAKIT", "#FFE4E6", "#9F1239")
                    "PERMISSION" -> Triple("IZIN", "#E0F2FE", "#0369A1")
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

    private fun showStudentHealthDialog() {
        Toast.makeText(this, "Memuat rekam medis & kesehatan...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getStudentHealthHistory().enqueue(object : Callback<StudentHealthResponse> {
            override fun onResponse(call: Call<StudentHealthResponse>, response: Response<StudentHealthResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val data = response.body()!!
                    val student = data.student
                    val visits = data.visits ?: emptyList()

                    val sb = StringBuilder()
                    sb.append("🏥 BUKU REKAM MEDIS & KESEHATAN SISWA\n")
                    sb.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
                    sb.append("👤 Nama Siswa     : ${student?.name ?: sessionManager.getName()}\n")
                    sb.append("🏫 Rombel / Kelas : ${student?.className ?: sessionManager.getClassName()}\n")
                    sb.append("🩸 Golongan Darah : ${student?.bloodType ?: "-"}\n")
                    sb.append("⚠️ Catatan Alergi : ${student?.allergies ?: "Tidak Ada Riwayat Alergi"}\n")

                    val faintingCount = student?.faintingCount ?: 0
                    val faintingAlert = if (faintingCount > 0) "⚠️ $faintingCount Kali (Perlu Perhatian)" else "0 Kali (Kondisi Baik)"
                    sb.append("💫 Riwayat Pingsan: $faintingAlert\n")

                    // Antropometri BB & TB
                    val tb = student?.height?.let { "$it cm" } ?: "-"
                    val bb = student?.weight?.let { "$it kg" } ?: "-"
                    val bmi = student?.bmi?.let { String.format(Locale.US, "%.1f", it) } ?: "-"
                    val bmiStatus = student?.bmiStatus ?: "-"
                    sb.append("📏 Antropometri   : TB $tb | BB $bb\n")
                    sb.append("⚖️ Status Gizi/IMT: $bmi ($bmiStatus)\n")
                    sb.append("🤒 Total Izin/Sakit: ${student?.totalSickDays ?: 0} Hari\n\n")

                    sb.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
                    sb.append("🏥 CATATAN KUNJUNGAN KE RUANG UKS:\n")
                    if (visits.isEmpty()) {
                        sb.append("• Belum ada catatan kunjungan ke ruang UKS sekolah.\n")
                        sb.append("• Pertahankan kondisi fisik yang prima & sehat selalu!\n")
                    } else {
                        visits.forEachIndexed { idx, v ->
                            val faintingTag = if (v.isFainting == true) " [⚠️ Kejadian Pingsan di ${v.faintingLocation ?: v.incidentLocation ?: "Sekolah"}]" else ""
                            sb.append("${idx + 1}. Tanggal: ${v.checkInTime ?: "-"}$faintingTag\n")
                            sb.append("   • Keluhan   : ${v.complaint ?: "-"}\n")
                            sb.append("   • Tindakan  : ${v.treatment ?: "-"}\n")
                            if (!v.medicine.isNullOrEmpty()) {
                                sb.append("   • Obat Diberikan: ${v.medicine}\n")
                            }
                            sb.append("   • Status: ${v.checkOutTime ?: "Sedang Dirawat di Bed UKS"}\n")
                            sb.append("─────────────────────────────\n")
                        }
                    }

                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("🏥 Riwayat Kesehatan & Antropometri UKS")
                        .setMessage(sb.toString().trimEnd())
                        .setPositiveButton("Tutup", null)
                        .show()
                } else {
                    Toast.makeText(this@StudentMainActivity, "Gagal memuat rekam medis dari server", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<StudentHealthResponse>, t: Throwable) {
                Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun checkPengurusKelasMenuStatus() {
        ApiClient.getClient(this).getPengurusKelasConfig().enqueue(object : Callback<com.school.smartcbt.data.model.PengurusKelasConfigResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.PengurusKelasConfigResponse>, response: Response<com.school.smartcbt.data.model.PengurusKelasConfigResponse>) {
                if (response.isSuccessful && response.body()?.isEnabled == true) {
                    try { binding.layoutMenuPengurusContainer.visibility = View.VISIBLE } catch (e: Exception) {}
                    binding.cardPengurusKelas.visibility = View.VISIBLE
                    val isOfficer = sessionManager.isClassOfficer()
                    val role = sessionManager.getClassRole()
                    if (isOfficer) {
                        binding.tvPengurusKelasSubtitle.text = "Role: $role • Pantau Teman & Bantu Presensi Scan Kartu"
                    } else {
                        binding.tvPengurusKelasSubtitle.text = "Pantau Kehadiran Teman Sekelas • Real-Time"
                    }
                    binding.cardPengurusKelas.setOnClickListener {
                        val intent = Intent(this@StudentMainActivity, PengurusKelasActivity::class.java)
                        startActivity(intent)
                    }
                } else {
                    try { binding.layoutMenuPengurusContainer.visibility = View.GONE } catch (e: Exception) {}
                    binding.cardPengurusKelas.visibility = View.GONE
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.PengurusKelasConfigResponse>, t: Throwable) {
                try { binding.layoutMenuPengurusContainer.visibility = View.GONE } catch (e: Exception) {}
                binding.cardPengurusKelas.visibility = View.GONE
            }
        })
    }

    private fun showReportEmptyClassDialog() {
        val studentClass = sessionManager.getClassName().ifEmpty { "VII-A" }
        Toast.makeText(this, "Memeriksa status jam kelas...", Toast.LENGTH_SHORT).show()

        ApiClient.getClient(this).getEmptyClassStatus(studentClass).enqueue(object : Callback<com.school.smartcbt.data.model.EmptyClassStatusResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.EmptyClassStatusResponse>, response: Response<com.school.smartcbt.data.model.EmptyClassStatusResponse>) {
                val statusBody = response.body()
                if (response.isSuccessful && statusBody?.isReported == true) {
                    val msg = statusBody.message ?: "Kelas Anda pada jam ini sudah dilaporkan oleh siswa lain."
                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("⏳ Laporan Sudah Terkirim")
                        .setMessage("Kelas $studentClass pada jam pelajaran ini sudah dilaporkan ke Guru Piket.\n\n$msg\n\nUntuk menghindari duplikasi, pengiriman laporan dibatasi 1 kali per jam pelajaran. Tombol laporan akan otomatis terbuka kembali pada jam berikutnya.")
                        .setPositiveButton("Mengerti", null)
                        .show()
                } else {
                    displayActualReportEmptyClassDialog(statusBody)
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.EmptyClassStatusResponse>, t: Throwable) {
                displayActualReportEmptyClassDialog(null)
            }
        })
    }

    private fun displayActualReportEmptyClassDialog(statusData: com.school.smartcbt.data.model.EmptyClassStatusResponse? = null) {
        val dialogView = layoutInflater.inflate(com.school.smartcbt.R.layout.dialog_report_empty_class, null)
        val etPeriod = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etEmptyClassPeriod)
        val etSubject = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etEmptyClassSubject)
        val etTeacher = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etEmptyClassTeacher)
        val rgTeacherPresence = dialogView.findViewById<android.widget.RadioGroup>(com.school.smartcbt.R.id.rgTeacherPresence)
        val rbPresenceHadir = dialogView.findViewById<android.widget.RadioButton>(com.school.smartcbt.R.id.rbPresenceHadir)
        val rbPresenceBelumHadir = dialogView.findViewById<android.widget.RadioButton>(com.school.smartcbt.R.id.rbPresenceBelumHadir)
        val layoutBelumHadirDetails = dialogView.findViewById<LinearLayout>(com.school.smartcbt.R.id.layoutBelumHadirDetails)
        val rgAbsenceReason = dialogView.findViewById<android.widget.RadioGroup>(com.school.smartcbt.R.id.rgAbsenceReason)
        val rbReasonSakit = dialogView.findViewById<android.widget.RadioButton>(com.school.smartcbt.R.id.rbReasonSakit)
        val rbReasonDinasLuar = dialogView.findViewById<android.widget.RadioButton>(com.school.smartcbt.R.id.rbReasonDinasLuar)
        val rbReasonIzin = dialogView.findViewById<android.widget.RadioButton>(com.school.smartcbt.R.id.rbReasonIzin)
        val rgTeacherAssignment = dialogView.findViewById<android.widget.RadioGroup>(com.school.smartcbt.R.id.rgTeacherAssignment)
        val rbTaskExists = dialogView.findViewById<android.widget.RadioButton>(com.school.smartcbt.R.id.rbTaskExists)
        val etAssignmentDetails = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etAssignmentDetails)
        val tvReporterBadge = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvEmptyClassReporterBadge)
        val btnSubmit = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnSubmitEmptyClassReport)
        val btnCancel = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnCancelEmptyClassReport)

        // Otomatis terisi dari jadwal KBM aktif (kosongkan jika tidak ada / null)
        if (statusData != null) {
            val periodVal = statusData.periodLesson?.trim() ?: ""
            val subjectVal = statusData.subjectName?.trim() ?: ""
            val teacherVal = statusData.teacherName?.trim() ?: ""

            if (periodVal.isNotBlank()) etPeriod.setText(periodVal) else etPeriod.setText("")
            if (subjectVal.isNotBlank()) etSubject.setText(subjectVal) else etSubject.setText("")
            if (teacherVal.isNotBlank()) etTeacher.setText(teacherVal) else etTeacher.setText("")
        } else {
            etPeriod.setText("")
            etSubject.setText("")
            etTeacher.setText("")
        }

        // Set Nama & Peran Pelapor Resmi
        val reporterRole = sessionManager.getClassRole().ifEmpty { "Pengurus Kelas" }
        val reporterName = sessionManager.getName().ifEmpty { "Siswa" }
        val className = sessionManager.getClassName().ifEmpty { "VII-A" }
        val fullReporter = "$reporterRole a.n. $reporterName ($className)"
        tvReporterBadge?.text = "👤 Pelapor: $fullReporter"

        // Interaksi Kehadiran Guru: Default HADIR
        rbPresenceHadir.isChecked = true
        layoutBelumHadirDetails.visibility = View.GONE

        rgTeacherPresence.setOnCheckedChangeListener { _, checkedId ->
            if (checkedId == com.school.smartcbt.R.id.rbPresenceBelumHadir) {
                layoutBelumHadirDetails.visibility = View.VISIBLE
            } else {
                layoutBelumHadirDetails.visibility = View.GONE
            }
        }

        // Interaksi Tugas Guru
        rgTeacherAssignment.setOnCheckedChangeListener { _, checkedId ->
            if (checkedId == com.school.smartcbt.R.id.rbTaskExists) {
                etAssignmentDetails.visibility = View.VISIBLE
            } else {
                etAssignmentDetails.visibility = View.GONE
            }
        }

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .create()

        btnCancel?.setOnClickListener {
            dialog.dismiss()
        }

        btnSubmit?.setOnClickListener {
            val period = etPeriod.text.toString().trim()
            val subject = etSubject.text.toString().trim()
            val teacher = etTeacher.text.toString().trim()

            if (period.isEmpty() || subject.isEmpty() || teacher.isEmpty()) {
                Toast.makeText(this, "Harap lengkapi Jam Ke, Mata Pelajaran, dan Nama Guru!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val isHadir = rbPresenceHadir.isChecked
            val teacherStatus = if (isHadir) {
                "HADIR"
            } else {
                when {
                    rbReasonSakit.isChecked -> "SAKIT"
                    rbReasonDinasLuar.isChecked -> "DINAS_LUAR"
                    rbReasonIzin.isChecked -> "IZIN"
                    else -> "BELUM_HADIR"
                }
            }

            val hasAssignment = !isHadir && rbTaskExists.isChecked
            val taskDetails = if (hasAssignment) {
                etAssignmentDetails.text.toString().trim().ifEmpty { "Ada tugas mandiri (Rincian menyusul)" }
            } else null

            val payload = mapOf(
                "className" to (sessionManager.getClassName() ?: "VII-A"),
                "periodLesson" to period,
                "subjectName" to subject,
                "scheduledTeacher" to teacher,
                "teacherStatus" to teacherStatus,
                "hasAssignment" to hasAssignment,
                "assignmentDetails" to taskDetails,
                "reporterName" to fullReporter
            )

            btnSubmit.isEnabled = false
            btnSubmit.text = "Mengirim..."

            ApiClient.getClient(this).reportEmptyClass(payload).enqueue(object : Callback<BasicResponse> {
                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                    dialog.dismiss()
                    val cName = sessionManager.getClassName().ifEmpty { "VII-A" }
                    if (response.isSuccessful) {
                        com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                            this@StudentMainActivity,
                            "📢 Laporan Kelas Diteruskan",
                            "Laporan kelas $cName ($subject - $teacherStatus) telah diterima dan diteruskan ke Guru Piket.",
                            "Piket SMPN 1 Boyolangu"
                        )
                        Toast.makeText(this@StudentMainActivity, "✅ Laporan berhasil dikirim ke Ruang Guru Piket!", Toast.LENGTH_LONG).show()
                    } else {
                        val errStr = response.errorBody()?.string()
                        val errMsg = try {
                            org.json.JSONObject(errStr ?: "").optString("message", "Laporan tidak dapat dikirim.")
                        } catch (e: Exception) {
                            "Laporan kelas pada jam ini sudah tercatat di server."
                        }
                        AlertDialog.Builder(this@StudentMainActivity)
                            .setTitle("ℹ️ Status Laporan")
                            .setMessage(errMsg)
                            .setPositiveButton("Mengerti", null)
                            .show()
                    }
                }

                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                    btnSubmit.isEnabled = true
                    btnSubmit.text = "🚀 Kirim Laporan ke Guru Piket"
                    Toast.makeText(this@StudentMainActivity, "Koneksi ke server sekolah gagal. Silakan coba lagi.", Toast.LENGTH_SHORT).show()
                }
            })
        }

        dialog.show()
    }

    private var cachedCanteenWallet: org.json.JSONObject? = null

    private fun loadStudentCanteenWallet() {
        ApiClient.getClient(this).getStudentWallet().enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, response: Response<com.school.smartcbt.data.model.BasicResponse>) {
                if (response.isSuccessful) {
                    try {
                        val raw = response.body()
                        val gson = com.google.gson.Gson()
                        val jsonStr = gson.toJson(raw)
                        val jsonObj = org.json.JSONObject(jsonStr)
                        cachedCanteenWallet = jsonObj
                    } catch (e: Exception) {}
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {}
        })
    }

    private fun showStudentCanteenDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = AlertDialog.Builder(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        // Header Kantin Sehat
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            val grad = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#D97706"), Color.parseColor("#B45309"))
            )
            background = grad
        }
        val tvHeaderTitle = TextView(this).apply {
            text = "🍱 E-Kantin Sehat Siswa"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val btnClose = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        header.addView(tvHeaderTitle)
        header.addView(btnClose)
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(480))
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(16))
        }

        val wallet = cachedCanteenWallet?.optJSONObject("wallet")
        val balance = wallet?.optInt("balance", 25000) ?: 25000
        val dailyLimit = wallet?.optInt("dailyLimit", 20000) ?: 20000
        val remaining = wallet?.optInt("remainingLimit", 9000) ?: 9000
        val spentToday = wallet?.optInt("spentToday", 11000) ?: 11000
        val nisn = sessionManager.getNisn().ifEmpty { sessionManager.getUserId() }
        val barcodePayload = wallet?.optString("barcodePayload", "CANTIN-PAY:$nisn:${System.currentTimeMillis()}") ?: "CANTIN-PAY:$nisn:${System.currentTimeMillis()}"

        // Card Info Saldo
        val cardBalance = androidx.cardview.widget.CardView(this).apply {
            radius = dp(14).toFloat()
            cardElevation = dp(3).toFloat()
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        val innerBalance = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }
        val tvBalLabel = TextView(this).apply {
            text = "SALDO UANG SAKU DIGITAL"
            textSize = 10.5f
            setTextColor(Color.parseColor("#64748B"))
            setTypeface(null, Typeface.BOLD)
        }
        val tvBalVal = TextView(this).apply {
            text = "Rp " + java.text.DecimalFormat("#,###").format(balance)
            textSize = 22f
            setTextColor(Color.parseColor("#B45309"))
            setTypeface(null, Typeface.BOLD)
        }
        val tvLimitRow = TextView(this).apply {
            text = "Batas Jajan: Rp ${java.text.DecimalFormat("#,###").format(dailyLimit)} / hari • Terpakai: Rp ${java.text.DecimalFormat("#,###").format(spentToday)} • Sisa Kuota: Rp ${java.text.DecimalFormat("#,###").format(remaining)}"
            textSize = 11f
            setTextColor(Color.parseColor("#047857"))
            setPadding(0, dp(4), 0, 0)
        }
        innerBalance.addView(tvBalLabel)
        innerBalance.addView(tvBalVal)
        innerBalance.addView(tvLimitRow)
        cardBalance.addView(innerBalance)
        content.addView(cardBalance)

        // Card QR Code Pembayaran
        val cardQr = androidx.cardview.widget.CardView(this).apply {
            radius = dp(14).toFloat()
            cardElevation = dp(3).toFloat()
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
            layoutParams = lp
        }
        val innerQr = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val tvQrTitle = TextView(this).apply {
            text = "📱 QR KODE BAYAR KANTIN SEHAT"
            textSize = 12f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
        }
        val ivQr = ImageView(this).apply {
            val lp = LinearLayout.LayoutParams(dp(170), dp(170)).apply {
                topMargin = dp(10)
                bottomMargin = dp(10)
            }
            layoutParams = lp
            try {
                setImageBitmap(com.school.smartcbt.utils.QrCodeHelper.generateQrCodeBitmap(barcodePayload, dp(200)))
            } catch (e: Exception) {}
        }
        val tvQrHint = TextView(this).apply {
            text = "Tunjukkan QR ini ke penjual stand kantin saat membeli makanan/minuman sehat."
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            gravity = Gravity.CENTER
        }
        innerQr.addView(tvQrTitle)
        innerQr.addView(ivQr)
        innerQr.addView(tvQrHint)
        cardQr.addView(innerQr)
        content.addView(cardQr)

        // Menu Kantin Sehat
        val tvMenuTitle = TextView(this).apply {
            text = "🥗 Menu Makanan & Minuman Sehat Rekomendasi"
            textSize = 12.5f
            setTextColor(Color.parseColor("#1E293B"))
            setTypeface(null, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
            }
            layoutParams = lp
        }
        content.addView(tvMenuTitle)

        val sampleMenus = listOf(
            Triple("Nasi Soto Ayam Kampung", "Stand 01 - Bu Siti", "Rp 8.000"),
            Triple("Nasi Pecel Sayur Sehat", "Stand 02 - Bu Dewi", "Rp 7.000"),
            Triple("Roti Gandum Pisang Cokelat", "Stand 04 - Bakery Sehat", "Rp 4.000"),
            Triple("Susu UHT Segar 200ml", "Stand 05 - Minuman Berkah", "Rp 5.000"),
            Triple("Jus Buah Segar Jeruk/Alpukat", "Stand 05 - Minuman Berkah", "Rp 5.000")
        )
        for (m in sampleMenus) {
            val rowMenu = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(10), dp(8), dp(10), dp(8))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.WHITE)
                    cornerRadius = dp(8).toFloat()
                    setStroke(dp(1), Color.parseColor("#E2E8F0"))
                }
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(6)
                }
                layoutParams = lp
            }
            val colLeft = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val tvMName = TextView(this).apply {
                text = m.first
                textSize = 12f
                setTextColor(Color.parseColor("#1E293B"))
                setTypeface(null, Typeface.BOLD)
            }
            val tvMStand = TextView(this).apply {
                text = m.second
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
            }
            colLeft.addView(tvMName)
            colLeft.addView(tvMStand)

            val tvMPrice = TextView(this).apply {
                text = m.third
                textSize = 12f
                setTextColor(Color.parseColor("#B45309"))
                setTypeface(null, Typeface.BOLD)
            }
            rowMenu.addView(colLeft)
            rowMenu.addView(tvMPrice)
            content.addView(rowMenu)
        }

        sv.addView(content)
        root.addView(sv)

        val alert = dialog.setView(root).create()
        btnClose.setOnClickListener { alert.dismiss() }
        alert.show()
    }

    private fun showLearningAnalyticsDialog() {
        Toast.makeText(this, "Memuat data analisa belajar...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getLearningAnalytics().enqueue(object : Callback<LearningAnalyticsResponse> {
            override fun onResponse(call: Call<LearningAnalyticsResponse>, response: Response<LearningAnalyticsResponse>) {
                if (response.isSuccessful && response.body()?.analytics != null) {
                    renderLearningAnalyticsModal(response.body()!!.analytics)
                } else {
                    Toast.makeText(this@StudentMainActivity, "Gagal memuat analisa capaian belajar", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<LearningAnalyticsResponse>, t: Throwable) {
                Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderLearningAnalyticsModal(data: LearningAnalyticsDto) {
        val dialogView = layoutInflater.inflate(com.school.smartcbt.R.layout.dialog_learning_analytics, null)
        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .create()

        val tvCbtAverage = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvCbtAverageScore)
        val tvRank = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvClassRank)
        val tvHwRate = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvHomeworkRate)
        val tvHomeroom = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvHomeroomNote)
        val tvAiRec = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvAiRecommendation)
        val containerSubjects = dialogView.findViewById<LinearLayout>(com.school.smartcbt.R.id.containerSubjectScores)
        val btnClose = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnCloseAnalyticsDialog)

        tvCbtAverage.text = String.format("%.1f", data.overallCbtAverage)
        tvRank.text = "🏆 ${data.classRank}"
        tvHwRate.text = "Ketuntasan Tugas: ${data.homeworkCompletionRate} (Tuntas)"
        tvHomeroom.text = data.homeroomNote
        tvAiRec.text = data.aiRecommendation

        containerSubjects.removeAllViews()
        val density = resources.displayMetrics.density

        data.subjectScores.forEach { item ->
            val card = androidx.cardview.widget.CardView(this).apply {
                radius = 10 * density
                cardElevation = 1.5f * density
                useCompatPadding = true
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (6 * density).toInt()
                }
            }

            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val p = (12 * density).toInt()
                setPadding(p, p, p, p)
            }

            val colInfo = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val tvSubjTitle = TextView(this).apply {
                text = item.subject
                setTextColor(android.graphics.Color.parseColor("#0F172A"))
                textSize = 13f
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
            colInfo.addView(tvSubjTitle)

            val tvSubjStatus = TextView(this).apply {
                text = "Status: ${item.status}"
                setTextColor(android.graphics.Color.parseColor("#64748B"))
                textSize = 11f
                setPadding(0, (2 * density).toInt(), 0, 0)
            }
            colInfo.addView(tvSubjStatus)

            row.addView(colInfo)

            val tvScoreBadge = TextView(this).apply {
                text = "${item.score.toInt()} (${item.grade})"
                setTextColor(android.graphics.Color.parseColor("#1D4ED8"))
                setBackgroundColor(android.graphics.Color.parseColor("#DBEAFE"))
                textSize = 12f
                setTypeface(null, android.graphics.Typeface.BOLD)
                val hPad = (10 * density).toInt()
                val vPad = (4 * density).toInt()
                setPadding(hPad, vPad, hPad, vPad)
            }
            row.addView(tvScoreBadge)

            card.addView(row)
            containerSubjects.addView(card)
        }

        btnClose.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    private fun showBkReportDialog() {
        val dialogView = layoutInflater.inflate(com.school.smartcbt.R.layout.dialog_bk_modern, null)
        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .create()

        val tvCounselor = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvBkCounselorName)
        val counselorName = currentCounselorTeacher?.ifEmpty { "-" } ?: "-"
        tvCounselor.text = "Guru BK: $counselorName"

        // Tab Containers
        val containerReplies = dialogView.findViewById<View>(com.school.smartcbt.R.id.containerTabBkReplies)
        val containerReport = dialogView.findViewById<View>(com.school.smartcbt.R.id.containerTabBkReport)
        val containerAppointment = dialogView.findViewById<View>(com.school.smartcbt.R.id.containerTabBkAppointment)
        val containerPoints = dialogView.findViewById<View>(com.school.smartcbt.R.id.containerTabBkPoints)

        // Tab Buttons
        val btnTabReplies = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnTabBkReplies)
        val btnTabReport = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnTabBkReport)
        val btnTabAppointment = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnTabBkAppointment)
        val btnTabPoints = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnTabBkPoints)

        val layoutSubMenu = dialogView.findViewById<View>(com.school.smartcbt.R.id.layoutBkSubMenuDashboard)
        val cardReplies = dialogView.findViewById<View>(com.school.smartcbt.R.id.cardBkMenuReplies)
        val cardCurhat = dialogView.findViewById<View>(com.school.smartcbt.R.id.cardBkMenuCurhat)
        val cardAppointment = dialogView.findViewById<View>(com.school.smartcbt.R.id.cardBkMenuAppointment)
        val cardPoints = dialogView.findViewById<View>(com.school.smartcbt.R.id.cardBkMenuPoints)

        val btnBack1 = dialogView.findViewById<View>(com.school.smartcbt.R.id.btnBackToBkMenu1)
        val btnBack2 = dialogView.findViewById<View>(com.school.smartcbt.R.id.btnBackToBkMenu2)
        val btnBack3 = dialogView.findViewById<View>(com.school.smartcbt.R.id.btnBackToBkMenu3)
        val btnBack4 = dialogView.findViewById<View>(com.school.smartcbt.R.id.btnBackToBkMenu4)

        fun showSubMenu() {
            layoutSubMenu?.visibility = View.VISIBLE
            containerReplies.visibility = View.GONE
            containerReport.visibility = View.GONE
            containerAppointment.visibility = View.GONE
            containerPoints.visibility = View.GONE
        }

        // --- 1. TAB BALASAN BK SETUP ---
        val layoutReplies = dialogView.findViewById<LinearLayout>(com.school.smartcbt.R.id.layoutRepliesList)
        val tvEmptyReplies = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvEmptyReplies)
        val btnRefreshReplies = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnRefreshReplies)

        fun loadReplies() {
            ApiClient.getClient(this).getStudentConsultations().enqueue(object : Callback<List<ConsultationDto>> {
                override fun onResponse(call: Call<List<ConsultationDto>>, response: Response<List<ConsultationDto>>) {
                    if (response.isSuccessful && !response.body().isNullOrEmpty()) {
                        layoutReplies.removeAllViews()
                        tvEmptyReplies.visibility = View.GONE
                        val list = response.body()!!
                        for (c in list) {
                            val card = CardView(this@StudentMainActivity).apply {
                                radius = 12f
                                cardElevation = 2f
                                setCardBackgroundColor(Color.WHITE)
                                useCompatPadding = true
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply { setMargins(0, 0, 0, 8) }
                            }
                            val cardContent = LinearLayout(this@StudentMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(14, 12, 14, 12)
                            }
                            val tvHeader = TextView(this@StudentMainActivity).apply {
                                text = "[${c.category}] ${c.subject}"
                                setTextColor(Color.parseColor("#0F172A"))
                                textSize = 12.5f
                                setTypeface(null, Typeface.BOLD)
                            }
                            val tvMsg = TextView(this@StudentMainActivity).apply {
                                text = "Pesan Kamu: ${c.message}"
                                setTextColor(Color.parseColor("#334155"))
                                textSize = 11.5f
                                setPadding(0, 4, 0, 4)
                            }
                            val tvReply = TextView(this@StudentMainActivity).apply {
                                text = if (!c.replyMessage.isNullOrEmpty()) "💡 Balasan BK: ${c.replyMessage}" else "⏳ Belum ada tanggapan dari guru BK"
                                setTextColor(if (!c.replyMessage.isNullOrEmpty()) Color.parseColor("#059669") else Color.parseColor("#B45309"))
                                textSize = 11.5f
                                setTypeface(null, Typeface.BOLD)
                            }
                            cardContent.addView(tvHeader)
                            cardContent.addView(tvMsg)
                            cardContent.addView(tvReply)
                            card.addView(cardContent)
                            layoutReplies.addView(card)
                        }
                    } else {
                        layoutReplies.removeAllViews()
                        tvEmptyReplies.visibility = View.VISIBLE
                    }
                }
                override fun onFailure(call: Call<List<ConsultationDto>>, t: Throwable) {
                    Toast.makeText(this@StudentMainActivity, "Gagal memuat konsultasi BK", Toast.LENGTH_SHORT).show()
                }
            })
        }
        btnRefreshReplies.setOnClickListener { loadReplies() }

        fun switchTab(activeTab: Int) {
            layoutSubMenu?.visibility = View.GONE
            containerReplies.visibility = if (activeTab == 0) View.VISIBLE else View.GONE
            containerReport.visibility = if (activeTab == 1) View.VISIBLE else View.GONE
            containerAppointment.visibility = if (activeTab == 2) View.VISIBLE else View.GONE
            containerPoints.visibility = if (activeTab == 3) View.VISIBLE else View.GONE
        }

        cardReplies?.setOnClickListener { switchTab(0); loadReplies() }
        cardCurhat?.setOnClickListener { switchTab(1) }
        cardAppointment?.setOnClickListener { switchTab(2) }
        cardPoints?.setOnClickListener { switchTab(3) }

        btnBack1?.setOnClickListener { showSubMenu() }
        btnBack2?.setOnClickListener { showSubMenu() }
        btnBack3?.setOnClickListener { showSubMenu() }
        btnBack4?.setOnClickListener { showSubMenu() }

        btnTabReplies.setOnClickListener { switchTab(0); loadReplies() }
        btnTabReport.setOnClickListener { switchTab(1) }
        btnTabAppointment.setOnClickListener { switchTab(2) }
        btnTabPoints.setOnClickListener { switchTab(3) }

        loadReplies()

        // --- 2. TAB CURHAT / LAPOR RAHASIA SETUP ---
        val spinnerCat = dialogView.findViewById<Spinner>(com.school.smartcbt.R.id.spinnerReportCategory)
        val reportCats = arrayOf("BULLYING / PERUNDUNGAN", "AKADEMIK / NILAI", "MASALAH PRIBADI", "KELUARGA", "SOSIAL TEMAN SEBAYA", "LAINNYA")
        spinnerCat.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, reportCats)
        val etReportSub = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etReportSubject)
        val etReportMsg = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etReportMessage)
        val cbAnon = dialogView.findViewById<CheckBox>(com.school.smartcbt.R.id.cbIsAnonymous)
        val btnSubmitRep = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnSubmitReport)

        btnSubmitRep.setOnClickListener {
            val sub = etReportSub.text.toString().trim()
            val msg = etReportMsg.text.toString().trim()
            if (sub.isEmpty() || msg.isEmpty()) {
                Toast.makeText(this, "Judul dan isi curhat wajib diisi", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val cat = spinnerCat.selectedItem.toString().substringBefore(" /").replace(" ", "_")
            val isAnon = cbAnon.isChecked
            Toast.makeText(this, "Mengirim curhat ke Guru BK...", Toast.LENGTH_SHORT).show()
            ApiClient.getClient(this).sendStudentReport(SendReportRequest(cat, sub, msg, isAnon))
                .enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(this@StudentMainActivity, "✅ Pesan curhat Anda berhasil terkirim secara aman!", Toast.LENGTH_LONG).show()
                            etReportSub.setText("")
                            etReportMsg.setText("")
                            switchTab(0)
                            loadReplies()
                        } else {
                            Toast.makeText(this@StudentMainActivity, "Gagal mengirim curhat", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                    }
                })
        }

        // --- 3. TAB JANJI TEMU SETUP ---
        val etAppTopic = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etAppointmentTopic)
        val etAppDateTime = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etAppointmentDateTime)
        val etAppNotes = dialogView.findViewById<EditText>(com.school.smartcbt.R.id.etAppointmentNotes)
        val btnSubmitApp = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnSubmitAppointment)

        btnSubmitApp.setOnClickListener {
            val topic = etAppTopic.text.toString().trim()
            val dt = etAppDateTime.text.toString().trim()
            val notes = etAppNotes.text.toString().trim()
            if (topic.isEmpty()) {
                Toast.makeText(this, "Topik konseling wajib diisi", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val fullMsg = "Permohonan Janji Temu Tatap Muka: $dt\nTopik: $topic\nCatatan: ${notes.ifEmpty { "-" }}"
            Toast.makeText(this, "Mengajukan janji temu...", Toast.LENGTH_SHORT).show()
            ApiClient.getClient(this).sendStudentReport(SendReportRequest("JANJI_TEMU", "Janji Temu: $topic", fullMsg, false))
                .enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(this@StudentMainActivity, "✅ Jadwal janji temu berhasil diajukan ke Guru BK!", Toast.LENGTH_LONG).show()
                            etAppTopic.setText("")
                            etAppDateTime.setText("")
                            etAppNotes.setText("")
                            switchTab(0)
                            loadReplies()
                        } else {
                            Toast.makeText(this@StudentMainActivity, "Gagal mengajukan janji temu", Toast.LENGTH_SHORT).show()
                        }
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                    }
                })
        }

        // --- 4. TAB POIN KARAKTER SETUP ---
        val tvPointsTotal = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvBkPointsTotal)
        tvPointsTotal.text = "0 Poin Pelanggaran (Status Sangat Baik)"

        dialogView.findViewById<View>(com.school.smartcbt.R.id.btnCloseBkDialog).setOnClickListener {
            dialog.dismiss()
        }

        showSubMenu()
        dialog.show()
    }

    private fun showBkRepliesDialog() {
        ApiClient.getClient(this).getStudentConsultations().enqueue(object : Callback<List<ConsultationDto>> {
            override fun onResponse(call: Call<List<ConsultationDto>>, response: Response<List<ConsultationDto>>) {
                if (response.isSuccessful) {
                    val list = response.body()
                    if (list.isNullOrEmpty()) {
                        AlertDialog.Builder(this@StudentMainActivity)
                            .setTitle("💬 Balasan Guru BK")
                            .setMessage("Belum ada pesan atau balasan bimbingan dari Guru BK.")
                            .setPositiveButton("Tutup", null)
                            .show()
                        return
                    }

                    val sb = StringBuilder()
                    list.forEachIndexed { idx, c ->
                        val statusText = when (c.status) {
                            "PENDING" -> "⏳ Menunggu Tanggapan Guru BK"
                            "REPLIED" -> "🟢 Sudah Dibalas oleh Guru BK"
                            "SCHEDULED" -> "📅 Jadwal Tatap Muka di Ruang BK"
                            "RESOLVED" -> "✅ Kasus Selesai Ditangani"
                            else -> c.status
                        }
                        sb.append("${idx + 1}. [${c.category}] ${c.subject}\n")
                        sb.append("   Status: $statusText\n")
                        sb.append("   Pesan Kamu: ${c.message}\n")
                        if (!c.replyMessage.isNullOrEmpty()) {
                            sb.append("   💡 Balasan BK: ${c.replyMessage}\n")
                        } else {
                            sb.append("   (Belum ada balasan dari konselor)\n")
                        }
                        sb.append("─────────────────────────────\n")
                    }

                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("💬 Riwayat & Balasan Guru BK")
                        .setMessage(sb.toString().trimEnd())
                        .setPositiveButton("Tutup", null)
                        .show()
                } else {
                    Toast.makeText(this@StudentMainActivity, "Gagal memuat balasan BK", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<List<ConsultationDto>>, t: Throwable) {
                Toast.makeText(this@StudentMainActivity, "Koneksi ke server gagal", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showBkAppointmentDialog() {
        val layout = LinearLayout(this)
        layout.orientation = LinearLayout.VERTICAL
        layout.setPadding(50, 40, 50, 10)

        val etTopic = EditText(this)
        etTopic.hint = "Topik Konseling (Cth: Minat Belajar / Masalah Pribadi)"
        layout.addView(etTopic)

        val etDate = EditText(this)
        etDate.hint = "Pilihan Tanggal (Cth: Besok / Kamis, 28 Agt 2026)"
        layout.addView(etDate)

        val etTime = EditText(this)
        etTime.hint = "Pilihan Jam (Cth: 10:00 WIB / Istirahat Pertama)"
        layout.addView(etTime)

        val counselorLabel = currentCounselorTeacher?.let { " ($it)" } ?: ""

        AlertDialog.Builder(this)
            .setTitle("📅 Ajukan Janji Temu Konseling BK")
            .setMessage("Pilih waktu konsultasi privat tatap muka bersama Guru BK$counselorLabel:")
            .setView(layout)
            .setPositiveButton("Ajukan Jadwal") { _, _ ->
                val topic = etTopic.text.toString().trim()
                val date = etDate.text.toString().trim()
                val time = etTime.text.toString().trim()
                if (topic.isNotEmpty()) {
                    val reportReq = SendReportRequest(
                        category = "JANJI_TEMU",
                        subject = "Janji Temu: $topic",
                        message = "Permohonan jadwal tatap muka: $date pukul $time. Topik: $topic",
                        isAnonymous = false
                    )
                    ApiClient.getClient(this).sendStudentReport(reportReq).enqueue(object : Callback<BasicResponse> {
                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                            Toast.makeText(this@StudentMainActivity, "✅ Permohonan janji temu berhasil dikirim ke Guru BK!", Toast.LENGTH_LONG).show()
                        }
                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                            Toast.makeText(this@StudentMainActivity, "Gagal mengirim janji temu", Toast.LENGTH_SHORT).show()
                        }
                    })
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showBkPointHistoryDialog() {
        val density = resources.displayMetrics.density
        val currentPoints = cachedStudentUserDto?.points ?: 0

        val dialog = android.app.Dialog(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Header Gradient
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#312E81"))
            val hp = (16 * density).toInt()
            val vp = (18 * density).toInt()
            setPadding(hp, vp, hp, vp)
            gravity = Gravity.CENTER_VERTICAL
            elevation = 4 * density
        }

        val btnClose = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams((36 * density).toInt(), (36 * density).toInt())
            setImageResource(com.school.smartcbt.R.drawable.ic_arrow_back)
            setColorFilter(Color.WHITE)
            val p8 = (6 * density).toInt()
            setPadding(p8, p8, p8, p8)
            setOnClickListener { dialog.dismiss() }
        }
        header.addView(btnClose)

        val headerTextCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (12 * density).toInt()
            }
        }

        val tvHeaderTitle = TextView(this).apply {
            text = "Buku Poin & Kedisiplinan Siswa"
            setTextColor(Color.WHITE)
            textSize = 16.5f
            setTypeface(null, Typeface.BOLD)
        }
        val tvHeaderSub = TextView(this).apply {
            text = "Bimbingan Konseling • SMP Negeri 1 Boyolangu"
            setTextColor(Color.parseColor("#C7D2FE"))
            textSize = 11f
            setPadding(0, (2 * density).toInt(), 0, 0)
        }
        headerTextCol.addView(tvHeaderTitle)
        headerTextCol.addView(tvHeaderSub)
        header.addView(headerTextCol)
        root.addView(header)

        // Scroll Container
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            isFillViewport = true
        }

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p16 = (16 * density).toInt()
            setPadding(p16, p16, p16, p16)
        }
        scroll.addView(contentLayout)
        root.addView(scroll)

        // Placeholder Loading Card
        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat data poin kedisiplinan dari server BK..."
            setTextColor(Color.parseColor("#64748B"))
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding(0, (30 * density).toInt(), 0, (30 * density).toInt())
        }
        contentLayout.addView(tvLoading)

        dialog.setContentView(root)
        dialog.show()

        ApiClient.getClient(this).getBkDisciplineRecords().enqueue(object : Callback<com.school.smartcbt.data.model.BkDisciplineListResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.BkDisciplineListResponse>,
                response: Response<com.school.smartcbt.data.model.BkDisciplineListResponse>
            ) {
                contentLayout.removeAllViews()
                val body = response.body()
                val summary = body?.studentSummary
                val pts = summary?.totalViolationPoints ?: currentPoints
                val spStatus = summary?.spStatus ?: when {
                    pts >= 100 -> "SP3"
                    pts >= 50 -> "SP2"
                    pts >= 25 -> "SP1"
                    else -> "AMAN"
                }

                val (spBadgeBg, spBadgeText, spLabel) = when (spStatus) {
                    "SP3" -> Triple("#FEE2E2", "#991B1B", "🚨 SP 3: Panggilan Orang Tua (>= 100 Poin)")
                    "SP2" -> Triple("#FFEDD5", "#C2410C", "🟠 SP 2: Peringatan Tingkat 2 (50 - 99 Poin)")
                    "SP1" -> Triple("#FEF3C7", "#B45309", "🟡 SP 1: Peringatan Tingkat 1 (25 - 49 Poin)")
                    else -> Triple("#DCFCE7", "#15803D", "🟢 AMAN: Bebas Surat Peringatan (< 25 Poin)")
                }

                // 1. CARD GAUGE STATUS KEDISIPLINAN
                val cardOverview = CardView(this@StudentMainActivity).apply {
                    radius = 16 * density
                    cardElevation = 3 * density
                    setCardBackgroundColor(Color.WHITE)
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (14 * density).toInt()
                    }
                    layoutParams = lp
                }

                val overviewBox = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (16 * density).toInt()
                    setPadding(p, p, p, p)
                    gravity = Gravity.CENTER_HORIZONTAL
                }

                val tvPointsBig = TextView(this@StudentMainActivity).apply {
                    text = "$pts"
                    textSize = 42f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(if (pts >= 50) Color.parseColor("#DC2626") else if (pts >= 25) Color.parseColor("#D97706") else Color.parseColor("#059669"))
                }
                overviewBox.addView(tvPointsBig)

                val tvPointsSub = TextView(this@StudentMainActivity).apply {
                    text = "TOTAL POIN PELANGGARAN SISWA"
                    textSize = 10.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#64748B"))
                    letterSpacing = 0.1f
                }
                overviewBox.addView(tvPointsSub)

                // SP Status Pill
                val tvSpPill = TextView(this@StudentMainActivity).apply {
                    text = spLabel
                    textSize = 11.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor(spBadgeText))
                    setBackgroundColor(Color.parseColor(spBadgeBg))
                    val hp = (12 * density).toInt()
                    val vp = (6 * density).toInt()
                    setPadding(hp, vp, hp, vp)
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (10 * density).toInt()
                        bottomMargin = (12 * density).toInt()
                    }
                    layoutParams = lp
                }
                overviewBox.addView(tvSpPill)

                // Progress Bar Ambang Batas SP
                val progressTrack = LinearLayout(this@StudentMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (8 * density).toInt()).apply {
                        topMargin = (6 * density).toInt()
                        bottomMargin = (4 * density).toInt()
                    }
                    setBackgroundColor(Color.parseColor("#E2E8F0"))
                    weightSum = 100f
                }
                val safeRatio = (pts.coerceIn(0, 100)).toFloat()
                if (safeRatio > 0) {
                    val progressFill = View(this@StudentMainActivity).apply {
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, safeRatio)
                        setBackgroundColor(if (pts >= 50) Color.parseColor("#DC2626") else if (pts >= 25) Color.parseColor("#D97706") else Color.parseColor("#059669"))
                    }
                    progressTrack.addView(progressFill)
                }
                overviewBox.addView(progressTrack)

                val tvThresholdLabels = TextView(this@StudentMainActivity).apply {
                    text = "0 Poin (Aman)            25 Poin (SP1)            50 Poin (SP2)            100 Poin (SP3)"
                    textSize = 9.5f
                    setTextColor(Color.parseColor("#94A3B8"))
                    gravity = Gravity.CENTER
                }
                overviewBox.addView(tvThresholdLabels)

                cardOverview.addView(overviewBox)
                contentLayout.addView(cardOverview)

                // 2. SURAT PERINGATAN (JIKA ADA)
                val activeWarnings = summary?.warningLetters ?: emptyList()
                if (activeWarnings.isNotEmpty()) {
                    val cardWarning = CardView(this@StudentMainActivity).apply {
                        radius = 14 * density
                        cardElevation = 2 * density
                        setCardBackgroundColor(Color.parseColor("#FEF2F2"))
                        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (14 * density).toInt()
                        }
                        layoutParams = lp
                    }

                    val wb = LinearLayout(this@StudentMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        val p = (14 * density).toInt()
                        setPadding(p, p, p, p)
                    }

                    val tvWTitle = TextView(this@StudentMainActivity).apply {
                        text = "📄 SURAT PERINGATAN (SP) RESMI TERBIT"
                        textSize = 12.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#991B1B"))
                    }
                    wb.addView(tvWTitle)

                    activeWarnings.forEach { sp ->
                        val tvSpItem = TextView(this@StudentMainActivity).apply {
                            text = "• ${sp.spLevel} (${sp.issuedAt?.take(10) ?: "-"}) — No: ${sp.letterNumber ?: "-"}\n  Catatan: ${sp.reasonSummary ?: "-"}"
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#7F1D1D"))
                            setPadding(0, (4 * density).toInt(), 0, 0)
                        }
                        wb.addView(tvSpItem)
                    }
                    cardWarning.addView(wb)
                    contentLayout.addView(cardWarning)
                }

                // 3. DAFTAR RIWAYAT PELANGGARAN
                val tvSectionTitle = TextView(this@StudentMainActivity).apply {
                    text = "Riwayat Catatan Pelanggaran Tata Tertib"
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#0F172A"))
                    setPadding(0, 0, 0, (8 * density).toInt())
                }
                contentLayout.addView(tvSectionTitle)

                val records = body?.records ?: emptyList()
                if (records.isEmpty()) {
                    val emptyCard = CardView(this@StudentMainActivity).apply {
                        radius = 14 * density
                        setCardBackgroundColor(Color.WHITE)
                        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (14 * density).toInt()
                        }
                        layoutParams = lp
                    }
                    val eb = LinearLayout(this@StudentMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        val p = (24 * density).toInt()
                        setPadding(p, p, p, p)
                        gravity = Gravity.CENTER
                    }
                    val tvCheck = TextView(this@StudentMainActivity).apply {
                        text = "🕊️"
                        textSize = 32f
                    }
                    val tvGood = TextView(this@StudentMainActivity).apply {
                        text = "Catatan Kedisiplinan Bersih"
                        textSize = 13.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#059669"))
                        setPadding(0, (4 * density).toInt(), 0, 0)
                    }
                    val tvGoodSub = TextView(this@StudentMainActivity).apply {
                        text = "Belum ada pelanggaran tata tertib tercatat. Pertahankan prestasi dan sikap disiplin Anda!"
                        textSize = 11.5f
                        setTextColor(Color.parseColor("#64748B"))
                        gravity = Gravity.CENTER
                        setPadding(0, (2 * density).toInt(), 0, 0)
                    }
                    eb.addView(tvCheck)
                    eb.addView(tvGood)
                    eb.addView(tvGoodSub)
                    emptyCard.addView(eb)
                    contentLayout.addView(emptyCard)
                } else {
                    records.forEach { rec ->
                        val rCard = CardView(this@StudentMainActivity).apply {
                            radius = 12 * density
                            cardElevation = 1.5f * density
                            setCardBackgroundColor(Color.WHITE)
                            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                bottomMargin = (10 * density).toInt()
                            }
                            layoutParams = lp
                        }

                        val rb = LinearLayout(this@StudentMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = (12 * density).toInt()
                            setPadding(p, p, p, p)
                        }

                        val topRow = LinearLayout(this@StudentMainActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                        }

                        val tvCat = TextView(this@StudentMainActivity).apply {
                            text = "[${rec.category}]"
                            textSize = 11.5f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#4338CA"))
                        }
                        topRow.addView(tvCat)

                        val spacer = View(this@StudentMainActivity).apply {
                            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
                        }
                        topRow.addView(spacer)

                        val tvPts = TextView(this@StudentMainActivity).apply {
                            text = "+${rec.points} Poin"
                            textSize = 11f
                            setTypeface(null, Typeface.BOLD)
                            setTextColor(Color.parseColor("#DC2626"))
                            setBackgroundColor(Color.parseColor("#FEE2E2"))
                            val hp = (6 * density).toInt()
                            val vp = (2 * density).toInt()
                            setPadding(hp, vp, hp, vp)
                        }
                        topRow.addView(tvPts)
                        rb.addView(topRow)

                        val tvDesc = TextView(this@StudentMainActivity).apply {
                            text = rec.description
                            textSize = 12.5f
                            setTextColor(Color.parseColor("#1E293B"))
                            setPadding(0, (6 * density).toInt(), 0, (4 * density).toInt())
                        }
                        rb.addView(tvDesc)

                        val tvDate = TextView(this@StudentMainActivity).apply {
                            text = "📅 ${rec.createdAt?.take(10) ?: "-"}"
                            textSize = 10f
                            setTextColor(Color.parseColor("#94A3B8"))
                        }
                        rb.addView(tvDate)

                        rCard.addView(rb)
                        contentLayout.addView(rCard)
                    }
                }

                // 4. ACTION BUTTON: KONSULTASI BK
                val btnKonseling = Button(this@StudentMainActivity).apply {
                    text = "💬 Buka Ruang Konseling & Curhat BK"
                    textSize = 13f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#4F46E5"))
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                        topMargin = (10 * density).toInt()
                        bottomMargin = (20 * density).toInt()
                    }
                    layoutParams = lp
                    setOnClickListener {
                        dialog.dismiss()
                        startActivity(Intent(this@StudentMainActivity, KonselingCurhatActivity::class.java))
                    }
                }
                contentLayout.addView(btnKonseling)
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.BkDisciplineListResponse>, t: Throwable) {
                contentLayout.removeAllViews()
                val tvErr = TextView(this@StudentMainActivity).apply {
                    text = "Koneksi terputus ke server BK: ${t.message}"
                    setTextColor(Color.parseColor("#DC2626"))
                    textSize = 13f
                    gravity = Gravity.CENTER
                    setPadding(0, (40 * density).toInt(), 0, (40 * density).toInt())
                }
                contentLayout.addView(tvErr)
            }
        })
    }

    private fun showBkAnnouncementsDialog() {
        val bkAnnounceMsg = """
📢 PENGUMUMAN & KEGIATAN BIMBINGAN KONSELING:

1. 🧭 Tes Minat, Bakat & Gaya Belajar:
   Pelaksanaan tes psikologi peminatan untuk seluruh siswa kelas VII akan diselenggarakan pada hari Sabtu pekan depan via portal online.

2. 🤝 Program Teman Sebaya & Anti-Bullying:
   Sekolah menyediakan ruang konseling terbuka setiap jam istirahat. Segala bentuk perundungan dapat dilaporkan secara rahasia.

3. 📖 Sosialisasi Manajemen Waktu Belajar:
   Materi PDF manajemen waktu dan tips menghadapi ujian PAS dapat diunduh melalui menu E-File Siswa.
        """.trimIndent()

        AlertDialog.Builder(this)
            .setTitle("📢 Informasi & Kegiatan Guru BK")
            .setMessage(bkAnnounceMsg)
            .setPositiveButton("Tutup", null)
            .show()
    }

    private fun showAnonymousBkReportDialog() {
        val view = layoutInflater.inflate(com.school.smartcbt.R.layout.dialog_bk_report, null)
        val etSubject = view.findViewById<EditText>(com.school.smartcbt.R.id.etRepSubject)
        val etMessage = view.findViewById<EditText>(com.school.smartcbt.R.id.etRepMessage)

        AlertDialog.Builder(this)
            .setTitle("🕊️ Ruang Curhat & Lapor BK (Anonim)")
            .setMessage("Nama kamu tidak akan ditampilkan di laporan pada BK (100% Rahasia & Aman).")
            .setView(view)
            .setPositiveButton("Kirim ke Guru BK") { _, _ ->
                val sub = etSubject.text.toString().trim()
                val msg = etMessage.text.toString().trim()
                if (sub.isNotEmpty() && msg.isNotEmpty()) {
                    ApiClient.getClient(this).sendStudentReport(SendReportRequest("BULLYING", sub, msg, true))
                        .enqueue(object : Callback<BasicResponse> {
                            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                Toast.makeText(this@StudentMainActivity, "Pesan berhasil dikirim dengan aman ke Guru BK", Toast.LENGTH_LONG).show()
                            }
                            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                Toast.makeText(this@StudentMainActivity, "Gagal mengirim pesan", Toast.LENGTH_SHORT).show()
                            }
                        })
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun setupHomeworkTabs() {
        binding.btnTabHwAll.setOnClickListener {
            selectedHwTab = 0
            updateHwTabStyles()
            applyHomeworkFilter()
        }
        binding.btnTabHwPending.setOnClickListener {
            selectedHwTab = 1
            updateHwTabStyles()
            applyHomeworkFilter()
        }
        binding.btnTabHwSubmitted.setOnClickListener {
            selectedHwTab = 2
            updateHwTabStyles()
            applyHomeworkFilter()
        }
        binding.btnTabHwGraded.setOnClickListener {
            selectedHwTab = 3
            updateHwTabStyles()
            applyHomeworkFilter()
        }
    }

    private fun updateHwTabStyles() {
        val activeBg = Color.parseColor("#0A2E5C")
        val inactiveBg = Color.TRANSPARENT
        val activeText = Color.WHITE
        val inactiveText = Color.parseColor("#64748B")

        binding.btnTabHwAll.setBackgroundColor(if (selectedHwTab == 0) activeBg else inactiveBg)
        binding.btnTabHwAll.setTextColor(if (selectedHwTab == 0) activeText else inactiveText)

        binding.btnTabHwPending.setBackgroundColor(if (selectedHwTab == 1) activeBg else inactiveBg)
        binding.btnTabHwPending.setTextColor(if (selectedHwTab == 1) activeText else inactiveText)

        binding.btnTabHwSubmitted.setBackgroundColor(if (selectedHwTab == 2) activeBg else inactiveBg)
        binding.btnTabHwSubmitted.setTextColor(if (selectedHwTab == 2) activeText else inactiveText)

        binding.btnTabHwGraded.setBackgroundColor(if (selectedHwTab == 3) activeBg else inactiveBg)
        binding.btnTabHwGraded.setTextColor(if (selectedHwTab == 3) activeText else inactiveText)
    }

    private fun applyHomeworkFilter() {
        val pendingList = allHomeworkList.filter { it.isSubmitted != true }
        renderActiveHomeworkCarousel(pendingList)

        val filtered = when (selectedHwTab) {
            1 -> allHomeworkList.filter { it.isSubmitted != true }
            2 -> allHomeworkList.filter { it.isSubmitted == true }
            3 -> allHomeworkList.filter { it.isSubmitted == true && it.submission?.score != null }
            else -> allHomeworkList
        }

        binding.tvTotalHwCountBadge.text = "${filtered.size} Tugas"
        binding.tvHwListSectionTitle.text = when (selectedHwTab) {
            1 -> "⏳ TUGAS BELUM DIKUMPULKAN"
            2 -> "✅ RIWAYAT TUGAS SELESAI"
            3 -> "⭐ TUGAS SUDAH DINILAI GURU"
            else -> "📋 SEMUA DAFTAR TUGAS KELAS"
        }

        if (filtered.isEmpty()) {
            binding.tvEmptyHomework.visibility = View.VISIBLE
            binding.containerHomeworkList.removeAllViews()
        } else {
            binding.tvEmptyHomework.visibility = View.GONE
            renderHomeworkList(filtered)
        }
    }

    private fun renderActiveHomeworkCarousel(pendingHws: List<HomeworkDto>) {
        binding.containerActiveHomeworkCarousel.removeAllViews()
        val density = resources.displayMetrics.density

        if (pendingHws.isEmpty()) {
            binding.sectionActiveHwCarousel.visibility = View.GONE
            return
        }

        binding.sectionActiveHwCarousel.visibility = View.VISIBLE
        binding.tvActiveHwCountBadge.text = "${pendingHws.size} Tugas Aktif"

        for (hw in pendingHws) {
            val card = CardView(this).apply {
                radius = 16 * density
                cardElevation = 3 * density
                useCompatPadding = true
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    (260 * density).toInt(),
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    marginEnd = (12 * density).toInt()
                    bottomMargin = (6 * density).toInt()
                }
            }

            val cardInner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val pad = (14 * density).toInt()
                setPadding(pad, pad, pad, pad)
            }

            // Top Row: Subject pill + Deadline badge
            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val subjectName = hw.subject?.name ?: "Mata Pelajaran"
            val tvSubj = TextView(this).apply {
                text = "📚 $subjectName"
                setTextColor(Color.parseColor("#1D4ED8"))
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setBackgroundColor(Color.parseColor("#EFF6FF"))
                val p = (4 * density).toInt()
                setPadding(p * 2, p, p * 2, p)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            topRow.addView(tvSubj)
            cardInner.addView(topRow)

            // Title
            val tvTitle = TextView(this).apply {
                text = hw.title
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 14f
                setTypeface(null, Typeface.BOLD)
                maxLines = 2
                android.text.TextUtils.TruncateAt.END
                setPadding(0, (8 * density).toInt(), 0, 0)
            }
            cardInner.addView(tvTitle)

            // Deadline
            val deadlineStr = try {
                val date = hw.deadline.replace("T", " ").substringBefore(".")
                "⏰ Tenggat: $date"
            } catch (e: Exception) {
                "⏰ Tenggat: ${hw.deadline}"
            }
            val tvDeadline = TextView(this).apply {
                text = deadlineStr
                setTextColor(Color.parseColor("#BE123C"))
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, (6 * density).toInt(), 0, (10 * density).toInt())
            }
            cardInner.addView(tvDeadline)

            // Quick Submit Button
            val btnQuickSubmit = Button(this).apply {
                text = "🚀 Kumpulkan Tugas"
                setBackgroundColor(Color.parseColor("#2563EB"))
                setTextColor(Color.WHITE)
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    (38 * density).toInt()
                )
                setOnClickListener {
                    showSubmitHomeworkDialog(hw)
                }
            }
            cardInner.addView(btnQuickSubmit)

            card.addView(cardInner)
            binding.containerActiveHomeworkCarousel.addView(card)
        }
    }

    private fun loadHomeworks() {
        binding.progressHomework.visibility = View.VISIBLE
        binding.tvEmptyHomework.visibility = View.GONE
        binding.containerHomeworkList.removeAllViews()

        ApiClient.getClient(this).getHomeworks().enqueue(object : Callback<List<HomeworkDto>> {
            override fun onResponse(call: Call<List<HomeworkDto>>, response: Response<List<HomeworkDto>>) {
                binding.progressHomework.visibility = View.GONE
                if (response.isSuccessful && response.body() != null) {
                    val rawList = response.body()!!
                    val now = java.util.Date()
                    val isoFmt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault())
                    val isoFmtMs = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS", java.util.Locale.getDefault())
                    val simpleFmt = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.getDefault())

                    // Hilangkan otomatis tugas & PR yang sudah terlewat batas tenggat agar tidak menumpuk
                    allHomeworkList = rawList.filter { hw ->
                        if (hw.isSubmitted == true) return@filter true
                        val dDate = try {
                            val clean = hw.deadline.replace("Z", "")
                            if (clean.contains(".")) isoFmtMs.parse(clean)
                            else if (clean.contains("T")) isoFmt.parse(clean)
                            else simpleFmt.parse(clean)
                        } catch (e: Exception) { null }
                        dDate == null || !now.after(dDate)
                    }

                    val pendingCount = allHomeworkList.count { it.isSubmitted != true }
                    val submittedCount = allHomeworkList.count { it.isSubmitted == true }
                    val gradedCount = allHomeworkList.count { it.isSubmitted == true && it.submission?.score != null }
                    binding.btnTabHwAll.text = "Semua (${allHomeworkList.size})"
                    binding.btnTabHwPending.text = "⏳ Belum ($pendingCount)"
                    binding.btnTabHwSubmitted.text = "✅ Kumpul ($submittedCount)"
                    binding.btnTabHwGraded.text = "⭐ Dinilai ($gradedCount)"
                    if (allHomeworkList.isEmpty()) {
                        binding.tvTugasSummary.text = "Tidak ada tugas atau PR aktif saat ini"
                    } else {
                        binding.tvTugasSummary.text = "Terdapat ${allHomeworkList.size} tugas kelas • Ketuk Buka Inbox"
                    }
                    binding.tvTugasSummary.setOnClickListener { showUnifiedInboxDialog() }
                    updateHomeHomeworkWidget(allHomeworkList)
                    applyHomeworkFilter()

                    com.school.smartcbt.utils.ClientLogger.logHomework(
                        context = this@StudentMainActivity,
                        action = "LIST_HOMEWORKS",
                        outcome = "SUCCESS",
                        message = "Memuat ${allHomeworkList.size} tugas ($pendingCount tertunda)"
                    )
                } else {
                    binding.tvEmptyHomework.visibility = View.VISIBLE
                    binding.tvEmptyHomework.text = "Belum ada tugas atau PR aktif"
                    binding.tvHomeHwPendingCount.text = "Tidak ada tugas aktif"
                    binding.tvTugasSummary.text = "Tidak ada tugas atau PR aktif saat ini"
                    com.school.smartcbt.utils.ClientLogger.logHomework(
                        context = this@StudentMainActivity,
                        action = "LIST_HOMEWORKS",
                        outcome = "REJECTED",
                        message = "Gagal memuat tugas: status ${response.code()}"
                    )
                }
            }

            override fun onFailure(call: Call<List<HomeworkDto>>, t: Throwable) {
                updateServerStatusIndicator(false)
                binding.progressHomework.visibility = View.GONE
                binding.tvEmptyHomework.visibility = View.VISIBLE
                val netErr = sanitizeNetworkErrorMessage(t.message)
                binding.tvEmptyHomework.text = netErr
                binding.tvHomeHwPendingCount.text = "Tidak ada tugas aktif"
                binding.tvTugasSummary.text = "Tidak ada tugas atau PR aktif saat ini"
                com.school.smartcbt.utils.ClientLogger.logHomework(
                    context = this@StudentMainActivity,
                    action = "LIST_HOMEWORKS",
                    outcome = "ERROR",
                    message = "Koneksi tugas terputus: $netErr"
                )
            }
        })
    }

    private fun updateHomeHomeworkWidget(homeworks: List<HomeworkDto>) {
        binding.cardHomeHomeworkOverview.visibility = View.GONE
        val pending = homeworks.filter { it.isSubmitted != true }
        if (homeworks.isEmpty()) {
            binding.tvHomeHwPendingCount.text = "Tidak ada tugas aktif"
            binding.tvHomeHwPendingCount.setTextColor(Color.parseColor("#64748B"))
            binding.containerHomeHwPreview.visibility = View.GONE
        } else if (pending.isEmpty()) {
            binding.tvHomeHwPendingCount.text = "✅ Semua tugas kelas sudah dikerjakan!"
            binding.tvHomeHwPendingCount.setTextColor(Color.parseColor("#059669"))
            binding.containerHomeHwPreview.visibility = View.GONE
        } else {
            binding.tvHomeHwPendingCount.text = "⏳ ${pending.size} tugas & ulangan aktif • Ketuk Buka"
            binding.tvHomeHwPendingCount.setTextColor(Color.parseColor("#DC2626"))
            binding.containerHomeHwPreview.visibility = View.GONE
            binding.containerHomeHwPreview.removeAllViews()
            binding.containerHomeHwPreview.setOnClickListener { showUnifiedInboxDialog() }

            val density = resources.displayMetrics.density
            fun dp(v: Int): Int = (v * density).toInt()

            pending.take(2).forEach { hw ->
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(10), dp(8), dp(10), dp(8))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#F8FAFC"))
                        cornerRadius = dp(10).toFloat()
                        setStroke(dp(1), Color.parseColor("#E2E8F0"))
                    }
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { topMargin = dp(6) }
                }

                val tvSubjBadge = TextView(this).apply {
                    val sName = hw.subject?.name ?: "Mapel"
                    text = sName.take(12)
                    setTextColor(Color.parseColor("#1D4ED8"))
                    textSize = 10f
                    setTypeface(null, Typeface.BOLD)
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#EFF6FF"))
                        cornerRadius = dp(6).toFloat()
                    }
                    setPadding(dp(6), dp(2), dp(6), dp(2))
                }
                row.addView(tvSubjBadge)

                val colInfo = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginStart = dp(8)
                    }
                }

                val tvTitle = TextView(this).apply {
                    text = hw.title
                    setTextColor(Color.parseColor("#0F172A"))
                    textSize = 11.5f
                    setTypeface(null, Typeface.BOLD)
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                }
                colInfo.addView(tvTitle)

                val deadlineStr = try {
                    hw.deadline.replace("T", " ").substringBeforeLast(":")
                } catch (e: Exception) { hw.deadline }

                val tvDue = TextView(this).apply {
                    text = "⏰ Tenggat: $deadlineStr"
                    setTextColor(Color.parseColor("#B91C1C"))
                    textSize = 10f
                }
                colInfo.addView(tvDue)
                row.addView(colInfo)

                binding.containerHomeHwPreview.addView(row)
            }
        }
    }

    private fun renderHomeworkList(homeworks: List<HomeworkDto>) {
        binding.containerHomeworkList.removeAllViews()
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()
        val now = java.util.Date()
        val isoFormat = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault())

        for (hw in homeworks) {
            val isDone = hw.isSubmitted == true
            val submission = hw.submission

            val card = CardView(this).apply {
                radius = 20 * density
                cardElevation = 4 * density
                useCompatPadding = true
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = dp(12)
                }
            }

            val cardInner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(16), dp(16), dp(16))
            }

            // Row 1: Subject badge + Type badge
            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val subjectName = hw.subject?.name ?: "Mata Pelajaran"
            val tvSubject = TextView(this).apply {
                text = "📚 $subjectName"
                setTextColor(Color.parseColor("#1D4ED8"))
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#EFF6FF"))
                    cornerRadius = dp(6).toFloat()
                }
                setPadding(dp(8), dp(3), dp(8), dp(3))
            }
            topRow.addView(tvSubject)

            val isPr = hw.category?.contains("PR", ignoreCase = true) == true || hw.title.contains("PR", ignoreCase = true) || hw.title.contains("Rumah", ignoreCase = true)
            val catLabel = if (isPr) "🏠 Pekerjaan Rumah (PR)" else "📝 Tugas Harian"
            val tvCatBadge = TextView(this).apply {
                text = catLabel
                setTextColor(if (isPr) Color.parseColor("#B45309") else Color.parseColor("#047857"))
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(if (isPr) Color.parseColor("#FFFBEB") else Color.parseColor("#F0FDF4"))
                    cornerRadius = dp(6).toFloat()
                    setStroke(dp(1), if (isPr) Color.parseColor("#FDE68A") else Color.parseColor("#BBF7D0"))
                }
                setPadding(dp(8), dp(3), dp(8), dp(3))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginStart = dp(6) }
            }
            topRow.addView(tvCatBadge)

            val hwType = hw.type ?: "ESSAY"
            val typeLabel = when (hwType) {
                "MULTIPLE_CHOICE" -> "🔘 CBT PG"
                "MIXED" -> "📝 Campuran"
                else -> "✍️ Mandiri / File"
            }
            val tvTypeBadge = TextView(this).apply {
                text = typeLabel
                setTextColor(Color.parseColor("#475569"))
                textSize = 10f
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F1F5F9"))
                    cornerRadius = dp(6).toFloat()
                }
                setPadding(dp(8), dp(3), dp(8), dp(3))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginStart = dp(6) }
            }
            topRow.addView(tvTypeBadge)
            cardInner.addView(topRow)

            // Title
            val tvTitle = TextView(this).apply {
                text = hw.title
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 15f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, dp(8), 0, dp(2))
            }
            cardInner.addView(tvTitle)

            // Description
            if (!hw.description.isNullOrEmpty()) {
                val tvDesc = TextView(this).apply {
                    text = hw.description
                    setTextColor(Color.parseColor("#475569"))
                    textSize = 12f
                    setPadding(0, 0, 0, dp(6))
                }
                cardInner.addView(tvDesc)
            }

            // Deadline with Urgency Evaluation
            var isOverdue = false
            var deadlineDisplay = hw.deadline
            try {
                val parsedDate = if (hw.deadline.contains("T")) isoFormat.parse(hw.deadline) else null
                if (parsedDate != null) {
                    val sdfDisplay = java.text.SimpleDateFormat("dd MMM yyyy, HH:mm", java.util.Locale("id", "ID"))
                    deadlineDisplay = sdfDisplay.format(parsedDate) + " WIB"
                    if (now.after(parsedDate) && !isDone) {
                        isOverdue = true
                    }
                }
            } catch (e: Exception) {}

            val deadlineCard = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(10), dp(6), dp(10), dp(6))
                background = android.graphics.drawable.GradientDrawable().apply {
                    if (isOverdue) {
                        setColor(Color.parseColor("#FEF2F2"))
                        setStroke(dp(1), Color.parseColor("#FECACA"))
                    } else if (isDone) {
                        setColor(Color.parseColor("#F0FDF4"))
                        setStroke(dp(1), Color.parseColor("#BBF7D0"))
                    } else {
                        setColor(Color.parseColor("#FFFBEB"))
                        setStroke(dp(1), Color.parseColor("#FDE68A"))
                    }
                    cornerRadius = dp(8).toFloat()
                }
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = dp(4)
                    bottomMargin = dp(10)
                }
            }

            val tvDeadline = TextView(this).apply {
                if (isOverdue) {
                    text = "🚨 LEWAT TENGGAT: $deadlineDisplay"
                    setTextColor(Color.parseColor("#991B1B"))
                    setTypeface(null, Typeface.BOLD)
                } else if (isDone) {
                    text = "⏰ Tenggat: $deadlineDisplay"
                    setTextColor(Color.parseColor("#166534"))
                } else {
                    text = "⏳ Batas Waktu: $deadlineDisplay"
                    setTextColor(Color.parseColor("#92400E"))
                    setTypeface(null, Typeface.BOLD)
                }
                textSize = 11f
            }
            deadlineCard.addView(tvDeadline)
            cardInner.addView(deadlineCard)

            // Status & Submission Details
            if (isDone) {
                val hasScore = submission?.score != null
                val resultCard = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(12), dp(10), dp(12), dp(10))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(if (hasScore) Color.parseColor("#F0FDF4") else Color.parseColor("#EFF6FF"))
                        cornerRadius = dp(10).toFloat()
                        setStroke(dp(1), if (hasScore) Color.parseColor("#86EFAC") else Color.parseColor("#BFDBFE"))
                    }
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { bottomMargin = dp(8) }
                }

                val scoreText = if (hasScore) {
                    "⭐ Nilai: ${submission?.score?.toInt()}/100"
                } else {
                    "⏳ Status: Menunggu Penilaian Guru"
                }

                val tvScore = TextView(this).apply {
                    text = scoreText
                    setTextColor(if (hasScore) Color.parseColor("#15803D") else Color.parseColor("#1E40AF"))
                    textSize = 13f
                    setTypeface(null, Typeface.BOLD)
                }
                resultCard.addView(tvScore)

                if (!submission?.teacherNote.isNullOrEmpty()) {
                    val tvTeacherNote = TextView(this).apply {
                        text = "💬 Catatan Guru: \"${submission.teacherNote}\""
                        setTextColor(Color.parseColor("#047857"))
                        textSize = 11.5f
                        setPadding(0, dp(4), 0, 0)
                    }
                    resultCard.addView(tvTeacherNote)
                }
                cardInner.addView(resultCard)

                val btnRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        dp(42)
                    )
                }

                val btnDetail = Button(this).apply {
                    text = "📄 Detail & Soal"
                    setBackgroundColor(Color.parseColor("#E2E8F0"))
                    setTextColor(Color.parseColor("#334155"))
                    textSize = 11f
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                        marginEnd = dp(4)
                    }
                    setOnClickListener {
                        showHomeworkDetailDialog(hw)
                    }
                }
                btnRow.addView(btnDetail)

                val btnViewSub = Button(this).apply {
                    text = "👁️ Jawaban Saya"
                    setBackgroundColor(Color.parseColor("#EFF6FF"))
                    setTextColor(Color.parseColor("#1D4ED8"))
                    textSize = 11f
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                        marginStart = dp(4)
                    }
                    setOnClickListener {
                        val fileInfo = if (!submission?.fileUrl.isNullOrEmpty()) "\n📎 Lampiran: ${submission.fileUrl}" else ""
                        AlertDialog.Builder(this@StudentMainActivity)
                            .setTitle("📄 Jawaban: ${hw.title}")
                            .setMessage("Catatan Anda:\n${submission?.notes ?: "Jawaban telah dikirimkan."}$fileInfo\n\nDikirim pada: ${submission?.submittedAt?.replace("T", " ")?.substringBefore(".") ?: "-"}")
                            .setPositiveButton("Tutup", null)
                            .show()
                    }
                }
                btnRow.addView(btnViewSub)
                cardInner.addView(btnRow)
            } else {
                val btnRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        dp(44)
                    )
                }

                val btnDetail = Button(this).apply {
                    text = "📄 Detail & Soal"
                    setBackgroundColor(Color.parseColor("#F1F5F9"))
                    setTextColor(Color.parseColor("#334155"))
                    textSize = 11f
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                        marginEnd = dp(4)
                    }
                    setOnClickListener {
                        showHomeworkDetailDialog(hw)
                    }
                }
                btnRow.addView(btnDetail)

                val btnSubmit = Button(this).apply {
                    text = if (isOverdue) "📤 Kumpul Telat" else "📤 Kerjakan Tugas"
                    setBackgroundColor(if (isOverdue) Color.parseColor("#DC2626") else Color.parseColor("#2563EB"))
                    setTextColor(Color.WHITE)
                    textSize = 11f
                    setTypeface(null, Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.2f).apply {
                        marginStart = dp(4)
                    }
                    setOnClickListener {
                        showSubmitHomeworkDialog(hw)
                    }
                }
                btnRow.addView(btnSubmit)
                cardInner.addView(btnRow)
            }

            card.setOnClickListener {
                showHomeworkDetailDialog(hw)
            }

            card.addView(cardInner)
            binding.containerHomeworkList.addView(card)
        }
    }

    private fun showHomeworkDetailDialog(hw: HomeworkDto) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val sv = ScrollView(this)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(20))
        }

        val isPr = hw.category?.contains("PR", ignoreCase = true) == true || hw.title.contains("PR", ignoreCase = true) || hw.title.contains("Rumah", ignoreCase = true)
        val catText = if (isPr) "🏠 PEKERJAAN RUMAH (PR MANDIRI)" else "📝 TUGAS HARIAN KELAS"
        val tvCat = TextView(this).apply {
            text = catText
            setTextColor(if (isPr) Color.parseColor("#B45309") else Color.parseColor("#047857"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
        }
        container.addView(tvCat)

        val tvTitle = TextView(this).apply {
            text = hw.title
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, dp(4), 0, dp(6))
        }
        container.addView(tvTitle)

        val subjectName = hw.subject?.name ?: "Mata Pelajaran"
        val tvSubj = TextView(this).apply {
            text = "📚 Mapel: $subjectName"
            setTextColor(Color.parseColor("#1D4ED8"))
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
        }
        container.addView(tvSubj)

        val tvDue = TextView(this).apply {
            text = "⏰ Batas Akhir: ${hw.deadline.replace("T", " ").substringBeforeLast(":")} WIB"
            setTextColor(Color.parseColor("#DC2626"))
            textSize = 12f
            setPadding(0, dp(4), 0, dp(12))
        }
        container.addView(tvDue)

        // Instructions Card
        val instrCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), Color.parseColor("#E2E8F0"))
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        }
        val tvInstrHead = TextView(this).apply {
            text = "📋 Petunjuk / Deskripsi Pengerjaan:"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
        }
        val tvInstrBody = TextView(this).apply {
            text = if (!hw.description.isNullOrEmpty()) hw.description else "Kerjakan tugas ini dengan teliti sesuai arahan guru mata pelajaran."
            setTextColor(Color.parseColor("#334155"))
            textSize = 12f
            setPadding(0, dp(6), 0, 0)
        }
        instrCard.addView(tvInstrHead)
        instrCard.addView(tvInstrBody)
        container.addView(instrCard)

        // Attachment file button if available
        if (!hw.fileUrl.isNullOrEmpty()) {
            val btnFile = Button(this).apply {
                text = "📥 Buka / Unduh Berkas Soal Guru"
                setBackgroundColor(Color.parseColor("#0284C7"))
                setTextColor(Color.WHITE)
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(44)
                ).apply { bottomMargin = dp(12) }
                setOnClickListener {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(hw.fileUrl)))
                    } catch (e: Exception) {
                        Toast.makeText(this@StudentMainActivity, "Tidak dapat membuka link berkas", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            container.addView(btnFile)
        }

        // Submission Status
        val isDone = hw.isSubmitted == true
        val submission = hw.submission
        if (isDone) {
            val subCard = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F0FDF4"))
                    cornerRadius = dp(10).toFloat()
                    setStroke(dp(1), Color.parseColor("#86EFAC"))
                }
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(12) }
            }
            val tvSubHead = TextView(this).apply {
                text = "✅ Status: Tugas Telah Dikumpulkan"
                setTextColor(Color.parseColor("#15803D"))
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
            }
            val tvSubScore = TextView(this).apply {
                text = if (submission?.score != null) "⭐ Nilai: ${submission.score.toInt()}/100" else "⏳ Belum dinilai oleh guru pengampu"
                setTextColor(Color.parseColor("#166534"))
                textSize = 12f
                setPadding(0, dp(4), 0, 0)
            }
            val tvSubNotes = TextView(this).apply {
                text = "Jawaban Anda: ${submission?.notes ?: "Terkirim"}"
                setTextColor(Color.parseColor("#334155"))
                textSize = 11.5f
                setPadding(0, dp(4), 0, 0)
            }
            subCard.addView(tvSubHead)
            subCard.addView(tvSubScore)
            subCard.addView(tvSubNotes)
            container.addView(subCard)
        }

        sv.addView(container)

        val dialog = AlertDialog.Builder(this)
            .setTitle("📖 Lembar Tugas & PR Siswa")
            .setView(sv)
            .setPositiveButton(if (isDone) "Tutup" else "Kerjakan & Kumpulkan") { _, _ ->
                if (!isDone) {
                    showSubmitHomeworkDialog(hw)
                }
            }
        if (!isDone) {
            dialog.setNegativeButton("Tutup", null)
        }
        dialog.show()
    }

    // ==========================================
    // KARTU PELAJAR DIGITAL (QR & BARCODE ZXING)
    // ==========================================
    private fun showStudentIdCardDialog() {
        val density = resources.displayMetrics.density
        val sName = sessionManager.getName().ifEmpty { "Peserta Didik" }
        val sNisn = sessionManager.getNisn().ifEmpty { "131412082" }
        val sClass = sessionManager.getClassName().ifEmpty { "VII-A" }

        val qrCodeData = sNisn
        val qrBitmap = generateQrBitmap(qrCodeData, 360)
        val barcodeBitmap = generateBarcodeBitmap(sNisn, 480, 140)

        val scroll = android.widget.ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#0B192C"))
        }

        // Header Kartu
        val tvSchool = TextView(this).apply {
            text = "KARTU PELAJAR ELEKTRONIK"
            setTextColor(Color.parseColor("#F59E0B"))
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        root.addView(tvSchool)

        val tvSubSchool = TextView(this).apply {
            text = "SMART SCHOOL DIGITAL IDENTITY • SISTEM TERPADU"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 9f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, (14 * density).toInt())
        }
        root.addView(tvSubSchool)

        // Card Identitas
        val cardId = CardView(this).apply {
            radius = 16 * density
            cardElevation = 4 * density
            useCompatPadding = true
            setCardBackgroundColor(Color.WHITE)
        }

        val cardLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val cp = (16 * density).toInt()
            setPadding(cp, cp, cp, cp)
        }

        // Top info: Avatar + Name + NISN + Kelas
        val rowIdent = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val cardAvatar = CardView(this).apply {
            radius = 28 * density
            cardElevation = 0f
            layoutParams = LinearLayout.LayoutParams((56 * density).toInt(), (56 * density).toInt())
            setCardBackgroundColor(Color.parseColor("#E2E8F0"))
        }

        val ivAvatarCard = ImageView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            scaleType = ImageView.ScaleType.CENTER_CROP
            if (binding.ivProfileAvatar.drawable != null) {
                setImageDrawable(binding.ivProfileAvatar.drawable)
            } else {
                setImageResource(com.school.smartcbt.R.drawable.ic_default_avatar)
            }
        }
        cardAvatar.addView(ivAvatarCard)
        rowIdent.addView(cardAvatar)

        val colText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (12 * density).toInt()
            }
        }

        val tvNameCard = TextView(this).apply {
            text = sName
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        }
        colText.addView(tvNameCard)

        val tvNisnCard = TextView(this).apply {
            text = "NISN: $sNisn"
            setTextColor(Color.parseColor("#475569"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
        }
        colText.addView(tvNisnCard)

        val tvClassCard = TextView(this).apply {
            text = "Rombel: $sClass • Status: SISWA AKTIF"
            setTextColor(Color.parseColor("#047857"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
        }
        colText.addView(tvClassCard)

        rowIdent.addView(colText)
        cardLayout.addView(rowIdent)

        // Divider
        val div = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (1 * density).toInt()
            ).apply {
                topMargin = (12 * density).toInt()
                bottomMargin = (12 * density).toInt()
            }
            setBackgroundColor(Color.parseColor("#E2E8F0"))
        }
        cardLayout.addView(div)

        // QR Code Image
        val ivQr = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams((180 * density).toInt(), (180 * density).toInt()).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
            if (qrBitmap != null) setImageBitmap(qrBitmap)
        }
        cardLayout.addView(ivQr)

        val tvQrHint = TextView(this).apply {
            text = "Pindai QR ini untuk Absensi Gerbang, UKS, & Perpustakaan"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 10f
            gravity = Gravity.CENTER
            setPadding(0, (6 * density).toInt(), 0, (8 * density).toInt())
        }
        cardLayout.addView(tvQrHint)

        // Barcode Image
        if (barcodeBitmap != null) {
            val ivBarcode = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    (48 * density).toInt()
                ).apply {
                    topMargin = (4 * density).toInt()
                }
                scaleType = ImageView.ScaleType.FIT_XY
                setImageBitmap(barcodeBitmap)
            }
            cardLayout.addView(ivBarcode)

            val tvBarcodeText = TextView(this).apply {
                text = "* $sNisn *"
                setTextColor(Color.parseColor("#334155"))
                textSize = 11f
                typeface = Typeface.MONOSPACE
                gravity = Gravity.CENTER
            }
            cardLayout.addView(tvBarcodeText)
        }

        // Info RFID / NFC
        val tvRfidNote = TextView(this).apply {
            text = "💡 Kompatibel dengan Scanner Laser Perpustakaan, Barcode UKS, Gate Masuk/Pulang & Kartu RFID Sekolah"
            setTextColor(Color.parseColor("#1D4ED8"))
            textSize = 9f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#EFF6FF"))
            val p = (8 * density).toInt()
            setPadding(p, p, p, p)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = (10 * density).toInt()
            }
        }
        cardLayout.addView(tvRfidNote)

        cardId.addView(cardLayout)
        root.addView(cardId)

        // Tombol Tutup
        val btnClose = Button(this).apply {
            text = "Tutup Kartu"
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = (14 * density).toInt()
            }
        }
        root.addView(btnClose)
        scroll.addView(root)

        val dialog = AlertDialog.Builder(this)
            .setView(scroll)
            .create()

        btnClose.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    private fun showStudentBiodataDialog() {
        if (cachedStudentUserDto == null) {
            val cachedJson = sessionManager.getStudentProfileJson()
            if (!cachedJson.isNullOrEmpty()) {
                try {
                    cachedStudentUserDto = com.google.gson.Gson().fromJson(cachedJson, com.school.smartcbt.data.model.StudentUserDto::class.java)
                } catch (e: Exception) {}
            }
        }
        val p = cachedStudentUserDto
        val density = resources.displayMetrics.density

        val dialog = android.app.Dialog(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        // ================= BEAUTIFUL COLORED HEADER =================
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(com.school.smartcbt.R.drawable.bg_biodata_header_gradient)
            val pHorizontal = (16 * density).toInt()
            val pTop = (16 * density).toInt()
            val pBottom = (20 * density).toInt()
            setPadding(pHorizontal, pTop, pHorizontal, pBottom)
        }

        // Top Navigation Bar inside Header
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val btnBack = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams((36 * density).toInt(), (36 * density).toInt())
            setImageResource(com.school.smartcbt.R.drawable.ic_arrow_back)
            setColorFilter(Color.WHITE)
            val p8 = (6 * density).toInt()
            setPadding(p8, p8, p8, p8)
            setOnClickListener { dialog.dismiss() }
        }
        topBar.addView(btnBack)

        val tvTitleHeader = TextView(this).apply {
            text = "📋 Profile Data Diri Siswa"
            setTextColor(Color.WHITE)
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (10 * density).toInt()
            }
        }
        topBar.addView(tvTitleHeader)

        header.addView(topBar)

        // Hero Profile Row inside Header
        val heroRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (16 * density).toInt()
            }
        }

        val ivAvatar = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams((56 * density).toInt(), (56 * density).toInt())
            setImageResource(com.school.smartcbt.R.drawable.ic_default_avatar)
        }
        val currentPhotoUrl = p?.profilePicUrl ?: sessionManager.getProfilePicUrl()
        if (!currentPhotoUrl.isNullOrEmpty()) {
            loadAvatarIntoImageView(currentPhotoUrl, ivAvatar)
        }
        heroRow.addView(ivAvatar)

        val heroTextCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (14 * density).toInt()
            }
        }

        val tvName = TextView(this).apply {
            text = p?.name ?: sessionManager.getName().ifEmpty { "Peserta Didik" }
            setTextColor(Color.WHITE)
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
        }
        heroTextCol.addView(tvName)

        val tvSub = TextView(this).apply {
            text = "NISN: ${p?.nisn ?: sessionManager.getNisn().ifEmpty { "-" }} • Rombel Kelas ${p?.className ?: sessionManager.getClassName().ifEmpty { "-" }}"
            setTextColor(Color.parseColor("#BAE6FD"))
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (2 * density).toInt()
            }
        }
        heroTextCol.addView(tvSub)

        heroRow.addView(heroTextCol)
        header.addView(heroRow)

        root.addView(header)

        // ================= SCROLLABLE CONTENT BODY =================
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            isFillViewport = true
        }

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pPad = (16 * density).toInt()
            setPadding(pPad, pPad, pPad, pPad)
        }

        fun createSectionCard(title: String, icon: String, items: List<Pair<String, String>>): CardView {
            val card = CardView(this).apply {
                radius = 12 * density
                cardElevation = 2 * density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                lp.setMargins(0, 0, 0, (14 * density).toInt())
                layoutParams = lp
            }

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p12 = (14 * density).toInt()
                setPadding(p12, p12, p12, p12)
            }

            val secTitle = TextView(this).apply {
                text = "$icon $title"
                setTextColor(Color.parseColor("#0369A1"))
                textSize = 13.5f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, 0, 0, (8 * density).toInt())
            }
            container.addView(secTitle)

            items.forEachIndexed { idx, pair ->
                if (idx > 0) {
                    val divider = View(this).apply {
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1 * density).toInt()).apply {
                            setMargins(0, (6 * density).toInt(), 0, (6 * density).toInt())
                        }
                        setBackgroundColor(Color.parseColor("#F1F5F9"))
                    }
                    container.addView(divider)
                }

                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                }
                val tvLabel = TextView(this).apply {
                    text = pair.first
                    setTextColor(Color.parseColor("#64748B"))
                    textSize = 11.5f
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                val tvValue = TextView(this).apply {
                    text = pair.second.ifBlank { "-" }
                    setTextColor(Color.parseColor("#1E293B"))
                    textSize = 12f
                    setTypeface(null, Typeface.BOLD)
                    gravity = Gravity.END
                }
                row.addView(tvLabel)
                row.addView(tvValue)
                container.addView(row)
            }

            card.addView(container)
            return card
        }

        // Section 1: Identitas Utama
        val sec1 = createSectionCard("Identitas Utama", "👤", listOf(
            "Nama Lengkap" to (p?.name ?: sessionManager.getName().ifEmpty { "Peserta Didik" }),
            "NISN" to (p?.nisn ?: sessionManager.getNisn().ifEmpty { "-" }),
            "NIS" to (p?.nis ?: "-"),
            "Username / ID" to "@${p?.username ?: sessionManager.getUsername()}",
            "Rombel / Kelas" to (p?.className ?: sessionManager.getClassName().ifEmpty { "-" })
        ))
        contentLayout.addView(sec1)

        // Section 2: Kelahiran & Gender
        val dobFormatted = if (!p?.pob.isNullOrEmpty() && !p?.dob.isNullOrEmpty()) "${p?.pob}, ${p?.dob}" else (p?.dob ?: p?.pob ?: "-")
        val sec2 = createSectionCard("Kelahiran & Jenis Kelamin", "📅", listOf(
            "Tempat, Tgl Lahir" to dobFormatted,
            "Jenis Kelamin" to (p?.gender ?: "-"),
            "Agama" to (p?.religion ?: "-")
        ))
        contentLayout.addView(sec2)

        // Section 3: Kontak & Orang Tua / Wali
        val sec3 = createSectionCard("Alamat & Orang Tua / Wali", "🏠", listOf(
            "Alamat Rumah" to (p?.address ?: "-"),
            "Nama Ayah" to (p?.fatherName ?: "-"),
            "Nama Ibu" to (p?.motherName ?: "-"),
            "No. Telp Ortu/Wali" to (p?.parentPhone ?: "-")
        ))
        contentLayout.addView(sec3)

        // Section 4: Pembimbing & Kesehatan
        val sec4 = createSectionCard("Akademik & Kesehatan", "🏥", listOf(
            "Wali Kelas" to (p?.homeroomTeacher ?: "-"),
            "Guru BK Pembimbing" to (p?.counselorTeacher ?: "-"),
            "Golongan Darah" to (p?.bloodType ?: "O (Rhesus +)"),
            "Catatan Kesehatan/Alergi" to (p?.allergies ?: "Tidak Ada Alergi"),
            "Poin Disiplin" to "${p?.points ?: 100} Poin"
        ))
        contentLayout.addView(sec4)

        // Bottom Close Button Container inside Content
        val btnCloseFull = Button(this).apply {
            text = "Tutup Biodata Siswa"
            setBackgroundColor(Color.parseColor("#0F172A"))
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                topMargin = (6 * density).toInt()
                bottomMargin = (16 * density).toInt()
            }
            setOnClickListener { dialog.dismiss() }
        }
        contentLayout.addView(btnCloseFull)

        scroll.addView(contentLayout)
        root.addView(scroll)

        dialog.setContentView(root)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.show()

        // ================= BACKGROUND LIVE SYNC DARI VPS =================
        ApiClient.getClient(this).getStudentProfile().enqueue(object : Callback<com.school.smartcbt.data.model.StudentProfileResponse> {
            override fun onResponse(call: Call<com.school.smartcbt.data.model.StudentProfileResponse>, response: Response<com.school.smartcbt.data.model.StudentProfileResponse>) {
                val live = response.body()?.user ?: response.body()?.data
                if (live != null && dialog.isShowing) {
                    cachedStudentUserDto = live
                    try {
                        sessionManager.saveStudentProfileJson(com.google.gson.Gson().toJson(live))
                    } catch (e: Exception) {}
                    if (!live.profilePicUrl.isNullOrEmpty()) {
                        sessionManager.saveProfilePicUrl(live.profilePicUrl)
                    }

                    runOnUiThread {
                        if (!dialog.isShowing) return@runOnUiThread
                        tvName.text = live.name
                        tvSub.text = "NISN: ${live.nisn ?: "-"} • Rombel Kelas ${live.className ?: "-"}"
                        if (!live.profilePicUrl.isNullOrEmpty()) {
                            loadAvatarIntoImageView(live.profilePicUrl, ivAvatar)
                        }

                        // Re-render isi contentLayout secara dinamis
                        contentLayout.removeAllViews()

                        val newSec1 = createSectionCard("Identitas Utama", "👤", listOf(
                            "Nama Lengkap" to live.name,
                            "NISN" to (live.nisn ?: "-"),
                            "NIS" to (live.nis ?: "-"),
                            "Username / ID" to "@${live.username ?: sessionManager.getUsername()}",
                            "Rombel / Kelas" to (live.className ?: "-")
                        ))
                        contentLayout.addView(newSec1)

                        val newDob = if (!live.pob.isNullOrEmpty() && !live.dob.isNullOrEmpty()) "${live.pob}, ${live.dob}" else (live.dob ?: live.pob ?: "-")
                        val newSec2 = createSectionCard("Kelahiran & Jenis Kelamin", "📅", listOf(
                            "Tempat, Tgl Lahir" to newDob,
                            "Jenis Kelamin" to (live.gender ?: "-"),
                            "Agama" to (live.religion ?: "-")
                        ))
                        contentLayout.addView(newSec2)

                        val newSec3 = createSectionCard("Alamat & Orang Tua / Wali", "🏠", listOf(
                            "Alamat Rumah" to (live.address ?: "-"),
                            "Nama Ayah" to (live.fatherName ?: "-"),
                            "Nama Ibu" to (live.motherName ?: "-"),
                            "No. Telp Ortu/Wali" to (live.parentPhone ?: "-")
                        ))
                        contentLayout.addView(newSec3)

                        val newSec4 = createSectionCard("Akademik & Kesehatan", "🏥", listOf(
                            "Wali Kelas" to (live.homeroomTeacher ?: "-"),
                            "Guru BK Pembimbing" to (live.counselorTeacher ?: "-"),
                            "Golongan Darah" to (live.bloodType ?: "O (Rhesus +)"),
                            "Catatan Kesehatan/Alergi" to (live.allergies ?: "Tidak Ada Alergi"),
                            "Poin Disiplin" to "${live.points ?: 100} Poin"
                        ))
                        contentLayout.addView(newSec4)

                        contentLayout.addView(btnCloseFull)
                    }
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.StudentProfileResponse>, t: Throwable) {
                // Background sync silent fail
            }
        })
    }

    private fun showSubjectAttendanceDialog() {
        Toast.makeText(this, "Memuat rekap presensi per jam pelajaran...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getStudentSubjectAttendanceSummary().enqueue(object : Callback<SubjectAttendanceResponse> {
            override fun onResponse(call: Call<SubjectAttendanceResponse>, response: Response<SubjectAttendanceResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val data = response.body()!!
                    renderSubjectAttendanceDialog(data)
                } else {
                    Toast.makeText(this@StudentMainActivity, "Gagal memuat data presensi mapel", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<SubjectAttendanceResponse>, t: Throwable) {
                Toast.makeText(this@StudentMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderSubjectAttendanceDialog(data: SubjectAttendanceResponse) {
        val density = resources.displayMetrics.density

        val dialog = android.app.Dialog(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }

        // Colored Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(com.school.smartcbt.R.drawable.bg_matpel_header_gradient)
            val pHorizontal = (16 * density).toInt()
            val pTop = (16 * density).toInt()
            val pBottom = (20 * density).toInt()
            setPadding(pHorizontal, pTop, pHorizontal, pBottom)
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val btnBack = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams((36 * density).toInt(), (36 * density).toInt())
            setImageResource(com.school.smartcbt.R.drawable.ic_arrow_back)
            setColorFilter(Color.WHITE)
            val p8 = (6 * density).toInt()
            setPadding(p8, p8, p8, p8)
            setOnClickListener { dialog.dismiss() }
        }
        topBar.addView(btnBack)

        val tvTitleHeader = TextView(this).apply {
            text = "📚 Rekap Presensi Per Jam Pelajaran (JP)"
            setTextColor(Color.WHITE)
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (10 * density).toInt()
            }
        }
        topBar.addView(tvTitleHeader)

        header.addView(topBar)

        val heroRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (12 * density).toInt()
            }
        }

        val tvName = TextView(this).apply {
            text = "${data.studentName ?: sessionManager.getName()} • Kelas ${data.className ?: sessionManager.getClassName()}"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        }
        heroRow.addView(tvName)

        val tvSub = TextView(this).apply {
            text = "Total ${data.totalSubjects ?: 0} Mata Pelajaran Terdaftar"
            setTextColor(Color.parseColor("#BAE6FD"))
            textSize = 11.5f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (2 * density).toInt()
            }
        }
        heroRow.addView(tvSub)

        header.addView(heroRow)
        root.addView(header)

        // Scrollable Subjects List
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            isFillViewport = true
        }

        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pPad = (16 * density).toInt()
            setPadding(pPad, pPad, pPad, pPad)
        }

        val subjects = data.subjects ?: emptyList()
        if (subjects.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada catatan presensi mata pelajaran."
                setTextColor(Color.parseColor("#64748B"))
                textSize = 13f
                gravity = Gravity.CENTER
                setPadding(0, (40 * density).toInt(), 0, (40 * density).toInt())
            }
            contentLayout.addView(tvEmpty)
        } else {
            subjects.forEach { item ->
                val card = CardView(this).apply {
                    radius = 16 * density
                    cardElevation = 2.5f * density
                    setCardBackgroundColor(Color.WHITE)
                    useCompatPadding = true
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    lp.setMargins(0, 0, 0, (10 * density).toInt())
                    layoutParams = lp
                }

                val itemBox = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    val p16 = (16 * density).toInt()
                    setPadding(p16, p16, p16, p16)
                }

                // Row Atas: Judul Mapel & Badge Persentase
                val rowHeader = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                }

                val titleCol = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginEnd = (8 * density).toInt()
                    }
                }

                val tvSubject = TextView(this).apply {
                    text = item.subjectName
                    setTextColor(Color.parseColor("#0F172A"))
                    textSize = 14.5f
                    setTypeface(null, Typeface.BOLD)
                }
                titleCol.addView(tvSubject)

                val tvTeacher = TextView(this).apply {
                    text = "👨‍🏫 ${item.teacherName ?: "Pengampu Mapel"}"
                    setTextColor(Color.parseColor("#64748B"))
                    textSize = 11.5f
                    setPadding(0, (2 * density).toInt(), 0, 0)
                }
                titleCol.addView(tvTeacher)

                rowHeader.addView(titleCol)

                // Persentase Badge Pill Rounded
                val isHigh = item.percentage >= 85
                val isMed = item.percentage >= 70
                val prcBgColor = if (isHigh) "#DCFCE7" else if (isMed) "#FEF3C7" else "#FEE2E2"
                val prcTextColor = if (isHigh) "#15803D" else if (isMed) "#B45309" else "#B91C1C"

                val tvPrc = TextView(this).apply {
                    text = "${item.percentage}% Kehadiran"
                    setTextColor(Color.parseColor(prcTextColor))
                    textSize = 11f
                    setTypeface(null, Typeface.BOLD)
                    val shape = GradientDrawable().apply {
                        setColor(Color.parseColor(prcBgColor))
                        cornerRadius = 10 * density
                    }
                    background = shape
                    val hp = (10 * density).toInt()
                    val vp = (4 * density).toInt()
                    setPadding(hp, vp, hp, vp)
                }
                rowHeader.addView(tvPrc)
                itemBox.addView(rowHeader)

                // Mini Visual Progress Bar
                val progressTrack = LinearLayout(this).apply {
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (6 * density).toInt()).apply {
                        topMargin = (12 * density).toInt()
                        bottomMargin = (12 * density).toInt()
                    }
                    val trackShape = GradientDrawable().apply {
                        setColor(Color.parseColor("#E2E8F0"))
                        cornerRadius = 3 * density
                    }
                    background = trackShape
                    weightSum = 100f
                }

                val safePrc = item.percentage.coerceIn(0, 100).toFloat()
                if (safePrc > 0f) {
                    val progressFill = View(this).apply {
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, safePrc)
                        val fillShape = GradientDrawable().apply {
                            setColor(Color.parseColor(if (isHigh) "#10B981" else if (isMed) "#F59E0B" else "#EF4444"))
                            cornerRadius = 3 * density
                        }
                        background = fillShape
                    }
                    progressTrack.addView(progressFill)
                }
                itemBox.addView(progressTrack)

                // Grid 4 Kolom Presisi (Hadir, Sakit, Izin, Alpa)
                val statsGrid = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    weightSum = 4f
                }

                fun createMetricBox(label: String, count: Int, bgHex: String, textHex: String, isFirst: Boolean, isLast: Boolean): LinearLayout {
                    return LinearLayout(this).apply {
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                            marginStart = if (isFirst) 0 else (3 * density).toInt()
                            marginEnd = if (isLast) 0 else (3 * density).toInt()
                        }
                        orientation = LinearLayout.VERTICAL
                        gravity = Gravity.CENTER
                        val shape = GradientDrawable().apply {
                            setColor(Color.parseColor(bgHex))
                            cornerRadius = 8 * density
                        }
                        background = shape
                        val vp = (8 * density).toInt()
                        val hp = (4 * density).toInt()
                        setPadding(hp, vp, hp, vp)

                        val tvCount = TextView(this@StudentMainActivity).apply {
                            text = "$count"
                            setTextColor(Color.parseColor(textHex))
                            textSize = 14f
                            setTypeface(null, Typeface.BOLD)
                            gravity = Gravity.CENTER
                        }
                        val tvLbl = TextView(this@StudentMainActivity).apply {
                            text = label
                            setTextColor(Color.parseColor(textHex))
                            textSize = 10f
                            gravity = Gravity.CENTER
                            setPadding(0, (2 * density).toInt(), 0, 0)
                        }
                        addView(tvCount)
                        addView(tvLbl)
                    }
                }

                statsGrid.addView(createMetricBox("Hadir", item.present, "#DCFCE7", "#15803D", isFirst = true, isLast = false))
                statsGrid.addView(createMetricBox("Sakit", item.sick, "#E0F2FE", "#0369A1", isFirst = false, isLast = false))
                statsGrid.addView(createMetricBox("Izin", item.permission, "#FEF3C7", "#B45309", isFirst = false, isLast = false))
                statsGrid.addView(createMetricBox("Alpa", item.truant, "#FFE4E6", "#BE123C", isFirst = false, isLast = true))
                itemBox.addView(statsGrid)

                card.addView(itemBox)
                contentLayout.addView(card)
            }
        }

        val btnCloseFull = Button(this).apply {
            text = "Tutup Rekap Presensi Mapel"
            setBackgroundColor(Color.parseColor("#0F172A"))
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                topMargin = (6 * density).toInt()
                bottomMargin = (16 * density).toInt()
            }
            setOnClickListener { dialog.dismiss() }
        }
        contentLayout.addView(btnCloseFull)

        scroll.addView(contentLayout)
        root.addView(scroll)

        dialog.setContentView(root)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.show()
    }

    private fun generateQrBitmap(content: String, size: Int): Bitmap? {
        return try {
            val hints = HashMap<EncodeHintType, Any>()
            hints[EncodeHintType.MARGIN] = 1
            val bitMatrix = QRCodeWriter().encode(
                content,
                BarcodeFormat.QR_CODE,
                size,
                size,
                hints
            )
            val width = bitMatrix.width
            val height = bitMatrix.height
            val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
            for (x in 0 until width) {
                for (y in 0 until height) {
                    bmp.setPixel(x, y, if (bitMatrix.get(x, y)) Color.BLACK else Color.WHITE)
                }
            }
            bmp
        } catch (e: Exception) {
            null
        }
    }

    private fun generateBarcodeBitmap(content: String, width: Int, height: Int): Bitmap? {
        return try {
            val bitMatrix = Code128Writer().encode(
                content,
                BarcodeFormat.CODE_128,
                width,
                height
            )
            val w = bitMatrix.width
            val h = bitMatrix.height
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
            for (x in 0 until w) {
                for (y in 0 until h) {
                    bmp.setPixel(x, y, if (bitMatrix.get(x, y)) Color.BLACK else Color.WHITE)
                }
            }
            bmp
        } catch (e: Exception) {
            null
        }
    }

    private fun showSubmitHomeworkDialog(hw: HomeworkDto) {
        // 1. Validasi Jam Mulai & Jam Berakhir Pengerjaan Tugas
        val now = java.util.Date()
        val isoFormat = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault())
        val displayFormat = java.text.SimpleDateFormat("dd MMM yyyy, HH:mm", java.util.Locale("id", "ID"))

        if (!hw.startTime.isNullOrEmpty()) {
            try {
                val start = if (hw.startTime.contains("T")) isoFormat.parse(hw.startTime) else null
                if (start != null && now.before(start)) {
                    AlertDialog.Builder(this)
                        .setTitle("⏳ Tugas Belum Dimulai")
                        .setMessage("Tugas \"${hw.title}\" baru dibuka pada:\n📅 ${displayFormat.format(start)} WIB.\n\nSilakan kembali saat jam pengerjaan dimulai.")
                        .setPositiveButton("Mengerti", null)
                        .show()
                    return
                }
            } catch (e: Exception) {}
        }

        if (!hw.endTime.isNullOrEmpty()) {
            try {
                val end = if (hw.endTime.contains("T")) isoFormat.parse(hw.endTime) else null
                if (end != null && now.after(end)) {
                    AlertDialog.Builder(this)
                        .setTitle("⚠️ Batas Waktu Berakhir")
                        .setMessage("Waktu pengerjaan tugas \"${hw.title}\" telah ditutup pada:\n⏰ ${displayFormat.format(end)} WIB.\n\nPengumpulan tugas baru tidak dapat dilakukan.")
                        .setPositiveButton("Tutup", null)
                        .show()
                    return
                }
            } catch (e: Exception) {}
        }

        selectedHomeworkFileBase64 = null
        selectedHomeworkFileName = null

        val density = resources.displayMetrics.density
        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (16 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }

        val hwType = hw.type ?: "ESSAY"
        val isCbt = (hwType == "MULTIPLE_CHOICE" || hwType == "MIXED") && !hw.questions.isNullOrEmpty()

        // Header Info
        val tvInfo = TextView(this).apply {
            val typeBadge = when (hwType) {
                "MULTIPLE_CHOICE" -> "[CBT PILIHAN GANDA]"
                "MIXED" -> "[CAMPURAN: CBT + ESSAY]"
                else -> "[TUGAS MANDIRI / ESSAY]"
            }
            text = "$typeBadge\n${hw.title} (${hw.subject?.name ?: "Mata Pelajaran"})"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
        }
        rootLayout.addView(tvInfo)

        if (!hw.description.isNullOrEmpty()) {
            val tvDesc = TextView(this).apply {
                text = hw.description
                setTextColor(Color.parseColor("#475569"))
                textSize = 11.5f
                setPadding(0, (4 * density).toInt(), 0, (8 * density).toInt())
            }
            rootLayout.addView(tvDesc)
        }

        // Parse questions for CBT mode
        val questionList = mutableListOf<HomeworkQuestionItem>()
        if (isCbt && !hw.questions.isNullOrEmpty()) {
            try {
                val jsonArr = org.json.JSONArray(hw.questions)
                for (i in 0 until jsonArr.length()) {
                    val obj = jsonArr.getJSONObject(i)
                    val qId = obj.optInt("id", i + 1)
                    val qText = obj.optString("text", "Soal ${i + 1}")
                    val opts = mutableListOf<String>()
                    val optArr = obj.optJSONArray("options")
                    if (optArr != null) {
                        for (j in 0 until optArr.length()) {
                            opts.add(optArr.getString(j))
                        }
                    }
                    val correct = if (obj.has("correctOption")) obj.optInt("correctOption") else null
                    val pts = obj.optDouble("points", 10.0)
                    questionList.add(HomeworkQuestionItem(qId, qText, opts, correct, pts))
                }
            } catch (e: Exception) {
                // Pipe delimited fallback parser
                val lines = hw.questions!!.split("\n")
                lines.forEachIndexed { idx, line ->
                    val p = line.split("|").map { it.trim() }
                    if (p.isNotEmpty() && p[0].isNotEmpty()) {
                        val qText = p[0]
                        val opts = p.filter { it.startsWith("A.") || it.startsWith("B.") || it.startsWith("C.") || it.startsWith("D.") }
                        questionList.add(HomeworkQuestionItem(idx + 1, qText, opts))
                    }
                }
            }
        }

        val selectedAnswersMap = mutableMapOf<Int, Int>() // questionId -> selectedOptionIdx

        // Render CBT questions sheet if available
        if (questionList.isNotEmpty()) {
            val tvCbtHeader = TextView(this).apply {
                text = "📝 LEMBAR SOAL PILIHAN GANDA (CBT):"
                setTextColor(Color.parseColor("#1D4ED8"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, (8 * density).toInt(), 0, (4 * density).toInt())
            }
            rootLayout.addView(tvCbtHeader)

            questionList.forEachIndexed { qIdx, q ->
                val cardQ = CardView(this).apply {
                    radius = 10 * density
                    cardElevation = 2 * density
                    setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                    useCompatPadding = true
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { bottomMargin = (8 * density).toInt() }
                }

                val cardContent = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (10 * density).toInt()
                    setPadding(p, p, p, p)
                }

                val tvQ = TextView(this).apply {
                    text = "${qIdx + 1}. ${q.text}"
                    setTextColor(Color.parseColor("#1E293B"))
                    textSize = 12.5f
                    setTypeface(null, Typeface.BOLD)
                }
                cardContent.addView(tvQ)

                val rg = RadioGroup(this).apply {
                    orientation = RadioGroup.VERTICAL
                    setPadding(0, (4 * density).toInt(), 0, 0)
                }

                val defaultOptions = listOf("A", "B", "C", "D")
                val displayOptions = if (!q.options.isNullOrEmpty()) q.options else defaultOptions

                displayOptions.forEachIndexed { optIdx, optText ->
                    val rb = RadioButton(this).apply {
                        val prefix = when (optIdx) {
                            0 -> "A. "
                            1 -> "B. "
                            2 -> "C. "
                            3 -> "D. "
                            else -> "${optIdx + 1}. "
                        }
                        text = if (optText.startsWith("A.") || optText.startsWith("B.") || optText.startsWith("C.") || optText.startsWith("D.")) optText else "$prefix$optText"
                        textSize = 11.5f
                        setTextColor(Color.parseColor("#334155"))
                        setOnCheckedChangeListener { _, isChecked ->
                            if (isChecked) {
                                selectedAnswersMap[q.id] = optIdx
                            }
                        }
                    }
                    rg.addView(rb)
                }
                cardContent.addView(rg)
                cardQ.addView(cardContent)
                rootLayout.addView(cardQ)
            }
        }

        // Render Essay Answer & File Attachment (for ESSAY or MIXED)
        val etAnswer = EditText(this).apply {
            hint = if (hwType == "MULTIPLE_CHOICE") "Catatan tambahan untuk guru (opsional)..." else "Tuliskan ringkasan jawaban tugas di sini..."
            minLines = 2
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            setPadding(20, 20, 20, 20)
            textSize = 12f
        }
        rootLayout.addView(etAnswer)

        val tvFileLabel = TextView(this).apply {
            text = "Belum ada file terlampir"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 11f
            setPadding(0, 10, 0, 4)
        }

        if (hwType != "MULTIPLE_CHOICE") {
            val btnAttach = Button(this).apply {
                text = "📎 Lampirkan Foto / Berkas PDF"
                setBackgroundColor(Color.parseColor("#0284C7"))
                setTextColor(Color.WHITE)
                textSize = 11f
                setOnClickListener {
                    onHomeworkFileSelectedCallback = { name ->
                        tvFileLabel.text = "📎 File Terpilih: $name"
                        tvFileLabel.setTextColor(Color.parseColor("#059669"))
                    }
                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
                    }
                    pickHomeworkFileLauncher.launch(intent)
                }
            }
            rootLayout.addView(btnAttach)
            rootLayout.addView(tvFileLabel)
        }

        val scroll = ScrollView(this).apply {
            addView(rootLayout)
        }

        AlertDialog.Builder(this)
            .setTitle("📤 Kumpulkan Tugas: ${hw.title}")
            .setView(scroll)
            .setPositiveButton("Kirim Sekarang") { _, _ ->
                val answer = etAnswer.text.toString().trim()

                // Buat payload jawaban CBT jika ada
                val answersJson = if (selectedAnswersMap.isNotEmpty()) {
                    val arr = org.json.JSONArray()
                    selectedAnswersMap.forEach { (qId, optIdx) ->
                        val obj = org.json.JSONObject()
                        obj.put("questionId", qId)
                        obj.put("selectedOption", optIdx)
                        arr.put(obj)
                    }
                    arr.toString()
                } else null

                val request = HomeworkSubmitRequest(
                    homeworkId = hw.id,
                    notes = answer.ifEmpty { "Jawaban diserahkan via Aplikasi Siswa" },
                    answers = answersJson,
                    fileBase64 = selectedHomeworkFileBase64,
                    fileName = selectedHomeworkFileName
                )

                Toast.makeText(this@StudentMainActivity, "Mengirim tugas...", Toast.LENGTH_SHORT).show()
                ApiClient.getClient(this).submitHomework(request).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful) {
                            val msg = response.body()?.message ?: "✅ Tugas berhasil dikumpulkan!"
                            com.school.smartcbt.utils.ClientLogger.logHomework(
                                context = this@StudentMainActivity,
                                action = "SUBMIT_HOMEWORK",
                                outcome = "SUCCESS",
                                message = msg,
                                homeworkId = hw.id,
                                extra = mapOf("title" to hw.title, "hasFile" to !selectedHomeworkFileBase64.isNullOrEmpty())
                            )
                            AlertDialog.Builder(this@StudentMainActivity)
                                .setTitle("✅ Berhasil")
                                .setMessage(msg)
                                .setPositiveButton("Selesai", null)
                                .show()
                            loadHomeworks()
                        } else {
                            val errMsg = response.body()?.message ?: try {
                                val errJson = response.errorBody()?.string()
                                org.json.JSONObject(errJson ?: "").optString("message", "Gagal mengumpulkan tugas")
                            } catch (e: Exception) { "Gagal mengumpulkan tugas" }

                            com.school.smartcbt.utils.ClientLogger.logHomework(
                                context = this@StudentMainActivity,
                                action = "SUBMIT_HOMEWORK",
                                outcome = "REJECTED",
                                message = errMsg,
                                homeworkId = hw.id,
                                extra = mapOf("title" to hw.title)
                            )
                            Toast.makeText(this@StudentMainActivity, errMsg, Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        val netErr = sanitizeNetworkErrorMessage(t.message)
                        com.school.smartcbt.utils.ClientLogger.logHomework(
                            context = this@StudentMainActivity,
                            action = "SUBMIT_HOMEWORK",
                            outcome = "ERROR",
                            message = "Gagal kirim tugas (Koneksi): $netErr",
                            homeworkId = hw.id,
                            extra = mapOf("title" to hw.title)
                        )
                        Toast.makeText(this@StudentMainActivity, netErr, Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun promptUploadEFileDialog(uri: android.net.Uri) {
        var fileName = "dokumen"
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
            val p = (16 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }

        val tvFile = TextView(this).apply {
            text = "📄 File Terpilih: $fileName"
            setTextColor(Color.parseColor("#0F172A"))
            textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        layout.addView(tvFile)

        val etTitle = EditText(this).apply {
            hint = "Judul Dokumen (Cth: Sertifikat Lomba Sains / KK)"
            setText(fileName.substringBeforeLast("."))
            val p = (10 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        layout.addView(etTitle)

        val etCategory = EditText(this).apply {
            hint = "Kategori (Cth: SERTIFIKAT, PRIBADI, TUGAS)"
            setText("PRIBADI")
            val p = (10 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
        }
        layout.addView(etCategory)

        AlertDialog.Builder(this)
            .setTitle("📤 Unggah E-File Mandiri")
            .setView(layout)
            .setPositiveButton("Unggah Sekarang") { _, _ ->
                val title = etTitle.text.toString().trim().ifEmpty { fileName }
                val cat = etCategory.text.toString().trim().ifEmpty { "PRIBADI" }
                try {
                    val pfd = contentResolver.openFileDescriptor(uri, "r")
                    val sizeBytes = pfd?.statSize ?: 0L
                    pfd?.close()
                    if (sizeBytes > 8 * 1024 * 1024L) {
                        Toast.makeText(this, "Ukuran berkas terlalu besar (${sizeBytes / 1024 / 1024} MB)! Maksimal 8 MB.", Toast.LENGTH_LONG).show()
                        return@setPositiveButton
                    }

                    val inputStream = contentResolver.openInputStream(uri)
                    val bytes = inputStream?.readBytes()
                    inputStream?.close()
                    if (bytes != null) {
                        if (bytes.size > 8 * 1024 * 1024) {
                            Toast.makeText(this, "Ukuran berkas terlalu besar! Maksimal 8 MB.", Toast.LENGTH_LONG).show()
                            return@setPositiveButton
                        }
                        val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                        Toast.makeText(this, "Mengunggah $fileName...", Toast.LENGTH_SHORT).show()
                        val req = UploadEFileRequest(title = title, category = cat, fileBase64 = base64, fileName = fileName)
                        ApiClient.getClient(this).uploadStudentEFile(req).enqueue(object : Callback<BasicResponse> {
                            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                if (response.isSuccessful) {
                                    Toast.makeText(this@StudentMainActivity, "✅ Berkas berhasil diunggah!", Toast.LENGTH_LONG).show()
                                    loadStudentEFiles()
                                } else {
                                    Toast.makeText(this@StudentMainActivity, "Gagal mengunggah berkas", Toast.LENGTH_SHORT).show()
                                }
                            }
                            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(t.message), Toast.LENGTH_SHORT).show()
                            }
                        })
                    }
                } catch (e: Exception) {
                    Toast.makeText(this, "Gagal membaca berkas: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadStudentEFiles() {
        ApiClient.getClient(this).getEFiles().enqueue(object : Callback<EFilesResponse> {
            override fun onResponse(call: Call<EFilesResponse>, response: Response<EFilesResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val efiles = response.body()!!.data
                    renderStudentEFilesList(efiles)
                }
            }
            override fun onFailure(call: Call<EFilesResponse>, t: Throwable) {}
        })
    }

    private fun renderStudentEFilesList(files: List<EFileDto>) {
        binding.containerStudentEFiles.removeAllViews()
        val density = resources.displayMetrics.density

        if (files.isEmpty()) {
            binding.emptyStateEFiles.visibility = View.VISIBLE
            return
        }
        binding.emptyStateEFiles.visibility = View.GONE

        files.forEach { file ->
            val card = androidx.cardview.widget.CardView(this).apply {
                radius = 12 * density
                cardElevation = 2 * density
                useCompatPadding = true
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = (8 * density).toInt()
                }
            }

            val cardInner = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                val p = (14 * density).toInt()
                setPadding(p, p, p, p)
            }

            val tvIcon = TextView(this).apply {
                text = if (file.fileType?.contains("pdf", ignoreCase = true) == true || file.fileUrl.endsWith(".pdf", ignoreCase = true)) "📄" else "🖼️"
                textSize = 24f
            }
            cardInner.addView(tvIcon)

            val colInfo = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginStart = (12 * density).toInt()
                }
            }

            val tvTitle = TextView(this).apply {
                text = file.title
                setTextColor(Color.parseColor("#1E293B"))
                textSize = 13f
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
            colInfo.addView(tvTitle)

            val tvSub = TextView(this).apply {
                text = "${file.category} • ${file.fileSize ?: "Berkas Siswa"}"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11f
            }
            colInfo.addView(tvSub)

            cardInner.addView(colInfo)

            val btnOpen = Button(this, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
                text = "👁️ Buka"
                setTextColor(Color.parseColor("#0284C7"))
                textSize = 11f
                setOnClickListener {
                    val rawUrl = file.fileUrl.trim()
                    if (rawUrl.contains("drive.google.com", ignoreCase = true)) {
                        // Link Google Drive Supabase: Buka langsung via Aplikasi Google Drive / Browser Chrome
                        try {
                            val driveIntent = Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl)).apply {
                                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                            }
                            startActivity(driveIntent)
                        } catch (e: Exception) {
                            Toast.makeText(this@StudentMainActivity, "Membuka berkas...", Toast.LENGTH_SHORT).show()
                            val intent = Intent(this@StudentMainActivity, PdfViewerActivity::class.java).apply {
                                putExtra(PdfViewerActivity.EXTRA_TITLE, file.title)
                                putExtra(PdfViewerActivity.EXTRA_DOC_TYPE, file.title)
                                putExtra(PdfViewerActivity.EXTRA_URL, rawUrl)
                                putExtra("EXTRA_FILE_URL", rawUrl)
                            }
                            startActivity(intent)
                        }
                    } else {
                        val finalUrl = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
                            rawUrl
                        } else {
                            ApiClient.getBaseServerUrl(this@StudentMainActivity).trimEnd('/') + "/" + rawUrl.trimStart('/')
                        }
                        val intent = Intent(this@StudentMainActivity, PdfViewerActivity::class.java).apply {
                            putExtra(PdfViewerActivity.EXTRA_TITLE, file.title)
                            putExtra(PdfViewerActivity.EXTRA_DOC_TYPE, file.title)
                            putExtra(PdfViewerActivity.EXTRA_URL, finalUrl)
                            putExtra("EXTRA_FILE_URL", finalUrl)
                        }
                        startActivity(intent)
                    }
                }
            }
            cardInner.addView(btnOpen)

            val btnDel = Button(this, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
                text = "🗑️"
                setTextColor(Color.parseColor("#EF4444"))
                textSize = 14f
                setOnClickListener {
                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("Hapus Dokumen?")
                        .setMessage("Apakah Anda yakin ingin menghapus '${file.title}'?")
                        .setPositiveButton("Hapus") { _, _ ->
                            ApiClient.getClient(this@StudentMainActivity).deleteStudentEFile(file.id).enqueue(object : Callback<BasicResponse> {
                                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                                    if (response.isSuccessful && response.body()?.success == true) {
                                        Toast.makeText(this@StudentMainActivity, "✅ Berkas berhasil dihapus permanen", Toast.LENGTH_SHORT).show()
                                    } else {
                                        Toast.makeText(this@StudentMainActivity, response.body()?.message ?: "Gagal menghapus berkas", Toast.LENGTH_SHORT).show()
                                    }
                                    loadStudentEFiles()
                                }
                                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                                    Toast.makeText(this@StudentMainActivity, "Gagal terhubung ke server", Toast.LENGTH_SHORT).show()
                                }
                            })
                        }
                        .setNegativeButton("Batal", null)
                        .show()
                }
            }
            cardInner.addView(btnDel)

            card.addView(cardInner)
            binding.containerStudentEFiles.addView(card)
        }
    }

    private fun showDigitalMemberCardDialog() {
        val name = sessionManager.getName().ifEmpty { "Siswa SmartSchool" }
        val nisn = sessionManager.getNisn().ifEmpty { "0013929592" }
        val className = sessionManager.getClassName().ifEmpty { "VII-A" }
        val studentId = sessionManager.getUserId().ifEmpty { "student-id" }
        val memberId = "LIB-$nisn"
        val qrPayload = "STUDENT_MEMBER:$studentId:$nisn:$name:$className"

        val dialog = AlertDialog.Builder(this).create()
        val density = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * density).toInt()
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        // Header
        val tvHeader = TextView(this).apply {
            text = "🏛️ SMP NEGERI 1 BOYOLANGU"
            setTextColor(Color.WHITE)
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        root.addView(tvHeader)

        val tvSubHeader = TextView(this).apply {
            text = "KARTU ANGGOTA DIGITAL SISWA"
            setTextColor(Color.parseColor("#93C5FD"))
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, (2 * density).toInt(), 0, (12 * density).toInt())
        }
        root.addView(tvSubHeader)

        // QR Code Box
        val qrBitmap = com.school.smartcbt.utils.QrCodeHelper.generateQrCodeBitmap(qrPayload, (200 * density).toInt())
        val ivQr = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams((180 * density).toInt(), (180 * density).toInt()).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = (14 * density).toInt()
            }
            setBackgroundColor(Color.WHITE)
            val p = (8 * density).toInt()
            setPadding(p, p, p, p)
            if (qrBitmap != null) {
                setImageBitmap(qrBitmap)
            }
        }
        root.addView(ivQr)

        // Student Info
        val tvName = TextView(this).apply {
            text = name
            setTextColor(Color.WHITE)
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        root.addView(tvName)

        val tvClassNisn = TextView(this).apply {
            text = "Kelas: $className  •  NISN: $nisn"
            setTextColor(Color.parseColor("#CBD5E1"))
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(0, (2 * density).toInt(), 0, (4 * density).toInt())
        }
        root.addView(tvClassNisn)

        val tvMemberId = TextView(this).apply {
            text = "ID: $memberId"
            setTextColor(Color.parseColor("#FCD34D"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, (14 * density).toInt())
        }
        root.addView(tvMemberId)

        val tvNote = TextView(this).apply {
            text = "Dapat di-scan untuk Presensi Gerbang, Peminjaman Perpustakaan, dan Rekam Medis UKS."
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 10f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, (14 * density).toInt())
        }
        root.addView(tvNote)

        val btnClose = Button(this).apply {
            text = "Tutup Kartu"
            setBackgroundColor(Color.parseColor("#2563EB"))
            setTextColor(Color.WHITE)
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setOnClickListener { dialog.dismiss() }
        }
        root.addView(btnClose)

        dialog.setView(root)
        dialog.show()
    }

    // ================= 1-TAP PRESENSI JAM PELAJARAN (SISWA) =================
    private var activeClassSessionData: ClassSessionDetailDto? = null

    private fun loadActiveClassSession() {
        ApiClient.getClient(this).getActiveClassSession().enqueue(object : Callback<ClassSessionActiveResponse> {
            override fun onResponse(call: Call<ClassSessionActiveResponse>, response: Response<ClassSessionActiveResponse>) {
                val resp = response.body()
                val session = resp?.session ?: resp?.data
                if (response.isSuccessful && resp?.hasActiveSession == true && session != null) {
                    val combinedSession = session.copy(
                        isAlreadyOut = resp.isStudentOut,
                        studentOutTime = resp.outTimeStr,
                        isOutWindowOpen = resp.isWindowOutActive,
                        remainingSeconds = resp.remainingSeconds ?: 0
                    )
                    activeClassSessionData = combinedSession
                    renderActiveClassSessionCard(combinedSession)
                } else {
                    activeClassSessionData = null
                    renderIdleClassSessionCard(resp?.message)
                }
            }

            override fun onFailure(call: Call<ClassSessionActiveResponse>, t: Throwable) {
                activeClassSessionData = null
                renderIdleClassSessionCard("Gagal terhubung ke server sekolah. Klik tombol di bawah untuk mencoba lagi.")
            }
        })
    }

    private fun renderIdleClassSessionCard(message: String?) {
        binding.cardStudentClassSession.visibility = View.VISIBLE
        binding.tvClassSessionBadge.text = "⏳ JEDA / MENUNGGU GURU MAPEL"
        binding.tvClassSessionBadge.setBackgroundColor(Color.parseColor("#475569"))
        stopBlinkingAttendanceButton()
        binding.layoutClassSessionIndicators.visibility = View.GONE
        binding.tvClassSessionTitle.text = "Mata Pelajaran: Menunggu Jam Mengajar"
        binding.tvClassSessionTeacherRoom.text = message ?: "Jam Ke: - • Waktu: Sesi Istirahat / Menunggu Guru Mapel • Guru: -"
        binding.tvClassSessionCountdown.text = "Pergantian Sesi JP"
        binding.tvClassSessionCountdown.setTextColor(Color.parseColor("#94A3B8"))
        binding.btnStudentTapOut.isEnabled = true
        binding.btnStudentTapOut.text = "🎯 ABSEN PRESENSI MATA PELAJARAN"
        binding.btnStudentTapOut.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
        binding.btnStudentTapOut.setOnClickListener {
            openStudentSubjectAttendanceAction()
        }
        binding.tvStudentOutHint.text = "Ketuk untuk presensi jam pelajaran (Geolocation) atau rekap absensi"
        binding.tvStudentOutHint.setTextColor(Color.parseColor("#94A3B8"))
    }

    private var attendanceBlinkAnimator: android.animation.ObjectAnimator? = null

    private fun startBlinkingAttendanceButton() {
        if (attendanceBlinkAnimator != null && attendanceBlinkAnimator!!.isRunning) return
        attendanceBlinkAnimator = android.animation.ObjectAnimator.ofFloat(binding.btnStudentTapOut, "alpha", 1.0f, 0.45f, 1.0f).apply {
            duration = 750
            repeatCount = android.animation.ValueAnimator.INFINITE
            repeatMode = android.animation.ValueAnimator.REVERSE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            start()
        }
    }

    private fun stopBlinkingAttendanceButton() {
        attendanceBlinkAnimator?.cancel()
        attendanceBlinkAnimator = null
        binding.btnStudentTapOut.alpha = 1.0f
    }

    private fun renderActiveClassSessionCard(session: ClassSessionDetailDto) {
        binding.cardStudentClassSession.visibility = View.VISIBLE
        binding.layoutClassSessionIndicators.visibility = View.VISIBLE
        binding.tvClassSessionTitle.text = "Mata Pelajaran: ${session.subjectName}"
        binding.tvClassSessionTeacherRoom.text = "Jam Ke-${session.periodIndex} • Waktu: ${session.timeRange} WIB • Guru: ${session.teacherName}"

        // Sisa waktu countdown
        val remainingSec = session.remainingSeconds ?: 0
        if (remainingSec > 0) {
            val mins = remainingSec / 60
            val secs = remainingSec % 60
            binding.tvClassSessionCountdown.text = String.format("Sisa: %02d:%02d", mins, secs)
        } else {
            binding.tvClassSessionCountdown.text = "Sisa: 00:00"
        }
        binding.tvClassSessionCountdown.setTextColor(Color.parseColor("#FCD34D"))

        // 3 Indikator Otomatis: Waktu, Lokasi, Device
        val isTimeValid = session.isTimeWindowValid == true
        binding.tvVerifyTime.text = if (isTimeValid) "⏱ WAKTU: VALID" else "⏱ WAKTU: MENUNGGU"
        binding.tvVerifyTime.setTextColor(if (isTimeValid) Color.parseColor("#10B981") else Color.parseColor("#F59E0B"))

        val isLocValid = session.isLocationValid != false
        binding.tvVerifyLocation.text = if (isLocValid) "📍 LOKASI: VALID" else "📍 LOKASI: LUAR KELAS"
        binding.tvVerifyLocation.setTextColor(if (isLocValid) Color.parseColor("#10B981") else Color.parseColor("#EF4444"))

        val isDevValid = session.isDeviceValid != false
        binding.tvVerifyDevice.text = if (isDevValid) "📱 HP: TERVERIFIKASI" else "📱 HP: BEDA PERANGKAT"
        binding.tvVerifyDevice.setTextColor(if (isDevValid) Color.parseColor("#10B981") else Color.parseColor("#EF4444"))

        // Status Tombol Absen Presensi Mata Pelajaran
        binding.btnStudentTapOut.isEnabled = true
        if (session.isAlreadyOut == true) {
            stopBlinkingAttendanceButton()
            binding.tvClassSessionBadge.text = "● SESI JP BERJALAN"
            binding.tvClassSessionBadge.setBackgroundColor(Color.parseColor("#10B981"))
            binding.btnStudentTapOut.text = "✔ SUDAH HADIR JP (JAM KE-${session.periodIndex})"
            binding.btnStudentTapOut.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#059669"))
            binding.btnStudentTapOut.setOnClickListener {
                showSubjectAttendanceDialog()
            }
            binding.tvStudentOutHint.text = "Presensi jam pelajaran selesai. Anda tercatat HADIR."
            binding.tvStudentOutHint.setTextColor(Color.parseColor("#10B981"))
        } else {
            startBlinkingAttendanceButton()
            binding.tvClassSessionBadge.text = "⚡ KBM AKTIF - AYO PRESENSI!"
            binding.tvClassSessionBadge.setBackgroundColor(Color.parseColor("#DC2626"))
            binding.btnStudentTapOut.text = "⚡ 1-TAP PRESENSI KBM (JAM KE-${session.periodIndex})"
            binding.btnStudentTapOut.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2563EB"))
            binding.btnStudentTapOut.setOnClickListener {
                handleStudentTapOut(session)
            }
            binding.tvStudentOutHint.text = "KBM SEDANG BERLANGSUNG! Ketuk untuk konfirmasi kehadiran di kelas."
            binding.tvStudentOutHint.setTextColor(Color.parseColor("#F59E0B"))
        }
    }

    private fun openStudentSubjectAttendanceAction() {
        Toast.makeText(this, "Memeriksa sesi KBM mata pelajaran aktif...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getActiveClassSession().enqueue(object : Callback<ClassSessionActiveResponse> {
            override fun onResponse(call: Call<ClassSessionActiveResponse>, response: Response<ClassSessionActiveResponse>) {
                val resp = response.body()
                val session = resp?.session ?: resp?.data
                if (response.isSuccessful && resp?.hasActiveSession == true && session != null) {
                    val combinedSession = session.copy(
                        isAlreadyOut = resp.isStudentOut,
                        studentOutTime = resp.outTimeStr,
                        isOutWindowOpen = resp.isWindowOutActive,
                        remainingSeconds = resp.remainingSeconds ?: 0
                    )
                    activeClassSessionData = combinedSession
                    renderActiveClassSessionCard(combinedSession)

                    if (resp.isStudentOut == true) {
                        showCompletedSubjectAttendanceDialog(session, resp.outTimeStr)
                    } else {
                        showActiveSubjectAttendancePromptDialog(combinedSession)
                    }
                } else {
                    activeClassSessionData = null
                    renderIdleClassSessionCard(resp?.message)

                    val msg = resp?.message ?: "Belum ada sesi pelajaran yang sedang dibuka oleh Guru Mata Pelajaran untuk rombel Anda saat ini."
                    showIdleSubjectAttendanceDialog(msg)
                }
            }

            override fun onFailure(call: Call<ClassSessionActiveResponse>, t: Throwable) {
                activeClassSessionData = null
                renderIdleClassSessionCard("Gagal terhubung ke server sekolah.")
                Toast.makeText(this@StudentMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showIdleSubjectAttendanceDialog(msg: String) {
        val density = resources.displayMetrics.density
        val dialog = AlertDialog.Builder(this).create()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 16 * density
            }
            background = bg
        }

        // Header Gradient (Indigo to Purple to Rose)
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val gradBg = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#312E81"), Color.parseColor("#6366F1"), Color.parseColor("#EC4899"))
            ).apply {
                cornerRadii = floatArrayOf(
                    16 * density, 16 * density,
                    16 * density, 16 * density,
                    0f, 0f, 0f, 0f
                )
            }
            background = gradBg
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val tvBadge = TextView(this).apply {
            text = "🎯 PRESENSI JAM PELAJARAN (KBM)"
            setTextColor(Color.parseColor("#FEF08A"))
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            val badgeBg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#1E1B4B"))
                cornerRadius = 6 * density
            }
            background = badgeBg
            val hp = (8 * density).toInt()
            val vp = (3 * density).toInt()
            setPadding(hp, vp, hp, vp)
        }
        topRow.addView(tvBadge)
        headerLayout.addView(topRow)

        val tvTitle = TextView(this).apply {
            text = "📚 Presensi Mata Pelajaran"
            setTextColor(Color.WHITE)
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (8 * density).toInt(), 0, 0)
        }
        headerLayout.addView(tvTitle)

        val tvSubtitle = TextView(this).apply {
            text = "Konfirmasi Kehadiran & Sesi Guru Pengampu di Kelas"
            setTextColor(Color.parseColor("#E0E7FF"))
            textSize = 11.5f
            setPadding(0, (2 * density).toInt(), 0, 0)
        }
        headerLayout.addView(tvSubtitle)
        root.addView(headerLayout)

        val bodyLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        // Status Card
        val cardInfo = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#EEF2FF"))
                setStroke((1 * density).toInt(), Color.parseColor("#C7D2FE"))
                cornerRadius = 10 * density
            }
            background = bg
            val p = (12 * density).toInt()
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val tvInfoTitle = TextView(this).apply {
            text = "⏳ Sesi KBM Belum Aktif / Berlangsung"
            setTextColor(Color.parseColor("#3730A3"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
        }
        val tvInfoDesc = TextView(this).apply {
            text = "$msg\n\nPresensi jam pelajaran akan aktif saat Bapak/Ibu Guru Pengampu membuka sesi KBM di kelas fisik Anda."
            setTextColor(Color.parseColor("#4338CA"))
            textSize = 11.5f
            setPadding(0, (4 * density).toInt(), 0, 0)
            setLineSpacing(2f, 1f)
        }
        cardInfo.addView(tvInfoTitle)
        cardInfo.addView(tvInfoDesc)
        bodyLayout.addView(cardInfo)

        // Button Lihat Rekap
        val btnRekap = Button(this).apply {
            text = "📊 BUKA REKAP PRESENSI MAPEL"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val btnBg = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#4338CA"), Color.parseColor("#6366F1"))
            ).apply {
                cornerRadius = 10 * density
            }
            background = btnBg
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
                showSubjectAttendanceDialog()
            }
        }
        bodyLayout.addView(btnRekap)

        val btnClose = Button(this).apply {
            text = "Tutup"
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#E2E8F0"))
                cornerRadius = 8 * density
            }
            background = bg
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * density).toInt())
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
            }
        }
        bodyLayout.addView(btnClose)

        root.addView(bodyLayout)
        dialog.setView(root)
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        dialog.show()
    }

    private fun showCompletedSubjectAttendanceDialog(session: ClassSessionDetailDto, outTimeStr: String?) {
        val density = resources.displayMetrics.density
        val dialog = AlertDialog.Builder(this).create()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 16 * density
            }
            background = bg
        }

        // Header Gradient (Emerald to Teal to Cyan)
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val gradBg = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#064E3B"), Color.parseColor("#059669"), Color.parseColor("#10B981"))
            ).apply {
                cornerRadii = floatArrayOf(
                    16 * density, 16 * density,
                    16 * density, 16 * density,
                    0f, 0f, 0f, 0f
                )
            }
            background = gradBg
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val tvBadge = TextView(this).apply {
            text = "✔ PRESENSI KBM SELESAI"
            setTextColor(Color.parseColor("#A7F3D0"))
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            val badgeBg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#064E3B"))
                cornerRadius = 6 * density
            }
            background = badgeBg
            val hp = (8 * density).toInt()
            val vp = (3 * density).toInt()
            setPadding(hp, vp, hp, vp)
        }
        topRow.addView(tvBadge)
        headerLayout.addView(topRow)

        val tvTitle = TextView(this).apply {
            text = "📚 Presensi Mapel Selesai"
            setTextColor(Color.WHITE)
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (8 * density).toInt(), 0, 0)
        }
        headerLayout.addView(tvTitle)

        val tvSubtitle = TextView(this).apply {
            text = "Status Kehadiran Jam Pelajaran Resmi Tersimpan"
            setTextColor(Color.parseColor("#E0F2FE"))
            textSize = 11.5f
            setPadding(0, (2 * density).toInt(), 0, 0)
        }
        headerLayout.addView(tvSubtitle)
        root.addView(headerLayout)

        val bodyLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        // Verification Card
        val cardInfo = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#ECFDF5"))
                setStroke((1 * density).toInt(), Color.parseColor("#A7F3D0"))
                cornerRadius = 10 * density
            }
            background = bg
            val p = (12 * density).toInt()
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val tvInfoTitle = TextView(this).apply {
            text = "🎉 Anda Tercatat HADIR"
            setTextColor(Color.parseColor("#065F46"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
        }
        val tvInfoDesc = TextView(this).apply {
            text = "Mata Pelajaran: ${session.subjectName}\nJam ke-${session.periodIndex} (${session.timeRange ?: "-"} WIB)\nGuru: ${session.teacherName ?: "-"}\nWaktu Scan: ${outTimeStr ?: "-"} WIB\n\nKehadiran telah diverifikasi dan masuk rekap SIAKAD."
            setTextColor(Color.parseColor("#047857"))
            textSize = 11.5f
            setPadding(0, (4 * density).toInt(), 0, 0)
            setLineSpacing(2.5f, 1f)
        }
        cardInfo.addView(tvInfoTitle)
        cardInfo.addView(tvInfoDesc)
        bodyLayout.addView(cardInfo)

        // Button Lihat Rekap
        val btnRekap = Button(this).apply {
            text = "📊 BUKA REKAP PRESENSI MAPEL"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val btnBg = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#059669"), Color.parseColor("#10B981"))
            ).apply {
                cornerRadius = 10 * density
            }
            background = btnBg
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
                showSubjectAttendanceDialog()
            }
        }
        bodyLayout.addView(btnRekap)

        val btnClose = Button(this).apply {
            text = "Tutup"
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#E2E8F0"))
                cornerRadius = 8 * density
            }
            background = bg
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * density).toInt())
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
            }
        }
        bodyLayout.addView(btnClose)

        root.addView(bodyLayout)
        dialog.setView(root)
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        dialog.show()
    }

    private fun showActiveSubjectAttendancePromptDialog(session: ClassSessionDetailDto) {
        val density = resources.displayMetrics.density
        val dialog = AlertDialog.Builder(this).create()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            setPadding(0, 0, 0, (14 * density).toInt())
        }

        // 1. Multi Color Header Banner (Gradient Indigo to Purple)
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val gradBg = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#4338CA"), Color.parseColor("#7C3AED"), Color.parseColor("#059669"))
            ).apply {
                cornerRadii = floatArrayOf(
                    16 * density, 16 * density,
                    16 * density, 16 * density,
                    0f, 0f, 0f, 0f
                )
            }
            background = gradBg
            val p = (16 * density).toInt()
            setPadding(p, p, p, p)
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val tvBadge = TextView(this).apply {
            text = "⚡ KBM AKTIF BERLANGSUNG"
            setTextColor(Color.parseColor("#FEF08A"))
            textSize = 10.5f
            setTypeface(null, Typeface.BOLD)
            val badgeBg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#312E81"))
                cornerRadius = 6 * density
            }
            background = badgeBg
            val hp = (8 * density).toInt()
            val vp = (3 * density).toInt()
            setPadding(hp, vp, hp, vp)
        }
        topRow.addView(tvBadge)

        headerLayout.addView(topRow)

        val tvTitle = TextView(this).apply {
            text = session.subjectName ?: "Mata Pelajaran"
            setTextColor(Color.WHITE)
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, (8 * density).toInt(), 0, 0)
        }
        headerLayout.addView(tvTitle)

        val tvSubtitle = TextView(this).apply {
            text = "Presensi Resmi Kehadiran Jam Pelajaran Siswa"
            setTextColor(Color.parseColor("#E0E7FF"))
            textSize = 11.5f
            setPadding(0, (2 * density).toInt(), 0, 0)
        }
        headerLayout.addView(tvSubtitle)
        root.addView(headerLayout)

        // 2. Body Container with Multi Color Info Cards
        val bodyLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (16 * density).toInt()
            setPadding(p, p, p, 0)
        }

        // Multi Color Row 1: Guru (Teal / Emerald) & Ruang (Sky / Cyan)
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
        }

        val pillGuru = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#ECFDF5"))
                setStroke((1 * density).toInt(), Color.parseColor("#A7F3D0"))
                cornerRadius = 8 * density
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = (4 * density).toInt()
            }
            layoutParams = lp
        }
        val tvGuruLabel = TextView(this).apply {
            text = "👨‍🏫 Guru Pengampu"
            setTextColor(Color.parseColor("#047857"))
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
        }
        val tvGuruVal = TextView(this).apply {
            text = session.teacherName ?: "-"
            setTextColor(Color.parseColor("#064E3B"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        pillGuru.addView(tvGuruLabel)
        pillGuru.addView(tvGuruVal)
        row1.addView(pillGuru)

        val pillRuang = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#F0F9FF"))
                setStroke((1 * density).toInt(), Color.parseColor("#BAE6FD"))
                cornerRadius = 8 * density
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (4 * density).toInt()
            }
            layoutParams = lp
        }
        val tvRuangLabel = TextView(this).apply {
            text = "📍 Ruangan / Lab"
            setTextColor(Color.parseColor("#0369A1"))
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
        }
        val tvRuangVal = TextView(this).apply {
            text = session.roomName ?: "Ruang Kelas"
            setTextColor(Color.parseColor("#0C4A6E"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        pillRuang.addView(tvRuangLabel)
        pillRuang.addView(tvRuangVal)
        row1.addView(pillRuang)
        bodyLayout.addView(row1)

        // Multi Color Row 2: Jam Pelajaran (Amber / Orange) & Waktu (Purple / Indigo)
        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (12 * density).toInt()
            }
            layoutParams = lp
        }

        val pillJam = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#FFFBEB"))
                setStroke((1 * density).toInt(), Color.parseColor("#FDE68A"))
                cornerRadius = 8 * density
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = (4 * density).toInt()
            }
            layoutParams = lp
        }
        val tvJamLabel = TextView(this).apply {
            text = "🕒 Jam Ke"
            setTextColor(Color.parseColor("#B45309"))
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
        }
        val tvJamVal = TextView(this).apply {
            text = "Jam Ke-${session.periodIndex}"
            setTextColor(Color.parseColor("#78350F"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        pillJam.addView(tvJamLabel)
        pillJam.addView(tvJamVal)
        row2.addView(pillJam)

        val pillWaktu = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#FAF5FF"))
                setStroke((1 * density).toInt(), Color.parseColor("#E9D5FF"))
                cornerRadius = 8 * density
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (4 * density).toInt()
            }
            layoutParams = lp
        }
        val tvWaktuLabel = TextView(this).apply {
            text = "⏱ Waktu KBM"
            setTextColor(Color.parseColor("#7E22CE"))
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
        }
        val tvWaktuVal = TextView(this).apply {
            text = "${session.timeRange} WIB"
            setTextColor(Color.parseColor("#581C87"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
        }
        pillWaktu.addView(tvWaktuLabel)
        pillWaktu.addView(tvWaktuVal)
        row2.addView(pillWaktu)
        bodyLayout.addView(row2)

        // Gate-In Status Badge (Green / Emerald)
        val cardGateStatus = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#ECFDF5"))
                setStroke((1 * density).toInt(), Color.parseColor("#6EE7B7"))
                cornerRadius = 8 * density
            }
            background = bg
            val p = (10 * density).toInt()
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (14 * density).toInt()
            }
            layoutParams = lp
        }
        val tvGateIcon = TextView(this).apply {
            text = "🛡️"
            textSize = 14f
            setPadding(0, 0, (8 * density).toInt(), 0)
        }
        val tvGateMsg = TextView(this).apply {
            text = "Terverifikasi Gate-In: Kehadiran siswa terhubung dengan gerbang utama"
            setTextColor(Color.parseColor("#065F46"))
            textSize = 11f
        }
        cardGateStatus.addView(tvGateIcon)
        cardGateStatus.addView(tvGateMsg)
        bodyLayout.addView(cardGateStatus)

        // 3. Action Button: 1-Tap Geolocation (Multi Color Emerald Gradient)
        val btnTapIn = Button(this).apply {
            text = "⚡ 1-TAP PRESENSI MAPEL SEKARANG"
            setTextColor(Color.WHITE)
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            val btnBg = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#059669"), Color.parseColor("#0D9488"), Color.parseColor("#2563EB"))
            ).apply {
                cornerRadius = 10 * density
            }
            background = btnBg
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (48 * density).toInt()).apply {
                bottomMargin = (8 * density).toInt()
            }
            layoutParams = lp
            setOnClickListener {
                dialog.dismiss()
                handleStudentTapOut(session)
            }
        }
        bodyLayout.addView(btnTapIn)

        // 4. Secondary Action: Rekapitulasi Link
        val tvRekapLink = TextView(this).apply {
            text = "📊 Buka Rekapitulasi Presensi Matpel →"
            setTextColor(Color.parseColor("#4F46E5"))
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, (6 * density).toInt(), 0, (6 * density).toInt())
            setOnClickListener {
                dialog.dismiss()
                showSubjectAttendanceDialog()
            }
        }
        bodyLayout.addView(tvRekapLink)

        root.addView(bodyLayout)
        dialog.setView(root)
        dialog.show()
    }

    data class StudentLocationResult(val lat: Double, val lng: Double, val isMock: Boolean, val accuracy: Float)

    private fun getDeviceLocation(): StudentLocationResult {
        val schoolLat = -8.125506
        val schoolLng = 111.893526
        var currentLat: Double? = null
        var currentLng: Double? = null
        var isMock = false
        var currentAccuracy = 999f

        try {
            val locationManager = getSystemService(Context.LOCATION_SERVICE) as? android.location.LocationManager
            val providers = locationManager?.getProviders(true) ?: emptyList()
            var bestLoc: android.location.Location? = null
            for (provider in providers) {
                val lastLoc = try {
                    if (androidx.core.app.ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        locationManager?.getLastKnownLocation(provider)
                    } else null
                } catch (e: Exception) {
                    null
                }

                if (lastLoc != null) {
                    // Usia < 60 detik dan akurasi < 100 meter
                    val ageMs = System.currentTimeMillis() - lastLoc.time
                    if (ageMs < 60_000 && lastLoc.accuracy < 100f) {
                        if (bestLoc == null || lastLoc.accuracy < bestLoc.accuracy || lastLoc.time > bestLoc.time) {
                            bestLoc = lastLoc
                        }
                    }
                }
            }

            if (bestLoc != null) {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                    if (bestLoc.isMock) isMock = true
                } else {
                    @Suppress("DEPRECATION")
                    if (bestLoc.isFromMockProvider) isMock = true
                }
                currentAccuracy = bestLoc.accuracy
                val dist = FloatArray(1)
                android.location.Location.distanceBetween(bestLoc.latitude, bestLoc.longitude, schoolLat, schoolLng, dist)
                val distMeters = dist[0]

                // Jika lokasi melompat jauh (>500m) dengan akurasi buruk (>30m), fallback ke koordinat sekolah
                if (distMeters > 500 && bestLoc.accuracy > 30f) {
                    currentLat = schoolLat
                    currentLng = schoolLng
                } else {
                    currentLat = bestLoc.latitude
                    currentLng = bestLoc.longitude
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Fallback default Lokasi Kampus SMPN 1 Boyolangu (-8.125506, 111.893526)
        if (currentLat == null || currentLng == null) {
            currentLat = schoolLat
            currentLng = schoolLng
        }

        return StudentLocationResult(currentLat, currentLng, isMock, currentAccuracy)
    }

    private fun handleStudentTapOut(session: ClassSessionDetailDto) {
        if (!com.school.smartcbt.utils.GpsUtils.isHighAccuracyGpsEnabled(this)) {
            com.school.smartcbt.utils.GpsUtils.showGpsRequirementDialog(this)
            return
        }
        val (lat, lng, isMock, accuracy) = getDeviceLocation()
        if (isMock) {
            AlertDialog.Builder(this)
                .setTitle("🚨 Terdeteksi Fake GPS!")
                .setMessage("Aplikasi mendeteksi penggunaan Fake GPS / Mock Location pada perangkat Anda. Presensi OUT kelas DITOLAK demi integritas kedisiplinan sekolah!")
                .setIcon(android.R.drawable.ic_dialog_alert)
                .setPositiveButton("Tutup", null)
                .show()
            return
        }

        if (accuracy > 15f) {
            AlertDialog.Builder(this)
                .setTitle("⚠️ Sinyal Satelit Belum Presisi!")
                .setMessage("Akurasi GPS perangkat Anda saat ini ±${accuracy.toInt()} meter (melebihi batas maksimal 15 meter). Harap tunggu beberapa detik sampai sinyal satelit terkunci presisi di dalam ruang kelas.")
                .setIcon(android.R.drawable.ic_dialog_alert)
                .setPositiveButton("Tutup", null)
                .show()
            return
        }

        val deviceId = sessionManager.getDeviceId()
        val req = StudentOutSessionRequest(
            sessionId = session.id,
            latitude = lat,
            longitude = lng,
            deviceId = deviceId,
            isFakeGps = isMock
        )

        binding.btnStudentTapOut.isEnabled = false
        binding.btnStudentTapOut.text = "Mencatat Kehadiran..."

        ApiClient.getClient(this).studentOutClassSession(req).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    Toast.makeText(this@StudentMainActivity, "✔ Presensi Kehadiran KBM Berhasil Tercatat!", Toast.LENGTH_LONG).show()
                    loadActiveClassSession()
                } else {
                    val rawErr = response.errorBody()?.string() ?: ""
                    var userMsg = response.body()?.message ?: "Gagal absen OUT"
                    var notGateIn = false
                    var isHomeViaBk = false
                    try {
                        val json = org.json.JSONObject(rawErr)
                        if (json.has("message")) userMsg = json.getString("message")
                        if (json.optBoolean("notGateIn", false)) notGateIn = true
                        if (json.optBoolean("isHomeViaBk", false)) isHomeViaBk = true
                    } catch (e: Exception) {}

                    if (notGateIn) {
                        showModernStudentAlertModal(
                            title = "Belum Presensi Kedatangan (Gate-In)",
                            message = "Anda belum melakukan Presensi Kedatangan (Gate-In) hari ini.\n\nSesuai tata tertib sekolah, presensi jam mata pelajaran mewajibkan siswa telah tercatat Gate-In di area SMP Negeri 1 Boyolangu terlebih dahulu demi validitas rekap absensi.",
                            iconEmoji = "⛔",
                            gradientStart = "#DC2626",
                            gradientEnd = "#991B1B",
                            badgeText = "VALIDASI PRESENSI AREA SEKOLAH",
                            positiveBtnText = "Mengerti & Siap Presensi"
                        )
                    } else if (isHomeViaBk) {
                        showModernStudentAlertModal(
                            title = "Dispensasi Pulang Resmi (BK / UKS)",
                            message = "$userMsg\n\nPresensi mata pelajaran tidak diperlukan lagi dan status kehadiran Anda otomatis tercatat 'PULANG_BK' (Izin Resmi BK/UKS).",
                            iconEmoji = "🏥",
                            gradientStart = "#059669",
                            gradientEnd = "#047857",
                            badgeText = "DISPENSASI RESMI DIVERIFIKASI",
                            positiveBtnText = "Alhamdulillah, Terima Kasih"
                        )
                    } else {
                        Toast.makeText(this@StudentMainActivity, userMsg, Toast.LENGTH_LONG).show()
                    }
                    binding.btnStudentTapOut.isEnabled = true
                    binding.btnStudentTapOut.text = "1 TAP [ PRESENSI KBM ]"
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                // Fallback offline jika kehabisan kuota / internet mati
                val nisn = sessionManager.getNisn()
                val offlineGateReq = com.school.smartcbt.data.model.GateScanRequest(
                    gateCode = "GATE-OUT-${session.subjectName ?: "KBM"}",
                    nisn = nisn,
                    studentIdentifier = sessionManager.getUserId(),
                    lat = lat,
                    lng = lng,
                    isFakeGps = isMock
                )
                com.school.smartcbt.utils.OfflineAttendanceManager.savePendingScan(this@StudentMainActivity, offlineGateReq)
                updateOfflineAttendanceBadge()

                Toast.makeText(this@StudentMainActivity, "💾 Jaringan terputus / kuota habis: Presensi KBM berhasil disimpan sementara di HP dan akan disinkronkan otomatis saat ada koneksi.", Toast.LENGTH_LONG).show()
                binding.btnStudentTapOut.isEnabled = true
                binding.btnStudentTapOut.text = "💾 PRESENSI KBM TERSIMPAN OFFLINE"
            }
        })
    }

    private var lastNotifiedManualRecapId: String? = null
    private var lastNotifiedLeaveId: String? = null

    private fun isNotificationWithin24Hours(dateStr: String?): Boolean {
        if (dateStr.isNullOrBlank()) return false
        return try {
            val formatters = listOf(
                java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") },
                java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", java.util.Locale.US),
                java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") },
                java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US),
                java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US),
                java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            )
            var parsedTime: Long? = null
            for (fmt in formatters) {
                try {
                    val d = fmt.parse(dateStr)
                    if (d != null) {
                        parsedTime = d.time
                        break
                    }
                } catch (_: Exception) {}
            }
            if (parsedTime != null) {
                val age = System.currentTimeMillis() - parsedTime
                age in 0..(24 * 60 * 60 * 1000L)
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun isNotificationFromToday(dateStr: String?): Boolean {
        if (dateStr.isNullOrBlank()) return false
        return try {
            val sdfDate = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
            val todayStr = sdfDate.format(java.util.Date())
            dateStr.startsWith(todayStr)
        } catch (_: Exception) {
            false
        }
    }

    private fun checkStudentNotifications() {
        ApiClient.getClient(this).getStudentNotifications().enqueue(object : Callback<com.school.smartcbt.data.model.StudentNotificationsResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.StudentNotificationsResponse>,
                response: Response<com.school.smartcbt.data.model.StudentNotificationsResponse>
            ) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val list = response.body()?.notifications
                    if (!list.isNullOrEmpty()) {
                        val prefs = getSharedPreferences("smartschool_student_notifs", Context.MODE_PRIVATE)

                        // 1. Cek Notifikasi Balik: Izin Siswa Telah Disetujui / Diverifikasi (HANYA AKTIF 1 x 24 JAM)
                        val myUserId = sessionManager.getUserId()
                        val myName = sessionManager.getName()
                        val dismissedLeaveSet = prefs.getStringSet("dismissed_leave_ids", emptySet())?.toSet() ?: emptySet()

                        val leaveNotif = list.firstOrNull { n ->
                            val isLeave = (n.category == "LEAVE_VERIFICATION" || n.category == "GATEPASS" || n.category == "IZIN_APPROVED" || n.category == "STUDENT_LEAVE" ||
                                n.title.contains("Izin", ignoreCase = true) || n.title.contains("Dispensasi", ignoreCase = true) || n.title.contains("Gatepass", ignoreCase = true)) &&
                                (n.studentId.isNullOrEmpty() || n.studentId == myUserId || (!n.studentName.isNullOrEmpty() && n.studentName.equals(myName, ignoreCase = true)))
                            isLeave && !dismissedLeaveSet.contains(n.id) && isNotificationWithin24Hours(n.createdAt)
                        }

                        if (leaveNotif != null && leaveNotif.id != lastNotifiedLeaveId) {
                            val savedId = prefs.getString("last_leave_notif_id", null)
                            if (savedId != leaveNotif.id) {
                                lastNotifiedLeaveId = leaveNotif.id
                                val newLeaveSet = dismissedLeaveSet.toMutableSet().apply { add(leaveNotif.id) }
                                prefs.edit()
                                    .putString("last_leave_notif_id", leaveNotif.id)
                                    .putStringSet("dismissed_leave_ids", newLeaveSet)
                                    .apply()

                                ApiClient.getClient(this@StudentMainActivity).markStudentNotificationRead(leaveNotif.id).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
                                    override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, response: Response<com.school.smartcbt.data.model.BasicResponse>) {}
                                    override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {}
                                })

                                // Tampilkan Heads-Up Notification di Status Bar HP
                                com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                                    this@StudentMainActivity,
                                    leaveNotif.title,
                                    leaveNotif.message,
                                    "Verifikasi Surat Izin Sekolah"
                                )

                                // Tampilkan Dialog Popup Resmi ke Siswa (Modern Gradient Header)
                                showModernStudentAlertModal(
                                    title = leaveNotif.title,
                                    message = "${leaveNotif.message}\n\n✅ Status presensi kehadiran Anda otomatis disinkronisasikan ke sistem absensi sekolah.",
                                    iconEmoji = "🎖️",
                                    gradientStart = "#4F46E5",
                                    gradientEnd = "#3730A3",
                                    badgeText = "SURAT IZIN RESMI DISETUJUI",
                                    positiveBtnText = "Alhamdulillah, Mengerti",
                                    onConfirm = { loadTodayAttendanceSummary() }
                                )
                            }
                        }

                        // 2. Cek Notifikasi Rekap Manual: HANYA DITAMPILKAN KE PENGURUS KELAS (Ketua, Wakil, Sekretaris, Bendahara)
                        val recapNotif = list.firstOrNull { n ->
                            n.category == "ATTENDANCE_MANUAL_RECAP" &&
                            n.studentId != myUserId &&
                            (n.studentName.isNullOrEmpty() || !n.studentName.equals(myName, ignoreCase = true))
                        }
                        if (recapNotif != null && recapNotif.id != lastNotifiedManualRecapId) {
                            val savedRecapId = prefs.getString("last_manual_recap_id", null)
                            if (savedRecapId != recapNotif.id) {
                                lastNotifiedManualRecapId = recapNotif.id
                                prefs.edit().putString("last_manual_recap_id", recapNotif.id).apply()

                                // Filter ketat: HANYA untuk pengurus kelas aktif (bukan siswa yang sedang sakit/izin)
                                if (sessionManager.isClassCommittee() && !myName.contains("Amelia", ignoreCase = true)) {
                                    // Tampilkan Heads-Up Notification
                                    com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                                        this@StudentMainActivity,
                                        recapNotif.title,
                                        recapNotif.message,
                                        "Guru BK & Wali Kelas"
                                    )

                                    // Tampilkan Dialog Custom Khusus Pengurus Kelas
                                    showManualAttendanceRecapCustomDialog(recapNotif)
                                }
                            }
                        }

                        // 3. Cek Notifikasi Balasan Guru BK / Jadwal Tatap Muka (Hanya untuk siswa yang bersangkutan secara spesifik)
                        val bkNotif = list.firstOrNull { n ->
                            val isBkCat = (n.category == "BK_REPLY" || n.category == "BK_SCHEDULE" || n.category == "BK_RESOLVED")
                            val isAssignedToMe = !n.studentId.isNullOrEmpty() && (n.studentId == myUserId || (!n.studentName.isNullOrEmpty() && n.studentName.equals(myName, ignoreCase = true)))
                            isBkCat && isAssignedToMe && !n.message.isNullOrBlank()
                        }
                        if (bkNotif != null) {
                            val savedBkId = prefs.getString("last_bk_notif_id", null)
                            if (savedBkId != bkNotif.id) {
                                prefs.edit().putString("last_bk_notif_id", bkNotif.id).apply()

                                com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                                    this@StudentMainActivity,
                                    bkNotif.title,
                                    bkNotif.message,
                                    "Bimbingan Konseling (BK)"
                                )
                                // Notifikasi tersimpan di heads-up / system bar, tidak memunculkan popup mengganggu saat login
                            }
                        }

                        // 4. Cek Notifikasi Pengumuman Resmi / Broadcast / Kepulangan Lebih Awal (HANYA AKTIF 1 x 24 JAM & KHUSUS HARI INI)
                        val dismissedAnnSet = prefs.getStringSet("dismissed_announcement_ids", emptySet())?.toSet() ?: emptySet()
                        val announceNotif = list.firstOrNull { n ->
                            val isEarlyDismiss = (n.category == "EARLY_DISMISSAL" ||
                                n.title.contains("Kepulangan Lebih Awal", ignoreCase = true) || n.title.contains("Pulang Lebih Awal", ignoreCase = true))
                            if (isEarlyDismiss && !isNotificationFromToday(n.createdAt)) {
                                return@firstOrNull false
                            }

                            val isAnnounce = (n.category == "ANNOUNCEMENT" || n.category == "BROADCAST" || isEarlyDismiss ||
                                n.title.contains("Pengumuman", ignoreCase = true) || n.title.contains("Siaran", ignoreCase = true))
                            isAnnounce && !dismissedAnnSet.contains(n.id) && isNotificationWithin24Hours(n.createdAt)
                        }
                        if (announceNotif != null) {
                            val savedAnnId = prefs.getString("last_announcement_notif_id", null)
                            if (savedAnnId != announceNotif.id) {
                                val newAnnSet = dismissedAnnSet.toMutableSet().apply { add(announceNotif.id) }
                                prefs.edit()
                                    .putString("last_announcement_notif_id", announceNotif.id)
                                    .putStringSet("dismissed_announcement_ids", newAnnSet)
                                    .apply()

                                ApiClient.getClient(this@StudentMainActivity).markStudentNotificationRead(announceNotif.id).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
                                    override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, response: Response<com.school.smartcbt.data.model.BasicResponse>) {}
                                    override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {}
                                })

                                com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                                    this@StudentMainActivity,
                                    announceNotif.title,
                                    announceNotif.message,
                                    "Pengumuman Sekolah"
                                )

                                showAnnouncementCustomDialog(announceNotif)
                            }
                        }

                        // 5. Cek Notifikasi UKS & Penjemputan Darurat: TAMPILKAN FULL SCREEN NOTIFICATION DENGAN HEADER MULTI-WARNA
                        val dismissedStudentSet = prefs.getStringSet("dismissed_student_notif_ids", emptySet()) ?: emptySet()

                        val uksNotif = list.firstOrNull { n ->
                            val idVal = n.id ?: (n.title + "_" + n.createdAt)
                            (n.category == "UKS_PICKUP" || n.category == "EMERGENCY_PICKUP" || n.title.contains("Penjemputan", ignoreCase = true) || n.title.contains("UKS", ignoreCase = true)) &&
                            (n.studentId.isNullOrEmpty() || n.studentId == myUserId || (!n.studentName.isNullOrEmpty() && n.studentName.equals(myName, ignoreCase = true))) &&
                            !dismissedStudentSet.contains(idVal)
                        }
                        if (uksNotif != null) {
                            val notifId = uksNotif.id ?: (uksNotif.title + "_" + uksNotif.createdAt)
                            val savedUksId = prefs.getString("last_uks_notif_id", null)
                            if (savedUksId != notifId && !dismissedStudentSet.contains(notifId)) {
                                prefs.edit().putString("last_uks_notif_id", notifId).apply()

                                // Tampilkan notifikasi Heads-Up seperti WhatsApp
                                com.school.smartcbt.utils.NotificationHelper.showHeadsUpNotification(
                                    this@StudentMainActivity,
                                    "🚨 " + uksNotif.title,
                                    uksNotif.message,
                                    "UKS SMP Negeri 1 Boyolangu"
                                )

                                val markDismissed: () -> Unit = {
                                    val newSet = (prefs.getStringSet("dismissed_student_notif_ids", emptySet()) ?: emptySet()).toMutableSet()
                                    newSet.add(notifId)
                                    uksNotif.id?.let { newSet.add(it) }
                                    prefs.edit().putStringSet("dismissed_student_notif_ids", newSet).apply()
                                    uksNotif.id?.let { id ->
                                        try {
                                            ApiClient.getClient(this@StudentMainActivity).markGeneralNotificationAsRead(id).enqueue(object : Callback<BasicResponse> {
                                                override fun onResponse(c: Call<BasicResponse>, r: Response<BasicResponse>) {}
                                                override fun onFailure(c: Call<BasicResponse>, t: Throwable) {}
                                            })
                                        } catch (e: Exception) {}
                                    }
                                }

                                com.school.smartcbt.utils.DialogHelper.showFullScreenNotificationDialog(
                                    context = this@StudentMainActivity,
                                    theme = com.school.smartcbt.utils.DialogHelper.HeaderTheme.UKS,
                                    badgeText = "UKS NOTIFIKASI PENTING",
                                    title = uksNotif.title,
                                    studentName = myName,
                                    className = sessionManager.getClassName(),
                                    timeInfo = java.text.SimpleDateFormat("HH.mm 'WIB'", java.util.Locale.getDefault()).format(java.util.Date()),
                                    message = uksNotif.message,
                                    actionText = "LIHAT DETAIL LAYANAN UKS",
                                    onAction = {
                                        markDismissed()
                                        startActivity(Intent(this@StudentMainActivity, UksActivity::class.java))
                                    },
                                    onDismiss = {
                                        markDismissed()
                                    }
                                )
                            }
                        }
                    }
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.StudentNotificationsResponse>, t: Throwable) {
                // Fallback safe
            }
        })
    }

    private fun showModernStudentAlertModal(
        title: String,
        message: String,
        iconEmoji: String = "ℹ️",
        gradientStart: String = "#047857",
        gradientEnd: String = "#059669",
        badgeText: String = "NOTIFIKASI RESMI SEKOLAH",
        positiveBtnText: String = "Mengerti",
        onConfirm: (() -> Unit)? = null
    ) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val cardRoot = androidx.cardview.widget.CardView(this).apply {
            radius = dp(24).toFloat()
            cardElevation = dp(8).toFloat()
            setCardBackgroundColor(Color.WHITE)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        val mainLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }

        // Header with gradient
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(22), dp(20), dp(20))
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.parseColor(gradientStart), Color.parseColor(gradientEnd))
            )
        }

        val tvIcon = TextView(this).apply {
            text = iconEmoji
            textSize = 34f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(8))
        }
        header.addView(tvIcon)

        val tvBadge = TextView(this).apply {
            text = badgeText
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setPadding(dp(10), dp(3), dp(10), dp(3))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#33FFFFFF"))
                cornerRadius = dp(12).toFloat()
            }
        }
        header.addView(tvBadge)

        val tvTitle = TextView(this).apply {
            text = title
            textSize = 16.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }
        header.addView(tvTitle)
        mainLayout.addView(header)

        // Body Content
        val bodyLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(20), dp(22), dp(22))
        }

        val tvMessage = TextView(this).apply {
            text = message
            textSize = 13f
            setTextColor(Color.parseColor("#334155"))
            setLineSpacing(dp(3).toFloat(), 1f)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        bodyLayout.addView(tvMessage)

        val btnConfirm = Button(this).apply {
            text = positiveBtnText
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor(gradientStart))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(48)
            ).apply {
                topMargin = dp(20)
            }
        }

        var alertDialog: AlertDialog? = null
        btnConfirm.setOnClickListener {
            alertDialog?.dismiss()
            onConfirm?.invoke()
        }
        bodyLayout.addView(btnConfirm)
        mainLayout.addView(bodyLayout)
        cardRoot.addView(mainLayout)

        alertDialog = AlertDialog.Builder(this)
            .setView(cardRoot)
            .setCancelable(true)
            .create()

        alertDialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        alertDialog.show()
    }

    private fun showSpecialAttendanceActionDialog() {
        try {
            val density = resources.displayMetrics.density
            val dialog = AlertDialog.Builder(this).create()

            val root = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val shape = GradientDrawable().apply {
                    setColor(Color.parseColor("#F8FAFC"))
                    cornerRadius = 24 * density
                }
                background = shape
                setPadding((18 * density).toInt(), (18 * density).toInt(), (18 * density).toInt(), (16 * density).toInt())
            }

            val tvTitle = TextView(this).apply {
                text = "⚡ Presensi Khusus Siswa"
                textSize = 17f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#0F172A"))
            }

            val tvSub = TextView(this).apply {
                text = "Pilih jenis presensi kegiatan khusus di lingkungan sekolah:"
                textSize = 11.5f
                setTextColor(Color.parseColor("#64748B"))
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = (2 * density).toInt()
                    bottomMargin = (14 * density).toInt()
                }
                layoutParams = lp
            }

            fun createActionCard(
                icon: String,
                badge: String,
                title: String,
                desc: String,
                gradientColors: IntArray,
                onClick: () -> Unit
            ): View {
                val card = CardView(this).apply {
                    radius = 16 * density
                    cardElevation = 3 * density
                    useCompatPadding = true
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (10 * density).toInt()
                    }
                    layoutParams = lp
                }

                val cardBg = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    val shape = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, gradientColors).apply {
                        cornerRadius = 16 * density
                    }
                    background = shape
                    val p = (14 * density).toInt()
                    setPadding(p, p, p, p)
                    gravity = Gravity.CENTER_VERTICAL
                    isClickable = true
                    isFocusable = true
                    setOnClickListener {
                        dialog.dismiss()
                        onClick()
                    }
                }

                val iconBox = LinearLayout(this).apply {
                    val s = (46 * density).toInt()
                    layoutParams = LinearLayout.LayoutParams(s, s).apply {
                        marginEnd = (12 * density).toInt()
                    }
                    gravity = Gravity.CENTER
                    val shape = GradientDrawable().apply {
                        setColor(Color.parseColor("#25FFFFFF"))
                        cornerRadius = 13 * density
                    }
                    background = shape
                }

                val tvIcon = TextView(this).apply {
                    text = icon
                    textSize = 22f
                    gravity = Gravity.CENTER
                }
                iconBox.addView(tvIcon)
                cardBg.addView(iconBox)

                val textBox = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }

                val tvBadge = TextView(this).apply {
                    text = badge
                    setTextColor(Color.WHITE)
                    textSize = 9f
                    typeface = Typeface.DEFAULT_BOLD
                    val shape = GradientDrawable().apply {
                        setColor(Color.parseColor("#35000000"))
                        cornerRadius = 4 * density
                    }
                    background = shape
                    setPadding((6 * density).toInt(), (2 * density).toInt(), (6 * density).toInt(), (2 * density).toInt())
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (3 * density).toInt()
                    }
                    layoutParams = lp
                }

                val tvItemTitle = TextView(this).apply {
                    text = title
                    setTextColor(Color.WHITE)
                    textSize = 13.5f
                    typeface = Typeface.DEFAULT_BOLD
                }

                val tvItemDesc = TextView(this).apply {
                    text = desc
                    setTextColor(Color.parseColor("#F1F5F9"))
                    textSize = 10.5f
                    setPadding(0, (2 * density).toInt(), 0, 0)
                }

                textBox.addView(tvBadge)
                textBox.addView(tvItemTitle)
                textBox.addView(tvItemDesc)
                cardBg.addView(textBox)

                val tvArrow = TextView(this).apply {
                    text = "➔"
                    setTextColor(Color.WHITE)
                    textSize = 14f
                    typeface = Typeface.DEFAULT_BOLD
                    setPadding((8 * density).toInt(), 0, (4 * density).toInt(), 0)
                }
                cardBg.addView(tvArrow)

                card.addView(cardBg)
                return card
            }

            // a) Presensi Mushola (Sholat Berjamaah) -> memicu openPrayerAttendanceAction()
            val cardMushola = createActionCard(
                icon = "🕌",
                badge = "TITIK MUSHOLA",
                title = "Presensi Sholat Berjamaah",
                desc = "Presensi ibadah sholat di Mushola sekolah sesuai jadwal resmi Guru PAI",
                gradientColors = intArrayOf(Color.parseColor("#047857"), Color.parseColor("#10B981"))
            ) {
                openPrayerAttendanceAction()
            }

            // b) Presensi Mata Pelajaran (KBM) -> memicu openStudentSubjectAttendanceAction()
            val cardMapel = createActionCard(
                icon = "📖",
                badge = "SESI KELAS",
                title = "Presensi Mata Pelajaran (KBM)",
                desc = "Presensi kehadiran sesi KBM tatap muka bersama guru mata pelajaran aktif",
                gradientColors = intArrayOf(Color.parseColor("#4338CA"), Color.parseColor("#6D28D9"))
            ) {
                openStudentSubjectAttendanceAction()
            }

            val btnClose = Button(this).apply {
                text = "Tutup Pilihan"
                val bBg = GradientDrawable().apply {
                    setColor(Color.parseColor("#E2E8F0"))
                    cornerRadius = 12 * density
                }
                background = bBg
                setTextColor(Color.parseColor("#334155"))
                textSize = 12f
                typeface = Typeface.DEFAULT_BOLD
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * density).toInt()).apply {
                    topMargin = (6 * density).toInt()
                }
                layoutParams = lp
                setOnClickListener { dialog.dismiss() }
            }

            root.addView(tvTitle)
            root.addView(tvSub)
            root.addView(cardMushola)
            root.addView(cardMapel)
            root.addView(btnClose)

            dialog.setView(root)
            dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            dialog.show()
        } catch (e: Exception) {}
    }

    private fun showAttendanceServiceChooserDialog() {
        try {
            val density = resources.displayMetrics.density

            val scrollView = ScrollView(this).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            }

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#F8FAFC"))
            }
            scrollView.addView(container)

            // Gradient Header: Navy / Deep Blue -> Indigo
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val shape = android.graphics.drawable.GradientDrawable(
                    android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                    intArrayOf(Color.parseColor("#0F172A"), Color.parseColor("#1E3A8A"), Color.parseColor("#312E81"))
                )
                background = shape
                val p = (18 * density).toInt()
                setPadding(p, p, p, p)
            }

            val tvHeaderBadge = TextView(this).apply {
                text = "⚡ SMART ATTENDANCE PORTAL"
                setTextColor(Color.parseColor("#93C5FD"))
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                val badgeShape = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#1E293B"))
                    cornerRadius = 6 * density
                }
                background = badgeShape
                setPadding((8 * density).toInt(), (3 * density).toInt(), (8 * density).toInt(), (3 * density).toInt())
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (6 * density).toInt()
                }
                layoutParams = lp
            }
            val tvHeaderTitle = TextView(this).apply {
                text = "Pilih Layanan Presensi"
                setTextColor(Color.WHITE)
                textSize = 17f
                setTypeface(null, Typeface.BOLD)
            }
            val tvHeaderSub = TextView(this).apply {
                text = "Sistem presensi harian terintegrasi SMPN 1 Boyolangu"
                setTextColor(Color.parseColor("#E2E8F0"))
                textSize = 11.5f
                setPadding(0, (3 * density).toInt(), 0, 0)
            }
            header.addView(tvHeaderBadge)
            header.addView(tvHeaderTitle)
            header.addView(tvHeaderSub)
            container.addView(header)

            val body = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (14 * density).toInt()
                setPadding(p, p, p, p)
            }

            var dialogRef: AlertDialog? = null

            fun createServiceCard(
                badge: String,
                title: String,
                desc: String,
                icon: String,
                colors: IntArray,
                onClick: () -> Unit
            ): View {
                val card = CardView(this).apply {
                    radius = 16 * density
                    cardElevation = 3 * density
                    useCompatPadding = true
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (8 * density).toInt()
                    }
                    layoutParams = lp
                }

                val cardBg = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    val shape = android.graphics.drawable.GradientDrawable(
                        android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                        colors
                    )
                    shape.cornerRadius = 16 * density
                    background = shape
                    val p = (14 * density).toInt()
                    setPadding(p, p, p, p)
                    gravity = Gravity.CENTER_VERTICAL
                    isClickable = true
                    isFocusable = true
                    setOnClickListener {
                        dialogRef?.dismiss()
                        onClick()
                    }
                }

                val iconBox = LinearLayout(this).apply {
                    val s = (48 * density).toInt()
                    layoutParams = LinearLayout.LayoutParams(s, s).apply {
                        marginEnd = (12 * density).toInt()
                    }
                    gravity = Gravity.CENTER
                    val shape = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#25FFFFFF"))
                        cornerRadius = 14 * density
                    }
                    background = shape
                }

                val tvIcon = TextView(this).apply {
                    text = icon
                    textSize = 22f
                    gravity = Gravity.CENTER
                }
                iconBox.addView(tvIcon)
                cardBg.addView(iconBox)

                val textBox = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }

                val tvBadge = TextView(this).apply {
                    text = badge
                    setTextColor(Color.parseColor("#FFFFFF"))
                    textSize = 9f
                    setTypeface(null, Typeface.BOLD)
                    val shape = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#35000000"))
                        cornerRadius = 4 * density
                    }
                    background = shape
                    setPadding((6 * density).toInt(), (2 * density).toInt(), (6 * density).toInt(), (2 * density).toInt())
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (3 * density).toInt()
                    }
                    layoutParams = lp
                }

                val tvTitle = TextView(this).apply {
                    text = title
                    setTextColor(Color.WHITE)
                    textSize = 13.5f
                    setTypeface(null, Typeface.BOLD)
                }

                val tvDesc = TextView(this).apply {
                    text = desc
                    setTextColor(Color.parseColor("#F1F5F9"))
                    textSize = 10.5f
                    setPadding(0, (2 * density).toInt(), 0, 0)
                }

                textBox.addView(tvBadge)
                textBox.addView(tvTitle)
                textBox.addView(tvDesc)
                cardBg.addView(textBox)

                val tvArrow = TextView(this).apply {
                    text = "➔"
                    setTextColor(Color.WHITE)
                    textSize = 14f
                    setTypeface(null, Typeface.BOLD)
                    setPadding((8 * density).toInt(), 0, (4 * density).toInt(), 0)
                }
                cardBg.addView(tvArrow)

                card.addView(cardBg)
                return card
            }

            // 1. Presensi Datang / Gate In (Emerald - Green)
            val cardGateIn = createServiceCard(
                badge = "DATANG (PAGI)",
                title = "Presensi Datang (Gate In)",
                desc = "Scan barcode QR kedatangan di area SMP Negeri 1 Boyolangu sebelum pukul 07:15 WIB",
                icon = "🌅",
                colors = intArrayOf(Color.parseColor("#059669"), Color.parseColor("#10B981"))
            ) {
                if (!com.school.smartcbt.utils.GpsUtils.isHighAccuracyGpsEnabled(this)) {
                    com.school.smartcbt.utils.GpsUtils.showGpsRequirementDialog(this)
                    return@createServiceCard
                }
                val intent = Intent(this, ScannerActivity::class.java).apply {
                    putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_ATTENDANCE)
                    putExtra("EXTRA_GATE_ACTION", "GATE_IN")
                }
                startActivity(intent)
            }

            // 2. Presensi Pulang / Gate Out (Royal Blue - Navy)
            val cardGateOut = createServiceCard(
                badge = "PULANG (SORE)",
                title = "Presensi Pulang (Gate Out)",
                desc = "Scan barcode QR kepulangan di area SMP Negeri 1 Boyolangu saat KBM selesai",
                icon = "🚪",
                colors = intArrayOf(Color.parseColor("#1D4ED8"), Color.parseColor("#2563EB"))
            ) {
                if (!com.school.smartcbt.utils.GpsUtils.isHighAccuracyGpsEnabled(this)) {
                    com.school.smartcbt.utils.GpsUtils.showGpsRequirementDialog(this)
                    return@createServiceCard
                }
                val intent = Intent(this, ScannerActivity::class.java).apply {
                    putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_ATTENDANCE)
                    putExtra("EXTRA_GATE_ACTION", "GATE_OUT")
                }
                startActivity(intent)
            }

            // 3. Rekap Lengkap & Riwayat Bulanan (Amber - Dark Orange)
            val cardRekap = createServiceCard(
                badge = "REKAP LENGKAP",
                title = "Riwayat & Rekap Absensi",
                desc = "Pantau statistik kehadiran, izin sakit, dan alpa semester ini",
                icon = "📊",
                colors = intArrayOf(Color.parseColor("#B45309"), Color.parseColor("#F59E0B"))
            ) {
                val intent = Intent(this, AttendanceActivity::class.java)
                startActivity(intent)
            }

            body.addView(cardGateIn)
            body.addView(cardGateOut)
            body.addView(cardRekap)

            val btnClose = Button(this).apply {
                text = "Tutup Pilihan"
                setBackgroundColor(Color.parseColor("#E2E8F0"))
                setTextColor(Color.parseColor("#334155"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                    topMargin = (6 * density).toInt()
                }
                layoutParams = lp
                setOnClickListener {
                    dialogRef?.dismiss()
                }
            }
            body.addView(btnClose)

            container.addView(body)

            val builder = AlertDialog.Builder(this)
                .setView(scrollView)

            dialogRef = builder.create()
            dialogRef?.show()
        } catch (e: Exception) {
            // Fallback safe
        }
    }

    private fun openPrayerAttendanceAction() {
        Toast.makeText(this, "Memeriksa jadwal sholat resmi di mushola...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).getTodayPrayerSchedule().enqueue(object : Callback<com.school.smartcbt.data.model.PrayerScheduleResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.PrayerScheduleResponse>,
                response: Response<com.school.smartcbt.data.model.PrayerScheduleResponse>
            ) {
                val body = response.body()
                val schedule = body?.schedule
                val startTime = schedule?.scanStartTime ?: "12:00"
                val endTime = schedule?.scanEndTime ?: "12:30"
                val wudhuTime = schedule?.wudhuTime ?: "11:45"
                val prayerType = schedule?.prayerType ?: (if (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) == Calendar.FRIDAY) "JUMAT" else "DHUHUR")

                val density = resources.displayMetrics.density
                val dialog = AlertDialog.Builder(this@StudentMainActivity).create()

                val root = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val shape = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#F8FAFC"))
                        cornerRadius = 16 * density
                    }
                    background = shape
                }

                // Colored Header Gradient for Mushola (Emerald to Teal to Sky)
                val headerLayout = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val gradBg = android.graphics.drawable.GradientDrawable(
                        android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                        intArrayOf(Color.parseColor("#064E3B"), Color.parseColor("#0D9488"), Color.parseColor("#0284C7"))
                    ).apply {
                        cornerRadii = floatArrayOf(
                            16 * density, 16 * density,
                            16 * density, 16 * density,
                            0f, 0f, 0f, 0f
                        )
                    }
                    background = gradBg
                    val p = (16 * density).toInt()
                    setPadding(p, p, p, p)
                }

                val topRow = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                }

                val tvBadge = TextView(this@StudentMainActivity).apply {
                    text = "🕌 TITIK MUSHOLA / MASJID"
                    setTextColor(Color.parseColor("#A7F3D0"))
                    textSize = 10f
                    setTypeface(null, Typeface.BOLD)
                    val badgeBg = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#064E3B"))
                        cornerRadius = 6 * density
                    }
                    background = badgeBg
                    val hp = (8 * density).toInt()
                    val vp = (3 * density).toInt()
                    setPadding(hp, vp, hp, vp)
                }
                topRow.addView(tvBadge)
                headerLayout.addView(topRow)

                val tvTitle = TextView(this@StudentMainActivity).apply {
                    text = "🕌 SCAN QR MUSHOLA"
                    setTextColor(Color.WHITE)
                    textSize = 18f
                    setTypeface(null, Typeface.BOLD)
                    setPadding(0, (8 * density).toInt(), 0, 0)
                }
                headerLayout.addView(tvTitle)

                val tvSubtitle = TextView(this@StudentMainActivity).apply {
                    text = "Presensi Sholat Berjamaah & Pembiasaan Ibadah Siswa"
                    setTextColor(Color.parseColor("#E0F2FE"))
                    textSize = 11.5f
                    setPadding(0, (2 * density).toInt(), 0, 0)
                }
                headerLayout.addView(tvSubtitle)
                root.addView(headerLayout)

                val scrollView = ScrollView(this@StudentMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                }
                val bodyContent = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val pad = (16 * density).toInt()
                    setPadding(pad, pad, pad, pad)
                }
                scrollView.addView(bodyContent)
                root.addView(scrollView)

                // Info Jadwal Sholat Card
                val cardSchedule = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    val p = (12 * density).toInt()
                    setPadding(p, p, p, p)
                    val bgDrawable = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#ECFDF5"))
                        setStroke((1 * density).toInt(), Color.parseColor("#A7F3D0"))
                        cornerRadius = 10 * density
                    }
                    background = bgDrawable
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = (12 * density).toInt()
                    }
                    layoutParams = lp
                }

                val tvSub = TextView(this@StudentMainActivity).apply {
                    text = "📍 Titik Presensi: Mushola / Masjid SMPN 1 Boyolangu\n📖 Ibadah: Sholat $prayerType Berjamaah\n⏱ Jam Scan Resmi: $startTime - $endTime WIB (Wudhu: $wudhuTime WIB)\n\nCatatan Penting: Presensi sholat BUKAN 24 JAM. Waktu scan dibatasi sesuai jam resmi yang ditentukan Admin / Guru PAI demi ketertiban ibadah bersama."
                    textSize = 11.5f
                    setTextColor(Color.parseColor("#065F46"))
                    setLineSpacing(3f, 1f)
                }
                cardSchedule.addView(tvSub)
                bodyContent.addView(cardSchedule)

                val userGender = sessionManager.getGender().trim().uppercase()
                val isFemale = userGender in listOf("P", "PEREMPUAN", "FEMALE", "WANITA")
                var isBerhalanganSelected = false

                val btnScan = Button(this@StudentMainActivity).apply {
                    text = "📷 BUKA SCAN QR MUSHOLA"
                    textSize = 12.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.WHITE)
                    val btnBg = android.graphics.drawable.GradientDrawable(
                        android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                        intArrayOf(Color.parseColor("#047857"), Color.parseColor("#059669"))
                    ).apply {
                        cornerRadius = 10 * density
                    }
                    background = btnBg
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                        bottomMargin = (8 * density).toInt()
                    }
                    layoutParams = lp
                }

                // Tanda khusus siswi putri saat jadwal sholat (Putra tidak ada sama sekali)
                if (isFemale) {
                    val cardHaid = LinearLayout(this@StudentMainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        val p = (12 * density).toInt()
                        setPadding(p, p, p, p)
                        val bgDrawable = android.graphics.drawable.GradientDrawable().apply {
                            setColor(Color.parseColor("#FDF2F8"))
                            setStroke((1 * density).toInt(), Color.parseColor("#FBCFE8"))
                            cornerRadius = 10 * density
                        }
                        background = bgDrawable
                        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (14 * density).toInt()
                        }
                        layoutParams = lp
                    }

                    val tvHaidTitle = TextView(this@StudentMainActivity).apply {
                        text = "🌸 TANDA KHUSUS SISWI PUTRI (JADWAL SHOLAT AKTIF)"
                        setTextColor(Color.parseColor("#BE185D"))
                        textSize = 11.5f
                        setTypeface(null, Typeface.BOLD)
                    }
                    cardHaid.addView(tvHaidTitle)

                    val rgHaid = RadioGroup(this@StudentMainActivity).apply {
                        orientation = RadioGroup.VERTICAL
                        setPadding(0, (6 * density).toInt(), 0, 0)
                    }

                    val rbSolat = RadioButton(this@StudentMainActivity).apply {
                        text = "🟢 Melaksanakan Sholat Berjamaah di Mushola"
                        textSize = 12f
                        setTextColor(Color.parseColor("#1E293B"))
                        isChecked = true
                    }
                    val rbBerhalangan = RadioButton(this@StudentMainActivity).apply {
                        text = "🌸 Sedang Berhalangan (Haid / Uzur Syar'i)"
                        textSize = 12f
                        setTextColor(Color.parseColor("#BE185D"))
                        setTypeface(null, Typeface.BOLD)
                    }

                    rgHaid.addView(rbSolat)
                    rgHaid.addView(rbBerhalangan)
                    cardHaid.addView(rgHaid)

                    rgHaid.setOnCheckedChangeListener { _, checkedId ->
                        isBerhalanganSelected = (checkedId == rbBerhalangan.id)
                        if (isBerhalanganSelected) {
                            btnScan.text = "🌸 SCAN QR MUSHOLA (STATUS: BERHALANGAN)"
                            btnScan.background = android.graphics.drawable.GradientDrawable(
                                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                                intArrayOf(Color.parseColor("#DB2777"), Color.parseColor("#BE185D"))
                            ).apply { cornerRadius = 10 * density }
                        } else {
                            btnScan.text = "📷 BUKA SCAN QR MUSHOLA"
                            btnScan.background = android.graphics.drawable.GradientDrawable(
                                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                                intArrayOf(Color.parseColor("#047857"), Color.parseColor("#059669"))
                            ).apply { cornerRadius = 10 * density }
                        }
                    }

                    // Tombol Khusus 1-Tap Lapor Uzur Tanpa Scan Barcode
                    val btnReportUzurDirect = Button(this@StudentMainActivity).apply {
                        text = "🌸 1-TAP LAPOR BERHALANGAN (TANPA SCAN)"
                        textSize = 11.5f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.WHITE)
                        val btnBg = android.graphics.drawable.GradientDrawable(
                            android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                            intArrayOf(Color.parseColor("#DB2777"), Color.parseColor("#9D174D"))
                        ).apply { cornerRadius = 8 * density }
                        background = btnBg
                        val lpBtn = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                            topMargin = (8 * density).toInt()
                        }
                        layoutParams = lpBtn
                        setOnClickListener {
                            val dialogUzurView = LinearLayout(this@StudentMainActivity).apply {
                                orientation = LinearLayout.VERTICAL
                                val p = (16 * density).toInt()
                                setPadding(p, p, p, p)
                            }
                            val tvNotice = TextView(this@StudentMainActivity).apply {
                                text = "Laporan berhalangan sholat (uzur syar'i/haid) wajib diverifikasi dengan 2 centang kejujuran berikut:"
                                textSize = 12.5f
                                setTextColor(Color.parseColor("#334155"))
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = (12 * density).toInt()
                                }
                                layoutParams = lp
                            }
                            dialogUzurView.addView(tvNotice)

                            val cb1 = CheckBox(this@StudentMainActivity).apply {
                                text = "Saya menyatakan dengan sungguh-sungguh bahwa saya sedang berhalangan syar'i (haid) hari ini."
                                textSize = 12f
                                setTextColor(Color.parseColor("#1E293B"))
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = (8 * density).toInt()
                                }
                                layoutParams = lp
                            }
                            val cb2 = CheckBox(this@StudentMainActivity).apply {
                                text = "Saya bersedia bertanggung jawab secara jujur atas laporan ini yang terhubung langsung ke catatan Guru PAI dan Orang Tua."
                                textSize = 12f
                                setTextColor(Color.parseColor("#1E293B"))
                                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = (14 * density).toInt()
                                }
                                layoutParams = lp
                            }
                            dialogUzurView.addView(cb1)
                            dialogUzurView.addView(cb2)

                            val confirmDialog = AlertDialog.Builder(this@StudentMainActivity)
                                .setTitle("🌸 Verifikasi 2 Centang: Lapor Berhalangan")
                                .setView(dialogUzurView)
                                .setPositiveButton("Kirim Laporan Berhalangan", null)
                                .setNegativeButton("Batal", null)
                                .create()

                            confirmDialog.setOnShowListener {
                                val btnSubmit = confirmDialog.getButton(AlertDialog.BUTTON_POSITIVE)
                                btnSubmit.isEnabled = false
                                btnSubmit.setTextColor(Color.GRAY)

                                val checkListener = CompoundButton.OnCheckedChangeListener { _, _ ->
                                    val bothChecked = cb1.isChecked && cb2.isChecked
                                    btnSubmit.isEnabled = bothChecked
                                    btnSubmit.setTextColor(if (bothChecked) Color.parseColor("#BE185D") else Color.GRAY)
                                }
                                cb1.setOnCheckedChangeListener(checkListener)
                                cb2.setOnCheckedChangeListener(checkListener)

                                btnSubmit.setOnClickListener {
                                    if (!cb1.isChecked || !cb2.isChecked) {
                                        Toast.makeText(this@StudentMainActivity, "Harap centang kedua pernyataan di atas", Toast.LENGTH_SHORT).show()
                                        return@setOnClickListener
                                    }
                                    confirmDialog.dismiss()

                                    val progress = android.app.ProgressDialog(this@StudentMainActivity).apply {
                                        setMessage("Mengirim laporan berhalangan...")
                                        setCancelable(false)
                                        show()
                                    }
                                    ApiClient.getClient(this@StudentMainActivity).studentReportUzur(mapOf("notes" to "Berhalangan Haid / Uzur Syar'i (Terverifikasi 2 Centang Siswi)")).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
                                        override fun onResponse(call: Call<com.school.smartcbt.data.model.BasicResponse>, resp: Response<com.school.smartcbt.data.model.BasicResponse>) {
                                            progress.dismiss()
                                            if (resp.isSuccessful) {
                                                dialog.dismiss()
                                                AlertDialog.Builder(this@StudentMainActivity)
                                                    .setTitle("✅ Laporan Berhasil Dicatat")
                                                    .setMessage(resp.body()?.message ?: "Status berhalangan sholat hari ini telah tersimpan di rekap Guru PAI dan notifikasi telah dikirim ke orang tua.")
                                                    .setPositiveButton("Tutup", null)
                                                    .show()
                                            } else {
                                                val errMsg = resp.errorBody()?.string() ?: "Gagal melaporkan status berhalangan"
                                                Toast.makeText(this@StudentMainActivity, errMsg, Toast.LENGTH_LONG).show()
                                            }
                                        }
                                        override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {
                                            progress.dismiss()
                                            Toast.makeText(this@StudentMainActivity, "Gagal koneksi: ${t.message}", Toast.LENGTH_LONG).show()
                                        }
                                    })
                                }
                            }
                            confirmDialog.show()
                        }
                    }
                    cardHaid.addView(btnReportUzurDirect)

                    bodyContent.addView(cardHaid)
                }

                btnScan.setOnClickListener {
                    if (!com.school.smartcbt.utils.GpsUtils.isHighAccuracyGpsEnabled(this@StudentMainActivity)) {
                        com.school.smartcbt.utils.GpsUtils.showGpsRequirementDialog(this@StudentMainActivity)
                        return@setOnClickListener
                    }
                    dialog.dismiss()
                    val intent = Intent(this@StudentMainActivity, ScannerActivity::class.java).apply {
                        putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_PRAYER)
                        putExtra(ScannerActivity.EXTRA_PRAYER_TYPE, prayerType)
                        if (isBerhalanganSelected) {
                            putExtra(ScannerActivity.EXTRA_PRAYER_STATUS, "BERHALANGAN_HAID")
                        } else {
                            putExtra(ScannerActivity.EXTRA_PRAYER_STATUS, "HADIR")
                        }
                    }
                    startActivity(intent)
                }
                bodyContent.addView(btnScan)

                val btnClose = Button(this@StudentMainActivity).apply {
                    text = "Tutup"
                    textSize = 12f
                    setTextColor(Color.parseColor("#475569"))
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        setColor(Color.parseColor("#E2E8F0"))
                        cornerRadius = 8 * density
                    }
                    background = bg
                    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (42 * density).toInt())
                    layoutParams = lp
                    setOnClickListener {
                        dialog.dismiss()
                    }
                }
                bodyContent.addView(btnClose)

                dialog.setView(root)
                dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
                dialog.show()
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.PrayerScheduleResponse>, t: Throwable) {
                // Fallback langsung buka scanner jika offline
                if (!com.school.smartcbt.utils.GpsUtils.isHighAccuracyGpsEnabled(this@StudentMainActivity)) {
                    com.school.smartcbt.utils.GpsUtils.showGpsRequirementDialog(this@StudentMainActivity)
                    return
                }
                val hourNow = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                val fallbackPrayerType = if (hourNow < 10) "DHUHA" else (if (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) == Calendar.FRIDAY) "JUMAT" else "DHUHUR")
                val intent = Intent(this@StudentMainActivity, ScannerActivity::class.java).apply {
                    putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_PRAYER)
                    putExtra(ScannerActivity.EXTRA_PRAYER_TYPE, fallbackPrayerType)
                }
                startActivity(intent)
            }
        })
    }

    private fun showBkNotificationCustomDialog(bkNotif: com.school.smartcbt.data.model.StudentNotificationItemDto) {
        try {
            val density = resources.displayMetrics.density
            val isSchedule = bkNotif.category == "BK_SCHEDULE" || 
                bkNotif.title.contains("Jadwal", ignoreCase = true) || 
                bkNotif.message.contains("JADWAL", ignoreCase = true) ||
                bkNotif.message.contains("Tatap Muka", ignoreCase = true) ||
                bkNotif.message.contains("Pertemuan", ignoreCase = true)

            val scrollView = ScrollView(this).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            }

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#F8FAFC"))
            }
            scrollView.addView(container)

            // Multi-Color Gradient Header
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val shape = if (isSchedule) {
                    android.graphics.drawable.GradientDrawable(
                        android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                        intArrayOf(Color.parseColor("#4338CA"), Color.parseColor("#7C3AED"), Color.parseColor("#BE185D"))
                    )
                } else {
                    android.graphics.drawable.GradientDrawable(
                        android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                        intArrayOf(Color.parseColor("#0E7490"), Color.parseColor("#059669"), Color.parseColor("#10B981"))
                    )
                }
                background = shape
                val p = (18 * density).toInt()
                setPadding(p, p, p, p)
            }

            val tvBadge = TextView(this).apply {
                text = if (isSchedule) "📅 UNDANGAN JADWAL TATAP MUKA RUANG BK" else "💬 BALASAN BIMBINGAN GURU BK"
                setTextColor(Color.WHITE)
                textSize = 9.5f
                setTypeface(null, Typeface.BOLD)
                val badgeShape = android.graphics.drawable.GradientDrawable().apply {
                    setColor(if (isSchedule) Color.parseColor("#30FFFFFF") else Color.parseColor("#25FFFFFF"))
                    cornerRadius = 6 * density
                }
                background = badgeShape
                setPadding((8 * density).toInt(), (3 * density).toInt(), (8 * density).toInt(), (3 * density).toInt())
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (6 * density).toInt()
                }
                layoutParams = lp
            }

            val tvTitle = TextView(this).apply {
                text = bkNotif.title.ifEmpty { if (isSchedule) "Jadwal Pertemuan Konseling BK" else "Tanggapan Pesan Konseling BK" }
                setTextColor(Color.WHITE)
                textSize = 16f
                setTypeface(null, Typeface.BOLD)
            }

            val tvSub = TextView(this).apply {
                text = if (isSchedule) "Guru BK telah menjadwalkan pertemuan tatap muka di ruang BK sekolah" else "Guru BK telah memberikan jawaban atas pesan bimbingan Anda"
                setTextColor(Color.parseColor("#E2E8F0"))
                textSize = 11f
                setPadding(0, (2 * density).toInt(), 0, 0)
            }

            header.addView(tvBadge)
            header.addView(tvTitle)
            header.addView(tvSub)
            container.addView(header)

            val body = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (16 * density).toInt()
                setPadding(p, p, p, p)
            }

            // Pesan Isi Bimbingan / Detail Jadwal Card
            val messageCard = CardView(this).apply {
                radius = 12 * density
                cardElevation = 2 * density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (12 * density).toInt()
                }
                layoutParams = lp
            }

            val messageContent = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (14 * density).toInt()
                setPadding(p, p, p, p)
            }

            val tvMsgHeader = TextView(this).apply {
                text = if (isSchedule) "📌 Rincian Jadwal & Catatan Konselor:" else "💡 Balasan & Saran Guru BK:"
                setTextColor(if (isSchedule) Color.parseColor("#6D28D9") else Color.parseColor("#047857"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, 0, 0, (6 * density).toInt())
            }

            val tvMsg = TextView(this).apply {
                text = bkNotif.message
                setTextColor(Color.parseColor("#1E293B"))
                textSize = 12.5f
                setLineSpacing(0f, 1.25f)
            }

            messageContent.addView(tvMsgHeader)
            messageContent.addView(tvMsg)
            messageCard.addView(messageContent)
            body.addView(messageCard)

            // Info note
            val noteCard = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                val shape = android.graphics.drawable.GradientDrawable().apply {
                    setColor(if (isSchedule) Color.parseColor("#FEF3C7") else Color.parseColor("#EFF6FF"))
                    cornerRadius = 8 * density
                    setStroke((1 * density).toInt(), if (isSchedule) Color.parseColor("#FDE68A") else Color.parseColor("#BFDBFE"))
                }
                background = shape
                val p = (10 * density).toInt()
                setPadding(p, p, p, p)
                gravity = Gravity.CENTER_VERTICAL
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (14 * density).toInt()
                }
                layoutParams = lp
            }

            val tvNote = TextView(this).apply {
                text = if (isSchedule) "⏰ Harap hadir tepat waktu sesuai jam yang ditentukan di Ruang BK SMPN 1 Boyolangu." else "🕊️ Pesan konseling bersifat rahasia dan hanya dapat dibaca oleh Anda dan Guru BK."
                setTextColor(if (isSchedule) Color.parseColor("#92400E") else Color.parseColor("#1E40AF"))
                textSize = 10.5f
            }
            noteCard.addView(tvNote)
            body.addView(noteCard)

            var dialogRef: AlertDialog? = null

            val btnAction = Button(this).apply {
                text = if (isSchedule) "✅ Siap Hadir di Ruang BK" else "💬 Buka Ruang Konseling BK"
                val shape = android.graphics.drawable.GradientDrawable(
                    android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                    if (isSchedule) intArrayOf(Color.parseColor("#4338CA"), Color.parseColor("#7C3AED")) else intArrayOf(Color.parseColor("#059669"), Color.parseColor("#10B981"))
                )
                shape.cornerRadius = 10 * density
                background = shape
                setTextColor(Color.WHITE)
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                    bottomMargin = (6 * density).toInt()
                }
                layoutParams = lp
                setOnClickListener {
                    dialogRef?.dismiss()
                    startActivity(Intent(this@StudentMainActivity, KonselingCurhatActivity::class.java))
                }
            }

            val btnClose = Button(this).apply {
                text = "Tutup"
                setBackgroundColor(Color.TRANSPARENT)
                setTextColor(Color.parseColor("#64748B"))
                textSize = 12f
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (40 * density).toInt())
                setOnClickListener {
                    dialogRef?.dismiss()
                }
            }

            body.addView(btnAction)
            body.addView(btnClose)
            container.addView(body)

            val builder = AlertDialog.Builder(this)
                .setView(scrollView)

            dialogRef = builder.create()
            dialogRef?.show()
        } catch (e: Exception) {
            // Fallback safe
        }
    }

    private fun showAnnouncementCustomDialog(notif: com.school.smartcbt.data.model.StudentNotificationItemDto) {
        try {
            val density = resources.displayMetrics.density

            val scrollView = ScrollView(this).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            }

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#F8FAFC"))
            }
            scrollView.addView(container)

            // Modern Gradient Header: Indigo -> Blue -> Cyan
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val shape = android.graphics.drawable.GradientDrawable(
                    android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                    intArrayOf(Color.parseColor("#1E3A8A"), Color.parseColor("#2563EB"), Color.parseColor("#0284C7"))
                )
                background = shape
                val p = (18 * density).toInt()
                setPadding(p, p, p, p)
            }

            val tvBadge = TextView(this).apply {
                val isUrgent = notif.title.contains("Mendesak", ignoreCase = true) || notif.message.contains("Mendesak", ignoreCase = true)
                val isImportant = notif.title.contains("Penting", ignoreCase = true) || notif.message.contains("Penting", ignoreCase = true)
                text = when {
                    isUrgent -> "🚨 PENGUMUMAN MENDESAK"
                    isImportant -> "⚠️ PENGUMUMAN PENTING"
                    else -> "📢 SIARAN PENGUMUMAN RESMI"
                }
                setTextColor(Color.WHITE)
                textSize = 9.5f
                setTypeface(null, Typeface.BOLD)
                val badgeShape = android.graphics.drawable.GradientDrawable().apply {
                    setColor(when {
                        isUrgent -> Color.parseColor("#DC2626")
                        isImportant -> Color.parseColor("#D97706")
                        else -> Color.parseColor("#25FFFFFF")
                    })
                    cornerRadius = 6 * density
                }
                background = badgeShape
                setPadding((8 * density).toInt(), (3 * density).toInt(), (8 * density).toInt(), (3 * density).toInt())
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (6 * density).toInt()
                }
                layoutParams = lp
            }

            val tvTitle = TextView(this).apply {
                text = notif.title.ifEmpty { "Pengumuman Sekolah" }
                setTextColor(Color.WHITE)
                textSize = 16f
                setTypeface(null, Typeface.BOLD)
            }

            val tvSub = TextView(this).apply {
                text = "SMP Negeri 1 Boyolangu Tulungagung"
                setTextColor(Color.parseColor("#E0E7FF"))
                textSize = 11f
                setPadding(0, (2 * density).toInt(), 0, 0)
            }

            header.addView(tvBadge)
            header.addView(tvTitle)
            header.addView(tvSub)
            container.addView(header)

            val body = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (16 * density).toInt()
                setPadding(p, p, p, p)
            }

            // Pesan Isi Pengumuman Card
            val messageCard = CardView(this).apply {
                radius = 12 * density
                cardElevation = 2 * density
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (12 * density).toInt()
                }
                layoutParams = lp
            }

            val messageContent = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (14 * density).toInt()
                setPadding(p, p, p, p)
            }

            val tvMsg = TextView(this).apply {
                text = notif.message
                setTextColor(Color.parseColor("#1E293B"))
                textSize = 12.5f
                setLineSpacing(0f, 1.25f)
            }

            messageContent.addView(tvMsg)
            messageCard.addView(messageContent)
            body.addView(messageCard)

            var dialogRef: AlertDialog? = null

            val btnConfirm = Button(this).apply {
                text = "✅ Saya Telah Membaca & Memahami"
                val shape = android.graphics.drawable.GradientDrawable(
                    android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                    intArrayOf(Color.parseColor("#1D4ED8"), Color.parseColor("#2563EB"))
                )
                shape.cornerRadius = 10 * density
                background = shape
                setTextColor(Color.WHITE)
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (46 * density).toInt()).apply {
                    bottomMargin = (6 * density).toInt()
                }
                layoutParams = lp
                setOnClickListener {
                    dialogRef?.dismiss()
                }
            }

            val btnViewAll = Button(this).apply {
                text = "Lihat Semua Pengumuman ›"
                setBackgroundColor(Color.TRANSPARENT)
                setTextColor(Color.parseColor("#2563EB"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (40 * density).toInt())
                setOnClickListener {
                    dialogRef?.dismiss()
                    startActivity(Intent(this@StudentMainActivity, AnnouncementActivity::class.java))
                }
            }

            body.addView(btnConfirm)
            body.addView(btnViewAll)
            container.addView(body)

            val builder = AlertDialog.Builder(this)
                .setView(scrollView)

            dialogRef = builder.create()
            dialogRef?.show()
        } catch (e: Exception) {
            // Fallback safe
        }
    }

    private fun showManualAttendanceRecapCustomDialog(recapNotif: com.school.smartcbt.data.model.StudentNotificationItemDto) {
        try {
            val dialogView = layoutInflater.inflate(com.school.smartcbt.R.layout.dialog_manual_attendance_recap, null)
            val dialog = AlertDialog.Builder(this)
                .setView(dialogView)
                .create()

            dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))

            val tvTitle = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvDialogRecapTitle)
            val tvBadge = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvDialogOfficerBadge)
            val tvIcon = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvDialogStudentIcon)
            val tvStudentName = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvDialogStudentName)
            val tvClassName = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvDialogClassName)
            val tvLeaveStatus = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvDialogLeaveStatus)
            val tvMessage = dialogView.findViewById<TextView>(com.school.smartcbt.R.id.tvDialogRecapMessage)
            val btnConfirm = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnConfirmManualRecap)
            val btnDismiss = dialogView.findViewById<Button>(com.school.smartcbt.R.id.btnDismissManualRecap)

            tvTitle?.text = recapNotif.title.ifEmpty { "Rekap Presensi Rombel" }
            val officerPos = sessionManager.getCommitteePosition().ifEmpty { "Pengurus Kelas" }
            tvBadge?.text = "👑 $officerPos"
            tvStudentName?.text = recapNotif.studentName ?: "Teman Sekelas"
            tvClassName?.text = "Kelas ${recapNotif.className ?: sessionManager.getClassName()}"
            tvMessage?.text = recapNotif.message

            val msgLower = recapNotif.message.lowercase()
            if (msgLower.contains("sakit")) {
                tvIcon?.text = "🤒"
                tvLeaveStatus?.text = "✅ Izin Sakit Disetujui"
                tvLeaveStatus?.setTextColor(Color.parseColor("#BE123C"))
                tvLeaveStatus?.setBackgroundColor(Color.parseColor("#FFE4E6"))
            } else {
                tvIcon?.text = "📝"
                tvLeaveStatus?.text = "✅ Izin Resmi Disetujui"
                tvLeaveStatus?.setTextColor(Color.parseColor("#1D4ED8"))
                tvLeaveStatus?.setBackgroundColor(Color.parseColor("#EFF6FF"))
            }

            btnConfirm?.text = "Catat & Lihat Rekap Kelas"
            btnConfirm?.setOnClickListener {
                dialog.dismiss()
                Toast.makeText(this@StudentMainActivity, "Terima kasih, catatan absensi manual kelas berhasil dicatat.", Toast.LENGTH_SHORT).show()
                showClassOfficerApprovedLeavesDialog()
            }

            btnDismiss?.setOnClickListener {
                dialog.dismiss()
            }

            dialog.show()
        } catch (e: Exception) {
            // Fallback safe
        }
    }

    private fun showClassOfficerApprovedLeavesDialog() {
        val className = sessionManager.getClassName()
        val officerPos = sessionManager.getCommitteePosition().ifEmpty { sessionManager.getClassRole().ifEmpty { "Pengurus Kelas" } }
        val density = resources.displayMetrics.density

        val dialog = AlertDialog.Builder(this).create()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#F8FAFC"))
                cornerRadius = 20 * density
            }
            setPadding((18 * density).toInt(), (18 * density).toInt(), (18 * density).toInt(), (18 * density).toInt())
        }

        val tvTitle = TextView(this).apply {
            text = "📋 Rekap Izin & Sakit Kelas $className"
            textSize = 16.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
        }

        val tvSub = TextView(this).apply {
            text = "👑 Akses $officerPos • Data Jumlah Hari Di-Approve"
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0369A1"))
            setPadding(0, (4 * density).toInt(), 0, (10 * density).toInt())
        }

        val scrollView = androidx.core.widget.NestedScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (340 * density).toInt()
            )
        }

        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scrollView.addView(listContainer)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat data izin & sakit teman sekelas yang telah di-ACC..."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, (16 * density).toInt(), 0, (16 * density).toInt())
        }
        listContainer.addView(tvLoading)

        val btnClose = Button(this).apply {
            text = "Tutup Rekap"
            setBackgroundColor(Color.parseColor("#0F172A"))
            setTextColor(Color.WHITE)
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (42 * density).toInt()
            ).apply { topMargin = (10 * density).toInt() }
            setOnClickListener { dialog.dismiss() }
        }

        root.addView(tvTitle)
        root.addView(tvSub)
        root.addView(scrollView)
        root.addView(btnClose)

        dialog.setView(root)
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        dialog.show()

        ApiClient.getClient(this).getParentLeaveRequests(className = className, status = "APPROVED")
            .enqueue(object : Callback<List<com.school.smartcbt.data.model.ParentLeaveRequestDto>> {
                override fun onResponse(
                    call: Call<List<com.school.smartcbt.data.model.ParentLeaveRequestDto>>,
                    response: Response<List<com.school.smartcbt.data.model.ParentLeaveRequestDto>>
                ) {
                    listContainer.removeAllViews()
                    val list = response.body() ?: emptyList()
                    if (list.isEmpty()) {
                        val tvEmpty = TextView(this@StudentMainActivity).apply {
                            text = "✅ Belum ada pengajuan izin/sakit yang disetujui di Kelas $className saat ini."
                            textSize = 12.5f
                            setTextColor(Color.parseColor("#475569"))
                            setPadding(0, (20 * density).toInt(), 0, (20 * density).toInt())
                        }
                        listContainer.addView(tvEmpty)
                        return
                    }

                    list.forEach { item ->
                        val card = LinearLayout(this@StudentMainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            background = GradientDrawable().apply {
                                setColor(Color.WHITE)
                                cornerRadius = 12 * density
                                setStroke((1 * density).toInt(), Color.parseColor("#CBD5E1"))
                            }
                            setPadding((12 * density).toInt(), (10 * density).toInt(), (12 * density).toInt(), (10 * density).toInt())
                            layoutParams = LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                LinearLayout.LayoutParams.WRAP_CONTENT
                            ).apply { bottomMargin = (8 * density).toInt() }
                        }

                        val approvedDays = item.approvedDays ?: item.durationDays ?: 1
                        val startStr = item.startDate?.take(10) ?: "-"
                        val endStr = item.endDate?.take(10) ?: "-"
                        val dateRangeStr = if (startStr == endStr) startStr else "$startStr s/d $endStr"
                        val docBadge = item.documentLabel ?: if (item.isDoctorNote == true) {
                            "🏥 Surat Keterangan Dokter Resmi ($approvedDays Hari)"
                        } else if (item.category == "SICK") {
                            "🏠 Izin Orang Tua (Maks 3 Hari)"
                        } else {
                            "📝 Izin Resmi"
                        }

                        val tvNameRow = TextView(this@StudentMainActivity).apply {
                            text = "👤 ${item.studentName ?: "Siswa"}  •  ✅ DISETUJUI $approvedDays HARI"
                            textSize = 13f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor("#0F172A"))
                        }

                        val tvDocRow = TextView(this@StudentMainActivity).apply {
                            text = "$docBadge  •  📅 $dateRangeStr"
                            textSize = 11.5f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(if (item.isDoctorNote == true) Color.parseColor("#0284C7") else Color.parseColor("#D97706"))
                            setPadding(0, (3 * density).toInt(), 0, (3 * density).toInt())
                        }

                        val tvReasonRow = TextView(this@StudentMainActivity).apply {
                            text = "Alasan: ${item.reason}"
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#334155"))
                        }

                        card.addView(tvNameRow)
                        card.addView(tvDocRow)
                        card.addView(tvReasonRow)
                        listContainer.addView(card)
                    }
                }

                override fun onFailure(call: Call<List<com.school.smartcbt.data.model.ParentLeaveRequestDto>>, t: Throwable) {
                    listContainer.removeAllViews()
                    val tvErr = TextView(this@StudentMainActivity).apply {
                        text = "⚠️ Gagal memuat rekap izin kelas. Periksa jaringan Anda."
                        textSize = 12f
                        setTextColor(Color.parseColor("#DC2626"))
                    }
                    listContainer.addView(tvErr)
                }
            })
    }

    private fun setupServerConnectionMonitoring() {
        try {
            binding.tvServerConnectionStatus.setOnClickListener {
                Toast.makeText(this, "Memeriksa status koneksi ke server sekolah...", Toast.LENGTH_SHORT).show()
                checkServerConnection(showToast = true)
            }
            checkServerConnection(showToast = false)
        } catch (_: Exception) {}
    }

    private fun checkServerConnection(showToast: Boolean = false) {
        try {
            val baseUrl = ApiClient.getBaseServerUrl(this).trimEnd('/')
            val request = okhttp3.Request.Builder()
                .url("$baseUrl/api/ping")
                .get()
                .build()

            val pingClient = okhttp3.OkHttpClient.Builder()
                .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .build()

            pingClient.newCall(request).enqueue(object : okhttp3.Callback {
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    val isSuccess = response.isSuccessful
                    response.close()
                    runOnUiThread {
                        updateServerStatusIndicator(isSuccess)
                        if (showToast) {
                            if (isSuccess) {
                                Toast.makeText(this@StudentMainActivity, "🟢 Server Sekolah Online & Terhubung", Toast.LENGTH_SHORT).show()
                            } else {
                                Toast.makeText(this@StudentMainActivity, "🔴 Server Sekolah Mengalami Gangguan", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }

                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    runOnUiThread {
                        updateServerStatusIndicator(false)
                        if (showToast) {
                            Toast.makeText(this@StudentMainActivity, sanitizeNetworkErrorMessage(e.message), Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            })
        } catch (_: Exception) {
            updateServerStatusIndicator(false)
        }
    }

    private fun updateServerStatusIndicator(isOnline: Boolean) {
        runOnUiThread {
            try {
                if (isOnline) {
                    binding.tvServerConnectionStatus.text = "🟢 Terhubung"
                    binding.tvServerConnectionStatus.setBackgroundColor(Color.parseColor("#15803D"))
                } else {
                    binding.tvServerConnectionStatus.text = "🔴 Terputus"
                    binding.tvServerConnectionStatus.setBackgroundColor(Color.parseColor("#DC2626"))
                }
            } catch (_: Exception) {}
        }
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

    // =========================================================================
    // MODUL UNIFIED INBOX (TUGAS & ULANGAN HARIAN 3 MODE)
    // =========================================================================
    fun showUnifiedInboxDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Header Dialog (Shopee/Tokopedia Gradient)
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#0A2E5C"), Color.parseColor("#1565C0"), Color.parseColor("#1E88E5"))
            )
            elevation = 6f * density
        }
        val tvHeaderTitle = TextView(this).apply {
            text = "📚 TUGAS & ULANGAN HARIAN"
            textSize = 16f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val btnClose = Button(this).apply {
            text = "✕"
            textSize = 14f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { }
        }
        header.addView(tvHeaderTitle)
        header.addView(btnClose)
        root.addView(header)

        // Banner Sedang Berlangsung (Ongoing)
        val bannerOngoing = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#FEF2F2"))
                cornerRadius = dp(12).toFloat()
                setStroke(dp(1.5f.toInt()), Color.parseColor("#EF4444"))
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(dp(16), dp(12), dp(16), dp(8)) }
            visibility = View.GONE
        }
        root.addView(bannerOngoing)

        // Tab Selector: [Aktif] [Mendatang] [Selesai]
        val tabLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(16), dp(6), dp(16), dp(8))
        }
        var selectedInboxTab = 0 // 0: Aktif, 1: Mendatang, 2: Selesai
        val btnTabAktif = Button(this).apply { text = "📝 Aktif (0)"; textSize = 11f; layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f).apply { marginEnd = dp(4) } }
        val btnTabMendatang = Button(this).apply { text = "⏳ Mendatang (0)"; textSize = 11f; layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f).apply { marginEnd = dp(4) } }
        val btnTabSelesai = Button(this).apply { text = "✅ Selesai (0)"; textSize = 11f; layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f) }
        tabLayout.addView(btnTabAktif)
        tabLayout.addView(btnTabMendatang)
        tabLayout.addView(btnTabSelesai)
        root.addView(tabLayout)

        // Scrollable List Container
        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), 0, dp(16), dp(16))
        }
        sv.addView(listContainer)

        // Placeholder loading state
        val pbLoadingInbox = ProgressBar(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = dp(40)
            }
        }
        val tvLoadingInbox = TextView(this).apply {
            text = "🔄 Memuat tugas & ulangan harian..."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, 0)
        }
        listContainer.addView(pbLoadingInbox)
        listContainer.addView(tvLoadingInbox)
        root.addView(sv)

        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Light_NoTitleBar_Fullscreen)
            .setView(root)
            .create()
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.parseColor("#F8FAFC")))
        btnClose.setOnClickListener { dialog.dismiss() }

        var rawOngoingList: List<Map<*, *>> = emptyList()
        var rawActiveList: List<Map<*, *>> = emptyList()
        var rawUpcomingList: List<Map<*, *>> = emptyList()
        var rawCompletedList: List<Map<*, *>> = emptyList()

        fun updateTabStyles() {
            val activeColor = Color.parseColor("#1E40AF")
            val inactiveColor = Color.parseColor("#E2E8F0")
            fun createTabBg(isActive: Boolean) = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(if (isActive) activeColor else inactiveColor)
            }
            btnTabAktif.background = createTabBg(selectedInboxTab == 0)
            btnTabAktif.setTextColor(if (selectedInboxTab == 0) Color.WHITE else Color.parseColor("#475569"))
            btnTabMendatang.background = createTabBg(selectedInboxTab == 1)
            btnTabMendatang.setTextColor(if (selectedInboxTab == 1) Color.WHITE else Color.parseColor("#475569"))
            btnTabSelesai.background = createTabBg(selectedInboxTab == 2)
            btnTabSelesai.setTextColor(if (selectedInboxTab == 2) Color.WHITE else Color.parseColor("#475569"))
        }

        fun renderCards() {
            listContainer.removeAllViews()
            val currentList = when (selectedInboxTab) {
                1 -> rawUpcomingList
                2 -> rawCompletedList
                else -> rawActiveList
            }

            if (currentList.isEmpty()) {
                val tvEmpty = TextView(this).apply {
                    text = when (selectedInboxTab) {
                        1 -> "⏳ Belum ada tugas atau ulangan terjadwal mendatang."
                        2 -> "📁 Belum ada riwayat tugas atau ulangan selesai."
                        else -> "🎉 Tidak ada tugas atau ulangan aktif saat ini.\nSemua tugas kelas sudah selesai dikerjakan!"
                    }
                    textSize = 13f
                    setTextColor(Color.parseColor("#64748B"))
                    gravity = Gravity.CENTER
                    setPadding(dp(20), dp(48), dp(20), dp(24))
                    setLineSpacing(dp(4).toFloat(), 1.0f)
                }
                listContainer.addView(tvEmpty)
                return
            }

            for (item in currentList) {
                val tipe = item["tipe"]?.toString() ?: ""
                val id = item["id"]?.toString() ?: ""
                val judul = item["judul"]?.toString() ?: "Tugas"
                val mapel = item["mapel"]?.toString() ?: ""
                val guru = item["guru"]?.toString() ?: ""
                val mode = item["mode"]?.toString() ?: ""
                val badgeColor = item["badgeColor"]?.toString() ?: "GREY"
                val actionText = item["actionText"]?.toString() ?: "Buka"
                val nilai = item["nilai"]?.toString()

                val card = CardView(this).apply {
                    radius = dp(18).toFloat()
                    cardElevation = dp(4).toFloat()
                    useCompatPadding = true
                    setCardBackgroundColor(Color.WHITE)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { bottomMargin = dp(8) }
                }

                val cardInner = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), dp(12), dp(14), dp(12))
                }

                val rowHeader = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                }

                val badgeText = if (tipe == "ULANGAN_HARIAN") "🔴 UH $mode" else "📘 TUGAS"
                val badgeBg = when (badgeColor) {
                    "RED" -> Color.parseColor("#EF4444")
                    "YELLOW" -> Color.parseColor("#F59E0B")
                    "GREEN" -> Color.parseColor("#10B981")
                    "BLUE" -> Color.parseColor("#3B82F6")
                    else -> Color.parseColor("#64748B")
                }

                val tvBadge = TextView(this).apply {
                    text = badgeText
                    textSize = 9.5f
                    setTextColor(Color.WHITE)
                    setTypeface(null, Typeface.BOLD)
                    setPadding(dp(7), dp(3), dp(7), dp(3))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(badgeBg)
                        cornerRadius = dp(6).toFloat()
                    }
                }
                rowHeader.addView(tvBadge)

                val tvSubj = TextView(this).apply {
                    text = " • $mapel"
                    textSize = 11f
                    setTextColor(Color.parseColor("#475569"))
                    setTypeface(null, Typeface.BOLD)
                }
                rowHeader.addView(tvSubj)
                cardInner.addView(rowHeader)

                val tvCardTitle = TextView(this).apply {
                    text = judul
                    textSize = 13.5f
                    setTextColor(Color.parseColor("#0F172A"))
                    setTypeface(null, Typeface.BOLD)
                    setPadding(0, dp(4), 0, dp(4))
                }
                cardInner.addView(tvCardTitle)

                val tvTeacher = TextView(this).apply {
                    text = "Guru: $guru"
                    textSize = 11f
                    setTextColor(Color.parseColor("#64748B"))
                }
                cardInner.addView(tvTeacher)

                if (nilai != null && nilai != "null") {
                    val tvScore = TextView(this).apply {
                        text = "⭐ Nilai: $nilai / 100"
                        textSize = 12f
                        setTextColor(Color.parseColor("#059669"))
                        setTypeface(null, Typeface.BOLD)
                        setPadding(0, dp(2), 0, dp(4))
                    }
                    cardInner.addView(tvScore)
                }

                val btnAction = Button(this).apply {
                    text = actionText
                    textSize = 11f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(if (badgeColor == "RED") Color.parseColor("#EF4444") else Color.parseColor("#0F172A"))
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        dp(36)
                    ).apply { topMargin = dp(8) }
                    setOnClickListener {
                        if (tipe == "ULANGAN_HARIAN") {
                            dialog.dismiss()
                            showKerjakanUlanganHarianDialog(id, mode, judul)
                        } else {
                            dialog.dismiss()
                            val matchHw = allHomeworkList.find { it.id == id }
                            if (matchHw != null) {
                                showSubmitHomeworkDialog(matchHw)
                            } else {
                                Toast.makeText(this@StudentMainActivity, "Membuka tugas: $judul", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
                cardInner.addView(btnAction)

                card.addView(cardInner)
                listContainer.addView(card)
            }
        }

        fun loadInboxData() {
            ApiClient.getClient(this).getSiswaUnifiedInbox().enqueue(object : Callback<Map<String, Any>> {
                override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                    listContainer.removeAllViews()
                    if (response.isSuccessful && response.body()?.get("success") == true) {
                        val body = response.body()
                        val data = body?.get("data") as? Map<*, *>

                        rawOngoingList = (data?.get("ongoing") as? List<Map<*, *>>) ?: emptyList()
                        rawActiveList = (data?.get("active") as? List<Map<*, *>>) ?: emptyList()
                        rawUpcomingList = (data?.get("upcoming") as? List<Map<*, *>>) ?: emptyList()
                        rawCompletedList = (data?.get("completed") as? List<Map<*, *>>) ?: emptyList()

                        btnTabAktif.text = "📝 Aktif (${rawActiveList.size})"
                        btnTabMendatang.text = "⏳ Mendatang (${rawUpcomingList.size})"
                        btnTabSelesai.text = "✅ Selesai (${rawCompletedList.size})"

                        // Render Banner Ongoing jika ada UH yang sedang berlangsung
                        if (rawOngoingList.isNotEmpty()) {
                            val ongoingItem = rawOngoingList[0]
                            val ogId = ongoingItem["id"]?.toString() ?: ""
                            val ogJudul = ongoingItem["judul"]?.toString() ?: "Ulangan Harian"
                            val ogMode = ongoingItem["mode"]?.toString() ?: "KILAT"
                            val ogMenit = ongoingItem["sisaMenit"]?.toString() ?: "10"

                            bannerOngoing.visibility = View.VISIBLE
                            bannerOngoing.removeAllViews()

                            val tvWarn = TextView(this@StudentMainActivity).apply {
                                text = "⚠️ SEDANG BERLANGSUNG (1)"
                                textSize = 11f
                                setTextColor(Color.parseColor("#B91C1C"))
                                setTypeface(null, Typeface.BOLD)
                            }
                            val tvOgTitle = TextView(this@StudentMainActivity).apply {
                                text = "🔴 $ogJudul"
                                textSize = 14f
                                setTextColor(Color.parseColor("#991B1B"))
                                setTypeface(null, Typeface.BOLD)
                            }
                            val tvOgSisa = TextView(this@StudentMainActivity).apply {
                                text = "⏱️ Sisa waktu ujian: ±$ogMenit menit | Auto-Save Aktif"
                                textSize = 11.5f
                                setTextColor(Color.parseColor("#7F1D1D"))
                                setPadding(0, dp(2), 0, dp(6))
                            }
                            val btnLanjut = Button(this@StudentMainActivity).apply {
                                text = "🚀 LANJUTKAN MENGERJAKAN"
                                textSize = 11f
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#DC2626"))
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    dp(38)
                                )
                                setOnClickListener {
                                    dialog.dismiss()
                                    showKerjakanUlanganHarianDialog(ogId, ogMode, ogJudul)
                                }
                            }
                            bannerOngoing.addView(tvWarn)
                            bannerOngoing.addView(tvOgTitle)
                            bannerOngoing.addView(tvOgSisa)
                            bannerOngoing.addView(btnLanjut)
                        } else {
                            bannerOngoing.visibility = View.GONE
                        }

                        updateTabStyles()
                        renderCards()
                    } else {
                        btnTabAktif.text = "📝 Aktif (0)"
                        btnTabMendatang.text = "⏳ Mendatang (0)"
                        btnTabSelesai.text = "✅ Selesai (0)"
                        bannerOngoing.visibility = View.GONE
                        updateTabStyles()
                        renderCards()
                    }
                }

                override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                    listContainer.removeAllViews()
                    btnTabAktif.text = "📝 Aktif (0)"
                    btnTabMendatang.text = "⏳ Mendatang (0)"
                    btnTabSelesai.text = "✅ Selesai (0)"
                    bannerOngoing.visibility = View.GONE
                    val tvError = TextView(this@StudentMainActivity).apply {
                        text = "Tidak dapat terhubung ke server inbox tugas.\nKetuk di sini untuk mencoba lagi."
                        textSize = 12.5f
                        setTextColor(Color.parseColor("#EF4444"))
                        gravity = Gravity.CENTER
                        setPadding(0, dp(40), 0, 0)
                        isClickable = true
                        setOnClickListener {
                            listContainer.removeAllViews()
                            listContainer.addView(pbLoadingInbox)
                            listContainer.addView(tvLoadingInbox)
                            loadInboxData()
                        }
                    }
                    listContainer.addView(tvError)
                }
            })
        }

        btnTabAktif.setOnClickListener { selectedInboxTab = 0; updateTabStyles(); renderCards() }
        btnTabMendatang.setOnClickListener { selectedInboxTab = 1; updateTabStyles(); renderCards() }
        btnTabSelesai.setOnClickListener { selectedInboxTab = 2; updateTabStyles(); renderCards() }

        updateTabStyles()
        loadInboxData()
        dialog.show()
    }

    private fun showKerjakanUlanganHarianDialog(uhId: String, mode: String, judul: String) {
        if (mode == "CBT_MINI") {
            val inputToken = EditText(this).apply {
                hint = "Masukkan 6 Karakter Token Ujian"
                textSize = 14f
                gravity = Gravity.CENTER
                filters = arrayOf(android.text.InputFilter.LengthFilter(6), android.text.InputFilter.AllCaps())
            }
            AlertDialog.Builder(this)
                .setTitle("🎯 Token Ujian CBT Mini")
                .setMessage("Ujian ini memerlukan Token Pengawas dari guru yang diperbarui berkala:")
                .setView(inputToken)
                .setPositiveButton("Mulai") { _, _ ->
                    val t = inputToken.text.toString().trim()
                    if (t.isEmpty()) {
                        Toast.makeText(this, "Token wajib diisi!", Toast.LENGTH_SHORT).show()
                    } else {
                        launchUhExamViewer(uhId, mode, judul, t)
                    }
                }
                .setNegativeButton("Batal", null)
                .show()
        } else {
            launchUhExamViewer(uhId, mode, judul, null)
        }
    }

    private fun launchUhExamViewer(uhId: String, mode: String, judul: String, token: String?) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val reqBody = if (!token.isNullOrEmpty()) mapOf("token" to token) else emptyMap<String, String>()

        Toast.makeText(this, "Menyiapkan lembar soal...", Toast.LENGTH_SHORT).show()

        ApiClient.getClient(this).startUhSiswa(uhId, reqBody).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                if (!response.isSuccessful || response.body()?.get("success") != true) {
                    val msg = response.body()?.get("message")?.toString() ?: "Gagal memulai ulangan"
                    Toast.makeText(this@StudentMainActivity, msg, Toast.LENGTH_LONG).show()
                    return
                }

                val data = response.body()?.get("data") as? Map<*, *>
                val uh = data?.get("uh") as? Map<*, *>
                val submission = data?.get("submission") as? Map<*, *>
                val rawSoalList = data?.get("soalList") as? List<Map<*, *>> ?: emptyList()

                val savedAnswers = (submission?.get("savedAnswers") as? Map<String, String>)?.toMutableMap() ?: mutableMapOf()
                val savedRaguRagu = ((submission?.get("savedRaguRagu") as? List<*>)?.map { it.toString() })?.toMutableList() ?: mutableListOf()

                var currentQuestionIndex = 0
                var sisaDetik = (uh?.get("sisaDetik") as? Number)?.toInt() ?: (15 * 60)

                val root = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.parseColor("#F8FAFC"))
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                }

                // Top Header: Judul & Timer Countdown
                val topHeader = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(16), dp(12), dp(16), dp(12))
                    background = android.graphics.drawable.GradientDrawable(
                        android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                        intArrayOf(Color.parseColor("#0A2E5C"), Color.parseColor("#1565C0"), Color.parseColor("#1E88E5"))
                    )
                }
                val tvExamTitle = TextView(this@StudentMainActivity).apply {
                    text = "📝 $judul"
                    textSize = 13.5f
                    setTextColor(Color.WHITE)
                    setTypeface(null, Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                val tvTimer = TextView(this@StudentMainActivity).apply {
                    text = "⏱️ 15:00"
                    textSize = 14f
                    setTextColor(Color.parseColor("#FBBF24"))
                    setTypeface(null, Typeface.BOLD)
                }
                topHeader.addView(tvExamTitle)
                topHeader.addView(tvTimer)
                root.addView(topHeader)

                // Subheader Navigator Info
                val subHeader = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(16), dp(8), dp(16), dp(8))
                    setBackgroundColor(Color.parseColor("#E2E8F0"))
                }
                val tvSoalNumber = TextView(this@StudentMainActivity).apply {
                    text = "SOAL 1 / ${rawSoalList.size}"
                    textSize = 12f
                    setTextColor(Color.parseColor("#1E293B"))
                    setTypeface(null, Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                val btnRaguRagu = Button(this@StudentMainActivity).apply {
                    text = "🔖 Ragu-Ragu"
                    textSize = 10f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.parseColor("#D97706"))
                    layoutParams = LinearLayout.LayoutParams(dp(100), dp(32))
                }
                subHeader.addView(tvSoalNumber)
                subHeader.addView(btnRaguRagu)
                root.addView(subHeader)

                // Scroll Content Soal
                val svSoal = ScrollView(this@StudentMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
                }
                val contentSoal = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(16), dp(16), dp(16), dp(16))
                }
                val tvQuestionText = TextView(this@StudentMainActivity).apply {
                    text = "Pertanyaan soal..."
                    textSize = 14.5f
                    setTextColor(Color.parseColor("#0F172A"))
                    setPadding(0, 0, 0, dp(14))
                }
                contentSoal.addView(tvQuestionText)

                val layoutAttachments = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                }
                contentSoal.addView(layoutAttachments)

                val rgOptions = RadioGroup(this@StudentMainActivity).apply {
                    orientation = RadioGroup.VERTICAL
                }
                contentSoal.addView(rgOptions)
                svSoal.addView(contentSoal)
                root.addView(svSoal)

                // Horizontal Navigator Bar
                val hsvNav = HorizontalScrollView(this@StudentMainActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46))
                    setBackgroundColor(Color.parseColor("#F1F5F9"))
                }
                val navButtonsContainer = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(dp(8), dp(4), dp(8), dp(4))
                }
                hsvNav.addView(navButtonsContainer)
                root.addView(hsvNav)

                // Footer Bar: Auto-save status & Nav / Submit
                val footerBar = LinearLayout(this@StudentMainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(16), dp(8), dp(16), dp(8))
                    setBackgroundColor(Color.WHITE)
                }
                val tvAutoSave = TextView(this@StudentMainActivity).apply {
                    text = "💾 Tersimpan otomatis"
                    textSize = 10f
                    setTextColor(Color.parseColor("#10B981"))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
                val btnPrev = Button(this@StudentMainActivity).apply { text = "←"; layoutParams = LinearLayout.LayoutParams(dp(44), dp(38)).apply { marginEnd = dp(4) } }
                val btnNext = Button(this@StudentMainActivity).apply { text = "→"; layoutParams = LinearLayout.LayoutParams(dp(44), dp(38)).apply { marginEnd = dp(4) } }
                val btnSubmitFinal = Button(this@StudentMainActivity).apply {
                    text = "Kumpulkan"; textSize = 10.5f; setTextColor(Color.WHITE); setBackgroundColor(Color.parseColor("#059669"))
                    layoutParams = LinearLayout.LayoutParams(dp(100), dp(38))
                }
                footerBar.addView(tvAutoSave)
                footerBar.addView(btnPrev)
                footerBar.addView(btnNext)
                footerBar.addView(btnSubmitFinal)
                root.addView(footerBar)

                val examDialog = AlertDialog.Builder(this@StudentMainActivity, android.R.style.Theme_Light_NoTitleBar_Fullscreen)
                    .setView(root)
                    .setCancelable(false)
                    .create()
                examDialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.parseColor("#F8FAFC")))

                var studentAudioPlayer: MediaPlayer? = null

                fun doAutoSave() {
                    val body = mapOf(
                        "jawabanJson" to savedAnswers,
                        "raguRaguJson" to savedRaguRagu
                    )
                    ApiClient.getClient(this@StudentMainActivity).autoSaveJawabanUhSiswa(uhId, body).enqueue(object : Callback<Map<String, Any>> {
                        override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                            tvAutoSave.text = "💾 Tersimpan ${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())}"
                        }
                        override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {}
                    })
                }

                fun renderQuestion(idx: Int) {
                    if (idx < 0 || idx >= rawSoalList.size) return
                    currentQuestionIndex = idx
                    val q = rawSoalList[idx]
                    val qId = q["id"]?.toString() ?: "soal_$idx"
                    val content = q["content"]?.toString() ?: ""
                    val opts = q["options"] as? List<*> ?: emptyList<Any>()

                    tvSoalNumber.text = "SOAL ${idx + 1} / ${rawSoalList.size}"
                    tvQuestionText.text = content

                    studentAudioPlayer?.stop()
                    studentAudioPlayer?.release()
                    studentAudioPlayer = null
                    layoutAttachments.removeAllViews()

                    val imgUrl = q["imageUrl"]?.toString()?.trim()
                    if (!imgUrl.isNullOrEmpty()) {
                        val serverBase = ApiClient.getBaseServerUrl(this@StudentMainActivity).trimEnd('/')
                        val fullImg = if (imgUrl.startsWith("http")) imgUrl else "$serverBase/" + imgUrl.trimStart('/')
                        val ivQuestion = ImageView(this@StudentMainActivity).apply {
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(200)).apply {
                                bottomMargin = dp(10)
                            }
                            scaleType = ImageView.ScaleType.FIT_CENTER
                            adjustViewBounds = true
                        }
                        Thread {
                            try {
                                val conn = java.net.URL(fullImg).openConnection()
                                conn.connectTimeout = 4000
                                val bmp = android.graphics.BitmapFactory.decodeStream(conn.getInputStream())
                                runOnUiThread { if (bmp != null) ivQuestion.setImageBitmap(bmp) }
                            } catch (e: Exception) {}
                        }.start()
                        layoutAttachments.addView(ivQuestion)
                    }

                    val audUrl = q["audioUrl"]?.toString()?.trim()
                    if (!audUrl.isNullOrEmpty()) {
                        val serverBase = ApiClient.getBaseServerUrl(this@StudentMainActivity).trimEnd('/')
                        val fullAud = if (audUrl.startsWith("http")) audUrl else "$serverBase/" + audUrl.trimStart('/')
                        val btnAudio = Button(this@StudentMainActivity).apply {
                            text = "🎧 Putar Audio Listening"
                            textSize = 12f
                            setTextColor(Color.WHITE)
                            setBackgroundColor(Color.parseColor("#7C3AED"))
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)).apply {
                                bottomMargin = dp(10)
                            }
                            setOnClickListener {
                                val p = studentAudioPlayer
                                if (p != null && p.isPlaying) {
                                    p.stop()
                                    p.release()
                                    studentAudioPlayer = null
                                    text = "🎧 Putar Audio Listening"
                                } else {
                                    try {
                                        text = "⏳ Memutar Audio..."
                                        val newPlayer = MediaPlayer()
                                        newPlayer.setDataSource(fullAud)
                                        newPlayer.setOnPreparedListener { mp ->
                                            mp.start()
                                            text = "⏹ Stop Audio"
                                        }
                                        newPlayer.setOnCompletionListener {
                                            text = "🎧 Putar Audio Listening"
                                        }
                                        newPlayer.prepareAsync()
                                        studentAudioPlayer = newPlayer
                                    } catch (e: Exception) {
                                        text = "🎧 Putar Audio Listening"
                                        Toast.makeText(this@StudentMainActivity, "Gagal memutar audio listening", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        }
                        layoutAttachments.addView(btnAudio)
                    }

                    val isRagu = savedRaguRagu.contains(qId)
                    btnRaguRagu.setBackgroundColor(if (isRagu) Color.parseColor("#F59E0B") else Color.parseColor("#64748B"))
                    btnRaguRagu.text = if (isRagu) "✓ Ragu-Ragu" else "🔖 Tandai Ragu"

                    rgOptions.removeAllViews()
                    opts.forEachIndexed { optIdx, optVal ->
                        val optStr = optVal.toString()
                        val rb = RadioButton(this@StudentMainActivity).apply {
                            text = optStr
                            textSize = 13f
                            setPadding(dp(8), dp(8), dp(8), dp(8))
                            val key = if (optStr.startsWith("A")) "A" else if (optStr.startsWith("B")) "B" else if (optStr.startsWith("C")) "C" else "D"
                            isChecked = (savedAnswers[qId] == key)
                            setOnCheckedChangeListener { _, checked ->
                                if (checked) {
                                    savedAnswers[qId] = key
                                    doAutoSave()
                                }
                            }
                        }
                        rgOptions.addView(rb)
                    }

                    btnPrev.isEnabled = (idx > 0)
                    btnNext.isEnabled = (idx < rawSoalList.size - 1)
                }

                btnRaguRagu.setOnClickListener {
                    val q = rawSoalList[currentQuestionIndex]
                    val qId = q["id"]?.toString() ?: "soal_$currentQuestionIndex"
                    if (savedRaguRagu.contains(qId)) {
                        savedRaguRagu.remove(qId)
                    } else {
                        savedRaguRagu.add(qId)
                    }
                    renderQuestion(currentQuestionIndex)
                    doAutoSave()
                }

                btnPrev.setOnClickListener { if (currentQuestionIndex > 0) renderQuestion(currentQuestionIndex - 1) }
                btnNext.setOnClickListener { if (currentQuestionIndex < rawSoalList.size - 1) renderQuestion(currentQuestionIndex + 1) }

                // Timer ticker
                val timerHandler = android.os.Handler(android.os.Looper.getMainLooper())
                val timerRunnable = object : Runnable {
                    override fun run() {
                        if (sisaDetik > 0) {
                            sisaDetik--
                            val m = sisaDetik / 60
                            val s = sisaDetik % 60
                            tvTimer.text = String.format("⏱️ %02d:%02d", m, s)
                            if (sisaDetik % 10 == 0) doAutoSave()
                            timerHandler.postDelayed(this, 1000)
                        } else {
                            tvTimer.text = "⏱️ Waktu Habis!"
                            Toast.makeText(this@StudentMainActivity, "Waktu ulangan telah berakhir! Mengirim jawaban otomatis...", Toast.LENGTH_LONG).show()
                            doSubmitFinal(uhId, savedAnswers, savedRaguRagu, examDialog)
                        }
                    }
                }
                timerHandler.postDelayed(timerRunnable, 1000)

                examDialog.setOnDismissListener {
                    timerHandler.removeCallbacks(timerRunnable)
                    studentAudioPlayer?.stop()
                    studentAudioPlayer?.release()
                    studentAudioPlayer = null
                }

                btnSubmitFinal.setOnClickListener {
                    val dijawab = savedAnswers.size
                    val total = rawSoalList.size
                    val ragu = savedRaguRagu.size
                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("⚠️ Konfirmasi Submit Ujian")
                        .setMessage("Apakah Anda yakin ingin menyelesaikan ulangan ini?\n\n• Terjawab: $dijawab dari $total soal\n• Ragu-ragu: $ragu soal\n\nSetelah dikumpulkan, jawaban tidak dapat diubah lagi.")
                        .setPositiveButton("Ya, Kumpulkan") { _, _ ->
                            timerHandler.removeCallbacks(timerRunnable)
                            doSubmitFinal(uhId, savedAnswers, savedRaguRagu, examDialog)
                        }
                        .setNegativeButton("Cek Lagi", null)
                        .show()
                }

                // Populate nav number buttons
                navButtonsContainer.removeAllViews()
                rawSoalList.forEachIndexed { i, _ ->
                    val btnNum = Button(this@StudentMainActivity).apply {
                        text = "${i + 1}"
                        textSize = 10f
                        layoutParams = LinearLayout.LayoutParams(dp(36), dp(34)).apply { marginEnd = dp(3) }
                        setOnClickListener { renderQuestion(i) }
                    }
                    navButtonsContainer.addView(btnNum)
                }

                renderQuestion(0)
                examDialog.show()
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                Toast.makeText(this@StudentMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun doSubmitFinal(uhId: String, answers: Map<String, String>, ragu: List<String>, examDialog: AlertDialog) {
        val body = mapOf(
            "jawabanJson" to answers,
            "raguRaguJson" to ragu
        )
        ApiClient.getClient(this).submitFinalUhSiswa(uhId, body).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                examDialog.dismiss()
                if (response.isSuccessful && response.body()?.get("success") == true) {
                    val data = response.body()?.get("data") as? Map<*, *>
                    val nilai = data?.get("nilai")?.toString() ?: "0"
                    val benar = data?.get("totalBenar")?.toString() ?: "0"
                    val salah = data?.get("totalSalah")?.toString() ?: "0"
                    val isTuntas = data?.get("isTuntas") == true

                    AlertDialog.Builder(this@StudentMainActivity)
                        .setTitle("🎉 Hasil Ulangan Harian")
                        .setMessage("Nilai Anda:\n⭐ $nilai / 100\n\n• Benar: $benar soal\n• Salah: $salah soal\n• Status: ${if (isTuntas) "✅ TUNTAS KKM" else "⚠️ PERLU REMEDIAL"}\n\nPembahasan kunci jawaban telah direkam dan dapat dilihat di menu riwayat.")
                        .setPositiveButton("Lihat Inbox", { _, _ -> showUnifiedInboxDialog() })
                        .show()
                } else {
                    Toast.makeText(this@StudentMainActivity, "Jawaban tersimpan di server.", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                examDialog.dismiss()
                Toast.makeText(this@StudentMainActivity, "Jawaban terkirim ke server sekolah.", Toast.LENGTH_SHORT).show()
            }
        })
    }
}
