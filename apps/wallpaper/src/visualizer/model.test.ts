import { describe, expect, it } from 'vitest';
import type { VisualizerFrame } from '@spotify-wallpaper/shared-types';
import { defaultSettings } from '../settings/defaultSettings';
import {
  applyVisualizerIntensity,
  idleVisualizerFrame,
  shapeVisualizerFrame,
  isSilentWallpaperFrame
} from './model';

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
  it('normalizes each sample only once', () => {
    const shaped = shapeVisualizerFrame(
      { ...frame, samples: [1], peak: 1 },
      null,
      {
        ...defaultSettings.visualizer,
        intensity: 1,
        sensitivity: 1,
        smoothing: 0,
        decay: 1,
        clampMax: 2,
        noiseGate: 0,
        bassWeight: 1,
        midWeight: 1,
        trebleWeight: 1
      }
    );

    expect(shaped.samples).toEqual([0.5]);
  });

  it('keeps rendered intensity out of the smoothing and decay state', () => {
    const state = shapeVisualizerFrame(
      { ...frame, samples: [0.5], peak: 0.5 },
      null,
      {
        ...defaultSettings.visualizer,
        intensity: 0.5,
        sensitivity: 1,
        smoothing: 0,
        decay: 1,
        noiseGate: 0,
        bassWeight: 1,
        midWeight: 1,
        trebleWeight: 1
      }
    );
    const rendered = applyVisualizerIntensity(state, 0.5);

    expect(state.samples).toEqual([0.5]);
    expect(rendered.samples).toEqual([0.25]);
  });

  it('applies intensity as an unclamped display-only multiplier', () => {
    const rendered = applyVisualizerIntensity({ ...frame, samples: [0.75], peak: 0.75 }, 2);

    expect(rendered.samples).toEqual([1.5]);
    expect(rendered.peak).toBe(1.5);
  });

  it('applies intensity, sensitivity, band weights, smoothing, and decay', () => {
    const shaped = applyVisualizerIntensity(
      shapeVisualizerFrame(frame, null, {
        ...defaultSettings.visualizer,
        sensitivity: 2,
        smoothing: 0,
        decay: 0.25,
        noiseGate: 0.1,
        bassWeight: 2,
        midWeight: 1,
        trebleWeight: 0.5
      }),
      0.5
    );

    expect(shaped.samples[0]).toBe(0.1);
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

  it('converts invalid, negative, and empty sample input to safe zero output', () => {
    const settings = {
      ...defaultSettings.visualizer,
      sensitivity: 1,
      smoothing: 0,
      decay: 1,
      noiseGate: 0,
      bassWeight: 1,
      midWeight: 1,
      trebleWeight: 1
    };

    expect(shapeVisualizerFrame({ ...frame, samples: [-1, Number.NaN], peak: 0 }, null, settings).samples).toEqual([0, 0]);
    expect(shapeVisualizerFrame({ ...frame, samples: [], peak: 0 }, null, settings).samples).toEqual([0]);
  });

  it('creates idle frames when audio is unavailable', () => {
    const idle = idleVisualizerFrame(1000, defaultSettings.visualizer);

    expect(idle.source).toBe('idle');
    expect(idle.samples.length).toBeGreaterThan(0);
    expect(idle.peak).toBeGreaterThan(0);
  });

  it('identifies silent Wallpaper Engine frames so idle fallback can recover', () => {
    expect(
      isSilentWallpaperFrame(
        { ...frame, source: 'wallpaper-engine', samples: [0, 0, 0], peak: 0 },
        defaultSettings.visualizer
      )
    ).toBe(true);
    expect(
      isSilentWallpaperFrame(
        { ...frame, source: 'wallpaper-engine', samples: [0.2, 0.1, 0.05], peak: 0.2 },
        defaultSettings.visualizer
      )
    ).toBe(false);
    expect(isSilentWallpaperFrame({ ...frame, source: 'mock', peak: 0 }, defaultSettings.visualizer)).toBe(false);
  });

  it('applies sensitivity before deciding that a Wallpaper Engine frame is silent', () => {
    const quietFrame = { ...frame, source: 'wallpaper-engine' as const, samples: [0.02], peak: 0.02 };

    expect(isSilentWallpaperFrame(quietFrame, defaultSettings.visualizer)).toBe(true);
    expect(
      isSilentWallpaperFrame(quietFrame, { ...defaultSettings.visualizer, sensitivity: 2 })
    ).toBe(false);
  });

  it('uses the same band weighting and gate boundary for silence detection as normalization', () => {
    const settings = {
      ...defaultSettings.visualizer,
      sensitivity: 1,
      noiseGate: 0.03,
      bassWeight: 2,
      midWeight: 1,
      trebleWeight: 0.5
    };

    expect(
      isSilentWallpaperFrame(
        { ...frame, source: 'wallpaper-engine', samples: [0.02, 0, 0], peak: 0.02 },
        settings
      )
    ).toBe(false);
    expect(
      isSilentWallpaperFrame(
        { ...frame, source: 'wallpaper-engine', samples: [0, 0, 0.04], peak: 0.04 },
        settings
      )
    ).toBe(true);
    expect(
      isSilentWallpaperFrame(
        { ...frame, source: 'wallpaper-engine', samples: [0, 0.03, 0], peak: 0.03 },
        settings
      )
    ).toBe(false);
  });

  it('treats an all-zero Wallpaper Engine frame as silent when the noise gate is zero', () => {
    const settings = { ...defaultSettings.visualizer, noiseGate: 0 };

    expect(
      isSilentWallpaperFrame(
        { ...frame, source: 'wallpaper-engine', samples: [0, 0, 0], peak: 0 },
        settings
      )
    ).toBe(true);
    expect(
      isSilentWallpaperFrame(
        { ...frame, source: 'wallpaper-engine', samples: [0, 0.001, 0], peak: 0.001 },
        settings
      )
    ).toBe(false);
  });
});
