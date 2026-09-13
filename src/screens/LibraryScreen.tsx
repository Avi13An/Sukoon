import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  Image, 
  Modal, 
  TextInput, 
  Alert,
  RefreshControl,
  StatusBar,
  Platform,
  LayoutAnimation,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { 
  getCustomPlaylists, 
  getUserPlaylists,
  createPlaylist, 
  deletePlaylist, 
  leaveSharedPlaylist,
  renamePlaylist,
  getDownloadedTracks, 
  importPlaylistByCode,
  getPlaylistByShareCode,
  clonePlaylistToUser,
  getActiveUser,
  onPlaylistsChanged,
  isLikedSongsPlaylist,
  getCollaborativePlaylists,
  deleteCollaborativePlaylist,
  CollaborativePlaylist,
  Playlist, 
  DownloadedTrack
} from '../utils/storage';
import { useAmbientColor } from '../hooks/useAmbientColor';
import { getOfflineStorageUsage, logoutUser } from '../services/downloadService';
import { StudioRecordingsModal } from '../components/StudioRecordingsModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { RenamePlaylistModal } from '../components/RenamePlaylistModal';
import { getStudioRecordings } from '../services/recordingService';
import { showToast } from '../components/ToastNotification';
import { 
  fetchSharedPlaylistFromCloud, 
  importPlaylistByCode as importCloudPlaylist 
} from '../services/cloudPlaylistService';
import { createCollaborativePlaylist } from '../services/collabPlaylistService';

