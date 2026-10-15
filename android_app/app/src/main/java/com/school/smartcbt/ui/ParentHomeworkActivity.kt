package com.school.smartcbt.ui

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.data.model.ParentHomeworkItemDto
import com.school.smartcbt.data.model.ParentHomeworkResponse
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityParentHomeworkBinding
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class ParentHomeworkActivity : AppCompatActivity() {

    private lateinit var binding: ActivityParentHomeworkBinding
    private lateinit var sessionManager: SessionManager

    companion object {
        const val EXTRA_STUDENT_ID = "extra_student_id"
        const val EXTRA_STUDENT_NAME = "extra_student_name"
        const val EXTRA_CLASS_NAME = "extra_class_name"
    }

    private var targetStudentId: String? = null
    private var childName: String = "Ananda"
    private var className: String = "VII-A"
    private var currentFilter: String = "ALL" // ALL, PENDING, DONE
    private var allHomework: List<ParentHomeworkItemDto> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityParentHomeworkBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)

        targetStudentId = intent.getStringExtra(EXTRA_STUDENT_ID)
        childName = intent.getStringExtra(EXTRA_STUDENT_NAME)?.ifEmpty { null } ?: sessionManager.getName().ifEmpty { "Ananda" }
        className = intent.getStringExtra(EXTRA_CLASS_NAME)?.ifEmpty { null } ?: sessionManager.getClassName().ifEmpty { "VII-A" }

        binding.tvParentHomeworkSubtitle.text = "Siswa: $childName • Kelas $className"

        binding.btnBackParentHomework.setOnClickListener { finish() }
        binding.btnRefreshParentHomework.setOnClickListener {
            Toast.makeText(this, "Menyegarkan daftar tugas...", Toast.LENGTH_SHORT).show()
            loadHomework()
        }

        setupTabs()
        loadHomework()
    }

    private fun setupTabs() {
        binding.btnFilterAllHw.setOnClickListener {
            currentFilter = "ALL"
            updateTabStyles()
            renderHomework()
        }
        binding.btnFilterPendingHw.setOnClickListener {
            currentFilter = "PENDING"
            updateTabStyles()
            renderHomework()
        }
        binding.btnFilterDoneHw.setOnClickListener {
            currentFilter = "DONE"
            updateTabStyles()
            renderHomework()
        }
    }

    private fun updateTabStyles() {
        val activeBg = Color.parseColor("#065F46")
        val inactiveBg = Color.parseColor("#F1F5F9")
        val activeText = Color.WHITE
        val inactiveText = Color.parseColor("#64748B")

        binding.btnFilterAllHw.backgroundTintList = ColorStateList.valueOf(if (currentFilter == "ALL") activeBg else inactiveBg)
        binding.btnFilterAllHw.setTextColor(if (currentFilter == "ALL") activeText else inactiveText)

        binding.btnFilterPendingHw.backgroundTintList = ColorStateList.valueOf(if (currentFilter == "PENDING") activeBg else inactiveBg)
        binding.btnFilterPendingHw.setTextColor(if (currentFilter == "PENDING") activeText else inactiveText)

        binding.btnFilterDoneHw.backgroundTintList = ColorStateList.valueOf(if (currentFilter == "DONE") activeBg else inactiveBg)
        binding.btnFilterDoneHw.setTextColor(if (currentFilter == "DONE") activeText else inactiveText)
    }

    private fun loadHomework() {
        val childQuery = targetStudentId ?: sessionManager.getUserId()
        ApiClient.getClient(this).getParentHomeworkList(childQuery).enqueue(object : Callback<ParentHomeworkResponse> {
            override fun onResponse(call: Call<ParentHomeworkResponse>, response: Response<ParentHomeworkResponse>) {
                val list = response.body()?.homework ?: emptyList()
                allHomework = list
                com.school.smartcbt.utils.ClientLogger.logHomework(
                    context = this@ParentHomeworkActivity,
                    action = "LIST_HOMEWORKS",
                    outcome = "SUCCESS",
                    message = "Memuat ${list.size} tugas untuk Ananda $childName"
                )
                renderHomework()
            }

            override fun onFailure(call: Call<ParentHomeworkResponse>, t: Throwable) {
                val netErr = t.message ?: "Koneksi ke server terputus"
                com.school.smartcbt.utils.ClientLogger.logHomework(
                    context = this@ParentHomeworkActivity,
                    action = "LIST_HOMEWORKS",
                    outcome = "ERROR",
                    message = netErr
                )
                renderEmptyState("Koneksi ke server terputus: $netErr")
            }
        })
    }

    private fun renderHomework() {
        binding.containerParentHomework.removeAllViews()

        val filtered = when (currentFilter) {
            "PENDING" -> allHomework.filter { it.submissionStatus.equals("PENDING", ignoreCase = true) }
            "DONE" -> allHomework.filter { !it.submissionStatus.equals("PENDING", ignoreCase = true) }
            else -> allHomework
        }

        if (filtered.isEmpty()) {
            val emptyMsg = when (currentFilter) {
                "PENDING" -> "🎉 Luar biasa! Tidak ada tugas atau PR yang tertunda untuk Ananda $childName."
                "DONE" -> "Belum ada tugas yang selesai dikumpulkan."
                else -> "Belum ada data tugas yang diterbitkan oleh dewan guru untuk kelas $className."
            }
            renderEmptyState(emptyMsg)
            return
        }

        val density = resources.displayMetrics.density

        filtered.forEach { hw ->
            val isSubmitted = !hw.submissionStatus.equals("PENDING", ignoreCase = true)

            val card = CardView(this).apply {
                radius = 16 * density
                cardElevation = 2.5f * density
                useCompatPadding = true
                setCardBackgroundColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = (12 * density).toInt()
                }
            }

            val inner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (16 * density).toInt()
                setPadding(p, p, p, p)
            }

            // Top Row: Subject & Status Pill
            val rowTop = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val tvSubject = TextView(this).apply {
                text = hw.subject
                setTextColor(Color.parseColor("#065F46"))
                textSize = 12f
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            rowTop.addView(tvSubject)

            val tvStatusPill = TextView(this).apply {
                if (isSubmitted) {
                    val scoreStr = hw.score?.let { " • Nilai: $it" } ?: ""
                    text = "✅ Sudah Dikumpulkan$scoreStr"
                    setTextColor(Color.parseColor("#166534"))
                    setBackgroundColor(Color.parseColor("#DCFCE7"))
                } else {
                    text = "⚠️ Perlu Dikerjakan"
                    setTextColor(Color.parseColor("#B45309"))
                    setBackgroundColor(Color.parseColor("#FEF3C7"))
                }
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                val hP = (8 * density).toInt()
                val vP = (3 * density).toInt()
                setPadding(hP, vP, hP, vP)
            }
            rowTop.addView(tvStatusPill)
            inner.addView(rowTop)

            // Title
            val tvTitle = TextView(this).apply {
                text = hw.title
                setTextColor(Color.parseColor("#0F172A"))
                textSize = 15f
                setTypeface(null, Typeface.BOLD)
                setPadding(0, (6 * density).toInt(), 0, (2 * density).toInt())
            }
            inner.addView(tvTitle)

            // Teacher Name
            val tvTeacher = TextView(this).apply {
                val tName = hw.teacherName ?: "Dewan Guru Pengampu"
                text = "👨‍🏫 Guru Pengampu: $tName"
                setTextColor(Color.parseColor("#64748B"))
                textSize = 11.5f
            }
            inner.addView(tvTeacher)

            // Description
            if (!hw.description.isNullOrEmpty()) {
                val tvDesc = TextView(this).apply {
                    text = hw.description
                    setTextColor(Color.parseColor("#334155"))
                    textSize = 12f
                    setPadding(0, (6 * density).toInt(), 0, (6 * density).toInt())
                }
                inner.addView(tvDesc)
            }

            // Deadline Pill
            val tvDeadline = TextView(this).apply {
                text = "📅 Batas Waktu: "
                setTextColor(Color.parseColor(if (isSubmitted) "#047857" else "#B91C1C"))
                textSize = 11f
                setTypeface(null, Typeface.BOLD)
                setBackgroundColor(Color.parseColor(if (isSubmitted) "#ECFDF5" else "#FEF2F2"))
                val hP = (8 * density).toInt()
                val vP = (4 * density).toInt()
                setPadding(hP, vP, hP, vP)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = (8 * density).toInt()
                }
            }
            inner.addView(tvDeadline)

            card.addView(inner)
            binding.containerParentHomework.addView(card)
        }
    }

    private fun renderEmptyState(msg: String) {
        val density = resources.displayMetrics.density
        val tvEmpty = TextView(this).apply {
            text = msg
            setTextColor(Color.parseColor("#64748B"))
            textSize = 13f
            gravity = Gravity.CENTER
            val pad = (40 * density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        binding.containerParentHomework.addView(tvEmpty)
    }
}
