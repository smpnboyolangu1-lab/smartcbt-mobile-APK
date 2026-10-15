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

    fun syncFcmToken(context: Context) {
        val sessionManager = SessionManager(context)
        if (sessionManager.getToken().isNullOrEmpty()) {
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

                    if (token != lastToken) {
                        val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})"
                        val body = mapOf<String, Any>(
                            "token" to token,
                            "deviceModel" to deviceModel
                        )

                        ApiClient.getClient(context).registerFcmToken(body).enqueue(object : Callback<Map<String, Any>> {
                            override fun onResponse(call: Call<Map<String, Any>>, response: Response<Map<String, Any>>) {
                                if (response.isSuccessful) {
                                    Log.i(TAG, "FCM token registered successfully to backend")
                                    sharedPrefs.edit().putString(PREF_LAST_FCM_TOKEN, token).apply()
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
}
