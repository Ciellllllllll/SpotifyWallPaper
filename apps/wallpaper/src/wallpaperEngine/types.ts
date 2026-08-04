import type { LegacyWallpaperSettings as WallpaperSettings } from '@spotify-wallpaper/shared-types/legacy';

export interface WallpaperEngineProperty {
  value?: unknown;
}

export type WallpaperEngineProperties = Record<string, WallpaperEngineProperty>;

export interface SettingsPatch {
  schemaVersion?: number;
  spotify?: Partial<WallpaperSettings['spotify']>;
  layout?: Partial<WallpaperSettings['layout']>;
  theme?: Partial<WallpaperSettings['theme']>;
  background?: Partial<WallpaperSettings['background']>;
  albumArt?: Partial<WallpaperSettings['albumArt']>;
  text?: Partial<WallpaperSettings['text']>;
  player?: Partial<WallpaperSettings['player']>;
  seekbar?: Partial<WallpaperSettings['seekbar']>;
  visualizer?: Partial<WallpaperSettings['visualizer']>;
  clock?: Partial<WallpaperSettings['clock']>;
  transitions?: Partial<WallpaperSettings['transitions']>;
  performance?: Partial<WallpaperSettings['performance']>;
  rainmeter?: Partial<WallpaperSettings['rainmeter']>;
  debug?: Partial<WallpaperSettings['debug']>;
}

export interface WallpaperPropertyResult {
  patch: SettingsPatch;
  warning: string | null;
}

export type WallpaperAudioListener = (samples: number[] | Float32Array) => void;

declare global {
  interface Window {
    wallpaperPropertyListener?: {
      applyUserProperties?: (properties: WallpaperEngineProperties) => void;
    };
    wallpaperRegisterAudioListener?: (listener: WallpaperAudioListener) => void;
  }
}
