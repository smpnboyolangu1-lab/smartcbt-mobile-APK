package com.school.smartcbt.data.model

data class ParentDashboardDto(
    val child: ChildDto?,
    val attendances: List<AttendanceRecordDto>?,
    val examsTaken: List<ExamTakenDto>?,
    val submissions: List<SubmissionDto>?,
    val stats: StatsDto?,
    val todayAttendance: ParentTodayAttendanceDto? = null,
    val parentNotifications: List<ParentNotificationItemDto>? = null,
    val homeworkSchedule: List<ParentHomeworkItemDto>? = null,
    val lateAnalytics: LateAnalyticsDto? = null
)

data class LateHistoryItemDto(
    val id: String? = null,
    val dateFormatted: String? = null,
    val dayName: String? = null,
    val scanTime: String? = null,
    val minutesLate: Int? = 0,
    val note: String? = null,
    val points: Int? = 5
)

data class LateAnalyticsDto(
    val gateCutoffTime: String? = "07:15 WIB",
    val totalLate: Int? = 0,
    val totalLateMinutes: Int? = 0,
    val averageLateMinutes: Int? = 0,
    val averageArrivalTime: String? = "--:-- WIB",
    val mostFrequentLateDay: String? = "Belum Ada",
    val totalDisciplinePoints: Int? = 0,
    val lateRiskLevel: String? = "TERKENDALI / DISIPLIN BAIK",
    val lateRiskColor: String? = "#10B981",
    val recommendations: List<String>? = emptyList(),
    val lateHistory: List<LateHistoryItemDto>? = emptyList()
)

data class ParentTodayAttendanceDto(
    val status: String?,
    val gateInTime: String?,
    val gateOutTime: String?,
    val isLate: Boolean?,
    val summaryText: String?
)

data class ParentNotificationItemDto(
    val id: String?,
    val title: String?,
    val message: String?,
    val category: String?,
    val createdAt: String?,
    val isRead: Boolean? = false
)

data class ParentHomeworkItemDto(
    val id: String? = null,
    val title: String? = null,
    val subject: String? = null,
    val deadline: String? = null,
    val description: String? = null,
    val isSubmitted: Boolean? = false,
    val submissionStatus: String? = "PENDING",
    val score: Double? = null,
    val teacherName: String? = null,
    val category: String? = null
)

data class ParentHomeworkResponse(
    val success: Boolean = true,
    val child: ChildDto? = null,
    val homework: List<ParentHomeworkItemDto> = emptyList()
)

data class ChildDto(
    val id: String,
    val name: String,
    val username: String,
    val nisn: String?,
    val className: String?,
    val bloodType: String?,
    val allergies: String?,
    val points: Int?,
    val motherName: String? = null,
    val fatherName: String? = null
)

data class AttendanceRecordDto(
    val id: String,
    val type: String,
    val status: String,
    val scanTime: String,
    val note: String?
)

data class ExamTakenDto(
    val id: String,
    val score: Float?,
    val status: String,
    val exam: ExamDto?
)

data class SubmissionDto(
    val id: String,
    val score: Float?,
    val teacherNote: String?,
    val submittedAt: String,
    val homework: HomeworkDto?
)

data class StatsDto(
    val present: Int,
    val late: Int,
    val sick: Int,
    val permission: Int,
    val absent: Int
)

data class OfficialLetterDto(
    val id: String,
    val letterNo: String,
    val title: String,
    val content: String,
    val targetType: String,
    val targetValue: String?,
    val fileUrl: String,
    val fileSize: String?,
    val senderName: String?,
    val createdAt: String,
    val isConfirmed: Boolean? = false,
    val confirmedAt: String? = null
)

data class ParentLettersResponse(
    val child: ChildDto?,
    val count: Int,
    val letters: List<OfficialLetterDto>?
)

data class ParentChildrenResponse(
    val count: Int,
    val children: List<ChildDto>?
)

