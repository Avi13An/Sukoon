import { createMMKV } from 'react-native-mmkv';

export const storage = createMMKV();

export interface TrackMetadata {
  id: string;
  url?: string;
  title: string;
  artist: string;
  artwork?: string;
  duration?: number;
}

export interface OfflineTrack extends TrackMetadata {
  localUri: string;
}

export interface DownloadedTrack extends TrackMetadata {
  localUri: string;
  downloadedAt: number;
  sizeBytes?: number;
}

export interface Playlist {
  id: string;
  shareCode: string; // e.g. "SK-8F3K9A"
  name: string;
  description?: string;
  createdAt: number;
  coverImage?: string;
  isImported?: boolean; // If true, recipient cannot edit/delete tracks
  isProtected?: boolean; // If true, playlist cannot be deleted (e.g., Liked Songs)
  tracks: TrackMetadata[];
}

export interface CollaborativePlaylist {
  id: string; // e.g. "collab_pl_" + timestamp + random
  title: string;
  collaborators: string[]; // [ownerNormalizedUsername, peerNormalizedUsername]
  createdBy: string;
  tracks: TrackMetadata[];
  updatedAt: number;
  version: number;
}

export interface StoredUserAccount {
  id: string;
  username: string; // Display username
  normalizedUsername: string; // trimmed and lowercase for lookups
  passwordHash: string; // Or stored password string for offline local auth
  createdAt: number;
}

export type UserAccount = StoredUserAccount;

export interface ActiveSession {
  id: string;
  username: string;
}

export interface StudioRecording {
  id: string;
  songTitle: string;
  artist: string;
  localUri: string;
  createdAt: number;
  durationSeconds: number;
  fileSizeBytes?: number;
  artwork?: string;
  isMasterMixed?: boolean;
}

const KEYS = {
  ACTIVE_SESSION: '@sukoon_active_session',
  USERS_REGISTRY: '@sukoon_users_registry',
  LEGACY_USERS_DB: '@sukoon_users_db',
  PLAYLISTS: 'PLAYLISTS',
  LEGACY_USER_PLAYLISTS: '@sukoon_user_playlists',
  CUSTOM_PLAYLISTS: '@sukoon_custom_playlists',
  OFFLINE_TRACKS: 'OFFLINE_TRACKS',
  DOWNLOADED_TRACKS: '@sukoon_downloaded_tracks',
  STUDIO_RECORDINGS: '@sukoon_studio_recordings',
  LAST_PLAYED: 'LAST_PLAYED',
  MY_USERNAME: 'MY_USERNAME',
  RECENT_SEARCHES: '@sukoon_recent_searches',
  LISTEN_HISTORY: '@sukoon_listen_history',
};

// Event subscription for playlist & user data changes
type StorageListener = () => void;
const storageListeners: StorageListener[] = [];

export function onPlaylistsChanged(listener: StorageListener): () => void {
  storageListeners.push(listener);
  return () => {
    const idx = storageListeners.indexOf(listener);
    if (idx !== -1) storageListeners.splice(idx, 1);
  };
}

export function notifyStorageChanged(): void {
  storageListeners.forEach(listener => {
    try {
      listener();
    } catch (err) {
      console.error('[Storage] listener error:', err);
    }
  });
}

// Multi-User Registry & Session Management
export function getUsersRegistry(): Record<string, StoredUserAccount> {
  const data = storage.getString(KEYS.USERS_REGISTRY);
  if (data) {
    try {
      return JSON.parse(data);
    } catch {}
  }

  // Fallback migration: Check legacy USERS_DB
  const legacyData = storage.getString(KEYS.LEGACY_USERS_DB);
  if (legacyData) {
    try {
      const legacyDb: Record<string, any> = JSON.parse(legacyData);
      const migrated: Record<string, StoredUserAccount> = {};
      for (const [key, val] of Object.entries(legacyDb)) {
        const rawName = val.username || key;
        const norm = rawName.trim().toLowerCase();
        migrated[norm] = {
          id: val.id || `user_${norm}`,
          username: rawName.trim(),
          normalizedUsername: norm,
          passwordHash: val.passwordHash || '',
          createdAt: val.createdAt || Date.now(),
        };
      }
      if (Object.keys(migrated).length > 0) {
        storage.set(KEYS.USERS_REGISTRY, JSON.stringify(migrated));
        return migrated;
      }
    } catch {}
  }
  return {};
}

