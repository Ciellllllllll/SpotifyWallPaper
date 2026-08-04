import { describe, expect, it } from 'vitest';
import {
  isNormalizedPlaybackResultEnvelope,
  isProviderResultEnvelope
} from '@spotify-wallpaper/shared-types';
import errorRateLimited from '../../../tests/contracts/provider-v1/error-rate-limited.json';
import errorUnauthorized from '../../../tests/contracts/provider-v1/error-unauthorized.json';
import controlSeek from '../../../tests/contracts/provider-v1/control-seek.json';
import successItemNone from '../../../tests/contracts/provider-v1/success-item-none.json';
import successPlaying from '../../../tests/contracts/provider-v1/success-playing.json';
import { apiError } from '../src/http';
import { emptySpotifyPlayback, normalizeSpotifyPlayback } from '../src/normalize';
import { fetchSpotifyPlayback, sendSpotifyCommand } from '../src/spotify';

describe('provider-v1 language-neutral fixtures', () => {
  it('serializes Worker normalization into the exact success-playing fixture', () => {
    const result = normalizeSpotifyPlayback(
      {
        is_playing: true,
        progress_ms: 12_000,
        shuffle_state: false,
        repeat_state: 'off',
        device: {
          id: null,
          name: null,
          type: null,
          is_active: false,
          is_restricted: false,
          volume_percent: 75
        },
        item: {
          type: 'track',
          id: 'track-1',
          uri: 'spotify:track:track-1',
          name: 'Example Track',
          duration_ms: 180_000,
          artists: [{ name: 'Example Artist' }],
          album: {
            name: 'Example Album',
            images: [{ url: 'https://i.scdn.co/image/example' }]
          },
          external_urls: { spotify: 'https://open.spotify.com/track/track-1' }
        }
      },
      '2026-08-04T00:00:00.000Z'
    );

    expect(result).toEqual(successPlaying);
    expect(isNormalizedPlaybackResultEnvelope(result)).toBe(true);
  });

  it('serializes Worker empty playback into the exact item-none fixture', () => {
    const result = {
      ok: true as const,
      value: emptySpotifyPlayback('2026-08-04T00:00:00.000Z')
    };

    expect(result).toEqual(successItemNone);
    expect(isNormalizedPlaybackResultEnvelope(result)).toBe(true);
  });

  it('serializes Worker error responses into the exact error fixtures', async () => {
    const unauthorized = await apiError(
      401,
      'unauthorized',
      'Spotify authorization is required.'
    ).json();
    const rateLimited = await apiError(
      429,
      'rate_limited',
      'Spotify rate limit reached.',
      5000
    ).json();

    expect(unauthorized).toEqual(errorUnauthorized);
    expect(rateLimited).toEqual(errorRateLimited);
  });

  it('maps production Spotify transport results to the exact item-none and control fixtures', async () => {
    const playback = await fetchSpotifyPlayback(
      'access-token',
      async () => new Response(null, { status: 204 }),
      '2026-08-04T00:00:00.000Z'
    );
    const control = await sendSpotifyCommand(
      'access-token',
      { type: 'seek', positionMs: 42_000 },
      async () => new Response(null, { status: 204 })
    );

    expect(playback).toEqual(successItemNone);
    expect(control).toEqual(controlSeek.result);
    expect(isNormalizedPlaybackResultEnvelope(playback)).toBe(true);
    expect(isProviderResultEnvelope(control)).toBe(true);
  });
});
