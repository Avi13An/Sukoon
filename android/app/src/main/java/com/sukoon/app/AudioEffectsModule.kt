package com.sukoon.app

import android.content.Intent
import android.media.audiofx.AudioEffect
import android.media.audiofx.LoudnessEnhancer
import com.facebook.react.bridge.*

class AudioEffectsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioEffectsModule"

    private var loudnessEnhancer: LoudnessEnhancer? = null
    private var activeSessionId: Int = -1
    private var currentGainMB: Int = 0

    private fun resolveExoPlayerSessionId(): Int {
        try {
            // Try RNTP v5 Media3 first, then v3/v4 doublesymmetry, then v2 guichaguri
            val serviceClass = try {
                Class.forName("com.doublesymmetry.trackplayer.TrackPlayerPlaybackService")
            } catch (e1: Exception) {
                try {
                    Class.forName("com.doublesymmetry.trackplayer.service.MusicService")
                } catch (e2: Exception) {
                    Class.forName("com.guichaguri.trackplayer.service.MusicService")
                }
            }

            // Check for static instance or player field
            val instanceField = serviceClass.declaredFields.firstOrNull { 
                it.type == serviceClass || it.name.contains("instance", ignoreCase = true) 
            }
            instanceField?.isAccessible = true
            val serviceInstance = instanceField?.get(null)

            if (serviceInstance != null) {
                // 1. First check if exoPlayer is directly on serviceInstance (e.g. Media3 TrackPlayerPlaybackService)
                val directExo = serviceInstance.javaClass.declaredFields.firstOrNull {
                    it.name.contains("exo", ignoreCase = true)
                }
                directExo?.isAccessible = true
                val directExoPlayer = directExo?.get(serviceInstance)
                if (directExoPlayer != null) {
                    val sessionMethod = directExoPlayer.javaClass.methods.firstOrNull { 
                        it.name == "getAudioSessionId" 
                    }
                    val id = sessionMethod?.invoke(directExoPlayer) as? Int
                    if (id != null && id > 0) return id
                }

                // 2. Otherwise check player field (RNTP v3/v4)
                val playerField = serviceInstance.javaClass.declaredFields.firstOrNull {
                    it.name.contains("player", ignoreCase = true)
                }
                playerField?.isAccessible = true
                val playerInstance = playerField?.get(serviceInstance)

                if (playerInstance != null) {
                    // Look for exoPlayer or audioSessionId
                    val exoField = playerInstance.javaClass.declaredFields.firstOrNull {
                        it.name.contains("exo", ignoreCase = true)
                    }
                    exoField?.isAccessible = true
                    val exoPlayer = exoField?.get(playerInstance) ?: playerInstance

                    val sessionMethod = exoPlayer.javaClass.methods.firstOrNull { 
                        it.name == "getAudioSessionId" 
                    }
                    val id = sessionMethod?.invoke(exoPlayer) as? Int
                    if (id != null && id > 0) return id
                }
            }
        } catch (e: Exception) {
            // Log warning and fall through to fallback
        }
        return -1
    }

    private fun ensureAttached(): Boolean {
        val realSessionId = resolveExoPlayerSessionId()
        val targetSession = if (realSessionId > 0) realSessionId else activeSessionId

        if (targetSession <= 0) return false

        if (targetSession == activeSessionId && loudnessEnhancer != null) {
            return true
        }

        try {
            releaseEnhancer()
            activeSessionId = targetSession

            // Notify Android OS of audio effect session
            val openIntent = Intent(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION).apply {
                putExtra(AudioEffect.EXTRA_AUDIO_SESSION, targetSession)
                putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactContext.packageName)
                putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)
            }
            reactContext.sendBroadcast(openIntent)

            loudnessEnhancer = LoudnessEnhancer(targetSession).apply {
                enabled = currentGainMB > 0
                setTargetGain(currentGainMB)
            }
            return true
        } catch (e: Exception) {
            return false
        }
    }

    @ReactMethod
    fun attachSession(sessionId: Int, promise: Promise) {
        if (sessionId > 0) {
            activeSessionId = sessionId
        }
        val success = ensureAttached()
        promise.resolve(success)
    }

    @ReactMethod
    fun setBoostGain(gainMB: Int, promise: Promise) {
        try {
            // Clamp 0 to 2000 millibels (+20dB boost)
            val clamped = gainMB.coerceIn(0, 2000)
            currentGainMB = clamped

            ensureAttached()

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
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        releaseEnhancer()
    }
}