export const getUsersDb = getUsersRegistry;

export function getActiveUserSession(): ActiveSession | null {
  const rawSession = storage.getString(KEYS.ACTIVE_SESSION);
  if (rawSession) {
    try {
      const parsed = JSON.parse(rawSession);
      if (parsed && typeof parsed === 'object' && parsed.id && parsed.username) {
        return {
          id: String(parsed.id),
          username: String(parsed.username),
        };
      }
    } catch {
      // Legacy string format fallback
      const norm = rawSession.trim().toLowerCase();
      const registry = getUsersRegistry();
      const user = registry[norm];
      if (user) {
        return { id: user.id, username: user.username };
      }
      return { id: `user_${norm}`, username: rawSession.trim() };
    }
  }

  const legacyUsername = storage.getString(KEYS.MY_USERNAME);
  if (legacyUsername) {
    const norm = legacyUsername.trim().toLowerCase();
    const registry = getUsersRegistry();
    const user = registry[norm];
    if (user) {
      return { id: user.id, username: user.username };
    }
    return { id: `user_${norm}`, username: legacyUsername.trim() };
  }

  return null;
}

export function setActiveSession(session: ActiveSession): void {
  storage.set(KEYS.ACTIVE_SESSION, JSON.stringify({
    id: session.id,
    username: session.username.trim(),
  }));
  storage.set(KEYS.MY_USERNAME, session.username.trim());
  notifyStorageChanged();
}

export function getActiveUser(): string | null {
  const session = getActiveUserSession();
  return session ? session.username : null;
}

export function setActiveUser(usernameOrSession: string | ActiveSession): void {
  if (typeof usernameOrSession === 'object' && usernameOrSession !== null) {
    setActiveSession(usernameOrSession);
    return;
  }
  const cleanUsername = String(usernameOrSession).trim();
  const normUsername = cleanUsername.toLowerCase();
  const registry = getUsersRegistry();
  const existing = registry[normUsername];
  if (existing) {
    setActiveSession({ id: existing.id, username: existing.username });
  } else {
    setActiveSession({ id: `user_${normUsername}`, username: cleanUsername });
  }
}

export function clearActiveSession(): void {
  storage.remove(KEYS.ACTIVE_SESSION);
  storage.remove(KEYS.MY_USERNAME);
  notifyStorageChanged();
}

export function hydrateUserData(user: StoredUserAccount): void {
  // 1. Ensure user-scoped playlists are loaded and legacy playlists migrated
  const playlists = getUserPlaylists(user.id);

  // If user has no playlists, create an initial "Liked Songs" playlist
  const hasLikedSongs = playlists.some(
    p => p.id === `liked_${user.id}` || p.name.trim().toLowerCase() === 'liked songs'
  );
  if (!hasLikedSongs) {
    const likedPlaylist: Playlist = {
      id: `liked_${user.id}`,
      shareCode: 'SK-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      name: 'Liked Songs',
      description: 'Your favorite tracks',
      createdAt: Date.now(),
      isImported: false,
      tracks: [],
    };
    playlists.unshift(likedPlaylist);
    saveUserPlaylists(playlists, user.id);
  }

  // 2. Pre-touch favorites and listen history
  getFavoriteTracks(user.id);
  getListenHistory();

  // 3. Notify listeners
  notifyStorageChanged();
}

