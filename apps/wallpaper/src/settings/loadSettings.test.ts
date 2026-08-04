import { describe, expect, it } from 'vitest';
import { loadSettings } from './loadSettings';
import { SPOTIFY_CREDENTIAL_STORAGE_KEY } from './spotifyCredentialCache';

const storageTarget = (values: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(values));
  const target = {
    localStorage: {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, value);
      }
    } as Storage
  } as Window;
  return { target, store };
};

describe('loadSettings', () => {
  it('falls back to secret-free v2 defaults for malformed settings JSON', () => {
    const loaded = loadSettings('{not json');

    expect(loaded.warning).toContain('malformed');
    expect(loaded.settings.schemaVersion).toBe(2);
    expect(loaded.settings.spotify.provider).toBe('mock');
    expect(loaded.safetyGateOpen).toBe(false);
  });

  it('drops embedded Spotify credentials from preference settings', () => {
    const loaded = loadSettings(JSON.stringify({
      spotify: { clientId: 'client-id', refreshToken: 'secret-refresh-token', hasRefreshToken: true }
    }));

    expect(loaded.settings.schemaVersion).toBe(2);
    expect(JSON.stringify(loaded.settings)).not.toMatch(/client-id|secret-refresh-token|hasRefreshToken/i);
  });

  it('preserves the v1 backend preference without importing pairing tokens', () => {
    const loaded = loadSettings(JSON.stringify({
      spotify: {
        playbackProvider: 'backend',
        backendUrl: 'https://localhost:49320/',
        pairingToken: 'secret-pairing-token',
        pollIntervalPlayingMs: 100
      }
    }));

    expect(loaded.warning).toContain('authorization');
    expect(loaded.warning).not.toContain('secret-pairing-token');
    expect(loaded.settings.spotify).toMatchObject({
      provider: 'backend',
      backendOrigin: 'https://localhost:49320/',
      pollIntervalPlayingMs: 500
    });
    expect(JSON.stringify(loaded.settings)).not.toMatch(/pairingToken|secret-pairing-token/i);
  });

  it('deletes legacy cached credentials without reading or restoring them', () => {
    const { target, store } = storageTarget({
      [SPOTIFY_CREDENTIAL_STORAGE_KEY]: JSON.stringify({ v: 1, clientId: 'cached-client', refreshToken: 'cached-refresh-token' })
    });
    const loaded = loadSettings(JSON.stringify({ debug: { enabled: true } }), target);

    expect(store.has(SPOTIFY_CREDENTIAL_STORAGE_KEY)).toBe(false);
    expect(loaded.settings.debug.enabled).toBe(true);
    expect(JSON.stringify(loaded.settings)).not.toMatch(/cached-client|cached-refresh-token/i);
  });

  it('rewrites browser settings storage to an allowlisted v2 document', () => {
    const { target, store } = storageTarget({
      'spotify-wallpaper-settings': JSON.stringify({
        spotify: { playbackProvider: 'direct', clientId: 'legacy-client', refreshToken: 'legacy-refresh' },
        player: { displayMode: 'album-details' }
      })
    });

    const loaded = loadSettings(undefined, target);
    const stored = store.get('spotify-wallpaper-settings');
    expect(loaded.settings.player.displayMode).toBe('album-details');
    expect(stored).toBeDefined();
    expect(stored).not.toMatch(/legacy-client|legacy-refresh|clientId|refreshToken/i);
    expect(JSON.parse(stored as string).schemaVersion).toBe(2);
  });

  it('removes future browser settings without writing them back and closes the safety gate', () => {
    const { target, store } = storageTarget({
      'spotify-wallpaper-settings': JSON.stringify({ schemaVersion: 99, debug: { enabled: true } })
    });

    const loaded = loadSettings(undefined, target);
    expect(store.has('spotify-wallpaper-settings')).toBe(false);
    expect(loaded.safetyGateOpen).toBe(false);
    expect(loaded.networkAllowed).toBe(false);
  });

  it('fails closed when the legacy settings key cannot be removed', () => {
    const target = {
      localStorage: {
        getItem: (key: string) => key === 'spotify-wallpaper-settings' ? JSON.stringify({ spotify: { provider: 'mock' } }) : null,
        removeItem: (key: string) => {
          if (key === 'spotify-wallpaper-settings') throw new Error('storage unavailable');
        },
        setItem: () => undefined
      }
    } as unknown as Window;

    const loaded = loadSettings(undefined, target);
    expect(loaded.warning).toContain('cleanup failed');
    expect(loaded.networkAllowed).toBe(false);
    expect(loaded.safetyGateOpen).toBe(false);
  });

  it('fails closed when the legacy settings key cannot be read', () => {
    const target = {
      localStorage: {
        getItem: () => {
          throw new Error('storage unavailable');
        },
        removeItem: () => undefined,
        setItem: () => undefined
      }
    } as unknown as Window;

    const loaded = loadSettings(undefined, target);
    expect(loaded.warning).toContain('could not be read');
    expect(loaded.networkAllowed).toBe(false);
    expect(loaded.safetyGateOpen).toBe(false);
  });

  it('applies preset coordinates while preserving all v2 categories', () => {
    const loaded = loadSettings(JSON.stringify({
      layout: { preset: 'Bottom Player' },
      albumArt: { visible: false },
      text: { visible: false },
      rainmeter: { enabled: true, outputPath: 'D:\\Rainmeter\\NowPlaying.json' }
    }));

    expect(loaded.settings.layout.items.albumArt.x).toBe(4);
    expect(loaded.settings.albumArt.visible).toBe(false);
    expect(loaded.settings.text.visible).toBe(false);
    expect(loaded.settings.rainmeter.enabled).toBe(true);
  });
});
