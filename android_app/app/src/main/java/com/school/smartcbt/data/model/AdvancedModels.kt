package com.school.smartcbt.data.model

import com.google.gson.annotations.SerializedName

data class UpdateProfileRequest(
    val oldPassword: String? = null,
    val newPassword: String? = null,
    val profilePicUrl: String? = null,
    val profilePicBase64: String? = null
)

data class StudentProfileResponse(
    val user: StudentUserDto? = null,
    val data: StudentUserDto? = null
)

data class StudentUserDto(
    val id: String,
    val name: String,
    val username: String? = null,
    val nisn: String? = null,
    val nis: String? = null,
    val gender: String? = null,
    val religion: String? = null,
    val pob: String? = null,
    val dob: String? = null,
    val address: String? = null,
    val fatherName: String? = null,
    val motherName: String? = null,
    val parentPhone: String? = null,
    val className: String? = null,
    val homeroomTeacher: String? = null,
    val counselorTeacher: String? = null,
    val bloodType: String? = null,
    val allergies: String? = null,
    val points: Int? = null,
    val profilePicUrl: String? = null,
    val isClassCommittee: Boolean? = false,
    val committeePosition: String? = null,
    val classLeaderName: String? = null,
    val classViceLeaderName: String? = null,
    val classSecretaryName: String? = null,
    val classTreasurerName: String? = null
)

data class AttendanceDetailResponse(
    val success: Boolean = true,
    val stats: AttendanceStatsDto = AttendanceStatsDto(),
    val history: List<AttendanceHistoryDto> = emptyList()
)

data class AttendanceStatsDto(
    val totalEffectiveDays: Int = 0,
    val hadir: Int = 0,
    val terlambat: Int = 0,
    val sakit: Int = 0,
    val izin: Int = 0,
    val alpa: Int = 0,
    val attendanceRate: String = "100%",
    val percentHadir: String = "100%",
    val percentTerlambat: String = "0%",
    val percentSakit: String = "0%",
    val percentIzin: String = "0%",
    val percentAlpa: String = "0%",
    val percentTotalKehadiran: String = "100%",
    val totalDays: Int = 0,
    val present: Int = 0,
    val late: Int = 0,
    val sick: Int = 0,
    val absent: Int = 0,
    val percentage: String = "100%"
)

data class AttendanceHistoryDto(
    val date: String = "",
    val dayName: String = "",
    val gateInTime: String? = null,
    val gateOutTime: String? = null,
    val status: String = "HADIR",
    val gateLocation: String? = null,
    val isLate: Boolean = false,
    val isSunday: Boolean = false,
    val isMissingGateOut: Boolean = false,
    val note: String? = null
)

data class LearningAnalyticsResponse(
    val analytics: LearningAnalyticsDto
)

data class LearningAnalyticsDto(
    val overallCbtAverage: Double,
    val homeworkCompletionRate: String,
    val classRank: String,
    val subjectScores: List<SubjectScoreDto>,
    val homeroomNote: String,
    val aiRecommendation: String
)

data class SubjectScoreDto(
    val subject: String,
    val score: Double,
    val grade: String,
    val status: String
)

data class EFilesResponse(
    val data: List<EFileDto>
)

data class EFileDto(
    val id: String,
    val title: String,
    val category: String,
    val fileUrl: String,
    val fileSize: String?,
    val fileType: String?
)

data class ActiveExamsResponse(
    val success: Boolean,
    val todayDate: String? = null,
    val exams: List<ExamItemDto> = emptyList(),
    val schedules: List<CbtScheduleAgendaDto>? = null
)

data class CbtScheduleAgendaDto(
    val id: String,
    val title: String,
    val subject: String,
    val executionDate: String?,
    val startTimeStr: String?,
    val endTimeStr: String?,
    val durationMinutes: Int = 60,
    val sessionName: String? = null,
    val assignedClasses: String? = null,
    val isToday: Boolean = false,
    val isCompleted: Boolean = false
)

data class ExamItemDto(
    val id: String,
    val title: String,
    val subject: String,
    val durationMinutes: Int,
    val isTokenActive: Boolean,
    val token: String?,
    val questionsCount: Int,
    val sessionName: String?,
    val executionDate: String?,
    val startTimeStr: String?,
    val endTimeStr: String?,
    val status: String,
    val score: Double? = null,
    val submittedAt: String? = null
)

data class StudentHealthResponse(
    val success: Boolean,
    val student: StudentHealthDto?,
    val visits: List<UksVisitDto>?,
    val measurements: List<StudentHealthMeasurementDto>? = null,
    val beds: List<UksBedDto>? = null
)

data class StudentHealthDto(
    val id: String,
    val name: String,
    val username: String?,
    val className: String?,
    val bloodType: String?,
    val allergies: String?,
    val gender: String?,
    val parentPhone: String?,
    val totalSickDays: Int?,
    val faintCount: Int? = null,
    val faintingCount: Int? = null,
    val latestHeightCm: Double? = null,
    val latestWeightKg: Double? = null,
    val latestBmi: Double? = null,
    val nutritionalStatus: String? = null,
    val height: Double? = null,
    val weight: Double? = null,
    val bmi: Double? = null,
    val bmiStatus: String? = null,
    val isRestingAtUks: Boolean? = null,
    val currentBedNumber: String? = null,
    val measurements: List<StudentHealthMeasurementDto>? = null
)

