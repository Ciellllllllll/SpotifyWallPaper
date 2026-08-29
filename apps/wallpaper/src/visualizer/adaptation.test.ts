import { describe, expect, it } from 'vitest';
import { mockPlayback } from '../mock/mockPlayback';
import {
  visualizerResponseGainForPerformance,
  visualizerResponseSample
} from '@spotify-wallpaper/shared-types';
import { defaultSettings } from '../settings/defaultSettings';
import {
  adaptVisualizerFrame,
  createVisualizerAdaptationState,
  setVisualizerAdaptationPlaybackState,
  type VisualizerAdaptationState
} from './adaptation';
import type { NormalizedPlayback, VisualizerFrame } from '@spotify-wallpaper/shared-types';

const frame = (peak: number, timestampMs = 1000): VisualizerFrame => ({
  source: 'wallpaper-engine',
  samples: [peak],
  bass: peak,
  mid: peak,
  treble: peak,
  peak,
  timestampMs
});

const playback = (partial: Partial<NormalizedPlayback> = {}): NormalizedPlayback => ({
  ...mockPlayback,
  ...partial
});

const adapt = (
  state: VisualizerAdaptationState,
  peak: number,
  nowMs: number,
  playbackOverrides: Partial<NormalizedPlayback> = {},
  hasValidAudio = peak > 0
) => adaptVisualizerFrame(
  state,
  frame(peak, nowMs),
  playback(playbackOverrides),
  visualizerResponseGainForPerformance('standard'),
  nowMs,
  hasValidAudio
);

const renderPeak = (
  normalizedPeak: number,
  totalGain: number,
  intensity: number,
  responseGain: number
): number => visualizerResponseSample(normalizedPeak * totalGain, responseGain) * intensity;

