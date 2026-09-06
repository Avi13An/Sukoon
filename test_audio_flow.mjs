const ANDROID_UA = 'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';

async function resolveAudioStreamDirect(videoId) {
  const payload = {
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

  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false&alt=json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ANDROID_UA
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`YouTube player API returned status ${res.status}`);
  const data = await res.json();
  const formats = data.streamingData?.formats || [];
  const adaptive = data.streamingData?.adaptiveFormats || [];

  const f18 = formats.find((f) => f.itag === 18 && typeof f.url === 'string') || 
              formats.find((f) => typeof f.url === 'string' && f.url.startsWith('http'));
  if (f18?.url) return f18.url;

  const a140 = adaptive.find((f) => f.itag === 140 && typeof f.url === 'string');
  if (a140?.url) return a140.url;

  const audioMp4 = adaptive.find((f) => f.mimeType?.includes('audio/mp4') && typeof f.url === 'string');
  if (audioMp4?.url) return audioMp4.url;

  const anyAudio = adaptive.find((f) => f.mimeType?.includes('audio') && typeof f.url === 'string' && f.url.startsWith('http'));
  if (anyAudio?.url) return anyAudio.url;

  throw new Error('No playable audio/video stream URL found in streamingData');
}

async function main() {
  const videoId = '18hNLT_xgaE';
  console.log(`[TEST] Resolving audio stream for videoId: ${videoId}...`);
  const streamUrl = await resolveAudioStreamDirect(videoId);
  console.log(`[TEST] Resolved stream URL: ${streamUrl.slice(0, 80)}...`);

  console.log(`[TEST] Sending HTTP GET with Range: bytes=0-65535 and Android User-Agent...`);
  const streamRes = await fetch(streamUrl, {
    headers: {
      'User-Agent': ANDROID_UA,
      'Range': 'bytes=0-65535'
    }
  });

  const status = streamRes.status;
  const contentType = streamRes.headers.get('content-type') || '';
  const contentRange = streamRes.headers.get('content-range') || 'N/A';
  const buffer = await streamRes.arrayBuffer();
  const bytesReceived = buffer.byteLength;

  console.log(`[TEST] HTTP Status: ${status}`);
  console.log(`[TEST] Content-Type: ${contentType}`);
  console.log(`[TEST] Content-Range: ${contentRange}`);
  console.log(`[TEST] Bytes Received: ${bytesReceived}`);

  const isStatusValid = status === 200 || status === 206;
  const isTypeValid = contentType.includes('audio') || contentType.includes('video') || contentType.includes('mp4');
  const hasBytes = bytesReceived > 0;

  if (isStatusValid && isTypeValid && hasBytes) {
    console.log(`\n======================================================`);
    console.log(`[LOCAL STREAM TEST] SUCCESS: Status ${status}, ${bytesReceived} bytes received (${contentType})`);
    console.log(`======================================================`);
    process.exit(0);
  } else {
    console.error(`\n[LOCAL STREAM TEST] FAIL: Status ${status}, Content-Type ${contentType}, Bytes ${bytesReceived}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[LOCAL STREAM TEST] ERROR:', err);
  process.exit(1);
});
