import React, { useState, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  Image, 
  Modal, 
  TextInput, 
  Alert 
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { 
  getCustomPlaylists, 
  createPlaylist, 
  deletePlaylist, 
  getOfflineTracks, 
  Playlist, 
  OfflineTrack 
} from '../utils/storage';

export function LibraryScreen({ navigation }: any) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [downloadedTracks, setDownloadedTracks] = useState<OfflineTrack[]>([]);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

  const refreshLibrary = useCallback(() => {
    setPlaylists(getCustomPlaylists());
    const offlineDict = getOfflineTracks();
    setDownloadedTracks(Object.values(offlineDict));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLibrary();
    }, [refreshLibrary])
  );

  const navigateToPlaylist = (playlist: Playlist) => {
    navigation.navigate('PlaylistDetail', { playlist, playlistId: playlist.id });
  };

  const navigateToDownloads = () => {
    const downloadedPlaylist: Playlist = {
      id: 'downloads',
      name: 'Downloaded Tracks',
      createdAt: Date.now(),
      tracks: downloadedTracks,
    };
    navigation.navigate('PlaylistDetail', { playlist: downloadedPlaylist, playlistId: 'downloads' });
  };

  const handleCreatePlaylist = () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Please enter a playlist name.');
      return;
    }
    createPlaylist(trimmed, newPlaylistDesc.trim());
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setIsCreateModalVisible(false);
    refreshLibrary();
  };

  const handleDeletePlaylist = (playlist: Playlist) => {
    Alert.alert(
      'Delete Playlist',
      `Are you sure you want to delete "${playlist.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: () => {
            deletePlaylist(playlist.id);
            refreshLibrary();
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Your Library</Text>

      <TouchableOpacity style={styles.downloadCard} onPress={navigateToDownloads} activeOpacity={0.7}>
        <View style={styles.downloadIconPlaceholder}>
          <Ionicons name="arrow-down-circle" size={24} color="#00ffcc" />
        </View>
        <View style={styles.downloadInfo}>
          <Text style={styles.downloadTitle}>Downloaded Tracks</Text>
          <Text style={styles.downloadCount}>{downloadedTracks.length} offline tracks</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Playlists</Text>
        <TouchableOpacity 
          style={styles.newPlaylistBtn} 
          onPress={() => setIsCreateModalVisible(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={18} color="#000000" />
          <Text style={styles.newPlaylistBtnText}>New Playlist</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={styles.playlistCard} 
            onPress={() => navigateToPlaylist(item)}
            onLongPress={() => handleDeletePlaylist(item)}
            activeOpacity={0.8}
          >
            <View style={styles.playlistImageContainer}>
              {item.coverImage ? (
                <Image source={{ uri: item.coverImage }} style={styles.playlistImage} />
              ) : (
                <View style={styles.playlistPlaceholder}>
                  <Ionicons name="musical-notes" size={36} color="#555555" />
                </View>
              )}
              <TouchableOpacity 
                style={styles.deleteIconBtn}
                onPress={() => handleDeletePlaylist(item)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="trash-outline" size={16} color="#ff5252" />
              </TouchableOpacity>
            </View>
            <Text style={styles.playlistName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.playlistCount}>
              {item.tracks.length} {item.tracks.length === 1 ? 'track' : 'tracks'}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="albums-outline" size={48} color="#444444" />
            <Text style={styles.emptyText}>No custom playlists yet.</Text>
            <Text style={styles.emptySubtext}>Create one using "+ New Playlist" above!</Text>
          </View>
        }
      />

      {/* Create Playlist Modal */}
      {isCreateModalVisible && (
        <Modal
          visible={isCreateModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setIsCreateModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Create Playlist</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Playlist name"
                placeholderTextColor="#777777"
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
                autoFocus
              />
              <TextInput
                style={[styles.modalInput, styles.modalDescInput]}
                placeholder="Description (optional)"
                placeholderTextColor="#777777"
                value={newPlaylistDesc}
                onChangeText={setNewPlaylistDesc}
                multiline
              />
              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={() => setIsCreateModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.modalSubmit} 
                  onPress={handleCreatePlaylist}
                >
                  <Text style={styles.modalSubmitText}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    padding: 16,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    marginTop: 10,
  },
  downloadCard: {
    flexDirection: 'row',
    backgroundColor: '#141416',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#222224',
  },
  downloadIconPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#202024',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadInfo: {
    marginLeft: 16,
  },
  downloadTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  downloadCount: {
    color: '#888888',
    fontSize: 13,
    marginTop: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  newPlaylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00ffcc',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  newPlaylistBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  row: {
    justifyContent: 'space-between',
  },
  listContent: {
    paddingBottom: 24,
  },
  playlistCard: {
    width: '48%',
    backgroundColor: '#121214',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e1e20',
  },
  playlistImageContainer: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: '#1c1c20',
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  playlistImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  playlistPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e22',
  },
  deleteIconBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  playlistCount: {
    color: '#888888',
    fontSize: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#aaaaaa',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 12,
  },
  emptySubtext: {
    color: '#666666',
    fontSize: 13,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#18181c',
    borderRadius: 14,
    padding: 22,
    borderWidth: 1,
    borderColor: '#2c2c30',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#0c0c0e',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#2c2c30',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 15,
  },
  modalDescInput: {
    height: 70,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 12,
  },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalCancelText: {
    color: '#aaaaaa',
    fontSize: 15,
  },
  modalSubmit: {
    backgroundColor: '#00ffcc',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  modalSubmitText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
  },
});

