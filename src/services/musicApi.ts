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

    // 1. Progressive format (itag 18 has combined video+audio with direct URL)
    const f18 = formats.find((f: any) => f.itag === 18 && typeof f.url === 'string') || 
                formats.find((f: any) => typeof f.url === 'string' && f.url.startsWith('http'));
    if (f18?.url) return f18.url;

    // 2. Adaptive audio formats (itag 140 is AAC 128kbps, or any audio/mp4 / audio stream)
    const a140 = adaptive.find((f: any) => f.itag === 140 && typeof f.url === 'string');
    if (a140?.url) return a140.url;

    const audioMp4 = adaptive.find((f: any) => f.mimeType?.includes('audio/mp4') && typeof f.url === 'string');
    if (audioMp4?.url) return audioMp4.url;

    const anyAudio = adaptive.find((f: any) => f.mimeType?.includes('audio') && typeof f.url === 'string' && f.url.startsWith('http'));
    if (anyAudio?.url) return anyAudio.url;

    // 3. Fallback: check if URL is encoded in cipher parameters
    const cipherItem = formats.find((f: any) => f.cipher || f.signatureCipher) ||
                       adaptive.find((f: any) => (f.mimeType?.includes('audio') || f.itag === 140) && (f.cipher || f.signatureCipher));
    if (cipherItem) {
      const cipherStr = cipherItem.url || cipherItem.cipher || cipherItem.signatureCipher;
      if (cipherStr && cipherStr.includes('url=')) {
        const params = new URLSearchParams(cipherStr);
        const extracted = params.get('url');
        if (extracted && extracted.startsWith('http')) return decodeURIComponent(extracted);
      }
    }
  } catch (e) {
    console.error('Direct player resolution error:', e);
  }
  return null;
};

export const getAudioStream = async (id: string): Promise<string | null> => {
  // Attempt 1: Direct client-side resolver (Strategy D - Android client profile)
  try {
    const directUrl = await resolveAudioStreamDirect(id);
    if (typeof directUrl === 'string' && directUrl.startsWith('http')) {
      return directUrl;
    }
  } catch (err) {
    console.warn('[musicApi] Direct resolver failed, falling back to cloud backend:', err);
  }

  // Attempt 2 (Fallback): Vercel cloud backend
  try {
    const res = await fetch(`${API_BASE}/stream?id=${id}`);
    if (res.ok) {
      const data = await res.json();
      const directUrl = typeof data === 'string' ? data : data?.url;
      if (typeof directUrl === 'string' && directUrl.startsWith('http')) {
        return directUrl;
      }
    }
  } catch (err) {
    console.warn('[musicApi] Backend stream fetch failed, falling back to public mirrors:', err);
  }

  // Attempt 3 (Public mirror fallback): Query high-availability public mirrors
  const mirrorCandidates = [
    `https://invidious.f5.si/latest_version?id=${id}&itag=140`,
    `https://yt.omada.cafe/latest_version?id=${id}&itag=140`,
    `https://invidious.f5.si/latest_version?id=${id}&itag=18`,
    `https://yt.omada.cafe/latest_version?id=${id}&itag=18`,
  ];

  for (const mirrorUrl of mirrorCandidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(mirrorUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.status === 302 || res.status === 200 || res.status === 206) {
        const loc = res.headers.get('location');
        if (loc && loc.startsWith('http')) {
          return loc;
        }
        return mirrorUrl;
      }
    } catch {
      // try next mirror
    }
  }

  // Emergency fallback: return active mirror endpoint directly so player follows redirects natively
  return `https://invidious.f5.si/latest_version?id=${id}&itag=140`;
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
