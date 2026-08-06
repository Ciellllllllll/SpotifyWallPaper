export interface MergedAbortSignal {
  signal: AbortSignal;
  cleanup(): void;
}

export const mergeAbortSignals = (...signals: readonly (AbortSignal | undefined)[]): MergedAbortSignal => {
  const active = [...new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined))];
  if (active.length === 0) return { signal: new AbortController().signal, cleanup: () => undefined };
  if (active.length === 1) return { signal: active[0], cleanup: () => undefined };
  if (typeof AbortSignal.any === 'function') return { signal: AbortSignal.any(active), cleanup: () => undefined };

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of active) signal.removeEventListener('abort', abort);
    }
  };
};
