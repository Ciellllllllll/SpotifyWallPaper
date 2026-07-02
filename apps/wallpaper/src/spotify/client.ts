import type { NormalizedPlayback, SpotifyPlaybackError } from '@spotify-wallpaper/shared-types';
import { classifyNetworkError, classifySpotifyStatus } from './errors';
import { normalizeSpotifyPlayback } from './normalize';
import type { Fetcher, SpotifyPlaybackCommand, SpotifyResult } from './types';

const CURRENT_PLAYBACK_ENDPOINT = 'https://api.spotify.com/v1/me/player';
const CURRENTLY_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing';
const PLAYER_ENDPOINT = 'https://api.spotify.com/v1/me/player';

export const fetchCurrentPlayback = async (
  accessToken: string,
  fetcher: Fetcher = fetch,
  fetchedAt = new Date().toISOString()
): Promise<SpotifyResult<NormalizedPlayback>> => {
  let response: Response;
  try {
    response = await fetcher(CURRENT_PLAYBACK_ENDPOINT, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
  } catch {
    return { ok: false, error: classifyNetworkError() };
  }

  if (response.status === 204) {
    return { ok: false, error: classifySpotifyStatus(response.status, response.headers.get('retry-after')) };
  }

  if (!response.ok) {
    return { ok: false, error: classifySpotifyStatus(response.status, response.headers.get('retry-after')) };
  }

  const payload = await response.json().catch(() => null);
  const normalized = normalizeSpotifyPlayback(payload, fetchedAt);
  if (!normalized.ok) {
    return fetchCurrentlyPlayingFallback(accessToken, fetcher, fetchedAt, normalized.error);
  }

  return { ok: true, value: normalized.value.playback };
};

const fetchCurrentlyPlayingFallback = async (
  accessToken: string,
  fetcher: Fetcher,
  fetchedAt: string,
  firstError: SpotifyPlaybackError
): Promise<SpotifyResult<NormalizedPlayback>> => {
  let response: Response;
  try {
    response = await fetcher(CURRENTLY_PLAYING_ENDPOINT, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
  } catch {
    return { ok: false, error: firstError };
  }

  if (response.status === 204) {
    return { ok: false, error: classifySpotifyStatus(response.status, response.headers.get('retry-after')) };
  }

  if (!response.ok) {
    return { ok: false, error: firstError };
  }

  const payload = await response.json().catch(() => null);
  const normalized = normalizeSpotifyPlayback(payload, fetchedAt);
  return normalized.ok ? { ok: true, value: normalized.value.playback } : { ok: false, error: firstError };
};

export const sendPlaybackCommand = async (
  accessToken: string,
  command: SpotifyPlaybackCommand,
  fetcher: Fetcher = fetch
): Promise<SpotifyResult<void>> => {
  const request = playbackCommandRequest(command);
  let response: Response;
  try {
    response = await fetcher(request.url, {
      method: request.method,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
  } catch {
    return { ok: false, error: classifyNetworkError() };
  }

  if (response.ok || response.status === 204) {
    return { ok: true, value: undefined };
  }

  return { ok: false, error: classifySpotifyStatus(response.status, response.headers.get('retry-after')) };
};

const playbackCommandRequest = (command: SpotifyPlaybackCommand): { method: string; url: string } => {
  const url = new URL(PLAYER_ENDPOINT);

  switch (command.type) {
    case 'play':
      url.pathname += '/play';
      return { method: 'PUT', url: url.toString() };
    case 'pause':
      url.pathname += '/pause';
      return { method: 'PUT', url: url.toString() };
    case 'next':
      url.pathname += '/next';
      return { method: 'POST', url: url.toString() };
    case 'previous':
      url.pathname += '/previous';
      return { method: 'POST', url: url.toString() };
    case 'seek':
      url.pathname += '/seek';
      url.searchParams.set('position_ms', String(clampInteger(command.positionMs, 0, Number.MAX_SAFE_INTEGER)));
      return { method: 'PUT', url: url.toString() };
    case 'volume':
      url.pathname += '/volume';
      url.searchParams.set('volume_percent', String(clampInteger(command.volumePercent, 0, 100)));
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
};

const clampInteger = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.round(Math.min(max, Math.max(min, value)));
};
