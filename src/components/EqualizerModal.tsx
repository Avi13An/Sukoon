import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions, 
  PanResponder, 
  ScrollView, 
  Modal,
  Switch,
  Platform,
  SafeAreaView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showToast } from './ToastNotification';
import { 
  EQ_PRESETS, 
  EqPreset, 
  DEFAULT_FREQUENCIES,
  getSavedBandLevels, 
  getSavedBassStrength, 
  getSavedPresetName, 
  getSavedEqEnabled,
  applyBandLevel, 
  applyBassBoost, 
  applyPreset, 
  setEqEnabled, 
  openSystemDolbyPanel,
  syncAudioSession
} from '../services/audioFxService';

const { width } = Dimensions.get('window');
const TRACK_HEIGHT = 140;

interface Props {
  visible: boolean;
  onClose: () => void;
}

const FREQ_LABELS = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'];

export function EqualizerModal({ visible, onClose }: Props) {
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [bandLevels, setBandLevels] = useState<number[]>([0, 0, 0, 0, 0]);
  const [bassStrength, setBassStrength] = useState<number>(0);
  const [activePreset, setActivePreset] = useState<string>('Flat');

  // Load saved state on mount and when modal becomes visible
  useEffect(() => {
    if (visible) {
      setIsEnabled(getSavedEqEnabled());
      setBandLevels(getSavedBandLevels());
      setBassStrength(getSavedBassStrength());
      setActivePreset(getSavedPresetName());
      syncAudioSession();
    }
  }, [visible]);

  const handleToggleEnabled = async (val: boolean) => {
    setIsEnabled(val);
    await setEqEnabled(val);
    showToast(val ? 'Equalizer enabled' : 'Equalizer bypassed', val ? 'sparkles' : 'power');
  };

  const handleSelectPreset = async (preset: EqPreset) => {
    setActivePreset(preset.name);
    setBandLevels([...preset.levels]);
    setBassStrength(preset.bass);
    await applyPreset(preset);
    showToast(`Preset: ${preset.name}`, 'sparkles');
  };

  const handleOpenDolbyPanel = async () => {
    const success = await openSystemDolbyPanel();
    if (!success) {
      showToast('System sound panel not available on this device', 'alert-circle');
    }
  };

  // ==========================================
  // Horizontal Bass Boost PanResponder
  // ==========================================
  const bassTrackWidthRef = useRef<number>(width - 64);
  const initialBassRef = useRef<number>(0);

  const bassPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        initialBassRef.current = bassStrength;
      },
      onPanResponderMove: (_, gestureState) => {
        const tw = bassTrackWidthRef.current || 1;
        const delta = Math.round((gestureState.dx / tw) * 1000);
        const newBass = Math.max(0, Math.min(1000, initialBassRef.current + delta));
        setBassStrength(newBass);
        setActivePreset('Custom');
        applyBassBoost(newBass);
      },
      onPanResponderRelease: () => {
        showToast(`Bass Boost: ${Math.round((bassStrength / 1000) * 100)}%`, 'radio');
      },
    })
  ).current;

  // ==========================================
  // 5-Band Vertical Sliders PanResponders
  // ==========================================
  const initialBandLevelRef = useRef<number>(0);

  const createBandPanResponder = (index: number) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        initialBandLevelRef.current = bandLevels[index] ?? 0;
      },
      onPanResponderMove: (_, gestureState) => {
        // Drag up (-dy) increases millibels; drag down (+dy) decreases
        const delta = Math.round((-gestureState.dy / TRACK_HEIGHT) * 3000);
        const newLevel = Math.max(-1500, Math.min(1500, initialBandLevelRef.current + delta));
        setBandLevels((prev) => {
          const copy = [...prev];
          copy[index] = newLevel;
          return copy;
        });
        setActivePreset('Custom');
        applyBandLevel(index, newLevel);
      },
      onPanResponderRelease: () => {},
    });
  };

  const band0Pan = useRef(createBandPanResponder(0)).current;
  const band1Pan = useRef(createBandPanResponder(1)).current;
  const band2Pan = useRef(createBandPanResponder(2)).current;
  const band3Pan = useRef(createBandPanResponder(3)).current;
  const band4Pan = useRef(createBandPanResponder(4)).current;
  const bandPans = [band0Pan, band1Pan, band2Pan, band3Pan, band4Pan];

  const formatDb = (mB: number) => {
    const db = Math.round(mB / 100);
    return db > 0 ? `+${db} dB` : `${db} dB`;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        
        <View style={styles.consoleCard}>
          {/* Top Grabber */}
          <View style={styles.grabber} />

          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleCol}>
              <View style={styles.titleWithIcon}>
                <Ionicons name="hardware-chip-outline" size={20} color="#06B6D4" />
                <Text style={styles.headerTitle}>Audio Studio & EQ</Text>
              </View>
              <Text style={styles.headerSubtitle}>Hardware DSP & Dolby Atmos</Text>
            </View>

            {/* Dolby Atmos / System EQ Button */}
            <TouchableOpacity 
              style={styles.dolbyBtn} 
              onPress={handleOpenDolbyPanel}
              activeOpacity={0.7}
            >
              <Ionicons name="options-outline" size={16} color="#06B6D4" />
              <Text style={styles.dolbyBtnText}>Dolby / System EQ</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.closeIconBtn} 
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={22} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <ScrollView 
            showsVerticalScrollIndicator={false} 
            contentContainerStyle={styles.scrollContent}
          >
            {/* Master EQ Power Switch */}
            <View style={styles.powerCard}>
              <View style={styles.powerInfo}>
                <Ionicons 
                  name={isEnabled ? "power" : "power-outline"} 
                  size={20} 
                  color={isEnabled ? "#06B6D4" : "#64748B"} 
                />
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.powerTitle}>Equalizer Engine</Text>
                  <Text style={styles.powerStatus}>
                    {isEnabled ? 'Hardware DSP Active' : 'DSP Bypassed'}
                  </Text>
                </View>
              </View>
              <Switch
                value={isEnabled}
                onValueChange={handleToggleEnabled}
                thumbColor={isEnabled ? '#06B6D4' : '#64748B'}
                trackColor={{ false: '#1E293B', true: 'rgba(6, 182, 212, 0.35)' }}
              />
            </View>

            {/* Presets Horizontal Strip */}
            <View style={styles.sectionWrapper}>
              <Text style={styles.sectionHeaderLabel}>FACTORY & CUSTOM PRESETS</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                contentContainerStyle={styles.presetsStrip}
              >
                {EQ_PRESETS.map((p) => {
                  const isSelected = activePreset === p.name;
                  return (
                    <TouchableOpacity
                      key={p.name}
                      style={[styles.presetPill, isSelected && styles.presetPillActive]}
                      onPress={() => handleSelectPreset(p)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.presetPillText, isSelected && styles.presetPillTextActive]}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {activePreset === 'Custom' && (
                  <View style={[styles.presetPill, styles.presetPillActive]}>
                    <Text style={[styles.presetPillText, styles.presetPillTextActive]}>
                      Custom
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>

            {/* Hardware Bass Boost Subwoofer Slider */}
            <View style={styles.bassCard}>
              <View style={styles.bassHeaderRow}>
                <View style={styles.bassTitleRow}>
                  <Ionicons name="radio" size={17} color="#06B6D4" />
                  <Text style={styles.bassTitle}>Bass Boost (Subwoofer Driver)</Text>
                </View>
                <Text style={styles.bassValueBadge}>
                  {Math.round((bassStrength / 1000) * 100)}%
                </Text>
              </View>

              <View 
                style={styles.bassTrackWrapper}
                onLayout={(e) => {
                  bassTrackWidthRef.current = e.nativeEvent.layout.width;
                }}
                {...bassPanResponder.panHandlers}
              >
                <View style={styles.bassTrackBg}>
                  <View 
                    style={[
                      styles.bassTrackFill, 
                      { width: `${Math.min(100, Math.max(0, (bassStrength / 1000) * 100))}%` }
                    ]} 
                  />
                </View>
                <View 
                  style={[
                    styles.bassThumb, 
                    { left: `${Math.min(95, Math.max(0, (bassStrength / 1000) * 96))}%` }
                  ]} 
                />
              </View>
            </View>

            {/* 5-Band Vertical Hardware Sliders */}
            <View style={styles.eqBandsCard}>
              <Text style={styles.sectionHeaderLabel}>5-BAND HARDWARE EQUALIZER (MILLIBEL PRECISION)</Text>

              <View style={styles.bandsContainer}>
                {FREQ_LABELS.map((freq, idx) => {
                  const mB = bandLevels[idx] ?? 0;
                  // Normalized fraction from bottom: 0 at -1500mB, 0.5 at 0mB, 1 at +1500mB
                  const fraction = Math.max(0, Math.min(1, (mB + 1500) / 3000));
                  const thumbTop = (1 - fraction) * (TRACK_HEIGHT - 20);

                  return (
                    <View key={freq} style={styles.bandColumn}>
                      <Text style={styles.dbLabel}>{formatDb(mB)}</Text>

                      <View 
                        style={styles.verticalTrackSlot} 
                        {...bandPans[idx].panHandlers}
                      >
                        {/* Vertical Track Line */}
                        <View style={styles.verticalTrackLine}>
                          {/* Center 0dB Detent Line */}
                          <View style={styles.centerDetent} />
                          {/* Active filled level from center */}
                          {mB >= 0 ? (
                            <View 
                              style={[
                                styles.bandFillPositive, 
                                { height: (mB / 1500) * (TRACK_HEIGHT / 2) }
                              ]} 
                            />
                          ) : (
                            <View 
                              style={[
                                styles.bandFillNegative, 
                                { height: (-mB / 1500) * (TRACK_HEIGHT / 2) }
                              ]} 
                            />
                          )}
                        </View>

                        {/* Thumb Knob */}
                        <View style={[styles.verticalThumb, { top: thumbTop }]} />
                      </View>

                      <Text style={styles.freqLabel}>{freq}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  consoleCard: {
    backgroundColor: '#090D16',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#1F293D',
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#161E2E',
    gap: 10,
  },
  headerTitleCol: {
    flex: 1,
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  dolbyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
    borderColor: '#06B6D4',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  dolbyBtnText: {
    color: '#06B6D4',
    fontSize: 11,
    fontWeight: '700',
  },
  closeIconBtn: {
    padding: 4,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  powerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  powerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  powerTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  powerStatus: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  sectionWrapper: {
    gap: 8,
  },
  sectionHeaderLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  presetsStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  presetPill: {
    backgroundColor: '#131826',
    borderColor: '#222D44',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  presetPillActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    borderColor: '#06B6D4',
    borderWidth: 1.5,
  },
  presetPillText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  presetPillTextActive: {
    color: '#06B6D4',
    fontWeight: 'bold',
  },
  bassCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 12,
  },
  bassHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bassTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bassTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  bassValueBadge: {
    color: '#06B6D4',
    fontSize: 13,
    fontWeight: '800',
  },
  bassTrackWrapper: {
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  bassTrackBg: {
    height: 8,
    backgroundColor: '#1E293B',
    borderRadius: 4,
    overflow: 'hidden',
  },
  bassTrackFill: {
    height: '100%',
    backgroundColor: '#06B6D4',
    borderRadius: 4,
  },
  bassThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#06B6D4',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#06B6D4',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  eqBandsCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 14,
  },
  bandsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  bandColumn: {
    alignItems: 'center',
    width: 50,
  },
  dbLabel: {
    color: '#06B6D4',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
    height: 16,
  },
  verticalTrackSlot: {
    width: 40,
    height: TRACK_HEIGHT,
    alignItems: 'center',
    position: 'relative',
  },
  verticalTrackLine: {
    width: 6,
    height: TRACK_HEIGHT,
    backgroundColor: '#1E293B',
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
  },
  centerDetent: {
    position: 'absolute',
    top: TRACK_HEIGHT / 2 - 1,
    width: 14,
    height: 2,
    backgroundColor: '#64748B',
    alignSelf: 'center',
  },
  bandFillPositive: {
    position: 'absolute',
    bottom: TRACK_HEIGHT / 2,
    width: 6,
    backgroundColor: '#06B6D4',
    borderRadius: 3,
  },
  bandFillNegative: {
    position: 'absolute',
    top: TRACK_HEIGHT / 2,
    width: 6,
    backgroundColor: '#0891B2',
    borderRadius: 3,
  },
  verticalThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#06B6D4',
    shadowColor: '#06B6D4',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  freqLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 8,
  },
});
