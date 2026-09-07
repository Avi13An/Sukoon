package com.sukoon.app

import android.content.Intent
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.Virtualizer
import com.facebook.react.bridge.*

class AudioEffectsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioEffectsModule"

    private var bassBoost: BassBoost? = null
    private var equalizer: Equalizer? = null
    private var virtualizer: Virtualizer? = null
    private var currentSessionId: Int = 0

    @ReactMethod
    fun initAudioEffects(audioSessionId: Int, promise: Promise) {
        try {
            releaseEffects()
            currentSessionId = audioSessionId
            // Session 0 applies to standard audio output mix
            bassBoost = BassBoost(0, currentSessionId).apply { enabled = true }
            equalizer = Equalizer(0, currentSessionId).apply { enabled = true }
            virtualizer = Virtualizer(0, currentSessionId).apply { enabled = true }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("AUDIO_FX_INIT_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun setBassBoostStrength(strength: Int, promise: Promise) {
        try {
            if (bassBoost == null) {
                bassBoost = BassBoost(0, currentSessionId).apply { enabled = true }
            }
            bassBoost?.let {
                it.enabled = strength > 0
                val clamped = strength.coerceIn(0, 1000).toShort()
                it.setStrength(clamped)
                promise.resolve(true)
            } ?: promise.reject("NO_BASS_BOOST", "BassBoost not initialized")
        } catch (e: Exception) {
            promise.reject("BASS_BOOST_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun setBandLevel(band: Int, level: Int, promise: Promise) {
        try {
            if (equalizer == null) {
                equalizer = Equalizer(0, currentSessionId).apply { enabled = true }
            }
            equalizer?.let {
                it.enabled = true
                val clamped = level.coerceIn(-1500, 1500).toShort()
                it.setBandLevel(band.toShort(), clamped)
                promise.resolve(true)
            } ?: promise.reject("NO_EQUALIZER", "Equalizer not initialized")
        } catch (e: Exception) {
            promise.reject("EQUALIZER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun applyPreset(presetIndex: Int, promise: Promise) {
        try {
            if (equalizer == null) {
                equalizer = Equalizer(0, currentSessionId).apply { enabled = true }
            }
            equalizer?.let {
                it.enabled = true
                it.usePreset(presetIndex.toShort())
                promise.resolve(true)
            } ?: promise.reject("NO_EQUALIZER", "Equalizer not initialized")
        } catch (e: Exception) {
            promise.reject("PRESET_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun setVirtualizerStrength(strength: Int, promise: Promise) {
        try {
            if (virtualizer == null) {
                virtualizer = Virtualizer(0, currentSessionId).apply { enabled = true }
            }
            virtualizer?.let {
                it.enabled = strength > 0
                val clamped = strength.coerceIn(0, 1000).toShort()
                it.setStrength(clamped)
                promise.resolve(true)
            } ?: promise.reject("NO_VIRTUALIZER", "Virtualizer not initialized")
        } catch (e: Exception) {
            promise.reject("VIRTUALIZER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun openSystemEqualizer(promise: Promise) {
        try {
            val intent = Intent("android.media.action.DISPLAY_AUDIO_EFFECT_CONTROL_PANEL").apply {
                putExtra("android.media.extra.CONTENT_TYPE", 0)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SYSTEM_EQ_ERROR", e.localizedMessage, e)
        }
    }

    private fun releaseEffects() {
        try { bassBoost?.release() } catch (_: Exception) {}
        try { equalizer?.release() } catch (_: Exception) {}
        try { virtualizer?.release() } catch (_: Exception) {}
        bassBoost = null
        equalizer = null
        virtualizer = null
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        releaseEffects()
    }
}
