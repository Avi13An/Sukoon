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
  createPlaylist, 
  addTrackToPlaylist 
} from '../utils/storage';
import { showToast } from './ToastNotification';
import { SafeErrorBoundary } from './SafeErrorBoundary';
import { sanitizeTrack } from '../utils/trackSanitizer';

interface AddToPlaylistModalProps {
  visible: boolean;
  track: TrackMetadata | null;
  onClose: () => void;
}

export function AddToPlaylistModal({ visible, track, onClose }: AddToPlaylistModalProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const safeTrack = track ? sanitizeTrack(track) : null;

  useEffect(() => {
    if (visible) {
      setPlaylists(getCustomPlaylists());
      setNewPlaylistName('');
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

  const handleSelectPlaylist = (playlist: Playlist) => {
    if (!track) return;
    const added = addTrackToPlaylist(playlist.id, track);
    if (added) {
      showToast(`Added to "${playlist.name}"`, 'checkmark-circle');
    } else {
      showToast(`Already in "${playlist.name}"`, 'information-circle');
    }
    onClose();
  };

  const renderPlaylistItem = ({ item }: { item: Playlist }) => (
    <TouchableOpacity 
      style={styles.playlistItem} 
      activeOpacity={0.7}
      onPress={() => handleSelectPlaylist(item)}
    >
      <View style={styles.playlistIconContainer}>
        {item.coverImage ? (
          <Image source={{ uri: item.coverImage }} style={styles.playlistImage} />
        ) : (
          <Ionicons name="musical-notes" size={24} color="#888888" />
        )}
      </View>
      <View style={styles.playlistDetails}>
        <Text style={styles.playlistName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.playlistTrackCount}>
          {item.tracks.length} {item.tracks.length === 1 ? 'track' : 'tracks'}
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
  playlistName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
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
