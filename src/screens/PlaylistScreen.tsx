import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Dimensions, TextInput, Alert } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedScrollHandler, 
  useAnimatedStyle, 
  interpolate, 
  Extrapolation 
} from 'react-native-reanimated';
import { Playlist, TrackMetadata } from '../utils/storage';
import { playTrack } from '../services/TrackPlayerService';
import { downloadPlaylistTracks } from '../services/downloadService';
import { sharePlaylist } from '../services/cloudPlaylistService';

const { width } = Dimensions.get('window');
const HEADER_MAX_HEIGHT = width;
const HEADER_MIN_HEIGHT = 100;

// This would typically come from navigation route parameters
interface PlaylistScreenProps {
  route: any;
  navigation: any;
}

export function PlaylistScreen({ route, navigation }: PlaylistScreenProps) {
  const { playlist } = route.params;
  
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const animatedHeaderStyle = useAnimatedStyle(() => {
    const height = interpolate(
      scrollY.value,
      [0, HEADER_MAX_HEIGHT - HEADER_MIN_HEIGHT],
      [HEADER_MAX_HEIGHT, HEADER_MIN_HEIGHT],
      Extrapolation.CLAMP
    );
    return { height };
  });

  const animatedImageStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, (HEADER_MAX_HEIGHT - HEADER_MIN_HEIGHT) / 2],
      [1, 0],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const [shareUsername, setShareUsername] = useState('');
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);

  const handleDownloadAll = () => {
    if (playlist.tracks.length > 0) {
      downloadPlaylistTracks(playlist.tracks);
    }
  };

  const handleShare = async () => {
    if (!shareUsername.trim()) return;
    try {
      await import('../services/cloudPlaylistService').then(m => m.sharePlaylist(playlist, shareUsername.trim()));
      setIsShareModalVisible(false);
      setShareUsername('');
      import('react-native').then(m => m.Alert.alert('Success', 'Playlist shared successfully!'));
    } catch (e: any) {
      import('react-native').then(m => m.Alert.alert('Error', e.message));
    }
  };

  const handlePlayTrack = (track: TrackMetadata) => {
    playTrack(track);
  };

  const renderItem = ({ item }: { item: TrackMetadata }) => (
    <TouchableOpacity style={styles.trackItem} onPress={() => handlePlayTrack(item)}>
      <Image source={{ uri: item.artwork || 'https://via.placeholder.com/50' }} style={styles.trackImage} />
      <View style={styles.trackInfo}>
        <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.header, animatedHeaderStyle]}>
        <Animated.Image 
          source={{ uri: playlist.coverImage || 'https://via.placeholder.com/400' }} 
          style={[styles.headerImage, animatedImageStyle]} 
        />
        <View style={styles.headerOverlay}>
          <Text style={styles.playlistName}>{playlist.name}</Text>
          <Text style={styles.trackCount}>{playlist.tracks.length} Tracks</Text>
        </View>
      </Animated.View>

      <Animated.FlatList
        data={playlist.tracks}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <TouchableOpacity style={styles.downloadBtn} onPress={handleDownloadAll}>
              <Text style={styles.downloadBtnText}>Download All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareBtn} onPress={() => setIsShareModalVisible(true)}>
              <Text style={styles.shareBtnText}>Share Playlist</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {isShareModalVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Share Playlist</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter target username"
              placeholderTextColor="#888888"
              value={shareUsername}
              onChangeText={setShareUsername}
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setIsShareModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSubmit} onPress={handleShare}>
                <Text style={styles.modalSubmitText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  shareBtn: {
    backgroundColor: '#121212',
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
    marginTop: 10,
  },
  shareBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    backgroundColor: '#121212',
    overflow: 'hidden',
  },
  headerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  playlistName: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  trackCount: {
    color: '#aaaaaa',
    fontSize: 14,
    marginTop: 4,
  },
  listContent: {
    paddingTop: HEADER_MAX_HEIGHT,
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  listHeader: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222222',
    marginBottom: 16,
  },
  downloadBtn: {
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
  },
  downloadBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  trackImage: {
    width: 50,
    height: 50,
    borderRadius: 4,
    backgroundColor: '#121212',
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 4,
  },
  trackArtist: {
    color: '#aaaaaa',
    fontSize: 14,
  },
});
