package com.school.smartcbt.ui

import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.school.smartcbt.data.model.BiodataRaportDto
import com.school.smartcbt.data.model.BiodataRaportResponse
import com.school.smartcbt.data.remote.ApiClient
import com.school.smartcbt.databinding.ActivityBiodataRaportBinding
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class BiodataRaportActivity : AppCompatActivity() {

    private lateinit var binding: ActivityBiodataRaportBinding
    private var targetStudentId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityBiodataRaportBinding.inflate(layoutInflater)
        setContentView(binding.root)

        targetStudentId = intent.getStringExtra("student_id") ?: intent.getStringExtra("child_id")

        setupListeners()
        loadBiodataRaport()
    }

    private fun setupListeners() {
        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.btnRefresh.setOnClickListener {
            loadBiodataRaport()
        }
    }

    private fun loadBiodataRaport() {
        binding.progressBar.visibility = View.VISIBLE

        ApiClient.getClient(this).getBiodataRaport(targetStudentId).enqueue(object : Callback<BiodataRaportResponse> {
            override fun onResponse(call: Call<BiodataRaportResponse>, response: Response<BiodataRaportResponse>) {
                binding.progressBar.visibility = View.GONE
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    if (body.success && body.data != null) {
                        bindDataToUi(body.data)
                    } else {
                        Toast.makeText(this@BiodataRaportActivity, body.message ?: "Data biodata tidak ditemukan", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    Toast.makeText(this@BiodataRaportActivity, "Gagal memuat biodata: kode ${response.code()}", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<BiodataRaportResponse>, t: Throwable) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(this@BiodataRaportActivity, "Koneksi server gagal: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun bindDataToUi(data: BiodataRaportDto) {
        // 1. Nama
        binding.tvRaportNama.text = data.namaLengkap ?: "-"

        // 2. NISN & NIS
        val nisnText = buildString {
            append(data.nisn ?: "-")
            if (!data.nis.isNullOrBlank()) {
                append(" / NIS: ")
                append(data.nis)
            }
        }
        binding.tvRaportNisn.text = nisnText

        // 3. TTL
        binding.tvRaportTtl.text = data.ttl ?: "-"

        // 4. Jenis Kelamin
        binding.tvRaportJk.text = data.jenisKelamin ?: "-"

        // 5. Agama
        binding.tvRaportAgama.text = data.agama ?: "Islam"

        // 6. Status dalam keluarga
        binding.tvRaportStatusKeluarga.text = data.statusDalamKeluarga ?: "Anak Kandung"

        // 7. Anak ke
        binding.tvRaportAnakKe.text = data.anakKe ?: "1"

        // 8. Alamat Peserta Didik
        binding.tvRaportAlamat.text = data.alamat ?: "-"

        // 9. Nomor Telepon Rumah
        binding.tvRaportTeleponRumah.text = data.teleponRumah ?: "-"

        // 10. Sekolah Asal
        binding.tvRaportSekolahAsal.text = data.sekolahAsal ?: "-"

        // 11. Diterima di sekolah ini
        binding.tvRaportDiterimaKelas.text = data.diterimaKelas ?: "-"
        binding.tvRaportDiterimaTanggal.text = data.diterimaTanggal ?: "-"

        // 12. Nama Orang Tua
        binding.tvRaportNamaAyah.text = data.namaAyah ?: "-"
        binding.tvRaportNamaIbu.text = data.namaIbu ?: "-"

        // 13. Alamat Orang Tua
        binding.tvRaportAlamatOrtu.text = data.alamatOrangTua ?: "-"

        // 14. Nomor Telepon Rumah Orang Tua
        binding.tvRaportTeleponOrtu.text = data.teleponOrangTua ?: "-"

        // 15. Pekerjaan Orang Tua
        binding.tvRaportPekerjaanAyah.text = data.pekerjaanAyah ?: "-"
        binding.tvRaportPekerjaanIbu.text = data.pekerjaanIbu ?: "-"

        // 16. Nama Wali Peserta Didik
        binding.tvRaportNamaWali.text = data.namaWali ?: "-"
        binding.tvRaportAlamatWali.text = data.alamatWali ?: "-"
        binding.tvRaportTeleponWali.text = data.teleponWali ?: "-"

        // 17. Pekerjaan Wali Peserta Didik
        binding.tvRaportPekerjaanWali.text = data.pekerjaanWali ?: "-"

        // Peringatan Resmi Operator Dapodik
        if (!data.noticeDapodik.isNullOrBlank()) {
            binding.tvNoticeDapodik.text = data.noticeDapodik
        }
    }
}
