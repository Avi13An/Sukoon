import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  Image, 
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  useWindowDimensions,
  StatusBar,
  Platform,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { 
  getLastPlayedTrack, 
  getListenHistory, 
  getActiveUser, 
  TrackMetadata, 
  Playlist 
} from '../utils/storage';
import { 
  getRecommendedTracks, 
  searchTracks, 
  fetchTrendingCharts, 
  fetchMoodPlaylists,
  resolveTrackForPlayback 
} from '../services/musicApi';
import { playTrack } from '../services/TrackPlayerService';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { PartyModal } from '../components/PartyModal';
import { getPartyState, subscribeToPartyState, PartyState } from '../services/partyService';
import { getAmbientThemeForTrack, boostAmbientColor } from '../utils/colorExtractor';
import { showToast } from '../components/ToastNotification';

interface MoodPill {
  id: string;
  label: string;
}

const MOOD_PILLS: MoodPill[] = [
  { id: 'chill', label: 'Chill & Sukoon' },
  { id: 'romance', label: 'Romance' },
  { id: 'energy', label: 'Workout & Energy' },
  { id: 'heartbreak', label: 'Heartbreak' },
  { id: 'desi_indie', label: 'Desi Indie' },
  { id: 'nostalgia', label: 'Nostalgia' },
  { id: 'late_night', label: 'Late Night' },
  { id: 'party', label: 'Party' },
  { id: 'focus', label: 'Focus' },
  { id: 'sufi', label: 'Sufi' },
  { id: 'global', label: 'Global Pop' },
  { id: 'acoustic', label: 'Acoustic' },
];

interface ArtistItem {
  id: string;
  name: string;
  artwork: string;
}

