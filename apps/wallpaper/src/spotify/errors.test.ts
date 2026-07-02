import { describe, expect, it } from 'vitest';
import { classifyNetworkError, classifySpotifyStatus } from './errors';

describe('Spotify error classification', () => {
  it('classifies authorization and permission failures', () => {
    expect(classifySpotifyStatus(401).kind).toBe('unauthorized');
    expect(classifySpotifyStatus(403).kind).toBe('forbidden');
  });

  it('respects retry-after on rate limits', () => {
    const error = classifySpotifyStatus(429, '7');

    expect(error.kind).toBe('rate_limited');
    expect(error.retryAfterMs).toBe(7000);
  });

  it('classifies no active device and network errors', () => {
    expect(classifySpotifyStatus(204).kind).toBe('unavailable');
    expect(classifyNetworkError().kind).toBe('network_error');
  });
});
