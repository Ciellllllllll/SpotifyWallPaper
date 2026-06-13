import type { WallpaperSettings } from '@spotify-wallpaper/shared-types';
import { clonePresetItems, defaultLayoutPreset, isLayoutPresetName } from '../layout/presets';
import { defaultSettings } from './defaultSettings';
import { repairSettings } from './repairSettings';

const SETTINGS_GLOBAL = '__SPOTIFY_WALLPAPER_SETTINGS__';
const SETTINGS_STORAGE_KEY = 'spotify-wallpaper-settings';

declare global {
  interface Window {
    __SPOTIFY_WALLPAPER_SETTINGS__?: unknown;
  }
}

export interface LoadedSettings {
  settings: WallpaperSettings;
  warning: string | null;
}

export const loadSettings = (source: unknown = readDefaultSettingsSource()): LoadedSettings => {
  if (source === undefined || source === null || source === '') {
    return { settings: defaultSettings, warning: null };
  }

  const parsed = typeof source === 'string' ? parseJson(source) : source;
  if (!parsed || typeof parsed !== 'object') {
    return { settings: defaultSettings, warning: 'Settings were malformed; defaults are active.' };
  }

  const record = parsed as Record<string, unknown>;
  const spotify = record.spotify && typeof record.spotify === 'object' ? (record.spotify as Record<string, unknown>) : {};
  const layout = record.layout && typeof record.layout === 'object' ? (record.layout as Record<string, unknown>) : {};
  const theme = record.theme && typeof record.theme === 'object' ? (record.theme as Record<string, unknown>) : {};
  const background = record.background && typeof record.background === 'object' ? (record.background as Record<string, unknown>) : {};
  const lyrics = record.lyrics && typeof record.lyrics === 'object' ? (record.lyrics as Record<string, unknown>) : {};
  const visualizer = record.visualizer && typeof record.visualizer === 'object' ? (record.visualizer as Record<string, unknown>) : {};
  const clock = record.clock && typeof record.clock === 'object' ? (record.clock as Record<string, unknown>) : {};
  const transitions = record.transitions && typeof record.transitions === 'object' ? (record.transitions as Record<string, unknown>) : {};
  const performance = record.performance && typeof record.performance === 'object' ? (record.performance as Record<string, unknown>) : {};
  const debug = record.debug && typeof record.debug === 'object' ? (record.debug as Record<string, unknown>) : {};
  const preset = isLayoutPresetName(layout.preset) ? layout.preset : defaultLayoutPreset;

  return repairSettings({
    ...defaultSettings,
    schemaVersion: numberOr(record.schemaVersion, defaultSettings.schemaVersion) ?? defaultSettings.schemaVersion,
    spotify: {
      ...defaultSettings.spotify,
      clientId: stringOr(spotify.clientId, defaultSettings.spotify.clientId),
      refreshToken: stringOrUndefined(spotify.refreshToken),
      hasRefreshToken: Boolean(spotify.refreshToken) || Boolean(spotify.hasRefreshToken),
      pollIntervalPlayingMs: numberOr(spotify.pollIntervalPlayingMs, defaultSettings.spotify.pollIntervalPlayingMs),
      pollIntervalPausedMs: numberOr(spotify.pollIntervalPausedMs, defaultSettings.spotify.pollIntervalPausedMs)
    },
    layout: {
      ...defaultSettings.layout,
      preset,
      items:
        layout.items && typeof layout.items === 'object'
          ? (layout.items as WallpaperSettings['layout']['items'])
          : clonePresetItems(preset)
    },
    theme: {
      ...defaultSettings.theme,
      mode: stringOr(theme.mode, defaultSettings.theme.mode) as WallpaperSettings['theme']['mode'],
      textColor: stringOr(theme.textColor, defaultSettings.theme.textColor),
      customPrimaryColor: stringOrUndefined(theme.customPrimaryColor),
      autoReadability: booleanOr(theme.autoReadability, defaultSettings.theme.autoReadability)
    },
    background: {
      ...defaultSettings.background,
      mode: stringOr(background.mode, defaultSettings.background.mode) as WallpaperSettings['background']['mode'],
      opacity: numberOr(background.opacity, defaultSettings.background.opacity) ?? defaultSettings.background.opacity,
      blurPx: numberOr(background.blurPx, defaultSettings.background.blurPx) ?? defaultSettings.background.blurPx,
      solidColor: stringOr(background.solidColor, defaultSettings.background.solidColor)
    },
    lyrics: {
      ...defaultSettings.lyrics,
      enabled: booleanOr(lyrics.enabled, defaultSettings.lyrics.enabled),
      sourceText: stringOr(lyrics.sourceText, defaultSettings.lyrics.sourceText),
      mode: stringOr(lyrics.mode, defaultSettings.lyrics.mode) as WallpaperSettings['lyrics']['mode'],
      offsetMs: numberOr(lyrics.offsetMs, defaultSettings.lyrics.offsetMs) ?? defaultSettings.lyrics.offsetMs,
      showMissingState: booleanOr(lyrics.showMissingState, defaultSettings.lyrics.showMissingState),
      provider: {
        ...defaultSettings.lyrics.provider,
        ...(lyrics.provider && typeof lyrics.provider === 'object' ? (lyrics.provider as WallpaperSettings['lyrics']['provider']) : {})
      }
    },
    visualizer: {
      ...defaultSettings.visualizer,
      enabled: booleanOr(visualizer.enabled, defaultSettings.visualizer.enabled),
      mode: stringOr(visualizer.mode, defaultSettings.visualizer.mode) as WallpaperSettings['visualizer']['mode'],
      intensity: numberOr(visualizer.intensity, defaultSettings.visualizer.intensity) ?? defaultSettings.visualizer.intensity,
      sensitivity:
        numberOr(visualizer.sensitivity, defaultSettings.visualizer.sensitivity) ?? defaultSettings.visualizer.sensitivity,
      smoothing: numberOr(visualizer.smoothing, defaultSettings.visualizer.smoothing) ?? defaultSettings.visualizer.smoothing,
      decay: numberOr(visualizer.decay, defaultSettings.visualizer.decay) ?? defaultSettings.visualizer.decay,
      bassWeight: numberOr(visualizer.bassWeight, defaultSettings.visualizer.bassWeight) ?? defaultSettings.visualizer.bassWeight,
      midWeight: numberOr(visualizer.midWeight, defaultSettings.visualizer.midWeight) ?? defaultSettings.visualizer.midWeight,
      trebleWeight:
        numberOr(visualizer.trebleWeight, defaultSettings.visualizer.trebleWeight) ?? defaultSettings.visualizer.trebleWeight,
      barCount: numberOr(visualizer.barCount, defaultSettings.visualizer.barCount) ?? defaultSettings.visualizer.barCount,
      lineWidth: numberOr(visualizer.lineWidth, defaultSettings.visualizer.lineWidth) ?? defaultSettings.visualizer.lineWidth,
      radius: numberOr(visualizer.radius, defaultSettings.visualizer.radius) ?? defaultSettings.visualizer.radius,
      gap: numberOr(visualizer.gap, defaultSettings.visualizer.gap) ?? defaultSettings.visualizer.gap,
      rotationSpeed:
        numberOr(visualizer.rotationSpeed, defaultSettings.visualizer.rotationSpeed) ?? defaultSettings.visualizer.rotationSpeed,
      particleCount:
        numberOr(visualizer.particleCount, defaultSettings.visualizer.particleCount) ?? defaultSettings.visualizer.particleCount,
      particleLife:
        numberOr(visualizer.particleLife, defaultSettings.visualizer.particleLife) ?? defaultSettings.visualizer.particleLife,
      glowStrength:
        numberOr(visualizer.glowStrength, defaultSettings.visualizer.glowStrength) ?? defaultSettings.visualizer.glowStrength,
      colorMode: stringOr(visualizer.colorMode, defaultSettings.visualizer.colorMode) as WallpaperSettings['visualizer']['colorMode'],
      mirrorMode: stringOr(visualizer.mirrorMode, defaultSettings.visualizer.mirrorMode) as WallpaperSettings['visualizer']['mirrorMode'],
      clampMax: numberOr(visualizer.clampMax, defaultSettings.visualizer.clampMax) ?? defaultSettings.visualizer.clampMax,
      noiseGate: numberOr(visualizer.noiseGate, defaultSettings.visualizer.noiseGate) ?? defaultSettings.visualizer.noiseGate,
      idleAnimation: booleanOr(visualizer.idleAnimation, defaultSettings.visualizer.idleAnimation)
    },
    clock: {
      ...defaultSettings.clock,
      hour12: booleanOr(clock.hour12, defaultSettings.clock.hour12),
      showSeconds: booleanOr(clock.showSeconds, defaultSettings.clock.showSeconds)
    },
    transitions: {
      ...defaultSettings.transitions,
      enabled: booleanOr(transitions.enabled, defaultSettings.transitions.enabled),
      preset: stringOr(transitions.preset, defaultSettings.transitions.preset) as WallpaperSettings['transitions']['preset'],
      durationMs:
        numberOr(transitions.durationMs, defaultSettings.transitions.durationMs) ?? defaultSettings.transitions.durationMs,
      easing: stringOr(transitions.easing, defaultSettings.transitions.easing) as WallpaperSettings['transitions']['easing'],
      background: booleanOr(transitions.background, defaultSettings.transitions.background),
      albumArt: booleanOr(transitions.albumArt, defaultSettings.transitions.albumArt),
      text: booleanOr(transitions.text, defaultSettings.transitions.text),
      lyrics: booleanOr(transitions.lyrics, defaultSettings.transitions.lyrics),
      visualizer: booleanOr(transitions.visualizer, defaultSettings.transitions.visualizer),
      reduceMotion: booleanOr(transitions.reduceMotion, defaultSettings.transitions.reduceMotion)
    },
    performance: {
      ...defaultSettings.performance,
      mode:
        performance.mode === 'low-power' || performance.mode === 'standard' || performance.mode === 'high-effect'
          ? performance.mode
          : defaultSettings.performance.mode
    },
    debug: {
      ...defaultSettings.debug,
      enabled: booleanOr(debug.enabled, defaultSettings.debug.enabled)
    }
  });
};

const readDefaultSettingsSource = (): unknown => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  if (window[SETTINGS_GLOBAL] !== undefined) {
    return window[SETTINGS_GLOBAL];
  }

  try {
    return window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

const parseJson = (source: string): unknown => {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
};

const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
const stringOrUndefined = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const numberOr = (value: unknown, fallback: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const booleanOr = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
