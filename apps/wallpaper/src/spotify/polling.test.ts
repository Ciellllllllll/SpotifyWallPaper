import { describe, expect, it } from 'vitest';
import trackFixture from '../../../../tests/fixtures/spotify/current-playback-track.json';
import { defaultSettings } from '../settings/defaultSettings';
import { credentialsFromSettings, nextPollingDelayMs, SpotifyPlaybackSession } from './polling';

describe('Spotify polling decisions', () => {
  it('uses configured playing and paused polling intervals', () => {
    expect(nextPollingDelayMs({ playback: { isPlaying: true } as never, settings: defaultSettings })).toBe(1000);
    expect(nextPollingDelayMs({ playback: { isPlaying: false } as never, settings: defaultSettings })).toBe(3000);
  });

  it('backs off on errors and respects rate-limit delay', () => {
    expect(nextPollingDelayMs({ error: { kind: 'network_error', message: 'network' }, consecutiveErrors: 2 })).toBe(15000);
    expect(
      nextPollingDelayMs({
        error: { kind: 'rate_limited', message: 'limited', retryAfterMs: 9000 },
        consecutiveErrors: 2
      })
    ).toBe(9000);
  });

  it('keeps active playback polling responsive for transient errors', () => {
    expect(
      nextPollingDelayMs({
        playback: { isPlaying: true } as never,
        error: { kind: 'unknown_response_shape', message: 'unexpected', status: 502 },
        consecutiveErrors: 20
      })
    ).toBe(5000);
  });

  it('requires both client id and refresh token', () => {
    expect(credentialsFromSettings(defaultSettings)).toBeNull();
    expect(
      credentialsFromSettings({
        ...defaultSettings,
        spotify: {
          ...defaultSettings.spotify,
          clientId: 'client-id',
          refreshToken: 'refresh-token',
          hasRefreshToken: true
        }
      })
    ).toEqual({ clientId: 'client-id', refreshToken: 'refresh-token' });
  });

  it('cools down the primary playback endpoint after a fallback success', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      if (String(url).includes('/api/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), { status: 200 });
      }

      if (String(url).endsWith('/v1/me/player')) {
        return new Response('upstream unavailable', { status: 502 });
      }

      return new Response(JSON.stringify(trackFixture), { status: 200 });
    }) as typeof fetch;
    const session = new SpotifyPlaybackSession({ clientId: 'client-id', refreshToken: 'refresh-token' }, fetcher);

    await session.poll(0);
    await session.poll(1000);
    await session.poll(6000);

    expect(calls).toEqual([
      'https://accounts.spotify.com/api/token',
      'https://api.spotify.com/v1/me/player',
      'https://api.spotify.com/v1/me/player/currently-playing',
      'https://api.spotify.com/v1/me/player/currently-playing',
      'https://api.spotify.com/v1/me/player',
      'https://api.spotify.com/v1/me/player/currently-playing'
    ]);
  });
});
