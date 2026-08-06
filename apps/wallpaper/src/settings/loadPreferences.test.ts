import { describe, expect, it } from 'vitest';
import { defaultWallpaperPreferences } from '@spotify-wallpaper/shared-types';
import { loadWallpaperPreferences } from './loadPreferences';

const storageTarget = (removeItem: (key: string) => void, getItem: (key: string) => string | null = () => {
  throw new Error('credential storage must not be read');
}) =>
  ({ localStorage: { removeItem, getItem } as Storage }) as Window;

describe('loadWallpaperPreferences', () => {
  it('migrates v1 preferences without importing embedded credentials', () => {
    const removed: string[] = [];
    const loaded = loadWallpaperPreferences(
      JSON.stringify({
        schemaVersion: 1,
        spotify: {
          playbackProvider: 'direct',
          clientId: 'client-id',
          refreshToken: 'refresh-token',
          hasRefreshToken: true
        },
        debug: { enabled: true }
      }),
      storageTarget((key) => removed.push(key))
    );

    expect(removed).toHaveLength(1);
    expect(loaded.preferences.schemaVersion).toBe(2);
    expect(loaded.preferences.spotify.provider).toBe('direct');
    expect(loaded.preferences.debug.enabled).toBe(true);
    expect(loaded.reauthorizationRequired).toBe(true);
    expect(loaded.networkAllowed).toBe(false);
    expect(JSON.stringify(loaded.preferences)).not.toMatch(/client-id|refresh-token|hasRefreshToken/i);
  });

  it('keeps malformed and future input mock-only', () => {
    for (const source of ['{not-json', JSON.stringify({ schemaVersion: 99 })]) {
      const loaded = loadWallpaperPreferences(source, storageTarget(() => undefined));

      expect(loaded.preferences).toEqual(defaultWallpaperPreferences());
      expect(loaded.preferences.spotify.provider).toBe('mock');
      expect(loaded.networkAllowed).toBe(false);
      expect(loaded.warning).toBeTruthy();
    }
  });

  it('fails closed to mock mode when legacy cleanup fails', () => {
    const loaded = loadWallpaperPreferences(
      JSON.stringify({ schemaVersion: 2, spotify: { provider: 'mock' } }),
      storageTarget(() => {
        throw new Error('storage unavailable');
      })
    );

    expect(loaded.preferences).toEqual(defaultWallpaperPreferences());
    expect(loaded.networkAllowed).toBe(false);
    expect(loaded.warning).toBe('Legacy credential cleanup failed; Spotify network is disabled.');
  });

  it('allows the v2 mock default to run without Spotify', () => {
    const loaded = loadWallpaperPreferences(undefined, storageTarget(() => undefined));

    expect(loaded.preferences.spotify.provider).toBe('mock');
    expect(loaded.networkAllowed).toBe(true);
    expect(loaded.reauthorizationRequired).toBe(false);
  });
});
