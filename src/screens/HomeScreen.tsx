import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getLastPlayedTrack, TrackMetadata } from '../utils/storage';
import { getRelatedTracks } from '../services/musicApi';
import { playTrack } from '../services/TrackPlayerService';

export function HomeScreen() {
  const [lastPlayed, setLastPlayed] = useState<TrackMetadata | null>(null);
  const [recommendations, setRecommendations] = useState<TrackMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const track = getLastPlayedTrack();
      if (track && track.id !== lastPlayed?.id) {
        setLastPlayed(track);
        fetchRecommendations(track.id);
      }
    }, [lastPlayed?.id])
  );

  const fetchRecommendations = async (videoId: string) => {
    setIsLoading(true);
    const results = await getRelatedTracks(videoId);
    setRecommendations(results);
    setIsLoading(false);
  };

  const handlePlayTrack = async (item: TrackMetadata) => {
    await playTrack({
      id: item.id,
      title: item.title,
      artist: item.artist,
      artwork: item.artwork,
      duration: item.duration,
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
      
      {isLoading ? (
        <ActivityIndicator color="#ffffff" style={styles.loader} />
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recommended For You</Text>
          {recommendations.length === 0 ? (
            <Text style={styles.subtitle}>No recommendations available right now.</Text>
          ) : (
            <FlatList
              horizontal
              data={recommendations}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.card} 
                  activeOpacity={0.8}
                  onPress={() => handlePlayTrack(item)}
                >
                  <Image source={{ uri: item.artwork }} style={styles.thumbnail} />
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.cardArtist} numberOfLines={1}>{item.artist}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      )}

      {!lastPlayed && (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Play a track to get recommendations</Text>
        </View>
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
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  section: {
    marginTop: 10,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#aaaaaa',
    fontSize: 14,
    marginBottom: 16,
    marginTop: 4,
  },
  loader: {
    marginTop: 20,
    alignSelf: 'flex-start',
  },
  listContent: {
    paddingRight: 16,
  },
  card: {
    width: 140,
    marginRight: 16,
  },
  thumbnail: {
    width: 140,
    height: 140,
    borderRadius: 8,
    backgroundColor: '#121212',
    marginBottom: 8,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  cardArtist: {
    color: '#aaaaaa',
    fontSize: 12,
  },
  placeholder: {
    backgroundColor: '#121212',
    padding: 20,
    borderRadius: 8,
    marginTop: 20,
  },
  placeholderText: {
    color: '#aaaaaa',
    textAlign: 'center',
  },
});
