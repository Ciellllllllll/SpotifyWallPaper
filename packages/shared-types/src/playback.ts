export type PlaybackSource = 'mock' | 'spotify';

export type PlaybackItemType = 'track' | 'episode' | 'none';

export type SpotifyRepeatState = 'off' | 'track' | 'context';

export type SpotifyErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'network_error'
  | 'unavailable'
  | 'unknown_response_shape'
  | 'item_null';

export interface SpotifyPlaybackError {
  kind: SpotifyErrorKind;
  message: string;
  retryAfterMs?: number;
  status?: number;
}

export interface PlaybackDeviceState {
  id: string | null;
  name: string | null;
  type: string | null;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
}

export interface NormalizedPlayback {
  source: PlaybackSource;
  itemType: PlaybackItemType;
  id: string | null;
  uri: string | null;
  title: string;
  artists: string[];
  albumName: string;
  imageUrls: string[];
  albumImageUrl: string;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
  device: PlaybackDeviceState | null;
  deviceName: string | null;
  shuffleState: boolean | null;
  repeatState: SpotifyRepeatState | null;
  volumePercent: number | null;
  externalUrl: string | null;
  fetchedAt: string;
}
