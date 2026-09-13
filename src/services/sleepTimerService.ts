import TrackPlayer from '@rntp/player';
import { storage } from '../utils/storage';

export type SleepTimerMode = '5m' | '15m' | '30m' | '45m' | '60m' | 'end_of_track' | 'off' | 'custom';

export interface SleepTimerState {
  isActive: boolean;
  mode: SleepTimerMode;
  timeRemainingSeconds: number;
  isSleepPaused: boolean;
  targetTimestamp: number | null;
}

export const SLEEP_TIMER_STORAGE_KEY = '@sukoon_sleep_timer_target';
export const SLEEP_TIMER_MODE_KEY = '@sukoon_sleep_timer_mode';

const AsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return storage.getString(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      storage.set(key, value);
    } catch (e) {
      console.warn('[SleepTimer] Storage set error:', e);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      storage.remove(key);
    } catch (e) {
      console.warn('[SleepTimer] Storage remove error:', e);
    }
  },
};

let sleepTimerTarget: number | null = null;
let currentMode: SleepTimerMode = 'off';
let isSleepPaused = false;
let fallbackInterval: ReturnType<typeof setInterval> | null = null;

export type SleepTimerSubscriber = (remainingMs: number | null, state: SleepTimerState) => void;
let sleepTimerSubscribers: SleepTimerSubscriber[] = [];

function determineModeFromMinutes(minutes: number): SleepTimerMode {
  if (minutes === 5) return '5m';
  if (minutes === 15) return '15m';
  if (minutes === 30) return '30m';
  if (minutes === 45) return '45m';
  if (minutes === 60) return '60m';
  return 'custom';
}

function startFallbackWatcher() {
  if (!fallbackInterval) {
    fallbackInterval = setInterval(async () => {
      if (sleepTimerTarget) {
        await checkSleepTimerExpiration();
      } else if (currentMode !== 'end_of_track') {
        stopFallbackWatcher();
      }
    }, 5000);
  }
}

function stopFallbackWatcher() {
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }
}

export function getSleepTimerRemaining(): number | null {
  if (!sleepTimerTarget) return null;
  const remaining = sleepTimerTarget - Date.now();
  return remaining > 0 ? remaining : null;
}

export function isSleepTimerActive(): boolean {
  if (currentMode === 'end_of_track') return true;
  const rem = getSleepTimerRemaining();
  return rem !== null && rem > 0;
}

export function getSleepTimerState(): SleepTimerState {
  const rem = getSleepTimerRemaining();
  const remSec = rem !== null ? Math.ceil(rem / 1000) : 0;
  const isActive = currentMode === 'end_of_track' || (sleepTimerTarget !== null && rem !== null && rem > 0);
  return {
    isActive,
    mode: currentMode,
    timeRemainingSeconds: remSec,
    isSleepPaused,
    targetTimestamp: sleepTimerTarget,
  };
}

function notifySleepTimerSubscribers() {
  const remaining = getSleepTimerRemaining();
  const state = getSleepTimerState();
  sleepTimerSubscribers.forEach((cb) => {
    try {
      cb(remaining, state);
    } catch (err) {
      console.warn('[SleepTimer] Subscriber callback error:', err);
    }
  });
}

export function subscribeToSleepTimer(callback: SleepTimerSubscriber): () => void {
  sleepTimerSubscribers.push(callback);
  callback(getSleepTimerRemaining(), getSleepTimerState());
  return () => {
    sleepTimerSubscribers = sleepTimerSubscribers.filter((cb) => cb !== callback);
  };
}

export function resetSleepPaused() {
  isSleepPaused = false;
  notifySleepTimerSubscribers();
}

export async function initSleepTimer(): Promise<void> {
  try {
    const storedTarget = await AsyncStorage.getItem(SLEEP_TIMER_STORAGE_KEY);
    const storedMode = (await AsyncStorage.getItem(SLEEP_TIMER_MODE_KEY)) as SleepTimerMode | null;

    if (storedMode === 'end_of_track') {
      currentMode = 'end_of_track';
      sleepTimerTarget = null;
      startFallbackWatcher();
      notifySleepTimerSubscribers();
      return;
    }

    if (storedTarget) {
      const target = parseInt(storedTarget, 10);
      if (!isNaN(target) && target > Date.now()) {
        sleepTimerTarget = target;
        currentMode = storedMode || determineModeFromMinutes(Math.round((target - Date.now()) / 60000));
        startFallbackWatcher();
        notifySleepTimerSubscribers();
      } else {
        // Expired while app was closed or suspended
        await AsyncStorage.removeItem(SLEEP_TIMER_STORAGE_KEY);
        await AsyncStorage.removeItem(SLEEP_TIMER_MODE_KEY);
        sleepTimerTarget = null;
        currentMode = 'off';
        stopFallbackWatcher();
        notifySleepTimerSubscribers();
      }
    } else {
      sleepTimerTarget = null;
      currentMode = 'off';
      stopFallbackWatcher();
    }
  } catch (e) {
    console.warn('[SleepTimer] Init error:', e);
  }
}

