import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  FlatList, 
  Image, 
  TouchableOpacity, 
  ActivityIndicator,
  Keyboard
} from 'react-native';
import { searchTracks, PipedSearchResult } from '../services/musicApi';
import { playTrack } from '../services/TrackPlayerService';

export function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PipedSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const executeSearch = async (text: string) => {
    if (!text.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    
    const searchResults = await searchTracks(text);
    setResults(searchResults);
    setIsLoading(false);
  };

  const handleTextChange = (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      executeSearch(text);
    }, 300);
  };

  const handleSearch = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    executeSearch(query);
    Keyboard.dismiss();
  };

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const handlePlayTrack = async (item: PipedSearchResult) => {
    try {
      const videoId = item.url.replace('/watch?v=', '');
      if (!videoId) return;

      setLoadingTrackId(videoId);
      
      await playTrack({
        id: videoId,
        title: item.title,
        artist: item.uploaderName,
        artwork: item.thumbnail,
        duration: item.duration,
        url: (item as any).streamUrl,
      });
    } catch (error) {
      console.error('Error playing track:', error);
    } finally {
      setLoadingTrackId(null);
    }
  };

  const renderItem = ({ item }: { item: PipedSearchResult }) => {
    const videoId = item.url.replace('/watch?v=', '');
    const isTrackLoading = loadingTrackId === videoId;

    return (
      <TouchableOpacity 
        style={styles.resultItem} 
        onPress={() => handlePlayTrack(item)}
        disabled={loadingTrackId !== null}
      >
        <Image 
          source={{ uri: item.thumbnail || 'https://via.placeholder.com/150' }} 
          style={styles.thumbnail} 
        />
        <View style={styles.resultInfo}>
          <Text style={styles.titleText} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.artistText} numberOfLines={1}>{item.uploaderName}</Text>
        </View>
        {isTrackLoading && (
          <ActivityIndicator color="#ffffff" style={styles.loader} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search for music..."
          placeholderTextColor="#888888"
          value={query}
          onChangeText={handleTextChange}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          selectionColor="#ffffff"
        />
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.url}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            query && !isLoading && results.length === 0 ? (
              <Text style={styles.emptyText}>No results found</Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  searchContainer: {
    padding: 16,
    backgroundColor: '#000000',
  },
  searchInput: {
    backgroundColor: '#121212',
    color: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222222',
  },
  thumbnail: {
    width: 50,
    height: 50,
    borderRadius: 4,
    backgroundColor: '#121212',
  },
  resultInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  titleText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  artistText: {
    color: '#aaaaaa',
    fontSize: 14,
  },
  loader: {
    marginLeft: 10,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#aaaaaa',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  },
});
