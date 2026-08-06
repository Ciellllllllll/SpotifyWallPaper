import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/crypto';
import {
  createCredential,
  getCredentialByPublicId,
  reauthorizeCredential,
  type Credential
} from '../src/db';
import { pairingDigest } from '../src/pairing';
import {
  fetchCredentialPlayback,
  getCredentialAccessToken
} from '../src/spotify';

const nowMs = 1_800_000_000_000;
const publicId = 'AAAAAAAAAAAAAAAAAAAAAA';
const spotifyClientId = '0123456789abcdef0123456789abcdef';
const encryptionKeys = {
  test: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};
const pairingKey = 'ggggggggggggggggggggggggggggggggggggggggggg';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM spotify_backoff'),
    env.DB.prepare('DELETE FROM oauth_sessions'),
    env.DB.prepare('DELETE FROM credentials')
  ]);
});

describe('single-flight token refresh', () => {
  it('records only a fixed successful refresh outcome', async () => {
    const credential = await createExpiredCredential();
    const writeDataPoint = vi.fn();
    const metricsEnv = {
      ...env,
      METRICS: { writeDataPoint }
    } as unknown as Env;

    const result = await getCredentialAccessToken(
      env.DB,
      credential,
      metricsEnv,
      {
        nowMs,
        fetcher: vi.fn(async () =>
          Response.json({
            access_token: 'new-access-token',
            token_type: 'Bearer',
            expires_in: 3600
          })
        )
      }
    );

    expect(result.ok).toBe(true);
    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint.mock.calls[0]?.[0]?.blobs).toEqual([
      'development',
      'refresh',
      'not_applicable',
      'not_applicable',
      'not_applicable',
      'success'
    ]);
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain(
      'new-access-token'
    );
  });

  it('makes exactly one refresh request for fifty concurrent callers', async () => {
    const credential = await createExpiredCredential();
    const fetcher = vi.fn(async (_input: string | Request | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      const body = new URLSearchParams(init?.body as string);
      expect(body.get('client_id')).toBe(spotifyClientId);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('old-refresh-token');
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({
        access_token: 'new-access-token',
        refresh_token: 'rotated-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600
      });
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        getCredentialAccessToken(env.DB, credential, env, {
          fetcher,
          nowMs,
          sleep: async () => new Promise((resolve) => setTimeout(resolve, 5))
        })
      )
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(results.every((result) => result.ok && result.value === 'new-access-token')).toBe(true);
    const stored = await getCredentialByPublicId(env.DB, publicId);
    expect(stored?.tokenVersion).toBe(2);
    expect(stored?.refreshToken).not.toBeNull();
    await expect(
      decryptSecret(
        stored!.refreshToken!,
        {
          recordId: publicId,
          spotifyClientId,
          fieldName: 'refresh_token'
        },
        encryptionKeys
      )
    ).resolves.toBe('rotated-refresh-token');
  });

  it('retains the old Refresh Token when Spotify omits rotation', async () => {
    const credential = await createExpiredCredential();
    const result = await getCredentialAccessToken(env.DB, credential, env, {
      nowMs,
      fetcher: vi.fn(async () =>
        Response.json({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      )
    });

    expect(result).toEqual({ ok: true, value: 'new-access-token' });
    const stored = await getCredentialByPublicId(env.DB, publicId);
    await expect(
      decryptSecret(
        stored!.refreshToken!,
        {
          recordId: publicId,
          spotifyClientId,
          fieldName: 'refresh_token'
        },
        encryptionKeys
      )
    ).resolves.toBe('old-refresh-token');
  });

  it('clears tokens and requires reauthorization on invalid_grant', async () => {
    const credential = await createExpiredCredential();
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: 'invalid_grant',
          error_description: 'sensitive upstream details'
        },
        { status: 400 }
      )
    );

    const result = await getCredentialAccessToken(env.DB, credential, env, {
      fetcher,
      nowMs
    });
    const stored = await getCredentialByPublicId(env.DB, publicId);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unauthorized',
        message: 'Spotify authorization is required.',
        status: 401
      }
    });
    expect(JSON.stringify(result)).not.toContain('sensitive upstream details');
    expect(stored).toMatchObject({
      authStatus: 'reauth_required',
      refreshToken: null,
      accessToken: null,
      refreshLeaseId: null
    });
  });

  it('requires reauthorization after the six-month Refresh Token lifetime', async () => {
    const credential = await createExpiredCredential();
    await env.DB.prepare(
      'UPDATE credentials SET refresh_authorized_at_ms = ? WHERE public_id = ?'
    )
      .bind(nowMs - 180 * 24 * 60 * 60 * 1000 - 1, publicId)
      .run();
    const expiredAuthorization = await getCredentialByPublicId(env.DB, publicId);
    const fetcher = vi.fn(async () => Response.json({}));

    const result = await getCredentialAccessToken(
      env.DB,
      expiredAuthorization!,
      env,
      { fetcher, nowMs }
    );
    const stored = await getCredentialByPublicId(env.DB, publicId);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unauthorized',
        message: 'Spotify authorization is required.',
        status: 401
      }
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(stored).toMatchObject({
      authStatus: 'reauth_required',
      refreshToken: null,
      accessToken: null
    });
  });

  it('persists Retry-After and skips Spotify during backoff', async () => {
    const credential = await createExpiredCredential();
    const fetcher = vi.fn(async () =>
      new Response(null, {
        status: 429,
        headers: { 'Retry-After': '9' }
      })
    );

    const first = await getCredentialAccessToken(env.DB, credential, env, {
      fetcher,
      nowMs
    });
    const second = await getCredentialAccessToken(env.DB, credential, env, {
      fetcher,
      nowMs: nowMs + 1000
    });

    expect(first).toEqual({
      ok: false,
      error: {
        kind: 'rate_limited',
        message: 'Spotify rate limit reached.',
        status: 429,
        retryAfterMs: 9000
      }
    });
    expect(second).toEqual({
      ok: false,
      error: {
        kind: 'rate_limited',
        message: 'Spotify rate limit reached.',
        status: 429,
        retryAfterMs: 8000
      }
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('persists playback API backoff and blocks the next upstream call', async () => {
    await createExpiredCredential();
    await env.DB.prepare(
      'UPDATE credentials SET access_token_expires_at_ms = ? WHERE public_id = ?'
    )
      .bind(nowMs + 3_600_000, publicId)
      .run();
    const credential = await getCredentialByPublicId(env.DB, publicId);
    const fetcher = vi.fn(async () =>
      new Response(null, {
        status: 429,
        headers: { 'Retry-After': '4' }
      })
    );

    const first = await fetchCredentialPlayback(env.DB, credential!, env, {
      fetcher,
      nowMs
    });
    const second = await fetchCredentialPlayback(env.DB, credential!, env, {
      fetcher,
      nowMs: nowMs + 1000
    });

    expect(first).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 4000 }
    });
    expect(second).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 3000 }
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('releases the lease after a network failure', async () => {
    const credential = await createExpiredCredential();
    const failed = await getCredentialAccessToken(env.DB, credential, env, {
      nowMs,
      fetcher: vi.fn(async () => {
        throw new Error('network secret');
      })
    });
    const reloaded = await getCredentialByPublicId(env.DB, publicId);
    const recovered = await getCredentialAccessToken(env.DB, reloaded!, env, {
      nowMs: nowMs + 1,
      fetcher: vi.fn(async () =>
        Response.json({
          access_token: 'recovered-access-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      )
    });

    expect(failed).toEqual({
      ok: false,
      error: {
        kind: 'network_error',
        message: 'Spotify request failed before a response was received.'
      }
    });
    expect(reloaded?.refreshLeaseId).toBeNull();
    expect(recovered).toEqual({ ok: true, value: 'recovered-access-token' });
  });

  it('times out a stalled refresh before the lease can expire', async () => {
    const credential = await createExpiredCredential();
    const fetcher = vi.fn(
      async (_input: string | Request | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        })
    );

    const result = await getCredentialAccessToken(env.DB, credential, env, {
      fetcher,
      nowMs,
      refreshTimeoutMs: 5
    });
    const stored = await getCredentialByPublicId(env.DB, publicId);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'network_error' }
    });
    expect(stored?.refreshLeaseId).toBeNull();
  });

  it('does not let a stale pre-reauthorization row acquire a new-generation lease', async () => {
    const stale = await createExpiredCredential();
    const [refreshToken, accessToken] = await Promise.all([
      encryptSecret(
        'reauthorized-refresh-token',
        { recordId: publicId, spotifyClientId, fieldName: 'refresh_token' },
        'test',
        encryptionKeys
      ),
      encryptSecret(
        'reauthorized-access-token',
        { recordId: publicId, spotifyClientId, fieldName: 'access_token' },
        'test',
        encryptionKeys
      )
    ]);
    await reauthorizeCredential(env.DB, {
      publicId,
      spotifyClientId,
      refreshToken,
      accessToken,
      accessTokenExpiresAtMs: nowMs + 3_600_000,
      refreshAuthorizedAtMs: nowMs,
      nowMs
    });
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: 'invalid_grant' },
        { status: 400 }
      )
    );

    const result = await getCredentialAccessToken(env.DB, stale, env, {
      fetcher,
      nowMs,
      sleep: async () => undefined
    });
    const stored = await getCredentialByPublicId(env.DB, publicId);

    expect(result).toEqual({ ok: true, value: 'reauthorized-access-token' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(stored).toMatchObject({
      authStatus: 'active',
      tokenVersion: 2
    });
  });

  it('refreshes once and retries playback after an early Spotify 401', async () => {
    await createExpiredCredential();
    await env.DB.prepare(
      'UPDATE credentials SET access_token_expires_at_ms = ? WHERE public_id = ?'
    )
      .bind(nowMs + 3_600_000, publicId)
      .run();
    const credential = await getCredentialByPublicId(env.DB, publicId);
    const fetcher = vi.fn(
      async (input: string | Request | URL) => {
        const url = String(input);
        if (url.endsWith('/v1/me/player') && fetcher.mock.calls.length === 1) {
          return new Response(null, { status: 401 });
        }
        if (url.endsWith('/api/token')) {
          return Response.json({
            access_token: 'replacement-access-token',
            token_type: 'Bearer',
            expires_in: 3600
          });
        }
        return Response.json({
          is_playing: false,
          progress_ms: 0,
          item: null
        });
      }
    );

    const result = await fetchCredentialPlayback(env.DB, credential!, env, {
      fetcher,
      nowMs
    });

    expect(result).toMatchObject({
      ok: true,
      value: { source: 'spotify', itemType: 'none' }
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

async function createExpiredCredential(): Promise<Credential> {
  const refreshToken = await encryptSecret(
    'old-refresh-token',
    {
      recordId: publicId,
      spotifyClientId,
      fieldName: 'refresh_token'
    },
    'test',
    encryptionKeys
  );
  const accessToken = await encryptSecret(
    'expired-access-token',
    {
      recordId: publicId,
      spotifyClientId,
      fieldName: 'access_token'
    },
    'test',
    encryptionKeys
  );
  const digest = await pairingDigest(publicId, 'pairing-secret', pairingKey);
  await createCredential(env.DB, {
    publicId,
    pairingDigest: digest,
    pairingKeyId: 'test',
    spotifyClientId,
    refreshToken,
    accessToken,
    accessTokenExpiresAtMs: nowMs + 59_999,
    refreshAuthorizedAtMs: nowMs - 1000,
    nowMs: nowMs - 1000
  });
  const credential = await getCredentialByPublicId(env.DB, publicId);
  expect(credential).not.toBeNull();
  return credential!;
}
