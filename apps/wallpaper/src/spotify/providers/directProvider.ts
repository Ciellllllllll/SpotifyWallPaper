import type { NormalizedPlayback, PlaybackCommand, PlaybackProvider } from '@spotify-wallpaper/shared-types';
import { fetchCurrentPlayback, sendPlaybackCommand } from '../client';
import { refreshAccessToken, shouldRefreshToken } from '../token';
import type { Fetcher, SpotifyCredentials, SpotifyResult, SpotifyTokenState } from '../types';
import { mergeAbortSignals } from './signals';

const PRIMARY_ENDPOINT_DEGRADED_COOLDOWN_MS = 5000;

export class DirectPlaybackProvider implements PlaybackProvider {
  readonly kind = 'direct' as const;
  private token: SpotifyTokenState | null = null;
  private refreshPromise: Promise<SpotifyResult<SpotifyTokenState>> | null = null;
  private refreshToken: string;
  private reauthorizationRequired = false;
  private primaryPlaybackEndpointBlockedUntilMs = 0;
  private disposed = false;
  private generation = 0;
  private readonly abortController = new AbortController();

  constructor(
    private readonly credentials: SpotifyCredentials,
    private readonly fetcher: Fetcher = fetch
  ) {
    this.refreshToken = credentials.refreshToken;
  }

  async poll(signal: AbortSignal): Promise<SpotifyResult<NormalizedPlayback>> {
    return this.pollAt(Date.now(), signal);
  }

  async pollAt(nowMs = Date.now(), signal: AbortSignal = this.abortController.signal): Promise<SpotifyResult<NormalizedPlayback>> {
    const generation = this.generation;
    const mergedSignal = mergeAbortSignals(this.abortController.signal, signal);
    try {
      const token = await this.accessToken(nowMs, mergedSignal.signal, generation);
      if (!token.ok) return token;

      let result = await this.fetchPlayback(token.value, nowMs, mergedSignal.signal);
      if (generation !== this.generation || this.disposed) return disposedError();
      if (!result.ok && result.error.kind === 'unauthorized') {
        this.token = null;
        const retryToken = await this.accessToken(nowMs, mergedSignal.signal, generation);
        if (retryToken.ok) result = await this.fetchPlayback(retryToken.value, nowMs, mergedSignal.signal);
      }
      if (generation !== this.generation || this.disposed) return disposedError();
      return result;
    } finally {
      mergedSignal.cleanup();
    }
  }

  async control(command: PlaybackCommand, signal: AbortSignal): Promise<SpotifyResult<void>> {
    return this.controlAt(command, Date.now(), signal);
  }

  async controlAt(command: PlaybackCommand, nowMs = Date.now(), signal: AbortSignal = this.abortController.signal): Promise<SpotifyResult<void>> {
    const generation = this.generation;
    const mergedSignal = mergeAbortSignals(this.abortController.signal, signal);
    try {
      const token = await this.accessToken(nowMs, mergedSignal.signal, generation);
      if (!token.ok) return token;

      let result = await sendPlaybackCommand(token.value, command, this.fetcher, mergedSignal.signal);
      if (generation !== this.generation || this.disposed) return disposedError();
      if (!result.ok && result.error.kind === 'unauthorized') {
        this.token = null;
        const retryToken = await this.accessToken(nowMs, mergedSignal.signal, generation);
        if (retryToken.ok) result = await sendPlaybackCommand(retryToken.value, command, this.fetcher, mergedSignal.signal);
      }
      if (generation !== this.generation || this.disposed) return disposedError();
      return result;
    } finally {
      mergedSignal.cleanup();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.abortController.abort();
    this.token = null;
  }

  private async fetchPlayback(accessToken: string, nowMs: number, signal?: AbortSignal): Promise<SpotifyResult<NormalizedPlayback>> {
    const result = await fetchCurrentPlayback(accessToken, this.fetcher, new Date(nowMs).toISOString(), {
      skipPrimaryEndpoint: nowMs < this.primaryPlaybackEndpointBlockedUntilMs,
      signal
    });
    if (result.ok && result.degraded) {
      this.primaryPlaybackEndpointBlockedUntilMs = nowMs + PRIMARY_ENDPOINT_DEGRADED_COOLDOWN_MS;
    } else if (result.ok && nowMs >= this.primaryPlaybackEndpointBlockedUntilMs) {
      this.primaryPlaybackEndpointBlockedUntilMs = 0;
    }
    return result;
  }

  private async accessToken(nowMs: number, signal: AbortSignal, generation: number): Promise<SpotifyResult<string>> {
    if (this.disposed) {
      return { ok: false, error: { kind: 'unauthorized', message: 'Spotify provider is disposed.' } };
    }
    if (this.reauthorizationRequired) {
      return { ok: false, error: { kind: 'unauthorized', message: 'Spotify authorization is required.' } };
    }
    if (!shouldRefreshToken(this.token, nowMs)) {
      return { ok: true, value: this.token?.accessToken as string };
    }
    if (!this.refreshPromise) {
      this.refreshPromise = refreshAccessToken({ ...this.credentials, refreshToken: this.refreshToken }, this.fetcher, nowMs, signal)
        .finally(() => { this.refreshPromise = null; });
    }
    const refreshed = await this.refreshPromise;
    if (this.disposed || generation !== this.generation) return disposedError();
    if (!refreshed.ok) {
      this.token = null;
      if (refreshed.error.kind === 'unauthorized') this.reauthorizationRequired = true;
      return refreshed;
    }
    this.token = refreshed.value;
    if (refreshed.value.refreshToken) this.refreshToken = refreshed.value.refreshToken;
    return { ok: true, value: refreshed.value.accessToken };
  }
}

const disposedError = (): SpotifyResult<never> => ({
  ok: false,
  error: { kind: 'unauthorized', message: 'Spotify provider is disposed.' }
});
