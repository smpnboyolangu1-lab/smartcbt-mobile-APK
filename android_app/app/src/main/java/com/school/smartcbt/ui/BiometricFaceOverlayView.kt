package com.school.smartcbt.ui

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import android.content.Context
import android.util.AttributeSet
import android.view.View

class BiometricFaceOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val dimPaint = Paint().apply {
        color = Color.parseColor("#99000000") // Semi-transparent black outside
        style = Paint.Style.FILL
    }

    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#38BDF8") // Sky blue dashed line
        style = Paint.Style.STROKE
        strokeWidth = 6f
        pathEffect = DashPathEffect(floatArrayOf(20f, 12f), 0f)
    }

    private val guideTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 34f
        textAlign = Paint.Align.CENTER
        setShadowLayer(4f, 0f, 2f, Color.BLACK)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()

        if (w <= 0 || h <= 0) return

        val centerX = w / 2f
        val centerY = h * 0.45f

        // Head/Face Oval Dimensions
        val headRadiusX = w * 0.28f
        val headRadiusY = h * 0.20f
        val headRect = RectF(centerX - headRadiusX, centerY - headRadiusY, centerX + headRadiusX, centerY + headRadiusY)

        // Draw Guide Head Oval
        canvas.drawOval(headRect, linePaint)

        // Draw Shoulders Arch
        val shoulderTop = centerY + headRadiusY + 15f
        val shoulderBottom = shoulderTop + (h * 0.22f)
        val shoulderLeft = centerX - (w * 0.44f)
        val shoulderRight = centerX + (w * 0.44f)
        val shoulderRect = RectF(shoulderLeft, shoulderTop, shoulderRight, shoulderBottom)
        canvas.drawArc(shoulderRect, 180f, 180f, false, linePaint)

        // Draw Instruction Text
        canvas.drawText("Posisikan Kepala & Bahu di Dalam Bingkai", centerX, centerY - headRadiusY - 35f, guideTextPaint)
    }
}
