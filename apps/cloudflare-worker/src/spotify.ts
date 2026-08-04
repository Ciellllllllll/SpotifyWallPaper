import type {
  NormalizedPlayback,
  PlaybackCommand,
  SpotifyPlaybackError
} from '@spotify-wallpaper/shared-types';

import type { ApiResult } from './contracts';
import {
  decryptSecret,
  encryptSecret,
  parseSecretKeyring,
  randomBase64Url
} from './crypto';
import {
  acquireRefreshLease,
  completeRefreshLease,
  failRefreshLeaseAsReauthorizationRequired,
  getCredentialByPublicId,
  getSpotifyBackoff,
  invalidateAccessToken,
  markCredentialReauthorizationRequired,
  readCredentialSecrets,
  releaseRefreshLease,
  upsertSpotifyBackoff,
  type Credential,
  type RefreshLease
} from './db';
import { readBoundedText } from './http';
import {
  recordRefreshMetric,
  type RefreshMetricOutcome
} from './metrics';
import { emptySpotifyPlayback, normalizeSpotifyPlayback } from './normalize';

const playbackEndpoint = 'https://api.spotify.com/v1/me/player';
const tokenEndpoint = 'https://accounts.spotify.com/api/token';
const refreshEarlyMs = 60_000;
const refreshLeaseMs = 30_000;
const refreshLifetimeMs = 180 * 24 * 60 * 60 * 1000;
const maxResponseBytes = 262_144;
const maxRetryAfterMs = 24 * 60 * 60 * 1000;
const spotifyRequestTimeoutMs = 10_000;

