import { expect, it, vi } from 'vitest';
import { spotifyFetch } from './request';

it('bounds network and response-body waits and does not follow credential-bearing redirects', async () => {
  vi.useFakeTimers();
  try {
    let policy: RequestInit | undefined;
    const pending = spotifyFetch(async (_url, init) => { policy = init; return new Response(new ReadableStream({ start() {} })); }, 'https://accounts.spotify.com/api/token', {});
    const check = expect(pending).rejects.toThrow('Spotify request failed.');
    await vi.advanceTimersByTimeAsync(15000);
    await check;
    expect(policy).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(policy?.signal?.aborted).toBe(true);
  } finally { vi.useRealTimers(); }
});
