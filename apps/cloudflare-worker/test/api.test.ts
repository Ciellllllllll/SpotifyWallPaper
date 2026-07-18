import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import trackFixture from '../../../tests/fixtures/spotify/current-playback-track.json';
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
          Authorization: `Bearer ${pairing.token}`
        }
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
        'SELECT public_id FROM deletion_tombstones WHERE public_id = ?'
      )
        .bind(pairing.publicId)
        .first('public_id')
    ).toBe(pairing.publicId);
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

  it('reconciles beyond the first 1,000 tombstones before expiring the ledger', async () => {
    await env.DELETION_DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 0
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 999
       )
       INSERT INTO deletion_tombstones (public_id, deleted_at_ms, expires_at_ms)
       SELECT printf('restore-%04d', value), ?, ? FROM sequence`
    )
      .bind(nowMs - 100, nowMs - 1)
      .run();
    await env.DELETION_DB.prepare(
      `INSERT INTO deletion_tombstones (public_id, deleted_at_ms, expires_at_ms)
       VALUES ('restore-1000', ?, ?)`
    )
      .bind(nowMs - 100, nowMs - 1)
      .run();
    await env.DB.prepare(
      `INSERT INTO credentials (
         public_id, pairing_digest, pairing_key_id, spotify_client_id,
         refresh_authorized_at_ms, created_at_ms, updated_at_ms
       ) VALUES ('restore-1000', 'digest', 'test', 'restored-client', ?, ?, ?)`
    )
      .bind(nowMs - 100, nowMs - 100, nowMs - 100)
      .run();

    const reconciled = await reconcileDeletionTombstones(
      env.DB,
      env.DELETION_DB,
      nowMs
    );

    expect(reconciled).toBe(1001);
    expect(await getCredentialByPublicId(env.DB, 'restore-1000')).toBeNull();
    expect(
      await env.DELETION_DB.prepare(
        'SELECT COUNT(*) AS count FROM deletion_tombstones'
      ).first<number>('count')
    ).toBe(0);
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
