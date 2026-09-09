import { NativeModules } from 'react-native';
import { storage } from '../utils/storage';

const { AudioEffectsModule } = NativeModules;
const BOOST_STORAGE_KEY = '@sukoon_sound_boost_gain';

/**
 * Sets sound boost percent above normal volume.
 * Range: 0 to 100 (% of boost above normal volume).
 * 0% = 100% standard volume, 100% = maximum amplification (~200% total volume).
 */
export async function setSoundBoostPercent(percent: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  storage.set(BOOST_STORAGE_KEY, clamped);

  // Convert 0..100% boost to 0..2000 millibels (+20dB total amplification)
  const gainMB = Math.round((clamped / 100) * 2000);

  if (AudioEffectsModule?.setBoostGain) {
    try {
      await AudioEffectsModule.setBoostGain(gainMB);
    } catch (err) {
      console.warn('[SoundBoost] Failed to set boost gain:', err);
    }
  }
}

export function getSoundBoostPercent(): number {
  const val = storage.getNumber(BOOST_STORAGE_KEY);
  if (typeof val === 'number' && !isNaN(val)) {
    return Math.max(0, Math.min(100, Math.round(val)));
  }
  return 0;
}

export async function syncSoundBoostSession(): Promise<void> {
  if (!AudioEffectsModule?.attachSession) return;
  try {
    await AudioEffectsModule.attachSession();
    const savedPercent = getSoundBoostPercent();
    const gainMB = Math.round((savedPercent / 100) * 2000);
    await AudioEffectsModule.setBoostGain(gainMB);
  } catch (err) {
    console.warn('[SoundBoost] Session sync error:', err);
  }
}
