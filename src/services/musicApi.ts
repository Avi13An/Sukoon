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
    streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
  },
  {
    url: '/watch?v=kJQP7kiw5Fk',
    type: 'stream',
    title: 'Despacito (Fallback)',
    thumbnail: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg',
    uploaderName: 'Luis Fonsi',
    uploaderUrl: '',
    uploaderAvatar: '',
    uploadedDate: '7 years ago',
    shortDescription: 'Fallback mock result due to API failure.',
    duration: 282,
    views: 8000000000,
    uploaded: 1484265600000,
    uploaderVerified: true,
    isShort: false,
    streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3'
  }
];

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'application/json, text/plain, */*',
};

function decodeEntities(text: string): string {
  if (!text) return '';
  return text.replace(/&quot;/g, '"')
             .replace(/&amp;/g, '&')
             .replace(/&#039;/g, "'")
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>');
}

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

async function mapJioSaavnToTrack(item: any): Promise<PipedSearchResult> {
  const highQuality = item.downloadUrl?.find((d: any) => d.quality === '320kbps') || item.downloadUrl?.[0] || { url: '' };
  const imageUrl = item.image?.find((i: any) => i.quality === '500x500') || item.image?.[0] || { link: '' };
  
  return {
    url: `/watch?v=${item.id}`,
    type: 'stream',
    title: decodeEntities(item.name || item.title || 'Unknown Title'),
    thumbnail: imageUrl.url || imageUrl.link || '',
    uploaderName: decodeEntities(item.primaryArtists || item.subtitle || 'Unknown Artist'),
    uploaderUrl: '',
    uploaderAvatar: '',
    uploadedDate: item.year || 'Unknown',
    shortDescription: '',
    duration: item.duration ? parseInt(item.duration, 10) : 0,
    views: item.playCount ? parseInt(item.playCount, 10) : 0,
    uploaded: 0,
    uploaderVerified: false,
    isShort: false,
    streamUrl: highQuality.url || highQuality.link || ''
  };
}

export async function searchTracks(query: string): Promise<PipedSearchResult[]> {
  try {
    const url = `https://jiosaavn-api-4njl.onrender.com/api/search/songs?query=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(url, { headers: COMMON_HEADERS });
    
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const data = await response.json();
    
    if (data.success && data.data && Array.isArray(data.data.results)) {
      return await Promise.all(data.data.results.map(mapJioSaavnToTrack));
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
    const url = `https://www.jiosaavn.com/api.php?__call=autocomplete.get&query=${encodeURIComponent(query)}&_format=json&_marker=0&ctx=web6dot0`;
    const res = await fetchWithTimeout(url, { headers: COMMON_HEADERS, signal }, 3000);
    const data = await res.json();
    
    let suggestions: string[] = [];
    if (data.songs && Array.isArray(data.songs.data)) {
       suggestions = data.songs.data.map((s: any) => decodeEntities(s.title));
    }
    if (suggestions.length > 0) return suggestions;
  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    console.warn('Direct suggestions failed, falling back to Google', error);
  }
  
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
    const url = `https://jiosaavn-api-4njl.onrender.com/api/songs?id=${videoId}`;
    const res = await fetchWithTimeout(url, { headers: COMMON_HEADERS });
    const data = await res.json();
    if (data.success && data.data && data.data[0]) {
      const highQuality = data.data[0].downloadUrl?.find((d: any) => d.quality === '320kbps') || data.data[0].downloadUrl?.[0];
      return highQuality?.url || highQuality?.link || null;
    }
    return null;
  } catch (error) {
    console.error('Error getting audio stream:', error);
    return null;
  }
}

export async function getRelatedTracks(videoId: string): Promise<PipedSearchResult[]> {
  try {
    const url = `https://jiosaavn-api-4njl.onrender.com/api/songs/${videoId}/suggestions`;
    const res = await fetchWithTimeout(url, { headers: COMMON_HEADERS });
    const data = await res.json();
    if (data.success && data.data && Array.isArray(data.data)) {
      return await Promise.all(data.data.map(mapJioSaavnToTrack));
    }
    throw new Error('API returned empty recommended videos');
  } catch (error: any) {
    console.error('Error getting related tracks:', error);
    return FALLBACK_RESULTS;
  }
}
