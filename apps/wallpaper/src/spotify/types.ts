import type { SpotifyPlaybackError } from '@spotify-wallpaper/shared-types';

export interface SpotifyTokenState {
  accessToken: string;
  expiresAtMs: number;
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
    }
  | {
      ok: false;
      error: SpotifyPlaybackError;
    };

export interface SpotifyImage {
  url?: unknown;
  height?: unknown;
  width?: unknown;
}

export interface SpotifyDevice {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  is_active?: unknown;
  is_restricted?: unknown;
  volume_percent?: unknown;
}

export interface SpotifyPlaybackResponse {
  item?: unknown;
  progress_ms?: unknown;
  is_playing?: unknown;
  device?: unknown;
  shuffle_state?: unknown;
  repeat_state?: unknown;
}
