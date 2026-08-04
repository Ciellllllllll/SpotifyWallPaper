import type { PlaybackProviderKind } from './provider';
import type { RainmeterOutputMode } from './rainmeter';
import type {
  DisplayMode,
  ExistingPlayerPreferences,
  LayoutAnchor,
  LayoutItem,
  LayoutItemKey,
  LayoutPresetName,
  LayoutUnit
} from './view';

export type TransitionPreset = 'fade' | 'crossfade' | 'slide-left' | 'zoom-in' | 'blur-fade';
export type TransitionEasing = 'linear' | 'ease' | 'ease-out' | 'ease-in-out';

export interface WallpaperPreferenceSections {
  layout: {
    preset: LayoutPresetName;
    items: Record<LayoutItemKey, LayoutItem>;
  };
  theme: {
    mode: 'album' | 'fallback' | 'custom';
    textColor: string;
    autoReadability: boolean;
    customPrimaryColor?: string;
  };
  background: {
    mode: 'album-blur' | 'album-gradient' | 'solid-color';
    opacity: number;
    blurPx: number;
    solidColor: string;
  };
  albumArt: {
    visible: boolean;
  };
  text: {
    visible: boolean;
  };
  player: ExistingPlayerPreferences;
  seekbar: {
    visible: boolean;
    style: 'line' | 'album-ring';
  };
  visualizer: {
    enabled: boolean;
    mode: 'album-ring' | 'radial-bars' | 'waveform-line';
    intensity: number;
    sensitivity: number;
    smoothing: number;
    decay: number;
    bassWeight: number;
    midWeight: number;
    trebleWeight: number;
    barCount: number;
    lineWidth: number;
    radius: number;
    gap: number;
    rotationSpeed: number;
    particleCount: number;
    particleLife: number;
    glowStrength: number;
    colorMode: 'theme' | 'accent' | 'white';
    mirrorMode: 'none' | 'mirror';
    clampMax: number;
    noiseGate: number;
    idleAnimation: boolean;
  };
  clock: {
    enabled: boolean;
    hour12: boolean;
    showSeconds: boolean;
    showDate: boolean;
    showWeekday: boolean;
    fontSizePx: number;
    fontWeight: number;
    letterSpacingPx: number;
    opacity: number;
    colorMode: 'auto' | 'fixed';
    fixedColor: string;
  };
  transitions: {
    enabled: boolean;
    preset: TransitionPreset;
    durationMs: number;
    easing: TransitionEasing;
    background: boolean;
    albumArt: boolean;
    text: boolean;
    visualizer: boolean;
    reduceMotion: boolean;
  };
  performance: {
    mode: 'low-power' | 'standard' | 'high-effect';
  };
  rainmeter: {
    enabled: boolean;
    outputPath: string;
    outputMode: RainmeterOutputMode;
    stoppedUpdateIntervalMs: number;
  };
  debug: {
    enabled: boolean;
  };
}

export interface WallpaperPreferences extends WallpaperPreferenceSections {
  schemaVersion: 2;
  spotify: {
    provider: PlaybackProviderKind;
    backendOrigin?: string;
    pollIntervalPlayingMs: number;
    pollIntervalPausedMs: number;
  };
  player: ExistingPlayerPreferences & {
    displayMode: DisplayMode;
  };
}

export interface RepairedWallpaperPreferences {
  preferences: WallpaperPreferences;
  repaired: boolean;
  warning: string | null;
}

export type WallpaperSettingsMigrationStatus = 'valid' | 'repaired' | 'migrated' | 'malformed' | 'future';

export interface WallpaperSettingsMigrationResult {
  preferences: WallpaperPreferences;
  status: WallpaperSettingsMigrationStatus;
  warning: string | null;
  reauthorizationRequired: boolean;
}

const item = (partial: Partial<LayoutItem>): LayoutItem => ({
  enabled: true,
  x: 50,
  y: 50,
  unit: 'percent',
  anchor: 'center',
  width: 360,
  height: 120,
  scale: 1,
  rotation: 0,
  opacity: 1,
  zIndex: 2,
  responsive: 'clamp-safe-area',
  safeAreaMargin: 20,
  locked: false,
  participatesInTransition: true,
  ...partial
});

