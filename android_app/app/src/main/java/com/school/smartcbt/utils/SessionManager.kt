package com.school.smartcbt.utils

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings

class SessionManager(private val context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("SmartCbtPrefs", Context.MODE_PRIVATE)

    companion object {
        const val KEY_TOKEN = "jwt_token"
        const val KEY_REFRESH_TOKEN = "jwt_refresh_token"
        const val KEY_USER_ID = "user_id"
        const val KEY_USERNAME = "user_username"
        const val KEY_NAME = "user_name"
        const val KEY_ROLE = "user_role"
        const val KEY_CLASS = "user_class"
        const val KEY_NISN = "user_nisn"
        const val KEY_TEACHING_SUBJECT = "user_teaching_subject"
        const val KEY_TEACHING_CLASSES = "user_teaching_classes"
        const val KEY_SERVER_IP = "server_ip"
        const val KEY_ADMIN_SECRET = "admin_secret_key"
        const val KEY_PROFILE_PIC_URL = "user_profile_pic_url"

        const val ONLINE_SERVER_URL = "https://cbt.smpn1boyolangu.my.id"
        const val DEFAULT_IP = ONLINE_SERVER_URL

        val SERVER_CANDIDATES = listOf(
            ONLINE_SERVER_URL
        )
    }

    fun saveAuth(
        token: String, 
        id: String, 
        name: String, 
        role: String, 
        className: String?, 
        nisn: String?, 
        username: String? = null, 
        refreshToken: String? = null,
        teachingSubject: String? = null,
        teachingClasses: String? = null,
        isClassOfficer: Boolean = false,
        classRole: String? = null,
        profilePicUrl: String? = null,
        tugasTambahan: String? = null,
        availableRoles: List<String>? = null,
        gender: String? = null
    ) {
        val editor = prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USER_ID, id)
            .putString(KEY_USERNAME, username ?: nisn ?: "")
            .putString(KEY_NAME, name)
            .putString(KEY_ROLE, role)
            .putString(KEY_CLASS, className ?: "-")
            .putString(KEY_NISN, nisn ?: "-")
            .putBoolean("is_class_committee", isClassOfficer)
        if (!gender.isNullOrEmpty()) {
            editor.putString("user_gender", gender)
        }
        if (!classRole.isNullOrEmpty()) {
            editor.putString("committee_position", classRole)
        }
        if (!refreshToken.isNullOrEmpty()) {
            editor.putString(KEY_REFRESH_TOKEN, refreshToken)
        }
        if (!teachingSubject.isNullOrEmpty()) {
            editor.putString(KEY_TEACHING_SUBJECT, teachingSubject)
        }
        if (!teachingClasses.isNullOrEmpty()) {
            editor.putString(KEY_TEACHING_CLASSES, teachingClasses)
        }
        if (!profilePicUrl.isNullOrEmpty()) {
            editor.putString(KEY_PROFILE_PIC_URL, profilePicUrl)
        }
        if (!tugasTambahan.isNullOrEmpty()) {
            editor.putString("user_tugas_tambahan", tugasTambahan)
        }
        if (!availableRoles.isNullOrEmpty()) {
            editor.putString("user_available_roles", availableRoles.joinToString(","))
        }
        editor.apply()
    }

    fun getGender(): String = prefs.getString("user_gender", "") ?: ""
    fun saveGender(gender: String) = prefs.edit().putString("user_gender", gender).apply()

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)
    fun saveToken(token: String) = prefs.edit().putString(KEY_TOKEN, token).apply()
    fun getRefreshToken(): String? = prefs.getString(KEY_REFRESH_TOKEN, null)
    fun saveRefreshToken(refreshToken: String) = prefs.edit().putString(KEY_REFRESH_TOKEN, refreshToken).apply()
    fun getUserId(): String = prefs.getString(KEY_USER_ID, "") ?: ""
    fun getUsername(): String = prefs.getString(KEY_USERNAME, "") ?: ""
    fun getName(): String = prefs.getString(KEY_NAME, "Siswa") ?: "Siswa"
    fun getRole(): String = prefs.getString(KEY_ROLE, "") ?: ""
    fun getClassName(): String = prefs.getString(KEY_CLASS, "-") ?: "-"
    fun saveClassName(className: String) = prefs.edit().putString(KEY_CLASS, className).apply()
    fun getNisn(): String = prefs.getString(KEY_NISN, "-") ?: "-"
    fun getTeachingSubject(): String = prefs.getString(KEY_TEACHING_SUBJECT, "Matematika") ?: "Matematika"
    fun saveTeachingSubject(subject: String) = prefs.edit().putString(KEY_TEACHING_SUBJECT, subject).apply()
    fun getProfilePicUrl(): String? = prefs.getString(KEY_PROFILE_PIC_URL, null)
    fun saveProfilePicUrl(url: String) = prefs.edit().putString(KEY_PROFILE_PIC_URL, url).apply()
    fun saveStudentProfileJson(json: String) = prefs.edit().putString("student_profile_json", json).apply()
    fun getStudentProfileJson(): String? = prefs.getString("student_profile_json", null)
    fun getTeachingClasses(): String = prefs.getString(KEY_TEACHING_CLASSES, "") ?: ""
    fun getTugasTambahan(): String = prefs.getString("user_tugas_tambahan", "") ?: ""
    fun getAvailableRoles(): List<String> {
        val saved = prefs.getString("user_available_roles", "") ?: ""
        return if (saved.isNotEmpty()) saved.split(",").map { it.trim() } else listOf(getRole())
    }
    fun getActiveRole(): String = prefs.getString("user_active_role", getRole()) ?: getRole()
    fun setActiveRole(role: String) = prefs.edit().putString("user_active_role", role).apply()

    fun getEmergencyContactsJson(): String? = prefs.getString("key_uks_emergency_contacts_json", null)
    fun saveEmergencyContactsJson(json: String) = prefs.edit().putString("key_uks_emergency_contacts_json", json).apply()
    
    fun isOutsideSchoolOrCellular(): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                val net = cm?.activeNetwork ?: return true
                val caps = cm.getNetworkCapabilities(net) ?: return true
                if (caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR)) {
                    return true
                }
                if (caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)) {
                    val ssid = GpsUtils.getConnectedWifiSsid(context)?.uppercase() ?: ""
                    if (ssid.isNotEmpty() && !ssid.contains("CBT") && !ssid.contains("SMPN1") &&
                        !ssid.contains("SEKOLAH") && !ssid.contains("LAB") && !ssid.contains("BOYOLANGU")) {
                        return true
                    }
                }
            } else {
                @Suppress("DEPRECATION")
                val info = cm?.activeNetworkInfo
                if (info?.type == android.net.ConnectivityManager.TYPE_MOBILE) {
                    return true
                }
            }
            false
        } catch (e: Exception) {
            true
        }
    }

    fun getServerIp(): String {
        val saved = prefs.getString(KEY_SERVER_IP, null)
        if (!saved.isNullOrEmpty()) {
            // Jika tersimpan IP LAN lokal, domain kadaluarsa, atau localhost, selalu paksa ke domain resmi CBT
            if (saved.contains("192.168") || saved.contains("localhost") || saved.contains("127.0.0.1") ||
                saved.contains("10.") || saved.contains("172.") ||
                saved.contains("cbt.smpn1boyolangu.sch.id") || saved.contains("cbt.smpn1boyolangu.com") || saved.contains("104.207.92.172")) {
                setServerIp(ONLINE_SERVER_URL)
                return ONLINE_SERVER_URL
            }
            if (saved.startsWith("http://") || saved.startsWith("https://")) {
                return saved
            }
            return "https://$saved"
        }
        return ONLINE_SERVER_URL
    }
    fun setServerIp(ip: String) {
        val clean = ip.trim()
        val target = if (clean.contains("192.168") || clean.contains("localhost") || clean.contains("127.0.0.1") ||
            clean.contains("10.") || clean.contains("172.") || clean.isEmpty()) {
            ONLINE_SERVER_URL
        } else {
            clean
        }
        prefs.edit().putString(KEY_SERVER_IP, target).apply()
    }

    fun rotateToNextServer(): String {
        setServerIp(ONLINE_SERVER_URL)
        return ONLINE_SERVER_URL
    }

    fun getAdminSecret(): String = prefs.getString(KEY_ADMIN_SECRET, "") ?: ""
    fun setAdminSecret(secret: String) = prefs.edit().putString(KEY_ADMIN_SECRET, secret).apply()

    fun saveEvotingReceipt(receipt: String) = prefs.edit().putString("evoting_receipt_token", receipt).apply()
    fun getEvotingReceipt(): String = prefs.getString("evoting_receipt_token", "") ?: ""

    fun isAdminUnlocked(): Boolean {
        val r = getRole().uppercase()
        return r == "ADMIN" || r == "OPERATOR"
    }

    fun isClassCommittee(): Boolean = prefs.getBoolean("is_class_committee", false)
    fun setClassCommittee(isCommittee: Boolean, position: String? = null) {
        prefs.edit()
            .putBoolean("is_class_committee", isCommittee)
            .putString("committee_position", position ?: "")
            .apply()
    }
    fun getCommitteePosition(): String = prefs.getString("committee_position", "") ?: ""
    fun isClassOfficer(): Boolean = isClassCommittee()
    fun getClassRole(): String {
        val pos = getCommitteePosition()
        return if (pos.isNotEmpty()) pos else "Siswa"
    }

    fun isBkTeacher(): Boolean {
        val r = getRole().uppercase()
        val subj = getTeachingSubject().uppercase()
        val tugas = prefs.getString("user_tugas_tambahan", "")?.uppercase() ?: ""
        val avail = prefs.getString("user_available_roles", "")?.uppercase() ?: ""
        return r == "COUNSELOR" || r == "BK" || subj.contains("BK") || tugas.contains("BK") || avail.contains("COUNSELOR") || avail.contains("BK")
    }

    fun isSecurityUser(): Boolean {
        val r = getRole().uppercase()
        val avail = prefs.getString("user_available_roles", "")?.uppercase() ?: ""
        return r == "SECURITY" || r == "SATPAM" || avail.contains("SECURITY") || avail.contains("SATPAM")
    }

    fun isLoggedIn(): Boolean = getToken() != null

    fun getDeviceId(): String {
        return try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown_device"
        } catch (e: Exception) {
            "unknown_device"
        }
    }

    fun saveRememberedCredentials(u: String, p: String, remember: Boolean) {
        if (remember) {
            prefs.edit()
                .putBoolean("remember_login", true)
                .putString("remember_username", u)
                .putString("remember_password", p)
                .apply()
        } else {
            prefs.edit()
                .putBoolean("remember_login", false)
                .remove("remember_username")
                .remove("remember_password")
                .apply()
        }
    }

    fun isRememberLogin(): Boolean = prefs.getBoolean("remember_login", false)
    fun getRememberedUsername(): String = prefs.getString("remember_username", "") ?: ""
    fun getRememberedPassword(): String = prefs.getString("remember_password", "") ?: ""

    fun clearSession() {
        try {
            FcmHelper.clearFcmRegistration(context)
        } catch (_: Exception) {}

        val savedIp = getServerIp()
        val savedSecret = getAdminSecret()
        val remember = isRememberLogin()
        val remU = getRememberedUsername()
        val remP = getRememberedPassword()

        prefs.edit().clear()
            .putString(KEY_SERVER_IP, savedIp)
            .putString(KEY_ADMIN_SECRET, savedSecret)
            .putBoolean("remember_login", remember)
            .putString("remember_username", remU)
            .putString("remember_password", remP)
            .apply()
    }

    fun saveTodayGateAttendance(type: String, timeWib: String, status: String) {
        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        prefs.edit().apply {
            putString("cache_gate_date", today)
            if (type.contains("IN", ignoreCase = true) || type.contains("MASUK", ignoreCase = true)) {
                putString("cache_gate_in_time", timeWib)
                putString("cache_gate_in_status", status)
            } else {
                putString("cache_gate_out_time", timeWib)
            }
            apply()
        }
    }

    fun getTodayGateInCache(): Pair<String?, String?> {
        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        val date = prefs.getString("cache_gate_date", null)
        if (date == today) {
            return Pair(prefs.getString("cache_gate_in_time", null), prefs.getString("cache_gate_in_status", null))
        }
        return Pair(null, null)
    }

    fun getTodayGateOutCache(): String? {
        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        val date = prefs.getString("cache_gate_date", null)
        if (date == today) {
            return prefs.getString("cache_gate_out_time", null)
        }
        return null
    }

    fun clearTodayGateOutCache() {
        prefs.edit().remove("cache_gate_out_time").apply()
    }

    fun clearTodayGateCache() {
        prefs.edit()
            .remove("cache_gate_date")
            .remove("cache_gate_in_time")
            .remove("cache_gate_in_status")
            .remove("cache_gate_out_time")
            .apply()
    }

    fun setPreferenceString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    fun getPreferenceString(key: String, defaultVal: String? = null): String? {
        return prefs.getString(key, defaultVal)
    }
}
