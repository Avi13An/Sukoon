import { Alert } from 'react-native';
import { TrackMetadata, Playlist, getListenHistory } from '../utils/storage';

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

export async function getRecommendedTracks(seedTrackId?: string): Promise<TrackMetadata[]> {
  try {
    if (seedTrackId) {
      const cleanSeedId = String(seedTrackId).replace(/^yt_/i, '').trim();
      const radioTracks = await fetchYouTubeMusicRadio(cleanSeedId);
      if (Array.isArray(radioTracks) && radioTracks.length > 0) {
        return radioTracks;
      }
    }

    const history = getListenHistory();
    if (history && history.length > 0) {
      const firstTrack = history[0];
      if (firstTrack?.id) {
        const cleanSeedId = String(firstTrack.id).replace(/^yt_/i, '').trim();
        const radioTracks = await fetchYouTubeMusicRadio(cleanSeedId);
        if (Array.isArray(radioTracks) && radioTracks.length > 0) {
          return radioTracks;
        }
      }

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
            collectedTracks.push(...songs.slice(0, 10));
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
 * Helper to fetch and parse official YouTube Music Chart playlists
 */
async function fetchChartPlaylistFromYouTube(playlistId: string): Promise<TrackMetadata[]> {
  const cleanPlaylistId = playlistId.replace(/^VL/i, '').trim();
  const browseId = `VL${cleanPlaylistId}`;
  const endpoints = [
    'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
    'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-YouTube-Client-Name': '67',
          'X-YouTube-Client-Version': '1.20240101.01.00',
          'Origin': 'https://music.youtube.com',
          'Referer': 'https://music.youtube.com/',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'en',
              gl: 'IN',
            },
          },
          browseId,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const data = await res.json();
      const contents =
        data.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer?.contents;

      if (Array.isArray(contents) && contents.length > 0) {
        const tracks: TrackMetadata[] = [];
        const seenIds = new Set<string>();

        for (const item of contents) {
          const r = item.musicResponsiveListItemRenderer;
          if (!r) continue;

          const rawTitle = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
          const rawArtist = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((x: any) => x.text).join('') || 'Popular Artist';
          const videoId =
            r.playlistItemData?.videoId ||
            r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

          if (!videoId || !rawTitle) continue;
          const cleanId = String(videoId).replace(/^yt_/i, '').trim();
          if (!cleanId || seenIds.has(cleanId)) continue;
          seenIds.add(cleanId);

          const title = rawTitle
            .replace(/[\(\[\{]?(official\s*(music\s*)?(video|audio|lyric\s*video|track|remix)?)[\)\]\}]?/gi, '')
            .trim();
          const artist = rawArtist.trim();

          const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
          let artwork = thumbs?.[thumbs.length - 1]?.url;
          if (artwork && typeof artwork === 'string') {
            if (artwork.includes('w120-h120') || artwork.includes('w60-h60')) {
              artwork = artwork.replace(/w\d+-h\d+/, 'w500-h500');
            }
          } else {
            artwork = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
          }

          const duration = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;

          tracks.push({
            id: cleanId,
            url: cleanId,
            title: title || rawTitle,
            artist: artist || 'Popular Artist',
            artwork,
            duration,
          });

          if (tracks.length >= 25) break;
        }

        if (tracks.length > 0) {
          return tracks;
        }
      }
    } catch {
      // Continue to next endpoint or candidate
    }
  }

  return [];
}

