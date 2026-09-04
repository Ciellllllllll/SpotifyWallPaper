export type SecretContext =
  | {
      kind?: 'credential';
      recordId: string;
      spotifyClientId: string;
      fieldName: 'access_token' | 'code_verifier' | 'refresh_token';
    }
  | {
      kind: 'confirmation';
      recordId: string;
      spotifyClientId: string;
      fieldName: 'authorizationCode' | 'pkceVerifier';
    };

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  keyId: string;
}

export type SecretKeyring = Readonly<Record<string, string>>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export const MAX_ENCRYPTED_SECRET_PLAINTEXT_BYTES = 6128;
const maxEncryptedSecretCiphertextLength = 8192;

export function randomBase64Url(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 1024) {
    throw new Error('Invalid random value length.');
  }

  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function createOAuthState(): string {
  return `swpo2.${randomBase64Url(32)}`;
}

export type DigestDomain =
  | 'oauth-browser-v2'
  | 'oauth-confirm-browser-v1'
  | 'oauth-state-v2'
  | 'setup-browser-v2'
  | 'setup-issuer-v2';

export async function digestProtocolValue(
  domain: DigestDomain,
  value: string,
  encodedKey: string
): Promise<string> {
  return signMessage(`spotify-wallpaper:${domain}:${value}`, encodedKey);
}

export async function createSetupProof(
  sessionId: string,
  expiresAtMs: number,
  encodedKey: string
): Promise<string> {
  return signedProof('swps2', sessionId, expiresAtMs, encodedKey);
}

export async function classifySetupProof(
  value: string,
  encodedKey: string,
  nowMs = Date.now()
): Promise<{ sessionId: string; expiresAtMs: number } | null> {
  const parsed = await classifySignedProof(
    value,
    'swps2',
    'setup-session-v2',
    encodedKey,
    nowMs
  );
  return parsed === null
    ? null
    : { sessionId: parsed.id, expiresAtMs: parsed.expiresAtMs };
}

export async function createConfirmationProof(
  confirmationId: string,
  expiresAtMs: number,
  encodedKey: string
): Promise<string> {
  return signedProof('swpc1', confirmationId, expiresAtMs, encodedKey);
}

export async function classifyConfirmationProof(
  value: string,
  encodedKey: string,
  nowMs = Date.now()
): Promise<{ confirmationId: string; expiresAtMs: number } | null> {
  const parsed = await classifySignedProof(
    value,
    'swpc1',
    'oauth-confirm-v1',
    encodedKey,
    nowMs
  );
  return parsed === null
    ? null
    : { confirmationId: parsed.id, expiresAtMs: parsed.expiresAtMs };
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
    const plaintextBytes = encoder.encode(plaintext);
    if (plaintextBytes.byteLength > MAX_ENCRYPTED_SECRET_PLAINTEXT_BYTES) {
      throw new Error();
    }
    const key = await importAesKey(readKey(keyring, keyId), ['encrypt']);
    const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: arrayBuffer(nonceBytes),
        additionalData: arrayBuffer(aad(context)),
        tagLength: 128
      },
      key,
      arrayBuffer(plaintextBytes)
    );
    const encodedCiphertext = encodeBase64Url(new Uint8Array(ciphertext));
    if (encodedCiphertext.length > maxEncryptedSecretCiphertextLength) {
      throw new Error();
    }

    return {
      ciphertext: encodedCiphertext,
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
        iv: arrayBuffer(decodeBase64Url(encrypted.nonce, 12)),
        additionalData: arrayBuffer(aad(context)),
        tagLength: 128
      },
      key,
      arrayBuffer(decodeBase64Url(encrypted.ciphertext))
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
    context.kind === 'confirmation'
      ? `spotify-wallpaper:oauth-confirm:v1:${context.recordId}:${context.spotifyClientId}:${context.fieldName}`
      : `spotify-wallpaper:v1:${context.recordId}:${context.spotifyClientId}:${context.fieldName}`
  );
}

async function signedProof(
  prefix: 'swpc1' | 'swps2',
  id: string,
  expiresAtMs: number,
  encodedKey: string
): Promise<string> {
  decodeBase64Url(id, 16);
  if (!Number.isSafeInteger(expiresAtMs) || !/^\d{13}$/u.test(String(expiresAtMs))) {
    throw new Error('Invalid proof expiry.');
  }
  const purpose = prefix === 'swps2' ? 'setup-session-v2' : 'oauth-confirm-v1';
  const message = `spotify-wallpaper:${purpose}:${id}:${expiresAtMs}`;
  return `${prefix}.${id}.${expiresAtMs}.${await signMessage(message, encodedKey)}`;
}

async function classifySignedProof(
  value: string,
  prefix: 'swpc1' | 'swps2',
  purpose: 'oauth-confirm-v1' | 'setup-session-v2',
  encodedKey: string,
  nowMs: number
): Promise<{ id: string; expiresAtMs: number } | null> {
  const parts = value.split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== prefix ||
    !/^[A-Za-z0-9_-]{22}$/u.test(parts[1]) ||
    !/^\d{13}$/u.test(parts[2]) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(parts[3])
  ) {
    return null;
  }
  const expiresAtMs = Number(parts[2]);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < nowMs) {
    return null;
  }
  try {
    decodeBase64Url(parts[1], 16);
    const message = `spotify-wallpaper:${purpose}:${parts[1]}:${parts[2]}`;
    return (await verifyMessage(message, parts[3], encodedKey))
      ? { id: parts[1], expiresAtMs }
      : null;
  } catch {
    return null;
  }
}

async function signMessage(message: string, encodedKey: string): Promise<string> {
  try {
    const key = await importHmacKey(encodedKey, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return encodeBase64Url(new Uint8Array(digest));
  } catch {
    throw new Error('Digest generation failed.');
  }
}

async function verifyMessage(
  message: string,
  signature: string,
  encodedKey: string
): Promise<boolean> {
  const key = await importHmacKey(encodedKey, ['verify']);
  return crypto.subtle.verify(
    'HMAC',
    key,
    arrayBuffer(decodeBase64Url(signature, 32)),
    arrayBuffer(encoder.encode(message))
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
  return crypto.subtle.importKey('raw', arrayBuffer(rawKey), 'AES-GCM', false, usages);
}

async function importHmacKey(
  encodedKey: string,
  usages: Array<'sign' | 'verify'>
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    arrayBuffer(decodeBase64Url(encodedKey, 32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
