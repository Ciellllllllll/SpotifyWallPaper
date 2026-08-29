import { describe, expect, it } from 'vitest';
import { dominantColorFromImageData, extractAlbumTheme } from './extractAlbumTheme';

type ThemeWithDominantColor = Awaited<ReturnType<typeof extractAlbumTheme>> & { dominantColor?: string };

describe('extractAlbumTheme', () => {
  it('falls back deterministically when browser image APIs are unavailable or image loading fails', async () => {
    const first = await extractAlbumTheme('', 'missing-image') as ThemeWithDominantColor;
    const second = await extractAlbumTheme('', 'missing-image') as ThemeWithDominantColor;

    expect(first).toEqual(second);
    expect(first.source).toBe('fallback');
    expect(first.dominantColor).toBeUndefined();
  });

  it('selects the most frequent non-extreme quantized album color', () => {
    const data = new Uint8ClampedArray([
      32, 160, 224, 255,
      32, 160, 224, 255,
      32, 160, 224, 255,
      32, 160, 224, 255,
      208, 208, 208, 255,
      0, 0, 0, 255
    ]);

    expect(dominantColorFromImageData(data)).toBe('#20a0e0');
  });

  it('returns white when no eligible pixels remain', () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      40, 40, 40, 0
    ]);

    expect(dominantColorFromImageData(data)).toBe('#ffffff');
  });
});
