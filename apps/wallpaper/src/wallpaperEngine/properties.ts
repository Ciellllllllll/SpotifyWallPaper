import type { LegacyWallpaperSettings as WallpaperSettings } from '@spotify-wallpaper/shared-types/legacy';
import { clonePresetItems, isLayoutPresetName } from '../layout/presets';
import { loadSettings } from '../settings/loadSettings';
import { repairSettings } from '../settings/repairSettings';
import { isWallpaperEngineSpotifyToken, parseWallpaperEngineSpotifyToken } from '../spotify/wallpaperEngineToken';
import type { SettingsPatch, WallpaperEngineProperties, WallpaperPropertyResult } from './types';

export const parseWallpaperProperties = (properties: WallpaperEngineProperties): WallpaperPropertyResult => {
  const patch: SettingsPatch = {};
  let warning: string | null = null;

  const clientId = stringProperty(properties, 'spotify_client_id');
  const refreshToken = stringProperty(properties, 'spotify_refresh_token');
  const playbackProvider = stringProperty(properties, 'spotify_playback_provider');
  const backendUrl = stringProperty(properties, 'spotify_backend_url');
  const pairingToken = stringProperty(properties, 'spotify_pairing_token');
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
    const spotifyClearPatch = spotifyCredentialClearPatchFromSettingsJson(settingsJson);
    if (spotifyClearPatch) {
      patch.spotify = { ...patch.spotify, ...spotifyClearPatch };
    }
    warning = loaded.warning;
  }

  if (
    playbackProvider === 'direct' ||
    playbackProvider === 'backend' ||
    backendUrl !== undefined ||
    pairingToken !== undefined
  ) {
    patch.spotify = {
      ...patch.spotify,
      ...(playbackProvider === 'direct' || playbackProvider === 'backend' ? { playbackProvider } : {}),
      ...(backendUrl !== undefined ? { backendUrl } : {}),
      ...(pairingToken !== undefined ? { pairingToken } : {})
    };
  }

  const bundledToken = refreshToken !== undefined ? parseWallpaperEngineSpotifyToken(refreshToken) : null;
  if (bundledToken) {
    patch.spotify = {
      ...patch.spotify,
      clientId: bundledToken.clientId,
      refreshToken: bundledToken.refreshToken,
      hasRefreshToken: true
    };
  } else if (refreshToken !== undefined && isWallpaperEngineSpotifyToken(refreshToken)) {
    patch.spotify = {
      ...patch.spotify,
      ...(clientId !== undefined ? { clientId } : {}),
      refreshToken: '',
      hasRefreshToken: false
    };
  } else if (clientId !== undefined || refreshToken !== undefined) {
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

export const applySettingsPatch = (settings: WallpaperSettings, patch: SettingsPatch): WallpaperSettings => {
  const spotifyPatch = normalizeSpotifyCredentialPatch(settings.spotify, patch.spotify);

  return repairSettings({
    ...settings,
    schemaVersion: patch.schemaVersion ?? settings.schemaVersion,
    spotify: {
      ...settings.spotify,
      ...spotifyPatch
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
};

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
  const spotifyPatch: Partial<WallpaperSettings['spotify']> = {};
  if (settings.spotify.clientId) {
    spotifyPatch.clientId = settings.spotify.clientId;
  }
  spotifyPatch.playbackProvider = settings.spotify.playbackProvider ?? 'direct';
  spotifyPatch.backendUrl = settings.spotify.backendUrl ?? '';
  if (settings.spotify.pairingToken) {
    spotifyPatch.pairingToken = settings.spotify.pairingToken;
  }
  if (settings.spotify.refreshToken) {
    spotifyPatch.refreshToken = settings.spotify.refreshToken;
    spotifyPatch.hasRefreshToken = true;
  }
  if (Object.keys(spotifyPatch).length > 0) {
    patch.spotify = { ...patch.spotify, ...spotifyPatch };
  }
  patch.layout = { ...patch.layout, ...settings.layout };
  patch.theme = { ...patch.theme, ...settings.theme };
  patch.background = { ...patch.background, ...settings.background };
  patch.player = { ...patch.player, ...settings.player };
  patch.seekbar = { ...patch.seekbar, ...settings.seekbar };
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

const normalizeSpotifyCredentialPatch = (
  current: WallpaperSettings['spotify'],
  patch: Partial<WallpaperSettings['spotify']> | undefined
): Partial<WallpaperSettings['spotify']> | undefined => {
  if (!patch) {
    return patch;
  }

  const next = { ...patch };
  const hasClientIdPatch = hasOwn(patch, 'clientId');
  const hasRefreshTokenPatch = hasOwn(patch, 'refreshToken');
  const clientIdChanged = hasClientIdPatch && patch.clientId !== current.clientId;
  const clientIdCleared = hasClientIdPatch && patch.clientId === '';

  if ((clientIdChanged || clientIdCleared) && !hasRefreshTokenPatch) {
    next.refreshToken = '';
    next.hasRefreshToken = false;
  }

  if (patch.playbackProvider === 'direct') {
    next.backendUrl = '';
    next.pairingToken = '';
  }

  return next;
};

const hasOwn = <T extends object>(target: T, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(target, key);

const spotifyCredentialClearPatchFromSettingsJson = (
  settingsJson: string
): Partial<WallpaperSettings['spotify']> | null => {
  const parsed = parseJsonObject(settingsJson);
  const spotify = parsed?.spotify;
  if (!spotify || typeof spotify !== 'object') {
    return null;
  }

  const record = spotify as Record<string, unknown>;
  if (record.hasRefreshToken !== false && record.refreshToken !== '' && record.clientId !== '') {
    return null;
  }

  return {
    ...(record.clientId === '' ? { clientId: '' } : {}),
    refreshToken: '',
    hasRefreshToken: false
  };
};

const parseJsonObject = (source: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
