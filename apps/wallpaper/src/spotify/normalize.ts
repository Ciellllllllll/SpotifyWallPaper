import {
  normalizeSpotifyPlaybackPayload,
  type NormalizedPlayback,
  type SpotifyPlaybackError
} from '@spotify-wallpaper/shared-types';
import { itemNullError } from './errors';
import type { SpotifyPlaybackResponse, SpotifyResult } from './types';

export const normalizeSpotifyPlayback = (
  raw: SpotifyPlaybackResponse,
  fetchedAt = new Date().toISOString()
): SpotifyResult<{ playback: NormalizedPlayback; warning?: SpotifyPlaybackError }> => {
  const normalized = normalizeSpotifyPlaybackPayload(raw, fetchedAt);
  if (!normalized.ok) {
    return normalized;
  }
  return {
    ok: true,
    value: {
      playback: normalized.value,
      ...(normalized.value.itemType === 'none' ? { warning: itemNullError() } : {})
    }
  };
};
