import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, Dimensions, ActivityIndicator, Alert, TextInput, PanResponder, FlatList } from 'react-native';
import TrackPlayer, { useActiveMediaItem, useIsPlaying, useProgress, RepeatMode } from '@rntp/player';
import { Ionicons } from '@expo/vector-icons';
import { fetchLyrics, LrcLibResponse, sanitizeLyricText } from '../services/lyricsService';
import { parseSyncedLyrics, SyncedLyricLine } from '../utils/lyricsParser';
import { toggleLoopMode, playNextTrack, playPreviousTrack, getCurrentTrack } from '../services/TrackPlayerService';
import { downloadTrack, isTrackDownloaded, deleteDownloadedTrack } from '../services/downloadService';
import { LinearGradient } from 'expo-linear-gradient';
import { SoundBoostModal } from '../components/SoundBoostModal';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { QueueModal } from '../components/QueueModal';
import { LyricsModal } from '../components/LyricsModal';
import { KaraokeStudioModal } from '../components/KaraokeStudioModal';
import { SleepTimerModal } from '../components/SleepTimerModal';
import { PartyModal } from '../components/PartyModal';
import { showToast } from '../components/ToastNotification';
import { SafeErrorBoundary } from '../components/SafeErrorBoundary';
import { subscribeToSleepTimer, SleepTimerState, getSleepTimerState } from '../services/sleepTimerService';
import { 
  getPartyState, 
  subscribeToPartyState, 
  broadcastPartyAction, 
  PartyState 
} from '../services/partyService';
import { 
  TrackMetadata, 
  isTrackInLikedSongs, 
  toggleTrackInLikedSongs, 
  onPlaylistsChanged 
} from '../utils/storage';
import { getAmbientThemeForTrack } from '../utils/colorExtractor';

const { width } = Dimensions.get('window');

