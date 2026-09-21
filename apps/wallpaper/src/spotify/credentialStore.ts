import { shouldRefreshToken } from './token';
import type { SpotifyCredentials, SpotifyResult, SpotifyTokenState } from './types';

export interface DirectAuthorization extends SpotifyCredentials {
  authorizationId?: string;
  authorizedAtMs?: number;
}
export interface CredentialRecord extends DirectAuthorization {
  id: string;
  revision: number;
  token?: SpotifyTokenState;
  lease?: { id: string; until: number };
  cooldown?: { until: number; failures: number; error: Extract<SpotifyResult<never>, { ok: false }>['error'] };
}
export interface CredentialData {
  version: 1;
  active: CredentialRecord | null;
  // Non-secret digests prevent stale host properties from resurrecting old authorizations.
  retired: string[];
  importsDisabled?: boolean;
}
export interface CredentialDatabase {
  transaction<T>(edit: (data: CredentialData) => T): Promise<T>;
}
type Claim = { kind: 'claimed'; record: CredentialRecord } | { kind: 'ready'; token: SpotifyTokenState } | { kind: 'cooldown'; error: Extract<SpotifyResult<never>, { ok: false }>['error'] } | { kind: 'busy' } | { kind: 'missing' };
const storageError = () => new Error('Credential storage is unavailable.');
const validSecret = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 16384;
const validAuthorization = (value: DirectAuthorization): boolean =>
  validSecret(value.clientId) && value.clientId.length <= 256 && validSecret(value.refreshToken) &&
  (value.authorizationId === undefined || /^[a-f0-9]{32}$/.test(value.authorizationId)) &&
  (value.authorizedAtMs === undefined || (Number.isSafeInteger(value.authorizedAtMs) && value.authorizedAtMs >= 0));

export class DirectCredentialStore {
  constructor(private readonly database: CredentialDatabase) {}

  private async edit<T>(action: (data: CredentialData) => T): Promise<T> {
    try { return await this.database.transaction(action); } catch { throw storageError(); }
  }

  async import(input: DirectAuthorization): Promise<CredentialRecord | null> {
    if (!validAuthorization(input)) throw new Error('Credential input is invalid.');
    let id: string;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify([input.clientId, input.refreshToken, input.authorizationId ?? null]));
      id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
    } catch { throw storageError(); }
    return this.edit(data => {
      if (data.importsDisabled) throw storageError();
      if (data.retired.includes(id)) return null;
      if (data.active?.id === id) return data.active;
      if (data.retired.length >= 4096) throw storageError();
      retire(data);
      data.active = { ...input, id, revision: 0 };
      return data.active;
    });
  }

  read(): Promise<CredentialRecord | null> { return this.edit(data => data.active); }
  disconnect(): Promise<void> { return this.edit(retire); }

  claim(id: string, now: number, rejectedAccessToken?: string): Promise<Claim> {
    return this.edit(data => {
      const record = data.active;
      if (!record || record.id !== id) return { kind: 'missing' };
      if (record.cooldown && record.cooldown.until > now) return { kind: 'cooldown', error: { ...record.cooldown.error, retryAfterMs: record.cooldown.until - now } };
      if (record.token && record.token.accessToken !== rejectedAccessToken && !shouldRefreshToken(record.token, now)) {
        return { kind: 'ready', token: record.token };
      }
      if (record.lease && record.lease.until > now) return { kind: 'busy' };
      record.lease = { id: crypto.randomUUID(), until: now + 60_000 };
      return { kind: 'claimed', record };
    });
  }

  complete(claim: CredentialRecord, result: SpotifyResult<SpotifyTokenState>, now = Date.now()): Promise<boolean> {
    return this.edit(data => {
      const record = data.active;
      if (!record || record.id !== claim.id || record.revision !== claim.revision || !claim.lease || record.lease?.id !== claim.lease.id) return false;
      if (!result.ok && result.invalidGrant) { retire(data); return true; }
      delete record.lease;
      if (result.ok) {
        delete record.cooldown;
        record.token = result.value;
        if (result.value.refreshToken) record.refreshToken = result.value.refreshToken;
        record.revision += 1;
      } else {
        const failures = Math.min(8, (record.cooldown?.failures ?? 0) + 1);
        const delay = Math.max(result.error.retryAfterMs ?? 0, Math.min(300000, 5000 * 2 ** (failures - 1)) * (1 + Math.random() * 0.2));
        record.cooldown = { until: Math.min(Number.MAX_SAFE_INTEGER, now + Math.ceil(delay)), failures, error: { ...result.error, message: 'Spotify token update is temporarily unavailable.' } };
      }
      return true;
    });
  }
}

