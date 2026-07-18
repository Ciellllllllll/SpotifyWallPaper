import { afterEach, describe, expect, it, vi } from 'vitest';
import trackFixture from '../../../../tests/fixtures/spotify/current-playback-track.json';
import { mockPlayback } from '../mock/mockPlayback';
import { defaultSettings } from '../settings/defaultSettings';
import {
  BackendPlaybackProvider,
  credentialsFromSettings,
  nextPollingDelayMs,
  playbackHistoryAfterPoll,
  playbackProviderFromSettings,
  SpotifyPlaybackSession
} from './polling';

describe('Spotify polling decisions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it('keeps browser mock mode without credentials and direct mode with credentials', () => {
    expect(playbackProviderFromSettings(defaultSettings)).toBeNull();
    expect(
      playbackProviderFromSettings({
        ...defaultSettings,
        spotify: {
          ...defaultSettings.spotify,
          playbackProvider: 'direct',
          clientId: 'client-id',
          refreshToken: 'refresh-token',
          hasRefreshToken: true
        }
      })
    ).toBeInstanceOf(SpotifyPlaybackSession);
  });

  it('preserves current and previous playback references after a polling error', () => {
    const previous = {
      ...mockPlayback,
      id: 'previous-track',
      title: 'Previous Track'
    };
    const state = {
      playback: {
        ...mockPlayback,
        id: 'current-track',
        title: 'Current Track'
      },
      previousPlayback: previous
    };

    const retained = playbackHistoryAfterPoll(state, {
      ok: false,
      error: {
        kind: 'unavailable',
        message: 'secret-pairing-token'
      }
    });

    expect(retained).toBe(state);
    expect(retained.playback).toBe(state.playback);
    expect(retained.previousPlayback).toBe(previous);
  });

  it('moves A to previous on A-to-B and retains A on same-item B updates', () => {
    const trackA = { ...mockPlayback, id: 'track-a', title: 'Track A' };
    const trackB = { ...mockPlayback, id: 'track-b', title: 'Track B' };
    const updatedTrackB = { ...trackB, progressMs: trackB.progressMs + 1000 };

    const changed = playbackHistoryAfterPoll(
      { playback: trackA, previousPlayback: null },
      { ok: true, value: trackB }
    );
    const updated = playbackHistoryAfterPoll(changed, {
      ok: true,
      value: updatedTrackB
    });

    expect(changed).toEqual({
      playback: trackB,
      previousPlayback: trackA
    });
    expect(updated).toEqual({
      playback: updatedTrackB,
      previousPlayback: trackA
    });
  });

  it('moves B to previous when B-to-C arrives during an existing transition', () => {
    const trackA = { ...mockPlayback, id: 'track-a', title: 'Track A' };
    const trackB = { ...mockPlayback, id: 'track-b', title: 'Track B' };
    const trackC = { ...mockPlayback, id: 'track-c', title: 'Track C' };

    const changed = playbackHistoryAfterPoll(
      { playback: trackB, previousPlayback: trackA },
      { ok: true, value: trackC }
    );

    expect(changed).toEqual({
      playback: trackC,
      previousPlayback: trackB
    });
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

  it('does not fall back to direct credentials when the selected backend is invalid', () => {
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

    expect(provider).toBeNull();
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
    for (const call of calls) {
      expect(call.init).toMatchObject({
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });
    }
  });

  it('accepts only the exact build-time HTTPS origin', async () => {
    vi.stubEnv('VITE_SPOTIFY_BACKEND_ORIGIN', 'https://api.wallpaper.example');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ ok: true, value: trackFixture });
    }) as typeof fetch;
    const official = new BackendPlaybackProvider(
      {
        backendUrl: 'https://api.wallpaper.example/',
        pairingToken: 'secret-pairing-token'
      },
      fetcher
    );
    const arbitrary = new BackendPlaybackProvider(
      {
        backendUrl: 'https://attacker.example/',
        pairingToken: 'secret-pairing-token'
      },
      fetcher
    );

    await expect(official.poll(0)).resolves.toMatchObject({ ok: true });
    await expect(arbitrary.poll(0)).resolves.toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.wallpaper.example/api/playback');
  });

  it.each([
    'https://user@api.wallpaper.example/',
    'https://@api.wallpaper.example/',
    'https://api.wallpaper.example/setup',
    'https://api.wallpaper.example/./',
    'https://api.wallpaper.example/%2e',
    'https://api.wallpaper.example/?token=value',
    'https://api.wallpaper.example/?',
    'https://api.wallpaper.example/#fragment',
    'https://api.wallpaper.example/#'
  ])('rejects a non-origin backend URL before sending the pairing token: %s', async (backendUrl) => {
    vi.stubEnv('VITE_SPOTIFY_BACKEND_ORIGIN', 'https://api.wallpaper.example');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(trackFixture), { status: 200 });
    }) as typeof fetch;
    const provider = new BackendPlaybackProvider(
      { backendUrl, pairingToken: 'secret-pairing-token' },
      fetcher
    );

    const result = await provider.poll(0);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('rejects redirects without following them or forwarding the pairing token', async () => {
    vi.stubEnv('VITE_SPOTIFY_BACKEND_ORIGIN', 'https://api.wallpaper.example');
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe('error');
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://attacker.example/collect' }
        });
      }
    ) as unknown as typeof fetch;
    const provider = new BackendPlaybackProvider(
      {
        backendUrl: 'https://api.wallpaper.example',
        pairingToken: 'secret-pairing-token'
      },
      fetcher
    );

    await expect(provider.poll(0)).resolves.toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses public backend polling defaults while retaining direct and loopback defaults', () => {
    vi.stubEnv('VITE_SPOTIFY_BACKEND_ORIGIN', 'https://api.wallpaper.example');
    const publicSettings = {
      ...defaultSettings,
      spotify: {
        ...defaultSettings.spotify,
        playbackProvider: 'backend' as const,
        backendUrl: 'https://api.wallpaper.example',
        pairingToken: 'secret-pairing-token'
      }
    };
    const loopbackSettings = {
      ...publicSettings,
      spotify: {
        ...publicSettings.spotify,
        backendUrl: 'http://127.0.0.1:49320'
      }
    };

    expect(
      nextPollingDelayMs({
        playback: { isPlaying: true } as never,
        settings: publicSettings
      })
    ).toBe(2000);
    expect(
      nextPollingDelayMs({
        playback: { isPlaying: false } as never,
        settings: publicSettings
      })
    ).toBe(5000);
    expect(
      nextPollingDelayMs({
        playback: { isPlaying: true } as never,
        settings: loopbackSettings
      })
    ).toBe(1000);
    expect(
      nextPollingDelayMs({
        playback: { isPlaying: false } as never,
        settings: loopbackSettings
      })
    ).toBe(3000);
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

  it('never reflects a backend-provided error message', async () => {
    const provider = new BackendPlaybackProvider(
      {
        backendUrl: 'http://127.0.0.1:49320/',
        pairingToken: 'secret-pairing-token'
      },
      (async () =>
        Response.json(
          {
            ok: false,
            error: {
              kind: 'unauthorized',
              message: 'accidental secret-pairing-token reflection',
              status: 401
            }
          },
          { status: 401 }
        )) as typeof fetch
    );

    const result = await provider.poll(0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Spotify authorization is required.');
    expect(JSON.stringify(result.error)).not.toContain('secret-pairing-token');
  });

  it.each(['1e309', '-1', '1.5', '86400001'])(
    'drops an unsafe backend retry delay: %s',
    async (retryAfterMs) => {
      const provider = new BackendPlaybackProvider(
        {
          backendUrl: 'http://127.0.0.1:49320/',
          pairingToken: 'secret-pairing-token'
        },
        (async () =>
          new Response(
            `{"ok":false,"error":{"kind":"rate_limited","message":"ignored","retryAfterMs":${retryAfterMs},"status":429}}`,
            { status: 429 }
          )) as typeof fetch
      );

      const result = await provider.poll(0);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.retryAfterMs).toBeUndefined();
      expect(
        nextPollingDelayMs({
          playback: mockPlayback,
          error: result.error,
          consecutiveErrors: 0,
          settings: defaultSettings
        })
      ).toBe(5000);
    }
  );

  it('drops an oversized retry-after header on the malformed-body fallback path', async () => {
    const provider = new BackendPlaybackProvider(
      {
        backendUrl: 'http://127.0.0.1:49320/',
        pairingToken: 'secret-pairing-token'
      },
      (async () =>
        new Response('not-json', {
          status: 429,
          headers: { 'Retry-After': '2147484' }
        })) as typeof fetch
    );

    const result = await provider.poll(0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryAfterMs).toBeUndefined();
    expect(
      nextPollingDelayMs({
        playback: mockPlayback,
        error: result.error,
        settings: defaultSettings
      })
    ).toBe(5000);
  });
});
