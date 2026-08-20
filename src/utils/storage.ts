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

export interface Playlist {
  id: string;
  name: string;
  coverImage?: string;
  tracks: TrackMetadata[];
}

const KEYS = {
  PLAYLISTS: 'PLAYLISTS',
  OFFLINE_TRACKS: 'OFFLINE_TRACKS',
  LAST_PLAYED: 'LAST_PLAYED',
  MY_USERNAME: 'MY_USERNAME',
};

export function getMyUsername(): string | null {
  return storage.getString(KEYS.MY_USERNAME) || null;
}

export function setMyUsername(username: string) {
  storage.set(KEYS.MY_USERNAME, username);
}

export function getPlaylists(): Playlist[] {
  const data = storage.getString(KEYS.PLAYLISTS);
  return data ? JSON.parse(data) : [];
}

export function savePlaylists(playlists: Playlist[]) {
  storage.set(KEYS.PLAYLISTS, JSON.stringify(playlists));
}

export function createPlaylist(name: string, coverImage?: string): Playlist {
  const playlists = getPlaylists();
  const newPlaylist: Playlist = {
    id: Date.now().toString(),
    name,
    coverImage,
    tracks: [],
  };
  playlists.push(newPlaylist);
  savePlaylists(playlists);
  return newPlaylist;
}

export function addTrackToPlaylist(playlistId: string, track: TrackMetadata) {
  const playlists = getPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (playlist) {
    if (!playlist.tracks.find(t => t.id === track.id)) {
      playlist.tracks.push(track);
      savePlaylists(playlists);
    }
  }
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

export function getLastPlayedTrack(): TrackMetadata | null {
  const data = storage.getString(KEYS.LAST_PLAYED);
  return data ? JSON.parse(data) : null;
}

export function setLastPlayedTrack(track: TrackMetadata) {
  storage.set(KEYS.LAST_PLAYED, JSON.stringify(track));
}
