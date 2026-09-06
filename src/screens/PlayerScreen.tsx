import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, Dimensions, ActivityIndicator, Alert, TextInput, PanResponder } from 'react-native';
import TrackPlayer, { useActiveMediaItem, useIsPlaying, RepeatMode } from '@rntp/player';
import { Ionicons } from '@expo/vector-icons';
import { fetchLyrics, LrcLibResponse, sanitizeLyricText } from '../services/lyricsService';
import { parseSyncedLyrics, SyncedLyricLine } from '../utils/lyricsParser';
import { hostSyncSession, inviteToSync } from '../services/syncService';
import { toggleLoopMode, playNextTrack } from '../services/TrackPlayerService';
import { downloadTrack, isTrackDownloaded, deleteDownloadedTrack } from '../services/downloadService';
import { AudioSettingsModal } from '../components/AudioSettingsModal';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { QueueModal } from '../components/QueueModal';
import { LyricsModal } from '../components/LyricsModal';
import { TrackMetadata } from '../utils/storage';

const { width } = Dimensions.get('window');

export function PlayerScreen({ navigation }: any) {
  const track = useActiveMediaItem();
  const isPlaying = useIsPlaying();
  
  const [currentPos, setCurrentPos] = useState(0);
  const [currentDur, setCurrentDur] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const p = await TrackPlayer.getProgress();
        if (isMounted && p && typeof p.position === 'number') {
          setCurrentPos(p.position);
          const validDur = p.duration > 0 ? p.duration : ((track as any)?.duration || 0);
          if (validDur > 0) setCurrentDur(validDur);
        }
      } catch {}
    }, 500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [(track as any)?.id || (track as any)?.mediaId]);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const progressBarWidth = useRef(1);

  const effectiveDuration = currentDur > 0 ? currentDur : ((track as any)?.duration || 180);
  const displayPosition = isScrubbing ? scrubPosition : currentPos;
  const progressPercent = effectiveDuration > 0 
    ? Math.min(100, Math.max(0, (displayPosition / effectiveDuration) * 100)) 
    : 0;

  const handleSeek = async (newPos: number) => {
    const clamped = Math.max(0, Math.min(newPos, effectiveDuration));
    await TrackPlayer.seekTo(clamped);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setIsScrubbing(true);
        const barWidth = progressBarWidth.current || 1;
        const x = evt.nativeEvent.locationX;
        const percentage = Math.max(0, Math.min(1, x / barWidth));
        const targetSeconds = percentage * effectiveDuration;
        setScrubPosition(targetSeconds);
      },
      onPanResponderMove: (evt) => {
        const barWidth = progressBarWidth.current || 1;
        const x = evt.nativeEvent.locationX;
        const percentage = Math.max(0, Math.min(1, x / barWidth));
        const targetSeconds = percentage * effectiveDuration;
        setScrubPosition(targetSeconds);
      },
      onPanResponderRelease: async (evt) => {
        const barWidth = progressBarWidth.current || 1;
        const x = evt.nativeEvent.locationX;
        const percentage = Math.max(0, Math.min(1, x / barWidth));
        const targetSeconds = percentage * effectiveDuration;
        setIsScrubbing(false);
        await handleSeek(targetSeconds);
      },
      onPanResponderTerminate: () => {
        setIsScrubbing(false);
      }
    })
  ).current;

  const [repeatMode, setRepeatMode] = useState<any>(RepeatMode.Off);
  const [isAudioSettingsVisible, setIsAudioSettingsVisible] = useState(false);
  const [isPlaylistModalVisible, setIsPlaylistModalVisible] = useState(false);
  const [isQueueModalVisible, setIsQueueModalVisible] = useState(false);
  const [isLyricsModalVisible, setIsLyricsModalVisible] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsData, setLyricsData] = useState<any>(null);
  const [syncedLines, setSyncedLines] = useState<SyncedLyricLine[]>([]);
  
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (showLyrics && track && !lyricsData && !lyricsLoading) {
      loadLyrics();
    }
  }, [showLyrics, track]);

  useEffect(() => {
    setRepeatMode(TrackPlayer.getRepeatMode());
  }, []);

  const handleLoopToggle = async () => {
    const newMode = await toggleLoopMode();
    setRepeatMode(newMode);
  };

  const loadLyrics = async () => {
    if (!track?.title || !track?.artist) return;
    
    setLyricsLoading(true);
    const data = await fetchLyrics((track as any).title, (track as any).artist);
    setLyricsData(data);
    
    if (data?.syncedLyrics) {
      setSyncedLines(parseSyncedLyrics(data.syncedLyrics));
    }
    
    setLyricsLoading(false);
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  };

  const skipNext = async () => {
    await playNextTrack();
  };

  const skipPrev = async () => {
    await TrackPlayer.skipToPrevious();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const [syncTarget, setSyncTarget] = useState('');
  const [isSyncModalVisible, setIsSyncModalVisible] = useState(false);

  const handleHostSync = async () => {
    if (!syncTarget.trim()) return;
    try {
      await hostSyncSession(syncTarget.trim());
      inviteToSync(syncTarget.trim());
      setIsSyncModalVisible(false);
      setSyncTarget('');
      Alert.alert('Success', `Invited ${syncTarget.trim()} to sync!`);
    } catch (e) {
      console.error(e);
    }
  };

  // Find active line index for synced lyrics
  let activeLineIndex = -1;
  if (syncedLines.length > 0) {
    activeLineIndex = syncedLines.findIndex(line => line.time > displayPosition) - 1;
    if (activeLineIndex === -2) activeLineIndex = syncedLines.length - 1;
  }

  useEffect(() => {
    const trackId = (track as any)?.id || (track as any)?.mediaId;
    if (trackId) {
      setIsDownloaded(isTrackDownloaded(trackId));
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  }, [(track as any)?.id || (track as any)?.mediaId]);

  const handleToggleDownload = async () => {
    const trackId = (track as any)?.id || (track as any)?.mediaId;
    if (!trackId || !track) return;

    if (isDownloaded) {
      Alert.alert(
        'Remove Download',
        `Delete "${track.title}" from offline storage?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Delete', 
            style: 'destructive',
            onPress: async () => {
              await deleteDownloadedTrack(trackId);
              setIsDownloaded(false);
            }
          }
        ]
      );
      return;
    }

    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      const meta: TrackMetadata = {
        id: trackId,
        title: track.title || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
        artwork: artworkUri,
        duration: effectiveDuration,
      };
      await downloadTrack(meta, (p) => {
        setDownloadProgress(p);
      });
      setIsDownloaded(true);
      Alert.alert('Downloaded', `"${track.title}" is saved for offline listening!`);
    } catch (err: any) {
      Alert.alert('Download Error', err?.message || 'Could not download track');
    } finally {
      setIsDownloading(false);
    }
  };

  if (!track) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-down" size={32} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.noTrackText}>No track playing</Text>
      </View>
    );
  }

  const artworkUri = 
    (track as any)?.artwork || 
    (track as any)?.artworkUrl || 
    (track as any)?.thumbnail || 
    (typeof (track as any)?.url === 'object' ? (track as any)?.url?.artwork : undefined) ||
    'https://via.placeholder.com/400x400.png?text=Sukoon';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-down" size={32} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Now Playing</Text>
        <TouchableOpacity style={styles.headerIcon} onPress={() => setIsAudioSettingsVisible(true)}>
          <Ionicons name="ellipsis-horizontal" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {showLyrics ? (
        <View style={styles.lyricsContainer}>
          {lyricsLoading ? (
            <ActivityIndicator size="large" color="#ffffff" style={styles.loader} />
          ) : syncedLines.length > 0 ? (
            <ScrollView 
              ref={scrollViewRef}
              contentContainerStyle={styles.lyricsScroll}
              showsVerticalScrollIndicator={false}
            >
              {syncedLines.map((line, index) => {
                const isActive = index === activeLineIndex;
                const isPassed = index < activeLineIndex;
                return (
                  <Text 
                    key={index} 
                    style={[
                      styles.syncedLyricLine, 
                      isActive && styles.activeLyricLine,
                      isPassed && styles.passedLyricLine
                    ]}
                  >
                    {sanitizeLyricText(line.text)}
                  </Text>
                );
              })}
            </ScrollView>
          ) : lyricsData?.plainLyrics ? (
            <ScrollView contentContainerStyle={styles.lyricsScroll}>
              <Text style={styles.plainLyricsText}>{lyricsData.plainLyrics}</Text>
            </ScrollView>
          ) : (
            <Text style={styles.noLyricsText}>No lyrics available for this track.</Text>
          )}
        </View>
      ) : (
        <View style={styles.mainPlayer}>
          <Image 
            source={{ uri: artworkUri }} 
            style={styles.artworkLg} 
            resizeMode="cover" 
          />
          <View style={styles.trackInfoContainer}>
            <Text style={styles.titleLg} numberOfLines={2}>{track.title}</Text>
            <Text style={styles.artistLg} numberOfLines={1}>{track.artist}</Text>
          </View>
        </View>
      )}

      <View style={styles.controlsContainer}>
        <View style={styles.progressRow}>
          <Text style={styles.timeText}>{formatTime(displayPosition)}</Text>
          <View 
            style={styles.progressBarTouchable}
            onLayout={(e) => { progressBarWidth.current = e.nativeEvent.layout.width; }}
            {...panResponder.panHandlers}
          >
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
              <View style={[styles.progressThumb, { left: `${progressPercent}%` }]} />
            </View>
          </View>
          <Text style={styles.timeText}>{formatTime(effectiveDuration)}</Text>
        </View>

        <View style={styles.buttonsRow}>
          <TouchableOpacity onPress={handleLoopToggle} style={styles.controlBtn}>
            <Ionicons 
              name={repeatMode === RepeatMode.One ? "repeat-outline" : "repeat"} 
              size={24} 
              color={repeatMode === RepeatMode.Off ? "#888888" : "#00ffcc"} 
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={skipPrev} style={styles.controlBtn}>
            <Ionicons name="play-skip-back" size={36} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={togglePlayback} style={styles.playPauseBtn}>
            <Ionicons name={isPlaying ? "pause" : "play"} size={48} color="#000000" />
          </TouchableOpacity>
          <TouchableOpacity onPress={skipNext} style={styles.controlBtn}>
            <Ionicons name="play-skip-forward" size={36} color="#ffffff" />
          </TouchableOpacity>
          <View style={{ width: 56 }} />
        </View>

        <View style={styles.secondaryActionsRow}>
          <TouchableOpacity 
            style={styles.secondaryActionBtn} 
            onPress={() => setIsLyricsModalVisible(true)}
          >
            <Ionicons name="mic-outline" size={22} color="#aaaaaa" />
            <Text style={styles.secondaryActionText}>Lyrics</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryActionBtn} 
            onPress={() => setIsQueueModalVisible(true)}
          >
            <Ionicons name="list-outline" size={22} color="#aaaaaa" />
            <Text style={styles.secondaryActionText}>Queue</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryActionBtn} 
            onPress={() => setIsPlaylistModalVisible(true)}
          >
            <Ionicons name="add-circle-outline" size={22} color="#aaaaaa" />
            <Text style={styles.secondaryActionText}>Playlist</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryActionBtn} 
            onPress={() => setIsAudioSettingsVisible(true)}
          >
            <Ionicons name="options-outline" size={22} color="#aaaaaa" />
            <Text style={styles.secondaryActionText}>Audio FX</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryActionBtn} 
            onPress={handleToggleDownload}
          >
            {isDownloading ? (
              <View style={styles.downloadingWrapper}>
                <ActivityIndicator size="small" color="#00ffcc" />
                <Text style={styles.downloadPercentText}>
                  {Math.round(downloadProgress * 100)}%
                </Text>
              </View>
            ) : isDownloaded ? (
              <>
                <Ionicons name="checkmark-circle" size={22} color="#00ffcc" />
                <Text style={[styles.secondaryActionText, { color: '#00ffcc' }]}>Saved</Text>
              </>
            ) : (
              <>
                <Ionicons name="arrow-down-circle-outline" size={22} color="#aaaaaa" />
                <Text style={styles.secondaryActionText}>Download</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {isSyncModalVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Host Sync Session</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter friend's username"
              placeholderTextColor="#888888"
              value={syncTarget}
              onChangeText={setSyncTarget}
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setIsSyncModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSubmit} onPress={handleHostSync}>
                <Text style={styles.modalSubmitText}>Invite</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <AudioSettingsModal visible={isAudioSettingsVisible} onClose={() => setIsAudioSettingsVisible(false)} />
      
      <AddToPlaylistModal
        visible={isPlaylistModalVisible}
        track={track ? {
          id: (track as any).id || (track as any).mediaId || '',
          title: track.title || 'Unknown Title',
          artist: track.artist || 'Unknown Artist',
          artwork: artworkUri,
          duration: effectiveDuration,
        } : null}
        onClose={() => setIsPlaylistModalVisible(false)}
      />

      <QueueModal
        visible={isQueueModalVisible}
        onClose={() => setIsQueueModalVisible(false)}
        currentTrack={track ? {
          id: (track as any).id || (track as any).mediaId || '',
          title: track.title || 'Unknown Title',
          artist: track.artist || 'Unknown Artist',
          artwork: artworkUri,
          duration: effectiveDuration,
        } : null}
      />

      <LyricsModal
        visible={isLyricsModalVisible}
        onClose={() => setIsLyricsModalVisible(false)}
        track={track ? {
          id: (track as any).id || (track as any).mediaId || '',
          title: track.title || 'Unknown Title',
          artist: track.artist || 'Unknown Artist',
          artwork: artworkUri,
          duration: effectiveDuration,
        } : null}
        currentPosition={displayPosition}
        duration={effectiveDuration}
        onSeek={handleSeek}
      />
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
  },
  closeBtn: {
    padding: 4,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    marginLeft: 16,
    padding: 4,
  },
  lyricsToggle: {
    padding: 4,
  },
  noTrackText: {
    color: '#ffffff',
    textAlign: 'center',
    marginTop: 100,
    fontSize: 18,
  },
  mainPlayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  artworkLg: {
    width: width - 64,
    height: width - 64,
    borderRadius: 8,
    backgroundColor: '#121212',
    marginBottom: 32,
  },
  trackInfoContainer: {
    width: '100%',
    alignItems: 'flex-start',
  },
  titleLg: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  artistLg: {
    color: '#aaaaaa',
    fontSize: 18,
  },
  controlsContainer: {
    paddingHorizontal: 32,
    paddingBottom: 50,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
  },
  timeText: {
    color: '#aaaaaa',
    fontSize: 12,
    width: 44,
    textAlign: 'center',
  },
  progressBarTouchable: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: '#333333',
    borderRadius: 2,
    position: 'relative',
    justifyContent: 'center',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#00ffcc',
    borderRadius: 2,
  },
  progressThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    marginLeft: -6,
    top: -4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  controlBtn: {
    padding: 16,
  },
  downloadingWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadPercentText: {
    color: '#00ffcc',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 8,
  },
  secondaryActionBtn: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  secondaryActionText: {
    color: '#888896',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  playPauseBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lyricsContainer: {
    flex: 1,
  },
  loader: {
    marginTop: 100,
  },
  lyricsScroll: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    paddingBottom: 100,
  },
  syncedLyricLine: {
    color: '#555555',
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 34,
    marginBottom: 16,
    textAlign: 'center',
  },
  activeLyricLine: {
    color: '#ffffff',
  },
  passedLyricLine: {
    color: '#aaaaaa',
  },
  plainLyricsText: {
    color: '#ffffff',
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
  },
  noLyricsText: {
    color: '#aaaaaa',
    textAlign: 'center',
    marginTop: 100,
    fontSize: 16,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  modalContainer: {
    width: '80%',
    backgroundColor: '#121212',
    borderRadius: 8,
    padding: 20,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#000000',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 4,
    padding: 12,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalCancel: {
    padding: 10,
    marginRight: 10,
  },
  modalCancelText: {
    color: '#aaaaaa',
  },
  modalSubmit: {
    padding: 10,
    backgroundColor: '#ffffff',
    borderRadius: 4,
  },
  modalSubmitText: {
    color: '#000000',
    fontWeight: 'bold',
  },
});
