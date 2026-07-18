import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { encryptSecret } from '../src/crypto';
import {
  acquireRefreshLease,
  completeRefreshLease,
  consumeOAuthSession,
  createCredential,
  findActiveCredentialByPairingToken,
  getCredentialByPublicId,
  insertOAuthSession,
  markCredentialReauthorizationRequired,
  readCredentialSecrets
} from '../src/db';
import { generatePairingToken, pairingDigest } from '../src/pairing';

const encryptionKeys = {
  current: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};
const pairingKeys = {
  current: 'ggggggggggggggggggggggggggggggggggggggggggg'
};

const nowMs = 1_800_000_000_000;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM spotify_backoff'),
    env.DB.prepare('DELETE FROM oauth_sessions'),
    env.DB.prepare('DELETE FROM credentials')
  ]);
});

describe('OAuth sessions', () => {
  it('can consume a valid state only once', async () => {
    await insertOAuthSession(env.DB, {
      stateDigest: 'state-digest',
      browserDigest: 'browser-digest',
      spotifyClientId: 'spotify-client-id',
      credentialPublicId: null,
      codeVerifier: {
        ciphertext: 'encrypted-verifier',
        nonce: 'nonce',
        keyId: 'current'
      },
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 60_000
    });

    const first = await consumeOAuthSession(
      env.DB,
      'state-digest',
      'browser-digest',
      nowMs + 1
    );
    const replay = await consumeOAuthSession(
      env.DB,
      'state-digest',
      'browser-digest',
      nowMs + 2
    );

    expect(first?.spotifyClientId).toBe('spotify-client-id');
    expect(replay).toBeNull();
  });

  it('does not consume an expired or browser-mismatched session', async () => {
    await insertOAuthSession(env.DB, {
      stateDigest: 'state-digest',
      browserDigest: 'browser-digest',
      spotifyClientId: 'spotify-client-id',
      credentialPublicId: null,
      codeVerifier: {
        ciphertext: 'encrypted-verifier',
        nonce: 'nonce',
        keyId: 'current'
      },
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 100
    });

    await expect(
      consumeOAuthSession(env.DB, 'state-digest', 'other-browser', nowMs + 1)
    ).resolves.toBeNull();
    await expect(
      consumeOAuthSession(env.DB, 'state-digest', 'browser-digest', nowMs + 101)
    ).resolves.toBeNull();
  });
});

