package com.school.smartcbt.data.model

import com.google.gson.annotations.SerializedName

data class WifiStatusResponse(
    @SerializedName("success") val success: Boolean = false,
    @SerializedName("isActive") val isActive: Boolean = false,
    @SerializedName("ssid") val ssid: String? = null,
    @SerializedName("hotspotServer") val hotspotServer: String? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("validUntil") val validUntil: String? = null,
    @SerializedName("message") val message: String? = null
)

data class WifiActivateRequest(
    @SerializedName("cardBarcode") val cardBarcode: String,
    @SerializedName("deviceMac") val deviceMac: String? = null,
    @SerializedName("deviceName") val deviceName: String? = null
)

data class WifiActivateResponse(
    @SerializedName("success") val success: Boolean = false,
    @SerializedName("message") val message: String? = null,
    @SerializedName("ssid") val ssid: String? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("validUntil") val validUntil: String? = null,
    @SerializedName("macBinding") val macBinding: String? = null
)
