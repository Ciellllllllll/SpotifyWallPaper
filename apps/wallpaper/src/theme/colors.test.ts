import { describe, expect, it } from 'vitest';
import { fallbackThemeFromSeed, hexToRgb, readableTextColor, rgbToHex, themeFromPrimary } from './colors';

describe('theme color helpers', () => {
  it('converts hex and rgb values', () => {
    expect(hexToRgb('#102a44')).toEqual({ r: 16, g: 42, b: 68 });
    expect(rgbToHex({ r: 16, g: 42, b: 68 })).toBe('#102a44');
    expect(hexToRgb('not-a-color')).toBeNull();
  });

  it('chooses readable text for bright and dark colors', () => {
    expect(readableTextColor({ r: 245, g: 240, b: 230 }).color).toBe('#000000');
    expect(readableTextColor({ r: 8, g: 12, b: 18 }).color).toBe('#ffffff');
  });

  it('generates deterministic fallback themes from a seed', () => {
    expect(fallbackThemeFromSeed('track-a')).toEqual(fallbackThemeFromSeed('track-a'));
    expect(fallbackThemeFromSeed('track-a')).not.toEqual(fallbackThemeFromSeed('track-b'));
  });

  it('generates full theme values from a primary color', () => {
    const theme = themeFromPrimary({ r: 80, g: 120, b: 160 }, 'fallback');

    expect(theme.primaryColor).toBe('#5078a0');
    expect(theme.accentColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.readableTextColor).toMatch(/^#(ffffff|000000)$/);
    expect(theme.overlayOpacity).toBeGreaterThan(0);
  });
});