const leftDockItems: Record<LayoutItemKey, LayoutItem> = {
  albumArt: item({ x: 27, y: 50, anchor: 'center-left', width: 360, height: 360, zIndex: 2 }),
  trackText: item({ x: 52.5, y: 48, anchor: 'center-left', width: 760, height: 300, zIndex: 3 }),
  seekbar: item({ x: 52.5, y: 73, anchor: 'center-left', width: 440, height: 44, zIndex: 3 }),
  clock: item({
    x: 96,
    y: 94,
    anchor: 'bottom-right',
    width: 220,
    height: 72,
    zIndex: 3,
    participatesInTransition: false
  }),
  debug: item({
    x: 98.8,
    y: 2,
    anchor: 'top-right',
    width: 280,
    height: 240,
    zIndex: 5,
    locked: true,
    participatesInTransition: false
  })
};

const mutableLayoutPresets: Record<LayoutPresetName, Record<LayoutItemKey, LayoutItem>> = {
  Minimal: {
    ...leftDockItems,
    albumArt: item({ x: 50, y: 42, anchor: 'center', width: 300, height: 300 }),
    trackText: item({ x: 50, y: 72, anchor: 'center', width: 560, height: 170 }),
    seekbar: item({ x: 50, y: 84, anchor: 'center', width: 460, height: 44 }),
    clock: item({ x: 96, y: 94, anchor: 'bottom-right', width: 220, height: 72, participatesInTransition: false })
  },
  'Center Album': {
    ...leftDockItems,
    albumArt: item({ x: 50, y: 42, anchor: 'center', width: 380, height: 380 }),
    trackText: item({ x: 50, y: 73, anchor: 'center', width: 640, height: 180 }),
    seekbar: item({ x: 50, y: 85, anchor: 'center', width: 520, height: 44 })
  },
  'Visualizer Heavy': {
    ...leftDockItems,
    albumArt: item({ x: 50, y: 50, anchor: 'center', width: 340, height: 340 }),
    trackText: item({ x: 50, y: 82, anchor: 'center', width: 600, height: 160 }),
    seekbar: item({ x: 50, y: 92, anchor: 'center', width: 500, height: 44 })
  },
  'Rainmeter Hybrid': {
    ...leftDockItems,
    albumArt: item({ x: 5, y: 50, anchor: 'center-left', width: 320, height: 320 }),
    trackText: item({ x: 28, y: 48, anchor: 'center-left', width: 480, height: 220 }),
    seekbar: item({ x: 28, y: 66, anchor: 'center-left', width: 400, height: 44 }),
    clock: item({ enabled: false, x: 96, y: 94, anchor: 'bottom-right', width: 220, height: 72 })
  },
  'Left Dock': leftDockItems,
  'Bottom Player': {
    ...leftDockItems,
    albumArt: item({ x: 4, y: 92, anchor: 'bottom-left', width: 150, height: 150 }),
    trackText: item({ x: 16, y: 91, anchor: 'bottom-left', width: 620, height: 120 }),
    seekbar: item({ x: 50, y: 97, anchor: 'bottom-center', width: 760, height: 36 }),
    clock: item({ x: 96, y: 8, anchor: 'top-right', width: 220, height: 72, participatesInTransition: false })
  },
  'Clock Focus': {
    ...leftDockItems,
    albumArt: item({ x: 8, y: 78, anchor: 'bottom-left', width: 220, height: 220 }),
    trackText: item({ x: 26, y: 78, anchor: 'bottom-left', width: 480, height: 150 }),
    seekbar: item({ x: 26, y: 92, anchor: 'bottom-left', width: 420, height: 44 }),
    clock: item({ x: 50, y: 45, anchor: 'center', width: 520, height: 160, scale: 1.8, participatesInTransition: false })
  },
  'Album Ring': {
    ...leftDockItems,
    albumArt: item({ x: 50, y: 48, anchor: 'center', width: 360, height: 360 }),
    trackText: item({ x: 50, y: 80, anchor: 'center', width: 600, height: 160 }),
    seekbar: item({ x: 50, y: 89, anchor: 'center', width: 480, height: 44 })
  },
  'Ambient Background': {
    ...leftDockItems,
    albumArt: item({ enabled: false, x: 50, y: 50, width: 360, height: 360 }),
    trackText: item({ x: 50, y: 52, anchor: 'center', width: 680, height: 240 }),
    seekbar: item({ x: 50, y: 72, anchor: 'center', width: 520, height: 44 }),
    clock: item({ x: 96, y: 94, anchor: 'bottom-right', width: 220, height: 72, participatesInTransition: false })
  }
};

