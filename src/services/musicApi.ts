const BASE_URL = 'https://pipedapi.kavin.rocks';

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
}

export interface PipedAudioStream {
  url: string;
  format: string;
  quality: string;
  mimeType: string;
  codec: string;
  audioSampleRate: number;
  bitrate: number;
}

export interface PipedStreamResponse {
  title: string;
  description: string;
  uploadDate: string;
  uploader: string;
  uploaderUrl: string;
  uploaderAvatar: string;
  thumbnailUrl: string;
  hls: string | null;
  audioStreams: PipedAudioStream[];
  videoStreams: any[];
  relatedStreams: PipedSearchResult[];
  subtitles: any[];
  livestream: boolean;
  proxyUrl: string;
  dash: string | null;
}

export async function searchTracks(query: string): Promise<PipedSearchResult[]> {
  try {
    const response = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}&filter=music_songs`);
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    // Items usually come under data.items
    return data.items || [];
  } catch (error) {
    console.error('Error searching tracks:', error);
    return [];
  }
}

export async function getAudioStream(videoId: string): Promise<string | null> {
  try {
    const response = await fetch(`${BASE_URL}/streams/${videoId}`);
    if (!response.ok) throw new Error('Network response was not ok');
    const data: PipedStreamResponse = await response.json();
    
    if (data.audioStreams && data.audioStreams.length > 0) {
      // Sort by bitrate descending
      const sortedStreams = data.audioStreams.sort((a, b) => b.bitrate - a.bitrate);
      // Prefer m4a/mp4 if possible, fallback to highest bitrate
      const mp4Stream = sortedStreams.find(s => s.mimeType.includes('audio/mp4') || s.mimeType.includes('audio/m4a'));
      return mp4Stream ? mp4Stream.url : sortedStreams[0].url;
    }
    return null;
  } catch (error) {
    console.error('Error getting audio stream:', error);
    return null;
  }
}

export async function getRelatedTracks(videoId: string): Promise<PipedSearchResult[]> {
  try {
    const response = await fetch(`${BASE_URL}/streams/${videoId}`);
    if (!response.ok) throw new Error('Network response was not ok');
    const data: PipedStreamResponse = await response.json();
    return data.relatedStreams || [];
  } catch (error) {
    console.error('Error getting related tracks:', error);
    return [];
  }
}
