import type { WallpaperTheme } from '@spotify-wallpaper/shared-types';
import { readabilityWithCore } from '../wasm/visualCore';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const hexToRgb = (hex: string): Rgb | null => {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
};

export const rgbToHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`;

export const mix = (a: Rgb, b: Rgb, amount: number): Rgb => ({
  r: a.r + (b.r - a.r) * amount,
  g: a.g + (b.g - a.g) * amount,
  b: a.b + (b.b - a.b) * amount
});

export const luminance = (color: Rgb): number => {
  const channel = (value: number) => {
    const next = value / 255;
    return next <= 0.03928 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
};

export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
};

export const readableTextColor = (background: Rgb): { color: string; contrast: number } => {
  const core = readabilityWithCore(background.r, background.g, background.b);
  if (core) {
    return {
      color: rgbToHex(core.text),
      contrast: core.contrastRatio
    };
  }

  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const whiteContrast = contrastRatio(background, white);
  const blackContrast = contrastRatio(background, black);

  return whiteContrast >= blackContrast
    ? { color: '#ffffff', contrast: whiteContrast }
    : { color: '#000000', contrast: blackContrast };
};

export const fallbackThemeFromSeed = (seed: string): WallpaperTheme => {
  const hash = hashString(seed || 'spotify-wallpaper');
  const primary = hslToRgb(hash % 360, 52, 44);
  return themeFromPrimary(primary, 'fallback');
};

export const themeFromPrimary = (primary: Rgb, source: WallpaperTheme['source']): WallpaperTheme => {
  const dark = mix(primary, { r: 0, g: 0, b: 0 }, 0.64);
  const light = mix(primary, { r: 255, g: 255, b: 255 }, 0.58);
  const secondary = mix(primary, { r: 35, g: 42, b: 54 }, 0.35);
  const accent = mix(primary, { r: 248, g: 215, b: 120 }, 0.45);
  const muted = mix(primary, { r: 128, g: 138, b: 150 }, 0.55);
  const readable = readableTextColor(dark);

  return {
    primaryColor: rgbToHex(primary),
    secondaryColor: rgbToHex(secondary),
    accentColor: rgbToHex(accent),
    mutedColor: rgbToHex(muted),
    darkColor: rgbToHex(dark),
    lightColor: rgbToHex(light),
    readableTextColor: readable.color,
    overlayOpacity: readable.contrast < 4.5 ? 0.46 : 0.28,
    shadowStrength: readable.color === '#ffffff' ? 0.72 : 0.28,
    source
  };
};

const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];

  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
};
