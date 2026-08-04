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