export interface SpotifyRequestOptions {
  fetcher?: typeof fetch;
  nowMs?: number;
  requestTimeoutMs?: number;
  refreshTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function fetchSpotifyPlayback(
  accessToken: string,
  fetcher: typeof fetch = fetch,
  fetchedAt = new Date().toISOString(),
  timeoutMs = spotifyRequestTimeoutMs
): Promise<ApiResult<NormalizedPlayback>> {
  let response: Response;
  try {
    response = await fetcher(playbackEndpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return networkError();
  }

  if (response.status === 204) {
    return {
      ok: true,
      value: emptySpotifyPlayback(fetchedAt)
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: classifySpotifyStatus(response)
    };
  }

  const payload = await boundedJson(response);
  return payload.ok
    ? normalizeSpotifyPlayback(payload.value, fetchedAt)
    : payload;
}

export async function sendSpotifyCommand(
  accessToken: string,
  command: PlaybackCommand,
  fetcher: typeof fetch = fetch,
  timeoutMs = spotifyRequestTimeoutMs
): Promise<ApiResult<null>> {
  const request = commandRequest(command);
  let response: Response;
  try {
    response = await fetcher(request.url, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return networkError();
  }
  return response.ok || response.status === 204
    ? { ok: true, value: null }
    : { ok: false, error: classifySpotifyStatus(response) };
}

export async function getCredentialAccessToken(
  db: D1Database,
  initialCredential: Credential,
  env: Env,
  options: SpotifyRequestOptions = {}
): Promise<ApiResult<string>> {
  const nowMs = options.nowMs ?? Date.now();
  if (
    initialCredential.authStatus !== 'active' ||
    initialCredential.refreshAuthorizedAtMs + refreshLifetimeMs <= nowMs
  ) {
    if (initialCredential.authStatus === 'active') {
      await markCredentialReauthorizationRequired(
        db,
        initialCredential.publicId,
        initialCredential.tokenVersion,
        nowMs
      );
    }
    return authorizationRequired();
  }
  const backoff = await activeBackoff(db, initialCredential.spotifyClientId, nowMs);
  if (backoff !== null) {
    return rateLimited(backoff);
  }
  const cached = await cachedAccessToken(initialCredential, env, nowMs);
  if (cached !== null) {
    return cached;
  }
  if (
    initialCredential.authStatus !== 'active' ||
    initialCredential.refreshToken === null
  ) {
    return authorizationRequired();
  }

  const leaseId = randomBase64Url(16);
  const lease = await acquireRefreshLease(
    db,
    initialCredential.publicId,
    initialCredential.tokenVersion,
    leaseId,
    nowMs,
    nowMs + refreshLeaseMs
  );
  if (lease === null) {
    return waitForRefresh(db, initialCredential, env, options, nowMs);
  }
  const leasedCredential = await getCredentialByPublicId(
    db,
    initialCredential.publicId
  );
  if (
    leasedCredential === null ||
    leasedCredential.refreshLeaseId !== lease.leaseId ||
    leasedCredential.tokenVersion !== lease.tokenVersion
  ) {
    await releaseRefreshLease(
      db,
      initialCredential.publicId,
      lease.leaseId,
      lease.tokenVersion,
      nowMs
    );
    return unavailable();
  }
  return refreshAccessToken(db, leasedCredential, lease, env, options, nowMs);
}

export async function fetchCredentialPlayback(
  db: D1Database,
  credential: Credential,
  env: Env,
  options: SpotifyRequestOptions = {}
): Promise<ApiResult<NormalizedPlayback>> {
  const nowMs = options.nowMs ?? Date.now();
  const token = await getCredentialAccessToken(db, credential, env, {
    ...options,
    nowMs
  });
  if (!token.ok) {
    return token;
  }
  let result = await fetchSpotifyPlayback(
    token.value,
    options.fetcher,
    new Date(nowMs).toISOString(),
    options.requestTimeoutMs
  );
  if (!result.ok && result.error.kind === 'unauthorized') {
    result = await retryPlaybackAfterUnauthorized(
      db,
      credential,
      env,
      options,
      nowMs
    );
  }
  if (!result.ok && result.error.kind === 'rate_limited') {
    await persistRateLimit(db, credential.spotifyClientId, result.error, nowMs);
  }
  return result;
}

export async function sendCredentialSpotifyCommand(
  db: D1Database,
  credential: Credential,
  env: Env,
  command: PlaybackCommand,
  options: SpotifyRequestOptions = {}
): Promise<ApiResult<null>> {
  const nowMs = options.nowMs ?? Date.now();
  const token = await getCredentialAccessToken(db, credential, env, {
    ...options,
    nowMs
  });
  if (!token.ok) {
    return token;
  }
  let result = await sendSpotifyCommand(
    token.value,
    command,
    options.fetcher,
    options.requestTimeoutMs
  );
  if (!result.ok && result.error.kind === 'unauthorized') {
    result = await retryCommandAfterUnauthorized(
      db,
      credential,
      env,
      command,
      options,
      nowMs
    );
  }
  if (!result.ok && result.error.kind === 'rate_limited') {
    await persistRateLimit(db, credential.spotifyClientId, result.error, nowMs);
  }
  return result;
}

async function retryPlaybackAfterUnauthorized(
  db: D1Database,
  credential: Credential,
  env: Env,
  options: SpotifyRequestOptions,
  nowMs: number
): Promise<ApiResult<NormalizedPlayback>> {
  await invalidateAccessToken(
    db,
    credential.publicId,
    credential.tokenVersion,
    nowMs
  );
  const reloaded = await getCredentialByPublicId(db, credential.publicId);
  if (reloaded === null) {
    return authorizationRequired();
  }
  const token = await getCredentialAccessToken(db, reloaded, env, {
    ...options,
    nowMs
  });
  return token.ok
    ? fetchSpotifyPlayback(
        token.value,
        options.fetcher,
        new Date(nowMs).toISOString(),
        options.requestTimeoutMs
      )
    : token;
}

async function retryCommandAfterUnauthorized(
  db: D1Database,
  credential: Credential,
  env: Env,
  command: PlaybackCommand,
  options: SpotifyRequestOptions,
  nowMs: number
): Promise<ApiResult<null>> {
  await invalidateAccessToken(
    db,
    credential.publicId,
    credential.tokenVersion,
    nowMs
  );
  const reloaded = await getCredentialByPublicId(db, credential.publicId);
  if (reloaded === null) {
    return authorizationRequired();
  }
  const token = await getCredentialAccessToken(db, reloaded, env, {
    ...options,
    nowMs
  });
  return token.ok
    ? sendSpotifyCommand(
        token.value,
        command,
        options.fetcher,
        options.requestTimeoutMs
      )
    : token;
}

async function refreshAccessToken(
  db: D1Database,
  credential: Credential,
  lease: RefreshLease,
  env: Env,
  options: SpotifyRequestOptions,
  nowMs: number
): Promise<ApiResult<string>> {
  try {
    const result = await runRefreshAccessToken(
      db,
      credential,
      lease,
      env,
      options,
      nowMs
    );
    recordRefreshMetric(env, refreshMetricOutcome(result));
    return result;
  } catch {
    recordRefreshMetric(env, 'failed');
    return unavailable();
  } finally {
    try {
      await releaseRefreshLease(
        db,
        credential.publicId,
        lease.leaseId,
        lease.tokenVersion,
        options.nowMs ?? Date.now()
      );
    } catch {
      // Lease expiry remains the final recovery path if D1 is unavailable.
    }
  }
}

function refreshMetricOutcome(
  result: ApiResult<string>
): RefreshMetricOutcome {
  if (result.ok) {
    return 'success';
  }
  switch (result.error.kind) {
    case 'unauthorized':
      return 'reauthorization_required';
    case 'rate_limited':
      return 'rate_limited';
    case 'network_error':
      return 'network_error';
    default:
      return 'failed';
  }
}

async function runRefreshAccessToken(
  db: D1Database,
  credential: Credential,
  lease: RefreshLease,
  env: Env,
  options: SpotifyRequestOptions,
  nowMs: number
): Promise<ApiResult<string>> {
  const keyring = parseSecretKeyring(env.TOKEN_ENCRYPTION_KEYRING);
  let refreshToken: string;
  try {
    const secrets = await readCredentialSecrets(
      db,
      credential,
      keyring,
      env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
      nowMs
    );
    refreshToken = secrets.refreshToken;
  } catch {
    await releaseRefreshLease(
      db,
      credential.publicId,
      lease.leaseId,
      lease.tokenVersion,
      nowMs
    );
    return unavailable();
  }

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: credential.spotifyClientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(options.refreshTimeoutMs ?? 10_000, 10_000))
      )
    });
  } catch {
    const failedAtMs = options.nowMs ?? Date.now();
    await releaseRefreshLease(
      db,
      credential.publicId,
      lease.leaseId,
      lease.tokenVersion,
      failedAtMs
    );
    return networkError();
  }

  const responseAtMs = options.nowMs ?? Date.now();
  if (response.status === 400 && (await isInvalidGrant(response))) {
    await failRefreshLeaseAsReauthorizationRequired(
      db,
      credential.publicId,
      lease.leaseId,
      lease.tokenVersion,
      responseAtMs
    );
    return authorizationRequired();
  }
  if (response.status === 429) {
    const error = classifySpotifyStatus(response);
    await persistRateLimit(db, credential.spotifyClientId, error, responseAtMs);
    await releaseRefreshLease(
      db,
      credential.publicId,
      lease.leaseId,
      lease.tokenVersion,
      responseAtMs
    );
    return { ok: false, error };
  }
  if (!response.ok) {
    await releaseRefreshLease(
      db,
      credential.publicId,
      lease.leaseId,
      lease.tokenVersion,
      responseAtMs
    );
    return {
      ok: false,
      error: {
        kind: 'unavailable',
        message: 'Spotify token refresh failed.',
        status: response.status
      }
    };
  }

  const parsed = await boundedJson(response);
  if (!parsed.ok || !validRefreshResponse(parsed.value)) {
    await releaseRefreshLease(
      db,
      credential.publicId,
      lease.leaseId,
      lease.tokenVersion,
      responseAtMs
    );
    return unavailable();
  }
  const body = parsed.value as Record<string, unknown>;
  const accessTokenText = body.access_token as string;
  const rotatedRefreshToken =
    typeof body.refresh_token === 'string' ? body.refresh_token : null;
  const [accessToken, encryptedRefreshToken] = await Promise.all([
    encryptSecret(
      accessTokenText,
      {
        recordId: credential.publicId,
        spotifyClientId: credential.spotifyClientId,
        fieldName: 'access_token'
      },
      env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
      keyring
    ),
    rotatedRefreshToken === null
      ? Promise.resolve(null)
      : encryptSecret(
          rotatedRefreshToken,
          {
            recordId: credential.publicId,
            spotifyClientId: credential.spotifyClientId,
            fieldName: 'refresh_token'
          },
          env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
          keyring
        )
  ]);
  const completedAtMs = options.nowMs ?? Date.now();
  const completed = await completeRefreshLease(db, {
    publicId: credential.publicId,
    leaseId: lease.leaseId,
    tokenVersion: lease.tokenVersion,
    accessToken,
    accessTokenExpiresAtMs: completedAtMs + (body.expires_in as number) * 1000,
    refreshToken: encryptedRefreshToken,
    nowMs: completedAtMs
  });
  if (completed) {
    return { ok: true, value: accessTokenText };
  }

  const reloaded = await getCredentialByPublicId(db, credential.publicId);
  return reloaded === null
    ? authorizationRequired()
    : (await cachedAccessToken(reloaded, env, nowMs)) ?? unavailable();
}

