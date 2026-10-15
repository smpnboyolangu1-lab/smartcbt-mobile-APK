package com.school.smartcbt.data.model

import com.google.gson.annotations.SerializedName

// ============================================================
// Device Registration & Sync Models
// ============================================================

data class DeviceRegisterRequest(
    val userId: String? = null,
    val username: String? = null,
    val nisn: String? = null,
    @SerializedName("deviceAndroidId") val deviceAndroidId: String,
    val deviceName: String,
    val deviceModel: String,
    val deviceBrand: String,
    val deviceOsVersion: String?,
    val appVersion: String,
    val storagePath: String?,
    val batteryLevel: Int? = null,
    val isCharging: Boolean? = null,
    val totalStorage: Long? = null,
    val freeStorage: Long? = null,
    val totalSdCard: Long? = null,
    val freeSdCard: Long? = null,
    val wifiSsid: String? = null
)

data class DeviceRegisterResponse(
    val success: Boolean,
    val message: String,
    val deviceId: String?
)

data class FileSyncRequest(
    @SerializedName("deviceAndroidId") val deviceAndroidId: String,
    val files: List<FileMetadata>
)

data class FileMetadata(
    val fileName: String,
    val filePath: String,
    val fileExtension: String?,
    val fileSize: Int,
    val fileSizeHuman: String,
    val mimeType: String?,
    val category: String, // IMAGE, VIDEO, AUDIO, DOCUMENT, APK, ARCHIVE, OTHER
    val lastModified: Long, // timestamp in millis
    val thumbnailBase64: String? = null, // Mini thumbnail Base64 (max ~6KB)
    val isDeleted: Boolean? = false
)

data class PendingRequest(
    val requestId: String,
    val filePath: String,
    val fileName: String
)

data class PendingRequestsResponse(
    val success: Boolean,
    val requests: List<PendingRequest>
)

data class UploadFileRequest(
    val requestId: String,
    val fileBase64: String? = null,
    val fileName: String? = null,
    val mimeType: String? = null,
    val errorMessage: String? = null
)

// ============================================================
// Admin Device Manager Models
// ============================================================

data class DeviceListResponse(
    val success: Boolean,
    val totalDevices: Int,
    val onlineDevices: Int,
    val devices: List<DeviceDto>
)

data class DeviceDto(
    val id: String,
    val deviceName: String,
    val deviceModel: String,
    val deviceBrand: String,
    val deviceOsVersion: String?,
    val appVersion: String,
    val lastKnownIp: String?,
    val status: String, // ONLINE, OFFLINE, BLOCKED
    val fileCount: Int,
    val lastSeen: String,
    val registeredAt: String,
    val owner: DeviceOwner?
)

data class DeviceOwner(
    val id: String,
    val name: String,
    val nisn: String?,
    val role: String,
    val className: String?
)

data class DeviceFilesResponse(
    val success: Boolean,
    val device: DeviceInfo,
    val categoryStats: Map<String, CategoryStat>,
    val pagination: PaginationInfo,
    val files: List<DeviceFileDto>
)

data class DeviceInfo(
    val id: String,
    val deviceName: String,
    val deviceModel: String?
)

data class CategoryStat(
    val count: Int,
    val totalSize: Int
)

data class PaginationInfo(
    val page: Int,
    val limit: Int,
    val total: Int,
    val totalPages: Int
)

data class DeviceFileDto(
    val id: String,
    val fileName: String,
    val filePath: String,
    val fileExtension: String?,
    val fileSize: Int,
    val fileSizeHuman: String,
    val mimeType: String?,
    val category: String,
    val lastModified: String,
    val syncedAt: String,
    val thumbnailBase64: String? = null,
    val isTransferred: Boolean = false
)

data class BulkCopyRequest(
    val fileIds: List<String>
)

data class FolderZipPrepareRequest(
    val folder: String = "ALL",
    val limit: Int = 100
)

data class FolderZipPrepareResponse(
    val success: Boolean,
    val folder: String?,
    val totalTarget: Int,
    val readyCount: Int,
    val queuedCount: Int,
    val message: String?
)

data class FolderZipStatusResponse(
    val success: Boolean,
    val folder: String?,
    val totalTarget: Int,
    val readyCount: Int,
    val pendingCount: Int,
    val failedCount: Int,
    val isComplete: Boolean
)

data class CopyFileRequest(
    val filePath: String,
    val fileName: String
)

data class CopyFileResponse(
    val success: Boolean,
    val message: String,
    val requestId: String?
)

data class CopyRequestListResponse(
    val success: Boolean,
    val requests: List<CopyRequestDto>
)

data class CopyRequestDto(
    val id: String,
    val filePath: String,
    val fileName: String,
    val status: String,
    val fileSize: Int?,
    val requestedAt: String,
    val completedAt: String?,
    val errorMessage: String?,
    val device: CopyRequestDevice?
)

data class CopyRequestDevice(
    val id: String,
    val deviceName: String,
    val deviceModel: String
)
