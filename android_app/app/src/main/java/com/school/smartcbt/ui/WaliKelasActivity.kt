package com.school.smartcbt.ui

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import android.graphics.Typeface
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.data.remote.ApiService
import com.school.smartcbt.databinding.ActivityWaliKelasBinding
import com.school.smartcbt.databinding.ItemWaliKelasStudentBinding
import com.school.smartcbt.databinding.ItemWaliKelasRekapBinding
import com.school.smartcbt.utils.AttendancePdfHelper
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class WaliKelasActivity : AppCompatActivity() {

    private lateinit var binding: ActivityWaliKelasBinding
    private lateinit var sessionManager: SessionManager
    private lateinit var apiService: ApiService

    private var homeroomClass: String = ""
    private var allStudents: List<WaliKelasStudentItemDto> = emptyList()
    private var currentOfficersResponse: WaliKelasOfficersResponse? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityWaliKelasBinding.inflate(layoutInflater)
        setContentView(binding.root)
        com.school.smartcbt.utils.DialogHelper.applyDynamicFooter(this)

        sessionManager = SessionManager(this)
        apiService = ApiClient.getClient(this)

        val teacherName = sessionManager.getName().uppercase().trim()
        if (teacherName.contains("SIDIK") || teacherName.contains("SUJATMIKO")) {
            AlertDialog.Builder(this)
                .setTitle("ℹ️ Peran Tim Kurikulum")
                .setMessage("Bapak Sidik Sujatmiko terdaftar sebagai Tim Kurikulum sekolah, bukan Wali Kelas.\n\nSilakan gunakan 'Menu Kurikulum' di halaman utama untuk monitoring KBM seluruh rombel, rekap wali kelas 33 rombel, dan verifikasi perizinan.")
                .setIcon(android.R.drawable.ic_dialog_info)
                .setPositiveButton("Buka Menu Kurikulum") { _, _ -> finish() }
                .setCancelable(false)
                .show()
            return
        }

        homeroomClass = sessionManager.getClassName() ?: ""

        setupUI()
        loadDashboard()
        loadStudents()

        // Sinkronisasi Token Push Notifikasi Firebase (FCM)
        try {
            com.school.smartcbt.utils.FcmHelper.syncFcmToken(this)
        } catch (e: Exception) {}

        // Cek Pembaruan OTA Otomatis
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
    }

    override fun onResume() {
        super.onResume()
        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
    }

    private fun setupUI() {
        binding.btnBackWali.setOnClickListener { finish() }
        binding.btnRefreshWali.setOnClickListener {
            loadDashboard()
            loadStudents()
            loadOfficers()
        }
        binding.btnUpdateWali.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        // Modern 2-Column Grid Cards Listeners
        binding.cardMenuWaliStudents.setOnClickListener { switchSection(1) }
        binding.cardMenuWaliRekap.setOnClickListener {
            switchSection(2)
            loadRekap()
        }
        binding.cardMenuWaliOfficers.setOnClickListener {
            switchSection(3)
            loadOfficers()
        }
        binding.cardMenuWaliAkademik.setOnClickListener {
            showMonitoringAkademikDialog()
        }
        binding.cardMenuWaliPembinaan.setOnClickListener {
            showCatatanPembinaanHubDialog()
        }
        binding.cardMenuWaliKomunikasi.setOnClickListener {
            showKomunikasiOrtuHubDialog()
        }
        binding.cardMenuWaliAdministrasi.setOnClickListener {
            showAdministrasiRaporDialog()
        }
        binding.cardMenuWaliSync.setOnClickListener {
            Toast.makeText(this, "🔄 Menyegarkan data kelas & berkas...", Toast.LENGTH_SHORT).show()
            loadDashboard()
            loadStudents()
            loadOfficers()
        }

        // Tab Switching Compatibility
        binding.btnTabStudents.setOnClickListener { switchSection(1) }
        binding.btnTabRekap.setOnClickListener {
            switchSection(2)
            loadRekap()
        }
        binding.btnTabOfficers.setOnClickListener {
            switchSection(3)
            loadOfficers()
        }
        binding.btnTabAkademik.setOnClickListener {
            showMonitoringAkademikDialog()
        }
        binding.btnTabPembinaan.setOnClickListener {
            showCatatanPembinaanHubDialog()
        }
        binding.btnTabKomunikasi.setOnClickListener {
            showKomunikasiOrtuHubDialog()
        }
        binding.btnTabAdministrasi.setOnClickListener {
            showAdministrasiRaporDialog()
        }

        // Setup RecyclerViews
        binding.rvWaliStudents.layoutManager = LinearLayoutManager(this)
        binding.rvWaliRekap.layoutManager = LinearLayoutManager(this)

        // Quick Manual Attendance Button
        binding.btnQuickManualAttendance.setOnClickListener {
            showManualAttendanceDialog(null)
        }

        // Manage Officers Button
        binding.btnManageOfficers.setOnClickListener {
            showManageOfficersDialog()
        }

        // Download Class PDFs
        binding.btnDownloadClassMonthlyPdf.setOnClickListener {
            openPdfUrl("class_monthly", null)
        }
        binding.btnDownloadClassDailyPdf.setOnClickListener {
            openPdfUrl("class_daily", null)
        }

        // Kirim Laporan Bulanan ke Kurikulum (SIBOY A6)
        binding.btnSubmitMonthlyReportToKurikulum.setOnClickListener {
            showSubmitMonthlyReportDialog()
        }


        // Search Filter
        binding.etSearchStudent.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                filterStudents(s.toString())
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })
    }

    private fun switchSection(sectionIndex: Int) {
        // Highlight Active 2-Column Card
        binding.cardMenuWaliStudents.setCardBackgroundColor(if (sectionIndex == 1) Color.parseColor("#F0FDF4") else Color.WHITE)
        binding.cardMenuWaliRekap.setCardBackgroundColor(if (sectionIndex == 2) Color.parseColor("#EEF2FF") else Color.WHITE)
        binding.cardMenuWaliOfficers.setCardBackgroundColor(if (sectionIndex == 3) Color.parseColor("#FEF3C7") else Color.WHITE)

        binding.tvWaliActiveSectionPill.text = when (sectionIndex) {
            1 -> "👥 Data Siswa & Berkas"
            2 -> "📊 Rekap Presensi & PDF"
            3 -> "👑 Pengurus Kelas"
            else -> "⚡ Menu Wali Kelas"
        }

        val activeBg = Color.parseColor("#0F766E")
        val inactiveBg = Color.parseColor("#E2E8F0")
        val activeText = Color.parseColor("#FFFFFF")
        val inactiveText = Color.parseColor("#334155")

        binding.btnTabStudents.backgroundTintList = android.content.res.ColorStateList.valueOf(if (sectionIndex == 1) activeBg else inactiveBg)
        binding.btnTabStudents.setTextColor(if (sectionIndex == 1) activeText else inactiveText)

        binding.btnTabRekap.backgroundTintList = android.content.res.ColorStateList.valueOf(if (sectionIndex == 2) activeBg else inactiveBg)
        binding.btnTabRekap.setTextColor(if (sectionIndex == 2) activeText else inactiveText)

        binding.btnTabOfficers.backgroundTintList = android.content.res.ColorStateList.valueOf(if (sectionIndex == 3) activeBg else inactiveBg)
        binding.btnTabOfficers.setTextColor(if (sectionIndex == 3) activeText else inactiveText)

        binding.layoutSectionStudents.visibility = if (sectionIndex == 1) View.VISIBLE else View.GONE
        binding.layoutSectionRekap.visibility = if (sectionIndex == 2) View.VISIBLE else View.GONE
        binding.layoutSectionOfficers.visibility = if (sectionIndex == 3) View.VISIBLE else View.GONE
    }

    private fun loadDashboard() {
        apiService.getWaliKelasDashboard(homeroomClass.ifEmpty { null }).enqueue(object : Callback<WaliKelasDashboardResponse> {
            override fun onResponse(call: Call<WaliKelasDashboardResponse>, response: Response<WaliKelasDashboardResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    if (data.success && data.isHomeroom) {
                        homeroomClass = data.homeroomClass ?: homeroomClass
                        binding.tvWaliKelasTitle.text = "👑 Wali Kelas - $homeroomClass"
                        binding.tvHeaderClassName.text = "KELAS $homeroomClass"

                        val rawCounselor = data.counselorName?.trim() ?: ""
                        val isNoCounselor = rawCounselor.isEmpty() || 
                                rawCounselor == "-" || 
                                rawCounselor.equals("Belum Ditugaskan", ignoreCase = true) || 
                                rawCounselor.contains("Nurul", ignoreCase = true)
                        if (isNoCounselor) {
                            binding.tvHeaderCounselorInfo.text = "Guru BK Pengampu: - • NIP: -"
                        } else {
                            val counselorNip = if (data.counselorNip?.contains("19740921") == true) "-" else (data.counselorNip ?: "-")
                            binding.tvHeaderCounselorInfo.text = "Guru BK Pengampu: $rawCounselor • NIP: $counselorNip"
                        }

                        data.todayStats?.let { stats ->
                            binding.tvHeaderAttendancePct.text = "${stats.attendanceRate}% Hadir"
                            binding.tvStatPresent.text = stats.present.toString()
                            binding.tvStatUnconfirmed.text = stats.unconfirmedOut.toString()
                            binding.tvStatLate.text = stats.late.toString()
                            binding.tvStatSickPermit.text = (stats.sick + stats.permission).toString()
                            binding.tvStatAbsent.text = stats.absent.toString()
                        }

                        // Update pengurus kelas singkat
                        data.officers?.let { off ->
                            binding.tvOfficerKetua.text = off.ketua?.name ?: "-"
                            binding.tvOfficerWakil.text = off.wakil?.name ?: "-"
                            binding.tvOfficerSekretaris.text = off.sekretaris?.name ?: "-"
                            binding.tvOfficerBendahara.text = off.bendahara?.name ?: "-"
                        }
                    } else {
                        Toast.makeText(this@WaliKelasActivity, data.message ?: "Bukan Wali Kelas aktif", Toast.LENGTH_LONG).show()
                    }
                }
            }

            override fun onFailure(call: Call<WaliKelasDashboardResponse>, t: Throwable) {
                Toast.makeText(this@WaliKelasActivity, "Gagal memuat dashboard: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun loadStudents() {
        apiService.getWaliKelasStudents(homeroomClass.ifEmpty { null }).enqueue(object : Callback<WaliKelasStudentsResponse> {
            override fun onResponse(call: Call<WaliKelasStudentsResponse>, response: Response<WaliKelasStudentsResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    if (data.success) {
                        allStudents = data.students
                        binding.tvHeaderStudentDemography.text = "👥 Total: ${data.totalStudents} Siswa • 👦 L: ${data.countL} • 👧 P: ${data.countP}"
                        binding.rvWaliStudents.adapter = StudentAdapter(allStudents)
                    }
                }
            }

            override fun onFailure(call: Call<WaliKelasStudentsResponse>, t: Throwable) {
                Toast.makeText(this@WaliKelasActivity, "Gagal memuat siswa: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun filterStudents(query: String) {
        val q = query.trim().lowercase()
        val filtered = if (q.isEmpty()) allStudents else {
            allStudents.filter {
                it.name.lowercase().contains(q) ||
                (it.nisn?.lowercase()?.contains(q) == true) ||
                (it.nis?.lowercase()?.contains(q) == true)
            }
        }
        binding.rvWaliStudents.adapter = StudentAdapter(filtered)
    }

    private fun loadOfficers() {
        apiService.getWaliKelasOfficers(homeroomClass).enqueue(object : Callback<WaliKelasOfficersResponse> {
            override fun onResponse(call: Call<WaliKelasOfficersResponse>, response: Response<WaliKelasOfficersResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    if (data.success) {
                        currentOfficersResponse = data
                        val off = data.officers
                        binding.tvOfficerKetua.text = off?.ketua?.name ?: "-"
                        binding.tvOfficerWakil.text = off?.wakil?.name ?: "-"
                        binding.tvOfficerSekretaris.text = off?.sekretaris?.name ?: "-"
                        binding.tvOfficerBendahara.text = off?.bendahara?.name ?: "-"
                    }
                }
            }

            override fun onFailure(call: Call<WaliKelasOfficersResponse>, t: Throwable) {
                Toast.makeText(this@WaliKelasActivity, "Gagal memuat pengurus: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showManageOfficersDialog() {
        val candidates = currentOfficersResponse?.candidates ?: allStudents.map {
            WaliKelasOfficerCandidateDto(it.id, it.name, it.nisn, it.nis, it.classRole)
        }

        if (candidates.isEmpty()) {
            Toast.makeText(this, "Data siswa belum dimuat", Toast.LENGTH_SHORT).show()
            return
        }

        val studentNames = mutableListOf("— Belum Ditentukan —")
        val studentIds = mutableListOf<String?>(null)
        candidates.forEach {
            studentNames.add("${it.name} (${it.nisn ?: "-"})")
            studentIds.add(it.id)
        }

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

        // Header with Teal Gradient
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(20), dp(20), dp(18))
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.parseColor("#0F766E"), Color.parseColor("#14B8A6"))
            )
        }

        val tvIcon = TextView(this).apply {
            text = "👑"
            textSize = 32f
            gravity = Gravity.CENTER
        }
        header.addView(tvIcon)

        val tvHeaderTitle = TextView(this).apply {
            text = "Kelola Pengurus Kelas $homeroomClass"
            textSize = 16.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, 0)
        }
        header.addView(tvHeaderTitle)

        val tvHeaderSub = TextView(this).apply {
            text = "Tetapkan 4 posisi inti untuk otorisasi rekap & ketertiban kelas"
            textSize = 11.5f
            setTextColor(Color.parseColor("#CCFBF1"))
            gravity = Gravity.CENTER
            setPadding(0, dp(2), 0, 0)
        }
        header.addView(tvHeaderSub)
        mainLayout.addView(header)

        val scrollBody = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        val linearLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(14))
        }

        fun createSpinnerCard(label: String, badgeBg: String, badgeColor: String): Spinner {
            val card = androidx.cardview.widget.CardView(this).apply {
                radius = dp(14).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.parseColor("#F8FAFC"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = dp(10)
                }
            }

            val cardInner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(10), dp(12), dp(10))
            }

            val tvBadge = TextView(this).apply {
                text = label
                textSize = 11.5f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor(badgeColor))
                setPadding(dp(10), dp(4), dp(10), dp(4))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(badgeBg))
                    cornerRadius = dp(8).toFloat()
                }
            }
            cardInner.addView(tvBadge)

            val sp = Spinner(this@WaliKelasActivity).apply {
                adapter = ArrayAdapter(this@WaliKelasActivity, android.R.layout.simple_spinner_dropdown_item, studentNames)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                    topMargin = dp(6)
                }
                layoutParams = lp
            }
            cardInner.addView(sp)
            card.addView(cardInner)
            linearLayout.addView(card)
            return sp
        }

        val spKetua = createSpinnerCard("👑 Ketua Kelas", "#FEF3C7", "#B45309")
        val spWakil = createSpinnerCard("🎖️ Wakil Ketua Kelas", "#EFF6FF", "#1D4ED8")
        val spSekretaris = createSpinnerCard("📝 Sekretaris", "#CCFBF1", "#0F766E")
        val spBendahara = createSpinnerCard("💰 Bendahara", "#ECFDF5", "#047857")

        // Pre-select existing officers
        currentOfficersResponse?.officers?.let { off ->
            off.ketua?.id?.let { id -> val idx = studentIds.indexOf(id); if (idx >= 0) spKetua.setSelection(idx) }
            off.wakil?.id?.let { id -> val idx = studentIds.indexOf(id); if (idx >= 0) spWakil.setSelection(idx) }
            off.sekretaris?.id?.let { id -> val idx = studentIds.indexOf(id); if (idx >= 0) spSekretaris.setSelection(idx) }
            off.bendahara?.id?.let { id -> val idx = studentIds.indexOf(id); if (idx >= 0) spBendahara.setSelection(idx) }
        }

        scrollBody.addView(linearLayout)
        mainLayout.addView(scrollBody)

        // Action Buttons Row
        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(18), 0, dp(18), dp(18))
        }

        val btnCancel = Button(this).apply {
            text = "Batal"
            textSize = 12.5f
            setTextColor(Color.parseColor("#64748B"))
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#F1F5F9"))
            layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f).apply { marginEnd = dp(8) }
        }

        val btnSave = Button(this).apply {
            text = "💾 Simpan Struktur"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#0F766E"))
            layoutParams = LinearLayout.LayoutParams(0, dp(46), 2f)
        }

        btnRow.addView(btnCancel)
        btnRow.addView(btnSave)
        mainLayout.addView(btnRow)
        cardRoot.addView(mainLayout)

        val alertDialog = AlertDialog.Builder(this)
            .setView(cardRoot)
            .create()

        alertDialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))

        btnCancel.setOnClickListener { alertDialog.dismiss() }

        btnSave.setOnClickListener {
            val ketuaId = studentIds[spKetua.selectedItemPosition]
            val wakilId = studentIds[spWakil.selectedItemPosition]
            val sekretarisId = studentIds[spSekretaris.selectedItemPosition]
            val bendaharaId = studentIds[spBendahara.selectedItemPosition]

            val req = UpdateWaliKelasOfficersRequest(
                className = homeroomClass,
                ketuaId = ketuaId,
                wakilId = wakilId,
                sekretarisId = sekretarisId,
                bendaharaId = bendaharaId
            )

            apiService.updateWaliKelasOfficers(req).enqueue(object : Callback<WaliKelasOfficersResponse> {
                override fun onResponse(call: Call<WaliKelasOfficersResponse>, response: Response<WaliKelasOfficersResponse>) {
                    if (response.isSuccessful && response.body()?.success == true) {
                        Toast.makeText(this@WaliKelasActivity, "✅ Struktur pengurus kelas berhasil disimpan", Toast.LENGTH_SHORT).show()
                        alertDialog.dismiss()
                        loadOfficers()
                        loadStudents()
                    } else {
                        Toast.makeText(this@WaliKelasActivity, "Gagal menyimpan pengurus", Toast.LENGTH_SHORT).show()
                    }
                }

                override fun onFailure(call: Call<WaliKelasOfficersResponse>, t: Throwable) {
                    Toast.makeText(this@WaliKelasActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            })
        }

        alertDialog.show()
    }

    private fun showManualAttendanceDialog(preSelectedStudent: WaliKelasStudentItemDto? = null, forceGateOut: Boolean = false) {
        val linearLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 20, 40, 20)
        }

        val tvInfo = TextView(this).apply {
            text = "Catat presensi untuk siswa yang lupa/ketinggalan membawa HP:"
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, 16)
        }
        linearLayout.addView(tvInfo)

        // Dropdown Siswa jika tidak preselected
        var targetStudentId = preSelectedStudent?.id
        if (preSelectedStudent == null) {
            val studentNames = allStudents.map { "${it.name} (${it.nisn ?: "-"})" }
            val sp = Spinner(this).apply {
                adapter = ArrayAdapter(this@WaliKelasActivity, android.R.layout.simple_spinner_dropdown_item, studentNames)
            }
            linearLayout.addView(sp)
            targetStudentId = allStudents.firstOrNull()?.id
            sp.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    targetStudentId = allStudents[position].id
                }
                override fun onNothingSelected(parent: AdapterView<*>?) {}
            }
        } else {
            val tvName = TextView(this).apply {
                text = "Siswa: ${preSelectedStudent.name}"
                textSize = 14f
                setTextColor(Color.parseColor("#0F172A"))
                setTypeface(null, android.graphics.Typeface.BOLD)
                setPadding(0, 0, 0, 12)
            }
            linearLayout.addView(tvName)
        }

        // Pilihan Status Presensi
        val rg = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
        }
        val att = preSelectedStudent?.todayAttendance
        val hasMasuk = !att?.gateInTime.isNullOrBlank() && att?.gateInTime != "-"
        val hasPulang = !att?.gateOutTime.isNullOrBlank() && att?.gateOutTime != "-"

        val rbHadir = RadioButton(this).apply {
            text = if (hasMasuk) "✅ Sudah Masuk: ${att?.gateInTime}" else "🟢 Hadir (Tepat Waktu - Gate In)"
            id = View.generateViewId()
            isEnabled = !hasMasuk
            isChecked = !hasMasuk && !forceGateOut
        }
        val rbTerlambat = RadioButton(this).apply {
            text = "🟡 Hadir (Terlambat - Gate In)"
            id = View.generateViewId()
            isEnabled = !hasMasuk
        }
        val rbGateOut = RadioButton(this).apply {
            text = if (hasPulang) "✅ Sudah Pulang: ${att?.gateOutTime}" else "🚪 Absen Pulang (Gate-Out Siswa Tanpa HP)"
            id = View.generateViewId()
            isEnabled = hasMasuk && !hasPulang
            isChecked = hasMasuk || forceGateOut
        }
        rg.addView(rbHadir)
        rg.addView(rbTerlambat)
        rg.addView(rbGateOut)
        linearLayout.addView(rg)

        // Catatan Alasan
        val etNote = EditText(this).apply {
            hint = "Catatan: Siswa lupa membawa HP..."
            setText("Siswa lupa/ketinggalan membawa HP")
            textSize = 12f
            setPadding(0, 16, 0, 8)
        }
        linearLayout.addView(etNote)

        AlertDialog.Builder(this)
            .setTitle("✍️ Absensi Manual Siswa (Lupa HP)")
            .setView(linearLayout)
            .setPositiveButton("Simpan Presensi") { _, _ ->
                val sId = targetStudentId ?: return@setPositiveButton
                val isGateOut = (rg.checkedRadioButtonId == rbGateOut.id)
                val status = if (isGateOut) "PRESENT" else when (rg.checkedRadioButtonId) {
                    rbTerlambat.id -> "LATE"
                    else -> "PRESENT"
                }
                val scanType = if (isGateOut) "GATE_OUT" else "GATE_IN"
                val note = etNote.text.toString().trim()

                apiService.submitManualAttendanceByWali(ManualAttendanceRequest(
                    studentId = sId,
                    status = status,
                    note = note,
                    type = scanType
                )).enqueue(object : Callback<SimpleActionResponse> {
                    override fun onResponse(call: Call<SimpleActionResponse>, response: Response<SimpleActionResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(this@WaliKelasActivity, response.body()?.message ?: "Presensi berhasil dicatat", Toast.LENGTH_SHORT).show()
                            loadDashboard()
                            loadStudents()
                        } else {
                            Toast.makeText(this@WaliKelasActivity, "Gagal mencatat presensi", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<SimpleActionResponse>, t: Throwable) {
                        Toast.makeText(this@WaliKelasActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadRekap() {
        apiService.getWaliKelasRekap("MONTHLY", className = homeroomClass.ifEmpty { null }).enqueue(object : Callback<WaliKelasRekapResponse> {
            override fun onResponse(call: Call<WaliKelasRekapResponse>, response: Response<WaliKelasRekapResponse>) {
                if (response.isSuccessful && response.body() != null) {
                    val data = response.body()!!
                    if (data.success) {
                        binding.rvWaliRekap.adapter = RekapAdapter(data.records)
                        updateAttendanceGraph(data.records)
                    }
                }
            }

            override fun onFailure(call: Call<WaliKelasRekapResponse>, t: Throwable) {
                Toast.makeText(this@WaliKelasActivity, "Gagal memuat rekap: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun updateAttendanceGraph(records: List<WaliKelasRekapItemDto>) {
        if (records.isEmpty()) {
            binding.cardWaliAttendanceGraph.visibility = View.GONE
            return
        }
        binding.cardWaliAttendanceGraph.visibility = View.VISIBLE

        val sumH = records.sumOf { it.H }
        val sumTP = records.sumOf { it.questionMark }
        val sumT = records.sumOf { it.T }
        val sumS = records.sumOf { it.S }
        val sumI = records.sumOf { it.I }
        val sumA = records.sumOf { it.A }
        val grandTotal = sumH + sumTP + sumT + sumS + sumI + sumA

        val avgPct = if (records.isNotEmpty()) {
            records.map { it.attendancePercentage }.average()
        } else 100.0

        binding.tvGraphAttendancePct.text = "${"%.1f".format(avgPct)}% Hadir"

        binding.tvGraphLegendH.text = "🟢 H: $sumH"
        binding.tvGraphLegendTP.text = "🟡 ?: $sumTP"
        binding.tvGraphLegendT.text = "🟠 T: $sumT"
        binding.tvGraphLegendS.text = "🔵 S: $sumS"
        binding.tvGraphLegendI.text = "🟣 I: $sumI"
        binding.tvGraphLegendA.text = "🔴 A: $sumA"

        val wH = if (grandTotal > 0) sumH.toFloat() / grandTotal else 1f
        val wTP = if (grandTotal > 0) sumTP.toFloat() / grandTotal else 0f
        val wT = if (grandTotal > 0) sumT.toFloat() / grandTotal else 0f
        val wS = if (grandTotal > 0) sumS.toFloat() / grandTotal else 0f
        val wI = if (grandTotal > 0) sumI.toFloat() / grandTotal else 0f
        val wA = if (grandTotal > 0) sumA.toFloat() / grandTotal else 0f

        (binding.barHadir.layoutParams as? LinearLayout.LayoutParams)?.let {
            it.weight = if (wH > 0) wH else 0.001f
            binding.barHadir.layoutParams = it
            binding.barHadir.visibility = if (sumH > 0 || grandTotal == 0) View.VISIBLE else View.GONE
        }
        (binding.barUnconfirmed.layoutParams as? LinearLayout.LayoutParams)?.let {
            it.weight = if (wTP > 0) wTP else 0.001f
            binding.barUnconfirmed.layoutParams = it
            binding.barUnconfirmed.visibility = if (sumTP > 0) View.VISIBLE else View.GONE
        }
        (binding.barLate.layoutParams as? LinearLayout.LayoutParams)?.let {
            it.weight = if (wT > 0) wT else 0.001f
            binding.barLate.layoutParams = it
            binding.barLate.visibility = if (sumT > 0) View.VISIBLE else View.GONE
        }
        (binding.barSick.layoutParams as? LinearLayout.LayoutParams)?.let {
            it.weight = if (wS > 0) wS else 0.001f
            binding.barSick.layoutParams = it
            binding.barSick.visibility = if (sumS > 0) View.VISIBLE else View.GONE
        }
        (binding.barPermit.layoutParams as? LinearLayout.LayoutParams)?.let {
            it.weight = if (wI > 0) wI else 0.001f
            binding.barPermit.layoutParams = it
            binding.barPermit.visibility = if (sumI > 0) View.VISIBLE else View.GONE
        }
        (binding.barAbsent.layoutParams as? LinearLayout.LayoutParams)?.let {
            it.weight = if (wA > 0) wA else 0.001f
            binding.barAbsent.layoutParams = it
            binding.barAbsent.visibility = if (sumA > 0) View.VISIBLE else View.GONE
        }
    }

    private fun openPdfUrl(type: String, studentId: String?) {
        val baseUrl = ApiClient.getBaseServerUrl(this).removeSuffix("/")
        val token = sessionManager.getToken() ?: ""
        val url = if (type == "student_individual" && studentId != null) {
            "$baseUrl/api/teacher/wali-kelas/rekap-pdf?type=student_individual&className=${Uri.encode(homeroomClass)}&studentId=${Uri.encode(studentId)}&token=${Uri.encode(token)}"
        } else {
            "$baseUrl/api/teacher/wali-kelas/rekap-pdf?type=${Uri.encode(type)}&className=${Uri.encode(homeroomClass)}&token=${Uri.encode(token)}"
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        startActivity(intent)
    }

    private fun showSubmitMonthlyReportDialog() {
        val linearLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 24, 40, 20)
        }

        val tvInfo = TextView(this).apply {
            text = "Kirim laporan bulanan rombel $homeroomClass secara resmi ke Tim Kurikulum & Manajemen Sekolah (SIBOY FRESH A6):"
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, 16)
        }
        linearLayout.addView(tvInfo)

        val cal = java.util.Calendar.getInstance()
        val monthNames = arrayOf("Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember")
        val currentMonthName = monthNames[cal.get(java.util.Calendar.MONTH)]
        val currentYear = cal.get(java.util.Calendar.YEAR)

        val tvPeriod = TextView(this).apply {
            text = "📅 Periode: $currentMonthName $currentYear"
            textSize = 13f
            setTextColor(Color.parseColor("#0F172A"))
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 8)
        }
        linearLayout.addView(tvPeriod)

        val attendanceRateStr = binding.tvHeaderAttendancePct.text.toString().replace("% Hadir", "").trim()
        val attendancePct = attendanceRateStr.toDoubleOrNull() ?: 95.0

        val tvStats = TextView(this).apply {
            text = "Kehadiran Rata-rata: $attendanceRateStr% • Siswa: ${allStudents.size} anak"
            textSize = 12f
            setTextColor(Color.parseColor("#059669"))
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 12)
        }
        linearLayout.addView(tvStats)

        val tvLabel = TextView(this).apply {
            text = "Catatan & Evaluasi Wali Kelas:"
            textSize = 12f
            setTextColor(Color.parseColor("#334155"))
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 4, 0, 4)
        }
        linearLayout.addView(tvLabel)

        val etSummary = EditText(this).apply {
            hint = "Tuliskan ringkasan perkembangan KBM dan kedisiplinan rombel..."
            setText("KBM dan kedisiplinan rombel $homeroomClass berjalan kondusif. Presensi rata-rata mencapai $attendanceRateStr%.")
            textSize = 12f
            minLines = 3
            setPadding(16, 16, 16, 16)
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }
        linearLayout.addView(etSummary)

        AlertDialog.Builder(this)
            .setTitle("📊 Laporan Bulanan Rombel ke Kurikulum")
            .setView(linearLayout)
            .setPositiveButton("Kirim ke Kurikulum") { _, _ ->
                val summaryText = etSummary.text.toString().trim()
                val body = mapOf(
                    "className" to homeroomClass,
                    "month" to currentMonthName,
                    "year" to currentYear,
                    "summaryText" to summaryText,
                    "attendancePct" to attendancePct,
                    "problemStudentsCount" to allStudents.count { (it.points ?: 0) > 10 }
                )

                apiService.submitWaliKelasMonthlyReport(body).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(this@WaliKelasActivity, "✅ ${response.body()?.message ?: "Laporan bulanan berhasil dikirim ke Kurikulum!"}", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(this@WaliKelasActivity, "Gagal mengirim laporan bulanan", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@WaliKelasActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showStudentDetailDialog(s: WaliKelasStudentItemDto) {
        val dp = { v: Int -> (v * resources.displayMetrics.density).toInt() }

        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#0F766E"))
        }

        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvBarTitle = TextView(this).apply {
            text = "👤 Dossier Profil Siswa"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        }
        val tvBarSub = TextView(this).apply {
            text = "${s.name} • Kelas $homeroomClass"
            setTextColor(Color.parseColor("#CCFBF1"))
            textSize = 11.5f
        }
        titleBox.addView(tvBarTitle)
        titleBox.addView(tvBarSub)

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "✕ Tutup"
            textSize = 11f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor("#115E59"))
            }
            background = gd
        }

        topBar.addView(titleBox)
        topBar.addView(btnClose)
        rootLayout.addView(topBar)

        val scrollView = androidx.core.widget.NestedScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(16)
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.parseColor("#F8FAFC"))
        }
        scrollView.addView(container)

        // 1. Header Card Siswa (Teal Gradient)
        val headerCard = CardView(this).apply {
            radius = dp(14).toFloat()
            cardElevation = dp(2).toFloat()
            setCardBackgroundColor(Color.parseColor("#0F766E"))
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        val headerInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
        }
        headerInner.addView(TextView(this).apply {
            text = s.name
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        headerInner.addView(TextView(this).apply {
            text = "NISN: ${s.nisn ?: "-"} • NIS: ${s.nis ?: "-"} • Kelas: $homeroomClass"
            textSize = 12f
            setTextColor(Color.parseColor("#CCFBF1"))
            setPadding(0, dp(4), 0, dp(4))
        })
        val points = s.points ?: 0
        headerInner.addView(TextView(this).apply {
            text = "⚖️ Akumulasi Poin Disiplin: $points Poin ${if (points >= 20) "(Perhatian Khusus)" else "(Tertib)"}"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(if (points >= 20) Color.parseColor("#FCA5A5") else Color.parseColor("#FEF08A"))
        })
        headerCard.addView(headerInner)
        container.addView(headerCard)

        // 2. Card Biodata Lengkap Siswa
        val bioCard = CardView(this).apply {
            radius = dp(12).toFloat()
            cardElevation = dp(1).toFloat()
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        val bioInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(12)
            setPadding(p, p, p, p)
        }
        bioInner.addView(TextView(this).apply {
            text = "👤 Biodata Lengkap Kependudukan"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F766E"))
            setPadding(0, 0, 0, dp(6))
        })
        val genderStr = if (s.gender == "L" || s.gender == "LAKI-LAKI") "Laki-laki" else if (s.gender == "P" || s.gender == "PEREMPUAN") "Perempuan" else (s.gender ?: "-")
        bioInner.addView(TextView(this).apply {
            text = "• NIK Siswa: " + (s.nik ?: "-") + "\n" +
                    "• Tempat/Tgl Lahir: " + (s.pob ?: "-") + ", " + (s.dob ?: "-") + "\n" +
                    "• Jenis Kelamin: " + genderStr + "\n" +
                    "• Agama: " + (s.religion ?: "-") + " • Gol. Darah: " + (s.bloodType ?: "-")
            textSize = 11.5f
            setTextColor(Color.parseColor("#334155"))
            setLineSpacing(dp(2).toFloat(), 1f)
        })
        bioCard.addView(bioInner)
        container.addView(bioCard)

        // 3. Card Data Orang Tua & Kontak
        val parentCard = CardView(this).apply {
            radius = dp(12).toFloat()
            cardElevation = dp(1).toFloat()
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        val parentInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(12)
            setPadding(p, p, p, p)
        }
        parentInner.addView(TextView(this).apply {
            text = "👨‍👩‍👧 Orang Tua & Alamat Domisili"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F766E"))
            setPadding(0, 0, 0, dp(6))
        })
        parentInner.addView(TextView(this).apply {
            text = "• Nama Ayah: " + (s.fatherName ?: "-") + "\n" +
                    "• Nama Ibu: " + (s.motherName ?: "-") + "\n" +
                    "• No. WhatsApp Wali: " + (s.parentPhone ?: "-") + "\n" +
                    "• Alamat: " + (s.address ?: "-")
            textSize = 11.5f
            setTextColor(Color.parseColor("#334155"))
            setLineSpacing(dp(2).toFloat(), 1f)
        })

        // Tombol WhatsApp Orang Tua jika ada nomor
        val pPhone = s.parentPhone?.trim() ?: ""
        if (pPhone.isNotEmpty() && pPhone != "-") {
            val btnWa = Button(this).apply {
                text = "💬 Chat WhatsApp Orang Tua"
                textSize = 11.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#059669"))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)).apply {
                    topMargin = dp(8)
                }
                setOnClickListener {
                    val cleanPhone = if (pPhone.startsWith("0")) "62" + pPhone.substring(1) else pPhone
                    try {
                        val waIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$cleanPhone"))
                        startActivity(waIntent)
                    } catch (e: Exception) {
                        Toast.makeText(this@WaliKelasActivity, "Aplikasi WhatsApp tidak ditemukan", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            parentInner.addView(btnWa)
        }
        parentCard.addView(parentInner)
        container.addView(parentCard)

        // 4. Card Status Perangkat Siswa (Tanpa HP vs Mandiri)
        val deviceCard = CardView(this).apply {
            radius = dp(12).toFloat()
            cardElevation = dp(1).toFloat()
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        val deviceInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(12)
            setPadding(p, p, p, p)
        }
        deviceInner.addView(TextView(this).apply {
            text = "📱 Status Perangkat Presensi"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F766E"))
            setPadding(0, 0, 0, dp(4))
        })
        val isNoPhone = s.isNoSmartphone == true
        val tvDeviceStatus = TextView(this).apply {
            text = if (isNoPhone) "📵 Siswa Terdaftar Tanpa HP (Bebas Kuota Bantuan Kartu)" else "📱 Siswa Menggunakan HP Mandiri"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(if (isNoPhone) Color.parseColor("#DC2626") else Color.parseColor("#059669"))
            setPadding(0, 0, 0, dp(6))
        }
        deviceInner.addView(tvDeviceStatus)

        val btnToggleNoPhone = Button(this).apply {
            text = if (isNoPhone) "✅ Cabut Status (Ubah ke Punya HP)" else "⚙️ Tetapkan sebagai Siswa Tanpa HP"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(if (isNoPhone) Color.parseColor("#475569") else Color.parseColor("#DC2626"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38))
        }
        deviceInner.addView(btnToggleNoPhone)
        deviceCard.addView(deviceInner)
        container.addView(deviceCard)

        // 5. Card Berkas Resmi Kependudukan (Murni PDF)
        val docCard = CardView(this).apply {
            radius = dp(12).toFloat()
            cardElevation = dp(1).toFloat()
            setCardBackgroundColor(Color.WHITE)
            useCompatPadding = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(10)
            }
        }
        val docInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(12)
            setPadding(p, p, p, p)
        }
        docInner.addView(TextView(this).apply {
            text = "📄 Berkas Resmi Kependudukan (PDF Murni)"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F766E"))
            setPadding(0, 0, 0, dp(6))
        })

        val docBtnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
        }
        val btnKk = Button(this).apply {
            text = "📄 Buka KK (PDF)"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val hasKk = !s.kkFileUrl.isNullOrEmpty()
            backgroundTintList = android.content.res.ColorStateList.valueOf(if (hasKk) Color.parseColor("#0284C7") else Color.parseColor("#94A3B8"))
            layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f).apply {
                marginEnd = dp(4)
            }
            setOnClickListener {
                openDocumentFileUrl(s.kkFileUrl, "Kartu Keluarga")
            }
        }
        val btnAkta = Button(this).apply {
            text = "📄 Buka Akta (PDF)"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val hasAkta = !s.aktaFileUrl.isNullOrEmpty()
            backgroundTintList = android.content.res.ColorStateList.valueOf(if (hasAkta) Color.parseColor("#0D9488") else Color.parseColor("#94A3B8"))
            layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f).apply {
                marginStart = dp(4)
            }
            setOnClickListener {
                openDocumentFileUrl(s.aktaFileUrl, "Akta Kelahiran")
            }
        }
        docBtnRow.addView(btnKk)
        docBtnRow.addView(btnAkta)
        docInner.addView(docBtnRow)
        docCard.addView(docInner)
        container.addView(docCard)

        // 6. Status Presensi Hari Ini
        val att = s.todayAttendance
        val todayInfo = "Status: " + (att?.statusText ?: "Belum Presensi") + "\n" +
                "Jam Masuk (Gate-In): " + (att?.gateInTime ?: "-") + "\n" +
                "Jam Pulang (Gate-Out): " + (att?.gateOutTime ?: "-")
        val tvTodayDetail = TextView(this).apply {
            text = "⏱️ Presensi Hari Ini:\n" + todayInfo
            textSize = 11.5f
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(4), 0, dp(8))
        }
        container.addView(tvTodayDetail)

        // 7. Catatan Wali Kelas Section (Visible ke Ortu & BK)
        val tvNoteSection = TextView(this).apply {
            text = "📝 Catatan Pembinaan Wali Kelas (Visible ke Ortu & BK)"
            textSize = 12.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F766E"))
            setPadding(0, dp(4), 0, dp(4))
        }
        container.addView(tvNoteSection)

        val etStudentNote = EditText(this).apply {
            hint = "Tuliskan catatan pembinaan, motivasi, atau evaluasi untuk ananda ${s.name}..."
            textSize = 12f
            minLines = 3
            setPadding(dp(12), dp(12), dp(12), dp(12))
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }
        container.addView(etStudentNote)

        val cbUrgent = CheckBox(this).apply {
            text = "🚨 Tandai Mendesak / Penting (Perhatian Khusus)"
            textSize = 11.5f
            setTextColor(Color.parseColor("#DC2626"))
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        container.addView(cbUrgent)

        val btnSendNote = Button(this).apply {
            text = "📤 Kirim Catatan ke Siswa, Ortu & BK"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#0F766E"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)).apply {
                topMargin = dp(8)
                bottomMargin = dp(16)
            }
        }
        container.addView(btnSendNote)

        rootLayout.addView(scrollView)

        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Light_NoActionBar_Fullscreen)
            .setView(rootLayout)
            .setCancelable(true)
            .create()

        btnClose.setOnClickListener { dialog.dismiss() }

        btnToggleNoPhone.setOnClickListener {
            val targetNewState = !(s.isNoSmartphone ?: false)
            btnToggleNoPhone.isEnabled = false
            btnToggleNoPhone.text = "Memperbarui..."

            apiService.toggleNoPhoneStudent(mapOf(
                "studentId" to s.id,
                "isNoPhone" to targetNewState
            )).enqueue(object : Callback<BasicResponse> {
                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                    btnToggleNoPhone.isEnabled = true
                    if (response.isSuccessful && response.body()?.success == true) {
                        Toast.makeText(this@WaliKelasActivity, response.body()?.message ?: "Status Tanpa HP berhasil diubah", Toast.LENGTH_SHORT).show()
                        dialog.dismiss()
                        loadStudents()
                    } else {
                        btnToggleNoPhone.text = "Gagal Mengubah Status"
                        Toast.makeText(this@WaliKelasActivity, "Gagal mengubah status siswa", Toast.LENGTH_SHORT).show()
                    }
                }

                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                    btnToggleNoPhone.isEnabled = true
                    btnToggleNoPhone.text = "Gagal Mengubah Status"
                    Toast.makeText(this@WaliKelasActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            })
        }

        btnSendNote.setOnClickListener {
            val noteText = etStudentNote.text.toString().trim()
            if (noteText.isEmpty()) {
                Toast.makeText(this, "Silakan isi catatan pembinaan terlebih dahulu", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val body = mapOf(
                "studentId" to s.id,
                "note" to noteText,
                "isUrgent" to cbUrgent.isChecked
            )

            btnSendNote.isEnabled = false
            btnSendNote.text = "Mengirim..."

            apiService.submitWaliKelasStudentNote(body).enqueue(object : Callback<BasicResponse> {
                override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                    btnSendNote.isEnabled = true
                    btnSendNote.text = "📤 Kirim Catatan ke Siswa, Ortu & BK"
                    if (response.isSuccessful && response.body()?.success == true) {
                        Toast.makeText(this@WaliKelasActivity, "✅ Catatan berhasil disimpan dan diteruskan ke Orang Tua & BK!", Toast.LENGTH_LONG).show()
                        dialog.dismiss()
                    } else {
                        Toast.makeText(this@WaliKelasActivity, response.body()?.message ?: "Gagal mengirim catatan", Toast.LENGTH_SHORT).show()
                    }
                }

                override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                    btnSendNote.isEnabled = true
                    btnSendNote.text = "📤 Kirim Catatan ke Siswa, Ortu & BK"
                    Toast.makeText(this@WaliKelasActivity, "Error: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            })
        }

        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private fun openDocumentFileUrl(rawUrl: String?, title: String) {
        if (rawUrl.isNullOrEmpty()) {
            Toast.makeText(this, "Orang tua belum mengunggah dokumen PDF $title", Toast.LENGTH_SHORT).show()
            return
        }
        val baseUrl = ApiClient.getBaseServerUrl(this).removeSuffix("/")
        val fullUrl = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) rawUrl else "$baseUrl/${rawUrl.trimStart('/')}"
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(fullUrl))
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal membuka dokumen PDF: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showMonitoringAkademikDialog() {
        val dp = { v: Int -> (v * resources.displayMetrics.density).toInt() }
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_NoActionBar_Fullscreen).create()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#4338CA"))
        }
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleBox.addView(TextView(this).apply {
            text = "📈 Monitoring Akademik & Remedial"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        })
        titleBox.addView(TextView(this).apply {
            text = "Kelas $homeroomClass • Pantau capaian KBM & kelengkapan nilai mapel"
            setTextColor(Color.parseColor("#E0E7FF"))
            textSize = 11.5f
        })
        topBar.addView(titleBox)

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "✕ Tutup"
            textSize = 11f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor("#3730A3"))
            }
            background = gd
            setOnClickListener { dialog.dismiss() }
        }
        topBar.addView(btnClose)
        root.addView(topBar)

        val sv = androidx.core.widget.NestedScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        sv.addView(container)

        // KPI Summary Box
        val kpiCard = CardView(this).apply {
            radius = dp(12).toFloat()
            cardElevation = dp(2).toFloat()
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        val kpiInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(12)
            setPadding(p, p, p, p)
        }
        kpiInner.addView(TextView(this).apply {
            text = "📊 Ringkasan Capaian Pembelajaran"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1E1B4B"))
        })

        val total = allStudents.size
        val scoredStudents = allStudents.filter { (it.completedExamsCount ?: 0) > 0 }
        val classAvg = if (scoredStudents.isNotEmpty()) scoredStudents.map { it.academicAvgScore ?: 0.0 }.average() else 0.0
        val passingCount = scoredStudents.count { (it.academicAvgScore ?: 0.0) >= 75.0 }
        val remedialCount = scoredStudents.count { (it.academicAvgScore ?: 0.0) < 75.0 }

        val kpiDesc = TextView(this).apply {
            text = "Total $total Siswa terdaftar (${scoredStudents.size} memiliki data ujian CBT). Rata-rata kelas: ${"%.1f".format(classAvg)} • Tuntas KKM: $passingCount • Butuh Remedial: $remedialCount. Nilai disinkronkan langsung dari hasil ujian CBT & asesmen guru mapel."
            textSize = 11f
            setTextColor(Color.parseColor("#475569"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(4)
            }
            layoutParams = lp
        }
        kpiInner.addView(kpiDesc)
        kpiCard.addView(kpiInner)
        container.addView(kpiCard)

        allStudents.forEachIndexed { idx, s ->
            val card = CardView(this).apply {
                radius = dp(10).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(8)
                }
                layoutParams = lp
            }
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }
            val num = TextView(this).apply {
                text = "${idx + 1}."
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#64748B"))
                layoutParams = LinearLayout.LayoutParams(dp(28), ViewGroup.LayoutParams.WRAP_CONTENT)
            }
            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            val name = TextView(this).apply {
                text = s.name
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            }

            val avg = s.academicAvgScore ?: 0.0
            val examCount = s.completedExamsCount ?: 0

            val nisn = TextView(this).apply {
                text = if (examCount > 0) {
                    "NISN: ${s.nisn ?: "-"} • Nilai Rata-rata: ${"%.1f".format(avg)} ($examCount Ujian)"
                } else {
                    "NISN: ${s.nisn ?: "-"} • Belum ada rekap nilai ujian CBT"
                }
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
            }
            info.addView(name)
            info.addView(nisn)

            val isPassing = examCount > 0 && avg >= 75.0
            val badgeText = if (examCount == 0) "Belum Ada Nilai" else if (isPassing) "✅ Tuntas" else "⚠️ Perlu Remedial"
            val badgeTextColor = if (examCount == 0) "#64748B" else if (isPassing) "#059669" else "#DC2626"
            val badgeBgColor = if (examCount == 0) "#F1F5F9" else if (isPassing) "#ECFDF5" else "#FEF2F2"

            val badge = TextView(this).apply {
                text = badgeText
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(badgeTextColor))
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(6).toFloat()
                    setColor(Color.parseColor(badgeBgColor))
                }
                background = gd
                val bp = dp(6)
                setPadding(bp, dp(3), bp, dp(3))
            }

            row.addView(num)
            row.addView(info)
            row.addView(badge)
            card.addView(row)
            card.setOnClickListener {
                showStudentDetailDialog(s)
            }
            container.addView(card)
        }

        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun showCatatanPembinaanHubDialog() {
        val dp = { v: Int -> (v * resources.displayMetrics.density).toInt() }
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_NoActionBar_Fullscreen).create()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#0F766E"))
        }
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleBox.addView(TextView(this).apply {
            text = "📝 Catatan & Pembinaan Siswa"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        })
        titleBox.addView(TextView(this).apply {
            text = "Kelas $homeroomClass • Konsultasi, pembinaan karakter & rujukan BK"
            setTextColor(Color.parseColor("#CCFBF1"))
            textSize = 11.5f
        })
        topBar.addView(titleBox)

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "✕ Tutup"
            textSize = 11f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor("#115E59"))
            }
            background = gd
            setOnClickListener { dialog.dismiss() }
        }
        topBar.addView(btnClose)
        root.addView(topBar)

        val sv = androidx.core.widget.NestedScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        sv.addView(container)

        // Info Workflow Status
        val cardWorkflow = CardView(this).apply {
            radius = dp(10).toFloat()
            cardElevation = dp(2).toFloat()
            setCardBackgroundColor(Color.parseColor("#F0FDFA"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(12)
            }
            layoutParams = lp
        }
        val wfInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(12)
            setPadding(p, p, p, p)
        }
        wfInner.addView(TextView(this).apply {
            text = "🔄 Alur Siklus Pembinaan Siswa Wali Kelas:"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F766E"))
        })
        wfInner.addView(TextView(this).apply {
            text = "1. DRAF ➔ 2. PERLU TINDAK LANJUT ➔ 3. DALAM PENANGANAN ➔ 4. SELESAI\nKetuk pada salah satu siswa di bawah untuk menulis catatan pembinaan atau merujuk ke Guru BK."
            textSize = 10.5f
            setTextColor(Color.parseColor("#134E4A"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(4)
            }
            layoutParams = lp
        })
        cardWorkflow.addView(wfInner)
        container.addView(cardWorkflow)

        // Siswa list untuk catatan cepat
        allStudents.forEach { s ->
            val card = CardView(this).apply {
                radius = dp(10).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(8)
                }
                layoutParams = lp
            }
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }
            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            info.addView(TextView(this).apply {
                text = s.name
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            })
            val pts = s.points ?: 0
            info.addView(TextView(this).apply {
                text = "Poin: $pts • Status: ${if (pts >= 20) "Perlu Perhatian" else "Tertib"}"
                textSize = 10.5f
                setTextColor(if (pts >= 20) Color.parseColor("#DC2626") else Color.parseColor("#64748B"))
            })
            row.addView(info)

            val btnNote = androidx.appcompat.widget.AppCompatButton(this).apply {
                text = "✏️ Tulis Catatan"
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F766E"))
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(6).toFloat()
                    setColor(Color.parseColor("#CCFBF1"))
                }
                background = gd
                val p = dp(8)
                setPadding(p, dp(4), p, dp(4))
                setOnClickListener {
                    showStudentDetailDialog(s)
                }
            }
            row.addView(btnNote)
            card.addView(row)
            container.addView(card)
        }

        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun showKomunikasiOrtuHubDialog() {
        val dp = { v: Int -> (v * resources.displayMetrics.density).toInt() }
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_NoActionBar_Fullscreen).create()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#047857"))
        }
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleBox.addView(TextView(this).apply {
            text = "💬 Komunikasi Orang Tua / Wali"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        })
        titleBox.addView(TextView(this).apply {
            text = "Kelas $homeroomClass • Hubungi kontak darurat & orang tua siswa"
            setTextColor(Color.parseColor("#A7F3D0"))
            textSize = 11.5f
        })
        topBar.addView(titleBox)

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "✕ Tutup"
            textSize = 11f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor("#065F46"))
            }
            background = gd
            setOnClickListener { dialog.dismiss() }
        }
        topBar.addView(btnClose)
        root.addView(topBar)

        val sv = androidx.core.widget.NestedScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        sv.addView(container)

        allStudents.forEachIndexed { idx, s ->
            val card = CardView(this).apply {
                radius = dp(10).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(8)
                }
                layoutParams = lp
            }
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }
            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            info.addView(TextView(this).apply {
                text = "${idx + 1}. ${s.name}"
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            })
            val ortuName = s.fatherName ?: s.motherName ?: "Orang Tua Siswa"
            val phone = s.parentPhone ?: "-"
            info.addView(TextView(this).apply {
                text = "Wali: $ortuName • Telp: $phone"
                textSize = 11f
                setTextColor(Color.parseColor("#64748B"))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(2)
                }
                layoutParams = lp
            })
            row.addView(info)

            if (!s.parentPhone.isNullOrBlank() && s.parentPhone != "-") {
                val btnWa = Button(this).apply {
                    text = "WA"
                    textSize = 10.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.WHITE)
                    backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#25D366"))
                    val lp = LinearLayout.LayoutParams(dp(54), dp(36))
                    layoutParams = lp
                    setOnClickListener {
                        val cleanPhone = s.parentPhone!!.replace("[^0-9]".toRegex(), "")
                        val formattedPhone = if (cleanPhone.startsWith("0")) "62" + cleanPhone.substring(1) else cleanPhone
                        try {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$formattedPhone?text=Halo%20Bapak/Ibu%20Wali%20dari%20${Uri.encode(s.name)},%20kami%20dari%20pihak%20sekolah%20SMPN%201%20Boyolangu."))
                            startActivity(intent)
                        } catch (e: Exception) {
                            Toast.makeText(this@WaliKelasActivity, "Aplikasi WhatsApp tidak terpasang.", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
                row.addView(btnWa)
            }

            card.addView(row)
            container.addView(card)
        }

        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun showAdministrasiRaporDialog() {
        val dp = { v: Int -> (v * resources.displayMetrics.density).toInt() }
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_NoActionBar_Fullscreen).create()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
            setBackgroundColor(Color.parseColor("#0F766E"))
        }
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleBox.addView(TextView(this).apply {
            text = "📑 Administrasi Kelas & Validasi Rapor"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
        })
        titleBox.addView(TextView(this).apply {
            text = "Kelas $homeroomClass • Pusat verifikasi dokumen digital & kesiapan rapor"
            setTextColor(Color.parseColor("#CCFBF1"))
            textSize = 11.5f
        })
        topBar.addView(titleBox)

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "✕ Tutup"
            textSize = 11f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor("#115E59"))
            }
            background = gd
            setOnClickListener { dialog.dismiss() }
        }
        topBar.addView(btnClose)
        root.addView(topBar)

        val sv = androidx.core.widget.NestedScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        sv.addView(container)

        // Real Document & Academic Verification Statistics Card
        val total = allStudents.size
        val kkCount = allStudents.count { !it.kkFileUrl.isNullOrBlank() }
        val aktaCount = allStudents.count { !it.aktaFileUrl.isNullOrBlank() }
        val completeDocs = allStudents.count { !it.kkFileUrl.isNullOrBlank() && !it.aktaFileUrl.isNullOrBlank() }
        val docPct = if (total > 0) (completeDocs * 100) / total else 0
        val examCountScored = allStudents.count { (it.completedExamsCount ?: 0) > 0 }

        val summaryCard = CardView(this).apply {
            radius = dp(14).toFloat()
            cardElevation = dp(3).toFloat()
            setCardBackgroundColor(Color.WHITE)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
            layoutParams = lp
        }
        val sInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
        }
        sInner.addView(TextView(this).apply {
            text = "📊 Kesiapan Berkas & Nilai Rombel $homeroomClass"
            textSize = 13.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        })

        val metricsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 3f
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(10)
            }
            layoutParams = lp
        }
        fun createMiniMetric(label: String, value: String, sub: String, colorHex: String): View {
            return LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(8).toFloat()
                    setColor(Color.parseColor("#F8FAFC"))
                    setStroke(dp(1), Color.parseColor("#E2E8F0"))
                }
                background = gd
                val p = dp(8)
                setPadding(p, p, p, p)
                addView(TextView(this@WaliKelasActivity).apply {
                    text = value
                    textSize = 13f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor(colorHex))
                })
                addView(TextView(this@WaliKelasActivity).apply {
                    text = label
                    textSize = 9.5f
                    setTextColor(Color.parseColor("#475569"))
                    setTypeface(null, Typeface.BOLD)
                })
                addView(TextView(this@WaliKelasActivity).apply {
                    text = sub
                    textSize = 8.5f
                    setTextColor(Color.parseColor("#94A3B8"))
                })
            }
        }
        metricsRow.addView(createMiniMetric("KK Terkumpul", "$kkCount/$total", "Server /uploads/kk/", "#0284C7"))
        val space1 = View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(6), 0) }
        metricsRow.addView(space1)
        metricsRow.addView(createMiniMetric("Akta Lahir", "$aktaCount/$total", "Server /uploads/akta/", "#7C3AED"))
        val space2 = View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(6), 0) }
        metricsRow.addView(space2)
        metricsRow.addView(createMiniMetric("CBT Terdata", "$examCountScored/$total", "Nilai Real DB", "#059669"))
        sInner.addView(metricsRow)
        summaryCard.addView(sInner)
        container.addView(summaryCard)

        container.addView(TextView(this).apply {
            text = "✅ CHECKLIST VALIDASI RAPOR & TUGAS WALI KELAS:"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(8)
                marginStart = dp(4)
            }
            layoutParams = lp
        })

        data class CheckItem(val id: Int, val title: String, val subtitle: String, val actionTitle: String, val onAction: () -> Unit)
        val checklist = listOf(
            CheckItem(
                1,
                "1. Verifikasi Berkas Fisik & Digital (KK & Akta)",
                "Kelengkapan KK & Akta per folder siswa server ($completeDocs/$total lengkap)",
                "📋 Lihat Status Berkas",
                { showUnverifiedDocsDialog() }
            ),
            CheckItem(
                2,
                "2. Kelengkapan Nilai Mata Pelajaran & Remedial",
                "Sinkronisasi capaian pembelajaran seluruh guru mapel & CBT",
                "📈 Buka Nilai Akademik",
                { showMonitoringAkademikDialog() }
            ),
            CheckItem(
                3,
                "3. Rekapitulasi Presensi Semester Berjalan",
                "Sinkronisasi kehadiran harian (Hadir, TP, Izin, Sakit, Alpa)",
                "📊 Buka Rekap Presensi",
                {
                    dialog.dismiss()
                    switchSection(2)
                    loadRekap()
                }
            ),
            CheckItem(
                4,
                "4. Catatan Wali Kelas & Pembinaan Karakter",
                "Konsultasi, kepribadian, catatan pembinaan, & koordinasi BK",
                "📝 Buka Hub Pembinaan",
                { showCatatanPembinaanHubDialog() }
            ),
            CheckItem(
                5,
                "5. Penilaian Ekstrakurikuler & Rapor Karakter",
                "Validasi partisipasi ekstrakurikuler & Profil Pelajar Pancasila",
                "🌟 Konfirmasi Selesai",
                { Toast.makeText(this@WaliKelasActivity, "✅ Validasi Ekstrakurikuler telah dicatat!", Toast.LENGTH_SHORT).show() }
            )
        )

        checklist.forEach { item ->
            val card = CardView(this).apply {
                radius = dp(12).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(10)
                }
                layoutParams = lp
            }
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }

            val topPart = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val cb = android.widget.CheckBox(this).apply {
                isChecked = true
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                layoutParams = lp
            }
            topPart.addView(cb)

            val textCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginStart = dp(6)
                }
                layoutParams = lp
            }
            textCol.addView(TextView(this).apply {
                text = item.title
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            })
            textCol.addView(TextView(this).apply {
                text = item.subtitle
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
            })
            topPart.addView(textCol)
            row.addView(topPart)

            val btnAction = androidx.appcompat.widget.AppCompatButton(this).apply {
                text = item.actionTitle
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F766E"))
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(6).toFloat()
                    setColor(Color.parseColor("#F0FDFA"))
                    setStroke(dp(1), Color.parseColor("#99F6E4"))
                }
                background = gd
                val bp = dp(6)
                setPadding(bp, dp(2), bp, dp(2))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)).apply {
                    topMargin = dp(8)
                    marginStart = dp(34)
                }
                layoutParams = lp
                setOnClickListener { item.onAction() }
            }
            row.addView(btnAction)

            card.addView(row)
            container.addView(card)
        }

        // Action Buttons
        val btnDownloadReport = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "🖨️ Cetak Rekap Resmi Rapor Kelas (PDF)"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor("#0F766E"))
            }
            background = gd
            val p = dp(12)
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(14)
            }
            layoutParams = lp
            setOnClickListener {
                openPdfUrl("class_monthly", null)
            }
        }
        container.addView(btnDownloadReport)

        val btnUnverified = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "📋 Periksa Siswa Belum Lengkap Berkas KK / Akta"
            textSize = 11.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0284C7"))
            val gd = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(Color.parseColor("#F0F9FF"))
                setStroke(dp(1), Color.parseColor("#BAE6FD"))
            }
            background = gd
            val p = dp(10)
            setPadding(p, p, p, p)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            }
            layoutParams = lp
            setOnClickListener {
                showUnverifiedDocsDialog()
            }
        }
        container.addView(btnUnverified)

        root.addView(sv)
        dialog.setView(root)
        dialog.show()
    }

    private fun showUnverifiedDocsDialog() {
        val dp = { v: Int -> (v * resources.displayMetrics.density).toInt() }
        val dialog = AlertDialog.Builder(this).create()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            setPadding(0, 0, 0, dp(12))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0284C7"))
            val p = dp(16)
            setPadding(p, p, p, p)
        }
        header.addView(TextView(this).apply {
            text = "📑 Status Berkas Siswa Kelas $homeroomClass"
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        header.addView(TextView(this).apply {
            text = "Daftar kelengkapan berkas Kartu Keluarga & Akta Kelahiran di server"
            textSize = 11f
            setTextColor(Color.parseColor("#E0F2FE"))
            setPadding(0, dp(4), 0, 0)
        })
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(14)
            setPadding(p, p, p, p)
        }

        allStudents.forEachIndexed { idx, s ->
            val hasKk = !s.kkFileUrl.isNullOrBlank()
            val hasAkta = !s.aktaFileUrl.isNullOrBlank()

            val card = CardView(this).apply {
                radius = dp(10).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(8)
                }
                layoutParams = lp
            }
            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                val p = dp(12)
                setPadding(p, p, p, p)
            }

            val infoCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            infoCol.addView(TextView(this).apply {
                text = "${idx + 1}. ${s.name}"
                textSize = 12.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            })
            infoCol.addView(TextView(this).apply {
                val kkStatus = if (hasKk) "KK: ✅" else "KK: ❌"
                val aktaStatus = if (hasAkta) "Akta: ✅" else "Akta: ❌"
                text = "NISN: ${s.nisn ?: "-"} • $kkStatus • $aktaStatus"
                textSize = 10.5f
                setTextColor(Color.parseColor(if (hasKk && hasAkta) "#059669" else "#DC2626"))
            })
            inner.addView(infoCol)

            val btnViewDocs = androidx.appcompat.widget.AppCompatButton(this).apply {
                text = "📂 Buka"
                textSize = 10.5f
                setTextColor(Color.parseColor("#0284C7"))
                val gd = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(6).toFloat()
                    setColor(Color.parseColor("#F0F9FF"))
                    setStroke(dp(1), Color.parseColor("#BAE6FD"))
                }
                background = gd
                val p = dp(6)
                setPadding(p, dp(2), p, dp(2))
                setOnClickListener {
                    showStudentDocumentsHubDialog(s)
                }
            }
            inner.addView(btnViewDocs)
            card.addView(inner)
            content.addView(card)
        }

        sv.addView(content)
        root.addView(sv)

        val btnClose = androidx.appcompat.widget.AppCompatButton(this).apply {
            text = "Tutup"
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { dialog.dismiss() }
        }
        root.addView(btnClose)

        dialog.setView(root)
        dialog.show()
    }

