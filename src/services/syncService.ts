import { supabase } from './supabase';
import TrackPlayer, { Event } from '@rntp/player';

let currentChannel: ReturnType<typeof supabase.channel> | null = null;
let isHost = false;
let isSyncing = false;
let hostEventListeners: any[] = [];
let statusListeners: ((syncing: boolean, host: boolean, peer: string | null) => void)[] = [];
let currentPeer: string | null = null;

function notifyListeners() {
  statusListeners.forEach(fn => fn(isSyncing, isHost, currentPeer));
}

export function subscribeToSyncStatus(fn: (syncing: boolean, host: boolean, peer: string | null) => void) {
  statusListeners.push(fn);
  fn(isSyncing, isHost, currentPeer);
  return () => {
    statusListeners = statusListeners.filter(l => l !== fn);
  };
}

export async function hostSyncSession(targetUsername: string) {
  if (currentChannel) {
    disconnectSync();
  }

  isHost = true;
  isSyncing = true;
  currentPeer = targetUsername;
  
  const roomName = `sync_room_${targetUsername}`;
  currentChannel = supabase.channel(roomName);
  
  currentChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      console.log('Hosting sync session in', roomName);
      notifyListeners();
    }
  });

  const playListener = TrackPlayer.addEventListener(Event.IsPlayingChanged, async (event: any) => {
    const position = TrackPlayer.getProgress();
    if (event.playing) {
      const track = TrackPlayer.getActiveMediaItem();
      broadcast('SYNC_PLAY', { position: position.position, track });
    } else {
      broadcast('SYNC_PAUSE', { position: position.position });
    }
  });

  const trackChangeListener = TrackPlayer.addEventListener(Event.MediaItemTransition, async (event: any) => {
    const track = TrackPlayer.getActiveMediaItem();
    if (track) {
      broadcast('SYNC_TRACK_CHANGE', { track });
    }
  });

  hostEventListeners = [playListener, trackChangeListener];
}

export async function joinSyncSession(hostUsername: string) {
  if (currentChannel) {
    disconnectSync();
  }

  isHost = false;
  isSyncing = true;
  currentPeer = hostUsername;

  const roomName = `sync_room_${hostUsername}`;
  currentChannel = supabase.channel(roomName);

  currentChannel
    .on('broadcast', { event: 'SYNC_PLAY' }, async ({ payload }) => {
      const { position, track } = payload;
      const currentTrack = TrackPlayer.getActiveMediaItem();
      if ((currentTrack as any)?.url !== track?.url && track) {
        TrackPlayer.clear();
        TrackPlayer.setMediaItems([track]);
      }
      await TrackPlayer.seekTo(position);
      await TrackPlayer.play();
    })
    .on('broadcast', { event: 'SYNC_PAUSE' }, async ({ payload }) => {
      const { position } = payload;
      await TrackPlayer.seekTo(position);
      await TrackPlayer.pause();
    })
    .on('broadcast', { event: 'SYNC_TRACK_CHANGE' }, async ({ payload }) => {
      const { track } = payload;
      if (track) {
        TrackPlayer.clear();
        TrackPlayer.setMediaItems([track]);
        await TrackPlayer.play();
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Joined sync session in', roomName);
        notifyListeners();
      }
    });
}

function broadcast(event: string, payload: any) {
  if (currentChannel && isHost) {
    currentChannel.send({
      type: 'broadcast',
      event,
      payload,
    });
  }
}

export function disconnectSync() {
  if (currentChannel) {
    supabase.removeChannel(currentChannel);
    currentChannel = null;
  }
  hostEventListeners.forEach(listener => listener.remove());
  hostEventListeners = [];
  
  isHost = false;
  isSyncing = false;
  currentPeer = null;
  notifyListeners();
}

export function inviteToSync(targetUsername: string) {
  const { getMyUsername } = require('../utils/storage');
  const myUsername = getMyUsername();
  if (!myUsername) return;
  
  const notifyChannel = supabase.channel(`notifications_${targetUsername}`);
  notifyChannel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      notifyChannel.send({
        type: 'broadcast',
        event: 'SYNC_INVITE',
        payload: { hostUsername: myUsername },
      }).then(() => {
        supabase.removeChannel(notifyChannel);
      });
    }
  });
}

export function listenForSyncInvites(onInvite: (hostUsername: string) => void) {
  const { getMyUsername } = require('../utils/storage');
  const myUsername = getMyUsername();
  if (!myUsername) return null;

  const notifyChannel = supabase.channel(`notifications_${myUsername}`);
  notifyChannel
    .on('broadcast', { event: 'SYNC_INVITE' }, ({ payload }) => {
      onInvite(payload.hostUsername);
    })
    .subscribe();

  return notifyChannel;
}