async function waitForRefresh(
  db: D1Database,
  initialCredential: Credential,
  env: Env,
  options: SpotifyRequestOptions,
  nowMs: number
): Promise<ApiResult<string>> {
  const sleep = options.sleep ?? ((milliseconds: number) => scheduler.wait(milliseconds));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(15 + randomJitter(10));
    const credential = await getCredentialByPublicId(db, initialCredential.publicId);
    if (credential === null || credential.authStatus !== 'active') {
      return authorizationRequired();
    }
    const backoff = await activeBackoff(db, credential.spotifyClientId, nowMs);
    if (backoff !== null) {
      return rateLimited(backoff);
    }
    const cached = await cachedAccessToken(credential, env, nowMs);
    if (cached !== null) {
      return cached;
    }
    if (credential.refreshLeaseId === null) {
      return unavailable(250);
    }
  }
  return unavailable(250);
}

async function cachedAccessToken(
  credential: Credential,
  env: Env,
  nowMs: number
): Promise<ApiResult<string> | null> {
  if (
    credential.accessToken === null ||
    credential.accessTokenExpiresAtMs === null ||
    credential.accessTokenExpiresAtMs <= nowMs + refreshEarlyMs
  ) {
    return null;
  }
  try {
    const keyring = parseSecretKeyring(env.TOKEN_ENCRYPTION_KEYRING);
    return {
      ok: true,
      value: await decryptSecret(
        credential.accessToken,
        {
          recordId: credential.publicId,
          spotifyClientId: credential.spotifyClientId,
          fieldName: 'access_token'
        },
        keyring
      )
    };
  } catch {
    return unavailable();
  }
}

