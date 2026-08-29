import {
  applyWallpaperPreferencesPatch,
  clonePresetItems,
  isLayoutPresetName,
  type PlaybackProviderKind,
  type WallpaperPreferences,
  type WallpaperPreferencesPatch
} from '@spotify-wallpaper/shared-types';
import { loadSettings } from '../settings/loadSettings';
import { parseWallpaperEngineSpotifyToken } from '../spotify/wallpaperEngineToken';
import { configuredOfficialBackendOrigin } from '../spotify/providers/backendProvider';
import type { CredentialInput } from '../settings/credentialBoundary';
import type { CredentialUpdate, ProviderHint, WallpaperEngineProperties, WallpaperPropertyResult } from './types';

const backendPairingTokenPattern = /^swpb1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const spotifyPropertyKeys = [
  'spotify_client_id',
  'spotify_refresh_token',
  'spotify_playback_provider',
  'spotify_backend_url',
  'spotify_pairing_token'
] as const;

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
  const glowingObjectsEnabled = booleanProperty(properties, 'glowing_objects_enabled');
  const visualizerMode = stringProperty(properties, 'visualizer_mode');
  const visualizerPosition = stringProperty(properties, 'visualizer_position');
  const visualizerIntensity = numberProperty(properties, 'visualizer_intensity');
  const visualizerSensitivity = numberProperty(properties, 'visualizer_sensitivity');
  const visualizerSmoothing = numberProperty(properties, 'visualizer_smoothing');
  const visualizerDecay = numberProperty(properties, 'visualizer_decay');
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

  const trimmedToken = refreshToken?.trim();
  const bundledToken = refreshToken !== undefined ? parseWallpaperEngineSpotifyToken(refreshToken) : null;
  const unifiedBackendToken = trimmedToken && isBackendPairingToken(trimmedToken) ? trimmedToken : null;
  let unifiedCredential: CredentialUpdate | null = null;
  if (refreshToken !== undefined && trimmedToken === '') {
    delete patch.spotify;
    unifiedCredential = { kind: 'clear' };
  } else if (bundledToken) {
    patch.spotify = { provider: 'direct' };
    unifiedCredential = { kind: 'replace', value: { kind: 'direct', ...bundledToken } };
  } else if (unifiedBackendToken) {
    const backendOrigin = configuredOfficialBackendOrigin();
    patch.spotify = {
      ...patch.spotify,
      provider: 'backend',
      backendOrigin: backendOrigin ?? ''
    };
    unifiedCredential = { kind: 'replace', value: { kind: 'backend', pairingToken: unifiedBackendToken } };
    if (!backendOrigin && warning === null) warning = 'Spotify backend is unavailable in this build.';
  } else if (trimmedToken?.startsWith('swpt1.') || trimmedToken?.startsWith('swpb1.')) {
    delete patch.spotify;
    unifiedCredential = { kind: 'retain' };
    if (warning === null) warning = 'Spotify Token format is invalid.';
  }

  const directCredential = unifiedCredential === null && (clientId !== undefined || refreshToken !== undefined)
    ? clientId && refreshToken
      ? { kind: 'replace', value: { kind: 'direct', clientId, refreshToken } } as CredentialUpdate
      : refreshToken
        ? { kind: 'retain' } as CredentialUpdate
        : { kind: 'clear' } as CredentialUpdate
    : null;
  const backendCredential = pairingToken !== undefined
    ? pairingToken.length > 0
      ? { kind: 'replace', value: { kind: 'backend', pairingToken } } as CredentialUpdate
      : { kind: 'clear' } as CredentialUpdate
    : null;
  const selectedProvider = patch.spotify?.provider ?? settingsReplacement?.spotify.provider ?? providerHint;
  if (unifiedCredential !== null) {
    credential = unifiedCredential;
  } else if (selectedProvider === 'mock') {
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
      ...(seekbarStyle === 'line' || seekbarStyle === 'album-ring' ? { style: 'line' } : {})
    };
  }

  if (visualizerEnabled !== undefined) {
    patch.visualizer = { ...patch.visualizer, enabled: visualizerEnabled };
  }

  if (glowingObjectsEnabled !== undefined) {
    patch.visualizer = { ...patch.visualizer, glowingObjectsEnabled };
  }

  if (visualizerMode === 'album-ring' || visualizerMode === 'radial-bars' || visualizerMode === 'waveform-line') {
    patch.visualizer = { ...patch.visualizer, mode: visualizerMode };
  }

  if (visualizerPosition === 'around-album' || visualizerPosition === 'bottom-up') {
    patch.visualizer = { ...patch.visualizer, position: visualizerPosition };
  }

  if (
    visualizerIntensity !== undefined ||
    visualizerSensitivity !== undefined ||
    visualizerSmoothing !== undefined ||
    visualizerDecay !== undefined
  ) {
    patch.visualizer = {
      ...patch.visualizer,
      ...(visualizerIntensity !== undefined ? { intensity: visualizerIntensity } : {}),
      ...(visualizerSensitivity !== undefined ? { sensitivity: visualizerSensitivity } : {}),
      ...(visualizerSmoothing !== undefined ? { smoothing: visualizerSmoothing } : {}),
      ...(visualizerDecay !== undefined ? { decay: visualizerDecay } : {})
    };
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
  let safetyGateOpen = true;
  target.wallpaperPropertyListener = {
    applyUserProperties: (properties) => {
      snapshot = { ...snapshot, ...properties };
      const effectiveProperties = { ...snapshot };
      if (!Object.prototype.hasOwnProperty.call(properties, 'settings_json')) {
        delete effectiveProperties.settings_json;
      }
      if (!spotifyPropertyKeys.some((key) => Object.prototype.hasOwnProperty.call(properties, key))) {
        for (const key of spotifyPropertyKeys) delete effectiveProperties[key];
      }
      const result = parseWallpaperProperties(effectiveProperties, providerHint?.());
      safetyGateOpen = safetyGateOpen && result.safetyGateOpen;
      const safeResult = { ...result, safetyGateOpen };
      onProperties(currentSettings ? {
        ...safeResult,
        settings: applyWallpaperPreferencesPatch(result.settingsReplacement ?? currentSettings(), result.patch)
      } : safeResult);
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

const numberProperty = (properties: WallpaperEngineProperties, key: string): number | undefined => {
  const value = properties[key]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const isBackendPairingToken = (value: string): boolean => {
  const match = backendPairingTokenPattern.exec(value);
  return match !== null && isCanonicalBase64Url(match[1], 16) && isCanonicalBase64Url(match[2], 32);
};

const isCanonicalBase64Url = (value: string, expectedByteLength: number): boolean => {
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
    return binary.length === expectedByteLength &&
      btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === value;
  } catch {
    return false;
  }
};
