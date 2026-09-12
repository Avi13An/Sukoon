import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Image,
  TextInput,
} from 'react-native';
import { TrackMetadata, isTrackInLikedSongs } from '../utils/storage';
import { sanitizeTrack } from '../utils/trackSanitizer';
import { SafeErrorBoundary } from './SafeErrorBoundary';
import { Ionicons } from '@expo/vector-icons';

interface TrackOptionsModalProps {
  visible: boolean;
  track: TrackMetadata | null;
  onClose: () => void;
  onPlayNow: (track: TrackMetadata) => void;
  onAddToPlaylist: (track: TrackMetadata) => void;
  onStartSync?: (track: TrackMetadata, username: string) => void;
  onSaveToLibrary?: (track: TrackMetadata) => void;
}

export function TrackOptionsModal({
  visible,
  track,
  onClose,
  onPlayNow,
  onAddToPlaylist,
  onStartSync,
  onSaveToLibrary,
}: TrackOptionsModalProps) {
  const [showSyncInput, setShowSyncInput] = useState(false);
  const [syncUsername, setSyncUsername] = useState('');

  if (!track) {
    return null;
  }

  const safe = sanitizeTrack(track);
  const isTrackLiked = safe.id ? isTrackInLikedSongs(safe.id) : false;

  const handleClose = () => {
    setShowSyncInput(false);
    setSyncUsername('');
    onClose();
  };

  const handlePlay = () => {
    handleClose();
    onPlayNow(safe);
  };

  const handleAddPlaylist = () => {
    handleClose();
    onAddToPlaylist(safe);
  };

  const handleSyncSubmit = () => {
    if (!syncUsername.trim()) return;
    const username = syncUsername.trim();
    handleClose();
    onStartSync?.(safe, username);
  };

  const handleSave = () => {
    handleClose();
    onSaveToLibrary?.(safe);
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <SafeErrorBoundary fallbackName="TrackOptionsModal" onReset={handleClose}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleClose}
        >
          <View style={styles.bottomSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.headerContainer}>
              {/* Absolutely centered title */}
              <View pointerEvents="none" style={styles.centeredTitleWrapper}>
                <Text style={styles.headerTitle}>Now Playing</Text>
              </View>

              {/* Left action placeholder */}
              <View style={styles.headerActionPlaceholder} />

              {/* Right action (close button) */}
              <TouchableOpacity 
                onPress={handleClose} 
                style={styles.headerAction}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#ffffff" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalHeader}>
              <Image
                source={{ uri: safe?.artwork || 'https://via.placeholder.com/150' }}
                style={styles.modalThumbnail}
              />
              <View style={styles.modalInfo}>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {safe?.title || 'Unknown Title'}
                </Text>
                <Text style={styles.modalArtist} numberOfLines={1}>
                  {safe?.artist || 'Unknown Artist'}
                </Text>
              </View>
            </View>

            <Pressable style={styles.actionButton} onPress={handlePlay}>
              <Ionicons name="play-circle-outline" size={20} color="#00ffcc" style={styles.actionIconVector} />
              <Text style={styles.actionText}>Play Now</Text>
            </Pressable>

            {onStartSync && (
              showSyncInput ? (
                <View style={styles.syncInputContainer}>
                  <TextInput
                    style={styles.syncInput}
                    placeholder="Friend's Username"
                    placeholderTextColor="#888"
                    value={syncUsername}
                    onChangeText={setSyncUsername}
                    autoCapitalize="none"
                  />
                  <Pressable style={styles.syncSubmitBtn} onPress={handleSyncSubmit}>
                    <Text style={styles.syncSubmitText}>Host</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={styles.actionButton}
                  onPress={() => setShowSyncInput(true)}
                >
                  <Ionicons name="radio-outline" size={20} color="#00ffcc" style={styles.actionIconVector} />
                  <Text style={styles.actionText}>Start Co-Sync Party</Text>
                </Pressable>
              )
            )}

            <Pressable style={styles.actionButton} onPress={handleAddPlaylist}>
              <Ionicons name="add-circle-outline" size={20} color="#ffffff" style={styles.actionIconVector} />
              <Text style={styles.actionText}>Add to Playlist</Text>
            </Pressable>

            {onSaveToLibrary && (
              <Pressable style={styles.actionButton} onPress={handleSave}>
                <Ionicons 
                  name={isTrackLiked ? "heart" : "heart-outline"} 
                  size={20} 
                  color={isTrackLiked ? "#ff3366" : "#ffffff"} 
                  style={styles.actionIconVector} 
                />
                <Text style={styles.actionText}>
                  {isTrackLiked ? 'Saved in Liked Songs' : 'Save to Library'}
                </Text>
              </Pressable>
            )}
          </View>
        </TouchableOpacity>
      </SafeErrorBoundary>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  headerContainer: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    position: 'relative',
    width: '100%',
    marginBottom: 8,
  },
  centeredTitleWrapper: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerAction: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  headerActionPlaceholder: {
    width: 36,
    height: 36,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    paddingBottom: 16,
  },
  modalThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 16,
  },
  modalInfo: {
    flex: 1,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  modalArtist: {
    color: '#aaaaaa',
    fontSize: 14,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  actionIcon: {
    fontSize: 18,
    marginRight: 16,
  },
  actionIconVector: {
    marginRight: 16,
    width: 24,
    textAlign: 'center',
  },
  actionText: {
    color: '#ffffff',
    fontSize: 16,
  },
  syncInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  syncInput: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  syncSubmitBtn: {
    backgroundColor: '#00ffcc',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  syncSubmitText: {
    color: '#000',
    fontWeight: 'bold',
  },
});
