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
import { handleTrackEndedForSleepTimer, resetSleepPaused } from './sleepTimerService';

export const Capability = {
  Play: PlayerCommand.PlayPause,
  Pause: PlayerCommand.PlayPause,
  SkipToNext: PlayerCommand.Next,
  SkipToPrevious: PlayerCommand.Previous,
  SeekTo: PlayerCommand.Seek,
};

export const AppKilledPlaybackBehavior = {
  StopPlaybackAndRemoveNotification: 'stop',
};

let isPlayerSetup = false;
let isListenersAttached = false;
let isResolvingAutoplay = false;
let upNextQueue: TrackMetadata[] = [];
let playbackHistory: TrackMetadata[] = [];
let currentTrack: TrackMetadata | null = null;
const queueListeners: Array<(queue: TrackMetadata[]) => void> = [];

export function notifyQueueChange() {
  queueListeners.forEach(cb => {
    try {
      cb([...upNextQueue]);
    } catch (e) {
      console.error('[TrackPlayerService] Queue listener callback error:', e);
    }
  });
}
export const notifyQueueListeners = notifyQueueChange;

export function subscribeToQueue(callback: (queue: TrackMetadata[]) => void) {
  queueListeners.push(callback);
  callback([...upNextQueue]);
  return () => {
    const idx = queueListeners.indexOf(callback);
    if (idx !== -1) queueListeners.splice(idx, 1);
  };
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

export const MIN_QUEUE_SIZE = 10;

export function removeFromUpNextQueue(index: number) {
  if (index >= 0 && index < upNextQueue.length) {
    upNextQueue.splice(index, 1);
    notifyQueueChange();
    if (upNextQueue.length === 0) {
      const currentTrack = getLastPlayedTrack() || undefined;
      prefetchAutoplayQueue(currentTrack).catch(() => {});
    }
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
    if (upNextQueue.length >= MIN_QUEUE_SIZE) return;

    const history = getListenHistory();
    const historyIds = new Set(history.map(t => t.id));
    historyIds.add(baseTrack.id);
    upNextQueue.forEach(t => historyIds.add(t.id));

    const queries = [
      baseTrack.artist && baseTrack.artist !== 'Unknown Artist'
        ? `${baseTrack.artist} top songs`
        : `${baseTrack.title} radio`,
      baseTrack.artist && (baseTrack as any).genre
        ? `${baseTrack.artist} ${(baseTrack as any).genre}`
        : `${baseTrack.artist || 'Bollywood'} hits`
    ];

    for (const q of queries) {
      if (upNextQueue.length >= MIN_QUEUE_SIZE) break;
      const candidates = await searchTracks(q);
      if (Array.isArray(candidates) && candidates.length > 0) {
        const freshCandidates = candidates.filter(t => t?.id && !historyIds.has(t.id));
        for (const cand of freshCandidates) {
          if (upNextQueue.length >= MIN_QUEUE_SIZE) break;
          historyIds.add(cand.id);
          upNextQueue.push(cand);
        }
      }
    }

    notifyQueueChange();
    console.log(`[Autoplay] Queue updated. Total staged tracks: ${upNextQueue.length}`);
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
      // 1. Pull next song sequentially from upNextQueue
      if (upNextQueue.length > 0) {
        candidate = upNextQueue.shift();
        notifyQueueChange();
      } else {
        // 2. Only when upNextQueue is empty (i.e. the playlist has reached its final track)
        // should it invoke prefetchAutoplayQueue(currentTrack) to smoothly transition into similar songs
        await prefetchAutoplayQueue(currentTrack || getLastPlayedTrack() || undefined);
        if (upNextQueue.length > 0) {
          candidate = upNextQueue.shift();
          notifyQueueChange();
        }
      }
    }

    if (candidate) {
      console.log(`[Queue] Playing track: ${candidate.title} by ${candidate.artist}`);
      const resolvedUrl = candidate.url || await getAudioStream(candidate.id);
      if (resolvedUrl) {
        await playTrack({
          ...candidate,
          url: resolvedUrl,
        }, undefined, true);
      }
    }

    // Proactively stage autoplay recommendations ONLY when queue is completely empty
    if (upNextQueue.length === 0 && candidate) {
      prefetchAutoplayQueue(candidate).catch(() => {});
    }
  } catch (err) {
    console.error('[Queue] playNextTrack error:', err);
  } finally {
    isResolvingAutoplay = false;
  }
}

