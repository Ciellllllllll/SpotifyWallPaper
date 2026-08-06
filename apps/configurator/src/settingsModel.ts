import {
  applyWallpaperPreferencesPatch,
  clonePresetItems,
  defaultLayoutPreset,
  defaultWallpaperPreferences,
  layoutPresetNames,
  migrateWallpaperSettingsToV2,
  type LayoutPresetName,
  type PlaybackProviderKind,
  type WallpaperPreferences,
  type WallpaperPreferencesPatch
} from '@spotify-wallpaper/shared-types';

export interface ConfiguratorDraft {
  /** Imported preferences remain the authoritative base; controls patch this value. */
  basePreferences: WallpaperPreferences;
  provider: PlaybackProviderKind;
  backendOrigin: string;
  spotifyClientId: string;
  preset: LayoutPresetName;
  presetChanged: boolean;
  backgroundMode: WallpaperPreferences['background']['mode'];
  themeMode: WallpaperPreferences['theme']['mode'];
  visualizerEnabled: boolean;
  transitionEnabled: boolean;
  clockEnabled: boolean;
  clockShowSeconds: boolean;
  playerControlsEnabled: boolean;
  rainmeterEnabled: boolean;
  rainmeterOutputPath: string;
  performanceMode: WallpaperPreferences['performance']['mode'];
  debugEnabled: boolean;
}

export const layoutPresetOptions: LayoutPresetName[] = [...layoutPresetNames];

export const defaultDraft: ConfiguratorDraft = {
  basePreferences: defaultWallpaperPreferences(),
  provider: 'mock',
  backendOrigin: '',
  spotifyClientId: '',
  preset: defaultLayoutPreset,
  presetChanged: false,
  backgroundMode: 'album-blur',
  themeMode: 'album',
  visualizerEnabled: true,
  transitionEnabled: false,
  clockEnabled: true,
  clockShowSeconds: false,
  playerControlsEnabled: true,
  rainmeterEnabled: false,
  rainmeterOutputPath: '',
  performanceMode: 'standard',
  debugEnabled: false
};

export const buildSettings = (draft: ConfiguratorDraft): WallpaperPreferences => {
  const defaults = draft.basePreferences ?? defaultWallpaperPreferences();
  const layoutChanged = draft.presetChanged || draft.preset !== defaults.layout.preset;
  const performanceChanged = draft.performanceMode !== defaults.performance.mode;
  const patch: WallpaperPreferencesPatch = {
    spotify: {
      provider: draft.provider,
      backendOrigin: draft.backendOrigin.trim() || undefined
    },
    layout: {
      preset: draft.preset,
      ...(layoutChanged ? { items: clonePresetItems(draft.preset) } : {})
    },
    theme: { mode: draft.themeMode },
    background: {
      blurPx: performanceChanged && draft.performanceMode === 'low-power' ? 12 : defaults.background.blurPx,
      mode: draft.backgroundMode
    },
    player: { controlsEnabled: draft.playerControlsEnabled },
    seekbar: { style: layoutChanged ? (draft.preset === 'Album Ring' ? 'album-ring' : 'line') : defaults.seekbar.style },
    visualizer: {
      enabled: draft.visualizerEnabled,
      intensity: performanceChanged && draft.performanceMode === 'high-effect' ? 1.05 : defaults.visualizer.intensity,
      barCount: performanceChanged && draft.performanceMode === 'low-power' ? 32 : defaults.visualizer.barCount,
      rotationSpeed: performanceChanged && draft.performanceMode === 'low-power' ? 0.06 : defaults.visualizer.rotationSpeed,
      glowStrength: performanceChanged && draft.performanceMode === 'low-power' ? 0.36 : defaults.visualizer.glowStrength
    },
    clock: { enabled: draft.clockEnabled, showSeconds: draft.clockShowSeconds },
    transitions: { enabled: draft.transitionEnabled },
    performance: { mode: draft.performanceMode },
    rainmeter: { enabled: draft.rainmeterEnabled, outputPath: draft.rainmeterOutputPath.trim() },
    debug: { enabled: draft.debugEnabled }
  };
  return applyWallpaperPreferencesPatch(defaults, patch);
};

export const exportSettingsJson = (draft: ConfiguratorDraft): string => JSON.stringify(buildSettings(draft), null, 2);

export const importSettingsJson = (source: string): { draft: ConfiguratorDraft; warning: string | null } => {
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    const migrated = migrateWallpaperSettingsToV2(parsed);
    return {
      draft: {
        ...defaultDraft,
        basePreferences: migrated.preferences,
        provider: migrated.preferences.spotify.provider,
        backendOrigin: migrated.preferences.spotify.backendOrigin ?? '',
        spotifyClientId: '',
        preset: migrated.preferences.layout.preset,
        presetChanged: false,
        backgroundMode: migrated.preferences.background.mode,
        themeMode: migrated.preferences.theme.mode,
        visualizerEnabled: migrated.preferences.visualizer.enabled,
        transitionEnabled: migrated.preferences.transitions.enabled,
        clockEnabled: migrated.preferences.clock.enabled,
        clockShowSeconds: migrated.preferences.clock.showSeconds,
        playerControlsEnabled: migrated.preferences.player.controlsEnabled,
        rainmeterEnabled: migrated.preferences.rainmeter.enabled,
        rainmeterOutputPath: migrated.preferences.rainmeter.outputPath,
        performanceMode: migrated.preferences.performance.mode,
        debugEnabled: migrated.preferences.debug.enabled
      },
      warning: migrated.warning
    };
  } catch {
    return {
      draft: { ...defaultDraft, basePreferences: defaultWallpaperPreferences() },
      warning: 'Import JSON was malformed; defaults remain active.'
    };
  }
};
