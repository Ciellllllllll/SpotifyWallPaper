import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import trackFixture from '../../../tests/fixtures/spotify/current-playback-track.json';
import controlRequests from '../../../tests/contracts/provider-v1/control-requests.json';
import { encryptSecret } from '../src/crypto';
import {
  createCredential,
  getCredentialByPublicId,
  markCredentialReauthorizationRequired,
  reconcileDeletionTombstones,
  writeDeletionTombstone
} from '../src/db';
import worker from '../src/index';
import { generatePairingToken, pairingDigest } from '../src/pairing';

const baseUrl = 'http://127.0.0.1:8787';
const spotifyClientId = '0123456789abcdef0123456789abcdef';
const encryptionKeys = {
  test: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};
const pairingKey = 'ggggggggggggggggggggggggggggggggggggggggggg';
const nowMs = Date.now();

beforeEach(async () => {
  vi.unstubAllGlobals();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM spotify_backoff'),
    env.DB.prepare('DELETE FROM oauth_sessions'),
    env.DB.prepare('DELETE FROM credentials')
  ]);
  await env.DELETION_DB.prepare('DELETE FROM deletion_tombstones').run();
});

describe('authenticated playback API', () => {
  it('returns only normalized playback for a valid Pairing Token', async () => {
    const pairing = await createApiCredential();
    const spotify = vi.fn(async () => Response.json(trackFixture));
    vi.stubGlobal('fetch', spotify);

    const response = await apiRequest('/api/playback', pairing.token);
    const body = await response.json<Record<string, unknown>>();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      value: {
        source: 'spotify',
        itemType: 'track',
        id: 'track-1',
        fetchedAt: expect.any(String)
      }
    });
    expect(serialized).not.toContain('access-token');
    expect(serialized).not.toContain('refresh-token');
    expect(serialized).not.toContain(pairing.secret);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBe('null');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('rejects missing, malformed, unknown, and reauthorization-required tokens', async () => {
    const pairing = await createApiCredential();
    const missing = await apiRequest('/api/playback', null);
    const malformed = await apiRequest('/api/playback', 'malformed');
    const unknown = await apiRequest(
      '/api/playback',
      `swpb1.${'Q'.repeat(22)}.${'g'.repeat(43)}`
    );
    await markCredentialReauthorizationRequired(
      env.DB,
      pairing.publicId,
      1,
      nowMs
    );
    const revoked = await apiRequest('/api/playback', pairing.token);

    expect([missing.status, malformed.status, unknown.status, revoked.status]).toEqual([
      401,
      401,
      401,
      401
    ]);
    for (const response of [missing, malformed, unknown, revoked]) {
      expect(JSON.stringify(await response.json())).not.toContain(pairing.token);
    }
  });

  it('rejects a tombstoned credential before trusting the primary database', async () => {
    const pairing = await createApiCredential();
    await writeDeletionTombstone(
      env.DELETION_DB,
      pairing.publicId,
      nowMs,
      nowMs + 35 * 24 * 60 * 60 * 1000
    );

    const response = await apiRequest('/api/playback', pairing.token);
    const stored = await getCredentialByPublicId(env.DB, pairing.publicId);

    expect(response.status).toBe(401);
    expect(stored).not.toBeNull();

    const reauthorization = await worker.fetch(
      new Request(`${baseUrl}/auth/reauthorize`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          Authorization: `Bearer ${pairing.token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ legalAccepted: 'yes' })
      }),
      env
    );
    expect(reauthorization.status).toBe(401);
  });

  it('propagates Spotify backoff and redacts unavailable upstream bodies', async () => {
    const pairing = await createApiCredential();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { message: 'sensitive spotify body' } },
          {
            status: 429,
            headers: { 'Retry-After': '5' }
          }
        )
      )
    );

    const response = await apiRequest('/api/playback', pairing.token);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 5000 }
    });
    expect(JSON.stringify(body)).not.toContain('sensitive spotify body');
  });
});

describe('control API validation', () => {
  it('accepts all eight commands from the shared contract fixture', async () => {
    const pairing = await createApiCredential();

    for (const command of controlRequests) {
      const spotify = vi.fn(async () => new Response(null, { status: 204 }));
      if (command.type === 'seek') {
        spotify.mockResolvedValueOnce(Response.json(trackFixture));
      }
      vi.stubGlobal('fetch', spotify);

      const response = await apiRequest('/api/control', pairing.token, {
        method: 'POST',
        json: command
      });

      expect(response.status, JSON.stringify(command)).toBe(200);
    }
  });

  it('accepts a strict command and returns the existing envelope', async () => {
    const pairing = await createApiCredential();
    const spotify = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', spotify);

    const response = await apiRequest('/api/control', pairing.token, {
      method: 'POST',
      json: { type: 'volume', volumePercent: 50 }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: null });
    expect(spotify).toHaveBeenCalledOnce();
  });

  it('rejects unknown fields, invalid types, ranges, and oversized bodies', async () => {
    const pairing = await createApiCredential();
    const spotify = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', spotify);
    const invalid = [
      {},
      { type: 'unknown' },
      { type: 'play', extra: true },
      { type: 'seek', positionMs: -1 },
      { type: 'seek', positionMs: 1.5 },
      { type: 'volume', volumePercent: 101 },
      { type: 'shuffle', state: 'true' },
      { type: 'repeat', state: 'all' }
    ];

    for (const json of invalid) {
      const response = await apiRequest('/api/control', pairing.token, {
        method: 'POST',
        json
      });
      expect(response.status).toBe(400);
    }
    const oversized = await apiRequest('/api/control', pairing.token, {
      method: 'POST',
      rawBody: JSON.stringify({ type: 'play', padding: 'x'.repeat(2048) })
    });
    expect(oversized.status).toBe(413);
    expect(spotify).not.toHaveBeenCalled();
  });

  it('cancels an undeclared streaming body as soon as it exceeds 1 KiB', async () => {
    const pairing = await createApiCredential();
    const cancelled = vi.fn();
    const chunks = [
      new TextEncoder().encode('{"type":"play","padding":"'),
      new Uint8Array(700),
      new Uint8Array(700)
    ];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
      cancel: cancelled
    });

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/control`, {
        method: 'POST',
        headers: {
          Origin: 'null',
          Authorization: `Bearer ${pairing.token}`,
          'Content-Type': 'application/json'
        },
        body
      }),
      env
    );

    expect(response.status).toBe(413);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('keeps Content-Type, strict UTF-8, and JSON decoding checks', async () => {
    const pairing = await createApiCredential();
    const headers = {
      Origin: 'null',
      Authorization: `Bearer ${pairing.token}`
    };
    const wrongContentType = await worker.fetch(new Request(`${baseUrl}/api/control`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'play' })
    }), env);
    const invalidUtf8 = await worker.fetch(new Request(`${baseUrl}/api/control`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: new Uint8Array([0xff])
    }), env);
    const invalidJson = await apiRequest('/api/control', pairing.token, {
      method: 'POST',
      rawBody: '{'
    });

    expect([wrongContentType.status, invalidUtf8.status, invalidJson.status]).toEqual([400, 400, 400]);
  });

  it('rejects seek positions beyond the current item duration', async () => {
    const pairing = await createApiCredential();
    const spotify = vi.fn(async () => Response.json(trackFixture));
    vi.stubGlobal('fetch', spotify);

    const response = await apiRequest('/api/control', pairing.token, {
      method: 'POST',
      json: { type: 'seek', positionMs: 180001 }
    });

    expect(response.status).toBe(400);
    expect(spotify).toHaveBeenCalledOnce();
  });

  it('returns 405 for a known path with the wrong method', async () => {
    const pairing = await createApiCredential();
    const response = await apiRequest('/api/playback', pairing.token, {
      method: 'POST',
      json: {}
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, OPTIONS');
  });
});