export async function playPreviousTrack() {
  try {
    const progress = await TrackPlayer.getProgress();
    // If more than 3 seconds into the song, restart it (standard music player behavior)
    if (progress && typeof progress.position === 'number' && progress.position > 3) {
      await TrackPlayer.seekTo(0);
      return;
    }
    // Otherwise, pop the last song from playbackHistory if available
    if (playbackHistory.length > 0) {
      const prevTrack = playbackHistory.pop();
      if (prevTrack) {
        // Put current song back to top of upNextQueue
        if (currentTrack) {
          upNextQueue.unshift(currentTrack);
          notifyQueueChange();
        }
        await playTrack(prevTrack, undefined, true);
        return;
      }
    }

    // Fallback to MMKV listen history if playbackHistory was empty
    const history = getListenHistory();
    const active = currentTrack || getLastPlayedTrack();
    if (history.length > 1) {
      const prevTrack = history[1];
      if (prevTrack && prevTrack.id !== active?.id) {
        if (active) {
          upNextQueue.unshift(active);
          notifyQueueChange();
        }
        await playTrack(prevTrack, undefined, true);
        return;
      }
    }

    await TrackPlayer.seekTo(0);
  } catch (err) {
    console.warn('Error in playPreviousTrack:', err);
    try { await TrackPlayer.seekTo(0); } catch {}
  }
}

let isAutoTransitioning = false;
export async function handleAutoplayTransition() {
  if (isAutoTransitioning) return;
  isAutoTransitioning = true;
  try {
    if (await handleTrackEndedForSleepTimer()) {
      console.log('[Autoplay] Sleep timer ended or paused playback');
      return;
    }
    const repeatMode = TrackPlayer.getRepeatMode();
    if (repeatMode !== RepeatMode.Off) {
      console.log('[Autoplay] Repeat mode active, skipping autoplay');
      return;
    }
    await playNextTrack();
  } catch (err) {
    console.error('[Autoplay] Error in handleAutoplayTransition:', err);
  } finally {
    setTimeout(() => {
      isAutoTransitioning = false;
    }, 1000);
  }
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
      handling: 'hybrid', // Required to fire JS background events on V5
      perCommandHandling: {
        [PlayerCommand.Next]: 'js',
        [PlayerCommand.Previous]: 'js',
        [PlayerCommand.PlayPause]: 'native',
        [PlayerCommand.Seek]: 'native',
      }
    });

    if (typeof (TrackPlayer as any).updateOptions === 'function') {
      try {
        await (TrackPlayer as any).updateOptions({
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
          notificationCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
          ],
          // Crucial: Android compact notification only has room for 3 actions
          compactCapabilities: [
            Capability.SkipToPrevious,
            Capability.Play,
            Capability.SkipToNext,
          ],
        });
      } catch (err) {
        console.log('[TrackPlayerService] Optional updateOptions call skipped:', err);
      }
    }

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
        } else if (typeof event?.index === 'number' && event.index > 0) {
          console.log('[TrackPlayerService] MediaItemTransition advanced natively to index', event.index);
          await handleAutoplayTransition();
        }
      });

      const queueEndedEvent = (Event as any).PlaybackQueueEnded || 'event.playback-queue-ended';
      TrackPlayer.addEventListener(queueEndedEvent as any, async () => {
        console.log('[TrackPlayerService] PlaybackQueueEnded detected, triggering autoplay...');
        await handleAutoplayTransition();
      });

      // Remote control events from lockscreen, notification shade, Bluetooth, or headset
      TrackPlayer.addEventListener(Event.RemoteNext, async () => {
        console.log('[TrackPlayerService] RemoteNext triggered from media notification/controls');
        await playNextTrack();
      });

      TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
        console.log('[TrackPlayerService] RemotePrevious triggered from media notification/controls');
        await playPreviousTrack();
      });

      TrackPlayer.addEventListener(Event.RemotePlay, async () => {
        console.log('[TrackPlayerService] RemotePlay triggered');
        try { await TrackPlayer.play(); } catch {}
      });

      TrackPlayer.addEventListener(Event.RemotePause, async () => {
        console.log('[TrackPlayerService] RemotePause triggered');
        try { await TrackPlayer.pause(); } catch {}
      });

      TrackPlayer.addEventListener(Event.RemoteSeek, async (event: any) => {
        console.log('[TrackPlayerService] RemoteSeek triggered', event?.position);
        if (typeof event?.position === 'number') {
          try { await TrackPlayer.seekTo(event.position); } catch {}
        }
      });

      isListenersAttached = true;
    }

    isPlayerSetup = true;
    // Allow Android MediaController async connection to finish
    await new Promise((r) => setTimeout(r, 150));
    await applySoundBoost(currentSoundBoostPercent);
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

