import type { WallpaperPreferences, WallpaperTheme } from '@spotify-wallpaper/shared-types';

/** Presentation-only visualizer values; runtime shaping remains outside the view. */
export const visualizerStyleVariables = (
  settings: WallpaperPreferences['visualizer'],
  theme: WallpaperTheme
): Readonly<Record<string, string>> => ({
  '--visualizer-color': settings.colorMode === 'accent'
    ? theme.accentColor
    : settings.colorMode === 'white'
      ? '#ffffff'
      : theme.primaryColor,
  '--visualizer-line-width': `${settings.lineWidth}px`,
  '--visualizer-glow': `${Math.max(0, Math.min(1, settings.glowStrength))}`,
  '--visualizer-gap': `${Math.max(1, 6 - settings.gap / 20)}px`,
  '--visualizer-radius': `${Math.max(0.6, Math.min(2.2, settings.radius))}`,
  '--visualizer-rotation-duration': `${Math.max(1, 8 / Math.max(0.02, Math.abs(settings.rotationSpeed)))}s`,
  '--visualizer-rotation-direction': settings.rotationSpeed < 0 ? 'reverse' : 'normal',
  '--visualizer-animation-play-state': settings.rotationSpeed === 0 ? 'paused' : 'running'
});

export const visualizerRingRadius = (radius: number): number => Math.max(44, Math.min(96, 78 * radius));
