import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaultSettings';
import { repairSettings } from './repairSettings';

describe('repairSettings', () => {
  it('keeps valid settings intact', () => {
    const result = repairSettings(defaultSettings);

    expect(result.repaired).toBe(false);
    expect(result.warning).toBeNull();
  });

  it('repairs invalid layout fields and unknown presets', () => {
    const result = repairSettings({
      ...defaultSettings,
      schemaVersion: 99,
      layout: {
        preset: 'Unknown' as never,
        items: {
          ...defaultSettings.layout.items,
          albumArt: {
            ...defaultSettings.layout.items.albumArt,
            x: Number.NaN,
            anchor: 'bad-anchor' as never,
            opacity: 12,
            scale: 0
          }
        }
      }
    });

    expect(result.repaired).toBe(true);
    expect(result.warning).toContain('repaired');
    expect(result.settings.schemaVersion).toBe(1);
    expect(result.settings.layout.preset).toBe('Left Dock');
    expect(result.settings.layout.items.albumArt.x).toBe(defaultSettings.layout.items.albumArt.x);
    expect(result.settings.layout.items.albumArt.anchor).toBe(defaultSettings.layout.items.albumArt.anchor);
    expect(result.settings.layout.items.albumArt.opacity).toBe(1);
    expect(result.settings.layout.items.albumArt.scale).toBe(0.1);
  });

  it('preserves valid custom item coordinates', () => {
    const result = repairSettings({
      ...defaultSettings,
      layout: {
        ...defaultSettings.layout,
        items: {
          ...defaultSettings.layout.items,
          trackText: {
            ...defaultSettings.layout.items.trackText,
            x: 62,
            y: 31,
            anchor: 'top-center'
          }
        }
      }
    });

    expect(result.settings.layout.items.trackText.x).toBe(62);
    expect(result.settings.layout.items.trackText.y).toBe(31);
    expect(result.settings.layout.items.trackText.anchor).toBe('top-center');
  });
});
