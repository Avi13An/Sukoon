import { TrackMetadata as Track } from '../utils/storage';
import { sanitizeTrack } from '../utils/trackSanitizer';

interface YTMNextResponse {
  contents?: {
    singleColumnMusicWatchNextResultsRenderer?: {
      tabbedRenderer?: {
        watchNextTabbedResultsRenderer?: {
          tabs?: Array<{
            tabRenderer?: {
              content?: {
                musicQueueRenderer?: {
                  content?: {
                    playlistPanelRenderer?: {
                      contents?: Array<{
                        playlistPanelVideoRenderer?: any;
                      }>;
                    };
                  };
                };
              };
            };
          }>;
        };
      };
    };
  };
  continuationContents?: {
    playlistPanelContinuation?: {
      contents?: Array<{
        playlistPanelVideoRenderer?: any;
      }>;
    };
  };
}

/**
 * Fetches genuine YouTube Music Automix Radio tracks for a given videoId
 * Uses YouTube Music's RDAMVM playlist endpoint
 */
export async function fetchYouTubeMusicAutomix(videoId: string): Promise<Track[]> {
  if (!videoId || typeof videoId !== 'string') return [];

  const cleanVideoId = videoId.replace(/^yt_/i, '').trim();
  const playlistId = `RDAMVM${cleanVideoId}`;

  try {
    const response = await fetch('https://music.youtube.com/youtubei/v1/next?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-YouTube-Client-Name': '67', // WEB_REMIX
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
            gl: 'US',
          },
        },
        videoId: cleanVideoId,
        playlistId: playlistId,
        isAudioOnly: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`InnerTube next HTTP ${response.status}`);
    }

    const data: YTMNextResponse = await response.json();
    const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer
      ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;

    const queueContent = tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer
      ?.content?.playlistPanelRenderer?.contents ||
      data?.continuationContents?.playlistPanelContinuation?.contents;

    if (!Array.isArray(queueContent) || queueContent.length === 0) {
      return [];
    }

    const tracks: Track[] = [];

    for (const item of queueContent) {
      const renderer = item.playlistPanelVideoRenderer;
      if (!renderer || !renderer.videoId) continue;

      // Extract title
      const title = renderer.title?.runs?.[0]?.text || 'Unknown Title';

      // Extract artist
      const artist = renderer.shortBylineText?.runs?.map((r: any) => r.text).join('') ||
        renderer.longBylineText?.runs?.map((r: any) => r.text).join('') ||
        'Unknown Artist';

      // Extract thumbnail
      const thumbnails = renderer.thumbnail?.thumbnails;
      const artwork = thumbnails && thumbnails.length > 0
        ? thumbnails[thumbnails.length - 1].url
        : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400';

      // Extract duration in seconds
      let duration = 0;
      const durationText = renderer.lengthText?.runs?.[0]?.text;
      if (durationText) {
        const parts = durationText.split(':').map(Number);
        if (parts.length === 2) duration = parts[0] * 60 + parts[1];
        else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }

      const sanitized = sanitizeTrack({
        id: renderer.videoId,
        title,
        artist,
        artwork,
        duration,
        url: '', // Stream URL resolved on-demand when track is about to play
      });

      tracks.push(sanitized);
    }

    return tracks;
  } catch (err) {
    console.warn('[YouTubeRadioService] Automix fetch error:', err);
    return [];
  }
}
