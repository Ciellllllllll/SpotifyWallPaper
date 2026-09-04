import {
  decodeBase64Url,
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
  type SecretKeyring
} from './crypto.js';
import { parsePairingToken, verifyPairingDigest } from './pairing.js';

export interface DatabaseQueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface DatabaseClient {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<DatabaseQueryResult<Row>>;
  release(error?: Error | boolean): void;
}

export interface DatabasePool {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<DatabaseQueryResult<Row>>;
  connect(): Promise<DatabaseClient>;
  end?(): Promise<void>;
}

export interface DatabasePoolConstructor {
  new (config: Record<string, unknown>): DatabasePool;
}

export interface DatabasePools {
  primary: DatabasePool;
  deletion: DatabasePool;
}

export interface DatabasePoolConfigs {
  primary: Readonly<Record<string, unknown>>;
  deletion: Readonly<Record<string, unknown>>;
}

export async function createDatabasePools(
  configs: DatabasePoolConfigs,
  PoolImplementation?: DatabasePoolConstructor
): Promise<DatabasePools> {
  const Pool = PoolImplementation ?? (await loadPoolConstructor());
  return {
    primary: new Pool({ ...configs.primary, max: 2 }),
    deletion: new Pool({ ...configs.deletion, max: 2 })
  };
}

async function loadPoolConstructor(): Promise<DatabasePoolConstructor> {
  const moduleName = 'pg';
  const pg = (await import(moduleName)) as { Pool: DatabasePoolConstructor };
  return pg.Pool;
}

