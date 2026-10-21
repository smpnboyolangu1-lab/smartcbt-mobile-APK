package com.school.smartcbt.ui

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.school.smartcbt.R
import com.school.smartcbt.ScannerActivity
import com.school.smartcbt.utils.SessionManager
import com.school.smartcbt.data.model.BasicResponse
import com.school.smartcbt.data.model.GatepassItemData
import com.school.smartcbt.data.model.SatpamCheckoutRequest
import com.school.smartcbt.data.model.SatpamCheckoutResponse
import com.school.smartcbt.data.model.SatpamGatepassListResponse
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivitySatpamMainBinding
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.text.SimpleDateFormat
import java.util.*

class SatpamMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySatpamMainBinding
    private lateinit var sessionManager: SessionManager

    private val clockHandler = Handler(Looper.getMainLooper())
    private var allGatepasses: List<GatepassItemData> = emptyList()
    private var activeFilter: String = "ALL" // "ALL", "WAITING", "OUTSIDE"

    private val clockRunnable = object : Runnable {
        override fun run() {
            val sdf = SimpleDateFormat("EEEE, dd MMM yyyy • HH:mm:ss 'WIB'", Locale("id", "ID"))
            binding.tvSatpamLiveClock.text = "⏰ ${sdf.format(Date())}"
            clockHandler.postDelayed(this, 1000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySatpamMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        com.school.smartcbt.utils.DialogHelper.applyDynamicFooter(this)

        sessionManager = SessionManager(this)

        val officerName = sessionManager.getName().ifEmpty { "Petugas Satpam" }
        binding.tvSatpamOfficerName.text = "👮 $officerName • Pos Keamanan SMPN 1 Boyolangu"

        // Tampilkan tombol Pindah Role jika user memiliki multi-role (misal Guru Piket / Operator)
        val availRoles = sessionManager.getAvailableRoles()
        val mainRole = sessionManager.getRole().uppercase()
        if (availRoles.size > 1 || mainRole == "TEACHER" || mainRole == "GURU" || mainRole == "ADMIN" || mainRole == "OPERATOR") {
            binding.tvSatpamSwitchRole.visibility = View.VISIBLE
            binding.tvSatpamSwitchRole.setOnClickListener {
                showSwitchRoleDialog()
            }
        }

        binding.btnSatpamRefresh.setOnClickListener {
            loadSatpamDashboard(showToast = true)
        }

        binding.btnSatpamLogout.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Konfirmasi Keluar")
                .setMessage("Apakah Anda yakin ingin keluar dari sesi Pos Keamanan & Gatepass?")
                .setPositiveButton("Ya, Keluar") { _, _ ->
                    sessionManager.clearSession()
                    val intent = Intent(this, LoginActivity::class.java)
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    startActivity(intent)
                    finish()
                }
                .setNegativeButton("Batal", null)
                .show()
        }

        binding.btnScanCheckoutGatepass.setOnClickListener {
            val intent = Intent(this, ScannerActivity::class.java).apply {
                putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_SATPAM_GATEPASS)
                putExtra(ScannerActivity.EXTRA_SATPAM_ACTION, "CHECKOUT")
            }
            startActivity(intent)
        }

        binding.btnScanReturnGatepass.setOnClickListener {
            val intent = Intent(this, ScannerActivity::class.java).apply {
                putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_SATPAM_GATEPASS)
                putExtra(ScannerActivity.EXTRA_SATPAM_ACTION, "RETURN")
            }
            startActivity(intent)
        }

        binding.btnManualTokenGatepass.setOnClickListener {
            showManualTokenDialog()
        }

        binding.btnSatpamUpdateApp.setOnClickListener {
            com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this, showToastIfLatest = true)
        }

        binding.btnFilterAll.setOnClickListener {
            setFilter("ALL")
        }
        binding.btnFilterWaiting.setOnClickListener {
            setFilter("WAITING")
        }
        binding.btnFilterOutside.setOnClickListener {
            setFilter("OUTSIDE")
        }

        clockHandler.post(clockRunnable)
        loadSatpamDashboard(showToast = false)
    }

    override fun onResume() {
        super.onResume()
        com.school.smartcbt.utils.AppUpdateChecker.resumePendingInstallIfAny(this)
        com.school.smartcbt.utils.AppUpdateChecker.checkForUpdates(this)
        loadSatpamDashboard(showToast = false)
    }

    override fun onDestroy() {
        super.onDestroy()
        clockHandler.removeCallbacks(clockRunnable)
    }

    private fun setFilter(filter: String) {
        activeFilter = filter
        val activeBg = ColorStateList.valueOf(Color.parseColor("#2563EB"))
        val inactiveBg = ColorStateList.valueOf(Color.parseColor("#334155"))

        binding.btnFilterAll.backgroundTintList = if (filter == "ALL") activeBg else inactiveBg
        binding.btnFilterAll.setTextColor(if (filter == "ALL") Color.WHITE else Color.parseColor("#CBD5E1"))

        binding.btnFilterWaiting.backgroundTintList = if (filter == "WAITING") activeBg else inactiveBg
        binding.btnFilterWaiting.setTextColor(if (filter == "WAITING") Color.WHITE else Color.parseColor("#CBD5E1"))

        binding.btnFilterOutside.backgroundTintList = if (filter == "OUTSIDE") activeBg else inactiveBg
        binding.btnFilterOutside.setTextColor(if (filter == "OUTSIDE") Color.WHITE else Color.parseColor("#CBD5E1"))

        renderGatepassList()
    }

    private fun loadSatpamDashboard(showToast: Boolean) {
        ApiClient.getClient(this).getSatpamGatepasses().enqueue(object : Callback<SatpamGatepassListResponse> {
            override fun onResponse(
                call: Call<SatpamGatepassListResponse>,
                response: Response<SatpamGatepassListResponse>
            ) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val body = response.body()!!
                    allGatepasses = body.data ?: emptyList()

                    val stats = body.stats
                    val waitingCount = stats?.waitingExit ?: allGatepasses.count { it.status == "APPROVED_BK" || it.status == "ACTIVE_APPROVED" }
                    val outsideCount = stats?.currentlyOutside ?: allGatepasses.count { it.status == "OUTSIDE" || it.status == "COMPLETED" }
                    val returnedCount = stats?.returnedToSchool ?: allGatepasses.count { it.status == "RETURNED" || it.status == "CLOSED" }
                    val totalCount = stats?.totalToday ?: allGatepasses.size

                    binding.tvStatWaitingExit.text = waitingCount.toString()
                    binding.tvStatOutside.text = outsideCount.toString()
                    binding.tvStatReturned.text = returnedCount.toString()
                    binding.tvStatTotalToday.text = totalCount.toString()

                    renderGatepassList()
                    if (showToast) {
                        Toast.makeText(this@SatpamMainActivity, "✅ Data Pos Keamanan diperbarui", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    if (showToast) {
                        Toast.makeText(this@SatpamMainActivity, "Gagal memuat data gatepass", Toast.LENGTH_SHORT).show()
                    }
                }
            }

            override fun onFailure(call: Call<SatpamGatepassListResponse>, t: Throwable) {
                if (showToast) {
                    Toast.makeText(this@SatpamMainActivity, "Koneksi ke server gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun renderGatepassList() {
        val container = binding.llSatpamGatepassContainer
        container.removeAllViews()

        val filtered = when (activeFilter) {
            "WAITING" -> allGatepasses.filter { it.status == "APPROVED_BK" || it.status == "ACTIVE_APPROVED" }
            "OUTSIDE" -> allGatepasses.filter { it.status == "OUTSIDE" || it.status == "COMPLETED" }
            else -> allGatepasses
        }

        binding.tvSatpamListSubtitle.text = when (activeFilter) {
            "WAITING" -> "🟡 Siap Keluar Gerbang (${filtered.size} Siswa)"
            "OUTSIDE" -> "🔴 Sedang Di Luar Sekolah (${filtered.size} Siswa)"
            else -> "📋 Daftar Gatepass Siswa Hari Ini (${filtered.size} Total)"
        }

        if (filtered.isEmpty()) {
            val emptyCard = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(20), dp(32), dp(20), dp(32))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#1E293B"))
                    cornerRadius = dp(14).toFloat()
                    setStroke(dp(1), Color.parseColor("#334155"))
                }
            }
            val tvEmptyIcon = TextView(this).apply {
                text = "🛡️"
                textSize = 32f
                gravity = Gravity.CENTER
            }
            val tvEmptyTitle = TextView(this).apply {
                text = "Belum Ada Data Gatepass pada Kategori Ini"
                setTextColor(Color.parseColor("#E2E8F0"))
                textSize = 14f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, dp(4))
            }
            val tvEmptySub = TextView(this).apply {
                text = "Gunakan tombol Scan QR Keluar Gerbang atau Scan Kembali di atas saat siswa menunjukkan surat izin digital."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
                gravity = Gravity.CENTER
            }
            emptyCard.addView(tvEmptyIcon)
            emptyCard.addView(tvEmptyTitle)
            emptyCard.addView(tvEmptySub)
            container.addView(emptyCard)
            return
        }

        filtered.forEach { item ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(14), dp(14), dp(14))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#1E293B"))
                    cornerRadius = dp(14).toFloat()
                    val strokeColor = when (item.status) {
                        "APPROVED_BK", "ACTIVE_APPROVED" -> "#F59E0B"
                        "OUTSIDE", "COMPLETED" -> "#EF4444"
                        "RETURNED" -> "#38BDF8"
                        else -> "#334155"
                    }
                    setStroke(dp(1), Color.parseColor(strokeColor))
                }
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = dp(10)
                }
            }

            // Header Row: Student Name + Status Badge
            val headerRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val nameCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }

            val sName = item.student?.name ?: "Siswa #${item.studentId}"
            val sClass = item.student?.className ?: "-"
            val sNisn = item.student?.nisn ?: "-"

            val tvName = TextView(this).apply {
                text = sName
                setTextColor(Color.WHITE)
                textSize = 14.5f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            val tvMeta = TextView(this).apply {
                text = "Kelas $sClass • NISN: $sNisn"
                setTextColor(Color.parseColor("#38BDF8"))
                textSize = 11.5f
            }
            nameCol.addView(tvName)
            nameCol.addView(tvMeta)

            val (statusLabel, badgeBg, badgeFg) = when (item.status) {
                "APPROVED_BK", "ACTIVE_APPROVED" -> Triple("SIAP KELUAR", "#451A03", "#FBBF24")
                "OUTSIDE", "COMPLETED" -> Triple("DI LUAR SEKOLAH", "#450A0A", "#F87171")
                "RETURNED" -> Triple("SUDAH KEMBALI", "#082F49", "#38BDF8")
                "CLOSED" -> Triple("PULANG / SELESAI", "#064E3B", "#34D399")
                "REJECTED" -> Triple("DITOLAK", "#334155", "#94A3B8")
                else -> Triple("MENUNGGU BK", "#1E1B4B", "#A5B4FC")
            }

            val tvBadge = TextView(this).apply {
                text = statusLabel
                setTextColor(Color.parseColor(badgeFg))
                textSize = 10f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(dp(8), dp(4), dp(8), dp(4))
                background = GradientDrawable().apply {
                    setColor(Color.parseColor(badgeBg))
                    cornerRadius = dp(6).toFloat()
                }
            }

            headerRow.addView(nameCol)
            headerRow.addView(tvBadge)
            card.addView(headerRow)

            // Reason & Token info
            val typeReadable = item.categoryLabel ?: when ((item.leaveCategory ?: "").uppercase()) {
                "SICK", "SICK_GO_HOME", "SAKIT", "SAKIT_PULANG" -> "🏥 Pulang karena Sakit (UKS/BK)"
                "DISPENSATION", "DISPENSASI", "DISPENSASI_LOMBA" -> "🎖️ Dispensasi Organisasi / Lomba"
                "URGENT_FAMILY", "PERMIT_TEMPORARY", "EARLY_LEAVE", "IZIN_PULANG_MENDESAK" -> "🏠 Izin Pulang Kepentingan Mendesak"
                else -> "📋 ${item.leaveCategory ?: "Dispensasi Siswa"}"
            }

            val tvReason = TextView(this).apply {
                text = "$typeReadable\nAlasan: ${item.reason}"
                setTextColor(Color.parseColor("#E2E8F0"))
                textSize = 12f
                setPadding(0, dp(8), 0, dp(6))
            }
            card.addView(tvReason)

            val outTimeStr = formatShortTime(item.exitTimestamp)
            val returnTimeStr = formatShortTime(item.returnTimestamp ?: item.validUntil)
            val tvTimestamps = TextView(this).apply {
                text = "🔑 Token: ${item.singleUseCheckoutToken ?: "-"}   •   🚪 Keluar: $outTimeStr   •   🏫 Kembali: $returnTimeStr"
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 11f
            }
            card.addView(tvTimestamps)

            // Quick Action Buttons for Satpam
            if ((item.status == "APPROVED_BK" || item.status == "ACTIVE_APPROVED") && !item.singleUseCheckoutToken.isNullOrEmpty()) {
                val btnAction = Button(this).apply {
                    text = "🚪 Verifikasi & Izinkan Keluar Gerbang"
                    setTextColor(Color.WHITE)
                    textSize = 11.5f
                    backgroundTintList = ColorStateList.valueOf(Color.parseColor("#DC2626"))
                    layoutParams = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        dp(42)
                    ).apply { topMargin = dp(8) }
                    setOnClickListener {
                        confirmGatepassAction(item.singleUseCheckoutToken!!, "CHECKOUT", sName)
                    }
                }
                card.addView(btnAction)
            } else if ((item.status == "OUTSIDE" || item.status == "COMPLETED") && !item.singleUseCheckoutToken.isNullOrEmpty()) {
                val btnAction = Button(this).apply {
                    text = "🏫 Konfirmasi Siswa Kembali ke Sekolah"
                    setTextColor(Color.WHITE)
                    textSize = 11.5f
                    backgroundTintList = ColorStateList.valueOf(Color.parseColor("#0284C7"))
                    layoutParams = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        dp(42)
                    ).apply { topMargin = dp(8) }
                    setOnClickListener {
                        confirmGatepassAction(item.singleUseCheckoutToken!!, "RETURN", sName)
                    }
                }
                card.addView(btnAction)
            }

            card.isClickable = true
            card.isFocusable = true
            card.setOnClickListener {
                showStudentGatepassDetailDialog(item)
            }

            container.addView(card)
        }
    }

    private fun showStudentGatepassDetailDialog(item: GatepassItemData) {
        val sName = item.student?.name ?: "Siswa #${item.studentId}"
        val sClass = item.student?.className ?: "-"
        val sNisn = item.student?.nisn ?: "-"
        val typeReadable = item.categoryLabel ?: when ((item.leaveCategory ?: "").uppercase()) {
            "SICK", "SICK_GO_HOME", "SAKIT", "SAKIT_PULANG" -> "🏥 Pulang karena Sakit (UKS/BK)"
            "DISPENSATION", "DISPENSASI", "DISPENSASI_LOMBA" -> "🎖️ Dispensasi Organisasi / Lomba"
            "URGENT_FAMILY", "PERMIT_TEMPORARY", "EARLY_LEAVE", "IZIN_PULANG_MENDESAK" -> "🏠 Izin Pulang Kepentingan Mendesak"
            else -> "📋 ${item.leaveCategory ?: "Dispensasi Siswa"}"
        }

        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
        }

        val avatarTv = TextView(this).apply {
            text = if (sName.isNotEmpty()) sName.take(1).uppercase() else "S"
            textSize = 20f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            val sz = dp(48)
            layoutParams = LinearLayout.LayoutParams(sz, sz).apply { marginEnd = dp(14) }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#0284C7"))
            }
        }
        topRow.addView(avatarTv)

        val headerCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        headerCol.addView(TextView(this).apply {
            text = sName
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        })
        headerCol.addView(TextView(this).apply {
            text = "Kelas $sClass • NISN: $sNisn"
            textSize = 12f
            setTextColor(Color.parseColor("#38BDF8"))
        })
        topRow.addView(headerCol)
        dialogView.addView(topRow)

        val detailCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1E293B"))
                cornerRadius = dp(12).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            }
        }

        fun addRow(label: String, value: String, valColor: String = "#F8FAFC") {
            val r = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, dp(4), 0, dp(4))
            }
            r.addView(TextView(this).apply {
                text = label
                textSize = 10.5f
                setTextColor(Color.parseColor("#94A3B8"))
                setTypeface(null, Typeface.BOLD)
            })
            r.addView(TextView(this).apply {
                text = value
                textSize = 12.5f
                setTextColor(Color.parseColor(valColor))
                setTypeface(null, Typeface.BOLD)
            })
            detailCard.addView(r)
        }

        addRow("KATEGORI IZIN / DISPENSASI", typeReadable, "#F59E0B")
        addRow("ALASAN KELUAR SEKOLAH", item.reason ?: "-", "#E2E8F0")
        addRow("STATUS GATEPASS", when (item.status) {
            "APPROVED_BK", "ACTIVE_APPROVED" -> "🟢 DISETUJUI BK (SIAP KELUAR GERBANG)"
            "OUTSIDE", "COMPLETED" -> "🔴 SEDANG DI LUAR LINGKUNGAN SEKOLAH"
            "RETURNED" -> "🔵 SUDAH KEMBALI KE SEKOLAH"
            else -> item.status ?: "-"
        }, "#38BDF8")
        addRow("PENJEMPUT", item.pickupBy ?: "Mandiri (Tanpa Penjemput)", "#FDE047")
        addRow("WAKTU VERIFIKASI", "Keluar: ${formatShortTime(item.exitTimestamp)} • Kembali: ${formatShortTime(item.returnTimestamp ?: item.validUntil)}", "#CBD5E1")
        addRow("KODE TOKEN DINAMIS", item.singleUseCheckoutToken ?: "-", "#A5B4FC")

        dialogView.addView(detailCard)

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .setPositiveButton("Tutup", null)
            .create()

        if ((item.status == "APPROVED_BK" || item.status == "ACTIVE_APPROVED") && !item.singleUseCheckoutToken.isNullOrEmpty()) {
            dialog.setButton(AlertDialog.BUTTON_NEUTRAL, "🚪 Izinkan Keluar") { _, _ ->
                confirmGatepassAction(item.singleUseCheckoutToken!!, "CHECKOUT", sName)
            }
        } else if ((item.status == "OUTSIDE" || item.status == "COMPLETED") && !item.singleUseCheckoutToken.isNullOrEmpty()) {
            dialog.setButton(AlertDialog.BUTTON_NEUTRAL, "🏫 Konfirmasi Kembali") { _, _ ->
                confirmGatepassAction(item.singleUseCheckoutToken!!, "RETURN", sName)
            }
        }
        dialog.show()
    }

    private fun confirmGatepassAction(qrToken: String, action: String, studentName: String) {
        val actionTitle = if (action == "RETURN") "Konfirmasi Kembali ke Sekolah" else "Konfirmasi Keluar Gerbang"
        val actionDesc = if (action == "RETURN") {
            "Catat bahwa siswa $studentName telah kembali masuk ke lingkungan sekolah?"
        } else {
            "Izinkan siswa $studentName melewati gerbang sekolah sekarang? Notifikasi otomatis akan dikirim ke Orang Tua & Wali Kelas."
        }

        AlertDialog.Builder(this)
            .setTitle("🛡️ $actionTitle")
            .setMessage(actionDesc)
            .setPositiveButton("Ya, Proses") { _, _ ->
                executeSatpamVerification(qrToken, action)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showManualTokenDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(14), dp(20), dp(8))
        }

        val etToken = EditText(this).apply {
            hint = "Masukkan Kode Token Gatepass (misal: GP-...)"
            setSingleLine(true)
        }
        container.addView(etToken)

        val rgAction = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
            setPadding(0, dp(10), 0, 0)
        }
        val rbCheckout = RadioButton(this).apply {
            id = View.generateViewId()
            text = "🚪 Checkout (Siswa Keluar Gerbang)"
            isChecked = true
        }
        val rbReturn = RadioButton(this).apply {
            id = View.generateViewId()
            text = "🏫 Return (Siswa Kembali ke Sekolah)"
        }
        rgAction.addView(rbCheckout)
        rgAction.addView(rbReturn)
        container.addView(rgAction)

        AlertDialog.Builder(this)
            .setTitle("⌨️ Verifikasi Token Gatepass Manual")
            .setView(container)
            .setPositiveButton("Verifikasi") { _, _ ->
                val token = etToken.text.toString().trim()
                if (token.isEmpty()) {
                    Toast.makeText(this, "Token tidak boleh kosong", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val action = if (rbReturn.isChecked) "RETURN" else "CHECKOUT"
                executeSatpamVerification(token, action)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun executeSatpamVerification(qrToken: String, action: String) {
        ApiClient.getClient(this).verifyGatepassBySatpam(
            SatpamCheckoutRequest(checkoutToken = qrToken, action = action)
        ).enqueue(object : Callback<SatpamCheckoutResponse> {
            override fun onResponse(
                call: Call<SatpamCheckoutResponse>,
                response: Response<SatpamCheckoutResponse>
            ) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val msg = response.body()?.message ?: "Gatepass berhasil diverifikasi!"
                    AlertDialog.Builder(this@SatpamMainActivity)
                        .setTitle("✅ Verifikasi Berhasil")
                        .setMessage(msg)
                        .setPositiveButton("OK", null)
                        .show()
                    loadSatpamDashboard(showToast = false)
                } else {
                    val err = try {
                        org.json.JSONObject(response.errorBody()?.string() ?: "").optString("message", "Gagal memverifikasi token")
                    } catch (e: Exception) {
                        "Gagal memverifikasi token (${response.code()})"
                    }
                    AlertDialog.Builder(this@SatpamMainActivity)
                        .setTitle("⚠️ Verifikasi Ditolak")
                        .setMessage(err)
                        .setPositiveButton("Tutup", null)
                        .show()
                }
            }

            override fun onFailure(call: Call<SatpamCheckoutResponse>, t: Throwable) {
                Toast.makeText(this@SatpamMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun showSwitchRoleDialog() {
        val options = mutableListOf<Pair<String, () -> Unit>>()
        options.add("🛡️ Pos Keamanan & Scanner Gatepass (Saat Ini)" to {})
        options.add("📷 Scanner Presensi Gerbang Sekolah (Hadir/Pulang)" to {
            val intent = Intent(this, ScannerActivity::class.java).apply {
                putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_ATTENDANCE)
            }
            startActivity(intent)
        })
        options.add("🚨 Buka/Tutup Gerbang Darurat (Mode Uji Coba / Pulang Cepat)" to {
            toggleEmergencyGate()
        })

        val role = sessionManager.getRole().uppercase()
        val avail = sessionManager.getAvailableRoles()
        if (role == "TEACHER" || role == "GURU" || avail.contains("TEACHER") || avail.contains("WALI_KELAS")) {
            options.add("👨‍🏫 Dashboard Guru & Piket" to {
                startActivity(Intent(this, TeacherMainActivity::class.java))
                finish()
            })
        }
        if (role == "OPERATOR" || role == "ADMIN" || avail.contains("OPERATOR")) {
            options.add("⚙️ Dashboard Operator Sekolah" to {
                startActivity(Intent(this, OperatorMainActivity::class.java))
                finish()
            })
        }

        val labels = options.map { it.first }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("🔄 Pilih Mode Petugas")
            .setItems(labels) { _, which ->
                options[which].second.invoke()
            }
            .setNegativeButton("Tutup", null)
            .show()
    }

    private fun toggleEmergencyGate() {
        AlertDialog.Builder(this)
            .setTitle("🚨 Kontrol Gerbang Darurat / Uji Coba")
            .setMessage("Pilih mode kontrol gerbang absensi:")
            .setPositiveButton("Mode Uji Coba 24 Jam") { _, _ ->
                val progress = android.app.ProgressDialog(this).apply {
                    setMessage("Memproses pengaturan gerbang...")
                    show()
                }
                ApiClient.getClient(this).toggleTrialGate(emptyMap()).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            val msg = response.body()?.message ?: "Status gerbang berhasil diperbarui"
                            Toast.makeText(this@SatpamMainActivity, "✅ $msg", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(this@SatpamMainActivity, "Gagal mengubah mode gerbang (${response.code()})", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@SatpamMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNeutralButton("Gerbang Pulang Darurat") { _, _ ->
                val progress = android.app.ProgressDialog(this).apply {
                    setMessage("Mengaktifkan pemulangan darurat...")
                    show()
                }
                ApiClient.getClient(this).toggleEmergencyGateOut(mapOf("reason" to "Pemulangan Darurat oleh Petugas Satpam")).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        progress.dismiss()
                        if (response.isSuccessful) {
                            val msg = response.body()?.message ?: "Gerbang darurat berhasil diaktifkan"
                            Toast.makeText(this@SatpamMainActivity, "✅ $msg", Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(this@SatpamMainActivity, "Gagal mengubah status gerbang", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        progress.dismiss()
                        Toast.makeText(this@SatpamMainActivity, "Koneksi gagal: ${t.message}", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun formatShortTime(isoStr: String?): String {
        if (isoStr.isNullOrEmpty()) return "-"
        return try {
            if (isoStr.contains("T") && isoStr.length >= 16) {
                isoStr.substringAfter("T").substring(0, 5) + " WIB"
            } else {
                isoStr
            }
        } catch (e: Exception) {
            isoStr
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
