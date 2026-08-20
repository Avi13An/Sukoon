import TrackPlayer from 'react-native-track-player';

// Simulated Equalizer Presets for the AudioSettings UI
export const EQ_PRESETS = ['Flat', 'Bass Boost', 'Acoustic', 'Vocal Boost'];
let currentEqPreset = 'Flat';
let currentGain = 1.0;

export async function setLoudnessEnhancer(gain: number) {
  currentGain = gain;
  
  // TrackPlayer.setVolume can often push values beyond 1.0 on some native platforms.
  // We use this as our Sound Enhancer proxy mechanism until a true DSP native plugin is implemented.
  try {
    await TrackPlayer.setVolume(gain);
  } catch (e) {
    console.warn('Volume amplification not strictly supported natively:', e);
  }
}

export function getLoudnessGain() {
  return currentGain;
}

export function setEqualizerPreset(preset: string) {
  // Stub for UI purposes. 
  // True DSP requires a custom Expo Config Plugin to hook into Android's AudioEffect and iOS's AVAudioEngine.
  console.log(`[AudioEnhancer] Hardware Equalizer Preset set to: ${preset}`);
  currentEqPreset = preset;
}

export function getEqualizerPreset() {
  return currentEqPreset;
}
