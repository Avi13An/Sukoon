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
  tracks: TrackMetadata[];
}

export interface UserAccount {
  username: string;
  passwordHash: string;
  createdAt: number;
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
  USERS_DB: '@sukoon_users_db',
  PLAYLISTS: 'PLAYLISTS',
  CUSTOM_PLAYLISTS: '@sukoon_custom_playlists',
  OFFLINE_TRACKS: 'OFFLINE_TRACKS',
  DOWNLOADED_TRACKS: '@sukoon_downloaded_tracks',
  STUDIO_RECORDINGS: '@sukoon_studio_recordings',
  LAST_PLAYED: 'LAST_PLAYED',
  MY_USERNAME: 'MY_USERNAME',
  RECENT_SEARCHES: '@sukoon_recent_searches',
  LISTEN_HISTORY: '@sukoon_listen_history',
  EQUALIZER_SETTINGS: '@sukoon_equalizer_settings',
};

export function getActiveUser(): string | null {
  return storage.getString(KEYS.ACTIVE_SESSION) || storage.getString(KEYS.MY_USERNAME) || null;
}

export function setActiveUser(username: string): void {
  const clean = username.trim().toLowerCase();
  storage.set(KEYS.ACTIVE_SESSION, clean);
  storage.set(KEYS.MY_USERNAME, clean);
}

export function clearActiveSession(): void {
  storage.remove(KEYS.ACTIVE_SESSION);
  storage.remove(KEYS.MY_USERNAME);
}

export function getUsersDb(): Record<string, UserAccount> {
  const data = storage.getString(KEYS.USERS_DB);
  if (data) {
    try {
      return JSON.parse(data);
    } catch {}
  }
  return {};
}

export function registerUser(username: string, password: string): { success: boolean; error?: string } {
  const cleanUser = username.trim().toLowerCase();
  const cleanPass = password.trim();
  if (cleanUser.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters.' };
  }
  if (cleanPass.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters.' };
  }

  const db = getUsersDb();
  if (db[cleanUser]) {
    return { success: false, error: 'Username is already taken.' };
  }

  db[cleanUser] = {
    username: cleanUser,
    passwordHash: cleanPass,
    createdAt: Date.now(),
  };

  storage.set(KEYS.USERS_DB, JSON.stringify(db));
  setActiveUser(cleanUser);
  return { success: true };
}

