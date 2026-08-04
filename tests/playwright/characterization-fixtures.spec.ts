import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fixturesDirectory = resolve('tests/fixtures/characterization');

test('keeps the Phase 1 characterization fixture inventory explicit', () => {
  const expected = [
    'audio-reduced-motion.json',
    'known-baseline-divergences.json',
    'long-title.json',
    'preset-default.json',
    'provider-item-none.json',
    'provider-missing-art.json',
    'provider-paused.json',
    'provider-playing.json',
    'settings-v1.json',
    'transition.json'
  ];

  expect(readdirSync(fixturesDirectory).filter((file) => file.endsWith('.json')).sort()).toEqual(expected);

  for (const file of expected) {
    const source = readFileSync(resolve(fixturesDirectory, file), 'utf8');
    expect(() => JSON.parse(source), file).not.toThrow();
    const parsed = JSON.parse(source) as Record<string, unknown> & { spotify?: Record<string, unknown> };
    switch (file) {
      case 'audio-reduced-motion.json':
        expect(parsed, file).toMatchObject({ source: 'mock', timestampMs: 1785812645000 });
        expect(parsed.samples, file).toEqual([0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84, 0.96]);
        break;
      case 'known-baseline-divergences.json':
        expect(parsed, file).toMatchObject({ albumDetails: { progressVisible: false, controlsVisible: false, targetPhase: 6 } });
        break;
      case 'long-title.json':
        expect((parsed as { title: string }).title.length, file).toBeGreaterThan(100);
        break;
      case 'preset-default.json':
        expect(parsed, file).toMatchObject({ name: 'default', displayMode: 'album-only', reducedMotion: true });
        break;
      case 'provider-playing.json':
        expect(parsed, file).toMatchObject({ source: 'mock', itemType: 'track', isPlaying: true, progressMs: 94000 });
        break;
      case 'provider-paused.json':
        expect(parsed, file).toMatchObject({ source: 'mock', itemType: 'track', isPlaying: false });
        break;
      case 'provider-item-none.json':
        expect(parsed, file).toMatchObject({ source: 'mock', itemType: 'none', durationMs: 0, progressMs: 0 });
        break;
      case 'provider-missing-art.json':
        expect(parsed, file).toMatchObject({ source: 'mock', albumImageUrl: null });
        break;
      case 'settings-v1.json':
        expect(parsed.schemaVersion, file).toBe(1);
        expect(parsed.spotify?.playbackProvider, file).toBe('direct');
        expect(parsed.spotify?.backendUrl, file).toBe('');
        expect(parsed.spotify?.clientId, file).toBe('');
        expect(parsed.spotify?.hasRefreshToken, file).toBe(false);
        expect(parsed.spotify?.refreshToken ?? '', file).toBe('');
        expect(parsed.spotify?.pairingToken ?? '', file).toBe('');
        break;
      case 'transition.json':
        expect(parsed, file).toMatchObject({ reduceMotion: true, expectedPreset: 'fade' });
        break;
    }
  }
});
