import type { NormalizedPlayback, WallpaperPreferences, SpotifyPlaybackError } from '@spotify-wallpaper/shared-types';
import { isTrustedPublicBackendOrigin } from './providers/backendProvider';
import type { SpotifyResult } from './types';

const DEFAULT_PLAYING_INTERVAL_MS = 1000;
const DEFAULT_PAUSED_INTERVAL_MS = 3000;
const PUBLIC_BACKEND_PLAYING_INTERVAL_MS = 2000;
const PUBLIC_BACKEND_PAUSED_INTERVAL_MS = 5000;
const DEFAULT_ERROR_BACKOFF_MS = 5000;
const MAX_ERROR_BACKOFF_MS = 60_000;
const ACTIVE_TRANSIENT_ERROR_BACKOFF_MS = 5000;

export interface PollDecisionInput {
  playback?: NormalizedPlayback | null;
  error?: SpotifyPlaybackError | null;
  consecutiveErrors?: number;
  settings?: WallpaperPreferences;
}

export interface PlaybackHistory {
  playback: NormalizedPlayback;
  previousPlayback: NormalizedPlayback | null;
}

export const playbackHistoryAfterPoll = (
  history: PlaybackHistory,
  result: SpotifyResult<NormalizedPlayback>
): PlaybackHistory => {
  if (!result.ok) return history;
  if (history.playback.id !== result.value.id || history.playback.itemType !== result.value.itemType) {
    return { playback: result.value, previousPlayback: history.playback };
  }
  return { playback: result.value, previousPlayback: history.previousPlayback };
};

export const nextPollingDelayMs = ({ playback, error, consecutiveErrors = 0, settings }: PollDecisionInput): number => {
  const publicBackend = isTrustedPublicBackend(settings);
  const playingIntervalMs = pollingInterval(settings?.spotify.pollIntervalPlayingMs, DEFAULT_PLAYING_INTERVAL_MS, PUBLIC_BACKEND_PLAYING_INTERVAL_MS, publicBackend);
  const pausedIntervalMs = pollingInterval(settings?.spotify.pollIntervalPausedMs, DEFAULT_PAUSED_INTERVAL_MS, PUBLIC_BACKEND_PAUSED_INTERVAL_MS, publicBackend);

  if (error?.kind === 'rate_limited' && error.retryAfterMs !== undefined) return Math.max(error.retryAfterMs, playingIntervalMs);
  if (error) {
    if (playback?.isPlaying && (error.kind === 'network_error' || error.kind === 'unavailable' || error.kind === 'unknown_response_shape')) {
      return ACTIVE_TRANSIENT_ERROR_BACKOFF_MS;
    }
    return Math.min(DEFAULT_ERROR_BACKOFF_MS * Math.max(1, consecutiveErrors + 1), MAX_ERROR_BACKOFF_MS);
  }
  return playback?.isPlaying ? playingIntervalMs : pausedIntervalMs;
};

const pollingInterval = (configured: number | undefined, localDefault: number, publicDefault: number, publicBackend: boolean): number => {
  const value = publicBackend && (configured === undefined || configured === localDefault) ? publicDefault : configured;
  return clampInterval(value, publicBackend ? publicDefault : localDefault);
};

const clampInterval = (value: number | undefined, fallback: number): number =>
  typeof value !== 'number' || !Number.isFinite(value) ? fallback : Math.min(Math.max(value, 500), 60_000);

const isTrustedPublicBackend = (settings: WallpaperPreferences | undefined): boolean =>
  settings?.spotify.provider === 'backend' && !!settings.spotify.backendOrigin && isTrustedPublicBackendOrigin(settings.spotify.backendOrigin);
