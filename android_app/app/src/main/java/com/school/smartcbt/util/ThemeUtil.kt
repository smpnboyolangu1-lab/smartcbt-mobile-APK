package com.school.smartcbt.util

import android.app.Activity
import androidx.annotation.StyleRes
import com.school.smartcbt.R

/**
 * Helper to apply the appropriate Material3 theme based on the logged‑in user role.
 * The caller should invoke `ThemeUtil.applyRoleTheme(this, role)` **before**
 * `super.onCreate(savedInstanceState)` in the Activity.
 */
object ThemeUtil {
    /** Map role identifiers to theme resource IDs. */
    private fun themeForRole(role: String): Int {
        return when (role.lowercase()) {
            "teacher" -> R.style.Theme_SmartCBT_Teacher
            "student" -> R.style.Theme_SmartCBT_Student
            "parent" -> R.style.Theme_SmartCBT_Parent
            "admin" -> R.style.Theme_SmartCBT_Admin
            else -> R.style.Theme_SmartCBT // fallback to base theme
        }
    }

    /** Apply the theme to the given activity. */
    fun applyRoleTheme(activity: Activity, role: String) {
        @StyleRes val themeRes = themeForRole(role)
        activity.setTheme(themeRes)
    }
}
