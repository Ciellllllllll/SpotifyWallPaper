import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '../src/crypto';
import { createCredential } from '../src/db';
import worker from '../src/index';
import { generatePairingToken, pairingDigest } from '../src/pairing';

const baseUrl = 'http://127.0.0.1:8787';
const spotifyClientId = '0123456789abcdef0123456789abcdef';
const encryptionKeys = {
  test: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};
const pairingKey = 'ggggggggggggggggggggggggggggggggggggggggggg';

beforeEach(async () => {
  vi.unstubAllGlobals();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM spotify_backoff'),
    env.DB.prepare('DELETE FROM oauth_sessions'),
    env.DB.prepare('DELETE FROM credentials')
  ]);
  await env.DELETION_DB.prepare('DELETE FROM deletion_tombstones').run();
});

describe('authenticated API rate limiting', () => {
  it('keys playback limits by route and authenticated public ID', async () => {
    const pairing = generatePairingToken();
    await storeCredential(pairing.publicId, pairing.secret);
    const playbackLimit = vi
      .fn()
      .mockResolvedValue({ success: false });
    const controlLimit = vi.fn(async () => ({ success: true }));
    const limitedEnv = {
      ...env,
      PRE_AUTH_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      PLAYBACK_RATE_LIMITER: { limit: playbackLimit },
      CONTROL_RATE_LIMITER: { limit: controlLimit }
    } as unknown as Env;

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/playback`, {
        headers: {
          Origin: 'null',
          'CF-Connecting-IP': '192.0.2.10',
          Authorization: `Bearer ${pairing.token}`
        }
      }),
      limitedEnv
    );

    expect(response.status).toBe(429);
    expect(limitedEnv.PRE_AUTH_RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: 'preauth:192.0.2.10'
    });
    expect(playbackLimit.mock.calls).toEqual([
      [{ key: `playback:${pairing.publicId}` }]
    ]);
    expect(controlLimit).not.toHaveBeenCalled();
  });

  it('spends only the pre-authentication IP key for an invalid token', async () => {
    const playbackLimit = vi.fn(async () => ({ success: true }));
    const preAuthLimit = vi.fn(async () => ({ success: true }));
    const limitedEnv = {
      ...env,
      PRE_AUTH_RATE_LIMITER: { limit: preAuthLimit },
      PLAYBACK_RATE_LIMITER: { limit: playbackLimit },
      CONTROL_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) }
    } as unknown as Env;

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/playback`, {
        headers: {
          Origin: 'null',
          'CF-Connecting-IP': '192.0.2.11',
          Authorization: 'Bearer malformed'
        }
      }),
      limitedEnv
    );

    expect(response.status).toBe(401);
    expect(preAuthLimit).toHaveBeenCalledOnce();
    expect(preAuthLimit).toHaveBeenCalledWith({
      key: 'preauth:192.0.2.11'
    });
    expect(playbackLimit).not.toHaveBeenCalled();
  });

  it('rejects abusive invalid-token traffic before D1 authentication', async () => {
    const preAuthLimit = vi.fn(async () => ({ success: false }));
    const playbackLimit = vi.fn(async () => ({ success: true }));
    const limitedEnv = {
      ...env,
      PRE_AUTH_RATE_LIMITER: { limit: preAuthLimit },
      PLAYBACK_RATE_LIMITER: { limit: playbackLimit }
    } as unknown as Env;

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/playback`, {
        headers: {
          Origin: 'null',
          'CF-Connecting-IP': '192.0.2.12',
          Authorization: `Bearer swpb1.${'Q'.repeat(22)}.${'g'.repeat(43)}`
        }
      }),
      limitedEnv
    );

    expect(response.status).toBe(429);
    expect(preAuthLimit).toHaveBeenCalledOnce();
    expect(preAuthLimit).toHaveBeenCalledWith({
      key: 'preauth:192.0.2.12'
    });
    expect(playbackLimit).not.toHaveBeenCalled();
  });
});

async function storeCredential(publicId: string, secret: string): Promise<void> {
  const [digest, refreshToken, accessToken] = await Promise.all([
    pairingDigest(publicId, secret, pairingKey),
    encryptSecret(
      'refresh-token',
      { recordId: publicId, spotifyClientId, fieldName: 'refresh_token' },
      'test',
      encryptionKeys
    ),
    encryptSecret(
      'access-token',
      { recordId: publicId, spotifyClientId, fieldName: 'access_token' },
      'test',
      encryptionKeys
    )
  ]);
  const nowMs = Date.now();
  await createCredential(env.DB, {
    publicId,
    pairingDigest: digest,
    pairingKeyId: 'test',
    spotifyClientId,
    refreshToken,
    accessToken,
    accessTokenExpiresAtMs: nowMs + 3_600_000,
    refreshAuthorizedAtMs: nowMs,
    nowMs
  });
}
