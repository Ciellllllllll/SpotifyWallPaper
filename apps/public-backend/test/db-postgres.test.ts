import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  acquireRefreshLease,
  consumeOAuthSession,
  createDatabasePools,
  createSetupSession,
  deleteCredentialWithTombstone,
  failRefreshLeaseAsReauthorizationRequired,
  findCallbackConfirmation,
  moveOAuthSessionToConfirmation,
  parseCanonicalPgBigInt,
  setupAdvisoryLockKeys,
  type DatabasePool,
  type DatabasePoolConstructor,
  type DatabaseQueryResult
} from '../src/db';

type ScriptStep =
  | DatabaseQueryResult<Record<string, unknown>>
  | Error
  | ((text: string, values: readonly unknown[]) => DatabaseQueryResult<Record<string, unknown>>);

class ScriptedClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  released = false;
  releaseArgument: Error | boolean | undefined;

  constructor(private readonly steps: ScriptStep[]) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<DatabaseQueryResult<Row>> {
    this.calls.push({ text, values });
    const step = this.steps.shift();
    if (step === undefined) {
      throw new Error(`Unexpected query: ${text}`);
    }
    if (step instanceof Error) {
      throw step;
    }
    return (typeof step === 'function' ? step(text, values) : step) as DatabaseQueryResult<Row>;
  }

  release(error?: Error | boolean): void {
    this.released = true;
    this.releaseArgument = error;
  }
}

const ID_A = 'A'.repeat(22);
const ID_B = 'B'.repeat(22);
const DIGEST_A = 'A'.repeat(43);
const DIGEST_B = 'B'.repeat(43);
const NONCE_A = 'A'.repeat(16);

class ScriptedPool implements DatabasePool {
  readonly directCalls: Array<{ text: string; values: readonly unknown[] }> = [];

  constructor(readonly client: ScriptedClient, private readonly directSteps: ScriptStep[] = []) {}

