package com.school.smartcbt.data.model

data class LoginRequest(
    val username: String,
    val password: String,
    val deviceId: String? = null,
    val role: String? = null
)

data class LoginResponse(
    val token: String,
    val user: UserDto,
    val refreshToken: String? = null
)

data class RefreshTokenRequest(
    val refreshToken: String
)

data class RefreshTokenResponse(
    val success: Boolean = true,
    val token: String,
    val message: String? = null
)

data class UserDto(
    val id: String,
    val username: String,
    val name: String,
    val role: String,
    val className: String?,
    val nisn: String?,
    val parentPhone: String?,
    val bloodType: String?,
    val points: Int?,
    val teachingSubject: String? = null,
    val teachingClasses: String? = null,
    val isClassOfficer: Boolean? = false,
    val classRole: String? = null,
    val profilePicUrl: String? = null,
    val tugasTambahan: String? = null,
    val isBk: Boolean? = false,
    val isSecurity: Boolean? = false,
    val availableRoles: List<String>? = null,
    val gender: String? = null
)

data class GateScanRequest(
    val gateCode: String,
    val nisn: String,
    val barcodeCode: String? = null,
    val studentIdentifier: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val isFakeGps: Boolean = false,
    val method: String? = null,
    val accuracy: Float? = null,
    val deviceTime: String? = null,
    val isSpecialCheckoutWithoutIn: Boolean? = false,
    val clientScanTime: Long? = null
)


data class AppVersionResponse(
    val success: Boolean,
    val update: AppVersionConfig?
)

data class AppVersionConfig(
    val versionCode: Int,
    val versionName: String,
    val downloadUrl: String,
    val fileSizeMb: Double,
    val releaseNotes: String,
    val isForceUpdate: Boolean,
    val sha256: String? = null
)