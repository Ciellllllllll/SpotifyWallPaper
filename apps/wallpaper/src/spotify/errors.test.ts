import { describe, expect, it } from 'vitest';
import { classifyNetworkError, classifySpotifyStatus, classifySpotifyResponse } from './errors';

describe('Spotify error classification', () => {
  it('distinguishes quota exhaustion, 5xx and malformed responses without echoing bodies', async () => {
    const error = await classifySpotifyResponse(Response.json({ error: { reason: 'QUOTA_EXCEEDED', message: 'dummy-private-upstream' } }, { status: 429 }));
    expect(error).toMatchObject({ kind: 'rate_limited', quotaExceeded: true, retryAfterMs: 3600000 });
    expect(JSON.stringify(error)).not.toContain('dummy-private-upstream');
    expect(classifySpotifyStatus(503).kind).toBe('unavailable');
    expect(classifySpotifyStatus(418).kind).toBe('unknown_response_shape');
  });
  it('classifies authorization and permission failures', () => {
    expect(classifySpotifyStatus(401).kind).toBe('unauthorized');
    expect(classifySpotifyStatus(403).kind).toBe('forbidden');
  });

  it('respects retry-after on rate limits', () => {
    const error = classifySpotifyStatus(429, '7');

    expect(error.kind).toBe('rate_limited');
    expect(error.retryAfterMs).toBe(7000);
  });

  it('preserves multi-day Retry-After values', () => {
    expect(classifySpotifyStatus(429, '172800').retryAfterMs).toBe(172800000);
  });

  it.each(['1.5', '7seconds', '-1'])(
    'drops an unsafe retry-after header: %s',
    (value) => {
      expect(classifySpotifyStatus(429, value).retryAfterMs).toBeUndefined();
    }
  );

  it('classifies no active device and network errors', () => {
    expect(classifySpotifyStatus(204).kind).toBe('unavailable');
    expect(classifyNetworkError().kind).toBe('network_error');
  });
});
