import { NativeModules, Platform, Alert, Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { storage } from '../utils/storage';
import { applySoundBoost } from './TrackPlayerService';

const { AudioEffectsModule } = NativeModules;

export type EqualizerPresetName = 
  | 'Flat' 
  | 'Bass Heavy (Skull Shaker)' 
  | 'Vocal & Acoustic' 
  | 'Club / Electronic' 
  | 'Pop' 
  | 'Rock' 
  | 'Custom';

export interface AudioFxSettings {
  enabled: boolean;
  bassBoost: number; // 0 to 1000 (0 to 100%)
  virtualizer: number; // 0 to 1000 (0 to 100%)
  soundBoost: number; // 0 to 100
  preset: EqualizerPresetName;
  bands: { [freq: string]: number }; // -15dB to +15dB
}

export const BAND_FREQUENCIES = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'];

export const FX_PRESETS: Record<EqualizerPresetName, { bassBoost: number; virtualizer: number; bands: { [freq: string]: number } }> = {
  'Flat': {
    bassBoost: 0,
    virtualizer: 0,
    bands: { '60Hz': 0, '230Hz': 0, '910Hz': 0, '3.6kHz': 0, '14kHz': 0 },
  },
  'Bass Heavy (Skull Shaker)': {
    bassBoost: 950,
    virtualizer: 350,
    bands: { '60Hz': 12, '230Hz': 8, '910Hz': 0, '3.6kHz': 2, '14kHz': 3 },
  },
  'Vocal & Acoustic': {
    bassBoost: 200,
    virtualizer: 150,
    bands: { '60Hz': -3, '230Hz': 1, '910Hz': 10, '3.6kHz': 6, '14kHz': 6 },
  },
  'Club / Electronic': {
    bassBoost: 850,
    virtualizer: 600,
    bands: { '60Hz': 9, '230Hz': 5, '910Hz': -2, '3.6kHz': 6, '14kHz': 11 },
  },
  'Pop': {
    bassBoost: 400,
    virtualizer: 200,
    bands: { '60Hz': 4, '230Hz': 6, '910Hz': 2, '3.6kHz': 5, '14kHz': 6 },
  },
  'Rock': {
    bassBoost: 600,
    virtualizer: 300,
    bands: { '60Hz': 7, '230Hz': 4, '910Hz': -3, '3.6kHz': 4, '14kHz': 8 },
  },
  'Custom': {
    bassBoost: 0,
    virtualizer: 0,
    bands: { '60Hz': 0, '230Hz': 0, '910Hz': 0, '3.6kHz': 0, '14kHz': 0 },
  },
};

const STORAGE_KEY = '@sukoon_audio_fx_settings';

export const DEFAULT_AUDIO_FX: AudioFxSettings = {
  enabled: true,
  bassBoost: 0,
  virtualizer: 0,
  soundBoost: 0,
  preset: 'Flat',
  bands: { '60Hz': 0, '230Hz': 0, '910Hz': 0, '3.6kHz': 0, '14kHz': 0 },
};

export function getAudioFxSettings(): AudioFxSettings {
  try {
    const raw = storage.getString(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_AUDIO_FX,
        ...parsed,
        bands: { ...DEFAULT_AUDIO_FX.bands, ...(parsed.bands || {}) },
      };
    }
  } catch {}
  return { ...DEFAULT_AUDIO_FX, bands: { ...DEFAULT_AUDIO_FX.bands } };
}

