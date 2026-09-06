import TrackPlayer, { Event, RepeatMode, PlayerCommand } from '@rntp/player';
import { getOfflineTracks, setLastPlayedTrack, TrackMetadata } from '../utils/storage';
import { getAudioStream } from './musicApi';

export async function setupPlayer() {
  let isSetup = false;
  try {
    if (typeof (TrackPlayer as any).getActiveTrack === 'function') {
      await (TrackPlayer as any).getActiveTrack();
    } else if (typeof TrackPlayer.getActiveMediaItemIndex === 'function') {
      TrackPlayer.getActiveMediaItemIndex();
    }
    isSetup = true;
  } catch {
    try {
      await TrackPlayer.setupPlayer({
        android: {
          taskRemovedBehavior: 'stop'
        }
      });
      
      TrackPlayer.setCommands({
        capabilities: [
          PlayerCommand.PlayPause,
          PlayerCommand.Next,
          PlayerCommand.Previous,
          PlayerCommand.Seek,
        ],
        handling: 'hybrid' // Required to fire JS background events on V5
      });

      isSetup = true;
    } catch (e: any) {
      if (e?.message?.includes('already set up')) {
        isSetup = true;
      } else {
        console.error('setupPlayer initialization error:', e);
      }
    }
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

    try {
      await TrackPlayer.clear();
    } catch {}

    const payload = {
      id: metadata.id,
      mediaId: metadata.id,
      url: playUrl,
      title: metadata.title,
      artist: metadata.artist,
      artwork: metadata.artwork,
      artworkUrl: metadata.artwork,
      duration: metadata.duration,
    };

    if (typeof (TrackPlayer as any).add === 'function') {
      await (TrackPlayer as any).add(payload);
    } else if (typeof TrackPlayer.setMediaItems === 'function') {
      await TrackPlayer.setMediaItems([payload as any]);
    } else if (typeof (TrackPlayer as any).addMediaItem === 'function') {
      await (TrackPlayer as any).addMediaItem(payload as any);
    }
    
    setLastPlayedTrack(metadata);
    await TrackPlayer.play();
  } catch (error) {
    console.error('Error playing track:', error);
  }
}
