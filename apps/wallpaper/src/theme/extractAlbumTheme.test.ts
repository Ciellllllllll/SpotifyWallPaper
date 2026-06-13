import { describe, expect, it } from 'vitest';
import { extractAlbumTheme } from './extractAlbumTheme';

describe('extractAlbumTheme', () => {
  it('falls back deterministically when browser image APIs are unavailable or image loading fails', async () => {
    const first = await extractAlbumTheme('', 'missing-image');
    const second = await extractAlbumTheme('', 'missing-image');

    expect(first).toEqual(second);
    expect(first.source).toBe('fallback');
  });
});
