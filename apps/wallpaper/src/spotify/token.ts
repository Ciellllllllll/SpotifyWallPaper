import { classifyNetworkError, classifySpotifyStatus } from './errors';
import type { Fetcher, SpotifyCredentials, SpotifyResult, SpotifyTokenState } from './types';

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const EXPIRY_SAFETY_WINDOW_MS = 30_000;

export const shouldRefreshToken = (token: SpotifyTokenState | null, nowMs = Date.now()): boolean => {
  if (!token) {
    return true;
  }

  return token.expiresAtMs - EXPIRY_SAFETY_WINDOW_MS <= nowMs;
};

export const refreshAccessToken = async (
  credentials: SpotifyCredentials,
  fetcher: Fetcher = fetch,
  nowMs = Date.now()
): Promise<SpotifyResult<SpotifyTokenState>> => {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId
  });

  let response: Response;
  try {
    response = await fetcher(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    });
  } catch {
    return { ok: false, error: classifyNetworkError() };
  }

  if (!response.ok) {
    return { ok: false, error: classifySpotifyStatus(response.status, response.headers.get('retry-after')) };
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
      expiresAtMs: nowMs + payload.expires_in * 1000
    }
  };
};

const isTokenPayload = (value: unknown): value is { access_token: string; expires_in: number } => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.access_token === 'string' && typeof record.expires_in === 'number';
};
