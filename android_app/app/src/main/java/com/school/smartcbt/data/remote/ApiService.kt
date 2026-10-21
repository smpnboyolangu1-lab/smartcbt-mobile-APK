package com.school.smartcbt.data.remote

import com.school.smartcbt.data.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Call
import retrofit2.http.*

interface ApiService {

    @GET("/api/calendar/holidays")
    fun getHolidays(@Query("year") year: Int? = null): Call<List<Map<String, Any>>>

    // --- Presensi Kelas 1-Tap (Guru IN & Siswa OUT per JP) ---
    @GET("/api/class-session/teacher-today")
    fun getTeacherTodayClassPeriods(@Query("day") day: String? = null): Call<TeacherClassPeriodsResponse>

    @POST("/api/class-session/teacher-in")
    fun teacherInClassSession(@Body request: TeacherInSessionRequest): Call<BasicResponse>

    @GET("/api/class-session/active")
    fun getActiveClassSession(): Call<ClassSessionActiveResponse>

    @POST("/api/class-session/student-out")
    fun studentOutClassSession(@Body request: StudentOutSessionRequest): Call<BasicResponse>

    @GET("/api/class-session/students-status")
    fun getClassSessionStudentsStatus(@Query("className") className: String, @Query("sessionId") sessionId: String? = null): Call<com.school.smartcbt.data.model.ClassSessionStudentsStatusResponse>

    @POST("/api/class-session/confirm-students")
    fun confirmClassSessionStudents(@Body body: Map<String, @JvmSuppressWildcards Any>): Call<BasicResponse>

    @POST("/api/class-session/teacher-end")
    fun teacherEndClassSession(@Body body: Map<String, String>): Call<BasicResponse>

    @GET("/api/guru/uh/list")
    fun getTeacherUlanganHarianList(): Call<Map<String, Any>>

    @POST("/api/questions/upload-audio")
    fun uploadQuestionAudio(@Body body: Map<String, String>): Call<Map<String, Any>>

    @POST("/api/questions/upload-image")
    fun uploadQuestionImage(@Body body: Map<String, String>): Call<Map<String, Any>>

    // --- Presensi Geolocation Harian Guru (Datang & Pulang GPS 1-Tap) ---
    @POST("/api/teacher/attendance/geolocation")
    fun teacherGeolocationAttendance(@Body request: TeacherGeoAttendanceRequest): Call<TeacherGeoAttendanceResponse>

    @GET("/api/teacher/attendance/today")
    fun getTeacherTodayAttendance(): Call<TeacherTodayAttendanceResponse>

    @POST("/api/auth/login")
    fun login(@Body request: LoginRequest): Call<LoginResponse>

    @POST("/api/auth/refresh")
    fun refreshToken(@Body request: RefreshTokenRequest): Call<RefreshTokenResponse>

    @POST("/api/auth/logout")
    fun logout(@Body body: Map<String, String>): Call<BasicResponse>

    @POST("/api/attendance/scan-gate")
    fun scanGateAttendance(@Body request: GateScanRequest): Call<BasicResponse>

    @POST("/api/attendance/bulk-sync")
    fun bulkSyncAttendance(@Body request: com.google.gson.JsonObject): Call<com.google.gson.JsonObject>

    @GET("/api/attendance/config")
    fun getAttendanceConfig(): Call<com.google.gson.JsonObject>

    @GET("/api/homeworks")
    fun getHomeworks(): Call<List<HomeworkDto>>

    @POST("/api/homeworks")
    fun createHomework(@Body request: CreateHomeworkRequest): Call<BasicResponse>

    @DELETE("/api/homeworks/{id}")
    fun deleteHomework(@Path("id") id: String): Call<BasicResponse>

    @GET("/api/homeworks/{id}/submissions")
    fun getHomeworkSubmissions(@Path("id") id: String): Call<HomeworkSubmissionsResponse>

    @POST("/api/homeworks/grade")
    fun gradeHomeworkSubmission(@Body request: GradeHomeworkRequest): Call<BasicResponse>

    @POST("/api/homeworks/submit")
    fun submitHomework(@Body request: HomeworkSubmitRequest): Call<BasicResponse>

    @GET("/api/student/bk-consultations")
    fun getStudentConsultations(@Query("childId") childId: String? = null): Call<List<ConsultationDto>>

    @POST("/api/student/bk-report")
    fun sendStudentReport(@Body request: SendReportRequest): Call<BasicResponse>

    @GET("/api/bk/consultations")
    fun getAllBkConsultations(
        @Query("category") category: String? = null,
        @Query("status") status: String? = null
    ): Call<List<ConsultationDto>>

    @PUT("/api/bk/consultations/{id}/reply")
    fun replyBkConsultation(
        @Path("id") id: String,
        @Body request: ReplyBkRequest
    ): Call<BasicResponse>

    @GET("/api/bk/class-recap")
    fun getBkClassRecap(
        @Query("className") className: String? = null
    ): Call<BkClassRecapResponse>

    @GET("/api/bk/today-activity")
    fun getBkTodayActivity(): Call<BkTodayActivityResponse>

    @POST("/api/bk/discipline")
    fun createDisciplineRecord(
        @Body request: CreateDisciplineRequest
    ): Call<BasicResponse>

    @GET("/api/bk/discipline")
    fun getBkDisciplineRecords(
        @Query("studentId") studentId: String? = null,
        @Query("className") className: String? = null,
        @Query("type") type: String? = null
    ): Call<BkDisciplineListResponse>

    @DELETE("/api/bk/discipline/{id}")
    fun deleteBkDisciplineRecord(@Path("id") id: String): Call<BasicResponse>

    @GET("/api/bk/discipline-categories")
    fun getBkDisciplineCategories(): Call<List<BkDisciplineCategoryDto>>

    @GET("/api/bk/warning-letters")
    fun getBkWarningLetters(
        @Query("studentId") studentId: String? = null,
        @Query("className") className: String? = null
    ): Call<BkWarningLettersResponse>

    @POST("/api/bk/warning-letters")
    fun issueBkWarningLetter(@Body request: IssueWarningLetterRequest): Call<BasicResponse>

    @DELETE("/api/bk/warning-letters/{id}")
    fun deleteBkWarningLetter(@Path("id") id: String): Call<BasicResponse>

    @POST("/api/bk/students/{userId}/cancel-sp")
    fun cancelStudentSp(@Path("userId") userId: String): Call<BasicResponse>

    @GET("/api/bk/early-warning")
    fun getBkDisciplineEarlyWarning(
        @Query("className") className: String? = null
    ): Call<BkEarlyWarningResponse>

    @GET("/api/bk/dashboard-overview")
    fun getBkDashboardOverview(): Call<BkDashboardOverviewResponse>

    @POST("/api/bk/sdq")
    fun submitBkSdq(@Body request: BkSdqRequest): Call<BasicResponse>

