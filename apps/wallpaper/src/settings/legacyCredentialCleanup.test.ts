import { describe, expect, it } from 'vitest';
import {
  cleanupLegacySpotifyCredentialStorage,
  SPOTIFY_CREDENTIAL_STORAGE_KEY
} from './spotifyCredentialCache';

const storageTarget = (removeItem: (key: string) => void, getItem: (key: string) => string | null = () => {
  throw new Error('getItem must not be called');
}) =>
  ({
    localStorage: {
      removeItem,
      getItem
    } as Storage
  }) as Window;

describe('legacy Spotify credential cleanup', () => {
  it('deletes the known key without reading its value', () => {
    const removed: string[] = [];
    const result = cleanupLegacySpotifyCredentialStorage(
      storageTarget((key) => removed.push(key))
    );

    expect(result).toEqual({ attempted: true, succeeded: true });
    expect(removed).toEqual([SPOTIFY_CREDENTIAL_STORAGE_KEY]);
  });

  it('fails closed when storage deletion throws', () => {
    const result = cleanupLegacySpotifyCredentialStorage(
      storageTarget(() => {
        throw new Error('storage unavailable');
      })
    );

    expect(result).toEqual({ attempted: true, succeeded: false });
  });

  it('reports no attempt when no browser storage target exists', () => {
    expect(cleanupLegacySpotifyCredentialStorage(undefined)).toEqual({ attempted: false, succeeded: false });
  });
});
