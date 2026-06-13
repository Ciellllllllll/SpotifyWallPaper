import { describe, expect, it } from 'vitest';
import { mockPlayback } from '../mock/mockPlayback';
import { defaultSettings } from '../settings/defaultSettings';
import { createTransitionState, isPlaybackChange, resolveTransitionPreset } from './model';

const nextPlayback = {
  ...mockPlayback,
  id: 'next-track',
  uri: 'spotify:track:next-track',
  title: 'Next Track'
};

describe('transition model', () => {
  it('detects track identity changes', () => {
    expect(isPlaybackChange(mockPlayback, nextPlayback)).toBe(true);
    expect(isPlaybackChange(mockPlayback, { ...mockPlayback, progressMs: mockPlayback.progressMs + 1000 })).toBe(false);
  });

  it('creates transition state only when enabled and identity changes', () => {
    expect(createTransitionState(mockPlayback, nextPlayback, defaultSettings, 1000)).toBeNull();

    const state = createTransitionState(
      mockPlayback,
      nextPlayback,
      { ...defaultSettings, transitions: { ...defaultSettings.transitions, enabled: true, preset: 'slide-left' } },
      1000
    );

    expect(state).toMatchObject({
      previous: mockPlayback,
      current: nextPlayback,
      startedAtMs: 1000,
      preset: 'slide-left',
      resolvedPreset: 'slide-left'
    });
  });

  it('resolves aggressive transitions to fade when reduce motion is enabled', () => {
    expect(
      resolveTransitionPreset({
        ...defaultSettings,
        transitions: { ...defaultSettings.transitions, enabled: true, preset: 'blur-fade', reduceMotion: true }
      })
    ).toBe('fade');
    expect(
      resolveTransitionPreset({
        ...defaultSettings,
        transitions: { ...defaultSettings.transitions, enabled: true, preset: 'crossfade', reduceMotion: true }
      })
    ).toBe('crossfade');
  });
});
