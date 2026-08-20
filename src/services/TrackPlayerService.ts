import TrackPlayer, { Event, RepeatMode, PlayerCommand } from '@rntp/player';
import { getOfflineTracks, setLastPlayedTrack, TrackMetadata } from '../utils/storage';
import { getAudioStream } from './musicApi';

export async function setupPlayer() {
  let isSetup = false;
  try {
    TrackPlayer.getPlaybackState();
    isSetup = true;
  } catch {
    await TrackPlayer.setupPlayer();
    TrackPlayer.setCommands({
      capabilities: [
        PlayerCommand.PlayPause,
        PlayerCommand.Next,
        PlayerCommand.Previous,
        PlayerCommand.Seek,
      ]
    });

    isSetup = true;
  } finally {
    return isSetup;
  }
}

export async function addTracks(tracks: any[]) {
  await TrackPlayer.setMediaItems(tracks);
  TrackPlayer.setRepeatMode(RepeatMode.All);
}

export async function toggleLoopMode() {
  const currentMode = TrackPlayer.getRepeatMode();
  let nextMode = RepeatMode.Off;
  
  if (currentMode === RepeatMode.Off) {
    nextMode = RepeatMode.One;
  } else if (currentMode === RepeatMode.One) {
    nextMode = RepeatMode.All;
  } else {
    nextMode = RepeatMode.Off;
  }
  
  TrackPlayer.setRepeatMode(nextMode);
  return nextMode;
}

export async function playTrack(metadata: TrackMetadata) {
  try {
    const offlineTracks = getOfflineTracks();
    const offlineTrack = offlineTracks[metadata.id];
    
    let playUrl = offlineTrack?.localUri;
    
    if (!playUrl && metadata.url) {
      playUrl = metadata.url;
    }
    
    if (!playUrl) {
      const stream = await getAudioStream(metadata.id);
      if (!stream) {
        console.warn('No stream found for', metadata.id);
        return;
      }
      playUrl = stream;
    }

    TrackPlayer.clear();
    TrackPlayer.setMediaItems([{
      url: playUrl,
      title: metadata.title,
      artist: metadata.artist,
      artwork: metadata.artwork,
      duration: metadata.duration,
    } as any]);
    
    setLastPlayedTrack(metadata);
    await TrackPlayer.play();
  } catch (error) {
    console.error('Error playing track:', error);
  }
}
