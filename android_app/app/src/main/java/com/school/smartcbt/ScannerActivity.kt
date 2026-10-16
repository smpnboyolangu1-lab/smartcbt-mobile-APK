package com.school.smartcbt

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Vibrator
import android.os.VibratorManager
import android.view.View
import android.widget.Button
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.school.smartcbt.data.model.BasicResponse
import com.school.smartcbt.data.model.GateScanRequest
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.utils.NotificationHelper
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Calendar
import java.util.Locale
import android.widget.LinearLayout
import android.graphics.Color
import android.graphics.drawable.ColorDrawable

data class LocationResult(
    val lat: Double?,
    val lng: Double?,
    val isMock: Boolean,
    val accuracy: Float
)

class ScannerActivity : AppCompatActivity() {

    private lateinit var sessionManager: SessionManager
    private var locationManager: LocationManager? = null
    private var liveBestLocation: Location? = null

    // Konfigurasi Dinamis dari Server
    private var isScannerGeolocationActive: Boolean = true
    private var schoolLat: Double = -8.125506
    private var schoolLng: Double = 111.893526
    private var radiusGlobal: Int = 150
    private var zoneGoodThreshold: Float = 50.0f
    private var zoneDegradedThreshold: Float = 100.0f
    private var countdownSeconds: Int = 60
    private var isUsingQrFallback: Boolean = false
    private var countdownTimer: android.os.CountDownTimer? = null

    private val liveLocationListener = object : android.location.LocationListener {
        override fun onLocationChanged(loc: Location) {
            val isMock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) loc.isMock
                         else @Suppress("DEPRECATION") loc.isFromMockProvider
            if (isMock) {
                liveBestLocation = loc
                runOnUiThread { updateGpsIndicatorUI(loc) }
                return
            }

            liveBestLocation = loc
            runOnUiThread {
                updateGpsIndicatorUI(loc)
            }
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    private lateinit var viewFinder: PreviewView
    private lateinit var tvStatusText: TextView
    private lateinit var tvClassIndicator: TextView
    private var tvLiveGpsCoords: TextView? = null
    private var tvGpsAccuracySub: TextView? = null
    private var layoutLiveGpsBadge: LinearLayout? = null
    private var tvScannerTitle: TextView? = null
    private var tvScannerSub: TextView? = null
    private var tvServerClock: TextView? = null
    private var tvServerDate: TextView? = null
    private val clockHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val clockTicker = object : Runnable {
        override fun run() {
            val now = Date()
            val timeFmt = SimpleDateFormat("HH:mm:ss", Locale("id", "ID")).format(now) + " WIB"
            val dateFmt = SimpleDateFormat("EEEE, dd MMM yyyy", Locale("id", "ID")).format(now)
            tvServerClock?.text = timeFmt
            tvServerDate?.text = dateFmt
            clockHandler.postDelayed(this, 1000)
        }
    }
    private lateinit var btnFlashToggle: ImageButton
    private lateinit var btnBack: ImageButton

    private var camera: Camera? = null
    private var isTorchOn = false
    private var isProcessingScan = false
    private var currentScanMode: String = MODE_ATTENDANCE
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var barcodeScanner: BarcodeScanner

    companion object {
        private const val PERMISSION_REQ_CODE = 2001
        const val EXTRA_SCAN_MODE = "EXTRA_SCAN_MODE"
        const val MODE_ATTENDANCE = "MODE_ATTENDANCE"
        const val MODE_BOOK_AUDIT = "MODE_BOOK_AUDIT"
        const val MODE_PRAYER = "MODE_PRAYER"
        const val MODE_EXAM_TOKEN = "MODE_EXAM_TOKEN"
        const val EXTRA_SCANNED_TOKEN = "EXTRA_SCANNED_TOKEN"
        const val MODE_ROOM_HANDOVER = "MODE_ROOM_HANDOVER"
        const val EXTRA_SCANNED_ROOM_CODE = "EXTRA_SCANNED_ROOM_CODE"
        const val MODE_BK_DYNAMIC_QR = "MODE_BK_DYNAMIC_QR"
        const val MODE_SATPAM_GATEPASS = "MODE_SATPAM_GATEPASS"
        const val EXTRA_SATPAM_ACTION = "EXTRA_SATPAM_ACTION"
        const val EXTRA_PRAYER_STATUS = "EXTRA_PRAYER_STATUS"
        const val EXTRA_PRAYER_TYPE = "EXTRA_PRAYER_TYPE"
        const val MODE_WIFI_CARD = "MODE_WIFI_CARD"
        const val MODE_PAI_STUDENT_CARD = "MODE_PAI_STUDENT_CARD"
        const val MODE_KANTIN_POS = "KANTIN_POS"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_scanner)

        sessionManager = SessionManager(this)
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        cameraExecutor = Executors.newSingleThreadExecutor()

        // Initialize ML Kit Barcode Scanner for QR, Code 128, Code 39
        val options = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_QR_CODE,
                Barcode.FORMAT_CODE_128,
                Barcode.FORMAT_CODE_39,
                Barcode.FORMAT_EAN_13
            )
            .build()
        barcodeScanner = BarcodeScanning.getClient(options)

