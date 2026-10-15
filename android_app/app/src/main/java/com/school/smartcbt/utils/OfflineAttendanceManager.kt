package com.school.smartcbt.utils

import android.content.Context
import com.school.smartcbt.data.model.GateScanRequest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Delegator / Adapter kompatibilitas balik ke AttendanceOfflineManager (Room Database)
 */
object OfflineAttendanceManager {

    fun savePendingScan(context: Context, request: GateScanRequest) {
        // Mode offline dinonaktifkan sesuai kebijakan kedisiplinan sekolah.
        android.util.Log.w("OfflineAttendance", "Presensi offline dinonaktifkan. Seluruh presensi wajib online langsung ke server.")
    }

    fun getPendingScans(context: Context): List<com.school.smartcbt.data.local.PendingAttendanceEntity> {
        return emptyList()
    }

    fun clearPendingScans(context: Context) {
        AttendanceOfflineManager.clearAllOfflineScans(context)
    }

    fun syncPendingScans(context: Context, onComplete: ((Int) -> Unit)? = null) {
        AttendanceOfflineManager.syncPendingAttendances(context) { synced, _ ->
            onComplete?.invoke(synced)
        }
    }
}
