import { describe, expect, it } from 'vitest';
import type { VisualizerFrame } from '@spotify-wallpaper/shared-types';
import { calculateVisualizerMotion, neutralVisualizerMotion } from './motion';

const frame = (partial: Partial<VisualizerFrame> = {}): VisualizerFrame => ({
  source: 'mock',
  samples: [0.8],
  bass: 0.8,
  mid: 0.8,
  treble: 0.8,
  peak: 0.8,
  timestampMs: 1000,
  ...partial
});

describe('visualizer motion coupling', () => {
  it('returns a neutral state without an audio frame', () => {
    expect(calculateVisualizerMotion(null)).toEqual(neutralVisualizerMotion());
    expect(calculateVisualizerMotion(frame({ source: 'idle' }))).toEqual(neutralVisualizerMotion());
  });

  it('does not stretch at or below the impact threshold', () => {
    expect(calculateVisualizerMotion(frame({ peak: 0.4, bass: 0.4, mid: 0.4, treble: 0.4 }))).toEqual({
      impactLevel: 0.4,
      stretchLevel: 0,
      albumScale: 1,
      particleSpeedMultiplier: 1
    });
    expect(calculateVisualizerMotion(frame({ peak: 0.39, bass: 0.39, mid: 0.39, treble: 0.39 }))).toEqual({
      impactLevel: 0.39,
      stretchLevel: 0,
      albumScale: 1,
      particleSpeedMultiplier: 1
    });
  });

  it('maps impact above the threshold to album scale and particle speed', () => {
    const motion = calculateVisualizerMotion(frame({ peak: 1, bass: 0.5, mid: 0.25, treble: 0 }));
    expect(motion.impactLevel).toBeCloseTo(0.6375, 5);
    expect(motion.stretchLevel).toBeCloseTo(0.3958333333333333, 5);
    expect(motion.albumScale).toBeCloseTo(1.0475, 5);
    expect(motion.particleSpeedMultiplier).toBeCloseTo(1.3958333333333333, 5);
  });

  it('caps maximum stretch and converts non-finite input to a neutral finite state', () => {
    const maximum = calculateVisualizerMotion(frame({ peak: 1, bass: 1, mid: 1, treble: 1 }));
    expect(maximum.impactLevel).toBe(1);
    expect(maximum.stretchLevel).toBe(1);
    expect(maximum.albumScale).toBeCloseTo(1.12, 5);
    expect(maximum.particleSpeedMultiplier).toBe(2);
    expect(calculateVisualizerMotion(frame({ peak: Number.NaN, bass: Number.POSITIVE_INFINITY, mid: -1, treble: Number.NaN }))).toEqual(neutralVisualizerMotion());
  });
});
