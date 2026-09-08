import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StudioRecording } from '../utils/storage';
import { getStudioRecordings, deleteRecording, shareRecording } from '../services/recordingService';
import { playTrack } from '../services/TrackPlayerService';
import { showToast } from './ToastNotification';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function StudioRecordingsModal({ visible, onClose }: Props) {
  const [recordings, setRecordings] = useState<StudioRecording[]>([]);

  const loadRecordings = () => {
    setRecordings(getStudioRecordings());
  };

  useEffect(() => {
    if (visible) {
      loadRecordings();
    }
  }, [visible]);

  const handlePlayRecording = async (item: StudioRecording) => {
    try {
      const playableUri = item.localUri.startsWith('file://') 
        ? item.localUri 
        : `file://${item.localUri}`;
      await playTrack({
        id: item.id,
        title: item.songTitle,
        artist: item.artist || 'Studio Vocal Take',
        url: playableUri,
        duration: item.durationSeconds,
        artwork: item.artwork,
      });
      showToast(`Playing "${item.songTitle}"`, 'musical-note');
      onClose();
    } catch (err: any) {
      Alert.alert('Playback Error', err.message || 'Unable to play recording.');
    }
  };

  const handleShareRecording = async (item: StudioRecording) => {
    try {
      await shareRecording(item.localUri, item.songTitle);
    } catch (err: any) {
      Alert.alert('Share Error', err.message || 'Unable to share recording.');
    }
  };

  const handleDeleteRecording = (item: StudioRecording) => {
    Alert.alert(
      'Delete Recording',
      `Are you sure you want to delete this cover of "${item.songTitle}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteRecording(item.id, item.localUri);
            loadRecordings();
            showToast('Recording deleted', 'trash-outline');
          },
        },
      ]
    );
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.headerTitleBox}>
            <View style={styles.badgeRow}>
              <Ionicons name="mic" size={13} color="#00ffcc" />
              <Text style={[styles.badgeText, { color: '#00ffcc' }]}>STUDIO RECORDINGS</Text>
            </View>
            <Text style={styles.headerTitle}>Your Vocal Takes & Covers</Text>
          </View>
        </View>

        {/* List of Recordings */}
        <FlatList
          data={recordings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.recordingCard}>
              <TouchableOpacity 
                style={styles.playActionArea} 
                onPress={() => handlePlayRecording(item)}
                activeOpacity={0.7}
              >
                {item.artwork ? (
                  <View style={styles.coverBox}>
                    <Image source={{ uri: item.artwork }} style={styles.coverImg} />
                    <View style={styles.coverPlayOverlay}>
                      <Ionicons name="play" size={14} color="#00ffcc" />
                    </View>
                  </View>
                ) : (
                  <View style={styles.micCircle}>
                    <Ionicons 
                      name="mic" 
                      size={18} 
                      color="#00ffcc" 
                    />
                  </View>
                )}
                <View style={styles.metaBox}>
                  <View style={styles.titleRow}>
                    <Text style={styles.songTitle} numberOfLines={1}>
                      {item.songTitle}
                    </Text>
                  </View>
                  <Text style={styles.artistText} numberOfLines={1}>
                    {item.artist} • {formatTime(item.durationSeconds)}
                  </Text>
                  <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.actionButtons}>
                <TouchableOpacity 
                  style={styles.actionBtn} 
                  onPress={() => handleShareRecording(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="share-social-outline" size={18} color="#00ffcc" />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.actionBtn} 
                  onPress={() => handleDeleteRecording(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={18} color="#ff5252" />
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="mic-outline" size={44} color="#55555c" />
              </View>
              <Text style={styles.emptyTitle}>No Studio Takes Yet</Text>
              <Text style={styles.emptySubtitle}>
                Open any song in the player, tap "Studio" to open the live karaoke teleprompter, and sing along to record your covers!
              </Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222228',
    backgroundColor: '#0a0a0c',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#18181c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleBox: {
    flex: 1,
    marginLeft: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  badgeText: {
    color: '#ff3b30',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  recordingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101014',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222228',
    padding: 12,
    marginBottom: 12,
  },
  playActionArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  micCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  masterMicCircle: {
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    borderColor: 'rgba(0, 255, 204, 0.3)',
  },
  coverBox: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1c1c22',
  },
  coverImg: {
    width: '100%',
    height: '100%',
  },
  coverPlayOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaBox: {
    flex: 1,
    marginLeft: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  songTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  masterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#00ffcc',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  masterBadgeText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  artistText: {
    color: '#888888',
    fontSize: 12,
    marginBottom: 2,
  },
  dateText: {
    color: '#55555c',
    fontSize: 11,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 10,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 30,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#121216',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#777777',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
