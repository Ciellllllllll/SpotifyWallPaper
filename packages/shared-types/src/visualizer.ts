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

/**
 * Returns the input signal needed to reach a final display value after the
 * response curve and manual intensity have both been applied.
 */
export const inverseVisualizerResponseInput = (
  finalDisplayValue: number,
  intensity: number,
  responseGain: number
): number => {
  const safeIntensity = safeSignal(intensity);
  const safeTarget = safeSignal(finalDisplayValue);
  const gain = Number.isFinite(responseGain) ? Math.max(0, responseGain) : 1;
  if (safeIntensity === 0 || safeTarget === 0 || gain === 0) return 0;

  const targetResponse = Math.min(VISUALIZER_RESPONSE_CAP, safeTarget / safeIntensity);
  const input = (targetResponse / gain) ** (1 / VISUALIZER_RESPONSE_EXPONENT);
  return Number.isFinite(input) ? Math.max(0, input) : 0;
};
