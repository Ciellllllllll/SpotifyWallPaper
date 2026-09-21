import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  buildRedirectUri,
  clearAuthSession,
  codeChallenge,
  encodeWallpaperEngineToken,
  exchangeCallbackForToken,
  generateCodeVerifier,
  parseCallbackParams,
  storedClientId,
  type AuthStorage
} from './auth';

const memoryStorage = (): AuthStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    }
  };
};

describe('spotify auth PKCE', () => {
  it('returns a fixed failure when the sessionStorage getter throws', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('dummy denied storage'); } });
    try {
      const fetcher = vi.fn();
      await expect(exchangeCallbackForToken('https://example.github.io/app/callback/', 'dummy-client', 'https://example.github.io/app/callback/', fetcher)).resolves.toEqual({
        ok: false, message: '認証通信または一時保存に失敗しました。最初から認証してください。'
      });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });

  it.each(['success', 'denial'])('does not consume a newer transaction for an old callback: %s', async kind => {
    const storage = memoryStorage();
    const config = { clientId: 'dummy-client', redirectUri: 'https://example.github.io/app/callback/' };
    const old = new URL(await buildAuthorizeUrl(config, storage));
    await buildAuthorizeUrl(config, storage);
    const current = new Map(storage.values);
    const fetcher = vi.fn();
    const result = await exchangeCallbackForToken(config.redirectUri + '?' + (kind === 'success' ? 'code=dummy-code' : 'error=access_denied') + '&state=' + old.searchParams.get('state'), config.clientId, config.redirectUri, fetcher, storage);
    expect(result.ok).toBe(false);
    expect(JSON.stringify([...storage.values]) === JSON.stringify([...current])).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['client', 'redirect', 'future', 'expired'])('rejects changed or expired transaction: %s', async (change) => {
    const storage = memoryStorage();
    const redirect = 'https://example.github.io/app/callback/';
    const url = new URL(await buildAuthorizeUrl({ clientId: 'dummy-client', redirectUri: redirect }, storage));
    if (change === 'future') storage.setItem('spotify-wallpaper-auth:created-at', String(Date.now() + 60000));
    if (change === 'expired') storage.setItem('spotify-wallpaper-auth:created-at', String(Date.now() - 660000));
    const fetcher = vi.fn();
    const result = await exchangeCallbackForToken(redirect + '?code=dummy-code&state=' + url.searchParams.get('state'), change === 'client' ? 'other' : 'dummy-client', change === 'redirect' ? redirect + 'other' : redirect, fetcher, storage);
    expect(result.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('consumes before network and never clears a newer session on completion', async () => {
    const storage = memoryStorage();
    const config = { clientId: 'dummy-client', redirectUri: 'https://example.github.io/app/callback/' };
    const url = new URL(await buildAuthorizeUrl(config, storage));
    let release!: (response: Response) => void;
    const fetcher = vi.fn(async () => new Promise<Response>(resolve => { release = resolve; }));
    const callback = config.redirectUri + '?code=dummy-code&state=' + url.searchParams.get('state');
    const pending = exchangeCallbackForToken(callback, config.clientId, config.redirectUri, fetcher, storage);
    expect((await exchangeCallbackForToken(callback, config.clientId, config.redirectUri, fetcher, storage)).ok).toBe(false);
    await buildAuthorizeUrl(config, storage);
    const newState = storage.getItem('spotify-wallpaper-auth:state');
    release(Response.json({ refresh_token: 'dummy-refresh', expires_in: 3600 }));
    expect((await pending).ok).toBe(true);
    expect(storage.getItem('spotify-wallpaper-auth:state')).toBe(newState);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('generates a valid PKCE verifier and challenge', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await codeChallenge(verifier);

    expect(verifier).toHaveLength(96);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain('=');
  });

  it('builds a GitHub Pages callback redirect URI', () => {
    expect(buildRedirectUri('https://example.github.io', '/SpotifyWallPaper/spotify-auth/')).toBe(
      'https://example.github.io/SpotifyWallPaper/spotify-auth/callback/'
    );
  });

  it('encodes a single Wallpaper Engine token containing client id and refresh token', () => {
    const token = encodeWallpaperEngineToken({
      clientId: ' public-client-id ',
      refreshToken: ' refresh-token '
    });
    const encoded = token.slice('swpt1.'.length);
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    );

    expect(token.startsWith('swpt2.')).toBe(true);
    expect(JSON.parse(json)).toMatchObject({
      v: 2,
      clientId: 'public-client-id',
      refreshToken: 'refresh-token'
    });
  });

  it('stores only transient PKCE session values before authorization', async () => {
    const storage = memoryStorage();
    const url = await buildAuthorizeUrl(
      { clientId: 'client-id', redirectUri: 'https://example.github.io/app/callback' },
      storage
    );

    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect([...storage.values.keys()].sort()).toEqual([
      'spotify-wallpaper-auth:client-id',
      'spotify-wallpaper-auth:code-verifier',
      'spotify-wallpaper-auth:created-at',
      'spotify-wallpaper-auth:redirect-uri',
      'spotify-wallpaper-auth:state'
    ]);
    expect(storedClientId(storage)).toBe('client-id');
  });

  it('parses callback parameters without exposing the full callback URL', () => {
    expect(parseCallbackParams('https://example.github.io/app/callback?code=abc&state=xyz&error_description=nope')).toEqual({
      code: 'abc',
      state: 'xyz',
      error: null,
      errorDescription: 'nope'
    });
  });

  it('exchanges a matching callback and clears PKCE storage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const storage = memoryStorage();
    const authorizeUrl = await buildAuthorizeUrl(
      { clientId: 'client-id', redirectUri: 'https://example.github.io/app/callback' },
      storage
    );
    const state = new URL(authorizeUrl).searchParams.get('state');
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ refresh_token: 'refresh-token', expires_in: 3600 }), { status: 200 })
    ) as unknown as typeof fetch;

    const result = await exchangeCallbackForToken(
      `https://example.github.io/app/callback?code=auth-code&state=${state}`,
      'client-id',
      'https://example.github.io/app/callback',
      fetcher,
      storage
    );

    expect(result).toMatchObject({ ok: true, clientId: 'client-id', refreshToken: 'refresh-token', expiresIn: 3600 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(storage.values.size).toBe(0);
    vi.useRealTimers();
  });

  it('rejects state mismatch without consuming the current PKCE transaction', async () => {
    const storage = memoryStorage();
    await buildAuthorizeUrl({ clientId: 'client-id', redirectUri: 'https://example.github.io/app/callback' }, storage);

    const result = await exchangeCallbackForToken(
      'https://example.github.io/app/callback?code=auth-code&state=wrong',
      'client-id',
      'https://example.github.io/app/callback',
      vi.fn() as unknown as typeof fetch,
      storage
    );

    expect(result.ok).toBe(false);
    expect(storage.values.size).toBe(5);
  });

  it('explains access_denied without leaking callback secrets', async () => {
    const storage = memoryStorage();
    await buildAuthorizeUrl({ clientId: 'client-id', redirectUri: 'https://example.github.io/app/callback' }, storage);

    const result = await exchangeCallbackForToken(
      'https://example.github.io/app/callback?error=access_denied&error_description=User%20not%20registered&state=' + storage.getItem('spotify-wallpaper-auth:state'),
      'client-id',
      'https://example.github.io/app/callback',
      vi.fn() as unknown as typeof fetch,
      storage
    );

    expect(result).toEqual({
      ok: false,
      message:
        'Spotifyの認可が拒否・取消されました。Development ModeではDashboardのUser Managementも確認し、最初から認証してください。'
    });
    expect(storage.values.size).toBe(0);
  });

  it('explains Spotify server_error as an app settings check', async () => {
    const storage = memoryStorage();
    await buildAuthorizeUrl({ clientId: 'client-id', redirectUri: 'https://example.github.io/app/callback' }, storage);

    const result = await exchangeCallbackForToken(
      'https://example.github.io/app/callback?error=server_error&state=' + storage.getItem('spotify-wallpaper-auth:state'),
      'client-id',
      'https://example.github.io/app/callback',
      vi.fn() as unknown as typeof fetch,
      storage
    );

    expect(result).toEqual({
      ok: false,
      message:
        'Spotify側でエラーが発生しました。Client IDと画面に表示されたRedirect URIの登録を確認し、最初から認証してください。'
    });
    expect(storage.values.size).toBe(0);
  });

  it('never reflects upstream callback errors or token-like descriptions', async () => {
    const storage = memoryStorage();
    const redirectUri = 'https://example.github.io/app/callback';
    await buildAuthorizeUrl({ clientId: 'dummy-client', redirectUri }, storage);
    const url = new URL(redirectUri);
    url.searchParams.set('state', storage.getItem('spotify-wallpaper-auth:state')!);
    url.searchParams.set('error', 'dummy-private-error');
    url.searchParams.set('error_description', 'code=dummy-code refresh_token=dummy-refresh access_token=dummy-access');
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await exchangeCallbackForToken(url.href, 'dummy-client', redirectUri, fetcher, storage);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('dummy-');
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it('clears transient auth storage explicitly', () => {
    const storage = memoryStorage();
    storage.setItem('spotify-wallpaper-auth:code-verifier', 'verifier');
    storage.setItem('spotify-wallpaper-auth:client-id', 'client-id');
    storage.setItem('spotify-wallpaper-auth:state', 'state');
    storage.setItem('spotify-wallpaper-auth:created-at', '1');

    clearAuthSession(storage);

    expect(storage.values.size).toBe(0);
  });
});
