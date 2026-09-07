import mqtt, { MqttClient } from 'mqtt';
import TrackPlayer from '@rntp/player';
import { playTrack } from './TrackPlayerService';
import { showToast } from '../components/ToastNotification';

export interface PartySyncMessage {
  senderId: string;
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'TRACK_CHANGE' | 'SYNC_REQUEST' | 'SYNC_STATE' | 'USER_LEFT';
  track?: any;
  position?: number;
  isPlaying?: boolean;
  timestamp: number;
}

export interface PartyState {
  isActive: boolean;
  roomCode: string | null;
  role: 'host' | 'guest' | null;
  connected: boolean;
}

const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const CLIENT_ID_PREFIX = 'sukoon_client_';

let client: MqttClient | null = null;
let activeRoomCode: string | null = null;
let currentRole: 'host' | 'guest' | null = null;
let isConnected = false;
let isHandlingRemoteAction = false;
const myClientId = `${CLIENT_ID_PREFIX}${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

const listeners: Array<(state: PartyState) => void> = [];

export function getPartyState(): PartyState {
  return {
    isActive: !!activeRoomCode && isConnected,
    roomCode: activeRoomCode,
    role: currentRole,
    connected: isConnected,
  };
}

export function subscribeToPartyState(cb: (state: PartyState) => void) {
  listeners.push(cb);
  cb(getPartyState());
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function notifyListeners() {
  const state = getPartyState();
  listeners.forEach(fn => {
    try {
      fn(state);
    } catch (e) {
      console.error('[PartyService] Listener error:', e);
    }
  });
}

export function isPartyActive(): boolean {
  return !!activeRoomCode && isConnected;
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

function cleanupClient() {
  if (client) {
    try {
      if (activeRoomCode) {
        client.unsubscribe(`sukoon/party/${activeRoomCode}`);
      }
      client.end(true);
    } catch {}
    client = null;
  }
  isConnected = false;
}

function connectToBroker(roomCode: string, onConnectCallback?: () => void) {
  cleanupClient();

  const topic = `sukoon/party/${roomCode}`;
  client = mqtt.connect(BROKER_URL, {
    clientId: myClientId,
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    isConnected = true;
    client?.subscribe(topic, { qos: 0 }, (err) => {
      if (err) {
        console.error('[PartyService] Subscribe error:', err);
        showToast('Failed to join room topic', 'alert-circle');
      } else {
        notifyListeners();
        if (onConnectCallback) onConnectCallback();
      }
    });
    notifyListeners();
  });

  client.on('message', async (_topic, payload) => {
    try {
      const msg: PartySyncMessage = JSON.parse(payload.toString());
      if (!msg || msg.senderId === myClientId) {
        return; // Ignore our own broadcasted actions
      }

      isHandlingRemoteAction = true;
      try {
        switch (msg.action) {
          case 'TRACK_CHANGE':
            if (msg.track) {
              showToast(`Party: Track changed to ${msg.track.title || 'Song'}`, 'musical-notes');
              await playTrack(msg.track);
              if (typeof msg.position === 'number' && msg.position > 0) {
                const latencySec = (Date.now() - msg.timestamp) / 1000;
                await TrackPlayer.seekTo(Math.max(0, msg.position + latencySec));
              }
            }
            break;

          case 'PLAY':
            await TrackPlayer.play();
            break;

          case 'PAUSE':
            await TrackPlayer.pause();
            break;

          case 'SEEK':
            if (typeof msg.position === 'number') {
              const latencySec = (Date.now() - msg.timestamp) / 1000;
              const target = Math.max(0, msg.position + latencySec);
              await TrackPlayer.seekTo(target);
            }
            break;

          case 'SYNC_REQUEST':
            if (currentRole === 'host') {
              const activeItem = TrackPlayer.getActiveMediaItem();
              const progress = await TrackPlayer.getProgress();
              let isPlaying = false;
              if (typeof (TrackPlayer as any).isPlaying === 'function') {
                isPlaying = !!(TrackPlayer as any).isPlaying();
              } else {
                const pState = (TrackPlayer as any).getPlaybackState?.();
                isPlaying = pState === 'playing' || pState?.state === 'playing';
              }
              
              sendPayload({
                senderId: myClientId,
                action: 'SYNC_STATE',
                track: activeItem,
                position: progress?.position || 0,
                isPlaying,
                timestamp: Date.now(),
              });
            }
            break;

          case 'SYNC_STATE':
            if (currentRole === 'guest') {
              if (msg.track) {
                await playTrack(msg.track);
              }
              if (typeof msg.position === 'number') {
                const latencySec = (Date.now() - msg.timestamp) / 1000;
                const target = Math.max(0, msg.position + latencySec);
                await TrackPlayer.seekTo(target);
              }
              if (msg.isPlaying) {
                await TrackPlayer.play();
              } else {
                await TrackPlayer.pause();
              }
              showToast(`Synchronized with Party ${activeRoomCode}!`, 'sparkles');
            }
            break;

          case 'USER_LEFT':
            showToast('Party friend disconnected', 'information-circle-outline');
            break;
        }
      } finally {
        setTimeout(() => {
          isHandlingRemoteAction = false;
        }, 500);
      }
    } catch (e) {
      console.error('[PartyService] Message parse error:', e);
    }
  });

  client.on('error', (err) => {
    console.error('[PartyService] MQTT Error:', err);
    isConnected = false;
    notifyListeners();
  });

  client.on('offline', () => {
    isConnected = false;
    notifyListeners();
  });

  client.on('close', () => {
    isConnected = false;
    notifyListeners();
  });
}

function sendPayload(msg: PartySyncMessage) {
  if (!client || !isConnected || !activeRoomCode) return;
  try {
    const topic = `sukoon/party/${activeRoomCode}`;
    client.publish(topic, JSON.stringify(msg));
  } catch (err) {
    console.error('[PartyService] Publish error:', err);
  }
}

export async function createPartyRoom(): Promise<string> {
  const code = generatePartyCode();
  activeRoomCode = code;
  currentRole = 'host';
  notifyListeners();

  connectToBroker(code, () => {
    showToast(`Party created! Room: ${code}`, 'sparkles');
  });

  return code;
}

export async function joinPartyRoom(code: string): Promise<boolean> {
  const clean = code.trim().toUpperCase();
  if (clean.length < 5) {
    showToast('Invalid room code format', 'alert-circle');
    return false;
  }

  activeRoomCode = clean;
  currentRole = 'guest';
  notifyListeners();

  connectToBroker(clean, () => {
    // Send sync request to host upon joining
    sendPayload({
      senderId: myClientId,
      action: 'SYNC_REQUEST',
      timestamp: Date.now(),
    });
    showToast(`Joined Party Room ${clean}!`, 'sparkles');
  });

  return true;
}

export function leaveParty() {
  if (isPartyActive()) {
    sendPayload({
      senderId: myClientId,
      action: 'USER_LEFT',
      timestamp: Date.now(),
    });
  }

  cleanupClient();
  activeRoomCode = null;
  currentRole = null;
  notifyListeners();
  showToast('Disconnected from Party', 'log-out-outline');
}

export function broadcastPartyAction(
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'TRACK_CHANGE', 
  payload?: { track?: any; position?: number }
) {
  if (!isPartyActive() || isHandlingRemoteAction) return;

  sendPayload({
    senderId: myClientId,
    action,
    track: payload?.track,
    position: payload?.position,
    timestamp: Date.now(),
  });
}