async function activeBackoff(
  db: D1Database,
  spotifyClientId: string,
  nowMs: number
): Promise<number | null> {
  const backoff = await getSpotifyBackoff(db, spotifyClientId);
  return backoff !== null && backoff.retryUntilMs > nowMs
    ? backoff.retryUntilMs - nowMs
    : null;
}

async function persistRateLimit(
  db: D1Database,
  spotifyClientId: string,
  error: SpotifyPlaybackError,
  nowMs: number
): Promise<void> {
  if (error.kind === 'rate_limited' && error.retryAfterMs !== undefined) {
    await upsertSpotifyBackoff(
      db,
      spotifyClientId,
      nowMs + error.retryAfterMs,
      nowMs
    );
  }
}

async function boundedJson(response: Response): Promise<ApiResult<unknown>> {
  const contentLength = Number(response.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    return unknownResponse(response.status);
  }
  try {
    const text = await readBoundedText(response, maxResponseBytes);
    if (text === null) {
      return unknownResponse(response.status);
    }
    return {
      ok: true,
      value: JSON.parse(text) as unknown
    };
  } catch {
    return unknownResponse(response.status);
  }
}

async function isInvalidGrant(response: Response): Promise<boolean> {
  const parsed = await boundedJson(response);
  return (
    parsed.ok &&
    parsed.value !== null &&
    !Array.isArray(parsed.value) &&
    typeof parsed.value === 'object' &&
    (parsed.value as Record<string, unknown>).error === 'invalid_grant'
  );
}

