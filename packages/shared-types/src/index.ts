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

export type LayoutUnit = 'percent' | 'px' | 'vw' | 'vh';

export type LayoutAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type LayoutItemKey = 'albumArt' | 'trackText' | 'seekbar' | 'lyrics' | 'clock' | 'debug';

export type LayoutPresetName =
  | 'Minimal'
  | 'Center Album'
  | 'Lyrics Focus'
  | 'Visualizer Heavy'
  | 'Rainmeter Hybrid'
  | 'Left Dock'
  | 'Bottom Player'
  | 'Clock Focus'
  | 'Album Ring'
  | 'Ambient Background';

export interface LayoutItem {
  enabled: boolean;
  x: number;
  y: number;
  unit: LayoutUnit;
  anchor: LayoutAnchor;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  responsive: 'none' | 'clamp-safe-area';
  safeAreaMargin: number;
  locked: boolean;
  participatesInTransition: boolean;
}

export interface WallpaperSettings {
  schemaVersion: number;
  spotify: {
    clientId: string;
    refreshToken?: string;
    hasRefreshToken: boolean;
    pollIntervalPlayingMs?: number;
    pollIntervalPausedMs?: number;
  };
  layout: {
    preset: LayoutPresetName;
    items: Record<LayoutItemKey, LayoutItem>;
  };
  theme: {
    mode: 'album' | 'fallback' | 'custom';
    textColor: string;
    autoReadability: boolean;
    customPrimaryColor?: string;
  };
  background: {
    mode: 'album-blur' | 'album-gradient' | 'solid-color';
    opacity: number;
    blurPx: number;
    solidColor: string;
  };
  albumArt: {
    visible: boolean;
  };
  text: {
    visible: boolean;
  };
  player: {
    visible: boolean;
  };
  seekbar: {
    visible: boolean;
  };
  lyrics: {
    enabled: boolean;
    sourceText: string;
    mode: 'current' | 'context';
    offsetMs: number;
    showMissingState: boolean;
    provider: LyricsProviderConfig;
  };
  visualizer: {
    enabled: boolean;
    mode: 'album-ring' | 'radial-bars' | 'waveform-line';
    intensity: number;
    sensitivity: number;
    smoothing: number;
    decay: number;
    bassWeight: number;
    midWeight: number;
    trebleWeight: number;
    barCount: number;
    lineWidth: number;
    radius: number;
    gap: number;
    rotationSpeed: number;
    particleCount: number;
    particleLife: number;
    glowStrength: number;
    colorMode: 'theme' | 'accent' | 'white';
    mirrorMode: 'none' | 'mirror';
    clampMax: number;
    noiseGate: number;
    idleAnimation: boolean;
  };
  clock: {
    enabled: boolean;
    hour12: boolean;
    showSeconds: boolean;
    showDate: boolean;
    showWeekday: boolean;
  };
  transitions: {
    enabled: boolean;
  };
  performance: {
    mode: 'low-power' | 'standard' | 'high-effect';
  };
  rainmeter: {
    enabled: boolean;
  };
  debug: {
    enabled: boolean;
  };
}

export type VisualizerSource = 'wallpaper-engine' | 'mock' | 'idle' | 'disabled';

export interface VisualizerFrame {
  source: VisualizerSource;
  samples: number[];
  bass: number;
  mid: number;
  treble: number;
  peak: number;
  timestampMs: number;
}

export interface WallpaperTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  mutedColor: string;
  darkColor: string;
  lightColor: string;
  readableTextColor: string;
  overlayOpacity: number;
  shadowStrength: number;
  source: 'extracted' | 'fallback';
}

export interface LyricsProviderConfig {
  name: 'user-lrc';
  searchInputs: {
    title: boolean;
    artists: boolean;
    album: boolean;
    duration: boolean;
  };
  supportsSynced: boolean;
  supportsPlain: boolean;
  cachePolicy: 'none' | 'memory' | 'persistent';
  failureReason: 'not-configured' | 'not-found' | 'invalid-lrc' | 'provider-error' | null;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}
