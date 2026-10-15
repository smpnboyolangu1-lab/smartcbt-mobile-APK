package com.school.smartcbt.ui

import android.Manifest
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import androidx.core.app.ActivityCompat
import com.school.smartcbt.R
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.utils.CamScannerHelper
import com.school.smartcbt.utils.SessionManager
import okhttp3.MediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import org.json.JSONObject
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors

class ParentBiodataActivity : AppCompatActivity() {

    private lateinit var sessionManager: SessionManager

    // Top Navigation & Banner
    private lateinit var btnBackBiodata: ImageButton
    private lateinit var btnRefreshBiodata: ImageButton
    private lateinit var tvBiodataSubtitle: TextView
    private lateinit var layoutStatusNotice: LinearLayout
    private lateinit var tvStatusNoticeIcon: TextView
    private lateinit var tvStatusNoticeTitle: TextView
    private lateinit var tvStatusNoticeDetail: TextView

    // Wizard Stepper Tabs
    private lateinit var stepTab1: TextView
    private lateinit var stepTab2: TextView
    private lateinit var stepTab3: TextView
    private lateinit var stepTab4: TextView
    private lateinit var stepTab5: TextView
    private lateinit var stepLine1: View
    private lateinit var stepLine2: View
    private lateinit var stepLine3: View
    private lateinit var stepLine4: View

    // Step Cards
    private lateinit var layoutStep1: CardView
    private lateinit var layoutStep2: CardView
    private lateinit var layoutStep3: CardView
    private lateinit var layoutStep4: CardView
    private lateinit var layoutStep5: CardView

    // Step 1: Identitas & Pas Foto
    private lateinit var ivStudentPhotoPreview: ImageView
    private lateinit var btnCameraPhoto: Button
    private lateinit var btnUploadPhoto: Button
    private lateinit var etStudentName: EditText
    private lateinit var etStudentNisn: EditText
    private lateinit var etStudentNik: EditText
    private lateinit var etStudentPob: EditText
    private lateinit var etStudentDob: EditText
    private lateinit var rgGender: RadioGroup
    private lateinit var rbMale: RadioButton
    private lateinit var rbFemale: RadioButton
    private lateinit var spReligion: Spinner

    // Step 2: Alamat & Koordinat GPS Maps
    private lateinit var btnGetGpsLocation: Button
    private lateinit var btnViewMap: Button
    private lateinit var btnOpenGmapsFull: Button
    private lateinit var etAddressLatitude: EditText
    private lateinit var etAddressLongitude: EditText
    private lateinit var wvMiniMapPreview: android.webkit.WebView
    private lateinit var llMiniMapPlaceholder: View
    private lateinit var etAddressStreet: EditText
    private lateinit var etAddressRt: EditText
    private lateinit var etAddressRw: EditText
    private lateinit var etAddressPostalCode: EditText
    private lateinit var etAddressVillage: EditText
    private lateinit var etAddressDistrict: EditText

    // Step 3: Orang Tua Kandung Sesuai Akta & Wali (Opsional)
    private lateinit var etFatherName: EditText
    private lateinit var rgFatherStatus: RadioGroup
    private lateinit var rbFatherAlive: RadioButton
    private lateinit var rbFatherDeceased: RadioButton
    private lateinit var etFatherJob: EditText
    private lateinit var etFatherIncome: EditText

    private lateinit var etMotherName: EditText
    private lateinit var rgMotherStatus: RadioGroup
    private lateinit var rbMotherAlive: RadioButton
    private lateinit var rbMotherDeceased: RadioButton
    private lateinit var etMotherJob: EditText
    private lateinit var etMotherIncome: EditText

    private lateinit var cbHasGuardian: CheckBox
    private lateinit var layoutGuardianSection: LinearLayout
    private lateinit var etGuardianName: EditText
    private lateinit var etGuardianNik: EditText
    private lateinit var spGuardianRelation: Spinner
    private lateinit var etGuardianJob: EditText
    private lateinit var etGuardianIncome: EditText
    private lateinit var etGuardianPhone: EditText

    private lateinit var etParentPhone: EditText

    // Step 4: Kesejahteraan (Opsional, Default: Tidak Punya)
    private lateinit var rgAssistanceStatus: RadioGroup
    private lateinit var rbNoAssistance: RadioButton
    private lateinit var rbHasAssistance: RadioButton
    private lateinit var layoutAssistanceDetails: LinearLayout
    private lateinit var spAssistanceType: Spinner
    private lateinit var etAssistanceNumber: EditText
    private lateinit var ivBantuanPreview: ImageView
    private lateinit var tvBantuanFileName: TextView
    private lateinit var tvBantuanStatusBadge: TextView
    private lateinit var btnCameraBantuan: Button
    private lateinit var btnUploadBantuan: Button

    // Step 5: Upload Berkas Dokumen (CamScanner PDF)
    private lateinit var ivKkPreview: ImageView
    private lateinit var tvKkFileName: TextView
    private lateinit var tvKkStatusBadge: TextView
    private lateinit var btnCameraKk: Button
    private lateinit var btnUploadKk: Button

    private lateinit var ivAktaPreview: ImageView
    private lateinit var tvAktaFileName: TextView
    private lateinit var tvAktaStatusBadge: TextView
    private lateinit var btnCameraAkta: Button
    private lateinit var btnUploadAkta: Button

    // Step 4 Kesejahteraan & Afirmasi Desil
    private lateinit var spDesil: Spinner
    private lateinit var ivDinsosPreview: ImageView
    private lateinit var tvDinsosFileName: TextView
    private lateinit var tvDinsosStatusBadge: TextView
    private lateinit var btnCameraDinsos: Button
    private lateinit var btnUploadDinsos: Button
    private var selectedDinsosFile: File? = null
    private var existingDinsosUrl: String? = null
    private lateinit var btnDownloadBiodataPdf: Button
    private lateinit var layoutDownloadPdfBanner: LinearLayout
    private lateinit var layoutEndPdfDownload: LinearLayout
    private lateinit var btnDownloadBiodataPdfEnd: Button
    private lateinit var cbAgreeStatement: CheckBox

    // Bottom Navigation
    private lateinit var btnPrevStep: Button
    private lateinit var spaceNav: View
    private lateinit var btnNextStep: Button

    private var currentStep = 1
    private var isFormLocked = false
    private var isApprovedSubmission = false

    private var existingPhotoUrl: String? = null
    private var existingKkUrl: String? = null
    private var existingAktaUrl: String? = null
    private var existingBantuanUrl: String? = null

    private var selectedPhotoFile: File? = null
    private var selectedKkFile: File? = null
    private var selectedAktaFile: File? = null
    private var selectedBantuanFile: File? = null

    private val religions = arrayOf("Islam", "Kristen Protestan", "Katolik", "Hindu", "Buddha", "Khonghucu")
    private val assistanceTypes = arrayOf("KIP (Kartu Indonesia Pintar)", "PKH (Program Keluarga Harapan)", "KKS (Kartu Keluarga Sejahtera)", "SKTM (Surat Keterangan Tidak Mampu)", "DTKS", "Lainnya")
    private val guardianRelations = arrayOf("Paman / Om", "Bibi / Tante", "Kakek", "Nenek", "Kakak Kandung", "Saudara", "Lainnya")

    private val imageExecutor = Executors.newFixedThreadPool(2)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var pendingCameraFile: File? = null
    private var pendingCameraTarget: String = "KK"

