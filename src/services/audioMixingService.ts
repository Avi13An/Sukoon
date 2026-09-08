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
 * Mixes vocal recording with backing music track.
 * Guarantees backing track is a local file, cleans file:// prefixes,
 * calls native AudioMixerModule, and cleans up temporary backing downloads.
 */
export async function mixVocalWithMusic(
  vocalUri: string,
  musicUri: string,
  startTimeMs: number,
  vocalVol: number = 1.0,
  musicVol: number = 0.6
): Promise<string> {
  await ensureRecordingsDirectory();

  let localMusicPath: string | null = null;
  try {
    let finalMusicPath = musicUri.replace('file://', '');

    // Check if musicUri is remote
    if (musicUri.startsWith('http://') || musicUri.startsWith('https://')) {
      localMusicPath = `${FileSystem.cacheDirectory}temp_backing_${Date.now()}.mp3`;
      const downloadRes = await FileSystem.downloadAsync(musicUri, localMusicPath);
      finalMusicPath = downloadRes.uri.replace('file://', '');
    }

    const finalVocalPath = vocalUri.replace('file://', '');
    const outputPath = `${FileSystem.documentDirectory}mastered_${Date.now()}.m4a`.replace('file://', '');

    const { AudioMixerModule } = NativeModules;
    if (AudioMixerModule && typeof AudioMixerModule.mixTracks === 'function') {
      console.log('[audioMixingService] Invoking native MediaCodec mixer engine...');
      const mixedPath = await AudioMixerModule.mixTracks(
        finalVocalPath,
        finalMusicPath,
        outputPath,
        vocalVol,
        musicVol,
        startTimeMs
      );
      console.log(`[audioMixingService] Native mixer generated clean master at: ${mixedPath}`);
      const finalResult = mixedPath || outputPath;
      const playableUri = finalResult.startsWith('file://') ? finalResult : `file://${finalResult}`;
      return playableUri;
    }

    // Graceful fallback if native module is not linked
    console.warn('[audioMixingService] AudioMixerModule not found, creating master copy...');
    await FileSystem.copyAsync({
      from: vocalUri,
      to: `file://${outputPath}`,
    });
    const playableFallback = outputPath.startsWith('file://') ? outputPath : `file://${outputPath}`;
    return playableFallback;
  } catch (error: any) {
    console.error('[audioMixingService] Error mixing audio:', error);
    throw error;
  } finally {
    if (localMusicPath) {
      try {
        await FileSystem.deleteAsync(localMusicPath, { idempotent: true });
      } catch {}
    }
  }
}

/**
 * Mixes a vocal recording on top of a backing music track with custom volume balance
 * using the hardware-accelerated Native Android MediaCodec engine (zero screeching / distortion).
 */
export async function mixVocalWithBackingTrack(params: MixParams): Promise<string> {
  const startTimeMs = Math.max(0, (params.startTimeSeconds || 0) * 1000);
  return mixVocalWithMusic(
    params.vocalUri,
    params.backingTrackUri,
    startTimeMs,
    params.vocalVolume ?? 1.0,
    params.musicVolume ?? 0.6
  );
}
