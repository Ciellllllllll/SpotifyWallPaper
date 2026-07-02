import type { NormalizedPlayback, SpotifyPlaybackError, WallpaperSettings } from '@spotify-wallpaper/shared-types';
import { fetchCurrentPlayback, sendPlaybackCommand } from './client';
import { refreshAccessToken, shouldRefreshToken } from './token';
import type { Fetcher, SpotifyCredentials, SpotifyPlaybackCommand, SpotifyResult, SpotifyTokenState } from './types';

const DEFAULT_PLAYING_INTERVAL_MS = 1000;
const DEFAULT_PAUSED_INTERVAL_MS = 3000;
const DEFAULT_ERROR_BACKOFF_MS = 5000;
const MAX_ERROR_BACKOFF_MS = 60_000;

export interface PollDecisionInput {
  playback?: NormalizedPlayback | null;
  error?: SpotifyPlaybackError | null;
  consecutiveErrors?: number;
  settings?: WallpaperSettings;
}

export class SpotifyPlaybackSession {
  private token: SpotifyTokenState | null = null;

  constructor(
    private readonly credentials: SpotifyCredentials,
    private readonly fetcher: Fetcher = fetch
  ) {}

  async poll(nowMs = Date.now()): Promise<SpotifyResult<NormalizedPlayback>> {
    const token = await this.accessToken(nowMs);
    if (!token.ok) {
      return token;
    }

    return fetchCurrentPlayback(token.value, this.fetcher, new Date(nowMs).toISOString());
  }

  async control(command: SpotifyPlaybackCommand, nowMs = Date.now()): Promise<SpotifyResult<void>> {
    const token = await this.accessToken(nowMs);
    if (!token.ok) {
      return token;
    }

    return sendPlaybackCommand(token.value, command, this.fetcher);
  }

  private async accessToken(nowMs: number): Promise<SpotifyResult<string>> {
    if (shouldRefreshToken(this.token, nowMs)) {
      const refreshed = await refreshAccessToken(this.credentials, this.fetcher, nowMs);
      if (!refreshed.ok) {
        return refreshed;
      }

      this.token = refreshed.value;
    }

    if (!this.token) {
      return {
        ok: false,
        error: {
          kind: 'unauthorized',
          message: 'Spotify access token is unavailable.'
        }
      };
    }

    return { ok: true, value: this.token.accessToken };
  }
}

export const hasSpotifyCredentials = (settings: WallpaperSettings): settings is WallpaperSettings & {
  spotify: WallpaperSettings['spotify'] & { refreshToken: string };
} => Boolean(settings.spotify.clientId && settings.spotify.refreshToken);

export const credentialsFromSettings = (settings: WallpaperSettings): SpotifyCredentials | null => {
  if (!hasSpotifyCredentials(settings)) {
    return null;
  }

  return {
    clientId: settings.spotify.clientId,
    refreshToken: settings.spotify.refreshToken
  };
};

export const nextPollingDelayMs = ({ playback, error, consecutiveErrors = 0, settings }: PollDecisionInput): number => {
  if (error?.kind === 'rate_limited' && error.retryAfterMs !== undefined) {
    return Math.max(error.retryAfterMs, DEFAULT_PLAYING_INTERVAL_MS);
  }

  if (error) {
    const multiplier = Math.max(1, consecutiveErrors + 1);
    return Math.min(DEFAULT_ERROR_BACKOFF_MS * multiplier, MAX_ERROR_BACKOFF_MS);
  }

  if (playback?.isPlaying) {
    return clampInterval(settings?.spotify.pollIntervalPlayingMs, DEFAULT_PLAYING_INTERVAL_MS);
  }

  return clampInterval(settings?.spotify.pollIntervalPausedMs, DEFAULT_PAUSED_INTERVAL_MS);
};

const clampInterval = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, 500), 60_000);
};
