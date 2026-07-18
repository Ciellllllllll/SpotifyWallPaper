import type { NormalizedPlayback, SpotifyPlaybackError } from '@spotify-wallpaper/shared-types';

export type ApiResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: SpotifyPlaybackError;
    };

export type PlaybackResult = ApiResult<NormalizedPlayback>;