export function parseCanonicalPgBigInt(
  value: unknown,
  fieldName: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new Error(`Invalid maximum for ${fieldName}.`);
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Invalid PostgreSQL BIGINT value for ${fieldName}.`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(maximum)) {
    throw new Error(`PostgreSQL BIGINT value for ${fieldName} is out of range.`);
  }
  return Number(parsed);
}

function nullableBigInt(value: unknown, fieldName: string, maximum?: number): number | null {
  return value === null
    ? null
    : parseCanonicalPgBigInt(value, fieldName, maximum ?? Number.MAX_SAFE_INTEGER);
}

async function transaction<T>(
  pool: DatabasePool,
  operation: (client: DatabaseClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError =
        rollbackError instanceof Error
          ? rollbackError
          : new Error('Database rollback failed.', { cause: rollbackError });
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export interface SetupSessionInput {
  sessionId: string;
  browserDigest: string;
  issuerDigest: string;
  previousBrowserDigest: string | null;
  privacyVersion: string;
  eulaVersion: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface SetupSession {
  sessionId: string;
  browserDigest: string;
  issuerDigest: string;
  privacyVersion: string;
  eulaVersion: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export function setupAdvisoryLockKeys(issuerDigest: string): readonly [number, number] {
  const bytes = decodeBase64Url(issuerDigest, 32);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getInt32(0, false), view.getInt32(4, false)];
}

export async function createSetupSession(
  db: DatabasePool,
  input: SetupSessionInput
): Promise<boolean> {
  const [lockKey1, lockKey2] = setupAdvisoryLockKeys(input.issuerDigest);
  return transaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockKey1, lockKey2]);
    if (input.previousBrowserDigest !== null) {
      await client.query(
        `UPDATE setup_sessions
         SET consumed_at_ms = $1
         WHERE browser_digest = $2
           AND consumed_at_ms IS NULL`,
        [input.createdAtMs, input.previousBrowserDigest]
      );
    }
    const count = await client.query<{ live_count: string }>(
      `SELECT COUNT(*)::BIGINT AS live_count
       FROM setup_sessions
       WHERE issuer_digest = $1
         AND consumed_at_ms IS NULL
         AND expires_at_ms >= $2`,
      [input.issuerDigest, input.createdAtMs]
    );
    const liveCount = parseCanonicalPgBigInt(
      count.rows[0]?.live_count,
      'setup_sessions.live_count',
      3
    );
    if (liveCount >= 3) {
      return false;
    }
    await client.query(
      `INSERT INTO setup_sessions (
         session_id, browser_digest, issuer_digest, protocol_version,
         privacy_version, eula_version, created_at_ms, expires_at_ms
       ) VALUES ($1, $2, $3, 2, $4, $5, $6, $7)`,
      [
        input.sessionId,
        input.browserDigest,
        input.issuerDigest,
        input.privacyVersion,
        input.eulaVersion,
        input.createdAtMs,
        input.expiresAtMs
      ]
    );
    return true;
  });
}

export async function consumeSetupSession(
  db: DatabasePool,
  sessionId: string,
  browserDigest: string,
  expiresAtMs: number,
  nowMs: number
): Promise<SetupSession | null> {
  const result = await db.query<SetupSessionRow>(
    `DELETE FROM setup_sessions
     WHERE session_id = $1
       AND browser_digest = $2
       AND protocol_version = 2
       AND expires_at_ms = $3
       AND expires_at_ms >= $4
       AND consumed_at_ms IS NULL
     RETURNING *`,
    [sessionId, browserDigest, expiresAtMs, nowMs]
  );
  return result.rows[0] === undefined ? null : mapSetupSession(result.rows[0]);
}

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
  consumedAtMs: number | null;
}

export async function insertOAuthSession(
  db: DatabasePool,
  session: OAuthSessionInput
): Promise<void> {
  await db.query(
    `INSERT INTO oauth_sessions (
       state_digest, browser_digest, spotify_client_id, credential_public_id,
       protocol_version, code_verifier_ciphertext, code_verifier_nonce,
       encryption_key_id, created_at_ms, expires_at_ms
     ) VALUES ($1, $2, $3, $4, 2, $5, $6, $7, $8, $9)`,
    [
      session.stateDigest,
      session.browserDigest,
      session.spotifyClientId,
      session.credentialPublicId,
      session.codeVerifier.ciphertext,
      session.codeVerifier.nonce,
      session.codeVerifier.keyId,
      session.createdAtMs,
      session.expiresAtMs
    ]
  );
}

export async function consumeOAuthSession(
  db: DatabasePool,
  stateDigest: string,
  browserDigest: string,
  nowMs: number
): Promise<OAuthSession | null> {
  const result = await db.query<OAuthSessionRow>(
    `DELETE FROM oauth_sessions
     WHERE state_digest = $1
       AND browser_digest = $2
       AND protocol_version = 2
       AND consumed_at_ms IS NULL
       AND expires_at_ms >= $3
     RETURNING *`,
    [stateDigest, browserDigest, nowMs]
  );
  return result.rows[0] === undefined ? null : mapOAuthSession(result.rows[0]);
}

export interface MoveOAuthSessionToConfirmationInput {
  stateDigest: string;
  confirmationId: string;
  browserDigest: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface EncryptedCallbackSecrets {
  authorizationCode: EncryptedSecret;
  codeVerifier: EncryptedSecret;
}

export interface CallbackConfirmation {
  confirmationId: string;
  browserDigest: string;
  spotifyClientId: string;
  authorizationCode: EncryptedSecret;
  codeVerifier: EncryptedSecret;
  createdAtMs: number;
  expiresAtMs: number;
}

export async function moveOAuthSessionToConfirmation(
  db: DatabasePool,
  input: MoveOAuthSessionToConfirmationInput,
  // This callback is for local Web Crypto only; it must never perform I/O.
  encryptSecrets: (
    consumedSession: OAuthSession,
    confirmationId: string
  ) => Promise<EncryptedCallbackSecrets>
): Promise<CallbackConfirmation | null> {
  return transaction(db, async (client) => {
    const consumed = await client.query<OAuthSessionRow>(
      `DELETE FROM oauth_sessions
       WHERE state_digest = $1
         AND credential_public_id IS NULL
         AND protocol_version = 2
         AND consumed_at_ms IS NULL
         AND expires_at_ms >= $2
       RETURNING *`,
      [input.stateDigest, input.createdAtMs]
    );
    const row = consumed.rows[0];
    if (row === undefined) {
      return null;
    }

    const session = mapOAuthSession(row);
    const encrypted = await encryptSecrets(session, input.confirmationId);
    const inserted = await client.query<CallbackConfirmationRow>(
      `INSERT INTO callback_confirmations (
         confirmation_id, browser_digest, spotify_client_id, protocol_version,
         authorization_code_ciphertext, authorization_code_nonce,
         authorization_code_key_id, code_verifier_ciphertext,
         code_verifier_nonce, code_verifier_key_id, created_at_ms, expires_at_ms
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.confirmationId,
        input.browserDigest,
        session.spotifyClientId,
        encrypted.authorizationCode.ciphertext,
        encrypted.authorizationCode.nonce,
        encrypted.authorizationCode.keyId,
        encrypted.codeVerifier.ciphertext,
        encrypted.codeVerifier.nonce,
        encrypted.codeVerifier.keyId,
        input.createdAtMs,
        input.expiresAtMs
      ]
    );
    if (inserted.rows[0] === undefined) {
      throw new Error('Callback confirmation insertion failed.');
    }
    return mapCallbackConfirmation(inserted.rows[0]);
  });
}

