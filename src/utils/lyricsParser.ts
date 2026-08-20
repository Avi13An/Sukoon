export interface SyncedLyricLine {
  time: number;
  text: string;
}

export function parseSyncedLyrics(syncedLyrics: string): SyncedLyricLine[] {
  const lines = syncedLyrics.split('\n');
  const parsed: SyncedLyricLine[] = [];
  
  // Matches [mm:ss.xx] or [mm:ss.xxx]
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  
  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3], 10);
      
      // Calculate total seconds. If milliseconds has 2 digits, multiply by 10 (e.g., .12 is 120ms)
      const msMultiplier = match[3].length === 2 ? 10 : 1;
      const timeInSeconds = minutes * 60 + seconds + (milliseconds * msMultiplier) / 1000;
      
      const text = line.replace(timeRegex, '').trim();
      parsed.push({ time: timeInSeconds, text });
    }
  }
  
  return parsed;
}
