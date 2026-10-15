package com.school.smartcbt.utils

import android.content.Context
import android.graphics.*
import android.graphics.pdf.PdfDocument
import java.io.File
import java.io.FileOutputStream

/**
 * CamScannerHelper
 * Modul pemrosesan berkas dokumen & pas foto otomatis:
 * 1. Filter auto-enhancement dokumen tajam & bersih layaknya CamScanner.
 * 2. Konversi berkas foto menjadi file PDF standar resmi (A4 / Folio).
 * 3. Auto-proses pas foto siswa 3x4 dengan latar belakang biru resmi (#0078D4).
 * 4. Fungsi rotasi bitmap untuk penyesuaian review berkas.
 */
object CamScannerHelper {

    /**
     * Menerapkan filter kontras & brightness dokumen agar teks tajam dan latar putih bersih
     */
    fun applyCamScannerFilter(originalBitmap: Bitmap): Bitmap {
        val width = originalBitmap.width
        val height = originalBitmap.height

        val enhancedBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(enhancedBitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        // ColorMatrix: Tingkatkan kontras dan kecerahan dokumen teks
        val cm = ColorMatrix(floatArrayOf(
            1.25f, 0f, 0f, 0f, 12f,   // Red
            0f, 1.25f, 0f, 0f, 12f,   // Green
            0f, 0f, 1.25f, 0f, 12f,   // Blue
            0f, 0f, 0f, 1.0f, 0f     // Alpha
        ))

        paint.colorFilter = ColorMatrixColorFilter(cm)
        canvas.drawBitmap(originalBitmap, 0f, 0f, paint)

        return enhancedBitmap
    }

    /**
     * Memutar bitmap sebesar [degrees] derajat (misal 90 derajat searah jarum jam)
     */
    fun rotateBitmap(bitmap: Bitmap, degrees: Float): Bitmap {
        if (degrees == 0f) return bitmap
        val matrix = Matrix().apply { postRotate(degrees) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    /**
     * Otomatis memproses foto siswa menjadi Pas Foto standar rasio 3x4
     * berlatar belakang biru resmi (#0078D4) khas foto ijazah/raport sekolah.
     */
    fun createPasFoto3x4(originalBitmap: Bitmap): Bitmap {
        val targetWidth = 600
        val targetHeight = 800
        val targetAspect = 3f / 4f

        val srcW = originalBitmap.width
        val srcH = originalBitmap.height
        val srcAspect = srcW.toFloat() / srcH.toFloat()

        val cropW: Int
        val cropH: Int
        val cropX: Int
        val cropY: Int

        if (srcAspect > targetAspect) {
            // Gambar terlalu lebar: crop sisi kiri & kanan (ambil tengah)
            cropH = srcH
            cropW = (srcH * targetAspect).toInt().coerceAtMost(srcW)
            cropX = ((srcW - cropW) / 2).coerceAtLeast(0)
            cropY = 0
        } else {
            // Gambar terlalu tinggi: crop bagian bawah (ambil fokus wajah & bahu di atas)
            cropW = srcW
            cropH = (srcW / targetAspect).toInt().coerceAtMost(srcH)
            cropX = 0
            cropY = 0
        }

        val cropped = Bitmap.createBitmap(originalBitmap, cropX, cropY, cropW, cropH)

        // Buat bitmap output 600x800 dengan background biru resmi (#0078D4)
        val resultBitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(resultBitmap)

        // 1. Gambar latar belakang biru resmi
        val bgPaint = Paint().apply {
            color = Color.parseColor("#0078D4") // Biru Resmi Ijazah/Sekolah
            style = Paint.Style.FILL
        }
        canvas.drawRect(0f, 0f, targetWidth.toFloat(), targetHeight.toFloat(), bgPaint)

        // 2. Gambar foto siswa dengan sedikit auto-brighten portrait
        val photoPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        val cm = ColorMatrix(floatArrayOf(
            1.08f, 0f, 0f, 0f, 5f,
            0f, 1.08f, 0f, 0f, 5f,
            0f, 0f, 1.08f, 0f, 5f,
            0f, 0f, 0f, 1.0f, 0f
        ))
        photoPaint.colorFilter = ColorMatrixColorFilter(cm)

        val destRect = RectF(0f, 0f, targetWidth.toFloat(), targetHeight.toFloat())
        canvas.drawBitmap(cropped, null, destRect, photoPaint)

        return resultBitmap
    }

    /**
     * Menyimpan bitmap ke format file JPEG di cache aplikasi
     */
    fun saveBitmapToJpeg(context: Context, bitmap: Bitmap, fileName: String): File {
        val file = File(context.cacheDir, "$fileName.jpg")
        var fos: FileOutputStream? = null
        try {
            fos = FileOutputStream(file)
            bitmap.compress(Bitmap.CompressFormat.JPEG, 92, fos)
        } finally {
            fos?.close()
        }
        return file
    }

    /**
     * Mengonversi Bitmap hasil jepretan kamera / upload menjadi file Dokumen PDF A4/Folio standar
     */
    fun convertBitmapToDocumentPdf(
        context: Context,
        sourceBitmap: Bitmap,
        outputFileName: String
    ): File {
        // Standard A4: 595 x 842 pt
        val pageWidth = 595
        val pageHeight = 842

        val pdfDocument = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(pageWidth, pageHeight, 1).create()
        val page = pdfDocument.startPage(pageInfo)
        val canvas = page.canvas

        // Terapkan filter dokumen CamScanner
        val enhanced = applyCamScannerFilter(sourceBitmap)

        // Skala bitmap agar muat rapi di halaman PDF dengan margin 20pt
        val margin = 20f
        val targetWidth = pageWidth - (margin * 2)
        val targetHeight = pageHeight - (margin * 2)

        val srcW = enhanced.width.toFloat()
        val srcH = enhanced.height.toFloat()

        val scale = Math.min(targetWidth / srcW, targetHeight / srcH)
        val drawW = srcW * scale
        val drawH = srcH * scale

        val left = margin + (targetWidth - drawW) / 2f
        val top = margin + (targetHeight - drawH) / 2f

        val destRect = RectF(left, top, left + drawW, top + drawH)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        canvas.drawColor(Color.WHITE)
        canvas.drawBitmap(enhanced, null, destRect, paint)

        pdfDocument.finishPage(page)

        // Simpan ke file cache PDF
        val outputPdfFile = File(context.cacheDir, "$outputFileName.pdf")
        var fos: FileOutputStream? = null
        try {
            fos = FileOutputStream(outputPdfFile)
            pdfDocument.writeTo(fos)
        } finally {
            fos?.close()
            pdfDocument.close()
        }

        return outputPdfFile
    }
}
