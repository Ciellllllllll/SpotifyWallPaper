import {
  isPlaybackCommand,
  type NormalizedPlayback,
  type PlaybackCommand,
  type ProviderResult
} from '@spotify-wallpaper/shared-types';
import { digestProtocolValue } from './crypto.js';
import type { Credential } from './db.js';
import {
  apiError,
  apiResult,
  handleCorsPreflight,
  isWallpaperOriginAllowed,
  readBoundedBytes,
  withWallpaperCors
} from './http.js';
import { canonicalIssuer } from './issuer.js';
import { parsePairingToken } from './pairing.js';
import { FixedWindowLimiter } from './rate-limit.js';
import type { CredentialLock } from './credential-lock.js';

export interface ApiDependencies {
  oauthHmacKey: string;
  publicBaseUrl: string;
  now: () => number;
  credentialLock: CredentialLock;
  isDeletionTombstoned(publicId: string): Promise<boolean>;
  findCredential(token: string, requireActive: boolean): Promise<Credential | null>;
  fetchPlayback(credential: Credential): Promise<ProviderResult<NormalizedPlayback>>;
  sendCommand(
    credential: Credential,
    command: PlaybackCommand
  ): Promise<ProviderResult<null>>;
  deleteCredential(publicId: string, deletedAtMs: number): Promise<void>;
}

export interface ApiHandlers {
  playback(request: Request): Promise<Response>;
  playbackOptions(request: Request): Response;
  control(request: Request): Promise<Response>;
  controlOptions(request: Request): Response;
  account(request: Request): Promise<Response>;
}