export const layoutPresets: Readonly<Record<LayoutPresetName, Readonly<Record<LayoutItemKey, Readonly<LayoutItem>>>>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(mutableLayoutPresets).map(([preset, items]) => [
        preset,
        Object.freeze(
          Object.fromEntries(
            Object.entries(items).map(([key, value]) => [key, Object.freeze(value)])
          )
        )
      ])
    )
  ) as Readonly<Record<LayoutPresetName, Readonly<Record<LayoutItemKey, Readonly<LayoutItem>>>>>
;

export const defaultLayoutPreset: LayoutPresetName = 'Left Dock';
export const layoutPresetNames: readonly LayoutPresetName[] = Object.freeze(
  Object.keys(layoutPresets) as LayoutPresetName[]
);

export const clonePresetItems = (preset: LayoutPresetName): Record<LayoutItemKey, LayoutItem> =>
  structuredClone(layoutPresets[preset] ?? layoutPresets[defaultLayoutPreset]) as Record<LayoutItemKey, LayoutItem>;

export const isLayoutPresetName = (value: unknown): value is LayoutPresetName =>
  typeof value === 'string' && value in layoutPresets;

const defaultWallpaperPreferencesValue: WallpaperPreferences = {
  schemaVersion: 2,
  spotify: {
    provider: 'mock',
    pollIntervalPlayingMs: 1000,
    pollIntervalPausedMs: 3000
  },
  layout: {
    preset: defaultLayoutPreset,
    items: clonePresetItems(defaultLayoutPreset)
  },
  theme: {
    mode: 'album',
    textColor: '#f6f7fb',
    autoReadability: true
  },
  background: {
    mode: 'album-blur',
    opacity: 0.62,
    blurPx: 30,
    solidColor: '#111318'
  },
  albumArt: { visible: true },
  text: { visible: true },
  player: {
    visible: true,
    controlsEnabled: true,
    showDevice: true,
    showVolume: true,
    showShuffleRepeat: true,
    displayMode: 'album-only'
  },
  seekbar: { visible: true, style: 'line' },
  visualizer: {
    enabled: true,
    mode: 'album-ring',
    intensity: 0.72,
    sensitivity: 1,
    smoothing: 0.35,
    decay: 0.22,
    bassWeight: 1.2,
    midWeight: 1,
    trebleWeight: 0.82,
    barCount: 56,
    lineWidth: 3,
    radius: 1.18,
    gap: 10,
    rotationSpeed: 0.16,
    particleCount: 0,
    particleLife: 0,
    glowStrength: 0.62,
    colorMode: 'theme',
    mirrorMode: 'mirror',
    clampMax: 1,
    noiseGate: 0.03,
    idleAnimation: true
  },
  clock: {
    enabled: true,
    hour12: false,
    showSeconds: false,
    showDate: false,
    showWeekday: false,
    fontSizePx: 34,
    fontWeight: 700,
    letterSpacingPx: 0,
    opacity: 0.9,
    colorMode: 'auto',
    fixedColor: '#f6f7fb'
  },
  transitions: {
    enabled: false,
    preset: 'fade',
    durationMs: 700,
    easing: 'ease-out',
    background: true,
    albumArt: true,
    text: true,
    visualizer: false,
    reduceMotion: false
  },
  performance: { mode: 'standard' },
  rainmeter: {
    enabled: false,
    outputPath: '',
    outputMode: 'json',
    stoppedUpdateIntervalMs: 10_000
  },
  debug: { enabled: false }
};

export const defaultWallpaperPreferences = (): WallpaperPreferences =>
  structuredClone(defaultWallpaperPreferencesValue);

