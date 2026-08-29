import type { WallpaperPreferences, WallpaperTheme } from '@spotify-wallpaper/shared-types';

export interface EffectiveVisualizerConfig {
  barCount: number;
  glowStrength: number;
  sampleStep: number;
  responseGain: number;
  decorativeLayers: boolean;
  particleCount: number;
  particleLifeMs: number;
  particlePixelRatio: number;
  particleGlow: boolean;
  particleGlowStrength: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const safeSignal = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

export const visualizerResponseSample = (sample: number, responseGain: number): number => {
  const normalized = clamp(safeSignal(sample), 0, 1);
  const gain = Number.isFinite(responseGain) ? Math.max(0, responseGain) : 1;
  return Math.min(1.35, normalized ** 0.72 * gain);
};

export const visualizerResponsePeak = (peak: number, intensity: number, responseGain: number): number => {
  const safeIntensity = Number.isFinite(intensity) ? Math.max(0, intensity) : 0;
  if (safeIntensity === 0) return 0;
  return visualizerResponseSample(safeSignal(peak) / safeIntensity, responseGain) * safeIntensity;
};

export const effectiveVisualizerConfig = (settings: WallpaperPreferences): EffectiveVisualizerConfig => {
  const requestedBars = settings.visualizer.barCount;
  const performanceMode = settings.performance.mode;
  const maxBars = performanceMode === 'low-power' ? 24 : performanceMode === 'high-effect' ? 120 : 72;
  const sampleStep = settings.performance.mode === 'low-power' ? 2 : 1;
  const glowScale = settings.performance.mode === 'low-power' ? 0.45 : settings.performance.mode === 'high-effect' ? 1.2 : 1;
  const responseGain = settings.performance.mode === 'low-power' ? 0.9 : settings.performance.mode === 'high-effect' ? 1.35 : 1.15;
  const automaticParticleCount = performanceMode === 'low-power' ? 24 : performanceMode === 'high-effect' ? 96 : 48;
  const maximumParticleCount = performanceMode === 'low-power' ? 24 : performanceMode === 'high-effect' ? 192 : 96;
  const requestedParticleCount = Number.isFinite(settings.visualizer.particleCount)
    ? Math.round(settings.visualizer.particleCount)
    : 0;
  const requestedParticleLife = Number.isFinite(settings.visualizer.particleLife)
    ? settings.visualizer.particleLife
    : 0;

  return {
    barCount: Math.max(8, Math.min(maxBars, Math.round(requestedBars))),
    glowStrength: Math.max(0, Math.min(1, settings.visualizer.glowStrength * glowScale)),
    sampleStep,
    responseGain,
    decorativeLayers: performanceMode !== 'low-power',
    particleCount: Math.max(1, Math.min(
      maximumParticleCount,
      requestedParticleCount > 0 ? requestedParticleCount : automaticParticleCount
    )),
    particleLifeMs: Math.round(Math.max(0.1, Math.min(10, requestedParticleLife > 0 ? requestedParticleLife : 3.5)) * 1000),
    particlePixelRatio: performanceMode === 'low-power' ? 1 : 1.5,
    particleGlow: performanceMode !== 'low-power',
    particleGlowStrength: performanceMode === 'low-power' ? 0 : performanceMode === 'high-effect' ? 1.35 : 1
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
  '--visualizer-glow': `${config.glowStrength}`
});
