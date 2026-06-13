import type {
  LayoutAnchor,
  LayoutItem,
  LayoutItemKey,
  LayoutUnit,
  WallpaperSettings
} from '@spotify-wallpaper/shared-types';
import { clonePresetItems, defaultLayoutPreset, isLayoutPresetName } from '../layout/presets';
import { defaultSettings } from './defaultSettings';

const layoutItemKeys: LayoutItemKey[] = ['albumArt', 'trackText', 'seekbar', 'lyrics', 'clock', 'debug'];
const anchors: LayoutAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
];
const units: LayoutUnit[] = ['percent', 'px', 'vw', 'vh'];
const visualizerModes: WallpaperSettings['visualizer']['mode'][] = ['album-ring', 'radial-bars', 'waveform-line'];
const visualizerColorModes: WallpaperSettings['visualizer']['colorMode'][] = ['theme', 'accent', 'white'];
const visualizerMirrorModes: WallpaperSettings['visualizer']['mirrorMode'][] = ['none', 'mirror'];
const lyricModes: WallpaperSettings['lyrics']['mode'][] = ['current', 'context'];
const seekbarStyles: WallpaperSettings['seekbar']['style'][] = ['line', 'album-ring'];
const clockColorModes: WallpaperSettings['clock']['colorMode'][] = ['auto', 'fixed'];
const transitionPresets: WallpaperSettings['transitions']['preset'][] = [
  'fade',
  'crossfade',
  'slide-left',
  'zoom-in',
  'blur-fade'
];
const transitionEasings: WallpaperSettings['transitions']['easing'][] = ['linear', 'ease', 'ease-out', 'ease-in-out'];

export interface RepairResult {
  settings: WallpaperSettings;
  repaired: boolean;
  warning: string | null;
}

