import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, PanResponder } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { EQ_PRESETS, getEqualizerPreset, setEqualizerPreset, getLoudnessGain, setLoudnessEnhancer } from '../services/audioEnhancerService';

const { height, width } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function AudioSettingsModal({ visible, onClose }: Props) {
  const [activePreset, setActivePreset] = useState(getEqualizerPreset());
  const [gain, setGain] = useState(getLoudnessGain());
  
  const translateY = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 15, stiffness: 90 });
    } else {
      translateY.value = withTiming(height, { duration: 300 });
    }
  }, [visible]);

  const handlePresetSelect = (preset: string) => {
    setActivePreset(preset);
    setEqualizerPreset(preset);
  };

  // Build a simple custom pan responder for the Gain Slider
  // Range: 1.0 to 3.0
  const sliderWidth = width - 80;
  const SLIDER_MIN = 1.0;
  const SLIDER_MAX = 3.0;

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (evt, gestureState) => {
      let newX = gestureState.moveX - 40; // 40 is the padding left
      if (newX < 0) newX = 0;
      if (newX > sliderWidth) newX = sliderWidth;
      
      const newGain = SLIDER_MIN + ((newX / sliderWidth) * (SLIDER_MAX - SLIDER_MIN));
      setGain(newGain);
    },
    onPanResponderRelease: () => {
      setLoudnessEnhancer(gain);
    }
  });

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
          <Text style={styles.title}>Audio Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Equalizer Preset</Text>
          <View style={styles.presetGrid}>
            {EQ_PRESETS.map((preset) => (
              <TouchableOpacity 
                key={preset} 
                style={[styles.presetBtn, activePreset === preset && styles.presetBtnActive]}
                onPress={() => handlePresetSelect(preset)}
              >
                <Text style={[styles.presetText, activePreset === preset && styles.presetTextActive]}>{preset}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.enhancerHeader}>
            <Text style={styles.sectionTitle}>Sound Enhancer (Amplifier)</Text>
            <Text style={styles.gainText}>x{gain.toFixed(1)}</Text>
          </View>
          
          <View style={styles.sliderContainer} {...panResponder.panHandlers}>
            <View style={styles.sliderTrack} />
            <View 
              style={[
                styles.sliderFill, 
                { width: `${((gain - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100}%` }
              ]} 
            />
            <View 
              style={[
                styles.sliderThumb, 
                { left: `${((gain - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100}%` }
              ]} 
            />
          </View>
          <Text style={styles.enhancerDisclaimer}>
            Pushes volume beyond hardware maximum. May cause audio clipping on some tracks.
          </Text>
        </View>

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
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modal: {
    backgroundColor: '#121212',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 400,
    borderTopWidth: 1,
    borderColor: '#222222',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#333333',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 4,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  presetBtn: {
    width: '48%',
    backgroundColor: '#000000',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333333',
  },
  presetBtnActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  presetText: {
    color: '#aaaaaa',
    fontWeight: '600',
  },
  presetTextActive: {
    color: '#000000',
  },
  enhancerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  gainText: {
    color: '#00ffcc',
    fontWeight: 'bold',
  },
  sliderContainer: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 8,
  },
  sliderTrack: {
    height: 4,
    backgroundColor: '#333333',
    borderRadius: 2,
    width: '100%',
  },
  sliderFill: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#00ffcc',
    borderRadius: 2,
    left: 0,
  },
  sliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    marginLeft: -10, // center the thumb
  },
  enhancerDisclaimer: {
    color: '#666666',
    fontSize: 12,
    marginTop: 8,
  }
});
