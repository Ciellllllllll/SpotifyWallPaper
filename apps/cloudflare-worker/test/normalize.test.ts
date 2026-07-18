import { describe, expect, it } from 'vitest';

import episodeFixture from '../../../tests/fixtures/spotify/current-playback-episode.json';
import itemNullFixture from '../../../tests/fixtures/spotify/current-playback-item-null.json';
import missingImageFixture from '../../../tests/fixtures/spotify/current-playback-missing-image.json';
import trackFixture from '../../../tests/fixtures/spotify/current-playback-track.json';
import { emptySpotifyPlayback, normalizeSpotifyPlayback } from '../src/normalize';

const fetchedAt = '2026-07-18T00:00:00.000Z';

describe('normalizeSpotifyPlayback', () => {
  it('normalizes track playback without exposing raw Spotify JSON', () => {
    const result = normalizeSpotifyPlayback(trackFixture, fetchedAt);

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        source: 'spotify',
        itemType: 'track',
        id: 'track-1',
        title: 'Current Song',
        artists: ['First Artist', 'Second Artist'],
        albumName: 'Current Album',
        albumImageUrl: 'https://i.scdn.co/image/large',
        durationMs: 180000,
        progressMs: 65000,
        isPlaying: true,
        deviceName: 'Desktop',
        volumePercent: 55,
        fetchedAt
      })
    });
    expect(JSON.stringify(result)).not.toContain('"available_markets"');
  });

  it('normalizes episodes, null items, and missing artwork safely', () => {
    const episode = normalizeSpotifyPlayback(episodeFixture, fetchedAt);
    const itemNull = normalizeSpotifyPlayback(itemNullFixture, fetchedAt);
    const missingImage = normalizeSpotifyPlayback(missingImageFixture, fetchedAt);

    expect(episode).toMatchObject({
      ok: true,
      value: {
        source: 'spotify',
        itemType: 'episode',
        artists: ['Mock Publisher'],
        albumName: 'Mock Show',
        albumImageUrl: 'https://i.scdn.co/image/show'
      }
    });
    expect(itemNull).toMatchObject({
      ok: true,
      value: {
        source: 'spotify',
        itemType: 'none',
        title: 'Nothing Playing'
      }
    });
    expect(missingImage).toMatchObject({
      ok: true,
      value: {
        albumImageUrl: 'mock/album-placeholder.svg'
      }
    });
  });

  it('rejects malformed top-level and item shapes', () => {
    expect(normalizeSpotifyPlayback(null, fetchedAt)).toEqual({
      ok: false,
      error: {
        kind: 'unknown_response_shape',
        message: 'Spotify playback response shape was unexpected.'
      }
    });
    expect(normalizeSpotifyPlayback({ item: 'not-an-object' }, fetchedAt)).toEqual({
      ok: false,
      error: {
        kind: 'unknown_response_shape',
        message: 'Spotify playback item shape was unexpected.'
      }
    });
  });

  it('produces a spotify-sourced empty model for HTTP 204', () => {
    expect(emptySpotifyPlayback(fetchedAt)).toMatchObject({
      source: 'spotify',
      itemType: 'none',
      title: 'Nothing Playing',
      isPlaying: false,
      fetchedAt
    });
  });
});
