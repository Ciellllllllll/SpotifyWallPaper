import type { VisualizerFrame, WallpaperPreferences, WallpaperTheme } from '@spotify-wallpaper/shared-types';

export interface EffectiveVisualizerConfig {
  barCount: number;
  glowStrength: number;
  sampleStep: number;
  responseGain: number;
  decorativeLayers: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const safeSignal = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

export const visualizerResponseSample = (sample: number, responseGain: number): number => {
  const normalized = clamp(safeSignal(sample), 0, 1);
  const gain = Number.isFinite(responseGain) ? Math.max(0, responseGain) : 1;
  return Math.min(1.35, normalized ** 0.72 * gain);
};

export const visualizerImpact = (
  frame: Pick<VisualizerFrame, 'peak' | 'bass' | 'mid' | 'treble'> | null
): number => {
  if (!frame) return 0;
  return clamp(
    safeSignal(frame.peak) * 0.45
      + safeSignal(frame.bass) * 0.3
      + safeSignal(frame.mid) * 0.15
      + safeSignal(frame.treble) * 0.1,
    0,
    1
  );
};

export const effectiveVisualizerConfig = (settings: WallpaperPreferences): EffectiveVisualizerConfig => {
  const requestedBars = settings.visualizer.barCount;
  const maxBars = settings.performance.mode === 'low-power' ? 24 : settings.performance.mode === 'high-effect' ? 120 : 72;
  const sampleStep = settings.performance.mode === 'low-power' ? 2 : 1;
  const glowScale = settings.performance.mode === 'low-power' ? 0.45 : settings.performance.mode === 'high-effect' ? 1.2 : 1;
  const responseGain = settings.performance.mode === 'low-power' ? 0.9 : settings.performance.mode === 'high-effect' ? 1.35 : 1.15;

  return {
    barCount: Math.max(8, Math.min(maxBars, Math.round(requestedBars))),
    glowStrength: Math.max(0, Math.min(1, settings.visualizer.glowStrength * glowScale)),
    sampleStep,
    responseGain,
    decorativeLayers: settings.performance.mode !== 'low-power'
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
  '--visualizer-radius': `${Math.max(0.6, Math.min(2.2, settings.radius))}`
});
