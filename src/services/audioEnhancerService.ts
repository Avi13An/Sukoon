import { Linking, Platform, Alert } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { 
  EqualizerSettings, 
  EqualizerPresetName, 
  EQUALIZER_PRESETS, 
  getEqualizerSettings, 
  saveEqualizerSettings 
} from '../utils/storage';
import { applySoundBoost } from './TrackPlayerService';

export const EQ_PRESETS: EqualizerPresetName[] = [
  'Flat', 
  'Bass Boost', 
  'Vocal', 
  'Pop', 
  'Rock', 
  'Electronic', 
  'Custom'
];

export async function setEqualizerPreset(preset: EqualizerPresetName) {
  const current = getEqualizerSettings();
  if (preset === 'Custom') {
    current.preset = 'Custom';
    saveEqualizerSettings(current);
    return current;
  }

  const presetConfig = EQUALIZER_PRESETS[preset];
  if (presetConfig) {
    current.preset = preset;
    current.bassBoost = presetConfig.bassBoost;
    current.bands = { ...presetConfig.bands };
    saveEqualizerSettings(current);
  }
  return current;
}

export async function updateEqualizerBand(frequency: string, value: number) {
  const current = getEqualizerSettings();
  current.preset = 'Custom';
  current.bands[frequency] = Math.max(-10, Math.min(10, value));
  saveEqualizerSettings(current);
  return current;
}

export async function updateBassBoost(value: number) {
  const current = getEqualizerSettings();
  current.bassBoost = Math.max(0, Math.min(100, value));
  saveEqualizerSettings(current);
  return current;
}

export async function updateSoundBoost(value: number) {
  const current = getEqualizerSettings();
  current.soundBoost = Math.max(0, Math.min(100, value));
  saveEqualizerSettings(current);
  if (current.enabled) {
    await applySoundBoost(current.soundBoost);
  }
  return current;
}

export async function toggleEqualizer(enabled: boolean) {
  const current = getEqualizerSettings();
  current.enabled = enabled;
  saveEqualizerSettings(current);
  if (enabled) {
    await applySoundBoost(current.soundBoost);
  } else {
    await applySoundBoost(0);
  }
  return current;
}

export async function openSystemEqualizer() {
  if (Platform.OS !== 'android') {
    Alert.alert(
      'System Equalizer',
      'System-level equalizer panels are exclusive to Android (Dolby Atmos/SoundAlive). Sukoon DSP equalizer applies directly to playback on iOS.'
    );
    return;
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
