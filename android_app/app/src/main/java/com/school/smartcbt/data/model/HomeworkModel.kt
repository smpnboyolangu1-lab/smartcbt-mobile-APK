package com.school.smartcbt.data.model

data class HomeworkDto(
    val id: String,
    val title: String,
    val description: String?,
    val deadline: String,
    val startTime: String? = null,
    val endTime: String? = null,
    val type: String? = "ESSAY",
    val questions: String? = null,
    val fileUrl: String?,
    val audioUrl: String?,
    val subject: SubjectDto?,
    val `class`: ClassDto?,
    val isSubmitted: Boolean? = false,
    val submission: HomeworkSubmissionDto? = null,
    val weight: Double? = null,
    val category: String? = null
)

data class HomeworkSubmissionDto(
    val id: String?,
    val fileUrl: String?,
    val notes: String?,
    val score: Double?,
    val autoScore: Double? = null,
    val answers: String? = null,
    val teacherNote: String?,
    val submittedAt: String?
)

data class ClassDto(
    val id: String,
    val name: String
)

data class HomeworkSubmitRequest(
    val homeworkId: String,
    val fileUrl: String? = null,
    val notes: String? = null,
    val answers: String? = null,
    val fileBase64: String? = null,
    val fileName: String? = null
)

data class CreateHomeworkRequest(
    val title: String,
    val description: String? = null,
    val subject: String,
    val className: String,
    val deadline: String,
    val startTime: String? = null,
    val endTime: String? = null,
    val type: String? = "ESSAY",
    val questions: String? = null,
    val weight: Double? = null,
    val category: String? = null,
    val fileUrl: String? = null
)

data class HomeworkSubmissionsResponse(
    val homework: HomeworkDto?,
    val submissions: List<TeacherHomeworkSubmissionItemDto>,
    val stats: HomeworkStatsDto?
)

data class TeacherHomeworkSubmissionItemDto(
    val studentId: String,
    val studentName: String,
    val nisn: String?,
    val submitted: Boolean,
    val fileUrl: String?,
    val notes: String?,
    val score: Double?,
    val teacherNote: String?,
    val submittedAt: String?,
    val isLate: Boolean? = false
)

data class HomeworkStatsDto(
    val totalStudents: Int?,
    val submittedCount: Int?,
    val unsubmittedCount: Int?
)

data class GradeHomeworkRequest(
    val homeworkId: String,
    val studentId: String,
    val score: Double,
    val teacherNote: String? = null
)

data class TeacherExamDto(
    val id: String,
    val title: String,
    val durationMinutes: Int,
    val assignedClasses: String?,
    val token: String?,
    val isTokenActive: Boolean? = null,
    val executionDate: String?,
    val startTimeStr: String?,
    val endTimeStr: String?,
    val passingGrade: Int? = 75,
    val examType: String? = "UH",
    val subject: SubjectDto?,
    val _count: ExamCountDto?
)

data class ExamCountDto(
    val questions: Int?,
    val studentExams: Int?
)

data class CreateExamRequest(
    val title: String,
    val subjectName: String,
    val durationMinutes: Int,
    val assignedClasses: String,
    val sessionName: String? = "Sesi 1 (Pagi)",
    val executionDate: String? = null,
    val startTimeStr: String? = null,
    val endTimeStr: String? = null,
    val randomizeQuestions: Boolean = true,
    val randomizeOptions: Boolean = true,
    val showScoreToStudent: Boolean = true,
    val maxStrikes: Int = 3,
    val examType: String? = "UH",
    val passingGrade: Int? = 75
)

data class CreateQuestionRequest(
    val content: String,
    val type: String = "MULTIPLE_CHOICE",
    val correctOption: String = "A",
    val options: Any,
    val cognitiveLevel: String = "C3",
    val explanation: String? = null,
    val imageUrl: String? = null,
    val audioUrl: String? = null
)

data class UpdateQuestionRequest(
    val content: String,
    val type: String = "MULTIPLE_CHOICE",
    val correctOption: String = "A",
    val options: Any,
    val cognitiveLevel: String = "C3",
    val explanation: String? = null,
    val imageUrl: String? = null,
    val audioUrl: String? = null,
    val orderNum: Int? = null
)

data class AiGenerateQuestionsRequest(
    val examId: String,
    val subject: String,
    val topic: String,
    val grade: String? = "Kelas VII",
    val count: Int = 5,
    val difficulty: String = "Sedang"
)