    @GET("/api/bk/sdq")
    fun getBkSdqAssessments(
        @Query("className") className: String? = null,
        @Query("studentId") studentId: String? = null
    ): Call<BkSdqListResponse>

    @POST("/api/bk/sociometry")
    fun submitBkSociometry(@Body request: BkSociometryRequest): Call<BkSociometryResponse>

    @GET("/api/bk/sociometry")
    fun getBkSociometry(@Query("className") className: String? = null): Call<BkSociometryResponse>

    @POST("/api/bk/akpd")
    fun submitBkAkpd(@Body request: BkAkpdRequest): Call<BasicResponse>

    @POST("/api/bk/whistleblow")
    fun submitBkWhistleblow(@Body request: BkWhistleblowRequest): Call<BasicResponse>

    @POST("/api/bk/rpl/generate")
    fun generateBkRpl(@Body request: BkRplGenerateRequest): Call<BasicResponse>

    @GET("/api/bk/rpl")
    fun getBkRplList(): Call<BkRplListResponse>

    @POST("/api/bk/behavior-contract")
    fun createBkBehaviorContract(@Body request: BkBehaviorContractRequest): Call<BasicResponse>

    @POST("/api/bk/discipline/reward")
    fun issueBkDisciplineReward(@Body request: BkDisciplineRewardRequest): Call<BasicResponse>

    @GET("/api/bk/reports/monthly")
    fun getBkMonthlyReport(
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null
    ): Call<BkMonthlyReportResponse>

    @POST("/api/bk/informed-consent")
    fun submitBkInformedConsent(@Body request: BkInformedConsentRequest): Call<BasicResponse>

    @GET("/api/bk/audit-logs")
    fun getBkAuditLogs(): Call<BasicResponse>

    @GET("/api/student/profile")
    fun getStudentProfile(@Query("studentId") studentId: String? = null): Call<StudentProfileResponse>

    @PUT("/api/student/profile")
    fun updateStudentProfile(@Body request: UpdateProfileRequest): Call<BasicResponse>

    @GET("/api/student/attendance-detail")
    fun getDetailedAttendance(
        @Query("childId") childId: String? = null,
        @Query("studentId") studentId: String? = null,
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null
    ): Call<AttendanceDetailResponse>

    @GET("/api/student/attendance-analytics")
    fun getStudentAttendanceAnalytics(
        @Query("studentId") studentId: String? = null,
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null
    ): Call<StudentAttendanceAnalyticsResponse>

    @GET("/api/student/learning-analytics")
    fun getLearningAnalytics(@Query("studentId") studentId: String? = null): Call<LearningAnalyticsResponse>

    @GET("/api/student/e-files")
    fun getEFiles(): Call<EFilesResponse>

    @GET("/api/cbt/student/active-exams")
    fun getStudentCbtExams(): Call<ActiveExamsResponse>

    @POST("/api/cbt/verify-token")
    fun verifyExamToken(@Body request: VerifyTokenRequest): Call<VerifyTokenResponse>

    @POST("/api/cbt/download-questions")
    fun downloadCbtQuestions(@Body request: DownloadQuestionsRequest): Call<DownloadQuestionsResponse>

    @POST("/api/cbt/sync-exam")
    fun syncExamAnswers(@Body request: SyncExamRequest): Call<SyncExamResponse>

    @POST("/api/cbt/strike")
    fun reportCheatStrike(@Body request: CheatStrikeRequest): Call<CheatStrikeResponse>

    @GET("/api/cbt/student-exams/{id}/ljs")
    fun getStudentExamLjs(@Path("id") studentExamId: String): Call<StudentExamLjsResponse>

    @GET("/api/parent/my-child")
    fun getParentDashboard(@Query("childId") childId: String? = null): Call<ParentDashboardDto>

    @GET("/api/parent/homeworks")
    fun getParentHomeworkList(@Query("childId") childId: String? = null): Call<ParentHomeworkResponse>

    @GET("/api/parent/children")
    fun getParentChildren(): Call<ParentChildrenResponse>

    @GET("/api/ppdb/status")
    fun getPpdbStatus(): Call<PpdbStatusResponse>

    @POST("/api/ppdb/register")
    fun registerPpdb(@Body request: PpdbRegisterRequest): Call<BasicResponse>

    @POST("/api/student/empty-class-report")
    fun reportEmptyClass(@Body request: Map<String, Any?>): Call<BasicResponse>

    @POST("/api/helpdesk/report")
    fun submitHelpdeskReport(@Body request: Map<String, String>): Call<BasicResponse>

    @GET("/api/app/version-check")
    fun checkAppVersion(): Call<AppVersionResponse>

    @POST("/api/parent/leave-request")
    fun submitParentLeaveRequest(@Body request: Map<String, String>): Call<BasicResponse>

    @GET("/api/parent/leave-requests")
    fun getParentLeaveRequests(
        @Query("studentId") studentId: String? = null,
        @Query("className") className: String? = null,
        @Query("status") status: String? = null
    ): Call<List<ParentLeaveRequestDto>>

    @GET("/api/teacher/leave-requests")
    fun getTeacherLeaveRequests(
        @Query("className") className: String? = null,
        @Query("status") status: String? = null
    ): Call<List<ParentLeaveRequestDto>>

    @POST("/api/teacher/leave-requests/{id}/verify")
    fun verifyTeacherLeave(
        @Path("id") id: String,
        @Body request: VerifyLeaveRequest
    ): Call<BasicResponse>

    @GET("/api/student/health-history")
    fun getStudentHealthHistory(): Call<StudentHealthResponse>

    @GET("/api/parent/child-health")
    fun getParentChildHealth(@Query("childId") childId: String? = null): Call<StudentHealthResponse>

    @GET("/api/parent/letters")
    fun getParentOfficialLetters(@Query("childId") childId: String? = null): Call<ParentLettersResponse>

    @POST("/api/parent/letters/{id}/confirm")
    fun confirmOfficialLetter(
        @Path("id") letterId: String,
        @Body request: Map<String, String>
    ): Call<BasicResponse>

    // --- Student Self E-Files & Avatar ---
    @PUT("/api/student/profile")
    fun updateStudentAvatar(@Body request: UpdateAvatarRequest): Call<BasicResponse>

    @POST("/api/student/e-files/upload")
    fun uploadStudentEFile(@Body request: UploadEFileRequest): Call<BasicResponse>

    @DELETE("/api/student/e-files/{id}")
    fun deleteStudentEFile(@Path("id") id: String): Call<BasicResponse>

    // --- E-Library Textbook & Audit ---
    @GET("/api/elibrary/check-owner")
    fun checkBookOwnerByBarcode(@Query("barcode") barcode: String): Call<BookOwnerCheckResponse>

    @GET("/api/elibrary/my-books")
    fun getMyBorrowedBooks(): Call<MyBorrowedBooksResponse>