export function createApiHandlers(dependencies: ApiDependencies): ApiHandlers {
  const issuerLimiter = new FixedWindowLimiter(6000, 4096, dependencies.now);
  const playbackLimiter = new FixedWindowLimiter(120, 64, dependencies.now);
  const mutationLimiter = new FixedWindowLimiter(60, 64, dependencies.now);
  const origin = new URL(dependencies.publicBaseUrl).origin;

  async function authenticate(
    request: Request,
    requireActive: boolean
  ): Promise<{ credential: Credential; token: string } | Response> {
    const issuer = canonicalIssuer(request.headers.get('X-SWP-Client-IP') ?? '');
    if (issuer === null) return unauthorized();
    const issuerDigest = await digestProtocolValue(
      'setup-issuer-v2',
      issuer,
      dependencies.oauthHmacKey
    );
    const issuerLimit = issuerLimiter.take(issuerDigest);
    if (!issuerLimit.allowed) return rateLimited(issuerLimit.retryAfterSeconds);

    const authorization = request.headers.get('Authorization');
    if (
      authorization === null ||
      !authorization.startsWith('Bearer ') ||
      authorization.length > 300
    ) {
      return unauthorized();
    }
    const token = authorization.slice(7);
    const parsed = parsePairingToken(token);
    if (
      parsed === null ||
      (await dependencies.isDeletionTombstoned(parsed.publicId))
    ) {
      return unauthorized();
    }
    const credential = await dependencies.findCredential(token, requireActive);
    return credential === null ? unauthorized() : { credential, token };
  }

  async function revalidate(
    token: string,
    publicId: string,
    requireActive: boolean
  ): Promise<Credential | null> {
    if (await dependencies.isDeletionTombstoned(publicId)) return null;
    return dependencies.findCredential(token, requireActive);
  }

  return {
    playbackOptions(request) {
      return handleCorsPreflight(request, 'GET');
    },

    controlOptions(request) {
      return handleCorsPreflight(request, 'POST');
    },

    async playback(request) {
      if (!isWallpaperOriginAllowed(request)) {
        return apiError(403, 'unauthorized', 'Wallpaper origin is not allowed.');
      }
      try {
        const authenticated = await authenticate(request, true);
        if (authenticated instanceof Response) return cors(authenticated, request);
        const limited = playbackLimiter.take(authenticated.credential.publicId);
        if (!limited.allowed) {
          return cors(rateLimited(limited.retryAfterSeconds), request);
        }
        return cors(
          await dependencies.credentialLock(authenticated.credential.publicId, async () => {
            const current = await revalidate(
              authenticated.token,
              authenticated.credential.publicId,
              true
            );
            return current === null
              ? unauthorized()
              : apiResult(await dependencies.fetchPlayback(current));
          }),
          request
        );
      } catch {
        return cors(unavailable(), request);
      }
    },

    async control(request) {
      if (!isWallpaperOriginAllowed(request)) {
        return apiError(403, 'unauthorized', 'Wallpaper origin is not allowed.');
      }
      try {
        const authenticated = await authenticate(request, true);
        if (authenticated instanceof Response) return cors(authenticated, request);
        const limited = mutationLimiter.take(authenticated.credential.publicId);
        if (!limited.allowed) {
          return cors(rateLimited(limited.retryAfterSeconds), request);
        }
        const parsed = await controlBody(request);
        if (parsed === 'too_large') {
          return cors(
            apiError(413, 'unavailable', 'Control request is too large.'),
            request
          );
        }
        if (parsed === null) {
          return cors(
            apiError(
              400,
              'unknown_response_shape',
              'Control request is invalid.'
            ),
            request
          );
        }
        return cors(
          await dependencies.credentialLock(authenticated.credential.publicId, async () => {
            let current = await revalidate(
              authenticated.token,
              authenticated.credential.publicId,
              true
            );
            if (current === null) return unauthorized();
            if (parsed.type === 'seek') {
              const playback = await dependencies.fetchPlayback(current);
              if (!playback.ok) return apiResult(playback);
              if (parsed.positionMs > playback.value.durationMs) {
                return apiError(
                  400,
                  'unknown_response_shape',
                  'Seek position exceeds the current item duration.'
                );
              }
              current = await revalidate(
                authenticated.token,
                authenticated.credential.publicId,
                true
              );
              if (current === null) return unauthorized();
            }
            return apiResult(await dependencies.sendCommand(current, parsed));
          }),
          request
        );
      } catch {
        return cors(unavailable(), request);
      }
    },

    async account(request) {
      if (
        new URL(request.url).origin !== origin ||
        request.headers.get('Origin') !== origin
      ) {
        return apiError(403, 'unauthorized', 'Same-origin setup is required.');
      }
      try {
        const authenticated = await authenticate(request, false);
        if (authenticated instanceof Response) return authenticated;
        const limited = mutationLimiter.take(authenticated.credential.publicId);
        if (!limited.allowed) return rateLimited(limited.retryAfterSeconds);
        return dependencies.credentialLock(authenticated.credential.publicId, async () => {
          const current = await revalidate(
            authenticated.token,
            authenticated.credential.publicId,
            false
          );
          if (current === null) return unauthorized();
          await dependencies.deleteCredential(current.publicId, dependencies.now());
          return apiResult({ ok: true, value: null });
        });
      } catch {
        return unavailable();
      }
    }
  };
}

async function controlBody(
  request: Request
): Promise<PlaybackCommand | 'too_large' | null> {
  if (
    request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !==
    'application/json'
  ) {
    return null;
  }
  const bytes = await readBoundedBytes(request, 1024);
  if (bytes === null) return 'too_large';
  try {
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    );
    return isPlaybackCommand(value) ? value : null;
  } catch {
    return null;
  }
}

function cors(response: Response, request: Request): Response {
  return withWallpaperCors(response, request);
}

function unauthorized(): Response {
  return apiError(401, 'unauthorized', 'A valid Pairing Token is required.');
}

function rateLimited(retryAfterSeconds: number): Response {
  return apiError(
    429,
    'rate_limited',
    'Too many API requests.',
    retryAfterSeconds * 1000
  );
}

function unavailable(): Response {
  return apiError(503, 'unavailable', 'The backend is temporarily unavailable.');
}
