import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaultSettings';
import { credentialsFromSettings, nextPollingDelayMs } from './polling';

describe('Spotify polling decisions', () => {
  it('uses configured playing and paused polling intervals', () => {
    expect(nextPollingDelayMs({ playback: { isPlaying: true } as never, settings: defaultSettings })).toBe(1000);
    expect(nextPollingDelayMs({ playback: { isPlaying: false } as never, settings: defaultSettings })).toBe(3000);
  });

  it('backs off on errors and respects rate-limit delay', () => {
    expect(nextPollingDelayMs({ error: { kind: 'network_error', message: 'network' }, consecutiveErrors: 2 })).toBe(15000);
    expect(
      nextPollingDelayMs({
        error: { kind: 'rate_limited', message: 'limited', retryAfterMs: 9000 },
        consecutiveErrors: 2
      })
    ).toBe(9000);
  });

  it('requires both client id and refresh token', () => {
    expect(credentialsFromSettings(defaultSettings)).toBeNull();
    expect(
      credentialsFromSettings({
        ...defaultSettings,
        spotify: {
          ...defaultSettings.spotify,
          clientId: 'client-id',
          refreshToken: 'refresh-token',
          hasRefreshToken: true
        }
      })
    ).toEqual({ clientId: 'client-id', refreshToken: 'refresh-token' });
  });
});
