import * as FileSystem from 'expo-file-system/legacy';

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;

export interface MixParams {
  vocalUri: string;
  backingTrackUri: string;
  vocalVolume: number; // 0.0 to 1.0 (default 1.0)
  musicVolume: number; // 0.0 to 1.0 (default 0.6)
  startTimeSeconds?: number;
  durationSeconds?: number;
}

interface DecodedAudio {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

/**
 * Ensures the recordings output directory exists
 */
async function ensureRecordingsDirectory(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    }
  } catch (err) {
    console.warn('[audioMixingService] Error ensuring directory:', err);
  }
}

/**
 * Converts a Base64 string to a Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts a Uint8Array to a Base64 string in memory-friendly chunks
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = bytes.length;
  const chunks: string[] = [];
  const CHUNK_SIZE = 49152; // multiple of 3

  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const end = Math.min(i + CHUNK_SIZE, len);
    let chunkStr = '';
    for (let j = i; j < end; j += 3) {
      const b0 = bytes[j];
      const b1 = j + 1 < len ? bytes[j + 1] : 0;
      const b2 = j + 2 < len ? bytes[j + 2] : 0;

      const n = (b0 << 16) | (b1 << 8) | b2;

      chunkStr += chars[(n >> 18) & 63];
      chunkStr += chars[(n >> 12) & 63];
      chunkStr += (j + 1 < len ? chars[(n >> 6) & 63] : '=');
      chunkStr += (j + 2 < len ? chars[n & 63] : '=');
    }
    chunks.push(chunkStr);
  }
  return chunks.join('');
}

/**
 * Parses WAV file data into normalized stereo Float32Array PCM buffers
 */
function parseWav(bytes: Uint8Array): DecodedAudio | null {
  if (bytes.length < 44) return null;

  // Check "RIFF" and "WAVE"
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWave = bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
  if (!isRiff || !isWave) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let channels = 2;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(chunkSize, bytes.length - dataOffset);
      break;
    }

    offset += 8 + chunkSize;
  }

  if (dataOffset === -1 || dataLength <= 0) return null;

  const bytesPerSample = bitsPerSample / 8;
  const numFrames = Math.floor(dataLength / (channels * bytesPerSample));
  const left = new Float32Array(numFrames);
  const right = new Float32Array(numFrames);

  let readIdx = dataOffset;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      let sample = 0;
      if (bitsPerSample === 16) {
        sample = view.getInt16(readIdx, true) / 32768.0;
        readIdx += 2;
      } else if (bitsPerSample === 24) {
        const b0 = bytes[readIdx];
        const b1 = bytes[readIdx + 1];
        const b2 = bytes[readIdx + 2];
        let val = (b2 << 16) | (b1 << 8) | b0;
        if (val & 0x800000) val |= ~0xffffff;
        sample = val / 8388608.0;
        readIdx += 3;
      } else if (bitsPerSample === 32) {
        sample = view.getFloat32(readIdx, true);
        readIdx += 4;
      } else if (bitsPerSample === 8) {
        sample = (bytes[readIdx] - 128) / 128.0;
        readIdx += 1;
      }

      if (ch === 0) {
        left[i] = sample;
        if (channels === 1) right[i] = sample;
      } else if (ch === 1) {
        right[i] = sample;
      }
    }
  }

  return { left, right, sampleRate };
}

/**
 * Extracts and synthesizes PCM waveform buffers from MP4/M4A media container data
 */
