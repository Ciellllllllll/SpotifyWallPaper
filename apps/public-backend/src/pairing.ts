import {
  decodeBase64Url,
  encodeBase64Url,
  randomBase64Url,
  type SecretKeyring
} from './crypto.js';

export interface PairingToken {
  token: string;
  publicId: string;
  secret: string;
}

export interface ParsedPairingToken {
  publicId: string;
  secret: string;
}

const encoder = new TextEncoder();
const pairingTokenPattern = /^swpb1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

export function generatePairingToken(): PairingToken {
  const publicId = randomBase64Url(16);
  const secret = randomBase64Url(32);
  return {
    token: `swpb1.${publicId}.${secret}`,
    publicId,
    secret
  };
}

export function parsePairingToken(value: string): ParsedPairingToken | null {
  const match = pairingTokenPattern.exec(value);
  if (match === null) {
    return null;
  }

  try {
    decodeBase64Url(match[1], 16);
    decodeBase64Url(match[2], 32);
    return {
      publicId: match[1],
      secret: match[2]
    };
  } catch {
    return null;
  }
}

export async function pairingDigest(
  publicId: string,
  secret: string,
  encodedKey: string
): Promise<string> {
  const key = await importHmacKey(encodedKey, ['sign']);
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    arrayBuffer(pairingMessage(publicId, secret))
  );
  return encodeBase64Url(new Uint8Array(digest));
}

export async function verifyPairingDigest(
  publicId: string,
  secret: string,
  encodedDigest: string,
  encodedKey: string
): Promise<boolean> {
  try {
    const key = await importHmacKey(encodedKey, ['verify']);
    return crypto.subtle.verify(
      'HMAC',
      key,
      arrayBuffer(decodeBase64Url(encodedDigest, 32)),
      arrayBuffer(pairingMessage(publicId, secret))
    );
  } catch {
    return false;
  }
}

export function activePairingKey(
  keyring: SecretKeyring,
  activeKeyId: string
): string {
  const key = Object.hasOwn(keyring, activeKeyId) ? keyring[activeKeyId] : undefined;
  if (key === undefined) {
    throw new Error('Invalid Pairing key configuration.');
  }
  decodeBase64Url(key, 32);
  return key;
}

function pairingMessage(publicId: string, secret: string): Uint8Array {
  return encoder.encode(`spotify-wallpaper:pairing:v1:${publicId}:${secret}`);
}

async function importHmacKey(
  encodedKey: string,
  usages: Array<'sign' | 'verify'>
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    arrayBuffer(decodeBase64Url(encodedKey, 32)),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    usages
  );
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
