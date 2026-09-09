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
import { searchTracks, getSearchSuggestions, getAudioStream } from '../services/musicApi';
import { TrackMetadata, getRecentSearches, saveRecentSearch, clearRecentSearches } from '../utils/storage';
import { playTrack, setupPlayer } from '../services/TrackPlayerService';
import TrackPlayer, { Event, PlaybackState } from '@rntp/player';
import { hostSyncSession, inviteToSync } from '../services/syncService';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { Ionicons } from '@expo/vector-icons';

export function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isInputFocused, setIsInputFocused] = useState(false);
  
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  useEffect(() => {
    const errSub = TrackPlayer.addEventListener(Event.PlaybackError, (error: any) => {
      console.error('[NATIVE EXOPLAYER ERROR]:', error);
      Alert.alert('Playback Engine Error', `${error?.code || 'ERROR'}: ${error?.message || JSON.stringify(error)}`);
    });

    const stateSub = TrackPlayer.addEventListener(
      ((Event as any).PlaybackState || Event.PlaybackStateChanged) as any,
      (event: any) => {
        console.log('[NATIVE STATE CHANGED]:', event);
      }
    );

    const playingSub = TrackPlayer.addEventListener(Event.IsPlayingChanged, (event: any) => {
      console.log('[TRACKPLAYER IS_PLAYING]:', event?.playing);
    });

    return () => {
      errSub.remove();
      stateSub.remove();
      playingSub.remove();
    };
  }, []);

  const executeSearch = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      return;
    }
    const updated = saveRecentSearch(trimmed);
    setRecentSearches(updated);
    setIsLoading(true);
    setShowSuggestions(false);
    
    const searchResults = await searchTracks(trimmed);
    setResults(searchResults);
    setIsLoading(false);
  };

  const handleClearRecent = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  const handleRecentTap = (term: string) => {
    setQuery(term);
    setShowSuggestions(false);
    executeSearch(term);
    Keyboard.dismiss();
  };

  const handleTextChange = (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    
    if (!text.trim() || text.trim().length < 2) {
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
          setShowSuggestions(sugs.length > 0);
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

  const [selectedTrack, setSelectedTrack] = useState<TrackMetadata | null>(null);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<TrackMetadata | null>(null);
  const [showSyncInput, setShowSyncInput] = useState(false);
  const [syncUsername, setSyncUsername] = useState('');

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const openOptions = (item: TrackMetadata) => {
    setSelectedTrack(item);
    setShowSyncInput(false);
    setSyncUsername('');
    Keyboard.dismiss();
  };

  const handlePlayNow = async (track: TrackMetadata) => {
    setSelectedTrack(null);
    setShowSyncInput(false);
    setSyncUsername('');
    
    try {
      setLoadingTrackId(track.id);

      // Defensive player readiness check
      try {
        if (typeof (TrackPlayer as any).getActiveTrack === 'function') {
          await (TrackPlayer as any).getActiveTrack();
        } else if (typeof TrackPlayer.getActiveMediaItemIndex === 'function') {
          TrackPlayer.getActiveMediaItemIndex();
        }
      } catch {
        await setupPlayer();
      }

      // Must resolve stream URL first
      const streamResult = await getAudioStream(track.id);

      // Handle both string and { url: string } formats defensively
      let resolvedUrl: string | null = null;
      if (typeof streamResult === 'string') {
        resolvedUrl = streamResult;
      } else if (streamResult && typeof (streamResult as any).url === 'string') {
        resolvedUrl = (streamResult as any).url;
      }
      
      if (!resolvedUrl || !resolvedUrl.startsWith('http')) {
        setLoadingTrackId(null);
        Alert.alert('Stream Error', 'Could not resolve audio stream for this song.');
        return;
      }

      await playTrack({
        ...track,
        url: resolvedUrl
      }, []); // Pass empty queue so algorithmic recommendations engine populates genuine radio tracks
    } catch (err: any) {
      console.error('Playback Error:', err);
      Alert.alert('Playback Execution Error', `${err?.name}: ${err?.message}`);
    } finally {
      setLoadingTrackId(null);
    }
  };

  const handleStartSync = async (item: TrackMetadata) => {
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

  const renderItem = ({ item }: { item: TrackMetadata }) => {
    const isTrackLoading = loadingTrackId === item.id;

    return (
      <TouchableOpacity 
        style={styles.resultItem} 
        onPress={() => handlePlayNow(item)}
        onLongPress={() => openOptions(item)}
        activeOpacity={0.7}
        disabled={isTrackLoading}
      >
        <Image 
          source={{ uri: item.artwork || 'https://via.placeholder.com/150' }} 
          style={styles.thumbnail} 
        />
        <View style={styles.resultInfo}>
          <Text style={styles.titleText} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.artistText} numberOfLines={1}>{item.artist}</Text>
        </View>
        <TouchableOpacity
          onPress={() => openOptions(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ padding: 8 }}
        >
          <Ionicons name="ellipsis-vertical" size={18} color="#666666" />
        </TouchableOpacity>
        {isTrackLoading && (
          <ActivityIndicator color="#ffffff" style={styles.loader} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <View style={styles.searchBarContainer}>
          <Ionicons name="search" size={20} color="#888888" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search songs, artists..."
            placeholderTextColor="#888"
            value={query}
            onChangeText={handleTextChange}
            onFocus={() => setIsInputFocused(true)}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity 
              onPress={() => {
                if (debounceTimer.current) clearTimeout(debounceTimer.current);
                if (abortControllerRef.current) abortControllerRef.current.abort();
                setQuery('');
                handleTextChange('');
                setResults([]);
                setShowSuggestions(false);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.clearSearchButton}
            >
              <Ionicons color="#777777" name="close-circle" size={20}/>
            </TouchableOpacity>
          )}
        </View>
      </View>
      
      {query.trim().length >= 2 && showSuggestions && suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          {suggestions.slice(0, 8).map((suggestion, index) => (
            <TouchableOpacity 
              key={index} 
              style={styles.suggestionItem}
              onPress={() => handleSuggestionTap(suggestion)}
            >
              <Text style={styles.suggestionIcon}>🔍</Text>
              <Text style={styles.suggestionText} numberOfLines={1}>{suggestion}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!query.trim() && recentSearches.length > 0 && results.length === 0 && !isLoading && (
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>Recent Searches</Text>
            <TouchableOpacity onPress={handleClearRecent} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearText}>Clear All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.recentList}>
            {recentSearches.map((term, index) => (
              <TouchableOpacity
                key={`${term}-${index}`}
                style={styles.recentItem}
                onPress={() => handleRecentTap(term)}
              >
                <Text style={styles.recentIcon}>🕒</Text>
                <Text style={styles.recentItemText} numberOfLines={1}>{term}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
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
                  <Image source={{ uri: selectedTrack.artwork || 'https://via.placeholder.com/150' }} style={styles.modalThumbnail} />
                  <View style={styles.modalInfo}>
                    <Text style={styles.modalTitle} numberOfLines={1}>{selectedTrack.title}</Text>
                    <Text style={styles.modalArtist} numberOfLines={1}>{selectedTrack.artist}</Text>
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

                <Pressable 
                  style={styles.actionButton} 
                  onPress={() => {
                    const trackToAdd = selectedTrack;
                    setSelectedTrack(null);
                    setPlaylistModalTrack(trackToAdd);
                  }}
                >
                  <Text style={styles.actionIcon}>➕</Text>
                  <Text style={styles.actionText}>Add to Playlist</Text>
                </Pressable>

                <Pressable style={styles.actionButton} onPress={handleSaveToLibrary}>
                  <Text style={styles.actionIcon}>💾</Text>
                  <Text style={styles.actionText}>Save to Library</Text>
                </Pressable>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <AddToPlaylistModal 
        visible={playlistModalTrack !== null} 
        track={playlistModalTrack} 
        onClose={() => setPlaylistModalTrack(null)} 
      />
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
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderRadius: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#222222',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    paddingVertical: 12,
    fontSize: 16,
  },
  clearSearchButton: {
    padding: 4,
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
    top: 76,
    left: 16,
    right: 16,
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    zIndex: 1000,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#333333',
    maxHeight: 280,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  suggestionIcon: {
    fontSize: 14,
    marginRight: 12,
    color: '#888888',
  },
  suggestionText: {
    color: '#ffffff',
    fontSize: 15,
    flex: 1,
  },
  recentSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  recentTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  clearText: {
    color: '#ff5252',
    fontSize: 14,
    fontWeight: '600',
  },
  recentList: {
    marginTop: 4,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222222',
  },
  recentIcon: {
    fontSize: 15,
    marginRight: 12,
  },
  recentItemText: {
    color: '#e0e0e0',
    fontSize: 15,
    flex: 1,
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