export const repairWallpaperPreferences = (input: unknown): RepairedWallpaperPreferences => {
  const source = asRecord(input);
  const sourceSpotify = asRecord(source?.spotify);
  const sourceLayout = asRecord(source?.layout);
  const sourceTheme = asRecord(source?.theme);
  const sourceBackground = asRecord(source?.background);
  const sourcePlayer = asRecord(source?.player);
  const sourceSeekbar = asRecord(source?.seekbar);
  const sourceVisualizer = asRecord(source?.visualizer);
  const sourceClock = asRecord(source?.clock);
  const sourceTransitions = asRecord(source?.transitions);
  const sourcePerformance = asRecord(source?.performance);
  const sourceRainmeter = asRecord(source?.rainmeter);
  const sourceDebug = asRecord(source?.debug);
  const preset = isLayoutPresetName(sourceLayout?.preset) ? sourceLayout.preset : defaultLayoutPreset;
  const presetItems = clonePresetItems(preset);
  const sourceItems = asRecord(sourceLayout?.items);

  const preferences: WallpaperPreferences = {
    schemaVersion: 2,
    spotify: {
      provider: oneOf(sourceSpotify?.provider, ['mock', 'direct', 'backend'] as const, 'mock'),
      ...(nonEmptyString(sourceSpotify?.backendOrigin) ? { backendOrigin: sourceSpotify?.backendOrigin } : {}),
      pollIntervalPlayingMs: integerInRange(sourceSpotify?.pollIntervalPlayingMs, 500, 60_000, 1000),
      pollIntervalPausedMs: integerInRange(sourceSpotify?.pollIntervalPausedMs, 500, 60_000, 3000)
    },
    layout: {
      preset,
      items: Object.fromEntries(
        (['albumArt', 'trackText', 'seekbar', 'clock', 'debug'] as const).map((key) => [
          key,
          repairLayoutItem(sourceItems?.[key], presetItems[key])
        ])
      ) as Record<LayoutItemKey, LayoutItem>
    },
    theme: {
      mode: oneOf(sourceTheme?.mode, ['album', 'fallback', 'custom'] as const, 'album'),
      textColor: asHexColor(sourceTheme?.textColor) ?? '#f6f7fb',
      ...(asHexColor(sourceTheme?.customPrimaryColor) ? { customPrimaryColor: asHexColor(sourceTheme?.customPrimaryColor) as string } : {}),
      autoReadability: booleanOr(sourceTheme?.autoReadability, true)
    },
    background: {
      mode: oneOf(sourceBackground?.mode, ['album-blur', 'album-gradient', 'solid-color'] as const, 'album-blur'),
      opacity: numberInRange(sourceBackground?.opacity, 0, 1, 0.62),
      blurPx: numberInRange(sourceBackground?.blurPx, 0, 80, 30),
      solidColor: asHexColor(sourceBackground?.solidColor) ?? '#111318'
    },
    albumArt: { visible: booleanOr(asRecord(source?.albumArt)?.visible, true) },
    text: { visible: booleanOr(asRecord(source?.text)?.visible, true) },
    player: {
      visible: booleanOr(sourcePlayer?.visible, true),
      controlsEnabled: booleanOr(sourcePlayer?.controlsEnabled, true),
      showDevice: booleanOr(sourcePlayer?.showDevice, true),
      showVolume: booleanOr(sourcePlayer?.showVolume, true),
      showShuffleRepeat: booleanOr(sourcePlayer?.showShuffleRepeat, true),
      displayMode: oneOf(sourcePlayer?.displayMode, ['album-only', 'album-details'] as const, 'album-only')
    },
    seekbar: {
      visible: booleanOr(sourceSeekbar?.visible, true),
      style: oneOf(sourceSeekbar?.style, ['line', 'album-ring'] as const, 'line')
    },
    visualizer: {
      enabled: booleanOr(sourceVisualizer?.enabled, true),
      mode: oneOf(sourceVisualizer?.mode, ['album-ring', 'radial-bars', 'waveform-line'] as const, 'album-ring'),
      intensity: numberInRange(sourceVisualizer?.intensity, 0, 2, 0.72),
      sensitivity: numberInRange(sourceVisualizer?.sensitivity, 0, 3, 1),
      smoothing: numberInRange(sourceVisualizer?.smoothing, 0, 1, 0.35),
      decay: numberInRange(sourceVisualizer?.decay, 0, 1, 0.22),
      bassWeight: numberInRange(sourceVisualizer?.bassWeight, 0, 3, 1.2),
      midWeight: numberInRange(sourceVisualizer?.midWeight, 0, 3, 1),
      trebleWeight: numberInRange(sourceVisualizer?.trebleWeight, 0, 3, 0.82),
      barCount: integerInRange(sourceVisualizer?.barCount, 8, 160, 56),
      lineWidth: numberInRange(sourceVisualizer?.lineWidth, 1, 16, 3),
      radius: numberInRange(sourceVisualizer?.radius, 0.6, 2.2, 1.18),
      gap: numberInRange(sourceVisualizer?.gap, 0, 80, 10),
      rotationSpeed: numberInRange(sourceVisualizer?.rotationSpeed, -2, 2, 0.16),
      particleCount: integerInRange(sourceVisualizer?.particleCount, 0, 400, 0),
      particleLife: numberInRange(sourceVisualizer?.particleLife, 0, 10, 0),
      glowStrength: numberInRange(sourceVisualizer?.glowStrength, 0, 1, 0.62),
      colorMode: oneOf(sourceVisualizer?.colorMode, ['theme', 'accent', 'white'] as const, 'theme'),
      mirrorMode: oneOf(sourceVisualizer?.mirrorMode, ['none', 'mirror'] as const, 'mirror'),
      clampMax: numberInRange(sourceVisualizer?.clampMax, 0.1, 4, 1),
      noiseGate: numberInRange(sourceVisualizer?.noiseGate, 0, 1, 0.03),
      idleAnimation: booleanOr(sourceVisualizer?.idleAnimation, true)
    },
    clock: {
      enabled: booleanOr(sourceClock?.enabled, true),
      hour12: booleanOr(sourceClock?.hour12, false),
      showSeconds: booleanOr(sourceClock?.showSeconds, false),
      showDate: booleanOr(sourceClock?.showDate, false),
      showWeekday: booleanOr(sourceClock?.showWeekday, false),
      fontSizePx: numberInRange(sourceClock?.fontSizePx, 12, 180, 34),
      fontWeight: Math.round(numberInRange(sourceClock?.fontWeight, 100, 900, 700) / 100) * 100,
      letterSpacingPx: numberInRange(sourceClock?.letterSpacingPx, 0, 12, 0),
      opacity: numberInRange(sourceClock?.opacity, 0, 1, 0.9),
      colorMode: oneOf(sourceClock?.colorMode, ['auto', 'fixed'] as const, 'auto'),
      fixedColor: asHexColor(sourceClock?.fixedColor) ?? '#f6f7fb'
    },
    transitions: {
      enabled: booleanOr(sourceTransitions?.enabled, false),
      preset: oneOf(sourceTransitions?.preset, ['fade', 'crossfade', 'slide-left', 'zoom-in', 'blur-fade'] as const, 'fade'),
      durationMs: integerInRange(sourceTransitions?.durationMs, 120, 5000, 700),
      easing: oneOf(sourceTransitions?.easing, ['linear', 'ease', 'ease-out', 'ease-in-out'] as const, 'ease-out'),
      background: booleanOr(sourceTransitions?.background, true),
      albumArt: booleanOr(sourceTransitions?.albumArt, true),
      text: booleanOr(sourceTransitions?.text, true),
      visualizer: booleanOr(sourceTransitions?.visualizer, false),
      reduceMotion: booleanOr(sourceTransitions?.reduceMotion, false)
    },
    performance: {
      mode: oneOf(sourcePerformance?.mode, ['low-power', 'standard', 'high-effect'] as const, 'standard')
    },
    rainmeter: {
      enabled: booleanOr(sourceRainmeter?.enabled, false),
      outputPath: stringOr(sourceRainmeter?.outputPath, ''),
      outputMode: oneOf(sourceRainmeter?.outputMode, ['json'] as const, 'json'),
      stoppedUpdateIntervalMs: integerInRange(sourceRainmeter?.stoppedUpdateIntervalMs, 1000, 60_000, 10_000)
    },
    debug: { enabled: booleanOr(sourceDebug?.enabled, false) }
  };

  const repaired = !deepEqual(preferences, input);
  return {
    preferences,
    repaired,
    warning: repaired ? 'Invalid settings were repaired; safe v2 defaults are active.' : null
  };
};

