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
let isLoadingTrack = false;
let isAutoTransitioning = false;
let activeQueueSessionId = 0;
let upNextQueue: TrackMetadata[] = [];
let playbackHistory: TrackMetadata[] = [];
let currentTrack: TrackMetadata | null = null;
const playedTrackIds = new Set<string>();
const queueListeners: Array<(queue: TrackMetadata[]) => void> = [];

export function getCurrentTrack(): TrackMetadata | null {
  return currentTrack || getLastPlayedTrack();
}

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

export function removeTrackFromQueue(index: number) {
  if (index >= 0 && index < upNextQueue.length) {
    upNextQueue.splice(index, 1);
    notifyQueueChange();
    if (upNextQueue.length < 10) {
      maintainMinimumQueue(10).catch(() => {});
    }
  }
}
export const removeFromUpNextQueue = removeTrackFromQueue;

export function reorderQueue(fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || fromIndex >= upNextQueue.length || toIndex < 0 || toIndex >= upNextQueue.length) return;
  const [movedItem] = upNextQueue.splice(fromIndex, 1);
  upNextQueue.splice(toIndex, 0, movedItem);
  notifyQueueChange();
}
export const reorderUpNextQueue = reorderQueue;

export function clearUpNextQueue() {
  upNextQueue = [];
  notifyQueueChange();
}

export async function getNativeQueue(): Promise<any[]> {
  try {
    if (typeof (TrackPlayer as any).getQueue === 'function') {
      const q = await (TrackPlayer as any).getQueue();
      return Array.isArray(q) ? q : [];
    }
  } catch {}
  return [];
}

export async function getNativeActiveIndex(): Promise<number> {
  try {
    if (typeof (TrackPlayer as any).getActiveMediaItemIndex === 'function') {
      const idx = await (TrackPlayer as any).getActiveMediaItemIndex();
      if (typeof idx === 'number') return idx;
    }
    if (typeof (TrackPlayer as any).getActiveTrackIndex === 'function') {
      const idx = await (TrackPlayer as any).getActiveTrackIndex();
      if (typeof idx === 'number') return idx;
    }
  } catch {}
  return 0;
}

export async function addTracksToNativeQueue(tracks: any[]) {
  if (!tracks || tracks.length === 0) return;
  try {
    if (typeof (TrackPlayer as any).addMediaItems === 'function') {
      await (TrackPlayer as any).addMediaItems(tracks);
    } else if (typeof (TrackPlayer as any).add === 'function') {
      await (TrackPlayer as any).add(tracks);
    }
  } catch (err) {
    console.warn('[TrackPlayerService] addTracksToNativeQueue error:', err);
  }
}

export async function resolveStreamUrl(track: TrackMetadata): Promise<string> {
  const downloadedTracks = getDownloadedTracks();
  const downloadedTrack = downloadedTracks.find(t => t.id === track.id);
  const offlineTracks = getOfflineTracks();
  const offlineTrack = offlineTracks[track.id];
  let playUrl = downloadedTrack?.localUri || offlineTrack?.localUri;
  if (!playUrl && track.url && (track.url.startsWith('http') || track.url.startsWith('file://'))) {
    playUrl = track.url;
  }
  if (!playUrl) {
    try {
      const stream = await getAudioStream(track.id);
      const resolved = typeof stream === 'string' ? stream : (stream as any)?.url;
      if (resolved && (resolved.startsWith('http') || resolved.startsWith('file://'))) {
        playUrl = resolved;
      }
    } catch {}
  }
  return playUrl || `https://invidious.f5.si/latest_version?id=${track.id}&itag=140`;
}

let isMaintainingQueue = false;

