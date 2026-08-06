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
  sanitizeErrorMessage,
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
  it('generates a valid PKCE verifier and challenge', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await codeChallenge(verifier);

    expect(verifier).toHaveLength(96);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain('=');
  });

  it('builds a GitHub Pages callback redirect URI', () => {
    expect(buildRedirectUri('https://example.github.io', '/SpotifyWallPaper/spotify-auth/')).toBe(
      'https://example.github.io/SpotifyWallPaper/spotify-auth/callback'
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

    expect(token.startsWith('swpt1.')).toBe(true);
    expect(JSON.parse(json)).toEqual({
      v: 1,
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

    expect(result).toEqual({ ok: true, refreshToken: 'refresh-token', expiresIn: 3600 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(storage.values.size).toBe(0);
    vi.useRealTimers();
  });

  it('rejects state mismatch and clears PKCE storage', async () => {
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
    expect(storage.values.size).toBe(0);
  });

  it('explains access_denied without leaking callback secrets', async () => {
    const storage = memoryStorage();
    await buildAuthorizeUrl({ clientId: 'client-id', redirectUri: 'https://example.github.io/app/callback' }, storage);

    const result = await exchangeCallbackForToken(
      'https://example.github.io/app/callback?error=access_denied&error_description=User%20not%20registered&state=ignored',
      'client-id',
      'https://example.github.io/app/callback',
      vi.fn() as unknown as typeof fetch,
      storage
    );

    expect(result).toEqual({
      ok: false,
      message:
        'Spotify rejected authorization. If the app is in Development mode, add this Spotify account under Spotify Dashboard > User Management, then start again.'
    });
    expect(storage.values.size).toBe(0);
  });

  it('explains Spotify server_error as an app settings check', async () => {
    const storage = memoryStorage();
    await buildAuthorizeUrl({ clientId: 'client-id', redirectUri: 'https://example.github.io/app/callback' }, storage);

    const result = await exchangeCallbackForToken(
      'https://example.github.io/app/callback?error=server_error&state=ignored',
      'client-id',
      'https://example.github.io/app/callback',
      vi.fn() as unknown as typeof fetch,
      storage
    );

    expect(result).toEqual({
      ok: false,
      message:
        'Spotify returned server_error before issuing a code. In Spotify Dashboard, confirm this Client ID belongs to the app and add https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/callback under Redirect URIs exactly.'
    });
    expect(storage.values.size).toBe(0);
  });

  it('redacts token-like values from error messages', () => {
    expect(sanitizeErrorMessage('failed code=secret-code refresh_token=secret-token access_token=secret-access')).toBe(
      'failed code=[redacted] refresh_token=[redacted] access_token=[redacted]'
    );
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
