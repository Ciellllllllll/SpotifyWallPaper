import { describe, expect, it } from 'vitest';
import episodeFixture from '../../../tests/fixtures/spotify/current-playback-episode.json';
import itemNullFixture from '../../../tests/fixtures/spotify/current-playback-item-null.json';
import missingImageFixture from '../../../tests/fixtures/spotify/current-playback-missing-image.json';
import trackFixture from '../../../tests/fixtures/spotify/current-playback-track.json';
import { normalizeSpotifyPlaybackPayload } from './spotifyPlayback';

const fetchedAt = '2026-08-06T00:00:00.000Z';

describe('shared Spotify playback normalization', () => {
  it('normalizes tracks and episodes into the shared display contract', () => {
    const track = normalizeSpotifyPlaybackPayload(trackFixture, fetchedAt);
    const episode = normalizeSpotifyPlaybackPayload(episodeFixture, fetchedAt);

    expect(track).toMatchObject({
      ok: true,
      value: {
        source: 'spotify',
        itemType: 'track',
        id: 'track-1',
        uri: 'spotify:track:track-1',
        artists: ['First Artist', 'Second Artist'],
        albumName: 'Current Album',
        durationMs: 180000,
        progressMs: 65000,
        fetchedAt
      }
    });
    expect(episode).toMatchObject({
      ok: true,
      value: {
        itemType: 'episode',
        artists: ['Mock Publisher'],
        albumName: 'Mock Show',
        albumImageUrl: 'https://i.scdn.co/image/show'
      }
    });
  });

  it('normalizes null or unsupported items to the safe none invariant', () => {
    const nullItem = normalizeSpotifyPlaybackPayload(itemNullFixture, fetchedAt);
    const unsupported = normalizeSpotifyPlaybackPayload({ item: { type: 'ad', name: 'Advertisement' } }, fetchedAt);

    for (const result of [nullItem, unsupported]) {
      expect(result).toMatchObject({
        ok: true,
        value: {
          itemType: 'none',
          id: null,
          uri: null,
          durationMs: 0,
          progressMs: 0,
          isPlaying: false,
          title: 'Nothing Playing'
        }
      });
    }
  });

  it('rejects invalid timestamps and track identity while preserving the placeholder', () => {
    expect(normalizeSpotifyPlaybackPayload(trackFixture, 'not-a-timestamp')).toEqual({
      ok: false,
      error: {
        kind: 'unknown_response_shape',
        message: 'Spotify playback response shape was unexpected.'
      }
    });
    expect(normalizeSpotifyPlaybackPayload({ ...trackFixture, item: { ...trackFixture.item, id: '' } }, fetchedAt)).toEqual({
      ok: false,
      error: {
        kind: 'unknown_response_shape',
        message: 'Spotify playback item identity was unexpected.'
      }
    });
    expect(normalizeSpotifyPlaybackPayload({ ...trackFixture, item: { ...trackFixture.item, uri: '   ' } }, fetchedAt)).toMatchObject({
      ok: false,
      error: { kind: 'unknown_response_shape' }
    });
    expect(normalizeSpotifyPlaybackPayload(missingImageFixture, fetchedAt)).toMatchObject({
      ok: true,
      value: { albumImageUrl: 'mock/album-placeholder.svg' }
    });
  });

  it('clamps numeric playback values to safe contract ranges', () => {
    const result = normalizeSpotifyPlaybackPayload({
      ...trackFixture,
      progress_ms: Number.MAX_SAFE_INTEGER,
      device: { ...trackFixture.device, volume_percent: 120 },
      item: { ...trackFixture.item, duration_ms: Number.MAX_SAFE_INTEGER + 0.9 }
    }, fetchedAt);

    expect(result).toMatchObject({
      ok: true,
      value: {
        durationMs: Number.MAX_SAFE_INTEGER,
        progressMs: Number.MAX_SAFE_INTEGER,
        volumePercent: 100
      }
    });

    expect(normalizeSpotifyPlaybackPayload({
      ...trackFixture,
      progress_ms: 99,
      item: { ...trackFixture.item, duration_ms: 10 }
    }, fetchedAt)).toMatchObject({ ok: true, value: { durationMs: 10, progressMs: 10 } });

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.6]) {
      const bounded = normalizeSpotifyPlaybackPayload({
        ...trackFixture,
        progress_ms: value,
        item: { ...trackFixture.item, duration_ms: value }
      }, fetchedAt);
      expect(bounded).toMatchObject({ ok: true, value: { durationMs: value === 1.6 ? 2 : 0, progressMs: value === 1.6 ? 2 : 0 } });
    }
  });

  it('caps artist and image arrays without exposing raw Spotify fields', () => {
    const result = normalizeSpotifyPlaybackPayload({
      ...trackFixture,
      item: {
        ...trackFixture.item,
        artists: Array.from({ length: 40 }, (_, index) => ({ name: `Artist ${index}` })),
        album: {
          ...trackFixture.item.album,
          images: Array.from({ length: 10 }, (_, index) => ({ url: `https://image/${index}` }))
        }
      }
    }, fetchedAt);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artists).toHaveLength(32);
    expect(result.value.imageUrls).toHaveLength(8);
    expect(JSON.stringify(result)).not.toContain('available_markets');
  });

  it('preserves metadata text while trimming only identity fields', () => {
    const result = normalizeSpotifyPlaybackPayload({
      ...trackFixture,
      item: {
        ...trackFixture.item,
        id: '  track-1  ',
        uri: '  spotify:track:track-1  ',
        name: '  Current Song  ',
        artists: [{ name: '  First Artist  ' }],
        album: {
          name: '  Current Album  ',
          images: [{ url: '  https://image.example/cover  ' }]
        },
        external_urls: { spotify: '  https://open.spotify.com/track/track-1  ' }
      }
    }, fetchedAt);

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 'track-1',
        uri: 'spotify:track:track-1',
        title: '  Current Song  ',
        artists: ['  First Artist  '],
        albumName: '  Current Album  ',
        imageUrls: ['  https://image.example/cover  '],
        externalUrl: '  https://open.spotify.com/track/track-1  '
      }
    });
  });
});
