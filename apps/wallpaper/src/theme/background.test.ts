import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaultSettings';
import { fallbackThemeFromSeed } from './colors';
import { buildBackgroundStyle, buildThemeCssVariables } from './background';

const theme = fallbackThemeFromSeed('background-test');

describe('background style generation', () => {
  it('builds album blur style from album image', () => {
    const style = buildBackgroundStyle(defaultSettings, theme, '/mock/album-placeholder.svg');

    expect(style).toContain("url('/mock/album-placeholder.svg')");
    expect(style).toContain('filter: blur(30px)');
    expect(style).toContain('opacity: 0.62');
  });

  it('builds album gradient style without album image processing', () => {
    const style = buildBackgroundStyle(
      { ...defaultSettings, background: { ...defaultSettings.background, mode: 'album-gradient' } },
      theme,
      '/mock/album-placeholder.svg'
    );

    expect(style).toContain('linear-gradient(135deg');
    expect(style).not.toContain("url('/mock/album-placeholder.svg')");
  });

  it('builds solid color style', () => {
    const style = buildBackgroundStyle(
      { ...defaultSettings, background: { ...defaultSettings.background, mode: 'solid-color', solidColor: '#123456' } },
      theme,
      '/mock/album-placeholder.svg'
    );

    expect(style).toBe('background: #123456; opacity: 0.62');
  });

  it('exports theme CSS variables', () => {
    expect(buildThemeCssVariables(theme)).toContain('--theme-primary:');
    expect(buildThemeCssVariables(theme)).toContain('--theme-text:');
  });
});
