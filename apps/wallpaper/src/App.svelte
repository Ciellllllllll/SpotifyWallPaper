<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import './app.css';
  import type { WallpaperViewIntent, WallpaperViewModel } from '@spotify-wallpaper/shared-types';
  import WallpaperView from '@spotify-wallpaper/wallpaper-view/WallpaperView.svelte';
  import { defaultSettings } from './settings/defaultSettings';
  import { loadSettings } from './settings/loadSettings';
  import { registerWallpaperPropertyListener } from './wallpaperEngine/properties';
  import { initVisualCore, visualCoreStatus } from './wasm/visualCore';
  import { createWallpaperRuntime, type ReadonlyWallpaperRuntimeSnapshot } from './runtime/wallpaperRuntime';
  import { toWallpaperViewModel } from './viewModel';

  let settingsWarning: string | null = null;
  let settingsSource = 'defaults/browser';
  let configurationSafetyGateOpen = false;
  let viewModel: WallpaperViewModel;

  const wallpaperRuntime = createWallpaperRuntime(defaultSettings);
  let runtimeSnapshot!: ReadonlyWallpaperRuntimeSnapshot;
  const runtimeUnsubscribe = wallpaperRuntime.subscribe((next) => {
    runtimeSnapshot = next;
  });
  $: viewModel = toWallpaperViewModel(runtimeSnapshot, {
    settingsWarning,
    settingsSource,
    visualCoreStatus: visualCoreStatus()
  });

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
    wallpaperRuntime.applyConfiguration(loaded.settings, { kind: 'retain' }, loaded.safetyGateOpen);
    wallpaperRuntime.start();
    registerWallpaperPropertyListener((result) => {
      const safetyAllowed = configurationSafetyGateOpen && result.safetyGateOpen;
      configurationSafetyGateOpen = safetyAllowed;
      settingsWarning = result.warning;
      settingsSource = 'wallpaper-engine properties';
      if (result.settings) wallpaperRuntime.applyConfiguration(result.settings, result.credential, safetyAllowed);
    }, window, () => runtimeSnapshot.settings.spotify.provider, () => runtimeSnapshot.settings);
  });

  onDestroy(() => {
    runtimeUnsubscribe();
    wallpaperRuntime.dispose();
  });
</script>

<WallpaperView model={viewModel} showDebug={true} onIntent={handleIntent} />
