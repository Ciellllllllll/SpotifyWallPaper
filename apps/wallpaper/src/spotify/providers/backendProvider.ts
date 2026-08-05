import {
  isNormalizedPlaybackResultEnvelope,
  isProviderResultEnvelope,
  type NormalizedPlayback,
  type PlaybackCommand,
  type PlaybackProvider
} from '@spotify-wallpaper/shared-types';
import { classifyNetworkError, classifySpotifyStatus } from '../errors';
import type { Fetcher, SpotifyResult } from '../types';
import { mergeAbortSignals } from './signals';

export interface BackendPlaybackProviderConfig {
  backendUrl: string;
  pairingToken: string;
}

export class BackendPlaybackProvider implements PlaybackProvider {
  readonly kind = 'backend' as const;
  private readonly abortController = new AbortController();
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly config: BackendPlaybackProviderConfig,
    private readonly fetcher: Fetcher = fetch
  ) {}

  async poll(signal: AbortSignal): Promise<SpotifyResult<NormalizedPlayback>> {
    return this.pollAt(Date.now(), signal);
  }

  async pollAt(nowMs = Date.now(), signal: AbortSignal = this.abortController.signal): Promise<SpotifyResult<NormalizedPlayback>> {
    const generation = this.generation;
    try {
      const effectiveSignal = mergeAbortSignals(this.abortController.signal, signal);
      try {
        if (this.disposed || effectiveSignal.signal.aborted) return disposedError();
        const endpoint = this.endpoint('/api/playback');
        if (!endpoint.ok) return endpoint;

        let response: Response;
        try {
          response = await this.fetcher(endpoint.value, {
            method: 'GET', headers: this.headers(), signal: effectiveSignal.signal, ...backendFetchPolicy
          });
        } catch {
          return { ok: false, error: classifyNetworkError() };
        }
        if (this.disposed || generation !== this.generation) return disposedError();
        if (!response.ok) return { ok: false, error: await backendErrorFromResponse(response) };

        const payload: unknown = await response.json().catch(() => null);
        if (this.disposed || generation !== this.generation) return disposedError();
        if (!isNormalizedPlaybackResultEnvelope(payload) || (payload.ok && payload.value.source !== 'spotify')) {
          return { ok: false, error: { kind: 'unknown_response_shape', message: 'Spotify backend returned an unexpected response.' } };
        }
        if (!payload.ok) return payload;
        return { ok: true, value: { ...payload.value, fetchedAt: payload.value.fetchedAt || new Date(nowMs).toISOString() } };
      } finally {
        effectiveSignal.cleanup();
      }
    } catch {
      return disposedError();
    }
  }

  async control(command: PlaybackCommand, signal: AbortSignal): Promise<SpotifyResult<void>> {
    return this.controlAt(command, Date.now(), signal);
  }

  async controlAt(command: PlaybackCommand, _nowMs = Date.now(), signal: AbortSignal = this.abortController.signal): Promise<SpotifyResult<void>> {
    const generation = this.generation;
    try {
      const effectiveSignal = mergeAbortSignals(this.abortController.signal, signal);
      try {
        if (this.disposed || effectiveSignal.signal.aborted) return disposedError();
        const endpoint = this.endpoint('/api/control');
        if (!endpoint.ok) return endpoint;

        let response: Response;
        try {
          response = await this.fetcher(endpoint.value, {
            method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json' },
            body: JSON.stringify(command), signal: effectiveSignal.signal, ...backendFetchPolicy
          });
        } catch {
          return { ok: false, error: classifyNetworkError() };
        }
        if (this.disposed || generation !== this.generation) return disposedError();
        if (response.status === 204) return { ok: true, value: undefined };
        const payload: unknown = await response.json().catch(() => null);
        if (this.disposed || generation !== this.generation) return disposedError();
        if (!response.ok) return { ok: false, error: backendErrorFromPayload(payload, response) };
        if (!isProviderResultEnvelope(payload)) {
          return { ok: false, error: { kind: 'unknown_response_shape', message: 'Spotify backend returned an unexpected response.' } };
        }
        if (!payload.ok) return payload;
        return payload.value === null
          ? { ok: true, value: undefined }
          : { ok: false, error: { kind: 'unknown_response_shape', message: 'Spotify backend returned an unexpected response.' } };
      } finally {
        effectiveSignal.cleanup();
      }
    } catch {
      return disposedError();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.abortController.abort();
  }

  private endpoint(path: string): SpotifyResult<string> {
    const baseUrl = normalizeBackendBaseUrl(this.config.backendUrl);
    if (!baseUrl.ok) return baseUrl;
    return { ok: true, value: new URL(path.replace(/^\//, ''), baseUrl.value).toString() };
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.config.pairingToken}` };
  }
}

const backendFetchPolicy = {
  redirect: 'error',
  credentials: 'omit',
  referrerPolicy: 'no-referrer'
} satisfies Pick<RequestInit, 'redirect' | 'credentials' | 'referrerPolicy'>;

const backendErrorFromResponse = async (response: Response) => {
  const payload: unknown = await response.clone().json().catch(() => null);
  return backendErrorFromPayload(payload, response);
};

const backendErrorFromPayload = (payload: unknown, response: Response) => {
  if (isProviderResultEnvelope(payload) && !payload.ok) {
    return {
      kind: payload.error.kind,
      message: backendErrorMessage(payload.error.kind),
      retryAfterMs: validRetryAfterMs(payload.error.retryAfterMs),
      status: payload.error.status ?? response.status
    } as const;
  }
  return classifySpotifyStatus(response.status, response.headers.get('retry-after'));
};

const validRetryAfterMs = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 86_400_000 ? value : undefined;

const backendErrorMessage = (kind: 'unauthorized' | 'forbidden' | 'rate_limited' | 'network_error' | 'unavailable' | 'unknown_response_shape' | 'item_null'): string => {
  switch (kind) {
    case 'unauthorized': return 'Spotify authorization is required.';
    case 'forbidden': return 'Spotify playback access was denied.';
    case 'rate_limited': return 'Spotify rate limit reached.';
    case 'network_error': return 'Spotify backend network request failed.';
    case 'unavailable': return 'Spotify backend is unavailable.';
    case 'item_null': return 'Spotify has no current playback item.';
    case 'unknown_response_shape': return 'Spotify backend returned an unexpected response.';
  }
};

export const normalizeBackendBaseUrl = (value: string): SpotifyResult<string> => {
  try {
    const url = new URL(value);
    if (!isCanonicalOriginInput(value, url) || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
      return invalidBackendUrl();
    }
    const isLoopback = url.protocol === 'http:' && isLoopbackHost(url.hostname);
    const officialOrigin = configuredOfficialBackendOrigin();
    const isOfficial = url.protocol === 'https:' && officialOrigin !== null && url.origin === officialOrigin;
    return isLoopback || isOfficial ? { ok: true, value: `${url.origin}/` } : invalidBackendUrl();
  } catch {
    return invalidBackendUrl();
  }
};

export const isTrustedPublicBackendOrigin = (value: string): boolean => {
  const normalized = normalizeBackendBaseUrl(value);
  return normalized.ok && normalized.value.startsWith('https://');
};

const configuredOfficialBackendOrigin = (): string | null => {
  const value = import.meta.env.VITE_SPOTIFY_BACKEND_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && isCanonicalOriginInput(value, url) && !url.username && !url.password && !url.search && !url.hash && (!url.pathname || url.pathname === '/')
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

const isCanonicalOriginInput = (value: string, url: URL): boolean => value === url.origin || value === `${url.origin}/`;
const isLoopbackHost = (hostname: string): boolean => hostname === '127.0.0.1' || hostname === '[::1]';
const invalidBackendUrl = (): SpotifyResult<string> => ({ ok: false, error: { kind: 'unavailable', message: 'Spotify backend URL is invalid.' } });
const disposedError = (): SpotifyResult<never> => ({ ok: false, error: { kind: 'unavailable', message: 'Spotify backend provider is disposed.' } });
