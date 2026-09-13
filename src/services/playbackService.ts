import TrackPlayer, { Event, BackgroundEvent } from '@rntp/player';
import { checkSleepTimerExpiration } from './sleepTimerService';

export default async function playbackService(event: BackgroundEvent) {
  if (event.type === Event.PlaybackProgressUpdated) {
    await checkSleepTimerExpiration();
  }
  if (event.type === Event.RemotePlay) await TrackPlayer.play();
  if (event.type === Event.RemotePause) await TrackPlayer.pause();
  if (event.type === Event.RemoteNext) await TrackPlayer.skipToNext();
  if (event.type === Event.RemotePrevious) await TrackPlayer.skipToPrevious();
  if (event.type === Event.PlaybackError) {
    console.error('[NATIVE EXOPLAYER ERROR IN BACKGROUND]:', (event as any).error || event);
  }
}

