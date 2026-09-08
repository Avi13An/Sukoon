package com.sukoon.app

import android.content.Intent
import android.media.audiofx.AudioEffect
import android.media.audiofx.LoudnessEnhancer
import com.facebook.react.bridge.*

class AudioEffectsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioEffectsModule"

    private var loudnessEnhancer: LoudnessEnhancer? = null
    private var currentSessionId: Int = -1
    private var currentGainMB: Int = 0 // 0 mB (Normal) to 1500 mB (+15dB ~ 200%)

    @ReactMethod
    fun attachSession(sessionId: Int, promise: Promise) {
        try {
            if (sessionId <= 0) {
                promise.resolve(false)
                return
            }
            if (sessionId == currentSessionId && loudnessEnhancer != null) {
                promise.resolve(true)
                return
            }

            releaseEnhancer()
            currentSessionId = sessionId

            // Notify Android OS of audio effect session
            val openIntent = Intent(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION).apply {
                putExtra(AudioEffect.EXTRA_AUDIO_SESSION, sessionId)
                putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactContext.packageName)
                putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)
            }
            reactContext.sendBroadcast(openIntent)

            loudnessEnhancer = LoudnessEnhancer(sessionId).apply {
                enabled = currentGainMB > 0
                setTargetGain(currentGainMB)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun setBoostGain(gainMB: Int, promise: Promise) {
        try {
            // Clamp between 0 mB (0% boost) and 1500 mB (+15dB / ~200% volume)
            val clamped = gainMB.coerceIn(0, 1500)
            currentGainMB = clamped
            loudnessEnhancer?.apply {
                enabled = clamped > 0
                setTargetGain(clamped)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("BOOST_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getBoostGain(promise: Promise) {
        promise.resolve(currentGainMB)
    }

    private fun releaseEnhancer() {
        if (currentSessionId > 0) {
            try {
                val closeIntent = Intent(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION).apply {
                    putExtra(AudioEffect.EXTRA_AUDIO_SESSION, currentSessionId)
                    putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactContext.packageName)
                }
                reactContext.sendBroadcast(closeIntent)
            } catch (e: Exception) {}
        }
        try { loudnessEnhancer?.release() } catch (e: Exception) {}
        loudnessEnhancer = null
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        releaseEnhancer()
    }
}