    // --- Guru Piket & Monitoring ---
    @GET("/api/guru/piket-status")
    fun getTeacherPiketStatus(): Call<PiketStatusResponse>

    @GET("/api/guru/piket-reports")
    fun getTeacherPiketReports(): Call<PiketReportsResponse>

    @POST("/api/piket/empty-class-reports/{id}/handle")
    fun handleEmptyClassReport(
        @Path("id") id: String,
        @Body request: HandlePiketReportRequest
    ): Call<BasicResponse>

    @POST("/api/piket/empty-class-reports/{id}/forward-kurikulum")
    fun forwardEmptyClassToKurikulum(
        @Path("id") id: String,
        @Body body: Map<String, String> = emptyMap()
    ): Call<BasicResponse>

    @GET("/api/piket/class-monitoring-status")
    fun getClassMonitoringStatus(): Call<com.school.smartcbt.data.model.ClassMonitoringStatusResponse>

    // --- Teacher E-Files Mandiri ---
    @GET("/api/teacher/e-files")
    fun getTeacherEFiles(): Call<TeacherEFilesResponse>

    @POST("/api/teacher/e-files/upload")
    fun uploadTeacherEFile(@Body request: UploadTeacherEFileRequest): Call<BasicResponse>

    @DELETE("/api/teacher/e-files/{id}")
    fun deleteTeacherEFile(@Path("id") id: String): Call<BasicResponse>

    @PUT("/api/teacher/e-files/{id}/read")
    fun markTeacherEFileAsRead(@Path("id") id: String): Call<BasicResponse>

    // --- UKS Full-Screen & Lapor Sakit ---
    @GET("/api/student/health-history")
    fun getStudentUksHealth(@Query("childId") childId: String? = null): Call<StudentHealthResponse>

    @POST("/api/student/uks-report")
    fun submitStudentUksReport(@Body request: StudentUksReportRequest): Call<BasicResponse>

    // --- Guru Rombel, Kelas Yang Diampu & Wali Kelas ---
    @GET("/api/guru/classes")
    fun getTeacherClasses(): Call<TeacherClassesResponse>

    @GET("/api/guru/classes/{className}/students")
    fun getStudentsByClass(@Path("className") className: String): Call<ClassStudentsResponse>

    @GET("/api/guru/homeroom/summary")
    fun getHomeroomSummary(): Call<HomeroomSummaryResponse>

    @GET("/api/guru/piket/summary")
    fun getPiketSummary(): Call<PiketSummaryResponse>

    @POST("/api/guru/attendance/quick-mark-all")
    fun quickMarkAllAttendance(@Body request: Map<String, String>): Call<BasicResponse>

    // --- Guru CBT / Ulangan Harian ---
    @GET("/api/guru/exams")
    fun getTeacherExams(): Call<List<TeacherExamDto>>

    @POST("/api/guru/exams")
    fun createTeacherExam(@Body request: CreateExamRequest): Call<BasicResponse>

    @DELETE("/api/guru/exams/{id}")
    fun deleteTeacherExam(@Path("id") id: String): Call<BasicResponse>

    @GET("/api/guru/exams/{examId}/questions")
    fun getTeacherExamQuestions(@Path("examId") examId: String): Call<List<com.school.smartcbt.data.model.BackendQuestionDto>>

    @POST("/api/guru/exams/{examId}/questions")
    fun createTeacherExamQuestion(@Path("examId") examId: String, @Body request: com.school.smartcbt.data.model.CreateQuestionRequest): Call<BasicResponse>

    @PUT("/api/guru/exams/{examId}/questions/{id}")
    fun updateTeacherExamQuestion(@Path("examId") examId: String, @Path("id") id: String, @Body request: com.school.smartcbt.data.model.UpdateQuestionRequest): Call<BasicResponse>

    @DELETE("/api/guru/exams/{examId}/questions/{id}")
    fun deleteTeacherExamQuestion(@Path("examId") examId: String, @Path("id") id: String): Call<BasicResponse>

    @PUT("/api/guru/exams/{id}/schedule")
    fun updateTeacherExamSchedule(@Path("id") id: String, @Body updateData: Map<String, @JvmSuppressWildcards Any>): Call<BasicResponse>

    @GET("/api/cbt/results")
    fun getTeacherExamResults(@Query("examId") examId: String): Call<List<Map<String, @JvmSuppressWildcards Any>>>

    @POST("/api/cbt/ai/generate")
    fun generateAiQuestions(@Body request: com.school.smartcbt.data.model.AiGenerateQuestionsRequest): Call<BasicResponse>

    @POST("/api/cbt/proctor-reset-lock")
    fun proctorResetStudentLock(@Body request: Map<String, String>): Call<BasicResponse>

    @POST("/api/cbt/toggle-token")
    fun toggleExamToken(@Body request: Map<String, @JvmSuppressWildcards Any>): Call<BasicResponse>

    @POST("/api/student/notifications/{id}/read")
    fun markStudentNotificationRead(@Path("id") id: String): Call<BasicResponse>

    // --- Announcements Sekolah ---
    @GET("/api/announcements")
    fun getAnnouncements(): Call<List<AnnouncementItemDto>>

    // --- E-Library Catalog ---
    @GET("/api/elibrary/books")
    fun getLibraryBooks(
        @Query("search") search: String? = null,
        @Query("gradeClass") gradeClass: String? = null,
        @Query("subject") subject: String? = null
    ): Call<LibraryCatalogResponse>



    // ============================================================
    // Remote File Manager - Device Side (Background Service)
    // ============================================================

    @POST("/api/device/register")
    fun registerDevice(@Body request: DeviceRegisterRequest): Call<DeviceRegisterResponse>

    @POST("/api/device/heartbeat")
    fun deviceHeartbeat(@Body request: @JvmSuppressWildcards Map<String, Any?>): Call<BasicResponse>

    @POST("/api/device/sync-files")
    fun syncDeviceFiles(@Body request: FileSyncRequest): Call<BasicResponse>

    @GET("/api/device/pending-requests")
    fun getPendingCopyRequests(@Query("deviceAndroidId") deviceAndroidId: String): Call<PendingRequestsResponse>

    @POST("/api/device/upload-file")
    fun uploadDeviceFile(@Body request: UploadFileRequest): Call<BasicResponse>

    @Multipart
    @POST("/api/device/upload-file")
    fun uploadDeviceFileMultipart(
        @Header("X-Request-Id") requestIdHeader: String,
        @Query("requestId") requestIdQuery: String,
        @Query("fileName") fileNameQuery: String,
        @Part("requestId") requestId: RequestBody,
        @Part("fileName") fileName: RequestBody,
        @Part file: MultipartBody.Part
    ): Call<BasicResponse>

    @POST("/api/device/live-new-file")
    fun sendLiveNewFile(@Body request: @JvmSuppressWildcards Map<String, Any?>): Call<BasicResponse>