export const migrateWallpaperSettingsToV2 = (input: unknown): WallpaperSettingsMigrationResult => {
  const parsed = parseSettingsInput(input);
  if (!parsed) {
    return {
      preferences: defaultWallpaperPreferences(),
      status: 'malformed',
      warning: 'Settings input was malformed; safe v2 defaults are active.',
      reauthorizationRequired: false
    };
  }

  const version = parsed.schemaVersion;
  const versionKind = classifySchemaVersion(version);
  if (versionKind === 'future') {
    return {
      preferences: defaultWallpaperPreferences(),
      status: 'future',
      warning: 'Settings schema is newer than supported v2; safe defaults are active.',
      reauthorizationRequired: false
    };
  }
  if (versionKind === 'malformed') {
    return {
      preferences: defaultWallpaperPreferences(),
      status: 'malformed',
      warning: 'Settings schema version was invalid; safe v2 defaults are active.',
      reauthorizationRequired: false
    };
  }

  const sourceSpotify = asRecord(parsed.spotify);
  const legacyProvider = sourceSpotify?.playbackProvider;
  const isV1 = versionKind === 'unversioned' || versionKind === 'v1';
  const explicitProvider: PlaybackProviderKind = isV1
    ? oneOf(legacyProvider, ['direct', 'backend'] as const, 'mock')
    : oneOf(sourceSpotify?.provider, ['mock', 'direct', 'backend'] as const, 'mock');
  const source: Record<string, unknown> = {
    ...parsed,
    schemaVersion: 2,
    spotify: {
      provider: explicitProvider,
      ...(isV1 && nonEmptyString(sourceSpotify?.backendUrl)
        ? { backendOrigin: sourceSpotify.backendUrl }
        : nonEmptyString(sourceSpotify?.backendOrigin)
          ? { backendOrigin: sourceSpotify.backendOrigin }
          : {}),
      pollIntervalPlayingMs: sourceSpotify?.pollIntervalPlayingMs,
      pollIntervalPausedMs: sourceSpotify?.pollIntervalPausedMs
    }
  };

  const repaired = repairWallpaperPreferences(source);
  const reauthorizationRequired = explicitProvider === 'direct' || explicitProvider === 'backend';
  if (isV1) {
    return {
      preferences: repaired.preferences,
      status: 'migrated',
      warning: reauthorizationRequired ? 'Legacy settings were migrated to v2; Spotify authorization is required.' : repaired.warning,
      reauthorizationRequired
    };
  }

  return {
    preferences: repaired.preferences,
    status: repaired.repaired ? 'repaired' : 'valid',
    warning: repaired.warning,
    reauthorizationRequired
  };
};