export function registerUser(
  username: string, 
  password: string
): { success: boolean; error?: string; user?: StoredUserAccount } {
  const trimmed = username.trim();
  const normUsername = trimmed.toLowerCase();
  const cleanPassword = password.trim();

  if (trimmed.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters.' };
  }
  if (cleanPassword.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters.' };
  }

  const users = getUsersRegistry();
  if (users[normUsername]) {
    return { success: false, error: 'Username already exists. Please log in.' };
  }

  const id = `user_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const newUser: StoredUserAccount = {
    id,
    username: trimmed,
    normalizedUsername: normUsername,
    passwordHash: cleanPassword,
    createdAt: Date.now(),
  };

  users[normUsername] = newUser;
  storage.set(KEYS.USERS_REGISTRY, JSON.stringify(users));

  // Set active session
  setActiveSession({ id: newUser.id, username: newUser.username });

  // Hydrate user-specific data
  hydrateUserData(newUser);

  return { success: true, user: newUser };
}

export function loginUser(
  username: string, 
  password: string
): { success: boolean; error?: string; user?: StoredUserAccount } {
  const normUsername = username.trim().toLowerCase();
  const cleanPassword = password.trim();

  const users = getUsersRegistry();
  const user = users[normUsername];

  if (!user) {
    return { success: false, error: 'Username not found. Please sign up.' };
  }

  if (user.passwordHash !== cleanPassword) {
    return { success: false, error: 'Incorrect password.' };
  }

  // Persist active session
  setActiveSession({ id: user.id, username: user.username });

  // Hydrate user-specific data (playlists, favorites, history)
  hydrateUserData(user);

  return { success: true, user };
}

export function clearDownloadedTracksStorage(): void {
  storage.remove(KEYS.DOWNLOADED_TRACKS);
  storage.remove(KEYS.OFFLINE_TRACKS);
}

export function getMyUsername(): string | null {
  return getActiveUser();
}

export function setMyUsername(username: string) {
  setActiveUser(username);
}

// User-Scoped Playlists Binding
export function getUserPlaylistsKey(userIdOrUsername?: string | null): string {
  if (userIdOrUsername) {
    if (userIdOrUsername.startsWith('user_')) {
      return `@sukoon_playlists_${userIdOrUsername}`;
    }
    const registry = getUsersRegistry();
    const user = registry[userIdOrUsername.trim().toLowerCase()];
    if (user) {
      return `@sukoon_playlists_${user.id}`;
    }
    return `@sukoon_playlists_${userIdOrUsername.trim().toLowerCase()}`;
  }
  const session = getActiveUserSession();
  if (session?.id) {
    return `@sukoon_playlists_${session.id}`;
  }
  return '@sukoon_playlists_guest';
}

export const LIKED_SONGS_PLAYLIST_ID = 'liked-songs';

export function isLikedSongsPlaylist(playlist: Playlist | null | undefined): boolean {
  if (!playlist) return false;
  return (
    playlist.isProtected === true ||
    playlist.id === LIKED_SONGS_PLAYLIST_ID ||
    playlist.id.startsWith('liked_') ||
    playlist.name.trim().toLowerCase() === 'liked songs'
  );
}

export function getUserPlaylists(targetUserIdOrUsername?: string): Playlist[] {
  const session = getActiveUserSession();
  const key = getUserPlaylistsKey(targetUserIdOrUsername || session?.id);
  let playlists: Playlist[] = [];

  const rawData = storage.getString(key);
  if (rawData) {
    try {
      playlists = JSON.parse(rawData);
    } catch {}
  }

  // Fallback migration: If user-scoped playlists are empty, check legacy storage keys
  if (!playlists || playlists.length === 0) {
    const legacyKeysToCheck: string[] = [
      KEYS.LEGACY_USER_PLAYLISTS, // @sukoon_user_playlists
      session ? `@sukoon_user_${session.username.toLowerCase()}_playlists` : '',
      session ? `@sukoon_playlists_${session.username.toLowerCase()}` : '',
      KEYS.CUSTOM_PLAYLISTS, // @sukoon_custom_playlists
      KEYS.PLAYLISTS, // PLAYLISTS
    ].filter(Boolean);

    for (const legacyKey of legacyKeysToCheck) {
      const legacyRaw = storage.getString(legacyKey);
      if (legacyRaw) {
        try {
          const parsed = JSON.parse(legacyRaw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            playlists = parsed.map((p: any) => ({
              id: p.id || `pl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              shareCode: p.shareCode || ('SK-' + Math.random().toString(36).substring(2, 8).toUpperCase()),
              name: p.name || 'Untitled Playlist',
              description: p.description || '',
              createdAt: p.createdAt || Date.now(),
              coverImage: p.coverImage,
              isImported: p.isImported || false,
              tracks: Array.isArray(p.tracks) ? p.tracks : [],
            }));
            if (playlists.length > 0) {
              saveUserPlaylists(playlists, targetUserIdOrUsername);
              break;
            }
          }
        } catch {}
      }
    }
  }

  // Ensure every playlist has a share code
  let needsSave = false;
  playlists = playlists.map(p => {
    if (!p.shareCode) {
      p.shareCode = 'SK-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      needsSave = true;
    }
    return p;
  });

  // Ensure "Liked Songs" exists and is protected
  const likedIndex = playlists.findIndex(p => isLikedSongsPlaylist(p));
  if (likedIndex === -1) {
    const likedPlaylist: Playlist = {
      id: LIKED_SONGS_PLAYLIST_ID,
      shareCode: 'SK-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      name: 'Liked Songs',
      description: 'Your favorite tracks',
      createdAt: Date.now(),
      isImported: false,
      isProtected: true,
      tracks: [],
    };
    playlists.unshift(likedPlaylist);
    needsSave = true;
  } else {
    if (!playlists[likedIndex].isProtected) {
      playlists[likedIndex].isProtected = true;
      needsSave = true;
    }
  }

  if (needsSave) {
    saveUserPlaylists(playlists, targetUserIdOrUsername);
  }

  return playlists;
}

