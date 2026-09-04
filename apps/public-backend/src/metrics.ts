import type { SocketKind } from './router.js';
import type { RefreshOutcome } from './spotify.js';

type RequestRoute =
  | 'health'
  | 'privacy'
  | 'terms'
  | 'auth_callback'
  | 'playback'
  | 'playback_options'
  | 'control'
  | 'control_options'
  | 'account'
  | 'setup'
  | 'auth_start'
  | 'auth_confirm_get'
  | 'auth_confirm_post'
  | 'reauthorize'
  | 'other';

export interface Metrics {
  recordRequest(
    socket: SocketKind,
    method: string | undefined,
    rawTarget: string | undefined,
    status: number,
    elapsedMs: number
  ): void;
  recordRefresh(outcome: RefreshOutcome): void;
  flush(): void;
  stop(): void;
}

const refreshOutcomes = new Set<RefreshOutcome>([
  'success',
  'reauthorization_required',
  'rate_limited',
  'network_error',
  'failed'
]);

export function createMetrics(
  emit: (line: string) => void = (line) => console.info(line),
  intervalMs = 60_000
): Metrics {
  const counts = new Map<string, number>();
  const timer = setInterval(flush, intervalMs);
  timer.unref?.();

  return {
    recordRequest(socket, method, rawTarget, status, elapsedMs) {
      const route = requestRoute(socket, method, rawTarget);
      increment(
        `event=request route=${route} status=${statusClass(status)} ` +
          `latency=${latencyBucket(elapsedMs)} ` +
          `outcome=${status === 429 ? 'limited' : 'not_limited'}`
      );
    },

    recordRefresh(outcome) {
      if (!refreshOutcomes.has(outcome)) return;
      increment(
        `event=refresh route=refresh status=not_applicable ` +
          `latency=not_applicable outcome=${outcome}`
      );
    },

    flush,

    stop() {
      clearInterval(timer);
    }
  };

  function increment(key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  function flush(): void {
    const pending = [...counts.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    );
    counts.clear();
    for (const [key, count] of pending) {
      try {
        emit(`${key} count=${count}`);
      } catch {
        // Metrics must never affect authentication or playback.
      }
    }
  }
}

function requestRoute(
  socket: SocketKind,
  method: string | undefined,
  rawTarget: string | undefined
): RequestRoute {
  const queryIndex = rawTarget?.indexOf('?') ?? -1;
  const path =
    rawTarget === undefined
      ? ''
      : queryIndex === -1
        ? rawTarget
        : rawTarget.slice(0, queryIndex);
  const route = `${socket}:${method ?? ''}:${path}`;
  switch (route) {
    case 'public:GET:/health':
      return 'health';
    case 'public:GET:/privacy':
      return 'privacy';
    case 'public:GET:/terms':
      return 'terms';
    case 'public:GET:/auth/callback':
      return 'auth_callback';
    case 'public:GET:/api/playback':
      return 'playback';
    case 'public:OPTIONS:/api/playback':
      return 'playback_options';
    case 'public:POST:/api/control':
      return 'control';
    case 'public:OPTIONS:/api/control':
      return 'control_options';
    case 'public:DELETE:/api/account':
      return 'account';
    case 'admin:GET:/setup':
      return 'setup';
    case 'admin:POST:/auth/start':
      return 'auth_start';
    case 'admin:GET:/auth/confirm':
      return 'auth_confirm_get';
    case 'admin:POST:/auth/confirm':
      return 'auth_confirm_post';
    case 'admin:POST:/auth/reauthorize':
      return 'reauthorize';
    default:
      return 'other';
  }
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

function latencyBucket(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'invalid';
  if (elapsedMs < 10) return '0_9ms';
  if (elapsedMs < 100) return '10_99ms';
  if (elapsedMs < 500) return '100_499ms';
  if (elapsedMs < 2_000) return '500_1999ms';
  return '2000ms_plus';
}
