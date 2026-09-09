import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, { useIsPlaying } from '@rntp/player';
import { createAudioPlayer } from 'expo-audio';
import { TrackMetadata, StudioRecording } from '../utils/storage';
import { getLyricsWithSource, ParsedLyrics, LyricLine } from '../services/lyricsService';
import { 
  startRecording, 
  pauseRecording, 
  resumeRecording, 
  finishVocalTake,
  saveRecording,
  discardRecording,
  shareRecording 
} from '../services/recordingService';
import { showToast } from './ToastNotification';

interface Props {
  visible: boolean;
  onClose: () => void;
  track: TrackMetadata | null;
  currentPosition: number;
  duration?: number;
}

type StudioState = 'idle' | 'recording' | 'paused' | 'stopped' | 'saved';

export function KaraokeStudioModal({
  visible,
  onClose,
  track,
  currentPosition,
  duration,
}: Props) {
  const isPlaying = useIsPlaying();

  const toggleBgmPlayback = async () => {
    try {
      if (isPlaying) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }
    } catch (e) {
      console.warn('[KaraokeStudio] Error toggling playback:', e);
    }
  };

  const [lyricsData, setLyricsData] = useState<ParsedLyrics | null>(null);
  const [containerHeight, setContainerHeight] = useState(300);
  const LINE_HEIGHT = 64;
  const verticalPadding = Math.max(0, (containerHeight - LINE_HEIGHT) / 2);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [studioState, setStudioState] = useState<StudioState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [vocalTake, setVocalTake] = useState<{ localUri: string; durationSeconds: number } | null>(null);
  const [lastSavedRecording, setLastSavedRecording] = useState<StudioRecording | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState<boolean>(false);

  const flatListRef = useRef<FlatList<LyricLine>>(null);
  const timerIntervalRef = useRef<any>(null);
  const previewPlayerRef = useRef<any>(null);

  // Load lyrics when modal opens
  useEffect(() => {
    if (visible && track) {
      loadLyrics();
    } else {
      cleanupStudio();
    }
  }, [visible, track?.id]);

  // Recording Timer
  useEffect(() => {
    if (studioState === 'recording') {
      timerIntervalRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [studioState]);

  const loadLyrics = async () => {
    if (!track) return;
    setIsLoadingLyrics(true);
    try {
      const res = await getLyricsWithSource(track.title, track.artist, duration, 'LRCLIB (Synced)');
      if (res) {
        setLyricsData({
          trackName: track.title,
          artistName: track.artist,
          synced: res.synced,
          syncedLyrics: null,
          plainLyrics: res.plainLyrics || null,
          lines: res.lines,
          source: res.source,
        });
      } else {
        setLyricsData(null);
      }
    } catch (e) {
      console.warn('[KaraokeStudio] Error loading lyrics:', e);
      setLyricsData(null);
    } finally {
      setIsLoadingLyrics(false);
    }
  };

  const stopPreviewPlayer = () => {
    if (previewPlayerRef.current) {
      try {
        previewPlayerRef.current.pause();
        previewPlayerRef.current.release?.();
      } catch {}
      previewPlayerRef.current = null;
    }
    setIsPreviewPlaying(false);
  };

  const cleanupStudio = () => {
    stopPreviewPlayer();
    if (studioState === 'recording' || studioState === 'paused') {
      discardRecording().catch(() => {});
    }
    setStudioState('idle');
    setElapsedSeconds(0);
    setVocalTake(null);
    setLastSavedRecording(null);
  };

  // Synced Lyrics active line calculation
  let activeLineIndex = -1;
  if (lyricsData?.lines && lyricsData.lines.length > 0) {
    const idx = lyricsData.lines.findIndex((line) => line.time > currentPosition) - 1;
    if (idx === -2) {
      activeLineIndex = lyricsData.lines.length - 1;
    } else {
      activeLineIndex = Math.max(0, idx);
    }
  }

  useEffect(() => {
    if (activeLineIndex < 0 || !lyricsData?.lines || lyricsData.lines.length === 0) return;

    const targetOffset = activeLineIndex * LINE_HEIGHT;

    flatListRef.current?.scrollToOffset({
      offset: targetOffset,
      animated: true,
    });
  }, [activeLineIndex, containerHeight]);

  // Recording Controls
  const handleStartRecord = async () => {
    try {
      // Ensure backing music is playing for vocal cue
      try {
        await TrackPlayer.play();
      } catch {}

      await startRecording();
      setElapsedSeconds(0);
      setStudioState('recording');
      setVocalTake(null);
      setLastSavedRecording(null);
    } catch (err: any) {
      showToast(err?.message || 'Recording requires standalone native microphone module', 'mic-off-outline');
    }
  };

  const handlePauseResume = async () => {
    if (studioState === 'recording') {
      await pauseRecording();
      setStudioState('paused');
    } else if (studioState === 'paused') {
      await resumeRecording();
      setStudioState('recording');
    }
  };

  const handleStopRecording = async () => {
    try {
      try {
        await TrackPlayer.pause();
      } catch {}

      const take = await finishVocalTake(elapsedSeconds);
      if (take) {
        setVocalTake(take);
        setStudioState('stopped');
      } else {
        setStudioState('idle');
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not finalize recording', 'alert-circle');
      setStudioState('idle');
    }
  };

  // Preview Player Toggle
  const togglePreviewPlayback = () => {
    if (!vocalTake?.localUri) return;
    try {
      if (!previewPlayerRef.current) {
        const player = createAudioPlayer({ uri: vocalTake.localUri });
        player.addListener('playbackStatusUpdate', (status: any) => {
          if (status?.didJustFinish) {
            setIsPreviewPlaying(false);
          }
        });
        previewPlayerRef.current = player;
      }

      if (isPreviewPlaying) {
        previewPlayerRef.current.pause();
        setIsPreviewPlaying(false);
      } else {
        previewPlayerRef.current.play();
        setIsPreviewPlaying(true);
      }
    } catch (err) {
      console.warn('Preview playback error:', err);
    }
  };

  const handleSaveTake = () => {
    if (!vocalTake || !track) return;
    stopPreviewPlayer();
    const saved = saveRecording(
      track.title,
      track.artist,
      vocalTake.localUri,
      vocalTake.durationSeconds,
      track.artwork
    );
    setLastSavedRecording(saved);
    setStudioState('saved');
  };

  const handleDiscardTake = () => {
    Alert.alert(
      'Discard Recording Take',
      'Are you sure you want to discard this vocal take?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Discard', 
          style: 'destructive', 
          onPress: async () => {
            stopPreviewPlayer();
            if (vocalTake?.localUri) {
              await discardRecording(vocalTake.localUri);
            } else {
              await discardRecording();
            }
            setVocalTake(null);
            setStudioState('idle');
            setElapsedSeconds(0);
          } 
        },
      ]
    );
  };

  const handleClose = () => {
    if (studioState === 'recording' || studioState === 'paused') {
      Alert.alert(
        'Recording in Progress',
        'Stop and discard active recording before leaving the studio?',
        [
          { text: 'Keep Recording', style: 'cancel' },
          { 
            text: 'Leave Studio', 
            style: 'destructive', 
            onPress: () => {
              cleanupStudio();
              onClose();
            } 
          }
        ]
      );
    } else {
      cleanupStudio();
      onClose();
    }
  };

  const handleShare = async () => {
    const target = lastSavedRecording?.localUri || vocalTake?.localUri;
    if (!target) return;
    try {
      await shareRecording(target, track?.title);
    } catch (err: any) {
      Alert.alert('Share Error', err?.message || 'Unable to share audio file.');
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={handleClose}>
      <View style={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <View style={styles.badgeRow}>
              <View style={styles.studioBadge}>
                <Ionicons name="mic" size={12} color="#ff3b30" />
                <Text style={styles.studioBadgeText}>STUDIO MODE</Text>
              </View>
              {studioState === 'recording' && (
                <View style={styles.liveBadge}>
                  <View style={styles.redDot} />
                  <Text style={styles.liveBadgeText}>REC {formatTimer(elapsedSeconds)}</Text>
                </View>
              )}
              {studioState === 'paused' && (
                <View style={[styles.liveBadge, { backgroundColor: 'rgba(255, 179, 0, 0.2)' }]}>
                  <Text style={[styles.liveBadgeText, { color: '#ffb300' }]}>PAUSED</Text>
                </View>
              )}
            </View>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {track?.title || 'Sing Along Studio'}
            </Text>
            <Text style={styles.trackArtist} numberOfLines={1}>
              {track?.artist || 'Sukoon Voice Recording'}
            </Text>
          </View>
        </View>

        {/* BGM Cueing & Play/Pause Bar */}
        <View style={styles.bgmBar}>
          <TouchableOpacity 
            onPress={toggleBgmPlayback} 
            activeOpacity={0.7} 
            style={styles.bgmPlayBtn}
          >
            <Ionicons 
              name={isPlaying ? "pause-circle" : "play-circle"} 
              size={36} 
              color="#00ffcc" 
            />
          </TouchableOpacity>
          <View style={styles.bgmTrackInfo}>
            <Text style={styles.bgmTrackTitle} numberOfLines={1}>
              {track?.title || 'Backing Music'}
            </Text>
            <Text style={styles.bgmTrackArtist} numberOfLines={1}>
              {isPlaying ? 'Backing track playing' : 'Tap to cue backing music'}
            </Text>
          </View>
          <View style={styles.liveHifiBadge}>
            <Ionicons name="sparkles" size={12} color="#00ffcc" />
            <Text style={styles.liveHifiBadgeText}>RAW 44.1kHz</Text>
          </View>
        </View>

        {/* Synced Lyrics Live Teleprompter */}
        <View 
          style={[styles.teleprompterContainer, { flex: 1, width: '100%', overflow: 'hidden' }]}
          onLayout={(e) => {
            const { height: h } = e.nativeEvent.layout;
            if (h > 50) {
              setContainerHeight(h);
            }
          }}
        >
          {isLoadingLyrics ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#00ffcc" />
              <Text style={styles.loadingText}>Loading synced karaoke lyrics...</Text>
            </View>
          ) : lyricsData?.lines && lyricsData.lines.length > 0 ? (
            <FlatList
              ref={flatListRef}
              data={lyricsData.lines}
              keyExtractor={(_, index) => index.toString()}
              contentContainerStyle={{
                paddingTop: verticalPadding,
                paddingBottom: verticalPadding,
                paddingHorizontal: 20,
              }}
              getItemLayout={(_, index) => ({
                length: LINE_HEIGHT,
                offset: LINE_HEIGHT * index,
                index,
              })}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => {
                const isActive = index === activeLineIndex;
                return (
                  <View 
                    style={[
                      styles.lyricRow, 
                      { height: LINE_HEIGHT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 0 },
                      isActive && styles.activeLyricRow
                    ]}
                  >
                    <Text 
                      numberOfLines={2}
                      style={[styles.lyricText, isActive && styles.activeLyricText]}
                    >
                      {item.text}
                    </Text>
                  </View>
                );
              }}
            />
          ) : lyricsData?.plainLyrics ? (
            <View style={styles.plainLyricsContainer}>
              <Text style={styles.plainLyricsText}>{lyricsData.plainLyrics}</Text>
            </View>
          ) : (
            <View style={styles.centerContainer}>
              <Ionicons name="mic-outline" size={44} color="#444444" />
              <Text style={styles.noLyricsText}>No synced lyrics found for this track.</Text>
              <Text style={styles.noLyricsSubtext}>You can still sing and capture your studio vocal take!</Text>
            </View>
          )}
        </View>

        {/* Studio Bottom Recording Bar */}
        <View style={styles.recordingConsole}>
          {studioState === 'saved' ? (
            <View style={styles.savedCard}>
              <View style={styles.savedHeaderRow}>
                {track?.artwork ? (
                  <Image source={{ uri: track.artwork }} style={styles.savedCoverImg} />
                ) : (
                  <View style={styles.savedIconBox}>
                    <Ionicons name="mic" size={24} color="#00ffcc" />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.savedTitle}>Vocal Take Saved!</Text>
                  <Text style={styles.savedSubtitle} numberOfLines={1}>
                    {track?.title} ({formatTimer(lastSavedRecording?.durationSeconds || elapsedSeconds)})
                  </Text>
                </View>
              </View>

              <View style={styles.savedActionsRow}>
                <TouchableOpacity style={styles.shareTakeBtn} onPress={handleShare} activeOpacity={0.8}>
                  <Ionicons name="share-social-outline" size={16} color="#ffffff" />
                  <Text style={styles.shareTakeBtnText}>Share Audio</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.newTakeBtn} 
                  onPress={() => {
                    stopPreviewPlayer();
                    setStudioState('idle');
                    setElapsedSeconds(0);
                    setVocalTake(null);
                    setLastSavedRecording(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh" size={15} color="#00ffcc" />
                  <Text style={[styles.newTakeBtnText, { color: '#00ffcc' }]}>New Take</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.doneBtn} 
                  onPress={handleClose}
                  activeOpacity={0.8}
                >
                  <Text style={styles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : studioState === 'stopped' ? (
            /* PREVIEW PLAYER CARD */
            <View style={styles.previewCard}>
              <View style={styles.previewHeaderRow}>
                <TouchableOpacity 
                  style={styles.previewPlayBtn} 
                  onPress={togglePreviewPlayback} 
                  activeOpacity={0.8}
                >
                  <Ionicons 
                    name={isPreviewPlaying ? "pause" : "play"} 
                    size={22} 
                    color="#000000" 
                  />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.previewTitle}>Preview Vocal Take</Text>
                  <Text style={styles.previewSubtitle}>
                    Duration: {formatTimer(vocalTake?.durationSeconds || elapsedSeconds)} • Raw Studio Mic Take
                  </Text>
                </View>
                <View style={styles.waveformSimulation}>
                  <View style={[styles.waveBar, { height: 14 }]} />
                  <View style={[styles.waveBar, { height: 22 }]} />
                  <View style={[styles.waveBar, { height: 18 }]} />
                  <View style={[styles.waveBar, { height: 26 }]} />
                  <View style={[styles.waveBar, { height: 12 }]} />
                </View>
              </View>

              <View style={styles.previewActionsRow}>
                <TouchableOpacity 
                  style={styles.discardBtn} 
                  onPress={handleDiscardTake} 
                  activeOpacity={0.8}
                >
                  <Ionicons name="trash-outline" size={16} color="#ff3b30" />
                  <Text style={styles.discardBtnText}>Discard</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.saveTakeMainBtn} 
                  onPress={handleSaveTake} 
                  activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#000000" />
                  <Text style={styles.saveTakeMainBtnText}>Save Take</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.controlsRow}>
              {/* Left secondary button: Discard (visible during record/pause) */}
              <View style={styles.sideBtnSlot}>
                {(studioState === 'recording' || studioState === 'paused') && (
                  <TouchableOpacity style={styles.secondaryCircleBtn} onPress={handleDiscardTake} activeOpacity={0.7}>
                    <Ionicons name="trash-outline" size={20} color="#ff3b30" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Center Main Record / Stop Button */}
              <View style={styles.centerBtnSlot}>
                {studioState === 'idle' ? (
                  <TouchableOpacity style={styles.recordMainBtn} onPress={handleStartRecord} activeOpacity={0.85}>
                    <View style={styles.recordInnerCircle}>
                      <Ionicons name="mic" size={32} color="#ffffff" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.stopMainBtn} onPress={handleStopRecording} activeOpacity={0.85}>
                    <View style={styles.stopInnerSquare} />
                  </TouchableOpacity>
                )}
                <Text style={styles.recordPromptText}>
                  {studioState === 'idle' 
                    ? 'Tap to Record' 
                    : studioState === 'recording' 
                      ? 'Tap to Finish Take' 
                      : 'Take Paused'}
                </Text>
              </View>

              {/* Right secondary button: Pause / Resume */}
              <View style={styles.sideBtnSlot}>
                {(studioState === 'recording' || studioState === 'paused') && (
                  <TouchableOpacity style={styles.secondaryCircleBtn} onPress={handlePauseResume} activeOpacity={0.7}>
                    <Ionicons 
                      name={studioState === 'recording' ? 'pause' : 'play'} 
                      size={20} 
                      color="#00ffcc" 
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222226',
    backgroundColor: '#0a0a0c',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#18181c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  studioBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  studioBadgeText: {
    color: '#ff3b30',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  redDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ff3b30',
  },
  liveBadgeText: {
    color: '#ff3b30',
    fontSize: 11,
    fontWeight: '700',
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  trackArtist: {
    color: '#888888',
    fontSize: 13,
  },
  bgmBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#0e0e12',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e24',
  },
  bgmPlayBtn: {
    marginRight: 10,
  },
  bgmTrackInfo: {
    flex: 1,
  },
  bgmTrackTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  bgmTrackArtist: {
    color: '#888896',
    fontSize: 11,
    marginTop: 1,
  },
  liveHifiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.2)',
  },
  liveHifiBadgeText: {
    color: '#00ffcc',
    fontSize: 10,
    fontWeight: '800',
  },
  teleprompterContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#aaaaaa',
    fontSize: 14,
    marginTop: 14,
  },
  noLyricsText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  noLyricsSubtext: {
    color: '#777777',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  plainLyricsContainer: {
    paddingVertical: 20,
  },
  plainLyricsText: {
    color: '#dddddd',
    fontSize: 16,
    lineHeight: 28,
    textAlign: 'center',
  },
  lyricsList: {
    paddingVertical: 60,
  },
  lyricRow: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeLyricRow: {
    transform: [{ scale: 1.05 }],
  },
  lyricText: {
    color: '#55555c',
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 26,
  },
  activeLyricText: {
    color: '#00ffcc',
    fontSize: 22,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 255, 204, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  recordingConsole: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
    backgroundColor: '#0a0a0e',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222228',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideBtnSlot: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBtnSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1c1c22',
    borderWidth: 1,
    borderColor: '#2e2e38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordMainBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    borderWidth: 2,
    borderColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInnerCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopMainBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    borderWidth: 2,
    borderColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopInnerSquare: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ff3b30',
  },
  recordPromptText: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
  previewCard: {
    backgroundColor: '#121216',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#282830',
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  previewPlayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#00ffcc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  previewSubtitle: {
    color: '#aaaaaa',
    fontSize: 12,
    marginTop: 2,
  },
  waveformSimulation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: '#00ffcc',
  },
  previewActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  discardBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e24',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  discardBtnText: {
    color: '#ff3b30',
    fontSize: 14,
    fontWeight: '700',
  },
  saveTakeMainBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00ffcc',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  saveTakeMainBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  savedCard: {
    backgroundColor: '#121216',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#282830',
  },
  savedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  savedCoverImg: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#222228',
  },
  savedIconBox: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  savedSubtitle: {
    color: '#aaaaaa',
    fontSize: 13,
    marginTop: 2,
  },
  savedActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  shareTakeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e24',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 5,
  },
  shareTakeBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  newTakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e24',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 5,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.3)',
  },
  newTakeBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  doneBtn: {
    backgroundColor: '#00ffcc',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
});
