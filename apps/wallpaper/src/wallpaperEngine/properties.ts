import {
  applyWallpaperPreferencesPatch,
  clonePresetItems,
  isLayoutPresetName,
  type PlaybackProviderKind,
  type WallpaperPreferences,
  type WallpaperPreferencesPatch
} from '@spotify-wallpaper/shared-types';
import { loadSettings } from '../settings/loadSettings';
import { isWallpaperEngineSpotifyToken, parseWallpaperEngineSpotifyToken } from '../spotify/wallpaperEngineToken';
import type { CredentialInput } from '../settings/credentialBoundary';
import type { CredentialUpdate, ProviderHint, WallpaperEngineProperties, WallpaperPropertyResult } from './types';

export const parseWallpaperProperties = (
  properties: WallpaperEngineProperties,
  providerHint?: PlaybackProviderKind
): WallpaperPropertyResult => {
  const patch: WallpaperPreferencesPatch = {};
  let warning: string | null = null;
  let credential: CredentialUpdate = { kind: 'retain' };
  let safetyGateOpen = true;
  let settingsReplacement: WallpaperPreferences | undefined;

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
    warning = loaded.warning;
    safetyGateOpen = loaded.safetyGateOpen;
    settingsReplacement = loaded.settings;
  }

  if (
    playbackProvider === 'mock' ||
    playbackProvider === 'direct' ||
    playbackProvider === 'backend' ||
    backendUrl !== undefined
  ) {
    patch.spotify = {
      ...patch.spotify,
      ...(playbackProvider === 'mock' || playbackProvider === 'direct' || playbackProvider === 'backend'
        ? { provider: playbackProvider }
        : {}),
      ...(backendUrl !== undefined ? { backendOrigin: backendUrl } : {})
    };
    if (playbackProvider === 'mock' || playbackProvider === 'direct' || playbackProvider === 'backend') {
      credential = { kind: 'clear' };
    }
  }

  const bundledToken = refreshToken !== undefined ? parseWallpaperEngineSpotifyToken(refreshToken) : null;
  const directCredential = bundledToken
    ? { kind: 'replace', value: { kind: 'direct', ...bundledToken } } as CredentialUpdate
    : refreshToken !== undefined && isWallpaperEngineSpotifyToken(refreshToken)
      ? { kind: 'clear' } as CredentialUpdate
      : clientId !== undefined || refreshToken !== undefined
        ? clientId && refreshToken
          ? { kind: 'replace', value: { kind: 'direct', clientId, refreshToken } } as CredentialUpdate
          : { kind: 'clear' } as CredentialUpdate
        : null;
  const backendCredential = pairingToken !== undefined
    ? pairingToken.length > 0
      ? { kind: 'replace', value: { kind: 'backend', pairingToken } } as CredentialUpdate
      : { kind: 'clear' } as CredentialUpdate
    : null;
  const selectedProvider = patch.spotify?.provider ?? settingsReplacement?.spotify.provider ?? providerHint;
  if (selectedProvider === 'mock') {
    if (directCredential || backendCredential) {
      credential = { kind: 'clear' };
    }
  } else if (selectedProvider === 'direct') {
    credential = directCredential ?? (backendCredential ? { kind: 'clear' } : credential);
  } else if (selectedProvider === 'backend') {
    credential = backendCredential ?? (directCredential ? { kind: 'clear' } : credential);
  } else if (backendCredential && directCredential) {
    // Without an explicit/current provider, never guess which credential wins.
    credential = { kind: 'clear' };
  } else if (backendCredential) {
    credential = backendCredential;
  } else if (directCredential) {
    credential = directCredential;
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

  return { patch, warning, credential, safetyGateOpen, settingsReplacement };
};

export const registerWallpaperPropertyListener = (
  onProperties: (result: WallpaperPropertyResult & { settings?: WallpaperPreferences }) => void,
  target: Window = window,
  providerHint?: ProviderHint,
  currentSettings?: () => WallpaperPreferences
): void => {
  let snapshot: WallpaperEngineProperties = {};
  target.wallpaperPropertyListener = {
    applyUserProperties: (properties) => {
      snapshot = { ...snapshot, ...properties };
      const result = parseWallpaperProperties(snapshot, providerHint?.());
      onProperties(currentSettings ? {
        ...result,
        settings: applyWallpaperPreferencesPatch(result.settingsReplacement ?? currentSettings(), result.patch)
      } : result);
    }
  };
};

const stringProperty = (properties: WallpaperEngineProperties, key: string): string | undefined => {
  const value = properties[key]?.value;
  return typeof value === 'string' ? value : undefined;
};

const booleanProperty = (properties: WallpaperEngineProperties, key: string): boolean | undefined => {
  const value = properties[key]?.value;
  return typeof value === 'boolean' ? value : undefined;
};
