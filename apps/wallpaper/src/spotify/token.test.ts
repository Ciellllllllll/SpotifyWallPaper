import { describe, expect, it } from 'vitest';
import { refreshAccessToken, shouldRefreshToken } from './token';
import type { Fetcher } from './types';

describe('Spotify token refresh', () => {
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