    // Launcher untuk berkas galeri / file picker
    private val pickPhotoLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { handlePhotoSelected(it) }
    }

    private val pickKkLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { handleFileSelected(it, targetType = "KK") }
    }

    private val pickAktaLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { handleFileSelected(it, targetType = "AKTA") }
    }

    private val pickBantuanLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { handleFileSelected(it, targetType = "BANTUAN") }
    }

    private val pickDinsosLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { handleFileSelected(it, targetType = "DINSOS") }
    }

    private val requestCameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            showBiometricCameraDialog()
        } else {
            Toast.makeText(this, "Izin kamera diperlukan untuk mengambil pasfoto biometrik", Toast.LENGTH_LONG).show()
        }
    }

    // Launcher kamera
    private val takePictureLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { success: Boolean ->
        if (success && pendingCameraFile != null && pendingCameraFile!!.exists()) {
            if (pendingCameraTarget == "FOTO") {
                processCapturedStudentPhoto(pendingCameraFile!!)
            } else {
                processCapturedDocumentCamScanner(pendingCameraFile!!, pendingCameraTarget)
            }
        }
    }

    // Launcher Google ML Kit Document Scanner (Murni PDF)
    private val docScannerLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            val scanResult = com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult.fromActivityResultIntent(result.data)
            val pdfUri = scanResult?.pdf?.uri
            if (pdfUri != null) {
                handleFileSelected(pdfUri, pendingCameraTarget)
            }
        }
    }

    private fun launchDocScanner(targetType: String) {
        pendingCameraTarget = targetType
        com.school.smartcbt.utils.GoogleDocScannerHelper.launchScanner(
            activity = this,
            launcher = docScannerLauncher,
            onFailure = { _ ->
                launchCamera(targetType)
            }
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_parent_biodata)
        com.school.smartcbt.utils.DialogHelper.applyDynamicFooter(this)
        sessionManager = SessionManager(this)

        initViews()
        setupSpinners()
        setupListeners()
        prefillInstantData() // << INSTANT 0ms: Nama & data lokal langsung muncul tanpa menunggu server!
        loadBiodataSubmission()
        updateStepView(1)
    }

    private fun initViews() {
        btnBackBiodata = findViewById(R.id.btnBackBiodata)
        btnRefreshBiodata = findViewById(R.id.btnRefreshBiodata)
        btnDownloadBiodataPdf = findViewById(R.id.btnDownloadBiodataPdf)
        tvBiodataSubtitle = findViewById(R.id.tvBiodataSubtitle)
        layoutStatusNotice = findViewById(R.id.layoutStatusNotice)
        tvStatusNoticeIcon = findViewById(R.id.tvStatusNoticeIcon)
        tvStatusNoticeTitle = findViewById(R.id.tvStatusNoticeTitle)
        tvStatusNoticeDetail = findViewById(R.id.tvStatusNoticeDetail)

        stepTab1 = findViewById(R.id.stepTab1)
        stepTab2 = findViewById(R.id.stepTab2)
        stepTab3 = findViewById(R.id.stepTab3)
        stepTab4 = findViewById(R.id.stepTab4)
        stepTab5 = findViewById(R.id.stepTab5)
        stepLine1 = findViewById(R.id.stepLine1)
        stepLine2 = findViewById(R.id.stepLine2)
        stepLine3 = findViewById(R.id.stepLine3)
        stepLine4 = findViewById(R.id.stepLine4)

        layoutStep1 = findViewById(R.id.layoutStep1)
        layoutStep2 = findViewById(R.id.layoutStep2)
        layoutStep3 = findViewById(R.id.layoutStep3)
        layoutStep4 = findViewById(R.id.layoutStep4)
        layoutStep5 = findViewById(R.id.layoutStep5)

        // Step 1: Identitas & Pas Foto
        ivStudentPhotoPreview = findViewById(R.id.ivStudentPhotoPreview)
        btnCameraPhoto = findViewById(R.id.btnCameraPhoto)
        btnUploadPhoto = findViewById(R.id.btnUploadPhoto)
        etStudentName = findViewById(R.id.etStudentName)
        // Kunci Nama Siswa & NISN (Read-Only dari Akun Resmi Sekolah)
        etStudentName.isEnabled = false
        etStudentName.isFocusable = false
        etStudentNisn = findViewById(R.id.etStudentNisn)
        etStudentNisn.isEnabled = false
        etStudentNisn.isFocusable = false

        etStudentNik = findViewById(R.id.etStudentNik)
        etStudentNik.filters = arrayOf(android.text.InputFilter.LengthFilter(16))
        etStudentPob = findViewById(R.id.etStudentPob)
        etStudentDob = findViewById(R.id.etStudentDob)
        rgGender = findViewById(R.id.rgGender)
        rbMale = findViewById(R.id.rbMale)
        rbFemale = findViewById(R.id.rbFemale)
        spReligion = findViewById(R.id.spReligion)

        // Step 2: Alamat & GPS Maps
        btnGetGpsLocation = findViewById(R.id.btnGetGpsLocation)
        btnViewMap = findViewById(R.id.btnViewMap)
        btnOpenGmapsFull = findViewById(R.id.btnOpenGmapsFull)
        etAddressLatitude = findViewById(R.id.etAddressLatitude)
        etAddressLongitude = findViewById(R.id.etAddressLongitude)
        wvMiniMapPreview = findViewById(R.id.wvMiniMapPreview)
        llMiniMapPlaceholder = findViewById(R.id.llMiniMapPlaceholder)
        etAddressStreet = findViewById(R.id.etAddressStreet)
        etAddressRt = findViewById(R.id.etAddressRt)
        etAddressRw = findViewById(R.id.etAddressRw)
        etAddressPostalCode = findViewById(R.id.etAddressPostalCode)
        etAddressVillage = findViewById(R.id.etAddressVillage)
        etAddressDistrict = findViewById(R.id.etAddressDistrict)

        setupMiniMapView()

        // Step 3: Orang Tua Kandung Sesuai Akta & Wali
        etFatherName = findViewById(R.id.etFatherName)
        rgFatherStatus = findViewById(R.id.rgFatherStatus)
        rbFatherAlive = findViewById(R.id.rbFatherAlive)
        rbFatherDeceased = findViewById(R.id.rbFatherDeceased)
        etFatherJob = findViewById(R.id.etFatherJob)
        etFatherIncome = findViewById(R.id.etFatherIncome)

        etMotherName = findViewById(R.id.etMotherName)
        rgMotherStatus = findViewById(R.id.rgMotherStatus)
        rbMotherAlive = findViewById(R.id.rbMotherAlive)
        rbMotherDeceased = findViewById(R.id.rbMotherDeceased)
        etMotherJob = findViewById(R.id.etMotherJob)
        etMotherIncome = findViewById(R.id.etMotherIncome)

        cbHasGuardian = findViewById(R.id.cbHasGuardian)
        layoutGuardianSection = findViewById(R.id.layoutGuardianSection)
        etGuardianName = findViewById(R.id.etGuardianName)
        etGuardianNik = findViewById(R.id.etGuardianNik)
        spGuardianRelation = findViewById(R.id.spGuardianRelation)
        etGuardianJob = findViewById(R.id.etGuardianJob)
        etGuardianIncome = findViewById(R.id.etGuardianIncome)
        etGuardianPhone = findViewById(R.id.etGuardianPhone)

        etParentPhone = findViewById(R.id.etParentPhone)

        // Step 4: Kesejahteraan
        rgAssistanceStatus = findViewById(R.id.rgAssistanceStatus)
        rbNoAssistance = findViewById(R.id.rbNoAssistance)
        rbHasAssistance = findViewById(R.id.rbHasAssistance)
        layoutAssistanceDetails = findViewById(R.id.layoutAssistanceDetails)
        spAssistanceType = findViewById(R.id.spAssistanceType)
        etAssistanceNumber = findViewById(R.id.etAssistanceNumber)
        ivBantuanPreview = findViewById(R.id.ivBantuanPreview)
        tvBantuanFileName = findViewById(R.id.tvBantuanFileName)
        tvBantuanStatusBadge = findViewById(R.id.tvBantuanStatusBadge)
        btnCameraBantuan = findViewById(R.id.btnCameraBantuan)
        btnUploadBantuan = findViewById(R.id.btnUploadBantuan)

        // Step 5: Dokumen CamScanner PDF
        ivKkPreview = findViewById(R.id.ivKkPreview)
        tvKkFileName = findViewById(R.id.tvKkFileName)
        tvKkStatusBadge = findViewById(R.id.tvKkStatusBadge)
        btnCameraKk = findViewById(R.id.btnCameraKk)
        btnUploadKk = findViewById(R.id.btnUploadKk)

        ivAktaPreview = findViewById(R.id.ivAktaPreview)
        tvAktaFileName = findViewById(R.id.tvAktaFileName)
        tvAktaStatusBadge = findViewById(R.id.tvAktaStatusBadge)
        btnCameraAkta = findViewById(R.id.btnCameraAkta)
        btnUploadAkta = findViewById(R.id.btnUploadAkta)

        spDesil = findViewById(R.id.spDesil)
        ivDinsosPreview = findViewById(R.id.ivDinsosPreview)
        tvDinsosFileName = findViewById(R.id.tvDinsosFileName)
        tvDinsosStatusBadge = findViewById(R.id.tvDinsosStatusBadge)
        btnCameraDinsos = findViewById(R.id.btnCameraDinsos)
        btnUploadDinsos = findViewById(R.id.btnUploadDinsos)
        cbAgreeStatement = findViewById(R.id.cbAgreeStatement)

        layoutDownloadPdfBanner = findViewById(R.id.layoutDownloadPdfBanner)
        layoutEndPdfDownload = findViewById(R.id.layoutEndPdfDownload)
        btnDownloadBiodataPdfEnd = findViewById(R.id.btnDownloadBiodataPdfEnd)
        layoutDownloadPdfBanner.visibility = View.GONE
        layoutEndPdfDownload.visibility = View.GONE

        // Bottom Nav
        btnPrevStep = findViewById(R.id.btnPrevStep)
        spaceNav = findViewById(R.id.spaceNav)
        btnNextStep = findViewById(R.id.btnNextStep)
    }

    private fun setupSpinners() {
        val relAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, religions)
        spReligion.adapter = relAdapter

        val astAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, assistanceTypes)
        spAssistanceType.adapter = astAdapter

        val grdAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, guardianRelations)
        spGuardianRelation.adapter = grdAdapter

        val desilList = arrayOf(
            "Bukan Penerima / Non-Desil",
            "Desil 1 (Sangat Miskin / Desil 1)",
            "Desil 2 (Miskin / Desil 2)",
            "Desil 3 (Hampir Miskin / Desil 3)",
            "Desil 4 (Rentan Miskin / Desil 4)",
            "Desil 5", "Desil 6", "Desil 7", "Desil 8", "Desil 9", "Desil 10"
        )
        val desilAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, desilList)
        spDesil.adapter = desilAdapter
    }

    private fun setupListeners() {
        btnBackBiodata.setOnClickListener { finish() }
        btnRefreshBiodata.setOnClickListener { loadBiodataSubmission() }
        btnDownloadBiodataPdf.setOnClickListener { downloadOrPrintBiodataPdf() }
        btnDownloadBiodataPdfEnd.setOnClickListener { downloadOrPrintBiodataPdf() }

        etStudentDob.setOnClickListener {
            if (!isFormLocked) showDatePicker()
        }

        // Foto Biometrik Wajah Siswa (Wajib Live Camera Langsung dengan Bingkai AI)
        btnCameraPhoto.setOnClickListener { if (!isFormLocked) launchBiometricCameraDialog() }
        btnUploadPhoto.setOnClickListener { 
            Toast.makeText(this, "Foto Biometrik wajib diambil langsung via Kamera HP (Live Camera).", Toast.LENGTH_SHORT).show()
        }

        // Tombol Ambil Lokasi GPS Rumah
        btnGetGpsLocation.setOnClickListener {
            if (!isFormLocked) fetchCurrentGpsLocation()
        }

        // Inisialisasi logika peta mini & tombol Google Maps
        setupMiniMapViewListeners()

        // Logika Ayah Sudah Meninggal -> Kunci Pekerjaan & Penghasilan
        rgFatherStatus.setOnCheckedChangeListener { _, checkedId ->
            if (checkedId == R.id.rbFatherDeceased) {
                etFatherJob.isEnabled = false
                etFatherJob.setText("Alm. (Meninggal)")
                etFatherIncome.isEnabled = false
                etFatherIncome.setText("Tidak Ada")
            } else {
                etFatherJob.isEnabled = true
                if (etFatherJob.text.toString() == "Alm. (Meninggal)") etFatherJob.setText("")
                etFatherIncome.isEnabled = true
                if (etFatherIncome.text.toString() == "Tidak Ada") etFatherIncome.setText("")
            }
        }

        // Logika Ibu Sudah Meninggal -> Kunci Pekerjaan & Penghasilan
        rgMotherStatus.setOnCheckedChangeListener { _, checkedId ->
            if (checkedId == R.id.rbMotherDeceased) {
                etMotherJob.isEnabled = false
                etMotherJob.setText("Almh. (Meninggal)")
                etMotherIncome.isEnabled = false
                etMotherIncome.setText("Tidak Ada")
            } else {
                etMotherJob.isEnabled = true
                if (etMotherJob.text.toString() == "Almh. (Meninggal)") etMotherJob.setText("")
                etMotherIncome.isEnabled = true
                if (etMotherIncome.text.toString() == "Tidak Ada") etMotherIncome.setText("")
            }
        }

        // Toggle Wali Siswa (Opsional)
        cbHasGuardian.setOnCheckedChangeListener { _, isChecked ->
            layoutGuardianSection.visibility = if (isChecked) View.VISIBLE else View.GONE
        }

        // Toggle Kesejahteraan (Punya vs Tidak Punya)
        rgAssistanceStatus.setOnCheckedChangeListener { _, checkedId ->
            val hasCard = (checkedId == R.id.rbHasAssistance)
            layoutAssistanceDetails.visibility = if (hasCard) View.VISIBLE else View.GONE
        }

        // Upload Berkas Buttons (Google ML Kit AI Doc Scanner & Murni PDF)
        btnCameraKk.setOnClickListener { if (!isFormLocked) launchDocScanner("KK") }
        btnUploadKk.setOnClickListener { if (!isFormLocked) pickKkLauncher.launch("application/pdf") }

        btnCameraAkta.setOnClickListener { if (!isFormLocked) launchDocScanner("AKTA") }
        btnUploadAkta.setOnClickListener { if (!isFormLocked) pickAktaLauncher.launch("application/pdf") }

        btnCameraBantuan.setOnClickListener { if (!isFormLocked) launchDocScanner("BANTUAN") }
        btnUploadBantuan.setOnClickListener { if (!isFormLocked) pickBantuanLauncher.launch("application/pdf") }

        btnCameraDinsos.setOnClickListener { if (!isFormLocked) launchDocScanner("DINSOS") }
        btnUploadDinsos.setOnClickListener { if (!isFormLocked) pickDinsosLauncher.launch("application/pdf") }

        // Navigation Buttons
        btnPrevStep.setOnClickListener {
            if (currentStep > 1) {
                updateStepView(currentStep - 1)
            }
        }

        btnNextStep.setOnClickListener {
            if (currentStep < 5) {
                if (validateStep(currentStep)) {
                    updateStepView(currentStep + 1)
                }
            } else {
                if (!isFormLocked) {
                    confirmAndSubmitBiodata()
                } else {
                    Toast.makeText(this, "Formulir telah disetujui TU dan terkunci (Read-Only)", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // Stepper Tab Clicks
        stepTab1.setOnClickListener { if (validateStep(currentStep) || currentStep > 1) updateStepView(1) }
        stepTab2.setOnClickListener { if (validateStep(1)) updateStepView(2) }
        stepTab3.setOnClickListener { if (validateStep(1) && validateStep(2)) updateStepView(3) }
        stepTab4.setOnClickListener { if (validateStep(1) && validateStep(2) && validateStep(3)) updateStepView(4) }
        stepTab5.setOnClickListener { if (validateStep(1) && validateStep(2) && validateStep(3) && validateStep(4)) updateStepView(5) }

        cbAgreeStatement.setOnCheckedChangeListener { _, isChecked ->
            updateStep5SubmitButton(isChecked)
            if (isChecked) {
                layoutEndPdfDownload.visibility = View.VISIBLE
                layoutDownloadPdfBanner.visibility = View.VISIBLE
            } else if (!isFormLocked && !isApprovedSubmission) {
                layoutEndPdfDownload.visibility = View.GONE
                layoutDownloadPdfBanner.visibility = View.GONE
            }
        }
    }

    private fun fetchCurrentGpsLocation() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 101)
            return
        }

        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val loc: Location? = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)

        if (loc != null) {
            val latStr = String.format(Locale.US, "%.6f", loc.latitude)
            val lngStr = String.format(Locale.US, "%.6f", loc.longitude)
            etAddressLatitude.setText(latStr)
            etAddressLongitude.setText(lngStr)

            // Auto-fill alamat via Geocoder
            try {
                val geocoder = Geocoder(this, Locale.getDefault())
                val addresses = geocoder.getFromLocation(loc.latitude, loc.longitude, 1)
                if (!addresses.isNullOrEmpty()) {
                    val addr = addresses[0]
                    if (etAddressStreet.text.isEmpty() && addr.thoroughfare != null) {
                        etAddressStreet.setText(addr.thoroughfare)
                    }
                    if (etAddressVillage.text.isEmpty() && addr.subLocality != null) {
                        etAddressVillage.setText(addr.subLocality)
                    }
                    if (etAddressDistrict.text.isEmpty() && addr.locality != null) {
                        etAddressDistrict.setText(addr.locality)
                    }
                    if (etAddressPostalCode.text.isEmpty() && addr.postalCode != null) {
                        etAddressPostalCode.setText(addr.postalCode)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }

            Toast.makeText(this, "📍 Titik koordinat GPS berhasil dicatat ($latStr, $lngStr)", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Pastikan GPS perangkat Anda aktif untuk mengambil titik rumah", Toast.LENGTH_LONG).show()
        }
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private fun setupMiniMapView() {
        wvMiniMapPreview.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = true
            allowContentAccess = true
        }
        wvMiniMapPreview.webViewClient = object : android.webkit.WebViewClient() {
            override fun onReceivedSslError(view: android.webkit.WebView?, handler: android.webkit.SslErrorHandler?, error: android.net.http.SslError?) {
                handler?.proceed()
            }
            override fun shouldOverrideUrlLoading(view: android.webkit.WebView?, request: android.webkit.WebResourceRequest?): Boolean {
                return false
            }
        }
    }

    private fun setupMiniMapViewListeners() {
        val openGmaps = {
            val lat = etAddressLatitude.text.toString().trim()
            val lng = etAddressLongitude.text.toString().trim()
            if (lat.isNotEmpty() && lng.isNotEmpty()) {
                val mapUri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(Rumah+Siswa)")
                val intent = Intent(Intent.ACTION_VIEW, mapUri)
                try {
                    startActivity(intent)
                } catch (e: Exception) {
                    val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=$lat,$lng"))
                    startActivity(browserIntent)
                }
            } else {
                Toast.makeText(this, "Tekan 'Ambil Lokasi GPS' terlebih dahulu", Toast.LENGTH_SHORT).show()
            }
        }

        btnViewMap.setOnClickListener { openGmaps() }
        btnOpenGmapsFull.setOnClickListener { openGmaps() }

        val coordWatcher = object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                tryUpdateMiniMapFromInputs()
            }
        }
        etAddressLatitude.addTextChangedListener(coordWatcher)
        etAddressLongitude.addTextChangedListener(coordWatcher)
        tryUpdateMiniMapFromInputs()
    }

    private fun tryUpdateMiniMapFromInputs() {
        val latStr = etAddressLatitude.text.toString().trim()
        val lngStr = etAddressLongitude.text.toString().trim()
        val lat = latStr.toDoubleOrNull()
        val lng = lngStr.toDoubleOrNull()
        if (lat != null && lng != null && lat != 0.0 && lng != 0.0) {
            renderMiniMap(lat, lng)
        } else {
            llMiniMapPlaceholder.visibility = View.VISIBLE
        }
    }

    private fun renderMiniMap(lat: Double, lng: Double) {
        runOnUiThread {
            llMiniMapPlaceholder.visibility = View.GONE
            val minLng = lng - 0.005
            val minLat = lat - 0.004
            val maxLng = lng + 0.005
            val maxLat = lat + 0.004
            val embedSrc = "https://www.openstreetmap.org/export/embed.html?bbox=$minLng%2C$minLat%2C$maxLng%2C$maxLat&amp;layer=mapnik&amp;marker=$lat%2C$lng"
            val html = """
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
                    <style>
                        body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: #e2e8f0; }
                        iframe { border: none; width: 100%; height: 100%; }
                    </style>
                </head>
                <body>
                    <iframe src="$embedSrc"></iframe>
                </body>
                </html>
            """.trimIndent()
            wvMiniMapPreview.loadDataWithBaseURL("https://www.openstreetmap.org", html, "text/html", "UTF-8", null)
        }
    }

    private fun launchBiometricCameraDialog() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestCameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            return
        }
        showBiometricCameraDialog()
    }

    private fun showBiometricCameraDialog() {
        val dialog = android.app.Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        dialog.setContentView(R.layout.dialog_biometric_camera)

        val previewView = dialog.findViewById<androidx.camera.view.PreviewView>(R.id.biometricPreviewView)
        val btnClose = dialog.findViewById<ImageButton>(R.id.btnBioClose)
        val btnSwitch = dialog.findViewById<ImageButton>(R.id.btnBioSwitchCamera)
        val btnCapture = dialog.findViewById<ImageButton>(R.id.btnBioCapture)

        var cameraSelector = androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA
        var imageCapture: androidx.camera.core.ImageCapture? = null
        val cameraExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()

        fun startCamera() {
            val cameraProviderFuture = androidx.camera.lifecycle.ProcessCameraProvider.getInstance(this)
            cameraProviderFuture.addListener({
                try {
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = androidx.camera.core.Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                    imageCapture = androidx.camera.core.ImageCapture.Builder()
                        .setCaptureMode(androidx.camera.core.ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                        .build()

                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        this,
                        cameraSelector,
                        preview,
                        imageCapture
                    )
                } catch (e: Exception) {
                    if (cameraSelector == androidx.camera.core.CameraSelector.DEFAULT_FRONT_CAMERA) {
                        cameraSelector = androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA
                        try {
                            val cameraProvider = cameraProviderFuture.get()
                            val preview = androidx.camera.core.Preview.Builder().build().also {
                                it.setSurfaceProvider(previewView.surfaceProvider)
                            }
                            imageCapture = androidx.camera.core.ImageCapture.Builder().build()
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture)
                        } catch (_: Exception) {}
                    }
                }
            }, androidx.core.content.ContextCompat.getMainExecutor(this))
        }

        startCamera()

        btnSwitch.setOnClickListener {
            cameraSelector = if (cameraSelector == androidx.camera.core.CameraSelector.DEFAULT_FRONT_CAMERA) {
                androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA
            } else {
                androidx.camera.core.CameraSelector.DEFAULT_FRONT_CAMERA
            }
            startCamera()
        }

        btnClose.setOnClickListener {
            dialog.dismiss()
        }

        btnCapture.setOnClickListener {
            val capture = imageCapture ?: return@setOnClickListener
            btnCapture.isEnabled = false
            val photoFile = File(cacheDir, "foto_biometrik_${System.currentTimeMillis()}.jpg")
            val outputOptions = androidx.camera.core.ImageCapture.OutputFileOptions.Builder(photoFile).build()

            capture.takePicture(
                outputOptions,
                cameraExecutor,
                object : androidx.camera.core.ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(output: androidx.camera.core.ImageCapture.OutputFileResults) {
                        runOnUiThread {
                            dialog.dismiss()
                            processCapturedStudentPhoto(photoFile)
                        }
                    }

                    override fun onError(exc: androidx.camera.core.ImageCaptureException) {
                        runOnUiThread {
                            btnCapture.isEnabled = true
                            Toast.makeText(this@ParentBiodataActivity, "Gagal mengambil foto: ${exc.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            )
        }

        dialog.setOnDismissListener {
            cameraExecutor.shutdown()
            val cameraProviderFuture = androidx.camera.lifecycle.ProcessCameraProvider.getInstance(this)
            try {
                cameraProviderFuture.get().unbindAll()
            } catch (_: Exception) {}
        }

        dialog.show()
    }

    private fun launchCamera(targetType: String) {
        pendingCameraTarget = targetType
        val prefix = when (targetType) {
            "FOTO" -> "foto_siswa_"
            "KK" -> "raw_kk_"
            "AKTA" -> "raw_akta_"
            else -> "raw_bantuan_"
        }
        val photoFile = File(cacheDir, "${prefix}${System.currentTimeMillis()}.jpg")
        pendingCameraFile = photoFile
        val photoUri = androidx.core.content.FileProvider.getUriForFile(
            this,
            "com.school.smartcbt.fileprovider",
            photoFile
        )
        takePictureLauncher.launch(photoUri)
    }

    private fun handlePhotoSelected(uri: Uri) {
        try {
            contentResolver.openInputStream(uri)?.use { input ->
                val bmp = BitmapFactory.decodeStream(input)
                if (bmp != null) {
                    showReviewPhotoDialog(bmp)
                } else {
                    Toast.makeText(this, "Format gambar tidak dikenali", Toast.LENGTH_SHORT).show()
                }
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal memproses foto siswa: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun processCapturedStudentPhoto(photoFile: File) {
        val bmp = BitmapFactory.decodeFile(photoFile.absolutePath)
        if (bmp != null) {
            Toast.makeText(this, "🤖 AI mendeteksi wajah & memproses latar belakang biru...", Toast.LENGTH_SHORT).show()
            com.school.smartcbt.utils.PhotoSegmentationHelper.processSelfieToBlueBackground(
                bitmap = bmp,
                onSuccess = { blueBmp ->
                    val passportBmp = com.school.smartcbt.utils.PhotoSegmentationHelper.cropToPassportRatio(blueBmp)
                    runOnUiThread {
                        showReviewPhotoDialog(passportBmp)
                    }
                },
                onError = { _ ->
                    val fallbackBmp = CamScannerHelper.createPasFoto3x4(bmp)
                    runOnUiThread {
                        showReviewPhotoDialog(fallbackBmp)
                    }
                }
            )
        } else {
            Toast.makeText(this, "Gagal membaca hasil kamera", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showReviewPhotoDialog(bitmap: Bitmap) {
        var currentBmp = bitmap

        val density = resources.displayMetrics.density
        val pad = (16 * density).toInt()

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            gravity = Gravity.CENTER_HORIZONTAL
        }

        val tvDesc = TextView(this).apply {
            text = "Pas foto otomatis disesuaikan ke rasio 3x4 dengan latar belakang biru resmi (#0078D4). Anda dapat memutar orientasi jika posisi foto miring."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, (10 * density).toInt())
            gravity = Gravity.CENTER
        }
        rootLayout.addView(tvDesc)

        val ivPreview = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams((150 * density).toInt(), (200 * density).toInt()).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
            scaleType = ImageView.ScaleType.FIT_CENTER
            setImageBitmap(currentBmp)
            setBackgroundColor(com.school.smartcbt.utils.PhotoSegmentationHelper.OFFICIAL_BLUE_COLOR)
        }
        rootLayout.addView(ivPreview)

        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, (12 * density).toInt(), 0, 0)
            gravity = Gravity.CENTER
        }

        val btnRotate = Button(this).apply {
            text = "🔄 Putar 90°"
            textSize = 12f
            setOnClickListener {
                currentBmp = CamScannerHelper.rotateBitmap(currentBmp, 90f)
                ivPreview.setImageBitmap(currentBmp)
            }
        }
        btnRow.addView(btnRotate)

        val space = View(this).apply {
            layoutParams = LinearLayout.LayoutParams((12 * density).toInt(), 1)
        }
        btnRow.addView(space)

        val btnRetake = Button(this).apply {
            text = "📸 Foto Ulang"
            textSize = 12f
        }
        btnRow.addView(btnRetake)

        rootLayout.addView(btnRow)

        val dialog = AlertDialog.Builder(this)
            .setTitle("👤 Konfirmasi Foto Biometrik Wajah")
            .setView(rootLayout)
            .setPositiveButton("✅ Gunakan Foto Biometrik Ini") { _, _ ->
                val savedFile = CamScannerHelper.saveBitmapToJpeg(this@ParentBiodataActivity, currentBmp, "foto_biometrik_siswa_${System.currentTimeMillis()}")
                selectedPhotoFile = savedFile
                ivStudentPhotoPreview.setImageBitmap(currentBmp)
                Toast.makeText(this@ParentBiodataActivity, "✅ Foto biometrik wajah siswa berhasil diambil", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Batal", null)
            .create()

        btnRetake.setOnClickListener {
            dialog.dismiss()
            launchCamera("FOTO")
        }

        dialog.show()
    }

    private fun processCapturedDocumentCamScanner(photoFile: File, targetType: String) {
        val bmp = BitmapFactory.decodeFile(photoFile.absolutePath)
        if (bmp != null) {
            showReviewDocumentDialog(bmp, targetType)
        } else {
            Toast.makeText(this, "Gagal memuat hasil jepretan kamera", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showReviewDocumentDialog(bitmap: Bitmap, targetType: String) {
        var currentBmp = CamScannerHelper.applyCamScannerFilter(bitmap)

        val density = resources.displayMetrics.density
        val pad = (16 * density).toInt()

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            gravity = Gravity.CENTER_HORIZONTAL
        }

        val docLabel = when (targetType) {
            "KK" -> "Kartu Keluarga (KK)"
            "AKTA" -> "Akta Kelahiran"
            else -> "Kartu Bantuan Sosial"
        }

        val tvDesc = TextView(this).apply {
            text = "Kontras berkas $docLabel telah dipertajam layaknya CamScanner. Pastikan teks terbaca jelas dan posisi tegak lurus."
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, (8 * density).toInt())
            gravity = Gravity.CENTER
        }
        rootLayout.addView(tvDesc)

        val ivPreview = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (250 * density).toInt())
            scaleType = ImageView.ScaleType.FIT_CENTER
            setImageBitmap(currentBmp)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }
        rootLayout.addView(ivPreview)

        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, (10 * density).toInt(), 0, 0)
            gravity = Gravity.CENTER
        }

        val btnRotate = Button(this).apply {
            text = "🔄 Putar 90°"
            textSize = 12f
            setOnClickListener {
                currentBmp = CamScannerHelper.rotateBitmap(currentBmp, 90f)
                ivPreview.setImageBitmap(currentBmp)
            }
        }
        btnRow.addView(btnRotate)

        val space = View(this).apply {
            layoutParams = LinearLayout.LayoutParams((12 * density).toInt(), 1)
        }
        btnRow.addView(space)

        val btnRetake = Button(this).apply {
            text = "📸 Foto Ulang"
            textSize = 12f
        }
        btnRow.addView(btnRetake)

        rootLayout.addView(btnRow)

        val dialog = AlertDialog.Builder(this)
            .setTitle("📄 Review Scan Berkas ($docLabel)")
            .setView(rootLayout)
            .setPositiveButton("✅ Gunakan & Jadikan PDF") { _, _ ->
                val prefix = targetType.lowercase()
                val pdfFile = CamScannerHelper.convertBitmapToDocumentPdf(
                    this@ParentBiodataActivity,
                    currentBmp,
                    "${prefix}_camscanner_${System.currentTimeMillis()}"
                )

                when (targetType) {
                    "KK" -> {
                        selectedKkFile = pdfFile
                        tvKkFileName.text = "📄 Berkas KK (CamScanner PDF): ${pdfFile.name}"
                        tvKkStatusBadge.text = "✅ Dokumen PDF Siap Kirim"
                        tvKkStatusBadge.setTextColor(Color.parseColor("#059669"))
                        ivKkPreview.setImageBitmap(currentBmp)
                    }
                    "AKTA" -> {
                        selectedAktaFile = pdfFile
                        tvAktaFileName.text = "📄 Berkas Akta (CamScanner PDF): ${pdfFile.name}"
                        tvAktaStatusBadge.text = "✅ Dokumen PDF Siap Kirim"
                        tvAktaStatusBadge.setTextColor(Color.parseColor("#059669"))
                        ivAktaPreview.setImageBitmap(currentBmp)
                    }
                    "BANTUAN" -> {
                        selectedBantuanFile = pdfFile
                        tvBantuanFileName.text = "📄 Kartu Bantuan (CamScanner PDF): ${pdfFile.name}"
                        tvBantuanStatusBadge.text = "✅ Dokumen PDF Siap Kirim"
                        tvBantuanStatusBadge.setTextColor(Color.parseColor("#059669"))
                        ivBantuanPreview.setImageBitmap(currentBmp)
                    }
                    "DINSOS" -> {
                        selectedDinsosFile = pdfFile
                        tvDinsosFileName.text = "📄 Surat Dinsos (CamScanner PDF): ${pdfFile.name}"
                        tvDinsosStatusBadge.text = "✅ Surat Dinsos Siap Kirim"
                        tvDinsosStatusBadge.setTextColor(Color.parseColor("#059669"))
                        ivDinsosPreview.setImageBitmap(currentBmp)
                    }
                }
                Toast.makeText(this@ParentBiodataActivity, "📸 Berkas $docLabel berhasil dijadikan PDF CamScanner!", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Batal", null)
            .create()

        btnRetake.setOnClickListener {
            dialog.dismiss()
            launchCamera(targetType)
        }

        dialog.show()
    }

    private fun handleFileSelected(uri: Uri, targetType: String) {
        try {
            val mimeType = contentResolver.getType(uri)
            val isPdf = mimeType?.contains("pdf", ignoreCase = true) == true ||
                    uri.toString().lowercase().endsWith(".pdf") ||
                    (uri.path?.lowercase()?.endsWith(".pdf") == true)

            if (!isPdf) {
                Toast.makeText(this, "⚠️ Format Ditolak! Dokumen $targetType wajib berformat PDF murni (.pdf). Silakan pilih berkas PDF dari penyimpanan atau gunakan tombol kamera untuk Scan Otomatis.", Toast.LENGTH_LONG).show()
                return
            }

            val fileNamePrefix = "${targetType.lowercase()}_upload_"
            val tempFile = File(cacheDir, "$fileNamePrefix${System.currentTimeMillis()}.pdf")
            contentResolver.openInputStream(uri)?.use { inputStream ->
                FileOutputStream(tempFile).use { outputStream ->
                    inputStream.copyTo(outputStream)
                }
            }

            when (targetType) {
                "KK" -> {
                    selectedKkFile = tempFile
                    tvKkFileName.text = "📄 Berkas KK: ${tempFile.name}"
                    tvKkStatusBadge.text = "✅ Dokumen PDF Siap Kirim"
                    tvKkStatusBadge.setTextColor(Color.parseColor("#059669"))
                    ivKkPreview.setImageResource(R.drawable.ic_journal_book)
                }
                "AKTA" -> {
                    selectedAktaFile = tempFile
                    tvAktaFileName.text = "📄 Berkas Akta: ${tempFile.name}"
                    tvAktaStatusBadge.text = "✅ Dokumen PDF Siap Kirim"
                    tvAktaStatusBadge.setTextColor(Color.parseColor("#059669"))
                    ivAktaPreview.setImageResource(R.drawable.ic_journal_book)
                }
                "BANTUAN" -> {
                    selectedBantuanFile = tempFile
                    tvBantuanFileName.text = "📄 Kartu Bantuan: ${tempFile.name}"
                    tvBantuanStatusBadge.text = "✅ Dokumen PDF Siap Kirim"
                    tvBantuanStatusBadge.setTextColor(Color.parseColor("#059669"))
                    ivBantuanPreview.setImageResource(R.drawable.ic_journal_book)
                }
                "DINSOS" -> {
                    selectedDinsosFile = tempFile
                    tvDinsosFileName.text = "📄 Surat Dinsos: ${tempFile.name}"
                    tvDinsosStatusBadge.text = "✅ Surat Dinsos Siap Kirim"
                    tvDinsosStatusBadge.setTextColor(Color.parseColor("#059669"))
                    ivDinsosPreview.setImageResource(R.drawable.ic_journal_book)
                }
            }
            Toast.makeText(this, "✅ Berkas PDF ($targetType) siap dikirim", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal memproses berkas: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun showDatePicker() {
        val calendar = Calendar.getInstance()
        val currentText = etStudentDob.text.toString().trim()
        if (currentText.isNotEmpty()) {
            try {
                val sdf = if (currentText.contains("-") && currentText.indexOf("-") == 2) {
                    SimpleDateFormat("dd-MM-yyyy", Locale.getDefault())
                } else {
                    SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                }
                val d = sdf.parse(currentText)
                if (d != null) calendar.time = d
            } catch (e: Exception) {}
        }

        val dpd = DatePickerDialog(
            this,
            { _, year, month, dayOfMonth ->
                val selectedCal = Calendar.getInstance().apply {
                    set(year, month, dayOfMonth)
                }
                val format = SimpleDateFormat("dd-MM-yyyy", Locale.getDefault())
                etStudentDob.setText(format.format(selectedCal.time))
            },
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH)
        )
        dpd.show()
    }

    private fun updateStepView(step: Int) {
        currentStep = step

        layoutStep1.visibility = if (step == 1) View.VISIBLE else View.GONE
        layoutStep2.visibility = if (step == 2) View.VISIBLE else View.GONE
        layoutStep3.visibility = if (step == 3) View.VISIBLE else View.GONE
        layoutStep4.visibility = if (step == 4) View.VISIBLE else View.GONE
        layoutStep5.visibility = if (step == 5) View.VISIBLE else View.GONE

        // Update Nav Buttons
        btnPrevStep.visibility = if (step > 1) View.VISIBLE else View.GONE
        btnPrevStep.text = "⬅️ Sebelumnya"
        spaceNav.visibility = if (step > 1) View.VISIBLE else View.GONE

        if (step == 5) {
            btnNextStep.text = "🚀 SELESAI & KIRIM BERKAS"
            btnNextStep.setBackgroundResource(android.R.drawable.btn_default)
            updateStep5SubmitButton(cbAgreeStatement.isChecked)
        } else {
            btnNextStep.isEnabled = true
            btnNextStep.text = "Lanjut ke Step ${step + 1} ›"
            btnNextStep.setBackgroundResource(android.R.drawable.btn_default)
            btnNextStep.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#2563EB"))
            btnNextStep.setTextColor(Color.WHITE)
        }

        // Update Wizard Indicators
        val activeBg = ColorStateList.valueOf(Color.parseColor("#2563EB"))
        val inactiveBg = ColorStateList.valueOf(Color.parseColor("#E2E8F0"))

        val tabs = listOf(stepTab1, stepTab2, stepTab3, stepTab4, stepTab5)
        val lines = listOf(stepLine1, stepLine2, stepLine3, stepLine4)

        tabs.forEachIndexed { idx, tv ->
            val tabNum = idx + 1
            if (tabNum <= step) {
                tv.backgroundTintList = activeBg
                tv.setTextColor(Color.WHITE)
            } else {
                tv.backgroundTintList = inactiveBg
                tv.setTextColor(Color.parseColor("#64748B"))
            }
        }

        lines.forEachIndexed { idx, line ->
            line.setBackgroundColor(if (idx + 1 < step) Color.parseColor("#2563EB") else Color.parseColor("#E2E8F0"))
        }
    }

    private fun updateStep5SubmitButton(isChecked: Boolean) {
        if (currentStep == 5) {
            if (isChecked) {
                btnNextStep.isEnabled = true
                btnNextStep.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#2563EB"))
                btnNextStep.setTextColor(Color.WHITE)
            } else {
                btnNextStep.isEnabled = false
                btnNextStep.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#94A3B8"))
                btnNextStep.setTextColor(Color.parseColor("#F1F5F9"))
            }
        }
    }

    private fun validateStep(step: Int): Boolean {
        when (step) {
            1 -> {
                if (etStudentName.text.toString().trim().isEmpty()) {
                    etStudentName.error = "Nama Lengkap wajib diisi"
                    return false
                }
                val cleanNik = etStudentNik.text.toString().trim()
                if (cleanNik.length != 16) {
                    etStudentNik.error = "NIK wajib tepat 16 digit sesuai KK (Saat ini: ${cleanNik.length} digit)"
                    return false
                }
                if (etStudentPob.text.toString().trim().isEmpty()) {
                    etStudentPob.error = "Tempat Lahir wajib diisi"
                    return false
                }
                if (etStudentDob.text.toString().trim().isEmpty()) {
                    etStudentDob.error = "Tanggal Lahir wajib diisi"
                    return false
                }
                if (selectedPhotoFile == null && (existingPhotoUrl == null || existingPhotoUrl.isNullOrEmpty())) {
                    Toast.makeText(this, "⚠️ Foto Biometrik Wajah Wajib diambil via Kamera sebelum lanjut!", Toast.LENGTH_LONG).show()
                    return false
                }
            }
            2 -> {
                if (etAddressStreet.text.toString().trim().isEmpty()) {
                    etAddressStreet.error = "Alamat jalan / dusun wajib diisi"
                    return false
                }
                if (etAddressRt.text.toString().trim().isEmpty()) {
                    etAddressRt.error = "RT wajib diisi"
                    return false
                }
                if (etAddressRw.text.toString().trim().isEmpty()) {
                    etAddressRw.error = "RW wajib diisi"
                    return false
                }
                if (etAddressVillage.text.toString().trim().isEmpty()) {
                    etAddressVillage.error = "Desa / Kelurahan wajib diisi"
                    return false
                }
                if (etAddressDistrict.text.toString().trim().isEmpty()) {
                    etAddressDistrict.error = "Kecamatan wajib diisi"
                    return false
                }
            }
            3 -> {
                if (etFatherName.text.toString().trim().isEmpty()) {
                    etFatherName.error = "Nama Ayah Kandung wajib diisi"
                    return false
                }
                if (etMotherName.text.toString().trim().isEmpty()) {
                    etMotherName.error = "Nama Ibu Kandung wajib diisi"
                    return false
                }
                if (etParentPhone.text.toString().trim().length < 9) {
                    etParentPhone.error = "Nomor WhatsApp aktif wajib diisi"
                    return false
                }
                if (cbHasGuardian.isChecked && etGuardianName.text.toString().trim().isEmpty()) {
                    etGuardianName.error = "Nama wali wajib diisi jika dicentang"
                    return false
                }
            }
            4 -> {
                // Seluruh data bantuan sosial, nomor kartu, desil, dan surat Dinsos bersifat opsional
            }
            5 -> {
                if (selectedKkFile == null && existingKkUrl.isNullOrEmpty()) {
                    Toast.makeText(this, "⚠️ Berkas Kartu Keluarga (KK) wajib diunggah!", Toast.LENGTH_LONG).show()
                    return false
                }
                if (selectedAktaFile == null && existingAktaUrl.isNullOrEmpty()) {
                    Toast.makeText(this, "⚠️ Berkas Akta Kelahiran siswa wajib diunggah!", Toast.LENGTH_LONG).show()
                    return false
                }
                if (!cbAgreeStatement.isChecked) {
                    Toast.makeText(this, "⚠️ Harap centang surat pernyataan keabsahan data sebelum mengirim!", Toast.LENGTH_LONG).show()
                    return false
                }
            }
        }
        return true
    }

    private fun loadBiodataSubmission() {
        ApiClient.getClient(this).getMyBiodataSubmission().enqueue(object : Callback<MyBiodataResponse> {
            override fun onResponse(call: Call<MyBiodataResponse>, response: Response<MyBiodataResponse>) {
                if (response.isSuccessful) {
                    val body = response.body()
                    val submission = body?.submission
                    val student = body?.student
                    val isToggleOpen = body?.isToggleOpen ?: true
                    val status = submission?.status ?: "DRAFT"
                    val isLocked = body?.isLocked ?: (status == "APPROVED")

                    isFormLocked = isLocked
                    isApprovedSubmission = (status == "APPROVED")

                    student?.let { populateStudentDefaults(it) }
                    submission?.let { 
                        populateExistingSubmission(it)
                        saveBiodataCache(it, student)
                    }

                    renderStatusBanner(status, isToggleOpen, isLocked, submission?.rejectionReason)

                    if (isFormLocked) {
                        lockFormFields()
                    }
                } else {
                    Toast.makeText(this@ParentBiodataActivity, "Gagal memuat status formulir", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<MyBiodataResponse>, t: Throwable) {
                Toast.makeText(this@ParentBiodataActivity, "Koneksi offline / server tidak merespon", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun prefillInstantData() {
        // 1. Langsung isi Nama dan NISN dari session manager (0 milidetik!)
        var sessionName = sessionManager.getName().trim()
        sessionName = sessionName.replace(Regex("^(Orang Tua / Wali|Orang Tua|Wali)\\s*", RegexOption.IGNORE_CASE), "").trim()
        val sessionNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }.replace(Regex("^[Pp]"), "")
        if (sessionName.isNotEmpty() && !sessionName.equals("null", ignoreCase = true)) {
            etStudentName.setText(sessionName)
        }
        if (sessionNisn.isNotEmpty() && !sessionNisn.equals("null", ignoreCase = true)) {
            etStudentNisn.setText(sessionNisn)
        }

        // 2. Baca cache lokal SharedPreferences agar data lengkap langsung muncul tanpa jeda
        try {
            val prefs = getSharedPreferences("SmartCbtBiodataCache", Context.MODE_PRIVATE)
            val cachedStr = prefs.getString("cache_${sessionNisn}", null)
            if (!cachedStr.isNullOrEmpty()) {
                val json = JSONObject(cachedStr)
                if (json.has("studentName") && etStudentName.text.isEmpty()) etStudentName.setText(json.optString("studentName"))
                if (json.has("studentNisn") && etStudentNisn.text.isEmpty()) etStudentNisn.setText(json.optString("studentNisn"))
                if (json.has("studentNik") && etStudentNik.text.isEmpty()) etStudentNik.setText(json.optString("studentNik"))
                if (json.has("studentPob") && etStudentPob.text.isEmpty()) etStudentPob.setText(json.optString("studentPob"))
                if (json.has("studentDob") && etStudentDob.text.isEmpty()) etStudentDob.setText(json.optString("studentDob"))

                val dummySub = BiodataSubmissionDto(
                    id = "cached",
                    studentId = sessionManager.getUserId(),
                    status = "DRAFT",
                    rejectionReason = null,
                    step1Data = json.optString("step1").ifEmpty { null },
                    step2Data = json.optString("step2").ifEmpty { null },
                    step3Data = json.optString("step3").ifEmpty { null },
                    step4Data = json.optString("step4").ifEmpty { null },
                    step5Data = json.optString("step5").ifEmpty { null },
                    kkFileUrl = json.optString("kkUrl").ifEmpty { null },
                    aktaFileUrl = json.optString("aktaUrl").ifEmpty { null },
                    submittedAt = null,
                    reviewedAt = null,
                    reviewedBy = null
                )
                populateExistingSubmission(dummySub)
            }
        } catch (e: Exception) {}
    }

    private fun saveBiodataCache(sub: BiodataSubmissionDto, st: StudentBriefDto?) {
        try {
            val sessionNisn = sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }
            val prefs = getSharedPreferences("SmartCbtBiodataCache", Context.MODE_PRIVATE)
            val json = JSONObject().apply {
                put("step1", sub.step1Data ?: "")
                put("step2", sub.step2Data ?: "")
                put("step3", sub.step3Data ?: "")
                put("step4", sub.step4Data ?: "")
                put("step5", sub.step5Data ?: "")
                put("kkUrl", sub.kkFileUrl ?: "")
                put("aktaUrl", sub.aktaFileUrl ?: "")
                put("bantuanUrl", "")
                st?.let { s ->
                    put("studentName", s.name ?: "")
                    put("studentNisn", s.nisn ?: "")
                    put("studentNik", s.nik ?: "")
                    put("studentPob", s.pob ?: "")
                    put("studentDob", s.dob ?: "")
                    put("studentGender", s.gender ?: "")
                    put("studentReligion", s.religion ?: "")
                }
            }
            prefs.edit().putString("cache_${sessionNisn}", json.toString()).apply()
        } catch (e: Exception) {}
    }

    private fun populateStudentDefaults(st: StudentBriefDto) {
        if (etStudentName.text.isEmpty()) etStudentName.setText(st.name ?: "")
        if (etStudentNisn.text.isEmpty()) etStudentNisn.setText(st.nisn ?: "")
        if (etStudentNik.text.isEmpty()) etStudentNik.setText(st.nik ?: "")
        if (etStudentPob.text.isEmpty()) etStudentPob.setText(st.pob ?: "")
        if (etStudentDob.text.isEmpty()) etStudentDob.setText(st.dob ?: "")
        if (st.gender == "L") rbMale.isChecked = true else if (st.gender == "P") rbFemale.isChecked = true

        val rIdx = religions.indexOfFirst { it.equals(st.religion, ignoreCase = true) }
        if (rIdx != -1) spReligion.setSelection(rIdx)

        if (etFatherName.text.isEmpty()) etFatherName.setText(st.fatherName ?: "")
        if (etMotherName.text.isEmpty()) etMotherName.setText(st.motherName ?: "")
        if (etParentPhone.text.isEmpty()) etParentPhone.setText(st.parentPhone ?: "")
    }

    private fun populateExistingSubmission(sub: BiodataSubmissionDto) {
        existingKkUrl = sub.kkFileUrl
        existingAktaUrl = sub.aktaFileUrl

        try {
            sub.step1Data?.let { raw ->
                val json = JSONObject(raw)
                if (json.has("nama")) etStudentName.setText(json.optString("nama"))
                if (json.has("nisn")) etStudentNisn.setText(json.optString("nisn"))
                if (json.has("nik")) etStudentNik.setText(json.optString("nik"))
                if (json.has("tempatLahir")) etStudentPob.setText(json.optString("tempatLahir"))
                if (json.has("tanggalLahir")) etStudentDob.setText(json.optString("tanggalLahir"))
                if (json.optString("jenisKelamin") == "L") rbMale.isChecked = true else rbFemale.isChecked = true
                val rIdx = religions.indexOfFirst { it.equals(json.optString("agama"), ignoreCase = true) }
                if (rIdx != -1) spReligion.setSelection(rIdx)

                if (json.has("fotoUrl") && json.optString("fotoUrl").isNotEmpty()) {
                    existingPhotoUrl = json.optString("fotoUrl")
                    loadRemoteImage(existingPhotoUrl!!, ivStudentPhotoPreview)
                }
            }

            sub.step2Data?.let { raw ->
                val json = JSONObject(raw)
                if (json.has("alamat")) etAddressStreet.setText(json.optString("alamat"))
                if (json.has("latitude")) etAddressLatitude.setText(json.optString("latitude"))
                if (json.has("longitude")) etAddressLongitude.setText(json.optString("longitude"))
                if (json.has("rt")) etAddressRt.setText(json.optString("rt"))
                if (json.has("rw")) etAddressRw.setText(json.optString("rw"))
                if (json.has("kodePos")) etAddressPostalCode.setText(json.optString("kodePos"))
                if (json.has("desa")) etAddressVillage.setText(json.optString("desa"))
                if (json.has("kecamatan")) etAddressDistrict.setText(json.optString("kecamatan"))
            }

            sub.step3Data?.let { raw ->
                val json = JSONObject(raw)
                if (json.has("namaAyah")) etFatherName.setText(json.optString("namaAyah"))
                if (json.optString("statusAyah") == "Sudah Meninggal") {
                    rbFatherDeceased.isChecked = true
                    etFatherJob.isEnabled = false
                    etFatherIncome.isEnabled = false
                } else {
                    rbFatherAlive.isChecked = true
                }
                if (json.has("pekerjaanAyah")) etFatherJob.setText(json.optString("pekerjaanAyah"))
                if (json.has("penghasilanAyah")) etFatherIncome.setText(json.optString("penghasilanAyah"))

                if (json.has("namaIbu")) etMotherName.setText(json.optString("namaIbu"))
                if (json.optString("statusIbu") == "Sudah Meninggal") {
                    rbMotherDeceased.isChecked = true
                    etMotherJob.isEnabled = false
                    etMotherIncome.isEnabled = false
                } else {
                    rbMotherAlive.isChecked = true
                }
                if (json.has("pekerjaanIbu")) etMotherJob.setText(json.optString("pekerjaanIbu"))
                if (json.has("penghasilanIbu")) etMotherIncome.setText(json.optString("penghasilanIbu"))

                if (json.optBoolean("hasGuardian", false)) {
                    cbHasGuardian.isChecked = true
                    layoutGuardianSection.visibility = View.VISIBLE
                    if (json.has("namaWali")) etGuardianName.setText(json.optString("namaWali"))
                    if (json.has("nikWali")) etGuardianNik.setText(json.optString("nikWali"))
                    if (json.has("pekerjaanWali")) etGuardianJob.setText(json.optString("pekerjaanWali"))
                    if (json.has("penghasilanWali")) etGuardianIncome.setText(json.optString("penghasilanWali"))
                    if (json.has("noHpWali")) etGuardianPhone.setText(json.optString("noHpWali"))
                }

                if (json.has("noHpOrtu")) etParentPhone.setText(json.optString("noHpOrtu"))
            }

            sub.step4Data?.let { raw ->
                val json = JSONObject(raw)
                val desilVal = json.optInt("desil", 0)
                if (desilVal in 1..10) {
                    spDesil.setSelection(desilVal)
                }

                if (json.has("dinsosFileUrl") && json.optString("dinsosFileUrl").isNotEmpty()) {
                    existingDinsosUrl = json.optString("dinsosFileUrl")
                    tvDinsosFileName.text = "📄 Surat Dinsos Tersimpan di Server TU"
                    tvDinsosStatusBadge.text = "✅ Tersimpan di Server"
                    tvDinsosStatusBadge.setTextColor(Color.parseColor("#059669"))
                    loadRemoteImage(existingDinsosUrl!!, ivDinsosPreview)
                }

                val noKip = json.optString("noKip", "").trim()
                val assistanceNum = json.optString("assistanceNumber", "").trim()
                val hasExplicit = json.optBoolean("hasAssistance", false)
                val hasCard = hasExplicit ||
                    (noKip.isNotEmpty() && noKip != "-" && noKip != "null" && !noKip.equals("tidak", ignoreCase = true)) ||
                    (assistanceNum.isNotEmpty() && assistanceNum != "-" && assistanceNum != "null" && !assistanceNum.equals("tidak", ignoreCase = true))

                if (hasCard) {
                    rbHasAssistance.isChecked = true
                    rbNoAssistance.isChecked = false
                    layoutAssistanceDetails.visibility = View.VISIBLE

                    val astType = json.optString("assistanceType", "KIP (Kartu Indonesia Pintar)")
                    val aIdx = assistanceTypes.indexOfFirst { it.startsWith(astType.take(3), ignoreCase = true) }
                    if (aIdx != -1) spAssistanceType.setSelection(aIdx)

                    val num = json.optString("assistanceNumber", json.optString("noKip", json.optString("noPkh", "")))
                    etAssistanceNumber.setText(num)

                    if (json.has("bantuanFileUrl") && json.optString("bantuanFileUrl").isNotEmpty()) {
                        existingBantuanUrl = json.optString("bantuanFileUrl")
                        tvBantuanFileName.text = "📄 Kartu Bantuan Tersimpan di Server TU"
                        loadRemoteImage(existingBantuanUrl!!, ivBantuanPreview)
                    }
                } else {
                    rbNoAssistance.isChecked = true
                    rbHasAssistance.isChecked = false
                    layoutAssistanceDetails.visibility = View.GONE
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        if (!sub.kkFileUrl.isNullOrEmpty()) {
            tvKkFileName.text = "📄 Berkas Kartu Keluarga Tersimpan di Server TU"
            tvKkStatusBadge.text = "✅ Dokumen PDF Tersimpan"
            tvKkStatusBadge.setTextColor(Color.parseColor("#059669"))
            loadRemoteImage(sub.kkFileUrl, ivKkPreview)
        }
        if (!sub.aktaFileUrl.isNullOrEmpty()) {
            tvAktaFileName.text = "📄 Berkas Akta Kelahiran Tersimpan di Server TU"
            tvAktaStatusBadge.text = "✅ Dokumen PDF Tersimpan"
            tvAktaStatusBadge.setTextColor(Color.parseColor("#059669"))
            loadRemoteImage(sub.aktaFileUrl, ivAktaPreview)
        }
    }

    private fun renderStatusBanner(status: String, isToggleOpen: Boolean, isLocked: Boolean, rejectionReason: String?) {
        layoutStatusNotice.visibility = View.VISIBLE

        val isAlreadyApprovedOrSubmitted = status == "APPROVED" || status == "VERIFIED" || status == "SUBMITTED" || isLocked
        if (isAlreadyApprovedOrSubmitted) {
            layoutDownloadPdfBanner.visibility = View.VISIBLE
            layoutEndPdfDownload.visibility = View.VISIBLE
            cbAgreeStatement.isChecked = true
        } else {
            if (!cbAgreeStatement.isChecked) {
                layoutDownloadPdfBanner.visibility = View.GONE
                layoutEndPdfDownload.visibility = View.GONE
            }
        }

        when {
            status == "APPROVED" || isLocked -> {
                layoutStatusNotice.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#D1FAE5"))
                tvStatusNoticeIcon.text = "✅"
                tvStatusNoticeTitle.text = "STATUS: DISETUJUI & DISINKRONKAN TU"
                tvStatusNoticeTitle.setTextColor(Color.parseColor("#065F46"))
                tvStatusNoticeDetail.text = "Data biodata ananda telah sah diverifikasi oleh Staf TU dan disinkronkan ke pangkalan data sekolah. Formulir terkunci (Read-Only)."
                tvStatusNoticeDetail.setTextColor(Color.parseColor("#047857"))
            }
            status == "REJECTED" -> {
                layoutStatusNotice.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FEE2E2"))
                tvStatusNoticeIcon.text = "❌"
                tvStatusNoticeTitle.text = "STATUS: PERLU PERBAIKAN FORMULIR"
                tvStatusNoticeTitle.setTextColor(Color.parseColor("#991B1B"))
                tvStatusNoticeDetail.text = "Catatan Petugas TU: ${rejectionReason ?: "Mohon perbaiki data yang belum lengkap dan unggah foto asli dokumen."}"
                tvStatusNoticeDetail.setTextColor(Color.parseColor("#B91C1C"))
            }
            status == "PENDING" -> {
                layoutStatusNotice.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FEF3C7"))
                tvStatusNoticeIcon.text = "⏳"
                tvStatusNoticeTitle.text = "STATUS: MENUNGGU VERIFIKASI STAF TU"
                tvStatusNoticeTitle.setTextColor(Color.parseColor("#92400E"))
                tvStatusNoticeDetail.text = "Data tersimpan di antrean validasi TU SMPN 1 Boyolangu. Anda masih dapat memperbarui data sebelum disetujui."
                tvStatusNoticeDetail.setTextColor(Color.parseColor("#B45309"))
            }
            !isToggleOpen -> {
                layoutStatusNotice.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FEE2E2"))
                tvStatusNoticeIcon.text = "🔒"
                tvStatusNoticeTitle.text = "PERIODE PENGISIAN DITUTUP"
                tvStatusNoticeTitle.setTextColor(Color.parseColor("#991B1B"))
                tvStatusNoticeDetail.text = "Periode pengisian biodata sedang ditutup oleh pihak sekolah. Hubungi pihak Tata Usaha untuk info lebih lanjut."
                tvStatusNoticeDetail.setTextColor(Color.parseColor("#B91C1C"))
            }
            else -> {
                layoutStatusNotice.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#EFF6FF"))
                tvStatusNoticeIcon.text = "📝"
                tvStatusNoticeTitle.text = "STATUS: FORMULIR BELUM DIKIRIM"
                tvStatusNoticeTitle.setTextColor(Color.parseColor("#1E40AF"))
                tvStatusNoticeDetail.text = "Lengkapi 5 langkah identitas dan berkas pendukung, kemudian tekan 'SELESAI & KIRIM BERKAS'."
                tvStatusNoticeDetail.setTextColor(Color.parseColor("#1D4ED8"))
            }
        }
    }

    private fun lockFormFields() {
        val viewsToLock = listOf<View>(
            btnCameraPhoto, btnUploadPhoto,
            etStudentName, etStudentNisn, etStudentNik, etStudentPob, etStudentDob,
            rbMale, rbFemale, spReligion,
            btnGetGpsLocation, etAddressLatitude, etAddressLongitude,
            etAddressStreet, etAddressRt, etAddressRw, etAddressPostalCode, etAddressVillage, etAddressDistrict,
            etFatherName, rbFatherAlive, rbFatherDeceased, etFatherJob, etFatherIncome,
            etMotherName, rbMotherAlive, rbMotherDeceased, etMotherJob, etMotherIncome,
            cbHasGuardian, etGuardianName, etGuardianNik, spGuardianRelation, etGuardianJob, etGuardianIncome, etGuardianPhone,
            etParentPhone,
            rbNoAssistance, rbHasAssistance, spAssistanceType, etAssistanceNumber,
            btnCameraBantuan, btnUploadBantuan,
            btnCameraKk, btnUploadKk,
            btnCameraAkta, btnUploadAkta,
            spDesil, btnCameraDinsos, btnUploadDinsos
        )
        for (v in viewsToLock) {
            v.isEnabled = false
            v.isFocusable = false
            if (v is EditText) {
                v.setTextColor(Color.parseColor("#334155"))
            }
        }
        btnNextStep.isEnabled = currentStep < 5
    }

    private fun confirmAndSubmitBiodata() {
        if (!validateStep(5)) return

        AlertDialog.Builder(this)
            .setTitle("Selesai & Kirim Berkas?")
            .setMessage("Apakah seluruh data identitas pribadi, titik lokasi rumah (GPS), data orang tua kandung/wali, foto siswa 3x4, serta dokumen hasil scan PDF sudah benar?\n\nBerkas resmi akan diserahkan ke TU SMPN 1 Boyolangu untuk diverifikasi.")
            .setPositiveButton("🚀 Ya, Selesai & Kirim") { _, _ ->
                executeSubmission()
            }
            .setNegativeButton("Periksa Lagi", null)
            .show()
    }

    private fun executeSubmission() {
        val s1Json = JSONObject().apply {
            put("nama", etStudentName.text.toString().trim())
            put("nisn", etStudentNisn.text.toString().trim())
            put("nik", etStudentNik.text.toString().trim())
            put("tempatLahir", etStudentPob.text.toString().trim())
            put("tanggalLahir", etStudentDob.text.toString().trim())
            put("jenisKelamin", if (rbMale.isChecked) "L" else "P")
            put("agama", spReligion.selectedItem?.toString() ?: "Islam")
        }.toString()

        val s2Json = JSONObject().apply {
            put("alamat", etAddressStreet.text.toString().trim())
            put("latitude", etAddressLatitude.text.toString().trim())
            put("longitude", etAddressLongitude.text.toString().trim())
            put("rt", etAddressRt.text.toString().trim())
            put("rw", etAddressRw.text.toString().trim())
            put("kodePos", etAddressPostalCode.text.toString().trim())
            put("desa", etAddressVillage.text.toString().trim())
            put("kecamatan", etAddressDistrict.text.toString().trim())
        }.toString()

        val s3Json = JSONObject().apply {
            put("namaAyah", etFatherName.text.toString().trim())
            put("statusAyah", if (rbFatherDeceased.isChecked) "Sudah Meninggal" else "Masih Hidup")
            put("pekerjaanAyah", etFatherJob.text.toString().trim())
            put("penghasilanAyah", etFatherIncome.text.toString().trim())

            put("namaIbu", etMotherName.text.toString().trim())
            put("statusIbu", if (rbMotherDeceased.isChecked) "Sudah Meninggal" else "Masih Hidup")
            put("pekerjaanIbu", etMotherJob.text.toString().trim())
            put("penghasilanIbu", etMotherIncome.text.toString().trim())

            put("hasGuardian", cbHasGuardian.isChecked)
            if (cbHasGuardian.isChecked) {
                put("namaWali", etGuardianName.text.toString().trim())
                put("nikWali", etGuardianNik.text.toString().trim())
                put("hubunganWali", spGuardianRelation.selectedItem?.toString() ?: "Wali")
                put("pekerjaanWali", etGuardianJob.text.toString().trim())
                put("penghasilanWali", etGuardianIncome.text.toString().trim())
                put("noHpWali", etGuardianPhone.text.toString().trim())
            }

            put("noHpOrtu", etParentPhone.text.toString().trim())
        }.toString()

        val s4Json = JSONObject().apply {
            val hasCard = rbHasAssistance.isChecked
            put("hasAssistance", hasCard)
            val selectedDesil = spDesil.selectedItem?.toString() ?: "Bukan Penerima / Non-Desil"
            val desilNum = when {
                selectedDesil.startsWith("Desil 10") -> 10
                selectedDesil.startsWith("Desil 1") -> 1
                selectedDesil.startsWith("Desil 2") -> 2
                selectedDesil.startsWith("Desil 3") -> 3
                selectedDesil.startsWith("Desil 4") -> 4
                selectedDesil.startsWith("Desil 5") -> 5
                selectedDesil.startsWith("Desil 6") -> 6
                selectedDesil.startsWith("Desil 7") -> 7
                selectedDesil.startsWith("Desil 8") -> 8
                selectedDesil.startsWith("Desil 9") -> 9
                else -> 0
            }
            put("desil", desilNum)
            if (hasCard) {
                put("assistanceType", spAssistanceType.selectedItem?.toString() ?: "KIP")
                put("assistanceNumber", etAssistanceNumber.text.toString().trim())
                put("bantuanFileUploaded", selectedBantuanFile != null || !existingBantuanUrl.isNullOrEmpty())
            }
            put("dinsosFileUploaded", selectedDinsosFile != null || !existingDinsosUrl.isNullOrEmpty())
        }.toString()

        val s5Json = JSONObject().apply {
            put("kkUploaded", selectedKkFile != null || !existingKkUrl.isNullOrEmpty())
            put("aktaUploaded", selectedAktaFile != null || !existingAktaUrl.isNullOrEmpty())
        }.toString()

        val textType = MediaType.parse("text/plain")
        val s1Body = RequestBody.create(textType, s1Json)
        val s2Body = RequestBody.create(textType, s2Json)
        val s3Body = RequestBody.create(textType, s3Json)
        val s4Body = RequestBody.create(textType, s4Json)
        val s5Body = RequestBody.create(textType, s5Json)

        var photoPart: MultipartBody.Part? = null
        selectedPhotoFile?.let { file ->
            val requestFile = RequestBody.create(MediaType.parse("image/jpeg"), file)
            photoPart = MultipartBody.Part.createFormData("foto", file.name, requestFile)
        }

        var kkPart: MultipartBody.Part? = null
        selectedKkFile?.let { file ->
            val mime = if (file.name.endsWith(".pdf", ignoreCase = true)) "application/pdf" else "image/jpeg"
            val requestFile = RequestBody.create(MediaType.parse(mime), file)
            kkPart = MultipartBody.Part.createFormData("kk", file.name, requestFile)
        }

        var aktaPart: MultipartBody.Part? = null
        selectedAktaFile?.let { file ->
            val mime = if (file.name.endsWith(".pdf", ignoreCase = true)) "application/pdf" else "image/jpeg"
            val requestFile = RequestBody.create(MediaType.parse(mime), file)
            aktaPart = MultipartBody.Part.createFormData("akta", file.name, requestFile)
        }

        var bantuanPart: MultipartBody.Part? = null
        selectedBantuanFile?.let { file ->
            val mime = if (file.name.endsWith(".pdf", ignoreCase = true)) "application/pdf" else "image/jpeg"
            val requestFile = RequestBody.create(MediaType.parse(mime), file)
            bantuanPart = MultipartBody.Part.createFormData("bantuan", file.name, requestFile)
        }

        var dinsosPart: MultipartBody.Part? = null
        selectedDinsosFile?.let { file ->
            val mime = if (file.name.endsWith(".pdf", ignoreCase = true)) "application/pdf" else "image/jpeg"
            val requestFile = RequestBody.create(MediaType.parse(mime), file)
            dinsosPart = MultipartBody.Part.createFormData("dinsos", file.name, requestFile)
        }

        btnNextStep.isEnabled = false
        btnNextStep.text = "⏳ Menyerahkan Berkas ke TU..."

        ApiClient.getClient(this).submitBiodata(
            s1Body, s2Body, s3Body, s4Body, s5Body, kkPart, aktaPart, bantuanPart, photoPart, dinsosPart
        ).enqueue(object : Callback<BiodataSubmissionResponse> {
            override fun onResponse(call: Call<BiodataSubmissionResponse>, response: Response<BiodataSubmissionResponse>) {
                btnNextStep.isEnabled = true
                btnNextStep.text = "🚀 SELESAI & KIRIM BERKAS"

                if (response.isSuccessful && response.body()?.success == true) {
                    layoutDownloadPdfBanner.visibility = View.VISIBLE
                    layoutEndPdfDownload.visibility = View.VISIBLE
                    AlertDialog.Builder(this@ParentBiodataActivity)
                        .setTitle("🎉 Berhasil Diserahkan ke TU")
                        .setMessage("Formulir biodata lengkap, titik koordinat GPS, peta lokasi rumah, foto 3x4 latar biru, dan dokumen PDF berhasil diserahkan ke Tata Usaha SMPN 1 Boyolangu.\n\nApakah Anda ingin mengunduh / mencetak berkas Formulir Biodata & Surat Pernyataan (PDF 3 Halaman) sekarang?")
                        .setPositiveButton("📥 Cetak / Unduh PDF") { _, _ ->
                            loadBiodataSubmission()
                            downloadOrPrintBiodataPdf()
                        }
                        .setNegativeButton("Tutup & Selesai") { _, _ ->
                            loadBiodataSubmission()
                        }
                        .setCancelable(false)
                        .show()
                } else {
                    val errMsg = response.errorBody()?.string() ?: response.body()?.message ?: "Pengiriman formulir gagal"
                    Toast.makeText(this@ParentBiodataActivity, "Gagal: $errMsg", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<BiodataSubmissionResponse>, t: Throwable) {
                btnNextStep.isEnabled = true
                btnNextStep.text = "🚀 SELESAI & KIRIM BERKAS"
                Toast.makeText(this@ParentBiodataActivity, "Kesalahan jaringan: ${t.message}", Toast.LENGTH_LONG).show()
            }
        })
    }

    private fun loadRemoteImage(url: String, imageView: ImageView) {
        imageExecutor.execute {
            try {
                val fullUrl = if (url.startsWith("http")) url else ApiClient.getFullApiBaseUrl(this) + url
                val conn = java.net.URL(fullUrl).openConnection()
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                val bitmap = BitmapFactory.decodeStream(conn.getInputStream())
                if (bitmap != null) {
                    mainHandler.post {
                        imageView.setImageBitmap(bitmap)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun downloadOrPrintBiodataPdf() {
        val studentId = etStudentNisn.text.toString().trim().ifEmpty {
            sessionManager.getNisn().ifEmpty { sessionManager.getUsername() }
        }
        val baseUrl = ApiClient.getBaseServerUrl(this).trimEnd('/')
        val pdfUrl = "$baseUrl/api/biodata/download/$studentId"

        try {
            val intent = Intent(this, PdfViewerActivity::class.java).apply {
                putExtra(PdfViewerActivity.EXTRA_URL, pdfUrl)
                putExtra("EXTRA_FILE_URL", pdfUrl)
                putExtra(PdfViewerActivity.EXTRA_TITLE, "Formulir & Surat Pernyataan Resmi (PDF 3 Halaman)")
                putExtra(PdfViewerActivity.EXTRA_DOC_TYPE, "BIODATA")
            }
            startActivity(intent)
        } catch (e: Exception) {
            try {
                val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(pdfUrl))
                startActivity(browserIntent)
            } catch (ex: Exception) {
                Toast.makeText(this, "Gagal membuka berkas PDF: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
