import Sanscript from '@indic-transliteration/sanscript';
import { parseSyncedLyrics, SyncedLyricLine } from '../utils/lyricsParser';

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
}

function transliterateIfNeeded(text: string | null): string | null {
  if (!text) return text;
  
  // Devanagari Unicode block: 0900-097F
  const devanagariRegex = /[\u0900-\u097F]/;
  if (devanagariRegex.test(text)) {
    try {
      return Sanscript.t(text, 'devanagari', 'itrans');
    } catch {}
  }
  return text;
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

export async function fetchLyrics(
  trackName: string, 
  artistName: string, 
  duration?: number
): Promise<ParsedLyrics | null> {
  const cleanTrack = cleanTitleForLyrics(trackName) || trackName;
  const cleanArtist = artistName && artistName !== 'Unknown Artist' ? artistName : '';

  try {
    // Endpoint 1: Exact Match
    let getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    if (duration && duration > 0) {
      getUrl += `&duration=${Math.round(duration)}`;
    }

    let response = await fetch(getUrl, {
      headers: { 'User-Agent': USER_AGENT }
    });

    if (response.ok) {
      const data: LrcLibResponse = await response.json();
      return processLrcData(data);
    }

    // Endpoint 2 (search fallback): Broad Query
    const searchQuery = `${cleanTrack} ${cleanArtist}`.trim();
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;

    response = await fetch(searchUrl, {
      headers: { 'User-Agent': USER_AGENT }
    });

    if (response.ok) {
      const results: LrcLibResponse[] = await response.json();
      if (Array.isArray(results) && results.length > 0) {
        // Prioritize items with syncedLyrics, then plainLyrics
        const bestMatch = results.find(r => r.syncedLyrics) || results.find(r => r.plainLyrics) || results[0];
        if (bestMatch) {
          return processLrcData(bestMatch);
        }
      }
    }

    return null;
  } catch (error) {
    console.error('[LyricsService] Error fetching lyrics:', error);
    return null;
  }
}

function processLrcData(data: LrcLibResponse): ParsedLyrics {
  let plain = data.plainLyrics ? transliterateIfNeeded(data.plainLyrics) : null;
  let synced = data.syncedLyrics ? transliterateIfNeeded(data.syncedLyrics) : null;
  let parsedLines: SyncedLyricLine[] = [];

  if (synced) {
    parsedLines = parseSyncedLyrics(synced);
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
