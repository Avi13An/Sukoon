import React, { useState, useCallback, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  TouchableOpacity, 
  Dimensions, 
  TextInput, 
  Alert 
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { showToast } from '../components/ToastNotification';
import Animated, { 
  useSharedValue, 
  useAnimatedScrollHandler, 
  useAnimatedStyle, 
  interpolate, 
  Extrapolation 
} from 'react-native-reanimated';
import { 
  Playlist, 
  TrackMetadata, 
  getCustomPlaylists, 
  getUserPlaylists,
  deletePlaylist,
  removeTrackFromPlaylist, 
  getDownloadedTracks,
  clonePlaylistToUser,
  onPlaylistsChanged,
  isLikedSongsPlaylist,
} from '../utils/storage';
import { playTrack, addTracks, clearUpNextQueue, addToUpNextQueue } from '../services/TrackPlayerService';
import { downloadPlaylistTracks, deleteDownloadedTrack, getOfflineStorageUsage } from '../services/downloadService';
import { sharePlaylist } from '../services/cloudPlaylistService';
import { ConfirmModal } from '../components/ConfirmModal';

const { width } = Dimensions.get('window');
const HEADER_MAX_HEIGHT = width * 0.85;
const HEADER_MIN_HEIGHT = 90;

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
  const initialPlaylist: Playlist = route.params?.playlist || {
    id: 'unknown',
    shareCode: '',
    name: 'Playlist',
    createdAt: Date.now(),
    tracks: [],
  };
  const playlistId = route.params?.playlistId || initialPlaylist.id;
  const [playlist, setPlaylist] = useState<Playlist>(initialPlaylist);
  const [originalTracks, setOriginalTracks] = useState<TrackMetadata[]>(initialPlaylist.tracks || []);
  const [shuffleMode, setShuffleMode] = useState<SmartShuffleMode>('none');
  const [isShuffleModalVisible, setIsShuffleModalVisible] = useState(false);
  const [storageSize, setStorageSize] = useState<string>('0 MB');

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
        const found = getUserPlaylists().find(p => p.id === playlistId);
        if (found) {
          setPlaylist(found);
          setOriginalTracks(found.tracks || []);
        }
      }
    }, [playlistId])
  );

  useEffect(() => {
    const unsub = onPlaylistsChanged(() => {
      if (playlistId && playlistId !== 'downloads') {
        const found = getUserPlaylists().find(p => p.id === playlistId);
        if (found) {
          setPlaylist(found);
          setOriginalTracks(found.tracks || []);
        }
      }
    });
    return unsub;
  }, [playlistId]);
  
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const animatedHeaderStyle = useAnimatedStyle(() => {
    const height = interpolate(
      scrollY.value,
      [0, HEADER_MAX_HEIGHT - HEADER_MIN_HEIGHT],
      [HEADER_MAX_HEIGHT, HEADER_MIN_HEIGHT],
      Extrapolation.CLAMP
    );
    return { height };
  });

  const animatedImageStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, (HEADER_MAX_HEIGHT - HEADER_MIN_HEIGHT) / 2],
      [1, 0],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const [shareUsername, setShareUsername] = useState('');
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);

  const handlePlayAll = async () => {
    if (!playlist.tracks || playlist.tracks.length === 0) {
      showToast('No tracks in this playlist to play', 'alert-circle');
      return;
    }

    await playTrack(playlist.tracks[0], playlist.tracks);
  };

  const handleSelectShuffleMode = (mode: SmartShuffleMode) => {
    setShuffleMode(mode);
    setIsShuffleModalVisible(false);
    const sorted = applySmartShuffle(originalTracks, mode);
    setPlaylist(prev => ({ ...prev, tracks: sorted }));
    
    clearUpNextQueue();
    sorted.slice(1).forEach(t => addToUpNextQueue(t));
    
    const modeNames: Record<SmartShuffleMode, string> = {
      none: 'Original Order',
      soft_to_hype: 'Soft to Hype 🌿',
      hype_to_soft: 'Hype to Soft 🔥',
      artist_flow: 'Artist Flow 🎤',
      balanced: 'Smart Balanced ⚖️',
    };
    showToast(`Smart Shuffle: ${modeNames[mode]}`, 'sparkles');
  };

  const handleResetShuffle = () => {
    setShuffleMode('none');
    setPlaylist(prev => ({ ...prev, tracks: [...originalTracks] }));
    clearUpNextQueue();
    originalTracks.slice(1).forEach(t => addToUpNextQueue(t));
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
    playTrack(track, playlist.tracks);
  };

  const handleRemoveTrack = (track: TrackMetadata) => {
    if (playlist.isImported) return;
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
      {!playlist.isImported && (
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
      <Animated.View style={[styles.header, animatedHeaderStyle]}>
        {playlist.coverImage ? (
          <Animated.Image 
            source={{ uri: playlist.coverImage }} 
            style={[styles.headerImage, animatedImageStyle]} 
          />
        ) : (
          <Animated.View style={[styles.headerPlaceholder, animatedImageStyle]}>
            <Ionicons name="musical-notes" size={80} color="#333333" />
          </Animated.View>
        )}
        <View style={styles.headerOverlay}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.playlistName} numberOfLines={1}>{playlist.name}</Text>
          {playlist.isImported && (
            <View style={styles.viewOnlyBadge}>
              <Ionicons name="lock-closed" size={11} color="#00ffcc" />
              <Text style={styles.viewOnlyBadgeText}>Shared Playlist (View Only)</Text>
            </View>
          )}
          {playlist.description ? (
            <Text style={styles.playlistDesc} numberOfLines={2}>{playlist.description}</Text>
          ) : null}
          <Text style={styles.trackCount}>
            {playlist.tracks.length} {playlist.tracks.length === 1 ? 'Track' : 'Tracks'}
            {playlistId === 'downloads' 
              ? ` • ${storageSize} Offline Storage` 
              : createdDateStr ? ` • Created ${createdDateStr}` : ''}
          </Text>
        </View>
      </Animated.View>

      <Animated.FlatList
        data={playlist.tracks}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={renderItem}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {playlist.isImported && (
              <View style={styles.duplicateBanner}>
                <View style={styles.duplicateBannerHeader}>
                  <View style={styles.duplicateIconCircle}>
                    <Ionicons name="copy-outline" size={18} color="#00ffcc" />
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

            <View style={styles.primaryActionButtons}>
              <TouchableOpacity style={styles.playAllBtn} onPress={handlePlayAll} activeOpacity={0.8}>
                <Ionicons name="play" size={18} color="#000000" />
                <Text style={styles.playAllBtnText}>Play All</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.shuffleBtn, shuffleMode !== 'none' && styles.shuffleBtnActive]} 
                onPress={() => setIsShuffleModalVisible(true)} 
                activeOpacity={0.8}
              >
                <Ionicons name="sparkles" size={16} color={shuffleMode !== 'none' ? '#000000' : '#00ffcc'} />
                <Text style={[styles.shuffleBtnText, shuffleMode !== 'none' && styles.shuffleBtnTextActive]}>
                  Smart Shuffle
                </Text>
              </TouchableOpacity>

              {shuffleMode !== 'none' && (
                <TouchableOpacity style={styles.resetBtn} onPress={handleResetShuffle} activeOpacity={0.8}>
                  <Ionicons name="refresh" size={15} color="#ffffff" />
                  <Text style={styles.resetBtnText}>Reset</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.secondaryActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleDownloadAll} activeOpacity={0.7}>
                <Ionicons name="arrow-down-circle-outline" size={18} color="#ffffff" />
                <Text style={styles.secondaryBtnText}>Download</Text>
              </TouchableOpacity>
              
              {playlist.isImported && (
                <TouchableOpacity 
                  style={[styles.secondaryBtn, styles.duplicateSecondaryBtn]} 
                  onPress={handleDuplicateToMyLibrary} 
                  activeOpacity={0.7}
                >
                  <Ionicons name="duplicate-outline" size={17} color="#00ffcc" />
                  <Text style={[styles.secondaryBtnText, { color: '#00ffcc' }]}>Copy to Account</Text>
                </TouchableOpacity>
              )}

              {!playlist.isImported && playlistId !== 'downloads' && (
                <>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={handleCopyShareCode} activeOpacity={0.7}>
                    <Ionicons name="copy-outline" size={18} color="#00ffcc" />
                    <Text style={[styles.secondaryBtnText, { color: '#00ffcc' }]}>Share Code</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => setIsShareModalVisible(true)} activeOpacity={0.7}>
                    <Ionicons name="share-social-outline" size={18} color="#ffffff" />
                    <Text style={styles.secondaryBtnText}>Invite</Text>
                  </TouchableOpacity>
                  {!isLikedSongsPlaylist(playlist) && (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={handleDeletePlaylist} activeOpacity={0.7}>
                      <Ionicons name="trash-outline" size={18} color="#ff5252" />
                      <Text style={[styles.secondaryBtnText, { color: '#ff5252' }]}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="musical-note-outline" size={48} color="#444444" />
            <Text style={styles.emptyText}>No tracks in this playlist yet.</Text>
            <Text style={styles.emptySubtext}>Search for songs and tap "Add to Playlist" to add them here!</Text>
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
                <Ionicons name="sparkles" size={18} color="#00ffcc" />
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
                  <Text style={styles.shuffleModeDesc}>Acoustic & chill melodies → High-tempo bangers</Text>
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
                  <Text style={styles.shuffleModeDesc}>High-energy party hits → Smooth wind-down</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    backgroundColor: '#121214',
    overflow: 'hidden',
  },
  headerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  headerPlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#16161a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  backBtn: {
    position: 'absolute',
    top: 44,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistName: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  viewOnlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.3)',
    marginBottom: 6,
    gap: 4,
  },
  viewOnlyBadgeText: {
    color: '#00ffcc',
    fontSize: 11,
    fontWeight: '700',
  },
  playlistDesc: {
    color: '#cccccc',
    fontSize: 13,
    marginBottom: 6,
  },
  trackCount: {
    color: '#aaaaaa',
    fontSize: 13,
  },
  listContent: {
    paddingTop: HEADER_MAX_HEIGHT + 10,
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  listHeader: {
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222222',
    marginBottom: 16,
    gap: 12,
  },
  primaryActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playAllBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00ffcc',
    paddingVertical: 12,
    borderRadius: 22,
    gap: 6,
  },
  playAllBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  shuffleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16161a',
    borderWidth: 1,
    borderColor: '#00ffcc',
    paddingVertical: 12,
    borderRadius: 22,
    gap: 6,
  },
  shuffleBtnActive: {
    backgroundColor: '#00ffcc',
    borderColor: '#00ffcc',
  },
  shuffleBtnText: {
    color: '#00ffcc',
    fontSize: 14,
    fontWeight: '700',
  },
  shuffleBtnTextActive: {
    color: '#000000',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222226',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 22,
    gap: 4,
  },
  resetBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161618',
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#26262a',
    gap: 6,
  },
  secondaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingVertical: 4,
  },
  trackMainTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackImage: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: '#18181a',
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 3,
  },
  trackArtist: {
    color: '#888888',
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
    paddingHorizontal: 20,
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
    backgroundColor: '#161618',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#28282c',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#0c0c0e',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#28282c',
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
    backgroundColor: '#00ffcc',
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
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
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
    backgroundColor: '#0c0c0e',
    borderWidth: 1,
    borderColor: '#26262a',
    gap: 12,
  },
  shuffleModeItemActive: {
    borderColor: '#00ffcc',
    backgroundColor: 'rgba(0, 255, 204, 0.08)',
  },
  shuffleModeIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#1a1a1e',
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
    color: '#888888',
    fontSize: 12,
    lineHeight: 16,
  },
  closeShuffleModalBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#202024',
  },
  closeShuffleModalText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  duplicateBanner: {
    backgroundColor: '#111116',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.25)',
    marginBottom: 4,
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
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
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
    backgroundColor: '#00ffcc',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  duplicateBannerBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  duplicateSecondaryBtn: {
    borderColor: 'rgba(0, 255, 204, 0.4)',
  },
});

