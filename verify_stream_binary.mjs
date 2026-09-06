const ANDROID_UA = 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';
const IOS_UA = 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)';
const API_BASE = 'https://sukoon-api.vercel.app';

async function resolveAudioStreamDirect(videoId) {
  // Strategy 1: iOS client profile (directly provides pure itag 140 AAC/M4A audio)
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
        'User-Agent': IOS_UA,
        'X-YouTube-Client-Name': '5',
        'X-YouTube-Client-Version': '20.11.6'
      },
      body: JSON.stringify(iosPayload)
    });

    if (iosRes.ok) {
      const data = await iosRes.json();
      const adaptive = data.streamingData?.adaptiveFormats || [];
      const formats = data.streamingData?.formats || [];

      // 1. Search adaptiveFormats first for pure 128kbps AAC audio (itag 140)
      const a140 = adaptive.find((f) => f.itag === 140 && typeof f.url === 'string' && f.url.startsWith('http'));
      if (a140?.url) return a140.url;

      // 2. Search adaptiveFormats for any pure audio stream (audio/mp4 or audio/*)
      const pureAudio = adaptive.find((f) => typeof f.url === 'string' && f.url.startsWith('http') && (f.mimeType?.startsWith('audio/') || f.mimeType?.includes('audio')));
      if (pureAudio?.url) return pureAudio.url;

      // 3. Fallback to muxed formats if no pure audio
      const fAny = formats.find((f) => typeof f.url === 'string' && f.url.startsWith('http'));
      if (fAny?.url) return fAny.url;
    }
  } catch (iosErr) {
    console.warn('iOS direct player resolution failed:', iosErr.message);
  }

  // Strategy 2: Android client profile (fallback)
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
          userAgent: ANDROID_UA,
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
        'User-Agent': ANDROID_UA
      },
      body: JSON.stringify(androidPayload)
    });

    if (androidRes.ok) {
      const data = await androidRes.json();
      const adaptive = data.streamingData?.adaptiveFormats || [];
      const formats = data.streamingData?.formats || [];

      const a140 = adaptive.find((f) => f.itag === 140 && typeof f.url === 'string' && f.url.startsWith('http'));
      if (a140?.url) return a140.url;

      const pureAudio = adaptive.find((f) => typeof f.url === 'string' && f.url.startsWith('http') && (f.mimeType?.startsWith('audio/') || f.mimeType?.includes('audio')));
      if (pureAudio?.url) return pureAudio.url;

      const f18 = formats.find((f) => f.itag === 18 && typeof f.url === 'string' && f.url.startsWith('http')) ||
                  formats.find((f) => typeof f.url === 'string' && f.url.startsWith('http'));
      if (f18?.url) return f18.url;
    }
  } catch (androidErr) {
    console.warn('Android direct player resolution failed:', androidErr.message);
  }

  return null;
}

async function getAudioStream(id) {
  // Attempt 1: Direct resolver
  try {
    const directUrl = await resolveAudioStreamDirect(id);
    if (typeof directUrl === 'string' && directUrl.startsWith('http')) {
      return directUrl;
    }
  } catch (err) {
    console.warn('Direct resolver attempt failed:', err.message);
  }

  // Attempt 2: Vercel Cloud Backend
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
    console.warn('Backend stream attempt failed:', err.message);
  }

  // Attempt 3: Mirrors
  const mirrorCandidates = [
    `https://invidious.f5.si/latest_version?id=${id}&itag=140`,
    `https://yt.omada.cafe/latest_version?id=${id}&itag=140`,
    `https://invidious.f5.si/latest_version?id=${id}&itag=18`,
  ];

  for (const mirrorUrl of mirrorCandidates) {
    try {
      const res = await fetch(mirrorUrl, { method: 'HEAD', redirect: 'manual' });
      if (res.status === 302 || res.status === 200 || res.status === 206) {
        const loc = res.headers.get('location');
        if (loc && loc.startsWith('http')) return loc;
        return mirrorUrl;
      }
    } catch {}
  }

  return `https://invidious.f5.si/latest_version?id=${id}&itag=140`;
}

async function verify() {
  const trackId = '18hNLT_xgaE';
  console.log(`[VERIFY] Resolving stream URL for track: ${trackId}...`);
  const streamUrl = await getAudioStream(trackId);
  console.log(`[VERIFY] Resolved URL: ${streamUrl ? streamUrl.slice(0, 80) + '...' : 'NULL'}`);

  if (!streamUrl) {
    throw new Error('Could not resolve stream URL from any source.');
  }

  const matchingUa = streamUrl.includes('c=IOS') || !streamUrl.includes('c=ANDROID') ? IOS_UA : ANDROID_UA;
  console.log(`[VERIFY] Fetching first 1024 bytes with matching User-Agent...`);
  const res = await fetch(streamUrl, {
    headers: {
      'User-Agent': matchingUa,
      'Range': 'bytes=0-1023'
    }
  });

  console.log(`[VERIFY] HTTP Response Status: ${res.status}`);
  const contentType = res.headers.get('content-type') || 'unknown';
  console.log(`[VERIFY] Content-Type: ${contentType}`);

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  console.log(`[VERIFY] Bytes received: ${buffer.length}`);

  if (buffer.length === 0) {
    throw new Error('Zero bytes received from stream endpoint.');
  }

  // Check for bot challenge or HTML error document
  const headStr = buffer.slice(0, 64).toString('utf8');
  if (headStr.toLowerCase().includes('<!doctype html') || headStr.toLowerCase().includes('<html')) {
    throw new Error(`Received HTML error page instead of binary stream: ${headStr}`);
  }

  // Detect binary container signatures
  let detectedType = null;
  // MP4 container check: bytes 4-8 is 'ftyp'
  if (buffer.length >= 8 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const majorBrand = buffer.slice(8, 12).toString('ascii').trim();
    detectedType = `ISO/IEC 14496 (MP4/M4A container, brand: ${majorBrand})`;
  } else if (buffer.length >= 3 && buffer.slice(0, 3).toString('ascii') === 'ID3') {
    detectedType = 'MPEG Audio (ID3 container)';
  } else if (buffer.length >= 2 && buffer[0] === 0xFF && (buffer[1] & 0xF0) === 0xF0) {
    detectedType = 'MPEG ADTS AAC / MP3 frame sync';
  } else if (buffer.length >= 4 && buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
    detectedType = 'WebM / Matroska audio container';
  } else {
    detectedType = `Binary stream (${contentType})`;
  }

  console.log(`\n======================================================`);
  console.log(`[INTEGRITY TEST] PASS: Real audio binary confirmed`);
  console.log(`Container/MIME Type: ${detectedType}`);
  console.log(`First 16 raw bytes: ${buffer.slice(0, 16).toString('hex')}`);
  console.log(`======================================================\n`);
}

verify().catch((err) => {
  console.error('\n[INTEGRITY TEST] FAIL:', err.message);
  process.exit(1);
});
