import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  FlatList, 
  Image, 
  TouchableOpacity, 
  Pressable,
  ActivityIndicator,
  Keyboard,
  Modal,
  Alert
} from 'react-native';
import { searchTracks, getSearchSuggestions, PipedSearchResult } from '../services/musicApi';
import { playTrack, setupPlayer } from '../services/TrackPlayerService';
import TrackPlayer, { Event } from '@rntp/player';
import { hostSyncSession, inviteToSync } from '../services/syncService';

export function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PipedSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackError, (event: any) => {
      Alert.alert("Native Player Error", JSON.stringify(event));
    });
    return () => sub.remove();
  }, []);

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
    
    if (!text.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }
    
    debounceTimer.current = setTimeout(async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      
      try {
        const sugs = await getSearchSuggestions(text, controller.signal);
        if (!controller.signal.aborted) {
          setSuggestions(sugs);
          setShowSuggestions(true);
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('Error fetching suggestions:', error);
        }
      }
    }, 300);
  };

  const handleSearch = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setShowSuggestions(false);
    executeSearch(query);
    Keyboard.dismiss();
  };

  const handleSuggestionTap = (sug: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setQuery(sug);
    setShowSuggestions(false);
    executeSearch(sug);
    Keyboard.dismiss();
  };

  const [selectedTrack, setSelectedTrack] = useState<PipedSearchResult | null>(null);
  const [showSyncInput, setShowSyncInput] = useState(false);
  const [syncUsername, setSyncUsername] = useState('');

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const openOptions = (item: PipedSearchResult) => {
    setSelectedTrack(item);
    setShowSyncInput(false);
    setSyncUsername('');
    Keyboard.dismiss();
  };

  const handlePlayNow = async (item: PipedSearchResult) => {
    setSelectedTrack(null);
    setShowSyncInput(false);
    setSyncUsername('');
    
    try {
      await setupPlayer();
      await TrackPlayer.clear(); // Flush dead buffers

      const videoId = item.url.replace('/watch?v=', '');
      setLoadingTrackId(videoId);
      
      const streamRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
      const streamData = await streamRes.json();
      
      const audioStream = streamData.audioStreams?.find((s: any) => s.format === 'M4A' || s.mimeType.includes('mp4a')) || streamData.audioStreams?.[0];
      
      if (!audioStream?.url) {
        throw new Error("Audio stream not found");
      }
      
      const trackPayload = {
        id: videoId,
        url: audioStream.url,
        title: item.title,
        artist: item.uploaderName,
        artwork: item.thumbnail,
      };

      await TrackPlayer.setMediaItems([trackPayload as any]);
      await TrackPlayer.play();
    } catch (error: any) {
      console.error('Error playing track:', error);
      Alert.alert('Playback Error', error?.message || "Failed to load audio stream.");
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handleStartSync = async (item: PipedSearchResult) => {
    if (!syncUsername.trim()) return;
    const target = syncUsername.trim();
    
    setSelectedTrack(null);
    setShowSyncInput(false);
    setSyncUsername('');
    
    // Broadcast invite and begin hosting
    hostSyncSession(target);
    inviteToSync(target);
    
    // Start playing first to set the TrackPlayer item
    await handlePlayNow(item);
  };

  const handleSaveToLibrary = () => {
    Alert.alert('Saved', 'Saved to Library');
    setSelectedTrack(null);
  };

  const renderItem = ({ item }: { item: PipedSearchResult }) => {
    const videoId = item.url.replace('/watch?v=', '');
    const isTrackLoading = loadingTrackId === videoId;

    return (
      <TouchableOpacity 
        style={styles.resultItem} 
        onPress={() => openOptions(item)}
        activeOpacity={0.7}
        disabled={isTrackLoading}
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
        
        {showSuggestions && suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            {suggestions.map((sug, index) => (
              <TouchableOpacity 
                key={index} 
                style={styles.suggestionItem} 
                onPress={() => handleSuggestionTap(sug)}
              >
                <Text style={styles.suggestionText}>{sug}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
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

      <Modal
        visible={selectedTrack !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSelectedTrack(null)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedTrack(null)}>
          <View style={styles.bottomSheet}>
            {selectedTrack && (
              <>
                <View style={styles.modalHeader}>
                  <Image source={{ uri: selectedTrack.thumbnail || 'https://via.placeholder.com/150' }} style={styles.modalThumbnail} />
                  <View style={styles.modalInfo}>
                    <Text style={styles.modalTitle} numberOfLines={1}>{selectedTrack.title}</Text>
                    <Text style={styles.modalArtist} numberOfLines={1}>{selectedTrack.uploaderName}</Text>
                  </View>
                </View>
                
                <Pressable style={styles.actionButton} onPress={() => handlePlayNow(selectedTrack)}>
                  <Text style={styles.actionIcon}>🎵</Text>
                  <Text style={styles.actionText}>Play Now</Text>
                </Pressable>
                
                {showSyncInput ? (
                  <View style={styles.syncInputContainer}>
                     <TextInput 
                        style={styles.syncInput} 
                        placeholder="Friend's Username" 
                        placeholderTextColor="#888" 
                        value={syncUsername}
                        onChangeText={setSyncUsername}
                        autoCapitalize="none"
                     />
                     <Pressable style={styles.syncSubmitBtn} onPress={() => handleStartSync(selectedTrack)}>
                       <Text style={styles.syncSubmitText}>Host</Text>
                     </Pressable>
                  </View>
                ) : (
                  <Pressable style={styles.actionButton} onPress={() => setShowSyncInput(true)}>
                    <Text style={styles.actionIcon}>👥</Text>
                    <Text style={styles.actionText}>Start Co-Sync Party</Text>
                  </Pressable>
                )}

                <Pressable style={styles.actionButton} onPress={handleSaveToLibrary}>
                  <Text style={styles.actionIcon}>💾</Text>
                  <Text style={styles.actionText}>Save to Library</Text>
                </Pressable>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
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
  suggestionsContainer: {
    position: 'absolute',
    top: 68,
    left: 16,
    right: 16,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    zIndex: 100,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#333333',
    maxHeight: 200,
  },
  suggestionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333333',
  },
  suggestionText: {
    color: '#ffffff',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#121212',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    minHeight: 250,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333333',
    paddingBottom: 16,
  },
  modalThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 6,
    backgroundColor: '#333333',
  },
  modalInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  modalArtist: {
    color: '#aaaaaa',
    fontSize: 14,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  actionIcon: {
    fontSize: 20,
    marginRight: 16,
  },
  actionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  syncInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  syncInput: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    color: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#333333',
  },
  syncSubmitBtn: {
    backgroundColor: '#00ffcc',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  syncSubmitText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
