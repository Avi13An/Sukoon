package com.sukoon.app

import android.content.Intent
import android.media.audiofx.AudioEffect
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class AudioEffectsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioEffectsModule"

    private var equalizer: Equalizer? = null
    private var bassBoost: BassBoost? = null
    private var currentSessionId: Int = -1

    // Cache last applied levels so they can be re-applied when ExoPlayer changes audioSessionId
    private val bandLevels = HashMap<Int, Short>()
    private var bassStrength: Short = 0
    private var isEnabled: Boolean = true

    @ReactMethod
    fun attachSession(sessionId: Int, promise: Promise) {
        try {
            if (sessionId <= 0) {
                promise.reject("INVALID_SESSION", "Audio session ID must be greater than 0")
                return
            }

            if (sessionId == currentSessionId && equalizer != null) {
                promise.resolve(getEqualizerBandDetails())
                return
            }

            releaseEffects()
            currentSessionId = sessionId

            // Notify Android OS that this app is managing an audio effect session
            val openIntent = Intent(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION).apply {
                putExtra(AudioEffect.EXTRA_AUDIO_SESSION, sessionId)
                putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactContext.packageName)
                putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)
            }
            reactContext.sendBroadcast(openIntent)

            // Priority 1000 ensures our app has top priority on this audio track
            equalizer = Equalizer(1000, sessionId).apply {
                enabled = isEnabled
            }

            bassBoost = BassBoost(1000, sessionId).apply {
                enabled = isEnabled
                if (strengthSupported) {
                    setStrength(bassStrength)
                }
            }

            // Re-apply existing band levels to the new session
            bandLevels.forEach { (band, level) ->
                try {
                    equalizer?.setBandLevel(band.toShort(), level)
                } catch (e: Exception) {}
            }

            promise.resolve(getEqualizerBandDetails())
        } catch (e: Exception) {
            promise.reject("ATTACH_ERROR", e.message, e)
        }
    }

    private fun getEqualizerBandDetails(): WritableMap {
        val map = Arguments.createMap()
        val eq = equalizer ?: return map

        val numBands = eq.numberOfBands.toInt()
        val range = eq.bandLevelRange // [minMillibels, maxMillibels], typically -1500 to 1500
        map.putInt("numBands", numBands)
        map.putInt("minLevel", range[0].toInt())
        map.putInt("maxLevel", range[1].toInt())

        val bandsArray = Arguments.createArray()
        for (i in 0 until numBands) {
            val bandMap = Arguments.createMap()
            bandMap.putInt("index", i)
            bandMap.putInt("centerFreq", eq.getCenterFreq(i.toShort()) / 1000) // Convert mHz to Hz
            bandMap.putInt("currentLevel", eq.getBandLevel(i.toShort()).toInt())
            bandsArray.pushMap(bandMap)
        }
        map.putArray("bands", bandsArray)
        map.putBoolean("bassBoostSupported", bassBoost?.strengthSupported ?: false)
        map.putInt("bassStrength", bassStrength.toInt())
        return map
    }

    @ReactMethod
    fun setBandLevel(bandIndex: Int, levelInMillibels: Int, promise: Promise) {
        try {
            val level = levelInMillibels.coerceIn(-1500, 1500).toShort()
            bandLevels[bandIndex] = level
            equalizer?.setBandLevel(bandIndex.toShort(), level)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_BAND_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setBassBoost(strength: Int, promise: Promise) {
        try {
            val clamped = strength.coerceIn(0, 1000).toShort()
            bassStrength = clamped
            if (bassBoost?.strengthSupported == true) {
                bassBoost?.setStrength(clamped)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_BASS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setBassBoostStrength(strength: Int, promise: Promise) {
        setBassBoost(strength, promise)
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean, promise: Promise) {
        try {
            isEnabled = enabled
            equalizer?.enabled = enabled
            bassBoost?.enabled = enabled
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_ENABLED_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openSystemEqualizer(promise: Promise) {
        try {
            val intent = Intent(AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL).apply {
                if (currentSessionId > 0) {
                    putExtra(AudioEffect.EXTRA_AUDIO_SESSION, currentSessionId)
                }
                putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactContext.packageName)
                putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }

            val pm = reactContext.packageManager
            if (intent.resolveActivity(pm) != null) {
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                // Fallback: try standard sound settings intent
                val fallbackIntent = Intent(android.provider.Settings.ACTION_SOUND_SETTINGS).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                if (fallbackIntent.resolveActivity(pm) != null) {
                    reactContext.startActivity(fallbackIntent)
                    promise.resolve(true)
                } else {
                    promise.reject("NOT_SUPPORTED", "System equalizer / Dolby Atmos panel not found on this device")
                }
            }
        } catch (e: Exception) {
            promise.reject("SYSTEM_EQ_ERROR", e.message, e)
        }
    }

    private fun releaseEffects() {
        if (currentSessionId > 0) {
            try {
                val closeIntent = Intent(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION).apply {
                    putExtra(AudioEffect.EXTRA_AUDIO_SESSION, currentSessionId)
                    putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactContext.packageName)
                }
                reactContext.sendBroadcast(closeIntent)
            } catch (e: Exception) {}
        }
        try { equalizer?.release() } catch (e: Exception) {}
        try { bassBoost?.release() } catch (e: Exception) {}
        equalizer = null
        bassBoost = null
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        releaseEffects()
    }
}
