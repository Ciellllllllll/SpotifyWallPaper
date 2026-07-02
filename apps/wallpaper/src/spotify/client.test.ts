import { describe, expect, it } from 'vitest';
import { sendPlaybackCommand } from './client';

describe('sendPlaybackCommand', () => {
  it('sends playback operations to Spotify without exposing token values in errors', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await sendPlaybackCommand('secret-access-token', { type: 'pause' }, fetcher);
    await sendPlaybackCommand('secret-access-token', { type: 'seek', positionMs: 12_345 }, fetcher);
    await sendPlaybackCommand('secret-access-token', { type: 'volume', volumePercent: 150 }, fetcher);
    await sendPlaybackCommand('secret-access-token', { type: 'shuffle', state: true }, fetcher);
    await sendPlaybackCommand('secret-access-token', { type: 'repeat', state: 'context' }, fetcher);

    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['PUT', 'https://api.spotify.com/v1/me/player/pause'],
      ['PUT', 'https://api.spotify.com/v1/me/player/seek?position_ms=12345'],
      ['PUT', 'https://api.spotify.com/v1/me/player/volume?volume_percent=100'],
      ['PUT', 'https://api.spotify.com/v1/me/player/shuffle?state=true'],
      ['PUT', 'https://api.spotify.com/v1/me/player/repeat?state=context']
    ]);
  });

  it('classifies restricted control failures safely', async () => {
    const fetcher = (async () => new Response(null, { status: 403 })) as typeof fetch;

    const result = await sendPlaybackCommand('secret-access-token', { type: 'play' }, fetcher);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('forbidden');
    expect(result.error.message).not.toContain('secret-access-token');
  });
});
