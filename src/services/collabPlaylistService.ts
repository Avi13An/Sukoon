import mqtt, { MqttClient } from 'mqtt';
import { 
  CollaborativePlaylist, 
  TrackMetadata, 
  getActiveUserSession,
  getCollaborativePlaylists, 
  saveCollaborativePlaylist, 
  updateCollaborativePlaylistTracks,
  notifyStorageChanged 
} from '../utils/storage';
import { showToast } from '../components/ToastNotification';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

let mqttClient: MqttClient | null = null;
let currentSubscribedUser: string | null = null;
const activePlaylistSubscriptions = new Set<string>();

// Listener callbacks when active PlaylistScreen is open
type CollabTracksListener = (tracks: TrackMetadata[]) => void;
const playlistListeners = new Map<string, Set<CollabTracksListener>>();

/**
 * Ensures connection to HiveMQ MQTT broker
 */
function getMqttClient(): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    if (mqttClient && mqttClient.connected) {
      resolve(mqttClient);
      return;
    }

    if (mqttClient) {
      try { mqttClient.end(true); } catch {}
      mqttClient = null;
    }

    const client = mqtt.connect(MQTT_BROKER_URL, {
      connectTimeout: 10000,
      reconnectPeriod: 3000,
      clientId: `sukoon_collab_${Math.random().toString(36).substring(2, 10)}`,
    });

    client.on('connect', () => {
      console.log('[CollabService] Connected to HiveMQ broker');
      mqttClient = client;
      resolve(client);
    });

    client.on('message', (topic, payload) => {
      handleIncomingMessage(topic, payload.toString());
    });

    client.on('error', (err) => {
      console.warn('[CollabService] MQTT error:', err);
    });

    // Resolve with client even if async connects shortly
    setTimeout(() => {
      mqttClient = client;
      resolve(client);
    }, 1500);
  });
}

/**
 * Handles incoming MQTT messages for user inbox or playlist updates
 */
function handleIncomingMessage(topic: string, rawPayload: string) {
  try {
    const data = JSON.parse(rawPayload);
    const session = getActiveUserSession();
    const myNorm = session?.username?.trim().toLowerCase() || '';

    // 1. Inbox Invitation
    if (topic.startsWith('sukoon/collab_inbox/')) {
      if (data.type === 'COLLAB_INVITE' && data.playlist) {
        const playlist: CollaborativePlaylist = data.playlist;
        const exists = getCollaborativePlaylists().some(p => p.id === playlist.id);
        if (!exists) {
          saveCollaborativePlaylist(playlist);
          subscribeToPlaylistTopic(playlist.id);
          showToast(`Invited to collaborative playlist "${playlist.title}"!`, 'sparkles');
        }
      }
      return;
    }

    // 2. Playlist Track Updates
    if (topic.startsWith('sukoon/collab_playlist/')) {
      const { playlistId, tracks, updatedBy } = data;
      if (!playlistId || !Array.isArray(tracks)) return;

      // Ignore self-broadcasts
      if (updatedBy && updatedBy.trim().toLowerCase() === myNorm) {
        return;
      }

      console.log(`[CollabService] Received tracks update for playlist: ${playlistId} from ${updatedBy}`);
      updateCollaborativePlaylistTracks(playlistId, tracks);

      // Notify any currently mounted PlaylistScreen listening to this playlist
      const listeners = playlistListeners.get(playlistId);
      if (listeners && listeners.size > 0) {
        listeners.forEach(cb => {
          try { cb(tracks); } catch (e) { console.warn(e); }
        });
      }

      showToast('Collaborative playlist updated', 'musical-notes');
    }
  } catch (err) {
    console.warn('[CollabService] Error parsing incoming message:', err);
  }
}

/**
 * Subscribes to a specific collaborative playlist topic
 */
export async function subscribeToPlaylistTopic(playlistId: string): Promise<void> {
  if (activePlaylistSubscriptions.has(playlistId)) return;
  try {
    const client = await getMqttClient();
    const topic = `sukoon/collab_playlist/${playlistId}`;
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (!err) {
        activePlaylistSubscriptions.add(playlistId);
        console.log('[CollabService] Subscribed to playlist topic:', topic);
      }
    });
  } catch (err) {
    console.warn('[CollabService] subscribeToPlaylistTopic error:', err);
  }
}

/**
 * Initializes the user's inbox listener and subscribes to all owned/shared playlists
 */