export function saveUserPlaylists(playlists: Playlist[], targetUserIdOrUsername?: string): void {
  const session = getActiveUserSession();
  const key = getUserPlaylistsKey(targetUserIdOrUsername || session?.id);
  storage.set(key, JSON.stringify(playlists));
  notifyStorageChanged();
}

export const getCustomPlaylists = getUserPlaylists;
export const saveCustomPlaylists = saveUserPlaylists;
export const getPlaylists = getUserPlaylists;
export const savePlaylists = saveUserPlaylists;

export function createPlaylist(name: string, description?: string, coverImage?: string): Playlist {
  const playlists = getUserPlaylists();
  const shareCode = 'SK-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const newPlaylist: Playlist = {
    id: Date.now().toString(),
    shareCode,
    name: name.trim() || 'My Playlist',
    description: description?.trim() || '',
    createdAt: Date.now(),
    coverImage,
    isImported: false,
    tracks: [],
  };
  playlists.push(newPlaylist);
  saveUserPlaylists(playlists);
  return newPlaylist;
}

export function clonePlaylistToUser(sourcePlaylist: Playlist, customName?: string): Playlist {
  const newId = 'pl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const newShareCode = 'SK-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const clonedTracks = (sourcePlaylist.tracks || []).map(track => ({ ...track }));

  const newPlaylist: Playlist = {
    id: newId,
    shareCode: newShareCode,
    name: customName || `${sourcePlaylist.name} (Copy)`,
    description: sourcePlaylist.description ? `Copied from shared playlist: ${sourcePlaylist.name}` : undefined,
    createdAt: Date.now(),
    coverImage: sourcePlaylist.coverImage,
    isImported: false, // Fully editable by recipient
    tracks: clonedTracks,
  };

  const playlists = getUserPlaylists();
  playlists.push(newPlaylist);
  saveUserPlaylists(playlists);
  return newPlaylist;
}

export function getPlaylistByShareCode(code: string): Playlist | undefined {
  if (!code) return undefined;
  const cleanCode = code.trim().toUpperCase();
  
  // 1. Check active user's playlists
  const activePlaylists = getUserPlaylists();
  const foundActive = activePlaylists.find(p => p.shareCode?.toUpperCase() === cleanCode);
  if (foundActive) return foundActive;

  // 2. Check all registered accounts on device from @sukoon_users_registry
  try {
    const users = Object.values(getUsersRegistry());
    for (const u of users) {
      const userPlaylists = getUserPlaylists(u.id);
      const found = userPlaylists.find(p => p.shareCode?.toUpperCase() === cleanCode);
      if (found) return found;
    }
  } catch {}

  // 3. Check legacy custom playlists
  const legacyKeys = [KEYS.CUSTOM_PLAYLISTS, KEYS.LEGACY_USER_PLAYLISTS, KEYS.PLAYLISTS];
  for (const lk of legacyKeys) {
    const legacyCustom = storage.getString(lk);
    if (legacyCustom) {
      try {
        const parsed: Playlist[] = JSON.parse(legacyCustom);
        const found = parsed.find(p => p.shareCode?.toUpperCase() === cleanCode);
        if (found) return found;
      } catch {}
    }
  }

  return undefined;
}

