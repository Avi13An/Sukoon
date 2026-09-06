import React, { useState, useCallback, useEffect } from 'react';
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
  Dimensions 
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { getLastPlayedTrack, getListenHistory, TrackMetadata } from '../utils/storage';
import { getRecommendedTracks, searchTracks } from '../services/musicApi';
import { playTrack, clearUpNextQueue, addToUpNextQueue } from '../services/TrackPlayerService';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';

const { width } = Dimensions.get('window');

const CATEGORIES = [
  'All', 
  'Trending', 
  'Bollywood', 
  'Punjabi', 
  'Acoustic', 
  'Lo-Fi', 
  'Sufi', 
  'Workout'
];

interface MoodMix {
  id: string;
  title: string;
  subtitle: string;
  query: string;
  colors: [string, string, string];
  icon: keyof typeof Ionicons.glyphMap;
}

const MOOD_MIXES: MoodMix[] = [
  {
    id: 'mix-1',
    title: 'Late Night Chill',
    subtitle: 'Mellow Lo-Fi & ambient beats',
    query: 'Late night lofi chill songs',
    colors: ['#3b1d60', '#1c0f33', '#110920'],
    icon: 'moon',
  },
  {
    id: 'mix-2',
    title: 'Bollywood Acoustic',
    subtitle: 'Soul-stirring unplugged melodies',
    query: 'Bollywood acoustic unplugged songs',
    colors: ['#60231d', '#33130f', '#200b09'],
    icon: 'musical-note',
  },
  {
    id: 'mix-3',
    title: 'Punjabi Bangers',
    subtitle: 'High energy Punjabi party hits',
    query: 'Punjabi top hits songs',
    colors: ['#604a1d', '#33270f', '#201809'],
    icon: 'flame',
  },
  {
    id: 'mix-4',
    title: 'Soulful Sufi',
    subtitle: 'Timeless spiritual qawwalis & sufi',
    query: 'Soulful sufi songs hits',
    colors: ['#1d5360', '#0f2933', '#091b20'],
    icon: 'heart',
  },
];

