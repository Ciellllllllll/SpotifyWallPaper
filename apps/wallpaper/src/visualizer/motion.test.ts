import { describe, expect, it } from 'vitest';
import type { VisualizerFrame } from '@spotify-wallpaper/shared-types';
import { calculateVisualizerMotion, neutralVisualizerMotion, releaseVisualizerMotion } from './motion';

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

  it('uses a continuous stretch response below the former threshold', () => {
    const motion = calculateVisualizerMotion(frame({ peak: 0.4, bass: 0.4, mid: 0.4, treble: 0.4 }));

    expect(motion.impactLevel).toBeCloseTo(0.4, 5);
    expect(motion.stretchLevel).toBeCloseTo(0.4, 5);
    expect(motion.albumScale).toBeCloseTo(1.216, 5);
    expect(motion.particleSpeedMultiplier).toBeCloseTo(1.4, 5);
    expect(motion.particleBrightnessMultiplier).toBeCloseTo(1.24, 5);
  });

  it('maps impact continuously to album scale and particle motion', () => {
    const motion = calculateVisualizerMotion(frame({ peak: 1, bass: 0.5, mid: 0.25, treble: 0 }));
    expect(motion.impactLevel).toBeCloseTo(0.6375, 5);
    expect(motion.stretchLevel).toBeCloseTo(0.6375, 5);
    expect(motion.albumScale).toBeCloseTo(1.34425, 5);
    expect(motion.particleSpeedMultiplier).toBeCloseTo(1.6375, 5);
    expect(motion.particleBrightnessMultiplier).toBeCloseTo(1.3825, 5);
  });

  it('caps maximum stretch and converts non-finite input to a neutral finite state', () => {
    const maximum = calculateVisualizerMotion(frame({ peak: 1, bass: 1, mid: 1, treble: 1 }));
    expect(maximum.impactLevel).toBe(1);
    expect(maximum.stretchLevel).toBe(1);
    expect(maximum.albumScale).toBeCloseTo(1.54, 5);
    expect(maximum.particleSpeedMultiplier).toBe(2);
    expect(maximum.particleBrightnessMultiplier).toBeCloseTo(1.6, 5);
    expect(Math.hypot(maximum.albumOffsetX, maximum.albumOffsetY)).toBeCloseTo(8, 5);
    expect(calculateVisualizerMotion(frame({ peak: Number.NaN, bass: Number.POSITIVE_INFINITY, mid: -1, treble: Number.NaN }))).toEqual(neutralVisualizerMotion());
  });

  it('uses low-frequency impact for a finite outward album offset', () => {
    const quiet = calculateVisualizerMotion(frame({ peak: 0.2, bass: 0.2, mid: 0.2, treble: 0.2 }));
    const loud = calculateVisualizerMotion(frame({ peak: 1, bass: 1, mid: 0, treble: 0 }));

    expect(Math.hypot(quiet.albumOffsetX, quiet.albumOffsetY)).toBeGreaterThan(0);
    expect(Math.hypot(quiet.albumOffsetX, quiet.albumOffsetY)).toBeLessThan(Math.hypot(loud.albumOffsetX, loud.albumOffsetY));
    expect(Math.hypot(loud.albumOffsetX, loud.albumOffsetY)).toBeLessThanOrEqual(8);
    expect(Number.isFinite(loud.albumOffsetX)).toBe(true);
    expect(Number.isFinite(loud.albumOffsetY)).toBe(true);
  });

  it('caps album offset even when low-frequency input exceeds normalized bounds', () => {
    const motion = calculateVisualizerMotion(frame({
      samples: [2, 2, 2, 2],
      peak: 1,
      bass: 2,
      mid: 0.5,
      treble: 0.25
    }));

    expect(Math.hypot(motion.albumOffsetX, motion.albumOffsetY)).toBeCloseTo(8, 5);
  });

  it('keeps release output finite for an invalid elapsed time', () => {
    const active = calculateVisualizerMotion(frame({ peak: 1, bass: 1, mid: 1, treble: 1 }));
    const released = releaseVisualizerMotion(active, neutralVisualizerMotion(), Number.NaN);

    expect(Object.values(released).every((value) => Number.isFinite(value))).toBe(true);
    expect(released).toEqual(active);
  });
});
