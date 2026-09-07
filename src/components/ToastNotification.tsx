import React, { useState, useEffect, useRef } from 'react';
import { 
  Animated, 
  Text, 
  StyleSheet, 
  Platform,
  TouchableWithoutFeedback
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface ToastPayload {
  id: number;
  message: string;
  icon?: string;
  durationMs?: number;
}

type ToastListener = (toast: ToastPayload) => void;
const toastListeners: ToastListener[] = [];
let nextToastId = 1;

export function showToast(message: string, icon: string = 'checkmark-circle', durationMs: number = 2500) {
  const payload: ToastPayload = {
    id: nextToastId++,
    message,
    icon,
    durationMs,
  };
  toastListeners.forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      console.error('[ToastNotification] Listener error:', e);
    }
  });
}

export function ToastNotification() {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(-24)).current;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler: ToastListener = (newToast) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setToast(newToast);

      // Slide & fade in
      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(translateYAnim, {
          toValue: 0,
          damping: 15,
          stiffness: 150,
          useNativeDriver: true,
        }),
      ]).start();

      // Schedule auto-dismiss
      timeoutRef.current = setTimeout(() => {
        dismissToast();
      }, newToast.durationMs || 2500);
    };

    toastListeners.push(handler);
    return () => {
      const idx = toastListeners.indexOf(handler);
      if (idx !== -1) toastListeners.splice(idx, 1);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const dismissToast = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateYAnim, {
        toValue: -24,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToast(null);
    });
  };

  if (!toast) return null;

  const iconName = (toast.icon || 'checkmark-circle') as keyof typeof Ionicons.glyphMap;

  return (
    <Animated.View 
      style={[
        styles.container, 
        {
          opacity: opacityAnim,
          transform: [{ translateY: translateYAnim }],
        }
      ]}
      pointerEvents="box-none"
    >
      <TouchableWithoutFeedback onPress={dismissToast}>
        <Animated.View style={styles.pill}>
          <Ionicons name={iconName} size={20} color="#00ffcc" style={styles.icon} />
          <Text style={styles.message} numberOfLines={2}>
            {toast.message}
          </Text>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999999,
    elevation: 999999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#00ffcc',
    paddingHorizontal: 18,
    paddingVertical: 12,
    maxWidth: '90%',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 12,
    gap: 10,
  },
  icon: {
    marginRight: 2,
  },
  message: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
});
