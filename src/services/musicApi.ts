import { Alert } from 'react-native';

const CANDIDATE_ENDPOINTS = [
  'https://saavn.sumit.co',
  'https://jiosaavn-api-sigma-sandy.vercel.app',
  'https://jiosaavn-api-privatetesting.vercel.app'
];

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
  streamUrl?: string; // Added to pass direct download URL
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

function mapJioSaavnToTrack(song: any): PipedSearchResult {
  let bestImage = '';
  if (Array.isArray(song.image)) {
    bestImage = song.image.length > 0 ? song.image[song.image.length - 1].url : '';
  } else if (typeof song.image === 'string') {
    bestImage = song.image;
  }
  
  let bestDownloadUrl = '';
  if (Array.isArray(song.downloadUrl)) {
    bestDownloadUrl = song.downloadUrl.length > 0 ? song.downloadUrl[song.downloadUrl.length - 1].url : '';
  } else if (typeof song.downloadUrl === 'string') {
    bestDownloadUrl = song.downloadUrl;
  } else if (Array.isArray(song.media_url)) {
    bestDownloadUrl = song.media_url.length > 0 ? song.media_url[song.media_url.length - 1].url : '';
  } else if (typeof song.media_url === 'string') {
    bestDownloadUrl = song.media_url;
  }

  return {
    url: `/watch?v=${song.id}`,
    type: 'stream',
    title: song.name || song.title || 'Unknown Title',
    thumbnail: bestImage,
    uploaderName: song.primaryArtists || song.singers || 'Unknown Artist',
    uploaderUrl: '',
    uploaderAvatar: '',
    uploadedDate: song.year || 'Unknown',
    shortDescription: '',
    duration: song.duration ? parseInt(song.duration, 10) : 0,
    views: song.playCount ? parseInt(song.playCount, 10) : 0,
    uploaded: 0,
    uploaderVerified: true,
    isShort: false,
    streamUrl: bestDownloadUrl
  };
}

async function fetchWithFailover(pathName: string, queryParams: string): Promise<any> {
  let lastError: Error = new Error('No endpoints available');

  for (const base of CANDIDATE_ENDPOINTS) {
    const urlsToTry = [
      `${base}/api${pathName}?${queryParams}`,
      `${base}${pathName}?${queryParams}`
    ];

    for (const url of urlsToTry) {
      try {
        const response = await fetch(url);
        
        if (response.status === 404) {
          continue; // Path variant incorrect, try next path
        }
        
        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}`);
        }
        
        const json = await response.json();
        
        let results = null;
        if (json.success !== false && json.data) {
          results = json.data.results || json.data;
        } else if (json.results) {
          results = json.results;
        } else if (Array.isArray(json)) {
          results = json;
        } else if (json.status === 'SUCCESS' || json.status === 'success') {
          results = json.results || json.data;
        }
        
        if (results && (Array.isArray(results) ? results.length > 0 : true)) {
          return results;
        }
        
        throw new Error('API returned empty results');
        
      } catch (error: any) {
        lastError = error;
        // If it's a 404, we let it loop to the next variation.
        // Otherwise (429, 502, network error, empty results), break and try the next server instance.
        if (!error.message.includes('404')) {
          break;
        }
      }
    }
  }
  
  throw lastError;
}

export async function searchTracks(query: string): Promise<PipedSearchResult[]> {
  try {
    const items = await fetchWithFailover('/search/songs', `query=${encodeURIComponent(query)}`);
    if (!Array.isArray(items)) {
      throw new Error('Results is not an array');
    }
    return items.map(mapJioSaavnToTrack);
  } catch (error: any) {
    console.error('Error searching tracks:', error);
    Alert.alert(
      'Search Failed', 
      `All endpoints failed (${error.message || 'Network Error'}). Falling back to mock results.`
    );
    return FALLBACK_RESULTS;
  }
}

export async function getAudioStream(videoId: string): Promise<string | null> {
  try {
    const items = await fetchWithFailover(`/songs/${videoId}`, '');
    const song = Array.isArray(items) ? items[0] : items;
    if (song) {
      const parsed = mapJioSaavnToTrack(song);
      return parsed.streamUrl || null;
    }
    return null;
  } catch (error) {
    console.error('Error getting audio stream:', error);
    return null;
  }
}

export async function getRelatedTracks(videoId: string): Promise<PipedSearchResult[]> {
  try {
    const items = await fetchWithFailover(`/songs/${videoId}/suggestions`, '');
    if (!Array.isArray(items)) {
      throw new Error('Results is not an array');
    }
    return items.map(mapJioSaavnToTrack);
  } catch (error: any) {
    console.error('Error getting related tracks:', error);
    // Silent fallback for home screen suggestions
    return FALLBACK_RESULTS;
  }
}