function validRefreshResponse(value: unknown): boolean {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    boundedToken(body.access_token) &&
    body.token_type === 'Bearer' &&
    Number.isInteger(body.expires_in) &&
    (body.expires_in as number) >= 1 &&
    (body.expires_in as number) <= 86_400 &&
    (body.refresh_token === undefined || boundedToken(body.refresh_token))
  );
}

function classifySpotifyStatus(response: Response): SpotifyPlaybackError {
  if (response.status === 401) {
    return {
      kind: 'unauthorized',
      message: 'Spotify authorization is missing or expired.',
      status: 401
    };
  }
  if (response.status === 403) {
    return {
      kind: 'forbidden',
      message: 'Spotify denied this operation for the current account or device.',
      status: 403
    };
  }
  if (response.status === 429) {
    return {
      kind: 'rate_limited',
      message: 'Spotify rate limit reached.',
      status: 429,
      retryAfterMs: parseRetryAfter(response.headers.get('Retry-After'))
    };
  }
  return {
    kind: 'unavailable',
    message: 'Spotify is temporarily unavailable.',
    status: response.status
  };
}

function parseRetryAfter(value: string | null): number {
  if (value === null || !/^\d{1,6}$/.test(value)) {
    return 1000;
  }
  return Math.min(Number(value) * 1000, maxRetryAfterMs);
}

function commandRequest(command: PlaybackCommand): {
  method: 'POST' | 'PUT';
  url: string;
} {
  const url = new URL(playbackEndpoint);
  switch (command.type) {
    case 'play':
    case 'pause':
      url.pathname += `/${command.type}`;
      return { method: 'PUT', url: url.toString() };
    case 'next':
    case 'previous':
      url.pathname += `/${command.type}`;
      return { method: 'POST', url: url.toString() };
    case 'seek':
      url.pathname += '/seek';
      url.searchParams.set('position_ms', String(command.positionMs));
      return { method: 'PUT', url: url.toString() };
    case 'volume':
      url.pathname += '/volume';
      url.searchParams.set('volume_percent', String(command.volumePercent));
      return { method: 'PUT', url: url.toString() };
    case 'shuffle':
      url.pathname += '/shuffle';
      url.searchParams.set('state', String(command.state));
      return { method: 'PUT', url: url.toString() };
    case 'repeat':
      url.pathname += '/repeat';
      url.searchParams.set('state', command.state);
      return { method: 'PUT', url: url.toString() };
  }
}

function authorizationRequired(): ApiResult<never> {
  return {
    ok: false,
    error: {
      kind: 'unauthorized',
      message: 'Spotify authorization is required.',
      status: 401
    }
  };
}

function rateLimited(retryAfterMs: number): ApiResult<never> {
  return {
    ok: false,
    error: {
      kind: 'rate_limited',
      message: 'Spotify rate limit reached.',
      status: 429,
      retryAfterMs
    }
  };
}

function networkError(): ApiResult<never> {
  return {
    ok: false,
    error: {
      kind: 'network_error',
      message: 'Spotify request failed before a response was received.'
    }
  };
}

function unavailable(retryAfterMs?: number): ApiResult<never> {
  return {
    ok: false,
    error: {
      kind: 'unavailable',
      message: 'Spotify is temporarily unavailable.',
      ...(retryAfterMs === undefined ? {} : { retryAfterMs })
    }
  };
}

function unknownResponse(status?: number): ApiResult<never> {
  return {
    ok: false,
    error: {
      kind: 'unknown_response_shape',
      message: 'Spotify returned an unexpected response.',
      ...(status === undefined ? {} : { status })
    }
  };
}

function boundedToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192;
}

function randomJitter(maxInclusive: number): number {
  return crypto.getRandomValues(new Uint8Array(1))[0] % (maxInclusive + 1);
}