        initViews()
        fetchServerAttendanceConfig()
        checkPermissionsAndStartCamera()
    }

    private fun initViews() {
        viewFinder = findViewById(R.id.viewFinder)
        tvStatusText = findViewById(R.id.tvStatusText)
        tvClassIndicator = findViewById(R.id.tvClassIndicator)
        tvLiveGpsCoords = findViewById(R.id.tvLiveGpsCoords)
        tvGpsAccuracySub = findViewById(R.id.tvGpsAccuracySub)
        layoutLiveGpsBadge = findViewById(R.id.layoutLiveGpsBadge)
        tvScannerTitle = findViewById(R.id.tvScannerTitle)
        tvScannerSub = findViewById(R.id.tvScannerSub)
        tvServerClock = findViewById(R.id.tvServerClock)
        tvServerDate = findViewById(R.id.tvServerDate)
        clockHandler.post(clockTicker)
        btnFlashToggle = findViewById(R.id.btnFlashToggle)
        btnBack = findViewById(R.id.btnBack)

        // Inisialisasi Suara Pintar (TTS Bahasa Indonesia)
        com.school.smartcbt.utils.TtsVoiceHelper.init(this)
        com.school.smartcbt.utils.AttendanceOfflineManager.clearAllOfflineScans(this)

        currentScanMode = intent.getStringExtra(EXTRA_SCAN_MODE) ?: MODE_ATTENDANCE
        if (currentScanMode == MODE_BOOK_AUDIT) {
            tvScannerTitle?.text = "📚 Pemindai Barcode Buku"
            tvScannerSub?.text = "Arahkan kamera ke Stiker Barcode Buku Perpustakaan"
            tvClassIndicator.text = "📚 Sirkulasi & Audit Buku Perpustakaan"
            tvClassIndicator.setBackgroundColor(Color.parseColor("#7C3AED"))
            tvStatusText.text = "📖 Posisikan Barcode Buku pada area kamera..."
            layoutLiveGpsBadge?.visibility = View.GONE
            tvGpsAccuracySub?.visibility = View.GONE
        } else if (currentScanMode == MODE_PRAYER) {
            val topBarView = findViewById<LinearLayout>(R.id.topBar)
            topBarView?.setBackgroundResource(R.drawable.bg_mushola_header_gradient)
            tvScannerTitle?.text = "🕌 SCAN QR MUSHOLA"
            tvScannerSub?.text = "Posisikan kamera ke QR Code Statik Mushola / Masjid Sekolah"
            tvClassIndicator.text = "🕌 Titik Presensi: Mushola / Masjid Sekolah"
            tvClassIndicator.setBackgroundColor(Color.parseColor("#059669"))
            tvStatusText.text = "🕌 Posisikan QR Code Mushola pada area kamera..."
        } else if (currentScanMode == MODE_ROOM_HANDOVER) {
            val topBarView = findViewById<LinearLayout>(R.id.topBar)
            topBarView?.setBackgroundResource(R.drawable.bg_matpel_header_gradient)
            tvScannerTitle?.text = "📱 SCAN QR RUANG KELAS"
            tvScannerSub?.text = "Posisikan kamera ke Stiker QR Ruang Kelas KBM"
            tvClassIndicator.text = "🏫 Estafet Sesi Mengajar Kelas Fisik"
            tvClassIndicator.setBackgroundColor(Color.parseColor("#4F46E5"))
            tvStatusText.text = "📱 Arahkan ke QR Ruang Kelas untuk membuka presensi KBM..."
        } else if (currentScanMode == MODE_BK_DYNAMIC_QR || currentScanMode == "BK_STATION") {
            tvScannerTitle?.text = "📱 SCAN DYNAMIC QR BK"
            tvScannerSub?.text = "Posisikan kamera ke Dynamic QR di Layar Guru BK"
            tvClassIndicator.text = "🕊️ Ruang Bimbingan Konseling (BK)"
            tvClassIndicator.setBackgroundColor(Color.parseColor("#059669"))
            tvStatusText.text = "📱 Posisikan Dynamic QR Guru BK pada kotak pemindai..."
        } else if (currentScanMode == MODE_SATPAM_GATEPASS) {
            val satpamAction = intent.getStringExtra(EXTRA_SATPAM_ACTION) ?: "CHECKOUT"
            layoutLiveGpsBadge?.visibility = View.GONE
            tvGpsAccuracySub?.visibility = View.GONE
            if (satpamAction == "RETURN") {
                tvScannerTitle?.text = "🛡️ POS SATPAM: KEMBALI MASUK"
                tvScannerSub?.text = "Pindai QR Gatepass / Kartu Siswa yang Kembali ke Kampus"
                tvClassIndicator.text = "🏫 Pos Keamanan: Siswa Kembali Masuk"
                tvClassIndicator.setBackgroundColor(Color.parseColor("#0284C7"))
                tvStatusText.text = "🛡️ Posisikan QR Gatepass / Kartu Siswa untuk mencatat kembali masuk..."
            } else {
                tvScannerTitle?.text = "🛡️ POS SATPAM: CHECKOUT GERBANG"
                tvScannerSub?.text = "Pindai Single-Use QR Gatepass di HP Siswa"
                tvClassIndicator.text = "🚪 Pos Keamanan Gerbang Keluar"
                tvClassIndicator.setBackgroundColor(Color.parseColor("#DC2626"))
                tvStatusText.text = "🛡️ Posisikan QR Tiket Gatepass Siswa pada kamera..."
            }
        } else if (currentScanMode == MODE_PAI_STUDENT_CARD) {
            tvScannerTitle?.text = "🕌 SCAN KARTU PELAJAR (GURU PAI)"
            tvScannerSub?.text = "Scan Kartu Pelajar Siswa Tanpa HP untuk Presensi Mushola & Gate Sekolah"
            tvClassIndicator.text = "🕌 Presensi Sholat & Gate Sekolah Terintegrasi"
            tvClassIndicator.setBackgroundColor(Color.parseColor("#059669"))
            tvStatusText.text = "📷 Arahkan kamera ke Barcode / QR Kartu Pelajar siswa..."
            layoutLiveGpsBadge?.visibility = View.GONE
        } else if (currentScanMode == MODE_KANTIN_POS) {
            tvScannerTitle?.text = "🍱 KASIR E-KANTIN"
            tvScannerSub?.text = "Pindai QR Saldo Siswa atau Barcode Kartu Pelajar"
            tvClassIndicator.text = "🍱 POS Kasir E-Kantin Sekolah"
            tvClassIndicator.setBackgroundColor(Color.parseColor("#D97706"))
            tvStatusText.text = "📷 Posisikan QR Bayar Siswa / Barcode NISN..."
            layoutLiveGpsBadge?.visibility = View.GONE
            tvGpsAccuracySub?.visibility = View.GONE
        } else {
            val className = sessionManager.getClassName().ifEmpty { "VII-A" }
            tvScannerTitle?.text = "Scan QR Pintu Kelas"
            tvScannerSub?.text = "Posisikan QR Code di dalam kotak"
            tvClassIndicator.text = "📍 Titik Presensi: Kelas $className"
        }

        btnBack.setOnClickListener { finish() }

        btnFlashToggle.setOnClickListener {
            toggleTorch()
        }
    }

    private fun toggleTorch() {
        camera?.let { cam ->
            if (cam.cameraInfo.hasFlashUnit()) {
                isTorchOn = !isTorchOn
                cam.cameraControl.enableTorch(isTorchOn)
                btnFlashToggle.setColorFilter(
                    if (isTorchOn) ContextCompat.getColor(this, R.color.amber_warning)
                    else ContextCompat.getColor(this, R.color.white)
                )
                Toast.makeText(this, if (isTorchOn) "Lampu Flash Menyala" else "Lampu Flash Mati", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "Perangkat tidak memiliki lampu flash", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun checkPermissionsAndStartCamera() {
        if (isScannerGeolocationActive && (currentScanMode == MODE_ATTENDANCE || currentScanMode == MODE_PRAYER || currentScanMode == MODE_ROOM_HANDOVER)) {
            com.school.smartcbt.utils.GpsUtils.checkAndRequestOneTapGps(
                activity = this,
                requestCode = com.school.smartcbt.utils.GpsUtils.REQUEST_CHECK_SETTINGS_GPS,
                onGpsAlreadyEnabled = {
                    proceedWithPermissionsCheck()
                },
                onResolutionPrompted = {
                    // One-tap native prompt ditampilkan ke siswa (cukup klik [OK])
                },
                onErrorFallback = {
                    if (!com.school.smartcbt.utils.GpsUtils.isHighAccuracyGpsEnabled(this)) {
                        com.school.smartcbt.utils.GpsUtils.showGpsRequirementDialog(this) {
                            finish()
                        }
                    } else {
                        proceedWithPermissionsCheck()
                    }
                }
            )
        } else {
            proceedWithPermissionsCheck()
        }
    }

    private fun proceedWithPermissionsCheck() {
        val permissionsNeeded = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.CAMERA)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }

        if (permissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissionsNeeded.toTypedArray(), PERMISSION_REQ_CODE)
        } else {
            startCamera()
            startLocationUpdates()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == com.school.smartcbt.utils.GpsUtils.REQUEST_CHECK_SETTINGS_GPS) {
            if (resultCode == android.app.Activity.RESULT_OK) {
                // Siswa cukup menekan tombol [OK] di pop-up bawaan -> GPS aktif seketika!
                proceedWithPermissionsCheck()
            } else {
                Toast.makeText(this, "Presensi memerlukan GPS aktif dalam mode Akurasi Tinggi.", Toast.LENGTH_SHORT).show()
                finish()
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQ_CODE) {
            val cameraGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            if (cameraGranted) {
                startCamera()
                startLocationUpdates()
            } else {
                tvStatusText.text = "⚠️ Izin kamera ditolak. Silakan berikan izin untuk memindai QR."
                Toast.makeText(this, "Izin kamera diperlukan untuk memindai QR Code presensi.", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                val cameraProvider = cameraProviderFuture.get()

                // Preview with 1280x720 target resolution
                val preview = Preview.Builder()
                    .setTargetResolution(android.util.Size(1280, 720))
                    .build()
                    .also {
                        it.setSurfaceProvider(viewFinder.surfaceProvider)
                    }

                // Image Analysis with 1280x720 resolution & keep latest frame
                val imageAnalysis = ImageAnalysis.Builder()
                    .setTargetResolution(android.util.Size(1280, 720))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                imageAnalysis.setAnalyzer(cameraExecutor, BarcodeAnalyzer { barcodeValue ->
                    if (!isProcessingScan) {
                        isProcessingScan = true
                        runOnUiThread {
                            handleScannedBarcode(barcodeValue)
                        }
                    }
                })

                val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                cameraProvider.unbindAll()
                camera = cameraProvider.bindToLifecycle(
                    this,
                    cameraSelector,
                    preview,
                    imageAnalysis
                )

                // Continuous Auto-Focus & Center Auto-Metering
                viewFinder.post {
                    try {
                        val factory = viewFinder.meteringPointFactory
                        val centerPoint = factory.createPoint(viewFinder.width / 2f, viewFinder.height / 2f)
                        val action = FocusMeteringAction.Builder(centerPoint, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
                            .setAutoCancelDuration(3, java.util.concurrent.TimeUnit.SECONDS)
                            .build()
                        camera?.cameraControl?.startFocusAndMetering(action)
                    } catch (e: Exception) {
                        // Safe fallback
                    }
                }

                // Tap-to-focus support
                viewFinder.setOnTouchListener { _, event ->
                    if (event.action == android.view.MotionEvent.ACTION_UP) {
                        try {
                            val factory = viewFinder.meteringPointFactory
                            val point = factory.createPoint(event.x, event.y)
                            val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
                                .setAutoCancelDuration(3, java.util.concurrent.TimeUnit.SECONDS)
                                .build()
                            camera?.cameraControl?.startFocusAndMetering(action)
                        } catch (e: Exception) {
                            // Safe fallback
                        }
                    }
                    true
                }

                runOnUiThread {
                    if (currentScanMode == MODE_BOOK_AUDIT) {
                        tvStatusText.text = "📚 Kamera Siap: Arahkan ke Barcode / ISBN Buku"
                    } else if (currentScanMode == MODE_EXAM_TOKEN) {
                        tvStatusText.text = "🔐 Kamera Siap: Arahkan ke QR Token Pengawas"
                    } else {
                        tvStatusText.text = "📷 Kamera Siap: Arahkan ke QR Code Presensi"
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                runOnUiThread {
                    tvStatusText.text = "Gagal mengaktifkan kamera: ${e.message}"
                }
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private class BarcodeAnalyzer(private val onBarcodeFound: (String) -> Unit) : ImageAnalysis.Analyzer {
        private val options = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_QR_CODE,
                Barcode.FORMAT_CODE_128,
                Barcode.FORMAT_CODE_39,
                Barcode.FORMAT_EAN_13
            )
            .build()
        private val scanner = BarcodeScanning.getClient(options)

        @androidx.annotation.OptIn(ExperimentalGetImage::class)
        override fun analyze(imageProxy: ImageProxy) {
            val mediaImage = imageProxy.image
            if (mediaImage != null) {
                val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                scanner.process(image)
                    .addOnSuccessListener { barcodes ->
                        for (barcode in barcodes) {
                            val value = barcode.rawValue
                            if (!value.isNullOrBlank()) {
                                onBarcodeFound(value)
                                break
                            }
                        }
                    }
                    .addOnCompleteListener {
                        imageProxy.close()
                    }
            } else {
                imageProxy.close()
            }
        }
    }

    private fun handleScannedBarcode(scannedCode: String) {
        vibratePhone()
        try {
            com.school.smartcbt.utils.TtsVoiceHelper.playBeepSuccess()
        } catch (e: Exception) {}

        val scanMode = intent.getStringExtra(EXTRA_SCAN_MODE) ?: MODE_ATTENDANCE
        if (scanMode == MODE_EXAM_TOKEN) {
            val cleanToken = scannedCode.trim().uppercase()
            val resultIntent = android.content.Intent().apply {
                putExtra(EXTRA_SCANNED_TOKEN, cleanToken)
            }
            setResult(RESULT_OK, resultIntent)
            finish()
            return
        }

        if (scanMode == MODE_WIFI_CARD) {
            val cleanToken = scannedCode.trim()
            val resultIntent = android.content.Intent().apply {
                putExtra(EXTRA_SCANNED_TOKEN, cleanToken)
            }
            setResult(RESULT_OK, resultIntent)
            finish()
            return
        }

        if (scanMode == MODE_ROOM_HANDOVER) {
            val cleanRoom = scannedCode.trim()
            val resultIntent = android.content.Intent().apply {
                putExtra(EXTRA_SCANNED_ROOM_CODE, cleanRoom)
            }
            setResult(RESULT_OK, resultIntent)
            finish()
            return
        }

        if (scanMode == MODE_BK_DYNAMIC_QR || scanMode == "BK_STATION" || scannedCode.startsWith("SMARTCBT-BK-DYN:") || scannedCode.startsWith("BK-STATION-")) {
            val cleanToken = scannedCode.trim()
            val resultIntent = android.content.Intent().apply {
                putExtra(EXTRA_SCANNED_TOKEN, cleanToken)
                putExtra("SCANNED_TOKEN", cleanToken)
            }
            setResult(RESULT_OK, resultIntent)
            finish()
            return
        }

        if (scanMode == "KANTIN_POS" || scannedCode.startsWith("CANTIN-PAY:")) {
            val cleanToken = scannedCode.trim()
            val resultIntent = android.content.Intent().apply {
                putExtra(EXTRA_SCANNED_TOKEN, cleanToken)
                putExtra("SCANNED_TOKEN", cleanToken)
            }
            setResult(RESULT_OK, resultIntent)
            finish()
            return
        }

        if (scanMode == MODE_SATPAM_GATEPASS || scannedCode.startsWith("SMARTCBT-GATEPASS:") || scannedCode.startsWith("SMARTCBT-EXITPASS:") || scannedCode.startsWith("GP-CHK-")) {
            handleSatpamGatepassScan(scannedCode)
            return
        }

        if (scanMode == MODE_BOOK_AUDIT) {
            handleBookAuditScan(scannedCode)
            return
        }

        if (scanMode == MODE_PAI_STUDENT_CARD) {
            handlePaiStudentCardScan(scannedCode)
            return
        }

        if (scanMode == MODE_PRAYER || scannedCode.contains("SHOLAT", ignoreCase = true) || scannedCode.contains("MASJID", ignoreCase = true)) {
            handlePrayerScan(scannedCode)
            return
        }

        tvStatusText.text = "🔍 Terdeteksi: $scannedCode. Memproses..."

        // 1. Deteksi Barcode QR Dinamis Pengurus Kelas (10 Detik):
        // Presensi sah 100% tanpa GPS karena pengurus kelas hadir fisik di dalam kelas & kode berputar tiap 10 detik
        if (scannedCode.startsWith("DYNAMIC_CLASS_QR|")) {
            tvStatusText.text = "⚡ Terdeteksi: QR Dinamis Pengurus Kelas. Memverifikasi..."
            submitAttendance(scannedCode, null, null, false, method = "QR_DYNAMIC_OFFICER", accuracy = null)
            return
        }

        // 2. Deteksi Khusus Barcode Ruang BK (GATE_IN_BK / GATE_OUT_BK)
        val isBkCode = scannedCode.contains("GATE_IN_BK", ignoreCase = true) || scannedCode.contains("GATE_OUT_BK", ignoreCase = true)

        // 3. Validasi Barcode Statis Kelas Fisik:
        // WAJIB divalidasi dengan sinyal GPS nyata di lingkungan sekolah SMP Negeri 1 Boyolangu!
        val isGpsEnabled = locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) ?: false
        val (lat, lng, isMock, accuracy) = getCurrentLocation()

        if (!isGpsEnabled || lat == null) {
            val timeNow = SimpleDateFormat("HH:mm:ss", Locale("id", "ID")).format(Date()) + " WIB"
            val voiceMsg = "Presensi barcode stiker kelas memerlukan GPS aktif di sekolah, atau pindai QR Dinamis Pengurus Kelas."
            com.school.smartcbt.utils.TtsVoiceHelper.speak(voiceMsg)
            showModernScanDialog(
                isSuccess = false,
                title = "📍 GPS Tidak Terkunci",
                subtitle = "Barcode Statis Kelas Wajib GPS Aktif",
                message = "Presensi barcode stiker kelas fisik WAJIB divalidasi dengan sinyal GPS di lingkungan sekolah SMPN 1 Boyolangu.\n\n📌 Solusi:\n1. Pastikan fitur Lokasi / GPS pada HP Anda telah aktif dan memiliki izin lokasi.\n2. Jika sinyal GPS sulit di dalam ruangan, minta Pengurus Kelas untuk membuka menu 'QR Dinamis Kelas' (presensi sah tanpa GPS).",
                gateType = if (isBkCode) "Presensi BK" else "Barcode Statis Kelas",
                timeStr = timeNow,
                lat = null,
                lng = null
            )
            return
        }

        if (isMock) {
            val timeNow = SimpleDateFormat("HH:mm:ss", Locale("id", "ID")).format(Date()) + " WIB"
            showModernScanDialog(
                isSuccess = false,
                title = "🚨 Terdeteksi Fake GPS!",
                subtitle = "Manipulasi Lokasi Palsu Ditolak Sistem",
                message = "Aplikasi mendeteksi penggunaan Fake GPS / Mock Location pada perangkat Anda. Presensi DITOLAK demi integritas kedisiplinan sekolah. Silakan matikan Fake GPS dan gunakan lokasi nyata di sekolah!",
                gateType = "Lokasi Tidak Sah",
                timeStr = timeNow,
                lat = lat,
                lng = lng
            )
            return
        }

        // Barcode statis kelas dikirim dengan method = "GPS"
        val method = if (accuracy <= zoneDegradedThreshold) "GPS" else "QR_FALLBACK"
        submitAttendance(scannedCode, lat, lng, isMock, method = method, accuracy = accuracy)
    }

    private fun handleSatpamGatepassScan(scannedCode: String) {
        val satpamAction = intent.getStringExtra(EXTRA_SATPAM_ACTION) ?: "CHECKOUT"
        tvStatusText.text = if (satpamAction == "RETURN") "🛡️ Memverifikasi Siswa Kembali Masuk..." else "🛡️ Memverifikasi Gatepass Keluar Siswa..."
        val req = com.school.smartcbt.data.model.SatpamCheckoutRequest(
            checkoutToken = scannedCode,
            qrPayload = scannedCode,
            action = satpamAction
        )
        ApiClient.getClient(this).verifyGatepassBySatpam(req).enqueue(object : Callback<com.school.smartcbt.data.model.SatpamCheckoutResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.SatpamCheckoutResponse>,
                response: Response<com.school.smartcbt.data.model.SatpamCheckoutResponse>
            ) {
                val body = response.body()
                val isSuccess = response.isSuccessful && body?.success == true
                val gp = body?.data
                val studentInfo = if (gp?.student != null) "\n\n👤 Siswa: ${gp.student.name ?: "-"} (${gp.student.className ?: "-"})\n🏷️ Kategori: ${gp.leaveCategory ?: "-"}\n💬 Alasan: ${gp.reason ?: "-"}" else ""
                val errMsg = if (!isSuccess) {
                    try {
                        val rawErr = response.errorBody()?.string() ?: ""
                        org.json.JSONObject(rawErr).optString("message", body?.message ?: "Tiket tidak valid atau sudah kedaluwarsa.")
                    } catch (e: Exception) {
                        body?.message ?: "Tiket tidak valid atau sudah kedaluwarsa."
                    }
                } else ""

                val timeNow = SimpleDateFormat("HH:mm:ss", Locale("id", "ID")).format(Date()) + " WIB"
                setResult(RESULT_OK)
                showModernScanDialog(
                    isSuccess = isSuccess,
                    title = if (isSuccess) {
                        if (body?.action == "RETURN" || satpamAction == "RETURN") "✅ SISWA KEMBALI MASUK" else "✅ IZIN KELUAR SAH (SATPAM)"
                    } else "⛔ GATEPASS DITOLAK",
                    subtitle = if (isSuccess) {
                        if (body?.action == "RETURN" || satpamAction == "RETURN") "Tercatat Kembali Masuk Kampus" else "Siswa Diizinkan Melewati Gerbang"
                    } else "Verifikasi Pos Keamanan Gagal",
                    message = (if (isSuccess) (body?.message ?: "Gatepass berhasil diverifikasi.") else errMsg) + studentInfo,
                    gateType = if (satpamAction == "RETURN") "RETURN (Kembali Masuk)" else "CHECKOUT (Gatepass Keluar)",
                    timeStr = timeNow
                )
            }
            override fun onFailure(call: Call<com.school.smartcbt.data.model.SatpamCheckoutResponse>, t: Throwable) {
                Toast.makeText(this@ScannerActivity, "Gagal terhubung ke pos satpam: ${t.message}", Toast.LENGTH_SHORT).show()
                isProcessingScan = false
            }
        })
    }

    private fun handleBookAuditScan(barcode: String) {
        tvStatusText.text = "🔍 Memeriksa status kepemilikan buku: $barcode..."
        ApiClient.getClient(this).checkBookOwnerByBarcode(barcode).enqueue(object : Callback<com.school.smartcbt.data.model.BookOwnerCheckResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.BookOwnerCheckResponse>,
                response: Response<com.school.smartcbt.data.model.BookOwnerCheckResponse>
            ) {
                if (isFinishing || isDestroyed) return
                try {
                    val data = response.body()
                    if (response.isSuccessful && data != null && data.success) {
                        val bookTitle = data.book?.title ?: "Buku Paket"
                        val copyCode = data.copy?.copyBarcode ?: barcode
                        val isMyBook = data.isMyBook

                        if (isMyBook) {
                            AlertDialog.Builder(this@ScannerActivity)
                                .setTitle("✅ BUKU PAKET ANDA")
                                .setMessage("Buku ini memang terdaftar resmi atas nama Anda!\n\n📘 Judul: $bookTitle\n🏷️ Barcode: $copyCode\nStatus: Terverifikasi (Tidak Tertukar).")
                                .setPositiveButton("Selesai") { _, _ -> finish() }
                                .setNeutralButton("Scan Buku Lain") { _, _ ->
                                    isProcessingScan = false
                                    tvStatusText.text = "Arahkan kamera ke Barcode buku berikutnya..."
                                }
                                .setCancelable(false)
                                .show()
                        } else {
                            val borrowerName = data.borrower?.name ?: "Siswa Lain"
                            val borrowerClass = data.borrower?.className ?: "-"
                            AlertDialog.Builder(this@ScannerActivity)
                                .setTitle("⚠️ BUKU PAKET TERTUKAR!")
                                .setMessage("Perhatian! Buku yang Anda bawa BUKAN milik Anda!\n\n📘 Judul: $bookTitle\n🏷️ Barcode: $copyCode\n\n👤 Peminjam Asli Tercatat:\n• Nama : $borrowerName\n• Kelas: $borrowerClass\n\nHarap tukarkan kembali dengan pemilik asli atau laporkan ke Petugas Perpustakaan/Operator untuk mutasi data.")
                                .setPositiveButton("Saya Mengerti") { _, _ -> finish() }
                                .setNeutralButton("Scan Lagi") { _, _ ->
                                    isProcessingScan = false
                                    tvStatusText.text = "Arahkan kamera ke Barcode buku lainnya..."
                                }
                                .setCancelable(false)
                                .show()
                        }
                    } else {
                        val msg = data?.message ?: "Barcode $barcode tidak ditemukan dalam katalog perpustakaan sekolah."
                        AlertDialog.Builder(this@ScannerActivity)
                            .setTitle("❓ Barcode Tidak Dikenali")
                            .setMessage(msg)
                            .setPositiveButton("Scan Ulang") { _, _ ->
                                isProcessingScan = false
                                tvStatusText.text = "Arahkan kamera ke Barcode buku..."
                            }
                            .setNegativeButton("Tutup") { _, _ -> finish() }
                            .show()
                    }
                } catch (e: Exception) {
                    android.util.Log.e("ScannerActivity", "Gagal menampilkan dialog buku: ${e.message}")
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.BookOwnerCheckResponse>, t: Throwable) {
                Toast.makeText(this@ScannerActivity, "Gagal terhubung ke server: ${t.message}", Toast.LENGTH_SHORT).show()
                isProcessingScan = false
            }
        })
    }

    private fun handlePrayerScan(scannedCode: String) {
        tvStatusText.text = "🕌 Memproses Presensi Sholat Masjid..."
        val (lat, lng, isMock, accuracy) = getCurrentLocation()

        if (isMock) {
            val timeNow = SimpleDateFormat("HH:mm:ss", Locale("id", "ID")).format(Date()) + " WIB"
            showModernScanDialog(
                isSuccess = false,
                title = "🚨 Terdeteksi Fake GPS!",
                subtitle = "Manipulasi Lokasi Palsu Ditolak Sistem",
                message = "Aplikasi mendeteksi penggunaan Fake GPS / Mock Location pada perangkat Anda. Presensi Sholat DITOLAK demi integritas kedisiplinan sekolah!",
                gateType = "Lokasi Tidak Sah",
                timeStr = timeNow,
                lat = lat,
                lng = lng
            )
            return
        }

        if (accuracy > 15.0f) {
            val timeNow = SimpleDateFormat("HH:mm:ss", Locale("id", "ID")).format(Date()) + " WIB"
            showModernScanDialog(
                isSuccess = false,
                title = "⚠️ Sinyal Satelit Belum Presisi!",
                subtitle = "Akurasi Wajib ≤ 15 Meter",
                message = "Akurasi GPS saat ini ±${accuracy.toInt()} meter (melebihi batas maksimal 15 meter). Harap tunggu sinyal satelit terkunci presisi di area mushola sekolah.",
                gateType = "Akurasi ±${accuracy.toInt()}m (Belum Sah)",
                timeStr = timeNow,
                lat = lat,
                lng = lng
            )
            return
        }

        val prayerStatus = intent.getStringExtra(EXTRA_PRAYER_STATUS) ?: "HADIR"
        val isBerhalangan = prayerStatus == "BERHALANGAN_HAID"
        val prayerType = intent.getStringExtra(EXTRA_PRAYER_TYPE) ?: intent.getStringExtra("EXTRA_PRAYER_TYPE") ?: "DHUHUR"

        val body = mutableMapOf(
            "barcodeData" to scannedCode,
            "prayerType" to prayerType,
            "status" to prayerStatus
        )
        if (isBerhalangan) {
            body["note"] = "Berhalangan / Uzur Syar'i (Keputrian)"
        }
        if (lat != null && lng != null) {
            body["lat"] = lat.toString()
            body["lng"] = lng.toString()
        }
        if (isMock) {
            body["isFakeGps"] = "true"
        }

        ApiClient.getClient(this).studentScanPrayerBarcode(body).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                val data = response.body()
                val timeNow = SimpleDateFormat("HH:mm:ss", Locale("id", "ID")).format(Date()) + " WIB"
                if (response.isSuccessful && data != null && data.success == true) {
                    val successTitle = if (isBerhalangan) "🌸 Presensi Uzur Syar'i Tercatat!" else "🕌 Presensi Sholat Berhasil!"
                    val successSub = if (isBerhalangan) "Siswi Putri Berhalangan (Keputrian) • Mushola" else "Titik Presensi: Mushola SMPN 1 Boyolangu"
                    val successMsg = data.message ?: if (isBerhalangan) "Presensi uzur syar'i siswi putri di mushola telah dicatat resmi." else "Alhamdulillah, presensi sholat berjamaah di mushola berhasil dicatat."
                    showModernScanDialog(
                        isSuccess = true,
                        title = successTitle,
                        subtitle = successSub,
                        message = successMsg,
                        gateType = if (isBerhalangan) "Berhalangan (Haid)" else "Sholat Mushola",
                        timeStr = timeNow,
                        lat = lat,
                        lng = lng
                    )
                } else {
                    val err = data?.message ?: response.errorBody()?.string() ?: "Gagal memproses presensi sholat"
                    val cleanMsg = try {
                        org.json.JSONObject(err).optString("message", err)
                    } catch (e: Exception) { err }
                    val finalMsg = if (cleanMsg.contains("haid", ignoreCase = true) || cleanMsg.contains("halangan", ignoreCase = true)) {
                        cleanMsg
                    } else {
                        "$cleanMsg\n\n🌸 Catatan: Siswi perempuan yang berhalangan (haid) wajib melapor langsung ke Guru PAI kelas Anda untuk didata absen halangan resmi."
                    }
                    showModernScanDialog(
                        isSuccess = false,
                        title = "⚠️ Presensi Sholat Ditolak",
                        subtitle = "Jadwal Resmi Admin / Guru PAI (Bukan 24 Jam)",
                        message = finalMsg,
                        gateType = "Titik Mushola",
                        timeStr = timeNow,
                        lat = lat,
                        lng = lng
                    )
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@ScannerActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
                isProcessingScan = false
            }
        })
    }

    private fun handlePaiStudentCardScan(scannedCode: String) {
        val prayerType = intent.getStringExtra("EXTRA_PRAYER_TYPE") ?: "DHUHUR"
        val payload = mapOf(
            "barcode" to scannedCode.trim(),
            "prayerType" to prayerType,
            "status" to "SHOLAT_BERJAMAAH"
        )
        val progress = android.app.ProgressDialog(this).apply {
            setMessage("Memverifikasi kartu siswa & sinkronisasi Gate In/Out...")
            setCancelable(false)
            show()
        }
        ApiClient.getClient(this).paiScanStudentCard(payload).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                progress.dismiss()
                if (response.isSuccessful && response.body()?.success == true) {
                    val msg = response.body()?.message ?: "Kehadiran sholat & gate sekolah siswa berhasil dicatat!"
                    AlertDialog.Builder(this@ScannerActivity)
                        .setTitle("✅ Presensi Kartu Siswa Berhasil")
                        .setMessage(msg)
                        .setPositiveButton("Scan Siswa Lain") { _, _ ->
                            isProcessingScan = false
                            tvStatusText.text = "Arahkan kamera ke barcode kartu siswa berikutnya..."
                        }
                        .setNegativeButton("Selesai") { _, _ ->
                            setResult(RESULT_OK)
                            finish()
                        }
                        .setCancelable(false)
                        .show()
                } else {
                    val rawErr = try {
                        val str = response.errorBody()?.string() ?: ""
                        if (str.isNotBlank()) org.json.JSONObject(str).optString("message", str) else response.body()?.message ?: "Gagal memproses kartu siswa"
                    } catch (e: Exception) {
                        response.body()?.message ?: "Gagal memproses kartu siswa"
                    }
                    AlertDialog.Builder(this@ScannerActivity)
                        .setTitle("❌ Gagal Scan Kartu")
                        .setMessage(rawErr)
                        .setPositiveButton("Coba Lagi") { _, _ ->
                            isProcessingScan = false
                            tvStatusText.text = "Arahkan kamera ke Barcode / QR Kartu Pelajar..."
                        }
                        .setNegativeButton("Tutup") { _, _ ->
                            finish()
                        }
                        .setCancelable(false)
                        .show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                progress.dismiss()
                AlertDialog.Builder(this@ScannerActivity)
                    .setTitle("⚠️ Masalah Jaringan")
                    .setMessage(t.message ?: "Koneksi terputus")
                    .setPositiveButton("Coba Lagi") { _, _ ->
                        isProcessingScan = false
                    }
                    .setCancelable(false)
                    .show()
            }
        })
    }

    override fun onResume() {
        super.onResume()
        startLocationUpdates()
        if (com.school.smartcbt.utils.AttendanceOfflineManager.isOnline(this)) {
            com.school.smartcbt.utils.AttendanceOfflineManager.syncPendingAttendances(this) { synced, _ ->
                if (synced > 0) {
                    runOnUiThread {
                        android.widget.Toast.makeText(this@ScannerActivity, "✅ $synced presensi darurat offline berhasil disinkronkan ke server sekolah!", android.widget.Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        stopLocationUpdates()
    }

    private fun fetchServerAttendanceConfig() {
        ApiClient.getClient(this).getAttendanceConfig().enqueue(object : Callback<com.google.gson.JsonObject> {
            override fun onResponse(call: Call<com.google.gson.JsonObject>, response: Response<com.google.gson.JsonObject>) {
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    isScannerGeolocationActive = body.get("scannerGeolocationEnabled")?.asBoolean ?: true
                    val school = body.getAsJsonObject("school")
                    if (school != null) {
                        schoolLat = school.get("lat")?.asDouble ?: -8.125506
                        schoolLng = school.get("lng")?.asDouble ?: 111.893526
                        radiusGlobal = school.get("radiusMeters")?.asInt ?: 150
                    }
                    val thresholds = body.getAsJsonObject("gpsThresholds")
                    if (thresholds != null) {
                        zoneGoodThreshold = thresholds.get("zoneGood")?.asFloat ?: 50.0f
                        zoneDegradedThreshold = thresholds.get("zoneDegraded")?.asFloat ?: 100.0f
                        countdownSeconds = thresholds.get("countdownSeconds")?.asInt ?: 60
                    }

                    runOnUiThread {
                        if (!isScannerGeolocationActive) {
                            stopLocationUpdates()
                            layoutLiveGpsBadge?.visibility = View.GONE
                            tvGpsAccuracySub?.visibility = View.GONE
                            tvStatusText.text = "📷 Mode QR-Only Murni: Scan QR Code di pintu/ruang kelas Anda"
                            tvStatusText.setTextColor(Color.parseColor("#38BDF8"))
                        }
                    }
                }
            }
            override fun onFailure(call: Call<com.google.gson.JsonObject>, t: Throwable) {}
        })
    }

    private fun startGpsCountdown() {
        if (!isScannerGeolocationActive) return
        countdownTimer?.cancel()
        countdownTimer = object : android.os.CountDownTimer((countdownSeconds * 1000).toLong(), 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val sec = millisUntilFinished / 1000
                if (liveBestLocation == null || (liveBestLocation?.accuracy ?: 999f) > zoneGoodThreshold) {
                    tvGpsAccuracySub?.text = "Mengoptimalkan sensor lokasi... ($sec dtk)"
                }
            }

            override fun onFinish() {
                if (liveBestLocation == null || (liveBestLocation?.accuracy ?: 999f) > zoneGoodThreshold) {
                    tvStatusText.text = "📷 Arahkan kamera ke Barcode Presensi Kelas"
                    tvStatusText.setTextColor(Color.parseColor("#38BDF8"))
                    tvGpsAccuracySub?.text = "💡 Sistem otomatis memverifikasi lokasi & barcode kelas"
                }
            }
        }.start()
    }


    private fun startLocationUpdates() {
        if (!isScannerGeolocationActive) return

        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        try {
            // HANYA daftarkan GPS_PROVIDER (satelit hardware)
            // JANGAN daftarkan NETWORK_PROVIDER agar tidak menggunakan koordinat BTS seluler berjarak 3km!
            if (locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true) {
                locationManager?.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    1000L,
                    0.5f,
                    liveLocationListener
                )
            }

            val lastGps = locationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            if (lastGps != null && (System.currentTimeMillis() - lastGps.time < 60_000)) {
                liveBestLocation = lastGps
                updateGpsIndicatorUI(lastGps)
            } else {
                updateGpsIndicatorUI(null)
            }

            startGpsCountdown()
        } catch (e: SecurityException) {
            e.printStackTrace()
        }
    }

    private fun stopLocationUpdates() {
        try {
            countdownTimer?.cancel()
            locationManager?.removeUpdates(liveLocationListener)
        } catch (e: Exception) {}
    }

    private fun updateGpsIndicatorUI(loc: Location?) {
        if (currentScanMode == MODE_BOOK_AUDIT) return
        if (!isScannerGeolocationActive) {
            layoutLiveGpsBadge?.visibility = View.GONE
            tvGpsAccuracySub?.visibility = View.GONE
            return
        }

        if (loc != null) {
            val dist = FloatArray(1)
            Location.distanceBetween(loc.latitude, loc.longitude, schoolLat, schoolLng, dist)
            val distMeters = dist[0].toInt()
            val acc = loc.accuracy.toInt()

            val coordStr = String.format(Locale.US, "%.6f, %.6f", loc.latitude, loc.longitude)
            tvLiveGpsCoords?.text = "📍 $coordStr"
            layoutLiveGpsBadge?.visibility = View.VISIBLE

            if (acc <= zoneGoodThreshold.toInt()) {
                tvGpsAccuracySub?.text = "Akurasi: ±${acc}m (Presisi Baik ≤ ${zoneGoodThreshold.toInt()}m) • Jarak: ${distMeters}m"
                tvGpsAccuracySub?.setTextColor(Color.parseColor("#10B981"))
                tvStatusText.text = "🟢 GPS Satelit Terkunci: $coordStr (±${acc}m)"
                tvStatusText.setTextColor(Color.parseColor("#10B981"))
            } else if (acc <= zoneDegradedThreshold.toInt()) {
                tvGpsAccuracySub?.text = "Akurasi: ±${acc}m (Terdegradasi tapi Diterima) • Jarak: ${distMeters}m"
                tvGpsAccuracySub?.setTextColor(Color.parseColor("#F59E0B"))
                tvStatusText.text = "🟡 GPS Cukup: ±${acc}m (Bisa Memindai Barcode)"
                tvStatusText.setTextColor(Color.parseColor("#F59E0B"))
            } else {
                tvGpsAccuracySub?.text = "Akurasi: ±${acc}m (Satelit Lemah > ${zoneDegradedThreshold.toInt()}m) • Jarak: ${distMeters}m"
                tvGpsAccuracySub?.setTextColor(Color.parseColor("#EF4444"))
                tvStatusText.text = "⚠️ Akurasi Rendah (±${acc}m). Disarankan Scan QR Kelas."
                tvStatusText.setTextColor(Color.parseColor("#EF4444"))
            }
        } else {
            tvLiveGpsCoords?.text = "📍 Mencari Sinyal Satelit GPS..."
            tvGpsAccuracySub?.text = "Mengunci koordinat satelit HP (Wajib ≤ ${zoneGoodThreshold.toInt()}m)..."
            tvGpsAccuracySub?.setTextColor(Color.parseColor("#F59E0B"))
            tvStatusText.text = "🟡 Mengunci Sinyal Satelit GPS HP..."
            tvStatusText.setTextColor(Color.parseColor("#FBBF24"))
        }
    }

    private fun getCurrentLocation(): LocationResult {
        if (!isScannerGeolocationActive) {
            return LocationResult(null, null, false, 0f)
        }

        var loc = liveBestLocation

        if (loc == null && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            val lastGps = locationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            // Hanya gunakan jika satelit hardware valid & masih segar (< 60 detik)
            if (lastGps != null && (System.currentTimeMillis() - lastGps.time < 60_000)) {
                loc = lastGps
            }
        }

        if (loc != null) {
            val isMockLoc = com.school.smartcbt.utils.GpsUtils.isFakeGps(this, loc)
            val actualLat = loc.latitude
            val actualLng = loc.longitude
            val accuracy = loc.accuracy
            val coordStr = String.format(Locale.US, "%.6f, %.6f", actualLat, actualLng)

            runOnUiThread {
                tvLiveGpsCoords?.text = "📍 $coordStr"
                if (accuracy <= zoneGoodThreshold) {
                    tvStatusText.text = "🟢 GPS HP Presisi: $coordStr (±${accuracy.toInt()}m)"
                    tvStatusText.setTextColor(Color.parseColor("#10B981"))
                } else if (accuracy <= zoneDegradedThreshold) {
                    tvStatusText.text = "🟡 GPS Terdegradasi: ±${accuracy.toInt()}m (Masih Sah)"
                    tvStatusText.setTextColor(Color.parseColor("#F59E0B"))
                } else {
                    tvStatusText.text = "⚠️ Satelit Lemah (±${accuracy.toInt()}m). Gunakan QR Kelas."
                    tvStatusText.setTextColor(Color.parseColor("#EF4444"))
                }
            }

            return LocationResult(actualLat, actualLng, isMockLoc, accuracy)
        }

        return LocationResult(null, null, false, 999.0f)
    }

    private fun vibratePhone() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator?.vibrate(
                    android.os.VibrationEffect.createOneShot(150, android.os.VibrationEffect.DEFAULT_AMPLITUDE)
                )
            } else {
                @Suppress("DEPRECATION")
                val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                @Suppress("DEPRECATION")
                v?.vibrate(150)
            }
        } catch (e: Exception) {
            // Safe fallback
        }
    }

    private fun validateAndSaveOffline(
        req: GateScanRequest,
        isGateOut: Boolean,
        gateText: String,
        timeNow: String,
        lat: Double?,
        lng: Double?,
        accuracy: Float?,
        isFakeGps: Boolean
    ) {
        // 1. Cek Anti-Fake GPS
        if (isFakeGps) {
            showModernScanDialog(
                isSuccess = false,
                title = "🚨 Terdeteksi Fake GPS!",
                subtitle = "Presensi Ditolak Sistem",
                message = "Manipulasi lokasi palsu (Mock Location) terdeteksi. Presensi offline DITOLAK demi kedisiplinan sekolah. Silakan matikan Fake GPS dan gunakan lokasi nyata!",
                gateType = "Fake GPS Ditolak",
                timeStr = timeNow,
                lat = lat,
                lng = lng
            )
            return
        }

        // 2. Kunci Koordinat Satelit GPS (Wajib Terkunci di Lingkungan Sekolah)
        if (lat == null || lng == null) {
            showModernScanDialog(
                isSuccess = false,
                title = "❌ GPS Satelit Belum Terkunci",
                subtitle = "Presensi Offline Memerlukan Sinyal Satelit GPS",
                message = "Perangkat Anda sedang offline atau koneksi server terputus. Untuk mencegah kecurangan di luar sekolah, presensi offline WAJIB mengunci satelit GPS nyata di lingkungan sekolah.\n\nSilakan tunggu sinyal GPS mengunci posisi Anda sebelum memindai barcode.",
                gateType = "Lokasi Tidak Terverifikasi",
                timeStr = timeNow,
                lat = null,
                lng = null
            )
            return
        }

        // 3. Validasi Geofence Radius Sekolah
        val distResults = FloatArray(1)
        Location.distanceBetween(lat, lng, schoolLat, schoolLng, distResults)
        val distToSchoolMeters = distResults[0].toInt()
        val maxAllowedRadius = (radiusGlobal + (accuracy ?: 20f)).toInt()

        if (distToSchoolMeters > maxAllowedRadius) {
            showModernScanDialog(
                isSuccess = false,
                title = "❌ Di Luar Area Sekolah!",
                subtitle = "Jarak Terlalu Jauh (${distToSchoolMeters}m)",
                message = "Presensi offline DITOLAK karena Anda terdeteksi berada di luar area SMP Negeri 1 Boyolangu (Jarak: $distToSchoolMeters meter, batas: ${maxAllowedRadius}m).\n\nPresensi sah HANYA dapat dilakukan saat Anda sudah berada secara fisik di area SMP Negeri 1 Boyolangu.",
                gateType = "Di Luar Radius Sekolah",
                timeStr = timeNow,
                lat = lat,
                lng = lng
            )
            return
        }

        // 4. Lolos Validasi -> Simpan ke Antrian Room Database Lokal HP
        com.school.smartcbt.utils.OfflineAttendanceManager.savePendingScan(this, req)

        // Simpan ke Cache Lokal agar Tampilan Beranda Langsung Berubah Seketika (hanya jika waktu operasional wajar)
        val calHour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        if (!isGateOut || calHour >= 10) {
            val cacheStatus = if (isGateOut) "PULANG" else "HADIR"
            sessionManager.saveTodayGateAttendance(
                type = if (isGateOut) "GATE_OUT" else "GATE_IN",
                timeWib = timeNow,
                status = cacheStatus
            )
        }

        val titleText = if (isGateOut) "✅ Presensi Pulang Tercatat di HP" else "⏳ Presensi Masuk Tersimpan di HP"
        val msgText = if (isGateOut) {
            "Silakan langsung pulang ke rumah. Koordinat GPS sekolah terverifikasi sah (Jarak: ${distToSchoolMeters}m) dan data otomatis dikirim saat online."
        } else {
            "Presensi masuk telah diamankan di HP (Koordinat GPS sekolah terverifikasi sah, Jarak: ${distToSchoolMeters}m) dan otomatis disinkronkan ke server sekolah."
        }

        showModernScanDialog(
            isSuccess = true,
            title = titleText,
            subtitle = "Tersimpan Sah di Database HP (GPS: ${distToSchoolMeters}m)",
            message = msgText,
            gateType = gateText,
            timeStr = timeNow,
            lat = lat,
            lng = lng
        )
    }

    private fun submitAttendance(
        code: String,
        lat: Double?,
        lng: Double?,
        isFakeGps: Boolean,
        method: String = "GPS",
        accuracy: Float? = null,
        isSpecialCheckoutWithoutIn: Boolean = false
    ) {
        val sNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }
        val gateActionExtra = intent.getStringExtra("EXTRA_GATE_ACTION")
        val isGateOut = (gateActionExtra == "GATE_OUT") || (gateActionExtra != "GATE_IN" && (code.contains("OUT", true) || code.contains("PULANG", true)))
        val gateText = if (isGateOut) "Gate-Out (Kepulangan)" else "Gate-In (Masuk)"
        val timeNow = SimpleDateFormat("HH:mm:ss", Locale("id", "ID")).format(Date()) + " WIB"

        val clientTimeMillis = System.currentTimeMillis()
        val req = GateScanRequest(
            gateCode = code,
            barcodeCode = code,
            nisn = sNisn,
            studentIdentifier = sNisn,
            lat = lat,
            lng = lng,
            isFakeGps = isFakeGps,
            method = method,
            accuracy = accuracy,
            deviceTime = timeNow,
            isSpecialCheckoutWithoutIn = isSpecialCheckoutWithoutIn,
            clientScanTime = clientTimeMillis
        )

        // CEK KONEKSI: Siswa WAJIB online saat presensi. Mode offline dinonaktifkan.
        if (!com.school.smartcbt.utils.AttendanceOfflineManager.isOnline(this)) {
            com.school.smartcbt.utils.TtsVoiceHelper.playBeepError()
            com.school.smartcbt.utils.TtsVoiceHelper.speak("Presensi gagal. Tidak ada koneksi internet. Silakan hubungkan ke WiFi sekolah atau aktifkan paket data.")
            showModernScanDialog(
                isSuccess = false,
                title = "❌ Presensi Memerlukan Internet",
                subtitle = "Tidak Ada Koneksi Internet",
                message = "Presensi kehadiran memerlukan koneksi internet aktif agar langsung tercatat resmi di server sekolah.\n\n📌 Langkah Penyelesaian:\n1. Hubungkan HP ke WiFi Sekolah (SMBOY) yang tersedia di area kelas.\n2. Atau aktifkan Paket Data Seluler Anda.\n3. Buka kembali pemindai lalu scan barcode presensi kelas.\n\n💡 Alternatif: Jika HP Anda terkendala jaringan, minta bantuan presensi ke Pengurus Kelas atau melapor ke Guru Piket.",
                gateType = gateText,
                timeStr = timeNow,
                lat = lat,
                lng = lng
            )
            return
        }

        ApiClient.getClient(this).scanGateAttendance(req)
            .enqueue(object : Callback<BasicResponse> {
                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                    val sName = sessionManager.getName().ifEmpty { "Siswa" }
                    val sClass = sessionManager.getClassName().ifEmpty { "VII-A" }

                    if (response.isSuccessful) {
                        val msg = response.body()?.message ?: "Presensi Berhasil Dicatat!"
                        com.school.smartcbt.utils.ClientLogger.logAttendance(
                            context = this@ScannerActivity,
                            action = if (isGateOut) "SCAN_GATE_OUT" else "SCAN_GATE_IN",
                            outcome = "SUCCESS",
                            message = msg,
                            barcode = code,
                            lat = lat,
                            lng = lng,
                            extra = mapOf("method" to req.method, "isFakeGps" to isFakeGps, "accuracy" to accuracy)
                        )

                        NotificationHelper.showHeadsUpNotification(
                            this@ScannerActivity,
                            "✅ Presensi Berhasil Dicatat!",
                            "$sName (Kelas $sClass) berhasil scan barcode: $msg",
                            "Presensi SMPN 1 Boyolangu"
                        )

                        if (req.method == "QR_DYNAMIC_OFFICER") {
                            com.school.smartcbt.utils.TtsVoiceHelper.speak("Presensi berhasil melalui QR Dinamis Pengurus Kelas.")
                        }

                        // Simpan ke Cache Lokal agar Beranda Siswa Langsung Terupdate Seketika
                        sessionManager.saveTodayGateAttendance(
                            type = if (isGateOut) "GATE_OUT" else "GATE_IN",
                            timeWib = timeNow,
                            status = if (isGateOut) "PULANG" else "HADIR"
                        )

                        showModernScanDialog(
                            isSuccess = true,
                            title = "✅ Presensi Berhasil!",
                            subtitle = "Presensi $gateText Berhasil Diverifikasi",
                            message = msg,
                            gateType = gateText,
                            timeStr = timeNow,
                            lat = lat,
                            lng = lng
                        )
                    } else {
                        if (isGateOut) {
                            sessionManager.clearTodayGateOutCache()
                        }
                        val statusCode = response.code()
                        val rawErr = response.errorBody()?.string() ?: ""

                        // Khusus Deteksi Error 530 Cloudflare / Tunnel Terputus akibat Listrik Padam
                        val is530OrTunnelError = statusCode == 530 || statusCode == 502 || statusCode == 504 || statusCode in 520..530 ||
                                rawErr.contains("530", ignoreCase = true) ||
                                rawErr.contains("Cloudflare", ignoreCase = true) ||
                                rawErr.contains("Origin DNS", ignoreCase = true)

                        if (is530OrTunnelError) {
                            com.school.smartcbt.utils.ClientLogger.logAttendance(
                                context = this@ScannerActivity,
                                action = if (isGateOut) "SCAN_GATE_OUT" else "SCAN_GATE_IN",
                                outcome = "BUFFERED_530_OFFLINE",
                                message = "Server/Tunnel offline (Kode $statusCode / Error 530 pemadaman listrik). Presensi diamankan ke database lokal HP.",
                                barcode = code,
                                lat = lat,
                                lng = lng,
                                extra = mapOf("method" to req.method, "statusCode" to statusCode, "error530" to true)
                            )

                            // Simpan ke antrean lokal Room DB
                            val studentIdent = sessionManager.getUserId().ifEmpty { sessionManager.getUsername() }
                            com.school.smartcbt.utils.AttendanceOfflineManager.saveOffline(
                                context = this@ScannerActivity,
                                identifier = studentIdent,
                                barcodeCode = code,
                                scanType = if (isGateOut) "GATE_OUT" else "GATE_IN",
                                method = req.method ?: "QR_GATE",
                                lat = lat,
                                lng = lng,
                                accuracy = accuracy,
                                isFakeGps = isFakeGps,
                                deviceTime = timeNow,
                                note = "CLOUDFLARE_530_OUTAGE"
                            )

                            // Simpan ke Cache Lokal agar Beranda Siswa Langsung Terupdate Seketika
                            sessionManager.saveTodayGateAttendance(
                                type = if (isGateOut) "GATE_OUT" else "GATE_IN",
                                timeWib = timeNow,
                                status = if (isGateOut) "PULANG" else "HADIR"
                            )

                            com.school.smartcbt.utils.TtsVoiceHelper.playBeepSuccess()
                            com.school.smartcbt.utils.TtsVoiceHelper.speak("Server sekolah offline karena kendala listrik. Presensi Anda berhasil diamankan di HP dan otomatis disinkronkan.")

                            NotificationHelper.showHeadsUpNotification(
                                this@ScannerActivity,
                                "💾 Presensi Diamankan di HP (Server Offline)",
                                "$sName (Kelas $sClass) presensi berhasil disimpan di penyimpanan internal HP karena server sekolah offline.",
                                "Presensi SMPN 1 Boyolangu"
                            )

                            showModernScanDialog(
                                isSuccess = true,
                                title = "💾 Presensi Diamankan di HP!",
                                subtitle = "Server Offline (Error 530 / Listrik Padam)",
                                message = "✅ Anda tidak perlu khawatir!\nPresensi $gateText Anda tercatat pukul $timeNow dan tersimpan aman di memori HP Anda.\n\nAlasan: Server sekolah offline sementara (Error 530 Cloudflare / Pemadaman Listrik).\n\n💡 Catatan:\nData ini akan otomatis disinkronkan ke server sekolah saat listrik menyala kembali. Anda tidak perlu mengulang scan barcode.",
                                gateType = "$gateText (Offline Buffer)",
                                timeStr = timeNow,
                                lat = lat,
                                lng = lng
                            )
                            return
                        }

                        // Jika server mengalami gangguan/down lainnya (500)
                        if (statusCode >= 500) {
                            com.school.smartcbt.utils.ClientLogger.logAttendance(
                                context = this@ScannerActivity,
                                action = if (isGateOut) "SCAN_GATE_OUT" else "SCAN_GATE_IN",
                                outcome = "ERROR",
                                message = "Server error $statusCode: $rawErr",
                                barcode = code,
                                lat = lat,
                                lng = lng
                            )
                            com.school.smartcbt.utils.TtsVoiceHelper.playBeepError()
                            com.school.smartcbt.utils.TtsVoiceHelper.speak("Presensi gagal. Gangguan server sekolah.")
                            showModernScanDialog(
                                isSuccess = false,
                                title = "❌ Gangguan Server",
                                subtitle = "Server Sedang Sibuk (Kode $statusCode)",
                                message = "Server presensi sekolah sedang memproses antrean padat. Silakan pastikan koneksi stabil lalu ulangi pemindaian barcode.",
                                gateType = gateText,
                                timeStr = timeNow,
                                lat = lat,
                                lng = lng
                            )
                            return
                        }

                        var userMsg = "Presensi Ditolak Server"
                        var isWarningYellow = false
                        try {
                            val json = org.json.JSONObject(rawErr)
                            if (json.has("message")) {
                                userMsg = json.getString("message")
                            }
                            if (json.optBoolean("isWarningYellow", false) || 
                                json.optBoolean("notScannedIn", false) ||
                                json.optBoolean("isGateOutInMorning", false)) {
                                isWarningYellow = true
                            }
                        } catch (e: Exception) {
                            if (rawErr.isNotEmpty()) userMsg = rawErr
                        }

                        if (userMsg.contains("belum tercatat", ignoreCase = true) ||
                            userMsg.contains("belum scan masuk", ignoreCase = true) ||
                            userMsg.contains("Memindai Barcode Kepulangan", ignoreCase = true) ||
                            userMsg.contains("gate-in", ignoreCase = true)) {
                            isWarningYellow = true
                        }

                        com.school.smartcbt.utils.ClientLogger.logAttendance(
                            context = this@ScannerActivity,
                            action = if (isGateOut) "SCAN_GATE_OUT" else "SCAN_GATE_IN",
                            outcome = "REJECTED",
                            message = userMsg,
                            barcode = code,
                            lat = lat,
                            lng = lng,
                            extra = mapOf("statusCode" to statusCode, "isWarningYellow" to isWarningYellow, "accuracy" to accuracy)
                        )

                        val explanation = parseScanFailureExplanation(userMsg, code)
                        val formattedMsg = "📌 Keterangan:\n${explanation.reason}\n\n💡 Saran Tindakan:\n${explanation.suggestion}"

                        showModernScanDialog(
                            isSuccess = false,
                            title = explanation.title,
                            subtitle = explanation.subtitle,
                            message = formattedMsg,
                            gateType = if (isWarningYellow) "⚠️ GATE-OUT DITOLAK" else gateText,
                            timeStr = timeNow,
                            lat = lat,
                            lng = lng,
                            isWarningYellow = isWarningYellow,
                            scannedCode = code,
                            isFakeGps = isFakeGps,
                            accuracy = accuracy
                        )
                    }
                }

                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                    if (isGateOut) {
                        sessionManager.clearTodayGateOutCache()
                    }
                    val netMsg = t.message ?: "Koneksi terputus"
                    val isDnsOrOffline = netMsg.contains("Unable to resolve host", ignoreCase = true) ||
                            netMsg.contains("No address associated", ignoreCase = true) ||
                            netMsg.contains("Failed to connect", ignoreCase = true)

                    com.school.smartcbt.utils.ClientLogger.logAttendance(
                        context = this@ScannerActivity,
                        action = if (isGateOut) "SCAN_GATE_OUT" else "SCAN_GATE_IN",
                        outcome = "ERROR",
                        message = "Presensi terputus: $netMsg",
                        barcode = code,
                        lat = lat,
                        lng = lng
                    )
                    com.school.smartcbt.utils.TtsVoiceHelper.playBeepError()
                    com.school.smartcbt.utils.TtsVoiceHelper.speak("Presensi gagal. Server sekolah tidak terjangkau. Silakan hubungkan ke WiFi sekolah atau aktifkan paket data.")

                    val friendlySub = if (isDnsOrOffline) "Koneksi Internet Terputus (DNS Gagal)" else "Koneksi Terputus / Timeout"
                    val friendlyMsg = if (isDnsOrOffline) {
                        "HP Anda tidak dapat menjangkau server sekolah (sinyal seluler lemah atau kuota data tidak aktif).\n\n📌 Langkah Penyelesaian:\n1. Hubungkan HP ke WiFi Sekolah (SMBOY) yang tersedia di area kelas.\n2. Atau pastikan Paket Data Seluler Anda aktif dan memiliki kuota.\n3. Setelah terhubung, tekan tombol 'Scan Ulang' di bawah ini.\n\n💡 Alternatif: Jika internet HP tetap terkendala, Anda dapat meminta bantuan presensi ke Pengurus Kelas atau melapor ke Guru Piket."
                    } else {
                        "Gagal berkomunikasi dengan server presensi sekolah ($netMsg).\n\n📌 Langkah Penyelesaian:\n1. Pastikan koneksi internet (WiFi / Data Seluler) stabil.\n2. Tekan tombol 'Scan Ulang' untuk mencoba kembali.\n3. Jika kendala berlanjut, hubungi Pengurus Kelas atau Guru Piket."
                    }

                    showModernScanDialog(
                        isSuccess = false,
                        title = "❌ Presensi Gagal!",
                        subtitle = friendlySub,
                        message = friendlyMsg,
                        gateType = gateText,
                        timeStr = timeNow,
                        lat = lat,
                        lng = lng
                    )
                }
            })
    }

    private fun showModernScanDialog(
        isSuccess: Boolean,
        title: String,
        subtitle: String,
        message: String,
        gateType: String,
        timeStr: String,
        lat: Double? = null,
        lng: Double? = null,
        isWarningYellow: Boolean = false,
        scannedCode: String? = null,
        isFakeGps: Boolean = false,
        accuracy: Float? = null
    ) {
        if (isFinishing || isDestroyed) {
            return
        }

        val dialogView = layoutInflater.inflate(R.layout.dialog_scan_result, null)
        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .setCancelable(false)
            .create()

        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))

        val layoutHeaderBanner = dialogView.findViewById<LinearLayout>(R.id.layoutHeaderBanner)
        val tvScanResultIcon = dialogView.findViewById<TextView>(R.id.tvScanResultIcon)
        val tvScanResultTitle = dialogView.findViewById<TextView>(R.id.tvScanResultTitle)
        val tvScanResultSubtitle = dialogView.findViewById<TextView>(R.id.tvScanResultSubtitle)
        val ivStudentPhoto = dialogView.findViewById<ImageView>(R.id.ivStudentPhoto)
        val tvStudentAvatar = dialogView.findViewById<TextView>(R.id.tvStudentAvatar)
        val tvStudentName = dialogView.findViewById<TextView>(R.id.tvStudentName)
        val tvStudentClassNisn = dialogView.findViewById<TextView>(R.id.tvStudentClassNisn)
        val tvScanTime = dialogView.findViewById<TextView>(R.id.tvScanTime)
        
        val tvScanTypeLabel = dialogView.findViewById<TextView>(R.id.tvScanTypeLabel)
        val tvLocationVerified = dialogView.findViewById<TextView>(R.id.tvLocationVerified)
        val tvParentNotifDetail = dialogView.findViewById<TextView>(R.id.tvParentNotifDetail)
        val layoutDurationInfo = dialogView.findViewById<LinearLayout>(R.id.layoutDurationInfo)
        val tvDurationInfo = dialogView.findViewById<TextView>(R.id.tvDurationInfo)
        val layoutLateInfo = dialogView.findViewById<LinearLayout>(R.id.layoutLateInfo)
        val tvLateInfo = dialogView.findViewById<TextView>(R.id.tvLateInfo)
        
        val tvGateTypeBadge = dialogView.findViewById<TextView>(R.id.tvGateTypeBadge)
        val tvGpsStatus = dialogView.findViewById<TextView>(R.id.tvGpsStatus)
        val layoutParentNotifBadge = dialogView.findViewById<LinearLayout>(R.id.layoutParentNotifBadge)
        val tvParentNotifText = dialogView.findViewById<TextView>(R.id.tvParentNotifText)
        val tvScanResultMessage = dialogView.findViewById<TextView>(R.id.tvScanResultMessage)
        val btnSecondary = dialogView.findViewById<Button>(R.id.btnScanResultSecondary)
        val btnPrimary = dialogView.findViewById<Button>(R.id.btnScanResultPrimary)

        val sName = sessionManager.getName().ifEmpty { "Siswa" }
        val sClass = sessionManager.getClassName().ifEmpty { "VII-A" }
        val sNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }

        tvStudentName.text = sName
        tvStudentClassNisn.text = "Kelas $sClass • NISN: $sNisn"
        tvStudentAvatar.text = if (sName.isNotEmpty()) sName.take(1).uppercase() else "S"
        tvScanTime.text = timeStr
        tvGateTypeBadge?.text = gateType
        tvScanResultMessage.text = message

        if (lat != null && lng != null) {
            tvGpsStatus?.text = String.format(Locale.US, "%.6f, %.6f", lat, lng)
        } else {
            tvGpsStatus?.text = "-"
        }

        val picUrl = sessionManager.getProfilePicUrl()
        if (!picUrl.isNullOrEmpty() && ivStudentPhoto != null) {
            val baseServer = sessionManager.getServerIp().trimEnd('/')
            val fullUrl = if (picUrl.startsWith("http")) picUrl else "$baseServer${if (picUrl.startsWith("/")) "" else "/"}$picUrl"
            loadStudentPhotoAsync(fullUrl, ivStudentPhoto, tvStudentAvatar)
        } else {
            ivStudentPhoto?.setImageResource(R.drawable.ic_avatar_placeholder)
        }

        if (isSuccess) {
            try {
                com.school.smartcbt.utils.TtsVoiceHelper.playBeepSuccess()
            } catch (e: Exception) {}
            val isMushola = gateType.contains("mushola", ignoreCase = true) || gateType.contains("sholat", ignoreCase = true)
            val isMatpel = gateType.contains("matpel", ignoreCase = true) || gateType.contains("pelajaran", ignoreCase = true) || gateType.contains("kbm", ignoreCase = true)
            val isGateOut = gateType.contains("pulang", ignoreCase = true) || gateType.contains("out", ignoreCase = true)
            
            if (isMushola) {
                layoutHeaderBanner.setBackgroundResource(R.drawable.bg_mushola_header_gradient)
                tvScanResultIcon.text = "🕌"
                tvScanResultIcon.setTextColor(Color.parseColor("#059669"))
                tvScanResultTitle.text = "JAZAKALLAHU KHAIRAN 🕌"
                tvScanResultSubtitle.text = subtitle
                
                tvScanTypeLabel?.text = "PRESENSI MUSHOLA"
                tvLocationVerified?.text = "📍 Terverifikasi di Area Mushola Sekolah"
                
                tvGateTypeBadge?.text = "🕌 PRESENSI MUSHOLA"
                tvGateTypeBadge?.setBackgroundColor(Color.parseColor("#D1FAE5"))
                tvGateTypeBadge?.setTextColor(Color.parseColor("#065F46"))
                btnPrimary.setBackgroundColor(Color.parseColor("#059669"))
                btnPrimary.text = "Alhamdulillah, Selesai"
                layoutParentNotifBadge.visibility = View.VISIBLE
                tvParentNotifText.text = "🕌 Presensi Sholat Terhubung ke SIAKAD & Buku Pantau Ibadah"
                tvParentNotifDetail?.text = "$sName telah melaksanakan sholat dan tercatat di sistem pada $timeStr WIB"
            } else if (isMatpel) {
                layoutHeaderBanner.setBackgroundResource(R.drawable.bg_matpel_header_gradient)
                tvScanResultIcon.text = "📚"
                tvScanResultIcon.setTextColor(Color.parseColor("#4F46E5"))
                tvScanResultTitle.text = "PRESENSI KBM TERCATAT ✅"
                tvScanResultSubtitle.text = subtitle
                
                tvScanTypeLabel?.text = "PRESENSI MATA PELAJARAN (KBM)"
                tvLocationVerified?.text = "📍 Terverifikasi di Ruang Kelas"
                
                tvGateTypeBadge?.text = "🎯 PRESENSI MAPEL"
                tvGateTypeBadge?.setBackgroundColor(Color.parseColor("#EEF2FF"))
                tvGateTypeBadge?.setTextColor(Color.parseColor("#3730A3"))
                btnPrimary.setBackgroundColor(Color.parseColor("#4F46E5"))
                btnPrimary.text = "Alhamdulillah, Selesai"
                layoutParentNotifBadge.visibility = View.VISIBLE
                tvParentNotifText.text = "📚 Presensi Mata Pelajaran Terhubung Langsung ke Guru & Portal SIAKAD"
                tvParentNotifDetail?.text = "Kehadiran $sName di kelas tercatat pada $timeStr WIB"
            } else if (isGateOut) {
                layoutHeaderBanner.setBackgroundResource(R.drawable.bg_biodata_header_gradient)
                tvScanResultIcon.text = "🚪"
                tvScanResultIcon.setTextColor(Color.parseColor("#2563EB"))
                tvScanResultTitle.text = "SELAMAT JALAN, HATI-HATI! 🏠"
                tvScanResultSubtitle.text = subtitle
                
                tvScanTypeLabel?.text = "PRESENSI PULANG (GATE-OUT)"
                tvLocationVerified?.text = "📍 Terverifikasi di Area SMP Negeri 1 Boyolangu"
                
                btnPrimary.setBackgroundColor(Color.parseColor("#2563EB"))
                btnPrimary.text = "Selesai & Tutup"
                layoutParentNotifBadge.visibility = View.VISIBLE
                tvParentNotifText.text = "Notifikasi Kepulangan Terkirim ke Orang Tua"
                tvParentNotifDetail?.text = "Anak Anda $sName telah pulang dari sekolah pukul $timeStr WIB"
            } else {
                layoutHeaderBanner.setBackgroundResource(R.drawable.bg_biodata_header_gradient)
                tvScanResultIcon.text = "🏫"
                tvScanResultIcon.setTextColor(Color.parseColor("#059669"))
                tvScanResultTitle.text = "SELAMAT DATANG DI SEKOLAH!"
                tvScanResultSubtitle.text = subtitle
                
                tvScanTypeLabel?.text = "PRESENSI MASUK PAGI (GATE-IN)"
                tvLocationVerified?.text = "📍 Terverifikasi di Area SMP Negeri 1 Boyolangu"
                
                btnPrimary.setBackgroundColor(Color.parseColor("#059669"))
                btnPrimary.text = "Selesai & Tutup"
                layoutParentNotifBadge.visibility = View.VISIBLE
                tvParentNotifText.text = "Notifikasi Kedatangan Terkirim ke Orang Tua"
                
                val lateStatus = if (message.contains("terlambat", ignoreCase = true)) "Terlambat" else "Hadir Tepat Waktu"
                tvParentNotifDetail?.text = "Anak Anda $sName telah tiba di sekolah pukul $timeStr WIB — Status: $lateStatus"
                
                if (lateStatus == "Terlambat") {
                    tvScanResultIcon.text = "⚠️"
                    tvScanResultTitle.text = "⚠️ PRESENSI MASUK TERLAMBAT"
                    tvScanResultSubtitle.text = "Kedatangan Melewati Pukul 07:00 WIB (+2 Poin Kedisiplinan)"
                    layoutLateInfo?.visibility = View.VISIBLE
                    tvLateInfo?.text = "Status: Terlambat (+2 Poin Kedisiplinan)"
                    btnPrimary.setBackgroundColor(Color.parseColor("#D97706"))
                    btnPrimary.text = "Mengerti & Masuk Kelas"
                    com.school.smartcbt.utils.TtsVoiceHelper.speakMasukTerlambat(sName)
                } else {
                    com.school.smartcbt.utils.TtsVoiceHelper.speakMasukTepatWaktu(sName)
                }
            }

            if (isMushola) {
                com.school.smartcbt.utils.TtsVoiceHelper.speakMushola(sName)
            } else if (isMatpel) {
                com.school.smartcbt.utils.TtsVoiceHelper.speak("Presensi mata pelajaran berhasil, $sName.")
            } else if (isGateOut) {
                com.school.smartcbt.utils.TtsVoiceHelper.speakPulang(sName)
            } else if (gateType.contains("RETURN", ignoreCase = true)) {
                com.school.smartcbt.utils.TtsVoiceHelper.speakSatpamReturn(sName)
            } else if (gateType.contains("CHECKOUT", ignoreCase = true)) {
                com.school.smartcbt.utils.TtsVoiceHelper.speakSatpamCheckout(sName)
            }
            btnSecondary.visibility = View.GONE

            btnPrimary.setOnClickListener {
                dialog.dismiss()
                finish()
            }
        } else if (isWarningYellow) {
            try {
                com.school.smartcbt.utils.TtsVoiceHelper.playBeepError()
            } catch (e: Exception) {}
            val isMorning = Calendar.getInstance().get(Calendar.HOUR_OF_DAY) < 11
            val isScannedGateOutInMorning = (scannedCode?.contains("OUT", ignoreCase = true) == true || 
                                             message.contains("Barcode Kepulangan", ignoreCase = true) || 
                                             title.contains("GATE-OUT", ignoreCase = true)) && isMorning

            if (isScannedGateOutInMorning) {
                layoutHeaderBanner.setBackgroundColor(Color.parseColor("#D97706"))
                tvScanResultIcon.text = "⛔"
                tvScanResultIcon.setTextColor(Color.parseColor("#FFFFFF"))
                tvScanTypeLabel?.text = "⛔ INI BARCODE KEPULANGAN (GATE-OUT)"
                tvScanResultTitle.text = "⛔ Anda Memindai Barcode Pulang!"
                tvScanResultSubtitle.text = "Gerbang Kepulangan Sedang Ditutup"
                tvGateTypeBadge.setBackgroundColor(Color.parseColor("#FEF3C7"))
                tvGateTypeBadge.setTextColor(Color.parseColor("#B45309"))
                tvGateTypeBadge.text = "⚠️ BUKAN BARCODE MASUK KELAS"

                tvScanResultMessage.setTypeface(null, android.graphics.Typeface.BOLD)
                tvScanResultMessage.setTextColor(Color.parseColor("#92400E"))
                tvScanResultMessage.setBackgroundColor(Color.parseColor("#FEF3C7"))
                tvScanResultMessage.text = "Yang baru saja Anda pindai adalah Barcode Kepulangan (Gate-Out). Gerbang kepulangan saat ini SEDANG DITUTUP (Baru dibuka pukul 12:30 WIB).\n\n👉 JANGAN PANIK!\nSilakan pindai BARCODE MASUK (GATE-IN) yang terpasang di samping pintu ruang kelas Anda untuk presensi kedatangan pagi."

                btnPrimary.setBackgroundColor(Color.parseColor("#D97706"))
                btnPrimary.text = "Mengerti, Cari Barcode Masuk"
                btnSecondary.visibility = View.GONE
                layoutParentNotifBadge.visibility = View.GONE

                com.school.smartcbt.utils.TtsVoiceHelper.speakSalahScanGateOutPagi()

                btnPrimary.setOnClickListener {
                    dialog.dismiss()
                    isProcessingScan = false
                    tvStatusText.text = "📷 Arahkan Kamera ke Barcode [ MASUK (GATE-IN) ]"
                }
            } else {
                tvScanTypeLabel?.text = "PERINGATAN PRESENSI"
                layoutHeaderBanner.setBackgroundColor(Color.parseColor("#D97706"))
                tvScanResultIcon.text = "⚠️"
                tvScanResultIcon.setTextColor(Color.parseColor("#D97706"))
                tvScanResultTitle.text = title
                tvScanResultSubtitle.text = subtitle
                tvGateTypeBadge.setBackgroundColor(Color.parseColor("#FEF3C7"))
                tvGateTypeBadge.setTextColor(Color.parseColor("#B45309"))
                tvGateTypeBadge.text = "⚠️ PERINGATAN: BELUM SCAN MASUK"
                btnPrimary.setBackgroundColor(Color.parseColor("#D97706"))
                btnPrimary.text = "Pulang Khusus (Lupa Scan Pagi)"
                btnSecondary.visibility = View.VISIBLE
                btnSecondary.text = "Tutup / Tanya Piket"
                layoutParentNotifBadge.visibility = View.GONE

                com.school.smartcbt.utils.TtsVoiceHelper.speakBelumScanMasuk()

                btnPrimary.setOnClickListener {
                    dialog.dismiss()
                    if (!scannedCode.isNullOrEmpty()) {
                        AlertDialog.Builder(this@ScannerActivity)
                            .setTitle("🚪 Konfirmasi Pulang Khusus")
                            .setMessage("Apakah Anda ingin memproses Presensi Kepulangan Khusus?\n\n📌 Ketentuan:\n• Anda tetap diizinkan pulang sekarang.\n• Sistem akan mencatat catatan kedisiplinan ringan (Lupa scan masuk pagi) ke Guru BK/Piket.\n• Notifikasi resmi kepulangan akan diteruskan ke HP Orang Tua.")
                            .setPositiveButton("Ya, Tetap Pulang") { _, _ ->
                                submitAttendance(
                                    code = scannedCode,
                                    lat = lat,
                                    lng = lng,
                                    isFakeGps = isFakeGps,
                                    method = "GPS",
                                    accuracy = accuracy,
                                    isSpecialCheckoutWithoutIn = true
                                )
                            }
                            .setNegativeButton("Batal", null)
                            .show()
                    } else {
                        finish()
                    }
                }
                btnSecondary.setOnClickListener {
                    dialog.dismiss()
                    finish()
                }
            }
        } else if (title.contains("LIBUR", ignoreCase = true) || title.contains("MINGGU", ignoreCase = true)) {
            tvScanTypeLabel?.text = "🌴 HARI LIBUR SEKOLAH"
            layoutHeaderBanner.setBackgroundColor(Color.parseColor("#0284C7"))
            tvScanResultIcon.text = "🌴"
            tvScanResultIcon.setTextColor(Color.parseColor("#FFFFFF"))
            tvScanResultTitle.text = title
            tvScanResultSubtitle.text = subtitle
            tvGateTypeBadge.setBackgroundColor(Color.parseColor("#E0F2FE"))
            tvGateTypeBadge.setTextColor(Color.parseColor("#0369A1"))
            tvGateTypeBadge.text = "🌴 LIBUR OPERASIONAL SEKOLAH"
            btnPrimary.setBackgroundColor(Color.parseColor("#0284C7"))
            btnPrimary.text = "Tutup & Selamat Berlibur"
            btnSecondary.visibility = View.GONE
            layoutParentNotifBadge.visibility = View.GONE

            com.school.smartcbt.utils.TtsVoiceHelper.speakLiburSekolah()
            btnPrimary.setOnClickListener {
                dialog.dismiss()
                finish()
            }
        } else {
            val calNow = Calendar.getInstance()
            val hourNow = calNow.get(Calendar.HOUR_OF_DAY)
            val minuteNow = calNow.get(Calendar.MINUTE)
            val isPast0730 = (hourNow in 8..11) || (hourNow == 7 && minuteNow >= 30)

            val isLateArrivalToBk = isPast0730 && 
                                    (title.contains("TERLAMBAT", ignoreCase = true) || title.contains("TERKUNCI", ignoreCase = true) || title.contains("DITUTUP", ignoreCase = true) || message.contains("07:30", ignoreCase = true) || message.contains("Ruang BK", ignoreCase = true)) && 
                                    !title.contains("BELUM", ignoreCase = true) && 
                                    !title.contains("LIBUR", ignoreCase = true) && 
                                    !title.contains("MINGGU", ignoreCase = true) && 
                                    !title.contains("KEPULANGAN", ignoreCase = true) && 
                                    !title.contains("GATE-OUT", ignoreCase = true)

            if (isLateArrivalToBk) {
                tvScanTypeLabel?.text = "🚨 GERBANG KELAS DITUTUP (> 07:30 WIB)"
                layoutHeaderBanner.setBackgroundColor(Color.parseColor("#991B1B"))
                tvScanResultIcon.text = "🚨"
                tvScanResultIcon.setTextColor(Color.parseColor("#FFFFFF"))
                tvScanResultTitle.text = "🚨 GERBANG KELAS DITUTUP!"
                tvScanResultSubtitle.text = "Batas Presensi Kelas Pukul 07:30:00 WIB Berakhir"
                tvGateTypeBadge.setBackgroundColor(Color.parseColor("#FEF2F2"))
                tvGateTypeBadge.setTextColor(Color.parseColor("#991B1B"))
                tvGateTypeBadge.text = "🏢 ARAHAN: SEGERA MENUJU RUANG BK"

                tvScanResultMessage.setTypeface(null, android.graphics.Typeface.BOLD)
                tvScanResultMessage.setTextColor(Color.parseColor("#991B1B"))
                tvScanResultMessage.setBackgroundColor(Color.parseColor("#FEE2E2"))
                tvScanResultMessage.text = "⚠️ GERBANG KELAS TELAH DITUTUP PUKUL 07:30 WIB!\n\nBatas toleransi presensi di ruang kelas telah berakhir demi ketertiban KBM jam pertama.\n\n👉 SEGERA MENUJU KE RUANG BK!\nTemui Guru BK atau scan Barcode Khusus Siswa Terlambat di Ruang BK untuk mendapatkan pendataan dan izin masuk kelas."

                // Blinking animation on message to draw critical attention
                val blinkAnimation = android.view.animation.AlphaAnimation(0.2f, 1.0f).apply {
                    duration = 450
                    repeatMode = android.view.animation.Animation.REVERSE
                    repeatCount = android.view.animation.Animation.INFINITE
                }
                tvScanResultMessage.startAnimation(blinkAnimation)
                com.school.smartcbt.utils.TtsVoiceHelper.speakBarcodeDitutup()

                btnPrimary.setBackgroundColor(Color.parseColor("#991B1B"))
                btnPrimary.text = "🏠 Kembali ke Dashboard"
                btnSecondary.visibility = View.VISIBLE
                btnSecondary.text = "🏢 Scan Barcode BK"

                btnPrimary.setOnClickListener {
                    blinkAnimation.cancel()
                    dialog.dismiss()
                    finish()
                }
                btnSecondary.setOnClickListener {
                    blinkAnimation.cancel()
                    dialog.dismiss()
                    isProcessingScan = false
                    tvStatusText.text = "🏢 Arahkan Kamera ke Barcode Terlambat Ruang BK"
                }
            } else {
                try {
                    com.school.smartcbt.utils.TtsVoiceHelper.playBeepError()
                } catch (e: Exception) {}
                tvScanTypeLabel?.text = "STATUS PRESENSI"
                layoutHeaderBanner.setBackgroundColor(Color.parseColor("#DC2626"))
                tvScanResultIcon.text = "⚠️"
                tvScanResultIcon.setTextColor(Color.parseColor("#DC2626"))
                tvScanResultTitle.text = title
                tvScanResultSubtitle.text = subtitle
                tvGateTypeBadge.setBackgroundColor(Color.parseColor("#FEE2E2"))
                tvGateTypeBadge.setTextColor(Color.parseColor("#991B1B"))
                btnPrimary.setBackgroundColor(Color.parseColor("#DC2626"))
                btnPrimary.text = "🏠 Kembali ke Dashboard"
                btnSecondary.visibility = View.VISIBLE
                btnSecondary.text = "🔄 Scan Ulang"
                layoutParentNotifBadge.visibility = View.GONE

                val lowerMsg = (title + " " + subtitle + " " + message).lowercase()
                if (gateType.contains("CHECKOUT", ignoreCase = true) || gateType.contains("RETURN", ignoreCase = true)) {
                    com.school.smartcbt.utils.TtsVoiceHelper.speakSatpamDitolak()
                } else if (lowerMsg.contains("kelas lain") || lowerMsg.contains("bukan kelas") || lowerMsg.contains("tidak cocok")) {
                    com.school.smartcbt.utils.TtsVoiceHelper.speakBedaKelas()
                } else if (lowerMsg.contains("fake gps") || lowerMsg.contains("mock") || lowerMsg.contains("palsu")) {
                    com.school.smartcbt.utils.TtsVoiceHelper.speakFakeGps()
                } else if (lowerMsg.contains("sudah") && (lowerMsg.contains("hadir") || lowerMsg.contains("presensi") || lowerMsg.contains("1x"))) {
                    com.school.smartcbt.utils.TtsVoiceHelper.speakSudahAbsen(sName)
                } else if (lowerMsg.contains("tutup") || lowerMsg.contains("terkunci") || lowerMsg.contains("bk") || lowerMsg.contains("wali kelas")) {
                    com.school.smartcbt.utils.TtsVoiceHelper.speakBarcodeDitutup()
                } else if (lowerMsg.contains("gps") || lowerMsg.contains("lokasi") || lowerMsg.contains("radius") || lowerMsg.contains("jarak")) {
                    com.school.smartcbt.utils.TtsVoiceHelper.speakGpsDitolak()
                } else if (lowerMsg.contains("belum dibuka")) {
                    com.school.smartcbt.utils.TtsVoiceHelper.speak("Presensi ditolak. Gerbang presensi belum dibuka oleh server sekolah.")
                } else {
                    com.school.smartcbt.utils.TtsVoiceHelper.speak(if (message.isNotBlank()) message else title)
                }

                btnPrimary.setOnClickListener {
                    dialog.dismiss()
                    finish()
                }
                btnSecondary.setOnClickListener {
                    dialog.dismiss()
                    isProcessingScan = false
                    tvStatusText.text = "📷 Kamera Siap: Arahkan ke QR Code Presensi"
                }
            }
        }

        try {
            if (!isFinishing && !isDestroyed) {
                dialog.show()
                dialog.window?.let { win ->
                    val displayMetrics = resources.displayMetrics
                    val dialogWidth = (displayMetrics.widthPixels * 0.94).toInt()
                    val maxHeight = (displayMetrics.heightPixels * 0.88).toInt()
                    win.setLayout(dialogWidth, android.view.ViewGroup.LayoutParams.WRAP_CONTENT)

                    // Ensure navigation bar never obscures bottom buttons
                    val bottomBar = dialogView.findViewById<View>(R.id.layoutDialogBottomBar)
                    if (bottomBar != null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                        win.decorView.setOnApplyWindowInsetsListener { _, insets ->
                            val navBottom = insets.getInsets(android.view.WindowInsets.Type.navigationBars()).bottom
                            bottomBar.setPadding(
                                bottomBar.paddingLeft,
                                bottomBar.paddingTop,
                                bottomBar.paddingRight,
                                bottomBar.paddingBottom.coerceAtLeast(navBottom + 20)
                            )
                            insets
                        }
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("ScannerActivity", "Gagal menampilkan showModernScanDialog: ${e.message}")
        }
    }

    private val studentPhotoCache: android.util.LruCache<String, Bitmap> by lazy {
        val maxMemoryKb = (Runtime.getRuntime().maxMemory() / 1024).toInt()
        val cacheSizeKb = (maxMemoryKb / 8).coerceAtLeast(2048)
        object : android.util.LruCache<String, Bitmap>(cacheSizeKb) {
            override fun sizeOf(key: String, bitmap: Bitmap): Int {
                return (bitmap.byteCount / 1024).coerceAtLeast(1)
            }
        }
    }

    private fun loadStudentPhotoAsync(url: String, imageView: ImageView, fallbackText: TextView) {
        imageView.tag = url
        synchronized(studentPhotoCache) {
            val cached = studentPhotoCache.get(url)
            if (cached != null && !cached.isRecycled) {
                imageView.setImageBitmap(cached)
                imageView.visibility = View.VISIBLE
                fallbackText.visibility = View.GONE
                return
            }
        }

        cameraExecutor.execute {
            try {
                val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 4000
                conn.readTimeout = 4000
                conn.doInput = true
                conn.connect()
                val bytes = conn.inputStream.use { it.readBytes() }
                if (bytes.isEmpty() || bytes.size > 5 * 1024 * 1024) return@execute

                val boundsOpt = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, boundsOpt)

                var sampleSize = 1
                while (boundsOpt.outWidth / sampleSize > 256 || boundsOpt.outHeight / sampleSize > 256) {
                    sampleSize *= 2
                }

                val decodeOpt = BitmapFactory.Options().apply {
                    inSampleSize = sampleSize
                    inPreferredConfig = Bitmap.Config.RGB_565
                }
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOpt)
                if (bmp != null) {
                    synchronized(studentPhotoCache) {
                        studentPhotoCache.put(url, bmp)
                    }
                    runOnUiThread {
                        if (imageView.tag == url) {
                            imageView.setImageBitmap(bmp)
                            imageView.visibility = View.VISIBLE
                            fallbackText.visibility = View.GONE
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (imageView.tag == url) {
                        imageView.setImageResource(R.drawable.ic_avatar_placeholder)
                    }
                }
            }
        }
    }

    data class ScanFailureExplanation(
        val title: String,
        val subtitle: String,
        val reason: String,
        val suggestion: String
    )

    private fun parseScanFailureExplanation(serverMsg: String, code: String): ScanFailureExplanation {
        val lower = serverMsg.lowercase(Locale.ROOT)
        return when {
            // 1. HARI MINGGU & HARI LIBUR SEKOLAH (PRIORITAS TERTINGGI - JANGAN SAMPAI DISANGKA TERLAMBAT/KE BK)
            lower.contains("minggu") || lower.contains("libur") || lower.contains("holiday") || lower.contains("akhir pekan") -> {
                ScanFailureExplanation(
                    title = "🌴 HARI LIBUR OPERASIONAL SEKOLAH",
                    subtitle = "Selamat Berakhir Pekan!",
                    reason = "Hari ini adalah hari libur sekolah (tidak ada kegiatan belajar mengajar atau presensi tatap muka di SMP Negeri 1 Boyolangu).",
                    suggestion = "Presensi dinonaktifkan pada hari libur. Silakan nikmati waktu istirahat dan berkumpul bersama keluarga di rumah."
                )
            }

            // 2. SISWA MEMINDAI BARCODE GATE-OUT DI PAGI HARI (JANGAN PANIK)
            lower.contains("memindai barcode kepulangan") || lower.contains("isgateoutinmorning") || 
            (code.contains("OUT", true) && Calendar.getInstance().get(Calendar.HOUR_OF_DAY) < 11) -> {
                ScanFailureExplanation(
                    title = "⛔ INI BARCODE KEPULANGAN (GATE-OUT)",
                    subtitle = "Gerbang Kepulangan Sedang Ditutup",
                    reason = "Yang baru saja Anda pindai adalah Barcode Kepulangan (Gate-Out). Gerbang kepulangan saat ini SEDANG DITUTUP dan baru dibuka saat jam kepulangan siang (pukul 12:30 WIB).",
                    suggestion = "👉 JANGAN PANIK! Silakan pindai BARCODE MASUK (GATE-IN) yang terpasang di samping pintu ruang kelas Anda untuk mencatat presensi pagi."
                )
            }

            // 3. GERBANG KEPULANGAN SIANG BELUM DIBUKA
            lower.contains("gerbang kepulangan belum dibuka") || lower.contains("isgateoutclosed") || 
            (lower.contains("kepulangan") && lower.contains("belum dibuka")) -> {
                ScanFailureExplanation(
                    title = "⛔ GERBANG KEPULANGAN BELUM DIBUKA",
                    subtitle = "KBM Masih Berlangsung",
                    reason = "Presensi kepulangan (Gate-Out) baru dibuka saat jam kepulangan resmi sekolah sesuai jadwal operasional hari ini.",
                    suggestion = "Silakan ikuti KBM hingga selesai. Jika ada keperluan darurat atau sakit, ajukan izin melalui menu Perizinan (Gatepass) di aplikasi."
                )
            }

            // 4. GERBANG KELAS DITUTUP PUKUL 07:30 KE RUANG BK
            lower.contains("ditutup pukul 07:30") || lower.contains("isclassgateclosedtobk") || lower.contains("ke ruang bk") || lower.contains("toleransi presensi di ruang kelas") -> {
                ScanFailureExplanation(
                    title = "🚨 GERBANG KELAS DITUTUP (PUKUL 07:30 WIB)",
                    subtitle = "Batas Presensi Kelas Telah Berakhir",
                    reason = "Presensi mandiri di ruang kelas telah ditutup pada pukul 07:30:00 WIB demi ketertiban KBM jam pertama.",
                    suggestion = "👉 SEGERA MENUJU KE RUANG BK! Silakan scan Barcode Khusus Siswa Terlambat di Ruang BK atau temui Guru BK untuk mendapatkan surat izin masuk kelas."
                )
            }

            // 5. GERBANG MASUK BELUM DIBUKA (< 06:00 WIB)
            lower.contains("gerbang masuk belum dibuka") || (lower.contains("belum dibuka") && lower.contains("masuk")) -> {
                ScanFailureExplanation(
                    title = "⛔ GERBANG PRESENSI BELUM DIBUKA",
                    subtitle = "Di Luar Jam Masuk Sekolah",
                    reason = "Sesi pemindaian presensi pagi belum dibuka oleh server sekolah (Jam masuk resmi dibuka mulai pukul 06:00 WIB).",
                    suggestion = "Silakan tunggu beberapa saat hingga server membuka gerbang presensi sesuai jam operasional sekolah."
                )
            }

            lower.contains("belum tercatat") || lower.contains("belum scan masuk") || lower.contains("belum ada catatan presensi masuk") -> {
                ScanFailureExplanation(
                    title = "⚠️ BELUM SCAN MASUK",
                    subtitle = "Keamanan Gerbang: Wajib Scan Masuk Dahulu",
                    reason = "Presensi kepulangan ditolak karena sistem tidak menemukan catatan presensi masuk (Gate-In) Anda hari ini. Siswa wajib memiliki catatan kedatangan sebelum dapat memindai kepulangan.",
                    suggestion = "Harap segera melapor ke Guru Piket atau Ruang Guru BK untuk verifikasi kehadiran dan klarifikasi presensi Anda."
                )
            }
            lower.contains("sudah melakukan presensi") || lower.contains("1x per hari") || lower.contains("already") -> {
                ScanFailureExplanation(
                    title = "⚠️ SUDAH TERCATAT HARI INI",
                    subtitle = "Presensi Masuk 1x Saja Per Hari",
                    reason = "Data presensi kehadiran Anda untuk hari ini sudah tersimpan resmi di database. Sistem membatasi scan masuk satu kali per hari agar rekapitulasi data tidak terduplikasi.",
                    suggestion = "Anda tidak perlu melakukan pemindaian masuk lagi. Silakan bersiap mengikuti KBM di kelas dan tunggu waktu kepulangan sore hari untuk scan pulang."
                )
            }
            lower.contains("darurat") || lower.contains("pulang lebih awal") || lower.contains("belum waktunya pulang") -> {
                ScanFailureExplanation(
                    title = "⛔ BELUM WAKTUNYA KEPULANGAN",
                    subtitle = "KBM Masih Berlangsung",
                    reason = "Jam KBM sekolah masih berjalan aktif. Siswa tidak diizinkan memindai barcode kepulangan tanpa izin resmi.",
                    suggestion = "Jika Anda memiliki keperluan mendesak atau sakit, silakan ajukan izin melalui menu Perizinan (Gatepass) di aplikasi dan temui Guru BK."
                )
            }
            lower.contains("gps tidak terkunci") || lower.contains("pengurus kelas") || lower.contains("redirectdynamicqr") -> {
                ScanFailureExplanation(
                    title = "📍 GPS TIDAK TERKUNCI",
                    subtitle = "Alihkan ke QR Dinamis Pengurus Kelas",
                    reason = "Presensi menggunakan stiker barcode kelas fisik memerlukan koordinat GPS aktif yang terkunci di lingkungan sekolah.",
                    suggestion = "Silakan minta Pengurus Kelas Anda untuk membuka menu QR Dinamis (kode berganti otomatis tiap 10 detik) lalu pindai langsung dari layar HP Pengurus Kelas Anda."
                )
            }
            lower.contains("zona") || lower.contains("radius") || lower.contains("jarak") || lower.contains("geofence") -> {
                ScanFailureExplanation(
                    title = "📍 LOKASI DI LUAR AREA KELAS",
                    subtitle = "Radius GPS Melebihi Toleransi (Maks 10m)",
                    reason = "Posisi koordinat GPS HP Anda terdeteksi berada di luar jangkauan titik presensi kelas resmi SMPN 1 Boyolangu.",
                    suggestion = "Berdirilah tepat di depan pintu ruang kelas Anda dan pastikan indikator GPS HP sudah terkunci berwarna hijau (akurasi ≤ 15 meter)."
                )
            }
            lower.contains("kelas lain") || lower.contains("bukan kelas") || lower.contains("barcode tidak sesuai") -> {
                ScanFailureExplanation(
                    title = "❌ BARCODE KELAS TIDAK COCOK",
                    subtitle = "Ruang Kelas Berbeda",
                    reason = "Barcode yang Anda pindai terdaftar untuk ruangan atau kelas lain, bukan kelas Anda.",
                    suggestion = "Periksa papan nama kelas di atas pintu dan pastikan memindai barcode yang terpasang di depan ruang kelas Anda sendiri."
                )
            }
            lower.contains("fake gps") || lower.contains("mock") || lower.contains("palsu") -> {
                ScanFailureExplanation(
                    title = "🚨 MANIPULASI LOKASI PALSU DITOLAK",
                    subtitle = "Terdeteksi Aplikasi Fake GPS",
                    reason = "Sistem keamanan mendeteksi penggunaan aplikasi manipulasi GPS (Mock Provider) pada perangkat Anda.",
                    suggestion = "Matikan aplikasi Fake GPS dan opsi pengembang (Developer Options) di pengaturan HP Anda, lalu gunakan sinyal satelit asli."
                )
            }
            lower.contains("gatepass") || lower.contains("izin") -> {
                ScanFailureExplanation(
                    title = "ℹ️ STATUS IZIN PULANG AKTIF",
                    subtitle = "Gatepass Sedang Berjalan",
                    reason = "Anda memiliki tiket izin kepulangan darurat resmi (Gatepass) yang telah disetujui Guru BK.",
                    suggestion = "Tunjukkan barcode kartu Digital Gatepass kepada Satpam di pos gerbang utama sekolah untuk checkout."
                )
            }
            else -> {
                ScanFailureExplanation(
                    title = "⚠️ VERIFIKASI PRESENSI GAGAL",
                    subtitle = "Server Menolak Pemindaian",
                    reason = serverMsg.ifBlank { "Server sekolah tidak dapat memvalidasi barcode yang dipindai ($code)." },
                    suggestion = "Pastikan barcode dalam kondisi bersih dan pencahayaan cukup. Jika kendala berlanjut, hubungi Guru BK, Wali Kelas atau Operator CBT."
                )
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        clockHandler.removeCallbacks(clockTicker)
        cameraExecutor.shutdown()
        try {
            studentPhotoCache.evictAll()
        } catch (e: Exception) {}
    }
}
