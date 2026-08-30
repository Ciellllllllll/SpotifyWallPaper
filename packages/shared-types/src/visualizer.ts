import type { WallpaperPreferences } from './settings';

const VISUALIZER_RESPONSE_EXPONENT = 0.72;
const VISUALIZER_RESPONSE_CAP = 1.35;

const safeSignal = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

export const visualizerResponseGainForPerformance = (mode: WallpaperPreferences['performance']['mode']): number => {
  if (mode === 'low-power') return 0.9;
  if (mode === 'high-effect') return 1.35;
  return 1.15;
};

export const visualizerResponseSample = (sample: number, responseGain: number): number => {
  const normalized = Math.min(1, safeSignal(sample));
  const gain = Number.isFinite(responseGain) ? Math.max(0, responseGain) : 1;
  return Math.min(VISUALIZER_RESPONSE_CAP, normalized ** VISUALIZER_RESPONSE_EXPONENT * gain);
};

export const visualizerResponsePeak = (peak: number, intensity: number, responseGain: number): number => {
  const safeIntensity = safeSignal(intensity);
  if (safeIntensity === 0) return 0;
  return visualizerResponseSample(safeSignal(peak) / safeIntensity, responseGain) * safeIntensity;
};
