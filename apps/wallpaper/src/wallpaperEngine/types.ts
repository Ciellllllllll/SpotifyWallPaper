import type { PlaybackProviderKind, WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import type { CredentialInput } from '../settings/credentialBoundary';

export interface WallpaperEngineProperty {
  value?: unknown;
}

export type WallpaperEngineProperties = Record<string, WallpaperEngineProperty>;

export interface SettingsPatch {
  schemaVersion?: number;
  spotify?: Partial<WallpaperPreferences['spotify']>;
  layout?: Partial<WallpaperPreferences['layout']>;
  theme?: Partial<WallpaperPreferences['theme']>;
  background?: Partial<WallpaperPreferences['background']>;
  albumArt?: Partial<WallpaperPreferences['albumArt']>;
  text?: Partial<WallpaperPreferences['text']>;
  player?: Partial<WallpaperPreferences['player']>;
  seekbar?: Partial<WallpaperPreferences['seekbar']>;
  visualizer?: Partial<WallpaperPreferences['visualizer']>;
  clock?: Partial<WallpaperPreferences['clock']>;
  transitions?: Partial<WallpaperPreferences['transitions']>;
  performance?: Partial<WallpaperPreferences['performance']>;
  rainmeter?: Partial<WallpaperPreferences['rainmeter']>;
  debug?: Partial<WallpaperPreferences['debug']>;
}

export interface WallpaperPropertyResult {
  patch: SettingsPatch;
  warning: string | null;
  credential: CredentialUpdate;
  safetyGateOpen: boolean;
  settingsReplacement?: WallpaperPreferences;
}

export type ProviderHint = () => PlaybackProviderKind;

export type CredentialUpdate =
  | { kind: 'retain' }
  | { kind: 'clear' }
  | { kind: 'replace'; value: CredentialInput };

export type WallpaperAudioListener = (samples: number[] | Float32Array) => void;

declare global {
  interface Window {
    wallpaperPropertyListener?: {
      applyUserProperties?: (properties: WallpaperEngineProperties) => void;
    };
    wallpaperRegisterAudioListener?: (listener: WallpaperAudioListener) => void;
  }
}