// ==================== ADAPTERS ====================

    inner class StudentAdapter(private val list: List<WaliKelasStudentItemDto>) :
        RecyclerView.Adapter<StudentAdapter.StudentViewHolder>() {

        inner class StudentViewHolder(val b: ItemWaliKelasStudentBinding) : RecyclerView.ViewHolder(b.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): StudentViewHolder {
            val b = ItemWaliKelasStudentBinding.inflate(layoutInflater, parent, false)
            return StudentViewHolder(b)
        }

        override fun onBindViewHolder(holder: StudentViewHolder, position: Int) {
            val s = list[position]
            val b = holder.b

            b.tvStudentName.text = s.name
            b.tvStudentAvatar.text = s.name.firstOrNull()?.toString()?.uppercase() ?: "S"
            b.tvStudentNisn.text = "NISN: ${s.nisn ?: "-"} • Poin: ${s.points ?: 0}"

            val att = s.todayAttendance
            val stCode = att?.statusCode ?: "BELUM"
            val isNotAttended = att == null || stCode == "BELUM" || stCode == "A"
            if (isNotAttended) {
                b.tvStudentName.setTextColor(Color.parseColor("#DC2626"))
            } else {
                b.tvStudentName.setTextColor(Color.parseColor("#0F172A"))
            }
            val inTime = att?.gateInTime ?: "-"
            val outTime = att?.gateOutTime ?: "-"
            val noteInfo = if (!att?.note.isNullOrBlank()) " • 📝 ${att.note}" else ""
            b.tvAttendanceTimes.text = "In: $inTime • Out: $outTime$noteInfo"

            when (stCode) {
                "H" -> {
                    b.tvAttendanceStatusBadge.text = "🟢 Hadir Lengkap"
                    b.tvAttendanceStatusBadge.setTextColor(Color.parseColor("#15803D"))
                }
                "?", "TP" -> {
                    b.tvAttendanceStatusBadge.text = "🔷 [TP] Tanpa Pulang"
                    b.tvAttendanceStatusBadge.setTextColor(Color.parseColor("#0284C7"))
                }
                "T" -> {
                    b.tvAttendanceStatusBadge.text = "🟡 Terlambat"
                    b.tvAttendanceStatusBadge.setTextColor(Color.parseColor("#B45309"))
                }
                "S" -> {
                    b.tvAttendanceStatusBadge.text = "🏥 Sakit (Surat BK/Ortu)"
                    b.tvAttendanceStatusBadge.setTextColor(Color.parseColor("#1D4ED8"))
                }
                "I" -> {
                    b.tvAttendanceStatusBadge.text = "📩 Izin (Surat BK/Ortu)"
                    b.tvAttendanceStatusBadge.setTextColor(Color.parseColor("#7E22CE"))
                }
                "A" -> {
                    b.tvAttendanceStatusBadge.text = "🔴 Alfa"
                    b.tvAttendanceStatusBadge.setTextColor(Color.parseColor("#B91C1C"))
                }
                else -> {
                    b.tvAttendanceStatusBadge.text = "⚪ Belum Presensi"
                    b.tvAttendanceStatusBadge.setTextColor(Color.parseColor("#64748B"))
                }
            }

            // Klik Card Siswa untuk Rincian & Catatan Wali Kelas (SIBOY A6)
            b.root.setOnClickListener {
                showStudentDetailDialog(s)
            }

            // Tombol Absen Manual Sinkron (Masuk disabled jika sudah absen masuk, tinggal pulang)
            val hasMasuk = !att?.gateInTime.isNullOrBlank() && att?.gateInTime != "-"
            val hasPulang = !att?.gateOutTime.isNullOrBlank() && att?.gateOutTime != "-"

            if (hasMasuk && hasPulang) {
                b.btnStudentManual.text = "✅ Lengkap"
                b.btnStudentManual.isEnabled = false
                b.btnStudentManual.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#94A3B8"))
            } else if (hasMasuk) {
                b.btnStudentManual.text = "🚪 Pulang"
                b.btnStudentManual.isEnabled = true
                b.btnStudentManual.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#0284C7"))
                b.btnStudentManual.setOnClickListener {
                    showManualAttendanceDialog(s, forceGateOut = true)
                }
            } else {
                b.btnStudentManual.text = "🟢 Masuk"
                b.btnStudentManual.isEnabled = true
                b.btnStudentManual.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#15803D"))
                b.btnStudentManual.setOnClickListener {
                    showManualAttendanceDialog(s, forceGateOut = false)
                }
            }

            // Tombol Berkas & Dokumen Digital Siswa (KK, Akta, Biodata, Rekap)
            b.btnStudentPdf.setOnClickListener {
                showStudentDocumentsHubDialog(s)
            }

            // Tombol WhatsApp Orang Tua
            if (!s.parentPhone.isNullOrBlank()) {
                b.btnStudentWa.visibility = View.VISIBLE
                b.btnStudentWa.setOnClickListener {
                    val cleanPhone = s.parentPhone.replace(Regex("[^0-9]"), "")
                    val waUrl = "https://wa.me/$cleanPhone"
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(waUrl)))
                }
            } else {
                b.btnStudentWa.visibility = View.GONE
            }
        }

        override fun getItemCount() = list.size
    }

    private fun showStudentDocumentsHubDialog(s: WaliKelasStudentItemDto) {
        val dp = { v: Int -> (v * resources.displayMetrics.density).toInt() }
        val dialog = AlertDialog.Builder(this).create()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            setPadding(0, 0, 0, dp(12))
        }

        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F766E"))
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val tvTitle = TextView(this).apply {
            text = "📂 Berkas Digital & Dokumen Siswa"
            textSize = 15.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }
        val tvSub = TextView(this).apply {
            text = "${s.name} • NISN: ${s.nisn ?: "-"} • Kelas $homeroomClass"
            textSize = 11.5f
            setTextColor(Color.parseColor("#CCFBF1"))
            setPadding(0, dp(4), 0, 0)
        }
        header.addView(tvTitle)
        header.addView(tvSub)
        root.addView(header)

        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(4))
        }

        val baseUrl = ApiClient.getBaseServerUrl(this).removeSuffix("/")
        val token = sessionManager.getToken() ?: ""

        // Card Helper
        fun createDocItem(
            emoji: String,
            title: String,
            desc: String,
            statusBadge: String,
            badgeBg: String,
            badgeColor: String,
            btnText: String,
            btnColor: String,
            isEnabled: Boolean,
            onClick: () -> Unit
        ): View {
            val card = CardView(this).apply {
                radius = dp(12).toFloat()
                cardElevation = dp(2).toFloat()
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(10)
                }
                layoutParams = lp
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(12), dp(12), dp(12))
            }

            val top = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            top.addView(TextView(this).apply {
                text = emoji
                textSize = 20f
            })
            val titleLayout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginStart = dp(8)
                }
                layoutParams = lp
            }
            titleLayout.addView(TextView(this).apply {
                text = title
                textSize = 13f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            })
            titleLayout.addView(TextView(this).apply {
                text = desc
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
            })
            top.addView(titleLayout)

            val badge = TextView(this).apply {
                text = statusBadge
                textSize = 9.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(badgeColor))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.parseColor(badgeBg))
                    cornerRadius = dp(6).toFloat()
                }
                setPadding(dp(6), dp(2), dp(6), dp(2))
            }
            top.addView(badge)
            inner.addView(top)

            val btn = Button(this).apply {
                text = btnText
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor(btnColor))
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)).apply {
                    topMargin = dp(10)
                }
                layoutParams = lp
                this.isEnabled = isEnabled
                setOnClickListener { onClick() }
            }
            inner.addView(btn)

            card.addView(inner)
            return card
        }

        // 1. BIODATA RESMI A4 (Lengkap Data Ortu & Foto)
        content.addView(createDocItem(
            emoji = "📄",
            title = "Formulir Biodata Lengkap Siswa (A4)",
            desc = "Format resmi kop sekolah lengkap data orang tua, alamat, NIK & foto",
            statusBadge = "PORTAL TERSEDIA",
            badgeBg = "#D1FAE5",
            badgeColor = "#059669",
            btnText = "🖨️ Cetak / Buka Biodata Lengkap PDF",
            btnColor = "#059669",
            isEnabled = true
        ) {
            dialog.dismiss()
            val printUrl = "$baseUrl/api/biodata/print/${s.id}?token=${Uri.encode(token)}"
            try {
                AttendancePdfHelper.printViaWebView(this, printUrl, "Biodata_${s.name.replace(' ', '_')}", "A4")
            } catch (e: Exception) {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(printUrl))
                startActivity(intent)
            }
        })

        // 2. KARTU KELUARGA (KK)
        val hasKk = !s.kkFileUrl.isNullOrBlank()
        content.addView(createDocItem(
            emoji = "📑",
            title = "Berkas Kartu Keluarga (KK) Siswa",
            desc = if (hasKk) "Berkas KK resmi tersimpan di server portal sekolah" else "Berkas KK belum diunggah oleh siswa/operator di portal",
            statusBadge = if (hasKk) "TERUNGGAH" else "BELUM ADA",
            badgeBg = if (hasKk) "#E0F2FE" else "#FEE2E2",
            badgeColor = if (hasKk) "#0284C7" else "#DC2626",
            btnText = if (hasKk) "📥 Buka / Unduh Berkas KK" else "⚠️ Berkas KK Belum Tersedia",
            btnColor = if (hasKk) "#0284C7" else "#94A3B8",
            isEnabled = hasKk
        ) {
            dialog.dismiss()
            val kkFull = if (s.kkFileUrl!!.startsWith("http")) s.kkFileUrl else "$baseUrl${s.kkFileUrl}"
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(kkFull)))
        })

        // 3. AKTA KELAHIRAN
        val hasAkta = !s.aktaFileUrl.isNullOrBlank()
        content.addView(createDocItem(
            emoji = "📜",
            title = "Berkas Akta Kelahiran Siswa",
            desc = if (hasAkta) "Berkas Akta Kelahiran resmi tersimpan di portal sekolah" else "Berkas Akta belum diunggah oleh siswa/operator di portal",
            statusBadge = if (hasAkta) "TERUNGGAH" else "BELUM ADA",
            badgeBg = if (hasAkta) "#EDE9FE" else "#FEE2E2",
            badgeColor = if (hasAkta) "#7C3AED" else "#DC2626",
            btnText = if (hasAkta) "📥 Buka / Unduh Berkas Akta" else "⚠️ Berkas Akta Belum Tersedia",
            btnColor = if (hasAkta) "#7C3AED" else "#94A3B8",
            isEnabled = hasAkta
        ) {
            dialog.dismiss()
            val aktaFull = if (s.aktaFileUrl!!.startsWith("http")) s.aktaFileUrl else "$baseUrl${s.aktaFileUrl}"
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(aktaFull)))
        })

        // 4. REKAP PRESENSI INDIVIDU
        content.addView(createDocItem(
            emoji = "📊",
            title = "Laporan Rekap Presensi Siswa",
            desc = "Rekapitulasi kehadiran harian, izin, sakit & alpa semester berjalan",
            statusBadge = "REKAP SIBOY",
            badgeBg = "#FEF3C7",
            badgeColor = "#D97706",
            btnText = "🖨️ Cetak Rekapitulasi Presensi PDF",
            btnColor = "#D97706",
            isEnabled = true
        ) {
            dialog.dismiss()
            openPdfUrl("student_individual", s.id)
        })

        sv.addView(content)
        root.addView(sv)

        val btnClose = Button(this).apply {
            text = "Tutup"
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            setBackgroundColor(Color.TRANSPARENT)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)).apply {
                marginEnd = dp(14)
                marginStart = dp(14)
            }
            layoutParams = lp
            setOnClickListener { dialog.dismiss() }
        }
        root.addView(btnClose)

        dialog.setView(root)
        dialog.show()
    }

    inner class RekapAdapter(private val list: List<WaliKelasRekapItemDto>) :
        RecyclerView.Adapter<RekapAdapter.RekapViewHolder>() {

        inner class RekapViewHolder(val b: ItemWaliKelasRekapBinding) : RecyclerView.ViewHolder(b.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RekapViewHolder {
            val b = ItemWaliKelasRekapBinding.inflate(layoutInflater, parent, false)
            return RekapViewHolder(b)
        }

        override fun onBindViewHolder(holder: RekapViewHolder, position: Int) {
            val r = list[position]
            val b = holder.b

            b.tvRekapNo.text = "${r.no}."
            b.tvRekapName.text = r.name
            b.tvRekapPercentage.text = "${r.attendancePercentage}%"

            b.tvRekapH.text = "H: ${r.H}"
            b.tvRekapQuestion.text = "TP: ${r.questionMark}"
            b.tvRekapT.text = "T: ${r.T}"
            b.tvRekapS.text = "S: ${r.S}"
            b.tvRekapI.text = "I: ${r.I}"
            b.tvRekapA.text = "A: ${r.A}"

            b.btnRekapItemDetail.setOnClickListener {
                openPdfUrl("student_individual", r.studentId)
            }
        }

        override fun getItemCount() = list.size
    }
}
