package com.school.smartcbt.utils

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import com.school.smartcbt.data.local.AppDatabase
import com.school.smartcbt.data.local.PendingAttendanceEntity
import com.school.smartcbt.data.remote.ApiClient
import com.google.gson.JsonObject
import com.google.gson.JsonArray
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.Response

object AttendanceOfflineManager {
    private const val TAG = "AttendanceOffline"

    fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val activeNetwork = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun saveOffline(
        context: Context,
        identifier: String,
        barcodeCode: String,
        scanType: String,
        method: String,
        lat: Double?,
        lng: Double?,
        accuracy: Float?,
        isFakeGps: Boolean,
        deviceTime: String,
        note: String?,
        onSaved: (() -> Unit)? = null
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = AppDatabase.getDatabase(context)
                val entity = PendingAttendanceEntity(
                    studentIdentifier = identifier,
                    barcodeCode = barcodeCode,
                    scanType = scanType,
                    method = method,
                    lat = lat,
                    lng = lng,
                    accuracy = accuracy,
                    isFakeGps = isFakeGps,
                    scanTimeMillis = System.currentTimeMillis(),
                    deviceTime = deviceTime,
                    note = note
                )
                db.pendingAttendanceDao().insert(entity)
                Log.d(TAG, "Presensi offline berhasil disimpan ke database lokal HP: ${entity.localId}")
                withContext(Dispatchers.Main) {
                    onSaved?.invoke()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Gagal menyimpan presensi offline: ${e.message}")
            }
        }
    }

    fun syncPendingAttendances(context: Context, onComplete: ((synced: Int, failed: Int) -> Unit)? = null) {
        if (!isOnline(context)) {
            onComplete?.invoke(0, 0)
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = AppDatabase.getDatabase(context)
                val unsynced = db.pendingAttendanceDao().getUnsynced()
                if (unsynced.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        onComplete?.invoke(0, 0)
                    }
                    return@launch
                }

                val recordsArray = JsonArray()
                for (item in unsynced) {
                    val obj = JsonObject()
                    obj.addProperty("clientLocalId", item.localId)
                    obj.addProperty("identifier", item.studentIdentifier)
                    obj.addProperty("barcodeCode", item.barcodeCode)
                    obj.addProperty("type", item.scanType)
                    obj.addProperty("method", item.method)
                    if (item.lat != null) obj.addProperty("lat", item.lat)
                    if (item.lng != null) obj.addProperty("lng", item.lng)
                    if (item.accuracy != null) obj.addProperty("accuracy", item.accuracy)
                    obj.addProperty("isFakeGps", item.isFakeGps)
                    obj.addProperty("scanTime", item.scanTimeMillis)
                    obj.addProperty("deviceTime", item.deviceTime)
                    if (item.note != null) obj.addProperty("note", item.note)
                    recordsArray.add(obj)
                }

                val payload = JsonObject()
                payload.add("records", recordsArray)

                val response = ApiClient.getClient(context).bulkSyncAttendance(payload).execute()
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    val syncedCount = body.get("syncedCount")?.asInt ?: 0
                    val failedCount = body.get("failedCount")?.asInt ?: 0

                    val results = body.getAsJsonArray("results")
                    if (results != null) {
                        for (r in results) {
                            val rObj = r.asJsonObject
                            val localId = rObj.get("clientLocalId")?.asString
                            val status = rObj.get("status")?.asString
                            if (localId != null && (status == "SYNCED" || status == "ALREADY_SYNCED")) {
                                db.pendingAttendanceDao().markSynced(localId)
                            }
                        }
                    }

                    // Bersihkan record yang sudah tersinkron
                    db.pendingAttendanceDao().deleteSynced()

                    Log.d(TAG, "Bulk sync selesai: $syncedCount disinkronkan, $failedCount gagal.")
                    withContext(Dispatchers.Main) {
                        onComplete?.invoke(syncedCount, failedCount)
                    }
                } else {
                    withContext(Dispatchers.Main) {
                        onComplete?.invoke(0, unsynced.size)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error saat bulk sync: ${e.message}")
                withContext(Dispatchers.Main) {
                    onComplete?.invoke(0, 0)
                }
            }
        }
    }

    fun clearAllOfflineScans(context: Context) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = AppDatabase.getDatabase(context)
                db.pendingAttendanceDao().deleteAll()
                Log.d(TAG, "Seluruh antrean presensi offline telah dibersihkan.")
            } catch (e: Exception) {
                Log.e(TAG, "Gagal membersihkan antrean offline: ${e.message}")
            }
        }
    }
}
