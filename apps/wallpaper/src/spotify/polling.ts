import type { NormalizedPlayback, SpotifyPlaybackError } from '@spotify-wallpaper/shared-types';
import type { LegacyWallpaperSettings as WallpaperSettings } from '@spotify-wallpaper/shared-types/legacy';
import { fetchCurrentPlayback, sendPlaybackCommand } from './client';
import { classifyNetworkError, classifySpotifyStatus } from './errors';
import { normalizeSpotifyPlayback } from './normalize';
import { refreshAccessToken, shouldRefreshToken } from './token';
import type { Fetcher, SpotifyCredentials, SpotifyPlaybackCommand, SpotifyResult, SpotifyTokenState } from './types';

const DEFAULT_PLAYING_INTERVAL_MS = 1000;
const DEFAULT_PAUSED_INTERVAL_MS = 3000;
const PUBLIC_BACKEND_PLAYING_INTERVAL_MS = 2000;
const PUBLIC_BACKEND_PAUSED_INTERVAL_MS = 5000;
const DEFAULT_ERROR_BACKOFF_MS = 5000;
const MAX_ERROR_BACKOFF_MS = 60_000;
const ACTIVE_TRANSIENT_ERROR_BACKOFF_MS = 5000;
const PRIMARY_ENDPOINT_DEGRADED_COOLDOWN_MS = 5000;

export interface PollDecisionInput {
  playback?: NormalizedPlayback | null;
  error?: SpotifyPlaybackError | null;
  consecutiveErrors?: number;
  settings?: WallpaperSettings;
}

export interface SpotifyPlaybackProvider {
  poll(nowMs?: number): Promise<SpotifyResult<NormalizedPlayback>>;
  control(command: SpotifyPlaybackCommand, nowMs?: number): Promise<SpotifyResult<void>>;
}

export interface BackendPlaybackProviderConfig {
  backendUrl: string;
  pairingToken: string;
}

export interface PlaybackHistory {
  playback: NormalizedPlayback;
  previousPlayback: NormalizedPlayback | null;
}

export class SpotifyPlaybackSession implements SpotifyPlaybackProvider {
  private token: SpotifyTokenState | null = null;
  private primaryPlaybackEndpointBlockedUntilMs = 0;

  constructor(
    private readonly credentials: SpotifyCredentials,
    private readonly fetcher: Fetcher = fetch
  ) {}

  async poll(nowMs = Date.now()): Promise<SpotifyResult<NormalizedPlayback>> {
    const token = await this.accessToken(nowMs);
    if (!token.ok) {
      return token;
    }

    const result = await fetchCurrentPlayback(token.value, this.fetcher, new Date(nowMs).toISOString(), {
      skipPrimaryEndpoint: nowMs < this.primaryPlaybackEndpointBlockedUntilMs
    });
    if (result.ok && result.degraded) {
      this.primaryPlaybackEndpointBlockedUntilMs = nowMs + PRIMARY_ENDPOINT_DEGRADED_COOLDOWN_MS;
    } else if (result.ok && nowMs >= this.primaryPlaybackEndpointBlockedUntilMs) {
      this.primaryPlaybackEndpointBlockedUntilMs = 0;
    }

    return result;
  }

  async control(command: SpotifyPlaybackCommand, nowMs = Date.now()): Promise<SpotifyResult<void>> {
    const token = await this.accessToken(nowMs);
    if (!token.ok) {
      return token;
    }

    return sendPlaybackCommand(token.value, command, this.fetcher);
  }

  private async accessToken(nowMs: number): Promise<SpotifyResult<string>> {
    if (shouldRefreshToken(this.token, nowMs)) {
      const refreshed = await refreshAccessToken(this.credentials, this.fetcher, nowMs);
      if (!refreshed.ok) {
        return refreshed;
      }

      this.token = refreshed.value;
    }

    if (!this.token) {
      return {
        ok: false,
        error: {
          kind: 'unauthorized',
          message: 'Spotify access token is unavailable.'
        }
      };
    }

    return { ok: true, value: this.token.accessToken };
  }
}

export class BackendPlaybackProvider implements SpotifyPlaybackProvider {
  constructor(
    private readonly config: BackendPlaybackProviderConfig,
    private readonly fetcher: Fetcher = fetch
  ) {}

  async poll(nowMs = Date.now()): Promise<SpotifyResult<NormalizedPlayback>> {
    const endpoint = this.endpoint('/api/playback');
    if (!endpoint.ok) {
      return endpoint;
    }

    let response: Response;
    try {
      response = await this.fetcher(endpoint.value, {
        method: 'GET',
        headers: this.headers(),
        ...backendFetchPolicy
      });
    } catch {
      return { ok: false, error: classifyNetworkError() };
    }

    if (!response.ok) {
      return { ok: false, error: await backendErrorFromResponse(response) };
    }

    const payload: unknown = await response.json().catch(() => null);
    const unwrapped = unwrapBackendPayload(payload);
    if (!unwrapped.ok) {
      return { ok: false, error: unwrapped.error };
    }

    if (isNormalizedPlayback(unwrapped.value)) {
      return { ok: true, value: { ...unwrapped.value, fetchedAt: unwrapped.value.fetchedAt || new Date(nowMs).toISOString() } };
    }

    const normalized = normalizeSpotifyPlayback(unwrapped.value as never, new Date(nowMs).toISOString());
    return normalized.ok ? { ok: true, value: normalized.value.playback, degraded: normalized.value.warning } : normalized;
  }

