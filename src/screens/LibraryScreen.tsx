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
  getDownloadedTracks, 
  importPlaylistByCode,
  getActiveUser,
  Playlist, 
  DownloadedTrack 
} from '../utils/storage';
import { getOfflineStorageUsage, logoutUser } from '../services/downloadService';
import { showToast } from '../components/ToastNotification';

export function LibraryScreen({ navigation }: any) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [downloadedTracks, setDownloadedTracks] = useState<DownloadedTrack[]>([]);
  const [storageUsage, setStorageUsage] = useState<string>('0 MB');
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [isImportModalVisible, setIsImportModalVisible] = useState(false);
  const [importShareCode, setImportShareCode] = useState('');
  const [activeUsername, setActiveUsername] = useState<string | null>(getActiveUser());

  const refreshLibrary = useCallback(async () => {
    setActiveUsername(getActiveUser());
    setPlaylists(getCustomPlaylists());
    const downloaded = getDownloadedTracks();
    setDownloadedTracks(downloaded);
    const usage = await getOfflineStorageUsage();
    setStorageUsage(usage.formattedSize);
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
      shareCode: 'DOWNLOADS',
      name: 'Downloaded Tracks',
      createdAt: Date.now(),
      tracks: downloadedTracks,
    };
    navigation.navigate('PlaylistDetail', { playlist: downloadedPlaylist, playlistId: 'downloads' });
  };

  const handleCreatePlaylist = () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) {
      showToast('Please enter a playlist name', 'alert-circle');
      return;
    }
    createPlaylist(trimmed, newPlaylistDesc.trim());
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setIsCreateModalVisible(false);
    refreshLibrary();
    showToast(`Playlist "${trimmed}" created!`, 'checkmark-circle');
  };

  const handleImportPlaylist = () => {
    const code = importShareCode.trim();
    if (!code) {
      showToast('Please enter a valid share code', 'alert-circle');
      return;
    }
    const imported = importPlaylistByCode(code);
    if (!imported) {
      showToast(`Playlist "${code.toUpperCase()}" not found`, 'alert-circle');
      return;
    }
    setImportShareCode('');
    setIsImportModalVisible(false);
    refreshLibrary();
    showToast(`"${imported.name}" imported as read-only!`, 'download-outline');
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
            showToast(`Deleted "${playlist.name}"`, 'trash-outline');
          }
        }
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out? Local downloads will be cleared, but your playlists remain saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Log Out', 
          style: 'destructive',
          onPress: async () => {
            await logoutUser();
            showToast('Logged out successfully', 'log-out-outline');
            navigation.reset({
              index: 0,
              routes: [{ name: 'Auth' }],
            });
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* User Profile Bar */}
      <View style={styles.topProfileRow}>
        <View style={styles.userProfileInfo}>
          <View style={styles.avatarIconBadge}>
            <Ionicons name="person" size={14} color="#00ffcc" />
          </View>
          <Text style={styles.profileUsernameText}>{activeUsername || 'User'}</Text>
        </View>
        <TouchableOpacity 
          style={styles.logoutBtn} 
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={15} color="#ff5252" />
          <Text style={styles.logoutBtnText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.headerTitle}>Your Library</Text>

      <TouchableOpacity style={styles.downloadCard} onPress={navigateToDownloads} activeOpacity={0.7}>
        <View style={styles.downloadIconPlaceholder}>
          <Ionicons name="arrow-down-circle" size={24} color="#00ffcc" />
        </View>
        <View style={styles.downloadInfo}>
          <Text style={styles.downloadTitle}>Downloaded Tracks</Text>
          <Text style={styles.downloadCount}>
            {downloadedTracks.length} offline tracks {downloadedTracks.length > 0 ? `• ${storageUsage}` : ''}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Playlists</Text>
        <View style={styles.headerButtonsRow}>
          <TouchableOpacity 
            style={styles.importPlaylistBtn} 
            onPress={() => setIsImportModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="download-outline" size={16} color="#00ffcc" />
            <Text style={styles.importPlaylistBtnText}>Import</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.newPlaylistBtn} 
            onPress={() => setIsCreateModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={18} color="#000000" />
            <Text style={styles.newPlaylistBtnText}>New</Text>
          </TouchableOpacity>
        </View>
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
            onLongPress={() => !item.isImported && handleDeletePlaylist(item)}
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
              {item.isImported ? (
                <View style={styles.sharedBadge}>
                  <Ionicons name="lock-closed" size={10} color="#000000" />
                  <Text style={styles.sharedBadgeText}>Shared / Read-Only</Text>
                </View>
              ) : (
                <TouchableOpacity 
                  style={styles.deleteIconBtn}
                  onPress={() => handleDeletePlaylist(item)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="trash-outline" size={16} color="#ff5252" />
                </TouchableOpacity>
              )}
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

      {/* Import Playlist Modal */}
      {isImportModalVisible && (
        <Modal
          visible={isImportModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setIsImportModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Import Shared Playlist</Text>
              <Text style={styles.modalSubtitle}>Enter the unique SK-XXXXXX code shared with you:</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. SK-8F3K9A"
                placeholderTextColor="#777777"
                value={importShareCode}
                onChangeText={setImportShareCode}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={() => setIsImportModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.modalSubmit} 
                  onPress={handleImportPlaylist}
                >
                  <Text style={styles.modalSubmitText}>Import</Text>
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
  topProfileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  userProfileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileUsernameText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 82, 82, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  logoutBtnText: {
    color: '#ff5252',
    fontSize: 12,
    fontWeight: '600',
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
  headerButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  importPlaylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181c',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#00ffcc',
    gap: 4,
  },
  importPlaylistBtnText: {
    color: '#00ffcc',
    fontSize: 13,
    fontWeight: '700',
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
  sharedBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00ffcc',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
  },
  sharedBadgeText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '800',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalSubtitle: {
    color: '#888896',
    fontSize: 13,
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

