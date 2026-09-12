import { Alert } from 'react-native';
import { TrackMetadata, getListenHistory } from '../utils/storage';

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
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query.trim())}`, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    if (Array.isArray(json) && Array.isArray(json[1])) {
      return (json[1] as any[]).filter(item => typeof item === 'string');
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') console.error('Suggestion failed', e);
  }
  return [];
}

export async function getRecommendedTracks(): Promise<TrackMetadata[]> {
  try {
    const history = getListenHistory();
    if (history && history.length > 0) {
      // Pick up to 2 unique recent artists
      const uniqueArtists: string[] = [];
      for (const track of history) {
        const artist = track.artist?.trim();
        if (artist && artist !== 'Unknown Artist' && !uniqueArtists.includes(artist)) {
          uniqueArtists.push(artist);
        }
        if (uniqueArtists.length >= 2) break;
      }

      if (uniqueArtists.length > 0) {
        const collectedTracks: TrackMetadata[] = [];
        for (const artist of uniqueArtists) {
          const songs = await searchTracks(`${artist} top songs`);
          if (Array.isArray(songs) && songs.length > 0) {
            collectedTracks.push(...songs.slice(0, 5));
          }
        }

        if (collectedTracks.length > 0) {
          // Deduplicate by ID
          const seen = new Set<string>();
          const deduped: TrackMetadata[] = [];
          for (const track of collectedTracks) {
            if (track?.id && !seen.has(track.id)) {
              seen.add(track.id);
              deduped.push(track);
            }
          }
          if (deduped.length > 0) {
            return deduped;
          }
        }
      }
    }

    // Default recommendations for fresh installs or when no history matches
    const fallbackResults = await searchTracks('Bollywood acoustic hits');
    if (Array.isArray(fallbackResults) && fallbackResults.length > 0) {
      return fallbackResults;
    }
  } catch (error) {
    console.error('Error fetching recommended tracks:', error);
  }
  return FALLBACK_RESULTS;
}

/**
 * Strategy A: Fetch native YouTube Music Automix Radio queue (Innertube v1/next / RDAMVM)
 */
export async function fetchYouTubeMusicRadio(videoId: string): Promise<TrackMetadata[]> {
  try {
    const response = await fetch('https://music.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-YouTube-Client-Name': '67', // WEB_REMIX (YouTube Music)
        'X-YouTube-Client-Version': '1.20240101.01.00',
        'Origin': 'https://music.youtube.com',
      },
      body: JSON.stringify({
        enablePersistentPlaylistPanel: true,
        isAudioOnly: true,
        tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
        playlistId: `RDAMVM${videoId}`, // YouTube Music Radio Station ID
        videoId: videoId,
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'en',
            gl: 'IN',
          },
        },
      }),
    });

    if (!response.ok) {
      console.warn(`[YTM Radio] HTTP ${response.status} from Innertube next endpoint`);
      return [];
    }

    const data = await response.json();
    
    // Parse playlistPanelVideoRenderer items from the tabs/musicQueueRenderer
    const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs ||
                 data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabRenderer?.tabs || [];
    const queueTab = tabs.find((t: any) => t.tabRenderer?.content?.musicQueueRenderer) || tabs[0];
    const items = queueTab?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents ||
                  data?.continuationContents?.playlistPanelContinuation?.contents || [];

    const tracks: TrackMetadata[] = [];
    for (const item of items) {
      const renderer = item.playlistPanelVideoRenderer;
      if (!renderer || !renderer.videoId) continue;
      
      // Avoid adding the active track itself
      if (renderer.videoId === videoId) continue;

      const title = renderer.title?.runs?.[0]?.text || 'Unknown Title';
      const artist = renderer.longBylineText?.runs?.[0]?.text || renderer.shortBylineText?.runs?.[0]?.text || 'Unknown Artist';
      const durationText = renderer.lengthText?.runs?.[0]?.text || '';
      const thumbnails = renderer.thumbnail?.thumbnails || [];
      const artwork = thumbnails[thumbnails.length - 1]?.url;

      tracks.push({
        id: renderer.videoId,
        url: renderer.videoId,
        title,
        artist,
        artwork,
        duration: durationText,
      });
    }

    return tracks;
  } catch (err) {
    console.warn('[YTM Radio] Failed to fetch Innertube radio queue:', err);
    return [];
  }
}

/**
 * Strategy B: Query JioSaavn's song recommendation endpoint (reco.getreco)
 */
export async function fetchSaavnReco(songId: string): Promise<TrackMetadata[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    const url = `https://www.jiosaavn.com/api.php?__call=reco.getreco&api_version=4&_format=json&_marker=0&ctx=android&songid=${encodeURIComponent(songId)}&pid=${encodeURIComponent(songId)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const tracks: TrackMetadata[] = [];
    for (const item of data) {
      const id = item.id || item.song_id;
      if (!id || String(id) === String(songId)) continue;

      const title = item.title || item.song || 'Unknown Title';
      const artist = item.more_info?.singers || item.more_info?.music || item.primary_artists || 'Unknown Artist';
      let artwork = item.image;
      if (typeof artwork === 'string') {
        artwork = artwork.replace('150x150', '500x500').replace('http:', 'https:');
      }

      tracks.push({
        id: String(id),
        title,
        artist,
        artwork,
        duration: item.duration || item.more_info?.duration,
        url: item.more_info?.encrypted_media_url,
      });
    }
    return tracks;
  } catch (err) {
    console.warn('[Saavn Reco] Failed to fetch Saavn recommendations:', err);
    return [];
  }
}

