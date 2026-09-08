import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  FlatList, 
  Image, 
  Dimensions, 
  ActivityIndicator,
  TouchableWithoutFeedback 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { 
  TrackMetadata 
} from '../utils/storage';
import { 
  subscribeToQueue, 
  removeTrackFromQueue, 
  reorderQueue, 
  clearUpNextQueue, 
  playTrack, 
  maintainMinimumQueue 
} from '../services/TrackPlayerService';

const { height } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
  currentTrack: TrackMetadata | null;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function QueueModal({ visible, onClose, currentTrack }: Props) {
  const [queue, setQueue] = useState<TrackMetadata[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToQueue((newQueue) => {
      setQueue(newQueue);
    });
    return () => unsubscribe();
  }, []);

  const handlePlaySong = async (item: TrackMetadata) => {
    onClose();
    await playTrack(item, undefined, { fromQueue: true });
  };

  const handleGenerateSongs = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      await maintainMinimumQueue(10);
    } finally {
      setIsGenerating(false);
    }
  };

  const currentArtwork = 
    currentTrack?.artwork || 
    (currentTrack as any)?.artworkUrl || 
    (currentTrack as any)?.thumbnail || 
    'https://via.placeholder.com/150';

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
          {/* Grab Handle */}
          <View style={styles.handle} />

          {/* Modal Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="list" size={22} color="#00ffcc" style={styles.headerIcon} />
              <Text style={styles.headerTitle}>Queue & Autoplay</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#aaaaaa" />
            </TouchableOpacity>
          </View>

          {/* Section 1: Now Playing */}
          {currentTrack && (
            <View style={styles.nowPlayingSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>NOW PLAYING</Text>
                <View style={styles.playingBadge}>
                  <View style={styles.greenPulseDot} />
                  <Text style={styles.playingBadgeText}>PLAYING</Text>
                </View>
              </View>

              <View style={styles.nowPlayingCard}>
                <Image 
                  source={{ uri: currentArtwork }} 
                  style={styles.nowPlayingThumb} 
                  resizeMode="cover"
                />
                <View style={styles.nowPlayingInfo}>
                  <Text style={styles.nowPlayingTitle} numberOfLines={1}>
                    {currentTrack.title || 'Unknown Title'}
                  </Text>
                  <Text style={styles.nowPlayingArtist} numberOfLines={1}>
                    {currentTrack.artist || 'Unknown Artist'}
                  </Text>
                </View>
                <Ionicons name="volume-medium" size={22} color="#00ffcc" />
              </View>
            </View>
          )}

          {/* Section 2: Up Next */}
          <View style={styles.upNextSection}>
            <View style={styles.upNextHeaderRow}>
              <View style={styles.countBadgeRow}>
                <Text style={styles.sectionHeading}>UP NEXT</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{queue.length}</Text>
                </View>
              </View>

              {queue.length > 0 && (
                <TouchableOpacity onPress={clearUpNextQueue} style={styles.clearBtn}>
                  <Ionicons name="trash-outline" size={14} color="#ff5555" />
                  <Text style={styles.clearBtnText}>Clear All</Text>
                </TouchableOpacity>
              )}
            </View>

            {queue.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="musical-notes-outline" size={48} color="#33333d" />
                <Text style={styles.emptyTitle}>Queue is Empty</Text>
                <Text style={styles.emptySubtitle}>
                  Infinite Autoplay will automatically discover and play similar music when this song ends.
                </Text>
                <TouchableOpacity 
                  style={styles.generateBtn}
                  onPress={handleGenerateSongs}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={16} color="#000000" />
                      <Text style={styles.generateBtnText}>Generate Related Songs</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={queue}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
                renderItem={({ item, index }) => {
                  const itemArtwork = 
                    item.artwork || 
                    (item as any)?.artworkUrl || 
                    (item as any)?.thumbnail || 
                    'https://via.placeholder.com/150';
                  const isFirst = index === 0;
                  const isLast = index === queue.length - 1;

                  return (
                    <TouchableOpacity 
                      style={styles.queueItem}
                      onPress={() => handlePlaySong(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.itemIndex}>#{index + 1}</Text>
                      
                      <Image 
                        source={{ uri: itemArtwork }} 
                        style={styles.itemThumb} 
                        resizeMode="cover"
                      />

                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle} numberOfLines={1}>
                          {item.title || 'Unknown Title'}
                        </Text>
                        <View style={styles.itemSubRow}>
                          <Text style={styles.itemArtist} numberOfLines={1}>
                            {item.artist || 'Unknown Artist'}
                          </Text>
                          {item.duration ? (
                            <Text style={styles.itemDuration}>
                              • {formatDuration(item.duration)}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      {/* Reorder & Remove Actions */}
                      <View style={styles.actionsRow}>
                        <TouchableOpacity 
                          style={[styles.actionBtn, isFirst && styles.actionBtnDisabled]}
                          onPress={() => !isFirst && reorderQueue(index, index - 1)}
                          disabled={isFirst}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        >
                          <Ionicons 
                            name="chevron-up" 
                            size={18} 
                            color={isFirst ? '#44444e' : '#00ffcc'} 
                          />
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={[styles.actionBtn, isLast && styles.actionBtnDisabled]}
                          onPress={() => !isLast && reorderQueue(index, index + 1)}
                          disabled={isLast}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        >
                          <Ionicons 
                            name="chevron-down" 
                            size={18} 
                            color={isLast ? '#44444e' : '#00ffcc'} 
                          />
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={styles.actionBtn}
                          onPress={() => removeTrackFromQueue(index)}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        >
                          <Ionicons name="close-circle-outline" size={18} color="#ff5555" />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
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
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  backdrop: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#141418',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    maxHeight: height * 0.85,
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
    marginBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    marginRight: 8,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  nowPlayingSection: {
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionHeading: {
    color: '#777782',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  playingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.3)',
  },
  greenPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00ffcc',
    marginRight: 6,
  },
  playingBadgeText: {
    color: '#00ffcc',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  nowPlayingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1b1b22',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#282834',
  },
  nowPlayingThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#26262e',
  },
  nowPlayingInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  nowPlayingTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  nowPlayingArtist: {
    color: '#9999a6',
    fontSize: 13,
  },
  upNextSection: {
    flexShrink: 1,
  },
  upNextHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  countBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countPill: {
    backgroundColor: '#23232c',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  countText: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 85, 85, 0.1)',
  },
  clearBtnText: {
    color: '#ff5555',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  listContent: {
    paddingBottom: 16,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#191920',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#24242e',
  },
  itemIndex: {
    color: '#666675',
    fontSize: 12,
    fontWeight: '700',
    width: 24,
  },
  itemThumb: {
    width: 42,
    height: 42,
    borderRadius: 6,
    backgroundColor: '#26262e',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  itemTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  itemSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemArtist: {
    color: '#888896',
    fontSize: 12,
  },
  itemDuration: {
    color: '#666675',
    fontSize: 11,
    marginLeft: 6,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtn: {
    padding: 6,
  },
  actionBtnDisabled: {
    opacity: 0.3,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  emptySubtitle: {
    color: '#777785',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00ffcc',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  generateBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
});
