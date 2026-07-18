export type SecretFieldName = 'access_token' | 'code_verifier' | 'refresh_token';

export interface SecretContext {
  recordId: string;
  spotifyClientId: string;
  fieldName: SecretFieldName;
}

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  keyId: string;
}

export type SecretKeyring = Readonly<Record<string, string>>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function randomBase64Url(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 1024) {
    throw new Error('Invalid random value length.');
  }

  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function createOAuthState(): string {
  return randomBase64Url(32);
}

export function parseSecretKeyring(serialized: string): SecretKeyring {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error();
    }

    const entries = Object.entries(parsed);
    if (entries.length === 0) {
      throw new Error();
    }

    const keyring: Record<string, string> = {};
    for (const [keyId, value] of entries) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || typeof value !== 'string') {
        throw new Error();
      }
      decodeBase64Url(value, 32);
      keyring[keyId] = value;
    }
    return keyring;
  } catch {
    throw new Error('Invalid secret keyring configuration.');
  }
}

export async function encryptSecret(
  plaintext: string,
  context: SecretContext,
  keyId: string,
  keyring: SecretKeyring
): Promise<EncryptedSecret> {
  try {
    const key = await importAesKey(readKey(keyring, keyId), ['encrypt']);
    const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonceBytes,
        additionalData: aad(context),
        tagLength: 128
      },
      key,
      encoder.encode(plaintext)
    );

    return {
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
      nonce: encodeBase64Url(nonceBytes),
      keyId
    };
  } catch {
    throw new Error('Secret encryption failed.');
  }
}

export async function decryptSecret(
  encrypted: EncryptedSecret,
  context: SecretContext,
  keyring: SecretKeyring
): Promise<string> {
  try {
    const key = await importAesKey(readKey(keyring, encrypted.keyId), ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeBase64Url(encrypted.nonce, 12),
        additionalData: aad(context),
        tagLength: 128
      },
      key,
      decodeBase64Url(encrypted.ciphertext)
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error('Secret decryption failed.');
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function decodeBase64Url(value: string, expectedByteLength?: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error('Invalid encoded value.');
  }

  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (expectedByteLength !== undefined && bytes.byteLength !== expectedByteLength) {
    throw new Error('Invalid encoded value.');
  }
  if (encodeBase64Url(bytes) !== value) {
    throw new Error('Invalid encoded value.');
  }
  return bytes;
}

function aad(context: SecretContext): Uint8Array {
  return encoder.encode(
    `spotify-wallpaper:v1:${context.recordId}:${context.spotifyClientId}:${context.fieldName}`
  );
}

function readKey(keyring: SecretKeyring, keyId: string): Uint8Array {
  const encoded = Object.hasOwn(keyring, keyId) ? keyring[keyId] : undefined;
  if (encoded === undefined) {
    throw new Error();
  }
  return decodeBase64Url(encoded, 32);
}

async function importAesKey(
  rawKey: Uint8Array,
  usages: Array<'decrypt' | 'encrypt'>
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, usages);
}
