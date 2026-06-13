import type { NormalizedPlayback } from '@spotify-wallpaper/shared-types';
import { classifyNetworkError, classifySpotifyStatus } from './errors';
import { normalizeSpotifyPlayback } from './normalize';
import type { Fetcher, SpotifyResult } from './types';

const CURRENT_PLAYBACK_ENDPOINT = 'https://api.spotify.com/v1/me/player';

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
    return normalized;
  }

  return { ok: true, value: normalized.value.playback };
};
