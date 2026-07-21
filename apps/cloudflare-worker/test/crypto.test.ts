import { describe, expect, it } from 'vitest';

import {
  createSetupProof,
  createOAuthState,
  decryptSecret,
  encryptSecret,
  randomBase64Url,
  verifySetupProof
} from '../src/crypto';
import {
  generatePairingToken,
  pairingDigest,
  parsePairingToken,
  verifyPairingDigest
} from '../src/pairing';

const encryptionKeys = {
  current: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  previous: 'QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ'
};
const pairingKey = 'ggggggggggggggggggggggggggggggggggggggggggg';

describe('secret generation', () => {
  it('creates a 256-bit OAuth state', () => {
    const state = createOAuthState();

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toBe(createOAuthState());
  });

  it('creates a versioned token with a 128-bit public ID and 256-bit secret', () => {
    const pairing = generatePairingToken();

    expect(pairing.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pairing.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pairing.token).toBe(`swpb1.${pairing.publicId}.${pairing.secret}`);
    expect(pairing.token.length).toBeLessThanOrEqual(256);
  });

  it('uses exact byte lengths for generic random values', () => {
    expect(randomBase64Url(12)).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('creates a signed setup proof that expires after ten minutes', async () => {
    const nowMs = 1_700_000_000_000;
    const proof = await createSetupProof(pairingKey, nowMs);

    expect(proof).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    await expect(verifySetupProof(proof, pairingKey, nowMs)).resolves.toBe(true);
    await expect(verifySetupProof(proof, pairingKey, nowMs + 600_001)).resolves.toBe(false);
    await expect(
      verifySetupProof(`${proof.slice(0, -1)}${proof.endsWith('A') ? 'Q' : 'A'}`, pairingKey, nowMs)
    ).resolves.toBe(false);
  });
});

describe('Pairing Token verification', () => {
  it('strictly parses only the swpb1 format', () => {
    const pairing = generatePairingToken();

    expect(parsePairingToken(pairing.token)).toEqual({
      publicId: pairing.publicId,
      secret: pairing.secret
    });
    for (const malformed of [
      '',
      `swpb2.${pairing.publicId}.${pairing.secret}`,
      `swpb1.${pairing.publicId}`,
      `swpb1.${pairing.publicId}.${pairing.secret}.extra`,
      `swpb1.${pairing.publicId}=.${pairing.secret}`,
      `swpb1.${pairing.publicId}.${pairing.secret}=`,
      ` swpb1.${pairing.publicId}.${pairing.secret}`,
      `swpb1.${pairing.publicId}.${pairing.secret}\n`
    ]) {
      expect(parsePairingToken(malformed)).toBeNull();
    }
  });

  it('verifies the HMAC digest through Web Crypto', async () => {
    const pairing = generatePairingToken();
    const digest = await pairingDigest(pairing.publicId, pairing.secret, pairingKey);

    await expect(
      verifyPairingDigest(pairing.publicId, pairing.secret, digest, pairingKey)
    ).resolves.toBe(true);
    await expect(
      verifyPairingDigest(
        pairing.publicId,
        `${pairing.secret.slice(0, -1)}${pairing.secret.endsWith('A') ? 'Q' : 'A'}`,
        digest,
        pairingKey
      )
    ).resolves.toBe(false);
  });
});

describe('AES-256-GCM storage encryption', () => {
  const context = {
    recordId: 'credential-public-id',
    spotifyClientId: 'spotify-client-id',
    fieldName: 'refresh_token'
  } as const;

  it('round trips with a random 96-bit nonce', async () => {
    const first = await encryptSecret('refresh-token-value', context, 'current', encryptionKeys);
    const second = await encryptSecret('refresh-token-value', context, 'current', encryptionKeys);

    expect(first.nonce).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(first.ciphertext).not.toContain('refresh-token-value');
    expect(first).not.toEqual(second);
    await expect(decryptSecret(first, context, encryptionKeys)).resolves.toBe('refresh-token-value');
  });

  it('rejects the wrong key, AAD, nonce, and record ID', async () => {
    const encrypted = await encryptSecret('access-token-value', context, 'current', encryptionKeys);
    const wrongKeys = { current: encryptionKeys.previous };

    await expect(decryptSecret(encrypted, context, wrongKeys)).rejects.toThrow('Secret decryption failed.');
    await expect(
      decryptSecret(encrypted, { ...context, fieldName: 'access_token' }, encryptionKeys)
    ).rejects.toThrow('Secret decryption failed.');
    await expect(
      decryptSecret({ ...encrypted, nonce: randomBase64Url(12) }, context, encryptionKeys)
    ).rejects.toThrow('Secret decryption failed.');
    await expect(
      decryptSecret(encrypted, { ...context, recordId: 'other-record' }, encryptionKeys)
    ).rejects.toThrow('Secret decryption failed.');
  });

  it('rejects an unknown key ID without exposing it', async () => {
    const encrypted = await encryptSecret('access-token-value', context, 'current', encryptionKeys);
    const unknown = { ...encrypted, keyId: 'missing-secret-key-name' };

    await expect(decryptSecret(unknown, context, encryptionKeys)).rejects.toThrow(
      'Secret decryption failed.'
    );
    await expect(decryptSecret(unknown, context, encryptionKeys)).rejects.not.toThrow(
      'missing-secret-key-name'
    );
  });
});
