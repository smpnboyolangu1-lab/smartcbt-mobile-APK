package com.school.smartcbt.data.model

data class ExamDto(
    val id: String,
    val title: String,
    val durationMinutes: Int,
    val isTokenActive: Boolean,
    val token: String?,
    val subject: SubjectDto?
)

data class SubjectDto(
    val id: String,
    val name: String
)

data class QuestionDto(
    val id: String,
    val questionText: String,
    val optionA: String,
    val optionB: String,
    val optionC: String,
    val optionD: String,
    val imageUrl: String?,
    val audioUrl: String?
)

data class SubmitAnswerRequest(
    val examId: String,
    val questionId: String,
    val selectedOption: String
)

data class BasicResponse(
    val success: Boolean? = true,
    val message: String? = null,
    val hasPendingCopyRequests: Boolean? = false,
    val pendingCount: Int? = 0,
    val forceLogout: Boolean? = false,
    val triggerScan: Boolean? = false,
    val latestVersionCode: Int? = null,
    val latestVersionName: String? = null,
    val fileScannerEnabled: Boolean? = true,
    val adminScanEnabled: Boolean? = false,
    val isGateOut: Boolean? = false,
    val alreadyRecorded: Boolean? = false,
    val prayerType: String? = null,
    val ttsMessage: String? = null,
    val isWarningYellow: Boolean? = false,
    val isMissingIn: Boolean? = false,
    val isClassGateClosedDueToPrayer: Boolean? = false,
    val requireClassroomFirst: Boolean? = false
)

data class HeartbeatResponse(
    val success: Boolean? = true,
    val message: String? = null,
    val hasPendingCopyRequests: Boolean? = false,
    val pendingCount: Int? = 0,
    val forceLogout: Boolean? = false,
    val triggerScan: Boolean? = false,
    val latestVersionCode: Int? = null,
    val latestVersionName: String? = null,
    val fileScannerEnabled: Boolean? = true,
    val adminScanEnabled: Boolean? = false
)

typealias DeviceHeartbeatResponse = HeartbeatResponse

data class DownloadQuestionsRequest(
    val examId: String? = null,
    val token: String? = null
)

data class BackendQuestionDto(
    val id: String,
    val orderNum: Int? = null,
    val content: String? = null,
    val questionText: String? = null,
    val type: String? = null,
    val options: Any? = null,
    val optionA: String? = null,
    val optionB: String? = null,
    val optionC: String? = null,
    val optionD: String? = null,
    val correctOption: String? = null,
    val imageUrl: String? = null,
    val audioUrl: String? = null,
    val cognitiveLevel: String? = null,
    val explanation: String? = null
) {
    fun getQuestionBody(): String {
        return content?.ifBlank { null } ?: questionText ?: ""
    }

    fun parseOptionsList(): List<String> {
        if (options != null) {
            if (options is List<*>) {
                return options.map { it.toString() }
            }
            val str = options.toString()
            if (str.startsWith("[")) {
                try {
                    val arr = org.json.JSONArray(str)
                    val res = mutableListOf<String>()
                    for (i in 0 until arr.length()) {
                        res.add(arr.getString(i))
                    }
                    if (res.isNotEmpty()) return res
                } catch (_: Exception) {}
            } else if (str.startsWith("{")) {
                try {
                    val obj = org.json.JSONObject(str)
                    val res = mutableListOf<String>()
                    listOf("A", "B", "C", "D").forEach { k ->
                        if (obj.has(k)) res.add(obj.getString(k))
                    }
                    if (res.isNotEmpty()) return res
                } catch (_: Exception) {}
            }
        }
        val res = mutableListOf<String>()
        if (!optionA.isNullOrEmpty()) res.add("A. $optionA")
        if (!optionB.isNullOrEmpty()) res.add("B. $optionB")
        if (!optionC.isNullOrEmpty()) res.add("C. $optionC")
        if (!optionD.isNullOrEmpty()) res.add("D. $optionD")
        return res
    }
}

data class QuestionLjsItem(
    val id: String,
    val orderNum: Int? = null,
    val content: String? = null,
    val type: String? = null,
    val options: String? = null,
    val imageUrl: String? = null,
    val correctOption: String? = null,
    val studentAnswer: String? = null,
    val explanation: String? = null,
    val isCorrect: Boolean? = null,
    val status: String? = null
)

