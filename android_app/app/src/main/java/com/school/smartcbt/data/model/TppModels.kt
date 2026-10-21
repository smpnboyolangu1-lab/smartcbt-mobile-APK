package com.school.smartcbt.data.model

import com.google.gson.annotations.SerializedName

/**
 * Model Data TPP Guru (Tambahan Penghasilan Pegawai)
 */
data class MyTppResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("tahun") val tahun: Int,
    @SerializedName("guru") val guru: TppGuruDto?,
    @SerializedName("summary") val summary: TppSummaryDto?,
    @SerializedName("triwulan") val triwulan: List<TppTriwulanDto>?,
    @SerializedName("records") val records: List<TppRecordDto>?,
    @SerializedName("message") val message: String? = null
)

data class TppGuruDto(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("nip") val nip: String
)

data class TppSummaryDto(
    @SerializedName("totalBulanCair") val totalBulanCair: Int,
    @SerializedName("totalBulanBelumCair") val totalBulanBelumCair: Int,
    @SerializedName("totalNominalDiterima") val totalNominalDiterima: Double
)

data class TppTriwulanDto(
    @SerializedName("triwulan") val triwulan: Int,
    @SerializedName("label") val label: String,
    @SerializedName("rentangBulan") val rentangBulan: String,
    @SerializedName("status") val status: String,
    @SerializedName("tanggalCair") val tanggalCair: String,
    @SerializedName("totalBersih") val totalBersih: Double,
    @SerializedName("months") val months: List<TppRecordDto>?
)

data class TppRecordDto(
    @SerializedName("id") val id: String,
    @SerializedName("bulan") val bulan: Int,
    @SerializedName("namaBulan") val namaBulan: String,
    @SerializedName("triwulan") val triwulan: Int? = null,
    @SerializedName("status") val status: String,
    @SerializedName("nominal") val nominal: Double? = 0.0,
    @SerializedName("potongan") val potongan: Double? = 0.0,
    @SerializedName("nominalBersih") val nominalBersih: Double? = 0.0,
    @SerializedName("tanggalCairStr") val tanggalCairStr: String? = "-",
    @SerializedName("noReferensi") val noReferensi: String? = "-",
    @SerializedName("catatan") val catatan: String? = "",
    @SerializedName("sanggahanGuru") val sanggahanGuru: String? = "",
    @SerializedName("statusSanggahan") val statusSanggahan: String? = "",
    @SerializedName("statusVerifikasiKurikulum") val statusVerifikasiKurikulum: String? = "BELUM"
)

data class KurikulumTppMonitoringResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("tahun") val tahun: Int,
    @SerializedName("triwulan") val triwulan: Int,
    @SerializedName("bulan") val bulan: Int,
    @SerializedName("kpi") val kpi: KurikulumTppKpiDto?,
    @SerializedName("teachers") val teachers: List<KurikulumTeacherTppDto>?,
    @SerializedName("message") val message: String? = null
)

data class KurikulumTppKpiDto(
    @SerializedName("totalGuru") val totalGuru: Int,
    @SerializedName("totalSudahCair") val totalSudahCair: Int,
    @SerializedName("totalDalamProses") val totalDalamProses: Int,
    @SerializedName("totalBelumDiproses") val totalBelumDiproses: Int,
    @SerializedName("totalDitunda") val totalDitunda: Int,
    @SerializedName("totalSanggahan") val totalSanggahan: Int,
    @SerializedName("persentaseCair") val persentaseCair: Int
)

data class KurikulumTeacherTppDto(
    @SerializedName("teacherId") val teacherId: String,
    @SerializedName("name") val name: String,
    @SerializedName("nip") val nip: String,
    @SerializedName("mapel") val mapel: String,
    @SerializedName("rombel") val rombel: String,
    @SerializedName("status") val status: String,
    @SerializedName("tanggalCairStr") val tanggalCairStr: String,
    @SerializedName("statusVerifikasi") val statusVerifikasi: String,
    @SerializedName("adaSanggahan") val adaSanggahan: Boolean,
    @SerializedName("catatan") val catatan: String,
    @SerializedName("periods") val periods: List<TppRecordDto>?
)

data class GenericTppActionResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String
)
