import type { WallpaperViewModel } from '@spotify-wallpaper/shared-types';
import type { ReadonlyWallpaperRuntimeSnapshot } from './runtime/wallpaperRuntime';

export interface WallpaperViewHostState {
  settingsWarning: string | null;
  settingsSource: string;
  visualCoreStatus: 'wasm' | 'typescript-fallback';
}

export const toWallpaperViewModel = (
  snapshot: ReadonlyWallpaperRuntimeSnapshot,
  host: WallpaperViewHostState
): WallpaperViewModel => ({
  settings: snapshot.settings,
  playback: snapshot.playback,
  previousPlayback: snapshot.previousPlayback,
  visualizerFrame: snapshot.visualizerFrame,
  theme: snapshot.theme,
  transitionState: snapshot.transitionState
    ? {
        previous: snapshot.transitionState.previous,
        current: snapshot.transitionState.current,
        durationMs: snapshot.transitionState.durationMs,
        easing: snapshot.transitionState.easing,
        resolvedPreset: snapshot.transitionState.resolvedPreset
      }
    : null,
  nowMs: snapshot.nowMs,
  progressNowMs: snapshot.progressNowMs,
  playbackMode: snapshot.playbackMode,
  providerSelection: snapshot.providerSelection,
  providerConfigurationError: snapshot.providerConfigurationError,
  spotifyStatusText: snapshot.providerConfigurationError
    ?? (snapshot.spotifyError
      ? `${snapshot.spotifyError.kind}${snapshot.spotifyError.status ? ` ${snapshot.spotifyError.status}` : ''}: ${snapshot.spotifyError.message}`
      : 'ok'),
  controlStatusText: snapshot.controlError?.message
    ?? (snapshot.playback.device?.isRestricted ? 'Current Spotify device is restricted.' : ''),
  controlBusy: snapshot.controlBusy,
  canControlPlayback:
    snapshot.providerSelection === 'ready'
    && snapshot.playback.source === 'spotify'
    && snapshot.settings.player.controlsEnabled
    && !snapshot.playback.device?.isRestricted
    && !snapshot.controlBusy,
  lastPollingDelayMs: snapshot.lastPollingDelayMs,
  consecutiveErrors: snapshot.consecutiveErrors,
  visualCoreStatus: host.visualCoreStatus,
  credentialConfigured: snapshot.credentialStatus.present,
  settingsWarning: host.settingsWarning,
  settingsSource: host.settingsSource
});
