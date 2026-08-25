import { Alert } from 'react-native';

import { TrackMetadata } from '../utils/storage';

const FALLBACK_RESULTS: TrackMetadata[] = [
  {
    id: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up (Fallback)',
    artist: 'Rick Astley',
    artwork: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  },
  {
    id: 'kJQP7kiw5Fk',
    title: 'Despacito (Fallback)',
    artist: 'Luis Fonsi',
    artwork: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg',
  }
];

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'application/json, text/plain, */*',
};

async function fetchWithTimeout(url: string, options: any = {}, timeout: number = 4000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort());
    }
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

export const INVIDIOUS_INSTANCES = [
  'https://invidious.fdn.fr',
  'https://inv.tux.pizza',
  'https://invidious.perennialte.ch',
  'https://invidious.nerdvpn.de'
];

export async function fetchWithFallback(endpoint: string): Promise<any> {
  let lastError = null;
  for (const baseUrl of INVIDIOUS_INSTANCES) {
    try {
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      // No spoofed headers needed because these nodes don't use Cloudflare
      const response = await fetchWithTimeout(`${baseUrl}${cleanEndpoint}`);
      
      if (!response.ok) continue; 
      
      const data = await response.json();
      if (data.error) continue; 

      return data; 
    } catch (e: any) {
      lastError = e;
      console.log(`Node ${baseUrl} failed. Bypassing...`);
      continue; 
    }
  }
  throw new Error(`All network nodes offline or blocked. Last error: ${lastError?.message || 'Unknown'}`);
}

export async function searchTracks(query: string): Promise<TrackMetadata[]> {
  try {
    const data = await fetchWithFallback(`/api/v1/search?q=${encodeURIComponent(query)}`);
    
    if (Array.isArray(data)) {
      // Filter for videos to avoid channels/playlists
      return data.filter((item: any) => item.type === 'video').map((item: any) => ({
        id: item.videoId,
        title: item.title,
        artist: item.author,
        artwork: item.videoThumbnails?.find((t: any) => t.quality === 'high')?.url || item.videoThumbnails?.[0]?.url || '',
      }));
    }
    
    throw new Error('API returned empty results');
  } catch (error: any) {
    console.error('Error searching tracks:', error);
    Alert.alert(
      'Search Failed', 
      `Direct engine failed (${error.message || 'Network Error'}). Falling back to mock results.`
    );
    return FALLBACK_RESULTS;
  }
}

export async function getSearchSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetchWithTimeout(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`, { signal }, 3000);
    const json = await res.json();
    if (Array.isArray(json) && Array.isArray(json[1])) {
       return json[1];
    }
  } catch (fallbackError: any) {
     if (fallbackError.name === 'AbortError') throw fallbackError;
     console.error('All suggestion endpoints failed', fallbackError);
  }
  return [];
}

export async function getAudioStream(videoId: string): Promise<string | null> {
  try {
    const streamData = await fetchWithFallback(`/api/v1/videos/${videoId}`);
    const audioStream = streamData.adaptiveFormats?.find((s: any) => s.type?.includes('audio/mp4') || s.type?.includes('audio/m4a')) || streamData.adaptiveFormats?.find((s: any) => s.type?.includes('audio'));
    return audioStream?.url || null;
  } catch (error) {
    console.error('Error getting audio stream:', error);
    return null;
  }
}

export async function getRelatedTracks(videoId: string): Promise<TrackMetadata[]> {
  return FALLBACK_RESULTS;
}