data class StudentHealthMeasurementDto(
    val id: String,
    val heightCm: Double? = null,
    val weightKg: Double? = null,
    val bmi: Double? = null,
    val nutritionalStatus: String? = null,
    val height: Double? = null,
    val weight: Double? = null,
    val bmiStatus: String? = null,
    val semester: String? = null,
    val academicPeriod: String? = null,
    val notes: String?,
    val measuredAt: String? = null,
    val createdAt: String? = null
)

data class UksVisitDto(
    val id: String,
    val category: String? = null,
    val complaint: String?,
    val diagnosis: String? = null,
    val treatment: String?,
    val medicine: String?,
    val restNotes: String? = null,
    val status: String? = null,
    val disposition: String? = null,
    val checkInTime: String?,
    val checkOutTime: String?,
    val isFainting: Boolean? = false,
    val faintCountSnapshot: Int? = null,
    val incidentLocation: String? = null,
    val faintingLocation: String? = null,
    val temperature: Double? = null,
    val bloodPressure: String? = null,
    val bedNumber: String? = null,
    val officerName: String? = null
)

data class UksBedDto(
    val bedNumber: String,
    val isOccupied: Boolean,
    val patientName: String? = null,
    val patientClass: String? = null
)

data class StudentUksReportRequest(
    val complaint: String,
    val category: String? = null,
    val incidentLocation: String? = null
)

// --- E-Library Models ---
data class BookOwnerCheckResponse(
    val success: Boolean,
    val isRegistered: Boolean,
    val isMyBook: Boolean,
    val message: String,
    val book: BookDetailDto?,
    val copy: BookCopyDto?,
    val borrower: StudentBriefDto?,
    val currentViewer: StudentBriefDto?
)

data class BookDetailDto(
    val id: String,
    val title: String,
    val author: String?,
    val publisher: String?,
    val isTextbook: Boolean?,
    val targetClass: String?,
    val ebookUrl: String?
)

data class BookCopyDto(
    val id: String,
    val copyBarcode: String,
    val copyNumber: Int?,
    val status: String,
    val borrowedAt: String?
)

data class StudentBriefDto(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String? = null,
    @SerializedName("className") val className: String? = null,
    @SerializedName("nisn") val nisn: String? = null,
    @SerializedName("nik") val nik: String? = null,
    @SerializedName("gender") val gender: String? = null,
    @SerializedName("religion") val religion: String? = null,
    @SerializedName("pob") val pob: String? = null,
    @SerializedName("dob") val dob: String? = null,
    @SerializedName("address") val address: String? = null,
    @SerializedName("fatherName") val fatherName: String? = null,
    @SerializedName("motherName") val motherName: String? = null,
    @SerializedName("parentPhone") val parentPhone: String? = null,
    @SerializedName("profilePicUrl") val profilePicUrl: String? = null
)

data class MyBorrowedBooksResponse(
    val success: Boolean,
    val books: List<MyBorrowedBookItemDto>
)

data class MyBorrowedBookItemDto(
    val copyId: String? = null,
    val id: String? = null,
    val copyBarcode: String? = null,
    val barcodeCode: String? = null,
    val copyNumber: Int? = null,
    val condition: String? = null,
    val borrowedAt: String? = null,
    val dueDate: String? = null,
    val title: String? = null,
    val author: String? = null,
    val subject: String? = null,
    val gradeClass: String? = null,
    val ebookUrl: String? = null,
    val book: BookDetailDto? = null
)

// --- Piket Models ---
data class PiketStatusResponse(
    val isOnDutyToday: Boolean,
    val dayOfWeek: String,
    val notes: String?,
    val pendingEmptyClassesCount: Int,
    val onDutyTeachers: List<TeacherBriefDto>?
)

data class TeacherBriefDto(
    val id: String,
    val name: String,
    val username: String?
)

data class PiketReportsResponse(
    val reports: List<PiketReportItemDto>
)

data class PiketReportItemDto(
    val id: String,
    val className: String,
    val subject: String?,
    val reporterName: String,
    val notes: String?,
    val status: String,
    val assignmentNote: String?,
    val createdAt: String
)

data class HandlePiketReportRequest(
    val assignmentNote: String
)

// --- E-File Upload & Profile ---
data class UploadEFileRequest(
    val title: String,
    val category: String,
    val fileBase64: String,
    val fileName: String
)

data class UpdateAvatarRequest(
    val imageBase64: String
)

data class CommonResponse(
    val success: Boolean,
    val message: String
)

// --- CCTV & KBM Monitoring Models ---
data class ClassMonitoringStatusResponse(
    val success: Boolean,
    val currentTime: String? = null,
    val currentDay: String? = null,
    val totalClasses: Int? = null,
    val classes: List<ClassMonitoringItemDto>? = null
)

data class ClassMonitoringItemDto(
    val className: String,
    val cam: String? = null,
    val status: String? = null, // GREEN, RED, AMBER, BLUE, IDLE
    val badge: String? = null,
    val isAlarm: Boolean? = false,
    val teacherName: String? = null,
    val subjectName: String? = null,
    val timeRange: String? = null,
    val checkInTime: String? = null,
    val inTimeStr: String? = null,
    val inTime: String? = null,
    val elapsedMinutes: Int? = null,
    val details: String? = null,
    val reportedBy: String? = null,
    val hasAssignment: Boolean? = false,
    val assignmentDetails: String? = null
)

