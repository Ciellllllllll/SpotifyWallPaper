import { parseSecretKeyring } from './crypto';
import { isPlaybackCommand, type PlaybackCommand } from '@spotify-wallpaper/shared-types';
import {
  deleteCredentialData,
  findActiveCredentialByPairingToken,
  findCredentialByPairingToken,
  getCredentialByPublicId,
  isDeletionTombstoned,
  markDeletionTombstoneReconciled,
  writeDeletionTombstone,
  type Credential
} from './db';
import {
  apiError,
  apiResult,
  handleCorsPreflight,
  isSetupSameOrigin,
  isWallpaperOriginAllowed,
  methodNotAllowed,
  readBoundedBytes,
  withWallpaperCors
} from './http';
import { parsePairingToken } from './pairing';
import {
  fetchCredentialPlayback,
  sendCredentialSpotifyCommand
} from './spotify';

const deletionRetentionMs = 35 * 24 * 60 * 60 * 1000;
const maxControlBodyBytes = 1024;

export async function handleApiRequest(
  request: Request,
  env: Env
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/playback') {
    return handlePlayback(request, env);
  }
  if (path === '/api/control') {
    return handleControl(request, env);
  }
  if (path === '/api/account') {
    return handleAccountDeletion(request, env);
  }
  return null;
}

async function handlePlayback(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return handleCorsPreflight(request, 'GET');
  }
  if (request.method !== 'GET') {
    return corsIfAllowed(methodNotAllowed('GET, OPTIONS'), request);
  }
  if (!isWallpaperOriginAllowed(request)) {
    return apiError(403, 'unauthorized', 'Wallpaper origin is not allowed.');
  }

  try {
    if (!(await preAuthenticationRateLimit(request, env.PRE_AUTH_RATE_LIMITER))) {
      return corsIfAllowed(rateLimited(), request);
    }
    const credential = await authenticate(request, env, true);
    if (credential === null) {
      return corsIfAllowed(unauthorized(), request);
    }
    if (!(await rateLimit(env.PLAYBACK_RATE_LIMITER, `playback:${credential.publicId}`))) {
      return corsIfAllowed(rateLimited(), request);
    }
    const result = await fetchCredentialPlayback(env.DB, credential, env);
    return corsIfAllowed(apiResult(result), request);
  } catch {
    return corsIfAllowed(unavailable(), request);
  }
}

async function handleControl(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return handleCorsPreflight(request, 'POST');
  }
  if (request.method !== 'POST') {
    return corsIfAllowed(methodNotAllowed('POST, OPTIONS'), request);
  }
  if (!isWallpaperOriginAllowed(request)) {
    return apiError(403, 'unauthorized', 'Wallpaper origin is not allowed.');
  }

  try {
    if (!(await preAuthenticationRateLimit(request, env.PRE_AUTH_RATE_LIMITER))) {
      return corsIfAllowed(rateLimited(), request);
    }
    const credential = await authenticate(request, env, true);
    if (credential === null) {
      return corsIfAllowed(unauthorized(), request);
    }
    if (!(await rateLimit(env.CONTROL_RATE_LIMITER, `control:${credential.publicId}`))) {
      return corsIfAllowed(rateLimited(), request);
    }
    const parsed = await parseControlRequest(request);
    if (parsed.kind === 'too_large') {
      return corsIfAllowed(
        apiError(413, 'unavailable', 'Control request is too large.'),
        request
      );
    }
    if (parsed.kind === 'invalid') {
      return corsIfAllowed(
        apiError(400, 'unknown_response_shape', 'Control request is invalid.'),
        request
      );
    }
    if (parsed.command.type === 'seek') {
      const playback = await fetchCredentialPlayback(env.DB, credential, env);
      if (!playback.ok) {
        return corsIfAllowed(apiResult(playback), request);
      }
      if (parsed.command.positionMs > playback.value.durationMs) {
        return corsIfAllowed(
          apiError(
            400,
            'unknown_response_shape',
            'Seek position exceeds the current item duration.'
          ),
          request
        );
      }
    }
    const commandCredential =
      parsed.command.type === 'seek'
        ? await getCredentialByPublicId(env.DB, credential.publicId)
        : credential;
    if (commandCredential === null) {
      return corsIfAllowed(unauthorized(), request);
    }
    const result = await sendCredentialSpotifyCommand(
      env.DB,
      commandCredential,
      env,
      parsed.command
    );
    return corsIfAllowed(apiResult(result), request);
  } catch {
    return corsIfAllowed(unavailable(), request);
  }
}

