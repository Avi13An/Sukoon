import { Alert } from 'react-native';

const INVIDIOUS_INSTANCES_URL = 'https://api.invidious.io/instances.json';

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

let cachedInstances: string[] = [];

async function getHealthyInstances(): Promise<string[]> {
  if (cachedInstances.length > 0) return cachedInstances;
  
  try {
    const res = await fetch(INVIDIOUS_INSTANCES_URL);
    if (!res.ok) throw new Error('Failed to fetch instances');
    const data = await res.json();
    
    const instances = data
      .filter((item: any) => {
        const info = item[1];
        return info.type === 'https' && 
               info.api === true && 
               info.cors === true && 
               info.monitor && 
               info.monitor.uptime >= 95.0; // High uptime filter
      })
      .map((item: any) => item[1].uri);
      
    if (instances.length > 0) {
      // Shuffle array to distribute load across healthy instances
      cachedInstances = instances.sort(() => 0.5 - Math.random());
      return cachedInstances;
    }
    throw new Error('No healthy instances found');
  } catch (err) {
    console.error('Error fetching instances:', err);
    return [
      'https://invidious.nerdvpn.de',
      'https://invidious.jing.rocks',
      'https://inv.tux.pizza',
      'https://invidious.lunar.icu'
    ];
  }
}

function mapInvidiousToTrack(item: any, instanceUri: string): PipedSearchResult {
  const thumbnails = item.videoThumbnails || [];
  let bestThumbnail = '';
  if (thumbnails.length > 0) {
    const sorted = [...thumbnails].sort((a, b) => b.width - a.width);
    bestThumbnail = sorted[0].url;
    // ensure absolute url
    if (bestThumbnail.startsWith('/')) {
      bestThumbnail = `${instanceUri}${bestThumbnail}`;
    }
  }
  
  // Construct audio stream URL dynamically via Invidious /latest_version endpoint (itag 140 = m4a)
  const streamUrl = `${instanceUri}/latest_version?id=${item.videoId}&itag=140&local=true`;

  return {
    url: `/watch?v=${item.videoId}`,
    type: item.type || 'video',
    title: item.title || 'Unknown Title',
    thumbnail: bestThumbnail,
    uploaderName: item.author || 'Unknown Artist',
    uploaderUrl: item.authorUrl || '',
    uploaderAvatar: '',
    uploadedDate: item.publishedText || 'Unknown',
    shortDescription: item.description || '',
    duration: item.lengthSeconds ? parseInt(item.lengthSeconds, 10) : 0,
    views: item.viewCount ? parseInt(item.viewCount, 10) : 0,
    uploaded: 0,
    uploaderVerified: false,
    isShort: false,
    streamUrl
  };
}

async function fetchWithFailover(pathName: string, queryParams: string): Promise<{ data: any, instance: string }> {
  const instances = await getHealthyInstances();
  let lastError: Error = new Error('No instances available');
  
  for (const instance of instances) {
    try {
      const url = `${instance}${pathName}?${queryParams}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }
      
      const data = await response.json();
      
      if (Array.isArray(data) && data.length > 0) {
        return { data, instance };
      } else if (data && !Array.isArray(data)) {
        return { data, instance };
      }
      
      throw new Error('API returned empty results');
    } catch (error: any) {
      console.warn(`Instance ${instance} failed: ${error.message}`);
      lastError = error;
      // Loop continues to test the next instance
    }
  }
  
  throw lastError;
}

export async function searchTracks(query: string): Promise<PipedSearchResult[]> {
  try {
    const { data: items, instance } = await fetchWithFailover('/api/v1/search', `q=${encodeURIComponent(query)}&type=video`);
    return items.map((item: any) => mapInvidiousToTrack(item, instance));
  } catch (error: any) {
    console.error('Error searching tracks:', error);
    Alert.alert(
      'Search Failed', 
      `All Invidious endpoints failed (${error.message || 'Network Error'}). Falling back to mock results.`
    );
    return FALLBACK_RESULTS;
  }
}

export async function getAudioStream(videoId: string): Promise<string | null> {
  try {
    const instances = await getHealthyInstances();
    if (instances.length > 0) {
      return `${instances[0]}/latest_version?id=${videoId}&itag=140&local=true`;
    }
    return null;
  } catch (error) {
    console.error('Error getting audio stream:', error);
    return null;
  }
}

export async function getRelatedTracks(videoId: string): Promise<PipedSearchResult[]> {
  try {
    const { data: item, instance } = await fetchWithFailover(`/api/v1/videos/${videoId}`, '');
    const related = item.recommendedVideos || [];
    if (related.length === 0) {
      throw new Error('API returned empty recommended videos');
    }
    return related.map((r: any) => mapInvidiousToTrack(r, instance));
  } catch (error: any) {
    console.error('Error getting related tracks:', error);
    // Silent fallback for home screen suggestions
    return FALLBACK_RESULTS;
  }
}
