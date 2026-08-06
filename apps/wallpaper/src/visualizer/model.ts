import type { VisualizerFrame, WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import { normalizeSamplesWithCore } from '../wasm/visualCore';
import { normalizeSamplesFallback } from '../wasm/fallback';

export const shapeVisualizerFrame = (
  frame: VisualizerFrame,
  previous: VisualizerFrame | null,
  settings: WallpaperPreferences['visualizer']
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

export const idleVisualizerFrame = (timestampMs: number, settings: WallpaperPreferences['visualizer']): VisualizerFrame => {
  const phase = timestampMs / 1200;
  const samples = Array.from({ length: Math.max(8, Math.min(32, settings.barCount)) }, (_, index) => {
    const wave = Math.sin(phase + index * 0.62) * 0.5 + 0.5;
    return settings.idleAnimation ? wave * 0.18 + 0.08 : 0.08;
  });

  return frameFromSamples(samples, 'idle', timestampMs);
};

export const shouldIgnoreSilentWallpaperFrame = (
  frame: VisualizerFrame,
  settings: WallpaperPreferences['visualizer']
): boolean => frame.source === 'wallpaper-engine' && frame.peak <= settings.noiseGate;

const normalizeSample = (sample: number, settings: WallpaperPreferences['visualizer']): number => {
  if (!Number.isFinite(sample)) {
    return 0;
  }

  const clamped = Math.min(settings.clampMax, Math.max(0, sample));
  if (clamped < settings.noiseGate) {
    return 0;
  }

  return clamp01((clamped / settings.clampMax) * settings.sensitivity * settings.intensity);
};

const bandWeight = (index: number, length: number, settings: WallpaperPreferences['visualizer']): number => {
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

const average = (samples: number[]): number => {
  if (samples.length === 0) {
    return 0;
  }

  return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
