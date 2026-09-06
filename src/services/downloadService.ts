import * as FileSystem from 'expo-file-system/legacy';
import { getAudioStream } from './musicApi';
import { 
  TrackMetadata, 
  DownloadedTrack, 
  getDownloadedTracks, 
  saveDownloadedTrack, 
  deleteDownloadedTrackStorage, 
  isTrackDownloaded 
} from '../utils/storage';

const DOWNLOAD_DIR = `${FileSystem.documentDirectory}downloads/`;

async function ensureDownloadDirExists(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
  }
}

export { getDownloadedTracks, isTrackDownloaded };

export async function downloadTrack(
  track: TrackMetadata, 
  onProgress?: (progress: number) => void
): Promise<string> {
  try {
    await ensureDownloadDirExists();
    const fileUri = `${DOWNLOAD_DIR}${track.id}.mp4`;

    // Check if already downloaded on disk and in storage
    const existingFile = await FileSystem.getInfoAsync(fileUri);
    if (existingFile.exists && isTrackDownloaded(track.id)) {
      if (onProgress) onProgress(1.0);
      return fileUri;
    }

    const streamUrl = track.url || await getAudioStream(track.id);
    if (!streamUrl) {
      throw new Error(`Failed to resolve audio stream for track: ${track.id}`);
    }

    const downloadResumable = FileSystem.createDownloadResumable(
      streamUrl,
      fileUri,
      {},
      (downloadProgress) => {
        const totalExpected = downloadProgress.totalBytesExpectedToWrite;
        if (totalExpected > 0) {
          const progress = downloadProgress.totalBytesWritten / totalExpected;
          if (onProgress && !isNaN(progress)) {
            onProgress(Math.max(0, Math.min(1, progress)));
          }
        }
      }
    );

    const result = await downloadResumable.downloadAsync();
    if (!result || result.status !== 200) {
      throw new Error(`Download failed with HTTP status: ${result?.status || 'unknown'}`);
    }

    const fileInfo = await FileSystem.getInfoAsync(result.uri);
    const sizeBytes = (fileInfo as any)?.size || undefined;

    const downloadedItem: DownloadedTrack = {
      ...track,
      localUri: result.uri,
      downloadedAt: Date.now(),
      sizeBytes,
    };

    saveDownloadedTrack(downloadedItem);
    if (onProgress) onProgress(1.0);
    return result.uri;
  } catch (err: any) {
    console.error(`[DownloadService] Failed to download track ${track.id}:`, err);
    throw err;
  }
}

export async function deleteDownloadedTrack(trackId: string): Promise<boolean> {
  try {
    const fileUri = `${DOWNLOAD_DIR}${trackId}.mp4`;
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    }
    deleteDownloadedTrackStorage(trackId);
    return true;
  } catch (err) {
    console.error(`[DownloadService] Failed to delete track ${trackId}:`, err);
    deleteDownloadedTrackStorage(trackId);
    return false;
  }
}

export async function getOfflineStorageUsage(): Promise<{ totalBytes: number; formattedSize: string }> {
  try {
    const tracks = getDownloadedTracks();
    let total = 0;
    for (const t of tracks) {
      if (t.sizeBytes) {
        total += t.sizeBytes;
      } else if (t.localUri) {
        try {
          const info = await FileSystem.getInfoAsync(t.localUri);
          if (info.exists && (info as any).size) {
            total += (info as any).size;
          }
        } catch {}
      }
    }
    const mb = (total / (1024 * 1024)).toFixed(1);
    return { totalBytes: total, formattedSize: `${mb} MB` };
  } catch {
    return { totalBytes: 0, formattedSize: '0 MB' };
  }
}

export async function downloadPlaylistTracks(
  tracks: TrackMetadata[],
  onTrackProgress?: (completedCount: number, totalCount: number) => void
) {
  let completed = 0;
  for (const track of tracks) {
    try {
      await downloadTrack(track);
    } catch (e) {
      console.warn(`Failed to download track in playlist: ${track.id}`, e);
    }
    completed++;
    if (onTrackProgress) {
      onTrackProgress(completed, tracks.length);
    }
  }
}
