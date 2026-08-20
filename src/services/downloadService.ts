import { documentDirectory, downloadAsync } from 'expo-file-system/legacy';
import { getAudioStream } from './musicApi';
import { saveOfflineTrack, TrackMetadata } from '../utils/storage';

export async function downloadTrack(trackId: string, metadata: TrackMetadata): Promise<boolean> {
  try {
    const streamUrl = await getAudioStream(trackId);
    if (!streamUrl) {
      console.warn('No stream available for download:', trackId);
      return false;
    }

    // Define a local file path
    const fileUri = `${documentDirectory}${trackId}.m4a`;
    
    // Download the file
    const downloadRes = await downloadAsync(streamUrl, fileUri);
    
    if (downloadRes.status === 200) {
      // Save metadata and local URI to MMKV
      saveOfflineTrack({
        ...metadata,
        id: trackId,
        localUri: downloadRes.uri,
      });
      return true;
    }
    return false;
  } catch (error) {
    console.error('Download failed:', error);
    return false;
  }
}

export async function downloadPlaylistTracks(tracks: TrackMetadata[]) {
  // Concurrently download tracks or sequentially. Sequential is safer for bandwidth.
  for (const track of tracks) {
    await downloadTrack(track.id, track);
  }
}
