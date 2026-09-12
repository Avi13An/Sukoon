import React, { useState, useCallback, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  TouchableOpacity, 
  ScrollView, 
  FlatList, 
  Dimensions, 
  TextInput, 
  Alert, 
  SafeAreaView, 
  StatusBar,
  Modal,
  useWindowDimensions,
  Platform
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { showToast } from '../components/ToastNotification';
import { 
  Playlist, 
  TrackMetadata, 
  getCustomPlaylists, 
  getUserPlaylists,
  deletePlaylist,
  deleteCollaborativePlaylist,
  getCollaborativePlaylists,
  leaveSharedPlaylist,
  renamePlaylist,
  removeTrackFromPlaylist, 
  getDownloadedTracks,
  clonePlaylistToUser,
  onPlaylistsChanged,
  isLikedSongsPlaylist,
} from '../utils/storage';
import { playTrack, addTracks, clearUpNextQueue, addToUpNextQueue, reorderNativeQueueFromUpNext } from '../services/TrackPlayerService';
import { downloadPlaylistTracks, deleteDownloadedTrack, getOfflineStorageUsage } from '../services/downloadService';
import { sharePlaylist } from '../services/cloudPlaylistService';
import { ConfirmModal } from '../components/ConfirmModal';
import { RenamePlaylistModal } from '../components/RenamePlaylistModal';
import { createPartyRoom } from '../services/partyService';
import { subscribeToCollabPlaylist, syncCollabTracks } from '../services/collabPlaylistService';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MiniPlayer } from '../components/MiniPlayer';

interface PlaylistScreenProps {
  route: any;
  navigation: any;
}

export type SmartShuffleMode = 'none' | 'soft_to_hype' | 'hype_to_soft' | 'artist_flow' | 'balanced';

const SOFT_KEYWORDS = ['acoustic', 'unplugged', 'chill', 'lofi', 'lo-fi', 'slow', 'reverb', 'sleep', 'relax', 'piano', 'ambient', 'sufi', 'sad', 'instrumental', 'peaceful', 'soothing'];
const HYPE_KEYWORDS = ['remix', 'beat', 'banger', 'bass', 'party', 'club', 'trap', 'edm', 'workout', 'dance', 'dhol', 'hard', 'hype', 'speed', 'energetic', 'dj'];

function getTrackEnergyScore(track: TrackMetadata): number {
  const text = `${track.title} ${track.artist}`.toLowerCase();
  let score = 0;
  SOFT_KEYWORDS.forEach(k => {
    if (text.includes(k)) score -= 2;
  });
  HYPE_KEYWORDS.forEach(k => {
    if (text.includes(k)) score += 2;
  });
  return score;
}

function applySmartShuffle(tracks: TrackMetadata[], mode: SmartShuffleMode): TrackMetadata[] {
  const copy = [...tracks];
  if (mode === 'none' || copy.length <= 1) return copy;

  if (mode === 'soft_to_hype') {
    return copy.sort((a, b) => getTrackEnergyScore(a) - getTrackEnergyScore(b));
  }

  if (mode === 'hype_to_soft') {
    return copy.sort((a, b) => getTrackEnergyScore(b) - getTrackEnergyScore(a));
  }

  if (mode === 'artist_flow') {
    const byArtist = new Map<string, TrackMetadata[]>();
    copy.forEach(t => {
      const art = t.artist || 'Unknown';
      if (!byArtist.has(art)) byArtist.set(art, []);
      byArtist.get(art)!.push(t);
    });
    const result: TrackMetadata[] = [];
    byArtist.forEach(list => {
      result.push(...list);
    });
    return result;
  }

  if (mode === 'balanced') {
    const shuffled = [...copy].sort(() => Math.random() - 0.5);
    const result: TrackMetadata[] = [];
    const pool = [...shuffled];

    while (pool.length > 0) {
      const lastArtist = result.length > 0 ? result[result.length - 1].artist : null;
      const candidateIdx = pool.findIndex(t => t.artist !== lastArtist);
      if (candidateIdx !== -1) {
        result.push(pool.splice(candidateIdx, 1)[0]);
      } else {
        result.push(pool.shift()!);
      }
    }
    return result;
  }

  return copy;
}

