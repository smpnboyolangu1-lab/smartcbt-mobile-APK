package com.school.smartcbt.data.model

import com.google.gson.annotations.SerializedName

// ========================================================
// MODUL ESTAFET SESI MENGAJAR GURU (ROOM HANDOVER VIA NFC/QR)
// ========================================================

data class TeacherSessionCheckInRequest(
    @SerializedName("roomCode") val roomCode: String? = null,
    @SerializedName("nfcTagUid") val nfcTagUid: String? = null,
    @SerializedName("qrSecretToken") val qrSecretToken: String? = null,
    @SerializedName("forceHandover") val forceHandover: Boolean? = false,
    @SerializedName("subjectName") val subjectName: String? = null
)

data class TeacherSessionCheckInResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?,
    @SerializedName("error") val error: String? = null,
    @SerializedName("session") val session: TeachingSessionDto? = null,
    @SerializedName("room") val room: PhysicalRoomDto? = null,
    @SerializedName("totalStudents") val totalStudents: Int? = null,
    @SerializedName("attendances") val attendances: List<StudentSubjectAttendanceDto>? = null,
    @SerializedName("activeSession") val activeSession: LingeringSessionDto? = null,
    @SerializedName("targetRoom") val targetRoom: TargetRoomDto? = null,
    @SerializedName("resolutionPrompt") val resolutionPrompt: String? = null
)

data class TeachingSessionDto(
    @SerializedName("id") val id: String,
    @SerializedName("teacherId") val teacherId: String,
    @SerializedName("roomId") val roomId: String,
    @SerializedName("className") val className: String,
    @SerializedName("subjectName") val subjectName: String,
    @SerializedName("checkInTime") val checkInTime: String? = null,
    @SerializedName("checkOutTime") val checkOutTime: String? = null,
    @SerializedName("checkInMethod") val checkInMethod: String? = null,
    @SerializedName("checkOutMethod") val checkOutMethod: String? = null,
    @SerializedName("status") val status: String, // IN_PROGRESS, COMPLETED, CLOSED_BY_HANDOVER
    @SerializedName("studentCount") val studentCount: Int? = 0,
    @SerializedName("presentCount") val presentCount: Int? = 0,
    @SerializedName("truantCount") val truantCount: Int? = 0,
    @SerializedName("sickCount") val sickCount: Int? = 0,
    @SerializedName("permitCount") val permitCount: Int? = 0,
    @SerializedName("absentCount") val absentCount: Int? = 0,
    @SerializedName("teachingSummary") val teachingSummary: String? = null,
    @SerializedName("notes") val notes: String? = null,
    @SerializedName("room") val room: PhysicalRoomDto? = null,
    @SerializedName("studentAttendances") val studentAttendances: List<StudentSubjectAttendanceDto>? = null
)

data class PhysicalRoomDto(
    @SerializedName("id") val id: String,
    @SerializedName("roomCode") val roomCode: String,
    @SerializedName("roomName") val roomName: String,
    @SerializedName("nfcTagUid") val nfcTagUid: String? = null,
    @SerializedName("qrSecretToken") val qrSecretToken: String? = null,
    @SerializedName("className") val className: String? = null,
    @SerializedName("building") val building: String? = null,
    @SerializedName("floor") val floor: Int? = 1,
    @SerializedName("isActive") val isActive: Boolean? = true
)

data class StudentSubjectAttendanceDto(
    @SerializedName("id") val id: String,
    @SerializedName("sessionId") val sessionId: String,
    @SerializedName("studentId") val studentId: String,
    @SerializedName("status") var status: String, // PRESENT, TRUANT, SICK, PERMISSION, ABSENT, NOT_CHECKED_IN
    @SerializedName("morningGateStatus") val morningGateStatus: String? = null,
    @SerializedName("isLockedByGate") val isLockedByGate: Boolean? = false,
    @SerializedName("isSelfAttended") val isSelfAttended: Boolean? = false,
    @SerializedName("isApprovedByBk") val isApprovedByBk: Boolean? = false,
    @SerializedName("canTeacherEdit") val canTeacherEdit: Boolean? = true,
    @SerializedName("notes") var notes: String? = null,
    @SerializedName("markedAt") val markedAt: String? = null,
    @SerializedName("student") val student: StudentBriefDto? = null
)

data class LingeringSessionDto(
    @SerializedName("id") val id: String,
    @SerializedName("roomName") val roomName: String? = null,
    @SerializedName("className") val className: String? = null,
    @SerializedName("subjectName") val subjectName: String? = null,
    @SerializedName("checkInTime") val checkInTime: String? = null,
    @SerializedName("startTimeStr") val startTimeStr: String? = null
)

data class TargetRoomDto(
    @SerializedName("id") val id: String,
    @SerializedName("roomName") val roomName: String? = null,
    @SerializedName("className") val className: String? = null
)

data class TeacherCurrentSessionResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("hasActiveSession") val hasActiveSession: Boolean,
    @SerializedName("session") val session: TeachingSessionDto? = null,
    @SerializedName("message") val message: String? = null
)

data class TeacherCheckOutRequest(
    @SerializedName("sessionId") val sessionId: String? = null,
    @SerializedName("teachingSummary") val teachingSummary: String? = null,
    @SerializedName("notes") val notes: String? = null
)

data class TeacherUpdateAttendanceRequest(
    @SerializedName("studentId") val studentId: String,
    @SerializedName("status") val status: String,
    @SerializedName("notes") val notes: String? = null
)

data class PhysicalRoomsListResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("data") val data: List<PhysicalRoomDto>? = null,
    @SerializedName("message") val message: String? = null
)
