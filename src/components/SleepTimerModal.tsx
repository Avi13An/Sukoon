import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  TouchableWithoutFeedback,
  TextInput,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { 
  SleepTimerMode, 
  SleepTimerState, 
  setSleepTimer, 
  setCustomSleepTimer,
  subscribeToSleepTimer, 
  clearSleepTimer,
  getSleepTimerState,
  getSleepTimerRemaining,
  checkSleepTimerExpiration,
} from '../services/sleepTimerService';
import { showToast } from './ToastNotification';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface TimerOption {
  label: string;
  mode: SleepTimerMode;
  icon: keyof typeof Ionicons.glyphMap;
}

const TIMER_OPTIONS: TimerOption[] = [
  { label: '5 Minutes', mode: '5m', icon: 'timer-outline' },
  { label: '15 Minutes', mode: '15m', icon: 'timer-outline' },
  { label: '30 Minutes', mode: '30m', icon: 'timer-outline' },
  { label: '45 Minutes', mode: '45m', icon: 'timer-outline' },
  { label: '60 Minutes', mode: '60m', icon: 'timer-outline' },
  { label: 'End of This Song', mode: 'end_of_track', icon: 'musical-notes-outline' },
  { label: 'Turn Off', mode: 'off', icon: 'close-circle-outline' },
];

export function SleepTimerModal({ visible, onClose }: Props) {
  const [timerState, setTimerState] = useState<SleepTimerState>(getSleepTimerState());
  const [remainingTime, setRemainingTime] = useState<number | null>(() => {
    const rem = getSleepTimerRemaining();
    return rem ? Math.ceil(rem / 1000) : null;
  });
  const [customMinutes, setCustomMinutes] = useState<number>(25);

  const adjustMinutes = (delta: number) => {
    setCustomMinutes((prev) => Math.max(1, Math.min(720, (prev || 0) + delta)));
  };

  useEffect(() => {
    const unsubscribe = subscribeToSleepTimer((remaining, state) => {
      setRemainingTime(remaining ? Math.ceil(remaining / 1000) : null);
      if (state) {
        setTimerState(state);
      }
    });

    const timerInterval = setInterval(() => {
      const rem = getSleepTimerRemaining();
      setRemainingTime(rem ? Math.ceil(rem / 1000) : null);
      if (rem && rem <= 0) {
        checkSleepTimerExpiration();
      }
    }, 1000);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkSleepTimerExpiration();
        const rem = getSleepTimerRemaining();
        setRemainingTime(rem ? Math.ceil(rem / 1000) : null);
        setTimerState(getSleepTimerState());
      }
    });

    return () => {
      unsubscribe();
      clearInterval(timerInterval);
      appStateSub.remove();
    };
  }, []);

  const handleSelectOption = (option: TimerOption) => {
    if (option.mode === 'off') {
      clearSleepTimer();
      showToast('Sleep timer turned off', 'moon-outline');
    } else {
      setSleepTimer(option.mode);
      showToast(`Sleep timer set: ${option.label}`, 'moon');
    }
    onClose();
  };

  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.container}>
              
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerTitleRow}>
                  <View style={styles.iconBadge}>
                    <Ionicons name="moon" size={18} color="#00ffcc" />
                  </View>
                  <Text style={styles.title}>Sleep Timer</Text>
                </View>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color="#aaaaaa" />
                </TouchableOpacity>
              </View>

              {/* Active Status Badge */}
              {timerState.isActive ? (
                <View style={styles.activeBanner}>
                  <Ionicons name="time-outline" size={16} color="#00ffcc" />
                  <Text style={styles.activeBannerText}>
                    {timerState.mode === 'end_of_track' 
                      ? 'Stopping playback at the end of this song' 
                      : `Playback stops in ${formatCountdown(remainingTime ?? timerState.timeRemainingSeconds)}`}
                  </Text>
                </View>
              ) : null}

              {/* Options */}
              <View style={styles.optionsList}>
                {TIMER_OPTIONS.map((opt) => {
                  const isSelected = timerState.mode === opt.mode;
                  return (
                    <TouchableOpacity
                      key={opt.mode}
                      style={[
                        styles.presetOption,
                        isSelected && styles.presetOptionActive,
                      ]}
                      onPress={() => handleSelectOption(opt)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.presetLeft}>
                        <Ionicons 
                          name={opt.icon} 
                          size={18} 
                          color={isSelected ? '#00ffcc' : 'rgba(255, 255, 255, 0.6)'} 
                        />
                        <Text style={[styles.presetText, isSelected && styles.presetTextActive]}>
                          {opt.label}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={18} color="#00ffcc" />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Custom Duration Section */}
              <View style={styles.customSection}>
                <Text style={styles.customSectionTitle}>Custom Duration</Text>
                <View style={styles.customControlsRow}>
                  <TouchableOpacity 
                    style={styles.stepperBtn} 
                    onPress={() => adjustMinutes(-5)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stepperBtnText}>- 5m</Text>
                  </TouchableOpacity>

                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.customInput}
                      keyboardType="numeric"
                      value={customMinutes ? customMinutes.toString() : ''}
                      onChangeText={(txt) => {
                        const num = parseInt(txt.replace(/[^0-9]/g, ''), 10);
                        if (!isNaN(num)) {
                          setCustomMinutes(Math.max(1, Math.min(720, num)));
                        } else {
                          setCustomMinutes(0);
                        }
                      }}
                      maxLength={3}
                      placeholder="25"
                      placeholderTextColor="#555566"
                    />
                    <Text style={styles.inputSuffix}>min</Text>
                  </View>

                  <TouchableOpacity 
                    style={styles.stepperBtn} 
                    onPress={() => adjustMinutes(5)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stepperBtnText}>+ 5m</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity 
                  style={styles.setCustomBtn}
                  onPress={() => {
                    const mins = customMinutes > 0 ? customMinutes : 1;
                    setCustomSleepTimer(mins);
                    showToast(`Sleep timer set for ${mins} minutes`, 'moon');
                    onClose();
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="timer-outline" size={18} color="#000000" />
                  <Text style={styles.setCustomBtnText}>Set Custom Timer ({customMinutes || 1} min)</Text>
                </TouchableOpacity>
              </View>

            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    backgroundColor: '#0d0d0d',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#222222',
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 204, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.25)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
    gap: 8,
  },
  activeBannerText: {
    color: '#00ffcc',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  optionsList: {
    marginBottom: 6,
  },
  presetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    marginBottom: 8,
  },
  presetOptionActive: {
    backgroundColor: 'rgba(0, 255, 204, 0.08)',
    borderColor: '#00ffcc',
    borderWidth: 1.5,
  },
  presetLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  presetText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.75)',
  },
  presetTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  customSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1c1c24',
  },
  customSectionTitle: {
    color: '#aaaaaa',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  customControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 10,
  },
  stepperBtn: {
    flex: 1,
    backgroundColor: '#16161e',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#242432',
  },
  stepperBtnText: {
    color: '#00ffcc',
    fontSize: 14,
    fontWeight: '700',
  },
  inputContainer: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101016',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#262636',
    paddingHorizontal: 8,
    height: 42,
  },
  customInput: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    minWidth: 40,
    padding: 0,
  },
  inputSuffix: {
    color: '#888896',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  setCustomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00ffcc',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  setCustomBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
});
