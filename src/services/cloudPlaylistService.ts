import mqtt from 'mqtt';
import { 
  Playlist, 
  getActiveUser, 
  getActiveUserSession, 
  getUserPlaylists, 
  saveUserPlaylists, 
  notifyStorageChanged,
  storage,
  TrackMetadata
} from '../utils/storage';
import { supabase } from './supabase';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const LOCAL_SHARED_KEY = '@sukoon_shared_playlists';

export interface SharedPlaylistPayload {
  code: string;
  title: string;
  description: string;
  tracks: TrackMetadata[];
  author: string;
  sharedAt: number;
}

function generateRandomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rand;
}

function getLocalSharedPlaylists(): Record<string, SharedPlaylistPayload> {
  try {
    const raw = storage.getString(LOCAL_SHARED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalSharedPlaylist(payload: SharedPlaylistPayload) {
  try {
    const map = getLocalSharedPlaylists();
    map[payload.code.toUpperCase()] = payload;
    storage.set(LOCAL_SHARED_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('[cloudPlaylistService] Error saving local shared copy:', err);
  }
}

/**
 * Pushes the shared playlist payload to HiveMQ retained MQTT topic
 */
async function pushToMqttCloud(payload: SharedPlaylistPayload): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const client = mqtt.connect(MQTT_BROKER_URL, {
        connectTimeout: 5000,
        reconnectPeriod: 0,
      });

      const timeout = setTimeout(() => {
        try { client.end(true); } catch {}
        resolve(false);
      }, 5000);

      client.on('connect', () => {
        const topic = `sukoon/shared_playlists/${payload.code.toUpperCase()}`;
        client.publish(topic, JSON.stringify(payload), { retain: true, qos: 1 }, (err) => {
          clearTimeout(timeout);
          try { client.end(true); } catch {}
          if (err) {
            console.warn('[cloudPlaylistService] MQTT publish error:', err);
            resolve(false);
          } else {
            console.log('[cloudPlaylistService] MQTT published retained playlist to:', topic);
            resolve(true);
          }
        });
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        try { client.end(true); } catch {}
        console.warn('[cloudPlaylistService] MQTT connection error:', err);
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Fetches a retained playlist from HiveMQ MQTT topic by code
 */
async function fetchFromMqttCloud(code: string): Promise<SharedPlaylistPayload | null> {
  return new Promise((resolve) => {
    try {
      const client = mqtt.connect(MQTT_BROKER_URL, {
        connectTimeout: 5000,
        reconnectPeriod: 0,
      });

      const topic = `sukoon/shared_playlists/${code.toUpperCase()}`;

      const timeout = setTimeout(() => {
        try { client.end(true); } catch {}
        resolve(null);
      }, 4500);

      client.on('connect', () => {
        client.subscribe(topic, { qos: 1 }, (err) => {
          if (err) {
            clearTimeout(timeout);
            try { client.end(true); } catch {}
            resolve(null);
          }
        });
      });

      client.on('message', (t, message) => {
        if (t === topic) {
          clearTimeout(timeout);
          try {
            const data = JSON.parse(message.toString());
            try { client.end(true); } catch {}
            resolve(data);
          } catch {
            try { client.end(true); } catch {}
            resolve(null);
          }
        }
      });

      client.on('error', () => {
        clearTimeout(timeout);
        try { client.end(true); } catch {}
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Push to Supabase if configured
 */
async function pushToSupabase(payload: SharedPlaylistPayload): Promise<void> {
  try {
    await supabase.from('shared_playlists').upsert([
      {
        share_code: payload.code.toUpperCase(),
        title: payload.title,
        description: payload.description,
        tracks: payload.tracks,
        author: payload.author,
        shared_at: payload.sharedAt,
        playlist_data: payload,
      }
    ]);
  } catch {}
}

/**
 * Fetch from Supabase if configured
 */
async function fetchFromSupabase(code: string): Promise<SharedPlaylistPayload | null> {
  try {
    const { data } = await supabase
      .from('shared_playlists')
      .select('*')
      .eq('share_code', code.toUpperCase())
      .limit(1);

    if (data && data.length > 0) {
      const item = data[0];
      return item.playlist_data || {
        code: item.share_code,
        title: item.title,
        description: item.description,
        tracks: item.tracks || [],
        author: item.author || 'Sukoon User',
        sharedAt: item.shared_at || Date.now(),
      };
    }
  } catch {}
  return null;
}

/**
 * Shares a playlist by generating a clean 6-character code (SK-PL-XXXXXX),
 * saving locally and publishing to public cloud endpoints.
 */
export async function sharePlaylist(playlist: Playlist): Promise<string> {
  const shareCode = `SK-PL-${generateRandomCode()}`;
  playlist.shareCode = shareCode;

  const sharedPayload: SharedPlaylistPayload = {
    code: shareCode,
    title: playlist.name || (playlist as any).title || 'Shared Playlist',
    description: playlist.description || '',
    tracks: playlist.tracks || [],
    author: getActiveUser() || 'Sukoon User',
    sharedAt: Date.now(),
  };

  // 1. Save local copy for offline and instant on-device reference
  saveLocalSharedPlaylist(sharedPayload);

  // 2. Broadcast to cloud simultaneously
  await Promise.allSettled([
    pushToMqttCloud(sharedPayload),
    pushToSupabase(sharedPayload),
  ]);

  return shareCode;
}

/**
 * Fetches a shared playlist payload by code from local MMKV or remote cloud
 */
export async function fetchSharedPlaylistFromCloud(code: string): Promise<Playlist | null> {
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) return null;

  // 1. Check local MMKV cache first
  const localMap = getLocalSharedPlaylists();
  let payload: SharedPlaylistPayload | null = localMap[cleanCode] || null;

  // 2. Fetch from cloud if not cached
  if (!payload) {
    payload = await fetchFromMqttCloud(cleanCode);
  }

  // 3. Fallback to Supabase
  if (!payload) {
    payload = await fetchFromSupabase(cleanCode);
  }

  if (!payload) return null;

  // Cache locally
  saveLocalSharedPlaylist(payload);

  const playlist: Playlist = {
    id: `preview_${cleanCode}`,
    shareCode: cleanCode,
    name: payload.title || 'Shared Playlist',
    description: payload.description ? `${payload.description} • Shared by ${payload.author}` : `Shared by ${payload.author}`,
    createdAt: payload.sharedAt || Date.now(),
    isImported: true,
    tracks: payload.tracks ? payload.tracks.map(t => ({ ...t })) : [],
  };

  return playlist;
}

/**
 * Imports a shared playlist by its code:
 * - Fetches from cloud
 * - Saves to importing user's scoped playlists
 * - Assigns unique local ID (imported_${Date.now()})
 * - Triggers notifyStorageChanged()
 */
export async function importPlaylistByCode(code: string): Promise<Playlist> {
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) {
    throw new Error('Please enter a valid playlist share code.');
  }

  const preview = await fetchSharedPlaylistFromCloud(cleanCode);
  if (!preview) {
    throw new Error('Playlist code not found. Please check the code.');
  }

  const activeUser = getActiveUserSession();
  const userId = activeUser?.id;
  const userPlaylists = getUserPlaylists(userId);

  // Check if already imported
  const existing = userPlaylists.find(p => p.shareCode?.toUpperCase() === cleanCode);
  if (existing) {
    return existing;
  }

  const importedPlaylist: Playlist = {
    id: `imported_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    shareCode: cleanCode,
    name: preview.name,
    description: preview.description,
    createdAt: Date.now(),
    coverImage: preview.coverImage || (preview.tracks[0]?.artwork),
    isImported: true,
    tracks: preview.tracks.map(t => ({ ...t })),
  };

  userPlaylists.push(importedPlaylist);
  saveUserPlaylists(userPlaylists, userId);
  notifyStorageChanged();

  return importedPlaylist;
}

/**
 * Backward compatibility: listen for legacy direct playlist shares via Supabase
 */
export function subscribeToSharedPlaylists(onNewPlaylist?: (playlist: Playlist) => void) {
  const myUsername = getActiveUser();
  if (!myUsername) return null;

  try {
    const subscription = supabase
      .channel('public:shared_playlists')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'shared_playlists',
          filter: `shared_username=eq.${myUsername.toLowerCase()}`,
        },
        (payload) => {
          const incomingPlaylist = payload?.new?.playlist_data as Playlist;
          if (incomingPlaylist) {
            incomingPlaylist.name = `${incomingPlaylist.name} (Shared by ${payload.new?.shared_by || 'Friend'})`;
            const activeUser = getActiveUserSession();
            const userId = activeUser?.id;
            const userPlaylists = getUserPlaylists(userId);
            incomingPlaylist.id = `shared_${Date.now()}`;
            userPlaylists.push(incomingPlaylist);
            saveUserPlaylists(userPlaylists, userId);
            notifyStorageChanged();
            if (onNewPlaylist) {
              onNewPlaylist(incomingPlaylist);
            }
          }
        }
      )
      .subscribe();

    return subscription;
  } catch {
    return null;
  }
}
