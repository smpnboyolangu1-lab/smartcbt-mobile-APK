package com.school.smartcbt.utils

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

object TtsVoiceHelper {
    private const val TAG = "TtsVoiceHelper"
    private var tts: TextToSpeech? = null
    private var isReady = false
    private var appContext: Context? = null
    private val pendingSpeechQueue = mutableListOf<String>()

    private var toneGenerator: ToneGenerator? = null

    @Synchronized
    fun init(context: Context) {
        appContext = context.applicationContext
        if (tts != null && isReady) return

        try {
            tts = TextToSpeech(appContext) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    try {
                        val audioAttributes = AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                        tts?.setAudioAttributes(audioAttributes)
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to set audio attributes: ${e.message}")
                    }

                    val localeId = Locale("id", "ID")
                    val langResult = tts?.setLanguage(localeId)
                    if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                        Log.w(TAG, "Indonesian TTS locale not fully supported, falling back to default locale")
                        tts?.setLanguage(Locale.getDefault())
                    }
                    tts?.setPitch(1.05f)
                    tts?.setSpeechRate(0.98f)
                    isReady = true
                    Log.i(TAG, "TextToSpeech successfully initialized in Indonesian with USAGE_MEDIA")

                    synchronized(pendingSpeechQueue) {
                        for (text in pendingSpeechQueue) {
                            speakInternal(text)
                        }
                        pendingSpeechQueue.clear()
                    }
                } else {
                    Log.e(TAG, "Failed to initialize TextToSpeech, status: $status")
                    isReady = false
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception initializing TextToSpeech: ${e.message}")
        }
    }

    fun speak(text: String) {
        if (text.isBlank()) return
        if (!isReady || tts == null) {
            appContext?.let { init(it) }
            synchronized(pendingSpeechQueue) {
                if (pendingSpeechQueue.size < 4) {
                    pendingSpeechQueue.add(text)
                }
            }
            return
        }
        speakInternal(text)
    }

    private fun speakInternal(text: String) {
        try {
            val params = Bundle().apply {
                putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC)
                putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f)
            }
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, "SMARTCBT_TTS_" + System.currentTimeMillis())
        } catch (e: Exception) {
            Log.e(TAG, "Error in speakInternal: ${e.message}")
        }
    }

    // ================= SUKSES PRESENSI =================
    fun speakMasukTepatWaktu(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Presensi masuk berhasil dicatat. Selamat pagi $cleanName, selamat belajar dan raih prestasimu hari ini!")
    }

    fun speakMasukTerlambat(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Presensi masuk berhasil dicatat. Selamat pagi $cleanName, Anda tercatat terlambat hari ini. Tetap semangat mengikuti pelajaran.")
    }

    fun speakPulang(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Presensi kepulangan berhasil dicatat. Terima kasih $cleanName, hati-hati di perjalanan pulang sampai jumpa besok.")
    }

    fun speakPresensiKbm(name: String, subject: String) {
        val cleanName = cleanStudentName(name)
        speak("Presensi kelas berhasil dicatat untuk mata pelajaran $subject. Selamat belajar $cleanName!")
    }

    fun speakDibantuPengurus(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Presensi dibantu berhasil. $cleanName telah tercatat hadir di kelas.")
    }

    fun speakMushola(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Jazakallahu khairan, $cleanName. Presensi sholat berjamaah telah tercatat.")
    }

    fun speakSholatDhuha(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Alhamdulillah $cleanName, presensi sholat dhuha di mushola berhasil dicatat. Selamat menunaikan ibadah sholat dhuha.")
    }

    fun speakSholatDhuhur(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Alhamdulillah $cleanName, presensi sholat dhuhur berjamaah di mushola berhasil dicatat. Selamat menunaikan sholat dhuhur.")
    }

    fun speakKeputrian(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Presensi kegiatan keputrian berhasil dicatat untuk $cleanName. Selamat mengikuti bimbingan keputrian.")
    }

    fun speakBelumPresensiKelasDhuha(name: String = "") {
        val cleanName = if (name.isNotBlank()) cleanStudentName(name) else ""
        val prefix = if (cleanName.isNotBlank()) "$cleanName, " else ""
        speak("Peringatan. ${prefix}Anda harus melakukan presensi masuk di ruang kelas terlebih dahulu sebelum presensi sholat dhuha di mushola.")
    }

    fun speakBarcodePulangKelasDitutupAdaSholat() {
        speak("Peringatan. Barcode pulang di ruang kelas ditutup karena kelas Anda memiliki jadwal sholat di mushola. Silakan sholat dan pindai barcode kepulangan di mushola.")
    }

    // ================= PRESENSI SHOLAT MUSHOLA (GURU PAI SCAN KARTU) =================
    fun speakPaiScanSholatSuccess(name: String, className: String, prayerType: String) {
        val cleanName = cleanStudentName(name)
        val cleanClass = if (className.isNotBlank() && className != "-") "Kelas $className" else ""
        playBeepSuccess()
        speak("$cleanName, $cleanClass, Hadir Sholat $prayerType berjamaah.")
    }

    fun speakPaiScanKeputrianSuccess(name: String, className: String) {
        val cleanName = cleanStudentName(name)
        val cleanClass = if (className.isNotBlank() && className != "-") "Kelas $className" else ""
        playBeepSuccess()
        speak("$cleanName, $cleanClass, Hadir Pembinaan Keputrian.")
    }

    fun speakPaiScanAlreadyDone(name: String, prayerType: String, time: String) {
        val cleanName = cleanStudentName(name)
        playBeepError()
        val timeInfo = if (time.isNotBlank()) "pukul $time" else ""
        speak("$cleanName sudah tercatat presensi $prayerType $timeInfo.")
    }

    fun speakPaiCardNotFound() {
        playBeepError()
        speak("Presensi ditolak. Kartu pelajar tidak terdaftar di database sekolah.")
    }

    // ================= KASIR E-KANTIN =================
    fun speakPaymentSuccess(name: String, amount: Long) {
        val cleanName = cleanStudentName(name)
        speak("Pembayaran berhasil. Uang saku $cleanName terpotong $amount rupiah. Terima kasih.")
    }

    fun speakPaymentFailed(reason: String) {
        speak("Pembayaran kasir ditolak. $reason")
    }

    // ================= GAGAL / PENOLAKAN INFORMATIF =================
    fun speakGpsDitolak() {
        speak("Presensi gagal. Anda terdeteksi berada di luar area sekolah. Silakan mendekat ke area kelas atau gerbang sekolah.")
    }

    fun speakBedaKelas(targetName: String, targetClass: String) {
        val cleanName = cleanStudentName(targetName)
        speak("Presensi gagal. $cleanName adalah siswa kelas $targetClass. Bantuan presensi hanya berlaku untuk teman satu kelas.")
    }

    fun speakSudahAbsen(name: String, type: String = "presensi") {
        val cleanName = cleanStudentName(name)
        speak("Presensi tidak dapat diproses. $cleanName sudah tercatat hadir untuk sesi $type hari ini.")
    }

    fun speakKartuInvalid() {
        speak("Presensi gagal. Kartu pelajar tidak valid atau tidak dikenali oleh sistem sekolah.")
    }

    fun speakBarcodeDitutup() {
        speak("Gerbang kelas telah ditutup. Silakan menuju ke Ruang BK atau hubungi Guru BK untuk mendapatkan izin.")
    }

    fun speakSalahScanGateOutPagi() {
        speak("Peringatan. Yang Anda pindai adalah barcode kepulangan. Gerbang pulang masih ditutup. Silakan pindai barcode masuk di pintu ruang kelas Anda.")
    }

    fun speakBelumScanMasuk() {
        speak("Peringatan presensi. Anda belum memindai presensi masuk pagi hari ini. Silakan konfirmasi untuk presensi kepulangan khusus.")
    }

    fun speakBedaKelas() {
        speak("Presensi ditolak. Barcode yang Anda pindai adalah barcode ruang kelas lain, bukan ruang kelas Anda.")
    }

    fun speakFakeGps() {
        speak("Presensi ditolak. Terdeteksi aplikasi lokasi palsu atau Fake G P S pada perangkat Anda.")
    }

    fun speakSatpamCheckout(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Izin keluar gerbang sah untuk $cleanName. Siswa diizinkan melewati pos satpam.")
    }

    fun speakSatpamReturn(name: String) {
        val cleanName = cleanStudentName(name)
        speak("Verifikasi berhasil. $cleanName tercatat kembali masuk kampus sekolah.")
    }

    fun speakSatpamDitolak() {
        speak("Verifikasi pos keamanan ditolak. Tiket izin tidak valid atau sudah kedaluwarsa.")
    }

    fun speakLiburSekolah() {
        speak("Hari ini adalah hari libur operasional sekolah. Selamat berlibur.")
    }

    @Synchronized
    private fun getOrCreateToneGenerator(): ToneGenerator? {
        if (toneGenerator == null) {
            try {
                toneGenerator = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
            } catch (e: Exception) {
                Log.w(TAG, "ToneGenerator STREAM_MUSIC init failed: ${e.message}")
                try {
                    toneGenerator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100)
                } catch (e2: Exception) {
                    Log.e(TAG, "ToneGenerator notification fallback failed: ${e2.message}")
                }
            }
        }
        return toneGenerator
    }

    fun playBeepSuccess() {
        try {
            val tg = getOrCreateToneGenerator()
            if (tg != null) {
                tg.startTone(ToneGenerator.TONE_PROP_BEEP, 220)
            } else {
                playFallbackSound()
            }
        } catch (e: Exception) {
            Log.w(TAG, "playBeepSuccess error: ${e.message}")
            playFallbackSound()
        }
    }

    fun playBeepError() {
        try {
            val tg = getOrCreateToneGenerator()
            if (tg != null) {
                tg.startTone(ToneGenerator.TONE_PROP_BEEP2, 350)
            } else {
                playFallbackSound()
            }
        } catch (e: Exception) {
            Log.w(TAG, "playBeepError error: ${e.message}")
            playFallbackSound()
        }
    }

    private fun playFallbackSound() {
        try {
            appContext?.let { ctx ->
                val notification = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                val r = RingtoneManager.getRingtone(ctx, notification)
                r?.play()
            }
        } catch (_: Exception) {}
    }

    private fun cleanStudentName(name: String): String {
        val parts = name.trim().split(" ")
        return if (parts.size <= 2) name.trim() else "${parts[0]} ${parts[1]}"
    }

    fun shutdown() {
        // Kept for backward compatibility but avoid killing active singleton across activity lifecycles
        try {
            tts?.stop()
        } catch (_: Exception) {}
    }
}
