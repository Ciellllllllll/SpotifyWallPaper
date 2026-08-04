import { describe, expect, it } from 'vitest';
import { mergeAbortSignals } from './signals';

describe('mergeAbortSignals', () => {
  it('deduplicates inputs and removes fallback listeners after cleanup', () => {
    const originalAny = AbortSignal.any;
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    try {
      let added = 0;
      let removed = 0;
      const makeSignal = (): AbortSignal => ({
        aborted: false,
        onabort: null,
        reason: undefined,
        throwIfAborted: () => undefined,
        addEventListener: () => { added += 1; },
        removeEventListener: () => { removed += 1; },
        dispatchEvent: () => true
      } as unknown as AbortSignal);
      const first = makeSignal();
      const second = makeSignal();
      const merged = mergeAbortSignals(first, second, first);

      expect(added).toBe(2);
      merged.cleanup();
      expect(removed).toBe(2);
    } finally {
      Object.defineProperty(AbortSignal, 'any', { configurable: true, value: originalAny });
    }
  });
});