let currentSoundBoostPercent = 0;
try {
  const initialEq = getEqualizerSettings();
  if (initialEq && typeof initialEq.soundBoost === 'number') {
    currentSoundBoostPercent = initialEq.enabled ? initialEq.soundBoost : 0;
  }
} catch {}

export async function applySoundBoost(boostPercent: number) {
  currentSoundBoostPercent = Math.max(0, Math.min(100, boostPercent));
  // Baseline volume is 0.50 at 0% boost, scaling to 1.00 at 100% boost for an immediate 2x loudness jump
  const calculatedVolume = 0.50 + (currentSoundBoostPercent / 100) * 0.50;
  if (typeof TrackPlayer.setVolume === 'function') {
    await TrackPlayer.setVolume(calculatedVolume);
  }
}

export async function setPlayerVolume(volume: number) {
  const clamped = Math.max(0, Math.min(1, volume));
  if (typeof TrackPlayer.setVolume === 'function') {
    await TrackPlayer.setVolume(clamped);
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

export function formatForTrackPlayer(metadata: TrackMetadata, resolvedUrl: string, matchedUA: string) {
  return {
    id: metadata.id,
    mediaId: metadata.id,
    url: resolvedUrl, // MUST be clean string URL
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
}

export async function playTrack(
  selectedTrack: TrackMetadata, 
  contextQueue?: TrackMetadata[],
  preserveExistingQueue = false
) {
  try {
    const isPlayerReady = await setupPlayer();
    if (!isPlayerReady) {
      throw new Error('TrackPlayer setup failed or service unavailable');
    }

    // Step 1: Immediately stop and wipe any active native player queue
    if (typeof (TrackPlayer as any).reset === 'function') {
      try { await (TrackPlayer as any).reset(); } catch {}
    }
    if (typeof (TrackPlayer as any).clear === 'function') {
      try { await (TrackPlayer as any).clear(); } catch {}
    }

    // Step 2: Set currentTrack and update playback history
    if (currentTrack && currentTrack.id !== selectedTrack.id) {
      playbackHistory.push(currentTrack);
      if (playbackHistory.length > 30) playbackHistory.shift();
    }
    currentTrack = selectedTrack;
    setLastPlayedTrack(selectedTrack);
    saveListenHistory(selectedTrack);

    // Step 3: Set up the new upcoming queue
    if (contextQueue && contextQueue.length > 1) {
      const selectedIndex = contextQueue.findIndex(t => t.id === selectedTrack.id);
      upNextQueue = selectedIndex !== -1 ? contextQueue.slice(selectedIndex + 1) : [...contextQueue];
      // If user selected the last track of the playlist, upNextQueue is empty
      if (upNextQueue.length === 0 && !preserveExistingQueue) {
        prefetchAutoplayQueue(selectedTrack).catch(() => {});
      }
    } else if (!preserveExistingQueue) {
      // When contextQueue is NOT provided (e.g. tapping a single search result) or has <= 1 track
      upNextQueue = [];
      prefetchAutoplayQueue(selectedTrack).catch(() => {});
    }

    // Resolve audio stream URL for selectedTrack
    const downloadedTracks = getDownloadedTracks();
    const downloadedTrack = downloadedTracks.find(t => t.id === selectedTrack.id);
    const offlineTracks = getOfflineTracks();
    const offlineTrack = offlineTracks[selectedTrack.id];
    
    let playUrl = downloadedTrack?.localUri || offlineTrack?.localUri;
    if (!playUrl && selectedTrack.url) {
      playUrl = selectedTrack.url;
    }
    if (!playUrl) {
      const stream = await getAudioStream(selectedTrack.id);
      const resolved = typeof stream === 'string' ? stream : (stream as any)?.url;
      if (!resolved || !resolved.startsWith('http')) {
        const msg = `No playable audio stream found for track ${selectedTrack.id}`;
        console.warn(msg);
        try {
          Alert.alert('TrackPlayer Service Error', msg);
        } catch {}
        throw new Error(msg);
      }
      playUrl = resolved;
    }

    const isIosStream = playUrl.includes('c=IOS') || !playUrl.includes('c=ANDROID');
    const matchedUA = isIosStream
      ? 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)'
      : 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';

    const selectedPayload = formatForTrackPlayer(selectedTrack, playUrl, matchedUA);

    // Step 4: Construct native queue with selectedTrack STRICTLY at index 0
    const nextTracksToSeed = upNextQueue.slice(0, 4);
    const nextPayloads = nextTracksToSeed.map((t) => formatForTrackPlayer(
      t,
      t.url || `https://invidious.f5.si/latest_version?id=${t.id}&itag=140`,
      matchedUA
    ));

    const nativeTracks = [selectedPayload, ...nextPayloads];

    if (typeof setMediaItems === 'function') {
      await setMediaItems(nativeTracks, 0);
    } else if (typeof (TrackPlayer as any).setMediaItems === 'function') {
      await (TrackPlayer as any).setMediaItems(nativeTracks, 0);
    } else if (typeof setMediaItem === 'function') {
      await setMediaItem(selectedPayload);
      if (nextPayloads.length > 0 && typeof (TrackPlayer as any).addMediaItems === 'function') {
        try { await (TrackPlayer as any).addMediaItems(nextPayloads); } catch {}
      }
    } else if (typeof load === 'function') {
      await load(selectedPayload);
      if (nextPayloads.length > 0 && typeof (TrackPlayer as any).addMediaItems === 'function') {
        try { await (TrackPlayer as any).addMediaItems(nextPayloads); } catch {}
      }
    } else if (typeof (TrackPlayer as any).add === 'function') {
      await (TrackPlayer as any).add(nativeTracks);
    }

    await new Promise((r) => setTimeout(r, 50));

    // Step 5: Start playback immediately on the selected track
    const eqSettings = getEqualizerSettings();
    if (eqSettings.enabled && typeof eqSettings.soundBoost === 'number') {
      currentSoundBoostPercent = eqSettings.soundBoost;
    } else if (!eqSettings.enabled) {
      currentSoundBoostPercent = 0;
    }
    await applySoundBoost(currentSoundBoostPercent);
    resetSleepPaused();

    if (typeof play === 'function') {
      await play();
    } else {
      await TrackPlayer.play();
    }

    // Step 6: Notify queue listeners
    notifyQueueChange();

    try {
      const { isPartyActive, isHandlingRemoteSync, broadcastPartyAction } = require('./partyService');
      if (isPartyActive() && !isHandlingRemoteSync()) {
        broadcastPartyAction('TRACK_CHANGE', { track: selectedTrack });
      }
    } catch {}
  } catch (error: any) {
    console.error('[TrackPlayerService] playTrack error:', error);
    throw error;
  }
}

export async function PlaybackService() {
  // Headless background playback service handler stub
}

