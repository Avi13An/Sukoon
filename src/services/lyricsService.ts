import Sanscript from '@indic-transliteration/sanscript';

const USER_AGENT = 'HarmonyClone/1.0';

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

function transliterateIfNeeded(text: string | null): string | null {
  if (!text) return text;
  
  // Basic check to see if text contains Devanagari characters
  // Devanagari Unicode block: 0900-097F
  const devanagariRegex = /[\u0900-\u097F]/;
  if (devanagariRegex.test(text)) {
    return Sanscript.t(text, 'devanagari', 'itrans');
  }
  return text;
}

export async function fetchLyrics(trackName: string, artistName: string): Promise<LrcLibResponse | null> {
  try {
    const response = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`, {
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error('Failed to fetch lyrics');
    }

    const data: LrcLibResponse = await response.json();
    
    // Transliterate lyrics if needed
    if (data.plainLyrics) {
      data.plainLyrics = transliterateIfNeeded(data.plainLyrics);
    }
    if (data.syncedLyrics) {
      data.syncedLyrics = transliterateIfNeeded(data.syncedLyrics);
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching lyrics:', error);
    return null;
  }
}