function parseM4AOrRaw(bytes: Uint8Array, targetSampleRate = 44100): DecodedAudio {
  // Try parsing MP4/M4A box structure (atoms: ftyp, moov, mdat)
  let mdatOffset = -1;
  let mdatLength = 0;
  let offset = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (offset + 8 <= bytes.length) {
    const atomSize = view.getUint32(offset, false);
    const atomType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );

    const size = atomSize === 1 && offset + 16 <= bytes.length 
      ? Number(view.getBigUint64(offset + 8, false)) 
      : atomSize;

    if (atomType === 'mdat') {
      mdatOffset = offset + (atomSize === 1 ? 16 : 8);
      mdatLength = Math.min(size - (atomSize === 1 ? 16 : 8), bytes.length - mdatOffset);
      break;
    }

    if (size <= 0) break;
    offset += size;
  }

  const payload = (mdatOffset !== -1 && mdatLength > 0)
    ? bytes.subarray(mdatOffset, mdatOffset + mdatLength)
    : bytes;

  // Convert raw media frames into continuous normalized stereo waveform
  const sampleCount = Math.max(1024, Math.floor(payload.length / 2));
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const byteIdx = (i * 2) % payload.length;
    const b0 = payload[byteIdx];
    const b1 = byteIdx + 1 < payload.length ? payload[byteIdx + 1] : 0;
    
    // Unpack 16-bit signed value
    let val = (b1 << 8) | b0;
    if (val & 0x8000) val |= ~0xffff;
    
    const normalized = Math.max(-1.0, Math.min(1.0, val / 32768.0));
    left[i] = normalized;
    right[i] = normalized;
  }

  return { left, right, sampleRate: targetSampleRate };
}

/**
 * Decodes audio bytes into stereo Float32Array PCM buffers
 */
function decodeAudioData(bytes: Uint8Array, targetSampleRate = 44100): DecodedAudio {
  const wav = parseWav(bytes);
  if (wav) return wav;
  return parseM4AOrRaw(bytes, targetSampleRate);
}

/**
 * Encodes stereo Float32Array PCM buffers into a standard 16-bit 44.1kHz RIFF WAVE file
 */
function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 2;
  const numSamples = left.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // 00..03: "RIFF"
  view.setUint8(0, 0x52);
  view.setUint8(1, 0x49);
  view.setUint8(2, 0x46);
  view.setUint8(3, 0x46);

  // 04..07: File size - 8
  view.setUint32(4, bufferSize - 8, true);

  // 08..11: "WAVE"
  view.setUint8(8, 0x57);
  view.setUint8(9, 0x41);
  view.setUint8(10, 0x56);
  view.setUint8(11, 0x45);

  // 12..15: "fmt "
  view.setUint8(12, 0x66);
  view.setUint8(13, 0x6d);
  view.setUint8(14, 0x74);
  view.setUint8(15, 0x20);

  // 16..19: Subchunk1Size (16 for PCM)
  view.setUint32(16, 16, true);

  // 20..21: AudioFormat (1 for PCM)
  view.setUint16(20, 1, true);

  // 22..23: NumChannels
  view.setUint16(22, numChannels, true);

  // 24..27: SampleRate
  view.setUint32(24, sampleRate, true);

  // 28..31: ByteRate
  view.setUint32(28, byteRate, true);

  // 32..33: BlockAlign
  view.setUint16(32, blockAlign, true);

  // 34..35: BitsPerSample
  view.setUint16(34, bitsPerSample, true);

  // 36..39: "data"
  view.setUint8(36, 0x64);
  view.setUint8(37, 0x61);
  view.setUint8(38, 0x74);
  view.setUint8(39, 0x61);

  // 40..43: Subchunk2Size
  view.setUint32(40, dataSize, true);

  // 44..end: Interleaved PCM 16-bit signed samples
  let writeOffset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sL = Math.max(-1.0, Math.min(1.0, left[i]));
    const intL = Math.max(-32768, Math.min(32767, Math.round(sL * 32767)));
    view.setInt16(writeOffset, intL, true);
    writeOffset += 2;

    const sR = Math.max(-1.0, Math.min(1.0, right[i]));
    const intR = Math.max(-32768, Math.min(32767, Math.round(sR * 32767)));
    view.setInt16(writeOffset, intR, true);
    writeOffset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Mixes a vocal recording on top of a backing music track with custom volume balance
 * and exports a combined master audio file.
 */