/**
 * Strategy D: Official YouTube Music India & Global Top 100 Charts
 * Queries official chart playlist IDs, extracts ranked tracks, and caches top 25 results.
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

  // Official Chart Playlist IDs
  // India: PL4fGSI1pDJn6jXS_PEo3hJbhsxeJTrOBZ (Top 100 India), fallbacks: PL4fGSI1pDJn40WjZ6utkIuj2rNg-7iGsq, PL4fGSI1pDJn5oibdgJt8Hy0-dr2B7kSs2
  // Global: PL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc (Top 100 Global), fallback: PLFgquLnL59alGJcdc0BEZJb2U7Igkzn0v
  const chartCandidates =
    region === 'india'
      ? ['PL4fGSI1pDJn6jXS_PEo3hJbhsxeJTrOBZ', 'PL4fGSI1pDJn40WjZ6utkIuj2rNg-7iGsq', 'PL4fGSI1pDJn5oibdgJt8Hy0-dr2B7kSs2']
      : ['PL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc', 'PLFgquLnL59alGJcdc0BEZJb2U7Igkzn0v'];

  for (const playlistId of chartCandidates) {
    try {
      const chartTracks = await fetchChartPlaylistFromYouTube(playlistId);
      if (Array.isArray(chartTracks) && chartTracks.length > 0) {
        const top25 = chartTracks.slice(0, 25);
        chartCache[region] = {
          data: top25,
          timestamp: now,
        };
        return top25;
      }
    } catch (err) {
      console.warn(`[musicApi] Failed fetching chart playlist ${playlistId}:`, err);
    }
  }

  // Fallback to search query if official chart playlists are unavailable
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
        url: cleanId,
        title: title || t.title,
        artist: artist || 'Popular Artist',
        artwork,
        duration: t.duration,
      });

      if (cleanedTracks.length >= 25) break;
    }

    if (cleanedTracks.length > 0) {
      chartCache[region] = {
        data: cleanedTracks,
        timestamp: now,
      };
      return cleanedTracks;
    }
  } catch (err) {
    console.error(`[musicApi] Error fetching ${region} trending charts fallback:`, err);
  }

  if (chartCache[region]?.data?.length) {
    return chartCache[region]!.data;
  }
  return FALLBACK_RESULTS;
}

interface MoodPlaylistDefinition {
  title: string;
  description: string;
  query: string;
  coverImage: string;
}

const MOOD_PLAYLIST_DEFINITIONS: Record<string, MoodPlaylistDefinition[]> = {
  chill: [
    {
      title: 'Bollywood Acoustic Chill',
      description: 'Mellow acoustic guitar & soothing Bollywood unplugged hits',
      query: 'Bollywood Acoustic Chill unplugged songs',
      coverImage: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Indie India Sukoon Hits',
      description: 'Soulful indie acoustic tracks from India’s best singer-songwriters',
      query: 'Indie India Sukoon Hits songs',
      coverImage: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Hindi Lofi Chill Mix',
      description: 'Calm lo-fi beats blended with timeless Hindi melodies',
      query: 'Hindi Lofi Chill Mix songs',
      coverImage: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Coke Studio Unplugged Melodies',
      description: 'Raw unplugged live recordings and studio sessions',
      query: 'Coke Studio Unplugged Melodies songs',
      coverImage: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80',
    },
  ],
  romance: [
    {
      title: 'Bollywood Romantic Essentials',
      description: 'Heart-melting love songs that defined romance in Bollywood',
      query: 'Bollywood Romantic Essentials love songs',
      coverImage: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Heartfelt Hindi Love Songs',
      description: 'Contemporary romantic ballads and soulful melodies',
      query: 'Heartfelt Hindi Love Songs latest',
      coverImage: 'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Indie Romance Anuv & Prateek',
      description: 'Gentle acoustic love serenades and modern indie ballads',
      query: 'Indie Romance Anuv Prateek songs',
      coverImage: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Soulful Bollywood Duets',
      description: 'Harmonious classic and modern Bollywood vocal duets',
      query: 'Soulful Bollywood Duets romantic hits',
      coverImage: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80',
    },
  ],
  energy: [
    {
      title: 'Punjabi Gym Workout Hits',
      description: 'High-octane Punjabi beats designed to push your limits',
      query: 'Punjabi Gym Workout Hits songs',
      coverImage: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Bollywood High Voltage Dance',
      description: 'High tempo, pulse-pounding Bollywood dance tracks',
      query: 'Bollywood High Voltage Dance songs',
      coverImage: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Desi Hip Hop Workout Beats',
      description: 'Hard-hitting Indian hip-hop and rap pump-up anthems',
      query: 'Desi Hip Hop Workout Beats songs',
      coverImage: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Bhangra Energy Gym',
      description: 'Relentless dhol grooves and explosive bhangra rhythms',
      query: 'Bhangra Energy Gym workout songs',
      coverImage: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80',
    },
  ],
  heartbreak: [
    {
      title: 'Soulful Sad Hindi Songs',
      description: 'Deep emotional melodies for contemplative solitude',
      query: 'Soulful Sad Hindi Songs emotional',
      coverImage: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Arijit Singh Heartbreak Essentials',
      description: 'The defining voice of soulful and poignant Bollywood ballads',
      query: 'Arijit Singh Heartbreak Essentials songs',
      coverImage: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Slowed Broken Heart Melodies',
      description: 'Slowed and reverb sorrowful tunes for late night healing',
      query: 'Slowed Broken Heart Melodies hindi',
      coverImage: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Dard Bhare Geet',
      description: 'Timeless grief and nostalgia from the golden ages of Hindi music',
      query: 'Dard Bhare Geet hindi songs',
      coverImage: 'https://images.unsplash.com/photo-1445985543470-41f30c08f107?w=500&auto=format&fit=crop&q=80',
    },
  ],
  desi_indie: [
    {
      title: 'Best of Indian Indie Pop',
      description: 'The fresh, vibrant sounds shaping independent Indian music',
      query: 'Best of Indian Indie Pop songs',
      coverImage: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Pakistani Indie & Pop Hits',
      description: 'Enchanting compositions and breakthrough tracks across the border',
      query: 'Pakistani Indie Pop Hits songs',
      coverImage: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Desi Singer-Songwriters',
      description: 'Intimate storytelling and acoustic guitar from indie artists',
      query: 'Desi Singer Songwriters indie hindi songs',
      coverImage: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Underground Indie India',
      description: 'Hidden gems and experimental indie sounds of the subcontinent',
      query: 'Underground Indie India songs',
      coverImage: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80',
    },
  ],
  nostalgia: [
    {
      title: '90s Golden Era Bollywood',
      description: 'Nostalgic chartbusters from the golden 1990s decade',
      query: '90s Golden Era Bollywood hits',
      coverImage: 'https://images.unsplash.com/photo-1485579149621-3123dd979885?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: '2000s Nostalgia Hindi Hits',
      description: 'The iconic childhood soundtracks and college anthems of the 2000s',
      query: '2000s Nostalgia Hindi Hits songs',
      coverImage: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'KK & Emraan Hashmi Era',
      description: 'The legendary combination that ruled every heart with passion',
      query: 'KK Emraan Hashmi era songs hits',
      coverImage: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Evergreen Kishore & Rafi',
      description: 'Immortal classics by the greatest musical legends of all time',
      query: 'Evergreen Kishore Rafi songs classic',
      coverImage: 'https://images.unsplash.com/photo-1445985543470-41f30c08f107?w=500&auto=format&fit=crop&q=80',
    },
  ],
  late_night: [
    {
      title: 'Late Night Drive Hindi',
      description: 'Atmospheric moody music for quiet midnight journeys',
      query: 'Late Night Drive Hindi songs',
      coverImage: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Midnight Desi Hip Hop & RnB',
      description: 'Smooth, nocturnal cadence and urban desi vibrations',
      query: 'Midnight Desi Hip Hop RnB songs',
      coverImage: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Slowed & Reverb Hindi Midnight',
      description: 'Immersive echoing vocals and hazy atmospheric reverbs',
      query: 'Slowed Reverb Hindi Midnight songs',
      coverImage: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Quiet Night Sukoon',
      description: 'Peaceful acoustic serenades to wind down your day',
      query: 'Quiet Night Sukoon peaceful songs',
      coverImage: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=500&auto=format&fit=crop&q=80',
    },
  ],
  party: [
    {
      title: 'Bollywood Club & Wedding Dance',
      description: 'The definitive desi wedding & party dancefloor anthems',
      query: 'Bollywood Club Wedding Dance songs',
      coverImage: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'All Time Punjabi Party Hits',
      description: 'Bhangra bangers and high-energy Punjabi club smashes',
      query: 'All Time Punjabi Party Hits songs',
      coverImage: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Desi Dancefloor Bangers',
      description: 'Electrifying beats crafted for non-stop celebrations',
      query: 'Desi Dancefloor Bangers songs',
      coverImage: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'High Bass Bollywood Party',
      description: 'Bass-heavy club remixes and high energy party starters',
      query: 'High Bass Bollywood Party songs',
      coverImage: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80',
    },
  ],
  focus: [
    {
      title: 'Indian Classical Sitar & Flute Instrumental',
      description: 'Meditative rāgas, sitar strings, and bamboo flute resonance',
      query: 'Indian Classical Sitar Flute Instrumental meditation',
      coverImage: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Hindi Acoustic Instrumental Study',
      description: 'Gentle guitar and piano arrangements of beloved melodies',
      query: 'Hindi Acoustic Instrumental Study music',
      coverImage: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Lofi Hindi Study Beats',
      description: 'Lo-fi chill beats with subtle Hindi vocal chops to stay in flow',
      query: 'Lofi Hindi Study Beats songs',
      coverImage: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Deep Focus Soundscapes',
      description: 'Ambient drone, peaceful textures, and uninterrupted clarity',
      query: 'Deep Focus Soundscapes ambient instrumental',
      coverImage: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop&q=80',
    },
  ],
  sufi: [
    {
      title: 'Coke Studio Sufi Classics',
      description: 'Transcendent spiritual journeys and legendary studio renditions',
      query: 'Coke Studio Sufi Classics songs',
      coverImage: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Nusrat & Rahat Fateh Ali Khan Essentials',
      description: 'Masterworks of ecstasy and qawwali devotion',
      query: 'Nusrat Rahat Fateh Ali Khan Essentials qawwali',
      coverImage: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Soulful Qawwali & Sufi Rock',
      description: 'Fusion of driving rock guitars with eternal mystic poetry',
      query: 'Soulful Qawwali Sufi Rock songs',
      coverImage: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Spiritual Sukoon Melodies',
      description: 'Inner peace through divine harmonies and acoustic devotion',
      query: 'Spiritual Sukoon Melodies sufi songs',
      coverImage: 'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=500&auto=format&fit=crop&q=80',
    },
  ],
  global: [
    {
      title: "Today's Top Global Hits",
      description: 'The biggest songs around the globe right now',
      query: "Today's Top Global Hits songs",
      coverImage: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Billboard Hot 100 English',
      description: 'Chart-dominating western pop, hip-hop, and hits',
      query: 'Billboard Hot 100 English songs',
      coverImage: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Viral Pop & RnB Essentials',
      description: 'Trending anthems making waves worldwide',
      query: 'Viral Pop RnB Essentials songs',
      coverImage: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Global Acoustic Hits',
      description: 'Stripped back global melodies and acoustic interpretations',
      query: 'Global Acoustic Hits unplugged pop',
      coverImage: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=500&auto=format&fit=crop&q=80',
    },
  ],
  acoustic: [
    {
      title: 'MTV Unplugged India',
      description: 'Iconic raw live acoustic performances from India’s greatest',
      query: 'MTV Unplugged India songs live',
      coverImage: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Raw Acoustic Bollywood Covers',
      description: 'Intimate guitar & vocal interpretations of timeless tracks',
      query: 'Raw Acoustic Bollywood Covers songs',
      coverImage: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Stripped Studio Sessions',
      description: 'Intimate studio microphone takes with pure acoustic warmth',
      query: 'Stripped Studio Sessions acoustic hindi',
      coverImage: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop&q=80',
    },
    {
      title: 'Guitar & Piano Acoustic Hindi',
      description: 'Delicate piano keys and fingerstyle acoustic guitar arrangements',
      query: 'Guitar Piano Acoustic Hindi songs',
      coverImage: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=80',
    },
  ],
};

const moodPlaylistCache: Record<string, Playlist[]> = {};

/**
 * Strategy E: 12-Mood Curated Playlists with YouTube Music mapping.
 * Pre-fetches, sanitizes, and caches 4 rich curated playlists per mood.
 */
