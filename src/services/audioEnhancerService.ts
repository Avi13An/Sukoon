import { 
  AudioFxSettings, 
  EqualizerPresetName, 
  FX_PRESETS, 
  BAND_FREQUENCIES,
  getAudioFxSettings, 
  saveAudioFxSettings,
  applyPreset,
  setBandLevel,
  setBassBoostStrength,
  setSoundBoost,
  toggleAudioFx,
  openSystemEqualizer as openNativeOrSystemEq
} from './audioEffectsService';

export const EQ_PRESETS: EqualizerPresetName[] = [
  'Flat', 
  'Bass Heavy (Skull Shaker)', 
  'Vocal & Acoustic', 
  'Club / Electronic', 
  'Pop', 
  'Rock', 
  'Custom'
];

export async function setEqualizerPreset(preset: EqualizerPresetName) {
  return applyPreset(preset);
}

export async function updateEqualizerBand(frequency: string, value: number) {
  const index = BAND_FREQUENCIES.indexOf(frequency);
  const bandIndex = index >= 0 ? index : 0;
  return setBandLevel(bandIndex, value * 100);
}

export async function updateBassBoost(value: number) {
  // Value can be 0-100 or 0-1000; scale appropriately if 0-100 is passed
  const scaled = value <= 100 ? value * 10 : value;
  return setBassBoostStrength(scaled);
}

export async function updateSoundBoost(value: number) {
  return setSoundBoost(value);
}

export async function toggleEqualizer(enabled: boolean) {
  return toggleAudioFx(enabled);
}

export async function openSystemEqualizer() {
  return openNativeOrSystemEq();
}
