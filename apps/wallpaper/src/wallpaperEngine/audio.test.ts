import { describe, expect, it, vi } from 'vitest';
import { createMockAudioFrame, createSilentAudioFrame, normalizeAudioFrame, startAudioBridge } from './audio';

describe('Wallpaper Engine audio adapter', () => {
  it('normalizes audio samples into a shared visualizer frame', () => {
    const frame = normalizeAudioFrame([-1, 0.25, 0.5, 2], 'wallpaper-engine', 1000);

    expect(frame.source).toBe('wallpaper-engine');
    expect(frame.samples).toEqual([0, 0.25, 0.5, 1]);
    expect(frame.bass).toBe(0);
    expect(frame.mid).toBe(0.25);
    expect(frame.treble).toBe(0.75);
    expect(frame.peak).toBe(1);
    expect(frame.timestampMs).toBe(1000);
  });

  it('folds Wallpaper Engine stereo channels into 64 averaged frequency bins', () => {
    const samples = Array<number>(128).fill(0);
    samples[0] = 0.2;
    samples[64] = 0.6;
    samples[63] = 2;
    samples[127] = Number.NaN;

    const frame = normalizeAudioFrame(samples, 'wallpaper-engine', 1000);

    expect(frame.samples).toHaveLength(64);
    expect(frame.samples[0]).toBeCloseTo(0.4);
    expect(frame.samples[63]).toBeCloseTo(1);
    expect(frame.peak).toBeCloseTo(1);
  });

  it('generates browser mock audio frames', () => {
    const frame = createMockAudioFrame(1000);

    expect(frame.source).toBe('mock');
    expect(frame.samples).toHaveLength(64);
    expect(frame.peak).toBeGreaterThan(0);
  });

  it('creates a zero Wallpaper Engine frame for stale callbacks', () => {
    const frame = createSilentAudioFrame(1000);

    expect(frame.source).toBe('wallpaper-engine');
    expect(frame.samples).toHaveLength(64);
    expect(frame.peak).toBe(0);
    expect(frame.samples.every((sample) => sample === 0)).toBe(true);
  });

  it('uses Wallpaper Engine audio listener when present', () => {
    const onFrame = vi.fn();
    let listener: ((samples: number[]) => void) | null = null;
    const target = {
      wallpaperRegisterAudioListener: (nextListener: (samples: number[]) => void) => {
        listener = nextListener;
      },
      setInterval: vi.fn(),
      clearInterval: vi.fn()
    } as unknown as Window;

    const handle = startAudioBridge(onFrame, target);
    expect(listener).not.toBeNull();
    const registeredListener = listener as unknown as (samples: number[]) => void;
    registeredListener([0.1, 0.2, 0.3]);
    handle.stop();

    expect(handle.source).toBe('wallpaper-engine');
    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({ source: 'wallpaper-engine', peak: 0.3 }));
  });
});