export function PlayerScreen({ navigation }: any) {
  const track = useActiveMediaItem();
  const isPlaying = useIsPlaying();
  const progress = useProgress(200);
  const [pollingPosition, setPollingPosition] = useState(0);
  const [pollingDuration, setPollingDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const [optimisticSeekPos, setOptimisticSeekPos] = useState<number | null>(null);
  const [sliderWidth, setSliderWidth] = useState(0);

  const currentTrack = getCurrentTrack();

  // Fallback Polling Loop (ensures timer NEVER freezes even if background native events lag)
  useEffect(() => {
    let isMounted = true;
    const timer = setInterval(async () => {
      try {
        let pos = 0;
        let dur = 0;
        if (typeof (TrackPlayer as any).getPosition === 'function') {
          pos = await (TrackPlayer as any).getPosition();
        }
        if (typeof (TrackPlayer as any).getDuration === 'function') {
          dur = await (TrackPlayer as any).getDuration();
        }
        if (!pos && !dur) {
          const p = await TrackPlayer.getProgress();
          pos = p?.position || 0;
          dur = p?.duration || 0;
        }
        if (isMounted) {
          if (typeof pos === 'number' && !isNaN(pos) && pos >= 0) {
            setPollingPosition(pos);
          }
          if (typeof dur === 'number' && !isNaN(dur) && dur > 0) {
            setPollingDuration(dur);
          }
        }
      } catch {}
    }, 250);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [currentTrack?.id]);

  // Universal Track Duration Parser (supports numeric seconds, ms > 10000, mm:ss or hh:mm:ss)
  const parseDurationToSeconds = (val: any): number => {
    if (typeof val === 'number') {
      if (isNaN(val) || val <= 0) return 0;
      return val > 10000 ? val / 1000 : val;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.includes(':')) {
        const parts = trimmed.split(':').map(Number);
        if (parts.length === 2) return (parts[0] * 60) + parts[1];
        if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      }
      const parsed = parseFloat(trimmed);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed > 10000 ? parsed / 1000 : parsed;
      }
    }
    return 0;
  };

  // Duration Priority: Native ExoPlayer duration > Polling duration > Metadata duration
  const rawDuration = pollingDuration > 0 
    ? pollingDuration 
    : (progress.duration > 0 ? progress.duration : parseDurationToSeconds(currentTrack?.duration));
  const duration = Math.max(rawDuration, 1);

  // Position Priority: User Scrubbing > Optimistic Seek Hold > Polled Position > useProgress
  const rawPos = pollingPosition > 0 ? pollingPosition : progress.position;
  const currentPos = isScrubbing 
    ? scrubPosition 
    : (optimisticSeekPos !== null ? optimisticSeekPos : rawPos);

  const progressPercent = duration > 1 
    ? Math.max(0, Math.min(100, (currentPos / duration) * 100)) 
    : 0;

  const effectiveDuration = duration;
  const displayPosition = currentPos;

  const [partyState, setPartyState] = useState<PartyState>(getPartyState());
  const partyStateRef = useRef(partyState);
  partyStateRef.current = partyState;

  useEffect(() => {
    const unsub = subscribeToPartyState((st) => {
      setPartyState(st);
      partyStateRef.current = st;
    });
    return unsub;
  }, []);

  const [isPartyModalVisible, setIsPartyModalVisible] = useState(false);

  const handleSeek = async (newPos: number) => {
    const clamped = Math.max(0, Math.min(newPos, duration));
    setOptimisticSeekPos(clamped);
    setScrubPosition(clamped);
    try {
      await TrackPlayer.seekTo(clamped);
      if (partyStateRef.current.isActive) {
        broadcastPartyAction('SEEK', { position: clamped });
      }
    } catch {}
    setTimeout(() => {
      setOptimisticSeekPos(null);
    }, 500);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          setIsScrubbing(true);
          const touchX = Math.max(0, Math.min(sliderWidth, evt.nativeEvent.locationX));
          setScrubPosition((touchX / (sliderWidth || 1)) * duration);
        },
        onPanResponderMove: (evt, gestureState) => {
          const touchX = Math.max(0, Math.min(sliderWidth, evt.nativeEvent.locationX + gestureState.dx));
          setScrubPosition((touchX / (sliderWidth || 1)) * duration);
        },
        onPanResponderRelease: async () => {
          const finalSeek = Math.max(0, Math.min(duration, scrubPosition));
          setOptimisticSeekPos(finalSeek);
          try {
            await TrackPlayer.seekTo(finalSeek);
            if (partyStateRef.current.isActive) {
              broadcastPartyAction('SEEK', { position: finalSeek });
            }
          } catch {}
          setTimeout(() => {
            setIsScrubbing(false);
            setOptimisticSeekPos(null);
          }, 400);
        },
        onPanResponderTerminate: () => {
          setIsScrubbing(false);
          setOptimisticSeekPos(null);
        },
      }),
    [duration, sliderWidth, scrubPosition]
  );

  const [repeatMode, setRepeatMode] = useState<any>(RepeatMode.Off);
  const [isAudioSettingsVisible, setIsAudioSettingsVisible] = useState(false);
  const [isSleepTimerVisible, setIsSleepTimerVisible] = useState(false);
  const [sleepState, setSleepState] = useState<SleepTimerState>(getSleepTimerState());

  useEffect(() => {
    const unsubscribe = subscribeToSleepTimer((s) => {
      setSleepState(s);
    });
    return unsubscribe;
  }, []);

  const [isPlaylistModalVisible, setIsPlaylistModalVisible] = useState(false);
  const [isQueueModalVisible, setIsQueueModalVisible] = useState(false);
  const [isLyricsModalVisible, setIsLyricsModalVisible] = useState(false);
  const [isKaraokeStudioVisible, setIsKaraokeStudioVisible] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsData, setLyricsData] = useState<any>(null);
  const [syncedLines, setSyncedLines] = useState<SyncedLyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const lyricsFlatListRef = useRef<FlatList>(null);
  
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!syncedLines || syncedLines.length === 0) return;
    const activeIndex = syncedLines.findIndex((line, index) => {
      const nextLine = syncedLines[index + 1];
      return currentPos >= line.time && (!nextLine || currentPos < nextLine.time);
    });
    if (activeIndex !== -1 && activeIndex !== currentLyricIndex) {
      setCurrentLyricIndex(activeIndex);
      try {
        lyricsFlatListRef.current?.scrollToIndex({
          index: activeIndex,
          animated: true,
          viewPosition: 0.5, // Keep active lyric centered
        });
      } catch {}
    }
  }, [currentPos, syncedLines]);

  useEffect(() => {
    if (showLyrics && track && !lyricsData && !lyricsLoading) {
      loadLyrics();
    }
  }, [showLyrics, track]);

  const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    setRepeatMode(TrackPlayer.getRepeatMode());
  }, []);

  const activeTrackId = (track as any)?.id || (track as any)?.mediaId || currentTrack?.id;

  useEffect(() => {
    if (activeTrackId) {
      setIsLiked(isTrackInLikedSongs(activeTrackId));
    } else {
      setIsLiked(false);
    }
  }, [activeTrackId]);

  useEffect(() => {
    const unsub = onPlaylistsChanged(() => {
      if (activeTrackId) {
        setIsLiked(isTrackInLikedSongs(activeTrackId));
      }
    });
    return unsub;
  }, [activeTrackId]);

  const handleLoopToggle = async () => {
    const newMode = await toggleLoopMode();
    setRepeatMode(newMode);
  };

  const handleToggleLike = () => {
    const candidate: any = track || currentTrack;
    const trackId = candidate?.id || candidate?.mediaId;
    if (!candidate || !trackId) return;
    const added = toggleTrackInLikedSongs({
      id: trackId,
      title: candidate.title || 'Unknown Title',
      artist: candidate.artist || 'Unknown Artist',
      artwork: candidate.artwork || candidate.artworkUrl,
      duration: candidate.duration,
      url: candidate.url,
    });
    setIsLiked(added);
    showToast(
      added ? 'Added to Liked Songs' : 'Removed from Liked Songs',
      added ? 'heart' : 'heart-dislike-outline'
    );
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
      if (partyStateRef.current.isActive) {
        broadcastPartyAction('PAUSE');
      }
    } else {
      await TrackPlayer.play();
      if (partyStateRef.current.isActive) {
        broadcastPartyAction('PLAY');
      }
    }
  };

  const skipNext = async () => {
    await playNextTrack();
  };

  const skipPrev = async () => {
    await playPreviousTrack();
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const totalSecs = Math.floor(seconds);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const formattedSecs = secs < 10 ? `0${secs}` : `${secs}`;
    if (hours > 0) {
      const formattedMins = mins < 10 ? `0${mins}` : `${mins}`;
      return `${hours}:${formattedMins}:${formattedSecs}`;
    }
    return `${mins}:${formattedSecs}`;
  };

  // Find active line index for synced lyrics
  let activeLineIndex = currentLyricIndex !== -1 ? currentLyricIndex : -1;
  if (activeLineIndex === -1 && syncedLines.length > 0) {
    const idx = syncedLines.findIndex((line, index) => {
      const nextLine = syncedLines[index + 1];
      return currentPos >= line.time && (!nextLine || currentPos < nextLine.time);
    });
    activeLineIndex = idx !== -1 ? idx : (currentPos >= (syncedLines[0]?.time || 0) ? 0 : -1);
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
              showToast('Removed from offline downloads', 'trash-outline');
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
      showToast(`"${track.title}" saved for offline listening!`, 'arrow-down-circle');
    } catch (err: any) {
      showToast(err?.message || 'Could not download track', 'alert-circle');
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

  const ambientTheme = getAmbientThemeForTrack(track ? {
    id: (track as any).id || (track as any).mediaId || '',
    title: track.title || '',
    artist: track.artist || '',
  } : null);

  return (
    <SafeErrorBoundary fallbackName="PlayerScreen">
      <View style={styles.container}>
      <LinearGradient
        colors={ambientTheme.gradient}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.7 }}
        pointerEvents="none"
      />
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-down" size={32} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Now Playing</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity 
            style={styles.headerIcon} 
            onPress={() => setIsPartyModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={partyState.isActive ? "sparkles" : "sparkles-outline"} 
              size={22} 
              color={partyState.isActive ? "#00ffcc" : "#ffffff"} 
            />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.headerIcon} 
            onPress={() => setIsSleepTimerVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={sleepState.isActive ? "moon" : "moon-outline"} 
              size={22} 
              color={sleepState.isActive ? "#00ffcc" : "#ffffff"} 
            />
          </TouchableOpacity>
        </View>
      </View>

      {partyState.isActive && (
        <TouchableOpacity 
          style={styles.partyBanner} 
          onPress={() => setIsPartyModalVisible(true)}
          activeOpacity={0.8}
        >
          <View style={styles.partyBannerPulse} />
          <Text style={styles.partyBannerText}>
            🎉 Party Sync Active • Code: {partyState.roomCode}
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#00ffcc" />
        </TouchableOpacity>
      )}

      {showLyrics ? (
        <View style={styles.lyricsContainer}>
          {lyricsLoading ? (
            <ActivityIndicator size="large" color="#ffffff" style={styles.loader} />
          ) : syncedLines.length > 0 ? (
            <FlatList
              ref={lyricsFlatListRef}
              data={syncedLines}
              keyExtractor={(item, index) => `${index}-${item.time}`}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.lyricsScroll}
              getItemLayout={(_, index) => ({
                length: 50,
                offset: 50 * index,
                index,
              })}
              onScrollToIndexFailed={(info) => {
                setTimeout(() => {
                  lyricsFlatListRef.current?.scrollToOffset({
                    offset: info.index * 50,
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
                    onPress={() => handleSeek(item.time)}
                  >
                    <Text 
                      style={[
                        styles.syncedLyricLine, 
                        isActive && styles.activeLyricLine,
                        isPassed && styles.passedLyricLine
                      ]}
                    >
                      {sanitizeLyricText(item.text)}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
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
        {/* Scrubber Container */}
        <View
          collapsable={false}
          onLayout={(e) => setSliderWidth(e.nativeEvent.layout.width)}
          {...panResponder.panHandlers}
          style={styles.sliderContainer}
        >
          <View style={styles.sliderTrackBackground}>
            <View style={[styles.sliderTrackActive, { width: `${progressPercent}%` }]} />
          </View>
          <View style={[styles.sliderThumb, { left: `${progressPercent}%` }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(currentPos)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>

        <View style={styles.buttonsRow}>
          <TouchableOpacity onPress={handleLoopToggle} style={styles.controlSideBtn} activeOpacity={0.7}>
            <Ionicons 
              name={repeatMode === RepeatMode.One ? "repeat-outline" : "repeat"} 
              size={24} 
              color={repeatMode === RepeatMode.Off ? "#888888" : "#00ffcc"} 
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={skipPrev} style={styles.controlSkipBtn} activeOpacity={0.7}>
            <Ionicons name="play-skip-back" size={34} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={togglePlayback} style={styles.playPauseBtn} activeOpacity={0.85}>
            <Ionicons name={isPlaying ? "pause" : "play"} size={44} color="#000000" />
          </TouchableOpacity>
          <TouchableOpacity onPress={skipNext} style={styles.controlSkipBtn} activeOpacity={0.7}>
            <Ionicons name="play-skip-forward" size={34} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={handleToggleLike} 
            style={styles.controlSideBtn} 
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons 
              name={isLiked ? "heart" : "heart-outline"} 
              size={26} 
              color={isLiked ? "#FF3B30" : "#A0AAB8"} 
            />
          </TouchableOpacity>
        </View>

        <View style={styles.secondaryActionsRow}>
          <TouchableOpacity 
            style={styles.secondaryActionBtn} 
            onPress={() => setIsKaraokeStudioVisible(true)}
          >
            <Ionicons name="mic" size={22} color="#ff3b30" />
            <Text style={[styles.secondaryActionText, { color: '#ff3b30' }]}>Studio</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryActionBtn} 
            onPress={() => setIsLyricsModalVisible(true)}
          >
            <Ionicons name="document-text-outline" size={22} color="#aaaaaa" />
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
            <Ionicons name="flash-outline" size={22} color="#06B6D4" />
            <Text style={styles.secondaryActionText}>Sound Boost</Text>
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

      <PartyModal
        visible={isPartyModalVisible}
        onClose={() => setIsPartyModalVisible(false)}
      />

      <SoundBoostModal visible={isAudioSettingsVisible} onClose={() => setIsAudioSettingsVisible(false)} />
      <SleepTimerModal visible={isSleepTimerVisible} onClose={() => setIsSleepTimerVisible(false)} />
      
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

      <KaraokeStudioModal
        visible={isKaraokeStudioVisible}
        onClose={() => setIsKaraokeStudioVisible(false)}
        track={track ? {
          id: (track as any).id || (track as any).mediaId || '',
          title: track.title || 'Unknown Title',
          artist: track.artist || 'Unknown Artist',
          artwork: artworkUri,
          duration: effectiveDuration,
        } : null}
        currentPosition={displayPosition}
        duration={effectiveDuration}
      />
    </View>
    </SafeErrorBoundary>
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
  partyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.4)',
    gap: 8,
  },
  partyBannerPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00ffcc',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  partyBannerText: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
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
    width: '100%',
    paddingHorizontal: 28,
    paddingBottom: 48,
  },
  sliderContainer: {
    width: '100%',
    height: 32,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrackBackground: {
    height: 4,
    backgroundColor: '#333333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  sliderTrackActive: {
    height: '100%',
    backgroundColor: '#00ffcc',
    borderRadius: 2,
  },
  sliderThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
    marginLeft: -7,
    top: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 4,
  },
  timeRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
    marginBottom: 20,
    paddingHorizontal: 2,
  },
  timeText: {
    color: '#aaaaaa',
    fontSize: 12,
  },
  buttonsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  controlSideBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlSkipBtn: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
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
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    marginTop: 26,
    paddingHorizontal: 0,
  },
  secondaryActionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  secondaryActionText: {
    color: '#888896',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  playPauseBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
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