export function saveAudioFxSettings(settings: AudioFxSettings): void {
  try {
    storage.set(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('[AudioEffectsService] Failed to persist settings:', e);
  }
}

export async function setBassBoostStrength(strength: number) {
  const clamped = Math.max(0, Math.min(1000, Math.round(strength)));
  const current = getAudioFxSettings();
  current.bassBoost = clamped;
  saveAudioFxSettings(current);

  if (AudioEffectsModule?.setBassBoostStrength) {
    try {
      await AudioEffectsModule.setBassBoostStrength(current.enabled ? clamped : 0);
    } catch (err) {
      console.warn('[AudioEffectsModule] Native setBassBoostStrength failed:', err);
    }
  }
  return current;
}

export async function setBandLevel(bandIndex: number, levelMilliBels: number) {
  const clamped = Math.max(-1500, Math.min(1500, Math.round(levelMilliBels)));
  const current = getAudioFxSettings();
  const freq = BAND_FREQUENCIES[bandIndex] || BAND_FREQUENCIES[0];
  current.bands[freq] = Math.round(clamped / 100);
  current.preset = 'Custom';
  saveAudioFxSettings(current);

  if (AudioEffectsModule?.setBandLevel) {
    try {
      await AudioEffectsModule.setBandLevel(bandIndex, current.enabled ? clamped : 0);
    } catch (err) {
      console.warn('[AudioEffectsModule] Native setBandLevel failed:', err);
    }
  }
  return current;
}

export async function setVirtualizerStrength(strength: number) {
  const clamped = Math.max(0, Math.min(1000, Math.round(strength)));
  const current = getAudioFxSettings();
  current.virtualizer = clamped;
  saveAudioFxSettings(current);

  if (AudioEffectsModule?.setVirtualizerStrength) {
    try {
      await AudioEffectsModule.setVirtualizerStrength(current.enabled ? clamped : 0);
    } catch (err) {
      console.warn('[AudioEffectsModule] Native setVirtualizerStrength failed:', err);
    }
  }
  return current;
}

export async function applyPreset(presetName: EqualizerPresetName) {
  const current = getAudioFxSettings();
  current.preset = presetName;

  if (presetName !== 'Custom') {
    const config = FX_PRESETS[presetName];
    if (config) {
      current.bassBoost = config.bassBoost;
      current.virtualizer = config.virtualizer;
      current.bands = { ...config.bands };
    }
  }

  saveAudioFxSettings(current);

  if (current.enabled) {
    await applyAllSettings(current);
  }
  return current;
}

export async function toggleAudioFx(enabled: boolean) {
  const current = getAudioFxSettings();
  current.enabled = enabled;
  saveAudioFxSettings(current);

  if (enabled) {
    await applyAllSettings(current);
  } else {
    if (AudioEffectsModule) {
      try {
        await AudioEffectsModule.setBassBoostStrength(0);
        await AudioEffectsModule.setVirtualizerStrength(0);
        for (let i = 0; i < BAND_FREQUENCIES.length; i++) {
          await AudioEffectsModule.setBandLevel(i, 0);
        }
      } catch {}
    }
    await applySoundBoost(0);
  }
  return current;
}

export async function setSoundBoost(gainPercent: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(gainPercent)));
  const current = getAudioFxSettings();
  current.soundBoost = clamped;
  saveAudioFxSettings(current);

  if (current.enabled) {
    await applySoundBoost(clamped);
  }
  return current;
}

export async function applyAllSettings(settings: AudioFxSettings) {
  if (AudioEffectsModule) {
    try {
      await AudioEffectsModule.setBassBoostStrength(settings.bassBoost);
      await AudioEffectsModule.setVirtualizerStrength(settings.virtualizer);
      BAND_FREQUENCIES.forEach(async (freq, idx) => {
        const db = settings.bands[freq] ?? 0;
        await AudioEffectsModule.setBandLevel(idx, db * 100);
      });
    } catch (err) {
      console.warn('[AudioEffectsModule] applyAllSettings failed:', err);
    }
  }
  if (typeof settings.soundBoost === 'number') {
    await applySoundBoost(settings.soundBoost);
  }
}

export async function openSystemEqualizer() {
  if (Platform.OS !== 'android') {
    Alert.alert(
      'System Equalizer',
      'System-level audio effects panels (Dolby Atmos/SoundAlive) are Android specific. Sukoon hardware effects apply directly to playback.'
    );
    return;
  }

  if (AudioEffectsModule?.openSystemEqualizer) {
    try {
      await AudioEffectsModule.openSystemEqualizer();
      return;
    } catch {}
  }

  try {
    await IntentLauncher.startActivityAsync('android.media.action.DISPLAY_AUDIO_EFFECT_CONTROL_PANEL', {
      extra: { 'android.media.extra.CONTENT_TYPE': 0 }
    });
  } catch (err) {
    try {
      await IntentLauncher.startActivityAsync('android.settings.SOUND_SETTINGS');
    } catch (soundErr) {
      try {
        await Linking.openSettings();
      } catch (fallbackErr) {
        Alert.alert(
          'System Equalizer',
          'Open Phone Settings > Sound & Vibration > Sound Effects / Dolby Atmos to configure hardware audio frequencies.'
        );
      }
    }
  }
}
