import type {
  PlaybackProvider,
  ProviderConfigurationError,
  ProviderSelection
} from '@spotify-wallpaper/shared-types';
import type { Fetcher, SpotifyPlaybackCommand, SpotifyResult } from '../types';

export type { PlaybackProvider, ProviderConfigurationError, ProviderSelection };

export interface BackendPlaybackProviderConfig {
  backendUrl: string;
  pairingToken: string;
}

export type ProviderFetcher = Fetcher;
export type ProviderCommand = SpotifyPlaybackCommand;
