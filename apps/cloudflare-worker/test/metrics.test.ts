import { describe, expect, it, vi } from 'vitest';

import {
  recordRequestMetric,
  recordRefreshMetric,
  recordScheduledMetric
} from '../src/metrics';
import worker from '../src/index';
import { fetchWithBoundary } from '../src/index';

const secret = 'swpb1.AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('aggregate public backend metrics', () => {
  it('records only fixed request classes and never URL or credential values', () => {
    const writeDataPoint = vi.fn();
    const metricsEnv = {
      ENVIRONMENT: 'production',
      METRICS: { writeDataPoint }
    } as unknown as Env;

    recordRequestMetric(
      metricsEnv,
      new Request(
        `https://api.wallpaper.example/auth/callback?code=sensitive-code&state=${secret}`
      ),
      new Response(null, { status: 429 }),
      140
    );

    expect(writeDataPoint).toHaveBeenCalledOnce();
    const point = writeDataPoint.mock.calls[0]?.[0];
    expect(point).toEqual({
      blobs: [
        'production',
        'auth_callback',
        '4xx',
        '100_499ms',
        'limited',
        'not_applicable'
      ],
      doubles: [140, 1],
      indexes: ['auth_callback']
    });
    expect(JSON.stringify(point)).not.toContain('sensitive-code');
    expect(JSON.stringify(point)).not.toContain(secret);
    expect(JSON.stringify(point)).not.toContain('api.wallpaper.example');
  });

  it('records fixed refresh and scheduled outcomes without identifiers', () => {
    const writeDataPoint = vi.fn();
    const metricsEnv = {
      ENVIRONMENT: 'preview',
      METRICS: { writeDataPoint }
    } as unknown as Env;

    recordRefreshMetric(metricsEnv, 'reauthorization_required');
    recordScheduledMetric(metricsEnv, 'partial_failure', {
      attemptedCount: 100,
      reconciledCount: 98,
      failedCount: 2,
      pendingCount: 4,
      oldestPendingAgeMs: 1_800_000,
      maxRetryCount: 3
    });

    expect(writeDataPoint.mock.calls.map(([point]) => point)).toEqual([
      {
        blobs: [
          'preview',
          'refresh',
          'not_applicable',
          'not_applicable',
          'not_applicable',
          'reauthorization_required'
        ],
        doubles: [0, 1],
        indexes: ['refresh']
      },
      {
        blobs: [
          'preview',
          'deletion_reconciler',
          'not_applicable',
          'not_applicable',
          'not_applicable',
          'partial_failure'
        ],
        doubles: [100, 98, 2, 4, 1_800_000, 3, 1],
        indexes: ['deletion_reconciler']
      }
    ]);
  });

  it('never lets a metrics binding failure affect request handling', () => {
    const metricsEnv = {
      ENVIRONMENT: 'production',
      METRICS: {
        writeDataPoint() {
          throw new Error('analytics unavailable');
        }
      }
    } as unknown as Env;

    expect(() =>
      recordRequestMetric(
        metricsEnv,
        new Request('https://api.wallpaper.example/api/playback'),
        new Response(null, { status: 200 }),
        5
      )
    ).not.toThrow();
  });

  it('never lets malformed metrics bindings or environment values escape', () => {
    const metricsEnv = new Proxy({} as Env, {
      get(_target, property) {
        if (property === 'ENVIRONMENT') {
          throw new Error('SWPB_CI_WORKER_KEY_CANARY');
        }
        return undefined;
      }
    });

    expect(() =>
      recordScheduledMetric(metricsEnv, 'failed', {
        attemptedCount: 0,
        reconciledCount: 0,
        failedCount: 0,
        pendingCount: 0,
        oldestPendingAgeMs: 0,
        maxRetryCount: 0
      })
    ).not.toThrow();
  });

  it('records an HTTP metric from the Worker entry point', async () => {
    const writeDataPoint = vi.fn();
    const metricsEnv = {
      ENVIRONMENT: 'preview',
      METRICS: { writeDataPoint }
    } as unknown as Env;

    const response = await worker.fetch(
      new Request('https://api.wallpaper.example/health'),
      metricsEnv
    );

    expect(response.status).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint.mock.calls[0]?.[0]?.blobs.slice(0, 3)).toEqual([
      'preview',
      'health',
      '2xx'
    ]);
  });

  it('returns a fixed redacted response for an uncaught route exception', async () => {
    const thrownSecret = 'SWPB_CI_REFRESH_TOKEN_CANARY';
    const request = new Request(
      'https://api.wallpaper.example/auth/callback?code=sensitive&state=sensitive'
    );
    const response = await fetchWithBoundary(
      request,
      {
        ENVIRONMENT: 'production',
        METRICS: { writeDataPoint: vi.fn() }
      } as unknown as Env,
      async () => {
        throw new Error(thrownSecret);
      }
    );

    const responseText = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(responseText)).toEqual({
      ok: false,
      error: {
        kind: 'unavailable',
        message: 'The backend is temporarily unavailable.',
        status: 500
      }
    });
    expect(responseText).not.toContain(thrownSecret);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'"
    );
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'"
    );
  });

  it('resolves scheduled failures without exposing the thrown exception', async () => {
    let scheduledWork: Promise<unknown> | undefined;
    const context = {
      waitUntil(promise: Promise<unknown>) {
        scheduledWork = promise;
      }
    } as ExecutionContext;
    const failingEnv = {
      ...({} as Env),
      ENVIRONMENT: 'production',
      DB: {
        prepare() {
          throw new Error('SWPB_CI_WORKER_KEY_CANARY');
        }
      },
      DELETION_DB: {}
    } as unknown as Env;

    await worker.scheduled(
      {} as ScheduledController,
      failingEnv,
      context
    );

    await expect(scheduledWork).resolves.toBeUndefined();
  });
});
