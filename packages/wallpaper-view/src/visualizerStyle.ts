import type { WallpaperPreferences, WallpaperTheme } from '@spotify-wallpaper/shared-types';

export interface EffectiveVisualizerConfig {
  barCount: number;
  glowStrength: number;
  rotationSpeed: number;
  sampleStep: number;
}

export const effectiveVisualizerConfig = (settings: WallpaperPreferences): EffectiveVisualizerConfig => {
  const requestedBars = settings.visualizer.barCount;
  const maxBars = settings.performance.mode === 'low-power' ? 24 : settings.performance.mode === 'high-effect' ? 120 : 72;
  const sampleStep = settings.performance.mode === 'low-power' ? 2 : 1;
  const glowScale = settings.performance.mode === 'low-power' ? 0.45 : settings.performance.mode === 'high-effect' ? 1.2 : 1;

  return {
    barCount: Math.max(8, Math.min(maxBars, Math.round(requestedBars))),
    glowStrength: Math.max(0, Math.min(1, settings.visualizer.glowStrength * glowScale)),
    rotationSpeed: settings.performance.mode === 'low-power' ? settings.visualizer.rotationSpeed * 0.35 : settings.visualizer.rotationSpeed,
    sampleStep
  };
};

/** Presentation-only visualizer values; runtime shaping remains outside the view. */
export const visualizerStyleVariables = (
  settings: WallpaperPreferences['visualizer'],
  theme: WallpaperTheme,
  config: EffectiveVisualizerConfig
): Readonly<Record<string, string>> => ({
  '--visualizer-color': settings.colorMode === 'accent'
    ? theme.accentColor
    : settings.colorMode === 'white'
      ? '#ffffff'
      : theme.primaryColor,
  '--visualizer-line-width': `${settings.lineWidth}px`,
  '--visualizer-glow': `${config.glowStrength}`,
  '--visualizer-gap': `${Math.max(1, 6 - settings.gap / 20)}px`,
  '--visualizer-radius': `${Math.max(0.6, Math.min(2.2, settings.radius))}`,
  '--visualizer-rotation-duration': `${Math.max(1, 8 / Math.max(0.02, Math.abs(config.rotationSpeed)))}s`,
  '--visualizer-rotation-direction': config.rotationSpeed < 0 ? 'reverse' : 'normal',
  '--visualizer-animation-play-state': config.rotationSpeed === 0 ? 'paused' : 'running'
});

export const visualizerRingRadius = (radius: number): number => Math.max(44, Math.min(96, 78 * radius));