export async function maintainMinimumQueue(
  minSize = 10, 
  sessionId?: number
): Promise<TrackMetadata[]> {
  const assignedSessionId = typeof sessionId === 'number' ? sessionId : activeQueueSessionId;
  if (isMaintainingQueue) return [];
  if (!currentTrack || upNextQueue.length >= minSize) return [];

  isMaintainingQueue = true;
  const added: TrackMetadata[] = [];
  try {
    const baseTrack = currentTrack;
    if (!baseTrack) return [];

    if (assignedSessionId !== activeQueueSessionId) {
      console.log('[Queue] Dropping maintainMinimumQueue (session mismatch)');
      return [];
    }

    const queries: string[] = [];
    if (baseTrack.artist && baseTrack.artist !== 'Unknown Artist') {
      queries.push(`${baseTrack.artist} songs`);
      if ((baseTrack as any).genre) {
        queries.push(`${baseTrack.artist} ${(baseTrack as any).genre}`);
      }
    }
    if (baseTrack.title) {
      queries.push(`${baseTrack.title} ${baseTrack.artist || ''} mix`);
    }
    if ((baseTrack as any).genre) {
      queries.push(`${(baseTrack as any).genre} trending`);
    }
    if (queries.length === 0) {
      queries.push(`${baseTrack.title || 'trending'} radio`);
    }

    for (const q of queries) {
      if (assignedSessionId !== activeQueueSessionId) return [];
      if (upNextQueue.length >= minSize) break;

      const candidates = await searchTracks(q);
      if (assignedSessionId !== activeQueueSessionId) return [];

      if (Array.isArray(candidates) && candidates.length > 0) {
        const freshTracks = candidates.filter(
          t => t?.id &&
               !playedTrackIds.has(t.id) &&
               t.id !== currentTrack?.id &&
               !upNextQueue.some(qItem => qItem.id === t.id)
        );

        for (const cand of freshTracks) {
          if (upNextQueue.length >= minSize) break;
          upNextQueue.push(cand);
          added.push(cand);
        }
      }
    }

    if (assignedSessionId !== activeQueueSessionId) return [];

    // Ensure native ExoPlayer has at least 2 tracks ahead
    const nativeQueue = await getNativeQueue();
    const activeIndex = (await getNativeActiveIndex()) ?? 0;
    const remainingAhead = nativeQueue.length - 1 - activeIndex;

    if (remainingAhead < 2 && upNextQueue.length > 0) {
      const nextBatch = upNextQueue.slice(0, 3);
      const batchPayloads = await Promise.all(nextBatch.map(async (t) => {
        const u = await resolveStreamUrl(t);
        return formatForTrackPlayer(t, u);
      }));
      if (assignedSessionId !== activeQueueSessionId) return [];
      await addTracksToNativeQueue(batchPayloads);
    }

    notifyQueueListeners();
    console.log(`[Queue] maintainMinimumQueue updated (size: ${upNextQueue.length}, added: ${added.length})`);
  } catch (err) {
    console.error('[Queue] Error in maintainMinimumQueue:', err);
  } finally {
    isMaintainingQueue = false;
  }
  return added;
}

export const prefetchAutoplayQueue = maintainMinimumQueue;

