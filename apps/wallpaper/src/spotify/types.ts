import type { SpotifyPlaybackError } from '@spotify-wallpaper/shared-types';

export interface SpotifyTokenState {
  accessToken: string;
  expiresAtMs: number;
  refreshAtMs?: number;
  refreshToken?: string;
}

export interface SpotifyCredentials {
  clientId: string;
  refreshToken: string;
}

export type Fetcher = typeof fetch;

export type SpotifyResult<T> =
  | {
      ok: true;
      value: T;
      degraded?: SpotifyPlaybackError;
    }
  | {
      ok: false;
      error: SpotifyPlaybackError;
      /** Internal token endpoint classification, never derived from an API 401. */
      invalidGrant?: boolean;
    };

export interface SpotifyPlaybackResponse {
  item?: unknown;
  progress_ms?: unknown;
  is_playing?: unknown;
  device?: unknown;
  shuffle_state?: unknown;
  repeat_state?: unknown;
  currently_playing_type?: unknown;
}