describe('credential storage', () => {
  it('stores no plaintext Pairing, Refresh, or Access token', async () => {
    const pairing = generatePairingToken();
    const pairingHash = await pairingDigest(pairing.publicId, pairing.secret, pairingKeys.current);
    const refreshToken = 'plaintext-refresh-token';
    const accessToken = 'plaintext-access-token';
    const refresh = await encryptSecret(
      refreshToken,
      {
        recordId: pairing.publicId,
        spotifyClientId: 'spotify-client-id',
        fieldName: 'refresh_token'
      },
      'current',
      encryptionKeys
    );
    const access = await encryptSecret(
      accessToken,
      {
        recordId: pairing.publicId,
        spotifyClientId: 'spotify-client-id',
        fieldName: 'access_token'
      },
      'current',
      encryptionKeys
    );

    await createCredential(env.DB, {
      publicId: pairing.publicId,
      pairingDigest: pairingHash,
      pairingKeyId: 'current',
      spotifyClientId: 'spotify-client-id',
      refreshToken: refresh,
      accessToken: access,
      accessTokenExpiresAtMs: nowMs + 3_600_000,
      refreshAuthorizedAtMs: nowMs,
      nowMs
    });

    const row = await env.DB.prepare('SELECT * FROM credentials WHERE public_id = ?')
      .bind(pairing.publicId)
      .first();
    const serialized = JSON.stringify(row);

    expect(serialized).not.toContain(pairing.secret);
    expect(serialized).not.toContain(pairing.token);
    expect(serialized).not.toContain(refreshToken);
    expect(serialized).not.toContain(accessToken);
  });

  it('rejects malformed, incorrect, and revoked Pairing Tokens', async () => {
    const pairing = await createTestCredential();

    await expect(
      findActiveCredentialByPairingToken(env.DB, pairing.token, pairingKeys)
    ).resolves.toMatchObject({ publicId: pairing.publicId });
    await expect(
      findActiveCredentialByPairingToken(
        env.DB,
        `${pairing.token.slice(0, -1)}${pairing.token.endsWith('A') ? 'Q' : 'A'}`,
        pairingKeys
      )
    ).resolves.toBeNull();
    await expect(
      findActiveCredentialByPairingToken(env.DB, 'malformed', pairingKeys)
    ).resolves.toBeNull();

    await expect(
      markCredentialReauthorizationRequired(
        env.DB,
        pairing.publicId,
        999,
        nowMs + 1
      )
    ).resolves.toBe(false);
    await expect(
      findActiveCredentialByPairingToken(env.DB, pairing.token, pairingKeys)
    ).resolves.toMatchObject({ publicId: pairing.publicId });
    await expect(
      markCredentialReauthorizationRequired(
        env.DB,
        pairing.publicId,
        1,
        nowMs + 1
      )
    ).resolves.toBe(true);
    await expect(
      findActiveCredentialByPairingToken(env.DB, pairing.token, pairingKeys)
    ).resolves.toBeNull();

    const revoked = await env.DB.prepare(
      `SELECT
        refresh_token_ciphertext,
        refresh_token_nonce,
        refresh_token_key_id,
        access_token_ciphertext,
        access_token_nonce,
        access_token_key_id,
        access_token_expires_at_ms
       FROM credentials
       WHERE public_id = ?`
    )
      .bind(pairing.publicId)
      .first<Record<string, string | number | null>>();
    expect(revoked).toEqual({
      refresh_token_ciphertext: null,
      refresh_token_nonce: null,
      refresh_token_key_id: null,
      access_token_ciphertext: null,
      access_token_nonce: null,
      access_token_key_id: null,
      access_token_expires_at_ms: null
    });
  });

  it('re-encrypts secrets with the active key after a successful read', async () => {
    const rotatingKeys = {
      current: encryptionKeys.current,
      previous: 'QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ'
    };
    const pairing = generatePairingToken();
    const digest = await pairingDigest(pairing.publicId, pairing.secret, pairingKeys.current);
    const previousRefresh = await encryptSecret(
      'refresh-token',
      {
        recordId: pairing.publicId,
        spotifyClientId: 'spotify-client-id',
        fieldName: 'refresh_token'
      },
      'previous',
      rotatingKeys
    );
    await createCredential(env.DB, {
      publicId: pairing.publicId,
      pairingDigest: digest,
      pairingKeyId: 'current',
      spotifyClientId: 'spotify-client-id',
      refreshToken: previousRefresh,
      accessToken: null,
      accessTokenExpiresAtMs: null,
      refreshAuthorizedAtMs: nowMs,
      nowMs
    });

    const stored = await getCredentialByPublicId(env.DB, pairing.publicId);
    expect(stored).not.toBeNull();
    await expect(
      readCredentialSecrets(env.DB, stored!, rotatingKeys, 'current', nowMs + 1)
    ).resolves.toEqual({
      refreshToken: 'refresh-token',
      accessToken: null
    });

    const rotated = await getCredentialByPublicId(env.DB, pairing.publicId);
    expect(rotated?.refreshToken?.keyId).toBe('current');
    expect(rotated?.refreshToken?.ciphertext).not.toBe(previousRefresh.ciphertext);
  });
});

describe('deletion ledger', () => {
  it('contains only opaque tombstone identifiers and timestamps', async () => {
    const columns = await env.DELETION_DB.prepare('PRAGMA table_info(deletion_tombstones)').all<{
      name: string;
    }>();

    expect(columns.results.map(({ name }) => name)).toEqual([
      'public_id',
      'deleted_at_ms',
      'expires_at_ms'
    ]);
  });
});