export const repairSettings = (input: WallpaperSettings): RepairResult => {
  let repaired = false;
  const preset = isLayoutPresetName(input.layout?.preset) ? input.layout.preset : defaultLayoutPreset;
  repaired ||= preset !== input.layout?.preset;

  const presetItems = clonePresetItems(preset);
  const sourceItems = input.layout?.items && typeof input.layout.items === 'object' ? input.layout.items : {};
  const items = Object.fromEntries(
    layoutItemKeys.map((key) => {
      const result = repairLayoutItem((sourceItems as Partial<Record<LayoutItemKey, unknown>>)[key], presetItems[key]);
      repaired ||= result.repaired;
      return [key, result.item];
    })
  ) as Record<LayoutItemKey, LayoutItem>;

  const repairedSettings: WallpaperSettings = {
    ...defaultSettings,
    ...input,
    schemaVersion: numberInRange(input.schemaVersion, 1, 1, defaultSettings.schemaVersion),
    spotify: {
      ...defaultSettings.spotify,
      ...input.spotify,
      pollIntervalPlayingMs: numberInRange(input.spotify?.pollIntervalPlayingMs, 500, 60_000, 1000),
      pollIntervalPausedMs: numberInRange(input.spotify?.pollIntervalPausedMs, 500, 60_000, 3000)
    },
    background: {
      ...defaultSettings.background,
      ...input.background,
      mode:
        input.background?.mode === 'album-blur' ||
        input.background?.mode === 'album-gradient' ||
        input.background?.mode === 'solid-color'
          ? input.background.mode
          : defaultSettings.background.mode,
      opacity: numberInRange(input.background?.opacity, 0, 1, defaultSettings.background.opacity),
      blurPx: numberInRange(input.background?.blurPx, 0, 80, defaultSettings.background.blurPx),
      solidColor: isHexColor(input.background?.solidColor) ? input.background.solidColor : defaultSettings.background.solidColor
    },
    theme: {
      ...defaultSettings.theme,
      ...input.theme,
      mode:
        input.theme?.mode === 'album' || input.theme?.mode === 'fallback' || input.theme?.mode === 'custom'
          ? input.theme.mode
          : defaultSettings.theme.mode,
      textColor: isHexColor(input.theme?.textColor) ? input.theme.textColor : defaultSettings.theme.textColor,
      customPrimaryColor: isHexColor(input.theme?.customPrimaryColor) ? input.theme.customPrimaryColor : undefined,
      autoReadability: booleanOr(input.theme?.autoReadability, defaultSettings.theme.autoReadability)
    },
    layout: {
      preset,
      items
    },
    player: {
      ...defaultSettings.player,
      ...input.player,
      visible: booleanOr(input.player?.visible, defaultSettings.player.visible),
      controlsEnabled: booleanOr(input.player?.controlsEnabled, defaultSettings.player.controlsEnabled),
      showDevice: booleanOr(input.player?.showDevice, defaultSettings.player.showDevice),
      showVolume: booleanOr(input.player?.showVolume, defaultSettings.player.showVolume),
      showShuffleRepeat: booleanOr(input.player?.showShuffleRepeat, defaultSettings.player.showShuffleRepeat)
    },
    seekbar: {
      ...defaultSettings.seekbar,
      ...input.seekbar,
      visible: booleanOr(input.seekbar?.visible, defaultSettings.seekbar.visible),
      style: oneOf(input.seekbar?.style, seekbarStyles, defaultSettings.seekbar.style)
    },
    lyrics: {
      ...defaultSettings.lyrics,
      enabled: booleanOr(input.lyrics?.enabled, defaultSettings.lyrics.enabled),
      sourceText: typeof input.lyrics?.sourceText === 'string' ? input.lyrics.sourceText : defaultSettings.lyrics.sourceText,
      mode: oneOf(input.lyrics?.mode, lyricModes, defaultSettings.lyrics.mode),
      offsetMs: Math.round(numberInRange(input.lyrics?.offsetMs, -30_000, 30_000, defaultSettings.lyrics.offsetMs)),
      showMissingState: booleanOr(input.lyrics?.showMissingState, defaultSettings.lyrics.showMissingState),
      provider: {
        name: 'user-lrc',
        searchInputs: {
          title: booleanOr(input.lyrics?.provider?.searchInputs?.title, defaultSettings.lyrics.provider.searchInputs.title),
          artists: booleanOr(input.lyrics?.provider?.searchInputs?.artists, defaultSettings.lyrics.provider.searchInputs.artists),
          album: booleanOr(input.lyrics?.provider?.searchInputs?.album, defaultSettings.lyrics.provider.searchInputs.album),
          duration: booleanOr(input.lyrics?.provider?.searchInputs?.duration, defaultSettings.lyrics.provider.searchInputs.duration)
        },
        supportsSynced: true,
        supportsPlain: false,
        cachePolicy: 'none',
        failureReason:
          input.lyrics?.provider?.failureReason === 'not-configured' ||
          input.lyrics?.provider?.failureReason === 'not-found' ||
          input.lyrics?.provider?.failureReason === 'invalid-lrc' ||
          input.lyrics?.provider?.failureReason === 'provider-error'
            ? input.lyrics.provider.failureReason
            : null
      }
    },
    visualizer: {
      ...defaultSettings.visualizer,
      enabled: booleanOr(input.visualizer?.enabled, defaultSettings.visualizer.enabled),
      mode: oneOf(input.visualizer?.mode, visualizerModes, defaultSettings.visualizer.mode),
      intensity: numberInRange(input.visualizer?.intensity, 0, 2, defaultSettings.visualizer.intensity),
      sensitivity: numberInRange(input.visualizer?.sensitivity, 0, 3, defaultSettings.visualizer.sensitivity),
      smoothing: numberInRange(input.visualizer?.smoothing, 0, 1, defaultSettings.visualizer.smoothing),
      decay: numberInRange(input.visualizer?.decay, 0, 1, defaultSettings.visualizer.decay),
      bassWeight: numberInRange(input.visualizer?.bassWeight, 0, 3, defaultSettings.visualizer.bassWeight),
      midWeight: numberInRange(input.visualizer?.midWeight, 0, 3, defaultSettings.visualizer.midWeight),
      trebleWeight: numberInRange(input.visualizer?.trebleWeight, 0, 3, defaultSettings.visualizer.trebleWeight),
      barCount: Math.round(numberInRange(input.visualizer?.barCount, 8, 160, defaultSettings.visualizer.barCount)),
      lineWidth: numberInRange(input.visualizer?.lineWidth, 1, 16, defaultSettings.visualizer.lineWidth),
      radius: numberInRange(input.visualizer?.radius, 0.6, 2.2, defaultSettings.visualizer.radius),
      gap: numberInRange(input.visualizer?.gap, 0, 80, defaultSettings.visualizer.gap),
      rotationSpeed: numberInRange(input.visualizer?.rotationSpeed, -2, 2, defaultSettings.visualizer.rotationSpeed),
      particleCount: Math.round(numberInRange(input.visualizer?.particleCount, 0, 400, defaultSettings.visualizer.particleCount)),
      particleLife: numberInRange(input.visualizer?.particleLife, 0, 10, defaultSettings.visualizer.particleLife),
      glowStrength: numberInRange(input.visualizer?.glowStrength, 0, 1, defaultSettings.visualizer.glowStrength),
      colorMode: oneOf(input.visualizer?.colorMode, visualizerColorModes, defaultSettings.visualizer.colorMode),
      mirrorMode: oneOf(input.visualizer?.mirrorMode, visualizerMirrorModes, defaultSettings.visualizer.mirrorMode),
      clampMax: numberInRange(input.visualizer?.clampMax, 0.1, 4, defaultSettings.visualizer.clampMax),
      noiseGate: numberInRange(input.visualizer?.noiseGate, 0, 1, defaultSettings.visualizer.noiseGate),
      idleAnimation: booleanOr(input.visualizer?.idleAnimation, defaultSettings.visualizer.idleAnimation)
    },
    clock: {
      ...defaultSettings.clock,
      ...input.clock,
      enabled: booleanOr(input.clock?.enabled, defaultSettings.clock.enabled),
      hour12: booleanOr(input.clock?.hour12, defaultSettings.clock.hour12),
      showSeconds: booleanOr(input.clock?.showSeconds, defaultSettings.clock.showSeconds),
      showDate: booleanOr(input.clock?.showDate, defaultSettings.clock.showDate),
      showWeekday: booleanOr(input.clock?.showWeekday, defaultSettings.clock.showWeekday),
      fontSizePx: numberInRange(input.clock?.fontSizePx, 12, 180, defaultSettings.clock.fontSizePx),
      fontWeight: Math.round(numberInRange(input.clock?.fontWeight, 100, 900, defaultSettings.clock.fontWeight) / 100) * 100,
      letterSpacingPx: numberInRange(input.clock?.letterSpacingPx, 0, 12, defaultSettings.clock.letterSpacingPx),
      opacity: numberInRange(input.clock?.opacity, 0, 1, defaultSettings.clock.opacity),
      colorMode: oneOf(input.clock?.colorMode, clockColorModes, defaultSettings.clock.colorMode),
      fixedColor: isHexColor(input.clock?.fixedColor) ? input.clock.fixedColor : defaultSettings.clock.fixedColor
    },
    transitions: {
      ...defaultSettings.transitions,
      enabled: booleanOr(input.transitions?.enabled, defaultSettings.transitions.enabled),
      preset: oneOf(input.transitions?.preset, transitionPresets, defaultSettings.transitions.preset),
      durationMs: Math.round(numberInRange(input.transitions?.durationMs, 120, 5000, defaultSettings.transitions.durationMs)),
      easing: oneOf(input.transitions?.easing, transitionEasings, defaultSettings.transitions.easing),
      background: booleanOr(input.transitions?.background, defaultSettings.transitions.background),
      albumArt: booleanOr(input.transitions?.albumArt, defaultSettings.transitions.albumArt),
      text: booleanOr(input.transitions?.text, defaultSettings.transitions.text),
      lyrics: booleanOr(input.transitions?.lyrics, defaultSettings.transitions.lyrics),
      visualizer: booleanOr(input.transitions?.visualizer, defaultSettings.transitions.visualizer),
      reduceMotion: booleanOr(input.transitions?.reduceMotion, defaultSettings.transitions.reduceMotion)
    }
  };

  repaired ||= input.schemaVersion !== repairedSettings.schemaVersion;
  repaired ||= input.background?.mode !== repairedSettings.background.mode;
  repaired ||= input.background?.opacity !== repairedSettings.background.opacity;
  repaired ||= input.background?.blurPx !== repairedSettings.background.blurPx;
  repaired ||= input.background?.solidColor !== repairedSettings.background.solidColor;
  repaired ||= input.theme?.mode !== repairedSettings.theme.mode;
  repaired ||= input.theme?.textColor !== repairedSettings.theme.textColor;
  repaired ||= input.theme?.customPrimaryColor !== repairedSettings.theme.customPrimaryColor;
  repaired ||= input.theme?.autoReadability !== repairedSettings.theme.autoReadability;
  repaired ||= JSON.stringify({ ...defaultSettings.player, ...input.player }) !== JSON.stringify(repairedSettings.player);
  repaired ||= JSON.stringify({ ...defaultSettings.seekbar, ...input.seekbar }) !== JSON.stringify(repairedSettings.seekbar);
  repaired ||= JSON.stringify({ ...defaultSettings.lyrics, ...input.lyrics }) !== JSON.stringify(repairedSettings.lyrics);
  repaired ||= JSON.stringify({ ...defaultSettings.visualizer, ...input.visualizer }) !== JSON.stringify(repairedSettings.visualizer);
  repaired ||= JSON.stringify({ ...defaultSettings.clock, ...input.clock }) !== JSON.stringify(repairedSettings.clock);
  repaired ||= JSON.stringify({ ...defaultSettings.transitions, ...input.transitions }) !== JSON.stringify(repairedSettings.transitions);

  return {
    settings: repairedSettings,
    repaired,
    warning: repaired ? 'Invalid settings were repaired; safe defaults are active for invalid fields.' : null
  };
};

