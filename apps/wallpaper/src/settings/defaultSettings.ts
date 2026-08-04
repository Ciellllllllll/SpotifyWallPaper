import { defaultWallpaperPreferences } from '@spotify-wallpaper/shared-types';
import type { LegacyWallpaperSettings as WallpaperSettings } from '@spotify-wallpaper/shared-types/legacy';

const preferences = defaultWallpaperPreferences();
const { displayMode: _displayMode, ...legacyPlayer } = preferences.player;

/**
 * Legacy v1 adapter retained until Phase 3 settings cutover.
 * All display defaults come from the shared v2 authority.
 */
export const defaultSettings: WallpaperSettings = {
  ...preferences,
  schemaVersion: 1,
  spotify: {
    playbackProvider: 'direct',
    clientId: '',
    hasRefreshToken: false,
    backendUrl: '',
    pollIntervalPlayingMs: preferences.spotify.pollIntervalPlayingMs,
    pollIntervalPausedMs: preferences.spotify.pollIntervalPausedMs
  },
  player: legacyPlayer
};
