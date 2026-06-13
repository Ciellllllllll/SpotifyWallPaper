import type { LayoutItem, LayoutPresetName, WallpaperSettings } from '@spotify-wallpaper/shared-types';

export interface ConfiguratorDraft {
  appName: string;
  spotifyClientId: string;
  spotifyRefreshToken: string;
  includeRefreshToken: boolean;
  preset: LayoutPresetName;
  backgroundMode: WallpaperSettings['background']['mode'];
  themeMode: WallpaperSettings['theme']['mode'];
  lyricsEnabled: boolean;
  visualizerEnabled: boolean;
  transitionEnabled: boolean;
  clockEnabled: boolean;
  clockShowSeconds: boolean;
  playerControlsEnabled: boolean;
  performanceMode: WallpaperSettings['performance']['mode'];
  debugEnabled: boolean;
}

export const layoutPresetOptions: LayoutPresetName[] = [
  'Minimal',
  'Center Album',
  'Lyrics Focus',
  'Visualizer Heavy',
  'Rainmeter Hybrid',
  'Left Dock',
  'Bottom Player',
  'Clock Focus',
  'Album Ring',
  'Ambient Background'
];

const item = (partial: Partial<LayoutItem>): LayoutItem => ({
  enabled: true,
  x: 50,
  y: 50,
  unit: 'percent',
  anchor: 'center',
  width: 360,
  height: 120,
  scale: 1,
  rotation: 0,
  opacity: 1,
  zIndex: 2,
  responsive: 'clamp-safe-area',
  safeAreaMargin: 20,
  locked: false,
  participatesInTransition: true,
  ...partial
});

export const defaultDraft: ConfiguratorDraft = {
  appName: 'Spotify Wallpaper',
  spotifyClientId: '',
  spotifyRefreshToken: '',
  includeRefreshToken: false,
  preset: 'Left Dock',
  backgroundMode: 'album-blur',
  themeMode: 'album',
  lyricsEnabled: false,
  visualizerEnabled: true,
  transitionEnabled: false,
  clockEnabled: true,
  clockShowSeconds: false,
  playerControlsEnabled: true,
  performanceMode: 'standard',
  debugEnabled: false
};

export const buildSettings = (draft: ConfiguratorDraft): WallpaperSettings => ({
  schemaVersion: 1,
  spotify: {
    clientId: draft.spotifyClientId.trim(),
    ...(draft.includeRefreshToken && draft.spotifyRefreshToken.trim()
      ? { refreshToken: draft.spotifyRefreshToken.trim() }
      : {}),
    hasRefreshToken: draft.includeRefreshToken && draft.spotifyRefreshToken.trim().length > 0,
    pollIntervalPlayingMs: 1000,
    pollIntervalPausedMs: 3000
  },
  layout: {
    preset: draft.preset,
    items: presetItems(draft.preset)
  },
  theme: {
    mode: draft.themeMode,
    textColor: '#f6f7fb',
    autoReadability: true
  },
  background: {
    mode: draft.backgroundMode,
    opacity: 0.72,
    blurPx: draft.performanceMode === 'low-power' ? 12 : 26,
    solidColor: '#111318'
  },
  albumArt: {
    visible: true
  },
  text: {
    visible: true
  },
  player: {
    visible: true,
    controlsEnabled: draft.playerControlsEnabled,
    showDevice: true,
    showVolume: true,
    showShuffleRepeat: true
  },
  seekbar: {
    visible: true,
    style: draft.preset === 'Album Ring' ? 'album-ring' : 'line'
  },
  lyrics: {
    enabled: draft.lyricsEnabled,
    sourceText: '',
    mode: 'current',
    offsetMs: 0,
    showMissingState: true,
    provider: {
      name: 'user-lrc',
      searchInputs: {
        title: true,
        artists: true,
        album: true,
        duration: true
      },
      supportsSynced: true,
      supportsPlain: false,
      cachePolicy: 'none',
      failureReason: 'not-configured'
    }
  },
  visualizer: {
    enabled: draft.visualizerEnabled,
    mode: 'album-ring',
    intensity: draft.performanceMode === 'high-effect' ? 1.05 : 0.72,
    sensitivity: 1,
    smoothing: 0.35,
    decay: 0.22,
    bassWeight: 1.2,
    midWeight: 1,
    trebleWeight: 0.82,
    barCount: draft.performanceMode === 'low-power' ? 32 : 56,
    lineWidth: 3,
    radius: 1.18,
    gap: 10,
    rotationSpeed: draft.performanceMode === 'low-power' ? 0.06 : 0.16,
    particleCount: 0,
    particleLife: 0,
    glowStrength: draft.performanceMode === 'low-power' ? 0.36 : 0.62,
    colorMode: 'theme',
    mirrorMode: 'mirror',
    clampMax: 1,
    noiseGate: 0.03,
    idleAnimation: true
  },
  clock: {
    enabled: draft.clockEnabled,
    hour12: false,
    showSeconds: draft.clockShowSeconds,
    showDate: false,
    showWeekday: false,
    fontSizePx: 34,
    fontWeight: 700,
    letterSpacingPx: 0,
    opacity: 0.9,
    colorMode: 'auto',
    fixedColor: '#f6f7fb'
  },
  transitions: {
    enabled: draft.transitionEnabled,
    preset: 'fade',
    durationMs: 700,
    easing: 'ease-out',
    background: true,
    albumArt: true,
    text: true,
    lyrics: true,
    visualizer: false,
    reduceMotion: false
  },
  performance: {
    mode: draft.performanceMode
  },
  rainmeter: {
    enabled: false
  },
  debug: {
    enabled: draft.debugEnabled
  }
});

