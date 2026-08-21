import TrackPlayer, { Event, BackgroundEvent } from '@rntp/player';

export default async function playbackService(event: BackgroundEvent) {
  if (event.type === Event.RemotePlay) await TrackPlayer.play();
  if (event.type === Event.RemotePause) await TrackPlayer.pause();
  if (event.type === Event.RemoteNext) await TrackPlayer.skipToNext();
  if (event.type === Event.RemotePrevious) await TrackPlayer.skipToPrevious();
}
