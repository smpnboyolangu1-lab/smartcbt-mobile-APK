package com.school.smartcbt.ui

import android.app.DatePickerDialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.data.model.BasicResponse
import com.school.smartcbt.data.model.ConsultationDto
import com.school.smartcbt.data.model.SendReportRequest
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityKonselingCurhatBinding
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.text.SimpleDateFormat
import java.util.*

class KonselingCurhatActivity : AppCompatActivity() {

    private lateinit var binding: ActivityKonselingCurhatBinding
    private lateinit var sessionManager: SessionManager

    private val categories = arrayOf(
        "🛡️ Perundungan / Bullying Fisik & Verbal",
        "🌐 Cyberbullying / Media Sosial",
        "📚 Kesulitan Belajar & Konsentrasi",
        "👥 Masalah Pertemanan & Tekanan Sebaya",
        "🏠 Masalah Keluarga & Lingkungan",
        "💡 Eksplorasi Minat, Bakat & Karir",
        "💬 Curhat Bebas / Kesehatan Mental"
    )

    private val sessionOptions = arrayOf(
        "Jam Istirahat 1 (Pukul 09:30 - 10:00)",
        "Jam Istirahat 2 / Dzuhur (Pukul 12:00 - 12:45)",
        "Sepulang Sekolah (Pukul 14:30 - 15:30)",
        "Jam Pelajaran Kosong (Atas Izin Guru Mapel)"
    )

