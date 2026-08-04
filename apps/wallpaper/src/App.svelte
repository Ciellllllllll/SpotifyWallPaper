<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import './app.css';
  import type { NormalizedPlayback, SpotifyPlaybackError, WallpaperPreferences, WallpaperTheme } from '@spotify-wallpaper/shared-types';
  import WallpaperView from '@spotify-wallpaper/wallpaper-view/WallpaperView.svelte';
  import type { WallpaperViewIntent, WallpaperViewModel } from '@spotify-wallpaper/wallpaper-view';
  import { mockPlayback } from './mock/mockPlayback';
  import { defaultSettings } from './settings/defaultSettings';
  import { loadSettings } from './settings/loadSettings';
  import { fallbackThemeFromSeed } from './theme/colors';
  import { registerWallpaperPropertyListener } from './wallpaperEngine/properties';
  import { initVisualCore, visualCoreStatus } from './wasm/visualCore';
  import { createWallpaperRuntime, type WallpaperRuntimeSnapshot, type WallpaperRuntimeViewModel } from './runtime/wallpaperRuntime';

  let playback: NormalizedPlayback = mockPlayback;
  let previousPlayback: NormalizedPlayback | null = null;
  let settings: WallpaperPreferences = defaultSettings;
  let spotifyError: SpotifyPlaybackError | null = null;
  let settingsWarning: string | null = null;
  let settingsSource = 'defaults/browser';
  let playbackMode = 'browser mock';
  let visualizerFrame: WallpaperRuntimeSnapshot['visualizerFrame'] = null;
  let transitionState: WallpaperRuntimeSnapshot['transitionState'] = null;
  let theme: WallpaperTheme = fallbackThemeFromSeed(mockPlayback.id ?? mockPlayback.title);
  let lastPollingDelayMs: number | null = null;
  let consecutiveErrors = 0;
  let providerSelection: WallpaperRuntimeSnapshot['providerSelection'] = 'mock';
  let providerConfigurationError: string | null = null;
  let configurationSafetyGateOpen = false;
  let controlError: SpotifyPlaybackError | null = null;
  let controlBusy = false;
  let credentialConfigured = false;
  let nowMs = Date.now();
  let progressNowMs = Date.now();
  let viewModel: WallpaperViewModel;

  const wallpaperRuntime = createWallpaperRuntime(defaultSettings);
  let runtimeUnsubscribe: (() => void) | null = null;

  $: spotifyStatusText = providerConfigurationError
    ? providerConfigurationError
    : spotifyError
      ? `${spotifyError.kind}${spotifyError.status ? ` ${spotifyError.status}` : ''}: ${spotifyError.message}`
      : 'ok';
  $: controlStatusText = controlError?.message ?? (playback.device?.isRestricted ? 'Current Spotify device is restricted.' : '');
  $: canControlPlayback = providerSelection === 'ready' && playback.source === 'spotify' && settings.player.controlsEnabled && !playback.device?.isRestricted && !controlBusy;
  $: viewModel = {
    settings,
    playback,
    previousPlayback,
    visualizerFrame,
    theme,
    transitionState: transitionState
      ? {
          previous: transitionState.previous,
          current: transitionState.current,
          durationMs: transitionState.durationMs,
          easing: transitionState.easing,
          resolvedPreset: transitionState.resolvedPreset
        }
      : null,
    nowMs,
    progressNowMs,
    playbackMode,
    providerSelection,
    providerConfigurationError,
    spotifyStatusText,
    controlStatusText,
    controlBusy,
    canControlPlayback,
    lastPollingDelayMs,
    consecutiveErrors,
    visualCoreStatus: visualCoreStatus(),
    credentialConfigured,
    settingsWarning,
    settingsSource
  };

  const syncRuntime = (next: WallpaperRuntimeViewModel) => {
    const snapshot = next as unknown as WallpaperRuntimeSnapshot;
    playback = snapshot.playback;
    previousPlayback = snapshot.previousPlayback;
    settings = snapshot.settings;
    spotifyError = snapshot.spotifyError;
    playbackMode = snapshot.playbackMode;
    visualizerFrame = snapshot.visualizerFrame;
    transitionState = snapshot.transitionState;
    theme = snapshot.theme;
    lastPollingDelayMs = snapshot.lastPollingDelayMs;
    consecutiveErrors = snapshot.consecutiveErrors;
    providerSelection = snapshot.providerSelection;
    providerConfigurationError = snapshot.providerConfigurationError;
    controlError = snapshot.controlError;
    controlBusy = snapshot.controlBusy;
    credentialConfigured = snapshot.credentialStatus.present;
    nowMs = snapshot.nowMs;
    progressNowMs = snapshot.progressNowMs;
  };

  const handleIntent = (intent: WallpaperViewIntent) => {
    if (intent.type === 'toggle-display-mode') {
      wallpaperRuntime.toggleDisplayMode();
      return;
    }
    void wallpaperRuntime.execute(intent);
  };

  onMount(() => {
    initVisualCore();
    const loaded = loadSettings();
    configurationSafetyGateOpen = loaded.safetyGateOpen;
    settingsWarning = loaded.warning;
    settingsSource = loaded.warning ? 'fallback defaults' : 'defaults/browser';
    runtimeUnsubscribe = wallpaperRuntime.subscribe(syncRuntime);
    wallpaperRuntime.applyConfiguration(loaded.settings, { kind: 'retain' }, loaded.safetyGateOpen);
    wallpaperRuntime.start();
    registerWallpaperPropertyListener((result) => {
      const safetyAllowed = configurationSafetyGateOpen && result.safetyGateOpen;
      configurationSafetyGateOpen = safetyAllowed;
      settingsWarning = result.warning;
      settingsSource = 'wallpaper-engine properties';
      if (result.settings) wallpaperRuntime.applyConfiguration(result.settings, result.credential, safetyAllowed);
    }, window, () => settings.spotify.provider, () => settings);
  });

  onDestroy(() => {
    runtimeUnsubscribe?.();
    runtimeUnsubscribe = null;
    wallpaperRuntime.dispose();
  });
</script>

<WallpaperView model={viewModel} showDebug={true} onIntent={handleIntent} />
