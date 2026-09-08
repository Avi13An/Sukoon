import { AppState } from 'react-native';
import mqtt, { MqttClient } from 'mqtt';
import TrackPlayer from '@rntp/player';
import { 
  getCurrentTrack, 
  getUpNextQueue, 
  playTrack, 
  syncQueueFromHost 
} from './TrackPlayerService';
import { showToast } from '../components/ToastNotification';
import { getActiveUser, TrackMetadata } from '../utils/storage';
import { supabase } from './supabase';

const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

export interface ConnectedClient {
  clientId: string;
  username: string;
  joinedAt: number;
}

export interface SyncMessage {
  type: 
    | 'CLIENT_JOIN' 
    | 'CLIENT_LEAVE' 
    | 'ROOM_SNAPSHOT' 
    | 'SYNC_STATE' 
    | 'SYNC_PLAY' 
    | 'SYNC_PAUSE' 
    | 'SYNC_SEEK' 
    | 'SYNC_TRACK_CHANGE' 
    | 'SYNC_QUEUE_UPDATE'
    | 'SYNC_REQUEST';
  senderId: string;
  targetClientId?: string;
  username?: string;
  track?: TrackMetadata | null;
  position?: number;
  isPlaying?: boolean;
  queue?: TrackMetadata[];
  playlistTitle?: string;
  timestamp: number;
}

const connectedClients = new Map<string, ConnectedClient>();
let currentClient: MqttClient | null = null;
let activeRoomCode: string | null = null;
let isHostState = false;
let isGuestState = false;
let isSyncingState = false;
let isHandlingRemoteAction = false;
let lastKnownTrack: TrackMetadata | null = null;
let lastKnownQueue: TrackMetadata[] = [];

const myClientId = `client_${Math.random().toString(36).substring(2, 9)}`;

function safeToast(message: string, icon?: any) {
  if (AppState.currentState === 'active') {
    try {
      showToast(message, icon);
    } catch {}
  }
}

type StatusListener = (syncing: boolean, host: boolean, roomCode: string | null, clientCount: number) => void;
const statusListeners: StatusListener[] = [];

function notifyStatus() {
  const count = connectedClients.size;
  statusListeners.forEach(fn => {
    try {
      fn(isSyncingState, isHostState, activeRoomCode, count);
    } catch (e) {
      console.error('[SyncService] Status listener error:', e);
    }
  });
}

export function subscribeToSyncStatus(fn: (syncing: boolean, host: boolean, peer: string | null, clientCount?: number) => void) {
  const wrapper: StatusListener = (syncing, host, roomCode, count) => {
    fn(syncing, host, roomCode, count);
  };
  statusListeners.push(wrapper);
  fn(isSyncingState, isHostState, activeRoomCode, connectedClients.size);
  return () => {
    const idx = statusListeners.indexOf(wrapper);
    if (idx !== -1) statusListeners.splice(idx, 1);
  };
}

export function isHost(): boolean {
  return isHostState && isSyncingState;
}

export function isGuest(): boolean {
  return isGuestState && isSyncingState;
}

export function isSyncActive(): boolean {
  return isSyncingState && !!activeRoomCode;
}

export function getConnectedClientCount(): number {
  return connectedClients.size;
}

export function getRoomCode(): string | null {
  return activeRoomCode;
}

export function isHandlingRemoteSync(): boolean {
  return isHandlingRemoteAction;
}

