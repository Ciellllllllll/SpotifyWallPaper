import type { VisualizerFrame, VisualizerSource } from '@spotify-wallpaper/shared-types';
import type { WallpaperAudioListener } from './types';

const MOCK_SAMPLE_COUNT = 64;
const MOCK_INTERVAL_MS = 100;
const MOCK_AUDIO_GLOBAL = '__SPOTIFY_WALLPAPER_MOCK_AUDIO__';

export type AudioBridgeSource = 'wallpaper-engine' | 'mock';

export interface AudioBridgeHandle {
  source: AudioBridgeSource;
  stop: () => void;
}

export const normalizeAudioFrame = (
  input: ArrayLike<number> | null | undefined,
  source: VisualizerSource,
  timestampMs = Date.now()
): VisualizerFrame => {
  const isWallpaperEngineStereo = source === 'wallpaper-engine' && input?.length === 128;
  const normalized = input ? Array.from(input, isWallpaperEngineStereo ? safeSample : clampSample) : [];
  const samples = isWallpaperEngineStereo
    ? normalized.slice(0, 64).map((left, index) => (left + normalized[index + 64]) / 2)
    : normalized;
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

export const createSilentAudioFrame = (timestampMs = Date.now()): VisualizerFrame =>
  normalizeAudioFrame(Array<number>(MOCK_SAMPLE_COUNT).fill(0), 'wallpaper-engine', timestampMs);

export const startAudioBridge = (
  onFrame: (frame: VisualizerFrame) => void,
  target: Window = window
): AudioBridgeHandle => {
  if (typeof target.wallpaperRegisterAudioListener === 'function') {
    let stopped = false;
    const listener: WallpaperAudioListener = (samples) => {
      if (stopped) return;
      onFrame(normalizeAudioFrame(samples, 'wallpaper-engine'));
    };
    target.wallpaperRegisterAudioListener(listener);
    return { source: 'wallpaper-engine', stop: () => { stopped = true; } };
  }

  const previewTarget = target as Window & { __SPOTIFY_WALLPAPER_MOCK_AUDIO__?: ArrayLike<number> };
  const emitMockFrame = () => {
    const previewSamples = previewTarget[MOCK_AUDIO_GLOBAL];
    onFrame(previewSamples ? normalizeAudioFrame(previewSamples, 'mock') : createMockAudioFrame());
  };
  if (previewTarget[MOCK_AUDIO_GLOBAL]) emitMockFrame();
  const interval = target.setInterval(emitMockFrame, MOCK_INTERVAL_MS);

  return { source: 'mock', stop: () => target.clearInterval(interval) };
};

const clampSample = (value: number): number => {
  return Math.min(1, safeSample(value));
};

const safeSample = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
};

const average = (samples: number[]): number => {
  if (samples.length === 0) {
    return 0;
  }

  return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
};