// --- Kurikulum Rekap Guru Mode Lengkap ---
data class KurikulumTeacherRecapResponse(
    val success: Boolean,
    val mode: String? = "LENGKAP",
    val periode: String? = null,
    val count: Int? = 0,
    val totalSesiKbm: Int? = 0,
    val rekap: List<KurikulumTeacherSummaryDto>? = null,
    val detailedLogs: List<KurikulumTeacherDetailLogDto>? = null
)

data class KurikulumTeacherSummaryDto(
    val guruId: String,
    val nama: String,
    val nip: String? = null,
    val mapel: String? = null,
    val rombel: String? = null,
    val tepatWaktu: Int = 0,
    val terlambat: Int = 0,
    val terlambatMenitTotal: Int = 0,
    val tidakMasukCount: Int = 0,
    val izin: Int = 0,
    val sakit: Int = 0,
    val alfa: Int = 0,
    val cutiCount: Int = 0,
    val cutiHariTotal: Int = 0,
    val cutiApprovedList: List<KurikulumCutiDetailDto>? = null,
    val hadirTotal: Int = 0,
    val totalSesi: Int = 0,
    val persentaseKehadiran: Int = 100,
    val kategori: String = "BAIK",
    val badgeColor: String = "#10B981"
)

data class KurikulumCutiDetailDto(
    val id: String? = null,
    val kategori: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val durasiHari: Int = 1,
    val alasan: String? = null,
    val approvedBy: String? = null,
    val approvedAt: String? = null,
    val piketNotes: String? = null,
    val dispositionToPiket: Boolean = false
)

data class KurikulumTeacherDetailLogDto(
    val id: String,
    val guruId: String,
    val namaGuru: String,
    val nip: String? = null,
    val tanggal: String? = null,
    val tanggalDisplay: String? = null,
    val rombel: String? = null,
    val mapel: String? = null,
    val ruangan: String? = null,
    val jamDatang: String? = null,
    val jamSelesai: String? = null,
    val durasiMenit: Int = 0,
    val status: String? = null,
    val statusBadge: String? = null,
    val metode: String? = null,
    val siswaHadir: Int = 0,
    val totalSiswa: Int = 0,
    val keteranganJurnal: String? = null
)

// --- Announcement Models ---
data class AnnouncementItemDto(
    val id: String,
    val title: String,
    val content: String,
    val category: String? = "UMUM",
    val author: String? = "Admin Sekolah",
    val isPinned: Boolean? = false,
    val fileUrl: String? = null,
    val fileSize: String? = null,
    val letterNo: String? = null,
    val targetType: String? = null,
    val targetValue: String? = null,
    val createdAt: String
)

// --- Teacher E-File Models ---
data class TeacherEFilesResponse(
    val success: Boolean,
    val count: Int,
    val teacherName: String?,
    val unreadIncomingCount: Int? = 0,
    val files: List<TeacherEFileDto>? = emptyList(),
    val myFiles: List<TeacherEFileDto>? = emptyList(),
    val incomingFiles: List<TeacherEFileDto>? = emptyList()
)

data class TeacherEFileDto(
    val id: String,
    val title: String,
    val category: String,
    val fileUrl: String,
    val fileSize: String?,
    val fileType: String?,
    val description: String?,
    val isFromAdmin: Boolean? = false,
    val senderName: String? = null,
    val source: String? = null,
    val period: String? = null,
    val isRead: Boolean? = false,
    val uploadedAt: String?
)

data class UploadTeacherEFileRequest(
    val title: String,
    val category: String,
    val fileBase64: String,
    val fileName: String,
    val description: String? = null
)

// --- Library Catalog Models ---
data class LibraryCatalogResponse(
    val success: Boolean,
    val summary: LibraryCatalogSummaryDto? = null,
    val books: List<LibraryCatalogBookDto>
)

data class LibraryCatalogSummaryDto(
    val totalTitles: Int?,
    val totalStock: Int?,
    val activeBorrowings: Int?,
    val availableEbooks: Int?
)

data class LibraryCatalogBookDto(
    val id: String,
    val title: String,
    val author: String?,
    val publisher: String?,
    val yearPublished: String?,
    val isbn: String?,
    val barcodeCode: String?,
    val subject: String?,
    val gradeClass: String?,
    val category: String?,
    val semester: String?,
    val stock: Int?,
    val coverUrl: String?,
    val ebookUrl: String?
)

// --- Teacher Classes, Homeroom & Piket Models ---
data class TeacherClassesResponse(
    val success: Boolean,
    val teacherName: String?,
    val subject: String?,
    val homeroomClass: String?,
    val classes: List<TeacherClassDto>
)

data class TeacherClassDto(
    val className: String,
    val subject: String?,
    val totalStudents: Int?,
    val isHomeroom: Boolean?,
    val roleLabel: String?
)

data class ClassStudentsResponse(
    val success: Boolean,
    val className: String,
    val totalStudents: Int?,
    val students: List<StudentRombelDto>
)

data class StudentRombelDto(
    val id: String,
    val name: String,
    val username: String?,
    val nisn: String?,
    val className: String?,
    val gender: String?,
    val points: Int?,
    val parentPhone: String? = null,
    val fatherName: String? = null,
    val motherName: String? = null,
    val bloodType: String? = null
)

data class HomeroomSummaryResponse(
    val success: Boolean,
    val isHomeroom: Boolean,
    val homeroomClass: String?,
    val totalStudents: Int?,
    val pendingLeavesCount: Int?,
    val approvedLeavesCount: Int? = 0,
    val pendingLeaves: List<HomeroomPendingLeaveDto>?,
    val approvedLeaves: List<HomeroomPendingLeaveDto>? = null
)