export const serializeWallpaperPreferences = (input: unknown): string => {
  const migrated = migrateWallpaperSettingsToV2(input);
  if (migrated.status !== 'valid' && migrated.status !== 'repaired') {
    throw new Error('Only supported v2 preferences can be serialized.');
  }
  return JSON.stringify(migrated.preferences);
};

export const withPresetItems = <T extends { layout: { preset: LayoutPresetName; items: Record<LayoutItemKey, LayoutItem> } }>(
  settings: T,
  preset: LayoutPresetName
): T => ({
  ...settings,
  layout: {
    ...settings.layout,
    preset,
    items: clonePresetItems(preset)
  }
});

const parseSettingsInput = (input: unknown): Record<string, unknown> | null => {
  if (typeof input === 'string') {
    try {
      return asRecord(JSON.parse(input));
    } catch {
      return null;
    }
  }
  return asRecord(input);
};

type SchemaVersionKind = 'unversioned' | 'v1' | 'v2' | 'future' | 'malformed';

const classifySchemaVersion = (value: unknown): SchemaVersionKind => {
  if (value === undefined) {
    return 'unversioned';
  }
  if (value === 1) {
    return 'v1';
  }
  if (value === 2) {
    return 'v2';
  }
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 2) {
    return 'future';
  }
  return 'malformed';
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const repairLayoutItem = (source: unknown, fallback: LayoutItem): LayoutItem => {
  const record = asRecord(source);
  return {
    enabled: booleanOr(record?.enabled, fallback.enabled),
    x: numberInRange(record?.x, -1000, 1000, fallback.x),
    y: numberInRange(record?.y, -1000, 1000, fallback.y),
    unit: oneOf(record?.unit, ['percent', 'px', 'vw', 'vh'] as const, fallback.unit),
    anchor: oneOf(record?.anchor, ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const, fallback.anchor),
    width: numberInRange(record?.width, 1, 4000, fallback.width),
    height: numberInRange(record?.height, 1, 4000, fallback.height),
    scale: numberInRange(record?.scale, 0.1, 4, fallback.scale),
    rotation: numberInRange(record?.rotation, -360, 360, fallback.rotation),
    opacity: numberInRange(record?.opacity, 0, 1, fallback.opacity),
    zIndex: Math.round(numberInRange(record?.zIndex, -1000, 1000, fallback.zIndex)),
    responsive: oneOf(record?.responsive, ['none', 'clamp-safe-area'] as const, fallback.responsive),
    safeAreaMargin: numberInRange(record?.safeAreaMargin, 0, 400, fallback.safeAreaMargin),
    locked: booleanOr(record?.locked, fallback.locked),
    participatesInTransition: booleanOr(record?.participatesInTransition, fallback.participatesInTransition)
  };
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;

const numberInRange = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const integerInRange = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.round(numberInRange(value, min, max, fallback));

const booleanOr = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const asHexColor = (value: unknown): string | null =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;

const deepEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
};