describe('visualizer automatic adaptation', () => {
  it('targets about 98 percent at the default reference intensity', () => {
    const result = adapt(createVisualizerAdaptationState(true), 0.25, 1000, { volumePercent: 100 });
    const renderedPeak = renderPeak(0.25, result.totalGain, 2.16, 1.15);

    expect(renderedPeak).toBeCloseTo(0.98, 2);
    expect(result.state.highWater).toBeCloseTo(0.25, 5);
  });

  it.each([
    [100, 1],
    [50, 2],
    [25, 4],
    [0, 1]
  ])('uses inverse volume correction for %d percent volume', (volumePercent, expectedGain) => {
    const result = adapt(
      createVisualizerAdaptationState(true),
      0.25,
      1000,
      { volumePercent }
    );

    expect(result.state.highWater).toBeCloseTo(0.25 * expectedGain, 5);
    expect(result.totalGain).toBeLessThanOrEqual(4);
  });

  it('keeps the corrected high-water stable when audio follows a volume change', () => {
    const atFullVolume = adapt(createVisualizerAdaptationState(true), 0.5, 1000, { volumePercent: 100 });
    const atHalfVolume = adapt(atFullVolume.state, 0.25, 1100, { volumePercent: 50 });
    const backAtFullVolume = adapt(atHalfVolume.state, 0.5, 1200, { volumePercent: 100 });

    expect(atHalfVolume.state.highWater).toBeCloseTo(atFullVolume.state.highWater, 2);
    expect(backAtFullVolume.state.highWater).toBeCloseTo(atFullVolume.state.highWater, 2);
  });

  it('keeps repeated volume changes bounded while following real audio', () => {
    let state = createVisualizerAdaptationState(true);
    const results = [100, 50, 25, 0, null].map((volumePercent, index) => {
      const result = adapt(state, 0.25, 1000 + index * 100, { volumePercent });
      state = result.state;
      return result;
    });

    expect(results.every((result) => result.totalGain <= 4 && result.state.highWater > 0)).toBe(true);
  });

  it('treats missing volume as unity and prioritizes real audio over zero volume', () => {
    const missing = adapt(createVisualizerAdaptationState(true), 0.25, 1000, { volumePercent: null });
    const zero = adapt(createVisualizerAdaptationState(true), 0.25, 1000, { volumePercent: 0 });

    expect(missing.state.highWater).toBeCloseTo(0.25, 5);
    expect(zero.state.highWater).toBeCloseTo(0.25, 5);
  });

  it('updates a track high-water continuously and carries it across track changes', () => {
    const first = adapt(createVisualizerAdaptationState(true), 0.8, 1000, { id: 'track-a' });
    const lower = adapt(first.state, 0.2, 2000, { id: 'track-a' });
    const changed = adapt(lower.state, 0.1, 2100, { id: 'track-b' });

    expect(lower.state.highWater).toBeGreaterThan(0.2);
    expect(changed.state.trackKey).toBe('track-b');
    expect(changed.state.highWater).toBeGreaterThan(0.1);
  });

  it('always smooths a changed-track gain over the configured interval', () => {
    const first = adapt(createVisualizerAdaptationState(true), 0.8, 1000, { id: 'track-a' });
    const changed = adapt(first.state, 0.1, 20_000, { id: 'track-b' });
    const settled = adapt(changed.state, 0.1, 20_450, { id: 'track-b' });

    expect(changed.state.automaticGain).toBe(first.state.automaticGain);
    expect(settled.state.automaticGain).not.toBe(changed.state.automaticGain);
  });

  it('holds the high-water and decay clock while paused, then resumes immediately', () => {
    const active = adapt(createVisualizerAdaptationState(true), 0.8, 1000);
    const paused = setVisualizerAdaptationPlaybackState(active.state, false, 2000);
    const resumed = adapt(paused, 0.2, 20_000);

    expect(paused.highWater).toBe(active.state.highWater);
    expect(resumed.state.highWater).toBeGreaterThanOrEqual(active.state.highWater * 0.9);
    expect(resumed.state.isPlaying).toBe(true);
  });

  it('decays the high-water on the twelve-second timescale while playing', () => {
    const active = adapt(createVisualizerAdaptationState(true), 0.8, 1000);
    const decayed = adapt(active.state, 0, 13_000);

    expect(decayed.state.highWater).toBeCloseTo(active.state.highWater * Math.exp(-1), 2);
  });

  it('caps automatic and volume correction at four times', () => {
    const result = adapt(
      createVisualizerAdaptationState(true),
      0.001,
      1000,
      { volumePercent: 25 }
    );

    expect(result.totalGain).toBeLessThanOrEqual(4);
    expect(Number.isFinite(result.totalGain)).toBe(true);
  });

  it('does not adapt paused playback or idle frames', () => {
    const state = createVisualizerAdaptationState(false);
    const result = adapt(state, 0.8, 1000, { isPlaying: false });

    expect(result.state.highWater).toBe(0);
    expect(result.state.isPlaying).toBe(false);
  });

  it.each([
    ['low-power', 0.9],
    ['standard', 1.15],
    ['high-effect', 1.35]
  ] as const)('targets about 98 percent across the %s response curve', (_mode, responseGain) => {
    const result = adaptVisualizerFrame(
      createVisualizerAdaptationState(true),
      frame(0.25, 1000),
      playback({ volumePercent: 100 }),
      responseGain,
      1000,
      true
    );

    expect(renderPeak(0.25, result.totalGain, 2.16, responseGain)).toBeCloseTo(0.98, 2);
  });

  it.each([0, 2.16, 6])('keeps intensity %s finite and display-only', (intensity) => {
    const result = adapt(
      createVisualizerAdaptationState(true),
      0.25,
      1000,
      { volumePercent: 100 }
    );
    const display = renderPeak(0.25, result.totalGain, intensity, 1.15);

    expect(Number.isFinite(result.totalGain)).toBe(true);
    expect(Number.isFinite(display)).toBe(true);
    expect(display).toBeCloseTo(0.98 * intensity / defaultSettings.visualizer.intensity, 2);
  });

  it('does not let an invalid audio frame raise the high-water', () => {
    const active = adapt(createVisualizerAdaptationState(true), 0.4, 1000);
    const invalid = adapt(active.state, 1, 1100, {}, false);

    expect(invalid.state.highWater).toBeLessThanOrEqual(active.state.highWater);
  });
});
