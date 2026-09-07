import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';
import TrackPlayer, { Event, PlaybackState, type BackgroundEvent } from '@rntp/player';
import App from './App';
import { playNextTrack, playPreviousTrack, handleAutoplayTransition, PlaybackService } from './src/services/TrackPlayerService';

try {
  TrackPlayer.registerBackgroundEventHandler(() => async (event: BackgroundEvent) => {
    console.log('[TrackPlayer BackgroundEvent]:', event.type);
    if (event.type === Event.RemoteNext) {
      await playNextTrack();
    } else if (event.type === Event.RemotePrevious) {
      await playPreviousTrack();
    } else if (event.type === Event.RemotePlay) {
      try { await TrackPlayer.play(); } catch {}
    } else if (event.type === Event.RemotePause) {
      try { await TrackPlayer.pause(); } catch {}
    } else if (event.type === Event.RemoteSeek) {
      const pos = (event as any).position;
      if (typeof pos === 'number') {
        try { await TrackPlayer.seekTo(pos); } catch {}
      }
    } else if (
      event.type === Event.PlaybackStateChanged &&
      ((event as any).state === PlaybackState.Ended || (event as any).state === 'ended')
    ) {
      console.log('[BackgroundEvent] PlaybackState.Ended received, triggering autoplay...');
      await handleAutoplayTransition();
    } else if (
      event.type === Event.MediaItemTransition &&
      (event as any).item === null &&
      (event as any).index === -1
    ) {
      console.log('[BackgroundEvent] MediaItemTransition to null received, triggering autoplay...');
      await handleAutoplayTransition();
    } else if (
      (event.type as any) === 'event.playback-queue-ended' ||
      (event.type as any) === (Event as any).PlaybackQueueEnded
    ) {
      console.log('[BackgroundEvent] PlaybackQueueEnded received, triggering autoplay...');
      await handleAutoplayTransition();
    }
  });
} catch (e) {
  console.log('[index.ts] registerBackgroundEventHandler warning:', e);
}

try {
  const queueEndedEvent = (Event as any).PlaybackQueueEnded || 'event.playback-queue-ended';
  TrackPlayer.addEventListener(queueEndedEvent as any, async () => {
    await handleAutoplayTransition();
  });

  TrackPlayer.addEventListener(Event.PlaybackStateChanged, async (event: any) => {
    if (event?.state === PlaybackState.Ended || (event as any)?.state === 'ended') {
      await handleAutoplayTransition();
    }
  });

  TrackPlayer.addEventListener(Event.MediaItemTransition, async (event: any) => {
    // Only trigger if a track actually finished, not during empty queue resets
    if (event?.item === null && event?.index === -1) {
      await handleAutoplayTransition();
    }
  });
} catch (err) {
  console.log('[index.ts] addEventListener warning:', err);
}

if (typeof (TrackPlayer as any).registerPlaybackService === 'function') {
  try {
    (TrackPlayer as any).registerPlaybackService(() => PlaybackService);
  } catch {}
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
