import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
  type SecretKeyring
} from './crypto';
import { parsePairingToken, verifyPairingDigest } from './pairing';

export interface OAuthSessionInput {
  stateDigest: string;
  browserDigest: string;
  spotifyClientId: string;
  credentialPublicId: string | null;
  codeVerifier: EncryptedSecret;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface OAuthSession {
  stateDigest: string;
  browserDigest: string;
  spotifyClientId: string;
  credentialPublicId: string | null;
  codeVerifier: EncryptedSecret;
  createdAtMs: number;
  expiresAtMs: number;
  consumedAtMs: number;
}

export interface CredentialInput {
  publicId: string;
  pairingDigest: string;
  pairingKeyId: string;
  spotifyClientId: string;
  refreshToken: EncryptedSecret;
  accessToken: EncryptedSecret | null;
  accessTokenExpiresAtMs: number | null;
  refreshAuthorizedAtMs: number;
  nowMs: number;
}

export interface Credential {
  publicId: string;
  pairingDigest: string;
  pairingKeyId: string;
  spotifyClientId: string;
  refreshToken: EncryptedSecret | null;
  accessToken: EncryptedSecret | null;
  accessTokenExpiresAtMs: number | null;
  refreshAuthorizedAtMs: number;
  tokenVersion: number;
  refreshLeaseId: string | null;
  refreshLeaseUntilMs: number | null;
  authStatus: 'active' | 'reauth_required';
  createdAtMs: number;
  updatedAtMs: number;
  lastUsedAtMs: number | null;
}

export interface RefreshLease {
  leaseId: string;
  leaseUntilMs: number;
  tokenVersion: number;
}

export interface CompleteRefreshLeaseInput {
  publicId: string;
  leaseId: string;
  tokenVersion: number;
  accessToken: EncryptedSecret;
  accessTokenExpiresAtMs: number;
  refreshToken: EncryptedSecret | null;
  nowMs: number;
}

export interface ReauthorizeCredentialInput {
  publicId: string;
  spotifyClientId: string;
  refreshToken: EncryptedSecret;
  accessToken: EncryptedSecret;
  accessTokenExpiresAtMs: number;
  refreshAuthorizedAtMs: number;
  nowMs: number;
}

export interface SpotifyBackoff {
  retryUntilMs: number;
  updatedAtMs: number;
}

export interface DeletionTombstone {
  publicId: string;
  deletedAtMs: number;
  expiresAtMs: number;
}

interface OAuthSessionRow {
  state_digest: string;
  browser_digest: string;
  spotify_client_id: string;
  credential_public_id: string | null;
  code_verifier_ciphertext: string;
  code_verifier_nonce: string;
  encryption_key_id: string;
  created_at_ms: number;
  expires_at_ms: number;
  consumed_at_ms: number;
}

interface CredentialRow {
  public_id: string;
  pairing_digest: string;
  pairing_key_id: string;
  spotify_client_id: string;
  refresh_token_ciphertext: string | null;
  refresh_token_nonce: string | null;
  refresh_token_key_id: string | null;
  access_token_ciphertext: string | null;
  access_token_nonce: string | null;
  access_token_key_id: string | null;
  access_token_expires_at_ms: number | null;
  refresh_authorized_at_ms: number;
  token_version: number;
  refresh_lease_id: string | null;
  refresh_lease_until_ms: number | null;
  auth_status: 'active' | 'reauth_required';
  created_at_ms: number;
  updated_at_ms: number;
  last_used_at_ms: number | null;
}

export async function insertOAuthSession(
  db: D1Database,
  session: OAuthSessionInput
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_sessions (
        state_digest, browser_digest, spotify_client_id, credential_public_id,
        code_verifier_ciphertext, code_verifier_nonce, encryption_key_id,
        created_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      session.stateDigest,
      session.browserDigest,
      session.spotifyClientId,
      session.credentialPublicId,
      session.codeVerifier.ciphertext,
      session.codeVerifier.nonce,
      session.codeVerifier.keyId,
      session.createdAtMs,
      session.expiresAtMs
    )
    .run();
}

export async function consumeOAuthSession(
  db: D1Database,
  stateDigest: string,
  browserDigest: string,
  nowMs: number
): Promise<OAuthSession | null> {
  const row = await db
    .prepare(
      `UPDATE oauth_sessions
       SET consumed_at_ms = ?
       WHERE state_digest = ?
         AND browser_digest = ?
         AND consumed_at_ms IS NULL
         AND expires_at_ms >= ?
       RETURNING *`
    )
    .bind(nowMs, stateDigest, browserDigest, nowMs)
    .first<OAuthSessionRow>();

  return row === null ? null : mapOAuthSession(row);
}

export async function createCredential(
  db: D1Database,
  credential: CredentialInput
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credentials (
        public_id, pairing_digest, pairing_key_id, spotify_client_id,
        refresh_token_ciphertext, refresh_token_nonce, refresh_token_key_id,
        access_token_ciphertext, access_token_nonce, access_token_key_id,
        access_token_expires_at_ms, refresh_authorized_at_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      credential.publicId,
      credential.pairingDigest,
      credential.pairingKeyId,
      credential.spotifyClientId,
      credential.refreshToken.ciphertext,
      credential.refreshToken.nonce,
      credential.refreshToken.keyId,
      credential.accessToken?.ciphertext ?? null,
      credential.accessToken?.nonce ?? null,
      credential.accessToken?.keyId ?? null,
      credential.accessTokenExpiresAtMs,
      credential.refreshAuthorizedAtMs,
      credential.nowMs,
      credential.nowMs
    )
    .run();
}

export async function getCredentialByPublicId(
  db: D1Database,
  publicId: string
): Promise<Credential | null> {
  const row = await db
    .prepare('SELECT * FROM credentials WHERE public_id = ?')
    .bind(publicId)
    .first<CredentialRow>();
  return row === null ? null : mapCredential(row);
}

export async function findActiveCredentialByPairingToken(
  db: D1Database,
  token: string,
  pairingKeyring: SecretKeyring
): Promise<Credential | null> {
  const credential = await findCredentialByPairingToken(db, token, pairingKeyring);
  return credential?.authStatus === 'active' ? credential : null;
}

export async function findCredentialByPairingToken(
  db: D1Database,
  token: string,
  pairingKeyring: SecretKeyring
): Promise<Credential | null> {
  const parsed = parsePairingToken(token);
  if (parsed === null) {
    return null;
  }

  const row = await db
    .prepare('SELECT * FROM credentials WHERE public_id = ?')
    .bind(parsed.publicId)
    .first<CredentialRow>();
  if (row === null) {
    return null;
  }

  const key = Object.hasOwn(pairingKeyring, row.pairing_key_id)
    ? pairingKeyring[row.pairing_key_id]
    : undefined;
  if (
    key === undefined ||
    !(await verifyPairingDigest(parsed.publicId, parsed.secret, row.pairing_digest, key))
  ) {
    return null;
  }

  return mapCredential(row);
}

export async function reauthorizeCredential(
  db: D1Database,
  credential: ReauthorizeCredentialInput
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE credentials
       SET refresh_token_ciphertext = ?,
           refresh_token_nonce = ?,
           refresh_token_key_id = ?,
           access_token_ciphertext = ?,
           access_token_nonce = ?,
           access_token_key_id = ?,
           access_token_expires_at_ms = ?,
           refresh_authorized_at_ms = ?,
           token_version = token_version + 1,
           refresh_lease_id = NULL,
           refresh_lease_until_ms = NULL,
           auth_status = 'active',
           updated_at_ms = ?
       WHERE public_id = ? AND spotify_client_id = ?`
    )
    .bind(
      credential.refreshToken.ciphertext,
      credential.refreshToken.nonce,
      credential.refreshToken.keyId,
      credential.accessToken.ciphertext,
      credential.accessToken.nonce,
      credential.accessToken.keyId,
      credential.accessTokenExpiresAtMs,
      credential.refreshAuthorizedAtMs,
      credential.nowMs,
      credential.publicId,
      credential.spotifyClientId
    )
    .run();
  return result.meta.changes === 1;
}

export async function markCredentialReauthorizationRequired(
  db: D1Database,
  publicId: string,
  tokenVersion: number,
  nowMs: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE credentials
       SET auth_status = 'reauth_required',
           refresh_token_ciphertext = NULL,
           refresh_token_nonce = NULL,
           refresh_token_key_id = NULL,
           access_token_ciphertext = NULL,
           access_token_nonce = NULL,
           access_token_key_id = NULL,
           access_token_expires_at_ms = NULL,
           token_version = token_version + 1,
           refresh_lease_id = NULL,
           refresh_lease_until_ms = NULL,
           updated_at_ms = ?
       WHERE public_id = ?
         AND auth_status = 'active'
         AND token_version = ?`
    )
    .bind(nowMs, publicId, tokenVersion)
    .run();
  return result.meta.changes === 1;
}

