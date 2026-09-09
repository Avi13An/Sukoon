import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions, 
  PanResponder, 
  Modal,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showToast } from './ToastNotification';
import { 
  getSoundBoostPercent, 
  setSoundBoostPercent, 
  syncSoundBoostSession 
} from '../services/soundBoostService';

const { width } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
}

const PRESETS = [
  { label: 'Normal (100%)', boost: 0, display: '100%' },
  { label: '+25% (125%)', boost: 25, display: '125%' },
  { label: '+50% (150%)', boost: 50, display: '150%' },
  { label: 'Max (200%)', boost: 100, display: '200%' },
];

export function SoundBoostModal({ visible, onClose }: Props) {
  const [boostPercent, setBoostPercent] = useState<number>(0);
  const boostPercentRef = useRef<number>(0);
  boostPercentRef.current = boostPercent;

  useEffect(() => {
    if (visible) {
      const saved = getSoundBoostPercent();
      setBoostPercent(saved);
      boostPercentRef.current = saved;
      syncSoundBoostSession();
    }
  }, [visible]);

  const handleApplyBoost = async (val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    setBoostPercent(clamped);
    boostPercentRef.current = clamped;
    await setSoundBoostPercent(clamped);
  };

  const handleSelectPreset = async (presetBoost: number, label: string) => {
    await handleApplyBoost(presetBoost);
    showToast(`Volume: ${100 + presetBoost}%`, presetBoost > 0 ? 'flash' : 'volume-medium');
  };

  // ==========================================
  // Smooth Horizontal Drag PanResponder
  // ==========================================
  const trackWidthRef = useRef<number>(width - 64);
  const initialBoostRef = useRef<number>(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        initialBoostRef.current = boostPercentRef.current;
        // Direct tap jump calculation
        const tw = trackWidthRef.current || 1;
        const locX = evt.nativeEvent.locationX;
        if (typeof locX === 'number' && locX >= 0 && locX <= tw) {
          const tappedBoost = Math.max(0, Math.min(100, Math.round((locX / tw) * 100)));
          handleApplyBoost(tappedBoost);
          initialBoostRef.current = tappedBoost;
        }
      },
      onPanResponderMove: (_, gestureState) => {
        const tw = trackWidthRef.current || 1;
        const delta = Math.round((gestureState.dx / tw) * 100);
        const newBoost = Math.max(0, Math.min(100, initialBoostRef.current + delta));
        setBoostPercent(newBoost);
        boostPercentRef.current = newBoost;
        setSoundBoostPercent(newBoost);
      },
      onPanResponderRelease: (_, gestureState) => {
        const tw = trackWidthRef.current || 1;
        const delta = Math.round((gestureState.dx / tw) * 100);
        const finalBoost = Math.max(0, Math.min(100, initialBoostRef.current + delta));
        setBoostPercent(finalBoost);
        boostPercentRef.current = finalBoost;
        setSoundBoostPercent(finalBoost);
      },
    })
  ).current;

  // Hero color determination
  const isHighBoost = boostPercent > 70;
  const isBoosted = boostPercent > 0;
  const heroColor = isHighBoost ? '#F59E0B' : isBoosted ? '#06B6D4' : '#FFFFFF';
  const totalVolumePercent = 100 + boostPercent;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />

        <View style={styles.consoleCard}>
          {/* Grabber Bar */}
          <View style={styles.grabber} />

          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.headerIconBox}>
              <Ionicons 
                name={isBoosted ? "flash" : "volume-high"} 
                size={22} 
                color="#06B6D4" 
              />
            </View>

            <View style={styles.headerTitleCol}>
              <Text style={styles.headerTitle}>Sound Booster</Text>
              <Text style={styles.headerSubtitle}>
                Amplify playback volume beyond standard device limits
              </Text>
            </View>

            <TouchableOpacity 
              style={styles.closeBtn} 
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Hero Big Readout */}
          <View style={styles.heroCard}>
            <View style={styles.heroNumberRow}>
              <Text style={[styles.heroNumber, { color: heroColor }]}>
                {totalVolumePercent}%
              </Text>
              <View style={[styles.heroStatusBadge, { borderColor: heroColor, backgroundColor: `${heroColor}15` }]}>
                <Text style={[styles.heroStatusBadgeText, { color: heroColor }]}>
                  {boostPercent === 0 ? 'Standard' : `+${boostPercent}% Boost`}
                </Text>
              </View>
            </View>

            <Text style={styles.heroSubtext}>
              {boostPercent === 0 
                ? 'Standard 100% Android hardware audio output' 
                : isHighBoost 
                  ? 'Maximum loudness amplification active' 
                  : 'Native hardware LoudnessEnhancer active'}
            </Text>

            {isHighBoost && (
              <View style={styles.warningNotice}>
                <Ionicons name="alert-circle-outline" size={14} color="#F59E0B" />
                <Text style={styles.warningNoticeText}>
                  High boost may cause slight distortion on low-end speakers
                </Text>
              </View>
            )}
          </View>

          {/* Single Horizontal Draggable Slider */}
          <View style={styles.sliderContainer}>
            <View style={styles.sliderLabelsRow}>
              <Text style={styles.sliderBoundaryLabel}>100% (Normal)</Text>
              <Text style={[styles.sliderBoundaryLabel, isBoosted && { color: heroColor, fontWeight: '700' }]}>
                200% (Max Boost)
              </Text>
            </View>

            <View 
              style={styles.sliderTrackSlot}
              onLayout={(e) => {
                trackWidthRef.current = e.nativeEvent.layout.width;
              }}
              {...panResponder.panHandlers}
            >
              {/* Unfilled Track Background */}
              <View style={styles.sliderTrackBg}>
                {/* Filled Boost Progress */}
                <View 
                  style={[
                    styles.sliderTrackFill, 
                    { 
                      width: `${boostPercent}%`,
                      backgroundColor: heroColor 
                    }
                  ]} 
                />
              </View>

              {/* Slider Knob */}
              <View 
                style={[
                  styles.sliderThumb, 
                  { 
                    left: `${Math.min(94, Math.max(0, boostPercent * 0.95))}%`,
                    borderColor: heroColor,
                    shadowColor: heroColor
                  }
                ]} 
              >
                <View style={[styles.sliderThumbInner, { backgroundColor: heroColor }]} />
              </View>
            </View>
          </View>

          {/* Quick Preset Buttons Row */}
          <View style={styles.presetsSection}>
            <Text style={styles.presetsHeaderLabel}>QUICK BOOST PRESETS</Text>
            <View style={styles.presetsRow}>
              {PRESETS.map((p) => {
                const isActive = boostPercent === p.boost;
                return (
                  <TouchableOpacity
                    key={p.label}
                    style={[styles.presetPill, isActive && styles.presetPillActive]}
                    onPress={() => handleSelectPreset(p.boost, p.label)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.presetPillText, isActive && styles.presetPillTextActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
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
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: '#1F293D',
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
  },
  grabber: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#161E2E',
    gap: 12,
  },
  headerIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.25)',
  },
  headerTitleCol: {
    flex: 1,
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
    lineHeight: 16,
  },
  closeBtn: {
    padding: 6,
  },
  heroCard: {
    backgroundColor: '#0F172A',
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  heroNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroNumber: {
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: -1,
  },
  heroStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  heroStatusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  heroSubtext: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 6,
  },
  warningNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 12,
    gap: 6,
  },
  warningNoticeText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '600',
  },
  sliderContainer: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  sliderLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sliderBoundaryLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  sliderTrackSlot: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrackBg: {
    height: 10,
    backgroundColor: '#1E293B',
    borderRadius: 5,
    overflow: 'hidden',
  },
  sliderTrackFill: {
    height: '100%',
    borderRadius: 5,
  },
  sliderThumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#090D16',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.6,
    shadowRadius: 5,
    elevation: 5,
  },
  sliderThumbInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  presetsSection: {
    marginHorizontal: 20,
    marginTop: 16,
    gap: 8,
  },
  presetsHeaderLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  presetPill: {
    flex: 1,
    backgroundColor: '#131826',
    borderColor: '#222D44',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetPillActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    borderColor: '#06B6D4',
    borderWidth: 1.5,
  },
  presetPillText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  presetPillTextActive: {
    color: '#06B6D4',
    fontWeight: 'bold',
  },
});
