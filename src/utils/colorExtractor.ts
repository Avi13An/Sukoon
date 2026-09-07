import { TrackMetadata } from './storage';

export interface AmbientTheme {
  primary: string;
  accent: string;
  gradient: [string, string, string];
}

// Curated palette of deep, aesthetic ambient colors that complement pure AMOLED black (#000000)
const AMBIENT_PALETTES: AmbientTheme[] = [
  { primary: '#0a2e2a', accent: '#00ffcc', gradient: ['#0d3832', '#061715', '#000000'] }, // Neon Teal / Emerald
  { primary: '#2a1236', accent: '#d946ef', gradient: ['#381549', '#17071e', '#000000'] }, // Deep Violet / Magenta
  { primary: '#12233f', accent: '#38bdf8', gradient: ['#162e54', '#091322', '#000000'] }, // Midnight Blue / Cyan
  { primary: '#381616', accent: '#f87171', gradient: ['#4d1d1d', '#1f0a0a', '#000000'] }, // Crimson Velvet
  { primary: '#301e0a', accent: '#fbbf24', gradient: ['#442b0d', '#1a0e03', '#000000'] }, // Warm Amber / Sunset
  { primary: '#1c1538', accent: '#a78bfa', gradient: ['#281e4f', '#0f0a21', '#000000'] }, // Deep Indigo / Lavender
  { primary: '#13281f', accent: '#34d399', gradient: ['#1a3d2e', '#091913', '#000000'] }, // Forest Jade
  { primary: '#331526', accent: '#fb7185', gradient: ['#481d36', '#1a0913', '#000000'] }, // Rose Noir
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export function getAmbientThemeForTrack(track?: TrackMetadata | null): AmbientTheme {
  if (!track || (!track.id && !track.title)) {
    return AMBIENT_PALETTES[0];
  }
  const key = `${track.id || ''}_${track.title || ''}_${track.artist || ''}`;
  const index = hashString(key) % AMBIENT_PALETTES.length;
  return AMBIENT_PALETTES[index];
}

export function getAmbientColorForTrack(track?: TrackMetadata | null): string {
  return getAmbientThemeForTrack(track).primary;
}
