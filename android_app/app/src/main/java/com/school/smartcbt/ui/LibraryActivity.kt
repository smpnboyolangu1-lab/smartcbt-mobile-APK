package com.school.smartcbt.ui

import android.app.Dialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.school.smartcbt.R
import com.school.smartcbt.ScannerActivity
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityLibraryBinding
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

// In-memory cache for book covers to eliminate image reloads
object LibraryCoverMemoryCache {
    val cache = ConcurrentHashMap<String, Bitmap>()
}

class LibraryActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLibraryBinding
    private lateinit var sessionManager: SessionManager

    private val imageExecutor = Executors.newFixedThreadPool(4)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var currentTab = 0 // 0 = Package Books, 1 = E-Library, 2 = My Loans, 3 = Rules
    private var packageSlots: List<PackageBookSlotDto> = emptyList()
    private var digitalEbooks: List<EbookDto> = emptyList()
    private var popularEbooks: List<EbookDto> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLibraryBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)
        val userName = sessionManager.getName()
        if (userName.isNotEmpty()) {
            binding.tvLibraryGreeting.text = "Selamat datang, $userName (${sessionManager.getClassName()})"
        }

        setupButtons()
        setupTabs()
        setupSearch()

        // Load active loan reminder
        loadActiveLoansReminder()

        // Default open Tab 0: Virtual Bookshelf
        switchTab(0)
    }

    private fun setupButtons() {
        binding.btnBackLibrary.setOnClickListener { finish() }

        binding.btnRefreshLibrary.setOnClickListener {
            loadActiveLoansReminder()
            when (currentTab) {
                0 -> loadPackageBooks()
                1 -> loadEbooks()
                2 -> loadMyLoans()
            }
        }

        binding.btnScanBookBarcode.setOnClickListener {
            showScanMenuOptionsDialog()
        }

        binding.btnDigitalMemberCard.setOnClickListener {
            showDigitalMemberCardDialog()
        }
    }

    private fun setupTabs() {
        binding.tabPackageBooks.setOnClickListener { switchTab(0) }
        binding.tabELibrary.setOnClickListener { switchTab(1) }
        binding.tabMyLoans.setOnClickListener { switchTab(2) }
        binding.tabRules.setOnClickListener { switchTab(3) }

        // Subtabs in My Loans
        binding.subTabActiveLoans.setOnClickListener { filterMyLoans("AKTIF") }
        binding.subTabHistoryLoans.setOnClickListener { filterMyLoans("SELESAI") }
        binding.subTabFineLoans.setOnClickListener { filterMyLoans("DENDA") }
    }

    private fun switchTab(tabIndex: Int) {
        currentTab = tabIndex

        val activeBg = Color.parseColor("#1E40AF")
        val inactiveBg = Color.TRANSPARENT
        val activeText = Color.WHITE
        val inactiveText = Color.parseColor("#64748B")

        binding.tabPackageBooks.setBackgroundColor(if (tabIndex == 0) activeBg else inactiveBg)
        binding.tabPackageBooks.setTextColor(if (tabIndex == 0) activeText else inactiveText)

        binding.tabELibrary.setBackgroundColor(if (tabIndex == 1) activeBg else inactiveBg)
        binding.tabELibrary.setTextColor(if (tabIndex == 1) activeText else inactiveText)

        binding.tabMyLoans.setBackgroundColor(if (tabIndex == 2) activeBg else inactiveBg)
        binding.tabMyLoans.setTextColor(if (tabIndex == 2) activeText else inactiveText)

        binding.tabRules.setBackgroundColor(if (tabIndex == 3) activeBg else inactiveBg)
        binding.tabRules.setTextColor(if (tabIndex == 3) activeText else inactiveText)

        binding.layoutPackageBooks.visibility = if (tabIndex == 0) View.VISIBLE else View.GONE
        binding.layoutELibrary.visibility = if (tabIndex == 1) View.VISIBLE else View.GONE
        binding.layoutMyLoans.visibility = if (tabIndex == 2) View.VISIBLE else View.GONE
        binding.layoutRules.visibility = if (tabIndex == 3) View.VISIBLE else View.GONE

        when (tabIndex) {
            0 -> if (packageSlots.isEmpty()) loadPackageBooks()
            1 -> {
                if (popularEbooks.isEmpty()) loadPopularEbooks()
                if (digitalEbooks.isEmpty()) loadEbooks()
            }
            2 -> loadMyLoans()
        }
    }

    private fun setupSearch() {
        binding.etSearchEbook.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
                val q = s?.toString()?.trim() ?: ""
                filterDigitalEbooks(q)
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    // ========================================================
    // 1. KOTAK PENGINGAT PINJAMAN AKTIF
    // ========================================================
    private fun loadActiveLoansReminder() {
        val api = ApiClient.getClient(this)
        api.getActiveLoansReminder().enqueue(object : Callback<ActiveLoansReminderResponse> {
            override fun onResponse(call: Call<ActiveLoansReminderResponse>, response: Response<ActiveLoansReminderResponse>) {
                val data = response.body()
                if (data != null && data.success && data.hasReminder) {
                    binding.cardLoanReminder.visibility = View.VISIBLE
                    binding.tvReminderText.text = data.reminderText ?: "Terdapat buku perpustakaan yang sedang Anda pinjam."

                    if (data.isOverdue) {
                        binding.cardLoanReminder.setCardBackgroundColor(Color.parseColor("#FEF2F2"))
                        binding.tvReminderIcon.text = "⚠️"
                        binding.tvReminderIcon.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#EF4444"))
                        binding.tvReminderTitle.text = "Peringatan Jatuh Tempo Terlewat"
                        binding.tvReminderTitle.setTextColor(Color.parseColor("#991B1B"))
                    } else {
                        binding.cardLoanReminder.setCardBackgroundColor(Color.parseColor("#FFFBEB"))
                        binding.tvReminderIcon.text = "⏰"
                        binding.tvReminderIcon.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#F59E0B"))
                        binding.tvReminderTitle.text = "Pemberitahuan Peminjaman Buku"
                        binding.tvReminderTitle.setTextColor(Color.parseColor("#92400E"))
                    }

                    binding.btnReminderAction.setOnClickListener {
                        switchTab(2) // Jump to My Loans
                    }
                } else {
                    binding.cardLoanReminder.visibility = View.GONE
                }
            }

            override fun onFailure(call: Call<ActiveLoansReminderResponse>, t: Throwable) {
                binding.cardLoanReminder.visibility = View.GONE
            }
        })
    }

    // ========================================================
    // 2. TAB 1: RAK BUKU PAKET FISIK (VIRTUAL BOOKSHELF)
    // ========================================================
    private fun loadPackageBooks() {
        val api = ApiClient.getClient(this)
        api.getStudentPackageBooks().enqueue(object : Callback<PackageBooksResponse> {
            override fun onResponse(call: Call<PackageBooksResponse>, response: Response<PackageBooksResponse>) {
                val data = response.body()?.data
                if (data != null) {
                    packageSlots = data.slots ?: emptyList()

                    binding.tvPackageGradeBadge.text = "KELAS ${data.studentGrade ?: "VII"}"
                    val stats = data.stats
                    if (stats != null) {
                        binding.pbPackageProgress.progress = stats.progressPercentage
                        binding.tvPackageProgressPct.text = "${stats.progressPercentage}%"
                        binding.tvPackageProgressText.text = "Terverifikasi: ${stats.verifiedCount} dari ${stats.totalSlots} Buku Paket (${stats.pendingCount} Menunggu Approval)"
                    }

                    renderVirtualBookshelf(packageSlots)
                }
            }

            override fun onFailure(call: Call<PackageBooksResponse>, t: Throwable) {
                Toast.makeText(this@LibraryActivity, "Gagal memuat rak buku paket: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    /**
     * Render Virtual Bookshelf bergaya rak lemari kayu estetik
     * Setiap 2-3 buku duduk di atas papan rak kayu (bg_wooden_shelf)
     */
    private fun renderVirtualBookshelf(slots: List<PackageBookSlotDto>) {
        val container = binding.containerPackageBooks
        container.removeAllViews()

        if (slots.isEmpty()) {
            val emptyTv = TextView(this).apply {
                text = "Belum ada buku paket yang dijadwalkan untuk kelas Anda."
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, 40, 0, 40)
            }
            container.addView(emptyTv)
            return
        }

        val density = resources.displayMetrics.density
        val chunkedSlots = slots.chunked(3) // 3 buku per rak papan kayu

        chunkedSlots.forEach { rowBooks ->
            val shelfRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                setPadding((8 * density).toInt(), (12 * density).toInt(), (8 * density).toInt(), 0)
            }

            rowBooks.forEach { book ->
                val bookWidget = createBookSpineCard(book)
                shelfRow.addView(bookWidget)
            }

            // Papan Kayu Rak (bg_wooden_shelf)
            val woodShelf = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    (20 * density).toInt()
                ).apply {
                    setMargins((4 * density).toInt(), 0, (4 * density).toInt(), (14 * density).toInt())
                }
                setBackgroundResource(R.drawable.bg_wooden_shelf)
            }

            container.addView(shelfRow)
            container.addView(woodShelf)
        }
    }

    /**
     * Membuat Kartu Cover Buku 3D dengan Spine Shadow Effect & Indikator Status
     */
    private fun createBookSpineCard(book: PackageBookSlotDto): View {
        val density = resources.displayMetrics.density

        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f
            ).apply {
                setMargins((6 * density).toInt(), 0, (6 * density).toInt(), 0)
            }
        }

        // Card Container untuk cover buku
        val cardBook = CardView(this).apply {
            val w = (88 * density).toInt()
            val h = (120 * density).toInt()
            layoutParams = LinearLayout.LayoutParams(w, h)
            radius = 8 * density
            cardElevation = 5 * density
            useCompatPadding = false

            // Indikator border multi-color sesuai status
            val borderColor = when (book.visualStatus) {
                "TERVERIFIKASI" -> Color.parseColor("#10B981") // Hijau Glowing
                "PENDING_APPROVAL" -> Color.parseColor("#F59E0B") // Oranye / Kuning
                else -> Color.parseColor("#CBD5E1") // Abu-abu
            }
            setCardBackgroundColor(borderColor)
        }

        val frame = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ).apply {
                setMargins((2 * density).toInt(), (2 * density).toInt(), (2 * density).toInt(), (2 * density).toInt())
            }
        }

        // Gambar Cover Buku
        val ivCover = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.CENTER_CROP
            setImageResource(R.drawable.ic_book_cover_placeholder)
        }
        loadBookCover(book.coverUrl, ivCover)
        frame.addView(ivCover)

        // Efek Bayangan Tulang Buku (Book Spine Shadow 3D)
        val spineShadow = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                (14 * density).toInt(),
                ViewGroup.LayoutParams.MATCH_PARENT
            ).apply { gravity = Gravity.START }
            setBackgroundResource(R.drawable.bg_book_spine_shadow)
        }
        frame.addView(spineShadow)

        // Status Badge Mini di sudut kanan atas cover
        val tvStatusBadge = TextView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                setMargins(0, 4, 4, 0)
            }
            textSize = 8.5f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding((6 * density).toInt(), (2 * density).toInt(), (6 * density).toInt(), (2 * density).toInt())

            when (book.visualStatus) {
                "TERVERIFIKASI" -> {
                    text = "✓ SAH"
                    setBackgroundColor(Color.parseColor("#059669"))
                }
                "PENDING_APPROVAL" -> {
                    text = "PENDING"
                    setBackgroundColor(Color.parseColor("#D97706"))
                }
                else -> {
                    text = "BELUM"
                    setBackgroundColor(Color.parseColor("#64748B"))
                }
            }
        }
        frame.addView(tvStatusBadge)
        cardBook.addView(frame)

        // Judul Singkat di Bawah Buku
        val tvTitle = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = (4 * density).toInt() }
            text = book.mataPelajaran
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }

        wrapper.addView(cardBook)
        wrapper.addView(tvTitle)

        // Interaksi Klik: Membuka lembar detail buku paket
        wrapper.setOnClickListener {
            showBookDetailBottomSheet(book)
        }

        return wrapper
    }

    /**
     * Lembar Detail Buku Paket (Full Cover, Barcode, Buka PDF, Scan Barcode Fisik)
     */
    private fun showBookDetailBottomSheet(book: PackageBookSlotDto) {
        val dialog = BottomSheetDialog(this)
        val density = resources.displayMetrics.density

        val view = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (24 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.WHITE)
        }

        // Header Modal Detail
        val rowTop = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val cardCover = CardView(this).apply {
            layoutParams = LinearLayout.LayoutParams((70 * density).toInt(), (95 * density).toInt())
            radius = 8 * density
            cardElevation = 3 * density
        }

        val ivFullCover = ImageView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            scaleType = ImageView.ScaleType.CENTER_CROP
            setImageResource(R.drawable.ic_book_cover_placeholder)
        }
        loadBookCover(book.coverUrl, ivFullCover)
        cardCover.addView(ivFullCover)
        rowTop.addView(cardCover)

        val colInfo = LinearLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = (14 * density).toInt()
            }
            orientation = LinearLayout.VERTICAL
        }

        val tvTitle = TextView(this).apply {
            text = book.judul
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
        }

        val tvMapel = TextView(this).apply {
            text = "Mapel: ${book.mataPelajaran} • ${book.kurikulum}"
            textSize = 11.5f
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, (2 * density).toInt(), 0, 0)
        }

        val tvStatus = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (6 * density).toInt()
            }
            text = book.statusLabel
            textSize = 10.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding((8 * density).toInt(), (3 * density).toInt(), (8 * density).toInt(), (3 * density).toInt())

            when (book.visualStatus) {
                "TERVERIFIKASI" -> {
                    setTextColor(Color.parseColor("#065F46"))
                    setBackgroundColor(Color.parseColor("#D1FAE5"))
                }
                "PENDING_APPROVAL" -> {
                    setTextColor(Color.parseColor("#92400E"))
                    setBackgroundColor(Color.parseColor("#FEF3C7"))
                }
                else -> {
                    setTextColor(Color.parseColor("#475569"))
                    setBackgroundColor(Color.parseColor("#E2E8F0"))
                }
            }
        }

        colInfo.addView(tvTitle)
        colInfo.addView(tvMapel)
        colInfo.addView(tvStatus)
        rowTop.addView(colInfo)
        view.addView(rowTop)

        // Barcode Info Box jika sudah diklaim
        if (!book.barcodeScanned.isNullOrEmpty()) {
            val barcodeBox = LinearLayout(this).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = (16 * density).toInt()
                }
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#F8FAFC"))
                val p12 = (12 * density).toInt()
                setPadding(p12, p12, p12, p12)
            }

            val tvBarcodeLabel = TextView(this).apply {
                text = "BARCODE EKSEMPLAR FISIK TERKLAIM:"
                textSize = 10f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#64748B"))
            }

            val tvBarcodeValue = TextView(this).apply {
                text = book.barcodeScanned
                textSize = 14f
                typeface = Typeface.MONOSPACE
                setTextColor(Color.parseColor("#0F172A"))
                setPadding(0, 4, 0, 0)
            }

            barcodeBox.addView(tvBarcodeLabel)
            barcodeBox.addView(tvBarcodeValue)
            view.addView(barcodeBox)
        }

        // Action Buttons: Scan Barcode Fisik & Buka E-Book PDF
        val btnScan = Button(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                topMargin = (18 * density).toInt()
            }
            text = if (book.visualStatus == "BELUM_SCAN") "📷 Scan Barcode Buku Fisik Ini" else "🔄 Pindai Ulang Barcode Fisik"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#059669"))
            setOnClickListener {
                dialog.dismiss()
                showInputBarcodeDialog(book)
            }
        }
        view.addView(btnScan)

        if (!book.filePdfUrl.isNullOrEmpty()) {
            val btnPdf = Button(this).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                    topMargin = (8 * density).toInt()
                }
                text = "📖 Buka E-Book PDF (Baca Digital)"
                textSize = 12f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#1E40AF"))
                setBackgroundColor(Color.parseColor("#DBEAFE"))
                setOnClickListener {
                    dialog.dismiss()
                    openPdfViewer(book.judul, book.filePdfUrl)
                }
            }
            view.addView(btnPdf)
        }

        dialog.setContentView(view)
        dialog.show()
    }

    /**
     * Dialog Input / Scan Barcode Buku Fisik Siswa (Self-Claim)
     */
    private fun showInputBarcodeDialog(book: PackageBookSlotDto) {
        val input = EditText(this).apply {
            hint = "Contoh: BKP-MAT7-001"
            setSingleLine(true)
            setText(book.barcodeScanned ?: "")
        }

        AlertDialog.Builder(this)
            .setTitle("Klaim Barcode: ${book.mataPelajaran}")
            .setMessage("Arahkan kamera atau ketikkan kode barcode stiker yang tertempel pada sampul buku fisik:")
            .setView(input)
            .setPositiveButton("Simpan & Klaim") { _, _ ->
                val code = input.text.toString().trim()
                if (code.isNotEmpty()) {
                    executeClaimBook(code, book.id)
                }
            }
            .setNeutralButton("📷 Buka Kamera") { _, _ ->
                val intent = Intent(this, ScannerActivity::class.java).apply {
                    putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_BOOK_AUDIT)
                }
                startActivity(intent)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun executeClaimBook(barcodeCode: String, packageBookId: String) {
        Toast.makeText(this, "Memvalidasi barcode...", Toast.LENGTH_SHORT).show()
        val api = ApiClient.getClient(this)
        api.claimPackageBook(ClaimPackageBookRequest(barcodeCode, packageBookId)).enqueue(object : Callback<BasicResponse> {
            override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                if (response.isSuccessful && response.body()?.success == true) {
                    Toast.makeText(this@LibraryActivity, "✓ Barcode berhasil diklaim! Menunggu approval wali kelas.", Toast.LENGTH_LONG).show()
                    loadPackageBooks()
                } else {
                    val err = response.body()?.message ?: "Gagal klaim barcode (${response.code()})"
                    AlertDialog.Builder(this@LibraryActivity)
                        .setTitle("Klaim Ditolak")
                        .setMessage(err)
                        .setPositiveButton("OK", null)
                        .show()
                }
            }

            override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                Toast.makeText(this@LibraryActivity, "Koneksi bermasalah: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    // ========================================================
    // 3. TAB 2: E-LIBRARY & LITERASI DIGITAL (E-BOOKS)
    // ========================================================
    private fun loadPopularEbooks() {
        val api = ApiClient.getClient(this)
        api.getPopularEbooks().enqueue(object : Callback<PopularEbooksResponse> {
            override fun onResponse(call: Call<PopularEbooksResponse>, response: Response<PopularEbooksResponse>) {
                val list = response.body()?.data ?: emptyList()
                popularEbooks = list
                renderPopularCarousel(list)
            }

            override fun onFailure(call: Call<PopularEbooksResponse>, t: Throwable) {}
        })
    }

    private fun renderPopularCarousel(list: List<EbookDto>) {
        val container = binding.containerPopularBooks
        container.removeAllViews()

        if (list.isEmpty()) {
            binding.layoutPopularSection.visibility = View.GONE
            return
        }
        binding.layoutPopularSection.visibility = View.VISIBLE

        val density = resources.displayMetrics.density

        list.forEach { eb ->
            val card = CardView(this).apply {
                layoutParams = LinearLayout.LayoutParams((120 * density).toInt(), (175 * density).toInt()).apply {
                    marginEnd = (10 * density).toInt()
                }
                radius = 10 * density
                cardElevation = 3 * density
                setCardBackgroundColor(Color.WHITE)
            }

            val layout = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
            }

            val ivCover = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (125 * density).toInt())
                scaleType = ImageView.ScaleType.CENTER_CROP
                setImageResource(R.drawable.ic_book_cover_placeholder)
            }
            loadBookCover(eb.coverUrl, ivCover)
            layout.addView(ivCover)

            val tvTitle = TextView(this).apply {
                text = eb.judul
                textSize = 10.5f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#0F172A"))
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
                setPadding((6 * density).toInt(), (4 * density).toInt(), (6 * density).toInt(), 0)
            }
            layout.addView(tvTitle)

            card.addView(layout)
            card.setOnClickListener {
                openPdfViewer(eb.judul, eb.filePdfUrl)
            }

            container.addView(card)
        }
    }

    private fun loadEbooks() {
        val api = ApiClient.getClient(this)
        api.getStudentEbooks().enqueue(object : Callback<StudentEbooksResponse> {
            override fun onResponse(call: Call<StudentEbooksResponse>, response: Response<StudentEbooksResponse>) {
                val list = response.body()?.data ?: emptyList()
                digitalEbooks = list
                renderDigitalEbooks(list)
            }

            override fun onFailure(call: Call<StudentEbooksResponse>, t: Throwable) {
                Toast.makeText(this@LibraryActivity, "Gagal memuat e-book: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun filterDigitalEbooks(keyword: String) {
        if (keyword.isEmpty()) {
            renderDigitalEbooks(digitalEbooks)
            return
        }
        val filtered = digitalEbooks.filter {
            it.judul.contains(keyword, ignoreCase = true) ||
            it.pengarang.contains(keyword, ignoreCase = true) ||
            it.mataPelajaran.contains(keyword, ignoreCase = true)
        }
        renderDigitalEbooks(filtered)
    }

    private fun renderDigitalEbooks(list: List<EbookDto>) {
        val container = binding.containerDigitalBooks
        container.removeAllViews()

        if (list.isEmpty()) {
            val emptyTv = TextView(this).apply {
                text = "Tidak ada koleksi E-Book yang sesuai."
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, 40, 0, 40)
            }
            container.addView(emptyTv)
            return
        }

        val density = resources.displayMetrics.density

        list.forEach { eb ->
            val card = CardView(this).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (10 * density).toInt()
                }
                radius = 12 * density
                cardElevation = 2 * density
                setCardBackgroundColor(Color.WHITE)
            }

            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                val p = (12 * density).toInt()
                setPadding(p, p, p, p)
            }

            val cardThumb = CardView(this).apply {
                layoutParams = LinearLayout.LayoutParams((55 * density).toInt(), (75 * density).toInt())
                radius = 6 * density
            }

            val ivThumb = ImageView(this).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                scaleType = ImageView.ScaleType.CENTER_CROP
                setImageResource(R.drawable.ic_book_cover_placeholder)
            }
            loadBookCover(eb.coverUrl, ivThumb)
            cardThumb.addView(ivThumb)
            row.addView(cardThumb)

            val infoCol = LinearLayout(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginStart = (12 * density).toInt()
                }
                orientation = LinearLayout.VERTICAL
            }

            val tvTitle = TextView(this).apply {
                text = eb.judul
                textSize = 12.5f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#0F172A"))
            }

            val tvAuthor = TextView(this).apply {
                text = "Pengarang: ${eb.pengarang} • Mapel: ${eb.mataPelajaran}"
                textSize = 10.5f
                setTextColor(Color.parseColor("#64748B"))
                setPadding(0, (2 * density).toInt(), 0, 0)
            }

            val tvTag = TextView(this).apply {
                text = "Target: Kelas ${eb.targetKelas} • ${eb.fileSizeMb} MB"
                textSize = 9.5f
                setTextColor(Color.parseColor("#0284C7"))
                setPadding(0, (4 * density).toInt(), 0, 0)
            }

            infoCol.addView(tvTitle)
            infoCol.addView(tvAuthor)
            infoCol.addView(tvTag)

            val isReference = eb.judul.contains("kamus", ignoreCase = true) ||
                    eb.judul.contains("ensiklopedia", ignoreCase = true) ||
                    eb.judul.contains("atlas", ignoreCase = true) ||
                    eb.mataPelajaran.contains("referensi", ignoreCase = true)

            if (isReference) {
                val tvRefBadge = TextView(this).apply {
                    text = "📖 Hanya Baca di Tempat (Koleksi Referensi)"
                    textSize = 9f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.parseColor("#B45309"))
                    setBackgroundColor(Color.parseColor("#FEF3C7"))
                    setPadding((6 * density).toInt(), (2 * density).toInt(), (6 * density).toInt(), (2 * density).toInt())
                }
                infoCol.addView(tvRefBadge)
            }

            row.addView(infoCol)

            val btnRead = Button(this).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, (36 * density).toInt())
                text = "Baca"
                textSize = 11f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#1E40AF"))
                setOnClickListener {
                    openPdfViewer(eb.judul, eb.filePdfUrl)
                }
            }
            row.addView(btnRead)

            card.addView(row)
            container.addView(card)
        }
    }

    // ========================================================
    // 4. TAB 3: PEMINJAMAN SAYA & PERPANJANGAN
    // ========================================================
    private fun loadMyLoans() {
        val container = binding.containerMyLoans
        container.removeAllViews()

        val tvLoading = TextView(this).apply {
            text = "Memuat daftar peminjaman buku perpustakaan..."
            setTextColor(Color.parseColor("#64748B"))
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(0, 30, 0, 30)
        }
        container.addView(tvLoading)

        ApiClient.getClient(this).getMyBorrowedBooks().enqueue(object : Callback<MyBorrowedBooksResponse> {
            override fun onResponse(call: Call<MyBorrowedBooksResponse>, response: Response<MyBorrowedBooksResponse>) {
                container.removeAllViews()
                val loans = response.body()?.books ?: emptyList()

                if (loans.isEmpty()) {
                    val tvEmpty = TextView(this@LibraryActivity).apply {
                        text = "Tidak ada transaksi peminjaman buku saat ini."
                        setTextColor(Color.parseColor("#94A3B8"))
                        textSize = 12f
                        gravity = Gravity.CENTER
                        setPadding(0, 40, 0, 40)
                    }
                    container.addView(tvEmpty)
                    return
                }

                val density = resources.displayMetrics.density

                loans.forEach { item ->
                    val card = CardView(this@LibraryActivity).apply {
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            bottomMargin = (10 * density).toInt()
                        }
                        radius = 12 * density
                        cardElevation = 2 * density
                        setCardBackgroundColor(Color.WHITE)
                    }

                    val box = LinearLayout(this@LibraryActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        val p = (14 * density).toInt()
                        setPadding(p, p, p, p)
                    }

                    val bookTitle = item.title ?: item.book?.title ?: "Buku Perpustakaan"
                    val tvBookTitle = TextView(this@LibraryActivity).apply {
                        text = bookTitle
                        textSize = 13.5f
                        typeface = Typeface.DEFAULT_BOLD
                        setTextColor(Color.parseColor("#0F172A"))
                    }

                    val isLate = try {
                        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                        val due: Date? = if (item.dueDate != null && item.dueDate.length >= 10) sdf.parse(item.dueDate.substring(0, 10)) else null
                        due != null && due.before(Date())
                    } catch (e: Exception) {
                        false
                    }

                    val tvDue = TextView(this@LibraryActivity).apply {
                        text = "Jatuh Tempo: ${item.dueDate?.take(10) ?: "-"}"
                        textSize = 11.5f
                        setTextColor(if (isLate) Color.parseColor("#DC2626") else Color.parseColor("#D97706"))
                        typeface = Typeface.DEFAULT_BOLD
                        setPadding(0, (2 * density).toInt(), 0, 0)
                    }

                    box.addView(tvBookTitle)
                    box.addView(tvDue)

                    // Tombol Perpanjang Peminjaman jika belum terlambat
                    if (!isLate) {
                        val btnExtend = Button(this@LibraryActivity).apply {
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, (36 * density).toInt()).apply {
                                topMargin = (8 * density).toInt()
                            }
                            text = "🔄 Perpanjang Pinjaman (7 Hari)"
                            textSize = 11f
                            typeface = Typeface.DEFAULT_BOLD
                            setTextColor(Color.WHITE)
                            setBackgroundColor(Color.parseColor("#059669"))
                            setOnClickListener {
                                Toast.makeText(this@LibraryActivity, "Pengajuan perpanjangan berhasil dikirim.", Toast.LENGTH_SHORT).show()
                            }
                        }
                        box.addView(btnExtend)
                    }

                    card.addView(box)
                    container.addView(card)
                }
            }

            override fun onFailure(call: Call<MyBorrowedBooksResponse>, t: Throwable) {
                container.removeAllViews()
                val tvErr = TextView(this@LibraryActivity).apply {
                    text = "Gagal memuat peminjaman: ${t.message}"
                    setTextColor(Color.parseColor("#DC2626"))
                }
                container.addView(tvErr)
            }
        })
    }

    private fun filterMyLoans(status: String) {
        val activeBg = Color.parseColor("#059669")
        val inactiveBg = Color.TRANSPARENT

        binding.subTabActiveLoans.setBackgroundColor(if (status == "AKTIF") activeBg else inactiveBg)
        binding.subTabActiveLoans.setTextColor(if (status == "AKTIF") Color.WHITE else Color.parseColor("#64748B"))

        binding.subTabHistoryLoans.setBackgroundColor(if (status == "SELESAI") activeBg else inactiveBg)
        binding.subTabHistoryLoans.setTextColor(if (status == "SELESAI") Color.WHITE else Color.parseColor("#64748B"))

        binding.subTabFineLoans.setBackgroundColor(if (status == "DENDA") activeBg else inactiveBg)
        binding.subTabFineLoans.setTextColor(if (status == "DENDA") Color.WHITE else Color.parseColor("#64748B"))

        loadMyLoans()
    }

    // ========================================================
    // 5. SCANNER OPTIONS DIALOG (AUDIT & LOST AND FOUND)
    // ========================================================
    private fun showScanMenuOptionsDialog() {
        val options = arrayOf(
            "📷 Scan Barcode Buku Paket Fisik (Self-Claim)",
            "🔍 Deteksi Pemilik Buku Tertinggal (Lost & Found)",
            "📋 Sirkulasi & Audit Barcode Pustakawan"
        )

        AlertDialog.Builder(this)
            .setTitle("Menu Pemindai Barcode Perpustakaan")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> {
                        val intent = Intent(this, ScannerActivity::class.java).apply {
                            putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_BOOK_AUDIT)
                        }
                        startActivity(intent)
                    }
                    1 -> showLostAndFoundDialog()
                    2 -> {
                        val intent = Intent(this, ScannerActivity::class.java).apply {
                            putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_BOOK_AUDIT)
                        }
                        startActivity(intent)
                    }
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    /**
     * Dialog Scan Deteksi Buku Tertinggal (Lost & Found)
     */
    private fun showLostAndFoundDialog() {
        val input = EditText(this).apply {
            hint = "Ketik barcode buku (cth: BKP-MAT7-005)"
            setSingleLine(true)
        }

        AlertDialog.Builder(this)
            .setTitle("Lost & Found: Cari Pemilik Sah Buku")
            .setMessage("Masukkan kode barcode stiker buku yang tertinggal di kelas:")
            .setView(input)
            .setPositiveButton("Cari Pemilik") { _, _ ->
                val code = input.text.toString().trim()
                if (code.isNotEmpty()) {
                    executeLostAndFoundSearch(code)
                }
            }
            .setNeutralButton("📷 Buka Scanner") { _, _ ->
                val intent = Intent(this, ScannerActivity::class.java).apply {
                    putExtra(ScannerActivity.EXTRA_SCAN_MODE, ScannerActivity.MODE_BOOK_AUDIT)
                }
                startActivity(intent)
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun executeLostAndFoundSearch(barcode: String) {
        Toast.makeText(this, "Mencari pemilik sah buku...", Toast.LENGTH_SHORT).show()
        val api = ApiClient.getClient(this)
        api.scanLostAndFound(barcode).enqueue(object : Callback<LostAndFoundResponse> {
            override fun onResponse(call: Call<LostAndFoundResponse>, response: Response<LostAndFoundResponse>) {
                val data = response.body()
                if (data != null && data.success && data.found && data.owner != null) {
                    val owner = data.owner
                    AlertDialog.Builder(this@LibraryActivity)
                        .setTitle("🔍 Pemilik Sah Ditemukan!")
                        .setMessage(
                            "Judul Buku: ${data.bookTitle} (${data.mataPelajaran})\n" +
                            "Barcode: ${data.barcode}\n\n" +
                            "👤 Nama Pemilik: ${owner.name}\n" +
                            "🏫 Kelas: ${owner.className}\n" +
                            "📋 NISN: ${owner.nisn ?: "-"}\n\n" +
                            "Buku ini sah dipinjam oleh siswa tersebut."
                        )
                        .setPositiveButton("Kirim Peringatan ke Pemilik") { _, _ ->
                            Toast.makeText(this@LibraryActivity, "Notifikasi pengingat terkirim ke HP ${owner.name}.", Toast.LENGTH_LONG).show()
                        }
                        .setNegativeButton("Tutup", null)
                        .show()
                } else {
                    AlertDialog.Builder(this@LibraryActivity)
                        .setTitle("Informasi Buku")
                        .setMessage(data?.message ?: "Buku ini tidak sedang dipinjam oleh siswa manapun.")
                        .setPositiveButton("OK", null)
                        .show()
                }
            }

            override fun onFailure(call: Call<LostAndFoundResponse>, t: Throwable) {
                Toast.makeText(this@LibraryActivity, "Gagal melacak buku: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    // ========================================================
    // 6. HELPER LOAD COVER & BUKA PDF IN-APP
    // ========================================================
    private fun loadBookCover(coverUrl: String?, imageView: ImageView) {
        if (coverUrl.isNullOrEmpty()) {
            imageView.setImageResource(R.drawable.ic_book_cover_placeholder)
            return
        }

        val fullUrl = if (coverUrl.startsWith("http")) coverUrl else ApiClient.getBaseServerUrl(this) + coverUrl
        imageView.tag = fullUrl

        val cached = LibraryCoverMemoryCache.cache[fullUrl]
        if (cached != null) {
            imageView.setImageBitmap(cached)
            return
        }

        imageView.setImageResource(R.drawable.ic_book_cover_placeholder)

        imageExecutor.execute {
            try {
                val url = URL(fullUrl)
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 8000
                    doInput = true
                }
                conn.connect()
                if (conn.responseCode == 200) {
                    val bytes = conn.inputStream.use { it.readBytes() }
                    if (bytes.isNotEmpty()) {
                        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        if (bitmap != null) {
                            LibraryCoverMemoryCache.cache[fullUrl] = bitmap
                            mainHandler.post {
                                if (imageView.tag == fullUrl) {
                                    imageView.setImageBitmap(bitmap)
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {}
        }
    }

    private fun openPdfViewer(title: String, pdfUrl: String) {
        val fullUrl = if (pdfUrl.startsWith("http")) pdfUrl else ApiClient.getBaseServerUrl(this) + pdfUrl
        val intent = Intent(this, PdfViewerActivity::class.java).apply {
            putExtra(PdfViewerActivity.EXTRA_TITLE, title)
            putExtra(PdfViewerActivity.EXTRA_URL, fullUrl)
            putExtra(PdfViewerActivity.EXTRA_DOC_TYPE, "EBOOK")
        }
        startActivity(intent)
    }

    private fun showDigitalMemberCardDialog() {
        val density = resources.displayMetrics.density
        val dialogView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * density).toInt()
            setPadding(p, p, p, p)
            setBackgroundColor(Color.WHITE)
        }

        val card = CardView(this).apply {
            radius = 16 * density
            cardElevation = 4 * density
            setCardBackgroundColor(Color.parseColor("#0F2F57"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        val cardContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val cp = (18 * density).toInt()
            setPadding(cp, cp, cp, cp)
        }

        val tvHeader = TextView(this).apply {
            text = "SMP NEGERI 1 BOYOLANGU"
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#93C5FD"))
            letterSpacing = 0.08f
        }

        val tvCardTitle = TextView(this).apply {
            text = "KARTU DIGITAL PERPUSTAKAAN"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setPadding(0, (2 * density).toInt(), 0, (12 * density).toInt())
        }

        val tvName = TextView(this).apply {
            text = sessionManager.getName().ifEmpty { "Siswa Perpustakaan" }
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
        }

        val tvNisn = TextView(this).apply {
            val username = sessionManager.getUsername()
            text = "NISN / ID: ${if (username.isNotEmpty()) username else "1234567890"}"
            textSize = 12f
            setTextColor(Color.parseColor("#E2E8F0"))
        }

        val tvClass = TextView(this).apply {
            text = "Kelas: ${sessionManager.getClassName().ifEmpty { "Semua Kelas" }}"
            textSize = 12f
            setTextColor(Color.parseColor("#93C5FD"))
            setPadding(0, (2 * density).toInt(), 0, (14 * density).toInt())
        }

        // Barcode Visual Box
        val barcodeBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bp = (10 * density).toInt()
            setPadding(bp, bp, bp, bp)
            setBackgroundColor(Color.WHITE)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        val tvBarcodeDisplay = TextView(this).apply {
            text = "||||| || |||||| ||||| |||| || ||||||"
            textSize = 18f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.BLACK)
            gravity = Gravity.CENTER
        }

        val tvBarcodeCode = TextView(this).apply {
            val code = sessionManager.getUsername().ifEmpty { "LIB-STD-" + sessionManager.getUserId().take(8) }
            text = "* $code *"
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.parseColor("#334155"))
            gravity = Gravity.CENTER
            setPadding(0, (4 * density).toInt(), 0, 0)
        }

        barcodeBox.addView(tvBarcodeDisplay)
        barcodeBox.addView(tvBarcodeCode)

        val tvFooter = TextView(this).apply {
            text = "✓ ANGGOTA RESMI AKTIF • BEBAS DENDA FINANSIAL 100%"
            textSize = 9.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#34D399"))
            gravity = Gravity.CENTER
            setPadding(0, (10 * density).toInt(), 0, 0)
        }

        cardContent.addView(tvHeader)
        cardContent.addView(tvCardTitle)
        cardContent.addView(tvName)
        cardContent.addView(tvNisn)
        cardContent.addView(tvClass)
        cardContent.addView(barcodeBox)
        cardContent.addView(tvFooter)

        card.addView(cardContent)
        dialogView.addView(card)

        val btnClose = Button(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (44 * density).toInt()).apply {
                topMargin = (14 * density).toInt()
            }
            text = "Tutup Kartu"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0F2F57"))
        }

        dialogView.addView(btnClose)

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .setCancelable(true)
            .create()

        btnClose.setOnClickListener { dialog.dismiss() }
        dialog.show()
    }
}
