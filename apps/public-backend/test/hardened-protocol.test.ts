import { describe, expect, it } from 'vitest';

import {
  classifyConfirmationProof,
  classifySetupProof,
  createConfirmationProof,
  createOAuthState,
  createSetupProof,
  digestProtocolValue,
  encryptSecret,
  decryptSecret
} from '../src/crypto.js';
import { canonicalIssuer, readSingleCookie } from '../src/issuer.js';
import { FixedWindowLimiter } from '../src/rate-limit.js';

const hmacKey = 'ggggggggggggggggggggggggggggggggggggggggggg';
const encryptionKeys = {
  current: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};

describe('hardened protocol values', () => {
  it('uses exact swpo2, swps2, and swpc1 grammars with signed expiry', async () => {
    const state = createOAuthState();
    expect(state).toMatch(/^swpo2\.[A-Za-z0-9_-]{43}$/u);

    const sessionId = 'AAAAAAAAAAAAAAAAAAAAAA';
    const confirmationId = 'QQQQQQQQQQQQQQQQQQQQQQ';
    const expiresAtMs = 1_700_000_600_000;
    const setup = await createSetupProof(sessionId, expiresAtMs, hmacKey);
    const confirmation = await createConfirmationProof(
      confirmationId,
      expiresAtMs,
      hmacKey
    );

    expect(setup).toMatch(/^swps2\.[A-Za-z0-9_-]{22}\.\d{13}\.[A-Za-z0-9_-]{43}$/u);
    expect(confirmation).toMatch(/^swpc1\.[A-Za-z0-9_-]{22}\.\d{13}\.[A-Za-z0-9_-]{43}$/u);
    await expect(
      classifySetupProof(setup, hmacKey, expiresAtMs - 1)
    ).resolves.toEqual({ sessionId, expiresAtMs });
    await expect(
      classifyConfirmationProof(confirmation, hmacKey, expiresAtMs - 1)
    ).resolves.toEqual({ confirmationId, expiresAtMs });
    await expect(
      classifyConfirmationProof(confirmation, hmacKey, expiresAtMs + 1)
    ).resolves.toBeNull();
    await expect(
      classifySetupProof(setup.replace('swps2', 'swps1'), hmacKey, expiresAtMs - 1)
    ).resolves.toBeNull();
  });

  it('separates every digest purpose', async () => {
    const value = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const domains = [
      'setup-browser-v2',
      'setup-issuer-v2',
      'oauth-browser-v2',
      'oauth-state-v2',
      'oauth-confirm-browser-v1'
    ] as const;
    const digests = await Promise.all(
      domains.map((domain) => digestProtocolValue(domain, value, hmacKey))
    );
    expect(new Set(digests).size).toBe(domains.length);
  });

  it('binds pending code/verifier ciphertext to row, client, and field', async () => {
    const context = {
      kind: 'confirmation',
      recordId: 'confirmation-id',
      spotifyClientId: 'client-id-123456',
      fieldName: 'authorizationCode'
    } as const;
    const encrypted = await encryptSecret(
      'authorization-code',
      context,
      'current',
      encryptionKeys
    );
    await expect(
      decryptSecret(encrypted, context, encryptionKeys)
    ).resolves.toBe('authorization-code');
    await expect(
      decryptSecret(
        { ...encrypted },
        { ...context, fieldName: 'pkceVerifier' },
        encryptionKeys
      )
    ).rejects.toThrow('Secret decryption failed.');
  });
});

describe('issuer and cookie boundaries', () => {
  it.each([
    ['192.0.2.1', 'v4:c0000201'],
    ['::ffff:192.0.2.1', 'v4:c0000201'],
    ['2001:db8::1', 'v6:20010db8000000000000000000000001']
  ])('canonicalizes %s', (input, expected) => {
    expect(canonicalIssuer(input)).toBe(expected);
  });

  it.each(['', 'unknown', '192.0.2.1, 198.51.100.2', '2001:db8:::1']) (
    'rejects malformed issuer %s',
    (input) => {
      expect(canonicalIssuer(input)).toBeNull();
    }
  );

  it('rejects duplicate and noncanonical cookies', () => {
    const value = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(readSingleCookie(`a=1; __Host-swp-oauth-v2=${value}`, '__Host-swp-oauth-v2')).toEqual({
      kind: 'valid',
      value
    });
    expect(readSingleCookie(null, '__Host-swp-oauth-v2')).toEqual({ kind: 'missing' });
    expect(
      readSingleCookie(
        `__Host-swp-oauth-v2=${value}; __Host-swp-oauth-v2=${value}`,
        '__Host-swp-oauth-v2'
      )
    ).toEqual({ kind: 'invalid' });
    expect(
      readSingleCookie(
        `__Host-swp-oauth-v2=${'A'.repeat(42)}B`,
        '__Host-swp-oauth-v2'
      )
    ).toEqual({ kind: 'invalid' });
  });
});

describe('bounded fixed-window rate limiter', () => {
  it('enforces limits, retry bounds, expiry, and capacity fail-closed', () => {
    let nowMs = 1_000;
    const limiter = new FixedWindowLimiter(2, 1, () => nowMs);
    expect(limiter.take('a')).toEqual({ allowed: true });
    expect(limiter.take('a')).toEqual({ allowed: true });
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.take('b')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    nowMs += 60_000;
    expect(limiter.take('b')).toEqual({ allowed: true });
    expect(limiter.size).toBe(1);
  });
});
