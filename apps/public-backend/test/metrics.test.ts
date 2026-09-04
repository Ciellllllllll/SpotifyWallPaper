import { describe, expect, it } from 'vitest';

import { createMetrics } from '../src/metrics.js';

describe('fixed backend metrics', () => {
  it('emits only fixed dimensions and aggregate counts', () => {
    const lines: string[] = [];
    const metrics = createMetrics((line) => lines.push(line));

    metrics.recordRequest(
      'public',
      'GET',
      '/auth/callback?code=secret&state=secret',
      303,
      2500
    );
    metrics.recordRequest('public', 'GET', '/api/playback', 429, 7);
    metrics.recordRefresh('success');
    metrics.recordRefresh('success');
    metrics.flush();
    metrics.stop();

    expect(lines).toEqual([
      'event=refresh route=refresh status=not_applicable latency=not_applicable outcome=success count=2',
      'event=request route=auth_callback status=3xx latency=2000ms_plus outcome=not_limited count=1',
      'event=request route=playback status=4xx latency=0_9ms outcome=limited count=1'
    ]);
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('collapses unknown request data into fixed dimensions', () => {
    const lines: string[] = [];
    const metrics = createMetrics((line) => lines.push(line));

    metrics.recordRequest('public', 'TRACE', '/unknown', 700, Number.NaN);
    metrics.flush();
    metrics.stop();

    expect(lines).toEqual([
      'event=request route=other status=other latency=invalid outcome=not_limited count=1'
    ]);
  });
});
