import { Alert } from 'react-native';

export interface PipedSearchResult {
  url: string;
  type: string;
  title: string;
  thumbnail: string;
  uploaderName: string;
  uploaderUrl: string;
  uploaderAvatar: string;
  uploadedDate: string;
  shortDescription: string;
  duration: number;
  views: number;
  uploaded: number;
  uploaderVerified: boolean;
  isShort: boolean;
  streamUrl?: string;
}

const FALLBACK_RESULTS: PipedSearchResult[] = [
  {
    url: '/watch?v=dQw4w9WgXcQ',
    type: 'stream',
    title: 'Never Gonna Give You Up (Fallback)',
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    uploaderName: 'Rick Astley',
    uploaderUrl: '',
    uploaderAvatar: '',
    uploadedDate: '12 years ago',
    shortDescription: 'Fallback mock result due to API failure.',
    duration: 212,
    views: 1000000000,
    uploaded: 1256342400000,
    uploaderVerified: true,
    isShort: false,
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

export const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.smnz.de',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.syncpundit.io'
];

export async function fetchWithFallback(endpoint: string, options: any = {}): Promise<any> {
  let lastError = null;
  for (const baseUrl of PIPED_INSTANCES) {
    try {
      // Clean the endpoint to prevent double-slash routing errors
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      
      const response = await fetchWithTimeout(`${baseUrl}${cleanEndpoint}`, {
        ...options,
        headers: {
          ...options.headers,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) continue; 
      
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) continue; 

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

export async function searchTracks(query: string): Promise<PipedSearchResult[]> {
  try {
    const endpoint = `/search?q=${encodeURIComponent(query)}&filter=music_songs`;
    const data = await fetchWithFallback(endpoint, { headers: COMMON_HEADERS });
    
    if (data.items && Array.isArray(data.items)) {
      return data.items;
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
    const streamData = await fetchWithFallback(`/streams/${videoId}`, { headers: COMMON_HEADERS });
    const audioStream = streamData.audioStreams?.find((s: any) => s.format === 'M4A' || s.mimeType.includes('mp4a')) || streamData.audioStreams?.[0];
    return audioStream?.url || null;
  } catch (error) {
    console.error('Error getting audio stream:', error);
    return null;
  }
}

export async function getRelatedTracks(videoId: string): Promise<PipedSearchResult[]> {
  return FALLBACK_RESULTS;
}
