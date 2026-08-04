import type { PlaybackProviderKind } from './provider';
import type { WallpaperPreferenceSections } from './settings';

/**
 * Explicit legacy input boundary. This module is intentionally not re-exported
 * from the v2 root entry point; consumers should migrate before serialization.
 */
export interface LegacyWallpaperSettings extends WallpaperPreferenceSections {
  schemaVersion: 1;
  spotify: {
    playbackProvider?: PlaybackProviderKind;
    clientId: string;
    refreshToken?: string;
    hasRefreshToken: boolean;
    backendUrl?: string;
    pairingToken?: string;
    pollIntervalPlayingMs?: number;
    pollIntervalPausedMs?: number;
  };
}

/** Input accepted by the legacy repair adapter before it clamps to v1. */
export type LegacyWallpaperSettingsInput = Omit<LegacyWallpaperSettings, 'schemaVersion'> & {
  schemaVersion: number;
};
