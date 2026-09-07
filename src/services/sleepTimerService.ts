import TrackPlayer from '@rntp/player';

export type SleepTimerMode = '15m' | '30m' | '45m' | '60m' | 'end_of_track' | 'off';

export interface SleepTimerState {
  isActive: boolean;
  mode: SleepTimerMode;
  timeRemainingSeconds: number;
  isSleepPaused: boolean;
}

let currentMode: SleepTimerMode = 'off';
let remainingSeconds = 0;
let isSleepPaused = false;
let timerInterval: ReturnType<typeof setInterval> | null = null;
const listeners: Array<(state: SleepTimerState) => void> = [];

export function getSleepTimerState(): SleepTimerState {
  return {
    isActive: currentMode !== 'off',
    mode: currentMode,
    timeRemainingSeconds: remainingSeconds,
    isSleepPaused,
  };
}

function notifyListeners() {
  const state = getSleepTimerState();
  listeners.forEach((cb) => {
    try {
      cb(state);
    } catch (e) {
      console.error('[SleepTimerService] Listener error:', e);
    }
  });
}

export function subscribeToSleepTimer(callback: (state: SleepTimerState) => void) {
  listeners.push(callback);
  callback(getSleepTimerState());
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

export function resetSleepPaused() {
  isSleepPaused = false;
  notifyListeners();
}

export function cancelSleepTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  currentMode = 'off';
  remainingSeconds = 0;
  notifyListeners();
}

export function setSleepTimer(mode: SleepTimerMode) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  currentMode = mode;
  isSleepPaused = false;

  if (mode === 'off') {
    remainingSeconds = 0;
    notifyListeners();
    return;
  }

  if (mode === 'end_of_track') {
    remainingSeconds = 0;
    notifyListeners();
    return;
  }

  const durationMap: Record<'15m' | '30m' | '45m' | '60m', number> = {
    '15m': 15 * 60,
    '30m': 30 * 60,
    '45m': 45 * 60,
    '60m': 60 * 60,
  };

  remainingSeconds = durationMap[mode] || 0;
  notifyListeners();

  timerInterval = setInterval(async () => {
    remainingSeconds -= 1;
    if (remainingSeconds <= 0) {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      currentMode = 'off';
      remainingSeconds = 0;
      isSleepPaused = true;
      try {
        await TrackPlayer.pause();
      } catch (err) {
        console.error('[SleepTimerService] Error pausing TrackPlayer:', err);
      }
      notifyListeners();
    } else {
      notifyListeners();
    }
  }, 1000);
}

/**
 * Called when a track naturally finishes playing.
 * Returns true if sleep timer intercepted and stopped playback.
 */
export async function handleTrackEndedForSleepTimer(): Promise<boolean> {
  if (currentMode === 'end_of_track') {
    cancelSleepTimer();
    isSleepPaused = true;
    try {
      await TrackPlayer.pause();
    } catch (err) {
      console.error('[SleepTimerService] Error pausing on end_of_track:', err);
    }
    notifyListeners();
    return true;
  }

  if (isSleepPaused) {
    return true;
  }

  return false;
}
