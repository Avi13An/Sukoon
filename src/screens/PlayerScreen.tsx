import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, Dimensions, ActivityIndicator, Alert, TextInput } from 'react-native';
import TrackPlayer, { useActiveTrack, usePlaybackState, useProgress, State, RepeatMode } from 'react-native-track-player';
import { Ionicons } from '@expo/vector-icons';
import { fetchLyrics, LrcLibResponse } from '../services/lyricsService';
import { parseSyncedLyrics, SyncedLyricLine } from '../utils/lyricsParser';
import { hostSyncSession, inviteToSync } from '../services/syncService';
import { toggleLoopMode } from '../services/TrackPlayerService';
import { AudioSettingsModal } from '../components/AudioSettingsModal';

const { width } = Dimensions.get('window');

export function PlayerScreen({ navigation }: any) {
  const track = useActiveTrack();
  const playerState = usePlaybackState();
  const { position, duration } = useProgress(250);

  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.Off);
  const [isAudioSettingsVisible, setIsAudioSettingsVisible] = useState(false);

  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsData, setLyricsData] = useState<LrcLibResponse | null>(null);
  const [syncedLines, setSyncedLines] = useState<SyncedLyricLine[]>([]);
  
  const scrollViewRef = useRef<ScrollView>(null);
  
  const isPlaying = playerState.state === State.Playing;

  useEffect(() => {
    if (showLyrics && track && !lyricsData && !lyricsLoading) {
      loadLyrics();
    }
  }, [showLyrics, track]);

  useEffect(() => {
    TrackPlayer.getRepeatMode().then((mode) => setRepeatMode(mode));
  }, []);

  const handleLoopToggle = async () => {
    const newMode = await toggleLoopMode();
    setRepeatMode(newMode);
  };

  const loadLyrics = async () => {
    if (!track?.title || !track?.artist) return;
    
    setLyricsLoading(true);
    const data = await fetchLyrics(track.title, track.artist);
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
    await TrackPlayer.skipToNext();
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
    activeLineIndex = syncedLines.findIndex(line => line.time > position) - 1;
    if (activeLineIndex === -2) activeLineIndex = syncedLines.length - 1;
  }

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-down" size={32} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Now Playing</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIcon} onPress={() => setIsAudioSettingsVisible(true)}>
            <Ionicons name="options" size={24} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIcon} onPress={() => setIsSyncModalVisible(true)}>
            <Ionicons name="people" size={24} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIcon} onPress={() => setShowLyrics(!showLyrics)}>
            <Ionicons name="text" size={24} color={showLyrics ? '#ffffff' : '#888888'} />
          </TouchableOpacity>
        </View>
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
                    {line.text}
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
          <Image source={{ uri: track.artwork || 'https://via.placeholder.com/400' }} style={styles.artworkLg} />
          <View style={styles.trackInfoContainer}>
            <Text style={styles.titleLg} numberOfLines={2}>{track.title}</Text>
            <Text style={styles.artistLg} numberOfLines={1}>{track.artist}</Text>
          </View>
        </View>
      )}

      <View style={styles.controlsContainer}>
        <View style={styles.progressRow}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${duration > 0 ? (position / duration) * 100 : 0}%` }]} />
          </View>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>

        <View style={styles.buttonsRow}>
          <TouchableOpacity onPress={handleLoopToggle} style={styles.controlBtn}>
            <Ionicons 
              name={repeatMode === RepeatMode.Track ? "repeat-outline" : "repeat"} 
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
    width: 40,
    textAlign: 'center',
  },
  progressBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: '#333333',
    borderRadius: 2,
    marginHorizontal: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 2,
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  controlBtn: {
    padding: 16,
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
