import { describe, expect, it } from 'vitest';
import { defaultWallpaperPreferences } from '@spotify-wallpaper/shared-types';
import { effectiveVisualizerConfig, visualizerRingRadius, visualizerStyleVariables } from './visualizerStyle';

describe('wallpaper view visualizer presentation contract', () => {
  it('maps visualizer presentation settings to CSS variables', () => {
    const settings = defaultWallpaperPreferences().visualizer;
    const theme = {
      primaryColor: '#112233',
      secondaryColor: '#223344',
      accentColor: '#aabbcc',
      mutedColor: '#667788',
      darkColor: '#000000',
      lightColor: '#ffffff',
      readableTextColor: '#ffffff',
      overlayOpacity: 0.5,
      shadowStrength: 0.5,
      source: 'fallback' as const
    };
    const config = effectiveVisualizerConfig(defaultWallpaperPreferences());
    const customConfig = { ...config, glowStrength: 0.9, rotationSpeed: -0.4 };
    const variables = visualizerStyleVariables(
      { ...settings, colorMode: 'accent', lineWidth: 9, radius: 1.7, gap: 34, rotationSpeed: -0.4, glowStrength: 0.9 },
      theme,
      customConfig
    );

    expect(variables['--visualizer-color']).toBe('#aabbcc');
    expect(variables['--visualizer-line-width']).toBe('9px');
    expect(variables['--visualizer-radius']).toBe('1.7');
    expect(variables['--visualizer-rotation-direction']).toBe('reverse');
    expect(variables['--visualizer-glow']).toBe('0.9');
    expect(visualizerRingRadius(1.7)).toBe(96);
    expect(visualizerStyleVariables({ ...settings, rotationSpeed: 0 }, theme, { ...config, rotationSpeed: 0 })['--visualizer-animation-play-state']).toBe('paused');
    expect(visualizerStyleVariables({ ...settings, rotationSpeed: 0.2 }, theme, { ...config, rotationSpeed: 0.2 })['--visualizer-animation-play-state']).toBe('running');
    expect(config).toEqual({ barCount: 56, glowStrength: 0.62, rotationSpeed: 0.16, sampleStep: 1 });
  });

  it('reduces presentation work in low-power mode', () => {
    const preferences = defaultWallpaperPreferences();
    const config = effectiveVisualizerConfig({
      ...preferences,
      performance: { mode: 'low-power' },
      visualizer: { ...preferences.visualizer, barCount: 120, glowStrength: 1, rotationSpeed: 0.4 }
    });

    expect(config.barCount).toBe(24);
    expect(config.glowStrength).toBe(0.45);
    expect(config.rotationSpeed).toBeCloseTo(0.14, 10);
    expect(config.sampleStep).toBe(2);
  });

  it('caps high-effect presentation work without changing the standard step', () => {
    const preferences = defaultWallpaperPreferences();
    const config = effectiveVisualizerConfig({
      ...preferences,
      performance: { mode: 'high-effect' },
      visualizer: { ...preferences.visualizer, barCount: 200, glowStrength: 0.8 }
    });

    expect(config.barCount).toBe(120);
    expect(config.glowStrength).toBe(0.96);
    expect(config.sampleStep).toBe(1);
  });
});
