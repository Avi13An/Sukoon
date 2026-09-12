import mqtt, { MqttClient } from 'mqtt';
import { 
  CollaborativePlaylist, 
  TrackMetadata, 
  getActiveUserSession,
  getCollaborativePlaylists, 
  saveCollaborativePlaylist, 
  updateCollaborativePlaylistTracks,
  notifyStorageChanged,
  isPlaylistLeftOrUnlinked,
} from '../utils/storage';
import { showToast } from '../components/ToastNotification';

const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

let mqttClient: MqttClient | null = null;
let currentSubscribedUser: string | null = null;
const activePlaylistSubscriptions = new Set<string>();

// Listener callbacks when active PlaylistScreen is open
type CollabTracksListener = (tracks: TrackMetadata[]) => void;
type CollabTitleListener = (newTitle: string) => void;
const playlistListeners = new Map<string, Set<CollabTracksListener>>();
const playlistTitleListeners = new Map<string, Set<CollabTitleListener>>();

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
        // Never accept invites for playlists the user permanently left
        if (isPlaylistLeftOrUnlinked(playlist.id)) {
          console.log('[CollabService] Ignoring invite for left playlist:', playlist.id);
          return;
        }
        const exists = getCollaborativePlaylists().some(p => p.id === playlist.id);
        if (!exists) {
          saveCollaborativePlaylist(playlist);
          subscribeToPlaylistTopic(playlist.id);
          showToast(`Invited to collaborative playlist "${playlist.title}"!`, 'sparkles');
        }
      }
      return;
    }

    // 2. Playlist Topic Updates
    if (topic.startsWith('sukoon/collab_playlist/')) {
      const { playlistId, tracks, updatedBy, type } = data;
      if (!playlistId) return;

      // Never process updates for playlists this user left
      if (isPlaylistLeftOrUnlinked(playlistId)) {
        return;
      }

      // 2a. Live Rename Broadcast
      if (type === 'COLLAB_RENAME' && data.newTitle) {
        if (data.renamedBy && data.renamedBy.trim().toLowerCase() === myNorm) {
          return;
        }
        const existing = getCollaborativePlaylists().find(p => p.id === playlistId);
        if (existing) {
          existing.title = data.newTitle;
          existing.updatedAt = Date.now();
          saveCollaborativePlaylist(existing);
          const listeners = playlistTitleListeners.get(playlistId);
          if (listeners) {
            listeners.forEach(cb => { try { cb(data.newTitle); } catch {} });
          }
          showToast(`Playlist renamed to "${data.newTitle}" by @${data.renamedBy || 'collaborator'}`, 'sparkles');
        }
        return;
      }

      // 2b. Collaborator Left Broadcast
      if (type === 'COLLAB_MEMBER_LEFT' && data.username) {
        const departingUser = data.username.trim();
        if (departingUser.toLowerCase() === myNorm) {
          return;
        }
        const existing = getCollaborativePlaylists().find(p => p.id === playlistId);
        if (existing && existing.collaborators) {
          existing.collaborators = existing.collaborators.filter(c => c.toLowerCase() !== departingUser.toLowerCase());
          existing.updatedAt = Date.now();
          saveCollaborativePlaylist(existing);
          showToast(`@${departingUser} left the playlist`, 'exit-outline');
        }
        return;
      }

      // 2c. Playlist Tracks Update
      if (!Array.isArray(tracks)) return;

      // Ignore self-broadcasts
      if (updatedBy && updatedBy.trim().toLowerCase() === myNorm) {
        return;
      }

      console.log(`[CollabService] Received tracks update for playlist: ${playlistId} from ${updatedBy}`);

      const existingPlaylist = getCollaborativePlaylists().find(p => p.id === playlistId);
      const existingTrackIds = new Set((existingPlaylist?.tracks || []).map(t => t.id));
      const addedTracks = tracks.filter(t => !existingTrackIds.has(t.id));

      updateCollaborativePlaylistTracks(playlistId, tracks);

      // Notify any currently mounted PlaylistScreen listening to this playlist
      const listeners = playlistListeners.get(playlistId);
      if (listeners && listeners.size > 0) {
        listeners.forEach(cb => {
          try { cb(tracks); } catch (e) { console.warn(e); }
        });
      }

      // Only alert if an external collaborator actually added new track(s).
      if (existingPlaylist && addedTracks.length > 0 && updatedBy && updatedBy.trim().toLowerCase() !== myNorm) {
        const addedDesc = addedTracks.length === 1 
          ? `"${addedTracks[0].title}"` 
          : `${addedTracks.length} tracks`;
        showToast(`${updatedBy} added ${addedDesc} to "${existingPlaylist.title}"`, 'musical-notes');
      }
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
 * Registers a live track & title updates callback for an active PlaylistScreen
 */
export function subscribeToCollabPlaylist(
  playlistId: string, 
  callback: (tracks: TrackMetadata[]) => void,
  titleCallback?: (newTitle: string) => void
): () => void {
  if (!playlistListeners.has(playlistId)) {
    playlistListeners.set(playlistId, new Set());
  }
  playlistListeners.get(playlistId)!.add(callback);

  if (titleCallback) {
    if (!playlistTitleListeners.has(playlistId)) {
      playlistTitleListeners.set(playlistId, new Set());
    }
    playlistTitleListeners.get(playlistId)!.add(titleCallback);
  }

  subscribeToPlaylistTopic(playlistId);

  return () => {
    const set = playlistListeners.get(playlistId);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        playlistListeners.delete(playlistId);
      }
    }
    if (titleCallback) {
      const titleSet = playlistTitleListeners.get(playlistId);
      if (titleSet) {
        titleSet.delete(titleCallback);
        if (titleSet.size === 0) {
          playlistTitleListeners.delete(playlistId);
        }
      }
    }
  };
}

