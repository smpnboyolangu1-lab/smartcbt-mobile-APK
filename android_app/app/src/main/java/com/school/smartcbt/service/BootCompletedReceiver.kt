package com.school.smartcbt.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootCompletedReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "BootCompletedReceiver"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) return
        val action = intent?.action
        Log.d(TAG, "BootCompletedReceiver onReceive action: $action")

        if (Intent.ACTION_BOOT_COMPLETED == action ||
            Intent.ACTION_MY_PACKAGE_REPLACED == action ||
            "android.intent.action.QUICKBOOT_POWERON" == action) {
            try {
                DeviceSyncBackgroundService.startService(context)
            } catch (e: Exception) {
                Log.e(TAG, "Error starting DeviceSyncBackgroundService on boot: ${e.message}")
            }
        }
    }
}
