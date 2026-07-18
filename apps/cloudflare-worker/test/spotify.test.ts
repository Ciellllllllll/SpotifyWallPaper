import { describe, expect, it, vi } from 'vitest';

import trackFixture from '../../../tests/fixtures/spotify/current-playback-track.json';
import {
  fetchSpotifyPlayback,
  sendSpotifyCommand,
  type SpotifyPlaybackCommand
} from '../src/spotify';

const fetchedAt = '2026-07-18T00:00:00.000Z';

describe('Spotify playback requests', () => {
  it('returns normalized playback and treats 204 as a safe empty state', async () => {
    const track = await fetchSpotifyPlayback(
      'access-token',
      vi.fn(async () => Response.json(trackFixture)),
      fetchedAt
    );
    const empty = await fetchSpotifyPlayback(
      'access-token',
      vi.fn(async () => new Response(null, { status: 204 })),
      fetchedAt
    );

    expect(track).toMatchObject({
      ok: true,
      value: { source: 'spotify', itemType: 'track', id: 'track-1' }
    });
    expect(empty).toMatchObject({
      ok: true,
      value: { source: 'spotify', itemType: 'none' }
    });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'unavailable']
  ])('maps HTTP %i to a fixed %s error', async (status, kind) => {
    const result = await fetchSpotifyPlayback(
      'access-token',
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: 'sensitive upstream body'
            }
          },
          { status }
        )
      ),
      fetchedAt
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind, status }
    });
    expect(JSON.stringify(result)).not.toContain('sensitive upstream body');
  });

  it('preserves a bounded Spotify Retry-After', async () => {
    const result = await fetchSpotifyPlayback(
      'access-token',
      vi.fn(async () =>
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': '7' }
        })
      ),
      fetchedAt
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'rate_limited',
        message: 'Spotify rate limit reached.',
        status: 429,
        retryAfterMs: 7000
      }
    });
  });

  it('returns a fixed network error without the thrown message', async () => {
    const result = await fetchSpotifyPlayback(
      'access-token',
      vi.fn(async () => {
        throw new Error('secret network details');
      }),
      fetchedAt
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'network_error',
        message: 'Spotify request failed before a response was received.'
      }
    });
  });
});

describe('Spotify control requests', () => {
  it('preserves every existing command method and query meaning', async () => {
    const calls: Array<[string, string]> = [];
    const fetcher = vi.fn(async (input: string | Request | URL, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', String(input)]);
      return new Response(null, { status: 204 });
    });
    const commands: SpotifyPlaybackCommand[] = [
      { type: 'play' },
      { type: 'pause' },
      { type: 'next' },
      { type: 'previous' },
      { type: 'seek', positionMs: 12345 },
      { type: 'volume', volumePercent: 50 },
      { type: 'shuffle', state: true },
      { type: 'repeat', state: 'context' }
    ];

    for (const command of commands) {
      await expect(sendSpotifyCommand('access-token', command, fetcher)).resolves.toEqual({
        ok: true,
        value: null
      });
    }

    expect(calls).toEqual([
      ['PUT', 'https://api.spotify.com/v1/me/player/play'],
      ['PUT', 'https://api.spotify.com/v1/me/player/pause'],
      ['POST', 'https://api.spotify.com/v1/me/player/next'],
      ['POST', 'https://api.spotify.com/v1/me/player/previous'],
      ['PUT', 'https://api.spotify.com/v1/me/player/seek?position_ms=12345'],
      ['PUT', 'https://api.spotify.com/v1/me/player/volume?volume_percent=50'],
      ['PUT', 'https://api.spotify.com/v1/me/player/shuffle?state=true'],
      ['PUT', 'https://api.spotify.com/v1/me/player/repeat?state=context']
    ]);
  });
});
