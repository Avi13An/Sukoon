import TrackPlayer, { Event, RepeatMode, PlayerCommand, PlaybackState } from '@rntp/player';
import { Alert } from 'react-native';
import { 
  getOfflineTracks, 
  getDownloadedTracks, 
  setLastPlayedTrack, 
  getLastPlayedTrack, 
  saveListenHistory, 
  getListenHistory, 
  getEqualizerSettings, 
  TrackMetadata 
} from '../utils/storage';
import { getAudioStream, searchTracks } from './musicApi';

let isPlayerSetup = false;
let isListenersAttached = false;
let isResolvingAutoplay = false;
let upNextQueue: TrackMetadata[] = [];
const queueListeners: Array<(queue: TrackMetadata[]) => void> = [];

export function subscribeToQueue(callback: (queue: TrackMetadata[]) => void) {
  queueListeners.push(callback);
  callback([...upNextQueue]);
  return () => {
    const idx = queueListeners.indexOf(callback);
    if (idx !== -1) queueListeners.splice(idx, 1);
  };
}

function notifyQueueChange() {
  queueListeners.forEach(cb => {
    try {
      cb([...upNextQueue]);
    } catch (e) {
      console.error('[TrackPlayerService] Queue listener callback error:', e);
    }
  });
}

export function getUpNextQueue(): TrackMetadata[] {
  return [...upNextQueue];
}

export function addToUpNextQueue(track: TrackMetadata) {
  if (!track || !track.id) return;
  if (!upNextQueue.some(t => t.id === track.id)) {
    upNextQueue.push(track);
    notifyQueueChange();
  }
}

export function removeFromUpNextQueue(index: number) {
  if (index >= 0 && index < upNextQueue.length) {
    upNextQueue.splice(index, 1);
    notifyQueueChange();
  }
}

export function reorderUpNextQueue(fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || fromIndex >= upNextQueue.length || toIndex < 0 || toIndex >= upNextQueue.length) return;
  const [movedItem] = upNextQueue.splice(fromIndex, 1);
  upNextQueue.splice(toIndex, 0, movedItem);
  notifyQueueChange();
}

export function clearUpNextQueue() {
  upNextQueue = [];
  notifyQueueChange();
}

export async function prefetchAutoplayQueue(currentTrack?: TrackMetadata) {
  try {
    const baseTrack = currentTrack || getLastPlayedTrack();
    if (!baseTrack) return;
    const history = getListenHistory();
    const historyIds = new Set(history.map(t => t.id));
    historyIds.add(baseTrack.id);
    upNextQueue.forEach(t => historyIds.add(t.id));

    const query = baseTrack.artist && baseTrack.artist !== 'Unknown Artist'
      ? `${baseTrack.artist} hits`
      : `${baseTrack.title} radio`;

    const candidates = await searchTracks(query);
    if (Array.isArray(candidates) && candidates.length > 0) {
      const freshCandidates = candidates.filter(t => t?.id && !historyIds.has(t.id));
      const newItems = freshCandidates.slice(0, 4);
      if (newItems.length > 0) {
        upNextQueue.push(...newItems);
        notifyQueueChange();
        console.log(`[Autoplay] Appended ${newItems.length} candidate tracks to upNextQueue. Total queue: ${upNextQueue.length}`);
      }
    }
  } catch (err) {
    console.error('[Autoplay] Error prefetching autoplay queue:', err);
  }
}