async function setSleepTimerByMinutes(minutes: number, specificMode?: SleepTimerMode): Promise<void> {
  const validMinutes = Math.max(1, Math.min(720, Math.round(minutes)));
  const target = Date.now() + validMinutes * 60 * 1000;
  sleepTimerTarget = target;
  currentMode = specificMode || determineModeFromMinutes(validMinutes);

  await AsyncStorage.setItem(SLEEP_TIMER_STORAGE_KEY, target.toString());
  await AsyncStorage.setItem(SLEEP_TIMER_MODE_KEY, currentMode);
  startFallbackWatcher();
  notifySleepTimerSubscribers();
}

export async function setSleepTimer(minutesOrMode: number | SleepTimerMode): Promise<void> {
  isSleepPaused = false;

  if (typeof minutesOrMode === 'string') {
    if (minutesOrMode === 'off') {
      await clearSleepTimer();
      return;
    }
    if (minutesOrMode === 'end_of_track') {
      currentMode = 'end_of_track';
      sleepTimerTarget = null;
      await AsyncStorage.removeItem(SLEEP_TIMER_STORAGE_KEY);
      await AsyncStorage.setItem(SLEEP_TIMER_MODE_KEY, 'end_of_track');
      startFallbackWatcher();
      notifySleepTimerSubscribers();
      return;
    }
    const match = minutesOrMode.match(/^(\d+)m$/);
    if (match) {
      const mins = parseInt(match[1], 10);
      return setSleepTimerByMinutes(mins, minutesOrMode as SleepTimerMode);
    }
  } else if (typeof minutesOrMode === 'number') {
    if (minutesOrMode <= 0) {
      await clearSleepTimer();
      return;
    }
    return setSleepTimerByMinutes(minutesOrMode);
  }
}

export async function setCustomSleepTimer(minutes: number): Promise<void> {
  const validMinutes = Math.max(1, Math.min(720, Math.round(minutes)));
  await setSleepTimerByMinutes(validMinutes, 'custom');
}

export async function clearSleepTimer(): Promise<void> {
  sleepTimerTarget = null;
  currentMode = 'off';
  stopFallbackWatcher();
  await AsyncStorage.removeItem(SLEEP_TIMER_STORAGE_KEY);
  await AsyncStorage.removeItem(SLEEP_TIMER_MODE_KEY);
  notifySleepTimerSubscribers();
}

export const cancelSleepTimer = clearSleepTimer;

export async function checkSleepTimerExpiration(): Promise<boolean> {
  if (currentMode === 'end_of_track') return false;
  if (!sleepTimerTarget) return false;

  if (Date.now() >= sleepTimerTarget) {
    console.log('[SleepTimer] Target timestamp reached -> Disarming & pausing playback');
    // Crucial: Disarm state BEFORE pausing to prevent infinite pause loop when user hits Play later
    sleepTimerTarget = null;
    currentMode = 'off';
    isSleepPaused = true;
    stopFallbackWatcher();
    await AsyncStorage.removeItem(SLEEP_TIMER_STORAGE_KEY);
    await AsyncStorage.removeItem(SLEEP_TIMER_MODE_KEY);
    notifySleepTimerSubscribers();

    try {
      await TrackPlayer.pause();
    } catch (err) {
      console.error('[SleepTimer] Error pausing TrackPlayer on expiration:', err);
    }
    return true;
  }
  return false;
}

export async function handleTrackEndedForSleepTimer(): Promise<boolean> {
  if (currentMode === 'end_of_track') {
    console.log('[SleepTimer] Track ended in end_of_track mode -> Disarming & pausing playback');
    await clearSleepTimer();
    isSleepPaused = true;
    try {
      await TrackPlayer.pause();
    } catch (err) {
      console.error('[SleepTimer] Error pausing TrackPlayer on end_of_track:', err);
    }
    notifySleepTimerSubscribers();
    return true;
  }

  if (isSleepPaused) {
    return true;
  }

  return false;
}
