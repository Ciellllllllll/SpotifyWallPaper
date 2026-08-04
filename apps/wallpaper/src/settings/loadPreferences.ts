import {
  defaultWallpaperPreferences,
  migrateWallpaperSettingsToV2,
  type WallpaperPreferences
} from '@spotify-wallpaper/shared-types';
import {
  cleanupLegacySpotifyCredentialStorage,
  type LegacyCredentialCleanupResult
} from './spotifyCredentialCache';

export interface LoadedWallpaperPreferences {
  preferences: WallpaperPreferences;
  warning: string | null;
  reauthorizationRequired: boolean;
  networkAllowed: boolean;
  /** Monotonic safety decision: malformed/future input or failed cleanup cannot re-enable network. */
  safetyGateOpen: boolean;
  /** Whether the source may be replaced with the sanitized v2 document. */
  storageRewriteAllowed: boolean;
  cleanup: LegacyCredentialCleanupResult;
}

type StorageTarget = Pick<Window, 'localStorage'>;

export const loadWallpaperPreferences = (
  source: unknown,
  storageTarget: StorageTarget | undefined = currentWindow()
): LoadedWallpaperPreferences => {
  const cleanup = cleanupLegacySpotifyCredentialStorage(storageTarget);
  if (cleanup.attempted && !cleanup.succeeded) {
    return {
      preferences: defaultWallpaperPreferences(),
      warning: 'Legacy credential cleanup failed; Spotify network is disabled.',
      reauthorizationRequired: false,
      networkAllowed: false,
      safetyGateOpen: false,
      storageRewriteAllowed: false,
      cleanup
    };
  }

  const migrated = migrateWallpaperSettingsToV2(
    source === undefined || source === null || source === '' ? defaultWallpaperPreferences() : source
  );
  const networkAllowed =
    (migrated.status === 'valid' || migrated.status === 'repaired' || migrated.status === 'migrated') &&
    migrated.preferences.spotify.provider === 'mock';
  const safetyGateOpen = migrated.status !== 'malformed' && migrated.status !== 'future';
  const storageRewriteAllowed = safetyGateOpen;

  return {
    preferences: migrated.preferences,
    warning: migrated.warning,
    reauthorizationRequired: migrated.reauthorizationRequired,
    networkAllowed,
    safetyGateOpen,
    storageRewriteAllowed,
    cleanup
  };
};

const currentWindow = (): StorageTarget | undefined => (typeof window === 'undefined' ? undefined : window);
