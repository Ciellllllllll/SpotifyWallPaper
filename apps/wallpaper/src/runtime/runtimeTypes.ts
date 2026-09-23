import type {
  NormalizedPlayback,
  SpotifyPlaybackError,
  VisualizerFrame,
  VisualizerMotionState,
  WallpaperPreferences,
  WallpaperTheme,
  PlaybackCommand,
  PlaybackProvider
} from '@spotify-wallpaper/shared-types';
import type { AlbumThemeExtraction } from '../theme/extractAlbumTheme';
import type { TrackTransitionState } from '../transitions/model';
import type { CredentialUpdate } from '../wallpaperEngine/types';
import type { DirectCredentialStore } from '../spotify/credentialStore';
import { selectPlaybackProvider } from '../spotify/providers/factory';
import { startAudioBridge } from '../wallpaperEngine/audio';
import { extractAlbumTheme } from '../theme/extractAlbumTheme';

export const SILENCE_RELEASE_MS = 450;
export const FALLBACK_VISUALIZER_COLOR = '#ffffff';

export interface WallpaperRuntimeSnapshot {
  settings: WallpaperPreferences;
  playback: NormalizedPlayback;
  previousPlayback: NormalizedPlayback | null;
  spotifyError: SpotifyPlaybackError | null;
  controlError: SpotifyPlaybackError | null;
  controlBusy: boolean;
  playbackMode: string;
  providerSelection: 'mock' | 'ready' | 'invalid';
  providerConfigurationError: string | null;
  lastPollingDelayMs: number | null;
  consecutiveErrors: number;
  nowMs: number;
  progressNowMs: number;
  visualizerFrame: VisualizerFrame | null;
  previousVisualizerFrame: VisualizerFrame | null;
  visualizerMotion: VisualizerMotionState;
  visualizerColor: string;
  theme: WallpaperTheme;
  transitionState: TrackTransitionState | null;
  credentialStatus: { kind: 'none' | 'direct' | 'backend'; present: boolean; revision: number };
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Date
    ? Readonly<T>
    : T extends readonly (infer U)[]
      ? ReadonlyArray<DeepReadonly<U>>
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export type ReadonlyWallpaperRuntimeSnapshot = DeepReadonly<WallpaperRuntimeSnapshot>;

export interface WallpaperRuntime {
  enableCredentialStore(store: DirectCredentialStore): void;
  start(): void;
  subscribe(listener: (snapshot: ReadonlyWallpaperRuntimeSnapshot) => void): () => void;
  applyConfiguration(settings: WallpaperPreferences, credential: CredentialUpdate, safetyGateOpen: boolean, providerSelectionExplicit?: boolean): void;
  acceptAudioFrame(frame: VisualizerFrame): void;
  execute(command: PlaybackCommand): Promise<void>;
  toggleDisplayMode(): void;
  dispose(): void;
}

export interface WallpaperRuntimeDependencies {
  credentialStore?: DirectCredentialStore;
  selectProvider?: typeof selectPlaybackProvider;
  startAudioBridge?: typeof startAudioBridge;
  extractTheme?: typeof extractAlbumTheme;
}

export const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
};

export const sanitizeProviderError = (error: SpotifyPlaybackError): SpotifyPlaybackError => {
  const status = error.status;
  const retryAfterMs = error.retryAfterMs;
  const safeStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const safeRetryAfterMs = typeof retryAfterMs === 'number' && Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0
    ? Math.round(retryAfterMs)
    : undefined;
  return {
    kind: error.kind,
    message: error.kind === 'rate_limited' && error.quotaExceeded === true ? 'Spotify開発者アカウントのquota上限です。再認証せず時間をおいてください。' : safeProviderErrorMessage(error.kind),
    ...(error.quotaExceeded === true ? { quotaExceeded: true } : {}),
    ...(safeStatus === undefined ? {} : { status: safeStatus }),
    ...(safeRetryAfterMs === undefined ? {} : { retryAfterMs: safeRetryAfterMs })
  };
};

export const safeProviderErrorMessage = (kind: SpotifyPlaybackError['kind']): string => {
  switch (kind) {
    case 'unauthorized': return 'Spotify authorization is required.';
    case 'forbidden': return 'Spotify playback access was denied.';
    case 'rate_limited': return 'Spotify rate limit reached.';
    case 'network_error': return 'Spotify network request failed.';
    case 'storage_error': return 'Spotify認証情報を保存・復元できません。保存領域を確認して再接続してください。';
    case 'unavailable': return 'Spotify is temporarily unavailable.';
    case 'unknown_response_shape': return 'Spotify returned an unsupported response.';
    case 'item_null': return 'Spotify is not currently playing an item.';
  }
};

export const retainsPlaybackEligibility = (kind: SpotifyPlaybackError['kind']): boolean =>
  kind === 'network_error' || kind === 'rate_limited' || kind === 'unknown_response_shape';
