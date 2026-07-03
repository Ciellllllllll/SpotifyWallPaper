import { describe, expect, it } from 'vitest';
import trackFixture from '../../../../tests/fixtures/spotify/current-playback-track.json';
import { defaultSettings } from '../settings/defaultSettings';
import {
  BackendPlaybackProvider,
  credentialsFromSettings,
  nextPollingDelayMs,
  playbackProviderFromSettings,
  SpotifyPlaybackSession
} from './polling';

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

  it('uses a backend playback provider when backend settings are configured', async () => {
    const provider = playbackProviderFromSettings(
      {
        ...defaultSettings,
        spotify: {
          ...defaultSettings.spotify,
          playbackProvider: 'backend',
          backendUrl: 'http://127.0.0.1:49320/',
          pairingToken: 'secret-pairing-token'
        }
      },
      (() => Promise.resolve(new Response(JSON.stringify(trackFixture), { status: 200 }))) as typeof fetch
    );

    expect(provider).toBeInstanceOf(BackendPlaybackProvider);
    const result = await provider?.poll(0);

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.value.title).toBe('Current Song');
  });

  it('falls back to direct credential polling when backend settings are not configured', () => {
    const provider = playbackProviderFromSettings({
      ...defaultSettings,
      spotify: {
        ...defaultSettings.spotify,
        clientId: 'client-id',
        refreshToken: 'refresh-token',
        hasRefreshToken: true,
        playbackProvider: 'backend',
        backendUrl: '',
        pairingToken: 'secret-pairing-token'
      }
    });

    expect(provider).toBeInstanceOf(SpotifyPlaybackSession);
  });

  it('calls backend playback and control endpoints with bearer pairing token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(trackFixture), { status: 200 });
    }) as typeof fetch;
    const provider = new BackendPlaybackProvider(
      { backendUrl: 'http://127.0.0.1:49320/', pairingToken: 'secret-pairing-token' },
      fetcher
    );

    await provider.poll(0);
    await provider.control({ type: 'pause' }, 1000);

    expect(calls.map((call) => [call.url, call.init?.method, (call.init?.headers as Record<string, string>).authorization])).toEqual([
      ['http://127.0.0.1:49320/api/playback', 'GET', 'Bearer secret-pairing-token'],
      ['http://127.0.0.1:49320/api/control', 'POST', 'Bearer secret-pairing-token']
    ]);
    expect(calls[1].init?.body).toBe(JSON.stringify({ type: 'pause' }));
  });

  it('rejects non-loopback backend URLs before sending the pairing token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(trackFixture), { status: 200 });
    }) as typeof fetch;
    const provider = new BackendPlaybackProvider(
      { backendUrl: 'https://example.com:49320/', pairingToken: 'secret-pairing-token' },
      fetcher
    );

    const result = await provider.poll(0);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('preserves backend rate-limit retry delay from error payloads', async () => {
    const provider = new BackendPlaybackProvider(
      { backendUrl: 'http://127.0.0.1:49320/', pairingToken: 'secret-pairing-token' },
      (async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              kind: 'rate_limited',
              message: 'Spotify rate limit reached.',
              retryAfterMs: 12000,
              status: 429
            }
          }),
          { status: 429 }
        )) as typeof fetch
    );

    const result = await provider.poll(0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('rate_limited');
    expect(result.error.retryAfterMs).toBe(12000);
  });
});
