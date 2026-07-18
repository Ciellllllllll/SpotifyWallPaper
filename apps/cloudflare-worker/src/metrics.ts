export type RefreshMetricOutcome =
  | 'success'
  | 'reauthorization_required'
  | 'rate_limited'
  | 'network_error'
  | 'failed';

type ScheduledMetricOutcome = 'success' | 'failed';

interface MetricsEnv {
  ENVIRONMENT: string;
  METRICS?: AnalyticsEngineDataset;
}

export function recordRequestMetric(
  env: Env,
  request: Request,
  response: Response,
  elapsedMs: number
): void {
  try {
    const route = requestRouteClass(request);
    writeMetric(env, {
      blobs: [
        env.ENVIRONMENT,
        route,
        statusClass(response.status),
        latencyBucket(elapsedMs),
        response.status === 429 ? 'limited' : 'not_limited',
        'not_applicable'
      ],
      doubles: [boundedMetricNumber(elapsedMs), 1],
      indexes: [route]
    });
  } catch {
    // Metrics are best-effort and must not affect request handling.
  }
}

export function recordRefreshMetric(
  env: Env,
  outcome: RefreshMetricOutcome
): void {
  try {
    writeMetric(env, {
      blobs: [
        env.ENVIRONMENT,
        'refresh',
        'not_applicable',
        'not_applicable',
        'not_applicable',
        outcome
      ],
      doubles: [0, 1],
      indexes: ['refresh']
    });
  } catch {
    // Metrics are best-effort and must not affect token refresh.
  }
}

export function recordScheduledMetric(
  env: Env,
  outcome: ScheduledMetricOutcome,
  reconciledCount: number
): void {
  try {
    writeMetric(env, {
      blobs: [
        env.ENVIRONMENT,
        'deletion_reconciler',
        'not_applicable',
        'not_applicable',
        'not_applicable',
        outcome
      ],
      doubles: [boundedMetricNumber(reconciledCount), 1],
      indexes: ['deletion_reconciler']
    });
  } catch {
    // Metrics are best-effort and must not affect scheduled work.
  }
}

function writeMetric(env: Env, point: AnalyticsEngineDataPoint): void {
  try {
    (env as unknown as MetricsEnv).METRICS?.writeDataPoint(point);
  } catch {
    // Aggregate telemetry must never affect authentication or playback.
  }
}

function requestRouteClass(request: Request): string {
  switch (new URL(request.url).pathname) {
    case '/health':
      return 'health';
    case '/setup':
      return 'setup';
    case '/auth/start':
      return 'auth_start';
    case '/auth/callback':
      return 'auth_callback';
    case '/auth/reauthorize':
      return 'auth_reauthorize';
    case '/api/playback':
      return 'playback';
    case '/api/control':
      return 'control';
    case '/api/account':
      return 'account';
    default:
      return 'other';
  }
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) {
    return '2xx';
  }
  if (status >= 300 && status < 400) {
    return '3xx';
  }
  if (status >= 400 && status < 500) {
    return '4xx';
  }
  if (status >= 500 && status < 600) {
    return '5xx';
  }
  return 'other';
}

function latencyBucket(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 'invalid';
  }
  if (elapsedMs < 10) {
    return '0_9ms';
  }
  if (elapsedMs < 100) {
    return '10_99ms';
  }
  if (elapsedMs < 500) {
    return '100_499ms';
  }
  if (elapsedMs < 2000) {
    return '500_1999ms';
  }
  return '2000ms_plus';
}

function boundedMetricNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 86_400_000)) : 0;
}
