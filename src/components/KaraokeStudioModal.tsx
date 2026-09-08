import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Dimensions,
  Alert,
  PanResponder,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, { useIsPlaying } from '@rntp/player';
import { TrackMetadata, StudioRecording, saveStudioRecording } from '../utils/storage';
import { getLyricsWithSource, ParsedLyrics, LyricLine } from '../services/lyricsService';
import { 
  startRecording, 
  pauseRecording, 
  resumeRecording, 
  stopAndSaveRecording, 
  discardRecording,
  shareRecording 
} from '../services/recordingService';
import { setPlayerVolume } from '../services/TrackPlayerService';
import { mixVocalWithBackingTrack } from '../services/audioMixingService';
import { getAudioStream } from '../services/musicApi';
import { showToast } from './ToastNotification';

const { width } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
  track: TrackMetadata | null;
  currentPosition: number;
  duration?: number;
}

type StudioState = 'idle' | 'recording' | 'paused' | 'saved';

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
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [bgmVolume, setBgmVolume] = useState<number>(60); // 0 to 100, default 60%
  const [vocalVolume, setVocalVolume] = useState<number>(100); // 0 to 100, default 100%
  const [studioState, setStudioState] = useState<StudioState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [lastSavedRecording, setLastSavedRecording] = useState<StudioRecording | null>(null);
  const [isMixingMaster, setIsMixingMaster] = useState<boolean>(false);

  const flatListRef = useRef<FlatList<LyricLine>>(null);
  const timerIntervalRef = useRef<any>(null);
  const recordingStartOffsetRef = useRef<number>(0);
  const bgmSliderWidth = useRef<number>(width - 40);
  const vocalSliderWidth = useRef<number>(width - 40);

  // Load lyrics and configure monitoring volume when modal opens
  useEffect(() => {
    if (visible && track) {
      loadLyrics();
      // Set initial BGM monitoring volume to 60%
      setBgmVolume(60);
      setVocalVolume(100);
      setPlayerVolume(0.60).catch(() => {});
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

  const cleanupStudio = () => {
    if (studioState === 'recording' || studioState === 'paused') {
      discardRecording().catch(() => {});
    }
    setStudioState('idle');
    setElapsedSeconds(0);
    setLastSavedRecording(null);
    // Restore full volume
    setPlayerVolume(1.0).catch(() => {});
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
    if (activeLineIndex >= 0 && flatListRef.current && lyricsData?.lines?.length) {
      try {
        flatListRef.current.scrollToIndex({
          index: activeLineIndex,
          animated: true,
          viewPosition: 0.35,
        });
      } catch {}
    }
  }, [activeLineIndex]);

  // Backing Music Volume PanResponder
  const bgmPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const percent = Math.round(Math.max(0, Math.min(100, (x / (bgmSliderWidth.current || 1)) * 100)));
        setBgmVolume(percent);
        setPlayerVolume(percent / 100).catch(() => {});
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const percent = Math.round(Math.max(0, Math.min(100, (x / (bgmSliderWidth.current || 1)) * 100)));
        setBgmVolume(percent);
        setPlayerVolume(percent / 100).catch(() => {});
      },
    })
  ).current;

  // Vocal Volume PanResponder
  const vocalPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const percent = Math.round(Math.max(0, Math.min(100, (x / (vocalSliderWidth.current || 1)) * 100)));
        setVocalVolume(percent);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const percent = Math.round(Math.max(0, Math.min(100, (x / (vocalSliderWidth.current || 1)) * 100)));
        setVocalVolume(percent);
      },
    })
  ).current;

  // Recording Controls
  const handleStartRecord = async () => {
    try {
      let startOffset = currentPosition || 0;
      try {
        const p = await TrackPlayer.getProgress();
        if (p && typeof p.position === 'number' && p.position >= 0) {
          startOffset = p.position;
        }
      } catch {}
      recordingStartOffsetRef.current = startOffset;

      // Ensure backing music is playing for vocal cue
      try {
        await TrackPlayer.play();
      } catch {}

      await startRecording();
      setElapsedSeconds(0);
      setStudioState('recording');
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

  const handleStopAndSave = async () => {
    if (!track) return;
    try {
      try {
        await TrackPlayer.pause();
      } catch {}

      const saved = await stopAndSaveRecording(track.title, track.artist, elapsedSeconds);
      if (saved) {
        setLastSavedRecording(saved);
        setStudioState('saved');
      } else {
        setStudioState('idle');
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not finalize recording', 'alert-circle');
      setStudioState('idle');
    }
  };

  const handleSaveMasterSong = async () => {
    if (!lastSavedRecording || !track) return;
    setIsMixingMaster(true);
    try {
      let backingTrackUri = track.url;
      if (!backingTrackUri) {
        const stream = await getAudioStream(track.id);
        backingTrackUri = typeof stream === 'string' ? stream : (stream as any)?.url;
      }
      if (!backingTrackUri) {
        throw new Error('Unable to resolve stream URL for backing track');
      }

      const mixedUri = await mixVocalWithBackingTrack({
        vocalUri: lastSavedRecording.localUri,
        backingTrackUri,
        vocalVolume: vocalVolume / 100,
        musicVolume: bgmVolume / 100,
        startTimeSeconds: recordingStartOffsetRef.current,
        durationSeconds: lastSavedRecording.durationSeconds,
      });

      const playableMixedUri = mixedUri.startsWith('file://') ? mixedUri : `file://${mixedUri}`;

      const masterRecording: StudioRecording = {
        id: `master_${Date.now()}`,
        songTitle: `${track.title} (Master Cover)`,
        artist: track.artist ? `Cover by You • ${track.artist}` : 'Studio Vocal Cover',
        localUri: playableMixedUri,
        createdAt: Date.now(),
        durationSeconds: lastSavedRecording.durationSeconds,
        artwork: track.artwork,
        isMasterMixed: true,
      };

      saveStudioRecording(masterRecording);
      showToast('Master song saved to Studio Recordings!', 'checkmark-circle');
      cleanupStudio();
      onClose();
    } catch (err: any) {
      console.error('[KaraokeStudio] Save master error:', err);
      Alert.alert('Master Mix Error', err?.message || 'Failed to overlay vocals onto backing track.');
    } finally {
      setIsMixingMaster(false);
    }
  };

  const handleDiscard = () => {
    Alert.alert(
      'Discard Recording',
      'Are you sure you want to discard this recording take?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Discard', 
          style: 'destructive', 
          onPress: async () => {
            await discardRecording();
            setStudioState('idle');
            setElapsedSeconds(0);
            setLastSavedRecording(null);
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
    if (!lastSavedRecording) return;
    try {
      await shareRecording(lastSavedRecording.localUri, lastSavedRecording.songTitle);
    } catch (err: any) {
      Alert.alert('Share Error', err.message || 'Unable to share audio file.');
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

        {/* BGM Cueing, Play/Pause & Dual Volume Mixer Control */}
        <View style={styles.mixerCard}>
          <View style={styles.bgmRow}>
            <TouchableOpacity 
              onPress={toggleBgmPlayback} 
              activeOpacity={0.7} 
              style={styles.bgmPlayBtn}
            >
              <Ionicons 
                name={isPlaying ? "pause-circle" : "play-circle"} 
                size={38} 
                color="#00ffcc" 
              />
            </TouchableOpacity>
            <View style={styles.bgmTrackInfo}>
              <Text style={styles.bgmTrackTitle} numberOfLines={1}>
                {track?.title || 'No Track Selected'}
              </Text>
              <Text style={styles.bgmTrackArtist} numberOfLines={1}>
                {track?.artist || 'Cue backing track'}
              </Text>
            </View>
          </View>

          {/* Backing Music Volume Slider */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderLabelRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="musical-notes-outline" size={13} color="#00ffcc" />
                <Text style={styles.sliderLabel}>Backing Music Volume</Text>
              </View>
              <Text style={styles.sliderValueText}>{bgmVolume}%</Text>
            </View>
            <View 
              style={styles.sliderContainer}
              onLayout={(e) => { bgmSliderWidth.current = e.nativeEvent.layout.width; }}
              {...bgmPanResponder.panHandlers}
            >
              <View style={styles.sliderTrack} />
              <View style={[styles.sliderFill, { width: `${bgmVolume}%`, backgroundColor: '#00ffcc' }]} />
              <View style={[styles.sliderThumb, { left: `${bgmVolume}%` }]} />
            </View>
          </View>

          {/* Vocal Volume Slider */}
          <View style={[styles.sliderSection, { marginTop: 6 }]}>
            <View style={styles.sliderLabelRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="mic-outline" size={13} color="#ff3b30" />
                <Text style={styles.sliderLabel}>Vocal Volume</Text>
              </View>
              <Text style={[styles.sliderValueText, { color: '#ff3b30' }]}>{vocalVolume}%</Text>
            </View>
            <View 
              style={styles.sliderContainer}
              onLayout={(e) => { vocalSliderWidth.current = e.nativeEvent.layout.width; }}
              {...vocalPanResponder.panHandlers}
            >
              <View style={styles.sliderTrack} />
              <View style={[styles.sliderFill, { width: `${vocalVolume}%`, backgroundColor: '#ff3b30' }]} />
              <View style={[styles.sliderThumb, { left: `${vocalVolume}%` }]} />
            </View>
          </View>
        </View>

        {/* Synced Lyrics Live Teleprompter */}
        <View style={styles.teleprompterContainer}>
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
              contentContainerStyle={styles.lyricsList}
              showsVerticalScrollIndicator={false}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item, index }) => {
                const isActive = index === activeLineIndex;
                return (
                  <View style={[styles.lyricRow, isActive && styles.activeLyricRow]}>
                    <Text style={[styles.lyricText, isActive && styles.activeLyricText]}>
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
              <Text style={styles.noLyricsSubtext}>You can still record your vocal cover over the instrumental backing track!</Text>
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
                    <Ionicons name="disc" size={24} color="#00ffcc" />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.savedTitle}>Take Recorded & Ready to Mix</Text>
                  <Text style={styles.savedSubtitle} numberOfLines={1}>
                    {track?.title} ({formatTimer(lastSavedRecording?.durationSeconds || elapsedSeconds)})
                  </Text>
                </View>
              </View>

              {/* Volume Balance Summary */}
              <View style={styles.mixSummaryRow}>
                <View style={styles.mixSummaryItem}>
                  <Ionicons name="musical-notes-outline" size={13} color="#00ffcc" />
                  <Text style={styles.mixSummaryText}>Music: {bgmVolume}%</Text>
                </View>
                <View style={styles.mixSummaryItem}>
                  <Ionicons name="mic-outline" size={13} color="#ff3b30" />
                  <Text style={styles.mixSummaryText}>Vocals: {vocalVolume}%</Text>
                </View>
              </View>

              {/* Master Mix Button */}
              <TouchableOpacity 
                style={[styles.saveMasterBtn, isMixingMaster && { opacity: 0.7 }]} 
                onPress={handleSaveMasterSong}
                disabled={isMixingMaster}
                activeOpacity={0.8}
              >
                {isMixingMaster ? (
                  <View style={styles.btnContentRow}>
                    <ActivityIndicator size="small" color="#000000" />
                    <Text style={styles.saveMasterBtnText}>Overlaying vocals onto backing track...</Text>
                  </View>
                ) : (
                  <View style={styles.btnContentRow}>
                    <Ionicons name="sparkles" size={18} color="#000000" />
                    <Text style={styles.saveMasterBtnText}>Save Master Song (Mix Vocals + Music)</Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={styles.savedActionsRow}>
                <TouchableOpacity style={styles.shareTakeBtn} onPress={handleShare} activeOpacity={0.8}>
                  <Ionicons name="share-social-outline" size={16} color="#ffffff" />
                  <Text style={styles.shareTakeBtnText}>Share Raw Take</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.newTakeBtn} 
                  onPress={() => {
                    setStudioState('idle');
                    setElapsedSeconds(0);
                    setLastSavedRecording(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh" size={15} color="#888888" />
                  <Text style={styles.newTakeBtnText}>New Take</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.controlsRow}>
              {/* Left secondary button: Discard (visible during record/pause) */}
              <View style={styles.sideBtnSlot}>
                {(studioState === 'recording' || studioState === 'paused') && (
                  <TouchableOpacity style={styles.secondaryCircleBtn} onPress={handleDiscard} activeOpacity={0.7}>
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
                  <TouchableOpacity style={styles.stopMainBtn} onPress={handleStopAndSave} activeOpacity={0.85}>
                    <View style={styles.stopInnerSquare} />
                  </TouchableOpacity>
                )}
                <Text style={styles.recordPromptText}>
                  {studioState === 'idle' 
                    ? 'Tap to Record' 
                    : studioState === 'recording' 
                      ? 'Tap to Finish & Save' 
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
  mixerCard: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#0e0e12',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e24',
  },
  bgmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  bgmPlayBtn: {
    paddingRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bgmTrackInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  bgmTrackTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  bgmTrackArtist: {
    color: '#888896',
    fontSize: 12,
    marginTop: 1,
  },
  bgmVolBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  bgmVolText: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '700',
  },
  sliderContainer: {
    height: 30,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#26262e',
    width: '100%',
  },
  sliderFill: {
    position: 'absolute',
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#00ffcc',
    left: 0,
  },
  sliderThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    marginLeft: -9,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
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
  mixSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  mixSummaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mixSummaryText: {
    color: '#cccccc',
    fontSize: 12,
    fontWeight: '600',
  },
  saveMasterBtn: {
    backgroundColor: '#00ffcc',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveMasterBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
  },
  savedActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  shareTakeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e24',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  shareTakeBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  newTakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222228',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    gap: 6,
  },
  newTakeBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  sliderSection: {
    marginTop: 6,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sliderLabel: {
    color: '#888896',
    fontSize: 12,
    fontWeight: '600',
  },
  sliderValueText: {
    color: '#00ffcc',
    fontSize: 12,
    fontWeight: '700',
  },
});
