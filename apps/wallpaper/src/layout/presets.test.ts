import { describe, expect, it } from 'vitest';
import { clonePresetItems, layoutPresetNames, layoutPresets } from './presets';

describe('layout presets', () => {
  it('defines every required preset with the main layout items', () => {
    expect(layoutPresetNames).toEqual([
      'Minimal',
      'Center Album',
      'Lyrics Focus',
      'Visualizer Heavy',
      'Rainmeter Hybrid',
      'Left Dock',
      'Bottom Player',
      'Clock Focus',
      'Album Ring',
      'Ambient Background'
    ]);

    for (const preset of layoutPresetNames) {
      expect(Object.keys(layoutPresets[preset]).sort()).toEqual(['albumArt', 'clock', 'debug', 'lyrics', 'seekbar', 'trackText']);
    }
  });

  it('returns cloned preset items', () => {
    const first = clonePresetItems('Left Dock');
    const second = clonePresetItems('Left Dock');
    first.albumArt.x = 99;

    expect(second.albumArt.x).not.toBe(99);
  });
});
