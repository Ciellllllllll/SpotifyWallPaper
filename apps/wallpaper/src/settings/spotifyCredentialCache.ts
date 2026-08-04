import type { LegacyWallpaperSettings as WallpaperSettings } from '@spotify-wallpaper/shared-types/legacy';

export const SPOTIFY_CREDENTIAL_STORAGE_KEY = 'spotify-wallpaper-spotify-credentials';

export interface StoredSpotifyCredentials {
  clientId: string;
  refreshToken: string;
}

type StorageTarget = Pick<Window, 'localStorage'>;

export const readStoredSpotifyCredentials = (
  target: StorageTarget | undefined = currentWindow()
): StoredSpotifyCredentials | null => {
  if (!target) {
    return null;
  }

  try {
    const raw = target.localStorage.getItem(SPOTIFY_CREDENTIAL_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clientId = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : '';
    const refreshToken = typeof parsed.refreshToken === 'string' ? parsed.refreshToken.trim() : '';
    return clientId && refreshToken ? { clientId, refreshToken } : null;
  } catch {
    return null;
  }
};

export const persistSpotifyCredentials = (
  settings: WallpaperSettings,
  target: StorageTarget | undefined = currentWindow()
): void => {
  if (!target) {
    return;
  }

  try {
    if (!settings.spotify.hasRefreshToken || !settings.spotify.clientId || !settings.spotify.refreshToken) {
      target.localStorage.removeItem(SPOTIFY_CREDENTIAL_STORAGE_KEY);
      return;
    }

    target.localStorage.setItem(
      SPOTIFY_CREDENTIAL_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        clientId: settings.spotify.clientId,
        refreshToken: settings.spotify.refreshToken
      })
    );
  } catch {
    // Persistence is a convenience fallback; failing to write must not break the wallpaper.
  }
};

export const clearStoredSpotifyCredentials = (target: StorageTarget | undefined = currentWindow()): void => {
  try {
    target?.localStorage.removeItem(SPOTIFY_CREDENTIAL_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
};

const currentWindow = (): StorageTarget | undefined => (typeof window === 'undefined' ? undefined : window);