export async function playNextTrack(forcedTrackIndex?: number) {
  if (isResolvingAutoplay) return;
  isResolvingAutoplay = true;

  try {
    let candidate: TrackMetadata | undefined;

    if (typeof forcedTrackIndex === 'number' && forcedTrackIndex >= 0 && forcedTrackIndex < upNextQueue.length) {
      [candidate] = upNextQueue.splice(forcedTrackIndex, 1);
      notifyQueueChange();
    } else {
      if (upNextQueue.length === 0) {
        const lastTrack = getLastPlayedTrack();
        const query = lastTrack?.artist && lastTrack.artist !== 'Unknown Artist'
          ? `${lastTrack.artist} hits`
          : `${lastTrack?.title || 'Bollywood'} hits`;
        const history = getListenHistory();
        const historyIds = new Set(history.map(t => t.id));
        if (lastTrack) historyIds.add(lastTrack.id);

        const candidates = await searchTracks(query);
        const fresh = Array.isArray(candidates) ? candidates.filter(t => t?.id && !historyIds.has(t.id)) : [];
        if (fresh.length > 0) {
          upNextQueue.push(...fresh.slice(0, 5));
          notifyQueueChange();
        }
      }

      if (upNextQueue.length > 0) {
        candidate = upNextQueue.shift();
        notifyQueueChange();
      }
    }

    if (candidate) {
      console.log(`[Queue] Playing track: ${candidate.title} by ${candidate.artist}`);
      const resolvedUrl = candidate.url || await getAudioStream(candidate.id);
      if (resolvedUrl) {
        await playTrack({
          ...candidate,
          url: resolvedUrl,
        });
      }
    }

    // Whenever upNextQueue.length < 3, proactively fetch 3-4 more related songs
    if (upNextQueue.length < 3) {
      prefetchAutoplayQueue(candidate || getLastPlayedTrack() || undefined).catch(() => {});
    }
  } catch (err) {
    console.error('[Queue] playNextTrack error:', err);
  } finally {
    isResolvingAutoplay = false;
  }
}

export async function handleAutoplayTransition() {
  const repeatMode = TrackPlayer.getRepeatMode();
  if (repeatMode !== RepeatMode.Off) {
    console.log('[Autoplay] Repeat mode active, skipping autoplay');
    return;
  }
  await playNextTrack();
}

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

    if (!isListenersAttached) {
      TrackPlayer.addEventListener(Event.PlaybackStateChanged, async (event: any) => {
        if (event?.state === PlaybackState.Ended || event?.state === 'ended') {
          console.log('[TrackPlayerService] PlaybackState.Ended detected, triggering autoplay...');
          await handleAutoplayTransition();
        }
      });

      TrackPlayer.addEventListener(Event.MediaItemTransition, async (event: any) => {
        if (event?.item === null && event?.index === -1) {
          console.log('[TrackPlayerService] MediaItemTransition ended, triggering autoplay...');
          await handleAutoplayTransition();
        }
      });

      const queueEndedEvent = (Event as any).PlaybackQueueEnded || 'event.playback-queue-ended';
      TrackPlayer.addEventListener(queueEndedEvent as any, async () => {
        console.log('[TrackPlayerService] PlaybackQueueEnded detected, triggering autoplay...');
        await handleAutoplayTransition();
      });

      isListenersAttached = true;
    }

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

export async function applySoundBoost(boostPercent: number) {
  const clamped = Math.max(0, Math.min(100, boostPercent));
  const gainMultiplier = 1.0 + (clamped / 100) * 0.2; // provides subtle headroom boost
  if (typeof TrackPlayer.setVolume === 'function') {
    await TrackPlayer.setVolume(Math.min(1.2, gainMultiplier));
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

    const downloadedTracks = getDownloadedTracks();
    const downloadedTrack = downloadedTracks.find(t => t.id === metadata.id);
    const offlineTracks = getOfflineTracks();
    const offlineTrack = offlineTracks[metadata.id];
    
    let playUrl = downloadedTrack?.localUri || offlineTrack?.localUri;
    
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
      artworkUrl: metadata.artwork || undefined,
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
    saveListenHistory(metadata);
    upNextQueue = upNextQueue.filter(t => t.id !== metadata.id);
    notifyQueueChange();
    prefetchAutoplayQueue(metadata).catch(() => {});
    
    const eqSettings = getEqualizerSettings();
    if (eqSettings.enabled && eqSettings.soundBoost > 0) {
      await applySoundBoost(eqSettings.soundBoost);
    } else if (typeof TrackPlayer.setVolume === 'function') {
      await TrackPlayer.setVolume(1.0);
    }

    if (typeof play === 'function') {
      await play();
    } else {
      await TrackPlayer.play();
    }
  } catch (error: any) {
    console.error('[TrackPlayerService] playTrack error:', error);
    throw error;
  }
}