export function generatePartyCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SK-${rand}`;
}

function cleanupMqtt() {
  if (currentClient) {
    try {
      if (activeRoomCode) {
        currentClient.unsubscribe(`sukoon/party/${activeRoomCode}`);
      }
      currentClient.end(true);
    } catch {}
    currentClient = null;
  }
}

function sendSyncMessage(msg: SyncMessage) {
  if (!currentClient || !isSyncingState || !activeRoomCode) return;
  try {
    const topic = `sukoon/party/${activeRoomCode}`;
    currentClient.publish(topic, JSON.stringify(msg));
  } catch (err) {
    console.warn('[SyncService] Publish error:', err);
  }
}

function connectToMqttRoom(roomCode: string, onConnected?: () => void) {
  cleanupMqtt();

  const topic = `sukoon/party/${roomCode}`;
  currentClient = mqtt.connect(BROKER_URL, {
    clientId: myClientId,
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  currentClient.on('connect', () => {
    currentClient?.subscribe(topic, { qos: 0 }, (err) => {
      if (err) {
        console.error('[SyncService] Subscribe error:', err);
        safeToast('Failed to connect to room topic', 'alert-circle');
      } else {
        if (onConnected) onConnected();
        notifyStatus();
      }
    });
  });

  currentClient.on('message', async (_topic, payload) => {
    try {
      let msg: SyncMessage;
      try {
        msg = JSON.parse(payload.toString());
      } catch (parseErr) {
        console.warn('Sync handler error (JSON parse):', parseErr);
        return;
      }

      if (!msg || msg.senderId === myClientId) return;

      // Handle targeted messages
      if (msg.targetClientId && msg.targetClientId !== myClientId) return;

      // 1. Host-side registration & handshake
      if (isHostState) {
        if (msg.type === 'CLIENT_JOIN') {
          connectedClients.set(msg.senderId, {
            clientId: msg.senderId,
            username: msg.username || 'User',
            joinedAt: Date.now(),
          });
          const totalDevices = connectedClients.size + 1;
          safeToast(`User joined the jam (Total: ${totalDevices} devices)`, 'people');
          notifyStatus();

          let isPlaying = false;
          try {
            if (typeof (TrackPlayer as any).isPlaying === 'function') {
              isPlaying = !!(TrackPlayer as any).isPlaying();
            } else {
              const pState = (TrackPlayer as any).getPlaybackState?.();
              isPlaying = pState === 'playing' || pState?.state === 'playing';
            }
          } catch {}

          let position = 0;
          try {
            const p = await TrackPlayer.getProgress();
            position = p?.position || 0;
          } catch {}

          const currentQ = getUpNextQueue();
          sendSyncMessage({
            type: 'ROOM_SNAPSHOT',
            senderId: myClientId,
            targetClientId: msg.senderId,
            track: getCurrentTrack() || lastKnownTrack,
            position,
            isPlaying,
            queue: currentQ.length > 0 ? currentQ : lastKnownQueue,
            playlistTitle: 'Party Jam',
            timestamp: Date.now(),
          });
          return;
        }

        if (msg.type === 'CLIENT_LEAVE') {
          connectedClients.delete(msg.senderId);
          notifyStatus();
          safeToast('A participant left the jam', 'exit-outline');
          return;
        }

        if (msg.type === 'SYNC_REQUEST') {
          let isPlaying = false;
          try {
            if (typeof (TrackPlayer as any).isPlaying === 'function') {
              isPlaying = !!(TrackPlayer as any).isPlaying();
            } else {
              const pState = (TrackPlayer as any).getPlaybackState?.();
              isPlaying = pState === 'playing' || pState?.state === 'playing';
            }
          } catch {}

          const p = await TrackPlayer.getProgress();
          const currentQ = getUpNextQueue();
          sendSyncMessage({
            type: 'SYNC_STATE',
            senderId: myClientId,
            targetClientId: msg.senderId,
            track: getCurrentTrack() || lastKnownTrack,
            position: p?.position || 0,
            isPlaying,
            queue: currentQ.length > 0 ? currentQ : lastKnownQueue,
            timestamp: Date.now(),
          });
          return;
        }
      }

      // 2. Democratic collaborative jam action processing (Host AND Guests)
      isHandlingRemoteAction = true;
      try {
        switch (msg.type) {
          case 'ROOM_SNAPSHOT':
          case 'SYNC_STATE': {
            const active = getCurrentTrack();
            if (msg.track && (!active || active.id !== msg.track.id)) {
              await playTrack(msg.track, undefined, { fromQueue: true });
            }
            if (typeof msg.position === 'number') {
              const latency = (Date.now() - msg.timestamp) / 1000;
              await TrackPlayer.seekTo(Math.max(0, msg.position + latency));
            }
            if (msg.isPlaying) {
              await TrackPlayer.play();
            } else {
              await TrackPlayer.pause();
            }

            // Overwrite in-memory queue & replenish ExoPlayer buffer
            if (Array.isArray(msg.queue)) {
              await syncQueueFromHost(msg.track || null, msg.queue);
            }

            safeToast(`Synchronized with Party ${activeRoomCode}!`, 'sparkles');
            break;
          }

          case 'SYNC_PLAY': {
            if (typeof msg.position === 'number') {
              const latency = (Date.now() - msg.timestamp) / 1000;
              await TrackPlayer.seekTo(Math.max(0, msg.position + latency));
            }
            await TrackPlayer.play();
            break;
          }

          case 'SYNC_PAUSE': {
            if (typeof msg.position === 'number') {
              await TrackPlayer.seekTo(msg.position);
            }
            await TrackPlayer.pause();
            break;
          }

          case 'SYNC_SEEK': {
            if (typeof msg.position === 'number') {
              const latency = (Date.now() - msg.timestamp) / 1000;
              await TrackPlayer.seekTo(Math.max(0, msg.position + latency));
            }
            break;
          }

          case 'SYNC_TRACK_CHANGE': {
            if (isHostState) {
              lastKnownTrack = msg.track || null;
              if (Array.isArray(msg.queue)) lastKnownQueue = msg.queue;
            }
            if (msg.track) {
              safeToast(`Jam: Playing ${msg.track.title || 'Song'}`, 'musical-notes');
              await playTrack(msg.track, undefined, { fromQueue: true });
              if (typeof msg.position === 'number' && msg.position > 0) {
                const latency = (Date.now() - msg.timestamp) / 1000;
                await TrackPlayer.seekTo(Math.max(0, msg.position + latency));
              }
            }
            if (Array.isArray(msg.queue)) {
              await syncQueueFromHost(msg.track || null, msg.queue);
            }
            break;
          }

          case 'SYNC_QUEUE_UPDATE': {
            if (isHostState && Array.isArray(msg.queue)) {
              lastKnownQueue = msg.queue;
            }
            if (Array.isArray(msg.queue)) {
              await syncQueueFromHost(null, msg.queue);
            }
            break;
          }

          case 'CLIENT_LEAVE': {
            if (msg.senderId !== myClientId) {
              safeToast('A participant disconnected', 'information-circle-outline');
            }
            break;
          }
        }
      } catch (actionErr) {
        console.warn('Sync handler error (action):', actionErr);
      } finally {
        setTimeout(() => {
          isHandlingRemoteAction = false;
        }, 600);
      }
    } catch (err) {
      console.warn('Sync handler error:', err);
    }
  });

  currentClient.on('error', (err) => {
    console.warn('[SyncService] MQTT error:', err);
  });

  currentClient.on('close', () => {
    notifyStatus();
  });
}

/**
 * Host a new multi-client party sync session
 */
export async function hostSyncSession(roomCodeOrUsername?: string): Promise<string> {
  disconnectSync();

  const code = (roomCodeOrUsername && roomCodeOrUsername.toUpperCase().startsWith('SK-'))
    ? roomCodeOrUsername.toUpperCase()
    : generatePartyCode();

  activeRoomCode = code;
  isHostState = true;
  isGuestState = false;
  isSyncingState = true;
  connectedClients.clear();

  connectToMqttRoom(code, () => {
    safeToast(`Party room created: ${code}`, 'sparkles');
  });

  notifyStatus();
  return code;
}

/**
 * Join an existing party room as a sync guest
 */
export async function joinSyncSession(roomCode: string): Promise<boolean> {
  disconnectSync();

  const cleanCode = roomCode.trim().toUpperCase();
  activeRoomCode = cleanCode;
  isHostState = false;
  isGuestState = true;
  isSyncingState = true;

  connectToMqttRoom(cleanCode, () => {
    // Announce presence to Host
    sendSyncMessage({
      type: 'CLIENT_JOIN',
      senderId: myClientId,
      username: getActiveUser() || 'Sukoon Guest',
      timestamp: Date.now(),
    });
  });

  notifyStatus();
  return true;
}

/**
 * Disconnect and leave active sync session
 */
export function disconnectSync(): void {
  if (activeRoomCode && currentClient) {
    try {
      sendSyncMessage({
        type: 'CLIENT_LEAVE',
        senderId: myClientId,
        timestamp: Date.now(),
      });
    } catch {}
  }

  cleanupMqtt();
  connectedClients.clear();
  activeRoomCode = null;
  isHostState = false;
  isGuestState = false;
  isSyncingState = false;
  notifyStatus();
}

/**
 * Broadcast play event to all connected clients (Democratic)
 */
export function broadcastPlay(position?: number): void {
  if (!isSyncActive() || isHandlingRemoteAction) return;
  let pos = position;
  if (typeof pos !== 'number') {
    try {
      const p = TrackPlayer.getProgress();
      pos = p?.position || 0;
    } catch {
      pos = 0;
    }
  }
  sendSyncMessage({
    type: 'SYNC_PLAY',
    senderId: myClientId,
    position: pos,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast pause event to all connected clients (Democratic)
 */
export function broadcastPause(position?: number): void {
  if (!isSyncActive() || isHandlingRemoteAction) return;
  let pos = position;
  if (typeof pos !== 'number') {
    try {
      const p = TrackPlayer.getProgress();
      pos = p?.position || 0;
    } catch {
      pos = 0;
    }
  }
  sendSyncMessage({
    type: 'SYNC_PAUSE',
    senderId: myClientId,
    position: pos,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast seek event to all connected clients (Democratic)
 */
export function broadcastSeek(position: number): void {
  if (!isSyncActive() || isHandlingRemoteAction) return;
  sendSyncMessage({
    type: 'SYNC_SEEK',
    senderId: myClientId,
    position,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast track change + full upNextQueue to all connected clients (Democratic)
 */
export function broadcastTrackChange(track: TrackMetadata | null, queue?: TrackMetadata[]): void {
  if (!isSyncActive() || isHandlingRemoteAction) return;
  const currentQ = queue || getUpNextQueue();
  if (isHostState) {
    lastKnownTrack = track;
    lastKnownQueue = currentQ;
  }
  sendSyncMessage({
    type: 'SYNC_TRACK_CHANGE',
    senderId: myClientId,
    track,
    queue: currentQ,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast queue reorder/update to all connected clients (Democratic)
 */
export function broadcastQueueUpdate(queue: TrackMetadata[]): void {
  if (!isSyncActive() || isHandlingRemoteAction) return;
  if (isHostState) {
    lastKnownQueue = queue;
  }
  sendSyncMessage({
    type: 'SYNC_QUEUE_UPDATE',
    senderId: myClientId,
    queue,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast full sync state to all connected clients (Democratic)
 */
export function broadcastSyncState(
  track: TrackMetadata | null, 
  position: number, 
  isPlaying: boolean, 
  queue?: TrackMetadata[]
): void {
  if (!isSyncActive() || isHandlingRemoteAction) return;
  const currentQ = queue || getUpNextQueue();
  if (isHostState) {
    lastKnownTrack = track;
    lastKnownQueue = currentQ;
  }
  sendSyncMessage({
    type: 'SYNC_STATE',
    senderId: myClientId,
    track,
    position,
    isPlaying,
    queue: currentQ,
    timestamp: Date.now(),
  });
}

/**
 * Optional username direct invites (backward compatibility)
 */
export function inviteToSync(targetUsername: string) {
  const myUsername = getActiveUser();
  if (!myUsername) return;
  
  try {
    const notifyChannel = supabase.channel(`notifications_${targetUsername.toLowerCase()}`);
    notifyChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        notifyChannel.send({
          type: 'broadcast',
          event: 'SYNC_INVITE',
          payload: { hostUsername: myUsername, roomCode: activeRoomCode },
        }).then(() => {
          supabase.removeChannel(notifyChannel);
        });
      }
    });
  } catch {}
}

export function listenForSyncInvites(onInvite: (hostUsername: string) => void) {
  const myUsername = getActiveUser();
  if (!myUsername) return null;

  try {
    const notifyChannel = supabase.channel(`notifications_${myUsername.toLowerCase()}`);
    notifyChannel
      .on('broadcast', { event: 'SYNC_INVITE' }, ({ payload }) => {
        if (payload?.hostUsername) {
          onInvite(payload.hostUsername);
        }
      })
      .subscribe();

    return notifyChannel;
  } catch {
    return null;
  }
}