describe('refresh leases', () => {
  it('allows only one concurrent lease acquisition', async () => {
    const pairing = await createTestCredential();

    const [first, second] = await Promise.all([
      acquireRefreshLease(env.DB, pairing.publicId, 'lease-one', nowMs, nowMs + 30_000),
      acquireRefreshLease(env.DB, pairing.publicId, 'lease-two', nowMs, nowMs + 30_000)
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter(Boolean)[0]).toMatchObject({
      leaseUntilMs: nowMs + 30_000,
      tokenVersion: 1
    });
  });

  it('prevents a stale lease from overwriting rotated tokens', async () => {
    const pairing = await createTestCredential();
    const lease = await acquireRefreshLease(
      env.DB,
      pairing.publicId,
      'lease-current',
      nowMs,
      nowMs + 30_000
    );
    expect(lease).not.toBeNull();

    const replacement = await encryptSecret(
      'new-access-token',
      {
        recordId: pairing.publicId,
        spotifyClientId: 'spotify-client-id',
        fieldName: 'access_token'
      },
      'current',
      encryptionKeys
    );

    await expect(
      completeRefreshLease(env.DB, {
        publicId: pairing.publicId,
        leaseId: 'lease-stale',
        tokenVersion: 1,
        accessToken: replacement,
        accessTokenExpiresAtMs: nowMs + 3_600_000,
        refreshToken: null,
        nowMs
      })
    ).resolves.toBe(false);
    await expect(
      completeRefreshLease(env.DB, {
        publicId: pairing.publicId,
        leaseId: 'lease-current',
        tokenVersion: 1,
        accessToken: replacement,
        accessTokenExpiresAtMs: nowMs + 3_600_000,
        refreshToken: null,
        nowMs
      })
    ).resolves.toBe(true);
    await expect(
      completeRefreshLease(env.DB, {
        publicId: pairing.publicId,
        leaseId: 'lease-current',
        tokenVersion: 1,
        accessToken: replacement,
        accessTokenExpiresAtMs: nowMs + 3_600_000,
        refreshToken: null,
        nowMs
      })
    ).resolves.toBe(false);
  });

  it('rejects completion after the lease expires', async () => {
    const pairing = await createTestCredential();
    await acquireRefreshLease(
      env.DB,
      pairing.publicId,
      'lease-expiring',
      nowMs,
      nowMs + 10
    );
    const replacement = await encryptSecret(
      'new-access-token',
      {
        recordId: pairing.publicId,
        spotifyClientId: 'spotify-client-id',
        fieldName: 'access_token'
      },
      'current',
      encryptionKeys
    );

    await expect(
      completeRefreshLease(env.DB, {
        publicId: pairing.publicId,
        leaseId: 'lease-expiring',
        tokenVersion: 1,
        accessToken: replacement,
        accessTokenExpiresAtMs: nowMs + 3_600_000,
        refreshToken: null,
        nowMs: nowMs + 11
      })
    ).resolves.toBe(false);
  });
});

async function createTestCredential() {
  const pairing = generatePairingToken();
  const digest = await pairingDigest(pairing.publicId, pairing.secret, pairingKeys.current);
  const refresh = await encryptSecret(
    'refresh-token',
    {
      recordId: pairing.publicId,
      spotifyClientId: 'spotify-client-id',
      fieldName: 'refresh_token'
    },
    'current',
    encryptionKeys
  );

  await createCredential(env.DB, {
    publicId: pairing.publicId,
    pairingDigest: digest,
    pairingKeyId: 'current',
    spotifyClientId: 'spotify-client-id',
    refreshToken: refresh,
    accessToken: null,
    accessTokenExpiresAtMs: null,
    refreshAuthorizedAtMs: nowMs,
    nowMs
  });

  return pairing;
}
