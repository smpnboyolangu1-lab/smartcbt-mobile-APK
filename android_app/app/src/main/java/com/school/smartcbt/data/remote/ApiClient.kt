package com.school.smartcbt.data.remote

import android.content.Context
import android.content.Intent
import com.school.smartcbt.ui.LoginActivity
import com.school.smartcbt.utils.SessionManager
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okhttp3.Route
import org.json.JSONObject
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    const val BASE_URL: String = "https://cbt.smpn1boyolangu.my.id"

    @Volatile
    private var apiServiceInstance: ApiService? = null

    @Volatile
    private var okHttpClientInstance: OkHttpClient? = null

    @Volatile
    private var lastCalculatedBaseUrl: String? = null

    private val lock = Any()

    fun getBaseServerUrl(context: Context): String {
        val sessionManager = SessionManager(context)
        var serverIp = sessionManager.getServerIp().trim()
        if (serverIp.contains("localhost") || serverIp.contains("127.0.0.1") || serverIp.contains("192.168.101.46")) {
            serverIp = SessionManager.ONLINE_SERVER_URL
            sessionManager.setServerIp(SessionManager.ONLINE_SERVER_URL)
        }
        val baseUrl = if (serverIp.startsWith("http://") || serverIp.startsWith("https://")) {
            serverIp
        } else {
            "https://$serverIp"
        }
        return baseUrl.trimEnd('/')
    }

    fun getFullApiBaseUrl(context: Context): String {
        var baseUrl = getBaseServerUrl(context)
        if (!baseUrl.endsWith("/")) {
            baseUrl += "/"
        }
        if (!baseUrl.endsWith("api/")) {
            baseUrl += "api/"
        }
        return baseUrl
    }

    fun getClient(context: Context): ApiService {
        val fullBaseUrl = getFullApiBaseUrl(context)
        val sessionManager = SessionManager(context.applicationContext)

        return apiServiceInstance?.takeIf { lastCalculatedBaseUrl == fullBaseUrl }
            ?: synchronized(lock) {
                apiServiceInstance?.takeIf { lastCalculatedBaseUrl == fullBaseUrl } ?: run {
                    val authInterceptor = Interceptor { chain ->
                        val original = chain.request()
                        val token = sessionManager.getToken()
                        val requestBuilder = original.newBuilder()
                        if (!token.isNullOrEmpty()) {
                            requestBuilder.header("Authorization", "Bearer $token")
                        }
                        requestBuilder.header("Accept", "application/json")
                        requestBuilder.header("X-Client-Type", "SmartSchool-ExamBrowser")
                        requestBuilder.header("User-Agent", "SmartSchool-ExamBrowser/${com.school.smartcbt.BuildConfig.VERSION_NAME} (Android; Linux)")
                        requestBuilder.header("X-Device-Id", sessionManager.getDeviceId())
                        requestBuilder.header("X-App-Version", com.school.smartcbt.BuildConfig.VERSION_NAME)
                        chain.proceed(requestBuilder.build())
                    }

                    val tokenAuthenticator = Authenticator { _: Route?, response: Response ->
                        // Prevent infinite loop if refresh token is rejected or repeated failure
                        if (responseCount(response) >= 2) {
                            return@Authenticator null
                        }

                        val refreshToken = sessionManager.getRefreshToken()
                        if (refreshToken.isNullOrEmpty()) {
                            return@Authenticator null
                        }

                        synchronized(lock) {
                            val currentToken = sessionManager.getToken()
                            val originalHeaderToken = response.request().header("Authorization")
                                ?.removePrefix("Bearer ")
                                ?.trim()

                            // If another thread already refreshed the token, retry with currentToken immediately
                            if (!currentToken.isNullOrEmpty() && currentToken != originalHeaderToken) {
                                return@Authenticator response.request().newBuilder()
                                    .header("Authorization", "Bearer $currentToken")
                                    .build()
                            }

                            // Perform synchronous refresh call using a raw OkHttpClient
                            try {
                                val refreshBodyJson = "{\"refreshToken\":\"$refreshToken\"}"
                                val mediaType = MediaType.parse("application/json; charset=utf-8")
                                val requestBody = RequestBody.create(mediaType, refreshBodyJson)
                                val refreshRequest = Request.Builder()
                                    .url(fullBaseUrl + "auth/refresh")
                                    .post(requestBody)
                                    .header("Accept", "application/json")
                                    .header("X-Client-Type", "SmartSchool-ExamBrowser")
                                    .header("User-Agent", "SmartSchool-ExamBrowser/${com.school.smartcbt.BuildConfig.VERSION_NAME} (Android; Linux)")
                                    .header("X-Device-Id", sessionManager.getDeviceId())
                                    .header("X-App-Version", com.school.smartcbt.BuildConfig.VERSION_NAME)
                                    .build()

                                val rawClient = OkHttpClient.Builder()
                                    .connectTimeout(30, TimeUnit.SECONDS)
                                    .readTimeout(60, TimeUnit.SECONDS)
                                    .writeTimeout(60, TimeUnit.SECONDS)
                                    .build()

                                val refreshResponse = rawClient.newCall(refreshRequest).execute()
                                if (refreshResponse.isSuccessful) {
                                    val responseString = refreshResponse.body()?.string() ?: ""
                                    val jsonObject = JSONObject(responseString)
                                    val newToken = jsonObject.optString("token")
                                    if (newToken.isNotEmpty()) {
                                        sessionManager.saveToken(newToken)
                                        return@Authenticator response.request().newBuilder()
                                            .header("Authorization", "Bearer $newToken")
                                            .build()
                                    }
                                } else if (refreshResponse.code() in listOf(401, 403)) {
                                    // Refresh token invalid atau expired di server.
                                    // Kosongkan refresh token agar tidak terjadi loop penolakan ribuan kali.
                                    sessionManager.saveRefreshToken("")
                                    com.school.smartcbt.utils.ClientLogger.logAuth(
                                        context = context.applicationContext,
                                        action = "REFRESH_TOKEN",
                                        outcome = "REJECTED",
                                        message = "Sesi login kedaluwarsa (HTTP ${refreshResponse.code()}). Refresh token dinonaktifkan."
                                    )
                                }
                            } catch (e: Exception) {
                                e.printStackTrace()
                            }
                            return@Authenticator null
                        }
                    }

                    val failoverInterceptor = Interceptor { chain ->
                        val request = chain.request()
                        try {
                            val response = chain.proceed(request)
                            // Jika response server gateway error 502/503/504
                            if (response.code() in listOf(502, 503, 504)) {
                                sessionManager.setServerIp(SessionManager.ONLINE_SERVER_URL)
                                val onlineUrl = okhttp3.HttpUrl.parse(SessionManager.ONLINE_SERVER_URL)
                                if (onlineUrl != null && request.url().host() != onlineUrl.host()) {
                                    val newUrl = request.url().newBuilder()
                                        .scheme(onlineUrl.scheme())
                                        .host(onlineUrl.host())
                                        .port(onlineUrl.port())
                                        .build()
                                    response.close()
                                    return@Interceptor chain.proceed(request.newBuilder().url(newUrl).build())
                                }
                            }
                            response
                        } catch (e: java.io.IOException) {
                            android.util.Log.w("ApiClient", "Network error on ${request.url()}: ${e.message}")
                            sessionManager.setServerIp(SessionManager.ONLINE_SERVER_URL)
                            val onlineUrl = okhttp3.HttpUrl.parse(SessionManager.ONLINE_SERVER_URL)
                            if (onlineUrl != null && request.url().host() != onlineUrl.host()) {
                                val newUrl = request.url().newBuilder()
                                    .scheme(onlineUrl.scheme())
                                    .host(onlineUrl.host())
                                    .port(onlineUrl.port())
                                    .build()
                                return@Interceptor chain.proceed(request.newBuilder().url(newUrl).build())
                            }
                            throw e
                        }
                    }

                    val authErrorInterceptor = Interceptor { chain ->
                        val response = chain.proceed(chain.request())
                        if (response.code() == 401) {
                            try {
                                val peek = response.peekBody(2048).string()
                                if (peek.contains("FORCE_LOGOUT", ignoreCase = true) || peek.contains("\"forceLogout\":true") || peek.contains("\"forceLogout\": true")) {
                                    sessionManager.clearSession()
                                    val logoutIntent = Intent(context.applicationContext, LoginActivity::class.java).apply {
                                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                                        putExtra("EXTRA_FORCE_LOGOUT", true)
                                    }
                                    context.applicationContext.startActivity(logoutIntent)
                                }
                            } catch (e: Exception) {
                                // Safe fallback
                            }
                        }
                        response
                    }

                    val okHttpClient = OkHttpClient.Builder()
                        .dns(object : okhttp3.Dns {
                            override fun lookup(hostname: String): List<java.net.InetAddress> {
                                val addresses = okhttp3.Dns.SYSTEM.lookup(hostname)
                                // Prioritaskan alamat IPv4 untuk mencegah delay/timeout IPv6 pada operator seluler Indonesia
                                return addresses.sortedBy { if (it is java.net.Inet4Address) 0 else 1 }
                            }
                        })
                        .addInterceptor(failoverInterceptor)
                        .addInterceptor(authInterceptor)
                        .addInterceptor(authErrorInterceptor)
                        .authenticator(tokenAuthenticator)
                        .connectionPool(okhttp3.ConnectionPool(15, 5, TimeUnit.MINUTES))
                        .connectTimeout(30, TimeUnit.SECONDS)
                        .readTimeout(60, TimeUnit.SECONDS)
                        .writeTimeout(60, TimeUnit.SECONDS)
                        .pingInterval(15, TimeUnit.SECONDS) // Keep HTTP/2 connection alive
                        .retryOnConnectionFailure(true)
                        .build()

                    val retrofit = Retrofit.Builder()
                        .baseUrl(fullBaseUrl)
                        .client(okHttpClient)
                        .addConverterFactory(GsonConverterFactory.create())
                        .build()

                    val service = retrofit.create(ApiService::class.java)
                    lastCalculatedBaseUrl = fullBaseUrl
                    okHttpClientInstance = okHttpClient
                    apiServiceInstance = service
                    service
                }
            }
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse()
        while (prior != null) {
            count++
            prior = prior.priorResponse()
        }
        return count
    }

    fun resetClient() {
        synchronized(lock) {
            apiServiceInstance = null
            okHttpClientInstance = null
            lastCalculatedBaseUrl = null
        }
    }
}
