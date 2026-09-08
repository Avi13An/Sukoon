import * as syncService from './syncService';
import { TrackMetadata } from '../utils/storage';

export interface PartySyncMessage {
  senderId: string;
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'TRACK_CHANGE' | 'SYNC_REQUEST' | 'SYNC_STATE' | 'USER_LEFT';
  track?: any;
  position?: number;
  isPlaying?: boolean;
  queue?: any[];
  timestamp: number;
}

export interface PartyState {
  isActive: boolean;
  roomCode: string | null;
  role: 'host' | 'guest' | null;
  connected: boolean;
  clientCount?: number;
}

export function getPartyState(): PartyState {
  const isHost = syncService.isHost();
  const isGuest = syncService.isGuest();
  const isActive = syncService.isSyncActive();

  return {
    isActive,
    roomCode: syncService.getRoomCode(),
    role: isHost ? 'host' : (isGuest ? 'guest' : null),
    connected: isActive,
    clientCount: syncService.getConnectedClientCount(),
  };
}

export function subscribeToPartyState(cb: (state: PartyState) => void) {
  return syncService.subscribeToSyncStatus((_syncing, _host, _roomCode, _count) => {
    cb(getPartyState());
  });
}

export function isPartyActive(): boolean {
  return syncService.isSyncActive();
}

export function isHandlingRemoteSync(): boolean {
  return syncService.isHandlingRemoteSync();
}

export function generatePartyCode(): string {
  return syncService.generatePartyCode();
}

export async function createPartyRoom(): Promise<string> {
  return await syncService.hostSyncSession();
}

export async function joinPartyRoom(code: string): Promise<boolean> {
  return await syncService.joinSyncSession(code);
}

export function leaveParty(): void {
  syncService.disconnectSync();
}

export function broadcastPartyAction(
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'TRACK_CHANGE',
  payload?: { track?: TrackMetadata | null; position?: number; queue?: TrackMetadata[] }
): void {
  if (!syncService.isHost() || syncService.isHandlingRemoteSync()) return;

  switch (action) {
    case 'PLAY':
      syncService.broadcastPlay(payload?.position);
      break;
    case 'PAUSE':
      syncService.broadcastPause(payload?.position);
      break;
    case 'SEEK':
      if (typeof payload?.position === 'number') {
        syncService.broadcastSeek(payload.position);
      }
      break;
    case 'TRACK_CHANGE':
      syncService.broadcastTrackChange(payload?.track || null, payload?.queue);
      break;
  }
}
