import { classifyNetworkError, classifySpotifyResponse } from './errors';
import type { Fetcher, SpotifyCredentials, SpotifyResult, SpotifyTokenState } from './types';
import { spotifyFetch } from './request';

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const EXPIRY_SAFETY_WINDOW_MS = 30_000;

export const shouldRefreshToken = (token: SpotifyTokenState | null, nowMs = Date.now()): boolean => {
  if (!token) {
    return true;
  }

  return (token.refreshAtMs ?? token.expiresAtMs - EXPIRY_SAFETY_WINDOW_MS) <= nowMs;
};

export const refreshAccessToken = async (
  credentials: SpotifyCredentials,
  fetcher: Fetcher = fetch,
  nowMs = Date.now(),
  signal?: AbortSignal
): Promise<SpotifyResult<SpotifyTokenState>> => {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId
  });

  let response: Response;
  try {
    response = await spotifyFetch(fetcher, TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
      signal,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store'
    });
  } catch {
    return { ok: false, error: classifyNetworkError() };
  }

  if (!response.ok) {
    const payload: unknown = await response.clone().json().catch(() => null);
    if (payload !== null && typeof payload === 'object' && (payload as Record<string, unknown>).error === 'invalid_grant') {
      return { ok: false, invalidGrant: true, error: { kind: 'unauthorized', message: 'Spotify authorization is required.', status: response.status } };
    }
    return { ok: false, error: await classifySpotifyResponse(response) };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!isTokenPayload(payload)) {
    return {
      ok: false,
      error: {
        kind: 'unknown_response_shape',
        message: 'Spotify token response shape was unexpected.',
        status: response.status
      }
    };
  }

  return {
    ok: true,
    value: {
      accessToken: payload.access_token,
      expiresAtMs: nowMs + payload.expires_in * 1000,
      refreshAtMs: nowMs + payload.expires_in * 1000 - Math.min(EXPIRY_SAFETY_WINDOW_MS, payload.expires_in * 100),
      ...(typeof payload.refresh_token === 'string' && payload.refresh_token.trim() ? { refreshToken: payload.refresh_token } : {})
    }
  };
};

const isTokenPayload = (value: unknown): value is { access_token: string; expires_in: number; refresh_token?: string | null } => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.access_token === 'string' && record.access_token.trim().length > 0 && record.access_token.length <= 16384 &&
    typeof record.expires_in === 'number' && Number.isFinite(record.expires_in) && record.expires_in > 0 && record.expires_in <= 86400 &&
    (record.refresh_token == null || (typeof record.refresh_token === 'string' && record.refresh_token.length <= 16384));
};
