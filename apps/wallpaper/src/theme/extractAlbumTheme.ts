import type { WallpaperTheme } from '@spotify-wallpaper/shared-types';
import { fallbackThemeFromSeed, themeFromPrimary, type Rgb } from './colors';

const SAMPLE_SIZE = 32;

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
    return themeFromPrimary(averageImageData(data), 'extracted');
  } catch {
    return fallbackThemeFromSeed(seed);
  }
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