data class HomeroomPendingLeaveDto(
    val id: String,
    val studentName: String?,
    val parentName: String?,
    val category: String? = null,
    val reason: String?,
    val durationDays: Int?,
    val approvedDays: Int? = null,
    val isDoctorNote: Boolean? = false,
    val documentLabel: String? = null,
    val startDate: String?,
    val endDate: String? = null,
    val status: String?,
    val verifiedBy: String? = null
)

data class PiketSummaryResponse(
    val success: Boolean,
    val isPiketToday: Boolean,
    val dayName: String? = null,
    val dayOfWeek: Int? = null,
    val piketDetails: Any? = null,
    val openEmptyClassesCount: Int? = null,
    val openEmptyClasses: List<PiketEmptyClassDto>? = null,
    val todayPiketTeam: List<PiketTeamMemberDto>? = null,
    val todayTeacherLeaves: List<PiketTeacherLeaveDto>? = null,
    val weeklyScheduleSummary: List<PiketWeeklyScheduleDto>? = null
)

data class PiketTeamMemberDto(
    val id: String? = null,
    val teacherId: String? = null,
    val teacherName: String? = null,
    val phone: String? = null,
    val subject: String? = null,
    val notes: String? = null
)

data class PiketTeacherLeaveDto(
    val id: String? = null,
    val teacherName: String? = null,
    val subject: String? = null,
    val leaveType: String? = null,
    val reason: String? = null,
    val status: String? = null,
    val hasAssignment: Boolean = false,
    val assignmentDetails: String? = null
)

data class PiketWeeklyScheduleDto(
    val id: String? = null,
    val dayOfWeek: Int? = null,
    val dayName: String? = null,
    val teacherName: String? = null
)

data class PiketEmptyClassDto(
    val id: String,
    val className: String,
    val subjectName: String?,
    val absentTeacherName: String?,
    val period: String?,
    val reason: String?,
    val status: String?
)

data class ClassPeriodItemDto(
    val id: String,
    val periodIndex: Int,
    val startTime: String,
    val endTime: String,
    val timeRange: String? = null,
    val className: String,
    val subjectName: String,
    val roomName: String? = null,
    val isBreak: Boolean = false,
    val isAlreadyIn: Boolean = false,
    val canInNow: Boolean? = true,
    val timeStatus: String? = null,
    val statusMessage: String? = null,
    val inTimeFormatted: String? = null,
    val studentOutCount: Int = 0,
    val totalStudents: Int = 30,
    val sessionId: String? = null,
    val sessionStatus: String? = "PENDING",
    val activeSession: ClassSessionDetailDto? = null
)

data class TeacherClassPeriodsResponse(
    val success: Boolean = true,
    val teacherName: String? = null,
    val day: String? = null,
    val dayName: String? = null,
    val currentTime: String? = null,
    val schedules: List<ClassPeriodItemDto>? = null,
    val data: List<ClassPeriodItemDto>? = null
)

data class TeacherInSessionRequest(
    val scheduleId: String? = null,
    val className: String,
    val subjectName: String,
    val periodIndex: Int,
    val timeRange: String? = null,
    val startTimeStr: String? = null,
    val endTimeStr: String? = null,
    val endTime: String? = null,
    val roomName: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val isFakeGps: Boolean = false
)

data class EmptyClassStatusResponse(
    val success: Boolean = true,
    val className: String? = null,
    val isReported: Boolean = false,
    val isTeacherInClass: Boolean = false,
    val teacherStatusLabel: String? = null,
    val teacherName: String? = null,
    val subjectName: String? = null,
    val periodLesson: String? = null,
    val message: String? = null,
    val recentReports: List<EmptyClassRecentReportDto>? = null
)

data class EmptyClassRecentReportDto(
    val id: String? = null,
    val periodLesson: String? = null,
    val subjectName: String? = null,
    val scheduledTeacher: String? = null,
    val status: String? = null,
    val reporterName: String? = null,
    val substituteTeacher: String? = null,
    val assignmentDetails: String? = null,
    val handledBy: String? = null,
    val createdAt: String? = null
)

data class ClassSessionActiveResponse(
    val success: Boolean = true,
    val role: String? = null,
    val hasActiveSession: Boolean = false,
    val session: ClassSessionDetailDto? = null,
    val data: ClassSessionDetailDto? = null,
    val isStudentOut: Boolean = false,
    val outTimeStr: String? = null,
    val isWindowOutActive: Boolean = false,
    val remainingSeconds: Int? = 0,
    val currentTimeStr: String? = null,
    val studentStatus: String? = null,
    val message: String? = null
)

data class ClassSessionDetailDto(
    val id: String,
    val scheduleId: String? = null,
    val teacherId: String? = null,
    val teacherName: String? = null,
    val className: String,
    val subjectName: String,
    val periodIndex: Int,
    val timeRange: String? = null,
    val startTimeStr: String? = null,
    val endTimeStr: String? = null,
    val roomName: String? = null,
    val inTime: String? = null,
    val outWindowStart: String? = null,
    val status: String? = "ACTIVE",
    val totalStudents: Int = 0,
    val studentOutCount: Int = 0,
    val isTimeWindowValid: Boolean? = true,
    val isLocationValid: Boolean? = true,
    val isDeviceValid: Boolean? = true,
    val isAlreadyOut: Boolean? = false,
    val isOutWindowOpen: Boolean? = false,
    val studentOutTime: String? = null,
    val remainingSeconds: Int? = 0
)