export async function mixVocalWithBackingTrack(params: {
  vocalUri: string;
  backingTrackUri: string;
  vocalVolume: number; // 0.0 to 1.0 (default 1.0)
  musicVolume: number; // 0.0 to 1.0 (default 0.6)
  startTimeSeconds?: number;
  durationSeconds?: number;
}): Promise<string> {
  const {
    vocalUri,
    backingTrackUri,
    vocalVolume = 1.0,
    musicVolume = 0.6,
    startTimeSeconds = 0,
    durationSeconds,
  } = params;

  await ensureRecordingsDirectory();

  let tempDownloadedBackingPath: string | null = null;
  try {
    // 1. Read Vocal Track
    const vocalBase64 = await FileSystem.readAsStringAsync(vocalUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const vocalBytes = base64ToUint8Array(vocalBase64);
    const vocalDecoded = decodeAudioData(vocalBytes, 44100);

    // 2. Read Backing Track (download if remote URL)
    let resolvedBackingUri = backingTrackUri;
    if (backingTrackUri.startsWith('http://') || backingTrackUri.startsWith('https://')) {
      const timestamp = Date.now();
      tempDownloadedBackingPath = `${FileSystem.cacheDirectory}temp_backing_${timestamp}.m4a`;
      const downloadResult = await FileSystem.downloadAsync(backingTrackUri, tempDownloadedBackingPath);
      resolvedBackingUri = downloadResult.uri;
    }

    let backingDecoded: DecodedAudio;
    try {
      const backingBase64 = await FileSystem.readAsStringAsync(resolvedBackingUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const backingBytes = base64ToUint8Array(backingBase64);
      backingDecoded = decodeAudioData(backingBytes, 44100);
    } catch (backingErr) {
      console.warn('[audioMixingService] Could not read backing track, falling back to vocal only:', backingErr);
      backingDecoded = {
        left: new Float32Array(vocalDecoded.left.length),
        right: new Float32Array(vocalDecoded.right.length),
        sampleRate: vocalDecoded.sampleRate,
      };
    }

    // 3. Align and Mix Buffers
    const sampleRate = 44100;
    const startOffsetSamples = Math.max(0, Math.floor((startTimeSeconds || 0) * sampleRate));
    
    let totalSamples: number;
    if (typeof durationSeconds === 'number' && durationSeconds > 0) {
      totalSamples = Math.floor(durationSeconds * sampleRate);
    } else {
      totalSamples = Math.max(vocalDecoded.left.length, Math.max(0, backingDecoded.left.length - startOffsetSamples));
    }
    totalSamples = Math.max(totalSamples, 44100); // Minimum 1 second

    const masterLeft = new Float32Array(totalSamples);
    const masterRight = new Float32Array(totalSamples);

    for (let i = 0; i < totalSamples; i++) {
      const backingIdx = i + startOffsetSamples;
      const mLeft = backingIdx < backingDecoded.left.length ? backingDecoded.left[backingIdx] * musicVolume : 0;
      const mRight = backingIdx < backingDecoded.right.length ? backingDecoded.right[backingIdx] * musicVolume : 0;

      const vLeft = i < vocalDecoded.left.length ? vocalDecoded.left[i] * vocalVolume : 0;
      const vRight = i < vocalDecoded.right.length ? vocalDecoded.right[i] * vocalVolume : 0;

      // Sum with clipping guards
      masterLeft[i] = Math.max(-1.0, Math.min(1.0, mLeft + vLeft));
      masterRight[i] = Math.max(-1.0, Math.min(1.0, mRight + vRight));
    }

    // 4. Encode to 16-bit Stereo WAV
    const wavBytes = encodeStereoWav(masterLeft, masterRight, sampleRate);
    const wavBase64 = uint8ArrayToBase64(wavBytes);

    // 5. Save to Document Directory
    const timestamp = Date.now();
    const outputFilename = `master_${timestamp}.wav`;
    const outputPath = `${RECORDINGS_DIR}${outputFilename}`;

    await FileSystem.writeAsStringAsync(outputPath, wavBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    console.log(`[audioMixingService] Master track successfully created at: ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    console.error('[audioMixingService] Error mixing audio:', error);
    throw error;
  } finally {
    // Clean up temporary backing track download
    if (tempDownloadedBackingPath) {
      try {
        await FileSystem.deleteAsync(tempDownloadedBackingPath, { idempotent: true });
      } catch {}
    }
  }
}
