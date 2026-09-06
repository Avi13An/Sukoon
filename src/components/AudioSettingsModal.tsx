import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions, 
  PanResponder, 
  ScrollView, 
  Switch,
  Platform 
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer from '@rntp/player';
import { 
  EqualizerSettings, 
  EqualizerPresetName, 
  getEqualizerSettings 
} from '../utils/storage';
import { 
  EQ_PRESETS, 
  setEqualizerPreset, 
  updateEqualizerBand, 
  updateBassBoost, 
  updateSoundBoost, 
  toggleEqualizer, 
  openSystemEqualizer 
} from '../services/audioEnhancerService';

const { height, width } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
}

const BAND_FREQUENCIES = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'];
const BAND_HEIGHT = 120;

export function AudioSettingsModal({ visible, onClose }: Props) {
  const [settings, setSettings] = useState<EqualizerSettings>(getEqualizerSettings());
  const translateY = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      setSettings(getEqualizerSettings());
      translateY.value = withSpring(0, { damping: 18, stiffness: 100 });
    } else {
      translateY.value = withTiming(height, { duration: 250 });
    }
  }, [visible]);

  const handleToggle = async (val: boolean) => {
    const updated = await toggleEqualizer(val);
    setSettings({ ...updated });
  };

  const handlePresetSelect = async (preset: EqualizerPresetName) => {
    const updated = await setEqualizerPreset(preset);
    setSettings({ ...updated });
  };

  const handleBandChange = async (freq: string, val: number) => {
    const updated = await updateEqualizerBand(freq, val);
    setSettings({ ...updated });
  };

  const handleBassBoostChange = async (val: number) => {
    const updated = await updateBassBoost(val);
    setSettings({ ...updated });
  };

  const handleSoundBoostChange = async (val: number) => {
    const updated = await updateSoundBoost(val);
    setSettings({ ...updated });
    if (updated.enabled && typeof TrackPlayer.setVolume === 'function') {
      const clamped = Math.max(0, Math.min(100, val));
      const gainMultiplier = 1.0 + (clamped / 100) * 0.2;
      try {
        await TrackPlayer.setVolume(Math.min(1.2, gainMultiplier));
      } catch {}
    }
  };

  // PanResponder for Bass Boost Slider
  const bassSliderWidth = useRef(width - 64);
  const bassPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const percent = Math.round(Math.max(0, Math.min(100, (x / (bassSliderWidth.current || 1)) * 100)));
        handleBassBoostChange(percent);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const percent = Math.round(Math.max(0, Math.min(100, (x / (bassSliderWidth.current || 1)) * 100)));
        handleBassBoostChange(percent);
      },
    })
  ).current;

  // PanResponder for Sound Boost Slider
  const soundSliderWidth = useRef(width - 64);
  const soundPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const percent = Math.round(Math.max(0, Math.min(100, (x / (soundSliderWidth.current || 1)) * 100)));
        handleSoundBoostChange(percent);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const percent = Math.round(Math.max(0, Math.min(100, (x / (soundSliderWidth.current || 1)) * 100)));
        handleSoundBoostChange(percent);
      },
    })
  ).current;

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  if (!visible && translateY.value === height) return null;

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.modal, animatedStyle]}>
        
        <View style={styles.handle} />
        
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Audio Equalizer</Text>
            <Text style={styles.subtitle}>DSP Acoustic Engine & Headroom Boost</Text>
          </View>
          <View style={styles.headerControls}>
            <Switch 
              value={settings.enabled} 
              onValueChange={handleToggle}
              trackColor={{ false: '#333333', true: '#00cc99' }}
              thumbColor={settings.enabled ? '#00ffcc' : '#888888'}
            />
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* Preset Selector Chips */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Presets</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetScroll}>
              {EQ_PRESETS.map((preset) => {
                const isActive = settings.preset === preset;
                return (
                  <TouchableOpacity 
                    key={preset} 
                    style={[styles.presetChip, isActive && styles.presetChipActive]}
                    onPress={() => handlePresetSelect(preset)}
                    disabled={!settings.enabled}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.presetChipText, isActive && styles.presetChipTextActive]}>
                      {preset}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* 5-Band Graphic Equalizer */}
          <View style={[styles.section, !settings.enabled && styles.disabledSection]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Graphic Equalizer (dB)</Text>
              <Text style={styles.rangeLabel}>-10dB to +10dB</Text>
            </View>

            <View style={styles.bandsContainer}>
              {BAND_FREQUENCIES.map((freq) => {
                const dbValue = settings.bands[freq] ?? 0;
                // Ratio from bottom: (-10dB = 0, 0dB = 0.5, +10dB = 1.0)
                const ratio = (dbValue + 10) / 20;
                const fillHeight = Math.max(4, ratio * BAND_HEIGHT);

                return (
                  <View key={freq} style={styles.bandColumn}>
                    <Text style={styles.bandDbText}>
                      {dbValue > 0 ? `+${dbValue}` : `${dbValue}`}
                    </Text>
                    
                    <View 
                      style={styles.bandTrackContainer}
                      onTouchStart={(e) => {
                        if (!settings.enabled) return;
                        const touchY = e.nativeEvent.locationY;
                        const r = Math.max(0, Math.min(1, (BAND_HEIGHT - touchY) / BAND_HEIGHT));
                        const val = Math.round(-10 + r * 20);
                        handleBandChange(freq, val);
                      }}
                      onTouchMove={(e) => {
                        if (!settings.enabled) return;
                        const touchY = e.nativeEvent.locationY;
                        const r = Math.max(0, Math.min(1, (BAND_HEIGHT - touchY) / BAND_HEIGHT));
                        const val = Math.round(-10 + r * 20);
                        handleBandChange(freq, val);
                      }}
                    >
                      {/* Zero dB midline marker */}
                      <View style={styles.zeroLine} />
                      <View style={styles.bandTrack} />
                      <View style={[styles.bandFill, { height: fillHeight }]} />
                      <View style={[styles.bandThumb, { bottom: fillHeight - 8 }]} />
                    </View>

                    <Text style={styles.bandFreqText}>{freq}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Bass Boost Slider */}
          <View style={[styles.section, !settings.enabled && styles.disabledSection]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Bass Boost</Text>
              <Text style={styles.accentValue}>{settings.bassBoost}%</Text>
            </View>
            
            <View 
              style={styles.horizontalSliderContainer} 
              onLayout={(e) => { bassSliderWidth.current = e.nativeEvent.layout.width; }}
              {...(settings.enabled ? bassPanResponder.panHandlers : {})}
            >
              <View style={styles.horizontalSliderTrack} />
              <View style={[styles.horizontalSliderFill, { width: `${settings.bassBoost}%` }]} />
              <View style={[styles.horizontalSliderThumb, { left: `${settings.bassBoost}%` }]} />
            </View>
          </View>

          {/* Sound Boost (Headroom Gain) */}
          <View style={[styles.section, !settings.enabled && styles.disabledSection]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Sound Boost (Headroom Amplification)</Text>
              <Text style={styles.accentValue}>+{Math.round(settings.soundBoost * 0.2)}% Gain</Text>
            </View>
            
            <View 
              style={styles.horizontalSliderContainer} 
              onLayout={(e) => { soundSliderWidth.current = e.nativeEvent.layout.width; }}
              {...(settings.enabled ? soundPanResponder.panHandlers : {})}
            >
              <View style={styles.horizontalSliderTrack} />
              <View style={[styles.horizontalSliderFill, { width: `${settings.soundBoost}%` }]} />
              <View style={[styles.horizontalSliderThumb, { left: `${settings.soundBoost}%` }]} />
            </View>
            <Text style={styles.disclaimerText}>
              Amplifies digital headroom. Keeps audio crisp without distortion.
            </Text>
          </View>

          {/* Android Hardware Equalizer Bridge */}
          <TouchableOpacity 
            style={styles.systemEqBtn} 
            onPress={openSystemEqualizer}
            activeOpacity={0.8}
          >
            <Ionicons name="hardware-chip-outline" size={20} color="#00ffcc" />
            <Text style={styles.systemEqBtnText}>🎛️ Launch Hardware Equalizer (Dolby / System FX)</Text>
          </TouchableOpacity>

          <View style={styles.bottomSpacer} />
        </ScrollView>

      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 9999,
  },
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  modal: {
    backgroundColor: '#141416',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: height * 0.85,
    borderTopWidth: 1,
    borderColor: '#26262a',
  },
  handle: {
    width: 44,
    height: 5,
    backgroundColor: '#333338',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#888888',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  disabledSection: {
    opacity: 0.35,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  rangeLabel: {
    color: '#777777',
    fontSize: 12,
  },
  accentValue: {
    color: '#00ffcc',
    fontSize: 14,
    fontWeight: 'bold',
  },
  presetScroll: {
    paddingVertical: 4,
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#1f1f24',
    borderWidth: 1,
    borderColor: '#2f2f36',
  },
  presetChipActive: {
    backgroundColor: '#00ffcc',
    borderColor: '#00ffcc',
  },
  presetChipText: {
    color: '#aaaaaa',
    fontSize: 13,
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#000000',
    fontWeight: 'bold',
  },
  bandsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#0d0d0f',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#222226',
  },
  bandColumn: {
    alignItems: 'center',
    flex: 1,
  },
  bandDbText: {
    color: '#00ffcc',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
    height: 16,
  },
  bandTrackContainer: {
    width: 32,
    height: BAND_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  zeroLine: {
    position: 'absolute',
    top: BAND_HEIGHT / 2,
    left: 2,
    right: 2,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 1,
  },
  bandTrack: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 6,
    backgroundColor: '#222228',
    borderRadius: 3,
  },
  bandFill: {
    position: 'absolute',
    bottom: 0,
    width: 6,
    backgroundColor: '#00ffcc',
    borderRadius: 3,
  },
  bandThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#00ffcc',
    zIndex: 5,
  },
  bandFreqText: {
    color: '#888888',
    fontSize: 11,
    marginTop: 8,
  },
  horizontalSliderContainer: {
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  horizontalSliderTrack: {
    height: 6,
    backgroundColor: '#222228',
    borderRadius: 3,
    width: '100%',
  },
  horizontalSliderFill: {
    position: 'absolute',
    height: 6,
    backgroundColor: '#00ffcc',
    borderRadius: 3,
    left: 0,
  },
  horizontalSliderThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#00ffcc',
    marginLeft: -9,
  },
  disclaimerText: {
    color: '#666666',
    fontSize: 12,
    marginTop: 4,
  },
  systemEqBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1b1b20',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2e2e36',
    gap: 8,
    marginTop: 8,
  },
  systemEqBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 24,
  },
});