data class StudentOutSessionRequest(
    val sessionId: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val isFakeGps: Boolean = false,
    val deviceId: String? = null
)

data class ClassSessionStudentsStatusResponse(
    val success: Boolean = true,
    val className: String? = null,
    val sessionId: String? = null,
    val totalStudents: Int = 0,
    val presentCount: Int = 0,
    val absentCount: Int = 0,
    val students: List<ClassStudentAttendanceDto>? = null,
    val message: String? = null
)

data class ClassStudentAttendanceDto(
    val studentId: String,
    val name: String,
    val nisn: String? = null,
    val className: String? = null,
    val isPresentInClass: Boolean = false,
    val isLocked: Boolean = false,
    val lockReason: String? = null,
    val gateStatus: String? = null,
    var status: String = "HADIR"
)

// ==================== MODUL IZIN GURU & PIKET ====================
data class TeacherLeaveDto(
    val id: String,
    val teacherId: String,
    val teacherName: String,
    val category: String,
    val startDate: String,
    val endDate: String,
    val reason: String,
    val affectedSchedules: String? = null,
    val assignmentDetails: String? = null,
    val attachmentUrl: String? = null,
    val status: String,
    val approvedBy: String? = null,
    val approvalNotes: String? = null,
    val approvedAt: String? = null,
    val dispositionToPiket: Boolean? = false,
    val piketNotes: String? = null,
    val createdAt: String? = null,
    val teachingSubject: String? = null
) {
    val assignmentForStudents: String? get() = assignmentDetails
}

data class TeacherLeaveResponse(
    val success: Boolean,
    val message: String? = null,
    val pendingCount: Int? = 0,
    val leaves: List<TeacherLeaveDto>? = null,
    val leave: TeacherLeaveDto? = null
)

data class PiketTodayFeedResponse(
    val success: Boolean,
    val todayDate: String? = null,
    val piketTeachers: List<PiketTeacherDto>? = null,
    val leavesCount: Int = 0,
    val leaves: List<TeacherLeaveDto>? = null,
    val emptyClassesCount: Int = 0,
    val emptyClasses: List<EmptyClassReportDto>? = null,
    val lateStudents: List<Any>? = null
)

data class PiketTeacherDto(
    val id: String,
    val name: String,
    val startTime: String? = null,
    val endTime: String? = null,
    val notes: String? = null
)

data class EmptyClassReportDto(
    val id: String,
    val className: String,
    val periodLesson: String? = null,
    val subjectName: String? = null,
    val scheduledTeacher: String? = null,
    val subject: String? = null,
    val teacherName: String? = null,
    val teacherStatus: String? = null,
    val hasAssignment: Boolean = false,
    val assignmentDetails: String? = null,
    val status: String? = "PENDING",
    val reporterName: String? = null
)

// ==================== MODUL JADWAL SHOLAT & BARCODE STATIK ====================
data class PrayerScheduleResponse(
    val success: Boolean,
    val dayName: String? = null,
    val schedule: PrayerClassScheduleDto? = null,
    val message: String? = null
) {
    val dayOfWeek: String get() = dayName ?: schedule?.dayName ?: "HARI INI"
    val scheduledClasses: List<String> get() = schedule?.classNames?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()
}

data class PrayerClassScheduleDto(
    val id: String? = null,
    val dayOfWeek: Int = 1,
    val dayName: String? = null,
    val prayerType: String? = "DHUHUR",
    val classNames: String? = null,
    val barcodeKey: String? = "BARCODE_SHOLAT_DHUHUR_MASJID",
    val notes: String? = null,
    val wudhuTime: String? = "11:45",
    val scanStartTime: String? = "12:00",
    val scanEndTime: String? = "12:30"
)

data class AllPrayerSchedulesResponse(
    val success: Boolean,
    val schedules: List<PrayerClassScheduleDto>? = null,
    val message: String? = null
)

data class PrayerMonitoringResponse(
    val success: Boolean,
    val className: String? = null,
    val date: String? = null,
    val prayerType: String? = "DHUHUR",
    val schedule: PrayerClassScheduleDto? = null,
    val summary: PrayerSummaryDto? = null,
    val students: List<StudentPrayerItemDto>? = null
)

data class PrayerSummaryDto(
    val totalStudents: Int = 0,
    val sholatCount: Int = 0,
    val haidCount: Int = 0,
    val belumCount: Int = 0
) {
    val berjamaah: Int get() = sholatCount
    val haid: Int get() = haidCount
    val belum: Int get() = belumCount
}

data class StudentPrayerItemDto(
    val id: String,
    val name: String,
    val nisn: String?,
    val gender: String?,
    val className: String?,
    val religion: String?,
    val isFemale: Boolean = false,
    val prayerStatus: String = "BELUM_PRESENSI",
    val method: String? = null,
    val recordedAt: String? = null,
    val notes: String? = null
) {
    val studentId: String get() = id
    val studentName: String get() = name
    val status: String get() = prayerStatus
}

// ==================== MODUL PRESENSI MANUAL BK & REKAP 360 ====================
data class BkUnifiedRecapResponse(
    val success: Boolean,
    val date: String? = null,
    val className: String? = null,
    val summary: BkSummaryDto? = null,
    val students: List<BkUnifiedStudentItemDto>? = null
)

data class BkSummaryDto(
    val totalStudents: Int = 0,
    val gate: GateSummaryDto? = null,
    val sholat: PrayerSummaryDto? = null
)

