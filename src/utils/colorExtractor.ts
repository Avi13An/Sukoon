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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  h = (h % 360) / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function sanitizeToDarkJewelTone(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#0f2b5c';

  let { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  if (s < 65) {
    s = 80;
  }
  if (l > 30) {
    l = 22;
  }
  if (l < 12) {
    l = 18;
  }

  l = Math.max(16, Math.min(26, l));
  s = Math.max(75, Math.min(95, s));

  return hslToHex(h, s, l);
}

export function boostAmbientColor(rawColor?: string, seedString?: string): string {
  const richAestheticPalette = [
    '#0f2b5c', // Electric Sapphire Blue
    '#4a0a18', // Deep Crimson Wine
    '#053d2c', // Deep Emerald Jade
    '#3b0a45', // Neon Cyberpunk Magenta
    '#043942', // Electric Cyan Teal
    '#2b0d52', // Royal Velvet Violet
    '#4d1806', // Warm Molten Amber / Copper
    '#15114a', // Midnight Cosmic Indigo
    '#4a082b', // Neon Berry Plum
    '#4a1508', // Deep Electric Blood Orange
    '#07384a', // Vivid Deep Lagoon
    '#210738', // Dark Amethyst
    '#063b36', // Luminous Pine Teal
    '#470c1b', // Ruby Rose
  ];

  if (!rawColor || rawColor === '#000000' || rawColor === '#ffffff') {
    if (seedString) {
      let hash = 0;
      for (let i = 0; i < seedString.length; i++) {
        hash = seedString.charCodeAt(i) + ((hash << 5) - hash);
        hash |= 0;
      }
      return richAestheticPalette[Math.abs(hash) % richAestheticPalette.length];
    }
    return richAestheticPalette[0];
  }

  return sanitizeToDarkJewelTone(rawColor);
}