  async connect(): Promise<ScriptedClient> {
    return this.client;
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<DatabaseQueryResult<Row>> {
    this.directCalls.push({ text, values });
    const step = this.directSteps.shift();
    if (step === undefined) {
      throw new Error(`Unexpected direct query: ${text}`);
    }
    if (step instanceof Error) {
      throw step;
    }
    return (typeof step === 'function' ? step(text, values) : step) as DatabaseQueryResult<Row>;
  }
}

function result(
  rows: Array<Record<string, unknown>> = [],
  rowCount = rows.length
): DatabaseQueryResult<Record<string, unknown>> {
  return { rows, rowCount };
}

describe('PostgreSQL adapter invariants', () => {
  it('accepts only canonical nonnegative BIGINT strings within both limits', () => {
    expect(parseCanonicalPgBigInt('0', 'created_at_ms')).toBe(0);
    expect(parseCanonicalPgBigInt('42', 'attempts', 42)).toBe(42);
    expect(() => parseCanonicalPgBigInt('43', 'attempts', 42)).toThrow('attempts');

    for (const invalid of [0, '-1', '+1', '01', ' 1', '1 ', '9007199254740992']) {
      expect(() => parseCanonicalPgBigInt(invalid, 'created_at_ms')).toThrow(
        'created_at_ms'
      );
    }
  });

  it('forces both pools to max two connections even when callers request another value', async () => {
    const configs: Array<Record<string, unknown>> = [];
    class FakePool {
      constructor(config: Record<string, unknown>) {
        configs.push(config);
      }
    }

    await createDatabasePools(
      {
        primary: { database: 'primary', max: 99 },
        deletion: { database: 'deletion', max: 1 }
      },
      FakePool as unknown as DatabasePoolConstructor
    );

    expect(configs).toEqual([
      { database: 'primary', max: 2 },
      { database: 'deletion', max: 2 }
    ]);
  });

  it('derives two signed advisory-lock keys from the first eight digest bytes', () => {
    expect(
      setupAdvisoryLockKeys('gAAAAH____8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    ).toEqual([-2147483648, 2147483647]);
  });

  it('retires the old setup Cookie and enforces the same-issuer cap on one client', async () => {
    const client = new ScriptedClient([
      result(),
      result(),
      result([], 1),
      result([{ live_count: '2' }]),
      result([], 1),
      result()
    ]);
    const pool = new ScriptedPool(client);

    const created = await createSetupSession(pool, {
      sessionId: ID_A,
      browserDigest: DIGEST_A,
      issuerDigest: 'gAAAAH____8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      previousBrowserDigest: DIGEST_B,
      privacyVersion: '2026-08-31',
      eulaVersion: '2026-08-31',
      createdAtMs: 1_000,
      expiresAtMs: 2_000
    });

    expect(created).toBe(true);
    expect(client.calls.map(({ text }) => text.trim().split(/\s+/u)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'UPDATE',
      'SELECT',
      'INSERT',
      'COMMIT'
    ]);
    expect(client.calls[1].text).toContain('pg_advisory_xact_lock');
    expect(client.calls[2].values).toEqual([1_000, DIGEST_B]);
    expect(client.released).toBe(true);
  });

  it('does not insert a fourth live setup session for one issuer', async () => {
    const client = new ScriptedClient([
      result(),
      result(),
      result([{ live_count: '3' }]),
      result()
    ]);
    const pool = new ScriptedPool(client);

    await expect(
      createSetupSession(pool, {
        sessionId: ID_A,
        browserDigest: DIGEST_A,
        issuerDigest: 'gAAAAH____8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        previousBrowserDigest: null,
        privacyVersion: '2026-08-31',
        eulaVersion: '2026-08-31',
        createdAtMs: 1_000,
        expiresAtMs: 2_000
      })
    ).resolves.toBe(false);

    expect(client.calls.some(({ text }) => text.includes('INSERT INTO setup_sessions'))).toBe(false);
    expect(client.calls.at(-1)?.text).toBe('COMMIT');
  });

  it('rolls back the atomic OAuth-to-confirmation transition when re-encryption fails', async () => {
    const client = new ScriptedClient([
      result(),
      result([
        {
          state_digest: DIGEST_A,
          browser_digest: DIGEST_B,
          spotify_client_id: 'spotify-client',
          credential_public_id: null,
          code_verifier_ciphertext: 'ciphertext',
          code_verifier_nonce: NONCE_A,
          encryption_key_id: 'key',
          created_at_ms: '1000',
          expires_at_ms: '2000',
          consumed_at_ms: null
        }
      ]),
      result()
    ]);
    const pool = new ScriptedPool(client);

    await expect(
      moveOAuthSessionToConfirmation(
        pool,
        {
          stateDigest: DIGEST_A,
          confirmationId: ID_A,
          browserDigest: DIGEST_B,
          createdAtMs: 1_100,
          expiresAtMs: 1_400
        },
        async () => {
          throw new Error('encryption failed');
        }
      )
    ).rejects.toThrow('encryption failed');

    expect(client.calls.map(({ text }) => text.trim())).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM oauth_sessions'),
      'ROLLBACK'
    ]);
    expect(client.released).toBe(true);
  });

  it('encrypts both pending secrets from the consumed row and exact confirmation ID', async () => {
    const encryptedCode = { ciphertext: 'encrypted-code', nonce: NONCE_A, keyId: 'key' };
    const encryptedVerifier = {
      ciphertext: 'encrypted-verifier',
      nonce: NONCE_A,
      keyId: 'key'
    };
    const client = new ScriptedClient([
      result(),
      result([
        {
          state_digest: DIGEST_A,
          browser_digest: DIGEST_B,
          spotify_client_id: 'spotify-client',
          credential_public_id: null,
          code_verifier_ciphertext: 'source-verifier',
          code_verifier_nonce: NONCE_A,
          encryption_key_id: 'old-key',
          created_at_ms: '1000',
          expires_at_ms: '2000',
          consumed_at_ms: null
        }
      ]),
      result([
        {
          confirmation_id: ID_A,
          browser_digest: DIGEST_B,
          spotify_client_id: 'spotify-client',
          authorization_code_ciphertext: encryptedCode.ciphertext,
          authorization_code_nonce: encryptedCode.nonce,
          authorization_code_key_id: encryptedCode.keyId,
          code_verifier_ciphertext: encryptedVerifier.ciphertext,
          code_verifier_nonce: encryptedVerifier.nonce,
          code_verifier_key_id: encryptedVerifier.keyId,
          created_at_ms: '1100',
          expires_at_ms: '1400'
        }
      ]),
      result()
    ]);
    const pool = new ScriptedPool(client);

    await moveOAuthSessionToConfirmation(
      pool,
      {
        stateDigest: DIGEST_A,
        confirmationId: ID_A,
        browserDigest: DIGEST_B,
        createdAtMs: 1_100,
        expiresAtMs: 1_400
      },
      async (session, confirmationId) => {
        expect(session.spotifyClientId).toBe('spotify-client');
        expect(session.codeVerifier.ciphertext).toBe('source-verifier');
        expect(confirmationId).toBe(ID_A);
        return { authorizationCode: encryptedCode, codeVerifier: encryptedVerifier };
      }
    );

    expect(client.calls[2].values).toEqual([
      ID_A,
      DIGEST_B,
      'spotify-client',
      encryptedCode.ciphertext,
      encryptedCode.nonce,
      encryptedCode.keyId,
      encryptedVerifier.ciphertext,
      encryptedVerifier.nonce,
      encryptedVerifier.keyId,
      1_100,
      1_400
    ]);
    expect(client.calls.at(-1)?.text).toBe('COMMIT');
  });

  it('reads a pending confirmation for GET without consuming it', async () => {
    const pool = new ScriptedPool(new ScriptedClient([]), [
      result([{ confirmation_id: ID_A, expires_at_ms: '1400' }])
    ]);

    await expect(findCallbackConfirmation(pool, DIGEST_B, 1_100)).resolves.toEqual({
      confirmationId: ID_A,
      expiresAtMs: 1_400
    });
    expect(pool.directCalls[0].text.trim()).toMatch(/^SELECT/u);
    expect(pool.directCalls[0].text).not.toContain('DELETE');
  });

  it('discards a checked-out client when rollback itself fails', async () => {
    const rollbackFailure = new Error('rollback failed');
    const client = new ScriptedClient([
      result(),
      new Error('operation failed'),
      rollbackFailure
    ]);
    const primary = new ScriptedPool(client);

    await expect(
      deleteCredentialWithTombstone(
        primary,
        new ScriptedPool(new ScriptedClient([]), [result([], 1)]),
        { publicId: ID_A, deletedAtMs: 10 }
      )
    ).rejects.toThrow('operation failed');
    expect(client.releaseArgument).toBe(rollbackFailure);
  });

  it('never consumes an OAuth session through a Cookie-less fallback predicate', async () => {
    const pool = new ScriptedPool(new ScriptedClient([]), [result()]);

    await expect(consumeOAuthSession(pool, DIGEST_A, DIGEST_B, 1_000)).resolves.toBeNull();

    expect(pool.directCalls[0].text).toContain('browser_digest = $2');
    expect(pool.directCalls[0].text).not.toContain('credential_public_id IS NULL');
    expect(pool.directCalls[0].values).toEqual([DIGEST_A, DIGEST_B, 1_000]);
  });

  it('commits the deletion ledger before opening the primary delete transaction', async () => {
    const order: string[] = [];
    const deletionClient = new ScriptedClient([]);
    const deletion = new ScriptedPool(deletionClient, [
      (text, values) => {
        order.push(text.includes('deletion_tombstones') ? 'ledger' : 'unexpected');
        expect(values).toEqual([ID_A, 10, 3_024_000_010]);
        expect(text).toContain('DO NOTHING');
        expect(text).not.toContain('DO UPDATE');
        return result([], 1);
      },
      (text) => {
        order.push(text.trim().startsWith('UPDATE deletion_tombstones') ? 'reconciled' : 'unexpected');
        expect(text).toContain('COALESCE(reconciled_at_ms, $1)');
        expect(deletion.directCalls[1].values).toEqual([20, ID_A]);
        return result([], 1);
      }
    ]);
    const primaryClient = new ScriptedClient([
      (text) => {
        order.push(text.trim());
        return result();
      },
      result([], 0),
      result([], 0),
      result([], 1),
      (text) => {
        order.push(text.trim());
        return result();
      }
    ]);
    const primary = new ScriptedPool(primaryClient);

    await deleteCredentialWithTombstone(
      primary,
      deletion,
      { publicId: ID_A, deletedAtMs: 10 },
      () => 20
    );

    expect(order).toEqual(['ledger', 'BEGIN', 'COMMIT', 'reconciled']);
  });

  it('leaves the durable tombstone pending when the primary deletion rolls back', async () => {
    const deletion = new ScriptedPool(new ScriptedClient([]), [result([], 1)]);
    const primaryClient = new ScriptedClient([result(), new Error('primary unavailable'), result()]);
    const primary = new ScriptedPool(primaryClient);
    let clockCalls = 0;

    await expect(
      deleteCredentialWithTombstone(
        primary,
        deletion,
        { publicId: ID_A, deletedAtMs: 10 },
        () => {
          clockCalls += 1;
          return 20;
        }
      )
    ).rejects.toThrow('primary unavailable');

    expect(clockCalls).toBe(0);
    expect(deletion.directCalls).toHaveLength(1);
    expect(primaryClient.calls.at(-1)?.text).toBe('ROLLBACK');
  });

  it('parses refresh token versions through the canonical BIGINT adapter', async () => {
    const pool = new ScriptedPool(new ScriptedClient([]), [
      result([{ token_version: '7' }])
    ]);
    await expect(acquireRefreshLease(pool, ID_A, 7, ID_B, 100)).resolves.toEqual({
      leaseId: ID_B,
      leaseUntilMs: 30_100,
      tokenVersion: 7
    });
    expect(pool.directCalls[0].values).toEqual([ID_B, 30_100, 100, ID_A, 7]);

    const unsafePool = new ScriptedPool(new ScriptedClient([]), [
      result([{ token_version: '9007199254740992' }])
    ]);
    await expect(
      acquireRefreshLease(unsafePool, ID_A, 7, ID_B, 100)
    ).rejects.toThrow('credentials.token_version');
  });

  it('lets the current lease owner apply invalid_grant after expiry but rejects replacement owners', async () => {
    const pool = new ScriptedPool(new ScriptedClient([]), [result([], 1)]);

    await expect(
      failRefreshLeaseAsReauthorizationRequired(pool, ID_A, ID_B, 7, 99_000)
    ).resolves.toBe(true);

    expect(pool.directCalls[0].text).toContain('refresh_lease_id = $3');
    expect(pool.directCalls[0].text).toContain('token_version = $4');
    expect(pool.directCalls[0].text).not.toContain('refresh_lease_until_ms >=');
    expect(pool.directCalls[0].values).toEqual([99_000, ID_A, ID_B, 7]);
  });

  it('keeps primary and deletion migrations separate, locked, and BIGINT-only', () => {
    const primary = readFileSync(
      fileURLToPath(new URL('../migrations/0001_initial.sql', import.meta.url).href),
      'utf8'
    );
    const deletion = readFileSync(
      fileURLToPath(
        new URL('../migrations/deletion-ledger/0001_initial.sql', import.meta.url).href
      ),
      'utf8'
    );

    expect(primary).toContain('pg_advisory_xact_lock');
    expect(primary).toContain('CREATE TABLE schema_migrations');
    expect(primary).toContain('CREATE TABLE setup_sessions');
    expect(primary).toContain('CREATE TABLE callback_confirmations');
    expect(primary).toContain("session_id ~ '^[A-Za-z0-9_-]{22}$'");
    expect(primary).toContain("confirmation_id ~ '^[A-Za-z0-9_-]{22}$'");
    expect(primary).toContain('access_token_expires_at_ms IS NOT NULL');
    expect(primary).toContain('length(refresh_token_ciphertext) BETWEEN 1 AND 8192');
    expect(primary).toContain("refresh_token_nonce ~ '^[A-Za-z0-9_-]{16}$'");
    expect(primary).toContain("refresh_token_key_id ~ '^[A-Za-z0-9_-]{1,64}$'");
    expect(primary).toContain('length(access_token_ciphertext) BETWEEN 1 AND 8192');
    expect(primary).toContain('BIGINT');
    expect(primary).not.toMatch(/\bINTEGER\b/u);
    expect(deletion).toContain('pg_advisory_xact_lock');
    expect(deletion).toContain('CREATE TABLE schema_migrations');
    expect(deletion).toContain('CREATE TABLE deletion_tombstones');
    expect(deletion).toContain('expires_at_ms = deleted_at_ms + 3024000000');
    expect(deletion).toContain('BIGINT');
    expect(deletion).not.toContain('credentials');
    expect(deletion).not.toMatch(/\bINTEGER\b/u);
  });
});