/**
 * Adds a track to a collaborative playlist, persists locally, and syncs via MQTT
 */
export async function addTrackToCollaborativePlaylist(
  playlistId: string,
  track: TrackMetadata
): Promise<boolean> {
  try {
    const playlists = getCollaborativePlaylists();
    const target = playlists.find(p => p.id === playlistId);
    if (!target) return false;

    const exists = (target.tracks || []).some(t => t.id === track.id);
    if (exists) return false;

    const updatedTracks = [track, ...(target.tracks || [])];
    await syncCollabTracks(playlistId, updatedTracks);
    return true;
  } catch (err) {
    console.warn('[CollabService] addTrackToCollaborativePlaylist error:', err);
    return false;
  }
}

/**
 * Broadcasts a member leaving event to the collaborator without deleting the root playlist
 */
export async function leaveCollaborativePlaylistCloud(
  playlistId: string, 
  username: string
): Promise<void> {
  try {
    const client = await getMqttClient();
    const topic = `sukoon/collab_playlist/${playlistId}`;
    const payload = JSON.stringify({
      type: 'COLLAB_MEMBER_LEFT',
      playlistId,
      username,
      timestamp: Date.now(),
    });

    client.publish(topic, payload, { retain: true, qos: 1 }, (err) => {
      if (err) {
        console.warn('[CollabService] Member left broadcast error:', err);
      } else {
        console.log(`[CollabService] Broadcasted member ${username} left on ${topic}`);
      }
    });
  } catch (err) {
    console.warn('[CollabService] leaveCollaborativePlaylistCloud error:', err);
  }
}

/**
 * Broadcasts a playlist title rename to the peer collaborator
 */
export async function renameCollaborativePlaylistCloud(
  playlistId: string, 
  newTitle: string
): Promise<void> {
  const session = getActiveUserSession();
  const myNorm = session?.username?.trim().toLowerCase() || 'user';
  try {
    const client = await getMqttClient();
    const topic = `sukoon/collab_playlist/${playlistId}`;
    const payload = JSON.stringify({
      type: 'COLLAB_RENAME',
      playlistId,
      newTitle,
      renamedBy: myNorm,
      timestamp: Date.now(),
    });

    client.publish(topic, payload, { retain: true, qos: 1 }, (err) => {
      if (err) {
        console.warn('[CollabService] Rename broadcast error:', err);
      } else {
        console.log(`[CollabService] Broadcasted rename "${newTitle}" on ${topic}`);
      }
    });
  } catch (err) {
    console.warn('[CollabService] renameCollaborativePlaylistCloud error:', err);
  }
}

