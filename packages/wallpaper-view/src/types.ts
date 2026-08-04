import type {
  NormalizedPlayback,
  VisualizerFrame,
  WallpaperPreferences,
  WallpaperTheme
} from '@spotify-wallpaper/shared-types';

export interface WallpaperViewTransition {
  previous: NormalizedPlayback;
  current: NormalizedPlayback;
  durationMs: number;
  easing: string;
  resolvedPreset: string;
}

export interface WallpaperViewModel {
  settings: WallpaperPreferences;
  playback: NormalizedPlayback;
  previousPlayback: NormalizedPlayback | null;
  visualizerFrame: VisualizerFrame | null;
  theme: WallpaperTheme;
  transitionState: WallpaperViewTransition | null;
  nowMs: number;
  progressNowMs: number;
  playbackMode: string;
  providerSelection: 'mock' | 'ready' | 'invalid';
  providerConfigurationError: string | null;
  spotifyStatusText: string;
  controlStatusText: string;
  controlBusy: boolean;
  canControlPlayback: boolean;
  lastPollingDelayMs: number | null;
  consecutiveErrors: number;
  visualCoreStatus: string;
  credentialConfigured: boolean;
  settingsWarning: string | null;
  settingsSource: string;
}

export type WallpaperViewIntent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; volumePercent: number }
  | { type: 'shuffle'; state: boolean }
  | { type: 'repeat'; state: 'off' | 'track' | 'context' }
  | { type: 'toggle-display-mode' };
