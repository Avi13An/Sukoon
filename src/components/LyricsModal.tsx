import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  ScrollView, 
  FlatList, 
  ActivityIndicator, 
  Dimensions, 
  TextInput,
  TouchableWithoutFeedback 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchLyrics, ParsedLyrics, sanitizeLyricText } from '../services/lyricsService';
import { TrackMetadata } from '../utils/storage';

const { height, width } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
  track: TrackMetadata | null;
  currentPosition: number;
  duration?: number;
  onSeek?: (seconds: number) => void;
}

export function LyricsModal({ 
  visible, 
  onClose, 
  track, 
  currentPosition, 
  duration, 
  onSeek 
}: Props) {
  const [lyricsData, setLyricsData] = useState<ParsedLyrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [customSearchQuery, setCustomSearchQuery] = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);
  
  const flatListRef = useRef<FlatList>(null);
  const lastActiveIndex = useRef<number>(-1);

  const loadLyrics = async (customQuery?: string) => {
    if (!track && !customQuery) return;
    setIsLoading(true);
    try {
      const searchTitle = customQuery ? customQuery : (track?.title || '');
      const searchArtist = customQuery ? '' : (track?.artist || '');
      const res = await fetchLyrics(searchTitle, searchArtist, duration);
      setLyricsData(res);
    } catch (e) {
      console.error('[LyricsModal] Error loading lyrics:', e);
      setLyricsData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (visible && track) {
      setCustomSearchQuery('');
      setShowSearchInput(false);
      loadLyrics();
    }
  }, [visible, track?.id]);

  // Find active line index
  let activeLineIndex = -1;
  if (lyricsData?.lines && lyricsData.lines.length > 0) {
    const idx = lyricsData.lines.findIndex(line => line.time > currentPosition) - 1;
    if (idx === -2) {
      activeLineIndex = lyricsData.lines.length - 1;
    } else {
      activeLineIndex = Math.max(0, idx);
    }
  }

  // Smoothly auto-scroll to keep active line centered
  useEffect(() => {
    if (
      lyricsData?.synced && 
      activeLineIndex >= 0 && 
      activeLineIndex !== lastActiveIndex.current && 
      flatListRef.current
    ) {
      lastActiveIndex.current = activeLineIndex;
      try {
        flatListRef.current.scrollToIndex({
          index: activeLineIndex,
          animated: true,
          viewPosition: 0.35,
        });
      } catch (err) {
        // Fallback for unmeasured list
      }
    }
  }, [activeLineIndex, lyricsData?.synced]);

  const handleCustomSearch = () => {
    if (!customSearchQuery.trim()) return;
    loadLyrics(customSearchQuery.trim());
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <View style={styles.sheetContainer}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleCol}>
              <View style={styles.headerBadgeRow}>
                <Ionicons name="text" size={16} color="#00ffcc" />
                <Text style={styles.headerTitle}>
                  {lyricsData?.synced ? 'Live Synced Lyrics' : 'Lyrics'}
                </Text>
              </View>
              <Text style={styles.subTitle} numberOfLines={1}>
                {track?.title} • {track?.artist}
              </Text>
            </View>

            <View style={styles.headerActions}>
              <TouchableOpacity 
                style={styles.iconBtn} 
                onPress={() => setShowSearchInput(!showSearchInput)}
              >
                <Ionicons name="search" size={20} color="#aaaaaa" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={onClose}>
                <Ionicons name="close" size={24} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Alternate Search Input */}
          {showSearchInput && (
            <View style={styles.searchBarRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search song or alternate title..."
                placeholderTextColor="#666675"
                value={customSearchQuery}
                onChangeText={setCustomSearchQuery}
                onSubmitEditing={handleCustomSearch}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchSubmitBtn} onPress={handleCustomSearch}>
                <Text style={styles.searchSubmitText}>Find</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Content Body */}
          <View style={styles.contentBody}>
            {isLoading ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#00ffcc" />
                <Text style={styles.loadingText}>Fetching lyrics from LRCLIB...</Text>
              </View>
            ) : lyricsData?.synced && lyricsData.lines.length > 0 ? (
              <FlatList
                ref={flatListRef}
                data={lyricsData.lines}
                keyExtractor={(item, index) => `${index}-${item.time}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.syncedListContent}
                getItemLayout={(_, index) => ({
                  length: 56,
                  offset: 56 * index,
                  index,
                })}
                onScrollToIndexFailed={(info) => {
                  setTimeout(() => {
                    flatListRef.current?.scrollToOffset({
                      offset: info.index * 56,
                      animated: true,
                    });
                  }, 100);
                }}
                renderItem={({ item, index }) => {
                  const isActive = index === activeLineIndex;
                  const isPassed = index < activeLineIndex;

                  return (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => onSeek && onSeek(item.time)}
                      style={[
                        styles.lineWrapper,
                        isActive && styles.activeLineWrapper
                      ]}
                    >
                      <Text
                        style={[
                          styles.lyricLine,
                          isActive && styles.activeLyricLine,
                          isPassed && styles.passedLyricLine,
                        ]}
                      >
                        {sanitizeLyricText(item.text) || '♪'}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            ) : lyricsData?.plainLyrics ? (
              <ScrollView 
                contentContainerStyle={styles.plainScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.plainLyricsText}>{lyricsData.plainLyrics}</Text>
              </ScrollView>
            ) : (
              <View style={styles.centerContainer}>
                <Ionicons name="musical-notes-outline" size={48} color="#33333d" />
                <Text style={styles.noLyricsTitle}>No Lyrics Found</Text>
                <Text style={styles.noLyricsSubtitle}>
                  Lyrics for this track aren't available on LRCLIB yet.
                </Text>
                <TouchableOpacity 
                  style={styles.retryBtn}
                  onPress={() => setShowSearchInput(true)}
                >
                  <Ionicons name="search" size={16} color="#000000" />
                  <Text style={styles.retryBtnText}>Search Alternate Title</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  backdrop: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#121217',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    height: height * 0.82,
    borderTopWidth: 1,
    borderColor: '#26262e',
  },
  handle: {
    width: 44,
    height: 5,
    backgroundColor: '#33333d',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleCol: {
    flex: 1,
    marginRight: 12,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  headerTitle: {
    color: '#00ffcc',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subTitle: {
    color: '#888896',
    fontSize: 13,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    padding: 6,
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2c2c38',
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14,
    paddingVertical: 10,
  },
  searchSubmitBtn: {
    backgroundColor: '#00ffcc',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  searchSubmitText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
  contentBody: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#888896',
    fontSize: 13,
    marginTop: 12,
  },
  syncedListContent: {
    paddingVertical: height * 0.25,
  },
  lineWrapper: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginVertical: 2,
  },
  activeLineWrapper: {
    backgroundColor: 'rgba(0, 255, 204, 0.08)',
  },
  lyricLine: {
    color: '#8e8e9e',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 26,
    textAlign: 'center',
  },
  activeLyricLine: {
    color: '#00ffcc',
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 30,
    textShadowColor: 'rgba(0, 255, 204, 0.3)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  passedLyricLine: {
    color: '#555562',
  },
  plainScrollContent: {
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  plainLyricsText: {
    color: '#dddddf',
    fontSize: 16,
    lineHeight: 28,
    textAlign: 'center',
  },
  noLyricsTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
  },
  noLyricsSubtitle: {
    color: '#777785',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00ffcc',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  retryBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
});