  async control(command: SpotifyPlaybackCommand, _nowMs = Date.now()): Promise<SpotifyResult<void>> {
    const endpoint = this.endpoint('/api/control');
    if (!endpoint.ok) {
      return endpoint;
    }

    let response: Response;
    try {
      response = await this.fetcher(endpoint.value, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'content-type': 'application/json'
        },
        body: JSON.stringify(command),
        ...backendFetchPolicy
      });
    } catch {
      return { ok: false, error: classifyNetworkError() };
    }

    if (response.ok || response.status === 204) {
      return { ok: true, value: undefined };
    }

    return { ok: false, error: await backendErrorFromResponse(response) };
  }

  private endpoint(path: string): SpotifyResult<string> {
    const baseUrl = normalizeBackendBaseUrl(this.config.backendUrl);
    if (!baseUrl.ok) {
      return baseUrl;
    }

    return { ok: true, value: new URL(path.replace(/^\//, ''), baseUrl.value).toString() };
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.pairingToken}`
    };
  }
}

export const hasSpotifyCredentials = (settings: WallpaperSettings): settings is WallpaperSettings & {
  spotify: WallpaperSettings['spotify'] & { refreshToken: string };
} => Boolean(settings.spotify.clientId && settings.spotify.refreshToken);

export const credentialsFromSettings = (settings: WallpaperSettings): SpotifyCredentials | null => {
  if (!hasSpotifyCredentials(settings)) {
    return null;
  }

  return {
    clientId: settings.spotify.clientId,
    refreshToken: settings.spotify.refreshToken
  };
};

export const backendConfigFromSettings = (settings: WallpaperSettings): BackendPlaybackProviderConfig | null => {
  if (settings.spotify.playbackProvider !== 'backend' || !settings.spotify.backendUrl || !settings.spotify.pairingToken) {
    return null;
  }

  const backendUrl = normalizeBackendBaseUrl(settings.spotify.backendUrl);
  if (!backendUrl.ok) {
    return null;
  }

  return {
    backendUrl: backendUrl.value,
    pairingToken: settings.spotify.pairingToken
  };
};

export const playbackProviderFromSettings = (
  settings: WallpaperSettings,
  fetcher: Fetcher = fetch
): SpotifyPlaybackProvider | null => {
  if (settings.spotify.playbackProvider === 'backend') {
    const backendConfig = backendConfigFromSettings(settings);
    return backendConfig
      ? new BackendPlaybackProvider(backendConfig, fetcher)
      : null;
  }

  const credentials = credentialsFromSettings(settings);
  return credentials ? new SpotifyPlaybackSession(credentials, fetcher) : null;
};

export const playbackHistoryAfterPoll = (
  history: PlaybackHistory,
  result: SpotifyResult<NormalizedPlayback>
): PlaybackHistory => {
  if (!result.ok) {
    return history;
  }
  if (
    history.playback.id !== result.value.id ||
    history.playback.itemType !== result.value.itemType
  ) {
    return {
      playback: result.value,
      previousPlayback: history.playback
    };
  }
  return {
    playback: result.value,
    previousPlayback: history.previousPlayback
  };
};

export const nextPollingDelayMs = ({ playback, error, consecutiveErrors = 0, settings }: PollDecisionInput): number => {
  const publicBackend = isTrustedPublicBackend(settings);
  const playingIntervalMs = pollingInterval(
    settings?.spotify.pollIntervalPlayingMs,
    DEFAULT_PLAYING_INTERVAL_MS,
    PUBLIC_BACKEND_PLAYING_INTERVAL_MS,
    publicBackend
  );
  const pausedIntervalMs = pollingInterval(
    settings?.spotify.pollIntervalPausedMs,
    DEFAULT_PAUSED_INTERVAL_MS,
    PUBLIC_BACKEND_PAUSED_INTERVAL_MS,
    publicBackend
  );

  if (error?.kind === 'rate_limited' && error.retryAfterMs !== undefined) {
    return Math.max(error.retryAfterMs, playingIntervalMs);
  }

  if (error) {
    if (
      playback?.isPlaying &&
      (error.kind === 'network_error' || error.kind === 'unavailable' || error.kind === 'unknown_response_shape')
    ) {
      return ACTIVE_TRANSIENT_ERROR_BACKOFF_MS;
    }

    const multiplier = Math.max(1, consecutiveErrors + 1);
    return Math.min(DEFAULT_ERROR_BACKOFF_MS * multiplier, MAX_ERROR_BACKOFF_MS);
  }

  if (playback?.isPlaying) {
    return playingIntervalMs;
  }

  return pausedIntervalMs;
};

const pollingInterval = (
  configured: number | undefined,
  localDefault: number,
  publicDefault: number,
  publicBackend: boolean
): number => {
  const value =
    publicBackend && (configured === undefined || configured === localDefault)
      ? publicDefault
      : configured;
  return clampInterval(value, publicBackend ? publicDefault : localDefault);
};

const clampInterval = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, 500), 60_000);
};

const normalizeBackendBaseUrl = (value: string): SpotifyResult<string> => {
  try {
    const url = new URL(value);
    if (
      !isCanonicalOriginInput(value, url) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== '/')
    ) {
      return invalidBackendUrl();
    }

    const isLoopback = url.protocol === 'http:' && isLoopbackHost(url.hostname);
    const officialOrigin = configuredOfficialBackendOrigin();
    const isOfficial =
      url.protocol === 'https:' &&
      officialOrigin !== null &&
      url.origin === officialOrigin;
    if (!isLoopback && !isOfficial) {
      return invalidBackendUrl();
    }

    return { ok: true, value: `${url.origin}/` };
  } catch {
    return invalidBackendUrl();
  }
};

const configuredOfficialBackendOrigin = (): string | null => {
  const value = import.meta.env.VITE_SPOTIFY_BACKEND_ORIGIN;
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      !isCanonicalOriginInput(value, url) ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== '/')
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

const isCanonicalOriginInput = (value: string, url: URL): boolean =>
  value === url.origin || value === `${url.origin}/`;

const isTrustedPublicBackend = (settings: WallpaperSettings | undefined): boolean => {
  if (
    settings?.spotify.playbackProvider !== 'backend' ||
    !settings.spotify.backendUrl
  ) {
    return false;
  }
  const normalized = normalizeBackendBaseUrl(settings.spotify.backendUrl);
  return normalized.ok && normalized.value.startsWith('https://');
};

const isLoopbackHost = (hostname: string): boolean => hostname === '127.0.0.1' || hostname === '[::1]';

const backendFetchPolicy = {
  redirect: 'error',
  credentials: 'omit',
  referrerPolicy: 'no-referrer'
} satisfies Pick<RequestInit, 'redirect' | 'credentials' | 'referrerPolicy'>;

const invalidBackendUrl = (): SpotifyResult<string> => ({
  ok: false,
  error: {
    kind: 'unavailable',
    message: 'Spotify backend URL is invalid.'
  }
});

const backendErrorFromResponse = async (response: Response): Promise<SpotifyPlaybackError> => {
  const payload = await response.json().catch(() => null);
  const unwrapped = unwrapBackendPayload(payload);
  return unwrapped.ok ? classifySpotifyStatus(response.status, response.headers.get('retry-after')) : unwrapped.error;
};

const unwrapBackendPayload = (payload: unknown): SpotifyResult<unknown> => {
  if (!payload || typeof payload !== 'object') {
    return { ok: true, value: payload };
  }

  const record = payload as Record<string, unknown>;
  if (record.ok === true) {
    return { ok: true, value: record.value };
  }

  if (record.ok === false && record.error && typeof record.error === 'object') {
    const error = record.error as Partial<SpotifyPlaybackError>;
    const kind =
      error.kind === 'unauthorized' ||
      error.kind === 'forbidden' ||
      error.kind === 'rate_limited' ||
      error.kind === 'network_error' ||
      error.kind === 'unavailable' ||
      error.kind === 'unknown_response_shape' ||
      error.kind === 'item_null'
        ? error.kind
        : 'unknown_response_shape';
    return {
      ok: false,
      error: {
        kind,
        message: backendErrorMessage(kind),
        retryAfterMs: validRetryAfterMs(error.retryAfterMs),
        status: typeof error.status === 'number' ? error.status : undefined
      }
    };
  }

  return { ok: true, value: payload };
};

const validRetryAfterMs = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 86_400_000
    ? value
    : undefined;

const backendErrorMessage = (
  kind: SpotifyPlaybackError['kind']
): string => {
  switch (kind) {
    case 'unauthorized':
      return 'Spotify authorization is required.';
    case 'forbidden':
      return 'Spotify playback access was denied.';
    case 'rate_limited':
      return 'Spotify rate limit reached.';
    case 'network_error':
      return 'Spotify backend network request failed.';
    case 'unavailable':
      return 'Spotify backend is unavailable.';
    case 'item_null':
      return 'Spotify has no current playback item.';
    case 'unknown_response_shape':
      return 'Spotify backend returned an unexpected response.';
  }
};

const isNormalizedPlayback = (value: unknown): value is NormalizedPlayback => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<NormalizedPlayback>;
  return (
    (record.source === 'spotify' || record.source === 'mock') &&
    (record.itemType === 'track' || record.itemType === 'episode' || record.itemType === 'none') &&
    typeof record.title === 'string' &&
    Array.isArray(record.artists) &&
    typeof record.durationMs === 'number' &&
    typeof record.progressMs === 'number' &&
    typeof record.isPlaying === 'boolean'
  );
};