export async function initCollabInboxListener(username?: string): Promise<void> {
  const session = getActiveUserSession();
  const rawUser = username || session?.username;
  if (!rawUser) return;
  const normUser = rawUser.trim().toLowerCase();

  if (currentSubscribedUser === normUser && mqttClient?.connected) {
    return;
  }

  currentSubscribedUser = normUser;
  const client = await getMqttClient();

  // 1. Subscribe to personal inbox
  const inboxTopic = `sukoon/collab_inbox/${normUser}`;
  client.subscribe(inboxTopic, { qos: 1 }, (err) => {
    if (!err) {
      console.log('[CollabService] Subscribed to inbox topic:', inboxTopic);
    }
  });

  // 2. Subscribe to all saved collaborative playlists
  const playlists = getCollaborativePlaylists(normUser);
  playlists.forEach(pl => {
    subscribeToPlaylistTopic(pl.id);
  });
}

/**
 * Creates a 2-user collaborative playlist and invites the collaborator in real time
 */
export async function createCollaborativePlaylist(
  title: string,
  collaboratorUsername: string
): Promise<CollaborativePlaylist> {
  const session = getActiveUserSession();
  const myUsername = session?.username || 'User';
  const myNorm = myUsername.trim().toLowerCase();
  const peerNorm = collaboratorUsername.trim().toLowerCase();

  if (!collaboratorUsername.trim()) {
    throw new Error('Please enter your friend’s username');
  }

  if (myNorm === peerNorm) {
    throw new Error('You cannot collaborate with yourself');
  }

  const playlistId = `collab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newPlaylist: CollaborativePlaylist = {
    id: playlistId,
    title: title.trim() || 'Collaborative Playlist',
    collaborators: [myUsername.trim(), collaboratorUsername.trim()],
    createdBy: myUsername.trim(),
    tracks: [],
    updatedAt: Date.now(),
    version: 1,
  };

  // 1. Save locally
  saveCollaborativePlaylist(newPlaylist);

  // 2. Connect and publish invite to collaborator inbox
  try {
    const client = await getMqttClient();
    const inviteTopic = `sukoon/collab_inbox/${peerNorm}`;
    const payload = JSON.stringify({
      type: 'COLLAB_INVITE',
      playlist: newPlaylist,
      sender: myUsername,
      timestamp: Date.now(),
    });

    client.publish(inviteTopic, payload, { retain: true, qos: 1 }, (err) => {
      if (err) {
        console.warn('[CollabService] Invite publish error:', err);
      } else {
        console.log(`[CollabService] Published invite to ${inviteTopic}`);
      }
    });

    // 3. Subscribe to the playlist topic for live changes
    subscribeToPlaylistTopic(playlistId);
  } catch (err) {
    console.warn('[CollabService] createCollaborativePlaylist network error:', err);
  }

  showToast(`Created shared playlist with @${collaboratorUsername}`, 'sparkles');
  return newPlaylist;
}

/**
 * Broadcasts an updated track list to the peer collaborator
 */
export async function syncCollabTracks(
  playlistId: string, 
  newTracks: TrackMetadata[]
): Promise<void> {
  const session = getActiveUserSession();
  const myNorm = session?.username?.trim().toLowerCase() || 'user';

  // 1. Update local storage
  updateCollaborativePlaylistTracks(playlistId, newTracks);

  // 2. Broadcast to MQTT topic
  try {
    const client = await getMqttClient();
    const topic = `sukoon/collab_playlist/${playlistId}`;
    const payload = JSON.stringify({
      playlistId,
      tracks: newTracks,
      updatedBy: myNorm,
      updatedAt: Date.now(),
    });

    client.publish(topic, payload, { retain: true, qos: 1 }, (err) => {
      if (err) {
        console.warn('[CollabService] Sync broadcast error:', err);
      } else {
        console.log(`[CollabService] Synced ${newTracks.length} tracks to ${topic}`);
      }
    });
  } catch (err) {
    console.warn('[CollabService] syncCollabTracks error:', err);
  }
}

/**
 * Registers a live track updates callback for an active PlaylistScreen
 */
export function subscribeToCollabPlaylist(
  playlistId: string, 
  callback: (tracks: TrackMetadata[]) => void
): () => void {
  if (!playlistListeners.has(playlistId)) {
    playlistListeners.set(playlistId, new Set());
  }
  playlistListeners.get(playlistId)!.add(callback);
  subscribeToPlaylistTopic(playlistId);

  return () => {
    const set = playlistListeners.get(playlistId);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        playlistListeners.delete(playlistId);
      }
    }
  };
}
