import {
  clonePresetItems,
  defaultLayoutPreset,
  defaultWallpaperPreferences,
  layoutPresetNames,
  migrateWallpaperSettingsToV2,
  type LayoutPresetName,
  type PlaybackProviderKind,
  type WallpaperPreferences
} from '@spotify-wallpaper/shared-types';

export interface ConfiguratorDraft {
  /** Imported preferences remain the authoritative base; controls patch this value. */
  basePreferences: WallpaperPreferences;
  provider: PlaybackProviderKind;
  backendOrigin: string;
  spotifyClientId: string;
  spotifyRefreshToken: string;
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
  spotifyRefreshToken: '',
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
  return {
    ...structuredClone(defaults),
    spotify: {
      ...defaults.spotify,
      provider: draft.provider,
      backendOrigin: draft.backendOrigin.trim() || undefined
    },
    layout: {
      ...defaults.layout,
      preset: draft.preset,
      items: layoutChanged ? clonePresetItems(draft.preset) : structuredClone(defaults.layout.items)
    },
    theme: { ...defaults.theme, mode: draft.themeMode },
    background: {
      ...defaults.background,
      blurPx: performanceChanged && draft.performanceMode === 'low-power' ? 12 : defaults.background.blurPx,
      mode: draft.backgroundMode
    },
    player: { ...defaults.player, controlsEnabled: draft.playerControlsEnabled },
    seekbar: { ...defaults.seekbar, style: layoutChanged ? (draft.preset === 'Album Ring' ? 'album-ring' : 'line') : defaults.seekbar.style },
    visualizer: {
      ...defaults.visualizer,
      enabled: draft.visualizerEnabled,
      intensity: performanceChanged && draft.performanceMode === 'high-effect' ? 1.05 : defaults.visualizer.intensity,
      barCount: performanceChanged && draft.performanceMode === 'low-power' ? 32 : defaults.visualizer.barCount,
      rotationSpeed: performanceChanged && draft.performanceMode === 'low-power' ? 0.06 : defaults.visualizer.rotationSpeed,
      glowStrength: performanceChanged && draft.performanceMode === 'low-power' ? 0.36 : defaults.visualizer.glowStrength
    },
    clock: { ...defaults.clock, enabled: draft.clockEnabled, showSeconds: draft.clockShowSeconds },
    transitions: { ...defaults.transitions, enabled: draft.transitionEnabled },
    performance: { ...defaults.performance, mode: draft.performanceMode },
    rainmeter: { ...defaults.rainmeter, enabled: draft.rainmeterEnabled, outputPath: draft.rainmeterOutputPath.trim() },
    debug: { ...defaults.debug, enabled: draft.debugEnabled }
  };
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
        spotifyRefreshToken: '',
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
