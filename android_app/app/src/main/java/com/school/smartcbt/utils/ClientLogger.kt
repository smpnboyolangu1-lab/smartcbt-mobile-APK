package com.school.smartcbt.utils

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import com.school.smartcbt.BuildConfig
import com.school.smartcbt.data.remote.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter
import java.util.concurrent.TimeUnit

/**
 * ClientLogger: Sistem Pelaporan & Log Aktivitas Real-Time Terpusat Smart CBT & School.
 * Mengirimkan rekaman aktivitas penting, peringatan, galat, dan anomali ke Server tanpa memblokir UI.
 */
object ClientLogger {

    private const val TAG = "ClientLogger"
    private val clientScope = CoroutineScope(Dispatchers.IO)

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    /**
     * Mengirim event log komprehensif ke backend
     */
    fun logEvent(
        context: Context?,
        module: String,
        action: String,
        outcome: String,
        message: String,
        payload: Map<String, Any?>? = null,
        level: String = "INFO",
        activityName: String? = null,
        throwable: Throwable? = null
    ) {
        if (context == null) return

        clientScope.launch {
            try {
                val appContext = context.applicationContext
                val sessionManager = SessionManager(appContext)
                val fullBaseUrl = ApiClient.getFullApiBaseUrl(appContext)
                val endpoint = fullBaseUrl + "app/client-logs"

                val stackTrace = throwable?.let {
                    val sw = StringWriter()
                    it.printStackTrace(PrintWriter(sw))
                    sw.toString()
                }

                val jsonBody = JSONObject().apply {
                    put("level", level.uppercase())
                    put("tag", module.uppercase())
                    put("errorMessage", message)
                    put("stackTrace", stackTrace ?: JSONObject.NULL)
                    put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
                    put("androidVersion", "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
                    put("appVersion", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                    put("networkType", getNetworkType(appContext))
                    put("serverUrl", fullBaseUrl)
                    put("activityName", activityName ?: context.javaClass.simpleName)
                    put("userId", sessionManager.getUserId().ifEmpty { null })
                    put("username", sessionManager.getUsername().ifEmpty { sessionManager.getNisn().ifEmpty { null } })
                    put("name", sessionManager.getName())
                    put("className", sessionManager.getClassName().ifEmpty { null })
                    put("role", sessionManager.getRole().ifEmpty { null })
                    put("module", module.uppercase())
                    put("action", action.uppercase())
                    put("outcome", outcome.uppercase())

                    if (payload != null) {
                        put("payload", JSONObject(payload).toString())
                    }
                }

                val mediaType = MediaType.parse("application/json; charset=utf-8")
                val requestBody = RequestBody.create(mediaType, jsonBody.toString())

                val reqBuilder = Request.Builder()
                    .url(endpoint)
                    .post(requestBody)
                    .header("Accept", "application/json")
                    .header("X-Client-Type", "SmartSchool-ExamBrowser")
                    .header("X-Device-Id", sessionManager.getDeviceId())
                    .header("X-App-Version", BuildConfig.VERSION_NAME)

                val token = sessionManager.getToken()
                if (!token.isNullOrEmpty()) {
                    reqBuilder.header("Authorization", "Bearer $token")
                }

                val response = httpClient.newCall(reqBuilder.build()).execute()
                response.close()
                Log.d(TAG, "[$module] [$action] [$outcome] Log berhasil dikirim: $message")
            } catch (e: Exception) {
                // Silent fail: logging klien tidak boleh merusak alur kerja aplikasi
                Log.w(TAG, "Gagal mengirim log event ke server: ${e.message}")
            }
        }
    }

    // ==========================================
    // 1. PRESENSI LOGGING
    // ==========================================
    fun logAttendance(
        context: Context?,
        action: String,
        outcome: String,
        message: String,
        barcode: String? = null,
        lat: Double? = null,
        lng: Double? = null,
        extra: Map<String, Any?>? = null
    ) {
        val payloadMap = mutableMapOf<String, Any?>()
        if (barcode != null) payloadMap["barcode"] = barcode
        if (lat != null) payloadMap["lat"] = lat
        if (lng != null) payloadMap["lng"] = lng
        extra?.let { payloadMap.putAll(it) }

        val level = if (outcome.uppercase() == "ERROR") "ERROR" else if (outcome.uppercase() == "REJECTED") "WARN" else "INFO"
        logEvent(context, "ATTENDANCE", action, outcome, message, payloadMap, level)
    }

    // ==========================================
    // 2. CBT LOGGING (Token, Soal, Jawaban, Strike)
    // ==========================================
    fun logCbt(
        context: Context?,
        action: String,
        outcome: String,
        message: String,
        examId: String? = null,
        token: String? = null,
        extra: Map<String, Any?>? = null
    ) {
        val payloadMap = mutableMapOf<String, Any?>()
        if (examId != null) payloadMap["examId"] = examId
        if (token != null) payloadMap["tokenEntered"] = token
        extra?.let { payloadMap.putAll(it) }

        val level = if (outcome.uppercase() == "ERROR") "ERROR" else if (outcome.uppercase() == "REJECTED") "WARN" else "INFO"
        logEvent(context, "CBT", action, outcome, message, payloadMap, level)
    }

    // ==========================================
    // 3. TUGAS / HOMEWORK LOGGING
    // ==========================================
    fun logHomework(
        context: Context?,
        action: String,
        outcome: String,
        message: String,
        homeworkId: String? = null,
        extra: Map<String, Any?>? = null
    ) {
        val payloadMap = mutableMapOf<String, Any?>()
        if (homeworkId != null) payloadMap["homeworkId"] = homeworkId
        extra?.let { payloadMap.putAll(it) }

        val level = if (outcome.uppercase() == "ERROR") "ERROR" else if (outcome.uppercase() == "REJECTED") "WARN" else "INFO"
        logEvent(context, "HOMEWORK", action, outcome, message, payloadMap, level)
    }

    // ==========================================
    // 4. EKSTRAKURIKULER LOGGING
    // ==========================================
    fun logExtracurricular(
        context: Context?,
        action: String,
        outcome: String,
        message: String,
        ekskulId: String? = null,
        extra: Map<String, Any?>? = null
    ) {
        val payloadMap = mutableMapOf<String, Any?>()
        if (ekskulId != null) payloadMap["ekskulId"] = ekskulId
        extra?.let { payloadMap.putAll(it) }

        val level = if (outcome.uppercase() == "ERROR") "ERROR" else if (outcome.uppercase() == "REJECTED") "WARN" else "INFO"
        logEvent(context, "EXTRACURRICULAR", action, outcome, message, payloadMap, level)
    }

    // ==========================================
    // 5. AUTENTIKASI / SESI LOGGING
    // ==========================================
    fun logAuth(
        context: Context?,
        action: String,
        outcome: String,
        message: String,
        extra: Map<String, Any?>? = null
    ) {
        val level = if (outcome.uppercase() == "ERROR") "ERROR" else if (outcome.uppercase() == "REJECTED") "WARN" else "INFO"
        logEvent(context, "AUTH", action, outcome, message, extra, level)
    }

    // ==========================================
    // 6. ERROR / CRASH LOGGING
    // ==========================================
    fun logError(
        context: Context?,
        tag: String,
        errorMessage: String,
        throwable: Throwable? = null,
        action: String = "APP_ERROR"
    ) {
        logEvent(
            context = context,
            module = "APP_CLIENT",
            action = action,
            outcome = "ERROR",
            message = errorMessage,
            payload = null,
            level = "ERROR",
            throwable = throwable
        )
    }

    private fun getNetworkType(context: Context): String {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val net = cm?.activeNetwork ?: return "OFFLINE"
                val caps = cm.getNetworkCapabilities(net) ?: return "UNKNOWN"
                when {
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
                    else -> "CONNECTED"
                }
            } else {
                @Suppress("DEPRECATION")
                val ni = cm?.activeNetworkInfo
                if (ni != null && ni.isConnected) ni.typeName else "OFFLINE"
            }
        } catch (e: Exception) {
            "UNKNOWN"
        }
    }
}
