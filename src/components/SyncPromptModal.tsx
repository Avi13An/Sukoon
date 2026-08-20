import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { listenForSyncInvites, joinSyncSession } from '../services/syncService';
import { Ionicons } from '@expo/vector-icons';

const { height } = Dimensions.get('window');

export function SyncPromptModal() {
  const [inviteHost, setInviteHost] = useState<string | null>(null);
  
  // Start off-screen
  const translateY = useSharedValue(height);

  useEffect(() => {
    const channel = listenForSyncInvites((hostUsername) => {
      setInviteHost(hostUsername);
      translateY.value = withSpring(0, { damping: 15, stiffness: 90 });
    });

    return () => {
      if (channel) {
        channel.unsubscribe();
      }
    };
  }, []);

  const handleAccept = async () => {
    if (inviteHost) {
      await joinSyncSession(inviteHost);
      dismiss();
    }
  };

  const dismiss = () => {
    translateY.value = withTiming(height, { duration: 300 });
    setTimeout(() => setInviteHost(null), 300);
  };

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  if (!inviteHost && translateY.value === height) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View style={[styles.modal, animatedStyle]}>
        <View style={styles.iconContainer}>
          <Ionicons name="flash" size={32} color="#00ffcc" />
        </View>
        <Text style={styles.title}>Co-Sync Invite</Text>
        <Text style={styles.message}>
          <Text style={styles.highlight}>{inviteHost}</Text> wants to sync playback with you in real-time.
        </Text>
        
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={dismiss}>
            <Text style={styles.cancelText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept}>
            <Text style={styles.acceptText}>Join Session</Text>
          </TouchableOpacity>
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
    alignItems: 'center',
    paddingBottom: 40,
    zIndex: 9999,
  },
  modal: {
    width: '90%',
    backgroundColor: '#121212',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  message: {
    color: '#aaaaaa',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  highlight: {
    color: '#00ffcc',
    fontWeight: 'bold',
  },
  actions: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: '#222222',
  },
  cancelText: {
    color: '#aaaaaa',
    fontSize: 16,
    fontWeight: '600',
  },
  acceptBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 8,
    marginLeft: 8,
    backgroundColor: '#00ffcc',
  },
  acceptText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
