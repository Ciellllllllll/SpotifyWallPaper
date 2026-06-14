import type { VisualizerFrame, WallpaperSettings, WallpaperTheme } from '@spotify-wallpaper/shared-types';
import { normalizeSamplesWithCore } from '../wasm/visualCore';

export interface EffectiveVisualizerConfig {
  barCount: number;
  glowStrength: number;
  rotationSpeed: number;
  sampleStep: number;
}

export interface VisualizerBar {
  angle: number;
  value: number;
}

export const effectiveVisualizerConfig = (settings: WallpaperSettings): EffectiveVisualizerConfig => {
  const requestedBars = settings.visualizer.barCount;
  const maxBars =
    settings.performance.mode === 'low-power' ? 24 : settings.performance.mode === 'high-effect' ? 120 : 72;
  const sampleStep = settings.performance.mode === 'low-power' ? 2 : 1;
  const glowScale = settings.performance.mode === 'low-power' ? 0.45 : settings.performance.mode === 'high-effect' ? 1.2 : 1;

  return {
    barCount: Math.max(8, Math.min(maxBars, Math.round(requestedBars))),
    glowStrength: clamp01(settings.visualizer.glowStrength * glowScale),
    rotationSpeed: settings.performance.mode === 'low-power' ? settings.visualizer.rotationSpeed * 0.35 : settings.visualizer.rotationSpeed,
    sampleStep
  };
};

export const shapeVisualizerFrame = (
  frame: VisualizerFrame,
  previous: VisualizerFrame | null,
  settings: WallpaperSettings['visualizer']
): VisualizerFrame => {
  const safeSamples = frame.samples.length > 0 ? frame.samples : [0];
  const weightedSamples = safeSamples.map((sample, index) => {
    const normalized = normalizeSample(sample, settings);
    return normalized * bandWeight(index, safeSamples.length, settings);
  });
  const normalized =
    normalizeSamplesWithCore({ ...frame, samples: weightedSamples }, previous, settings) ??
    normalizeSamplesFallback(weightedSamples, previous?.samples ?? [], settings);

  return frameFromSamples(normalized.samples.map(clamp01), frame.source, frame.timestampMs);
};

export const idleVisualizerFrame = (timestampMs: number, settings: WallpaperSettings['visualizer']): VisualizerFrame => {
  const phase = timestampMs / 1200;
  const samples = Array.from({ length: Math.max(8, Math.min(32, settings.barCount)) }, (_, index) => {
    const wave = Math.sin(phase + index * 0.62) * 0.5 + 0.5;
    return settings.idleAnimation ? wave * 0.18 + 0.08 : 0.08;
  });

  return frameFromSamples(samples, 'idle', timestampMs);
};

export const buildVisualizerBars = (
  frame: VisualizerFrame,
  settings: WallpaperSettings,
  config: EffectiveVisualizerConfig = effectiveVisualizerConfig(settings)
): VisualizerBar[] => {
  const samples = downsample(frame.samples, config.barCount, config.sampleStep);
  const mirrored = settings.visualizer.mirrorMode === 'mirror';

  return samples.map((sample, index) => {
    const sourceIndex = mirrored && index >= samples.length / 2 ? samples.length - 1 - index : index;
    return {
      angle: (index / samples.length) * 360,
      value: clamp01(samples[Math.max(0, sourceIndex)])
    };
  });
};

export const buildWaveformPath = (frame: VisualizerFrame, pointCount = 48): string => {
  const samples = downsample(frame.samples, Math.max(2, pointCount), 1);
  const lastIndex = Math.max(1, samples.length - 1);
  const points = samples.map((sample, index) => {
    const x = (index / lastIndex) * 100;
    const y = 62 - clamp01(sample) * 44;
    return `${round(x)},${round(y)}`;
  });

  return `M ${points.join(' L ')}`;
};

export const visualizerColor = (
  mode: WallpaperSettings['visualizer']['colorMode'],
  theme: WallpaperTheme
): string => {
  if (mode === 'white') {
    return '#ffffff';
  }

  return mode === 'accent' ? theme.accentColor : theme.primaryColor;
};

const normalizeSample = (sample: number, settings: WallpaperSettings['visualizer']): number => {
  if (!Number.isFinite(sample)) {
    return 0;
  }

  const clamped = Math.min(settings.clampMax, Math.max(0, sample));
  if (clamped < settings.noiseGate) {
    return 0;
  }

  return clamp01((clamped / settings.clampMax) * settings.sensitivity * settings.intensity);
};

const normalizeSamplesFallback = (
  current: number[],
  previous: number[],
  settings: WallpaperSettings['visualizer']
): { samples: number[]; peak: number } => {
  const nextSamples = current.map((sample, index) => {
    const previousSample = previous[index] ?? 0;
    const smoothed = previousSample * settings.smoothing + sample * (1 - settings.smoothing);
    return Math.max(smoothed, previousSample * (1 - settings.decay));
  });

  return {
    samples: nextSamples,
    peak: nextSamples.reduce((max, sample) => Math.max(max, sample), 0)
  };
};

const bandWeight = (index: number, length: number, settings: WallpaperSettings['visualizer']): number => {
  const ratio = index / Math.max(1, length - 1);
  if (ratio < 1 / 3) {
    return settings.bassWeight;
  }
  if (ratio < 2 / 3) {
    return settings.midWeight;
  }
  return settings.trebleWeight;
};

const frameFromSamples = (samples: number[], source: VisualizerFrame['source'], timestampMs: number): VisualizerFrame => {
  const third = Math.max(1, Math.floor(samples.length / 3));

  return {
    source,
    samples,
    bass: average(samples.slice(0, third)),
    mid: average(samples.slice(third, third * 2)),
    treble: average(samples.slice(third * 2)),
    peak: samples.reduce((max, sample) => Math.max(max, sample), 0),
    timestampMs
  };
};

const downsample = (samples: number[], count: number, step: number): number[] => {
  const source = samples.length > 0 ? samples.filter((_, index) => index % step === 0) : [0];
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.min(source.length - 1, Math.floor((index / count) * source.length));
    return source[sourceIndex] ?? 0;
  });
};

const average = (samples: number[]): number => {
  if (samples.length === 0) {
    return 0;
  }

  return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number): number => Math.round(value * 100) / 100;
