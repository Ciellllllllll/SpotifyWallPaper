import { describe, expect, it } from 'vitest';
import { applyPreviewIntent } from './previewIntent';

describe('configurator preview intent isolation', () => {
  it('handles only local display-mode toggles', () => {
    expect(applyPreviewIntent('album-only', { type: 'toggle-display-mode' })).toBe('album-details');
    expect(applyPreviewIntent('album-details', { type: 'toggle-display-mode' })).toBe('album-only');
  });

  it('drops every Spotify playback intent without invoking a provider', () => {
    const intents = [
      { type: 'play' },
      { type: 'pause' },
      { type: 'next' },
      { type: 'previous' },
      { type: 'seek', positionMs: 1200 },
      { type: 'volume', volumePercent: 50 },
      { type: 'shuffle', state: true },
      { type: 'repeat', state: 'context' }
    ] as const;

    for (const intent of intents) {
      expect(applyPreviewIntent('album-only', intent)).toBe('album-only');
    }
  });
});
