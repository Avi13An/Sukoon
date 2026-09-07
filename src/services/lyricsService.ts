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
  // Native Hindi / Devanagari script is preserved directly without converting to ITRANS
  return text;
}

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
