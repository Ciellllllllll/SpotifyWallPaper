import type { LayoutItem, LayoutItemKey, LayoutPresetName, WallpaperSettings } from '@spotify-wallpaper/shared-types';

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
  trackText: item({ x: 52.5, y: 48, anchor: 'center-left', width: 620, height: 300, zIndex: 3 }),
  seekbar: item({ x: 52.5, y: 73, anchor: 'center-left', width: 440, height: 44, zIndex: 3 }),
  lyrics: item({ x: 68, y: 50, anchor: 'center', width: 560, height: 240, zIndex: 3 }),
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

export const layoutPresets: Record<LayoutPresetName, Record<LayoutItemKey, LayoutItem>> = {
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
  'Lyrics Focus': {
    ...leftDockItems,
    albumArt: item({ x: 8, y: 24, anchor: 'top-left', width: 260, height: 260 }),
    trackText: item({ x: 8, y: 60, anchor: 'center-left', width: 420, height: 180 }),
    seekbar: item({ x: 8, y: 78, anchor: 'center-left', width: 380, height: 44 }),
    lyrics: item({ x: 62, y: 50, anchor: 'center', width: 720, height: 340, zIndex: 4 })
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
    lyrics: item({ x: 50, y: 64, anchor: 'center', width: 720, height: 260, zIndex: 4 }),
    clock: item({ x: 96, y: 94, anchor: 'bottom-right', width: 220, height: 72, participatesInTransition: false })
  }
};

export const defaultLayoutPreset: LayoutPresetName = 'Left Dock';

export const layoutPresetNames = Object.keys(layoutPresets) as LayoutPresetName[];

export const clonePresetItems = (preset: LayoutPresetName): Record<LayoutItemKey, LayoutItem> =>
  structuredClone(layoutPresets[preset] ?? layoutPresets[defaultLayoutPreset]);

export const isLayoutPresetName = (value: unknown): value is LayoutPresetName =>
  typeof value === 'string' && value in layoutPresets;

export const withPresetItems = (settings: WallpaperSettings, preset: LayoutPresetName): WallpaperSettings => ({
  ...settings,
  layout: {
    ...settings.layout,
    preset,
    items: clonePresetItems(preset)
  }
});