export interface CallbackConfirmationReference {
  confirmationId: string;
  expiresAtMs: number;
}

export async function findCallbackConfirmation(
  db: DatabasePool,
  browserDigest: string,
  nowMs: number
): Promise<CallbackConfirmationReference | null> {
  const result = await db.query<{
    confirmation_id: string;
    expires_at_ms: string;
  }>(
    `SELECT confirmation_id, expires_at_ms
     FROM callback_confirmations
     WHERE browser_digest = $1
       AND protocol_version = 1
       AND consumed_at_ms IS NULL
       AND expires_at_ms >= $2`,
    [browserDigest, nowMs]
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        confirmationId: row.confirmation_id,
        expiresAtMs: parseCanonicalPgBigInt(
          row.expires_at_ms,
          'callback_confirmations.expires_at_ms'
        )
      };
}

export async function consumeCallbackConfirmation(
  db: DatabasePool,
  confirmationId: string,
  browserDigest: string,
  expiresAtMs: number,
  nowMs: number
): Promise<CallbackConfirmation | null> {
  const result = await db.query<CallbackConfirmationRow>(
    `DELETE FROM callback_confirmations
     WHERE confirmation_id = $1
       AND browser_digest = $2
       AND protocol_version = 1
       AND expires_at_ms = $3
       AND expires_at_ms >= $4
       AND consumed_at_ms IS NULL
     RETURNING *`,
    [confirmationId, browserDigest, expiresAtMs, nowMs]
  );
  return result.rows[0] === undefined ? null : mapCallbackConfirmation(result.rows[0]);
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

const REFRESH_LEASE_DURATION_MS = 30_000;

export async function createCredential(db: DatabasePool, credential: CredentialInput): Promise<void> {
  await db.query(
    `INSERT INTO credentials (
       public_id, pairing_digest, pairing_key_id, spotify_client_id,
       refresh_token_ciphertext, refresh_token_nonce, refresh_token_key_id,
       access_token_ciphertext, access_token_nonce, access_token_key_id,
       access_token_expires_at_ms, refresh_authorized_at_ms, created_at_ms, updated_at_ms
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [
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
      credential.nowMs
    ]
  );
}

export async function getCredentialByPublicId(
  db: DatabasePool,
  publicId: string
): Promise<Credential | null> {
  const result = await db.query<CredentialRow>(
    'SELECT * FROM credentials WHERE public_id = $1',
    [publicId]
  );
  return result.rows[0] === undefined ? null : mapCredential(result.rows[0]);
}

export async function findActiveCredentialByPairingToken(
  db: DatabasePool,
  token: string,
  pairingKeyring: SecretKeyring
): Promise<Credential | null> {
  const credential = await findCredentialByPairingToken(db, token, pairingKeyring);
  return credential?.authStatus === 'active' ? credential : null;
}

export async function findCredentialByPairingToken(
  db: DatabasePool,
  token: string,
  pairingKeyring: SecretKeyring
): Promise<Credential | null> {
  const parsed = parsePairingToken(token);
  if (parsed === null) return null;
  const row = await getCredentialByPublicId(db, parsed.publicId);
  if (row === null) return null;
  const key = Object.hasOwn(pairingKeyring, row.pairingKeyId)
    ? pairingKeyring[row.pairingKeyId]
    : undefined;
  if (
    key === undefined ||
    !(await verifyPairingDigest(parsed.publicId, parsed.secret, row.pairingDigest, key))
  ) {
    return null;
  }
  return row;
}

export async function reauthorizeCredential(
  db: DatabasePool,
  credential: ReauthorizeCredentialInput
): Promise<boolean> {
  const result = await db.query(
    `UPDATE credentials SET
       refresh_token_ciphertext = $1, refresh_token_nonce = $2, refresh_token_key_id = $3,
       access_token_ciphertext = $4, access_token_nonce = $5, access_token_key_id = $6,
       access_token_expires_at_ms = $7, refresh_authorized_at_ms = $8,
       token_version = token_version + 1, refresh_lease_id = NULL,
       refresh_lease_until_ms = NULL, auth_status = 'active', updated_at_ms = $9
     WHERE public_id = $10 AND spotify_client_id = $11`,
    [
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
    ]
  );
  return result.rowCount === 1;
}

export async function markCredentialReauthorizationRequired(
  db: DatabasePool,
  publicId: string,
  tokenVersion: number,
  nowMs: number
): Promise<boolean> {
  const result = await db.query(
    `UPDATE credentials SET
       auth_status = 'reauth_required',
       refresh_token_ciphertext = NULL, refresh_token_nonce = NULL, refresh_token_key_id = NULL,
       access_token_ciphertext = NULL, access_token_nonce = NULL, access_token_key_id = NULL,
       access_token_expires_at_ms = NULL, token_version = token_version + 1,
       refresh_lease_id = NULL, refresh_lease_until_ms = NULL, updated_at_ms = $1
     WHERE public_id = $2 AND auth_status = 'active' AND token_version = $3`,
    [nowMs, publicId, tokenVersion]
  );
  return result.rowCount === 1;
}

export async function acquireRefreshLease(
  db: DatabasePool,
  publicId: string,
  expectedTokenVersion: number,
  leaseId: string,
  nowMs: number
): Promise<RefreshLease | null> {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    nowMs > Number.MAX_SAFE_INTEGER - REFRESH_LEASE_DURATION_MS
  ) {
    throw new Error('Invalid refresh lease timestamp.');
  }
  const leaseUntilMs = nowMs + REFRESH_LEASE_DURATION_MS;
  const result = await db.query<{ token_version: string }>(
    `UPDATE credentials
     SET refresh_lease_id = $1, refresh_lease_until_ms = $2, updated_at_ms = $3
     WHERE public_id = $4
       AND auth_status = 'active'
       AND token_version = $5
       AND (refresh_lease_id IS NULL OR refresh_lease_until_ms <= $3)
     RETURNING token_version`,
    [leaseId, leaseUntilMs, nowMs, publicId, expectedTokenVersion]
  );
  if (result.rows[0] === undefined) return null;
  return {
    leaseId,
    leaseUntilMs,
    tokenVersion: parseCanonicalPgBigInt(result.rows[0].token_version, 'credentials.token_version')
  };
}

export async function completeRefreshLease(
  db: DatabasePool,
  completion: CompleteRefreshLeaseInput
): Promise<boolean> {
  const result = await db.query(
    `UPDATE credentials SET
       access_token_ciphertext = $1, access_token_nonce = $2, access_token_key_id = $3,
       access_token_expires_at_ms = $4,
       refresh_token_ciphertext = COALESCE($5, refresh_token_ciphertext),
       refresh_token_nonce = COALESCE($6, refresh_token_nonce),
       refresh_token_key_id = COALESCE($7, refresh_token_key_id),
       token_version = token_version + 1, refresh_lease_id = NULL,
       refresh_lease_until_ms = NULL, updated_at_ms = $8
     WHERE public_id = $9 AND auth_status = 'active' AND refresh_lease_id = $10
       AND token_version = $11 AND refresh_lease_until_ms >= $8`,
    [
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
      completion.tokenVersion
    ]
  );
  return result.rowCount === 1;
}

export async function releaseRefreshLease(
  db: DatabasePool,
  publicId: string,
  leaseId: string,
  tokenVersion: number,
  nowMs: number
): Promise<boolean> {
  const result = await db.query(
    `UPDATE credentials SET refresh_lease_id = NULL, refresh_lease_until_ms = NULL,
       updated_at_ms = $1
     WHERE public_id = $2 AND refresh_lease_id = $3 AND token_version = $4`,
    [nowMs, publicId, leaseId, tokenVersion]
  );
  return result.rowCount === 1;
}

export async function invalidateAccessToken(
  db: DatabasePool,
  publicId: string,
  tokenVersion: number,
  nowMs: number
): Promise<boolean> {
  const result = await db.query(
    `UPDATE credentials SET access_token_expires_at_ms = 0, updated_at_ms = $1
     WHERE public_id = $2 AND auth_status = 'active' AND token_version = $3`,
    [nowMs, publicId, tokenVersion]
  );
  return result.rowCount === 1;
}

export async function failRefreshLeaseAsReauthorizationRequired(
  db: DatabasePool,
  publicId: string,
  leaseId: string,
  tokenVersion: number,
  nowMs: number
): Promise<boolean> {
  const result = await db.query(
    `UPDATE credentials SET
       auth_status = 'reauth_required',
       refresh_token_ciphertext = NULL, refresh_token_nonce = NULL, refresh_token_key_id = NULL,
       access_token_ciphertext = NULL, access_token_nonce = NULL, access_token_key_id = NULL,
       access_token_expires_at_ms = NULL, refresh_lease_id = NULL,
       refresh_lease_until_ms = NULL, token_version = token_version + 1, updated_at_ms = $1
     WHERE public_id = $2 AND auth_status = 'active' AND refresh_lease_id = $3
       AND token_version = $4`,
    [nowMs, publicId, leaseId, tokenVersion]
  );
  return result.rowCount === 1;
}

export async function getSpotifyBackoff(
  db: DatabasePool,
  spotifyClientId: string
): Promise<SpotifyBackoff | null> {
  const result = await db.query<{ retry_until_ms: string; updated_at_ms: string }>(
    `SELECT retry_until_ms, updated_at_ms FROM spotify_backoff WHERE spotify_client_id = $1`,
    [spotifyClientId]
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        retryUntilMs: parseCanonicalPgBigInt(row.retry_until_ms, 'spotify_backoff.retry_until_ms'),
        updatedAtMs: parseCanonicalPgBigInt(row.updated_at_ms, 'spotify_backoff.updated_at_ms')
      };
}

export async function upsertSpotifyBackoff(
  db: DatabasePool,
  spotifyClientId: string,
  retryUntilMs: number,
  nowMs: number
): Promise<void> {
  await db.query(
    `INSERT INTO spotify_backoff (spotify_client_id, retry_until_ms, updated_at_ms)
     VALUES ($1, $2, $3)
     ON CONFLICT (spotify_client_id) DO UPDATE SET
       retry_until_ms = GREATEST(spotify_backoff.retry_until_ms, EXCLUDED.retry_until_ms),
       updated_at_ms = EXCLUDED.updated_at_ms`,
    [spotifyClientId, retryUntilMs, nowMs]
  );
}

export async function writeDeletionTombstone(
  deletionDb: DatabasePool,
  publicId: string,
  deletedAtMs: number
): Promise<void> {
  const retentionMs = 35 * 24 * 60 * 60 * 1000;
  if (
    !Number.isSafeInteger(deletedAtMs) ||
    deletedAtMs < 0 ||
    deletedAtMs > Number.MAX_SAFE_INTEGER - retentionMs
  ) {
    throw new Error('Invalid deletion timestamp.');
  }
  const expiresAtMs = deletedAtMs + retentionMs;
  await deletionDb.query(
    `INSERT INTO deletion_tombstones (
       public_id, deleted_at_ms, expires_at_ms, reconciled_at_ms
     ) VALUES ($1, $2, $3, NULL)
     ON CONFLICT (public_id) DO NOTHING`,
    [publicId, deletedAtMs, expiresAtMs]
  );
}

export async function markDeletionTombstoneReconciled(
  deletionDb: DatabasePool,
  publicId: string,
  reconciledAtMs: number
): Promise<void> {
  await deletionDb.query(
    `UPDATE deletion_tombstones
     SET reconciled_at_ms = COALESCE(reconciled_at_ms, $1),
         last_attempt_at_ms = COALESCE(last_attempt_at_ms, $1)
     WHERE public_id = $2`,
    [reconciledAtMs, publicId]
  );
}

export async function isDeletionTombstoned(
  deletionDb: DatabasePool,
  publicId: string
): Promise<boolean> {
  const result = await deletionDb.query<{ tombstoned: boolean }>(
    'SELECT TRUE AS tombstoned FROM deletion_tombstones WHERE public_id = $1',
    [publicId]
  );
  return result.rows[0]?.tombstoned === true;
}

async function deleteCredentialData(db: DatabasePool, publicId: string): Promise<void> {
  await transaction(db, async (client) => {
    await client.query(
      `DELETE FROM spotify_backoff
       WHERE spotify_client_id IN (
         SELECT spotify_client_id FROM credentials WHERE public_id = $1
       ) AND NOT EXISTS (
         SELECT 1 FROM credentials AS other
         WHERE other.spotify_client_id = spotify_backoff.spotify_client_id
           AND other.public_id <> $1
       )`,
      [publicId]
    );
    await client.query('DELETE FROM oauth_sessions WHERE credential_public_id = $1', [publicId]);
    await client.query('DELETE FROM credentials WHERE public_id = $1', [publicId]);
  });
}

export interface DeleteCredentialWithTombstoneInput {
  publicId: string;
  deletedAtMs: number;
}

export async function deleteCredentialWithTombstone(
  db: DatabasePool,
  deletionDb: DatabasePool,
  input: DeleteCredentialWithTombstoneInput,
  now: () => number = Date.now
): Promise<void> {
  await writeDeletionTombstone(deletionDb, input.publicId, input.deletedAtMs);
  await deleteCredentialData(db, input.publicId);
  const reconciledAtMs = now();
  if (!Number.isSafeInteger(reconciledAtMs) || reconciledAtMs < input.deletedAtMs) {
    throw new Error('Invalid reconciliation timestamp.');
  }
  await markDeletionTombstoneReconciled(deletionDb, input.publicId, reconciledAtMs);
}

export async function readCredentialSecrets(
  db: DatabasePool,
  credential: Credential,
  keyring: SecretKeyring,
  activeKeyId: string,
  nowMs: number
): Promise<{ refreshToken: string; accessToken: string | null }> {
  if (credential.refreshToken === null) throw new Error('Spotify authorization is required.');
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
    await db.query(
      `UPDATE credentials SET
         refresh_token_ciphertext = $1, refresh_token_nonce = $2, refresh_token_key_id = $3,
         access_token_ciphertext = $4, access_token_nonce = $5, access_token_key_id = $6,
         updated_at_ms = $7
       WHERE public_id = $8 AND token_version = $9`,
      [
        refresh.ciphertext,
        refresh.nonce,
        refresh.keyId,
        access?.ciphertext ?? null,
        access?.nonce ?? null,
        access?.keyId ?? null,
        nowMs,
        credential.publicId,
        credential.tokenVersion
      ]
    );
  }
  return { refreshToken, accessToken };
}

interface SetupSessionRow extends Record<string, unknown> {
  session_id: string;
  browser_digest: string;
  issuer_digest: string;
  privacy_version: string;
  eula_version: string;
  created_at_ms: string;
  expires_at_ms: string;
}

interface OAuthSessionRow extends Record<string, unknown> {
  state_digest: string;
  browser_digest: string;
  spotify_client_id: string;
  credential_public_id: string | null;
  code_verifier_ciphertext: string;
  code_verifier_nonce: string;
  encryption_key_id: string;
  created_at_ms: string;
  expires_at_ms: string;
  consumed_at_ms: string | null;
}

interface CallbackConfirmationRow extends Record<string, unknown> {
  confirmation_id: string;
  browser_digest: string;
  spotify_client_id: string;
  authorization_code_ciphertext: string;
  authorization_code_nonce: string;
  authorization_code_key_id: string;
  code_verifier_ciphertext: string;
  code_verifier_nonce: string;
  code_verifier_key_id: string;
  created_at_ms: string;
  expires_at_ms: string;
}

interface CredentialRow extends Record<string, unknown> {
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
  access_token_expires_at_ms: string | null;
  refresh_authorized_at_ms: string;
  token_version: string;
  refresh_lease_id: string | null;
  refresh_lease_until_ms: string | null;
  auth_status: 'active' | 'reauth_required';
  created_at_ms: string;
  updated_at_ms: string;
  last_used_at_ms: string | null;
}

function mapSetupSession(row: SetupSessionRow): SetupSession {
  return {
    sessionId: row.session_id,
    browserDigest: row.browser_digest,
    issuerDigest: row.issuer_digest,
    privacyVersion: row.privacy_version,
    eulaVersion: row.eula_version,
    createdAtMs: parseCanonicalPgBigInt(row.created_at_ms, 'setup_sessions.created_at_ms'),
    expiresAtMs: parseCanonicalPgBigInt(row.expires_at_ms, 'setup_sessions.expires_at_ms')
  };
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
    createdAtMs: parseCanonicalPgBigInt(row.created_at_ms, 'oauth_sessions.created_at_ms'),
    expiresAtMs: parseCanonicalPgBigInt(row.expires_at_ms, 'oauth_sessions.expires_at_ms'),
    consumedAtMs: nullableBigInt(row.consumed_at_ms, 'oauth_sessions.consumed_at_ms')
  };
}

function mapCallbackConfirmation(row: CallbackConfirmationRow): CallbackConfirmation {
  return {
    confirmationId: row.confirmation_id,
    browserDigest: row.browser_digest,
    spotifyClientId: row.spotify_client_id,
    authorizationCode: {
      ciphertext: row.authorization_code_ciphertext,
      nonce: row.authorization_code_nonce,
      keyId: row.authorization_code_key_id
    },
    codeVerifier: {
      ciphertext: row.code_verifier_ciphertext,
      nonce: row.code_verifier_nonce,
      keyId: row.code_verifier_key_id
    },
    createdAtMs: parseCanonicalPgBigInt(
      row.created_at_ms,
      'callback_confirmations.created_at_ms'
    ),
    expiresAtMs: parseCanonicalPgBigInt(
      row.expires_at_ms,
      'callback_confirmations.expires_at_ms'
    )
  };
}

function mapCredential(row: CredentialRow): Credential {
  return {
    publicId: row.public_id,
    pairingDigest: row.pairing_digest,
    pairingKeyId: row.pairing_key_id,
    spotifyClientId: row.spotify_client_id,
    refreshToken: encryptedOrNull(
      row.refresh_token_ciphertext,
      row.refresh_token_nonce,
      row.refresh_token_key_id
    ),
    accessToken: encryptedOrNull(
      row.access_token_ciphertext,
      row.access_token_nonce,
      row.access_token_key_id
    ),
    accessTokenExpiresAtMs: nullableBigInt(
      row.access_token_expires_at_ms,
      'credentials.access_token_expires_at_ms'
    ),
    refreshAuthorizedAtMs: parseCanonicalPgBigInt(
      row.refresh_authorized_at_ms,
      'credentials.refresh_authorized_at_ms'
    ),
    tokenVersion: parseCanonicalPgBigInt(
      row.token_version,
      'credentials.token_version'
    ),
    refreshLeaseId: row.refresh_lease_id,
    refreshLeaseUntilMs: nullableBigInt(
      row.refresh_lease_until_ms,
      'credentials.refresh_lease_until_ms'
    ),
    authStatus: row.auth_status,
    createdAtMs: parseCanonicalPgBigInt(row.created_at_ms, 'credentials.created_at_ms'),
    updatedAtMs: parseCanonicalPgBigInt(row.updated_at_ms, 'credentials.updated_at_ms'),
    lastUsedAtMs: nullableBigInt(row.last_used_at_ms, 'credentials.last_used_at_ms')
  };
}

function encryptedOrNull(
  ciphertext: string | null,
  nonce: string | null,
  keyId: string | null
): EncryptedSecret | null {
  if (ciphertext === null && nonce === null && keyId === null) return null;
  if (ciphertext === null || nonce === null || keyId === null) {
    throw new Error('Invalid partial encrypted secret in database.');
  }
  return { ciphertext, nonce, keyId };
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
