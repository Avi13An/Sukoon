import TrackPlayer, { Event, RepeatMode, PlayerCommand, PlaybackState } from '@rntp/player';
import { Alert, AppState } from 'react-native';
import { 
  getOfflineTracks, 
  getDownloadedTracks, 
  setLastPlayedTrack, 
  getLastPlayedTrack, 
  saveListenHistory, 
  getListenHistory, 
  TrackMetadata 
} from '../utils/storage';
import { getAudioStream, getAlgorithmicRecommendations } from './musicApi';
import { handleTrackEndedForSleepTimer, resetSleepPaused } from './sleepTimerService';
import { sanitizeTrack, sanitizeTrackList } from '../utils/trackSanitizer';
import { fetchYouTubeMusicAutomix } from './youtubeRadioService';

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
let lastFailedTrackId: string | null = null;
let retryCount = 0;

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

export function cleanTrackId(id?: string | null): string {
  return (id || '').replace(/^yt_/i, '').trim();
}

export function addToUpNextQueue(track: TrackMetadata) {
  if (!track || !track.id) return;
  const cId = cleanTrackId(track.id);
  const isCurrent = currentTrack && (currentTrack.id === track.id || (cId && cleanTrackId(currentTrack.id) === cId));
  if (isCurrent) return;
  if (!upNextQueue.some(t => t.id === track.id || (cId && cleanTrackId(t.id) === cId))) {
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

export async function syncQueueFromHost(hostTrack: TrackMetadata | null, hostQueue: TrackMetadata[]) {
  if (Array.isArray(hostQueue)) {
    upNextQueue = [...hostQueue];
    notifyQueueChange();
    try {
      const nativeQueue = await getNativeQueue();
      const activeIndex = (await getNativeActiveIndex()) ?? 0;
      const remainingAhead = nativeQueue.length - 1 - activeIndex;
      if (remainingAhead < 2 && upNextQueue.length > 0) {
        const nextBatch = upNextQueue.slice(0, 3);
        const batchPayloads = await Promise.all(nextBatch.map(async (t) => {
          const u = await resolveStreamUrl(t);
          return formatForTrackPlayer(t, u);
        }));
        await addTracksToNativeQueue(batchPayloads);
      }
    } catch {}
  }
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

let isShuffleActive = false;
let preShuffleUpNextQueue: TrackMetadata[] = [];
const shuffleListeners: ((active: boolean) => void)[] = [];

export function getIsShuffleActive(): boolean {
  return isShuffleActive;
}

export function subscribeToShuffle(callback: (active: boolean) => void) {
  shuffleListeners.push(callback);
  callback(isShuffleActive);
  return () => {
    const idx = shuffleListeners.indexOf(callback);
    if (idx !== -1) shuffleListeners.splice(idx, 1);
  };
}

function notifyShuffleListeners() {
  shuffleListeners.forEach(cb => {
    try {
      cb(isShuffleActive);
    } catch {}
  });
}

export async function addTracksToNativeQueue(tracks: any[]) {
  if (!tracks || tracks.length === 0) return;
  try {
    const currentQueue = await getNativeQueue();
    let activeTrack: any = null;
    try {
      if (typeof (TrackPlayer as any).getActiveTrack === 'function') {
        activeTrack = await (TrackPlayer as any).getActiveTrack();
      } else if (typeof (TrackPlayer as any).getActiveMediaItem === 'function') {
        activeTrack = await (TrackPlayer as any).getActiveMediaItem();
      }
    } catch {}

    const cleanId = (id: string) => (id || '').replace(/^yt_/i, '').trim();
    const existingIds = new Set<string>();
    currentQueue.forEach((t: any) => {
      const tid = t?.id || t?.mediaId;
      if (tid) {
        existingIds.add(tid);
        existingIds.add(cleanId(tid));
      }
    });

    const activeId = activeTrack?.id || activeTrack?.mediaId || currentTrack?.id;
    if (activeId) {
      existingIds.add(activeId);
      existingIds.add(cleanId(activeId));
    }

    const uniqueNewTracks = tracks.filter((track) => {
      const tid = track?.id || track?.mediaId;
      if (!tid) return false;
      const cId = cleanId(tid);
      return !existingIds.has(tid) && !existingIds.has(cId) && (!activeId || (tid !== activeId && cId !== cleanId(activeId)));
    });

    if (uniqueNewTracks.length === 0) return;

    if (typeof (TrackPlayer as any).addMediaItems === 'function') {
      await (TrackPlayer as any).addMediaItems(uniqueNewTracks);
    } else if (typeof (TrackPlayer as any).add === 'function') {
      await (TrackPlayer as any).add(uniqueNewTracks);
    }
  } catch (err) {
    console.warn('[TrackPlayerService] addTracksToNativeQueue error:', err);
  }
}

export async function reorderNativeQueueFromUpNext(): Promise<void> {
  try {
    const queue = await getNativeQueue();
    const activeIndex = (await getNativeActiveIndex()) ?? 0;

    if (queue.length > activeIndex + 1) {
      const tracksToRemoveCount = queue.length - (activeIndex + 1);
      if (tracksToRemoveCount > 0) {
        const removeIndices = Array.from(
          { length: tracksToRemoveCount },
          (_, i) => activeIndex + 1 + i
        );
        for (let i = removeIndices.length - 1; i >= 0; i--) {
          try {
            if (typeof (TrackPlayer as any).remove === 'function') {
              await (TrackPlayer as any).remove(removeIndices[i]);
            }
          } catch {}
        }
      }
    }

    if (upNextQueue.length > 0) {
      const nextBatch = upNextQueue.slice(0, 3);
      const batchPayloads = await Promise.all(nextBatch.map(async (t) => {
        const u = await resolveStreamUrl(t);
        return formatForTrackPlayer(t, u);
      }));
      await addTracksToNativeQueue(batchPayloads);
    }

    notifyQueueListeners();
  } catch (err) {
    console.warn('[TrackPlayerService] reorderNativeQueueFromUpNext error:', err);
  }
}

export async function applySmartShuffle(enable: boolean): Promise<boolean> {
  try {
    isShuffleActive = enable;

    if (enable) {
      preShuffleUpNextQueue = [...upNextQueue];

      // Fisher-Yates shuffle
      const shuffled = [...upNextQueue];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      upNextQueue = shuffled;
    } else {
      if (preShuffleUpNextQueue.length > 0) {
        upNextQueue = [...preShuffleUpNextQueue];
      }
    }

    notifyShuffleListeners();
    notifyQueueListeners();
    await reorderNativeQueueFromUpNext();
    return isShuffleActive;
  } catch (err) {
    console.error('[SmartShuffle] Failed to shuffle upcoming queue:', err);
    notifyShuffleListeners();
    return isShuffleActive;
  }
}

export async function toggleSmartShuffle(): Promise<boolean> {
  return await applySmartShuffle(!isShuffleActive);
}

export async function getAudioStreamUrl(trackId: string, forceRefresh = true): Promise<string | null> {
  try {
    const stream = await getAudioStream(trackId);
    const resolved = typeof stream === 'string' ? stream : (stream as any)?.url;
    if (resolved && (resolved.startsWith('http') || resolved.startsWith('file://'))) {
      return resolved;
    }
  } catch (err) {
    console.warn('[TrackPlayer] getAudioStreamUrl error:', err);
  }
  return `https://invidious.f5.si/latest_version?id=${trackId}&itag=140`;
}

export async function resolveStreamUrl(track: TrackMetadata, bypassCache = false): Promise<string> {
  const downloadedTracks = getDownloadedTracks();
  const downloadedTrack = downloadedTracks.find(t => t.id === track.id);
  const offlineTracks = getOfflineTracks();
  const offlineTrack = offlineTracks[track.id];
  let playUrl = downloadedTrack?.localUri || offlineTrack?.localUri;
  if (!playUrl && track.url && !bypassCache) {
    if (track.url.startsWith('http') || track.url.startsWith('file://')) {
      playUrl = track.url;
    } else if (track.url.startsWith('/')) {
      playUrl = `file://${track.url}`;
    }
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

function filterRadioQueue(candidates: TrackMetadata[], current: TrackMetadata): TrackMetadata[] {
  const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const currentNormTitle = normalize(current?.title || '');
  const cleanCurrentId = cleanTrackId(current?.id);

  const junkTerms = [
    'karaoke', 'instrumental', 'ringtone', '8d audio',
    'slowed', 'reverb', 'bass boosted', 'tribute', 'parody'
  ];

  const currentTitleLower = (current?.title || '').toLowerCase();

  return candidates.filter((candidate) => {
    if (!candidate || !candidate.id) return false;

    const candCleanId = cleanTrackId(candidate.id);

    // Do not repeat current song (check raw and clean ID)
    if (candidate.id === current?.id || (cleanCurrentId && candCleanId === cleanCurrentId)) {
      return false;
    }

    // Do not repeat tracks recently played (check raw and prefixed variants)
    if (
      playedTrackIds.has(candidate.id) ||
      (candCleanId && (playedTrackIds.has(candCleanId) || playedTrackIds.has(`yt_${candCleanId}`)))
    ) {
      return false;
    }

    // Do not queue covers or duplicate versions of the exact same title
    const candidateNorm = normalize(candidate.title || '');
    if (candidateNorm && candidateNorm === currentNormTitle) return false;

    // Filter out low quality junk unless original song is that type
    const lowerTitle = (candidate.title || '').toLowerCase();
    const isJunk = junkTerms.some(term => lowerTitle.includes(term) && !currentTitleLower.includes(term));
    if (isJunk) return false;

    return true;
  });
}

export async function resolveVideoIdForTrack(track: TrackMetadata): Promise<string | null> {
  if (!track) return null;
  const rawId = (track.id || '').replace(/^yt_/i, '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(rawId)) {
    return rawId;
  }
  try {
    const { searchTracks } = require('./musicApi');
    const query = `${track.title || ''} ${track.artist || ''}`.trim();
    if (query) {
      const results = await searchTracks(query);
      const match = results.find((t: any) => t?.id && /^[a-zA-Z0-9_-]{11}$/.test(String(t.id).replace(/^yt_/i, '')));
      if (match?.id) {
        return String(match.id).replace(/^yt_/i, '').trim();
      }
    }
  } catch {}
  return null;
}

export async function fetchRadioQueue(track: TrackMetadata, sessionId: number): Promise<void> {
  try {
    const videoId = await resolveVideoIdForTrack(track);
    let rawRadioTracks: TrackMetadata[] = [];
    if (videoId) {
      rawRadioTracks = await fetchYouTubeMusicAutomix(videoId);
    }
    if (rawRadioTracks.length === 0) {
      rawRadioTracks = await getAlgorithmicRecommendations(track);
    }
    
    // Validate session before mutating queue
    if (sessionId !== activeQueueSessionId) {
      console.log('[Autoplay] Session changed, discarding stale radio queue');
      return;
    }

    const filteredTracks = filterRadioQueue(rawRadioTracks, track);

    if (filteredTracks.length > 0) {
      const existingIds = new Set<string>();
      const addIdVariants = (id?: string | null) => {
        if (!id) return;
        existingIds.add(id);
        const c = cleanTrackId(id);
        if (c) {
          existingIds.add(c);
          existingIds.add(`yt_${c}`);
        }
      };

      addIdVariants(track?.id);
      addIdVariants(currentTrack?.id);
      upNextQueue.forEach(t => addIdVariants(t?.id));

      const uniqueNewTracks = filteredTracks.filter(t => {
        if (!t?.id) return false;
        const c = cleanTrackId(t.id);
        return !existingIds.has(t.id) && (!c || !existingIds.has(c));
      });

      if (uniqueNewTracks.length > 0) {
        uniqueNewTracks.forEach(t => addIdVariants(t.id));
        upNextQueue = [...upNextQueue, ...uniqueNewTracks];
        
        // Pre-seed ExoPlayer with next 2 tracks
        const nativeQueue = await getNativeQueue();
        const activeIndex = (await getNativeActiveIndex()) ?? 0;
        if (nativeQueue.length - 1 - activeIndex < 2 && upNextQueue.length > 0) {
          const seedBatch = upNextQueue.slice(0, 2);
          const batchPayloads = await Promise.all(seedBatch.map(async (t) => {
            const u = await resolveStreamUrl(t);
            return formatForTrackPlayer(t, u);
          }));
          if (sessionId === activeQueueSessionId) {
            await addTracksToNativeQueue(batchPayloads);
          }
        }
        notifyQueueListeners();
        console.log(`[Autoplay] YTM Automix Radio queue populated with ${uniqueNewTracks.length} tracks for "${track.title}"`);
      }
    }
  } catch (err) {
    console.warn('[Autoplay] Radio queue error:', err);
  }
}

export const prefetchAutoplayQueue = fetchRadioQueue;

export async function maintainMinimumQueue(
  minSize = 10, 
  sessionId?: number
): Promise<TrackMetadata[]> {
  try {
    const syncService = require('./syncService');
    if (typeof syncService.isGuest === 'function' && syncService.isGuest()) {
      return [];
    }
  } catch {}
  const assignedSessionId = typeof sessionId === 'number' ? sessionId : activeQueueSessionId;
  if (isMaintainingQueue) return [];
  if (!currentTrack || upNextQueue.length >= minSize) return [];

  isMaintainingQueue = true;
  const added: TrackMetadata[] = [];
  try {
    const baseTrack = upNextQueue[upNextQueue.length - 1] || currentTrack;
    if (!baseTrack) return [];

    if (assignedSessionId !== activeQueueSessionId) {
      console.log('[Queue] Dropping maintainMinimumQueue (session mismatch)');
      return [];
    }

    const videoId = await resolveVideoIdForTrack(baseTrack);
    let rawRadioTracks: TrackMetadata[] = [];
    if (videoId) {
      rawRadioTracks = await fetchYouTubeMusicAutomix(videoId);
    }
    if (rawRadioTracks.length === 0) {
      rawRadioTracks = await getAlgorithmicRecommendations(baseTrack);
    }

    if (assignedSessionId !== activeQueueSessionId) return [];

    const filteredTracks = filterRadioQueue(rawRadioTracks, currentTrack);

    if (filteredTracks.length > 0) {
      const existingIds = new Set<string>();
      const addIdVariants = (id?: string | null) => {
        if (!id) return;
        existingIds.add(id);
        const c = cleanTrackId(id);
        if (c) {
          existingIds.add(c);
          existingIds.add(`yt_${c}`);
        }
      };

      addIdVariants(currentTrack?.id);
      upNextQueue.forEach(t => addIdVariants(t?.id));

      const uniqueNewTracks = filteredTracks.filter(t => {
        if (!t?.id) return false;
        const c = cleanTrackId(t.id);
        return !existingIds.has(t.id) && (!c || !existingIds.has(c));
      });

      for (const cand of uniqueNewTracks) {
        if (upNextQueue.length >= minSize) break;
        upNextQueue.push(cand);
        added.push(cand);
        addIdVariants(cand.id);
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
      console.log(`[Queue] maintainMinimumQueue updated via YTM Automix Radio (size: ${upNextQueue.length}, added: ${added.length})`);
    }
  } catch (err) {
    console.error('[Queue] Error in maintainMinimumQueue:', err);
  } finally {
    isMaintainingQueue = false;
  }
  return added;
}

export async function handleActiveTrackChanged(event: any) {
  if (!event) return;
  const activeTrack = event.track || event.item || (event as any).nextTrack;
  // Guard: Ignore if event/item is null or during manual loading lock
  if (!activeTrack || isLoadingTrack) return;

  const activeTrackId = activeTrack.id || activeTrack.mediaId;
  if (activeTrackId && currentTrack?.id !== activeTrackId) {
    lastFailedTrackId = null;
    retryCount = 0;
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
        broadcastPartyAction('TRACK_CHANGE', { track: currentTrack, queue: upNextQueue });
      }
    } catch {}
    try {
      const syncService = require('./syncService');
      if (typeof syncService.isSyncActive === 'function' && syncService.isSyncActive() && !syncService.isHandlingRemoteSync()) {
        syncService.broadcastTrackChange(currentTrack, upNextQueue);
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
          progressUpdateEventInterval: 0.25,
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
        try {
          const syncService = require('./syncService');
          if (typeof syncService.isSyncActive === 'function' && syncService.isSyncActive() && !syncService.isHandlingRemoteSync()) {
            syncService.broadcastTrackChange(currentTrack, upNextQueue);
          }
        } catch {}
      });

      TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
        console.log('[TrackPlayerService] RemotePrevious triggered from media notification/controls');
        await playPreviousTrack();
        try {
          const syncService = require('./syncService');
          if (typeof syncService.isSyncActive === 'function' && syncService.isSyncActive() && !syncService.isHandlingRemoteSync()) {
            syncService.broadcastTrackChange(currentTrack, upNextQueue);
          }
        } catch {}
      });

      TrackPlayer.addEventListener(Event.RemotePlay, async () => {
        console.log('[TrackPlayerService] RemotePlay triggered');
        try { await TrackPlayer.play(); } catch {}
        try {
          const syncService = require('./syncService');
          if (typeof syncService.isSyncActive === 'function' && syncService.isSyncActive() && !syncService.isHandlingRemoteSync()) {
            const p = (await TrackPlayer.getProgress())?.position || 0;
            syncService.broadcastPlay(p);
          }
        } catch {}
      });

      TrackPlayer.addEventListener(Event.RemotePause, async () => {
        console.log('[TrackPlayerService] RemotePause triggered');
        try { await TrackPlayer.pause(); } catch {}
        try {
          const syncService = require('./syncService');
          if (typeof syncService.isSyncActive === 'function' && syncService.isSyncActive() && !syncService.isHandlingRemoteSync()) {
            const p = (await TrackPlayer.getProgress())?.position || 0;
            syncService.broadcastPause(p);
          }
        } catch {}
      });

      TrackPlayer.addEventListener(Event.RemoteSeek, async (event: any) => {
        console.log('[TrackPlayerService] RemoteSeek triggered', event?.position);
        if (typeof event?.position === 'number') {
          try { await TrackPlayer.seekTo(event.position); } catch {}
          try {
            const syncService = require('./syncService');
            if (typeof syncService.isSyncActive === 'function' && syncService.isSyncActive() && !syncService.isHandlingRemoteSync()) {
              syncService.broadcastSeek(event.position);
            }
          } catch {}
        }
      });

      // 4. Catch source errors (expired 403 URLs) and retry with a fresh stream before giving up
      TrackPlayer.addEventListener(Event.PlaybackError, async (error: any) => {
        console.warn('[TrackPlayer] Playback error encountered:', error);

        try {
          const activeTrack: any =
            (typeof (TrackPlayer as any).getActiveTrack === 'function'
              ? await (TrackPlayer as any).getActiveTrack()
              : typeof (TrackPlayer as any).getActiveMediaItem === 'function'
              ? (TrackPlayer as any).getActiveMediaItem()
              : null) || getCurrentTrack();

          const trackId = activeTrack?.id || activeTrack?.mediaId;
          if (!trackId) return;

          const errorMsg = error?.message || (typeof error === 'string' ? error : JSON.stringify(error || ''));
          const errorCode = error?.code;

          const isSourceError =
            errorCode === 'source' ||
            errorMsg.includes('Source error') ||
            errorMsg.includes('403') ||
            errorMsg.includes('BehindLiveWindow') ||
            errorMsg.includes('Response code: 403');

          if (isSourceError && lastFailedTrackId !== trackId && retryCount < 2) {
            lastFailedTrackId = trackId;
            retryCount++;
            console.log(`[TrackPlayer] Refreshing stream URL for ${activeTrack.title || trackId}...`);

            // Use the project's existing audio stream resolver with cache-bypass/force-refresh:
            const freshUrl = await getAudioStreamUrl(trackId, true);

            if (freshUrl) {
              const updatedTrack = {
                ...activeTrack,
                id: trackId,
                url: freshUrl,
              };

              if (typeof (TrackPlayer as any).load === 'function') {
                await (TrackPlayer as any).load(updatedTrack);
              } else if (typeof (TrackPlayer as any).setMediaItem === 'function') {
                await (TrackPlayer as any).setMediaItem(formatForTrackPlayer(updatedTrack, freshUrl));
              } else {
                await playTrack(updatedTrack, undefined, { fromQueue: true });
              }
              await TrackPlayer.play();
              return;
            }
          }

          // If unrecoverable, skip forward so playback never freezes
          console.warn('[TrackPlayer] Skipping unplayable track...');
          lastFailedTrackId = null;
          retryCount = 0;
          if (typeof (TrackPlayer as any).skipToNext === 'function') {
            try {
              await (TrackPlayer as any).skipToNext();
            } catch {
              await playNextTrack();
            }
          } else {
            await playNextTrack();
          }
          await TrackPlayer.play();
        } catch (e) {
          console.error('[TrackPlayer] Error recovery failed:', e);
        }
      });

      isListenersAttached = true;
    }

    isPlayerSetup = true;
    try {
      await TrackPlayer.setRepeatMode(RepeatMode.Off);
    } catch (repeatErr) {
      console.warn('[TrackPlayerService] Failed to set initial repeat mode:', repeatErr);
    }
    // Allow Android MediaController async connection to finish
    await new Promise((r) => setTimeout(r, 150));
    return true;
  } catch (e: any) {
    if (e?.message?.includes('already set up') || e?.message?.includes('Already set up')) {
      isPlayerSetup = true;
      try {
        await TrackPlayer.setRepeatMode(RepeatMode.Off);
      } catch {}
      return true;
    }
    console.error('setupPlayer initialization error:', e);
    return false;
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
  TrackPlayer.setRepeatMode(RepeatMode.Off);
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

export async function executeSeamlessTransition(
  track: TrackMetadata,
  playUrl: string,
  matchedUA?: string
): Promise<void> {
  const formatted = formatForTrackPlayer(track, playUrl, matchedUA);
  try {
    if (typeof (TrackPlayer as any).add === 'function') {
      await (TrackPlayer as any).add([formatted], 0);
    } else if (typeof (TrackPlayer as any).insertMediaItem === 'function') {
      await (TrackPlayer as any).insertMediaItem(0, formatted);
    } else if (typeof (TrackPlayer as any).addMediaItems === 'function') {
      await (TrackPlayer as any).addMediaItems([formatted]);
    }
  } catch (err) {
    console.warn('[TrackPlayerService] add track error in seamless transition:', err);
  }

  try {
    if (typeof (TrackPlayer as any).skip === 'function') {
      await (TrackPlayer as any).skip(0);
    } else if (typeof (TrackPlayer as any).skipToIndex === 'function') {
      await (TrackPlayer as any).skipToIndex(0);
    }
  } catch (err) {
    console.warn('[TrackPlayerService] skip error in seamless transition:', err);
  }

  try {
    const currentQueue = await getNativeQueue();
    if (currentQueue.length > 2) {
      if (typeof (TrackPlayer as any).remove === 'function') {
        await (TrackPlayer as any).remove([1]);
      } else if (typeof (TrackPlayer as any).removeMediaItem === 'function') {
        await (TrackPlayer as any).removeMediaItem(1);
      }
    }
  } catch {}

  resetSleepPaused();

  if (typeof play === 'function') {
    await play();
  } else {
    await TrackPlayer.play();
  }
}

export async function playFromQueue(index: number): Promise<void> {
  if (index < 0 || index >= upNextQueue.length) return;

  try {
    // 1. Extract the target track
    const targetTrack = upNextQueue[index];
    if (!targetTrack || !targetTrack.id) return;

    // 2. Slice the queue to keep everything AFTER this track
    const remainingQueue = upNextQueue.slice(index + 1);

    // 3. Play the target track with the remaining sliced queue
    await playTrack(targetTrack, remainingQueue);
  } catch (err) {
    console.warn('[Queue] Error playing track from queue:', err);
  }
}

export async function playTrack(
  selectedTrack: TrackMetadata, 
  newQueue?: TrackMetadata[],
  options?: { fromQueue?: boolean } | boolean
): Promise<void> {
  const safeTrack = sanitizeTrack(selectedTrack);
  if (!safeTrack || !safeTrack.id) {
    console.warn('[TrackPlayerService] playTrack called without valid track');
    return;
  }

  const isFromQueue = typeof options === 'boolean' ? options : options?.fromQueue === true;
  isLoadingTrack = true;

  try {
    const isPlayerReady = await setupPlayer();
    if (!isPlayerReady) {
      console.warn('[TrackPlayerService] TrackPlayer setup failed or service unavailable');
      isLoadingTrack = false;
      return;
    }

    activeQueueSessionId++;
    const currentSession = activeQueueSessionId;

    currentTrack = safeTrack;

    const cleanTargetId = cleanTrackId(safeTrack.id);

    if (Array.isArray(newQueue)) {
      const sanitizedQueue = sanitizeTrackList(newQueue);
      const idx = sanitizedQueue.findIndex(t => {
        if (!t?.id) return false;
        return t.id === safeTrack.id || (cleanTargetId && cleanTrackId(t.id) === cleanTargetId);
      });
      upNextQueue = idx !== -1 ? sanitizedQueue.slice(idx + 1) : [...sanitizedQueue];
    } else if (
      isFromQueue || 
      upNextQueue.some(t => t?.id === safeTrack.id || (cleanTargetId && cleanTrackId(t?.id) === cleanTargetId))
    ) {
      const queueIndex = upNextQueue.findIndex(t => {
        if (!t?.id) return false;
        return t.id === safeTrack.id || (cleanTargetId && cleanTrackId(t.id) === cleanTargetId);
      });
      upNextQueue = queueIndex !== -1 ? upNextQueue.slice(queueIndex + 1) : [];
    } else {
      upNextQueue = [];
    }

    // Ensure safeTrack itself is never present in upNextQueue
    upNextQueue = upNextQueue.filter(t => {
      if (!t?.id) return false;
      return t.id !== safeTrack.id && (cleanTargetId ? cleanTrackId(t.id) !== cleanTargetId : true);
    });

    isShuffleActive = false;
    preShuffleUpNextQueue = [];
    notifyShuffleListeners();

    playedTrackIds.add(currentTrack.id);
    if (cleanTargetId) {
      playedTrackIds.add(cleanTargetId);
      playedTrackIds.add(`yt_${cleanTargetId}`);
    }
    setLastPlayedTrack(currentTrack);
    saveListenHistory(currentTrack);
    notifyQueueListeners();

    let playUrl = await resolveStreamUrl(currentTrack);
    if (!playUrl || (!playUrl.startsWith('http') && !playUrl.startsWith('file://'))) {
      playUrl = `https://invidious.f5.si/latest_version?id=${currentTrack.id}&itag=140`;
    }

    const isIosStream = playUrl.includes('c=IOS') || !playUrl.includes('c=ANDROID');
    const matchedUA = isIosStream
      ? 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)'
      : 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';

    if (AppState.currentState !== 'active') {
      await executeSeamlessTransition(currentTrack, playUrl, matchedUA);
    } else {
      if (typeof (TrackPlayer as any).reset === 'function') {
        try { await (TrackPlayer as any).reset(); } catch {}
      }
      if (typeof (TrackPlayer as any).clear === 'function') {
        try { await (TrackPlayer as any).clear(); } catch {}
      }

      const seedNext = upNextQueue
        .filter(t => t?.id && t.id !== safeTrack.id && (cleanTargetId ? cleanTrackId(t.id) !== cleanTargetId : true))
        .slice(0, 3);

      const seed = [
        formatForTrackPlayer(currentTrack || safeTrack, playUrl, matchedUA),
        ...seedNext.map(t => formatForTrackPlayer(t, t.url || `https://invidious.f5.si/latest_version?id=${t.id}&itag=140`, matchedUA))
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

      resetSleepPaused();

      if (typeof play === 'function') {
        await play();
      } else {
        await TrackPlayer.play();
      }
    }

    notifyQueueListeners();
    setTimeout(() => { isLoadingTrack = false; }, 1200);

    // Replenish recommendations:
    // If upNextQueue is empty (e.g. played single track from Search), generate related radio queue
    if (upNextQueue.length === 0) {
      fetchRadioQueue(selectedTrack, currentSession).catch(() => {});
    } else if (upNextQueue.length < 10) {
      maintainMinimumQueue(10, currentSession).catch(() => {});
    }

    try {
      const { isPartyActive, isHandlingRemoteSync, broadcastPartyAction } = require('./partyService');
      if (isPartyActive() && !isHandlingRemoteSync()) {
        broadcastPartyAction('TRACK_CHANGE', { track: currentTrack, queue: upNextQueue });
      }
    } catch {}
    try {
      const syncService = require('./syncService');
      if (typeof syncService.isSyncActive === 'function' && syncService.isSyncActive() && !syncService.isHandlingRemoteSync()) {
        syncService.broadcastTrackChange(currentTrack, upNextQueue);
      }
    } catch {}

    // Asynchronously pre-resolve streams for the buffered tracks in native queue
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
  } catch (error: any) {
    console.error('[TrackPlayerService] playTrack error:', error);
    isLoadingTrack = false;
  }
}


export async function PlaybackService() {
  // Headless background playback service handler stub
}

