import TrackPlayer, { Event, RepeatMode, PlayerCommand } from '@rntp/player';
import { Alert } from 'react-native';
import { getOfflineTracks, setLastPlayedTrack, TrackMetadata } from '../utils/storage';
import { getAudioStream } from './musicApi';

let isPlayerSetup = false;

export async function setupPlayer(): Promise<boolean> {
  if (isPlayerSetup) return true;
  try {
    TrackPlayer.setupPlayer({
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

    isPlayerSetup = true;
    // Allow Android MediaController async connection to finish
    await new Promise((r) => setTimeout(r, 150));
    return true;
  } catch (e: any) {
    if (e?.message?.includes('already set up') || e?.message?.includes('Already set up')) {
      isPlayerSetup = true;
      return true;
    }
    console.error('setupPlayer initialization error:', e);
    return false;
  }
}

export const load = (TrackPlayer as any).load;
export const setMediaItem = (TrackPlayer as any).setMediaItem;
export const setMediaItems = (TrackPlayer as any).setMediaItems;
export const addMediaItem = (TrackPlayer as any).addMediaItem;
export const play = (TrackPlayer as any).play;
export const getPlaybackState = (TrackPlayer as any).getPlaybackState;
export const getActiveMediaItem = (TrackPlayer as any).getActiveMediaItem;
export const getQueue = (TrackPlayer as any).getQueue;

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
    const isPlayerReady = await setupPlayer();
    if (!isPlayerReady) {
      throw new Error('TrackPlayer setup failed or service unavailable');
    }

    const offlineTracks = getOfflineTracks();
    const offlineTrack = offlineTracks[metadata.id];
    
    let playUrl = offlineTrack?.localUri;
    
    if (!playUrl && metadata.url) {
      playUrl = metadata.url;
    }
    
    if (!playUrl) {
      const stream = await getAudioStream(metadata.id);
      const resolved = typeof stream === 'string' ? stream : (stream as any)?.url;
      if (!resolved || !resolved.startsWith('http')) {
        const msg = `No playable audio stream found for track ${metadata.id}`;
        console.warn(msg);
        Alert.alert('TrackPlayer Service Error', msg);
        throw new Error(msg);
      }
      playUrl = resolved;
    }

    const isIosStream = playUrl.includes('c=IOS') || !playUrl.includes('c=ANDROID');
    const matchedUA = isIosStream
      ? 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)'
      : 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';

    const trackPayload = {
      id: metadata.id,
      mediaId: metadata.id,
      url: playUrl, // MUST be clean string URL
      title: metadata.title || 'Unknown Title',
      artist: metadata.artist || 'Unknown Artist',
      artwork: metadata.artwork || undefined,
      duration: metadata.duration,
      headers: {
        'User-Agent': matchedUA,
        'Accept': '*/*'
      }
    };

    if (typeof load === 'function') {
      await load(trackPayload);
    } else if (typeof (TrackPlayer as any).load === 'function') {
      await (TrackPlayer as any).load(trackPayload);
    } else if (typeof setMediaItem === 'function') {
      await setMediaItem(trackPayload);
    } else if (typeof (TrackPlayer as any).setMediaItem === 'function') {
      await (TrackPlayer as any).setMediaItem(trackPayload);
    } else if (typeof setMediaItems === 'function') {
      await setMediaItems([trackPayload]);
    } else if (typeof (TrackPlayer as any).setMediaItems === 'function') {
      await (TrackPlayer as any).setMediaItems([trackPayload]);
    } else if (typeof addMediaItem === 'function') {
      await addMediaItem(trackPayload);
    } else if (typeof (TrackPlayer as any).addMediaItem === 'function') {
      await (TrackPlayer as any).addMediaItem(trackPayload);
    } else if (typeof (TrackPlayer as any).add === 'function') {
      await (TrackPlayer as any).add(trackPayload);
    }
    
    // Allow Android main looper to process queue insertion
    await new Promise((r) => setTimeout(r, 50));

    const activeItem = typeof getActiveMediaItem === 'function' 
      ? await getActiveMediaItem() 
      : typeof (TrackPlayer as any).getActiveMediaItem === 'function'
        ? await (TrackPlayer as any).getActiveMediaItem()
        : null;
    console.log('[LOADED ACTIVE ITEM]:', activeItem);

    if (typeof (TrackPlayer as any).prepare === 'function') {
      try { await (TrackPlayer as any).prepare(); } catch {}
    } else if (typeof (TrackPlayer as any).retry === 'function') {
      try { await (TrackPlayer as any).retry(); } catch {}
    }
    
    setLastPlayedTrack(metadata);
    if (typeof TrackPlayer.setVolume === 'function') {
      await TrackPlayer.setVolume(1.0);
    }

    if (typeof play === 'function') {
      await play();
    } else {
      await TrackPlayer.play();
    }
  } catch (error: any) {
    Alert.alert('TrackPlayer Service Error', error?.message || JSON.stringify(error));
    throw error;
  }
}
