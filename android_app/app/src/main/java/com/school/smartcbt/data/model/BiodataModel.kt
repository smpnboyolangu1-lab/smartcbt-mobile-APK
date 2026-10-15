package com.school.smartcbt.data.model

import com.google.gson.annotations.SerializedName

// ========================================================
// MODEL DATA FORMULIR BIODATA SISWA (STAGING & MULTI-STEP)
// ========================================================

data class MyBiodataResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("isToggleOpen") val isToggleOpen: Boolean,
    @SerializedName("deadline") val deadline: String?,
    @SerializedName("isLocked") val isLocked: Boolean,
    @SerializedName("status") val status: String, // NOT_SUBMITTED, PENDING, APPROVED, REJECTED
    @SerializedName("rejectionReason") val rejectionReason: String?,
    @SerializedName("submission") val submission: BiodataSubmissionDto?,
    @SerializedName("student") val student: StudentBriefDto?
)

data class BiodataSubmissionResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?,
    @SerializedName("isLocked") val isLocked: Boolean = false,
    @SerializedName("submission") val submission: BiodataSubmissionDto?
)

data class BiodataSubmissionDto(
    @SerializedName("id") val id: String,
    @SerializedName("studentId") val studentId: String,
    @SerializedName("status") val status: String, // PENDING, APPROVED, REJECTED
    @SerializedName("rejectionReason") val rejectionReason: String?,
    @SerializedName("kkFileUrl") val kkFileUrl: String?,
    @SerializedName("aktaFileUrl") val aktaFileUrl: String?,
    @SerializedName("step1Data") val step1Data: String?,
    @SerializedName("step2Data") val step2Data: String?,
    @SerializedName("step3Data") val step3Data: String?,
    @SerializedName("step4Data") val step4Data: String?,
    @SerializedName("step5Data") val step5Data: String?,
    @SerializedName("submittedAt") val submittedAt: String?,
    @SerializedName("reviewedAt") val reviewedAt: String?,
    @SerializedName("reviewedBy") val reviewedBy: String?
)

// ========================================================
// MODEL DATA BUKU INDUK RAPORT & DAPODIK (17 ITEM READ-ONLY)
// ========================================================

data class BiodataRaportResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("data") val data: BiodataRaportDto?,
    @SerializedName("message") val message: String? = null
)

data class BiodataRaportDto(
    @SerializedName("studentId") val studentId: String?,
    @SerializedName("item1_namaLengkap") val namaLengkap: String?,
    @SerializedName("item2_nisn") val nisn: String?,
    @SerializedName("item2_nis") val nis: String?,
    @SerializedName("item3_ttl") val ttl: String?,
    @SerializedName("item3_tempatLahir") val tempatLahir: String?,
    @SerializedName("item3_tanggalLahir") val tanggalLahir: String?,
    @SerializedName("item4_jenisKelamin") val jenisKelamin: String?,
    @SerializedName("item5_agama") val agama: String?,
    @SerializedName("item6_statusDalamKeluarga") val statusDalamKeluarga: String?,
    @SerializedName("item7_anakKe") val anakKe: String?,
    @SerializedName("item8_alamat") val alamat: String?,
    @SerializedName("item8_rt") val rt: String?,
    @SerializedName("item8_rw") val rw: String?,
    @SerializedName("item8_desa") val desa: String?,
    @SerializedName("item8_kecamatan") val kecamatan: String?,
    @SerializedName("item8_kabupaten") val kabupaten: String?,
    @SerializedName("item8_kodePos") val kodePos: String?,
    @SerializedName("item9_teleponRumah") val teleponRumah: String?,
    @SerializedName("item10_sekolahAsal") val sekolahAsal: String?,
    @SerializedName("item11_diterimaKelas") val diterimaKelas: String?,
    @SerializedName("item11_diterimaTanggal") val diterimaTanggal: String?,
    @SerializedName("item12_namaAyah") val namaAyah: String?,
    @SerializedName("item12_namaIbu") val namaIbu: String?,
    @SerializedName("item13_alamatOrangTua") val alamatOrangTua: String?,
    @SerializedName("item14_teleponOrangTua") val teleponOrangTua: String?,
    @SerializedName("item15_pekerjaanAyah") val pekerjaanAyah: String?,
    @SerializedName("item15_pekerjaanIbu") val pekerjaanIbu: String?,
    @SerializedName("item16_namaWali") val namaWali: String?,
    @SerializedName("item16_alamatWali") val alamatWali: String?,
    @SerializedName("item16_teleponWali") val teleponWali: String?,
    @SerializedName("item17_pekerjaanWali") val pekerjaanWali: String?,
    @SerializedName("noticeDapodik") val noticeDapodik: String?,
    @SerializedName("isReadOnly") val isReadOnly: Boolean = true
)

