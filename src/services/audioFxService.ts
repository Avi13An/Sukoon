import { NativeModules, Platform } from 'react-native';
import { storage } from '../utils/storage';

const { AudioEffectsModule } = NativeModules;

export interface EqBand {
  index: number;
  centerFreq: number; // Hz (e.g. 60, 230, 910, 3600, 14000)
  currentLevel: number; // Millibels (-1500 to +1500)
}

export interface EqPreset {
  name: string;
  levels: number[]; // 5 band levels in millibels
  bass: number; // 0 to 1000
}

export const DEFAULT_FREQUENCIES = [60, 230, 910, 3600, 14000];

export const EQ_PRESETS: EqPreset[] = [
  { name: 'Flat', levels: [0, 0, 0, 0, 0], bass: 0 },
  { name: 'Bass Heavy (Skull Shaker)', levels: [1200, 800, 0, -200, -400], bass: 850 },
  { name: 'Vocal Clarity', levels: [-400, 200, 1000, 800, 300], bass: 100 },
  { name: 'Electronic / Dance', levels: [1000, 500, -200, 600, 1100], bass: 700 },
  { name: 'Rock / Punchy', levels: [800, 400, -300, 500, 900], bass: 500 },
  { name: 'Acoustic / Warm', levels: [400, 300, 500, 400, 200], bass: 250 },
];

const KEYS = {
  BANDS: '@sukoon_eq_bands',
  BASS: '@sukoon_bass_strength',
  PRESET: '@sukoon_eq_preset',
  ENABLED: '@sukoon_eq_enabled',
};

export function getSavedBandLevels(): number[] {
  try {
    const raw = storage.getString(KEYS.BANDS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length >= 5) {
        return parsed.slice(0, 5);
      }
    }
  } catch {}
  return [0, 0, 0, 0, 0];
}

export function getSavedBassStrength(): number {
  try {
    const val = storage.getNumber(KEYS.BASS);
    if (typeof val === 'number' && !isNaN(val)) {
      return Math.max(0, Math.min(1000, val));
    }
  } catch {}
  return 0;
}

export function getSavedPresetName(): string {
  try {
    const name = storage.getString(KEYS.PRESET);
    if (name) return name;
  } catch {}
  return 'Flat';
}

export function getSavedEqEnabled(): boolean {
  try {
    const val = storage.getBoolean(KEYS.ENABLED);
    if (typeof val === 'boolean') return val;
  } catch {}
  return true;
}

export function saveCurrentBandState(bandIndex: number, millibels: number) {
  try {
    const levels = getSavedBandLevels();
    levels[bandIndex] = millibels;
    storage.set(KEYS.BANDS, JSON.stringify(levels));
    storage.set(KEYS.PRESET, 'Custom');
  } catch (e) {
    console.warn('[AudioFX] Failed to save band state:', e);
  }
}

export async function restoreSavedEqProfile() {
  if (!AudioEffectsModule) return;
  try {
    const isEnabled = getSavedEqEnabled();
    const levels = getSavedBandLevels();
    const bass = getSavedBassStrength();

    await AudioEffectsModule.setEnabled(isEnabled);
    for (let i = 0; i < levels.length; i++) {
      await AudioEffectsModule.setBandLevel(i, levels[i]);
    }
    await AudioEffectsModule.setBassBoost(bass);
  } catch (err) {
    console.warn('[AudioFX] Failed to restore saved EQ profile:', err);
  }
}

export async function syncAudioSession(sessionId?: number) {
  if (!AudioEffectsModule) return null;
  try {
    // If session not passed, retrieve it or use default ExoPlayer session
    const targetSession = sessionId || 1; // Native will attach or bind active track session
    const details = await AudioEffectsModule.attachSession(targetSession);
    // Re-apply saved user profile from MMKV
    await restoreSavedEqProfile();
    return details;
  } catch (err) {
    console.warn('[AudioFX] Failed to attach audio session:', err);
    return null;
  }
}

export async function applyBandLevel(bandIndex: number, millibels: number) {
  if (!AudioEffectsModule) return;
  const clamped = Math.max(-1500, Math.min(1500, Math.round(millibels)));
  try {
    await AudioEffectsModule.setBandLevel(bandIndex, clamped);
    saveCurrentBandState(bandIndex, clamped);
  } catch (err) {
    console.warn('[AudioFX] Failed to set band level:', err);
  }
}

export async function applyBassBoost(strength: number) {
  if (!AudioEffectsModule) return;
  const clamped = Math.max(0, Math.min(1000, Math.round(strength)));
  try {
    await AudioEffectsModule.setBassBoost(clamped);
    storage.set(KEYS.BASS, clamped);
  } catch (err) {
    console.warn('[AudioFX] Failed to set bass boost:', err);
  }
}

export async function applyPreset(preset: EqPreset) {
  if (!AudioEffectsModule) return;
  try {
    for (let i = 0; i < preset.levels.length; i++) {
      await AudioEffectsModule.setBandLevel(i, preset.levels[i]);
    }
    await AudioEffectsModule.setBassBoost(preset.bass);

    storage.set(KEYS.BANDS, JSON.stringify(preset.levels));
    storage.set(KEYS.BASS, preset.bass);
    storage.set(KEYS.PRESET, preset.name);
  } catch (err) {
    console.warn('[AudioFX] Failed to apply preset:', err);
  }
}

export async function setEqEnabled(enabled: boolean) {
  if (!AudioEffectsModule) return;
  try {
    await AudioEffectsModule.setEnabled(enabled);
    storage.set(KEYS.ENABLED, enabled);
  } catch (err) {
    console.warn('[AudioFX] Failed to toggle EQ:', err);
  }
}

export async function openSystemDolbyPanel(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!AudioEffectsModule) return false;
  try {
    const res = await AudioEffectsModule.openSystemEqualizer();
    return Boolean(res);
  } catch (e) {
    console.warn('[AudioFX] openSystemEqualizer failed:', e);
    return false;
  }
}
