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
import { 
  AudioFxSettings, 
  EqualizerPresetName, 
  BAND_FREQUENCIES, 
  getAudioFxSettings,
  setBassBoostStrength,
  setBandLevel,
  setVirtualizerStrength,
  setSoundBoost,
  applyPreset,
  toggleAudioFx,
  openSystemEqualizer
} from '../services/audioEffectsService';

const { height, width } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
}

const BAND_HEIGHT = 130;
const PRESET_LIST: EqualizerPresetName[] = [
  'Flat', 
  'Bass Heavy (Skull Shaker)', 
  'Vocal & Acoustic', 
  'Club / Electronic', 
  'Pop', 
  'Rock'
];

export function AudioSettingsModal({ visible, onClose }: Props) {
  const [settings, setSettings] = useState<AudioFxSettings>(getAudioFxSettings());
  const translateY = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      setSettings(getAudioFxSettings());
      translateY.value = withSpring(0, { damping: 18, stiffness: 100 });
    } else {
      translateY.value = withTiming(height, { duration: 250 });
    }
  }, [visible]);

  const handleToggle = async (val: boolean) => {
    const updated = await toggleAudioFx(val);
    setSettings({ ...updated });
  };

  const handlePresetSelect = async (preset: EqualizerPresetName) => {
    const updated = await applyPreset(preset);
    setSettings({ ...updated });
  };

  // ==========================================
  // Horizontal Sliders (Bass Boost, Sound Boost, Virtualizer)
  // ==========================================
  
  // Bass Boost (0 - 1000)
  const bassTrackRef = useRef<View>(null);
  const bassPageXRef = useRef(0);
  const bassWidthRef = useRef(width - 64);
  const updateBassLayout = () => {
    bassTrackRef.current?.measure((x, y, w, h, pageX) => {
      if (w > 0) bassWidthRef.current = w;
      if (typeof pageX === 'number') bassPageXRef.current = pageX;
    });
  };

  const bassPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        updateBassLayout();
        const w = bassWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.x0 - bassPageXRef.current));
        const strength = Math.round((touchX / w) * 1000);
        setSettings(prev => ({ ...prev, bassBoost: strength, preset: 'Custom' }));
      },
      onPanResponderMove: (evt, gestureState) => {
        const w = bassWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.moveX - bassPageXRef.current));
        const strength = Math.round((touchX / w) * 1000);
        setSettings(prev => ({ ...prev, bassBoost: strength, preset: 'Custom' }));
      },
      onPanResponderRelease: async (evt, gestureState) => {
        const w = bassWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.moveX - bassPageXRef.current));
        const strength = Math.round((touchX / w) * 1000);
        const updated = await setBassBoostStrength(strength);
        setSettings({ ...updated });
      },
    })
  ).current;

  // Sound Boost (0 - 100)
  const soundTrackRef = useRef<View>(null);
  const soundPageXRef = useRef(0);
  const soundWidthRef = useRef(width - 64);
  const updateSoundLayout = () => {
    soundTrackRef.current?.measure((x, y, w, h, pageX) => {
      if (w > 0) soundWidthRef.current = w;
      if (typeof pageX === 'number') soundPageXRef.current = pageX;
    });
  };

  const soundPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        updateSoundLayout();
        const w = soundWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.x0 - soundPageXRef.current));
        const pct = Math.round((touchX / w) * 100);
        setSettings(prev => ({ ...prev, soundBoost: pct }));
      },
      onPanResponderMove: (evt, gestureState) => {
        const w = soundWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.moveX - soundPageXRef.current));
        const pct = Math.round((touchX / w) * 100);
        setSettings(prev => ({ ...prev, soundBoost: pct }));
      },
      onPanResponderRelease: async (evt, gestureState) => {
        const w = soundWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.moveX - soundPageXRef.current));
        const pct = Math.round((touchX / w) * 100);
        const updated = await setSoundBoost(pct);
        setSettings({ ...updated });
      },
    })
  ).current;

  // 3D Virtualizer (0 - 1000)
  const virtTrackRef = useRef<View>(null);
  const virtPageXRef = useRef(0);
  const virtWidthRef = useRef(width - 64);
  const updateVirtLayout = () => {
    virtTrackRef.current?.measure((x, y, w, h, pageX) => {
      if (w > 0) virtWidthRef.current = w;
      if (typeof pageX === 'number') virtPageXRef.current = pageX;
    });
  };

  const virtPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        updateVirtLayout();
        const w = virtWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.x0 - virtPageXRef.current));
        const strength = Math.round((touchX / w) * 1000);
        setSettings(prev => ({ ...prev, virtualizer: strength, preset: 'Custom' }));
      },
      onPanResponderMove: (evt, gestureState) => {
        const w = virtWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.moveX - virtPageXRef.current));
        const strength = Math.round((touchX / w) * 1000);
        setSettings(prev => ({ ...prev, virtualizer: strength, preset: 'Custom' }));
      },
      onPanResponderRelease: async (evt, gestureState) => {
        const w = virtWidthRef.current || 1;
        const touchX = Math.max(0, Math.min(w, gestureState.moveX - virtPageXRef.current));
        const strength = Math.round((touchX / w) * 1000);
        const updated = await setVirtualizerStrength(strength);
        setSettings({ ...updated });
      },
    })
  ).current;

  // ==========================================
  // Vertical Band Sliders (-15dB to +15dB)
  // ==========================================
  const bandTrackRefs = useRef<Array<View | null>>([]);
  const bandPageYRefs = useRef<number[]>([]);
  const bandHeightRefs = useRef<number[]>([]);

  const updateBandLayout = (index: number) => {
    bandTrackRefs.current[index]?.measure((x, y, w, h, pageY) => {
      bandHeightRefs.current[index] = h > 0 ? h : BAND_HEIGHT;
      if (typeof pageY === 'number') bandPageYRefs.current[index] = pageY;
    });
  };

  const createBandPanResponder = (freq: string, index: number) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => settings.enabled,
      onMoveShouldSetPanResponder: () => settings.enabled,
      onPanResponderGrant: (evt, gestureState) => {
        updateBandLayout(index);
        const h = bandHeightRefs.current[index] || BAND_HEIGHT;
        const pageY = bandPageYRefs.current[index] || 0;
        const touchY = Math.max(0, Math.min(h, gestureState.y0 - pageY));
        const ratio = 1 - (touchY / h); // 0 at bottom, 1 at top
        const db = Math.round(-15 + ratio * 30);
        setSettings(prev => ({
          ...prev,
          preset: 'Custom',
          bands: { ...prev.bands, [freq]: db }
        }));
      },
      onPanResponderMove: (evt, gestureState) => {
        const h = bandHeightRefs.current[index] || BAND_HEIGHT;
        const pageY = bandPageYRefs.current[index] || 0;
        const touchY = Math.max(0, Math.min(h, gestureState.moveY - pageY));
        const ratio = 1 - (touchY / h);
        const db = Math.round(-15 + ratio * 30);
        setSettings(prev => ({
          ...prev,
          preset: 'Custom',
          bands: { ...prev.bands, [freq]: db }
        }));
      },
      onPanResponderRelease: async (evt, gestureState) => {
        const h = bandHeightRefs.current[index] || BAND_HEIGHT;
        const pageY = bandPageYRefs.current[index] || 0;
        const touchY = Math.max(0, Math.min(h, gestureState.moveY - pageY));
        const ratio = 1 - (touchY / h);
        const db = Math.round(-15 + ratio * 30);
        const updated = await setBandLevel(index, db * 100);
        setSettings({ ...updated });
      },
    });
  };

  const bandResponders = useRef(
    BAND_FREQUENCIES.map((freq, idx) => createBandPanResponder(freq, idx))
  ).current;

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  if (!visible && translateY.value === height) return null;

  const bassPercent = Math.round((settings.bassBoost / 1000) * 100);
  const virtPercent = Math.round((settings.virtualizer / 1000) * 100);

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.modal, animatedStyle]}>
        
        <View style={styles.handle} />
        
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Audio Equalizer</Text>
            <Text style={styles.subtitle}>Hardware DSP • Bass Boost • 3D Surround</Text>
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
            <Text style={styles.sectionTitle}>High-Impact Presets</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetScroll}>
              {PRESET_LIST.map((preset) => {
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
              <Text style={styles.sectionTitle}>5-Band Graphic Equalizer</Text>
              <Text style={styles.rangeLabel}>-15dB to +15dB</Text>
            </View>

            <View style={styles.bandsContainer}>
              {BAND_FREQUENCIES.map((freq, idx) => {
                const dbValue = settings.bands[freq] ?? 0;
                // Ratio from bottom: (-15dB = 0, 0dB = 0.5, +15dB = 1.0)
                const ratio = (dbValue + 15) / 30;
                const fillHeight = Math.max(6, ratio * BAND_HEIGHT);

                return (
                  <View key={freq} style={styles.bandColumn}>
                    <Text style={styles.bandDbText}>
                      {dbValue > 0 ? `+${dbValue}` : `${dbValue}`}
                    </Text>
                    
                    <View 
                      ref={(el) => { bandTrackRefs.current[idx] = el; }}
                      style={styles.bandTrackContainer}
                      onLayout={() => updateBandLayout(idx)}
                      {...(settings.enabled ? bandResponders[idx].panHandlers : {})}
                    >
                      {/* Zero dB midline marker */}
                      <View style={styles.zeroLine} />
                      <View style={styles.bandTrack} />
                      <View style={[styles.bandFill, { height: fillHeight }]} />
                      <View style={[styles.bandThumb, { bottom: Math.max(0, fillHeight - 10) }]} />
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
              <Text style={styles.sectionTitle}>Hardware Bass Boost</Text>
              <Text style={styles.accentValue}>{bassPercent}% ({settings.bassBoost} mB)</Text>
            </View>
            
            <View 
              ref={bassTrackRef}
              style={styles.horizontalSliderContainer} 
              onLayout={updateBassLayout}
              {...(settings.enabled ? bassPanResponder.panHandlers : {})}
            >
              <View style={styles.horizontalSliderTrack} />
              <View style={[styles.horizontalSliderFill, { width: `${bassPercent}%` }]} />
              <View style={[styles.horizontalSliderThumb, { left: `${bassPercent}%` }]} />
            </View>
          </View>

          {/* 3D Surround Virtualizer Slider */}
          <View style={[styles.section, !settings.enabled && styles.disabledSection]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>3D Spatial Virtualizer</Text>
              <Text style={styles.accentValue}>{virtPercent}% Surround</Text>
            </View>
            
            <View 
              ref={virtTrackRef}
              style={styles.horizontalSliderContainer} 
              onLayout={updateVirtLayout}
              {...(settings.enabled ? virtPanResponder.panHandlers : {})}
            >
              <View style={styles.horizontalSliderTrack} />
              <View style={[styles.horizontalSliderFill, { width: `${virtPercent}%`, backgroundColor: '#8a2be2' }]} />
              <View style={[styles.horizontalSliderThumb, { left: `${virtPercent}%`, borderColor: '#8a2be2' }]} />
            </View>
          </View>

          {/* Sound Boost (Headroom Gain) */}
          <View style={[styles.section, !settings.enabled && styles.disabledSection]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Sound Boost (Headroom Gain)</Text>
              <Text style={styles.accentValue}>+{Math.round(settings.soundBoost * 0.2)}% Gain</Text>
            </View>
            
            <View 
              ref={soundTrackRef}
              style={styles.horizontalSliderContainer} 
              onLayout={updateSoundLayout}
              {...(settings.enabled ? soundPanResponder.panHandlers : {})}
            >
              <View style={styles.horizontalSliderTrack} />
              <View style={[styles.horizontalSliderFill, { width: `${settings.soundBoost}%` }]} />
              <View style={[styles.horizontalSliderThumb, { left: `${settings.soundBoost}%` }]} />
            </View>
            <Text style={styles.disclaimerText}>
              Amplifies digital headroom. Keeps audio crisp without clipping or distortion.
            </Text>
          </View>

          {/* Android Hardware Equalizer Bridge */}
          <TouchableOpacity 
            style={styles.systemEqBtn} 
            onPress={openSystemEqualizer}
            activeOpacity={0.8}
          >
            <Ionicons name="hardware-chip-outline" size={20} color="#00ffcc" />
            <Text style={styles.systemEqBtnText}>🎛️ Launch System Equalizer (Dolby / AudioFX)</Text>
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
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modal: {
    backgroundColor: '#101012',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: height * 0.88,
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
    marginBottom: 18,
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
    paddingBottom: 28,
  },
  section: {
    marginBottom: 22,
  },
  disabledSection: {
    opacity: 0.35,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rangeLabel: {
    color: '#777777',
    fontSize: 11,
  },
  accentValue: {
    color: '#00ffcc',
    fontSize: 13,
    fontWeight: 'bold',
  },
  presetScroll: {
    gap: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1c1c1f',
    borderWidth: 1,
    borderColor: '#2b2b30',
  },
  presetChipActive: {
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    borderColor: '#00ffcc',
  },
  presetChipText: {
    color: '#999999',
    fontSize: 12,
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#00ffcc',
    fontWeight: 'bold',
  },
  bandsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#161619',
    borderRadius: 16,
    paddingVertical: 14,
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
    fontWeight: '700',
    marginBottom: 6,
    height: 16,
  },
  bandTrackContainer: {
    width: 36,
    height: BAND_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bandTrack: {
    width: 6,
    height: BAND_HEIGHT,
    backgroundColor: '#26262c',
    borderRadius: 3,
  },
  zeroLine: {
    position: 'absolute',
    top: BAND_HEIGHT / 2,
    left: 4,
    right: 4,
    height: 1,
    backgroundColor: '#44444c',
    zIndex: 1,
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
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#00ffcc',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 2,
  },
  bandFreqText: {
    color: '#888888',
    fontSize: 11,
    marginTop: 8,
    fontWeight: '500',
  },
  horizontalSliderContainer: {
    height: 38,
    justifyContent: 'center',
    position: 'relative',
  },
  horizontalSliderTrack: {
    height: 6,
    backgroundColor: '#222228',
    borderRadius: 3,
  },
  horizontalSliderFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    backgroundColor: '#00ffcc',
    borderRadius: 3,
  },
  horizontalSliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#00ffcc',
    marginLeft: -10,
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  disclaimerText: {
    color: '#666666',
    fontSize: 11,
    marginTop: 6,
  },
  systemEqBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#18181c',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#2d2d34',
  },
  systemEqBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 20,
  },
});
