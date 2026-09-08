package com.sukoon.app

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayList

class AudioMixerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioMixerModule"

    data class DecodedAudioTrack(
        val samples: ShortArray,
        val sampleRate: Int,
        val channelCount: Int
    )

    @ReactMethod
    fun mixTracks(
        vocalPath: String,
        musicPath: String,
        outputPath: String,
        vocalVolume: Float,
        musicVolume: Float,
        startTimeMs: Double,
        promise: Promise
    ) {
        Thread {
            try {
                val cleanVocalPath = if (vocalPath.startsWith("file://")) vocalPath.substring(7) else vocalPath
                val cleanMusicPath = if (musicPath.startsWith("file://")) musicPath.substring(7) else musicPath
                val cleanOutputPath = if (outputPath.startsWith("file://")) outputPath.substring(7) else outputPath

                val vocalFile = File(cleanVocalPath)
                if (!vocalFile.exists()) {
                    throw IllegalArgumentException("Vocal file does not exist: $cleanVocalPath")
                }

                val musicFile = File(cleanMusicPath)
                if (!musicFile.exists()) {
                    throw IllegalArgumentException("Backing music file does not exist: $cleanMusicPath")
                }

                // 1. Decode Vocals
                val decodedVocal = decodeAudioToPcm(cleanVocalPath)
                val vocalDurationMs = (decodedVocal.samples.size / decodedVocal.channelCount).toDouble() / decodedVocal.sampleRate * 1000.0

                // 2. Decode Backing Track Segment
                val decodedMusic = decodeAudioToPcm(cleanMusicPath, startTimeMs, vocalDurationMs + 1000.0)

                // 3. Convert both to standard 44.1kHz Stereo PCM (mono vocal -> stereo [V0, V0, V1, V1])
                val vocalStereo = convertTo44100Stereo(decodedVocal)
                val musicStereo = convertTo44100Stereo(decodedMusic)

                // 4. Mix formulation with headroom
                val VOCAL_MAKEUP_GAIN = 1.5f
                val effectiveVocalVolume = vocalVolume * VOCAL_MAKEUP_GAIN

                val totalFrames = if (vocalStereo.size > 0) vocalStereo.size / 2 else (musicStereo.size / 2)
                val mixedStereo = ShortArray(totalFrames * 2)

                for (i in 0 until totalFrames) {
                    val vL = if (i * 2 < vocalStereo.size) vocalStereo[i * 2].toFloat() else 0f
                    val vR = if (i * 2 + 1 < vocalStereo.size) vocalStereo[i * 2 + 1].toFloat() else 0f

                    val mL = if (i * 2 < musicStereo.size) musicStereo[i * 2].toFloat() else 0f
                    val mR = if (i * 2 + 1 < musicStereo.size) musicStereo[i * 2 + 1].toFloat() else 0f

                    val mixL = (vL * effectiveVocalVolume + mL * musicVolume).toInt()
                    val mixR = (vR * effectiveVocalVolume + mR * musicVolume).toInt()

                    // Soft clamp to prevent digital clipping [-32768, 32767]
                    mixedStereo[i * 2] = Math.max(-32768, Math.min(32767, mixL)).toShort()
                    mixedStereo[i * 2 + 1] = Math.max(-32768, Math.min(32767, mixR)).toShort()
                }

                // 5. Encode clean 44.1kHz 192kbps AAC M4A output via MediaCodec & MediaMuxer
                encodePcmToM4a(mixedStereo, cleanOutputPath, 44100, 192000)

                val vocalCount = vocalStereo.size
                val musicCount = musicStereo.size
                android.util.Log.i("AudioMixerModule", "AudioMixer: Successfully mixed $vocalCount vocal samples with $musicCount music samples into $cleanOutputPath")

                promise.resolve(cleanOutputPath)
            } catch (e: Throwable) {
                promise.reject("AUDIO_MIX_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun applyMakeupGain(
        inputPath: String,
        outputPath: String,
        gainDb: Float,
        promise: Promise
    ) {
        Thread {
            try {
                val decoded = decodeAudioToPcm(inputPath)
                val linearGain = Math.pow(10.0, (gainDb / 20.0).toDouble()).toFloat()
                val samples = decoded.samples
                val boosted = ShortArray(samples.size)

                for (i in samples.indices) {
                    val s = (samples[i] * linearGain).toInt()
                    boosted[i] = Math.max(-32768, Math.min(32767, s)).toShort()
                }

                val stereo = if (decoded.channelCount == 1) {
                    val st = ShortArray(boosted.size * 2)
                    for (i in boosted.indices) {
                        st[i * 2] = boosted[i]
                        st[i * 2 + 1] = boosted[i]
                    }
                    st
                } else {
                    boosted
                }

                encodePcmToM4a(stereo, outputPath, decoded.sampleRate, 192000)
                promise.resolve(outputPath)
            } catch (e: Throwable) {
                promise.reject("GAIN_BOOST_ERROR", e.message, e)
            }
        }.start()
    }

    private fun decodeAudioToPcm(
        filePath: String,
        startOffsetMs: Double = 0.0,
        maxDurationMs: Double = -1.0
    ): DecodedAudioTrack {
        val cleanPath = if (filePath.startsWith("file://")) filePath.substring(7) else filePath
        val file = File(cleanPath)
        if (!file.exists()) {
            throw IllegalArgumentException("Audio file does not exist: $cleanPath")
        }

        val extractor = MediaExtractor()
        extractor.setDataSource(cleanPath)

        var trackIndex = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(i)
            val mime = f.getString(MediaFormat.KEY_MIME)
            if (mime?.startsWith("audio/") == true) {
                trackIndex = i
                format = f
                break
            }
        }

        if (trackIndex == -1 || format == null) {
            extractor.release()
            throw IllegalArgumentException("No audio track found in file: $cleanPath")
        }

        extractor.selectTrack(trackIndex)

        val targetStartUs = (startOffsetMs * 1000.0).toLong()
        if (targetStartUs > 0) {
            extractor.seekTo(targetStartUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
        }

        val mime = format.getString(MediaFormat.KEY_MIME) ?: MediaFormat.MIMETYPE_AUDIO_AAC
        val decoder = MediaCodec.createDecoderByType(mime)
        decoder.configure(format, null, null, 0)
        decoder.start()

        val outList = ArrayList<ShortArray>()
        var totalSamples = 0

        var actualSampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
        var actualChannelCount = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2

        val bufferInfo = MediaCodec.BufferInfo()
        var inputEOS = false
        var outputEOS = false
        val TIMEOUT_US = 5000L

        try {
            while (!outputEOS) {
                if (!inputEOS) {
                    val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
                    if (inIndex >= 0) {
                        val inBuffer = decoder.getInputBuffer(inIndex)
                        if (inBuffer != null) {
                            val sampleSize = extractor.readSampleData(inBuffer, 0)
                            if (sampleSize < 0) {
                                decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputEOS = true
                            } else {
                                val pts = extractor.sampleTime
                                decoder.queueInputBuffer(inIndex, 0, sampleSize, pts, 0)
                                extractor.advance()
                            }
                        }
                    }
                }

                val outIndex = decoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
                if (outIndex >= 0) {
                    val outBuffer = decoder.getOutputBuffer(outIndex)
                    if (outBuffer != null && bufferInfo.size > 0) {
                        if (targetStartUs <= 0 || bufferInfo.presentationTimeUs >= targetStartUs - 50000) {
                            outBuffer.position(bufferInfo.offset)
                            outBuffer.limit(bufferInfo.offset + bufferInfo.size)
                            val sBuf = outBuffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                            val numShorts = sBuf.remaining()
                            val chunk = ShortArray(numShorts)
                            sBuf.get(chunk)
                            outList.add(chunk)
                            totalSamples += numShorts

                            if (maxDurationMs > 0) {
                                val elapsedMs = (totalSamples / actualChannelCount).toDouble() / actualSampleRate * 1000.0
                                if (elapsedMs >= maxDurationMs) {
                                    outputEOS = true
                                }
                            }
                        }
                    }
                    decoder.releaseOutputBuffer(outIndex, false)
                    if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputEOS = true
                    }
                } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val newFormat = decoder.outputFormat
                    if (newFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        actualSampleRate = newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    }
                    if (newFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                        actualChannelCount = newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    }
                }
            }
        } finally {
            try { decoder.stop() } catch (e: Exception) {}
            try { decoder.release() } catch (e: Exception) {}
            try { extractor.release() } catch (e: Exception) {}
        }

        val result = ShortArray(totalSamples)
        var writePos = 0
        for (chunk in outList) {
            val copyLen = Math.min(chunk.size, totalSamples - writePos)
            System.arraycopy(chunk, 0, result, writePos, copyLen)
            writePos += copyLen
            if (writePos >= totalSamples) break
        }

        return DecodedAudioTrack(result, actualSampleRate, actualChannelCount)
    }

    private fun convertTo44100Stereo(track: DecodedAudioTrack): ShortArray {
        val srcSamples = track.samples
        val srcRate = track.sampleRate
        val srcChannels = track.channelCount

        if (srcSamples.isEmpty()) return ShortArray(0)

        val srcFrames = srcSamples.size / srcChannels
        val dstRate = 44100
        val dstFrames = if (srcRate == dstRate) srcFrames else ((srcFrames.toLong() * dstRate) / srcRate).toInt()

        val outStereo = ShortArray(dstFrames * 2)

        for (i in 0 until dstFrames) {
            val srcFrameIdx = if (srcRate == dstRate) i else ((i.toLong() * srcRate) / dstRate).toInt()
            if (srcFrameIdx >= srcFrames) break

            if (srcChannels == 1) {
                val sample = srcSamples[srcFrameIdx]
                outStereo[i * 2] = sample
                outStereo[i * 2 + 1] = sample
            } else {
                val left = srcSamples[srcFrameIdx * srcChannels]
                val right = srcSamples[srcFrameIdx * srcChannels + 1]
                outStereo[i * 2] = left
                outStereo[i * 2 + 1] = right
            }
        }

        return outStereo
    }

    private fun encodePcmToM4a(
        pcmStereo: ShortArray,
        outputPath: String,
        sampleRate: Int = 44100,
        bitRate: Int = 192000
    ) {
        val cleanOutputPath = if (outputPath.startsWith("file://")) outputPath.substring(7) else outputPath
        val outputFile = File(cleanOutputPath)
        outputFile.parentFile?.mkdirs()
        if (outputFile.exists()) {
            outputFile.delete()
        }

        val encodeFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, 2).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
        }

        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        encoder.configure(encodeFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        encoder.start()

        val muxer = MediaMuxer(cleanOutputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var muxerTrackIndex = -1
        var muxerStarted = false

        val pcmByteBuf = ByteBuffer.allocateDirect(pcmStereo.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        val sBuf = pcmByteBuf.asShortBuffer()
        sBuf.put(pcmStereo)
        pcmByteBuf.position(0)

        val bufferInfo = MediaCodec.BufferInfo()
        val TIMEOUT_US = 5000L
        var inputEOS = false
        var outputEOS = false
        var presentationTimeUs = 0L

        try {
            while (!outputEOS) {
                if (!inputEOS) {
                    val inIndex = encoder.dequeueInputBuffer(TIMEOUT_US)
                    if (inIndex >= 0) {
                        val inBuffer = encoder.getInputBuffer(inIndex)
                        if (inBuffer != null) {
                            inBuffer.clear()
                            val bytesToRead = Math.min(inBuffer.remaining(), pcmByteBuf.remaining())
                            if (bytesToRead > 0) {
                                val chunk = ByteArray(bytesToRead)
                                pcmByteBuf.get(chunk)
                                inBuffer.put(chunk)
                                val pts = presentationTimeUs
                                val frames = bytesToRead / 4
                                presentationTimeUs += (frames * 1000000L) / sampleRate
                                encoder.queueInputBuffer(inIndex, 0, bytesToRead, pts, 0)
                            } else {
                                encoder.queueInputBuffer(inIndex, 0, 0, presentationTimeUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputEOS = true
                            }
                        }
                    }
                }

                val outIndex = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
                if (outIndex >= 0) {
                    val outBuffer = encoder.getOutputBuffer(outIndex)
                    if (outBuffer != null && bufferInfo.size > 0 && muxerStarted) {
                        outBuffer.position(bufferInfo.offset)
                        outBuffer.limit(bufferInfo.offset + bufferInfo.size)
                        muxer.writeSampleData(muxerTrackIndex, outBuffer, bufferInfo)
                    }
                    encoder.releaseOutputBuffer(outIndex, false)
                    if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputEOS = true
                    }
                } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (!muxerStarted) {
                        muxerTrackIndex = muxer.addTrack(encoder.outputFormat)
                        muxer.start()
                        muxerStarted = true
                    }
                }
            }
        } finally {
            if (muxerStarted) {
                try { muxer.stop() } catch (e: Exception) {}
            }
            try { muxer.release() } catch (e: Exception) {}
            try { encoder.stop() } catch (e: Exception) {}
            try { encoder.release() } catch (e: Exception) {}
        }
    }
}