export async function deleteCredential(
  db: D1Database,
  publicId: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM credentials WHERE public_id = ?')
    .bind(publicId)
    .run();
  return result.meta.changes === 1;
}

export async function acquireRefreshLease(
  db: D1Database,
  publicId: string,
  expectedTokenVersion: number,
  leaseId: string,
  nowMs: number,
  leaseUntilMs: number
): Promise<RefreshLease | null> {
  if (leaseUntilMs <= nowMs) {
    throw new Error('Invalid refresh lease duration.');
  }

  const row = await db
    .prepare(
      `UPDATE credentials
       SET refresh_lease_id = ?, refresh_lease_until_ms = ?, updated_at_ms = ?
       WHERE public_id = ?
         AND auth_status = 'active'
         AND token_version = ?
         AND (refresh_lease_id IS NULL OR refresh_lease_until_ms <= ?)
       RETURNING token_version`
    )
    .bind(leaseId, leaseUntilMs, nowMs, publicId, expectedTokenVersion, nowMs)
    .first<{ token_version: number }>();

  return row === null
    ? null
    : {
        leaseId,
        leaseUntilMs,
        tokenVersion: row.token_version
      };
}

export async function completeRefreshLease(
  db: D1Database,
  completion: CompleteRefreshLeaseInput
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE credentials
       SET access_token_ciphertext = ?,
           access_token_nonce = ?,
           access_token_key_id = ?,
           access_token_expires_at_ms = ?,
           refresh_token_ciphertext = COALESCE(?, refresh_token_ciphertext),
           refresh_token_nonce = COALESCE(?, refresh_token_nonce),
           refresh_token_key_id = COALESCE(?, refresh_token_key_id),
           token_version = token_version + 1,
           refresh_lease_id = NULL,
           refresh_lease_until_ms = NULL,
           updated_at_ms = ?
       WHERE public_id = ?
         AND auth_status = 'active'
         AND refresh_lease_id = ?
         AND token_version = ?
         AND refresh_lease_until_ms >= ?`
    )
    .bind(
      completion.accessToken.ciphertext,
      completion.accessToken.nonce,
      completion.accessToken.keyId,
      completion.accessTokenExpiresAtMs,
      completion.refreshToken?.ciphertext ?? null,
      completion.refreshToken?.nonce ?? null,
      completion.refreshToken?.keyId ?? null,
      completion.nowMs,
      completion.publicId,
      completion.leaseId,
      completion.tokenVersion,
      completion.nowMs
    )
    .run();
  return result.meta.changes === 1;
}

export async function releaseRefreshLease(
  db: D1Database,
  publicId: string,
  leaseId: string,
  tokenVersion: number,
  nowMs: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE credentials
       SET refresh_lease_id = NULL,
           refresh_lease_until_ms = NULL,
           updated_at_ms = ?
       WHERE public_id = ?
         AND refresh_lease_id = ?
         AND token_version = ?`
    )
    .bind(nowMs, publicId, leaseId, tokenVersion)
    .run();
  return result.meta.changes === 1;
}