export function LibraryScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = (width - 56) / 2;
  const artHeight = cardWidth * 0.78;
  const ambientColor = useAmbientColor();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [collabPlaylists, setCollabPlaylists] = useState<CollaborativePlaylist[]>([]);
  const [activeTab, setActiveTab] = useState<'my_playlists' | 'shared_playlists'>('my_playlists');
  const [downloadedTracks, setDownloadedTracks] = useState<DownloadedTrack[]>([]);
  const [storageUsage, setStorageUsage] = useState<string>('0 MB');
  const [isStudioModalVisible, setIsStudioModalVisible] = useState(false);
  const [recordingCount, setRecordingCount] = useState<number>(0);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [isImportModalVisible, setIsImportModalVisible] = useState(false);
  const [importShareCode, setImportShareCode] = useState('');
  const [foundPreviewPlaylist, setFoundPreviewPlaylist] = useState<Playlist | null>(null);
  const [activeUsername, setActiveUsername] = useState<string | null>(getActiveUser());
  const profileInitial = useMemo(() => {
    return (activeUsername || 'User').charAt(0).toUpperCase();
  }, [activeUsername]);

  // Collab Playlist Creation State
  const [isCreateCollabModalVisible, setIsCreateCollabModalVisible] = useState(false);
  const [collabFriendUsername, setCollabFriendUsername] = useState('');
  const [collabTitle, setCollabTitle] = useState('');
  const [isCreatingCollab, setIsCreatingCollab] = useState(false);

  // Options Menu & Rename State
  const [selectedPlaylistForOptions, setSelectedPlaylistForOptions] = useState<{
    type: 'personal' | 'collab';
    playlist: Playlist | CollaborativePlaylist;
  } | null>(null);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    type: 'personal' | 'collab';
    id: string;
    initialTitle: string;
  } | null>(null);

  const refreshLibrary = useCallback(async () => {
    setActiveUsername(getActiveUser());
    setPlaylists(getUserPlaylists());
    setCollabPlaylists(getCollaborativePlaylists());
    const downloaded = getDownloadedTracks();
    setDownloadedTracks(downloaded);
    const usage = await getOfflineStorageUsage();
    setStorageUsage(usage.formattedSize);
    setRecordingCount(getStudioRecordings().length);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshLibrary();
    setIsRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      refreshLibrary();
    }, [refreshLibrary])
  );

  useEffect(() => {
    const unsub = onPlaylistsChanged(() => {
      refreshLibrary();
    });
    return unsub;
  }, [refreshLibrary]);

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

  const getCollaboratorName = (item: CollaborativePlaylist) => {
    const current = (activeUsername || '').toLowerCase();
    const peer = item.collaborators?.find(c => c.toLowerCase() !== current);
    return peer || item.collaborators?.[1] || 'Friend';
  };

  const handleCreateCollab = async () => {
    const friend = collabFriendUsername.trim();
    const title = collabTitle.trim();
    if (!friend) {
      showToast("Please enter your friend's username", 'alert-circle');
      return;
    }
    if (!title) {
      showToast('Please enter a playlist title', 'alert-circle');
      return;
    }
    setIsCreatingCollab(true);
    try {
      const created = await createCollaborativePlaylist(title, friend);
      setIsCreateCollabModalVisible(false);
      setCollabFriendUsername('');
      setCollabTitle('');
      refreshLibrary();
      navigation.navigate('PlaylistDetail', {
        isCollaborative: true,
        collabId: created.id,
        playlist: {
          id: created.id,
          name: created.title,
          shareCode: created.id,
          createdAt: created.updatedAt,
          tracks: created.tracks,
        },
      });
    } catch (err: any) {
      showToast(err?.message || 'Failed to create shared playlist', 'alert-circle');
    } finally {
      setIsCreatingCollab(false);
    }
  };

  const navigateToCollabPlaylist = (item: CollaborativePlaylist) => {
    navigation.navigate('PlaylistDetail', {
      isCollaborative: true,
      collabId: item.id,
      playlist: {
        id: item.id,
        name: item.title,
        shareCode: item.id,
        createdAt: item.updatedAt,
        tracks: item.tracks,
      },
    });
  };

  const handleOpenOptions = (item: Playlist | CollaborativePlaylist, type: 'personal' | 'collab') => {
    if (type === 'personal' && isLikedSongsPlaylist(item as Playlist)) {
      showToast('Liked Songs playlist is protected', 'shield-checkmark');
      return;
    }
    setSelectedPlaylistForOptions({ type, playlist: item });
  };

  const handleOpenRename = (item: Playlist | CollaborativePlaylist, type: 'personal' | 'collab') => {
    const title = type === 'personal' ? (item as Playlist).name : (item as CollaborativePlaylist).title;
    setRenameTarget({ type, id: item.id, initialTitle: title });
    setIsRenameModalVisible(true);
  };

  const handleSaveRename = async (newTitle: string) => {
    if (!renameTarget) return;
    const success = await renamePlaylist(renameTarget.id, newTitle);
    if (success) {
      if (renameTarget.type === 'personal') {
        setPlaylists(prev => prev.map(p => p.id === renameTarget.id ? { ...p, name: newTitle } : p));
      } else {
        setCollabPlaylists(prev => prev.map(p => p.id === renameTarget.id ? { ...p, title: newTitle } : p));
      }
      showToast(`Playlist renamed to "${newTitle}"`, 'checkmark-circle');
    } else {
      showToast('Failed to rename playlist', 'alert-circle');
    }
  };

  const handleLeavePlaylist = (item: Playlist | CollaborativePlaylist, type: 'personal' | 'collab') => {
    const title = type === 'personal' ? (item as Playlist).name : (item as CollaborativePlaylist).title;
    setConfirmModal({
      visible: true,
      title: 'Leave Playlist',
      message: 'Leave Playlist? This will remove it from your library. Collaborators will still have access.',
      confirmText: 'Leave',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: async () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        if (type === 'collab') {
          setCollabPlaylists(prev => prev.filter(p => p.id !== item.id));
        } else {
          setPlaylists(prev => prev.filter(p => p.id !== item.id));
        }
        await leaveSharedPlaylist(item.id);
        showToast(`Left "${title}"`, 'exit-outline');
      },
    });
  };

  const handleDeletePersonalPlaylist = (item: Playlist) => {
    if (isLikedSongsPlaylist(item)) {
      showToast('Liked Songs playlist cannot be deleted', 'shield-checkmark');
      return;
    }
    setConfirmModal({
      visible: true,
      title: 'Delete Playlist',
      message: `Are you sure you want to delete "${item.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPlaylists(prev => prev.filter(p => p.id !== item.id));
        deletePlaylist(item.id);
        showToast(`Deleted "${item.name}"`, 'trash-outline');
      },
    });
  };

  const handleDeleteCollabPlaylist = (item: CollaborativePlaylist) => {
    handleLeavePlaylist(item, 'collab');
  };

  const [isSearchingPlaylist, setIsSearchingPlaylist] = useState(false);

  const handleFindPlaylist = async () => {
    const code = importShareCode.trim().toUpperCase();
    if (!code) {
      showToast('Please enter a valid share code', 'alert-circle');
      return;
    }

    // 1. Check local device first
    let found = getPlaylistByShareCode(code);
    if (!found) {
      setIsSearchingPlaylist(true);
      try {
        found = (await fetchSharedPlaylistFromCloud(code)) || undefined;
      } catch (err) {
        console.warn('[LibraryScreen] Cloud playlist lookup warning:', err);
      } finally {
        setIsSearchingPlaylist(false);
      }
    }

    if (!found) {
      showToast('Playlist code not found. Please check the code.', 'alert-circle');
      return;
    }
    setFoundPreviewPlaylist(found);
  };

  const handleCopyEditable = () => {
    if (!foundPreviewPlaylist) return;
    const cloned = clonePlaylistToUser(foundPreviewPlaylist);
    setFoundPreviewPlaylist(null);
    setImportShareCode('');
    setIsImportModalVisible(false);
    refreshLibrary();
    showToast('Playlist copied! You can now freely add or remove songs.', 'copy-outline');
    navigation.navigate('PlaylistDetail', { playlist: cloned, playlistId: cloned.id });
  };

  const handleImportViewOnly = async () => {
    if (!foundPreviewPlaylist) return;
    try {
      const imported = await importCloudPlaylist(foundPreviewPlaylist.shareCode);
      setFoundPreviewPlaylist(null);
      setImportShareCode('');
      setIsImportModalVisible(false);
      refreshLibrary();
      showToast('Playlist imported as view-only.', 'download-outline');
      if (imported) {
        navigation.navigate('PlaylistDetail', { playlist: imported, playlistId: imported.id });
      }
    } catch {
      // Local fallback
      const imported = importPlaylistByCode(foundPreviewPlaylist.shareCode, foundPreviewPlaylist);
      setFoundPreviewPlaylist(null);
      setImportShareCode('');
      setIsImportModalVisible(false);
      refreshLibrary();
      showToast('Playlist imported as view-only.', 'download-outline');
      if (imported) {
        navigation.navigate('PlaylistDetail', { playlist: imported, playlistId: imported.id });
      }
    }
  };

  const handleCloseImportModal = () => {
    setIsImportModalVisible(false);
    setFoundPreviewPlaylist(null);
    setImportShareCode('');
  };

  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const handleDeletePlaylist = (playlist: Playlist) => {
    if (isLikedSongsPlaylist(playlist)) {
      showToast('Liked Songs playlist cannot be deleted', 'shield-checkmark');
      return;
    }
    setConfirmModal({
      visible: true,
      title: 'Delete Playlist',
      message: `Are you sure you want to delete "${playlist.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: () => {
        deletePlaylist(playlist.id);
        refreshLibrary();
        showToast(`Deleted "${playlist.name}"`, 'trash-outline');
      },
    });
  };

  const handleLogout = () => {
    setConfirmModal({
      visible: true,
      title: 'Log Out',
      message: 'Are you sure you want to log out? Local downloads will be cleared, but your playlists remain saved.',
      confirmText: 'Log Out',
      isDestructive: true,
      onConfirm: async () => {
        await logoutUser();
        showToast('Logged out successfully', 'log-out-outline');
        navigation.reset({
          index: 0,
          routes: [{ name: 'Auth' }],
        });
      },
    });
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      {/* Top Profile & Header Bar */}
      <View style={[styles.topProfileBar, { paddingTop: insets.top + 10 }]}>
        <View style={styles.topProfileLeft}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{profileInitial}</Text>
          </View>
          <Text style={styles.headerTitle}>Library</Text>
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

      {/* Quick Access Cards (50/50: Downloads & Studio) */}
      <View style={styles.quickAccessRow}>
        <TouchableOpacity 
          style={styles.quickAccessCardDownloads} 
          onPress={navigateToDownloads} 
          activeOpacity={0.75}
        >
          <View style={styles.quickAccessIconWrapCyan}>
            <Ionicons name="arrow-down-circle" size={24} color="#00ffcc" />
          </View>
          <View style={styles.quickAccessTextCol}>
            <Text style={styles.quickAccessTitle}>Downloads</Text>
            <Text style={styles.quickAccessSubtitle} numberOfLines={1}>
              {downloadedTracks.length} tracks
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.quickAccessCardStudio} 
          onPress={() => setIsStudioModalVisible(true)} 
          activeOpacity={0.75}
        >
          <View style={styles.quickAccessIconWrapRed}>
            <Ionicons name="mic" size={24} color="#ff4d4d" />
          </View>
          <View style={styles.quickAccessTextCol}>
            <Text style={styles.quickAccessTitle}>Studio</Text>
            <Text style={styles.quickAccessSubtitle} numberOfLines={1}>
              {recordingCount} takes
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Segmented Playlist Toggle Pill */}
      <View style={styles.segmentedToggleContainer}>
        <TouchableOpacity 
          style={[styles.segmentedTab, activeTab === 'my_playlists' && styles.segmentedTabActive]}
          onPress={() => setActiveTab('my_playlists')}
          activeOpacity={0.8}
        >
          <Ionicons 
            name="folder-outline" 
            size={14} 
            color={activeTab === 'my_playlists' ? '#000000' : '#888896'} 
          />
          <Text style={[styles.segmentedTabText, activeTab === 'my_playlists' && styles.segmentedTabTextActive]}>
            Playlists ({playlists.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.segmentedTab, activeTab === 'shared_playlists' && styles.segmentedTabActive]}
          onPress={() => setActiveTab('shared_playlists')}
          activeOpacity={0.8}
        >
          <Ionicons 
            name="people-outline" 
            size={14} 
            color={activeTab === 'shared_playlists' ? '#000000' : '#888896'} 
          />
          <Text style={[styles.segmentedTabText, activeTab === 'shared_playlists' && styles.segmentedTabTextActive]}>
            Shared ({collabPlaylists.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Playlists Header & Action Buttons */}
      {activeTab === 'my_playlists' ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Playlists</Text>
          <View style={styles.headerButtonsRow}>
            <TouchableOpacity 
              style={styles.importPlaylistBtn} 
              onPress={() => setIsImportModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="download-outline" size={15} color="#00ffcc" />
              <Text style={styles.importPlaylistBtnText}>Import</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.newPlaylistBtn} 
              onPress={() => setIsCreateModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={17} color="#000000" />
              <Text style={styles.newPlaylistBtnText}>New</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Shared Playlists</Text>
          <TouchableOpacity 
            style={styles.newCollabBtn} 
            onPress={() => setIsCreateCollabModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="people" size={15} color="#000000" />
            <Text style={styles.newCollabBtnText}>New</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderMyPlaylistItem = (item: Playlist) => {
    const isLiked = isLikedSongsPlaylist(item);

    if (isLiked) {
      return (
        <TouchableOpacity 
          style={[styles.playlistCard, { width: cardWidth }]} 
          onPress={() => navigateToPlaylist(item)}
          activeOpacity={0.8}
        >
          <View style={[styles.playlistImageContainer, styles.likedSongsCardBackdrop, { height: artHeight }]}>
            <LinearGradient
              colors={['#4a0a18', '#1e0836']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <View style={styles.likedHeartHalo}>
              <Ionicons name="heart" size={28} color="#ff3366" />
            </View>
            <View style={styles.likedProtectedBadge}>
              <Text style={styles.likedProtectedBadgeText}>Favorites</Text>
            </View>
          </View>
          <Text style={styles.playlistName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.playlistCount}>
            {item.tracks.length} {item.tracks.length === 1 ? 'track' : 'tracks'}
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity 
        style={[styles.playlistCard, { width: cardWidth }]} 
        onPress={() => navigateToPlaylist(item)}
        onLongPress={() => handleOpenOptions(item, 'personal')}
        activeOpacity={0.8}
      >
        <View style={[styles.playlistImageContainer, { height: artHeight }]}>
          {item.coverImage ? (
            <Image source={{ uri: item.coverImage }} style={styles.playlistImage} />
          ) : (
            <View style={styles.playlistPlaceholder}>
              <Ionicons name="musical-notes" size={26} color="#555555" />
            </View>
          )}
          {item.isImported && (
            <View style={styles.sharedBadge}>
              <Ionicons name="lock-closed" size={10} color="#000000" />
              <Text style={styles.sharedBadgeText}>Shared</Text>
            </View>
          )}
          <TouchableOpacity 
            style={styles.cardMenuBtn}
            onPress={() => handleOpenOptions(item, 'personal')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="ellipsis-vertical" size={14} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.playlistName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.playlistCount}>
          {item.tracks.length} {item.tracks.length === 1 ? 'track' : 'tracks'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderCollabPlaylistItem = (item: CollaborativePlaylist) => (
    <TouchableOpacity 
      style={[styles.playlistCard, { width: cardWidth }]} 
      onPress={() => navigateToCollabPlaylist(item)}
      onLongPress={() => handleOpenOptions(item, 'collab')}
      activeOpacity={0.8}
    >
      <View style={[styles.playlistImageContainer, { height: artHeight }]}>
        <View style={[styles.playlistPlaceholder, { backgroundColor: '#131826', borderColor: '#1F293D', borderWidth: 1 }]}>
          <Ionicons name="people" size={28} color="#06B6D4" />
        </View>
        <View style={styles.collabLiveBadge}>
          <View style={styles.greenDot} />
          <Text style={styles.collabLiveBadgeText}>Live Sync</Text>
        </View>
        <TouchableOpacity 
          style={styles.cardMenuBtn}
          onPress={() => handleOpenOptions(item, 'collab')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-vertical" size={14} color="#ffffff" />
        </TouchableOpacity>
      </View>
      <Text style={styles.playlistName} numberOfLines={1}>{item.title}</Text>
      <Text style={styles.collabSharedWithText} numberOfLines={1}>
        Shared with @{getCollaboratorName(item)}
      </Text>
      <Text style={styles.playlistCount}>
        {item.tracks?.length || 0} {item.tracks?.length === 1 ? 'track' : 'tracks'}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <LinearGradient
        colors={[ambientColor, 'rgba(7, 7, 9, 0.75)', '#070709']}
        locations={[0, 0.35, 0.85]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <FlatList
        key={activeTab}
        data={activeTab === 'my_playlists' ? (playlists as any[]) : (collabPlaylists as any[])}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#00ffcc"
            colors={['#00ffcc']}
          />
        }
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) =>
          activeTab === 'my_playlists'
            ? renderMyPlaylistItem(item as Playlist)
            : renderCollabPlaylistItem(item as CollaborativePlaylist)
        }
        ListEmptyComponent={
          activeTab === 'my_playlists' ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="albums-outline" size={48} color="#444444" />
              <Text style={styles.emptyText}>No custom playlists yet.</Text>
              <Text style={styles.emptySubtext}>Create one using "+ New" above!</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color="#444444" />
              <Text style={styles.emptyText}>No Shared Playlists Yet</Text>
              <Text style={styles.emptySubtext}>
                Create a collaborative playlist and invite a friend to add and listen together!
              </Text>
            </View>
          )
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
          onRequestClose={handleCloseImportModal}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              {!foundPreviewPlaylist ? (
                <>
                  <Text style={styles.modalTitle}>Import Shared Playlist</Text>
                  <Text style={styles.modalSubtitle}>Enter the unique SK-XXXXXX code shared with you:</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g. SK-8F3K9A"
                    placeholderTextColor="#777777"
                    value={importShareCode}
                    onChangeText={(text) => {
                      setImportShareCode(text);
                      const clean = text.trim().toUpperCase();
                      if (clean.length >= 6) {
                        const directFound = getPlaylistByShareCode(clean);
                        if (directFound) setFoundPreviewPlaylist(directFound);
                      }
                    }}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  <View style={styles.modalActions}>
                    <TouchableOpacity 
                      style={styles.modalCancel} 
                      onPress={handleCloseImportModal}
                    >
                      <Text style={styles.modalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.modalSubmit} 
                      onPress={handleFindPlaylist}
                    >
                      <Text style={styles.modalSubmitText}>Find Playlist</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={styles.previewContainer}>
                  <View style={styles.previewHeaderRow}>
                    <View style={styles.previewIconBox}>
                      <Ionicons name="musical-notes" size={26} color="#00ffcc" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={styles.codeBadge}>
                        <Text style={styles.codeBadgeText}>{foundPreviewPlaylist.shareCode}</Text>
                      </View>
                      <Text style={styles.previewTitle} numberOfLines={1}>
                        {foundPreviewPlaylist.name}
                      </Text>
                      <Text style={styles.previewSubtitle}>
                        {foundPreviewPlaylist.tracks.length} {foundPreviewPlaylist.tracks.length === 1 ? 'song' : 'songs'}
                      </Text>
                    </View>
                  </View>

                  {foundPreviewPlaylist.description ? (
                    <Text style={styles.previewDescription} numberOfLines={2}>
                      "{foundPreviewPlaylist.description}"
                    </Text>
                  ) : null}

                  {foundPreviewPlaylist.tracks.length > 0 && (
                    <View style={styles.previewTracksSnippet}>
                      <Text style={styles.previewTracksSnippetTitle}>Tracks include:</Text>
                      {foundPreviewPlaylist.tracks.slice(0, 3).map((t, i) => (
                        <Text key={`${t.id}-${i}`} style={styles.previewTrackItem} numberOfLines={1}>
                          • {t.title} <Text style={{ color: '#666670' }}>- {t.artist}</Text>
                        </Text>
                      ))}
                      {foundPreviewPlaylist.tracks.length > 3 && (
                        <Text style={styles.previewTrackMoreText}>
                          + {foundPreviewPlaylist.tracks.length - 3} more tracks
                        </Text>
                      )}
                    </View>
                  )}

                  <View style={styles.previewButtonsColumn}>
                    {/* Primary Button: Copy to My Library (Editable) */}
                    <TouchableOpacity 
                      style={styles.copyEditableBtn} 
                      onPress={handleCopyEditable}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="copy-outline" size={18} color="#000000" />
                      <Text style={styles.copyEditableBtnText}>Copy to My Library (Editable)</Text>
                    </TouchableOpacity>

                    {/* Secondary Button: View Only (Shared) */}
                    <TouchableOpacity 
                      style={styles.viewOnlyBtn} 
                      onPress={handleImportViewOnly}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="eye-outline" size={16} color="#aaaaaa" />
                      <Text style={styles.viewOnlyBtnText}>View Only (Shared)</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={styles.changeCodeBtn} 
                      onPress={() => setFoundPreviewPlaylist(null)}
                    >
                      <Text style={styles.changeCodeText}>Search Different Code</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Create Collaborative Playlist Modal */}
      {isCreateCollabModalVisible && (
        <Modal
          visible={isCreateCollabModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setIsCreateCollabModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <View style={styles.collabModalHeaderRow}>
                <Ionicons name="people" size={24} color="#06B6D4" />
                <Text style={[styles.modalTitle, { marginLeft: 8 }]}>New Shared Playlist</Text>
              </View>
              <Text style={styles.collabModalSubtitle}>
                Invite a friend to create a 2-user real-time playlist. Changes sync instantly on both phones!
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Friend's Username (e.g. alex)"
                placeholderTextColor="#777777"
                value={collabFriendUsername}
                onChangeText={setCollabFriendUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.modalInput}
                placeholder="Playlist Title (e.g. Road Trip Anthems)"
                placeholderTextColor="#777777"
                value={collabTitle}
                onChangeText={setCollabTitle}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={() => setIsCreateCollabModalVisible(false)}
                  disabled={isCreatingCollab}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalSubmit, { backgroundColor: '#06B6D4' }, isCreatingCollab && { opacity: 0.7 }]} 
                  onPress={handleCreateCollab}
                  disabled={isCreatingCollab}
                >
                  <Text style={[styles.modalSubmitText, { color: '#000000', fontWeight: '800' }]}>
                    {isCreatingCollab ? 'Creating...' : 'Create Shared'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <StudioRecordingsModal
        visible={isStudioModalVisible}
        onClose={() => {
          setIsStudioModalVisible(false);
          refreshLibrary();
        }}
      />

      <ConfirmModal
        visible={confirmModal.visible}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
        isDestructive={confirmModal.isDestructive}
        onConfirm={confirmModal.onConfirm}
        onClose={() => setConfirmModal(prev => ({ ...prev, visible: false }))}
      />

      {/* Options Menu Modal for Playlist Card */}
      {selectedPlaylistForOptions && (
        <Modal
          visible={Boolean(selectedPlaylistForOptions)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedPlaylistForOptions(null)}
        >
          <TouchableOpacity
            style={styles.optionsModalOverlay}
            activeOpacity={1}
            onPress={() => setSelectedPlaylistForOptions(null)}
          >
            <View style={styles.optionsMenuCard}>
              <View style={styles.optionsMenuHeader}>
                <Text style={styles.optionsMenuTitle} numberOfLines={1}>
                  {selectedPlaylistForOptions.type === 'personal'
                    ? (selectedPlaylistForOptions.playlist as Playlist).name
                    : (selectedPlaylistForOptions.playlist as CollaborativePlaylist).title}
                </Text>
              </View>

              {/* Rename Option */}
              <TouchableOpacity
                style={styles.optionsMenuItem}
                onPress={() => {
                  const target = selectedPlaylistForOptions;
                  setSelectedPlaylistForOptions(null);
                  handleOpenRename(target.playlist, target.type);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.optionsMenuIconBox}>
                  <Ionicons name="pencil-outline" size={18} color="#ffffff" />
                </View>
                <Text style={styles.optionsMenuItemText}>Rename</Text>
              </TouchableOpacity>

              {/* Leave (if collab or imported) or Delete (if personal) */}
              {selectedPlaylistForOptions.type === 'collab' || (selectedPlaylistForOptions.playlist as Playlist).isImported ? (
                <TouchableOpacity
                  style={styles.optionsMenuItem}
                  onPress={() => {
                    const target = selectedPlaylistForOptions;
                    setSelectedPlaylistForOptions(null);
                    handleLeavePlaylist(target.playlist, target.type);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.optionsMenuIconBox, { backgroundColor: 'rgba(255, 77, 77, 0.12)' }]}>
                    <Ionicons name="exit-outline" size={18} color="#ff4d4d" />
                  </View>
                  <Text style={[styles.optionsMenuItemText, { color: '#ff4d4d' }]}>Leave Playlist</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.optionsMenuItem}
                  onPress={() => {
                    const target = selectedPlaylistForOptions;
                    setSelectedPlaylistForOptions(null);
                    handleDeletePersonalPlaylist(target.playlist as Playlist);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.optionsMenuIconBox, { backgroundColor: 'rgba(255, 77, 77, 0.12)' }]}>
                    <Ionicons name="trash-outline" size={18} color="#ff4d4d" />
                  </View>
                  <Text style={[styles.optionsMenuItemText, { color: '#ff4d4d' }]}>Delete Playlist</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.optionsMenuCancelBtn}
                onPress={() => setSelectedPlaylistForOptions(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.optionsMenuCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Sleek Rename Modal */}
      <RenamePlaylistModal
        visible={isRenameModalVisible}
        initialTitle={renameTarget?.initialTitle || ''}
        onSave={handleSaveRename}
        onClose={() => {
          setIsRenameModalVisible(false);
          setRenameTarget(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070709',
  },
  headerContainer: {
    width: '100%',
    paddingBottom: 4,
  },
  topProfileBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  topProfileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 204, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#00ffcc',
    fontSize: 16,
    fontWeight: '800',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 60, 60, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 60, 60, 0.3)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 5,
  },
  logoutBtnText: {
    color: '#ff5252',
    fontSize: 12,
    fontWeight: '600',
  },
  quickAccessRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 14,
  },
  quickAccessCardDownloads: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.2)',
    borderRadius: 16,
    padding: 14,
    justifyContent: 'center',
  },
  quickAccessCardStudio: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 80, 80, 0.25)',
    borderRadius: 16,
    padding: 14,
    justifyContent: 'center',
  },
  quickAccessIconWrapCyan: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  quickAccessIconWrapRed: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 77, 77, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  livePulseDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ff3b30',
  },
  quickAccessTextCol: {
    gap: 2,
  },
  quickAccessTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  quickAccessSubtitle: {
    color: '#8e8e98',
    fontSize: 11,
    fontWeight: '500',
  },
  segmentedToggleContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 24,
    padding: 4,
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
  },
  segmentedTab: {
    flex: 1,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 20,
  },
  segmentedTabActive: {
    backgroundColor: '#00ffcc',
  },
  segmentedTabText: {
    color: '#888896',
    fontSize: 12,
    fontWeight: '600',
  },
  segmentedTabTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: '#888896',
    fontSize: 11,
    marginTop: 2,
  },
  headerButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  importPlaylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    gap: 4,
  },
  importPlaylistBtnText: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '700',
  },
  newPlaylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00ffcc',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    gap: 4,
  },
  newPlaylistBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  newCollabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00ffcc',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    gap: 4,
  },
  newCollabBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  columnWrapper: {
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  listContent: {
    paddingBottom: 24,
  },
  playlistCard: {
    marginBottom: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
    padding: 8,
  },
  playlistImageContainer: {
    width: '100%',
    borderRadius: 10,
    backgroundColor: '#121216',
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  likedSongsCardBackdrop: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    marginBottom: 8,
  },
  likedHeartHalo: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 51, 102, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  likedProtectedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(255, 51, 102, 0.25)',
    borderColor: '#ff3366',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  likedProtectedBadgeText: {
    color: '#ff3366',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  playlistImage: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  playlistPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121216',
  },
  deleteIconBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 0.1,
    marginBottom: 2,
  },
  playlistCount: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  sharedBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00ffcc',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  sharedBadgeText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '800',
  },
  collabLiveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 204, 0.2)',
    borderWidth: 1,
    borderColor: '#00ffcc',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00ffcc',
  },
  collabLiveBadgeText: {
    color: '#00ffcc',
    fontSize: 9,
    fontWeight: '800',
  },
  collabSharedWithText: {
    color: '#06B6D4',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
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
  previewContainer: {
    width: '100%',
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  previewIconBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.3)',
    marginBottom: 4,
  },
  codeBadgeText: {
    color: '#00ffcc',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  previewTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  previewSubtitle: {
    color: '#888896',
    fontSize: 13,
    marginTop: 2,
  },
  previewDescription: {
    color: '#aaaaaa',
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 14,
    lineHeight: 18,
  },
  previewTracksSnippet: {
    backgroundColor: '#101014',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#222228',
  },
  previewTracksSnippetTitle: {
    color: '#888896',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  previewTrackItem: {
    color: '#dddddd',
    fontSize: 13,
    marginBottom: 4,
  },
  previewTrackMoreText: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  previewButtonsColumn: {
    gap: 10,
  },
  copyEditableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00ffcc',
    paddingVertical: 13,
    borderRadius: 10,
    gap: 8,
  },
  copyEditableBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  viewOnlyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222228',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#303038',
    gap: 6,
  },
  viewOnlyBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  changeCodeBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 2,
  },
  changeCodeText: {
    color: '#888896',
    fontSize: 13,
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#131826',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  tabButtonActive: {
    backgroundColor: '#06B6D4',
  },
  tabButtonText: {
    color: '#888896',
    fontSize: 13,
    fontWeight: '600',
  },
  tabButtonTextActive: {
    color: '#000000',
    fontWeight: 'bold',
  },
  collabModalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  collabModalSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  cardMenuBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  optionsMenuCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#121216',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 12,
  },
  optionsMenuHeader: {
    paddingBottom: 14,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  optionsMenuTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  optionsMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  optionsMenuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionsMenuItemText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  optionsMenuCancelBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsMenuCancelText: {
    color: '#aaaaaa',
    fontSize: 14,
    fontWeight: '600',
  },
});