export const exportSettingsJson = (draft: ConfiguratorDraft): string => JSON.stringify(buildSettings(draft), null, 2);

export const importSettingsJson = (source: string): { draft: ConfiguratorDraft; warning: string | null } => {
  try {
    const parsed = JSON.parse(source) as Partial<WallpaperSettings>;
    return {
      draft: {
        ...defaultDraft,
        spotifyClientId: stringOr(parsed.spotify?.clientId, ''),
        spotifyRefreshToken: stringOr(parsed.spotify?.refreshToken, ''),
        includeRefreshToken: false,
        preset: oneOf(parsed.layout?.preset, layoutPresetOptions, defaultDraft.preset),
        backgroundMode: oneOf(
          parsed.background?.mode,
          ['album-blur', 'album-gradient', 'solid-color'] as const,
          defaultDraft.backgroundMode
        ),
        themeMode: oneOf(parsed.theme?.mode, ['album', 'fallback', 'custom'] as const, defaultDraft.themeMode),
        lyricsEnabled: booleanOr(parsed.lyrics?.enabled, defaultDraft.lyricsEnabled),
        visualizerEnabled: booleanOr(parsed.visualizer?.enabled, defaultDraft.visualizerEnabled),
        transitionEnabled: booleanOr(parsed.transitions?.enabled, defaultDraft.transitionEnabled),
        clockEnabled: booleanOr(parsed.clock?.enabled, defaultDraft.clockEnabled),
        clockShowSeconds: booleanOr(parsed.clock?.showSeconds, defaultDraft.clockShowSeconds),
        playerControlsEnabled: booleanOr(parsed.player?.controlsEnabled, defaultDraft.playerControlsEnabled),
        performanceMode: oneOf(parsed.performance?.mode, ['low-power', 'standard', 'high-effect'] as const, defaultDraft.performanceMode),
        debugEnabled: booleanOr(parsed.debug?.enabled, defaultDraft.debugEnabled)
      },
      warning: null
    };
  } catch {
    return {
      draft: defaultDraft,
      warning: 'Import JSON was malformed; defaults remain active.'
    };
  }
};

const presetItems = (preset: LayoutPresetName): WallpaperSettings['layout']['items'] => ({
  albumArt: item(albumArtForPreset(preset)),
  trackText: item(trackTextForPreset(preset)),
  seekbar: item(seekbarForPreset(preset)),
  lyrics: item(preset === 'Lyrics Focus' ? { x: 62, y: 50, anchor: 'center', width: 720, height: 340, zIndex: 4 } : { x: 68, y: 50, anchor: 'center', width: 560, height: 240 }),
  clock: item(preset === 'Clock Focus' ? { x: 50, y: 45, anchor: 'center', width: 520, height: 160, scale: 1.8, participatesInTransition: false } : { x: 96, y: 94, anchor: 'bottom-right', width: 220, height: 72, participatesInTransition: false }),
  debug: item({ x: 98.8, y: 2, anchor: 'top-right', width: 280, height: 240, zIndex: 5, locked: true, participatesInTransition: false })
});

const albumArtForPreset = (preset: LayoutPresetName): Partial<LayoutItem> => {
  if (preset === 'Bottom Player') return { x: 4, y: 92, anchor: 'bottom-left', width: 150, height: 150 };
  if (preset === 'Ambient Background') return { enabled: false, x: 50, y: 50, width: 360, height: 360 };
  if (preset === 'Album Ring') return { x: 50, y: 48, anchor: 'center', width: 360, height: 360 };
  if (preset === 'Center Album') return { x: 50, y: 42, anchor: 'center', width: 380, height: 380 };
  if (preset === 'Minimal') return { x: 50, y: 42, anchor: 'center', width: 300, height: 300 };
  return { x: 8, y: 50, anchor: 'center-left', width: 360, height: 360, zIndex: 2 };
};

const trackTextForPreset = (preset: LayoutPresetName): Partial<LayoutItem> => {
  if (preset === 'Bottom Player') return { x: 16, y: 91, anchor: 'bottom-left', width: 620, height: 120 };
  if (preset === 'Ambient Background') return { x: 50, y: 52, anchor: 'center', width: 680, height: 240 };
  if (preset === 'Album Ring') return { x: 50, y: 80, anchor: 'center', width: 600, height: 160 };
  if (preset === 'Center Album') return { x: 50, y: 73, anchor: 'center', width: 640, height: 180 };
  if (preset === 'Minimal') return { x: 50, y: 72, anchor: 'center', width: 560, height: 170 };
  return { x: 34, y: 48, anchor: 'center-left', width: 520, height: 260, zIndex: 3 };
};

const seekbarForPreset = (preset: LayoutPresetName): Partial<LayoutItem> => {
  if (preset === 'Bottom Player') return { x: 50, y: 97, anchor: 'bottom-center', width: 760, height: 36 };
  if (preset === 'Album Ring') return { x: 50, y: 89, anchor: 'center', width: 480, height: 44 };
  if (preset === 'Minimal') return { x: 50, y: 84, anchor: 'center', width: 460, height: 44 };
  return { x: 34, y: 68, anchor: 'center-left', width: 420, height: 44, zIndex: 3 };
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;

const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
const booleanOr = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
