import type { WallpaperTheme } from '@spotify-wallpaper/shared-types';
import { fallbackThemeFromSeed, themeFromPrimary, type Rgb } from './colors';

const SAMPLE_SIZE = 32;
const COLOR_BUCKET_SIZE = 16;
const MIN_ALPHA = 0.35;
const BLACK_THRESHOLD = 24;
const WHITE_THRESHOLD = 232;
type ThemeWithDominantColor = WallpaperTheme & { dominantColor?: string };

export const extractAlbumTheme = async (imageUrl: string, seed: string): Promise<WallpaperTheme> => {
  if (!imageUrl || typeof Image === 'undefined' || typeof document === 'undefined') {
    return fallbackThemeFromSeed(seed);
  }

  try {
    const image = await loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return fallbackThemeFromSeed(seed);
    }

    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const data = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    return {
      ...themeFromPrimary(averageImageData(data), 'extracted'),
      dominantColor: dominantColorFromImageData(data)
    } as ThemeWithDominantColor;
  } catch {
    return fallbackThemeFromSeed(seed);
  }
};

export const dominantColorFromImageData = (data: Uint8ClampedArray): string => {
  const buckets = new Map<string, number>();
  for (let index = 0; index + 3 < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    if (alpha < MIN_ALPHA) continue;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    if (maximum <= BLACK_THRESHOLD || minimum >= WHITE_THRESHOLD) continue;
    const bucket = [r, g, b].map((channel) => Math.floor(channel / COLOR_BUCKET_SIZE) * COLOR_BUCKET_SIZE);
    const key = bucket.join(',');
    buckets.set(key, (buckets.get(key) ?? 0) + alpha);
  }

  let winner = '#ffffff';
  let highestWeight = 0;
  for (const [key, weight] of buckets) {
    if (weight <= highestWeight) continue;
    const [r, g, b] = key.split(',').map(Number);
    winner = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
    highestWeight = weight;
  }
  return winner;
};

const loadImage = (imageUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('album image failed to load'));
    image.src = imageUrl;
  });

const averageImageData = (data: Uint8ClampedArray): Rgb => {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    if (alpha <= 0) {
      continue;
    }

    r += data[index] * alpha;
    g += data[index + 1] * alpha;
    b += data[index + 2] * alpha;
    count += alpha;
  }

  if (count === 0) {
    return { r: 34, g: 38, b: 46 };
  }

  return { r: r / count, g: g / count, b: b / count };
};
