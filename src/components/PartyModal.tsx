import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
  Share,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { 
  PartyState, 
  getPartyState, 
  subscribeToPartyState, 
  createPartyRoom, 
  joinPartyRoom, 
  leaveParty 
} from '../services/partyService';
import { showToast } from './ToastNotification';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function PartyModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [partyState, setPartyState] = useState<PartyState>(getPartyState());
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isHosting, setIsHosting] = useState(false);
  const translateY = useSharedValue(height);

  useEffect(() => {
    const unsub = subscribeToPartyState((state) => {
      setPartyState(state);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 18, stiffness: 100 });
    } else {
      translateY.value = withTiming(height, { duration: 250 });
    }
  }, [visible]);

  const handleHost = async () => {
    setIsHosting(true);
    try {
      const code = await createPartyRoom();
      await Clipboard.setStringAsync(code);
      showToast(`Party code ${code} copied to clipboard!`, 'copy-outline');
    } catch (e) {
      showToast('Could not create party', 'alert-circle');
    } finally {
      setIsHosting(false);
    }
  };

  const handleJoin = async () => {
    const clean = joinCode.trim().toUpperCase();
    if (!clean) {
      showToast('Enter a 6-character room code', 'alert-circle');
      return;
    }
    setIsJoining(true);
    try {
      const success = await joinPartyRoom(clean);
      if (success) {
        setJoinCode('');
      }
    } catch (e) {
      showToast('Failed to connect to room', 'alert-circle');
    } finally {
      setIsJoining(false);
    }
  };

  const handleShareCode = async () => {
    if (!partyState.roomCode) return;
    try {
      await Share.share({
        message: `Join my Sukoon Jam Party Room! Code: ${partyState.roomCode}\nListen to pure lossless music in real-time sync with me!`,
      });
    } catch {}
  };

  const handleCopyCode = async () => {
    if (!partyState.roomCode) return;
    await Clipboard.setStringAsync(partyState.roomCode);
    showToast(`Copied ${partyState.roomCode} to clipboard!`, 'copy-outline');
  };

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  if (!visible && translateY.value === height) return null;

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.modal, { maxHeight: height * 0.88 }, animatedStyle]}>
        
        <View style={styles.handle} />

        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <View style={styles.jamIconBadge}>
              <Ionicons name="sparkles" size={18} color="#00ffcc" />
            </View>
            <View>
              <Text style={styles.title}>Sukoon Jam</Text>
              <Text style={styles.subtitle}>Real-Time Multi-Device Party Sync</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 24) + 60,
          }}
          showsVerticalScrollIndicator={false}
        >
          {partyState.isActive ? (
            /* ================= CONNECTED / ACTIVE STATE ================= */
            <View style={styles.activeContainer}>
              <View style={styles.activeBadge}>
                <View style={styles.pulsingDot} />
                <Text style={styles.activeBadgeText}>
                  Party Active with Room {partyState.roomCode}
                </Text>
              </View>

              <View style={styles.codeDisplayCard}>
                <Text style={styles.codeLabel}>ROOM CODE</Text>
                <Text style={styles.codeText}>{partyState.roomCode}</Text>
                
                <View style={styles.codeActionsRow}>
                  <TouchableOpacity style={styles.codeActionBtn} onPress={handleCopyCode} activeOpacity={0.75}>
                    <Ionicons name="copy-outline" size={16} color="#00ffcc" />
                    <Text style={styles.codeActionBtnText}>Copy Code</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.codeActionBtn} onPress={handleShareCode} activeOpacity={0.75}>
                    <Ionicons name="share-social-outline" size={16} color="#00ffcc" />
                    <Text style={styles.codeActionBtnText}>Share Invite</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.roleCard}>
                <Ionicons 
                  name={partyState.role === 'host' ? 'radio-outline' : 'musical-note-outline'} 
                  size={20} 
                  color="#00ffcc" 
                />
                <Text style={styles.roleText}>
                  You are currently the <Text style={styles.roleHighlight}>{partyState.role?.toUpperCase()}</Text>
                  {partyState.role === 'host' && (
                    <Text style={styles.roleSubtext}> • {(partyState.clientCount || 0) + 1} devices connected</Text>
                  )}
                </Text>
              </View>

              <View style={styles.infoBox}>
                <Ionicons name="sync" size={20} color="#00ffcc" style={{ marginTop: 2 }} />
                <Text style={styles.infoText}>
                  All connected devices are synchronized. Any play, pause, seek, or song change reflects across all devices in real-time.
                </Text>
              </View>

              <TouchableOpacity 
                style={[styles.leaveBtn, { marginBottom: 16 }]} 
                onPress={leaveParty}
                activeOpacity={0.8}
              >
                <Ionicons name="log-out-outline" size={20} color="#ff4444" />
                <Text style={styles.leaveBtnText}>Leave Party</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* ================= DISCONNECTED STATE ================= */
            <View style={styles.disconnectedContainer}>
              
              {/* Host Section */}
              <View style={styles.sectionCard}>
                <View style={styles.cardHeaderRow}>
                  <Ionicons name="radio" size={22} color="#00ffcc" />
                  <Text style={styles.cardTitle}>Host a Party</Text>
                </View>
                <Text style={styles.cardDescription}>
                  Generate a room code to invite a friend. You control the DJ deck and your friend's playback stays in lockstep.
                </Text>

                <TouchableOpacity 
                  style={styles.hostBtn} 
                  onPress={handleHost}
                  disabled={isHosting}
                  activeOpacity={0.85}
                >
                  {isHosting ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={18} color="#000000" />
                      <Text style={styles.hostBtnText}>Create Party Room</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Join Section */}
              <View style={styles.sectionCard}>
                <View style={styles.cardHeaderRow}>
                  <Ionicons name="enter" size={22} color="#00ffcc" />
                  <Text style={styles.cardTitle}>Join a Party</Text>
                </View>
                <Text style={styles.cardDescription}>
                  Enter the 6-character room code shared by your friend to sync your audio stream.
                </Text>

                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. SK-8492"
                    placeholderTextColor="#666666"
                    value={joinCode}
                    onChangeText={setJoinCode}
                    autoCapitalize="characters"
                    maxLength={10}
                  />
                  <TouchableOpacity 
                    style={styles.joinBtn} 
                    onPress={handleJoin}
                    disabled={isJoining}
                    activeOpacity={0.85}
                  >
                    {isJoining ? (
                      <ActivityIndicator size="small" color="#000000" />
                    ) : (
                      <Text style={styles.joinBtnText}>Connect</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.privacyNote}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#777777" />
                <Text style={styles.privacyText}>
                  Encrypted via TLS WebSockets. Zero credentials or account setup required.
                </Text>
              </View>

            </View>
          )}
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
    paddingTop: 12,
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
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  jamIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.3)',
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
  activeContainer: {
    paddingVertical: 10,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#00ffcc',
    marginBottom: 20,
    gap: 8,
  },
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00ffcc',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 4,
  },
  activeBadgeText: {
    color: '#00ffcc',
    fontWeight: 'bold',
    fontSize: 13,
  },
  codeDisplayCard: {
    backgroundColor: '#18181c',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#292930',
    marginBottom: 16,
  },
  codeLabel: {
    color: '#888888',
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '600',
    marginBottom: 4,
  },
  codeText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 4,
    marginVertical: 4,
  },
  codeActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  codeActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#24242a',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#383842',
  },
  codeActionBtnText: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '600',
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#161619',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#242428',
  },
  roleText: {
    color: '#cccccc',
    fontSize: 13,
  },
  roleHighlight: {
    color: '#00ffcc',
    fontWeight: 'bold',
  },
  roleSubtext: {
    color: '#888899',
    fontSize: 12,
    fontWeight: 'normal',
  },
  infoBox: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(0, 255, 204, 0.06)',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.2)',
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    color: '#b0b0b8',
    fontSize: 12,
    lineHeight: 18,
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 68, 68, 0.4)',
  },
  leaveBtnText: {
    color: '#ff4444',
    fontSize: 15,
    fontWeight: 'bold',
  },
  disconnectedContainer: {
    paddingVertical: 4,
  },
  sectionCard: {
    backgroundColor: '#161619',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#25252a',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cardDescription: {
    color: '#888890',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  hostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00ffcc',
    borderRadius: 12,
    paddingVertical: 12,
  },
  hostBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#222228',
  },
  dividerText: {
    color: '#555555',
    fontSize: 11,
    fontWeight: 'bold',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#101012',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: '#303038',
    letterSpacing: 2,
  },
  joinBtn: {
    backgroundColor: '#00ffcc',
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
  },
  privacyText: {
    color: '#666666',
    fontSize: 11,
  },
  bottomSpacer: {
    height: 24,
  },
});