    private var activeTab = 1
    private var allConsultations: List<ConsultationDto> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityKonselingCurhatBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)

        setupSpinners()
        setupListeners()
        switchTab(1)
        loadConsultations()
    }

    private fun setupSpinners() {
        val catAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, categories)
        binding.spCategoryCurhat.adapter = catAdapter

        val sessionAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, sessionOptions)
        binding.spBookingSession.adapter = sessionAdapter
    }

    private fun setupListeners() {
        binding.btnBackKonseling.setOnClickListener { finish() }
        binding.btnRefreshKonseling.setOnClickListener {
            loadConsultations()
            Toast.makeText(this, "Memperbarui data konseling...", Toast.LENGTH_SHORT).show()
        }

        binding.btnTabCurhat.setOnClickListener { switchTab(1) }
        binding.btnTabJanjiTemu.setOnClickListener { switchTab(2) }
        binding.btnTabRiwayat.setOnClickListener { switchTab(3) }

        binding.etBookingDate.setOnClickListener {
            showDatePicker()
        }

        binding.btnSubmitCurhat.setOnClickListener {
            submitCurhatReport()
        }

        binding.btnSubmitBooking.setOnClickListener {
            submitBookingAppointment()
        }
    }

    private fun switchTab(tabIndex: Int) {
        activeTab = tabIndex

        val activeColor = Color.parseColor("#4F46E5")
        val inactiveColor = Color.parseColor("#F1F5F9")
        val activeTextColor = Color.WHITE
        val inactiveTextColor = Color.parseColor("#64748B")

        binding.btnTabCurhat.backgroundTintList = ColorStateList.valueOf(if (tabIndex == 1) activeColor else inactiveColor)
        binding.btnTabCurhat.setTextColor(if (tabIndex == 1) activeTextColor else inactiveTextColor)

        binding.btnTabJanjiTemu.backgroundTintList = ColorStateList.valueOf(if (tabIndex == 2) activeColor else inactiveColor)
        binding.btnTabJanjiTemu.setTextColor(if (tabIndex == 2) activeTextColor else inactiveTextColor)

        binding.btnTabRiwayat.backgroundTintList = ColorStateList.valueOf(if (tabIndex == 3) activeColor else inactiveColor)
        binding.btnTabRiwayat.setTextColor(if (tabIndex == 3) activeTextColor else inactiveTextColor)

        binding.sectionCurhat.visibility = if (tabIndex == 1) View.VISIBLE else View.GONE
        binding.sectionJanjiTemu.visibility = if (tabIndex == 2) View.VISIBLE else View.GONE
        binding.sectionRiwayat.visibility = if (tabIndex == 3) View.VISIBLE else View.GONE
    }

    private fun showDatePicker() {
        val calendar = Calendar.getInstance()
        val dpd = DatePickerDialog(
            this,
            { _, year, month, dayOfMonth ->
                val selectedCal = Calendar.getInstance().apply {
                    set(year, month, dayOfMonth)
                }
                val format = SimpleDateFormat("dd-MM-yyyy", Locale.getDefault())
                binding.etBookingDate.setText(format.format(selectedCal.time))
            },
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH)
        )
        // Batasi hanya hari ke depan
        dpd.datePicker.minDate = System.currentTimeMillis()
        dpd.show()
    }

    private fun submitCurhatReport() {
        val subject = binding.etSubjectCurhat.text.toString().trim()
        val message = binding.etMessageCurhat.text.toString().trim()
        val isAnon = binding.cbIsAnonymous.isChecked
        val categoryRaw = binding.spCategoryCurhat.selectedItem?.toString() ?: categories[0]

        val backendCategory = when {
            categoryRaw.contains("Bullying", ignoreCase = true) -> "BULLYING"
            categoryRaw.contains("Cyber", ignoreCase = true) -> "CYBERBULLYING"
            categoryRaw.contains("Belajar", ignoreCase = true) -> "BELAJAR"
            categoryRaw.contains("Teman", ignoreCase = true) -> "PERTEMANAN"
            categoryRaw.contains("Keluarga", ignoreCase = true) -> "KELUARGA"
            categoryRaw.contains("Karir", ignoreCase = true) -> "KARIR"
            else -> "PRIBADI"
        }

        if (subject.isEmpty()) {
            binding.etSubjectCurhat.error = "Subjek / judul pesan wajib diisi"
            binding.etSubjectCurhat.requestFocus()
            return
        }

        if (message.isEmpty()) {
            binding.etMessageCurhat.error = "Isi pesan curhat wajib diisi"
            binding.etMessageCurhat.requestFocus()
            return
        }

        AlertDialog.Builder(this)
            .setTitle(if (isAnon) "Kirim Laporan Anonim?" else "Kirim Curhat ke Guru BK?")
            .setMessage("Pesan akan diteruskan ke tim Guru Bimbingan Konseling SMP Negeri 1 Boyolangu secara rahasia dan aman.")
            .setPositiveButton("🚀 Ya, Kirim") { _, _ ->
                binding.btnSubmitCurhat.isEnabled = false
                binding.btnSubmitCurhat.text = "Mengirim Pesan..."

                val request = SendReportRequest(
                    category = backendCategory,
                    subject = if (isAnon) "[ANONIM] $subject" else subject,
                    message = message,
                    isAnonymous = isAnon
                )

                ApiClient.getClient(this).sendStudentReport(request).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        binding.btnSubmitCurhat.isEnabled = true
                        binding.btnSubmitCurhat.text = "🚀 Kirim ke Guru BK Sekarang"

                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(this@KonselingCurhatActivity, "🕊️ Pesan curhat berhasil dikirim ke Guru BK!", Toast.LENGTH_LONG).show()
                            binding.etSubjectCurhat.text?.clear()
                            binding.etMessageCurhat.text?.clear()
                            binding.cbIsAnonymous.isChecked = false
                            loadConsultations()
                            switchTab(3)
                        } else {
                            val msg = response.body()?.message ?: "Gagal mengirim pesan"
                            Toast.makeText(this@KonselingCurhatActivity, "⚠️ $msg", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        binding.btnSubmitCurhat.isEnabled = true
                        binding.btnSubmitCurhat.text = "🚀 Kirim ke Guru BK Sekarang"
                        Toast.makeText(this@KonselingCurhatActivity, "Koneksi terputus. Silakan periksa jaringan internet.", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Periksa Lagi", null)
            .show()
    }

    private fun submitBookingAppointment() {
        val date = binding.etBookingDate.text.toString().trim()
        val session = binding.spBookingSession.selectedItem?.toString() ?: sessionOptions[0]
        val topic = binding.etBookingTopic.text.toString().trim()

        if (date.isEmpty()) {
            Toast.makeText(this, "Silakan pilih tanggal pertemuan terlebih dahulu", Toast.LENGTH_SHORT).show()
            binding.etBookingDate.requestFocus()
            return
        }

        if (topic.isEmpty()) {
            binding.etBookingTopic.error = "Tuliskan topik yang ingin dibahas"
            binding.etBookingTopic.requestFocus()
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Ajukan Janji Temu BK?")
            .setMessage("Rencana janji temu tatap muka pada:\n📅 Tanggal: $date\n⏰ Sesi: $session\n\nGuru BK akan mengonfirmasi kesediaan jadwal di Ruang BK.")
            .setPositiveButton("🤝 Ajukan Sekarang") { _, _ ->
                binding.btnSubmitBooking.isEnabled = false
                binding.btnSubmitBooking.text = "Mengajukan Jadwal..."

                val fullMessage = "Permohonan Janji Temu Tatap Muka di Ruang BK SMPN 1 Boyolangu:\n- Tanggal: $date\n- Sesi: $session\n- Catatan Topik: $topic"
                val request = SendReportRequest(
                    category = "JANJI_TEMU",
                    subject = "[JANJI TEMU] Pertemuan BK ($date)",
                    message = fullMessage,
                    isAnonymous = false
                )

                ApiClient.getClient(this).sendStudentReport(request).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        binding.btnSubmitBooking.isEnabled = true
                        binding.btnSubmitBooking.text = "🤝 Ajukan Janji Temu BK"

                        if (response.isSuccessful && response.body()?.success == true) {
                            Toast.makeText(this@KonselingCurhatActivity, "✅ Permohonan janji temu berhasil diajukan ke Guru BK!", Toast.LENGTH_LONG).show()
                            binding.etBookingDate.text?.clear()
                            binding.etBookingTopic.text?.clear()
                            loadConsultations()
                            switchTab(3)
                        } else {
                            val msg = response.body()?.message ?: "Gagal mengajukan jadwal"
                            Toast.makeText(this@KonselingCurhatActivity, "⚠️ $msg", Toast.LENGTH_SHORT).show()
                        }
                    }

                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        binding.btnSubmitBooking.isEnabled = true
                        binding.btnSubmitBooking.text = "🤝 Ajukan Janji Temu BK"
                        Toast.makeText(this@KonselingCurhatActivity, "Koneksi terputus. Silakan periksa jaringan internet.", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadConsultations() {
        ApiClient.getClient(this).getStudentConsultations().enqueue(object : Callback<List<ConsultationDto>> {
            override fun onResponse(call: Call<List<ConsultationDto>>, response: Response<List<ConsultationDto>>) {
                if (response.isSuccessful && response.body() != null) {
                    allConsultations = response.body()!!
                    renderConsultationList(allConsultations)
                }
            }

            override fun onFailure(call: Call<List<ConsultationDto>>, t: Throwable) {
                // Ignore error if offline
            }
        })
    }

    private fun renderConsultationList(items: List<ConsultationDto>) {
        binding.tvCountRiwayat.text = "${items.size} Catatan"
        binding.containerRiwayatList.removeAllViews()

        if (items.isEmpty()) {
            binding.layoutEmptyRiwayat.visibility = View.VISIBLE
            return
        }

        binding.layoutEmptyRiwayat.visibility = View.GONE
        val density = resources.displayMetrics.density

        items.forEach { item ->
            val card = CardView(this).apply {
                radius = 14 * density
                cardElevation = 2 * density
                setCardBackgroundColor(Color.WHITE)
                val params = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (12 * density).toInt()
                }
                layoutParams = params
            }

            val cardContent = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding((14 * density).toInt(), (14 * density).toInt(), (14 * density).toInt(), (14 * density).toInt())
            }

            // Top Row: Category & Status Badge
            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val tvCategory = TextView(this).apply {
                text = when (item.category) {
                    "BULLYING", "CYBERBULLYING" -> "🛡️ ANTI-BULLYING"
                    "JANJI_TEMU" -> "🤝 JANJI TEMU"
                    "BELAJAR" -> "📚 BELAJAR"
                    else -> "💬 CURHAT BK"
                }
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#4338CA"))
                setBackgroundColor(Color.parseColor("#EEF2FF"))
                setPadding((8 * density).toInt(), (3 * density).toInt(), (8 * density).toInt(), (3 * density).toInt())
            }
            topRow.addView(tvCategory)

            val space = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
            }
            topRow.addView(space)

            val isAnswered = !item.replyMessage.isNullOrEmpty()
            val tvStatus = TextView(this).apply {
                text = if (isAnswered) "✅ Telah Ditanggapi" else "⏳ Menunggu Guru BK"
                textSize = 10.5f
                setTypeface(null, Typeface.BOLD)
                setTextColor(if (isAnswered) Color.parseColor("#065F46") else Color.parseColor("#92400E"))
                setBackgroundColor(if (isAnswered) Color.parseColor("#D1FAE5") else Color.parseColor("#FEF3C7"))
                setPadding((8 * density).toInt(), (3 * density).toInt(), (8 * density).toInt(), (3 * density).toInt())
            }
            topRow.addView(tvStatus)
            cardContent.addView(topRow)

            // Subject
            val tvSub = TextView(this).apply {
                text = item.subject
                textSize = 14f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
                setPadding(0, (8 * density).toInt(), 0, (4 * density).toInt())
            }
            cardContent.addView(tvSub)

            // Created Date
            val tvDate = TextView(this).apply {
                text = "📅 ${item.createdAt.take(10)}"
                textSize = 10.5f
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, 0, 0, (6 * density).toInt())
            }
            cardContent.addView(tvDate)

            // Student Message
            val tvMsg = TextView(this).apply {
                text = item.message
                textSize = 12.5f
                setTextColor(Color.parseColor("#334155"))
            }
            cardContent.addView(tvMsg)

            // Counselor Reply Box
            if (isAnswered) {
                val replyBox = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.parseColor("#F0FDF4"))
                    setPadding((12 * density).toInt(), (10 * density).toInt(), (12 * density).toInt(), (10 * density).toInt())
                    val lp = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        topMargin = (10 * density).toInt()
                    }
                    layoutParams = lp
                }

                val tvReplyHeader = TextView(this).apply {
                    text = "👨‍🏫 Tanggapan Resmi Guru BK SMPN 1 Boyolangu:"
                    textSize = 11.5f
                    setTypeface(null, Typeface.BOLD)
                    setTextColor(Color.parseColor("#166534"))
                }
                replyBox.addView(tvReplyHeader)

                val tvReplyMsg = TextView(this).apply {
                    text = item.replyMessage
                    textSize = 12f
                    setTextColor(Color.parseColor("#14532D"))
                    setPadding(0, (4 * density).toInt(), 0, 0)
                }
                replyBox.addView(tvReplyMsg)

                if (!item.replyDate.isNullOrEmpty()) {
                    val tvReplyDate = TextView(this).apply {
                        text = "Ditanggapi pada: ${item.replyDate.take(10)}"
                        textSize = 9.5f
                        setTextColor(Color.parseColor("#15803D"))
                        setPadding(0, (4 * density).toInt(), 0, 0)
                    }
                    replyBox.addView(tvReplyDate)
                }

                cardContent.addView(replyBox)
            }

            card.addView(cardContent)
            binding.containerRiwayatList.addView(card)
        }
    }
}
