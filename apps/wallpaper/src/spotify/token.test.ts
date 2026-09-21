import { describe, expect, it } from 'vitest';
import { refreshAccessToken, shouldRefreshToken } from './token';
import type { Fetcher } from './types';

describe('Spotify token refresh', () => {
  it.each([
    { access_token: '', expires_in: 3600 },
    { access_token: 'dummy-access', expires_in: 0 },
    { access_token: 'dummy-access', expires_in: -1 },
    { access_token: 'dummy-access', expires_in: 1e20 }
  ])('rejects malformed successful token responses', async (payload) => {
    const result = await refreshAccessToken({ clientId: 'dummy-client', refreshToken: 'dummy-refresh' }, async () => Response.json(payload), 0);
    expect(result).toMatchObject({ ok: false, error: { kind: 'unknown_response_shape' } });
  });

  it('does not immediately refresh a short-lived token', async () => {
    const result = await refreshAccessToken({ clientId: 'dummy-client', refreshToken: 'dummy-refresh' }, async () => Response.json({ access_token: 'dummy-access', expires_in: 10 }), 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(shouldRefreshToken(result.value, 0)).toBe(false);
    expect(shouldRefreshToken(result.value, 10_000)).toBe(true);
  });

  it.each([null, ''])('retains the existing refresh token for an empty optional rotation', async (refresh_token) => {
    const result = await refreshAccessToken({ clientId: 'dummy-client', refreshToken: 'dummy-refresh' }, async () => Response.json({ access_token: 'dummy-access', expires_in: 3600, refresh_token }), 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.refreshToken).toBeUndefined();
  });

  it('distinguishes invalid_grant from an ordinary unauthorized response', async () => {
    const run = (response: Response) => refreshAccessToken({ clientId: 'dummy-client', refreshToken: 'dummy-refresh' }, async () => response, 0);
    expect(await run(Response.json({ error: 'invalid_grant' }, { status: 400 }))).toMatchObject({ ok: false, invalidGrant: true });
    expect(await run(new Response(null, { status: 401 }))).not.toHaveProperty('invalidGrant');
  });

  it('refreshes with PKCE-compatible public client fields only', async () => {
    let bodyText = '';
    const fetcher: Fetcher = async (_input, init) => {
      bodyText = String(init?.body);
      return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), { status: 200 });
    };

    const result = await refreshAccessToken(
      { clientId: 'client-id', refreshToken: 'refresh-token' },
      fetcher,
      1000
    );

    expect(result.ok).toBe(true);
    expect(bodyText).toContain('grant_type=refresh_token');
    expect(bodyText).toContain('client_id=client-id');
    expect(bodyText).toContain('refresh_token=refresh-token');
    expect(bodyText).not.toContain('client_secret');
  });

  it('does not echo token values in classified refresh errors', async () => {
    const fetcher: Fetcher = async () => new Response('denied', { status: 401 });
    const result = await refreshAccessToken(
      { clientId: 'client-id', refreshToken: 'secret-refresh-token' },
      fetcher,
      1000
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).not.toContain('secret-refresh-token');
  });

  it('refreshes expired or nearly expired tokens only', () => {
    expect(shouldRefreshToken(null, 1000)).toBe(true);
    expect(shouldRefreshToken({ accessToken: 'token', expiresAtMs: 60_000 }, 31_000)).toBe(true);
    expect(shouldRefreshToken({ accessToken: 'token', expiresAtMs: 120_000 }, 31_000)).toBe(false);
  });
});
