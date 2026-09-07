import { parseSyncedLyrics, SyncedLyricLine } from '../utils/lyricsParser';

export type LyricLine = SyncedLyricLine;

const USER_AGENT = 'SukoonMusic/2.0 (contact: support@sukoon.app)';

export interface LrcLibResponse {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface ParsedLyrics {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  synced: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  lines: SyncedLyricLine[];
  source?: string;
}

export interface MultiSourceLyricsResult {
  synced: boolean;
  lines: SyncedLyricLine[];
  plainLyrics?: string;
  source: string;
  availableSources: string[];
}

export const LYRICS_SOURCES = [
  'LRCLIB (Synced)',
  'Lyrics.ovh',
  'Search Proxy',
];

export function sanitizeLyricText(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Devanagari Unicode block: 0900-097F
  // If Devanagari is detected: return the original string trimmed, WITHOUT lowercasing, title-casing, or altering words.
  if (/[\u0900-\u097F]/.test(trimmed)) {
    return trimmed;
  }

  // Strip structural bracket tags like [Verse 1], [Chorus], (Instrumental)
  const cleaned = trimmed
    .replace(/^\[.*?\]\s*/g, '')
    .replace(/^\(.*?\)\s*/g, '');

  const textToCase = cleaned || trimmed;
  const lower = textToCase.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function cleanTitleForLyrics(rawTitle: string): string {
  if (!rawTitle) return '';
  return rawTitle
    .replace(/(\(|\[)(official|music|video|audio|lyrics|lyrical|hd|4k|remix|visualizer|full song|slowed|reverb).+?(\)|\])/gi, '')
    .replace(/ft\.?|feat\.?/gi, '')
    .replace(/\|.+$/g, '')
    .replace(/-.+$/g, '')
    .trim();
}

/**
 * Source A: LRCLIB (Primary Synced & Plain Lyrics)
 */
export async function fetchLrcLib(
  title: string, 
  artist: string, 
  duration?: number
): Promise<ParsedLyrics | null> {
  const cleanTrack = cleanTitleForLyrics(title) || title;
  const cleanArtist = artist && artist !== 'Unknown Artist' ? artist : '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    // Exact Match
    let getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    if (duration && duration > 0) {
      getUrl += `&duration=${Math.round(duration)}`;
    }

    try {
      const response = await fetch(getUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });

      if (response.ok) {
        clearTimeout(timeout);
        const data: LrcLibResponse = await response.json();
        const parsed = processLrcData(data);
        parsed.source = 'LRCLIB (Synced)';
        return parsed;
      }
    } catch {}

    // Broad search fallback
    const searchQuery = `${cleanTrack} ${cleanArtist}`.trim();
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (searchRes.ok) {
      const results: LrcLibResponse[] = await searchRes.json();
      if (Array.isArray(results) && results.length > 0) {
        const bestMatch = results.find(r => r.syncedLyrics) || results.find(r => r.plainLyrics) || results[0];
        if (bestMatch) {
          const parsed = processLrcData(bestMatch);
          parsed.source = 'LRCLIB (Synced)';
          return parsed;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Source B: Lyrics.ovh (Plain text provider)
 */
export async function fetchLyricsOvh(
  title: string, 
  artist: string
): Promise<ParsedLyrics | null> {
  const cleanTrack = cleanTitleForLyrics(title) || title;
  const cleanArtist = artist && artist !== 'Unknown Artist' ? artist : '';
  if (!cleanArtist || !cleanTrack) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTrack)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data?.lyrics) {
        const raw: string = data.lyrics;
        // Clean boilerplate headers often returned by Lyrics.ovh
        const cleaned = raw.replace(/^Paroles de la chanson.*?\r?\n/i, '').trim();
        const formatted = cleaned.split('\n').map(l => sanitizeLyricText(l)).join('\n');
        return {
          trackName: cleanTrack,
          artistName: cleanArtist,
          synced: false,
          syncedLyrics: null,
          plainLyrics: formatted,
          lines: [],
          source: 'Lyrics.ovh',
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Source C: Search Proxy (Secondary text search mirror)
 */
export async function fetchSearchFallback(
  title: string, 
  artist: string
): Promise<ParsedLyrics | null> {
  const cleanTrack = cleanTitleForLyrics(title) || title;
  const cleanArtist = artist && artist !== 'Unknown Artist' ? artist : '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    // Query search with loose tokens
    const query = `${cleanTrack} ${cleanArtist}`.replace(/[^\w\s\u0900-\u097F]/gi, ' ').trim();
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const list: LrcLibResponse[] = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        // Find any entry with plain or synced lyrics
        const entry = list.find(item => item.plainLyrics || item.syncedLyrics) || list[0];
        if (entry) {
          const parsed = processLrcData(entry);
          parsed.source = 'Search Proxy';
          return parsed;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Universal multi-source query with source preference
 */
export async function getLyricsWithSource(
  title: string, 
  artist: string, 
  duration?: number, 
  preferredSource?: string
): Promise<MultiSourceLyricsResult | null> {
  let result: ParsedLyrics | null = null;
  const targetSource = preferredSource || 'LRCLIB (Synced)';

  if (targetSource === 'Lyrics.ovh') {
    result = await fetchLyricsOvh(title, artist);
  } else if (targetSource === 'Search Proxy') {
    result = await fetchSearchFallback(title, artist);
  } else {
    // Default: LRCLIB (Synced)
    result = await fetchLrcLib(title, artist, duration);
  }

  // If the specifically chosen source had no match and no preferredSource was specified, fall back automatically
  if (!result && !preferredSource) {
    result = await fetchLyricsOvh(title, artist);
    if (!result) {
      result = await fetchSearchFallback(title, artist);
    }
  }

  if (!result) return null;

  return {
    synced: result.synced,
    lines: result.lines || [],
    plainLyrics: result.plainLyrics || undefined,
    source: result.source || targetSource,
    availableSources: LYRICS_SOURCES,
  };
}

export async function fetchLyrics(
  trackName: string, 
  artistName: string, 
  duration?: number
): Promise<ParsedLyrics | null> {
  const multi = await getLyricsWithSource(trackName, artistName, duration);
  if (!multi) return null;
  return {
    trackName,
    artistName,
    synced: multi.synced,
    syncedLyrics: null,
    plainLyrics: multi.plainLyrics || null,
    lines: multi.lines,
    source: multi.source,
  };
}

function processLrcData(data: LrcLibResponse): ParsedLyrics {
  let plain = data.plainLyrics || null;
  let synced = data.syncedLyrics || null;
  let parsedLines: SyncedLyricLine[] = [];

  if (synced) {
    parsedLines = parseSyncedLyrics(synced).map(line => ({
      ...line,
      text: sanitizeLyricText(line.text)
    }));
  }

  if (plain) {
    plain = plain.split('\n').map(l => sanitizeLyricText(l)).join('\n');
  }

  return {
    id: data.id,
    trackName: data.trackName,
    artistName: data.artistName,
    albumName: data.albumName,
    duration: data.duration,
    instrumental: data.instrumental,
    synced: parsedLines.length > 0,
    syncedLyrics: synced,
    plainLyrics: plain,
    lines: parsedLines,
  };
}