export async function invalidateAccessToken(
  db: D1Database,
  publicId: string,
  tokenVersion: number,
  nowMs: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE credentials
       SET access_token_expires_at_ms = 0,
           updated_at_ms = ?
       WHERE public_id = ?
         AND auth_status = 'active'
         AND token_version = ?`
    )
    .bind(nowMs, publicId, tokenVersion)
    .run();
  return result.meta.changes === 1;
}

export async function failRefreshLeaseAsReauthorizationRequired(
  db: D1Database,
  publicId: string,
  leaseId: string,
  tokenVersion: number,
  nowMs: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE credentials
       SET auth_status = 'reauth_required',
           refresh_token_ciphertext = NULL,
           refresh_token_nonce = NULL,
           refresh_token_key_id = NULL,
           access_token_ciphertext = NULL,
           access_token_nonce = NULL,
           access_token_key_id = NULL,
           access_token_expires_at_ms = NULL,
           refresh_lease_id = NULL,
           refresh_lease_until_ms = NULL,
           token_version = token_version + 1,
           updated_at_ms = ?
       WHERE public_id = ?
         AND auth_status = 'active'
         AND refresh_lease_id = ?
         AND token_version = ?
         AND refresh_lease_until_ms >= ?`
    )
    .bind(nowMs, publicId, leaseId, tokenVersion, nowMs)
    .run();
  return result.meta.changes === 1;
}

