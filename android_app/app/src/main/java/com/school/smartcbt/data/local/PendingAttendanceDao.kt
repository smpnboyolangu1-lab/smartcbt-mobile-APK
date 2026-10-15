package com.school.smartcbt.data.local

import androidx.room.*

@Dao
interface PendingAttendanceDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(attendance: PendingAttendanceEntity)

    @Query("SELECT * FROM pending_attendance WHERE isSynced = 0 ORDER BY scanTimeMillis ASC")
    suspend fun getUnsynced(): List<PendingAttendanceEntity>

    @Query("SELECT * FROM pending_attendance WHERE isSynced = 0 ORDER BY scanTimeMillis ASC")
    fun getUnsyncedSync(): List<PendingAttendanceEntity>

    @Query("SELECT COUNT(*) FROM pending_attendance WHERE isSynced = 0")
    suspend fun getUnsyncedCount(): Int

    @Query("UPDATE pending_attendance SET isSynced = 1 WHERE localId = :localId")
    suspend fun markSynced(localId: String)

    @Query("UPDATE pending_attendance SET syncAttemptCount = syncAttemptCount + 1, lastSyncError = :error WHERE localId = :localId")
    suspend fun recordSyncFailure(localId: String, error: String)

    @Delete
    suspend fun delete(attendance: PendingAttendanceEntity)

    @Query("DELETE FROM pending_attendance WHERE isSynced = 1")
    suspend fun deleteSynced()

    @Query("DELETE FROM pending_attendance")
    suspend fun deleteAll()
}
