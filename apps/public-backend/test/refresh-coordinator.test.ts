import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  acquireRefreshLease: vi.fn(),
  completeRefreshLease: vi.fn(),
  failRefreshLeaseAsReauthorizationRequired: vi.fn(),
  getCredentialByPublicId: vi.fn(),
  getSpotifyBackoff: vi.fn(),
  invalidateAccessToken: vi.fn(),
  markCredentialReauthorizationRequired: vi.fn(),
  readCredentialSecrets: vi.fn(),
  releaseRefreshLease: vi.fn(),
  upsertSpotifyBackoff: vi.fn()
}));

vi.mock('../src/db.js', () => dbMocks);

import { decryptSecret, encryptSecret } from '../src/crypto.js';
import type {
  CompleteRefreshLeaseInput,
  Credential,
  DatabasePool
} from '../src/db.js';
import {
  fetchCredentialPlayback,
  getCredentialAccessToken,
  sendCredentialSpotifyCommand
} from '../src/spotify.js';

const nowMs = 1_800_000_000_000;
const publicId = 'AAAAAAAAAAAAAAAAAAAAAA';
const spotifyClientId = 'ClientId123456789';
const encryptionKeyring = {
  test: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};
const database = {} as DatabasePool;
const spotify = {
  encryptionKeyring,
  encryptionActiveKeyId: 'test',
  playbackEndpoint: 'https://synthetic.invalid/v1/me/player',
  tokenEndpoint: 'https://synthetic.invalid/api/token'
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('refresh coordinator', () => {
  it('makes one refresh request for concurrent callers and persists token rotation', async () => {
    const initial = await credential();
    const state = installDatabase(initial);
    const started = deferred<void>();
    const finish = deferred<void>();
    const fetcher = vi.fn(async (_input: string | Request | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      expect(new URLSearchParams(init?.body as string).get('refresh_token')).toBe(
        'old-refresh-token'
      );
      started.resolve();
      await finish.promise;
      return Response.json({
        access_token: 'new-access-token',
        refresh_token: 'rotated-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600
      });
    });

    const pending = Array.from({ length: 20 }, () =>
      getCredentialAccessToken(database, initial, spotify, {
        fetcher,
        nowMs,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 1))
      })
    );
    await started.promise;
    finish.resolve();
    const results = await Promise.all(pending);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(results.every((result) => result.ok && result.value === 'new-access-token')).toBe(true);
    expect(state.credential.tokenVersion).toBe(2);
    await expect(
      decryptSecret(
        state.credential.refreshToken!,
        { recordId: publicId, spotifyClientId, fieldName: 'refresh_token' },
        encryptionKeyring
      )
    ).resolves.toBe('rotated-refresh-token');
  });

  it('retains the old refresh token when Spotify omits rotation', async () => {
    const initial = await credential();
    const state = installDatabase(initial);

    await expect(
      getCredentialAccessToken(database, initial, spotify, {
        nowMs,
        fetcher: vi.fn(async () =>
          Response.json({
            access_token: 'new-access-token',
            token_type: 'Bearer',
            expires_in: 3600
          })
        )
      })
    ).resolves.toEqual({ ok: true, value: 'new-access-token' });
    await expect(
      decryptSecret(
        state.credential.refreshToken!,
        { recordId: publicId, spotifyClientId, fieldName: 'refresh_token' },
        encryptionKeyring
      )
    ).resolves.toBe('old-refresh-token');
  });

  it('clears tokens and stops refreshing on invalid_grant', async () => {
    const initial = await credential();
    const state = installDatabase(initial);
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: 'invalid_grant', error_description: 'sensitive upstream details' },
        { status: 400 }
      )
    );

    const result = await getCredentialAccessToken(database, initial, spotify, {
      fetcher,
      nowMs
    });

    expect(result).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(JSON.stringify(result)).not.toContain('sensitive upstream details');
    expect(state.credential).toMatchObject({
      authStatus: 'reauth_required',
      refreshToken: null,
      accessToken: null,
      refreshLeaseId: null
    });
  });

  it('requires reauthorization after the six-month lifetime without calling Spotify', async () => {
    const initial = await credential({
      refreshAuthorizedAtMs: nowMs - 180 * 24 * 60 * 60 * 1000 - 1
    });
    const state = installDatabase(initial);
    const fetcher = vi.fn(async () => Response.json({}));

    const result = await getCredentialAccessToken(database, initial, spotify, {
      fetcher,
      nowMs
    });

    expect(result).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.credential.authStatus).toBe('reauth_required');
  });

  it('persists Retry-After and blocks the next token request', async () => {
    const initial = await credential();
    installDatabase(initial);
    const fetcher = vi.fn(async () =>
      new Response(null, { status: 429, headers: { 'Retry-After': '9' } })
    );

    const first = await getCredentialAccessToken(database, initial, spotify, {
      fetcher,
      nowMs
    });
    const second = await getCredentialAccessToken(database, initial, spotify, {
      fetcher,
      nowMs: nowMs + 1000
    });

    expect(first).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 9000 }
    });
    expect(second).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 8000 }
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('consumes a failed token response body before releasing the lease', async () => {
    const initial = await credential();
    installDatabase(initial);
    let consumed = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        consumed = true;
        controller.enqueue(new TextEncoder().encode('upstream details'));
        controller.close();
      }
    });

    const result = await getCredentialAccessToken(database, initial, spotify, {
      nowMs,
      fetcher: vi.fn(async () => new Response(body, { status: 500 }))
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'unavailable', status: 500 }
    });
    expect(consumed).toBe(true);
  });

  it('cancels an oversized refresh response before parsing', async () => {
    const initial = await credential();
    const state = installDatabase(initial);
    const cancel = vi.fn(async () => undefined);
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(262_145) }),
      body: { cancel }
    } as unknown as Response;

    const result = await getCredentialAccessToken(database, initial, spotify, {
      nowMs,
      fetcher: vi.fn(async () => response)
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' }
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(state.credential.refreshLeaseId).toBeNull();
  });

  it('cancels a refresh response when its reader fails', async () => {
    const initial = await credential();
    const state = installDatabase(initial);
    const cancel = vi.fn(async () => undefined);
    const reader = {
      read: vi.fn(async () => {
        throw new Error('body read failed');
      }),
      cancel,
      releaseLock: vi.fn()
    };
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => reader }
    } as unknown as Response;

    const result = await getCredentialAccessToken(database, initial, spotify, {
      nowMs,
      fetcher: vi.fn(async () => response)
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' }
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(state.credential.refreshLeaseId).toBeNull();
  });

  it('persists playback Retry-After and blocks the next upstream call', async () => {
    const initial = await credential({ accessTokenExpiresAtMs: nowMs + 3_600_000 });
    installDatabase(initial);
    const fetcher = vi.fn(async () =>
      new Response(null, { status: 429, headers: { 'Retry-After': '4' } })
    );

    const first = await fetchCredentialPlayback(database, initial, spotify, {
      fetcher,
      nowMs
    });
    const second = await fetchCredentialPlayback(database, initial, spotify, {
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
    const initial = await credential();
    const state = installDatabase(initial);

    const failed = await getCredentialAccessToken(database, initial, spotify, {
      nowMs,
      fetcher: vi.fn(async () => {
        throw new Error('network detail');
      })
    });
    const recovered = await getCredentialAccessToken(
      database,
      { ...state.credential },
      spotify,
      {
        nowMs: nowMs + 1,
        fetcher: vi.fn(async () =>
          Response.json({
            access_token: 'recovered-access-token',
            token_type: 'Bearer',
            expires_in: 3600
          })
        )
      }
    );

    expect(failed).toMatchObject({ ok: false, error: { kind: 'network_error' } });
    expect(state.credential.refreshLeaseId).toBeNull();
    expect(recovered).toEqual({ ok: true, value: 'recovered-access-token' });
  });

  it('reloads the winner when lease completion loses a race', async () => {
    const initial = await credential();
    const state = installDatabase(initial);
    dbMocks.completeRefreshLease.mockImplementationOnce(
      async (_db: DatabasePool, _completion: CompleteRefreshLeaseInput) => {
        state.credential = {
          ...state.credential,
          accessToken: await encrypted('winner-access-token', 'access_token'),
          accessTokenExpiresAtMs: nowMs + 3_600_000,
          tokenVersion: 2,
          refreshLeaseId: null,
          refreshLeaseUntilMs: null
        };
        return false;
      }
    );

    const result = await getCredentialAccessToken(database, initial, spotify, {
      nowMs,
      fetcher: vi.fn(async () =>
        Response.json({
          access_token: 'losing-access-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      )
    });

    expect(result).toEqual({ ok: true, value: 'winner-access-token' });
  });

  it('refreshes once and retries playback after an early 401', async () => {
    const initial = await credential({ accessTokenExpiresAtMs: nowMs + 3_600_000 });
    installDatabase(initial);
    const fetcher = vi.fn(async (input: string | Request | URL) => {
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
      return Response.json({ is_playing: false, progress_ms: 0, item: null });
    });

    const result = await fetchCredentialPlayback(database, initial, spotify, {
      fetcher,
      nowMs
    });

    expect(result).toMatchObject({
      ok: true,
      value: { source: 'spotify', itemType: 'none' }
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('invalidates the token version created by a refresh before retrying', async () => {
    const initial = await credential({ accessTokenExpiresAtMs: nowMs + 59_999 });
    installDatabase(initial);
    let playbackCalls = 0;
    const fetcher = vi.fn(async (input: string | Request | URL) => {
      const url = String(input);
      if (url.endsWith('/api/token')) {
        return Response.json({
          access_token: 'replacement-access-token',
          token_type: 'Bearer',
          expires_in: 3600
        });
      }
      playbackCalls += 1;
      return playbackCalls === 1
        ? new Response(null, { status: 401 })
        : Response.json({ is_playing: false, progress_ms: 0, item: null });
    });

    const result = await fetchCredentialPlayback(database, initial, spotify, {
      fetcher,
      nowMs
    });

    expect(result).toMatchObject({
      ok: true,
      value: { source: 'spotify', itemType: 'none' }
    });
    expect(dbMocks.invalidateAccessToken).toHaveBeenCalledWith(
      database,
      publicId,
      2,
      nowMs
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('uses the coordinated cached token for control requests', async () => {
    const initial = await credential({ accessTokenExpiresAtMs: nowMs + 3_600_000 });
    installDatabase(initial);
    const fetcher = vi.fn(async (_input: string | Request | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer expired-access-token'
      );
      return new Response(null, { status: 204 });
    });

    await expect(
      sendCredentialSpotifyCommand(
        database,
        initial,
        spotify,
        { type: 'pause' },
        { fetcher, nowMs }
      )
    ).resolves.toEqual({ ok: true, value: null });
  });
});

interface DatabaseState {
  credential: Credential;
  backoff: { retryUntilMs: number; updatedAtMs: number } | null;
}

function installDatabase(initial: Credential): DatabaseState {
  const state: DatabaseState = { credential: initial, backoff: null };
  dbMocks.getCredentialByPublicId.mockImplementation(async () => ({ ...state.credential }));
  dbMocks.getSpotifyBackoff.mockImplementation(async () => state.backoff);
  dbMocks.readCredentialSecrets.mockImplementation(async () => ({
    refreshToken: await decryptSecret(
      state.credential.refreshToken!,
      { recordId: publicId, spotifyClientId, fieldName: 'refresh_token' },
      encryptionKeyring
    ),
    accessToken: null
  }));
  dbMocks.acquireRefreshLease.mockImplementation(
    async (_db, _publicId, tokenVersion, leaseId, acquiredAtMs) => {
      if (
        state.credential.authStatus !== 'active' ||
        state.credential.tokenVersion !== tokenVersion ||
        (state.credential.refreshLeaseId !== null &&
          (state.credential.refreshLeaseUntilMs ?? 0) > acquiredAtMs)
      ) {
        return null;
      }
      state.credential = {
        ...state.credential,
        refreshLeaseId: leaseId,
        refreshLeaseUntilMs: acquiredAtMs + 30_000
      };
      return { leaseId, leaseUntilMs: acquiredAtMs + 30_000, tokenVersion };
    }
  );
  dbMocks.completeRefreshLease.mockImplementation(
    async (_db, completion: CompleteRefreshLeaseInput) => {
      if (
        state.credential.refreshLeaseId !== completion.leaseId ||
        state.credential.tokenVersion !== completion.tokenVersion
      ) {
        return false;
      }
      state.credential = {
        ...state.credential,
        accessToken: completion.accessToken,
        accessTokenExpiresAtMs: completion.accessTokenExpiresAtMs,
        refreshToken: completion.refreshToken ?? state.credential.refreshToken,
        tokenVersion: state.credential.tokenVersion + 1,
        refreshLeaseId: null,
        refreshLeaseUntilMs: null
      };
      return true;
    }
  );
  dbMocks.releaseRefreshLease.mockImplementation(
    async (_db, _publicId, leaseId, tokenVersion) => {
      if (
        state.credential.refreshLeaseId !== leaseId ||
        state.credential.tokenVersion !== tokenVersion
      ) {
        return false;
      }
      state.credential = {
        ...state.credential,
        refreshLeaseId: null,
        refreshLeaseUntilMs: null
      };
      return true;
    }
  );
  dbMocks.failRefreshLeaseAsReauthorizationRequired.mockImplementation(
    async (_db, _publicId, leaseId, tokenVersion) => {
      if (
        state.credential.refreshLeaseId !== leaseId ||
        state.credential.tokenVersion !== tokenVersion
      ) {
        return false;
      }
      state.credential = reauthorizationRequired(state.credential);
      return true;
    }
  );
  dbMocks.markCredentialReauthorizationRequired.mockImplementation(
    async (_db, _publicId, tokenVersion) => {
      if (state.credential.tokenVersion !== tokenVersion) return false;
      state.credential = reauthorizationRequired(state.credential);
      return true;
    }
  );
  dbMocks.invalidateAccessToken.mockImplementation(
    async (_db, _publicId, tokenVersion) => {
      if (state.credential.tokenVersion !== tokenVersion) return false;
    state.credential = { ...state.credential, accessTokenExpiresAtMs: 0 };
      return true;
    }
  );
  dbMocks.upsertSpotifyBackoff.mockImplementation(
    async (_db, _clientId, retryUntilMs, updatedAtMs) => {
      state.backoff = {
        retryUntilMs: Math.max(state.backoff?.retryUntilMs ?? 0, retryUntilMs),
        updatedAtMs
      };
    }
  );
  return state;
}

function reauthorizationRequired(value: Credential): Credential {
  return {
    ...value,
    authStatus: 'reauth_required',
    refreshToken: null,
    accessToken: null,
    accessTokenExpiresAtMs: null,
    tokenVersion: value.tokenVersion + 1,
    refreshLeaseId: null,
    refreshLeaseUntilMs: null
  };
}

async function credential(
  overrides: Partial<Credential> = {}
): Promise<Credential> {
  return {
    publicId,
    pairingDigest: 'B'.repeat(43),
    pairingKeyId: 'test',
    spotifyClientId,
    refreshToken: await encrypted('old-refresh-token', 'refresh_token'),
    accessToken: await encrypted('expired-access-token', 'access_token'),
    accessTokenExpiresAtMs: nowMs + 59_999,
    refreshAuthorizedAtMs: nowMs - 1000,
    tokenVersion: 1,
    refreshLeaseId: null,
    refreshLeaseUntilMs: null,
    authStatus: 'active',
    createdAtMs: nowMs - 1000,
    updatedAtMs: nowMs - 1000,
    lastUsedAtMs: null,
    ...overrides
  };
}

function encrypted(
  value: string,
  fieldName: 'access_token' | 'refresh_token'
) {
  return encryptSecret(
    value,
    { recordId: publicId, spotifyClientId, fieldName },
    'test',
    encryptionKeyring
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
