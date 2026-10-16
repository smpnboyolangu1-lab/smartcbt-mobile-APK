package com.school.smartcbt.ui

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import com.school.smartcbt.R
import com.school.smartcbt.utils.SessionManager

data class GuideItem(
    val title: String,
    val icon: String,
    val badge: String,
    val summary: String,
    val steps: List<String>,
    val tips: String? = null
)

class AppGuideActivity : AppCompatActivity() {

    private lateinit var sessionManager: SessionManager
    private lateinit var btnBackGuide: ImageButton
    private lateinit var tvRoleBadgeIcon: TextView
    private lateinit var tvRoleBadgeText: TextView
    private lateinit var tabStudent: Button
    private lateinit var tabParent: Button
    private lateinit var tabTeacher: Button
    private lateinit var tabBk: Button
    private lateinit var tabOperator: Button
    private lateinit var scrollRoleTabs: View
    private lateinit var containerGuideItems: LinearLayout

    private var currentSelectedRole = "STUDENT"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_app_guide)

        sessionManager = SessionManager(this)

        initViews()
        determineInitialRole()
        setupListeners()
        renderGuideForRole(currentSelectedRole)
    }

    private fun initViews() {
        btnBackGuide = findViewById(R.id.btnBackGuide)
        tvRoleBadgeIcon = findViewById(R.id.tvRoleBadgeIcon)
        tvRoleBadgeText = findViewById(R.id.tvRoleBadgeText)
        scrollRoleTabs = findViewById(R.id.scrollRoleTabs)
        tabStudent = findViewById(R.id.tabStudent)
        tabParent = findViewById(R.id.tabParent)
        tabTeacher = findViewById(R.id.tabTeacher)
        tabBk = findViewById(R.id.tabBk)
        tabOperator = findViewById(R.id.tabOperator)
        containerGuideItems = findViewById(R.id.containerGuideItems)
    }

    private fun determineInitialRole() {
        val userRole = sessionManager.getRole().uppercase()
        currentSelectedRole = when {
            userRole.contains("PARENT") || userRole.contains("ORANGTUA") -> "PARENT"
            userRole.contains("TEACHER") || userRole.contains("GURU") || userRole.contains("BK") || userRole.contains("COUNSELOR") -> "TEACHER"
            userRole.contains("ADMIN") || userRole.contains("OPERATOR") -> "OPERATOR"
            else -> "STUDENT"
        }

        // Strictly lock and hide tab switching for single-role users (Siswa, Guru, Orang Tua) agar tidak membingungkan
        if (currentSelectedRole in listOf("STUDENT", "TEACHER", "PARENT")) {
            scrollRoleTabs.visibility = View.GONE
        }
    }

    private fun setupListeners() {
        btnBackGuide.setOnClickListener { finish() }

        // Hanya aktif jika tabs ditampilkan (misal mode admin/operator)
        tabStudent.setOnClickListener { selectRole("STUDENT") }
        tabParent.setOnClickListener { selectRole("PARENT") }
        tabTeacher.setOnClickListener { selectRole("TEACHER") }
        tabBk.setOnClickListener { selectRole("BK") }
        tabOperator.setOnClickListener { selectRole("OPERATOR") }
    }

    private fun selectRole(role: String) {
        currentSelectedRole = role
        renderGuideForRole(role)
    }

    private fun updateTabStyles(activeRole: String) {
        val tabs = listOf(
            Triple(tabStudent, "STUDENT", "🎓 Siswa"),
            Triple(tabParent, "PARENT", "👨‍👩‍👧 Orang Tua"),
            Triple(tabTeacher, "TEACHER", "👨‍🏫 Guru Mapel"),
            Triple(tabBk, "BK", "🛡️ Guru BK"),
            Triple(tabOperator, "OPERATOR", "⚙️ Operator/Admin")
        )

        for ((btn, role, text) in tabs) {
            if (role == activeRole) {
                val activeBg = GradientDrawable().apply {
                    setColor(Color.parseColor("#1D4ED8"))
                    cornerRadius = 18f
                }
                btn.background = activeBg
                btn.setTextColor(Color.WHITE)
            } else {
                val inactiveBg = GradientDrawable().apply {
                    setColor(Color.parseColor("#F1F5F9"))
                    setStroke(1, Color.parseColor("#CBD5E1"))
                    cornerRadius = 18f
                }
                btn.background = inactiveBg
                btn.setTextColor(Color.parseColor("#475569"))
            }
        }
    }

    private fun renderGuideForRole(role: String) {
        updateTabStyles(role)
        containerGuideItems.removeAllViews()

        val (icon, label, guides) = when (role) {
            "PARENT" -> Triple("👨‍👩‍👧", "ORANG TUA / WALI SISWA", getParentGuides())
            "TEACHER" -> Triple("👨‍🏫", "GURU PENDIDIK / MAPEL", getTeacherGuides())
            "BK" -> Triple("🛡️", "GURU BIMBINGAN KONSELING (BK)", getBkGuides())
            "OPERATOR" -> Triple("⚙️", "OPERATOR & ADMINISTRATOR", getOperatorGuides())
            else -> Triple("🎓", "SISWA / PESERTA DIDIK", getStudentGuides())
        }

        tvRoleBadgeIcon.text = icon
        tvRoleBadgeText.text = "Panduan Khusus: $label"

        val density = resources.displayMetrics.density

        for (item in guides) {
            val card = CardView(this).apply {
                radius = 16 * density
                cardElevation = 2 * density
                useCompatPadding = true
                setCardBackgroundColor(Color.WHITE)
                val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = (12 * density).toInt()
                }
                layoutParams = lp
            }

            val cardInner = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding((16 * density).toInt(), (14 * density).toInt(), (16 * density).toInt(), (16 * density).toInt())
            }

            // Top Header: Icon + Badge + Title
            val headerRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
            }

            val tvIcon = TextView(this).apply {
                text = item.icon
                textSize = 22f
            }

            val titleCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginStart = (12 * density).toInt()
                }
            }

            val tvBadge = TextView(this).apply {
                text = item.badge
                textSize = 10f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#0284C7"))
                setBackgroundColor(Color.parseColor("#E0F2FE"))
                setPadding((8 * density).toInt(), (2 * density).toInt(), (8 * density).toInt(), (2 * density).toInt())
            }

            val tvTitle = TextView(this).apply {
                text = item.title
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#0F172A"))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = (2 * density).toInt()
                }
            }

            titleCol.addView(tvBadge)
            titleCol.addView(tvTitle)
            headerRow.addView(tvIcon)
            headerRow.addView(titleCol)
            cardInner.addView(headerRow)

            // Summary
            val tvSummary = TextView(this).apply {
                text = item.summary
                textSize = 13f
                setTextColor(Color.parseColor("#475569"))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = (10 * density).toInt()
                }
            }
            cardInner.addView(tvSummary)

            // Divider
            val divider = View(this).apply {
                setBackgroundColor(Color.parseColor("#F1F5F9"))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1 * density).toInt()).apply {
                    topMargin = (10 * density).toInt()
                    bottomMargin = (10 * density).toInt()
                }
            }
            cardInner.addView(divider)

            // Steps Title
            val tvStepsHeader = TextView(this).apply {
                text = "Langkah Penggunaan:"
                textSize = 12f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#1E293B"))
            }
            cardInner.addView(tvStepsHeader)

            // Steps List
            for ((index, step) in item.steps.withIndex()) {
                val stepRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (6 * density).toInt()
                    }
                }

                val numBadge = TextView(this).apply {
                    text = "${index + 1}"
                    textSize = 11f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.parseColor("#2563EB"))
                    val bg = GradientDrawable().apply {
                        setColor(Color.parseColor("#DBEAFE"))
                        cornerRadius = 12 * density
                    }
                    background = bg
                    gravity = android.view.Gravity.CENTER
                    val lpNum = LinearLayout.LayoutParams((20 * density).toInt(), (20 * density).toInt())
                    layoutParams = lpNum
                }

                val tvStepText = TextView(this).apply {
                    text = step
                    textSize = 12f
                    setTextColor(Color.parseColor("#334155"))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginStart = (8 * density).toInt()
                    }
                }

                stepRow.addView(numBadge)
                stepRow.addView(tvStepText)
                cardInner.addView(stepRow)
            }

            // Optional Tip Box
            item.tips?.let { tip ->
                val tipBox = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    val tipBg = GradientDrawable().apply {
                        setColor(Color.parseColor("#FEF3C7"))
                        setStroke((1 * density).toInt(), Color.parseColor("#FDE68A"))
                        cornerRadius = 8 * density
                    }
                    background = tipBg
                    setPadding((10 * density).toInt(), (8 * density).toInt(), (10 * density).toInt(), (8 * density).toInt())
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                        topMargin = (12 * density).toInt()
                    }
                }

                val tipIcon = TextView(this).apply {
                    text = "💡"
                    textSize = 13f
                }

                val tipText = TextView(this).apply {
                    text = tip
                    textSize = 11f
                    setTextColor(Color.parseColor("#92400E"))
                    typeface = Typeface.DEFAULT_BOLD
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginStart = (8 * density).toInt()
                    }
                }

                tipBox.addView(tipIcon)
                tipBox.addView(tipText)
                cardInner.addView(tipBox)
            }

            card.addView(cardInner)
            containerGuideItems.addView(card)
        }
    }

    private fun getStudentGuides(): List<GuideItem> {
        return listOf(
            GuideItem(
                title = "Presensi Pagi (3 Jalur Resmi)",
                icon = "🏫",
                badge = "PRESENSI MASUK",
                summary = "Sistem presensi masuk tiga jalur sesuai jadwal operasional resmi sekolah.",
                steps = listOf(
                    "Jalur A (06:00 - 07:00 WIB): Scan QR Statis di pintu ruang kelas masing-masing dengan GPS sekolah aktif (Hadir Tepat Waktu).",
                    "Jalur B (06:00 - 07:05 WIB): Jika GPS error/mati, scan Barcode Dinamis di HP Pengurus Kelas tanpa validasi GPS. Pukul 07:00:01 - 07:05:00 WIB status tercatat Terlambat (WhatsApp otomatis ke orang tua).",
                    "Pukul 07:05:00 WIB: Seluruh scan QR kelas & barcode dinamis pengurus DITUTUP TOTAL.",
                    "Jalur C (07:05:01 - 08:00 WIB): Siswa terlambat wajib scan QR Statis Terlambat di Ruang BK. Status Terlambat (WhatsApp otomatis ke orang tua).",
                    "Setelah 08:00 WIB: Seluruh jalur scan ditutup. Siswa wajib lapor ke Guru BK untuk input presensi manual dengan alasan keterlambatan."
                ),
                tips = "Hadir sebelum pukul 07:00:00 WIB di ruang kelas agar tercatat Hadir Tepat Waktu dan menghindari poin keterlambatan."
            ),
            GuideItem(
                title = "Presensi Mata Pelajaran di Kelas",
                icon = "🎯",
                badge = "SESI KBM KELAS",
                summary = "Mencatat kehadiran siswa per mata pelajaran di jam pelajaran aktif.",
                steps = listOf(
                    "Tunggu guru mata pelajaran membuka sesi kelas melalui HP atau portal guru.",
                    "Pada dashboard beranda, status sesi kelas akan aktif dengan nama guru & mata pelajaran.",
                    "Tekan menu 'Presensi Mata Pelajaran' atau pindai QR sesi yang ditampilkan guru di layar kelas.",
                    "Tekan tombol konfirmasi hadir untuk mengunci kehadiran di jam pelajaran tersebut."
                ),
                tips = "Presensi mapel hanya bisa dilakukan jika guru mapel telah mengaktifkan sesi mengajar di kelas."
            ),
            GuideItem(
                title = "Jadwal Guru Piket (Khusus Pengurus Kelas)",
                icon = "📋",
                badge = "KHUSUS PENGURUS KELAS",
                summary = "Menu khusus Ketua, Wakil, Sekretaris, dan Bendahara kelas untuk memantau guru piket hari ini.",
                steps = listOf(
                    "Pengurus kelas dapat melihat menu 'Jadwal Guru Piket' di beranda aplikasi.",
                    "Tekan menu tersebut untuk melihat daftar guru yang bertugas piket hari ini di lobi/piket sekolah.",
                    "Tersedia informasi jam tugas, mata pelajaran, serta kontak darurat guru piket.",
                    "Gunakan informasi ini jika ada jam kosong atau butuh bantuan koordinasi guru piket."
                ),
                tips = "Menu ini otomatis tampil khusus bagi siswa yang terdaftar sebagai pengurus kelas di rombel."
            ),
            GuideItem(
                title = "Absensi Sholat Berjamaah",
                icon = "🕌",
                badge = "IBADAH & MUSHOLA",
                summary = "Presensi ibadah sholat Dhuhur, Jumat, atau Dhuha di mushola sekolah.",
                steps = listOf(
                    "Menuju ke Mushola SMPN 1 Boyolangu pada waktu sholat yang telah ditentukan.",
                    "Tekan menu 'Absensi Sholat' di dashboard aplikasi.",
                    "Pindai barcode statik yang ditempel di area mushola sekolah.",
                    "Sistem memvalidasi waktu resmi sholat dan radius GPS mushola sekolah."
                ),
                tips = "Presensi sholat hanya aktif pada rentang jam sholat resmi sekolah yang telah diatur oleh Guru PAI/Admin."
            ),
            GuideItem(
                title = "Ujian CBT Online (ExamBrowser)",
                icon = "💻",
                badge = "UJIAN SEKOLAH",
                summary = "Mengerjakan Asesmen Sumatif, PTS, PAS, dan Ujian Harian secara aman dan terenkripsi.",
                steps = listOf(
                    "Tekan menu 'Ujian CBT' pada dashboard siswa.",
                    "Pilih jadwal ujian aktif sesuai jenjang kelas.",
                    "Masukkan Token Ujian resmi yang diberikan oleh Guru/Pengawas Ruang.",
                    "Aplikasi akan masuk ke mode ExamBrowser aman yang mengunci layar dari aplikasi lain.",
                    "Jawab seluruh soal, lalu tekan tombol 'Selesai Ujian' untuk mengirim lembar jawaban."
                ),
                tips = "Jangan mencoba keluar dari aplikasi atau membuka floating app saat ujian, karena sistem cheat guard akan mengunci sesi Anda."
            ),
            GuideItem(
                title = "Perizinan Meninggalkan Sekolah (Gatepass BK)",
                icon = "🎫",
                badge = "IZIN KELUAR / DISPENSASI",
                summary = "Pengajuan izin pulang lebih awal, sakit di sekolah, atau dispensasi lomba.",
                steps = listOf(
                    "Tekan menu 'Perizinan' di dashboard beranda.",
                    "Pilih jenis izin (Sakit, Dispensasi Lomba, atau Urusan Mendesak).",
                    "Kunjungi ruang Guru BK untuk verifikasi dan persetujuan tiket.",
                    "Guru BK menyetujui $\\rightarrow$ tiket digital hijau aktif dengan timer 45 menit.",
                    "Tunjukkan tiket QR ke petugas Satpam di pos gerbang untuk dipindai saat keluar."
                ),
                tips = "Tiket Gatepass memiliki keamanan token dinamis dan single-use barcode yang otomatis kadaluarsa setelah dipakai."
            ),
            GuideItem(
                title = "Tugas & PR Siswa",
                icon = "📝",
                badge = "AKADEMIK & TUGAS",
                summary = "Melihat penugasan guru mata pelajaran dan mengumpulkan berkas tugas online.",
                steps = listOf(
                    "Tekan tab navigasi 'Tugas' di bagian bawah layar.",
                    "Filter tugas berdasarkan status: Semua, Belum Dikirim, atau Sudah Dikirim.",
                    "Buka tugas untuk melihat deskripsi dan mengunduh lampiran materi dari guru.",
                    "Unggah berkas jawaban (foto, dokumen PDF, dll.) sebelum tenggat waktu berakhir."
                )
            )
        )
    }

    private fun getParentGuides(): List<GuideItem> {
        return listOf(
            GuideItem(
                title = "Pemantauan Kehadiran & Notifikasi Kedisiplinan",
                icon = "📱",
                badge = "PRESENSI & NOTIFIKASI",
                summary = "Memantau jam kedatangan, keterlambatan, dan kepulangan putra/putri tercinta.",
                steps = listOf(
                    "Buka aplikasi Smart CBT akun Orang Tua untuk memantau status kehadiran real-time.",
                    "Notifikasi WhatsApp otomatis dikirim khusus jika siswa terlambat (tertera waktu tiba, menit keterlambatan, dan jalur presensi).",
                    "Pukul 15:00 WIB: Notifikasi Push di aplikasi otomatis dikirim jika siswa tidak hadir tanpa surat izin (Alpa).",
                    "Presensi tepat waktu dan kepulangan normal terpantau langsung melalui banner notifikasi aplikasi."
                ),
                tips = "Pastikan nomor HP WhatsApp orang tua telah terdaftar dan notifikasi aplikasi aktif."
            ),
            GuideItem(
                title = "Formulir Biodata Siswa & Foto-ke-PDF Dokumen",
                icon = "📄",
                badge = "DATA POKOK TU",
                summary = "Melengkapi 5 langkah identitas siswa dan mengunggah KK serta Akta Kelahiran.",
                steps = listOf(
                    "Tekan menu 'Formulir Biodata' pada aplikasi orang tua.",
                    "Lengkapi Langkah 1 (Identitas), Langkah 2 (Alamat), Langkah 3 (Orang Tua), Langkah 4 (Kesejahteraan).",
                    "Pada Langkah 5 (Berkas), tekan tombol 'Upload KK' atau 'Upload Akta'.",
                    "Pilih 'Ambil Foto Dokumen': kamera HP akan aktif untuk memotret dokumen fisik.",
                    "Sistem otomatis mengompresi dan mengubah foto menjadi format dokumen resmi PDF.",
                    "Tekan tombol 'Kirim Formulir ke TU' untuk verifikasi pihak sekolah."
                ),
                tips = "Gunakan penerangan yang cukup saat memotret dokumen agar seluruh tulisan pada KK dan Akta terbaca jelas oleh TU."
            ),
            GuideItem(
                title = "Nilai Ujian & Capaian Belajar",
                icon = "📊",
                badge = "RAPOR & CBT",
                summary = "Melihat rekap nilai ujian CBT, kuis, dan tugas ananda dari bapak/ibu guru.",
                steps = listOf(
                    "Tekan menu 'Nilai & Hasil Ujian' pada menu beranda.",
                    "Pilih mata pelajaran yang ingin dilihat perkembangannya.",
                    "Daftar nilai ujian, pembahasan, serta peringkat capaian akan tampil transparan."
                )
            ),
            GuideItem(
                title = "Surat Resmi Sekolah & Izin Sakit",
                icon = "✉️",
                badge = "SURAT DIGITAL",
                summary = "Menerima surat edaran sekolah serta mengirimkan surat izin sakit resmi.",
                steps = listOf(
                    "Tekan menu 'Surat Resmi Sekolah'.",
                    "Baca edaran kedinasan atau undangan rapat orang tua langsung dalam format PDF.",
                    "Untuk mengajukan izin sakit: tekan tombol 'Kirim Izin Sakit', lampirkan foto surat dokter/keterangan, lalu kirim."
                )
            )
        )
    }

    private fun getTeacherGuides(): List<GuideItem> {
        return listOf(
            GuideItem(
                title = "Presensi Guru & Estafet Ruangan (1-Tap)",
                icon = "🏷️",
                badge = "KEHADIRAN MENGAJAR",
                summary = "Mencatat kehadiran guru dan serah terima kelas secara akurat menggunakan NFC atau QR.",
                steps = listOf(
                    "Tempelkan HP yang mendukung NFC pada tag NFC di meja guru dalam ruang kelas, ATAU tekan 'Scan QR Ruangan'.",
                    "Sistem mencatat jam kedatangan guru di kelas tersebut untuk jam pelajaran aktif.",
                    "Sesi mengajar langsung siap diaktifkan untuk presensi siswa."
                ),
                tips = "Pastikan fitur NFC pada pengaturan HP sudah aktif sebelum melakukan penempelan pada tag meja kelas."
            ),
            GuideItem(
                title = "Mengaktifkan Presensi Siswa di Kelas",
                icon = "👥",
                badge = "PRESENSI MAPEL SISWA",
                summary = "Membuka pintu presensi mata pelajaran sehingga siswa dapat konfirmasi hadir.",
                steps = listOf(
                    "Setelah tap di kelas, pilih mata pelajaran dan materi ajar pertemuan hari ini.",
                    "Tekan tombol 'Buka Sesi Presensi Siswa'.",
                    "Siswa di rombel tersebut dapat langsung mengonfirmasi hadir dari HP masing-masing.",
                    "Guru dapat memantau live daftar siswa yang hadir, izin, atau tanpa keterangan di layar HP."
                )
            ),
            GuideItem(
                title = "Jurnal Mengajar Digital",
                icon = "📖",
                badge = "ADMINISTRASI GURU",
                summary = "Pencatatan materi pembelajaran, absensi kelas, dan catatan khusus per pertemuan.",
                steps = listOf(
                    "Sebelum mengakhiri sesi pelajaran, buka menu 'Jurnal Mengajar'.",
                    "Tuliskan pokok bahasan materi yang telah diajarkan dan progres ketuntasan kurikulum.",
                    "Simpan jurnal: rekap otomatis tersinkron ke modul kurikulum dan kepala sekolah."
                )
            ),
            GuideItem(
                title = "Manajemen Ujian CBT & Bank Soal",
                icon = "💻",
                badge = "ASESMEN & CBT",
                summary = "Membuat bank soal, jadwal ujian, dan memantau siswa saat ujian berlangsung.",
                steps = listOf(
                    "Akses menu 'Manajemen CBT' atau melalui portal web guru.",
                    "Buat paket soal atau impor dari berkas Excel/Word.",
                    "Tentukan jadwal, durasi, dan generate Token Ujian.",
                    "Pantau jalannya ujian melalui fitur Live Monitoring untuk mendeteksi kecurangan secara seketika."
                )
            )
        )
    }

    private fun getBkGuides(): List<GuideItem> {
        return listOf(
            GuideItem(
                title = "Validasi & Approval Gatepass Digital",
                icon = "🎫",
                badge = "IZIN KELUAR SISWA",
                summary = "Memeriksa dan menyetujui pengajuan izin pulang lebih awal / sakit dari siswa.",
                steps = listOf(
                    "Buka menu 'Gatepass Siswa' di aplikasi atau dashboard BK.",
                    "Periksa permohonan siswa (alasan sakit/dispensasi dan nomor kontak orang tua).",
                    "Lakukan konfirmasi ke orang tua siswa jika diperlukan.",
                    "Tekan 'Setujui Permohonan': sistem membuat tiket digital hijau dengan batas waktu keluar 45 menit.",
                    "Satpam di pos gerbang akan memindai QR code tiket saat siswa melewati pos."
                ),
                tips = "Seluruh riwayat izin keluar tercatat otomatis pada rekap absensi dan buku induk ketertiban BK."
            ),
            GuideItem(
                title = "Early Warning System (EWS)",
                icon = "🚨",
                badge = "RADAR KEDISIPLINAN",
                summary = "Deteksi otomatis siswa yang membutuhkan perhatian dan pembinaan khusus.",
                steps = listOf(
                    "Buka menu 'Early Warning System' di portal BK.",
                    "Sistem menampilkan indikator warna (Kritis, Waspada, Aman) berdasarkan akumulasi keterlambatan, absensi alpa, dan poin pelanggaran.",
                    "Jadwalkan sesi bimbingan konseling langsung dari sistem."
                )
            ),
            GuideItem(
                title = "Presensi Keterlambatan & Manual BK",
                icon = "✍️",
                badge = "KETERTIBAN & BK",
                summary = "Pengelolaan barcode keterlambatan (07:05-08:00 WIB) dan presensi manual setelah 08:00 WIB.",
                steps = listOf(
                    "QR Statis Ruang BK aktif otomatis pukul 07:05:01 s/d 08:00:00 WIB untuk siswa terlambat.",
                    "Setelah pukul 08:00:00 WIB, seluruh scan QR otomatis ditutup oleh server.",
                    "Siswa yang datang setelah pukul 08:00 WIB diinput manual melalui menu 'Presensi Manual BK'.",
                    "Wajib mengisi alasan keterlambatan untuk setiap siswa yang datang setelah pukul 08:00 WIB.",
                    "Notifikasi WhatsApp otomatis terkirim ke orang tua siswa saat presensi terlambat disimpan."
                ),
                tips = "Alasan keterlambatan wajib diisi untuk siswa yang hadir setelah pukul 08:00 WIB."
            )
        )
    }

    private fun getOperatorGuides(): List<GuideItem> {
        return listOf(
            GuideItem(
                title = "Manajemen Pengguna & Siswa Aksi Terpadu",
                icon = "👥",
                badge = "DATA MASTER",
                summary = "Pengelolaan data akun siswa, orang tua, guru, dan rombel kelas.",
                steps = listOf(
                    "Buka menu 'Manajemen Siswa' di portal admin (/admin/siswa).",
                    "Gunakan tombol 'Aksi Terpadu' pada baris siswa untuk: Reset Password, Reset Kunci HP (Binding), Logout Sesi Paksa, atau Cetak Kartu QR.",
                    "Untuk siswa baru, gunakan fitur Import Data atau Registrasi Akun."
                )
            ),
            GuideItem(
                title = "Portal Log Error & Crash Reporter APK",
                icon = "🐞",
                badge = "INSPEKSI KENDALA",
                summary = "Memantau setiap crash, error API, dan kendala teknis pada APK di lapangan secara terpusat.",
                steps = listOf(
                    "Akses menu 'Log Error APK' di portal admin (/admin/client-logs).",
                    "Filter log berdasarkan Keparahan (CRASH, ERROR, WARN), Peran (Siswa, Guru, Ortu), atau Tipe Perangkat.",
                    "Tekan 'Lihat Stack Trace' untuk menganalisis baris kode penyebab error.",
                    "Setelah diperbaiki pada versi rilis berikutnya, klik 'Tandai Selesai'."
                ),
                tips = "Laporan error dikirimkan secara hening (silent) dari HP tanpa memunculkan pesan error yang mengganggu pengguna."
            ),
            GuideItem(
                title = "Feature Toggle Modul (e-Voting, Biodata, PPDB)",
                icon = "🎛️",
                badge = "KONTROL MODUL",
                summary = "Mengaktifkan atau menonaktifkan fitur tertentu sesuai kalender akademik.",
                steps = listOf(
                    "Akses menu Pengaturan Modul atau e-Voting di portal admin.",
                    "Aktifkan switch 'Modul Aktif' untuk membuka akses di APK siswa.",
                    "Saat dinonaktifkan di portal, banner dan tombol di APK otomatis disembunyikan secara rapi."
                )
            )
        )
    }
}