export async function fetchMoodPlaylists(
  moodId: string,
  forceRefresh = false
): Promise<Playlist[]> {
  const normalizedMood = (moodId || 'chill').toLowerCase().trim();
  const defs = MOOD_PLAYLIST_DEFINITIONS[normalizedMood] || MOOD_PLAYLIST_DEFINITIONS.chill;

  if (!forceRefresh && moodPlaylistCache[normalizedMood]?.length) {
    return moodPlaylistCache[normalizedMood];
  }

  try {
    const playlists: Playlist[] = await Promise.all(
      defs.map(async (def, idx) => {
        let rawTracks = await searchTracks(def.query);
        if (!Array.isArray(rawTracks) || rawTracks.length === 0) {
          rawTracks = await searchTracks(def.title);
        }

        const seenIds = new Set<string>();
        const cleanedTracks: TrackMetadata[] = [];

        for (const t of rawTracks || []) {
          if (!t || !t.id) continue;
          const cleanId = String(t.id).replace(/^yt_/i, '').trim();
          if (!cleanId || seenIds.has(cleanId)) continue;
          seenIds.add(cleanId);

          const title = (t.title || 'Unknown Title')
            .replace(/[\(\[\{]?(official\s*(music\s*)?(video|audio|lyric\s*video|track|remix)?)[\)\]\}]?/gi, '')
            .trim();
          const artist = (t.artist || 'Artist').trim();

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
            artist: artist || 'Artist',
            artwork,
            duration: t.duration,
          });

          if (cleanedTracks.length >= 25) break;
        }

        const coverImage =
          cleanedTracks[0]?.artwork && !cleanedTracks[0].artwork.includes('placeholder')
            ? cleanedTracks[0].artwork
            : def.coverImage;

        const playlist: Playlist = {
          id: `curated_${normalizedMood}_${idx + 1}`,
          shareCode: `MOOD-${normalizedMood.toUpperCase().slice(0, 4)}-${idx + 1}`,
          name: def.title,
          description: def.description,
          createdAt: Date.now(),
          coverImage,
          tracks: cleanedTracks.length > 0 ? cleanedTracks : FALLBACK_RESULTS,
          isImported: true,
        };

        return playlist;
      })
    );

    if (playlists.length > 0) {
      moodPlaylistCache[normalizedMood] = playlists;
      return playlists;
    }
  } catch (err) {
    console.error(`[musicApi] Error fetching mood playlists for ${normalizedMood}:`, err);
  }

  if (moodPlaylistCache[normalizedMood]?.length) {
    return moodPlaylistCache[normalizedMood];
  }

  return defs.map((def, idx) => ({
    id: `curated_${normalizedMood}_${idx + 1}`,
    shareCode: `MOOD-${normalizedMood.toUpperCase().slice(0, 4)}-${idx + 1}`,
    name: def.title,
    description: def.description,
    createdAt: Date.now(),
    coverImage: def.coverImage,
    tracks: FALLBACK_RESULTS,
    isImported: true,
  }));
}




