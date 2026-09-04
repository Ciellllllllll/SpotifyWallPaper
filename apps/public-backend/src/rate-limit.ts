export type LimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

interface WindowEntry {
  count: number;
  startedAtMs: number;
}

export class FixedWindowLimiter {
  readonly #entries = new Map<string, WindowEntry>();
  #nextSweepAtMs = 0;

  constructor(
    readonly limit: number,
    readonly capacity: number,
    readonly now: () => number = Date.now
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Invalid rate-limit configuration.');
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  take(key: string): LimitResult {
    const nowMs = this.now();
    if (nowMs >= this.#nextSweepAtMs) {
      for (const [entryKey, entry] of this.#entries) {
        if (nowMs - entry.startedAtMs >= 60_000) this.#entries.delete(entryKey);
      }
      this.#nextSweepAtMs = nowMs + 30_000;
    }

    const existing = this.#entries.get(key);
    if (existing === undefined) {
      if (this.#entries.size >= this.capacity) {
        return { allowed: false, retryAfterSeconds: 60 };
      }
      this.#entries.set(key, { count: 1, startedAtMs: nowMs });
      return { allowed: true };
    }
    if (nowMs - existing.startedAtMs >= 60_000) {
      this.#entries.set(key, { count: 1, startedAtMs: nowMs });
      return { allowed: true };
    }
    if (existing.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.min(60, Math.ceil((60_000 - (nowMs - existing.startedAtMs)) / 1000))
        )
      };
    }
    existing.count += 1;
    return { allowed: true };
  }
}