export async function handleActiveTrackChanged(event: any) {
  if (!event) return;
  const activeTrack = event.track || event.item || (event as any).nextTrack;
  // Guard: Ignore if event/item is null or during manual loading lock
  if (!activeTrack || isLoadingTrack) return;

  const activeTrackId = activeTrack.id || activeTrack.mediaId;
  if (activeTrackId && currentTrack?.id !== activeTrackId) {
    console.log(`[Queue] Native track changed to: ${activeTrack.title || activeTrackId}`);
    if (currentTrack) {
      playbackHistory.push(currentTrack);
      if (playbackHistory.length > 30) playbackHistory.shift();
    }

    const nextIndex = upNextQueue.findIndex(t => t.id === activeTrackId);
    if (nextIndex !== -1) {
      currentTrack = upNextQueue[nextIndex];
      upNextQueue = upNextQueue.slice(nextIndex + 1);
    } else if (upNextQueue.length > 0) {
      currentTrack = upNextQueue.shift()!;
    } else {
      currentTrack = {
        id: activeTrackId,
        title: activeTrack.title || 'Unknown Title',
        artist: activeTrack.artist || 'Unknown Artist',
        artwork: activeTrack.artwork || activeTrack.artworkUrl,
        duration: activeTrack.duration,
        url: typeof activeTrack.url === 'string' ? activeTrack.url : undefined,
      };
    }

    if (currentTrack?.id) {
      playedTrackIds.add(currentTrack.id);
      setLastPlayedTrack(currentTrack);
      saveListenHistory(currentTrack);
    }
    notifyQueueChange();

    try {
      const { isPartyActive, isHandlingRemoteSync, broadcastPartyAction } = require('./partyService');
      if (isPartyActive() && !isHandlingRemoteSync()) {
        broadcastPartyAction('TRACK_CHANGE', { track: currentTrack });
      }
    } catch {}
  }

  // Replenish native ExoPlayer buffer and maintain minimum 10 songs:
  try {
    const nativeQueue = await getNativeQueue();
    const activeIndex = (await getNativeActiveIndex()) ?? 0;
    const remainingAhead = nativeQueue.length - 1 - activeIndex;

    if (remainingAhead < 2 && upNextQueue.length > 0) {
      const nextToSeed = upNextQueue[0];
      const resolvedUrl = await resolveStreamUrl(nextToSeed);
      await addTracksToNativeQueue([formatForTrackPlayer(nextToSeed, resolvedUrl)]);
    }

    // Ensure queue always has >= 10 songs ahead without repeating played tracks
    await maintainMinimumQueue(10);
  } catch (replenishErr) {
    console.warn('[Queue] Replenish error in handleActiveTrackChanged:', replenishErr);
  }
}

export async function handleEmergencyQueueEnded() {
  if (isLoadingTrack || isAutoTransitioning) return;
  isAutoTransitioning = true;
  try {
    if (await handleTrackEndedForSleepTimer()) return;
    const repeatMode = TrackPlayer.getRepeatMode();
    if (repeatMode !== RepeatMode.Off) return;

    if (upNextQueue.length > 0) {
      const next = upNextQueue[0];
      await playTrack(next, undefined, { fromQueue: true });
    } else {
      await maintainMinimumQueue(10);
      if (upNextQueue.length > 0) {
        const next = upNextQueue[0];
        await playTrack(next, undefined, { fromQueue: true });
      }
    }
  } catch (err) {
    console.warn('[Queue] Emergency queue ended error:', err);
  } finally {
    setTimeout(() => {
      isAutoTransitioning = false;
    }, 1500);
  }
}

export const handleAutoplayTransition = handleEmergencyQueueEnded;