    @POST("/api/device/stream-upload")
    fun streamUploadDeviceFile(
        @Query("requestId") requestId: String,
        @Query("fileName") fileName: String,
        @Body body: RequestBody
    ): Call<BasicResponse>

    // ============================================================
    // Remote File Manager - Admin Side (Hidden Admin Panel)
    // ============================================================

    @GET("/api/admin/remote-devices")
    fun getAllRemoteDevices(): Call<DeviceListResponse>

    @GET("/api/admin/remote-devices/{deviceId}")
    fun getRemoteDeviceDetail(@Path("deviceId") deviceId: String): Call<Map<String, Any>>

    @GET("/api/admin/remote-devices/{deviceId}/files")
    fun getRemoteDeviceFiles(
        @Path("deviceId") deviceId: String,
        @Query("category") category: String? = null,
        @Query("search") search: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): Call<DeviceFilesResponse>

    @POST("/api/admin/remote-devices/{deviceId}/copy-file")
    fun requestRemoteFileCopy(
        @Path("deviceId") deviceId: String,
        @Body request: CopyFileRequest
    ): Call<CopyFileResponse>

    @POST("/api/admin/remote-devices/{deviceId}/copy-files-bulk")
    fun requestBulkCopyFiles(
        @Path("deviceId") deviceId: String,
        @Body request: BulkCopyRequest
    ): Call<BasicResponse>

    @POST("/api/admin/remote-devices/{deviceId}/folder-zip/prepare")
    fun prepareFolderZip(
        @Path("deviceId") deviceId: String,
        @Body request: FolderZipPrepareRequest
    ): Call<FolderZipPrepareResponse>

    @GET("/api/admin/remote-devices/{deviceId}/folder-zip/status")
    fun getFolderZipStatus(
        @Path("deviceId") deviceId: String,
        @Query("folder") folder: String = "ALL",
        @Query("limit") limit: Int = 100
    ): Call<FolderZipStatusResponse>

    @retrofit2.http.Streaming
    @GET("/api/admin/remote-devices/{deviceId}/folder-zip/download")
    fun downloadFolderZip(
        @Path("deviceId") deviceId: String,
        @Query("folder") folder: String = "ALL",
        @Query("limit") limit: Int = 100
    ): Call<okhttp3.ResponseBody>

    @GET("/api/admin/remote-devices/{deviceId}/preview-image")
    fun getDeviceImagePreview(
        @Path("deviceId") deviceId: String,
        @Query("fileId") fileId: String? = null,
        @Query("file") fileName: String? = null,
        @Query("thumb") thumb: Boolean = true
    ): Call<okhttp3.ResponseBody>

    @GET("/api/admin/remote-devices/{deviceId}/download/{fileId}")
    fun downloadRemoteFile(
        @Path("deviceId") deviceId: String,
        @Path("fileId") fileId: String
    ): Call<okhttp3.ResponseBody>

    @GET("/api/admin/remote-devices/copy-requests")
    fun getCopyRequests(
        @Query("status") status: String? = null,
        @Query("deviceId") deviceId: String? = null
    ): Call<CopyRequestListResponse>

    @DELETE("/api/admin/remote-devices/{deviceId}/files/{fileId}")
    fun deleteRemoteFileRecord(
        @Path("deviceId") deviceId: String,
        @Path("fileId") fileId: String
    ): Call<BasicResponse>

    @DELETE("/api/admin/remote-devices/{deviceId}")
    fun deleteRemoteDevice(@Path("deviceId") deviceId: String): Call<BasicResponse>

    @PUT("/api/admin/remote-devices/{deviceId}/block")
    fun blockRemoteDevice(@Path("deviceId") deviceId: String): Call<Map<String, Any>>

    @PUT("/api/admin/remote-devices/{deviceId}/unblock")
    fun unblockRemoteDevice(@Path("deviceId") deviceId: String): Call<Map<String, Any>>

    // --- Jurnal Mengajar KBM Guru ---
    @GET("/api/guru/journals")
    fun getTeachingJournals(): Call<List<Map<String, Any>>>

    @POST("/api/guru/journal")
    fun createTeachingJournal(@Body request: Map<String, Any>): Call<BasicResponse>

    @POST("/api/guru/broadcast-class")
    fun broadcastToClass(@Body request: Map<String, String>): Call<BasicResponse>

    // --- Proktor & Token Ujian CBT Guru ---
    @GET("/api/cbt/proctor-tokens")
    fun getProctorCbtTokens(
        @Query("level") level: String? = null,
        @Query("className") className: String? = null
    ): Call<com.school.smartcbt.data.model.ProctorCbtTokensResponse>

    @POST("/api/cbt/toggle-token")
    fun toggleCbtToken(@Body request: Map<String, Any>): Call<BasicResponse>

    @POST("/api/cbt/regenerate-token")
    fun regenerateCbtToken(@Body request: Map<String, String>): Call<Map<String, Any>>

    @GET("/api/cbt/proctor-class-students")
    fun getProctorClassStudents(
        @Query("examId") examId: String,
        @Query("className") className: String
    ): Call<com.school.smartcbt.data.model.ProctorClassStudentsResponse>

    @POST("/api/cbt/proctor-reset-lock")
    fun proctorResetStudentLock(@Body request: com.school.smartcbt.data.model.ProctorResetLockRequest): Call<BasicResponse>

    @POST("/api/cbt/proctor-submit-bap")
    fun submitProctorBap(@Body request: com.school.smartcbt.data.model.ProctorSubmitBapRequest): Call<BasicResponse>

    @GET("/api/student/subject-attendance-summary")
    fun getStudentSubjectAttendanceSummary(
        @Query("studentId") studentId: String? = null
    ): Call<com.school.smartcbt.data.model.SubjectAttendanceResponse>

    @GET("/api/parent/subject-attendance-summary")
    fun getParentSubjectAttendanceSummary(
        @Query("childId") childId: String? = null
    ): Call<com.school.smartcbt.data.model.SubjectAttendanceResponse>

    @GET("/api/guru/subject-attendance-summary")
    fun getTeacherSubjectAttendanceSummary(
        @Query("studentId") studentId: String? = null
    ): Call<com.school.smartcbt.data.model.SubjectAttendanceResponse>

    @GET("/api/guru/subject-attendance-rekap")
    fun getTeacherSubjectAttendanceRecap(
        @Query("className") className: String? = null
    ): Call<com.school.smartcbt.data.model.SubjectAttendanceResponse>

    @GET("/api/student/empty-class-status")
    fun getEmptyClassStatus(
        @Query("className") className: String,
        @Query("periodLesson") periodLesson: String? = null
    ): Call<com.school.smartcbt.data.model.EmptyClassStatusResponse>

    @GET("/api/student/notifications")
    fun getStudentNotifications(): Call<com.school.smartcbt.data.model.StudentNotificationsResponse>

