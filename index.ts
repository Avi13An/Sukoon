import { registerRootComponent } from 'expo';
import TrackPlayer, { Event, type BackgroundEvent } from '@rntp/player';
import App from './App';
import { playNextTrack } from './src/services/TrackPlayerService';

try {
  TrackPlayer.registerBackgroundEventHandler(() => async (event: BackgroundEvent) => {
    console.log('[TrackPlayer BackgroundEvent]:', event.type);
    if (event.type === Event.RemoteNext) {
      await playNextTrack();
    } else if (event.type === Event.RemotePrevious) {
      try {
        const p = await TrackPlayer.getProgress();
        if (p && p.position > 3) {
          await TrackPlayer.seekTo(0);
        } else {
          await TrackPlayer.seekTo(0);
        }
      } catch {
        try { await TrackPlayer.seekTo(0); } catch {}
      }
    } else if (event.type === Event.RemotePlay) {
      try { await TrackPlayer.play(); } catch {}
    } else if (event.type === Event.RemotePause) {
      try { await TrackPlayer.pause(); } catch {}
    } else if (event.type === Event.RemoteSeek) {
      const pos = (event as any).position;
      if (typeof pos === 'number') {
        try { await TrackPlayer.seekTo(pos); } catch {}
      }
    }
  });
} catch (e) {
  console.log('[index.ts] registerBackgroundEventHandler warning:', e);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
