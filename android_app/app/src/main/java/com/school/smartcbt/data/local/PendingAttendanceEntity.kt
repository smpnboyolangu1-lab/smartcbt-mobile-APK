package com.school.smartcbt.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "pending_attendance")
data class PendingAttendanceEntity(
    @PrimaryKey
    val localId: String = UUID.randomUUID().toString(),
    val studentIdentifier: String,
    val barcodeCode: String,
    val scanType: String = "GATE_IN", // GATE_IN atau GATE_OUT
    val method: String = "GPS",        // GPS, DYNAMIC_QR, QR_STATIC
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracy: Float? = null,
    val isFakeGps: Boolean = false,
    val scanTimeMillis: Long = System.currentTimeMillis(),
    val deviceTime: String = "",       // "HH:mm"
    val note: String? = null,
    val isSynced: Boolean = false,
    val syncAttemptCount: Int = 0,
    val lastSyncError: String? = null
)