export function PlaylistScreen({ route, navigation }: PlaylistScreenProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const artworkSize = height < 700 
    ? Math.min(width * 0.45, 180) 
    : Math.min(width * 0.55, 220);
  const isStackedHeader = width < 450;
  const { totalBottomPadding } = useBottomClearance(32);
  const initialPlaylist: Playlist = route.params?.playlist || {
    id: 'unknown',
    shareCode: '',
    name: 'Playlist',
    createdAt: Date.now(),
    tracks: [],
  };
  const isCollaborative = Boolean(route.params?.isCollaborative);
  const collabId = route.params?.collabId || initialPlaylist.id;
  const playlistId = route.params?.playlistId || initialPlaylist.id;

  const [playlist, setPlaylist] = useState<Playlist>(initialPlaylist);
  const [originalTracks, setOriginalTracks] = useState<TrackMetadata[]>(initialPlaylist.tracks || []);
  const [shuffleMode, setShuffleMode] = useState<SmartShuffleMode>('none');
  const [isShuffleModalVisible, setIsShuffleModalVisible] = useState(false);
  const [storageSize, setStorageSize] = useState<string>('0 MB');
  const isShared = isCollaborative || Boolean(playlist.isImported);

  // Options Menu & Rename Modal State
  const [isOptionsMenuVisible, setIsOptionsMenuVisible] = useState(false);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);

  const handleSaveRename = async (newTitle: string) => {
    const targetId = isCollaborative ? collabId : playlist.id;
    const success = await renamePlaylist(targetId, newTitle);
    if (success) {
      setPlaylist(prev => ({ ...prev, name: newTitle }));
      showToast(`Playlist renamed to "${newTitle}"`, 'checkmark-circle');
    } else {
      showToast('Failed to rename playlist', 'alert-circle');
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (playlistId === 'downloads') {
        const downloaded = getDownloadedTracks();
        setPlaylist({
          id: 'downloads',
          shareCode: 'DOWNLOADS',
          name: 'Downloaded Tracks',
          description: 'Offline audio stored directly on device for fast, data-free listening.',
          createdAt: Date.now(),
          tracks: downloaded,
        });
        setOriginalTracks(downloaded);
        getOfflineStorageUsage().then(usage => setStorageSize(usage.formattedSize));
      } else if (playlistId) {
        if (isCollaborative) {
          const foundCollab = getCollaborativePlaylists().find(p => p.id === collabId);
          if (foundCollab) {
            setPlaylist(prev => ({ ...prev, name: foundCollab.title, tracks: foundCollab.tracks }));
            setOriginalTracks(foundCollab.tracks || []);
          }
        } else {
          const found = getUserPlaylists().find(p => p.id === playlistId);
          if (found) {
            setPlaylist(found);
            setOriginalTracks(found.tracks || []);
          }
        }
      }
    }, [playlistId, isCollaborative, collabId])
  );

  // Local storage listener for standard & collaborative playlists
  useEffect(() => {
    const unsub = onPlaylistsChanged(() => {
      if (playlistId === 'downloads') return;
      if (isCollaborative) {
        const found = getCollaborativePlaylists().find(p => p.id === collabId);
        if (found) {
          setPlaylist(prev => ({ ...prev, name: found.title, tracks: found.tracks }));
          setOriginalTracks(found.tracks || []);
        }
      } else {
        const found = getUserPlaylists().find(p => p.id === playlistId);
        if (found) {
          setPlaylist(found);
          setOriginalTracks(found.tracks || []);
        }
      }
    });
    return unsub;
  }, [playlistId, isCollaborative, collabId]);

  // Real-time listener for collaborative playlists
  useEffect(() => {
    if (isCollaborative && collabId) {
      console.log(`[PlaylistScreen] Subscribing to collaborative playlist: ${collabId}`);
      const unsubscribe = subscribeToCollabPlaylist(
        collabId, 
        (updatedTracks) => {
          console.log(`[PlaylistScreen] Received live collab update (${updatedTracks.length} tracks)`);
          setPlaylist(prev => ({ ...prev, tracks: updatedTracks }));
          setOriginalTracks(updatedTracks);
        },
        (newTitle) => {
          console.log(`[PlaylistScreen] Received live collab rename: ${newTitle}`);
          setPlaylist(prev => ({ ...prev, name: newTitle }));
        }
      );
      return () => {
        unsubscribe();
      };
    }
  }, [isCollaborative, collabId]);

  const [shareUsername, setShareUsername] = useState('');
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);

  const handlePlayAll = async () => {
    if (!playlist.tracks || playlist.tracks.length === 0) {
      showToast('No tracks in this playlist to play', 'alert-circle');
      return;
    }

    await playTrack(playlist.tracks[0], playlist.tracks.slice(1));
  };

  const handleShuffle = async () => {
    if (!playlist.tracks || playlist.tracks.length === 0) {
      showToast('No tracks in this playlist to shuffle', 'alert-circle');
      return;
    }

    const shuffled = [...playlist.tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    setPlaylist(prev => ({ ...prev, tracks: shuffled }));
    setShuffleMode('balanced');
    showToast('Playlist shuffled', 'shuffle');

    await playTrack(shuffled[0], shuffled.slice(1));
  };

  const handleSelectShuffleMode = async (mode: SmartShuffleMode) => {
    setShuffleMode(mode);
    setIsShuffleModalVisible(false);
    if (!playlist.tracks || playlist.tracks.length === 0) return;

    let sorted = applySmartShuffle(originalTracks, mode);
    if (mode === 'balanced') {
      const shuffled = [...sorted];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      sorted = shuffled;
    }

    setPlaylist(prev => ({ ...prev, tracks: sorted }));

    const modeNames: Record<SmartShuffleMode, string> = {
      none: 'Original Order',
      soft_to_hype: 'Soft to Hype 🌿',
      hype_to_soft: 'Hype to Soft 🔥',
      artist_flow: 'Artist Flow 🎤',
      balanced: 'Smart Balanced ⚖️',
    };
    showToast(`Smart Shuffle: ${modeNames[mode]}`, 'shuffle');

    await playTrack(sorted[0], sorted.slice(1));
  };

  const handleResetShuffle = async () => {
    setShuffleMode('none');
    setPlaylist(prev => ({ ...prev, tracks: [...originalTracks] }));
    clearUpNextQueue();
    originalTracks.slice(1).forEach(t => addToUpNextQueue(t));
    await reorderNativeQueueFromUpNext();
    showToast('Restored original playlist order', 'refresh-outline');
  };

  const handleDownloadAll = () => {
    if (playlist.tracks.length > 0) {
      downloadPlaylistTracks(playlist.tracks);
      Alert.alert('Downloading', `Started downloading ${playlist.tracks.length} tracks.`);
    } else {
      Alert.alert('Empty Playlist', 'No tracks to download.');
    }
  };

  const handleShare = async () => {
    try {
      const code = await sharePlaylist(playlist);
      await Clipboard.setStringAsync(code);
      setIsShareModalVisible(false);
      setShareUsername('');
      showToast(`Playlist shared! Code ${code} copied!`, 'checkmark-circle');
    } catch (e: any) {
      showToast(e?.message || 'Failed to share playlist', 'alert-circle');
    }
  };

  const handleCopyShareCode = async () => {
    try {
      const code = await sharePlaylist(playlist);
      await Clipboard.setStringAsync(code);
      showToast(`Share code ${code} copied!`, 'copy-outline');
    } catch {
      if (playlist.shareCode) {
        await Clipboard.setStringAsync(playlist.shareCode);
        showToast(`Share code ${playlist.shareCode} copied!`, 'copy-outline');
      }
    }
  };

  const handleStartJam = async () => {
    try {
      const code = await createPartyRoom();
      await Clipboard.setStringAsync(code);
      showToast(`Sukoon Jam started! Code ${code} copied!`, 'radio');
      if (playlist.tracks && playlist.tracks.length > 0) {
        await playTrack(playlist.tracks[0], playlist.tracks.slice(1));
      }
    } catch (err: any) {
      showToast('Failed to start Sukoon Jam', 'alert-circle');
    }
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

  const isProtectedPlaylist = isLikedSongsPlaylist(playlist) || playlistId === 'downloads';

  const handleDeletePlaylist = () => {
    if (isProtectedPlaylist) {
      showToast('This playlist cannot be deleted', 'shield-checkmark');
      return;
    }

    if (isCollaborative) {
      setConfirmModal({
        visible: true,
        title: 'Delete Shared Playlist',
        message: `Are you sure you want to delete "${playlist.name}"? It will be removed from your shared playlists.`,
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: () => {
          deleteCollaborativePlaylist(collabId);
          showToast(`Deleted shared playlist "${playlist.name}"`, 'trash-outline');
          navigation.goBack();
        },
      });
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
        showToast(`Deleted "${playlist.name}"`, 'trash-outline');
        navigation.goBack();
      },
    });
  };

  const handleDuplicateToMyLibrary = () => {
    setConfirmModal({
      visible: true,
      title: 'Duplicate to My Account',
      message: `Create an independent, fully editable copy of "${playlist.name}" in your library?`,
      confirmText: 'Copy & Open',
      isDestructive: false,
      onConfirm: () => {
        const cloned = clonePlaylistToUser(playlist);
        showToast('Created editable copy in your library!', 'copy-outline');
        setPlaylist(cloned);
        setOriginalTracks(cloned.tracks || []);
        setShuffleMode('none');
        if (typeof navigation.replace === 'function') {
          navigation.replace('PlaylistDetail', { playlist: cloned, playlistId: cloned.id });
        } else {
          navigation.navigate('PlaylistDetail', { playlist: cloned, playlistId: cloned.id });
        }
      },
    });
  };

  const handlePlayTrack = (track: TrackMetadata) => {
    const idx = playlist.tracks.findIndex(t => t.id === track.id);
    const remaining = idx !== -1 ? playlist.tracks.slice(idx + 1) : playlist.tracks;
    playTrack(track, remaining);
  };

  const handleRemoveTrack = (track: TrackMetadata) => {
    if (playlist.isImported && !isCollaborative) return;
    const isDownloads = playlistId === 'downloads';
    setConfirmModal({
      visible: true,
      title: isDownloads ? 'Delete Download' : 'Remove Track',
      message: isDownloads 
        ? `Delete "${track.title}" from device storage?` 
        : `Remove "${track.title}" from "${playlist.name}"?`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        if (isDownloads) {
          await deleteDownloadedTrack(track.id);
          const usage = await getOfflineStorageUsage();
          setStorageSize(usage.formattedSize);
          showToast(`Deleted "${track.title}" from offline downloads`, 'trash-outline');
        } else if (isCollaborative) {
          const updated = playlist.tracks.filter(t => t.id !== track.id);
          setPlaylist(prev => ({ ...prev, tracks: updated }));
          setOriginalTracks(updated);
          await syncCollabTracks(collabId, updated);
          showToast(`Removed from shared playlist`, 'trash-outline');
          return;
        } else {
          removeTrackFromPlaylist(playlist.id, track.id);
          showToast(`Removed from "${playlist.name}"`, 'trash-outline');
        }
        setPlaylist(prev => ({
          ...prev,
          tracks: prev.tracks.filter(t => t.id !== track.id)
        }));
      },
    });
  };

  const createdDateStr = playlist.createdAt 
    ? new Date(playlist.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const renderItem = ({ item }: { item: TrackMetadata }) => (
    <View style={styles.trackItem}>
      <TouchableOpacity 
        style={styles.trackMainTouch} 
        onPress={() => handlePlayTrack(item)}
        activeOpacity={0.7}
      >
        <Image 
          source={{ uri: item.artwork || 'https://via.placeholder.com/50' }} 
          style={styles.trackImage} 
        />
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text>
        </View>
      </TouchableOpacity>
      {(!playlist.isImported || isCollaborative) && (
        <TouchableOpacity 
          style={styles.removeBtn} 
          onPress={() => handleRemoveTrack(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={18} color="#ff5252" />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      {/* Top Navigation Bar with Dynamic Safe Insets */}
      <View style={[styles.topBar, { paddingTop: insets.top + (Platform.OS === 'android' ? 8 : 4) }]}>
        <TouchableOpacity 
          style={styles.topBarBackBtn} 
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {playlist.name}
        </Text>
        <View style={styles.topBarRightActions}>
          <TouchableOpacity 
            style={styles.topBarShuffleBtn} 
            onPress={handleShuffle}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="shuffle" size={20} color={shuffleMode !== 'none' ? '#06B6D4' : '#ffffff'} />
          </TouchableOpacity>
          {playlistId !== 'downloads' && !isLikedSongsPlaylist(playlist) && (
            <TouchableOpacity 
              style={styles.topBarFrostedBtn} 
              onPress={() => setIsOptionsMenuVisible(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color="#ffffff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={playlist.tracks}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 90 }
        ]}
        ListHeaderComponent={
          <View style={styles.listHeaderWrapper}>
            {/* Fluid Responsive Header Card */}
            <View style={[styles.headerCard, isStackedHeader && styles.headerCardStacked]}>
              {playlist.coverImage ? (
                <Image 
                  source={{ uri: playlist.coverImage }} 
                  style={[styles.headerArtwork, { width: artworkSize, height: artworkSize }]} 
                />
              ) : (
                <View style={[styles.headerPlaceholder, { width: artworkSize, height: artworkSize }]}>
                  <Ionicons 
                    name={isCollaborative ? "people" : isLikedSongsPlaylist(playlist) ? "heart" : "musical-notes"} 
                    size={Math.min(artworkSize * 0.4, 48)} 
                    color={isCollaborative ? "#06B6D4" : isLikedSongsPlaylist(playlist) ? "#FF3B30" : "#38BDF8"} 
                  />
                </View>
              )}
              
              <View style={[styles.headerInfoCol, isStackedHeader && styles.headerInfoColStacked]}>
                {isCollaborative && (
                  <View style={[styles.collabHeaderBadge, isStackedHeader && { alignSelf: 'center' }]}>
                    <View style={styles.greenLiveDot} />
                    <Text style={styles.collabHeaderBadgeText}>Live Shared Playlist</Text>
                  </View>
                )}

                {playlist.isImported && !isCollaborative && (
                  <View style={[styles.viewOnlyBadge, isStackedHeader && { alignSelf: 'center' }]}>
                    <Ionicons name="lock-closed" size={11} color="#06B6D4" />
                    <Text style={styles.viewOnlyBadgeText}>Shared (View Only)</Text>
                  </View>
                )}

                <Text style={[styles.headerTitle, isStackedHeader && { textAlign: 'center' }]} numberOfLines={2}>
                  {playlist.name}
                </Text>

                {playlist.description ? (
                  <Text style={[styles.headerDesc, isStackedHeader && { textAlign: 'center' }]} numberOfLines={2}>
                    {playlist.description}
                  </Text>
                ) : null}

                <View style={[styles.metadataRow, isStackedHeader && { justifyContent: 'center' }]}>
                  <Text style={styles.metadataText}>
                    {playlist.tracks.length} {playlist.tracks.length === 1 ? 'track' : 'tracks'}
                    {playlistId === 'downloads' 
                      ? ` • ${storageSize} Offline` 
                      : createdDateStr ? ` • ${createdDateStr}` : ''}
                  </Text>
                </View>
              </View>
            </View>

            {/* View-Only Warning Banner */}
            {playlist.isImported && !isCollaborative && (
              <View style={styles.duplicateBanner}>
                <View style={styles.duplicateBannerHeader}>
                  <View style={styles.duplicateIconCircle}>
                    <Ionicons name="copy-outline" size={18} color="#06B6D4" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.duplicateBannerTitle}>Shared Playlist (View Only)</Text>
                    <Text style={styles.duplicateBannerSubtitle}>
                      Make an independent copy to add, remove, or reorder tracks.
                    </Text>
                  </View>
                </View>
                <TouchableOpacity 
                  style={styles.duplicateBannerBtn} 
                  onPress={handleDuplicateToMyLibrary} 
                  activeOpacity={0.8}
                >
                  <Ionicons name="duplicate" size={16} color="#000000" />
                  <Text style={styles.duplicateBannerBtnText}>Duplicate to My Account</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Horizontal Scrollable Action Buttons Bar */}
            <View style={styles.actionsBarWrapper}>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                contentContainerStyle={styles.actionsBarScroll}
              >
                {/* Primary Play Button */}
                <TouchableOpacity 
                  style={styles.primaryPlayBtn} 
                  onPress={handlePlayAll} 
                  activeOpacity={0.8}
                >
                  <Ionicons name="play" size={18} color="#000000" />
                  <Text style={styles.primaryPlayBtnText}>Play All</Text>
                </TouchableOpacity>

                {/* Smart Shuffle */}
                <TouchableOpacity 
                  style={[styles.secondaryPill, shuffleMode !== 'none' && styles.secondaryPillActive]} 
                  onPress={handleShuffle} 
                  onLongPress={() => setIsShuffleModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons 
                    name="shuffle" 
                    size={16} 
                    color={shuffleMode !== 'none' ? '#06B6D4' : '#E2E8F0'} 
                  />
                  <Text style={[styles.secondaryPillText, shuffleMode !== 'none' && { color: '#06B6D4' }]}>
                    {shuffleMode !== 'none' ? 'Shuffled' : 'Shuffle'}
                  </Text>
                </TouchableOpacity>

                {shuffleMode !== 'none' && (
                  <TouchableOpacity 
                    style={styles.secondaryPill} 
                    onPress={handleResetShuffle} 
                    activeOpacity={0.7}
                  >
                    <Ionicons name="refresh" size={15} color="#E2E8F0" />
                    <Text style={styles.secondaryPillText}>Reset</Text>
                  </TouchableOpacity>
                )}

                {/* Share Code */}
                {playlistId !== 'downloads' && (
                  <TouchableOpacity 
                    style={styles.secondaryPill} 
                    onPress={handleCopyShareCode} 
                    activeOpacity={0.7}
                  >
                    <Ionicons name="share-outline" size={16} color="#E2E8F0" />
                    <Text style={styles.secondaryPillText}>Share Code</Text>
                  </TouchableOpacity>
                )}

                {/* Add Song */}
                {!playlist.isImported && (
                  <TouchableOpacity 
                    style={styles.secondaryPill} 
                    onPress={() => {
                      navigation.navigate('Search');
                      showToast('Search for tracks and tap "Add to Playlist"', 'search');
                    }} 
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add-circle-outline" size={16} color="#E2E8F0" />
                    <Text style={styles.secondaryPillText}>Add Song</Text>
                  </TouchableOpacity>
                )}

                {/* Sukoon Jam */}
                <TouchableOpacity 
                  style={styles.secondaryPill} 
                  onPress={handleStartJam} 
                  activeOpacity={0.7}
                >
                  <Ionicons name="radio-outline" size={16} color="#06B6D4" />
                  <Text style={styles.secondaryPillText}>Sukoon Jam</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="musical-note-outline" size={48} color="#4A5568" />
            <Text style={styles.emptyText}>This playlist is empty</Text>
            <Text style={styles.emptySubtext}>Search and add songs to start listening</Text>
          </View>
        }
      />

      {isShareModalVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Share Playlist</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter target username"
              placeholderTextColor="#888888"
              value={shareUsername}
              onChangeText={setShareUsername}
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setIsShareModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSubmit} onPress={handleShare}>
                <Text style={styles.modalSubmitText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Smart AI Shuffle Modal */}
      {isShuffleModalVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.sparkleBadge}>
                <Ionicons name="sparkles" size={18} color="#06B6D4" />
              </View>
              <Text style={styles.modalTitle}>Smart AI Shuffle</Text>
            </View>
            <Text style={styles.modalSubtitle}>Select an intelligent sequencing flow for this playlist:</Text>

            <View style={styles.shuffleModesList}>
              <TouchableOpacity 
                style={[styles.shuffleModeItem, shuffleMode === 'soft_to_hype' && styles.shuffleModeItemActive]}
                onPress={() => handleSelectShuffleMode('soft_to_hype')}
                activeOpacity={0.7}
              >
                <View style={styles.shuffleModeIconBox}>
                  <Text style={{ fontSize: 18 }}>🌿</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shuffleModeTitle}>Soft to Hype</Text>
                  <Text style={styles.shuffleModeDesc}>Gradually builds energy from acoustic/chill to upbeat bangers</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.shuffleModeItem, shuffleMode === 'hype_to_soft' && styles.shuffleModeItemActive]}
                onPress={() => handleSelectShuffleMode('hype_to_soft')}
                activeOpacity={0.7}
              >
                <View style={styles.shuffleModeIconBox}>
                  <Text style={{ fontSize: 18 }}>🔥</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shuffleModeTitle}>Hype to Soft</Text>
                  <Text style={styles.shuffleModeDesc}>High octane party starters easing down to chillout vibes</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.shuffleModeItem, shuffleMode === 'artist_flow' && styles.shuffleModeItemActive]}
                onPress={() => handleSelectShuffleMode('artist_flow')}
                activeOpacity={0.7}
              >
                <View style={styles.shuffleModeIconBox}>
                  <Text style={{ fontSize: 18 }}>🎤</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shuffleModeTitle}>Artist Flow</Text>
                  <Text style={styles.shuffleModeDesc}>Clusters songs by artist for seamless discography</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.shuffleModeItem, shuffleMode === 'balanced' && styles.shuffleModeItemActive]}
                onPress={() => handleSelectShuffleMode('balanced')}
                activeOpacity={0.7}
              >
                <View style={styles.shuffleModeIconBox}>
                  <Text style={{ fontSize: 18 }}>⚖️</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shuffleModeTitle}>Smart Balanced</Text>
                  <Text style={styles.shuffleModeDesc}>Balanced distribution with no consecutive artist repeats</Text>
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={styles.closeShuffleModalBtn} 
              onPress={() => setIsShuffleModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.closeShuffleModalText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Options Menu Modal */}
      <Modal
        visible={isOptionsMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOptionsMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.optionsModalOverlay}
          activeOpacity={1}
          onPress={() => setIsOptionsMenuVisible(false)}
        >
          <View style={styles.optionsMenuCard}>
            <View style={styles.optionsMenuHeader}>
              <Text style={styles.optionsMenuTitle} numberOfLines={1}>
                {playlist.name}
              </Text>
            </View>

            {/* Rename Option */}
            <TouchableOpacity
              style={styles.optionsMenuItem}
              onPress={() => {
                setIsOptionsMenuVisible(false);
                setIsRenameModalVisible(true);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.optionsMenuIconBox}>
                <Ionicons name="pencil-outline" size={18} color="#ffffff" />
              </View>
              <Text style={styles.optionsMenuItemText}>Rename Playlist</Text>
            </TouchableOpacity>

            {/* Leave (if shared) or Delete (if personal) */}
            {isShared ? (
              <TouchableOpacity
                style={styles.optionsMenuItem}
                onPress={() => {
                  setIsOptionsMenuVisible(false);
                  setConfirmModal({
                    visible: true,
                    title: 'Leave Playlist',
                    message: 'Leave Playlist? This will remove it from your library. Collaborators will still have access.',
                    confirmText: 'Leave',
                    cancelText: 'Cancel',
                    isDestructive: true,
                    onConfirm: async () => {
                      await leaveSharedPlaylist(isCollaborative ? collabId : playlist.id);
                      showToast(`Left "${playlist.name}"`, 'exit-outline');
                      navigation.goBack();
                    },
                  });
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
                  setIsOptionsMenuVisible(false);
                  setConfirmModal({
                    visible: true,
                    title: 'Delete Playlist',
                    message: `Are you sure you want to delete "${playlist.name}"? This action cannot be undone.`,
                    confirmText: 'Delete',
                    cancelText: 'Cancel',
                    isDestructive: true,
                    onConfirm: () => {
                      deletePlaylist(playlist.id);
                      showToast(`Deleted "${playlist.name}"`, 'trash-outline');
                      navigation.goBack();
                    },
                  });
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
              onPress={() => setIsOptionsMenuVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.optionsMenuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Sleek Rename Modal */}
      <RenamePlaylistModal
        visible={isRenameModalVisible}
        initialTitle={playlist.name}
        onSave={handleSaveRename}
        onClose={() => setIsRenameModalVisible(false)}
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

      {/* Floating MiniPlayer */}
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#000000',
  },
  topBarBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#131826',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  topBarTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  topBarRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topBarShuffleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#131826',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  topBarFrostedBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  listContent: {
    paddingBottom: 60,
  },
  listHeaderWrapper: {
    marginBottom: 8,
  },
  headerCard: {
    flexDirection: 'row',
    backgroundColor: '#0B0F19',
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1F293D',
    alignItems: 'center',
  },
  headerCardStacked: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 18,
  },
  headerInfoColStacked: {
    marginLeft: 0,
    marginTop: 14,
    alignItems: 'center',
    width: '100%',
  },
  headerArtwork: {
    width: 120,
    height: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  headerPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F293D',
    backgroundColor: '#131826',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfoCol: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  collabHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderColor: '#06B6D4',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 6,
    gap: 5,
  },
  greenLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  collabHeaderBadgeText: {
    color: '#06B6D4',
    fontSize: 10,
    fontWeight: '800',
  },
  viewOnlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
    marginBottom: 6,
    gap: 4,
  },
  viewOnlyBadgeText: {
    color: '#06B6D4',
    fontSize: 11,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    flexShrink: 1,
    marginBottom: 4,
  },
  headerDesc: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  metadataText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  actionsBarWrapper: {
    marginBottom: 10,
  },
  actionsBarScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  primaryPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#06B6D4',
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 6,
  },
  primaryPlayBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  secondaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131826',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#222D44',
    paddingVertical: 9,
    paddingHorizontal: 16,
    gap: 6,
  },
  secondaryPillActive: {
    borderColor: '#06B6D4',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
  },
  secondaryPillText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  headerSeparator: {
    height: 1,
    backgroundColor: '#161E2E',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  trackMainTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#131826',
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  trackArtist: {
    color: '#888896',
    fontSize: 13,
  },
  removeBtn: {
    padding: 8,
    marginLeft: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
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
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 30,
    lineHeight: 18,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#131826',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#222D44',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#0B0F19',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#222D44',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
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
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: '#06B6D4',
    borderRadius: 8,
  },
  modalSubmitText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 15,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sparkleBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubtitle: {
    color: '#aaaaaa',
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  shuffleModesList: {
    gap: 10,
    marginBottom: 16,
  },
  shuffleModeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#0B0F19',
    borderWidth: 1,
    borderColor: '#1F293D',
    gap: 12,
  },
  shuffleModeItemActive: {
    borderColor: '#06B6D4',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
  },
  shuffleModeIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#131826',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleModeTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  shuffleModeDesc: {
    color: '#888896',
    fontSize: 12,
    lineHeight: 16,
  },
  closeShuffleModalBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1F293D',
  },
  closeShuffleModalText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  duplicateBanner: {
    backgroundColor: '#0B0F19',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  duplicateBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  duplicateIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duplicateBannerTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  duplicateBannerSubtitle: {
    color: '#888896',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  duplicateBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#06B6D4',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  duplicateBannerBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
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
