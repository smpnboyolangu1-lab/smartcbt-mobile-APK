package com.school.smartcbt.data.model

data class ConsultationUserDto(
    val id: String? = null,
    val name: String? = null,
    val username: String? = null,
    val className: String? = null,
    val nisn: String? = null
)

data class ConsultationDto(
    val id: String,
    val category: String,
    val subject: String,
    val message: String,
    val replyMessage: String?,
    val replyDate: String?,
    val status: String,
    val isAnonymous: Boolean,
    val createdAt: String,
    val student: ConsultationUserDto? = null,
    val counselor: ConsultationUserDto? = null,
    val evidenceUrl: String? = null,
    val isWhistleblower: Boolean? = false,
    val bullySuspect: String? = null,
    val location: String? = null
)

data class SendReportRequest(
    val category: String,
    val subject: String,
    val message: String,
    val isAnonymous: Boolean,
    val studentId: String? = null
)

data class ReplyBkRequest(
    val replyMessage: String,
    val status: String = "REPLIED"
)

data class BkTodayAttendanceDto(
    val time: String? = null,
    val status: String? = null,
    val note: String? = null
)

data class BkClassRecapResponse(
    val success: Boolean,
    val allowedClasses: List<String>? = null,
    val tingkats: List<String>? = null,
    val tingkatGroups: Map<String, List<String>>? = null,
    val selectedClass: String? = null,
    val totalStudents: Int? = null,
    val students: List<BkStudentRecapDto>? = null,
    val message: String? = null
)

data class BkStudentRecapDto(
    val id: String,
    val name: String,
    val username: String? = null,
    val nisn: String? = null,
    val className: String? = null,
    val gender: String? = null,
    val points: Int? = null,
    val parentPhone: String? = null,
    val spLevel: String? = null,
    val todayGateIn: BkTodayAttendanceDto? = null,
    val todayGateOut: BkTodayAttendanceDto? = null,
    val canAbsenMasuk: Boolean? = true,
    val canAbsenPulang: Boolean? = true,
    val stats: BkStudentStatsDto? = null,
    val recentViolations: List<BkDisciplineRecordDto>? = null
)

data class BkStudentStatsDto(
    val hadir: Int = 0,
    val terlambat: Int = 0,
    val sakit: Int = 0,
    val izin: Int = 0,
    val alpa: Int = 0
)

data class BkDisciplineRecordDto(
    val id: String? = null,
    val userId: String? = null,
    val type: String? = null,
    val category: String? = null,
    val description: String? = null,
    val points: Int? = null,
    val counselorName: String? = null,
    val createdAt: String? = null,
    val user: ConsultationUserDto? = null
)

data class BkDisciplineStudentSummaryDto(
    val id: String? = null,
    val name: String? = null,
    val nisn: String? = null,
    val className: String? = null,
    val totalViolationPoints: Int = 0,
    val spStatus: String = "AMAN",
    val nextSpThreshold: Int = 15,
    val violationCount: Int = 0,
    val achievementCount: Int = 0,
    val warningLetters: List<BkWarningLetterDto>? = emptyList()
)

data class BkDisciplineListResponse(
    val success: Boolean = true,
    val studentSummary: BkDisciplineStudentSummaryDto? = null,
    val records: List<BkDisciplineRecordDto>? = emptyList()
)

data class BkWarningLetterDto(
    val id: String,
    val userId: String? = null,
    val spLevel: String,
    val letterNumber: String? = null,
    val totalPointsSnapshot: Int = 0,
    val reasonSummary: String? = null,
    val issuedBy: String? = null,
    val issuedAt: String? = null,
    val user: ConsultationUserDto? = null,
    val acknowledgedByParent: Boolean? = false,
    val acknowledgedAt: String? = null
)

data class BkWarningLettersResponse(
    val success: Boolean = true,
    val letters: List<BkWarningLetterDto>? = emptyList()
)

data class IssueWarningLetterRequest(
    val userId: String,
    val spLevel: String,
    val reasonSummary: String,
    val letterNumber: String? = null
)

data class BkEarlyWarningSummaryDto(
    val totalMonitored: Int = 0,
    val sp3Count: Int = 0,
    val sp2Count: Int = 0,
    val sp1Count: Int = 0,
    val pembinaanCount: Int = 0
)

data class BkEarlyWarningStudentDto(
    val id: String,
    val name: String,
    val username: String? = null,
    val nisn: String? = null,
    val className: String? = null,
    val points: Int = 0,
    val recommendedLevel: String? = "AMAN",
    val activeSp: String? = "AMAN",
    val needsUpgrade: Boolean = false,
    val parentPhone: String? = null,
    val recentRecords: List<BkDisciplineRecordDto>? = emptyList()
)

data class BkEarlyWarningResponse(
    val summary: BkEarlyWarningSummaryDto? = null,
    val students: List<BkEarlyWarningStudentDto>? = emptyList()
)

data class BkDisciplineCategoryDto(
    val id: String,
    val code: String? = null,
    val name: String,
    val type: String = "PELANGGARAN",
    val defaultPoints: Int = 5,
    val description: String? = null
)

data class BkTodayActivityResponse(
    val success: Boolean,
    val lateArrivals: List<BkActivityItemDto>? = null,
    val earlyLeaves: List<BkActivityItemDto>? = null
)

data class BkActivityItemDto(
    val id: String,
    val studentId: String? = null,
    val studentName: String? = null,
    val className: String? = null,
    val nisn: String? = null,
    val scanTime: String? = null,
    val note: String? = null
)

data class CreateDisciplineRequest(
    val studentId: String? = null,
    val userId: String? = null,
    val type: String = "PELANGGARAN",
    val category: String? = null,
    val description: String,
    val points: Int
)