export function loginUser(username: string, password: string): { success: boolean; error?: string } {
  const cleanUser = username.trim().toLowerCase();
  const cleanPass = password.trim();
  const db = getUsersDb();
  const user = db[cleanUser];

  if (!user || user.passwordHash !== cleanPass) {
    return { success: false, error: 'Invalid username or password.' };
  }

  setActiveUser(cleanUser);
  return { success: true };
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

export function getUserPlaylistsKey(username?: string | null): string {
  const user = username || getActiveUser() || 'guest';
  return `@sukoon_user_${user.toLowerCase()}_playlists`;
}

export function getCustomPlaylists(username?: string): Playlist[] {
  const key = getUserPlaylistsKey(username);
  let playlists: Playlist[] = [];
  const data = storage.getString(key);
  if (data) {
    try {
      playlists = JSON.parse(data);
    } catch {}
  } else {
    // If no user-specific key exists yet, check legacy storage keys for smooth migration
    const legacyCustom = storage.getString(KEYS.CUSTOM_PLAYLISTS);
    const legacyPlaylists = storage.getString(KEYS.PLAYLISTS);
    const raw = legacyCustom || legacyPlaylists;
    if (raw) {
      try {
        const legacy: any[] = JSON.parse(raw);
        playlists = legacy.map(p => ({
          id: p.id || Date.now().toString(),
          shareCode: p.shareCode || ('SK-' + Math.random().toString(36).substring(2, 8).toUpperCase()),
          name: p.name || 'Untitled Playlist',
          description: p.description || '',
          createdAt: p.createdAt || Date.now(),
          coverImage: p.coverImage,
          isImported: p.isImported || false,
          tracks: p.tracks || []
        }));
        if (playlists.length > 0) {
          saveCustomPlaylists(playlists, username);
        }
      } catch {}
    }
  }

  let needsSave = false;
  playlists = playlists.map(p => {
    if (!p.shareCode) {
      p.shareCode = 'SK-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      needsSave = true;
    }
    return p;
  });

  if (needsSave) {
    saveCustomPlaylists(playlists, username);
  }

  return playlists;
}

export function saveCustomPlaylists(playlists: Playlist[], username?: string) {
  const key = getUserPlaylistsKey(username);
  storage.set(key, JSON.stringify(playlists));
}

export function createPlaylist(name: string, description?: string, coverImage?: string): Playlist {
  const playlists = getCustomPlaylists();
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
  saveCustomPlaylists(playlists);
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

  const playlists = getCustomPlaylists();
  playlists.push(newPlaylist);
  saveCustomPlaylists(playlists);
  return newPlaylist;
}

export function getPlaylistByShareCode(code: string): Playlist | undefined {
  if (!code) return undefined;
  const cleanCode = code.trim().toUpperCase();
  
  // 1. Check active user's playlists
  const activePlaylists = getCustomPlaylists();
  const foundActive = activePlaylists.find(p => p.shareCode?.toUpperCase() === cleanCode);
  if (foundActive) return foundActive;

  // 2. Check all registered accounts on device
  try {
    const users = Object.keys(getUsersDb());
    for (const u of users) {
      const userPlaylists = getCustomPlaylists(u);
      const found = userPlaylists.find(p => p.shareCode?.toUpperCase() === cleanCode);
      if (found) return found;
    }
  } catch {}

  // 3. Check legacy custom playlists
  const legacyCustom = storage.getString(KEYS.CUSTOM_PLAYLISTS);
  if (legacyCustom) {
    try {
      const parsed: Playlist[] = JSON.parse(legacyCustom);
      const found = parsed.find(p => p.shareCode?.toUpperCase() === cleanCode);
      if (found) return found;
    } catch {}
  }

  return undefined;
}

export function importPlaylistByCode(code: string, sharedPlaylistData?: Playlist): Playlist | null {
  if (!code && !sharedPlaylistData) return null;
  const cleanCode = code ? code.trim().toUpperCase() : sharedPlaylistData?.shareCode?.toUpperCase() || '';
  const playlists = getCustomPlaylists();

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
  saveCustomPlaylists(playlists);
  return importedPlaylist;
}

export function addTrackToPlaylist(playlistId: string, track: TrackMetadata): boolean {
  if (!playlistId || !track || !track.id) return false;
  const playlists = getCustomPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (!playlist) return false;

  if (playlist.tracks.some(t => t.id === track.id)) {
    return false;
  }

  playlist.tracks.push(track);
  if (!playlist.coverImage && track.artwork) {
    playlist.coverImage = track.artwork;
  }
  saveCustomPlaylists(playlists);
  return true;
}

export function removeTrackFromPlaylist(playlistId: string, trackId: string): boolean {
  const playlists = getCustomPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (!playlist) return false;

  const initialCount = playlist.tracks.length;
  playlist.tracks = playlist.tracks.filter(t => t.id !== trackId);
  if (playlist.tracks.length !== initialCount) {
    saveCustomPlaylists(playlists);
    return true;
  }
  return false;
}

export function deletePlaylist(playlistId: string): boolean {
  const playlists = getCustomPlaylists();
  const filtered = playlists.filter(p => p.id !== playlistId);
  if (filtered.length !== playlists.length) {
    saveCustomPlaylists(filtered);
    return true;
  }
  return false;
}

export const getPlaylists = getCustomPlaylists;
export const savePlaylists = saveCustomPlaylists;

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

export function getListenHistory(): TrackMetadata[] {
  const data = storage.getString(KEYS.LISTEN_HISTORY);
  return data ? JSON.parse(data) : [];
}

export function saveListenHistory(track: TrackMetadata): TrackMetadata[] {
  if (!track || !track.id) return getListenHistory();
  const current = getListenHistory();
  const updated = [track, ...current.filter(t => t.id !== track.id)].slice(0, 20);
  storage.set(KEYS.LISTEN_HISTORY, JSON.stringify(updated));
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

export type EqualizerPresetName = 'Flat' | 'Bass Boost' | 'Vocal' | 'Pop' | 'Rock' | 'Electronic' | 'Custom';

export interface EqualizerSettings {
  enabled: boolean;
  preset: EqualizerPresetName;
  bassBoost: number; // 0 to 100
  soundBoost: number; // 0 to 100
  bands: { [frequency: string]: number }; // in dB (-10 to +10)
}

export const DEFAULT_EQ_BANDS: { [frequency: string]: number } = {
  '60Hz': 0,
  '230Hz': 0,
  '910Hz': 0,
  '3.6kHz': 0,
  '14kHz': 0,
};

export const EQUALIZER_PRESETS: Record<
  'Flat' | 'Bass Boost' | 'Vocal' | 'Pop' | 'Rock' | 'Electronic',
  { bassBoost: number; bands: { [frequency: string]: number } }
> = {
  'Flat': {
    bassBoost: 0,
    bands: { '60Hz': 0, '230Hz': 0, '910Hz': 0, '3.6kHz': 0, '14kHz': 0 },
  },
  'Bass Boost': {
    bassBoost: 75,
    bands: { '60Hz': 8, '230Hz': 5, '910Hz': -1, '3.6kHz': 1, '14kHz': 2 },
  },
  'Vocal': {
    bassBoost: 15,
    bands: { '60Hz': -3, '230Hz': 2, '910Hz': 7, '3.6kHz': 5, '14kHz': 0 },
  },
  'Pop': {
    bassBoost: 40,
    bands: { '60Hz': 3, '230Hz': 6, '910Hz': 2, '3.6kHz': 4, '14kHz': 5 },
  },
  'Rock': {
    bassBoost: 50,
    bands: { '60Hz': 6, '230Hz': 4, '910Hz': -2, '3.6kHz': 3, '14kHz': 6 },
  },
  'Electronic': {
    bassBoost: 65,
    bands: { '60Hz': 7, '230Hz': 5, '910Hz': 0, '3.6kHz': 3, '14kHz': 6 },
  },
};

export const DEFAULT_EQUALIZER_SETTINGS: EqualizerSettings = {
  enabled: true,
  preset: 'Flat',
  bassBoost: 0,
  soundBoost: 0,
  bands: { ...DEFAULT_EQ_BANDS },
};

export function getEqualizerSettings(): EqualizerSettings {
  const data = storage.getString(KEYS.EQUALIZER_SETTINGS);
  if (data) {
    try {
      const parsed = JSON.parse(data);
      return {
        ...DEFAULT_EQUALIZER_SETTINGS,
        ...parsed,
        bands: { ...DEFAULT_EQ_BANDS, ...(parsed.bands || {}) },
      };
    } catch {}
  }
  return { ...DEFAULT_EQUALIZER_SETTINGS, bands: { ...DEFAULT_EQ_BANDS } };
}

export function saveEqualizerSettings(settings: EqualizerSettings): void {
  storage.set(KEYS.EQUALIZER_SETTINGS, JSON.stringify(settings));
}

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

