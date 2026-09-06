import React, { useState, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  Image, 
  ActivityIndicator,
  ScrollView,
  RefreshControl 
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getLastPlayedTrack, getListenHistory, TrackMetadata } from '../utils/storage';
import { getRecommendedTracks } from '../services/musicApi';
import { playTrack } from '../services/TrackPlayerService';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';

export function HomeScreen() {
  const [lastPlayed, setLastPlayed] = useState<TrackMetadata | null>(null);
  const [recommendations, setRecommendations] = useState<TrackMetadata[]>([]);
  const [recentTracks, setRecentTracks] = useState<TrackMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<TrackMetadata | null>(null);

  const loadData = useCallback(async () => {
    const currentLastPlayed = getLastPlayedTrack();
    const history = getListenHistory();
    setLastPlayed(currentLastPlayed);
    setRecentTracks(history);

    try {
      const results = await getRecommendedTracks();
      setRecommendations(results);
    } catch (err) {
      console.error('Error loading recommendations:', err);
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
    setIsRefreshing(false);
  };

  const handlePlayTrack = async (item: TrackMetadata) => {
    try {
      setLoadingTrackId(item.id);
      await playTrack(item);
    } catch (err) {
      console.error('Error playing track:', err);
    } finally {
      setLoadingTrackId(null);
    }
  };

  const renderTrackCard = ({ item }: { item: TrackMetadata }) => {
    const isPlayingThis = loadingTrackId === item.id;
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
            source={{ uri: item.artwork || 'https://via.placeholder.com/150' }} 
            style={styles.thumbnail} 
          />
          <TouchableOpacity 
            style={styles.playlistAddOverlay}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            onPress={(e) => {
              e.stopPropagation();
              setPlaylistModalTrack(item);
            }}
          >
            <Text style={styles.playlistAddIconText}>+</Text>
          </TouchableOpacity>
          <View style={styles.playButtonOverlay}>
            {isPlayingThis ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.playIconText}>▶</Text>
            )}
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardArtist} numberOfLines={1}>{item.artist}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl 
          refreshing={isRefreshing} 
          onRefresh={handleRefresh} 
          tintColor="#ffffff" 
          colors={['#ffffff']} 
        />
      }
    >
      <Text style={styles.headerTitle}>Sukoon</Text>

      {/* Jump Back In / Recently Played */}
      {recentTracks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Jump Back In</Text>
          <Text style={styles.subtitle}>Recently played from your listening history</Text>
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

      {/* Recommended For You */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recommended For You</Text>
        <Text style={styles.subtitle}>Personalized based on your musical taste</Text>
        
        {isLoading && !isRefreshing ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : recommendations.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No recommendations available right now. Pull down to refresh.</Text>
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

      <AddToPlaylistModal 
        visible={playlistModalTrack !== null} 
        track={playlistModalTrack} 
        onClose={() => setPlaylistModalTrack(null)} 
      />
    </ScrollView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingHorizontal: 16,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 20,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#888888',
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
    borderRadius: 8,
    backgroundColor: '#181818',
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  playButtonOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  playlistAddOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    zIndex: 5,
  },
  playlistAddIconText: {
    color: '#00ffcc',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: -2,
  },
  playIconText: {
    color: '#ffffff',
    fontSize: 12,
    marginLeft: 2,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
  },
  cardArtist: {
    color: '#888888',
    fontSize: 12,
  },
  placeholder: {
    backgroundColor: '#121212',
    padding: 20,
    borderRadius: 8,
    marginTop: 8,
  },
  placeholderText: {
    color: '#888888',
    textAlign: 'center',
    fontSize: 14,
  },
  bottomSpacer: {
    height: 60,
  },
});