const TOP_ARTISTS: ArtistItem[] = [
  { 
    id: 'art-1', 
    name: 'Arijit Singh', 
    artwork: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80' 
  },
  { 
    id: 'art-2', 
    name: 'Shreya Ghoshal', 
    artwork: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=300&auto=format&fit=crop&q=80' 
  },
  { 
    id: 'art-3', 
    name: 'Diljit Dosanjh', 
    artwork: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&auto=format&fit=crop&q=80' 
  },
  { 
    id: 'art-4', 
    name: 'Atif Aslam', 
    artwork: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300&auto=format&fit=crop&q=80' 
  },
  { 
    id: 'art-5', 
    name: 'A.R. Rahman', 
    artwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&auto=format&fit=crop&q=80' 
  },
  { 
    id: 'art-6', 
    name: 'Prateek Kuhad', 
    artwork: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=300&auto=format&fit=crop&q=80' 
  },
  { 
    id: 'art-7', 
    name: 'Anuv Jain', 
    artwork: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80' 
  },
];

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const cardSize = Math.min(width * 0.4, 155);

  const [selectedMood, setSelectedMood] = useState('chill');
  const [curatedPlaylists, setCuratedPlaylists] = useState<Playlist[]>([]);
  const [isMoodLoading, setIsMoodLoading] = useState(false);
  const [chartRegion, setChartRegion] = useState<'india' | 'global'>('india');
  const [topSuggestions, setTopSuggestions] = useState<TrackMetadata[]>([]);
  const [lastPlayedSong, setLastPlayedSong] = useState<TrackMetadata | null>(() => getLastPlayedTrack());
  const [recommendations, setRecommendations] = useState<TrackMetadata[]>([]);
  const [indiaCharts, setIndiaCharts] = useState<TrackMetadata[]>([]);
  const [globalCharts, setGlobalCharts] = useState<TrackMetadata[]>([]);
  const [recentTracks, setRecentTracks] = useState<TrackMetadata[]>([]);
  const [currentAmbientTrack, setCurrentAmbientTrack] = useState<TrackMetadata | null>(null);

  const chunkedPills = useMemo(() => {
    const chunks: TrackMetadata[][] = [];
    for (let i = 0; i < topSuggestions.length; i += 3) {
      chunks.push(topSuggestions.slice(i, i + 3));
    }
    return chunks;
  }, [topSuggestions]);

  const currentChartList = useMemo(() => {
    return chartRegion === 'india' ? indiaCharts : globalCharts;
  }, [chartRegion, indiaCharts, globalCharts]);

  const trendingTracks = useMemo(() => {
    return currentChartList.length > 0 ? currentChartList : recommendations.slice(0, 21);
  }, [currentChartList, recommendations]);

  const trendingColumns = useMemo(() => {
    const chunks: TrackMetadata[][] = [];
    for (let i = 0; i < trendingTracks.length; i += 3) {
      chunks.push(trendingTracks.slice(i, i + 3));
    }
    return chunks;
  }, [trendingTracks]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<TrackMetadata | null>(null);
  const [isPartyModalVisible, setIsPartyModalVisible] = useState(false);
  const [partyState, setPartyState] = useState<PartyState>(getPartyState());

  useEffect(() => {
    const unsub = subscribeToPartyState(setPartyState);
    return unsub;
  }, []);

  // Ambient greeting based on current local hour
  const greetingPrefix = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 17) return 'Afternoon';
    if (hour >= 17 && hour < 22) return 'Evening';
    return 'Late Night';
  }, []);

  const activeUsername = useMemo(() => {
    return getActiveUser() || 'Listener';
  }, []);

  const profileInitial = useMemo(() => {
    return activeUsername.charAt(0).toUpperCase();
  }, [activeUsername]);

  const ambientColor = useMemo(() => {
    const rawColor = currentAmbientTrack ? getAmbientThemeForTrack(currentAmbientTrack).primary : undefined;
    const seed = currentAmbientTrack 
      ? `${currentAmbientTrack.id}_${currentAmbientTrack.title}_${currentAmbientTrack.artist}`
      : selectedMood;
    return boostAmbientColor(rawColor, seed);
  }, [currentAmbientTrack, selectedMood]);

  // Load all home data
  const loadData = useCallback(async () => {
    const history = getListenHistory();
    setRecentTracks(history);
    const lastTrack = getLastPlayedTrack();
    setLastPlayedSong(lastTrack);
    setCurrentAmbientTrack(lastTrack);

    try {
      const [recs, indiaData, globalData] = await Promise.all([
        getRecommendedTracks(lastTrack?.id),
        fetchTrendingCharts('india'),
        fetchTrendingCharts('global'),
      ]);

      const safeIndia = Array.isArray(indiaData) ? indiaData : [];
      const safeGlobal = Array.isArray(globalData) ? globalData : [];
      const rawRecs = Array.isArray(recs) ? recs : [];
      const safeRecs = rawRecs.length > 0 ? rawRecs : (safeIndia.length > 0 ? safeIndia : []);

      const finalSuggestions = safeRecs.length >= 3
        ? safeRecs.slice(0, Math.min(21, safeRecs.length - (safeRecs.length % 3)))
        : safeRecs.slice(0, 21);

      setTopSuggestions(finalSuggestions);
      setRecommendations(safeRecs);
      setIndiaCharts(safeIndia);
      setGlobalCharts(safeGlobal);
    } catch (err) {
      console.error('[HomeScreen] Error loading data:', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      (async () => {
        if (isMounted) {
          setIsLoading(true);
          await loadData();
          if (isMounted) setIsLoading(false);
        }
      })();
      return () => {
        isMounted = false;
      };
    }, [loadData])
  );

  const loadCuratedPlaylists = useCallback(async (moodId: string, forceRefresh = false) => {
    setIsMoodLoading(true);
    try {
      const pl = await fetchMoodPlaylists(moodId, forceRefresh);
      setCuratedPlaylists(pl);
    } catch (err) {
      console.error('[HomeScreen] Error loading curated playlists:', err);
    } finally {
      setIsMoodLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCuratedPlaylists(selectedMood);
  }, [selectedMood, loadCuratedPlaylists]);

  const handleSelectMood = (moodId: string) => {
    setSelectedMood(moodId);
  };

  const handlePlaylistCardPress = (playlist: Playlist) => {
    navigation.navigate('PlaylistDetail', { 
      playlist, 
      tracks: playlist.tracks,
      playlistId: playlist.id 
    });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      loadData(),
      fetchTrendingCharts('india', true).then(d => setIndiaCharts(d)),
      fetchTrendingCharts('global', true).then(d => setGlobalCharts(d)),
      loadCuratedPlaylists(selectedMood, true),
    ]);
    setIsRefreshing(false);
  };

  const handlePlayTrack = async (item: TrackMetadata, contextQueue?: TrackMetadata[]) => {
    try {
      setLoadingTrackId(item.id);
      let targetTrack = item;
      if (item.id && (item.id.startsWith('chart_') || item.id.startsWith('new_release_'))) {
        targetTrack = await resolveTrackForPlayback(item);
      }
      await playTrack(targetTrack, contextQueue);
    } catch (err) {
      console.error('[HomeScreen] Error playing track:', err);
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handleArtistPress = (artist: ArtistItem) => {
    navigation.navigate('ArtistScreen', { artist });
  };

  const renderTrackCard = (contextQueue?: TrackMetadata[], showRank = false) => ({ item, index }: { item: TrackMetadata; index: number }) => {
    const isPlayingThis = loadingTrackId === item.id;
    const artwork = item.artwork || (item as any)?.artworkUrl || (item as any)?.thumbnail || 'https://via.placeholder.com/150';

    return (
      <TouchableOpacity 
        style={styles.card} 
        activeOpacity={0.8}
        onPress={() => handlePlayTrack(item, contextQueue)}
        onLongPress={() => setPlaylistModalTrack(item)}
        disabled={isPlayingThis}
      >
        <View style={styles.thumbnailContainer}>
          <Image 
            source={{ uri: artwork }} 
            style={styles.thumbnail} 
            resizeMode="cover"
          />
          <LinearGradient 
            colors={['transparent', 'rgba(0,0,0,0.8)']} 
            style={styles.cardGradientOverlay} 
          />
          
          {showRank && (
            <View style={styles.rankBadge}>
              <Text style={styles.rankBadgeText}>#{index + 1}</Text>
            </View>
          )}

          <TouchableOpacity 
            style={styles.playlistAddOverlay}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            onPress={(e) => {
              e.stopPropagation();
              setPlaylistModalTrack(item);
            }}
          >
            <Ionicons name="add" size={16} color="#00ffcc" />
          </TouchableOpacity>

          <View style={styles.playButtonOverlay}>
            {isPlayingThis ? (
              <ActivityIndicator size="small" color="#000000" />
            ) : (
              <Ionicons name="play" size={14} color="#000000" style={{ marginLeft: 2 }} />
            )}
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="tail">{item.title}</Text>
        <Text style={styles.cardArtist} numberOfLines={1} ellipsizeMode="tail">{item.artist}</Text>
      </TouchableOpacity>
    );
  };

  // Safe padding configuration
  const bottomSafePadding = insets.bottom + 130;

  return (
    <View style={styles.screen}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <LinearGradient 
        colors={[ambientColor, `${ambientColor}cc`, `${ambientColor}33`, '#070709']} 
        locations={[0, 0.25, 0.55, 0.9]} 
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScrollView 
        style={styles.container}
        contentContainerStyle={{ 
          paddingBottom: bottomSafePadding 
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={isRefreshing} 
            onRefresh={handleRefresh} 
            tintColor="#00ffcc" 
            colors={['#00ffcc']} 
          />
        }
      >
        {/* Minimalist Luxury Top Bar */}
        <View 
          style={[
            styles.headerContainer, 
            {
              paddingTop: insets.top + (Platform.OS === 'android' ? 6 : 10),
              paddingBottom: 14,
              paddingHorizontal: 20,
            }
          ]}
        >
          <View style={styles.headerTopRow}>
            <View style={styles.greetingWrapper}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{profileInitial}</Text>
              </View>
              <View style={{ gap: 3 }}>
                <Text style={styles.greetingTitle}>{greetingPrefix}, {activeUsername}</Text>
                <View style={styles.losslessChip}>
                  <Text style={styles.losslessText}>LOSSLESS</Text>
                </View>
              </View>
            </View>

            <View style={styles.headerActions}>
              <TouchableOpacity 
                style={styles.iconButton}
                onPress={() => navigation.navigate('Search')}
                activeOpacity={0.7}
              >
                <Ionicons name="search" size={18} color="#ffffff" />
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.partyPill, partyState.isActive && styles.partyPillActive]} 
                onPress={() => setIsPartyModalVisible(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="radio-outline" size={13} color={partyState.isActive ? "#000000" : "#00ffcc"} />
                <Text style={[styles.partyPillText, partyState.isActive && styles.partyPillTextActive]}>
                  {partyState.isActive ? 'Jamming' : 'Jam'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Quick Picks Carousel (3-Song Pill Columns Based on Last Played Song) */}
        {topSuggestions.length > 0 && (
          <View style={[styles.section, { marginTop: 4 }]}>
            <View style={styles.sectionHeaderContainer}>
              <View style={styles.sectionHeaderTextWrapper}>
                <Text style={styles.sectionTitle}>Quick Picks</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScrollContent}
              decelerationRate="fast"
              snapToInterval={width * 0.84 + 14}
              snapToAlignment="start"
            >
              {chunkedPills.map((chunk, chunkIndex) => (
                <View
                  key={`quick-chunk-${chunkIndex}`}
                  style={[styles.pillColumn, { width: width * 0.84 }]}
                >
                  {chunk.map((track) => (
                    <TouchableOpacity
                      key={track.id}
                      activeOpacity={0.75}
                      onPress={() => handlePlayTrack(track, topSuggestions)}
                      onLongPress={() => setPlaylistModalTrack(track)}
                      style={styles.pillCard}
                    >
                      <Image
                        source={{ uri: track.artwork || (track as any).thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200' }}
                        style={styles.pillImage}
                      />
                      <View style={styles.pillInfo}>
                        <Text numberOfLines={1} style={styles.pillTitle}>{track.title}</Text>
                        <Text numberOfLines={1} style={styles.pillArtist}>{track.artist}</Text>
                      </View>
                      {loadingTrackId === track.id ? (
                        <ActivityIndicator size="small" color="#00ffcc" style={styles.pillPlayIcon} />
                      ) : (
                        <Ionicons name="play-circle" size={24} color="#00ffcc" style={styles.pillPlayIcon} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Trending Shelf (3-Row Horizontal Pill Carousel) */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderContainer}>
            <View style={styles.sectionHeaderTextWrapper}>
              <Text style={styles.sectionTitle}>Trending</Text>
            </View>
            <View style={styles.chartRegionToggleRow}>
              <TouchableOpacity
                style={[
                  styles.regionPill,
                  chartRegion === 'india' ? styles.regionPillActive : styles.regionPillInactive,
                ]}
                onPress={() => setChartRegion('india')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.regionPillText,
                    chartRegion === 'india' ? styles.regionPillTextActive : styles.regionPillTextInactive,
                  ]}
                >
                  India
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.regionPill,
                  chartRegion === 'global' ? styles.regionPillActive : styles.regionPillInactive,
                ]}
                onPress={() => setChartRegion('global')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.regionPillText,
                    chartRegion === 'global' ? styles.regionPillTextActive : styles.regionPillTextInactive,
                  ]}
                >
                  Global
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {isLoading && !isRefreshing && trendingTracks.length === 0 ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color="#00ffcc" />
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScrollContent}
              decelerationRate="fast"
              snapToInterval={width * 0.84 + 14}
              snapToAlignment="start"
            >
              {trendingColumns.map((chunk, chunkIndex) => (
                <View
                  key={`trending-chunk-${chartRegion}-${chunkIndex}`}
                  style={[styles.pillColumn, { width: width * 0.84 }]}
                >
                  {chunk.map((track, trackIndex) => {
                    const rank = chunkIndex * 3 + trackIndex + 1;
                    const isPlayingThis = loadingTrackId === track.id;
                    return (
                      <TouchableOpacity
                        key={`${track.id}-${rank}`}
                        activeOpacity={0.75}
                        onPress={() => handlePlayTrack(track, trendingTracks)}
                        onLongPress={() => setPlaylistModalTrack(track)}
                        style={styles.pillCard}
                      >
                        <View style={styles.pillImageWrapper}>
                          <Image
                            source={{ uri: track.artwork || (track as any).thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200' }}
                            style={styles.pillImage}
                          />
                          <View style={styles.pillRankBadge}>
                            <Text style={styles.pillRankText}>#{rank}</Text>
                          </View>
                        </View>
                        <View style={styles.pillInfo}>
                          <Text numberOfLines={1} style={styles.pillTitle}>{track.title}</Text>
                          <Text numberOfLines={1} style={styles.pillArtist}>{track.artist}</Text>
                        </View>
                        {isPlayingThis ? (
                          <ActivityIndicator size="small" color="#00ffcc" style={styles.pillPlayIcon} />
                        ) : (
                          <Ionicons name="play-circle" size={24} color="#00ffcc" style={styles.pillPlayIcon} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Top Artists Shelf (Circular Avatars with Glow) */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderContainer}>
            <View style={styles.sectionHeaderTextWrapper}>
              <Text style={styles.sectionTitle}>Top Artists</Text>
            </View>
          </View>
          <FlatList
            horizontal
            data={TOP_ARTISTS}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalScrollContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.artistCard}
                onPress={() => handleArtistPress(item)}
                activeOpacity={0.8}
              >
                <View style={styles.artistAvatarWrapper}>
                  <Image source={{ uri: item.artwork }} style={styles.artistAvatar} resizeMode="cover" />
                </View>
                <Text style={styles.artistName} numberOfLines={1} ellipsizeMode="tail">
                  {item.name}
                </Text>
                <Text style={styles.artistRole}>Artist</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Curated Playlists & Moods Hub */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderContainer}>
            <View style={styles.sectionHeaderTextWrapper}>
              <Text style={styles.sectionTitle}>Curated</Text>
            </View>
          </View>

          {/* 12-Mood Selector Pills */}
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.moodPillsScroll}
          >
            {MOOD_PILLS.map((pill) => {
              const isSelected = selectedMood === pill.id;
              return (
                <TouchableOpacity
                  key={pill.id}
                  style={[
                    styles.moodSelectorPill,
                    isSelected ? styles.moodSelectorPillActive : styles.moodSelectorPillInactive,
                  ]}
                  onPress={() => handleSelectMood(pill.id)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.moodSelectorPillText,
                      isSelected ? styles.moodSelectorPillTextActive : styles.moodSelectorPillTextInactive,
                    ]}
                  >
                    {pill.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Curated Playlist Shelf */}
          {isMoodLoading && curatedPlaylists.length === 0 ? (
            <View style={styles.moodLoadingContainer}>
              <ActivityIndicator size="large" color="#00ffcc" />
            </View>
          ) : (
            <FlatList
              horizontal
              data={curatedPlaylists}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScrollContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.curatedCard, { width: cardSize }]}
                  activeOpacity={0.8}
                  onPress={() => handlePlaylistCardPress(item)}
                >
                  <View style={[styles.curatedArtworkWrapper, { width: cardSize, height: cardSize, borderRadius: 14 }]}>
                    <Image
                      source={{
                        uri:
                          item.coverImage ||
                          item.tracks?.[0]?.artwork ||
                          'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500',
                      }}
                      style={[styles.curatedArtwork, { width: cardSize, height: cardSize, borderRadius: 14 }]}
                      resizeMode="cover"
                    />
                    <LinearGradient
                      colors={['transparent', 'rgba(0,0,0,0.75)']}
                      style={styles.curatedGradientOverlay}
                    />
                    
                    {/* Track count badge */}
                    <View style={styles.curatedTrackBadge}>
                      <Text style={styles.curatedTrackBadgeText}>
                        {item.tracks?.length || 0} Songs
                      </Text>
                    </View>

                    {/* Floating translucent play button */}
                    <TouchableOpacity
                      style={styles.curatedPlayButton}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.8}
                      onPress={(e) => {
                        e.stopPropagation();
                        if (item.tracks && item.tracks.length > 0) {
                          handlePlayTrack(item.tracks[0], item.tracks);
                        }
                      }}
                    >
                      <Ionicons name="play" size={16} color="#000000" style={{ marginLeft: 2 }} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.curatedTitle} numberOfLines={1} ellipsizeMode="tail">
                    {item.name}
                  </Text>
                  <Text style={styles.curatedSubtitle} numberOfLines={1} ellipsizeMode="tail">
                    {item.description || 'Curated Station'}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>

        {/* Jump Back In (Listening History - Final Section at Bottom) */}
        {recentTracks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderContainer}>
              <View style={styles.sectionHeaderTextWrapper}>
                <Text style={styles.sectionTitle}>Jump Back In</Text>
              </View>
            </View>
            <FlatList
              horizontal
              data={recentTracks.slice(0, 10)}
              keyExtractor={(item, index) => `recent-${item.id}-${index}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScrollContent}
              renderItem={renderTrackCard(recentTracks.slice(0, 10))}
            />
          </View>
        )}
      </ScrollView>

      <AddToPlaylistModal 
        visible={playlistModalTrack !== null} 
        track={playlistModalTrack} 
        onClose={() => setPlaylistModalTrack(null)} 
      />

      <PartyModal
        visible={isPartyModalVisible}
        onClose={() => setIsPartyModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#070709',
  },
  container: {
    flex: 1,
  },
  headerContainer: {
    // dynamically styled with safe area top inset
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greetingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
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
  greetingTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  losslessChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  losslessText: {
    color: '#00ffcc',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  partyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    borderColor: 'rgba(0, 255, 204, 0.3)',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  partyPillActive: {
    backgroundColor: '#00ffcc',
    borderColor: '#00ffcc',
  },
  partyPillText: {
    color: '#00ffcc',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  partyPillTextActive: {
    color: '#000000',
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 0,
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    marginBottom: 12,
    marginTop: 24,
  },
  sectionHeaderTextWrapper: {
    flex: 1,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sectionSubtitle: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
    letterSpacing: 0.1,
  },
  chartRegionToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  regionPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  regionPillActive: {
    backgroundColor: '#00ffcc',
  },
  regionPillInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  regionPillText: {
    fontSize: 12,
  },
  regionPillTextActive: {
    color: '#000000',
    fontWeight: '700',
  },
  regionPillTextInactive: {
    color: '#aaaaaa',
  },
  horizontalScrollContent: {
    paddingHorizontal: 20,
  },
  pillColumn: {
    marginRight: 14,
  },
  pillCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  pillImageWrapper: {
    position: 'relative',
    width: 48,
    height: 48,
  },
  pillImage: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#18181c',
  },
  pillRankBadge: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  pillRankText: {
    color: '#00ffcc',
    fontSize: 9,
    fontWeight: '800',
  },
  pillInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  pillTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  pillArtist: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 12,
    marginTop: 2,
  },
  pillPlayIcon: {
    marginLeft: 8,
  },
  loaderContainer: {
    paddingVertical: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 140,
    marginRight: 14,
  },
  thumbnailContainer: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: '#0c0c0c',
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1c1c1c',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  cardGradientOverlay: {
    position: 'absolute',
    left: 0, 
    right: 0, 
    bottom: 0, 
    height: 60,
  },
  rankBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#00ffcc',
    zIndex: 4,
  },
  rankBadgeText: {
    color: '#00ffcc',
    fontSize: 11,
    fontWeight: '800',
  },
  playButtonOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: '#00ffcc',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  playlistAddOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    zIndex: 5,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardArtist: {
    color: '#888896',
    fontSize: 12,
  },
  artistCard: {
    width: 96,
    alignItems: 'center',
    marginRight: 16,
  },
  artistAvatarWrapper: {
    width: 90,
    height: 90,
    borderRadius: 45,
    padding: 2,
    backgroundColor: 'rgba(0, 255, 204, 0.25)',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 204, 0.4)',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 8,
  },
  artistAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 45,
    backgroundColor: '#18181c',
  },
  artistName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    width: 96,
  },
  artistRole: {
    color: '#8e8e98',
    fontSize: 11,
    marginTop: 1,
  },
  moodPillsScroll: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 8,
  },
  moodSelectorPill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  moodSelectorPillActive: {
    backgroundColor: '#00ffcc',
    borderColor: '#00ffcc',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  moodSelectorPillInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  moodSelectorPillText: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
  moodSelectorPillTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  moodSelectorPillTextInactive: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '500',
  },
  moodLoadingContainer: {
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
  curatedCard: {
    width: 155,
    marginRight: 14,
  },
  curatedArtworkWrapper: {
    width: 155,
    height: 155,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#18181c',
  },
  curatedArtwork: {
    width: 155,
    height: 155,
  },
  curatedGradientOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 70,
  },
  curatedTrackBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  curatedTrackBadgeText: {
    color: '#00ffcc',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  curatedPlayButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#00ffcc',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  curatedTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
    letterSpacing: -0.2,
  },
  curatedSubtitle: {
    color: '#888888',
    fontSize: 11,
    marginTop: 2,
    letterSpacing: -0.1,
  },
  placeholder: {
    backgroundColor: '#0c0c0c',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1c1c1c',
  },
  placeholderText: {
    color: '#777785',
    textAlign: 'center',
    fontSize: 13,
  },
});