data class GateSummaryDto(
    val hadir: Int = 0,
    val terlambat: Int = 0,
    val sakitIzin: Int = 0,
    val belumMasuk: Int = 0
)

data class BkUnifiedStudentItemDto(
    val id: String,
    val name: String,
    val nisn: String?,
    val gender: String?,
    val className: String?,
    val profilePicUrl: String?,
    val gateStatus: String = "BELUM_MASUK",
    val gateInTime: String? = null,
    val gateOutTime: String? = null,
    val gateMethod: String? = null,
    val mapelCount: Int = 0,
    val prayerType: String? = "DHUHUR",
    val prayerStatus: String = "BELUM_PRESENSI",
    val prayerRecordedAt: String? = null
)

data class PendingStudentLeavesResponse(
    val success: Boolean,
    val pendingCount: Int = 0,
    val leaves: List<StudentLeaveRequestDto>? = null
)

data class StudentLeaveRequestDto(
    val id: String,
    val studentId: String,
    val studentName: String,
    val className: String,
    val parentName: String,
    val parentPhone: String?,
    val category: String,
    val startDate: String,
    val endDate: String,
    val reason: String,
    val attachmentUrl: String? = null,
    val status: String,
    val verifiedBy: String? = null,
    val verifiedAt: String? = null,
    val rejectionNote: String? = null,
    val createdAt: String? = null,
    val durationDays: Int? = null,
    val approvedDays: Int? = null,
    val isDoctorNote: Boolean? = false,
    val isExtension: Boolean? = false,
    val documentLabel: String? = null
)

// ==================== MODUL OPERATOR BROADCAST ====================
data class OperatorBroadcastResponse(
    val success: Boolean,
    val message: String? = null,
    val letters: List<OfficialLetterDto>? = null
)

// ==================== PRESENSI GEOLOCATION GURU ====================
data class TeacherGeoAttendanceRequest(
    val lat: Double?,
    val lng: Double?,
    val isFakeGps: Boolean = false
)

data class TeacherGeoAttendanceResponse(
    val success: Boolean,
    val type: String? = null,
    val message: String? = null,
    val timeStr: String? = null,
    val isCompleted: Boolean? = false
)

data class TeacherTodayAttendanceResponse(
    val success: Boolean,
    val hasIn: Boolean = false,
    val inTime: String? = null,
    val hasOut: Boolean = false,
    val outTime: String? = null,
    val status: String = "NOT_CHECKED_IN",
    val message: String? = null
)

// ==================== MODUL DEEP ATTENDANCE ANALYTICS & MULTI-PERIOD TRENDS ====================
data class StudentAttendanceAnalyticsResponse(
    val student: AnalyticsStudentInfoDto? = null,
    val period: AnalyticsPeriodDto? = null,
    val summary: AnalyticsSummaryDto? = null,
    val punctuality: AnalyticsPunctualityDto? = null,
    val streak: AnalyticsStreakDto? = null,
    val dimensions: AnalyticsDimensionsDto? = null,
    val trends: AnalyticsTrendsDto? = null,
    val insights: List<AnalyticsInsightDto>? = emptyList()
)

data class AnalyticsStudentInfoDto(
    val id: String,
    val name: String,
    val nisn: String? = null,
    val className: String? = null,
    val points: Int = 0,
    val spStatus: String = "AMAN"
)

data class AnalyticsPeriodDto(
    val month: Int = 1,
    val year: Int = 2026,
    val monthName: String = "",
    val effectiveSchoolDays: Int = 0
)

data class AnalyticsSummaryDto(
    val hadir: Int = 0,
    val terlambat: Int = 0,
    val izin: Int = 0,
    val sakit: Int = 0,
    val alpa: Int = 0,
    val attendanceRate: Int = 100,
    val punctualityRate: Int = 100,
    val disciplineScore: Int = 100,
    val classAvgRate: Int = 100,
    val diffFromClassAvg: Int = 0
)

data class AnalyticsPunctualityBucketDto(
    val label: String = "",
    val count: Int = 0
)

data class AnalyticsPunctualityDto(
    val gateDeadline: String = "07:00",
    val avgCheckInTime: String = "-",
    val earliestCheckInTime: String = "-",
    val latestCheckInTime: String = "-",
    val onTimeCount: Int = 0,
    val lateCount: Int = 0,
    val totalLateMinutes: Int = 0,
    val onTimeRate: Int = 100,
    val distribution: List<AnalyticsPunctualityBucketDto>? = emptyList()
)

data class AnalyticsStreakDto(
    val currentStreak: Int = 0,
    val bestStreak: Int = 0,
    val nextMilestone: Int = 7,
    val progressToMilestone: Int = 0,
    val badges: List<String>? = emptyList()
)

data class AnalyticsDimensionItemDto(
    val label: String = "",
    val hadir: Int = 0,
    val total: Int = 0,
    val rate: Int = 100,
    val totalThisMonth: Int = 0
)

data class AnalyticsDimensionsDto(
    val gate: AnalyticsDimensionItemDto? = null,
    val subject: AnalyticsDimensionItemDto? = null,
    val prayer: AnalyticsDimensionItemDto? = null,
    val gatepass: AnalyticsDimensionItemDto? = null
)

data class AnalyticsDailyPointDto(
    val date: String = "",
    val label: String = "",
    val dayName: String = "",
    val status: String = "HADIR",
    val score: Int = 100,
    val checkIn: String = "-",
    val checkOut: String = "-",
    val lateMinutes: Int = 0
)

