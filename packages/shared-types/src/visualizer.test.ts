import { describe, expect, it } from 'vitest';
import {
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

});