export function importPlaylistByCode(code: string, sharedPlaylistData?: Playlist): Playlist | null {
  if (!code && !sharedPlaylistData) return null;
  const cleanCode = code ? code.trim().toUpperCase() : sharedPlaylistData?.shareCode?.toUpperCase() || '';
  const playlists = getUserPlaylists();

  const existing = playlists.find(p => p.shareCode?.toUpperCase() === cleanCode && p.isImported);
  if (existing) {
    return existing;
  }

  const candidate = sharedPlaylistData || getPlaylistByShareCode(cleanCode);
  if (!candidate) {
    return null;
  }

  const importedPlaylist: Playlist = {
    ...candidate,
    id: `imported-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    shareCode: cleanCode,
    isImported: true,
    name: candidate.name,
    tracks: candidate.tracks.map(t => ({ ...t })),
  };

  playlists.push(importedPlaylist);
  saveUserPlaylists(playlists);
  return importedPlaylist;
}

export function addTrackToPlaylist(playlistId: string, track: TrackMetadata): boolean {
  if (!playlistId || !track || !track.id) return false;
  const playlists = getUserPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (!playlist) return false;

  if (playlist.tracks.some(t => t.id === track.id)) {
    return false;
  }

  playlist.tracks.push(track);
  if (!playlist.coverImage && track.artwork) {
    playlist.coverImage = track.artwork;
  }
  saveUserPlaylists(playlists);
  return true;
}

export function removeTrackFromPlaylist(playlistId: string, trackId: string): boolean {
  const playlists = getUserPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (!playlist) return false;

  const initialCount = playlist.tracks.length;
  playlist.tracks = playlist.tracks.filter(t => t.id !== trackId);
  if (playlist.tracks.length !== initialCount) {
    saveUserPlaylists(playlists);
    return true;
  }
  return false;
}

export function deletePlaylist(playlistId: string): boolean {
  const playlists = getUserPlaylists();
  const target = playlists.find(p => p.id === playlistId);
  if (target && isLikedSongsPlaylist(target)) {
    console.warn('[Storage] Cannot delete protected Liked Songs playlist');
    return false;
  }
  const filtered = playlists.filter(p => p.id !== playlistId);
  if (filtered.length !== playlists.length) {
    saveUserPlaylists(filtered);
    return true;
  }
  return false;
}

export function getLikedSongsPlaylist(targetUserIdOrUsername?: string): Playlist {
  const playlists = getUserPlaylists(targetUserIdOrUsername);
  let liked = playlists.find(p => isLikedSongsPlaylist(p));
  if (!liked) {
    liked = {
      id: LIKED_SONGS_PLAYLIST_ID,
      shareCode: 'SK-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      name: 'Liked Songs',
      description: 'Your favorite tracks',
      createdAt: Date.now(),
      isImported: false,
      isProtected: true,
      tracks: [],
    };
    playlists.unshift(liked);
    saveUserPlaylists(playlists, targetUserIdOrUsername);
  }
  return liked;
}

export function isTrackInLikedSongs(trackId: string, targetUserIdOrUsername?: string): boolean {
  if (!trackId) return false;
  const liked = getLikedSongsPlaylist(targetUserIdOrUsername);
  return liked.tracks.some(t => t.id === trackId);
}

export function toggleTrackInLikedSongs(track: TrackMetadata, targetUserIdOrUsername?: string): boolean {
  if (!track || !track.id) return false;
  const playlists = getUserPlaylists(targetUserIdOrUsername);
  let liked = playlists.find(p => isLikedSongsPlaylist(p));
  let isAdded = false;

  if (!liked) {
    liked = {
      id: LIKED_SONGS_PLAYLIST_ID,
      shareCode: 'SK-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      name: 'Liked Songs',
      description: 'Your favorite tracks',
      createdAt: Date.now(),
      isImported: false,
      isProtected: true,
      tracks: [track],
      coverImage: track.artwork,
    };
    playlists.unshift(liked);
    isAdded = true;
  } else {
    liked.isProtected = true;
    const exists = liked.tracks.some(t => t.id === track.id);
    if (exists) {
      liked.tracks = liked.tracks.filter(t => t.id !== track.id);
      isAdded = false;
    } else {
      // Add to top of Liked Songs
      liked.tracks = [track, ...liked.tracks];
      if (!liked.coverImage && track.artwork) {
        liked.coverImage = track.artwork;
      }
      isAdded = true;
    }
  }

  saveUserPlaylists(playlists, targetUserIdOrUsername);

  try {
    saveFavoriteTracks(liked.tracks, targetUserIdOrUsername);
  } catch {}

  notifyStorageChanged();
  return isAdded;
}

// User-Scoped Favorites / Liked Songs
export function getUserFavoritesKey(userId?: string | null): string {
  const session = getActiveUserSession();
  const id = userId || session?.id || 'guest';
  return `@sukoon_favorites_${id}`;
}

export function getFavoriteTracks(userId?: string): TrackMetadata[] {
  const key = getUserFavoritesKey(userId);
  const data = storage.getString(key);
  if (data) {
    try {
      return JSON.parse(data);
    } catch {}
  }
  return [];
}

export function saveFavoriteTracks(tracks: TrackMetadata[], userId?: string): void {
  const key = getUserFavoritesKey(userId);
  storage.set(key, JSON.stringify(tracks));
  notifyStorageChanged();
}

export function toggleFavoriteTrack(track: TrackMetadata, userId?: string): boolean {
  if (!track || !track.id) return false;
  const favorites = getFavoriteTracks(userId);
  const exists = favorites.some(t => t.id === track.id);
  let updated: TrackMetadata[];
  if (exists) {
    updated = favorites.filter(t => t.id !== track.id);
  } else {
    updated = [track, ...favorites];
  }
  saveFavoriteTracks(updated, userId);
  return !exists;
}

export function isTrackFavorite(trackId: string, userId?: string): boolean {
  if (!trackId) return false;
  const favorites = getFavoriteTracks(userId);
  return favorites.some(t => t.id === trackId);
}


export function getOfflineTracks(): Record<string, OfflineTrack> {
  const data = storage.getString(KEYS.OFFLINE_TRACKS);
  return data ? JSON.parse(data) : {};
}

export function saveOfflineTrack(track: OfflineTrack) {
  const tracks = getOfflineTracks();
  tracks[track.id] = track;
  storage.set(KEYS.OFFLINE_TRACKS, JSON.stringify(tracks));
}

export function getDownloadedTracks(): DownloadedTrack[] {
  const data = storage.getString(KEYS.DOWNLOADED_TRACKS);
  if (data) {
    try {
      return JSON.parse(data);
    } catch {}
  }
  const legacy = getOfflineTracks();
  const legacyList = Object.values(legacy);
  if (legacyList.length > 0) {
    return legacyList.map(t => ({
      ...t,
      downloadedAt: Date.now(),
    }));
  }
  return [];
}

export function saveDownloadedTrack(track: DownloadedTrack) {
  const tracks = getDownloadedTracks();
  const index = tracks.findIndex(t => t.id === track.id);
  if (index >= 0) {
    tracks[index] = track;
  } else {
    tracks.unshift(track);
  }
  storage.set(KEYS.DOWNLOADED_TRACKS, JSON.stringify(tracks));
  saveOfflineTrack({
    id: track.id,
    title: track.title,
    artist: track.artist,
    artwork: track.artwork,
    duration: track.duration,
    localUri: track.localUri,
  });
}

export function deleteDownloadedTrackStorage(trackId: string) {
  const tracks = getDownloadedTracks().filter(t => t.id !== trackId);
  storage.set(KEYS.DOWNLOADED_TRACKS, JSON.stringify(tracks));
  const legacy = getOfflineTracks();
  if (legacy[trackId]) {
    delete legacy[trackId];
    storage.set(KEYS.OFFLINE_TRACKS, JSON.stringify(legacy));
  }
}

export function isTrackDownloaded(trackId: string): boolean {
  if (!trackId) return false;
  const tracks = getDownloadedTracks();
  return tracks.some(t => t.id === trackId);
}

export function getLastPlayedTrack(): TrackMetadata | null {
  const data = storage.getString(KEYS.LAST_PLAYED);
  return data ? JSON.parse(data) : null;
}

export function setLastPlayedTrack(track: TrackMetadata) {
  storage.set(KEYS.LAST_PLAYED, JSON.stringify(track));
}

export function getRecentSearches(): string[] {
  const data = storage.getString(KEYS.RECENT_SEARCHES);
  return data ? JSON.parse(data) : [];
}

export function saveRecentSearch(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return getRecentSearches();
  const current = getRecentSearches();
  const updated = [trimmed, ...current.filter(item => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 10);
  storage.set(KEYS.RECENT_SEARCHES, JSON.stringify(updated));
  return updated;
}

export function clearRecentSearches(): void {
  storage.remove(KEYS.RECENT_SEARCHES);
}

// User-scoped listen history
export function getListenHistory(): TrackMetadata[] {
  const session = getActiveUserSession();
  const key = session ? `@sukoon_listen_history_${session.id}` : KEYS.LISTEN_HISTORY;
  const data = storage.getString(key) || storage.getString(KEYS.LISTEN_HISTORY);
  return data ? JSON.parse(data) : [];
}

export function saveListenHistory(track: TrackMetadata): TrackMetadata[] {
  if (!track || !track.id) return getListenHistory();
  const current = getListenHistory();
  const updated = [track, ...current.filter(t => t.id !== track.id)].slice(0, 20);
  const session = getActiveUserSession();
  const key = session ? `@sukoon_listen_history_${session.id}` : KEYS.LISTEN_HISTORY;
  storage.set(key, JSON.stringify(updated));
  return updated;
}

export const AsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    return storage.getString(key) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    storage.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    storage.remove(key);
  },
  clear: async (): Promise<void> => {
    storage.clearAll();
  }
};

export function getStudioRecordings(): StudioRecording[] {
  const data = storage.getString(KEYS.STUDIO_RECORDINGS);
  if (data) {
    try {
      return JSON.parse(data);
    } catch {}
  }
  return [];
}

export function saveStudioRecording(rec: StudioRecording): void {
  const current = getStudioRecordings();
  const updated = [rec, ...current.filter((r) => r.id !== rec.id)];
  storage.set(KEYS.STUDIO_RECORDINGS, JSON.stringify(updated));
}

export function deleteStudioRecordingStorage(id: string): void {
  const current = getStudioRecordings();
  const updated = current.filter((r) => r.id !== id);
  storage.set(KEYS.STUDIO_RECORDINGS, JSON.stringify(updated));
}

// ==========================================
// Collaborative Shared Playlists Storage
// ==========================================

export function getCollaborativePlaylists(forUser?: string): CollaborativePlaylist[] {
  try {
    const session = getActiveUserSession();
    const target = forUser || session?.username;
    if (!target) return [];
    const norm = target.trim().toLowerCase();
    const key = `@sukoon_collab_playlists_${norm}`;
    const raw = storage.getString(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[Storage] getCollaborativePlaylists error:', err);
    return [];
  }
}

export function saveCollaborativePlaylist(playlist: CollaborativePlaylist, forUser?: string): void {
  try {
    const session = getActiveUserSession();
    const targetUser = forUser || session?.username;
    if (!targetUser) return;
    const norm = targetUser.trim().toLowerCase();
    const key = `@sukoon_collab_playlists_${norm}`;
    const list = getCollaborativePlaylists(norm);
    const existingIndex = list.findIndex(p => p.id === playlist.id);
    if (existingIndex >= 0) {
      list[existingIndex] = playlist;
    } else {
      list.unshift(playlist);
    }
    storage.set(key, JSON.stringify(list));
    notifyStorageChanged();
  } catch (err) {
    console.warn('[Storage] saveCollaborativePlaylist error:', err);
  }
}

export function updateCollaborativePlaylistTracks(
  playlistId: string, 
  tracks: TrackMetadata[], 
  forUser?: string
): void {
  try {
    const session = getActiveUserSession();
    const targetUser = forUser || session?.username;
    if (!targetUser) return;
    const norm = targetUser.trim().toLowerCase();
    const key = `@sukoon_collab_playlists_${norm}`;
    const list = getCollaborativePlaylists(norm);
    const target = list.find(p => p.id === playlistId);
    if (target) {
      target.tracks = [...tracks];
      target.updatedAt = Date.now();
      target.version = (target.version || 1) + 1;
      storage.set(key, JSON.stringify(list));
      notifyStorageChanged();
    }
  } catch (err) {
    console.warn('[Storage] updateCollaborativePlaylistTracks error:', err);
  }
}

export function deleteCollaborativePlaylist(playlistId: string, forUser?: string): void {
  try {
    const session = getActiveUserSession();
    const targetUser = forUser || session?.username;
    if (!targetUser) return;
    const norm = targetUser.trim().toLowerCase();
    const key = `@sukoon_collab_playlists_${norm}`;
    const list = getCollaborativePlaylists(norm).filter(p => p.id !== playlistId);
    storage.set(key, JSON.stringify(list));
    notifyStorageChanged();
  } catch (err) {
    console.warn('[Storage] deleteCollaborativePlaylist error:', err);
  }
}

