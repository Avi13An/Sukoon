import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  TextInput, 
  FlatList, 
  Image, 
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { 
  TrackMetadata, 
  Playlist, 
  getCustomPlaylists, 
  getCollaborativePlaylists,
  createPlaylist, 
  addTrackToPlaylist,
  onPlaylistsChanged 
} from '../utils/storage';
import { addTrackToCollaborativePlaylist } from '../services/collabPlaylistService';
import { showToast } from './ToastNotification';
import { SafeErrorBoundary } from './SafeErrorBoundary';
import { sanitizeTrack } from '../utils/trackSanitizer';

export interface PlaylistItem {
  id: string;
  name: string;
  tracks: TrackMetadata[];
  coverImage?: string;
  isCollaborative?: boolean;
  collaborators?: string[];
}

interface AddToPlaylistModalProps {
  visible: boolean;
  track: TrackMetadata | null;
  onClose: () => void;
}

export function AddToPlaylistModal({ visible, track, onClose }: AddToPlaylistModalProps) {
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const safeTrack = track ? sanitizeTrack(track) : null;

  useEffect(() => {
    if (visible) {
      const loadAll = () => {
        const personal: PlaylistItem[] = getCustomPlaylists().map((p) => ({
          id: p.id,
          name: p.name,
          tracks: p.tracks || [],
          coverImage: p.coverImage,
          isCollaborative: false,
        }));

        const collabs: PlaylistItem[] = getCollaborativePlaylists().map((c) => ({
          id: c.id,
          name: c.title,
          tracks: c.tracks || [],
          coverImage: undefined,
          isCollaborative: true,
          collaborators: c.collaborators || [],
        }));

        setPlaylists([...personal, ...collabs]);
      };

      loadAll();
      setNewPlaylistName('');

      const unsub = onPlaylistsChanged(() => {
        loadAll();
      });
      return unsub;
    }
  }, [visible]);

  const handleCreateAndAdd = () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) {
      showToast('Please enter a playlist name', 'alert-circle');
      return;
    }

    const newPlaylist = createPlaylist(trimmed);
    if (safeTrack) {
      addTrackToPlaylist(newPlaylist.id, safeTrack);
      showToast(`Created "${trimmed}" and added track`, 'checkmark-circle');
    } else {
      showToast(`Created playlist "${trimmed}"`, 'checkmark-circle');
    }

    setNewPlaylistName('');
    onClose();
  };

  const handleSelectPlaylist = async (playlist: PlaylistItem) => {
    if (!safeTrack) return;

    if (playlist.isCollaborative) {
      const added = await addTrackToCollaborativePlaylist(playlist.id, safeTrack);
      if (added) {
        showToast(`Added to shared "${playlist.name}"`, 'checkmark-circle');
      } else {
        showToast(`Already in shared "${playlist.name}"`, 'information-circle');
      }
    } else {
      const added = addTrackToPlaylist(playlist.id, safeTrack);
      if (added) {
        showToast(`Added to "${playlist.name}"`, 'checkmark-circle');
      } else {
        showToast(`Already in "${playlist.name}"`, 'information-circle');
      }
    }
    onClose();
  };

  const renderPlaylistItem = ({ item }: { item: PlaylistItem }) => (
    <TouchableOpacity 
      style={styles.playlistItem} 
      activeOpacity={0.7}
      onPress={() => handleSelectPlaylist(item)}
    >
      <View style={styles.playlistIconContainer}>
        {item.isCollaborative ? (
          <View style={[styles.playlistImage, { backgroundColor: '#131826', alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="people" size={24} color="#06B6D4" />
          </View>
        ) : item.coverImage ? (
          <Image source={{ uri: item.coverImage }} style={styles.playlistImage} />
        ) : (
          <Ionicons name="musical-notes" size={24} color="#888888" />
        )}
      </View>
      <View style={styles.playlistDetails}>
        <View style={styles.playlistTitleRow}>
          <Text style={styles.playlistName} numberOfLines={1}>{item.name}</Text>
          {item.isCollaborative && (
            <View style={styles.coopBadge}>
              <Ionicons name="people" size={10} color="#06B6D4" />
              <Text style={styles.coopBadgeText}>Co-op</Text>
            </View>
          )}
        </View>
        <Text style={styles.playlistTrackCount}>
          {item.tracks.length} {item.tracks.length === 1 ? 'track' : 'tracks'}
          {item.isCollaborative && item.collaborators && item.collaborators.length > 1 ? ` • @${item.collaborators[1]}` : ''}
        </Text>
      </View>
      <Ionicons name="add-circle-outline" size={24} color="#00ffcc" />
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeErrorBoundary fallbackName="AddToPlaylistModal" onReset={onClose}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.overlay}
        >
          <TouchableOpacity 
            style={styles.backdrop} 
            activeOpacity={1} 
            onPress={onClose} 
          />
          <View style={styles.sheetContainer}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.headerTitle}>Add to Playlist</Text>
                {safeTrack && (
                  <Text style={styles.headerSubtitle} numberOfLines={1}>
                    "{safeTrack.title}" - {safeTrack.artist}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {/* Create New Playlist Bar */}
            <View style={styles.createContainer}>
              <TextInput
                style={styles.createInput}
                placeholder="New playlist name..."
                placeholderTextColor="#777777"
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
                returnKeyType="done"
                onSubmitEditing={handleCreateAndAdd}
              />
              <TouchableOpacity 
                style={[styles.createBtn, !newPlaylistName.trim() && styles.createBtnDisabled]}
                onPress={handleCreateAndAdd}
                disabled={!newPlaylistName.trim()}
              >
                <Text style={styles.createBtnText}>Create</Text>
              </TouchableOpacity>
            </View>

            {/* Existing Playlists */}
            <Text style={styles.sectionTitle}>Your Playlists</Text>
            <FlatList
              data={playlists}
              keyExtractor={(item) => item.id}
              renderItem={renderPlaylistItem}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="albums-outline" size={40} color="#444444" />
                  <Text style={styles.emptyText}>No playlists yet. Create your first one above!</Text>
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </SafeErrorBoundary>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#161618',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    maxHeight: '75%',
    borderWidth: 1,
    borderColor: '#262628',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  headerLeft: {
    flex: 1,
    marginRight: 10,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#00ffcc',
    fontSize: 13,
    marginTop: 4,
  },
  closeBtn: {
    padding: 4,
  },
  createContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  createInput: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#ffffff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  createBtn: {
    backgroundColor: '#00ffcc',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: {
    backgroundColor: '#333333',
    opacity: 0.6,
  },
  createBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  sectionTitle: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  listContent: {
    paddingBottom: 16,
  },
  playlistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#262628',
  },
  playlistIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#262628',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  playlistImage: {
    width: '100%',
    height: '100%',
  },
  playlistDetails: {
    flex: 1,
    marginLeft: 14,
  },
  playlistTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coopBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  coopBadgeText: {
    color: '#06B6D4',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  playlistName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  playlistTrackCount: {
    color: '#888888',
    fontSize: 13,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: '#666666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
  },
});
