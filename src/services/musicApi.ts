import { Alert } from 'react-native';

const BASE_URL = 'https://saavn.sumit.co/api';

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
  const images = song.image || [];
  const bestImage = images.length > 0 ? images[images.length - 1].url : '';
  
  const downloadUrls = song.downloadUrl || [];
  const bestDownloadUrl = downloadUrls.length > 0 ? downloadUrls[downloadUrls.length - 1].url : '';

  return {
    url: `/watch?v=${song.id}`,
    type: 'stream',
    title: song.name,
    thumbnail: bestImage,
    uploaderName: song.primaryArtists || 'Unknown Artist',
    uploaderUrl: '',
    uploaderAvatar: '',
    uploadedDate: song.year || 'Unknown',
    shortDescription: '',
    duration: song.duration || 0,
    views: song.playCount || 0,
    uploaded: 0,
    uploaderVerified: true,
    isShort: false,
    streamUrl: bestDownloadUrl
  };
}

export async function searchTracks(query: string): Promise<PipedSearchResult[]> {
  try {
    const response = await fetch(`${BASE_URL}/search/songs?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);
    
    const json = await response.json();
    if (!json.success || !json.data || !json.data.results) {
      throw new Error('API returned malformed or empty results');
    }
    
    const items = json.data.results;
    if (items.length === 0) {
      throw new Error('No results found');
    }
    
    return items.map(mapJioSaavnToTrack);
  } catch (error: any) {
    console.error('Error searching tracks:', error);
    Alert.alert(
      'Search Failed', 
      `Could not reach the music API (${error.message || 'Network Error'}). Falling back to mock results.`
    );
    return FALLBACK_RESULTS;
  }
}

export async function getAudioStream(videoId: string): Promise<string | null> {
  try {
    const response = await fetch(`${BASE_URL}/songs/${videoId}`);
    if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);
    
    const json = await response.json();
    if (json.success && json.data && json.data.length > 0) {
      const song = json.data[0];
      const downloadUrls = song.downloadUrl || [];
      if (downloadUrls.length > 0) {
        return downloadUrls[downloadUrls.length - 1].url;
      }
    }
    return null;
  } catch (error) {
    console.error('Error getting audio stream:', error);
    return null;
  }
}

export async function getRelatedTracks(videoId: string): Promise<PipedSearchResult[]> {
  try {
    const response = await fetch(`${BASE_URL}/songs/${videoId}/suggestions`);
    if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);
    
    const json = await response.json();
    if (!json.success || !json.data) {
      throw new Error('API returned malformed suggestions');
    }
    
    const related = json.data;
    if (related.length === 0) {
      throw new Error('API returned empty related streams array');
    }
    
    return related.map(mapJioSaavnToTrack);
  } catch (error: any) {
    console.error('Error getting related tracks:', error);
    // Silent fallback for home screen suggestions
    return FALLBACK_RESULTS;
  }
}
