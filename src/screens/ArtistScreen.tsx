import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { TrackMetadata } from '../utils/storage';
import { searchTracks } from '../services/musicApi';
import { playTrack } from '../services/TrackPlayerService';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { MiniPlayer } from '../components/MiniPlayer';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { showToast } from '../components/ToastNotification';

interface Props {
  route: any;
  navigation: any;
}

export function ArtistScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { totalBottomPadding } = useBottomClearance(32);

  const artistParam = route.params?.artist;
  const artistName: string =
    typeof artistParam === 'string'
      ? artistParam
      : artistParam?.name || route.params?.artistName || 'Unknown Artist';
  const artistArtwork: string =
    artistParam?.artwork ||
    artistParam?.image ||
    route.params?.artistArtwork ||
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=60';

  const [tracks, setTracks] = useState<TrackMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<TrackMetadata | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchArtistTracks = async () => {
      setIsLoading(true);
      try {
        const results = await searchTracks(`${artistName} top songs hits`);
        if (isMounted) {
          setTracks(results || []);
        }
      } catch (err) {
        console.warn('[ArtistScreen] Error fetching tracks:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    fetchArtistTracks();
    return () => {
      isMounted = false;
    };
  }, [artistName]);

  const handlePlayTrack = async (item: TrackMetadata) => {
    try {
      setLoadingTrackId(item.id);
      const idx = tracks.findIndex(t => t.id === item.id);
      const remaining = idx !== -1 ? tracks.slice(idx + 1) : tracks;
      await playTrack(item, remaining);
    } catch (err) {
      console.error('[ArtistScreen] Play track error:', err);
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handlePlayAll = async () => {
    if (tracks.length === 0) return;
    await playTrack(tracks[0], tracks.slice(1));
    showToast(`Playing ${artistName}`, 'musical-notes');
  };

  const handleShuffle = async () => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    await playTrack(shuffled[0], shuffled.slice(1));
    showToast(`Shuffled ${artistName}`, 'shuffle');
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      {/* Top Bar with Back Button */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1} ellipsizeMode="tail">
          {artistName}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Hero Banner with Avatar & Info */}
      <View style={styles.heroContent}>
        <View style={styles.avatarGlowWrapper}>
          <Image source={{ uri: artistArtwork }} style={styles.avatarImage} />
        </View>

        <View style={styles.artistInfo}>
          <View style={styles.verifiedRow}>
            <Ionicons name="checkmark-circle" size={16} color="#00ffcc" />
            <Text style={styles.verifiedText}>Verified Artist</Text>
          </View>
          <Text style={styles.artistNameText} numberOfLines={1}>
            {artistName}
          </Text>
          <Text style={styles.listenerCountText}>Popular on Sukoon Music</Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.playAllButton}
            onPress={handlePlayAll}
            disabled={tracks.length === 0}
            activeOpacity={0.8}
          >
            <Ionicons name="play" size={18} color="#000000" style={{ marginLeft: 2 }} />
            <Text style={styles.playAllButtonText}>Play</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shuffleButton}
            onPress={handleShuffle}
            disabled={tracks.length === 0}
            activeOpacity={0.8}
          >
            <Ionicons name="shuffle" size={18} color="#00ffcc" />
            <Text style={styles.shuffleButtonText}>Shuffle</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeading}>Popular Songs</Text>
        <Text style={styles.songCount}>{tracks.length} tracks</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(0, 255, 204, 0.18)', 'rgba(0, 30, 25, 0.4)', '#000000']}
        style={styles.backgroundGradient}
        pointerEvents="none"
      />

      {isLoading ? (
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color="#00ffcc" />
          <Text style={styles.loadingText}>Loading {artistName}...</Text>
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            const isPlayingThis = loadingTrackId === item.id;
            const artwork =
              item.artwork ||
              (item as any)?.artworkUrl ||
              (item as any)?.thumbnail ||
              'https://via.placeholder.com/150';

            return (
              <TouchableOpacity
                style={styles.trackRow}
                onPress={() => handlePlayTrack(item)}
                onLongPress={() => setPlaylistModalTrack(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.trackIndex}>{index + 1}</Text>
                <Image source={{ uri: artwork }} style={styles.trackThumbnail} />

                <View style={styles.trackInfo}>
                  <Text style={styles.trackTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>
                    {item.artist}
                  </Text>
                </View>

                {isPlayingThis ? (
                  <ActivityIndicator size="small" color="#00ffcc" style={styles.rightIcon} />
                ) : (
                  <TouchableOpacity
                    style={styles.rightIcon}
                    onPress={() => setPlaylistModalTrack(item)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color="#888896" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <AddToPlaylistModal
        visible={playlistModalTrack !== null}
        track={playlistModalTrack}
        onClose={() => setPlaylistModalTrack(null)}
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
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 400,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerContainer: {
    paddingBottom: 16,
  },
  heroContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
  },
  avatarGlowWrapper: {
    width: 140,
    height: 140,
    borderRadius: 70,
    padding: 3,
    backgroundColor: 'rgba(0, 255, 204, 0.35)',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 16,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 70,
    backgroundColor: '#18181c',
  },
  artistInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  verifiedText: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  artistNameText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  listenerCountText: {
    color: '#8e8e98',
    fontSize: 13,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  playAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00ffcc',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    gap: 6,
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  playAllButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
  shuffleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181c',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    gap: 6,
    borderWidth: 1,
    borderColor: '#2e2e36',
  },
  shuffleButtonText: {
    color: '#00ffcc',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: 6,
    marginBottom: 10,
  },
  sectionHeading: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  songCount: {
    color: '#8e8e98',
    fontSize: 12,
    fontWeight: '600',
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 8,
    borderRadius: 10,
  },
  trackIndex: {
    color: '#666675',
    fontSize: 14,
    fontWeight: '700',
    width: 24,
    textAlign: 'center',
    marginRight: 10,
  },
  trackThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#18181c',
    marginRight: 12,
  },
  trackInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  trackArtist: {
    color: '#8e8e98',
    fontSize: 12,
  },
  rightIcon: {
    padding: 6,
    marginLeft: 8,
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#8e8e98',
    fontSize: 14,
  },
});
