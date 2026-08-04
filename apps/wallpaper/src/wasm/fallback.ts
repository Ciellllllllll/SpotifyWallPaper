import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import type { ReadabilityResult } from './visualCore';

export const normalizeSamplesFallback = (
  current: number[],
  previous: number[],
  settings: WallpaperPreferences['visualizer']
): { samples: number[]; peak: number } => {
  const clampMax = Math.max(0.0001, settings.clampMax);
  const noiseGate = Math.min(clampMax, Math.max(0, settings.noiseGate));
  const smoothing = Math.min(1, Math.max(0, settings.smoothing));
  const decay = Math.min(1, Math.max(0, settings.decay));
  const length = Math.max(current.length, previous.length);
  const samples: number[] = [];
  let peak = 0;

  for (let index = 0; index < length; index += 1) {
    const raw = current[index] ?? 0;
    const previousSample = previous[index] ?? 0;
    const clamped = Number.isFinite(raw) ? Math.min(clampMax, Math.max(0, raw)) / clampMax : 0;
    const gated = clamped < noiseGate / clampMax ? 0 : clamped;
    const smoothed = previousSample * smoothing + gated * (1 - smoothing);
    const decayed = Math.max(smoothed, previousSample * (1 - decay));
    peak = Math.max(peak, decayed);
    samples.push(decayed);
  }

  return { samples: samples.length > 0 ? samples : [0], peak };
};

export const readabilityFallback = (r: number, g: number, b: number): ReadabilityResult => {
  const background = { r, g, b };
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const whiteRatio = contrastRatio(background, white);
  const blackRatio = contrastRatio(background, black);
  const text = whiteRatio >= blackRatio ? white : black;
  return {
    text,
    overlayOpacity: Math.max(whiteRatio, blackRatio) < 4.5 ? 0.42 : 0.18,
    shadowStrength: text === white ? 0.7 : 0.25,
    contrastRatio: Math.max(whiteRatio, blackRatio)
  };
};

const contrastRatio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number => {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
};

const relativeLuminance = ({ r, g, b }: { r: number; g: number; b: number }): number => {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
