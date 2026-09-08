import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { MainNavigator } from './src/navigation/MainNavigator';
import { setupPlayer } from './src/services/TrackPlayerService';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { subscribeToSharedPlaylists } from './src/services/cloudPlaylistService';
import { initCollabInboxListener } from './src/services/collabPlaylistService';
import { getMyUsername } from './src/utils/storage';
import { SyncPromptModal } from './src/components/SyncPromptModal';
import { ToastNotification } from './src/components/ToastNotification';
import TrackPlayer from '@rntp/player';

TrackPlayer.registerBackgroundEventHandler(() => require('./src/services/playbackService').default);

export default function App() {
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  useEffect(() => {
    async function init() {
      const isSetup = await setupPlayer();
      setIsPlayerReady(isSetup);

      if (getMyUsername()) {
        subscribeToSharedPlaylists();
        initCollabInboxListener();
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
      <ToastNotification />
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