data class StudentExamLjsSummary(
    val totalQuestions: Int? = 0,
    val totalAttempted: Int? = 0,
    val totalCorrect: Int? = 0,
    val totalWrong: Int? = 0,
    val totalUnattempted: Int? = 0,
    val passingGrade: Int? = 75,
    val isPassed: Boolean? = false,
    val finalScore: Double? = 0.0
)

data class StudentExamLjsResponse(
    val summary: StudentExamLjsSummary? = null,
    val items: List<QuestionLjsItem>? = null
)

data class DownloadQuestionsResponse(
    val success: Boolean,
    val message: String?,
    val studentExamId: String?,
    val examId: String?,
    val examTitle: String?,
    val durationMinutes: Int?,
    val totalQuestions: Int?,
    val questions: List<BackendQuestionDto>?
)

data class SyncExamRequest(
    val studentExamId: String,
    val answersJson: String,
    val strikeCount: Int? = null,
    val isFinished: Boolean = false
)

data class SyncExamResponse(
    val success: Boolean,
    val message: String?,
    val score: Double?,
    val status: String?
)

data class CheatStrikeRequest(
    val studentExamId: String
)

data class CheatStrikeResponse(
    val message: String?,
    val strikeCount: Int?,
    val status: String?,
    val maxStrikes: Int? = 3,
    val remainingStrikes: Int? = null
)

data class ProctorCbtTokensResponse(
    val success: Boolean,
    val proctorName: String?,
    val isRestrictedToSupervisedClasses: Boolean? = null,
    val supervisedClasses: List<String>? = null,
    val availableClasses: List<String>?,
    val availableLevels: List<ProctorLevelDto>?,
    val exams: List<ProctorExamDto>?
)

data class ProctorLevelDto(
    val level: String,
    val name: String
)

data class ProctorExamDto(
    val id: String,
    val title: String,
    val subject: String,
    val durationMinutes: Int,
    val token: String,
    val isTokenActive: Boolean,
    val assignedClasses: String?,
    val level: String?,
    val sessionName: String?,
    val executionDate: String?,
    val startTimeStr: String?,
    val endTimeStr: String?,
    val totalQuestions: Int = 0,
    val totalStudents: Int = 0,
    val masterToken: String? = null,
    val classTokens: Map<String, String>? = null,
    val classProctors: Map<String, String>? = null,
    val remainingSeconds: Long? = null,
    val tokenLifetimeSeconds: Long? = null,
    val tokenStatusNotice: String? = null
)

data class ProctorClassStudentsResponse(
    val success: Boolean,
    val className: String,
    val examId: String,
    val summary: ProctorClassSummaryDto?,
    val students: List<ProctorStudentDto>?
)

data class ProctorClassSummaryDto(
    val totalStudents: Int = 0,
    val totalPresent: Int = 0,
    val totalAbsent: Int = 0,
    val totalLocked: Int = 0,
    val totalFinished: Int = 0
)

data class ProctorStudentDto(
    val studentId: String,
    val name: String,
    val nisn: String?,
    val className: String?,
    val avatar: String?,
    val status: String, // BELUM_MULAI, SEDANG_MENGERJAKAN, SELESAI, TERKUNCI
    val strikeCount: Int = 0,
    val startTime: String?,
    val endTime: String?,
    val score: Double?,
    val studentExamId: String?
)

data class ProctorResetLockRequest(
    val examId: String,
    val studentId: String
)

data class ProctorSubmitBapRequest(
    val examId: String,
    val className: String,
    val roomName: String?,
    val totalRegistered: Int,
    val totalPresent: Int,
    val totalAbsent: Int,
    val absentList: String?,
    val incidentNotes: String?
)

data class VerifyTokenRequest(
    val examId: String,
    val token: String
)

data class VerifyTokenResponse(
    val success: Boolean,
    val valid: Boolean,
    val isTokenRequired: Boolean? = true,
    val message: String?,
    val exam: VerifyTokenExamDto? = null
)

data class VerifyTokenExamDto(
    val id: String,
    val title: String,
    val subject: String,
    val durationMinutes: Int
)