/**
 * Strategy C: Unified Algorithmic Recommendations
 * Evaluates track source and retrieves authentic radio/recommendation queue.
 */
export async function getAlgorithmicRecommendations(track: TrackMetadata): Promise<TrackMetadata[]> {
  if (!track) return [];

  const trackId = (track.id || '').trim();
  const isYouTubeId = /^[a-zA-Z0-9_-]{11}$/.test(trackId);
  const isSaavnId = /^\d+$/.test(trackId);

  // 1. YouTube video ID
  if (isYouTubeId) {
    const ytmTracks = await fetchYouTubeMusicRadio(trackId);
    if (ytmTracks.length > 0) return ytmTracks;
  }

  // 2. JioSaavn numeric ID
  if (isSaavnId) {
    const saavnTracks = await fetchSaavnReco(trackId);
    if (saavnTracks.length > 0) return saavnTracks;
  }

  // 3. Resolve YouTube video ID once and query native YTM radio
  try {
    const query = `${track.title || ''} ${track.artist || ''}`.trim();
    if (query) {
      const searchResults = await searchTracks(query);
      const matched = searchResults.find(t => t.id && /^[a-zA-Z0-9_-]{11}$/.test(t.id));
      if (matched?.id) {
        const radioTracks = await fetchYouTubeMusicRadio(matched.id);
        if (radioTracks.length > 0) return radioTracks;
      }
    }
  } catch (err) {
    console.warn('[AlgorithmicReco] Failed to resolve videoId for radio:', err);
  }

  return [];
}

export const fetchRelatedRadioTracks = getAlgorithmicRecommendations;

export async function getRelatedTracks(videoId: string): Promise<TrackMetadata[]> {
  if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    const radio = await fetchYouTubeMusicRadio(videoId);
    if (radio.length > 0) return radio;
  }
  return getRecommendedTracks();
}

interface ChartCacheEntry {
  data: TrackMetadata[];
  timestamp: number;
}

const chartCache: Record<'india' | 'global', ChartCacheEntry | null> = {
  india: null,
  global: null,
};

const CHART_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache TTL

/**
 * Strategy D: Accurate YouTube Music India & Global Top Charts
 * Pre-fetches, deduplicates, and caches the top 20 ranked tracks.
 */
export async function fetchTrendingCharts(
  region: 'india' | 'global' = 'india',
  forceRefresh = false
): Promise<TrackMetadata[]> {
  const cached = chartCache[region];
  const now = Date.now();
  if (!forceRefresh && cached && cached.data.length > 0 && now - cached.timestamp < CHART_CACHE_TTL) {
    return cached.data;
  }

  try {
    const primaryQuery =
      region === 'india'
        ? 'Top 50 Songs India YouTube Music'
        : 'Global Top 50 YouTube Music';
    const fallbackQuery =
      region === 'india'
        ? 'Trending Songs India Top Hits'
        : 'Billboard Hot 100 top hits';

    let rawTracks = await searchTracks(primaryQuery);
    if (!Array.isArray(rawTracks) || rawTracks.length < 10) {
      const fallbackTracks = await searchTracks(fallbackQuery);
      if (Array.isArray(fallbackTracks)) {
        rawTracks = [...(rawTracks || []), ...fallbackTracks];
      }
    }

    const seenIds = new Set<string>();
    const cleanedTracks: TrackMetadata[] = [];

    for (const t of rawTracks) {
      if (!t || !t.id) continue;
      const cleanId = String(t.id).replace(/^yt_/i, '').trim();
      if (!cleanId || seenIds.has(cleanId)) continue;
      seenIds.add(cleanId);

      const title = (t.title || 'Unknown Title')
        .replace(/[\(\[\{]?(official\s*(music\s*)?(video|audio|lyric\s*video|track|remix)?)[\)\]\}]?/gi, '')
        .trim();
      const artist = (t.artist || 'Popular Artist').trim();

      let artwork = t.artwork || (t as any)?.artworkUrl || (t as any)?.thumbnail;
      if (artwork && typeof artwork === 'string') {
        if (artwork.includes('w120-h120') || artwork.includes('w60-h60')) {
          artwork = artwork.replace(/w\d+-h\d+/, 'w500-h500');
        }
      } else {
        artwork = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
      }

      cleanedTracks.push({
        id: cleanId,
        url: t.url || cleanId,
        title: title || t.title,
        artist: artist || 'Popular Artist',
        artwork,
        duration: t.duration,
      });

      if (cleanedTracks.length >= 20) break;
    }

    if (cleanedTracks.length > 0) {
      chartCache[region] = {
        data: cleanedTracks,
        timestamp: now,
      };
      return cleanedTracks;
    }
  } catch (err) {
    console.error(`[musicApi] Error fetching ${region} trending charts:`, err);
  }

  if (chartCache[region]?.data?.length) {
    return chartCache[region]!.data;
  }
  return FALLBACK_RESULTS;
}



