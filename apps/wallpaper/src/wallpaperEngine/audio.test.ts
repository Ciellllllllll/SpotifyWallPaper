import { describe, expect, it, vi } from 'vitest';
import { createMockAudioFrame, normalizeAudioFrame, startAudioBridge } from './audio';

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

  it('generates browser mock audio frames', () => {
    const frame = createMockAudioFrame(1000);

    expect(frame.source).toBe('mock');
    expect(frame.samples).toHaveLength(64);
    expect(frame.peak).toBeGreaterThan(0);
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

    const stop = startAudioBridge(onFrame, target);
    expect(listener).not.toBeNull();
    const registeredListener = listener as unknown as (samples: number[]) => void;
    registeredListener([0.1, 0.2, 0.3]);
    stop();

    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({ source: 'wallpaper-engine', peak: 0.3 }));
  });
});