export async function playNextTrack(forcedTrackIndex?: number) {
  if (isResolvingAutoplay) return;
  isResolvingAutoplay = true;

  try {
    if (typeof forcedTrackIndex === 'number' && forcedTrackIndex >= 0 && forcedTrackIndex < upNextQueue.length) {
      const chosen = upNextQueue[forcedTrackIndex];
      if (chosen) {
        await playTrack(chosen, undefined, { fromQueue: true });
      }
      return;
    }

    if (upNextQueue.length > 0) {
      const next = upNextQueue[0];
      await playTrack(next, undefined, { fromQueue: true });
      return;
    }

    await maintainMinimumQueue(10);
    if (upNextQueue.length > 0) {
      const next = upNextQueue[0];
      await playTrack(next, undefined, { fromQueue: true });
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
    if (progress && typeof progress.position === 'number' && progress.position > 3) {
      await TrackPlayer.seekTo(0);
      return;
    }

    const activeIndex = await getNativeActiveIndex();
    if (typeof activeIndex === 'number' && activeIndex > 0) {
      if (typeof (TrackPlayer as any).skipToPrevious === 'function') {
        await (TrackPlayer as any).skipToPrevious();
        return;
      }
    }

    if (playbackHistory.length > 0) {
      const prevTrack = playbackHistory.pop();
      if (prevTrack) {
        if (currentTrack) {
          upNextQueue.unshift(currentTrack);
          notifyQueueChange();
        }
        await playTrack(prevTrack, undefined, true);
        return;
      }
    }

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
      // 1. Listen for native track transitions (ExoPlayer automatically advancing in foreground & background)
      TrackPlayer.addEventListener(Event.MediaItemTransition, async (event: any) => {
        await handleActiveTrackChanged(event);
      });

      const activeTrackChangedEvent = (Event as any).PlaybackActiveTrackChanged;
      if (activeTrackChangedEvent) {
        TrackPlayer.addEventListener(activeTrackChangedEvent as any, async (event: any) => {
          await handleActiveTrackChanged(event);
        });
      }

      // 2. Emergency fallback ONLY if native queue completely empties
      const queueEndedEvent = (Event as any).PlaybackQueueEnded || 'event.playback-queue-ended';
      TrackPlayer.addEventListener(queueEndedEvent as any, async () => {
        console.log('[TrackPlayerService] PlaybackQueueEnded emergency fallback triggered');
        await handleEmergencyQueueEnded();
      });

      // 3. Remote control events from lockscreen, notification shade, Bluetooth, or headset
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

export function formatForTrackPlayer(metadata: TrackMetadata, resolvedUrl?: string, matchedUA?: string) {
  const isIos = resolvedUrl?.includes('c=IOS') || !resolvedUrl?.includes('c=ANDROID');
  const ua = matchedUA || (isIos
    ? 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)'
    : 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip');
  const url = resolvedUrl || metadata.url || `https://invidious.f5.si/latest_version?id=${metadata.id}&itag=140`;

  return {
    id: metadata.id,
    mediaId: metadata.id,
    url: url,
    title: metadata.title || 'Unknown Title',
    artist: metadata.artist || 'Unknown Artist',
    artwork: metadata.artwork || undefined,
    artworkUrl: metadata.artwork || undefined,
    duration: metadata.duration,
    headers: {
      'User-Agent': ua,
      'Accept': '*/*'
    }
  };
}

export async function playTrack(
  selectedTrack: TrackMetadata, 
  contextQueue?: TrackMetadata[],
  options?: { fromQueue?: boolean } | boolean
) {
  const isFromQueue = typeof options === 'boolean' ? options : options?.fromQueue === true;
  const inQueue = upNextQueue.some(t => t.id === selectedTrack.id);

  isLoadingTrack = true;

  try {
    const isPlayerReady = await setupPlayer();
    if (!isPlayerReady) {
      throw new Error('TrackPlayer setup failed or service unavailable');
    }

    // CASE A: Song is selected directly from the active queue OR exists in upNextQueue
    if (isFromQueue || inQueue) {
      const queueIndex = upNextQueue.findIndex(t => t.id === selectedTrack.id);
      if (queueIndex !== -1) {
        currentTrack = upNextQueue[queueIndex];
        // Slice queue so everything AFTER this song remains upcoming in order
        upNextQueue = upNextQueue.slice(queueIndex + 1);
      } else {
        currentTrack = selectedTrack;
      }
      playedTrackIds.add(currentTrack.id);
      setLastPlayedTrack(currentTrack);
      saveListenHistory(currentTrack);

      if (typeof (TrackPlayer as any).reset === 'function') {
        try { await (TrackPlayer as any).reset(); } catch {}
      }
      if (typeof (TrackPlayer as any).clear === 'function') {
        try { await (TrackPlayer as any).clear(); } catch {}
      }

      let playUrl = await resolveStreamUrl(currentTrack);
      if (!playUrl || (!playUrl.startsWith('http') && !playUrl.startsWith('file://'))) {
        const msg = `No playable audio stream found for track ${currentTrack.id}`;
        console.warn(msg);
        try { Alert.alert('TrackPlayer Service Error', msg); } catch {}
        throw new Error(msg);
      }

      const isIosStream = playUrl.includes('c=IOS') || !playUrl.includes('c=ANDROID');
      const matchedUA = isIosStream
        ? 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)'
        : 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';

      const seed = [
        formatForTrackPlayer(currentTrack, playUrl, matchedUA),
        ...upNextQueue.slice(0, 3).map(t => formatForTrackPlayer(t, t.url || `https://invidious.f5.si/latest_version?id=${t.id}&itag=140`, matchedUA))
      ];

      if (typeof setMediaItems === 'function') {
        await setMediaItems(seed, 0);
      } else if (typeof (TrackPlayer as any).setMediaItems === 'function') {
        await (TrackPlayer as any).setMediaItems(seed, 0);
      } else if (typeof (TrackPlayer as any).add === 'function') {
        await (TrackPlayer as any).add(seed);
      } else {
        await addTracksToNativeQueue(seed);
      }

      await applySoundBoost(currentSoundBoostPercent);
      resetSleepPaused();

      if (typeof play === 'function') {
        await play();
      } else {
        await TrackPlayer.play();
      }

      notifyQueueListeners();
      setTimeout(() => { isLoadingTrack = false; }, 1200);
      maintainMinimumQueue(10).catch(() => {});

      try {
        const { isPartyActive, isHandlingRemoteSync, broadcastPartyAction } = require('./partyService');
        if (isPartyActive() && !isHandlingRemoteSync()) {
          broadcastPartyAction('TRACK_CHANGE', { track: currentTrack });
        }
      } catch {}

      // Asynchronously pre-resolve streams for the buffered tracks in native queue
      (async () => {
        try {
          const buffered = upNextQueue.slice(0, 3);
          for (let i = 0; i < buffered.length; i++) {
            const t = buffered[i];
            const streamUrl = await resolveStreamUrl(t);
            if (streamUrl && streamUrl !== t.url) {
              t.url = streamUrl;
              if (typeof (TrackPlayer as any).replaceMediaItem === 'function') {
                try {
                  await (TrackPlayer as any).replaceMediaItem(i + 1, formatForTrackPlayer(t, streamUrl, matchedUA));
                } catch {}
              }
            }
          }
        } catch {}
      })();

      return;
    }

    // CASE B: Song is from a Playlist or Album context (contextQueue && contextQueue.length > 0)
    if (contextQueue && contextQueue.length > 0) {
      activeQueueSessionId++;
      const currentSession = activeQueueSessionId;
      const clonedContext = [...contextQueue];
      const selectedIndex = clonedContext.findIndex(t => t.id === selectedTrack.id);
      currentTrack = selectedTrack;
      playedTrackIds.clear();
      playedTrackIds.add(currentTrack.id);
      setLastPlayedTrack(currentTrack);
      saveListenHistory(currentTrack);

      // Set upNextQueue strictly to all subsequent songs in that exact playlist order
      upNextQueue = selectedIndex !== -1 
        ? clonedContext.slice(selectedIndex + 1) 
        : clonedContext.filter(t => t.id !== selectedTrack.id);

      if (typeof (TrackPlayer as any).reset === 'function') {
        try { await (TrackPlayer as any).reset(); } catch {}
      }
      if (typeof (TrackPlayer as any).clear === 'function') {
        try { await (TrackPlayer as any).clear(); } catch {}
      }

      let playUrl = await resolveStreamUrl(currentTrack);
      if (!playUrl || (!playUrl.startsWith('http') && !playUrl.startsWith('file://'))) {
        const msg = `No playable audio stream found for track ${currentTrack.id}`;
        console.warn(msg);
        try { Alert.alert('TrackPlayer Service Error', msg); } catch {}
        throw new Error(msg);
      }

      const isIosStream = playUrl.includes('c=IOS') || !playUrl.includes('c=ANDROID');
      const matchedUA = isIosStream
        ? 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)'
        : 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';

      const seed = [
        formatForTrackPlayer(currentTrack, playUrl, matchedUA),
        ...upNextQueue.slice(0, 3).map(t => formatForTrackPlayer(t, t.url || `https://invidious.f5.si/latest_version?id=${t.id}&itag=140`, matchedUA))
      ];

      if (typeof setMediaItems === 'function') {
        await setMediaItems(seed, 0);
      } else if (typeof (TrackPlayer as any).setMediaItems === 'function') {
        await (TrackPlayer as any).setMediaItems(seed, 0);
      } else if (typeof (TrackPlayer as any).add === 'function') {
        await (TrackPlayer as any).add(seed);
      } else {
        await addTracksToNativeQueue(seed);
      }

      await applySoundBoost(currentSoundBoostPercent);
      resetSleepPaused();

      if (typeof play === 'function') {
        await play();
      } else {
        await TrackPlayer.play();
      }

      notifyQueueListeners();
      setTimeout(() => { isLoadingTrack = false; }, 1200);
      // Only append recommendations if playlist has fewer than 10 tracks
      maintainMinimumQueue(10, currentSession).catch(() => {});

      try {
        const { isPartyActive, isHandlingRemoteSync, broadcastPartyAction } = require('./partyService');
        if (isPartyActive() && !isHandlingRemoteSync()) {
          broadcastPartyAction('TRACK_CHANGE', { track: currentTrack });
        }
      } catch {}

      (async () => {
        try {
          const buffered = upNextQueue.slice(0, 3);
          for (let i = 0; i < buffered.length; i++) {
            if (currentSession !== activeQueueSessionId) return;
            const t = buffered[i];
            const streamUrl = await resolveStreamUrl(t);
            if (currentSession !== activeQueueSessionId) return;
            if (streamUrl && streamUrl !== t.url) {
              t.url = streamUrl;
              if (typeof (TrackPlayer as any).replaceMediaItem === 'function') {
                try {
                  await (TrackPlayer as any).replaceMediaItem(i + 1, formatForTrackPlayer(t, streamUrl, matchedUA));
                } catch {}
              }
            }
          }
        } catch {}
      })();

      return;
    }

    // CASE C: Brand-new song selected outside the queue (from Home / Search) without context
    activeQueueSessionId++;
    const currentSession = activeQueueSessionId;
    currentTrack = selectedTrack;
    upNextQueue = [];
    playedTrackIds.clear();
    playedTrackIds.add(currentTrack.id);
    setLastPlayedTrack(currentTrack);
    saveListenHistory(currentTrack);

    if (typeof (TrackPlayer as any).reset === 'function') {
      try { await (TrackPlayer as any).reset(); } catch {}
    }
    if (typeof (TrackPlayer as any).clear === 'function') {
      try { await (TrackPlayer as any).clear(); } catch {}
    }

    let playUrl = await resolveStreamUrl(currentTrack);
    if (!playUrl || (!playUrl.startsWith('http') && !playUrl.startsWith('file://'))) {
      const msg = `No playable audio stream found for track ${currentTrack.id}`;
      console.warn(msg);
      try { Alert.alert('TrackPlayer Service Error', msg); } catch {}
      throw new Error(msg);
    }

    const isIosStream = playUrl.includes('c=IOS') || !playUrl.includes('c=ANDROID');
    const matchedUA = isIosStream
      ? 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)'
      : 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';

    const seed = [formatForTrackPlayer(currentTrack, playUrl, matchedUA)];

    if (typeof setMediaItems === 'function') {
      await setMediaItems(seed, 0);
    } else if (typeof (TrackPlayer as any).setMediaItems === 'function') {
      await (TrackPlayer as any).setMediaItems(seed, 0);
    } else if (typeof (TrackPlayer as any).add === 'function') {
      await (TrackPlayer as any).add(seed);
    } else {
      await addTracksToNativeQueue(seed);
    }

    await applySoundBoost(currentSoundBoostPercent);
    resetSleepPaused();

    if (typeof play === 'function') {
      await play();
    } else {
      await TrackPlayer.play();
    }

    notifyQueueListeners();
    setTimeout(() => { isLoadingTrack = false; }, 1200);

    // Populate fresh 10-song queue for this new genre/song
    maintainMinimumQueue(10, currentSession).catch(() => {});

    try {
      const { isPartyActive, isHandlingRemoteSync, broadcastPartyAction } = require('./partyService');
      if (isPartyActive() && !isHandlingRemoteSync()) {
        broadcastPartyAction('TRACK_CHANGE', { track: currentTrack });
      }
    } catch {}
  } catch (error: any) {
    console.error('[TrackPlayerService] playTrack error:', error);
    isLoadingTrack = false;
    throw error;
  }
}

export async function PlaybackService() {
  // Headless background playback service handler stub
}

