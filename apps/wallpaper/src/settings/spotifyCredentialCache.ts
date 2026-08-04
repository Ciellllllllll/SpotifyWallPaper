export const SPOTIFY_CREDENTIAL_STORAGE_KEY = 'spotify-wallpaper-spotify-credentials';

export interface LegacyCredentialCleanupResult {
  attempted: boolean;
  succeeded: boolean;
}

type StorageTarget = Pick<Window, 'localStorage'>;

export const cleanupLegacySpotifyCredentialStorage = (
  target: StorageTarget | undefined = currentWindow()
): LegacyCredentialCleanupResult => {
  if (!target) {
    return { attempted: false, succeeded: false };
  }

  try {
    target.localStorage.removeItem(SPOTIFY_CREDENTIAL_STORAGE_KEY);
    return { attempted: true, succeeded: true };
  } catch {
    return { attempted: true, succeeded: false };
  }
};

const currentWindow = (): StorageTarget | undefined => (typeof window === 'undefined' ? undefined : window);