data class AnalyticsWeeklyPointDto(
    val weekNumber: Int = 1,
    val label: String = "",
    val dateRange: String = "",
    val hadir: Int = 0,
    val terlambat: Int = 0,
    val izinSakit: Int = 0,
    val alpa: Int = 0,
    val totalDays: Int = 0,
    val attendanceRate: Int = 0,
    val punctualityRate: Int = 100,
    val score: Int = 0
)

data class AnalyticsMonthlyPointDto(
    val month: Int = 1,
    val year: Int = 2026,
    val label: String = "",
    val hadir: Int = 0,
    val terlambat: Int = 0,
    val izinSakit: Int = 0,
    val alpa: Int = 0,
    val attendanceRate: Int = 0,
    val classAvgRate: Int = 0
)

data class AnalyticsDayOfWeekDto(
    val dayIndex: Int = 1,
    val dayName: String = "",
    val totalRecords: Int = 0,
    val hadirCount: Int = 0,
    val lateCount: Int = 0,
    val attendanceRate: Int = 100
)

data class AnalyticsTrendsDto(
    val daily14: List<AnalyticsDailyPointDto>? = emptyList(),
    val weekly4: List<AnalyticsWeeklyPointDto>? = emptyList(),
    val monthly6: List<AnalyticsMonthlyPointDto>? = emptyList(),
    val dayOfWeekStats: List<AnalyticsDayOfWeekDto>? = emptyList()
)

data class AnalyticsInsightDto(
    val type: String = "INFO",
    val title: String = "",
    val message: String = ""
)

// ==========================================
// MODUL WALI KELAS DTO
// ==========================================

data class WaliKelasDashboardResponse(
    val success: Boolean = false,
    val isHomeroom: Boolean = false,
    val homeroomClass: String? = null,
    val teacherName: String? = null,
    val teacherNip: String? = null,
    val counselorName: String? = null,
    val counselorNip: String? = null,
    val todayStats: WaliKelasTodayStatsDto? = null,
    val pendingLeavesCount: Int = 0,
    val officers: WaliKelasOfficersDto? = null,
    val message: String? = null
)

data class WaliKelasTodayStatsDto(
    val total: Int = 0,
    val present: Int = 0,
    val unconfirmedOut: Int = 0,
    val late: Int = 0,
    val sick: Int = 0,
    val permission: Int = 0,
    val absent: Int = 0,
    val notYet: Int = 0,
    val attendanceRate: Double = 0.0
)

data class WaliKelasStudentsResponse(
    val success: Boolean = false,
    val homeroomClass: String? = null,
    val totalStudents: Int = 0,
    val countL: Int = 0,
    val countP: Int = 0,
    val students: List<WaliKelasStudentItemDto> = emptyList(),
    val message: String? = null
)

data class WaliKelasStudentItemDto(
    val id: String,
    val name: String,
    val username: String? = null,
    val nisn: String? = null,
    val nis: String? = null,
    val nik: String? = null,
    val gender: String? = null,
    val className: String? = null,
    val points: Int? = 0,
    val parentPhone: String? = null,
    val fatherName: String? = null,
    val motherName: String? = null,
    val address: String? = null,
    val pob: String? = null,
    val dob: String? = null,
    val religion: String? = null,
    val bloodType: String? = null,
    val profilePicUrl: String? = null,
    val kkFileUrl: String? = null,
    val aktaFileUrl: String? = null,
    val isNoSmartphone: Boolean? = false,
    val classRole: String? = null,
    val classRoleDisplay: String? = null,
    val todayAttendance: WaliKelasStudentAttendanceDto? = null
)

data class WaliKelasStudentAttendanceDto(
    val status: String? = "NOT_YET",
    val statusCode: String? = "BELUM",
    val statusText: String? = "Belum Presensi",
    val gateInTime: String? = "-",
    val gateOutTime: String? = "-",
    val note: String? = null
)

data class WaliKelasOfficersResponse(
    val success: Boolean = false,
    val homeroomClass: String? = null,
    val officers: WaliKelasOfficersDto? = null,
    val candidates: List<WaliKelasOfficerCandidateDto> = emptyList(),
    val message: String? = null
)

data class WaliKelasOfficersDto(
    val ketua: OfficerPersonDto? = null,
    val wakil: OfficerPersonDto? = null,
    val sekretaris: OfficerPersonDto? = null,
    val bendahara: OfficerPersonDto? = null
)

data class OfficerPersonDto(
    val id: String? = null,
    val name: String? = null,
    val nisn: String? = null
)

data class WaliKelasOfficerCandidateDto(
    val id: String,
    val name: String,
    val nisn: String? = null,
    val nis: String? = null,
    val classRole: String? = null
)

data class UpdateWaliKelasOfficersRequest(
    val className: String? = null,
    val ketuaId: String? = null,
    val wakilId: String? = null,
    val sekretarisId: String? = null,
    val bendaharaId: String? = null
)

data class ManualAttendanceRequest(
    val studentId: String,
    val status: String = "PRESENT",
    val note: String? = null,
    val targetDate: String? = null,
    val type: String? = "GATE_IN"
)

data class SimpleActionResponse(
    val success: Boolean = false,
    val message: String? = null
)

data class WaliKelasRekapResponse(
    val success: Boolean = false,
    val homeroomClass: String? = null,
    val mode: String = "MONTHLY",
    val month: Int = 1,
    val year: Int = 2026,
    val date: String? = null,
    val totalStudents: Int = 0,
    val records: List<WaliKelasRekapItemDto> = emptyList(),
    val message: String? = null
)

