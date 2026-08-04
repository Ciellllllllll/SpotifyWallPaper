import { describe, expect, it } from 'vitest';
import { defaultWallpaperPreferences } from '@spotify-wallpaper/shared-types';
import { visualizerRingRadius, visualizerStyleVariables } from './visualizerStyle';

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
    const variables = visualizerStyleVariables(
      { ...settings, colorMode: 'accent', lineWidth: 9, radius: 1.7, gap: 34, rotationSpeed: -0.4, glowStrength: 0.9 },
      theme
    );

    expect(variables['--visualizer-color']).toBe('#aabbcc');
    expect(variables['--visualizer-line-width']).toBe('9px');
    expect(variables['--visualizer-radius']).toBe('1.7');
    expect(variables['--visualizer-rotation-direction']).toBe('reverse');
    expect(variables['--visualizer-glow']).toBe('0.9');
    expect(visualizerRingRadius(1.7)).toBe(96);
    expect(visualizerStyleVariables({ ...settings, rotationSpeed: 0 }, theme)['--visualizer-animation-play-state']).toBe('paused');
    expect(visualizerStyleVariables({ ...settings, rotationSpeed: 0.2 }, theme)['--visualizer-animation-play-state']).toBe('running');
  });
});
