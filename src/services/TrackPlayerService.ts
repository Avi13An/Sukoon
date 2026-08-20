import TrackPlayer, { AppKilledPlaybackBehavior, Capability, Event, RepeatMode } from 'react-native-track-player';
import { getOfflineTracks, setLastPlayedTrack, TrackMetadata } from '../utils/storage';
import { getAudioStream } from './musicApi';

export async function setupPlayer() {
  let isSetup = false;
  try {
    await TrackPlayer.getCurrentTrack();
    isSetup = true;
  } catch {
    await TrackPlayer.setupPlayer({
      minBuffer: 50,
      maxBuffer: 100,
      playBuffer: 5,
      backBuffer: 50,
    });
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      progressUpdateEventInterval: 2,
    });

    isSetup = true;
  } finally {
    return isSetup;
  }
}

export async function addTracks(tracks: any[]) {
  await TrackPlayer.add(tracks);
  await TrackPlayer.setRepeatMode(RepeatMode.Queue);
}

export async function toggleLoopMode() {
  const currentMode = await TrackPlayer.getRepeatMode();
  let nextMode = RepeatMode.Off;
  
  if (currentMode === RepeatMode.Off) {
    nextMode = RepeatMode.Track;
  } else if (currentMode === RepeatMode.Track) {
    nextMode = RepeatMode.Queue;
  } else {
    nextMode = RepeatMode.Off;
  }
  
  await TrackPlayer.setRepeatMode(nextMode);
  return nextMode;
}

export async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
}

export async function playTrack(metadata: TrackMetadata) {
  try {
    const offlineTracks = getOfflineTracks();
    const offlineTrack = offlineTracks[metadata.id];
    
    let playUrl = offlineTrack?.localUri;
    
    if (!playUrl) {
      const stream = await getAudioStream(metadata.id);
      if (!stream) {
        console.warn('No stream found for', metadata.id);
        return;
      }
      playUrl = stream;
    }

    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: metadata.id,
      url: playUrl,
      title: metadata.title,
      artist: metadata.artist,
      artwork: metadata.artwork,
      duration: metadata.duration,
    });
    
    setLastPlayedTrack(metadata);
    await TrackPlayer.play();
  } catch (error) {
    console.error('Error playing track:', error);
  }
}
