import React, { useState, useCallback } from 'react';
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
  removeTrackFromPlaylist, 
  getDownloadedTracks 
} from '../utils/storage';
import { playTrack, addTracks } from '../services/TrackPlayerService';
import { downloadPlaylistTracks, deleteDownloadedTrack, getOfflineStorageUsage } from '../services/downloadService';
import { sharePlaylist } from '../services/cloudPlaylistService';

const { width } = Dimensions.get('window');
const HEADER_MAX_HEIGHT = width * 0.85;
const HEADER_MIN_HEIGHT = 90;

interface PlaylistScreenProps {
  route: any;
  navigation: any;
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
        getOfflineStorageUsage().then(usage => setStorageSize(usage.formattedSize));
      } else if (playlistId) {
        const found = getCustomPlaylists().find(p => p.id === playlistId);
        if (found) {
          setPlaylist(found);
        }
      }
    }, [playlistId])
  );
  
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
      Alert.alert('Empty Playlist', 'No tracks in this playlist to play.');
      return;
    }

    await playTrack(playlist.tracks[0]);
    if (playlist.tracks.length > 1) {
      addTracks(playlist.tracks.slice(1)).catch(() => {});
    }
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
    if (!shareUsername.trim()) return;
    try {
      await sharePlaylist(playlist, shareUsername.trim());
      setIsShareModalVisible(false);
      setShareUsername('');
      showToast('Playlist shared successfully!', 'checkmark-circle');
    } catch (e: any) {
      showToast(e?.message || 'Failed to share playlist', 'alert-circle');
    }
  };

  const handleCopyShareCode = async () => {
    if (!playlist.shareCode) return;
    try {
      await Clipboard.setStringAsync(playlist.shareCode);
      showToast(`Share code ${playlist.shareCode} copied!`, 'copy-outline');
    } catch {
      showToast(`Share Code: ${playlist.shareCode}`, 'copy-outline');
    }
  };

  const handlePlayTrack = (track: TrackMetadata) => {
    playTrack(track);
  };

  const handleRemoveTrack = (track: TrackMetadata) => {
    if (playlist.isImported) return;
    const isDownloads = playlistId === 'downloads';
    Alert.alert(
      isDownloads ? 'Delete Download' : 'Remove Track',
      isDownloads ? `Delete "${track.title}" from device storage?` : `Remove "${track.title}" from "${playlist.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
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
          }
        }
      ]
    );
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
            <TouchableOpacity style={styles.playAllBtn} onPress={handlePlayAll} activeOpacity={0.8}>
              <Ionicons name="play" size={20} color="#000000" />
              <Text style={styles.playAllBtnText}>Play All</Text>
            </TouchableOpacity>

            <View style={styles.secondaryActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleDownloadAll} activeOpacity={0.7}>
                <Ionicons name="arrow-down-circle-outline" size={18} color="#ffffff" />
                <Text style={styles.secondaryBtnText}>Download</Text>
              </TouchableOpacity>
              
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
  playAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00ffcc',
    paddingVertical: 13,
    borderRadius: 24,
    gap: 8,
  },
  playAllBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
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
});

