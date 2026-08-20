import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPlaylists, getOfflineTracks, Playlist, OfflineTrack } from '../utils/storage';

export function LibraryScreen({ navigation }: any) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [downloadedTracks, setDownloadedTracks] = useState<OfflineTrack[]>([]);

  useFocusEffect(
    useCallback(() => {
      setPlaylists(getPlaylists());
      const offlineDict = getOfflineTracks();
      setDownloadedTracks(Object.values(offlineDict));
    }, [])
  );

  const navigateToPlaylist = (playlist: Playlist) => {
    navigation.navigate('PlaylistDetail', { playlist });
  };

  const navigateToDownloads = () => {
    // Generate a temporary playlist format for downloaded tracks
    const downloadedPlaylist: Playlist = {
      id: 'downloads',
      name: 'Downloaded Tracks',
      tracks: downloadedTracks,
    };
    navigation.navigate('PlaylistDetail', { playlist: downloadedPlaylist });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Your Library</Text>

      <TouchableOpacity style={styles.downloadCard} onPress={navigateToDownloads}>
        <View style={styles.downloadIconPlaceholder} />
        <View style={styles.downloadInfo}>
          <Text style={styles.downloadTitle}>Downloaded Tracks</Text>
          <Text style={styles.downloadCount}>{downloadedTracks.length} offline tracks</Text>
        </View>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Playlists</Text>
      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.playlistCard} onPress={() => navigateToPlaylist(item)}>
            <Image 
              source={{ uri: item.coverImage || 'https://via.placeholder.com/150' }} 
              style={styles.playlistImage} 
            />
            <Text style={styles.playlistName} numberOfLines={1}>{item.name}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No playlists yet.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    padding: 16,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  downloadCard: {
    flexDirection: 'row',
    backgroundColor: '#121212',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  downloadIconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#222222',
  },
  downloadInfo: {
    marginLeft: 16,
  },
  downloadTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  downloadCount: {
    color: '#aaaaaa',
    fontSize: 14,
    marginTop: 4,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  row: {
    justifyContent: 'space-between',
  },
  playlistCard: {
    width: '48%',
    backgroundColor: '#121212',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  playlistImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 4,
    backgroundColor: '#222222',
    marginBottom: 8,
  },
  playlistName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyText: {
    color: '#aaaaaa',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  }
});
