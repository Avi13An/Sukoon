import { Alert } from 'react-native';
import { TrackMetadata } from '../utils/storage';

const API_BASE = 'https://sukoon-api.vercel.app';

const FALLBACK_RESULTS: TrackMetadata[] = [
  {
    id: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up (Fallback)',
    artist: 'Rick Astley',
    artwork: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  }
];

export const searchTracks = async (query: string): Promise<TrackMetadata[]> => {
  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    console.error('Search error:', err);
    return FALLBACK_RESULTS;
  }
};

export const resolveAudioStreamDirect = async (videoId: string): Promise<string | null> => {
  try {
    const payload = {
      videoId,
      context: {
        client: {
          hl: 'en',
          gl: 'IN',
          clientName: 'ANDROID',
          clientVersion: '21.03.36',
          osName: 'Android',
          osVersion: '13',
          userAgent: 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip',
          platform: 'MOBILE',
          clientFormFactor: 'SMALL_FORM_FACTOR',
          androidSdkVersion: 36
        }
      }
    };

    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false&alt=json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) return null;
    const data = await res.json();
    const formats = data.streamingData?.formats || [];
    const adaptive = data.streamingData?.adaptiveFormats || [];

    const f18 = formats.find((f: any) => f.itag === 18 && f.url) || formats.find((f: any) => f.url);
    if (f18?.url) return f18.url;

    const audio = adaptive.find((f: any) => f.itag === 140 && f.url) ||
                  adaptive.find((f: any) => f.mimeType?.includes('audio') && f.url);
    if (audio?.url) return audio.url;
  } catch (e) {
    console.error('Direct player resolution error:', e);
  }
  return null;
};

export const getAudioStream = async (id: string): Promise<string | null> => {
  // 1. Try Vercel cloud backend
  try {
    const res = await fetch(`${API_BASE}/stream?id=${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data.url) return data.url;
    }
  } catch (err) {
    console.warn('Backend stream fetch failed, falling back to direct resolver:', err);
  }

  // 2. Direct client-side resolver (Strategy D)
  // Mobile devices on residential / cellular IPs (Jio/Airtel/Wi-Fi) are not blocked by Google
  try {
    const directUrl = await resolveAudioStreamDirect(id);
    if (directUrl) return directUrl;
  } catch (err) {
    console.error('Direct audio resolution failed:', err);
  }

  return null;
};

export async function getSearchSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`, { signal });
    const json = await res.json();
    if (Array.isArray(json) && Array.isArray(json[1])) return json[1];
  } catch (e: any) {
    if (e.name !== 'AbortError') console.error('Suggestion failed', e);
  }
  return [];
}

export async function getRelatedTracks(videoId: string): Promise<TrackMetadata[]> {
  return FALLBACK_RESULTS;
}
