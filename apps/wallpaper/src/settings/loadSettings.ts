import {
  defaultWallpaperPreferences,
  type WallpaperPreferences
} from '@spotify-wallpaper/shared-types';
import { loadWallpaperPreferences } from './loadPreferences';

const SETTINGS_GLOBAL = '__SPOTIFY_WALLPAPER_SETTINGS__';
const SETTINGS_STORAGE_KEY = 'spotify-wallpaper-settings';

declare global {
  interface Window {
    __SPOTIFY_WALLPAPER_SETTINGS__?: unknown;
  }
}

export interface LoadedSettings {
  settings: WallpaperPreferences;
  warning: string | null;
  networkAllowed: boolean;
  reauthorizationRequired: boolean;
  safetyGateOpen: boolean;
}

type StorageTarget = Pick<Window, 'localStorage'>;

export const loadSettings = (
  source: unknown = undefined,
  storageTarget: StorageTarget | undefined = currentWindow()
): LoadedSettings => {
  const sourceResult = source === undefined
    ? readDefaultSettingsSource(storageTarget)
    : { value: source, fromStorage: false };
  if (sourceResult.readFailed) {
    return {
      settings: defaultWallpaperPreferences(),
      warning: 'Legacy settings could not be read; Spotify network is disabled.',
      networkAllowed: false,
      reauthorizationRequired: false,
      safetyGateOpen: false
    };
  }
  const loaded = loadWallpaperPreferences(sourceResult.value, storageTarget);
  if (sourceResult.fromStorage && storageTarget) {
    try {
      // The legacy settings document may contain embedded credentials. Remove it
      // and only write back the allowlisted, secret-free v2 preferences.
      storageTarget.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      if (loaded.storageRewriteAllowed) {
        // `loaded.preferences` has already passed the shared v2 repair/migration
        // boundary, so serializing this object cannot reintroduce legacy fields.
        storageTarget.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(loaded.preferences));
      }
    } catch {
      return {
        settings: defaultWallpaperPreferences(),
        warning: 'Legacy settings cleanup failed; Spotify network is disabled.',
        networkAllowed: false,
        reauthorizationRequired: false,
        safetyGateOpen: false
      };
    }
  }
  return {
    settings: loaded.preferences,
    warning: loaded.warning,
    networkAllowed: loaded.networkAllowed,
    reauthorizationRequired: loaded.reauthorizationRequired,
    safetyGateOpen: loaded.safetyGateOpen
  };
};

const readDefaultSettingsSource = (target: StorageTarget | undefined = currentWindow()): {
  value: unknown;
  fromStorage: boolean;
  readFailed?: boolean;
} => {
  if (!target) {
    return { value: defaultWallpaperPreferences(), fromStorage: false };
  }

  const globalSettings = (target as Window & { __SPOTIFY_WALLPAPER_SETTINGS__?: unknown })[SETTINGS_GLOBAL];
  if (globalSettings !== undefined) {
    return { value: globalSettings, fromStorage: false };
  }

  try {
    const value = target.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return value === null ? { value: defaultWallpaperPreferences(), fromStorage: false } : { value, fromStorage: true };
  } catch {
    return { value: defaultWallpaperPreferences(), fromStorage: false, readFailed: true };
  }
};

const currentWindow = (): (Window & { __SPOTIFY_WALLPAPER_SETTINGS__?: unknown }) | undefined =>
  typeof window === 'undefined' ? undefined : window;
