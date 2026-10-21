package com.school.smartcbt.utils

import android.content.Context
import android.os.Build
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.school.smartcbt.data.remote.ApiClient
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

object FcmHelper {
    private const val TAG = "FcmHelper"
    private const val PREF_LAST_FCM_TOKEN = "last_registered_fcm_token"
    private const val PREF_LAST_FCM_USER_ID = "last_registered_fcm_user_id"

    fun syncFcmToken(context: Context, force: Boolean = false) {
        val sessionManager = SessionManager(context)
        val currentUserId = sessionManager.getUserId()
        if (sessionManager.getToken().isNullOrEmpty() || currentUserId.isEmpty()) {
            return
        }

        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful) {
                    Log.w(TAG, "Fetching FCM registration token failed", task.exception)
                    return@addOnCompleteListener
                }

                val token = task.result
                if (!token.isNullOrEmpty()) {
                    val sharedPrefs = context.getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
                    val lastToken = sharedPrefs.getString(PREF_LAST_FCM_TOKEN, null)
                    val lastUserId = sharedPrefs.getString(PREF_LAST_FCM_USER_ID, null)

                    // Jika force == true, ATAU token baru didapat, ATAU akun pengguna yang login berbeda (misal setelah logout ganti akun)
                    if (force || token != lastToken || currentUserId != lastUserId) {
                        val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})"
                        val deviceAndroidId = sessionManager.getDeviceId()
                        val role = sessionManager.getRole()

                        val body = mapOf<String, Any>(
                            "token" to token,
                            "deviceModel" to deviceModel,
                            "deviceAndroidId" to deviceAndroidId,
                            "role" to role
                        )

                        Log.i(TAG, "Registering FCM token for user $currentUserId ($role) on device $deviceAndroidId")

                        ApiClient.getClient(context).registerFcmToken(body).enqueue(object : Callback<Map<String, Any>> {
                            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                                if (response.isSuccessful) {
                                    Log.i(TAG, "FCM token registered successfully to backend for user $currentUserId")
                                    sharedPrefs.edit()
                                        .putString(PREF_LAST_FCM_TOKEN, token)
                                        .putString(PREF_LAST_FCM_USER_ID, currentUserId)
                                        .apply()
                                } else {
                                    Log.w(TAG, "Backend returned error registering FCM token: ${response.code()}")
                                }
                            }

                            override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                                Log.e(TAG, "Failed to send FCM token to backend", t)
                            }
                        })
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing FCM token fetch: ${e.message}")
        }
    }

    /**
     * Dipanggil saat pengguna logout agar token FCM di server segera dihapus/di-unbind dari akun ini,
     * serta membersihkan preferensi lokal sehingga login berikutnya selalu mendaftarkan akun baru secara akurat.
     */
    fun clearFcmRegistration(context: Context) {
        try {
            val sharedPrefs = context.getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
            val lastToken = sharedPrefs.getString(PREF_LAST_FCM_TOKEN, null)
            val sessionManager = SessionManager(context)
            val deviceId = sessionManager.getDeviceId()

            // Bersihkan cache lokal
            sharedPrefs.edit()
                .remove(PREF_LAST_FCM_TOKEN)
                .remove(PREF_LAST_FCM_USER_ID)
                .apply()

            if (!lastToken.isNullOrEmpty() || deviceId.isNotEmpty()) {
                val body = mutableMapOf<String, Any>()
                if (!lastToken.isNullOrEmpty()) body["token"] = lastToken
                if (deviceId.isNotEmpty()) body["deviceAndroidId"] = deviceId

                ApiClient.getClient(context).unregisterFcmToken(body).enqueue(object : Callback<Map<String, Any>> {
                    override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                        Log.i(TAG, "FCM token unlinked on backend successfully")
                    }

                    override fun onFailure(call: Call<Map<String, Any>>, t: Throwable) {
                        Log.w(TAG, "Failed to unlink FCM token on backend: ${t.message}")
                    }
                })
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error in clearFcmRegistration: ${e.message}")
        }
    }
}
