package com.sukoon.app

import android.content.Intent
import android.media.audiofx.AudioEffect
import android.media.audiofx.LoudnessEnhancer
import android.util.Log
import com.doublesymmetry.trackplayer.TrackPlayerPlaybackService
import com.facebook.react.bridge.*

class AudioEffectsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioEffectsModule"

    private var loudnessEnhancer: LoudnessEnhancer? = null
    private var activeSessionId: Int = -1
    private var currentGainMB: Int = 0

    private fun resolveSession(): Int {
        val session = TrackPlayerPlaybackService.getActiveAudioSessionId()
        Log.d("AudioEffectsModule", "Resolved ExoPlayer audioSessionId: $session")
        return session
    }

    private fun ensureAttached(): Boolean {
        val realSession = resolveSession()
        if (realSession <= 0) {
            Log.w("AudioEffectsModule", "No active audio session found from ExoPlayer yet ($realSession)")
            return false
        }

        if (realSession == activeSessionId && loudnessEnhancer != null) {
            return true
        }

        try {
            releaseEnhancer()
            activeSessionId = realSession

            // Notify Android OS of audio effect session
            val openIntent = Intent(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION).apply {
                putExtra(AudioEffect.EXTRA_AUDIO_SESSION, realSession)
                putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactContext.packageName)
                putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)
            }
            reactContext.sendBroadcast(openIntent)

            loudnessEnhancer = LoudnessEnhancer(realSession).apply {
                enabled = currentGainMB > 0
                setTargetGain(currentGainMB)
            }
            Log.d("AudioEffectsModule", "LoudnessEnhancer attached to session $realSession with gain${currentGainMB}mB")
            return true
        } catch (e: Exception) {
            Log.e("AudioEffectsModule", "Failed to initialize LoudnessEnhancer on session $realSession", e)
            return false
        }
    }

    @ReactMethod
    fun attachSession(promise: Promise) {
        val attached = ensureAttached()
        promise.resolve(attached)
    }

    @ReactMethod
    fun setBoostGain(gainMB: Int, promise: Promise) {
        try {
            val clamped = gainMB.coerceIn(0, 2000)
            currentGainMB = clamped

            ensureAttached()

            loudnessEnhancer?.apply {
                enabled = clamped > 0
                setTargetGain(clamped)
            }
            Log.d("AudioEffectsModule", "Set boost gain to ${clamped}mB (enabled=${clamped > 0})")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e("AudioEffectsModule", "Error setting boost gain", e)
            promise.reject("BOOST_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getBoostGain(promise: Promise) {
        promise.resolve(currentGainMB)
    }

    private fun releaseEnhancer() {
        if (activeSessionId > 0) {
            try {
                val closeIntent = Intent(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION).apply {
                    putExtra(AudioEffect.EXTRA_AUDIO_SESSION, activeSessionId)
                    putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactContext.packageName)
                }
                reactContext.sendBroadcast(closeIntent)
            } catch (e: Exception) {}
        }
        try { loudnessEnhancer?.release() } catch (e: Exception) {}
        loudnessEnhancer = null
        activeSessionId = -1
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        releaseEnhancer()
    }
}
