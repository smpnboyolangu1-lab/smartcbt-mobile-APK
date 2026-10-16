package com.school.smartcbt.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.R
import com.school.smartcbt.ScannerActivity
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.utils.QrCodeHelper
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class ExitPassActivity : AppCompatActivity() {

    private lateinit var sessionManager: SessionManager

    // UI Elements - Forms
    private lateinit var cardFormApply: CardView
    private lateinit var rgLeaveType: RadioGroup
    private lateinit var rbSakitPulang: RadioButton
    private lateinit var rbIzinMendesak: RadioButton
    private lateinit var rbDispensasi: RadioButton
    private lateinit var tvLabelEventName: TextView
    private lateinit var etEventName: EditText
    private lateinit var etReason: EditText
    private lateinit var etPickupPerson: EditText
    private lateinit var btnSubmitLeave: Button

    // UI Elements - Active Status
    private lateinit var cardActiveStatus: CardView
    private lateinit var layoutStatusBanner: LinearLayout
    private lateinit var tvStatusIcon: TextView
    private lateinit var tvStatusTitle: TextView
    private lateinit var tvStatusSubtitle: TextView
    private lateinit var tvActiveLeaveType: TextView
    private lateinit var tvActiveReason: TextView
    private lateinit var tvActivePickup: TextView
    private lateinit var tvCounselorNotes: TextView
    private lateinit var btnScanBkStation: Button
    private lateinit var btnCheckApprovalStatus: Button
    private var btnHistoryExitPass: Button? = null
    private var btnHistoryExitPassForm: Button? = null
    private var btnReapplyLeavePass: Button? = null
    private var btnReapplyFromActive: Button? = null
    private var qrRotationHandler: Handler? = null
    private var qrRotationRunnable: Runnable? = null

    // UI Elements - Digital Exit Pass
    private lateinit var cardDigitalExitPass: CardView
    private lateinit var tvExitPassLiveClock: TextView
    private lateinit var layoutCountdownTimer: LinearLayout
    private lateinit var tvExitPassCountdown: TextView
    private lateinit var ivExitPassStudentPhoto: ImageView
    private lateinit var tvExitPassStudentName: TextView
    private lateinit var tvExitPassStudentClass: TextView
    private lateinit var tvExitPassType: TextView
    private lateinit var tvExitPassReason: TextView
    private lateinit var tvExitPassPickup: TextView
    private lateinit var tvExitPassStation: TextView
    private lateinit var tvExitPassCheckoutTime: TextView
    private lateinit var ivExitPassQrBitmap: ImageView
    private lateinit var tvExitPassQrPayload: TextView
    private var tvExitPassSerialNo: TextView? = null
    private var layoutSatpamCheckoutStamp: LinearLayout? = null
    private var tvSatpamCheckoutStampTitle: TextView? = null
    private var tvSatpamCheckoutStampSub: TextView? = null

    private var activeLeaveId: String? = null
    private var isClockRunning = false
    private var targetExpiryMillis: Long = 0
    private val mainHandler = Handler(Looper.getMainLooper())
    private val imageExecutor = Executors.newFixedThreadPool(2)
    private val photoCache = ConcurrentHashMap<String, Bitmap>()

    companion object {
        private const val REQUEST_CODE_SCAN_BK = 3012
    }

    private var isPendingPolling = false
    private val pendingPollRunnable = object : Runnable {
        override fun run() {
            if (!isDestroyed && !isFinishing && isPendingPolling) {
                fetchActiveLeave(isUserInitiated = false)
                mainHandler.postDelayed(this, 3500)
            }
        }
    }

    private fun startPendingAutoPoll() {
        if (!isPendingPolling) {
            isPendingPolling = true
            mainHandler.removeCallbacks(pendingPollRunnable)
            mainHandler.postDelayed(pendingPollRunnable, 3500)
        }
    }

    private fun stopPendingAutoPoll() {
        isPendingPolling = false
        mainHandler.removeCallbacks(pendingPollRunnable)
    }

    private val liveClockRunnable = object : Runnable {
        override fun run() {
            if (isClockRunning) {
                val sdf = SimpleDateFormat("HH:mm:ss 'WIB'", Locale("id", "ID"))
                tvExitPassLiveClock.text = sdf.format(Date())

                // Update countdown
                if (targetExpiryMillis > 0) {
                    val diff = targetExpiryMillis - System.currentTimeMillis()
                    if (diff > 0) {
                        val min = (diff / 1000) / 60
                        val sec = (diff / 1000) % 60
                        tvExitPassCountdown.text = String.format("%02d:%02d Menit Tersisa", min, sec)
                        layoutCountdownTimer.setBackgroundColor(Color.parseColor("#047857"))
                    } else {
                        tvExitPassCountdown.text = "⏳ TIKET TELAH KADALUARSA"
                        layoutCountdownTimer.setBackgroundColor(Color.parseColor("#DC2626"))
                        ivExitPassQrBitmap.visibility = View.GONE
                        tvExitPassQrPayload.text = "SUDAH DIGUNAKAN / KADALUARSA"
                        layoutSatpamCheckoutStamp?.visibility = View.VISIBLE
                        tvSatpamCheckoutStampTitle?.text = "⏳ TIKET TELAH KADALUARSA"
                        tvSatpamCheckoutStampSub?.text = "Batas waktu penggunaan tiket telah berakhir. QR tidak berlaku."
                    }
                }

                mainHandler.postDelayed(this, 1000)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_exit_pass)

        sessionManager = SessionManager(this)
        initViews()
        setupListeners()
        fetchActiveLeave()
    }

    private fun initViews() {
        findViewById<ImageButton>(R.id.btnBackExitPass).setOnClickListener { finish() }
        findViewById<ImageButton>(R.id.btnRefreshExitPass).setOnClickListener {
            fetchActiveLeave(isUserInitiated = true)
        }
        findViewById<Button>(R.id.btnUpdateExitPass).setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        // Form
        cardFormApply = findViewById(R.id.cardFormApply)
        rgLeaveType = findViewById(R.id.rgLeaveType)
        rbSakitPulang = findViewById(R.id.rbSakitPulang)
        rbIzinMendesak = findViewById(R.id.rbIzinMendesak)
        rbDispensasi = findViewById(R.id.rbDispensasi)
        tvLabelEventName = findViewById(R.id.tvLabelEventName)
        etEventName = findViewById(R.id.etEventName)
        etReason = findViewById(R.id.etReason)
        etPickupPerson = findViewById(R.id.etPickupPerson)
        btnSubmitLeave = findViewById(R.id.btnSubmitLeave)
        btnHistoryExitPassForm = findViewById(R.id.btnHistoryExitPassForm)
        btnReapplyLeavePass = findViewById(R.id.btnReapplyLeavePass)
        btnReapplyFromActive = btnReapplyLeavePass

        // Status
        cardActiveStatus = findViewById(R.id.cardActiveStatus)
        layoutStatusBanner = findViewById(R.id.layoutStatusBanner)
        tvStatusIcon = findViewById(R.id.tvStatusIcon)
        tvStatusTitle = findViewById(R.id.tvStatusTitle)
        tvStatusSubtitle = findViewById(R.id.tvStatusSubtitle)
        tvActiveLeaveType = findViewById(R.id.tvActiveLeaveType)
        tvActiveReason = findViewById(R.id.tvActiveReason)
        tvActivePickup = findViewById(R.id.tvActivePickup)
        tvCounselorNotes = findViewById(R.id.tvCounselorNotes)
        btnScanBkStation = findViewById(R.id.btnScanBkStation)
        btnScanBkStation.visibility = View.GONE
        btnCheckApprovalStatus = findViewById(R.id.btnCheckApprovalStatus)
        btnHistoryExitPass = findViewById(R.id.btnHistoryExitPass)

        // Digital Exit Pass (#10B981)
        cardDigitalExitPass = findViewById(R.id.cardDigitalExitPass)
        tvExitPassLiveClock = findViewById(R.id.tvExitPassLiveClock)
        layoutCountdownTimer = findViewById(R.id.layoutCountdownTimer)
        tvExitPassCountdown = findViewById(R.id.tvExitPassCountdown)
        ivExitPassStudentPhoto = findViewById(R.id.ivExitPassStudentPhoto)
        tvExitPassStudentName = findViewById(R.id.tvExitPassStudentName)
        tvExitPassStudentClass = findViewById(R.id.tvExitPassStudentClass)
        tvExitPassType = findViewById(R.id.tvExitPassType)
        tvExitPassReason = findViewById(R.id.tvExitPassReason)
        tvExitPassPickup = findViewById(R.id.tvExitPassPickup)
        tvExitPassStation = findViewById(R.id.tvExitPassStation)
        tvExitPassCheckoutTime = findViewById(R.id.tvExitPassCheckoutTime)
        ivExitPassQrBitmap = findViewById(R.id.ivExitPassQrBitmap)
        tvExitPassQrPayload = findViewById(R.id.tvExitPassQrPayload)
        tvExitPassSerialNo = findViewById(R.id.tvExitPassSerialNo)
        layoutSatpamCheckoutStamp = findViewById(R.id.layoutSatpamCheckoutStamp)
        tvSatpamCheckoutStampTitle = findViewById(R.id.tvSatpamCheckoutStampTitle)
        tvSatpamCheckoutStampSub = findViewById(R.id.tvSatpamCheckoutStampSub)
    }

    private fun setupListeners() {
        rgLeaveType.setOnCheckedChangeListener { _, checkedId ->
            if (checkedId == R.id.rbDispensasi) {
                tvLabelEventName.visibility = View.VISIBLE
                etEventName.visibility = View.VISIBLE
            } else {
                tvLabelEventName.visibility = View.GONE
                etEventName.visibility = View.GONE
            }
        }

        btnSubmitLeave.setOnClickListener {
            submitLeaveApplication()
        }

        btnCheckApprovalStatus.setOnClickListener {
            fetchActiveLeave(isUserInitiated = true)
        }

        btnHistoryExitPass?.setOnClickListener {
            showLeaveHistoryDialog()
        }

        btnReapplyLeavePass?.setOnClickListener { showFormOnly() }
        btnReapplyFromActive?.setOnClickListener { showFormOnly() }
        btnHistoryExitPassForm?.setOnClickListener {
            showLeaveHistoryDialog()
        }

        btnScanBkStation.setOnClickListener {
            launchBkQrScanner()
        }
    }

    private fun launchBkQrScanner() {
        try {
            val intent = Intent(this, ScannerActivity::class.java).apply {
                putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_BK_DYNAMIC_QR)
                putExtra("GATEPASS_ID", activeLeaveId)
            }
            startActivityForResult(intent, REQUEST_CODE_SCAN_BK)
        } catch (e: Exception) {
            showManualScanDialog()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_SCAN_BK && resultCode == Activity.RESULT_OK) {
            val token = data?.getStringExtra(ScannerActivity.EXTRA_SCANNED_TOKEN)
                ?: data?.getStringExtra("SCANNED_TOKEN")
            if (!token.isNullOrEmpty()) {
                processCheckout(token)
            }
        }
    }

    private fun submitLeaveApplication() {
        val leaveType = when {
            rbSakitPulang.isChecked -> "SAKIT_PULANG"
            rbIzinMendesak.isChecked -> "IZIN_PULANG_MENDESAK"
            rbDispensasi.isChecked -> "DISPENSASI_LOMBA"
            else -> "SAKIT_PULANG"
        }

        val category = when (leaveType) {
            "SAKIT_PULANG" -> "sick"
            "DISPENSASI_LOMBA" -> "dispensation"
            else -> "urgent_family"
        }

        val reason = etReason.text.toString().trim()
        if (reason.length < 5) {
            Toast.makeText(this, "Harap isi alasan permohonan pulang minimal 5 karakter.", Toast.LENGTH_SHORT).show()
            return
        }

        val eventName = if (rbDispensasi.isChecked) etEventName.text.toString().trim().ifEmpty { null } else null
        val pickupPerson = etPickupPerson.text.toString().trim().ifEmpty { "Mandiri" }

        btnSubmitLeave.isEnabled = false
        btnSubmitLeave.text = "Mengirim Permohonan..."

        val req = GatepassApplyRequest(
            leaveCategory = category,
            reason = reason,
            pickupBy = pickupPerson,
            eventName = eventName
        )

        ApiClient.getClient(this).createGatepassRequest(req).enqueue(object : Callback<StudentLeaveResponse> {
            override fun onResponse(call: Call<StudentLeaveResponse>, response: Response<StudentLeaveResponse>) {
                btnSubmitLeave.isEnabled = true
                btnSubmitLeave.text = "📤 Ajukan Gatepass ke Guru BK"

                val body = response.body()
                if (response.isSuccessful && body?.success == true) {
                    Toast.makeText(this@ExitPassActivity, "Permohonan Gatepass terkirim! Silakan menuju Ruang BK.", Toast.LENGTH_LONG).show()
                    fetchActiveLeave()
                } else {
                    Toast.makeText(this@ExitPassActivity, body?.message ?: "Gagal mengajukan gatepass", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<StudentLeaveResponse>, t: Throwable) {
                btnSubmitLeave.isEnabled = true
                btnSubmitLeave.text = "📤 Ajukan Gatepass ke Guru BK"
                Toast.makeText(this@ExitPassActivity, "Koneksi terganggu: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun fetchActiveLeave(isUserInitiated: Boolean = false) {
        if (isUserInitiated) {
            Toast.makeText(this, "Memeriksa status persetujuan Guru BK...", Toast.LENGTH_SHORT).show()
        }
        ApiClient.getClient(this).getActiveGatepass().enqueue(object : Callback<StudentLeaveActiveResponse> {
            override fun onResponse(call: Call<StudentLeaveActiveResponse>, response: Response<StudentLeaveActiveResponse>) {
                val body = response.body()
                if (response.isSuccessful && body?.success == true && body.hasActiveLeave && body.data != null) {
                    val leave = body.data
                    activeLeaveId = leave.id
                    renderLeaveState(body, leave)
                    if (isUserInitiated) {
                        if (body.isCheckedOut) {
                            Toast.makeText(this@ExitPassActivity, "✅ Disetujui Guru BK! Tiket Gatepass Resmi Satpam Aktif.", Toast.LENGTH_LONG).show()
                        } else if (leave.status.contains("REJECT", ignoreCase = true)) {
                            AlertDialog.Builder(this@ExitPassActivity)
                                .setTitle("❌ Permohonan Izin Ditolak")
                                .setMessage("Permohonan izin Anda tidak disetujui Guru BK.\n\nCatatan BK: ${leave.counselorNotes ?: "Silakan temui Guru BK di Ruang Konseling."}")
                                .setPositiveButton("Tutup", null)
                                .show()
                        } else {
                            AlertDialog.Builder(this@ExitPassActivity)
                                .setTitle("⏳ Menunggu Persetujuan Guru BK")
                                .setMessage("Permohonan izin Anda telah diterima dan sedang menunggu persetujuan Guru BK. Begitu disetujui, Tiket Gatepass Resmi Satpam (Hijau) akan otomatis muncul.")
                                .setPositiveButton("Mengerti", null)
                                .show()
                        }
                    }
                } else {
                    showFormOnly()
                    if (isUserInitiated) {
                        Toast.makeText(this@ExitPassActivity, "Tidak ada permohonan izin aktif saat ini.", Toast.LENGTH_SHORT).show()
                    }
                }
            }

            override fun onFailure(call: Call<StudentLeaveActiveResponse>, t: Throwable) {
                if (isUserInitiated) {
                    Toast.makeText(this@ExitPassActivity, "Koneksi terganggu: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun showFormOnly() {
        cardFormApply.visibility = View.VISIBLE
        cardActiveStatus.visibility = View.GONE
        cardDigitalExitPass.visibility = View.GONE
        isClockRunning = false
        mainHandler.removeCallbacks(liveClockRunnable)
    }

    private fun renderLeaveState(res: StudentLeaveActiveResponse, leave: StudentLeaveData) {
        val isApprovedOrActive = res.isCheckedOut || 
            leave.status.equals("ACTIVE_APPROVED", ignoreCase = true) ||
            leave.status.equals("APPROVED", ignoreCase = true) ||
            leave.status.equals("approved_by_bk", ignoreCase = true) ||
            leave.status.equals("WAITING_BK_SCAN", ignoreCase = true) ||
            leave.status.equals("checked_out", ignoreCase = true) ||
            leave.status.equals("COMPLETED", ignoreCase = true)

        if (isApprovedOrActive) {
            stopPendingAutoPoll()

            // State 3: TIKET HIJAU DIGITAL GATEPASS (#10B981) - QR CODE LANGSUNG MUNCUL TANPA SCAN MEJA BK
            cardFormApply.visibility = View.GONE
            cardActiveStatus.visibility = View.GONE
            cardDigitalExitPass.visibility = View.VISIBLE

            tvExitPassStudentName.text = leave.student?.name ?: sessionManager.getName()
            tvExitPassStudentClass.text = "Kelas ${leave.student?.className ?: sessionManager.getClassName()} • NISN: ${leave.student?.nisn ?: sessionManager.getNisn()}"

            val typeBadge = leave.categoryLabel ?: when (leave.leaveType) {
                "SAKIT_PULANG" -> "Sakit Pulang (Perlu Istirahat)"
                "IZIN_PULANG_MENDESAK" -> "Izin Pulang Mendesak"
                "DISPENSASI_LOMBA" -> "Dispensasi Lomba / Resmi"
                else -> leave.leaveType ?: "Izin Pulang Resmi BK"
            }
            tvExitPassType.text = typeBadge
            tvExitPassReason.text = leave.reason
            tvExitPassPickup.text = leave.pickupBy ?: leave.pickupPerson ?: "Mandiri"
            tvExitPassStation.text = leave.stationName ?: "Ruang Konseling BK"

            val outTimeStr = try {
                if (!leave.checkedOutAt.isNullOrEmpty()) {
                    val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                    val d = isoFormat.parse(leave.checkedOutAt)
                    SimpleDateFormat("HH:mm 'WIB'", Locale("id", "ID")).format(d ?: Date())
                } else {
                    SimpleDateFormat("HH:mm 'WIB'", Locale("id", "ID")).format(Date())
                }
            } catch (e: Exception) {
                "10:14 WIB"
            }
            tvExitPassCheckoutTime.text = outTimeStr

            val passSerial = "PASS-${leave.id.take(8).uppercase()}"
            tvExitPassSerialNo?.text = passSerial

            val isAlreadyCompleted = leave.status.equals("COMPLETED", ignoreCase = true)
            if (isAlreadyCompleted) {
                layoutSatpamCheckoutStamp?.visibility = View.VISIBLE
                tvSatpamCheckoutStampTitle?.text = "✓ SUDAH DIGUNAKAN (CHECKOUT SELESAI)"
                tvSatpamCheckoutStampSub?.text = "Diverifikasi Resmi Petugas Satpam Pos Gerbang Utama"
                ivExitPassQrBitmap.visibility = View.GONE
                tvExitPassQrPayload.text = "SUDAH DIGUNAKAN / KADALUARSA"
            } else {
                layoutSatpamCheckoutStamp?.visibility = View.GONE
                ivExitPassQrBitmap.visibility = View.VISIBLE

                // Token & QR Code Payload
                val qrPayload = leave.qrVerificationPayload ?: "SMARTCBT-GATEPASS:${leave.singleUseCheckoutToken ?: leave.id}:${leave.id}"
                tvExitPassQrPayload.text = "*${leave.singleUseCheckoutToken ?: leave.id.take(8).uppercase()}*"

                // Generate Single-Use Checkout QR Code Bitmap
                val qrBitmap = QrCodeHelper.generateQrCodeBitmap(qrPayload, 450)
                if (qrBitmap != null) {
                    ivExitPassQrBitmap.setImageBitmap(qrBitmap)
                }
            }

            // Expiry countdown setup (45 Minutes)
            if (!leave.validUntil.isNullOrEmpty()) {
                try {
                    val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                    val expDate = iso.parse(leave.validUntil)
                    targetExpiryMillis = expDate?.time ?: (System.currentTimeMillis() + 30 * 60 * 1000)
                } catch (e: Exception) {
                    targetExpiryMillis = System.currentTimeMillis() + (leave.remainingSeconds ?: (30 * 60L)) * 1000
                }
            } else if (leave.remainingSeconds != null && leave.remainingSeconds > 0) {
                targetExpiryMillis = System.currentTimeMillis() + leave.remainingSeconds * 1000
            } else {
                targetExpiryMillis = System.currentTimeMillis() + 30 * 60 * 1000
            }

            // Load Student Profile Photo
            val photoUrl = leave.student?.profilePicUrl ?: sessionManager.getProfilePicUrl()
            loadProfilePhoto(photoUrl, ivExitPassStudentPhoto)

            // Start Live Dynamic Clock & Countdown
            isClockRunning = true
            mainHandler.removeCallbacks(liveClockRunnable)
            mainHandler.post(liveClockRunnable)

        } else {
            // State 1 & 2: Waiting Approval
            cardFormApply.visibility = View.GONE
            cardActiveStatus.visibility = View.VISIBLE
            cardDigitalExitPass.visibility = View.GONE
            isClockRunning = false
            mainHandler.removeCallbacks(liveClockRunnable)

            tvActiveLeaveType.text = "Tipe Izin: ${leave.categoryLabel ?: leave.leaveType ?: "Izin Pulang"}"
            tvActiveReason.text = "Alasan: ${leave.reason}"
            tvActivePickup.text = "Penjemput: ${leave.pickupBy ?: leave.pickupPerson ?: "Mandiri"}"

            if (!leave.counselorNotes.isNullOrEmpty()) {
                tvCounselorNotes.visibility = View.VISIBLE
                tvCounselorNotes.text = "Catatan BK: ${leave.counselorNotes}"
            } else {
                tvCounselorNotes.visibility = View.GONE
            }

            btnScanBkStation.visibility = View.GONE

            val isRejected = leave.status.contains("REJECT", ignoreCase = true)
            if (isRejected) {
                stopPendingAutoPoll()
                layoutStatusBanner.setBackgroundColor(Color.parseColor("#FEE2E2"))
                tvStatusIcon.text = "❌"
                tvStatusTitle.text = "Permohonan Izin Ditolak Guru BK"
                tvStatusTitle.setTextColor(Color.parseColor("#991B1B"))
                tvStatusSubtitle.text = "Pengajuan izin tidak disetujui Guru BK. Silakan temui Guru BK di Ruang Konseling."
                tvStatusSubtitle.setTextColor(Color.parseColor("#B91C1C"))
            } else {
                startPendingAutoPoll()
                layoutStatusBanner.setBackgroundColor(Color.parseColor("#FEF3C7"))
                tvStatusIcon.text = "⏳"
                tvStatusTitle.text = "Menunggu Persetujuan Guru BK"
                tvStatusTitle.setTextColor(Color.parseColor("#92400E"))
                tvStatusSubtitle.text = "Pengajuan izin Anda sedang ditinjau Guru BK di Ruang Konseling. Begitu disetujui, Tiket Gatepass Resmi Satpam (Hijau) beserta QR Code akan langsung muncul otomatis di layar HP ini untuk ditunjukkan ke Petugas Gerbang (Satpam). Anda tidak perlu scan QR di meja BK."
                tvStatusSubtitle.setTextColor(Color.parseColor("#B45309"))
            }
        }
    }

    private fun showLeaveHistoryDialog() {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val dialog = android.app.Dialog(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }

        // ================= HEADER BERWARNA TEAL GRADIENT =================
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val grad = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(Color.parseColor("#065F46"), Color.parseColor("#047857"), Color.parseColor("#0D9488"))
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

        val titleContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(10)
            }
        }

        val tvTitle = TextView(this).apply {
            text = "🎫 Riwayat Digital Gatepass"
            textSize = 17.5f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
        }
        val tvSub = TextView(this).apply {
            text = "Histori Surat Izin, Dispensasi, & Check-out Satpam"
            textSize = 11.5f
            setTextColor(Color.parseColor("#D1FAE5"))
        }
        titleContainer.addView(tvTitle)
        titleContainer.addView(tvSub)
        topBar.addView(titleContainer)

        val btnNewLeave = TextView(this).apply {
            text = "➕ Ajukan Baru"
            textSize = 11.5f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#065F46"))
            val btnShape = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(16).toFloat()
            }
            background = btnShape
            setPadding(dp(12), dp(7), dp(12), dp(7))
            setOnClickListener {
                dialog.dismiss()
                showFormOnly()
            }
        }
        topBar.addView(btnNewLeave)
        header.addView(topBar)
        root.addView(header)

        // Filter Bar (Semua, Aktif/Disetujui, Selesai, Menunggu/Ditolak)
        val filterScroll = HorizontalScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            isHorizontalScrollBarEnabled = false
        }
        val filterContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        filterScroll.addView(filterContainer)
        root.addView(filterScroll)

        val scroll = androidx.core.widget.NestedScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            setPadding(dp(14), dp(10), dp(14), dp(14))
        }
        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scroll.addView(listContainer)

        val tvLoading = TextView(this).apply {
            text = "⏳ Memuat seluruh riwayat perizinan dari server..."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(30), 0, dp(30))
            gravity = android.view.Gravity.CENTER
        }
        listContainer.addView(tvLoading)
        root.addView(scroll)

        dialog.setContentView(root)
        dialog.show()

        ApiClient.getClient(this).getStudentGatepassHistory().enqueue(object : Callback<StudentGatepassHistoryResponse> {
            override fun onResponse(call: Call<StudentGatepassHistoryResponse>, response: Response<StudentGatepassHistoryResponse>) {
                val fullList = response.body()?.data ?: emptyList()
                var activeFilter = "ALL" // ALL, APPROVED, COMPLETED, PENDING, REJECTED

                fun renderFilteredList() {
                    listContainer.removeAllViews()
                    val filtered = fullList.filter { item ->
                        val st = item.status.uppercase()
                        when (activeFilter) {
                            "APPROVED" -> st.contains("APPROVED") && !st.contains("COMPLETED") && !st.contains("EXPIRED")
                            "COMPLETED" -> st.contains("COMPLETED")
                            "PENDING" -> !st.contains("APPROVED") && !st.contains("REJECT") && !st.contains("COMPLETED") && !st.contains("EXPIRED")
                            "REJECTED" -> st.contains("REJECT") || st.contains("EXPIRED")
                            else -> true
                        }
                    }

                    if (filtered.isEmpty()) {
                        val cardEmpty = CardView(this@ExitPassActivity).apply {
                            radius = dp(16).toFloat()
                            cardElevation = dp(2).toFloat()
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                        }
                        val innerEmpty = LinearLayout(this@ExitPassActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = dp(28)
                            setPadding(p, p, p, p)
                            gravity = android.view.Gravity.CENTER
                        }
                        val tvEmptyIcon = TextView(this@ExitPassActivity).apply {
                            text = "📭"
                            textSize = 36f
                            gravity = android.view.Gravity.CENTER
                        }
                        val tvEmpty = TextView(this@ExitPassActivity).apply {
                            text = "Tidak ada riwayat perizinan pada kategori ini."
                            textSize = 13f
                            setTextColor(Color.parseColor("#94A3B8"))
                            setPadding(0, dp(8), 0, 0)
                            gravity = android.view.Gravity.CENTER
                        }
                        innerEmpty.addView(tvEmptyIcon)
                        innerEmpty.addView(tvEmpty)
                        cardEmpty.addView(innerEmpty)
                        listContainer.addView(cardEmpty)
                        return
                    }

                    filtered.forEach { item ->
                        val card = CardView(this@ExitPassActivity).apply {
                            radius = dp(16).toFloat()
                            cardElevation = dp(3).toFloat()
                            setCardBackgroundColor(Color.WHITE)
                            useCompatPadding = true
                            layoutParams = LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                LinearLayout.LayoutParams.WRAP_CONTENT
                            ).apply { bottomMargin = dp(8) }
                        }

                        val inner = LinearLayout(this@ExitPassActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val p = dp(14)
                            setPadding(p, p, p, p)
                        }

                        val stUpper = item.status.uppercase()
                        val isApproved = stUpper.contains("APPROVED") && !stUpper.contains("COMPLETED") && !stUpper.contains("EXPIRED")
                        val isCompleted = stUpper.contains("COMPLETED")
                        val (stLabel, stColor, stBg, stAccent) = when {
                            isCompleted -> Quadruple("✅ Selesai (Keluar Gerbang)", "#065F46", "#D1FAE5", "#059669")
                            isApproved -> Quadruple("🟢 Disetujui Guru BK (Siap Scan Satpam)", "#15803D", "#DCFCE7", "#16A34A")
                            stUpper.contains("REJECT") -> Quadruple("❌ Ditolak Guru BK", "#991B1B", "#FEE2E2", "#DC2626")
                            stUpper.contains("EXPIRED") -> Quadruple("⌛ Kadaluwarsa (> 30 Menit)", "#475569", "#F1F5F9", "#64748B")
                            else -> Quadruple("⏳ Menunggu Verifikasi BK", "#92400E", "#FEF3C7", "#D97706")
                        }

                        val dateStr = try {
                            if (!item.createdAt.isNullOrEmpty()) {
                                val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                                val d = iso.parse(item.createdAt)
                                SimpleDateFormat("EEEE, dd MMM yyyy • HH:mm 'WIB'", Locale("id", "ID")).format(d ?: Date())
                            } else "-"
                        } catch (e: Exception) { item.createdAt ?: "-" }

                        // Category & Date Row
                        val rowTop = LinearLayout(this@ExitPassActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                        }

                        val categoryEmoji = when {
                            (item.categoryLabel ?: item.leaveType ?: "").contains("Sakit", ignoreCase = true) -> "🤒"
                            (item.categoryLabel ?: item.leaveType ?: "").contains("Mendesak", ignoreCase = true) -> "🚨"
                            (item.categoryLabel ?: item.leaveType ?: "").contains("Dispen", ignoreCase = true) -> "🏅"
                            else -> "📋"
                        }

                        val tvCat = TextView(this@ExitPassActivity).apply {
                            text = "$categoryEmoji ${item.categoryLabel ?: item.leaveType ?: "Izin Keluar"}"
                            textSize = 14f
                            typeface = android.graphics.Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor("#0F172A"))
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        }
                        rowTop.addView(tvCat)

                        val tvStatusBadge = TextView(this@ExitPassActivity).apply {
                            text = stLabel
                            textSize = 10f
                            typeface = android.graphics.Typeface.DEFAULT_BOLD
                            setTextColor(Color.parseColor(stColor))
                            setBackgroundColor(Color.parseColor(stBg))
                            val p = dp(6)
                            setPadding(p, dp(3), p, dp(3))
                        }
                        rowTop.addView(tvStatusBadge)
                        inner.addView(rowTop)

                        val tvDate = TextView(this@ExitPassActivity).apply {
                            text = "📅 $dateStr"
                            textSize = 11f
                            setTextColor(Color.parseColor("#64748B"))
                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = dp(4)
                            }
                            layoutParams = lp
                        }
                        inner.addView(tvDate)

                        // Reason Box
                        val reasonBox = LinearLayout(this@ExitPassActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setBackgroundColor(Color.parseColor("#F8FAFC"))
                            val p = dp(8)
                            setPadding(p, p, p, p)
                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = dp(8)
                            }
                            layoutParams = lp
                        }
                        val tvReason = TextView(this@ExitPassActivity).apply {
                            text = "📝 Alasan: \"${item.reason ?: "-"}\""
                            textSize = 11.5f
                            setTextColor(Color.parseColor("#334155"))
                        }
                        reasonBox.addView(tvReason)
                        inner.addView(reasonBox)

                        // Meta details: Penjemput, BK, Satpam
                        val metaBox = LinearLayout(this@ExitPassActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = dp(6)
                            }
                            layoutParams = lp
                        }
                        val tvPickup = TextView(this@ExitPassActivity).apply {
                            text = "🚗 Penjemput: ${item.pickupBy ?: "Orang Tua / Mandiri"}"
                            textSize = 11f
                            setTextColor(Color.parseColor("#64748B"))
                        }
                        val bkName = item.approvedByBk ?: "Guru BK"
                        val satpamName = if (!item.checkoutSatpam.isNullOrEmpty()) item.checkoutSatpam else "Belum Checkout"
                        val tvOfficers = TextView(this@ExitPassActivity).apply {
                            text = "👨‍🏫 Guru BK: $bkName • 👮 Satpam: $satpamName"
                            textSize = 10.5f
                            setTextColor(Color.parseColor("#64748B"))
                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                topMargin = dp(2)
                            }
                            layoutParams = lp
                        }
                        metaBox.addView(tvPickup)
                        metaBox.addView(tvOfficers)
                        inner.addView(metaBox)

                        // Highlight Action if Approved
                        if (isApproved) {
                            val btnShowQr = TextView(this@ExitPassActivity).apply {
                                text = "📲 BUKA QR CODE SATPAM (TIKET AKTIF) →"
                                textSize = 11.5f
                                typeface = android.graphics.Typeface.DEFAULT_BOLD
                                setTextColor(Color.WHITE)
                                setBackgroundColor(Color.parseColor("#059669"))
                                gravity = android.view.Gravity.CENTER
                                val p = dp(8)
                                setPadding(p, p, p, p)
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(10)
                                }
                                layoutParams = lp
                                setOnClickListener {
                                    showHistoryItemDetailDialog(item, dialog)
                                }
                            }
                            inner.addView(btnShowQr)
                        } else {
                            val btnDetail = TextView(this@ExitPassActivity).apply {
                                text = "Lihat Detail Tiket & Audit Trail →"
                                textSize = 11f
                                setTextColor(Color.parseColor("#0284C7"))
                                typeface = android.graphics.Typeface.DEFAULT_BOLD
                                gravity = android.view.Gravity.END
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    topMargin = dp(8)
                                }
                                layoutParams = lp
                                setOnClickListener {
                                    showHistoryItemDetailDialog(item, dialog)
                                }
                            }
                            inner.addView(btnDetail)
                        }

                        card.addView(inner)
                        listContainer.addView(card)
                    }
                }

                // Render Filter Buttons
                val filterButtons = listOf(
                    Pair("ALL", "Semua (${fullList.size})"),
                    Pair("APPROVED", "🟢 Disetujui"),
                    Pair("COMPLETED", "✅ Selesai"),
                    Pair("PENDING", "⏳ Menunggu"),
                    Pair("REJECTED", "❌ Ditolak/Expired")
                )

                filterContainer.removeAllViews()
                filterButtons.forEach { (mode, label) ->
                    val btn = TextView(this@ExitPassActivity).apply {
                        text = label
                        textSize = 11f
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                        val p = dp(8)
                        setPadding(p, dp(4), p, dp(4))
                        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            marginEnd = dp(6)
                        }
                        layoutParams = lp
                        setOnClickListener {
                            activeFilter = mode
                            renderFilteredList()
                        }
                    }
                    filterContainer.addView(btn)
                }

                renderFilteredList()
            }

            override fun onFailure(call: Call<StudentGatepassHistoryResponse>, t: Throwable) {
                listContainer.removeAllViews()
                val tvErr = TextView(this@ExitPassActivity).apply {
                    text = "Gagal memuat riwayat: ${t.message}"
                    textSize = 12f
                    setTextColor(Color.parseColor("#DC2626"))
                    gravity = android.view.Gravity.CENTER
                }
                listContainer.addView(tvErr)
            }
        })
    }

    private data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)

    private fun showHistoryItemDetailDialog(item: GatepassHistoryItem, parentDialog: android.app.Dialog) {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val isApproved = item.status.contains("APPROVED", ignoreCase = true)
        val isCompleted = item.status.contains("COMPLETED", ignoreCase = true)
        val isExpired = item.status.contains("EXPIRED", ignoreCase = true)

        val detailDialog = AlertDialog.Builder(this).create()
        val scroll = androidx.core.widget.NestedScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(18))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(20).toFloat()
            }
        }

        val tvTitle = TextView(this).apply {
            text = "📋 Rincian Resmi Digital Gatepass"
            textSize = 16f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#065F46"))
        }
        val tvSerial = TextView(this).apply {
            text = "NO. TIKET: PASS-${item.id.takeLast(6).uppercase()}"
            textSize = 10f
            typeface = android.graphics.Typeface.MONOSPACE
            setTextColor(Color.parseColor("#64748B"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(2)
                bottomMargin = dp(10)
            }
            layoutParams = lp
        }
        root.addView(tvTitle)
        root.addView(tvSerial)

        val detailTable = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            val p = dp(12)
            setPadding(p, p, p, p)
        }

        fun addRow(label: String, value: String) {
            val r = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(6)
                }
                layoutParams = lp
            }
            val l = TextView(this).apply {
                text = label
                textSize = 11f
                setTextColor(Color.parseColor("#64748B"))
                layoutParams = LinearLayout.LayoutParams(dp(110), ViewGroup.LayoutParams.WRAP_CONTENT)
            }
            val v = TextView(this).apply {
                text = value
                textSize = 11.5f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#1E293B"))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            r.addView(l)
            r.addView(v)
            detailTable.addView(r)
        }

        addRow("Jenis Izin", item.categoryLabel ?: item.leaveType ?: "Izin Keluar")
        addRow("Status Tiket", item.status)
        addRow("Alasan", item.reason ?: "-")
        addRow("Penjemput", item.pickupBy ?: "Orang Tua / Mandiri")
        addRow("Guru BK Penyetuju", item.approvedByBk ?: "Guru BK")
        addRow("Checkout Gerbang", item.checkoutSatpam ?: "Belum Checkout")
        addRow("Tanggal Pengajuan", item.createdAt ?: "-")
        root.addView(detailTable)

        // Jika approved & belum keluar, tampilkan QR Code Satpam dengan visual modern
        if (isApproved && !isCompleted && !isExpired) {
            val qrContainer = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                setPadding(dp(12), dp(12), dp(12), dp(12))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(12)
                }
                layoutParams = lp
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor("#F0FDF4"))
                    cornerRadius = dp(14).toFloat()
                    setStroke(dp(1), Color.parseColor("#86EFAC"))
                }
            }

            val tvQrTitle = TextView(this).apply {
                text = "🛡️ QR CODE CHECKOUT SATPAM"
                textSize = 12f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#166534"))
            }
            qrContainer.addView(tvQrTitle)

            val ivQr = ImageView(this).apply {
                val lp = LinearLayout.LayoutParams(dp(200), dp(200)).apply {
                    topMargin = dp(8)
                    bottomMargin = dp(8)
                }
                layoutParams = lp
            }
            val rawToken = item.singleUseCheckoutToken ?: item.id
            val qrBitmap = QrCodeHelper.generateQrCodeBitmap("SMARTCBT-GATEPASS:$rawToken:${item.id}", 400)
            if (qrBitmap != null) ivQr.setImageBitmap(qrBitmap)
            qrContainer.addView(ivQr)

            val tvQrNotes = TextView(this).apply {
                text = "⏱️ Tiket berlaku 30 menit setelah persetujuan Guru BK.\n👮 Tunjukkan QR ini ke Petugas Satpam saat melewati gerbang sekolah."
                textSize = 10.5f
                setTextColor(Color.parseColor("#15803D"))
                gravity = android.view.Gravity.CENTER
            }
            qrContainer.addView(tvQrNotes)
            root.addView(qrContainer)
        }

        // Tombol Aksi Bawah
        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(14)
            }
            layoutParams = lp
        }

        val btnClose = Button(this).apply {
            text = "Tutup"
            setTextColor(Color.parseColor("#64748B"))
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(4) }
            setOnClickListener { detailDialog.dismiss() }
        }
        btnRow.addView(btnClose)

        val btnNewApply = Button(this).apply {
            text = "➕ Ajukan Izin Baru"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            textSize = 12f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, dp(44), 1.5f).apply { marginStart = dp(4) }
            setOnClickListener {
                detailDialog.dismiss()
                parentDialog.dismiss()
                showFormOnly()
            }
        }
        btnRow.addView(btnNewApply)
        root.addView(btnRow)

        scroll.addView(root)
        detailDialog.setView(scroll)
        detailDialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        detailDialog.show()
    }

    private fun showManualScanDialog() {
        val input = EditText(this)
        input.hint = "Pindai / Masukkan token QR Ruang BK"
        input.setPadding(32, 24, 32, 24)

        AlertDialog.Builder(this)
            .setTitle("📷 Validasi QR Ruang BK")
            .setMessage("Masukkan token hasil scan Dynamic Rotating QR Ruang BK:")
            .setView(input)
            .setPositiveButton("Verifikasi") { _, _ ->
                val tokenScanned = input.text.toString().trim()
                if (tokenScanned.isNotEmpty()) {
                    processCheckout(tokenScanned)
                } else {
                    Toast.makeText(this, "Token QR Ruang BK wajib diisi.", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun processCheckout(qrToken: String) {
        val req = CheckoutBkRequest(
            dynamicToken = qrToken,
            qrSecretToken = qrToken,
            gatepassId = activeLeaveId,
            leaveId = activeLeaveId
        )

        Toast.makeText(this, "Memvalidasi Dynamic QR Ruang BK...", Toast.LENGTH_SHORT).show()

        ApiClient.getClient(this).verifyGatepassByScan(req).enqueue(object : Callback<CheckoutBkResponse> {
            override fun onResponse(call: Call<CheckoutBkResponse>, response: Response<CheckoutBkResponse>) {
                val body = response.body()
                if (response.isSuccessful && body?.success == true) {
                    Toast.makeText(this@ExitPassActivity, "🎉 ${body.message}", Toast.LENGTH_LONG).show()
                    fetchActiveLeave()
                } else {
                    Toast.makeText(this@ExitPassActivity, body?.message ?: "Gagal memvalidasi QR BK", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<CheckoutBkResponse>, t: Throwable) {
                Toast.makeText(this@ExitPassActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun loadProfilePhoto(photoUrl: String?, imageView: ImageView) {
        if (photoUrl.isNullOrEmpty()) {
            imageView.setImageResource(R.drawable.ic_avatar_placeholder)
            return
        }

        val baseServer = sessionManager.getServerIp().trimEnd('/')
        val fullUrl = if (photoUrl.startsWith("http")) photoUrl else "$baseServer${if (photoUrl.startsWith("/")) "" else "/"}$photoUrl"

        imageView.tag = fullUrl
        val cached = photoCache[fullUrl]
        if (cached != null && !cached.isRecycled) {
            imageView.setImageBitmap(cached)
            return
        }

        imageExecutor.execute {
            try {
                val conn = java.net.URL(fullUrl).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 4000
                conn.readTimeout = 4000
                conn.doInput = true
                conn.connect()
                val bytes = conn.inputStream.use { it.readBytes() }
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (bmp != null) {
                    photoCache[fullUrl] = bmp
                    runOnUiThread {
                        if (imageView.tag == fullUrl) {
                            imageView.setImageBitmap(bmp)
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (imageView.tag == fullUrl) {
                        imageView.setImageResource(R.drawable.ic_avatar_placeholder)
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isClockRunning = false
        mainHandler.removeCallbacks(liveClockRunnable)
        imageExecutor.shutdown()
    }
}
