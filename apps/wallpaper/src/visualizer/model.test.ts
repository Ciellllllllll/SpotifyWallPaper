import { describe, expect, it } from 'vitest';
import type { VisualizerFrame } from '@spotify-wallpaper/shared-types';
import { defaultSettings } from '../settings/defaultSettings';
import { buildVisualizerBars, buildWaveformPath, effectiveVisualizerConfig, idleVisualizerFrame, shapeVisualizerFrame } from './model';

const frame: VisualizerFrame = {
  source: 'mock',
  samples: [0.05, 0.25, 0.5, 0.75, 1],
  bass: 0.05,
  mid: 0.375,
  treble: 0.875,
  peak: 1,
  timestampMs: 1000
};

describe('visualizer model', () => {
  it('applies intensity, sensitivity, band weights, smoothing, and decay', () => {
    const shaped = shapeVisualizerFrame(frame, null, {
      ...defaultSettings.visualizer,
      intensity: 0.5,
      sensitivity: 2,
      smoothing: 0,
      decay: 0.25,
      noiseGate: 0.1,
      bassWeight: 2,
      midWeight: 1,
      trebleWeight: 0.5
    });

    expect(shaped.samples[0]).toBe(0);
    expect(shaped.samples[1]).toBe(0.5);
    expect(shaped.samples[2]).toBe(0.5);
    expect(shaped.samples[4]).toBe(0.5);
    expect(shaped.peak).toBe(0.5);
  });

  it('uses previous samples for decay when current audio drops', () => {
    const previous = shapeVisualizerFrame(frame, null, { ...defaultSettings.visualizer, smoothing: 0, decay: 0.2 });
    const dropped = shapeVisualizerFrame(
      { ...frame, samples: [0, 0, 0, 0, 0], timestampMs: 1100 },
      previous,
      { ...defaultSettings.visualizer, smoothing: 0, decay: 0.2 }
    );

    expect(dropped.peak).toBeGreaterThan(0);
    expect(dropped.peak).toBeCloseTo(previous.peak * 0.8, 5);
  });

  it('reduces visual work in low-power mode', () => {
    const config = effectiveVisualizerConfig({
      ...defaultSettings,
      performance: { mode: 'low-power' },
      visualizer: { ...defaultSettings.visualizer, barCount: 120, glowStrength: 1 }
    });

    expect(config.barCount).toBe(24);
    expect(config.sampleStep).toBe(2);
    expect(config.glowStrength).toBeLessThan(0.5);
  });

  it('builds bars and waveform path from samples', () => {
    const config = effectiveVisualizerConfig(defaultSettings);
    const bars = buildVisualizerBars(frame, defaultSettings, { ...config, barCount: 12 });
    const path = buildWaveformPath(frame, 5);

    expect(bars).toHaveLength(12);
    expect(bars[0]).toEqual(expect.objectContaining({ angle: 0 }));
    expect(path).toMatch(/^M /);
    expect(path).toContain(' L ');
  });

  it('creates idle frames when audio is unavailable', () => {
    const idle = idleVisualizerFrame(1000, defaultSettings.visualizer);

    expect(idle.source).toBe('idle');
    expect(idle.samples.length).toBeGreaterThan(0);
    expect(idle.peak).toBeGreaterThan(0);
  });
});
