import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaultSettings';
import {
  clearStoredSpotifyCredentials,
  persistSpotifyCredentials,
  readStoredSpotifyCredentials,
  SPOTIFY_CREDENTIAL_STORAGE_KEY
} from './spotifyCredentialCache';

const storageTarget = () => {
  const store = new Map<string, string>();
  return {
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
};

describe('Spotify credential cache', () => {
  it('persists and reads Spotify credentials without requiring settings JSON', () => {
    const target = storageTarget();

    persistSpotifyCredentials(
      {
        ...defaultSettings,
        spotify: {
          ...defaultSettings.spotify,
          clientId: 'client-id',
          refreshToken: 'refresh-token',
          hasRefreshToken: true
        }
      },
      target
    );

    expect(readStoredSpotifyCredentials(target)).toEqual({
      clientId: 'client-id',
      refreshToken: 'refresh-token'
    });
  });

  it('does not persist incomplete credentials and supports explicit clearing', () => {
    const target = storageTarget();

    persistSpotifyCredentials(defaultSettings, target);
    expect(target.localStorage.getItem(SPOTIFY_CREDENTIAL_STORAGE_KEY)).toBeNull();

    target.localStorage.setItem(
      SPOTIFY_CREDENTIAL_STORAGE_KEY,
      JSON.stringify({ v: 1, clientId: 'client-id', refreshToken: 'refresh-token' })
    );
    clearStoredSpotifyCredentials(target);

    expect(readStoredSpotifyCredentials(target)).toBeNull();
  });

  it('removes stale credentials when settings explicitly have no refresh token', () => {
    const target = storageTarget();
    target.localStorage.setItem(
      SPOTIFY_CREDENTIAL_STORAGE_KEY,
      JSON.stringify({ v: 1, clientId: 'client-id', refreshToken: 'refresh-token' })
    );

    persistSpotifyCredentials(defaultSettings, target);

    expect(readStoredSpotifyCredentials(target)).toBeNull();
  });

  it('removes stale credentials when the credential pair is incomplete', () => {
    const target = storageTarget();
    target.localStorage.setItem(
      SPOTIFY_CREDENTIAL_STORAGE_KEY,
      JSON.stringify({ v: 1, clientId: 'old-client', refreshToken: 'old-refresh-token' })
    );

    persistSpotifyCredentials(
      {
        ...defaultSettings,
        spotify: {
          ...defaultSettings.spotify,
          clientId: '',
          refreshToken: 'old-refresh-token',
          hasRefreshToken: true
        }
      },
      target
    );

    expect(readStoredSpotifyCredentials(target)).toBeNull();
  });
});