export function HomeScreen() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [recommendations, setRecommendations] = useState<TrackMetadata[]>([]);
  const [trendingTracks, setTrendingTracks] = useState<TrackMetadata[]>([]);
  const [categoryTracks, setCategoryTracks] = useState<TrackMetadata[]>([]);
  const [recentTracks, setRecentTracks] = useState<TrackMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCategoryLoading, setIsCategoryLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<TrackMetadata | null>(null);

  const loadData = useCallback(async () => {
    const history = getListenHistory();
    setRecentTracks(history);

    try {
      const [recs, trending] = await Promise.all([
        getRecommendedTracks(),
        searchTracks('Trending Indian music hits 2024')
      ]);
      setRecommendations(recs);
      setTrendingTracks(trending.slice(0, 10));
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    if (selectedCategory !== 'All') {
      await handleSelectCategory(selectedCategory);
    }
    setIsRefreshing(false);
  };

  const handleSelectCategory = async (cat: string) => {
    setSelectedCategory(cat);
    if (cat === 'All') {
      setCategoryTracks([]);
      return;
    }
    setIsCategoryLoading(true);
    try {
      const query = cat === 'Trending' ? 'Trending chart hits' : `${cat} top songs hits`;
      const res = await searchTracks(query);
      setCategoryTracks(res.slice(0, 12));
    } catch (e) {
      console.error('[HomeScreen] Category fetch error:', e);
    } finally {
      setIsCategoryLoading(false);
    }
  };

  const handlePlayTrack = async (item: TrackMetadata) => {
    try {
      setLoadingTrackId(item.id);
      await playTrack(item);
    } catch (err) {
      console.error('[HomeScreen] Error playing track:', err);
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handlePlayMoodMix = async (mix: MoodMix) => {
    try {
      setIsLoading(true);
      const tracks = await searchTracks(mix.query);
      if (tracks && tracks.length > 0) {
        clearUpNextQueue();
        tracks.slice(1, 10).forEach(t => addToUpNextQueue(t));
        await playTrack(tracks[0]);
      }
    } catch (err) {
      console.error('[HomeScreen] Error playing mood mix:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const renderTrackCard = ({ item }: { item: TrackMetadata }) => {
    const isPlayingThis = loadingTrackId === item.id;
    const artwork = item.artwork || (item as any)?.artworkUrl || (item as any)?.thumbnail || 'https://via.placeholder.com/150';

    return (
      <TouchableOpacity 
        style={styles.card} 
        activeOpacity={0.8}
        onPress={() => handlePlayTrack(item)}
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
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardArtist} numberOfLines={1}>{item.artist}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView 
        style={styles.container}
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
        {/* Glowing Top Banner & Hero Header */}
        <LinearGradient 
          colors={['rgba(0, 255, 204, 0.18)', 'rgba(10, 10, 15, 0.85)', '#000000']} 
          style={styles.heroHeader}
        >
          <View style={styles.heroTopRow}>
            <View>
              <Text style={styles.brandTitle}>Sukoon</Text>
              <Text style={styles.brandTagline}>Your Sanctuary of Pure Sound</Text>
            </View>
            <View style={styles.brandPill}>
              <View style={styles.greenDot} />
              <Text style={styles.brandPillText}>LOSSLESS DSP</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Dynamic Category Chips */}
        <View style={styles.chipsSection}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
          >
            {CATEGORIES.map((cat) => {
              const isActive = selectedCategory === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                  onPress={() => handleSelectCategory(cat)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Filtered Category Carousel (when a specific category is chosen) */}
        {selectedCategory !== 'All' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{selectedCategory} Mix</Text>
              <Text style={styles.sectionAccent}>Curated Vibe</Text>
            </View>
            <Text style={styles.subtitle}>Handpicked {selectedCategory.toLowerCase()} tracks for your mood</Text>

            {isCategoryLoading ? (
              <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color="#00ffcc" />
              </View>
            ) : (
              <FlatList
                horizontal
                data={categoryTracks}
                keyExtractor={(item, index) => `cat-${item.id}-${index}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
                renderItem={renderTrackCard}
              />
            )}
          </View>
        )}

        {/* Jump Back In (Listening History) */}
        {recentTracks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Jump Back In</Text>
              <Ionicons name="time-outline" size={18} color="#00ffcc" />
            </View>
            <Text style={styles.subtitle}>Pick up right where you left off</Text>
            <FlatList
              horizontal
              data={recentTracks.slice(0, 10)}
              keyExtractor={(item, index) => `recent-${item.id}-${index}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={renderTrackCard}
            />
          </View>
        )}

        {/* Trending & New Releases */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Trending & New Releases</Text>
            <View style={styles.hotBadge}>
              <Text style={styles.hotBadgeText}>🔥 HOT</Text>
            </View>
          </View>
          <Text style={styles.subtitle}>Top charts and viral releases right now</Text>
          
          {isLoading && !isRefreshing ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color="#00ffcc" />
            </View>
          ) : (
            <FlatList
              horizontal
              data={trendingTracks.length > 0 ? trendingTracks : recommendations.slice(0, 8)}
              keyExtractor={(item, index) => `trend-${item.id}-${index}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={renderTrackCard}
            />
          )}
        </View>

        {/* Mood & Genre Mixes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mood & Genre Mixes</Text>
          <Text style={styles.subtitle}>One-tap infinite stations designed for every feeling</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.moodScroll}
          >
            {MOOD_MIXES.map((mix) => (
              <TouchableOpacity
                key={mix.id}
                style={styles.moodCard}
                onPress={() => handlePlayMoodMix(mix)}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={mix.colors}
                  style={styles.moodGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <View style={styles.moodTopRow}>
                    <Ionicons name={mix.icon} size={22} color="#ffffff" />
                    <View style={styles.moodPlayIcon}>
                      <Ionicons name="play" size={14} color="#000000" style={{ marginLeft: 2 }} />
                    </View>
                  </View>
                  <View>
                    <Text style={styles.moodTitle}>{mix.title}</Text>
                    <Text style={styles.moodSubtitle} numberOfLines={1}>{mix.subtitle}</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Recommended For You */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recommended For You</Text>
            <Ionicons name="sparkles-outline" size={18} color="#00ffcc" />
          </View>
          <Text style={styles.subtitle}>Crafted specifically for your acoustic taste</Text>
          
          {isLoading && !isRefreshing ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color="#00ffcc" />
            </View>
          ) : recommendations.length === 0 ? (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>Pull down to discover fresh tracks tailored for you.</Text>
            </View>
          ) : (
            <FlatList
              horizontal
              data={recommendations}
              keyExtractor={(item, index) => `rec-${item.id}-${index}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={renderTrackCard}
            />
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <AddToPlaylistModal 
        visible={playlistModalTrack !== null} 
        track={playlistModalTrack} 
        onClose={() => setPlaylistModalTrack(null)} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  container: {
    flex: 1,
  },
  heroHeader: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  brandTagline: {
    color: '#8e8e98',
    fontSize: 13,
    marginTop: 2,
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.3)',
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00ffcc',
    marginRight: 6,
  },
  brandPillText: {
    color: '#00ffcc',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  chipsSection: {
    marginBottom: 20,
  },
  chipsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  categoryChip: {
    backgroundColor: '#16161b',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#24242e',
  },
  categoryChipActive: {
    backgroundColor: '#00ffcc',
    borderColor: '#00ffcc',
  },
  categoryChipText: {
    color: '#a0a0ab',
    fontSize: 13,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  section: {
    marginBottom: 28,
    paddingHorizontal: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionAccent: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '700',
  },
  hotBadge: {
    backgroundColor: 'rgba(255, 85, 85, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 85, 85, 0.3)',
  },
  hotBadgeText: {
    color: '#ff5555',
    fontSize: 10,
    fontWeight: '800',
  },
  subtitle: {
    color: '#777782',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 14,
  },
  loaderContainer: {
    paddingVertical: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingRight: 16,
  },
  card: {
    width: 140,
    marginRight: 14,
  },
  thumbnailContainer: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: '#18181f',
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#24242e',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  cardGradientOverlay: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: 60,
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
  moodScroll: {
    paddingRight: 16,
    gap: 12,
  },
  moodCard: {
    width: 200,
    height: 110,
    borderRadius: 16,
    overflow: 'hidden',
  },
  moodGradient: {
    flex: 1,
    padding: 14,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  moodTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  moodPlayIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 2,
  },
  moodSubtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
  },
  placeholder: {
    backgroundColor: '#14141a',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#22222b',
  },
  placeholderText: {
    color: '#777785',
    textAlign: 'center',
    fontSize: 13,
  },
  bottomSpacer: {
    height: 100,
  },
});
