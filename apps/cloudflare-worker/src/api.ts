import { parseSecretKeyring } from './crypto';
import {
  deleteCredentialData,
  findActiveCredentialByPairingToken,
  findCredentialByPairingToken,
  getCredentialByPublicId,
  isDeletionTombstoned,
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
  sendCredentialSpotifyCommand,
  type SpotifyPlaybackCommand
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
  | { kind: 'valid'; command: SpotifyPlaybackCommand }
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
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return { kind: 'invalid' };
  }
  const command = value as Record<string, unknown>;
  if (typeof command.type !== 'string') {
    return { kind: 'invalid' };
  }
  if (
    command.type === 'play' ||
    command.type === 'pause' ||
    command.type === 'next' ||
    command.type === 'previous'
  ) {
    return exactKeys(command, ['type'])
      ? { kind: 'valid', command: { type: command.type } }
      : { kind: 'invalid' };
  }
  if (
    command.type === 'seek' &&
    exactKeys(command, ['positionMs', 'type']) &&
    finiteInteger(command.positionMs) &&
    command.positionMs >= 0
  ) {
    return {
      kind: 'valid',
      command: { type: 'seek', positionMs: command.positionMs }
    };
  }
  if (
    command.type === 'volume' &&
    exactKeys(command, ['type', 'volumePercent']) &&
    finiteInteger(command.volumePercent) &&
    command.volumePercent >= 0 &&
    command.volumePercent <= 100
  ) {
    return {
      kind: 'valid',
      command: { type: 'volume', volumePercent: command.volumePercent }
    };
  }
  if (
    command.type === 'shuffle' &&
    exactKeys(command, ['state', 'type']) &&
    typeof command.state === 'boolean'
  ) {
    return {
      kind: 'valid',
      command: { type: 'shuffle', state: command.state }
    };
  }
  if (
    command.type === 'repeat' &&
    exactKeys(command, ['state', 'type']) &&
    (command.state === 'off' ||
      command.state === 'track' ||
      command.state === 'context')
  ) {
    return {
      kind: 'valid',
      command: { type: 'repeat', state: command.state }
    };
  }
  return { kind: 'invalid' };
}

async function rateLimit(binding: RateLimit, key: string): Promise<boolean> {
  const result = await binding.limit({ key });
  return result.success;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function finiteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
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
