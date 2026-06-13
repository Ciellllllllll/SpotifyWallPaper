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

  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }

  return seconds * 1000;
};