async function handleAccountDeletion(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== 'DELETE') {
    return methodNotAllowed('DELETE');
  }
  if (!isSetupSameOrigin(request, env)) {
    return apiError(403, 'unauthorized', 'Same-origin setup is required.');
  }

  try {
    if (!(await preAuthenticationRateLimit(request, env.PRE_AUTH_RATE_LIMITER))) {
      return rateLimited();
    }
    const credential = await authenticate(request, env, false);
    if (credential === null) {
      return unauthorized();
    }
    if (!(await rateLimit(env.CONTROL_RATE_LIMITER, `account:${credential.publicId}`))) {
      return rateLimited();
    }
    const nowMs = Date.now();
    await writeDeletionTombstone(
      env.DELETION_DB,
      credential.publicId,
      nowMs,
      nowMs + deletionRetentionMs
    );
    await deleteCredentialData(env.DB, credential.publicId);
    await markDeletionTombstoneReconciled(
      env.DELETION_DB,
      credential.publicId,
      nowMs
    );
    return apiResult({ ok: true, value: null });
  } catch {
    return unavailable();
  }
}

async function authenticate(
  request: Request,
  env: Env,
  requireActive: boolean
): Promise<Credential | null> {
  const authorization = request.headers.get('Authorization');
  if (
    authorization === null ||
    !authorization.startsWith('Bearer ') ||
    authorization.length > 300
  ) {
    return null;
  }
  const token = authorization.slice('Bearer '.length);
  const parsed = parsePairingToken(token);
  if (parsed === null) {
    return null;
  }
  if (await isDeletionTombstoned(env.DELETION_DB, parsed.publicId)) {
    return null;
  }
  const keyring = parseSecretKeyring(env.PAIRING_HMAC_KEYRING);
  return requireActive
    ? findActiveCredentialByPairingToken(env.DB, token, keyring)
    : findCredentialByPairingToken(env.DB, token, keyring);
}

async function parseControlRequest(
  request: Request
): Promise<
  | { kind: 'valid'; command: PlaybackCommand }
  | { kind: 'invalid' }
  | { kind: 'too_large' }
> {
  if (
    request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !==
    'application/json'
  ) {
    return { kind: 'invalid' };
  }
  const bytes = await readBoundedBytes(request, maxControlBodyBytes);
  if (bytes === null) {
    return { kind: 'too_large' };
  }

  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    ) as unknown;
  } catch {
    return { kind: 'invalid' };
  }
  return isPlaybackCommand(value)
    ? { kind: 'valid', command: value }
    : { kind: 'invalid' };
}

async function rateLimit(binding: RateLimit, key: string): Promise<boolean> {
  const result = await binding.limit({ key });
  return result.success;
}

async function preAuthenticationRateLimit(
  request: Request,
  binding: RateLimit
): Promise<boolean> {
  const address = request.headers.get('CF-Connecting-IP');
  const key =
    address !== null && /^[0-9A-Fa-f:.]{2,64}$/.test(address)
      ? address.toLowerCase()
      : 'unknown';
  return rateLimit(binding, `preauth:${key}`);
}

function corsIfAllowed(response: Response, request: Request): Response {
  return isWallpaperOriginAllowed(request)
    ? withWallpaperCors(response, request)
    : response;
}

function unauthorized(): Response {
  return apiError(401, 'unauthorized', 'A valid Pairing Token is required.');
}

function rateLimited(): Response {
  return apiError(
    429,
    'rate_limited',
    'Too many API requests.',
    60_000
  );
}

function unavailable(): Response {
  return apiError(503, 'unavailable', 'The backend is temporarily unavailable.');
}