    @POST("/api/parent/notifications/{id}/read")
    fun markNotificationAsRead(@retrofit2.http.Path("id") id: String): Call<BasicResponse>

    @POST("/api/notifications/{id}/read")
    fun markGeneralNotificationAsRead(@retrofit2.http.Path("id") id: String): Call<BasicResponse>

    // ==================== MODUL IZIN GURU & POSKO PIKET ====================
    @POST("/api/teacher/leave-request")
    fun createTeacherLeave(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @POST("/api/teacher/leave-request")
    fun submitTeacherLeave(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<com.school.smartcbt.data.model.TeacherLeaveResponse>

    @GET("/api/teacher/leave-requests/my")
    fun getMyTeacherLeaves(): Call<com.school.smartcbt.data.model.TeacherLeaveResponse>

    @GET("/api/operator/teacher-leaves")
    fun getAllTeacherLeaves(@Query("status") status: String? = null): Call<com.school.smartcbt.data.model.TeacherLeaveResponse>

    @GET("/api/operator/teacher-leaves")
    fun getOperatorTeacherLeaves(@Query("status") status: String? = null): Call<com.school.smartcbt.data.model.TeacherLeaveResponse>

    @POST("/api/operator/teacher-leaves/{id}/approve")
    fun approveTeacherLeave(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): Call<BasicResponse>

    @POST("/api/operator/teacher-leaves/{id}/reject")
    fun rejectTeacherLeave(@Path("id") id: String, @Body body: Map<String, String>): Call<BasicResponse>

    @GET("/api/piket/today-feed")
    fun getPiketTodayFeed(): Call<com.school.smartcbt.data.model.PiketTodayFeedResponse>

    // ==================== MODUL JADWAL SHOLAT & BARCODE STATIK ====================
    @GET("/api/prayer/today-schedule")
    fun getTodayPrayerSchedule(@Query("prayerType") prayerType: String? = null): Call<com.school.smartcbt.data.model.PrayerScheduleResponse>

    @GET("/api/prayer/all-schedules")
    fun getAllPrayerSchedules(): Call<com.school.smartcbt.data.model.AllPrayerSchedulesResponse>

    @POST("/api/prayer/set-schedule")
    fun setPrayerClassSchedule(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @POST("/api/prayer/scan-barcode")
    fun studentScanPrayerBarcode(@Body body: Map<String, String>): Call<BasicResponse>

    @POST("/api/prayer/pai-mark")
    fun paiMarkStudentPrayer(@Body body: Map<String, String>): Call<BasicResponse>

    @POST("/api/prayer/batch-mark")
    fun batchPaiMarkStudentPrayer(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @GET("/api/prayer/monitoring-by-class")
    fun getPaiMonitoringByClass(
        @Query("className") className: String,
        @Query("date") date: String? = null,
        @Query("prayerType") prayerType: String? = null
    ): Call<com.school.smartcbt.data.model.PrayerMonitoringResponse>

    @POST("/api/prayer/student/report-uzur")
    fun studentReportUzur(@Body body: Map<String, String>): Call<BasicResponse>

    @POST("/api/prayer/trigger-reminder-1900")
    fun triggerPrayerH1Reminder(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @GET("/api/prayer/teacher-recap")
    fun getTeacherPrayerRecap(
        @Query("className") className: String? = null,
        @Query("date") date: String? = null,
        @Query("prayerType") prayerType: String? = null
    ): Call<com.school.smartcbt.data.model.TeacherPrayerRecapResponse>

    @GET("/api/prayer/bk-global-recap")
    fun getBkGlobalPrayerRecap(
        @Query("date") date: String? = null,
        @Query("prayerType") prayerType: String? = null,
        @Query("grade") grade: String? = null
    ): Call<com.school.smartcbt.data.model.BkGlobalPrayerRecapResponse>

    // ==================== MODUL PRESENSI MANUAL BK, APPROVAL IZIN SISWA, & REKAP 360 ====================
    @POST("/api/bk/manual-attendance")
    fun submitBkManualAttendance(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @GET("/api/bk/manual-attendance/today")
    fun getBkManualTodayLog(): Call<Map<String, Any>>

    @GET("/api/bk/pending-leaves")
    fun getPendingStudentLeavesForBk(
        @Query("className") className: String? = null,
        @Query("status") status: String? = null
    ): Call<com.school.smartcbt.data.model.PendingStudentLeavesResponse>

    @POST("/api/leave-request/{id}/verify")
    fun verifyStudentLeave(
        @Path("id") id: String,
        @Body body: Map<String, String>
    ): Call<BasicResponse>

    @GET("/api/bk/unified-recap")
    fun getBkUnifiedAttendanceRecap(
        @Query("className") className: String? = null,
        @Query("date") date: String? = null
    ): Call<com.school.smartcbt.data.model.BkUnifiedRecapResponse>

    // ==================== MODUL OPERATOR BROADCAST ====================
    @POST("/api/operator/broadcast-letter")
    fun sendOperatorBroadcast(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @GET("/api/operator/broadcasts")
    fun getOperatorBroadcasts(): Call<com.school.smartcbt.data.model.OperatorBroadcastResponse>

    @POST("/api/operator/device-binding-reset")
    fun resetStudentDeviceBinding(@Body body: Map<String, String>): Call<BasicResponse>

    // ==================== MODUL E-VOTING OSIS ====================
    @GET("/api/v1/mobile/modules")
    fun getMobileModules(): Call<EvotingModuleConfigResponse>

    @GET("/api/evoting/candidates")
    fun getEvotingCandidates(): Call<CandidateListResponse>

    @GET("/api/evoting/status")
    fun getStudentVoteStatus(): Call<VoteStatusResponse>

    @POST("/api/evoting/vote")
    fun castVote(
        @Header("X-Device-Id") deviceId: String,
        @Body request: VoteRequest
    ): Call<VoteResponse>

    @GET("/api/evoting/class-turnout")
    fun getClassTurnout(): Call<ClassTurnoutResponse>

    // ==================== MODUL PERPUSTAKAAN, E-BOOK & BUKU PAKET ====================
    @GET("/api/v1/student/books/my-packages")
    fun getStudentPackageBooks(): Call<PackageBooksResponse>

    @POST("/api/v1/student/books/claim")
    fun claimPackageBook(@Body request: ClaimPackageBookRequest): Call<BasicResponse>

    @GET("/api/v1/student/ebooks")
    fun getStudentEbooks(
        @Query("subject") subject: String? = null,
        @Query("search") search: String? = null
    ): Call<StudentEbooksResponse>

    @GET("/api/v1/ebooks/popular")
    fun getPopularEbooks(): Call<PopularEbooksResponse>

    @GET("/api/v1/student/library/active-loans-reminder")
    fun getActiveLoansReminder(): Call<ActiveLoansReminderResponse>

    @GET("/api/v1/books/lost-and-found/{barcode}")
    fun scanLostAndFound(@Path("barcode") barcode: String): Call<LostAndFoundResponse>

    @POST("/api/v1/operator/books/batch-approve")
    fun batchApproveBooks(@Body request: BatchApproveRequest): Call<BasicResponse>

    @POST("/api/v1/operator/books/continuous-return")
    fun continuousReturn(@Body request: ContinuousReturnRequest): Call<ContinuousReturnResponse>

    // ==================== MODUL DIGITAL EXIT PASS & MEJA BK & GATEPASS ====================
    @POST("/api/v1/student/leaves/apply")
    fun applyStudentLeave(@Body request: StudentLeaveApplyRequest): Call<StudentLeaveResponse>

    @POST("/api/v1/gatepass/request")
    fun createGatepassRequest(@Body request: GatepassApplyRequest): Call<StudentLeaveResponse>

    @GET("/api/v1/student/leaves/active")
    fun getActiveStudentLeave(): Call<StudentLeaveActiveResponse>

    @GET("/api/v1/gatepass/active")
    fun getActiveGatepass(): Call<StudentLeaveActiveResponse>

    @GET("/api/v1/gatepass/history")
    fun getStudentGatepassHistory(): Call<StudentGatepassHistoryResponse>

    @POST("/api/v1/student/leaves/checkout-bk")
    fun checkoutBkStation(@Body request: CheckoutBkRequest): Call<CheckoutBkResponse>

    @POST("/api/v1/gatepass/verify-by-scan")
    fun verifyGatepassByScan(@Body request: CheckoutBkRequest): Call<CheckoutBkResponse>

    @GET("/api/v1/bk/dynamic-qr")
    fun getBkDynamicQr(@Query("roomId") roomId: String? = null): Call<BkDynamicQrResponse>

    @GET("/api/v1/bk/gatepasses")
    fun getBkGatepasses(
        @Query("status") status: String? = null,
        @Query("className") className: String? = null
    ): Call<BkGatepassListResponse>

    @POST("/api/v1/bk/gatepass/{id}/status")
    fun updateGatepassStatus(
        @Path("id") id: String,
        @Body request: UpdateGatepassStatusRequest
    ): Call<BasicResponse>

    @POST("/api/v1/satpam/gatepass/checkout")
    fun checkoutGatepassBySatpam(@Body request: SatpamCheckoutRequest): Call<BasicResponse>

    @POST("/api/v1/satpam/gatepass/verify-scan")
    fun verifyGatepassBySatpam(@Body request: SatpamCheckoutRequest): Call<SatpamCheckoutResponse>

    @GET("/api/v1/satpam/gatepass/list")
    fun getSatpamGatepasses(
        @Query("status") status: String? = null,
        @Query("date") date: String? = null
    ): Call<SatpamGatepassListResponse>

    // ==================== MODUL BIODATA SISWA (STAGING & MULTI-STEP) ====================
    @GET("/api/v1/mobile/biodata/my-submission")
    fun getMyBiodataSubmission(): Call<MyBiodataResponse>

    @Multipart
    @POST("/api/v1/mobile/biodata/submit")
    fun submitBiodata(
        @Part("step1Data") step1Data: RequestBody,
        @Part("step2Data") step2Data: RequestBody,
        @Part("step3Data") step3Data: RequestBody,
        @Part("step4Data") step4Data: RequestBody,
        @Part("step5Data") step5Data: RequestBody,
        @Part kk: MultipartBody.Part?,
        @Part akta: MultipartBody.Part?,
        @Part bantuan: MultipartBody.Part? = null,
        @Part foto: MultipartBody.Part? = null,
        @Part dinsos: MultipartBody.Part? = null
    ): Call<BiodataSubmissionResponse>

    // ==================== MODUL BUKU INDUK RAPORT & DAPODIK (17 ITEM READ-ONLY) ====================
    @GET("/api/student/biodata-raport")
    fun getBiodataRaport(@Query("studentId") studentId: String? = null): Call<BiodataRaportResponse>

    // ==================== MODUL ESTAFET SESI MENGAJAR GURU (ROOM HANDOVER NFC/QR) ====================
    @POST("/api/v1/teacher/session/checkin")
    fun checkInTeachingSession(@Body request: TeacherSessionCheckInRequest): Call<TeacherSessionCheckInResponse>

    @POST("/api/v1/teacher/session/checkout")
    fun checkOutTeachingSession(@Body request: TeacherCheckOutRequest): Call<BasicResponse>

    @GET("/api/v1/teacher/session/current")
    fun getCurrentTeacherSession(): Call<TeacherCurrentSessionResponse>

    @POST("/api/v1/teacher/session/{sessionId}/attendances/update")
    fun updateStudentAttendanceByTeacher(
        @Path("sessionId") sessionId: String,
        @Body request: TeacherUpdateAttendanceRequest
    ): Call<BasicResponse>

    @GET("/api/v1/teacher/session/rooms")
    fun getPhysicalRoomsList(): Call<PhysicalRoomsListResponse>

    @GET("/api/v1/student/active-teaching-session")
    fun getActiveTeachingSessionForStudent(): Call<TeacherCurrentSessionResponse>

    @POST("/api/v1/student/session/attend")
    fun studentSelfAttendSession(@Body body: Map<String, String>): Call<BasicResponse>

    // ==================== MODUL WALI KELAS & REKAP PRESENSI LENGKAP ====================
    @GET("/api/teacher/wali-kelas/dashboard")
    fun getWaliKelasDashboard(@Query("className") className: String? = null): Call<WaliKelasDashboardResponse>

    @GET("/api/teacher/wali-kelas/students")
    fun getWaliKelasStudents(@Query("className") className: String? = null): Call<WaliKelasStudentsResponse>

    @POST("/api/teacher/wali-kelas/manual-attendance")
    fun submitManualAttendanceByWali(@Body request: ManualAttendanceRequest): Call<SimpleActionResponse>

    @GET("/api/teacher/wali-kelas/rekap")
    fun getWaliKelasRekap(
        @Query("mode") mode: String = "MONTHLY",
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null,
        @Query("date") date: String? = null,
        @Query("className") className: String? = null
    ): Call<WaliKelasRekapResponse>

    @GET("/api/teacher/wali-kelas/student-rekap/{studentId}")
    fun getWaliKelasStudentDetailRekap(
        @Path("studentId") studentId: String,
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null
    ): Call<StudentDetailRekapResponse>

    @GET("/api/teacher/wali-kelas/officers")
    fun getWaliKelasOfficers(@Query("className") className: String? = null): Call<WaliKelasOfficersResponse>

    @PUT("/api/teacher/wali-kelas/officers")
    fun updateWaliKelasOfficers(@Body request: UpdateWaliKelasOfficersRequest): Call<WaliKelasOfficersResponse>

    @POST("/api/teacher/wali-kelas/toggle-no-phone")
    fun toggleNoPhoneStudent(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    // BK Attendance Recap Endpoints
    @GET("/api/bk/rekap-presensi/kelas")
    fun getBkAttendanceRecapByClass(
        @Query("className") className: String,
        @Query("mode") mode: String = "MONTHLY",
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null,
        @Query("date") date: String? = null
    ): Call<WaliKelasRekapResponse>

    @GET("/api/bk/rekap-presensi/siswa/{studentId}")
    fun getBkStudentAttendanceDetail(
        @Path("studentId") studentId: String,
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null
    ): Call<StudentDetailRekapResponse>

    // Posko Piket: Ambil Tugas / Dampingi Kelas Kosong (SIBOY A4 & A5)
    @POST("/api/v1/piket/take-duty/{id}")
    fun takePiketDuty(@Path("id") id: String): Call<BasicResponse>

    // Kurikulum: Approval Izin Guru & Laporan Bulanan (SIBOY A1, A5, A6)
    @GET("/api/v1/kurikulum/pending-leaves")
    fun getKurikulumPendingLeaves(): Call<KurikulumPendingLeavesResponse>

    @POST("/api/v1/kurikulum/leaves/{id}/approve")
    fun approveKurikulumLeave(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): Call<BasicResponse>

    @POST("/api/v1/kurikulum/leaves/{id}/reject")
    fun rejectKurikulumLeave(@Path("id") id: String, @Body body: Map<String, String> = emptyMap()): Call<BasicResponse>

    @GET("/api/v1/kurikulum/monthly-reports")
    fun getKurikulumMonthlyReports(): Call<KurikulumMonthlyReportsResponse>

    // Kurikulum: Rekap Presensi Guru Mode Lengkap (Sesi KBM & Izin Resmi)
    @GET("/api/kurikulum/rekap/presensi-guru")
    fun getKurikulumTeacherAttendanceRecap(
        @Query("periode") periode: String? = null,
        @Query("guru_id") guruId: String? = null
    ): Call<com.school.smartcbt.data.model.KurikulumTeacherRecapResponse>

    // Guru: Rekap 360 Kehadiran, Keterlambatan, Izin & Cuti Pribadi
    @GET("/api/teacher/attendance/recap")
    fun getTeacherPersonalAttendanceRecap(): Call<com.school.smartcbt.data.model.TeacherPersonalRecapResponse>

    // Wali Kelas: Kirim Laporan Bulanan ke Kurikulum & Kirim Catatan Siswa
    @POST("/api/v1/wali-kelas/monthly-report")
    fun submitWaliKelasMonthlyReport(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @POST("/api/teacher/wali-kelas/student-note")
    fun submitWaliKelasStudentNote(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    // ==================== ULANGAN HARIAN (3 MODE) & UNIFIED INBOX SISWA ====================
    // Guru: Mulai UH, Live Monitoring, Refresh Token, Akhiri, Rekap Hasil
    @POST("/api/guru/uh/mulai")
    fun startUlanganHarian(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/guru/uh/{id}/status")
    fun getMonitoringUhGuru(@Path("id") id: String): Call<Map<String, Any>>

    @POST("/api/guru/uh/{id}/rotate-token")
    fun rotateTokenUh(@Path("id") id: String): Call<Map<String, Any>>

    @POST("/api/guru/uh/{id}/selesai")
    fun finishUlanganHarian(@Path("id") id: String): Call<Map<String, Any>>

    @GET("/api/guru/uh/{id}/hasil")
    fun getRekapHasilUh(@Path("id") id: String): Call<Map<String, Any>>

    @POST("/api/guru/uh/{id}/extend-time")
    fun extendWaktuUh(@Path("id") id: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/guru/uh/{id}/ai-analysis")
    fun getAiAnalysisUh(@Path("id") id: String): Call<Map<String, Any>>

    @POST("/api/guru/uh/{id}/grade-manual")
    fun gradeManualUraianUh(@Path("id") id: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/guru/uh/{id}/remedial-summary")
    fun getRemedialSummaryUh(@Path("id") id: String): Call<Map<String, Any>>

    @POST("/api/guru/uh/import-excel")
    fun importSoalExcelUh(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    // ==================== TAHFIZ & MUROJAAH JUZ 30 ====================
    @GET("/api/tahfiz/surahs")
    fun getTahfizSurahList(@Query("studentId") studentId: String? = null): Call<Map<String, Any>>

    @GET("/api/tahfiz/dashboard")
    fun getTahfizDashboardSummary(@Query("className") className: String? = null): Call<Map<String, Any>>

    @POST("/api/tahfiz/targets")
    fun saveTahfizTarget(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @POST("/api/tahfiz/setoran")
    fun submitTahfizSetoran(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/tahfiz/pai-teachers")
    fun getPaiTeachersList(): Call<Map<String, Any>>

    @POST("/api/tahfiz/penilaian")
    fun saveTahfizPenilaian(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/tahfiz/murojaah")
    fun getTahfizMurojaahList(@Query("className") className: String? = null): Call<Map<String, Any>>

    @POST("/api/tahfiz/murojaah/evaluate")
    fun evaluateTahfizMurojaah(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/tahfiz/progress-map")
    fun getTahfizProgressMap(@Query("className") className: String): Call<Map<String, Any>>

    @GET("/api/tahfiz/students/{studentId}")
    fun getTahfizStudentDetail(@Path("studentId") studentId: String): Call<Map<String, Any>>

    // Siswa: Unified Inbox, Mulai Kerjakan, Auto-Save, Anti-Cheat Log, Submit Final, Review Hasil
    @GET("/api/siswa/tugas-uh/inbox")
    fun getSiswaUnifiedInbox(): Call<Map<String, Any>>

    @POST("/api/siswa/uh/{id}/mulai")
    fun startUhSiswa(@Path("id") id: String, @Body body: Map<String, String>): Call<Map<String, Any>>

    @POST("/api/siswa/uh/{id}/jawab")
    fun autoSaveJawabanUhSiswa(@Path("id") id: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @POST("/api/siswa/uh/{id}/insiden")
    fun logInsidenAntiCheatUh(@Path("id") id: String, @Body body: Map<String, String>): Call<Map<String, Any>>

    @POST("/api/siswa/uh/{id}/submit")
    fun submitFinalUhSiswa(@Path("id") id: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/siswa/uh/{id}/hasil")
    fun getHasilUhSiswa(@Path("id") id: String): Call<Map<String, Any>>

    // FCM Device Token Registration
    @POST("/api/auth/fcm-token")
    fun registerFcmToken(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @POST("/api/auth/fcm-token/unregister")
    fun unregisterFcmToken(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    // Pengurus Kelas Endpoints
    @GET("/api/pengurus-kelas/config")
    fun getPengurusKelasConfig(): Call<PengurusKelasConfigResponse>

    @GET("/api/pengurus-kelas/classmates")
    fun getClassmatesRealtimeStatus(): Call<ClassmatesRealtimeResponse>

    @POST("/api/pengurus-kelas/assisted-scan")
    fun submitAssistedScan(@Body req: AssistedScanRequest): Call<AssistedScanResponse>

    @POST("/api/operator/unlock-biodata")
    fun unlockStudentBiodata(@Body body: Map<String, String>): Call<BasicResponse>

    @POST("/api/teacher/wali-kelas/toggle-no-phone")
    fun toggleNoPhoneByOperator(@Body body: Map<String, @JvmSuppressWildcards Any>): Call<BasicResponse>

    // --- Akses Wi-Fi Sekolah & MikroTik Bypass ---
    @GET("/api/student/wifi/status")
    fun getStudentWifiStatus(): Call<com.school.smartcbt.data.model.WifiStatusResponse>

    @POST("/api/student/wifi/activate")
    fun activateStudentWifi(@Body request: com.school.smartcbt.data.model.WifiActivateRequest): Call<com.school.smartcbt.data.model.WifiActivateResponse>

    // --- Guru PAI Scan Kartu Pelajar Siswa Tanpa HP ---
    @POST("/api/prayer/pai-scan-student-card")
    fun paiScanStudentCard(@Body body: Map<String, String>): Call<com.school.smartcbt.data.model.PaiCardScanResponse>

    // --- E-Kantin Siswa & Kontrol Orang Tua ---
    @GET("/api/ekantin/wallet")
    fun getStudentWallet(@Query("studentId") studentId: String? = null): Call<BasicResponse>

    @POST("/api/ekantin/parent/set-limit")
    fun parentSetDailyLimit(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @POST("/api/ekantin/parent/topup")
    fun parentTopUp(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    @POST("/api/ekantin/topup/create")
    fun createCanteenTopup(@Body request: CanteenTopupCreateRequest): Call<CanteenTopupCreateResponse>

    @GET("/api/ekantin/topup/status/{orderId}")
    fun checkCanteenTopupStatus(@Path("orderId") orderId: String): Call<CanteenTopupStatusResponse>

    @GET("/api/ekantin/topup/history")
    fun getCanteenTopupHistory(
        @Query("studentId") studentId: String? = null,
        @Query("page") page: Int = 1
    ): Call<CanteenTopupHistoryResponse>

    @GET("/api/ekantin/analytics")
    fun getCanteenAnalytics(@Query("studentId") studentId: String? = null): Call<BasicResponse>

    @GET("/api/ekantin/menu")
    fun getCanteenMenu(): Call<BasicResponse>

    @POST("/api/ekantin/pos/pay")
    fun posChargePayment(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<KantinPaymentResponse>

    @GET("/api/ekantin/pos/dashboard")
    fun getKantinDashboard(): Call<KantinDashboardResponse>

    // --- Ekstrakurikuler Spenboy (Marketplace / E-Commerce, Pendaftaran, Riwayat, Presensi QR) ---
    @GET("/api/extracurriculars")
    fun getExtracurricularCatalog(
        @Query("category") category: String? = null,
        @Query("search") search: String? = null,
        @Query("grade") grade: String? = null
    ): Call<Map<String, Any>>

    @GET("/api/extracurriculars/detail/{idOrSlug}")
    fun getExtracurricularDetail(@Path("idOrSlug") idOrSlug: String): Call<Map<String, Any>>

    @POST("/api/extracurriculars/register")
    fun registerExtracurricular(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @POST("/api/extracurriculars/cancel")
    fun cancelExtracurricularRegistration(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/extracurriculars/students/{studentId}/history")
    fun getStudentExtracurricularHistory(@Path("studentId") studentId: String): Call<Map<String, Any>>

    @POST("/api/extracurriculars/check-in")
    fun checkInExtracurricularSession(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<Map<String, Any>>

    @GET("/api/extracurriculars/students/{studentId}/portfolio")
    fun getStudentExtracurricularPortfolio(@Path("studentId") studentId: String): Call<Map<String, Any>>

    // --- GAP-07: Tanda Terima Digital Surat Peringatan (SP) BK oleh Orang Tua ---
    @POST("/api/bk/sp/acknowledge")
    fun acknowledgeWarningLetter(@Body body: Map<String, @JvmSuppressWildcards Any?>): Call<BasicResponse>

    // --- GAP-15: Toggle Gerbang Darurat & Mode Uji Coba oleh Satpam / Operator ---
    @POST("/api/attendance/gate-settings/toggle-trial")
    fun toggleTrialGate(@Body body: Map<String, @JvmSuppressWildcards Any?> = emptyMap()): Call<BasicResponse>

    @POST("/api/attendance/toggle-emergency-gateout")
    fun toggleEmergencyGateOut(@Body body: Map<String, @JvmSuppressWildcards Any?> = emptyMap()): Call<BasicResponse>

    // ==================== SISTEM LAYANAN & MONITORING TPP GURU ====================
    @GET("/api/tpp/my-tpp")
    fun getMyTpp(
        @Query("tahun") tahun: Int? = null
    ): Call<com.school.smartcbt.data.model.MyTppResponse>

    @POST("/api/tpp/submit-report")
    fun submitTeacherTppReport(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Call<com.school.smartcbt.data.model.GenericTppActionResponse>

    @POST("/api/tpp/confirm-cair")
    fun confirmTeacherTppCair(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Call<com.school.smartcbt.data.model.GenericTppActionResponse>

    @POST("/api/tpp/cancel-cair")
    fun cancelTeacherTppCair(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Call<com.school.smartcbt.data.model.GenericTppActionResponse>

    @POST("/api/tpp/sanggahan")
    fun submitTppDispute(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Call<com.school.smartcbt.data.model.GenericTppActionResponse>

    @GET("/api/tpp/kurikulum/monitoring")
    fun getKurikulumTppMonitoring(
        @Query("tahun") tahun: Int? = null,
        @Query("triwulan") triwulan: Int? = null,
        @Query("bulan") bulan: Int? = null
    ): Call<com.school.smartcbt.data.model.KurikulumTppMonitoringResponse>

    @POST("/api/tpp/kurikulum/verify")
    fun verifyKurikulumTpp(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Call<com.school.smartcbt.data.model.GenericTppActionResponse>

    @POST("/api/tpp/operator/update-status")
    fun updateTppStatusByOperator(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Call<com.school.smartcbt.data.model.GenericTppActionResponse>

    // Schedule Engine & Server Health
    @GET("/api/schedule/current")
    fun getCurrentScheduleSlot(): Call<Map<String, Any>>

    @GET("/api/schedule/today")
    fun getScheduleToday(): Call<Map<String, Any>>

    @GET("/api/health")
    fun getServerHealth(): Call<Map<String, Any>>

    @GET("/api/kurikulum/rekap-presensi-guru")
    fun getKurikulumTeacherMonthlyAttendance(
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null
    ): Call<Map<String, Any>>
}


