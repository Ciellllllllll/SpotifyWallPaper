import type { VisualizerFrame, WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import { normalizeSamplesWithCore } from '../wasm/visualCore';
import { normalizeSamplesFallback } from '../wasm/fallback';

export const shapeVisualizerFrame = (
  frame: VisualizerFrame,
  previous: VisualizerFrame | null,
  settings: WallpaperPreferences['visualizer']
): VisualizerFrame => {
  const weightedSamples = prepareSamples(frame.samples, settings);
  const normalized =
    normalizeSamplesWithCore({ ...frame, samples: weightedSamples }, previous, settings) ??
    normalizeSamplesFallback(weightedSamples, previous?.samples ?? [], settings);

  return frameFromSamples(normalized.samples, frame.source, frame.timestampMs);
};

export const applyVisualizerIntensity = (frame: VisualizerFrame, intensity: number): VisualizerFrame =>
  frameFromSamples(frame.samples.map((sample) => sample * intensity), frame.source, frame.timestampMs);

export const idleVisualizerFrame = (timestampMs: number, settings: WallpaperPreferences['visualizer']): VisualizerFrame => {
  const phase = timestampMs / 1200;
  const samples = Array.from({ length: Math.max(8, Math.min(32, settings.barCount)) }, (_, index) => {
    const wave = Math.sin(phase + index * 0.62) * 0.5 + 0.5;
    return settings.idleAnimation ? wave * 0.18 + 0.08 : 0.08;
  });

  return frameFromSamples(samples, 'idle', timestampMs);
};

export const isSilentWallpaperFrame = (
  frame: VisualizerFrame,
  settings: WallpaperPreferences['visualizer']
): boolean => {
  if (frame.source !== 'wallpaper-engine') {
    return false;
  }

  const clampMax = Math.max(0.0001, settings.clampMax);
  const noiseGate = Math.min(clampMax, Math.max(0, settings.noiseGate));
  return prepareSamples(frame.samples, settings).every(
    (sample) => sample === 0 || Math.min(clampMax, sample) < noiseGate
  );
};

const prepareSamples = (samples: number[], settings: WallpaperPreferences['visualizer']): number[] => {
  const safeSamples = samples.length > 0 ? samples : [0];
  return safeSamples.map((sample, index) => {
    const safeSample = Number.isFinite(sample) ? Math.max(0, sample) : 0;
    return safeSample * settings.sensitivity * bandWeight(index, safeSamples.length, settings);
  });
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
