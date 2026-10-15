package com.school.smartcbt.utils

import android.graphics.Bitmap
import android.graphics.Color
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import java.nio.ByteBuffer

object PhotoSegmentationHelper {

    // Biru Standar Pasfoto Resmi Sekolah (Official Identity Blue #0078D4)
    const val OFFICIAL_BLUE_COLOR = 0xFF0078D4.toInt()
    const val OFFICIAL_BLUE_HEX = "#0078D4"

    fun processSelfieToBlueBackground(
        bitmap: Bitmap,
        onSuccess: (Bitmap) -> Unit,
        onError: (Exception) -> Unit
    ) {
        val options = SelfieSegmenterOptions.Builder()
            .setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE)
            .enableRawSizeMask()
            .build()

        val segmenter = Segmentation.getClient(options)
        val image = InputImage.fromBitmap(bitmap, 0)

        segmenter.process(image)
            .addOnSuccessListener { segmentationMask ->
                try {
                    val maskBuffer = segmentationMask.buffer
                    val maskWidth = segmentationMask.width
                    val maskHeight = segmentationMask.height

                    val resultBitmap = applyBlueBackgroundMask(bitmap, maskBuffer, maskWidth, maskHeight)
                    onSuccess(resultBitmap)
                } catch (e: Exception) {
                    onError(e)
                } finally {
                    segmenter.close()
                }
            }
            .addOnFailureListener { e ->
                segmenter.close()
                onError(e)
            }
    }

    private fun applyBlueBackgroundMask(
        source: Bitmap,
        maskBuffer: ByteBuffer,
        maskWidth: Int,
        maskHeight: Int
    ): Bitmap {
        val width = source.width
        val height = source.height

        val outputBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val sourcePixels = IntArray(width * height)
        source.getPixels(sourcePixels, 0, width, 0, 0, width, height)

        val outputPixels = IntArray(width * height)
        maskBuffer.rewind()

        val scaleX = maskWidth.toFloat() / width
        val scaleY = maskHeight.toFloat() / height

        // Warna biru resmi (#0078D4): R=0, G=120, B=212
        val blueRed = 0
        val blueGreen = 120
        val blueBlue = 212

        for (y in 0 until height) {
            val maskY = (y * scaleY).toInt().coerceIn(0, maskHeight - 1)
            for (x in 0 until width) {
                val maskX = (x * scaleX).toInt().coerceIn(0, maskWidth - 1)
                val maskIndex = maskY * maskWidth + maskX

                val confidence = maskBuffer.getFloat(maskIndex * 4) // Float buffer confidence 0.0 - 1.0

                val pixelIndex = y * width + x
                val srcColor = sourcePixels[pixelIndex]

                if (confidence >= 0.50f) {
                    // Sepenuhnya manusia (threshold dinaikkan ke 0.50 agar tepi baju, rambut, leher tidak terpotong)
                    outputPixels[pixelIndex] = srcColor
                } else if (confidence <= 0.30f) {
                    // Sepenuhnya background -> ganti warna biru solid #0078D4
                    outputPixels[pixelIndex] = Color.rgb(blueRed, blueGreen, blueBlue)
                } else {
                    // Zona transisi diperkecil menjadi 20% (0.30 - 0.50) untuk tepi pasfoto biometrik yang tajam & bersih
                    val alpha = ((confidence - 0.30f) / 0.20f).coerceIn(0f, 1f)
                    val srcR = Color.red(srcColor)
                    val srcG = Color.green(srcColor)
                    val srcB = Color.blue(srcColor)

                    val blendedR = (srcR * alpha + blueRed * (1f - alpha)).toInt().coerceIn(0, 255)
                    val blendedG = (srcG * alpha + blueGreen * (1f - alpha)).toInt().coerceIn(0, 255)
                    val blendedB = (srcB * alpha + blueBlue * (1f - alpha)).toInt().coerceIn(0, 255)

                    outputPixels[pixelIndex] = Color.rgb(blendedR, blendedG, blendedB)
                }
            }
        }

        outputBitmap.setPixels(outputPixels, 0, width, 0, 0, width, height)
        return outputBitmap
    }

    /**
     * Memotong bitmap ke rasio standar pasfoto 3:4 dengan fokus di tengah
     */
    fun cropToPassportRatio(source: Bitmap): Bitmap {
        val width = source.width
        val height = source.height

        val targetRatio = 3f / 4f // lebar : tinggi
        val currentRatio = width.toFloat() / height

        return if (currentRatio > targetRatio) {
            // Gambar terlalu lebar -> potong sisi kiri dan kanan
            val targetWidth = (height * targetRatio).toInt()
            val startX = (width - targetWidth) / 2
            Bitmap.createBitmap(source, startX, 0, targetWidth, height)
        } else {
            // Gambar terlalu tinggi -> potong bagian bawah (tetap pertahankan kepala di atas)
            val targetHeight = (width / targetRatio).toInt()
            val startY = (height - targetHeight) / 3 // beri sedikit ruang atas kepala
            Bitmap.createBitmap(source, 0, startY.coerceAtLeast(0), width, targetHeight.coerceAtMost(height - startY))
        }
    }
}
