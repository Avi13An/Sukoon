import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { MainNavigator } from './src/navigation/MainNavigator';
import { setupPlayer } from './src/services/TrackPlayerService';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { subscribeToSharedPlaylists } from './src/services/cloudPlaylistService';
import { getMyUsername } from './src/utils/storage';
import { SyncPromptModal } from './src/components/SyncPromptModal';

export default function App() {
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  useEffect(() => {
    async function init() {
      const isSetup = await setupPlayer();
      setIsPlayerReady(isSetup);

      if (getMyUsername()) {
        subscribeToSharedPlaylists();
      }
    }
    init();
  }, []);

  if (!isPlayerReady) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <MainNavigator />
      <SyncPromptModal />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 16,
  },
});