export async function getSpotifyBackoff(
  db: D1Database,
  spotifyClientId: string
): Promise<SpotifyBackoff | null> {
  const row = await db
    .prepare(
      `SELECT retry_until_ms, updated_at_ms
       FROM spotify_backoff
       WHERE spotify_client_id = ?`
    )
    .bind(spotifyClientId)
    .first<{ retry_until_ms: number; updated_at_ms: number }>();
  return row === null
    ? null
    : {
        retryUntilMs: row.retry_until_ms,
        updatedAtMs: row.updated_at_ms
      };
}

export async function upsertSpotifyBackoff(
  db: D1Database,
  spotifyClientId: string,
  retryUntilMs: number,
  nowMs: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO spotify_backoff (spotify_client_id, retry_until_ms, updated_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT (spotify_client_id) DO UPDATE SET
         retry_until_ms = MAX(spotify_backoff.retry_until_ms, excluded.retry_until_ms),
         updated_at_ms = excluded.updated_at_ms`
    )
    .bind(spotifyClientId, retryUntilMs, nowMs)
    .run();
}

export async function writeDeletionTombstone(
  deletionDb: D1Database,
  publicId: string,
  deletedAtMs: number,
  expiresAtMs: number
): Promise<void> {
  await deletionDb
    .prepare(
      `INSERT INTO deletion_tombstones (public_id, deleted_at_ms, expires_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT (public_id) DO UPDATE SET
         deleted_at_ms = MIN(deletion_tombstones.deleted_at_ms, excluded.deleted_at_ms),
         expires_at_ms = MAX(deletion_tombstones.expires_at_ms, excluded.expires_at_ms)`
    )
    .bind(publicId, deletedAtMs, expiresAtMs)
    .run();
}

export async function isDeletionTombstoned(
  deletionDb: D1Database,
  publicId: string
): Promise<boolean> {
  const row = await deletionDb
    .prepare('SELECT 1 AS tombstoned FROM deletion_tombstones WHERE public_id = ?')
    .bind(publicId)
    .first<number>('tombstoned');
  return row === 1;
}

export async function deleteCredentialData(
  db: D1Database,
  publicId: string
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM spotify_backoff
         WHERE spotify_client_id IN (
           SELECT spotify_client_id FROM credentials WHERE public_id = ?
         )
         AND NOT EXISTS (
           SELECT 1
           FROM credentials AS other
           WHERE other.spotify_client_id = spotify_backoff.spotify_client_id
             AND other.public_id <> ?
         )`
      )
      .bind(publicId, publicId),
    db
      .prepare('DELETE FROM oauth_sessions WHERE credential_public_id = ?')
      .bind(publicId),
    db.prepare('DELETE FROM credentials WHERE public_id = ?').bind(publicId)
  ]);
}

export async function reconcileDeletionTombstones(
  db: D1Database,
  deletionDb: D1Database,
  nowMs: number
): Promise<number> {
  let reconciled = 0;
  let cursor = '';
  while (true) {
    const tombstones = await deletionDb
      .prepare(
        `SELECT public_id
         FROM deletion_tombstones
         WHERE public_id > ?
         ORDER BY public_id
         LIMIT 1000`
      )
      .bind(cursor)
      .all<{ public_id: string }>();

    for (const tombstone of tombstones.results) {
      await deleteCredentialData(db, tombstone.public_id);
    }
    reconciled += tombstones.results.length;
    if (tombstones.results.length < 1000) {
      break;
    }
    cursor = tombstones.results[tombstones.results.length - 1]!.public_id;
  }

  await deletionDb
    .prepare('DELETE FROM deletion_tombstones WHERE expires_at_ms <= ?')
    .bind(nowMs)
    .run();
  return reconciled;
}

