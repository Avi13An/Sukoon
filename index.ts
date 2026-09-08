import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';
import TrackPlayer, { Event, PlaybackState, type BackgroundEvent } from '@rntp/player';
import App from './App';
import {
  playNextTrack,
  playPreviousTrack,
  handleActiveTrackChanged,
  handleEmergencyQueueEnded,
  PlaybackService,
  getCurrentTrack,
  getUpNextQueue,
} from './src/services/TrackPlayerService';
import * as syncService from './src/services/syncService';

try {
  TrackPlayer.registerBackgroundEventHandler(() => async (event: BackgroundEvent) => {
    console.log('[TrackPlayer BackgroundEvent]:', event.type);
    if (event.type === Event.RemoteNext) {
      await playNextTrack();
      if (syncService.isSyncActive()) {
        syncService.broadcastTrackChange(getCurrentTrack(), getUpNextQueue());
      }
    } else if (event.type === Event.RemotePrevious) {
      await playPreviousTrack();
      if (syncService.isSyncActive()) {
        syncService.broadcastTrackChange(getCurrentTrack(), getUpNextQueue());
      }
    } else if (event.type === Event.RemotePlay) {
      try { await TrackPlayer.play(); } catch {}
      if (syncService.isSyncActive()) {
        try {
          const p = await TrackPlayer.getProgress();
          syncService.broadcastPlay(p?.position || 0);
        } catch {
          syncService.broadcastPlay(0);
        }
      }
    } else if (event.type === Event.RemotePause) {
      try { await TrackPlayer.pause(); } catch {}
      if (syncService.isSyncActive()) {
        try {
          const p = await TrackPlayer.getProgress();
          syncService.broadcastPause(p?.position || 0);
        } catch {
          syncService.broadcastPause(0);
        }
      }
    } else if (event.type === Event.RemoteSeek) {
      const pos = (event as any).position;
      if (typeof pos === 'number') {
        try { await TrackPlayer.seekTo(pos); } catch {}
        if (syncService.isSyncActive()) {
          syncService.broadcastSeek(pos);
        }
      }
    } else if (
      event.type === Event.MediaItemTransition ||
      event.type === ((Event as any).PlaybackActiveTrackChanged || 'playback-active-track-changed')
    ) {
      await handleActiveTrackChanged(event);
    } else if (
      (event.type as any) === 'event.playback-queue-ended' ||
      (event.type as any) === (Event as any).PlaybackQueueEnded
    ) {
      console.log('[BackgroundEvent] PlaybackQueueEnded emergency received...');
      await handleEmergencyQueueEnded();
    }
  });
} catch (e) {
  console.log('[index.ts] registerBackgroundEventHandler warning:', e);
}

try {
  const queueEndedEvent = (Event as any).PlaybackQueueEnded || 'event.playback-queue-ended';
  TrackPlayer.addEventListener(queueEndedEvent as any, async () => {
    await handleEmergencyQueueEnded();
  });

  TrackPlayer.addEventListener(Event.MediaItemTransition, async (event: any) => {
    await handleActiveTrackChanged(event);
  });

  const activeTrackChangedEvent = (Event as any).PlaybackActiveTrackChanged || 'playback-active-track-changed';
  TrackPlayer.addEventListener(activeTrackChangedEvent as any, async (event: any) => {
    await handleActiveTrackChanged(event);
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
