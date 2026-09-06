import express from 'express';
import cors from 'cors';
import { Innertube, UniversalCache } from 'youtubei.js';
import { createColdStartToken } from 'bgutils-js/webpo';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let ytInstance = null;
let ytAndroidInstance = null;

async function getYt() {
  if (!ytInstance) {
    ytInstance = await Innertube.create({
      cache: new UniversalCache(false),
      retrieve_player: false,
      location: 'IN',
      gl: 'IN',
      hl: 'en'
    });
  }
  return ytInstance;
}

async function getYtAndroid() {
  if (!ytAndroidInstance) {
    ytAndroidInstance = await Innertube.create({
      cache: new UniversalCache(false),
      retrieve_player: false,
      generate_session_locally: true,
      client_type: 'ANDROID',
      user_agent: 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip',
      location: 'IN',
      gl: 'IN',
      hl: 'en'
    });
  }
  return ytAndroidInstance;
}

async function handleSearch(req, res) {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing query parameter q' });

    const yt = await getYt();
    let rawItems = [];

    try {
      const results = await yt.music.search(query, { type: 'song' });
      if (Array.isArray(results.songs?.contents)) {
        rawItems = results.songs.contents;
      } else if (Array.isArray(results.songs)) {
        rawItems = results.songs;
      } else if (Array.isArray(results.contents)) {
        const shelf = results.contents.find((c) => c.type === 'MusicShelf' || c.contents);
        rawItems = shelf?.contents || results.contents;
      }
    } catch (e) {
      console.warn('Music search fallback:', e.message);
    }

    if (!rawItems || rawItems.length === 0) {
      const generalResults = await yt.search(query, { type: 'video' });
      rawItems = generalResults.videos || generalResults.results || [];
    }

    const songs = rawItems
      .map((item) => {
        const id = item.id || item.videoId;
        const title =
          typeof item.title === 'string'
            ? item.title
            : item.title?.text || item.title?.toString() || 'Unknown Title';

        let artist = 'Unknown Artist';
        if (Array.isArray(item.artists)) {
          artist = item.artists.map((a) => a.name).filter(Boolean).join(', ');
        } else if (item.author?.name) {
          artist = item.author.name;
        } else if (item.author) {
          artist = typeof item.author === 'string' ? item.author : item.author.text || 'Unknown Artist';
        }

        const rawThumb = item.thumbnails?.[0]?.url || item.thumbnail?.url || '';
        const artwork = rawThumb ? rawThumb.replace(/w\d+-h\d+/, 'w500-h500') : '';

        return { id, title, artist, artwork };
      })
      .filter((song) => Boolean(song.id));

    return res.json(songs);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function resolveDirectAudio(id) {
  const errors = [];

  // Strategy 1: Local Android session execution
  try {
    const yt = await getYtAndroid();
    const res = await yt.actions.execute('/player', { videoId: id });
    const playStatus = res.data?.playabilityStatus?.status;
    const reason = res.data?.playabilityStatus?.reason;
    const formats = res.data?.streamingData?.formats || [];
    const adaptive = res.data?.streamingData?.adaptiveFormats || [];

    const f18 = formats.find((f) => f.itag === 18 && f.url) || formats.find((f) => f.url);
    if (f18?.url) {
      return f18.url;
    }

    errors.push(`ANDROID_LOCAL: status=${playStatus} reason=${reason || ''} formats=${formats.length} adapt=${adaptive.length}`);
  } catch (e) {
    errors.push(`ANDROID_LOCAL err: ${e.message}`);
  }

  // Strategy 2: Fallback with standard yt session
  try {
    const yt = await getYt();
    const visitorData = yt.session.context.client.visitorData;
    const pot = createColdStartToken(visitorData);
    const info = await yt.getBasicInfo(id, { client: 'ANDROID', po_token: pot });
    const f18 = info.streaming_data?.formats?.find((f) => f.itag === 18 && f.url) || info.streaming_data?.formats?.find((f) => f.url);
    if (f18?.url) {
      return f18.url;
    }
    errors.push(`BASIC_INFO: status=${info.playability_status?.status} reason=${info.playability_status?.reason || ''}`);
  } catch (e) {
    errors.push(`BASIC_INFO err: ${e.message}`);
  }

  const err = new Error('Audio stream resolution failed');
  err.details = errors;
  throw err;
}

async function handleStream(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });

  try {
    const directUrl = await resolveDirectAudio(id);
    return res.json({ url: directUrl });
  } catch (err) {
    return res.status(502).json({
      error: 'Audio stream resolution failed.',
      details: err.details || err.message
    });
  }
}

async function handleAudioRedirect(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).send('Missing id');

  try {
    const directUrl = await resolveDirectAudio(id);
    return res.redirect(302, directUrl);
  } catch (err) {
    return res.status(502).send('Failed to resolve stream: ' + err.message);
  }
}

function handleUserClaim(req, res) {
  const username = req.body?.username || req.query?.username || req.body?.user || 'user';
  return res.status(200).json({
    success: true,
    user: {
      id: 'usr_' + Date.now(),
      username: typeof username === 'string' ? username.trim().toLowerCase() : 'user',
      created_at: new Date().toISOString()
    }
  });
}

app.get('/search', handleSearch);
app.get('/stream', handleStream);
app.get('/audio', handleAudioRedirect);
app.all(['/claim-username', '/api/claim-username', '/api/user', '/user', '/auth'], handleUserClaim);

app.all(['/', '/index.js'], (req, res) => {
  if (req.query.q) return handleSearch(req, res);
  if (req.query.id && (req.query.audio || req.path.includes('/audio') || req.url.includes('/audio'))) {
    return handleAudioRedirect(req, res);
  }
  if (req.query.id) return handleStream(req, res);
  if (req.body?.username || req.query?.username) return handleUserClaim(req, res);
  return res.json({ status: 'Sukoon Engine Active' });
});

export default app;
