import type { VisualizerFrame, VisualizerSource } from '@spotify-wallpaper/shared-types';
import type { WallpaperAudioListener } from './types';

const MOCK_SAMPLE_COUNT = 64;
const MOCK_INTERVAL_MS = 100;

export const normalizeAudioFrame = (
  input: ArrayLike<number> | null | undefined,
  source: VisualizerSource,
  timestampMs = Date.now()
): VisualizerFrame => {
  const samples = input ? Array.from(input, clampSample) : [];
  const safeSamples = samples.length > 0 ? samples : [0];
  const third = Math.max(1, Math.floor(safeSamples.length / 3));

  return {
    source,
    samples: safeSamples,
    bass: average(safeSamples.slice(0, third)),
    mid: average(safeSamples.slice(third, third * 2)),
    treble: average(safeSamples.slice(third * 2)),
    peak: safeSamples.reduce((max, sample) => Math.max(max, sample), 0),
    timestampMs
  };
};

export const createMockAudioFrame = (timestampMs = Date.now()): VisualizerFrame => {
  const phase = timestampMs / 420;
  const samples = Array.from({ length: MOCK_SAMPLE_COUNT }, (_, index) => {
    const wave = Math.sin(phase + index / 5) * 0.5 + 0.5;
    const pulse = Math.sin(phase / 2) * 0.16 + 0.18;
    return clampSample(wave * 0.55 + pulse);
  });

  return normalizeAudioFrame(samples, 'mock', timestampMs);
};

export const startAudioBridge = (
  onFrame: (frame: VisualizerFrame) => void,
  target: Window = window
): (() => void) => {
  if (typeof target.wallpaperRegisterAudioListener === 'function') {
    const listener: WallpaperAudioListener = (samples) => onFrame(normalizeAudioFrame(samples, 'wallpaper-engine'));
    target.wallpaperRegisterAudioListener(listener);
    return () => undefined;
  }

  const interval = target.setInterval(() => {
    onFrame(createMockAudioFrame());
  }, MOCK_INTERVAL_MS);

  return () => target.clearInterval(interval);
};

const clampSample = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
};

const average = (samples: number[]): number => {
  if (samples.length === 0) {
    return 0;
  }

  return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
};