export async function readCredentialSecrets(
  db: D1Database,
  credential: Credential,
  keyring: SecretKeyring,
  activeKeyId: string,
  nowMs: number
): Promise<{ refreshToken: string; accessToken: string | null }> {
  if (credential.refreshToken === null) {
    throw new Error('Spotify authorization is required.');
  }

  const refreshToken = await decryptSecret(
    credential.refreshToken,
    secretContext(credential, 'refresh_token'),
    keyring
  );
  const accessToken =
    credential.accessToken === null
      ? null
      : await decryptSecret(
          credential.accessToken,
          secretContext(credential, 'access_token'),
          keyring
        );

  if (
    credential.refreshToken.keyId !== activeKeyId ||
    (credential.accessToken !== null && credential.accessToken.keyId !== activeKeyId)
  ) {
    const refresh =
      credential.refreshToken.keyId === activeKeyId
        ? credential.refreshToken
        : await encryptSecret(
            refreshToken,
            secretContext(credential, 'refresh_token'),
            activeKeyId,
            keyring
          );
    const access =
      accessToken === null
        ? null
        : credential.accessToken?.keyId === activeKeyId
          ? credential.accessToken
          : await encryptSecret(
              accessToken,
              secretContext(credential, 'access_token'),
              activeKeyId,
              keyring
            );

    await db
      .prepare(
        `UPDATE credentials
         SET refresh_token_ciphertext = ?,
             refresh_token_nonce = ?,
             refresh_token_key_id = ?,
             access_token_ciphertext = ?,
             access_token_nonce = ?,
             access_token_key_id = ?,
             updated_at_ms = ?
         WHERE public_id = ? AND token_version = ?`
      )
      .bind(
        refresh.ciphertext,
        refresh.nonce,
        refresh.keyId,
        access?.ciphertext ?? null,
        access?.nonce ?? null,
        access?.keyId ?? null,
        nowMs,
        credential.publicId,
        credential.tokenVersion
      )
      .run();
  }

  return { refreshToken, accessToken };
}

function mapOAuthSession(row: OAuthSessionRow): OAuthSession {
  return {
    stateDigest: row.state_digest,
    browserDigest: row.browser_digest,
    spotifyClientId: row.spotify_client_id,
    credentialPublicId: row.credential_public_id,
    codeVerifier: {
      ciphertext: row.code_verifier_ciphertext,
      nonce: row.code_verifier_nonce,
      keyId: row.encryption_key_id
    },
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
    consumedAtMs: row.consumed_at_ms
  };
}

function mapCredential(row: CredentialRow): Credential {
  return {
    publicId: row.public_id,
    pairingDigest: row.pairing_digest,
    pairingKeyId: row.pairing_key_id,
    spotifyClientId: row.spotify_client_id,
    refreshToken:
      row.refresh_token_ciphertext === null ||
      row.refresh_token_nonce === null ||
      row.refresh_token_key_id === null
        ? null
        : {
            ciphertext: row.refresh_token_ciphertext,
            nonce: row.refresh_token_nonce,
            keyId: row.refresh_token_key_id
          },
    accessToken:
      row.access_token_ciphertext === null ||
      row.access_token_nonce === null ||
      row.access_token_key_id === null
        ? null
        : {
            ciphertext: row.access_token_ciphertext,
            nonce: row.access_token_nonce,
            keyId: row.access_token_key_id
          },
    accessTokenExpiresAtMs: row.access_token_expires_at_ms,
    refreshAuthorizedAtMs: row.refresh_authorized_at_ms,
    tokenVersion: row.token_version,
    refreshLeaseId: row.refresh_lease_id,
    refreshLeaseUntilMs: row.refresh_lease_until_ms,
    authStatus: row.auth_status,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    lastUsedAtMs: row.last_used_at_ms
  };
}

function secretContext(
  credential: Pick<Credential, 'publicId' | 'spotifyClientId'>,
  fieldName: 'access_token' | 'refresh_token'
) {
  return {
    recordId: credential.publicId,
    spotifyClientId: credential.spotifyClientId,
    fieldName
  } as const;
}
