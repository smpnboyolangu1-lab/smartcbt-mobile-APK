package com.school.smartcbt.utils

import android.app.Activity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions.RESULT_FORMAT_PDF
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions.SCANNER_MODE_FULL
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning

object GoogleDocScannerHelper {

    fun createScannerOptions(): GmsDocumentScannerOptions {
        return GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false) // Wajib sorot fisik dokumen langsung
            .setPageLimit(2) // 1-2 lembar
            .setResultFormats(RESULT_FORMAT_PDF) // Wajib murni PDF
            .setScannerMode(SCANNER_MODE_FULL) // Auto-crop, de-skewing, contrast enhancements
            .build()
    }

    fun launchScanner(
        activity: Activity,
        launcher: ActivityResultLauncher<IntentSenderRequest>,
        onFailure: (Exception) -> Unit
    ) {
        val options = createScannerOptions()
        val scanner = GmsDocumentScanning.getClient(options)

        scanner.getStartScanIntent(activity)
            .addOnSuccessListener { intentSender ->
                launcher.launch(IntentSenderRequest.Builder(intentSender).build())
            }
            .addOnFailureListener { e ->
                onFailure(e)
            }
    }
}
