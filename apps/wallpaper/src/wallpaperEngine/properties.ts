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
  const backgroundMode = stringProperty(properties, 'background_mode');
  const themeMode = stringProperty(properties, 'theme_mode');
  const albumArtVisible = booleanProperty(properties, 'album_art_visible');
  const textVisible = booleanProperty(properties, 'track_text_visible');
  const playerVisible = booleanProperty(properties, 'player_visible');
  const playerControlsEnabled = booleanProperty(properties, 'player_controls_enabled');
  const playerShowDevice = booleanProperty(properties, 'player_show_device');
  const playerShowVolume = booleanProperty(properties, 'player_show_volume');
  const playerShowShuffleRepeat = booleanProperty(properties, 'player_show_shuffle_repeat');
  const seekbarVisible = booleanProperty(properties, 'seekbar_visible');
  const seekbarStyle = stringProperty(properties, 'seekbar_style');
  const visualizerEnabled = booleanProperty(properties, 'visualizer_enabled');
  const visualizerMode = stringProperty(properties, 'visualizer_mode');
  const lyricsEnabled = booleanProperty(properties, 'lyrics_enabled');
  const lyricsMode = stringProperty(properties, 'lyrics_mode');
  const transitionsEnabled = booleanProperty(properties, 'transitions_enabled');
  const transitionPreset = stringProperty(properties, 'transition_preset');
  const clockEnabled = booleanProperty(properties, 'clock_enabled');
  const clockHour12 = booleanProperty(properties, 'clock_hour12');
  const clockShowSeconds = booleanProperty(properties, 'clock_show_seconds');
  const clockShowDate = booleanProperty(properties, 'clock_show_date');
  const clockShowWeekday = booleanProperty(properties, 'clock_show_weekday');
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

  if (backgroundMode === 'album-blur' || backgroundMode === 'album-gradient' || backgroundMode === 'solid-color') {
    patch.background = { ...patch.background, mode: backgroundMode };
  }

  if (themeMode === 'album' || themeMode === 'fallback' || themeMode === 'custom') {
    patch.theme = { ...patch.theme, mode: themeMode };
  }

  if (albumArtVisible !== undefined) {
    patch.albumArt = { ...patch.albumArt, visible: albumArtVisible };
  }

  if (textVisible !== undefined) {
    patch.text = { ...patch.text, visible: textVisible };
  }

  if (
    playerVisible !== undefined ||
    playerControlsEnabled !== undefined ||
    playerShowDevice !== undefined ||
    playerShowVolume !== undefined ||
    playerShowShuffleRepeat !== undefined
  ) {
    patch.player = {
      ...patch.player,
      ...(playerVisible !== undefined ? { visible: playerVisible } : {}),
      ...(playerControlsEnabled !== undefined ? { controlsEnabled: playerControlsEnabled } : {}),
      ...(playerShowDevice !== undefined ? { showDevice: playerShowDevice } : {}),
      ...(playerShowVolume !== undefined ? { showVolume: playerShowVolume } : {}),
      ...(playerShowShuffleRepeat !== undefined ? { showShuffleRepeat: playerShowShuffleRepeat } : {})
    };
  }

  if (seekbarVisible !== undefined || seekbarStyle === 'line' || seekbarStyle === 'album-ring') {
    patch.seekbar = {
      ...patch.seekbar,
      ...(seekbarVisible !== undefined ? { visible: seekbarVisible } : {}),
      ...(seekbarStyle === 'line' || seekbarStyle === 'album-ring' ? { style: seekbarStyle } : {})
    };
  }

  if (visualizerEnabled !== undefined) {
    patch.visualizer = { ...patch.visualizer, enabled: visualizerEnabled };
  }

  if (visualizerMode === 'album-ring' || visualizerMode === 'radial-bars' || visualizerMode === 'waveform-line') {
    patch.visualizer = { ...patch.visualizer, mode: visualizerMode };
  }

  if (lyricsEnabled !== undefined) {
    patch.lyrics = { ...patch.lyrics, enabled: lyricsEnabled };
  }

  if (lyricsMode === 'current' || lyricsMode === 'context') {
    patch.lyrics = { ...patch.lyrics, mode: lyricsMode };
  }

  if (transitionsEnabled !== undefined) {
    patch.transitions = { ...patch.transitions, enabled: transitionsEnabled };
  }

  if (
    transitionPreset === 'fade' ||
    transitionPreset === 'crossfade' ||
    transitionPreset === 'slide-left' ||
    transitionPreset === 'zoom-in' ||
    transitionPreset === 'blur-fade'
  ) {
    patch.transitions = { ...patch.transitions, preset: transitionPreset };
  }

  if (
    clockEnabled !== undefined ||
    clockHour12 !== undefined ||
    clockShowSeconds !== undefined ||
    clockShowDate !== undefined ||
    clockShowWeekday !== undefined
  ) {
    patch.clock = {
      ...patch.clock,
      ...(clockEnabled !== undefined ? { enabled: clockEnabled } : {}),
      ...(clockHour12 !== undefined ? { hour12: clockHour12 } : {}),
      ...(clockShowSeconds !== undefined ? { showSeconds: clockShowSeconds } : {}),
      ...(clockShowDate !== undefined ? { showDate: clockShowDate } : {}),
      ...(clockShowWeekday !== undefined ? { showWeekday: clockShowWeekday } : {})
    };
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
  patch.player = { ...patch.player, ...settings.player };
  patch.seekbar = { ...patch.seekbar, ...settings.seekbar };
  patch.lyrics = { ...patch.lyrics, ...settings.lyrics };
  patch.visualizer = { ...patch.visualizer, ...settings.visualizer };
  patch.clock = { ...patch.clock, ...settings.clock };
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