const repairLayoutItem = (source: unknown, fallback: LayoutItem): { item: LayoutItem; repaired: boolean } => {
  if (!source || typeof source !== 'object') {
    return { item: fallback, repaired: true };
  }

  const record = source as Record<string, unknown>;
  const item: LayoutItem = {
    enabled: booleanOr(record.enabled, fallback.enabled),
    x: numberInRange(record.x, -1000, 1000, fallback.x),
    y: numberInRange(record.y, -1000, 1000, fallback.y),
    unit: oneOf(record.unit, units, fallback.unit),
    anchor: oneOf(record.anchor, anchors, fallback.anchor),
    width: numberInRange(record.width, 1, 4000, fallback.width),
    height: numberInRange(record.height, 1, 4000, fallback.height),
    scale: numberInRange(record.scale, 0.1, 4, fallback.scale),
    rotation: numberInRange(record.rotation, -360, 360, fallback.rotation),
    opacity: numberInRange(record.opacity, 0, 1, fallback.opacity),
    zIndex: Math.round(numberInRange(record.zIndex, -1000, 1000, fallback.zIndex)),
    responsive: record.responsive === 'none' || record.responsive === 'clamp-safe-area' ? record.responsive : fallback.responsive,
    safeAreaMargin: numberInRange(record.safeAreaMargin, 0, 400, fallback.safeAreaMargin),
    locked: booleanOr(record.locked, fallback.locked),
    participatesInTransition: booleanOr(record.participatesInTransition, fallback.participatesInTransition)
  };

  return { item, repaired: JSON.stringify(item) !== JSON.stringify(source) };
};

const numberInRange = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const booleanOr = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;

const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