const retire = (data: CredentialData): void => {
  if (data.active) {
    // Fail closed rather than forgetting tombstones and accepting stale host input.
    if (data.retired.length >= 4096) data.importsDisabled = true;
    else data.retired.push(data.active.id);
    data.active = null;
  }
};

/** Short atomic read/modify/write transactions only; no network wait inside IndexedDB. */
export const indexedCredentialDatabase = (factory: IDBFactory | (() => IDBFactory)): CredentialDatabase => ({
  transaction<T>(edit: (data: CredentialData) => T): Promise<T> {
    return new Promise((resolve, reject) => {
      let db: IDBDatabase | undefined;
      let transaction: IDBTransaction | undefined;
      let settled = false;
      const finish = (failed: boolean, output?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        db?.close();
        if (failed) reject(storageError()); else resolve(output as T);
      };
      const timeout = setTimeout(() => { transaction?.abort(); finish(true); }, 5000);
      let request: IDBOpenDBRequest;
      try { request = (typeof factory === 'function' ? factory() : factory).open('spotify-wallpaper-direct-credentials', 1); } catch { finish(true); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('credentials');
      request.onerror = request.onblocked = () => finish(true);
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => db?.close();
        try {
          transaction = db.transaction('credentials', 'readwrite');
          const store = transaction.objectStore('credentials');
          let output: T;
          transaction.oncomplete = () => finish(false, output);
          transaction.onerror = transaction.onabort = () => finish(true);
          const read = store.get('current');
          read.onsuccess = () => {
            try {
              const data: unknown = read.result ?? { version: 1, active: null, retired: [] };
              if (!validData(data)) throw storageError();
              output = edit(data);
              store.put(data, 'current');
            } catch { transaction?.abort(); finish(true); }
          };
        } catch { finish(true); }
      };
    });
  }
});

const validData = (value: unknown): value is CredentialData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as CredentialData;
  if (data.importsDisabled !== undefined && typeof data.importsDisabled !== 'boolean') return false;
  if (data.version !== 1 || !Array.isArray(data.retired) || data.retired.length > 4096 || !data.retired.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))) return false;
  const record = data.active;
  if (record === null) return true;
  return !!record && validAuthorization(record) && /^[a-f0-9]{64}$/.test(record.id) && Number.isSafeInteger(record.revision) && record.revision >= 0 &&
    (!record.token || (validSecret(record.token.accessToken) && Number.isFinite(record.token.expiresAtMs) &&
      (record.token.refreshAtMs === undefined || Number.isFinite(record.token.refreshAtMs)))) &&
    (!record.lease || (typeof record.lease.id === 'string' && record.lease.id.length <= 64 && Number.isFinite(record.lease.until))) &&
    (!record.cooldown || (Number.isFinite(record.cooldown.until) && Number.isInteger(record.cooldown.failures) && record.cooldown.failures > 0 && record.cooldown.failures <= 8 &&
      !!record.cooldown.error && ['unauthorized', 'forbidden', 'rate_limited', 'network_error', 'unavailable', 'unknown_response_shape', 'item_null'].includes(record.cooldown.error.kind)));
};
