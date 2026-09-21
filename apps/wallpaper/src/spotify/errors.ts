import type { SpotifyPlaybackError } from '@spotify-wallpaper/shared-types';

export const classifySpotifyStatus = (status: number, retryAfterHeader?: string | null): SpotifyPlaybackError => {
  if (status === 401) {
    return { kind: 'unauthorized', message: 'Spotify authorization is missing or expired.', status };
  }

  if (status === 403) {
    return { kind: 'forbidden', message: 'Spotify denied this operation for the current account or device.', status };
  }

  if (status === 204) {
    return { kind: 'unavailable', message: 'Spotify has no active playback device.', status };
  }
  if (status >= 500 && status <= 599) return { kind: 'unavailable', message: 'Spotify service is temporarily unavailable.', status };

  if (status === 429) {
    return {
      kind: 'rate_limited',
      message: 'Spotify rate limit reached.',
      retryAfterMs: parseRetryAfterMs(retryAfterHeader),
      status
    };
  }

  return { kind: 'unknown_response_shape', message: 'Spotify returned an unexpected response.', status };
};

export const classifySpotifyResponse = async (response: Response): Promise<SpotifyPlaybackError> => {
  const error = classifySpotifyStatus(response.status, response.headers.get('retry-after'));
  if (response.status !== 429) return error;
  const payload: unknown = await response.clone().json().catch(() => null);
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const nested = record.error;
    if (record.reason === 'QUOTA_EXCEEDED' || (nested && typeof nested === 'object' && (nested as Record<string, unknown>).reason === 'QUOTA_EXCEEDED')) {
      return { ...error, quotaExceeded: true, message: 'Spotify developer account quota is exhausted.', retryAfterMs: Math.max(error.retryAfterMs ?? 0, 3_600_000) };
    }
  }
  return error;
};

export const classifyNetworkError = (): SpotifyPlaybackError => ({
  kind: 'network_error',
  message: 'Spotify request failed before a response was received.'
});

export const itemNullError = (): SpotifyPlaybackError => ({
  kind: 'item_null',
  message: 'Spotify returned playback without an item.'
});

const parseRetryAfterMs = (value?: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  if (!/^[0-9]+$/.test(value)) {
    return undefined;
  }
  const seconds = Number(value);
  return Math.min(Number.MAX_SAFE_INTEGER, seconds * 1000);
};
