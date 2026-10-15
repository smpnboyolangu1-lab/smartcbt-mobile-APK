package com.school.smartcbt.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.R
import com.school.smartcbt.ScannerActivity
import com.school.smartcbt.data.model.KantinDashboardResponse
import com.school.smartcbt.data.model.KantinOrderItem
import com.school.smartcbt.data.model.KantinPaymentResponse
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityKantinMainBinding
import com.school.smartcbt.utils.SessionManager
import com.school.smartcbt.utils.TtsVoiceHelper
import org.json.JSONObject
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.text.NumberFormat
import java.util.Locale

class KantinMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityKantinMainBinding
    private lateinit var sessionManager: SessionManager

    private val scanQrLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val scannedCode = result.data?.getStringExtra(ScannerActivity.EXTRA_SCANNED_TOKEN)
                ?: result.data?.getStringExtra("SCANNED_TOKEN")
                ?: ""
            if (scannedCode.isNotBlank()) {
                showPaymentChargeDialog(scannedCode.trim())
            } else {
                Toast.makeText(this, "QR Code tidak terbaca", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityKantinMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)
        TtsVoiceHelper.init(this)

        setupHeader()
        setupListeners()
        loadKantinDashboard()
    }

    override fun onResume() {
        super.onResume()
        loadKantinDashboard()
    }

    private fun setupHeader() {
        val userName = sessionManager.getName().ifEmpty { "Petugas Stand" }
        binding.tvKantinOfficerName.text = "$userName • SMPN 1 Boyolangu"
    }

    private fun setupListeners() {
        binding.btnKantinLogout.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Keluar Sesi Kasir")
                .setMessage("Apakah Anda yakin ingin keluar dari aplikasi Kasir E-Kantin?")
                .setPositiveButton("Ya, Keluar") { _, _ ->
                    sessionManager.clearSession()
                    val intent = Intent(this, LoginActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    }
                    startActivity(intent)
                    finish()
                }
                .setNegativeButton("Batal", null)
                .show()
        }

        binding.btnKantinScanQr.setOnClickListener {
            val intent = Intent(this, ScannerActivity::class.java).apply {
                putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_KANTIN_POS)
            }
            scanQrLauncher.launch(intent)
        }

        binding.btnKantinManualInput.setOnClickListener {
            showManualInputDialog()
        }
    }

    private fun showManualInputDialog() {
        val input = EditText(this).apply {
            hint = "Masukkan NISN / Barcode / Username Siswa"
            inputType = InputType.TYPE_CLASS_TEXT
            setSingleLine(true)
            setPadding(40, 32, 40, 32)
            textSize = 15f
        }

        val container = FrameLayout(this).apply {
            setPadding(48, 20, 48, 10)
            addView(input)
        }

        AlertDialog.Builder(this)
            .setTitle("⌨️ Input Manual Siswa")
            .setMessage("Ketikkan nomor NISN, Barcode ID, atau username akun siswa:")
            .setView(container)
            .setPositiveButton("Lanjutkan") { _, _ ->
                val identifier = input.text.toString().trim()
                if (identifier.isNotBlank()) {
                    showPaymentChargeDialog(identifier)
                } else {
                    Toast.makeText(this, "Identitas siswa wajib diisi", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun showPaymentChargeDialog(scannedIdentifier: String) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 16)
        }

        // Tampilkan identifier
        val tvIdent = TextView(this).apply {
            text = "ID Siswa: $scannedIdentifier"
            textSize = 13f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, 16)
        }
        layout.addView(tvIdent)

        // Preset nominal buttons
        val presetLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, 16)
        }

        val etAmount = EditText(this).apply {
            hint = "Nominal Belanja (Rp)"
            inputType = InputType.TYPE_CLASS_NUMBER
            textSize = 18f
            setSingleLine(true)
            setPadding(32, 28, 32, 28)
            setBackgroundResource(android.R.drawable.edit_text)
        }

        val presets = listOf(5000, 10000, 15000, 20000)
        for (p in presets) {
            val btnP = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
                text = "${p / 1000}k"
                textSize = 12f
                setTextColor(Color.parseColor("#B45309"))
                setBackgroundColor(Color.parseColor("#FEF3C7"))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    setMargins(4, 0, 4, 0)
                }
                setOnClickListener {
                    etAmount.setText(p.toString())
                    etAmount.setSelection(etAmount.text.length)
                }
            }
            presetLayout.addView(btnP)
        }
        layout.addView(presetLayout)

        layout.addView(etAmount)

        val etNotes = EditText(this).apply {
            hint = "Catatan Item / Menu (cth: Nasi Soto + Teh)"
            inputType = InputType.TYPE_CLASS_TEXT
            textSize = 14f
            setSingleLine(true)
            setPadding(32, 28, 32, 28)
            setBackgroundResource(android.R.drawable.edit_text)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 16, 0, 16)
            }
        }
        layout.addView(etNotes)

        AlertDialog.Builder(this)
            .setTitle("🍱 Tagihan Kasir Kantin")
            .setView(layout)
            .setPositiveButton("💳 Bayar Sekarang") { _, _ ->
                val amountStr = etAmount.text.toString().trim()
                val amount = amountStr.toDoubleOrNull() ?: 0.0
                val notes = etNotes.text.toString().trim().ifEmpty { "Belanja E-Kantin" }

                if (amount <= 0) {
                    Toast.makeText(this, "Nominal belanja harus lebih dari Rp 0", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                processChargePayment(scannedIdentifier, amount, notes)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun processChargePayment(identifier: String, amount: Double, notes: String) {
        val loadingDialog = AlertDialog.Builder(this)
            .setMessage("Memproses transaksi kasir...")
            .setCancelable(false)
            .create()
        loadingDialog.show()

        val standName = sessionManager.getName().ifEmpty { "Stand 01 - Kantin Utama" }
        val payload = mapOf(
            "qrCode" to identifier,
            "amount" to amount,
            "itemsNote" to notes,
            "merchantName" to standName
        )

        ApiClient.getClient(this).posChargePayment(payload).enqueue(object : Callback<KantinPaymentResponse> {
            override fun onResponse(call: Call<KantinPaymentResponse>, response: Response<KantinPaymentResponse>) {
                loadingDialog.dismiss()
                val body = response.body()
                if (response.isSuccessful && body?.success == true) {
                    TtsVoiceHelper.playBeepSuccess()
                    val studentName = body.student?.name ?: "Siswa"
                    TtsVoiceHelper.speakPaymentSuccess(studentName, amount.toLong())

                    val sisaSaldoStr = formatRupiah(body.remainingBalance ?: 0.0)
                    val nominalStr = formatRupiah(amount)

                    AlertDialog.Builder(this@KantinMainActivity)
                        .setTitle("✅ Pembayaran Berhasil")
                        .setMessage(
                            "Transaksi Kasir Berhasil!\n\n" +
                            "• Siswa: $studentName (${body.student?.className ?: "-"})\n" +
                            "• Nominal: $nominalStr\n" +
                            "• Menu: $notes\n" +
                            "• Sisa Saldo Siswa: $sisaSaldoStr\n\n" +
                            "ID Transaksi: ${body.transactionId ?: "-"}"
                        )
                        .setPositiveButton("Selesai") { _, _ ->
                            loadKantinDashboard()
                        }
                        .show()
                } else {
                    TtsVoiceHelper.playBeepError()
                    val errorMsg = try {
                        val errObj = JSONObject(response.errorBody()?.string() ?: "")
                        errObj.optString("message", body?.message ?: "Pembayaran ditolak")
                    } catch (e: Exception) {
                        body?.message ?: "Gagal memproses pembayaran kasir"
                    }

                    TtsVoiceHelper.speakPaymentFailed(errorMsg)

                    AlertDialog.Builder(this@KantinMainActivity)
                        .setTitle("❌ Pembayaran Ditolak")
                        .setMessage(errorMsg)
                        .setPositiveButton("Tutup", null)
                        .show()
                }
            }

            override fun onFailure(call: Call<KantinPaymentResponse>, t: Throwable) {
                loadingDialog.dismiss()
                TtsVoiceHelper.playBeepError()
                val errMsg = "Koneksi ke server gagal: ${t.message}"
                TtsVoiceHelper.speakPaymentFailed("Gangguan koneksi server")
                Toast.makeText(this@KantinMainActivity, errMsg, Toast.LENGTH_LONG).show()
            }
        })
    }

    private fun loadKantinDashboard() {
        ApiClient.getClient(this).getKantinDashboard().enqueue(object : Callback<KantinDashboardResponse> {
            override fun onResponse(call: Call<KantinDashboardResponse>, response: Response<KantinDashboardResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    val data = response.body() ?: return
                    renderDashboard(data)
                }
            }

            override fun onFailure(call: Call<KantinDashboardResponse>, t: Throwable) {
                // Ignore silent dashboard failure
            }
        })
    }

    private fun renderDashboard(data: KantinDashboardResponse) {
        val totalRevenue = data.totalRevenueToday ?: 0.0
        val totalTxn = data.totalTransactionsToday ?: 0

        binding.tvKantinTotalRevenue.text = formatRupiah(totalRevenue)
        binding.tvKantinTotalTxn.text = "$totalTxn Transaksi"

        val orders = data.recentOrders ?: emptyList()
        renderOrdersList(orders)
    }

    private fun renderOrdersList(orders: List<KantinOrderItem>) {
        binding.layoutKantinOrdersList.removeAllViews()

        if (orders.isEmpty()) {
            binding.tvKantinEmptyOrders.visibility = View.VISIBLE
            binding.layoutKantinOrdersList.addView(binding.tvKantinEmptyOrders)
            return
        }

        binding.tvKantinEmptyOrders.visibility = View.GONE

        for (order in orders) {
            val cardView = CardView(this).apply {
                radius = dpToPx(12).toFloat()
                cardElevation = dpToPx(1).toFloat()
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 0, 0, dpToPx(10))
                }
            }

            val cardContent = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dpToPx(14), dpToPx(12), dpToPx(14), dpToPx(12))
            }

            // Row 1: Jam & Nominal
            val row1 = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val tvTime = TextView(this).apply {
                text = "⏰ ${order.time ?: "-"} • ${order.id ?: ""}"
                textSize = 11f
                setTextColor(Color.parseColor("#94A3B8"))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val tvAmount = TextView(this).apply {
                text = "+ ${formatRupiah(order.amount ?: 0.0)}"
                textSize = 14f
                setTextColor(Color.parseColor("#059669"))
                setTypeface(null, android.graphics.Typeface.BOLD)
            }

            row1.addView(tvTime)
            row1.addView(tvAmount)
            cardContent.addView(row1)

            // Row 2: Nama Siswa & Kelas
            val row2 = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dpToPx(6), 0, 0)
            }

            val tvStudent = TextView(this).apply {
                text = "👤 ${order.studentName ?: "Siswa"}"
                textSize = 13.5f
                setTextColor(Color.parseColor("#1E293B"))
                setTypeface(null, android.graphics.Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val tvClass = TextView(this).apply {
                text = order.className ?: "-"
                textSize = 11f
                setTextColor(Color.parseColor("#D97706"))
                setPadding(dpToPx(8), dpToPx(2), dpToPx(8), dpToPx(2))
                val bg = GradientDrawable().apply {
                    setColor(Color.parseColor("#FEF3C7"))
                    cornerRadius = dpToPx(6).toFloat()
                }
                background = bg
            }

            row2.addView(tvStudent)
            row2.addView(tvClass)
            cardContent.addView(row2)

            // Row 3: Menu Notes
            val tvNotes = TextView(this).apply {
                text = "🍱 ${order.notes ?: "Belanja Kantin"}"
                textSize = 12f
                setTextColor(Color.parseColor("#64748B"))
                setPadding(0, dpToPx(4), 0, 0)
            }
            cardContent.addView(tvNotes)

            cardView.addView(cardContent)
            binding.layoutKantinOrdersList.addView(cardView)
        }
    }

    private fun formatRupiah(amount: Double): String {
        return try {
            val formatter = NumberFormat.getCurrencyInstance(Locale("id", "ID"))
            formatter.maximumFractionDigits = 0
            formatter.format(amount).replace("Rp", "Rp ")
        } catch (e: Exception) {
            "Rp " + amount.toLong().toString()
        }
    }

    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).toInt()
    }
}
