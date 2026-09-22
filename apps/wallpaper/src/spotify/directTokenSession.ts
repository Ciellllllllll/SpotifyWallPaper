import { DirectCredentialStore } from './credentialStore';
import { refreshAccessToken } from './token';
import type { Fetcher, SpotifyResult } from './types';

const unauthorized = (): SpotifyResult<never> => ({ ok: false, error: { kind: 'unauthorized', message: 'Spotify authorization is required.' } });
const persistenceFailure = (): SpotifyResult<never> => ({ ok: false, error: { kind: 'storage_error', message: 'Spotify credential storage failed. Reconnect after restoring storage.' } });

/** Credential updates outlive a rendering provider; never abort these on provider disposal. */
export class DirectTokenSession {
  private flight: Promise<SpotifyResult<string>> | null = null;
  private failedPersistence = false;
  private retryStorageAt = 0;
  constructor(private readonly store: DirectCredentialStore, private readonly id: string, private readonly fetcher: Fetcher = fetch, private readonly onInvalidated: () => void = () => {}) {}

  async accessToken(now: number, rejectedAccessToken?: string): Promise<SpotifyResult<string>> {
    if (this.failedPersistence || now < this.retryStorageAt) return persistenceFailure();
    const joined = this.flight !== null;
    if (!this.flight) this.flight = this.refresh(now, rejectedAccessToken).finally(() => { this.flight = null; });
    const result = await this.flight;
    // A forced caller may join a normal read already returning the rejected token.
    if (joined && result.ok && rejectedAccessToken !== undefined && result.value === rejectedAccessToken) return this.accessToken(now, rejectedAccessToken);
    return result;
  }

  private async refresh(now: number, rejectedAccessToken?: string): Promise<SpotifyResult<string>> {
    const started = Date.now();
    let savingRefresh = false;
    let retryStorageAt = 0;
    try {
      while (Date.now() - started < 65_000) {
        const claim = await this.store.claim(this.id, now + Date.now() - started, rejectedAccessToken);
        if (claim.kind === 'missing') { this.onInvalidated(); return unauthorized(); }
        if (claim.kind === 'ready') return { ok: true, value: claim.token.accessToken };
        if (claim.kind === 'cooldown') return { ok: false, error: claim.error };
        if (claim.kind === 'busy') { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
        const result = await refreshAccessToken(claim.record, this.fetcher, now + Date.now() - started);
        // Save a rotated token even after the provider is disposed. The lease/revision
        // check rejects a result belonging to an account that has since been replaced.
        // Only an explicit HTTP failure can be retried after a failed cooldown
        // write. Rotation, revocation, or an ambiguous response stay fail-closed.
        savingRefresh = result.ok || !!result.invalidGrant || result.error.status === undefined || result.error.status < 400;
        const completedAt = now + Date.now() - started;
        if (!savingRefresh && !result.ok) {
          retryStorageAt = Math.max(claim.record.lease!.until, completedAt + Math.max(
            result.error.retryAfterMs ?? 0,
            Math.min(300000, 5000 * 2 ** Math.min(7, claim.record.cooldown?.failures ?? 0)) * 1.2
          ));
        }
        const saved = await this.store.complete(claim.record, result, completedAt);
        savingRefresh = false;
        retryStorageAt = 0;
        this.retryStorageAt = 0;
        if (!saved) continue;
        if (!result.ok && result.invalidGrant) this.onInvalidated();
        return result.ok ? { ok: true, value: result.value.accessToken } : result;
      }
      return { ok: false, error: { kind: 'unavailable', message: 'Spotify credential update is busy.' } };
    } catch {
      // A failed rotation write must not immediately retry with the obsolete token.
      this.failedPersistence = savingRefresh;
      this.retryStorageAt = retryStorageAt;
      return persistenceFailure();
    }
  }
}
