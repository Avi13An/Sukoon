import { TrackMetadata } from './storage';

export type Track = TrackMetadata;

const DEFAULT_ARTWORK = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400';

export function sanitizeTrack(raw: any): TrackMetadata {
  if (!raw || typeof raw !== 'object') {
    return {
      id: 'unknown_' + Math.random().toString(36).substring(2, 8),
      title: 'Unknown Title',
      artist: 'Unknown Artist',
      artwork: DEFAULT_ARTWORK,
      url: '',
      duration: 0,
    } as TrackMetadata;
  }

  // Clean artist: string, array of objects, or empty
  let safeArtist = 'Unknown Artist';
  if (typeof raw.artist === 'string' && raw.artist.trim().length > 0) {
    safeArtist = raw.artist.trim();
  } else if (Array.isArray(raw.artists) && raw.artists.length > 0) {
    safeArtist = raw.artists.map((a: any) => (typeof a === 'string' ? a : a?.name || '')).filter(Boolean).join(', ') || 'Unknown Artist';
  }

  // Clean artwork
  let safeArtwork = DEFAULT_ARTWORK;
  if (typeof raw.artwork === 'string' && raw.artwork.startsWith('http')) {
    safeArtwork = raw.artwork;
  } else if (typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('http')) {
    safeArtwork = raw.thumbnail;
  } else if (typeof raw.artworkUrl === 'string' && raw.artworkUrl.startsWith('http')) {
    safeArtwork = raw.artworkUrl;
  }

  // Clean title
  const safeTitle = typeof raw.title === 'string' && raw.title.trim().length > 0
    ? raw.title.trim()
    : 'Unknown Title';

  // Clean ID
  const safeId = String(raw.id || raw.videoId || Math.random().toString(36).substring(2, 9));

  return {
    ...raw,
    id: safeId,
    title: safeTitle,
    artist: safeArtist,
    artwork: safeArtwork,
    duration: Number(raw.duration) || 0,
    url: typeof raw.url === 'string' ? raw.url : '',
  } as TrackMetadata;
}

export function sanitizeTrackList(tracks: any[]): TrackMetadata[] {
  if (!Array.isArray(tracks)) return [];
  return tracks.filter(Boolean).map(sanitizeTrack);
}
