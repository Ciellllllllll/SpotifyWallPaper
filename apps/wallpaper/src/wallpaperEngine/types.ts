import type { PlaybackProviderKind, WallpaperPreferences, WallpaperPreferencesPatch } from '@spotify-wallpaper/shared-types';
import type { CredentialInput } from '../settings/credentialBoundary';

export interface WallpaperEngineProperty {
  value?: unknown;
}

export type WallpaperEngineProperties = Record<string, WallpaperEngineProperty>;

export interface WallpaperPropertyResult {
  patch: WallpaperPreferencesPatch;
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
