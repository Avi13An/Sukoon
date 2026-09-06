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

const KEYS = {
  PLAYLISTS: 'PLAYLISTS',
  CUSTOM_PLAYLISTS: '@sukoon_custom_playlists',
  OFFLINE_TRACKS: 'OFFLINE_TRACKS',
  DOWNLOADED_TRACKS: '@sukoon_downloaded_tracks',
  LAST_PLAYED: 'LAST_PLAYED',
  MY_USERNAME: 'MY_USERNAME',
  RECENT_SEARCHES: '@sukoon_recent_searches',
  LISTEN_HISTORY: '@sukoon_listen_history',
  EQUALIZER_SETTINGS: '@sukoon_equalizer_settings',
};

export function getMyUsername(): string | null {
  return storage.getString(KEYS.MY_USERNAME) || null;
}

export function setMyUsername(username: string) {
  storage.set(KEYS.MY_USERNAME, username);
}

export function getCustomPlaylists(): Playlist[] {
  let playlists: Playlist[] = [];
  const data = storage.getString(KEYS.CUSTOM_PLAYLISTS);
  if (data) {
    try {
      playlists = JSON.parse(data);
    } catch {}
  } else {
    const legacyData = storage.getString(KEYS.PLAYLISTS);
    if (legacyData) {
      try {
        const legacy: any[] = JSON.parse(legacyData);
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
    saveCustomPlaylists(playlists);
  }

  return playlists;
}

export function saveCustomPlaylists(playlists: Playlist[]) {
  storage.set(KEYS.CUSTOM_PLAYLISTS, JSON.stringify(playlists));
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

export function getPlaylistByShareCode(code: string): Playlist | undefined {
  if (!code) return undefined;
  const cleanCode = code.trim().toUpperCase();
  const playlists = getCustomPlaylists();
  return playlists.find(p => p.shareCode?.toUpperCase() === cleanCode);
}

export function importPlaylistByCode(code: string, sharedPlaylistData?: Playlist): Playlist | null {
  if (!code) return null;
  const cleanCode = code.trim().toUpperCase();
  const playlists = getCustomPlaylists();

  const existing = playlists.find(p => p.shareCode?.toUpperCase() === cleanCode && p.isImported);
  if (existing) {
    return existing;
  }

  const candidate = sharedPlaylistData || playlists.find(p => p.shareCode?.toUpperCase() === cleanCode);
  if (!candidate) {
    return null;
  }

  const importedPlaylist: Playlist = {
    ...candidate,
    id: `imported-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    shareCode: cleanCode,
    isImported: true,
    name: candidate.name,
    tracks: [...candidate.tracks],
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

