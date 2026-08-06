import type { VisualizerFrame } from './audio';
import type { NormalizedPlayback } from './playback';
import type { PlaybackCommand, ProviderSelection } from './provider';
import type { WallpaperPreferences } from './settings';
import type { WallpaperTheme } from './theme';

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Date
    ? Readonly<T>
    : T extends readonly (infer U)[]
      ? ReadonlyArray<DeepReadonly<U>>
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export type LayoutUnit = 'percent' | 'px' | 'vw' | 'vh';

export type LayoutAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type LayoutItemKey = 'albumArt' | 'trackText' | 'seekbar' | 'clock' | 'debug';

export type LayoutPresetName =
  | 'Minimal'
  | 'Center Album'
  | 'Visualizer Heavy'
  | 'Rainmeter Hybrid'
  | 'Left Dock'
  | 'Bottom Player'
  | 'Clock Focus'
  | 'Album Ring'
  | 'Ambient Background';

export interface LayoutItem {
  enabled: boolean;
  x: number;
  y: number;
  unit: LayoutUnit;
  anchor: LayoutAnchor;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  responsive: 'none' | 'clamp-safe-area';
  safeAreaMargin: number;
  locked: boolean;
  participatesInTransition: boolean;
}

export type DisplayMode = 'album-only' | 'album-details';

export interface ExistingPlayerPreferences {
  visible: boolean;
  controlsEnabled: boolean;
  showDevice: boolean;
  showVolume: boolean;
  showShuffleRepeat: boolean;
}

export interface WallpaperViewTransition {
  readonly previous: DeepReadonly<NormalizedPlayback>;
  readonly current: DeepReadonly<NormalizedPlayback>;
  readonly durationMs: number;
  readonly easing: string;
  readonly resolvedPreset: WallpaperPreferences['transitions']['preset'];
}

export interface WallpaperViewModel {
  readonly settings: DeepReadonly<WallpaperPreferences>;
  readonly playback: DeepReadonly<NormalizedPlayback>;
  readonly previousPlayback: DeepReadonly<NormalizedPlayback> | null;
  readonly visualizerFrame: DeepReadonly<VisualizerFrame> | null;
  readonly theme: DeepReadonly<WallpaperTheme>;
  readonly transitionState: WallpaperViewTransition | null;
  readonly nowMs: number;
  readonly progressNowMs: number;
  readonly playbackMode: string;
  readonly providerSelection: ProviderSelection['kind'];
  readonly providerConfigurationError: string | null;
  readonly spotifyStatusText: string;
  readonly controlStatusText: string;
  readonly controlBusy: boolean;
  readonly canControlPlayback: boolean;
  readonly lastPollingDelayMs: number | null;
  readonly consecutiveErrors: number;
  readonly visualCoreStatus: 'wasm' | 'typescript-fallback';
  readonly credentialConfigured: boolean;
  readonly settingsWarning: string | null;
  readonly settingsSource: string;
}

export type WallpaperViewIntent = PlaybackCommand | { type: 'toggle-display-mode' };