describe('account deletion', () => {
  it('requires same-origin setup and writes the tombstone before deleting primary data', async () => {
    const pairing = await createApiCredential();
    const nullOrigin = await apiRequest('/api/account', pairing.token, {
      method: 'DELETE',
      origin: 'null'
    });
    const deleted = await apiRequest('/api/account', pairing.token, {
      method: 'DELETE',
      origin: baseUrl
    });

    expect(nullOrigin.status).toBe(403);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true, value: null });
    expect(await getCredentialByPublicId(env.DB, pairing.publicId)).toBeNull();
    expect(
      await env.DELETION_DB.prepare(
        'SELECT reconciled_at_ms FROM deletion_tombstones WHERE public_id = ?'
      )
        .bind(pairing.publicId)
        .first('reconciled_at_ms')
    ).toEqual(expect.any(Number));
  });

  it('reconciles a surviving primary row after a partial deletion failure', async () => {
    const pairing = await createApiCredential();
    await writeDeletionTombstone(
      env.DELETION_DB,
      pairing.publicId,
      nowMs,
      nowMs + 35 * 24 * 60 * 60 * 1000
    );

    await reconcileDeletionTombstones(env.DB, env.DELETION_DB, nowMs + 1);

    expect(await getCredentialByPublicId(env.DB, pairing.publicId)).toBeNull();
  });

  it('resumes bounded reconciliation after a restore resets completion markers', async () => {
    await env.DELETION_DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 0
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 999
       )
       INSERT INTO deletion_tombstones (
         public_id, deleted_at_ms, expires_at_ms, reconciled_at_ms
       )
       SELECT printf('restore-%04d', value), ?, ?, ? FROM sequence`
    )
      .bind(nowMs - 100, nowMs + 1000, nowMs - 50)
      .run();
    await env.DELETION_DB.prepare(
      `INSERT INTO deletion_tombstones (
         public_id, deleted_at_ms, expires_at_ms, reconciled_at_ms
       ) VALUES ('restore-1000', ?, ?, ?)`
    )
      .bind(nowMs - 100, nowMs + 1000, nowMs - 50)
      .run();
    await env.DB.prepare(
      `INSERT INTO credentials (
         public_id, pairing_digest, pairing_key_id, spotify_client_id,
         refresh_authorized_at_ms, created_at_ms, updated_at_ms
       ) VALUES ('restore-1000', 'digest', 'test', 'restored-client', ?, ?, ?)`
    )
      .bind(nowMs - 100, nowMs - 100, nowMs - 100)
      .run();

    expect(
      await reconcileDeletionTombstones(
        env.DB,
        env.DELETION_DB,
        nowMs
      )
    ).toMatchObject({
      attemptedCount: 0,
      reconciledCount: 0,
      failedCount: 0,
      pendingCount: 0
    });
    expect(await getCredentialByPublicId(env.DB, 'restore-1000')).not.toBeNull();

    await env.DELETION_DB.prepare(
      'UPDATE deletion_tombstones SET reconciled_at_ms = NULL'
    ).run();
    let reconciled = 0;
    while (true) {
      const batch = await reconcileDeletionTombstones(
        env.DB,
        env.DELETION_DB,
        nowMs
      );
      expect(batch.attemptedCount).toBeLessThanOrEqual(100);
      reconciled += batch.reconciledCount;
      if (batch.attemptedCount === 0) {
        break;
      }
    }

    expect(reconciled).toBe(1001);
    expect(await getCredentialByPublicId(env.DB, 'restore-1000')).toBeNull();
    await reconcileDeletionTombstones(
      env.DB,
      env.DELETION_DB,
      nowMs + 2000
    );
    expect(
      await env.DELETION_DB.prepare(
        'SELECT COUNT(*) AS count FROM deletion_tombstones'
      ).first<number>('count')
    ).toBe(0);
  });

  it('does not expire an unreconciled tombstone', async () => {
    await env.DELETION_DB.prepare(
      `INSERT INTO deletion_tombstones (public_id, deleted_at_ms, expires_at_ms)
       VALUES ('pending-delete', ?, ?)`
    )
      .bind(nowMs - 100, nowMs - 1)
      .run();
    const failingPrimary = {
      prepare() {
        throw new Error('primary unavailable');
      }
    } as unknown as D1Database;

    await expect(
      reconcileDeletionTombstones(
        failingPrimary,
        env.DELETION_DB,
        nowMs
      )
    ).resolves.toMatchObject({
      attemptedCount: 1,
      reconciledCount: 0,
      failedCount: 1,
      pendingCount: 1,
      maxRetryCount: 1
    });

    expect(
      await env.DELETION_DB.prepare(
        `SELECT public_id, reconciliation_attempts FROM deletion_tombstones
         WHERE public_id = 'pending-delete'`
      ).first<{ public_id: string; reconciliation_attempts: number }>()
    ).toEqual({
      public_id: 'pending-delete',
      reconciliation_attempts: 1
    });
  });

  it('isolates a failed tombstone and continues reconciling later rows', async () => {
    await env.DELETION_DB.prepare(
      `INSERT INTO deletion_tombstones (public_id, deleted_at_ms, expires_at_ms)
       VALUES ('blocked-delete', ?, ?), ('healthy-delete', ?, ?)`
    )
      .bind(nowMs - 200, nowMs + 1000, nowMs - 100, nowMs + 1000)
      .run();
    const primary = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return { sql, values };
          }
        };
      },
      async batch(statements: Array<{ values: unknown[] }>) {
        if (statements.some((statement) => statement.values.includes('blocked-delete'))) {
          throw new Error('one row is unavailable');
        }
        return [];
      }
    } as unknown as D1Database;

    const result = await reconcileDeletionTombstones(
      primary,
      env.DELETION_DB,
      nowMs
    );

    expect(result).toEqual({
      attemptedCount: 2,
      reconciledCount: 1,
      failedCount: 1,
      pendingCount: 1,
      oldestPendingAgeMs: 200,
      maxRetryCount: 1
    });
    expect(
      await env.DELETION_DB.prepare(
        `SELECT reconciled_at_ms FROM deletion_tombstones
         WHERE public_id = 'healthy-delete'`
      ).first('reconciled_at_ms')
    ).toBe(nowMs);
  });

  it('prioritizes untried tombstones after a full batch of failures', async () => {
    await env.DELETION_DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 0
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 99
       )
       INSERT INTO deletion_tombstones (public_id, deleted_at_ms, expires_at_ms)
       SELECT printf('blocked-%03d', value), ?, ? FROM sequence`
    )
      .bind(nowMs - 200, nowMs + 1000)
      .run();
    await env.DELETION_DB.prepare(
      `INSERT INTO deletion_tombstones (public_id, deleted_at_ms, expires_at_ms)
       VALUES ('zz-healthy', ?, ?)`
    )
      .bind(nowMs - 100, nowMs + 1000)
      .run();
    const primary = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return { sql, values };
          }
        };
      },
      async batch(statements: Array<{ values: unknown[] }>) {
        if (
          statements.some((statement) =>
            statement.values.some(
              (value) => typeof value === 'string' && value.startsWith('blocked-')
            )
          )
        ) {
          throw new Error('blocked row');
        }
        return [];
      }
    } as unknown as D1Database;

    const first = await reconcileDeletionTombstones(
      primary,
      env.DELETION_DB,
      nowMs
    );
    const second = await reconcileDeletionTombstones(
      primary,
      env.DELETION_DB,
      nowMs + 1
    );

    expect(first).toMatchObject({
      attemptedCount: 100,
      reconciledCount: 0,
      failedCount: 100,
      pendingCount: 101
    });
    expect(second).toMatchObject({
      attemptedCount: 100,
      reconciledCount: 1,
      failedCount: 99,
      pendingCount: 100
    });
    expect(
      await env.DELETION_DB.prepare(
        `SELECT reconciled_at_ms FROM deletion_tombstones
         WHERE public_id = 'zz-healthy'`
      ).first('reconciled_at_ms')
    ).toBe(nowMs + 1);
  });
});

