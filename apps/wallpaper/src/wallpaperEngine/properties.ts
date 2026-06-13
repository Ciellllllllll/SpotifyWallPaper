import type { WallpaperSettings } from '@spotify-wallpaper/shared-types';
import { clonePresetItems, isLayoutPresetName } from '../layout/presets';
import { loadSettings } from '../settings/loadSettings';
import { repairSettings } from '../settings/repairSettings';
import type { SettingsPatch, WallpaperEngineProperties, WallpaperPropertyResult } from './types';

export const parseWallpaperProperties = (properties: WallpaperEngineProperties): WallpaperPropertyResult => {
  const patch: SettingsPatch = {};
  let warning: string | null = null;

  const clientId = stringProperty(properties, 'spotify_client_id');
  const refreshToken = stringProperty(properties, 'spotify_refresh_token');
  const settingsJson = stringProperty(properties, 'settings_json');
  const selectedPreset = stringProperty(properties, 'selected_preset');
  const visualizerEnabled = booleanProperty(properties, 'visualizer_enabled');
  const lyricsEnabled = booleanProperty(properties, 'lyrics_enabled');
  const performanceMode = stringProperty(properties, 'performance_mode');
  const debugEnabled = booleanProperty(properties, 'debug_enabled');

  if (settingsJson) {
    const loaded = loadSettings(settingsJson);
    patchFromSettings(patch, loaded.settings);
    warning = loaded.warning;
  }

  if (clientId !== undefined || refreshToken !== undefined) {
    patch.spotify = {
      ...patch.spotify,
      ...(clientId !== undefined ? { clientId } : {}),
      ...(refreshToken !== undefined ? { refreshToken, hasRefreshToken: refreshToken.length > 0 } : {})
    };
  }

  if (selectedPreset !== undefined) {
    patch.layout = isLayoutPresetName(selectedPreset)
      ? { ...patch.layout, preset: selectedPreset, items: clonePresetItems(selectedPreset) }
      : patch.layout;
  }

  if (visualizerEnabled !== undefined) {
    patch.visualizer = { ...patch.visualizer, enabled: visualizerEnabled };
  }

  if (lyricsEnabled !== undefined) {
    patch.lyrics = { ...patch.lyrics, enabled: lyricsEnabled };
  }

  if (performanceMode === 'low-power' || performanceMode === 'standard' || performanceMode === 'high-effect') {
    patch.performance = { ...patch.performance, mode: performanceMode };
  }

  if (debugEnabled !== undefined) {
    patch.debug = { ...patch.debug, enabled: debugEnabled };
  }

  return { patch, warning };
};

export const applySettingsPatch = (settings: WallpaperSettings, patch: SettingsPatch): WallpaperSettings =>
  repairSettings({
    ...settings,
    schemaVersion: patch.schemaVersion ?? settings.schemaVersion,
    spotify: {
      ...settings.spotify,
      ...patch.spotify
    },
    layout: {
      ...settings.layout,
      ...patch.layout
    },
    theme: {
      ...settings.theme,
      ...patch.theme
    },
    background: {
      ...settings.background,
      ...patch.background
    },
    albumArt: {
      ...settings.albumArt,
      ...patch.albumArt
    },
    text: {
      ...settings.text,
      ...patch.text
    },
    player: {
      ...settings.player,
      ...patch.player
    },
    seekbar: {
      ...settings.seekbar,
      ...patch.seekbar
    },
    lyrics: {
      ...settings.lyrics,
      ...patch.lyrics
    },
    visualizer: {
      ...settings.visualizer,
      ...patch.visualizer
    },
    clock: {
      ...settings.clock,
      ...patch.clock
    },
    transitions: {
      ...settings.transitions,
      ...patch.transitions
    },
    performance: {
      ...settings.performance,
      ...patch.performance
    },
    rainmeter: {
      ...settings.rainmeter,
      ...patch.rainmeter
    },
    debug: {
      ...settings.debug,
      ...patch.debug
    }
  }).settings;

export const registerWallpaperPropertyListener = (
  onProperties: (result: WallpaperPropertyResult) => void,
  target: Window = window
): void => {
  target.wallpaperPropertyListener = {
    applyUserProperties: (properties) => {
      onProperties(parseWallpaperProperties(properties));
    }
  };
};

const patchFromSettings = (patch: SettingsPatch, settings: WallpaperSettings): void => {
  patch.spotify = { ...patch.spotify, ...settings.spotify };
  patch.layout = { ...patch.layout, ...settings.layout };
  patch.theme = { ...patch.theme, ...settings.theme };
  patch.background = { ...patch.background, ...settings.background };
  patch.lyrics = { ...patch.lyrics, ...settings.lyrics };
  patch.visualizer = { ...patch.visualizer, ...settings.visualizer };
  patch.transitions = { ...patch.transitions, ...settings.transitions };
  patch.performance = { ...patch.performance, ...settings.performance };
  patch.debug = { ...patch.debug, ...settings.debug };
};

const stringProperty = (properties: WallpaperEngineProperties, key: string): string | undefined => {
  const value = properties[key]?.value;
  return typeof value === 'string' ? value : undefined;
};

const booleanProperty = (properties: WallpaperEngineProperties, key: string): boolean | undefined => {
  const value = properties[key]?.value;
  return typeof value === 'boolean' ? value : undefined;
};
