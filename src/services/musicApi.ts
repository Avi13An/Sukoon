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
  // Strategy 1: Android client profile (yields progressive MP4 itag 18 containing AAC audio & moov sample tables)
  try {
    const androidPayload = {
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

    const androidRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false&alt=json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip'
      },
      body: JSON.stringify(androidPayload)
    });

    if (androidRes.ok) {
      const data = await androidRes.json();
      const adaptive = data.streamingData?.adaptiveFormats || [];
      const formats = data.streamingData?.formats || [];

      // 1. Progressive MP4 (itag 18) - 360p progressive container with AAC audio & moov sample tables
      const f18 = formats.find((f: any) => f.itag === 18 && typeof f.url === 'string' && f.url.startsWith('http'));
      if (f18?.url) return f18.url;

      // 2. Pure 128kbps AAC audio (itag 140)
      const a140 = adaptive.find((f: any) => f.itag === 140 && typeof f.url === 'string' && f.url.startsWith('http'));
      if (a140?.url) return a140.url;

      // 3. Any format in streamingData.formats with a direct URL
      const fAny = formats.find((f: any) => typeof f.url === 'string' && f.url.startsWith('http'));
      if (fAny?.url) return fAny.url;
    }
  } catch (androidErr) {
    console.warn('[musicApi] Android direct player resolution failed:', androidErr);
  }

  // Strategy 2: iOS client profile (fallback)
  try {
    const iosPayload = {
      videoId,
      context: {
        client: {
          hl: 'en',
          gl: 'IN',
          clientName: 'iOS',
          clientVersion: '20.11.6',
          deviceMake: 'Apple',
          deviceModel: 'iPhone10,4',
          osName: 'iOS',
          osVersion: '16.7.7.20H330'
        }
      }
    };

    const iosRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false&alt=json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)',
        'X-YouTube-Client-Name': '5',
        'X-YouTube-Client-Version': '20.11.6'
      },
      body: JSON.stringify(iosPayload)
    });

    if (iosRes.ok) {
      const data = await iosRes.json();
      const adaptive = data.streamingData?.adaptiveFormats || [];
      const formats = data.streamingData?.formats || [];

      // 1. Progressive MP4 (itag 18) - 360p progressive container with AAC audio & moov sample tables
      const f18 = formats.find((f: any) => f.itag === 18 && typeof f.url === 'string' && f.url.startsWith('http'));
      if (f18?.url) return f18.url;

      // 2. Pure 128kbps AAC audio (itag 140)
      const a140 = adaptive.find((f: any) => f.itag === 140 && typeof f.url === 'string' && f.url.startsWith('http'));
      if (a140?.url) return a140.url;

      // 3. Any format in streamingData.formats with a direct URL
      const fAny = formats.find((f: any) => typeof f.url === 'string' && f.url.startsWith('http'));
      if (fAny?.url) return fAny.url;
    }
  } catch (iosErr) {
    console.warn('[musicApi] iOS direct player resolution failed:', iosErr);
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
