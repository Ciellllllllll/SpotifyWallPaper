import { DirectCredentialStore, type CredentialRecord } from './credentialStore';
import { refreshAccessToken } from './token';
import type { Fetcher, SpotifyResult, SpotifyTokenState } from './types';

const unauthorized = (): SpotifyResult<never> => ({ ok: false, error: { kind: 'unauthorized', message: 'Spotify authorization is required.' } });
const persistenceFailure = (): SpotifyResult<never> => ({ ok: false, error: { kind: 'storage_error', message: 'Spotify credential storage failed. Reconnect after restoring storage.' } });
const uncertainUpdate = (): SpotifyResult<never> => ({ ok: false, error: { kind: 'storage_error', message: 'Spotify token update is unconfirmed. Reauthorize using the authentication page if the original session cannot recover.' } });

/** Credential updates outlive a rendering provider; never abort these on provider disposal. */
export class DirectTokenSession {
  private flight: Promise<SpotifyResult<string>> | null = null;
  private pendingCompletion: { claim: CredentialRecord; result: SpotifyResult<SpotifyTokenState>; completedAt: number } | null = null;
  constructor(private readonly store: DirectCredentialStore, private readonly id: string, private readonly fetcher: Fetcher = fetch, private readonly onInvalidated: () => void = () => {}) {}

  async accessToken(now: number, rejectedAccessToken?: string): Promise<SpotifyResult<string>> {
    const joined = this.flight !== null;
    if (!this.flight) this.flight = this.refresh(now, rejectedAccessToken).finally(() => { this.flight = null; });
    const result = await this.flight;
    // A forced caller may join a normal read already returning the rejected token.
    if (joined && result.ok && rejectedAccessToken !== undefined && result.value === rejectedAccessToken) return this.accessToken(now, rejectedAccessToken);
    return result;
  }

  private async refresh(now: number, rejectedAccessToken?: string): Promise<SpotifyResult<string>> {
    const started = Date.now();
    try {
      // Retain the original response and timestamp until the DB confirms it.
      // Other sessions are fenced by the persisted lease, not this memory field.
      if (this.pendingCompletion) {
        const pending = this.pendingCompletion;
        const saved = await this.store.complete(pending.claim, pending.result, pending.completedAt);
        this.pendingCompletion = null;
        if (saved && !pending.result.ok && pending.result.invalidGrant) {
          this.onInvalidated();
          return pending.result;
        }
      }
      while (Date.now() - started < 65_000) {
        const claim = await this.store.claim(this.id, now + Date.now() - started, rejectedAccessToken);
        if (claim.kind === 'missing') { this.onInvalidated(); return unauthorized(); }
        if (claim.kind === 'ready') return { ok: true, value: claim.token.accessToken };
        if (claim.kind === 'cooldown') return { ok: false, error: claim.error };
        if (claim.kind === 'uncertain') return uncertainUpdate();
        if (claim.kind === 'busy') { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
        const result = await refreshAccessToken(claim.record, this.fetcher, now + Date.now() - started);
        // Save a rotated token even after the provider is disposed. The lease/revision
        // check rejects a result belonging to an account that has since been replaced.
        const completedAt = now + Date.now() - started;
        this.pendingCompletion = { claim: claim.record, result, completedAt };
        const saved = await this.store.complete(claim.record, result, completedAt);
        this.pendingCompletion = null;
        if (!saved) continue;
        if (!result.ok && result.invalidGrant) this.onInvalidated();
        return result.ok ? { ok: true, value: result.value.accessToken } : result;
      }
      return { ok: false, error: { kind: 'unavailable', message: 'Spotify credential update is busy.' } };
    } catch {
      // Leave both the original response and durable lease intact on failure.
      return persistenceFailure();
    }
  }
}
