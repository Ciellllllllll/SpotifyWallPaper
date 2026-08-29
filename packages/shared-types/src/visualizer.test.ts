import { describe, expect, it } from 'vitest';
import {
  inverseVisualizerResponseInput,
  visualizerResponseGainForPerformance,
  visualizerResponseSample
} from './visualizer';

describe('shared visualizer response math', () => {
  it('keeps the current bounded response curve and exposes performance gains', () => {
    expect(visualizerResponseSample(0.25, 1.15)).toBeGreaterThan(0.25);
    expect(visualizerResponseSample(1, 2)).toBe(1.35);
    expect(visualizerResponseGainForPerformance('low-power')).toBe(0.9);
    expect(visualizerResponseGainForPerformance('standard')).toBe(1.15);
    expect(visualizerResponseGainForPerformance('high-effect')).toBe(1.35);
  });

  it('inverts the response curve after manual intensity for the 98 percent target', () => {
    const intensity = 2.16;
    const responseGain = 1.15;
    const input = inverseVisualizerResponseInput(0.98, intensity, responseGain);

    expect(visualizerResponseSample(input, responseGain) * intensity).toBeCloseTo(0.98, 5);
  });

  it('handles zero intensity and invalid values without producing non-finite output', () => {
    expect(inverseVisualizerResponseInput(0.98, 0, 1.15)).toBe(0);
    expect(inverseVisualizerResponseInput(Number.NaN, 2.16, 1.15)).toBe(0);
    expect(Number.isFinite(inverseVisualizerResponseInput(0.98, 2.16, Number.NaN))).toBe(true);
  });
});
