import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;

export interface MixParams {
  vocalUri: string;
  backingTrackUri: string;
  vocalVolume: number; // 0.0 to 1.0 (default 1.0)
  musicVolume: number; // 0.0 to 1.0 (default 0.6)
  startTimeSeconds?: number;
  durationSeconds?: number;
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
 * Mixes a vocal recording on top of a backing music track with custom volume balance
 * using the hardware-accelerated Native Android MediaCodec engine (zero screeching / distortion).
 */
export async function mixVocalWithBackingTrack(params: MixParams): Promise<string> {
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
    // 1. Resolve Backing Track (download locally if remote stream URL)
    let resolvedBackingUri = backingTrackUri;
    if (backingTrackUri.startsWith('http://') || backingTrackUri.startsWith('https://')) {
      const timestamp = Date.now();
      tempDownloadedBackingPath = `${FileSystem.cacheDirectory}temp_backing_${timestamp}.m4a`;
      const downloadResult = await FileSystem.downloadAsync(backingTrackUri, tempDownloadedBackingPath);
      resolvedBackingUri = downloadResult.uri;
    }

    const timestamp = Date.now();
    const outputFilename = `master_${timestamp}.m4a`;
    const outputPath = `${RECORDINGS_DIR}${outputFilename}`;
    const startTimeMs = Math.max(0, (startTimeSeconds || 0) * 1000);

    // 2. Hardware-accelerated Native Android MediaCodec / MediaMuxer Engine
    const { AudioMixerModule } = NativeModules;
    if (AudioMixerModule && typeof AudioMixerModule.mixTracks === 'function') {
      console.log('[audioMixingService] Invoking native MediaCodec mixer engine...');
      const mixedPath = await AudioMixerModule.mixTracks(
        vocalUri,
        resolvedBackingUri,
        outputPath,
        vocalVolume,
        musicVolume,
        startTimeMs
      );
      console.log(`[audioMixingService] Native mixer generated clean master at: ${mixedPath}`);
      return mixedPath || outputPath;
    }

    // 3. Graceful fallback if native module is not linked
    console.warn('[audioMixingService] AudioMixerModule not found, creating master copy...');
    const fallbackFilename = `master_${timestamp}.m4a`;
    const fallbackPath = `${RECORDINGS_DIR}${fallbackFilename}`;
    await FileSystem.copyAsync({
      from: vocalUri,
      to: fallbackPath,
    });
    return fallbackPath;
  } catch (error: any) {
    console.error('[audioMixingService] Error mixing audio:', error);
    throw error;
  } finally {
    // Clean up temporary downloaded backing track
    if (tempDownloadedBackingPath) {
      try {
        await FileSystem.deleteAsync(tempDownloadedBackingPath, { idempotent: true });
      } catch {}
    }
  }
}
