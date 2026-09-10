import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import TrackPlayer, { useActiveMediaItem, useIsPlaying } from '@rntp/player';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { subscribeToSyncStatus, disconnectSync } from '../services/syncService';
import { useBottomClearance, MINI_PLAYER_HEIGHT } from '../hooks/useBottomClearance';

export function MiniPlayer() {
  const track = useActiveMediaItem();
  const isPlaying = useIsPlaying();
  const navigation = useNavigation<any>();
  const { totalBarHeight } = useBottomClearance();

  const [isSyncing, setIsSyncing] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [peer, setPeer] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToSyncStatus((syncing, host, currentPeer) => {
      setIsSyncing(syncing);
      setIsHost(host);
      setPeer(currentPeer);
    });
    return unsubscribe;
  }, []);

  if (!track) return null;

  const togglePlayback = async () => {
    if (isPlaying) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  };

  const handleDisconnect = () => {
    disconnectSync();
  };

  const artworkUri = 
    (track as any)?.artwork || 
    (track as any)?.artworkUrl || 
    (track as any)?.thumbnail || 
    'https://via.placeholder.com/50';

  return (
    <TouchableOpacity 
      style={[styles.container, { bottom: totalBarHeight }]} 
      activeOpacity={0.9} 
      onPress={() => navigation.navigate('Player')}
    >
      <Image source={{ uri: artworkUri }} style={styles.artwork} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
      </View>
      
      {isSyncing && (
        <TouchableOpacity style={styles.syncIndicator} onPress={handleDisconnect}>
          <Ionicons name="flash" size={16} color="#00ffcc" />
          <Text style={styles.syncText}>{isHost ? 'Hosting' : 'Syncing'}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={togglePlayback} style={styles.playButton}>
        <Ionicons name={isPlaying ? "pause" : "play"} size={24} color="#ffffff" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: MINI_PLAYER_HEIGHT,
    backgroundColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#333333',
  },
  artwork: {
    width: 40,
    height: 40,
    borderRadius: 4,
    backgroundColor: '#333333',
  },
  info: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  artist: {
    color: '#aaaaaa',
    fontSize: 12,
    marginTop: 2,
  },
  syncIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  syncText: {
    color: '#00ffcc',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  playButton: {
    padding: 8,
  },
});