data class WaliKelasRekapItemDto(
    val no: Int = 0,
    val studentId: String,
    val name: String,
    val nisn: String? = null,
    val nis: String? = null,
    val gender: String? = null,
    val H: Int = 0,
    val T: Int = 0,
    val questionMark: Int = 0,
    val S: Int = 0,
    val I: Int = 0,
    val A: Int = 0,
    val totalRecordedDays: Int = 0,
    val attendancePercentage: Double = 100.0
)

data class StudentDetailRekapResponse(
    val success: Boolean = false,
    val student: StudentUserDto? = null,
    val month: Int = 1,
    val year: Int = 2026,
    val summary: StudentDetailSummaryDto? = null,
    val history: List<StudentDetailHistoryItemDto> = emptyList(),
    val message: String? = null
)

data class StudentDetailSummaryDto(
    val totalHadir: Int = 0,
    val totalTerlambat: Int = 0,
    val totalTdkScanPulang: Int = 0,
    val totalSakit: Int = 0,
    val totalIzin: Int = 0,
    val totalAlfa: Int = 0,
    val effectiveDays: Int = 0,
    val attendancePercentage: Double = 100.0
)

data class StudentDetailHistoryItemDto(
    val day: Int = 1,
    val date: String = "",
    val dayName: String = "",
    val status: String = "",
    val statusCode: String = "",
    val statusText: String = "",
    val gateInTime: String? = "-",
    val gateOutTime: String? = "-",
    val note: String? = null
)

data class KurikulumPendingLeavesResponse(
    val success: Boolean = false,
    val count: Int = 0,
    val leaves: List<KurikulumLeaveItemDto> = emptyList(),
    val message: String? = null
)

data class KurikulumLeaveItemDto(
    val id: String = "",
    val teacherId: String = "",
    val teacherName: String = "",
    val category: String = "",
    val type: String = "IZIN",
    val reason: String = "",
    val startDate: String = "",
    val endDate: String = "",
    val totalDays: Int = 1,
    val assignmentDetails: String? = null,
    val taskDescription: String? = null,
    val status: String = "PENDING",
    val schedulesList: List<KurikulumAffectedScheduleDto> = emptyList()
)

data class KurikulumAffectedScheduleDto(
    val periodLesson: String? = "-",
    val timeRange: String? = "-",
    val className: String? = "-",
    val subjectName: String? = "-"
)

data class KurikulumMonthlyReportsResponse(
    val success: Boolean = false,
    val reports: List<KurikulumMonthlyReportItemDto> = emptyList(),
    val message: String? = null
)

data class KurikulumMonthlyReportItemDto(
    val id: String = "",
    val title: String = "",
    val message: String = "",
    val className: String? = null,
    val createdAt: String? = null
)

data class PengurusKelasConfigResponse(
    val success: Boolean = true,
    val isEnabled: Boolean = true
)

data class ClassmateItemDto(
    val id: String,
    val name: String,
    val nisn: String? = null,
    val profilePicUrl: String? = null,
    val classRole: String? = null,
    val status: String = "BELUM_HADIR",
    val statusLabel: String? = null,
    val timeStr: String = "-",
    val gateInTime: String? = null,
    val gateOutTime: String? = null,
    val isGateIn: Boolean = false,
    val isGateOut: Boolean = false,
    val isAssisted: Boolean = false,
    val isNoSmartphone: Boolean = false,
    val gender: String? = null
)

data class ClassmatesRealtimeResponse(
    val success: Boolean = true,
    val className: String? = null,
    val officerRole: String? = null,
    val totalStudents: Int = 0,
    val presentCount: Int = 0,
    val absentCount: Int = 0,
    val lateCount: Int = 0,
    val pulangCount: Int = 0,
    val sickCount: Int = 0,
    val permitCount: Int = 0,
    val sickPermitCount: Int = 0,
    val countL: Int = 0,
    val countP: Int = 0,
    val students: List<ClassmateItemDto> = emptyList(),
    val isFeatureDisabled: Boolean = false,
    val message: String? = null
)

data class AssistedScanRequest(
    val barcodeValue: String,
    val lat: Double?,
    val lng: Double?,
    val accuracy: Float?,
    val scanType: String = "GATE_IN"
)

data class AssistedScanStudentDto(
    val id: String,
    val name: String,
    val nisn: String? = null,
    val className: String? = null,
    val profilePicUrl: String? = null,
    val status: String? = null,
    val timeStr: String? = null,
    val isLate: Boolean = false,
    val isFlaggedFrequent: Boolean = false,
    val isNoSmartphone: Boolean = false
)

data class AssistedScanResponse(
    val success: Boolean = false,
    val message: String = "",
    val student: AssistedScanStudentDto? = null,
    val isGpsError: Boolean = false,
    val isClassMismatch: Boolean = false,
    val isAlreadyScanned: Boolean = false,
    val isNoSmartphone: Boolean = false
)

data class BkDashboardOverviewResponse(
    val success: Boolean = false,
    val summary: BkCounselorSummaryDto? = null,
    val message: String? = null
)

data class BkCounselorSummaryDto(
    val newCasesCount: Int = 0,
    val todaySchedulesCount: Int = 0,
    val unreadParentChatsCount: Int = 0,
    val atRiskCount: Int = 0,
    val supervisedClasses: List<String> = emptyList(),
    val totalClasses: Int = 0,
    val totalStudents: Int = 0
)
