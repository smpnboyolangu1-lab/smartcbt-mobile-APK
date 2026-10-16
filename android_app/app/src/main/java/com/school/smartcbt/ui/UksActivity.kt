package com.school.smartcbt.ui

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityUksBinding
import com.school.smartcbt.utils.SessionManager
import org.json.JSONArray
import org.json.JSONObject
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class UksActivity : AppCompatActivity() {

    private lateinit var binding: ActivityUksBinding
    private lateinit var sessionManager: SessionManager

    companion object {
        const val EXTRA_STUDENT_ID = "extra_student_id"
        const val EXTRA_STUDENT_NAME = "extra_student_name"
        const val EXTRA_CLASS_NAME = "extra_class_name"
        const val EXTRA_IS_PARENT = "extra_is_parent"
        const val KEY_UKS_EMERGENCY_CONTACTS = "key_uks_emergency_contacts_json"
    }

    private var targetStudentId: String? = null
    private var isParentMode: Boolean = false
    private var isMedicalAdmin: Boolean = false
    private var currentStudentAllergies: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityUksBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)

        targetStudentId = intent.getStringExtra(EXTRA_STUDENT_ID)
        isParentMode = intent.getBooleanExtra(EXTRA_IS_PARENT, false)

        binding.btnBackUks.setOnClickListener { finish() }
        binding.btnRefreshUks.setOnClickListener { loadUksData() }
        binding.btnUpdateUks.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }
        binding.btnUksEmergencyCall.setOnClickListener {
            showEmergencyDialDialog()
        }
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)

        val userRole = sessionManager.getRole().uppercase()
        val isTeacher = userRole == "TEACHER" || userRole == "GURU"
        isMedicalAdmin = intent.getBooleanExtra("EXTRA_IS_ADMIN", false) || userRole == "MEDICAL" || userRole == "ADMIN"

        if (isMedicalAdmin) {
            binding.cardUksBeds.visibility = View.VISIBLE
            binding.btnUksReportSick.visibility = View.VISIBLE
            binding.btnUksReportSick.text = "+ Triase / Rawat Pasien"
            binding.btnUksReportSick.setOnClickListener { showReportSickDialog() }
            binding.tvUksStudentName.text = "Petugas UKS: " + sessionManager.getName()
            binding.tvUksStudentClass.text = "Unit Kesehatan Sekolah (UKS)"
        } else if (isTeacher) {
            binding.cardUksBeds.visibility = View.GONE
            binding.btnUksReportSick.visibility = View.GONE
            binding.tvUksStudentName.text = sessionManager.getName()
            binding.tvUksStudentClass.text = "Kelas " + sessionManager.getClassName()
        } else if (isParentMode) {
            binding.btnUksReportSick.visibility = View.GONE
            val childName = intent.getStringExtra(EXTRA_STUDENT_NAME)?.ifEmpty { null } ?: sessionManager.getName().ifEmpty { "Ananda" }
            val className = intent.getStringExtra(EXTRA_CLASS_NAME)?.ifEmpty { null } ?: sessionManager.getClassName().ifEmpty { "-" }
            binding.tvUksStudentName.text = childName
            binding.tvUksStudentClass.text = "Kelas $className"
        } else {
            binding.btnUksReportSick.visibility = View.VISIBLE
            binding.btnUksReportSick.setOnClickListener { showReportSickDialog() }
            binding.tvUksStudentName.text = sessionManager.getName()
            binding.tvUksStudentClass.text = "Kelas " + sessionManager.getClassName()
        }

        setupUksTabs()
        loadUksData()
    }

    private var currentUksTab: Int = 0

    private fun setupUksTabs() {
        binding.tabBtnUksVisits.setOnClickListener { switchUksTab(0) }
        binding.tabBtnUksFainting.setOnClickListener { switchUksTab(1) }
    }

    private fun switchUksTab(tabIndex: Int) {
        currentUksTab = tabIndex

        binding.containerTabUksVisits.visibility = if (tabIndex == 0) View.VISIBLE else View.GONE
        binding.containerTabUksFainting.visibility = if (tabIndex == 1) View.VISIBLE else View.GONE

        val activeBg = Color.parseColor("#059669")
        val activeText = Color.parseColor("#FFFFFF")
        val inactiveBg = Color.parseColor("#F1F5F9")
        val inactiveText = Color.parseColor("#475569")

        binding.tabBtnUksVisits.setBackgroundColor(if (tabIndex == 0) activeBg else inactiveBg)
        binding.tvTabUksVisits.setTextColor(if (tabIndex == 0) activeText else inactiveText)

        binding.tabBtnUksFainting.setBackgroundColor(if (tabIndex == 1) activeBg else inactiveBg)
        binding.tvTabUksFainting.setTextColor(if (tabIndex == 1) activeText else inactiveText)
    }

    private fun loadUksData() {
        Toast.makeText(this, "Memuat rekam medis & status kasur UKS...", Toast.LENGTH_SHORT).show()
        fetchEmergencyContactsFromPortal()

        val queryId = targetStudentId
        ApiClient.getClient(this).getStudentUksHealth(queryId).enqueue(object : Callback<StudentHealthResponse> {
            override fun onResponse(call: Call<StudentHealthResponse>, response: Response<StudentHealthResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    val student = body.student
                    val visits = body.visits ?: emptyList()
                    val beds = body.beds ?: emptyList()

                    if (student != null) {
                        renderStudentProfile(student)
                        renderAnthropometry(student)
                        renderSyncopeTracker(student, visits)
                    }

                    renderBeds(beds)
                    renderVisits(visits)
                } else {
                    Toast.makeText(this@UksActivity, "Gagal memuat rekam medis UKS", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<StudentHealthResponse>, t: Throwable) {
                Toast.makeText(this@UksActivity, "Koneksi UKS gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun renderStudentProfile(s: StudentHealthDto) {
        binding.tvUksStudentName.text = s.name
        binding.tvUksStudentClass.text = "Kelas " + (s.className ?: "-")

        val blood = if (!s.bloodType.isNullOrEmpty()) s.bloodType else "Belum Dicek"
        binding.tvUksBloodBadge.text = "Gol: $blood"

        val hasAllergy = !s.allergies.isNullOrEmpty() && 
            !s.allergies.equals("-", ignoreCase = true) && 
            !s.allergies.contains("tidak ada", ignoreCase = true)
        currentStudentAllergies = if (hasAllergy) s.allergies else null
        if (hasAllergy) {
            binding.tvUksAllergies.text = "⚠️ " + s.allergies
            binding.tvUksAllergies.setTextColor(Color.parseColor("#DC2626"))
        } else {
            binding.tvUksAllergies.text = "Tidak ada alergi tercatat"
            binding.tvUksAllergies.setTextColor(Color.parseColor("#334155"))
        }
        binding.tvUksSickDays.text = "${s.totalSickDays ?: 0} Hari (Semester ini)"
    }

    private fun renderAnthropometry(s: StudentHealthDto) {
        val height = s.latestHeightCm ?: s.height
        val weight = s.latestWeightKg ?: s.weight
        val bmi = s.latestBmi ?: s.bmi
        val status = s.nutritionalStatus ?: s.bmiStatus ?: "NORMAL"

        binding.tvUksHeight.text = if (height != null && height > 0) "$height cm" else "- cm"
        binding.tvUksWeight.text = if (weight != null && weight > 0) "$weight kg" else "- kg"
        binding.tvUksBmi.text = if (bmi != null && bmi > 0) String.format("%.1f", bmi) else "--.-"

        binding.tvUksNutritionalBadge.text = status.uppercase()
        when (status.uppercase()) {
            "NORMAL", "IDEAL" -> {
                binding.tvUksNutritionalBadge.setBackgroundColor(Color.parseColor("#D1FAE5"))
                binding.tvUksNutritionalBadge.setTextColor(Color.parseColor("#059669"))
            }
            "KURUS", "SANGAT_KURUS" -> {
                binding.tvUksNutritionalBadge.setBackgroundColor(Color.parseColor("#FEF3C7"))
                binding.tvUksNutritionalBadge.setTextColor(Color.parseColor("#B45309"))
            }
            "GEMUK", "OVERWEIGHT" -> {
                binding.tvUksNutritionalBadge.setBackgroundColor(Color.parseColor("#FFEDD5"))
                binding.tvUksNutritionalBadge.setTextColor(Color.parseColor("#C2410C"))
            }
            else -> { // OBESITAS
                binding.tvUksNutritionalBadge.setBackgroundColor(Color.parseColor("#FEE2E2"))
                binding.tvUksNutritionalBadge.setTextColor(Color.parseColor("#DC2626"))
            }
        }
    }

    private fun renderSyncopeTracker(s: StudentHealthDto, visits: List<UksVisitDto>) {
        val totalFaints = s.faintCount ?: s.faintingCount ?: visits.count { it.isFainting == true }
        binding.tvUksFaintCount.text = "$totalFaints Kali"

        if (totalFaints > 0) {
            binding.tvUksFaintCount.setBackgroundColor(Color.parseColor("#FEE2E2"))
            binding.tvUksFaintCount.setTextColor(Color.parseColor("#DC2626"))

            val lastFaintVisit = visits.find { it.isFainting == true }
            val loc = lastFaintVisit?.incidentLocation ?: "Area Sekolah"
            val date = lastFaintVisit?.checkInTime?.substring(0, 10) ?: "Terkini"
            binding.tvUksFaintNote.text = "⚠️ Perhatian Medis: Tercatat pernah pingsan $totalFaints kali (Terakhir: $loc, $date). Petugas UKS & Guru BK memantau saat upacara/olahraga."
            binding.tvUksFaintNote.setTextColor(Color.parseColor("#991B1B"))
            binding.tvUksFaintNote.setBackgroundColor(Color.parseColor("#FEF2F2"))
        } else {
            binding.tvUksFaintCount.setBackgroundColor(Color.parseColor("#FEF3C7"))
            binding.tvUksFaintCount.setTextColor(Color.parseColor("#B45309"))
            binding.tvUksFaintNote.text = "✅ Belum ada riwayat pingsan atau gangguan kesadaran saat kegiatan sekolah. Kondisi fisik prima."
            binding.tvUksFaintNote.setTextColor(Color.parseColor("#334155"))
            binding.tvUksFaintNote.setBackgroundColor(Color.parseColor("#F8FAFC"))
        }
    }

    private fun renderBeds(beds: List<UksBedDto>) {
        binding.containerUksBeds.removeAllViews()

        val displayBeds = if (beds.isNotEmpty()) beds else listOf(
            UksBedDto("Bed 01", false),
            UksBedDto("Bed 02", false),
            UksBedDto("Bed 03", false),
            UksBedDto("Bed 04", false)
        )

        val freeCount = displayBeds.count { !it.isOccupied }
        binding.tvUksBedAvailableSummary.text = "$freeCount dari 4 Kasur Siap Pakai"

        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
        }
        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            setPadding(0, 8, 0, 0)
        }

        displayBeds.forEachIndexed { index, bed ->
            val bedView = createBedCard(bed)
            if (index < 2) row1.addView(bedView) else row2.addView(bedView)
        }

        binding.containerUksBeds.addView(row1)
        binding.containerUksBeds.addView(row2)
    }

    private fun createBedCard(bed: UksBedDto): View {
        val layout = LinearLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(4, 4, 4, 4)
            }
            orientation = LinearLayout.VERTICAL
            setPadding(12, 12, 12, 12)
            setBackgroundColor(if (bed.isOccupied) Color.parseColor("#FEE2E2") else Color.parseColor("#F0FDF4"))
        }

        val tvTitle = TextView(this).apply {
            text = if (bed.isOccupied) "🛏️ ${bed.bedNumber} • TERISI" else "🛏️ ${bed.bedNumber} • SIAP PAKAI"
            setTextColor(if (bed.isOccupied) Color.parseColor("#DC2626") else Color.parseColor("#15803D"))
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }

        val tvDetail = TextView(this).apply {
            text = if (bed.isOccupied) "${bed.patientName ?: "Pasien"} (${bed.patientClass ?: "-"})" else "Tersedia untuk istirahat"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 10f
            setPadding(0, 4, 0, 0)
        }

        layout.addView(tvTitle)
        layout.addView(tvDetail)

        if (isMedicalAdmin && bed.isOccupied) {
            layout.isClickable = true
            layout.setOnClickListener {
                AlertDialog.Builder(this)
                    .setTitle("🛏️ Kasur ${bed.bedNumber}")
                    .setMessage("Pasien: ${bed.patientName ?: "Siswa"} (${bed.patientClass ?: "-"})\n\nApakah siswa sudah selesai dirawat / beristirahat dan siap kembali ke kelas?")
                    .setPositiveButton("Checkout Kasur") { _, _ ->
                        Toast.makeText(this, "Kasur ${bed.bedNumber} berhasil dikosongkan.", Toast.LENGTH_SHORT).show()
                        loadUksData()
                    }
                    .setNegativeButton("Tutup", null)
                    .show()
            }
        }

        return layout
    }

    private fun renderVisits(visits: List<UksVisitDto>) {
        binding.containerUksVisits.removeAllViews()

        if (visits.isEmpty()) {
            val tvEmpty = TextView(this).apply {
                text = "Belum ada catatan kunjungan ke UKS. Jaga selalu kesehatan!"
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                setPadding(0, 8, 0, 8)
            }
            binding.containerUksVisits.addView(tvEmpty)
            return
        }

        for (v in visits) {
            val card = androidx.cardview.widget.CardView(this).apply {
                radius = 16f
                cardElevation = 2f
                setCardBackgroundColor(Color.WHITE)
                useCompatPadding = true
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 0, 0, 14)
                }
            }

            val cardContent = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(24, 20, 24, 20)
            }

            // Baris Header: Tanggal & Badge Status Penanganan
            val headerRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            }

            val dateStr = v.checkInTime?.let {
                try {
                    val inputFormat = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm", java.util.Locale.US).apply {
                        timeZone = java.util.TimeZone.getTimeZone("UTC")
                    }
                    val outputFormat = java.text.SimpleDateFormat("dd MMM yyyy HH:mm", java.util.Locale("id", "ID")).apply {
                        timeZone = java.util.TimeZone.getTimeZone("Asia/Jakarta")
                    }
                    val parsed = inputFormat.parse(it.substring(0, 16))
                    if (parsed != null) "${outputFormat.format(parsed)} WIB" else it
                } catch (e: Exception) {
                    it.replace("T", " ").substringBefore(".") + " WIB"
                }
            } ?: "Hari ini"

            val tvDate = TextView(this).apply {
                text = "📅 $dateStr"
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 12f
                setTypeface(null, android.graphics.Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            // Status Penanganan UKS
            val statusBadgeText = if (!v.checkOutTime.isNullOrEmpty()) {
                "🟢 SUDAH DITANGANI"
            } else if (v.disposition == "REST_AT_UKS") {
                "🩵 SEDANG DIRAWAT DI UKS"
            } else if (!v.treatment.isNullOrEmpty()) {
                "🟢 SUDAH DITANGANI"
            } else {
                "🟡 MENUNGGU DITANGANI"
            }

            val tvStatusBadge = TextView(this).apply {
                text = statusBadgeText
                textSize = 10f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setPadding(14, 4, 14, 4)
                if (statusBadgeText.contains("SUDAH")) {
                    setTextColor(Color.parseColor("#047857"))
                    setBackgroundColor(Color.parseColor("#D1FAE5"))
                } else if (statusBadgeText.contains("SEDANG")) {
                    setTextColor(Color.parseColor("#0E7490"))
                    setBackgroundColor(Color.parseColor("#CFFAFE"))
                } else {
                    setTextColor(Color.parseColor("#B45309"))
                    setBackgroundColor(Color.parseColor("#FEF3C7"))
                }
            }

            headerRow.addView(tvDate)
            headerRow.addView(tvStatusBadge)
            cardContent.addView(headerRow)

            // Divider Garis Pemisah
            val div = View(this).apply {
                setBackgroundColor(Color.parseColor("#F1F5F9"))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 2).apply {
                    setMargins(0, 12, 0, 12)
                }
            }
            cardContent.addView(div)

            // 1. Keluhan
            val tvComplaint = TextView(this).apply {
                text = "🤕 Keluhan: ${v.complaint ?: "-"}"
                setTextColor(Color.parseColor("#334155"))
                textSize = 12f
                setPadding(0, 2, 0, 4)
            }
            cardContent.addView(tvComplaint)

            // 2. Diagnosa
            val diagText = v.diagnosis ?: (if (!v.complaint.isNullOrEmpty()) "Observasi Klinis: ${v.complaint}" else "Pemeriksaan Fisik Umum")
            val tvDiagnosis = TextView(this).apply {
                text = "🩺 Diagnosa: $diagText"
                setTextColor(Color.parseColor("#1E293B"))
                textSize = 12f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setPadding(0, 2, 0, 4)
            }
            cardContent.addView(tvDiagnosis)

            // 3. Tindakan & Obat
            val medText = if (!v.medicine.isNullOrEmpty()) v.medicine else "Tidak ada obat oral (istirahat/kompres)"
            val tvTreatmentMedicine = TextView(this).apply {
                text = "💊 Tindakan: ${v.treatment ?: "Istirahat di ruang UKS"} • Obat: $medText"
                setTextColor(Color.parseColor("#059669"))
                textSize = 11f
                setPadding(0, 2, 0, 4)
            }
            cardContent.addView(tvTreatmentMedicine)

            // 4. Catatan Istirahat
            val restNotesText = v.restNotes ?: (if (!v.bedNumber.isNullOrEmpty()) "Istirahat di ${v.bedNumber}" else "Istirahat sementara di UKS")
            val tvRestNotes = TextView(this).apply {
                text = "🛏️ Catatan Istirahat: $restNotesText"
                setTextColor(Color.parseColor("#475569"))
                textSize = 11f
                setPadding(0, 2, 0, 4)
            }
            cardContent.addView(tvRestNotes)

            // 5. Nama Petugas / Dokter
            val officerText = v.officerName ?: "Tim Medis UKS Sekolah"
            val tvOfficer = TextView(this).apply {
                text = "👨‍⚕️ Petugas / Dokter: $officerText"
                setTextColor(Color.parseColor("#2563EB"))
                textSize = 11f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setPadding(0, 2, 0, 0)
            }
            cardContent.addView(tvOfficer)

            card.addView(cardContent)
            binding.containerUksVisits.addView(card)
        }
    }

    private fun showReportSickDialog() {
        val scrollContainer = ScrollView(this)
        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 28, 36, 20)
            setBackgroundColor(Color.WHITE)
        }
        scrollContainer.addView(dialogView)

        // 1. Header Banner
        val headerCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 16, 20, 16)
            setBackgroundColor(Color.parseColor("#ECFDF5"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 16) }
        }

        val tvBannerTitle = TextView(this).apply {
            text = "🏥 Form Lapor Keluhan Sakit UKS"
            setTextColor(Color.parseColor("#065F46"))
            textSize = 15f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }

        val tvBannerSub = TextView(this).apply {
            text = "Laporan ini langsung diteruskan ke Petugas PMR & UKS sekolah. Orang tua akan dihubungi jika kondisi memerlukan penjemputan pulang."
            setTextColor(Color.parseColor("#047857"))
            textSize = 11f
            setPadding(0, 4, 0, 0)
        }
        headerCard.addView(tvBannerTitle)
        headerCard.addView(tvBannerSub)
        dialogView.addView(headerCard)

        // Peringatan Khusus jika Siswa Memiliki Riwayat Alergi Obat/Lainnya
        if (!currentStudentAllergies.isNullOrEmpty()) {
            val allergyWarningCard = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(20, 14, 20, 14)
                setBackgroundColor(Color.parseColor("#FEF2F2"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { setMargins(0, 0, 0, 14) }
            }
            val tvWarnTitle = TextView(this).apply {
                text = "⚠️ PERINGATAN ALERGI PASIEN:"
                setTextColor(Color.parseColor("#991B1B"))
                textSize = 12f
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
            val tvWarnDesc = TextView(this).apply {
                text = "Siswa ini memiliki riwayat alergi: $currentStudentAllergies. Dilarang memberikan obat yang memicu reaksi alergi tersebut!"
                setTextColor(Color.parseColor("#DC2626"))
                textSize = 11f
                setPadding(0, 4, 0, 0)
            }
            allergyWarningCard.addView(tvWarnTitle)
            allergyWarningCard.addView(tvWarnDesc)
            dialogView.addView(allergyWarningCard)
        }

        // 2. Quick Symptom Selector Chips
        val tvLabelSymptom = TextView(this).apply {
            text = "Pilih Gejala Utama yang Dirasakan:"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 8)
        }
        dialogView.addView(tvLabelSymptom)

        val symptoms = listOf(
            "Demam Panas 🤒", "Pusing / Migrain 🤕", "Sakit Perut / Maag 🤢",
            "Flu & Batuk 🤧", "Luka Fisik / Cedera 🩹", "Sesak Nafas 🫁", "Lemas / Pingsan 😵"
        )
        var selectedSymptom = "Demam Panas 🤒"

        val chipContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }

        val chipButtons = mutableListOf<Button>()
        var curRow: LinearLayout? = null

        symptoms.forEachIndexed { idx, s ->
            if (idx % 2 == 0) {
                curRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        setMargins(0, 0, 0, 6)
                    }
                }
                chipContainer.addView(curRow)
            }

            val btn = Button(this).apply {
                text = s
                textSize = 10.5f
                isAllCaps = false
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    setMargins(3, 0, 3, 0)
                }
                if (s == selectedSymptom) {
                    setBackgroundColor(Color.parseColor("#059669"))
                    setTextColor(Color.WHITE)
                } else {
                    setBackgroundColor(Color.parseColor("#F1F5F9"))
                    setTextColor(Color.parseColor("#334155"))
                }
                setOnClickListener {
                    selectedSymptom = s
                    chipButtons.forEach { otherBtn ->
                        if (otherBtn.text == selectedSymptom) {
                            otherBtn.setBackgroundColor(Color.parseColor("#059669"))
                            otherBtn.setTextColor(Color.WHITE)
                        } else {
                            otherBtn.setBackgroundColor(Color.parseColor("#F1F5F9"))
                            otherBtn.setTextColor(Color.parseColor("#334155"))
                        }
                    }
                }
            }
            chipButtons.add(btn)
            curRow?.addView(btn)
        }
        dialogView.addView(chipContainer)

        // 3. Location Input
        val tvLabelLoc = TextView(this).apply {
            text = "Lokasi Anda Sekarang:"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 12, 0, 4)
        }
        val etLocation = EditText(this).apply {
            hint = "Contoh: Ruang Kelas 7A / Lab Komputer"
            setText("Ruang Kelas " + sessionManager.getClassName().ifEmpty { "VII-A" })
            textSize = 12.5f
            setPadding(16, 12, 16, 12)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }
        dialogView.addView(tvLabelLoc)
        dialogView.addView(etLocation)

        // 4. Details Input
        val tvLabelDetail = TextView(this).apply {
            text = "Keterangan Gejala Tambahan (Opsional):"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 10, 0, 4)
        }
        val etComplaint = EditText(this).apply {
            hint = "Ceritakan apa yang dirasakan (cth: mual sejak jam ke-2)..."
            textSize = 12.5f
            minLines = 2
            setPadding(16, 12, 16, 12)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }
        dialogView.addView(tvLabelDetail)
        dialogView.addView(etComplaint)

        // 5. Transport Mode Choice
        val tvLabelHelp = TextView(this).apply {
            text = "Bantuan yang Diperlukan:"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 12, 0, 4)
        }
        val spinnerTransport = Spinner(this)
        val transportOptions = arrayOf(
            "🚶‍♂️ Saya masih kuat jalan sendiri menuju UKS",
            "🚨 Kondisi Lemah: Mohon jemput saya di ruang kelas",
            "🛌 Mohon izin berbaring istirahat di kasur UKS"
        )
        spinnerTransport.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, transportOptions)
        dialogView.addView(tvLabelHelp)
        dialogView.addView(spinnerTransport)

        val dialog = AlertDialog.Builder(this)
            .setView(scrollContainer)
            .setCancelable(true)
            .create()

        val btnSubmit = Button(this).apply {
            text = "🚨 KIRIM LAPORAN SEKARANG"
            setBackgroundColor(Color.parseColor("#059669"))
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, 16, 0, 0)
            }
            setOnClickListener {
                val loc = etLocation.text.toString().trim().ifEmpty { "Ruang Kelas" }
                val extraNote = etComplaint.text.toString().trim()
                val transportChosen = spinnerTransport.selectedItem.toString()

                val fullComplaint = "$selectedSymptom. " + (if (extraNote.isNotEmpty()) extraNote + ". " else "") + "[$transportChosen]"
                val catCode = if (selectedSymptom.contains("Pingsan") || transportChosen.contains("Jemput")) "PINGSAN" else "SAKIT"

                Toast.makeText(this@UksActivity, "Mengirim laporan darurat medis ke UKS...", Toast.LENGTH_SHORT).show()

                val req = StudentUksReportRequest(
                    complaint = fullComplaint,
                    category = catCode,
                    incidentLocation = loc
                )

                ApiClient.getClient(this@UksActivity).submitStudentUksReport(req).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        dialog.dismiss()
                        if (response.isSuccessful) {
                            showAttractiveConfirmationDialog(selectedSymptom, loc, transportChosen)
                            loadUksData()
                        } else {
                            Toast.makeText(this@UksActivity, "Gagal mengirim laporan UKS", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        dialog.dismiss()
                        Toast.makeText(this@UksActivity, "Koneksi gagal: " + t.message, Toast.LENGTH_SHORT).show()
                    }
                })
            }
        }
        dialogView.addView(btnSubmit)
        dialog.show()
    }

    private fun showAttractiveConfirmationDialog(symptom: String, location: String, transport: String) {
        val view = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 28, 36, 24)
            setBackgroundColor(Color.WHITE)
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }

        val tvIcon = TextView(this).apply {
            text = "✅"
            textSize = 42f
            gravity = android.view.Gravity.CENTER
        }

        val tvTitle = TextView(this).apply {
            text = "Laporan Terkirim ke UKS!"
            setTextColor(Color.parseColor("#065F46"))
            textSize = 18f
            setTypeface(null, android.graphics.Typeface.BOLD)
            gravity = android.view.Gravity.CENTER
            setPadding(0, 8, 0, 4)
        }

        val tvSubtitle = TextView(this).apply {
            text = "Tim Medis Sekolah & Guru Piket Telah Menerima Notifikasi Siaga."
            setTextColor(Color.parseColor("#047857"))
            textSize = 12f
            gravity = android.view.Gravity.CENTER
            setPadding(0, 0, 0, 16)
        }

        val cardTicket = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 16, 20, 16)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, 0, 0, 16)
            }
        }

        val tvSymptom = TextView(this).apply {
            text = "Keluhan: $symptom"
            setTextColor(Color.parseColor("#1E293B"))
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }

        val tvLoc = TextView(this).apply {
            text = "Lokasi Pasien: $location"
            setTextColor(Color.parseColor("#475569"))
            textSize = 11.5f
            setPadding(0, 4, 0, 0)
        }

        val tvInstruct = TextView(this).apply {
            text = "Instruksi: " + if (transport.contains("jemput", ignoreCase = true)) {
                "Tetap di tempat duduk Anda, jangan banyak bergerak. Petugas UKS segera menuju ke kelas Anda."
            } else {
                "Silakan langsung menuju Ruang UKS lantai 1 untuk pemeriksaan suhu & tensi."
            }
            setTextColor(Color.parseColor("#0284C7"))
            textSize = 11.5f
            setPadding(0, 8, 0, 0)
            setTypeface(null, android.graphics.Typeface.ITALIC)
        }

        cardTicket.addView(tvSymptom)
        cardTicket.addView(tvLoc)
        cardTicket.addView(tvInstruct)

        val btnClose = Button(this).apply {
            text = "Baik, Saya Mengerti"
            setBackgroundColor(Color.parseColor("#0F172A"))
            setTextColor(Color.WHITE)
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }

        view.addView(tvIcon)
        view.addView(tvTitle)
        view.addView(tvSubtitle)
        view.addView(cardTicket)
        view.addView(btnClose)

        val confirmDialog = AlertDialog.Builder(this)
            .setView(view)
            .setCancelable(false)
            .create()

        btnClose.setOnClickListener { confirmDialog.dismiss() }
        confirmDialog.show()
    }

    private fun fetchEmergencyContactsFromPortal() {
        Executors.newSingleThreadExecutor().execute {
            try {
                val fullUrl = ApiClient.getBaseServerUrl(this) + "/api/uks/emergency-contacts"
                val conn = URL(fullUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 4000
                conn.readTimeout = 4000
                conn.requestMethod = "GET"
                conn.instanceFollowRedirects = true
                if (conn.responseCode == 200) {
                    val body = conn.inputStream.bufferedReader().use { it.readText() }
                    val json = JSONObject(body)
                    if (json.optBoolean("success")) {
                        val arr = json.optJSONArray("data")
                        if (arr != null && arr.length() > 0) {
                            sessionManager.saveEmergencyContactsJson(arr.toString())
                        }
                    }
                }
            } catch (e: Exception) {
                // Biarkan menggunakan cache lokal offline
            }
        }
    }

    private fun showEmergencyDialDialog() {
        val cachedJson = sessionManager.getEmergencyContactsJson()
        val optionsList = mutableListOf<String>()
        val phoneList = mutableListOf<String>()

        if (!cachedJson.isNullOrEmpty()) {
            try {
                val arr = JSONArray(cachedJson)
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    val active = obj.optBoolean("active", true)
                    if (!active) continue
                    val name = obj.optString("name", "Kontak Darurat")
                    val phone = obj.optString("phone", "-")
                    val clean = obj.optString("cleanPhone", phone.replace("[^0-9]".toRegex(), ""))
                    val icon = obj.optString("icon", "📞")
                    optionsList.add("$icon $name: $phone")
                    phoneList.add(clean)
                }
            } catch (e: Exception) {}
        }

        // Fallback default jika cache lokal belum terisi
        if (optionsList.isEmpty()) {
            optionsList.addAll(listOf(
                "🏥 Puskesmas Boyolangu: (0355) 321852",
                "🚑 Ambulans Gawat Darurat (PSC 119): 119",
                "🏫 Pos Medis & Satpam Sekolah: 08123456789",
                "👮 Polsek Boyolangu: (0355) 321110"
            ))
            phoneList.addAll(listOf(
                "0355321852",
                "119",
                "08123456789",
                "0355321110"
            ))
        }

        AlertDialog.Builder(this)
            .setTitle("🚨 Panggilan Darurat Medis & Sekolah")
            .setItems(optionsList.toTypedArray()) { _, which ->
                val chosenNumber = phoneList[which]
                try {
                    val intent = Intent(Intent.ACTION_DIAL).apply {
                        data = Uri.parse("tel:$chosenNumber")
                    }
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(this, "Tidak dapat membuka dialer telepon: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Tutup", null)
            .show()
    }
}
