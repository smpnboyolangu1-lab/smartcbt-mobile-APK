package com.school.smartcbt.ui

import android.Manifest
import android.app.Dialog
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.util.Base64
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.school.smartcbt.R
import com.school.smartcbt.data.model.AssistedScanRequest
import com.school.smartcbt.data.model.AssistedScanResponse
import com.school.smartcbt.data.model.ClassmateItemDto
import com.school.smartcbt.data.model.ClassmatesRealtimeResponse
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityPengurusKelasBinding
import com.school.smartcbt.databinding.ItemPengurusKelasStudentBinding
import com.school.smartcbt.utils.GpsUtils
import com.school.smartcbt.utils.SessionManager
import com.school.smartcbt.utils.TtsVoiceHelper
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class PengurusKelasActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPengurusKelasBinding
    private lateinit var sessionManager: SessionManager
    private lateinit var cameraExecutor: ExecutorService
    private var camera: Camera? = null
    private var isTorchOn = false

    private var locationManager: LocationManager? = null
    private var liveBestLocation: Location? = null

    private var classmatesList: MutableList<ClassmateItemDto> = mutableListOf()
    private var filteredList: MutableList<ClassmateItemDto> = mutableListOf()
    private lateinit var adapter: ClassmatesAdapter

    private var isScanningActive = false
    private var isProcessingAssistedScan = false
    private var lastScannedCode: String? = null
    private var lastScannedTimestamp: Long = 0L

    private val mainHandler = Handler(Looper.getMainLooper())

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val isMock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) location.isMock
            else @Suppress("DEPRECATION") location.isFromMockProvider

            if (!isMock) {
                liveBestLocation = location
            }
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val cameraGranted = permissions[Manifest.permission.CAMERA] ?: false
        val locGranted = (permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false) ||
                (permissions[Manifest.permission.ACCESS_COARSE_LOCATION] ?: false)

        if (cameraGranted) {
            startContinuousCamera()
        } else {
            Toast.makeText(this, "Izin kamera diperlukan untuk memindai kartu pelajar", Toast.LENGTH_LONG).show()
        }

        if (locGranted) {
            startLocationUpdates()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPengurusKelasBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)
        cameraExecutor = Executors.newSingleThreadExecutor()
        TtsVoiceHelper.init(this)

        setupHeader()
        setupRecyclerView()
        setupTabs()
        setupSearch()
        setupFilterCards()
        checkAndRequestPermissions()
        loadClassmatesData()

        // Cek Pembaruan OTA Otomatis
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
    }

    override fun onResume() {
        super.onResume()
        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
    }

    private fun setupHeader() {
        val className = sessionManager.getClassName().ifEmpty { "Kelas Anda" }
        val officerRole = sessionManager.getClassRole().ifEmpty { "Pengurus Kelas" }
        binding.tvPengurusClassSubtitle.text = "Kelas $className • $officerRole"

        binding.btnBackPengurus.setOnClickListener {
            finish()
        }

        binding.btnRefreshPengurus.setOnClickListener {
            loadClassmatesData()
        }

        binding.btnUpdatePengurus.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        binding.btnToggleFlashPengurus.setOnClickListener {
            toggleTorch()
        }
    }

    private fun setupRecyclerView() {
        adapter = ClassmatesAdapter(filteredList)
        binding.rvClassmates.layoutManager = LinearLayoutManager(this)
        binding.rvClassmates.adapter = adapter
    }

    private var activeStatusFilter: String? = null // null: SEMUA, "HADIR", "TERLAMBAT", "BELUM", "IZIN_SAKIT"

    private fun setupFilterCards() {
        binding.cardFilterTotal.setOnClickListener {
            setActiveFilter(null)
        }
        binding.cardFilterHadir.setOnClickListener {
            setActiveFilter(if (activeStatusFilter == "HADIR") null else "HADIR")
        }
        binding.cardFilterTerlambat.setOnClickListener {
            setActiveFilter(if (activeStatusFilter == "TERLAMBAT") null else "TERLAMBAT")
        }
        binding.cardFilterBelum.setOnClickListener {
            setActiveFilter(if (activeStatusFilter == "BELUM") null else "BELUM")
        }
        binding.cardFilterIzin.setOnClickListener {
            setActiveFilter(if (activeStatusFilter == "IZIN_SAKIT") null else "IZIN_SAKIT")
        }
        updateFilterCardStyles()
    }

    private fun setActiveFilter(filter: String?) {
        activeStatusFilter = filter
        updateFilterCardStyles()
        filterClassmates(binding.etSearchClassmates.text.toString())
        
        val label = when (filter) {
            "HADIR" -> "Hadir Tepat / Pulang"
            "TERLAMBAT" -> "Terlambat"
            "BELUM" -> "Belum Hadir"
            "IZIN_SAKIT" -> "Sakit & Izin Resmi"
            else -> "Semua Siswa"
        }
        Toast.makeText(this, "Menampilkan: $label (${filteredList.size} siswa)", Toast.LENGTH_SHORT).show()
    }

    private fun updateFilterCardStyles() {
        val cards = listOf(
            binding.cardFilterTotal to null,
            binding.cardFilterHadir to "HADIR",
            binding.cardFilterTerlambat to "TERLAMBAT",
            binding.cardFilterBelum to "BELUM",
            binding.cardFilterIzin to "IZIN_SAKIT"
        )
        for ((card, key) in cards) {
            val isSelected = (activeStatusFilter == key) || (activeStatusFilter == null && key == null)
            card.alpha = if (isSelected) 1.0f else 0.55f
            card.cardElevation = if (isSelected) 4f * resources.displayMetrics.density else 0f
        }
    }

    // ================= TAB 2: QR DINAMIS 10 DETIK & NOTIFIKASI SUARA =================
    private var dynamicQrTimer: android.os.CountDownTimer? = null
    private var currentDynamicStep: Long = 0L
    private val recordedPresentStudentIds = mutableSetOf<String>()
    private var isInitialRealtimeFetch = true
    private val dynamicQrPollHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var isDynamicQrPollingActive = false

    private val dynamicQrPollRunnable = object : Runnable {
        override fun run() {
            if (!isDynamicQrPollingActive) return
            pollClassmatesRealtimeSilently()
            dynamicQrPollHandler.postDelayed(this, 3000L)
        }
    }

    private fun startDynamicQrPolling() {
        if (!isDynamicQrPollingActive) {
            isDynamicQrPollingActive = true
            dynamicQrPollHandler.removeCallbacks(dynamicQrPollRunnable)
            dynamicQrPollHandler.post(dynamicQrPollRunnable)
        }
    }

    private fun stopDynamicQrPolling() {
        isDynamicQrPollingActive = false
        dynamicQrPollHandler.removeCallbacks(dynamicQrPollRunnable)
    }

    private fun pollClassmatesRealtimeSilently() {
        ApiClient.getClient(this).getClassmatesRealtimeStatus().enqueue(object : Callback<ClassmatesRealtimeResponse> {
            override fun onResponse(call: Call<ClassmatesRealtimeResponse>, response: Response<ClassmatesRealtimeResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    val currentPresentIds = mutableSetOf<String>()
                    val newlyArrived = mutableListOf<ClassmateItemDto>()

                    for (s in data.students) {
                        val stUpper = (s.status ?: "").uppercase()
                        val isPresent = stUpper in listOf("PRESENT", "HADIR", "PULANG", "LATE", "TERLAMBAT")
                        if (isPresent) {
                            currentPresentIds.add(s.id)
                            if (!isInitialRealtimeFetch && !recordedPresentStudentIds.contains(s.id)) {
                                newlyArrived.add(s)
                            }
                        }
                    }

                    if (isInitialRealtimeFetch) {
                        recordedPresentStudentIds.clear()
                        recordedPresentStudentIds.addAll(currentPresentIds)
                        isInitialRealtimeFetch = false
                    } else if (newlyArrived.isNotEmpty()) {
                        recordedPresentStudentIds.clear()
                        recordedPresentStudentIds.addAll(currentPresentIds)

                        // 1. Notifikasi Suara Chime / Nada Beep
                        try {
                            val toneGen = android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 100)
                            toneGen.startTone(android.media.ToneGenerator.TONE_PROP_BEEP2, 250)
                        } catch (e: Exception) {
                            Log.w("PengurusKelas", "ToneGenerator error: ${e.message}")
                        }

                        // 2. Notifikasi Suara TTS untuk Pengurus Kelas
                        for (s in newlyArrived) {
                            val isLate = (s.status ?: "").uppercase() in listOf("LATE", "TERLAMBAT")
                            val statusDesc = if (isLate) "terlambat" else "hadir"
                            com.school.smartcbt.utils.TtsVoiceHelper.speak("${s.name} berhasil presensi, status $statusDesc")
                            Toast.makeText(this@PengurusKelasActivity, "🔔 ${s.name} berhasil presensi ($statusDesc)", Toast.LENGTH_SHORT).show()
                        }
                    }

                    // Sinkronisasi data di layar monitor secara halus
                    binding.tvStatTotal.text = "${data.totalStudents}"
                    binding.tvStatHadir.text = "${data.presentCount}"
                    binding.tvStatBelum.text = "${data.absentCount}"
                    binding.tvStatIzin.text = "${data.sickPermitCount}"
                    binding.tvStatTerlambat.text = "${data.lateCount}"
                    binding.tvStatDemography.text = "${data.countL} L • ${data.countP} P"

                    classmatesList.clear()
                    classmatesList.addAll(data.students)
                    filterClassmates(binding.etSearchClassmates.text.toString())
                }
            }

            override fun onFailure(call: Call<ClassmatesRealtimeResponse>, t: Throwable) {
                // Polling latar belakang hening jika gagal
            }
        })
    }

    private fun generateDynamicClassQrPayload(className: String, step: Long): String {
        val salt = "SmartCBT_Boyolangu_DynQR_Salt_2026"
        val data = "$className|$step|$salt"
        val md = java.security.MessageDigest.getInstance("SHA-256")
        val digest = md.digest(data.toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02x".format(it) }.substring(0, 12)
        return "DYNAMIC_CLASS_QR|$className|$step|$hex"
    }

    private fun refreshDynamicQrCode() {
        val className = sessionManager.getClassName().ifEmpty { "VII-A" }
        binding.tvDynamicQrClassName.text = "QR Dinamis Kelas $className"

        val now = System.currentTimeMillis()
        val step = now / 10000L
        currentDynamicStep = step
        val payload = generateDynamicClassQrPayload(className, step)

        val bmp = com.school.smartcbt.utils.QrCodeHelper.generateQrCodeBitmap(payload, 450)
        if (bmp != null) {
            binding.ivDynamicQrCode.setImageBitmap(bmp)
        }

        startDynamicQrCountdown()
    }

    private fun startDynamicQrCountdown() {
        dynamicQrTimer?.cancel()
        val now = System.currentTimeMillis()
        val elapsedInStep = now % 10000L
        val millisLeft = 10000L - elapsedInStep

        dynamicQrTimer = object : android.os.CountDownTimer(millisLeft, 100) {
            override fun onTick(millisUntilFinished: Long) {
                val secondsLeft = (millisUntilFinished / 1000L) + 1
                binding.tvDynamicQrCountdown.text = "${secondsLeft}s"
                val progress = ((millisUntilFinished.toFloat() / 10000f) * 100).toInt()
                binding.pbDynamicQrTimer.progress = progress
            }

            override fun onFinish() {
                binding.tvDynamicQrCountdown.text = "0s"
                binding.pbDynamicQrTimer.progress = 0
                refreshDynamicQrCode()
            }
        }.start()
    }

    private fun setupTabs() {
        binding.btnTabMonitor.setOnClickListener {
            switchTab(0)
        }

        binding.btnTabDynamicQr.setOnClickListener {
            switchTab(1)
        }

        binding.btnTabScan.setOnClickListener {
            switchTab(2)
        }

        binding.btnTabEmptyHour.setOnClickListener {
            switchTab(3)
        }

        binding.btnRefreshDynamicQr.setOnClickListener {
            refreshDynamicQrCode()
            Toast.makeText(this, "QR Code diperbarui", Toast.LENGTH_SHORT).show()
        }

        setupEmptyHourForm()
    }

    private fun switchTab(tabIndex: Int) {
        data class TabColorSet(val activeBg: String, val inactiveBg: String, val inactiveText: String)
        val tabPalettes = listOf(
            TabColorSet("#1D4ED8", "#DBEAFE", "#1E40AF"), // Tab 0: Monitor (Deep Blue / Soft Blue)
            TabColorSet("#059669", "#D1FAE5", "#065F46"), // Tab 1: QR Dinamis (Emerald / Mint)
            TabColorSet("#7C3AED", "#EDE9FE", "#5B21B6"), // Tab 2: Scan (Purple / Violet)
            TabColorSet("#DC2626", "#FEE2E2", "#991B1B")  // Tab 3: Lapor Kosong (Crimson / Soft Red)
        )

        val tabButtons = listOf(
            binding.btnTabMonitor,
            binding.btnTabDynamicQr,
            binding.btnTabScan,
            binding.btnTabEmptyHour
        )

        tabButtons.forEachIndexed { idx, btn ->
            val palette = tabPalettes[idx]
            val isActive = (tabIndex == idx)
            if (isActive) {
                btn.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor(palette.activeBg))
                btn.setTextColor(Color.WHITE)
            } else {
                btn.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor(palette.inactiveBg))
                btn.setTextColor(Color.parseColor(palette.inactiveText))
            }
        }

        binding.layoutMonitorContainer.visibility = if (tabIndex == 0) View.VISIBLE else View.GONE
        binding.layoutDynamicQrContainer.visibility = if (tabIndex == 1) View.VISIBLE else View.GONE
        binding.layoutScanContainer.visibility = if (tabIndex == 2) View.VISIBLE else View.GONE
        binding.layoutEmptyHourContainer.visibility = if (tabIndex == 3) View.VISIBLE else View.GONE

        if (tabIndex == 1) {
            refreshDynamicQrCode()
            startDynamicQrPolling()
        } else {
            dynamicQrTimer?.cancel()
            stopDynamicQrPolling()
        }

        if (tabIndex == 2) {
            isScanningActive = true
            isProcessingAssistedScan = false
            startContinuousCamera()
        } else {
            isScanningActive = false
        }

        if (tabIndex == 3) {
            loadEmptyClassStatus()
        }
    }

    private fun setupSearch() {
        binding.etSearchClassmates.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                filterClassmates(s.toString())
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun filterClassmates(query: String) {
        val clean = query.trim().lowercase()
        filteredList.clear()
        
        for (item in classmatesList) {
            val matchesSearch = clean.isEmpty() ||
                    item.name.lowercase().contains(clean) ||
                    (item.nisn?.lowercase()?.contains(clean) == true)

            if (!matchesSearch) continue

            val itemStatus = item.status.uppercase()
            val matchesFilter = when (activeStatusFilter) {
                "HADIR" -> itemStatus in listOf("PRESENT", "HADIR", "PULANG")
                "TERLAMBAT" -> itemStatus in listOf("LATE", "TERLAMBAT")
                "BELUM" -> itemStatus in listOf("BELUM_HADIR", "BELUM", "ALPA")
                "IZIN_SAKIT" -> itemStatus in listOf("SICK", "SAKIT", "PERMISSION", "IZIN")
                else -> true
            }

            if (matchesFilter) {
                filteredList.add(item)
            }
        }
        adapter.notifyDataSetChanged()
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.CAMERA)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }

        if (permissions.isNotEmpty()) {
            requestPermissionsLauncher.launch(permissions.toTypedArray())
        } else {
            startLocationUpdates()
        }
    }

    private fun startLocationUpdates() {
        try {
            locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            locationManager?.let { lm ->
                if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 2.0f, locationListener)
                }
                if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 2.0f, locationListener)
                }
                val lastGps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                val lastNet = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                liveBestLocation = lastGps ?: lastNet
            }
        } catch (e: SecurityException) {
            Log.e("PengurusKelas", "SecurityException requesting location: ${e.message}")
        }
    }

    private fun loadClassmatesData() {
        binding.pbLoadingMonitor.visibility = View.VISIBLE
        ApiClient.getClient(this).getClassmatesRealtimeStatus().enqueue(object : Callback<ClassmatesRealtimeResponse> {
            override fun onResponse(call: Call<ClassmatesRealtimeResponse>, response: Response<ClassmatesRealtimeResponse>) {
                binding.pbLoadingMonitor.visibility = View.GONE
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    if (data.isFeatureDisabled) {
                        Toast.makeText(this@PengurusKelasActivity, data.message ?: "Fitur Pengurus Kelas sedang dinonaktifkan admin", Toast.LENGTH_LONG).show()
                        finish()
                        return
                    }

                    // Update Statistik & Demografi
                    binding.tvStatTotal.text = "${data.totalStudents}"
                    binding.tvStatHadir.text = "${data.presentCount}"
                    binding.tvStatBelum.text = "${data.absentCount}"
                    binding.tvStatIzin.text = "${data.sickPermitCount}"
                    binding.tvStatTerlambat.text = "${data.lateCount}"
                    binding.tvStatDemography.text = "${data.countL} L • ${data.countP} P"

                    classmatesList.clear()
                    classmatesList.addAll(data.students)
                    filterClassmates(binding.etSearchClassmates.text.toString())

                    // Seed ID siswa yang sudah hadir agar polling berikutnya hanya mendeteksi kedatangan baru
                    val currentPresentIds = mutableSetOf<String>()
                    for (s in data.students) {
                        val stUpper = (s.status ?: "").uppercase()
                        if (stUpper in listOf("PRESENT", "HADIR", "PULANG", "LATE", "TERLAMBAT")) {
                            currentPresentIds.add(s.id)
                        }
                    }
                    recordedPresentStudentIds.clear()
                    recordedPresentStudentIds.addAll(currentPresentIds)
                    isInitialRealtimeFetch = false
                } else {
                    Toast.makeText(this@PengurusKelasActivity, "Gagal memuat status teman sekelas", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<ClassmatesRealtimeResponse>, t: Throwable) {
                binding.pbLoadingMonitor.visibility = View.GONE
                Toast.makeText(this@PengurusKelasActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun startContinuousCamera() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return
        }

        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                val cameraProvider = cameraProviderFuture.get()

                val preview = Preview.Builder()
                    .setTargetResolution(android.util.Size(1280, 720))
                    .build()
                    .also {
                        it.setSurfaceProvider(binding.previewViewPengurus.surfaceProvider)
                    }

                val imageAnalysis = ImageAnalysis.Builder()
                    .setTargetResolution(android.util.Size(1280, 720))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                imageAnalysis.setAnalyzer(cameraExecutor, ContinuousBarcodeAnalyzer { barcodeValue ->
                    if (isScanningActive && !isProcessingAssistedScan) {
                        val now = System.currentTimeMillis()
                        if (barcodeValue == lastScannedCode && (now - lastScannedTimestamp) < 3000L) {
                            return@ContinuousBarcodeAnalyzer
                        }

                        lastScannedCode = barcodeValue
                        lastScannedTimestamp = now
                        isProcessingAssistedScan = true

                        runOnUiThread {
                            processAssistedBarcode(barcodeValue)
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

                binding.tvScannerStatusPengurus.text = "📷 Kamera Aktif: Arahkan ke Barcode Siswa"
            } catch (e: Exception) {
                Log.e("PengurusKelas", "Gagal inisialisasi CameraX: ${e.message}")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun toggleTorch() {
        camera?.let { cam ->
            if (cam.cameraInfo.hasFlashUnit()) {
                isTorchOn = !isTorchOn
                cam.cameraControl.enableTorch(isTorchOn)
                binding.btnToggleFlashPengurus.setColorFilter(
                    if (isTorchOn) ContextCompat.getColor(this, R.color.amber_warning)
                    else ContextCompat.getColor(this, R.color.white)
                )
            } else {
                Toast.makeText(this, "Perangkat tidak memiliki lampu flash", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun processAssistedBarcode(barcodeValue: String) {
        binding.tvScannerStatusPengurus.text = "⏳ Memverifikasi kartu siswa..."

        val lat = liveBestLocation?.latitude
        val lng = liveBestLocation?.longitude
        val accuracy = liveBestLocation?.accuracy ?: 15f

        val request = AssistedScanRequest(
            barcodeValue = barcodeValue.trim(),
            lat = lat,
            lng = lng,
            accuracy = accuracy,
            scanType = "GATE_IN"
        )

        ApiClient.getClient(this).submitAssistedScan(request).enqueue(object : Callback<AssistedScanResponse> {
            override fun onResponse(call: Call<AssistedScanResponse>, response: Response<AssistedScanResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val result = response.body()!!
                    if (result.success) {
                        val student = result.student
                        val sName = student?.name ?: "Siswa"
                        TtsVoiceHelper.speakDibantuPengurus(sName)
                        // Tampilkan notifikasi popup dialog data hasil scanner QR beserta pasfoto resmi siswa
                        showAssistedSuccessDialog(result)
                        loadClassmatesData()
                    } else {
                        handleAssistedError(result.message, result.isGpsError, result.isClassMismatch, result.isAlreadyScanned, result.student?.name)
                    }
                } else {
                    val errorMsg = try {
                        val json = JSONObject(response.errorBody()?.string() ?: "{}")
                        json.optString("message", "Presensi dibantu gagal diproses")
                    } catch (e: Exception) {
                        "Presensi gagal diproses (${response.code()})"
                    }
                    handleAssistedError(errorMsg, false, false, false, null)
                }
            }

            override fun onFailure(call: Call<AssistedScanResponse>, t: Throwable) {
                handleAssistedError("Koneksi gagal: ${t.message}", false, false, false, null)
            }
        })
    }

    private fun showAssistedSuccessDialog(res: AssistedScanResponse) {
        val student = res.student
        val dialog = Dialog(this)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setContentView(R.layout.dialog_assisted_scan_success)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.window?.setLayout(
            (resources.displayMetrics.widthPixels * 0.92).toInt(),
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        dialog.setCancelable(false)

        val ivPhoto = dialog.findViewById<ImageView>(R.id.ivDialogStudentPhoto)
        val tvName = dialog.findViewById<TextView>(R.id.tvDialogStudentName)
        val tvNisn = dialog.findViewById<TextView>(R.id.tvDialogStudentNisn)
        val tvTime = dialog.findViewById<TextView>(R.id.tvDialogAttendanceTime)
        val tvQuota = dialog.findViewById<TextView>(R.id.tvDialogQuotaRemaining)
        val btnNext = dialog.findViewById<Button>(R.id.btnDialogNextScan)

        tvName.text = student?.name ?: "Nama Siswa"
        val noPhoneTag = if (student?.isNoSmartphone == true) " • 📱 Siswa Tanpa HP" else ""
        tvNisn.text = "NISN: ${student?.nisn ?: "-"} • Kelas ${student?.className ?: "-"}$noPhoneTag"
        val timeStr = student?.timeStr ?: "Hari ini"
        val lateText = if (student?.isLate == true) " (Terlambat)" else " (Tepat Waktu)"
        tvTime.text = "✅ Masuk Tercatat: $timeStr WIB$lateText"
        tvQuota.text = res.message.ifEmpty { "Presensi berhasil dicatat oleh pengurus kelas" }

        // Muat pasfoto resmi / biometrik
        loadStudentPhoto(student?.profilePicUrl, ivPhoto)

        val btnClose = dialog.findViewById<Button>(R.id.btnDialogClose)

        btnClose?.setOnClickListener {
            dialog.dismiss()
            switchTab(0)
        }

        btnNext.setOnClickListener {
            dialog.dismiss()
            resumeContinuousScan()
        }

        dialog.show()
    }

    private fun handleAssistedError(message: String, isGps: Boolean, isMismatch: Boolean, isAlreadyScanned: Boolean, studentName: String?) {
        val cleanName = studentName ?: "Siswa"
        if (isMismatch) {
            TtsVoiceHelper.speakBedaKelas(cleanName, "lain")
        } else if (isGps || message.contains("GPS", ignoreCase = true) || message.contains("radius", ignoreCase = true)) {
            TtsVoiceHelper.speakGpsDitolak()
        } else if (isAlreadyScanned) {
            TtsVoiceHelper.speakSudahAbsen(cleanName, "masuk")
        } else {
            TtsVoiceHelper.speak(message)
        }

        AlertDialog.Builder(this)
            .setTitle("⚠️ Presensi Belum Berhasil")
            .setMessage(message)
            .setPositiveButton("Lanjut Scan") { d, _ ->
                d.dismiss()
                resumeContinuousScan()
            }
            .setCancelable(false)
            .show()
    }

    private fun resumeContinuousScan() {
        mainHandler.postDelayed({
            isProcessingAssistedScan = false
            binding.tvScannerStatusPengurus.text = "📷 Kamera Siap: Arahkan ke Barcode Siswa"
        }, 1200L)
    }

    private fun loadStudentPhoto(rawUrl: String?, targetView: ImageView) {
        if (rawUrl.isNullOrEmpty()) {
            targetView.setImageResource(android.R.drawable.ic_menu_myplaces)
            return
        }

        if (rawUrl.startsWith("data:image") || (rawUrl.length > 200 && !rawUrl.startsWith("http") && !rawUrl.contains("/"))) {
            try {
                val cleanBase64 = if (rawUrl.contains(",")) rawUrl.substringAfter(",") else rawUrl
                val decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                if (bitmap != null) {
                    targetView.setImageBitmap(bitmap)
                    return
                }
            } catch (e: Exception) {}
        }

        val baseUrl = ApiClient.getBaseServerUrl(this).trimEnd('/')
        val fullUrl = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) rawUrl else "$baseUrl/${rawUrl.trimStart('/')}"

        Thread {
            try {
                val client = OkHttpClient.Builder()
                    .connectTimeout(10, TimeUnit.SECONDS)
                    .readTimeout(10, TimeUnit.SECONDS)
                    .build()
                val req = Request.Builder().url(fullUrl).build()
                val resp = client.newCall(req).execute()
                if (resp.isSuccessful) {
                    val stream = resp.body()?.byteStream()
                    val bitmap = BitmapFactory.decodeStream(stream)
                    if (bitmap != null) {
                        runOnUiThread {
                            targetView.setImageBitmap(bitmap)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("PengurusKelas", "Error loading photo: ${e.message}")
            }
        }.start()
    }

    // ==================== TAB 3: LAPOR JAM KOSONG ====================
    private var currentEmptyHourSubject: String = ""
    private var currentEmptyHourTeacher: String = ""
    private var currentEmptyHourPeriod: String = ""

    private fun setupEmptyHourForm() {
        val className = sessionManager.getClassName().ifEmpty { "Kelas Anda" }
        binding.tvEmptyHourReporterInfo.text = "Pelapor: Pengurus Kelas $className (Otomatis tercatat resmi atas nama kelas)"

        val statusOptions = arrayOf(
            "⏳ Belum Hadir di Kelas",
            "📝 Meninggalkan Tugas Mandiri",
            "🏢 Izin / Dinas Luar Sekolah"
        )
        val spinnerAdapter = object : android.widget.ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, statusOptions) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                v.setTextColor(Color.parseColor("#0F172A"))
                v.textSize = 12.5f
                v.setTypeface(null, android.graphics.Typeface.BOLD)
                return v
            }
            override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getDropDownView(position, convertView, parent) as TextView
                v.setTextColor(Color.parseColor("#0F172A"))
                v.textSize = 13f
                v.setPadding(32, 24, 32, 24)
                return v
            }
        }
        binding.spinnerEmptyHourStatus.adapter = spinnerAdapter

        binding.btnSubmitEmptyHourReport.setOnClickListener {
            submitEmptyClassReport()
        }
    }

    private fun loadEmptyClassStatus() {
        val className = sessionManager.getClassName().ifEmpty { return }
        binding.tvEmptyHourTeacherName.text = "Memeriksa jadwal KBM..."
        binding.tvEmptyHourSubjectName.text = "Memeriksa jadwal KBM..."

        ApiClient.getClient(this).getEmptyClassStatus(className).enqueue(object : Callback<com.school.smartcbt.data.model.EmptyClassStatusResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.EmptyClassStatusResponse>,
                response: Response<com.school.smartcbt.data.model.EmptyClassStatusResponse>
            ) {
                if (response.isSuccessful && response.body() != null) {
                    val respBody = response.body()!!
                    currentEmptyHourTeacher = respBody.teacherName?.trim() ?: ""
                    currentEmptyHourSubject = respBody.subjectName?.trim() ?: ""
                    currentEmptyHourPeriod = respBody.periodLesson?.trim() ?: ""

                    // Sesuai instruksi: untuk jam ke, mapel, nama guru otomatis terisi jelas jika ada jadwal. Jika kosong/belum ada jadwal kosongkan dahulu.
                    if (currentEmptyHourTeacher.isNotEmpty()) {
                        binding.tvEmptyHourTeacherName.text = currentEmptyHourTeacher
                        binding.etEmptyHourTeacherInput.setText(currentEmptyHourTeacher)
                    } else {
                        binding.tvEmptyHourTeacherName.text = "(Belum Ada Jadwal)"
                        binding.etEmptyHourTeacherInput.setText("")
                    }

                    if (currentEmptyHourSubject.isNotEmpty()) {
                        binding.tvEmptyHourSubjectName.text = currentEmptyHourSubject
                        binding.etEmptyHourSubjectInput.setText(currentEmptyHourSubject)
                    } else {
                        binding.tvEmptyHourSubjectName.text = "(Belum Ada Jadwal)"
                        binding.etEmptyHourSubjectInput.setText("")
                    }

                    if (currentEmptyHourPeriod.isNotEmpty()) {
                        binding.tvEmptyHourPeriodLesson.text = currentEmptyHourPeriod
                        binding.etEmptyHourPeriodInput.setText(currentEmptyHourPeriod)
                    } else {
                        binding.tvEmptyHourPeriodLesson.text = "-"
                        binding.etEmptyHourPeriodInput.setText("")
                    }

                    if (respBody.isTeacherInClass) {
                        binding.tvEmptyHourBadgeStatus.text = "✅ Sedang di Kelas"
                        binding.tvEmptyHourBadgeStatus.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#D1FAE5"))
                        binding.tvEmptyHourBadgeStatus.setTextColor(Color.parseColor("#065F46"))
                    } else {
                        binding.tvEmptyHourBadgeStatus.text = "⏳ Belum Masuk Kelas"
                        binding.tvEmptyHourBadgeStatus.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#FEF3C7"))
                        binding.tvEmptyHourBadgeStatus.setTextColor(Color.parseColor("#92400E"))
                    }

                    renderRecentEmptyHourReports(respBody.recentReports ?: emptyList())
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.EmptyClassStatusResponse>, t: Throwable) {
                binding.tvEmptyHourTeacherName.text = "-"
                binding.tvEmptyHourSubjectName.text = "-"
                binding.tvEmptyHourPeriodLesson.text = "-"
                binding.etEmptyHourTeacherInput.setText("")
                binding.etEmptyHourSubjectInput.setText("")
                binding.etEmptyHourPeriodInput.setText("")
            }
        })
    }

    private fun renderRecentEmptyHourReports(reports: List<com.school.smartcbt.data.model.EmptyClassRecentReportDto>) {
        val container = binding.llRecentEmptyHourReports
        container.removeAllViews()

        if (reports.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada laporan jam kosong kelas hari ini."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(8, 12, 8, 12)
            }
            container.addView(tvEmpty)
            return
        }

        reports.forEach { r ->
            val card = androidx.cardview.widget.CardView(this).apply {
                radius = 10f * resources.displayMetrics.density
                cardElevation = 2f * resources.displayMetrics.density
                setCardBackgroundColor(Color.WHITE)
                val lp = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (10 * resources.displayMetrics.density).toInt()
                }
                layoutParams = lp
            }

            val ll = android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                val p = (14 * resources.displayMetrics.density).toInt()
                setPadding(p, p, p, p)
            }

            val headRow = android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val tvTitle = TextView(this).apply {
                layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                text = "📢 ${r.subjectName ?: "Mapel"} • ${r.periodLesson ?: "Jam KBM"}"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 13.5f
                setTypeface(null, android.graphics.Typeface.BOLD)
            }

            val statusStr = (r.status ?: "PENDING").uppercase()
            val (badgeText, badgeBg, badgeTextClr) = when {
                statusStr.contains("INVAL") -> Triple("👨‍🏫 Guru Inval", "#DCFCE7", "#15803D")
                statusStr.contains("TUGAS") -> Triple("📝 Tugas Mandiri", "#E0F2FE", "#0369A1")
                statusStr.contains("RESOLVED") -> Triple("✅ Selesai", "#DCFCE7", "#15803D")
                else -> Triple("⏳ Menunggu Respon", "#FEF3C7", "#B45309")
            }

            val tvStatusBadge = TextView(this).apply {
                text = badgeText
                textSize = 10.5f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(Color.parseColor(badgeTextClr))
                val shape = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(badgeBg))
                    cornerRadius = 8f * resources.displayMetrics.density
                }
                background = shape
                val hp = (8 * resources.displayMetrics.density).toInt()
                val vp = (3 * resources.displayMetrics.density).toInt()
                setPadding(hp, vp, hp, vp)
            }

            headRow.addView(tvTitle)
            headRow.addView(tvStatusBadge)
            ll.addView(headRow)

            val tvSub = TextView(this).apply {
                text = "Guru Terjadwal: ${r.scheduledTeacher ?: "-"}"
                setTextColor(Color.parseColor("#475569"))
                textSize = 12f
                setPadding(0, (4 * resources.displayMetrics.density).toInt(), 0, 0)
            }
            ll.addView(tvSub)

            if (!r.substituteTeacher.isNullOrBlank()) {
                val tvInval = TextView(this).apply {
                    text = "👨‍🏫 Guru Pengganti / Inval: ${r.substituteTeacher}"
                    setTextColor(Color.parseColor("#15803D"))
                    textSize = 11.5f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    setPadding(0, (3 * resources.displayMetrics.density).toInt(), 0, 0)
                }
                ll.addView(tvInval)
            }

            if (!r.assignmentDetails.isNullOrBlank()) {
                val tvTask = TextView(this).apply {
                    text = "📝 Tugas: ${r.assignmentDetails}"
                    setTextColor(Color.parseColor("#0284C7"))
                    textSize = 11.5f
                    setPadding(0, (3 * resources.displayMetrics.density).toInt(), 0, 0)
                }
                ll.addView(tvTask)
            }

            val tvFooter = TextView(this).apply {
                val handled = if (!r.handledBy.isNullOrBlank()) " • Tindakan: ${r.handledBy}" else " • Terhubung ke Guru Piket & Tim Kurikulum"
                text = "📍 ${r.reporterName ?: "Pengurus Kelas"}$handled"
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 10f
                setPadding(0, (6 * resources.displayMetrics.density).toInt(), 0, 0)
            }
            ll.addView(tvFooter)

            card.addView(ll)
            container.addView(card)
        }
    }

    private fun submitEmptyClassReport() {
        val className = sessionManager.getClassName().ifEmpty { "Kelas" }
        val notes = binding.etEmptyHourNotes.text.toString().trim()
        val pos = binding.spinnerEmptyHourStatus.selectedItemPosition
        val statusVal = when (pos) {
            1 -> "TUGAS_MANDIRI"
            2 -> "IZIN_DINAS"
            else -> "BELUM_HADIR"
        }

        val periodVal = binding.etEmptyHourPeriodInput.text.toString().trim().ifEmpty { currentEmptyHourPeriod.ifEmpty { "Jam KBM Berjalan" } }
        val subjectVal = binding.etEmptyHourSubjectInput.text.toString().trim().ifEmpty { currentEmptyHourSubject.ifEmpty { "Mata Pelajaran" } }
        val teacherVal = binding.etEmptyHourTeacherInput.text.toString().trim().ifEmpty { currentEmptyHourTeacher.ifEmpty { "Guru Pengampu" } }

        val body: MutableMap<String, Any?> = mutableMapOf(
            "className" to className,
            "periodLesson" to periodVal,
            "subjectName" to subjectVal,
            "scheduledTeacher" to teacherVal,
            "teacherStatus" to statusVal,
            "hasAssignment" to (statusVal == "TUGAS_MANDIRI"),
            "assignmentDetails" to notes,
            "targetDestination" to "BOTH"
        )

        val targetBtn = binding.btnSubmitEmptyHourReport
        val originalText = targetBtn.text.toString()

        binding.btnSubmitEmptyHourReport.isEnabled = false
        targetBtn.text = "Mengirim Laporan ke Piket & Kurikulum..."

        ApiClient.getClient(this).reportEmptyClass(body).enqueue(object : Callback<com.school.smartcbt.data.model.BasicResponse> {
            override fun onResponse(
                call: Call<com.school.smartcbt.data.model.BasicResponse>,
                response: Response<com.school.smartcbt.data.model.BasicResponse>
            ) {
                binding.btnSubmitEmptyHourReport.isEnabled = true
                targetBtn.text = originalText

                if (response.isSuccessful) {
                    TtsVoiceHelper.speak("Laporan kelas kosong berhasil dikirim ke Guru Piket dan Tim Kurikulum.")
                    AlertDialog.Builder(this@PengurusKelasActivity)
                        .setTitle("✅ Laporan Resmi Terkirim")
                        .setMessage("Laporan jam kelas kosong ($subjectVal - $teacherVal) telah resmi terkirim serentak ke Guru Piket dan Tim Kurikulum untuk segera ditindaklanjuti.")
                        .setPositiveButton("OK", null)
                        .show()
                    binding.etEmptyHourNotes.text?.clear()
                    loadEmptyClassStatus()
                } else {
                    val errMsg = try {
                        val json = JSONObject(response.errorBody()?.string() ?: "{}")
                        json.optString("message", "Gagal mengirim laporan")
                    } catch (e: Exception) {
                        "Gagal mengirim laporan"
                    }
                    TtsVoiceHelper.speak("Laporan jam kosong belum berhasil dikirim.")
                    Toast.makeText(this@PengurusKelasActivity, errMsg, Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<com.school.smartcbt.data.model.BasicResponse>, t: Throwable) {
                binding.btnSubmitEmptyHourReport.isEnabled = true
                targetBtn.text = originalText
                TtsVoiceHelper.speak("Koneksi gagal saat mengirim laporan.")
                Toast.makeText(this@PengurusKelasActivity, "Koneksi terputus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        stopDynamicQrPolling()
        dynamicQrTimer?.cancel()
        cameraExecutor.shutdown()
        locationManager?.removeUpdates(locationListener)
    }

    // ================= RECYCLERVIEW ADAPTER UNTUK PANTAU TEMAN =================
    private data class StatusBadgeInfo(val text: String, val bgHex: String, val textHex: String, val detail: String)

    inner class ClassmatesAdapter(private val items: List<ClassmateItemDto>) :
        RecyclerView.Adapter<ClassmatesAdapter.ViewHolder>() {

        inner class ViewHolder(val b: ItemPengurusKelasStudentBinding) : RecyclerView.ViewHolder(b.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val b = ItemPengurusKelasStudentBinding.inflate(LayoutInflater.from(parent.context), parent, false)
            return ViewHolder(b)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            val b = holder.b

            b.tvStudentName.text = item.name
            b.tvStudentNisn.text = "NISN: ${item.nisn ?: "-"} ${if (!item.classRole.isNullOrBlank()) "• [${item.classRole}]" else ""}"

            // Status Badge Kehadiran Presisi Rounded
            val density = resources.displayMetrics.density
            val statusUpper = item.status.uppercase()
            val info = when {
                statusUpper in listOf("LATE", "TERLAMBAT") -> StatusBadgeInfo(
                    "⚠️ Terlambat",
                    "#FEF3C7",
                    "#B45309",
                    "Masuk: ${item.gateInTime ?: item.timeStr} ${if (item.isAssisted) "• Dibantu Pengurus" else "• Langsung di Kelas"}"
                )
                statusUpper in listOf("PULANG") -> StatusBadgeInfo(
                    "🏠 Sudah Pulang",
                    "#E0E7FF",
                    "#3730A3",
                    "Pulang: ${item.gateOutTime ?: item.timeStr} (Masuk: ${item.gateInTime ?: "-"})"
                )
                statusUpper in listOf("PRESENT", "HADIR") -> StatusBadgeInfo(
                    "✅ Hadir Tepat",
                    "#DCFCE7",
                    "#15803D",
                    "Masuk: ${item.gateInTime ?: item.timeStr} ${if (item.isAssisted) "• Dibantu Pengurus" else "• Mandiri"}"
                )
                statusUpper in listOf("SICK", "SAKIT") -> StatusBadgeInfo(
                    "🏥 Sakit",
                    "#E0F2FE",
                    "#0369A1",
                    item.timeStr.ifEmpty { "Surat Izin Sakit Disetujui BK" }
                )
                statusUpper in listOf("PERMISSION", "IZIN") -> StatusBadgeInfo(
                    "📄 Izin Resmi",
                    "#FEF3C7",
                    "#B45309",
                    item.timeStr.ifEmpty { "Surat Izin Bepergian Disetujui BK" }
                )
                else -> StatusBadgeInfo(
                    "⏳ Belum Hadir",
                    "#F1F5F9",
                    "#64748B",
                    "Belum memindai presensi hari ini"
                )
            }

            b.tvAttendanceStatusBadge.text = info.text
            b.tvAttendanceStatusBadge.setTextColor(Color.parseColor(info.textHex))
            val badgeShape = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor(info.bgHex))
                cornerRadius = 6f * density
            }
            b.tvAttendanceStatusBadge.background = badgeShape
            val hp = (8 * density).toInt()
            val vp = (3 * density).toInt()
            b.tvAttendanceStatusBadge.setPadding(hp, vp, hp, vp)
            b.tvAttendanceTimeDetail.text = info.detail

            // Tampilkan Jam Masuk dan Pulang jika ada
            if (!item.gateInTime.isNullOrBlank() || item.isGateIn) {
                b.tvGateInBadge.visibility = View.VISIBLE
                b.tvGateInBadge.text = "📥 Masuk: ${item.gateInTime ?: item.timeStr}"
            } else {
                b.tvGateInBadge.visibility = View.GONE
            }

            if (!item.gateOutTime.isNullOrBlank() || item.isGateOut) {
                b.tvGateOutBadge.visibility = View.VISIBLE
                b.tvGateOutBadge.text = "📤 Pulang: ${item.gateOutTime ?: "-"}"
            } else {
                b.tvGateOutBadge.visibility = View.GONE
            }

            if (b.tvGateInBadge.visibility == View.VISIBLE || b.tvGateOutBadge.visibility == View.VISIBLE) {
                b.llGateTimeContainer.visibility = View.VISIBLE
            } else {
                b.llGateTimeContainer.visibility = View.GONE
            }

            // Flag sering dibantu
            if (item.isAssisted) {
                b.tvAssistedWarning.visibility = View.VISIBLE
                b.tvAssistedWarning.text = "🎖️ Presensi dibantu pengurus kelas"
            } else {
                b.tvAssistedWarning.visibility = View.GONE
            }

            loadStudentPhoto(item.profilePicUrl, b.ivStudentPhoto)
        }

        override fun getItemCount(): Int = items.size
    }

    // ================= BARCODE ANALYZER =================
    private class ContinuousBarcodeAnalyzer(private val onBarcodeFound: (String) -> Unit) : ImageAnalysis.Analyzer {
        private val options = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_QR_CODE,
                Barcode.FORMAT_CODE_128,
                Barcode.FORMAT_CODE_39,
                Barcode.FORMAT_EAN_13
            )
            .build()
        private val scanner = BarcodeScanning.getClient(options)

        @OptIn(ExperimentalGetImage::class)
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
}