data class SubjectAttendanceResponse(
    val success: Boolean,
    val studentId: String?,
    val studentName: String?,
    val className: String?,
    val totalSubjects: Int?,
    val subjects: List<SubjectAttendanceItemDto>?
)

data class SubjectAttendanceItemDto(
    val subjectName: String,
    val teacherName: String?,
    val totalSessions: Int,
    val present: Int,
    val sick: Int,
    val permission: Int,
    val truant: Int,
    val percentage: Int,
    val className: String? = null,
    val totalStudents: Int? = null,
    val students: List<SubjectStudentDto>? = null
)

data class SubjectStudentDto(
    val id: String,
    val name: String,
    val nisn: String? = "-",
    val className: String? = null,
    val gender: String? = "L",
    val presentCount: Int = 0,
    val sickCount: Int = 0,
    val permissionCount: Int = 0,
    val absentCount: Int = 0,
    val percentage: Int = 100
)

data class StudentNotificationsResponse(
    val success: Boolean,
    val notifications: List<StudentNotificationItemDto>?
)

data class StudentNotificationItemDto(
    val id: String,
    val recipientRole: String?,
    val className: String?,
    val studentId: String?,
    val studentName: String?,
    val category: String?,
    val title: String,
    val message: String,
    val createdAt: String?
)
data class ParentLeaveRequestDto(
    val id: String,
    val studentId: String,
    val studentName: String? = null,
    val className: String? = null,
    val parentName: String? = null,
    val parentPhone: String? = null,
    val category: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val reason: String? = null,
    val attachmentUrl: String? = null,
    val status: String? = null, // PENDING, APPROVED, REJECTED
    val verifiedBy: String? = null,
    val verifiedAt: String? = null,
    val rejectionNote: String? = null,
    val createdAt: String? = null,
    val durationDays: Int? = null,
    val approvedDays: Int? = null,
    val isDoctorNote: Boolean? = false,
    val isExtension: Boolean? = false,
    val documentType: String? = null,
    val documentLabel: String? = null
)

data class VerifyLeaveRequest(
    val status: String,
    val rejectionNote: String? = null,
    val approvedDaysOverride: Int? = null
)

data class PpdbStatusResponse(
    val success: Boolean,
    val ppdbEnabled: Boolean,
    val message: String? = null
)

data class PpdbRegisterRequest(
    val name: String,
    val nisn: String,
    val gender: String,
    val birthPlace: String,
    val birthDate: String,
    val religion: String,
    val address: String,
    val previousSchool: String,
    val parentName: String,
    val parentPhone: String,
    val parentJob: String,
    val targetClass: String? = "VII-A"
)

// ==========================================
// E-KANTIN MIDTRANS TOP-UP MODELS
// ==========================================
data class CanteenTopupCreateRequest(
    val studentId: String,
    val amount: Int
)

data class CanteenTopupCreateResponse(
    val success: Boolean,
    val message: String,
    val data: CanteenTopupData?
)

data class CanteenTopupData(
    val orderId: String,
    val snapToken: String?,
    val snapUrl: String?,
    val amount: Int,
    val studentName: String?,
    val expiredAt: String?
)

data class CanteenTopupStatusResponse(
    val success: Boolean,
    val message: String? = null,
    val data: CanteenTopupStatusData?
)

data class CanteenTopupStatusData(
    val orderId: String,
    val status: String,
    val amount: Int,
    val studentName: String?,
    val currentBalance: Int = 0,
    val paymentMethod: String?,
    val paidAt: String?,
    val expiredAt: String?
)

data class CanteenTopupHistoryResponse(
    val success: Boolean,
    val total: Int = 0,
    val page: Int = 1,
    val data: List<CanteenTopupHistoryItem>?
)

data class CanteenTopupHistoryItem(
    val id: String,
    val orderId: String,
    val amount: Int,
    val midtransStatus: String,
    val paymentMethod: String?,
    val createdAt: String?,
    val paidAt: String?,
    val studentName: String?,
    val className: String?,
    val parentName: String?
)