async function createApiCredential() {
  const pairing = generatePairingToken();
  const [digest, refreshToken, accessToken] = await Promise.all([
    pairingDigest(pairing.publicId, pairing.secret, pairingKey),
    encryptSecret(
      'refresh-token',
      {
        recordId: pairing.publicId,
        spotifyClientId,
        fieldName: 'refresh_token'
      },
      'test',
      encryptionKeys
    ),
    encryptSecret(
      'access-token',
      {
        recordId: pairing.publicId,
        spotifyClientId,
        fieldName: 'access_token'
      },
      'test',
      encryptionKeys
    )
  ]);
  await createCredential(env.DB, {
    publicId: pairing.publicId,
    pairingDigest: digest,
    pairingKeyId: 'test',
    spotifyClientId,
    refreshToken,
    accessToken,
    accessTokenExpiresAtMs: nowMs + 3_600_000,
    refreshAuthorizedAtMs: nowMs,
    nowMs
  });
  return pairing;
}

async function apiRequest(
  path: string,
  pairingToken: string | null,
  options: {
    method?: string;
    origin?: string;
    json?: unknown;
    rawBody?: string;
  } = {}
): Promise<Response> {
  const headers = new Headers({
    Origin: options.origin ?? 'null'
  });
  if (pairingToken !== null) {
    headers.set('Authorization', `Bearer ${pairingToken}`);
  }
  const body =
    options.rawBody ??
    (options.json === undefined ? undefined : JSON.stringify(options.json));
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  return worker.fetch(
    new Request(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body
    }),
    env
  );
}
